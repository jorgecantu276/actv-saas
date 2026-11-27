import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export async function verifyReceiptContracts(context, retained) {
  const { db, apiUrl, anonKey, serviceKey } = context;
  assert(['127.0.0.1', 'localhost'].includes(new URL(apiUrl).hostname));
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(apiUrl, serviceKey, options);
  const users = [];
  let assertions = 0;
  const eq = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
  const rpc = async (client, name, args = {}) => {
    const result = await client.rpc(name, args);
    assert.equal(result.error, null, `Authorized ${name} must succeed`);
    assertions++;
    return result.data;
  };
  const deny = async (client, args, code = '42501') => {
    const { error } = await client.rpc('actv_sale_receipt', args);
    assert(error, 'Receipt access must fail');
    eq(error.code, code);
  };
  const identity = async label => {
    const email = `receipt-${label}-${randomUUID()}@example.invalid`, password = 'Synthetic-only-Aa1!-' + randomUUID();
    const result = await admin.auth.admin.createUser({ email, password, email_confirm: true,
      app_metadata: { actv_staff_identity: true }, user_metadata: { nombre_completo: label } });
    assert.equal(result.error, null);
    const client = createClient(apiUrl, anonKey, options);
    assert.equal((await client.auth.signInWithPassword({ email, password })).error, null);
    const user = { id: result.data.user.id, client };
    users.push(user.id);
    return user;
  };
  try {
    const manager = await identity('manager'), cashier = await identity('cashier'), unrelated = await identity('unrelated');
    await db.query("insert into actv_payments.staff(user_id,role,all_events) values($1,'manager',true)", [manager.id]);
    const access = (who, events, active = true) => ({ p_user: who.id, p_name: 'Synthetic receipt staff',
      p_phone: '8685550100', p_role: 'Cajero', p_events: events, p_active: active });
    await rpc(manager.client, 'actv_set_staff_access', access(cashier, [retained.race]));
    await rpc(manager.client, 'actv_set_staff_access', access(unrelated, [retained.otherRace]));
    const historical = await rpc(cashier.client, 'actv_sale_receipt', { p_registration_id: retained.registration });
    eq(historical.receipt_id, retained.registration);
    eq(historical.payment_status, 'payment_unverified');
    eq(historical.amount_minor, null);
    eq(String(historical.recorded_amount), '700');
    eq(historical.participants.map(row => row.folio), ['00042']);
    eq(historical.order_id, null);
    eq((await rpc(cashier.client, 'actv_sale_receipt', { p_event_id: retained.race, p_folio: '00042' })), historical);
    await deny(unrelated.client, { p_registration_id: retained.registration });
    await deny(createClient(apiUrl, anonKey, options), { p_registration_id: retained.registration });
    await deny(cashier.client, { p_folio: '00042' }, '22023');
    await deny(cashier.client, { p_event_id: retained.otherRace, p_folio: '00042' });

    const race = randomUUID(), athlete1 = randomUUID(), athlete2 = randomUUID();
    await db.query(`insert into public.eventos(id,nombre_carrera,fecha,organizador,distancia,precio_1,nombre_precio_1,precio_2,nombre_precio_2,cupo_maximo)
      values($1,'Synthetic receipt group',current_date+7,'ACTV','5K',500,'Standard',700,'Premium',20)`, [race]);
    await db.query(`insert into actv_payments.events(event_id,organizer_id) values($1,'00000000-0000-4000-8000-000000000ac7')`, [race]);
    await db.query(`insert into public.atletas(id,nombre,apellido,telefono,telefono_emergencia,talla_playera)
      values($1,'Synthetic','One','8685550100','8685550101','M'),($2,'Synthetic','Two','8685550102','8685550103','L')`, [athlete1, athlete2]);
    await rpc(manager.client, 'actv_set_staff_access', access(cashier, [retained.race, race]));
    const order = await rpc(cashier.client, 'actv_create_staff_order', { p_event_id: race, p_request_id: randomUUID(),
      p_channel: 'cash', p_items: [{ athlete_id: athlete1, package: 1 }, { athlete_id: athlete2, package: 2 }], p_relay: false });
    await deny(cashier.client, { p_order_id: order.order_id });
    const shift = await rpc(cashier.client, 'actv_open_shift', { p_opening: 0 });
    const issued = await rpc(cashier.client, 'actv_confirm_cash', { p_order_id: order.order_id, p_shift_id: shift.id, p_received: 120000 });
    eq(issued.state, 'issued');
    const receipt = await rpc(cashier.client, 'actv_sale_receipt', { p_order_id: order.order_id });
    eq(receipt.payment_status, 'confirmed');
    eq(receipt.amount_minor, 120000);
    eq(receipt.channel, 'cash');
    eq(receipt.cashier_id, cashier.id);
    eq(receipt.participants.map(row => row.package), ['Standard', 'Premium']);
    eq(receipt.participants.map(row => row.amount_minor), [50000, 70000]);
    eq(receipt.participants.map(row => row.registration_id), issued.registrations.map(row => row.id));
    eq(receipt.participants.map(row => row.athlete_id), [athlete1, athlete2]);
    const before = (await db.query('select count(*)::int as n from public.inscripciones where evento_id=$1', [race])).rows[0].n;
    for (const row of receipt.participants) {
      eq(await rpc(cashier.client, 'actv_sale_receipt', { p_registration_id: row.registration_id }), receipt);
      eq(await rpc(cashier.client, 'actv_sale_receipt', { p_event_id: race, p_folio: row.folio }), receipt);
    }
    eq((await db.query('select count(*)::int as n from public.inscripciones where evento_id=$1', [race])).rows[0].n, before);
    await deny(unrelated.client, { p_order_id: order.order_id });
    await rpc(manager.client, 'actv_set_staff_access', access(cashier, [retained.otherRace]));
    await deny(cashier.client, { p_order_id: order.order_id });
    await rpc(manager.client, 'actv_set_staff_access', access(cashier, [race], false));
    await deny(cashier.client, { p_order_id: order.order_id });
    await db.query("update actv_payments.orders set state='review' where id=$1", [order.order_id]);
    const adjusted=await rpc(manager.client,'actv_sale_receipt',{p_order_id:order.order_id});
    eq(adjusted.payment_status,'adjusted');eq(adjusted.amount_minor,receipt.amount_minor);
    eq(adjusted.participants.map(row=>row.folio),receipt.participants.map(row=>row.folio));
    eq((await db.query('select count(*)::int as n from actv_payments.captures where order_id=$1', [order.order_id])).rows[0].n, 1);
    return { assertions, actualAuthAndPostgrest: true, authoritativeWholeOrder: true,
      eventScopedFolioLookup: true, sameIdentityReprint: true, unknownLegacyPaymentPreserved: true,
      revokedAndUnassignedDenied: true, physicalPrintQualified: false, productionQualified: false };
  } finally {
    // Only test-owned authorization is removed; Auth/payment audit identities remain.
    await db.query('delete from actv_payments.staff where user_id=any($1::uuid[])', [users]);
  }
}
