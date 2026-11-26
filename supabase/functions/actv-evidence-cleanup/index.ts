import { db, env, handler, HttpError, rpc } from '../_shared/http.ts';
import { cleanupEvidence, type EvidenceClaim, sameSecret } from '../_shared/evidence-cleanup.ts';

export const evidenceCleanupHandler = handler('actv-evidence-cleanup', async (request) => {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!sameSecret(token, env('ACTV_EVIDENCE_CLEANUP_SECRET'))) throw new HttpError(401, 'cleanup_authorization_required');
  return await cleanupEvidence({
    claim: () => rpc<EvidenceClaim | null>('actv_evidence_claim_cleanup', {}),
    remove: async (path) => {
      const { error } = await db().storage.from('evidencias_kits').remove([path]);
      return !error;
    },
    finish: (claim, error) => rpc<void>('actv_evidence_finish_cleanup', {
      p_evidence: claim.id, p_lease: claim.lease, p_error: error,
    }),
  });
});
if (import.meta.main) Deno.serve(evidenceCleanupHandler);
