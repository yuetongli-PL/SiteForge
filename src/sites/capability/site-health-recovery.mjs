// @ts-check

import {
  normalizeLifecycleEvent,
} from './lifecycle-events.mjs';
import {
  REDACTION_PLACEHOLDER,
  assertNoForbiddenPatterns,
  redactValue,
} from './security-guard.mjs';

export const SITE_HEALTH_RECOVERY_SCHEMA_VERSION = 1;
export const SITE_HEALTH_RECOVERY_ARTIFACTS = Object.freeze({
  SITE_HEALTH_REPORT: 'SITE_HEALTH_REPORT',
  HEALTH_RECOVERY_AUDIT: 'HEALTH_RECOVERY_AUDIT',
});

export const HEALTH_RISK_TYPES = Object.freeze([
  'auth-expired',
  'session-stale',
  'cookie-invalid',
  'csrf-invalid',
  'login-required',
  'mfa-required',
  'captcha-required',
  'user-verification-required',
  'account-restricted',
  'rate-limited',
  'permission-denied',
  'geo-restricted',
  'adapter-drift',
  'network-instability',
  'browser-context-corrupted',
  'storage-cache-invalid',
  'capability-disabled',
  'platform-risk-detected',
  'unknown-health-risk',
]);

export const RECOVERY_ACTIONS = Object.freeze([
  'refresh-session',
  'refresh-csrf-token',
  'clear-site-cache',
  'rebuild-browser-context',
  'retry-health-probe',
  'reduce-concurrency',
  'apply-backoff',
  'switch-to-readonly-mode',
  'disable-risky-capability',
  'quarantine-site-profile',
  'require-user-action',
  'safe-stop',
]);

export const SITE_HEALTH_STATUSES = Object.freeze([
  'healthy',
  'degraded',
  'at-risk',
  'blocked',
  'unknown',
]);

const HEALTH_RISK_TYPE_SET = new Set(HEALTH_RISK_TYPES);
const RECOVERY_ACTION_SET = new Set(RECOVERY_ACTIONS);
const HEALTH_STATUS_SET = new Set(SITE_HEALTH_STATUSES);

const SEVERITY_RANK = Object.freeze({
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
});

const SIGNAL_ALIASES = Object.freeze({
  401: 'auth-expired',
  403: 'permission-denied',
  429: 'rate-limited',
  auth_expired: 'auth-expired',
  authExpired: 'auth-expired',
  session_invalid: 'session-stale',
  'session-invalid': 'session-stale',
  session_stale: 'session-stale',
  cookie_invalid: 'cookie-invalid',
  csrf_failed: 'csrf-invalid',
  csrf_invalid: 'csrf-invalid',
  login_required: 'login-required',
  captcha: 'captcha-required',
  captcha_required: 'captcha-required',
  mfa: 'mfa-required',
  mfa_required: 'mfa-required',
  verification_required: 'user-verification-required',
  account_locked: 'account-restricted',
  account_restricted: 'account-restricted',
  'rate-limit': 'rate-limited',
  'request-burst': 'rate-limited',
  rate_limit: 'rate-limited',
  rate_limited: 'rate-limited',
  permission_denied: 'permission-denied',
  geo_restricted: 'geo-restricted',
  adapter_drift: 'adapter-drift',
  network_failed: 'network-instability',
  network_instability: 'network-instability',
  browser_context_corrupted: 'browser-context-corrupted',
  'browser-fingerprint-risk': 'platform-risk-detected',
  'anti-crawl-verify': 'captcha-required',
  'self-profile-captcha': 'captcha-required',
  'anti-crawl-rate-limit': 'rate-limited',
  'anti-crawl-challenge': 'user-verification-required',
  storage_cache_invalid: 'storage-cache-invalid',
  capability_disabled: 'capability-disabled',
  platform_risk_detected: 'platform-risk-detected',
  profile_health_risk: 'platform-risk-detected',
  'profile-health-risk': 'platform-risk-detected',
});

