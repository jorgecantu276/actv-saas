// Forward-only bootstrap of the enrolled, synthetic staging project. Production
// database transitions intentionally have no automatic entry point here.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, isSha, sha256, validateTarget } from './contract.mjs';
import { argsToObject, readSourceManifest } from './package.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const enrolledRef = 'fwbvbppwixzbearrlsza';
const organization = 'vdslwhphazjkobbfngws';
const quote = value => "'" + value.replaceAll("'", "''") + "'";

export function migrationTransaction(sql, path, expectedHash) {
  let offset = 0;
  // Parse only leading SQL trivia, preserving every original byte for hashing
  // and execution. Nested PostgreSQL block comments are supported.
  while (offset < sql.length) {
    if (/\s/.test(sql[offset])) { offset++; continue; }
    if (sql.startsWith('--', offset)) {
      const end = sql.indexOf('\n', offset); offset = end < 0 ? sql.length : end + 1; continue;
    }
    if (sql.startsWith('/*', offset)) {
      let depth = 1; offset += 2;
      while (offset < sql.length && depth) {
        if (sql.startsWith('/*', offset)) { depth++; offset += 2; }
        else if (sql.startsWith('*/', offset)) { depth--; offset += 2; }
        else offset++;
      }
      if (depth) throw Error('Unterminated leading SQL comment');
      continue;
    }
    break;
  }
  if (sha256(Buffer.from(sql)) !== expectedHash) throw Error('Migration bytes differ from release manifest');
  const startsTransaction = /^begin\s*;/i.test(sql.slice(offset));
  const endsTransaction = /commit;\s*$/i.test(sql);
  if (startsTransaction !== endsTransaction) throw Error('Incomplete outer migration transaction');
  const ledger = `insert into actv_release.migrations(path,sha256) values (${quote(path)},${quote(expectedHash)});`;
  return startsTransaction ? sql.replace(/commit;\s*$/i, ledger + '\ncommit;') : `begin;\n${sql}\n${ledger}\ncommit;`;
}

