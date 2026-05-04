// @ts-check

import { redactValue } from './security-guard.mjs';

export const SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION = 1;
export const SITE_ONBOARDING_DISCOVERY_REQUIRED_COVERAGE_THRESHOLD = 0.95;
export const SITE_ONBOARDING_REQUIRED_COVERAGE_THRESHOLD =
  SITE_ONBOARDING_DISCOVERY_REQUIRED_COVERAGE_THRESHOLD;
export const NODE_INVENTORY_SCHEMA_VERSION = SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION;
export const API_INVENTORY_SCHEMA_VERSION = SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION;
export const UNKNOWN_NODE_REPORT_SCHEMA_VERSION = SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION;
export const SITE_CAPABILITY_REPORT_SCHEMA_VERSION = SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION;
export const DISCOVERY_AUDIT_SCHEMA_VERSION = SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION;

export const SITE_ONBOARDING_DISCOVERY_CLASSIFICATIONS = Object.freeze([
  'recognized',
  'unknown',
  'ignored',
]);

export const SITE_ONBOARDING_DISCOVERY_ARTIFACT_NAMES = Object.freeze([
  'NODE_INVENTORY',
  'API_INVENTORY',
  'UNKNOWN_NODE_REPORT',
  'SITE_CAPABILITY_REPORT',
  'DISCOVERY_AUDIT',
]);

const CLASSIFICATION_SET = new Set(SITE_ONBOARDING_DISCOVERY_CLASSIFICATIONS);
const REQUIRED_COVERAGE_MAX = 1;
const REQUIRED_COVERAGE_MIN = 0;
const MANUAL_REVIEW_NODE_KINDS = new Set([
  'login-state',
  'permission',
  'permission-signal',
  'permission-denied',
  'risk',
  'risk-control',
  'risk-signal',
  'limited-page',
  'restriction-page',
  'rate-limit',
  'recovery-entry',
  'manual-risk',
  'manual-risk-state',
]);

const SENSITIVE_QUERY_PATTERN =
  /([?&](?:a_bogus|access_token|auth|authorization|browser_profile|csrf|csrf_token|cookie|msToken|password|profile_path|sessdata|session|session_id|sid|token|user_data_dir|xsec_token)=)[^&#\s]+/giu;
const SENSITIVE_HEADER_PATTERN =
  /\b(?:authorization|cookie|csrf|csrf-token|set-cookie|sessdata|token)\s*[:=]\s*(?:Bearer\s+)?[^|,;\r\n]+/giu;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /\b(?:a_bogus|browser[_-]?profile|msToken|profile[_-]?path|user[_-]?data[_-]?dir|xsec[_-]?token)\s*[:=]\s*[^|,;\r\n\s]+/giu;
const SENSITIVE_PROFILE_PATH_PATTERN =
  /\b[A-Z]:[\\/][^|,;\r\n]*(?:AppData[\\/]Local|BrowserProfile|browser-profile|User Data|user-data-dir)[^|,;\r\n]*/giu;
const SENSITIVE_FIELD_NAME_PATTERN =
  /^(?:a_bogus|access[_-]?token|authorization|browser[_-]?profile|cookie|csrf(?:[_-]?token)?|msToken|password|profile[_-]?path|sessdata|session(?:[_-]?(?:id|token))?|sid|token|user[_-]?data[_-]?dir|xsec[_-]?token)$/iu;

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    freezeDeep(child);
  }
  return value;
}

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function firstNormalizedText(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const text = firstNormalizedText(...value);
      if (text) {
        return text;
      }
      continue;
    }
    const text = normalizeText(value);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function redactText(value) {
  const text = normalizeText(value);
  if (!text) {
    return undefined;
  }
  const locallyRedacted = text
    .replace(SENSITIVE_QUERY_PATTERN, '$1[REDACTED]')
    .replace(SENSITIVE_HEADER_PATTERN, '[REDACTED]')
    .replace(SENSITIVE_PROFILE_PATH_PATTERN, '[REDACTED]')
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, '[REDACTED]');
  const centrallyRedacted = redactValue(locallyRedacted).value;
  return String(centrallyRedacted)
    .replace(SENSITIVE_QUERY_PATTERN, '$1[REDACTED]')
    .replace(SENSITIVE_HEADER_PATTERN, '[REDACTED]')
    .replace(SENSITIVE_PROFILE_PATH_PATTERN, '[REDACTED]')
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, '[REDACTED]');
}

function redactedPlainObject(value) {
  return isPlainObject(value) ? redactValue(value).value : {};
}

function safeFieldName(value) {
  const field = normalizeText(value);
  if (!field || SENSITIVE_FIELD_NAME_PATTERN.test(field)) {
    return undefined;
  }
  return redactText(field);
}

function markdownEscape(value) {
  return String(value ?? '')
    .replace(/\r?\n/gu, ' ')
    .replace(/\|/gu, '\\|');
}

function markdownTable(headers, rows) {
  const headerLine = `| ${headers.map(markdownEscape).join(' | ')} |`;
  const dividerLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const rowLines = rows.map((row) => `| ${row.map((cell) => markdownEscape(cell ?? '')).join(' | ')} |`);
  return [headerLine, dividerLine, ...rowLines].join('\n');
}

function boolText(value) {
  return value ? 'yes' : 'no';
}

function percent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function clampCoverageThreshold(value) {
  const numeric = Number(value ?? SITE_ONBOARDING_DISCOVERY_REQUIRED_COVERAGE_THRESHOLD);
  if (!Number.isFinite(numeric)) {
    throw new Error('Site onboarding discovery required coverage threshold must be a finite number');
  }
  if (numeric < REQUIRED_COVERAGE_MIN || numeric > REQUIRED_COVERAGE_MAX) {
    throw new Error('Site onboarding discovery required coverage threshold must be between 0 and 1');
  }
  return numeric;
}

