#!/usr/bin/env node
// @ts-check

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_SITE_DIR = path.join('.siteforge', 'sites', 'instagram.com-ea2ecfbf');
const DEFAULT_CATALOG = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.codex', 'skills', 'instagram-live-actions', 'references', 'instagram-live-catalog.json');
const DEFAULT_DRY_RUN_SUMMARY = path.join('.siteforge', 'instagram-research-tasks', 'codex-openai-profile-prod-sample-v2', 'task-summary.json');
const DEFAULT_REAL_ATTEMPT_SUMMARY = path.join('.siteforge', 'instagram-research-tasks', 'codex-openai-works-archive-real-v1', 'task-summary.json');
const DEFAULT_RELATION_ATTEMPT_SUMMARY = path.join('.siteforge', 'instagram-research-tasks', 'codex-openai-relations-real-v1', 'task-summary.json');
const DEFAULT_DEGRADED_SUMMARY = path.join('.siteforge', 'instagram-research-tasks', 'codex-openai-profile-degraded-structure', 'task-summary.json');
const DEFAULT_PLANNER_CHECK = path.join('.siteforge', 'instagram-planner-checks', 'latest', 'planner-check.json');
const DEFAULT_API_CAPTURE_PROBE = path.join('.siteforge', 'instagram-live-runs-skill', 'instagram-openai-api-capture-probe-v1-profile-content-openai-posts', 'api-capture-debug.json');
const DEFAULT_API_REPLAY_AUDIT = path.join('docs', 'codex-goals', 'instagram-production-skill-v1', 'evidence', 'instagram-api-replay-audit.json');
const DEFAULT_OUT_DIR = path.join('docs', 'codex-goals', 'instagram-production-skill-v1');

const DISCOVERY_WEIGHTS = Object.freeze({
  semanticAccuracy: 20,
  granularity: 15,
  evidenceCompleteness: 15,
  candidateExplainability: 10,
  apiTruthfulness: 10,
  siteTypeAccuracy: 10,
  adapterChoice: 10,
  safetyBoundaryDiscovery: 10,
});

const EXECUTION_WEIGHTS = Object.freeze({
  parameterModeling: 15,
  executionPlanCompleteness: 15,
  runtimeBindingStability: 15,
  singleCapabilitySuccess: 15,
  resultValidation: 15,
  outputStructureQuality: 10,
  errorRecovery: 10,
  executionSafety: 5,
});

const TASK_WEIGHTS = Object.freeze({
  userIntentCoverage: 10,
  dispatchAccuracy: 10,
  multiStepPlanning: 15,
  capabilityComposition: 15,
  contextTransfer: 10,
  endToEndCompletion: 20,
  taskResultQuality: 10,
  failureExplanation: 5,
  taskSafetyCompliance: 5,
});

const LAYER_WEIGHTS = Object.freeze({
  discovery: 30,
  execution: 35,
  taskCompletion: 35,
});

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    siteDir: DEFAULT_SITE_DIR,
    buildDir: null,
    catalogPath: DEFAULT_CATALOG,
    dryRunSummaryPath: DEFAULT_DRY_RUN_SUMMARY,
    realAttemptSummaryPath: DEFAULT_REAL_ATTEMPT_SUMMARY,
    relationAttemptSummaryPath: DEFAULT_RELATION_ATTEMPT_SUMMARY,
    degradedSummaryPath: DEFAULT_DEGRADED_SUMMARY,
    plannerCheckPath: DEFAULT_PLANNER_CHECK,
    apiCaptureProbePath: DEFAULT_API_CAPTURE_PROBE,
    apiReplayAuditPath: DEFAULT_API_REPLAY_AUDIT,
    profilePath: path.join('profiles', 'www.instagram.com.json'),
    outDir: DEFAULT_OUT_DIR,
    outJson: null,
    outMd: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case '--site-dir':
        options.siteDir = next;
        index += 1;
        break;
      case '--build-dir':
        options.buildDir = next;
        index += 1;
        break;
      case '--catalog':
        options.catalogPath = next;
        index += 1;
        break;
      case '--dry-run-summary':
        options.dryRunSummaryPath = next;
        index += 1;
        break;
      case '--real-attempt-summary':
        options.realAttemptSummaryPath = next;
        index += 1;
        break;
      case '--relation-attempt-summary':
        options.relationAttemptSummaryPath = next;
        index += 1;
        break;
      case '--degraded-summary':
      case '--degraded-attempt-summary':
        options.degradedSummaryPath = next;
        index += 1;
        break;
      case '--planner-check':
      case '--planner-self-check':
        options.plannerCheckPath = next;
        index += 1;
        break;
      case '--api-capture-probe':
        options.apiCaptureProbePath = next;
        index += 1;
        break;
      case '--api-replay-audit':
        options.apiReplayAuditPath = next;
        index += 1;
        break;
      case '--profile-path':
        options.profilePath = next;
        index += 1;
        break;
      case '--out-dir':
        options.outDir = next;
        index += 1;
        break;
      case '--out-json':
        options.outJson = next;
        index += 1;
        break;
      case '--out-md':
        options.outMd = next;
        index += 1;
        break;
      case '--json':
        options.json = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        break;
    }
  }
  return options;
}

