// Docker Desktop can ignore a custom bridge's default host-binding option.
// Recreate only this run's published-port services with explicit loopback binds.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { resolve } from 'node:path';

export function assertLocalDockerEndpoint(sync, environment = process.env) {
  if (environment.DOCKER_HOST && !environment.DOCKER_HOST.startsWith('unix:///') &&
    !/^npipe:\/{4}\.\/pipe\//.test(environment.DOCKER_HOST)) throw Error('Full staging refuses a remote DOCKER_HOST');
  const host = JSON.parse(sync('docker', ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}']));
  if (host.startsWith('unix:///')) return host.slice('unix://'.length);
  if (/^npipe:\/{4}\.\/pipe\//.test(host)) {
    const slash = String.fromCharCode(92);
    return slash + slash + '.' + slash + 'pipe' + slash + host.split('/pipe/')[1];
  }
  throw Error('Full staging requires a local Docker Unix socket or named pipe');
}

function api(socketPath, method, path, body, accepted = [200, 201, 204, 304]) {
  const payload = body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body);
  return new Promise((done, fail) => {
    const request = http.request({ socketPath, method, path, agent: false,
      headers: { Host: 'docker', Connection: 'close', ...(payload ? { 'Content-Type': Buffer.isBuffer(body) ? 'application/x-tar' : 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, response => {
      let text = '';
      response.on('data', data => { text += data; });
      response.on('end', () => {
        // Response errors must never echo Config.Env or request payloads.
        if (!accepted.includes(response.statusCode)) return fail(Error(`Owned Docker ${method} operation failed (${response.statusCode})`));
        try { done(text ? JSON.parse(text) : null); } catch { fail(Error('Owned Docker response was not JSON')); }
      });
    });
    request.setTimeout(30000, () => request.destroy(Error('Owned Docker operation timed out')));
    request.once('error', () => fail(Error('Could not contact the local Docker engine')));
    if (payload) request.write(payload);
    request.end();
  });
}

function assertOwned(container, projectId, contextDirectory, networkName) {
  assert.equal(container.Config.Labels['com.supabase.cli.project'], projectId);
  assert.equal(container.Config.Labels['com.docker.compose.project'], projectId);
  assert.equal(resolve(container.Config.Labels['com.supabase.cli.workdir']), resolve(contextDirectory));
  assert(container.NetworkSettings.Networks[networkName]);
  assert.equal(Object.keys(container.NetworkSettings.Networks).length, 1);
}

function hasPublishedPorts(container) {
  return Object.values(container.HostConfig.PortBindings ?? {}).some(bindings => bindings?.length);
}

function preserveMounts(container, hostConfig) {
  const binds = hostConfig.Binds ?? [];
  hostConfig.Mounts ??= [];
  for (const mount of container.Mounts) {
    const escaped = mount.Destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const bound = binds.some(bind => new RegExp(':' + escaped + '(?::|$)').test(bind)) || hostConfig.Mounts.some(item => item.Target === mount.Destination);
    if (bound || mount.Type === 'tmpfs') continue;
    assert(['volume', 'bind'].includes(mount.Type));
    hostConfig.Mounts.push({ Type: mount.Type, Source: mount.Type === 'volume' ? mount.Name : mount.Source,
      Target: mount.Destination, ReadOnly: !mount.RW,
      ...(mount.Type === 'bind' && mount.Propagation ? { BindOptions: { Propagation: mount.Propagation } } : {}) });
  }
}

function privateCopy(args, environment, input) {
  try {
    return execFileSync('docker', ['cp', '-a', ...args], { env: environment, input,
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  } catch { throw Error('Owned Kong runtime configuration copy failed; no credential content emitted'); }
}

function fileIdentity(archive) {
  // Docker cp emits an uncompressed tar. Skip optional PAX headers and inspect
  // the sole regular file without writing its secret-bearing bytes to disk.
  const files = [];
  for (let offset = 0; offset + 512 <= archive.length; ) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start, end) => header.subarray(start, end).toString('utf8').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(field(124, 136) || '0', 8);
    assert(Number.isSafeInteger(size) && size >= 0);
    const type = header[156];
    if (type === 0 || type === 48) {
      files.push({ name: field(0, 100), mode: field(100, 108), uid: field(108, 116), gid: field(116, 124),
        sha256: createHash('sha256').update(archive.subarray(offset + 512, offset + 512 + size)).digest('hex') });
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(files.length, 1, 'Owned runtime archive must contain exactly one regular file');
  return JSON.stringify(files[0]);
}

export async function ensureOwnedLoopbackBindings({ inspections, projectId, contextDirectory, networkName, sync, environment }) {
  for (const container of inspections) assertOwned(container, projectId, contextDirectory, networkName);
  const alreadyLoopback = inspections.every(container => Object.values(container.NetworkSettings.Ports)
    .every(bindings => (bindings ?? []).every(binding => binding.HostIp === '127.0.0.1')));
  if (alreadyLoopback) return { explicitRebinding: false, inspections };

  const socketPath = assertLocalDockerEndpoint(sync);
  const version = await api(socketPath, 'GET', '/version');
  assert(/^\d+\.\d+$/.test(version.ApiVersion));
  const prefix = '/v' + version.ApiVersion;
  const inspect = id => api(socketPath, 'GET', `${prefix}/containers/${encodeURIComponent(id)}/json`);
  const network = await api(socketPath, 'GET', `${prefix}/networks/${encodeURIComponent(networkName)}`);
  assert.equal(network.Labels['codex.actv.full'], projectId);
  const expectedIds = new Set(inspections.map(container => container.Id));
  assert(Object.keys(network.Containers).every(id => expectedIds.has(id)), 'Owned network must not contain another project');

  // Freeze all six services before a published endpoint is recreated. Do not
  // remove volumes, edit their contents, or change the daemon/network defaults.
  for (const container of inspections) {
    assertOwned(await inspect(container.Id), projectId, contextDirectory, networkName);
    await api(socketPath, 'POST', `${prefix}/containers/${container.Id}/stop?t=10`);
  }
  const replacementIds = new Map();
  for (const container of inspections.filter(hasPublishedPorts)) {
    assertOwned(await inspect(container.Id), projectId, contextDirectory, networkName);
    let preservedKong;
    if (container.Name.startsWith('/supabase_kong_')) {
      const declarative = container.Config.Env.find(value => value.startsWith('KONG_DECLARATIVE_CONFIG='));
      assert.equal(declarative, 'KONG_DECLARATIVE_CONFIG=/home/kong/kong.yml');
      // Supabase writes these generated files after container creation. They
      // are not volumes. Archive mode preserves UID/GID/mode as well as bytes;
      // private archives remain in memory and are never logged or persisted.
      preservedKong = ['kong.yml', 'localhost.crt', 'localhost.key'].map(name => ({ name,
        archive: privateCopy([`${container.Id}:/home/kong/${name}`, '-'], environment) }));
    }
    const config = structuredClone(container.Config);
    config.Image = container.Image; // Pin the identical actual image, not a mutable tag.
    const hostConfig = structuredClone(container.HostConfig);
    for (const [port, bindings] of Object.entries(hostConfig.PortBindings)) {
      hostConfig.PortBindings[port] = (bindings ?? []).map(binding => ({ ...binding, HostIp: '127.0.0.1' }));
    }
    preserveMounts(container, hostConfig);
    const originalNetwork = container.NetworkSettings.Networks[networkName];
    const endpoints = { [networkName]: { Aliases: originalNetwork.Aliases, Links: originalNetwork.Links,
      ...(originalNetwork.DriverOpts ? { DriverOpts: originalNetwork.DriverOpts } : {}) } };
    await api(socketPath, 'DELETE', `${prefix}/containers/${container.Id}?v=false`);
    const replacement = await api(socketPath, 'POST', `${prefix}/containers/create?name=${encodeURIComponent(container.Name.slice(1))}`,
      { ...config, HostConfig: hostConfig, NetworkingConfig: { EndpointsConfig: endpoints } });
    assert(replacement.Id);
    if (preservedKong) {
      for (const file of preservedKong) {
        // Keep UID/GID from the source tar. Docker's CopyUIDGID=true option
        // instead rewrites ownership to the configured destination user.
        await api(socketPath, 'PUT', `${prefix}/containers/${replacement.Id}/archive?path=${encodeURIComponent('/home/kong')}&copyUIDGID=false`, file.archive);
        const restored = privateCopy([`${replacement.Id}:/home/kong/${file.name}`, '-'], environment);
        const before = JSON.parse(fileIdentity(file.archive)), after = JSON.parse(fileIdentity(restored));
        assert(before.name === after.name && before.sha256 === after.sha256, 'Owned runtime file bytes must survive rebinding');
        assert(Number.parseInt(before.mode, 8) === Number.parseInt(after.mode, 8), 'Owned runtime file mode must survive rebinding');
        assert(Number.parseInt(before.uid, 8) === Number.parseInt(after.uid, 8) &&
          Number.parseInt(before.gid, 8) === Number.parseInt(after.gid, 8), 'Owned runtime file ownership must survive rebinding');
      }
    }
    const created = await inspect(replacement.Id);
    assertOwned(created, projectId, contextDirectory, networkName);
    assert.equal(created.Image, container.Image);
    assert(created.Config.Env.length === container.Config.Env.length &&
      created.Config.Env.every((value, index) => value === container.Config.Env[index]), 'Owned service environment must be preserved exactly');
    for (const mount of container.Mounts) {
      assert(created.Mounts.some(item => item.Type === mount.Type && item.Destination === mount.Destination && item.Source === mount.Source && item.RW === mount.RW), 'Original bind/volume identity must survive rebinding');
    }
    replacementIds.set(container.Id, replacement.Id);
  }
  const ordered = [...inspections].sort((left, right) => Number(!left.Name.startsWith('/supabase_db_')) - Number(!right.Name.startsWith('/supabase_db_')));
  const finalIds = ordered.map(container => replacementIds.get(container.Id) ?? container.Id);
  for (const id of finalIds) {
    assertOwned(await inspect(id), projectId, contextDirectory, networkName);
    await api(socketPath, 'POST', `${prefix}/containers/${id}/start`);
  }
  let final;
  for (let attempt = 0; attempt < 120; attempt++) {
    final = await Promise.all(finalIds.map(inspect));
    if (final.every(container => container.State.Running && (!container.State.Health || container.State.Health.Status === 'healthy'))) break;
    if (attempt > 20 && final.some(container => container.State.Status === 'restarting' || container.State.Status === 'exited')) break;
    await new Promise(done => setTimeout(done, 1000));
  }
  for (const container of final) {
    assertOwned(container, projectId, contextDirectory, networkName);
    assert(container.State.Running && (!container.State.Health || container.State.Health.Status === 'healthy'), 'Rebound full-stack service must become healthy');
    for (const bindings of Object.values(container.NetworkSettings.Ports)) for (const binding of bindings ?? []) assert.equal(binding.HostIp, '127.0.0.1');
  }
  return { explicitRebinding: true, inspections: final };
}