function adapterForKind(adapter, kind) {
  if (!adapter) {
    return undefined;
  }
  if (typeof adapter === 'function') {
    return adapter;
  }
  if (kind === 'node' && typeof adapter.classifyNode === 'function') {
    return adapter.classifyNode;
  }
  if (kind === 'api' && typeof adapter.classifyApi === 'function') {
    return adapter.classifyApi;
  }
  if (typeof adapter.classify === 'function') {
    return adapter.classify;
  }
  return undefined;
}

function decisionFromItem(item = {}) {
  return item.adapterDecision ?? item.adapterResult ?? item.discoveryDecision ?? item.classificationDecision;
}

function invokeAdapterDecision({ adapter, kind, item, siteKey, index }) {
  const classify = adapterForKind(adapter, kind);
  const decision = classify
    ? classify(item, { kind, siteKey, index })
    : decisionFromItem(item);
  if (decision && typeof decision.then === 'function') {
    throw new Error('Site onboarding discovery adapter decisions must be resolved before inventory generation');
  }
  return decision;
}

function normalizeClassification(rawDecision = {}, item = {}) {
  const decision = rawDecision && typeof rawDecision === 'object' ? rawDecision : {};
  let classification = normalizeText(
    decision.classification
      ?? decision.status
      ?? item.classification
      ?? item.status,
  );
  if (!classification && (decision.ignored === true || item.ignored === true)) {
    classification = 'ignored';
  }
  if (!classification && (decision.recognized === true || item.recognized === true)) {
    classification = 'recognized';
  }
  classification ??= 'unknown';
  if (!CLASSIFICATION_SET.has(classification)) {
    throw new Error(`Unsupported site onboarding discovery classification: ${classification}`);
  }

  const reason = redactText(
    decision.reason
      ?? decision.ignoreReason
      ?? item.reason
      ?? item.ignoreReason,
  );
  if (classification === 'ignored' && !reason) {
    throw new Error('Ignored site onboarding discovery items must include a reason');
  }

  return {
    classification,
    reason,
    recognizedAs: redactText(decision.recognizedAs ?? decision.name ?? item.recognizedAs),
    confidence: decision.confidence ?? item.confidence,
    required: Boolean(decision.required ?? item.required),
  };
}

function normalizeDiscoveryItem({ item = {}, kind, siteKey, index, adapter }) {
  const decision = invokeAdapterDecision({ adapter, kind, item, siteKey, index });
  const classification = normalizeClassification(decision, item);
  const id = redactText(
    item.id
      ?? item.key
      ?? item.name
      ?? item.route
      ?? item.url
      ?? item.endpoint?.url
      ?? `${kind}-${index + 1}`,
  );
  const locator = redactText(
    item.locator
      ?? item.url
      ?? item.path
      ?? item.route
      ?? item.selector
      ?? item.endpoint?.url,
  );
  const label = redactText(item.label ?? item.title ?? item.name ?? item.role ?? id);
  const nodeKind = redactText(item.kind ?? item.nodeKind ?? item.type);
  const manualReviewRequired =
    Boolean(item.manualReviewRequired)
    || (kind === 'node' && MANUAL_REVIEW_NODE_KINDS.has(String(nodeKind ?? '').trim()));

  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    kind,
    siteKey: normalizeText(siteKey),
    index,
    id,
    label,
    locator,
    ...(nodeKind ? { nodeKind, kindLabel: nodeKind } : {}),
    ...(manualReviewRequired ? {
      sensitiveKind: nodeKind ?? 'manual-review',
      manualReviewRequired: true,
    } : {}),
    required: classification.required,
    classification: classification.classification,
    reason: classification.reason,
    recognizedAs: classification.recognizedAs,
    confidence: classification.confidence,
    method: kind === 'api' ? redactText(item.method ?? item.endpoint?.method ?? 'GET') : undefined,
    source: redactText(item.source ?? item.evidence?.source),
  });
}

function normalizeDiscoveryItems({ items = [], kind, siteKey, adapter }) {
  if (!Array.isArray(items)) {
    throw new Error(`Discovered ${kind}s must be an array`);
  }
  return freezeDeep(items.map((item, index) => normalizeDiscoveryItem({
    item,
    kind,
    siteKey,
    index,
    adapter,
  })));
}

function addUniqueDiscoveryItem(target, seen, item, kind) {
  const normalized = Object.fromEntries(
    Object.entries(item)
      .map(([key, value]) => [key, typeof value === 'string' ? redactText(value) : value])
      .filter(([, value]) => value !== undefined),
  );
  const key = [
    kind,
    normalized.source,
    normalized.id,
    normalized.method,
    normalized.locator,
  ].map((part) => String(part ?? '')).join('|');
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  target.push(normalized);
}

function producerSourceLabel(scope, fallback) {
  if (String(scope ?? '').startsWith('capture.')) {
    return 'capture-output';
  }
  if (String(scope ?? '').includes('.states.')) {
    return 'expand-state';
  }
  return fallback;
}

function addUrlDiscoveryNode({ nodes, seen, scope, finalUrl, pageType, required }) {
  const safeUrl = redactText(finalUrl);
  if (!safeUrl) {
    return;
  }
  addUniqueDiscoveryItem(nodes, seen, {
    id: `${scope}:finalUrl:${safeUrl}`,
    label: pageType ? `${pageType} finalUrl` : 'finalUrl',
    locator: safeUrl,
    nodeKind: 'navigation-state',
    source: producerSourceLabel(scope, `${scope}.finalUrl`),
    required,
  }, 'node');
}

