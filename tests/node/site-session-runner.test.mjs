import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import {
  SESSION_RUN_MANIFEST_SCHEMA_VERSION,
  normalizeSessionRunManifest,
} from '../../src/sites/sessions/contracts.mjs';
import {
  reasonCodeSummary,
  requireReasonCodeDefinition,
} from '../../src/sites/capability/reason-codes.mjs';
import {
  LIFECYCLE_EVENT_SCHEMA_VERSION,
  assertLifecycleEventObservabilityFields,
  composeLifecycleSubscribers,
  dispatchLifecycleEvent,
} from '../../src/sites/capability/lifecycle-events.mjs';
import { assertSchemaCompatible } from '../../src/sites/capability/compatibility-registry.mjs';
import {
  listSessionSiteDefinitions,
  resolveSessionSiteDefinition,
} from '../../src/sites/sessions/site-modules.mjs';
import {
  assertSessionBoundaryCrossingSafe,
  sessionViewMaterializationAuditFromRunManifest,
  sessionOptionsFromRunManifest,
  sessionViewFromRunManifest,
  summarizeSessionRunManifest,
} from '../../src/sites/sessions/manifest-bridge.mjs';
import { evaluateAuthenticatedSessionReleaseGate } from '../../src/sites/sessions/release-gate.mjs';
import { runSessionTask } from '../../src/sites/sessions/runner.mjs';
import { inspectSessionHealth } from '../../src/sites/downloads/session-manager.mjs';
import { REDACTION_PLACEHOLDER } from '../../src/sites/capability/security-guard.mjs';
import { createCapabilityHookRegistry } from '../../src/sites/capability/capability-hook.mjs';
import {
  createSessionRevocationStore,
  registerSessionRevocationHandle,
  revokeSessionRevocationHandle,
  SESSION_VIEW_MATERIALIZATION_AUDIT_SCHEMA_VERSION,
  SESSION_VIEW_SCHEMA_VERSION,
} from '../../src/sites/capability/session-view.mjs';
import {
  main,
  parseArgs,
} from '../../src/entrypoints/sites/session.mjs';
import {
  parseCliArgs as parseSiteDoctorArgs,
  siteDoctor,
} from '../../src/entrypoints/sites/site-doctor.mjs';

test('session CLI parser accepts health plan flags', () => {
  const parsed = parseArgs([
    'plan-repair',
    '--site', 'douyin',
    '--purpose', 'download',
    '--session-required',
    '--risk-signal', 'session-invalid',
    '--json',
  ]);

  assert.equal(parsed.action, 'plan-repair');
  assert.equal(parsed.site, 'douyin');
  assert.equal(parsed.purpose, 'download');
  assert.equal(parsed.sessionRequired, true);
  assert.deepEqual(parsed.riskSignals, ['session-invalid']);
  assert.equal(parsed.json, true);
});

test('session manifest normalizer redacts profile paths and auth material', () => {
  const manifest = normalizeSessionRunManifest({
    plan: {
      siteKey: 'douyin',
      host: 'www.douyin.com',
      purpose: 'download',
      sessionRequirement: 'required',
      profilePath: 'C:/private/profiles/www.douyin.com.json',
      browserProfileRoot: 'C:/private/browser-root',
      userDataDir: 'C:/private/user-data',
      dryRun: true,
    },
    health: {
      status: 'manual-required',
      reason: 'session-invalid',
      cookies: [{ name: 'sid', value: 'secret-cookie' }],
      headers: { authorization: 'Bearer secret-token' },
      repairPlan: {
        action: 'site-login',
        command: 'site-login',
        reason: 'session-invalid',
        requiresApproval: true,
      },
    },
    artifacts: {
      manifest: 'C:/tmp/run/manifest.json',
      runDir: 'C:/tmp/run',
    },
  });

  assert.equal(manifest.schemaVersion, SESSION_RUN_MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.status, 'manual-required');
  assert.equal(manifest.plan.profilePathPresent, true);
  assert.equal(manifest.plan.browserProfileRootPresent, true);
  assert.equal(manifest.plan.userDataDirPresent, true);
  assert.equal(manifest.artifacts.schemaVersion, 1);
  assert.equal(assertSchemaCompatible('ArtifactReferenceSet', manifest.artifacts), true);
  const serialized = JSON.stringify(manifest);
  assert.equal(serialized.includes('C:/private'), false);
  assert.equal(serialized.includes('secret-cookie'), false);
  assert.equal(serialized.includes('secret-token'), false);
});

test('session manifest reasons consume the reasonCode catalog while preserving unknown legacy reasons', () => {
  const known = requireReasonCodeDefinition('session-invalid', { family: 'session' }).code;
  const manifest = normalizeSessionRunManifest({
    plan: {
      siteKey: 'douyin',
      host: 'www.douyin.com',
      purpose: 'download',
      sessionRequirement: 'required',
    },
    health: {
      status: 'manual-required',
      reason: 'session-invalid',
      repairPlan: {
        action: 'site-login',
        command: 'site-login',
        reason: 'session-invalid',
      },
    },
    artifacts: {
      manifest: 'C:/tmp/session/manifest.json',
    },
  });

  assert.equal(manifest.reason, known);
  assert.equal(manifest.health.reason, known);
  assert.equal(manifest.health.riskCauseCode, known);
  assert.equal(manifest.repairPlan.reason, known);

  const legacy = normalizeSessionRunManifest({
    plan: {
      siteKey: 'example',
      host: 'example.invalid',
      purpose: 'health-check',
    },
    health: {
      status: 'blocked',
      reason: 'legacy-session-provider-reason',
    },
  });
  assert.equal(legacy.reason, 'legacy-session-provider-reason');
  assert.equal(legacy.health.reason, 'legacy-session-provider-reason');
});

test('lifecycle dispatcher passes normalized events to subscribers', async () => {
  const seen = [];
  const result = await dispatchLifecycleEvent({
    eventType: 'session.run.completed',
    taskId: 'synthetic-task',
    siteKey: 'douyin',
    reasonCode: 'session-invalid',
    details: {
      status: 'manual-required',
    },
  }, {
    subscribers: [
      async (event) => {
        seen.push(event);
        return {
          ok: true,
          eventType: event.eventType,
        };
      },
    ],
  });

  assert.equal(result.event.schemaVersion, LIFECYCLE_EVENT_SCHEMA_VERSION);
  assert.equal(result.event.reasonCode, 'session-invalid');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].schemaVersion, LIFECYCLE_EVENT_SCHEMA_VERSION);
  assert.equal(seen[0].taskId, 'synthetic-task');
  assert.deepEqual(result.subscriberResults, [{
    ok: true,
    eventType: 'session.run.completed',
  }]);
});

