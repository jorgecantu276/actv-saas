import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export async function verifyOperationsContracts(context,retained) {
  assert.equal(new URL(context.apiUrl).hostname,'127.0.0.1');
  const {db}=context,options={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(context.apiUrl,context.serviceKey,options),factory=()=>createClient(context.apiUrl,context.anonKey,options);
  const owned=[];let assertions=0;
  const equal=(a,b)=>{assert.deepEqual(a,b);assertions++;};
  async function rpc(client,name,args={}){const {data,error}=await client.rpc(name,args);assert.equal(error,null,`${name}: ${error?.message}`);assertions++;return data;}
  async function deny(client,name,args={},code='42501'){const {error}=await client.rpc(name,args);assert(error,`Expected ${name} denial`);equal(error.code,code);}
  async function identity(label,role){const email=`ops-${label}-${randomUUID()}@example.invalid`,password='Synthetic-only-Aa1!-'+randomUUID();const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.equal(error,null);const id=data.user.id;owned.push(id);if(role)await db.query('insert into actv_payments.staff(user_id,role,all_events) values($1,$2,$3)',[id,role,role==='manager']);const client=factory();equal((await client.auth.signInWithPassword({email,password})).error,null);return{id,client};}
  try {
    const manager=await identity('manager','manager'),cashier=await identity('cashier','cashier'),other=await identity('other','cashier'),organizer=await identity('organizer');
    const profile=await rpc(organizer.client,'actv_organizer_signup',{p_name:'Synthetic operations organizer'});
    await db.query('insert into actv_payments.staff_events(user_id,event_id) values($1,$2)',[cashier.id,retained.race]);
    equal((await rpc(cashier.client,'actv_operations_context')).manager,false);
    equal((await rpc(organizer.client,'actv_operations_context')).staff,false);
    await deny(factory(),'actv_operations_context');
    await deny(factory(),'actv_operations_events');
    const legacy=await rpc(cashier.client,'actv_operations_event',{p_event_id:retained.race});equal(legacy.id,retained.race);equal(legacy.can_sell,true);equal(legacy.can_manage,false);
    await deny(other.client,'actv_operations_event',{p_event_id:retained.race});
    const legacyRoster=await rpc(cashier.client,'actv_operations_roster',{p_event_id:retained.race,p_query:'00042',p_limit:1});
    equal(legacyRoster.rows.map(r=>r.id),[retained.registration]);equal(legacyRoster.rows[0].actv_eligible,null);equal(legacyRoster.rows[0].folio_asignado,'00042');
    await deny(other.client,'actv_operations_roster',{p_event_id:retained.race});
    await deny(organizer.client,'actv_operations_athletes');
    await deny(cashier.client,'actv_operations_events',{p_limit:101},'22023');
    await deny(cashier.client,'actv_operations_roster',{p_event_id:retained.race,p_offset:-1},'22023');
    const today=(await db.query("select (now() at time zone 'America/Matamoros')::date::text as value")).rows[0].value;
    const values={name:'Synthetic operations race',date:today,distance:'5K',capacity:20,price:500,package_name:'General',live_mode:false,online_enabled:false,slug:'ops-'+randomUUID(),folio_start:500};
    const race=randomUUID();
    await deny(cashier.client,'actv_operations_save_event',{p_event_id:race,p_values:values});
    await deny(manager.client,'actv_operations_save_event',{p_event_id:race,p_values:{...values,live_mode:undefined}},'22023');
    await rpc(manager.client,'actv_operations_save_event',{p_event_id:race,p_values:values});
    equal((await rpc(manager.client,'actv_operations_event',{p_event_id:race})).live_mode,false);
    equal((await db.query('select organizer_id from actv_payments.events where event_id=$1',[race])).rows[0].organizer_id,'00000000-0000-4000-8000-000000000ac7');
    // Changing environment before obligations clears a reader from the old account.
    await db.query("update actv_payments.events set reader_id='tmr_syntheticold' where event_id=$1",[race]);
    await rpc(manager.client,'actv_operations_save_event',{p_event_id:race,p_values:{...values,live_mode:true}});
    equal((await db.query('select reader_id from actv_payments.events where event_id=$1',[race])).rows[0].reader_id,null);
    await deny(manager.client,'actv_operations_save_event',{p_event_id:race,p_values:{...values,live_mode:true,online_enabled:true}},'23514');
    await rpc(manager.client,'actv_operations_save_event',{p_event_id:race,p_values:values});
    await db.query('insert into actv_payments.staff_events(user_id,event_id) values($1,$2)',[cashier.id,race]);
    const athletes=Array.from({length:3},()=>randomUUID());
    for(let n=0;n<athletes.length;n++)await db.query(`insert into public.atletas(id,nombre,apellido,telefono,telefono_emergencia,talla_playera)
      values($1,$2,'Snapshot roster','8685550100','8685550101','M')`,[athletes[n],`Ops participant ${n}`]);
    const order=await rpc(cashier.client,'actv_create_staff_order',{p_event_id:race,p_request_id:randomUUID(),p_channel:'cash',p_relay:false,p_items:athletes.map(athlete_id=>({athlete_id,package:1}))});
    const shift=await rpc(cashier.client,'actv_open_shift',{p_opening:0});
    const issued=await rpc(cashier.client,'actv_confirm_cash',{p_order_id:order.order_id,p_shift_id:shift.id,p_received:150000});
    const before=await rpc(cashier.client,'actv_operations_roster',{p_event_id:race,p_limit:1});
    const next=await rpc(cashier.client,'actv_operations_roster',{p_event_id:race,p_limit:1,p_offset:1});
    equal(before.total,3);equal(before.stats.eligible,3);equal(before.rows.length,1);equal(next.rows.length,1);assert(before.rows[0].id!==next.rows[0].id);assertions++;
    await db.query("update public.atletas set nombre='Mutable replacement' where id=$1",[athletes[0]]);
    equal((await rpc(cashier.client,'actv_operations_roster',{p_event_id:race,p_query:'Ops participant 0'})).total,1);
    equal((await rpc(cashier.client,'actv_operations_roster',{p_event_id:race,p_query:'Mutable replacement'})).total,0);
    equal((await rpc(cashier.client,'actv_operations_athletes',{p_query:'Mutable replacement',p_limit:1})).rows[0].id,athletes[0]);
    equal(await rpc(cashier.client,'actv_operations_athlete_duplicate',{p_name:'Mutable replacement',p_surname:'Snapshot roster',p_phone_last4:'0100'}),true);
    await deny(organizer.client,'actv_operations_athlete_duplicate',{p_name:'Mutable replacement',p_surname:'Snapshot roster',p_phone_last4:'0100'});
    const history=await rpc(cashier.client,'actv_operations_history',{p_athlete_id:athletes[0],p_limit:1});equal(history.total,1);equal(history.rows[0].atletas.nombre,'Ops participant 0');
    await deny(organizer.client,'actv_operations_history',{p_athlete_id:athletes[0]});
    await rpc(cashier.client,'actv_record_attendance',{p_event_id:race,p_registration_id:issued.registrations[0].id});
    equal((await rpc(cashier.client,'actv_operations_roster',{p_event_id:race,p_filter:'present'})).total,1);
    await deny(manager.client,'actv_operations_save_event',{p_event_id:race,p_values:{...values,name:'Changed sold edition'}},'23514');
    await deny(manager.client,'actv_configure_event',{p_event_id:race,p_online_enabled:false,p_slug:'changed-'+randomUUID()},'23514');
    await deny(manager.client,'actv_operations_save_event',{p_event_id:race,p_values:{...values,capacity:2}},'23514');
    const stale=await manager.client.from('eventos').update({activo:false}).eq('id',race);assert(stale.error,'Retired direct event update must fail');assertions++;
    const ownRace=randomUUID();await rpc(organizer.client,'actv_operations_save_event',{p_event_id:ownRace,p_values:{...values,name:'Organizer owned operations',slug:'own-'+randomUUID()}});
    equal((await db.query('select organizer_id from actv_payments.events where event_id=$1',[ownRace])).rows[0].organizer_id,profile.organizer_id);
    const ownedEvent=await rpc(organizer.client,'actv_operations_event',{p_event_id:ownRace});equal(ownedEvent.can_sell,false);equal(ownedEvent.can_manage,true);
    await deny(organizer.client,'actv_configure_event',{p_event_id:ownRace,p_online_enabled:false,p_reader_id:'tmr_unauthorized'},'42501');
    await deny(organizer.client,'actv_configure_event',{p_event_id:ownRace,p_online_enabled:true},'23514');
    await db.query('insert into actv_payments.accounts(organizer_id,live_mode,account_id,ready) values($1,false,$2,true)',[profile.organizer_id,'acct_ops'+randomUUID().replaceAll('-','')]);
    const ownValues={...values,name:'Organizer owned operations',slug:ownedEvent.slug,price2:5,package_name2:'Small cash only'};
    await deny(organizer.client,'actv_operations_save_event',{p_event_id:ownRace,p_values:{...ownValues,online_enabled:true}},'23514');
    await rpc(organizer.client,'actv_operations_save_event',{p_event_id:ownRace,p_values:ownValues});
    await deny(organizer.client,'actv_configure_event',{p_event_id:ownRace,p_online_enabled:true},'23514');
    await deny(organizer.client,'actv_operations_save_event',{p_event_id:race,p_values:values});
    equal((await rpc(organizer.client,'actv_operations_events')).rows.map(r=>r.id),[ownRace]);
    await db.query('delete from actv_payments.members where user_id=$1',[organizer.id]);
    await deny(organizer.client,'actv_operations_event',{p_event_id:ownRace});
    await db.query('update actv_payments.staff set active=false where user_id=$1',[cashier.id]);
    await deny(cashier.client,'actv_operations_event',{p_event_id:race});
    await deny(cashier.client,'actv_operations_roster',{p_event_id:race});
    await deny(cashier.client,'actv_operations_athletes');
    equal((await rpc(cashier.client,'actv_operations_events')).rows,[]);
    equal((await db.query('select count(*)::int as n from public.inscripciones where evento_id=$1',[race])).rows[0].n,3);
    return{assertions,actualAuthAndPostgrest:true,boundedEventScopedReads:true,snapshotRoster:true,legacyContinuity:true,explicitEnvironment:true,modeChangeClearsReader:true,activeRevocation:true,oldEventWritersDenied:true,productionQualified:false};
  } finally {if(owned.length)await db.query('delete from actv_payments.staff where user_id=any($1::uuid[])',[owned]);}
}