function addFileDiscoveryNodes({ nodes, apis, nodeSeen, apiSeen, scope, files }) {
  const safeFiles = redactedPlainObject(files);
  for (const [rawRole, rawRefs] of Object.entries(safeFiles)) {
    const role = safeFieldName(rawRole);
    if (!role) {
      continue;
    }
    for (const [index, rawRef] of toArray(rawRefs).entries()) {
      const ref = redactText(rawRef);
      if (!ref) {
        continue;
      }
      addUniqueDiscoveryItem(nodes, nodeSeen, {
        id: `${scope}:files:${role}:${index + 1}`,
        label: `files.${role}`,
        locator: ref,
        nodeKind: 'artifact-ref',
        source: `${scope}.files`,
        required: false,
      }, 'node');
      if (role === 'apiCandidates') {
        addUniqueDiscoveryItem(apis, apiSeen, {
          id: `${scope}:files:${role}:${index + 1}`,
          label: `apiCandidates artifact ${index + 1}`,
          locator: ref,
          method: 'GET',
          source: `${scope}.files.apiCandidates`,
          required: false,
        }, 'api');
      }
    }
  }
}

function nodeKindFromPageFactKey(rawKey) {
  const key = String(rawKey ?? '').trim().toLowerCase();
  if (
    key.includes('login')
    || key.includes('auth')
    || key.includes('identity')
    || key.includes('signedin')
    || key.includes('signed_in')
  ) {
    return 'login-state';
  }
  if (
    key.includes('permission')
    || key.includes('denied')
    || key.includes('restrict')
    || key.includes('limited')
    || key.includes('ratelimit')
    || key.includes('rate_limit')
  ) {
    return 'restriction-page';
  }
  if (key.includes('anticrawl') || key.includes('anti_crawl') || key.includes('anti-crawl')) {
    return 'risk-signal';
  }
  if (
    key.includes('risk')
    || key.includes('captcha')
    || key.includes('challenge')
    || key.includes('bot')
    || key.includes('fraud')
  ) {
    return 'risk-control';
  }
  if (
    key.includes('recover')
    || key.includes('restore')
    || key.includes('repair')
    || key.includes('fallback')
  ) {
    return 'recovery-entry';
  }
  if (key.includes('manual') || key.includes('human')) {
    return 'manual-risk';
  }
  return 'page-fact';
}

function pageFactSourceForNodeKind(rawKey, nodeKind) {
  const key = String(rawKey ?? '').trim();
  if (
    (nodeKind === 'login-state' && key === 'loginStateDetected')
    || (nodeKind === 'restriction-page' && key === 'restrictionDetected')
    || (nodeKind === 'risk-control' && key === 'riskPageDetected')
  ) {
    return 'pageFacts';
  }
  return 'pageFact-signals';
}

function addPageFactDiscoveryNodes({ nodes, seen, scope, pageFacts, locator, required }) {
  const safeFacts = redactedPlainObject(pageFacts);
  for (const rawKey of Object.keys(safeFacts).sort()) {
    const key = safeFieldName(rawKey);
    if (!key) {
      continue;
    }
    const value = safeFacts[rawKey];
    const valueType = Array.isArray(value) ? 'array' : typeof value;
    const nodeKind = nodeKindFromPageFactKey(key);
    const source = pageFactSourceForNodeKind(key, nodeKind);
    addUniqueDiscoveryItem(nodes, seen, {
      id: `${scope}:pageFacts:${key}`,
      label: `pageFacts.${key}`,
      locator,
      nodeKind,
      source,
      required,
      evidence: {
        source,
        factKey: key,
        valueType,
      },
    }, 'node');
  }
}

function triggerLocator(trigger = {}) {
  return firstNormalizedText(
    trigger.href,
    trigger.url,
    trigger.locator?.href,
    trigger.locator?.selector,
    trigger.locator?.domPath,
    trigger.selector,
    trigger.domPath,
    trigger.locator?.id,
    trigger.id,
  );
}

function addTriggerDiscoveryNode({ nodes, seen, scope, state, trigger, required }) {
  if (!isPlainObject(trigger)) {
    return;
  }
  const triggerKind = redactText(trigger.kind ?? trigger.type ?? 'trigger');
  const label = redactText(firstNormalizedText(
    trigger.label,
    trigger.name,
    trigger.locator?.label,
    trigger.locator?.textSnippet,
    triggerKind,
  ));
  const locator = redactText(triggerLocator(trigger) ?? state?.finalUrl ?? state?.url);
  const stateId = redactText(firstNormalizedText(state?.stateId, state?.state_id, state?.id, state?.name));
  addUniqueDiscoveryItem(nodes, seen, {
    id: `${scope}:trigger:${stateId ?? 'state'}:${triggerKind ?? 'trigger'}:${locator ?? label ?? 'unknown'}`,
    label: label ?? triggerKind ?? 'trigger',
    locator,
    nodeKind: triggerKind ?? 'trigger',
    source: 'expand-trigger',
    required,
    evidence: {
      source: 'expand-trigger',
      stateId,
      pageType: redactText(state?.pageType ?? state?.page_type ?? state?.semanticPageType),
    },
  }, 'node');
}

function addStateDiscoveryNodes({ nodes, seen, scope, state, required }) {
  if (!isPlainObject(state)) {
    return;
  }
  const stateId = redactText(firstNormalizedText(state.stateId, state.state_id, state.id, state.name));
  const finalUrl = redactText(firstNormalizedText(state.finalUrl, state.final_url, state.url, state.signature?.finalUrl));
  const pageType = redactText(firstNormalizedText(
    state.pageType,
    state.page_type,
    state.semanticPageType,
    state.signature?.pageType,
  ));
  const pageFacts = state.pageFacts ?? state.page_facts ?? state.signature?.pageFacts;
  if (finalUrl) {
    addUrlDiscoveryNode({
      nodes,
      seen,
      scope: `${scope}.states.${stateId ?? 'state'}`,
      finalUrl,
      pageType,
      required,
    });
  }
  if (pageType) {
    addUniqueDiscoveryItem(nodes, seen, {
      id: `${scope}:states:${stateId ?? finalUrl ?? 'state'}:pageType:${pageType}`,
      label: `pageType.${pageType}`,
      locator: finalUrl,
      nodeKind: 'page-type',
      source: 'expand-state',
      required,
    }, 'node');
  }
  const title = redactText(firstNormalizedText(state.title, state.name, state.stateName, state.state_name));
  if (title) {
    addUniqueDiscoveryItem(nodes, seen, {
      id: `${scope}:states:${stateId ?? finalUrl ?? 'state'}:title`,
      label: title,
      locator: finalUrl,
      nodeKind: pageType ?? 'page-state',
      source: 'expand-state',
      required,
    }, 'node');
  }
  addPageFactDiscoveryNodes({
    nodes,
    seen,
    scope: `${scope}.states.${stateId ?? pageType ?? 'state'}`,
    pageFacts,
    locator: finalUrl,
    required,
  });
  for (const trigger of toArray(state.trigger ?? state.observedTrigger)) {
    addTriggerDiscoveryNode({ nodes, seen, scope, state, trigger, required });
  }
  for (const trigger of toArray(state.triggers)) {
    addTriggerDiscoveryNode({ nodes, seen, scope, state, trigger, required });
  }
}

