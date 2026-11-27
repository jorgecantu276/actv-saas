import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

function clients(context) {
  const url = new URL(context.apiUrl);
  assert(['127.0.0.1', 'localhost'].includes(url.hostname), 'Full contracts require the owned local API');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  return { admin: createClient(context.apiUrl, context.serviceKey, options),
    client: () => createClient(context.apiUrl, context.anonKey, options) };
}
async function identity(admin, label, marked = false, role = 'Cajero') {
  const password = 'Synthetic-only-Aa1!-' + randomUUID();
  const email = label + '-' + randomUUID() + '@example.invalid';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true,
    user_metadata: { nombre_completo: label, rol: role },
    app_metadata: marked ? { actv_staff_identity: true } : {} });
  assert.equal(error, null, 'Synthetic Auth identity creation must succeed');
  return { id: data.user.id, email, password };
}
async function session(factory, user) {
  const client = factory();
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  assert.equal(error, null, 'Synthetic sign-in must succeed');
  return client;
}
async function rpc(client, name, input = {}) {
  const { data, error } = await client.rpc(name, input);
  assert.equal(error, null, `Expected authorized ${name}`);
  return data;
}
async function denied(client, name, input = {}, code = '42501') {
  const { error } = await client.rpc(name, input);
  assert(error, `Expected denial of ${name}`);
  assert.equal(error.code, code, `Expected explicit authorization/validation code for ${name}, never a missing RPC`);
}
const access = (user, role, events = [], active = true) => ({ p_user: user.id, p_name: 'Synthetic staff',
  p_phone: '8685550100', p_role: role, p_events: events, p_active: active });

