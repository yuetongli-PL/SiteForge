// @ts-check

import path from 'node:path';

import { writeJsonFile } from '../../infra/io.mjs';
import {
  buildSessionRepairPlan,
  inspectSessionHealth,
} from '../downloads/session-manager.mjs';
import {
  assertManifestIsSanitized,
  defaultSessionRunDir,
  normalizeSessionHealth,
  normalizeSessionPlan,
  normalizeSessionRunManifest,
  sessionRunStatusFromHealth,
} from './contracts.mjs';
import { resolveSessionSiteDefinition } from './site-modules.mjs';

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
  const health = await inspectHealthForPlan(plan, request, deps);
  const repairPlan = health.repairPlan ?? buildSessionRepairPlan(health);
  const finishedAt = new Date().toISOString();
  const manifest = assertManifestIsSanitized(normalizeSessionRunManifest({
    plan,
    health,
    repairPlan,
    status: sessionRunStatusFromHealth(health),
    artifacts: {
      manifest: manifestPath,
      runDir,
    },
    createdAt: startedAt,
    finishedAt,
  }));

  await writeJsonFile(manifestPath, manifest);
  return {
    action,
    plan,
    health,
    repairPlan,
    manifest,
    artifacts: manifest.artifacts,
  };
}