function endpointUrlFromApiLike(raw = {}) {
  return firstNormalizedText(
    raw.endpoint?.url,
    raw.request?.url,
    raw.url,
    raw.href,
    raw.resourceUrl,
    raw.response?.url,
  );
}

function endpointMethodFromApiLike(raw = {}) {
  return redactText(firstNormalizedText(
    raw.endpoint?.method,
    raw.request?.method,
    raw.method,
    'GET',
  )?.toUpperCase());
}

function addApiDiscoveryItem({ apis, seen, scope, raw, required }) {
  if (!isPlainObject(raw)) {
    return;
  }
  const url = redactText(endpointUrlFromApiLike(raw));
  const path = redactText(firstNormalizedText(raw.endpoint?.path, raw.path));
  const locator = url ?? path;
  if (!locator) {
    return;
  }
  const method = endpointMethodFromApiLike(raw);
  const id = redactText(firstNormalizedText(
    raw.id,
    raw.candidateId,
    raw.endpoint?.id,
    `${method ?? 'GET'}:${locator}`,
  ));
  addUniqueDiscoveryItem(apis, seen, {
    id,
    label: redactText(firstNormalizedText(raw.label, raw.name, raw.endpoint?.name, locator)),
    locator,
    method,
    source: `${scope}`,
    required,
    endpoint: {
      method,
      url: locator,
    },
  }, 'api');
}

function captureLikeInputs({ capture, captureOutput, captureManifest, siteDoctor, siteDoctorReport }) {
  return [
    ...toArray(capture),
    ...toArray(captureOutput),
    ...toArray(captureManifest),
    ...toArray(siteDoctor),
    ...toArray(siteDoctor?.capture),
    ...toArray(siteDoctor?.captureOutput),
    ...toArray(siteDoctor?.captureManifest),
    ...toArray(siteDoctor?.initialCapture),
    ...toArray(siteDoctorReport),
    ...toArray(siteDoctorReport?.capture),
    ...toArray(siteDoctorReport?.captureOutput),
    ...toArray(siteDoctorReport?.captureManifest),
    ...toArray(siteDoctorReport?.initialCapture),
  ].filter(isPlainObject);
}

function expandLikeInputs({ expand, expandOutput, expanded, expandManifest, siteDoctor, siteDoctorReport }) {
  return [
    ...toArray(expand),
    ...toArray(expandOutput),
    ...toArray(expanded),
    ...toArray(expandManifest),
    ...toArray(siteDoctor),
    ...toArray(siteDoctor?.expand),
    ...toArray(siteDoctor?.expandOutput),
    ...toArray(siteDoctor?.expanded),
    ...toArray(siteDoctor?.expandManifest),
    ...toArray(siteDoctorReport),
    ...toArray(siteDoctorReport?.expand),
    ...toArray(siteDoctorReport?.expandOutput),
    ...toArray(siteDoctorReport?.expanded),
    ...toArray(siteDoctorReport?.expandManifest),
  ].filter(isPlainObject);
}

function collectStatesFromExpandLike(input = {}) {
  return [
    ...toArray(input.states),
    ...toArray(input.capturedStates),
    ...toArray(input.expandedStates),
    ...toArray(input.summary?.states),
    ...toArray(input.manifest?.states),
  ].filter(isPlainObject);
}

function collectApiLikeInputs({
  networkRequests,
  apiCandidates,
  captureInputs,
  expandInputs,
  siteDoctor,
  siteDoctorReport,
}) {
  return {
    networkRequests: [
      ...toArray(networkRequests),
      ...captureInputs.flatMap((item) => toArray(item.networkRequests)),
      ...expandInputs.flatMap((item) => toArray(item.networkRequests)),
      ...toArray(siteDoctor?.networkRequests),
      ...toArray(siteDoctorReport?.networkRequests),
    ].filter(isPlainObject),
    apiCandidates: [
      ...toArray(apiCandidates),
      ...captureInputs.flatMap((item) => toArray(item.apiCandidates)),
      ...captureInputs.flatMap((item) => toArray(item.files?.apiCandidates)),
      ...expandInputs.flatMap((item) => toArray(item.apiCandidates)),
      ...toArray(siteDoctor?.apiCandidates),
      ...toArray(siteDoctorReport?.apiCandidates),
    ].filter(isPlainObject),
  };
}