export async function seedLegacyState(context) {
  const { db } = context;
  const { admin } = clients(context);
  const manager = await identity(admin, 'retained-manager', false, 'Administrador');
  const legacyStaff = await identity(admin, 'retained-staff');
  const athlete = randomUUID(), race = randomUUID(), otherRace = randomUUID(), registration = randomUUID();
  const evidenceAthlete = randomUUID(), evidenceRegistration = randomUUID(), evidenceReferenceRegistration = randomUUID();
  const orphanRegistration = randomUUID();
  const linkingLegacyRegistration = randomUUID(), linkingLegacyRace = randomUUID();
  const linkingUnpaidRegistration = randomUUID();
  await db.query(`insert into public.eventos(id,nombre_carrera,fecha,organizador,distancia,precio_1,cupo_maximo)
    values($1,'Synthetic unconfigured legacy linking',current_date+7,'ACTV','5K',500,10)`, [linkingLegacyRace]);
  await db.query(`insert into public.inscripciones(id,evento_id,folio_asignado,monto_pagado,metodo_pago)
    values($1,$2,'LEGACY-LINK',500,'efectivo')`, [linkingLegacyRegistration, linkingLegacyRace]);
  // Captured operational amounts are numeric. A stale placeholder cannot be
  // adopted as payment proof; PostgreSQL rejects it before any registration.
  await assert.rejects(db.query(`insert into public.inscripciones(id,evento_id,folio_asignado,monto_pagado,metodo_pago)
    values($1,$2,'LEGACY-UNPAID','WP / Online','online')`, [linkingUnpaidRegistration, linkingLegacyRace]), { code: '22P02' });
  await db.query(`insert into public.inscripciones(id,evento_id,folio_asignado,monto_pagado,metodo_pago)
    values($1,$2,'LEGACY-UNPAID',500,'online')`, [linkingUnpaidRegistration, linkingLegacyRace]);
  await db.query(`insert into public.eventos(id,nombre_carrera,fecha,organizador,distancia,precio_1,cupo_maximo)
    values($1,'Synthetic retained race',current_date+7,'ACTV','5K',500,10),
          ($2,'Synthetic other race',current_date+7,'ACTV','10K',500,10)`, [race, otherRace]);
  await db.query(`insert into public.atletas(id,nombre,apellido,telefono,telefono_emergencia,talla_playera,usuario_id)
    values($1,'Synthetic','Retained','8685550100','8685550101','M',$2)`, [athlete, legacyStaff.id]);
  await db.query(`insert into public.inscripciones(id,atleta_id,evento_id,folio_asignado,monto_pagado,metodo_pago,usuario_id)
    values($1,$2,$3,'00042',700,'efectivo',$4)`, [registration, athlete, race, legacyStaff.id]);
  // Retained unknown-payment registration used by the handover contract. Seed it
  // before the paid-folio guard is installed; never bypass that guard afterwards.
  await db.query(`insert into public.atletas(id,nombre,apellido,telefono,telefono_emergencia,talla_playera)
    values($1,'Synthetic','Evidence legacy','8685550100','8685550101','M')`, [evidenceAthlete]);
  await db.query(`insert into public.inscripciones(id,atleta_id,evento_id,folio_asignado,monto_pagado,metodo_pago)
    values($1,$2,$3,'EVIDENCE-SYNTHETIC',500,'efectivo'),
          ($4,$2,$3,'EVIDENCE-REFERENCE',500,'efectivo')`, [evidenceRegistration, evidenceAthlete, race, evidenceReferenceRegistration]);
  await db.query(`insert into public.inscripciones(id,atleta_id,evento_id,folio_asignado,monto_pagado,metodo_pago)
    values($1,null,$2,'RETAINED-UNKNOWN',500,'efectivo')`, [orphanRegistration, race]);
  const objectPath = 'synthetic-staging-' + randomUUID() + '.txt';
  const objectBytes = Buffer.from('ACTV synthetic retained kit evidence. No participant data.');
  const uploaded = await admin.storage.from('evidencias_kits').upload(objectPath, objectBytes, { contentType: 'text/plain' });
  assert.equal(uploaded.error, null, 'Real Storage API must accept the synthetic retained object');
  const evidenceUrl = admin.storage.from('evidencias_kits').getPublicUrl(objectPath).data.publicUrl;
  await db.query('update public.inscripciones set foto_evidencia=$1 where id=$2', [evidenceUrl, registration]);
  const client = randomUUID(), service = randomUUID(), quote = randomUUID();
  await db.query(`insert into public.clientes(id,nombre_completo) values($1,'Synthetic retained client')`, [client]);
  await db.query(`insert into public.servicios(id,nombre,precio_unitario,tipo_cobro) values($1,'Synthetic service',100,'Fijo')`, [service]);
  await db.query(`insert into public.cotizaciones(id,cliente_id,nombre_evento,subtotal,total) values($1,$2,'Synthetic quote',100,100)`, [quote, client]);
  const club = (await db.query("insert into public.clubes(nombre) values('Synthetic retained club') returning id")).rows[0].id;
  const snapshot = (await db.query(`select id,atleta_id,evento_id,folio_asignado,monto_pagado,metodo_pago,usuario_id,foto_evidencia
    from public.inscripciones where id=$1`, [registration])).rows[0];
  return { manager, legacyStaff, race, otherRace, athlete, registration, evidenceRegistration, evidenceReferenceRegistration, orphanRegistration, linkingLegacyRegistration, linkingLegacyRace, linkingUnpaidRegistration, client, service, quote, club, snapshot, objectPath, objectBytes };
}