test('lifecycle subscriber composition preserves order and accepts function groups', async () => {
  const calls = [];
  const subscribers = composeLifecycleSubscribers(
    null,
    async () => {
      calls.push('injected-first');
      return 'first';
    },
    [
      async () => {
        calls.push('injected-second');
        return 'second';
      },
    ],
    undefined,
    async () => {
      calls.push('artifact-writer');
      return 'writer';
    },
  );

  const result = await dispatchLifecycleEvent({
    eventType: 'session.run.completed',
    taskId: 'synthetic-task',
    siteKey: 'douyin',
  }, {
    subscribers,
  });

  assert.deepEqual(calls, ['injected-first', 'injected-second', 'artifact-writer']);
  assert.deepEqual(result.subscriberResults, ['first', 'second', 'writer']);
});

test('lifecycle subscriber composition rejects non-function subscribers', () => {
  assert.throws(
    () => composeLifecycleSubscribers([async () => {}, 'not-a-subscriber']),
    /Lifecycle event subscriber must be a function/u,
  );
});

test('lifecycle dispatcher rejects composed subscriber failures without running later subscribers', async () => {
  const calls = [];
  const subscribers = composeLifecycleSubscribers(
    async () => {
      calls.push('first');
      return 'first';
    },
    async () => {
      calls.push('failing');
      throw new Error('synthetic-composed-lifecycle-failure');
    },
    async () => {
      calls.push('after-failure');
      return 'after-failure';
    },
  );

  await assert.rejects(
    () => dispatchLifecycleEvent({
      eventType: 'session.run.completed',
      taskId: 'synthetic-task',
      siteKey: 'douyin',
    }, {
      subscribers,
    }),
    /synthetic-composed-lifecycle-failure/u,
  );
  assert.deepEqual(calls, ['first', 'failing']);
});

test('session site modules expose five auth site definitions and profile auth URLs', async () => {
  const definitions = listSessionSiteDefinitions();
  assert.deepEqual(definitions.map((definition) => definition.siteKey), [
    'bilibili',
    'douyin',
    'xiaohongshu',
    'x',
    'instagram',
  ]);

  const resolved = await resolveSessionSiteDefinition({ site: 'xhs' });
  assert.equal(resolved.siteKey, 'xiaohongshu');
  assert.equal(resolved.host, 'www.xiaohongshu.com');
  assert.equal(resolved.verificationUrl, 'https://www.xiaohongshu.com/notification');
  assert.deepEqual(resolved.requiredAuthSurfaces, ['/notification']);
});

test('session runner writes a ready health manifest without executing repair providers', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-runner-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const secretProfileRoot = 'C:/secret/browser-root';
  const calls = [];

  const result = await runSessionTask({
    action: 'health',
    site: 'instagram',
    purpose: 'archive',
    outDir: runRoot,
    browserProfileRoot: secretProfileRoot,
  }, {}, {
    maybeLoadValidatedProfileForHost: async () => ({
      json: {
        authSession: {
          verificationUrl: 'https://www.instagram.com/',
          keepaliveUrl: 'https://www.instagram.com/',
          authRequiredPathPrefixes: ['/direct'],
        },
      },
    }),
    inspectSessionHealth: async (siteKey, options) => {
      calls.push({ siteKey, options });
      return {
        siteKey,
        host: options.host,
        status: 'ready',
        mode: 'reusable-profile',
        identityConfirmed: true,
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].siteKey, 'instagram');
  assert.equal(calls[0].options.browserProfileRoot, secretProfileRoot);
  assert.equal(result.manifest.status, 'passed');
  assert.equal(result.manifest.plan.browserProfileRootPresent, true);
  assert.equal(result.manifest.artifacts.manifest.endsWith('manifest.json'), true);
  const persisted = JSON.parse(await readFile(result.manifest.artifacts.manifest, 'utf8'));
  assert.equal(persisted.status, 'passed');
  assert.equal(JSON.stringify(persisted).includes(secretProfileRoot), false);
});

test('session runner treats recovered profile-health marker as non-blocking evidence', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-recovered-health-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const result = await runSessionTask({
    action: 'health',
    site: 'x',
    purpose: 'archive',
    outDir: runRoot,
    sessionRequired: true,
  }, {}, {
    maybeLoadValidatedProfileForHost: async () => ({
      json: {
        authSession: {
          verificationUrl: 'https://x.com/home',
          keepaliveUrl: 'https://x.com/home',
        },
      },
    }),
    inspectSessionHealth: async (siteKey, options) => ({
      siteKey,
      host: options.host,
      status: 'ready',
      mode: 'authenticated',
      authStatus: 'authenticated-or-anonymous-ok',
      riskSignals: ['profile-health-recovered-after-session-reuse'],
    }),
  });

  assert.equal(result.manifest.status, 'passed');
  assert.equal(result.manifest.healthRecovery.report.status, 'healthy');
  assert.deepEqual(result.manifest.healthRecovery.report.risks, []);
  const persisted = JSON.parse(await readFile(result.manifest.artifacts.manifest, 'utf8'));
  assert.equal(persisted.healthRecovery.report.status, 'healthy');
});

test('session runner records repair plan for unhealthy required sessions', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-runner-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const result = await runSessionTask({
    action: 'plan-repair',
    site: 'douyin',
    purpose: 'download',
    outDir: runRoot,
    sessionRequired: true,
    status: 'manual-required',
    reason: 'session-invalid',
  });

  assert.equal(result.manifest.status, 'manual-required');
  assert.equal(result.manifest.reason, 'session-invalid');
  assert.equal(result.manifest.plan.sessionRequirement, 'required');
  assert.equal(result.manifest.repairPlan.action, 'site-login');
  assert.equal(result.manifest.repairPlan.command, 'site-login');
  assert.equal(result.manifest.repairPlan.requiresApproval, true);
});

test('session runner fails closed when lifecycle subscriber fails', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-runner-lifecycle-failure-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const runDir = path.join(runRoot, 'failed-run');

  await assert.rejects(
    () => runSessionTask({
      action: 'plan-repair',
      site: 'douyin',
      purpose: 'download',
      runDir,
      sessionRequired: true,
      status: 'manual-required',
      reason: 'session-invalid',
    }, {}, {
      lifecycleEventSubscribers: [
        async () => {
          throw new Error('synthetic-lifecycle-failure');
        },
      ],
    }),
    /synthetic-lifecycle-failure/u,
  );
  await assert.rejects(
    () => readFile(path.join(runDir, 'manifest.json'), 'utf8'),
    /ENOENT/u,
  );
  await assert.rejects(
    () => readFile(path.join(runDir, 'lifecycle-event.json'), 'utf8'),
    /ENOENT/u,
  );
  await assert.rejects(
    () => readFile(path.join(runDir, 'lifecycle-event-redaction-audit.json'), 'utf8'),
    /ENOENT/u,
  );
});

