import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, identityFor, isSha, repository, sha256, validateCi, validateTarget } from './contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 16 * 1024 * 1024 }).trim();

export function readSourceManifest(sourceSha, cwd = root) {
  if (!isSha(sourceSha)) throw Error('Use the full source SHA');
  const entries = git(['ls-tree', '-r', sourceSha], cwd).split('\n').map(line => {
    const match = /^(\d+) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
    if (!match || match[1] !== '100644' && match[1] !== '100755') throw Error('Release refuses symlinks or submodules');
    return { path: match[3], gitBlob: match[2], mode: match[1] };
  });
  if (entries.some(entry => /(?:^|\/)\.env(?:\.|$)|(?:^|\/)(?:credentials|secrets)\.json$|\.private(?:\.|\/)/i.test(entry.path))) {
    throw Error('Release source contains a private configuration path');
  }
  const selected = entries.filter(entry => /^supabase\/(migrations\/|functions\/|operations\/)|^supabase\/config\.toml$|^tests\/staging\/(legacy-baseline\.sql|baseline-catalog\.json)$|^ops\/source-candidate\.json$/.test(entry.path));
  const inputs = selected.map(entry => ({ path: entry.path,
    sha256: sha256(execFileSync('git', ['show', `${sourceSha}:${entry.path}`], { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })) }));
  const candidate = JSON.parse(git(['show', `${sourceSha}:ops/source-candidate.json`], cwd));
  return { sourceTree: git(['rev-parse', `${sourceSha}^{tree}`], cwd), sourceFiles: entries, inputs,
    version: candidate.version, functions: candidate.functions, configurationNames: candidate.configurationNames };
}

export function prepareRelease({ sourceSha, target, run, evidence, output, cwd = root }) {
  validateTarget(target);
  const verification = validateCi(run, evidence, sourceSha);
  if (git(['rev-parse', 'HEAD'], cwd) !== sourceSha || git(['status', '--porcelain'], cwd)) throw Error('Release requires a clean exact-source checkout');
  const origin = git(['remote', 'get-url', 'origin'], cwd);
  if (!/^(?:https:\/\/github\.com\/|git@github\.com:)jorgecantu276\/actv-saas(?:\.git)?$/.test(origin)) throw Error('Unexpected source origin');
  const destination = resolve(output);
  if (!isAbsolute(output) || !relative(cwd, destination).startsWith('..') || existsSync(destination)) throw Error('Use a new absolute output outside source');
  const source = readSourceManifest(sourceSha, cwd);
  if (!source.inputs.length || !source.functions.length) throw Error('Incomplete release source inventory');
  const manifest = { format: 'actv-release-manifest-v1', repository, sourceSha,
    ...source, target, verification, deploymentPolicy: {
      newSales: 'remain_paused_until_W7', database: 'separate_approved_forward_maintenance',
      rollback: 'compatible_application_only_after_new_obligations', hostedLoad: 'separate_compute_acceptance_required',
      productionAcceptance: 'W6_then_authorized_W7',
    } };
  const identity = identityFor(manifest);
  mkdirSync(destination, { recursive: true });
  const payload = join(destination, 'source'); mkdirSync(payload);
  const archive = join(destination, 'git-source.tar');
  execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, sourceSha], { cwd, windowsHide: true });
  execFileSync('tar', ['-xf', archive, '-C', payload], { windowsHide: true });
  writeFileSync(join(payload, 'lib/release-identity.generated.json'), JSON.stringify(identity, null, 2) + '\n');
  writeFileSync(join(payload, 'actv-release.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(destination, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const receipt = { format: 'actv-package-receipt-v1', identity, manifestSha256: digest(manifest),
    gitArchiveSha256: sha256(readFileSync(archive)), overlay: ['lib/release-identity.generated.json', 'actv-release.json'],
    kind: 'source_payload_for_target_build', productionQualified: false };
  writeFileSync(join(destination, 'package-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}

export function argsToObject(args) {
  if (args.length % 2) throw Error('Options need values');
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!/^--[a-z-]+$/.test(args[i]) || !args[i + 1] || result[args[i].slice(2)]) throw Error('Invalid or duplicate option');
    result[args[i].slice(2)] = args[i + 1];
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = argsToObject(process.argv.slice(2));
    if (Object.keys(options).sort().join(',') !== 'ci-evidence,ci-run,output,source-sha,target') throw Error('Required: --source-sha --target --ci-run --ci-evidence --output');
    const read = path => JSON.parse(readFileSync(path, 'utf8'));
    console.log(JSON.stringify(prepareRelease({ sourceSha: options['source-sha'], target: read(options.target),
      run: read(options['ci-run']), evidence: read(options['ci-evidence']), output: options.output }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
