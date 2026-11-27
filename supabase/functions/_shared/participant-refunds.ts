import { HttpError, rpc } from './http.ts';
import { objectId, type Stripe, stripeOptions } from './stripe.ts';
import { verifyAdminRefund } from './refund-recovery.ts';

export type ParticipantRefund = {
  id: string; order_id: string; item_ids: string[]; amount: number; captured: number;
  requested_at: string; reason: string; refund_application_fee: boolean; participant_scoped: boolean;
  provider_refund_id: string | null; status: string; account_id: string; charge_id: string;
  payment_id: string; currency: string; live_mode: boolean; channel: string;
};

// POST retries always reuse the immutable request and original key. A request
// older than 23h is lookup-only: Stripe may have evicted its idempotency key.
export async function executeParticipantRefund(stripe: Stripe, row: ParticipantRefund, mode: boolean, lookupOnly = false) {
  if (!/^acct_[A-Za-z0-9]+$/.test(row.account_id ?? '') || !/^ch_[A-Za-z0-9]+$/.test(row.charge_id ?? '') ||
    !/^pi_[A-Za-z0-9]+$/.test(row.payment_id ?? '') || row.live_mode !== mode || row.currency !== 'mxn' ||
    !Number.isSafeInteger(row.amount) || row.amount <= 0 || row.amount > row.captured
  ) throw new HttpError(409, 'provider_capture_mismatch');
  const options = stripeOptions(row.account_id);
  const charge = await stripe.charges.retrieve(row.charge_id, {}, options);
  if (charge.id !== row.charge_id || charge.livemode !== mode || objectId(charge.payment_intent) !== row.payment_id ||
    charge.amount_captured !== row.captured || charge.currency !== row.currency || !charge.paid || !charge.captured ||
    charge.payment_method_details?.type !== (row.channel === 'terminal' ? 'card_present' : 'card')
  ) throw new HttpError(409, 'provider_capture_mismatch');
  let refund: Stripe.Refund | undefined;
  if (row.provider_refund_id) {
    refund = await stripe.refunds.retrieve(row.provider_refund_id, {}, options);
    if (refund.id !== row.provider_refund_id) throw new HttpError(409, 'provider_refund_mismatch');
  } else {
    const list = await stripe.refunds.list({ charge: row.charge_id, limit: 100 }, options);
    const matches = list.data.filter((r) => r.metadata?.actv_refund_request_id === row.id);
    if (list.has_more || matches.length > 1) throw new HttpError(409, 'refund_lookup_incomplete');
    refund = matches[0];
    if (!refund) {
      const age = Date.now() - Date.parse(row.requested_at);
      if (lookupOnly || !Number.isFinite(age) || age < 0 || age >= 23 * 3600000 || charge.disputed ||
        charge.amount_refunded + row.amount > row.captured || row.status !== 'requested'
      ) throw new HttpError(409, 'refund_needs_reconciliation');
      // Revalidate all provider observations against the ledger while holding
      // the order mutex. Unknown partials are never assigned to selected runners.
      await rpc('actv_check_participant_refund_provider', {
        p_request: row.id,
        p_refunds: list.data.map((r) => ({ id: r.id, amount: r.amount, status: r.status })),
      });
      refund = await stripe.refunds.create({ charge: row.charge_id, amount: row.amount,
        reason: 'requested_by_customer', refund_application_fee: row.refund_application_fee,
        metadata: { actv_refund_request_id: row.id },
      }, stripeOptions(row.account_id, 'actv-participant-refund-' + row.id));
    }
  }
  const status = verifyAdminRefund(refund, { chargeId: row.charge_id, paymentId: row.payment_id, amount: row.amount }, mode, row.id);
  return await rpc('actv_record_participant_refund', {
    p_live_mode: mode, p_request: row.id, p_refund: refund.id, p_status: status,
  });
}

export async function recoverParticipantRefunds(stripe: Stripe, mode: boolean, limit: number, deadline: number) {
  const rows = await rpc<ParticipantRefund[]>('actv_pending_participant_refunds', { p_live_mode: mode, p_limit: limit });
  let attempted = 0, failed = 0;
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    attempted++;
    try { await executeParticipantRefund(stripe, row, mode, true); } catch { failed++; }
  }
  return { attempted, failed };
}
