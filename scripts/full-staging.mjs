// Actual local Supabase services, owned disposable state and no remote target.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { verifyBaselineParity } from '../tests/staging/baseline-parity.mjs';
import { assertLocalDockerEndpoint, ensureOwnedLoopbackBindings } from './staging-bindings.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'node_modules/supabase/dist/supabase.js');
const excluded = 'realtime,imgproxy,studio,postgres-meta,edge-runtime,logflare,vector,supavisor';
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !/^(?:ACTV_|SUPABASE_|NEXT_PUBLIC_|STRIPE_|HOSTINGER_|AWS_|AZURE_|GOOGLE_|GH_TOKEN$|GITHUB_TOKEN$)/i.test(name)));
const sync = (bin, args) => execFileSync(bin, args, {
  cwd: root, env: environment, encoding: 'utf8', windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 8 * 1024 * 1024,
}).trim();

async function reservePorts() {
  const servers = [];
  try {
    const ports = [];
    for (let index = 0; index < 4; index++) {
      const server = createServer(); servers.push(server);
      await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
      ports.push(server.address().port);
    }
    return ports;
  } finally {
    await Promise.all(servers.map(server => new Promise(done => server.close(done))));
  }
}

async function localCli(context, projectId, args, logName, timeout = 600000) {
  assert(!args.some(argument => argument === '--all' || argument.startsWith('--remote') || argument === 'link'));
  const marker = JSON.parse(readFileSync(join(context, '.codex-actv-owned.json'), 'utf8'));
  assert.equal(marker.projectId, projectId);
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, ...args, '--workdir', context], {
      cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); }, timeout);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.once('error', () => { clearTimeout(timer); fail(Error(`Local Supabase ${logName} could not start`)); });
    child.once('close', code => {
      clearTimeout(timer);
      // Local keys can occur in CLI output. Logs stay in the owned private temp
      // context and are never emitted or copied to the CI evidence artifact.
      writeFileSync(join(context, `${logName}.stdout.private`), stdout, { mode: 0o600 });
      writeFileSync(join(context, `${logName}.stderr.private`), stderr, { mode: 0o600 });
      if (code === 0) done(stdout); else {
        const hints = ['unhealthy', 'port is already allocated', 'address already in use', 'failed to parse',
          'permission denied', 'no such file', 'network', 'mount', 'connection refused', 'invalid', 'timeout', 'container'].filter(word => stderr.toLowerCase().includes(word));
        fail(Error(`Local Supabase ${logName} failed (${code}; ${hints.join(',') || 'no diagnostic category'}); no credentials emitted`));
      }
    });
  });
}

function assertLoopback(value, name) {
  const address = new URL(value);
  assert.equal(address.hostname, '127.0.0.1', `${name} must use IPv4 loopback`);
  return address;
}

async function applySql(db, sql) {
  const client = await db.connect();
  try { await client.query(sql); }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { try { await client.query('RESET ALL'); } finally { client.release(); } }
}