function usage() {
  return `Usage:
  node tools/evaluate-instagram-production-skill.mjs [options]

Options:
  --site-dir <path>              Default: .siteforge/sites/instagram.com-ea2ecfbf
  --build-dir <path>             Default: latest build under site-dir/builds
  --catalog <path>               Default: instagram-live-actions catalog
  --dry-run-summary <path>       Default: codex-openai-profile-prod-sample-v2 summary
  --real-attempt-summary <path>  Default: codex-openai-content-profile-real-v1 summary
  --relation-attempt-summary <path>
                                  Default: codex-openai-profile-real-attempt summary
  --degraded-summary <path>      Default: codex-openai-profile-degraded-structure summary
  --planner-check <path>         Default: .siteforge/instagram-planner-checks/latest/planner-check.json
  --api-replay-audit <path>      Default: docs/codex-goals/instagram-production-skill-v1/evidence/instagram-api-replay-audit.json
  --profile-path <path>          Default: profiles/www.instagram.com.json
  --out-json <path>              Output JSON path
  --out-md <path>                Output Markdown path
  --json                         Print evaluation JSON
`;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function latestBuildDir(siteDir) {
  const buildsDir = path.resolve(siteDir, 'builds');
  const entries = await fs.readdir(buildsDir, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  if (!dirs.length) throw new Error(`No build directories found under ${buildsDir}`);
  return path.join(buildsDir, dirs.at(-1));
}

function listFromArtifact(value, key) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.[key])) return value[key];
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function capabilityReason(capability) {
  return capability?.reason
    ?? capability?.reasonCode
    ?? capability?.activationBlockedReason
    ?? capability?.disabledReason
    ?? capability?.evidenceMatrix?.activationDecision
    ?? null;
}

function capabilityHasEvidence(capability) {
  return Boolean(
    capability?.evidence_status
    || capability?.evidenceStatus
    || capability?.activationEvidence
    || capability?.evidenceMatrix
    || (Array.isArray(capability?.evidence) && capability.evidence.length > 0)
    || (Array.isArray(capability?.evidenceRefs) && capability.evidenceRefs.length > 0),
  );
}

