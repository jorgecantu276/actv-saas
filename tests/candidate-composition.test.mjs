import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
const root = new URL('../', import.meta.url);

test('supported migration set is explicit and retains shared provider dependencies', () => {
  const manifest = JSON.parse(readFileSync(new URL('ops/source-candidate.json', root)));
  const actual = readdirSync(new URL('supabase/migrations/', root)).filter(file => file.endsWith('.sql')).sort();
  assert.deepEqual(manifest.migrations, actual);
  assert(actual.some(file => file.startsWith('20261114011400')));
  assert(actual.some(file => file.startsWith('20261114011500')));
  assert(actual.some(file => file.startsWith('20261114011900')));
  assert.equal(manifest.productionQualified, false);
});

test('new-store and timing experiments are not part of the supported candidate', () => {
  for (const path of ['app/_tienda', 'lib/sandbox-store-stripe.ts', 'public/tienda',
    'app/mi-actv/runner-results.tsx', 'app/organizadores/results-import.tsx',
    'supabase/migrations/20261114011700_actv_timing_results.sql',
    'supabase/migrations/20261114011800_actv_organizer_timing.sql']) {
    assert.equal(existsSync(new URL(path, root)), false, path);
  }
});
