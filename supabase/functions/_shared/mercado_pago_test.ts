import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  createMercadoPagoPreference,
  getMercadoPagoPayment,
  getMercadoPagoPreference,
  verifyMercadoPagoPayment,
  verifyMercadoPagoReversal,
  verifyMercadoPagoWebhook,
} from './mercado-pago.ts';

const collectorId = '123456789';
const appId = '2200000000000001';
const orderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const preferenceId = '123456789-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const paymentId = '123456789012';
const merchantOrderId = '12222333444';
const fakeToken = 'APP_USR-test-seller-fixture';
const order = {
  appId,
  collectorId,
  orderId,
  liveMode: false,
  testSeller: true,
  amount: 35_000,
  marketplaceFee: 1_500,
  expiresAt: new Date(Date.now() + 45 * 60_000).toISOString(),
  items: [{ name: 'Folio', amount: 35_000 }],
};
const expectedPayment = { ...order, preferenceId };
const urls = {
  webhookUrl: 'https://staging.example.test/functions/v1/actv-mercadopago-webhook',
  success: 'https://staging.example.test/registro/estado?orden=' + orderId + '#token=fixture',
  pending: 'https://staging.example.test/registro/estado?orden=' + orderId + '#token=fixture',
  failure: 'https://staging.example.test/registro/estado?orden=' + orderId + '&cancelado=1#token=fixture',
};
const preference = {
  id: preferenceId,
  client_id: appId,
  collector_id: Number(collectorId),
  external_reference: orderId,
  marketplace_fee: 15,
  site_id: 'MLM',
  expires: true,
  expiration_date_to: order.expiresAt,
  items: [{ currency_id: 'MXN', quantity: 1, unit_price: '350.00' }],
  init_point: 'https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=' + preferenceId,
  sandbox_init_point: 'https://sandbox.mercadopago.com.mx/checkout/v1/redirect?pref_id=' + preferenceId,
};
const approved = {
  id: Number(paymentId),
  collector_id: Number(collectorId),
  external_reference: orderId,
  live_mode: false,
  status: 'approved',
  status_detail: 'accredited',
  captured: true,
  currency_id: 'MXN',
  transaction_amount: '350.00',
  transaction_amount_refunded: 0,
  payment_type_id: 'credit_card',
  fee_details: [{ type: 'mercadopago_fee', amount: 16 }, { type: 'marketplace_fee', amount: 15 }],
  order: { id: merchantOrderId, type: 'mercadopago' },
};
const merchantOrder = {
  id: Number(merchantOrderId),
  collector: { id: Number(collectorId) },
  external_reference: orderId,
  preference_id: preferenceId,
  site_id: 'mlm',
  total_amount: 350,
  payments: [{ id: Number(paymentId), currency_id: 'MXN', transaction_amount: 350 }],
};

async function withProvider(
  route: (request: Request) => Response | Promise<Response>,
  test: () => Promise<void>,
) {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      assert.equal(new URL(request.url).origin, 'https://api.mercadopago.com');
      assert.equal(request.headers.get('authorization'), 'Bearer ' + fakeToken);
      assert.equal(request.redirect, 'error');
      return await route(request);
    };
    await test();
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test('Checkout Pro sends MXN item price, fixed fee and order-scoped notification URL to the seller API', async () => {
  await withProvider(async (request) => {
    const path = new URL(request.url).pathname;
    if (request.method === 'POST') {
      assert.equal(path, '/checkout/preferences');
      const payload = await request.json();
      assert.deepEqual(payload.items, [{
        id: '1',
        title: 'Folio',
        quantity: 1,
        currency_id: 'MXN',
        unit_price: 350,
      }]);
      assert.equal(payload.marketplace_fee, 15);
      assert.equal(payload.external_reference, orderId);
      assert.deepEqual(payload.metadata, { actv_order_id: orderId, actv_provider: 'mercadopago' });
      assert.equal(payload.notification_url, urls.webhookUrl + '?order_id=' + orderId);
      assert.deepEqual(payload.back_urls, {
        success: urls.success,
        pending: urls.pending,
        failure: urls.failure,
      });
      assert.equal(payload.expires, true);
      assert.equal(payload.expiration_date_to, order.expiresAt);
      assert.deepEqual(payload.payment_methods, {
        installments: 1,
        excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }, { id: 'bank_transfer' }],
      });
    } else {
      assert.equal(path, '/checkout/preferences/' + preferenceId);
    }
    return Response.json(preference);
  }, async () => {
    const result = await createMercadoPagoPreference(fakeToken, order, urls);
    assert.deepEqual(result, { id: preferenceId, checkoutUrl: preference.init_point });
    assert.deepEqual(await getMercadoPagoPreference(fakeToken, preferenceId, order), result);
    await assert.rejects(
      createMercadoPagoPreference(fakeToken, { ...order, testSeller: undefined }, urls),
      /mercadopago_test_seller_required/,
    );
    await assert.rejects(
      createMercadoPagoPreference(fakeToken, order, { ...urls, webhookUrl: 'https://127.0.0.1' }),
      /mercadopago_webhook_configuration/,
    );
  });
});

