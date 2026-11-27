import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, identityFor, validateBackendReceipt, validateTarget } from './contract.mjs';
import { argsToObject } from './package.mjs';

export async function observeDeployment(manifest, backendReceipt, fetcher = fetch) {
  validateTarget(manifest.target);
  validateBackendReceipt(backendReceipt, manifest);
  const identity = identityFor(manifest);
  const response = await fetcher(manifest.target.origin + '/api/version', { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok || digest(await response.json()) !== digest(identity)) throw Error('Running release identity differs');
  for (const path of ['/inicio', '/mi-actv', '/organizadores']) {
    const page = await fetcher(manifest.target.origin + path, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!page.ok || !page.headers.get('content-type')?.includes('text/html')) throw Error(`Release route unavailable: ${path}`);
    // Keep the request bounded. No signin, new sale, email, provider or device action.
    await page.body?.cancel();
  }
  return { format: 'actv-deployment-receipt-v1', status: 'observed', observedAt: new Date().toISOString(),
    identity, target: manifest.target, backendReceiptSha256: digest(backendReceipt),
    health: { version: 'passed', routes: 'passed', scope: 'bounded_read_only_smoke',
      transactionalHealth: 'not_measured', loadAcceptance: 'not_measured' }, productionQualified: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = argsToObject(process.argv.slice(2));
    if (Object.keys(args).sort().join(',') !== 'backend-receipt,manifest,output') throw Error('Required: --manifest --backend-receipt --output');
    const result = await observeDeployment(JSON.parse(readFileSync(args.manifest)), JSON.parse(readFileSync(args['backend-receipt'])));
    writeFileSync(args.output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ status: result.status, sourceSha: result.identity.sourceSha, releaseId: result.identity.releaseId }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