function roundScore(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function weighted(metrics, weights) {
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const score = Object.entries(weights).reduce((sum, [key, weight]) => sum + Number(metrics[key] ?? 0) * weight, 0) / totalWeight;
  return roundScore(score);
}

function requiredArtifactCoverage(summary) {
  const required = summary?.artifactContract?.requiredFiles ?? [];
  const paths = summary?.artifactContract?.paths ?? {};
  if (!required.length || !paths.outDir) return { required, present: 0, total: required.length, score: 0, missing: required };
  const missing = [];
  for (const relative of required) {
    const filePath = path.join(paths.outDir, relative);
    if (!fsSync.existsSync(filePath)) missing.push(relative);
  }
  return {
    required,
    present: required.length - missing.length,
    total: required.length,
    score: required.length ? roundScore(((required.length - missing.length) / required.length) * 100) : 0,
    missing,
  };
}

function hasActionableFailure(summary) {
  return Array.isArray(summary?.failures)
    && summary.failures.some((failure) => failure?.layer && failure?.reasonCode && failure?.remediation);
}

function summarizeApiCaptureProbe(probe) {
  const capture = probe?.capture && typeof probe.capture === 'object' ? probe.capture : {};
  const samples = Array.isArray(capture.samples) ? capture.samples : [];
  const operations = Array.isArray(capture.operations) ? capture.operations.filter(Boolean) : [];
  return {
    present: Boolean(probe),
    archiveReason: probe?.archiveReason ?? null,
    requestCount: Number(capture.requestCount ?? 0),
    responseCount: Number(capture.responseCount ?? capture.networkResponseCount ?? 0),
    parsedResponseCount: Number(capture.parsedResponseCount ?? 0),
    parsedSeedCandidateCount: Number(capture.parsedSeedCandidateCount ?? 0),
    operationCount: operations.length,
    operations,
    sampleCount: samples.length,
    replayVerified: false,
    adapterBound: false,
    runtimeTested: false,
  };
}

function summarizeApiReplayAudit(audit) {
  const operations = Array.isArray(audit?.operations) ? audit.operations : [];
  const activeApiCapabilities = Array.isArray(audit?.activeApiCapabilities) ? audit.activeApiCapabilities : [];
  const verifiedOperations = operations.filter((operation) => operation?.replayVerified === true
    && operation?.adapterBound?.accepted === true
    && operation?.runtimeTested?.completed === true
    && operation?.authBoundary?.redactionAuditsPassed === true);
  const sensitiveMaterial = audit?.safety?.sensitiveMaterial ?? {};
  const sensitiveMaterialSafe = Boolean(audit)
    && sensitiveMaterial.cookieFilePathPersisted !== true
    && sensitiveMaterial.cookieNamesPersisted !== true
    && sensitiveMaterial.cookieValuesPersisted !== true
    && sensitiveMaterial.authHeadersPersisted !== true
    && sensitiveMaterial.browserProfilePathPersistedInAudit !== true
    && sensitiveMaterial.rawPrivateBodiesPersisted !== true;
  const replayVerified = audit?.summary?.replayVerified === true
    || (operations.length > 0 && verifiedOperations.length === operations.length);
  const adapterBound = audit?.summary?.adapterBound === true
    || (operations.length > 0 && operations.every((operation) => operation?.adapterBound?.accepted === true));
  const runtimeTested = audit?.summary?.runtimeTested === true
    || (operations.length > 0 && operations.every((operation) => operation?.runtimeTested?.completed === true));
  const redactionAuditsPassed = audit?.summary?.redactionAuditsPassed === true
    || (operations.length > 0 && operations.every((operation) => operation?.authBoundary?.redactionAuditsPassed === true));
  return {
    present: Boolean(audit),
    status: audit?.status ?? null,
    operationCount: operations.length,
    verifiedOperationCount: Number(audit?.summary?.verifiedOperationCount ?? verifiedOperations.length),
    activeApiCapabilityCount: Number(audit?.summary?.activeApiCapabilityCount ?? activeApiCapabilities.length),
    activeApiCapabilities: activeApiCapabilities.map((capability) => capability?.id ?? capability).filter(Boolean),
    replayVerified,
    adapterBound,
    runtimeTested,
    redactionAuditsPassed,
    sensitiveMaterialSafe,
    relationTaskStatus: audit?.summary?.relationTaskStatus ?? null,
    relationTaskCollectedRecordCount: Number(audit?.summary?.relationTaskCollectedRecordCount ?? 0),
  };
}

function evaluateArtifacts({
  buildDir,
  buildReport,
  verificationReport,
  runtimeExecutionReport,
  runtimeDispatchReport,
  capabilitiesArtifact,
  executionPlansArtifact,
  executionContractsArtifact,
  catalog,
  dryRunSummary,
  realAttemptSummary,
  relationAttemptSummary,
  degradedSummary,
  plannerCheck,
  apiCaptureProbe,
  apiReplayAudit,
  profileExists,
}) {
  const capabilities = listFromArtifact(capabilitiesArtifact, 'capabilities');
  const activeCapabilities = capabilities.filter((capability) => capability.status === 'active');
  const candidateCapabilities = capabilities.filter((capability) => capability.status === 'candidate');
  const disabledCapabilities = capabilities.filter((capability) => capability.status === 'disabled');
  const executionPlans = listFromArtifact(executionPlansArtifact, 'executionPlans');
  const executionContracts = listFromArtifact(executionContractsArtifact, 'executionContracts');
  const taskTemplates = catalog?.taskTemplates ?? [];
  const activeApiCapabilities = catalog?.apiFirstPolicy?.activeApiCapabilities ?? [];
  const apiCaptureProbeSummary = summarizeApiCaptureProbe(apiCaptureProbe);
  const apiReplayAuditSummary = summarizeApiReplayAudit(apiReplayAudit);
  const replayVerifiedApiCount = Math.max(
    Number(buildReport?.summary?.network?.replayVerifiedCount ?? 0),
    Number(apiReplayAuditSummary.verifiedOperationCount ?? 0),
  );
  const activeApiCapabilityCount = Math.max(
    activeApiCapabilities.length,
    Number(apiReplayAuditSummary.activeApiCapabilityCount ?? 0),
  );
  const apiProductionReady = activeApiCapabilities.length > 0
    && apiReplayAuditSummary.replayVerified === true
    && apiReplayAuditSummary.adapterBound === true
    && apiReplayAuditSummary.runtimeTested === true
    && apiReplayAuditSummary.redactionAuditsPassed === true
    && apiReplayAuditSummary.sensitiveMaterialSafe === true;
  const runtimeCompleted = runtimeExecutionReport?.status === 'completed' && runtimeExecutionReport?.runtimeExecuted === true;
  const runtimeDescriptorOnly = runtimeDispatchReport?.runtimeInvocationRequest?.descriptorOnly === true
    || runtimeExecutionReport?.runtimeInvocationRequest?.descriptorOnly === true;
  const dryRunCoverage = requiredArtifactCoverage(dryRunSummary);
  const realContentComplete = realAttemptSummary?.productionEvidence?.contentCollectionComplete === true;
  const realTaskId = realAttemptSummary?.task?.id ?? realAttemptSummary?.taskId ?? null;
  const accountContentProfileSupported = realContentComplete
    && new Set(['account-full-archive', 'account-works-archive', 'account-composite-profile', 'account-content-profile']).has(realTaskId);
  const specifiedUserAllWorksSupported = realContentComplete
    && new Set(['account-full-archive', 'account-works-archive']).has(realTaskId)
    && realAttemptSummary?.productionEvidence?.userArchiveSupport === 'supported_with_current_artifacts';
  const degradedStructureAvailable = degradedSummary?.status === 'degraded'
    && Number(degradedSummary?.productionEvidence?.collectedRecordCount ?? 0) > 0
    && degradedSummary?.productionEvidence?.contentCollectionComplete !== true;
  const plannerSelfCheckPassed = plannerCheck?.ok === true
    && plannerCheck?.safety?.descriptorOnly === true
    && plannerCheck?.safety?.sensitiveMaterialRead === false;
  const dryRunPlannedOnly = (dryRunSummary?.productionEvidence?.contentCollectionComplete === false)
    || Object.hasOwn(dryRunSummary?.bucketCounts ?? {}, 'planned');
  const relationFailureExplained = hasActionableFailure(relationAttemptSummary);
  const relationComplete = relationAttemptSummary?.status === 'completed'
    && relationAttemptSummary?.productionEvidence?.contentCollectionComplete === true;
  const relationFailureReasonCode = relationAttemptSummary?.failures?.find?.((failure) => failure?.reasonCode)?.reasonCode
    ?? (relationAttemptSummary?.status === 'failed' ? 'relation_task_failed' : null);
  const realFailureExplained = realContentComplete || hasActionableFailure(realAttemptSummary) || relationFailureExplained;
  const candidateWithReason = candidateCapabilities.filter((capability) => capabilityReason(capability)).length;
  const activeWithEvidence = activeCapabilities.filter(capabilityHasEvidence).length;
  const disabledWithReason = disabledCapabilities.filter((capability) => capabilityReason(capability)).length;
  const siteTypeSocial = buildReport?.summary?.siteAdapter?.sourceSiteKey === 'instagram'
    || buildReport?.summary?.coverage?.crawlMode === 'authenticated_authorized_source';
  const sourceAdapterId = buildReport?.summary?.siteAdapter?.sourceAdapterId
    ?? buildReport?.summary?.siteAdapter?.source_adapter_id;
  const adapterKind = buildReport?.summary?.siteAdapter?.adapterKind
    ?? buildReport?.summary?.siteAdapter?.adapter_kind;
  const adapterMatched = sourceAdapterId === 'instagram'
    && adapterKind === 'site_dedicated_generated_profile';
  const noSensitivePersistence = buildReport?.summary?.auth?.savedMaterial?.rawMaterialPersisted === false
    && buildReport?.summary?.auth?.savedMaterial?.cookieMaterialPersisted === false
    && buildReport?.summary?.auth?.savedMaterial?.privateBodyPersisted === false
    && buildReport?.summary?.network?.sanitizedSummary?.rawTracesPersisted === false
    && (apiReplayAuditSummary.present ? apiReplayAuditSummary.sensitiveMaterialSafe === true : true);
  const noUnsafeMutation = disabledCapabilities.length >= 17;
  const activeWithPlans = activeCapabilities.filter((capability) => executionPlans.some((plan) => plan.capabilityId === capability.id)).length;
  const activeWithContracts = activeCapabilities.filter((capability) => executionContracts.some((contract) => contract.capabilityId === capability.id)).length;
  const contextTransferCompleted = runtimeExecutionReport?.resultSummary?.contextTransfer?.status === 'completed'
    || runtimeExecutionReport?.compositionExecution?.steps?.some?.((step) => step?.contextOutput || step?.contextInput) === true;

  const discoveryMetrics = {
    semanticAccuracy: activeCapabilities.length > 0 ? 100 : 0,
    granularity: taskTemplates.length >= 9 ? 100 : taskTemplates.length >= 6 ? 95 : 70,
    evidenceCompleteness: activeCapabilities.length ? (activeWithEvidence / activeCapabilities.length) * 100 : 0,
    candidateExplainability: candidateCapabilities.length ? (candidateWithReason / candidateCapabilities.length) * 100 : 100,
    apiTruthfulness: apiProductionReady ? 100 : 90,
    siteTypeAccuracy: siteTypeSocial ? 100 : 0,
    adapterChoice: adapterMatched && apiReplayAuditSummary.adapterBound ? 100 : adapterMatched ? 95 : 70,
    safetyBoundaryDiscovery: disabledCapabilities.length ? (disabledWithReason / disabledCapabilities.length) * 100 : 100,
  };

  const executionMetrics = {
    parameterModeling: taskTemplates.every((task) => task.input === 'account' || task.input === 'query') ? 100 : 80,
    executionPlanCompleteness: activeCapabilities.length ? (activeWithPlans / activeCapabilities.length) * 100 : 0,
    runtimeBindingStability: runtimeCompleted
      ? (apiProductionReady && realContentComplete && relationComplete ? 100 : runtimeDescriptorOnly ? 80 : 95)
      : 40,
    singleCapabilitySuccess: runtimeCompleted ? (accountContentProfileSupported ? 100 : realContentComplete ? 90 : 70) : 30,
    resultValidation: realFailureExplained ? 100 : 60,
    outputStructureQuality: dryRunCoverage.score,
    errorRecovery: realFailureExplained && dryRunSummary?.task?.noStallPolicy?.resume
      ? (apiProductionReady && relationComplete ? 100 : 90)
      : 60,
    executionSafety: noSensitivePersistence && noUnsafeMutation ? 100 : 0,
  };

  const taskMetrics = {
    userIntentCoverage: taskTemplates.length >= 6 ? 100 : 70,
    dispatchAccuracy: plannerSelfCheckPassed ? 100 : catalog?.siteFallbacks && Object.keys(catalog.siteFallbacks).length >= 5 ? 95 : 70,
    multiStepPlanning: taskTemplates.every((task) => Array.isArray(task.buckets) && task.buckets.length > 0) ? 100 : 70,
    capabilityComposition: runtimeCompleted && contextTransferCompleted
      ? (specifiedUserAllWorksSupported ? 100 : accountContentProfileSupported ? 85 : degradedStructureAvailable ? 65 : 55)
      : 35,
    contextTransfer: contextTransferCompleted ? 100 : 50,
    endToEndCompletion: specifiedUserAllWorksSupported ? 100 : accountContentProfileSupported ? 80 : realContentComplete ? 70 : 30,
    taskResultQuality: specifiedUserAllWorksSupported ? 100 : accountContentProfileSupported ? 85 : realContentComplete ? 80 : degradedStructureAvailable ? 55 : 45,
    failureExplanation: realFailureExplained ? 100 : 0,
    taskSafetyCompliance: noSensitivePersistence && noUnsafeMutation ? 100 : 0,
  };

  const discoveryScore = weighted(discoveryMetrics, DISCOVERY_WEIGHTS);
  const executionScore = weighted(executionMetrics, EXECUTION_WEIGHTS);
  const taskCompletionScore = weighted(taskMetrics, TASK_WEIGHTS);
  const weightedScore = roundScore(
    discoveryScore * LAYER_WEIGHTS.discovery / 100
    + executionScore * LAYER_WEIGHTS.execution / 100
    + taskCompletionScore * LAYER_WEIGHTS.taskCompletion / 100,
  );

  const hardCapAudit = {
    contentFragmentPromotedToCapability: false,
    readOnlyMisclassifiedAsMutation: false,
    fictionalApiPromoted: activeApiCapabilityCount > replayVerifiedApiCount,
    activeCapabilitiesMissingPlans: activeCapabilities.length > 0 && activeWithPlans / activeCapabilities.length < 0.8,
    unexplainedFailure: realAttemptSummary?.status === 'failed' && !realFailureExplained,
    sensitiveMaterialInReportOrSkill: !noSensitivePersistence,
  };
  const caps = [
    hardCapAudit.contentFragmentPromotedToCapability ? 60 : null,
    hardCapAudit.readOnlyMisclassifiedAsMutation ? 65 : null,
    hardCapAudit.fictionalApiPromoted ? 70 : null,
    hardCapAudit.activeCapabilitiesMissingPlans ? 75 : null,
    hardCapAudit.unexplainedFailure ? 80 : null,
  ].filter((value) => value !== null);
  const cappedScore = caps.length ? Math.min(weightedScore, ...caps) : weightedScore;

  const blockers = [
    !apiProductionReady ? {
      layer: 'api',
      reasonCode: 'no_replay_verified_instagram_api',
      evidence: {
        activeApiCapabilities: activeApiCapabilities.length,
        replayVerifiedApiCount,
        apiCaptureProbe: apiCaptureProbeSummary,
        apiReplayAudit: apiReplayAuditSummary,
      },
      nextStep: apiCaptureProbeSummary.present
        ? '已有脱敏 API capture 候选；下一步需要从 capture 中生成 replay seed，完成 replay verification、adapter binding 和 runtime test 后才能升为 active API。'
        : '采集脱敏 API 证据，完成 replay verification、adapter binding 和 runtime test 后才能升为 active API。',
    } : null,
    !realContentComplete ? {
      layer: 'login',
      reasonCode: profileExists ? 'profile_present_but_real_collection_not_verified' : 'login_or_session_required',
      evidence: {
        profilePath: path.resolve('profiles', 'www.instagram.com.json'),
        profileExists,
        realAttemptSummary: realAttemptSummary?.status ?? null,
      },
      nextStep: '刷新用户授权 Instagram 浏览器会话，并用相同任务执行 --execute --resume；禁止输出 cookie、token、auth header 或浏览器 profile 内容。',
    } : null,
    {
      layer: 'e2e',
      reasonCode: realContentComplete ? 'none' : 'real_content_jsonl_not_collected',
      evidence: {
        dryRunPlannedOnly,
        realContentComplete,
        realAttemptPath: DEFAULT_REAL_ATTEMPT_SUMMARY,
      },
      nextStep: '登录态可用后确认 raw-items.jsonl、deduped-items.jsonl、accounts/items.jsonl 至少包含脱敏真实记录，再提升任务完成层分数。',
    },
    !specifiedUserAllWorksSupported ? {
      layer: 'all_works_archive',
      reasonCode: accountContentProfileSupported
        ? 'account_content_profile_completed_works_archive_not_verified'
        : 'account_works_archive_not_verified',
      evidence: {
        realTaskId,
        realContentComplete,
        realAttemptPath: DEFAULT_REAL_ATTEMPT_SUMMARY,
      },
      nextStep: '执行并验证 account-works-archive 任务，确认 posts、reels、media、highlights 均写入脱敏 JSONL 后，才能声明“指定用户所有作品”支持。',
    } : null,
    relationAttemptSummary?.status === 'failed' ? {
      layer: 'relations',
      reasonCode: relationFailureReasonCode ?? 'relation_task_failed',
      evidence: {
        relationAttemptPath: DEFAULT_RELATION_ATTEMPT_SUMMARY,
        relationAttemptStatus: relationAttemptSummary?.status,
        relationFailureReasonCode,
      },
      nextStep: relationFailureReasonCode === 'command_timeout'
        ? '关系链 bucket 当前在页面 fallback 中超时；需要补更稳定的 followers/following 弹窗选择器、分页停止条件或 API replay 证据。'
        : '关系链 bucket 当前未完成；如任务需要 followers/following 全量列表，需要补关系弹窗选择器或 API replay 证据。',
    } : null,
  ].filter((blocker) => blocker && blocker.reasonCode !== 'none');

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    site: {
      siteKey: 'instagram',
      siteId: buildReport?.siteId ?? 'instagram.com-ea2ecfbf',
      rootUrl: 'https://www.instagram.com/',
      buildId: buildReport?.buildId ?? path.basename(buildDir),
      buildDir,
    },
    evidence: {
      buildStatus: buildReport?.status ?? null,
      verificationStatus: verificationReport?.status ?? null,
      registryStatus: buildReport?.summary?.registryStatus ?? null,
      runtimeExecutionStatus: runtimeExecutionReport?.status ?? null,
      runtimeExecuted: runtimeCompleted,
      runtimeDescriptorOnly,
      profileExists,
      dryRunArtifactCoverage: dryRunCoverage,
      realAttemptStatus: realAttemptSummary?.status ?? null,
      relationAttemptStatus: relationAttemptSummary?.status ?? null,
      relationFailureReasonCode,
      relationFailureExplained,
      apiCaptureProbe: apiCaptureProbeSummary,
      apiReplayAudit: apiReplayAuditSummary,
      degradedAttemptStatus: degradedSummary?.status ?? null,
      degradedStructureAvailable,
      degradedCollectedRecordCount: Number(degradedSummary?.productionEvidence?.collectedRecordCount ?? 0),
      plannerSelfCheckStatus: plannerSelfCheckPassed ? 'passed' : plannerCheck ? 'failed' : 'missing',
      plannerSelfCheckPassed,
      realFailureExplained,
      realContentComplete,
      realTaskId,
      accountContentProfileSupported,
      specifiedUserAllWorksSupported,
    },
    capabilityState: {
      active: activeCapabilities.map((capability) => capability.id.split(':').at(-1)),
      candidate: candidateCapabilities.map((capability) => ({
        id: capability.id.split(':').at(-1),
        reason: capabilityReason(capability),
      })),
      disabled: disabledCapabilities.map((capability) => ({
        id: capability.id.split(':').at(-1),
        reason: capabilityReason(capability),
      })),
      counts: {
        active: activeCapabilities.length,
        candidate: candidateCapabilities.length,
        disabled: disabledCapabilities.length,
        activeWithEvidence,
        activeWithPlans,
        activeWithContracts,
      },
    },
    taskTemplates: taskTemplates.map((task) => ({
      id: task.id,
      input: task.input,
      buckets: task.buckets,
      plannerCommand: task.plannerCommand,
      executeCommand: task.executeCommand,
    })),
    apiFirstPolicy: {
      status: catalog?.apiFirstPolicy?.status ?? 'unknown',
      activeApiCapabilities,
      replayVerifiedApiCount,
      activeApiCapabilityCount,
      apiReplayAudit: apiReplayAuditSummary,
      fallbackPolicy: catalog?.apiFirstPolicy?.fallbackPolicy ?? null,
      falseApiClaimMade: hardCapAudit.fictionalApiPromoted,
    },
    siteFallbacks: catalog?.siteFallbacks ?? {},
    scores: {
      discovery: {
        metrics: Object.fromEntries(Object.entries(discoveryMetrics).map(([key, value]) => [key, roundScore(value)])),
        weights: DISCOVERY_WEIGHTS,
        score: discoveryScore,
      },
      execution: {
        metrics: Object.fromEntries(Object.entries(executionMetrics).map(([key, value]) => [key, roundScore(value)])),
        weights: EXECUTION_WEIGHTS,
        score: executionScore,
      },
      taskCompletion: {
        metrics: Object.fromEntries(Object.entries(taskMetrics).map(([key, value]) => [key, roundScore(value)])),
        weights: TASK_WEIGHTS,
        score: taskCompletionScore,
      },
      layerWeights: LAYER_WEIGHTS,
      weighted: weightedScore,
      capped: cappedScore,
    },
    hardCapAudit,
    blockers,
    status: cappedScore >= 100 && blockers.length === 0 ? 'production_complete' : 'not_production_complete',
    supportAnswer: {
      accountContentProfile: accountContentProfileSupported ? 'supported_with_current_artifacts' : 'not_supported_yet',
      specifiedUserAllWorks: specifiedUserAllWorksSupported ? 'supported' : 'not_supported_yet',
      reason: specifiedUserAllWorksSupported
        ? '已有 account-works-archive 或 account-full-archive 真实 verified site fallback 采集出的脱敏 JSONL 记录，且 userArchiveSupport 达标。'
        : accountContentProfileSupported
          ? '当前已完成账号内容画像真实采集，但 real task 不是 account-works-archive 或 userArchiveSupport 未达标；所有作品归档仍未验证。'
        : degradedStructureAvailable
          ? '当前可降级输出授权结构摘要 JSONL，但没有可用登录 profile，也没有真实作品内容 JSONL。'
          : '当前只有任务模板、dry-run 合约和登录缺失失败解释；没有可用登录 profile，也没有真实内容 JSONL。',
    },
  };
}

