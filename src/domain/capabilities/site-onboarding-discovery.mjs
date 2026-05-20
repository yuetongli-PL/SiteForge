// @ts-check

import { redactValue } from '../sessions/security-guard.mjs';

export const SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION = 1;
export const SITE_ONBOARDING_DISCOVERY_REQUIRED_COVERAGE_THRESHOLD = 0.95;
export const SITE_ONBOARDING_REQUIRED_COVERAGE_THRESHOLD =
  SITE_ONBOARDING_DISCOVERY_REQUIRED_COVERAGE_THRESHOLD;
export const SITE_ONBOARDING_DISCOVERY_90_POINT_THRESHOLD = 0.9;
export const SITE_ONBOARDING_FULL_DISCOVERY_MODE = 'FullDiscoveryMode';
export const SITE_ONBOARDING_EXHAUSTIVE_DISCOVERY_MODE = 'ExhaustiveDiscoveryMode';
export const NODE_INVENTORY_SCHEMA_VERSION = SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION;
export const API_INVENTORY_SCHEMA_VERSION = SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION;
export const UNKNOWN_NODE_REPORT_SCHEMA_VERSION = SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION;
export const BLOCKED_NODE_REPORT_SCHEMA_VERSION = SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION;
export const UNKNOWN_API_REPORT_SCHEMA_VERSION = SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION;
export const BLOCKED_API_REPORT_SCHEMA_VERSION = SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION;
export const CAPABILITY_TARGETS_SCHEMA_VERSION = SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION;
export const CAPABILITY_GAP_REPORT_SCHEMA_VERSION = SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION;
export const SITE_CAPABILITY_REPORT_SCHEMA_VERSION = SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION;
export const DISCOVERY_AUDIT_SCHEMA_VERSION = SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION;

export const SITE_ONBOARDING_DISCOVERY_NODE_TARGETS = Object.freeze([
  'home-page',
  'navigation-state',
  'search-form',
  'search-results',
  'content-card',
  'content-detail',
  'author-profile',
  'category-page',
  'pagination-control',
  'filter-sort-control',
  'media-container',
  'download-action',
  'login-state',
  'auth-entry',
  'permission-denied',
  'restriction-page',
  'risk-control',
  'rate-limit',
  'request-protection',
  'session-health',
  'recovery-entry',
  'manual-risk',
  'empty-error-state',
  'artifact-reference',
]);

export const SITE_ONBOARDING_DISCOVERY_API_TARGETS = Object.freeze([
  'document-request',
  'search-endpoint',
  'detail-endpoint',
  'list-pagination-endpoint',
  'category-endpoint',
  'author-endpoint',
  'media-metadata-endpoint',
  'media-manifest-endpoint',
  'download-resource-endpoint',
  'auth-session-endpoint',
  'permission-risk-endpoint',
  'request-protection-endpoint',
  'graphql-endpoint',
  'autocomplete-endpoint',
  'related-content-endpoint',
]);

export const SITE_ONBOARDING_DISCOVERY_CAPABILITY_TARGETS = Object.freeze([
  'open-home',
  'search-content',
  'open-content',
  'open-author',
  'open-category',
  'list-updates',
  'paginate-list',
  'filter-sort',
  'metadata-extract',
  'download-content',
  'auth-state-detect',
  'session-health-check',
  'risk-detect',
  'recovery-plan',
  'artifact-governance',
]);

const DISCOVERY_TARGET_ALIAS_MAP = Object.freeze({
  node: Object.freeze({
    'home-page': ['home', 'homepage', 'navigation-state'],
    'navigation-state': ['navigation-state', 'page-state', 'nav-link'],
    'search-form': ['search-form', 'search', 'form'],
    'search-results': ['search-results', 'result-list'],
    'content-card': ['content-card', 'content-link', 'item-card'],
    'content-detail': ['content-detail', 'detail', 'book-detail-page', 'work-detail'],
    'author-profile': ['author-profile', 'author-page', 'profile'],
    'category-page': ['category-page', 'category', 'list-page'],
    'pagination-control': ['pagination-control', 'pagination', 'next-page'],
    'filter-sort-control': ['filter-sort-control', 'filter', 'sort'],
    'media-container': ['media-container', 'player', 'media-player'],
    'download-action': ['download-action', 'download'],
    'login-state': ['login-state', 'login', 'auth-required'],
    'auth-entry': ['auth-entry', 'login-form', 'auth'],
    'permission-denied': ['permission-denied', 'permission'],
    'restriction-page': ['restriction-page', 'limited-page', 'paywall', 'vip'],
    'risk-control': ['risk-control', 'risk-signal', 'challenge'],
    'rate-limit': ['rate-limit', 'limited-page'],
    'request-protection': ['request-protection', 'csrf', 'signature'],
    'session-health': ['session-health', 'profile-quarantine'],
    'recovery-entry': ['recovery-entry', 'repair', 'recover'],
    'manual-risk': ['manual-risk', 'manual-risk-state'],
    'empty-error-state': ['empty-error-state', 'empty', 'error'],
    'artifact-reference': ['artifact-ref', 'manifest', 'apiCandidates'],
  }),
  api: Object.freeze({
    'document-request': ['document', 'html', 'page'],
    'search-endpoint': ['search', 'query'],
    'detail-endpoint': ['detail', 'item', 'content'],
    'list-pagination-endpoint': ['page', 'cursor', 'pagination'],
    'category-endpoint': ['category', 'list'],
    'author-endpoint': ['author', 'profile', 'user'],
    'media-metadata-endpoint': ['media', 'metadata'],
    'media-manifest-endpoint': ['manifest', 'playurl', 'm3u8', 'dash'],
    'download-resource-endpoint': ['download', 'resource'],
    'auth-session-endpoint': ['auth', 'session', 'login'],
    'permission-risk-endpoint': ['risk', 'permission', 'restriction'],
    'request-protection-endpoint': ['csrf', 'signature', 'signer'],
    'graphql-endpoint': ['graphql'],
    'autocomplete-endpoint': ['suggest', 'autocomplete'],
    'related-content-endpoint': ['related', 'recommend'],
  }),
  capability: Object.freeze({
    'open-home': ['home', 'open-home'],
    'search-content': ['search', 'search-content'],
    'open-content': ['open-content', 'open-book', 'open-page', 'detail'],
    'open-author': ['open-author', 'author', 'profile'],
    'open-category': ['open-category', 'category'],
    'list-updates': ['list-updates', 'latest', 'feed'],
    'paginate-list': ['pagination', 'paginate-list'],
    'filter-sort': ['filter', 'sort'],
    'metadata-extract': ['metadata', 'extract'],
    'download-content': ['download', 'download-content'],
    'auth-state-detect': ['auth', 'login', 'auth-state-detect'],
    'session-health-check': ['session', 'health', 'session-health-check'],
    'risk-detect': ['risk', 'restriction', 'risk-detect'],
    'recovery-plan': ['recovery', 'repair', 'recovery-plan'],
    'artifact-governance': ['artifact', 'manifest', 'artifact-governance'],
  }),
});

export const SITE_ONBOARDING_DISCOVERY_CLASSIFICATIONS = Object.freeze([
  'recognized',
  'unknown',
  'ignored',
]);

export const SITE_ONBOARDING_DISCOVERY_STATUSES = Object.freeze([
  'discovered',
  'verified',
  'observed_only',
  'unknown',
  'blocked',
  'skipped_by_budget',
  'skipped_by_policy',
  'unattempted',
  'failed_trigger',
  'duplicate_trigger',
  'requires_login',
  'requires_manual_review',
  'requires_adapter_evidence',
  'requires_schema_evidence',
  'requires_test_evidence',
]);

export const SITE_ONBOARDING_DISCOVERY_ARTIFACT_NAMES = Object.freeze([
  'NODE_INVENTORY',
  'API_INVENTORY',
  'UNKNOWN_NODE_REPORT',
  'BLOCKED_NODE_REPORT',
  'UNKNOWN_API_REPORT',
  'BLOCKED_API_REPORT',
  'CAPABILITY_TARGETS',
  'CAPABILITY_GAP_REPORT',
  'SITE_CAPABILITY_REPORT',
  'DISCOVERY_AUDIT',
]);

const CLASSIFICATION_SET = new Set(SITE_ONBOARDING_DISCOVERY_CLASSIFICATIONS);
const DISCOVERY_STATUS_SET = new Set(SITE_ONBOARDING_DISCOVERY_STATUSES);
const REQUIRED_COVERAGE_MAX = 1;
const REQUIRED_COVERAGE_MIN = 0;
const SHAPE_SUMMARY_MAX_FIELDS = 20;
const SHAPE_SUMMARY_MAX_TEXT_LENGTH = 120;
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
const SENSITIVE_EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const SENSITIVE_IP_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu;
const SENSITIVE_ACCOUNT_TEXT_PATTERN =
  /\b(?:my\s+account|account(?:\s+name)?|profile(?:\s+name)?|user(?:name)?|signed\s+in\s+as|logged\s+in\s+as)\s*[:：-]?\s+[A-Z][A-Z0-9_.-]*(?:\s+[A-Z][A-Z0-9_.-]*){0,2}/giu;

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
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, '[REDACTED]')
    .replace(SENSITIVE_EMAIL_PATTERN, '[REDACTED_EMAIL]')
    .replace(SENSITIVE_IP_PATTERN, '[REDACTED_IP]')
    .replace(SENSITIVE_ACCOUNT_TEXT_PATTERN, '[REDACTED_ACCOUNT]');
  const centrallyRedacted = redactValue(locallyRedacted).value;
  return String(centrallyRedacted)
    .replace(SENSITIVE_QUERY_PATTERN, '$1[REDACTED]')
    .replace(SENSITIVE_HEADER_PATTERN, '[REDACTED]')
    .replace(SENSITIVE_PROFILE_PATH_PATTERN, '[REDACTED]')
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, '[REDACTED]')
    .replace(SENSITIVE_EMAIL_PATTERN, '[REDACTED_EMAIL]')
    .replace(SENSITIVE_IP_PATTERN, '[REDACTED_IP]')
    .replace(SENSITIVE_ACCOUNT_TEXT_PATTERN, '[REDACTED_ACCOUNT]');
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
  const decisionStatus = normalizeText(decision.status);
  const itemStatus = normalizeText(item.status);
  let classification = normalizeText(
    decision.classification
      ?? item.classification
      ?? item.classificationStatus
      ?? (decisionStatus && CLASSIFICATION_SET.has(decisionStatus) ? decisionStatus : undefined)
      ?? (itemStatus && CLASSIFICATION_SET.has(itemStatus) ? itemStatus : undefined),
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

function normalizeDiscoveryStatusToken(value) {
  const token = normalizeTargetId(value);
  if (!token) {
    return undefined;
  }
  if (token === 'verified') {
    return 'verified';
  }
  if (
    token === 'observed'
    || token === 'observed-only'
    || token === 'observed_only'
    || token === 'candidate'
    || token === 'unverified'
  ) {
    return 'observed_only';
  }
  if (token === 'requires-login' || token === 'login-required' || token === 'auth-required') {
    return 'requires_login';
  }
  if (token === 'requires-manual-review' || token === 'manual-review' || token === 'manual-risk') {
    return 'requires_manual_review';
  }
  if (token === 'requires-adapter-evidence' || token === 'adapter-evidence-required') {
    return 'requires_adapter_evidence';
  }
  if (token === 'requires-schema-evidence' || token === 'schema-evidence-required') {
    return 'requires_schema_evidence';
  }
  if (token === 'requires-test-evidence' || token === 'test-evidence-required') {
    return 'requires_test_evidence';
  }
  if (token.includes('budget')) {
    return 'skipped_by_budget';
  }
  if (token === 'unattempted') {
    return 'unattempted';
  }
  if (token === 'failed-trigger' || token === 'trigger-failed') {
    return 'failed_trigger';
  }
  if (token === 'duplicate-trigger') {
    return 'duplicate_trigger';
  }
  if (
    token.includes('policy')
    || token === 'ignored'
    || token === 'skipped'
    || token === 'noop'
    || token === 'not-selected'
  ) {
    return 'skipped_by_policy';
  }
  if (token === 'duplicate') {
    return 'duplicate_trigger';
  }
  if (
    token === 'blocked'
    || token === 'failed'
    || token === 'error'
    || token === 'unexpandable'
    || token.includes('blocked')
    || token.includes('captcha')
    || token.includes('challenge')
    || token.includes('paywall')
    || token.includes('vip')
    || token.includes('permission')
    || token.includes('rate-limit')
    || token.includes('risk-control')
  ) {
    return 'blocked';
  }
  if (DISCOVERY_STATUS_SET.has(token)) {
    return token;
  }
  return undefined;
}

function normalizeDiscoveryStatus({
  decision = {},
  item = {},
  classification,
  kind,
  nodeKind,
  manualReviewRequired,
} = {}) {
  const explicitStatus = normalizeDiscoveryStatusToken(
    decision.discoveryStatus
      ?? decision.discovery_status
      ?? item.discoveryStatus
      ?? item.discovery_status
      ?? decision.status
      ?? item.status
      ?? item.result
      ?? item.outcome
      ?? item.blockedReason
      ?? item.blockedReasonCode
      ?? item.reason,
  );
  if (explicitStatus) {
    return explicitStatus;
  }
  if (item.requiresLogin || decision.requiresLogin || nodeKind === 'login-state' || nodeKind === 'auth-entry') {
    return 'requires_login';
  }
  if (item.blocked || decision.blocked) {
    return 'blocked';
  }
  if (manualReviewRequired) {
    return 'requires_manual_review';
  }
  if (classification === 'ignored') {
    return 'skipped_by_policy';
  }
  if (classification === 'unknown') {
    return kind === 'api' ? 'observed_only' : 'unknown';
  }
  if (decision.verified === true || item.verified === true || item.verificationState === 'verified') {
    return 'verified';
  }
  return 'discovered';
}

function blockedNodeSurfaceCategory({
  discoveryStatus,
  blockedSurface,
  gapReason,
  nodeKind,
  source,
} = {}) {
  const status = normalizeDiscoveryStatusToken(discoveryStatus);
  const text = normalizeTargetId([
    blockedSurface,
    gapReason,
    nodeKind,
    source,
    status,
  ].filter(Boolean).join(' ')) ?? '';
  if (status === 'requires_login' || text.includes('login') || text.includes('auth')) {
    return 'login_wall';
  }
  if (text.includes('paywall')) {
    return 'paywall';
  }
  if (text.includes('vip')) {
    return 'vip_restricted';
  }
  if (text.includes('captcha') || text.includes('challenge')) {
    return 'captcha_or_challenge';
  }
  if (text.includes('mfa') || text.includes('two-factor') || text.includes('2fa')) {
    return 'mfa_required';
  }
  if (text.includes('risk') || text.includes('anti-bot') || text.includes('anti-crawl')) {
    return 'risk_control';
  }
  if (text.includes('permission') || text.includes('access-denied') || text.includes('forbidden')) {
    return 'permission_restricted';
  }
  if (text.includes('rate-limit') || text.includes('throttle')) {
    return 'rate_limited';
  }
  if (status === 'skipped_by_budget') {
    return 'budget_skipped';
  }
  if (status === 'skipped_by_policy') {
    return 'policy_skipped';
  }
  if (status === 'unattempted') {
    return 'unattempted_trigger';
  }
  if (status === 'failed_trigger') {
    return 'failed_trigger';
  }
  if (status === 'duplicate_trigger') {
    return 'duplicate_trigger';
  }
  if (status === 'requires_manual_review') {
    return 'manual_review';
  }
  return 'unknown_blocked_surface';
}

function blockedSurfaceFollowUpAction(category) {
  if ([
    'login_wall',
    'paywall',
    'vip_restricted',
    'captcha_or_challenge',
    'mfa_required',
    'risk_control',
    'permission_restricted',
    'rate_limited',
    'manual_review',
  ].includes(category)) {
    return 'record-blocked-surface-and-request-manual-review';
  }
  if (category === 'budget_skipped') {
    return 'schedule-governed-budget-review';
  }
  if (category === 'policy_skipped') {
    return 'respect-policy-skip';
  }
  if (category === 'unattempted_trigger') {
    return 'queue-governed-trigger-attempt';
  }
  if (category === 'failed_trigger') {
    return 'classify-failure-before-retry';
  }
  if (category === 'duplicate_trigger') {
    return 'deduplicate-with-source-evidence';
  }
  return 'record-unknown-blocked-surface';
}

function blockedSurfaceAccessBoundary(category) {
  return [
    'login_wall',
    'paywall',
    'vip_restricted',
    'captcha_or_challenge',
    'mfa_required',
    'risk_control',
    'permission_restricted',
    'rate_limited',
  ].includes(category);
}

function safeBlockedDescriptorText(value) {
  const redacted = boundedNodeText(redactText(value));
  if (!redacted) {
    return undefined;
  }
  return redacted
    .replace(/\b(?:https?|wss?):\/\/[^\s|)]+/giu, '[REDACTED_URL]')
    .replace(/\b[A-Z]:[\\/][^\s|)]+/giu, '[REDACTED_PATH]')
    .replace(/\b[\w.-]+\.(?:mjs|cjs|js|ts|cmd|bat|ps1|sh|exe|dll)\b/giu, '[REDACTED_REF]')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/gu, '[REDACTED_NETWORK]');
}

function blockedSurfaceClassificationForNode({
  discoveryStatus,
  blockedSurface,
  gapReason,
  nodeKind,
  source,
} = {}) {
  if (!blockedStatuses().has(discoveryStatus)) {
    return undefined;
  }
  const category = blockedNodeSurfaceCategory({
    discoveryStatus,
    blockedSurface,
    gapReason,
    nodeKind,
    source,
  });
  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    classificationKind: 'blocked-node-surface',
    category,
    discoveryStatus,
    reasonCode: `site-onboarding.node.${category}`,
    blockedSurface: safeBlockedDescriptorText(blockedSurface),
    reason: safeBlockedDescriptorText(gapReason),
    accessBoundary: blockedSurfaceAccessBoundary(category),
    requiresManualReview: blockedSurfaceAccessBoundary(category) || category === 'manual_review',
    followUpAction: blockedSurfaceFollowUpAction(category),
    executableRouteAllowed: false,
    executableCapabilityAllowed: false,
    bypassProhibited: true,
    descriptorOnly: true,
    redactionRequired: true,
  });
}

function isRawProducerNodeEvidence(item = {}) {
  const token = normalizeTargetId(
    item.nodeEvidenceKind
      ?? item.evidenceKind
      ?? item.source
      ?? item.evidence?.nodeEvidenceKind
      ?? item.evidence?.source,
  );
  const explicitProducerEvidence = [
    'domnodes',
    'dom-node',
    'dom-node-summary',
    'domnodesummary',
    'domnodesummaries',
    'nodesummary',
    'nodesummaries',
    'accessibilitynodes',
    'accessibility-node',
    'accessibility-node-summary',
    'accessibilitynodesummary',
    'accessibilitynodesummaries',
    'accessibilitytree',
    'a11ynodes',
    'a11y-node',
    'a11y-node-summary',
    'a11ynodesummary',
    'a11ynodesummaries',
    'unknowndomnodes',
    'unknownaccessibilitynodes',
    'blockeddomnodes',
    'blockedaccessibilitynodes',
    'skippeddomnodes',
    'skippedaccessibilitynodes',
    'budgetskippeddomnodes',
    'budgetskippedaccessibilitynodes',
    'policyskippeddomnodes',
    'policyskippedaccessibilitynodes',
    'unattempteddomnodes',
    'unattemptedaccessibilitynodes',
    'jsroutes',
    'js-route',
    'jsroutecandidates',
    'jsroutenodes',
    'clientroutes',
    'scriptroutes',
    'script-route',
    'script-route-candidates',
    'scriptroutenodes',
    'lazyroutes',
    'lazy-route',
    'lazyroutecandidates',
    'lazyroutenodes',
    'dynamicimports',
    'dynamic-import',
    'dynamicimportcandidates',
    'dynamicimportnodes',
    'unknownjsroutes',
    'unknownjsroutenodes',
    'blockedjsroutes',
    'blockedjsroutenodes',
    'unattemptedjsroutes',
    'unattemptedjsroutenodes',
    'failedjsroutes',
    'failedjsroutenodes',
    'duplicatejsroutes',
    'duplicatejsroutenodes',
    'unknowndynamicimports',
    'blockeddynamicimports',
    'unattempteddynamicimports',
    'faileddynamicimports',
    'duplicatedynamicimports',
  ].some((value) => token === value || token.includes(value));
  if (explicitProducerEvidence) {
    return true;
  }
  return Boolean(
    item.attributeNames
      || item.attributes
      || item.attrs
      || item.tagName
      || item.role
      || item.accessibleName
      || item.textSnippet
      || item.selector
      || item.domPath
      || item.xpath
      || item.locator?.selector
      || item.locator?.domPath
      || item.locator?.xpath
      || item.locator?.role
      || item.locator?.tagName
      || item.locator?.accessibleName
      || item.locator?.textSnippet
      || item.routePath
      || item.routePattern
      || item.importSpecifier
      || item.chunkUrl
      || item.moduleId
      || item.scriptUrl,
  );
}

