import Stripe from 'npm:stripe@23.1.0';
import { env, HttpError, liveMode, rpc } from './http.ts';
import type { Order } from './orders.ts';

export { Stripe };

export function stripeClient(): Stripe {
  const key = env('ACTV_STRIPE_SECRET_KEY');
  const expected = liveMode() ? 'live' : 'test';
  if (!key.startsWith(`sk_${expected}_`) && !key.startsWith(`rk_${expected}_`)) {
    throw new HttpError(503, 'payment_configuration_required');
  }
  return new Stripe(key, {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 1,
    timeout: 8_000,
  });
}

export function stripeOptions(account: string, idempotencyKey?: string): Stripe.RequestOptions {
  return idempotencyKey ? { stripeAccount: account, idempotencyKey } : { stripeAccount: account };
}

export function objectId(value: string | { id: string } | null | undefined): string | null {
  return typeof value === 'string' ? value : value?.id ?? null;
}

export const orderMetadata = (order: Order) => ({
  actv_order_id: order.order_id,
  actv_channel: order.channel,
});

export const providerOrderId = (metadata: Stripe.Metadata | null, channel: 'online' | 'terminal') =>
  metadata?.actv_channel === channel &&
    /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(metadata.actv_order_id)
    ? metadata.actv_order_id
    : null;

export function stripeRedirect(
  value: string,
  hostname: 'checkout.stripe.com' | 'connect.stripe.com',
): string {
  const url = new URL(value);
  if (url.origin !== `https://${hostname}` || url.username || url.password) {
    throw new HttpError(409, 'provider_redirect_mismatch');
  }
  return url.href;
}

export function attachProvider(
  order: Order,
  account: string,
  sessionId: string | null,
  paymentId: string | null,
) {
  return rpc<Order>('actv_attach_provider', {
    p_order_id: order.order_id,
    p_account_id: account,
    p_live_mode: order.live_mode,
    p_session_id: sessionId,
    p_payment_id: paymentId,
  });
}

function closeOrder(account: string, orderId: string, sessionId: string | null, paymentId: string | null) {
  return rpc<Order>('actv_mark_closed', {
    p_order_id: orderId,
    p_account_id: account,
    p_live_mode: liveMode(),
    p_session_id: sessionId,
    p_payment_id: paymentId,
  });
}

async function boundOrder(account: string, orderId: string, channel: 'online' | 'terminal', object: string) {
  const order = await rpc<Order | null>('actv_read_order', { p_order_id: orderId });
  return !!order && order.account_id === account && order.live_mode === liveMode() &&
    order.channel === channel &&
    (channel === 'online' ? order.provider_session_id : order.provider_payment_id) === object;
}

export function captureProof(
  intent: Stripe.PaymentIntent,
  channel: 'online' | 'terminal',
  expectedMode: boolean,
) {
  const orderId = providerOrderId(intent.metadata, channel);
  if (!orderId) return null;
  if (intent.livemode !== expectedMode) throw new HttpError(409, 'payment_mode_mismatch');
  if (intent.status !== 'succeeded') return null;

  const charge = intent.latest_charge;
  const method = channel === 'terminal' ? 'card_present' : 'card';
  if (
    !charge || typeof charge === 'string' || !charge.captured || !charge.paid ||
    charge.livemode !== expectedMode ||
    objectId(charge.payment_intent) !== intent.id || intent.currency !== 'mxn' ||
    charge.currency !== intent.currency ||
    charge.payment_method_details?.type !== method || !Number.isSafeInteger(intent.amount_received) ||
    intent.amount_received <= 0 || intent.amount !== intent.amount_received ||
    charge.amount_captured !== intent.amount_received
  ) {
    throw new HttpError(409, 'provider_capture_mismatch');
  }
  return { orderId, chargeId: charge.id, amount: intent.amount_received, currency: intent.currency };
}

export function recordAdjustment(
  account: string,
  object: Stripe.Refund | Stripe.Dispute,
  kind: 'refund' | 'dispute',
) {
  const paymentId = objectId(object.payment_intent);
  if (!paymentId || object.currency !== 'mxn') return;
  if (!object.status) throw new HttpError(503, 'provider_adjustment_pending');
  if ('livemode' in object && typeof object.livemode === 'boolean' && object.livemode !== liveMode()) {
    throw new HttpError(409, 'payment_mode_mismatch');
  }
  return rpc('actv_record_adjustment', {
    p_account_id: account,
    p_live_mode: liveMode(),
    p_reference: object.id,
    p_kind: kind,
    p_payment_id: paymentId,
    p_amount: object.amount,
    p_currency: object.currency,
    p_state: object.status,
  });
}

