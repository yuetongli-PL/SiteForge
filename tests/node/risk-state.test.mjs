import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RISK_STATE_SCHEMA_VERSION,
  RISK_STATE_TRANSITION_TABLE_SCHEMA_VERSION,
  RISK_STATES,
  assertRiskStateCompatible,
  assertRiskStateTransitionTableCompatible,
  createRiskStateTransitionTable,
  normalizeRiskState,
  normalizeRiskTransition,
} from '../../src/sites/capability/risk-state.mjs';

test('RiskState exposes the design state set and a versioned normal state', () => {
  assert.deepEqual(RISK_STATES, [
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

  assert.deepEqual(normalizeRiskState({
    schemaVersion: RISK_STATE_SCHEMA_VERSION,
    siteKey: 'example.test',
    scope: 'session',
  }), {
    schemaVersion: RISK_STATE_SCHEMA_VERSION,
    state: 'normal',
    scope: 'session',
    siteKey: 'example.test',
    recovery: {
      retryable: false,
      cooldownNeeded: false,
      isolationNeeded: false,
      manualRecoveryNeeded: false,
      degradable: false,
      artifactWriteAllowed: true,
      catalogAction: 'none',
      discardCatalog: false,
    },
  });
});

test('RiskState normalizes rate limit transitions with reasonCode recovery semantics', () => {
  const state = normalizeRiskTransition({
    schemaVersion: RISK_STATE_SCHEMA_VERSION,
    from: 'normal',
    state: 'rate_limited',
    reasonCode: 'request-burst',
    siteKey: 'example.test',
    taskId: 'task-1',
    scope: 'profile',
    observedAt: '2026-05-01T00:00:00+08:00',
  });

  assert.equal(state.state, 'rate_limited');
  assert.equal(state.reasonCode, 'request-burst');
  assert.equal(state.transition.from, 'normal');
  assert.equal(state.transition.to, 'rate_limited');
  assert.equal(state.transition.observedAt, '2026-04-30T16:00:00.000Z');
  assert.deepEqual(state.recovery, {
    retryable: true,
    cooldownNeeded: true,
    isolationNeeded: false,
    manualRecoveryNeeded: false,
    degradable: true,
    artifactWriteAllowed: true,
    catalogAction: 'none',
    discardCatalog: false,
  });
});

test('RiskState preserves fail-closed blocked semantics even when reasonCode is looser', () => {
  const state = normalizeRiskState({
    schemaVersion: RISK_STATE_SCHEMA_VERSION,
    state: 'blocked',
    reasonCode: 'profile-health-risk',
    recovery: {
      retryable: true,
      artifactWriteAllowed: true,
      catalogAction: 'deprecate',
    },
  });

  assert.equal(state.recovery.retryable, false);
  assert.equal(state.recovery.artifactWriteAllowed, false);
  assert.equal(state.recovery.catalogAction, 'block');
  assert.equal(state.recovery.discardCatalog, true);
  assert.equal(state.recovery.isolationNeeded, true);
  assert.equal(state.recovery.manualRecoveryNeeded, true);
});

test('RiskState maps missing SessionView revocation handles to manual recovery semantics', () => {
  const state = normalizeRiskState({
    schemaVersion: RISK_STATE_SCHEMA_VERSION,
    state: 'manual_recovery_required',
    reasonCode: 'session-revocation-handle-missing',
    siteKey: 'example.test',
    taskId: 'task-session-revocation',
    scope: 'session-materialization',
  });

  assert.equal(state.state, 'manual_recovery_required');
  assert.equal(state.reasonCode, 'session-revocation-handle-missing');
  assert.deepEqual(state.recovery, {
    retryable: false,
    cooldownNeeded: false,
    isolationNeeded: false,
    manualRecoveryNeeded: true,
    degradable: false,
    artifactWriteAllowed: true,
    catalogAction: 'none',
    discardCatalog: false,
  });
});

test('RiskState maps session runtime failures into governed session states', () => {
  const invalidSession = normalizeRiskTransition({
    schemaVersion: RISK_STATE_SCHEMA_VERSION,
    from: 'normal',
    state: 'suspicious',
    reasonCode: 'session-invalid',
    siteKey: 'douyin',
    taskId: 'session-run-douyin-download',
    scope: 'session',
    observedAt: '2026-05-03T01:00:00.000Z',
  });

  assert.equal(invalidSession.state, 'auth_expired');
  assert.equal(invalidSession.transition.from, 'normal');
  assert.equal(invalidSession.transition.to, 'auth_expired');
  assert.deepEqual(invalidSession.recovery, {
    retryable: true,
    cooldownNeeded: false,
    isolationNeeded: false,
    manualRecoveryNeeded: true,
    degradable: false,
    artifactWriteAllowed: true,
    catalogAction: 'none',
    discardCatalog: false,
  });

  const invalidRevocation = normalizeRiskTransition({
    schemaVersion: RISK_STATE_SCHEMA_VERSION,
    from: 'normal',
    state: 'auth_expired',
    reasonCode: 'session-revocation-invalid',
    siteKey: 'douyin',
    taskId: 'session-run-douyin-download',
    scope: 'session-materialization',
    observedAt: '2026-05-03T01:01:00.000Z',
  });

  assert.equal(invalidRevocation.state, 'manual_recovery_required');
  assert.equal(invalidRevocation.transition.from, 'normal');
  assert.equal(invalidRevocation.transition.to, 'manual_recovery_required');
  assert.deepEqual(invalidRevocation.recovery, {
    retryable: false,
    cooldownNeeded: false,
    isolationNeeded: false,
    manualRecoveryNeeded: true,
    degradable: false,
    artifactWriteAllowed: false,
    catalogAction: 'none',
    discardCatalog: false,
  });
});

test('RiskState fail-closes schema incompatibility recovery fields', () => {
  const state = normalizeRiskTransition({
    schemaVersion: RISK_STATE_SCHEMA_VERSION,
    from: 'normal',
    state: 'manual_recovery_required',
    reasonCode: 'schema-version-incompatible',
    recovery: {
      retryable: true,
      manualRecoveryNeeded: false,
      artifactWriteAllowed: true,
    },
  });

  assert.equal(state.reasonCode, 'schema-version-incompatible');
  assert.equal(state.transition.from, 'normal');
  assert.equal(state.transition.to, 'manual_recovery_required');
  assert.equal(state.recovery.retryable, false);
  assert.equal(state.recovery.manualRecoveryNeeded, true);
  assert.equal(state.recovery.artifactWriteAllowed, false);
  assert.equal(state.recovery.catalogAction, 'none');
  assert.equal(state.recovery.discardCatalog, false);
});

test('RiskState fail-closes artifact write failures without blocking degradation', () => {
  const state = normalizeRiskState({
    schemaVersion: RISK_STATE_SCHEMA_VERSION,
    state: 'suspicious',
    reasonCode: 'lifecycle-artifact-write-failed',
    recovery: {
      artifactWriteAllowed: true,
      degradable: false,
    },
  });

  assert.equal(state.reasonCode, 'lifecycle-artifact-write-failed');
  assert.equal(state.recovery.retryable, true);
  assert.equal(state.recovery.degradable, true);
  assert.equal(state.recovery.artifactWriteAllowed, false);
  assert.equal(state.recovery.manualRecoveryNeeded, false);
});

test('RiskState reason transitions fail closed for artifact and catalog failures', () => {
  const redactionFailure = normalizeRiskTransition({
    schemaVersion: RISK_STATE_SCHEMA_VERSION,
    from: 'normal',
    state: 'suspicious',
    reasonCode: 'redaction-failed',
    recovery: {
      artifactWriteAllowed: true,
      manualRecoveryNeeded: false,
    },
  });

  assert.equal(redactionFailure.state, 'blocked');
  assert.equal(redactionFailure.transition.from, 'normal');
  assert.equal(redactionFailure.transition.to, 'blocked');
  assert.equal(redactionFailure.recovery.retryable, false);
  assert.equal(redactionFailure.recovery.artifactWriteAllowed, false);
  assert.equal(redactionFailure.recovery.manualRecoveryNeeded, true);
  assert.equal(redactionFailure.recovery.catalogAction, 'block');
  assert.equal(redactionFailure.recovery.discardCatalog, true);

  const catalogWriteFailure = normalizeRiskState({
    schemaVersion: RISK_STATE_SCHEMA_VERSION,
    state: 'suspicious',
    reasonCode: 'api-catalog-write-failed',
    recovery: {
      artifactWriteAllowed: true,
      manualRecoveryNeeded: false,
    },
  });

  assert.equal(catalogWriteFailure.state, 'manual_recovery_required');
  assert.equal(catalogWriteFailure.recovery.retryable, true);
  assert.equal(catalogWriteFailure.recovery.artifactWriteAllowed, false);
  assert.equal(catalogWriteFailure.recovery.manualRecoveryNeeded, true);
  assert.equal(catalogWriteFailure.recovery.degradable, true);

  const catalogEntryBlocked = normalizeRiskState({
    schemaVersion: RISK_STATE_SCHEMA_VERSION,
    state: 'suspicious',
    reasonCode: 'api-catalog-entry-blocked',
    recovery: {
      retryable: true,
      artifactWriteAllowed: true,
      catalogAction: 'none',
    },
  });

  assert.equal(catalogEntryBlocked.state, 'blocked');
  assert.equal(catalogEntryBlocked.recovery.retryable, false);
  assert.equal(catalogEntryBlocked.recovery.artifactWriteAllowed, false);
  assert.equal(catalogEntryBlocked.recovery.catalogAction, 'block');
  assert.equal(catalogEntryBlocked.recovery.discardCatalog, true);
});

test('RiskState rejects invalid states, missing risk reasons, and unknown reason codes', () => {
  assert.throws(
    () => normalizeRiskState({ state: 'challenge_bypass', reasonCode: 'anti-crawl-verify' }),
    /Unsupported RiskState state/u,
  );
  assert.throws(
    () => normalizeRiskState({ state: 'captcha_required' }),
    /requires a known reasonCode/u,
  );
  assert.throws(
    () => normalizeRiskState({ state: 'suspicious', reasonCode: 'unknown-risk-code' }),
    /Unknown reasonCode/u,
  );
  assert.throws(
    () => normalizeRiskTransition({
      state: 'suspicious',
      reasonCode: 'unknown-risk',
      from: 'not-a-state',
    }),
    /Unsupported RiskState transition\.from/u,
  );
});

test('RiskState compatibility guard requires the current schema version', () => {
  assert.equal(assertRiskStateCompatible({ schemaVersion: RISK_STATE_SCHEMA_VERSION }), true);
  assert.throws(
    () => assertRiskStateCompatible({}),
    /schemaVersion is required/u,
  );
  assert.throws(
    () => assertRiskStateCompatible({ schemaVersion: RISK_STATE_SCHEMA_VERSION + 1 }),
    /not compatible/u,
  );
});

test('RiskState transition table is versioned and locks recovery semantics', () => {
  const table = createRiskStateTransitionTable();

  assert.equal(table.schemaVersion, RISK_STATE_TRANSITION_TABLE_SCHEMA_VERSION);
  assert.deepEqual(table.states.map((entry) => entry.state), RISK_STATES);
  assert.equal(assertRiskStateTransitionTableCompatible(table), true);

  const byState = new Map(table.states.map((entry) => [entry.state, entry]));
  assert.equal(byState.get('normal').requiresKnownReasonCode, false);
  assert.equal(byState.get('captcha_required').requiresKnownReasonCode, true);
  assert.deepEqual(byState.get('captcha_required').recovery, {
    retryable: false,
    cooldownNeeded: true,
    isolationNeeded: true,
    manualRecoveryNeeded: true,
    degradable: true,
    artifactWriteAllowed: true,
    catalogAction: 'none',
  });
  assert.deepEqual(byState.get('blocked').recovery, {
    retryable: false,
    cooldownNeeded: false,
    isolationNeeded: true,
    manualRecoveryNeeded: true,
    degradable: false,
    artifactWriteAllowed: false,
    catalogAction: 'block',
  });

  const byReason = new Map(table.reasonTransitions.map((entry) => [entry.reasonCode, entry]));
  assert.deepEqual(byReason.get('redaction-failed'), {
    reasonCode: 'redaction-failed',
    family: 'artifact',
    state: 'blocked',
    recovery: {
      retryable: false,
      cooldownNeeded: false,
      isolationNeeded: true,
      manualRecoveryNeeded: true,
      degradable: false,
      artifactWriteAllowed: false,
      catalogAction: 'block',
      discardCatalog: true,
    },
  });
  assert.deepEqual(byReason.get('api-catalog-write-failed'), {
    reasonCode: 'api-catalog-write-failed',
    family: 'api',
    state: 'manual_recovery_required',
    recovery: {
      retryable: true,
      cooldownNeeded: false,
      isolationNeeded: false,
      manualRecoveryNeeded: true,
      degradable: true,
      artifactWriteAllowed: false,
      catalogAction: 'none',
      discardCatalog: false,
    },
  });
  assert.deepEqual(byReason.get('session-invalid'), {
    reasonCode: 'session-invalid',
    family: 'session',
    state: 'auth_expired',
    recovery: {
      retryable: true,
      cooldownNeeded: false,
      isolationNeeded: false,
      manualRecoveryNeeded: true,
      degradable: false,
      artifactWriteAllowed: true,
      catalogAction: 'none',
      discardCatalog: false,
    },
  });
  assert.deepEqual(byReason.get('session-revocation-invalid'), {
    reasonCode: 'session-revocation-invalid',
    family: 'session',
    state: 'manual_recovery_required',
    recovery: {
      retryable: false,
      cooldownNeeded: false,
      isolationNeeded: false,
      manualRecoveryNeeded: true,
      degradable: false,
      artifactWriteAllowed: false,
      catalogAction: 'none',
      discardCatalog: false,
    },
  });
});

test('RiskState transition table compatibility rejects drift', () => {
  const table = createRiskStateTransitionTable();

  assert.throws(
    () => assertRiskStateTransitionTableCompatible({}),
    /schemaVersion is required/u,
  );
  assert.throws(
    () => assertRiskStateTransitionTableCompatible({
      ...table,
      schemaVersion: RISK_STATE_TRANSITION_TABLE_SCHEMA_VERSION + 1,
    }),
    /not compatible/u,
  );
  assert.throws(
    () => assertRiskStateTransitionTableCompatible({
      ...table,
      states: table.states.slice(0, -1),
    }),
    /cover every design state/u,
  );
  assert.throws(
    () => assertRiskStateTransitionTableCompatible({
      ...table,
      states: [
        table.states[1],
        table.states[0],
        ...table.states.slice(2),
      ],
    }),
    /state order mismatch/u,
  );
  assert.throws(
    () => assertRiskStateTransitionTableCompatible({
      ...table,
      states: table.states.map((entry) => (entry.state === 'blocked'
        ? {
          ...entry,
          recovery: {
            ...entry.recovery,
            artifactWriteAllowed: true,
          },
        }
        : entry)),
    }),
    /blocked recovery\.artifactWriteAllowed is not compatible/u,
  );
  assert.throws(
    () => assertRiskStateTransitionTableCompatible({
      ...table,
      states: table.states.map((entry) => (entry.state === 'normal'
        ? {
          ...entry,
          requiresKnownReasonCode: true,
        }
        : entry)),
    }),
    /normal requiresKnownReasonCode is not compatible/u,
  );
  assert.throws(
    () => assertRiskStateTransitionTableCompatible({
      ...table,
      reasonTransitions: table.reasonTransitions.slice(0, -1),
    }),
    /cover every governed reason transition/u,
  );
  assert.throws(
    () => assertRiskStateTransitionTableCompatible({
      ...table,
      reasonTransitions: table.reasonTransitions.map((entry) => (entry.reasonCode === 'redaction-failed'
        ? {
          ...entry,
          state: 'suspicious',
        }
        : entry)),
    }),
    /redaction-failed state is not compatible/u,
  );
  assert.throws(
    () => assertRiskStateTransitionTableCompatible({
      ...table,
      reasonTransitions: table.reasonTransitions.map((entry) => (entry.reasonCode === 'api-catalog-write-failed'
        ? {
          ...entry,
          recovery: {
            ...entry.recovery,
            artifactWriteAllowed: true,
          },
        }
        : entry)),
    }),
    /api-catalog-write-failed recovery\.artifactWriteAllowed is not compatible/u,
  );
});
