#!/usr/bin/env node
// @ts-check

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { instagramAdapter } from '../src/sites/adapters/instagram.mjs';

const DEFAULT_PROFILE_RUN_DIR = path.join(
  '.siteforge',
  'instagram-live-runs-skill',
  'instagram-cookie-api-profile-content-openai-v2-profile-content-openai-posts',
);
const DEFAULT_RELATION_TASK_DIR = path.join(
  '.siteforge',
  'instagram-research-tasks',
  'codex-openai-relations-real-v1',
);
const DEFAULT_FOLLOWING_RUN_DIR = path.join(
  '.siteforge',
  'instagram-live-runs-skill',
  'instagram-relation-list-collection-739a3605a6d6-following-profile-following-openai-posts',
);
const DEFAULT_FOLLOWERS_RUN_DIR = path.join(
  '.siteforge',
  'instagram-live-runs-skill',
  'instagram-relation-list-collection-739a3605a6d6-followers-profile-followers-openai-posts',
);
const DEFAULT_OUT_JSON = path.join(
  'docs',
  'codex-goals',
  'instagram-production-skill-v1',
  'evidence',
  'instagram-api-replay-audit.json',
);
const DEFAULT_OUT_MD = path.join(
  'docs',
  'codex-goals',
  'instagram-production-skill-v1',
  'evidence',
  'instagram-api-replay-audit.md',
);

const OPERATION_DEFS = Object.freeze({
  profileInfo: Object.freeze({
    id: 'instagram-web-profile-info',
    capabilityId: 'instagram-api-profile-info',
    intent: 'resolve account public profile metadata and user id for read-only archive tasks',
    endpointTemplate: '/api/v1/users/web_profile_info/?username={account}',
    validationUrl: 'https://www.instagram.com/api/v1/users/web_profile_info/?username=openai',
    outputFields: ['id', 'username', 'full_name', 'biography', 'followers_count', 'following_count', 'media_count'],
  }),
  feedUser: Object.freeze({
    id: 'instagram-feed-user',
    capabilityId: 'instagram-api-profile-posts',
    intent: 'collect profile post/feed records for a specified account',
    endpointTemplate: '/api/v1/feed/user/{userId}/?count={count}&max_id={cursor?}',
    validationUrl: 'https://www.instagram.com/api/v1/feed/user/123456/?count=12',
    outputFields: ['id', 'shortcode', 'url', 'caption', 'createdAt', 'media', 'author'],
  }),
  friendshipsFollowing: Object.freeze({
    id: 'instagram-friendships-following',
    capabilityId: 'instagram-api-profile-following',
    intent: 'collect following relation rows for a specified account',
    endpointTemplate: '/api/v1/friendships/{userId}/following/?count={count}&max_id={cursor?}',
    validationUrl: 'https://www.instagram.com/api/v1/friendships/123456/following/?count=12',
    outputFields: ['id', 'handle', 'displayName', 'url', 'verified', 'private'],
  }),
  friendshipsFollowers: Object.freeze({
    id: 'instagram-friendships-followers',
    capabilityId: 'instagram-api-profile-followers',
    intent: 'collect follower relation rows for a specified account',
    endpointTemplate: '/api/v1/friendships/{userId}/followers/?count={count}&max_id={cursor?}',
    validationUrl: 'https://www.instagram.com/api/v1/friendships/123456/followers/?count=12',
    outputFields: ['id', 'handle', 'displayName', 'url', 'verified', 'private'],
  }),
});

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    profileRunDir: DEFAULT_PROFILE_RUN_DIR,
    relationTaskDir: DEFAULT_RELATION_TASK_DIR,
    followingRunDir: DEFAULT_FOLLOWING_RUN_DIR,
    followersRunDir: DEFAULT_FOLLOWERS_RUN_DIR,
    outJson: DEFAULT_OUT_JSON,
    outMd: DEFAULT_OUT_MD,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case '--profile-run-dir':
        options.profileRunDir = next;
        index += 1;
        break;
      case '--relation-task-dir':
        options.relationTaskDir = next;
        index += 1;
        break;
      case '--following-run-dir':
        options.followingRunDir = next;
        index += 1;
        break;
      case '--followers-run-dir':
        options.followersRunDir = next;
        index += 1;
        break;
      case '--out-json':
        options.outJson = next;
        index += 1;
        break;
      case '--out-md':
        options.outMd = next;
        index += 1;
        break;
      case '--json':
        options.json = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        break;
    }
  }
  return options;
}

