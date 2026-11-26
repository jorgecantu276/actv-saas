import { HttpError } from './http.ts';

const api = 'https://api.mercadopago.com';
const orderIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const preferenceIdPattern = /^[A-Za-z0-9-]{1,128}$/;
const numericId = /^[1-9][0-9]{0,18}$/;
const eligiblePaymentTypes = new Set(['credit_card', 'debit_card', 'prepaid_card', 'account_money']);
const marketplaceFeeNames = new Set(['marketplace_fee', 'application_fee']);

interface MercadoPagoOrder {
  orderId: string;
  collectorId: string;
  liveMode: boolean;
  amount: number;
  marketplaceFee: number;
}

export interface MercadoPagoPreferenceOrder extends MercadoPagoOrder {
  appId: string;
  expiresAt: string;
  items: { name: string; amount: number }[];
  testSeller?: boolean;
}

export interface MercadoPagoPaymentOrder extends MercadoPagoOrder {
  preferenceId: string;
}

interface MercadoPagoUrls {
  webhookUrl: string;
  success: string;
  pending: string;
  failure: string;
}

type Data = Record<string, unknown>;
export interface MercadoPagoFetchedPayment extends Readonly<Record<string, unknown>> {
  readonly id: number | string;
}
const fetchedPayment = new WeakMap<MercadoPagoFetchedPayment, { accessToken: string; payment: Data }>();

function record(value: unknown): Data | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : null;
}

function providerId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value);
  return typeof value === 'string' && numericId.test(value) ? value : null;
}

function toMinor(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value !== 'string' || !/^[0-9]+(?:\.[0-9]{1,2})?$/.test(value)) return null;
  const [whole, fractional = ''] = value.split('.');
  const minor = Number(whole) * 100 + Number(fractional.padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}

function assertOrder(order: MercadoPagoOrder) {
  if (
    !orderIdPattern.test(order.orderId) || !numericId.test(order.collectorId) ||
    typeof order.liveMode !== 'boolean' || !Number.isSafeInteger(order.amount) || order.amount <= 0 ||
    !Number.isSafeInteger(order.marketplaceFee) || order.marketplaceFee < 0 ||
    order.marketplaceFee >= order.amount
  ) throw new HttpError(409, 'mercadopago_order_mismatch');
}

function requireHttps(value: unknown, code: string): URL {
  const url = typeof value === 'string' ? URL.parse(value) : null;
  if (!url || url.protocol !== 'https:' || url.username || url.password) throw new HttpError(409, code);
  return url;
}

async function requestMercadoPago(accessToken: string, path: string, body?: Data): Promise<Data> {
  if (!accessToken || !/^[A-Za-z0-9._~+/=-]+$/.test(accessToken)) {
    throw new HttpError(503, 'mercadopago_credentials_required');
  }
  let response: Response;
  try {
    response = await fetch(api + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: 'Bearer ' + accessToken,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(6_000),
    });
  } catch {
    throw new HttpError(503, 'mercadopago_provider_unavailable');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(
      503,
      response.status === 404 ? 'mercadopago_resource_pending' : 'mercadopago_provider_unavailable',
    );
  }
  const value = record(await response.json().catch(() => null));
  if (!value) throw new HttpError(503, 'mercadopago_provider_unavailable');
  return value;
}

export async function verifyMercadoPagoTestSeller(accessToken: string, collectorId: string) {
  const seller = await requestMercadoPago(accessToken, '/users/me');
  if (
    providerId(seller.id) !== collectorId || seller.country_id !== 'MX' ||
    !Array.isArray(seller.tags) || !seller.tags.includes('test_user')
  ) {
    throw new HttpError(503, 'mercadopago_test_seller_required');
  }
}

function checkoutUrl(value: unknown, preferenceId: string): string {
  const url = requireHttps(value, 'mercadopago_redirect_mismatch');
  if (
    url.host !== 'www.mercadopago.com.mx' ||
    !/^\/(?:[Mm][Ll][Mm]\/)?checkout\/(?:v1\/redirect|pay|start|redirect)$/.test(url.pathname) ||
    url.searchParams.getAll('pref_id').length !== 1 || url.searchParams.get('pref_id') !== preferenceId
  ) throw new HttpError(409, 'mercadopago_redirect_mismatch');
  return url.href;
}

