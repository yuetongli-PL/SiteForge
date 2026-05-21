// @ts-check

import {
  REDACTION_PLACEHOLDER,
  isSensitiveFieldName,
  scanForbiddenPatterns,
} from '../sessions/security-guard.mjs';

export const NON_GOALS_BOUNDARY_SCHEMA_VERSION = 1;

export const NON_GOALS_BOUNDARY_OWNERS = Object.freeze([
  'Kernel',
  'CapabilityService',
  'SiteAdapter',
  'downloader',
]);

const OWNER_SET = new Set(NON_GOALS_BOUNDARY_OWNERS);

const RAW_SENSITIVE_KEY_PATTERNS = Object.freeze([
  /credential/iu,
  /authorization/iu,
  /^cookie$/iu,
  /^cookies$/iu,
  /^set-cookie$/iu,
  /csrf|xsrf/iu,
  /sessdata/iu,
  /(?:^|[_-])access[_-]?token$/iu,
  /(?:^|[_-])refresh[_-]?token$/iu,
  /(?:^|[_-])session[_-]?id$/iu,
  /session[_-]?material/iu,
  /raw[_-]?session/iu,
  /browser[_-]?profile/iu,
  /profile[_-]?path/iu,
  /user[_-]?data[_-]?dir/iu,
]);

const RAW_SENSITIVE_TEXT_PATTERNS = Object.freeze([
  /\b(?:raw\s+)?(?:credential|credentials|cookie|cookies|csrf|token|authorization\s+header|sessdata|session\s+id|session\s+material)\b/iu,
  /\b(?:browser\s+profile|browserProfile|userDataDir|profile\s+path)\b/iu,
]);

const CONCRETE_SITE_NAME_PATTERN =
  /\b(?:22biqu|bilibili|douyin|instagram|jable|moodyz|xiaohongshu|x\.com|api\.bilibili\.com|www\.douyin\.com)\b/iu;

const SITE_SEMANTIC_TEXT_PATTERN =
  /\b(?:page\s*type|endpoint|selector|parser|interpret(?:ation|er)?|classif(?:y|ication)|business\s+logic|risk\s+signal|site\s+signature|api\s+shape|field\s+mapping|pagination\s+model|semantic|semantics|meaning|validation)\b/iu;

const GENERIC_SITE_SEMANTIC_TEXT_PATTERN =
  /\b(?:concrete|specific|per-site|site-specific)\s+site\s+(?:semantic|semantics|meaning|business\s+logic|interpretation|validation)\b/iu;

const CONCRETE_SITE_IMPORT_PATTERN =
  /(?:^|[\\/])src[\\/]sites[\\/]core[\\/]adapters[\\/](?:22biqu|bilibili|douyin|instagram|jable|moodyz|x|xiaohongshu)\.mjs$/iu;

const API_AUTO_PROMOTION_TEXT_PATTERN =
  /\b(?:api|candidate|catalog|endpoint)\b.*\bauto[-_\s]?promot(?:e|ion|ed|ing)\b|\bauto[-_\s]?promot(?:e|ion|ed|ing)\b.*\b(?:api|candidate|catalog|endpoint)\b/iu;

const API_AUTO_PROMOTION_KEY_PATTERN =
  /^(?:api)?auto[-_]?promot(?:e|ion)$|^auto[-_]?promot(?:e|ion)(?:api|candidate|catalog|endpoint)$/iu;

export const NON_GOAL_BYPASS_RULE_FAMILY = Object.freeze([
  'captcha-bypass',
  'mfa-bypass',
  'anti-bot-bypass',
  'access-control-bypass',
  'platform-risk-bypass',
  'silent-privilege-expansion',
]);

const NON_GOAL_BYPASS_TARGET_PATTERN =
  /(?:captcha|mfa|multi[-_\s]?factor|two[-_\s]?factor|2fa|anti[-_\s]?(?:bot|crawl|crawler|automation)|bot[-_\s]?check|access[-_\s]?control|permission|paywall|vip|platform[-_\s]?risk|risk[-_\s]?control|privilege|privileges?)/iu;

const NON_GOAL_BYPASS_ACTION_PATTERN =
  /(?:bypass|bypassing|bypassed|evasion|evade|evading|evaded|circumvent|circumventing|circumvention|solve|solver|solving|unlock|unlocking|silent[-_\s]?privilege[-_\s]?expansion|privilege[-_\s]?escalation|escalate[-_\s]?privilege)/iu;

const NON_GOAL_BYPASS_KEY_PATTERN =
  /(?:captcha|mfa|multi[-_]?factor|two[-_]?factor|2fa|anti[-_]?(?:bot|crawl|crawler|automation)|bot[-_]?check|access[-_]?control|permission|paywall|vip|platform[-_]?risk|risk[-_]?control|privilege|privileges?).*(?:bypass|evasion|evade|circumvent|solve|solver|unlock|escalat)|(?:bypass|evasion|evade|circumvent|solve|solver|unlock|escalat).*(?:captcha|mfa|multi[-_]?factor|two[-_]?factor|2fa|anti[-_]?(?:bot|crawl|crawler|automation)|bot[-_]?check|access[-_]?control|permission|paywall|vip|platform[-_]?risk|risk[-_]?control|privilege|privileges?)|silent[-_]?privilege[-_]?expansion/iu;

const NON_GOAL_BYPASS_ALLOWED_BLOCKED_TEXT_PATTERN =
  /\b(?:blocked|manual\s+recovery|required\s+user\s+action|requires\s+user\s+action|safe[-_\s]?stop|fail[-_\s]?closed|quarantine|cooldown|do\s+not|must\s+not|never|no\s+(?:bypass|evasion|solve|solver|unlock|silent\s+privilege\s+expansion))\b/iu;

const DOWNLOADER_RAW_SESSION_IMPORT_PATTERN =
  /(?:^|[\\/])src[\\/](?:infra[\\/]browser[\\/]session|infra[\\/]auth[\\/]site-session-governance|sites[\\/]sessions[\\/]runner|sites[\\/]downloads[\\/]session-manager)\.mjs$/iu;

const DOWNLOADER_RAW_SESSION_IMPORT_NAME_PATTERN =
  /\b(?:raw|cookie|credential|browserProfile|browser_profile|profilePath|userDataDir|sessionMaterial|rawSession)\b/iu;

const NON_GOAL_RUNTIME_BOUNDARY_HANDOFF_ARTIFACT_FAMILY =
  'site-capability-graph-non-goal-runtime-boundary-handoff-guard';