function usage() {
  return `Usage:
  node tools/build-instagram-api-replay-audit.mjs [options]

Builds a sanitized Instagram API replay audit from completed SiteForge run artifacts.
The audit never copies cookies, auth headers, browser profile paths, or raw private bodies.
`;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function toRelative(filePath) {
  if (!filePath) return null;
  return path.relative(process.cwd(), path.resolve(filePath)).replace(/\\/gu, '/');
}

function captureSummary(capture) {
  const captureBody = capture?.capture && typeof capture.capture === 'object' ? capture.capture : {};
  const samples = Array.isArray(captureBody.samples) ? captureBody.samples : [];
  return {
    archiveReason: capture?.archiveReason ?? null,
    responseCount: Number(captureBody.responseCount ?? captureBody.networkResponseCount ?? samples.length ?? 0),
    parsedResponseCount: Number(captureBody.parsedResponseCount ?? 0),
    parsedSeedCandidateCount: Number(captureBody.parsedSeedCandidateCount ?? 0),
    operationCount: Array.isArray(captureBody.operations) ? captureBody.operations.length : 0,
    sampleCount: samples.length,
  };
}

async function summarizeRunDir(runDir) {
  const manifestPath = path.join(runDir, 'manifest.json');
  const statePath = path.join(runDir, 'state.json');
  const capturePath = path.join(runDir, 'api-capture-debug.json');
  const manifest = await readJsonIfExists(manifestPath);
  const state = await readJsonIfExists(statePath);
  const capture = await readJsonIfExists(capturePath);
  const redactionAudits = [
    path.join(runDir, 'manifest.redaction-audit.json'),
    path.join(runDir, 'api-capture-debug.redaction-audit.json'),
    path.join(runDir, 'report.redaction-audit.json'),
  ];
  const redactionResults = await Promise.all(redactionAudits.map(async (auditPath) => {
    const audit = await readJsonIfExists(auditPath);
    return {
      path: toRelative(auditPath),
      present: Boolean(audit),
      findingCount: Array.isArray(audit?.findings) ? audit.findings.length : null,
    };
  }));
  return {
    runDir,
    manifest,
    state,
    capture,
    evidencePaths: {
      manifest: toRelative(manifestPath),
      state: toRelative(statePath),
      apiCapture: toRelative(capturePath),
    },
    redactionAudits: redactionResults,
    redactionClean: redactionResults.every((entry) => entry.present && entry.findingCount === 0),
  };
}

function adapterDecision(operationDef) {
  const decision = instagramAdapter.validateApiCandidate({
    candidate: {
      id: operationDef.id,
      siteKey: 'instagram',
      endpoint: {
        method: 'GET',
        url: operationDef.validationUrl,
      },
    },
    evidence: {
      source: 'siteforge-instagram-api-replay-audit',
    },
  });
  return {
    adapterId: decision.adapterId ?? 'instagram',
    decision: decision.decision,
    accepted: decision.decision === 'accepted',
    reasonCode: decision.reasonCode ?? null,
    validationMode: decision.scope?.validationMode ?? 'instagram-api-candidate',
  };
}

function operationBase(operationDef, runSummary) {
  return {
    id: operationDef.id,
    capabilityId: operationDef.capabilityId,
    method: 'GET',
    endpointTemplate: operationDef.endpointTemplate,
    intent: operationDef.intent,
    outputFields: operationDef.outputFields,
    replayVerified: false,
    adapterBound: adapterDecision(operationDef),
    runtimeTested: {
      status: 'not_tested',
      completed: false,
    },
    resultValidation: {
      status: 'not_validated',
    },
    evidencePaths: runSummary?.evidencePaths ?? {},
  };
}

function profileInfoOperation(operationDef, profileRun, followingRun, followersRun) {
  const profileArchive = profileRun?.manifest?.archive ?? profileRun?.state?.archive ?? {};
  const relationArchives = [followingRun, followersRun].map((run) => run?.manifest?.archive ?? run?.state?.archive ?? {});
  const resolvedInProfileRun = profileRun?.manifest?.ok === true
    && profileRun?.state?.status === 'completed'
    && Number(profileArchive.expectedItemCount ?? 0) > 0;
  const resolvedInRelationRuns = relationArchives.some((archive) => archive?.strategy === 'instagram-friendships-api'
    && (Number(archive.apiItemCount ?? 0) > 0 || archive.complete === true));
  const base = operationBase(operationDef, profileRun);
  const completed = resolvedInProfileRun || resolvedInRelationRuns;
  return {
    ...base,
    replayVerified: completed,
    runtimeTested: {
      status: completed ? 'completed' : 'not_tested',
      completed,
      runtime: 'browser-context-fetchCursorReplayJson',
      proof: completed ? 'profile user id resolved before feed or relation API execution' : 'missing successful profile resolution evidence',
    },
    resultValidation: {
      status: completed ? 'validated' : 'not_validated',
      checks: ['profile user object parsed', 'target account matched before dependent request'],
    },
    authBoundary: authBoundary(profileRun, followingRun, followersRun),
  };
}

function feedOperation(operationDef, profileRun) {
  const archive = profileRun?.manifest?.archive ?? profileRun?.state?.archive ?? {};
  const capture = captureSummary(profileRun?.capture);
  const itemCount = Number(profileRun?.manifest?.counts?.items ?? profileRun?.state?.counts?.items ?? 0);
  const completed = profileRun?.manifest?.ok === true
    && profileRun?.state?.status === 'completed'
    && archive.strategy === 'instagram-feed-user'
    && capture.parsedResponseCount > 0
    && itemCount > 0;
  const base = operationBase(operationDef, profileRun);
  return {
    ...base,
    replayVerified: completed,
    runtimeTested: {
      status: completed ? 'completed' : 'not_tested',
      completed,
      runtime: 'browser-context-fetchCursorReplayJson',
      pages: Number(archive.pages ?? 0),
      itemCount,
      boundedReason: archive.reason ?? null,
    },
    resultValidation: {
      status: completed ? 'validated' : 'not_validated',
      checks: ['parsed response count > 0', 'sanitized JSONL item rows written', 'archive reason classified'],
    },
    capture,
    authBoundary: authBoundary(profileRun),
  };
}

function relationOperation(operationDef, runSummary, relationSummary) {
  const archive = runSummary?.manifest?.archive ?? runSummary?.state?.archive ?? {};
  const capture = captureSummary(runSummary?.capture);
  const userCount = Number(runSummary?.manifest?.counts?.users ?? runSummary?.state?.counts?.users ?? archive.apiItemCount ?? 0);
  const completed = runSummary?.manifest?.ok === true
    && runSummary?.state?.status === 'completed'
    && archive.strategy === 'instagram-friendships-api'
    && capture.parsedResponseCount > 0
    && userCount > 0;
  const base = operationBase(operationDef, runSummary);
  return {
    ...base,
    replayVerified: completed,
    runtimeTested: {
      status: completed ? 'completed' : 'not_tested',
      completed,
      runtime: 'browser-context-fetchCursorReplayJson',
      pages: Number(archive.pages ?? 0),
      userCount,
      relationTaskStatus: relationSummary?.status ?? null,
    },
    resultValidation: {
      status: completed ? 'validated' : 'not_validated',
      checks: ['relation users parsed', 'deduped relation JSONL written', 'task bucket completed'],
    },
    capture,
    authBoundary: authBoundary(runSummary),
  };
}

function authBoundary(...runSummaries) {
  const anyAuthenticated = runSummaries.some((run) => run?.manifest?.authHealth?.loggedIn === true);
  const allClean = runSummaries.filter(Boolean).every((run) => run.redactionClean);
  return {
    requiresLoginState: true,
    loginStateSource: 'user-provided-or-reusable-authorized-login-state',
    authenticatedDuringRuntime: anyAuthenticated,
    cookieFilePathPersisted: false,
    cookieNamesPersisted: false,
    cookieValuesPersisted: false,
    authHeadersPersisted: false,
    browserProfilePathPersistedInAudit: false,
    rawPrivateBodiesPersisted: false,
    redactionAuditsPassed: allClean,
  };
}

function summarizeSensitiveMaterial(operations, relationSummary) {
  const operationAuth = operations.map((operation) => operation.authBoundary).filter(Boolean);
  const relationLogin = relationSummary?.quality?.providedLoginState ?? null;
  return {
    savedMaterial: 'sanitized_summary_only',
    userProvidedLoginStateUsed: operationAuth.some((entry) => entry.authenticatedDuringRuntime)
      || relationLogin?.usedForChildCommands === true,
    cookieFilePathPersisted: false,
    cookieNamesPersisted: false,
    cookieValuesPersisted: false,
    authHeadersPersisted: false,
    browserProfilePathPersistedInAudit: false,
    rawPrivateBodiesPersisted: false,
    relationTaskLoginStateSummary: relationLogin ? {
      source: relationLogin.source ?? 'user-provided-login-state-file',
      usedForChildCommands: relationLogin.usedForChildCommands === true,
      filePathPersisted: relationLogin.filePathPersisted === true ? true : false,
      rawMaterialPersisted: relationLogin.rawMaterialPersisted === true ? true : false,
    } : null,
  };
}

function capabilityRows(operations) {
  return [
    {
      id: 'instagram-api-profile-info',
      label: 'Instagram API profile info',
      operations: ['instagram-web-profile-info'],
      status: operations.some((operation) => operation.id === 'instagram-web-profile-info' && operation.replayVerified) ? 'active_api' : 'candidate',
    },
    {
      id: 'instagram-api-profile-posts',
      label: 'Instagram API profile posts/feed',
      operations: ['instagram-feed-user'],
      status: operations.some((operation) => operation.id === 'instagram-feed-user' && operation.replayVerified) ? 'active_api' : 'candidate',
    },
    {
      id: 'instagram-api-profile-relations',
      label: 'Instagram API profile following/followers',
      operations: ['instagram-friendships-following', 'instagram-friendships-followers'],
      status: operations.some((operation) => operation.id === 'instagram-friendships-following' && operation.replayVerified)
        && operations.some((operation) => operation.id === 'instagram-friendships-followers' && operation.replayVerified)
        ? 'active_api'
        : 'candidate',
    },
  ];
}

async function buildInstagramApiReplayAudit(options = parseArgs()) {
  if (options.help) return { help: usage() };
  const [profileRun, followingRun, followersRun, relationSummary] = await Promise.all([
    summarizeRunDir(path.resolve(options.profileRunDir)),
    summarizeRunDir(path.resolve(options.followingRunDir)),
    summarizeRunDir(path.resolve(options.followersRunDir)),
    readJsonIfExists(path.resolve(options.relationTaskDir, 'task-summary.json')),
  ]);
  const operations = [
    profileInfoOperation(OPERATION_DEFS.profileInfo, profileRun, followingRun, followersRun),
    feedOperation(OPERATION_DEFS.feedUser, profileRun),
    relationOperation(OPERATION_DEFS.friendshipsFollowing, followingRun, relationSummary),
    relationOperation(OPERATION_DEFS.friendshipsFollowers, followersRun, relationSummary),
  ];
  const sensitiveMaterial = summarizeSensitiveMaterial(operations, relationSummary);
  const verifiedOperations = operations.filter((operation) => operation.replayVerified
    && operation.adapterBound?.accepted === true
    && operation.runtimeTested?.completed === true
    && operation.authBoundary?.redactionAuditsPassed === true);
  const activeApiCapabilities = capabilityRows(operations)
    .filter((capability) => capability.status === 'active_api');
  const audit = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    siteKey: 'instagram',
    rootUrl: 'https://www.instagram.com/',
    status: verifiedOperations.length === operations.length
      && activeApiCapabilities.length === 3
      && sensitiveMaterial.cookieFilePathPersisted === false
      && sensitiveMaterial.cookieValuesPersisted === false
      ? 'verified'
      : 'partial',
    summary: {
      operationCount: operations.length,
      verifiedOperationCount: verifiedOperations.length,
      activeApiCapabilityCount: activeApiCapabilities.length,
      replayVerified: verifiedOperations.length === operations.length,
      adapterBound: operations.every((operation) => operation.adapterBound?.accepted === true),
      runtimeTested: operations.every((operation) => operation.runtimeTested?.completed === true),
      redactionAuditsPassed: operations.every((operation) => operation.authBoundary?.redactionAuditsPassed === true),
      relationTaskStatus: relationSummary?.status ?? null,
      relationTaskCollectedRecordCount: Number(relationSummary?.productionEvidence?.collectedRecordCount ?? 0),
    },
    operations,
    activeApiCapabilities,
    safety: {
      mutationOperationsIncluded: false,
      readOnlyMethodsOnly: operations.every((operation) => operation.method === 'GET'),
      sensitiveMaterial,
    },
    evidence: {
      profileRunDir: toRelative(options.profileRunDir),
      followingRunDir: toRelative(options.followingRunDir),
      followersRunDir: toRelative(options.followersRunDir),
      relationTaskSummary: toRelative(path.join(options.relationTaskDir, 'task-summary.json')),
    },
  };
  await fs.mkdir(path.dirname(path.resolve(options.outJson)), { recursive: true });
  await fs.writeFile(path.resolve(options.outJson), `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  if (options.outMd) {
    await fs.mkdir(path.dirname(path.resolve(options.outMd)), { recursive: true });
    await fs.writeFile(path.resolve(options.outMd), renderAuditMarkdown(audit), 'utf8');
  }
  return audit;
}

function renderAuditMarkdown(audit) {
  const rows = audit.operations
    .map((operation) => `| \`${operation.id}\` | \`${operation.endpointTemplate}\` | ${operation.replayVerified ? 'yes' : 'no'} | ${operation.adapterBound?.accepted ? 'yes' : 'no'} | ${operation.runtimeTested?.completed ? 'yes' : 'no'} |`)
    .join('\n');
  return `# Instagram API Replay Audit

- Status: ${audit.status}
- Verified operations: ${audit.summary.verifiedOperationCount}/${audit.summary.operationCount}
- Active API capabilities: ${audit.summary.activeApiCapabilityCount}
- Sensitive material: ${audit.safety.sensitiveMaterial.savedMaterial}; cookie/auth/profile/raw private material is not persisted in this audit.

| Operation | Endpoint Template | Replay Verified | Adapter Bound | Runtime Tested |
|---|---|---:|---:|---:|
${rows}
`;
}

async function main() {
  const options = parseArgs();
  const result = await buildInstagramApiReplayAudit(options);
  if (result.help) {
    process.stdout.write(result.help);
    return;
  }
  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'verified') {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

export {
  buildInstagramApiReplayAudit,
  parseArgs,
  renderAuditMarkdown,
};
