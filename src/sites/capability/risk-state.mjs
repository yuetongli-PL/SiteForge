// @ts-check

import {
  CATALOG_ACTIONS,
  normalizeReasonCode,
  reasonCodeSummary,
  requireReasonCodeDefinition,
} from './reason-codes.mjs';

export const RISK_STATE_SCHEMA_VERSION = 1;
export const RISK_STATE_TRANSITION_TABLE_SCHEMA_VERSION = 3;

export const RISK_STATES = Object.freeze([
  'normal',
  'suspicious',
  'rate_limited',
  'captcha_required',
  'auth_expired',
  'permission_denied',
  'cooldown',
  'isolated',
  'manual_recovery_required',
  'blocked',
]);

const RISK_STATE_DEFAULTS = Object.freeze({
  normal: Object.freeze({
    retryable: false,
    cooldownNeeded: false,
    isolationNeeded: false,
    manualRecoveryNeeded: false,
    degradable: false,
    artifactWriteAllowed: true,
    catalogAction: 'none',
  }),
  suspicious: Object.freeze({
    retryable: true,
    cooldownNeeded: true,
    isolationNeeded: false,
    manualRecoveryNeeded: false,
    degradable: true,
    artifactWriteAllowed: true,
    catalogAction: 'none',
  }),
  rate_limited: Object.freeze({
    retryable: true,
    cooldownNeeded: true,
    isolationNeeded: false,
    manualRecoveryNeeded: false,
    degradable: true,
    artifactWriteAllowed: true,
    catalogAction: 'none',
  }),
  captcha_required: Object.freeze({
    retryable: false,
    cooldownNeeded: true,
    isolationNeeded: true,
    manualRecoveryNeeded: true,
    degradable: true,
    artifactWriteAllowed: true,
    catalogAction: 'none',
  }),
  auth_expired: Object.freeze({
    retryable: true,
    cooldownNeeded: false,
    isolationNeeded: false,
    manualRecoveryNeeded: true,
    degradable: false,
    artifactWriteAllowed: true,
    catalogAction: 'none',
  }),
  permission_denied: Object.freeze({
    retryable: false,
    cooldownNeeded: false,
    isolationNeeded: false,
    manualRecoveryNeeded: true,
    degradable: false,
    artifactWriteAllowed: true,
    catalogAction: 'none',
  }),
  cooldown: Object.freeze({
    retryable: true,
    cooldownNeeded: true,
    isolationNeeded: false,
    manualRecoveryNeeded: false,
    degradable: true,
    artifactWriteAllowed: true,
    catalogAction: 'none',
  }),
  isolated: Object.freeze({
    retryable: false,
    cooldownNeeded: true,
    isolationNeeded: true,
    manualRecoveryNeeded: true,
    degradable: false,
    artifactWriteAllowed: true,
    catalogAction: 'none',
  }),
  manual_recovery_required: Object.freeze({
    retryable: false,
    cooldownNeeded: false,
    isolationNeeded: false,
    manualRecoveryNeeded: true,
    degradable: false,
    artifactWriteAllowed: true,
    catalogAction: 'none',
  }),
  blocked: Object.freeze({
    retryable: false,
    cooldownNeeded: false,
    isolationNeeded: true,
    manualRecoveryNeeded: true,
    degradable: false,
    artifactWriteAllowed: false,
    catalogAction: 'block',
  }),
});

const RISK_STATE_RECOVERY_KEYS = Object.freeze([
  'retryable',
  'cooldownNeeded',
  'isolationNeeded',
  'manualRecoveryNeeded',
  'degradable',
  'artifactWriteAllowed',
  'catalogAction',
  'discardCatalog',
]);

const RISK_STATE_REASON_TRANSITION_RULES = Object.freeze([
  Object.freeze({ reasonCode: 'redaction-failed', state: 'blocked' }),
  Object.freeze({ reasonCode: 'lifecycle-artifact-write-failed', state: 'suspicious' }),
  Object.freeze({ reasonCode: 'api-catalog-write-failed', state: 'manual_recovery_required' }),
  Object.freeze({ reasonCode: 'api-catalog-entry-blocked', state: 'blocked' }),
  Object.freeze({ reasonCode: 'session-invalid', state: 'auth_expired' }),
  Object.freeze({ reasonCode: 'session-revocation-invalid', state: 'manual_recovery_required' }),
]);

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function normalizeState(value, fieldName = 'state') {
  const state = normalizeText(value) ?? 'normal';
  if (!RISK_STATES.includes(state)) {
    throw new Error(`Unsupported RiskState ${fieldName}: ${state}`);
  }
  return state;
}

function normalizeCatalogAction(value, fallback) {
  const action = normalizeText(value) ?? fallback;
  if (!CATALOG_ACTIONS.includes(action)) {
    throw new Error(`Unsupported RiskState catalogAction: ${action}`);
  }
  return action;
}

