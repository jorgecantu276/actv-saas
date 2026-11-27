import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export async function verifyLinkingContracts(context, retained) {
  const { db, apiUrl, anonKey, serviceKey } = context;
  assert(['localhost', '127.0.0.1'].includes(new URL(apiUrl).hostname));
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(apiUrl, serviceKey, options);
  const ownedStaff = [];
  let assertions = 0;
  const equal = (a, b) => { assert.deepEqual(a, b); assertions++; };
  const check = condition => { assert(condition); assertions++; };
  const rpc = async (client, name, input = {}) => {
    const { data, error } = await client.rpc(name, input);
    assert.equal(error, null, `${name}: ${error?.message}`); assertions++; return data;
  };
  const denied = async (client, name, input = {}, code = '42501') => {
    const { error } = await client.rpc(name, input); assert(error, `${name} must deny`); equal(error.code, code);
  };
  const identity = async role => {
    const email = `link-${randomUUID()}@example.invalid`, password = 'Synthetic-only-Aa1!-' + randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); equal(created.error, null);
    const id = created.data.user.id;
    if (role) { await db.query('insert into actv_payments.staff(user_id,role,all_events) values($1,$2,$3)', [id, role, role === 'manager']); ownedStaff.push(id); }
    const client = createClient(apiUrl, anonKey, options);
    equal((await client.auth.signInWithPassword({ email, password })).error, null);
    return { id, email, client };
  };
  const invitation = (registration, recipient, method = 'in_person') => ({ p_registration_id: registration,
    p_recipient_email: recipient.email, p_request_id: randomUUID(), p_token: randomBytes(32).toString('hex'),
    p_reason: 'Synthetic participant identity checked directly', p_verification_method: method });
  try {
    const manager = await identity('manager'), cashier = await identity('cashier');
    const recipient = await identity(), wrong = await identity(), buyer = await identity(), unconfirmed = await identity();
    // A formerly valid Auth session must not outlive server-side confirmation.
    await db.query('update auth.users set email_confirmed_at=null where id=$1', [unconfirmed.id]);
    const legacy = retained.linkingLegacyRegistration ?? retained.registration;
    const legacyRace = retained.linkingLegacyRace ?? retained.race;
    check(!(await db.query('select 1 from actv_payments.events where event_id=$1', [legacyRace])).rowCount);
    const original = (await db.query('select actv_eligible,actv_order_item_id,monto_pagado from public.inscripciones where id=$1', [legacy])).rows[0];
    equal(original.actv_eligible, null); equal(original.actv_order_item_id, null);
    await denied(wrong.client, 'actv_participant_link_status', { p_registration_id: legacy });
    const first = invitation(legacy, recipient);
    await denied(cashier.client, 'actv_create_participant_invitation', first);
    const created = await rpc(manager.client, 'actv_create_participant_invitation', first);
    await denied(unconfirmed.client, 'actv_accept_participant_invitation', { p_token: first.p_token });
    await denied(unconfirmed.client, 'actv_accept_my_participant_invitation', { p_request_id: first.p_request_id });
    await denied(unconfirmed.client, 'actv_my_participant_links');
    equal(created.state, 'pending'); equal(created.recipient_email, recipient.email);
    equal(await rpc(manager.client, 'actv_create_participant_invitation', first), created);
    await denied(manager.client, 'actv_create_participant_invitation', { ...first, p_token: randomBytes(32).toString('hex') }, '23514');
    const stored = (await db.query('select to_jsonb(v) as value from actv_payments.participant_invitations v where id=$1', [first.p_request_id])).rows[0].value;
    equal(stored.token_digest, createHash('sha256').update(first.p_token).digest('hex'));
    check(!JSON.stringify(stored).includes(first.p_token)); check(!JSON.stringify(created).includes(stored.token_digest));
    equal((await db.query('select online_enabled from actv_payments.events where event_id=$1', [legacyRace])).rows[0].online_enabled, false);
    equal((await db.query('select actv_eligible,actv_order_item_id,monto_pagado from public.inscripciones where id=$1', [legacy])).rows[0], original);
    const unpaid = retained.linkingUnpaidRegistration;
    // An explicitly revoked retained entry stays unusable even when a damaged
    // old handover reservation exists. The captured numeric schema separately
    // rejects a literal WP / Online placeholder during retained-state seeding.
    await db.query('update public.inscripciones set actv_eligible=false where id=$1', [unpaid]);
    await denied(manager.client, 'actv_create_participant_invitation', invitation(unpaid, recipient), '23514');
    await denied(admin, 'actv_kit_evidence', { p_operator: manager.id, p_registration: unpaid, p_request: randomUUID(), p_action: 'reserve' }, '23514');
    const reserved = randomUUID();
    // Explicit damaged retained fixture: a reservation predates the paid-folio
    // guard. Finalize must reject it before requiring an uploaded object.
    await db.query(`insert into actv_payments.kit_evidence(id,registration_id,event_id,object_path,actor_id,requested_at,state)
      values($1,$2,$3,$4,$5,now(),'reserved')`, [reserved, unpaid, legacyRace, `${legacyRace}/${unpaid}/${reserved}.jpg`, manager.id]);
    equal((await rpc(admin, 'actv_kit_evidence', { p_operator: manager.id, p_registration: unpaid, p_request: reserved, p_action: 'finalize' })).state, 'rejected');
    await denied(wrong.client, 'actv_accept_participant_invitation', { p_token: first.p_token }, 'P0002');
    await denied(wrong.client, 'actv_accept_my_participant_invitation', { p_request_id: first.p_request_id }, 'P0002');
    equal((await rpc(recipient.client, 'actv_my_participant_links')).incoming[0].id, first.p_request_id);
    equal((await rpc(wrong.client, 'actv_my_participant_links')).incoming.length, 0);
    const accepted = await Promise.all([rpc(recipient.client, 'actv_accept_participant_invitation', { p_token: first.p_token }),
      rpc(recipient.client, 'actv_accept_my_participant_invitation', { p_request_id: first.p_request_id })]);
    equal(accepted[0], accepted[1]); equal(accepted[0].state, 'linked');
    equal((await db.query('select user_id from actv_payments.runner_entries where registration_id=$1', [legacy])).rows[0].user_id, recipient.id);
    await denied(manager.client, 'actv_create_participant_invitation', invitation(legacy, wrong), '23514');
    await denied(manager.client, 'actv_revoke_participant_invitation', { p_request_id: first.p_request_id, p_reason: 'Synthetic revoked after linked' }, '23514');
    await denied(buyer.client, 'actv_claim_runner_folio', { p_event_id: legacyRace, p_folio: created.folio });

    const race = randomUUID();
    await db.query(`insert into public.eventos(id,nombre_carrera,fecha,organizador,distancia,precio_1,nombre_precio_1,cupo_maximo,folio_inicial)
      values($1,'Synthetic linking race',current_date+7,'ACTV','5K',500,'Package',100,1)`, [race]);
    const organizer = await rpc(buyer.client, 'actv_organizer_signup', { p_name: 'Synthetic linking organizer' });
    const account = 'acct_link' + randomUUID().replaceAll('-', '');
    await db.query('insert into actv_payments.events(event_id,organizer_id,online_enabled) values($1,$2,true)', [race, organizer.organizer_id]);
    await db.query('insert into actv_payments.accounts(organizer_id,live_mode,account_id,ready) values($1,false,$2,true)', [organizer.organizer_id, account]);
    await db.query('insert into actv_payments.staff_events(user_id,event_id) values($1,$2)', [cashier.id, race]);
    const policy = await rpc(manager.client, 'actv_set_registration_policy', { p_event_id: race, p_required_fields: [],
      p_notice_version: 'link-notice', p_notice_text: 'Synthetic participant privacy notice only.',
      p_waiver_version: 'link-waiver', p_waiver_text: 'Synthetic participation waiver only.' });
    const consent = { policy_revision: policy.revision, notice_version: 'link-notice', notice_accepted: true, waiver_version: 'link-waiver', waiver_accepted: true };
    const order = await rpc(admin, 'actv_create_order', { p_event_id: race, p_request_id: randomUUID(), p_channel: 'online', p_live_mode: false,
      p_buyer_email: buyer.email, p_items: [0, 1, 2, 3].map(n => ({ nombre: 'Synthetic ' + n, apellido: 'Link', telefono: '8685550100',
        telefono_emergencia: '8685550101', talla_playera: 'M', package: 1, consent })) });
    await rpc(admin, 'actv_attach_provider', { p_order_id: order.order_id, p_account_id: account, p_live_mode: false, p_session_id: 'cs_link', p_payment_id: 'pi_link' });
    const paid = await rpc(admin, 'actv_confirm_stripe', { p_order_id: order.order_id, p_account_id: account, p_live_mode: false,
      p_session_id: 'cs_link', p_payment_id: 'pi_link', p_charge_id: 'ch_link', p_amount: 200000, p_currency: 'mxn' });
    const registrations = paid.registrations.map(r => r.id);
    const input = invitation(registrations[0], wrong, 'buyer_contact');
    await denied(recipient.client, 'actv_create_participant_invitation', input);
    await rpc(buyer.client, 'actv_create_participant_invitation', input);
    await rpc(manager.client, 'actv_correct_registration', { p_registration_id: registrations[0], p_expected_revision: 0,
      p_request_id: randomUUID(), p_patch: { email: recipient.email }, p_reason: 'Synthetic corrected contact must not transfer invitation' });
    await denied(recipient.client, 'actv_accept_participant_invitation', { p_token: input.p_token }, 'P0002');
    equal((await rpc(wrong.client, 'actv_my_participant_links')).incoming[0].id, input.p_request_id);
    equal((await rpc(buyer.client, 'actv_my_participant_links')).registrations.filter(r => r.personal).length, 0);
    await denied(buyer.client, 'actv_accept_participant_invitation', { p_token: input.p_token }, 'P0002');
    await rpc(buyer.client, 'actv_revoke_participant_invitation', { p_request_id: input.p_request_id, p_reason: 'Synthetic recipient correction verified' });
    await denied(wrong.client, 'actv_accept_participant_invitation', { p_token: input.p_token }, 'P0002');
    const replacement = invitation(registrations[0], recipient, 'buyer_contact');
    await rpc(buyer.client, 'actv_create_participant_invitation', replacement);
    await db.query("update actv_payments.participant_invitations set expires_at=clock_timestamp()-interval '1 second' where id=$1", [replacement.p_request_id]);
    await denied(recipient.client, 'actv_accept_participant_invitation', { p_token: replacement.p_token }, 'P0002');
    const final = invitation(registrations[0], recipient, 'buyer_contact');
    await rpc(buyer.client, 'actv_create_participant_invitation', final);
    await rpc(recipient.client, 'actv_accept_participant_invitation', { p_token: final.p_token });
    const self = invitation(registrations[1], buyer, 'buyer_contact');
    await rpc(buyer.client, 'actv_create_participant_invitation', self);
    await rpc(buyer.client, 'actv_accept_my_participant_invitation', { p_request_id: self.p_request_id });
    const duplicate = invitation(registrations[2], buyer, 'buyer_contact');
    await rpc(buyer.client, 'actv_create_participant_invitation', duplicate);
    await denied(buyer.client, 'actv_accept_participant_invitation', { p_token: duplicate.p_token }, '23514');
    await denied(buyer.client, 'actv_my_participant_links', { p_offset: -1 }, '22023');
    check((await rpc(buyer.client, 'actv_my_participant_links', { p_limit: 1 })).registrations.length <= 1);
    const pending = invitation(registrations[3], wrong);
    await rpc(cashier.client, 'actv_create_participant_invitation', pending);
    await db.query('update actv_payments.staff set active=false where user_id=$1', [cashier.id]);
    await denied(cashier.client, 'actv_participant_link_status', { p_registration_id: registrations[3] });
    await denied(cashier.client, 'actv_revoke_participant_invitation', { p_request_id: pending.p_request_id, p_reason: 'Synthetic revoked cashier request' });
    await rpc(buyer.client, 'actv_revoke_participant_invitation', { p_request_id: duplicate.p_request_id, p_reason: 'Synthetic duplicate personal edition replaced' });
    const contender = invitation(registrations[2], wrong, 'buyer_contact');
    await rpc(buyer.client, 'actv_create_participant_invitation', contender);
    const raced = await Promise.all([contender, pending].map(v => wrong.client.rpc('actv_accept_participant_invitation', { p_token: v.p_token })));
    equal(raced.filter(v => !v.error).length, 1); equal(raced.filter(v => v.error?.code === '23514').length, 1);
    equal((await db.query('select count(*)::int n from actv_payments.runner_entries where event_id=$1 and user_id=$2', [race, wrong.id])).rows[0].n, 1);
    check((await db.query("select count(*)::integer n from actv_payments.participant_link_audit where action='linked'")).rows[0].n >= 3);
    return { assertions, verifiedRecipientRequired: true, buyerAndCompanionSeparated: true, singleUseAndIdempotent: true,
      concurrentAcceptance: true, eventUserRace: true, contactCorrectionDoesNotRetarget: true, revocationAndExpiry: true, unknownLegacyPaymentPreserved: true, privateBoundedInventory: true,
      oldClaimRetired: true, scopedStaffRevocation: true, productionQualified: false };
  } finally {
    if (ownedStaff.length) await db.query('delete from actv_payments.staff where user_id=any($1::uuid[])', [ownedStaff]);
  }
}
