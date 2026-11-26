// Actual handlers use only the owned local Auth/PostgREST/Storage stack.
import assert from 'node:assert/strict';
import { kitEvidenceHandler } from '../../supabase/functions/actv-kit-evidence/index.ts';
import { evidenceCleanupHandler } from '../../supabase/functions/actv-evidence-cleanup/index.ts';
const input = JSON.parse(await new Response(Deno.stdin.readable).text());
const api = new URL(input.apiUrl);
assert.equal(api.hostname, '127.0.0.1');
for (const [name, value] of Object.entries({ SUPABASE_URL: api.origin,
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: input.serviceKey }),
  ACTV_EVIDENCE_CLEANUP_SECRET: 'synthetic-cleanup-secret-at-least-32-characters',
  ACTV_STRIPE_MODE: 'test', ACTV_APP_URL: 'http://127.0.0.1:3000' })) Deno.env.set(name, String(value));
const original = globalThis.fetch;
globalThis.fetch = (request, init) => {
  assert.equal(new URL(request instanceof Request ? request.url : String(request)).origin, api.origin);
  return original(request, init);
};
const call = (token: string | null, action: string) => kitEvidenceHandler(new Request(api.origin + '/evidence', {
  method: 'POST', headers: token ? { authorization: 'Bearer ' + token } : {},
  body: JSON.stringify({ action, registration: input.registration, request: input.request }),
}));
assert.equal((await call(null, 'reserve')).status, 401);
for (const action of ['reserve', 'status', 'finalize', 'view']) {
  assert.equal((await call(input.deniedToken, action)).status, 403);
}
if (input.allowedToken) assert.equal((await call(input.allowedToken, 'status')).status, 200);
assert.equal((await evidenceCleanupHandler(new Request(api.origin + '/cleanup', { method: 'POST' }))).status, 401);
console.log(JSON.stringify({ authorizationAssertions: input.allowedToken ? 7 : 6 }));
