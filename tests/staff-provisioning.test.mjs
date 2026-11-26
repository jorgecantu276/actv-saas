import test from 'node:test';
import assert from 'node:assert/strict';
import { provisionStaff, validateStaffProfile, validateStaffPassword } from '../lib/staff-provisioning.ts';

const id = '99999999-1111-4111-8111-111111111111';
const input = { email: ' Staff@Example.invalid ', password: 'synthetic-password', rol: 'Cajero',
  nombre_completo: ' Personal ', telefono: '8685550100', eventos_asignados: [] };
function fixture() {
  const calls = [];
  return { calls, dependencies: {
    authorize: async () => { calls.push('authorize'); },
    createIdentity: async value => { calls.push(['create', value.email]); return id; },
    readIdentityEmail: async userId => { calls.push(['read', userId]); return 'staff@example.invalid'; },
    applyAccess: async userId => { calls.push(['apply', userId]); },
  } };
}

test('unauthorized or invalid requests never create an Auth identity', async () => {
  const f = fixture();
  f.dependencies.authorize = async () => { throw Error('denied'); };
  await assert.rejects(provisionStaff(input, f.dependencies), /denied/);
  assert.deepEqual(f.calls, []);
  const invalid = fixture();
  await assert.rejects(provisionStaff({ ...input, rol: 'invented' }, invalid.dependencies), /inválidos/);
  assert.deepEqual(invalid.calls, ['authorize']);
});

test('failed SQL activation retains a recoverable identity without reporting success', async () => {
  const f = fixture();
  f.dependencies.applyAccess = async () => { throw Error('transaction failed'); };
  const result = await provisionStaff(input, f.dependencies);
  assert.equal(result.success, false);
  assert.equal(result.pendingUserId, id);
  assert.equal(f.calls.filter(call => Array.isArray(call) && call[0] === 'create').length, 1);
});

test('same-identity retry validates email and does not create or replace Auth accounts', async () => {
  const f = fixture();
  assert.deepEqual(await provisionStaff(input, f.dependencies, id), { success: true });
  assert.deepEqual(f.calls, ['authorize', ['read', id], ['apply', id]]);
  const wrong = fixture();
  wrong.dependencies.readIdentityEmail = async () => 'different@example.invalid';
  await assert.rejects(provisionStaff(input, wrong.dependencies, id), /no corresponde/);
  assert.deepEqual(wrong.calls, ['authorize']);
});

test('a lost activation response recovers the original identity on retry', async () => {
  const f = fixture();
  const granted = new Set();
  let loseResponse = true;
  f.dependencies.applyAccess = async userId => {
    granted.add(userId);
    if (loseResponse) { loseResponse = false; throw Error('response lost after commit'); }
  };
  const first = await provisionStaff(input, f.dependencies);
  assert.equal(first.success, false);
  assert.deepEqual(await provisionStaff(input, f.dependencies, first.pendingUserId), { success: true });
  assert.equal(granted.size, 1);
  assert.equal(f.calls.filter(call => Array.isArray(call) && call[0] === 'create').length, 1);
});

test('assignments are normalized and global roles cannot carry individual scopes', () => {
  const event = '88888888-1111-4111-8111-111111111111';
  assert.deepEqual(validateStaffProfile({ ...input, eventos_asignados: [event, event] }).eventos_asignados, [event]);
  assert.throws(() => validateStaffProfile({ ...input, rol: 'Administrador', eventos_asignados: [event] }), /inválidos/);
});

test('staff password policy rejects six/seven characters before identity creation and accepts eight', async () => {
  for (const password of ['123456', '1234567']) {
    const f = fixture();
    await assert.rejects(provisionStaff({ ...input, password }, f.dependencies), /8 caracteres/);
    assert.deepEqual(f.calls, ['authorize']);
    assert.throws(() => validateStaffPassword(password), /8 caracteres/);
  }
  const f = fixture();
  assert.deepEqual(await provisionStaff({ ...input, password: '12345678' }, f.dependencies), { success: true });
  assert.equal(validateStaffPassword('12345678'), '12345678');
});
