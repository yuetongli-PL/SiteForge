// @ts-check

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  API_CANDIDATE_SCHEMA_VERSION,
  assertSiteAdapterCandidateDecisionCompatible,
  createApiCandidateMultiAspectVerificationResultFromFixtures,
  normalizeSiteAdapterCandidateDecision,
  verifyApiCandidateForCatalog,
  writeApiCatalogUpgradeDecisionArtifact,
  writeApiCandidateArtifact,
  writeApiCandidateVerificationEvidenceArtifact,
} from './api-candidates.mjs';
import { reasonCodeSummary, requireReasonCodeDefinition } from '../risks/reason-codes.mjs';
import {
  redactBody,
  redactHeaders,
  redactUrl,
  redactValue,
  isSensitiveFieldName,
  prepareRedactedArtifactJsonWithAudit,
} from '../sessions/security-guard.mjs';

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function normalizeToken(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || undefined;
}

function parseObservedUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** @param {Record<string, any>} options */
function canonicalEndpointKey({ siteKey, method, url }) {
  const parsed = parseObservedUrl(url);
  const normalizedMethod = normalizeText(method)?.toUpperCase() ?? 'GET';
  if (!parsed) {
    return `${siteKey}:${normalizedMethod}:unknown-endpoint`;
  }
  return `${siteKey}:${normalizedMethod}:${parsed.hostname}${parsed.pathname}`;
}

/** @param {Record<string, any>} options */
function canonicalEndpointPathKey({ siteKey, url }) {
  const parsed = parseObservedUrl(url);
  if (!parsed) {
    return `${siteKey}:unknown-endpoint`;
  }
  return `${siteKey}:${parsed.hostname}${parsed.pathname}`;
}

function isSensitiveQueryKeyName(key) {
  const normalized = normalizeToken(key);
  return !normalized
    || isSensitiveFieldName(normalized)
    || /^(?:auth|sid|sessdata|csrf|xsrf|secret|password)$/iu.test(normalized)
    || /(?:^|[_-])(?:access|refresh)?[_-]?token$/iu.test(normalized)
    || /(?:^|[_-])session(?:[_-]?id)?$/iu.test(normalized)
    || /^xsec[_-]?token$/iu.test(normalized);
}

/**
 * @param {Record<string, any>} parsedUrl
 * @param {Record<string, any>} options
 */
function queryShape(parsedUrl, { includeSensitive = false } = {}) {
  if (!parsedUrl) {
    return [];
  }
  return [...new Set([...parsedUrl.searchParams.keys()]
    .map(normalizeToken)
    .filter(Boolean)
    .filter((key) => includeSensitive || !isSensitiveQueryKeyName(key)))]
    .sort();
}

/** @param {Record<string, any>} options */
function inferEndpointKind({ url, method, resourceType, body }) {
  const parsed = parseObservedUrl(url);
  const path = String(parsed?.pathname ?? url ?? '').toLowerCase();
  const transport = inferTransport({ method, resourceType, url });
  if (transport === 'websocket') {
    return 'websocket-endpoint';
  }
  if (transport === 'sse') {
    return 'sse-endpoint';
  }
  if (transport === 'preflight') {
    return 'preflight-endpoint';
  }
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  if (path.includes('graphql') || /\bquery\b|\bmutation\b/u.test(bodyText)) {
    return /mutation/u.test(bodyText) ? 'graphql-mutation' : 'graphql-query';
  }
  if (/\.m3u8$|\.mpd$|playurl|manifest|dash/iu.test(path)) {
    return 'media-manifest';
  }
  if (/download|resource|file/iu.test(path)) {
    return 'download-resource';
  }
  if (method?.toUpperCase() === 'POST' && !bodyText.startsWith('{')) {
    return 'form-post';
  }
  if (/xhr|fetch/iu.test(String(resourceType ?? '')) || /\/api\/|\.json$/iu.test(path)) {
    return 'rest-json';
  }
  return 'unknown';
}

/** @param {Record<string, any>} options */
function inferTransport({ method, resourceType, url }) {
  const normalizedMethod = normalizeText(method)?.toUpperCase() ?? 'GET';
  const normalizedResourceType = String(resourceType ?? '').toLowerCase();
  const rawUrl = String(url ?? '').trim().toLowerCase();
  if (normalizedResourceType === 'websocket' || rawUrl.startsWith('ws:') || rawUrl.startsWith('wss:')) {
    return 'websocket';
  }
  if (normalizedResourceType === 'eventsource') {
    return 'sse';
  }
  if (normalizedMethod === 'OPTIONS' || normalizedResourceType === 'preflight') {
    return 'preflight';
  }
  return 'http';
}

