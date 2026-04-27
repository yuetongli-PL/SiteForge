// @ts-check

import {
  writeJsonFile,
  writeJsonLines,
  writeTextFile,
} from '../../infra/io.mjs';
import {
  createAnonymousSessionLease,
  normalizeDownloadRunManifest,
  normalizeResolvedDownloadTask,
  normalizeSessionLease,
} from './contracts.mjs';
import { buildDownloadRunLayout } from './artifacts.mjs';
import { executeResolvedDownloadTask } from './executor.mjs';
import { executeLegacyDownloadTask } from './legacy-executor.mjs';
import {
  createDownloadPlan,
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

function createAnonymousPreflightLease(plan = {}, purpose = 'download') {
  return createAnonymousSessionLease({
    siteKey: plan.siteKey,
    host: plan.host,
    purpose,
  });
}

function renderTerminalReport(manifest, resolvedTask = null) {
  const lines = [
    '# Download Run',
    '',
    `- Status: ${manifest.status}`,
    `- Site: ${manifest.siteKey}`,
    `- Plan: ${manifest.planId}`,
  ];
  if (manifest.reason) {
    lines.push(`- Reason: ${manifest.reason}`);
  }
  if (resolvedTask?.completeness?.reason) {
    lines.push(`- Resolution: ${resolvedTask.completeness.reason}`);
  }
  return `${lines.join('\n')}\n`;
}

async function writeTerminalManifest({ plan, sessionLease, resolvedTask = null, status, reason, options = {} }) {
  const layout = await buildDownloadRunLayout(plan, options);
  const normalizedResolvedTask = resolvedTask ? normalizeResolvedDownloadTask(resolvedTask, plan) : null;
  await writeJsonFile(layout.planPath, plan);
  if (normalizedResolvedTask) {
    await writeJsonFile(layout.resolvedTaskPath, normalizedResolvedTask);
  }
  await writeJsonFile(layout.queuePath, []);
  await writeJsonLines(layout.downloadsJsonlPath, []);
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
    artifacts: {
      manifest: layout.manifestPath,
      queue: layout.queuePath,
      downloadsJsonl: layout.downloadsJsonlPath,
      reportMarkdown: layout.reportMarkdownPath,
      plan: layout.planPath,
      resolvedTask: layout.resolvedTaskPath,
      runDir: layout.runDir,
      filesDir: layout.filesDir,
    },
    session: sessionLease,
    legacy: plan.legacy,
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  });
  await writeJsonFile(layout.manifestPath, manifest);
  await writeTextFile(layout.reportMarkdownPath, renderTerminalReport(manifest, normalizedResolvedTask));
  return manifest;
}

export async function runDownloadTask(request = {}, options = {}, deps = {}) {
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
  const sessionPurpose = `download:${plan.taskType}`;
  const effectiveAuthRequired = marksAuthRequired(request, plan);
  const sessionOptions = {
    ...options,
    ...request.session,
    host: plan.host,
    siteContext: request.siteContext,
    profile: request.profile,
    profilePath: request.profilePath,
    sessionRequirement: effectiveAuthRequired ? 'required' : plan.sessionRequirement,
    headers: request.headers,
    downloadHeaders: request.downloadHeaders,
    cookies: request.cookies,
  };
  const health = plan.sessionRequirement === 'none' && !effectiveAuthRequired
    ? null
    : await (deps.inspectSessionHealth ?? inspectSessionHealth)(
      plan.siteKey,
      sessionOptions,
      deps.sessionDeps ?? deps,
    );

  if (health && !isSessionReady(health) && effectiveAuthRequired) {
    const sessionLease = normalizeHealthAsLease(health, plan, sessionPurpose);
    const manifest = await writeTerminalManifest({
      plan,
      sessionLease,
      status: 'blocked',
      reason: sessionRiskReason(sessionLease),
      options,
    });
    return {
      definition,
      plan,
      sessionLease,
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

  try {
    if (!isSessionReady(sessionLease) && effectiveAuthRequired) {
      const manifest = await writeTerminalManifest({
        plan,
        sessionLease,
        status: 'blocked',
        reason: sessionRiskReason(sessionLease),
        options,
      });
      return {
        definition,
        plan,
        sessionLease,
        resolvedTask: null,
        manifest,
      };
    }
    if (!isSessionReady(sessionLease)) {
      const blockedLease = sessionLease;
      await (deps.releaseSessionLease ?? releaseSessionLease)(blockedLease, deps.sessionDeps ?? deps);
      sessionLease = createAnonymousPreflightLease(plan, sessionPurpose);
    }

    const resolvedTask = await (deps.resolveDownloadResources ?? resolveDownloadResources)(plan, sessionLease, {
      request,
      definition,
      workspaceRoot,
      siteMetadataOptions,
    });
    const normalizedResolvedTask = normalizeResolvedDownloadTask(resolvedTask, plan);
    const dryRun = Boolean(options.dryRun ?? plan.policy?.dryRun ?? request.dryRun);
    if (!dryRun && normalizedResolvedTask.resources.length === 0) {
      if (plan.legacy?.entrypoint) {
        const manifest = await (deps.executeLegacyDownloadTask ?? executeLegacyDownloadTask)(
          plan,
          sessionLease,
          request,
          {
            ...options,
            dryRun,
            workspaceRoot,
          },
          deps.legacyExecutorDeps ?? deps,
        );
        return {
          definition,
          plan,
          sessionLease,
          resolvedTask: normalizedResolvedTask,
          manifest,
        };
      }
      const manifest = await writeTerminalManifest({
        plan,
        sessionLease,
        resolvedTask: normalizedResolvedTask,
        status: 'skipped',
        reason: 'no-resolved-resources',
        options,
      });
      return {
        definition,
        plan,
        sessionLease,
        resolvedTask: normalizedResolvedTask,
        manifest,
      };
    }

    const manifest = await (deps.executeResolvedDownloadTask ?? executeResolvedDownloadTask)(
      normalizedResolvedTask,
      {
        ...plan,
        policy: {
          ...plan.policy,
          dryRun,
        },
      },
      sessionLease,
      {
        ...options,
        dryRun,
        workspaceRoot,
      },
      deps.executorDeps ?? deps,
    );
    return {
      definition,
      plan,
      sessionLease,
      resolvedTask: normalizedResolvedTask,
      manifest,
    };
  } finally {
    await (deps.releaseSessionLease ?? releaseSessionLease)(sessionLease, deps.sessionDeps ?? deps);
  }
}
