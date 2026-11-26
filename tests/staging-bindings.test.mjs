import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { ensureOwnedLoopbackBindings } from '../scripts/staging-bindings.mjs';

const projectId = 'synthetic-owned-project';
const contextDirectory = resolve('synthetic-owned-context');
const networkName = 'synthetic-owned-network';
function container() {
  return { Config: { Labels: { 'com.supabase.cli.project': projectId,
    'com.docker.compose.project': projectId, 'com.supabase.cli.workdir': contextDirectory } },
  NetworkSettings: { Networks: { [networkName]: {} }, Ports: { '5432/tcp': [{ HostIp: '127.0.0.1' }] } } };
}

test('foreign project, context or network is rejected before any Docker call', async () => {
  for (const change of [
    value => { value.Config.Labels['com.supabase.cli.project'] = 'foreign'; },
    value => { value.Config.Labels['com.docker.compose.project'] = 'foreign'; },
    value => { value.Config.Labels['com.supabase.cli.workdir'] = resolve('foreign-context'); },
    value => { value.NetworkSettings.Networks = { foreign: {} }; },
    value => { value.NetworkSettings.Networks.foreign = {}; },
  ]) {
    const value = container(); change(value);
    let contactedEngine = false;
    await assert.rejects(ensureOwnedLoopbackBindings({ inspections: [value], projectId, contextDirectory, networkName,
      sync: () => { contactedEngine = true; throw Error('Unexpected engine call'); } }));
    assert.equal(contactedEngine, false);
  }
});

test('already isolated owned services need no container recreation', async () => {
  const result = await ensureOwnedLoopbackBindings({ inspections: [container()], projectId, contextDirectory, networkName,
    sync: () => { throw Error('No engine mutation is needed'); } });
  assert.equal(result.explicitRebinding, false);
});
