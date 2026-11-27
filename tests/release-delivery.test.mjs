import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { digest, identityFor, validateCi, validateProductionAcceptance, validateTarget, validateW6Coverage } from '../scripts/releases/contract.mjs';
import { prepareRelease } from '../scripts/releases/package.mjs';
import { observeDeployment } from '../scripts/releases/probe.mjs';
import { migrationTransaction } from '../scripts/releases/staging-backend.mjs';
import { deployHostinger, validateAppEnvironment } from '../scripts/releases/hostinger.mjs';
import { sha256 } from '../scripts/releases/contract.mjs';
import { gitObject, sourceTreeHash, verifyPayload } from '../scripts/releases/payload.mjs';
import { selectRelease } from '../scripts/releases/select.mjs';

const sourceSha = 'a'.repeat(40), hash = 'c'.repeat(64);
const sourceFiles = [{ path: 'lib/release-identity.generated.json', gitBlob: gitObject('blob', Buffer.from('{}')), mode: '100644' }];
const sourceTree = sourceTreeHash(sourceFiles);
const syntheticKey = (role, ref = 'fwbvbppwixzbearrlsza') =>
  Buffer.from('{}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ role, ref })).toString('base64url') + '.synthetic-signature';
const staging = { format: 'actv-release-target-v1', environment: 'staging', origin: 'https://staging-pdv.actv.mx',
  supabaseProjectRef: 'fwbvbppwixzbearrlsza', productionProjectRef: 'ndjqyootqtnygyzhbjrz', stripeMode: 'test', nodeMajor: 24, syntheticOnly: true,
  configuration: { supabaseAnonKeySha256: sha256(syntheticKey('anon')), publicRaceMode: 'test', wordpressOrigin: 'https://actv.mx', staffOrigin: 'https://staging-pdv.actv.mx' } };
const production = { ...staging, environment: 'production', origin: 'https://pdv.actv.mx',
  supabaseProjectRef: staging.productionProjectRef, stripeMode: 'live', syntheticOnly: false,
  configuration: { ...staging.configuration, supabaseAnonKeySha256: sha256(syntheticKey('anon', staging.productionProjectRef)), publicRaceMode: 'live', staffOrigin: 'https://pdv.actv.mx' } };
const run = { id: 123, run_attempt: 1, path: '.github/workflows/actv-pdv.yml', head_sha: sourceSha, status: 'completed', conclusion: 'success',
  repository: { full_name: 'jorgecantu276/actv-saas' }, head_repository: { full_name: 'jorgecantu276/actv-saas' }, event: 'push' };
const evidence = { sourceSha, status: 'passed', dirtySource: false, scope: 'source_candidate_synthetic_only', configurationMode: 'synthetic_test',
  fullStagingEvidenceSha256: hash, baselineCatalogSha256: hash,
  steps: ['lint', 'unit', 'record', 'types', 'build', 'edge-unit', 'financial-sql', 'edge-postgres', 'portal-contracts', 'full-staging'].map(name => ({ name, status: 'passed' })) };
const manifest = { format: 'actv-release-manifest-v1', sourceSha, sourceTree, sourceFiles, inputs: [{ path: 'supabase/migrations/1.sql', sha256: hash }], target: staging };
const backend = { format: 'actv-backend-receipt-v1', sourceSha, sourceTree, supabaseProjectRef: staging.supabaseProjectRef,
  contractSha256: digest(manifest.inputs), status: 'contract_deployed', salesPaused: true, evidenceSha256: hash };

test('automatic delivery selects only successful exact canonical main push verification', async () => {
  const observed = { ...run, name: 'ACTV candidate verification', head_branch: 'main' };
  const event = { repository: run.repository, workflow_run: observed };
  const selected = await selectRelease('workflow_run', event, { fetchRun: async () => observed, fetchMain: async () => sourceSha });
  assert.deepEqual(selected, { eligible: true, source_sha: sourceSha, ci_run_id: '123', target: 'staging', deploy: true });
});

test('PR/fork/failed workflow events cannot acquire automatic staging eligibility', async () => {
  const observed = { ...run, name: 'ACTV candidate verification', head_branch: 'main' };
  for (const patch of [{ event: 'pull_request' }, { head_branch: 'feature' }, { conclusion: 'failure' },
    { head_repository: { full_name: 'fork/actv-saas' } }, { name: 'Other workflow' }]) {
    const result = await selectRelease('workflow_run', { repository: run.repository, workflow_run: { ...observed, ...patch } }, {
      fetchRun: async () => { throw Error('Untrusted event should not reach privileged selection'); }, fetchMain: async () => sourceSha,
    });
    assert.equal(result.eligible, false);
  }
});

test('late superseded main runs skip delivery and event/API source mismatches fail', async () => {
  const observed = { ...run, name: 'ACTV candidate verification', head_branch: 'main' };
  const event = { repository: run.repository, workflow_run: observed };
  const result = await selectRelease('workflow_run', event, { fetchRun: async () => observed, fetchMain: async () => 'd'.repeat(40) });
  assert.equal(result.reason, 'superseded_main_verification');
  await assert.rejects(() => selectRelease('workflow_run', event, { fetchRun: async () => ({ ...observed, head_sha: 'd'.repeat(40) }) }), /disagrees/);
});

test('manual release uses the same normalized path and production remains main-only', async () => {
  const event = { repository: run.repository, inputs: { source_sha: sourceSha, ci_run_id: '123', target: 'production', deploy: 'true' } };
  await assert.rejects(() => selectRelease('workflow_dispatch', event, { ref: 'refs/heads/feature' }), /target/);
  const selected = await selectRelease('workflow_dispatch', event, { ref: 'refs/heads/main', fetchRun: async () => run });
  assert.equal(selected.target, 'production'); assert.equal(selected.deploy, true);
  await assert.rejects(() => selectRelease('workflow_dispatch', { ...event, inputs: { ...event.inputs, ci_run_id: 'not-an-id' } }, { ref: 'refs/heads/main' }), /Immutable/);
});

test('staging refuses production backend, host, live provider and unexpected secret fields', () => {
  assert.equal(validateTarget(staging), staging);
  for (const patch of [{ supabaseProjectRef: staging.productionProjectRef }, { origin: production.origin },
    { stripeMode: 'live' }, { nodeMajor: 22 }, { origin: 'https://staging-pdv.actv.mx/path' },
    { serviceKey: 'never-hash-a-secret' }, { syntheticOnly: false }]) {
    assert.throws(() => validateTarget({ ...staging, ...patch }));
  }
});

test('source verification requires exact clean evidence and canonical workflow/repository', () => {
  assert.equal(validateCi(run, evidence, sourceSha).runId, 123);
  for (const patch of [{ head_sha: 'd'.repeat(40) }, { conclusion: 'failure' },
    { head_repository: { full_name: 'other/repo' } }, { path: '.github/workflows/product-record.yml' }]) {
    assert.throws(() => validateCi({ ...run, ...patch }, evidence, sourceSha));
  }
  for (const patch of [{ dirtySource: true }, { steps: evidence.steps.slice(1) }, { fullStagingEvidenceSha256: null }]) {
    assert.throws(() => validateCi(run, { ...evidence, ...patch }, sourceSha));
  }
});

test('staging migration ledger commits atomically and refuses altered or nontransactional SQL', () => {
  const sql = 'begin;\nselect 1;\ncommit;\n';
  const transaction = migrationTransaction(sql, 'supabase/migrations/1.sql', sha256(sql));
  assert(transaction.includes("insert into actv_release.migrations(path,sha256) values ('supabase/migrations/1.sql'"));
  assert(transaction.endsWith('commit;'));
  assert.throws(() => migrationTransaction(sql, 'supabase/migrations/1.sql', hash));
  assert(migrationTransaction('select 1;', 'supabase/migrations/1.sql', sha256('select 1;')).startsWith('begin;'));
  assert.throws(() => migrationTransaction('begin;select 1;', 'supabase/migrations/1.sql', sha256('begin;select 1;')));
  const commented = '-- Intro\n /* outer /* nested */ remaining */\n' + sql;
  assert(migrationTransaction(commented, 'supabase/migrations/1.sql', sha256(commented)).startsWith('-- Intro'));
  assert.throws(() => migrationTransaction('/* unterminated ' + sql, 'supabase/migrations/1.sql', hash));
});

test('every real committed migration accepts atomic ledger insertion without changing its source hash', () => {
  const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', 'supabase/migrations'], { encoding: 'utf8', windowsHide: true }).trim().split('\n');
  assert(paths.length >= 26);
  for (const path of paths) {
    const sql = execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8', windowsHide: true });
    assert(migrationTransaction(sql, path, sha256(sql)).includes('insert into actv_release.migrations'), path);
  }
});

test('application secrets cannot point staging at production or round-trip masked platform values', () => {
  const values = { NEXT_PUBLIC_SUPABASE_URL: `https://${staging.supabaseProjectRef}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: syntheticKey('anon'), SUPABASE_SERVICE_ROLE_KEY: syntheticKey('service_role'), ACTV_PUBLIC_RACE_MODE: 'test',
    ACTV_LEGACY_WORDPRESS_ORIGIN: 'https://actv.mx', ACTV_STAFF_ORIGIN: staging.origin };
  assert.equal(validateAppEnvironment(values, staging), values);
  assert.throws(() => validateAppEnvironment({ ...values, NEXT_PUBLIC_SUPABASE_URL: `https://${production.supabaseProjectRef}.supabase.co` }, staging));
  assert.throws(() => validateAppEnvironment({ ...values, SUPABASE_SERVICE_ROLE_KEY: '********' }, staging));
  assert.throws(() => validateAppEnvironment({ ...values, ACTV_STRIPE_SECRET_KEY: 'sk_live_synthetic' }, staging));
  assert.throws(() => validateAppEnvironment({ ...values, ACTV_PUBLIC_RACE_MODE: 'live' }, staging));
  assert.throws(() => validateAppEnvironment({ ...values, NEXT_PUBLIC_SUPABASE_ANON_KEY: syntheticKey('service_role') }, staging));
  assert.throws(() => validateAppEnvironment({ ...values, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_' + 'x'.repeat(30) }, staging));
  assert.throws(() => validateAppEnvironment({ ...values, NEXT_PUBLIC_SUPABASE_ANON_KEY: syntheticKey('anon', production.supabaseProjectRef) }, staging));
  assert.throws(() => validateAppEnvironment({ ...values, ACTV_LEGACY_WORDPRESS_ORIGIN: 'https://other.invalid' }, staging));
  assert.throws(() => validateAppEnvironment({ ...values, ACTV_STAFF_ORIGIN: 'https://other.invalid' }, staging));
  assert.throws(() => validateAppEnvironment({ ...values, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_' + 'x'.repeat(30) }, staging));
  assert.throws(() => validateAppEnvironment({ ...values, ACTV_PUBLIC_RACE_MODE: 'test' }, production));
});

test('hosting uses exact prepared payload, secrets on stdin and saved intent; lost acknowledgment is not retried', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'actv-hosting-test-'));
  const put = (path, value) => { mkdirSync(join(temp, path, '..'), { recursive: true }); writeFileSync(join(temp, path), JSON.stringify(value)); };
  const output = join(temp, 'intent.json');
  const appEnvironment = { NEXT_PUBLIC_SUPABASE_URL: `https://${staging.supabaseProjectRef}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: syntheticKey('anon'), SUPABASE_SERVICE_ROLE_KEY: syntheticKey('service_role'), ACTV_PUBLIC_RACE_MODE: 'test',
    ACTV_LEGACY_WORDPRESS_ORIGIN: 'https://actv.mx', ACTV_STAFF_ORIGIN: staging.origin };
  const inputs = { packageDirectory: temp, backendReceipt: backend, output, appEnvironment };
  const requests = [];
  try {
    put('release-manifest.json', manifest); put('package-receipt.json', { manifestSha256: digest(manifest), identity: identityFor(manifest) });
    put('source/actv-release.json', manifest); put('source/lib/release-identity.generated.json', identityFor(manifest));
    const result = await deployHostinger({ ...inputs,
      runCommand: (_executable, args, options) => {
        requests.push(args);
        assert(!JSON.stringify(args).includes(appEnvironment.SUPABASE_SERVICE_ROLE_KEY));
        if (args.includes('list-builds')) return JSON.stringify({ data: [{ uuid: 'previous-build', state: 'completed' }] });
        assert.equal(JSON.parse(readFileSync(output)).releaseId, digest(manifest));
        if (args.includes('replace-environment-variables')) {
          assert(options.input.includes(appEnvironment.SUPABASE_SERVICE_ROLE_KEY));
          return '{}';
        }
        if (args[0] === 'up') return JSON.stringify({ data: { buildUuid: 'new-build' } });
        if (args.includes('build')) return JSON.stringify({ state: 'completed' });
        throw Error('Unexpected command');
      },
      fetcher: async url => url.endsWith('/api/version') ? Response.json(identityFor(manifest)) : new Response('<html/>', { headers: { 'Content-Type': 'text/html' } }),
    });
    assert.equal(result.hosting.buildId, 'new-build');
    assert.equal(JSON.parse(readFileSync(output)).status, 'observed');
    assert.equal(requests.filter(args => args[0] === 'up').length, 1);
    await assert.rejects(() => deployHostinger(inputs), /Existing deployment intent/);
    const ambiguous = join(temp, 'ambiguous.json');
    let submissions = 0;
    await assert.rejects(() => deployHostinger({ ...inputs, output: ambiguous, fetcher: async () => new Response(''), runCommand: (_exe, args) => {
      if (args.includes('list-builds')) return '{"data":[]}';
      submissions++; throw Error('lost acknowledgment with private raw response');
    } }), /raw output omitted/);
    assert.equal(submissions, 1);
    assert.equal(JSON.parse(readFileSync(ambiguous)).environmentUpdate, 'submitted_unknown');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('bounded smoke records actual running identity; never calls mutation routes', async () => {
  const visited = [];
  const receipt = await observeDeployment(manifest, backend, async (url, options) => {
    visited.push(url);
    assert.equal(options.redirect, 'error');
    return url.endsWith('/api/version') ? Response.json(identityFor(manifest)) : new Response('<html/>', { headers: { 'Content-Type': 'text/html' } });
  });
  assert.equal(receipt.status, 'observed');
  assert.equal(receipt.health.transactionalHealth, 'not_measured');
  assert.deepEqual(visited.map(url => new URL(url).pathname), ['/api/version', '/inicio', '/mi-actv', '/organizadores']);
  await assert.rejects(() => observeDeployment(manifest, backend, async () => Response.json({ ...identityFor(manifest), sourceSha: 'd'.repeat(40) })), /identity/);
  await assert.rejects(() => observeDeployment(manifest, { ...backend, supabaseProjectRef: production.supabaseProjectRef }), /backend/);
});

test('production requires exact staged manifest, target, W6 evidence, reviewers and recovery', async () => {
  const stageReceipt = await observeDeployment(manifest, backend, async url => url.endsWith('/api/version')
    ? Response.json(identityFor(manifest)) : new Response('<html/>', { headers: { 'Content-Type': 'text/html' } }));
  const prodManifest = { ...manifest, target: production };
  const approval = { format: 'actv-w6-approval-v1', sourceSha, productionTargetSha256: digest(production),
    stagingReceiptSha256: digest(stageReceipt), w6Status: 'accepted', newSalesPaused: true,
    backupReceiptSha256: hash, recoveryReceiptSha256: hash, engineeringReviewer: 'Engineer', operationsReviewer: 'Operator',
    scenarios: [{ id: 'G1-A', status: 'PASS', evidenceSha256: hash }] };
  assert.equal(validateProductionAcceptance(approval, prodManifest, stageReceipt, staging), approval);
  for (const patch of [{ sourceSha: 'd'.repeat(40) }, { productionTargetSha256: hash }, { w6Status: 'pending' },
    { newSalesPaused: false }, { backupReceiptSha256: null }, { operationsReviewer: 'Engineer' }, { scenarios: [] }]) {
    assert.throws(() => validateProductionAcceptance({ ...approval, ...patch }, prodManifest, stageReceipt, staging));
  }
  assert.throws(() => validateProductionAcceptance(approval, prodManifest, { ...stageReceipt, identity: { ...stageReceipt.identity, releaseId: hash } }, staging));
  const readiness = { capability_inventory_complete: true, named_owners: { engineering: 'Engineer', operations: 'Operator' }, acceptance_gate_default: 'W6',
    items: [{ id: 'G1', decision: { status: 'CLOSED' }, closure_evidence: ['reference'], acceptance: [{ id: 'G1-A' }, { id: 'G1-B', gate: 'W7' }] }] };
  validateW6Coverage(approval, readiness);
  assert.throws(() => validateW6Coverage(approval, { ...readiness, capability_inventory_complete: false }));
  assert.throws(() => validateW6Coverage({ ...approval, scenarios: [] }, readiness));
});

test('source packaging binds committed bytes and backend jobs; ignores untracked private files by refusing dirty source', () => {
  const temp = mkdtempSync(join(tmpdir(), 'actv-release-test-'));
  const repo = join(temp, 'repo'); mkdirSync(repo);
  const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
  const put = (path, content) => { mkdirSync(join(repo, path, '..'), { recursive: true }); writeFileSync(join(repo, path), content); };
  try {
    git(['init']); git(['config', 'user.email', 'synthetic@example.invalid']); git(['config', 'user.name', 'Synthetic test']);
    git(['remote', 'add', 'origin', 'https://github.com/jorgecantu276/actv-saas.git']);
    put('ops/source-candidate.json', JSON.stringify({ version: 'test', functions: ['actv-checkout'], configurationNames: ['ACTV_STRIPE_MODE'] }));
    put('supabase/migrations/1.sql', 'select 1;'); put('supabase/functions/actv-checkout/index.ts', '// synthetic');
    put('supabase/operations/schedule.sql', 'select 1;'); put('lib/release-identity.generated.json', '{}');
    git(['add', '.']); git(['commit', '-m', 'Synthetic release fixture']);
    const sha = git(['rev-parse', 'HEAD']);
    const result = prepareRelease({ cwd: repo, sourceSha: sha, target: staging, run: { ...run, head_sha: sha }, evidence: { ...evidence, sourceSha: sha }, output: join(temp, 'release') });
    const generated = JSON.parse(readFileSync(join(temp, 'release/source/lib/release-identity.generated.json')));
    const savedManifest = JSON.parse(readFileSync(join(temp, 'release/release-manifest.json')));
    assert.equal(generated.releaseId, result.manifestSha256);
    assert.equal(savedManifest.sourceTree, git(['rev-parse', 'HEAD^{tree}']));
    assert(savedManifest.inputs.some(row => row.path === 'supabase/operations/schedule.sql'));
    assert.equal(result.kind, 'source_payload_for_target_build');
    assert.equal(verifyPayload(join(temp, 'release/source'), savedManifest), true);
    writeFileSync(join(temp, 'release/source/supabase/migrations/1.sql'), 'select 2;');
    assert.throws(() => verifyPayload(join(temp, 'release/source'), savedManifest), /source bytes/);
    put('private-configuration.json', 'synthetic-private-marker');
    assert.throws(() => prepareRelease({ cwd: repo, sourceSha: sha, target: staging, run: { ...run, head_sha: sha }, evidence: { ...evidence, sourceSha: sha }, output: join(temp, 'refused') }), /clean/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