function normalizeTimestamp(value) {
  const timestamp = normalizeText(value);
  if (!timestamp) {
    return undefined;
  }
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    throw new Error(`RiskState observedAt must be an ISO-compatible timestamp: ${timestamp}`);
  }
  return new Date(parsed).toISOString();
}

function normalizeReasonSummary(reasonCode) {
  const normalized = normalizeReasonCode(reasonCode);
  if (!normalized) {
    return undefined;
  }
  requireReasonCodeDefinition(normalized);
  return reasonCodeSummary(normalized);
}

function boolOr(value, fallback) {
  return value === undefined ? fallback : Boolean(value);
}

function boolOrTrue(value, ...fallbacks) {
  return Boolean(value === undefined ? false : value) || fallbacks.some(Boolean);
}

function defaultRecoveryForState(state) {
  return { ...RISK_STATE_DEFAULTS[state] };
}

function findReasonTransitionRule(reasonCode) {
  const normalized = normalizeReasonCode(reasonCode);
  if (!normalized) {
    return undefined;
  }
  return RISK_STATE_REASON_TRANSITION_RULES.find((rule) => rule.reasonCode === normalized);
}

function defaultReasonTransition(rule) {
  const reason = normalizeReasonSummary(rule.reasonCode);
  const state = normalizeState(rule.state);
  return {
    reasonCode: reason.code,
    family: reason.family,
    state,
    recovery: normalizeRecovery({}, RISK_STATE_DEFAULTS[state], reason),
  };
}

export function createRiskStateTransitionTable() {
  return {
    schemaVersion: RISK_STATE_TRANSITION_TABLE_SCHEMA_VERSION,
    states: RISK_STATES.map((state) => ({
      state,
      requiresKnownReasonCode: state !== 'normal',
      recovery: defaultRecoveryForState(state),
    })),
    reasonTransitions: RISK_STATE_REASON_TRANSITION_RULES.map(defaultReasonTransition),
  };
}

function assertRecoverySemanticsCompatible(rawRecovery = {}, expectedRecovery = {}, state) {
  if (!rawRecovery || typeof rawRecovery !== 'object' || Array.isArray(rawRecovery)) {
    throw new Error(`RiskState transition table ${state} recovery must be an object`);
  }
  for (const key of RISK_STATE_RECOVERY_KEYS) {
    if (rawRecovery[key] !== expectedRecovery[key]) {
      throw new Error(`RiskState transition table ${state} recovery.${key} is not compatible`);
    }
  }
  const extraKeys = Object.keys(rawRecovery).filter((key) => !RISK_STATE_RECOVERY_KEYS.includes(key));
  if (extraKeys.length > 0) {
    throw new Error(`RiskState transition table ${state} recovery has unsupported keys: ${extraKeys.join(', ')}`);
  }
}

function assertReasonTransitionCompatible(entry, rule, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error('RiskState transition table reasonTransitions entries must be objects');
  }
  const expected = defaultReasonTransition(rule);
  if (entry.reasonCode !== expected.reasonCode) {
    throw new Error(
      `RiskState transition table reasonTransition[${index}] reasonCode mismatch: expected ${expected.reasonCode}`,
    );
  }
  if (entry.family !== expected.family) {
    throw new Error(`RiskState transition table ${expected.reasonCode} family is not compatible`);
  }
  if (entry.state !== expected.state) {
    throw new Error(`RiskState transition table ${expected.reasonCode} state is not compatible`);
  }
  assertRecoverySemanticsCompatible(entry.recovery, expected.recovery, expected.reasonCode);
}

export function assertRiskStateTransitionTableCompatible(raw = {}) {
  const version = Number(raw?.schemaVersion);
  if (!Number.isInteger(version)) {
    throw new Error('RiskState transition table schemaVersion is required for compatibility checks');
  }
  if (version !== RISK_STATE_TRANSITION_TABLE_SCHEMA_VERSION) {
    throw new Error(
      `RiskState transition table schemaVersion ${version} is not compatible `
        + `with ${RISK_STATE_TRANSITION_TABLE_SCHEMA_VERSION}`,
    );
  }
  if (!Array.isArray(raw.states)) {
    throw new Error('RiskState transition table states must be an array');
  }
  if (raw.states.length !== RISK_STATES.length) {
    throw new Error('RiskState transition table must cover every design state exactly once');
  }
  raw.states.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('RiskState transition table entries must be objects');
    }
    const expectedState = RISK_STATES[index];
    if (entry.state !== expectedState) {
      throw new Error(`RiskState transition table state order mismatch at ${index}: expected ${expectedState}`);
    }
    const expectedRequiresReason = expectedState !== 'normal';
    if (entry.requiresKnownReasonCode !== expectedRequiresReason) {
      throw new Error(`RiskState transition table ${expectedState} requiresKnownReasonCode is not compatible`);
    }
    assertRecoverySemanticsCompatible(entry.recovery, RISK_STATE_DEFAULTS[expectedState], expectedState);
  });
  if (!Array.isArray(raw.reasonTransitions)) {
    throw new Error('RiskState transition table reasonTransitions must be an array');
  }
  if (raw.reasonTransitions.length !== RISK_STATE_REASON_TRANSITION_RULES.length) {
    throw new Error('RiskState transition table must cover every governed reason transition exactly once');
  }
  raw.reasonTransitions.forEach((entry, index) => {
    assertReasonTransitionCompatible(entry, RISK_STATE_REASON_TRANSITION_RULES[index], index);
  });
  return true;
}