test('session runner fails closed for unknown or revoked materialization revocation handles', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-runner-revocation-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const now = new Date('2026-04-30T00:00:00.000Z');
  const unknownRunDir = path.join(runRoot, 'unknown-handle');
  const unknownStore = createSessionRevocationStore({ records: [], now });

  const expectedRecovery = reasonCodeSummary('session-revocation-invalid');

  await assert.rejects(
    () => runSessionTask({
      action: 'health',
      site: 'douyin',
      purpose: 'download',
      runDir: unknownRunDir,
      status: 'ready',
    }, {}, {
      now,
      sessionRevocationStore: unknownStore,
      revocationHandleRef: 'rvk-unknown-handle',
    }),
    (error) => {
      assert.match(error.message, /revocation handle is not registered/u);
      assert.equal(error.cause?.message, 'SessionView revocation handle is not registered');
      assert.equal(error.reasonCode, 'session-revocation-invalid');
      assert.deepEqual(error.reasonRecovery, expectedRecovery);
      assert.equal(error.retryable, false);
      assert.equal(error.manualRecoveryNeeded, true);
      assert.equal(error.artifactWriteAllowed, false);
      assert.equal(error.riskState.schemaVersion, 1);
      assert.equal(error.riskState.state, 'manual_recovery_required');
      assert.equal(error.riskState.reasonCode, 'session-revocation-invalid');
      assert.equal(error.riskState.scope, 'session-materialization');
      assert.equal(error.riskState.siteKey, 'douyin');
      assert.match(error.riskState.taskId, /^session-run-douyin-download-/u);
      assert.deepEqual(error.riskState.transition, {
        from: 'normal',
        to: 'manual_recovery_required',
        observedAt: error.riskState.transition.observedAt,
      });
      assert.deepEqual(error.riskState.recovery, {
        retryable: false,
        cooldownNeeded: false,
        isolationNeeded: false,
        manualRecoveryNeeded: true,
        degradable: false,
        artifactWriteAllowed: false,
        catalogAction: 'none',
        discardCatalog: false,
      });
      assert.doesNotMatch(
        JSON.stringify(error.riskState),
        /rvk-unknown-handle|cookie|authorization|csrf|Bearer|profilePath|browserProfileRoot|userDataDir/iu,
      );
      return true;
    },
  );
  for (const artifactName of [
    'manifest.json',
    'redaction-audit.json',
    'session-view-materialization-audit.json',
    'session-view-materialization-redaction-audit.json',
    'lifecycle-event.json',
    'lifecycle-event-redaction-audit.json',
  ]) {
    await assert.rejects(
      () => readFile(path.join(unknownRunDir, artifactName), 'utf8'),
      /ENOENT/u,
    );
  }

  const revokedRunDir = path.join(runRoot, 'revoked-handle');
  const revokedStore = createSessionRevocationStore({ records: [], now });
  registerSessionRevocationHandle(revokedStore, {
    handle: 'rvk-revoked-handle',
    ttlSeconds: 300,
  }, { now });
  revokeSessionRevocationHandle(revokedStore, 'rvk-revoked-handle', {
    reasonCode: 'session-invalid',
    now,
  });

  await assert.rejects(
    () => runSessionTask({
      action: 'health',
      site: 'douyin',
      purpose: 'download',
      runDir: revokedRunDir,
      status: 'ready',
    }, {}, {
      now,
      sessionRevocationStore: revokedStore,
      revocationHandleRef: 'rvk-revoked-handle',
    }),
    (error) => {
      assert.match(error.message, /revocation handle is revoked/u);
      assert.equal(error.cause?.message, 'SessionView revocation handle is revoked');
      assert.equal(error.reasonCode, 'session-revocation-invalid');
      assert.deepEqual(error.reasonRecovery, expectedRecovery);
      assert.equal(error.retryable, false);
      assert.equal(error.manualRecoveryNeeded, true);
      assert.equal(error.artifactWriteAllowed, false);
      assert.equal(error.riskState.schemaVersion, 1);
      assert.equal(error.riskState.state, 'manual_recovery_required');
      assert.equal(error.riskState.reasonCode, 'session-revocation-invalid');
      assert.equal(error.riskState.scope, 'session-materialization');
      assert.equal(error.riskState.siteKey, 'douyin');
      assert.match(error.riskState.taskId, /^session-run-douyin-download-/u);
      assert.deepEqual(error.riskState.transition, {
        from: 'normal',
        to: 'manual_recovery_required',
        observedAt: error.riskState.transition.observedAt,
      });
      assert.deepEqual(error.riskState.recovery, {
        retryable: false,
        cooldownNeeded: false,
        isolationNeeded: false,
        manualRecoveryNeeded: true,
        degradable: false,
        artifactWriteAllowed: false,
        catalogAction: 'none',
        discardCatalog: false,
      });
      assert.doesNotMatch(
        JSON.stringify(error.riskState),
        /rvk-revoked-handle|cookie|authorization|csrf|Bearer|profilePath|browserProfileRoot|userDataDir/iu,
      );
      return true;
    },
  );
  for (const artifactName of [
    'manifest.json',
    'redaction-audit.json',
    'session-view-materialization-audit.json',
    'session-view-materialization-redaction-audit.json',
    'lifecycle-event.json',
    'lifecycle-event-redaction-audit.json',
  ]) {
    await assert.rejects(
      () => readFile(path.join(revokedRunDir, artifactName), 'utf8'),
      /ENOENT/u,
    );
  }
});

