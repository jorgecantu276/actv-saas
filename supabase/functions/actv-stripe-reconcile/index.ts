import { body, env, handler, HttpError, liveMode, rpc } from '../_shared/http.ts';
import type { Order } from '../_shared/orders.ts';
import {
  completeEvent,
  noteFailedEvent,
  type StoredEvent,
  syncPendingOrder,
} from '../_shared/stripe-events.ts';
import { stripeClient, stripeErrorCode } from '../_shared/stripe.ts';

async function matchesWorkerSecret(request: Request): Promise<boolean> {
  const supplied = request.headers.get('x-actv-reconcile-secret');
  const expected = env('ACTV_STRIPE_RECONCILE_SECRET');
  if (expected.length < 32) throw new HttpError(503, 'payment_configuration_required');
  if (!supplied || supplied.length > 512) return false;
  const encoder = new TextEncoder();
  const [first, second] = await Promise.all(
    [supplied, expected].map(async (value) =>
      new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
    ),
  );
  let result = 0;
  for (let index = 0; index < first.length; index++) result |= first[index] ^ second[index];
  return result === 0;
}

export const reconciliationHandler = handler('actv-stripe-reconcile', async (request) => {
  if (!await matchesWorkerSecret(request)) throw new HttpError(401, 'worker_secret_required');
  const input = await body(request);
  const limit = input.limit ?? 10;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new HttpError(400, 'invalid_limit');
  }
  const stripe = stripeClient();
  await rpc('actv_close_unbound_terminals', { p_live_mode: liveMode() });
  const pending = await rpc<{ events: StoredEvent[]; orders: Order[] }>('actv_pending_stripe', {
    p_live_mode: liveMode(),
    p_limit: limit,
  });
  const result = {
    events: { attempted: 0, failed: 0 },
    orders: { attempted: 0, failed: 0 },
    timeBudgetExceeded: false,
  };
  const deadline = Date.now() + 18_000;
  const work = [
    ...pending.events.map((record) => ({
      category: 'events' as const,
      record,
      run: () => completeEvent(stripe, record),
    })),
    ...pending.orders.map((order) => ({
      category: 'orders' as const,
      record: null,
      run: () => syncPendingOrder(stripe, order),
    })),
  ];
  for (const workItem of work) {
    if (Date.now() >= deadline) {
      result.timeBudgetExceeded = true;
      break;
    }
    result[workItem.category].attempted++;
    try {
      await workItem.run();
    } catch (error) {
      result[workItem.category].failed++;
      const code = stripeErrorCode(error);
      console.error(
        JSON.stringify({ component: 'actv-stripe-reconcile', category: workItem.category, code }),
      );
      if (workItem.record) await noteFailedEvent(workItem.record, code);
    }
  }
  return result;
});

export default { fetch: reconciliationHandler };