function normalizeRecovery(raw = {}, stateDefaults, reasonSummary = undefined) {
  const reasonDefaults = reasonSummary ?? {};
  const stateBlocksExecution = stateDefaults.artifactWriteAllowed === false;
  const reasonBlocksArtifactWrites = reasonDefaults.artifactWriteAllowed === false;
  const reasonBlocksRetry = reasonDefaults.retryable === false;
  const catalogAction = normalizeCatalogAction(
    raw.catalogAction ?? reasonDefaults.catalogAction,
    stateDefaults.catalogAction,
  );
  const effectiveCatalogAction = stateDefaults.catalogAction === 'none'
    ? catalogAction
    : stateDefaults.catalogAction;
  return {
    retryable: stateBlocksExecution || reasonBlocksRetry
      ? false
      : boolOr(raw.retryable, Boolean(stateDefaults.retryable || reasonDefaults.retryable)),
    cooldownNeeded: boolOrTrue(
      raw.cooldownNeeded,
      stateDefaults.cooldownNeeded,
      reasonDefaults.cooldownNeeded,
    ),
    isolationNeeded: boolOrTrue(
      raw.isolationNeeded,
      stateDefaults.isolationNeeded,
      reasonDefaults.isolationNeeded,
    ),
    manualRecoveryNeeded: boolOrTrue(
      raw.manualRecoveryNeeded,
      stateDefaults.manualRecoveryNeeded,
      reasonDefaults.manualRecoveryNeeded,
    ),
    degradable: boolOrTrue(raw.degradable, stateDefaults.degradable, reasonDefaults.degradable),
    artifactWriteAllowed: stateBlocksExecution || reasonBlocksArtifactWrites
      ? false
      : boolOr(raw.artifactWriteAllowed, Boolean(reasonDefaults.artifactWriteAllowed ?? true)),
    catalogAction: effectiveCatalogAction,
    discardCatalog: boolOr(raw.discardCatalog, effectiveCatalogAction !== 'none'),
  };
}

function stripUndefined(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

export function assertRiskStateCompatible(raw = {}) {
  const version = Number(raw?.schemaVersion);
  if (!Number.isInteger(version)) {
    throw new Error('RiskState schemaVersion is required for compatibility checks');
  }
  if (version !== RISK_STATE_SCHEMA_VERSION) {
    throw new Error(`RiskState schemaVersion ${version} is not compatible with ${RISK_STATE_SCHEMA_VERSION}`);
  }
  return true;
}

export function normalizeRiskState(raw = {}) {
  if (raw.schemaVersion !== undefined) {
    assertRiskStateCompatible(raw);
  }
  const reason = normalizeReasonSummary(raw.reasonCode);
  const requestedState = normalizeState(raw.state);
  const reasonTransitionRule = findReasonTransitionRule(reason?.code);
  const state = reasonTransitionRule ? normalizeState(reasonTransitionRule.state) : requestedState;
  if (state !== 'normal' && !reason) {
    throw new Error(`RiskState ${state} requires a known reasonCode`);
  }
  const stateDefaults = RISK_STATE_DEFAULTS[state];
  const hasTransition = raw.transition?.from !== undefined
    || raw.transition?.observedAt !== undefined
    || raw.observedAt !== undefined;
  const transition = hasTransition
    ? stripUndefined({
      from: raw.transition?.from === undefined ? undefined : normalizeState(raw.transition.from, 'transition.from'),
      to: state,
      observedAt: normalizeTimestamp(raw.transition?.observedAt ?? raw.observedAt),
    })
    : undefined;
  return stripUndefined({
    schemaVersion: RISK_STATE_SCHEMA_VERSION,
    state,
    reasonCode: reason?.code,
    scope: normalizeText(raw.scope),
    siteKey: normalizeText(raw.siteKey),
    taskId: normalizeText(raw.taskId),
    transition,
    recovery: normalizeRecovery(raw.recovery, stateDefaults, reason),
  });
}

export function normalizeRiskTransition(raw = {}) {
  return normalizeRiskState({
    ...raw,
    transition: {
      from: raw.from ?? raw.previousState ?? raw.transition?.from,
      observedAt: raw.observedAt ?? raw.transition?.observedAt,
    },
  });
}