const DEFAULT_SIGNAL_METADATA = Object.freeze({
  'profile-health-risk': Object.freeze({
    affectedCapability: 'profile.read',
    severity: 'high',
    autoRecoverable: false,
    requiresUserAction: true,
  }),
});

const DEFAULT_POLICY_BY_TYPE = Object.freeze({
  'auth-expired': Object.freeze({
    maxAttempts: 1,
    allowedActions: Object.freeze(['refresh-session', 'retry-health-probe']),
    stopConditions: Object.freeze(['captcha-required', 'mfa-required', 'account-restricted']),
    fallbackMode: 'readonly',
    requiresAuditLog: true,
  }),
  'session-stale': Object.freeze({
    maxAttempts: 1,
    allowedActions: Object.freeze(['refresh-session', 'retry-health-probe']),
    stopConditions: Object.freeze(['captcha-required', 'mfa-required', 'account-restricted']),
    fallbackMode: 'readonly',
    requiresAuditLog: true,
  }),
  'cookie-invalid': Object.freeze({
    maxAttempts: 1,
    allowedActions: Object.freeze(['refresh-session', 'retry-health-probe']),
    stopConditions: Object.freeze(['captcha-required', 'mfa-required', 'account-restricted']),
    fallbackMode: 'readonly',
    requiresAuditLog: true,
  }),
  'csrf-invalid': Object.freeze({
    maxAttempts: 1,
    allowedActions: Object.freeze(['refresh-csrf-token', 'retry-health-probe']),
    stopConditions: Object.freeze(['captcha-required', 'mfa-required', 'account-restricted']),
    fallbackMode: 'readonly',
    requiresAuditLog: true,
  }),
  'rate-limited': Object.freeze({
    maxAttempts: 2,
    allowedActions: Object.freeze(['apply-backoff', 'reduce-concurrency', 'switch-to-readonly-mode']),
    stopConditions: Object.freeze(['account-restricted', 'platform-risk-detected']),
    fallbackMode: 'readonly',
    requiresAuditLog: true,
  }),
  'network-instability': Object.freeze({
    maxAttempts: 2,
    allowedActions: Object.freeze(['apply-backoff', 'retry-health-probe']),
    stopConditions: Object.freeze(['unknown-health-risk']),
    fallbackMode: 'reduced',
    requiresAuditLog: true,
  }),
  'browser-context-corrupted': Object.freeze({
    maxAttempts: 1,
    allowedActions: Object.freeze(['rebuild-browser-context', 'retry-health-probe']),
    stopConditions: Object.freeze(['captcha-required', 'mfa-required', 'account-restricted']),
    fallbackMode: 'readonly',
    requiresAuditLog: true,
  }),
  'storage-cache-invalid': Object.freeze({
    maxAttempts: 1,
    allowedActions: Object.freeze(['clear-site-cache', 'retry-health-probe']),
    stopConditions: Object.freeze(['captcha-required', 'mfa-required', 'account-restricted']),
    fallbackMode: 'readonly',
    requiresAuditLog: true,
  }),
  'adapter-drift': Object.freeze({
    maxAttempts: 0,
    allowedActions: Object.freeze(['disable-risky-capability', 'retry-health-probe']),
    stopConditions: Object.freeze(['unknown-health-risk']),
    fallbackMode: 'reduced',
    requiresAuditLog: true,
  }),
  'capability-disabled': Object.freeze({
    maxAttempts: 0,
    allowedActions: Object.freeze(['disable-risky-capability']),
    stopConditions: Object.freeze([]),
    fallbackMode: 'reduced',
    requiresAuditLog: true,
  }),
  'captcha-required': Object.freeze({
    maxAttempts: 0,
    allowedActions: Object.freeze(['require-user-action', 'safe-stop']),
    stopConditions: Object.freeze(['captcha-required']),
    fallbackMode: 'disabled',
    requiresAuditLog: true,
  }),
  'mfa-required': Object.freeze({
    maxAttempts: 0,
    allowedActions: Object.freeze(['require-user-action', 'safe-stop']),
    stopConditions: Object.freeze(['mfa-required']),
    fallbackMode: 'disabled',
    requiresAuditLog: true,
  }),
  'user-verification-required': Object.freeze({
    maxAttempts: 0,
    allowedActions: Object.freeze(['require-user-action', 'safe-stop']),
    stopConditions: Object.freeze(['user-verification-required']),
    fallbackMode: 'disabled',
    requiresAuditLog: true,
  }),
  'account-restricted': Object.freeze({
    maxAttempts: 0,
    allowedActions: Object.freeze(['quarantine-site-profile', 'require-user-action', 'safe-stop']),
    stopConditions: Object.freeze(['account-restricted']),
    fallbackMode: 'quarantined',
    requiresAuditLog: true,
  }),
  'platform-risk-detected': Object.freeze({
    maxAttempts: 0,
    allowedActions: Object.freeze([
      'switch-to-readonly-mode',
      'quarantine-site-profile',
      'require-user-action',
      'safe-stop',
    ]),
    stopConditions: Object.freeze(['platform-risk-detected']),
    fallbackMode: 'quarantined',
    requiresAuditLog: true,
  }),
  'login-required': Object.freeze({
    maxAttempts: 0,
    allowedActions: Object.freeze(['require-user-action', 'safe-stop']),
    stopConditions: Object.freeze(['login-required']),
    fallbackMode: 'disabled',
    requiresAuditLog: true,
  }),
  'permission-denied': Object.freeze({
    maxAttempts: 0,
    allowedActions: Object.freeze(['require-user-action', 'safe-stop']),
    stopConditions: Object.freeze(['permission-denied']),
    fallbackMode: 'disabled',
    requiresAuditLog: true,
  }),
  'geo-restricted': Object.freeze({
    maxAttempts: 0,
    allowedActions: Object.freeze(['require-user-action', 'safe-stop']),
    stopConditions: Object.freeze(['geo-restricted']),
    fallbackMode: 'disabled',
    requiresAuditLog: true,
  }),
  'unknown-health-risk': Object.freeze({
    maxAttempts: 0,
    allowedActions: Object.freeze(['safe-stop']),
    stopConditions: Object.freeze(['unknown-health-risk']),
    fallbackMode: 'disabled',
    requiresAuditLog: true,
  }),
});

