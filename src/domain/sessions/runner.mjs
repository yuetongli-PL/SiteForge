// @ts-check

import { createHash } from 'node:crypto';
import path from 'node:path';

import { writeTextFile } from '../../infra/io.mjs';
import {
  composeLifecycleSubscribers,
  createLifecycleArtifactWriterSubscriber,
  dispatchLifecycleEvent,
  normalizeLifecycleEvent,
} from '../lifecycle/lifecycle-events.mjs';
import { normalizeRiskTransition } from '../risks/risk-state.mjs';
import { matchCapabilityHooksForLifecycleEvent } from '../lifecycle/capability-hook.mjs';
import { assertSchemaCompatible } from '../schemas/compatibility-registry.mjs';
import { prepareRedactedArtifactJsonWithAudit } from './security-guard.mjs';
import { SiteHealthRecoveryEngine } from '../risks/site-health-recovery.mjs';
import {
  buildSessionRepairPlan,
  inspectSessionHealth,
} from './session-manager.mjs';
import {
  assertManifestIsSanitized,
  createSessionFailureError,
  defaultSessionRunDir,
  normalizeSessionHealth,
  normalizeSessionPlan,
  normalizeSessionRunManifest,
  SESSION_REVOCATION_FAILURE_REASON_CODE,
  sessionRunStatusFromHealth,
} from './contracts.mjs';
import {
  createSessionRevocationStore,
  registerSessionRevocationHandle,
} from './session-view.mjs';
import {
  sessionViewFromRunManifest,
  sessionViewMaterializationAuditFromRunManifest,
} from './manifest-bridge.mjs';
import { resolveSessionSiteDefinition } from './site-modules.mjs';

/** @param {Record<string, any>} [request] */
function requestSessionRequirement(request = {}) {
  if (request.sessionRequired === true) {
    return 'required';
  }
  if (request.sessionOptional === true) {
    return 'optional';
  }
  if (request.sessionNone === true) {
    return 'none';
  }
  return request.sessionRequirement ?? 'optional';
}

/** @param {Record<string, any>} [request] */
function injectedHealth(request = {}, plan = {}) {
  if (!request.status && !request.reason && !request.riskCauseCode && !request.riskSignals?.length) {
    return null;
  }
  return normalizeSessionHealth({
    siteKey: plan.siteKey,
    host: plan.host,
    status: request.status ?? 'blocked',
    reason: request.reason ?? request.riskCauseCode ?? request.status ?? 'blocked',
    riskCauseCode: request.riskCauseCode,
    riskSignals: request.riskSignals ?? [],
    authStatus: request.authStatus,
    identityConfirmed: request.identityConfirmed,
  });
}

function normalizeLifecycleText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

/** @param {Record<string, any>} [manifest] */
function sessionLifecycleContext(manifest = {}) {
  const traceId = normalizeLifecycleText(manifest.runId);
  return {
    traceId,
    correlationId: normalizeLifecycleText(manifest.planId ?? traceId),
    taskType: normalizeLifecycleText(manifest.taskType ?? 'session-health'),
    adapterVersion: normalizeLifecycleText(manifest.adapterVersion),
  };
}

/**
 * @param {Record<string, any>} lifecycleEvent
 * @param {Record<string, any>} options
 */
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

/** @param {Record<string, any>} [manifest] */
function revocationHandleForSessionMaterialization(manifest = {}) {
  const digest = createHash('sha256')
    .update(JSON.stringify({
      runId: manifest.runId,
      planId: manifest.planId,
      siteKey: manifest.siteKey,
      host: manifest.host,
      purpose: manifest.purpose,
    }))
    .digest('hex')
    .slice(0, 32);
  return `rvk-${digest}`;
}

/** @param {Record<string, any>} [manifest] */
function sessionMaterializationRevocationContext(manifest = {}, options = {}, deps = {}) {
  const now = deps.now instanceof Date ? deps.now : new Date();
  const revocationStore = deps.sessionRevocationStore
    ?? options.sessionRevocationStore
    ?? createSessionRevocationStore({ now });
  const explicitHandle = normalizeLifecycleText(
    deps.revocationHandleRef ?? deps.revocationHandle ?? options.revocationHandleRef ?? options.revocationHandle,
  );
  const revocationHandleRef = explicitHandle ?? revocationHandleForSessionMaterialization(manifest);
  if (!explicitHandle) {
    registerSessionRevocationHandle(revocationStore, {
      revocationHandleRef,
      ttlSeconds: 300,
    }, { now });
  }
  return {
    revocationStore,
    revocationHandleRef,
    now,
  };
}

