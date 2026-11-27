import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export async function verifyLifecycleContracts(context) {
 const {db,apiUrl,anonKey,serviceKey}=context;
 assert.equal(new URL(apiUrl).hostname,'127.0.0.1');
 const options={auth:{persistSession:false,autoRefreshToken:false}},admin=createClient(apiUrl,serviceKey,options),staff=[];
 let assertions=0;
 const equal=(a,b)=>{assert.deepEqual(a,b);assertions++;};
 async function rpc(client,name,args={}){const {data,error}=await client.rpc(name,args);assert.equal(error,null,`${name}: ${error?.message}`);assertions++;return data;}
 async function denied(client,name,args={},code='42501'){const {error}=await client.rpc(name,args);assert(error,`${name} must deny`);equal(error.code,code);}
 async function identity(role){const email=`lifecycle-${randomUUID()}@example.invalid`,password='Synthetic-Aa1!'+randomUUID();const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});equal(error,null);if(role){staff.push(data.user.id);await db.query('insert into actv_payments.staff(user_id,role,all_events) values($1,$2,true)',[data.user.id,role]);}const client=createClient(apiUrl,anonKey,options);equal((await client.auth.signInWithPassword({email,password})).error,null);return{id:data.user.id,email,client};}
 try{
 const manager=await identity('manager'),cashier=await identity('cashier'),runner=await identity(),outsider=await identity();
 const race=randomUUID(),today=(await db.query("select (now() at time zone 'America/Matamoros')::date::text value")).rows[0].value;
 await rpc(manager.client,'actv_operations_save_event',{p_event_id:race,p_values:{name:'Synthetic lifecycle',date:today,distance:'5K',capacity:20,price:500,package_name:'General',live_mode:false,online_enabled:false,slug:'lifecycle-'+randomUUID(),folio_start:900}});
 const athletes=[randomUUID(),randomUUID()];for(const [n,id] of athletes.entries())await db.query("insert into public.atletas(id,nombre,apellido,telefono,telefono_emergencia,talla_playera) values($1,$2,'Lifecycle','8685550100','8685550101','M')",[id,'Runner '+n]);
 const shift=await rpc(manager.client,'actv_open_shift',{p_opening:0});
 const order=await rpc(manager.client,'actv_create_staff_order',{p_event_id:race,p_request_id:randomUUID(),p_channel:'cash',p_items:athletes.map(athlete_id=>({athlete_id,package:1})),p_relay:false});
 await rpc(manager.client,'actv_confirm_cash',{p_order_id:order.order_id,p_shift_id:shift.id,p_received:100000});
 const regs=(await db.query('select r.id,r.folio_asignado,r.actv_order_item_id from public.inscripciones r join actv_payments.items i on i.id=r.actv_order_item_id where i.order_id=$1 order by i.number',[order.order_id])).rows;
 const token=randomBytes(32).toString('hex');await rpc(manager.client,'actv_create_participant_invitation',{p_registration_id:regs[0].id,p_recipient_email:runner.email,p_request_id:randomUUID(),p_token:token,p_reason:'Synthetic in-person identity check completed',p_verification_method:'in_person'});
 await rpc(runner.client,'actv_accept_participant_invitation',{p_token:token});
 await rpc(cashier.client,'actv_record_attendance',{p_event_id:race,p_registration_id:regs[0].id});
 const original=(await db.query('select * from actv_payments.attendance where registration_id=$1',[regs[0].id])).rows[0];
 const slug=await rpc(runner.client,'actv_publish_achievement',{p_event_id:race,p_folio:regs[0].folio_asignado});
 equal((await rpc(admin,'actv_public_achievement',{p_slug:slug})).event_name,'Synthetic lifecycle');
 const correction={p_registration_id:regs[0].id,p_expected_revision:0,p_request_id:randomUUID(),p_present:false,p_reason:'Synthetic operator corrected a mistaken check-in'};
 await denied(cashier.client,'actv_correct_attendance',correction);await denied(outsider.client,'actv_attendance_history',{p_registration_id:regs[0].id});
 equal((await rpc(manager.client,'actv_correct_attendance',correction)).present,false);await rpc(manager.client,'actv_correct_attendance',correction);
 equal(await rpc(admin,'actv_public_achievement',{p_slug:slug}),null);
 await denied(cashier.client,'actv_record_attendance',{p_event_id:race,p_registration_id:regs[0].id},'23514');
 await denied(manager.client,'actv_correct_attendance',{...correction,p_request_id:randomUUID(),p_present:true},'23514');
 equal((await rpc(manager.client,'actv_correct_attendance',{...correction,p_request_id:randomUUID(),p_expected_revision:1,p_present:true})).present,true);
 // A provider attempt accepted before cancellation remains reconcilable. Its
 // capture must not issue a new usable registration after cancellation.
 await db.query("insert into actv_payments.accounts(organizer_id,live_mode,account_id,ready) values('00000000-0000-4000-8000-000000000ac7',false,'acct_lifecycle',true) on conflict(organizer_id,live_mode) do nothing");
 const account=(await db.query("select account_id from actv_payments.accounts where organizer_id='00000000-0000-4000-8000-000000000ac7' and not live_mode")).rows[0].account_id;
 await db.query('update actv_payments.events set online_enabled=true where event_id=$1',[race]);
 const late=await rpc(admin,'actv_create_order',{p_event_id:race,p_request_id:randomUUID(),p_channel:'online',p_items:[{nombre:'Late',apellido:'Synthetic',telefono:'8685550100',telefono_emergencia:'8685550101',talla_playera:'M',package:1}],p_operator:null,p_relay:false,p_buyer_email:runner.email,p_live_mode:false});
 await rpc(admin,'actv_authorize_provider_attempt',{p_order_id:late.order_id,p_kind:'checkout',p_attempt:'canonical'});
 const suffix=randomUUID().replaceAll('-','');
 await rpc(admin,'actv_attach_provider',{p_order_id:late.order_id,p_account_id:account,p_live_mode:false,p_session_id:'cs_'+suffix,p_payment_id:'pi_'+suffix});
 const tomorrow=(await db.query("select ((now() at time zone 'America/Matamoros')::date+1)::text value")).rows[0].value;
 const transition={p_event_id:race,p_expected_revision:0,p_request_id:randomUUID(),p_action:'postpone',p_reason:'Synthetic operational date change approved for fixture',p_public_message:'Synthetic postponed event notice',p_new_date:tomorrow};
 equal((await rpc(manager.client,'actv_transition_event',transition)).phase,'postponed');
 equal((await rpc(runner.client,'actv_runner_dashboard')).registrations[0].event_date,today);
 await rpc(manager.client,'actv_correct_attendance',{...correction,p_request_id:randomUUID(),p_expected_revision:2,p_present:false});
 await rpc(manager.client,'actv_correct_attendance',{...correction,p_request_id:randomUUID(),p_expected_revision:3,p_present:true});
 equal((await rpc(runner.client,'actv_runner_dashboard')).registrations[0].event_date,today);
 equal(await rpc(admin,'actv_catalog',{p_event_id:race}),null);
 equal((await rpc(admin,'actv_public_races',{p_live_mode:false})).some(r=>r.event_id===race),false);
 await denied(manager.client,'actv_create_staff_order',{p_event_id:race,p_request_id:randomUUID(),p_channel:'cash',p_items:[{athlete_id:athletes[0],package:1}],p_relay:false},'23514');
 await rpc(manager.client,'actv_transition_event',{...transition,p_request_id:randomUUID(),p_expected_revision:1,p_action:'resume',p_new_date:null});
 equal((await rpc(admin,'actv_catalog',{p_event_id:race})).event_id,race);
 await rpc(manager.client,'actv_transition_event',{...transition,p_request_id:randomUUID(),p_expected_revision:2,p_action:'pause',p_new_date:null});
 equal(await rpc(admin,'actv_authorize_provider_attempt',{p_order_id:late.order_id,p_kind:'checkout',p_attempt:'canonical'}),true);
 await rpc(manager.client,'actv_transition_event',{...transition,p_request_id:randomUUID(),p_expected_revision:3,p_action:'resume',p_new_date:null});
 const cancelled={p_event_id:race,p_expected_revision:4,p_request_id:randomUUID(),p_action:'cancel',p_reason:'Synthetic event cancellation approved for fixture',p_public_message:'Synthetic cancellation notice',p_new_date:null};
 await denied(cashier.client,'actv_transition_event',cancelled);await denied(outsider.client,'actv_event_lifecycle',{p_event_id:race});
 equal((await rpc(manager.client,'actv_transition_event',cancelled)).phase,'cancelled');await rpc(manager.client,'actv_transition_event',cancelled);
 equal(await rpc(admin,'actv_authorize_provider_attempt',{p_order_id:late.order_id,p_kind:'checkout',p_attempt:'canonical'}),true);
 const lateResult=await rpc(admin,'actv_confirm_stripe',{p_order_id:late.order_id,p_account_id:account,p_live_mode:false,p_payment_id:'pi_'+suffix,p_amount:50000,p_currency:'mxn',p_session_id:'cs_'+suffix,p_charge_id:'ch_'+suffix});
 equal(lateResult.state,'review');equal(lateResult.registrations.length,0);
 equal((await db.query('select count(*)::integer n from actv_payments.captures where order_id=$1',[late.order_id])).rows[0].n,1);
 await denied(manager.client,'actv_transition_event',{...cancelled,p_request_id:randomUUID(),p_expected_revision:5,p_action:'resume'},'23514');
 await denied(cashier.client,'actv_record_attendance',{p_event_id:race,p_registration_id:regs[1].id},'P0002');
 const roster=await rpc(manager.client,'actv_operations_roster',{p_event_id:race,p_filter:'present'});equal(roster.total,1);equal(roster.can_record,false);equal(roster.rows[0].entry_allowed,false);
 let dashboard=await rpc(runner.client,'actv_runner_dashboard');equal(dashboard.attended_count,1);equal(dashboard.registrations[0].entry_allowed,false);equal(dashboard.registrations[0].event_status,'cancelled');
 equal((await rpc(runner.client,'actv_accept_participant_invitation',{p_token:token})).registration_id,regs[0].id);
 const receipt=await rpc(manager.client,'actv_sale_receipt',{p_order_id:order.order_id});equal(receipt.payment_status,'adjusted');equal(receipt.participants.map(p=>p.entry_allowed),[false,false]);
 const refund=await rpc(manager.client,'actv_participant_refund_detail',{p_order_id:order.order_id});
 await rpc(manager.client,'actv_cash_participant_refund',{p_order:order.order_id,p_request:randomUUID(),p_items:refund.items.map(i=>i.id),p_reason:'Synthetic cancellation full cash disbursement confirmed',p_participant_scoped:false,p_shift:shift.id,p_disbursed:true});
 dashboard=await rpc(runner.client,'actv_runner_dashboard');equal(dashboard.attended_count,1);equal(dashboard.registrations.length,1);
 equal((await db.query('select * from actv_payments.attendance where registration_id=$1',[regs[0].id])).rows[0],original);
 equal((await db.query('select r.id,r.folio_asignado,r.actv_order_item_id from public.inscripciones r join actv_payments.items i on i.id=r.actv_order_item_id where i.order_id=$1 order by i.number',[order.order_id])).rows,regs);
 equal((await db.query('select actv_payments.used($1)::integer n',[race])).rows[0].n,2);
 equal((await rpc(manager.client,'actv_close_shift',{p_shift_id:shift.id,p_counted:0})).variance,0);
 await denied(manager.client,'actv_create_staff_order',{p_event_id:race,p_request_id:randomUUID(),p_channel:'cash',p_items:[{athlete_id:athletes[0],package:1}],p_relay:false},'23514');
 return {assertions,checks:['terminal cancellation','scoped authorization','idempotent audited attendance corrections','immutable original observation','attendance survives cancellation and refund','original folios and capacity retained','adjusted receipt','no ordinary correction bypass']};
 }finally{await db.query('delete from actv_payments.staff_events where user_id=any($1::uuid[])',[staff]);await db.query('delete from actv_payments.staff where user_id=any($1::uuid[])',[staff]);}
}


