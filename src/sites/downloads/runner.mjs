// @ts-check

import {
  writeJsonFile,
  writeJsonLines,
  writeTextFile,
} from '../../infra/io.mjs';
import {
  normalizeDownloadRunManifest,
  normalizeResolvedDownloadTask,
} from './contracts.mjs';
import { buildDownloadRunLayout } from './artifacts.mjs';
import { executeResolvedDownloadTask } from './executor.mjs';
import { executeLegacyDownloadTask } from './legacy-executor.mjs';
import {
  createDownloadPlan,
  resolveDownloadResources,
  resolveDownloadSiteDefinition,
} from './registry.mjs';
import {
  acquireSessionLease,
  releaseSessionLease,
} from './session-manager.mjs';

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
  const sessionLease = await (deps.acquireSessionLease ?? acquireSessionLease)(
    plan.siteKey,
    `download:${plan.taskType}`,
    {
      ...options,
      ...request.session,
      host: plan.host,
      siteContext: request.siteContext,
      profile: request.profile,
      profilePath: request.profilePath,
      sessionRequirement: plan.sessionRequirement,
      headers: request.headers,
      downloadHeaders: request.downloadHeaders,
      cookies: request.cookies,
    },
    deps.sessionDeps ?? deps,
  );

  try {
    if (sessionLease.status !== 'ready') {
      const manifest = await writeTerminalManifest({
        plan,
        sessionLease,
        status: 'blocked',
        reason: sessionLease.reason ?? sessionLease.status,
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