/** @param {Record<string, any>} [manifest] */
function sessionViewMaterializationAuditForRun(manifest = {}, expected = {}, context = {}) {
  try {
    return sessionViewMaterializationAuditFromRunManifest(manifest, expected, context);
  } catch (error) {
    if (/revocation handle/iu.test(String(error?.message ?? ''))) {
      // @ts-ignore
      throw createSessionFailureError(`Session materialization failed: ${error.message}`, {
        cause: error,
        reasonCode: SESSION_REVOCATION_FAILURE_REASON_CODE,
      });
    }
    throw error;
  }
}

/**
 * @param {Record<string, any>} [manifest]
 * @param {Record<string, any>} options
 */
function sessionRiskStateForReason(manifest = {}, {
  reasonCode = manifest.reason,
  state,
  scope = 'session',
  observedAt = manifest.finishedAt,
} = {}) {
  const normalizedReason = normalizeLifecycleText(reasonCode);
  if (!normalizedReason) {
    return undefined;
  }
  const requestedState = state ?? {
    'session-invalid': 'auth_expired',
    'session-revocation-invalid': 'manual_recovery_required',
  }[normalizedReason];
  if (!requestedState) {
    return undefined;
  }
  return normalizeRiskTransition({
    from: 'normal',
    state: requestedState,
    reasonCode: normalizedReason,
    siteKey: manifest.siteKey,
    taskId: manifest.runId,
    scope,
    observedAt,
  });
}

function isNonBlockingSessionHealthSignal(signal) {
  return signal === 'profile-health-recovered-after-session-reuse'
    || signal === 'auth-session-state-reuse-verified';
}

/** @param {Record<string, any>} [plan] */
async function createSessionHealthRecovery(plan = {}, health = {}, deps = {}) {
  const rawSignals = [
    health.riskCauseCode,
    health.reason,
    ...(Array.isArray(health.riskSignals) ? health.riskSignals : []),
  ].filter(Boolean).filter((signal) => !isNonBlockingSessionHealthSignal(signal));
  const uniqueSignals = [...new Set(rawSignals)];
  const engine = deps.siteHealthRecoveryEngine ?? new SiteHealthRecoveryEngine();
  return await engine.recover({
    siteId: plan.siteKey,
    rawSignals: uniqueSignals.map((rawSignal) => ({
      siteId: plan.siteKey,
      rawSignal,
      affectedCapability: rawSignal === 'profile-health-risk' ? 'profile.read' : 'session.reuse',
      metadata: {
        source: 'session.run.health',
        healthStatus: health.status,
        repairAction: health.repairPlan?.action,
      },
    })),
    capabilities: [
      'session.reuse',
      'profile.read',
    ],
  });
}

function attachSessionRiskState(error, manifest = {}, options = {}) {
  const riskState = sessionRiskStateForReason(manifest, {
    reasonCode: error?.reasonCode,
    state: 'manual_recovery_required',
    scope: 'session-materialization',
    observedAt: options.observedAt,
  });
  if (riskState && error && typeof error === 'object') {
    error.riskState = riskState;
  }
  return riskState;
}

/** @param {Record<string, any>} [request] */
export async function createSessionPlan(request = {}, options = {}, deps = {}) {
  const siteDefinition = await resolveSessionSiteDefinition(request, options, deps);
  return normalizeSessionPlan({
    siteKey: siteDefinition.siteKey,
    host: siteDefinition.host,
    purpose: request.purpose ?? 'health-check',
    sessionRequirement: requestSessionRequirement(request),
    dryRun: true,
    profilePath: request.profilePath ?? siteDefinition.profilePath,
    browserProfileRoot: request.browserProfileRoot,
    userDataDir: request.userDataDir,
    verificationUrl: siteDefinition.verificationUrl,
    keepaliveUrl: siteDefinition.keepaliveUrl,
  });
}

async function inspectHealthForPlan(plan, request = {}, deps = {}) {
  const injected = injectedHealth(request, plan);
  if (injected) {
    return injected;
  }
  const rawHealth = await (deps.inspectSessionHealth ?? inspectSessionHealth)(plan.siteKey, {
    host: plan.host,
    profilePath: plan.profilePath,
    browserProfileRoot: plan.browserProfileRoot,
    userDataDir: plan.userDataDir,
    verificationUrl: plan.verificationUrl,
    purpose: plan.purpose,
    operation: plan.purpose,
    sessionRequirement: plan.sessionRequirement,
  }, deps);
  const health = normalizeSessionHealth(rawHealth, {
    siteKey: plan.siteKey,
    host: plan.host,
  });
  return {
    ...health,
    repairPlan: health.repairPlan ?? buildSessionRepairPlan(health),
  };
}