test('session runner redacts synthetic forbidden risk signals before persisting manifest', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-runner-redaction-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const syntheticRiskSignal = 'refresh_token=synthetic-refresh-token';
  const hookRegistry = createCapabilityHookRegistry([{
    id: 'session-run-completed-observer',
    phase: 'after_session_materialize',
    subscriber: {
      name: 'session-run-completed-observer',
      modulePath: 'src/sites/capability/lifecycle-events.mjs',
      entrypoint: 'observe',
      order: 1,
    },
    filters: {
      eventTypes: ['session.run.completed'],
      siteKeys: ['douyin'],
      reasonCodes: ['session-invalid'],
    },
  }]);

  const result = await runSessionTask({
    action: 'plan-repair',
    site: 'douyin',
    purpose: 'download',
    outDir: runRoot,
    sessionRequired: true,
    status: 'manual-required',
    reason: 'session-invalid',
    riskSignals: [syntheticRiskSignal],
  }, {}, {
    capabilityHookRegistry: hookRegistry,
  });

  const persisted = JSON.parse(await readFile(result.manifest.artifacts.manifest, 'utf8'));
  assert.equal(JSON.stringify(persisted).includes('synthetic-refresh-token'), false);
  assert.deepEqual(persisted.health.riskSignals, [REDACTION_PLACEHOLDER]);
  assert.deepEqual(persisted.repairPlan.riskSignals, ['session-invalid', REDACTION_PLACEHOLDER]);
  assert.equal(typeof persisted.artifacts.redactionAudit, 'string');
  const audit = JSON.parse(await readFile(persisted.artifacts.redactionAudit, 'utf8'));
  assert.equal(JSON.stringify(audit).includes('synthetic-refresh-token'), false);
  assert.equal(audit.redactedPaths.includes('health.riskSignals.0'), true);
  assert.equal(audit.redactedPaths.includes('repairPlan.riskSignals.1'), true);
  assert.deepEqual(audit.findings, [{
    path: 'health.riskSignals.0',
    pattern: 'sensitive-query-assignment',
  }, {
    path: 'repairPlan.riskSignals.1',
    pattern: 'sensitive-query-assignment',
  }]);
  assert.equal(typeof persisted.artifacts.sessionViewMaterializationAudit, 'string');
  assert.equal(typeof persisted.artifacts.sessionViewMaterializationRedactionAudit, 'string');
  const sessionMaterializationAudit = JSON.parse(
    await readFile(persisted.artifacts.sessionViewMaterializationAudit, 'utf8'),
  );
  assert.equal(sessionMaterializationAudit.eventType, 'session.materialized');
  assert.equal(sessionMaterializationAudit.boundary, 'SessionView');
  assert.equal(sessionMaterializationAudit.rawCredentialAccess, false);
  assert.equal(sessionMaterializationAudit.artifactPersistenceAllowed, false);
  assert.deepEqual(sessionMaterializationAudit.purposeIsolation, {
    enforced: true,
    purpose: 'download',
    scope: ['douyin', 'www.douyin.com', 'download'],
  });
  assert.equal(sessionMaterializationAudit.revocation.boundary, 'SessionProvider');
  assert.equal(sessionMaterializationAudit.revocation.handlePresent, true);
  assert.match(sessionMaterializationAudit.revocation.handleRef, /^rvk-[a-f0-9]{32}$/u);
  assert.doesNotMatch(
    JSON.stringify(sessionMaterializationAudit),
    /synthetic-refresh-token|cookie|authorization|csrf|Bearer|profilePath|browserProfileRoot|userDataDir/iu,
  );
  const sessionMaterializationRedactionAudit = JSON.parse(
    await readFile(persisted.artifacts.sessionViewMaterializationRedactionAudit, 'utf8'),
  );
  assert.equal(JSON.stringify(sessionMaterializationRedactionAudit).includes('synthetic-refresh-token'), false);
  assert.deepEqual(sessionMaterializationRedactionAudit.findings, []);
  assert.equal(typeof persisted.artifacts.lifecycleEvent, 'string');
  assert.equal(typeof persisted.artifacts.lifecycleEventRedactionAudit, 'string');
  const lifecycleEvent = JSON.parse(await readFile(persisted.artifacts.lifecycleEvent, 'utf8'));
  assert.equal(lifecycleEvent.schemaVersion, LIFECYCLE_EVENT_SCHEMA_VERSION);
  assert.equal(assertSchemaCompatible('LifecycleEvent', lifecycleEvent), true);
  assert.equal(lifecycleEvent.eventType, 'session.run.completed');
  assert.equal(lifecycleEvent.traceId, persisted.runId);
  assert.equal(lifecycleEvent.correlationId, persisted.planId);
  assert.equal(lifecycleEvent.taskId, persisted.runId);
  assert.equal(lifecycleEvent.siteKey, 'douyin');
  assert.equal(lifecycleEvent.taskType, 'session-health');
  assert.equal(Object.hasOwn(lifecycleEvent, 'adapterVersion'), false);
  assert.equal(lifecycleEvent.reasonCode, 'session-invalid');
  assert.equal(assertLifecycleEventObservabilityFields(lifecycleEvent, {
    requiredFields: [
      'traceId',
      'correlationId',
      'taskId',
      'siteKey',
      'taskType',
      'reasonCode',
    ],
    requiredDetailFields: [
      'profileRef',
      'sessionMaterialization',
      'riskSignals',
      'riskState',
      'riskState.transition',
      'riskState.recovery',
      'capabilityHookMatches',
    ],
  }), true);
  assert.equal(lifecycleEvent.details.profileRef, 'anonymous');
  assert.equal(lifecycleEvent.details.sessionMaterialization, REDACTION_PLACEHOLDER);
  assert.deepEqual(lifecycleEvent.details.riskSignals, [REDACTION_PLACEHOLDER]);
  assert.equal(lifecycleEvent.details.riskState.state, 'auth_expired');
  assert.equal(lifecycleEvent.details.riskState.reasonCode, 'session-invalid');
  assert.equal(lifecycleEvent.details.riskState.transition.from, 'normal');
  assert.equal(lifecycleEvent.details.riskState.transition.to, 'auth_expired');
  assert.equal(lifecycleEvent.details.riskState.recovery.retryable, true);
  assert.equal(lifecycleEvent.details.riskState.recovery.manualRecoveryNeeded, true);
  assert.equal(lifecycleEvent.details.riskState.recovery.artifactWriteAllowed, true);
  assert.deepEqual(lifecycleEvent.details.capabilityHookMatches.phases, [
    'after_session_materialize',
    'on_manual_recovery_required',
    'on_completion',
  ]);
  assert.equal(lifecycleEvent.details.capabilityHookMatches.matchCount, 1);
  assert.equal(
    lifecycleEvent.details.capabilityHookMatches.matches[0].id,
    'session-run-completed-observer',
  );
  assert.equal(
    Object.hasOwn(lifecycleEvent.details.capabilityHookMatches.matches[0].subscriber, 'modulePath'),
    false,
  );
  assert.equal(
    Object.hasOwn(lifecycleEvent.details.capabilityHookMatches.matches[0].subscriber, 'entrypoint'),
    false,
  );
  assert.doesNotMatch(
    JSON.stringify(lifecycleEvent),
    /synthetic-refresh-token|cookie|authorization|csrf|Bearer|profilePath|browserProfileRoot|userDataDir/iu,
  );
  const lifecycleAudit = JSON.parse(await readFile(persisted.artifacts.lifecycleEventRedactionAudit, 'utf8'));
  assert.equal(JSON.stringify(lifecycleAudit).includes('synthetic-refresh-token'), false);
  assert.equal(lifecycleAudit.redactedPaths.includes('details.riskSignals.0'), true);
  assert.deepEqual(lifecycleAudit.findings, [{
    path: 'details.riskSignals.0',
    pattern: 'sensitive-query-assignment',
  }]);
  assert.deepEqual(result.manifest.health.riskSignals, [syntheticRiskSignal]);
});