export function createSiteOnboardingDiscoveryInputFromCaptureExpand({
  siteKey,
  capture,
  captureOutput,
  captureManifest,
  expand,
  expandOutput,
  expanded,
  expandManifest,
  siteDoctor,
  siteDoctorReport,
  networkRequests,
  apiCandidates,
  generatedAt,
  required = true,
  apiRequired = false,
  source = 'capture-expand-site-doctor',
} = {}) {
  const discoveredNodes = [];
  const discoveredApis = [];
  const nodeSeen = new Set();
  const apiSeen = new Set();
  const captureInputs = captureLikeInputs({
    capture,
    captureOutput,
    captureManifest,
    siteDoctor,
    siteDoctorReport,
  });
  const expandInputs = expandLikeInputs({
    expand,
    expandOutput,
    expanded,
    expandManifest,
    siteDoctor,
    siteDoctorReport,
  });

  for (const [index, item] of captureInputs.entries()) {
    const scope = `capture.${index + 1}`;
    const finalUrl = redactText(firstNormalizedText(item.finalUrl, item.final_url, item.url));
    addUrlDiscoveryNode({
      nodes: discoveredNodes,
      seen: nodeSeen,
      scope,
      finalUrl,
      pageType: redactText(firstNormalizedText(item.pageType, item.page_type, item.semanticPageType)),
      required,
    });
    addFileDiscoveryNodes({
      nodes: discoveredNodes,
      apis: discoveredApis,
      nodeSeen,
      apiSeen,
      scope,
      files: item.files,
    });
    addPageFactDiscoveryNodes({
      nodes: discoveredNodes,
      seen: nodeSeen,
      scope,
      pageFacts: item.pageFacts ?? item.page_facts,
      locator: finalUrl,
      required,
    });
  }

  for (const [index, item] of expandInputs.entries()) {
    const scope = `expand.${index + 1}`;
    for (const state of collectStatesFromExpandLike(item)) {
      addStateDiscoveryNodes({
        nodes: discoveredNodes,
        seen: nodeSeen,
        scope,
        state,
        required,
      });
    }
  }

  const apiLikeInputs = collectApiLikeInputs({
    networkRequests,
    apiCandidates,
    captureInputs,
    expandInputs,
    siteDoctor,
    siteDoctorReport,
  });
  for (const request of apiLikeInputs.networkRequests) {
    addApiDiscoveryItem({
      apis: discoveredApis,
      seen: apiSeen,
      scope: 'networkRequests',
      raw: request,
      required: apiRequired,
    });
  }
  for (const candidate of apiLikeInputs.apiCandidates) {
    addApiDiscoveryItem({
      apis: discoveredApis,
      seen: apiSeen,
      scope: 'apiCandidates',
      raw: candidate,
      required: apiRequired,
    });
  }

  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    siteKey: normalizeText(siteKey),
    generatedAt: normalizeText(generatedAt),
    source: redactText(source),
    discoveredNodes,
    discoveredApis,
    producer: 'site-onboarding-discovery-input',
    siteSpecificInterpretationOwner: 'SiteAdapter',
    serviceBoundary: 'This helper only converts capture, expand, and site-doctor evidence into discovery input; adapter hooks own site interpretation.',
    sensitiveMaterialPolicy: {
      persistentWritesPerformed: false,
      rawCredentialsPersisted: false,
      rawCookiesPersisted: false,
      rawAuthorizationHeadersPersisted: false,
      rawSessionMaterialPersisted: false,
    },
    sourceSummary: {
      captureInputs: captureInputs.length,
      expandInputs: expandInputs.length,
      networkRequests: apiLikeInputs.networkRequests.length,
      apiCandidates: apiLikeInputs.apiCandidates.length,
      discoveredNodes: discoveredNodes.length,
      discoveredApis: discoveredApis.length,
    },
  });
}

export function createSiteOnboardingDiscoveryInputsFromCaptureExpandOutput(options = {}) {
  return createSiteOnboardingDiscoveryInputFromCaptureExpand(options);
}

function countByClassification(entries) {
  const counts = {
    recognized: 0,
    unknown: 0,
    ignored: 0,
  };
  for (const entry of entries) {
    counts[entry.classification] += 1;
  }
  return freezeDeep(counts);
}

function coverageForEntries(entries) {
  const consideredRequired = entries.filter((entry) => entry.required);
  const requiredRecognized = consideredRequired.filter((entry) => entry.classification === 'recognized');
  const requiredUnknown = consideredRequired.filter((entry) => entry.classification === 'unknown');
  const requiredIgnored = consideredRequired.filter((entry) => entry.classification === 'ignored');
  const coverage = consideredRequired.length === 0
    ? 1
    : requiredRecognized.length / consideredRequired.length;

  return freezeDeep({
    requiredTotal: consideredRequired.length,
    requiredRecognized: requiredRecognized.length,
    requiredUnknown: requiredUnknown.length,
    requiredIgnored: requiredIgnored.length,
    requiredCoverage: coverage,
    requiredCoveragePercent: percent(coverage),
  });
}

function createInventory({ artifactName, kind, entries }) {
  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    artifactName,
    kind,
    total: entries.length,
    counts: countByClassification(entries),
    coverage: coverageForEntries(entries),
    entries,
  });
}

export function createNodeInventory(discoveredNodes = [], {
  siteKey,
  adapter,
} = {}) {
  return createInventory({
    artifactName: 'NODE_INVENTORY',
    kind: 'node',
    entries: normalizeDiscoveryItems({
      items: discoveredNodes,
      kind: 'node',
      siteKey,
      adapter,
    }),
  });
}

export function createApiInventory(discoveredApis = [], {
  siteKey,
  adapter,
} = {}) {
  return createInventory({
    artifactName: 'API_INVENTORY',
    kind: 'api',
    entries: normalizeDiscoveryItems({
      items: discoveredApis,
      kind: 'api',
      siteKey,
      adapter,
    }),
  });
}