/** @param {Record<string, any>} [request] */
export async function runSessionTask(request = {}, options = {}, deps = {}) {
  const action = request.action ?? request.command ?? 'health';
  if (!['health', 'plan-repair'].includes(action)) {
    throw new Error(`Unsupported session action: ${action}`);
  }

  const startedAt = new Date().toISOString();
  const plan = await createSessionPlan(request, options, deps);
  const runDir = path.resolve(request.runDir ?? defaultSessionRunDir({
    siteKey: plan.siteKey,
    purpose: plan.purpose,
    outDir: request.outDir ?? options.outDir,
    createdAt: startedAt,
  }));
  const manifestPath = path.join(runDir, 'manifest.json');
  const redactionAuditPath = path.join(runDir, 'redaction-audit.json');
  const sessionViewMaterializationAuditPath = path.join(runDir, 'session-view-materialization-audit.json');
  const sessionViewMaterializationRedactionAuditPath = path.join(
    runDir,
    'session-view-materialization-redaction-audit.json',
  );
  const lifecycleEventPath = path.join(runDir, 'lifecycle-event.json');
  const lifecycleEventRedactionAuditPath = path.join(runDir, 'lifecycle-event-redaction-audit.json');
  const health = await inspectHealthForPlan(plan, request, deps);
  const repairPlan = health.repairPlan ?? buildSessionRepairPlan(health);
  const finishedAt = new Date().toISOString();
  const healthRecovery = await createSessionHealthRecovery(plan, {
    ...health,
    repairPlan,
  }, deps);
  const manifest = assertManifestIsSanitized(normalizeSessionRunManifest({
    plan,
    health,
    repairPlan,
    healthRecovery,
    status: sessionRunStatusFromHealth(health),
    artifacts: {
      manifest: manifestPath,
      redactionAudit: redactionAuditPath,
      sessionViewMaterializationAudit: sessionViewMaterializationAuditPath,
      sessionViewMaterializationRedactionAudit: sessionViewMaterializationRedactionAuditPath,
      lifecycleEvent: lifecycleEventPath,
      lifecycleEventRedactionAudit: lifecycleEventRedactionAuditPath,
      runDir,
    },
    createdAt: startedAt,
    finishedAt,
  }));
  const sessionView = sessionViewFromRunManifest(manifest, {
    siteKey: manifest.siteKey,
    host: manifest.host,
  });
  const sessionRevocationContext = sessionMaterializationRevocationContext(manifest, options, deps);
  let sessionMaterialization;
  try {
    sessionMaterialization = sessionViewMaterializationAuditForRun(manifest, {
      siteKey: manifest.siteKey,
      host: manifest.host,
    }, sessionRevocationContext);
  } catch (error) {
    attachSessionRiskState(error, manifest, { observedAt: finishedAt });
    throw error;
  }

  const lifecycleSubscribers = composeLifecycleSubscribers(
    deps.lifecycleEventSubscribers,
    createLifecycleArtifactWriterSubscriber({
      eventPath: lifecycleEventPath,
      auditPath: lifecycleEventRedactionAuditPath,
    }),
  );
  let lifecycleEvent = normalizeLifecycleEvent({
    eventType: 'session.run.completed',
    ...sessionLifecycleContext(manifest),
    taskId: manifest.runId,
    siteKey: manifest.siteKey,
    reasonCode: manifest.reason,
    createdAt: finishedAt,
    details: {
      status: manifest.status,
      purpose: manifest.purpose,
      profileRef: sessionView.profileRef,
      sessionMaterialization,
      riskSignals: manifest.health.riskSignals,
      riskState: sessionRiskStateForReason(manifest, { observedAt: finishedAt }),
    },
  });
  const capabilityHookMatches = capabilityHookMatchSummaryForLifecycleEvent(lifecycleEvent, {
    capabilityHookRegistry: deps.capabilityHookRegistry,
    capabilityHooks: deps.capabilityHooks,
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
    subscribers: lifecycleSubscribers,
  });

  const {
    json: sessionMaterializationJson,
    auditJson: sessionMaterializationAuditJson,
  } = prepareRedactedArtifactJsonWithAudit(sessionMaterialization);
  await writeTextFile(sessionViewMaterializationAuditPath, sessionMaterializationJson);
  await writeTextFile(sessionViewMaterializationRedactionAuditPath, sessionMaterializationAuditJson);

  const { json, auditJson } = prepareRedactedArtifactJsonWithAudit(manifest);
  await writeTextFile(manifestPath, json);
  await writeTextFile(redactionAuditPath, auditJson);
  return {
    action,
    plan,
    health,
    repairPlan,
    manifest,
    artifacts: manifest.artifacts,
  };
}