function normalizeVerificationState({ decision = {}, item = {}, discoveryStatus } = {}) {
  const state = normalizeTargetId(
    decision.verificationState
      ?? decision.verification_state
      ?? item.verificationState
      ?? item.verification_state,
  );
  if (state === 'verified' || discoveryStatus === 'verified') {
    return 'verified';
  }
  if (state === 'blocked' || discoveryStatus === 'blocked') {
    return 'blocked';
  }
  return 'unverified';
}

function normalizeDiscoveryItem({ item = {}, kind, siteKey, index, adapter }) {
  const decision = invokeAdapterDecision({ adapter, kind, item, siteKey, index }) ?? {};
  const classification = normalizeClassification(decision, item);
  const idText = firstNormalizedText(
    item.id
      ?? item.key
      ?? item.name
      ?? item.route
      ?? item.url
      ?? item.endpoint?.url
      ?? `${kind}-${index + 1}`,
  );
  const id = kind === 'node' ? boundedNodeText(idText) : redactText(idText);
  const locatorText = firstNormalizedText(
    item.locator
      ?? item.url
      ?? item.path
      ?? item.route
      ?? item.selector
      ?? item.endpoint?.url,
  );
  const locator = kind === 'node' ? boundedNodeText(locatorText) : redactText(locatorText);
  const labelText = firstNormalizedText(item.label, item.title, item.name, item.role, id);
  const label = kind === 'node' ? boundedNodeText(labelText) : redactText(labelText);
  const nodeKind = kind === 'node'
    ? boundedNodeText(item.kind ?? item.nodeKind ?? item.type)
    : redactText(item.kind ?? item.nodeKind ?? item.type);
  const manualReviewRequired =
    Boolean(item.manualReviewRequired)
    || (kind === 'node' && MANUAL_REVIEW_NODE_KINDS.has(String(nodeKind ?? '').trim()));
  const rawProducerNodeEvidence = kind === 'node' && isRawProducerNodeEvidence(item);
  let discoveryStatus = normalizeDiscoveryStatus({
    decision,
    item,
    classification: classification.classification,
    kind,
    nodeKind,
    manualReviewRequired,
  });
  if (rawProducerNodeEvidence && discoveryStatus === 'verified') {
    discoveryStatus = 'observed_only';
  }
  let verificationState = normalizeVerificationState({ decision, item, discoveryStatus });
  if (rawProducerNodeEvidence && verificationState === 'verified') {
    verificationState = 'unverified';
  }
  const gapReason = safeBlockedDescriptorText(
    decision.gapReason
      ?? item.gapReason
      ?? item.blockedReason
      ?? item.blockedReasonCode
      ?? item.skipReason
      ?? item.failureReason,
  );
  const blockedSurface = safeBlockedDescriptorText(decision.blockedSurface ?? item.blockedSurface ?? item.surface);
  const source = redactText(item.source ?? item.evidence?.source);
  const blockedSurfaceClassification = kind === 'node'
    ? blockedSurfaceClassificationForNode({
      discoveryStatus,
      blockedSurface,
      gapReason,
      nodeKind,
      source,
    })
    : undefined;

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
    discoveryStatus,
    verificationState,
    reason: classification.reason,
    gapReason,
    blockedSurface,
    duplicateGroupKey: redactText(item.duplicateGroupKey),
    duplicateOf: redactText(item.duplicateOf),
    recognizedAs: classification.recognizedAs,
    confidence: classification.confidence,
    method: kind === 'api' ? redactText(item.method ?? item.endpoint?.method ?? 'GET') : undefined,
    transport: kind === 'api' ? redactText(item.transport ?? item.endpoint?.transport ?? item.evidence?.transport) : undefined,
    resourceType: kind === 'api' ? redactText(item.resourceType ?? item.endpoint?.resourceType ?? item.evidence?.resourceType) : undefined,
    endpointKind: kind === 'api' ? redactText(item.endpointKind ?? item.endpoint?.endpointKind ?? item.evidence?.endpointKind) : undefined,
    roleHint: kind === 'api' ? redactText(item.roleHint ?? item.evidence?.roleHint) : undefined,
    riskClass: kind === 'api' ? redactText(item.riskClass ?? item.evidence?.riskClass) : undefined,
    parameterShape: kind === 'api' ? redactedTextArray(item.parameterShape ?? item.evidence?.parameterShape) : undefined,
    queryKeys: kind === 'api' ? redactedTextArray(item.queryKeys ?? item.evidence?.queryKeys) : undefined,
    bodyShape: kind === 'api' && isPlainObject(item.bodyShape) ? boundedShapeSummary(item.bodyShape) : undefined,
    responseShape: kind === 'api' && isPlainObject(item.responseShape) ? boundedShapeSummary(item.responseShape) : undefined,
    messageShape: kind === 'api' && isPlainObject(item.messageShape) ? boundedShapeSummary(item.messageShape) : undefined,
    statusCode: kind === 'api' && Number.isInteger(Number(item.statusCode)) ? Number(item.statusCode) : undefined,
    contentType: kind === 'api' ? redactText(item.contentType) : undefined,
    headerNames: kind === 'api' ? redactedTextArray(item.headerNames) : undefined,
    responseSchemaHash: kind === 'api' ? redactText(item.responseSchemaHash) : undefined,
    requestShapeStatus: kind === 'api' ? redactText(item.requestShapeStatus ?? item.evidence?.requestShapeStatus) : undefined,
    responseShapeStatus: kind === 'api' ? redactText(item.responseShapeStatus ?? item.evidence?.responseShapeStatus) : undefined,
    messageShapeStatus: kind === 'api' ? redactText(item.messageShapeStatus ?? item.evidence?.messageShapeStatus) : undefined,
    messageSchemaHash: kind === 'api' ? redactText(item.messageSchemaHash ?? item.evidence?.messageSchemaHash) : undefined,
    shapeGaps: kind === 'api' ? boundedApiShapeGaps(item.shapeGaps ?? item.evidence?.shapeGaps) : undefined,
    messageShapeGaps: kind === 'api'
      ? boundedApiMessageShapeGaps(item.messageShapeGaps ?? item.evidence?.messageShapeGaps)
      : undefined,
    preflight: kind === 'api' && item.evidence?.preflight === true ? true : undefined,
    preflightObserved: kind === 'api' && (item.preflightObserved === true || item.evidence?.preflightObserved === true)
      ? true
      : undefined,
    preflightCorrelation: kind === 'api'
      ? boundedPreflightCorrelation(item.preflightCorrelation ?? item.evidence?.preflightCorrelation)
      : undefined,
    multiStepCorrelation: kind === 'api'
      ? boundedApiMultiStepCorrelation(item.multiStepCorrelation ?? item.evidence?.multiStepCorrelation)
      : undefined,
    redirect: kind === 'api' ? boundedRedirectEvidence(item.evidence?.redirect) : undefined,
    nodeEvidenceKind: kind === 'node' ? boundedNodeText(item.nodeEvidenceKind ?? item.evidence?.nodeEvidenceKind) : undefined,
    tagName: kind === 'node' ? boundedNodeText(item.tagName ?? item.evidence?.tagName) : undefined,
    role: kind === 'node' ? boundedNodeText(item.role ?? item.evidence?.role) : undefined,
    accessibleName: kind === 'node' ? boundedNodeText(item.accessibleName ?? item.evidence?.accessibleName) : undefined,
    textSnippet: kind === 'node' ? boundedNodeText(item.textSnippet ?? item.evidence?.textSnippet) : undefined,
    attributeNames: kind === 'node' ? safeAttributeNames(item.attributeNames ?? item.evidence?.attributeNames) : undefined,
    routePattern: kind === 'node' ? boundedNodeText(item.routePattern ?? item.evidence?.routePattern) : undefined,
    chunkId: kind === 'node' ? boundedNodeText(item.chunkId ?? item.evidence?.chunkId) : undefined,
    moduleHint: kind === 'node' ? boundedNodeText(item.moduleHint ?? item.evidence?.moduleHint) : undefined,
    importKind: kind === 'node' ? boundedNodeText(item.importKind ?? item.evidence?.importKind) : undefined,
    producerScope: kind === 'node' ? boundedNodeText(item.producerScope ?? item.evidence?.producerScope) : undefined,
    followUpStrategy: kind === 'node'
      ? boundedTriggerFollowUpStrategy(item.followUpStrategy ?? item.evidence?.followUpStrategy)
      : undefined,
    attemptResult: kind === 'node'
      ? boundedTriggerAttemptResult(item.attemptResult ?? item.evidence?.attemptResult, discoveryStatus)
      : undefined,
    blockedSurfaceClassification,
    source,
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

function addRuntimeEvidenceDiscoveryNodes({ nodes, seen, scope, item, locator, required }) {
  const runtimeSources = [
    ['runtimeEvidence', item?.runtimeEvidence, 'runtime-evidence'],
    ['authSession', item?.authSession, 'login-state'],
    ['sessionHealth', item?.sessionHealth, 'session-health'],
    ['riskRecovery', item?.riskRecovery, 'recovery-entry'],
    ['restriction', item?.restriction, 'restriction-page'],
    ['scenario', item?.scenario, 'manual-risk'],
    ['budget', item?.budget ?? item?.summary?.budget, 'coverage-budget'],
  ];
  for (const [sourceName, rawValue, nodeKind] of runtimeSources) {
    const value = redactedPlainObject(rawValue);
    const keys = Object.keys(value).map(safeFieldName).filter(Boolean).sort();
    if (keys.length === 0) {
      continue;
    }
    addUniqueDiscoveryItem(nodes, seen, {
      id: `${scope}:${sourceName}:${keys.join('-')}`,
      label: `${sourceName}.${keys.join(',')}`,
      locator,
      nodeKind,
      source: sourceName,
      required,
      evidence: {
        source: sourceName,
        fieldKeys: keys,
      },
    }, 'node');
  }
  for (const [index, rawWarning] of toArray(item?.warnings).entries()) {
    const warning = redactText(rawWarning);
    if (!warning) {
      continue;
    }
    addUniqueDiscoveryItem(nodes, seen, {
      id: `${scope}:warning:${index + 1}`,
      label: warning,
      locator,
      nodeKind: 'empty-error-state',
      source: 'warning',
      required,
    }, 'node');
  }
}

function boundedNodeText(value) {
  const text = redactText(value);
  return text ? text.slice(0, SHAPE_SUMMARY_MAX_TEXT_LENGTH) : undefined;
}

function boundedNodeTextArray(value) {
  return redactedTextArray(value)
    .map((item) => item.slice(0, SHAPE_SUMMARY_MAX_TEXT_LENGTH))
    .filter(Boolean);
}

function safeAttributeNames(value) {
  const rawNames = Array.isArray(value)
    ? value
    : Object.keys(isPlainObject(value) ? value : {});
  return rawNames
    .map(safeFieldName)
    .filter(Boolean)
    .slice(0, SHAPE_SUMMARY_MAX_FIELDS);
}

function nodeSummaryLocator(raw = {}) {
  return firstNormalizedText(
    raw.locator?.href,
    raw.locator?.url,
    raw.locator?.selector,
    raw.locator?.domPath,
    raw.locator?.xpath,
    raw.locator?.id,
    raw.href,
    raw.url,
    raw.selector,
    raw.domPath,
    raw.xpath,
    raw.path,
    raw.id,
    raw.backendNodeId,
    raw.nodeId,
  );
}

function nodeSummaryKind(raw = {}, fallback = 'dom-node') {
  return boundedNodeText(firstNormalizedText(
    raw.nodeKind,
    raw.kind,
    raw.type,
    raw.role,
    raw.tagName,
    fallback,
  ));
}

function nodeSummaryStatusFromScope(scope) {
  const token = normalizeTargetId(scope);
  if (!token) {
    return undefined;
  }
  if (token.includes('blocked')) {
    return 'blocked';
  }
  if (token.includes('unknown')) {
    return 'unknown';
  }
  if (token.includes('budget')) {
    return 'skipped_by_budget';
  }
  if (token.includes('policy') || token.includes('skipped')) {
    return 'skipped_by_policy';
  }
  if (token.includes('unattempted')) {
    return 'unattempted';
  }
  return undefined;
}

function addNodeSummaryDiscoveryNode({ nodes, seen, scope, raw, required, source, fallbackKind }) {
  if (!isPlainObject(raw)) {
    return;
  }
  const nodeKind = nodeSummaryKind(raw, fallbackKind);
  const label = boundedNodeText(firstNormalizedText(
    raw.label,
    raw.title,
    raw.accessibleName,
    raw.name,
    raw.textSnippet,
    raw.text,
    raw.innerText,
    raw.textContent,
    nodeKind,
  ));
  const locator = boundedNodeText(nodeSummaryLocator(raw));
  const rawStatus = firstNormalizedText(
    raw.discoveryStatus,
    raw.status,
    raw.outcome,
    raw.reasonCode,
    raw.reason,
    raw.blockedReason,
  );
  let discoveryStatus = normalizeDiscoveryStatusToken(rawStatus)
    ?? nodeSummaryStatusFromScope(scope)
    ?? 'observed_only';
  if (discoveryStatus === 'verified') {
    discoveryStatus = 'observed_only';
  }
  const tagName = boundedNodeText(raw.tagName ?? raw.locator?.tagName);
  const role = boundedNodeText(raw.role ?? raw.locator?.role);
  const accessibleName = boundedNodeText(firstNormalizedText(
    raw.accessibleName,
    raw.name,
    raw.locator?.accessibleName,
  ));
  const textSnippet = boundedNodeText(firstNormalizedText(
    raw.textSnippet,
    raw.locator?.textSnippet,
    raw.text,
    raw.innerText,
    raw.textContent,
  ));
  const attributeNames = safeAttributeNames(raw.attributeNames ?? raw.attributes ?? raw.attrs);
  addUniqueDiscoveryItem(nodes, seen, {
    id: `${scope}:${raw.id ?? raw.nodeId ?? raw.backendNodeId ?? locator ?? label ?? nodeKind ?? 'node'}`,
    label: label ?? nodeKind ?? 'node',
    locator,
    nodeKind,
    nodeEvidenceKind: source,
    tagName,
    role,
    accessibleName,
    textSnippet,
    ...(attributeNames.length ? { attributeNames } : {}),
    source,
    producerScope: scope,
    status: discoveryStatus,
    discoveryStatus,
    gapReason: boundedNodeText(firstNormalizedText(
      raw.gapReason,
      raw.blockedReason,
      raw.reason,
      raw.reasonCode,
      raw.skipReason,
      raw.failureReason,
    )),
    blockedSurface: boundedNodeText(firstNormalizedText(raw.blockedSurface, raw.surface, source)),
    required: Boolean(raw.required ?? required),
  }, 'node');
}

function flattenNodeSummaryItems(value) {
  const result = [];
  const stack = [...toArray(value)];
  while (stack.length > 0) {
    const item = stack.shift();
    if (!isPlainObject(item)) {
      continue;
    }
    result.push(item);
    for (const key of ['children', 'childNodes', 'nodes', 'items']) {
      for (const child of toArray(item[key])) {
        if (isPlainObject(child)) {
          stack.push(child);
        }
      }
    }
  }
  return result;
}

function collectNodeSummaryInputs(input = {}) {
  return [
    ['domNodes', 'dom-node', input.domNodes],
    ['domNodes', 'dom-node', input.dom_nodes],
    ['domNodes', 'dom-node', input.domNodeSummaries],
    ['domNodes', 'dom-node', input.nodeSummaries],
    ['domNodes', 'dom-node', input.summary?.domNodes],
    ['domNodes', 'dom-node', input.summary?.domNodeSummaries],
    ['domNodes', 'dom-node', input.manifest?.domNodes],
    ['accessibilityNodes', 'a11y-node', input.accessibilityNodes],
    ['accessibilityNodes', 'a11y-node', input.a11yNodes],
    ['accessibilityNodes', 'a11y-node', input.accessibilityTree],
    ['accessibilityNodes', 'a11y-node', input.accessibilityNodeSummaries],
    ['accessibilityNodes', 'a11y-node', input.a11yNodeSummaries],
    ['accessibilityNodes', 'a11y-node', input.summary?.accessibilityNodes],
    ['accessibilityNodes', 'a11y-node', input.summary?.a11yNodes],
    ['accessibilityNodes', 'a11y-node', input.summary?.a11yNodeSummaries],
    ['accessibilityNodes', 'a11y-node', input.manifest?.accessibilityNodes],
    ['unknownDomNodes', 'dom-node', input.unknownDomNodes],
    ['unknownDomNodes', 'dom-node', input.summary?.unknownDomNodes],
    ['unknownAccessibilityNodes', 'a11y-node', input.unknownAccessibilityNodes],
    ['unknownAccessibilityNodes', 'a11y-node', input.unknownA11yNodes],
    ['unknownAccessibilityNodes', 'a11y-node', input.summary?.unknownAccessibilityNodes],
    ['blockedDomNodes', 'dom-node', input.blockedDomNodes],
    ['blockedDomNodes', 'dom-node', input.summary?.blockedDomNodes],
    ['blockedAccessibilityNodes', 'a11y-node', input.blockedAccessibilityNodes],
    ['blockedAccessibilityNodes', 'a11y-node', input.blockedA11yNodes],
    ['blockedAccessibilityNodes', 'a11y-node', input.summary?.blockedAccessibilityNodes],
    ['skippedDomNodes', 'dom-node', input.skippedDomNodes],
    ['skippedAccessibilityNodes', 'a11y-node', input.skippedAccessibilityNodes],
    ['budgetSkippedDomNodes', 'dom-node', input.budgetSkippedDomNodes],
    ['budgetSkippedAccessibilityNodes', 'a11y-node', input.budgetSkippedAccessibilityNodes],
    ['policySkippedDomNodes', 'dom-node', input.policySkippedDomNodes],
    ['policySkippedAccessibilityNodes', 'a11y-node', input.policySkippedAccessibilityNodes],
    ['unattemptedDomNodes', 'dom-node', input.unattemptedDomNodes],
    ['unattemptedAccessibilityNodes', 'a11y-node', input.unattemptedAccessibilityNodes],
  ].flatMap(([source, fallbackKind, values]) =>
    flattenNodeSummaryItems(values).map((raw) => ({
      source,
      fallbackKind,
      raw,
    })));
}

function addNodeSummaryDiscoveryNodes({ nodes, seen, scope, input, required }) {
  for (const { source, fallbackKind, raw } of collectNodeSummaryInputs(input)) {
    addNodeSummaryDiscoveryNode({
      nodes,
      seen,
      scope: `${scope}.${source}`,
      raw,
      required,
      source,
      fallbackKind,
    });
  }
}

function jsRouteStatusFromScope(scope) {
  const token = normalizeTargetId(scope);
  if (!token) {
    return undefined;
  }
  if (token.includes('blocked')) {
    return 'blocked';
  }
  if (token.includes('unknown')) {
    return 'unknown';
  }
  if (token.includes('budget')) {
    return 'skipped_by_budget';
  }
  if (token.includes('policy') || token.includes('skipped')) {
    return 'skipped_by_policy';
  }
  if (token.includes('unattempted')) {
    return 'unattempted';
  }
  if (token.includes('failed')) {
    return 'failed_trigger';
  }
  if (token.includes('duplicate')) {
    return 'duplicate_trigger';
  }
  return undefined;
}

function jsRouteKindFromSource(source) {
  const token = normalizeTargetId(source);
  if (token.includes('dynamicimport')) {
    return 'dynamic-import';
  }
  if (token.includes('lazy')) {
    return 'lazy-route';
  }
  if (token.includes('script')) {
    return 'script-route';
  }
  return 'js-route';
}

function jsRouteLocator(raw = {}) {
  return firstNormalizedText(
    raw.routePath,
    raw.path,
    raw.route,
    raw.href,
    raw.url,
    raw.chunkUrl,
    raw.scriptUrl,
    raw.importUrl,
    raw.importSpecifier,
    raw.modulePath,
    raw.moduleId,
    raw.id,
  );
}

const JS_ROUTE_FORBIDDEN_FIELD_PATTERN =
  /^(?:rawSource|sourceText|sourceCode|scriptText|scriptSource|moduleSource|chunkSource|functionBody|handler|stack|sourceMap|headers|requestHeaders|cookie|authorization|session.*|profile.*|browserProfile.*|userDataDir|storageState|localStorage|sessionStorage)$/iu;

function assertSafeJsRouteEvidence(raw, path = 'js-route') {
  if (!isPlainObject(raw)) {
    return;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (JS_ROUTE_FORBIDDEN_FIELD_PATTERN.test(key)) {
      throw new Error(`Unsafe JS route discovery evidence field: ${path}.${key}`);
    }
    if (isPlainObject(value)) {
      assertSafeJsRouteEvidence(value, `${path}.${key}`);
    }
    for (const [index, item] of toArray(value).entries()) {
      if (isPlainObject(item)) {
        assertSafeJsRouteEvidence(item, `${path}.${key}[${index}]`);
      }
    }
  }
}

function addJsRouteDiscoveryNode({ nodes, seen, scope, raw, required, source }) {
  if (!isPlainObject(raw)) {
    return;
  }
  assertSafeJsRouteEvidence(raw, source);
  const nodeKind = boundedNodeText(raw.nodeKind ?? raw.kind ?? raw.type ?? jsRouteKindFromSource(source));
  const label = boundedNodeText(firstNormalizedText(
    raw.label,
    raw.name,
    raw.routeName,
    raw.routePath,
    raw.routePattern,
    raw.importSpecifier,
    raw.moduleId,
    nodeKind,
  ));
  const locator = boundedNodeText(jsRouteLocator(raw));
  const rawStatus = firstNormalizedText(
    raw.discoveryStatus,
    raw.status,
    raw.outcome,
    raw.reasonCode,
    raw.reason,
    raw.blockedReason,
  );
  let discoveryStatus = normalizeDiscoveryStatusToken(rawStatus)
    ?? jsRouteStatusFromScope(scope)
    ?? 'observed_only';
  if (discoveryStatus === 'verified') {
    discoveryStatus = 'observed_only';
  }
  addUniqueDiscoveryItem(nodes, seen, {
    id: `${scope}:${raw.id ?? raw.routeId ?? raw.moduleId ?? locator ?? label ?? nodeKind ?? 'js-route'}`,
    label: label ?? nodeKind ?? 'js-route',
    locator,
    nodeKind,
    nodeEvidenceKind: source,
    routePattern: boundedNodeText(raw.routePattern ?? raw.pattern),
    chunkId: boundedNodeText(raw.chunkId ?? raw.chunkName),
    moduleHint: boundedNodeText(raw.moduleId ?? raw.moduleName ?? raw.importSpecifier),
    importKind: boundedNodeText(raw.importKind ?? raw.kind ?? jsRouteKindFromSource(source)),
    source,
    producerScope: scope,
    status: discoveryStatus,
    discoveryStatus,
    gapReason: boundedNodeText(firstNormalizedText(
      raw.gapReason,
      raw.blockedReason,
      raw.reason,
      raw.reasonCode,
      raw.skipReason,
      raw.failureReason,
    )),
    blockedSurface: boundedNodeText(firstNormalizedText(raw.blockedSurface, raw.surface, source)),
    required: Boolean(raw.required ?? required),
  }, 'node');
}

function collectJsRouteInputs(input = {}) {
  return [
    ['jsRoutes', input.jsRoutes],
    ['jsRoutes', input.jsRouteCandidates],
    ['jsRoutes', input.jsRouteNodes],
    ['jsRoutes', input.clientRoutes],
    ['jsRoutes', input.routeCandidates],
    ['jsRoutes', input.summary?.jsRoutes],
    ['jsRoutes', input.summary?.jsRouteCandidates],
    ['jsRoutes', input.summary?.jsRouteNodes],
    ['jsRoutes', input.summary?.clientRoutes],
    ['jsRoutes', input.manifest?.jsRoutes],
    ['jsRoutes', input.manifest?.jsRouteNodes],
    ['scriptRoutes', input.scriptRoutes],
    ['scriptRoutes', input.scriptRouteCandidates],
    ['scriptRoutes', input.scriptRouteNodes],
    ['scriptRoutes', input.summary?.scriptRoutes],
    ['lazyRoutes', input.lazyRoutes],
    ['lazyRoutes', input.lazyRouteCandidates],
    ['lazyRoutes', input.lazyRouteNodes],
    ['lazyRoutes', input.summary?.lazyRoutes],
    ['lazyRoutes', input.summary?.lazyRouteCandidates],
    ['lazyRoutes', input.summary?.lazyRouteNodes],
    ['dynamicImports', input.dynamicImports],
    ['dynamicImports', input.dynamicImportCandidates],
    ['dynamicImports', input.dynamicImportNodes],
    ['dynamicImports', input.summary?.dynamicImports],
    ['dynamicImports', input.summary?.dynamicImportCandidates],
    ['dynamicImports', input.summary?.dynamicImportNodes],
    ['unknownJsRoutes', input.unknownJsRoutes],
    ['unknownJsRoutes', input.unknownJsRouteNodes],
    ['unknownJsRoutes', input.summary?.unknownJsRoutes],
    ['unknownLazyRoutes', input.unknownLazyRoutes],
    ['unknownLazyRoutes', input.unknownLazyRouteNodes],
    ['blockedJsRoutes', input.blockedJsRoutes],
    ['blockedJsRoutes', input.blockedJsRouteNodes],
    ['blockedJsRoutes', input.summary?.blockedJsRoutes],
    ['blockedLazyRoutes', input.blockedLazyRoutes],
    ['blockedLazyRoutes', input.blockedLazyRouteNodes],
    ['skippedJsRoutes', input.skippedJsRoutes],
    ['budgetSkippedJsRoutes', input.budgetSkippedJsRoutes],
    ['policySkippedJsRoutes', input.policySkippedJsRoutes],
    ['unattemptedJsRoutes', input.unattemptedJsRoutes],
    ['unattemptedJsRoutes', input.unattemptedJsRouteNodes],
    ['unattemptedLazyRoutes', input.unattemptedLazyRoutes],
    ['unattemptedLazyRoutes', input.unattemptedLazyRouteNodes],
    ['failedJsRoutes', input.failedJsRoutes],
    ['failedJsRoutes', input.failedJsRouteNodes],
    ['duplicateJsRoutes', input.duplicateJsRoutes],
    ['duplicateJsRoutes', input.duplicateJsRouteNodes],
    ['unknownDynamicImports', input.unknownDynamicImports],
    ['unknownDynamicImports', input.unknownDynamicImportNodes],
    ['blockedDynamicImports', input.blockedDynamicImports],
    ['blockedDynamicImports', input.blockedDynamicImportNodes],
    ['skippedDynamicImports', input.skippedDynamicImports],
    ['unattemptedDynamicImports', input.unattemptedDynamicImports],
    ['failedDynamicImports', input.failedDynamicImports],
    ['duplicateDynamicImports', input.duplicateDynamicImports],
  ].flatMap(([source, values]) =>
    toArray(values)
      .filter(isPlainObject)
      .map((raw) => ({ source, raw })));
}

function addJsRouteDiscoveryNodes({ nodes, seen, scope, input, required }) {
  for (const { source, raw } of collectJsRouteInputs(input)) {
    addJsRouteDiscoveryNode({
      nodes,
      seen,
      scope: `${scope}.${source}`,
      raw,
      required,
      source,
    });
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

function discoveryStatusFromTriggerGapScope(scope) {
  const token = normalizeTargetId(scope);
  if (!token) {
    return undefined;
  }
  if (token.includes('budget-skipped-trigger')) {
    return 'skipped_by_budget';
  }
  if (token.includes('candidate-trigger')) {
    return 'discovered';
  }
  if (token.includes('unattempted-trigger')) {
    return 'unattempted';
  }
  if (token.includes('failed-trigger')) {
    return 'failed_trigger';
  }
  if (token.includes('duplicate-trigger')) {
    return 'duplicate_trigger';
  }
  if (token.includes('policy-skipped-trigger') || token.includes('skipped-trigger')) {
    return 'skipped_by_policy';
  }
  return undefined;
}

function boundedTriggerFollowUpStrategy(rawStrategy = undefined) {
  if (!isPlainObject(rawStrategy)) {
    return undefined;
  }
  const action = boundedNodeText(rawStrategy.action);
  const retryClass = boundedNodeText(rawStrategy.retryClass);
  if (!action || !retryClass) {
    return undefined;
  }
  return redactedPlainObject({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    gapKind: boundedNodeText(rawStrategy.gapKind),
    discoveryStatus: normalizeDiscoveryStatusToken(rawStrategy.discoveryStatus),
    action,
    retryClass,
    retryAllowed: rawStrategy.retryAllowed === true,
    requiresManualReview: rawStrategy.requiresManualReview === true,
    reasonCode: boundedNodeText(rawStrategy.reasonCode),
    descriptorOnly: true,
    redactionRequired: true,
  });
}

function triggerGapFollowUpStrategy({ discoveryStatus, scope, trigger }) {
  const status = normalizeDiscoveryStatusToken(discoveryStatus) ?? discoveryStatusFromTriggerGapScope(scope);
  const reasonCode = boundedNodeText(firstNormalizedText(trigger?.reasonCode, status));
  const base = {
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    gapKind: 'interaction-trigger-gap',
    discoveryStatus: status,
    reasonCode,
    descriptorOnly: true,
    redactionRequired: true,
  };
  if (status === 'skipped_by_budget') {
    return boundedTriggerFollowUpStrategy({
      ...base,
      action: 'retry-with-expanded-controlled-budget',
      retryClass: 'budget-expansion',
      retryAllowed: true,
      requiresManualReview: false,
    });
  }
  if (status === 'unattempted') {
    return boundedTriggerFollowUpStrategy({
      ...base,
      action: 'attempt-in-next-controlled-discovery-pass',
      retryClass: 'safe-trigger-attempt',
      retryAllowed: true,
      requiresManualReview: false,
    });
  }
  if (status === 'failed_trigger') {
    return boundedTriggerFollowUpStrategy({
      ...base,
      action: 'classify-failure-before-retry',
      retryClass: 'failure-review',
      retryAllowed: false,
      requiresManualReview: true,
    });
  }
  if (status === 'duplicate_trigger') {
    return boundedTriggerFollowUpStrategy({
      ...base,
      action: 'merge-with-existing-trigger-evidence',
      retryClass: 'deduplicate',
      retryAllowed: false,
      requiresManualReview: false,
    });
  }
  if (status === 'skipped_by_policy') {
    return boundedTriggerFollowUpStrategy({
      ...base,
      action: 'respect-policy-stop-and-record-gap',
      retryClass: 'policy-blocked',
      retryAllowed: false,
      requiresManualReview: false,
    });
  }
  return undefined;
}

function boundedTriggerAttemptResult(rawAttempt = undefined, fallbackStatus = undefined) {
  if (!isPlainObject(rawAttempt)) {
    return undefined;
  }
  const attempted = rawAttempt.attempted === true;
  const attemptCountNumber = Number(rawAttempt.attemptCount ?? rawAttempt.attempts ?? rawAttempt.count);
  const attemptCount = Number.isFinite(attemptCountNumber)
    ? Math.max(0, Math.min(100, Math.trunc(attemptCountNumber)))
    : (attempted ? 1 : 0);
  return redactedPlainObject({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    attempted,
    attemptCount,
    lastAttemptStatus: normalizeDiscoveryStatusToken(
      rawAttempt.lastAttemptStatus
      ?? rawAttempt.discoveryStatus
      ?? rawAttempt.status
      ?? rawAttempt.outcome
      ?? fallbackStatus,
    ) ?? boundedNodeText(fallbackStatus),
    reasonCode: boundedNodeText(firstNormalizedText(rawAttempt.reasonCode, rawAttempt.failureCode)),
    governedAttempt: rawAttempt.governedAttempt === true,
    retryExecuted: rawAttempt.retryExecuted === true,
    descriptorOnly: true,
    redactionRequired: true,
  });
}

function triggerAttemptResult({ trigger, discoveryStatus }) {
  return boundedTriggerAttemptResult({
    ...trigger?.attemptResult,
    attempted: trigger?.attemptResult?.attempted ?? trigger?.attempted,
    attemptCount: trigger?.attemptResult?.attemptCount ?? trigger?.attemptCount ?? trigger?.attempts,
    lastAttemptStatus: trigger?.attemptResult?.lastAttemptStatus
      ?? trigger?.lastAttemptStatus
      ?? trigger?.discoveryStatus
      ?? trigger?.status
      ?? trigger?.outcome
      ?? discoveryStatus,
    reasonCode: trigger?.attemptResult?.reasonCode ?? trigger?.reasonCode,
    governedAttempt: trigger?.attemptResult?.governedAttempt ?? trigger?.governedAttempt,
    retryExecuted: trigger?.attemptResult?.retryExecuted ?? trigger?.retryExecuted,
  }, discoveryStatus);
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
    status: redactText(firstNormalizedText(state?.status, state?.outcome)),
    gapReason: redactText(firstNormalizedText(state?.error?.message, state?.error, state?.reason, state?.reasonCode)),
    required,
    evidence: {
      source: 'expand-trigger',
      stateId,
      pageType: redactText(state?.pageType ?? state?.page_type ?? state?.semanticPageType),
    },
  }, 'node');
}

function addTriggerGapDiscoveryNode({ nodes, seen, scope, trigger, required }) {
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
  const locator = redactText(triggerLocator(trigger) ?? trigger.finalUrl ?? trigger.url);
  const rawStatus = firstNormalizedText(
    trigger.discoveryStatus,
    trigger.status,
    trigger.outcome,
    trigger.reasonCode,
    trigger.reason,
  );
  const scopeStatus = discoveryStatusFromTriggerGapScope(scope);
  const discoveryStatus = normalizeDiscoveryStatusToken(rawStatus) ?? scopeStatus ?? 'unknown';
  const followUpStrategy = triggerGapFollowUpStrategy({ discoveryStatus, scope, trigger });
  const attemptResult = triggerAttemptResult({ trigger, discoveryStatus });
  addUniqueDiscoveryItem(nodes, seen, {
    id: `${scope}:trigger-gap:${triggerKind ?? 'trigger'}:${locator ?? label ?? 'unknown'}`,
    label: label ?? triggerKind ?? 'trigger',
    locator,
    nodeKind: triggerKind ?? 'trigger',
    source: scope,
    status: rawStatus ?? scopeStatus ?? 'unknown',
    discoveryStatus,
    gapReason: redactText(trigger.gapReason ?? trigger.reason ?? trigger.reasonCode ?? rawStatus ?? scopeStatus),
    ...(followUpStrategy ? { followUpStrategy } : {}),
    ...(attemptResult ? { attemptResult } : {}),
    required,
    evidence: {
      source: scope,
      stateId: redactText(firstNormalizedText(trigger.stateId, trigger.fromState, trigger.parentStateId)),
      ...(followUpStrategy ? { followUpStrategy } : {}),
      ...(attemptResult ? { attemptResult } : {}),
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
  addNodeSummaryDiscoveryNodes({
    nodes,
    seen,
    scope,
    input: state,
    required,
  });
  addJsRouteDiscoveryNodes({
    nodes,
    seen,
    scope,
    input: state,
    required,
  });
}

function collectTriggerGapInputs(input = {}) {
  const rawGroups = [
    ['candidate-trigger', input.candidateTriggers],
    ['candidate-trigger', input.discoveredTriggers],
    ['candidate-trigger', input.summary?.candidateTriggers],
    ['candidate-trigger', input.summary?.discoveredTriggers],
    ['skipped-trigger', input.skippedTriggers],
    ['skipped-trigger', input.summary?.skippedTriggers],
    ['budget-skipped-trigger', input.budgetSkippedTriggers],
    ['budget-skipped-trigger', input.summary?.budgetSkippedTriggers],
    ['policy-skipped-trigger', input.policySkippedTriggers],
    ['policy-skipped-trigger', input.summary?.policySkippedTriggers],
    ['failed-trigger', input.failedTriggers],
    ['failed-trigger', input.summary?.failedTriggers],
    ['duplicate-trigger', input.duplicateTriggers],
    ['duplicate-trigger', input.summary?.duplicateTriggers],
    ['unattempted-trigger', input.unattemptedTriggers],
    ['unattempted-trigger', input.summary?.unattemptedTriggers],
    ['unexpandable-path', input.unexpandablePaths],
    ['unexpandable-path', input.summary?.unexpandablePaths],
    ['trigger-attempt-result', input.triggerAttemptResults],
    ['trigger-attempt-result', input.summary?.triggerAttemptResults],
    ['trigger-attempt-result', input.governedRetryAttempts],
    ['trigger-attempt-result', input.summary?.governedRetryAttempts],
    ['candidate-trigger', input.manifest?.candidateTriggers],
    ['skipped-trigger', input.manifest?.skippedTriggers],
    ['failed-trigger', input.manifest?.failedTriggers],
    ['trigger-attempt-result', input.manifest?.triggerAttemptResults],
    ['trigger-attempt-result', input.manifest?.governedRetryAttempts],
  ];
  return rawGroups.flatMap(([scope, triggers]) =>
    toArray(triggers)
      .filter(isPlainObject)
      .map((trigger) => ({
        scope,
        trigger,
      })));
}

function endpointUrlFromApiLike(raw = {}) {
  return firstNormalizedText(
    raw.endpoint?.url,
    raw.request?.url,
    raw.url,
    raw.href,
    raw.resourceUrl,
    raw.response?.url,
    raw.candidateId,
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

function endpointTransportFromApiLike(raw = {}) {
  return redactText(firstNormalizedText(
    raw.transport,
    raw.endpoint?.transport,
    raw.target?.transport,
    raw.evidence?.transport,
  ));
}

function endpointResourceTypeFromApiLike(raw = {}) {
  return redactText(firstNormalizedText(
    raw.resourceType,
    raw.endpoint?.resourceType,
    raw.target?.resourceType,
    raw.evidence?.resourceType,
  ));
}

function redactedTextArray(value) {
  return toArray(value)
    .map((item) => redactText(item))
    .filter(Boolean);
}

function boundedShapeText(value) {
  const text = redactText(value);
  return text ? text.slice(0, SHAPE_SUMMARY_MAX_TEXT_LENGTH) : undefined;
}

function boundedShapeTextArray(value) {
  return redactedTextArray(value)
    .slice(0, SHAPE_SUMMARY_MAX_FIELDS)
    .map((item) => item.slice(0, SHAPE_SUMMARY_MAX_TEXT_LENGTH));
}

function boundedShapeSummary(value = undefined) {
  if (!isPlainObject(value)) {
    return {};
  }
  return redactedPlainObject({
    type: boundedShapeText(value.type),
    fieldNames: boundedShapeTextArray(value.fieldNames ?? value.fields),
    requiredFields: boundedShapeTextArray(value.requiredFields ?? value.required),
    itemType: boundedShapeText(value.itemType ?? value.elementType),
    propertyCount: value.propertyCount,
    schemaHash: boundedShapeText(value.schemaHash ?? value.responseSchemaHash ?? value.bodySchemaHash),
  });
}

function boundedRedirectEvidence(rawRedirect = undefined) {
  if (!isPlainObject(rawRedirect)) {
    return undefined;
  }
  return redactedPlainObject({
    statusCode: rawRedirect.statusCode ?? rawRedirect.status,
    url: rawRedirect.url,
    mimeType: rawRedirect.mimeType,
  });
}

function boundedPreflightCorrelation(rawCorrelation = undefined) {
  if (!isPlainObject(rawCorrelation)) {
    return undefined;
  }
  return redactedPlainObject({
    status: rawCorrelation.status,
    canonicalEndpointPathKey: rawCorrelation.canonicalEndpointPathKey,
    followUpCandidateIds: redactedTextArray(rawCorrelation.followUpCandidateIds),
    preflightCandidateIds: redactedTextArray(rawCorrelation.preflightCandidateIds),
    observedOnly: rawCorrelation.observedOnly === true,
    catalogPromotionAllowed: rawCorrelation.catalogPromotionAllowed === true ? true : false,
    redactionRequired: true,
  });
}

function safeApiCorrelationRef(value) {
  const token = normalizeTargetId(redactText(value));
  if (!token) {
    return undefined;
  }
  if (
    token.includes('redacted')
    || token.includes('http')
    || token.includes('wss')
    || token.includes('authorization')
    || token.includes('appdata')
    || token.includes('browser-profile')
    || token.includes('browserprofile')
    || token.includes('cookie')
    || token.includes('csrf')
    || token.includes('sessdata')
    || token.includes('session-id')
    || token.includes('token')
    || token.includes('user-data-dir')
    || /\b\d{1,3}(?:-\d{1,3}){3}\b/u.test(token)
    || /\.(?:cmd|bat|ps1|sh|exe|dll|mjs|cjs|js)$/iu.test(String(value ?? ''))
  ) {
    return 'redacted-correlation-ref';
  }
  return token.slice(0, SHAPE_SUMMARY_MAX_TEXT_LENGTH);
}

function safeApiCorrelationRefs(value) {
  return toArray(value)
    .map(safeApiCorrelationRef)
    .filter(Boolean)
    .slice(0, 10);
}

function boundedApiSequenceIndex(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return Math.max(0, Math.min(1000, Math.trunc(numeric)));
}

function boundedApiMultiStepCorrelation(rawCorrelation = undefined) {
  if (!isPlainObject(rawCorrelation)) {
    return undefined;
  }
  const flowId = safeApiCorrelationRef(
    rawCorrelation.flowId
      ?? rawCorrelation.flow
      ?? rawCorrelation.correlationId
      ?? rawCorrelation.interactionId,
  );
  const triggerId = safeApiCorrelationRef(rawCorrelation.triggerId ?? rawCorrelation.trigger);
  const initiatorNodeId = safeApiCorrelationRef(
    rawCorrelation.initiatorNodeId
      ?? rawCorrelation.sourceNodeId
      ?? rawCorrelation.nodeId,
  );
  const previousRequestIds = safeApiCorrelationRefs(
    rawCorrelation.previousRequestIds
      ?? rawCorrelation.previousCandidateIds
      ?? rawCorrelation.previous,
  );
  const nextRequestIds = safeApiCorrelationRefs(
    rawCorrelation.nextRequestIds
      ?? rawCorrelation.nextCandidateIds
      ?? rawCorrelation.next,
  );
  const relatedCandidateIds = safeApiCorrelationRefs(
    rawCorrelation.relatedCandidateIds
      ?? rawCorrelation.relatedRequestIds
      ?? rawCorrelation.related,
  );
  const hasCorrelation = Boolean(
    flowId
      || triggerId
      || initiatorNodeId
      || previousRequestIds.length
      || nextRequestIds.length
      || relatedCandidateIds.length,
  );
  if (!hasCorrelation) {
    return undefined;
  }
  return redactedPlainObject({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    correlationKind: 'api-multi-step-flow',
    status: 'observed',
    reasonCode: 'site-onboarding.api.multi_step_correlation_observed',
    flowId,
    triggerId,
    initiatorNodeId,
    sequenceIndex: boundedApiSequenceIndex(rawCorrelation.sequenceIndex ?? rawCorrelation.stepIndex),
    previousRequestIds,
    nextRequestIds,
    relatedCandidateIds,
    requestPhase: safeApiCorrelationRef(rawCorrelation.requestPhase ?? rawCorrelation.phase),
    responsePhase: safeApiCorrelationRef(rawCorrelation.responsePhase),
    observedOnly: true,
    catalogPromotionAllowed: false,
    verifiedCatalogAllowed: false,
    executionPlanAllowed: false,
    descriptorOnly: true,
    redactionRequired: true,
  });
}

function boundedApiShapeGaps(rawGaps = undefined) {
  const gaps = toArray(rawGaps)
    .filter(isPlainObject)
    .slice(0, 4)
    .map((gap) => redactedPlainObject({
      schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
      gapKind: gap.gapKind,
      reasonCode: gap.reasonCode,
      evidenceStatus: gap.evidenceStatus,
      reason: gap.reason,
      descriptorOnly: gap.descriptorOnly === true,
      redactionRequired: true,
    }));
  return gaps.length ? gaps : undefined;
}

function boundedApiMessageShapeGaps(rawGaps = undefined) {
  const gaps = toArray(rawGaps)
    .filter(isPlainObject)
    .slice(0, 4)
    .map((gap) => redactedPlainObject({
      schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
      gapKind: gap.gapKind,
      reasonCode: gap.reasonCode,
      evidenceStatus: gap.evidenceStatus,
      reason: gap.reason,
      descriptorOnly: gap.descriptorOnly === true,
      redactionRequired: true,
    }));
  return gaps.length ? gaps : undefined;
}

function safeDuplicateEndpointSegment(value) {
  const token = normalizeTargetId(redactText(value));
  if (!token) {
    return undefined;
  }
  if (
    token === 'redacted'
    || token.includes('redacted')
    || /^\d+$/u.test(token)
    || /\b\d{1,3}(?:-\d{1,3}){3}\b/u.test(token)
    || /\.(?:cmd|bat|ps1|sh|exe|dll|mjs|cjs|js)$/iu.test(token)
    || /(?:access-token|authorization|browser-profile|cookie|csrf|sessdata|session-id|token|user-data-dir)/u.test(token)
  ) {
    return 'redacted-segment';
  }
  return token.slice(0, SHAPE_SUMMARY_MAX_TEXT_LENGTH);
}

function apiDuplicateLocatorKey(locator) {
  const redactedLocator = redactText(locator);
  try {
    const parsed = new URL(redactedLocator);
    const host = safeDuplicateEndpointSegment(parsed.hostname) ?? 'redacted-host';
    const segments = parsed.pathname
      .split('/')
      .map(safeDuplicateEndpointSegment)
      .filter(Boolean);
    return [host, ...segments].join(':') || host;
  } catch {
    return safeDuplicateEndpointSegment(String(redactedLocator ?? '').split(/[?#]/u)[0]) ?? 'unknown-endpoint';
  }
}

function apiDuplicateGroupKey({ method, locator }) {
  return [
    safeDuplicateEndpointSegment(method ?? 'GET') ?? 'get',
    apiDuplicateLocatorKey(locator),
  ].join(':');
}

function apiDuplicateRecordId(value, fallback) {
  return safeDuplicateEndpointSegment(value) ?? safeDuplicateEndpointSegment(fallback) ?? 'api-observation';
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
  const rawId = firstNormalizedText(
    raw.id,
    raw.candidateId,
    raw.endpoint?.id,
    `${method ?? 'GET'}:${locator}`,
  );
  const id = apiDuplicateRecordId(rawId, `${method ?? 'GET'}:${locator}`);
  const duplicateGroupKey = apiDuplicateGroupKey({ method, locator });
  const endpointSeen = raw.endpointSeen instanceof Map ? raw.endpointSeen : null;
  const duplicateOf = endpointSeen?.get(duplicateGroupKey);
  if (!duplicateOf && endpointSeen && duplicateGroupKey) {
    endpointSeen.set(duplicateGroupKey, id);
  }
  const duplicate = Boolean(duplicateOf);
  const transport = endpointTransportFromApiLike(raw);
  const resourceType = endpointResourceTypeFromApiLike(raw);
  const endpointKind = redactText(firstNormalizedText(raw.endpointKind, raw.target?.endpointKind, raw.evidence?.endpointKind));
  const roleHint = redactText(firstNormalizedText(raw.roleHint, raw.target?.roleHint, raw.evidence?.roleHint));
  const riskClass = redactText(firstNormalizedText(raw.riskClass, raw.target?.riskClass, raw.evidence?.riskClass));
  const parameterShape = redactedTextArray(raw.parameterShape ?? raw.target?.parameterShape ?? raw.evidence?.parameterShape);
  const queryKeys = redactedTextArray(raw.queryKeys ?? raw.target?.queryKeys ?? raw.evidence?.queryKeys);
  const bodyShape = boundedShapeSummary(raw.bodyShape ?? raw.request?.bodyShape ?? raw.evidence?.bodyShape);
  const responseShape = boundedShapeSummary(
    raw.responseShape
      ?? raw.response?.bodyShape
      ?? raw.response?.shape
      ?? raw.evidence?.responseShape,
  );
  const messageShape = boundedShapeSummary(
    raw.messageShape
      ?? raw.streamMessageShape
      ?? raw.websocket?.messageShape
      ?? raw.sse?.messageShape
      ?? raw.evidence?.messageShape,
  );
  const statusCode = Number.isInteger(Number(raw.statusCode ?? raw.response?.statusCode))
    ? Number(raw.statusCode ?? raw.response?.statusCode)
    : undefined;
  const contentType = redactText(firstNormalizedText(raw.contentType, raw.response?.contentType));
  const headerNames = redactedTextArray(raw.headerNames ?? raw.response?.headerNames);
  const responseSchemaHash = redactText(firstNormalizedText(
    raw.responseSchemaHash,
    raw.response?.responseSchemaHash,
    raw.evidence?.responseSchemaHash,
  ));
  const messageSchemaHash = redactText(firstNormalizedText(
    raw.messageSchemaHash,
    raw.streamMessageSchemaHash,
    raw.websocket?.messageSchemaHash,
    raw.sse?.messageSchemaHash,
    raw.evidence?.messageSchemaHash,
  ));
  const redirect = boundedRedirectEvidence(raw.evidence?.redirect);
  const preflightCorrelation = boundedPreflightCorrelation(
    raw.preflightCorrelation ?? raw.target?.preflightCorrelation ?? raw.evidence?.preflightCorrelation,
  );
  const multiStepCorrelation = boundedApiMultiStepCorrelation(
    raw.multiStepCorrelation
      ?? raw.correlation
      ?? raw.target?.multiStepCorrelation
      ?? raw.target?.correlation
      ?? raw.evidence?.multiStepCorrelation
      ?? raw.evidence?.correlation
      ?? (raw.flowId || raw.triggerId || raw.initiatorNodeId || raw.sequenceIndex !== undefined
        ? raw
        : undefined),
  );
  const preflightObserved = raw.preflightObserved === true
    || raw.target?.preflightObserved === true
    || preflightCorrelation?.status === 'preflight_observed';
  const requestShapeObserved = parameterShape.length > 0
    || queryKeys.length > 0
    || Object.keys(bodyShape).length > 0;
  const responseShapeObserved = Object.keys(responseShape).length > 0
    || statusCode !== undefined
    || Boolean(contentType)
    || headerNames.length > 0
    || Boolean(responseSchemaHash);
  const streamingEndpoint = transport === 'websocket'
    || transport === 'sse'
    || resourceType === 'WebSocket'
    || resourceType === 'EventSource';
  const messageShapeObserved = Object.keys(messageShape).length > 0 || Boolean(messageSchemaHash);
  const shapeGaps = [
    ...(!requestShapeObserved ? [freezeDeep({
      schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
      gapKind: 'missing-request-shape-evidence',
      reasonCode: 'api-request-shape-evidence-missing',
      evidenceStatus: 'unknown',
      reason: 'observed API has no redacted request shape summary in the controlled discovery scope',
      descriptorOnly: true,
      redactionRequired: true,
    })] : []),
    ...(!responseShapeObserved ? [freezeDeep({
      schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
      gapKind: 'missing-response-shape-evidence',
      reasonCode: 'api-response-shape-evidence-missing',
      evidenceStatus: 'unknown',
      reason: 'observed API has no redacted response shape summary in the controlled discovery scope',
      descriptorOnly: true,
      redactionRequired: true,
    })] : []),
  ];
  const messageShapeGaps = streamingEndpoint && !messageShapeObserved
    ? [freezeDeep({
      schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
      gapKind: 'missing-stream-message-shape-evidence',
      reasonCode: 'api-stream-message-shape-evidence-missing',
      evidenceStatus: 'unknown',
      reason: 'streaming API endpoint has no redacted WebSocket/SSE message shape summary in the controlled discovery scope',
      descriptorOnly: true,
      redactionRequired: true,
    })]
    : [];
  addUniqueDiscoveryItem(apis, seen, {
    id: duplicate ? `${id}:duplicate:${apis.length + 1}` : id,
    label: redactText(firstNormalizedText(raw.label, raw.name, raw.endpoint?.name, locator)),
    locator,
    method,
    transport,
    resourceType,
    endpointKind,
    roleHint,
    riskClass,
    ...(parameterShape.length ? { parameterShape } : {}),
    ...(queryKeys.length ? { queryKeys } : {}),
    ...(Object.keys(bodyShape).length ? { bodyShape } : {}),
    ...(Object.keys(responseShape).length ? { responseShape } : {}),
    ...(Object.keys(messageShape).length ? { messageShape } : {}),
    statusCode,
    contentType,
    ...(headerNames.length ? { headerNames } : {}),
    responseSchemaHash,
    messageSchemaHash,
    requestShapeStatus: requestShapeObserved ? 'observed' : 'unknown',
    responseShapeStatus: responseShapeObserved ? 'observed' : 'unknown',
    ...(streamingEndpoint ? { messageShapeStatus: messageShapeObserved ? 'observed' : 'unknown' } : {}),
    ...(shapeGaps.length ? { shapeGaps } : {}),
    ...(messageShapeGaps.length ? { messageShapeGaps } : {}),
    ...(preflightObserved ? { preflightObserved: true } : {}),
    ...(preflightCorrelation ? { preflightCorrelation } : {}),
    ...(multiStepCorrelation ? { multiStepCorrelation } : {}),
    source: `${scope}`,
    status: duplicate
      ? 'duplicate_trigger'
      : raw.discoveryStatus ?? raw.status ?? raw.decision?.status ?? raw.adapterDecision?.status,
    discoveryStatus: duplicate ? 'duplicate_trigger' : raw.discoveryStatus,
    gapReason: redactText(firstNormalizedText(
      duplicate ? `duplicate endpoint observation; first observed as ${duplicateOf}` : undefined,
      raw.gapReason,
      raw.blockedReason,
      raw.reason,
      raw.reasonCode,
      raw.decision?.reason,
      raw.adapterDecision?.reason,
    )),
    blockedSurface: redactText(firstNormalizedText(raw.blockedSurface, raw.surface, raw.target?.roleHint)),
    duplicateGroupKey,
    ...(duplicate ? { duplicateOf } : {}),
    required,
    endpoint: {
      method,
      url: locator,
      ...(transport ? { transport } : {}),
      ...(resourceType ? { resourceType } : {}),
      ...(endpointKind ? { endpointKind } : {}),
    },
    evidence: {
      ...(transport ? { transport } : {}),
      ...(resourceType ? { resourceType } : {}),
      requestShapeStatus: requestShapeObserved ? 'observed' : 'unknown',
      responseShapeStatus: responseShapeObserved ? 'observed' : 'unknown',
      ...(streamingEndpoint ? { messageShapeStatus: messageShapeObserved ? 'observed' : 'unknown' } : {}),
      ...(messageShapeGaps.length ? { messageShapeGaps } : {}),
      ...(raw.evidence?.preflight ? { preflight: true } : {}),
      ...(preflightObserved ? { preflightObserved: true } : {}),
      ...(preflightCorrelation ? { preflightCorrelation } : {}),
      ...(multiStepCorrelation ? { multiStepCorrelation } : {}),
      ...(redirect ? { redirect } : {}),
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
  networkResponseSummaries,
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
    networkResponseSummaries: [
      ...toArray(networkResponseSummaries),
      ...captureInputs.flatMap((item) => toArray(item.networkResponseSummaries)),
      ...expandInputs.flatMap((item) => toArray(item.networkResponseSummaries)),
      ...toArray(siteDoctor?.networkResponseSummaries),
      ...toArray(siteDoctorReport?.networkResponseSummaries),
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

function responseSummaryByCandidateId(summaries = []) {
  return new Map(summaries
    .map((summary) => [normalizeText(summary.candidateId), summary])
    .filter(([candidateId]) => candidateId));
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
  networkResponseSummaries,
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
  const apiEndpointSeen = new Map();
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
    addRuntimeEvidenceDiscoveryNodes({
      nodes: discoveredNodes,
      seen: nodeSeen,
      scope,
      item,
      locator: finalUrl,
      required,
    });
    addNodeSummaryDiscoveryNodes({
      nodes: discoveredNodes,
      seen: nodeSeen,
      scope,
      input: item,
      required,
    });
    addJsRouteDiscoveryNodes({
      nodes: discoveredNodes,
      seen: nodeSeen,
      scope,
      input: item,
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
    for (const { scope: triggerScope, trigger } of collectTriggerGapInputs(item)) {
      addTriggerGapDiscoveryNode({
        nodes: discoveredNodes,
        seen: nodeSeen,
        scope: `${scope}.${triggerScope}`,
        trigger,
        required,
      });
    }
    addRuntimeEvidenceDiscoveryNodes({
      nodes: discoveredNodes,
      seen: nodeSeen,
      scope,
      item,
      locator: redactText(firstNormalizedText(item.finalUrl, item.final_url, item.url)),
      required,
    });
    addNodeSummaryDiscoveryNodes({
      nodes: discoveredNodes,
      seen: nodeSeen,
      scope,
      input: item,
      required,
    });
    addJsRouteDiscoveryNodes({
      nodes: discoveredNodes,
      seen: nodeSeen,
      scope,
      input: item,
      required,
    });
  }

  const apiLikeInputs = collectApiLikeInputs({
    networkRequests,
    networkResponseSummaries,
    apiCandidates,
    captureInputs,
    expandInputs,
    siteDoctor,
    siteDoctorReport,
  });
  const responseSummariesByCandidateId = responseSummaryByCandidateId(apiLikeInputs.networkResponseSummaries);
  const consumedResponseSummaryIds = new Set();
  for (const request of apiLikeInputs.networkRequests) {
    const requestId = normalizeText(request.id ?? request.requestId ?? request.candidateId);
    const responseSummary = requestId ? responseSummariesByCandidateId.get(requestId) : null;
    if (requestId && responseSummary) {
      consumedResponseSummaryIds.add(requestId);
    }
    addApiDiscoveryItem({
      apis: discoveredApis,
      seen: apiSeen,
      scope: 'networkRequests',
      raw: responseSummary
        ? {
          ...request,
          endpointSeen: apiEndpointSeen,
          statusCode: responseSummary.statusCode,
          contentType: responseSummary.contentType,
          headerNames: responseSummary.headerNames,
          responseShape: responseSummary.bodyShape,
          responseSchemaHash: responseSummary.responseSchemaHash,
        }
        : { ...request, endpointSeen: apiEndpointSeen },
      required: apiRequired,
    });
  }
  for (const candidate of apiLikeInputs.apiCandidates) {
    const candidateId = normalizeText(candidate.id ?? candidate.candidateId);
    const responseSummary = candidateId ? responseSummariesByCandidateId.get(candidateId) : null;
    if (candidateId && responseSummary) {
      consumedResponseSummaryIds.add(candidateId);
    }
    addApiDiscoveryItem({
      apis: discoveredApis,
      seen: apiSeen,
      scope: 'apiCandidates',
      raw: responseSummary
        ? {
          ...candidate,
          endpointSeen: apiEndpointSeen,
          statusCode: responseSummary.statusCode,
          contentType: responseSummary.contentType,
          headerNames: responseSummary.headerNames,
          responseShape: responseSummary.bodyShape,
          responseSchemaHash: responseSummary.responseSchemaHash,
        }
        : { ...candidate, endpointSeen: apiEndpointSeen },
      required: apiRequired,
    });
  }
  for (const summary of apiLikeInputs.networkResponseSummaries) {
    const candidateId = normalizeText(summary.candidateId);
    if (candidateId && consumedResponseSummaryIds.has(candidateId)) {
      continue;
    }
    addApiDiscoveryItem({
      apis: discoveredApis,
      seen: apiSeen,
      scope: 'networkResponseSummaries',
      raw: {
        id: candidateId,
        candidateId,
        endpointSeen: apiEndpointSeen,
        label: candidateId ? `response summary ${candidateId}` : 'response summary',
        status: 'observed',
        statusCode: summary.statusCode,
        contentType: summary.contentType,
        headerNames: summary.headerNames,
        responseShape: summary.bodyShape,
        responseSchemaHash: summary.responseSchemaHash,
      },
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
      networkResponseSummaries: apiLikeInputs.networkResponseSummaries.length,
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

function countByDiscoveryStatus(entries) {
  const counts = Object.fromEntries(
    SITE_ONBOARDING_DISCOVERY_STATUSES.map((status) => [status, 0]),
  );
  for (const entry of entries) {
    const status = DISCOVERY_STATUS_SET.has(entry.discoveryStatus)
      ? entry.discoveryStatus
      : 'unknown';
    counts[status] += 1;
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

function normalizeTargetId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function uniqueNormalizedTargets(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = normalizeTargetId(redactText(value));
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function targetAliases(kind, targetId) {
  return uniqueNormalizedTargets([
    targetId,
    ...(DISCOVERY_TARGET_ALIAS_MAP[kind]?.[targetId] ?? []),
  ]);
}

function createDiscoveryTargets({ kind, ids, source }) {
  return freezeDeep(uniqueNormalizedTargets(ids).map((targetId, index) => ({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    id: `${kind}:${targetId}`,
    kind,
    targetId,
    aliases: targetAliases(kind, targetId),
    required: true,
    priority: index + 1,
    source,
    redactionRequired: true,
  })));
}

function capabilitiesFromInput({
  capabilityIntake = null,
  requestedCapabilities = [],
  capabilityFamilies = [],
  supportedIntents = [],
} = {}) {
  return uniqueNormalizedTargets([
    ...SITE_ONBOARDING_DISCOVERY_CAPABILITY_TARGETS,
    ...(Array.isArray(capabilityIntake?.requestedCapabilities) ? capabilityIntake.requestedCapabilities : []),
    ...(Array.isArray(capabilityIntake?.candidateCapabilities) ? capabilityIntake.candidateCapabilities : []),
    ...(Array.isArray(capabilityIntake?.unconfirmedCapabilities) ? capabilityIntake.unconfirmedCapabilities : []),
    ...requestedCapabilities,
    ...capabilityFamilies,
    ...supportedIntents,
  ]);
}

function scoreRatio(count, total) {
  return total === 0 ? 1 : count / total;
}

function scorePercentage(value) {
  return Number((value * 100).toFixed(2));
}

function scoreText(value) {
  return `${scorePercentage(value).toFixed(2)}%`;
}

function canonicalCoverageScore(targets, canonicalTargets) {
  const targetIds = new Set(targets.map((target) => target.targetId));
  const matched = canonicalTargets.filter((targetId) => targetIds.has(targetId)).length;
  return {
    matched,
    total: canonicalTargets.length,
    score: scoreRatio(matched, canonicalTargets.length),
  };
}

function entryValues(entry = {}) {
  return uniqueNormalizedTargets([
    entry.id,
    entry.label,
    entry.locator,
    entry.nodeKind,
    entry.kindLabel,
    entry.recognizedAs,
    entry.method,
    entry.source,
    entry.endpoint?.url,
    entry.endpoint?.method,
    entry.endpointKind,
    entry.roleHint,
    entry.resourceType,
    entry.queryKeys,
    entry.parameterShape,
    entry.bodyShape?.fieldNames,
    entry.responseShape?.fieldNames,
    entry.role,
    entry.accessibleName,
    entry.textSnippet,
    entry.tagName,
    entry.routePattern,
    entry.moduleHint,
    entry.importKind,
    entry.chunkId,
  ]);
}

function targetEvidenceMatched(target, entries = []) {
  const aliases = new Set(target.aliases);
  return entries.some((entry) => {
    const values = entryValues(entry);
    return values.some((value) => {
      if (aliases.has(value)) {
        return true;
      }
      return [...aliases].some((alias) => value.includes(alias) || alias.includes(value));
    });
  });
}

function evidenceCoverageForTargets(targets, entries = []) {
  const matchedTargets = targets.filter((target) => targetEvidenceMatched(target, entries));
  return {
    matched: matchedTargets.length,
    total: targets.length,
    score: scoreRatio(matchedTargets.length, targets.length),
    matchedTargetIds: matchedTargets.map((target) => target.targetId),
    missingTargetIds: targets
      .filter((target) => !matchedTargets.includes(target))
      .map((target) => target.targetId),
  };
}

function scorecardFromParts({
  node,
  api,
  capability,
  threshold = SITE_ONBOARDING_DISCOVERY_90_POINT_THRESHOLD,
}) {
  const overallScore = (node.score + api.score + capability.score) / 3;
  return freezeDeep({
    threshold,
    thresholdPercent: scoreText(threshold),
    nodeScore: scorePercentage(node.score),
    apiScore: scorePercentage(api.score),
    capabilityScore: scorePercentage(capability.score),
    overallScore: scorePercentage(overallScore),
    pass: overallScore >= threshold
      && node.score >= threshold
      && api.score >= threshold
      && capability.score >= threshold,
    raw: {
      node,
      api,
      capability,
    },
  });
}

export function createSiteOnboardingDiscoveryCoveragePlan({
  siteKey,
  capabilityIntake = null,
  requestedCapabilities = [],
  capabilityFamilies = [],
  supportedIntents = [],
  pageTypes = [],
} = {}) {
  const nodeTargets = createDiscoveryTargets({
    kind: 'node',
    ids: [
      ...SITE_ONBOARDING_DISCOVERY_NODE_TARGETS,
      ...uniqueNormalizedTargets(pageTypes),
    ],
    source: 'site-onboarding-90-point-node-taxonomy',
  });
  const apiTargets = createDiscoveryTargets({
    kind: 'api',
    ids: SITE_ONBOARDING_DISCOVERY_API_TARGETS,
    source: 'site-onboarding-90-point-api-taxonomy',
  });
  const capabilityTargets = createDiscoveryTargets({
    kind: 'capability',
    ids: capabilitiesFromInput({
      capabilityIntake,
      requestedCapabilities,
      capabilityFamilies,
      supportedIntents,
    }),
    source: 'site-onboarding-90-point-capability-taxonomy',
  });
  const architecture = scorecardFromParts({
    node: canonicalCoverageScore(nodeTargets, SITE_ONBOARDING_DISCOVERY_NODE_TARGETS),
    api: canonicalCoverageScore(apiTargets, SITE_ONBOARDING_DISCOVERY_API_TARGETS),
    capability: canonicalCoverageScore(capabilityTargets, SITE_ONBOARDING_DISCOVERY_CAPABILITY_TARGETS),
  });

  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    artifactName: 'DISCOVERY_COVERAGE_PLAN',
    siteKey: normalizeText(siteKey),
    targetScoreThreshold: SITE_ONBOARDING_DISCOVERY_90_POINT_THRESHOLD,
    targetScoreThresholdPercent: scoreText(SITE_ONBOARDING_DISCOVERY_90_POINT_THRESHOLD),
    nodeTargets,
    apiTargets,
    capabilityTargets,
    architecture,
    policy: {
      descriptorOnly: true,
      liveCaptureRequiredForEvidenceScore: true,
      observedApiAutoPromotionAllowed: false,
      siteSpecificInterpretationOwner: 'SiteAdapter',
      redactionRequired: true,
    },
    redactionRequired: true,
  });
}

export function createSiteOnboardingDiscoveryScorecard({
  coveragePlan,
  nodeInventory,
  apiInventory,
  capabilityInventory = null,
  capabilityCoverageSummary = null,
  adapter = null,
} = {}) {
  const plan = coveragePlan ?? createSiteOnboardingDiscoveryCoveragePlan();
  const coverageSummaryCapabilities = [
    ...toArray(capabilityCoverageSummary?.targetedCapabilities),
    ...toArray(capabilityCoverageSummary?.recognizedCapabilities),
  ];
  const capabilityEntries = [
    ...capabilityEvidenceEntries(capabilityInventory, capabilityCoverageSummary, {
      nodeInventory,
      apiInventory,
      adapter,
    }),
    ...coverageSummaryCapabilities.map((capability) => ({
      id: capability,
      label: capability,
      recognizedAs: capability,
    })),
  ];
  const evidence = scorecardFromParts({
    node: evidenceCoverageForTargets(plan.nodeTargets, nodeInventory?.entries ?? []),
    api: evidenceCoverageForTargets(plan.apiTargets, apiInventory?.entries ?? []),
    capability: evidenceCoverageForTargets(plan.capabilityTargets, capabilityEntries),
  });

  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    artifactName: 'DISCOVERY_SCORECARD',
    targetScoreThreshold: SITE_ONBOARDING_DISCOVERY_90_POINT_THRESHOLD,
    architecture: plan.architecture,
    evidence,
    scoreKinds: {
      architecture: 'target taxonomy coverage; does not claim live evidence',
      evidence: 'recognized observed inventory coverage against the target taxonomy',
    },
    pass: plan.architecture.pass === true && evidence.pass === true,
    redactionRequired: true,
  });
}

function createInventory({ artifactName, kind, entries }) {
  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    artifactName,
    kind,
    total: entries.length,
    counts: countByClassification(entries),
    statusCounts: countByDiscoveryStatus(entries),
    coverage: coverageForEntries(entries),
    entries,
    redactionRequired: true,
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
    redactionRequired: true,
  });
}

function blockedStatuses() {
  return new Set([
    'blocked',
    'skipped_by_budget',
    'skipped_by_policy',
    'unattempted',
    'failed_trigger',
    'duplicate_trigger',
    'requires_login',
    'requires_manual_review',
    'requires_adapter_evidence',
    'requires_schema_evidence',
    'requires_test_evidence',
  ]);
}

function entriesWithBlockedStatus(entries = []) {
  const statuses = blockedStatuses();
  return entries.filter((entry) => statuses.has(entry.discoveryStatus));
}

function countBlockedSurfaceCategories(entries = []) {
  return entries.reduce((counts, entry) => {
    const category = entry.blockedSurfaceClassification?.category;
    if (category) {
      counts[category] = (counts[category] ?? 0) + 1;
    }
    return counts;
  }, {});
}

function blockedReportForEntries({ artifactName, kind, entries }) {
  const blockedEntries = entriesWithBlockedStatus(entries);
  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    artifactName,
    kind,
    total: blockedEntries.length,
    statusCounts: countByDiscoveryStatus(blockedEntries),
    surfaceCategoryCounts: countBlockedSurfaceCategories(blockedEntries),
    entries: blockedEntries,
    redactionRequired: true,
  });
}

export function createBlockedNodeReport(nodeInventory) {
  return blockedReportForEntries({
    artifactName: 'BLOCKED_NODE_REPORT',
    kind: 'node',
    entries: nodeInventory?.entries ?? [],
  });
}

export function createUnknownApiReport(apiInventory) {
  const unknownApis = (apiInventory?.entries ?? []).filter((entry) => entry.classification === 'unknown');
  const unknownRequiredApis = unknownApis.filter((entry) => entry.required);
  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    artifactName: 'UNKNOWN_API_REPORT',
    totalUnknownApis: unknownApis.length,
    totalUnknownRequiredApis: unknownRequiredApis.length,
    gateRequiredUnknownApisZero: unknownRequiredApis.length === 0,
    entries: unknownApis,
    apis: unknownApis,
    redactionRequired: true,
  });
}

export function createBlockedApiReport(apiInventory) {
  return blockedReportForEntries({
    artifactName: 'BLOCKED_API_REPORT',
    kind: 'api',
    entries: apiInventory?.entries ?? [],
  });
}

function targetSource(kind, source, confidence = 0.5) {
  const normalized = safeCapabilityEvidenceRef(source);
  if (!normalized) {
    return undefined;
  }
  return freezeDeep({
    kind,
    ref: normalized,
    confidence,
    redactionRequired: true,
  });
}

function safeCapabilityEvidenceRef(source) {
  const redacted = redactText(source);
  if (!redacted) {
    return undefined;
  }
  if (
    redacted.includes('[REDACTED]')
    || redacted.toLowerCase().includes('redacted')
    || /\b(?:access-token|authorization|browser-profile|cookie|csrf|profile-path|sessdata|session-id|session-token|user-data-dir)\b/iu.test(redacted)
    || /(?:^|[\\/])(?:users?|appdata|chrome|browserprofile|profile)(?:[\\/]|$)/iu.test(redacted)
    || /^[A-Za-z]:[\\/]/u.test(redacted)
    || /\.\.?[\\/]/u.test(redacted)
    || /\b(?:https?|wss?):\/\//iu.test(redacted)
    || /\.(?:mjs|cjs|js|ts|cmd|bat|ps1|sh|exe|dll)$/iu.test(redacted)
    || /\b(?:run-handler|node\s+|curl\s+|powershell|cmd\.exe)\b/iu.test(redacted)
    || /\b\d{1,3}(?:\.\d{1,3}){3}\b/u.test(redacted)
  ) {
    return 'redacted-evidence-ref';
  }
  return normalizeTargetId(redacted);
}

function capabilityApiResponseEvidenceDescriptor(entry = {}, targetId) {
  if (!isPlainObject(entry) || !isPlainObject(entry.responseShape)) {
    return undefined;
  }
  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    descriptorKind: 'capability-api-response-evidence',
    targetId,
    sourceApiId: safeCapabilityEvidenceRef(entry.id ?? entry.locator ?? targetId),
    roleHint: safeCapabilityEvidenceRef(entry.roleHint),
    endpointKind: safeCapabilityEvidenceRef(entry.endpointKind),
    responseShapeStatus: safeCapabilityEvidenceRef(entry.responseShapeStatus ?? 'observed'),
    responseFieldHints: boundedShapeTextArray(entry.responseShape?.fieldNames),
    responseSchemaHash: safeCapabilityEvidenceRef(entry.responseSchemaHash),
    multiStepCorrelationPresent: Boolean(entry.multiStepCorrelation),
    observedOnly: true,
    executableEvidence: false,
    descriptorOnly: true,
    redactionRequired: true,
  });
}

function inferredCapabilityEntriesFromInventory(entries = [], sourceKind) {
  return entries.flatMap((entry) => {
    const values = entryValues(entry);
    return SITE_ONBOARDING_DISCOVERY_CAPABILITY_TARGETS
      .filter((targetId) => {
        const aliases = new Set(targetAliases('capability', targetId));
        return values.some((value) =>
          aliases.has(value)
          || [...aliases].some((alias) => value.includes(alias) || alias.includes(value)));
      })
      .map((targetId) => {
        const evidenceDetail = sourceKind === 'api-inventory'
          ? capabilityApiResponseEvidenceDescriptor(entry, targetId)
          : undefined;
        return {
          id: `${sourceKind}:${entry.id ?? entry.index ?? targetId}`,
          label: targetId,
          recognizedAs: targetId,
          discoveryStatus: entry.discoveryStatus === 'verified' ? 'verified' : 'observed_only',
          verificationState: entry.verificationState === 'verified' ? 'verified' : 'unverified',
          evidenceKind: evidenceDetail ? 'api-response-evidence' : sourceKind,
          evidenceRef: sourceKind === 'api-inventory'
            ? (entry.id ?? entry.roleHint ?? entry.endpointKind ?? entry.method ?? entry.source)
            : (entry.recognizedAs ?? entry.nodeKind ?? entry.kindLabel ?? entry.method ?? entry.source ?? entry.id),
          evidenceDetail,
        };
      });
  });
}

function capabilityEvidenceEntries(
  capabilityInventory = null,
  capabilityCoverageSummary = null,
  {
    nodeInventory = null,
    apiInventory = null,
    adapter = null,
  } = {},
) {
  return [
    ...staticAdapterCapabilityEvidenceEntries(adapter),
    ...staticAdapterCapabilityFixtureEvidenceEntries(adapter),
    ...(capabilityInventory?.entries ?? capabilityInventory?.capabilities ?? []).map((entry) => ({
      ...entry,
      evidenceKind: entry.evidenceKind ?? entry.sourceKind ?? 'capability-inventory',
      evidenceRef: entry.evidenceRef ?? entry.id ?? entry.recognizedAs,
    })),
    ...toArray(capabilityCoverageSummary?.targetedCapabilities).map((capability) => ({
      id: capability,
      label: capability,
      recognizedAs: capability,
      discoveryStatus: 'discovered',
      verificationState: 'unverified',
      evidenceKind: 'targeted-summary',
      evidenceRef: capability,
    })),
    ...toArray(capabilityCoverageSummary?.recognizedCapabilities).map((capability) => ({
      id: capability,
      label: capability,
      recognizedAs: capability,
      discoveryStatus: 'observed_only',
      verificationState: 'unverified',
      evidenceKind: 'recognized-summary',
      evidenceRef: capability,
    })),
    ...inferredCapabilityEntriesFromInventory(nodeInventory?.entries ?? [], 'node-inventory'),
    ...inferredCapabilityEntriesFromInventory(apiInventory?.entries ?? [], 'api-inventory'),
  ];
}

function staticAdapterCapabilityEvidenceEntries(adapter = null) {
  const entries = [
    ...toArray(adapter?.capabilityEvidence),
    ...toArray(adapter?.capabilityEvidenceEntries),
    ...toArray(adapter?.metadata?.capabilityEvidence),
  ];
  return entries
    .filter(isPlainObject)
    .map((entry, index) => {
      const capability = firstNormalizedText(
        entry.recognizedAs,
        entry.capabilityKey,
        entry.targetId,
        entry.capability,
        entry.label,
      );
      return {
        ...entry,
        id: entry.id ?? `adapter-capability-evidence-${index + 1}`,
        label: entry.label ?? capability,
        recognizedAs: capability,
        discoveryStatus: entry.discoveryStatus ?? entry.status ?? 'observed_only',
        verificationState: entry.verificationState ?? entry.verification ?? 'unverified',
        evidenceKind: entry.evidenceKind ?? entry.sourceKind ?? entry.kind ?? 'adapter',
        evidenceRef: entry.evidenceRef
          ?? entry.ref
          ?? entry.testEvidenceRef
          ?? entry.schemaRef
          ?? entry.policyRef
          ?? entry.adapterRef
          ?? entry.id
          ?? capability,
      };
    });
}

function staticAdapterCapabilityFixtureEvidenceEntries(adapter = null) {
  const fixtures = [
    ...toArray(adapter?.capabilityEvidenceFixtures),
    ...toArray(adapter?.metadata?.capabilityEvidenceFixtures),
  ];
  return fixtures
    .filter(isPlainObject)
    .flatMap((fixture, fixtureIndex) => {
      const capability = firstNormalizedText(
        fixture.recognizedAs,
        fixture.capabilityKey,
        fixture.targetId,
        fixture.capability,
        fixture.label,
      );
      if (!capability) {
        return [];
      }
      const evidenceKinds = uniqueNormalizedTargets(
        toArray(fixture.evidenceKinds ?? fixture.requiredEvidenceKinds)
          .map((kind) => kind),
      );
      const inferredKinds = [
        ...(fixture.adapterRef ? ['adapter'] : []),
        ...(fixture.schemaRef ? ['schema'] : []),
        ...(fixture.testEvidenceRef || fixture.testEvidenceRefs ? ['test'] : []),
        ...(fixture.policyRef ? ['policy'] : []),
        ...(fixture.riskRef || fixture.riskEvidenceRef ? ['risk'] : []),
        ...(fixture.approvalRef || fixture.approvalEvidenceRef ? ['approval'] : []),
      ];
      const kinds = evidenceKinds.length ? evidenceKinds : inferredKinds;
      return kinds.map((kind, kindIndex) => {
        const evidenceRef = firstNormalizedText(
          kind === 'adapter' ? fixture.adapterRef : undefined,
          kind === 'schema' ? fixture.schemaRef : undefined,
          kind === 'test' ? fixture.testEvidenceRef : undefined,
          kind === 'test' ? toArray(fixture.testEvidenceRefs)[0] : undefined,
          kind === 'policy' ? fixture.policyRef : undefined,
          kind === 'risk' ? (fixture.riskRef ?? fixture.riskEvidenceRef) : undefined,
          kind === 'approval' ? (fixture.approvalRef ?? fixture.approvalEvidenceRef) : undefined,
          fixture.evidenceRef,
          fixture.ref,
          `${kind}:${capability}`,
        );
        return {
          id: fixture.id ?? `adapter-capability-fixture-${fixtureIndex + 1}-${kindIndex + 1}`,
          label: fixture.label ?? capability,
          recognizedAs: capability,
          discoveryStatus: fixture.discoveryStatus ?? fixture.status ?? 'observed_only',
          verificationState: fixture.verificationState ?? fixture.verification ?? 'unverified',
          evidenceKind: kind,
          evidenceRef,
          evidenceDetail: fixture.apiCatalogRef
            ? {
              descriptorKind: 'verified-api-catalog-capability-evidence',
              targetId: capability,
              sourceApiId: fixture.apiCatalogRef,
              executableEvidence: true,
              descriptorOnly: true,
              redactionRequired: true,
            }
            : undefined,
          descriptorOnly: true,
          redactionRequired: true,
        };
      });
    });
}

function targetMatchesCapabilityEvidence(target, entries = []) {
  return entries.filter((entry) => targetEvidenceMatched(target, [entry]));
}

const REQUIRED_CAPABILITY_EXECUTION_EVIDENCE_KINDS = Object.freeze([
  'adapter',
  'schema',
  'test',
  'policy',
  'risk',
  'approval',
]);

function requiredCapabilityEvidenceStatus(kind) {
  const normalized = normalizeTargetId(kind);
  return `requires_${normalized}_evidence`;
}

function evidenceKindSatisfies(kind, requiredKind) {
  const normalized = normalizeTargetId(kind);
  return normalized === requiredKind;
}

function capabilityEvidenceQuorum(evidenceKinds = []) {
  return REQUIRED_CAPABILITY_EXECUTION_EVIDENCE_KINDS
    .every((requiredKind) => evidenceKinds.some((kind) => evidenceKindSatisfies(kind, requiredKind)));
}

function capabilityEvidenceEntryIsVerified(entry = {}) {
  return Boolean(
    entry.verificationState === 'verified'
    || entry.discoveryStatus === 'verified',
  );
}

function capabilityEvidenceRequirementGaps(missingEvidenceKinds = [], {
  targetId,
  desiredState,
} = {}) {
  return missingEvidenceKinds.map((kind) => freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    gapKind: 'missing-required-evidence',
    targetId: normalizeTargetId(redactText(targetId)),
    requiredEvidenceKind: kind,
    requiredEvidenceStatus: requiredCapabilityEvidenceStatus(kind),
    desiredState: normalizeTargetId(desiredState) || 'best_effort',
    requiresManualReview: desiredState === 'required',
    descriptorOnly: true,
    redactionRequired: true,
  }));
}

function boundedCapabilityEvidenceDetail(detail = undefined) {
  if (!isPlainObject(detail)) {
    return undefined;
  }
  return redactedPlainObject({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    descriptorKind: detail.descriptorKind,
    targetId: safeCapabilityEvidenceRef(detail.targetId),
    sourceApiId: safeCapabilityEvidenceRef(detail.sourceApiId),
    roleHint: safeCapabilityEvidenceRef(detail.roleHint),
    endpointKind: safeCapabilityEvidenceRef(detail.endpointKind),
    responseShapeStatus: safeCapabilityEvidenceRef(detail.responseShapeStatus),
    responseFieldHints: boundedShapeTextArray(detail.responseFieldHints),
    responseSchemaHash: safeCapabilityEvidenceRef(detail.responseSchemaHash),
    multiStepCorrelationPresent: detail.multiStepCorrelationPresent === true,
    observedOnly: detail.observedOnly === true,
    executableEvidence: detail.executableEvidence === true ? true : false,
    descriptorOnly: detail.descriptorOnly === true,
    redactionRequired: true,
  });
}

function capabilityEvidenceCompletionStrategy({
  targetId,
  desiredState,
  discoveryState,
  missingEvidenceKinds = [],
} = {}) {
  const requiredEvidenceKinds = uniqueNormalizedTargets(missingEvidenceKinds);
  const requiredEvidenceStatuses = requiredEvidenceKinds.length
    ? requiredEvidenceKinds.map(requiredCapabilityEvidenceStatus)
    : ['requires_verified_evidence_claim'];
  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    strategyKind: 'capability-evidence-completion',
    targetId: normalizeTargetId(redactText(targetId)),
    discoveryState: normalizeDiscoveryStatusToken(discoveryState) ?? 'unknown',
    requiredEvidenceKinds,
    requiredEvidenceStatuses,
    nextAction: discoveryState === 'observed_only'
      ? 'collect-required-execution-evidence'
      : 'collect-observed-and-required-evidence',
    requiresManualReview: desiredState === 'required',
    executableCapabilityAllowed: false,
    observedCapabilityAutoPromotionAllowed: false,
    descriptorOnly: true,
    redactionRequired: true,
  });
}

function capabilityEvidenceMapping(entry = {}, targetId, executableEvidenceKinds = new Set()) {
  const sourceKind = normalizeTargetId(entry.evidenceKind ?? entry.sourceKind ?? 'observed') ?? 'observed';
  const sourceRef = safeCapabilityEvidenceRef(entry.evidenceRef ?? entry.id ?? entry.recognizedAs ?? targetId);
  const sourceStatus = normalizeDiscoveryStatusToken(entry.discoveryStatus)
    ?? normalizeDiscoveryStatusToken(entry.verificationState)
    ?? 'observed_only';
  const executableEvidence = executableEvidenceKinds.has(sourceKind)
    && (entry.discoveryStatus === 'verified' || entry.verificationState === 'verified');
  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    sourceKind,
    sourceRef,
    sourceStatus,
    mappedAs: targetId,
    mappingConfidence: executableEvidence ? 1 : 0.6,
    descriptorOnly: true,
    executableEvidence,
    evidenceDetail: boundedCapabilityEvidenceDetail(entry.evidenceDetail),
    redactionRequired: true,
  });
}

function capabilityMappingGaps(target = {}) {
  if (target.verificationState === 'verified') {
    return [];
  }
  const missingEvidenceKinds = target.missingEvidenceKinds ?? [];
  const gapKind = target.discoveryState === 'observed_only'
    ? 'missing-execution-evidence'
    : 'missing-observed-evidence';
  const reason = target.discoveryState === 'observed_only'
    ? 'observed descriptor evidence is not executable capability evidence'
    : 'capability target has no observed descriptor evidence in the controlled discovery scope';
  return [freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    gapKind,
    missingEvidenceKinds,
    reason,
    descriptorOnly: true,
    redactionRequired: true,
  })];
}

export function createCapabilityTargets({
  siteKey,
  generatedAt,
  coveragePlan,
  requestedCapabilities = [],
  capabilityInventory = null,
  capabilityCoverageSummary = null,
  nodeInventory = null,
  apiInventory = null,
  adapter = null,
} = {}) {
  const plan = coveragePlan ?? createSiteOnboardingDiscoveryCoveragePlan();
  const evidenceEntries = capabilityEvidenceEntries(capabilityInventory, capabilityCoverageSummary, {
    nodeInventory,
    apiInventory,
    adapter,
  });
  const requested = new Set(uniqueNormalizedTargets([
    ...toArray(capabilityCoverageSummary?.requestedCapabilities),
    ...toArray(requestedCapabilities),
  ]));
  const unconfirmed = new Set(toArray(capabilityCoverageSummary?.unconfirmedCapabilities).map(normalizeTargetId));
  const targets = plan.capabilityTargets.map((target) => {
    const evidence = targetMatchesCapabilityEvidence(target, evidenceEntries);
    const observed = evidence.length > 0;
    const evidenceKinds = uniqueNormalizedTargets(evidence.map((entry) => entry.evidenceKind));
    const verifiedEvidenceKinds = uniqueNormalizedTargets(
      evidence
        .filter(capabilityEvidenceEntryIsVerified)
        .map((entry) => entry.evidenceKind),
    );
    const verified = capabilityEvidenceQuorum(verifiedEvidenceKinds);
    const desiredState = requested.has(target.targetId) ? 'required' : 'best_effort';
    const missingEvidenceKinds = verified
      ? []
      : REQUIRED_CAPABILITY_EXECUTION_EVIDENCE_KINDS.filter((kind) => !evidenceKinds.some((evidenceKind) =>
        evidenceKindSatisfies(evidenceKind, kind)));
    const evidenceRequirementGaps = verified
      ? []
      : capabilityEvidenceRequirementGaps(missingEvidenceKinds, {
        targetId: target.targetId,
        desiredState,
      });
    const sources = [
      ...(requested.has(target.targetId) ? [targetSource('requested', target.targetId, 1)] : []),
      ...(unconfirmed.has(target.targetId) ? [targetSource('unconfirmed', target.targetId, 0.4)] : []),
      ...evidence.map((entry) => targetSource(
        entry.evidenceKind ?? 'observed',
        entry.evidenceRef ?? entry.id ?? target.targetId,
        entry.verificationState === 'verified' || entry.discoveryStatus === 'verified' ? 1 : 0.6,
      )),
      ...(verified ? [targetSource('verified', target.targetId, 1)] : []),
    ].filter(Boolean);
    const executableEvidenceKinds = new Set(
      verified ? REQUIRED_CAPABILITY_EXECUTION_EVIDENCE_KINDS : [],
    );
    const evidenceMappings = evidence.map((entry) =>
      capabilityEvidenceMapping(entry, target.targetId, executableEvidenceKinds));
    const executableEvidenceCount = evidenceMappings.filter((mapping) => mapping.executableEvidence).length;
    const discoveryState = verified
      ? 'verified'
      : (observed ? 'observed_only' : 'unknown');
    const evidenceCompletionStrategy = verified
      ? undefined
      : capabilityEvidenceCompletionStrategy({
        targetId: target.targetId,
        desiredState,
        discoveryState,
        missingEvidenceKinds,
      });
    return freezeDeep({
      schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
      artifactName: 'CAPABILITY_TARGET',
      targetId: target.targetId,
      capabilityKey: target.targetId,
      aliases: target.aliases,
      desiredState,
      discoveryState,
      verificationState: verified ? 'verified' : 'unverified',
      executableCapabilityAllowed: verified,
      observedCapabilityAutoPromotionAllowed: false,
      targetSources: sources,
      evidenceMappings,
      mappingSummary: {
        mappedSourceKinds: uniqueNormalizedTargets(evidenceMappings.map((mapping) => mapping.sourceKind)),
        observedEvidenceCount: evidenceMappings.length,
        executableEvidenceCount,
        verifiedExecutionEvidenceKinds: REQUIRED_CAPABILITY_EXECUTION_EVIDENCE_KINDS.filter((kind) =>
          verifiedEvidenceKinds.some((evidenceKind) => evidenceKindSatisfies(evidenceKind, kind))),
        requiredExecutionEvidenceKinds: REQUIRED_CAPABILITY_EXECUTION_EVIDENCE_KINDS,
        missingExecutionEvidenceKinds: missingEvidenceKinds,
        evidenceRequirementGapCount: evidenceRequirementGaps.length,
        descriptorOnly: true,
        redactionRequired: true,
      },
      evidenceKinds,
      missingEvidenceKinds,
      evidenceRequirementGaps,
      ...(evidenceCompletionStrategy ? { evidenceCompletionStrategy } : {}),
      evidenceCount: evidence.length,
      redactionRequired: true,
    });
  });
  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    artifactName: 'CAPABILITY_TARGETS',
    siteKey: normalizeText(siteKey),
    generatedAt: normalizeText(generatedAt),
    total: targets.length,
    statusCounts: countByDiscoveryStatus(targets.map((target) => ({
      discoveryStatus: target.discoveryState,
    }))),
    targets,
    redactionRequired: true,
  });
}

