// Real local Auth + PostgREST authorization, actual Terminal handler. No provider access.
import assert from 'node:assert/strict';
import { terminalHandler } from '../../supabase/functions/actv-stripe-terminal/index.ts';

const chunks = [];
for await (const chunk of Deno.stdin.readable) chunks.push(chunk);
const total = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
let position = 0;
for (const chunk of chunks) { total.set(chunk, position); position += chunk.length; }
const input = JSON.parse(new TextDecoder().decode(total));
const api = new URL(input.apiUrl);
assert.equal(api.hostname, '127.0.0.1');
for (const [key, value] of Object.entries({ SUPABASE_URL: api.origin,
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: input.serviceKey }),
  ACTV_STRIPE_MODE: 'test', ACTV_STRIPE_SECRET_KEY: 'sk_test_synthetic_staff_edge_fixture',
  ACTV_APP_URL: 'http://127.0.0.1:3000' })) Deno.env.set(key, value);
const originalFetch = globalThis.fetch;
let externalProviderRequests = 0;
globalThis.fetch = (request, init) => {
  const address = new URL(request instanceof Request ? request.url : String(request));
  if (address.origin !== api.origin) {
    externalProviderRequests++;
    throw Error('A revoked staff request must not contact a provider');
  }
  return originalFetch(request, init);
};
const deniedActions = [];
for (const action of ['start', 'retry', 'status', 'cancel']) {
  const response = await terminalHandler(new Request('http://127.0.0.1/terminal', {
    method: 'POST', headers: { authorization: 'Bearer ' + input.token },
    body: JSON.stringify({ action, orderId: input.orderId }),
  }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'access_denied');
  deniedActions.push(action);
}
assert.equal(externalProviderRequests, 0);
console.log(JSON.stringify({ deniedActions, externalProviderRequests }));
