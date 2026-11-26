import { HttpError, liveMode, rpc } from './http.ts';
import type { Order } from './orders.ts';
import {
  accountStatus,
  cancelTerminal,
  objectId,
  recordAdjustment,
  type Stripe,
  stripeOptions,
  syncCheckout,
  syncTerminal,
} from './stripe.ts';

export interface StoredEvent {
  account_id: string;
  live_mode: boolean;
  event_id: string;
  event_type: string;
  object_id: string;
  order_id: string | null;
}

export type EventRetry = StoredEvent & { lease: string };

export function acknowledgeEvent(event: EventRetry, failure: string | null) {
  return rpc<boolean>('actv_finish_stripe_event_retry', {
    p_account_id: event.account_id,
    p_live_mode: event.live_mode,
    p_event_id: event.event_id,
    p_lease: event.lease,
    p_failure_code: failure,
  });
}

export const eventTypes = new Set([
  'account.updated',
  'account.application.deauthorized',
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'payment_intent.succeeded',
  'payment_intent.canceled',
  'refund.created',
  'refund.updated',
  'refund.failed',
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated',
  'payout.created',
  'payout.updated',
  'payout.paid',
  'payout.failed',
  'payout.canceled',
  'payout.reconciliation_completed',
]);

export function recordEvent(record: StoredEvent) {
  return rpc<{ processed: boolean }>('actv_record_stripe_event', {
    p_account_id: record.account_id,
    p_live_mode: record.live_mode,
    p_event_id: record.event_id,
    p_type: record.event_type,
    p_object_id: record.object_id,
    p_order_id: record.order_id,
  });
}

function refreshAccount(account: string, ready: boolean) {
  return rpc('actv_refresh_account', { p_account_id: account, p_live_mode: liveMode(), p_ready: ready });
}

async function settlement(stripe: Stripe, account: string, id: string, includeLines: boolean) {
  const options = stripeOptions(account);
  const payout = await stripe.payouts.retrieve(id, {}, options);
  if (payout.livemode !== liveMode()) throw new HttpError(409, 'payment_mode_mismatch');
  if (payout.currency !== 'mxn') return;
  const args = {
    p_account_id: account,
    p_live_mode: payout.livemode,
    p_payout_id: payout.id,
    p_amount: payout.amount,
    p_currency: payout.currency,
    p_state: payout.status,
  };
  await rpc('actv_record_settlement', { ...args, p_lines: [] });
  if (!includeLines || !payout.automatic || payout.reconciliation_status !== 'completed') return;

  const batch: Array<
    { id: string; source: string | null; amount: number; fee: number; net: number; currency: string }
  > = [];
  for await (const line of stripe.balanceTransactions.list({ payout: payout.id, limit: 100 }, options)) {
    batch.push({
      id: line.id,
      source: objectId(line.source),
      amount: line.amount,
      fee: line.fee,
      net: line.net,
      currency: line.currency,
    });
    if (batch.length >= 100) {
      await rpc('actv_record_settlement', { ...args, p_lines: batch });
      batch.length = 0;
    }
  }
  if (batch.length) await rpc('actv_record_settlement', { ...args, p_lines: batch });
}

export async function applyEvent(stripe: Stripe, record: StoredEvent) {
  const { account_id: account, event_type: type, object_id: id, order_id } = record;
  if (record.live_mode !== liveMode() || !account.startsWith('acct_')) {
    throw new HttpError(409, 'payment_mode_mismatch');
  }
  const options = stripeOptions(account);

  if (type === 'account.updated') {
    const accountObject = await stripe.accounts.retrieve(account);
    await refreshAccount(account, accountStatus(accountObject).ready);
  } else if (type === 'account.application.deauthorized') {
    await refreshAccount(account, false);
  } else if (type.startsWith('checkout.session.')) {
    await syncCheckout(stripe, account, id, order_id ?? undefined);
  } else if (type.startsWith('payment_intent.')) {
    await syncTerminal(stripe, account, id, order_id ?? undefined);
  } else if (type.startsWith('refund.')) {
    await recordAdjustment(account, await stripe.refunds.retrieve(id, {}, options), 'refund');
  } else if (type.startsWith('charge.dispute.')) {
    await recordAdjustment(account, await stripe.disputes.retrieve(id, {}, options), 'dispute');
  } else if (type.startsWith('payout.')) {
    await settlement(stripe, account, id, type === 'payout.reconciliation_completed');
  }
}

export async function completeEvent(stripe: Stripe, record: StoredEvent) {
  await applyEvent(stripe, record);
  await rpc('actv_finish_stripe_event', {
    p_account_id: record.account_id,
    p_live_mode: record.live_mode,
    p_event_id: record.event_id,
  });
}

export async function syncPendingOrder(
  stripe: Stripe,
  order: Pick<
    Order,
    | 'order_id'
    | 'account_id'
    | 'channel'
    | 'live_mode'
    | 'provider_session_id'
    | 'provider_payment_id'
    | 'expires_at'
  >,
) {
  const account = order.account_id;
  if (!account?.startsWith('acct_') || order.live_mode !== liveMode()) {
    throw new HttpError(409, 'payment_mode_mismatch');
  }
  await rpc('actv_checked_order', { p_order_id: order.order_id });
  if (order.channel === 'online' && order.provider_session_id) {
    await syncCheckout(stripe, account, order.provider_session_id, order.order_id);
  }
  if (order.channel === 'terminal' && order.provider_payment_id) {
    const result = await syncTerminal(stripe, account, order.provider_payment_id, order.order_id);
    if (!result.order && Date.parse(order.expires_at) <= Date.now()) {
      const full = await rpc<Order | null>('actv_read_order', { p_order_id: order.order_id });
      if (full?.state === 'pending' && full.reader_id && full.provider_payment_id === result.intent.id) {
        await cancelTerminal(stripe, account, full.reader_id, result.intent, order.order_id);
      }
    }
  }
}

export function noteFailedEvent(record: StoredEvent, failureCode: string) {
  return rpc('actv_checked_stripe_event', {
    p_account_id: record.account_id,
    p_live_mode: record.live_mode,
    p_event_id: record.event_id,
    p_failure_code: failureCode,
  });
}