export function createUnknownNodeReport(nodeInventory, apiInventory) {
  const unknownNodes = nodeInventory.entries.filter((entry) => entry.classification === 'unknown');
  const unknownRequiredNodes = unknownNodes.filter((entry) => entry.required);
  const unknownApis = (apiInventory?.entries ?? []).filter((entry) => entry.classification === 'unknown');
  const unknownRequiredApis = unknownApis.filter((entry) => entry.required);
  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    artifactName: 'UNKNOWN_NODE_REPORT',
    totalUnknownNodes: unknownNodes.length,
    totalUnknownRequiredNodes: unknownRequiredNodes.length,
    totalUnknownApis: unknownApis.length,
    totalUnknownRequiredApis: unknownRequiredApis.length,
    gateRequiredUnknownNodesZero: unknownRequiredNodes.length === 0,
    gateRequiredUnknownApisZero: unknownRequiredApis.length === 0,
    entries: unknownNodes,
    nodes: unknownNodes,
    apis: unknownApis,
  });
}

function coverageFailures({
  requiredCoveragePass,
  unknownRequiredNodesPass,
  unknownRequiredApisPass,
  requiredIgnoredNodesPass,
  requiredIgnoredApisPass,
  manualReviewFailures,
}) {
  const failures = [];
  if (!requiredCoveragePass) {
    failures.push('required-coverage-below-threshold');
  }
  if (!unknownRequiredNodesPass) {
    failures.push('unknown-required-node');
  }
  if (!unknownRequiredApisPass) {
    failures.push('unknown-required-api');
  }
  if (!requiredIgnoredNodesPass) {
    failures.push('ignored-required-node');
  }
  if (!requiredIgnoredApisPass) {
    failures.push('ignored-required-api');
  }
  for (const entry of manualReviewFailures) {
    const nodeKind = entry.nodeKind ?? entry.sensitiveKind ?? 'manual-review';
    failures.push(`unmapped-sensitive-node:${nodeKind}`);
    if (nodeKind === 'manual-risk' || nodeKind === 'manual-risk-state') {
      failures.push('manual-risk-node-unmapped');
    }
  }
  return [...new Set(failures)];
}

export function evaluateSiteOnboardingCoverageGate({
  nodeInventory,
  apiInventory,
  requiredCoverageThreshold = SITE_ONBOARDING_DISCOVERY_REQUIRED_COVERAGE_THRESHOLD,
} = {}) {
  const threshold = clampCoverageThreshold(requiredCoverageThreshold);
  const combinedEntries = [
    ...(nodeInventory?.entries ?? []),
    ...(apiInventory?.entries ?? []),
  ];
  const combinedCoverage = coverageForEntries(combinedEntries);
  const nodeCoverage = nodeInventory?.coverage ?? coverageForEntries([]);
  const apiCoverage = apiInventory?.coverage ?? coverageForEntries([]);
  const unknownRequiredNodes = (nodeInventory?.entries ?? [])
    .filter((entry) => entry.required && entry.classification === 'unknown');
  const unknownRequiredApis = (apiInventory?.entries ?? [])
    .filter((entry) => entry.required && entry.classification === 'unknown');
  const requiredIgnoredNodes = (nodeInventory?.entries ?? [])
    .filter((entry) => entry.required && entry.classification === 'ignored');
  const requiredIgnoredApis = (apiInventory?.entries ?? [])
    .filter((entry) => entry.required && entry.classification === 'ignored');
  const manualReviewFailures = (nodeInventory?.entries ?? [])
    .filter((entry) => entry.manualReviewRequired && entry.classification !== 'recognized');
  const requiredCoveragePass = combinedCoverage.requiredCoverage >= threshold;
  const unknownRequiredNodesPass = unknownRequiredNodes.length === 0;
  const unknownRequiredApisPass = unknownRequiredApis.length === 0;
  const requiredIgnoredNodesPass = requiredIgnoredNodes.length === 0;
  const requiredIgnoredApisPass = requiredIgnoredApis.length === 0;
  const failures = coverageFailures({
    requiredCoveragePass,
    unknownRequiredNodesPass,
    unknownRequiredApisPass,
    requiredIgnoredNodesPass,
    requiredIgnoredApisPass,
    manualReviewFailures,
  });

  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    requiredCoverageThreshold: threshold,
    requiredCoverageThresholdPercent: percent(threshold),
    requiredCoverage: combinedCoverage,
    nodeRequiredCoverage: nodeCoverage,
    apiRequiredCoverage: apiCoverage,
    unknownRequiredNodes: unknownRequiredNodes.length,
    unknownRequiredApis: unknownRequiredApis.length,
    requiredIgnoredNodes: requiredIgnoredNodes.length,
    requiredIgnoredApis: requiredIgnoredApis.length,
    manualReviewUnmappedNodes: manualReviewFailures.length,
    requiredCoveragePass,
    unknownRequiredNodesPass,
    unknownRequiredApisPass,
    requiredIgnoredNodesPass,
    requiredIgnoredApisPass,
    failures,
    passed: failures.length === 0,
  });
}

export function createSiteCapabilityReport({
  siteKey,
  nodeInventory,
  apiInventory,
  unknownNodeReport,
  coverageGate,
} = {}) {
  const unknownApis = (apiInventory?.entries ?? [])
    .filter((entry) => entry.classification === 'unknown');

  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    artifactName: 'SITE_CAPABILITY_REPORT',
    siteKey: normalizeText(siteKey),
    gate: coverageGate,
    summary: {
      nodeTotal: nodeInventory?.total ?? 0,
      apiTotal: apiInventory?.total ?? 0,
      unknownNodeTotal: unknownNodeReport?.totalUnknownNodes ?? 0,
      unknownRequiredNodeTotal: unknownNodeReport?.totalUnknownRequiredNodes ?? 0,
      unknownApiTotal: unknownApis.length,
      unknownRequiredApiTotal: unknownApis.filter((entry) => entry.required).length,
      ignoredNodeTotal: nodeInventory?.counts?.ignored ?? 0,
      ignoredApiTotal: apiInventory?.counts?.ignored ?? 0,
    },
    siteSpecificInterpretationOwner: 'SiteAdapter',
    serviceBoundary: 'Discovery inventory stores adapter decisions only; no concrete site semantics are encoded in this service.',
  });
}

