// One source-candidate check. Only a newly created synthetic container is writable.
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactDirectory = join(root, '.verification');
mkdirSync(artifactDirectory, { recursive: true });
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(?:ACTV_|SUPABASE_|NEXT_PUBLIC_|STRIPE_|HOSTINGER_)/i.test(key)));
Object.assign(environment, {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'build-validation-placeholder',
  SUPABASE_SERVICE_ROLE_KEY: 'build-validation-placeholder',
  NEXT_TELEMETRY_DISABLED: '1', ACTV_STRIPE_MODE: 'test',
});
const sync = (bin, args) => execFileSync(bin, args, {
  cwd: root, env: environment, encoding: 'utf8', windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
}).trim();
const node = process.execPath;
const denoArgs = [join(root, 'node_modules/deno/bin.cjs')];
const check = { startedAt: new Date().toISOString(), sourceSha: sync('git', ['rev-parse', 'HEAD']),
  dirtySource: Boolean(sync('git', ['status', '--porcelain'])),
  scope: 'source_candidate_synthetic_only', productionQualified: false, steps: [] };
let containerId;
const containerName = 'actv-verify-' + randomUUID();

async function run(name, bin, args) {
  console.log(`\n[verify] ${name}`);
  const step = { name, status: 'running', startedAt: new Date().toISOString() };
  check.steps.push(step);
  await new Promise((done, fail) => {
    const child = spawn(bin, args, { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let log = '';
    child.stdout.on('data', data => { process.stdout.write(data); log += data; });
    child.stderr.on('data', data => { process.stderr.write(data); log += data; });
    child.on('error', error => { step.status = 'failed'; fail(error); });
    child.on('close', code => {
      step.status = code === 0 ? 'passed' : 'failed';
      step.finishedAt = new Date().toISOString();
      writeFileSync(join(artifactDirectory, name + '.log'), log);
      if (code === 0) done(); else fail(Error(`${name} failed (${code})`));
    });
  });
}

function digests(directory) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const path = directory + '/' + entry.name;
    return entry.isDirectory() ? digests(path) : [{ path, sha256: createHash('sha256').update(readFileSync(join(root, path))).digest('hex') }];
  });
}

try {
  await run('lint', node, ['node_modules/eslint/bin/eslint.js', '.']);
  await run('unit', node, ['--test', 'ops/tests/status.test.mjs', 'tests/runner-history.test.mjs', 'tests/legacy-store.test.mjs', 'tests/candidate-composition.test.mjs', 'tests/staff-provisioning.test.mjs', 'tests/staging-bindings.test.mjs', 'tests/release-delivery.test.mjs']);
  await run('record', node, ['ops/status.mjs', '--check']);
  await run('types', node, ['node_modules/typescript/bin/tsc', '--noEmit']);
  await run('build', node, ['node_modules/next/dist/bin/next', 'build', '--webpack']);
  await run('edge-unit', node, [...denoArgs, 'test', '--allow-env', '--config', 'supabase/functions/deno.json', 'supabase/functions']);
  containerId = sync('docker', ['run', '-d', '--name', containerName, '--label', `codex.actv.verify=${containerName}`,
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=actv_payment_staging',
    '-p', '127.0.0.1::5432', 'postgres:17', 'postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off']);
  check.postgresImage = sync('docker', ['inspect', '--format', '{{.Image}}', containerId]);
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { sync('docker', ['exec', containerId, 'pg_isready', '-U', 'postgres', '-d', 'actv_payment_staging']); ready = true; break; }
    catch { await new Promise(done => setTimeout(done, 1000)); }
  }
  if (!ready) throw Error('New disposable PostgreSQL did not become ready');
  const binding = sync('docker', ['port', containerId, '5432/tcp']);
  if (!/^127\.0\.0\.1:\d+$/.test(binding)) throw Error('Staging port must be loopback-only');
  const port = binding.split(':')[1];
  environment.ACTV_STAGING_DB = `postgresql://postgres@127.0.0.1:${port}/actv_payment_staging`;
  await run('financial-sql', node, ['tests/staging-payments.mjs']);
  await run('edge-postgres', node, [...denoArgs, 'run', '--allow-env', `--allow-net=127.0.0.1:${port}`,
    '--config', 'supabase/functions/deno.json', 'tests/staging-edge.ts']);
  await run('portal-contracts', node, ['tests/portal-contracts.mjs']);
  await run('full-staging', node, ['scripts/full-staging.mjs']);
  check.fullStagingEvidenceSha256 = createHash('sha256').update(readFileSync(join(artifactDirectory, 'full-staging.json'))).digest('hex');
  check.baselineCatalogSha256 = createHash('sha256').update(readFileSync(join(root, 'tests/staging/baseline-catalog.json'))).digest('hex');
  check.inputs = [...digests('supabase/migrations'), ...digests('supabase/functions')];
  check.buildId = readFileSync(join(root, '.next/BUILD_ID'), 'utf8').trim();
  check.buildManifestSha256 = createHash('sha256').update(readFileSync(join(root, '.next/server/app-paths-manifest.json'))).digest('hex');
  check.configurationMode = 'synthetic_test';
  check.hostedEvidence = null; check.deviceEvidence = null;
  check.status = 'passed';
} catch (error) {
  check.status = 'failed'; check.failure = error.message;
  console.error(error.message); process.exitCode = 1;
} finally {
  if (containerId) {
    try {
      const label = sync('docker', ['inspect', '--format', '{{index .Config.Labels "codex.actv.verify"}}', containerId]);
      if (label !== containerName) throw Error('Synthetic-container ownership mismatch');
      sync('docker', ['rm', '-f', containerId]);
    } catch (error) { check.cleanupFailure = error.message; process.exitCode = 1; }
  }
  check.finishedAt = new Date().toISOString();
  writeFileSync(join(artifactDirectory, 'evidence-index.json'), JSON.stringify(check, null, 2) + '\n');
}
