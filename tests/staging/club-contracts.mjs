import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export async function verifyClubContracts(context) {
  const { db, apiUrl, anonKey, serviceKey } = context;
  assert(['127.0.0.1', 'localhost'].includes(new URL(apiUrl).hostname));
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(apiUrl, serviceKey, options);
  const anon = createClient(apiUrl, anonKey, options);
  const staffIds = [];
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
    assert(error, `Expected explicit denial of ${name}`); equal(error.code, code);
  };
  const identity = async role => {
    const email = `club-${randomUUID()}@example.invalid`, password = 'Synthetic-only-Aa1!-' + randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    equal(created.error, null);
    const id = created.data.user.id;
    if (role) { await db.query('insert into actv_payments.staff(user_id,role,all_events) values($1,$2,false)', [id, role]); staffIds.push(id); }
    const client = createClient(apiUrl, anonKey, options);
    equal((await client.auth.signInWithPassword({ email, password })).error, null);
    return { id, client };
  };
  try {
    const staff = await identity('cashier'), organizer = await identity();
    await rpc(organizer.client, 'actv_organizer_signup', { p_name: 'Synthetic club organizer' });
    await denied(anon, 'actv_operations_clubs');
    await denied(organizer.client, 'actv_operations_clubs');
    const prefix = 'Synthetic-club-' + randomUUID();
    const fields = { nombre: prefix + '-A_%', responsable1: 'Synthetic primary', telefono1: '8685550100',
      responsable2: 'Synthetic secondary', telefono2: '8685550101', logo_url: 'https://example.invalid/logo.png',
      facebook_url: 'https://example.invalid/facebook', instagram_url: 'https://example.invalid/instagram', web_url: 'https://example.invalid' };
    await denied(organizer.client, 'actv_save_club', { p_club_id: null, p_fields: fields });
    await denied(staff.client, 'actv_save_club', { p_club_id: null, p_fields: { ...fields, logo_url: 'javascript:alert(1)' } }, '22023');
    await denied(staff.client, 'actv_save_club', { p_club_id: null, p_fields: { ...fields, role: 'manager' } }, '22023');
    const club = await rpc(staff.client, 'actv_save_club', { p_club_id: null, p_fields: fields });
    const other = await rpc(staff.client, 'actv_save_club', { p_club_id: null, p_fields: { ...fields, nombre: prefix + '-Z' } });
    equal(club.logo_url, fields.logo_url); equal(club.facebook_url, fields.facebook_url);
    equal(club.instagram_url, fields.instagram_url); equal(club.web_url, fields.web_url);
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (let index = 0; index < ids.length; index++) {
      await db.query(`insert into public.atletas(id,nombre,apellido,telefono,telefono_emergencia,talla_playera,club,genero)
        values($1,$2,'Club member','8685550100','8685550101','M',$3,'Sin dato')`, [ids[index], `Synthetic member ${index}`, fields.nombre]);
    }
    const first = await rpc(staff.client, 'actv_operations_clubs', { p_query: prefix, p_offset: 0, p_limit: 1, p_sort: 'az' });
    equal(first.total, 2); equal(first.rows.length, 1); equal(first.rows[0].id, club.id); equal(first.rows[0].total_atletas, 3);
    const second = await rpc(staff.client, 'actv_operations_clubs', { p_query: prefix, p_offset: 1, p_limit: 1, p_sort: 'az' });
    equal(second.rows.length, 1); equal(second.rows[0].id, other.id);
    equal((await rpc(staff.client, 'actv_operations_clubs', { p_query: prefix, p_sort: 'mayor' })).rows[0].id, club.id);
    equal((await rpc(staff.client, 'actv_operations_clubs', { p_query: prefix, p_sort: 'menor' })).rows[0].id, other.id);
    equal((await rpc(staff.client, 'actv_operations_clubs', { p_query: '_%' })).rows.filter(row => row.id === club.id).length, 1);
    for (const input of [{ p_limit: 101 }, { p_limit: 0 }, { p_offset: -1 }, { p_query: 'x'.repeat(121) }, { p_sort: 'unsafe' }]) {
      await denied(staff.client, 'actv_operations_clubs', input, '22023');
    }
    const members = await rpc(staff.client, 'actv_operations_club_members', { p_club_id: club.id, p_offset: 0, p_limit: 2 });
    equal(members.total, 3); equal(members.rows.map(row => row.id), ids.slice(0, 2));
    equal((await rpc(staff.client, 'actv_operations_club_members', { p_club_id: club.id, p_offset: 2, p_limit: 2 })).rows.map(row => row.id), ids.slice(2));
    equal((await rpc(staff.client, 'actv_operations_club_members', { p_club_id: club.id, p_query: 'member 1' })).total, 1);
    equal((await rpc(staff.client, 'actv_operations_club_members', { p_club_id: club.id, p_query: '%' })).total, 0);
    await denied(organizer.client, 'actv_operations_club_members', { p_club_id: club.id });
    await denied(staff.client, 'actv_operations_club_members', { p_club_id: club.id, p_limit: 101 }, '22023');
    await denied(staff.client, 'actv_operations_club_members', { p_club_id: club.id, p_offset: -1 }, '22023');
    // An actual accepted registration must keep the club from its snapshot even
    // when the mutable athlete profile and directory are edited afterwards.
    const race = randomUUID();
    await db.query(`insert into public.eventos(id,nombre_carrera,fecha,organizador,distancia,precio_1,nombre_precio_1,cupo_maximo,folio_inicial)
      values($1,'Synthetic club continuity',current_date+7,'ACTV','5K',500,'General',10,1)`, [race]);
    await db.query('insert into actv_payments.staff_events(user_id,event_id) values($1,$2)', [staff.id, race]);
    const order = await rpc(staff.client, 'actv_create_staff_order', { p_event_id: race, p_request_id: randomUUID(), p_channel: 'cash',
      p_items: [{ athlete_id: ids[0], package: 1 }], p_relay: false });
    const shift = await rpc(staff.client, 'actv_open_shift', { p_opening: 0 });
    const issued = await rpc(staff.client, 'actv_confirm_cash', { p_order_id: order.order_id, p_shift_id: shift.id, p_received: 50000 });
    equal(issued.state, 'issued');
    const registration = issued.registrations[0].id;
    const before = await rpc(staff.client, 'actv_registration_record', { p_registration_id: registration });
    equal(before.original.participant.club, fields.nombre);
    const renamed = await rpc(staff.client, 'actv_save_club', { p_club_id: club.id,
      p_fields: { ...fields, nombre: prefix + '-Renamed', responsable1: 'Updated primary' } });
    equal(renamed.responsable1, 'Updated primary');
    equal((await rpc(staff.client, 'actv_operations_club_members', { p_club_id: club.id })).total, 0);
    equal((await db.query('select club from public.atletas where id=$1', [ids[0]])).rows[0].club, fields.nombre);
    await db.query('update public.atletas set club=$2 where id=$1', [ids[0], renamed.nombre]);
    const after = await rpc(staff.client, 'actv_registration_record', { p_registration_id: registration });
    equal(after.original, before.original); equal(after.effective, before.effective);
    equal((await rpc(staff.client, 'actv_operations_club_members', { p_club_id: club.id })).total, 1);
    await denied(organizer.client, 'actv_delete_club', { p_club_id: club.id });
    equal(await rpc(staff.client, 'actv_delete_club', { p_club_id: other.id }), true);
    const audit = (await db.query('select action,actor,before_state,after_state from actv_payments.club_changes where club_id=$1 order by id', [club.id])).rows;
    equal(audit.map(row => row.action), ['INSERT', 'UPDATE']); equal(audit[1].actor, staff.id);
    equal(audit[1].before_state.nombre, fields.nombre); equal(audit[1].after_state.nombre, renamed.nombre);
    await assert.rejects(db.query("update actv_payments.club_changes set action='DELETE' where club_id=$1", [club.id]), { code: '42501' }); assertions++;
    await db.query('update actv_payments.staff set active=false where user_id=$1', [staff.id]);
    await denied(staff.client, 'actv_operations_clubs');
    await denied(staff.client, 'actv_operations_club_members', { p_club_id: club.id });
    await denied(staff.client, 'actv_save_club', { p_club_id: club.id, p_fields: fields });
    await denied(staff.client, 'actv_delete_club', { p_club_id: club.id });
    equal((await db.query('select count(*)::integer as n from public.inscripciones where id=$1', [registration])).rows[0].n, 1);
    check((await db.query('select 1 from public.clubes where id=$1', [club.id])).rowCount === 1);
    return { assertions, boundedDirectoryAndMembers: true, serverAggregateCounts: true, literalSearch: true,
      staffOnlyGlobalDirectory: true, activeRevocation: true, auditedClubChanges: true,
      acceptedRegistrationClubPreserved: true, productionQualified: false };
  } finally {
    if (staffIds.length) await db.query('delete from actv_payments.staff where user_id=any($1::uuid[])', [staffIds]);
  }
}