const NON_GOAL_LIVE_CONSUMER_ACCEPTANCE_ARTIFACT_FAMILY =
  'site-capability-graph-non-goal-live-consumer-acceptance-guard';

const NON_GOAL_LIVE_CONSUMER_COMPATIBILITY_REVIEW_ARTIFACT_FAMILY =
  'site-capability-graph-non-goal-live-consumer-compatibility-review-gate';

const NON_GOAL_RUNTIME_BOUNDARY_HANDOFF_REASON_CODE =
  'non-goal-runtime-boundary-disabled';

const NON_GOAL_RUNTIME_HANDOFF_DISABLED_FLAG_KEYS = Object.freeze([
  'featureEnabled',
  'runtimeConsumerEnabled',
  'runtimeHandoffEnabled',
  'producerEnabled',
  'subscriberEnabled',
  'callbackEnabled',
  'handlerEnabled',
  'writeEnabled',
  'writePathEnabled',
  'repoWriteEnabled',
  'runtimeWriteEnabled',
  'runtimeArtifactWriteEnabled',
  'executionEnabled',
  'executionAllowed',
  'runtimeExecutionEnabled',
  'liveRuntimeEnabled',
  'materializationEnabled',
  'sessionMaterializationEnabled',
  'externalTelemetryEnabled',
  'externalDispatchEnabled',
  'telemetryDispatchEnabled',
  'siteAdapterInvocationEnabled',
  'downloaderInvocationEnabled',
  'captchaBypassEnabled',
  'antiBotBypassEnabled',
  'accessControlBypassEnabled',
]);

const NON_GOAL_RUNTIME_HANDOFF_RUNTIME_KEY_PATTERNS = Object.freeze([
  /authorization/iu,
  /sessdata/iu,
  /^cookie$/iu,
  /^cookies$/iu,
  /csrf|xsrf/iu,
  /(?:^|[_-])token$/iu,
  /(?:^|[_-])session[_-]?id$/iu,
  /browser[_-]?profile/iu,
  /session[_-]?view/iu,
  /download[_-]?policy/iu,
  /task[_-]?list/iu,
  /standard[_-]?task[_-]?list/iu,
  /site[_-]?adapter/iu,
  /downloader/iu,
  /callback/iu,
  /handler/iu,
  /output[_-]?path/iu,
  /repo[_-]?path/iu,
  /repo[_-]?write|repoWrite/iu,
  /runtime[_-]?write|runtimeWrite/iu,
  /runtime[_-]?artifact/iu,
  /external[_-]?telemetry/iu,
  /external[_-]?dispatch|externalDispatch/iu,
  /telemetry[_-]?dispatch|telemetryDispatch/iu,
  /captcha.*bypass|bypass.*captcha/iu,
  /anti[_-]?bot.*bypass|bypass.*anti[_-]?bot/iu,
  /access[_-]?control.*bypass|bypass.*access[_-]?control/iu,
]);

const NON_GOAL_RUNTIME_HANDOFF_RUNTIME_TEXT_PATTERNS = Object.freeze([
  /\b(?:authorization|cookie|csrf|token|sessdata|session\s*id|browser\s*profile)\b/iu,
  /\b(?:session\s*view|download\s*policy|task\s*list|site\s*adapter|downloader|callback|handler|output\s*path|repo\s*path|repo\s*write|runtime\s*write|runtime\s*artifact|external\s*telemetry|external\s*dispatch|telemetry\s*dispatch)\b/iu,
  /\b(?:captcha|anti[-_\s]?bot|access[-_\s]?control)\b.*\b(?:bypass|evasion|evade|circumvent|solve|solver)\b/iu,
]);

const NON_GOAL_RUNTIME_HANDOFF_DISABLED_FLAG_KEY_SET = new Set(
  NON_GOAL_RUNTIME_HANDOFF_DISABLED_FLAG_KEYS.map((key) => String(key).toLowerCase()),
);

const NON_GOAL_LIVE_CONSUMER_ACCEPTANCE_DISABLED_FLAG_KEYS = Object.freeze([
  ...NON_GOAL_RUNTIME_HANDOFF_DISABLED_FLAG_KEYS,
  'liveConsumerEnabled',
  'runtimeProducerEnabled',
  'runtimeSubscriberEnabled',
  'docsWriteEnabled',
  'artifactWriteEnabled',
  'graphExecutionEnabled',
  'credentialOutputEnabled',
  'sessionOutputEnabled',
  'profileOutputEnabled',
  'bypassBehaviorEnabled',
  'statusPromotionEnabled',
  'statusPromotionAllowed',
  'verifiedPromotionEnabled',
  'verifiedPromotionAllowed',
  'livePromotionEnabled',
  'livePromotionAllowed',
]);

const NON_GOAL_LIVE_CONSUMER_ACCEPTANCE_DISABLED_FLAG_KEY_SET = new Set(
  NON_GOAL_LIVE_CONSUMER_ACCEPTANCE_DISABLED_FLAG_KEYS.map((key) => String(key).toLowerCase()),
);

const NON_GOAL_LIVE_CONSUMER_ACCEPTANCE_RUNTIME_KEY_PATTERNS = Object.freeze([
  ...NON_GOAL_RUNTIME_HANDOFF_RUNTIME_KEY_PATTERNS,
  /live[_-]?consumer/iu,
  /runtime[_-]?producer/iu,
  /runtime[_-]?subscriber/iu,
  /producer/iu,
  /subscriber/iu,
  /docs[_-]?write/iu,
  /artifact[_-]?write/iu,
  /graph[_-]?execution/iu,
  /credential[_-]?output/iu,
  /session[_-]?output/iu,
  /profile[_-]?output/iu,
  /status[_-]?promotion/iu,
  /verified[_-]?promotion/iu,
  /live[_-]?promotion|livePromotion/iu,
]);

