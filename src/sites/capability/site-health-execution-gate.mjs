// @ts-check

import { normalizeLifecycleEvent } from './lifecycle-events.mjs';
import {
  RecoveryActionExecutor,
  getDefaultRecoveryPolicy,
} from './site-health-recovery.mjs';
import {
  assertNoForbiddenPatterns,
  redactValue,
} from './security-guard.mjs';

export const SITE_HEALTH_EXECUTION_GATE_SCHEMA_VERSION = 1;
export const SITE_HEALTH_REPORT_ARTIFACT_NAME = 'SITE_HEALTH_REPORT';
export const HEALTH_RECOVERY_AUDIT_ARTIFACT_NAME = 'HEALTH_RECOVERY_AUDIT';
export const HEALTH_RECOVERY_ROLLBACK_ARTIFACT_NAME = 'HEALTH_RECOVERY_ROLLBACK_PLAN';

const BLOCKING_ACTIONS = new Set([
  'safe-stop',
  'quarantine-site-profile',
  'require-user-action',
]);

const READONLY_ACTIONS = new Set([
  'switch-to-readonly-mode',
]);

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map(text).filter(Boolean))];
}

function safeValue(value = {}) {
  const redacted = redactValue(value);
  assertNoForbiddenPatterns(redacted.value);
  return redacted.value;
}

function normalizeCapability(value) {
  return text(value) ?? 'site.health';
}

function taskCapability(task = {}) {
  return normalizeCapability(task.capability ?? task.capabilityKey ?? task.affectedCapability);
}

function taskMode(task = {}) {
  const mode = text(task.mode ?? task.accessMode ?? task.operationMode);
  if (mode) {
    return mode;
  }
  return task.write === true || task.requiresWrite === true || /\bwrite\b/iu.test(String(taskCapability(task)))
    ? 'write'
    : 'read';
}

function findCapabilityHealth(report = {}, capability) {
  const entries = Array.isArray(report.capabilityHealth) ? report.capabilityHealth : [];
  return entries.find((entry) => entry.capability === capability)
    ?? entries.find((entry) => entry.capability === 'site.health')
    ?? null;
}

function recommendedActions(report = {}) {
  return uniqueStrings(report.recommendedActions);
}

export function createRecoveryPolicyRegistry(entries = {}) {
  const policies = new Map();
  const initialEntries = entries instanceof Map ? entries.entries() : Object.entries(entries);
  for (const [riskType, policy] of initialEntries) {
    policies.set(String(riskType), {
      ...getDefaultRecoveryPolicy(riskType),
      ...(policy ?? {}),
    });
  }
  return Object.freeze({
    get(riskType) {
      return policies.get(String(riskType)) ?? getDefaultRecoveryPolicy(riskType);
    },
    set(riskType, policy = {}) {
      const next = new Map(policies);
      next.set(String(riskType), {
        ...getDefaultRecoveryPolicy(riskType),
        ...policy,
      });
      return createRecoveryPolicyRegistry(next);
    },
    entries() {
      return [...policies.entries()].map(([riskType, policy]) => [riskType, { ...policy }]);
    },
  });
}

export function createCapabilityHealthStateCache({
  now = () => new Date(),
} = {}) {
  const records = new Map();
  function keyFor({ siteId, profileId, capability }) {
    return [
      text(siteId) ?? 'unknown-site',
      text(profileId) ?? 'default',
      normalizeCapability(capability),
    ].join('|');
  }
  return {
    set(entry = {}) {
      const ttlMs = Number(entry.ttlMs ?? entry.ttlSeconds * 1000);
      const observedAt = entry.observedAt ? new Date(entry.observedAt) : now();
      const expiresAt = Number.isFinite(ttlMs)
        ? new Date(observedAt.getTime() + ttlMs).toISOString()
        : text(entry.expiresAt);
      const quarantineUntil = text(entry.quarantineUntil);
      const effectiveExpiresAt = [expiresAt, quarantineUntil]
        .filter(Boolean)
        .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0];
      const record = safeValue({
        schemaVersion: SITE_HEALTH_EXECUTION_GATE_SCHEMA_VERSION,
        siteId: entry.siteId,
        profileId: entry.profileId,
        capability: normalizeCapability(entry.capability),
        status: text(entry.status) ?? 'unknown',
        reason: text(entry.reason),
        observedAt: observedAt.toISOString(),
        expiresAt: effectiveExpiresAt,
        quarantineUntil,
        healthRecovery: entry.healthRecovery,
      });
      records.set(keyFor(record), record);
      return record;
    },
    get(query = {}) {
      const record = records.get(keyFor(query));
      if (!record) {
        return undefined;
      }
      if (record.expiresAt && new Date(record.expiresAt).getTime() <= now().getTime()) {
        records.delete(keyFor(record));
        return undefined;
      }
      return { ...record };
    },
    list() {
      return [...records.values()].map((entry) => ({ ...entry }));
    },
  };
}

