import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ciMetrics, readinessMetrics } from '../status.mjs';

const run = (id, sha, conclusion, created_at, workflow_id = 1) => ({ id, head_sha: sha, conclusion, created_at, workflow_id, status: 'completed', run_attempt: 1 });
test('old green source cannot qualify a different SHA or dirty source', () => {
  assert.equal(ciMetrics([run(1, 'old', 'success', '2026-11-20')], 'new', false).exactSource.observation, 'UNKNOWN_NO_EXACT_SHA_RUN_IN_SAMPLE');
  assert.equal(ciMetrics([run(1, 'old', 'success', '2026-11-20')], 'old', true).exactSource.observation, 'DIRTY_SOURCE_UNVERIFIED');
});
test('latest failure replaces older success; separate workflow remains visible', () => {
  const metrics = ciMetrics([run(1, 'sha', 'success', '2026-11-20'), run(2, 'sha', 'failure', '2026-11-21'), run(3, 'sha', 'success', '2026-11-21', 2)], 'sha', false);
  assert.deepEqual(metrics.exactSource.workflows.map(w => w.conclusion), ['failure', 'success']);
  assert.equal(metrics.exactSource.allRequiredChecksPassed, null);
});
test('latest rerun result wins', () => {
  const first = run(1, 'sha', 'success', '2026-11-20');
  assert.equal(ciMetrics([first, { ...first, run_attempt: 2, conclusion: 'failure' }], 'sha', false).exactSource.workflows[0].conclusion, 'failure');
});
test('readiness preserves unrun acceptance, missing owners and incomplete inventory', () => {
  const record = { readiness: 'NOT_QUALIFIED', capability_inventory_complete: false, named_owners: { engineering: null }, items: [{ id: 'G1', status: 'OPEN', acceptance: [{ id: 'G1-A', status: 'NOT_RUN', kind: 'physical' }] }] };
  const metrics = readinessMetrics(record);
  assert.equal(metrics.acceptance.byStatus.NOT_RUN, 1);
  assert.equal(metrics.owners.named, 0);
  assert.equal(metrics.productCompletionPercent, null);
  assert.throws(() => readinessMetrics({ ...record, items: [...record.items, record.items[0]] }), /duplicate/);
  record.items[0].acceptance[0].status = 'PASS';
  const progressed = readinessMetrics(record);
  assert.equal(progressed.acceptance.byStatus.PASS, 1);
  assert.equal(progressed.evidenceValidation, 'NOT_PERFORMED');
});
