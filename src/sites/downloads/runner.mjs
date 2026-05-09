// @ts-check

import {
  readJsonFile,
  writeJsonFile,
  writeJsonLines,
  writeTextFile,
} from '../../infra/io.mjs';
import { downloadCliCommand } from '../../infra/cli/command-map.mjs';
import {
  createAnonymousSessionLease,
  normalizeDownloadRunManifest,
  normalizeResolvedDownloadTask,
  normalizeSessionLease,
  normalizeSessionLeaseConsumerHeaders,
} from './contracts.mjs';
import {
  buildDownloadRunLayout,
  writeRedactedDownloadJsonArtifact,
} from './artifacts.mjs';
import {
  assertRuntimeDownloadCompatibility,
  executeResolvedDownloadTask,
} from './executor.mjs';
import { executeLegacyDownloadTask } from './legacy-executor.mjs';
import {
  createDownloadPlan,
  resolverDependenciesFromRuntime,
  resolveDownloadResources,
} from './modules.mjs';
import {
  resolveDownloadSiteDefinition,
} from './registry.mjs';
import {
  acquireSessionLease,
  inspectSessionHealth,
  releaseSessionLease,
} from './session-manager.mjs';
import {
  runSessionTask,
} from '../sessions/runner.mjs';
import {
  sessionOptionsFromRunManifest,
} from '../sessions/manifest-bridge.mjs';
import {
  composeLifecycleSubscribers,
  createLifecycleArtifactWriterSubscriber,
  dispatchLifecycleEvent,
  normalizeLifecycleEvent,
} from '../capability/lifecycle-events.mjs';
import { matchCapabilityHooksForLifecycleEvent } from '../capability/capability-hook.mjs';
import { assertSchemaCompatible } from '../capability/compatibility-registry.mjs';
import { isKnownReasonCode } from '../capability/reason-codes.mjs';
import { normalizeRiskTransition } from '../capability/risk-state.mjs';
import { normalizeStandardTaskList } from '../capability/standard-task-list.mjs';
import {
  assertPlannerPolicyRuntimeHandoffCompatibility,
} from '../capability/planner-policy-handoff.mjs';
import {
  assertNoForbiddenPatterns,
  prepareRedactedArtifactJsonWithAudit,
  redactValue,
} from '../capability/security-guard.mjs';
import { renderSessionTraceabilityLines } from './session-report.mjs';

const AUTH_REQUIRED_KEYS = [
  'authRequired',
  'loginRequired',
  'requiresAuth',
  'downloadRequiresAuth',
  'requiresLogin',
];

function isTruthyMarker(value) {
  return value === true || value === 'true' || value === 'required' || value === 'login-required';
}

function objectMarksAuthRequired(value = {}) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return AUTH_REQUIRED_KEYS.some((key) => isTruthyMarker(value[key]))
    || value.sessionRequirement === 'required'
    || value.downloadSessionRequirement === 'required'
    || isTruthyMarker(value.auth?.required)
    || isTruthyMarker(value.login?.required)
    || isTruthyMarker(value.session?.required)
    || value.session?.requirement === 'required';
}

function marksAuthRequired(request = {}, plan = {}) {
  return plan.sessionRequirement === 'required'
    || objectMarksAuthRequired(plan)
    || objectMarksAuthRequired(plan.metadata)
    || objectMarksAuthRequired(plan.metadata?.definition)
    || objectMarksAuthRequired(plan.policy)
    || objectMarksAuthRequired(request)
    || objectMarksAuthRequired(request.download)
    || objectMarksAuthRequired(request.plan)
    || objectMarksAuthRequired(request.session)
    || request.sessionRequirement === 'required';
}

function allowNetworkResolve(request = {}, options = {}) {
  return options.allowNetworkResolve === true
    || options.resolveNetwork === true
    || request.allowNetworkResolve === true
    || request.resolveNetwork === true;
}

function sessionStatus(value = {}) {
  return String(value?.status ?? 'ready').trim() || 'ready';
}

function isSessionReady(value = {}) {
  return sessionStatus(value) === 'ready';
}