export function evaluateSiteHealthExecutionGate({
  healthRecovery,
  report = healthRecovery?.report ?? healthRecovery,
  task = {},
  cachedState = null,
} = {}) {
  const capability = taskCapability(task);
  const mode = taskMode(task);
  const actions = recommendedActions(report);
  const capabilityHealth = findCapabilityHealth(report, capability);
  const cachedBlocks = cachedState && ['disabled', 'blocked', 'quarantined'].includes(String(cachedState.status));
  const capabilityDisabled = ['disabled', 'blocked', 'quarantined'].includes(String(capabilityHealth?.status ?? ''))
    || cachedBlocks;
  const userActionRequired = actions.some((action) => BLOCKING_ACTIONS.has(action));
  const readonly = actions.some((action) => READONLY_ACTIONS.has(action));
  const blocksWrite = readonly && mode === 'write';
  const allowed = !capabilityDisabled && !userActionRequired && !blocksWrite;
  const blockedCapabilities = allowed
    ? []
    : uniqueStrings([
      capabilityDisabled || blocksWrite || userActionRequired ? capability : undefined,
      ...(Array.isArray(report?.affectedCapabilities) ? report.affectedCapabilities : []),
      ...((Array.isArray(report?.risks) ? report.risks : []).map((risk) => risk.affectedCapability)),
    ]);
  const decision = {
    schemaVersion: SITE_HEALTH_EXECUTION_GATE_SCHEMA_VERSION,
    allowed,
    mode: readonly ? 'readonly' : mode,
    capability,
    status: allowed ? (readonly ? 'readonly' : 'allowed') : 'blocked',
    reason: allowed
      ? undefined
      : (cachedState?.reason ?? (capabilityDisabled ? 'capability-disabled' : (blocksWrite ? 'readonly-mode' : 'health-risk-blocked'))),
    artifactWriteAllowed: allowed && !readonly,
    blockedCapabilities,
    recommendedActions: actions,
    capabilityState: capabilityHealth?.status ?? cachedState?.status ?? 'healthy',
    siteStatus: report?.status ?? 'unknown',
  };
  return safeValue(decision);
}

export function applySiteHealthExecutionGateToTaskList({
  healthRecovery,
  tasks = [],
} = {}) {
  return (Array.isArray(tasks) ? tasks : [tasks]).map((task) => ({
    ...task,
    healthGate: evaluateSiteHealthExecutionGate({
      healthRecovery,
      task,
    }),
  }));
}

function rollbackDescriptorsForAction(action, result = {}) {
  switch (action) {
    case 'switch-to-readonly-mode':
      return ['restore-previous-capability-mode'];
    case 'disable-risky-capability':
      return result.capability ? [`reenable-capability:${result.capability}`] : ['reenable-risky-capability'];
    case 'reduce-concurrency':
      return ['restore-previous-concurrency'];
    case 'apply-backoff':
      return ['clear-backoff-after-successful-health-probe'];
    case 'clear-site-cache':
      return ['rebuild-cache-from-fresh-safe-probe'];
    case 'rebuild-browser-context':
      return ['discard-rebuilt-context-if-health-probe-fails'];
    case 'refresh-session':
      return ['revoke-refreshed-session-view-on-failed-health-probe'];
    case 'refresh-csrf-token':
      return ['discard-refreshed-csrf-view-on-failed-health-probe'];
    case 'quarantine-site-profile':
      return ['manual-review-required-before-unquarantine'];
    case 'require-user-action':
    case 'safe-stop':
      return [];
    default:
      return [];
  }
}