/** @param {Record<string, any>} options */
function inferRoleHint({ url, endpointKind }) {
  const parsed = parseObservedUrl(url);
  const text = `${parsed?.pathname ?? url ?? ''} ${parsed?.search ?? ''}`.toLowerCase();
  if (/search|query|keyword|q=/u.test(text)) {
    return 'search';
  }
  if (/cursor|page|offset|limit|next/u.test(text)) {
    return 'pagination';
  }
  if (/detail|item|content|book|work|video/u.test(text)) {
    return 'detail';
  }
  if (/author|user|profile|creator/u.test(text)) {
    return 'relation';
  }
  if (/media|playurl|manifest|download|resource/u.test(text) || endpointKind === 'media-manifest') {
    return 'media-resolve';
  }
  if (/login|auth|session/u.test(text)) {
    return 'auth/session';
  }
  if (/risk|verify|captcha|challenge|permission/u.test(text)) {
    return 'risk';
  }
  return 'unknown';
}

function inferParameterShape(parsedUrl, body) {
  const rawQueryKeys = queryShape(parsedUrl, { includeSensitive: true });
  const queryKeys = queryShape(parsedUrl);
  const bodyObject = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  const bodyKeys = bodyObject ? Object.keys(bodyObject).map(normalizeToken).filter(Boolean).sort() : [];
  const shapes = [];
  if (rawQueryKeys.length) {
    shapes.push('query-template');
  }
  if (bodyKeys.length) {
    shapes.push('body-template');
  }
  if (queryKeys.some((key) => /cursor|next|page|offset|limit/u.test(key))) {
    shapes.push('pagination-parameter');
  }
  if (queryKeys.some((key) => /doc-id|doc_id|operation|operation-name/u.test(key)) || bodyKeys.some((key) => /doc-id|doc_id|operation/u.test(key))) {
    shapes.push('operation-identifier');
  }
  return shapes.length ? [...new Set(shapes)] : ['opaque'];
}

/** @param {Record<string, any>} options */
function inferRiskClass({ endpointKind, roleHint, queryKeys = [], parameterShape = [] }) {
  const text = [
    endpointKind,
    roleHint,
    ...queryKeys,
    ...parameterShape,
  ].join(' ').toLowerCase();
  if (/websocket|sse|preflight/u.test(text)) {
    return 'transport-surface-requires-review';
  }
  if (/auth|session|login/u.test(text)) {
    return 'auth-session-requires-review';
  }
  if (/risk|captcha|challenge|permission|verify/u.test(text)) {
    return 'risk-or-access-control';
  }
  if (/csrf|xsrf|signature|signer|token|auth|api-key|api_key/u.test(text)) {
    return 'request-protection-requires-review';
  }
  if (/download-resource|media-manifest|media-resolve/u.test(text)) {
    return 'resource-resolution-requires-review';
  }
  return 'observed-unverified';
}

/** @param {Record<string, any>} [raw] */
function createApiTargetObservation(raw = {}) {
  const method = normalizeText(raw.method ?? raw.endpoint?.method) ?? 'GET';
  const url = normalizeText(raw.url ?? raw.endpoint?.url);
  const redactedUrl = redactUrl(url).url;
  const parsed = parseObservedUrl(redactedUrl);
  const rawParsed = parseObservedUrl(url);
  const endpointKind = inferEndpointKind({
    url: redactedUrl,
    method,
    resourceType: raw.resourceType,
    body: raw.body ?? raw.request?.body,
  });
  const transport = normalizeText(raw.transport ?? raw.target?.transport)
    ?? inferTransport({
      url,
      method,
      resourceType: raw.resourceType ?? raw.endpoint?.resourceType,
    });
  const roleHint = inferRoleHint({ url, endpointKind });
  const parameterShape = inferParameterShape(rawParsed, raw.body ?? raw.request?.body);
  const rawQueryKeys = queryShape(rawParsed, { includeSensitive: true });
  const queryKeys = queryShape(parsed);
  return {
    schemaVersion: API_CANDIDATE_SCHEMA_VERSION,
    canonicalEndpointKey: canonicalEndpointKey({
      siteKey: normalizeText(raw.siteKey),
      method,
      url: redactedUrl,
    }),
    canonicalEndpointPathKey: canonicalEndpointPathKey({
      siteKey: normalizeText(raw.siteKey),
      url: redactedUrl,
    }),
    transport,
    resourceType: normalizeText(raw.resourceType ?? raw.endpoint?.resourceType) ?? 'unknown',
    endpointKind,
    roleHint,
    parameterShape,
    queryKeys,
    riskClass: inferRiskClass({ endpointKind, roleHint, queryKeys: rawQueryKeys, parameterShape }),
    siteSpecificInterpretationOwner: 'SiteAdapter',
    observedApiAutoPromotionAllowed: false,
    redactionRequired: true,
  };
}