function sessionRiskReason(value = {}) {
  return value?.reason
    ?? value?.riskReason
    ?? value?.riskCauseCode
    ?? value?.riskSignals?.find(Boolean)
    ?? sessionStatus(value);
}

function nativeFallbackTrace(resolvedTask = {}) {
  const completeness = resolvedTask?.completeness && typeof resolvedTask.completeness === 'object'
    ? resolvedTask.completeness
    : {};
  const resolver = resolvedTask?.metadata?.resolver && typeof resolvedTask.metadata.resolver === 'object'
    ? resolvedTask.metadata.resolver
    : null;
  const reason = String(completeness.reason ?? '').trim();
  const trace = {
    reason: reason || undefined,
    resolver: resolver
      ? {
        adapterId: resolver.adapterId,
        method: resolver.method,
      }
      : undefined,
    completeness: {
      expectedCount: completeness.expectedCount,
      resolvedCount: completeness.resolvedCount,
      complete: completeness.complete === true,
      reason: reason || undefined,
    },
  };
  if (!trace.reason && !trace.resolver?.adapterId && !trace.resolver?.method) {
    return null;
  }
  return trace;
}

async function loadResumeResolvedTask(plan, options = {}) {
  if (!Boolean(options.resume ?? plan.resume ?? false)) {
    return null;
  }
  const layout = await buildDownloadRunLayout(plan, options);
  try {
    const artifact = await readJsonFile(layout.resolvedTaskPath);
    const normalized = normalizeResolvedDownloadTask(artifact, plan);
    return normalized.resources.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

function standardTaskListFromTerminalTask(resolvedTask = null, plan = {}) {
  const taskList = normalizeStandardTaskList({
    siteKey: resolvedTask?.siteKey ?? plan.siteKey,
    taskType: resolvedTask?.taskType ?? plan.taskType,
    policyRef: plan.id ? `download-plan:${plan.id}:policy` : undefined,
    items: (Array.isArray(resolvedTask?.resources) ? resolvedTask.resources : []).map((resource, index) => ({
      id: resource.id ?? `resource-${index + 1}`,
      kind: 'download',
      endpoint: resource.url,
      method: resource.method,
      retry: {
        retries: plan.policy?.retries ?? 0,
        retryBackoffMs: plan.policy?.retryBackoffMs ?? 0,
      },
      cacheKey: resource.metadata?.cacheKey ?? resource.id,
      dedupKey: resource.metadata?.dedupKey ?? resource.id ?? resource.url,
    })),
  });
  assertSchemaCompatible('StandardTaskList', taskList);
  return taskList;
}

function buildResumeCommand(plan, layout) {
  return downloadCliCommand({
    mode: 'execute',
    site: plan.siteKey,
    input: plan.source?.input,
    args: ['--run-dir', layout.runDir, '--resume'],
  });
}

function buildRetryFailedCommand(plan, layout) {
  return downloadCliCommand({
    mode: 'execute',
    site: plan.siteKey,
    input: plan.source?.input,
    args: ['--run-dir', layout.runDir, '--retry-failed'],
  });
}

function normalizeHealthAsLease(health = {}, plan = {}, purpose = 'download') {
  return normalizeSessionLease({
    siteKey: plan.siteKey,
    host: plan.host,
    purpose,
    mode: health.mode ?? 'reusable-profile',
    ...health,
    status: sessionStatus(health),
    reason: sessionRiskReason(health),
  }, {
    siteKey: plan.siteKey,
    host: plan.host,
    purpose,
    status: sessionStatus(health),
  });
}

const RAW_UNIFIED_SESSION_LEASE_FIELDS = [
  'headers',
  'cookies',
  'profilePath',
  'browserProfileRoot',
  'userDataDir',
  'csrf',
  'csrfToken',
  'token',
  'authorization',
  'Authorization',
  'cookie',
  'Cookie',
  'sessionId',
  'accessToken',
  'refreshToken',
];

function sanitizeUnifiedSessionLease(lease = {}) {
  const result = { ...lease };
  for (const field of RAW_UNIFIED_SESSION_LEASE_FIELDS) {
    delete result[field];
  }
  return result;
}

function sanitizeDownloaderVisibleSessionLease(lease = {}) {
  const result = { ...lease };
  const consumerHeaders = normalizeSessionLeaseConsumerHeaders(lease);
  for (const field of RAW_UNIFIED_SESSION_LEASE_FIELDS) {
    delete result[field];
  }
  delete result.governanceLease;
  if (Object.keys(consumerHeaders).length > 0 || !lease.sessionView) {
    result.headers = consumerHeaders;
  }
  if (!lease.sessionView) {
    result.cookies = [];
  }
  return result;
}

function annotateSessionLeaseProvider(lease = {}, unifiedSessionOptions = {}) {
  if (!unifiedSessionOptions.sessionHealthManifest) {
    return {
      ...lease,
      provider: lease.provider ?? 'legacy-session-provider',
    };
  }
  const safeLease = unifiedSessionOptions.sessionView
    ? sanitizeUnifiedSessionLease(lease)
    : { ...lease };
  return {
    ...safeLease,
    provider: 'unified-session-runner',
    healthManifest: unifiedSessionOptions.sessionHealthManifest.artifacts?.manifest
      ?? unifiedSessionOptions.sessionManifestPath,
    sessionView: unifiedSessionOptions.sessionView,
  };
}

async function maybeResolveUnifiedSessionHealth(plan = {}, request = {}, options = {}, deps = {}) {
  if (!(options.useUnifiedSessionHealth === true || request.useUnifiedSessionHealth === true)) {
    return {};
  }
  if (options.sessionHealthManifest || options.sessionStatus) {
    return {};
  }
  const result = await (deps.runSessionTask ?? runSessionTask)({
    action: 'health',
    site: plan.siteKey,
    host: plan.host,
    purpose: 'download',
    profilePath: request.profilePath,
    browserProfileRoot: options.browserProfileRoot ?? request.browserProfileRoot,
    userDataDir: options.userDataDir ?? request.userDataDir,
    outDir: options.sessionRunRoot,
    sessionRequirement: plan.sessionRequirement,
    sessionRequired: marksAuthRequired(request, plan),
  }, {
    outDir: options.sessionRunRoot,
  }, deps.sessionRunnerDeps ?? deps);
  return sessionOptionsFromRunManifest(result.manifest, {
    siteKey: plan.siteKey,
    host: plan.host,
  });
}

function createAnonymousPreflightLease(plan = {}, purpose = 'download') {
  return createAnonymousSessionLease({
    siteKey: plan.siteKey,
    host: plan.host,
    purpose,
  });
}

function explainTerminalManifest(manifest) {
  if (manifest.status === 'blocked') {
    return 'Session preflight blocked execution before resource resolution or legacy downloader spawn.';
  }
  if (manifest.reason === 'no-resolved-resources') {
    return 'No concrete resources were resolved and no legacy downloader was available for this plan.';
  }
  if (manifest.reason === 'dry-run') {
    return 'Dry run only wrote planned artifacts; no resource download was attempted.';
  }
  return 'No download was attempted for this terminal runner state.';
}

function normalizeLifecycleText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function downloadLifecycleContext(manifest = {}) {
  const traceId = normalizeLifecycleText(manifest.runId);
  return {
    traceId,
    correlationId: normalizeLifecycleText(manifest.planId ?? traceId),
  };
}

function riskStateLifecycleSummary(riskState = undefined) {
  if (!riskState || typeof riskState !== 'object' || Array.isArray(riskState)) {
    return undefined;
  }
  return {
    schemaVersion: riskState.schemaVersion,
    state: riskState.state,
    reasonCode: riskState.reasonCode,
    scope: riskState.scope,
    recovery: riskState.recovery
      ? {
        retryable: riskState.recovery.retryable,
        cooldownNeeded: riskState.recovery.cooldownNeeded,
        isolationNeeded: riskState.recovery.isolationNeeded,
        manualRecoveryNeeded: riskState.recovery.manualRecoveryNeeded,
        degradable: riskState.recovery.degradable,
        artifactWriteAllowed: riskState.recovery.artifactWriteAllowed,
        catalogAction: riskState.recovery.catalogAction,
        discardCatalog: riskState.recovery.discardCatalog,
      }
      : undefined,
    transition: riskState.transition
      ? {
        from: riskState.transition.from,
        to: riskState.transition.to,
      }
      : undefined,
  };
}

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

function riskStateForSessionStatus(value = {}) {
  switch (sessionStatus(value)) {
    case 'manual-required':
      return 'manual_recovery_required';
    case 'expired':
      return 'auth_expired';
    case 'quarantine':
      return 'isolated';
    case 'blocked':
      return 'blocked';
    default:
      return 'suspicious';
  }
}

function riskStateFromBlockedSession({ plan = {}, sessionLease = {}, reason, taskId, observedAt } = {}) {
  if (isSessionReady(sessionLease)) {
    return undefined;
  }
  const reasonCode = normalizeLifecycleText(reason ?? sessionRiskReason(sessionLease));
  if (!reasonCode || !isKnownReasonCode(reasonCode)) {
    return undefined;
  }
  return normalizeRiskTransition({
    from: 'normal',
    state: riskStateForSessionStatus(sessionLease),
    reasonCode,
    siteKey: plan.siteKey,
    taskId,
    scope: 'download-session',
    observedAt,
  });
}

function riskStateFromTerminalReason({ plan = {}, status, reason, taskId, observedAt } = {}) {
  if (!['blocked', 'partial', 'failed', 'skipped'].includes(status)) {
    return undefined;
  }
  const reasonCode = normalizeLifecycleText(reason);
  if (!reasonCode || !isKnownReasonCode(reasonCode)) {
    return undefined;
  }
  if (reasonCode === 'dry-run') {
    return undefined;
  }
  return normalizeRiskTransition({
    from: 'normal',
    state: 'suspicious',
    reasonCode,
    siteKey: plan.siteKey,
    taskId,
    scope: 'download-terminal',
    observedAt,
  });
}

function riskStateFromTerminalManifest({ plan = {}, sessionLease = {}, status, reason, taskId, observedAt } = {}) {
  if (status === 'blocked') {
    const sessionRiskState = riskStateFromBlockedSession({
      plan,
      sessionLease,
      reason,
      taskId,
      observedAt,
    });
    if (sessionRiskState) {
      return sessionRiskState;
    }
  }
  return riskStateFromTerminalReason({
    plan,
    status,
    reason,
    taskId,
    observedAt,
  });
}

function renderTerminalReport(manifest, resolvedTask = null, { plan = null, layout = null } = {}) {
  const lines = [
    '# Download Run',
    '',
    `- Status: ${manifest.status}`,
    `- Status explanation: ${explainTerminalManifest(manifest)}`,
    `- Site: ${manifest.siteKey}`,
    `- Plan: ${manifest.planId}`,
  ];
  if (manifest.reason) {
    lines.push(`- Reason: ${manifest.reason}`);
  }
  if (manifest.session) {
    lines.push(`- Session status: ${manifest.session.status}`);
    if (manifest.session.reason) {
      lines.push(`- Session reason: ${manifest.session.reason}`);
    }
    if (manifest.session.quarantineKey) {
      lines.push(`- Session quarantine key: ${manifest.session.quarantineKey}`);
    }
    lines.push(...renderSessionTraceabilityLines(manifest, { plan }));
  }
  if (manifest.resumeCommand) {
    lines.push(`- Next resume command: ${manifest.resumeCommand}`);
  }
  if (plan && layout) {
    lines.push(`- Next retry-failed command: ${buildRetryFailedCommand(plan, layout)}`);
  }
  if (resolvedTask?.completeness?.reason) {
    lines.push(`- Resolution: ${resolvedTask.completeness.reason}`);
  }
  lines.push(
    `- Manifest: ${manifest.artifacts.manifest}`,
    `- Queue: ${manifest.artifacts.queue}`,
    `- Downloads JSONL: ${manifest.artifacts.downloadsJsonl}`,
  );
  const redacted = redactValue({ report: `${lines.join('\n')}\n` });
  assertNoForbiddenPatterns(redacted.value.report);
  return redacted.value.report;
}

async function writeTerminalManifest({
  plan,
  sessionLease,
  resolvedTask = null,
  status,
  reason,
  options = {},
  lifecycleEventSubscribers = [],
  capabilityHookRegistry = undefined,
  capabilityHooks = undefined,
}) {
  const layout = await buildDownloadRunLayout(plan, options);
  const normalizedResolvedTask = resolvedTask ? normalizeResolvedDownloadTask(resolvedTask, plan) : null;
  await writeRedactedDownloadJsonArtifact(layout.planPath, plan, {
    auditPath: layout.planRedactionAuditPath,
  });
  if (normalizedResolvedTask) {
    await writeRedactedDownloadJsonArtifact(layout.resolvedTaskPath, normalizedResolvedTask);
  }
  await writeJsonFile(layout.standardTaskListPath, standardTaskListFromTerminalTask(normalizedResolvedTask, plan));
  await writeJsonFile(layout.queuePath, []);
  await writeJsonLines(layout.downloadsJsonlPath, []);
  const finishedAt = new Date().toISOString();
  const riskState = riskStateFromTerminalManifest({
    plan,
    sessionLease,
    status,
    reason,
    taskId: layout.runId,
    observedAt: finishedAt,
  });
  const manifest = normalizeDownloadRunManifest({
    runId: layout.runId,
    planId: plan.id,
    siteKey: plan.siteKey,
    status,
    reason,
    counts: {
      expected: normalizedResolvedTask?.resources?.length ?? 0,
      attempted: 0,
      downloaded: 0,
      skipped: normalizedResolvedTask?.resources?.length ?? 0,
      failed: 0,
    },
    files: [],
    failedResources: [],
    resumeCommand: ['blocked', 'partial', 'failed', 'skipped'].includes(status)
      ? buildResumeCommand(plan, layout)
      : undefined,
    artifacts: {
      manifest: layout.manifestPath,
      queue: layout.queuePath,
      downloadsJsonl: layout.downloadsJsonlPath,
      reportMarkdown: layout.reportMarkdownPath,
      redactionAudit: layout.redactionAuditPath,
      lifecycleEvent: layout.lifecycleEventPath,
      lifecycleEventRedactionAudit: layout.lifecycleEventRedactionAuditPath,
      plan: layout.planPath,
      planRedactionAudit: layout.planRedactionAuditPath,
      resolvedTask: layout.resolvedTaskPath,
      standardTaskList: layout.standardTaskListPath,
      runDir: layout.runDir,
      filesDir: layout.filesDir,
    },
    liveValidation: options.liveValidation,
    session: sessionLease,
    riskState,
    legacy: plan.legacy,
    createdAt: finishedAt,
    finishedAt,
  });
  let lifecycleEvent = normalizeLifecycleEvent({
    eventType: 'download.run.terminal',
    ...downloadLifecycleContext(manifest),
    taskId: manifest.runId,
    siteKey: manifest.siteKey,
    taskType: normalizeLifecycleText(plan.taskType),
    adapterVersion: normalizeLifecycleText(plan.adapterVersion ?? manifest.adapterVersion),
    reasonCode: manifest.reason,
    createdAt: manifest.finishedAt,
    details: {
      status: manifest.status,
      reason: manifest.reason,
      profileRef: manifest.session?.sessionView?.profileRef,
      sessionMaterialization: manifest.session?.sessionViewMaterializationAudit,
      riskSignals: manifest.session?.riskSignals,
      riskState: riskStateLifecycleSummary(manifest.riskState),
    },
  });
  const capabilityHookMatches = capabilityHookMatchSummaryForLifecycleEvent(lifecycleEvent, {
    capabilityHookRegistry,
    capabilityHooks,
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
    subscribers: composeLifecycleSubscribers(
      lifecycleEventSubscribers,
      createLifecycleArtifactWriterSubscriber({
        eventPath: layout.lifecycleEventPath,
        auditPath: layout.lifecycleEventRedactionAuditPath,
      }),
    ),
  });
  const { json, auditJson } = prepareRedactedArtifactJsonWithAudit(manifest);
  await writeTextFile(layout.manifestPath, json);
  await writeTextFile(layout.redactionAuditPath, auditJson);
  await writeTextFile(layout.reportMarkdownPath, renderTerminalReport(manifest, normalizedResolvedTask, {
    plan,
    layout,
  }));
  return manifest;
}

export async function runDownloadTask(request = {}, options = {}, deps = {}) {
  if (request.plannerHandoff) {
    assertPlannerPolicyRuntimeHandoffCompatibility(request.plannerHandoff);
  }
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const siteMetadataOptions = options.siteMetadataOptions ?? {};
  const definition = await (deps.resolveDownloadSiteDefinition ?? resolveDownloadSiteDefinition)(request, {
    workspaceRoot,
    siteMetadataOptions,
    definition: options.definition,
    definitions: options.definitions,
  });
  const plan = await (deps.createDownloadPlan ?? createDownloadPlan)(request, {
    workspaceRoot,
    siteMetadataOptions,
    definition,
  });
  const sessionPurpose = 'download';
  const effectiveAuthRequired = marksAuthRequired(request, plan);
  const liveValidationRequiresReadySession = options.liveValidation?.requiresApproval === true
    || request.liveValidation?.requiresApproval === true;
  const unifiedSessionOptions = await maybeResolveUnifiedSessionHealth(plan, request, options, deps);
  const sessionOptions = {
    ...options,
    ...unifiedSessionOptions,
    ...request.session,
    host: plan.host,
    siteContext: request.siteContext,
    profile: request.profile,
    profilePath: request.profilePath,
    sessionRequirement: effectiveAuthRequired ? 'required' : plan.sessionRequirement,
    headers: request.headers,
    downloadHeaders: request.downloadHeaders,
    cookies: request.cookies,
    dryRun: Boolean(options.dryRun ?? plan.policy?.dryRun ?? request.dryRun),
  };
  const {
    headers: _requestHeaders,
    downloadHeaders: _requestDownloadHeaders,
    cookies: _requestCookies,
    ...sessionHealthOptions
  } = sessionOptions;
  const health = plan.sessionRequirement === 'none' && !effectiveAuthRequired
    ? null
    : await (deps.inspectSessionHealth ?? inspectSessionHealth)(
      plan.siteKey,
      sessionHealthOptions,
      deps.sessionDeps ?? deps,
    );

  if (health && !isSessionReady(health) && (effectiveAuthRequired || liveValidationRequiresReadySession)) {
    const sessionLease = annotateSessionLeaseProvider(
      normalizeHealthAsLease(health, plan, sessionPurpose),
      unifiedSessionOptions,
    );
    const downloaderSessionLease = sanitizeDownloaderVisibleSessionLease(sessionLease);
    const manifest = await writeTerminalManifest({
      plan,
      sessionLease: downloaderSessionLease,
      status: 'blocked',
      reason: sessionRiskReason(sessionLease),
      options,
      lifecycleEventSubscribers: deps.lifecycleEventSubscribers,
      capabilityHookRegistry: deps.capabilityHookRegistry,
      capabilityHooks: deps.capabilityHooks,
    });
    return {
      definition,
      plan,
      sessionLease: downloaderSessionLease,
      resolvedTask: null,
      manifest,
    };
  }

  let sessionLease = health && !isSessionReady(health)
    ? createAnonymousPreflightLease(plan, sessionPurpose)
    : await (deps.acquireSessionLease ?? acquireSessionLease)(
    plan.siteKey,
    sessionPurpose,
    sessionOptions,
    deps.sessionDeps ?? deps,
  );
  sessionLease = annotateSessionLeaseProvider(sessionLease, unifiedSessionOptions);
  let downloaderSessionLease = sanitizeDownloaderVisibleSessionLease(sessionLease);

  try {
    if (!isSessionReady(sessionLease) && effectiveAuthRequired) {
      const manifest = await writeTerminalManifest({
        plan,
        sessionLease: downloaderSessionLease,
        status: 'blocked',
        reason: sessionRiskReason(sessionLease),
        options,
        lifecycleEventSubscribers: deps.lifecycleEventSubscribers,
        capabilityHookRegistry: deps.capabilityHookRegistry,
        capabilityHooks: deps.capabilityHooks,
      });
      return {
        definition,
        plan,
        sessionLease: downloaderSessionLease,
        resolvedTask: null,
        manifest,
      };
    }
    if (!isSessionReady(sessionLease)) {
      const blockedLease = sessionLease;
      await (deps.releaseSessionLease ?? releaseSessionLease)(blockedLease, deps.sessionDeps ?? deps);
      sessionLease = createAnonymousPreflightLease(plan, sessionPurpose);
      downloaderSessionLease = sanitizeDownloaderVisibleSessionLease(sessionLease);
    }

    const resolvedTask = await loadResumeResolvedTask(plan, options)
      ?? await (deps.resolveDownloadResources ?? resolveDownloadResources)(plan, downloaderSessionLease, {
        request,
        definition,
        workspaceRoot,
        siteMetadataOptions,
        allowNetworkResolve: allowNetworkResolve(request, options),
        ...resolverDependenciesFromRuntime(options, deps),
        fetchImpl: options.resolverFetchImpl ?? deps.resolverFetchImpl,
        mockFetchImpl: options.mockResolverFetchImpl ?? deps.mockResolverFetchImpl,
      });
    const normalizedResolvedTask = normalizeResolvedDownloadTask(resolvedTask, plan);
    const dryRun = Boolean(options.dryRun ?? plan.policy?.dryRun ?? request.dryRun);
    const executionPlan = {
      ...plan,
      policy: {
        ...plan.policy,
        dryRun,
      },
    };
    assertRuntimeDownloadCompatibility({
      plan: executionPlan,
      resolvedTask: normalizedResolvedTask,
      sessionLease: downloaderSessionLease,
    });
    if (!dryRun && normalizedResolvedTask.resources.length === 0) {
      if (plan.legacy?.entrypoint) {
        const manifest = await (deps.executeLegacyDownloadTask ?? executeLegacyDownloadTask)(
          plan,
          downloaderSessionLease,
          request,
          {
            ...options,
            dryRun,
            workspaceRoot,
            nativeFallback: nativeFallbackTrace(normalizedResolvedTask),
          },
          deps.legacyExecutorDeps ?? deps,
        );
        return {
          definition,
          plan,
          sessionLease: downloaderSessionLease,
          resolvedTask: normalizedResolvedTask,
          manifest,
        };
      }
      const manifest = await writeTerminalManifest({
        plan,
        sessionLease: downloaderSessionLease,
        resolvedTask: normalizedResolvedTask,
        status: 'skipped',
        reason: 'no-resolved-resources',
        options,
        lifecycleEventSubscribers: deps.lifecycleEventSubscribers,
        capabilityHookRegistry: deps.capabilityHookRegistry,
        capabilityHooks: deps.capabilityHooks,
      });
      return {
        definition,
        plan,
        sessionLease: downloaderSessionLease,
        resolvedTask: normalizedResolvedTask,
        manifest,
      };
    }

    const manifest = await (deps.executeResolvedDownloadTask ?? executeResolvedDownloadTask)(
      normalizedResolvedTask,
      executionPlan,
      downloaderSessionLease,
      {
        ...options,
        dryRun,
        workspaceRoot,
        liveValidation: options.liveValidation,
        progress: options.progress,
      },
      deps.executorDeps ?? deps,
    );
    return {
      definition,
      plan,
      sessionLease: downloaderSessionLease,
      resolvedTask: normalizedResolvedTask,
      manifest,
    };
  } finally {
    await (deps.releaseSessionLease ?? releaseSessionLease)(sessionLease, deps.sessionDeps ?? deps);
  }
}