const SITE_SEMANTICS_FORBIDDEN_OWNERS = new Set([
  'Kernel',
  'CapabilityService',
  'downloader',
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function pathToString(path = []) {
  return path.length ? path.join('.') : '$';
}

function isRedactedValue(value) {
  if (value === undefined || value === null || value === '') {
    return true;
  }
  if (typeof value === 'string') {
    return value === REDACTION_PLACEHOLDER || value === encodeURIComponent(REDACTION_PLACEHOLDER);
  }
  if (Array.isArray(value)) {
    return value.every(isRedactedValue);
  }
  if (isPlainObject(value)) {
    return Object.values(value).every(isRedactedValue);
  }
  return false;
}

function normalizeOwner(value) {
  const owner = String(value ?? '').trim();
  if (!owner) {
    throw new Error('NonGoalsBoundary owner is required');
  }
  if (!OWNER_SET.has(owner)) {
    throw new Error(`Unknown NonGoalsBoundary owner: ${owner}`);
  }
  return owner;
}

function normalizeArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function normalizeImportDescriptor(value, index) {
  if (typeof value === 'string') {
    return {
      specifier: value,
      imported: [],
      path: ['imports', String(index)],
    };
  }
  if (!isPlainObject(value)) {
    return {
      specifier: '',
      imported: [],
      path: ['imports', String(index)],
    };
  }
  const imported = normalizeArray(value.imported ?? value.imports ?? value.names)
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean);
  return {
    specifier: String(value.specifier ?? value.source ?? value.from ?? value.path ?? '').trim(),
    imported,
    path: ['imports', String(index)],
  };
}

function collectWalkFields(value, path = [], fields = []) {
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      collectWalkFields(child, [...path, String(index)], fields);
    }
    return fields;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = [...path, key];
      if (isPlainObject(child) || Array.isArray(child)) {
        fields.push({
          path: childPath,
          key,
          value: child,
        });
      }
      collectWalkFields(child, childPath, fields);
    }
    return fields;
  }
  fields.push({
    path,
    key: path[path.length - 1] ?? '<input>',
    value,
  });
  return fields;
}

function appendFinding(findings, owner, rule, path, pattern) {
  findings.push({
    owner,
    rule,
    path: pathToString(path),
    ...(pattern ? { pattern } : {}),
  });
}

function assertDisabledFlag(value, fieldName, label) {
  if (value !== undefined && value !== false) {
    throw new Error(`${label} ${fieldName} must remain false`);
  }
  return false;
}

/** @param {Record<string, any>} [value] */
function assertNoRuntimeBoundaryPayload(value = {}, label = 'NonGoalRuntimeBoundaryHandoffGuard') {
  const pending = [{ value, path: label }];
  while (pending.length) {
    const current = pending.pop();
    if (Array.isArray(current.value)) {
      current.value.forEach((item, index) => {
        pending.push({ value: item, path: `${current.path}.${index}` });
      });
      continue;
    }
    if (!current.value || typeof current.value !== 'object') {
      if (
        typeof current.value === 'string'
        // @ts-ignore
        && NON_GOAL_RUNTIME_HANDOFF_RUNTIME_TEXT_PATTERNS.some((pattern) => pattern.test(current.value))
      ) {
        throw new Error(`${label} must remain descriptor-only and must not include runtime material at ${current.path}`);
      }
      continue;
    }
    for (const [key, child] of Object.entries(current.value)) {
      if (NON_GOAL_RUNTIME_HANDOFF_DISABLED_FLAG_KEY_SET.has(String(key).toLowerCase())) {
        if (child !== false && child !== undefined) {
          throw new Error(`${label} ${key} must remain false`);
        }
        continue;
      }
      if (NON_GOAL_RUNTIME_HANDOFF_RUNTIME_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
        throw new Error(`${label} must remain descriptor-only and must not include runtime field: ${current.path}.${key}`);
      }
      pending.push({ value: child, path: `${current.path}.${key}` });
    }
  }
}

/** @param {Record<string, any>} [value] */
function assertNoForbiddenRuntimeBoundaryPatterns(value = {}) {
  const findings = scanForbiddenPatterns(value);
  if (findings.length > 0) {
    throw new Error('NonGoalRuntimeBoundaryHandoffGuard rejected forbidden sensitive pattern');
  }
}

/** @param {Record<string, any>} [value] */
function assertNonGoalRuntimeHandoffDisabledFlags(value = {}, label = 'NonGoalRuntimeBoundaryHandoffGuard') {
  for (const fieldName of NON_GOAL_RUNTIME_HANDOFF_DISABLED_FLAG_KEYS) {
    assertDisabledFlag(value[fieldName], fieldName, label);
  }
}

function assertNoLiveConsumerAcceptancePayload(
  value = {},
  label = 'NonGoalLiveConsumerAcceptanceGuard',
) {
  assertNoRuntimeBoundaryPayload(value, label);
  const pending = [{ value, path: label }];
  while (pending.length) {
    const current = pending.pop();
    if (Array.isArray(current.value)) {
      current.value.forEach((item, index) => {
        pending.push({ value: item, path: `${current.path}.${index}` });
      });
      continue;
    }
    if (!current.value || typeof current.value !== 'object') {
      continue;
    }
    for (const [key, child] of Object.entries(current.value)) {
      if (NON_GOAL_LIVE_CONSUMER_ACCEPTANCE_DISABLED_FLAG_KEY_SET.has(String(key).toLowerCase())) {
        if (child !== false && child !== undefined) {
          throw new Error(`${label} ${key} must remain false`);
        }
        continue;
      }
      if (NON_GOAL_LIVE_CONSUMER_ACCEPTANCE_RUNTIME_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
        throw new Error(`${label} must remain descriptor-only and must not include live consumer field: ${current.path}.${key}`);
      }
      pending.push({ value: child, path: `${current.path}.${key}` });
    }
  }
}

function assertNonGoalLiveConsumerAcceptanceDisabledFlags(
  value = {},
  label = 'NonGoalLiveConsumerAcceptanceGuard',
) {
  for (const fieldName of NON_GOAL_LIVE_CONSUMER_ACCEPTANCE_DISABLED_FLAG_KEYS) {
    assertDisabledFlag(value[fieldName], fieldName, label);
  }
}

/** @param {Record<string, any>} [boundary] */
function createSafeBoundarySummary(boundary = {}) {
  const result = assertNonGoalBoundary(boundary);
  return {
    schemaVersion: result.schemaVersion,
    owner: result.owner,
    allowed: result.allowed,
    findingCount: result.findings.length,
  };
}

