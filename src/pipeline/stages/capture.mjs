import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { initializeCliUtf8 } from '../../infra/cli.mjs';
import {
  parseProgressCliOption,
  runSingleStageCliWithProgress,
} from '../../infra/cli/progress-cli.mjs';
import { pipelineStageTitle } from '../../infra/cli/progress-copy.mjs';
import { NETWORK_IDLE_QUIET_MS, openBrowserSession } from '../../infra/browser/session.mjs';
import {
  ensureAuthenticatedSession,
  resolveSiteBrowserSessionOptions,
  shouldEnsureAuthenticatedNavigationSession,
  shouldUsePersistentProfileForNavigation,
} from '../../infra/auth/site-auth.mjs';
import {
  computePageStateSignature as computeSharedPageStateSignature,
  createPageStateHelperBundleSource,
  createPageStateHelperFallbackFunction,
} from '../../shared/page-state-runtime.mjs';
import {
  normalizeReasonCode,
  reasonCodeSummary,
} from '../../sites/capability/reason-codes.mjs';
import { normalizeRiskTransition } from '../../sites/capability/risk-state.mjs';
import {
  composeLifecycleSubscribers,
  createLifecycleArtifactWriterSubscriber,
  dispatchLifecycleEvent,
  normalizeLifecycleEvent,
} from '../../sites/capability/lifecycle-events.mjs';
import { matchCapabilityHooksForLifecycleEvent } from '../../sites/capability/capability-hook.mjs';
import { assertSchemaCompatible } from '../../sites/capability/compatibility-registry.mjs';
import {
  assertNoForbiddenPatterns,
  prepareRedactedArtifactJsonWithAudit,
  redactValue,
} from '../../sites/capability/security-guard.mjs';
import {
  apiCandidateFromObservedRequest,
  createApiDiscoveryFailure,
  validateApiCandidateWithAdapter,
  writeApiCandidateArtifactsFromCaptureOutput,
  writeManualApiCandidateVerificationArtifacts,
  writeSiteAdapterCandidateDecisionArtifacts,
} from '../../sites/capability/api-discovery.mjs';
import {
  createApiCandidateAuthVerificationResult,
  createApiCandidateMultiAspectVerificationResult,
  createApiCandidatePaginationVerificationResult,
  createApiCandidateResponseSchemaVerificationResultFromCaptureSummary,
  createApiCandidateRiskVerificationResult,
  writeApiCandidateResponseVerificationResultArtifact,
} from '../../sites/capability/api-candidates.mjs';
import { resolveSiteAdapter } from '../../sites/core/adapters/resolver.mjs';
import { resolveDouyinHeadlessDefault } from '../../sites/douyin/model/site.mjs';

const DEFAULT_OPTIONS = {
  outDir: path.resolve(process.cwd(), 'captures'),
  browserPath: undefined,
  headless: true,
  timeoutMs: 30_000,
  waitUntil: 'load',
  idleMs: 1_000,
  fullPage: true,
  viewport: {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
  },
  userAgent: undefined,
  profilePath: undefined,
  siteProfile: null,
  reuseLoginState: undefined,
  browserProfileRoot: undefined,
  userDataDir: undefined,
  autoLogin: undefined,
};

const CAPTURE_HELPER_NAMESPACE = '__BWS_CAPTURE__';
const CAPTURE_HELPER_BUNDLE_SOURCE = createPageStateHelperBundleSource(CAPTURE_HELPER_NAMESPACE);
const pageComputeStateSignature = createPageStateHelperFallbackFunction(CAPTURE_HELPER_NAMESPACE);

function createError(code, message) {
  return { code: normalizeReasonCode(code), message };
}

function isDouyinSiteProfile(siteProfile = null, inputUrl = '') {
  const profileHost = String(siteProfile?.host ?? '').toLowerCase();
  if (profileHost === 'www.douyin.com' || profileHost === 'douyin.com') {
    return true;
  }
  try {
    const parsed = new URL(inputUrl);
    return parsed.hostname === 'www.douyin.com' || parsed.hostname === 'douyin.com';
  } catch {
    return false;
  }
}

function isXiaohongshuSiteProfile(siteProfile = null, inputUrl = '') {
  const adapter = resolveSiteAdapter({
    host: siteProfile?.host ?? null,
    inputUrl,
    profile: siteProfile,
  });
  return adapter?.id === 'xiaohongshu' || adapter?.siteKey === 'xiaohongshu';
}

function resolveCaptureHeadlessDefault(inputUrl, fallback = true, siteProfile = null) {
  const douyinDefault = resolveDouyinHeadlessDefault(inputUrl, fallback, siteProfile);
  return isXiaohongshuSiteProfile(siteProfile, inputUrl)
    ? false
    : douyinDefault;
}

function isTransientCaptureBootstrapError(error) {
  const message = String(error?.message ?? '');
  return /CDP timeout for Runtime\.evaluate/iu.test(message)
    || /CDP socket closed/iu.test(message)
    || /WebSocket is not open/iu.test(message)
    || /Target closed/iu.test(message)
    || /Inspector\.detached/iu.test(message)
    || /ECONNRESET|EPIPE|socket hang up/iu.test(message);
}

async function closeSessionQuietly(session) {
  try {
    await session?.close?.();
  } catch {
    // Keep the original failure for the caller.
  }
}

async function collectCaptureStateSignature(session, siteProfile = null) {
  const normalizeSignature = (signature) => {
    if (signature?.pageFacts || signature?.runtimeEvidence || signature?.fingerprint) {
      return signature;
    }
    return computeSharedPageStateSignature({
      finalUrl: signature?.finalUrl ?? '',
      title: signature?.title ?? '',
      pageType: signature?.pageType,
      rawHtml: signature?.rawHtml ?? '',
      documentText: signature?.documentText ?? '',
    }, siteProfile);
  };
  if (typeof session?.invokeHelperMethod === 'function') {
    return normalizeSignature(await session.invokeHelperMethod('pageComputeStateSignature', [siteProfile], {
      namespace: CAPTURE_HELPER_NAMESPACE,
      bundleSource: CAPTURE_HELPER_BUNDLE_SOURCE,
      fallbackFn: pageComputeStateSignature,
    }));
  }
  return normalizeSignature(await session.callPageFunction(pageComputeStateSignature, siteProfile));
}

