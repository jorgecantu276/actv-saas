import { checkoutHandler } from '../actv-checkout/index.ts';
import { terminalHandler } from '../actv-stripe-terminal/index.ts';
import { signedEvent, webhookHandler } from '../actv-stripe-webhook/index.ts';
import { captureProof, Stripe } from './stripe.ts';

const orderId = '01111111-1111-4111-8111-111111111111';
const orderToken = '02222222-2222-4222-8222-222222222222';
const requestId = '03333333-3333-4333-8333-333333333333';
const account = 'acct_demo456';
const sessionId = 'cs_test_demo456';
const webhookSecret = 'whsec_isolated_unit_test_value';

const order = {
  order_id: orderId,
  status_token: orderToken,
  state: 'pending',
  channel: 'online',
  amount: 1000,
  application_fee_amount: 0,
  buyer_email: 'runner@example.test',
  currency: 'mxn',
  account_id: account,
  live_mode: false,
  reader_id: null,
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 45 * 60_000).toISOString(),
  items: [{ name: 'Individual', amount: 1000 }],
  provider_session_id: sessionId,
  provider_payment_id: null,
};

const metadata = { actv_order_id: orderId, actv_channel: 'online' };
const paid = {
  id: 'pi_test000',
  status: 'succeeded',
  metadata,
  livemode: false,
  amount: 1000,
  amount_received: 1000,
  currency: 'mxn',
  latest_charge: {
    id: 'ch_test000',
    captured: true,
    paid: true,
    livemode: false,
    currency: 'mxn',
    amount_captured: 1000,
    payment_intent: 'pi_test000',
    payment_method_details: { type: 'card' },
    amount_refunded: 0,
    disputed: false,
  },
} as unknown as Stripe.PaymentIntent;

