import { organizerHandler } from './index.ts';

const organizerId = '01111111-1111-4111-8111-111111111111';
const eventId = '02222222-2222-4222-8222-222222222222';
const accountId = 'acct_organizer1';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function withOrganizer(
  fetcher: (request: Request, path: string) => Promise<Response>,
  run: () => Promise<void>,
) {
  const values = {
    ACTV_STRIPE_MODE: 'test',
    ACTV_STRIPE_SECRET_KEY: 'sk_test_organizer_fixture',
    ACTV_APP_URL: 'http://localhost:3000',
    SUPABASE_URL: 'https://unit-test.invalid',
    SUPABASE_SECRET_KEYS: '{"default":"unit-test-placeholder"}',
  };
  const previous = new Map(Object.keys(values).map((key) => [key, Deno.env.get(key)]));
  const originalFetch = globalThis.fetch;
  try {
    for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const { pathname } = new URL(request.url);
      if (pathname === '/auth/v1/user') return Response.json({ id: 'operator-1' });
      return await fetcher(request, pathname);
    };
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

const invoke = (action: 'onboard' | 'status') =>
  organizerHandler(
    new Request('http://localhost/organizers', {
      method: 'POST',
      headers: { authorization: 'Bearer fixture-token' },
      body: JSON.stringify({ action, eventId }),
    }),
  );

const organizer = {
  organizer_id: organizerId,
  live_mode: false,
  online_enabled: false,
  slug: 'carrera-prueba',
  event_name: 'Carrera prueba',
};

Deno.test('Accounts v2 creation and onboarding keep organizer payouts on their Mexican account', async () => {
  let savedId: string | null = null;
  const calls: string[] = [];
  await withOrganizer(async (request, path) => {
    calls.push(path);
    if (path.endsWith('/actv_organizer')) {
      const input = await request.json();
      assert(input.p_operator === 'operator-1' && input.p_event_id === eventId, 'authorized organizer scope');
      return Response.json({ ...organizer, account_id: savedId });
    }
    if (path === '/v2/core/accounts') {
      const input = await request.json();
      assert(request.method === 'POST', 'creates through Accounts v2');
      assert(request.headers.get('idempotency-key') === `actv-organizer-${organizerId}`, 'idempotent create');
      assert(input.dashboard === 'full' && input.identity.country === 'MX', 'Mexican full dashboard');
      assert(input.configuration.merchant.capabilities.card_payments.requested, 'merchant cards requested');
      const { fees_collector, losses_collector } = input.defaults.responsibilities;
      assert(fees_collector === 'stripe' && losses_collector === 'stripe', 'Stripe handles fees and losses');
      assert(input.metadata.actv_organizer_id === organizerId, 'organizer metadata');
      return Response.json({ id: accountId, livemode: false });
    }
    if (path === `/v1/accounts/${accountId}`) {
      assert(request.method === 'GET', 'v1 read returns capability flags for the v2 merchant');
      return Response.json({ id: accountId, type: 'standard', country: 'MX', details_submitted: true });
    }
    if (path.endsWith('/actv_set_account')) {
      const input = await request.json();
      assert(input.p_account_id === accountId && input.p_ready === false, 'incomplete organizer cannot sell');
      savedId = input.p_account_id;
      return Response.json({ ...organizer, account_id: savedId });
    }
    if (path === '/v2/core/account_links') {
      assert(savedId === accountId, 'persist account before returning its link');
      const input = await request.json();
      assert(
        input.account === savedId && input.use_case.type === 'account_onboarding',
        'link to correct organizer',
      );
      const { return_url, refresh_url } = input.use_case.account_onboarding;
      assert(return_url === `http://localhost:3000/organizadores?evento=${eventId}`, 'return URL');
      assert(refresh_url === `${return_url}&reanudar=1`, 'refresh URL');
      return Response.json({
        account: savedId,
        livemode: false,
        url: 'https://accounts.stripe.com/r/test#link',
      });
    }
    throw new Error(`Unexpected path ${path}`);
  }, async () => {
    const empty = await invoke('status');
    assert(
      empty.ok && (await empty.json()).accountId === null && calls.length === 1,
      'status does not create',
    );
    const response = await invoke('onboard');
    assert(response.ok, 'onboarding succeeded');
    const result = await response.json();
    assert(
      !result.ready && result.detailsSubmitted && !result.chargesEnabled,
      'Stripe capabilities control readiness',
    );
    assert(
      result.onboardingUrl === 'https://accounts.stripe.com/r/test#link',
      'accepts Stripe v2 hosted link',
    );
    const again = await invoke('onboard');
    await again.json();
    assert(
      again.ok && calls.filter((path) => path === '/v2/core/accounts').length === 1,
      'reuses saved account',
    );
  });
});

Deno.test('Organizer account reuse validates link origin, account binding and sandbox mode', async () => {
  let ready = true;
  let link = { account: accountId, livemode: false, url: 'https://accounts.stripe.com/r/test#link' };
  await withOrganizer(async (_request, path) => {
    if (path.endsWith('/actv_organizer') || path.endsWith('/actv_set_account')) {
      return Response.json({ ...organizer, account_id: accountId });
    }
    if (path === `/v1/accounts/${accountId}`) {
      return Response.json({
        id: accountId,
        type: 'standard',
        country: 'MX',
        charges_enabled: ready,
        payouts_enabled: ready,
        details_submitted: ready,
      });
    }
    if (path === '/v2/core/account_links' && !ready) return Response.json(link);
    throw new Error(`Unexpected path ${path}`);
  }, async () => {
    const existing = await invoke('onboard');
    const result = await existing.json();
    assert(
      existing.ok && result.ready && !result.onboardingUrl,
      'ready Standard account does not need a new link',
    );

    ready = false;
    for (
      const [change, error] of [
        [{ url: 'https://accounts.stripe.com.attacker.invalid/r/test' }, 'provider_redirect_mismatch'],
        [{ url: 'https://accounts.stripe.com:8443/r/test' }, 'provider_redirect_mismatch'],
        [{ account: 'acct_different' }, 'stripe_account_unavailable'],
        [{ livemode: true }, 'payment_mode_mismatch'],
      ] as const
    ) {
      const original = link;
      link = { ...original, ...change };
      const response = await invoke('onboard');
      assert(response.status === 409 && (await response.json()).error === error, 'invalid link blocked');
      link = original;
    }
  });
});

Deno.test('Organizer onboarding checks the event mode before calling Stripe', async () => {
  await withOrganizer(async (request, path) => {
    if (!path.endsWith('/actv_organizer')) throw new Error('A mismatched event must not call Stripe');
    const input = await request.json();
    assert(!('p_live_mode' in input), 'reads the event mode without overriding it');
    return Response.json({ ...organizer, account_id: null, live_mode: true });
  }, async () => {
    for (const action of ['status', 'onboard'] as const) {
      const response = await invoke(action);
      assert(response.status === 409 && (await response.json()).error === 'payment_mode_mismatch', 'other mode blocked');
    }
  });
});
