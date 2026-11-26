import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = 'jorgecantu276/actv-saas';
const countBy = (rows, key) => rows.reduce((out, row) => {
  const value = row[key] ?? 'UNKNOWN'; out[value] = (out[value] ?? 0) + 1; return out;
}, {});

export function readinessMetrics(record) {
  if (!Array.isArray(record.items) || !record.named_owners || !record.readiness) throw Error('Invalid readiness record');
  const scenarios = record.items.flatMap(item => item.acceptance ?? []);
  const ids = [...record.items, ...scenarios].map(row => row.id);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw Error('Missing or duplicate record ID');
  for (const row of [...record.items, ...scenarios]) if (!row.status) throw Error(`Missing status: ${row.id}`);
  return {
    recordUpdatedOn: record.updated_on, readiness: record.readiness,
    inventoryComplete: record.capability_inventory_complete,
    items: { total: record.items.length, byStatus: countBy(record.items, 'status') },
    decisions: countBy(record.items.filter(i => i.decision).map(i => i.decision), 'status'),
    acceptance: { total: scenarios.length, byStatus: countBy(scenarios, 'status'), byKind: countBy(scenarios, 'kind') },
    owners: { named: Object.values(record.named_owners).filter(value => typeof value === 'string' && value.trim()).length, total: Object.keys(record.named_owners).length },
    candidateSha: record.candidate_sha, evidenceIndex: record.release_evidence_index,
    productCompletionPercent: null, evidenceValidation: 'NOT_PERFORMED',
    sourceCandidate: record.source_consolidation ?? null,
  };
}

export function ciMetrics(runs, sha, dirty) {
  const exact = runs.filter(run => run.head_sha === sha);
  const latest = new Map();
  for (const run of exact) {
    const old = latest.get(run.workflow_id);
    if (!old || Date.parse(run.created_at) > Date.parse(old.created_at) ||
      (run.id === old.id && run.run_attempt > old.run_attempt)) latest.set(run.workflow_id, run);
  }
  const workflows = [...latest.values()].map(run => ({ workflowId: run.workflow_id, name: run.name, sha: run.head_sha, status: run.status, conclusion: run.conclusion, url: run.html_url }));
  return {
    sampledRuns: runs.length, sampleLimit: 100,
    outcomes: countBy(runs.map(run => ({ outcome: run.status === 'completed' ? (run.conclusion ?? 'UNKNOWN') : 'pending' })), 'outcome'),
    exactSource: {
      observation: dirty ? 'DIRTY_SOURCE_UNVERIFIED' : workflows.length ? 'OBSERVED_WORKFLOWS_ONLY' : 'UNKNOWN_NO_EXACT_SHA_RUN_IN_SAMPLE',
      workflows, allRequiredChecksPassed: null,
    },
  };
}

function command(bin, args, cwd = root) {
  return execFileSync(bin, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, windowsHide: true }).trim();
}

function sourceIdentity(source) {
  const origin = command('git', ['remote', 'get-url', 'origin'], source);
  if (!/^(?:https:\/\/github\.com\/|git@github\.com:)jorgecantu276\/actv-saas(?:\.git)?\/?$/.test(origin)) throw Error('Source origin does not match ACTV');
  const dirty = command('git', ['status', '--porcelain=v1', '-z', '--untracked-files=normal'], source);
  return { sha: command('git', ['rev-parse', 'HEAD'], source), branch: command('git', ['branch', '--show-current'], source) || 'DETACHED', dirty: !!dirty };
}

export async function main(args) {
  let source = root, output, check = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') check = true;
    else if (['--source', '--output'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) {
      const flag = args[i++]; if (flag === '--source') source = resolve(args[i]); else output = resolve(args[i]);
    } else throw Error(`Unknown option or missing value: ${args[i]}`);
  }
  const readiness = readinessMetrics(JSON.parse(readFileSync(resolve(root, 'docs/implementation-readiness.json'), 'utf8')));
  if (check) { console.log(JSON.stringify({ recordValid: true, readiness }, null, 2)); return; }
  const identity = sourceIdentity(source);
  const report = { observedAt: new Date().toISOString(), repository: repo, source: identity, readinessSource: sourceIdentity(root), readiness, production: { installation: 'UNKNOWN', qualifiedCandidate: null } };
  let unavailable = false;
  const observe = (fn) => {
    try { return { available: true, ...fn() }; }
    catch { unavailable = true; return { available: false, error: 'GitHub observation failed; check authenticated gh access/network. No zero or success inferred.' }; }
  };
  report.ci = observe(() => ciMetrics(JSON.parse(command('gh', ['api', `repos/${repo}/actions/runs?per_page=100`])).workflow_runs, identity.sha, identity.dirty));
  report.integration = observe(() => ({ sampleLimit: 100, pullRequests: JSON.parse(command('gh', ['pr', 'list', '--repo', repo, '--limit', '100', '--json', 'number,title,isDraft,headRefOid,url'])) }));
  report.publication = observe(() => ({ sampleLimit: 20, releases: JSON.parse(command('gh', ['api', `repos/${repo}/releases?per_page=20`])).map(r => ({ tag: r.tag_name, prerelease: r.prerelease, publishedAt: r.published_at, url: r.html_url })) }));
  const json = JSON.stringify(report, null, 2) + '\n';
  if (output) writeFileSync(output, json, { flag: 'wx' });
  console.log(json);
  if (unavailable) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