async function waitForRestSchema(context) {
  // NOTIFY is asynchronous. Wait for the read-only API schema to include the
  // installed contracts before testing them; never retry a write or reinterpret
  // PGRST202 as an authorization denial.
  const required = ['actv_evidence_adopt_legacy', 'actv_sale_receipt', 'actv_staff_recent_orders',
    'actv_registration_record', 'actv_correct_registration', 'actv_operations_roster', 'actv_operations_clubs',
    'actv_my_participant_links','actv_participant_refund_detail','actv_transition_event','actv_correct_attendance'];
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const response = await fetch(context.apiUrl + '/rest/v1/', { headers: {
      apikey: context.serviceKey, authorization: 'Bearer ' + context.serviceKey,
    }, signal: AbortSignal.timeout(Math.min(3000, Math.max(1, deadline - Date.now()))) }).catch(() => null);
    if (response?.ok) {
      const schema = await response.json();
      if (required.every(name => schema.paths?.['/rpc/' + name])) return;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw Error('Local REST schema did not become ready for the installed contracts');
}

async function schemaFingerprint(db) {
  const { rows } = await db.query(`select jsonb_build_object(
    'tables',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'rls',c.relrowsecurity,
      'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
        'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
        from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)) order by n.nspname,c.relname)
        from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','actv_payments') and c.relkind='r'),
    'constraints',(select jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,
      'definition',pg_get_constraintdef(c.oid)) order by c.conrelid::regclass::text,c.conname)
      from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ('public','actv_payments')),
    'functions',(select jsonb_agg(pg_get_functiondef(p.oid) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','actv_payments') and p.prokind='f'),
    'policies',(select jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',policyname,
      'roles',roles,'command',cmd,'using',qual,'check',with_check) order by schemaname,tablename,policyname)
      from pg_policies where schemaname in ('public','actv_payments','storage'))
    ) as structure`);
  return hash(JSON.stringify(canonical(rows[0].structure)));
}

async function applyLegacyBaseline(db, adminDb, catalog) {
  for (const extension of catalog.metadata.extensions) {
    if (extension.name === 'plpgsql') continue;
    assert(/^[a-zA-Z0-9_-]+$/.test(extension.name));
    assert(/^[a-z_]+$/.test(extension.schema));
    if (extension.schema !== 'pg_catalog') await adminDb.query(`create schema if not exists "${extension.schema}"`);
    await adminDb.query(`create extension if not exists "${extension.name}" with schema "${extension.schema}"`);
  }
  const baseline = readFileSync(join(root, 'tests/staging/legacy-baseline.sql'), 'utf8');
  const elevatedDefaults = [...baseline.matchAll(/^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin[^;]+;/gm)].map(match => match[0]);
  assert(elevatedDefaults.length > 0, 'Source default ACLs must not be silently dropped');
  await applySql(db, baseline.replace(/^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin[^;]+;/gm, ''));
  await applySql(adminDb, elevatedDefaults.join('\n'));
  const job = catalog.metadata.cleanup_jobs[0];
  assert.equal(job.name, 'limpieza-diaria-kits');
  // Never permit the scheduled legacy cleanup to race deterministic test data.
  const client = await db.connect();
  await client.query('begin');
  try {
    const scheduled = await client.query('select cron.schedule($1,$2,$3) as id', [job.name, job.schedule, job.command]);
    await client.query('select cron.alter_job($1,active:=false)', [scheduled.rows[0].id]);
    await client.query('commit');
  } catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }
}

async function assertBaseline(db, catalog) {
  const { rows } = await db.query(`select c.relname as table_name,c.relrowsecurity as rls,a.attname as column_name,
    format_type(a.atttypid,a.atttypmod) as column_type,a.attnotnull as not_null
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped order by c.relname,a.attnum`);
  assert.equal(new Set(rows.map(row => row.table_name)).size, catalog.metadata.public_tables.length);
  let count = 0;
  for (const table of catalog.metadata.public_tables) for (const column of table.columns) {
    const actual = rows.find(row => row.table_name === table.name && row.column_name === column.name);
    assert(actual, `Missing baseline ${table.name}.${column.name}`);
    assert.equal(actual.column_type, column.type);
    assert.equal(actual.not_null, column.not_null);
    assert.equal(actual.rls, table.rls);
    count++;
  }
  assert.equal(rows.length, count);
  const trigger = await db.query(`select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    join pg_namespace n on n.oid=p.pronamespace where t.tgrelid='auth.users'::regclass
    and t.tgname='on_auth_user_created' and n.nspname='public' and p.proname='handle_new_user' and t.tgenabled='O'`);
  assert.equal(trigger.rowCount, 1);
  const protection = await db.query(`select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    join pg_namespace n on n.oid=p.pronamespace where t.tgrelid='storage.objects'::regclass
    and n.nspname='storage' and p.proname='protect_delete' and not t.tgisinternal`);
  assert.equal(protection.rowCount, 1, 'Use the actual Storage protection trigger');
  const policy = await db.query(`select policyname from pg_policies where schemaname='storage' and tablename='objects'`);
  for (const expected of catalog.metadata.policies.filter(row => row.schema === 'storage')) {
    assert(policy.rows.some(row => row.policyname === expected.name));
  }
  const scheduled = await db.query(`select schedule,command,active from cron.job where jobname='limpieza-diaria-kits'`);
  assert.equal(scheduled.rowCount, 1);
  assert.equal(scheduled.rows[0].active, false);
  assert.equal(scheduled.rows[0].schedule, catalog.metadata.cleanup_jobs[0].schedule);
  assert.equal(scheduled.rows[0].command, catalog.metadata.cleanup_jobs[0].command);
  const bucket = await db.query('select id,name,public,file_size_limit,allowed_mime_types from storage.buckets where id=$1',
    [catalog.metadata.evidence_bucket.id]);
  assert.deepEqual(bucket.rows[0], catalog.metadata.evidence_bucket, 'Captured evidence bucket configuration parity');
  return { publicTables: catalog.metadata.public_tables.length, columns: count,
    actualAuthTrigger: true, actualStorageProtection: true, legacyCleanupJob: 'registered_inactive' };
}