const session = {
  id: sessionId,
  mode: 'payment',
  status: 'complete',
  payment_status: 'paid',
  livemode: false,
  amount_total: 1000,
  currency: 'mxn',
  client_reference_id: orderId,
  metadata,
  payment_intent: paid,
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function request(url: string, data: Record<string, unknown>): Request {
  return new Request(url, { method: 'POST', body: JSON.stringify(data) });
}

const stripeClient = new Stripe('sk_test_unit_only', { httpClient: Stripe.createFetchHttpClient() });

async function webhookEvent(
  data: Record<string, unknown>,
  changes: Record<string, unknown> = {},
): Promise<Request> {
  const raw = JSON.stringify({
    id: 'evt_test000',
    type: 'checkout.session.completed',
    livemode: false,
    account,
    data: { object: data },
    ...changes,
  });
  const signature = await stripeClient.webhooks.generateTestHeaderStringAsync({
    payload: raw,
    secret: webhookSecret,
  });
  return new Request('http://localhost/webhook', {
    method: 'POST',
    body: raw,
    headers: { 'stripe-signature': signature },
  });
}

async function withMockFetch(fetcher: typeof fetch, run: () => Promise<void>): Promise<void> {
  const values = {
    ACTV_STRIPE_MODE: 'test',
    ACTV_STRIPE_SECRET_KEY: 'sk_test_unit_only',
    ACTV_STRIPE_WEBHOOK_SECRET: webhookSecret,
    SUPABASE_URL: 'https://unit-test.invalid',
    SUPABASE_SECRET_KEYS: '{"default":"unit-test-placeholder"}',
    ACTV_APP_URL: 'http://localhost:3000',
  };
  const saved = new Map(Object.keys(values).map((name) => [name, Deno.env.get(name)]));
  const originalFetch = globalThis.fetch;
  try {
    for (const [name, value] of Object.entries(values)) Deno.env.set(name, value);
    // These provider-contract cases assume an open, already-authorized gate.
    // sales_gate_test separately proves a denied authorization never calls Stripe.
    globalThis.fetch = (input, init) => {
      if (new URL(new Request(input, init).url).pathname.endsWith('actv_authorize_provider_attempt')) {
        return Promise.resolve(Response.json(true));
      }
      return fetcher(input, init);
    };
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of saved) {
      if (value == null) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

Deno.test('capture proof requires a successful captured charge in the same mode for the channel', () => {
  assert(captureProof(paid, 'online', false)?.chargeId === 'ch_test000', 'captured online payment');
  assert(
    captureProof({ ...paid, status: 'requires_capture' }, 'online', false) === null,
    'authorization cannot issue',
  );
  assert(captureProof(paid, 'terminal', false) === null, 'channel mismatch cannot issue');
  for (
    const intent of [{ ...paid, amount_received: 999 }, { ...paid, livemode: true }, {
      ...paid,
      latest_charge: { ...(paid.latest_charge as Stripe.Charge), captured: false },
    }]
  ) {
    let rejected = false;
    try {
      captureProof(intent, 'online', false);
    } catch {
      rejected = true;
    }
    assert(rejected, 'incorrect amount, mode, and explicit uncaptured charge reject');
  }
});

Deno.test('webhook uses the raw body and rejects changes or stale signatures', async () => {
  const hook = await webhookEvent({ id: sessionId, metadata });
  const raw = await hook.text();
  const signature = hook.headers.get('stripe-signature')!;
  assert(
    (await signedEvent(stripeClient, raw, signature, webhookSecret)).id === 'evt_test000',
    'signed event accepted',
  );
  const old = await stripeClient.webhooks.generateTestHeaderStringAsync({
    payload: raw,
    secret: webhookSecret,
    timestamp: Math.floor(Date.now() / 1000) - 900,
  });
  for (const pair of [[`${raw}\n`, signature], [raw, old]]) {
    let rejected = false;
    try {
      await signedEvent(stripeClient, pair[0], pair[1], webhookSecret);
    } catch {
      rejected = true;
    }
    assert(rejected, 'signature must bind exact bytes and fresh timestamp');
  }
});

Deno.test('public checkout uses DB price, Stripe connected account, idempotency, and attaches before returning URL', async () => {
  let firstBinding = true;
  let linkedSession: string | null = null;
  const calls: string[] = [];
  const providerParameters: string[] = [];
  const openSession = {
    ...session,
    status: 'open',
    payment_status: 'unpaid',
    payment_intent: null,
    url: 'https://checkout.stripe.com/c/pay/test',
  };
  await withMockFetch(async (input, init) => {
    const req = new Request(input, init);
    const path = new URL(req.url).pathname;
    calls.push(path.split('/').at(-1)!);
    if (path.endsWith('actv_create_order')) {
      const body = await req.json();
      assert(body.p_items[0].package === 1 && !('amount' in body.p_items[0]), 'client price discarded');
      assert(body.p_request_id === requestId, 'client order idempotency');
      return Response.json({ ...order, provider_session_id: linkedSession });
    }
    if (req.url.startsWith('https://api.stripe.com/')) {
      if (req.method === 'GET') {
        assert(linkedSession === sessionId, 'existing Checkout identity was persisted before the response');
        return Response.json(openSession);
      }
      const form = new URLSearchParams(await req.text());
      assert(req.headers.get('stripe-account') === account, 'connected charge');
      assert(req.headers.get('idempotency-key') === `actv-checkout-${orderId}`, 'provider idempotency');
      assert(form.get('line_items[0][price_data][unit_amount]') === '1000', 'authoritative amount');
      assert(form.get('allowed_payment_method_types[0]') === 'card', 'explicit card method');
      assert(form.get('adaptive_pricing[enabled]') === 'false', 'keep Checkout prices in MXN');
      assert(form.get('customer_email') === order.buyer_email, 'use persisted email on every retry');
      const returnUrl = new URL(form.get('success_url')!);
      assert(
        returnUrl.searchParams.get('orden') === orderId && returnUrl.hash === `#token=${orderToken}`,
        'private status token in fragment',
      );
      providerParameters.push(form.toString());
      return Response.json(openSession);
    }
    if (path.endsWith('actv_attach_provider')) {
      assert((await req.json()).p_session_id === sessionId, 'bind exact Stripe session');
      if (firstBinding) {
        firstBinding = false;
        return Response.json({ code: '08006' }, { status: 503 });
      }
      linkedSession = sessionId;
      return Response.json(order);
    }
    throw new Error(`Unexpected path ${path}`);
  }, async () => {
    const start = (email: string) =>
      checkoutHandler(
        request('http://localhost/checkout', {
          action: 'start',
          eventId: orderId,
          buyerEmail: email,
          idempotencyKey: requestId,
          participants: [{
            nombre: 'Runner',
            apellido: 'Test',
            telefono: '123456',
            telefono_emergencia: '123456',
            talla_playera: 'M',
            package: 1,
            amount: 1,
          }],
        }),
      );
    const first = await start('RUNNER@example.test');
    const failure = await first.json();
    assert(
      first.status === 503 && !failure.checkoutUrl && !failure.orderToken,
      'no links or tokens before binding',
    );
    const response = await start('runner@example.test');
    const data = await response.json();
    assert(response.ok && data.checkoutUrl && data.folios.length === 0, 'no folio from Checkout creation');
    assert(
      providerParameters.length === 2 && providerParameters[0] === providerParameters[1],
      'exact Stripe request retried',
    );
    assert(
      calls.join(',') ===
        'actv_create_order,sessions,actv_attach_provider,actv_create_order,sessions,actv_attach_provider,' +
          sessionId,
      'same Checkout attached and retrieved before output',
    );
  });
});

Deno.test('signed event only issues from exact bound session and can replay safely', async () => {
  let processed = false;
  let confirmed = 0;
  let validBinding = true;
  await withMockFetch(async (input, init) => {
    const req = new Request(input, init);
    const path = new URL(req.url).pathname;
    if (path.endsWith('actv_record_stripe_event')) return Response.json({ processed });
    if (req.url.startsWith('https://api.stripe.com/')) {
      assert(req.headers.get('stripe-account') === account, 'fetch provider event object in account scope');
      return Response.json(session);
    }
    if (path.endsWith('actv_read_order')) {
      return Response.json({ ...order, provider_session_id: validBinding ? sessionId : 'cs_other' });
    }
    if (path.endsWith('actv_confirm_stripe')) {
      const args = await req.json();
      assert(
        args.p_charge_id === 'ch_test000' && args.p_payment_id === 'pi_test000' &&
          args.p_session_id === sessionId,
        'capture evidence persistence',
      );
      confirmed++;
      return Response.json({ ...order, state: 'issued' });
    }
    if (path.endsWith('actv_finish_stripe_event')) {
      processed = true;
      return Response.json(null);
    }
    throw new Error(`Unexpected path ${path}`);
  }, async () => {
    const validEvent = await webhookHandler(await webhookEvent({ id: sessionId, metadata }));
    assert(validEvent.ok, 'initial webhook confirmed');
    const replay = await webhookHandler(await webhookEvent({ id: sessionId, metadata }));
    assert(
      (await replay.json()).duplicate && confirmed === 1,
      'processed event replay performs no confirmation',
    );
    processed = false;
    validBinding = false;
    const unbound = await webhookHandler(await webhookEvent({ id: sessionId, metadata }));
    assert(
      unbound.ok && confirmed === 1,
      'other session with matching user-controlled metadata cannot issue',
    );
    const wrongMode = await webhookHandler(
      await webhookEvent({ id: sessionId, metadata }, { livemode: true }),
    );
    assert((await wrongMode.json()).ignored, 'different-mode events never applied');
  });
});

Deno.test('a preexisting full refund is recorded before capture confirmation', async () => {
  const writes: string[] = [];
  await withMockFetch(async (input, init) => {
    const req = new Request(input, init);
    const path = new URL(req.url).pathname;
    if (path.endsWith('actv_record_stripe_event')) return Response.json({ processed: false });
    if (path.endsWith(sessionId)) {
      return Response.json({
        ...session,
        payment_intent: {
          ...paid,
          latest_charge: { ...paid.latest_charge as Stripe.Charge, refunded: true, amount_refunded: 1000 },
        },
      });
    }
    if (path.endsWith('/refunds')) {
      return Response.json({
        object: 'list',
        has_more: false,
        data: [
          { id: 're_note000', payment_intent: paid.id, currency: 'mxn', amount: 1000, status: 'succeeded' },
        ],
      });
    }
    if (path.endsWith('actv_read_order')) return Response.json(order);
    if (path.endsWith('actv_record_adjustment')) {
      writes.push('refund');
      assert((await req.json()).p_reference === 're_note000', 'refund provider identity');
      return Response.json(null);
    }
    if (path.endsWith('actv_confirm_stripe')) {
      writes.push('capture');
      return Response.json({ ...order, state: 'voided' });
    }
    if (path.endsWith('actv_finish_stripe_event')) return Response.json(null);
    throw new Error(`Unexpected path ${path}`);
  }, async () => {
    const response = await webhookHandler(await webhookEvent({ id: sessionId, metadata }));
    assert(response.ok && writes.join(',') === 'refund,capture', 'SQL sees refund before eligibility check');
  });
});

Deno.test('hosted webhook acknowledges the persisted event before retrieving Stripe', async () => {
  const scope = globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil: (work: Promise<void>) => void };
  };
  const previous = scope.EdgeRuntime;
  let task: Promise<void> | undefined;
  let recorded = false;
  let finalized = false;
  let allowStripe!: () => void;
  const stripeReady = new Promise<void>((resolve) => {
    allowStripe = resolve;
  });
  scope.EdgeRuntime = {
    waitUntil: (work) => {
      task = work;
    },
  };

  try {
    await withMockFetch(async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (path.endsWith('actv_record_stripe_event')) {
        recorded = true;
        return Response.json({ processed: false });
      }
      if (path.endsWith('actv_claim_received_stripe_event')) {
        assert(recorded, 'event persisted before claim');
        const key = await request.json();
        return Response.json({
          account_id: key.p_account_id,
          live_mode: key.p_live_mode,
          event_id: key.p_event_id,
          object_id: sessionId,
          order_id: orderId,
          event_type: 'checkout.session.completed',
          lease: '11111111-1111-4111-8111-111111111111',
        });
      }
      if (path.endsWith(sessionId)) {
        await stripeReady;
        return Response.json(session);
      }
      if (path.endsWith('actv_read_order')) return Response.json(order);
      if (path.endsWith('actv_confirm_stripe')) return Response.json({ ...order, state: 'issued' });
      if (path.endsWith('actv_finish_stripe_event_retry')) {
        const result = await request.json();
        assert(result.p_lease === '11111111-1111-4111-8111-111111111111', 'finishes own lease');
        assert(result.p_failure_code === null, 'valid background event completes');
        finalized = true;
        return Response.json(true);
      }
      throw new Error(`Unexpected path ${path}`);
    }, async () => {
      try {
        const response = await webhookHandler(await webhookEvent({ id: sessionId, metadata }));
        assert(
          response.ok && (await response.json()).queued && !!task && recorded && !finalized,
          'responds after saving',
        );
      } finally {
        allowStripe();
        await task;
      }
      assert(finalized, 'persistent event is marked complete after processing');
    });
  } finally {
    if (previous) scope.EdgeRuntime = previous;
    else delete scope.EdgeRuntime;
  }
});