test('session health treats verified reusable profile as recovered from historical crash marker', async () => {
  const health = await inspectSessionHealth('bilibili', {
    host: 'www.bilibili.com',
    profile: {
      host: 'www.bilibili.com',
      authSession: {
        reuseLoginStateByDefault: true,
      },
    },
    sessionRequirement: 'optional',
    now: new Date('2026-04-30T13:13:00.000Z'),
  }, {
    inspectReusableSiteSession: async () => ({
      authAvailable: false,
      reusableProfile: false,
      userDataDir: 'C:/private/bilibili-profile',
      reuseLoginState: true,
      profileHealth: {
        exists: true,
        healthy: false,
        usableForCookies: true,
        warnings: ['Persistent browser profile last exit type was Crashed.'],
      },
      authSessionStateSummary: {
        lastHealthyAt: '2026-04-30T13:12:42.831Z',
        lastSessionReuseVerifiedAt: '2026-04-30T13:12:42.831Z',
        nextSuggestedKeepaliveAt: '2026-04-30T15:12:42.831Z',
        keepaliveDue: false,
      },
    }),
    prepareSiteSessionGovernance: async () => ({
      policyDecision: {
        allowed: false,
        riskCauseCode: 'profile-health-risk',
        riskAction: 'rebuild-profile',
      },
      networkDrift: {
        driftDetected: false,
        reasons: [],
      },
      authSessionSummary: {
        lastHealthyAt: '2026-04-30T13:12:42.831Z',
        lastSessionReuseVerifiedAt: '2026-04-30T13:12:42.831Z',
        nextSuggestedKeepaliveAt: '2026-04-30T15:12:42.831Z',
        keepaliveDue: false,
      },
      lease: {
        leaseId: 'lease-recovered-profile-health',
      },
    }),
    releaseGovernanceSessionLease: async () => {},
  });

  assert.equal(health.status, 'ready');
  assert.equal(health.reason, undefined);
  assert.equal(health.repairPlan, undefined);
  assert.deepEqual(health.riskSignals, ['profile-health-recovered-after-session-reuse']);
});

test('session health does not let stale healthy timestamps bypass explicit crashed profile lifecycle', async () => {
  const health = await inspectSessionHealth('bilibili', {
    host: 'www.bilibili.com',
    profile: {
      host: 'www.bilibili.com',
      authSession: {
        reuseLoginStateByDefault: true,
      },
    },
    sessionRequirement: 'optional',
    now: new Date('2026-04-30T13:13:00.000Z'),
  }, {
    inspectReusableSiteSession: async () => ({
      authAvailable: false,
      reusableProfile: false,
      userDataDir: 'C:/private/bilibili-profile',
      reuseLoginState: true,
      profileHealth: {
        exists: true,
        healthy: false,
        usableForCookies: true,
        profileLifecycle: 'crashed',
        requiresProfileRebuild: true,
        warnings: ['Persistent browser profile last exit type was Crashed.'],
      },
      authSessionStateSummary: {
        lastHealthyAt: '2026-04-30T13:12:42.831Z',
        lastSessionReuseVerifiedAt: '2026-04-30T13:12:42.831Z',
        nextSuggestedKeepaliveAt: '2026-04-30T15:12:42.831Z',
        keepaliveDue: false,
      },
    }),
    prepareSiteSessionGovernance: async () => ({
      policyDecision: {
        allowed: false,
        riskCauseCode: 'profile-health-risk',
        riskAction: 'rebuild-profile',
      },
      networkDrift: {
        driftDetected: false,
        reasons: [],
      },
      authSessionSummary: {
        lastHealthyAt: '2026-04-30T13:12:42.831Z',
        lastSessionReuseVerifiedAt: '2026-04-30T13:12:42.831Z',
        nextSuggestedKeepaliveAt: '2026-04-30T15:12:42.831Z',
        keepaliveDue: false,
      },
      lease: {
        leaseId: 'lease-crashed-profile-health',
      },
    }),
    releaseGovernanceSessionLease: async () => {},
  });

  assert.equal(health.status, 'manual-required');
  assert.equal(health.reason, 'profile-health-risk');
  assert.equal(health.repairPlan.action, 'rebuild-profile');
  assert.equal(health.riskSignals.includes('profile-health-recovered-after-session-reuse'), false);
});

test('session health accepts explicit crashed profile lifecycle only when reuse verification is newer than profile snapshot', async () => {
  const health = await inspectSessionHealth('bilibili', {
    host: 'www.bilibili.com',
    profile: {
      host: 'www.bilibili.com',
      authSession: {
        reuseLoginStateByDefault: true,
      },
    },
    sessionRequirement: 'optional',
    now: new Date('2026-04-30T13:13:00.000Z'),
  }, {
    inspectReusableSiteSession: async () => ({
      authAvailable: false,
      reusableProfile: false,
      userDataDir: 'C:/private/bilibili-profile',
      reuseLoginState: true,
      profileHealth: {
        exists: true,
        healthy: false,
        usableForCookies: true,
        profileLifecycle: 'crashed',
        requiresProfileRebuild: true,
        warnings: ['Persistent browser profile last exit type was Crashed.'],
        snapshots: [{
          mtimeMs: Date.parse('2026-04-30T13:12:40.000Z'),
        }],
      },
      authSessionStateSummary: {
        lastHealthyAt: '2026-04-30T13:12:42.831Z',
        lastSessionReuseVerifiedAt: '2026-04-30T13:12:42.831Z',
        nextSuggestedKeepaliveAt: '2026-04-30T15:12:42.831Z',
        keepaliveDue: false,
      },
    }),
    prepareSiteSessionGovernance: async () => ({
      policyDecision: {
        allowed: false,
        riskCauseCode: 'profile-health-risk',
        riskAction: 'rebuild-profile',
      },
      networkDrift: {
        driftDetected: false,
        reasons: [],
      },
      authSessionSummary: {
        lastHealthyAt: '2026-04-30T13:12:42.831Z',
        lastSessionReuseVerifiedAt: '2026-04-30T13:12:42.831Z',
        nextSuggestedKeepaliveAt: '2026-04-30T15:12:42.831Z',
        keepaliveDue: false,
      },
      lease: {
        leaseId: 'lease-crashed-profile-health-recovered-after-snapshot',
      },
    }),
    releaseGovernanceSessionLease: async () => {},
  });

  assert.equal(health.status, 'ready');
  assert.equal(health.reason, undefined);
  assert.equal(health.repairPlan, undefined);
  assert.deepEqual(health.riskSignals, ['profile-health-recovered-after-session-reuse']);
});