export function createCapabilityGapReport(capabilityTargets) {
  const targets = capabilityTargets?.targets ?? [];
  const gaps = targets.filter((target) => target.verificationState !== 'verified')
    .map((target) => {
      const evidenceRequirementGaps = target.evidenceRequirementGaps
        ?? capabilityEvidenceRequirementGaps(target.missingEvidenceKinds ?? [], {
          targetId: target.targetId,
          desiredState: target.desiredState,
        });
      const evidenceCompletionStrategy = target.evidenceCompletionStrategy
        ?? capabilityEvidenceCompletionStrategy({
          targetId: target.targetId,
          desiredState: target.desiredState,
          discoveryState: target.discoveryState,
          missingEvidenceKinds: target.missingEvidenceKinds,
        });
      return freezeDeep({
        schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
        targetId: target.targetId,
        capabilityKey: target.capabilityKey,
        desiredState: target.desiredState,
        discoveryState: target.discoveryState,
        verificationState: target.verificationState,
        gapStatus: target.discoveryState === 'observed_only' ? 'UNVERIFIED' : 'UNKNOWN',
        requiresManualReview: target.desiredState === 'required' && target.verificationState !== 'verified',
        executableCapabilityAllowed: false,
        evidenceKinds: target.evidenceKinds,
        missingEvidenceKinds: target.missingEvidenceKinds,
        evidenceMappings: target.evidenceMappings ?? [],
        evidenceRequirementGaps,
        evidenceRequirementGapCount: evidenceRequirementGaps.length,
        evidenceCompletionStrategy,
        mappingGaps: capabilityMappingGaps(target),
        requiredEvidenceStatuses: REQUIRED_CAPABILITY_EXECUTION_EVIDENCE_KINDS
          .map(requiredCapabilityEvidenceStatus),
        reason: target.discoveryState === 'observed_only'
          ? 'observed capability requires SiteAdapter, policy, schema, test, risk, and approval evidence before verification'
          : 'capability target has no verified evidence in the controlled discovery scope',
        redactionRequired: true,
      });
    });
  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    artifactName: 'CAPABILITY_GAP_REPORT',
    siteKey: normalizeText(capabilityTargets?.siteKey),
    generatedAt: normalizeText(capabilityTargets?.generatedAt),
    totalGaps: gaps.length,
    requiredGaps: gaps.filter((gap) => gap.desiredState === 'required').length,
    totalEvidenceRequirementGaps: gaps
      .reduce((total, gap) => total + (gap.evidenceRequirementGapCount ?? 0), 0),
    entries: gaps,
    gaps,
    redactionRequired: true,
  });
}