Deno.test('recovery binds only the original Checkout or Terminal object under the ACTV Stripe key', async () => {
  const terminalIntent = {
    ...paid,
    metadata: { ...metadata, actv_channel: 'terminal' },
    latest_charge: {
      ...paid.latest_charge as Stripe.Charge,
      payment_method_details: { type: 'card_present' },
    },
  };
  for (const ageMinutes of [0, 20, 90, 25 * 60]) for (const channel of ['online', 'terminal']) {
    const online = channel === 'online';
    const fixture = online ? session : terminalIntent;
    const providerId = fixture.id;
    const original = { ...order, channel, provider_session_id: null,
      created_at: new Date(Date.now() - ageMinutes * 60_000).toISOString(),
      expires_at: new Date(Date.now() + ((online ? 45 : 15) - ageMinutes) * 60_000).toISOString(),
    };
    let canonical = false;
    let bound = false;
    let processed = false;
    let confirmed = 0;
    let creationRequests = 0;
    await withMockFetch(async (input, init) => {
      const req = new Request(input, init);
      const path = new URL(req.url).pathname;
      if (path.endsWith('actv_record_stripe_event')) return Response.json({ processed });
      if (path.endsWith('actv_read_order')) {
        return Response.json({
          ...original,
          provider_session_id: bound && online ? providerId : null,
          provider_payment_id: bound && !online ? providerId : null,
        });
      }
      if (path.endsWith('actv_attach_provider')) {
        assert(canonical && !bound, 'unbound or noncanonical object must never be attached');
        const args = await req.json();
        assert(args.p_payment_id === paid.id, 'bind the exact Stripe intent');
        assert(
          args.p_session_id === (online ? sessionId : null),
          'bind the exact Checkout session for online',
        );
        bound = true;
        return Response.json(original);
      }
      if (path.endsWith('actv_confirm_stripe')) {
        assert(bound, 'binding must precede issuing');
        confirmed++;
        return Response.json({ ...original, state: 'issued' });
      }
      if (path.endsWith('actv_finish_stripe_event')) {
        processed = true;
        return Response.json(null);
      }
      if (path.endsWith('actv_checked_stripe_event')) return Response.json(null);
      assert(req.headers.get('stripe-account') === account, 'provider ownership checked');
      if (req.method === 'GET' && path.endsWith(providerId)) return Response.json(fixture);
      if (req.method === 'POST' && path.endsWith(online ? '/checkout/sessions' : '/payment_intents')) {
        const operation = online ? 'checkout' : 'terminal-intent';
        assert(
          req.headers.get('idempotency-key') === 'actv-' + operation + '-' + orderId,
          'original provider key reused',
        );
        creationRequests++;
        return Response.json({ ...fixture, id: canonical ? providerId : (online ? 'cs_other' : 'pi_other') });
      }
      throw new Error('Unexpected path ' + path);
    }, async () => {
      const notice = () =>
        webhookEvent({ id: providerId, metadata: fixture.metadata }, {
          type: online ? 'checkout.session.completed' : 'payment_intent.succeeded',
        });
      assert(
        (await webhookHandler(await notice())).status === 503 && !bound && confirmed === 0,
        'mismatched idempotent response cannot issue or be acknowledged as processed',
      );
      if (ageMinutes >= 23 * 60) {
        assert(creationRequests === 0, 'expired idempotency window must not POST a new provider object');
        return;
      }
      canonical = true;
      assert(
        (await webhookHandler(await notice())).ok,
        'canonical session or card-present intent can be recovered',
      );
      assert(bound && Number(confirmed) === 1, 'one folio issued after exact binding');
      const replay = await webhookHandler(await notice());
      assert(
        (await replay.json()).duplicate && Number(confirmed) === 1 && creationRequests === 2,
        'a repeated notice cannot create another object or folio',
      );
    });
  }
});