export function createDiscoveryAudit({
  siteKey,
  adapter,
  generatedAt,
  nodeInventory,
  apiInventory,
  coverageGate,
} = {}) {
  const allEntries = [
    ...(nodeInventory?.entries ?? []),
    ...(apiInventory?.entries ?? []),
  ];
  const ignoredWithoutReason = allEntries.filter((entry) => entry.classification === 'ignored' && !entry.reason);
  const unrecordedItems = allEntries.filter((entry) => !CLASSIFICATION_SET.has(entry.classification));
  const adapterId = normalizeText(adapter?.adapterId ?? adapter?.id ?? adapter?.name);

  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    artifactName: 'DISCOVERY_AUDIT',
    siteKey: normalizeText(siteKey),
    generatedAt: normalizeText(generatedAt) ?? new Date().toISOString(),
    adapterId,
    artifactNames: SITE_ONBOARDING_DISCOVERY_ARTIFACT_NAMES,
    gate: coverageGate,
    invariantChecks: {
      ignoredItemsHaveReason: ignoredWithoutReason.length === 0,
      everyDiscoveredItemRecorded: unrecordedItems.length === 0,
      requiredCoverageAtLeastThreshold: coverageGate?.requiredCoveragePass === true,
      unknownRequiredNodesZero: coverageGate?.unknownRequiredNodesPass === true,
      unknownRequiredApisZero: coverageGate?.unknownRequiredApisPass === true,
      requiredIgnoredNodesZero: coverageGate?.requiredIgnoredNodesPass === true,
      requiredIgnoredApisZero: coverageGate?.requiredIgnoredApisPass === true,
      siteSpecificLogicAllowedHere: false,
      siteSpecificInterpretationOwner: 'SiteAdapter',
    },
    sensitiveMaterialPolicy: {
      persistentRawCredentialsAllowed: false,
      persistentRawCookiesAllowed: false,
      persistentAuthorizationHeadersAllowed: false,
      persistentSessionMaterialAllowed: false,
      emittedFieldsAreInventoryOnly: true,
    },
  });
}

function renderInventoryMarkdown(inventory, title) {
  const rows = inventory.entries.map((entry) => [
    entry.id,
    entry.label,
    entry.locator,
    boolText(entry.required),
    entry.classification,
    entry.recognizedAs ?? '',
    entry.reason ?? '',
  ]);
  return [
    `# ${title}`,
    '',
    `Total: ${inventory.total}`,
    `Recognized: ${inventory.counts.recognized}`,
    `Unknown: ${inventory.counts.unknown}`,
    `Ignored: ${inventory.counts.ignored}`,
    `Required coverage: ${inventory.coverage.requiredCoveragePercent}`,
    '',
    rows.length
      ? markdownTable(
        ['ID', 'Label', 'Locator', 'Required', 'Classification', 'Recognized as', 'Reason'],
        rows,
      )
      : 'No discovered items.',
  ].join('\n');
}

export function renderNodeInventoryMarkdown(nodeInventory) {
  return renderInventoryMarkdown(nodeInventory, 'NODE_INVENTORY');
}

export function renderApiInventoryMarkdown(apiInventory) {
  const rows = apiInventory.entries.map((entry) => [
    entry.id,
    entry.method,
    entry.label,
    entry.locator,
    boolText(entry.required),
    entry.classification,
    entry.recognizedAs ?? '',
    entry.reason ?? '',
  ]);
  return [
    '# API_INVENTORY',
    '',
    `Total: ${apiInventory.total}`,
    `Recognized: ${apiInventory.counts.recognized}`,
    `Unknown: ${apiInventory.counts.unknown}`,
    `Ignored: ${apiInventory.counts.ignored}`,
    `Required coverage: ${apiInventory.coverage.requiredCoveragePercent}`,
    '',
    rows.length
      ? markdownTable(
        ['ID', 'Method', 'Label', 'Endpoint', 'Required', 'Classification', 'Recognized as', 'Reason'],
        rows,
      )
      : 'No discovered APIs.',
  ].join('\n');
}

export function renderUnknownNodeReportMarkdown(unknownNodeReport) {
  const rows = [
    ...(unknownNodeReport.nodes ?? []).map((entry) => ({ ...entry, discoveryKind: 'node' })),
    ...(unknownNodeReport.apis ?? []).map((entry) => ({ ...entry, discoveryKind: 'api' })),
  ].map((entry) => [
    entry.discoveryKind,
    entry.id,
    entry.label,
    entry.locator,
    boolText(entry.required),
    entry.reason ?? 'not-recognized-by-adapter',
  ]);
  return [
    '# UNKNOWN_NODE_REPORT',
    '',
    `Unknown nodes: ${unknownNodeReport.totalUnknownNodes}`,
    `Unknown required nodes: ${unknownNodeReport.totalUnknownRequiredNodes}`,
    `Unknown APIs: ${unknownNodeReport.totalUnknownApis}`,
    `Unknown required APIs: ${unknownNodeReport.totalUnknownRequiredApis}`,
    `Gate unknown required nodes = 0: ${boolText(unknownNodeReport.gateRequiredUnknownNodesZero)}`,
    `Gate unknown required APIs = 0: ${boolText(unknownNodeReport.gateRequiredUnknownApisZero)}`,
    '',
    rows.length
      ? markdownTable(['Kind', 'ID', 'Label', 'Locator', 'Required', 'Reason'], rows)
      : 'No unknown nodes or APIs.',
  ].join('\n');
}

