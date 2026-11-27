import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, identityFor, sha256, validateBackendReceipt, validateProductionAcceptance, validateTarget, validateW6Coverage } from './contract.mjs';
import { argsToObject } from './package.mjs';
import { observeDeployment } from './probe.mjs';
import { verifyPayload } from './payload.mjs';

export function validateAppEnvironment(values, target) {
  const permitted = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
    'ACTV_LEGACY_WORDPRESS_ORIGIN', 'ACTV_PUBLIC_RACE_MODE', 'ACTV_STAFF_ORIGIN', 'NEXT_TELEMETRY_DISABLED'];
  if (!values || Object.keys(values).some(key => !permitted.includes(key)) ||
    values.NEXT_PUBLIC_SUPABASE_URL !== `https://${target.supabaseProjectRef}.supabase.co` ||
    !values.NEXT_PUBLIC_SUPABASE_ANON_KEY || !values.SUPABASE_SERVICE_ROLE_KEY || values.ACTV_PUBLIC_RACE_MODE !== target.stripeMode ||
    Object.values(values).some(value => typeof value !== 'string' || /[\r\n\0]/.test(value) || value === '********')) {
    throw Error('Full, real target-bound application configuration is required');
  }
  const publicKey = values.NEXT_PUBLIC_SUPABASE_ANON_KEY, serverKey = values.SUPABASE_SERVICE_ROLE_KEY;
  const legacyRole = (key, role) => {
    try {
      const segments = key.split('.');
      if (segments.length !== 3) return false;
      const claims = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
      return claims.role === role && claims.ref === target.supabaseProjectRef;
    } catch { return false; }
  };
  if (publicKey === serverKey || !(/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(publicKey) || legacyRole(publicKey, 'anon')) ||
    !(/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(serverKey) || legacyRole(serverKey, 'service_role'))) {
    throw Error('Public/server Supabase credential roles or backend identity differ');
  }
  if (digest({ supabaseAnonKeySha256: sha256(publicKey), publicRaceMode: values.ACTV_PUBLIC_RACE_MODE,
    wordpressOrigin: values.ACTV_LEGACY_WORDPRESS_ORIGIN, staffOrigin: values.ACTV_STAFF_ORIGIN }) !== digest(target.configuration)) {
    throw Error('Public application configuration differs from reviewed release binding');
  }
  return values;
}