function renderMarkdown(evaluation) {
  const candidateRows = evaluation.capabilityState.candidate
    .map((capability) => `| \`${capability.id}\` | ${capability.reason ?? '未记录'} |`)
    .join('\n');
  const disabledRows = evaluation.capabilityState.disabled
    .map((capability) => `| \`${capability.id}\` | ${capability.reason ?? '未记录'} |`)
    .join('\n');
  const taskRows = evaluation.taskTemplates
    .map((task) => `| \`${task.id}\` | \`${task.input}\` | ${task.buckets.join(', ')} |`)
    .join('\n');
  const metricRows = [
    ['能力发现层', evaluation.scores.discovery.score],
    ['能力执行层', evaluation.scores.execution.score],
    ['任务完成层', evaluation.scores.taskCompletion.score],
  ].map(([layer, score]) => `| ${layer} | ${score} |`).join('\n');
  const blockers = evaluation.blockers
    .map((blocker) => `| ${blocker.layer} | \`${blocker.reasonCode}\` | ${blocker.nextStep} |`)
    .join('\n');
  const currentConclusion = evaluation.status === 'production_complete'
    ? '当前证据满足生产型 skill 完成条件。'
    : [
        `不能确认 100 分。active API=${evaluation.apiFirstPolicy.activeApiCapabilities.length}，replay verified API=${evaluation.apiFirstPolicy.replayVerifiedApiCount}。`,
        `登录 profile 存在=${evaluation.evidence.profileExists}，真实内容采集完成=${evaluation.evidence.realContentComplete}，真实任务=${evaluation.evidence.realTaskId ?? 'unknown'}。`,
        `内容画像支持=${evaluation.supportAnswer.accountContentProfile}，指定用户所有作品支持=${evaluation.supportAnswer.specifiedUserAllWorks}。`,
      ].join(' ');

  return `# Instagram 生产型 Skill 评估

## 当前结论

当前总分为 **${evaluation.scores.capped} / 100**，状态为 \`${evaluation.status}\`。最新证据来自 \`${evaluation.site.buildDir}\`。

${currentConclusion}

## 新 Skill 与候选 Skill 差异

- 候选 SiteForge skill：${evaluation.capabilityState.counts.active} 个 active 结构/只读能力，${evaluation.capabilityState.counts.candidate} 个 candidate，${evaluation.capabilityState.counts.disabled} 个 disabled。
- 新 \`instagram-live-actions\`：提供 ${evaluation.taskTemplates.length} 个高层任务模板、API-first 策略、verified site fallback、\`--resume\`、JSONL/cache/archive artifact 合约和失败分层。
- API 立场：${evaluation.apiFirstPolicy.apiReplayAudit.replayVerified ? '已通过脱敏 replay audit 验证的 GET API 才激活；未验证 API 仍保持 candidate。' : '没有 replay verified / adapter bound / runtime tested API，因此不激活 API，也不虚构 API 成功。'}
- 任务边界：写操作、支付、账号修改、私信、关注、点赞、发布、删除默认 blocked。

## 任务模板

| 模板 | 输入 | Bucket |
|---|---|---|
${taskRows}

## Active 能力

${evaluation.capabilityState.active.map((id) => `\`${id}\``).join(', ')}

