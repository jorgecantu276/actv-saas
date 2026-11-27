// Run after staging-payments.mjs in the same disposable PostgreSQL fixture.
// This checks actual portal RPC permissions, not full production-schema parity.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const address = new URL(process.env.ACTV_STAGING_DB ?? 'postgresql://postgres@127.0.0.1:55432/actv_payment_staging');
if (!['127.0.0.1', 'localhost'].includes(address.hostname) || address.pathname !== '/actv_payment_staging') {
  throw new Error('Portal contracts require an isolated local actv_payment_staging database.');
}
const db = new pg.Pool({ connectionString: address.href, max: 4 });
const suffix = randomUUID().replaceAll('-', '');
const owner = randomUUID();
const outsider = randomUUID();
const runner = randomUUID();
const unverified = randomUUID();
const email = `runner-${suffix}@example.invalid`;
let assertions = 0;

async function rpc(name, parameters, actor) {
  const client = await db.connect();
  try {
    await client.query('begin');
    if (actor === 'service_role' || actor === 'anon') {
      await client.query(`set local role ${actor}`);
    } else {
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [actor]);
    }
    // Function names are literals in this file, never supplied externally.
    const placeholders = parameters.map((_, index) => '$' + (index + 1)).join(',');
    const result = (await client.query(`select public.${name}(${placeholders}) as value`, parameters)).rows[0].value;
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function denied(name, parameters, actor, code = '42501') {
  await assert.rejects(rpc(name, parameters, actor), { code });
  assertions++;
}

try {
  assert.equal((await db.query('select current_database() as name')).rows[0].name, 'actv_payment_staging');
  await db.query(`insert into auth.users(id,email,email_confirmed_at) values
    ($1,$2,now()), ($3,$4,now()), ($5,$6,now()), ($7,$6,null)`,
  [owner, `organizer-${suffix}@example.invalid`, outsider, `outsider-${suffix}@example.invalid`, runner, email, unverified]);

  await denied('actv_organizer_signup', ['Unverified organizer'], unverified);
  await denied('actv_runner_dashboard', [], 'anon');
  const organizer = await rpc('actv_organizer_signup', ['Synthetic portal organizer'], owner);
  assert.deepEqual(await rpc('actv_organizer_signup', ['Synthetic portal organizer'], owner), organizer);
  assert.equal(await rpc('actv_is_payment_staff', [], owner), false);
  assertions += 2;

  const day = (await db.query("select ((now() at time zone 'America/Matamoros')::date+1)::text as day")).rows[0].day;
  const raceInput = [randomUUID(), { name: 'Synthetic portal race', date: day, slug: 'portal-' + suffix,
    price: 500, package_name: 'Individual', capacity: 10, distance: '5K', description: '',
    live_mode: false, online_enabled: false, folio_start: 1 }];
  const race = await rpc('actv_operations_save_event', raceInput, owner);
  await denied('actv_create_organizer_event', ['Retired implicit-mode writer', day, 'retired-' + suffix, 50000, 10, '5K'], owner);
  await denied('actv_operations_save_event', [randomUUID(), { ...raceInput[1], slug: 'unverified-new-' + suffix }], unverified);
  const detail = await rpc('actv_organizer_event_detail', [race.event_id], owner);
  assert.equal(detail.event_id, race.event_id);
  assert.equal(detail.distance, '5K');
  assert.equal(detail.capacity, 10);
  assert.equal((await rpc('actv_organizer_events', [], owner)).events.some(event => event.event_id === race.event_id), true);
  assert.deepEqual((await rpc('actv_organizer_events', [], outsider)).events, []);
  assertions += 5;
  await denied('actv_organizer_event_detail', [race.event_id], outsider);
  await denied('actv_organizer_event_detail', [race.event_id], 'anon');
  await denied('actv_organizer_attendance', [race.event_id], outsider);
  await denied('actv_create_organizer_event', ['Unverified race', day, 'unverified-' + suffix, 50000, 10, '5K'], unverified);

  const account = 'acct_portal' + suffix;
  await db.query('insert into actv_payments.accounts(organizer_id,live_mode,account_id,ready) values($1,false,$2,true)', [organizer.organizer_id, account]);
  await db.query('update actv_payments.events set online_enabled=true where event_id=$1', [race.event_id]);
  const participant = { nombre: 'Synthetic', apellido: 'Runner', telefono: '8685550100', telefono_emergencia: '8685550101', talla_playera: 'M', package: 1 };
  const order = await rpc('actv_create_order', [race.event_id, randomUUID(), 'online', JSON.stringify([
    participant, { ...participant, nombre: 'Companion' },
  ]), null, false, email.toUpperCase(), false], 'service_role');
  await rpc('actv_attach_provider', [order.order_id, account, false, 'cs_portal' + suffix, 'pi_portal' + suffix], 'service_role');
  await rpc('actv_confirm_stripe', [order.order_id, account, false, 'pi_portal' + suffix, 100000, 'mxn', 'cs_portal' + suffix, 'ch_portal' + suffix], 'service_role');

  const bought = await rpc('actv_runner_dashboard', [], runner);
  assert.equal(bought.registrations.length, 2);
  assert.equal(bought.attended_count, 0);
  assert.equal(bought.registrations.every(entry => !entry.personal && !entry.attended), true);
  assert.equal(bought.registrations.every(entry => !('registration_id' in entry)), true);
  assert.deepEqual((await rpc('actv_runner_dashboard', [], outsider)).registrations, []);
  assert.deepEqual((await rpc('actv_runner_dashboard', [], unverified)).registrations, []);
  assertions += 6;

  const folio = bought.registrations[0].folio;
  await denied('actv_claim_runner_folio', [race.event_id, folio], unverified);
  await denied('actv_claim_runner_folio', [race.event_id, folio], outsider);
  await denied('actv_claim_runner_folio', [race.event_id, folio], runner);
  const roster = await rpc('actv_organizer_attendance', [race.event_id], owner);
  const registration = roster.registrations.find(entry => entry.folio === folio).registration_id;
  const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
  await rpc('actv_create_participant_invitation', [registration,email,randomUUID(),token,'Verified purchase contact for synthetic runner','buyer_contact'],runner);
  assert.equal((await rpc('actv_accept_participant_invitation',[token],runner)).registration_id,registration);
  assert.equal((await rpc('actv_accept_participant_invitation',[token],runner)).registration_id,registration);
  assertions += 2;
  await denied('actv_record_attendance', [race.event_id, registration], outsider);
  await denied('actv_record_attendance', [race.event_id, registration], owner, 'P0002');
  assert.equal((await rpc('actv_runner_dashboard', [], runner)).attended_count, 0);
  assertions++;

  // Simulate the actual event day without changing the machine clock.
  await db.query("update public.eventos set fecha=(now() at time zone 'America/Matamoros')::date where id=$1", [race.event_id]);
  assert.equal(await rpc('actv_record_attendance', [race.event_id, registration], owner), true);
  assert.equal(await rpc('actv_record_attendance', [race.event_id, registration], owner), true);
  const attended = await rpc('actv_runner_dashboard', [], runner);
  assert.equal(attended.attended_count, 1);
  assert.equal(attended.registrations.filter(entry => entry.personal && entry.attended).length, 1);
  assert.equal((await db.query('select count(*)::int as count from actv_payments.attendance where registration_id=$1', [registration])).rows[0].count, 1);
  assert.deepEqual((await rpc('actv_runner_dashboard', [], outsider)).registrations, []);
  assertions += 6;

  const otherRace = await rpc('actv_operations_save_event', [randomUUID(), {
    ...raceInput[1], name: 'Other synthetic race', slug: 'other-' + suffix, distance: '10K',
  }], owner);
  await denied('actv_record_attendance', [otherRace.event_id, registration], owner, 'P0002');
  await db.query('delete from actv_payments.members where organizer_id=$1 and user_id=$2', [organizer.organizer_id, owner]);
  await denied('actv_organizer_event_detail', [race.event_id], owner);
  await denied('actv_organizer_attendance', [race.event_id], owner);
  await denied('actv_record_attendance', [race.event_id, registration], owner);

  console.log(JSON.stringify({ profile: 'Disposable local PostgreSQL portal contracts', assertions,
    checks: ['verified signup', 'organizer event isolation', 'runner ownership and privacy', 'attendance date and registration binding', 'idempotence', 'revocation'],
    fullProductionSchemaParity: false }, null, 2));
} finally {
  await db.end();
}