test('session health does not let stale healthy timestamps bypass uninitialized profile login repair', async () => {
  const health = await inspectSessionHealth('x', {
    host: 'x.com',
    profile: {
      host: 'x.com',
      authSession: {
        reuseLoginStateByDefault: true,
      },
    },
    sessionRequirement: 'required',
    now: new Date('2026-04-30T13:13:00.000Z'),
  }, {
    inspectReusableSiteSession: async () => ({
      authAvailable: false,
      reusableProfile: false,
      userDataDir: 'C:/private/x-profile',
      reuseLoginState: true,
      profileHealth: {
        exists: true,
        healthy: false,
        usableForCookies: false,
        profileLifecycle: 'uninitialized',
        warnings: ['Persistent browser profile is missing expected paths.'],
      },
      authSessionStateSummary: {
        lastHealthyAt: '2026-04-30T13:12:42.831Z',
        lastSessionReuseVerifiedAt: '2026-04-30T13:12:42.831Z',
        nextSuggestedKeepaliveAt: '2026-04-30T15:12:42.831Z',
        keepaliveDue: false,
      },
    }),
    prepareSiteSessionGovernance: async () => ({
      policyDecision: {
        allowed: true,
        riskCauseCode: null,
        riskAction: null,
      },
      networkDrift: {
        driftDetected: false,
        reasons: [],
      },
      authSessionSummary: {
        lastHealthyAt: '2026-04-30T13:12:42.831Z',
        lastSessionReuseVerifiedAt: '2026-04-30T13:12:42.831Z',
        nextSuggestedKeepaliveAt: '2026-04-30T15:12:42.831Z',
        keepaliveDue: false,
      },
      lease: {
        leaseId: 'lease-uninitialized-profile-health',
      },
    }),
    releaseGovernanceSessionLease: async () => {},
  });

  assert.equal(health.status, 'manual-required');
  assert.equal(health.reason, 'profile-uninitialized');
  assert.equal(health.repairPlan.action, 'site-login');
  assert.equal(health.riskSignals.includes('profile-health-recovered-after-session-reuse'), false);
});

test('session CLI prints JSON and writes manifest under runs/session layout', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-cli-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  let output = '';

  const result = await main([
    'health',
    '--site', 'bilibili',
    '--purpose', 'download',
    '--out-dir', runRoot,
    '--status', 'expired',
    '--reason', 'network-identity-drift',
    '--json',
  ], {
    stdout: {
      write(chunk) {
        output += chunk;
      },
    },
  });

  const parsed = JSON.parse(output);
  assert.equal(result.manifest.status, 'expired');
  assert.equal(parsed.repairPlan.action, 'site-keepalive');
  assert.equal(path.basename(parsed.artifacts.manifest), 'manifest.json');
  assert.equal(parsed.artifacts.runDir.includes(`${path.sep}bilibili${path.sep}`), true);
  const persisted = JSON.parse(await readFile(parsed.artifacts.manifest, 'utf8'));
  assert.equal(persisted.status, 'expired');
});

test('session CLI text output includes repair command guidance', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-cli-text-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  let output = '';

  await main([
    'plan-repair',
    '--site', 'douyin',
    '--purpose', 'download',
    '--out-dir', runRoot,
    '--session-required',
    '--status', 'manual-required',
    '--reason', 'session-invalid',
  ], {
    stdout: {
      write(chunk) {
        output += chunk;
      },
    },
  });

  assert.match(output, /Repair action: site-login/u);
  assert.match(output, /Repair command: site-login/u);
  assert.match(output, /Repair requires approval: true/u);
});

test('session manifest bridge maps health into legacy session options without secrets', () => {
  const manifest = normalizeSessionRunManifest({
    plan: {
      siteKey: 'x',
      host: 'x.com',
      purpose: 'archive',
      sessionRequirement: 'required',
      profilePath: 'C:/redacted/synthetic-bridge-profile-path',
      browserProfileRoot: 'C:/redacted/synthetic-bridge-profile-root',
      userDataDir: 'C:/redacted/synthetic-bridge-user-data-dir',
    },
    health: {
      status: 'manual-required',
      reason: 'session-invalid',
      riskSignals: ['session-invalid'],
      cookies: [{ name: 'sid', value: 'synthetic-cookie' }],
      headers: { authorization: 'Bearer syntheticHeaderToken' },
      csrf: 'synthetic-csrf-token',
      token: 'synthetic-token',
    },
    repairPlan: {
      action: 'site-login',
      command: 'site-login',
      reason: 'session-invalid',
    },
    artifacts: {
      manifest: 'C:/tmp/session/manifest.json',
      runDir: 'C:/tmp/session',
    },
  });

  const summary = summarizeSessionRunManifest(manifest);
  const options = sessionOptionsFromRunManifest(manifest, { siteKey: 'x', host: 'x.com' });
  const sessionView = sessionViewFromRunManifest(manifest, { siteKey: 'x', host: 'x.com' });
  const sessionViewMaterializationAudit = sessionViewMaterializationAuditFromRunManifest(
    manifest,
    { siteKey: 'x', host: 'x.com' },
  );

  assert.equal(summary.healthStatus, 'manual-required');
  assert.equal(manifest.plan.profilePathPresent, true);
  assert.equal(manifest.plan.browserProfileRootPresent, true);
  assert.equal(manifest.plan.userDataDirPresent, true);
  assert.equal(options.sessionStatus, 'manual-required');
  assert.equal(options.sessionReason, 'session-invalid');
  assert.deepEqual(options.riskSignals, ['session-invalid']);
  assert.equal(options.sessionHealthManifest.repairPlan.action, 'site-login');
  assert.deepEqual(options.sessionView, sessionView);
  assert.deepEqual(options.sessionViewMaterializationAudit, sessionViewMaterializationAudit);
  assert.equal(options.sessionView.schemaVersion, SESSION_VIEW_SCHEMA_VERSION);
  assert.equal(options.sessionView.siteKey, 'x');
  assert.equal(options.sessionView.purpose, 'archive');
  assert.deepEqual(options.sessionView.scope, ['x', 'x.com', 'archive']);
  assert.equal(options.sessionView.profileRef, 'anonymous');
  assert.deepEqual(options.sessionView.permission, []);
  assert.equal(options.sessionView.status, 'manual-required');
  assert.equal(options.sessionView.reasonCode, 'session-invalid');
  assert.deepEqual(options.sessionView.networkContext, { host: 'x.com' });
  assert.equal(Object.hasOwn(options.sessionView, 'profilePath'), false);
  assert.equal(Object.hasOwn(options.sessionView, 'browserProfileRoot'), false);
  assert.equal(Object.hasOwn(options.sessionView, 'userDataDir'), false);
  assert.doesNotMatch(
    JSON.stringify(options.sessionView),
    /synthetic-|cookie|headers|authorization|csrf|token|Bearer|profilePath|browserProfileRoot|userDataDir/iu,
  );
  assert.equal(
    options.sessionViewMaterializationAudit.schemaVersion,
    SESSION_VIEW_MATERIALIZATION_AUDIT_SCHEMA_VERSION,
  );
  assert.equal(options.sessionViewMaterializationAudit.sessionViewSchemaVersion, SESSION_VIEW_SCHEMA_VERSION);
  assert.equal(options.sessionViewMaterializationAudit.eventType, 'session.materialized');
  assert.equal(options.sessionViewMaterializationAudit.boundary, 'SessionView');
  assert.equal(options.sessionViewMaterializationAudit.siteKey, 'x');
  assert.equal(options.sessionViewMaterializationAudit.profileRef, 'anonymous');
  assert.equal(options.sessionViewMaterializationAudit.purpose, 'archive');
  assert.deepEqual(options.sessionViewMaterializationAudit.scope, ['x', 'x.com', 'archive']);
  assert.deepEqual(options.sessionViewMaterializationAudit.permission, []);
  assert.equal(options.sessionViewMaterializationAudit.status, 'manual-required');
  assert.equal(options.sessionViewMaterializationAudit.reasonCode, 'session-invalid');
  assert.equal(options.sessionViewMaterializationAudit.rawCredentialAccess, false);
  assert.equal(options.sessionViewMaterializationAudit.artifactPersistenceAllowed, false);
  assert.deepEqual(options.sessionViewMaterializationAudit.purposeIsolation, {
    enforced: true,
    purpose: 'archive',
    scope: ['x', 'x.com', 'archive'],
  });
  assert.deepEqual(options.sessionViewMaterializationAudit.revocation, {
    boundary: 'SessionProvider',
    handlePresent: false,
    reasonCode: 'session-revocation-handle-missing',
  });
  assert.doesNotMatch(
    JSON.stringify(options.sessionViewMaterializationAudit),
    /synthetic-|cookie|headers|authorization|csrf|token|Bearer|profilePath|browserProfileRoot|userDataDir/iu,
  );
  for (const crossing of [summary, options.sessionHealthManifest, options]) {
    assert.equal(assertSessionBoundaryCrossingSafe(crossing), true);
    assert.doesNotMatch(
      JSON.stringify(crossing),
      /synthetic-bridge-|synthetic-cookie|syntheticHeaderToken|synthetic-csrf-token|synthetic-token|cookies|headers|authorization|csrf|profilePath|browserProfileRoot|userDataDir/iu,
    );
  }
  assert.throws(
    () => assertSessionBoundaryCrossingSafe({
      sessionView: {
        siteKey: 'x',
        userDataDir: 'C:/redacted/synthetic-bridge-user-data-dir',
      },
    }),
    /must not expose raw session\/profile key: userDataDir/u,
  );
});