## Candidate 能力

| 能力 | 原因 |
|---|---|
${candidateRows}

## Disabled 能力

| 能力 | 原因 |
|---|---|
${disabledRows}

## API-first 与 Site Fallback

- API-first 状态：\`${evaluation.apiFirstPolicy.status}\`
- active API：${evaluation.apiFirstPolicy.activeApiCapabilities.length}
- replay verified API：${evaluation.apiFirstPolicy.replayVerifiedApiCount}
- API replay audit：${evaluation.apiFirstPolicy.apiReplayAudit.present ? `${evaluation.apiFirstPolicy.apiReplayAudit.status} / operations=${evaluation.apiFirstPolicy.apiReplayAudit.verifiedOperationCount}/${evaluation.apiFirstPolicy.apiReplayAudit.operationCount} / adapterBound=${evaluation.apiFirstPolicy.apiReplayAudit.adapterBound} / runtimeTested=${evaluation.apiFirstPolicy.apiReplayAudit.runtimeTested}` : 'missing'}
- 脱敏 API capture 候选：${evaluation.evidence.apiCaptureProbe.present ? `${evaluation.evidence.apiCaptureProbe.operationCount} operations / ${evaluation.evidence.apiCaptureProbe.sampleCount} samples / archiveReason=${evaluation.evidence.apiCaptureProbe.archiveReason}` : 'missing'}
- fallback 策略：\`${evaluation.apiFirstPolicy.fallbackPolicy}\`

已声明 site fallback：${Object.keys(evaluation.siteFallbacks).map((key) => `\`${key}\``).join(', ')}