const FORBIDDEN_AUTOMATIC_ACTIONS = Object.freeze({
  'captcha-required': Object.freeze([
    'refresh-session',
    'refresh-csrf-token',
    'rebuild-browser-context',
    'retry-health-probe',
    'reduce-concurrency',
    'apply-backoff',
  ]),
  'mfa-required': Object.freeze([
    'refresh-session',
    'refresh-csrf-token',
    'rebuild-browser-context',
    'retry-health-probe',
  ]),
  'user-verification-required': Object.freeze([
    'refresh-session',
    'refresh-csrf-token',
    'rebuild-browser-context',
    'retry-health-probe',
  ]),
  'account-restricted': Object.freeze([
    'refresh-session',
    'refresh-csrf-token',
    'retry-health-probe',
    'reduce-concurrency',
    'apply-backoff',
  ]),
  'platform-risk-detected': Object.freeze([
    'refresh-session',
    'refresh-csrf-token',
    'rebuild-browser-context',
    'retry-health-probe',
    'reduce-concurrency',
    'apply-backoff',
  ]),
  'permission-denied': Object.freeze([
    'refresh-session',
    'refresh-csrf-token',
    'retry-health-probe',
  ]),
  'geo-restricted': Object.freeze([
    'refresh-session',
    'refresh-csrf-token',
    'retry-health-probe',
  ]),
});