Deno.test('only the expected Mexican Checkout preference and approved redirect can be reused', async () => {
  const fakeResponses = [
    { ...preference, marketplace_fee: 0 },
    { ...preference, collector_id: 99999999 },
    { ...preference, client_id: '2200000000000002' },
    { ...preference, site_id: 'MLA' },
    { ...preference, external_reference: 'some-other-order' },
    { ...preference, expiration_date_to: new Date(Date.now() + 50_000).toISOString() },
    { ...preference, expires: false },
    { ...preference, items: [{ ...preference.items[0], unit_price: '349.99' }] },
    {
      ...preference,
      init_point: 'https://www.mercadopago.com.mx.example.net/checkout/v1/redirect?pref_id=' + preferenceId,
    },
    { ...preference, init_point: preference.init_point + '&pref_id=alternate' },
    { ...preference, init_point: 'https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=alternate' },
  ];
  for (const response of fakeResponses) {
    await withProvider(() => Response.json(response), async () => {
      await assert.rejects(
        getMercadoPagoPreference(fakeToken, preferenceId, order),
        /mercadopago_(preference|redirect)_mismatch/,
      );
    });
  }
});

Deno.test('only an exact approved captured payment and matching merchant order prove the folio', async () => {
  const paths: string[] = [];
  let response: Record<string, unknown> = approved;
  await withProvider((request) => {
    const path = new URL(request.url).pathname;
    paths.push(path);
    return Response.json(path === '/v1/payments/' + paymentId ? response : merchantOrder);
  }, async () => {
    assert.deepEqual(await verifyMercadoPagoPayment(fakeToken, paymentId, expectedPayment), {
      paymentId,
      merchantOrderId,
      amount: 35_000,
      currency: 'mxn',
      marketplaceFee: 1_500,
      refundedAmount: 0,
    });
    assert.deepEqual(paths, ['/v1/payments/' + paymentId, '/merchant_orders/' + merchantOrderId]);
    response = {
      ...approved,
      payment_type_id: 'account_money',
      fee_details: [{ type: 'mercadopago_fee', amount: 16 }],
    };
    const walletPayment = await getMercadoPagoPayment(fakeToken, paymentId);
    const priorReads = paths.length;
    const result = await verifyMercadoPagoPayment(fakeToken, paymentId, expectedPayment, walletPayment);
    assert.equal(result?.amount, 35_000);
    assert.equal(result?.marketplaceFee, null);
    assert.equal(paths.length, priorReads + 1);
    await assert.rejects(
      verifyMercadoPagoPayment(fakeToken, paymentId, expectedPayment, approved),
      /mercadopago_payment_mismatch/,
    );
  });
});

Deno.test('wrong amounts, states, accounts, currency, fee and purchase binding do not prove payment', async () => {
  let response: Record<string, unknown> = approved;
  await withProvider(
    (request) =>
      Response.json(new URL(request.url).pathname.startsWith('/v1/payments/') ? response : merchantOrder),
    async () => {
      for (
        const changes of [
          { captured: false },
          { external_reference: 'other' },
          { collector_id: 999 },
          { currency_id: 'USD' },
          { transaction_amount: '349.99' },
          { transaction_amount: '350.001' },
          { transaction_details: { total_paid_amount: 349.99 } },
          { coupon_amount: 1 },
          { transaction_amount_refunded: -1 },
          { live_mode: true },
          { id: Number.MAX_SAFE_INTEGER + 1 },
          { payment_type_id: 'ticket' },
        ]
      ) {
        response = { ...approved, ...changes };
        await assert.rejects(
          verifyMercadoPagoPayment(fakeToken, paymentId, expectedPayment),
          /mercadopago_payment_mismatch/,
        );
      }
      for (const status of ['pending', 'authorized', 'rejected', 'refunded', 'charged_back']) {
        response = { ...approved, status };
        assert.equal(
          await verifyMercadoPagoPayment(fakeToken, paymentId, expectedPayment),
          null,
        );
      }
      response = approved;
      await assert.rejects(
        verifyMercadoPagoPayment(fakeToken, paymentId, {
          ...expectedPayment,
          preferenceId: '123456789-other-preference',
        }),
        /mercadopago_merchant_order_mismatch/,
      );
      response = { ...approved, fee_details: [{ type: 'marketplace_fee', amount: 14.99 }] };
      await assert.rejects(
        verifyMercadoPagoPayment(fakeToken, paymentId, expectedPayment),
        /mercadopago_fee_mismatch/,
      );
    },
  );
});