async function inspectCaptureRuntime(session, inputUrl, siteProfile = null) {
  const douyinProfile = isDouyinSiteProfile(siteProfile, inputUrl);
  const xiaohongshuProfile = isXiaohongshuSiteProfile(siteProfile, inputUrl);
  if (!douyinProfile && !xiaohongshuProfile) {
    return {
      pageFacts: null,
      runtimeEvidence: null,
      error: null,
    };
  }

  try {
    const signature = await collectCaptureStateSignature(session, siteProfile);
    const pageFacts = signature?.pageFacts ?? null;
    const runtimeEvidence = signature?.runtimeEvidence ?? null;
    const antiCrawlDetected = pageFacts?.antiCrawlDetected === true || runtimeEvidence?.antiCrawlDetected === true;
    const antiCrawlSignals = Array.isArray(pageFacts?.antiCrawlSignals)
      ? pageFacts.antiCrawlSignals
      : Array.isArray(runtimeEvidence?.antiCrawlEvidence?.signals)
        ? runtimeEvidence.antiCrawlEvidence.signals
        : [];
    if (!antiCrawlDetected || antiCrawlSignals.length === 0) {
      return {
        pageFacts: null,
        runtimeEvidence: null,
        error: null,
      };
    }

    if (xiaohongshuProfile) {
      const restrictionDetected = pageFacts?.riskPageDetected === true
        || /\/website-login\/error(?:[/?#]|$)/iu.test(String(signature?.finalUrl ?? inputUrl))
        || /\/website-login\/error(?:[/?#]|$)/iu.test(String(inputUrl));
      if (!restrictionDetected) {
        return {
          pageFacts: null,
          runtimeEvidence: null,
          error: null,
        };
      }
      return {
        pageFacts,
        runtimeEvidence,
        error: null,
      };
    }

    return {
      pageFacts,
      runtimeEvidence,
      error: createError(
        'ANTI_CRAWL_CHALLENGE',
        `Detected Douyin anti-crawl challenge while capturing ${inputUrl}: ${antiCrawlSignals.join(', ')}`,
      ),
    };
  } catch {
    return {
      pageFacts: null,
      runtimeEvidence: null,
      error: null,
    };
  }
}

function normalizeWaitUntil(value) {
  if (value !== 'load' && value !== 'networkidle') {
    throw new Error(`Unsupported waitUntil value: ${value}`);
  }
  return value;
}

function normalizeBoolean(value, flagName) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true') {
      return true;
    }
    if (lower === 'false') {
      return false;
    }
  }
  throw new Error(`Invalid boolean for ${flagName}: ${value}`);
}

function normalizeNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid number for ${flagName}: ${value}`);
  }
  return parsed;
}

function formatTimestampForDir(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1Z');
}

function sanitizeHost(host) {
  return (host || 'unknown-host').replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unknown-host';
}

function summarizeForStdout(manifest) {
  return {
    finalUrl: manifest.finalUrl,
    title: manifest.title,
    capturedAt: manifest.capturedAt,
    outDir: manifest.outDir,
    status: manifest.status,
  };
}

function buildManifest({
  inputUrl,
  capturedAt,
  outDir,
  htmlPath,
  snapshotPath,
  screenshotPath,
  manifestPath,
  traceId,
  correlationId,
  viewport,
}) {
  return {
    traceId,
    correlationId,
    inputUrl,
    finalUrl: inputUrl,
    title: '',
    capturedAt,
    status: 'failed',
    outDir,
    files: {
      html: htmlPath,
      snapshot: snapshotPath,
      screenshot: screenshotPath,
      manifest: manifestPath,
    },
    page: {
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
    },
    pageFacts: null,
    runtimeEvidence: null,
    error: null,
  };
}

function setManifestError(manifest, code, message) {
  if (!manifest.error) {
    manifest.error = createError(code, message);
  }
}

function resolveCaptureNetworkSiteKey(inputUrl, siteProfile = null) {
  const profileKey = String(
    siteProfile?.siteKey
    ?? siteProfile?.key
    ?? siteProfile?.host
    ?? siteProfile?.domain
    ?? '',
  ).trim();
  if (profileKey) {
    return profileKey.toLowerCase();
  }

  try {
    return new URL(inputUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

async function attachObservedNetworkRequests(manifest, session, settings, inputUrl) {
  if (typeof session?.getObservedNetworkRequests !== 'function') {
    return;
  }

  const siteKey = resolveCaptureNetworkSiteKey(inputUrl, settings.siteProfile);
  if (!siteKey) {
    return;
  }

  const observedRequests = await session.getObservedNetworkRequests({ siteKey });
  if (!Array.isArray(observedRequests) || observedRequests.length === 0) {
    return;
  }

  const redacted = redactValue(observedRequests).value;
  if (Array.isArray(redacted) && redacted.length > 0) {
    manifest.networkRequests = redacted;
  }
}

function setManifestNetworkResponseSummaries(manifest, responseSummaries) {
  if (!Array.isArray(responseSummaries) || responseSummaries.length === 0) {
    return;
  }
  const redacted = redactValue(responseSummaries).value;
  if (Array.isArray(redacted) && redacted.length > 0) {
    for (const summary of redacted) {
      assertSchemaCompatible('ApiResponseCaptureSummary', summary);
      for (const field of ['headers', 'endpoint', 'catalogEntry', 'catalogPath', 'request', 'response', 'body']) {
        if (Object.hasOwn(summary, field)) {
          throw new Error(`Capture network response summaries must not contain ${field}`);
        }
      }
    }
    assertNoForbiddenPatterns(redacted);
    manifest.networkResponseSummaries = redacted;
  }
}

function capabilityHookMatchSummaryForLifecycleEvent(lifecycleEvent, {
  capabilityHookRegistry,
  capabilityHooks,
} = {}) {
  const hooks = capabilityHookRegistry ?? capabilityHooks;
  if (!hooks) {
    return undefined;
  }
  return matchCapabilityHooksForLifecycleEvent(hooks, lifecycleEvent);
}

async function attachObservedNetworkResponseSummaries(manifest, session, settings, inputUrl) {
  if (typeof session?.getObservedNetworkResponseSummaries !== 'function') {
    return;
  }

  const siteKey = resolveCaptureNetworkSiteKey(inputUrl, settings.siteProfile);
  if (!siteKey) {
    return;
  }

  const responseSummaries = await session.getObservedNetworkResponseSummaries({ siteKey });
  if (!Array.isArray(responseSummaries) || responseSummaries.length === 0) {
    return;
  }

  setManifestNetworkResponseSummaries(manifest, responseSummaries);
}

async function writeCaptureApiCandidateAdapterDecisions(manifest, candidateResults = []) {
  const manifestDir = path.dirname(manifest.files.manifest);
  const outputDir = manifest.files.apiCandidateDecisionsDir
    ?? path.join(manifestDir, 'api-candidate-decisions');
  const redactionAuditDir = manifest.files.apiCandidateDecisionRedactionAuditsDir
    ?? path.join(manifestDir, 'api-candidate-decision-redaction-audits');
  const catalogUpgradeDecisionOutputDir = manifest.files.apiCandidateCatalogUpgradeDecisionsDir
    ?? path.join(manifestDir, 'api-candidate-catalog-upgrade-decisions');
  const catalogUpgradeDecisionRedactionAuditDir = manifest.files.apiCandidateCatalogUpgradeDecisionRedactionAuditsDir
    ?? path.join(manifestDir, 'api-candidate-catalog-upgrade-decision-redaction-audits');
  const catalogUpgradeDecisionLifecycleEventOutputDir =
    manifest.files.apiCandidateCatalogUpgradeDecisionLifecycleEventsDir
      ?? path.join(manifestDir, 'api-candidate-catalog-upgrade-decision-lifecycle-events');
  const catalogUpgradeDecisionLifecycleEventRedactionAuditDir =
    manifest.files.apiCandidateCatalogUpgradeDecisionLifecycleEventRedactionAuditsDir
      ?? path.join(manifestDir, 'api-candidate-catalog-upgrade-decision-lifecycle-event-redaction-audits');
  const lifecycleContext = captureLifecycleContext(manifest);
  const decisions = await writeSiteAdapterCandidateDecisionArtifacts(candidateResults, {
    outputDir,
    redactionAuditDir,
    catalogUpgradeDecisionOutputDir,
    catalogUpgradeDecisionRedactionAuditDir,
    catalogUpgradeDecisionLifecycleEventOutputDir,
    catalogUpgradeDecisionLifecycleEventRedactionAuditDir,
    lifecycleEventTraceId: lifecycleContext.traceId,
    lifecycleEventCorrelationId: lifecycleContext.correlationId,
    lifecycleEventTaskType: lifecycleContext.taskType,
    lifecycleEventAdapterVersion: lifecycleContext.adapterVersion,
    validatedAt: manifest.capturedAt,
    decidedAt: manifest.capturedAt,
    evidenceSource: 'capture-api-candidate-artifact',
    resolveAdapter: ({ host, inputUrl }) => (inputUrl
      ? resolveSiteAdapter({ inputUrl })
      : resolveSiteAdapter({ host })),
  });

  if (decisions.length > 0) {
    manifest.files.apiCandidateDecisions = decisions.map((decision) => decision.artifactPath);
    manifest.files.apiCandidateDecisionRedactionAudits = decisions
      .map((decision) => decision.redactionAuditPath)
      .filter(Boolean);
    manifest.files.apiCandidateCatalogUpgradeDecisions = decisions
      .map((decision) => decision.catalogUpgradeDecisionArtifactPath)
      .filter(Boolean);
    manifest.files.apiCandidateCatalogUpgradeDecisionRedactionAudits = decisions
      .map((decision) => decision.catalogUpgradeDecisionRedactionAuditPath)
      .filter(Boolean);
    manifest.files.apiCandidateCatalogUpgradeDecisionLifecycleEvents = decisions
      .map((decision) => decision.catalogUpgradeDecisionLifecycleEventPath)
      .filter(Boolean);
    manifest.files.apiCandidateCatalogUpgradeDecisionLifecycleEventRedactionAudits = decisions
      .map((decision) => decision.catalogUpgradeDecisionLifecycleEventRedactionAuditPath)
      .filter(Boolean);
    manifest.files.apiCandidateDecisionsDir = outputDir;
    manifest.files.apiCandidateDecisionRedactionAuditsDir = redactionAuditDir;
    manifest.files.apiCandidateCatalogUpgradeDecisionsDir = catalogUpgradeDecisionOutputDir;
    manifest.files.apiCandidateCatalogUpgradeDecisionRedactionAuditsDir = catalogUpgradeDecisionRedactionAuditDir;
    manifest.files.apiCandidateCatalogUpgradeDecisionLifecycleEventsDir =
      catalogUpgradeDecisionLifecycleEventOutputDir;
    manifest.files.apiCandidateCatalogUpgradeDecisionLifecycleEventRedactionAuditsDir =
      catalogUpgradeDecisionLifecycleEventRedactionAuditDir;
  }

  return decisions;
}

function summarizeCaptureDecisionResults(decisionResults = []) {
  const summary = {
    count: 0,
    byDecision: {},
    reasonCodes: {},
  };
  for (const result of decisionResults) {
    const decision = String(result?.decision?.decision ?? 'unknown').trim() || 'unknown';
    summary.count += 1;
    summary.byDecision[decision] = (summary.byDecision[decision] ?? 0) + 1;
    const reasonCode = String(result?.decision?.reasonCode ?? '').trim();
    if (reasonCode) {
      summary.reasonCodes[reasonCode] = (summary.reasonCodes[reasonCode] ?? 0) + 1;
    }
  }
  return summary;
}

function summarizeCaptureCatalogUpgradeDecisionResults(decisionResults = []) {
  const summary = {
    count: 0,
    byDecision: {},
    reasonCodes: {},
  };
  for (const result of decisionResults) {
    const upgradeDecision = result?.catalogUpgradeDecision;
    if (!upgradeDecision) {
      continue;
    }
    const decision = String(upgradeDecision.decision ?? 'unknown').trim() || 'unknown';
    summary.count += 1;
    summary.byDecision[decision] = (summary.byDecision[decision] ?? 0) + 1;
    const reasonCode = String(upgradeDecision.reasonCode ?? '').trim();
    if (reasonCode) {
      summary.reasonCodes[reasonCode] = (summary.reasonCodes[reasonCode] ?? 0) + 1;
    }
  }
  return summary;
}

function captureApiRiskStateForReason({
  reasonCode,
  siteKey,
  taskId,
  scope,
  observedAt,
} = {}) {
  const normalizedReasonCode = normalizeReasonCode(reasonCode);
  if (!normalizedReasonCode) {
    return undefined;
  }
  const reasonRecovery = reasonCodeSummary(normalizedReasonCode);
  const state = reasonRecovery.manualRecoveryNeeded
    ? 'manual_recovery_required'
    : reasonRecovery.cooldownNeeded
      ? 'rate_limited'
      : 'suspicious';
  const riskState = normalizeRiskTransition({
    from: 'normal',
    state,
    reasonCode: normalizedReasonCode,
    siteKey,
    taskId,
    scope,
    observedAt,
  });
  assertNoForbiddenPatterns(riskState);
  return {
    reasonCode: normalizedReasonCode,
    reasonRecovery,
    riskState,
  };
}

function captureApiDecisionRiskStateSummaries(decisionResults = [], {
  observedAt,
} = {}) {
  return decisionResults
    .map((result) => {
      const reasonCode = normalizeCaptureLifecycleText(result?.decision?.reasonCode);
      if (!reasonCode) {
        return undefined;
      }
      return {
        source: 'site-adapter-decision',
        candidateIndex: result?.index,
        adapterId: normalizeCaptureLifecycleText(result?.decision?.adapterId),
        decision: normalizeCaptureLifecycleText(result?.decision?.decision),
        ...captureApiRiskStateForReason({
          reasonCode,
          siteKey: normalizeCaptureLifecycleText(result?.decision?.siteKey),
          taskId: `capture-api-candidate:${result?.index}`,
          scope: 'capture-site-adapter-decision',
          observedAt,
        }),
      };
    })
    .filter(Boolean);
}

function captureApiCatalogUpgradeRiskStateSummaries(decisionResults = [], {
  observedAt,
} = {}) {
  return decisionResults
    .map((result) => {
      const reasonCode = normalizeCaptureLifecycleText(result?.catalogUpgradeDecision?.reasonCode);
      if (!reasonCode) {
        return undefined;
      }
      return {
        source: 'api-catalog-upgrade-decision',
        candidateIndex: result?.index,
        adapterId: normalizeCaptureLifecycleText(result?.catalogUpgradeDecision?.adapterId),
        decision: normalizeCaptureLifecycleText(result?.catalogUpgradeDecision?.decision),
        canEnterCatalog: result?.catalogUpgradeDecision?.canEnterCatalog === true,
        ...captureApiRiskStateForReason({
          reasonCode,
          siteKey: normalizeCaptureLifecycleText(result?.catalogUpgradeDecision?.siteKey),
          taskId: `capture-api-candidate:${result?.index}`,
          scope: 'capture-api-catalog-upgrade',
          observedAt,
        }),
      };
    })
    .filter(Boolean);
}

function annotateCaptureApiFailureRiskState(error, {
  manifest,
  scope,
  siteKey,
  taskId,
} = {}) {
  if (!error?.reasonCode && !error?.reasonRecovery) {
    return error;
  }
  const reasonCode = normalizeCaptureLifecycleText(error.reasonCode ?? error.code);
  if (!reasonCode) {
    return error;
  }
  const riskEvidence = captureApiRiskStateForReason({
    reasonCode,
    siteKey: normalizeCaptureLifecycleText(siteKey) ?? resolveCaptureLifecycleSiteKey(manifest),
    taskId: normalizeCaptureLifecycleText(taskId) ?? normalizeCaptureLifecycleText(manifest?.files?.manifest),
    scope,
    observedAt: manifest?.capturedAt,
  });
  error.riskState = riskEvidence?.riskState;
  error.metadata = {
    ...(error.metadata && typeof error.metadata === 'object' && !Array.isArray(error.metadata)
      ? error.metadata
      : {}),
    reasonRecovery: riskEvidence?.reasonRecovery,
    riskState: riskEvidence?.riskState,
  };
  assertNoForbiddenPatterns(error.metadata);
  return error;
}

function responseSchemaVerificationArtifactName(index) {
  return `response-schema-verification-${String(index + 1).padStart(4, '0')}.json`;
}

function captureApiCandidateArtifactName(index) {
  return `candidate-${String(index + 1).padStart(4, '0')}.json`;
}

function captureApiCandidateDecisionArtifactName(index) {
  return `decision-${String(index + 1).padStart(4, '0')}.json`;
}

function captureResponseSchemaVerificationConfig(manifest = {}) {
  const config = manifest.responseSchemaVerification ?? manifest.apiResponseSchemaVerification;
  if (!config?.enabled) {
    return null;
  }
  const verifierId = normalizeCaptureLifecycleText(config.verifierId);
  if (!verifierId) {
    throw new Error('Capture response schema verification verifierId is required');
  }
  const verifiedAt = normalizeCaptureLifecycleText(config.verifiedAt);
  if (!verifiedAt) {
    throw new Error('Capture response schema verification verifiedAt is required');
  }
  const candidateIds = Array.isArray(config.candidateIds)
    ? config.candidateIds.map(normalizeCaptureLifecycleText).filter(Boolean)
    : [normalizeCaptureLifecycleText(config.candidateId)].filter(Boolean);
  return {
    verifierId,
    verifiedAt,
    candidateIds,
    metadata: config.metadata && typeof config.metadata === 'object' && !Array.isArray(config.metadata)
      ? config.metadata
      : {},
  };
}

function normalizeCaptureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function requireCaptureAspectPassed(aspectConfig, label) {
  const status = normalizeCaptureLifecycleText(aspectConfig.status ?? aspectConfig.result);
  if (aspectConfig.passed !== true && status !== 'passed' && status !== 'verified') {
    throw new Error(`Capture multi-aspect verification ${label} input must be explicitly passed`);
  }
}

function captureMultiAspectVerificationConfig(manifest = {}) {
  const config = manifest.apiCandidateVerification
    ?? manifest.multiAspectVerification
    ?? manifest.captureApiCandidateVerification;
  if (!config?.enabled) {
    return null;
  }
  const verifierId = normalizeCaptureLifecycleText(config.verifierId);
  if (!verifierId) {
    throw new Error('Capture multi-aspect verification verifierId is required');
  }
  const verifiedAt = normalizeCaptureLifecycleText(config.verifiedAt);
  if (!verifiedAt) {
    throw new Error('Capture multi-aspect verification verifiedAt is required');
  }
  const candidateIds = Array.isArray(config.candidateIds)
    ? config.candidateIds.map(normalizeCaptureLifecycleText).filter(Boolean)
    : [normalizeCaptureLifecycleText(config.candidateId)].filter(Boolean);
  const auth = normalizeCaptureObject(config.authVerification ?? config.auth);
  const pagination = normalizeCaptureObject(config.paginationVerification ?? config.pagination);
  const risk = normalizeCaptureObject(config.riskVerification ?? config.risk);
  for (const [label, aspect] of [
    ['auth', auth],
    ['pagination', pagination],
    ['risk', risk],
  ]) {
    if (Object.keys(aspect).length === 0) {
      throw new Error(`Capture multi-aspect verification ${label} input is required`);
    }
    requireCaptureAspectPassed(aspect, label);
  }
  return {
    verifierId,
    verifiedAt,
    candidateIds,
    auth,
    pagination,
    risk,
    metadata: normalizeCaptureObject(config.metadata),
  };
}

function captureCandidateFromResultOrRequest(resultOrRequest = {}) {
  if (resultOrRequest?.candidate) {
    return resultOrRequest.candidate;
  }
  return apiCandidateFromObservedRequest(resultOrRequest);
}

function isSchemaVerifiableResponseSummary(summary = {}) {
  return Boolean(
    normalizeCaptureLifecycleText(summary?.responseSchemaHash)
    && summary?.bodyShape
    && typeof summary.bodyShape === 'object'
  );
}

function buildCaptureResponseSchemaVerificationRecords(manifest, candidateInputs = []) {
  const config = captureResponseSchemaVerificationConfig(manifest);
  if (!config) {
    return [];
  }
  const responseSummaries = Array.isArray(manifest.networkResponseSummaries)
    ? manifest.networkResponseSummaries
    : [];
  if (responseSummaries.length === 0) {
    throw new Error('Capture response schema verification requires networkResponseSummaries');
  }
  const candidateById = new Map(candidateInputs
    .map(captureCandidateFromResultOrRequest)
    .filter((candidate) => candidate?.id)
    .map((candidate) => [candidate.id, candidate]));
  const requestedIds = new Set(config.candidateIds);
  const selectedSummaries = responseSummaries.filter((summary) => {
    const candidateId = normalizeCaptureLifecycleText(summary?.candidateId);
    return requestedIds.size === 0 || requestedIds.has(candidateId);
  });
  if (selectedSummaries.length === 0) {
    throw new Error('Capture response schema verification requires matching response summaries');
  }
  for (const candidateId of requestedIds) {
    const summary = selectedSummaries.find((item) => item?.candidateId === candidateId);
    if (!summary) {
      throw new Error(`Capture response schema verification response summary not found: ${candidateId}`);
    }
    if (!isSchemaVerifiableResponseSummary(summary)) {
      throw new Error(
        `Capture response schema verification response summary lacks bodyShape or responseSchemaHash: ${candidateId}`,
      );
    }
  }
  const schemaSummaries = selectedSummaries.filter(isSchemaVerifiableResponseSummary);
  if (schemaSummaries.length === 0) {
    return [];
  }

  return schemaSummaries.map((summary) => {
    const candidate = candidateById.get(summary?.candidateId);
    if (!candidate) {
      throw new Error(`Capture response schema verification candidate not found: ${summary?.candidateId}`);
    }
    return {
      candidate,
      verificationResult: createApiCandidateResponseSchemaVerificationResultFromCaptureSummary({
        candidate,
        responseSummary: summary,
        verifierId: config.verifierId,
        verifiedAt: config.verifiedAt,
        metadata: {
          source: 'capture.networkResponseSummaries',
          captureManifest: manifest.files.manifest,
          ...config.metadata,
        },
      }),
    };
  });
}

function preflightCaptureResponseSchemaVerification(manifest) {
  if (!captureResponseSchemaVerificationConfig(manifest)) {
    return;
  }
  buildCaptureResponseSchemaVerificationRecords(manifest, manifest.networkRequests ?? []);
}

function createCaptureAuthVerificationResult(candidate, config) {
  return createApiCandidateAuthVerificationResult({
    candidate,
    verifierId: normalizeCaptureLifecycleText(config.auth.verifierId) ?? `${config.verifierId}-auth`,
    verifiedAt: normalizeCaptureLifecycleText(config.auth.verifiedAt) ?? config.verifiedAt,
    status: normalizeCaptureLifecycleText(config.auth.status) ?? 'passed',
    passed: true,
    authEvidence: normalizeCaptureObject(config.auth.authEvidence ?? config.auth.evidence ?? config.auth),
    metadata: {
      source: 'capture.apiCandidateVerification.auth',
      ...normalizeCaptureObject(config.auth.metadata),
    },
  });
}

function createCapturePaginationVerificationResult(candidate, config) {
  return createApiCandidatePaginationVerificationResult({
    candidate,
    verifierId: normalizeCaptureLifecycleText(config.pagination.verifierId) ?? `${config.verifierId}-pagination`,
    verifiedAt: normalizeCaptureLifecycleText(config.pagination.verifiedAt) ?? config.verifiedAt,
    status: normalizeCaptureLifecycleText(config.pagination.status) ?? 'passed',
    passed: true,
    paginationEvidence: normalizeCaptureObject(
      config.pagination.paginationEvidence
      ?? config.pagination.evidence
      ?? config.pagination
    ),
    metadata: {
      source: 'capture.apiCandidateVerification.pagination',
      ...normalizeCaptureObject(config.pagination.metadata),
    },
  });
}

function createCaptureRiskVerificationResult(candidate, config) {
  return createApiCandidateRiskVerificationResult({
    candidate,
    verifierId: normalizeCaptureLifecycleText(config.risk.verifierId) ?? `${config.verifierId}-risk`,
    verifiedAt: normalizeCaptureLifecycleText(config.risk.verifiedAt) ?? config.verifiedAt,
    status: normalizeCaptureLifecycleText(config.risk.status) ?? 'passed',
    passed: true,
    riskEvidence: normalizeCaptureObject(config.risk.riskEvidence ?? config.risk.evidence ?? config.risk),
    metadata: {
      source: 'capture.apiCandidateVerification.risk',
      ...normalizeCaptureObject(config.risk.metadata),
    },
  });
}

function buildCaptureMultiAspectVerificationRecords(manifest, candidateInputs = [], decisionResults = []) {
  const config = captureMultiAspectVerificationConfig(manifest);
  if (!config) {
    return [];
  }
  if (!captureResponseSchemaVerificationConfig(manifest)) {
    throw new Error('Capture multi-aspect verification requires responseSchemaVerification');
  }
  const responseRecords = buildCaptureResponseSchemaVerificationRecords(manifest, candidateInputs);
  const requestedIds = new Set(config.candidateIds);
  const selectedRecords = requestedIds.size === 0
    ? responseRecords
    : responseRecords.filter((record) => requestedIds.has(record.candidate.id));
  if (selectedRecords.length === 0) {
    throw new Error('Capture multi-aspect verification requires matching response schema verification records');
  }
  for (const candidateId of requestedIds) {
    if (!selectedRecords.some((record) => record.candidate.id === candidateId)) {
      throw new Error(`Capture multi-aspect verification response schema record not found: ${candidateId}`);
    }
  }
  const decisionByCandidateId = new Map(decisionResults
    .map((result) => result?.decision)
    .filter((decision) => decision?.candidateId)
    .map((decision) => [decision.candidateId, decision]));

  return selectedRecords.map((record) => {
    const auth = createCaptureAuthVerificationResult(record.candidate, config);
    const pagination = createCapturePaginationVerificationResult(record.candidate, config);
    const risk = createCaptureRiskVerificationResult(record.candidate, config);
    return {
      candidate: record.candidate,
      siteAdapterDecision: decisionResults.length > 0
        ? decisionByCandidateId.get(record.candidate.id)
        : undefined,
      verificationResult: createApiCandidateMultiAspectVerificationResult({
        candidate: record.candidate,
        verifierId: config.verifierId,
        verifiedAt: config.verifiedAt,
        metadata: {
          source: 'capture.apiCandidateVerification',
          responseSchemaSource: 'capture.networkResponseSummaries',
          ...config.metadata,
        },
        verificationResults: {
          responseSchema: record.verificationResult,
          auth,
          pagination,
          risk,
        },
      }),
    };
  });
}

function preflightCaptureMultiAspectVerification(manifest) {
  if (!captureMultiAspectVerificationConfig(manifest)) {
    return;
  }
  buildCaptureMultiAspectVerificationRecords(manifest, manifest.networkRequests ?? []);
}

function summarizeCaptureResponseSchemaVerificationResults(results = []) {
  const summary = {
    count: 0,
    byStatus: {},
  };
  for (const result of results) {
    const status = String(result?.verificationResult?.status ?? 'unknown').trim() || 'unknown';
    summary.count += 1;
    summary.byStatus[status] = (summary.byStatus[status] ?? 0) + 1;
  }
  return summary;
}

async function writeCaptureResponseSchemaVerificationResults(manifest, candidateResults = []) {
  const records = buildCaptureResponseSchemaVerificationRecords(manifest, candidateResults);
  if (records.length === 0) {
    return [];
  }

  const manifestDir = path.dirname(manifest.files.manifest);
  const outputDir = manifest.files.apiResponseSchemaVerificationsDir
    ?? path.join(manifestDir, 'api-response-schema-verifications');
  const redactionAuditDir = manifest.files.apiResponseSchemaVerificationRedactionAuditsDir
    ?? path.join(manifestDir, 'api-response-schema-verification-redaction-audits');
  const results = [];
  for (const [index, record] of records.entries()) {
    const artifactName = responseSchemaVerificationArtifactName(index);
    results.push(await writeApiCandidateResponseVerificationResultArtifact(record.verificationResult, {
      verificationPath: path.join(outputDir, artifactName),
      redactionAuditPath: path.join(
        redactionAuditDir,
        artifactName.replace(/\.json$/u, '.redaction-audit.json'),
      ),
    }));
  }
  manifest.files.apiResponseSchemaVerificationsDir = outputDir;
  manifest.files.apiResponseSchemaVerificationRedactionAuditsDir = redactionAuditDir;
  manifest.files.apiResponseSchemaVerifications = results.map((result) => result.artifactPath);
  manifest.files.apiResponseSchemaVerificationRedactionAudits = results
    .map((result) => result.redactionAuditPath)
    .filter(Boolean);
  return results;
}

function summarizeCaptureVerifiedEvidenceResults(results = []) {
  const summary = {
    count: 0,
    byStatus: {},
    byEvidenceType: {},
  };
  for (const result of results) {
    const status = String(result?.evidence?.verification?.status ?? 'unknown').trim() || 'unknown';
    const evidenceType = String(
      result?.evidence?.verification?.metadata?.evidenceType ?? 'unknown'
    ).trim() || 'unknown';
    summary.count += 1;
    summary.byStatus[status] = (summary.byStatus[status] ?? 0) + 1;
    summary.byEvidenceType[evidenceType] = (summary.byEvidenceType[evidenceType] ?? 0) + 1;
  }
  return summary;
}

function normalizeCaptureRefArray(value) {
  return Array.isArray(value) ? value.filter((item) => normalizeCaptureLifecycleText(item)) : [];
}

function assertCaptureRefArrayPair(manifest, leftKey, rightKey, label) {
  const left = normalizeCaptureRefArray(manifest.files?.[leftKey]);
  const right = normalizeCaptureRefArray(manifest.files?.[rightKey]);
  if (left.length !== right.length) {
    throw new Error(`Capture ${label} refs require complete redaction audit pairs`);
  }
}

function assertCaptureRefValuePair(manifest, leftKey, rightKey, label) {
  const left = normalizeCaptureLifecycleText(manifest.files?.[leftKey]);
  const right = normalizeCaptureLifecycleText(manifest.files?.[rightKey]);
  if (Boolean(left) !== Boolean(right)) {
    throw new Error(`Capture ${label} refs require lifecycle event and redaction audit pair`);
  }
  if (left && right && path.resolve(left) === path.resolve(right)) {
    throw new Error(`Capture ${label} lifecycle event and redaction audit paths must be distinct`);
  }
}

function assertCaptureApiCandidateRefIntegrity(manifest) {
  assertCaptureRefArrayPair(manifest, 'apiCandidates', 'apiCandidateRedactionAudits', 'api candidate');
  assertCaptureRefArrayPair(manifest, 'apiCandidateDecisions', 'apiCandidateDecisionRedactionAudits', 'SiteAdapter decision');
  assertCaptureRefArrayPair(
    manifest,
    'apiCandidateCatalogUpgradeDecisions',
    'apiCandidateCatalogUpgradeDecisionRedactionAudits',
    'catalog upgrade decision',
  );
  assertCaptureRefArrayPair(
    manifest,
    'apiCandidateCatalogUpgradeDecisionLifecycleEvents',
    'apiCandidateCatalogUpgradeDecisionLifecycleEventRedactionAudits',
    'catalog upgrade decision lifecycle',
  );
  assertCaptureRefArrayPair(
    manifest,
    'apiResponseSchemaVerifications',
    'apiResponseSchemaVerificationRedactionAudits',
    'response schema verification',
  );
  assertCaptureRefArrayPair(
    manifest,
    'apiCandidateVerifiedEvidence',
    'apiCandidateVerifiedEvidenceRedactionAudits',
    'verified evidence',
  );
  assertCaptureRefArrayPair(
    manifest,
    'apiCandidateVerificationLifecycleEvents',
    'apiCandidateVerificationLifecycleEventRedactionAudits',
    'verified evidence lifecycle',
  );
  if (normalizeCaptureRefArray(manifest.files?.apiCandidates).length > 0) {
    assertCaptureRefValuePair(
      manifest,
      'apiCandidateLifecycleEvent',
      'apiCandidateLifecycleEventRedactionAudit',
      'api candidate lifecycle',
    );
  }
}

function buildCaptureApiCandidateDataFlowRefs(manifest, candidateResults = [], decisionResults = []) {
  const decisionsByCandidateId = new Map(decisionResults
    .filter((result) => result?.decision?.candidateId)
    .map((result) => [result.decision.candidateId, result]));
  return candidateResults.map((result, index) => {
    const candidateId = normalizeCaptureLifecycleText(result?.candidate?.id);
    const decision = decisionsByCandidateId.get(candidateId);
    return {
      index,
      apiCandidate: result?.artifactPath,
      apiCandidateRedactionAudit: result?.redactionAuditPath,
      apiCandidateLifecycleEvent: manifest.files.apiCandidateLifecycleEvent,
      apiCandidateLifecycleEventRedactionAudit: manifest.files.apiCandidateLifecycleEventRedactionAudit,
      siteAdapterDecision: decision?.artifactPath,
      siteAdapterDecisionRedactionAudit: decision?.redactionAuditPath,
      catalogUpgradeDecision: decision?.catalogUpgradeDecisionArtifactPath,
      catalogUpgradeDecisionRedactionAudit: decision?.catalogUpgradeDecisionRedactionAuditPath,
      catalogUpgradeDecisionLifecycleEvent: decision?.catalogUpgradeDecisionLifecycleEventPath,
      catalogUpgradeDecisionLifecycleEventRedactionAudit:
        decision?.catalogUpgradeDecisionLifecycleEventRedactionAuditPath,
    };
  });
}

function preflightCaptureApiCandidateDataFlow(manifest, {
  outputDir,
  decisionOutputDir,
  lifecycleEventPath,
  lifecycleEventRedactionAuditPath,
} = {}) {
  if (!Array.isArray(manifest.networkRequests) || manifest.networkRequests.length === 0) {
    return [];
  }
  assertCaptureRefValuePair({
    files: {
      apiCandidateLifecycleEvent: lifecycleEventPath,
      apiCandidateLifecycleEventRedactionAudit: lifecycleEventRedactionAuditPath,
    },
  }, 'apiCandidateLifecycleEvent', 'apiCandidateLifecycleEventRedactionAudit', 'api candidate lifecycle');

  return manifest.networkRequests.map((request, index) => {
    const candidate = apiCandidateFromObservedRequest(request);
    const adapter = resolveSiteAdapter({
      candidate,
      host: candidate.siteKey,
      inputUrl: candidate.endpoint?.url,
    });
    if (typeof adapter?.validateApiCandidate !== 'function') {
      throw annotateCaptureApiFailureRiskState(createApiDiscoveryFailure(
        'site-adapter-core-api-unidentified',
        `SiteAdapter could not identify a core API validation path for ${candidate.siteKey}`,
        {
          stage: 'capture-site-adapter-preflight',
          metadata: {
            candidateIndex: index,
            siteKey: candidate.siteKey,
            candidateArtifact: path.join(outputDir, captureApiCandidateArtifactName(index)),
          },
        },
      ), {
        manifest,
        scope: 'capture-site-adapter-preflight',
        siteKey: candidate.siteKey,
        taskId: `capture-api-candidate:${index}`,
      });
    }
    const candidateArtifact = path.join(outputDir, captureApiCandidateArtifactName(index));
    const siteAdapterDecisionArtifact = path.join(decisionOutputDir, captureApiCandidateDecisionArtifactName(index));
    const decision = validateApiCandidateWithAdapter(candidate, adapter, {
      validatedAt: manifest.capturedAt,
      scope: {
        validationMode: 'capture-observed-candidate',
        candidateArtifact,
      },
      evidence: {
        source: 'capture-api-candidate-artifact',
        artifactPath: candidateArtifact,
      },
    });
    if (typeof adapter.getApiCatalogUpgradePolicy === 'function') {
      adapter.getApiCatalogUpgradePolicy({
        candidate,
        siteAdapterDecision: decision,
        decidedAt: manifest.capturedAt,
        scope: {
          validationMode: 'capture-observed-candidate',
          candidateArtifact,
          siteAdapterDecisionArtifact,
        },
        evidence: {
          source: 'capture-api-candidate-artifact',
          candidateArtifact,
          siteAdapterDecisionArtifact,
        },
      });
    }
    return candidate;
  });
}

async function writeCaptureMultiAspectVerificationEvidence(manifest, candidateResults = [], decisionResults = []) {
  const records = buildCaptureMultiAspectVerificationRecords(manifest, candidateResults, decisionResults);
  if (records.length === 0) {
    return [];
  }

  const manifestDir = path.dirname(manifest.files.manifest);
  const outputDir = manifest.files.apiCandidateVerifiedEvidenceDir
    ?? path.join(manifestDir, 'api-candidate-verified-evidence');
  const redactionAuditDir = manifest.files.apiCandidateVerifiedEvidenceRedactionAuditsDir
    ?? path.join(manifestDir, 'api-candidate-verified-evidence-redaction-audits');
  const lifecycleEventOutputDir = manifest.files.apiCandidateVerificationLifecycleEventsDir
    ?? path.join(manifestDir, 'api-candidate-verification-lifecycle-events');
  const lifecycleEventRedactionAuditDir = manifest.files.apiCandidateVerificationLifecycleEventRedactionAuditsDir
    ?? path.join(manifestDir, 'api-candidate-verification-lifecycle-event-redaction-audits');
  const lifecycleContext = captureLifecycleContext(manifest);
  const results = await writeManualApiCandidateVerificationArtifacts(records, {
    outputDir,
    redactionAuditDir,
    lifecycleEventOutputDir,
    lifecycleEventRedactionAuditDir,
    lifecycleEventTraceId: lifecycleContext.traceId,
    lifecycleEventCorrelationId: lifecycleContext.correlationId,
    lifecycleEventTaskType: lifecycleContext.taskType,
    lifecycleEventAdapterVersion: lifecycleContext.adapterVersion,
  });
  manifest.files.apiCandidateVerifiedEvidenceDir = outputDir;
  manifest.files.apiCandidateVerifiedEvidenceRedactionAuditsDir = redactionAuditDir;
  manifest.files.apiCandidateVerificationLifecycleEventsDir = lifecycleEventOutputDir;
  manifest.files.apiCandidateVerificationLifecycleEventRedactionAuditsDir = lifecycleEventRedactionAuditDir;
  manifest.files.apiCandidateVerifiedEvidence = results.map((result) => result.artifactPath);
  manifest.files.apiCandidateVerifiedEvidenceRedactionAudits = results
    .map((result) => result.redactionAuditPath)
    .filter(Boolean);
  manifest.files.apiCandidateVerificationLifecycleEvents = results
    .map((result) => result.lifecycleEventPath)
    .filter(Boolean);
  manifest.files.apiCandidateVerificationLifecycleEventRedactionAudits = results
    .map((result) => result.lifecycleEventRedactionAuditPath)
    .filter(Boolean);
  return results;
}

async function writeCaptureApiCandidates(manifest, {
  capabilityHookRegistry = undefined,
  capabilityHooks = undefined,
} = {}) {
  if (!Array.isArray(manifest.networkRequests) || manifest.networkRequests.length === 0) {
    return [];
  }

  const manifestDir = path.dirname(manifest.files.manifest);
  const outputDir = manifest.files.apiCandidatesDir ?? path.join(manifestDir, 'api-candidates');
  const redactionAuditDir = manifest.files.apiCandidateRedactionAuditsDir
    ?? path.join(manifestDir, 'api-candidate-redaction-audits');
  const lifecycleEventPath = manifest.files.apiCandidateLifecycleEvent
    ?? path.join(manifestDir, 'api-candidates-lifecycle-event.json');
  const lifecycleEventRedactionAuditPath = manifest.files.apiCandidateLifecycleEventRedactionAudit
    ?? path.join(manifestDir, 'api-candidates-lifecycle-event-redaction-audit.json');
  const decisionOutputDir = manifest.files.apiCandidateDecisionsDir
    ?? path.join(manifestDir, 'api-candidate-decisions');
  try {
    preflightCaptureApiCandidateDataFlow(manifest, {
      outputDir,
      decisionOutputDir,
      lifecycleEventPath,
      lifecycleEventRedactionAuditPath,
    });
  } catch (error) {
    throw annotateCaptureApiFailureRiskState(error, {
      manifest,
      scope: 'capture-api-candidate-preflight',
    });
  }
  let results;
  try {
    results = await writeApiCandidateArtifactsFromCaptureOutput({
      networkRequests: manifest.networkRequests,
    }, {
      outputDir,
      redactionAuditDir,
    });
  } catch (error) {
    throw annotateCaptureApiFailureRiskState(error, {
      manifest,
      scope: 'capture-api-candidate-generation',
    });
  }
  manifest.files.apiCandidatesDir = outputDir;
  manifest.files.apiCandidateRedactionAuditsDir = redactionAuditDir;
  manifest.files.apiCandidates = results.map((result) => result.artifactPath);
  manifest.files.apiCandidateRedactionAudits = results.map((result) => result.redactionAuditPath).filter(Boolean);
  let decisionResults;
  try {
    decisionResults = await writeCaptureApiCandidateAdapterDecisions(manifest, results);
  } catch (error) {
    throw annotateCaptureApiFailureRiskState(error, {
      manifest,
      scope: 'capture-site-adapter-decision',
    });
  }
  const responseSchemaVerificationResults = await writeCaptureResponseSchemaVerificationResults(manifest, results);
  const multiAspectVerificationResults = await writeCaptureMultiAspectVerificationEvidence(
    manifest,
    results,
    decisionResults,
  );
  manifest.files.apiCandidateLifecycleEvent = lifecycleEventPath;
  manifest.files.apiCandidateLifecycleEventRedactionAudit = lifecycleEventRedactionAuditPath;
  assertCaptureApiCandidateRefIntegrity(manifest);
  manifest.apiCandidateDataFlowRefs = buildCaptureApiCandidateDataFlowRefs(manifest, results, decisionResults);
  let apiCandidateLifecycleEvent = normalizeLifecycleEvent({
    eventType: 'capture.api_candidates.written',
    ...captureLifecycleContext(manifest),
    taskId: manifest.files.manifest,
    siteKey: resolveCaptureLifecycleSiteKey(manifest),
    createdAt: manifest.capturedAt,
    details: {
      status: manifest.status,
      count: results.length,
      apiCandidates: manifest.files.apiCandidates,
      apiCandidateRedactionAudits: manifest.files.apiCandidateRedactionAudits,
      apiCandidateDecisions: manifest.files.apiCandidateDecisions ?? [],
      apiCandidateDecisionRedactionAudits: manifest.files.apiCandidateDecisionRedactionAudits ?? [],
      apiCandidateDecisionSummary: summarizeCaptureDecisionResults(decisionResults),
      apiCandidateRiskStates: captureApiDecisionRiskStateSummaries(decisionResults, {
        observedAt: manifest.capturedAt,
      }),
      apiCandidateCatalogUpgradeDecisions: manifest.files.apiCandidateCatalogUpgradeDecisions ?? [],
      apiCandidateCatalogUpgradeDecisionRedactionAudits:
        manifest.files.apiCandidateCatalogUpgradeDecisionRedactionAudits ?? [],
      apiCandidateCatalogUpgradeDecisionLifecycleEvents:
        manifest.files.apiCandidateCatalogUpgradeDecisionLifecycleEvents ?? [],
      apiCandidateCatalogUpgradeDecisionLifecycleEventRedactionAudits:
        manifest.files.apiCandidateCatalogUpgradeDecisionLifecycleEventRedactionAudits ?? [],
      apiCandidateCatalogUpgradeDecisionSummary:
        summarizeCaptureCatalogUpgradeDecisionResults(decisionResults),
      apiCandidateCatalogUpgradeRiskStates: captureApiCatalogUpgradeRiskStateSummaries(decisionResults, {
        observedAt: manifest.capturedAt,
      }),
      apiResponseSchemaVerifications: manifest.files.apiResponseSchemaVerifications ?? [],
      apiResponseSchemaVerificationRedactionAudits:
        manifest.files.apiResponseSchemaVerificationRedactionAudits ?? [],
      apiResponseSchemaVerificationSummary:
        summarizeCaptureResponseSchemaVerificationResults(responseSchemaVerificationResults),
      apiCandidateVerifiedEvidence: manifest.files.apiCandidateVerifiedEvidence ?? [],
      apiCandidateVerifiedEvidenceRedactionAudits:
        manifest.files.apiCandidateVerifiedEvidenceRedactionAudits ?? [],
      apiCandidateVerificationLifecycleEvents:
        manifest.files.apiCandidateVerificationLifecycleEvents ?? [],
      apiCandidateVerificationLifecycleEventRedactionAudits:
        manifest.files.apiCandidateVerificationLifecycleEventRedactionAudits ?? [],
      apiCandidateVerifiedEvidenceSummary:
        summarizeCaptureVerifiedEvidenceResults(multiAspectVerificationResults),
      apiCandidateDataFlowRefs: manifest.apiCandidateDataFlowRefs,
    },
  });
  const capabilityHookMatches = capabilityHookMatchSummaryForLifecycleEvent(apiCandidateLifecycleEvent, {
    capabilityHookRegistry,
    capabilityHooks,
  });
  if (capabilityHookMatches) {
    apiCandidateLifecycleEvent = normalizeLifecycleEvent({
      ...apiCandidateLifecycleEvent,
      details: {
        ...apiCandidateLifecycleEvent.details,
        capabilityHookMatches,
      },
    });
  }
  assertSchemaCompatible('LifecycleEvent', apiCandidateLifecycleEvent);
  await dispatchLifecycleEvent(apiCandidateLifecycleEvent, {
    subscribers: [
      createLifecycleArtifactWriterSubscriber({
        eventPath: manifest.files.apiCandidateLifecycleEvent,
        auditPath: manifest.files.apiCandidateLifecycleEventRedactionAudit,
      }),
    ],
  });
  return {
    candidates: results,
    decisions: decisionResults,
  };
}

function normalizeCaptureLifecycleText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function captureLifecycleContext(manifest = {}) {
  const traceId = normalizeCaptureLifecycleText(manifest.traceId ?? manifest.runId)
    ?? `capture:${normalizeCaptureLifecycleText(manifest.capturedAt) ?? 'unknown-time'}`;
  return {
    traceId,
    correlationId: normalizeCaptureLifecycleText(manifest.correlationId ?? manifest.taskId ?? traceId),
    taskType: normalizeCaptureLifecycleText(manifest.taskType) ?? 'capture',
    adapterVersion: normalizeCaptureLifecycleText(manifest.adapterVersion) ?? 'capture-stage-v1',
  };
}

function resolveCaptureLifecycleSiteKey(manifest = {}) {
  const explicit = normalizeCaptureLifecycleText(
    manifest.siteKey
      ?? manifest.siteProfile?.siteKey
      ?? manifest.networkRequests?.find((request) => request?.siteKey)?.siteKey,
  );
  if (explicit) {
    return explicit;
  }
  for (const value of [manifest.finalUrl, manifest.inputUrl]) {
    try {
      const host = new URL(String(value ?? '')).hostname;
      const normalized = normalizeCaptureLifecycleText(host);
      if (normalized) {
        return normalized;
      }
    } catch {
      // Keep invalid capture inputs fail-closed through the lifecycle producer guard.
    }
  }
  return 'unknown-site';
}

async function writeManifest(manifest, {
  lifecycleEventSubscribers = [],
  capabilityHookRegistry = undefined,
  capabilityHooks = undefined,
} = {}) {
  const manifestDir = path.dirname(manifest.files.manifest);
  const redactionAuditPath = path.join(manifestDir, 'redaction-audit.json');
  const lifecycleEventPath = path.join(manifestDir, 'lifecycle-event.json');
  const lifecycleEventRedactionAuditPath = path.join(manifestDir, 'lifecycle-event-redaction-audit.json');
  manifest.files.redactionAudit = manifest.files.redactionAudit ?? redactionAuditPath;
  manifest.files.lifecycleEvent = manifest.files.lifecycleEvent ?? lifecycleEventPath;
  manifest.files.lifecycleEventRedactionAudit = manifest.files.lifecycleEventRedactionAudit ?? lifecycleEventRedactionAuditPath;
  setManifestNetworkResponseSummaries(manifest, manifest.networkResponseSummaries);
  preflightCaptureResponseSchemaVerification(manifest);
  preflightCaptureMultiAspectVerification(manifest);
  await writeCaptureApiCandidates(manifest, {
    capabilityHookRegistry,
    capabilityHooks,
  });
  let lifecycleEvent = normalizeLifecycleEvent({
    eventType: 'capture.manifest.written',
    ...captureLifecycleContext(manifest),
    taskId: manifest.files.manifest,
    siteKey: resolveCaptureLifecycleSiteKey(manifest),
    reasonCode: manifest.error?.code,
    createdAt: manifest.capturedAt,
    details: {
      status: manifest.status,
      inputUrl: manifest.inputUrl,
      finalUrl: manifest.finalUrl,
      errorCode: manifest.error?.code,
    },
  });
  const capabilityHookMatches = capabilityHookMatchSummaryForLifecycleEvent(lifecycleEvent, {
    capabilityHookRegistry,
    capabilityHooks,
  });
  if (capabilityHookMatches) {
    lifecycleEvent = normalizeLifecycleEvent({
      ...lifecycleEvent,
      details: {
        ...lifecycleEvent.details,
        capabilityHookMatches,
      },
    });
  }
  assertSchemaCompatible('LifecycleEvent', lifecycleEvent);
  await dispatchLifecycleEvent(lifecycleEvent, {
    subscribers: composeLifecycleSubscribers(
      lifecycleEventSubscribers,
      createLifecycleArtifactWriterSubscriber({
        eventPath: manifest.files.lifecycleEvent,
        auditPath: manifest.files.lifecycleEventRedactionAudit,
      }),
    ),
  });
  const { json, auditJson } = prepareRedactedArtifactJsonWithAudit(manifest);
  await writeFile(manifest.files.manifest, json, 'utf8');
  await writeFile(manifest.files.redactionAudit, auditJson, 'utf8');
}

async function createOutputLayout(inputUrl, outDir) {
  let parsedUrl = null;
  try {
    parsedUrl = new URL(inputUrl);
  } catch {
    // Keep a stable output directory for invalid input too.
  }

  const capturedAt = new Date().toISOString();
  const dirTimestamp = formatTimestampForDir(new Date(capturedAt));
  const host = sanitizeHost(parsedUrl?.hostname ?? 'invalid-url');
  const captureDir = path.resolve(outDir, `${dirTimestamp}_${host}`);
  await mkdir(captureDir, { recursive: true });

  return {
    outDir: captureDir,
    capturedAt,
    traceId: `capture:${dirTimestamp}:${host}`,
    correlationId: `capture:${host}`,
    htmlPath: path.join(captureDir, 'page.html'),
    snapshotPath: path.join(captureDir, 'dom-snapshot.json'),
    screenshotPath: path.join(captureDir, 'screenshot.png'),
    manifestPath: path.join(captureDir, 'manifest.json'),
  };
}

function mergeOptions(inputUrl = '', options = {}) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...options,
    viewport: {
      ...DEFAULT_OPTIONS.viewport,
      ...(options.viewport ?? {}),
    },
  };

  merged.outDir = path.resolve(merged.outDir);
  if (merged.profilePath) {
    merged.profilePath = path.resolve(merged.profilePath);
  }
  if (merged.browserProfileRoot) {
    merged.browserProfileRoot = path.resolve(merged.browserProfileRoot);
  }
  if (merged.userDataDir) {
    merged.userDataDir = path.resolve(merged.userDataDir);
  }
  if (!Object.prototype.hasOwnProperty.call(options, 'headless')) {
    merged.headless = resolveCaptureHeadlessDefault(inputUrl, DEFAULT_OPTIONS.headless, merged.siteProfile);
  }
  merged.timeoutMs = normalizeNumber(merged.timeoutMs, 'timeoutMs');
  merged.idleMs = normalizeNumber(merged.idleMs, 'idleMs');
  merged.headless = normalizeBoolean(merged.headless, 'headless');
  merged.fullPage = normalizeBoolean(merged.fullPage, 'fullPage');
  if (merged.reuseLoginState !== undefined) {
    merged.reuseLoginState = normalizeBoolean(merged.reuseLoginState, 'reuseLoginState');
  }
  if (merged.autoLogin !== undefined) {
    merged.autoLogin = normalizeBoolean(merged.autoLogin, 'autoLogin');
  }
  merged.waitUntil = normalizeWaitUntil(merged.waitUntil);
  merged.viewport = {
    width: normalizeNumber(merged.viewport.width, 'viewport.width'),
    height: normalizeNumber(merged.viewport.height, 'viewport.height'),
    deviceScaleFactor: normalizeNumber(merged.viewport.deviceScaleFactor, 'viewport.deviceScaleFactor'),
  };

  return merged;
}

export function resolveCaptureSettings(inputUrl, options = {}) {
  return {
    inputUrl,
    settings: mergeOptions(inputUrl, options),
  };
}

function buildCaptureWaitPolicy(settings) {
  return {
    useLoadEvent: true,
    useNetworkIdle: settings.waitUntil === 'networkidle',
    networkQuietMs: NETWORK_IDLE_QUIET_MS,
    networkIdleTimeoutMs: settings.timeoutMs,
    documentReadyTimeoutMs: settings.timeoutMs,
    domQuietTimeoutMs: settings.timeoutMs,
    idleMs: settings.idleMs,
  };
}

async function createCaptureSession(settings, inputUrl) {
  if (typeof settings.runtimeFactory === 'function') {
    return await settings.runtimeFactory(settings, {
      inputUrl,
      purpose: 'capture',
    });
  }

  const authContext = await resolveSiteBrowserSessionOptions(inputUrl, settings, {
    profilePath: settings.profilePath,
    siteProfile: settings.siteProfile,
  });
  const usePersistentProfile = shouldUsePersistentProfileForNavigation(inputUrl, settings, authContext);
  const session = await openBrowserSession({
    ...settings,
    userDataDir: usePersistentProfile ? authContext.userDataDir : null,
    cleanupUserDataDirOnShutdown: usePersistentProfile ? authContext.cleanupUserDataDirOnShutdown : true,
    startupUrl: inputUrl,
  }, {
    userDataDirPrefix: 'capture-browser-',
  });
  const shouldEnsureAuth = shouldEnsureAuthenticatedNavigationSession(inputUrl, settings, authContext);
  if (shouldEnsureAuth) {
    session.siteAuth = await ensureAuthenticatedSession(session, inputUrl, settings, {
      authContext,
    });
  }
  return session;
}

export async function openInitialPage(session, settings) {
  const parsedUrl = new URL(settings.inputUrl);
  await session.navigateAndWait(parsedUrl.toString(), buildCaptureWaitPolicy(settings));
  return parsedUrl;
}

export async function capturePageEvidence(session, policy) {
  const result = {
    evidence: {},
    artifactCount: 0,
    warnings: [],
    errors: [],
  };

  try {
    result.evidence.html = await session.captureHtml();
    result.artifactCount += 1;
  } catch (error) {
    result.errors.push(createError('HTML_CAPTURE_FAILED', error.message));
  }

  try {
    result.evidence.snapshot = await session.captureSnapshot();
    result.artifactCount += 1;
  } catch (error) {
    result.errors.push(createError('SNAPSHOT_CAPTURE_FAILED', error.message));
  }

  try {
    const screenshot = await session.captureScreenshot({
      fullPage: policy.fullPage,
      allowViewportFallback: true,
    });
    result.evidence.screenshotBase64 = screenshot.data;
    result.artifactCount += 1;
    if (screenshot.usedViewportFallback) {
      result.warnings.push(
        createError(
          'SCREENSHOT_FALLBACK',
          `Full-page screenshot failed and viewport screenshot was used instead: ${screenshot.primaryError?.message ?? 'unknown error'}`,
        ),
      );
    }
  } catch (error) {
    result.errors.push(createError('SCREENSHOT_CAPTURE_FAILED', error.message));
  }

  return result;
}

export async function writeCaptureArtifacts(layout, captureResult) {
  const writes = [];
  if (Object.prototype.hasOwnProperty.call(captureResult.evidence, 'html')) {
    writes.push(writeFile(layout.htmlPath, captureResult.evidence.html ?? '', 'utf8'));
  }
  if (Object.prototype.hasOwnProperty.call(captureResult.evidence, 'snapshot')) {
    writes.push(writeFile(layout.snapshotPath, JSON.stringify(captureResult.evidence.snapshot, null, 2), 'utf8'));
  }
  if (captureResult.evidence.screenshotBase64) {
    writes.push(writeFile(layout.screenshotPath, Buffer.from(captureResult.evidence.screenshotBase64, 'base64')));
  }
  await Promise.all(writes);
}

export async function writeCaptureManifest(manifest, options = {}) {
  await writeManifest(manifest, options);
}

export async function capture(inputUrl, options = {}) {
  const { settings } = resolveCaptureSettings(inputUrl, options);
  settings.inputUrl = inputUrl;

  const layout = await createOutputLayout(inputUrl, settings.outDir);
  const manifest = buildManifest({
    inputUrl,
    capturedAt: layout.capturedAt,
    outDir: layout.outDir,
    htmlPath: layout.htmlPath,
    snapshotPath: layout.snapshotPath,
    screenshotPath: layout.screenshotPath,
    manifestPath: layout.manifestPath,
    traceId: layout.traceId,
    correlationId: layout.correlationId,
    viewport: settings.viewport,
  });

  let artifactCount = 0;
  let parsedUrl;

  try {
    try {
      parsedUrl = new URL(inputUrl);
    } catch {
      setManifestError(manifest, 'INVALID_INPUT', `Invalid URL: ${inputUrl}`);
      await writeCaptureManifest(manifest);
      return manifest;
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let session = null;
      try {
        session = await createCaptureSession(settings, inputUrl);
        await openInitialPage(session, settings);

        const runtimeInspection = await inspectCaptureRuntime(session, inputUrl, settings.siteProfile);
        if (runtimeInspection.pageFacts) {
          manifest.pageFacts = runtimeInspection.pageFacts;
        }
        if (runtimeInspection.runtimeEvidence) {
          manifest.runtimeEvidence = runtimeInspection.runtimeEvidence;
        }
        if (runtimeInspection.error) {
          setManifestError(manifest, runtimeInspection.error.code, runtimeInspection.error.message);
        }

        const captureResult = await capturePageEvidence(session, {
          fullPage: settings.fullPage,
        });
        artifactCount = captureResult.artifactCount;
        await writeCaptureArtifacts(layout, captureResult);

        for (const warning of captureResult.warnings) {
          setManifestError(manifest, warning.code, warning.message);
        }
        for (const error of captureResult.errors) {
          setManifestError(manifest, error.code, error.message);
        }

        try {
          const metadata = await session.getPageMetadata(parsedUrl.toString());
          manifest.finalUrl = metadata.finalUrl ?? parsedUrl.toString();
          manifest.title = metadata.title ?? '';
          if (typeof metadata.viewportWidth === 'number' && typeof metadata.viewportHeight === 'number') {
            manifest.page.viewportWidth = metadata.viewportWidth;
            manifest.page.viewportHeight = metadata.viewportHeight;
          }
        } catch (error) {
          manifest.finalUrl = parsedUrl.toString();
          manifest.title = manifest.title ?? '';
          setManifestError(manifest, 'PAGE_METADATA_FAILED', error.message);
        }

        manifest.status = manifest.error ? (artifactCount > 0 ? 'partial' : 'failed') : 'success';
        await attachObservedNetworkRequests(manifest, session, settings, inputUrl);
        await attachObservedNetworkResponseSummaries(manifest, session, settings, inputUrl);
        await writeCaptureManifest(manifest);
        await closeSessionQuietly(session);
        return manifest;
      } catch (error) {
        await closeSessionQuietly(session);
        const shouldRetry = attempt === 0 && isTransientCaptureBootstrapError(error);
        if (shouldRetry) {
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    setManifestError(manifest, error?.code ?? 'CAPTURE_FAILED', error.message);
    manifest.finalUrl = parsedUrl?.toString?.() ?? inputUrl;
    manifest.title = manifest.title ?? '';
    manifest.status = artifactCount > 0 ? 'partial' : 'failed';
    try {
      await writeCaptureManifest(manifest);
    } catch {
      // Preserve the original failure for the caller.
    }
    return manifest;
  }
}

export function parseCliArgs(argv) {
  const args = [...argv];
  const options = {};
  let url = null;

  const readValue = (current, index) => {
    const eqIndex = current.indexOf('=');
    if (eqIndex !== -1) {
      return { value: current.slice(eqIndex + 1), nextIndex: index };
    }
    if (index + 1 >= args.length) {
      throw new Error(`Missing value for ${current}`);
    }
    return { value: args[index + 1], nextIndex: index + 1 };
  };

  const readOptionalBooleanValue = (current, index) => {
    const eqIndex = current.indexOf('=');
    if (eqIndex !== -1) {
      return { value: current.slice(eqIndex + 1), nextIndex: index };
    }
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      return { value: next, nextIndex: index + 1 };
    }
    return { value: true, nextIndex: index };
  };

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith('--')) {
      if (url) {
        throw new Error(`Unexpected positional argument: ${current}`);
      }
      url = current;
      continue;
    }

    if (current === '--help' || current === '-h') {
      options.help = true;
      continue;
    }

    const progressOption = parseProgressCliOption(args, current, index, options);
    if (progressOption.handled) {
      index = progressOption.nextIndex;
      continue;
    }

    if (current.startsWith('--out-dir')) {
      const { value, nextIndex } = readValue(current, index);
      options.outDir = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--browser-path')) {
      const { value, nextIndex } = readValue(current, index);
      options.browserPath = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--profile-path')) {
      const { value, nextIndex } = readValue(current, index);
      options.profilePath = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--browser-profile-root')) {
      const { value, nextIndex } = readValue(current, index);
      options.browserProfileRoot = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--user-data-dir')) {
      const { value, nextIndex } = readValue(current, index);
      options.userDataDir = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--timeout')) {
      const { value, nextIndex } = readValue(current, index);
      options.timeoutMs = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--wait-until')) {
      const { value, nextIndex } = readValue(current, index);
      options.waitUntil = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--idle-ms')) {
      const { value, nextIndex } = readValue(current, index);
      options.idleMs = value;
      index = nextIndex;
      continue;
    }

    if (current === '--full-page' || current.startsWith('--full-page=')) {
      const { value, nextIndex } = readOptionalBooleanValue(current, index);
      options.fullPage = value;
      index = nextIndex;
      continue;
    }

    if (current === '--no-full-page') {
      options.fullPage = false;
      continue;
    }

    if (current === '--headless' || current.startsWith('--headless=')) {
      const { value, nextIndex } = readOptionalBooleanValue(current, index);
      options.headless = value;
      index = nextIndex;
      continue;
    }

    if (current === '--no-headless') {
      options.headless = false;
      continue;
    }

    if (current === '--reuse-login-state' || current.startsWith('--reuse-login-state=')) {
      const { value, nextIndex } = readOptionalBooleanValue(current, index);
      options.reuseLoginState = value;
      index = nextIndex;
      continue;
    }

    if (current === '--no-reuse-login-state') {
      options.reuseLoginState = false;
      continue;
    }

    if (current === '--auto-login' || current.startsWith('--auto-login=')) {
      const { value, nextIndex } = readOptionalBooleanValue(current, index);
      options.autoLogin = value;
      index = nextIndex;
      continue;
    }

    if (current === '--no-auto-login') {
      options.autoLogin = false;
      continue;
    }

    throw new Error(`Unknown option: ${current}`);
  }

  return { url, options };
}

export function printHelp() {
  const helpText = `Usage:
  node src/entrypoints/pipeline/capture.mjs <url> [options]

Options:
  --out-dir <path>         Output root directory
  --browser-path <path>    Explicit Chromium/Chrome executable path
  --profile-path <path>    Explicit site profile for auth/session defaults
  --browser-profile-root <path> Root directory for persistent browser profiles
  --user-data-dir <path>   Explicit Chromium user-data-dir to reuse
  --timeout <ms>           Overall timeout for CDP operations
  --wait-until <mode>      load | networkidle
  --idle-ms <ms>           Extra delay after readiness before capture
  --full-page              Force full-page screenshot
  --no-full-page           Disable full-page screenshot
  --reuse-login-state      Reuse a persistent per-site browser profile
  --no-reuse-login-state   Disable persistent login-state reuse
  --auto-login             Best-effort credential login when credentials exist
  --no-auto-login          Disable credential auto-login
  --headless               Run browser headless (default except visible-by-default Douyin and Xiaohongshu flows)
  --no-headless            Run browser with a visible window
  --json                   Keep stdout as JSON and suppress progress
  --quiet                  Suppress human progress on stderr
  --progress <mode>        auto | interactive | plain
  --force-tty              Force interactive progress
  --no-tty                 Force plain progress
  --help                   Show this help
`;

  process.stdout.write(helpText);
}

export async function runCli() {
  initializeCliUtf8();
  try {
    const { url, options } = parseCliArgs(process.argv.slice(2));
    if (options.help || !url) {
      printHelp();
      process.exitCode = options.help ? 0 : 1;
      return;
    }

    const manifest = await runSingleStageCliWithProgress({
      inputUrl: url,
      options,
      taskId: 'capture',
      title: pipelineStageTitle('capture'),
      stageId: 'capture',
      run: (stageOptions) => capture(url, stageOptions),
      successMessage: (result) => result?.files?.manifest ?? result?.outDir,
      artifacts: (result) => [
        result?.files?.manifest ? { label: 'manifest', path: result.files.manifest } : null,
        result?.outDir ? { label: 'capture', path: result.outDir } : null,
      ].filter(Boolean),
      isFailureResult: (result) => result?.status !== 'success',
      failureReason: (result) => result?.error?.message ?? result?.status ?? 'Capture failed',
      failureTitle: 'Capture failed',
      nextStep: `node src/entrypoints/cli.mjs site doctor ${url} --no-headless --reuse-login-state`,
    });
    process.stdout.write(`${JSON.stringify(summarizeForStdout(manifest), null, 2)}\n`);

    if (manifest.status !== 'success') {
      if (manifest.error) {
        process.stderr.write(`${manifest.error.code}: ${manifest.error.message}\n`);
      }
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
