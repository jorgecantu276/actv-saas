import { body, field, handler, HttpError, liveMode, operator, rpc, uuid } from '../_shared/http.ts';
import { verifyAdminRefund } from '../_shared/refund-recovery.ts';
import { executeParticipantRefund, type ParticipantRefund } from '../_shared/participant-refunds.ts';
import { objectId, Stripe, stripeClient, stripeOptions } from '../_shared/stripe.ts';

type RefundReason = 'requested_by_customer' | 'duplicate';
type AdminPayment = {
  id: string;
  channel: 'cash' | 'online' | 'terminal';
  state: string;
  account_id: string | null;
  payment_id: string | null;
  charge_id: string | null;
  amount: number | null;
  currency: string | null;
  adjustments: { id: string; kind: string; amount: number; status: string; date: string }[];
  refund_request: {
    id: string;
    requested_at: string;
    requested_by: string | null;
    reason: RefundReason;
    refund_application_fee: boolean;
    provider_refund_id: string | null;
    status: string | null;
  } | null;
};
type CapturedPayment = AdminPayment & {
  account_id: string;
  payment_id: string;
  charge_id: string;
  amount: number;
};

function capturedByStripe(payment: AdminPayment): payment is CapturedPayment {
  return payment.channel !== 'cash' && /^acct_[a-zA-Z0-9]+$/.test(payment.account_id ?? '') &&
    /^pi_[a-zA-Z0-9]+$/.test(payment.payment_id ?? '') && /^ch_[a-zA-Z0-9]+$/.test(payment.charge_id ?? '') &&
    payment.currency === 'mxn' && Number.isSafeInteger(payment.amount) && (payment.amount ?? 0) > 0;
}

function getPayment(operatorId: string, mode: boolean, order: string) {
  return rpc<AdminPayment>('actv_admin_payment', {
    p_operator: operatorId,
    p_live_mode: mode,
    p_order: order,
  });
}

async function getCharge(stripe: Stripe, payment: CapturedPayment, mode: boolean) {
  const charge = await stripe.charges.retrieve(payment.charge_id, {}, stripeOptions(payment.account_id));
  if (
    charge.id !== payment.charge_id || charge.livemode !== mode ||
    objectId(charge.payment_intent) !== payment.payment_id ||
    charge.currency !== payment.currency || charge.amount_captured !== payment.amount ||
    !charge.paid || !charge.captured ||
    charge.payment_method_details?.type !== (payment.channel === 'terminal' ? 'card_present' : 'card')
  ) throw new HttpError(409, 'provider_capture_mismatch');
  return charge;
}

function allowRefund(payment: CapturedPayment, charge: Stripe.Charge) {
  return payment.state === 'issued' && charge.amount_refunded === 0 && !charge.refunded && !charge.disputed &&
    !payment.adjustments.some((row) =>
      row.kind === 'refund' && ['pending', 'requires_action', 'succeeded'].includes(row.status)
    );
}

async function providerDetails(payment: AdminPayment, mode: boolean) {
  if (!capturedByStripe(payment)) return null;
  const stripe = stripeClient();
  const charge = await getCharge(stripe, payment, mode);
  const method = charge.payment_method_details;
  const card = method?.card ?? method?.card_present;
  const place = method?.card_present;
  const balanceId = objectId(charge.balance_transaction);
  const balance = balanceId
    ? await stripe.balanceTransactions.retrieve(balanceId, {}, stripeOptions(payment.account_id))
    : null;
  return {
    type: method?.type ?? null,
    brand: card?.brand ?? null,
    last4: card?.last4 ?? null,
    country: card?.country ?? null,
    funding: card?.funding ?? null,
    wallet: method?.card?.wallet?.type ?? place?.wallet?.type ?? null,
    stripeFees: balance?.fee_details?.filter(({ type }) => type === 'stripe_fee' || type === 'tax')
      .reduce((sum, fee) => sum + fee.amount, 0) ?? null,
    organizerNet: balance?.net ?? null,
    balanceCurrency: balance?.currency ?? null,
    commission: charge.application_fee_amount,
    canRefund: allowRefund(payment, charge),
  };
}

