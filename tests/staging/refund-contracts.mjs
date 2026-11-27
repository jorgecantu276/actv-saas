import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';

export async function verifyRefundContracts(context, retained) {
 assert.equal(new URL(context.apiUrl).hostname,'127.0.0.1');
 const {db}=context,opts={auth:{persistSession:false,autoRefreshToken:false}};
 const admin=createClient(context.apiUrl,context.serviceKey,opts),owned=[];
 let assertions=0;
 const equal=(a,b)=>{assert.deepEqual(a,b);assertions++;};
 async function rpc(client,name,args={}){const {data,error}=await client.rpc(name,args);assert.equal(error,null,`${name}: ${error?.message}`);assertions++;return data;}
 async function identity(role){const email=`refund-${randomUUID()}@example.invalid`,password='Synthetic-Aa1!'+randomUUID();
  const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.equal(error,null);owned.push(data.user.id);
  if(role)await db.query('insert into actv_payments.staff(user_id,role,all_events) values($1,$2,true)',[data.user.id,role]);
  const client=createClient(context.apiUrl,context.anonKey,opts);equal((await client.auth.signInWithPassword({email,password})).error,null);return{id:data.user.id,client,token:(await client.auth.getSession()).data.session.access_token};}
 try {
  const manager=await identity('manager'),cashier=await identity('cashier'),outsider=await identity();
  const race=randomUUID(),today=(await db.query("select (now() at time zone 'America/Matamoros')::date::text value")).rows[0].value;
  await rpc(manager.client,'actv_operations_save_event',{p_event_id:race,p_values:{name:'Synthetic refunds',date:today,distance:'5K',capacity:20,price:500,package_name:'General',live_mode:false,online_enabled:false,slug:'refund-'+randomUUID(),folio_start:700}});
  const athletes=[];
  for(let n=0;n<3;n++){const id=randomUUID();athletes.push(id);await db.query("insert into public.atletas(id,nombre,apellido,telefono,telefono_emergencia,talla_playera) values($1,$2,'Refund','8685550100','8685550101','M')",[id,'Refund runner '+n]);}
  const order=await rpc(manager.client,'actv_create_staff_order',{p_event_id:race,p_request_id:randomUUID(),p_channel:'cash',p_items:athletes.map(athlete_id=>({athlete_id,package:1})),p_relay:false});
  const shift=await rpc(manager.client,'actv_open_shift',{p_opening:0});
  const issued=await rpc(manager.client,'actv_confirm_cash',{p_order_id:order.order_id,p_shift_id:shift.id,p_received:150000});
  const before=(await db.query('select r.id,r.folio_asignado,r.actv_order_item_id from public.inscripciones r join actv_payments.items i on i.id=r.actv_order_item_id where i.order_id=$1 order by i.number',[order.order_id])).rows;
  await rpc(manager.client,'actv_record_attendance',{p_event_id:race,p_registration_id:before[0].id});
  const detail=await rpc(manager.client,'actv_participant_refund_detail',{p_registration_id:before[0].id});equal(detail.items.length,3);
  equal(detail.items.map(item=>item.registration_id),before.map(row=>row.id));
  equal(detail.items.map(item=>item.folio),before.map(row=>row.folio_asignado));
  equal(detail.items.map(item=>item.participant_name),['Refund runner 0 Refund','Refund runner 1 Refund','Refund runner 2 Refund']);
  const args={p_order:order.order_id,p_request:randomUUID(),p_items:[detail.items[0].id],p_reason:'Customer cancellation; retain other paid participants',p_participant_scoped:true,p_shift:shift.id,p_disbursed:true};
  for(const client of [cashier.client,outsider.client,createClient(context.apiUrl,context.anonKey,opts)]){
   const {error}=await client.rpc('actv_cash_participant_refund',args);assert(error);assertions++;
  }
  const missingAck=await manager.client.rpc('actv_cash_participant_refund',{...args,p_disbursed:false});assert(missingAck.error);assertions++;
  await rpc(manager.client,'actv_cash_participant_refund',args);await rpc(manager.client,'actv_cash_participant_refund',args);
  const after=await rpc(manager.client,'actv_participant_refund_detail',{p_order_id:order.order_id});
  equal(after.financial.refunded,50000);equal(after.financial.pending,0);equal(after.financial.hold,false);
  equal(after.items.map(i=>i.eligible),[false,true,true]);equal(after.items.map(i=>i.refunded),[50000,0,0]);
  equal((await db.query('select count(*)::int n from actv_payments.cash_refund_movements where request_id=$1',[args.p_request])).rows[0].n,1);
  const double=await manager.client.rpc('actv_cash_participant_refund',{...args,p_request:randomUUID()});assert(double.error);assertions++;
  const changed=await manager.client.rpc('actv_cash_participant_refund',{...args,p_items:[detail.items[1].id]});assert(changed.error);assertions++;
  equal((await db.query('select r.id,r.folio_asignado,r.actv_order_item_id from public.inscripciones r join actv_payments.items i on i.id=r.actv_order_item_id where i.order_id=$1 order by i.number',[order.order_id])).rows,before);
  const cash=await rpc(manager.client,'actv_cash_shift');equal(cash.cash_refunds,50000);equal(cash.expected,100000);equal(cash.refund_movements.length,1);
  const closed=await rpc(manager.client,'actv_close_shift',{p_shift_id:shift.id,p_counted:100000});equal(closed.variance,0);
  // A manager cannot make an old full-card refund bypass selected reservations.
  const legacy=await admin.rpc('actv_admin_begin_refund',{p_operator:manager.id,p_live_mode:false,p_order:order.order_id,p_reason:'requested_by_customer',p_refund_application_fee:false});assert(legacy.error);assertions++;
  equal(issued.registrations.length,3);
  // Real Auth/PostgREST + actual Edge handler; only Stripe HTTP is synthetic.
  const stripeRace=randomUUID(),org=randomUUID(),account='acct_Refund'+org.replaceAll('-','');
  await rpc(manager.client,'actv_operations_save_event',{p_event_id:stripeRace,p_values:{name:'Synthetic Stripe refunds',date:today,distance:'5K',capacity:20,price:500,package_name:'General',live_mode:false,online_enabled:false,slug:'refund-stripe-'+randomUUID(),folio_start:800}});
  await db.query("insert into actv_payments.organizers(id,name) values($1,'Synthetic refund organizer')",[org]);
  await db.query('insert into actv_payments.accounts(organizer_id,live_mode,account_id,ready) values($1,false,$2,true)',[org,account]);
  await db.query('update actv_payments.events set organizer_id=$1,online_enabled=true where event_id=$2',[org,stripeRace]);
  const online=await rpc(admin,'actv_create_order',{p_event_id:stripeRace,p_request_id:randomUUID(),p_channel:'online',p_items:Array.from({length:3},(_,n)=>({package:1,nombre:'Stripe refund '+n,apellido:'Synthetic',telefono:'8685550100',telefono_emergencia:'8685550101',talla_playera:'M'})),p_buyer_email:'synthetic-refund@example.invalid',p_live_mode:false});
  const payment='pi_Refund'+randomUUID().replaceAll('-',''),charge='ch_Refund'+randomUUID().replaceAll('-','');
  await db.query('update actv_payments.orders set provider_payment_id=$1 where id=$2',[payment,online.order_id]);
  await db.query("insert into actv_payments.captures(order_id,account_id,live_mode,provider_payment_id,charge_id,amount,currency) values($1,$2,false,$3,$4,150000,'mxn')",[online.order_id,account,payment,charge]);
  await db.query('select actv_payments.issue($1)',[online.order_id]);
  const stripeDetail=await rpc(manager.client,'actv_participant_refund_detail',{p_order_id:online.order_id}),request=randomUUID();
  const edge=JSON.parse(execFileSync(process.execPath,['node_modules/deno/bin.cjs','run','--allow-env','--allow-net='+new URL(context.apiUrl).host,'--config','supabase/functions/deno.json','tests/staging/refund-edge.ts'],{
   cwd:new URL('../../',import.meta.url),encoding:'utf8',windowsHide:true,timeout:30000,
   env:Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^(?:ACTV_|SUPABASE_|STRIPE_|NEXT_PUBLIC_)/.test(name))),
   input:JSON.stringify({apiUrl:context.apiUrl,serviceKey:context.serviceKey,token:manager.token,deniedToken:cashier.token,order:online.order_id,item:stripeDetail.items[0].id,request,account,payment,charge}),stdio:['pipe','pipe','pipe']}));
  equal(edge.logicalRefunds,1);assertions+=edge.assertions;
  const scopedReceipt=await rpc(manager.client,'actv_sale_receipt',{p_order_id:online.order_id});equal(scopedReceipt.payment_status,'adjusted');equal(scopedReceipt.refunded_minor,50000);equal(scopedReceipt.participants.map(p=>p.entry_allowed),[false,true,true]);
  await rpc(admin,'actv_record_participant_refund',{p_live_mode:false,p_request:request,p_refund:'re_'+request.replaceAll('-',''),p_status:'failed'});
  equal((await rpc(manager.client,'actv_participant_refund_detail',{p_order_id:online.order_id})).items.map(i=>i.eligible),[true,true,true]);
  const unknown='re_Unknown'+randomUUID().replaceAll('-','');
  const adjustment={p_account_id:account,p_live_mode:false,p_reference:unknown,p_kind:'refund',p_payment_id:payment,p_amount:10000,p_currency:'mxn',p_state:'succeeded'};
  await rpc(admin,'actv_record_adjustment',adjustment);
  const held=await rpc(manager.client,'actv_participant_refund_detail',{p_order_id:online.order_id});equal(held.financial.hold,true);equal(held.items.map(i=>i.eligible),[false,false,false]);equal(held.items.map(i=>i.refunded),[0,0,0]);
  await rpc(admin,'actv_record_adjustment',{...adjustment,p_state:'failed'});
  equal((await rpc(manager.client,'actv_participant_refund_detail',{p_order_id:online.order_id})).items.map(i=>i.eligible),[true,true,true]);
  const base={p_operator:manager.id,p_live_mode:false,p_order:online.order_id,p_items:[stripeDetail.items[1].id],p_reason:'Concurrent selected reservation',p_refund_application_fee:false,p_participant_scoped:true};
  const concurrent=await Promise.all([admin.rpc('actv_begin_participant_refund',{...base,p_request:randomUUID()}),admin.rpc('actv_begin_participant_refund',{...base,p_request:randomUUID()})]);
  equal(concurrent.filter(r=>!r.error).length,1);equal(concurrent.filter(r=>r.error).length,1);
  return {assertions,cashGroupOrder:order.order_id,retainedRegistration:retained.registration};
 } finally {await db.query('delete from actv_payments.staff_events where user_id=any($1::uuid[])',[owned]);await db.query('delete from actv_payments.staff where user_id=any($1::uuid[])',[owned]);}
}