export function renderSiteCapabilityReportMarkdown(siteCapabilityReport) {
  const { gate, summary } = siteCapabilityReport;
  return [
    '# SITE_CAPABILITY_REPORT',
    '',
    `Site key: ${siteCapabilityReport.siteKey ?? 'unspecified'}`,
    `Gate passed: ${boolText(gate.passed)}`,
    `Required coverage: ${gate.requiredCoverage.requiredCoveragePercent}`,
    `Required coverage threshold: ${gate.requiredCoverageThresholdPercent}`,
    `Unknown required nodes: ${gate.unknownRequiredNodes}`,
    '',
    markdownTable(
      ['Metric', 'Value'],
      [
        ['nodeTotal', summary.nodeTotal],
        ['apiTotal', summary.apiTotal],
        ['unknownNodeTotal', summary.unknownNodeTotal],
        ['unknownRequiredNodeTotal', summary.unknownRequiredNodeTotal],
        ['unknownApiTotal', summary.unknownApiTotal],
        ['unknownRequiredApiTotal', summary.unknownRequiredApiTotal],
        ['ignoredNodeTotal', summary.ignoredNodeTotal],
        ['ignoredApiTotal', summary.ignoredApiTotal],
      ],
    ),
    '',
    `Site-specific interpretation owner: ${siteCapabilityReport.siteSpecificInterpretationOwner}`,
  ].join('\n');
}

export function renderDiscoveryAuditMarkdown(discoveryAudit) {
  const checks = discoveryAudit.invariantChecks;
  return [
    '# DISCOVERY_AUDIT',
    '',
    `Schema version: ${discoveryAudit.schemaVersion}`,
    `Site key: ${discoveryAudit.siteKey ?? 'unspecified'}`,
    `Adapter id: ${discoveryAudit.adapterId ?? 'unspecified'}`,
    `Generated at: ${discoveryAudit.generatedAt}`,
    '',
    markdownTable(
      ['Invariant', 'Passed'],
      [
        ['ignoredItemsHaveReason', boolText(checks.ignoredItemsHaveReason)],
        ['requiredCoverageAtLeastThreshold', boolText(checks.requiredCoverageAtLeastThreshold)],
        ['unknownRequiredNodesZero', boolText(checks.unknownRequiredNodesZero)],
        ['siteSpecificLogicAllowedHere', boolText(checks.siteSpecificLogicAllowedHere)],
      ],
    ),
    '',
    'Sensitive material policy: raw credentials, cookies, authorization headers, tokens, and session material are not part of this inventory contract.',
  ].join('\n');
}

export function createSiteOnboardingDiscoveryArtifacts({
  siteKey,
  discoveredNodes = [],
  discoveredApis = [],
  adapter,
  generatedAt,
  requiredCoverageThreshold = SITE_ONBOARDING_DISCOVERY_REQUIRED_COVERAGE_THRESHOLD,
} = {}) {
  const nodeInventory = createNodeInventory(discoveredNodes, { siteKey, adapter });
  const apiInventory = createApiInventory(discoveredApis, { siteKey, adapter });
  const unknownNodeReport = createUnknownNodeReport(nodeInventory, apiInventory);
  const coverageGate = evaluateSiteOnboardingCoverageGate({
    nodeInventory,
    apiInventory,
    requiredCoverageThreshold,
  });
  const siteCapabilityReport = createSiteCapabilityReport({
    siteKey,
    nodeInventory,
    apiInventory,
    unknownNodeReport,
    coverageGate,
  });
  const discoveryAudit = createDiscoveryAudit({
    siteKey,
    adapter,
    generatedAt,
    nodeInventory,
    apiInventory,
    coverageGate,
  });
  const objects = {
    NODE_INVENTORY: nodeInventory,
    API_INVENTORY: apiInventory,
    UNKNOWN_NODE_REPORT: unknownNodeReport,
    SITE_CAPABILITY_REPORT: siteCapabilityReport,
    DISCOVERY_AUDIT: discoveryAudit,
  };
  const markdown = {
    NODE_INVENTORY: renderNodeInventoryMarkdown(nodeInventory),
    API_INVENTORY: renderApiInventoryMarkdown(apiInventory),
    UNKNOWN_NODE_REPORT: renderUnknownNodeReportMarkdown(unknownNodeReport),
    SITE_CAPABILITY_REPORT: renderSiteCapabilityReportMarkdown(siteCapabilityReport),
    DISCOVERY_AUDIT: renderDiscoveryAuditMarkdown(discoveryAudit),
  };

  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    siteKey: normalizeText(siteKey),
    generatedAt: discoveryAudit.generatedAt,
    gate: coverageGate,
    objects,
    markdown,
  });
}

export function assertSiteOnboardingDiscoveryComplete({
  artifacts,
  acceptedByAgentB = false,
} = {}) {
  const resolvedArtifacts = artifacts?.objects ? artifacts : { objects: artifacts };
  const objects = resolvedArtifacts?.objects ?? {};
  for (const artifactName of SITE_ONBOARDING_DISCOVERY_ARTIFACT_NAMES) {
    const artifact = objects[artifactName];
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      throw new Error(`Site onboarding discovery is incomplete: missing required artifact ${artifactName}`);
    }
    if (artifact.schemaVersion !== SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION) {
      throw new Error(`Site onboarding discovery is incomplete: incompatible ${artifactName} schemaVersion`);
    }
  }
  const gate = artifacts?.gate ?? resolvedArtifacts?.objects?.SITE_CAPABILITY_REPORT?.gate;
  if (!gate?.passed) {
    const failures = Array.isArray(gate?.failures) && gate.failures.length
      ? gate.failures.join(', ')
      : 'coverage gate failed';
    throw new Error(`Site onboarding discovery is incomplete: ${failures}`);
  }
  if (!acceptedByAgentB) {
    throw new Error('Site onboarding discovery is incomplete: Agent B acceptance is required');
  }
  const audit = resolvedArtifacts?.objects?.DISCOVERY_AUDIT;
  if (audit?.invariantChecks?.ignoredItemsHaveReason !== true) {
    throw new Error('Site onboarding discovery is incomplete: ignored items must have reasons');
  }
  if (audit?.invariantChecks?.everyDiscoveredItemRecorded !== true) {
    throw new Error('Site onboarding discovery is incomplete: every discovered item must be recorded');
  }
  return true;
}