function parsePreference(preference: Data, order: MercadoPagoPreferenceOrder, expectedId?: string) {
  const id = preference.id;
  const providerItems = Array.isArray(preference.items) ? preference.items.map(record) : [];
  const configured = order.items.map((item) => item.amount).sort((a, b) => a - b);
  const received = providerItems.map((item) => toMinor(item?.unit_price)).sort((a, b) =>
    (a ?? -1) - (b ?? -1)
  );
  if (
    typeof id !== 'string' || !preferenceIdPattern.test(id) || (expectedId && id !== expectedId) ||
    providerId(preference.collector_id) !== order.collectorId ||
    providerId(preference.client_id) !== order.appId ||
    preference.external_reference !== order.orderId ||
    (preference.site_id != null && String(preference.site_id).toLowerCase() !== 'mlm') ||
    toMinor(preference.marketplace_fee) !== order.marketplaceFee ||
    providerItems.length !== configured.length || configured.some((value, idx) => value !== received[idx]) ||
    providerItems.some((item) => item?.currency_id !== 'MXN' || item.quantity !== 1) ||
    preference.expires !== true || preference.preference_expired === true ||
    typeof preference.expiration_date_to !== 'string' ||
    Date.parse(preference.expiration_date_to) !== Date.parse(order.expiresAt)
  ) throw new HttpError(409, 'mercadopago_preference_mismatch');
  return {
    id,
    checkoutUrl: checkoutUrl(preference.init_point, id),
  };
}

function assertPreferenceOrder(order: MercadoPagoPreferenceOrder) {
  assertOrder(order);
  // Checkout Pro uses init_point in both modes. The caller verifies the disposable test seller.
  if (!order.liveMode && order.testSeller !== true) {
    throw new HttpError(503, 'mercadopago_test_seller_required');
  }
  if (
    !numericId.test(order.appId) || !Number.isFinite(Date.parse(order.expiresAt)) || Date.parse(order.expiresAt) <= Date.now() ||
    order.items.length < 1 || order.items.length > 20 ||
    order.items.some((item) => !item.name.trim() || !Number.isSafeInteger(item.amount) || item.amount <= 0) ||
    order.items.reduce((total, item) => total + item.amount, 0) !== order.amount
  ) throw new HttpError(409, 'mercadopago_order_mismatch');
}

export async function createMercadoPagoPreference(
  accessToken: string,
  order: MercadoPagoPreferenceOrder,
  urls: MercadoPagoUrls,
) {
  assertPreferenceOrder(order);
  const webhook = requireHttps(urls.webhookUrl, 'mercadopago_webhook_configuration');
  if (
    webhook.hash || webhook.port || !webhook.hostname.includes('.') ||
    webhook.hostname.endsWith('.localhost') ||
    /^[0-9.]+$/.test(webhook.hostname) || webhook.searchParams.has('data.id') ||
    webhook.searchParams.has('type') ||
    webhook.searchParams.get('source_news') === 'ipn'
  ) throw new HttpError(409, 'mercadopago_webhook_configuration');
  webhook.searchParams.set('order_id', order.orderId);

  const success = requireHttps(urls.success, 'mercadopago_return_configuration');
  const pending = requireHttps(urls.pending, 'mercadopago_return_configuration');
  const failure = requireHttps(urls.failure, 'mercadopago_return_configuration');
  if (success.origin !== pending.origin || success.origin !== failure.origin) {
    throw new HttpError(409, 'mercadopago_return_configuration');
  }

  const preference = await requestMercadoPago(accessToken, '/checkout/preferences', {
    items: order.items.map((item, index) => ({
      id: String(index + 1),
      title: item.name,
      quantity: 1,
      currency_id: 'MXN',
      unit_price: item.amount / 100,
    })),
    external_reference: order.orderId,
    metadata: { actv_order_id: order.orderId, actv_provider: 'mercadopago' },
    marketplace_fee: order.marketplaceFee / 100,
    notification_url: webhook.href,
    back_urls: { success: success.href, pending: pending.href, failure: failure.href },
    auto_return: 'approved',
    expires: true,
    expiration_date_to: new Date(order.expiresAt).toISOString(),
    payment_methods: {
      installments: 1,
      excluded_payment_types: ['ticket', 'atm', 'bank_transfer'].map((id) => ({ id })),
    },
  });
  return parsePreference(preference, order);
}

export async function getMercadoPagoPreference(
  accessToken: string,
  preferenceId: string,
  order: MercadoPagoPreferenceOrder,
) {
  assertPreferenceOrder(order);
  if (!preferenceIdPattern.test(preferenceId)) throw new HttpError(409, 'mercadopago_preference_mismatch');
  const preference = await requestMercadoPago(accessToken, '/checkout/preferences/' + preferenceId);
  return parsePreference(preference, order, preferenceId);
}