const AUTO_RECOVERABLE_TYPES = new Set([
  'auth-expired',
  'session-stale',
  'cookie-invalid',
  'csrf-invalid',
  'rate-limited',
  'network-instability',
  'browser-context-corrupted',
  'storage-cache-invalid',
]);

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

function normalizeSeverity(value, fallback = 'medium') {
  const severity = text(value) ?? fallback;
  if (!Object.hasOwn(SEVERITY_RANK, severity)) {
    throw new Error(`Unsupported health risk severity: ${severity}`);
  }
  return severity;
}

function normalizeRiskType(value) {
  const raw = text(value);
  const normalized = raw ? (SIGNAL_ALIASES[raw] ?? raw) : 'unknown-health-risk';
  if (!HEALTH_RISK_TYPE_SET.has(normalized)) {
    return 'unknown-health-risk';
  }
  return normalized;
}

function normalizeAction(action) {
  const normalized = text(action);
  if (!normalized || !RECOVERY_ACTION_SET.has(normalized)) {
    throw new Error(`Unsupported recovery action: ${normalized ?? '<empty>'}`);
  }
  return normalized;
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map(text).filter(Boolean))];
}

function safeMetadata(metadata = {}) {
  const { value } = redactValue(metadata);
  assertNoForbiddenPatterns(value);
  return value;
}

function rawSignalName(rawSignal = {}) {
  if (typeof rawSignal === 'string' || typeof rawSignal === 'number') {
    return String(rawSignal);
  }
  return text(rawSignal.rawSignal)
    ?? text(rawSignal.signal)
    ?? text(rawSignal.reasonCode)
    ?? text(rawSignal.code)
    ?? 'unknown-health-risk';
}

function signalMapEntry(signalMap, rawSignal) {
  if (!signalMap) {
    return undefined;
  }
  const key = rawSignalName(rawSignal);
  if (signalMap instanceof Map) {
    return signalMap.get(key);
  }
  if (typeof signalMap === 'object') {
    return signalMap[key];
  }
  return undefined;
}

function normalizePolicy(raw = {}, riskType) {
  const fallback = DEFAULT_POLICY_BY_TYPE[riskType] ?? DEFAULT_POLICY_BY_TYPE['unknown-health-risk'];
  const allowedActions = raw.allowedActions === undefined
    ? [...fallback.allowedActions]
    : uniqueStrings(raw.allowedActions).map(normalizeAction);
  const stopConditions = raw.stopConditions === undefined
    ? [...fallback.stopConditions]
    : uniqueStrings(raw.stopConditions).map(normalizeRiskType);
  const fallbackMode = text(raw.fallbackMode) ?? fallback.fallbackMode;
  if (!['readonly', 'reduced', 'disabled', 'quarantined'].includes(fallbackMode)) {
    throw new Error(`Unsupported recovery fallbackMode: ${fallbackMode}`);
  }
  return {
    riskType,
    maxAttempts: Number.isInteger(raw.maxAttempts) ? raw.maxAttempts : fallback.maxAttempts,
    allowedActions,
    stopConditions,
    fallbackMode,
    requiresAuditLog: raw.requiresAuditLog === undefined
      ? Boolean(fallback.requiresAuditLog)
      : Boolean(raw.requiresAuditLog),
  };
}

function riskBlocksAutomaticRecovery(risk) {
  return risk.requiresUserAction
    || risk.type === 'captcha-required'
    || risk.type === 'mfa-required'
    || risk.type === 'user-verification-required'
    || risk.type === 'account-restricted'
    || risk.type === 'platform-risk-detected'
    || risk.type === 'permission-denied'
    || risk.type === 'geo-restricted'
    || risk.type === 'unknown-health-risk'
    || risk.type === 'login-required';
}

export function getDefaultRecoveryPolicy(riskType) {
  return normalizePolicy({}, normalizeRiskType(riskType));
}