function safeObservedCandidateId(value, index) {
  const text = normalizeText(value);
  if (
    !text
    || /https?:\/\//iu.test(text)
    || /[/?#\\]/u.test(text)
    || /\.(?:cmd|bat|ps1|sh|exe|dll|mjs|cjs|js)$/iu.test(text)
    || /(?:authorization|cookie|sessdata|access[_-]?token|refresh[_-]?token|session[_-]?id|csrf)/iu.test(text)
  ) {
    return `observed-candidate-${index + 1}`;
  }
  return text
    .replace(/[^a-z0-9._:-]+/giu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 120) || `observed-candidate-${index + 1}`;
}

function correlatePreflightCandidates(candidates = []) {
  const normalized = candidates.map((candidate, index) => ({
    ...candidate,
    id: safeObservedCandidateId(candidate.id, index),
    target: {
      ...(candidate.target ?? {}),
    },
    evidence: {
      ...(candidate.evidence ?? {}),
    },
    correlationId: safeObservedCandidateId(candidate.id, index),
  }));
  const preflights = normalized
    .filter((candidate) => candidate.target?.transport === 'preflight' || candidate.evidence?.preflight === true);
  for (const preflight of preflights) {
    const pathKey = normalizeText(preflight.target?.canonicalEndpointPathKey);
    if (!pathKey) {
      continue;
    }
    const followUps = normalized.filter((candidate) => (
      candidate !== preflight
      && candidate.target?.transport !== 'preflight'
      && normalizeText(candidate.target?.canonicalEndpointPathKey) === pathKey
    ));
    const followUpCandidateIds = followUps.map((candidate) => candidate.correlationId);
    const preflightCorrelation = {
      status: followUpCandidateIds.length > 0 ? 'correlated_observed_request' : 'preflight_without_followup',
      canonicalEndpointPathKey: pathKey,
      followUpCandidateIds,
      observedOnly: true,
      catalogPromotionAllowed: false,
      redactionRequired: true,
    };
    preflight.target.preflightCorrelation = preflightCorrelation;
    preflight.evidence.preflightCorrelation = preflightCorrelation;
    for (const followUp of followUps) {
      const followUpCorrelation = {
        status: 'preflight_observed',
        canonicalEndpointPathKey: pathKey,
        preflightCandidateIds: [preflight.correlationId],
        observedOnly: true,
        catalogPromotionAllowed: false,
        redactionRequired: true,
      };
      followUp.target.preflightObserved = true;
      followUp.target.preflightCorrelation = followUpCorrelation;
      followUp.evidence.preflightCorrelation = followUpCorrelation;
    }
  }
  return normalized.map(({ correlationId, ...candidate }) => candidate);
}

function candidateArtifactName(index) {
  return `candidate-${String(index + 1).padStart(4, '0')}.json`;
}

function decisionArtifactName(index) {
  return `decision-${String(index + 1).padStart(4, '0')}.json`;
}

function upgradeDecisionArtifactName(index) {
  return `upgrade-decision-${String(index + 1).padStart(4, '0')}.json`;
}

function upgradeDecisionLifecycleEventArtifactName(index) {
  return `upgrade-decision-lifecycle-event-${String(index + 1).padStart(4, '0')}.json`;
}

function verificationEvidenceArtifactName(index) {
  return `verification-evidence-${String(index + 1).padStart(4, '0')}.json`;
}

function verificationLifecycleEventArtifactName(index) {
  return `verification-lifecycle-event-${String(index + 1).padStart(4, '0')}.json`;
}

/** @param {Record<string, any>} [captureOutput] */
function requestsFromCaptureOutput(captureOutput = {}) {
  if (Array.isArray(captureOutput)) {
    return captureOutput;
  }
  const requests = captureOutput.requests ?? captureOutput.networkRequests;
  if (!Array.isArray(requests)) {
    throw new Error('Capture output requests must be an array');
  }
  return requests;
}

export function createApiDiscoveryFailure(reasonCode, message, {
  stage = 'api-discovery',
  // @ts-ignore
  cause,
  metadata = {},
} = {}) {
  const recovery = reasonCodeSummary(reasonCode);
  requireReasonCodeDefinition(reasonCode, { family: 'api' });
  /** @type {Error & Record<string, any>} */
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = 'ApiDiscoveryFailure';
  error.code = recovery.code;
  error.reasonCode = recovery.code;
  error.reasonRecovery = recovery;
  error.retryable = recovery.retryable;
  error.manualRecoveryNeeded = recovery.manualRecoveryNeeded;
  error.artifactWriteAllowed = recovery.artifactWriteAllowed;
  error.recovery = {
    ...recovery,
    stage,
  };
  error.metadata = {
    stage,
    ...metadata,
  };
  return error;
}

/** @param {Record<string, any>} [raw] */
export function apiCandidateFromObservedRequest(raw = {}) {
  const siteKey = normalizeText(raw.siteKey);
  if (!siteKey) {
    throw new Error('Observed request siteKey is required');
  }
  const url = normalizeText(raw.url ?? raw.endpoint?.url);
  if (!url) {
    throw new Error('Observed request url is required');
  }
  const status = normalizeText(raw.status);
  if (status && status !== 'observed') {
    throw new Error('ApiDiscovery observed request status must be observed');
  }
  const redactedUrl = redactUrl(url).url;
  const redactedHeaders = redactHeaders(raw.headers ?? raw.request?.headers ?? {}).headers;
  const redactedBody = redactBody(raw.body ?? raw.request?.body).body;
  const redactedEvidence = redactValue(raw.evidence).value;

  return {
    schemaVersion: API_CANDIDATE_SCHEMA_VERSION,
    id: normalizeText(raw.id),
    siteKey,
    status: 'observed',
    canonicalEndpointKey: canonicalEndpointKey({
      siteKey,
      method: raw.method ?? raw.endpoint?.method,
      url: redactedUrl,
    }),
    target: createApiTargetObservation(raw),
    endpoint: {
      method: normalizeText(raw.method ?? raw.endpoint?.method) ?? 'GET',
      url: redactedUrl,
    },
    source: normalizeText(raw.source) ?? 'observed-request',
    observedAt: normalizeText(raw.observedAt),
    evidence: redactedEvidence,
    request: {
      headers: redactedHeaders,
      body: redactedBody,
    },
  };
}

export async function writeApiCandidateArtifactsFromObservedRequests(requests = [], {
  // @ts-ignore
  outputDir,
  // @ts-ignore
  redactionAuditDir,
} = {}) {
  if (!Array.isArray(requests)) {
    throw new Error('Observed requests must be an array');
  }
  const candidateDir = normalizeText(outputDir);
  if (!candidateDir) {
    throw new Error('ApiDiscovery outputDir is required');
  }
  const auditDir = normalizeText(redactionAuditDir);
  const candidates = correlatePreflightCandidates(
    requests.map((request) => apiCandidateFromObservedRequest(request)),
  );
  if (candidates.length === 0) {
    throw createApiDiscoveryFailure(
      'api-candidate-generation-failed',
      'ApiDiscovery did not generate any candidates from observed requests',
      {
        stage: 'candidate-generation',
        metadata: {
          requestCount: 0,
        },
      },
    );
  }
  if (!auditDir) {
    throw new Error('ApiDiscovery redactionAuditDir is required');
  }

  const artifacts = [];
  for (const [index, candidate] of candidates.entries()) {
    const artifactName = candidateArtifactName(index);
    const result = await writeApiCandidateArtifact(candidate, {
      candidatePath: path.join(candidateDir, artifactName),
      redactionAuditPath: path.join(auditDir, artifactName.replace(/\.json$/u, '.redaction-audit.json')),
    });
    artifacts.push({
      index,
      ...result,
    });
  }
  return artifacts;
}

/** @param {Record<string, any>} [captureOutput] */
export async function writeApiCandidateArtifactsFromCaptureOutput(captureOutput = {}, options = {}) {
  return writeApiCandidateArtifactsFromObservedRequests(requestsFromCaptureOutput(captureOutput), options);
}

function assertManualVerificationResultIsMultiAspect(verificationResult) {
  const evidenceType = normalizeText(verificationResult?.metadata?.evidenceType);
  if (evidenceType !== 'multi-aspect') {
    throw new Error('Manual ApiCandidate verification requires multi-aspect verification result');
  }
}

/** @param {Record<string, any>} [record] */
function materializeManualVerificationResult(record = {}) {
  if (record?.verificationResult) {
    return record.verificationResult;
  }
  const fixtures = record?.verificationFixtures;
  if (!fixtures) {
    return undefined;
  }
  return createApiCandidateMultiAspectVerificationResultFromFixtures({
    candidate: record?.candidate,
    verifierId: fixtures.verifierId,
    verifiedAt: fixtures.verifiedAt,
    responseFixture: fixtures.responseFixture,
    authFixture: fixtures.authFixture,
    paginationFixture: fixtures.paginationFixture,
    riskFixture: fixtures.riskFixture,
    metadata: fixtures.metadata,
  });
}

export async function writeManualApiCandidateVerificationArtifacts(records = [], {
  // @ts-ignore
  outputDir,
  // @ts-ignore
  redactionAuditDir,
  // @ts-ignore
  lifecycleEventOutputDir,
  // @ts-ignore
  lifecycleEventRedactionAuditDir,
  // @ts-ignore
  lifecycleEventTraceId,
  // @ts-ignore
  lifecycleEventCorrelationId,
  // @ts-ignore
  lifecycleEventTaskType,
  // @ts-ignore
  lifecycleEventAdapterVersion,
} = {}) {
  if (!Array.isArray(records)) {
    throw new Error('Manual ApiCandidate verification records must be an array');
  }
  const verificationDir = normalizeText(outputDir);
  if (!verificationDir) {
    throw new Error('Manual ApiCandidate verification outputDir is required');
  }
  const auditDir = normalizeText(redactionAuditDir);
  if (!auditDir) {
    throw new Error('Manual ApiCandidate verification redactionAuditDir is required');
  }
  const eventDir = normalizeText(lifecycleEventOutputDir);
  const eventAuditDir = normalizeText(lifecycleEventRedactionAuditDir);
  const shouldWriteLifecycleEvents = Boolean(eventDir || eventAuditDir);
  if (shouldWriteLifecycleEvents && (!eventDir || !eventAuditDir)) {
    throw new Error('Manual ApiCandidate verification lifecycle event and redaction audit dirs must be provided together');
  }

  const verifiedRecords = records.map((record) => {
    const verificationResult = materializeManualVerificationResult(record);
    const evidence = verifyApiCandidateForCatalog({
      candidate: record?.candidate,
      siteAdapterDecision: record?.siteAdapterDecision,
      verificationResult,
    });
    assertManualVerificationResultIsMultiAspect(verificationResult);
    return {
      candidate: record?.candidate,
      siteAdapterDecision: record?.siteAdapterDecision,
      verificationResult,
      evidence,
    };
  });

  const artifacts = [];
  for (const [index, record] of verifiedRecords.entries()) {
    const artifactName = verificationEvidenceArtifactName(index);
    const lifecycleArtifactName = verificationLifecycleEventArtifactName(index);
    const result = await writeApiCandidateVerificationEvidenceArtifact({
      candidate: record.candidate,
      siteAdapterDecision: record.siteAdapterDecision,
      verificationResult: record.verificationResult,
    }, {
      evidencePath: path.join(verificationDir, artifactName),
      redactionAuditPath: path.join(
        auditDir,
        artifactName.replace(/\.json$/u, '.redaction-audit.json'),
      ),
      ...(shouldWriteLifecycleEvents ? {
        lifecycleEventPath: path.join(eventDir, lifecycleArtifactName),
        lifecycleEventRedactionAuditPath: path.join(
          eventAuditDir,
          lifecycleArtifactName.replace(/\.json$/u, '.redaction-audit.json'),
        ),
        lifecycleEventTraceId,
        lifecycleEventCorrelationId,
        lifecycleEventTaskType,
        lifecycleEventAdapterVersion,
      } : {}),
    });
    artifacts.push({
      index,
      ...result,
    });
  }
  return artifacts;
}

/** @param {Record<string, any>} [candidate] */
export function validateApiCandidateWithAdapter(candidate = {}, adapter = {}, {
  evidence = {},
  scope = {},
  // @ts-ignore
  validatedAt,
} = {}) {
  if (typeof adapter.validateApiCandidate !== 'function') {
    throw new Error('SiteAdapter validateApiCandidate is required');
  }
  return normalizeSiteAdapterCandidateDecision(adapter.validateApiCandidate({
    candidate,
    evidence,
    scope,
    validatedAt,
  }), {
    candidate,
  });
}

export async function writeSiteAdapterCandidateDecisionArtifacts(candidateResults = [], {
  // @ts-ignore
  outputDir,
  // @ts-ignore
  redactionAuditDir,
  // @ts-ignore
  resolveAdapter,
  // @ts-ignore
  validatedAt,
  // @ts-ignore
  decidedAt,
  validationMode = 'capture-observed-candidate',
  evidenceSource = 'api-candidate-artifact',
  // @ts-ignore
  catalogUpgradeDecisionOutputDir,
  // @ts-ignore
  catalogUpgradeDecisionRedactionAuditDir,
  // @ts-ignore
  catalogUpgradeDecisionLifecycleEventOutputDir,
  // @ts-ignore
  catalogUpgradeDecisionLifecycleEventRedactionAuditDir,
  // @ts-ignore
  lifecycleEventTraceId,
  // @ts-ignore
  lifecycleEventCorrelationId,
  // @ts-ignore
  lifecycleEventTaskType,
  // @ts-ignore
  lifecycleEventAdapterVersion,
} = {}) {
  if (!Array.isArray(candidateResults)) {
    throw new Error('ApiCandidate results must be an array');
  }
  const decisionDir = normalizeText(outputDir);
  if (!decisionDir) {
    throw new Error('SiteAdapter decision outputDir is required');
  }
  const auditDir = normalizeText(redactionAuditDir);
  if (!auditDir) {
    throw new Error('SiteAdapter decision redactionAuditDir is required');
  }
  if (typeof resolveAdapter !== 'function') {
    throw new Error('SiteAdapter decision resolveAdapter is required');
  }
  const upgradeDecisionDir = normalizeText(catalogUpgradeDecisionOutputDir);
  const upgradeDecisionAuditDir = normalizeText(catalogUpgradeDecisionRedactionAuditDir);
  const shouldWriteUpgradeDecisions = Boolean(upgradeDecisionDir || upgradeDecisionAuditDir);
  if (shouldWriteUpgradeDecisions && (!upgradeDecisionDir || !upgradeDecisionAuditDir)) {
    throw new Error('SiteAdapter catalog upgrade decision output and redaction audit dirs must be provided together');
  }
  const upgradeDecisionEventDir = normalizeText(catalogUpgradeDecisionLifecycleEventOutputDir);
  const upgradeDecisionEventAuditDir = normalizeText(catalogUpgradeDecisionLifecycleEventRedactionAuditDir);
  const shouldWriteUpgradeDecisionEvents = Boolean(upgradeDecisionEventDir || upgradeDecisionEventAuditDir);
  if (shouldWriteUpgradeDecisionEvents && (!upgradeDecisionEventDir || !upgradeDecisionEventAuditDir)) {
    throw new Error('SiteAdapter catalog upgrade decision lifecycle event and redaction audit dirs must be provided together');
  }
  if (shouldWriteUpgradeDecisionEvents && !shouldWriteUpgradeDecisions) {
    throw new Error('SiteAdapter catalog upgrade decision lifecycle events require upgrade decision output dirs');
  }

  const decisionRecords = [];
  for (const [index, result] of candidateResults.entries()) {
    const candidate = result?.candidate;
    const adapter = resolveAdapter({
      candidate,
      host: candidate?.siteKey,
      inputUrl: candidate?.endpoint?.url,
    });
    if (typeof adapter?.validateApiCandidate !== 'function') {
      throw createApiDiscoveryFailure(
        'site-adapter-core-api-unidentified',
        `SiteAdapter could not identify a core API validation path for ${candidate?.siteKey ?? 'unknown-site'}`,
        {
          stage: 'site-adapter-validation',
          metadata: {
            candidateId: normalizeText(candidate?.id),
            siteKey: normalizeText(candidate?.siteKey),
          },
        },
      );
    }

    const artifactName = decisionArtifactName(index);
    const decisionPath = path.join(decisionDir, artifactName);
    const redactionAuditPath = path.join(
      auditDir,
      artifactName.replace(/\.json$/u, '.redaction-audit.json'),
    );
    const decision = validateApiCandidateWithAdapter(candidate, adapter, {
      // @ts-ignore
      validatedAt,
      scope: {
        validationMode,
        candidateArtifact: result?.artifactPath,
      },
      evidence: {
        source: evidenceSource,
        artifactPath: result?.artifactPath,
      },
    });
    assertSiteAdapterCandidateDecisionCompatible(decision);
    const prepared = prepareRedactedArtifactJsonWithAudit(decision);
    assertSiteAdapterCandidateDecisionCompatible(prepared.value);
    let catalogUpgradePolicy;
    let upgradeArtifactName;
    if (shouldWriteUpgradeDecisions && typeof adapter.getApiCatalogUpgradePolicy === 'function') {
      upgradeArtifactName = upgradeDecisionArtifactName(index);
      catalogUpgradePolicy = adapter.getApiCatalogUpgradePolicy({
        candidate,
        siteAdapterDecision: prepared.value,
        decidedAt: decidedAt ?? validatedAt,
        scope: {
          validationMode,
          candidateArtifact: result?.artifactPath,
          siteAdapterDecisionArtifact: decisionPath,
        },
        evidence: {
          source: evidenceSource,
          candidateArtifact: result?.artifactPath,
          siteAdapterDecisionArtifact: decisionPath,
        },
      });
    }
    decisionRecords.push({
      index,
      candidate,
      decision,
      prepared,
      decisionPath,
      redactionAuditPath,
      catalogUpgradePolicy,
      upgradeArtifactName,
    });
  }

  const decisions = [];
  for (const record of decisionRecords) {
    await mkdir(path.dirname(record.decisionPath), { recursive: true });
    await mkdir(path.dirname(record.redactionAuditPath), { recursive: true });
    await writeFile(record.decisionPath, `${record.prepared.json}\n`, 'utf8');
    await writeFile(record.redactionAuditPath, `${record.prepared.auditJson}\n`, 'utf8');
    let catalogUpgradeDecision;
    if (record.catalogUpgradePolicy) {
      catalogUpgradeDecision = await writeApiCatalogUpgradeDecisionArtifact({
        candidate: record.candidate,
        siteAdapterDecision: record.prepared.value,
        policy: record.catalogUpgradePolicy,
        decidedAt: decidedAt ?? validatedAt,
      }, {
        decisionPath: path.join(upgradeDecisionDir, record.upgradeArtifactName),
        redactionAuditPath: path.join(
          upgradeDecisionAuditDir,
          record.upgradeArtifactName.replace(/\.json$/u, '.redaction-audit.json'),
        ),
        ...(shouldWriteUpgradeDecisionEvents ? {
          lifecycleEventPath: path.join(
            upgradeDecisionEventDir,
            upgradeDecisionLifecycleEventArtifactName(record.index),
          ),
          lifecycleEventRedactionAuditPath: path.join(
            upgradeDecisionEventAuditDir,
            upgradeDecisionLifecycleEventArtifactName(record.index).replace(/\.json$/u, '.redaction-audit.json'),
          ),
          lifecycleEventCreatedAt: decidedAt ?? validatedAt,
          lifecycleEventTraceId,
          lifecycleEventCorrelationId,
          lifecycleEventTaskType,
          lifecycleEventAdapterVersion,
        } : {}),
      });
    }
    decisions.push({
      index: record.index,
      candidate: record.candidate,
      decision: record.decision,
      artifactPath: record.decisionPath,
      redactionAuditPath: record.redactionAuditPath,
      ...(catalogUpgradeDecision ? {
        catalogUpgradeDecision: catalogUpgradeDecision.decision,
        catalogUpgradeDecisionArtifactPath: catalogUpgradeDecision.artifactPath,
        catalogUpgradeDecisionRedactionAuditPath: catalogUpgradeDecision.redactionAuditPath,
        catalogUpgradeDecisionLifecycleEvent: catalogUpgradeDecision.lifecycleEvent,
        catalogUpgradeDecisionLifecycleEventPath: catalogUpgradeDecision.lifecycleEventPath,
        catalogUpgradeDecisionLifecycleEventRedactionAuditPath:
          catalogUpgradeDecision.lifecycleEventRedactionAuditPath,
      } : {}),
    });
  }

  return decisions;
}
