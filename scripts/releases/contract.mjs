import { createHash } from 'node:crypto';

export const repository = 'jorgecantu276/actv-saas';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const digest = value => sha256(JSON.stringify(canonical(value)));
export const isSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export const isDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const require = (condition, message) => { if (!condition) throw Error(message); };

export function validateTarget(value) {
  require(value?.format === 'actv-release-target-v1', 'Invalid release target');
  require(['staging', 'production'].includes(value.environment), 'Invalid environment');
  require(/^[a-z0-9]{20}$/.test(value.supabaseProjectRef), 'Explicit Supabase project identity required');
  const origin = new URL(value.origin);
  require(origin.protocol === 'https:' && origin.origin === value.origin && !origin.username && !origin.password,
    'Target must have one canonical HTTPS origin');
  require(value.nodeMajor === 24, 'ACTV releases require Node 24');
  require(value.environment === 'production' ? value.stripeMode === 'live' : value.stripeMode === 'test', 'Wrong provider mode');
  const config = value.configuration;
  require(config && Object.keys(config).sort().join(',') === 'publicRaceMode,staffOrigin,supabaseAnonKeySha256,wordpressOrigin' &&
    isDigest(config.supabaseAnonKeySha256) && config.publicRaceMode === value.stripeMode && config.staffOrigin === value.origin,
  'Exact public application configuration binding required');
  const wordpress = new URL(config.wordpressOrigin);
  require(wordpress.protocol === 'https:' && wordpress.origin === config.wordpressOrigin && !wordpress.username && !wordpress.password,
    'Canonical WordPress origin required');
  require(value.productionProjectRef === 'ndjqyootqtnygyzhbjrz', 'Production backend denylist identity changed');
  if (value.environment === 'staging') {
    require(value.supabaseProjectRef !== value.productionProjectRef && origin.hostname !== 'pdv.actv.mx', 'Staging refuses production');
    require(value.syntheticOnly === true, 'Staging requires synthetic-only data');
  } else {
    require(value.supabaseProjectRef === value.productionProjectRef && origin.hostname === 'pdv.actv.mx', 'Production identity mismatch');
  }
  // Retain only explicitly public target bindings. Extra keys cannot smuggle
  // secrets into manifests, fingerprints or evidence artifacts.
  require(Object.keys(value).every(key => ['format', 'environment', 'origin', 'supabaseProjectRef',
    'productionProjectRef', 'stripeMode', 'nodeMajor', 'syntheticOnly', 'configuration'].includes(key)), 'Unexpected target field');
  return value;
}

export function validateCi(run, evidence, sourceSha) {
  require(isSha(sourceSha), 'Full immutable source SHA required');
  require(run?.head_sha === sourceSha && run.status === 'completed' && run.conclusion === 'success', 'Exact source CI has not passed');
  require(run.repository?.full_name === repository && run.head_repository?.full_name === repository, 'Foreign source CI refused');
  require(run.path === '.github/workflows/actv-pdv.yml' && ['push', 'pull_request', 'workflow_dispatch'].includes(run.event), 'Wrong verification workflow');
  require(evidence?.sourceSha === sourceSha && evidence.status === 'passed' && evidence.dirtySource === false &&
    evidence.scope === 'source_candidate_synthetic_only' && evidence.configurationMode === 'synthetic_test', 'CI artifact is not clean exact-source verification');
  const required = ['lint', 'unit', 'record', 'types', 'build', 'edge-unit', 'financial-sql', 'edge-postgres', 'portal-contracts', 'full-staging'];
  require(required.every(name => evidence.steps?.filter(step => step.name === name && step.status === 'passed').length === 1), 'Incomplete verification artifact');
  require(isDigest(evidence.fullStagingEvidenceSha256) && isDigest(evidence.baselineCatalogSha256), 'Missing full-stack evidence binding');
  return { runId: run.id, runAttempt: run.run_attempt, workflow: run.path, url: run.html_url, evidenceSha256: digest(evidence) };
}

export function identityFor(manifest) {
  return { format: 'actv-release-identity-v1', sourceSha: manifest.sourceSha, sourceTree: manifest.sourceTree,
    releaseId: digest(manifest), environment: manifest.target.environment,
    targetSha256: digest(manifest.target), productionQualified: false };
}

