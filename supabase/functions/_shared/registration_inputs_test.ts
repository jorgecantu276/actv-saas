import assert from 'node:assert/strict';
import { parseItems } from './orders.ts';

const participant = { nombre: 'Synthetic', apellido: 'Participant', telefono: '8685550100',
  telefono_emergencia: '8685550101', talla_playera: 'M', package: 1 };
Deno.test('checkout retains registration choices and exact consent revision without accepting client document text', () => {
  const consent = { policy_revision: 4, notice_version: 'v1', notice_accepted: true,
    waiver_version: 'w2', waiver_accepted: false };
  const parsed = parseItems([{ ...participant, fecha_nacimiento: '2000-01-02', ciudad: 'Synthetic city',
    club: 'Synthetic club', consent: { ...consent, notice_text: 'Untrusted document replacement' } }], false);
  assert.deepEqual(parsed, [{ ...participant, fecha_nacimiento: '2000-01-02', ciudad: 'Synthetic city', club: 'Synthetic club', consent }]);
  assert.deepEqual(parseItems([{ athlete_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', package: 1, consent }], true),
    [{ athlete_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', package: 1, consent }]);
});
Deno.test('checkout rejects coercible or malformed consent instead of recording acceptance', () => {
  for (const consent of [null, [], 'yes', { notice_accepted: 'true' }, { waiver_accepted: 1 },
    { policy_revision: '4' }, { policy_revision: -1 }, { policy_revision: 1.5 }]) {
    assert.throws(() => parseItems([{ ...participant, consent }], false));
  }
});
