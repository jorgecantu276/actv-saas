import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

export async function verifyEvidenceContracts(context, retained) {
  assert(['127.0.0.1', 'localhost'].includes(new URL(context.apiUrl).hostname));
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(context.apiUrl, context.serviceKey, options);
  const anon = createClient(context.apiUrl, context.anonKey, options);
  const { db } = context;
  let assertions = 0;
  const equal = (a, b) => { assert.deepEqual(a, b); assertions++; };
  const check = a => { assert(a); assertions++; };
  async function rpc(client, name, args = {}) {
    const result = await client.rpc(name, args); assert.equal(result.error, null, `${name}: ${result.error?.message}`);
    assertions++; return result.data;
  }
  async function user(role, event) {
    const password = 'Synthetic-only-Aa1!-' + randomUUID();
    const email = 'evidence-' + randomUUID() + '@example.invalid';
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(created.error, null);
    const id = created.data.user.id;
    await db.query(`insert into actv_payments.staff(user_id,role,all_events) values($1,$2,$3)`, [id, role, role === 'manager']);
    if (event) await db.query('insert into actv_payments.staff_events(user_id,event_id) values($1,$2)', [id, event]);
    const client = createClient(context.apiUrl, context.anonKey, options);
    assert.equal((await client.auth.signInWithPassword({ email, password })).error, null);
    return { id, client, token: (await client.auth.getSession()).data.session.access_token };
  }
  const manager = await user('manager'), staff = await user('cashier', retained.race), unrelated = await user('cashier', retained.otherRace);
  equal((await db.query("select has_schema_privilege('authenticated','actv_payments','usage') as allowed")).rows[0].allowed, false);
  equal((await db.query("select has_function_privilege('authenticated','public.actv_evidence_storage_access(text,boolean)','execute') as allowed")).rows[0].allowed, true);
  equal((await db.query("select bool_or(has_function_privilege('authenticated',p.oid,'execute')) as allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='actv_payments' and p.proname='create_order'")).rows[0].allowed, false);
  const op = (actor, registration, request, action) => rpc(admin, 'actv_kit_evidence', {
    p_operator: actor.id, p_registration: registration, p_request: request, p_action: action,
  });
  equal((await admin.storage.getBucket('evidencias_kits')).data.public, false);
  check(!(await fetch(retained.snapshot.foto_evidencia)).ok);
  check((await anon.storage.from('evidencias_kits').download(retained.objectPath)).error);
  check((await unrelated.client.storage.from('evidencias_kits').download(retained.objectPath)).error);
  check((await anon.storage.from('evidencias_kits').upload('anonymous.jpg', Buffer.from('denied'))).error);
  check((await staff.client.storage.from('evidencias_kits').upload('unbound.jpg', Buffer.from('denied'))).error);
  check((await anon.rpc('limpiar_evidencias_antiguas')).error);
  check((await staff.client.rpc('actv_evidence_adopt_legacy', { p_origin: context.apiUrl })).error);
  check((await manager.client.rpc('actv_evidence_adopt_legacy', { p_origin: 'https://foreign.example/anything' })).error);
  check(await rpc(manager.client, 'actv_evidence_adopt_legacy', { p_origin: new URL(context.apiUrl).origin }) >= 1);
  const legacy = await op(manager, retained.registration, null, 'view');
  equal(legacy.legacy, true); equal(legacy.actor, null); equal(legacy.committed_at, null);
  equal(Buffer.from(await (await staff.client.storage.from('evidencias_kits').download(legacy.path)).data.arrayBuffer()), retained.objectBytes);
  check((await unrelated.client.storage.from('evidencias_kits').download(legacy.path)).error);
  const registration = retained.evidenceRegistration;
  check(typeof registration === 'string');
  const request = randomUUID(), competitor = randomUUID();
  const reserved = await op(staff, registration, request, 'reserve');
  const losing = await op(staff, registration, competitor, 'reserve');
  equal(reserved.path, `${retained.race}/${registration}/${request}.jpg`);
  check((await staff.client.storage.from('evidencias_kits').upload(reserved.path, Buffer.from('not a photo'), { contentType: 'text/plain' })).error);
  // A real tiny synthetic JPEG; no participant data, URLs, or external downloads.
  const image = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAB//2Q==', 'base64');
  const photoUpload = await staff.client.storage.from('evidencias_kits').upload(reserved.path, image, { contentType: 'image/jpeg' });
  assert.equal(photoUpload.error, null, 'Scoped synthetic JPEG upload must succeed'); assertions++;
  const competingUpload = await staff.client.storage.from('evidencias_kits').upload(losing.path, image, { contentType: 'image/jpeg' });
  assert.equal(competingUpload.error, null, 'Competing reserved JPEG upload must succeed'); assertions++;
  const first = await op(staff, registration, request, 'finalize');
  equal(first.state, 'committed'); check(first.actor === staff.id && first.committed_at);
  // Simulated response loss: recover and replay the SAME durable request.
  equal((await op(staff, registration, request, 'status')).state, 'committed');
  equal(await op(staff, registration, request, 'finalize'), first);
  equal((await op(staff, registration, competitor, 'finalize')).state, 'rejected');
  equal((await staff.client.storage.from('evidencias_kits').download(reserved.path)).error, null);
  check((await unrelated.client.storage.from('evidencias_kits').download(reserved.path)).error);
  check((await staff.client.from('inscripciones').update({ foto_evidencia: null, kit_entregado: false }).eq('id', registration)).error);
  const beforeDelete = await staff.client.storage.from('evidencias_kits').remove([reserved.path]);
  // Storage may return an empty success for RLS-filtered deletes. The object must survive.
  check(beforeDelete.error || beforeDelete.data.length === 0);
  equal((await admin.storage.from('evidencias_kits').download(reserved.path)).error, null);
  const edge = (deniedToken, allowedToken) => JSON.parse(execFileSync(process.execPath,
    ['node_modules/deno/bin.cjs', 'run', '--allow-env', '--allow-net=' + new URL(context.apiUrl).host,
      '--config', 'supabase/functions/deno.json', 'tests/staging/evidence-edge.ts'], {
      cwd: new URL('../../', import.meta.url), encoding: 'utf8', windowsHide: true, timeout: 30000,
      env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(?:ACTV_|SUPABASE_|STRIPE_|NEXT_PUBLIC_)/.test(name))),
      input: JSON.stringify({ apiUrl: context.apiUrl, serviceKey: context.serviceKey, registration, request, deniedToken, allowedToken }),
      stdio: ['pipe', 'pipe', 'pipe'],
    }));
  equal(edge(unrelated.token, staff.token).authorizationAssertions, 7);
  await db.query('update actv_payments.staff set active=false where user_id=$1', [staff.id]);
  check((await staff.client.storage.from('evidencias_kits').download(reserved.path)).error);
  equal(edge(staff.token).authorizationAssertions, 6);
  check((await staff.client.storage.from('evidencias_kits').upload(reserved.path + '-revoked', image)).error);
  check((await staff.client.rpc('actv_evidence_policy', { p_days: 1 })).error);
  // Only the dated synthetic evidence is eligible. Unknown legacy dates stay unknown.
  await db.query("update actv_payments.kit_evidence set committed_at=now()-interval '3 days' where id=$1", [request]);
  equal(await rpc(admin, 'actv_evidence_claim_cleanup'), null);
  await rpc(manager.client, 'actv_evidence_policy', { p_days: 1 });
  await rpc(manager.client, 'actv_evidence_hold', { p_evidence: request, p_hold: true });
  equal(await rpc(admin, 'actv_evidence_claim_cleanup'), null);
  await rpc(manager.client, 'actv_evidence_hold', { p_evidence: request, p_hold: false });
  const claim = await rpc(admin, 'actv_evidence_claim_cleanup'); equal(claim.id, request);
  equal(await rpc(admin, 'actv_evidence_claim_cleanup'), null);
  check((await manager.client.rpc('actv_evidence_hold', { p_evidence: request, p_hold: true })).error);
  check((await manager.client.rpc('actv_evidence_policy', { p_days: null })).error);
  check((await admin.rpc('actv_evidence_finish_cleanup', { p_evidence: request, p_lease: claim.lease, p_error: null })).error);
  await rpc(admin, 'actv_evidence_finish_cleanup', { p_evidence: request, p_lease: claim.lease, p_error: 'synthetic_storage_api_failure' });
  const failed = await rpc(manager.client, 'actv_evidence_cleanup_status');
  equal(failed.queue[0].state, 'retry'); equal(failed.queue[0].last_error, 'synthetic_storage_api_failure');
  await db.query('update actv_payments.evidence_cleanup set available_at=now() where evidence_id=$1', [request]);
  const retry = await rpc(admin, 'actv_evidence_claim_cleanup'); check(retry.lease !== claim.lease);
  check((await admin.rpc('actv_evidence_finish_cleanup', { p_evidence: request, p_lease: claim.lease, p_error: null })).error);
  await db.query("update actv_payments.evidence_cleanup set leased_until=now()-interval '1 second' where evidence_id=$1", [request]);
  check((await admin.rpc('actv_evidence_finish_cleanup', { p_evidence: request, p_lease: retry.lease, p_error: 'late' })).error);
  const recovery = await rpc(admin, 'actv_evidence_claim_cleanup');
  // Storage actually commits, then the caller loses its acknowledgement.
  equal((await admin.storage.from('evidencias_kits').remove([recovery.path])).error, null);
  await rpc(admin, 'actv_evidence_finish_cleanup', { p_evidence: request, p_lease: recovery.lease, p_error: 'storage_delete_uncertain' });
  check((await manager.client.rpc('actv_evidence_hold', { p_evidence: request, p_hold: true })).error);
  check((await manager.client.rpc('actv_evidence_policy', { p_days: null })).error);
  equal((await rpc(manager.client, 'actv_evidence_cleanup_status')).queue[0].state, 'deleting');
  await db.query("update actv_payments.evidence_cleanup set leased_until=now()-interval '1 second',available_at=now() where evidence_id=$1", [request]);
  const reconciled = await rpc(admin, 'actv_evidence_claim_cleanup');
  equal((await admin.storage.from('evidencias_kits').remove([recovery.path])).error, null);
  await rpc(admin, 'actv_evidence_finish_cleanup', { p_evidence: request, p_lease: reconciled.lease, p_error: null });
  check((await manager.client.rpc('actv_evidence_hold', { p_evidence: request, p_hold: true })).error);
  equal((await db.query('select kit_entregado,foto_evidencia from public.inscripciones where id=$1', [registration])).rows[0], { kit_entregado: true, foto_evidencia: null });
  equal((await db.query('select state from actv_payments.kit_evidence where id=$1', [request])).rows[0].state, 'deleted');
  equal((await admin.storage.from('evidencias_kits').download(retained.objectPath)).error, null);
  // Exact legacy reference matching: '_' is a literal filename character,
  // never a SQL LIKE pattern that could erase a different, newer reference.
  const legacyPath = 'synthetic__' + randomUUID() + '.jpg';
  const referenceRegistration = retained.evidenceReferenceRegistration;
  check(typeof referenceRegistration === 'string');
  const referenceUpload = await admin.storage.from('evidencias_kits').upload(legacyPath, image, { contentType: 'image/jpeg' });
  assert.equal(referenceUpload.error, null, 'Synthetic legacy underscore JPEG upload must succeed'); assertions++;
  const originalReference = new URL(context.apiUrl).origin + '/storage/v1/object/public/evidencias_kits/' + legacyPath;
  // Percent-encoded/arbitrary legacy URLs are never guessed or fetched into a map.
  await db.query('update public.inscripciones set foto_evidencia=$1 where id=$2', [originalReference.replace('synthetic__', 'synthetic%25_'), referenceRegistration]);
  equal(await rpc(manager.client, 'actv_evidence_adopt_legacy', { p_origin: new URL(context.apiUrl).origin }), 0);
  await db.query('update public.inscripciones set foto_evidencia=$1 where id=$2', [originalReference, referenceRegistration]);
  await rpc(manager.client, 'actv_evidence_adopt_legacy', { p_origin: new URL(context.apiUrl).origin });
  const mapped = await op(manager, referenceRegistration, null, 'view');
  const changedReference = originalReference.replace('synthetic__', 'syntheticAX');
  await db.query('update public.inscripciones set foto_evidencia=$1 where id=$2', [changedReference, referenceRegistration]);
  // Fixture supplies an explicit known date; production adoption leaves it null.
  await db.query("update actv_payments.kit_evidence set committed_at=now()-interval '3 days' where id=$1", [mapped.id]);
  const exactClaim = await rpc(admin, 'actv_evidence_claim_cleanup'); equal(exactClaim.id, mapped.id);
  equal((await admin.storage.from('evidencias_kits').remove([exactClaim.path])).error, null);
  await rpc(admin, 'actv_evidence_finish_cleanup', { p_evidence: exactClaim.id, p_lease: exactClaim.lease, p_error: null });
  equal((await db.query('select foto_evidencia from public.inscripciones where id=$1', [referenceRegistration])).rows[0].foto_evidencia, changedReference);
  await db.query('update public.inscripciones set foto_evidencia=null where id=$1', [referenceRegistration]);
  await rpc(manager.client, 'actv_evidence_policy', { p_days: null });
  await db.query('update actv_payments.staff set active=false where user_id=any($1::uuid[])', [[manager.id, unrelated.id]]);
  return { assertions, privateBucket: true, authenticatedStorage: true, idempotentHandover: true,
    revokedTokenDenied: true, leasedStorageApiCleanup: true, legacyDatesUnknown: true };
}
