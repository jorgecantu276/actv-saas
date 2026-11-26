import { HttpError, rpc } from './http.ts';
import { objectId, type Stripe, stripeOptions } from './stripe.ts';

type RefundRecovery = {
  id: string;
  order_id: string;
  provider_refund_id: string | null;
  lease: string;
  account_id: string;
  charge_id: string;
  provider_payment_id: string;
  amount: number;
  currency: string;
};

export function claimRefundRecovery(mode: boolean, limit: number) {
  return rpc<RefundRecovery[]>('actv_claim_refund_recovery', { p_live_mode: mode, p_limit: limit });
}

export function noteRefundRecovery(request: RefundRecovery, code: string) {
  return rpc('actv_note_refund_recovery', {
    p_request: request.id,
    p_lease: request.lease,
    p_failure: code,
  });
}

type CapturedRefund = {
  chargeId: string;
  paymentId: string;
  amount: number;
};

export function verifyAdminRefund(
  refund: Stripe.Refund,
  capture: CapturedRefund,
  mode: boolean,
  requestId: string,
) {
  if (
    !/^re_[A-Za-z0-9]+$/.test(refund.id) || objectId(refund.charge) !== capture.chargeId ||
    objectId(refund.payment_intent) !== capture.paymentId || refund.currency !== 'mxn' ||
    refund.amount !== capture.amount || !refund.status ||
    ('livemode' in refund && typeof refund.livemode === 'boolean' && refund.livemode !== mode) ||
    refund.metadata?.actv_refund_request_id !== requestId
  ) throw new HttpError(409, 'provider_refund_mismatch');
  return refund.status;
}

export async function recoverAdminRefund(stripe: Stripe, request: RefundRecovery, mode: boolean) {
  if (
    !/^acct_[A-Za-z0-9]+$/.test(request.account_id) || !/^ch_[A-Za-z0-9]+$/.test(request.charge_id) ||
    !/^pi_[A-Za-z0-9]+$/.test(request.provider_payment_id) || request.currency !== 'mxn' ||
    !Number.isSafeInteger(request.amount) || request.amount <= 0
  ) throw new HttpError(409, 'provider_capture_mismatch');
  // Orders/captures are already bound to a Stripe charge verified in this environment.
  const options = stripeOptions(request.account_id);
  let refund: Stripe.Refund | undefined;
  if (request.provider_refund_id) {
    if (!/^re_[A-Za-z0-9]+$/.test(request.provider_refund_id)) {
      throw new HttpError(409, 'provider_refund_mismatch');
    }
    refund = await stripe.refunds.retrieve(request.provider_refund_id, {}, options);
    if (refund.id !== request.provider_refund_id) throw new HttpError(409, 'provider_refund_mismatch');
  } else {
    const refunds = await stripe.refunds.list({ charge: request.charge_id, limit: 100 }, options);
    const matches = refunds.data.filter((row) => row.metadata?.actv_refund_request_id === request.id);
    if (matches.length > 1 || refunds.has_more) throw new HttpError(409, 'refund_lookup_incomplete');
    refund = matches[0];
  }
  if (!refund) return false;
  const status = verifyAdminRefund(
    refund,
    {
      chargeId: request.charge_id,
      paymentId: request.provider_payment_id,
      amount: request.amount,
    },
    mode,
    request.id,
  );
  await rpc('actv_record_admin_refund', {
    p_live_mode: mode,
    p_order: request.order_id,
    p_request: request.id,
    p_refund: refund.id,
    p_status: status,
  });
  return true;
}