Deno.test('partial and full refunds and chargebacks require proof for the already bound payment', async () => {
  const known = { ...expectedPayment, boundPaymentId: paymentId };
  let response: Record<string, unknown> = approved;
  await withProvider(
    (request) =>
      Response.json(new URL(request.url).pathname.startsWith('/v1/payments/') ? response : merchantOrder),
    async () => {
      assert.equal(await verifyMercadoPagoReversal(fakeToken, paymentId, known), null);
      response = {
        ...approved,
        status_detail: 'partially_refunded',
        transaction_amount_refunded: '200.00',
      };
      assert.deepEqual(await verifyMercadoPagoReversal(fakeToken, paymentId, known), {
        paymentId,
        merchantOrderId,
        amount: 35_000,
        currency: 'mxn',
        refundedAmount: 20_000,
        state: 'approved',
      });
      assert.equal(await verifyMercadoPagoPayment(fakeToken, paymentId, known), null);
      const full = {
        ...approved,
        status: 'refunded',
        status_detail: 'refunded',
        transaction_amount_refunded: 350,
      };
      response = full;
      assert.equal(
        (await verifyMercadoPagoReversal(fakeToken, paymentId, known))?.refundedAmount,
        35_000,
      );
      response = { ...full, transaction_amount_refunded: 0 };
      await assert.rejects(
        verifyMercadoPagoReversal(fakeToken, paymentId, known),
        /mercadopago_refund_mismatch/,
      );
      response = { ...approved, status: 'charged_back' };
      assert.equal(
        (await verifyMercadoPagoReversal(fakeToken, paymentId, known))?.state,
        'charged_back',
      );
      assert.equal(
        await verifyMercadoPagoReversal(fakeToken, paymentId, { ...known, boundPaymentId: '2123' }),
        null,
      );
    },
  );
});

Deno.test('Mercado Pago webhook signature authenticates the exact query payment ID and request ID', async () => {
  const currentTime = 1_742_505_638_683;
  const secret = 'fixture_webhook_secret';
  const requestId = 'bb56a2f1-6aae-46ac-982e-9dcd3581d08e';
  const url = urls.webhookUrl + '?order_id=' + orderId + '&data.id=' + paymentId + '&type=payment';
  const sign = (timestamp: string) => {
    const manifest = 'id:' + paymentId + ';request-id:' + requestId + ';ts:' + timestamp + ';';
    const hash = createHmac('sha256', secret).update(manifest).digest('hex');
    return 'ts=' + timestamp + ',v1=' + hash;
  };
  const request = (to: string, signed: string, header = requestId) =>
    new Request(to, {
      method: 'POST',
      headers: { 'x-request-id': header, 'x-signature': signed },
    });
  for (const timestamp of [String(currentTime), String(Math.floor(currentTime / 1000))]) {
    assert.deepEqual(await verifyMercadoPagoWebhook(request(url, sign(timestamp)), secret, currentTime), {
      paymentId,
      requestId,
    });
  }
  const signature = sign(String(currentTime));
  for (
    const untrusted of [
      request(url.replace(paymentId, '445566'), signature),
      request(url + '&data.id=' + paymentId, signature),
      request(url.replace('type=payment', 'type=orders'), signature),
      request(url, signature, 'alternate_request'),
      request(url, signature + ',ts=' + currentTime),
      request(url, sign(String(currentTime - 600_000))),
    ]
  ) {
    await assert.rejects(
      verifyMercadoPagoWebhook(untrusted, secret, currentTime),
      /mercadopago_invalid_signature/,
    );
  }
});