export async function deployHostinger({ packageDirectory, backendReceipt, output, appEnvironment,
  approval, stagingReceipt, stagingTarget, readiness, executable = 'hostinger', environment = process.env,
  runCommand = execFileSync, fetcher = fetch }) {
  const read = name => JSON.parse(readFileSync(join(packageDirectory, name), 'utf8'));
  const manifest = read('release-manifest.json');
  const packageReceipt = read('package-receipt.json');
  validateTarget(manifest.target); validateBackendReceipt(backendReceipt, manifest);
  verifyPayload(join(packageDirectory, 'source'), manifest);
  if (packageReceipt.manifestSha256 !== digest(manifest) || digest(packageReceipt.identity) !== digest(identityFor(manifest)) ||
    digest(read('source/actv-release.json')) !== digest(manifest) ||
    digest(read('source/lib/release-identity.generated.json')) !== digest(identityFor(manifest))) throw Error('Package identity mismatch');
  validateAppEnvironment(appEnvironment, manifest.target);
  if (manifest.target.environment === 'production') {
    validateProductionAcceptance(approval, manifest, stagingReceipt, stagingTarget);
    validateW6Coverage(approval, readiness);
  }
  if (existsSync(output)) throw Error('Existing deployment intent must be reconciled; do not resubmit');
  for (const [path, key] of [['/auth/v1/settings', appEnvironment.NEXT_PUBLIC_SUPABASE_ANON_KEY],
    ['/auth/v1/admin/users?page=1&per_page=1', appEnvironment.SUPABASE_SERVICE_ROLE_KEY]]) {
    const check = await fetcher(appEnvironment.NEXT_PUBLIC_SUPABASE_URL + path, {
      headers: { apikey: key, Authorization: 'Bearer ' + key }, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!check.ok) throw Error('Supabase configuration failed read-only target/credential verification');
    await check.body?.cancel();
  }
  const domain = new URL(manifest.target.origin).hostname;
  // Keep provider secrets out of CLI argv, raw logs and uploaded source. The
  // platform masks its read API, so never round-trip those masked values.
  const invoke = (args, input) => {
    try { return JSON.parse(runCommand(executable, [...args, '--format', 'json', '--no-input'], {
      env: environment, cwd: packageDirectory, input, encoding: 'utf8', windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'], timeout: 180000, maxBuffer: 4 * 1024 * 1024,
    })); } catch { throw Error('Hosting operation failed or lost acknowledgment; inspect the saved intent before retrying (raw output omitted)'); }
  };
  const before = invoke(['hosting', 'nodejs', 'list-builds', domain, '--per-page', '100']);
  const priorBuilds = before.data;
  if (!Array.isArray(priorBuilds)) throw Error('Hosting build inventory unavailable');
  const prior = priorBuilds.filter(build => build.state === 'completed')[0];
  const intent = { format: 'actv-hosting-intent-v1', sourceSha: manifest.sourceSha, releaseId: digest(manifest),
    target: manifest.target, startedAt: new Date().toISOString(), previousBuildId: prior?.uuid ?? null,
    status: 'started', environmentUpdate: 'not_submitted', buildSubmission: 'not_submitted' };
  writeFileSync(output, JSON.stringify(intent, null, 2) + '\n', { flag: 'wx' });
  const save = () => writeFileSync(output, JSON.stringify(intent, null, 2) + '\n');
  intent.environmentUpdate = 'submitted_unknown'; save();
  invoke(['hosting', 'nodejs', 'replace-environment-variables', domain, '--env-vars', '-'],
    JSON.stringify(Object.entries(appEnvironment).map(([key, value]) => ({ key, value }))));
  intent.environmentUpdate = 'acknowledged'; intent.buildSubmission = 'submitted_unknown'; save();
  const started = invoke(['up', join(packageDirectory, 'source'), '--domain', domain, '--type', 'nodejs', '--source', 'upload',
    '--app-type', 'next', '--node-version', String(manifest.target.nodeMajor), '--output-directory', '.next',
    '--package-manager', 'npm', '--build-script', 'build', '--yes', '--no-wait']);
  intent.buildSubmission = 'acknowledged';
  // The uploaded overlay contains the release identity; wait for the actual
  // deployment, never guess success from an accepted upload.
  const responseId = started.data?.build?.uuid ?? started.data?.buildUuid ?? started.data?.build_uuid ?? started.data?.build?.id;
  if (typeof responseId !== 'string') { save(); throw Error('Hosting acknowledged without a usable build ID; reconcile saved intent'); }
  intent.buildId = responseId; save();
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    const build = invoke(['hosting', 'nodejs', 'build', domain, intent.buildId]);
    if (build.state === 'failed') { intent.status = 'failed'; save(); throw Error('Hosting build failed; prior build retained for compatible recovery'); }
    if (build.state === 'completed') { intent.status = 'built'; save(); break; }
    console.log('Waiting for exact hosting build: ' + build.state);
    await new Promise(done => setTimeout(done, 10000));
  }
  if (intent.status !== 'built') throw Error('Build observation timed out; reconcile saved intent instead of redeploying');
  // CDN propagation is bounded and read-only. No deployment or money operation
  // is retried when a response is lost.
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const observation = await observeDeployment(manifest, backendReceipt, fetcher);
      intent.status = 'observed'; intent.observation = observation; save();
      return { ...observation, hosting: { provider: 'hostinger', buildId: intent.buildId, previousBuildId: intent.previousBuildId } };
    } catch {
      if (attempt === 11) throw Error('Built application failed version/route observation; inspect receipt and use compatible recovery');
      await new Promise(done => setTimeout(done, 5000));
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = argsToObject(process.argv.slice(2));
    const allowed = ['package', 'backend-receipt', 'output', 'approval', 'staging-receipt', 'staging-target', 'readiness'];
    if (Object.keys(args).some(key => !allowed.includes(key)) || !args.package || !args['backend-receipt'] || !args.output) throw Error('Missing deployment inputs');
    const read = name => args[name] ? JSON.parse(readFileSync(args[name], 'utf8')) : undefined;
    const result = await deployHostinger({ packageDirectory: resolve(args.package), backendReceipt: read('backend-receipt'), output: args.output,
      appEnvironment: JSON.parse(process.env.ACTV_APP_ENV_JSON ?? 'null'), approval: read('approval'), stagingReceipt: read('staging-receipt'),
      stagingTarget: read('staging-target'), readiness: read('readiness'), executable: process.env.HOSTINGER_EXECUTABLE ?? 'hostinger' });
    writeFileSync(args.output + '.observed.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ status: result.status, sourceSha: result.identity.sourceSha, releaseId: result.identity.releaseId, buildId: result.hosting.buildId }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
