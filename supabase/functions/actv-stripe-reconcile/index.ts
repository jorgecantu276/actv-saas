import { body, env, handler, HttpError, liveMode, rpc } from '../_shared/http.ts';
import type { Order } from '../_shared/orders.ts';
import { claimRefundRecovery, noteRefundRecovery, recoverAdminRefund } from '../_shared/refund-recovery.ts';
import { recoverParticipantRefunds } from '../_shared/participant-refunds.ts';
import { acknowledgeEvent, applyEvent, type EventRetry, syncPendingOrder } from '../_shared/stripe-events.ts';
import { type Stripe, stripeClient, stripeErrorCode } from '../_shared/stripe.ts';

async function retryEvent(stripe: Stripe, mode: boolean, count: { attempted: number; failed: number }) {
  const event = await rpc<EventRetry | null>('actv_claim_stripe_event_retry', { p_live_mode: mode });
  if (!event) return false;
  count.attempted++;
  let failure: string | null = null;
  try {
    await applyEvent(stripe, event);
  } catch (error) {
    failure = stripeErrorCode(error);
  }
  // A direct webhook can complete the event while a worker holds this lease.
  const acknowledged = await acknowledgeEvent(event, failure);
  if (failure && acknowledged) {
    count.failed++;
    console.error(JSON.stringify({ component: 'actv-stripe-reconcile', category: 'events', code: failure }));
  }
  return true;
}

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
  const mode = liveMode();
  await rpc('actv_close_unbound_terminals', { p_live_mode: mode });
  const orders = await rpc<Order[]>('actv_pending_stripe_orders', {
    p_live_mode: mode,
    p_limit: limit,
  });
  const result = {
    events: { attempted: 0, failed: 0 },
    orders: { attempted: 0, failed: 0 },
    refunds: { attempted: 0, failed: 0, notFound: 0 },
    timeBudgetExceeded: false,
  };
  const deadline = Date.now() + 18_000;
  const hasTime = () => {
    if (Date.now() < deadline) return true;
    result.timeBudgetExceeded = true;
    return false;
  };
  let moreEvents = hasTime() && await retryEvent(stripe, mode, result.events);
  const refunds = hasTime() ? await claimRefundRecovery(mode, limit) : [];
  for (const refund of refunds) {
    if (!hasTime()) break;
    result.refunds.attempted++;
    try {
      if (!(await recoverAdminRefund(stripe, refund, mode))) {
        result.refunds.notFound++;
        await noteRefundRecovery(refund, 'refund_not_found');
      }
    } catch (error) {
      result.refunds.failed++;
      const code = stripeErrorCode(error);
      console.error(JSON.stringify({ component: 'actv-stripe-reconcile', category: 'refunds', code }));
      await noteRefundRecovery(refund, code);
    }
  }
  while (moreEvents && result.events.attempted < limit && hasTime()) {
    moreEvents = await retryEvent(stripe, mode, result.events);
  }
  for (const order of orders) {
    if (!hasTime()) break;
    result.orders.attempted++;
    try {
      await syncPendingOrder(stripe, order);
    } catch (error) {
      result.orders.failed++;
      console.error(
        JSON.stringify({
          component: 'actv-stripe-reconcile',
          category: 'orders',
          code: stripeErrorCode(error),
        }),
      );
    }
  }
  if (hasTime()) {
    const participant = await recoverParticipantRefunds(stripe, mode, limit, deadline);
    result.refunds.attempted += participant.attempted;
    result.refunds.failed += participant.failed;
  }
  return result;
});

export default { fetch: reconciliationHandler };
