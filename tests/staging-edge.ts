// Local staging only. Real Edge handlers and Postgres, synthetic Stripe HTTP.
import assert from 'node:assert/strict';
import pg from 'npm:pg@8.23.1';
import { checkoutHandler } from '../supabase/functions/actv-checkout/index.ts';
import { webhookHandler } from '../supabase/functions/actv-stripe-webhook/index.ts';
import { Stripe } from '../supabase/functions/_shared/stripe.ts';

const address = new URL(Deno.env.get('ACTV_STAGING_DB') ?? 'postgresql://postgres@127.0.0.1:55432/actv_payment_staging');
assert(['127.0.0.1','localhost'].includes(address.hostname) && address.pathname === '/actv_payment_staging');
const db = new pg.Pool({ connectionString: address.href, max: 32 });
const testSecret = 'whsec_local_staging_edge_fixture';
const testApiKey = 'sk_test_local_staging_edge_fixture';
const account = 'acct_stagingfixture';
const provider = new Stripe(testApiKey);
const eventId = crypto.randomUUID();
const fixtures = new Map<string, Record<string, unknown>>();
const originalFetch = globalThis.fetch;

const rpcArguments: Record<string, string[]> = {
  actv_create_order: ['p_event_id','p_request_id','p_channel','p_items','p_operator','p_relay','p_buyer_email','p_live_mode'],
  actv_order_status: ['p_order_id','p_status_token','p_operator'],
  actv_attach_provider: ['p_order_id','p_account_id','p_live_mode','p_session_id','p_payment_id'],
  actv_record_stripe_event: ['p_account_id','p_live_mode','p_event_id','p_type','p_object_id','p_order_id'],
  actv_read_order: ['p_order_id'],
  actv_confirm_stripe: ['p_order_id','p_account_id','p_live_mode','p_payment_id','p_amount','p_currency','p_session_id','p_charge_id'],
  actv_finish_stripe_event: ['p_account_id','p_live_mode','p_event_id'],
  actv_checked_stripe_event: ['p_account_id','p_live_mode','p_event_id','p_failure_code'],
};

for (const [key, value] of Object.entries({
  ACTV_STRIPE_MODE:'test', ACTV_STRIPE_SECRET_KEY:testApiKey, ACTV_STRIPE_WEBHOOK_SECRET:testSecret,
  SUPABASE_URL:'https://staging-fixture.invalid', SUPABASE_SECRET_KEYS:'{"default":"fixture"}',
  ACTV_APP_URL:'http://localhost:3000',
})) Deno.env.set(key,value);

async function rpcResponse(path: string, request: Request) {
  const name = path.split('/').at(-1)!;
  assert(name in rpcArguments, name);
  const data = await request.json();
  const values = rpcArguments[name].map(key => Array.isArray(data[key]) ? JSON.stringify(data[key]) : data[key] ?? null);
  const sql = `select public.${name}(${values.map((_, index) => '$'+(index+1)).join(',')}) as result`;
  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query('set local role service_role');
    const result = (await client.query(sql, values)).rows[0].result;
    await client.query('commit');
    return Response.json(result ?? null);
  } catch (error) {
    await client.query('rollback');
    const details = error as { code?: string; message?: string };
    return Response.json({ code:details.code, message:details.message }, { status:400 });
  } finally {
    client.release();
  }
}

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.hostname === 'staging-fixture.invalid') return await rpcResponse(url.pathname, request);
  assert.equal(url.hostname,'api.stripe.com');
  assert.equal(request.headers.get('stripe-account'),account);
  if (url.pathname === '/v1/checkout/sessions' && request.method === 'POST') {
    const form = new URLSearchParams(await request.text());
    const order = form.get('client_reference_id')!;
    const amount = Number(form.get('line_items[0][price_data][unit_amount]'));
    assert.equal(amount,50000);
    assert.equal(request.headers.get('idempotency-key'),`actv-checkout-${order}`);
    const suffix = order.replaceAll('-','');
    const metadata = { actv_order_id:order,actv_channel:'online' };
    const session = {
      id:`cs_test_${suffix}`,mode:'payment',livemode:false,client_reference_id:order,metadata,
      amount_total:amount,currency:'mxn',url:`https://checkout.stripe.com/c/pay/cs_test_${suffix}`,
    };
    fixtures.set(session.id, {
      ...session,status:'complete',payment_status:'paid',
      payment_intent:{
        id:`pi_${suffix}`,status:'succeeded',metadata,livemode:false,amount,amount_received:amount,currency:'mxn',
        latest_charge:{
          id:`ch_${suffix}`,captured:true,paid:true,livemode:false,currency:'mxn',amount_captured:amount,
          payment_intent:`pi_${suffix}`,payment_method_details:{type:'card'},amount_refunded:0,disputed:false,
        },
      },
    });
    return Response.json({ ...session,status:'open',payment_status:'unpaid',payment_intent:null });
  }
  const sessionId = url.pathname.split('/').at(-1);
  const fixture = fixtures.get(sessionId ?? '');
  assert(fixture, `Unrecognized Stripe fixture: ${url.pathname}`);
  return Response.json(fixture);
};