async function resetApplicationOnly(db, adminDb, catalog) {
  const counts = (await db.query(`select (select count(*) from auth.users)::int as users,
    (select count(*) from storage.objects)::int as objects`)).rows[0];
  assert.equal(counts.users, 0, 'Clean phase must contain no Auth fixtures before controlled reset');
  assert.equal(counts.objects, 0, 'Clean phase must contain no Storage fixtures before controlled reset');
  const bucket = catalog.metadata.evidence_bucket;
  await db.query('update storage.buckets set name=$2,public=$3,file_size_limit=$4,allowed_mime_types=$5 where id=$1',
    [bucket.id,bucket.name,bucket.public,bucket.file_size_limit,bucket.allowed_mime_types]);
  await db.query('drop trigger if exists on_auth_user_created on auth.users');
  // Additive candidate policies depend on application functions; remove only
  // this candidate's named policies before recreating its owned schemas.
  const candidatePolicies = await db.query("select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'actv_evidence_%'");
  for (const { policyname } of candidatePolicies.rows) {
    await db.query('drop policy ' + '"' + policyname.replaceAll('"', '""') + '" on storage.objects');
  }
  for (const policy of catalog.metadata.policies.filter(row => row.schema === 'storage')) {
    const quote = value => '"' + value.replaceAll('"', '""') + '"';
    await db.query(`drop policy if exists ${quote(policy.name)} on storage.objects`);
  }
  await db.query('drop schema if exists actv_payments cascade; drop schema public cascade;');
  // This matches the fresh production namespace owner/ACL; public objects are
  // still created by postgres, while pg_database_owner owns the namespace.
  await adminDb.query('create schema public authorization pg_database_owner; grant usage on schema public to public;');
}

