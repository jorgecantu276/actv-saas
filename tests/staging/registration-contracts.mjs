import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export async function verifyRegistrationContracts(context, retained) {
  const { db, apiUrl, anonKey, serviceKey } = context;
  assert(['127.0.0.1', 'localhost'].includes(new URL(apiUrl).hostname));
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(apiUrl, serviceKey, options);
  const anonymous = createClient(apiUrl, anonKey, options);
  const ownedStaff = [];
  let assertions = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
  const check = condition => { assert(condition); assertions++; };
  const rpc = async (client, name, input = {}) => {
    const result = await client.rpc(name, input);
    assert.equal(result.error, null, `${name}: ${result.error?.message}`); assertions++;
    return result.data;
  };
  const denied = async (client, name, input = {}, code = '42501') => {
    const { error } = await client.rpc(name, input);
    assert(error, `Expected explicit denial of ${name}`);
    equal(error.code, code);
  };
  const identity = async (role = null, allEvents = false) => {
    const email = `snapshot-${randomUUID()}@example.invalid`, password = 'Synthetic-only-Aa1!-' + randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    equal(created.error, null);
    const id = created.data.user.id;
    if (role) {
      await db.query('insert into actv_payments.staff(user_id,role,all_events) values($1,$2,$3)', [id, role, allEvents]);
      ownedStaff.push(id);
    }
    const client = createClient(apiUrl, anonKey, options);
    equal((await client.auth.signInWithPassword({ email, password })).error, null);
    return { id, client };
  };
  try {
    const manager = await identity('manager', true), cashier = await identity('cashier'), outsider = await identity('cashier');
    const organizer = await identity();
    const race = randomUUID();
    await db.query(`insert into public.eventos(id,nombre_carrera,fecha,organizador,distancia,precio_1,nombre_precio_1,cupo_maximo,folio_inicial)
      values($1,'Synthetic accepted edition',current_date+7,'ACTV','5K',500,'Accepted package',100,1)`, [race]);
    const organizerRecord = await rpc(organizer.client, 'actv_organizer_signup', { p_name: 'Synthetic snapshot organizer' });
    const account = 'acct_snapshot' + randomUUID().replaceAll('-', '');
    await db.query('insert into actv_payments.events(event_id,organizer_id,online_enabled,reader_id) values($1,$2,true,$3)',
      [race, organizerRecord.organizer_id, 'tmr_snapshot']);
    await db.query('insert into actv_payments.accounts(organizer_id,live_mode,account_id,ready) values($1,false,$2,true)', [organizerRecord.organizer_id, account]);
    await db.query('insert into actv_payments.staff_events(user_id,event_id) values($1,$2)', [cashier.id, race]);
    const policy = { p_event_id: race, p_required_fields: ['fecha_nacimiento'], p_notice_version: 'notice-synthetic-v1',
      p_notice_text: 'Synthetic test privacy notice. Not a real approved notice.', p_waiver_version: 'waiver-synthetic-v1',
      p_waiver_text: 'Synthetic test race participation terms. Not a real waiver.' };
    await denied(cashier.client, 'actv_set_registration_policy', policy);
    await denied(manager.client, 'actv_set_registration_policy', { ...policy, p_required_fields: ['account_id'] }, '22023');
    await denied(manager.client, 'actv_set_registration_policy', { ...policy, p_notice_text: null }, '22023');
    const configured = await rpc(manager.client, 'actv_set_registration_policy', policy);
    equal(configured.revision, 1);
    check(configured.required_fields.includes('nombre') && configured.required_fields.includes('fecha_nacimiento'));
    equal((await rpc(anonymous, 'actv_registration_policy', { p_event_id: race })).notice_text, policy.p_notice_text);
    equal((await rpc(admin, 'actv_catalog', { p_event_id: race })).registration_policy, configured);
    const consent = { policy_revision: 1, notice_version: policy.p_notice_version, notice_accepted: true,
      waiver_version: policy.p_waiver_version, waiver_accepted: true };
    const athlete = async (label = 'Original', fields = {}) => {
      const id = randomUUID();
      await db.query(`insert into public.atletas(id,nombre,apellido,telefono,telefono_emergencia,talla_playera,fecha_nacimiento,ciudad,club,email)
        values($1,$2,'Snapshot','8685550100','8685550101','M','2000-01-02','Matamoros','Synthetic club',$3)`,
      [id, label, `athlete-${randomUUID()}@example.invalid`]);
      if (Object.keys(fields).length) {
        assert.deepEqual(Object.keys(fields), ['telefono']);
        await db.query('update public.atletas set telefono=$2 where id=$1', [id, fields.telefono]);
      }
      return id;
    };
    const input = (id, channel = 'cash', chosenConsent = consent) => ({ p_event_id: race, p_request_id: randomUUID(),
      p_channel: channel, p_items: [{ athlete_id: id, package: 1, ...(chosenConsent ? { consent: chosenConsent } : {}) }], p_relay: false });
    const firstAthlete = await athlete();
    await denied(cashier.client, 'actv_create_staff_order', input(firstAthlete, 'cash', null), '22023');
    await denied(cashier.client, 'actv_create_staff_order', input(firstAthlete, 'terminal', { ...consent, notice_accepted: 'true' }), '22023');
    const badAthlete = await athlete('Bad field', { telefono: '123' });
    await denied(cashier.client, 'actv_create_staff_order', input(badAthlete), '22023');
    const originalInput = input(firstAthlete);
    const cash = await rpc(cashier.client, 'actv_create_staff_order', originalInput);
    const accepted = (await db.query('select accepted_snapshot from actv_payments.items where order_id=$1', [cash.order_id])).rows[0].accepted_snapshot;
    equal(accepted.participant.nombre, 'Original'); equal(accepted.participant.talla_playera, 'M');
    equal(accepted.participant.fecha_nacimiento, '2000-01-02'); equal(accepted.package.amount_minor, 50000);
    equal(accepted.event.name, 'Synthetic accepted edition'); equal(accepted.consent.status, 'accepted');
    equal(accepted.consent.actor, cashier.id); check(accepted.accepted_at && accepted.consent.recorded_at);
    await db.query("update public.atletas set nombre='Later profile',talla_playera='XL',ciudad='Later city' where id=$1", [firstAthlete]);
    await db.query("update public.eventos set nombre_carrera='Later event',precio_1=800,fecha=fecha+1 where id=$1", [race]);
    await rpc(manager.client, 'actv_set_registration_policy', { ...policy, p_notice_version: 'notice-synthetic-v2', p_notice_text: 'Updated synthetic notice.' });
    // Retry remains bound to its original basket, snapshot and policy revision.
    equal((await rpc(cashier.client, 'actv_create_staff_order', originalInput)).order_id, cash.order_id);
    await denied(cashier.client, 'actv_create_staff_order', { ...originalInput,
      p_items: [{ ...originalInput.p_items[0], consent: { ...consent, notice_version: 'notice-synthetic-v2' } }] }, 'P0001');
    const shift = await rpc(cashier.client, 'actv_open_shift', { p_opening: 0 });
    const issued = await rpc(cashier.client, 'actv_confirm_cash', { p_order_id: cash.order_id, p_shift_id: shift.id, p_received: 50000 });
    equal(issued.state, 'issued');
    const registration = issued.registrations[0].id;
    const recordInput = { p_registration_id: registration };
    const original = await rpc(cashier.client, 'actv_registration_record', recordInput);
    equal(original.original, accepted); equal(original.effective, accepted); equal(original.revision, 0);
    equal(original.provenance, 'accepted_order'); equal(original.can_correct, false);
    const receipt = await rpc(cashier.client, 'actv_sale_receipt', { p_order_id: cash.order_id });
    equal(receipt.event_name, accepted.event.name); equal(receipt.event_date, accepted.event.date);
    equal(receipt.participants[0].name, 'Original'); equal(receipt.participants[0].shirt_size, 'M');
    equal(receipt.participants[0].revision, 0);
    equal((await rpc(organizer.client, 'actv_registration_record', recordInput)).effective, accepted);
    await denied(outsider.client, 'actv_registration_record', recordInput);
    await denied(anonymous, 'actv_registration_record', recordInput);
    const corrections = { p_registration_id: registration, p_expected_revision: 0, p_request_id: randomUUID(),
      p_patch: { nombre: 'Corrected typo', telefono: '8685550199' }, p_reason: 'Synthetic identity-checked typo correction' };
    await denied(cashier.client, 'actv_correct_registration', corrections);
    await denied(organizer.client, 'actv_correct_registration', corrections);
    for (const field of ['athlete_id', 'account_id', 'event_id', 'folio', 'package', 'amount_minor', 'consent']) {
      await denied(manager.client, 'actv_correct_registration', { ...corrections, p_patch: { [field]: 'forbidden' } }, '22023');
    }
    await denied(manager.client, 'actv_correct_registration', { ...corrections, p_patch: { fecha_nacimiento: '2099-01-01' } }, '22023');
    await denied(manager.client, 'actv_correct_registration', { ...corrections, p_patch: { talla_playera: null } }, '22023');
    const beforeIdentity = (await db.query('select id,atleta_id,evento_id,folio_asignado,monto_pagado,actv_order_item_id from public.inscripciones where id=$1', [registration])).rows[0];
    const corrected = await rpc(manager.client, 'actv_correct_registration', corrections);
    equal(corrected.revision, 1); equal(corrected.effective.participant.nombre, 'Corrected typo');
    const correctedReceipt = await rpc(manager.client, 'actv_sale_receipt', { p_order_id: cash.order_id });
    equal(correctedReceipt.participants[0].name, 'Corrected typo'); equal(correctedReceipt.participants[0].revision, 1);
    equal(correctedReceipt.participants[0].shirt_size, 'M'); equal(correctedReceipt.amount_minor, 50000);
    const correctedRoster = await rpc(cashier.client, 'actv_operations_roster', { p_event_id: race, p_query: 'Corrected typo' });
    equal(correctedRoster.rows.length, 1); equal(correctedRoster.rows[0].atletas.talla_playera, 'M');
    equal(corrected.original, accepted); equal(corrected.effective.package, accepted.package); equal(corrected.effective.event, accepted.event);
    equal(corrected.corrections.length, 1); equal(corrected.corrections[0].actor, manager.id);
    equal(corrected.corrections[0].before, accepted); equal(corrected.corrections[0].after, corrected.effective);
    equal((await rpc(manager.client, 'actv_correct_registration', corrections)).applied_revision, 1);
    await denied(manager.client, 'actv_correct_registration', { ...corrections, p_patch: { nombre: 'Different retry' } }, '23514');
    await denied(manager.client, 'actv_correct_registration', { ...corrections, p_request_id: randomUUID() }, '23514');
    const concurrent = await Promise.all(['First', 'Second'].map(nombre => manager.client.rpc('actv_correct_registration', {
      ...corrections, p_expected_revision: 1, p_request_id: randomUUID(), p_patch: { nombre },
    })));
    equal(concurrent.filter(result => !result.error).length, 1);
    equal(concurrent.find(result => result.error).error.code, '23514');
    const current = await rpc(manager.client, 'actv_registration_record', recordInput);
    equal(current.revision, 2); equal(current.corrections.length, 2); equal(current.original, accepted);
    equal((await db.query('select id,atleta_id,evento_id,folio_asignado,monto_pagado,actv_order_item_id from public.inscripciones where id=$1', [registration])).rows[0], beforeIdentity);
    equal((await db.query('select nombre from public.atletas where id=$1', [firstAthlete])).rows[0].nombre, 'Later profile');
    await assert.rejects(db.query("update actv_payments.items set accepted_snapshot='{}' where order_id=$1", [cash.order_id]), { code: '23514' }); assertions++;
    await assert.rejects(db.query("update actv_payments.registration_corrections set reason='Changed' where request_id=$1", [corrections.p_request_id]), { code: '42501' }); assertions++;
    await assert.rejects(db.query("delete from actv_payments.registration_corrections where request_id=$1", [corrections.p_request_id]), { code: '42501' }); assertions++;
    await assert.rejects(db.query("update actv_payments.registration_snapshots set effective='{}' where registration_id=$1", [registration]), { code: '42501' }); assertions++;
    const historical = await rpc(manager.client, 'actv_registration_record', { p_registration_id: retained.registration });
    equal(historical.original, null); equal(historical.provenance, 'legacy_observed_at_upgrade'); equal(historical.consent.status, 'unknown');
    const unknown = await rpc(manager.client, 'actv_registration_record', { p_registration_id: retained.orphanRegistration });
    equal(unknown.original, null); equal(unknown.effective.participant.nombre, null); equal(unknown.effective.participant.talla_playera, null);
    const correctedUnknown = await rpc(manager.client, 'actv_correct_registration', {
      p_registration_id: retained.orphanRegistration, p_expected_revision: 0, p_request_id: randomUUID(),
      p_patch: { nombre: 'Synthetic known name' }, p_reason: 'Synthetic verified correction with other facts unknown',
    });
    equal(correctedUnknown.effective.participant.nombre, 'Synthetic known name');
    equal(correctedUnknown.effective.participant.telefono_emergencia, null);
    equal(correctedUnknown.effective.participant.talla_playera, null); equal(correctedUnknown.original, null);
    const unknownReceipt = await rpc(manager.client, 'actv_sale_receipt', { p_registration_id: retained.orphanRegistration });
    equal(unknownReceipt.payment_status, 'payment_unverified'); equal(unknownReceipt.participants[0].athlete_id, null);
    equal(unknownReceipt.participants[0].name, 'Synthetic known name'); equal(unknownReceipt.participants[0].shirt_size, null);
    const updatedConsent = { ...consent, policy_revision: 2, notice_version: 'notice-synthetic-v2' };
    const guest = { nombre: 'Guest accepted', apellido: 'Snapshot', telefono: '8685550100', telefono_emergencia: '8685550101',
      talla_playera: 'S', fecha_nacimiento: '1999-03-04', ciudad: 'Guest city', package: 1, consent: updatedConsent };
    const guestInput = { p_event_id: race, p_request_id: randomUUID(), p_channel: 'online', p_items: [guest], p_buyer_email: 'synthetic@example.invalid', p_live_mode: false };
    await denied(admin, 'actv_create_order', { ...guestInput, p_items: [{ ...guest, consent: {} }] }, '22023');
    await denied(admin, 'actv_create_order', { ...guestInput, p_items: [{ ...guest, fecha_nacimiento: null }] }, '22023');
    const online = await rpc(admin, 'actv_create_order', guestInput);
    const onlineAccepted = (await db.query('select accepted_snapshot from actv_payments.items where order_id=$1', [online.order_id])).rows[0].accepted_snapshot;
    equal(onlineAccepted.participant.ciudad, guest.ciudad); equal(onlineAccepted.participant.fecha_nacimiento, guest.fecha_nacimiento);
    equal(onlineAccepted.consent.actor, null); equal(onlineAccepted.consent.channel, 'online'); equal(onlineAccepted.policy_revision, 2);
    await rpc(admin, 'actv_attach_provider', { p_order_id: online.order_id, p_account_id: account, p_live_mode: false,
      p_session_id: 'cs_snapshot', p_payment_id: 'pi_snapshot' });
    const paidOnline = await rpc(admin, 'actv_confirm_stripe', { p_order_id: online.order_id, p_account_id: account, p_live_mode: false,
      p_payment_id: 'pi_snapshot', p_amount: 80000, p_currency: 'mxn', p_session_id: 'cs_snapshot', p_charge_id: 'ch_snapshot' });
    equal(paidOnline.state, 'issued');
    equal((await rpc(manager.client, 'actv_registration_record', { p_registration_id: paidOnline.registrations[0].id })).original, onlineAccepted);
    const terminalAthlete = await athlete('Terminal accepted');
    const terminal = await rpc(cashier.client, 'actv_create_staff_order', input(terminalAthlete, 'terminal', updatedConsent));
    const terminalAccepted = (await db.query('select accepted_snapshot from actv_payments.items where order_id=$1', [terminal.order_id])).rows[0].accepted_snapshot;
    equal(terminalAccepted.participant.nombre, 'Terminal accepted'); equal(terminalAccepted.consent.channel, 'terminal');
    await rpc(manager.client, 'actv_set_registration_policy', { ...policy, p_notice_version: 'notice-synthetic-v2',
      p_notice_text: 'Different synthetic text under the same displayed document version.' });
    await denied(admin, 'actv_create_order', { ...guestInput, p_request_id: randomUUID() }, '22023');
    await denied(cashier.client, 'actv_create_staff_order', input(await athlete('Stale document'), 'cash', updatedConsent), '22023');
    await db.query('update actv_payments.staff set active=false where user_id=$1', [cashier.id]);
    await denied(cashier.client, 'actv_registration_record', recordInput);
    await db.query('delete from actv_payments.members where organizer_id=$1 and user_id=$2', [organizerRecord.organizer_id, organizer.id]);
    await denied(organizer.client, 'actv_registration_record', recordInput);
    await db.query('update actv_payments.staff set active=false where user_id=$1', [manager.id]);
    await denied(manager.client, 'actv_correct_registration', { ...corrections, p_expected_revision: 2, p_request_id: randomUUID() });
    equal((await db.query("select has_schema_privilege('authenticated','actv_payments','usage') as allowed")).rows[0].allowed, false);
    equal((await db.query('select count(*)::integer as n from actv_payments.registration_corrections where registration_id=$1', [registration])).rows[0].n, 2);
    return { assertions, allChannelAcceptedSnapshots: true, profileAndEventEditsIsolated: true,
      policyAndConsentEnforced: true, unknownLegacyConsent: true, managerAuditedCorrections: true,
      requestAndRevisionConcurrency: true, identityMoneyAndOwnershipPreserved: true, activeRevocation: true, productionQualified: false };
  } finally {
    if (ownedStaff.length) await db.query('delete from actv_payments.staff where user_id=any($1::uuid[])', [ownedStaff]);
  }
}