Deno.test('terminal completion uses the staff token, configured reader and authoritative Stripe intent', async () => {
  const terminalOrder = {
    ...order,
    channel: 'terminal',
    provider_session_id: null,
    provider_payment_id: paid.id,
    reader_id: 'tmr_reader123',
  };
  let active = true;
  const providerPaths: string[] = [];
  await withMockFetch(async (input, init) => {
    const req = new Request(input, init);
    const path = new URL(req.url).pathname;
    if (path.endsWith('/auth/v1/user')) return Response.json({ id: 'operator-1' });
    if (path.endsWith('actv_order_status')) {
      assert((await req.json()).p_operator === 'operator-1', 'staff id from bearer validation');
      return Response.json(terminalOrder);
    }
    if (path.endsWith('actv_read_order')) return Response.json(terminalOrder);
    if (path.endsWith(paid.id)) {
      providerPaths.push(path);
      return Response.json({
        ...paid,
        status: 'requires_payment_method',
        metadata: { ...metadata, actv_channel: 'terminal' },
        latest_charge: null,
      });
    }
    if (path.endsWith(terminalOrder.reader_id)) {
      providerPaths.push(path);
      return Response.json({
        id: terminalOrder.reader_id,
        action: {
          status: active ? 'in_progress' : 'failed',
          process_payment_intent: { payment_intent: active ? paid.id : 'pi_other' },
        },
      });
    }
    throw new Error(`Unexpected path ${path}`);
  }, async () => {
    const terminal = (action: string) =>
      new Request('http://localhost/terminal', {
        method: 'POST',
        headers: { authorization: 'Bearer fixture-token' },
        body: JSON.stringify({ action, orderId, readerId: 'tmr_untrusted' }),
      });
    const status = await (await terminalHandler(terminal('status'))).json();
    assert(
      status.status === 'pending' && status.readerStatus === 'in_progress' && status.folios.length === 0,
      'an active card reader with no capture cannot issue',
    );
    const cancel = await (await terminalHandler(terminal('cancel'))).json();
    assert(
      cancel.status === 'pending' && !providerPaths.some((path) => path.endsWith('/cancel')),
      'cancel does not reset or charge a busy reader',
    );
    active = false;
    const other = await (await terminalHandler(terminal('status'))).json();
    assert(other.readerStatus === null, 'another intent reader action is not returned');
  });
});