test('site-doctor parser accepts unified session manifest input', () => {
  const parsed = parseSiteDoctorArgs([
    'https://x.com/home',
    '--profile-path',
    'profiles/x.com.json',
    '--session-manifest',
    'runs/session/x/manifest.json',
  ]);

  assert.equal(parsed.inputUrl, 'https://x.com/home');
  assert.equal(parsed.options.profilePath, 'profiles/x.com.json');
  assert.equal(parsed.options.sessionManifest, 'runs/session/x/manifest.json');
});

test('site-doctor parser accepts generated unified session health plans', () => {
  const parsed = parseSiteDoctorArgs([
    'https://x.com/home',
    '--profile-path',
    'profiles/x.com.json',
    '--session-health-plan',
  ]);

  assert.equal(parsed.options.useUnifiedSessionHealth, true);
});

test('site-doctor parser defaults to unified session health and keeps legacy opt-out', () => {
  const defaultParsed = parseSiteDoctorArgs([
    'https://x.com/home',
    '--profile-path',
    'profiles/x.com.json',
  ]);
  const legacyParsed = parseSiteDoctorArgs([
    'https://x.com/home',
    '--profile-path',
    'profiles/x.com.json',
    '--no-session-health-plan',
  ]);

  assert.equal(defaultParsed.options.useUnifiedSessionHealth, true);
  assert.equal(legacyParsed.options.useUnifiedSessionHealth, false);
});

test('site-doctor can generate unified session health before legacy probes', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-session-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  let sessionHealthRequested = false;

  const report = await siteDoctor('https://x.com/home', {
    outDir: runRoot,
    profilePath: path.join(runRoot, 'x.com.json'),
    useUnifiedSessionHealth: true,
  }, {
    pathExists: async () => true,
    validateProfileFile: async (profilePath) => ({
      filePath: profilePath,
      schemaId: 'test-profile',
      warnings: [],
      profile: {
        host: 'x.com',
        archetype: 'navigation-catalog',
        validationSamples: {},
        search: { knownQueries: [] },
      },
    }),
    runSessionTask: async () => {
      sessionHealthRequested = true;
      return {
        manifest: normalizeSessionRunManifest({
          plan: {
            siteKey: 'x',
            host: 'x.com',
            purpose: 'doctor',
            sessionRequirement: 'required',
          },
          health: {
            status: 'manual-required',
            reason: 'session-invalid',
          },
          repairPlan: {
            action: 'site-login',
            command: 'site-login',
            reason: 'session-invalid',
          },
          artifacts: {
            manifest: path.join(runRoot, 'session-health', 'manifest.json'),
            runDir: path.join(runRoot, 'session-health'),
          },
        }),
      };
    },
    resolveSite: async () => ({
      host: 'x.com',
      siteContext: { siteKey: 'x' },
      adapter: { id: 'x' },
    }),
    ensureCrawlerScript: async () => ({
      status: 'skipped',
      scriptPath: null,
      metaPath: null,
    }),
    capture: async () => ({
      status: 'failed',
      error: { message: 'offline fixture capture skipped' },
      files: {},
    }),
  });

  assert.equal(sessionHealthRequested, true);
  assert.equal(report.sessionProvider, 'unified-session-runner');
  assert.equal(report.sessionHealth.healthStatus, 'manual-required');
  assert.equal(report.sessionHealth.repairPlan.action, 'site-login');
});

test('download release gate documents unified session manifest traceability', async () => {
  const releaseGate = await readFile(path.join(process.cwd(), 'CONTRIBUTING.md'), 'utf8');

  assert.match(releaseGate, /Session Manifest Gate/u);
  assert.match(releaseGate, /unified-session-runner/u);
  assert.match(releaseGate, /legacy-session-provider/u);
  assert.match(releaseGate, /--session-health-plan/u);
  assert.match(releaseGate, /--session-manifest <path>/u);
  assert.match(releaseGate, /scripts\/download-release-audit\.mjs/u);
  assert.match(releaseGate, /Blocked audit rows include a `repairPlan` guidance object/u);
  assert.match(releaseGate, /Repair Plan/u);
  assert.match(releaseGate, /Next session repair command/u);
  assert.match(releaseGate, /src\/entrypoints\/cli\.mjs site repair-plan --site/u);
  assert.match(releaseGate, /Offline only; no live\/login\/download side effects/u);
  assert.match(releaseGate, /Current Local Evidence/u);
  assert.match(releaseGate, /clean worktree\s+verified before evidence capture/u);
  assert.match(releaseGate, /Re-check the current ahead count before\s+any publication step/u);
  assert.match(releaseGate, /node --test tests\\node\\\*\.test\.mjs/u);
  assert.match(releaseGate, /python -m unittest discover -s tests\\python -p "test_\*\.py"/u);
  assert.match(releaseGate, /Hybrid native status is not a live-capability claim/u);
  assert.match(releaseGate, /Current closeout verification/u);
});