export class RecoveryPolicyRegistry {
  constructor(entries = {}) {
    this.policies = new Map();
    const initialEntries = entries instanceof Map ? entries.entries() : Object.entries(entries);
    for (const [riskType, policy] of initialEntries) {
      this.register(riskType, policy);
    }
  }

  register(riskType, policy = {}) {
    this.policies.set(String(riskType), {
      ...getDefaultRecoveryPolicy(riskType),
      ...policy,
    });
    return this;
  }

  get(riskType) {
    return this.policies.get(String(riskType)) ?? getDefaultRecoveryPolicy(riskType);
  }
}

export function normalizeHealthRisk(raw = {}, {
  siteId,
  signalMap,
  defaultAffectedCapability,
} = {}) {
  const rawSignal = rawSignalName(raw);
  const mapped = signalMapEntry(signalMap, raw) ?? {};
  const mappedType = typeof mapped === 'string' ? mapped : mapped.type;
  const type = normalizeRiskType(raw.type ?? raw.normalizedRisk ?? mappedType ?? rawSignal);
  const defaults = DEFAULT_SIGNAL_METADATA[rawSignal] ?? {};
  const redactedRawSignal = safeMetadata({ rawSignal }).rawSignal;
  const severity = normalizeSeverity(raw.severity ?? mapped.severity ?? defaults.severity, 'medium');
  const affectedCapability = text(
    raw.affectedCapability
      ?? mapped.affectedCapability
      ?? defaults.affectedCapability
      ?? defaultAffectedCapability,
  );
  const autoRecoverable = raw.autoRecoverable === undefined
    ? (mapped.autoRecoverable ?? defaults.autoRecoverable ?? AUTO_RECOVERABLE_TYPES.has(type))
    : Boolean(raw.autoRecoverable);
  const requiresUserAction = raw.requiresUserAction === undefined
    ? Boolean(
      mapped.requiresUserAction
        ?? defaults.requiresUserAction
        ?? !AUTO_RECOVERABLE_TYPES.has(type)
        ?? riskBlocksAutomaticRecovery({ type }),
    )
    : Boolean(raw.requiresUserAction);
  const prohibitedAutoActions = uniqueStrings([
    ...(FORBIDDEN_AUTOMATIC_ACTIONS[type] ?? []),
    ...(raw.prohibitedAutoActions ?? []),
    ...(mapped.prohibitedAutoActions ?? []),
  ]).map(normalizeAction);

  const normalized = {
    siteId: text(raw.siteId ?? mapped.siteId ?? siteId) ?? 'unknown-site',
    rawSignal: redactedRawSignal,
    type,
    severity,
    affectedCapability,
    autoRecoverable: Boolean(autoRecoverable) && !requiresUserAction && !riskBlocksAutomaticRecovery({
      type,
      requiresUserAction,
    }),
    requiresUserAction,
    prohibitedAutoActions,
    metadata: safeMetadata({
      ...(typeof mapped === 'object' ? mapped.metadata : {}),
      ...(raw.metadata ?? {}),
    }),
  };
  assertNoForbiddenPatterns(normalized);
  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== undefined));
}

export function normalizeHealthSignal(rawSignal, options = {}) {
  return normalizeHealthRisk(rawSignal, options);
}

export function createHealthSignalNormalizer({
  siteId,
  signalMap,
  defaultAffectedCapability,
} = {}) {
  return Object.freeze({
    normalize(rawSignal) {
      return normalizeHealthRisk(rawSignal, {
        siteId,
        signalMap,
        defaultAffectedCapability,
      });
    },
  });
}

export function normalizeHealthSignals(rawSignals = [], options = {}) {
  return (Array.isArray(rawSignals) ? rawSignals : [rawSignals])
    .map((rawSignal) => normalizeHealthSignal(rawSignal, options));
}

function sortRisksBySeverity(risks = []) {
  return [...risks].sort((left, right) => SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity]);
}

