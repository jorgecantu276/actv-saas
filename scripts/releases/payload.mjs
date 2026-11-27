import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { digest, identityFor } from './contract.mjs';

export function gitObject(kind, bytes) {
  return createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
}

export function sourceTreeHash(files) {
  const root = new Map();
  for (const file of files) {
    if (!/^[a-f0-9]{40}$/.test(file.gitBlob) || !['100644', '100755'].includes(file.mode) ||
      typeof file.path !== 'string' || file.path.split('/').some(name => !name || name === '.' || name === '..' || /[\\\0]/.test(name))) throw Error('Invalid source file binding');
    const names = file.path.split('/'); let directory = root;
    for (const name of names.slice(0, -1)) {
      if (!directory.has(name)) directory.set(name, new Map());
      directory = directory.get(name);
      if (!(directory instanceof Map)) throw Error('Source path collision');
    }
    if (directory.has(names.at(-1))) throw Error('Duplicate source path');
    directory.set(names.at(-1), file);
  }
  function tree(directory) {
    const entries = [...directory].map(([name, item]) => item instanceof Map
      ? { name, mode: '40000', hash: tree(item), sortKey: name + '/' }
      : { name, mode: item.mode, hash: item.gitBlob, sortKey: name });
    entries.sort((a, b) => Buffer.compare(Buffer.from(a.sortKey), Buffer.from(b.sortKey)));
    return gitObject('tree', Buffer.concat(entries.map(entry => Buffer.concat([
      Buffer.from(`${entry.mode} ${entry.name}\0`), Buffer.from(entry.hash, 'hex'),
    ]))));
  }
  return tree(root);
}

export function verifyPayload(directory, manifest) {
  if (!Array.isArray(manifest.sourceFiles) || sourceTreeHash(manifest.sourceFiles) !== manifest.sourceTree) throw Error('Source files do not reconstruct the pinned Git tree');
  const expected = new Map(manifest.sourceFiles.map(file => [file.path, file]));
  const overlay = new Map([['actv-release.json', manifest], ['lib/release-identity.generated.json', identityFor(manifest)]]);
  const observed = [];
  function visit(path = '') {
    for (const entry of readdirSync(join(directory, path))) {
      const name = path ? path + '/' + entry : entry;
      const file = join(directory, name), info = lstatSync(file);
      if (info.isDirectory()) { visit(name); continue; }
      if (!info.isFile()) throw Error('Payload symlink or special file refused');
      const bytes = readFileSync(file);
      if (overlay.has(name)) {
        if (digest(JSON.parse(bytes)) !== digest(overlay.get(name))) throw Error('Payload overlay differs');
      } else if (!expected.has(name) || gitObject('blob', bytes) !== expected.get(name).gitBlob) throw Error('Payload source bytes differ');
      observed.push(name);
    }
  }
  visit();
  if ([...new Set([...expected.keys(), ...overlay.keys()])].some(path => !observed.includes(path))) throw Error('Payload source files are missing');
  return true;
}