export async function recoverMercadoPagoPreference(accessToken: string, order: MercadoPagoPreferenceOrder) {
  const query = new URLSearchParams({ external_reference: order.orderId, limit: '2' });
  const found = await requestMercadoPago(accessToken, '/checkout/preferences/search?' + query);
  const elements = Array.isArray(found.elements) ? found.elements.map(record) : [];
  const matches = elements.filter((item) => item?.external_reference === order.orderId);
  if (elements.length > 1 || matches.length > 1 || found.total !== elements.length) {
    throw new HttpError(409, 'mercadopago_duplicate_preferences');
  }
  const id = matches[0]?.id;
  return typeof id === 'string' ? getMercadoPagoPreference(accessToken, id, order) : null;
}

export async function getMercadoPagoPayment(accessToken: string, paymentId: string) {
  if (!numericId.test(paymentId)) throw new HttpError(409, 'mercadopago_payment_mismatch');
  const payment = await requestMercadoPago(accessToken, '/v1/payments/' + paymentId);
  if (providerId(payment.id) !== paymentId) throw new HttpError(409, 'mercadopago_payment_mismatch');
  const result = Object.freeze(structuredClone(payment)) as MercadoPagoFetchedPayment;
  fetchedPayment.set(result, { accessToken, payment });
  return result;
}

async function authoritativePayment(
  accessToken: string,
  paymentId: string,
  result?: MercadoPagoFetchedPayment,
) {
  const evidence = fetchedPayment.get(result ?? await getMercadoPagoPayment(accessToken, paymentId));
  if (!evidence || evidence.accessToken !== accessToken || providerId(evidence.payment.id) !== paymentId) {
    throw new HttpError(409, 'mercadopago_payment_mismatch');
  }
  return evidence.payment;
}

function observedMarketplaceFee(payment: Data, expected: number): number | null {
  const explicit = [payment.marketplace_fee, payment.application_fee].filter((value) => value != null);
  const fees = Array.isArray(payment.fee_details) ? payment.fee_details.map(record) : [];
  const chargeFees = Array.isArray(payment.charges_details) ? payment.charges_details.map(record) : [];
  const marketplaceFees = fees.filter((fee) =>
    fee && typeof fee.type === 'string' && marketplaceFeeNames.has(fee.type)
  );
  const marketplaceCharges = chargeFees.filter((fee) =>
    fee && fee.type === 'fee' && typeof fee.name === 'string' && marketplaceFeeNames.has(fee.name)
  );
  const observations = [
    ...explicit.map(toMinor),
    ...marketplaceFees.map((fee) => toMinor(fee?.amount)),
    ...marketplaceCharges.map((fee) => toMinor(record(fee?.amounts)?.original)),
  ];
  if (observations.some((value) => value !== expected)) throw new HttpError(409, 'mercadopago_fee_mismatch');
  return observations.length ? expected : null;
}

async function matchingPayment(
  accessToken: string,
  paymentId: string,
  expected: MercadoPagoPaymentOrder,
  payment: Data,
) {
  assertOrder(expected);
  const providerOrder = record(payment.order);
  const merchantOrderId = providerId(providerOrder?.id);
  const metadata = record(payment.metadata);
  const refundedAmount = toMinor(payment.transaction_amount_refunded);
  const paymentType = payment.payment_type_id ?? record(payment.payment_method)?.type;
  const reportedPaid = record(payment.transaction_details)?.total_paid_amount;
  if (
    !numericId.test(paymentId) || !preferenceIdPattern.test(expected.preferenceId) ||
    providerId(payment.id) !== paymentId || providerId(payment.collector_id) !== expected.collectorId ||
    payment.live_mode !== expected.liveMode || payment.external_reference !== expected.orderId ||
    (metadata?.actv_order_id != null && metadata.actv_order_id !== expected.orderId) ||
    (metadata?.actv_provider != null && metadata.actv_provider !== 'mercadopago') ||
    payment.currency_id !== 'MXN' || toMinor(payment.transaction_amount) !== expected.amount ||
    (reportedPaid != null && toMinor(reportedPaid) !== expected.amount) ||
    (payment.coupon_amount != null && toMinor(payment.coupon_amount) !== 0) ||
    payment.captured !== true || typeof paymentType !== 'string' || !eligiblePaymentTypes.has(paymentType) ||
    refundedAmount === null || refundedAmount > expected.amount || !merchantOrderId ||
    (providerOrder?.type != null && providerOrder.type !== 'mercadopago')
  ) throw new HttpError(409, 'mercadopago_payment_mismatch');

  const merchantOrder = await requestMercadoPago(accessToken, '/merchant_orders/' + merchantOrderId);
  const payments = Array.isArray(merchantOrder.payments) ? merchantOrder.payments.map(record) : [];
  const matching = payments.filter((entry) => providerId(entry?.id) === paymentId);
  if (
    providerId(merchantOrder.id) !== merchantOrderId ||
    providerId(record(merchantOrder.collector)?.id) !== expected.collectorId ||
    merchantOrder.external_reference !== expected.orderId ||
    merchantOrder.preference_id !== expected.preferenceId ||
    (merchantOrder.site_id != null && String(merchantOrder.site_id).toLowerCase() !== 'mlm') ||
    toMinor(merchantOrder.total_amount) !== expected.amount || matching.length !== 1 ||
    matching[0]?.currency_id !== 'MXN' || toMinor(matching[0]?.transaction_amount) !== expected.amount
  ) throw new HttpError(409, 'mercadopago_merchant_order_mismatch');

  return { paymentId, merchantOrderId, amount: expected.amount, currency: 'mxn' as const, refundedAmount };
}