function policyForRisk(risk, { adapter, policyRegistry } = {}) {
  const adapterPolicy = typeof adapter?.getRecoveryPolicy === 'function'
    ? adapter.getRecoveryPolicy(risk)
    : undefined;
  const registeredPolicy = typeof policyRegistry?.get === 'function'
    ? policyRegistry.get(risk.type)
    : policyRegistry instanceof Map
    ? policyRegistry.get(risk.type)
    : policyRegistry?.[risk.type];
  return normalizePolicy({
    ...(registeredPolicy ?? {}),
    ...(adapterPolicy ?? {}),
  }, risk.type);
}

function actionsForRisk(risk, policy) {
  const prohibited = new Set(risk.prohibitedAutoActions ?? []);
  const actions = policy.allowedActions.filter((action) => !prohibited.has(action));
  if (!risk.autoRecoverable || risk.requiresUserAction) {
    return actions.filter((action) => [
      'switch-to-readonly-mode',
      'disable-risky-capability',
      'quarantine-site-profile',
      'require-user-action',
      'safe-stop',
    ].includes(action));
  }
  return actions;
}

function statusForRisks(risks = [], capabilityHealth = []) {
  if (!risks.length) {
    return 'healthy';
  }
  if (risks.some((risk) => risk.type === 'unknown-health-risk' || risk.severity === 'critical')) {
    return 'blocked';
  }
  const healthyCapabilities = capabilityHealth.filter((entry) => entry.status === 'healthy').length;
  if (healthyCapabilities > 0 && capabilityHealth.some((entry) => entry.status !== 'healthy')) {
    return 'degraded';
  }
  if (risks.some((risk) => [
    'captcha-required',
    'mfa-required',
    'user-verification-required',
    'account-restricted',
    'permission-denied',
    'geo-restricted',
  ].includes(risk.type))) {
    return 'blocked';
  }
  return 'at-risk';
}

export function createCapabilityHealthRegistry({
  capabilities = [],
  risks = [],
} = {}) {
  const capabilitySet = new Set(uniqueStrings(capabilities));
  for (const risk of risks) {
    if (risk.affectedCapability) {
      capabilitySet.add(risk.affectedCapability);
    }
  }
  const sortedCapabilities = [...capabilitySet].sort();
  return sortedCapabilities.map((capability) => {
    const capabilityRisks = risks.filter((risk) => risk.affectedCapability === capability);
    if (!capabilityRisks.length) {
      return {
        capability,
        status: 'healthy',
        risks: [],
        actions: [],
      };
    }
    const highRisk = capabilityRisks.some((risk) => [
      'captcha-required',
      'mfa-required',
      'user-verification-required',
      'account-restricted',
      'permission-denied',
      'geo-restricted',
      'adapter-drift',
      'platform-risk-detected',
      'unknown-health-risk',
      'capability-disabled',
    ].includes(risk.type));
    return {
      capability,
      status: highRisk ? 'disabled' : 'degraded',
      risks: capabilityRisks.map((risk) => risk.type),
      actions: uniqueStrings(capabilityRisks.flatMap((risk) => {
        const policy = getDefaultRecoveryPolicy(risk.type);
        return actionsForRisk(risk, policy);
      })),
    };
  });
}