export async function updateStagingBackend({ target, sourceSha, output, environment = process.env, fetcher = fetch }) {
  validateTarget(target);
  if (target.environment !== 'staging' || target.supabaseProjectRef !== enrolledRef) throw Error('Only the enrolled synthetic staging backend is writable');
  if (!isSha(sourceSha)) throw Error('Full source SHA required');
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  if (git(['rev-parse', 'HEAD']) !== sourceSha || git(['status', '--porcelain'])) throw Error('Backend deployment requires clean exact-source checkout');
  const token = environment.SUPABASE_ACCESS_TOKEN;
  if (!token) throw Error('Staging Supabase management access is missing');
  async function api(path, body) {
    const response = await fetcher('https://api.supabase.com/v1/' + path, {
      method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) throw Error(`Staging management operation failed (HTTP ${response.status}; credentials and response omitted)`);
    return response.json();
  }
  const project = await api(`projects/${enrolledRef}`);
  if (project.id !== enrolledRef || project.name !== 'ACTV-Staging' || project.organization_id !== organization || project.status !== 'ACTIVE_HEALTHY') {
    throw Error('Enrolled project identity or health changed');
  }
  const query = query => api(`projects/${enrolledRef}/database/query`, { query });
  const source = readSourceManifest(sourceSha);
  const sqlFile = path => execFileSync('git', ['show', `${sourceSha}:${path}`], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  const state = (await query(`select to_regclass('actv_release.migrations') is not null as ledger,
    (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE')::int as public_tables`))[0];
  if (!state.ledger) {
    const rows = (await query('select (select count(*) from auth.users)::int as users,(select count(*) from storage.objects)::int as objects'))[0];
    if (state.public_tables !== 0 || rows.users !== 0 || rows.objects !== 0) throw Error('Unknown existing staging schema; reconcile it manually without reset');
    const catalog = JSON.parse(sqlFile('tests/staging/baseline-catalog.json'));
    const defaults = await query(`select d.defaclobjtype::text as kind,d.defaclacl::text as acl from pg_default_acl d
      join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public' and pg_get_userbyid(d.defaclrole)='supabase_admin'`);
    for (const expected of catalog.metadata.default_grants.filter(row => row.owner === 'supabase_admin')) {
      if (!defaults.some(row => row.kind === expected.kind && row.acl === expected.acl)) throw Error('Hosted platform default ACL differs from captured baseline');
    }
    const path = 'tests/staging/legacy-baseline.sql';
    const original = sqlFile(path);
    // Hosted postgres cannot alter supabase_admin defaults; their exact existing
    // values were verified above. All application baseline statements remain.
    const baseline = original.replace(/^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin[^;]+;/gm, '');
    await query(`begin; ${baseline}
      create schema actv_release; revoke all on schema actv_release from public,anon,authenticated,service_role;
      create table actv_release.migrations(path text primary key,sha256 text not null,applied_at timestamptz not null default now());
      insert into actv_release.migrations(path,sha256) values (${quote(path)},${quote(sha256(original))}); commit;`);
  }
  const applied = await query('select path,sha256 from actv_release.migrations order by path');
  for (const previous of applied) {
    if (!source.inputs.some(input => input.path === previous.path && input.sha256 === previous.sha256)) throw Error('Applied migration/baseline history differs; forward maintenance required');
  }
  const migrations = source.inputs.filter(input => input.path.startsWith('supabase/migrations/')).sort((a, b) => a.path.localeCompare(b.path));
  let pendingSeen = false;
  for (const migration of migrations) {
    if (applied.some(previous => previous.path === migration.path)) {
      if (pendingSeen) throw Error('Applied migrations are not an ordered prefix');
    } else pendingSeen = true;
  }
  for (const migration of migrations.filter(input => !applied.some(previous => previous.path === input.path))) {
    // No automatic retry of a lost mutation acknowledgement. Its atomic ledger
    // is inspected on the next invocation before any subsequent application.
    await query(migrationTransaction(sqlFile(migration.path), migration.path, migration.sha256));
    console.log('Applied forward staging migration: ' + migration.path.split('/').at(-1));
  }
  const controls = (await query('select paused from actv_payments.sales_control'))[0];
  if (controls?.paused !== true) throw Error('Staging sales gate must remain paused');
  const cli = join(root, 'node_modules/supabase/dist/supabase.js');
  const env = { ...environment, SUPABASE_ACCESS_TOKEN: token };
  const run = args => {
    try { return execFileSync(process.execPath, [cli, ...args], { cwd: root, env, windowsHide: true,
      encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 }); }
    catch { throw Error('Staging Edge deployment failed; no credentials or raw logs emitted'); }
  };
  const secretDirectory = mkdtempSync(join(tmpdir(), 'actv-staging-secrets-'));
  try {
    const secrets = join(secretDirectory, 'edge.env');
    // No provider key, webhook destination, mail or scheduled external action
    // is enabled by app delivery. Test-provider enrollment is a separate gate.
    writeFileSync(secrets, `ACTV_STRIPE_MODE=test\nACTV_APP_URL=${target.origin}\nACTV_STAFF_ORIGIN=${target.origin}\n`, { mode: 0o600 });
    run(['secrets', 'set', '--project-ref', enrolledRef, '--env-file', secrets]);
  } finally { rmSync(secretDirectory, { recursive: true, force: true }); }
  for (const name of source.functions) {
    if (!/^[a-z][a-z0-9-]+$/.test(name) || !readdirSync(join(root, 'supabase/functions')).includes(name)) throw Error('Invalid candidate function');
    run(['functions', 'deploy', name, '--project-ref', enrolledRef, '--use-api', '--no-verify-jwt']);
    console.log('Deployed staging function: ' + name);
  }
  await query("notify pgrst, 'reload schema'");
  const deployed = await api(`projects/${enrolledRef}/functions`);
  if (!source.functions.every(name => deployed.some(row => row.slug === name && row.status === 'ACTIVE'))) throw Error('Not every candidate function is active');
  const functions = source.functions.map(name => {
    const observed = deployed.find(row => row.slug === name);
    return { name, id: observed.id, version: observed.version, status: observed.status };
  });
  const ledger = await query('select path,sha256 from actv_release.migrations order by path');
  const observation = { projectRef: enrolledRef, ledger, functions, salesPaused: true };
  const receipt = { format: 'actv-backend-receipt-v1', sourceSha, sourceTree: source.sourceTree, supabaseProjectRef: enrolledRef,
    contractSha256: digest(source.inputs), status: 'contract_deployed', salesPaused: true, observedAt: new Date().toISOString(),
    evidenceSha256: digest(observation), observation, providerAcceptance: 'not_run', scheduledJobs: 'not_enrolled', productionQualified: false };
  writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = argsToObject(process.argv.slice(2));
    if (Object.keys(args).sort().join(',') !== 'output,source-sha,target') throw Error('Required: --source-sha --target --output');
    const result = await updateStagingBackend({ sourceSha: args['source-sha'], target: JSON.parse(readFileSync(args.target)), output: args.output });
    console.log(JSON.stringify({ status: result.status, sourceSha: result.sourceSha, projectRef: result.supabaseProjectRef }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