function isRawSensitiveKey(key) {
  const normalized = String(key ?? '').trim();
  return isSensitiveFieldName(normalized)
    || RAW_SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function textHasRawSensitiveMaterial(text) {
  const value = String(text ?? '');
  return RAW_SENSITIVE_TEXT_PATTERNS.some((pattern) => pattern.test(value));
}

function textHasConcreteSiteSemantics(text) {
  const value = String(text ?? '');
  return GENERIC_SITE_SEMANTIC_TEXT_PATTERN.test(value)
    || (CONCRETE_SITE_NAME_PATTERN.test(value) && SITE_SEMANTIC_TEXT_PATTERN.test(value))
    || CONCRETE_SITE_IMPORT_PATTERN.test(value);
}

function keyValueIndicatesApiAutoPromotion(key, value) {
  const normalizedKey = String(key ?? '').trim();
  if (API_AUTO_PROMOTION_KEY_PATTERN.test(normalizedKey) && value === true) {
    return true;
  }
  return API_AUTO_PROMOTION_TEXT_PATTERN.test(normalizedKey)
    || (typeof value === 'string' && API_AUTO_PROMOTION_TEXT_PATTERN.test(value));
}

function keyIndicatesNonGoalBypass(key) {
  return NON_GOAL_BYPASS_KEY_PATTERN.test(String(key ?? '').trim());
}

function textIndicatesNonGoalBypass(text) {
  const value = String(text ?? '');
  if (NON_GOAL_BYPASS_ALLOWED_BLOCKED_TEXT_PATTERN.test(value)) {
    return false;
  }
  return (
    NON_GOAL_BYPASS_KEY_PATTERN.test(value)
    || (
      NON_GOAL_BYPASS_TARGET_PATTERN.test(value)
      && NON_GOAL_BYPASS_ACTION_PATTERN.test(value)
    )
  );
}

/** @param {Record<string, any>} options */
function scanFields({ owner, root, basePath, findings }) {
  for (const field of collectWalkFields(root, basePath)) {
    const value = field.value;
    if (isRawSensitiveKey(field.key) && !isRedactedValue(value)) {
      appendFinding(findings, owner, 'raw-sensitive-material', field.path, 'sensitive-field-name');
      continue;
    }

    if (typeof value === 'string' && textHasRawSensitiveMaterial(value) && !isRedactedValue(value)) {
      appendFinding(findings, owner, 'raw-sensitive-material', field.path, 'raw-sensitive-text');
    }

    if (
      SITE_SEMANTICS_FORBIDDEN_OWNERS.has(owner)
      && (textHasConcreteSiteSemantics(field.key) || textHasConcreteSiteSemantics(value))
    ) {
      appendFinding(findings, owner, 'concrete-site-semantics', field.path, 'site-semantics');
    }

    if (keyValueIndicatesApiAutoPromotion(field.key, value)) {
      appendFinding(findings, owner, 'api-auto-promotion', field.path, 'api-auto-promotion');
    }

    if (
      keyIndicatesNonGoalBypass(field.key)
      || (typeof value === 'string' && textIndicatesNonGoalBypass(value))
    ) {
      appendFinding(findings, owner, 'non-goal-bypass', field.path, 'non-goal-bypass');
    }
  }

  for (const finding of scanForbiddenPatterns(root)) {
    appendFinding(
      findings,
      owner,
      'raw-sensitive-material',
      [...basePath, ...String(finding.path ?? '').split('.').filter(Boolean)],
      finding.pattern ?? 'forbidden-sensitive-pattern',
    );
  }
}

/** @param {Record<string, any>} options */
function scanImports({ owner, imports, findings }) {
  for (const [index, rawImport] of normalizeArray(imports).entries()) {
    const entry = normalizeImportDescriptor(rawImport, index);
    if (!entry.specifier) {
      appendFinding(findings, owner, 'invalid-import-descriptor', entry.path, 'missing-specifier');
      continue;
    }

    if (
      SITE_SEMANTICS_FORBIDDEN_OWNERS.has(owner)
      && textHasConcreteSiteSemantics(entry.specifier)
    ) {
      appendFinding(findings, owner, 'concrete-site-semantics', [...entry.path, 'specifier'], 'site-import');
    }

    if (
      owner === 'downloader'
      && DOWNLOADER_RAW_SESSION_IMPORT_PATTERN.test(entry.specifier)
    ) {
      appendFinding(findings, owner, 'downloader-raw-session-read', [...entry.path, 'specifier'], 'raw-session-import');
    }

    for (const [nameIndex, importedName] of entry.imported.entries()) {
      const namePath = [...entry.path, 'imported', String(nameIndex)];
      if (owner === 'downloader' && DOWNLOADER_RAW_SESSION_IMPORT_NAME_PATTERN.test(importedName)) {
        appendFinding(findings, owner, 'downloader-raw-session-read', namePath, 'raw-session-import-name');
      }
      if (keyValueIndicatesApiAutoPromotion(importedName, importedName)) {
        appendFinding(findings, owner, 'api-auto-promotion', namePath, 'api-auto-promotion-import');
      }
      if (keyIndicatesNonGoalBypass(importedName) || textIndicatesNonGoalBypass(importedName)) {
        appendFinding(findings, owner, 'non-goal-bypass', namePath, 'non-goal-bypass-import');
      }
    }
  }
}

/** @param {Record<string, any>} [descriptor] */
export function scanNonGoalBoundary(descriptor = {}) {
  if (!isPlainObject(descriptor)) {
    throw new Error('NonGoalsBoundary descriptor must be an object');
  }
  const owner = normalizeOwner(descriptor.owner ?? descriptor.layer ?? descriptor.boundary);
  const findings = [];

  scanFields({
    owner,
    root: normalizeArray(descriptor.responsibility ?? descriptor.responsibilities),
    basePath: ['responsibilities'],
    findings,
  });
  scanFields({
    owner,
    root: descriptor.payload ?? {},
    basePath: ['payload'],
    findings,
  });
  scanImports({
    owner,
    imports: descriptor.imports ?? [],
    findings,
  });

  return {
    schemaVersion: NON_GOALS_BOUNDARY_SCHEMA_VERSION,
    owner,
    findings,
    allowed: findings.length === 0,
  };
}

/** @param {Record<string, any>} [descriptor] */
export function assertNonGoalBoundary(descriptor = {}) {
  const result = scanNonGoalBoundary(descriptor);
  if (!result.allowed) {
    /** @type {Error & Record<string, any>} */
    const error = new Error(
      `NonGoalsBoundary violation: ${result.findings.map((finding) => finding.rule).join(', ')}`,
    );
    error.code = 'non-goal-boundary-violation';
    error.owner = result.owner;
    error.findings = result.findings;
    throw error;
  }
  return result;
}

/** @param {Record<string, any>} [descriptor] */
export function assertNonGoalRuntimeBoundaryHandoffGuardCompatibility(descriptor = {}) {
  if (!isPlainObject(descriptor)) {
    throw new Error('NonGoalRuntimeBoundaryHandoffGuard descriptor must be an object');
  }
  assertNoRuntimeBoundaryPayload(descriptor);
  assertNoForbiddenRuntimeBoundaryPatterns(descriptor);
  if (descriptor.schemaVersion !== NON_GOALS_BOUNDARY_SCHEMA_VERSION) {
    throw new Error('NonGoalRuntimeBoundaryHandoffGuard schemaVersion is not compatible');
  }
  if (descriptor.queryName !== 'createNonGoalRuntimeBoundaryHandoffGuard') {
    throw new Error('NonGoalRuntimeBoundaryHandoffGuard queryName is not compatible');
  }
  if (descriptor.artifactFamily !== NON_GOAL_RUNTIME_BOUNDARY_HANDOFF_ARTIFACT_FAMILY) {
    throw new Error('NonGoalRuntimeBoundaryHandoffGuard artifactFamily is not compatible');
  }
  if (descriptor.redactionRequired !== true) {
    throw new Error('NonGoalRuntimeBoundaryHandoffGuard redactionRequired must be true');
  }
  if (!Array.isArray(descriptor.items) || descriptor.items.length !== 1) {
    throw new Error('NonGoalRuntimeBoundaryHandoffGuard requires exactly one item');
  }
  const item = descriptor.items[0];
  if (!isPlainObject(item)) {
    throw new Error('NonGoalRuntimeBoundaryHandoffGuard item must be an object');
  }
  if (item.schemaVersion !== NON_GOALS_BOUNDARY_SCHEMA_VERSION) {
    throw new Error('NonGoalRuntimeBoundaryHandoffGuard item schemaVersion is not compatible');
  }
  if (item.guardMode !== 'descriptor-only') {
    throw new Error('NonGoalRuntimeBoundaryHandoffGuard guardMode must be descriptor-only');
  }
  if (item.result !== 'blocked') {
    throw new Error('NonGoalRuntimeBoundaryHandoffGuard result must be blocked');
  }
  if (item.reasonCode !== NON_GOAL_RUNTIME_BOUNDARY_HANDOFF_REASON_CODE) {
    throw new Error('NonGoalRuntimeBoundaryHandoffGuard reasonCode is not compatible');
  }
  assertNonGoalRuntimeHandoffDisabledFlags(item);
  if (!isPlainObject(item.sourceBoundary)) {
    throw new Error('NonGoalRuntimeBoundaryHandoffGuard sourceBoundary is required');
  }
  if (item.sourceBoundary.allowed !== true) {
    throw new Error('NonGoalRuntimeBoundaryHandoffGuard sourceBoundary must be allowed');
  }
  if (item.requiredBoundaryGuard !== 'assertNonGoalBoundary') {
    throw new Error('NonGoalRuntimeBoundaryHandoffGuard requiredBoundaryGuard is not compatible');
  }
  if (item.requiredRuntimeGuard !== 'assertNonGoalRuntimeBoundaryHandoffGuardCompatibility') {
    throw new Error('NonGoalRuntimeBoundaryHandoffGuard requiredRuntimeGuard is not compatible');
  }
  if (item.requiredHandoffGuard !== 'assertNonGoalRuntimeBoundaryHandoffGuardCompatibility') {
    throw new Error('NonGoalRuntimeBoundaryHandoffGuard requiredHandoffGuard is not compatible');
  }
  return true;
}

/** @param {Record<string, any>} [sourcesOrOptions] */
// @ts-ignore
export function createNonGoalRuntimeBoundaryHandoffGuard(sourcesOrOptions = {}, maybeOptions) {
  const hasSourceShape = isPlainObject(sourcesOrOptions)
    && (
      Object.hasOwn(sourcesOrOptions, 'descriptor')
      || Object.hasOwn(sourcesOrOptions, 'boundary')
      || Object.hasOwn(sourcesOrOptions, 'boundaryResult')
      || Object.hasOwn(sourcesOrOptions, 'scanResult')
    );
  let sources;
  let options;
  if (maybeOptions === undefined && hasSourceShape) {
    const {
      descriptor,
      boundary,
      boundaryResult,
      scanResult,
      ...restOptions
    } = sourcesOrOptions;
    sources = {
      ...(descriptor === undefined ? {} : { descriptor }),
      ...(boundary === undefined ? {} : { boundary }),
      ...(boundaryResult === undefined ? {} : { boundaryResult }),
      ...(scanResult === undefined ? {} : { scanResult }),
    };
    options = restOptions;
  } else {
    sources = maybeOptions === undefined ? {} : sourcesOrOptions;
    options = maybeOptions === undefined ? sourcesOrOptions : maybeOptions ?? {};
  }
  if (!isPlainObject(sources)) {
    throw new Error('NonGoalRuntimeBoundaryHandoffGuard sources must be an object');
  }
  if (!isPlainObject(options)) {
    throw new Error('NonGoalRuntimeBoundaryHandoffGuard options must be an object');
  }
  assertNoRuntimeBoundaryPayload(options, 'NonGoalRuntimeBoundaryHandoffGuardOptions');
  assertNoForbiddenRuntimeBoundaryPatterns(options);
  assertNonGoalRuntimeHandoffDisabledFlags(options, 'NonGoalRuntimeBoundaryHandoffGuardOptions');
  const {
    descriptor,
    boundary = descriptor ?? {
      owner: 'CapabilityService',
      responsibilities: ['non-goals boundary runtime handoff remains descriptor-only and fail-closed'],
    },
    boundaryResult,
    scanResult,
  } = sources;
  const {
    handoffName,
    guardName = handoffName ?? 'site-capability-graph-non-goal-runtime-boundary-handoff-guard',
  } = options;
  const sourceBoundary = boundaryResult?.allowed === true
    ? {
      schemaVersion: boundaryResult.schemaVersion,
      owner: boundaryResult.owner,
      allowed: boundaryResult.allowed,
      findingCount: Array.isArray(boundaryResult.findings) ? boundaryResult.findings.length : 0,
    }
    : createSafeBoundarySummary(boundary);
  if (scanResult !== undefined) {
    if (!isPlainObject(scanResult) || scanResult.allowed !== true) {
      throw new Error('NonGoalRuntimeBoundaryHandoffGuard scanResult must be allowed');
    }
  }
  const disabledFlags = Object.fromEntries(
    NON_GOAL_RUNTIME_HANDOFF_DISABLED_FLAG_KEYS.map((fieldName) => [fieldName, false]),
  );
  const guardDescriptor = {
    schemaVersion: NON_GOALS_BOUNDARY_SCHEMA_VERSION,
    queryName: 'createNonGoalRuntimeBoundaryHandoffGuard',
    artifactFamily: NON_GOAL_RUNTIME_BOUNDARY_HANDOFF_ARTIFACT_FAMILY,
    redactionRequired: true,
    items: [{
      schemaVersion: NON_GOALS_BOUNDARY_SCHEMA_VERSION,
      guardName: String(guardName ?? '').trim()
        || NON_GOAL_RUNTIME_BOUNDARY_HANDOFF_ARTIFACT_FAMILY,
      guardMode: 'descriptor-only',
      result: 'blocked',
      reasonCode: NON_GOAL_RUNTIME_BOUNDARY_HANDOFF_REASON_CODE,
      reason: {
        code: NON_GOAL_RUNTIME_BOUNDARY_HANDOFF_REASON_CODE,
        message: 'Non-goal runtime handoff remains fail-closed and cannot enable runtime consumers, producers, subscribers, writes, execution, or materialization',
      },
      requiredBoundaryGuard: 'assertNonGoalBoundary',
      requiredRuntimeGuard: 'assertNonGoalRuntimeBoundaryHandoffGuardCompatibility',
      requiredHandoffGuard: 'assertNonGoalRuntimeBoundaryHandoffGuardCompatibility',
      sourceBoundary,
      rejectedRuntimeCategories: [
        'runtime-consumer',
        'producer-subscriber',
        'write-execution',
        'materialization',
        'runtime-adapter',
        'privilege-bypass',
        'sensitive-material',
      ],
      ...disabledFlags,
    }],
  };
  assertNonGoalRuntimeBoundaryHandoffGuardCompatibility(guardDescriptor);
  return guardDescriptor;
}

/** @param {Record<string, any>} [sourceHandoff] */
function createSafeNonGoalRuntimeHandoffSummary(sourceHandoff = {}) {
  assertNonGoalRuntimeBoundaryHandoffGuardCompatibility(sourceHandoff);
  const item = sourceHandoff.items[0];
  return {
    schemaVersion: sourceHandoff.schemaVersion,
    queryName: sourceHandoff.queryName,
    artifactFamily: sourceHandoff.artifactFamily,
    redactionRequired: sourceHandoff.redactionRequired,
    guardName: item.guardName,
    guardMode: item.guardMode,
    result: item.result,
    reasonCode: item.reasonCode,
    requiredBoundaryGuard: item.requiredBoundaryGuard,
    requiredRuntimeGuard: item.requiredRuntimeGuard,
    requiredHandoffGuard: item.requiredHandoffGuard,
    sourceBoundary: {
      schemaVersion: item.sourceBoundary.schemaVersion,
      owner: item.sourceBoundary.owner,
      allowed: item.sourceBoundary.allowed,
      findingCount: item.sourceBoundary.findingCount,
    },
    rejectedRuntimeCategories: [...item.rejectedRuntimeCategories],
  };
}

/** @param {Record<string, any>} [summary] */
function assertSafeNonGoalRuntimeHandoffSummary(summary = {}) {
  if (!isPlainObject(summary)) {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard sourceHandoff must be an object');
  }
  if (summary.queryName !== 'createNonGoalRuntimeBoundaryHandoffGuard') {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard sourceHandoff queryName is not compatible');
  }
  if (summary.artifactFamily !== NON_GOAL_RUNTIME_BOUNDARY_HANDOFF_ARTIFACT_FAMILY) {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard sourceHandoff artifactFamily is not compatible');
  }
  if (summary.redactionRequired !== true) {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard sourceHandoff redactionRequired must be true');
  }
  if (summary.guardMode !== 'descriptor-only') {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard sourceHandoff guardMode must be descriptor-only');
  }
  if (summary.result !== 'blocked') {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard sourceHandoff result must be blocked');
  }
  if (summary.reasonCode !== NON_GOAL_RUNTIME_BOUNDARY_HANDOFF_REASON_CODE) {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard sourceHandoff reasonCode is not compatible');
  }
  if (!isPlainObject(summary.sourceBoundary) || summary.sourceBoundary.allowed !== true) {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard sourceHandoff sourceBoundary must be allowed');
  }
}

/** @param {Record<string, any>} [descriptor] */
export function assertNonGoalLiveConsumerAcceptanceGuardCompatibility(descriptor = {}) {
  if (!isPlainObject(descriptor)) {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard descriptor must be an object');
  }
  assertNoLiveConsumerAcceptancePayload(descriptor);
  assertNoForbiddenRuntimeBoundaryPatterns(descriptor);
  if (descriptor.schemaVersion !== NON_GOALS_BOUNDARY_SCHEMA_VERSION) {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard schemaVersion is not compatible');
  }
  if (descriptor.queryName !== 'createNonGoalLiveConsumerAcceptanceGuard') {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard queryName is not compatible');
  }
  if (descriptor.artifactFamily !== NON_GOAL_LIVE_CONSUMER_ACCEPTANCE_ARTIFACT_FAMILY) {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard artifactFamily is not compatible');
  }
  if (descriptor.redactionRequired !== true) {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard redactionRequired must be true');
  }
  if (!Array.isArray(descriptor.items) || descriptor.items.length !== 1) {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard requires exactly one item');
  }
  const item = descriptor.items[0];
  if (!isPlainObject(item)) {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard item must be an object');
  }
  if (item.schemaVersion !== NON_GOALS_BOUNDARY_SCHEMA_VERSION) {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard item schemaVersion is not compatible');
  }
  if (item.guardMode !== 'descriptor-only') {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard guardMode must be descriptor-only');
  }
  if (item.result !== 'blocked') {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard result must be blocked');
  }
  if (item.reasonCode !== NON_GOAL_RUNTIME_BOUNDARY_HANDOFF_REASON_CODE) {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard reasonCode is not compatible');
  }
  assertNonGoalLiveConsumerAcceptanceDisabledFlags(item);
  if (item.requiredSourceHandoffGuard !== 'assertNonGoalRuntimeBoundaryHandoffGuardCompatibility') {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard requiredSourceHandoffGuard is not compatible');
  }
  if (item.requiredAcceptanceGuard !== 'assertNonGoalLiveConsumerAcceptanceGuardCompatibility') {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard requiredAcceptanceGuard is not compatible');
  }
  assertSafeNonGoalRuntimeHandoffSummary(item.sourceHandoff);
  if (!Array.isArray(item.rejectedPromotionCategories) || item.rejectedPromotionCategories.length === 0) {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard rejectedPromotionCategories are required');
  }
  return true;
}

/** @param {Record<string, any>} [sourceOrOptions] */
// @ts-ignore
export function createNonGoalLiveConsumerAcceptanceGuard(sourceOrOptions = {}, maybeOptions) {
  const hasSourceHandoff = isPlainObject(sourceOrOptions)
    && sourceOrOptions.queryName === 'createNonGoalRuntimeBoundaryHandoffGuard';
  const options = hasSourceHandoff ? maybeOptions ?? {} : sourceOrOptions;
  if (!isPlainObject(options)) {
    throw new Error('NonGoalLiveConsumerAcceptanceGuard options must be an object');
  }
  assertNoLiveConsumerAcceptancePayload(options, 'NonGoalLiveConsumerAcceptanceGuardOptions');
  assertNoForbiddenRuntimeBoundaryPatterns(options);
  assertNonGoalLiveConsumerAcceptanceDisabledFlags(
    options,
    'NonGoalLiveConsumerAcceptanceGuardOptions',
  );
  const sourceHandoff = hasSourceHandoff
    ? sourceOrOptions
    : options.sourceHandoff
      ?? options.runtimeBoundaryHandoff
      ?? createNonGoalRuntimeBoundaryHandoffGuard(options);
  assertNonGoalRuntimeBoundaryHandoffGuardCompatibility(sourceHandoff);
  const {
    guardName = NON_GOAL_LIVE_CONSUMER_ACCEPTANCE_ARTIFACT_FAMILY,
  } = options;
  const disabledFlags = Object.fromEntries(
    NON_GOAL_LIVE_CONSUMER_ACCEPTANCE_DISABLED_FLAG_KEYS.map((fieldName) => [fieldName, false]),
  );
  const descriptor = {
    schemaVersion: NON_GOALS_BOUNDARY_SCHEMA_VERSION,
    queryName: 'createNonGoalLiveConsumerAcceptanceGuard',
    artifactFamily: NON_GOAL_LIVE_CONSUMER_ACCEPTANCE_ARTIFACT_FAMILY,
    redactionRequired: true,
    items: [{
      schemaVersion: NON_GOALS_BOUNDARY_SCHEMA_VERSION,
      guardName: String(guardName ?? '').trim()
        || NON_GOAL_LIVE_CONSUMER_ACCEPTANCE_ARTIFACT_FAMILY,
      guardMode: 'descriptor-only',
      result: 'blocked',
      reasonCode: NON_GOAL_RUNTIME_BOUNDARY_HANDOFF_REASON_CODE,
      reason: {
        code: NON_GOAL_RUNTIME_BOUNDARY_HANDOFF_REASON_CODE,
        message: 'Non-goal live consumer acceptance remains fail-closed and cannot promote blocked manual-recovery descriptors into live consumers',
      },
      requiredSourceHandoffGuard: 'assertNonGoalRuntimeBoundaryHandoffGuardCompatibility',
      requiredAcceptanceGuard: 'assertNonGoalLiveConsumerAcceptanceGuardCompatibility',
      sourceHandoff: createSafeNonGoalRuntimeHandoffSummary(sourceHandoff),
      blockedDescriptorHandling: 'blocked-manual-recovery-remains-non-live',
      rejectedPromotionCategories: [
        'live-consumer',
        'runtime-producer',
        'runtime-subscriber',
        'external-telemetry',
        'write-path',
        'graph-execution',
        'runtime-adapter',
        'session-materialization',
        'credential-session-profile-output',
        'bypass-behavior',
        'status-promotion',
        'verified-promotion',
      ],
      ...disabledFlags,
    }],
  };
  assertNonGoalLiveConsumerAcceptanceGuardCompatibility(descriptor);
  return descriptor;
}

/** @param {Record<string, any>} [sourceAcceptance] */
function createSafeNonGoalLiveConsumerAcceptanceSummary(sourceAcceptance = {}) {
  assertNonGoalLiveConsumerAcceptanceGuardCompatibility(sourceAcceptance);
  const item = sourceAcceptance.items[0];
  return {
    schemaVersion: sourceAcceptance.schemaVersion,
    queryName: sourceAcceptance.queryName,
    artifactFamily: sourceAcceptance.artifactFamily,
    redactionRequired: sourceAcceptance.redactionRequired,
    guardName: item.guardName,
    guardMode: item.guardMode,
    result: item.result,
    reasonCode: item.reasonCode,
    requiredSourceHandoffGuard: item.requiredSourceHandoffGuard,
    requiredAcceptanceGuard: item.requiredAcceptanceGuard,
    sourceHandoff: {
      schemaVersion: item.sourceHandoff.schemaVersion,
      queryName: item.sourceHandoff.queryName,
      artifactFamily: item.sourceHandoff.artifactFamily,
      redactionRequired: item.sourceHandoff.redactionRequired,
      guardName: item.sourceHandoff.guardName,
      guardMode: item.sourceHandoff.guardMode,
      result: item.sourceHandoff.result,
      reasonCode: item.sourceHandoff.reasonCode,
      sourceBoundary: {
        schemaVersion: item.sourceHandoff.sourceBoundary.schemaVersion,
        owner: item.sourceHandoff.sourceBoundary.owner,
        allowed: item.sourceHandoff.sourceBoundary.allowed,
        findingCount: item.sourceHandoff.sourceBoundary.findingCount,
      },
    },
    blockedDescriptorHandling: item.blockedDescriptorHandling,
    rejectedPromotionCategories: [...item.rejectedPromotionCategories],
  };
}

/** @param {Record<string, any>} [summary] */
function assertSafeNonGoalLiveConsumerAcceptanceSummary(summary = {}) {
  if (!isPlainObject(summary)) {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate sourceAcceptance must be an object');
  }
  if (summary.queryName !== 'createNonGoalLiveConsumerAcceptanceGuard') {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate sourceAcceptance queryName is not compatible');
  }
  if (summary.artifactFamily !== NON_GOAL_LIVE_CONSUMER_ACCEPTANCE_ARTIFACT_FAMILY) {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate sourceAcceptance artifactFamily is not compatible');
  }
  if (summary.redactionRequired !== true) {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate sourceAcceptance redactionRequired must be true');
  }
  if (summary.guardMode !== 'descriptor-only') {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate sourceAcceptance guardMode must be descriptor-only');
  }
  if (summary.result !== 'blocked') {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate sourceAcceptance result must be blocked');
  }
  if (summary.reasonCode !== NON_GOAL_RUNTIME_BOUNDARY_HANDOFF_REASON_CODE) {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate sourceAcceptance reasonCode is not compatible');
  }
  if (summary.blockedDescriptorHandling !== 'blocked-manual-recovery-remains-non-live') {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate sourceAcceptance blocked descriptor handling is not compatible');
  }
  if (
    !Array.isArray(summary.rejectedPromotionCategories)
    || !summary.rejectedPromotionCategories.includes('live-consumer')
  ) {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate sourceAcceptance must reject live-consumer promotion');
  }
  assertSafeNonGoalRuntimeHandoffSummary(summary.sourceHandoff);
}

/** @param {Record<string, any>} [descriptor] */
export function assertNonGoalLiveConsumerCompatibilityReviewGateCompatibility(descriptor = {}) {
  if (!isPlainObject(descriptor)) {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate descriptor must be an object');
  }
  assertNoLiveConsumerAcceptancePayload(descriptor, 'NonGoalLiveConsumerCompatibilityReviewGate');
  assertNoForbiddenRuntimeBoundaryPatterns(descriptor);
  if (descriptor.schemaVersion !== NON_GOALS_BOUNDARY_SCHEMA_VERSION) {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate schemaVersion is not compatible');
  }
  if (descriptor.queryName !== 'createNonGoalLiveConsumerCompatibilityReviewGate') {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate queryName is not compatible');
  }
  if (descriptor.artifactFamily !== NON_GOAL_LIVE_CONSUMER_COMPATIBILITY_REVIEW_ARTIFACT_FAMILY) {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate artifactFamily is not compatible');
  }
  if (descriptor.redactionRequired !== true) {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate redactionRequired must be true');
  }
  if (!Array.isArray(descriptor.items) || descriptor.items.length !== 1) {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate requires exactly one item');
  }
  const item = descriptor.items[0];
  if (!isPlainObject(item)) {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate item must be an object');
  }
  if (item.schemaVersion !== NON_GOALS_BOUNDARY_SCHEMA_VERSION) {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate item schemaVersion is not compatible');
  }
  if (item.guardMode !== 'descriptor-only') {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate guardMode must be descriptor-only');
  }
  if (item.result !== 'blocked') {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate result must be blocked');
  }
  if (item.reasonCode !== NON_GOAL_RUNTIME_BOUNDARY_HANDOFF_REASON_CODE) {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate reasonCode is not compatible');
  }
  assertNonGoalLiveConsumerAcceptanceDisabledFlags(
    item,
    'NonGoalLiveConsumerCompatibilityReviewGate',
  );
  if (item.requiredAcceptanceGuard !== 'assertNonGoalLiveConsumerAcceptanceGuardCompatibility') {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate requiredAcceptanceGuard is not compatible');
  }
  if (item.requiredReviewGate !== 'assertNonGoalLiveConsumerCompatibilityReviewGateCompatibility') {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate requiredReviewGate is not compatible');
  }
  assertSafeNonGoalLiveConsumerAcceptanceSummary(item.sourceAcceptance);
  if (item.reviewMode !== 'compatibility-review') {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate reviewMode is not compatible');
  }
  if (item.blockedDescriptorCompatibility !== 'blocked-manual-recovery-cannot-promote') {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate blocked descriptor compatibility is not compatible');
  }
  if (!Array.isArray(item.reviewedDescriptorStates) || item.reviewedDescriptorStates.length !== 2) {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate reviewed descriptor states are required');
  }
  if (!item.reviewedDescriptorStates.includes('blocked') || !item.reviewedDescriptorStates.includes('manual-recovery')) {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate reviewed descriptor states are not compatible');
  }
  return true;
}

export function createNonGoalLiveConsumerCompatibilityReviewGate(
  sourceOrOptions = {},
  maybeOptions,
) {
  const hasSourceAcceptance = isPlainObject(sourceOrOptions)
    && sourceOrOptions.queryName === 'createNonGoalLiveConsumerAcceptanceGuard';
  const options = hasSourceAcceptance ? maybeOptions ?? {} : sourceOrOptions;
  if (!isPlainObject(options)) {
    throw new Error('NonGoalLiveConsumerCompatibilityReviewGate options must be an object');
  }
  assertNoLiveConsumerAcceptancePayload(options, 'NonGoalLiveConsumerCompatibilityReviewGateOptions');
  assertNoForbiddenRuntimeBoundaryPatterns(options);
  assertNonGoalLiveConsumerAcceptanceDisabledFlags(
    options,
    'NonGoalLiveConsumerCompatibilityReviewGateOptions',
  );
  const sourceAcceptance = hasSourceAcceptance
    ? sourceOrOptions
    : options.sourceAcceptance
      ?? options.acceptanceGuard
      ?? createNonGoalLiveConsumerAcceptanceGuard(options);
  assertNonGoalLiveConsumerAcceptanceGuardCompatibility(sourceAcceptance);
  const {
    guardName = NON_GOAL_LIVE_CONSUMER_COMPATIBILITY_REVIEW_ARTIFACT_FAMILY,
  } = options;
  const disabledFlags = Object.fromEntries(
    NON_GOAL_LIVE_CONSUMER_ACCEPTANCE_DISABLED_FLAG_KEYS.map((fieldName) => [fieldName, false]),
  );
  const descriptor = {
    schemaVersion: NON_GOALS_BOUNDARY_SCHEMA_VERSION,
    queryName: 'createNonGoalLiveConsumerCompatibilityReviewGate',
    artifactFamily: NON_GOAL_LIVE_CONSUMER_COMPATIBILITY_REVIEW_ARTIFACT_FAMILY,
    redactionRequired: true,
    items: [{
      schemaVersion: NON_GOALS_BOUNDARY_SCHEMA_VERSION,
      guardName: String(guardName ?? '').trim()
        || NON_GOAL_LIVE_CONSUMER_COMPATIBILITY_REVIEW_ARTIFACT_FAMILY,
      guardMode: 'descriptor-only',
      result: 'blocked',
      reasonCode: NON_GOAL_RUNTIME_BOUNDARY_HANDOFF_REASON_CODE,
      reason: {
        code: NON_GOAL_RUNTIME_BOUNDARY_HANDOFF_REASON_CODE,
        message: 'Non-goal compatibility review remains fail-closed for blocked and manual-recovery descriptors',
      },
      requiredAcceptanceGuard: 'assertNonGoalLiveConsumerAcceptanceGuardCompatibility',
      requiredReviewGate: 'assertNonGoalLiveConsumerCompatibilityReviewGateCompatibility',
      sourceAcceptance: createSafeNonGoalLiveConsumerAcceptanceSummary(sourceAcceptance),
      reviewMode: 'compatibility-review',
      blockedDescriptorCompatibility: 'blocked-manual-recovery-cannot-promote',
      reviewedDescriptorStates: [
        'blocked',
        'manual-recovery',
      ],
      ...disabledFlags,
    }],
  };
  assertNonGoalLiveConsumerCompatibilityReviewGateCompatibility(descriptor);
  return descriptor;
}