async function refund(
  operatorId: string,
  mode: boolean,
  original: AdminPayment,
  reason: RefundReason,
  refundCommission: boolean,
) {
  if (!capturedByStripe(original)) throw new HttpError(409, 'refund_unavailable');
  const stripe = stripeClient();
  const options = stripeOptions(original.account_id);
  const charge = await getCharge(stripe, original, mode);
  const providerRefunds = await stripe.refunds.list({ charge: charge.id, limit: 100 }, options);
  const unresolved = providerRefunds.data.some(({ status }) =>
    status === 'pending' || status === 'requires_action' || status === 'succeeded'
  );
  if (
    !original.refund_request && (!allowRefund(original, charge) || unresolved || providerRefunds.has_more)
  ) {
    throw new HttpError(409, 'refund_unavailable');
  }
  const payment = await rpc<AdminPayment>('actv_admin_begin_refund', {
    p_operator: operatorId,
    p_live_mode: mode,
    p_order: original.id,
    p_reason: reason,
    p_refund_application_fee: refundCommission,
  });
  const pending = payment.refund_request;
  if (!pending || !capturedByStripe(payment) || payment.charge_id !== charge.id) {
    throw new HttpError(409, 'refund_unavailable');
  }

  let result = pending.provider_refund_id
    ? await stripe.refunds.retrieve(pending.provider_refund_id, {}, options)
    : providerRefunds.data.find(({ metadata }) => metadata?.actv_refund_request_id === pending.id);
  if (!result) {
    // Stripe can evict API v1 idempotency keys after 24 hours.
    if (
      Date.now() - Date.parse(pending.requested_at) >= 23 * 60 * 60 * 1000 ||
      !allowRefund(payment, charge) || unresolved || providerRefunds.has_more
    ) throw new HttpError(409, 'refund_needs_reconciliation');
    result = await stripe.refunds.create({
      charge: charge.id,
      amount: payment.amount,
      reason: pending.reason,
      refund_application_fee: pending.refund_application_fee,
      metadata: { actv_refund_request_id: pending.id },
    }, stripeOptions(payment.account_id, `actv-full-refund-${pending.id}`));
  }
  const status = verifyAdminRefund(
    result,
    {
      chargeId: charge.id,
      paymentId: payment.payment_id,
      amount: payment.amount,
    },
    mode,
    pending.id,
  );

  const currentStatus = await rpc<string>('actv_admin_finalize_refund', {
    p_operator: operatorId,
    p_live_mode: mode,
    p_order: payment.id,
    p_request: pending.id,
    p_refund: result.id,
    p_status: status,
  });
  return { id: result.id, status: currentStatus, amount: result.amount };
}

export const adminPaymentsHandler = handler('actv-admin-payments', async (request) => {
  const actor = await operator(request);
  const mode = liveMode();
  const input = await body(request);
  if (input.action === 'participant-refund') {
    if (input.confirmed !== true || !Array.isArray(input.itemIds) || input.itemIds.length < 1 || input.itemIds.length > 20 ||
      typeof input.refundCommission !== 'boolean' || typeof input.participantScoped !== 'boolean') throw new HttpError(400, 'invalid_request');
    const row = await rpc<ParticipantRefund>('actv_begin_participant_refund', {
      p_operator: actor, p_live_mode: mode, p_order: uuid(input.orderId), p_request: uuid(input.requestId),
      p_items: input.itemIds.map((id) => uuid(id)), p_reason: field(input.reason, 500),
      p_refund_application_fee: input.refundCommission, p_participant_scoped: input.participantScoped,
    });
    return await executeParticipantRefund(stripeClient(), row, mode);
  }
  if (input.action === 'list' || input.action === 'outflows') {
    const from = field(input.from, 10);
    const to = field(input.to, 10);
    const offset = input.offset ?? 0;
    if (
      !validDate(from) || !validDate(to) ||
      typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000
    ) throw new HttpError(400, 'invalid_request');
    const page = {
      p_operator: actor,
      p_live_mode: mode,
      p_from: from,
      p_to: to,
      p_offset: offset,
    };
    const result = input.action === 'outflows'
      ? await rpc<Record<string, unknown>>('actv_list_admin_outflows', page)
      : await rpc<Record<string, unknown>>('actv_list_admin_payments', {
        ...page,
        p_channel: field(input.channel, 12, false) || null,
        p_state: field(input.state, 12, false) || null,
        p_search: field(input.search, 120, false),
      });
    return { ...result, liveMode: mode };
  }
  if (input.action !== 'detail' && input.action !== 'refund') throw new HttpError(400, 'invalid_action');
  const payment = await getPayment(actor, mode, uuid(input.orderId));
  if (input.action === 'refund') {
    if (
      (input.reason !== 'requested_by_customer' && input.reason !== 'duplicate') ||
      typeof input.refundCommission !== 'boolean' || input.confirmed !== true
    ) throw new HttpError(400, 'invalid_request');
    return await refund(actor, mode, payment, input.reason, input.refundCommission);
  }
  return {
    channel: payment.channel,
    amount: payment.amount,
    refundRequest: payment.refund_request,
    adjustments: payment.adjustments,
    provider: await providerDetails(payment, mode),
  };
}, true);

function validDate(value: string) {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value + 'T');
}

export default { fetch: adminPaymentsHandler };