export function createSiteHealthReport({
  siteId,
  profileId,
  risks = [],
  capabilities = [],
  recommendedActions = [],
  status,
} = {}) {
  const normalizedRisks = risks.map((risk) => normalizeHealthRisk(risk, { siteId }));
  const capabilityHealth = createCapabilityHealthRegistry({
    capabilities,
    risks: normalizedRisks,
  });
  const affectedCapabilities = uniqueStrings(normalizedRisks.map((risk) => risk.affectedCapability));
  const resolvedStatus = status ?? statusForRisks(normalizedRisks, capabilityHealth);
  if (!HEALTH_STATUS_SET.has(resolvedStatus)) {
    throw new Error(`Unsupported site health status: ${resolvedStatus}`);
  }
  const report = {
    schemaVersion: SITE_HEALTH_RECOVERY_SCHEMA_VERSION,
    siteId: text(siteId) ?? 'unknown-site',
    profileId: text(profileId),
    status: resolvedStatus,
    risks: sortRisksBySeverity(normalizedRisks),
    affectedCapabilities,
    capabilityHealth,
    recommendedActions: uniqueStrings(recommendedActions).map(normalizeAction),
  };
  assertNoForbiddenPatterns(report);
  return Object.fromEntries(Object.entries(report).filter(([, value]) => value !== undefined));
}

function createAuditLogEntry({
  siteId,
  risk,
  policy,
  actions,
  result,
} = {}) {
  const entry = {
    schemaVersion: SITE_HEALTH_RECOVERY_SCHEMA_VERSION,
    event: 'site-health-recovery.evaluated',
    siteId,
    rawSignal: risk.rawSignal,
    riskType: risk.type,
    affectedCapability: risk.affectedCapability,
    autoRecoverable: risk.autoRecoverable,
    requiresUserAction: risk.requiresUserAction,
    allowedActions: actions,
    fallbackMode: policy.fallbackMode,
    result,
  };
  assertNoForbiddenPatterns(entry);
  return entry;
}

function defaultActionResult(action, risk) {
  return {
    action,
    riskType: risk.type,
    status: ['require-user-action', 'safe-stop', 'quarantine-site-profile'].includes(action)
      ? 'deferred'
      : 'planned',
  };
}

function auditResultForRisk({ risk, actions = [] } = {}) {
  const blockingActions = new Set([
    'quarantine-site-profile',
    'require-user-action',
    'safe-stop',
  ]);
  if (!risk?.autoRecoverable || actions.some((action) => blockingActions.has(action))) {
    return 'manual-or-safe-stop';
  }
  return 'recovery-planned';
}

export class RecoveryActionExecutor {
  constructor({ handlers = {} } = {}) {
    this.handlers = handlers;
  }

  async execute(action, context = {}) {
    normalizeAction(action);
    const handler = this.handlers[action];
    if (typeof handler === 'function') {
      const result = await handler(context);
      const redacted = redactValue(result ?? {});
      assertNoForbiddenPatterns(redacted.value);
      return {
        action,
        ...redacted.value,
      };
    }
    return defaultActionResult(action, context.risk ?? {});
  }
}

export class SiteHealthRecoveryEngine {
  constructor({
    policyRegistry,
    actionExecutor = new RecoveryActionExecutor(),
    healthProbe,
  } = {}) {
    this.policyRegistry = policyRegistry;
    this.actionExecutor = actionExecutor;
    this.healthProbe = healthProbe;
  }

  async recover({
    siteId,
    profileId,
    rawSignals = [],
    risks,
    capabilities = [],
    adapter,
    signalMap,
  } = {}) {
    const normalizedRisks = risks
      ? risks.map((risk) => normalizeHealthRisk(risk, { siteId, signalMap }))
      : (Array.isArray(rawSignals) ? rawSignals : [rawSignals]).map((rawSignal) => (
        adapter
          ? normalizeSiteAdapterHealthSignal(adapter, rawSignal, { siteId, signalMap })
          : normalizeHealthSignal(rawSignal, { siteId, signalMap })
      ));
    const actionResults = [];
    const auditLog = [];
    const recommendedActions = [];

    for (const risk of sortRisksBySeverity(normalizedRisks)) {
      const policy = policyForRisk(risk, {
        adapter,
        policyRegistry: this.policyRegistry,
      });
      const actions = actionsForRisk(risk, policy);
      recommendedActions.push(...actions);
      for (const action of actions) {
        const result = await this.actionExecutor.execute(action, {
          siteId,
          profileId,
          risk,
          policy,
        });
        actionResults.push(result);
      }
      auditLog.push(createAuditLogEntry({
        siteId,
        risk,
        policy,
        actions,
        result: auditResultForRisk({ risk, actions }),
      }));
    }

    const probeResult = typeof this.healthProbe === 'function'
      ? await this.healthProbe({
        siteId,
        profileId,
        risks: normalizedRisks,
        actionResults,
      })
      : undefined;
    const report = createSiteHealthReport({
      siteId,
      profileId,
      risks: normalizedRisks,
      capabilities,
      recommendedActions,
      status: probeResult?.status,
    });
    return {
      schemaVersion: SITE_HEALTH_RECOVERY_SCHEMA_VERSION,
      report,
      recovery: {
        actions: actionResults,
        auditLog,
        probe: probeResult ? safeMetadata(probeResult) : undefined,
      },
    };
  }
}