test('release and versioning policy documents scope compatibility and publication boundaries', async () => {
  const contributing = await readFile(path.join(process.cwd(), 'CONTRIBUTING.md'), 'utf8');
  const readme = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');

  assert.match(contributing, /Release And Versioning Policy/u);
  assert.match(contributing, /Release scope is the set of source, tests, config, schema, repo-local skills,\s+tools, and root-document edits/u);
  assert.match(contributing, /git status --short --branch --untracked-files=all/u);
  assert.match(contributing, /browser profile material, downloaded media, logs, generated run artifacts, raw\s+session material, and unrelated dirty files are excluded/u);
  assert.match(contributing, /Contract versions are governed by compatibility evidence/u);
  assert.match(contributing, /Additive compatible\s+fields keep the current schema or artifact version/u);
  assert.match(contributing, /Incompatible persisted or public contract changes require\s+an explicit version bump/u);
  assert.match(contributing, /schema inventory or compatibility registry updates/u);
  assert.match(contributing, /Agent B acceptance/u);
  assert.match(contributing, /Passing local validation does not imply a tag, package version bump, push, PR,\s+publication, live capability claim, or live authenticated validation/u);
  assert.match(contributing, /node tools\\prepublish-secret-scan\.mjs/u);
  assert.match(contributing, /live claims additionally require explicit approval,\s+bounded scope, stop conditions, and sanitized artifacts/u);

  assert.match(readme, /- \[x\] Add clearer release\/versioning policy/u);
  assert.match(readme, /## Release And Versioning/u);
  assert.match(readme, /Release readiness is evidence-based, not date-based/u);
  assert.match(readme, /No tag, package version bump, push, PR, publication, live capability claim, or\s+live authenticated validation is implied by local tests passing/u);
});

test('download runner docs describe hybrid native migration without live claims', async () => {
  const runnerDoc = await readFile(path.join(process.cwd(), 'CONTRIBUTING.md'), 'utf8');

  assert.match(runnerDoc, /`bilibili` \| `www\.bilibili\.com` \| Hybrid native \+ legacy fallback/u);
  assert.match(runnerDoc, /`douyin` \| `www\.douyin\.com` \| Hybrid native \+ legacy fallback/u);
  assert.match(runnerDoc, /`xiaohongshu` \| `www\.xiaohongshu\.com` \| Hybrid native \+ legacy fallback/u);
  assert.match(runnerDoc, /`x` \| `x\.com` \| Hybrid native \+ legacy fallback/u);
  assert.match(runnerDoc, /`instagram` \| `www\.instagram\.com` \| Hybrid native \+ legacy fallback/u);
  assert.match(runnerDoc, /Hybrid native status is not a live-capability claim/u);
  assert.match(runnerDoc, /live smoke, real login, and real download validation remain/u);
});

test('legacy reduction matrix preserves fallback and live-claim guardrails', async () => {
  const matrix = await readFile(path.join(process.cwd(), 'CONTRIBUTING.md'), 'utf8');

  assert.match(matrix, /Current policy: do not delete or bypass legacy fallback paths/u);
  assert.match(matrix, /Bilibili .* Native .*native-bilibili-page-seeds/u);
  assert.match(matrix, /Douyin .* Native .*native-douyin-resource-seeds/u);
  assert.match(matrix, /Xiaohongshu .* Native .*native-xiaohongshu-resource-seeds/u);
  assert.match(matrix, /X .* Native .*native-x-social-resource-seeds/u);
  assert.match(matrix, /Instagram .* Native .*native-instagram-social-resource-seeds/u);
  assert.match(matrix, /X .* Relation, followed-date, follower\/following, checkpoint, resume, or cursor discovery inputs\. \| Legacy/u);
  assert.match(matrix, /Instagram .* Relation, follower\/following, followed-users, checkpoint, resume, or authenticated feed discovery inputs\. \| Legacy/u);
  assert.match(matrix, /does not prove live crawling/u);
  assert.match(matrix, /authenticated social archive capability/u);
  assert.match(matrix, /safe fallback removal/u);
});

test('download runner next steps keep work on local main without new branches', async () => {
  const nextSteps = await readFile(path.join(process.cwd(), 'CONTRIBUTING.md'), 'utf8');

  assert.match(nextSteps, /continues\s+on local `main` in the current project directory/u);
  assert.match(nextSteps, /Do not create new branches or\s+extra worktrees unless the operator explicitly asks/u);
  assert.match(nextSteps, /Local Main Workstreams/u);
  assert.match(nextSteps, /1\. Native resolvers/u);
  assert.match(nextSteps, /2\. Legacy reduction/u);
  assert.match(nextSteps, /3\. Session governance/u);
  assert.doesNotMatch(nextSteps, /## Branch Plan/u);
  assert.doesNotMatch(nextSteps, /codex\/download-native-resolvers/u);
});

test('authenticated release gate blocks missing session traceability', () => {
  assert.deepEqual(evaluateAuthenticatedSessionReleaseGate({
    plan: { sessionRequirement: 'required' },
  }), {
    ok: false,
    status: 'blocked',
    reason: 'session-provider-missing',
    requiresAuth: true,
    provider: null,
    healthManifest: null,
  });

  assert.equal(evaluateAuthenticatedSessionReleaseGate({
    plan: { sessionRequirement: 'required' },
    sessionProvider: 'unified-session-runner',
  }).reason, 'session-health-manifest-missing');
  assert.equal(evaluateAuthenticatedSessionReleaseGate({
    plan: { sessionRequirement: 'required' },
    sessionProvider: 'legacy-session-provider',
  }).ok, true);
  assert.deepEqual(evaluateAuthenticatedSessionReleaseGate({
    plan: { sessionRequirement: 'required' },
    sessionProvider: 'unified-session-runner',
    sessionHealth: {
      healthStatus: 'ready',
      artifacts: { manifest: 'runs/session/x/manifest.json' },
    },
  }), {
    ok: true,
    status: 'passed',
    reason: 'unified-session-health-manifest',
    requiresAuth: true,
    provider: 'unified-session-runner',
    healthManifest: 'runs/session/x/manifest.json',
  });
  assert.deepEqual(evaluateAuthenticatedSessionReleaseGate({
    plan: { sessionRequirement: 'required' },
    sessionProvider: 'unified-session-runner',
    sessionHealth: {
      healthStatus: 'blocked',
      reason: 'session-invalid',
      artifacts: { manifest: 'runs/session/x/manifest.json' },
    },
  }), {
    ok: false,
    status: 'blocked',
    reason: 'session-invalid',
    requiresAuth: true,
    provider: 'unified-session-runner',
    healthManifest: 'runs/session/x/manifest.json',
  });
});
