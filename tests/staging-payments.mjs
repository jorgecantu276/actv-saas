import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import pg from 'pg';

const dbAddress = new URL(process.env.ACTV_STAGING_DB ?? 'postgresql://postgres@127.0.0.1:55432/actv_payment_staging');
if (!['127.0.0.1', 'localhost'].includes(dbAddress.hostname) || dbAddress.pathname !== '/actv_payment_staging') {
  throw new Error('Use an isolated local database named actv_payment_staging.');
}
const db = new pg.Pool({ connectionString: dbAddress.href, max: 32 });
const cashier = randomUUID();
const stripeAccount = 'acct_stagingfixture';
const buyer = {
  nombre: 'Participante',
  apellido: 'Sintético',
  telefono: '8685550100',
  telefono_emergencia: '8685550101',
  talla_playera: 'M',
  package: 1,
};
async function rpc(name, params, identity = 'service_role') {
  const client = await db.connect();
  try {
    await client.query('begin');
    if (identity === 'service_role') {
      await client.query('set local role service_role');
    } else {
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [identity]);
    }
    const args = params.map((_, index) => '$' + (index + 1)).join(',');
    const { rows } = await client.query(`select public.${name}(${args}) as value`, params);
    await client.query('commit');
    return rows[0].value;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
async function event(capacity) {
  const id = randomUUID();
  await db.query(`insert into eventos(id,nombre_carrera,fecha,organizador,distancia,nombre_precio_1,precio_1,
    nombre_precio_2,precio_2,folio_inicial,cupo_maximo) values($1,'Carrera de prueba',current_date+7,'ACTV','5k',
      'Individual',500,'Relevo',350,1,$2)`, [id, capacity]);
  await db.query(`insert into actv_payments.events(event_id,organizer_id,online_enabled,reader_id)
    values($1,'00000000-0000-4000-8000-000000000ac7',true,'tmr_staging')`, [id]);
  return id;
}
function online(eventId, attempt = randomUUID()) {
  return rpc('actv_create_order', [eventId, attempt, 'online', JSON.stringify([buyer]), null, false, 'buyer@example.invalid']);
}
function id(prefix, n) {
  return prefix + '_staging' + n;
}
async function staffOrder(eventId, channel, athleteId, actor = cashier) {
  return rpc('actv_create_staff_order', [eventId, randomUUID(), channel, JSON.stringify([{ athlete_id: athleteId, package: 1 }]), false], actor);
}
async function athlete() {
  return (await db.query(`insert into atletas(nombre,apellido,telefono,telefono_emergencia,talla_playera)
    values ('Prueba','Caja','8685550100','8685550101','M') returning id`)).rows[0].id;
}
function capture(orderId, n, options = {}) {
  const { account = stripeAccount, mode = false, payment = id('pi', n), amount = 50000, charge = id('ch', n),
    session = id('cs', n), currency = 'mxn' } = options;
  return rpc('actv_confirm_stripe', [orderId, account, mode, payment, amount, currency, session, charge]);
}
function percentile(samples, fraction) {
  return Math.round(samples.sort((a, b) => a - b)[Math.ceil(samples.length * fraction) - 1] * 100) / 100;
}

try {
  const started = performance.now();
  await db.query(await readFile(new URL('./staging-base.sql', import.meta.url), 'utf8'));
  const migrations = new URL('../supabase/migrations/', import.meta.url);
  for (const path of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    await db.query(await readFile(new URL(path, migrations), 'utf8'));
  }
  await db.query("insert into perfiles values($1,'cashier@example.invalid','Administrador','{}')", [cashier]);
  await db.query("insert into actv_payments.staff values($1,'manager',true)", [cashier]);
  await db.query("insert into actv_payments.accounts values('00000000-0000-4000-8000-000000000ac7',false,$1,true)", [stripeAccount]);
  const race = await event(1500);
  const smallerRace = await event(6);
  const raceCatalog = await rpc('actv_catalog', [race, null]);
  assert.equal(raceCatalog.packages[0].amount, 50000);

  const staffAthlete = await athlete();
  const stock = await staffOrder(smallerRace, 'cash', staffAthlete);
  const fakeStaff = randomUUID();
  await db.query("insert into perfiles values($1,'outsider@example.invalid','Administrador','{}')", [fakeStaff]);
  assert.equal(await rpc('actv_is_payment_manager', [], fakeStaff), false);
  await assert.rejects(staffOrder(smallerRace, 'terminal', staffAthlete), /Atleta ya inscrito/);
  await assert.rejects(rpc('actv_confirm_cash', [stock.order_id, randomUUID(), 50000], cashier));
  const shift = await rpc('actv_open_shift', [10000], cashier);
  await assert.rejects(rpc('actv_confirm_cash', [stock.order_id, shift.id, 49999], cashier), /insuficiente/);
  const cash = await rpc('actv_confirm_cash', [stock.order_id, shift.id, 60000], cashier);
  assert.equal(cash.state, 'issued');
  assert.equal(cash.registrations.length, 1);
  assert.deepEqual(await rpc('actv_confirm_cash', [stock.order_id, shift.id, 60000], cashier), cash);
  await assert.rejects(rpc('actv_confirm_cash', [stock.order_id, shift.id, 61000], cashier), /otros datos/);
  const sessionClose = await rpc('actv_close_shift', [shift.id, 59900], cashier);
  assert.equal(Number(sessionClose.variance), -100);
  assert.equal(Number((await rpc('actv_match_cash_deposit', [shift.id,'cash-deposit-fixture',49900], cashier)).deposit_variance), 0);

  const terminal = await staffOrder(smallerRace, 'terminal', await athlete());
  await assert.rejects(staffOrder(smallerRace, 'terminal', await athlete()), /actv_one_pending_reader/);
  await assert.rejects(capture(terminal.order_id, 'terminal', { session: null }), /no coincide/);
  await rpc('actv_attach_provider', [terminal.order_id,stripeAccount,false,null,id('pi','terminal')]);
  assert.equal((await capture(terminal.order_id, 'terminal', { session: null })).state, 'issued');
  await assert.rejects(rpc('actv_confirm_stripe',
    [terminal.order_id, stripeAccount, true, id('pi','terminal'), 50000, 'mxn', null, id('ch','terminal')]), /incompatible/);

  const requestId = randomUUID();
  const pending = await online(smallerRace, requestId);
  assert.equal((await online(smallerRace, requestId)).order_id, pending.order_id);
  assert.deepEqual(pending.registrations, []);
  await assert.rejects(rpc('actv_order_status', [pending.order_id, randomUUID(), null]));
  assert.deepEqual((await rpc('actv_order_status', [pending.order_id, pending.status_token, null])).registrations, []);
  await assert.rejects(rpc('actv_create_order', [smallerRace,randomUUID(),'online',
    JSON.stringify([buyer]),null,false,'buyer@example.invalid',true]), /Modo de pago/);
  await assert.rejects(capture(pending.order_id, 'pending'), /no coincide/);
  await rpc('actv_attach_provider', [pending.order_id,stripeAccount,false,id('cs','pending'),null]);
  await assert.rejects(capture(pending.order_id, 'pending', { amount: 49999 }), /no coincide/);
  await assert.rejects(capture(pending.order_id, 'pending', { currency: 'usd' }), /no coincide/);
  await assert.rejects(capture(pending.order_id, 'pending', { session: 'cs_other' }), /no coincide/);
  await rpc('actv_record_adjustment', [stripeAccount,false,'re_prior','refund',id('pi','pending'),50000,'mxn','succeeded']);
  assert.equal((await capture(pending.order_id, 'pending')).state, 'voided');
  assert.deepEqual((await rpc('actv_order_status', [pending.order_id, pending.status_token, null])).registrations, []);
  await rpc('actv_record_settlement', [stripeAccount,false,'po_fixture',47900,'mxn','paid',
    JSON.stringify([{ id:'txn_fixture',source:id('ch','terminal'),amount:50000,fee:2100,net:47900,currency:'mxn' }])]);
  await rpc('actv_match_bank', [stripeAccount,false,'po_fixture','bank-mismatch-fixture',47890], cashier);
  const today = new Date().toISOString().slice(0,10);
  const summary = await rpc('actv_reconciliation', ['2020-01-01','2020-01-01'], cashier);
  assert.deepEqual(summary.channels, []);
  const settlement = (await db.query("select bank_amount-amount as variance from actv_payments.settlements where payout_id='po_fixture'")).rows[0];
  assert.equal(Number(settlement.variance), -10);
  await assert.rejects(rpc('actv_reconciliation', [today,today], fakeStaff), /No autorizado/);
  await assert.rejects(db.query("insert into inscripciones(folio_asignado,monto_pagado) values ('no-payment',1)"), /pago confirmado/);
  const skipped = await staffOrder(smallerRace, 'terminal', await athlete());
  await db.query("update actv_payments.orders set expires_at=now()-interval '1 minute' where id=$1",[skipped.order_id]);
  await rpc('actv_close_unbound_terminals',[false]);
  assert.equal((await rpc('actv_staff_order_status',[skipped.order_id],cashier)).state,'closed');

  let next = 0;
  const responseTimes = [];
  const phases = [];
  const beforeLoad = performance.now();
  await Promise.all(Array.from({ length: 28 }, async () => {
    for (;;) {
      const n = ++next;
      if (n > 1500) return;
      const begin = performance.now();
      const order = await online(race);
      assert.equal(order.state, 'pending');
      assert.deepEqual(order.registrations, []);
      await rpc('actv_attach_provider', [order.order_id,stripeAccount,false,id('cs',n),null]);
      const saved = await rpc('actv_record_stripe_event', [stripeAccount,false,id('evt',n),'checkout.session.completed',id('cs',n),order.order_id]);
      assert.equal(saved.processed, false);
      const confirmedAt = performance.now();
      const paid = await capture(order.order_id,n);
      assert.equal(paid.state,'issued');
      assert.equal(paid.registrations.length,1);
      phases.push(performance.now()-confirmedAt);
      await rpc('actv_finish_stripe_event', [stripeAccount,false,id('evt',n)]);
      if (n % 5 === 0) {
        const replay = await rpc('actv_record_stripe_event', [stripeAccount,false,id('evt',n),'checkout.session.completed',id('cs',n),order.order_id]);
        assert.equal(replay.processed, true);
        assert.deepEqual((await capture(order.order_id,n)).registrations, paid.registrations);
      }
      responseTimes.push(performance.now()-begin);
    }
  }));
  const loadSeconds = (performance.now()-beforeLoad)/1000;
  await assert.rejects(online(race), /Cupo agotado/);
  const snapshot = (await db.query(`select count(*) as registrations,count(distinct r.folio_asignado) as unique_folios,
    count(*) filter (where c.order_id is null or c.amount<>o.amount) as unfunded
    from inscripciones r left join actv_payments.items i on i.id=r.actv_order_item_id
    left join actv_payments.orders o on o.id=i.order_id left join actv_payments.captures c on c.order_id=i.order_id
    where r.evento_id=$1`, [race])).rows[0];
  assert.deepEqual(snapshot, { registrations:'1500',unique_folios:'1500',unfunded:'0' });

  const lastPlace = await event(1);
  const competing = await Promise.allSettled(Array.from({length:20}, () => online(lastPlace)));
  assert.equal(competing.filter(result => result.status==='fulfilled').length, 1);
  const lastOrder = competing.find(result => result.status==='fulfilled').value;
  await rpc('actv_attach_provider', [lastOrder.order_id,stripeAccount,false,id('cs','last'),null]);
  const late = await db.query("update actv_payments.orders set expires_at=now()-interval '1 minute' where id=$1", [lastOrder.order_id]);
  assert.equal(late.rowCount, 1);
  await online(lastPlace);
  assert.equal((await capture(lastOrder.order_id,'last')).state,'review');
  const dbP95 = percentile(phases,0.95);
  console.log(JSON.stringify({ profile:'Local PostgreSQL staging with synthetic provider proof',
    buyers:1500,submissionsInParallel:28,duplicateDeliveries:300,lastPlaceConcurrentAttempts:20,
    ...snapshot,loadSeconds:Number(loadSeconds.toFixed(2)),ordersPerSecond:Number((1500/loadSeconds).toFixed(2)),
    p95ConfirmationRpcMs:dbP95,p95CompleteFixtureWorkflowMs:percentile(responseTimes,0.95),
    elapsedSeconds:Number(((performance.now()-started)/1000).toFixed(2)) }, null, 2));
} finally {
  await db.end();
}
