import { createCheckoutSession, createTerminalIntent, Stripe } from './stripe.ts';
import type { Order } from './orders.ts';

for (const channel of ['online', 'terminal'] as const) {
  Deno.test(`paused sales gate blocks ${channel} provider creation before external HTTP`, async () => {
    const values = { SUPABASE_URL: 'https://sales-gate.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only',
      ACTV_STRIPE_MODE: 'test', ACTV_APP_URL: 'http://localhost:3000' };
    const previous = new Map(Object.keys(values).map(name => [name,Deno.env.get(name)]));
    const priorSecret = Deno.env.get('SUPABASE_SECRET_KEYS');
    const original = globalThis.fetch;
    let calls = 0;
    try {
      Deno.env.delete('SUPABASE_SECRET_KEYS');
      for (const [name,value] of Object.entries(values)) Deno.env.set(name,value);
      globalThis.fetch = async (input,init) => {
        const request = new Request(input,init);
        const url = new URL(request.url);
        if (url.hostname !== 'sales-gate.invalid' || !url.pathname.endsWith('/actv_authorize_provider_attempt')) {
          throw new Error('Paused provider attempt reached external HTTP');
        }
        const body = await request.json();
        if (body.p_kind !== (channel === 'online' ? 'checkout' : 'terminal_intent') || body.p_attempt !== 'canonical') {
          throw new Error('Canonical authorization is required');
        }
        calls++;
        return Response.json({code:'P0001',message:'Ventas pausadas'},{status:400});
      };
      const stripe = new Stripe('sk_test_synthetic', {httpClient:Stripe.createFetchHttpClient()});
      const order = {order_id:'01111111-1111-4111-8111-111111111111',channel,
        created_at:new Date().toISOString(),expires_at:new Date(Date.now()+45*60_000).toISOString(),
        buyer_email:'synthetic@example.invalid',status_token:'02222222-2222-4222-8222-222222222222',
        items:[],amount:1000,currency:'mxn',application_fee_amount:0} as unknown as Order;
      let denied = false;
      try {
        if (channel === 'online') await createCheckoutSession(stripe,order,'acct_synthetic');
        else await createTerminalIntent(stripe,order,'acct_synthetic');
      } catch (error) { denied = (error as {code?:string}).code === 'order_conflict_or_unavailable'; }
      if (!denied || calls !== 1) throw new Error('Gate denial must stop creation');
    } finally {
      globalThis.fetch = original;
      for (const [name,value] of previous) {
        if (value === undefined) Deno.env.delete(name); else Deno.env.set(name,value);
      }
      if (priorSecret === undefined) Deno.env.delete('SUPABASE_SECRET_KEYS'); else Deno.env.set('SUPABASE_SECRET_KEYS',priorSecret);
    }
  });
}