export function createHealthRecoveryRollbackPlan({
  healthRecovery,
  siteId = healthRecovery?.report?.siteId,
  profileId = healthRecovery?.report?.profileId,
} = {}) {
  const actions = Array.isArray(healthRecovery?.recovery?.actions)
    ? healthRecovery.recovery.actions
    : [];
  const rollbackSteps = actions.flatMap((result) => (
    rollbackDescriptorsForAction(result.action, result).map((rollbackAction) => ({
      action: rollbackAction,
      sourceAction: result.action,
      status: 'descriptor-only',
      executableDispatchEnabled: false,
    }))
  ));
  return safeValue({
    schemaVersion: SITE_HEALTH_EXECUTION_GATE_SCHEMA_VERSION,
    artifactName: HEALTH_RECOVERY_ROLLBACK_ARTIFACT_NAME,
    siteId,
    profileId,
    rollbackSupported: rollbackSteps.length > 0,
    rollbackSteps,
  });
}

export class SafeRecoveryActionExecutor extends RecoveryActionExecutor {
  constructor(options = {}) {
    super(options);
  }

  async execute(action, context = {}) {
    switch (action) {
      case 'apply-backoff':
        return safeValue({ action, status: 'planned', backoffMs: context.backoffMs ?? 60_000 });
      case 'reduce-concurrency':
        return safeValue({ action, status: 'planned', concurrency: Math.max(1, Number(context.concurrency ?? 1)) });
      case 'switch-to-readonly-mode':
        return safeValue({ action, status: 'planned', mode: 'readonly' });
      case 'disable-risky-capability':
        return safeValue({
          action,
          status: 'planned',
          capability: context.risk?.affectedCapability ?? context.capability,
        });
      case 'quarantine-site-profile':
      case 'require-user-action':
      case 'safe-stop':
        return safeValue({ action, status: 'deferred', requiresUserAction: action !== 'safe-stop' });
      default:
        return await super.execute(action, context);
    }
  }
}

export function createSiteHealthRecoveryLifecycleEvents({
  healthRecovery,
  traceId,
  correlationId,
  taskId,
  siteKey,
  taskType = 'site-health',
  createdAt,
} = {}) {
  const report = healthRecovery?.report ?? {};
  const actions = recommendedActions(report);
  const base = {
    traceId,
    correlationId,
    taskId,
    siteKey: siteKey ?? report.siteId,
    taskType,
    createdAt,
  };
  const events = [
    normalizeLifecycleEvent({
      eventType: 'site.health.recovery.evaluated',
      ...base,
      details: safeValue({
        status: report.status,
        riskTypes: (report.risks ?? []).map((risk) => risk.type),
        affectedCapabilities: report.affectedCapabilities,
        recommendedActions: actions,
      }),
    }),
  ];
  for (const action of actions) {
    events.push(action === 'safe-stop'
      ? createSiteHealthRecoverySafeStopLifecycleEvent(base, action)
      : createSiteHealthRecoveryActionPlannedLifecycleEvent(base, action));
  }
  return events;
}

function createSiteHealthRecoveryActionPlannedLifecycleEvent(base, action) {
  return normalizeLifecycleEvent({
    eventType: 'site.health.recovery.action.planned',
    ...base,
    details: safeValue({
      action,
      descriptorOnly: true,
      executableDispatchEnabled: false,
    }),
  });
}

function createSiteHealthRecoverySafeStopLifecycleEvent(base, action) {
  return normalizeLifecycleEvent({
    eventType: 'site.health.recovery.safe_stop',
    ...base,
    details: safeValue({
      action,
      descriptorOnly: true,
      executableDispatchEnabled: false,
    }),
  });
}