export async function verifyStaffLifecycle(context, retained) {
  const { db } = context;
  const { admin, client: factory } = clients(context);
  let assertions = 0;
  const check = condition => { assert(condition); assertions++; };
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
  equal((await db.query(`select id,atleta_id,evento_id,folio_asignado,monto_pagado,metodo_pago,usuario_id,foto_evidencia
    from public.inscripciones where id=$1`, [retained.registration])).rows[0], retained.snapshot);
  const photo = await admin.storage.from('evidencias_kits').download(retained.objectPath);
  equal(photo.error, null);
  equal(Buffer.from(await photo.data.arrayBuffer()), retained.objectBytes);
  await assert.rejects(db.query('delete from storage.objects where bucket_id=$1 and name=$2', ['evidencias_kits', retained.objectPath]),
    error => /storage.*(?:delet|api)|(?:delet).*storage/i.test(error.message));
  assertions++;
  check((await admin.storage.from('evidencias_kits').download(retained.objectPath)).error === null);
  const beforeBootstrap = await session(factory, retained.manager);
  equal(await rpc(beforeBootstrap, 'actv_is_payment_staff'), false);
  // Deliberate fixture bootstrap, not an application migration or profile-label grant.
  await db.query(`insert into actv_payments.staff(user_id,role,all_events) values($1,'manager',true)`, [retained.manager.id]);
  const manager = await session(factory, retained.manager);
  equal(await rpc(manager, 'actv_is_payment_manager'), true);
  const legacy = await session(factory, retained.legacyStaff);
  equal(await rpc(legacy, 'actv_is_payment_staff'), false);
  equal(await rpc(manager, 'actv_find_staff_identity', { p_email: retained.legacyStaff.email }), retained.legacyStaff.id);
  await denied(legacy, 'actv_find_staff_identity', { p_email: retained.manager.email }); assertions++;
  const retainedAuth = (await admin.auth.admin.getUserById(retained.legacyStaff.id)).data.user;
  const adoption = await admin.auth.admin.updateUserById(retained.legacyStaff.id, {
    app_metadata: { ...retainedAuth.app_metadata, actv_staff_identity: true },
  });
  equal(adoption.error, null);
  await rpc(manager, 'actv_set_staff_access', access(retained.legacyStaff, 'Cajero', [retained.race]));
  equal(await rpc(legacy, 'actv_is_payment_staff'), true);
  equal((await session(factory, retained.legacyStaff)).auth !== undefined, true);

  const pending = await identity(admin, 'pending-staff', true);
  const pendingClient = await session(factory, pending);
  equal(await rpc(pendingClient, 'actv_is_payment_staff'), false);
  check((await rpc(manager, 'actv_list_staff')).some(row => row.id === pending.id && row.staff_pending));
  const beforeFailure = (await db.query('select to_jsonb(p) as value from public.perfiles p where id=$1', [pending.id])).rows[0].value;
  await denied(manager, 'actv_set_staff_access', access(pending, 'Cajero', [randomUUID()]), '22023'); assertions++;
  equal((await db.query('select to_jsonb(p) as value from public.perfiles p where id=$1', [pending.id])).rows[0].value, beforeFailure);
  equal(await rpc(pendingClient, 'actv_is_payment_staff'), false);
  await rpc(manager, 'actv_set_staff_access', access(pending, 'Cajero', [retained.race]));
  equal(await rpc(pendingClient, 'actv_is_payment_staff'), true);
  equal(await rpc(pendingClient, 'actv_can_work_event', { p_event_id: retained.race }), true);
  equal(await rpc(pendingClient, 'actv_can_work_event', { p_event_id: retained.otherRace }), false);
  equal(await rpc(pendingClient, 'actv_is_payment_manager'), false);
  for (const table of ['clientes', 'clubes', 'cotizaciones', 'servicios']) {
    const permitted = await pendingClient.from(table).select('id');
    equal(permitted.error, null); check(permitted.data.length > 0);
  }
  await denied(pendingClient, 'actv_set_staff_access', access(pending, 'Administrador')); assertions++;
  const eventRead = await pendingClient.from('eventos').select('id').in('id', [retained.race, retained.otherRace]);
  equal(eventRead.error, null); equal(eventRead.data.map(row => row.id), [retained.race]);
  const legacyRead = await pendingClient.from('inscripciones').select('id,folio_asignado').eq('id', retained.registration);
  equal(legacyRead.error, null); equal(legacyRead.data, [{ id: retained.registration, folio_asignado: '00042' }]);
  const auditCount = Number((await db.query('select count(*) from actv_payments.staff_audit where target_user=$1', [pending.id])).rows[0].count);
  await rpc(manager, 'actv_set_staff_access', access(pending, 'Cajero', [retained.race]));
  equal(Number((await db.query('select count(*) from actv_payments.staff_audit where target_user=$1', [pending.id])).rows[0].count), auditCount);
  const direct = await manager.from('perfiles').update({ rol: 'Administrador' }).eq('id', pending.id);
  check(Boolean(direct.error));

  await rpc(manager, 'actv_set_staff_access', access(pending, 'Cajero', [retained.otherRace]));
  equal(await rpc(pendingClient, 'actv_can_work_event', { p_event_id: retained.race }), false);
  equal(await rpc(pendingClient, 'actv_can_work_event', { p_event_id: retained.otherRace }), true);
  await rpc(manager, 'actv_set_staff_access', access(pending, 'PDV ACTV'));
  equal(await rpc(pendingClient, 'actv_can_work_event', { p_event_id: retained.race }), true);
  equal(await rpc(pendingClient, 'actv_is_payment_manager'), false);
  await rpc(manager, 'actv_set_staff_access', access(pending, 'Moderador', [retained.race]));
  equal(await rpc(pendingClient, 'actv_can_work_event', { p_event_id: retained.race }), true);
  equal(await rpc(pendingClient, 'actv_can_work_event', { p_event_id: retained.otherRace }), false);
  await denied(pendingClient, 'actv_list_staff'); assertions++;
  await db.query(`insert into actv_payments.events(event_id,organizer_id) values
    ($1,'00000000-0000-4000-8000-000000000ac7'),($2,'00000000-0000-4000-8000-000000000ac7')`, [retained.race, retained.otherRace]);
  const cashAthlete = randomUUID(), pendingAthlete = randomUUID();
  await db.query(`insert into public.atletas(id,nombre,apellido,telefono,telefono_emergencia,talla_playera)
    values($1,'Synthetic','Cash sale','8685550100','8685550101','M'),
          ($2,'Synthetic','Pending sale','8685550100','8685550101','M')`, [cashAthlete, pendingAthlete]);
  const staffOrder = (event, athlete) => ({ p_event_id: event, p_request_id: randomUUID(), p_channel: 'cash',
    p_items: [{ athlete_id: athlete, package: 1 }], p_relay: false });
  await denied(pendingClient, 'actv_create_staff_order', staffOrder(retained.otherRace, cashAthlete)); assertions++;
  const shift = await rpc(pendingClient, 'actv_open_shift', { p_opening: 0 });
  const cashOrder = await rpc(pendingClient, 'actv_create_staff_order', staffOrder(retained.race, cashAthlete));
  const issued = await rpc(pendingClient, 'actv_confirm_cash', { p_order_id: cashOrder.order_id, p_shift_id: shift.id, p_received: 50000 });
  equal(issued.state, 'issued'); equal(issued.registrations.length, 1);
  const pendingOrder = await rpc(pendingClient, 'actv_create_staff_order', staffOrder(retained.race, pendingAthlete));
  equal((await rpc(pendingClient, 'actv_cash_shift')).id, shift.id);
  await db.query(`insert into actv_payments.accounts(organizer_id,live_mode,account_id,ready)
    values('00000000-0000-4000-8000-000000000ac7',false,'acct_syntheticstaffstaging',true)`);
  await db.query("update actv_payments.events set reader_id='tmr_syntheticstaff' where event_id=$1", [retained.race]);
  const terminalAthlete = randomUUID();
  await db.query(`insert into public.atletas(id,nombre,apellido,telefono,telefono_emergencia,talla_playera)
    values($1,'Synthetic','Terminal pending','8685550100','8685550101','M')`, [terminalAthlete]);
  const terminalOrder = await rpc(pendingClient, 'actv_create_staff_order', {
    ...staffOrder(retained.race, terminalAthlete), p_channel: 'terminal',
  });
  await rpc(manager, 'actv_set_staff_access', access(pending, 'Moderador', [retained.otherRace]));
  await denied(pendingClient, 'actv_staff_order_status', { p_order_id: terminalOrder.order_id }); assertions++;
  await rpc(manager, 'actv_set_staff_access', access(pending, 'Moderador', [retained.race]));
  equal((await rpc(pendingClient, 'actv_staff_order_status', { p_order_id: terminalOrder.order_id })).order_id, terminalOrder.order_id);
  equal(await rpc(manager, 'actv_staff_password_target', { p_user: pending.id }), true);
  await rpc(manager, 'actv_set_staff_access', access(pending, 'Moderador', [retained.race], false));
  equal(await rpc(pendingClient, 'actv_is_payment_staff'), false);
  equal(await rpc(pendingClient, 'actv_can_work_event', { p_event_id: retained.race }), false);
  equal((await pendingClient.from('inscripciones').select('id').eq('id', retained.registration)).data, []);
  await denied(pendingClient, 'actv_open_shift', { p_opening: 0 }); assertions++;
  await denied(pendingClient, 'actv_cash_shift'); assertions++;
  await denied(pendingClient, 'actv_close_shift', { p_shift_id: shift.id, p_counted: 50000 }); assertions++;
  await denied(pendingClient, 'actv_cancel_cash', { p_order_id: pendingOrder.order_id }); assertions++;
  await denied(pendingClient, 'actv_staff_order_status', { p_order_id: cashOrder.order_id }); assertions++;
  equal((await db.query('select closed_at from actv_payments.shifts where id=$1', [shift.id])).rows[0].closed_at, null);
  equal((await db.query('select state from actv_payments.orders where id=$1', [pendingOrder.order_id])).rows[0].state, 'pending');
  const token = (await pendingClient.auth.getSession()).data.session.access_token;
  const edgeEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(?:ACTV_|SUPABASE_|STRIPE_|NEXT_PUBLIC_)/.test(name)));
  const apiHost = new URL(context.apiUrl).host;
  const edgeProof = JSON.parse(execFileSync(process.execPath, ['node_modules/deno/bin.cjs', 'run', '--allow-env',
    '--allow-net=' + apiHost, '--config', 'supabase/functions/deno.json', 'tests/staging/staff-edge.ts'], {
    cwd: new URL('../../', import.meta.url), env: edgeEnvironment, encoding: 'utf8', windowsHide: true,
    input: JSON.stringify({ apiUrl: context.apiUrl, serviceKey: context.serviceKey, token, orderId: terminalOrder.order_id }),
    stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000,
  }));
  equal(edgeProof.deniedActions, ['start', 'retry', 'status', 'cancel']);
  equal(edgeProof.externalProviderRequests, 0);
  for (const table of ['clientes', 'clubes', 'cotizaciones', 'servicios']) {
    const revoked = await pendingClient.from(table).select('id');
    equal(revoked.error, null); equal(revoked.data, []);
  }
  check(Boolean((await pendingClient.from('clientes').insert({ nombre_completo: 'Denied revoked write' })).error));
  await denied(manager, 'actv_staff_password_target', { p_user: pending.id }); assertions++;
  equal((await admin.auth.admin.getUserById(pending.id)).data.user.id, pending.id);
  check((await db.query('select 1 from public.inscripciones where id=$1', [retained.registration])).rowCount === 1);

  const forged = factory();
  const forgedEmail = 'forged-' + randomUUID() + '@example.invalid';
  const password = 'Synthetic-only-Aa1!-' + randomUUID();
  const signup = await forged.auth.signUp({ email: forgedEmail, password,
    options: { data: { nombre_completo: 'Synthetic runner', rol: 'Administrador', actv_staff_identity: true } } });
  equal(signup.error, null);
  await admin.auth.admin.updateUserById(signup.data.user.id, { email_confirm: true });
  const runner = await session(factory, { email: forgedEmail, password });
  equal(await rpc(runner, 'actv_is_payment_staff'), false);
  for (const table of ['clientes', 'clubes', 'cotizaciones', 'servicios']) equal((await runner.from(table).select('id')).data, []);
  equal((await runner.from('perfiles').select('rol').eq('id', signup.data.user.id).single()).data.rol, 'Cajero');
  await denied(manager, 'actv_set_staff_access', access(signup.data.user, 'Administrador')); assertions++;
  await denied(manager, 'actv_staff_password_target', { p_user: signup.data.user.id }); assertions++;

  const second = await identity(admin, 'second-manager', true);
  await rpc(manager, 'actv_set_staff_access', access(second, 'Administrador'));
  const secondManager = await session(factory, second);
  const removals = await Promise.all([
    manager.rpc('actv_set_staff_access', access(second, 'Administrador', [], false)),
    secondManager.rpc('actv_set_staff_access', access(retained.manager, 'Administrador', [], false)),
  ]);
  equal(removals.filter(result => !result.error).length, 1);
  equal(Number((await db.query("select count(*) from actv_payments.staff where role='manager' and active")).rows[0].count), 1);
  const survivor = removals[0].error ? secondManager : manager;
  const survivorIdentity = removals[0].error ? second : retained.manager;
  await denied(survivor, 'actv_set_staff_access', access(survivorIdentity, 'Administrador', [], false), '23514'); assertions++;
  const removal = await admin.storage.from('evidencias_kits').remove([retained.objectPath]);
  equal(removal.error, null);
  check(Boolean((await admin.storage.from('evidencias_kits').download(retained.objectPath)).error));
  return { assertions, actualAuthAndPostgrest: true, retainedIdsAndFoliosPreserved: true,
    actualStorageApiContinuity: true, storageSqlDeletionProtection: true,
    pendingSameIdentityRecovery: true, activeTokenRevocation: true, lastManagerConcurrency: true,
    scopedModeratorCashSale: true, revokedFinancialRpcDenied: true,
    actualEdgeRevocationDenied: true,
    storagePrivacyAccepted: false, productionQualified: false };
}