export function validateBackendReceipt(receipt, manifest) {
  require(receipt?.format === 'actv-backend-receipt-v1' && receipt.sourceSha === manifest.sourceSha &&
    receipt.sourceTree === manifest.sourceTree && receipt.supabaseProjectRef === manifest.target.supabaseProjectRef &&
    receipt.contractSha256 === digest(manifest.inputs) && receipt.status === 'contract_deployed' &&
    receipt.salesPaused === true && isDigest(receipt.evidenceSha256), 'Exact-source/backend contract receipt required');
  return receipt;
}

export function validateStageReceipt(receipt, manifest, stagingTarget) {
  require(receipt?.format === 'actv-deployment-receipt-v1' && receipt.status === 'observed', 'An observed staging deployment receipt is required');
  require(stagingTarget.environment === 'staging', 'Staging target required');
  validateTarget(stagingTarget);
  require(receipt.identity?.sourceSha === manifest.sourceSha && receipt.identity?.sourceTree === manifest.sourceTree,
    'Staging receipt is for different source');
  require(receipt.identity?.environment === 'staging' && receipt.identity?.targetSha256 === digest(stagingTarget), 'Staging receipt has wrong target');
  require(receipt.identity?.releaseId === digest({ ...manifest, target: stagingTarget }), 'Staging release manifest differs');
  require(receipt.target?.origin === stagingTarget.origin && receipt.target?.supabaseProjectRef === stagingTarget.supabaseProjectRef,
    'Staging origin/backend differs');
  require(receipt.health?.version === 'passed' && receipt.health?.routes === 'passed' && isDigest(receipt.identity.releaseId), 'Staging health did not pass');
  require(isDigest(receipt.backendReceiptSha256), 'Staging backend contract receipt is missing');
  return receipt;
}

export function validateProductionAcceptance(approval, manifest, stageReceipt, stagingTarget) {
  validateStageReceipt(stageReceipt, manifest, stagingTarget);
  require(approval?.format === 'actv-w6-approval-v1' && approval.sourceSha === manifest.sourceSha,
    'Exact-source W6 approval is required');
  require(approval.productionTargetSha256 === digest(manifest.target) && approval.stagingReceiptSha256 === digest(stageReceipt),
    'W6 approval has different target or staging receipt');
  require(approval.w6Status === 'accepted' && approval.newSalesPaused === true, 'W6 accepted release with closed sales gate required');
  require(isDigest(approval.backupReceiptSha256) && isDigest(approval.recoveryReceiptSha256), 'Backup and recovery receipts required');
  require(typeof approval.engineeringReviewer === 'string' && approval.engineeringReviewer.trim() &&
    typeof approval.operationsReviewer === 'string' && approval.operationsReviewer.trim() &&
    approval.engineeringReviewer !== approval.operationsReviewer, 'Distinct named engineering and operations reviewers required');
  require(Array.isArray(approval.scenarios) && approval.scenarios.length > 0, 'W6 scenario evidence is missing');
  const ids = new Set();
  for (const scenario of approval.scenarios) {
    require(typeof scenario.id === 'string' && !ids.has(scenario.id) && scenario.status === 'PASS' &&
      isDigest(scenario.evidenceSha256), 'W6 scenarios require unique passing evidence');
    ids.add(scenario.id);
  }
  return approval;
}

export function validateW6Coverage(approval, readiness) {
  require(readiness?.capability_inventory_complete === true, 'Readiness capability inventory remains incomplete');
  require(Object.values(readiness.named_owners ?? {}).length > 0 &&
    Object.values(readiness.named_owners).every(name => typeof name === 'string' && name.trim()), 'Readiness owners are unassigned');
  const expected = readiness.items.flatMap(item => item.acceptance ?? []).filter(row => (row.gate ?? readiness.acceptance_gate_default) !== 'W7');
  require(expected.length > 0 && expected.every(row => approval.scenarios.some(result => result.id === row.id)), 'W6 scenario coverage is incomplete');
  for (const item of readiness.items) {
    if (item.decision) require(item.decision.status === 'CLOSED' && item.closure_evidence?.length > 0, `Open decision: ${item.id}`);
  }
}