export async function runFullStaging() {
  assertLocalDockerEndpoint(sync, environment);
  const temporaryRoot = realpathSync(tmpdir());
  const contextDirectory = mkdtempSync(join(temporaryRoot, 'actv-full-'));
  // Supabase normalizes IDs to at most 40 characters; retain the exact ID in
  // configuration, resource labels and cleanup commands without truncation.
  const projectId = 'actv-full-' + randomUUID().replaceAll('-', '').slice(0, 24);
  const networkName = projectId + '-loopback';
  const marker = join(contextDirectory, '.codex-actv-owned.json');
  writeFileSync(marker, JSON.stringify({ projectId, root: contextDirectory }), { mode: 0o600 });
  let db, adminDb, networkCreated = false, status;
  const evidence = { sourceSha: sync('git', ['rev-parse', 'HEAD']), dirtySource: Boolean(sync('git', ['status', '--porcelain'])),
    startedAt: new Date().toISOString(), kind: 'isolated_full_supabase_staging', productionQualified: false,
    hostedProductionConfigurationQualified: false, phases: [], cliVersion: '3.1.0' };
  const catalog = JSON.parse(readFileSync(join(root, 'tests/staging/baseline-catalog.json'), 'utf8'));
  const migrations = readdirSync(join(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).sort();
  const migrate = async () => { for (const name of migrations) await applySql(db, readFileSync(join(root, 'supabase/migrations', name), 'utf8')); };
  try {
    assert.equal(JSON.parse(readFileSync(join(root, 'node_modules/supabase/package.json'), 'utf8')).version, '3.1.0');
    const [apiPort, dbPort, shadowPort, mailPort] = await reservePorts();
    mkdirSync(join(contextDirectory, 'supabase'));
    const replacements = { __PROJECT_ID__: projectId, __API_PORT__: apiPort, __DB_PORT__: dbPort,
      __SHADOW_PORT__: shadowPort, __MAIL_PORT__: mailPort };
    let configuration = readFileSync(join(root, 'tests/staging/config.toml'), 'utf8');
    for (const [key, value] of Object.entries(replacements)) configuration = configuration.replaceAll(key, String(value));
    assert(!configuration.includes('env('));
    writeFileSync(join(contextDirectory, 'supabase/config.toml'), configuration, { mode: 0o600 });
    sync('docker', ['network', 'create', '--label', `codex.actv.full=${projectId}`,
      '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', networkName]); networkCreated = true;
    console.log('[full-staging] Starting owned local Auth, Storage, REST, mail and PostgreSQL services');
    await localCli(contextDirectory, projectId, ['--network-id', networkName, 'start', '--exclude', excluded], 'start');
    status = JSON.parse(await localCli(contextDirectory, projectId, ['status', '-o', 'json'], 'status', 30000));
    assertLoopback(status.API_URL, 'API'); assertLoopback(status.DB_URL, 'Database');
    const containers = sync('docker', ['ps', '-a', '--filter', `label=com.supabase.cli.project=${projectId}`, '--format', '{{.ID}}']).split(/\r?\n/).filter(Boolean);
    evidence.observedContainerCount = containers.length;
    assert(containers.length >= 6, `Actual full-stack services must be running (observed ${containers.length})`);
    let inspections = JSON.parse(sync('docker', ['inspect', ...containers]));
    const bindingResult = await ensureOwnedLoopbackBindings({ inspections, projectId, contextDirectory, networkName, sync, environment });
    inspections = bindingResult.inspections;
    evidence.explicitLoopbackRebinding = bindingResult.explicitRebinding;
    evidence.networkOptions = JSON.parse(sync('docker', ['network', 'inspect', networkName]))[0].Options;
    evidence.publishedBindings = inspections.flatMap(container => Object.entries(container.NetworkSettings.Ports)
      .flatMap(([port, bindings]) => (bindings ?? []).map(binding => ({ service: container.Name, port, host: binding.HostIp }))));
    for (const container of inspections) {
      assert.equal(container.Config.Labels['com.supabase.cli.project'], projectId);
      assert(container.NetworkSettings.Networks[networkName], 'Service must be on the owned network');
      for (const bindings of Object.values(container.NetworkSettings.Ports)) for (const binding of bindings ?? []) {
        assert.equal(binding.HostIp, '127.0.0.1', 'All published service ports must be loopback-only');
      }
    }
    evidence.images = inspections.map(container => ({ service: container.Name.replace(/_actv-full-[a-f0-9]+$/, ''),
      image: container.Config.Image, imageId: container.Image }));
    evidence.loopbackOnly = true;
    db = new pg.Pool({ connectionString: status.DB_URL, max: 6 });
    const localAdmin = new URL(status.DB_URL); localAdmin.username = 'supabase_admin';
    adminDb = new pg.Pool({ connectionString: localAdmin.href, max: 1 });
    await applyLegacyBaseline(db, adminDb, catalog);
    evidence.baseline = await assertBaseline(db, catalog);
    evidence.baseline.parity = await verifyBaselineParity(db, catalog);
    await db.query('create policy codex_unexpected_permissive on public.clubes for select to anon using (true)');
    try {
      await assert.rejects(() => verifyBaselineParity(db, catalog), error =>
        error instanceof assert.AssertionError && error.message.includes('Application policy predicates/roles/permissiveness parity'));
    } finally { await db.query('drop policy codex_unexpected_permissive on public.clubes'); }
    const restoredParity = await verifyBaselineParity(db, catalog);
    assert.equal(restoredParity.actualApplicationFingerprintSha256, evidence.baseline.parity.actualApplicationFingerprintSha256);
    evidence.baseline.unexpectedPolicyRejected = true;
    evidence.productionMetadataFingerprintSha256 = catalog.schemaFingerprintSha256;
    console.log('[full-staging] Clean full-schema migration rehearsal');
    await migrate();
    const cleanFingerprint = await schemaFingerprint(db);
    evidence.phases.push({ name: 'clean_full_schema', status: 'passed', schemaFingerprintSha256: cleanFingerprint });
    await resetApplicationOnly(db, adminDb, catalog);
    await applyLegacyBaseline(db, adminDb, catalog);
    await assertBaseline(db, catalog);
    const adoptionBaseline = await verifyBaselineParity(db, catalog);
    assert.equal(adoptionBaseline.actualApplicationFingerprintSha256, evidence.baseline.parity.actualApplicationFingerprintSha256);
    const { seedLegacyState, verifyStaffLifecycle } = await import('../tests/staging/staff-contracts.mjs');
    const context = { db, apiUrl: status.API_URL, anonKey: status.ANON_KEY, serviceKey: status.SERVICE_ROLE_KEY };
    console.log('[full-staging] Retained-data adoption and actual Auth/Storage lifecycle contracts');
    const retained = await seedLegacyState(context);
    await migrate();
    // REST has to observe the newly installed RPCs and grants before API tests.
    await db.query("notify pgrst, 'reload schema'");
    await waitForRestSchema(context);
    const adoptionFingerprint = await schemaFingerprint(db);
    assert.equal(adoptionFingerprint, cleanFingerprint, 'Clean/adoption schema results must match');
    assert.equal((await db.query('select paused from actv_payments.sales_control')).rows[0].paused, true);
    await db.query('update actv_payments.sales_control set paused=false');
    for (const [name, modulePath, entry] of [
      ['private_evidence_and_cleanup', '../tests/staging/evidence-contracts.mjs', 'verifyEvidenceContracts'],
      ['shared_sale_receipts', '../tests/staging/receipt-contracts.mjs', 'verifyReceiptContracts'],
      ['sales_pause_and_recovery', '../tests/staging/sales-contracts.mjs', 'verifySalesContracts'],
      ['registration_snapshots_and_corrections', '../tests/staging/registration-contracts.mjs', 'verifyRegistrationContracts'],
      ['unified_event_operations', '../tests/staging/operations-contracts.mjs', 'verifyOperationsContracts'],
      ['bounded_club_operations', '../tests/staging/club-contracts.mjs', 'verifyClubContracts'],
      ['verified_participant_linking', '../tests/staging/linking-contracts.mjs', 'verifyLinkingContracts'],
      ['participant_refunds', '../tests/staging/refund-contracts.mjs', 'verifyRefundContracts'],
      ['event_cancellation_and_attendance_history', '../tests/staging/lifecycle-contracts.mjs', 'verifyLifecycleContracts'],
      ['browser_event_operations', '../tests/staging/operations-browser.mjs', 'verifyOperationsBrowser'],
    ]) {
      console.log('[full-staging] ' + name);
      const suite = await import(modulePath);
      const result = await suite[entry](context, retained);
      evidence.phases.push({ name, status: 'passed', contracts: result });
    }
    const contracts = await verifyStaffLifecycle(context, retained);
    evidence.phases.push({ name: 'retained_state_adoption_and_staff', status: 'passed', schemaFingerprintSha256: adoptionFingerprint, contracts });
    evidence.inputs = ['tests/staging/legacy-baseline.sql', 'tests/staging/baseline-catalog.json',
      ...migrations.map(name => 'supabase/migrations/' + name)].map(path => ({ path, sha256: hash(readFileSync(join(root, path))) }));
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed'; evidence.failure = String(error.message);
    for (const value of Object.values(status ?? {})) if (typeof value === 'string' && value.length > 12) evidence.failure = evidence.failure.replaceAll(value, '[local credential redacted]');
    evidence.failure = evidence.failure.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[local token redacted]');
  } finally {
    if (db) await db.end();
    if (adminDb) await adminDb.end();
    try {
      await localCli(contextDirectory, projectId, ['stop', '--project-id', projectId, '--no-backup'], 'stop', 120000);
      if (networkCreated) {
        const network = JSON.parse(sync('docker', ['network', 'inspect', networkName]))[0];
        assert.equal(network.Labels['codex.actv.full'], projectId);
        sync('docker', ['network', 'rm', networkName]);
      }
      const resolved = realpathSync(contextDirectory);
      const boundary = relative(temporaryRoot, resolved);
      assert(boundary && boundary !== '..' && !boundary.startsWith('..' + sep) && !boundary.includes(sep));
      assert.equal(JSON.parse(readFileSync(marker, 'utf8')).projectId, projectId);
      assert.equal(dirname(resolved), temporaryRoot);
      rmSync(resolved, { recursive: true, force: false });
      evidence.cleanup = 'owned_project_network_and_temp_removed';
    } catch { evidence.cleanup = 'failed'; evidence.status = 'failed'; }
    evidence.finishedAt = new Date().toISOString();
    mkdirSync(join(root, '.verification'), { recursive: true });
    writeFileSync(join(root, '.verification/full-staging.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
  if (evidence.status !== 'passed') throw Error(evidence.failure ?? 'Full staging cleanup failed');
  console.log('[full-staging] Full stack, clean/adoption and lifecycle contracts passed');
  return evidence;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFullStaging().catch(error => { console.error(error.message); process.exitCode = 1; });
}
