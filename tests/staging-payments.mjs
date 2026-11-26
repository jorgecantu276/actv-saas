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
  // The candidate installs paused. Only this owned synthetic workload opens it.
  assert.equal((await db.query('select paused from actv_payments.sales_control')).rows[0].paused, true);
  await db.query('update actv_payments.sales_control set paused=false');
  await db.query("insert into perfiles(id,email,rol,eventos_asignados) values($1,'cashier@example.invalid','Administrador','{}')", [cashier]);
  await db.query("insert into actv_payments.staff(user_id,role,all_events) values($1,'manager',true)", [cashier]);
  await db.query("insert into actv_payments.accounts values('00000000-0000-4000-8000-000000000ac7',false,$1,true)", [stripeAccount]);
  const race = await event(1500);
  const smallerRace = await event(6);
  await db.query('update actv_payments.events set sandbox_fee_per_folio=1500 where event_id=$1', [smallerRace]);
  const raceCatalog = await rpc('actv_catalog', [race, null]);
  assert.equal(raceCatalog.packages[0].amount, 50000);

  // Use local fixture accounts to exercise both modes without a live Stripe call.
  const liveRace = await event(12);
  await db.query("insert into actv_payments.accounts values('00000000-0000-4000-8000-000000000ac7',true,'acct_livefixture',true)");
  await db.query('update actv_payments.events set live_mode=true where event_id=$1', [liveRace]);
  await db.query('update eventos set precio_1=350, precio_2=15 where id=$1', [liveRace]);
  const beforeCommissionRequest = randomUUID();
  const beforeCommission = await online(liveRace, beforeCommissionRequest);
  assert.equal(beforeCommission.application_fee_amount, 0);
  await assert.rejects(db.query('update actv_payments.events set live_commission_enabled=true where event_id=$1',
    [smallerRace]), /actv_live_commission_requires_live_event/);

  await db.query('update actv_payments.events set live_commission_enabled=true where event_id=$1', [liveRace]);
  assert.equal((await online(liveRace, beforeCommissionRequest)).application_fee_amount, 0);
  const liveSingleRequest = randomUUID();
  const liveSingle = await online(liveRace, liveSingleRequest);
  assert.equal(liveSingle.amount, 35000);
  assert.equal(liveSingle.application_fee_amount, 1500);
  const liveDouble = await rpc('actv_create_order', [liveRace, randomUUID(), 'online',
    JSON.stringify([buyer, { ...buyer, nombre: 'Segundo' }]), null, false, 'buyer@example.invalid', true]);
  assert.equal(liveDouble.amount, 70000);
  assert.equal(liveDouble.application_fee_amount, 3000);
  const liveCatalog = await rpc('actv_catalog', [liveRace, null]);
  assert.deepEqual(liveCatalog.packages.map(option => option.id), [1]);
  await assert.rejects(rpc('actv_create_order', [liveRace, randomUUID(), 'online',
    JSON.stringify([buyer, { ...buyer, package: 2 }]), null, false, 'buyer@example.invalid', true]), /mayor que la comisión/);
  assert.equal((await staffOrder(liveRace, 'terminal', await athlete())).application_fee_amount, 1500);
  const liveCash = await rpc('actv_create_staff_order', [liveRace, randomUUID(), 'cash',
    JSON.stringify([{ athlete_id: await athlete(), package: 2 }]), false], cashier);
  assert.equal(liveCash.amount, 1500);
  assert.equal(liveCash.application_fee_amount, 0);
  await assert.rejects(db.query('update actv_payments.orders set application_fee_amount=-1 where id=$1', [liveSingle.order_id]),
    /actv_order_application_fee_valid/);
  await db.query('update actv_payments.events set live_commission_enabled=false where event_id=$1', [liveRace]);
  assert.equal((await online(liveRace, liveSingleRequest)).application_fee_amount, 1500);
  assert.equal((await online(liveRace)).application_fee_amount, 0);

  const staffAthlete = await athlete();
  const stock = await staffOrder(smallerRace, 'cash', staffAthlete);
  assert.equal(stock.application_fee_amount, 0);
  const fakeStaff = randomUUID();
  await db.query("insert into perfiles(id,email,rol,eventos_asignados) values($1,'outsider@example.invalid','Administrador','{}')", [fakeStaff]);
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
  assert.equal(terminal.application_fee_amount, 1500);
  await assert.rejects(staffOrder(smallerRace, 'terminal', await athlete()), /actv_one_pending_reader/);
  await assert.rejects(capture(terminal.order_id, 'terminal', { session: null }), /no coincide/);
  await rpc('actv_attach_provider', [terminal.order_id,stripeAccount,false,null,id('pi','terminal')]);
  assert.equal((await capture(terminal.order_id, 'terminal', { session: null })).state, 'issued');
  await assert.rejects(rpc('actv_confirm_stripe',
    [terminal.order_id, stripeAccount, true, id('pi','terminal'), 50000, 'mxn', null, id('ch','terminal')]), /incompatible/);

  const requestId = randomUUID();
  const pending = await online(smallerRace, requestId);
  assert.equal(pending.application_fee_amount, 1500);
  await db.query('update actv_payments.events set sandbox_fee_per_folio=2000 where event_id=$1', [smallerRace]);
  const retried = await online(smallerRace, requestId);
  assert.equal(retried.order_id, pending.order_id);
  assert.equal(retried.application_fee_amount, 1500);
  const multiple = await rpc('actv_create_order', [smallerRace, randomUUID(), 'online',
    JSON.stringify([buyer, { ...buyer, nombre: 'Segundo' }]), null, false, 'buyer@example.invalid']);
  assert.equal(multiple.amount, 100000);
  assert.equal(multiple.application_fee_amount, 4000);
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
  await rpc('actv_record_adjustment', [stripeAccount,false,'re_prior','refund',id('pi','pending'),50000,'mxn','failed']);
  const restored = await rpc('actv_order_status', [pending.order_id, pending.status_token, null]);
  assert.equal(restored.state, 'issued');
  assert.equal(restored.registrations.length, 1);
  await rpc('actv_record_adjustment', [stripeAccount,false,'re_prior','refund',id('pi','pending'),50000,'mxn','succeeded']);
  assert.deepEqual(await rpc('actv_order_status', [pending.order_id, pending.status_token, null]), restored);
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
  const multigatewayRace = await event(10);
  const mpCollector = '555000000';
  const mpPreference = mpCollector + '-actv-staging-one';
  const mpPaymentId = '555000001';
  const mpReversedId = '555000002';
  const mpRequest = randomUUID();
  const mpStart = (requestId) => rpc('actv_create_mercadopago_order', [
    multigatewayRace, requestId, JSON.stringify([buyer]), 'buyer@example.invalid', false,
  ]);
  await assert.rejects(mpStart(mpRequest), /Canal no disponible/);
  await db.query(`insert into actv_payments.mercadopago_accounts(organizer_id,live_mode,collector_id,ready)
    values ('00000000-0000-4000-8000-000000000ac7',false,$1,true)`, [mpCollector]);
  await db.query(`update actv_payments.events set mercadopago_enabled=true,sandbox_fee_per_folio=1500
    where event_id=$1`, [multigatewayRace]);
  assert.deepEqual((await rpc('actv_catalog', [multigatewayRace, null])).payment_providers, ['stripe','mercadopago']);
  const mp = await mpStart(mpRequest);
  assert.equal(mp.provider,'mercadopago');
  assert.equal(mp.mercadopago_collector_id,mpCollector);
  assert.equal(mp.amount,50000);
  assert.equal(mp.application_fee_amount,1500);
  assert.equal((await mpStart(mpRequest)).order_id,mp.order_id);
  await assert.rejects(online(multigatewayRace,mpRequest),{code:'23514'});
  await assert.rejects(rpc('actv_attach_provider',[mp.order_id,null,false,id('cs','wrong'),null]),/Stripe incompatible/);
  await assert.rejects(rpc('actv_confirm_mercadopago', [
    mp.order_id,false,mpCollector,mpPreference,mpPaymentId,50000,'MXN',
  ]),{code:'23514'});
  const mpClaims = await Promise.all(Array.from({length:8},()=>rpc('actv_claim_mercadopago_preference', [
    mp.order_id,false,mpCollector,
  ])));
  assert.equal(mpClaims.filter(Boolean).length,1);
  const mpClaim = mpClaims.find(Boolean);
  await assert.rejects(rpc('actv_attach_mercadopago_preference', [
    mp.order_id,false,mpCollector,mpPreference,randomUUID(),
  ]),{code:'23514'});
  const mpBound = await rpc('actv_attach_mercadopago_preference',[
    mp.order_id,false,mpCollector,mpPreference,mpClaim,
  ]);
  assert.equal(mpBound.provider_preference_id,mpPreference);
  const mpConfirm = (amount=50000,mode=false) => rpc('actv_confirm_mercadopago', [
    mp.order_id,mode,mpCollector,mpPreference,mpPaymentId,amount,'MXN',
  ]);
  await assert.rejects(mpConfirm(49500),{code:'23514'});
  await assert.rejects(mpConfirm(50000,true),{code:'23514'});
  const confirmations = await Promise.all(Array.from({length:8},()=>mpConfirm()));
  assert.ok(confirmations.every(confirm => confirm.registrations.length===1 && confirm.registrations[0].folio_asignado==='001'));
  const stripeRequest = randomUUID();
  const stripeAlternative = await online(multigatewayRace,stripeRequest);
  await assert.rejects(mpStart(stripeRequest),{code:'23514'});
  await rpc('actv_attach_provider',[stripeAlternative.order_id,stripeAccount,false,id('cs','mpalt'),null]);
  assert.equal((await capture(stripeAlternative.order_id,'mpalt')).registrations[0].folio_asignado,'002');
  const reversal = (state,amount) => rpc('actv_record_mercadopago_reversal',[
    mp.order_id,false,mpCollector,mpPreference,mpPaymentId,state,amount,
  ]);
  assert.equal((await reversal('approved',10000)).state,'review');
  assert.deepEqual((await mpConfirm()).registrations,[]);
  assert.equal((await reversal('refunded',50000)).state,'voided');
  assert.equal((await reversal('approved',10000)).state,'voided');
  assert.deepEqual((await mpConfirm()).registrations,[]);
  const reversedBeforeApproval = await mpStart(randomUUID());
  const reversedPreference = mpCollector+'-actv-staging-reversed';
  const secondClaim = await rpc('actv_claim_mercadopago_preference',[reversedBeforeApproval.order_id,false,mpCollector]);
  await rpc('actv_attach_mercadopago_preference',[
    reversedBeforeApproval.order_id,false,mpCollector,reversedPreference,secondClaim,
  ]);
  assert.equal((await rpc('actv_record_mercadopago_reversal',[
    reversedBeforeApproval.order_id,false,mpCollector,reversedPreference,mpReversedId,'charged_back',0,
  ])).state,'review');
  assert.deepEqual((await rpc('actv_confirm_mercadopago',[
    reversedBeforeApproval.order_id,false,mpCollector,reversedPreference,mpReversedId,50000,'mxn',
  ])).registrations,[]);
  const dateInMatamoros = (await db.query("select (now() at time zone 'America/Matamoros')::date::text as day")).rows[0].day;
  const mpReport = await rpc('actv_list_admin_payments',[
    cashier,false,dateInMatamoros,dateInMatamoros,null,null,mpPaymentId,0,
  ]);
  assert.equal(mpReport.rows.length,1);
  assert.equal(mpReport.rows[0].provider,'mercadopago');
  assert.equal(mpReport.rows[0].refunded,50000);
  const mpDetail = await rpc('actv_admin_payment',[cashier,false,mp.order_id]);
  assert.equal(mpDetail.provider,'mercadopago');
  assert.equal(mpDetail.account_id,null);
  assert.deepEqual(mpDetail.adjustments.map(({amount})=>amount).sort((a,b)=>a-b),[10000,40000]);
  await assert.rejects(rpc('actv_create_mercadopago_order', [
    multigatewayRace,randomUUID(),JSON.stringify([buyer]),'buyer@example.invalid',false,
  ],cashier),{code:'42501'});

  const retryId = id('evt','lease-first');
  const directId = id('evt','lease-second');
  for (const [account, mode, eventId] of [
    [stripeAccount, false, retryId],
    [stripeAccount, false, directId],
    ['acct_livefixture', true, retryId],
  ]) {
    await rpc('actv_record_stripe_event', [account,mode,eventId,'account.updated',account,null]);
  }
  await db.query("update actv_payments.provider_events set retry_after=now()-interval '1 minute' where event_id=$1",[retryId]);
  const transaction = await db.connect();
  try {
    await transaction.query('begin');
    await transaction.query('set local role service_role');
    const firstClaim = (await transaction.query('select public.actv_claim_stripe_event_retry(false) as claim')).rows[0].claim;
    assert.equal(firstClaim.event_id,retryId);
    const parallelClaim = await rpc('actv_claim_stripe_event_retry',[false]);
    assert.equal(parallelClaim.event_id,directId);
    assert.equal(await rpc('actv_claim_stripe_event_retry',[false]),null);
    assert.equal((await rpc('actv_claim_stripe_event_retry',[true])).account_id,'acct_livefixture');
    await transaction.query('commit');

    await rpc('actv_finish_stripe_event',[stripeAccount,false,directId]);
    assert.equal(await rpc('actv_finish_stripe_event_retry',[stripeAccount,false,directId,parallelClaim.lease,'late_failure']),false);
    assert.equal(await rpc('actv_finish_stripe_event_retry',[stripeAccount,false,retryId,firstClaim.lease,'temporary_failure']),true);
    assert.equal(await rpc('actv_claim_stripe_event_retry',[false]),null);
    await db.query("update actv_payments.provider_events set retry_after=now()-interval '1 second' where event_id=$1 and not live_mode",[retryId]);
    const secondClaim = await rpc('actv_claim_stripe_event_retry',[false]);
    assert.equal(secondClaim.event_id,retryId);
    assert.notEqual(secondClaim.lease,firstClaim.lease);
    assert.equal(await rpc('actv_finish_stripe_event_retry',[stripeAccount,false,retryId,firstClaim.lease,null]),false);
    assert.equal(await rpc('actv_finish_stripe_event_retry',[stripeAccount,false,retryId,secondClaim.lease,null]),true);
    await assert.rejects(rpc('actv_claim_stripe_event_retry',[false],cashier),{code:'42501'});
  } catch (error) {
    await transaction.query('rollback');
    throw error;
  } finally {
    transaction.release();
  }
  console.log(JSON.stringify({ profile:'Local PostgreSQL staging with synthetic provider proof',
    buyers:1500,submissionsInParallel:28,duplicateDeliveries:300,lastPlaceConcurrentAttempts:20,
    ...snapshot,loadSeconds:Number(loadSeconds.toFixed(2)),ordersPerSecond:Number((1500/loadSeconds).toFixed(2)),
    p95ConfirmationRpcMs:dbP95,p95CompleteFixtureWorkflowMs:percentile(responseTimes,0.95),
    elapsedSeconds:Number(((performance.now()-started)/1000).toFixed(2)) }, null, 2));
} finally {
  await db.end();
}
