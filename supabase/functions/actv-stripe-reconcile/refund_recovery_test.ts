import { deepStrictEqual as assertEquals } from 'node:assert/strict';
import { reconciliationHandler } from './index.ts';

const refundRequest = '00000000-0000-4000-8000-000000000012';
const order = '00000000-0000-4000-8000-000000000010';
const lease = '2026-11-14T16:00:00+00:00';
const request = {
  id: refundRequest,
  order_id: order,
  account_id: 'acct_TestOrganizer',
  charge_id: 'ch_TestCharge',
  provider_payment_id: 'pi_TestPayment',
  amount: 35000,
  currency: 'mxn',
  lease,
};
const canonical = {
  id: 're_TestRefund',
  charge: request.charge_id,
  payment_intent: request.provider_payment_id,
  amount: request.amount,
  currency: 'mxn',
  status: 'succeeded',
  metadata: { actv_refund_request_id: refundRequest },
};
const storedEvent = {
  account_id: request.account_id,
  live_mode: false,
  event_id: 'evt_TestRetry',
  event_type: 'account.application.deauthorized',
  object_id: request.account_id,
  order_id: null,
  lease: '00000000-0000-4000-8000-000000000013',
};

async function execute(options: {
  found?: typeof canonical;
  providerRefundId?: string;
  hasMore?: boolean;
  secret?: string;
  webhook?: { fail?: boolean; acknowledged: boolean; limit?: number };
}) {
  const env = {
    ACTV_STRIPE_MODE: 'test',
    ACTV_STRIPE_SECRET_KEY: 'sk_test_fixture',
    ACTV_STRIPE_RECONCILE_SECRET: 'test-worker-secret-with-more-than-32-characters',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  };
  const previous = Object.keys(env).map((key) => [key, Deno.env.get(key)] as const);
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  const originalFetch = globalThis.fetch;
  const stripeCalls: string[] = [];
  const recorded: unknown[] = [];
  const failures: unknown[] = [];
  const eventFinishes: unknown[] = [];
  let claims = 0;
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const path = url.pathname;
    if (url.hostname === 'api.stripe.com') {
      assertEquals(req.method, 'GET');
      assertEquals(req.headers.get('stripe-account'), request.account_id);
      stripeCalls.push(path);
      if (path === '/v1/refunds') {
        assertEquals(url.searchParams.get('charge'), request.charge_id);
        assertEquals(url.searchParams.get('limit'), '100');
        return Response.json({
          data: options.found ? [options.found] : [],
          has_more: options.hasMore ?? false,
        });
      }
      if (options.providerRefundId && path === `/v1/refunds/${options.providerRefundId}`) {
        return Response.json(options.found ?? canonical);
      }
    }
    switch (path.split('/').at(-1)) {
      case 'actv_close_unbound_terminals':
        return Response.json(null);
      case 'actv_pending_stripe_orders':
        return Response.json([]);
      case 'actv_claim_stripe_event_retry':
        assertEquals(await req.json(), { p_live_mode: false });
        return Response.json(claims++ === 0 && options.webhook ? storedEvent : null);
      case 'actv_refresh_account':
        assertEquals(await req.json(), {
          p_account_id: request.account_id,
          p_live_mode: false,
          p_ready: false,
        });
        return options.webhook?.fail
          ? Response.json({ code: '42501' }, { status: 403 })
          : Response.json(null);
      case 'actv_finish_stripe_event_retry':
        eventFinishes.push(await req.json());
        return Response.json(options.webhook?.acknowledged);
      case 'actv_pending_participant_refunds':
        return Response.json([]);
      case 'actv_claim_refund_recovery':
        assertEquals(await req.json(), { p_live_mode: false, p_limit: options.webhook?.limit ?? 10 });
        return Response.json([{ ...request, provider_refund_id: options.providerRefundId ?? null }]);
      case 'actv_note_refund_recovery':
        failures.push(await req.json());
        return Response.json(null);
      case 'actv_record_admin_refund':
        recorded.push(await req.json());
        return Response.json(null);
      default:
        throw new Error('Unexpected call ' + path);
    }
  };
  try {
    const output = await reconciliationHandler(
      new Request('http://127.0.0.1/reconcile', {
        method: 'POST',
        headers: { 'x-actv-reconcile-secret': options.secret ?? env.ACTV_STRIPE_RECONCILE_SECRET },
        body: JSON.stringify({ limit: options.webhook?.limit ?? 10 }),
      }),
    );
    return {
      status: output.status,
      data: await output.json(),
      recorded,
      failures,
      stripeCalls,
      claims,
      eventFinishes,
    };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

Deno.test('reconciliation recovers a lost admin refund response with only an exact read and an atomic write', async () => {
  const output = await execute({ found: canonical });
  assertEquals(output.status, 200);
  assertEquals(output.data.refunds, { attempted: 1, failed: 0, notFound: 0 });
  assertEquals(output.stripeCalls, ['/v1/refunds']);
  assertEquals(output.recorded, [{
    p_live_mode: false,
    p_order: order,
    p_request: refundRequest,
    p_refund: canonical.id,
    p_status: 'succeeded',
  }]);
  assertEquals(output.failures, []);
});

Deno.test('reconciliation verifies known refund IDs and leaves unmatched or incomplete results for review', async () => {
  const existing = await execute({ providerRefundId: canonical.id });
  assertEquals(existing.stripeCalls, [`/v1/refunds/${canonical.id}`]);
  assertEquals(existing.recorded.length, 1);
  const missing = await execute({ found: { ...canonical, metadata: { actv_refund_request_id: order } } });
  assertEquals(missing.data.refunds, { attempted: 1, failed: 0, notFound: 1 });
  assertEquals(missing.recorded, []);
  assertEquals(missing.failures, [{
    p_request: refundRequest,
    p_lease: lease,
    p_failure: 'refund_not_found',
  }]);
  const invalid = await execute({ found: { ...canonical, amount: 34999 } });
  assertEquals(invalid.data.refunds, { attempted: 1, failed: 1, notFound: 0 });
  assertEquals(invalid.recorded, []);
  assertEquals(invalid.failures, [{
    p_request: refundRequest,
    p_lease: lease,
    p_failure: 'provider_refund_mismatch',
  }]);
  const incomplete = await execute({ found: canonical, hasMore: true });
  assertEquals(incomplete.recorded, []);
  assertEquals(incomplete.failures, [{
    p_request: refundRequest,
    p_lease: lease,
    p_failure: 'refund_lookup_incomplete',
  }]);
});

Deno.test('reconciliation rejects a request without the worker secret before Stripe or DB calls', async () => {
  const output = await execute({ secret: 'invalid' });
  assertEquals(output.status, 401);
  assertEquals(output.stripeCalls, []);
  assertEquals(output.recorded, []);
});

Deno.test('webhook retries acknowledge the claimed lease and respect the per-run event limit', async () => {
  const result = await execute({ webhook: { acknowledged: true, limit: 1 } });
  assertEquals(result.status, 200);
  assertEquals(result.claims, 1);
  assertEquals(result.data.events, { attempted: 1, failed: 0 });
  assertEquals(result.eventFinishes, [{
    p_account_id: request.account_id,
    p_live_mode: false,
    p_event_id: storedEvent.event_id,
    p_lease: storedEvent.lease,
    p_failure_code: null,
  }]);
});

Deno.test('webhook retries distinguish a failed lease from one completed by a foreground webhook', async () => {
  const failed = await execute({ webhook: { fail: true, acknowledged: true } });
  assertEquals(failed.data.events, { attempted: 1, failed: 1 });
  assertEquals(failed.eventFinishes, [{
    p_account_id: request.account_id,
    p_live_mode: false,
    p_event_id: storedEvent.event_id,
    p_lease: storedEvent.lease,
    p_failure_code: 'access_denied',
  }]);
  const superseded = await execute({ webhook: { fail: true, acknowledged: false } });
  assertEquals(superseded.data.events, { attempted: 1, failed: 0 });
});
