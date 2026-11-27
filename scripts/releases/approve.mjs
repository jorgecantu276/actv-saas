import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProductionAcceptance, validateW6Coverage } from './contract.mjs';
import { argsToObject } from './package.mjs';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = argsToObject(process.argv.slice(2));
    if (Object.keys(options).sort().join(',') !== 'approval,manifest,readiness,staging-receipt,staging-target') throw Error('Missing approval inputs');
    const read = path => JSON.parse(readFileSync(path));
    const manifest = read(options.manifest), approval = read(options.approval);
    if (manifest.target.environment !== 'production') throw Error('Production manifest required');
    validateProductionAcceptance(approval, manifest, read(options['staging-receipt']), read(options['staging-target']));
    validateW6Coverage(approval, read(options.readiness));
    console.log(JSON.stringify({ releaseApproval: 'accepted', sourceSha: manifest.sourceSha, newSales: 'remain_paused_until_W7' }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
