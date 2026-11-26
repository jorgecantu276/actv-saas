import test from 'node:test';
import assert from 'node:assert/strict';
import { runnerHistory } from '../app/mi-actv/runner-history.ts';

const registration = (values) => ({event_id: 'race-1', event_name: 'Carrera ACTV', event_date: '2026-11-15', folio: '001', attended: false, personal: false, achievement_slug: null, ...values});

test('a purchase and a companion attendance do not earn personal milestones', () => {
  const history = runnerHistory([
    registration({personal: true}),
    registration({event_id: 'race-2', attended: true}),
  ], '2026-11-21');
  assert.equal(history.count, 0);
  assert.equal(history.otherPast.length, 2);
  assert.equal(history.nextMilestone.count, 1);
});

test('confirmed personal attendance counts each race once', () => {
  const history = runnerHistory([
    registration({personal: true, attended: true}),
    registration({personal: true, attended: true, folio: '002'}),
    registration({event_id: 'race-2', event_date: '2026-11-21', personal: true, attended: true}),
    registration({event_id: 'race-3', event_date: '2026-12-01', personal: true}),
  ], '2026-11-21');
  assert.equal(history.count, 2);
  assert.deepEqual(history.attended.map((race) => race.event_id), ['race-2', 'race-1']);
  assert.deepEqual(history.upcoming.map((race) => race.event_id), ['race-3']);
  assert.equal(history.nextMilestone.count, 3);
});

test('empty and completed passports have truthful milestone states', () => {
  assert.equal(runnerHistory([], '2026-11-21').count, 0);
  const races = Array.from({length: 10}, (_, index) => registration({event_id: String(index), personal: true, attended: true}));
  const history = runnerHistory(races, '2026-11-21');
  assert.equal(history.count, 10);
  assert.equal(history.nextMilestone, null);
});
