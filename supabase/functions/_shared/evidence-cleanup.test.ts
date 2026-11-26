import { cleanupEvidence, type EvidenceClaim, sameSecret } from './evidence-cleanup.ts';
function assert(value: unknown) { if (!value) throw new Error('assertion failed'); }
const claim: EvidenceClaim = { id: 'evidence', path: 'private.jpg', lease: 'lease' };
Deno.test('cleanup persists API failures and uncertain response instead of clearing references', async () => {
  for (const kind of ['error', 'lost']) {
    let next = true;
    const finished: (string | null)[] = [];
    const result = await cleanupEvidence({ claim: async () => next ? (next = false, claim) : null,
      remove: async () => { if (kind === 'lost') throw new Error('network'); return false; },
      finish: async (_claim, error) => { finished.push(error); } });
    assert(result.failed === 1 && result.removed === 0 && finished[0]?.startsWith('storage_delete_'));
  }
});
Deno.test('cleanup stops on durable finish failure, leaving lease for reconciliation', async () => {
  let removes = 0, rejected = false;
  try { await cleanupEvidence({ claim: async () => claim, remove: async () => { removes++; return true; },
    finish: async () => { throw new Error('database response lost'); } }); } catch { rejected = true; }
  assert(rejected && removes === 1);
});
Deno.test('cleanup is bounded and rejects absent, short, and wrong dedicated secrets', async () => {
  let count = 0;
  await cleanupEvidence({ claim: async () => claim, remove: async () => true,
    finish: async () => { count++; } }, 3);
  assert(count === 3 && !sameSecret('', '') && !sameSecret('a'.repeat(32), 'b'.repeat(32)) && sameSecret('a'.repeat(32), 'a'.repeat(32)));
});