export function createUserRecoveryInstructions(report = {}) {
  const risks = Array.isArray(report.risks) ? report.risks : [];
  const instructions = risks
    .filter((risk) => risk.requiresUserAction)
    .map((risk) => ({
      riskType: risk.type,
      affectedCapability: risk.affectedCapability,
      instruction: [
        'pause automation',
        risk.type === 'captcha-required' ? 'complete captcha manually in the official site if appropriate' : undefined,
        risk.type === 'mfa-required' ? 'complete MFA manually in the official site if appropriate' : undefined,
        risk.type === 'account-restricted' ? 'review account status in the official site' : undefined,
        risk.type === 'platform-risk-detected' ? 'keep the site profile quarantined until manually reviewed' : undefined,
      ].filter(Boolean),
    }));
  assertNoForbiddenPatterns(instructions);
  return instructions;
}

export function createSiteHealthRecoveryLifecycleEvent({
  siteId,
  taskDescriptor = {},
  adapterDescriptor = {},
  healthRecovery = {},
} = {}) {
  const report = healthRecovery.report ?? {};
  const risks = Array.isArray(report.risks) ? report.risks : [];
  const auditLog = Array.isArray(healthRecovery.recovery?.auditLog) ? healthRecovery.recovery.auditLog : [];
  const event = normalizeLifecycleEvent({
    eventType: 'site.health.recovery.evaluated',
    traceId: taskDescriptor.traceId,
    correlationId: taskDescriptor.correlationId,
    taskId: taskDescriptor.taskId,
    siteKey: siteId ?? report.siteId,
    taskType: taskDescriptor.taskType ?? 'site-health-recovery',
    adapterVersion: adapterDescriptor.adapterVersion,
    details: {
      artifacts: [
        SITE_HEALTH_RECOVERY_ARTIFACTS.SITE_HEALTH_REPORT,
        SITE_HEALTH_RECOVERY_ARTIFACTS.HEALTH_RECOVERY_AUDIT,
      ],
      recoveryDescriptor: {
        status: report.status ?? 'unknown',
        riskTypes: risks.map((risk) => risk.type).filter(Boolean),
        affectedCapabilities: risks.map((risk) => risk.affectedCapability).filter(Boolean),
        recommendedActions: Array.isArray(report.recommendedActions) ? report.recommendedActions : [],
        fallbackModes: [...new Set(auditLog.map((entry) => entry.fallbackMode).filter(Boolean))],
      },
    },
  });
  const { value } = redactValue(event);
  assertNoForbiddenPatterns(value);
  return value;
}

export function normalizeSiteAdapterHealthSignal(adapter, rawSignal, options = {}) {
  if (typeof adapter?.normalizeHealthSignal === 'function') {
    const normalized = adapter.normalizeHealthSignal(rawSignal, options);
    return normalizeHealthRisk(normalized, {
      siteId: options.siteId ?? normalized.siteId ?? adapter.id,
    });
  }
  return normalizeHealthSignal(rawSignal, options);
}

export { REDACTION_PLACEHOLDER };
