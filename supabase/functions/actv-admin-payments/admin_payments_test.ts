import { deepStrictEqual as assertEquals } from 'node:assert/strict';
import { adminPaymentsHandler } from './index.ts';

const orderId = '00000000-0000-4000-8000-000000000010';
const actor = '00000000-0000-4000-8000-000000000011';
const refundRequest = '00000000-0000-4000-8000-000000000012';
const account = 'acct_TestOrganizer';
const chargeId = 'ch_TestCharge';
const paymentId = 'pi_TestPayment';
const refundId = 're_TestRefund';
const payment = {
  id: orderId,
  channel: 'online',
  state: 'issued',
  account_id: account,
  charge_id: chargeId,
  payment_id: paymentId,
  amount: 35000,
  currency: 'mxn',
  adjustments: [],
  refund_request: null,
};
const charge = {
  id: chargeId,
  livemode: false,
  currency: 'mxn',
  payment_intent: paymentId,
  amount_captured: 35000,
  paid: true,
  captured: true,
  payment_method_details: { type: 'card' },
  refunded: false,
  amount_refunded: 0,
  disputed: false,
};
const providerRefund = {
  id: refundId,
  charge: chargeId,
  payment_intent: paymentId,
  currency: 'mxn',
  amount: 35000,
  status: 'succeeded',
  metadata: { actv_refund_request_id: refundRequest },
};
const action = {
  action: 'refund',
  orderId,
  reason: 'requested_by_customer',
  refundCommission: true,
  confirmed: true,
};

async function runFixture(
  options: {
    manager?: boolean;
    ageHours?: number;
    alreadyRefunded?: boolean;
    differentMode?: boolean;
    noToken?: boolean;
  },
) {
  const values = {
    ACTV_APP_URL: 'http://127.0.0.1:3000',
    ACTV_STRIPE_MODE: 'test',
    ACTV_STRIPE_SECRET_KEY: 'sk_test_fixture',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  };
  const previous = Object.keys(values).map((key) => [key, Deno.env.get(key)] as const);
  for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const recordedRequest = {
    id: refundRequest,
    requested_at: new Date(Date.now() - (options.ageHours ?? 0) * 3600_000).toISOString(),
    reason: action.reason,
    refund_application_fee: action.refundCommission,
    provider_refund_id: null,
    status: null,
  };
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === '/auth/v1/user') return Response.json({ id: actor });
    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.split('/').at(-1)!;
      calls.push(name);
      const args = await req.json();
      if (name === 'actv_admin_payment') {
        assertEquals(args, { p_operator: actor, p_live_mode: false, p_order: orderId });
        if (options.manager === false) {
          return Response.json({ code: '42501', message: 'No autorizado' }, { status: 403 });
        }
        return Response.json({
          ...payment,
          refund_request: options.ageHours ? recordedRequest : null,
        });
      }
      if (name === 'actv_admin_begin_refund') {
        assertEquals(args.p_operator, actor);
        assertEquals(args.p_refund_application_fee, true);
        return Response.json({ ...payment, refund_request: recordedRequest });
      }
      if (name === 'actv_admin_finalize_refund') {
        assertEquals(args.p_refund, refundId);
        assertEquals(args.p_status, 'succeeded');
        return Response.json('succeeded');
      }
    }
    assertEquals(req.headers.get('stripe-account'), account);
    calls.push(`${req.method} ${path}`);
    if (path === `/v1/charges/${chargeId}`) {
      return Response.json({ ...charge, livemode: options.differentMode ?? false });
    }
    if (path === '/v1/refunds' && req.method === 'GET') {
      assertEquals(url.searchParams.get('charge'), chargeId);
      return Response.json({ data: options.alreadyRefunded ? [providerRefund] : [], has_more: false });
    }
    if (path === '/v1/refunds' && req.method === 'POST') {
      assertEquals(req.headers.get('idempotency-key'), `actv-full-refund-${refundRequest}`);
      const params = new URLSearchParams(await req.text());
      assertEquals(params.get('charge'), chargeId);
      assertEquals(params.get('amount'), '35000');
      assertEquals(params.get('refund_application_fee'), 'true');
      assertEquals(params.get('metadata[actv_refund_request_id]'), refundRequest);
      return Response.json(providerRefund);
    }
    throw new Error(`Unexpected request ${path}`);
  };
  try {
    const response = await adminPaymentsHandler(
      new Request('http://127.0.0.1/functions/v1/actv-admin-payments', {
        method: 'POST',
        headers: options.noToken ? {} : { authorization: 'Bearer synthetic-session' },
        body: JSON.stringify(action),
      }),
    );
    return { status: response.status, body: await response.json(), calls };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

Deno.test('refund requires a manager and verified session before accessing Stripe', async () => {
  const unauthenticated = await runFixture({ noToken: true });
  assertEquals(unauthenticated.status, 401);
  assertEquals(unauthenticated.calls, []);
  const cashier = await runFixture({ manager: false });
  assertEquals(cashier.status, 403);
  assertEquals(cashier.calls, ['actv_admin_payment']);
});

Deno.test('refund binds amount and provider mode to the captured charge and records the adjustment', async () => {
  const wrongMode = await runFixture({ differentMode: true });
  assertEquals(wrongMode.status, 409);
  assertEquals(wrongMode.calls, ['actv_admin_payment', `GET /v1/charges/${chargeId}`]);
  const success = await runFixture({});
  assertEquals(success.status, 200);
  assertEquals(success.body, { id: refundId, status: 'succeeded', amount: 35000 });
  assertEquals(success.calls, [
    'actv_admin_payment',
    `GET /v1/charges/${chargeId}`,
    'GET /v1/refunds',
    'actv_admin_begin_refund',
    'POST /v1/refunds',
    'actv_admin_finalize_refund',
  ]);
});

Deno.test('old requests never POST after the safe idempotency window but can recover a matching Stripe refund', async () => {
  const stale = await runFixture({ ageHours: 25 });
  assertEquals(stale.status, 409);
  assertEquals(stale.body, { error: 'refund_needs_reconciliation' });
  assertEquals(stale.calls.includes('POST /v1/refunds'), false);
  const recovered = await runFixture({ ageHours: 25, alreadyRefunded: true });
  assertEquals(recovered.status, 200);
  assertEquals(recovered.calls.includes('POST /v1/refunds'), false);
  assertEquals(recovered.calls.at(-1), 'actv_admin_finalize_refund');
});