## 端到端样例与产物

- dry-run 合约样例：\`${DEFAULT_DRY_RUN_SUMMARY}\`
- 真实 fallback 尝试：\`${DEFAULT_REAL_ATTEMPT_SUMMARY}\`
- 登录失败后的结构降级样例：\`${DEFAULT_DEGRADED_SUMMARY}\`
- dry-run artifact 覆盖：${evaluation.evidence.dryRunArtifactCoverage.present}/${evaluation.evidence.dryRunArtifactCoverage.total}
- planner self-check：${evaluation.evidence.plannerSelfCheckStatus}
- 结构降级样例状态：${evaluation.evidence.degradedAttemptStatus}
- 结构降级脱敏记录数：${evaluation.evidence.degradedCollectedRecordCount}
- 真实内容采集完成：${evaluation.evidence.realContentComplete}
- 真实任务 ID：${evaluation.evidence.realTaskId ?? 'unknown'}
- 内容画像支持：${evaluation.supportAnswer.accountContentProfile}
- 指定用户所有作品支持：${evaluation.supportAnswer.specifiedUserAllWorks}
- 登录 profile 存在：${evaluation.evidence.profileExists}

## 中文三层评分

| 层级 | 分数 |
|---|---:|
${metricRows}

加权总分：

\`\`\`text
${evaluation.scores.discovery.score} * 30% + ${evaluation.scores.execution.score} * 35% + ${evaluation.scores.taskCompletion.score} * 35% = ${evaluation.scores.weighted}
\`\`\`

硬性封顶后总分：**${evaluation.scores.capped} / 100**。

## 阻塞项与下一步

| 层 | reasonCode | 下一步 |
|---|---|---|
${blockers}

## 指定用户所有作品支持性

结论：\`${evaluation.supportAnswer.specifiedUserAllWorks}\`。

原因：${evaluation.supportAnswer.reason}
`;
}