function coverageFailures({
  requiredCoveragePass,
  unknownRequiredNodesPass,
  unknownRequiredApisPass,
  requiredIgnoredNodesPass,
  requiredIgnoredApisPass,
  manualReviewFailures,
  requiredBlockedEntries,
  requiredSkippedByBudgetEntries,
  requiredSkippedByPolicyEntries,
  requiredUnattemptedEntries,
  requiredFailedTriggerEntries,
  requiredDuplicateTriggerEntries,
  requiredRequiresLoginEntries,
  requiredManualReviewEntries,
  requiredObservedOnlyEntries,
  requiredAdapterEvidenceEntries,
  requiredSchemaEvidenceEntries,
  requiredTestEvidenceEntries,
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
  if (requiredBlockedEntries.length) {
    failures.push('blocked-required-discovery-item');
  }
  if (requiredSkippedByBudgetEntries.length) {
    failures.push('budget-skipped-required-discovery-item');
  }
  if (requiredSkippedByPolicyEntries.length) {
    failures.push('policy-skipped-required-discovery-item');
  }
  if (requiredUnattemptedEntries.length) {
    failures.push('unattempted-required-discovery-item');
  }
  if (requiredFailedTriggerEntries.length) {
    failures.push('failed-trigger-required-discovery-item');
  }
  if (requiredDuplicateTriggerEntries.length) {
    failures.push('duplicate-trigger-required-discovery-item');
  }
  if (requiredRequiresLoginEntries.length) {
    failures.push('login-required-discovery-item');
  }
  if (requiredManualReviewEntries.length) {
    failures.push('manual-review-required-discovery-item');
  }
  if (requiredObservedOnlyEntries.length) {
    failures.push('observed-only-required-discovery-item');
  }
  if (requiredAdapterEvidenceEntries.length) {
    failures.push('adapter-evidence-required-discovery-item');
  }
  if (requiredSchemaEvidenceEntries.length) {
    failures.push('schema-evidence-required-discovery-item');
  }
  if (requiredTestEvidenceEntries.length) {
    failures.push('test-evidence-required-discovery-item');
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
  const requiredStatusEntries = combinedEntries.filter((entry) => entry.required);
  const requiredBlockedEntries = requiredStatusEntries.filter((entry) => entry.discoveryStatus === 'blocked');
  const requiredSkippedByBudgetEntries = requiredStatusEntries
    .filter((entry) => entry.discoveryStatus === 'skipped_by_budget');
  const requiredSkippedByPolicyEntries = requiredStatusEntries
    .filter((entry) => entry.discoveryStatus === 'skipped_by_policy');
  const requiredUnattemptedEntries = requiredStatusEntries
    .filter((entry) => entry.discoveryStatus === 'unattempted');
  const requiredFailedTriggerEntries = requiredStatusEntries
    .filter((entry) => entry.discoveryStatus === 'failed_trigger');
  const requiredDuplicateTriggerEntries = requiredStatusEntries
    .filter((entry) => entry.discoveryStatus === 'duplicate_trigger');
  const requiredRequiresLoginEntries = requiredStatusEntries
    .filter((entry) => entry.discoveryStatus === 'requires_login');
  const requiredManualReviewEntries = requiredStatusEntries
    .filter((entry) => entry.discoveryStatus === 'requires_manual_review');
  const requiredObservedOnlyEntries = requiredStatusEntries
    .filter((entry) => entry.discoveryStatus === 'observed_only');
  const requiredAdapterEvidenceEntries = requiredStatusEntries
    .filter((entry) => entry.discoveryStatus === 'requires_adapter_evidence');
  const requiredSchemaEvidenceEntries = requiredStatusEntries
    .filter((entry) => entry.discoveryStatus === 'requires_schema_evidence');
  const requiredTestEvidenceEntries = requiredStatusEntries
    .filter((entry) => entry.discoveryStatus === 'requires_test_evidence');
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
    requiredBlockedEntries,
    requiredSkippedByBudgetEntries,
    requiredSkippedByPolicyEntries,
    requiredUnattemptedEntries,
    requiredFailedTriggerEntries,
    requiredDuplicateTriggerEntries,
    requiredRequiresLoginEntries,
    requiredManualReviewEntries,
    requiredObservedOnlyEntries,
    requiredAdapterEvidenceEntries,
    requiredSchemaEvidenceEntries,
    requiredTestEvidenceEntries,
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
    requiredBlockedItems: requiredBlockedEntries.length,
    requiredSkippedByBudgetItems: requiredSkippedByBudgetEntries.length,
    requiredSkippedByPolicyItems: requiredSkippedByPolicyEntries.length,
    requiredUnattemptedItems: requiredUnattemptedEntries.length,
    requiredFailedTriggerItems: requiredFailedTriggerEntries.length,
    requiredDuplicateTriggerItems: requiredDuplicateTriggerEntries.length,
    requiredRequiresLoginItems: requiredRequiresLoginEntries.length,
    requiredManualReviewItems: requiredManualReviewEntries.length,
    requiredObservedOnlyItems: requiredObservedOnlyEntries.length,
    requiredAdapterEvidenceItems: requiredAdapterEvidenceEntries.length,
    requiredSchemaEvidenceItems: requiredSchemaEvidenceEntries.length,
    requiredTestEvidenceItems: requiredTestEvidenceEntries.length,
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

function mergeStatusCounts(...countsList) {
  const merged = Object.fromEntries(
    SITE_ONBOARDING_DISCOVERY_STATUSES.map((status) => [status, 0]),
  );
  for (const counts of countsList) {
    for (const status of SITE_ONBOARDING_DISCOVERY_STATUSES) {
      merged[status] += Number(counts?.[status] ?? 0);
    }
  }
  return freezeDeep(merged);
}

function countApiEntriesBySafeField(entries = [], fieldName, fallback = 'unknown') {
  return entries.reduce((counts, entry) => {
    const token = normalizeTargetId(redactText(entry?.[fieldName])) || fallback;
    const key = token.includes('redacted') ? 'redacted' : token.slice(0, SHAPE_SUMMARY_MAX_TEXT_LENGTH);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function countApiShapeGapKinds(entries = [], fieldName) {
  return entries.reduce((counts, entry) => {
    for (const gap of toArray(entry?.[fieldName])) {
      const key = normalizeTargetId(redactText(gap?.gapKind)) || 'unknown-gap';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, {});
}

function apiGapRowsAreDescriptorOnly(entries = [], fieldName) {
  return entries
    .flatMap((entry) => toArray(entry?.[fieldName]))
    .every((gap) => gap?.descriptorOnly === true && gap?.redactionRequired === true);
}

function apiPreflightCorrelationIsNonPromotional(entry = {}) {
  if (!entry.preflightCorrelation) {
    return true;
  }
  return entry.preflightCorrelation.observedOnly === true
    && entry.preflightCorrelation.catalogPromotionAllowed === false
    && entry.preflightCorrelation.redactionRequired === true;
}

function apiMultiStepCorrelationIsNonPromotional(entry = {}) {
  if (!entry.multiStepCorrelation) {
    return true;
  }
  return entry.multiStepCorrelation.observedOnly === true
    && entry.multiStepCorrelation.catalogPromotionAllowed === false
    && entry.multiStepCorrelation.verifiedCatalogAllowed === false
    && entry.multiStepCorrelation.executionPlanAllowed === false
    && entry.multiStepCorrelation.descriptorOnly === true
    && entry.multiStepCorrelation.redactionRequired === true;
}

function createApiControlledScopeClosureEvidence({
  apiInventory,
  unknownApiReport,
  blockedApiReport,
} = {}) {
  const apiEntries = apiInventory?.entries ?? [];
  const unclassifiedApiEntries = apiEntries.filter((entry) => !CLASSIFICATION_SET.has(entry.classification));
  const unsupportedApiStatusEntries = apiEntries.filter((entry) => !DISCOVERY_STATUS_SET.has(entry.discoveryStatus));
  const unknownApiCountMatches = (unknownApiReport?.totalUnknownApis ?? 0)
    === apiEntries.filter((entry) => entry.classification === 'unknown').length;
  const blockedApiCountMatches = (blockedApiReport?.total ?? 0) === entriesWithBlockedStatus(apiEntries).length;
  const apiShapeGapsDescriptorOnly = apiGapRowsAreDescriptorOnly(apiEntries, 'shapeGaps');
  const apiMessageShapeGapsDescriptorOnly = apiGapRowsAreDescriptorOnly(apiEntries, 'messageShapeGaps');
  const preflightCorrelationsNonPromotional = apiEntries.every(apiPreflightCorrelationIsNonPromotional);
  const multiStepCorrelationsNonPromotional = apiEntries.every(apiMultiStepCorrelationIsNonPromotional);
  const observedApiAutoPromotionPrevented = apiEntries.every((entry) =>
    entry.discoveryStatus !== 'observed_only' || entry.verificationState !== 'verified');
  const noApiSurfaceSilentlyDroppedWithinControlledScope =
    apiInventory?.artifactName === 'API_INVENTORY'
    && unknownApiReport?.artifactName === 'UNKNOWN_API_REPORT'
    && blockedApiReport?.artifactName === 'BLOCKED_API_REPORT'
    && unclassifiedApiEntries.length === 0
    && unsupportedApiStatusEntries.length === 0
    && unknownApiCountMatches
    && blockedApiCountMatches
    && apiShapeGapsDescriptorOnly
    && apiMessageShapeGapsDescriptorOnly
    && preflightCorrelationsNonPromotional
    && multiStepCorrelationsNonPromotional
    && observedApiAutoPromotionPrevented;
  const shapeGapCounts = countApiShapeGapKinds(apiEntries, 'shapeGaps');
  const messageShapeGapCounts = countApiShapeGapKinds(apiEntries, 'messageShapeGaps');

  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    closureKind: 'api-controlled-scope-closure',
    closureStatus: noApiSurfaceSilentlyDroppedWithinControlledScope
      ? 'api_controlled_scope_accounted'
      : 'api_controlled_scope_needs_review',
    reasonCode: noApiSurfaceSilentlyDroppedWithinControlledScope
      ? 'site-onboarding.api.controlled_scope_accounted'
      : 'site-onboarding.api.controlled_scope_needs_review',
    controlledScopeOnly: true,
    liveNetworkCoverageClaimed: false,
    verifiedCatalogCoverageClaimed: false,
    observedApiAutoPromotionAllowed: false,
    graphCatalogPromotionAllowed: false,
    plannerRoutePromotionAllowed: false,
    layerExecutionAllowed: false,
    downloaderExecutionAllowed: false,
    artifactRefs: ['API_INVENTORY', 'UNKNOWN_API_REPORT', 'BLOCKED_API_REPORT'],
    surfaceCounts: {
      total: apiEntries.length,
      statusCounts: apiInventory?.statusCounts ?? {},
      endpointKindCounts: countApiEntriesBySafeField(apiEntries, 'endpointKind'),
      transportCounts: countApiEntriesBySafeField(apiEntries, 'transport'),
      resourceTypeCounts: countApiEntriesBySafeField(apiEntries, 'resourceType'),
      requestShapeGapRows: shapeGapCounts['missing-request-shape-evidence'] ?? 0,
      responseShapeGapRows: shapeGapCounts['missing-response-shape-evidence'] ?? 0,
      messageShapeGapRows: Object.values(messageShapeGapCounts).reduce((total, count) => total + count, 0),
      preflightCorrelationRows: apiEntries.filter((entry) => entry.preflightCorrelation).length,
      multiStepCorrelationRows: apiEntries.filter((entry) => entry.multiStepCorrelation).length,
      redirectRows: apiEntries.filter((entry) => entry.redirect).length,
      streamingEndpointRows: apiEntries.filter((entry) =>
        entry.transport === 'websocket'
        || entry.transport === 'sse'
        || entry.resourceType === 'WebSocket'
        || entry.resourceType === 'EventSource').length,
      duplicateTriggerRows: apiEntries.filter((entry) => entry.discoveryStatus === 'duplicate_trigger').length,
    },
    reportCounts: {
      unknownApis: unknownApiReport?.totalUnknownApis ?? 0,
      unknownRequiredApis: unknownApiReport?.totalUnknownRequiredApis ?? 0,
      blockedApis: blockedApiReport?.total ?? 0,
      blockedStatusCounts: blockedApiReport?.statusCounts ?? {},
    },
    accountingChecks: {
      apiInventoryPresent: apiInventory?.artifactName === 'API_INVENTORY',
      unknownApiReportPresent: unknownApiReport?.artifactName === 'UNKNOWN_API_REPORT',
      blockedApiReportPresent: blockedApiReport?.artifactName === 'BLOCKED_API_REPORT',
      everyApiClassified: unclassifiedApiEntries.length === 0,
      everyApiHasKnownStatus: unsupportedApiStatusEntries.length === 0,
      unknownApiCountMatches,
      blockedApiCountMatches,
      shapeGapsDescriptorOnly: apiShapeGapsDescriptorOnly,
      messageShapeGapsDescriptorOnly: apiMessageShapeGapsDescriptorOnly,
      preflightCorrelationsNonPromotional,
      multiStepCorrelationsNonPromotional,
      observedApiAutoPromotionPrevented,
      noApiSurfaceSilentlyDroppedWithinControlledScope,
    },
    descriptorOnly: true,
    redactionRequired: true,
  });
}

function countCapabilityTargetsByField(targets = [], fieldName, fallback = 'unknown') {
  return targets.reduce((counts, target) => {
    const token = normalizeTargetId(redactText(target?.[fieldName])) || fallback;
    const key = token.includes('redacted') ? 'redacted' : token.slice(0, SHAPE_SUMMARY_MAX_TEXT_LENGTH);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function countCapabilityEvidenceKinds(targets = []) {
  return targets.reduce((counts, target) => {
    for (const kind of toArray(target?.evidenceKinds)) {
      const key = normalizeTargetId(redactText(kind)) || 'unknown-evidence';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, {});
}

function countCapabilityMissingEvidenceKinds(targets = []) {
  return targets.reduce((counts, target) => {
    for (const kind of toArray(target?.missingEvidenceKinds)) {
      const key = normalizeTargetId(redactText(kind)) || 'unknown-evidence';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, {});
}

function capabilityHasVerifiedExecutionQuorum(target = {}) {
  const verifiedKinds = target.mappingSummary?.verifiedExecutionEvidenceKinds ?? [];
  return capabilityEvidenceQuorum(verifiedKinds);
}

function capabilityTargetMappingsAreDescriptorOnly(target = {}) {
  return toArray(target.evidenceMappings)
    .every((mapping) => mapping?.descriptorOnly === true && mapping?.redactionRequired === true);
}

function capabilityGapRecordIsDescriptorOnly(gap = {}) {
  return gap?.executableCapabilityAllowed === false
    && gap?.redactionRequired === true
    && toArray(gap.evidenceRequirementGaps)
      .every((row) => row?.descriptorOnly === true && row?.redactionRequired === true)
    && toArray(gap.mappingGaps)
      .every((row) => row?.descriptorOnly === true && row?.redactionRequired === true)
    && (!gap.evidenceCompletionStrategy
      || (gap.evidenceCompletionStrategy.descriptorOnly === true
        && gap.evidenceCompletionStrategy.redactionRequired === true
        && gap.evidenceCompletionStrategy.executableCapabilityAllowed === false
        && gap.evidenceCompletionStrategy.observedCapabilityAutoPromotionAllowed === false));
}

function createCapabilityControlledScopeClosureEvidence({
  capabilityTargets,
  capabilityGapReport,
} = {}) {
  const targets = capabilityTargets?.targets ?? [];
  const gaps = capabilityGapReport?.gaps ?? capabilityGapReport?.entries ?? [];
  const gapTargetIds = new Set(gaps.map((gap) => normalizeTargetId(gap.targetId)).filter(Boolean));
  const unsupportedCapabilityStatusTargets = targets
    .filter((target) => !DISCOVERY_STATUS_SET.has(target.discoveryState));
  const unsupportedVerificationTargets = targets
    .filter((target) => !['verified', 'unverified', 'blocked'].includes(target.verificationState));
  const capabilityGapCountMatches = (capabilityGapReport?.totalGaps ?? 0)
    === targets.filter((target) => target.verificationState !== 'verified').length;
  const requiredCapabilityGapCountMatches = (capabilityGapReport?.requiredGaps ?? 0)
    === targets.filter((target) =>
      target.desiredState === 'required' && target.verificationState !== 'verified').length;
  const everyUnverifiedCapabilityHasGapRecord = targets
    .filter((target) => target.verificationState !== 'verified')
    .every((target) => gapTargetIds.has(normalizeTargetId(target.targetId)));
  const observedCapabilitiesNonExecutable = targets
    .every((target) => target.discoveryState !== 'observed_only'
      || (target.executableCapabilityAllowed === false
        && target.observedCapabilityAutoPromotionAllowed === false));
  const executableCapabilitiesHaveVerifiedQuorum = targets
    .every((target) => !target.executableCapabilityAllowed
      || (target.verificationState === 'verified' && capabilityHasVerifiedExecutionQuorum(target)));
  const executableCapabilitiesHaveNoRequirementGaps = targets
    .every((target) => !target.executableCapabilityAllowed
      || (toArray(target.evidenceRequirementGaps).length === 0
        && toArray(target.missingEvidenceKinds).length === 0));
  const capabilityMappingsDescriptorOnly = targets.every(capabilityTargetMappingsAreDescriptorOnly);
  const gapRecordsDescriptorOnly = gaps.every(capabilityGapRecordIsDescriptorOnly);
  const noCapabilitySurfaceSilentlyDroppedWithinControlledScope =
    capabilityTargets?.artifactName === 'CAPABILITY_TARGETS'
    && capabilityGapReport?.artifactName === 'CAPABILITY_GAP_REPORT'
    && targets.length === SITE_ONBOARDING_DISCOVERY_CAPABILITY_TARGETS.length
    && unsupportedCapabilityStatusTargets.length === 0
    && unsupportedVerificationTargets.length === 0
    && capabilityGapCountMatches
    && requiredCapabilityGapCountMatches
    && everyUnverifiedCapabilityHasGapRecord
    && observedCapabilitiesNonExecutable
    && executableCapabilitiesHaveVerifiedQuorum
    && executableCapabilitiesHaveNoRequirementGaps
    && capabilityMappingsDescriptorOnly
    && gapRecordsDescriptorOnly;

  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    closureKind: 'capability-controlled-scope-closure',
    closureStatus: noCapabilitySurfaceSilentlyDroppedWithinControlledScope
      ? 'capability_controlled_scope_accounted'
      : 'capability_controlled_scope_needs_review',
    reasonCode: noCapabilitySurfaceSilentlyDroppedWithinControlledScope
      ? 'site-onboarding.capability.controlled_scope_accounted'
      : 'site-onboarding.capability.controlled_scope_needs_review',
    controlledScopeOnly: true,
    liveCapabilityVerificationClaimed: false,
    executableCoverageClaimed: false,
    observedCapabilityAutoPromotionAllowed: false,
    graphCapabilityPromotionAllowed: false,
    plannerCapabilityPlanAllowed: false,
    layerExecutionAllowed: false,
    downloaderExecutionAllowed: false,
    artifactRefs: ['CAPABILITY_TARGETS', 'CAPABILITY_GAP_REPORT'],
    targetCounts: {
      total: targets.length,
      discoveryStateCounts: countCapabilityTargetsByField(targets, 'discoveryState'),
      verificationStateCounts: countCapabilityTargetsByField(targets, 'verificationState'),
      desiredStateCounts: countCapabilityTargetsByField(targets, 'desiredState'),
      executableAllowedTargets: targets.filter((target) => target.executableCapabilityAllowed === true).length,
      observedNonExecutableTargets: targets.filter((target) =>
        target.discoveryState === 'observed_only' && target.executableCapabilityAllowed === false).length,
      unknownTargets: targets.filter((target) => target.discoveryState === 'unknown').length,
      verifiedTargets: targets.filter((target) => target.verificationState === 'verified').length,
      requiredTargets: targets.filter((target) => target.desiredState === 'required').length,
    },
    evidenceCounts: {
      evidenceKindCounts: countCapabilityEvidenceKinds(targets),
      missingEvidenceKindCounts: countCapabilityMissingEvidenceKinds(targets),
      totalEvidenceMappings: targets
        .reduce((total, target) => total + toArray(target.evidenceMappings).length, 0),
      executableEvidenceMappings: targets
        .reduce((total, target) => total + Number(target.mappingSummary?.executableEvidenceCount ?? 0), 0),
      totalEvidenceRequirementGaps: capabilityGapReport?.totalEvidenceRequirementGaps ?? 0,
    },
    reportCounts: {
      capabilityGaps: capabilityGapReport?.totalGaps ?? 0,
      requiredCapabilityGaps: capabilityGapReport?.requiredGaps ?? 0,
    },
    accountingChecks: {
      capabilityTargetsPresent: capabilityTargets?.artifactName === 'CAPABILITY_TARGETS',
      capabilityGapReportPresent: capabilityGapReport?.artifactName === 'CAPABILITY_GAP_REPORT',
      canonicalCapabilityTargetCountMatches: targets.length === SITE_ONBOARDING_DISCOVERY_CAPABILITY_TARGETS.length,
      everyCapabilityHasKnownDiscoveryState: unsupportedCapabilityStatusTargets.length === 0,
      everyCapabilityHasKnownVerificationState: unsupportedVerificationTargets.length === 0,
      capabilityGapCountMatches,
      requiredCapabilityGapCountMatches,
      everyUnverifiedCapabilityHasGapRecord,
      observedCapabilitiesNonExecutable,
      executableCapabilitiesHaveVerifiedQuorum,
      executableCapabilitiesHaveNoRequirementGaps,
      capabilityMappingsDescriptorOnly,
      gapRecordsDescriptorOnly,
      noCapabilitySurfaceSilentlyDroppedWithinControlledScope,
    },
    descriptorOnly: true,
    redactionRequired: true,
  });
}

function createFullDiscoveryClosureEvidence({
  nodeInventory,
  apiInventory,
  unknownNodeReport,
  blockedNodeReport,
  unknownApiReport,
  blockedApiReport,
  capabilityTargets,
  capabilityGapReport,
  coverageGate,
  discoveryScorecard,
} = {}) {
  const artifactPresence = {
    nodeInventoryPresent: nodeInventory?.artifactName === 'NODE_INVENTORY',
    apiInventoryPresent: apiInventory?.artifactName === 'API_INVENTORY',
    unknownNodeReportPresent: unknownNodeReport?.artifactName === 'UNKNOWN_NODE_REPORT',
    blockedNodeReportPresent: blockedNodeReport?.artifactName === 'BLOCKED_NODE_REPORT',
    unknownApiReportPresent: unknownApiReport?.artifactName === 'UNKNOWN_API_REPORT',
    blockedApiReportPresent: blockedApiReport?.artifactName === 'BLOCKED_API_REPORT',
    capabilityTargetsPresent: capabilityTargets?.artifactName === 'CAPABILITY_TARGETS',
    capabilityGapReportPresent: capabilityGapReport?.artifactName === 'CAPABILITY_GAP_REPORT',
  };
  const nodeEntries = nodeInventory?.entries ?? [];
  const apiEntries = apiInventory?.entries ?? [];
  const allEntries = [...nodeEntries, ...apiEntries];
  const unclassifiedEntries = allEntries.filter((entry) => !CLASSIFICATION_SET.has(entry.classification));
  const unsupportedStatusEntries = allEntries.filter((entry) => !DISCOVERY_STATUS_SET.has(entry.discoveryStatus));
  const blockedNodeCountMatches = (blockedNodeReport?.total ?? 0) === entriesWithBlockedStatus(nodeEntries).length;
  const blockedApiCountMatches = (blockedApiReport?.total ?? 0) === entriesWithBlockedStatus(apiEntries).length;
  const unknownNodeCountMatches = (unknownNodeReport?.totalUnknownNodes ?? 0)
    === nodeEntries.filter((entry) => entry.classification === 'unknown').length;
  const unknownApiCountMatches = (unknownApiReport?.totalUnknownApis ?? 0)
    === apiEntries.filter((entry) => entry.classification === 'unknown').length;
  const capabilityGapCountMatches = (capabilityGapReport?.totalGaps ?? 0)
    === (capabilityTargets?.targets ?? []).filter((target) => target.verificationState !== 'verified').length;
  const artifactsPresent = Object.values(artifactPresence).every(Boolean);
  const noSilentDropWithinControlledScope = artifactsPresent
    && unclassifiedEntries.length === 0
    && unsupportedStatusEntries.length === 0
    && blockedNodeCountMatches
    && blockedApiCountMatches
    && unknownNodeCountMatches
    && unknownApiCountMatches
    && capabilityGapCountMatches;
  const apiControlledScopeClosure = createApiControlledScopeClosureEvidence({
    apiInventory,
    unknownApiReport,
    blockedApiReport,
  });
  const capabilityControlledScopeClosure = createCapabilityControlledScopeClosureEvidence({
    capabilityTargets,
    capabilityGapReport,
  });
  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    closureKind: 'full-discovery-controlled-scope-closure',
    closureStatus: noSilentDropWithinControlledScope ? 'controlled_scope_accounted' : 'needs_review',
    reasonCode: noSilentDropWithinControlledScope
      ? 'site-onboarding.full_discovery.controlled_scope_accounted'
      : 'site-onboarding.full_discovery.controlled_scope_needs_review',
    controlledScopeOnly: true,
    liveCoverageClaimed: false,
    executionCoverageClaimed: false,
    promotionAllowed: false,
    realWorldExhaustiveCrawlClaimed: false,
    inaccessibleSurfaceBypassAllowed: false,
    unboundedCrawlAllowed: false,
    observedApiAutoPromotionAllowed: false,
    observedCapabilityAutoPromotionAllowed: false,
    graphPlannerLayerPromotionAllowed: false,
    downloaderExecutionAllowed: false,
    artifactRefs: SITE_ONBOARDING_DISCOVERY_ARTIFACT_NAMES,
    artifactPresence,
    unresolvedCounts: {
      unknownNodes: unknownNodeReport?.totalUnknownNodes ?? 0,
      unknownApis: unknownApiReport?.totalUnknownApis ?? 0,
      capabilityGaps: capabilityGapReport?.totalGaps ?? 0,
      requiredCapabilityGaps: capabilityGapReport?.requiredGaps ?? 0,
    },
    blockedCounts: {
      nodes: blockedNodeReport?.total ?? 0,
      apis: blockedApiReport?.total ?? 0,
      nodeSurfaceCategories: blockedNodeReport?.surfaceCategoryCounts ?? {},
      apiStatusCounts: blockedApiReport?.statusCounts ?? {},
    },
    observedCounts: {
      nodes: nodeInventory?.statusCounts?.observed_only ?? 0,
      apis: apiInventory?.statusCounts?.observed_only ?? 0,
      capabilities: capabilityTargets?.statusCounts?.observed_only ?? 0,
    },
    accountingChecks: {
      everyDiscoveredItemClassified: unclassifiedEntries.length === 0,
      everyDiscoveredItemHasKnownStatus: unsupportedStatusEntries.length === 0,
      blockedNodeCountMatches,
      blockedApiCountMatches,
      unknownNodeCountMatches,
      unknownApiCountMatches,
      capabilityGapCountMatches,
      unknownBlockedGapArtifactsPresent: artifactsPresent,
      noSilentDropWithinControlledScope,
      completionAllowed: coverageGate?.passed === true && noSilentDropWithinControlledScope,
      ninetyPointEvidenceReady: discoveryScorecard?.evidence?.pass === true,
    },
    summary: {
      nodeTotal: nodeInventory?.total ?? 0,
      apiTotal: apiInventory?.total ?? 0,
      capabilityTargetTotal: capabilityTargets?.total ?? 0,
      unknownNodeTotal: unknownNodeReport?.totalUnknownNodes ?? 0,
      unknownApiTotal: unknownApiReport?.totalUnknownApis ?? 0,
      blockedNodeTotal: blockedNodeReport?.total ?? 0,
      blockedApiTotal: blockedApiReport?.total ?? 0,
      capabilityGapTotal: capabilityGapReport?.totalGaps ?? 0,
    },
    apiControlledScopeClosure,
    capabilityControlledScopeClosure,
    descriptorOnly: true,
    redactionRequired: true,
  });
}

export function createSiteCapabilityReport({
  siteKey,
  nodeInventory,
  apiInventory,
  unknownNodeReport,
  blockedNodeReport,
  unknownApiReport,
  blockedApiReport,
  capabilityTargets,
  capabilityGapReport,
  coverageGate,
  coveragePlan,
  discoveryScorecard,
  discoveryMode = SITE_ONBOARDING_FULL_DISCOVERY_MODE,
} = {}) {
  const unknownApis = (apiInventory?.entries ?? [])
    .filter((entry) => entry.classification === 'unknown');
  const resolvedCoveragePlan = coveragePlan ?? createSiteOnboardingDiscoveryCoveragePlan({ siteKey });
  const resolvedScorecard = discoveryScorecard ?? createSiteOnboardingDiscoveryScorecard({
    coveragePlan: resolvedCoveragePlan,
    nodeInventory,
    apiInventory,
  });
  const fullDiscoveryClosure = createFullDiscoveryClosureEvidence({
    nodeInventory,
    apiInventory,
    unknownNodeReport,
    blockedNodeReport,
    unknownApiReport,
    blockedApiReport,
    capabilityTargets,
    capabilityGapReport,
    coverageGate,
    discoveryScorecard: resolvedScorecard,
  });

  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    artifactName: 'SITE_CAPABILITY_REPORT',
    siteKey: normalizeText(siteKey),
    discoveryMode,
    modeSemantics: {
      controlledScopeOnly: true,
      exhaustiveWithinAccessibleScope: discoveryMode === SITE_ONBOARDING_EXHAUSTIVE_DISCOVERY_MODE,
      unboundedCrawlAllowed: false,
      accessControlBypassAllowed: false,
      observedApiAutoPromotionAllowed: false,
      observedCapabilityAutoPromotionAllowed: false,
    },
    gate: coverageGate,
    fullDiscoveryClosure,
    discoveryCoveragePlan: resolvedCoveragePlan,
    discoveryScorecard: resolvedScorecard,
    summary: {
      nodeTotal: nodeInventory?.total ?? 0,
      apiTotal: apiInventory?.total ?? 0,
      capabilityTargetTotal: capabilityTargets?.total ?? 0,
      unknownNodeTotal: unknownNodeReport?.totalUnknownNodes ?? 0,
      unknownRequiredNodeTotal: unknownNodeReport?.totalUnknownRequiredNodes ?? 0,
      unknownApiTotal: unknownApis.length,
      unknownRequiredApiTotal: unknownApis.filter((entry) => entry.required).length,
      blockedNodeTotal: blockedNodeReport?.total ?? 0,
      blockedApiTotal: blockedApiReport?.total ?? 0,
      capabilityGapTotal: capabilityGapReport?.totalGaps ?? 0,
      requiredCapabilityGapTotal: capabilityGapReport?.requiredGaps ?? 0,
      ignoredNodeTotal: nodeInventory?.counts?.ignored ?? 0,
      ignoredApiTotal: apiInventory?.counts?.ignored ?? 0,
      statusCounts: mergeStatusCounts(
        nodeInventory?.statusCounts,
        apiInventory?.statusCounts,
        capabilityTargets?.statusCounts,
      ),
      nodeStatusCounts: nodeInventory?.statusCounts ?? countByDiscoveryStatus([]),
      apiStatusCounts: apiInventory?.statusCounts ?? countByDiscoveryStatus([]),
      capabilityStatusCounts: capabilityTargets?.statusCounts ?? countByDiscoveryStatus([]),
      architectureDiscoveryScore: resolvedScorecard.architecture.overallScore,
      evidenceDiscoveryScore: resolvedScorecard.evidence.overallScore,
      ninetyPointArchitectureReady: resolvedScorecard.architecture.pass,
      ninetyPointEvidenceReady: resolvedScorecard.evidence.pass,
      fullDiscoveryArtifactReady: Boolean(
        nodeInventory
        && apiInventory
        && unknownNodeReport
        && blockedNodeReport
        && unknownApiReport
        && blockedApiReport
        && capabilityTargets
        && capabilityGapReport,
      ),
      controlledScopeClosureReady: fullDiscoveryClosure.accountingChecks.noSilentDropWithinControlledScope,
    },
    siteSpecificInterpretationOwner: 'SiteAdapter',
    serviceBoundary: 'Discovery inventory stores adapter decisions only; no concrete site semantics are encoded in this service.',
    redactionRequired: true,
  });
}

export function createDiscoveryAudit({
  siteKey,
  adapter,
  generatedAt,
  nodeInventory,
  apiInventory,
  unknownNodeReport,
  blockedNodeReport,
  unknownApiReport,
  blockedApiReport,
  capabilityTargets,
  capabilityGapReport,
  coverageGate,
  discoveryScorecard,
  discoveryMode = SITE_ONBOARDING_FULL_DISCOVERY_MODE,
} = {}) {
  const allEntries = [
    ...(nodeInventory?.entries ?? []),
    ...(apiInventory?.entries ?? []),
  ];
  const ignoredWithoutReason = allEntries.filter((entry) => entry.classification === 'ignored' && !entry.reason);
  const unrecordedItems = allEntries.filter((entry) => !CLASSIFICATION_SET.has(entry.classification));
  const unsupportedStatuses = allEntries.filter((entry) => !DISCOVERY_STATUS_SET.has(entry.discoveryStatus));
  const adapterId = normalizeText(adapter?.adapterId ?? adapter?.id ?? adapter?.name);
  const fullDiscoveryClosure = createFullDiscoveryClosureEvidence({
    nodeInventory,
    apiInventory,
    unknownNodeReport,
    blockedNodeReport,
    unknownApiReport,
    blockedApiReport,
    capabilityTargets,
    capabilityGapReport,
    coverageGate,
    discoveryScorecard,
  });

  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    artifactName: 'DISCOVERY_AUDIT',
    discoveryMode,
    siteKey: normalizeText(siteKey),
    generatedAt: normalizeText(generatedAt) ?? new Date().toISOString(),
    adapterId,
    artifactNames: SITE_ONBOARDING_DISCOVERY_ARTIFACT_NAMES,
    gate: coverageGate,
    fullDiscoveryClosure,
    invariantChecks: {
      ignoredItemsHaveReason: ignoredWithoutReason.length === 0,
      everyDiscoveredItemRecorded: unrecordedItems.length === 0,
      everyDiscoveredItemHasKnownStatus: unsupportedStatuses.length === 0,
      requiredCoverageAtLeastThreshold: coverageGate?.requiredCoveragePass === true,
      unknownRequiredNodesZero: coverageGate?.unknownRequiredNodesPass === true,
      unknownRequiredApisZero: coverageGate?.unknownRequiredApisPass === true,
      requiredIgnoredNodesZero: coverageGate?.requiredIgnoredNodesPass === true,
      requiredIgnoredApisZero: coverageGate?.requiredIgnoredApisPass === true,
      blockedNodeReportPresent: blockedNodeReport?.artifactName === 'BLOCKED_NODE_REPORT',
      unknownApiReportPresent: unknownApiReport?.artifactName === 'UNKNOWN_API_REPORT',
      blockedApiReportPresent: blockedApiReport?.artifactName === 'BLOCKED_API_REPORT',
      capabilityTargetsPresent: capabilityTargets?.artifactName === 'CAPABILITY_TARGETS',
      capabilityGapReportPresent: capabilityGapReport?.artifactName === 'CAPABILITY_GAP_REPORT',
      ninetyPointArchitectureReady: discoveryScorecard?.architecture?.pass === true,
      ninetyPointEvidenceReady: discoveryScorecard?.evidence?.pass === true,
      controlledScopeClosureReady: fullDiscoveryClosure.accountingChecks.noSilentDropWithinControlledScope,
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
    redactionRequired: true,
  });
}

function renderInventoryMarkdown(inventory, title) {
  const rows = inventory.entries.map((entry) => [
    entry.id,
    entry.label,
    entry.locator,
    boolText(entry.required),
    entry.classification,
    entry.discoveryStatus,
    entry.verificationState,
    entry.recognizedAs ?? '',
    entry.reason ?? '',
    entry.gapReason ?? '',
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
        ['ID', 'Label', 'Locator', 'Required', 'Classification', 'Status', 'Verification', 'Recognized as', 'Reason', 'Gap reason'],
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
    entry.transport ?? '',
    entry.resourceType ?? '',
    entry.endpointKind ?? '',
    entry.riskClass ?? '',
    entry.label,
    entry.locator,
    boolText(entry.required),
    entry.classification,
    entry.discoveryStatus,
    entry.verificationState,
    entry.recognizedAs ?? '',
    entry.reason ?? '',
    entry.gapReason ?? '',
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
        ['ID', 'Method', 'Transport', 'Resource type', 'Endpoint kind', 'Risk class', 'Label', 'Endpoint', 'Required', 'Classification', 'Status', 'Verification', 'Recognized as', 'Reason', 'Gap reason'],
        rows,
      )
      : 'No discovered APIs.',
  ].join('\n');
}

function renderGapEntriesMarkdown({ title, introRows = [], entries = [] }) {
  const rows = entries.map((entry) => [
    entry.discoveryKind,
    entry.id,
    entry.label,
    entry.locator,
    boolText(entry.required),
    entry.discoveryStatus ?? '',
    entry.verificationState ?? '',
    entry.reason ?? entry.gapReason ?? 'not-recognized-by-adapter',
  ]);
  return [
    `# ${title}`,
    '',
    ...introRows,
    '',
    rows.length
      ? markdownTable(['Kind', 'ID', 'Label', 'Locator', 'Required', 'Status', 'Verification', 'Reason'], rows)
      : 'No entries.',
  ].join('\n');
}

export function renderUnknownNodeReportMarkdown(unknownNodeReport) {
  const entries = [
    ...(unknownNodeReport.nodes ?? []).map((entry) => ({ ...entry, discoveryKind: 'node' })),
    ...(unknownNodeReport.apis ?? []).map((entry) => ({ ...entry, discoveryKind: 'api' })),
  ];
  return [
    renderGapEntriesMarkdown({
      title: 'UNKNOWN_NODE_REPORT',
      introRows: [
        `Unknown nodes: ${unknownNodeReport.totalUnknownNodes}`,
        `Unknown required nodes: ${unknownNodeReport.totalUnknownRequiredNodes}`,
        `Unknown APIs: ${unknownNodeReport.totalUnknownApis}`,
        `Unknown required APIs: ${unknownNodeReport.totalUnknownRequiredApis}`,
        `Gate unknown required nodes = 0: ${boolText(unknownNodeReport.gateRequiredUnknownNodesZero)}`,
        `Gate unknown required APIs = 0: ${boolText(unknownNodeReport.gateRequiredUnknownApisZero)}`,
      ],
      entries,
    }),
  ].join('\n');
}

export function renderBlockedReportMarkdown(report) {
  return renderGapEntriesMarkdown({
    title: report.artifactName,
    introRows: [
      `Total: ${report.total}`,
      ...SITE_ONBOARDING_DISCOVERY_STATUSES
        .filter((status) => (report.statusCounts?.[status] ?? 0) > 0)
        .map((status) => `${status}: ${report.statusCounts[status]}`),
    ],
    entries: (report.entries ?? []).map((entry) => ({
      ...entry,
      discoveryKind: report.kind,
    })),
  });
}

export function renderUnknownApiReportMarkdown(report) {
  return renderGapEntriesMarkdown({
    title: 'UNKNOWN_API_REPORT',
    introRows: [
      `Unknown APIs: ${report.totalUnknownApis}`,
      `Unknown required APIs: ${report.totalUnknownRequiredApis}`,
      `Gate unknown required APIs = 0: ${boolText(report.gateRequiredUnknownApisZero)}`,
    ],
    entries: (report.entries ?? []).map((entry) => ({
      ...entry,
      discoveryKind: 'api',
    })),
  });
}

export function renderCapabilityTargetsMarkdown(report) {
  const rows = (report.targets ?? []).map((target) => [
    target.targetId,
    target.desiredState,
    target.discoveryState,
    target.verificationState,
    boolText(target.executableCapabilityAllowed),
    target.evidenceCount,
    (target.evidenceKinds ?? []).join(','),
    (target.missingEvidenceKinds ?? []).join(','),
    target.mappingSummary?.observedEvidenceCount ?? 0,
    target.mappingSummary?.executableEvidenceCount ?? 0,
    target.evidenceCompletionStrategy?.nextAction ?? '',
    target.targetSources.map((source) => source.kind).join(','),
  ]);
  return [
    '# CAPABILITY_TARGETS',
    '',
    `Total: ${report.total}`,
    '',
    rows.length
      ? markdownTable(['Target', 'Desired', 'Discovery', 'Verification', 'Executable', 'Evidence count', 'Evidence kinds', 'Missing evidence', 'Mapped evidence', 'Executable evidence', 'Next evidence action', 'Sources'], rows)
      : 'No capability targets.',
  ].join('\n');
}

export function renderCapabilityGapReportMarkdown(report) {
  const rows = (report.gaps ?? []).map((gap) => [
    gap.targetId,
    gap.desiredState,
    gap.discoveryState,
    gap.verificationState,
    gap.gapStatus,
    boolText(gap.requiresManualReview),
    (gap.evidenceKinds ?? []).join(','),
    (gap.missingEvidenceKinds ?? []).join(','),
    gap.evidenceRequirementGapCount ?? 0,
    gap.evidenceCompletionStrategy?.nextAction ?? '',
    (gap.mappingGaps ?? []).map((mappingGap) => mappingGap.gapKind).join(','),
    gap.reason,
  ]);
  return [
    '# CAPABILITY_GAP_REPORT',
    '',
    `Total gaps: ${report.totalGaps}`,
    `Required gaps: ${report.requiredGaps}`,
    '',
    rows.length
      ? markdownTable(['Target', 'Desired', 'Discovery', 'Verification', 'Gap', 'Manual review', 'Evidence kinds', 'Missing evidence', 'Evidence requirement gaps', 'Next evidence action', 'Mapping gaps', 'Reason'], rows)
      : 'No capability gaps.',
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
    `90-point architecture ready: ${boolText(summary.ninetyPointArchitectureReady)}`,
    `90-point evidence ready: ${boolText(summary.ninetyPointEvidenceReady)}`,
    `Architecture discovery score: ${summary.architectureDiscoveryScore}`,
    `Evidence discovery score: ${summary.evidenceDiscoveryScore}`,
    `Unknown required nodes: ${gate.unknownRequiredNodes}`,
    '',
    markdownTable(
      ['Metric', 'Value'],
      [
        ['nodeTotal', summary.nodeTotal],
        ['apiTotal', summary.apiTotal],
        ['capabilityTargetTotal', summary.capabilityTargetTotal],
        ['unknownNodeTotal', summary.unknownNodeTotal],
        ['unknownRequiredNodeTotal', summary.unknownRequiredNodeTotal],
        ['unknownApiTotal', summary.unknownApiTotal],
        ['unknownRequiredApiTotal', summary.unknownRequiredApiTotal],
        ['blockedNodeTotal', summary.blockedNodeTotal],
        ['blockedApiTotal', summary.blockedApiTotal],
        ['capabilityGapTotal', summary.capabilityGapTotal],
        ['requiredCapabilityGapTotal', summary.requiredCapabilityGapTotal],
        ['discovered', summary.statusCounts?.discovered ?? 0],
        ['verified', summary.statusCounts?.verified ?? 0],
        ['observed_only', summary.statusCounts?.observed_only ?? 0],
        ['unknown', summary.statusCounts?.unknown ?? 0],
        ['blocked', summary.statusCounts?.blocked ?? 0],
        ['skipped_by_budget', summary.statusCounts?.skipped_by_budget ?? 0],
        ['skipped_by_policy', summary.statusCounts?.skipped_by_policy ?? 0],
        ['requires_login', summary.statusCounts?.requires_login ?? 0],
        ['requires_manual_review', summary.statusCounts?.requires_manual_review ?? 0],
        ['ignoredNodeTotal', summary.ignoredNodeTotal],
        ['ignoredApiTotal', summary.ignoredApiTotal],
        ['architectureDiscoveryScore', summary.architectureDiscoveryScore],
        ['evidenceDiscoveryScore', summary.evidenceDiscoveryScore],
        ['controlledScopeClosureReady', boolText(summary.controlledScopeClosureReady)],
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
        ['everyDiscoveredItemHasKnownStatus', boolText(checks.everyDiscoveredItemHasKnownStatus)],
        ['requiredCoverageAtLeastThreshold', boolText(checks.requiredCoverageAtLeastThreshold)],
        ['unknownRequiredNodesZero', boolText(checks.unknownRequiredNodesZero)],
        ['blockedNodeReportPresent', boolText(checks.blockedNodeReportPresent)],
        ['unknownApiReportPresent', boolText(checks.unknownApiReportPresent)],
        ['blockedApiReportPresent', boolText(checks.blockedApiReportPresent)],
        ['capabilityTargetsPresent', boolText(checks.capabilityTargetsPresent)],
        ['capabilityGapReportPresent', boolText(checks.capabilityGapReportPresent)],
        ['ninetyPointArchitectureReady', boolText(checks.ninetyPointArchitectureReady)],
        ['ninetyPointEvidenceReady', boolText(checks.ninetyPointEvidenceReady)],
        ['controlledScopeClosureReady', boolText(checks.controlledScopeClosureReady)],
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
  capabilityIntake = null,
  requestedCapabilities = [],
  capabilityFamilies = [],
  supportedIntents = [],
  pageTypes = [],
  capabilityInventory = null,
  capabilityCoverageSummary = null,
  discoveryMode = SITE_ONBOARDING_FULL_DISCOVERY_MODE,
} = {}) {
  const nodeInventory = createNodeInventory(discoveredNodes, { siteKey, adapter });
  const apiInventory = createApiInventory(discoveredApis, { siteKey, adapter });
  const unknownNodeReport = createUnknownNodeReport(nodeInventory, apiInventory);
  const blockedNodeReport = createBlockedNodeReport(nodeInventory);
  const unknownApiReport = createUnknownApiReport(apiInventory);
  const blockedApiReport = createBlockedApiReport(apiInventory);
  const coverageGate = evaluateSiteOnboardingCoverageGate({
    nodeInventory,
    apiInventory,
    requiredCoverageThreshold,
  });
  const coveragePlan = createSiteOnboardingDiscoveryCoveragePlan({
    siteKey,
    capabilityIntake,
    requestedCapabilities,
    capabilityFamilies,
    supportedIntents,
    pageTypes,
  });
  const discoveryScorecard = createSiteOnboardingDiscoveryScorecard({
    coveragePlan,
    nodeInventory,
    apiInventory,
    capabilityInventory,
    capabilityCoverageSummary,
    adapter,
  });
  const capabilityTargets = createCapabilityTargets({
    siteKey,
    generatedAt,
    coveragePlan,
    requestedCapabilities,
    capabilityInventory,
    capabilityCoverageSummary,
    nodeInventory,
    apiInventory,
    adapter,
  });
  const capabilityGapReport = createCapabilityGapReport(capabilityTargets);
  const siteCapabilityReport = createSiteCapabilityReport({
    siteKey,
    nodeInventory,
    apiInventory,
    unknownNodeReport,
    blockedNodeReport,
    unknownApiReport,
    blockedApiReport,
    capabilityTargets,
    capabilityGapReport,
    coverageGate,
    coveragePlan,
    discoveryScorecard,
    discoveryMode,
  });
  const discoveryAudit = createDiscoveryAudit({
    siteKey,
    adapter,
    generatedAt,
    nodeInventory,
    apiInventory,
    unknownNodeReport,
    blockedNodeReport,
    unknownApiReport,
    blockedApiReport,
    capabilityTargets,
    capabilityGapReport,
    coverageGate,
    discoveryScorecard,
    discoveryMode,
  });
  const objects = {
    NODE_INVENTORY: nodeInventory,
    API_INVENTORY: apiInventory,
    UNKNOWN_NODE_REPORT: unknownNodeReport,
    BLOCKED_NODE_REPORT: blockedNodeReport,
    UNKNOWN_API_REPORT: unknownApiReport,
    BLOCKED_API_REPORT: blockedApiReport,
    CAPABILITY_TARGETS: capabilityTargets,
    CAPABILITY_GAP_REPORT: capabilityGapReport,
    SITE_CAPABILITY_REPORT: siteCapabilityReport,
    DISCOVERY_AUDIT: discoveryAudit,
  };
  const markdown = {
    NODE_INVENTORY: renderNodeInventoryMarkdown(nodeInventory),
    API_INVENTORY: renderApiInventoryMarkdown(apiInventory),
    UNKNOWN_NODE_REPORT: renderUnknownNodeReportMarkdown(unknownNodeReport),
    BLOCKED_NODE_REPORT: renderBlockedReportMarkdown(blockedNodeReport),
    UNKNOWN_API_REPORT: renderUnknownApiReportMarkdown(unknownApiReport),
    BLOCKED_API_REPORT: renderBlockedReportMarkdown(blockedApiReport),
    CAPABILITY_TARGETS: renderCapabilityTargetsMarkdown(capabilityTargets),
    CAPABILITY_GAP_REPORT: renderCapabilityGapReportMarkdown(capabilityGapReport),
    SITE_CAPABILITY_REPORT: renderSiteCapabilityReportMarkdown(siteCapabilityReport),
    DISCOVERY_AUDIT: renderDiscoveryAuditMarkdown(discoveryAudit),
  };

  return freezeDeep({
    schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
    siteKey: normalizeText(siteKey),
    discoveryMode,
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