async function confirmCapture(
  stripe: Stripe,
  account: string,
  intent: Stripe.PaymentIntent,
  channel: 'online' | 'terminal',
  sessionId: string | null,
) {
  const proof = captureProof(intent, channel, liveMode());
  if (!proof) return null;
  const charge = intent.latest_charge as Stripe.Charge;
  const options = stripeOptions(account);
  if (charge.refunded || charge.amount_refunded > 0) {
    let confirmedTotal = 0;
    for await (const refund of stripe.refunds.list({ charge: charge.id, limit: 100 }, options)) {
      if (objectId(refund.payment_intent) !== intent.id) {
        throw new HttpError(409, 'adjustment_payment_unavailable');
      }
      await recordAdjustment(account, refund, 'refund');
      if (refund.status === 'succeeded') confirmedTotal += refund.amount;
    }
    if (confirmedTotal < charge.amount_refunded) throw new HttpError(503, 'provider_adjustment_pending');
  }
  if (charge.disputed) {
    let found = false;
    for await (const dispute of stripe.disputes.list({ charge: charge.id, limit: 100 }, options)) {
      if (objectId(dispute.payment_intent) !== intent.id) {
        throw new HttpError(409, 'adjustment_payment_unavailable');
      }
      await recordAdjustment(account, dispute, 'dispute');
      found = true;
    }
    if (!found) throw new HttpError(503, 'provider_adjustment_pending');
  }
  return await rpc<Order>('actv_confirm_stripe', {
    p_order_id: proof.orderId,
    p_account_id: account,
    p_live_mode: liveMode(),
    p_payment_id: intent.id,
    p_amount: proof.amount,
    p_currency: proof.currency,
    p_session_id: sessionId,
    p_charge_id: proof.chargeId,
  });
}

export async function syncCheckout(
  stripe: Stripe,
  account: string,
  sessionId: string,
  expectedOrderId?: string,
) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['payment_intent.latest_charge'],
  }, stripeOptions(account));
  const orderId = providerOrderId(session.metadata, 'online');
  if (!orderId && !expectedOrderId) return null;
  if (
    !orderId || session.livemode !== liveMode() || session.mode !== 'payment' ||
    session.client_reference_id !== orderId || (expectedOrderId && expectedOrderId !== orderId)
  ) {
    throw new HttpError(409, 'provider_checkout_mismatch');
  }
  if (!await boundOrder(account, orderId, 'online', session.id)) return null;

  const intent = session.payment_intent;
  if (session.status === 'complete' && session.payment_status === 'paid') {
    if (
      !intent || typeof intent === 'string' || providerOrderId(intent.metadata, 'online') !== orderId ||
      session.amount_total !== intent.amount_received || session.currency !== 'mxn'
    ) {
      throw new HttpError(409, 'provider_checkout_mismatch');
    }
    return await confirmCapture(stripe, account, intent, 'online', session.id);
  }

  if (
    session.payment_status === 'unpaid' && session.status === 'expired' &&
    (!intent || (typeof intent !== 'string' && intent.status === 'canceled'))
  ) {
    return await closeOrder(account, orderId, session.id, objectId(intent));
  }
  return null;
}

export async function syncTerminal(
  stripe: Stripe,
  account: string,
  paymentId: string,
  expectedOrderId?: string,
) {
  const intent = await stripe.paymentIntents.retrieve(
    paymentId,
    { expand: ['latest_charge'] },
    stripeOptions(account),
  );
  const orderId = providerOrderId(intent.metadata, 'terminal');
  if (!orderId && !expectedOrderId) return { order: null, intent };
  if (!orderId || intent.livemode !== liveMode() || (expectedOrderId && expectedOrderId !== orderId)) {
    throw new HttpError(409, 'provider_terminal_mismatch');
  }
  if (!await boundOrder(account, orderId, 'terminal', intent.id)) return { order: null, intent };
  if (intent.status === 'succeeded') {
    return { order: await confirmCapture(stripe, account, intent, 'terminal', null), intent };
  }
  if (intent.status === 'canceled') {
    return { order: await closeOrder(account, orderId, null, intent.id), intent };
  }
  return { order: null, intent };
}

export function readerAction(
  reader: Stripe.Terminal.Reader | Stripe.Terminal.DeletedReader,
  intentId: string,
) {
  if ('deleted' in reader || reader.action?.process_payment_intent?.payment_intent !== intentId) return null;
  return reader.action.status;
}

export async function cancelTerminal(
  stripe: Stripe,
  account: string,
  readerId: string,
  intent: Stripe.PaymentIntent,
  orderId: string,
) {
  if (!['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(intent.status)) {
    return null;
  }
  const options = stripeOptions(account);
  const reader = await stripe.terminal.readers.retrieve(readerId, {}, options);
  if (readerAction(reader, intent.id) === 'in_progress') {
    // Stripe's reader-level cancel doesn't take an expected PaymentIntent, so another sale
    // could take over the reader before that API call. Let the customer cancel on the reader.
    return null;
  }
  const canceled = await stripe.paymentIntents.cancel(
    intent.id,
    {},
    stripeOptions(account, `actv-terminal-cancel-${orderId}`),
  );
  return await syncTerminal(stripe, account, canceled.id, orderId);
}

export function accountStatus(account: Stripe.Account) {
  const chargesEnabled = account.charges_enabled === true && account.country === 'MX';
  const payoutsEnabled = account.payouts_enabled === true && account.country === 'MX';
  const detailsSubmitted = account.details_submitted === true;
  return {
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    ready: chargesEnabled && payoutsEnabled && detailsSubmitted,
  };
}

export function stripeErrorCode(error: unknown) {
  if (error instanceof Stripe.errors.StripeError) return error.code ?? error.type;
  return error instanceof HttpError ? error.code : 'payment_operation_unavailable';
}
