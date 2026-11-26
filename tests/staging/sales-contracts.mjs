import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export async function verifySalesContracts(context) {
  assert(['127.0.0.1','localhost'].includes(new URL(context.apiUrl).hostname));
  const { db } = context;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(context.apiUrl, context.serviceKey, options);
  const factory = () => createClient(context.apiUrl, context.anonKey, options);
  const ownedStaff = [];
  let assertions = 0;
  const equal = (a,b) => { assert.deepEqual(a,b); assertions++; };
  const rpc = async (client,name,input={}) => {
    const result = await client.rpc(name,input);
    assert.equal(result.error,null,`${name}: ${result.error?.message}`); assertions++;
    return result.data;
  };
  const denied = async (client,name,input={},code='42501') => {
    const result = await client.rpc(name,input);
    assert(result.error,`Expected explicit denial: ${name}`);
    equal(result.error.code,code);
    if (code==='P0001') assert.match(result.error.message,/Ventas pausadas/);
  };
  const identity = async (role,allEvents) => {
    const email = `sales-${randomUUID()}@example.invalid`, password=`Synthetic-only-Aa1!-${randomUUID()}`;
    const created = await admin.auth.admin.createUser({email,password,email_confirm:true});
    equal(created.error,null);
    await db.query('insert into actv_payments.staff(user_id,role,all_events) values($1,$2,$3)',[created.data.user.id,role,allEvents]);
    ownedStaff.push(created.data.user.id);
    const client = factory();
    equal((await client.auth.signInWithPassword({email,password})).error,null);
    return {id:created.data.user.id,client};
  };
  try {
  const manager = await identity('manager',true), seller = await identity('cashier',true), unrelated = await identity('cashier',false);
  const race=randomUUID(), organizer=randomUUID(), athletes=Array.from({length:5},()=>randomUUID());
  await db.query(`insert into public.eventos(id,nombre_carrera,fecha,organizador,distancia,precio_1,nombre_precio_1,cupo_maximo,activo)
    values($1,'Synthetic sales gate',current_date+7,'ACTV','5K',500,'General',50,true)`,[race]);
  await db.query("insert into actv_payments.organizers(id,name) values($1,'Synthetic sales gate')",[organizer]);
  const account='acct_gate'+randomUUID().replaceAll('-','');
  await db.query('insert into actv_payments.accounts(organizer_id,live_mode,account_id,ready) values($1,false,$2,true)',[organizer,account]);
  await db.query(`insert into actv_payments.events(event_id,organizer_id,online_enabled,reader_id)
    values($1,$2,true,'tmr_gatefixture')`,[race,organizer]);
  for (const id of athletes) await db.query(`insert into public.atletas(id,nombre,apellido,telefono,telefono_emergencia,talla_playera)
    values($1,'Synthetic','Gate','8685550100','8685550101','M')`,[id]);
  const staffInput=(athlete,channel='cash')=>({p_event_id:race,p_request_id:randomUUID(),p_channel:channel,p_items:[{athlete_id:athlete,package:1}],p_relay:false});
  const onlineInput=()=>({p_event_id:race,p_request_id:randomUUID(),p_channel:'online',p_items:[{
    nombre:'Synthetic',apellido:'Gate',telefono:'8685550100',telefono_emergencia:'8685550101',talla_playera:'M',package:1,
  }],p_buyer_email:'synthetic@example.invalid',p_live_mode:false});
  await rpc(manager.client,'actv_set_sales_pause',{p_paused:false,p_reason:'Synthetic qualification opening'});
  equal((await rpc(seller.client,'actv_sales_status')).can_manage,false);
  await denied(seller.client,'actv_set_sales_pause',{p_paused:true,p_reason:'Unauthorized synthetic pause'});
  await denied(factory(),'actv_sales_status');
  const shift=await rpc(seller.client,'actv_open_shift',{p_opening:0});
  const originalInput=staffInput(athletes[0]);
  const cash=await rpc(seller.client,'actv_create_staff_order',originalInput);
  const terminal=await rpc(seller.client,'actv_create_staff_order',staffInput(athletes[1],'terminal'));
  const online=await rpc(admin,'actv_create_order',onlineInput());
  const unstarted=await rpc(admin,'actv_create_order',onlineInput());
  const authorize=(order,kind,attempt='canonical')=>({p_order_id:order.order_id,p_kind:kind,p_attempt:attempt});
  await rpc(admin,'actv_authorize_provider_attempt',authorize(terminal,'terminal_intent'));
  await rpc(admin,'actv_authorize_provider_attempt',authorize(terminal,'terminal_reader','initial'));
  await denied(seller.client,'actv_authorize_provider_attempt',authorize(terminal,'terminal_intent'));
  // Hold the durable authorization transaction open. Pause must wait for its
  // acceptance to commit, rather than race past a boolean read in an Edge call.
  const connection=await db.connect();
  let pause;
  try {
    await connection.query('begin');
    await connection.query('select public.actv_authorize_provider_attempt($1,$2,$3)',[online.order_id,'checkout','canonical']);
    let completed=false;
    pause=rpc(manager.client,'actv_set_sales_pause',{p_paused:true,p_reason:'Synthetic cutover with accepted obligations'}).then(value=>{completed=true;return value;});
    await new Promise(resolve=>setTimeout(resolve,150));
    equal(completed,false);
    await connection.query('commit');
    equal((await pause).paused,true);
  } finally { await connection.query('rollback'); connection.release(); }
  await denied(seller.client,'actv_create_staff_order',staffInput(athletes[2]),'P0001');
  // Fresh online and terminal request IDs are rejected at the database boundary.
  await denied(admin,'actv_create_order',onlineInput(),'P0001');
  // The preexisting pending terminal occupies its reader; a different reader is
  // configured temporarily so this asserts the gate rather than uniqueness.
  await db.query("update actv_payments.events set reader_id='tmr_gatefresh' where event_id=$1",[race]);
  await denied(seller.client,'actv_create_staff_order',staffInput(athletes[3],'terminal'),'P0001');
  equal((await rpc(seller.client,'actv_create_staff_order',originalInput)).order_id,cash.order_id);
  await rpc(admin,'actv_authorize_provider_attempt',authorize(online,'checkout'));
  await rpc(admin,'actv_authorize_provider_attempt',authorize(terminal,'terminal_intent'));
  await rpc(admin,'actv_authorize_provider_attempt',authorize(terminal,'terminal_reader','initial'));
  await denied(admin,'actv_authorize_provider_attempt',authorize(terminal,'terminal_reader',randomUUID()),'P0001');
  await denied(admin,'actv_authorize_provider_attempt',authorize(unstarted,'checkout'),'P0001');
  await db.query("update actv_payments.provider_attempts set authorized_at=now()-interval '24 hours' where order_id=$1 and kind='terminal_intent'",[terminal.order_id]);
  await denied(admin,'actv_authorize_provider_attempt',authorize(terminal,'terminal_intent'),'23514');
  const issued=await rpc(seller.client,'actv_confirm_cash',{p_order_id:cash.order_id,p_shift_id:shift.id,p_received:50000});
  equal(issued.state,'issued'); equal(issued.registrations.length,1);
  equal((await rpc(seller.client,'actv_confirm_cash',{p_order_id:cash.order_id,p_shift_id:shift.id,p_received:50000})).registrations,issued.registrations);
  const recovered=await rpc(seller.client,'actv_staff_recover_order',{p_order_id:cash.order_id});
  equal(recovered.request_id,originalInput.p_request_id); equal(recovered.cart.items,originalInput.p_items);
  equal(recovered.received,50000); equal(recovered.shift_id,shift.id); equal(recovered.registrations,issued.registrations);
  equal((await rpc(seller.client,'actv_staff_recent_orders')).length,2);
  equal(await rpc(unrelated.client,'actv_staff_recent_orders'),[]);
  await denied(unrelated.client,'actv_staff_recover_order',{p_order_id:cash.order_id});
  const sessionId='cs_gate'+randomUUID().replaceAll('-',''),paymentId='pi_gate'+randomUUID().replaceAll('-','');
  await rpc(admin,'actv_attach_provider',{p_order_id:online.order_id,p_account_id:account,p_live_mode:false,p_session_id:sessionId,p_payment_id:paymentId});
  const settled=await rpc(admin,'actv_confirm_stripe',{p_order_id:online.order_id,p_account_id:account,p_live_mode:false,
    p_payment_id:paymentId,p_amount:50000,p_currency:'mxn',p_session_id:sessionId,p_charge_id:'ch_gate'+randomUUID().replaceAll('-','')});
  equal(settled.state,'issued'); equal(settled.registrations.length,1);
  equal((await db.query('select activo from public.eventos where id=$1',[race])).rows[0].activo,true);
  await db.query('update actv_payments.staff set active=false where user_id=$1',[seller.id]);
  await denied(seller.client,'actv_staff_recent_orders');
  await denied(seller.client,'actv_staff_recover_order',{p_order_id:cash.order_id});
  await denied(seller.client,'actv_sales_status');
  await rpc(manager.client,'actv_set_sales_pause',{p_paused:false,p_reason:'Synthetic qualification complete; leave fixture open'});
  equal((await db.query('select count(*)::int as n from actv_payments.sales_control_history where actor=$1',[manager.id])).rows[0].n,3);
  return {assertions,defaultClosed:true,atomicPause:true,durableProviderRecovery:true,serverOrderRecovery:true,syntheticOnly:true};
  } finally {
    // Synthetic staff authority is owned by this suite. Keep Auth, captured
    // orders and audit rows intact; other lifecycle suites own their bootstrap.
    if (ownedStaff.length) await db.query('delete from actv_payments.staff where user_id=any($1::uuid[])',[ownedStaff]);
  }
}
