import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSha, repository } from './contract.mjs';

export async function selectRelease(eventName, event, { ref, fetchRun, fetchMain }) {
  let sourceSha, runId, target, deploy;
  if (event.repository?.full_name !== repository) throw Error('Foreign release event');
  if (eventName === 'workflow_run') {
    const trigger = event.workflow_run;
    if (trigger?.event !== 'push' || trigger.head_branch !== 'main' || trigger.status !== 'completed' ||
      trigger.conclusion !== 'success' || trigger.head_repository?.full_name !== repository ||
      trigger.name !== 'ACTV candidate verification') return { eligible: false, reason: 'not_trusted_main_verification' };
    sourceSha = trigger.head_sha; runId = String(trigger.id); target = 'staging'; deploy = true;
  } else if (eventName === 'workflow_dispatch') {
    sourceSha = event.inputs?.source_sha; runId = String(event.inputs?.ci_run_id ?? ''); target = event.inputs?.target;
    deploy = event.inputs?.deploy === true || event.inputs?.deploy === 'true';
    if (!['staging', 'production'].includes(target) || target === 'production' && ref !== 'refs/heads/main') throw Error('Invalid manual release target/ref');
  } else throw Error('Unsupported release event');
  if (!isSha(sourceSha) || !/^\d+$/.test(runId)) throw Error('Immutable release source/run required');
  const observed = await fetchRun(runId);
  if (String(observed.id) !== runId || observed.head_sha !== sourceSha || observed.status !== 'completed' || observed.conclusion !== 'success' ||
    observed.path !== '.github/workflows/actv-pdv.yml' || observed.repository?.full_name !== repository ||
    observed.head_repository?.full_name !== repository) throw Error('Release event disagrees with actual verified source run');
  if (eventName === 'workflow_run') {
    if (observed.event !== 'push' || observed.head_branch !== 'main') throw Error('Automatic release requires a canonical main push');
    if (await fetchMain() !== sourceSha) return { eligible: false, reason: 'superseded_main_verification' };
  }
  return { eligible: true, source_sha: sourceSha, ci_run_id: runId, target, deploy };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const api = async path => {
      const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
        headers: { Authorization: 'Bearer ' + process.env.GH_TOKEN, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw Error('GitHub release-source verification unavailable');
      return response.json();
    };
    const selected = await selectRelease(process.env.GITHUB_EVENT_NAME, JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH)), {
      ref: process.env.GITHUB_REF, fetchRun: id => api('actions/runs/' + id), fetchMain: async () => (await api('branches/main')).commit.sha,
    });
    for (const [key, value] of Object.entries(selected)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    console.log(JSON.stringify(selected));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