export async function verifyMercadoPagoPayment(
  accessToken: string,
  paymentId: string,
  expected: MercadoPagoPaymentOrder,
  authoritative?: MercadoPagoFetchedPayment,
) {
  const payment = await authoritativePayment(accessToken, paymentId, authoritative);
  if (payment.status !== 'approved' || payment.status_detail !== 'accredited') return null;
  const proof = await matchingPayment(accessToken, paymentId, expected, payment);
  if (proof.refundedAmount !== 0) return null;
  return { ...proof, marketplaceFee: observedMarketplaceFee(payment, expected.marketplaceFee) };
}

export async function verifyMercadoPagoReversal(
  accessToken: string,
  paymentId: string,
  expected: MercadoPagoPaymentOrder & { boundPaymentId: string },
  authoritative?: MercadoPagoFetchedPayment,
) {
  if (paymentId !== expected.boundPaymentId) return null;
  const payment = await authoritativePayment(accessToken, paymentId, authoritative);
  const state = payment.status;
  if (state !== 'approved' && state !== 'refunded' && state !== 'charged_back') return null;
  if (
    state === 'approved' && payment.status_detail !== 'partially_refunded' &&
    toMinor(payment.transaction_amount_refunded) === 0
  ) return null;
  const proof = await matchingPayment(accessToken, paymentId, expected, payment);
  if (state === 'approved' && proof.refundedAmount === 0) return null;
  if (state === 'refunded' && proof.refundedAmount !== expected.amount) {
    throw new HttpError(409, 'mercadopago_refund_mismatch');
  }
  return { ...proof, state };
}

export async function verifyMercadoPagoWebhook(request: Request, secret: string, now = Date.now()) {
  if (!secret) throw new HttpError(503, 'mercadopago_webhook_configuration');
  const url = new URL(request.url);
  const ids = url.searchParams.getAll('data.id');
  const types = url.searchParams.getAll('type');
  const signature = request.headers.get('x-signature');
  const requestId = request.headers.get('x-request-id');
  if (
    request.method !== 'POST' || ids.length !== 1 || !numericId.test(ids[0]) ||
    types.length !== 1 || types[0] !== 'payment' || !signature || signature.length > 512 ||
    !requestId || !/^[A-Za-z0-9_-]{1,160}$/.test(requestId)
  ) throw new HttpError(401, 'mercadopago_invalid_signature');

  const fields = signature.split(',').map((entry) => entry.trim());
  const timestamps = fields.filter((entry) => entry.startsWith('ts='));
  const hashes = fields.filter((entry) => entry.startsWith('v1='));
  if (timestamps.length !== 1 || hashes.length !== 1) {
    throw new HttpError(401, 'mercadopago_invalid_signature');
  }
  const timestamp = timestamps[0].slice(3);
  const hex = hashes[0].slice(3);
  if (!/^(?:[0-9]{10}|[0-9]{13})$/.test(timestamp) || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new HttpError(401, 'mercadopago_invalid_signature');
  }
  const timeInMs = Number(timestamp) * (timestamp.length === 10 ? 1_000 : 1);
  if (Math.abs(now - timeInMs) > 300_000) throw new HttpError(401, 'mercadopago_invalid_signature');

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const bytes = Uint8Array.from(hex.match(/../g)!, (pair) => Number.parseInt(pair, 16));
  const manifest = 'id:' + ids[0] + ';request-id:' + requestId + ';ts:' + timestamp + ';';
  if (!await crypto.subtle.verify('HMAC', key, bytes, encoder.encode(manifest))) {
    throw new HttpError(401, 'mercadopago_invalid_signature');
  }
  return { paymentId: ids[0], requestId };
}