async function evaluateInstagramProductionSkill(options = parseArgs()) {
  if (options.help) return { help: usage() };
  const buildDir = path.resolve(options.buildDir || await latestBuildDir(options.siteDir));
  const [
    buildReport,
    verificationReport,
    runtimeExecutionReport,
    runtimeDispatchReport,
    capabilitiesArtifact,
    executionPlansArtifact,
    executionContractsArtifact,
    catalog,
    dryRunSummary,
    realAttemptSummary,
    relationAttemptSummary,
    degradedSummary,
    plannerCheck,
    apiCaptureProbe,
    apiReplayAudit,
  ] = await Promise.all([
    readJsonIfExists(path.join(buildDir, 'build_report.json')),
    readJsonIfExists(path.join(buildDir, 'verification_report.json')),
    readJsonIfExists(path.join(buildDir, 'runtime_execution_report.json')),
    readJsonIfExists(path.join(buildDir, 'runtime_dispatch_report.json')),
    readJsonIfExists(path.join(buildDir, 'capabilities.json')),
    readJsonIfExists(path.join(buildDir, 'execution_plans.json')),
    readJsonIfExists(path.join(buildDir, 'execution_contracts.json')),
    readJsonIfExists(path.resolve(options.catalogPath)),
    readJsonIfExists(path.resolve(options.dryRunSummaryPath)),
    readJsonIfExists(path.resolve(options.realAttemptSummaryPath)),
    readJsonIfExists(path.resolve(options.relationAttemptSummaryPath)),
    readJsonIfExists(path.resolve(options.degradedSummaryPath)),
    readJsonIfExists(path.resolve(options.plannerCheckPath)),
    readJsonIfExists(path.resolve(options.apiCaptureProbePath)),
    readJsonIfExists(path.resolve(options.apiReplayAuditPath)),
  ]);
  const profileExists = await fileExists(path.resolve(options.profilePath));
  const evaluation = evaluateArtifacts({
    buildDir,
    buildReport,
    verificationReport,
    runtimeExecutionReport,
    runtimeDispatchReport,
    capabilitiesArtifact,
    executionPlansArtifact,
    executionContractsArtifact,
    catalog,
    dryRunSummary,
    realAttemptSummary,
    relationAttemptSummary,
    degradedSummary,
    plannerCheck,
    apiCaptureProbe,
    apiReplayAudit,
    profileExists,
  });
  const outJson = options.outJson ?? path.join(options.outDir, 'production-skill-evaluation.json');
  const outMd = options.outMd ?? path.join(options.outDir, 'production-skill-evaluation.md');
  await fs.mkdir(path.dirname(path.resolve(outJson)), { recursive: true });
  await fs.mkdir(path.dirname(path.resolve(outMd)), { recursive: true });
  await fs.writeFile(path.resolve(outJson), `${JSON.stringify(evaluation, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.resolve(outMd), renderMarkdown(evaluation), 'utf8');
  return evaluation;
}

async function main() {
  const options = parseArgs();
  const result = await evaluateInstagramProductionSkill(options);
  if (result.help) {
    process.stdout.write(result.help);
    return;
  }
  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

export {
  evaluateArtifacts,
  evaluateInstagramProductionSkill,
  parseArgs,
  renderMarkdown,
};
