import { body, handler, HttpError, operator, rpc, uuid } from '../_shared/http.ts';

export const kitEvidenceHandler = handler('actv-kit-evidence', async (request) => {
  const actor = await operator(request);
  const input = await body(request);
  if (!['reserve', 'finalize', 'status', 'view'].includes(String(input.action))) {
    throw new HttpError(400, 'invalid_request');
  }
  return await rpc('actv_kit_evidence', {
    p_operator: actor,
    p_registration: uuid(input.registration),
    p_request: input.action === 'view' ? null : uuid(input.request),
    p_action: input.action,
  });
}, true);
if (import.meta.main) Deno.serve(kitEvidenceHandler);
