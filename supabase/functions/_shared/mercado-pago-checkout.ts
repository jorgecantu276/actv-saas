import { HttpError, liveMode, rpc } from './http.ts';
import type { Order } from './orders.ts';
import {
  createMercadoPagoPreference,
  getMercadoPagoPayment,
  getMercadoPagoPreference,
  type MercadoPagoPreferenceOrder,
  recoverMercadoPagoPreference,
  verifyMercadoPagoPayment,
  verifyMercadoPagoReversal,
  verifyMercadoPagoTestSeller,
} from './mercado-pago.ts';

function endpoint(name: string): string | undefined {
  const value = Deno.env.get(name);
  if (!value) return;
  const url = URL.parse(value);
  if (
    url?.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search &&
    !url.port && url.hostname.includes('.') && !url.hostname.endsWith('.localhost') &&
    !/^[0-9.]+$/.test(url.hostname)
  ) return url.href;
}

function config() {
  const appId = Deno.env.get('ACTV_MP_TEST_APP_ID');
  const accessToken = Deno.env.get('ACTV_MP_TEST_SELLER_TOKEN');
  const collectorId = Deno.env.get('ACTV_MP_TEST_COLLECTOR_ID');
  const webhookSecret = Deno.env.get('ACTV_MP_TEST_WEBHOOK_SECRET');
  const webhookUrl = endpoint('ACTV_MP_TEST_WEBHOOK_URL');
  const callback = endpoint('ACTV_MP_TEST_RETURN_URL');
  if (
    liveMode() || !appId || !/^[1-9]\d{0,18}$/.test(appId) ||
    !accessToken || !collectorId || !/^[1-9]\d{0,18}$/.test(collectorId) ||
    !webhookSecret || !webhookUrl || !callback
  ) return;
  return { appId, accessToken, collectorId, webhookSecret, webhookUrl, callback };
}

export function mercadoPagoEnabled() {
  // This source candidate supports Stripe/cash only. Preserved provider code
  // and database compatibility do not authorize enabling the unfinished pilot.
  return false;
}

export function mercadoPagoConfig() {
  if (!mercadoPagoEnabled()) throw new HttpError(503, 'mercadopago_not_available');
  const settings = config();
  if (!settings) throw new HttpError(503, 'mercadopago_not_available');
  return settings;
}

function scope(order: Order, collectorId: string) {
  if (
    order.provider !== 'mercadopago' || order.channel !== 'online' || order.live_mode ||
    order.currency.toLowerCase() !== 'mxn' || order.mercadopago_collector_id !== collectorId
  ) {
    throw new HttpError(409, 'mercadopago_order_mismatch');
  }
  return { p_order_id: order.order_id, p_live_mode: false, p_collector_id: collectorId };
}

export async function startMercadoPagoCheckout(order: Order) {
  const settings = mercadoPagoConfig();
  const identity = scope(order, settings.collectorId);
  if (Date.parse(order.expires_at) <= Date.now()) return null;
  await verifyMercadoPagoTestSeller(settings.accessToken, settings.collectorId);
  const expected: MercadoPagoPreferenceOrder = {
    orderId: order.order_id,
    appId: settings.appId,
    collectorId: settings.collectorId,
    liveMode: false,
    testSeller: true,
    amount: order.amount,
    marketplaceFee: order.application_fee_amount,
    expiresAt: order.expires_at,
    items: order.items,
  };
  if (order.provider_preference_id) {
    return await getMercadoPagoPreference(settings.accessToken, order.provider_preference_id, expected);
  }
  const lease = await rpc<string | null>('actv_claim_mercadopago_preference', identity);
  if (!lease) {
    const recorded = await rpc<Order | null>('actv_read_order', { p_order_id: order.order_id });
    if (recorded?.provider_preference_id) {
      return await getMercadoPagoPreference(settings.accessToken, recorded.provider_preference_id, expected);
    }
    if (!recorded?.mercadopago_claim_id) throw new HttpError(503, 'mercadopago_preference_pending');
    const recovered = await recoverMercadoPagoPreference(settings.accessToken, expected);
    if (!recovered) throw new HttpError(503, 'mercadopago_preference_pending');
    await rpc<Order>('actv_attach_mercadopago_preference', {
      ...identity,
      p_claim_id: recorded.mercadopago_claim_id,
      p_preference_id: recovered.id,
    });
    return recovered;
  }

  const success = new URL(settings.callback);
  success.searchParams.set('orden', order.order_id);
  const failure = new URL(success);
  failure.searchParams.set('cancelado', '1');
  // Mercado Pago receives the order ID. The browser keeps its private ACTV status token.
  const preference = await createMercadoPagoPreference(settings.accessToken, expected, {
    webhookUrl: settings.webhookUrl,
    success: success.href,
    pending: success.href,
    failure: failure.href,
  });
  await rpc<Order>('actv_attach_mercadopago_preference', {
    ...identity,
    p_claim_id: lease,
    p_preference_id: preference.id,
  });
  return preference;
}

export async function syncMercadoPagoCheckout(order: Order, paymentId: string) {
  const settings = mercadoPagoConfig();
  const identity = scope(order, settings.collectorId);
  const preferenceId = order.provider_preference_id;
  if (!preferenceId) throw new HttpError(503, 'mercadopago_preference_pending');
  const expected = {
    orderId: order.order_id,
    preferenceId,
    appId: settings.appId,
    collectorId: settings.collectorId,
    liveMode: false,
    amount: order.amount,
    marketplaceFee: order.application_fee_amount,
  };
  const payment = await getMercadoPagoPayment(settings.accessToken, paymentId);
  const reversal = await verifyMercadoPagoReversal(settings.accessToken, paymentId, {
    ...expected,
    boundPaymentId: order.mercadopago_payment_id ?? paymentId,
  }, payment);
  if (reversal) {
    return rpc<Order>('actv_record_mercadopago_reversal', {
      ...identity,
      p_preference_id: preferenceId,
      p_payment_id: reversal.paymentId,
      p_state: reversal.state,
      p_refunded_amount: reversal.refundedAmount,
    });
  }
  const proof = await verifyMercadoPagoPayment(settings.accessToken, paymentId, expected, payment);
  if (!proof) return order;
  if (proof.marketplaceFee === null && expected.marketplaceFee > 0) {
    console.warn(
      JSON.stringify({
        component: 'actv-mercadopago',
        code: 'commission_not_reported',
        orderId: order.order_id,
      }),
    );
  }
  return rpc<Order>('actv_confirm_mercadopago', {
    ...identity,
    p_preference_id: preferenceId,
    p_payment_id: proof.paymentId,
    p_amount: proof.amount,
    p_currency: proof.currency,
  });
}