function post(path: string, data: object, headers?: HeadersInit) {
  return new Request(`http://localhost/${path}`, { method:'POST',body:JSON.stringify(data),headers });
}
async function checkout(data: object) {
  const response = await checkoutHandler(post('checkout',data));
  const result = await response.json();
  assert(response.ok, JSON.stringify(result));
  return result;
}
async function delivery(orderId: string) {
  const { id, metadata } = fixtures.get(`cs_test_${orderId.replaceAll('-','')}`)!;
  const event = { id:`evt_${orderId.replaceAll('-','')}`, account, type:'checkout.session.completed',
    livemode:false, data:{ object:{ id,metadata } } };
  const raw = JSON.stringify(event);
  const signature = await provider.webhooks.generateTestHeaderStringAsync({ payload:raw,secret:testSecret });
  const response = await webhookHandler(post('webhook',event,{ 'stripe-signature':signature }));
  const result = await response.json();
  assert(response.ok, JSON.stringify(result));
  return result;
}

try {
  await db.query(`insert into eventos(id,nombre_carrera,fecha,organizador,distancia,nombre_precio_1,precio_1,
    folio_inicial,cupo_maximo) values($1,'Carrera de prueba Edge',current_date+7,'ACTV','5k','Individual',500,1,1500)`,[eventId]);
  await db.query(`insert into actv_payments.events(event_id,organizer_id,online_enabled)
    values($1,'00000000-0000-4000-8000-000000000ac7',true)`,[eventId]);
  let next = 0;
  const checkoutMs: number[] = [];
  const webhookMs: number[] = [];
  const started = performance.now();
  await Promise.all(Array.from({length:28},async () => {
    while (next < 1500) {
      const n = ++next;
      const checkoutStarted = performance.now();
      const order = await checkout({ action:'start',eventId,idempotencyKey:crypto.randomUUID(),
        buyerEmail:`fixture${n}@example.invalid`,participants:[{
          nombre:'Participante',apellido:'Sintético',telefono:'8685550100',
          telefono_emergencia:'8685550101',talla_playera:'M',package:1,
        }] });
      checkoutMs.push(performance.now()-checkoutStarted);
      assert.equal(order.status,'pending');
      assert.deepEqual(order.folios,[]);
      const status = { action:'status',orderId:order.orderId,orderToken:order.orderToken };
      assert.deepEqual((await checkout(status)).folios,[]);
      const webhookStarted = performance.now();
      await delivery(order.orderId);
      webhookMs.push(performance.now()-webhookStarted);
      const after = await checkout(status);
      assert.equal(after.status,'issued');
      assert.equal(after.folios.length,1);
      if (n%5===0) {
        assert.equal((await delivery(order.orderId)).duplicate,true);
        assert.deepEqual((await checkout(status)).folios,after.folios);
      }
    }
  }));
  const summary = (await db.query(`select count(*) as registrations,count(distinct r.folio_asignado) as unique_folios,
    count(*) filter (where c.order_id is null or c.amount<>o.amount) as unfunded
    from inscripciones r left join actv_payments.items i on i.id=r.actv_order_item_id
    left join actv_payments.orders o on o.id=i.order_id left join actv_payments.captures c on c.order_id=i.order_id
    where r.evento_id=$1`,[eventId])).rows[0];
  assert.deepEqual(summary,{ registrations:'1500',unique_folios:'1500',unfunded:'0' });
  const p95 = (values: number[]) => Number(values.sort((a,b)=>a-b)[1424].toFixed(2));
  console.log(JSON.stringify({ profile:'Local Edge handlers + PostgreSQL with Stripe HTTP fixture',
    buyers:1500,parallelBuyers:28,duplicateSignedDeliveries:300,...summary,
    p95CheckoutHandlerMs:p95(checkoutMs),p95WebhookHandlerMs:p95(webhookMs),
    loadSeconds:Number(((performance.now()-started)/1000).toFixed(2)) },null,2));
} finally {
  globalThis.fetch = originalFetch;
  await db.end();
}
