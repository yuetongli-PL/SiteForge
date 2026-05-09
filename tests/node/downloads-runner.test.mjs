import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { readJsonFile, writeJsonFile } from '../../src/infra/io.mjs';
import { downloadCliJson, main as runDownloadCli, parseArgs } from '../../src/entrypoints/sites/download.mjs';
import {
  DOWNLOAD_RUN_MANIFEST_SCHEMA_VERSION,
  DEFAULT_DOWNLOAD_COMPLETED_REASON,
  LEGACY_RAW_SESSION_LEASE_ISOLATION,
  inferSiteKeyFromHost,
  normalizeDownloadRunManifest,
  normalizeDownloadRunReason,
  normalizeDownloadTaskPlan,
  normalizeResolvedDownloadTask,
  normalizeSessionLease,
  normalizeSessionLeaseConsumerHeaders,
} from '../../src/sites/downloads/contracts.mjs';
import { reasonCodeSummary, requireReasonCodeDefinition } from '../../src/sites/capability/reason-codes.mjs';
import {
  LIFECYCLE_EVENT_SCHEMA_VERSION,
  assertLifecycleEventObservabilityFields,
} from '../../src/sites/capability/lifecycle-events.mjs';
import { assertSchemaCompatible } from '../../src/sites/capability/compatibility-registry.mjs';
import { API_CATALOG_ENTRY_SCHEMA_VERSION } from '../../src/sites/capability/api-candidates.mjs';
import {
  DOWNLOAD_POLICY_SCHEMA_VERSION,
  normalizeDownloadPolicy,
} from '../../src/sites/capability/download-policy.mjs';
import { RISK_STATE_SCHEMA_VERSION } from '../../src/sites/capability/risk-state.mjs';
import { REDACTION_PLACEHOLDER } from '../../src/sites/capability/security-guard.mjs';
import { SESSION_VIEW_SCHEMA_VERSION } from '../../src/sites/capability/session-view.mjs';
import {
  STANDARD_TASK_LIST_SCHEMA_VERSION,
  normalizeStandardTaskList,
} from '../../src/sites/capability/standard-task-list.mjs';
import {
  CAPABILITY_HOOK_EXECUTION_POLICY,
  createCapabilityHookRegistry,
} from '../../src/sites/capability/capability-hook.mjs';
import {
  assertRuntimeDownloadCompatibility,
  executeResolvedDownloadTask,
} from '../../src/sites/downloads/executor.mjs';
import { executeLegacyDownloadTask } from '../../src/sites/downloads/legacy-executor.mjs';
import { acquireSessionLease } from '../../src/sites/downloads/session-manager.mjs';
import {
  listDownloadSiteDefinitions,
  resolveDownloadResources as resolveRegistryDownloadResources,
} from '../../src/sites/downloads/registry.mjs';
import { runDownloadTask } from '../../src/sites/downloads/runner.mjs';
import { resolveNativeResourceSeeds } from '../../src/sites/downloads/resource-seeds.mjs';
import {
  buildLegacyCommand as build22BiquLegacyCommand,
  create22BiquChapterResourceSeed,
  resolveResources as resolve22BiquResources,
} from '../../src/sites/downloads/site-modules/22biqu.mjs';
import {
  createDouyinMediaResourceSeed,
  resolveResources as resolveDouyinResources,
} from '../../src/sites/downloads/site-modules/douyin.mjs';
import {
  createXiaohongshuAssetResourceSeed,
  resolveResources as resolveXiaohongshuResources,
} from '../../src/sites/downloads/site-modules/xiaohongshu.mjs';
import {
  addCommonProfileFlags,
  resolveLegacyProfileFlagMaterial,
} from '../../src/sites/downloads/site-modules/common.mjs';
import { normalizeSessionRunManifest } from '../../src/sites/sessions/contracts.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');

const NATIVE_22BIQU_CHAPTERS = [
  { chapterIndex: 1, href: '1.html', title: 'Chapter One' },
  { chapterIndex: 2, href: '2.html', title: 'Chapter Two' },
];

function native22BiquRequest(overrides = {}) {
  return {
    site: '22biqu',
    input: 'https://www.22biqu.com/biqu123/',
    chapters: NATIVE_22BIQU_CHAPTERS,
    retries: 0,
    retryBackoffMs: 0,
    ...overrides,
  };
}

function native22BiquSessionLease(purpose = 'download:book', overrides = {}) {
  return {
    siteKey: '22biqu',
    host: 'www.22biqu.com',
    mode: 'anonymous',
    status: 'ready',
    riskSignals: [],
    purpose,
    ...overrides,
  };
}

async function readJsonLinesFile(filePath) {
  const text = await readFile(filePath, 'utf8');
  return text.trim()
    ? text.trimEnd().split(/\r?\n/u).map((line) => JSON.parse(line))
    : [];
}

async function assertDownloadRunArtifactBundle(manifest) {
  const runDir = path.dirname(manifest.artifacts.manifest);
  const paths = {
    manifest: manifest.artifacts.manifest,
    queue: manifest.artifacts.queue,
    downloadsJsonl: manifest.artifacts.downloadsJsonl,
    reportMarkdown: manifest.artifacts.reportMarkdown,
    plan: manifest.artifacts.plan ?? path.join(runDir, 'plan.json'),
    resolvedTask: manifest.artifacts.resolvedTask ?? path.join(runDir, 'resolved-task.json'),
  };

  for (const [name, filePath] of Object.entries(paths)) {
    assert.equal(Boolean(filePath), true, `${name} artifact path is present`);
    await readFile(filePath, 'utf8');
  }

  return {
    paths,
    persistedManifest: await readJsonFile(paths.manifest),
    plan: await readJsonFile(paths.plan),
    resolvedTask: await readJsonFile(paths.resolvedTask),
    queue: await readJsonFile(paths.queue),
    downloads: await readJsonLinesFile(paths.downloadsJsonl),
    report: await readFile(paths.reportMarkdown, 'utf8'),
  };
}

const PERSISTED_PLAN_SECRET_PATTERN = /synthetic-plan-|access_token=|refresh_token=|csrf=|sessionid=|Authorization:\s*Bearer|Cookie:\s*sid=|SESSDATA=/iu;

function sensitiveDownloadPlan(overrides = {}) {
  const sensitiveInput = 'https://example.com/media.mp4?access_token=synthetic-plan-access-token&refresh_token=synthetic-plan-refresh-token&csrf=synthetic-plan-csrf&sessionid=synthetic-plan-session';
  return normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: {
      input: sensitiveInput,
      canonicalUrl: `${sensitiveInput}&extra=1`,
      title: 'Plan title csrf=synthetic-plan-title-csrf',
      account: 'sid=synthetic-plan-account-session',
    },
    policy: {
      dryRun: true,
      verify: false,
      retries: 0,
    },
    metadata: {
      publicLabel: 'safe plan metadata',
      note: 'Cookie: sid=synthetic-plan-metadata-cookie',
      diagnostic: 'Authorization: Bearer synthetic-plan-metadata-auth',
    },
    ...overrides,
  });
}

async function assertPersistedPlanBoundary(manifest) {
  const persistedManifest = await readJsonFile(manifest.artifacts.manifest);
  const runDir = path.dirname(persistedManifest.artifacts.manifest);
  const planPath = persistedManifest.artifacts.plan ?? manifest.artifacts.plan ?? path.join(runDir, 'plan.json');
  const persistedPlan = await readJsonFile(planPath);
  const report = await readFile(persistedManifest.artifacts.reportMarkdown, 'utf8');
  const audit = await readJsonFile(persistedManifest.artifacts.redactionAudit);
  const planAudit = await readJsonFile(persistedManifest.artifacts.planRedactionAudit);
  const texts = [
    JSON.stringify(persistedPlan),
    JSON.stringify(persistedManifest),
    report,
    JSON.stringify(audit),
    JSON.stringify(planAudit),
  ];

  for (const text of texts) {
    assert.doesNotMatch(text, PERSISTED_PLAN_SECRET_PATTERN);
  }
  assert.match(JSON.stringify(persistedPlan), /\[REDACTED\]/u);
  assert.equal(persistedPlan.metadata.publicLabel, 'safe plan metadata');
}

test('download run manifest schema shape is stable', () => {
  const manifest = normalizeDownloadRunManifest({
    runId: 'run-1',
    planId: 'plan-1',
    siteKey: 'example',
    status: 'success',
    reason: 'success',
    counts: {
      expected: 1,
      attempted: 1,
      downloaded: 1,
      skipped: 0,
      failed: 0,
    },
    files: [{
      resourceId: 'resource-1',
      filePath: 'C:/tmp/run/files/0001-file.txt',
    }],
    failedResources: [],
    artifacts: {
      manifest: 'C:/tmp/run/manifest.json',
      queue: 'C:/tmp/run/queue.json',
      downloadsJsonl: 'C:/tmp/run/downloads.jsonl',
      reportMarkdown: 'C:/tmp/run/report.md',
      redactionAudit: 'C:/tmp/run/redaction-audit.json',
      lifecycleEvent: 'C:/tmp/run/lifecycle-event.json',
      lifecycleEventRedactionAudit: 'C:/tmp/run/lifecycle-event-redaction-audit.json',
      plan: 'C:/tmp/run/plan.json',
      planRedactionAudit: 'C:/tmp/run/plan-redaction-audit.json',
      resolvedTask: 'C:/tmp/run/resolved-task.json',
      standardTaskList: 'C:/tmp/run/standard-task-list.json',
      runDir: 'C:/tmp/run',
      filesDir: 'C:/tmp/run/files',
      source: {
        manifest: 'C:/tmp/legacy/manifest.json',
        mediaManifest: 'C:/tmp/legacy/media-manifest.json',
      },
    },
    createdAt: '2026-04-27T00:00:00.000Z',
    finishedAt: '2026-04-27T00:00:01.000Z',
  });

  assert.equal(manifest.schemaVersion, DOWNLOAD_RUN_MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.status, 'passed');
  assert.equal(manifest.reason, undefined);
  assert.deepEqual(Object.keys(manifest), [
    'schemaVersion',
    'runId',
    'planId',
    'siteKey',
    'status',
    'reason',
    'counts',
    'files',
    'failedResources',
    'resumeCommand',
    'artifacts',
    'legacy',
    'liveValidation',
    'session',
    'createdAt',
    'finishedAt',
  ]);
  assert.deepEqual(Object.keys(manifest.artifacts), [
    'schemaVersion',
    'manifest',
    'queue',
    'downloadsJsonl',
    'reportMarkdown',
    'redactionAudit',
    'lifecycleEvent',
    'lifecycleEventRedactionAudit',
    'plan',
    'planRedactionAudit',
    'resolvedTask',
    'standardTaskList',
    'runDir',
    'filesDir',
    'source',
  ]);
  assert.equal(manifest.artifacts.schemaVersion, 1);
  assert.deepEqual(manifest.artifacts.source, {
    manifest: 'C:/tmp/legacy/manifest.json',
    mediaManifest: 'C:/tmp/legacy/media-manifest.json',
  });
});

test('download manifest strips raw credential and session fields from file records', () => {
  const manifest = normalizeDownloadRunManifest({
    runId: 'run-file-boundary',
    planId: 'plan-file-boundary',
    siteKey: 'example',
    status: 'failed',
    counts: {
      expected: 2,
      attempted: 2,
      downloaded: 1,
      skipped: 0,
      failed: 1,
    },
    files: [{
      resourceId: 'resource-safe',
      filePath: 'C:/tmp/run/files/0001-safe.txt',
      mediaType: 'text',
      headers: { accept: 'text/plain' },
      credentials: { value: 'synthetic-redacted-file-field' },
      nested: {
        safe: 'kept',
        sessionState: { status: 'ready' },
      },
    }],
    failedResources: [{
      resourceId: 'resource-failed',
      url: 'https://example.com/failed.txt',
      reason: 'fetch-error',
      rawSessionLease: { mode: 'authenticated' },
      userDataDir: 'synthetic-redacted-session-field',
      safeDiagnostic: 'kept',
    }],
  });

  assert.deepEqual(manifest.files, [{
    resourceId: 'resource-safe',
    filePath: 'C:/tmp/run/files/0001-safe.txt',
    mediaType: 'text',
    nested: {
      safe: 'kept',
    },
  }]);
  assert.deepEqual(manifest.failedResources, [{
    resourceId: 'resource-failed',
    url: 'https://example.com/failed.txt',
    reason: 'fetch-error',
    safeDiagnostic: 'kept',
  }]);
  assert.doesNotMatch(
    JSON.stringify(manifest),
    /headers|credentials|rawSessionLease|userDataDir|sessionState|synthetic-redacted-/u,
  );
});

test('download run reasons consume the reasonCode catalog while preserving unknown legacy reasons', () => {
  assert.equal(
    normalizeDownloadRunReason('dry-run', 'skipped'),
    requireReasonCodeDefinition('dry-run', { family: 'download' }).code,
  );
  assert.equal(
    normalizeDownloadRunReason('no-resolved-resources', 'skipped'),
    requireReasonCodeDefinition('no-resolved-resources', { family: 'download' }).code,
  );
  assert.equal(normalizeDownloadRunReason('legacy-site-specific-reason', 'failed'), 'legacy-site-specific-reason');
});

test('download manifest session rejects incompatible SessionView versions', () => {
  assert.throws(
    () => normalizeDownloadRunManifest({
      runId: 'run-session-view-version',
      planId: 'plan-session-view-version',
      siteKey: 'example',
      status: 'blocked',
      session: {
        siteKey: 'example',
        host: 'example.test',
        status: 'blocked',
        reason: 'session-invalid',
        headers: { authorization: 'Bearer syntheticHeaderToken' },
        cookies: [{ name: 'sid', value: 'synthetic-cookie' }],
        sessionView: {
          schemaVersion: SESSION_VIEW_SCHEMA_VERSION + 1,
          siteKey: 'example',
          purpose: 'download',
          status: 'blocked',
          reasonCode: 'session-invalid',
        },
      },
    }),
    /not compatible/u,
  );
  assert.throws(
    () => normalizeDownloadRunManifest({
      runId: 'run-session-view-missing-version',
      planId: 'plan-session-view-missing-version',
      siteKey: 'example',
      status: 'blocked',
      session: {
        siteKey: 'example',
        host: 'example.test',
        status: 'blocked',
        sessionView: {
          siteKey: 'example',
          purpose: 'download',
          status: 'blocked',
        },
      },
    }),
    /schemaVersion is required/u,
  );
});

test('download manifest SessionView boundary uses the central compatibility registry', async () => {
  const contractsSource = await readFile(
    path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'contracts.mjs'),
    'utf8',
  );

  assert.match(
    contractsSource,
    /import \{ assertSchemaCompatible \} from '\.\.\/capability\/compatibility-registry\.mjs';/u,
  );
  assert.match(contractsSource, /normalizeDownloaderConsumerObject\(value\.sessionView\)/u);
  assert.match(contractsSource, /assertSchemaCompatible\('SessionView', consumerSessionView\)/u);
  assert.doesNotMatch(contractsSource, /assertSessionViewCompatible/u);
});

test('download CLI parser accepts resume flags emitted by manifests', () => {
  const resumeArgs = parseArgs([
    '--site',
    'bilibili',
    '--input',
    'BV1resume',
    '--execute',
    '--run-dir',
    path.join(os.tmpdir(), 'bwk-download-resume'),
    '--resume',
  ]);
  assert.equal(resumeArgs.resume, true);
  assert.equal(resumeArgs.dryRun, false);

  const retryFailedArgs = parseArgs([
    '--site',
    'bilibili',
    '--input',
    'BV1resume',
    '--execute',
    '--retry-failed',
  ]);
  assert.equal(retryFailedArgs.resume, true);
  assert.equal(retryFailedArgs.retryFailedOnly, true);

  const freshArgs = parseArgs([
    '--site',
    'bilibili',
    '--input',
    'BV1resume',
    '--execute',
    '--no-resume',
  ]);
  assert.equal(freshArgs.resume, false);
});

test('download task plan policy is normalized through DownloadPolicy while preserving legacy fields', () => {
  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/resource' },
    policy: {
      dryRun: false,
      allowNetworkResolve: true,
      retries: 3,
      retryBackoffMs: 250,
      cache: false,
      dedup: { enabled: false },
      sessionRequirement: 'required',
      concurrency: 7,
      skipExisting: false,
      verify: false,
      maxItems: 12,
      reasonCode: 'dry-run',
    },
  });

  assert.equal(plan.policy.schemaVersion, DOWNLOAD_POLICY_SCHEMA_VERSION);
  assert.equal(plan.policy.siteKey, 'example');
  assert.equal(plan.policy.taskType, 'generic-resource');
  assert.equal(plan.policy.dryRun, false);
  assert.equal(plan.policy.allowNetworkResolve, true);
  assert.equal(plan.policy.retries, 3);
  assert.equal(plan.policy.retryBackoffMs, 250);
  assert.deepEqual(plan.policy.cache, { enabled: false });
  assert.deepEqual(plan.policy.dedup, { enabled: false });
  assert.equal(plan.policy.sessionRequirement, 'required');
  assert.equal(plan.policy.reasonCode, 'dry-run');
  assert.equal(plan.policy.concurrency, 7);
  assert.equal(plan.policy.skipExisting, false);
  assert.equal(plan.policy.verify, false);
  assert.equal(plan.policy.maxItems, 12);

  const planWithTopLevelSessionRequirement = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/session-required' },
    sessionRequirement: 'required',
  });
  assert.equal(planWithTopLevelSessionRequirement.sessionRequirement, 'required');
  assert.equal(planWithTopLevelSessionRequirement.policy.sessionRequirement, 'required');

  assert.throws(
    () => normalizeDownloadTaskPlan({
      siteKey: 'example',
      host: 'example.com',
      taskType: 'generic-resource',
      source: { input: 'https://example.com/resource' },
      policy: { retries: -1 },
    }),
    /DownloadPolicy retries must be a non-negative number/u,
  );
});

test('download contracts infer site identity through the core SiteAdapter resolver', async () => {
  assert.equal(inferSiteKeyFromHost('www.22biqu.com'), '22biqu');
  assert.equal(inferSiteKeyFromHost('www.bilibili.com'), 'bilibili');
  assert.equal(inferSiteKeyFromHost('www.douyin.com'), 'douyin');
  assert.equal(inferSiteKeyFromHost('www.xiaohongshu.com'), 'xiaohongshu');
  assert.equal(inferSiteKeyFromHost('www.instagram.com'), 'instagram');
  assert.equal(inferSiteKeyFromHost('jable.tv'), 'jable');
  assert.equal(inferSiteKeyFromHost('downloads.example.test'), 'downloads.example.test');

  const plan = normalizeDownloadTaskPlan({
    host: 'www.bilibili.com',
    taskType: 'video',
    source: { input: 'BV1adapterResolver' },
  });
  assert.equal(plan.siteKey, 'bilibili');
  assert.equal(plan.resolver.adapterId, 'bilibili');

  const contractsSource = await readFile(
    path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'contracts.mjs'),
    'utf8',
  );
  assert.match(contractsSource, /resolveSiteKeyFromHost/u);
  assert.doesNotMatch(
    contractsSource,
    /case\s+['"](?:www\.22biqu\.com|www\.bilibili\.com|www\.douyin\.com|www\.xiaohongshu\.com|x\.com|www\.instagram\.com)['"]/u,
  );
});

test('download CLI parser exposes native network, mux, and live validation gates', () => {
  const args = parseArgs([
    '--site',
    'bilibili',
    '--input',
    'BV1live',
    '--resolve-network',
    '--enable-derived-mux',
    '--live-validation',
    'bilibili-dash-mux',
    '--live-approval-id',
    'approval-123',
    '--max-items',
    '2',
    '--profile-path',
    'profiles/douyin',
    '--browser-profile-root',
    'profiles',
    '--user-data-dir',
    'profiles/douyin-user-data',
    '--browser-path',
    'C:/Browser/chrome.exe',
    '--timeout',
    '30000',
    '--headless',
  ]);

  assert.equal(args.resolveNetwork, true);
  assert.equal(args.enableDerivedMux, true);
  assert.equal(args.maxItems, 2);
  assert.equal(args.profilePath, 'profiles/douyin');
  assert.equal(args.browserProfileRoot, 'profiles');
  assert.equal(args.userDataDir, 'profiles/douyin-user-data');
  assert.equal(args.browserPath, 'C:/Browser/chrome.exe');
  assert.equal(args.timeoutMs, 30000);
  assert.equal(args.headless, true);
  assert.deepEqual(args.liveValidation, {
    status: 'planned',
    scenario: 'bilibili-dash-mux',
    requiresApproval: true,
    approvalId: 'approval-123',
  });
});

test('download CLI emits a no-write plan JSON for live audit planning', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-plan-json-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  let output = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk, ...args) => {
    output += String(chunk);
    if (typeof args.at(-1) === 'function') args.at(-1)();
    return true;
  };
  try {
    await runDownloadCli([
      '--site',
      'bilibili',
      '--input',
      'BV1planJson',
      '--resolve-network',
      '--live-validation',
      'bilibili-bv-playurl',
      '--out-dir',
      runRoot,
      '--plan-json',
    ]);
  } finally {
    process.stdout.write = originalWrite;
  }

  const payload = JSON.parse(output);
  assert.equal(payload.status, 'planned');
  assert.equal(payload.noWrite, true);
  assert.equal(payload.siteKey, 'bilibili');
  assert.equal(payload.host, 'www.bilibili.com');
  assert.equal(payload.plan.policy.allowNetworkResolve, true);
  assert.equal(payload.liveValidation.scenario, 'bilibili-bv-playurl');
  assert.deepEqual(await readdir(runRoot), []);
  assert.throws(
    () => parseArgs(['--site', 'bilibili', '--input', 'BV1planJson', '--execute', '--plan-json']),
    /cannot be combined/u,
  );
});

test('download CLI parser accepts unified session manifest input', () => {
  const manifestPath = path.join(os.tmpdir(), 'bwk-session-health', 'manifest.json');
  const args = parseArgs([
    '--site',
    'x',
    '--input',
    'openai',
    '--session-required',
    '--session-manifest',
    manifestPath,
  ]);

  assert.equal(args.sessionRequirement, 'required');
  assert.equal(args.sessionManifest, manifestPath);
});

test('download CLI consumes session manifests without requiring an explicit host', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-session-manifest-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const sessionManifest = path.join(runRoot, 'session', 'manifest.json');
  await mkdir(path.dirname(sessionManifest), { recursive: true });
  await writeJsonFile(sessionManifest, normalizeSessionRunManifest({
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    purpose: 'download',
    status: 'ready',
    health: {
      siteKey: 'bilibili',
      host: 'www.bilibili.com',
      status: 'ready',
      authStatus: 'authenticated',
    },
    artifacts: {
      manifest: sessionManifest,
      runDir: path.dirname(sessionManifest),
    },
  }));

  let output = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk, ...args) => {
    output += String(chunk);
    if (typeof args.at(-1) === 'function') args.at(-1)();
    return true;
  };
  try {
    await runDownloadCli([
      '--site',
      'bilibili',
      '--input',
      'BV1sessionManifest',
      '--session-optional',
      '--session-manifest',
      sessionManifest,
      '--run-dir',
      path.join(runRoot, 'download'),
      '--json',
    ]);
  } finally {
    process.stdout.write = originalWrite;
  }

  const result = JSON.parse(output);
  assert.equal(result.manifest.status, 'skipped');
  assert.equal(result.manifest.reason, 'dry-run');
  assert.equal(result.plan.host, 'www.bilibili.com');
});

test('download CLI JSON stdout helper redacts sensitive diagnostics', () => {
  const output = downloadCliJson({
    manifest: {
      status: 'skipped',
      reason: 'dry-run',
      artifacts: {
        manifest: 'C:/tmp/download/manifest.json',
      },
    },
    sessionLease: {
      headers: {
        authorization: 'Bearer synthetic-download-cli-auth',
        cookie: 'SESSDATA=synthetic-download-cli-cookie',
      },
      cookies: [
        {
          name: 'SESSDATA',
          value: 'synthetic-download-cli-cookie',
        },
      ],
      csrf: 'synthetic-download-cli-csrf',
    },
    resource: {
      url: 'https://cdn.example.test/video.mp4?access_token=synthetic-download-cli-access',
    },
  });

  assert.doesNotMatch(
    output,
    /synthetic-download-cli-|access_token=|Authorization|SESSDATA|Bearer/iu,
  );
  const parsed = JSON.parse(output);
  assert.equal(parsed.manifest.status, 'skipped');
  assert.equal(parsed.sessionLease.headers, '[REDACTED]');
  assert.equal(parsed.sessionLease.cookies, '[REDACTED]');
  assert.equal(parsed.sessionLease.csrf, '[REDACTED]');
  assert.equal(parsed.resource.url.includes('[REDACTED]'), true);
});

test('download CLI JSON stdout helper fails closed without raw cause exposure', () => {
  const recovery = reasonCodeSummary('redaction-failed');
  const payload = {
    toJSON() {
      throw new Error(
        'Authorization: Bearer synthetic-download-cli-cause-token csrf=synthetic-download-cli-cause-csrf',
      );
    },
  };

  assert.throws(
    () => downloadCliJson(payload),
    (error) => {
      assert.equal(error.name, 'DownloadCliSummaryRedactionFailure');
      assert.equal(error.reasonCode, 'redaction-failed');
      assert.equal(error.retryable, recovery.retryable);
      assert.equal(error.cooldownNeeded, recovery.cooldownNeeded);
      assert.equal(error.isolationNeeded, recovery.isolationNeeded);
      assert.equal(error.manualRecoveryNeeded, recovery.manualRecoveryNeeded);
      assert.equal(error.degradable, recovery.degradable);
      assert.equal(error.artifactWriteAllowed, recovery.artifactWriteAllowed);
      assert.equal(error.catalogAction, recovery.catalogAction);
      assert.equal(error.diagnosticWriteAllowed, false);
      assert.equal(Object.hasOwn(error, 'cause'), false);
      assert.deepEqual(error.causeSummary, {
        name: 'Error',
        code: null,
      });
      assert.doesNotMatch(
        `${error.message}\n${JSON.stringify(error)}`,
        /synthetic-download-cli-cause-|Authorization: Bearer|csrf=/iu,
      );
      return true;
    },
  );
});

test('download CLI keeps explicit host checks for session manifests', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-session-host-mismatch-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const sessionManifest = path.join(runRoot, 'session', 'manifest.json');
  await mkdir(path.dirname(sessionManifest), { recursive: true });
  await writeJsonFile(sessionManifest, normalizeSessionRunManifest({
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    purpose: 'download',
    status: 'ready',
    health: {
      siteKey: 'bilibili',
      host: 'www.bilibili.com',
      status: 'ready',
    },
    artifacts: {
      manifest: sessionManifest,
      runDir: path.dirname(sessionManifest),
    },
  }));

  await assert.rejects(
    () => runDownloadCli([
      '--site',
      'bilibili',
      '--host',
      'm.bilibili.com',
      '--input',
      'BV1sessionManifest',
      '--session-manifest',
      sessionManifest,
      '--run-dir',
      path.join(runRoot, 'download'),
      '--json',
    ]),
    /Session manifest host mismatch: expected m.bilibili.com, got www.bilibili.com/u,
  );
});

test('download CLI parser accepts generated unified session health plans', () => {
  const args = parseArgs([
    '--site',
    'instagram',
    '--input',
    'openai',
    '--session-required',
    '--session-health-plan',
  ]);

  assert.equal(args.sessionRequirement, 'required');
  assert.equal(args.useUnifiedSessionHealth, true);
});

test('download CLI parser accepts sanitized planner handoff and session reason flags', () => {
  const args = parseArgs([
    '--site',
    'douyin',
    '--input',
    'https://www.douyin.com/video/1',
    '--session-status',
    'manual-required',
    '--session-reason',
    'session-invalid',
    '--planner-handoff',
    'runs/planner-handoff.json',
  ]);

  assert.equal(args.sessionStatus, 'manual-required');
  assert.equal(args.sessionReason, 'session-invalid');
  assert.equal(args.plannerHandoffPath, 'runs/planner-handoff.json');
});

test('download CLI parser defaults required sessions to unified health plans and keeps legacy opt-out', () => {
  const requiredArgs = parseArgs([
    '--site',
    'instagram',
    '--input',
    'openai',
    '--session-required',
  ]);
  const legacyArgs = parseArgs([
    '--site',
    'instagram',
    '--input',
    'openai',
    '--session-required',
    '--no-session-health-plan',
  ]);

  assert.equal(requiredArgs.useUnifiedSessionHealth, true);
  assert.equal(legacyArgs.useUnifiedSessionHealth, false);
});

test('download CLI help exposes unified session flags without running tasks', async () => {
  let output = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk, ...args) => {
    output += String(chunk);
    if (typeof args.at(-1) === 'function') args.at(-1)();
    return true;
  };
  try {
    await runDownloadCli(['--help']);
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.match(output, /--session-manifest <path>/u);
  assert.match(output, /--session-health-plan/u);
  assert.match(output, /--no-session-health-plan/u);
  assert.match(output, /--session-reason <reasonCode>/u);
  assert.match(output, /--planner-handoff <path>/u);
  assert.doesNotMatch(output, /^Status:/mu);
  assert.doesNotMatch(output, /^Manifest:/mu);
});

test('download CLI parser accepts derived mux compatibility aliases', () => {
  assert.equal(parseArgs(['--site', 'bilibili', '--input', 'BV1mux', '--mux-derived-media']).enableDerivedMux, true);
  assert.equal(parseArgs(['--site', 'bilibili', '--input', 'BV1mux', '--dash-mux']).enableDerivedMux, true);
});

test('download registry exposes dry-run plans for every configured download site', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-dry-run-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const definitions = await listDownloadSiteDefinitions(REPO_ROOT);
  const siteKeys = definitions.map((definition) => definition.siteKey).sort();
  assert.deepEqual(siteKeys, [
    '22biqu',
    'bilibili',
    'bz888',
    'douyin',
    'instagram',
    'x',
    'xiaohongshu',
  ]);

  for (const definition of definitions) {
    const result = await runDownloadTask({
      site: definition.siteKey,
      input: definition.canonicalBaseUrl ?? `https://${definition.host}/`,
      dryRun: true,
    }, {
      workspaceRoot: REPO_ROOT,
      runRoot,
    });
    assert.equal(result.plan.siteKey, definition.siteKey);
    assert.equal(result.manifest.status, 'skipped');
    assert.equal(result.manifest.reason, 'dry-run');
    assert.equal(result.manifest.artifacts.manifest.endsWith('manifest.json'), true);
    assert.equal((await readJsonFile(result.manifest.artifacts.manifest)).planId, result.plan.id);
  }
});

test('download runner normalizes unhealthy session leases as blocked manifests', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-blocked-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const result = await runDownloadTask({
    site: 'instagram',
    input: 'instagram',
    dryRun: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    sessionStatus: 'expired',
  });

  assert.equal(result.sessionLease.status, 'expired');
  assert.equal(result.manifest.status, 'blocked');
  assert.equal(result.manifest.reason, 'expired');
});

test('download runner preflight blocks required sessions before legacy spawn', async (t) => {
  for (const status of ['blocked', 'manual-required', 'expired', 'quarantine']) {
    await t.test(status, async (t) => {
      const runRoot = await mkdtemp(path.join(os.tmpdir(), `bwk-download-required-${status}-`));
      t.after(() => rm(runRoot, { recursive: true, force: true }));

      let legacyInvoked = false;
      const result = await runDownloadTask({
        site: 'instagram',
        input: 'openai',
        dryRun: false,
      }, {
        workspaceRoot: REPO_ROOT,
        runRoot,
      }, {
        inspectSessionHealth: async () => ({
          siteKey: 'instagram',
          host: 'www.instagram.com',
          status,
          reason: status === 'expired' ? undefined : `${status}-preflight`,
          riskSignals: status === 'expired' ? ['session-expired'] : [],
        }),
        acquireSessionLease: async () => {
          throw new Error('lease acquisition should not run after failed required preflight');
        },
        executeLegacyDownloadTask: async () => {
          legacyInvoked = true;
          throw new Error('legacy adapter should not execute after failed required preflight');
        },
      });

      assert.equal(legacyInvoked, false);
      assert.equal(result.sessionLease.status, status);
      assert.equal(result.manifest.status, 'blocked');
      assert.equal(result.manifest.reason, status === 'expired' ? 'session-expired' : `${status}-preflight`);
    });
  }
});

test('download runner sanitizes raw required preflight health before manifest and return', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-required-preflight-sanitized-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const result = await runDownloadTask({
    site: 'instagram',
    input: 'openai',
    dryRun: false,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    inspectSessionHealth: async () => ({
      siteKey: 'instagram',
      host: 'www.instagram.com',
      status: 'manual-required',
      reason: 'login-required',
      mode: 'authenticated',
      profilePath: 'C:/redacted/synthetic-preflight-profile.json',
      browserProfileRoot: 'C:/Users/example/preflight-profiles',
      userDataDir: 'C:/Users/example/preflight-profiles/instagram',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer synthetic-preflight-auth',
        Cookie: 'sessionid=synthetic-preflight-cookie',
        'User-Agent': 'synthetic-safe-preflight-agent',
        'X-CSRF-Token': 'synthetic-preflight-csrf',
      },
      cookies: [{ name: 'sessionid', value: 'synthetic-preflight-cookie' }],
      token: 'synthetic-preflight-token',
      accessToken: 'synthetic-preflight-access-token',
      refreshToken: 'synthetic-preflight-refresh-token',
      riskSignals: ['login-required'],
    }),
    acquireSessionLease: async () => {
      throw new Error('lease acquisition should not run after failed required preflight');
    },
    executeLegacyDownloadTask: async () => {
      throw new Error('legacy adapter should not execute after failed required preflight');
    },
  });

  assert.equal(result.sessionLease.status, 'manual-required');
  assert.deepEqual(result.sessionLease.headers, {
    Accept: 'application/json',
    'User-Agent': 'synthetic-safe-preflight-agent',
  });
  assert.deepEqual(result.sessionLease.cookies, []);
  assert.equal(result.sessionLease.profilePath, undefined);
  assert.equal(result.sessionLease.browserProfileRoot, undefined);
  assert.equal(result.sessionLease.userDataDir, undefined);
  assert.equal(result.sessionLease.token, undefined);
  assert.equal(result.sessionLease.accessToken, undefined);
  assert.equal(result.sessionLease.refreshToken, undefined);
  assert.equal(result.sessionLease.headers.Authorization, undefined);
  assert.equal(result.sessionLease.headers.Cookie, undefined);
  assert.equal(result.sessionLease.headers['X-CSRF-Token'], undefined);
  const rawPattern = /synthetic-preflight-(?:auth|cookie|csrf|profile|token|access-token|refresh-token)|C:\/Users\/example|profilePath|browserProfileRoot|userDataDir/iu;
  assert.doesNotMatch(JSON.stringify(result.sessionLease), rawPattern);

  assert.equal(result.manifest.status, 'blocked');
  assert.equal(result.manifest.reason, 'login-required');
  assert.equal(result.manifest.session.headers, undefined);
  assert.equal(result.manifest.session.cookies, undefined);
  assert.doesNotMatch(JSON.stringify(result.manifest.session), rawPattern);

  const persistedManifest = await readJsonFile(result.manifest.artifacts.manifest);
  assert.equal(persistedManifest.status, 'blocked');
  assert.equal(persistedManifest.session.headers, undefined);
  assert.equal(persistedManifest.session.cookies, undefined);
  assert.doesNotMatch(JSON.stringify(persistedManifest), rawPattern);
});

test('download terminal manifest writer redacts synthetic forbidden session signals before persisting', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-terminal-redaction-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const hookRegistry = createCapabilityHookRegistry([{
    id: 'download-run-terminal-observer',
    phase: 'after_download',
    subscriber: {
      name: 'download-run-terminal-observer',
      modulePath: 'src/sites/capability/lifecycle-events.mjs',
      entrypoint: 'observe',
      order: 1,
    },
    filters: {
      eventTypes: ['download.run.terminal'],
      siteKeys: ['instagram'],
      reasonCodes: ['login-required'],
    },
  }]);

  const result = await runDownloadTask({
    site: 'instagram',
    input: 'openai',
    dryRun: false,
    adapterVersion: 'instagram-adapter-v1',
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    inspectSessionHealth: async () => ({
      siteKey: 'instagram',
      host: 'www.instagram.com',
      status: 'manual-required',
      reason: 'login-required',
      riskSignals: ['refresh_token=synthetic-download-refresh-token'],
    }),
    acquireSessionLease: async () => {
      throw new Error('lease acquisition should not run after failed required preflight');
    },
    executeLegacyDownloadTask: async () => {
      throw new Error('legacy adapter should not execute after failed required preflight');
    },
    capabilityHookRegistry: hookRegistry,
  });

  const persisted = await readJsonFile(result.manifest.artifacts.manifest);
  const loginRequiredReason = requireReasonCodeDefinition('login-required', { family: 'session' });
  const expectedLoginRequiredRecovery = {
    retryable: loginRequiredReason.retryable,
    cooldownNeeded: loginRequiredReason.cooldownNeeded,
    isolationNeeded: loginRequiredReason.isolationNeeded,
    manualRecoveryNeeded: loginRequiredReason.manualRecoveryNeeded,
    degradable: loginRequiredReason.degradable,
    artifactWriteAllowed: loginRequiredReason.artifactWriteAllowed,
    catalogAction: loginRequiredReason.catalogAction,
    discardCatalog: loginRequiredReason.catalogAction !== 'none',
  };
  const expectedLoginRequiredSummaryRecovery = {
    retryable: loginRequiredReason.retryable,
    cooldownNeeded: loginRequiredReason.cooldownNeeded,
    isolationNeeded: loginRequiredReason.isolationNeeded,
    manualRecoveryNeeded: loginRequiredReason.manualRecoveryNeeded,
    degradable: loginRequiredReason.degradable,
    artifactWriteAllowed: loginRequiredReason.artifactWriteAllowed,
    catalogAction: loginRequiredReason.catalogAction,
    discardCatalog: loginRequiredReason.catalogAction !== 'none',
  };
  assert.equal(JSON.stringify(persisted).includes('synthetic-download-refresh-token'), false);
  assert.deepEqual(persisted.session.riskSignals, [REDACTION_PLACEHOLDER]);
  assert.equal(persisted.riskState.schemaVersion, RISK_STATE_SCHEMA_VERSION);
  assert.equal(persisted.riskState.state, 'manual_recovery_required');
  assert.equal(persisted.riskState.reasonCode, 'login-required');
  assert.equal(persisted.riskState.scope, 'download-session');
  assert.equal(persisted.riskState.siteKey, 'instagram');
  assert.equal(persisted.riskState.taskId, persisted.runId);
  assert.equal(persisted.riskState.transition.from, 'normal');
  assert.equal(persisted.riskState.transition.to, 'manual_recovery_required');
  assert.equal(assertSchemaCompatible('RiskState', persisted.riskState), true);
  assert.deepEqual(persisted.riskState.recovery, expectedLoginRequiredRecovery);
  assert.equal(JSON.stringify(persisted.riskState).includes('synthetic-download-refresh-token'), false);
  assert.equal(typeof persisted.artifacts.redactionAudit, 'string');
  const audit = await readJsonFile(persisted.artifacts.redactionAudit);
  assert.equal(JSON.stringify(audit).includes('synthetic-download-refresh-token'), false);
  assert.deepEqual(audit.redactedPaths, ['session.riskSignals.0']);
  assert.deepEqual(audit.findings, [{
    path: 'session.riskSignals.0',
    pattern: 'sensitive-query-assignment',
  }]);
  assert.equal(typeof persisted.artifacts.lifecycleEvent, 'string');
  assert.equal(typeof persisted.artifacts.lifecycleEventRedactionAudit, 'string');
  const lifecycleEvent = await readJsonFile(persisted.artifacts.lifecycleEvent);
  assert.equal(lifecycleEvent.schemaVersion, LIFECYCLE_EVENT_SCHEMA_VERSION);
  assert.equal(assertSchemaCompatible('LifecycleEvent', lifecycleEvent), true);
  assert.equal(assertLifecycleEventObservabilityFields(lifecycleEvent, {
    requiredFields: [
      'traceId',
      'correlationId',
      'taskId',
      'siteKey',
      'taskType',
      'adapterVersion',
      'reasonCode',
    ],
    requiredDetailFields: [
      'riskState',
      'riskSignals',
      'capabilityHookMatches',
    ],
  }), true);
  assert.equal(lifecycleEvent.eventType, 'download.run.terminal');
  assert.equal(lifecycleEvent.traceId, persisted.runId);
  assert.equal(lifecycleEvent.correlationId, persisted.planId);
  assert.equal(lifecycleEvent.taskId, persisted.runId);
  assert.equal(lifecycleEvent.siteKey, 'instagram');
  assert.equal(lifecycleEvent.taskType, result.plan.taskType);
  assert.equal(result.plan.adapterVersion, 'instagram-adapter-v1');
  assert.equal(lifecycleEvent.adapterVersion, 'instagram-adapter-v1');
  assert.equal(lifecycleEvent.reasonCode, 'login-required');
  assert.deepEqual(lifecycleEvent.details.riskSignals, [REDACTION_PLACEHOLDER]);
  assert.deepEqual(lifecycleEvent.details.riskState, {
    schemaVersion: RISK_STATE_SCHEMA_VERSION,
    state: 'manual_recovery_required',
    reasonCode: 'login-required',
    scope: 'download-session',
    recovery: expectedLoginRequiredSummaryRecovery,
    transition: {
      from: 'normal',
      to: 'manual_recovery_required',
    },
  });
  assert.equal(Object.hasOwn(lifecycleEvent.details.riskState, 'siteKey'), false);
  assert.equal(Object.hasOwn(lifecycleEvent.details.riskState, 'taskId'), false);
  assert.equal(Object.hasOwn(lifecycleEvent.details.riskState, 'profile'), false);
  assert.equal(Object.hasOwn(lifecycleEvent.details.riskState, 'session'), false);
  assert.deepEqual(lifecycleEvent.details.capabilityHookMatches.phases, [
    'after_download',
    'on_manual_recovery_required',
    'on_completion',
  ]);
  assert.equal(lifecycleEvent.details.capabilityHookMatches.matchCount, 1);
  assert.equal(
    lifecycleEvent.details.capabilityHookMatches.matches[0].id,
    'download-run-terminal-observer',
  );
  assert.equal(
    Object.hasOwn(lifecycleEvent.details.capabilityHookMatches.matches[0].subscriber, 'modulePath'),
    false,
  );
  assert.equal(
    Object.hasOwn(lifecycleEvent.details.capabilityHookMatches.matches[0].subscriber, 'entrypoint'),
    false,
  );
  assert.equal(JSON.stringify(lifecycleEvent.details.riskState).includes('synthetic-download-refresh-token'), false);
  assert.equal(JSON.stringify(lifecycleEvent).includes('synthetic-download-refresh-token'), false);
  const lifecycleAudit = await readJsonFile(persisted.artifacts.lifecycleEventRedactionAudit);
  assert.equal(JSON.stringify(lifecycleAudit).includes('synthetic-download-refresh-token'), false);
  assert.equal(lifecycleAudit.redactedPaths.includes('details.riskSignals.0'), true);
  assert.deepEqual(lifecycleAudit.findings, [{
    path: 'details.riskSignals.0',
    pattern: 'sensitive-query-assignment',
  }]);
  assert.deepEqual(result.manifest.session.riskSignals, ['refresh_token=synthetic-download-refresh-token']);
});

test('download plan artifacts redact sensitive source fields across terminal executor and legacy writers', async (t) => {
  const terminalRunRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-plan-terminal-boundary-'));
  const executorRunRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-plan-executor-boundary-'));
  const legacyRunRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-plan-legacy-boundary-'));
  t.after(() => rm(terminalRunRoot, { recursive: true, force: true }));
  t.after(() => rm(executorRunRoot, { recursive: true, force: true }));
  t.after(() => rm(legacyRunRoot, { recursive: true, force: true }));

  const terminalPlan = sensitiveDownloadPlan({
    policy: {
      dryRun: false,
      verify: false,
      retries: 0,
    },
    output: { root: terminalRunRoot },
  });
  const terminalResult = await runDownloadTask({}, {
    workspaceRoot: REPO_ROOT,
    runRoot: terminalRunRoot,
    dryRun: false,
  }, {
    resolveDownloadSiteDefinition: async () => ({ site: 'example' }),
    createDownloadPlan: async () => terminalPlan,
    acquireSessionLease: async () => ({
      siteKey: 'example',
      host: 'example.com',
      status: 'ready',
      mode: 'anonymous',
      riskSignals: [],
    }),
    releaseSessionLease: async () => {},
    resolveDownloadResources: async () => ({
      planId: terminalPlan.id,
      siteKey: 'example',
      taskType: 'generic-resource',
      resources: [],
      groups: [],
      metadata: {
        resolver: { method: 'synthetic-no-resources' },
        note: 'Cookie: sid=synthetic-terminal-resolved-cookie',
        diagnostic: 'Authorization: Bearer synthetic-terminal-resolved-auth',
      },
      completeness: {
        expectedCount: 0,
        resolvedCount: 0,
        complete: false,
        reason: 'synthetic-no-resources',
      },
    }),
  });
  assert.equal(terminalResult.manifest.reason, 'no-resolved-resources');
  await assertPersistedPlanBoundary(terminalResult.manifest);
  const terminalPersistedManifest = await readJsonFile(terminalResult.manifest.artifacts.manifest);
  const terminalResolvedTask = await readJsonFile(terminalPersistedManifest.artifacts.resolvedTask);
  assert.doesNotMatch(
    JSON.stringify(terminalResolvedTask),
    /synthetic-terminal-resolved-|Authorization|Cookie|Bearer/iu,
  );

  const executorPlan = sensitiveDownloadPlan({
    output: { root: executorRunRoot },
  });
  const executorManifest = await executeResolvedDownloadTask({
    planId: executorPlan.id,
    siteKey: 'example',
    taskType: 'generic-resource',
    resources: [{
      id: 'safe-plan-resource',
      url: 'https://example.com/safe-media.mp4',
      method: 'GET',
      headers: {},
      fileName: 'safe-media.mp4',
      mediaType: 'video',
      sourceUrl: 'https://example.com/source',
      referer: 'https://example.com/source',
      priority: 0,
      metadata: {},
    }],
    groups: [],
    metadata: { resolver: { method: 'synthetic-safe-resource' } },
    completeness: {
      expectedCount: 1,
      resolvedCount: 1,
      complete: true,
      reason: 'synthetic-safe-resource',
    },
  }, executorPlan, {
    siteKey: 'example',
    host: 'example.com',
    status: 'ready',
    mode: 'anonymous',
    riskSignals: [],
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot: executorRunRoot,
    dryRun: true,
  });
  await assertPersistedPlanBoundary(executorManifest);

  const legacyPlan = sensitiveDownloadPlan({
    policy: {
      dryRun: false,
      verify: false,
      retries: 0,
    },
    output: { root: legacyRunRoot },
    legacy: {
      entrypoint: 'src/entrypoints/sites/download.mjs',
      executorKind: 'node',
    },
  });
  const legacyManifest = await executeLegacyDownloadTask(legacyPlan, {
    siteKey: 'example',
    host: 'example.com',
    status: 'ready',
    mode: 'anonymous',
    riskSignals: [],
  }, {
    input: legacyPlan.source.input,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot: legacyRunRoot,
  }, {
    spawnJsonCommand: async () => ({
      code: 0,
      stderr: '',
      stdout: JSON.stringify({
        ok: true,
        status: 'passed',
        counts: {
          expected: 0,
          downloaded: 0,
          skipped: 0,
          failed: 0,
        },
        results: [],
      }),
    }),
  });
  await assertPersistedPlanBoundary(legacyManifest);
});

test('download runner does not forward request raw headers or cookies to session health', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-health-options-boundary-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  let inspectedOptions = null;

  const result = await runDownloadTask({
    site: 'instagram',
    input: 'openai',
    dryRun: false,
    headers: {
      Authorization: 'Bearer synthetic-request-health-token',
      'X-CSRF-Token': 'synthetic-request-health-csrf',
      Range: 'bytes=0-1',
    },
    downloadHeaders: {
      Cookie: 'sid=synthetic-request-health-cookie',
      Referer: 'https://www.instagram.com/',
    },
    cookies: [{ name: 'sid', value: 'synthetic-request-health-cookie' }],
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    inspectSessionHealth: async (_siteKey, options) => {
      inspectedOptions = options;
      return {
        siteKey: 'instagram',
        host: 'www.instagram.com',
        status: 'manual-required',
        reason: 'login-required',
        riskSignals: ['not-logged-in'],
      };
    },
    acquireSessionLease: async () => {
      throw new Error('lease acquisition should not run after blocked session health');
    },
    executeLegacyDownloadTask: async () => {
      throw new Error('legacy adapter should not execute after blocked session health');
    },
  });

  assert.ok(inspectedOptions);
  assert.equal(Object.hasOwn(inspectedOptions, 'headers'), false);
  assert.equal(Object.hasOwn(inspectedOptions, 'downloadHeaders'), false);
  assert.equal(Object.hasOwn(inspectedOptions, 'cookies'), false);
  assert.doesNotMatch(
    JSON.stringify(inspectedOptions),
    /synthetic-request-health-|authorization|cookie|csrf|Bearer/iu,
  );
  assert.equal(result.manifest.status, 'blocked');
  const persisted = await readJsonFile(result.manifest.artifacts.manifest);
  assert.doesNotMatch(
    JSON.stringify(persisted),
    /synthetic-request-health-|authorization|cookie|csrf|Bearer/iu,
  );
});

test('download terminal no-resolved-resources writes an empty StandardTaskList artifact', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-terminal-standard-task-list-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/no-resources' },
    policy: { dryRun: false },
    output: { root: runRoot },
  });

  const result = await runDownloadTask({
    site: 'example',
    input: 'https://example.com/no-resources',
    dryRun: false,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    resolveDownloadSiteDefinition: async () => ({
      siteKey: 'example',
      host: 'example.com',
      sessionRequirement: 'none',
    }),
    createDownloadPlan: async () => plan,
    acquireSessionLease: async () => ({
      siteKey: 'example',
      host: 'example.com',
      mode: 'anonymous',
      status: 'ready',
      headers: {
        Authorization: 'Bearer synthetic-terminal-riskstate-token',
        Cookie: 'sid=synthetic-terminal-riskstate-cookie',
      },
      cookies: [{ name: 'sid', value: 'synthetic-terminal-riskstate-cookie' }],
      profilePath: 'C:/Users/example/raw-terminal-profile',
      riskSignals: ['refresh_token=synthetic-terminal-riskstate-refresh-token'],
      sessionView: {
        schemaVersion: SESSION_VIEW_SCHEMA_VERSION,
        siteKey: 'example',
        purpose: 'download',
        status: 'ready',
        profileRef: 'anonymous',
        permission: ['read'],
        ttlSeconds: 60,
        networkContext: { host: 'example.com' },
      },
    }),
    releaseSessionLease: async () => {},
    resolveDownloadResources: async () => ({
      planId: plan.id,
      siteKey: plan.siteKey,
      taskType: plan.taskType,
      resources: [],
      completeness: {
        expectedCount: 0,
        resolvedCount: 0,
        complete: false,
        reason: 'no-resolved-resources',
      },
    }),
    executeLegacyDownloadTask: async () => {
      throw new Error('legacy executor should not run without a legacy entrypoint');
    },
  });

  assert.equal(result.manifest.status, 'skipped');
  assert.equal(result.manifest.reason, 'no-resolved-resources');
  const persisted = await readJsonFile(result.manifest.artifacts.manifest);
  const noResourcesReason = requireReasonCodeDefinition('no-resolved-resources', { family: 'download' });
  const expectedRiskRecovery = {
    retryable: noResourcesReason.retryable,
    cooldownNeeded: true,
    isolationNeeded: noResourcesReason.isolationNeeded,
    manualRecoveryNeeded: noResourcesReason.manualRecoveryNeeded,
    degradable: noResourcesReason.degradable,
    artifactWriteAllowed: noResourcesReason.artifactWriteAllowed,
    catalogAction: noResourcesReason.catalogAction,
    discardCatalog: noResourcesReason.catalogAction !== 'none',
  };
  assert.equal(persisted.riskState.schemaVersion, RISK_STATE_SCHEMA_VERSION);
  assert.equal(persisted.riskState.state, 'suspicious');
  assert.equal(persisted.riskState.reasonCode, 'no-resolved-resources');
  assert.equal(persisted.riskState.scope, 'download-terminal');
  assert.equal(persisted.riskState.siteKey, 'example');
  assert.equal(persisted.riskState.taskId, persisted.runId);
  assert.equal(persisted.riskState.transition.from, 'normal');
  assert.equal(persisted.riskState.transition.to, 'suspicious');
  assert.equal(Number.isNaN(Date.parse(persisted.riskState.transition.observedAt)), false);
  assert.deepEqual(persisted.riskState.recovery, expectedRiskRecovery);
  assert.equal(assertSchemaCompatible('RiskState', persisted.riskState), true);
  assert.doesNotMatch(
    JSON.stringify(persisted),
    /synthetic-terminal-riskstate-|headers|authorization|cookie|csrf|Bearer|profilePath|raw-terminal-profile/iu,
  );
  assert.equal(typeof persisted.artifacts.standardTaskList, 'string');
  const standardTaskList = await readJsonFile(persisted.artifacts.standardTaskList);
  assert.equal(standardTaskList.schemaVersion, STANDARD_TASK_LIST_SCHEMA_VERSION);
  assert.equal(standardTaskList.siteKey, 'example');
  assert.equal(standardTaskList.taskType, 'generic-resource');
  assert.equal(standardTaskList.policyRef, `download-plan:${plan.id}:policy`);
  assert.deepEqual(standardTaskList.items, []);
  assert.deepEqual(await readJsonFile(persisted.artifacts.queue), []);
  assert.deepEqual(await readJsonLinesFile(persisted.artifacts.downloadsJsonl), []);
  assert.doesNotMatch(JSON.stringify(standardTaskList), /synthetic-|headers|authorization|cookie|csrf|Bearer/iu);
  const lifecycleEvent = await readJsonFile(persisted.artifacts.lifecycleEvent);
  assert.equal(lifecycleEvent.eventType, 'download.run.terminal');
  assert.equal(assertSchemaCompatible('LifecycleEvent', lifecycleEvent), true);
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
      'riskState',
    ],
  }), true);
  assert.deepEqual(lifecycleEvent.details.riskState, {
    schemaVersion: RISK_STATE_SCHEMA_VERSION,
    state: 'suspicious',
    reasonCode: 'no-resolved-resources',
    scope: 'download-terminal',
    recovery: expectedRiskRecovery,
    transition: {
      from: 'normal',
      to: 'suspicious',
    },
  });
  assert.equal(Object.hasOwn(lifecycleEvent.details.riskState, 'siteKey'), false);
  assert.equal(Object.hasOwn(lifecycleEvent.details.riskState, 'taskId'), false);
  assert.equal(Object.hasOwn(lifecycleEvent.details.riskState, 'session'), false);
  assert.equal(lifecycleEvent.details.profileRef, 'anonymous');
  assert.equal(lifecycleEvent.details.sessionMaterialization, REDACTION_PLACEHOLDER);
  const lifecycleAudit = await readJsonFile(persisted.artifacts.lifecycleEventRedactionAudit);
  assert.equal(lifecycleAudit.redactedPaths.includes('details.sessionMaterialization'), true);
  assert.equal(lifecycleAudit.redactedPaths.includes('details.riskSignals.0'), true);
  const sessionMaterializationAudit = persisted.session.sessionViewMaterializationAudit;
  assert.equal(sessionMaterializationAudit.eventType, 'session.materialized');
  assert.equal(sessionMaterializationAudit.boundary, 'SessionView');
  assert.equal(sessionMaterializationAudit.siteKey, 'example');
  assert.equal(sessionMaterializationAudit.profileRef, 'anonymous');
  assert.equal(sessionMaterializationAudit.purpose, 'download');
  assert.deepEqual(sessionMaterializationAudit.permission, ['read']);
  assert.equal(sessionMaterializationAudit.status, 'ready');
  assert.equal(sessionMaterializationAudit.rawCredentialAccess, false);
  assert.equal(sessionMaterializationAudit.artifactPersistenceAllowed, false);
  assert.deepEqual(sessionMaterializationAudit.revocation, {
    boundary: 'SessionProvider',
    handlePresent: false,
    reasonCode: 'session-revocation-handle-missing',
  });
  assert.doesNotMatch(
    JSON.stringify(lifecycleEvent),
    /synthetic-|headers|authorization|cookie|csrf|Bearer|profilePath|browserProfileRoot|userDataDir/iu,
  );
});

test('download terminal lifecycle subscriber failure fails closed before manifest write', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-terminal-lifecycle-failure-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const runId = 'terminal-lifecycle-failure';

  await assert.rejects(
    () => runDownloadTask({
      site: 'instagram',
      input: 'openai',
      dryRun: false,
    }, {
      workspaceRoot: REPO_ROOT,
      runRoot,
      runId,
    }, {
      inspectSessionHealth: async () => ({
        siteKey: 'instagram',
        host: 'www.instagram.com',
        status: 'manual-required',
        reason: 'login-required',
      }),
      lifecycleEventSubscribers: [
        async () => {
          throw new Error('synthetic-download-lifecycle-failure');
        },
      ],
      acquireSessionLease: async () => {
        throw new Error('lease acquisition should not run after failed required preflight');
      },
      executeLegacyDownloadTask: async () => {
        throw new Error('legacy adapter should not execute after failed required preflight');
      },
    }),
    /synthetic-download-lifecycle-failure/u,
  );
  await assert.rejects(
    () => readFile(path.join(runRoot, runId, 'manifest.json'), 'utf8'),
    /ENOENT/u,
  );
  await assert.rejects(
    () => readFile(path.join(runRoot, runId, 'lifecycle-event.json'), 'utf8'),
    /ENOENT/u,
  );
  await assert.rejects(
    () => readFile(path.join(runRoot, runId, 'lifecycle-event-redaction-audit.json'), 'utf8'),
    /ENOENT/u,
  );
});

test('download runner writes sanitized session metadata to manifests', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-session-sanitized-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const result = await runDownloadTask({
    site: 'instagram',
    input: 'openai',
    dryRun: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    inspectSessionHealth: async () => ({
      siteKey: 'instagram',
      host: 'www.instagram.com',
      status: 'ready',
      mode: 'authenticated',
      riskSignals: [],
    }),
    acquireSessionLease: async () => ({
      siteKey: 'instagram',
      host: 'www.instagram.com',
      mode: 'authenticated',
      status: 'ready',
      profilePath: 'C:/redacted/synthetic-legacy-profile.json',
      browserProfileRoot: 'C:/Users/example/profiles',
      userDataDir: 'C:/Users/example/profiles/instagram',
      headers: {
        Accept: 'application/json',
        Cookie: 'sessionid=secret',
        Authorization: 'Bearer secret',
        'User-Agent': 'synthetic-safe-runner-agent',
      },
      cookies: [{ name: 'sessionid', value: 'secret' }],
      riskSignals: ['profile-warmed'],
      quarantineKey: 'www.instagram.com:download',
      purpose: 'download:social-archive',
    }),
    resolveDownloadResources: async () => ({
      resources: [{
        id: 'media-1',
        url: 'https://cdn.example.test/openai.jpg',
        fileName: 'openai.jpg',
        mediaType: 'image',
      }],
    }),
  });

  assert.deepEqual(result.sessionLease.headers, {
    Accept: 'application/json',
    'User-Agent': 'synthetic-safe-runner-agent',
  });
  assert.deepEqual(result.sessionLease.cookies, []);
  assert.equal(result.sessionLease.profilePath, undefined);
  assert.equal(result.sessionLease.browserProfileRoot, undefined);
  assert.equal(result.sessionLease.userDataDir, undefined);
  assert.doesNotMatch(
    JSON.stringify(result.sessionLease),
    /sessionid=secret|Bearer secret|synthetic-legacy-profile|C:\/Users\/example|profilePath|browserProfileRoot|userDataDir/iu,
  );
  assert.equal(result.manifest.status, 'skipped');
  assert.equal(result.manifest.session.status, 'ready');
  assert.equal(result.manifest.session.mode, 'authenticated');
  assert.deepEqual(result.manifest.session.riskSignals, ['profile-warmed']);
  assert.equal(result.manifest.session.quarantineKey, 'www.instagram.com:download');
  assert.equal(result.manifest.session.headers, undefined);
  assert.equal(result.manifest.session.cookies, undefined);
  assert.equal(result.manifest.session.profilePath, undefined);
  assert.equal(result.manifest.session.browserProfileRoot, undefined);
  assert.equal(result.manifest.session.userDataDir, undefined);
  assert.doesNotMatch(
    JSON.stringify(result.manifest.session),
    /synthetic-legacy-profile|C:\/Users\/example|profilePath|browserProfileRoot|userDataDir/iu,
  );

  const persisted = await readJsonFile(result.manifest.artifacts.manifest);
  assert.equal(persisted.session.headers, undefined);
  assert.equal(persisted.session.cookies, undefined);
  assert.equal(persisted.session.profilePath, undefined);
  assert.equal(persisted.session.browserProfileRoot, undefined);
  assert.equal(persisted.session.userDataDir, undefined);
  assert.doesNotMatch(
    JSON.stringify(persisted.session),
    /synthetic-legacy-profile|C:\/Users\/example|profilePath|browserProfileRoot|userDataDir/iu,
  );
});

test('legacy raw-capable session acquisition carries a minimal SessionView boundary', async () => {
  const lease = await acquireSessionLease('instagram', 'download', {
    host: 'www.instagram.com',
    profile: { host: 'www.instagram.com' },
    sessionRequirement: 'required',
    headers: {
      Authorization: 'Bearer synthetic-legacy-sessionview-token',
      Cookie: 'sessionid=synthetic-legacy-sessionview-cookie',
    },
    cookies: [{ name: 'sessionid', value: 'synthetic-legacy-sessionview-cookie' }],
    browserProfileRoot: 'C:/Users/example/profiles',
    userDataDir: 'C:/Users/example/profiles/instagram',
    expiresAt: '2026-05-01T09:00:00.000Z',
  }, {
    inspectReusableSiteSession: async () => null,
  });

  assert.equal(lease.status, 'ready');
  assert.equal(lease.browserProfileRoot, undefined);
  assert.equal(lease.userDataDir, undefined);
  assert.deepEqual(lease.headers, {});
  assert.deepEqual(lease.cookies, []);
  assert.deepEqual(lease.rawMaterialIsolation, {
    ...LEGACY_RAW_SESSION_LEASE_ISOLATION,
    rawHeadersPresent: true,
    rawCookiesPresent: true,
    profileMaterialPresent: true,
    sessionViewPresent: true,
  });
  assert.equal(lease.rawMaterialIsolation.artifactPersistenceAllowed, false);
  assert.equal(lease.rawMaterialIsolation.normalConsumerBoundary, 'SessionView');
  assert.equal(lease.rawMaterialIsolation.consumerHeaderBoundary, 'normalizeSessionLeaseConsumerHeaders');
  assert.equal(lease.sessionView.schemaVersion, SESSION_VIEW_SCHEMA_VERSION);
  assert.equal(assertSchemaCompatible('SessionView', lease.sessionView), true);
  assert.equal(lease.sessionViewMaterializationAudit.eventType, 'session.materialized');
  assert.equal(lease.sessionViewMaterializationAudit.boundary, 'SessionView');
  assert.equal(lease.sessionViewMaterializationAudit.siteKey, 'instagram');
  assert.equal(lease.sessionViewMaterializationAudit.profileRef, 'anonymous');
  assert.deepEqual(lease.sessionViewMaterializationAudit.permission, ['read']);
  assert.equal(lease.sessionViewMaterializationAudit.rawCredentialAccess, false);
  assert.equal(lease.sessionViewMaterializationAudit.artifactPersistenceAllowed, false);
  assert.deepEqual(lease.sessionViewMaterializationAudit.purposeIsolation, {
    enforced: true,
    purpose: 'download',
    scope: ['instagram', 'www.instagram.com', 'download'],
  });
  assert.deepEqual(lease.sessionViewMaterializationAudit.revocation, {
    boundary: 'SessionProvider',
    handlePresent: false,
    reasonCode: 'session-revocation-handle-missing',
  });
  assert.equal(lease.sessionView.siteKey, 'instagram');
  assert.equal(lease.sessionView.purpose, 'download');
  assert.equal(lease.sessionView.profileRef, 'anonymous');
  assert.deepEqual(lease.sessionView.permission, ['read']);
  assert.equal(lease.sessionView.ttlSeconds, 300);
  assert.equal(lease.sessionView.networkContext.host, 'www.instagram.com');
  assert.equal(lease.sessionView.expiresAt, '2026-05-01T09:00:00.000Z');
  assert.doesNotMatch(
    JSON.stringify(lease.sessionView),
    /synthetic-legacy-sessionview-|authorization|cookie|headers|userDataDir|browserProfileRoot|Bearer/iu,
  );
  assert.doesNotMatch(
    JSON.stringify(lease.sessionViewMaterializationAudit),
    /synthetic-legacy-sessionview-|authorization|cookie|headers|C:\/Users\/example|userDataDir|browserProfileRoot|Bearer/iu,
  );
  assert.doesNotMatch(
    JSON.stringify(lease.rawMaterialIsolation),
    /synthetic-legacy-sessionview-|authorization|C:\/Users\/example|userDataDir|browserProfileRoot|Bearer/iu,
  );
  assert.doesNotMatch(
    JSON.stringify(lease),
    /synthetic-legacy-sessionview-|C:\/Users\/example|Bearer/iu,
  );
});

test('SessionView-backed session leases isolate raw legacy headers and cookies', () => {
  const lease = normalizeSessionLease({
    siteKey: 'example',
    host: 'example.com',
    mode: 'authenticated',
    status: 'ready',
    purpose: 'download',
    headers: {
      Accept: 'application/json',
      Range: 'bytes=0-1023',
      Authorization: 'Bearer synthetic-sessionview-first-token',
      Cookie: 'sid=synthetic-sessionview-first-cookie',
      'X-CSRF-Token': 'synthetic-sessionview-first-csrf',
    },
    cookies: [{ name: 'sid', value: 'synthetic-sessionview-first-cookie' }],
    browserProfileRoot: 'C:/Users/example/profiles',
    userDataDir: 'C:/Users/example/profiles/example',
    sessionView: {
      schemaVersion: SESSION_VIEW_SCHEMA_VERSION,
      siteKey: 'example',
      purpose: 'download',
      status: 'ready',
      permission: ['read'],
      ttlSeconds: 60,
      networkContext: { host: 'example.com' },
    },
  });

  assert.equal(lease.browserProfileRoot, undefined);
  assert.equal(lease.userDataDir, undefined);
  assert.deepEqual(lease.headers, {});
  assert.deepEqual(lease.cookies, []);
  assert.deepEqual(normalizeSessionLeaseConsumerHeaders(lease), {});
  assert.deepEqual(lease.rawMaterialIsolation, {
    ...LEGACY_RAW_SESSION_LEASE_ISOLATION,
    rawHeadersPresent: true,
    rawCookiesPresent: true,
    profileMaterialPresent: true,
    sessionViewPresent: true,
  });
  assert.equal(assertSchemaCompatible('SessionView', lease.sessionView), true);
  assert.equal(lease.sessionViewMaterializationAudit.eventType, 'session.materialized');
  assert.equal(lease.sessionViewMaterializationAudit.profileRef, 'anonymous');
  assert.equal(lease.sessionViewMaterializationAudit.rawCredentialAccess, false);
  assert.equal(lease.sessionViewMaterializationAudit.artifactPersistenceAllowed, false);
  assert.doesNotMatch(
    JSON.stringify(lease),
    /synthetic-sessionview-first-|C:\/Users\/example|Bearer/iu,
  );
});

test('legacy profile flag helper respects the SessionView trust boundary', () => {
  const boundedMaterial = resolveLegacyProfileFlagMaterial({
    profilePath: 'C:/synthetic/profile.json',
    browserProfileRoot: 'C:/synthetic/browser-profile-root',
    userDataDir: 'C:/synthetic/user-data-dir',
  }, {
    browserProfileRoot: 'C:/synthetic/lease-browser-profile-root',
    userDataDir: 'C:/synthetic/lease-user-data-dir',
    sessionView: {
      schemaVersion: SESSION_VIEW_SCHEMA_VERSION,
      siteKey: 'example',
      purpose: 'download',
      scope: 'media',
      permission: ['read'],
      ttlMs: 60_000,
      status: 'ready',
    },
  });
  assert.deepEqual(boundedMaterial, {
    allowed: false,
    boundary: 'SessionView',
    reason: 'session-view-boundary-present',
  });

  const boundedArgs = [];
  addCommonProfileFlags(boundedArgs, {
    profilePath: 'C:/synthetic/profile.json',
    browserPath: 'C:/synthetic/browser.exe',
    browserProfileRoot: 'C:/synthetic/browser-profile-root',
    userDataDir: 'C:/synthetic/user-data-dir',
    timeoutMs: 1000,
  }, {
    browserProfileRoot: 'C:/synthetic/lease-browser-profile-root',
    userDataDir: 'C:/synthetic/lease-user-data-dir',
    sessionView: {
      schemaVersion: SESSION_VIEW_SCHEMA_VERSION,
      siteKey: 'example',
      purpose: 'download',
      scope: 'media',
      permission: ['read'],
      ttlMs: 60_000,
      status: 'ready',
    },
  });

  assert.deepEqual(boundedArgs, [
    '--browser-path',
    'C:/synthetic/browser.exe',
    '--timeout',
    '1000',
  ]);
  assert.doesNotMatch(
    boundedArgs.join(' '),
    /profile\.json|browser-profile-root|user-data-dir|lease-browser-profile-root|lease-user-data-dir/iu,
  );

  const legacyMaterial = resolveLegacyProfileFlagMaterial({
    profilePath: 'C:/synthetic/profile.json',
  }, {
    browserProfileRoot: 'C:/synthetic/lease-browser-profile-root',
    userDataDir: 'C:/synthetic/lease-user-data-dir',
  });
  assert.deepEqual(legacyMaterial, {
    allowed: true,
    boundary: 'legacy-no-session-view-only',
    reason: 'legacy-profile-flags-allowed-without-session-view',
    profilePath: 'C:/synthetic/profile.json',
    browserProfileRoot: undefined,
    userDataDir: undefined,
  });

  const legacyArgs = [];
  addCommonProfileFlags(legacyArgs, {
    profilePath: 'C:/synthetic/profile.json',
    browserPath: 'C:/synthetic/browser.exe',
    timeoutMs: 1000,
  }, {
    browserProfileRoot: 'C:/synthetic/lease-browser-profile-root',
    userDataDir: 'C:/synthetic/lease-user-data-dir',
  });

  assert.deepEqual(legacyArgs, [
    '--profile-path',
    'C:/synthetic/profile.json',
    '--browser-path',
    'C:/synthetic/browser.exe',
    '--timeout',
    '1000',
  ]);
  assert.doesNotMatch(legacyArgs.join(' '), /lease-browser-profile-root|lease-user-data-dir/iu);

  const explicitLegacyArgs = [];
  addCommonProfileFlags(explicitLegacyArgs, {
    profilePath: 'C:/synthetic/profile.json',
    browserProfileRoot: 'C:/synthetic/request-browser-profile-root',
    userDataDir: 'C:/synthetic/request-user-data-dir',
    browserPath: 'C:/synthetic/browser.exe',
    timeoutMs: 1000,
  }, {
    browserProfileRoot: 'C:/synthetic/lease-browser-profile-root',
    userDataDir: 'C:/synthetic/lease-user-data-dir',
  });

  assert.deepEqual(explicitLegacyArgs, [
    '--profile-path',
    'C:/synthetic/profile.json',
    '--browser-profile-root',
    'C:/synthetic/request-browser-profile-root',
    '--user-data-dir',
    'C:/synthetic/request-user-data-dir',
    '--browser-path',
    'C:/synthetic/browser.exe',
    '--timeout',
    '1000',
  ]);
  assert.doesNotMatch(explicitLegacyArgs.join(' '), /lease-browser-profile-root|lease-user-data-dir/iu);
});

test('22biqu legacy command keeps profile flags behind the SessionView boundary', () => {
  const plan = normalizeDownloadTaskPlan({
    siteKey: '22biqu',
    host: 'www.22biqu.com',
    taskType: 'book',
    source: { input: 'Synthetic Book' },
  });
  const layout = { runDir: 'C:/synthetic/run-dir' };
  const request = {
    input: 'Synthetic Book',
    profilePath: 'C:/synthetic/22biqu-profile.json',
    crawlerScriptsDir: 'C:/synthetic/crawler-scripts',
  };
  const sessionViewLease = native22BiquSessionLease('download:book', {
    sessionView: {
      schemaVersion: SESSION_VIEW_SCHEMA_VERSION,
      siteKey: '22biqu',
      purpose: 'download',
      scope: 'book',
      permission: ['read'],
      ttlMs: 60_000,
      status: 'ready',
    },
  });

  const bounded = build22BiquLegacyCommand(
    'C:/synthetic/book.py',
    plan,
    request,
    sessionViewLease,
    {},
    layout,
  );
  assert.equal(bounded.command, 'python');
  assert.equal(bounded.executorKind, 'python');
  assert.equal(bounded.args.includes('--profile-path'), false);
  assert.equal(bounded.args.includes('C:/synthetic/22biqu-profile.json'), false);
  assert.equal(bounded.args.includes('--crawler-scripts-dir'), true);
  assert.doesNotMatch(bounded.args.join(' '), /22biqu-profile|headers|cookie|authorization|csrf|token/iu);

  const legacy = build22BiquLegacyCommand(
    'C:/synthetic/book.py',
    plan,
    request,
    native22BiquSessionLease('download:book'),
    {},
    layout,
  );
  assert.deepEqual(
    legacy.args.slice(legacy.args.indexOf('--profile-path'), legacy.args.indexOf('--profile-path') + 2),
    ['--profile-path', 'C:/synthetic/22biqu-profile.json'],
  );
});

test('download runner maps reusable profile governance health to sanitized session manifests', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-governance-session-'));
  const userDataDir = path.join(runRoot, 'profile', 'instagram');
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const governanceLeases = [];
  const releasedGovernanceLeases = [];
  let resolverSawProfileLease = false;
  const result = await runDownloadTask({
    site: 'instagram',
    input: 'openai',
    dryRun: false,
    profile: {
      host: 'www.instagram.com',
      authSession: {
        loginUrl: 'https://www.instagram.com/accounts/login/',
        verificationUrl: 'https://www.instagram.com/',
        reuseLoginStateByDefault: true,
      },
    },
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    sessionDeps: {
      inspectReusableSiteSession: async (_inputUrl, settings) => ({
        authAvailable: true,
        reusableProfile: true,
        reuseLoginState: true,
        userDataDir,
        profileHealth: {
          exists: true,
          healthy: true,
          warnings: [],
        },
        authConfig: {
          keepaliveIntervalMinutes: 120,
          requireStableNetworkForAuthenticatedFlows: true,
        },
        sessionOptions: {
          authConfig: {
            keepaliveIntervalMinutes: 120,
            requireStableNetworkForAuthenticatedFlows: true,
          },
          reuseLoginState: settings.reuseLoginState,
          userDataDir,
          cleanupUserDataDirOnShutdown: false,
        },
      }),
      prepareSiteSessionGovernance: async (_inputUrl, authContext, _settings, options) => {
        assert.equal(options.networkOptions.disableExternalLookup, true);
        const lease = {
          leaseId: `governance-${governanceLeases.length + 1}`,
          userDataDir: authContext.userDataDir,
        };
        governanceLeases.push(lease);
        return {
          operation: options.operation,
          userDataDir: authContext.userDataDir,
          lease,
          policyDecision: {
            allowed: true,
            riskCauseCode: null,
            riskAction: null,
            profileQuarantined: false,
          },
          authSessionSummary: {
            lastHealthyAt: '2026-04-28T00:00:00.000Z',
            nextSuggestedKeepaliveAt: '2026-04-28T02:00:00.000Z',
            keepaliveDue: false,
          },
          networkDrift: {
            driftDetected: false,
            reasons: [],
          },
        };
      },
      releaseGovernanceSessionLease: async (lease) => {
        releasedGovernanceLeases.push(lease.leaseId);
      },
    },
    resolveDownloadResources: async (_plan, sessionLease) => {
      resolverSawProfileLease = true;
      assert.equal(sessionLease.status, 'ready');
      assert.equal(sessionLease.mode, 'authenticated');
      assert.equal(sessionLease.governanceLease, undefined);
      assert.equal(sessionLease.userDataDir, undefined);
      assert.equal(sessionLease.rawMaterialIsolation.profileMaterialPresent, true);
      assert.deepEqual(sessionLease.headers ?? {}, {});
      assert.equal(sessionLease.cookies, undefined);
      assert.equal(sessionLease.profilePath, undefined);
      assert.equal(sessionLease.browserProfileRoot, undefined);
      assert.doesNotMatch(
        JSON.stringify(sessionLease),
        /sessionid=secret|Bearer secret|synthetic-legacy-profile|C:\/Users\/example|profilePath|browserProfileRoot|userDataDir/iu,
      );
      return {
        resources: [{
          id: 'media-1',
          url: 'https://cdn.example.test/openai.jpg',
          fileName: 'openai.jpg',
          mediaType: 'image',
        }],
      };
    },
    fetchImpl: async () => {
      const payload = Buffer.from('image body', 'utf8');
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      };
    },
  });

  assert.equal(resolverSawProfileLease, true);
  assert.equal(governanceLeases.length, 2);
  assert.deepEqual(releasedGovernanceLeases.sort(), ['governance-1', 'governance-2']);
  assert.equal(result.manifest.status, 'passed');
  assert.equal(result.manifest.session.status, 'ready');
  assert.equal(result.manifest.session.mode, 'authenticated');
  assert.equal(result.sessionLease.governanceLease, undefined);
  assert.equal(result.manifest.session.userDataDir, undefined);
  assert.equal(result.manifest.session.headers, undefined);
  assert.equal(result.manifest.session.cookies, undefined);

  const persisted = await readJsonFile(result.manifest.artifacts.manifest);
  assert.equal(persisted.session.userDataDir, undefined);
  assert.equal(persisted.session.headers, undefined);
  assert.equal(persisted.session.cookies, undefined);
});

test('download runner uses lease risk reason when required lease is not ready', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-required-lease-risk-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const result = await runDownloadTask({
    site: 'instagram',
    input: 'openai',
    dryRun: false,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    inspectSessionHealth: async () => ({
      siteKey: 'instagram',
      host: 'www.instagram.com',
      status: 'ready',
      mode: 'authenticated',
      riskSignals: [],
    }),
    acquireSessionLease: async () => ({
      siteKey: 'instagram',
      host: 'www.instagram.com',
      mode: 'reusable-profile',
      status: 'blocked',
      riskSignals: ['login-wall'],
    }),
    executeLegacyDownloadTask: async () => {
      throw new Error('legacy adapter should not execute after failed required lease');
    },
  });

  assert.equal(result.sessionLease.status, 'blocked');
  assert.equal(result.manifest.status, 'blocked');
  assert.equal(result.manifest.reason, 'login-wall');
});

test('download runner continues optional sites anonymously when health is not ready', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-optional-anon-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  let resolverSawAnonymous = false;
  const result = await runDownloadTask({
    site: 'bilibili',
    input: 'BV1optionalAnon',
    dryRun: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    inspectSessionHealth: async () => ({
      siteKey: 'bilibili',
      host: 'www.bilibili.com',
      status: 'manual-required',
      reason: 'not-logged-in',
      riskSignals: ['not-logged-in'],
    }),
    acquireSessionLease: async () => {
      throw new Error('optional anonymous preflight should not acquire an unhealthy lease');
    },
    resolveDownloadResources: async (_plan, sessionLease) => {
      resolverSawAnonymous = true;
      assert.equal(sessionLease.status, 'ready');
      assert.equal(sessionLease.mode, 'anonymous');
      return {
        resources: [{
          id: 'resource-1',
          url: 'https://example.com/public.mp4',
          fileName: 'public.mp4',
          mediaType: 'video',
        }],
      };
    },
    executeResolvedDownloadTask: async (_resolvedTask, _plan, sessionLease) => ({
      status: 'skipped',
      reason: 'dry-run',
      session: sessionLease,
    }),
    executeLegacyDownloadTask: async () => {
      throw new Error('legacy adapter should not execute during dry-run');
    },
  });

  assert.equal(resolverSawAnonymous, true);
  assert.equal(result.sessionLease.status, 'ready');
  assert.equal(result.sessionLease.mode, 'anonymous');
  assert.equal(result.manifest.status, 'skipped');
});

test('download runner blocks live validation when optional session health is not ready', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-live-session-blocked-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const result = await runDownloadTask({
    site: 'bilibili',
    input: 'BV1liveSessionBlocked',
    dryRun: false,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    liveValidation: {
      status: 'planned',
      scenario: 'bilibili-dash-mux',
      requiresApproval: true,
      approvalId: 'approval-live-session-blocked',
    },
  }, {
    inspectSessionHealth: async () => ({
      siteKey: 'bilibili',
      host: 'www.bilibili.com',
      status: 'blocked',
      reason: 'profile-health-risk',
      riskSignals: ['profile-crashed'],
    }),
    acquireSessionLease: async () => {
      throw new Error('live validation should not acquire a lease after blocked session health');
    },
    resolveDownloadResources: async () => {
      throw new Error('live validation resolver should not run after blocked session health');
    },
    executeLegacyDownloadTask: async () => {
      throw new Error('live validation legacy adapter should not run after blocked session health');
    },
  });

  assert.equal(result.resolvedTask, null);
  assert.equal(result.sessionLease.status, 'blocked');
  assert.equal(result.manifest.status, 'blocked');
  assert.equal(result.manifest.reason, 'profile-health-risk');
  assert.equal(result.manifest.liveValidation.scenario, 'bilibili-dash-mux');
  assert.equal(result.manifest.liveValidation.approvalId, 'approval-live-session-blocked');
});

test('download runner blocks optional downloads marked login-required when health is not ready', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-optional-login-required-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const result = await runDownloadTask({
    site: 'bilibili',
    input: 'https://www.bilibili.com/watchlater/',
    dryRun: false,
    downloadRequiresAuth: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    inspectSessionHealth: async () => ({
      siteKey: 'bilibili',
      host: 'www.bilibili.com',
      status: 'manual-required',
      reason: 'login-required',
      riskSignals: ['not-logged-in'],
    }),
    acquireSessionLease: async () => {
      throw new Error('lease acquisition should not run after failed login-required preflight');
    },
    executeLegacyDownloadTask: async () => {
      throw new Error('legacy adapter should not execute after failed login-required preflight');
    },
  });

  assert.equal(result.plan.sessionRequirement, 'optional');
  assert.equal(result.sessionLease.status, 'manual-required');
  assert.equal(result.manifest.status, 'blocked');
  assert.equal(result.manifest.reason, 'login-required');
});

test('download runner forwards injected resolver deps with network gate disabled by default', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-resolver-deps-off-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  let resolverCalled = false;
  const result = await runDownloadTask({
    site: 'bilibili',
    input: 'https://www.bilibili.com/video/BV1runnerGateOff/',
    dryRun: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    acquireSessionLease: async (_siteKey, purpose) => ({
      siteKey: 'bilibili',
      host: 'www.bilibili.com',
      mode: 'anonymous',
      status: 'ready',
      riskSignals: [],
      purpose,
    }),
    releaseSessionLease: async () => {},
    resolveBilibiliApiEvidence: async (evidenceRequest, options) => {
      resolverCalled = true;
      assert.equal(evidenceRequest.contractVersion, 'bilibili-native-api-evidence-v1');
      assert.equal(evidenceRequest.bvid, 'BV1runnerGateOff');
      assert.equal(evidenceRequest.allowNetworkResolve, false);
      assert.equal(options.allowNetworkResolve, false);
      return {
        viewPayload: {
          data: {
            bvid: 'BV1runnerGateOff',
            pages: [{ cid: 5101, page: 1 }],
          },
        },
        playUrlPayloads: {
          5101: { cid: 5101, data: { durl: [{ url: 'https://upos.example.test/runner/gate-off.flv' }] } },
        },
      };
    },
    executeLegacyDownloadTask: async () => {
      throw new Error('legacy adapter should not run after injected native evidence resolves');
    },
  });

  assert.equal(resolverCalled, true);
  assert.equal(result.resolvedTask.resources.length, 1);
  assert.equal(result.resolvedTask.resources[0].url, 'https://upos.example.test/runner/gate-off.flv');
  assert.equal(result.manifest.status, 'skipped');
  assert.equal(result.manifest.reason, 'dry-run');
});

test('download runner only enables injected resolver network gate with resolveNetwork', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-resolver-deps-on-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const result = await runDownloadTask({
    site: 'bilibili',
    input: 'https://www.bilibili.com/video/BV1runnerGateOn/',
    dryRun: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    resolveNetwork: true,
  }, {
    acquireSessionLease: async (_siteKey, purpose) => ({
      siteKey: 'bilibili',
      host: 'www.bilibili.com',
      mode: 'anonymous',
      status: 'ready',
      riskSignals: [],
      purpose,
    }),
    releaseSessionLease: async () => {},
    resolveBilibiliApiEvidence: async (evidenceRequest, options) => {
      assert.equal(evidenceRequest.bvid, 'BV1runnerGateOn');
      assert.equal(evidenceRequest.allowNetworkResolve, true);
      assert.equal(options.allowNetworkResolve, true);
      return {
        viewPayload: {
          data: {
            bvid: 'BV1runnerGateOn',
            pages: [{ cid: 5201, page: 1 }],
          },
        },
        playUrlPayloads: {
          5201: { cid: 5201, data: { durl: [{ url: 'https://upos.example.test/runner/gate-on.flv' }] } },
        },
      };
    },
  });

  assert.equal(result.resolvedTask.resources.length, 1);
  assert.equal(result.resolvedTask.resources[0].url, 'https://upos.example.test/runner/gate-on.flv');
});

test('download runner blocks required unhealthy sessions before resolver deps run', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-resolver-preflight-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const result = await runDownloadTask({
    site: 'bilibili',
    input: 'https://www.bilibili.com/video/BV1blockedGate/',
    dryRun: false,
    downloadRequiresAuth: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    resolveNetwork: true,
  }, {
    inspectSessionHealth: async () => ({
      siteKey: 'bilibili',
      host: 'www.bilibili.com',
      status: 'manual-required',
      reason: 'login-required',
      riskSignals: ['not-logged-in'],
      repairPlan: {
        action: 'site-login',
        command: 'site-login',
        reason: 'login-required',
        riskSignals: ['not-logged-in'],
        requiresApproval: true,
      },
    }),
    resolveBilibiliApiEvidence: async () => {
      throw new Error('resolver deps should not run before required session preflight passes');
    },
    executeLegacyDownloadTask: async () => {
      throw new Error('legacy adapter should not run after failed required session preflight');
    },
  });

  assert.equal(result.resolvedTask, null);
  assert.equal(result.manifest.status, 'blocked');
  assert.equal(result.manifest.reason, 'login-required');
  assert.deepEqual(result.manifest.session.repairPlan, {
    action: 'site-login',
    command: 'site-login',
    reason: 'login-required',
    requiresApproval: true,
    riskSignals: ['not-logged-in'],
  });
});

test('download runner can generate and consume unified session health before resolver work', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-unified-session-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  let sessionHealthRequested = false;
  let inspectedStatus = null;
  let inspectedSessionView = null;
  let resolverCalled = false;
  const sessionManifestPath = path.join(runRoot, 'session-health', 'manifest.json');

  const result = await runDownloadTask({
    site: 'instagram',
    input: 'openai',
    sessionRequirement: 'required',
    dryRun: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    useUnifiedSessionHealth: true,
  }, {
    runSessionTask: async () => {
      sessionHealthRequested = true;
      return {
        manifest: normalizeSessionRunManifest({
          plan: {
            siteKey: 'instagram',
            host: 'www.instagram.com',
            purpose: 'download',
            sessionRequirement: 'required',
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
            manifest: sessionManifestPath,
            runDir: path.dirname(sessionManifestPath),
          },
        }),
      };
    },
    inspectSessionHealth: async (_siteKey, options) => {
      inspectedStatus = options.sessionStatus;
      inspectedSessionView = options.sessionView;
      return {
        siteKey: 'instagram',
        host: 'www.instagram.com',
        status: options.sessionStatus,
        reason: options.sessionReason,
        riskSignals: options.riskSignals,
        cookies: [{ name: 'sid', value: 'synthetic-cookie' }],
        headers: { authorization: 'Bearer syntheticHealthToken' },
      };
    },
    resolveDownloadResources: async () => {
      resolverCalled = true;
      return null;
    },
  });

  assert.equal(sessionHealthRequested, true);
  assert.equal(inspectedStatus, 'manual-required');
  assert.equal(inspectedSessionView.schemaVersion, SESSION_VIEW_SCHEMA_VERSION);
  assert.equal(inspectedSessionView.reasonCode, 'session-invalid');
  assert.equal(resolverCalled, false);
  assert.equal(result.manifest.status, 'blocked');
  assert.equal(result.manifest.session.provider, 'unified-session-runner');
  assert.equal(result.manifest.session.healthManifest, sessionManifestPath);
  assert.equal(result.manifest.session.sessionView.schemaVersion, SESSION_VIEW_SCHEMA_VERSION);
  assert.equal(result.manifest.session.sessionView.status, 'manual-required');
  assert.equal(result.manifest.session.sessionView.reasonCode, 'session-invalid');
  assert.equal(result.manifest.session.sessionView.networkContext.host, 'www.instagram.com');
  assert.equal(Object.hasOwn(result.manifest.session, 'headers'), false);
  assert.equal(Object.hasOwn(result.manifest.session, 'cookies'), false);
  const persisted = await readJsonFile(result.manifest.artifacts.manifest);
  assert.equal(persisted.session.sessionView.schemaVersion, SESSION_VIEW_SCHEMA_VERSION);
  assert.doesNotMatch(
    JSON.stringify(persisted.session),
    /synthetic-|cookie|headers|authorization|csrf|token|Bearer/iu,
  );
  const report = await readFile(result.manifest.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /Session provider: unified-session-runner/u);
  assert.match(report, /Session traceability gate: passed \(unified-session-health-manifest\)/u);
  assert.match(report, new RegExp(sessionManifestPath.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&'), 'u'));
});

test('download runner carries ready unified SessionView into downloader manifest without raw session material', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-ready-session-view-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  let acquiredSessionView = null;
  let resolverSessionView = null;
  let resolverLeaseSnapshot = null;
  const sessionManifestPath = path.join(runRoot, 'session-health', 'manifest.json');

  const result = await runDownloadTask({
    site: 'instagram',
    input: 'openai',
    sessionRequirement: 'required',
    dryRun: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    useUnifiedSessionHealth: true,
  }, {
    runSessionTask: async () => ({
      manifest: normalizeSessionRunManifest({
        plan: {
          siteKey: 'instagram',
          host: 'www.instagram.com',
          purpose: 'download',
          sessionRequirement: 'required',
          profilePath: 'C:/redacted/synthetic-profile-path',
          browserProfileRoot: 'C:/redacted/synthetic-browser-profile-root',
          userDataDir: 'C:/redacted/synthetic-user-data-dir',
        },
        health: {
          status: 'ready',
          authStatus: 'authenticated',
          riskSignals: ['refresh_token=synthetic-ready-refresh-token'],
          cookies: [{ name: 'sid', value: 'synthetic-ready-cookie' }],
          headers: { authorization: 'Bearer syntheticReadyHeaderToken' },
          csrf: 'synthetic-ready-csrf',
          token: 'synthetic-ready-token',
        },
        artifacts: {
          manifest: sessionManifestPath,
          runDir: path.dirname(sessionManifestPath),
        },
      }),
    }),
    inspectSessionHealth: async (_siteKey, options) => ({
      siteKey: 'instagram',
      host: 'www.instagram.com',
      status: options.sessionStatus,
      authStatus: 'authenticated',
      riskSignals: options.riskSignals,
      cookies: [{ name: 'sid', value: 'synthetic-inspected-cookie' }],
      headers: { authorization: 'Bearer syntheticInspectedHeaderToken' },
    }),
    acquireSessionLease: async (_siteKey, _purpose, options) => {
      acquiredSessionView = options.sessionView;
      return {
        siteKey: 'instagram',
        host: 'www.instagram.com',
        mode: 'browser-profile',
        status: 'ready',
        headers: {
          Cookie: 'sessionid=synthetic-ready-lease-cookie',
          Authorization: 'Bearer synthetic-ready-lease-token',
        },
        cookies: [{ name: 'sessionid', value: 'synthetic-ready-lease-cookie' }],
        profilePath: 'C:/redacted/synthetic-ready-lease-profile.json',
        browserProfileRoot: 'C:/redacted/synthetic-ready-lease-browser-profile-root',
        userDataDir: 'C:/redacted/synthetic-ready-lease-user-data-dir',
        csrf: 'synthetic-ready-lease-csrf',
        token: 'synthetic-ready-lease-token',
        authorization: 'Bearer synthetic-ready-lease-authorization',
      };
    },
    releaseSessionLease: async () => {},
    resolveDownloadResources: async (_plan, sessionLease) => {
      resolverSessionView = sessionLease.sessionView;
      resolverLeaseSnapshot = sessionLease;
      return {
        siteKey: 'instagram',
        taskType: 'social-archive',
        resources: [],
        completeness: {
          expectedCount: 0,
          resolvedCount: 0,
          complete: false,
          reason: 'no-resolved-resources',
        },
      };
    },
  });

  assert.equal(acquiredSessionView.schemaVersion, SESSION_VIEW_SCHEMA_VERSION);
  assert.equal(acquiredSessionView.status, 'ready');
  assert.equal(acquiredSessionView.profileRef, 'anonymous');
  assert.deepEqual(acquiredSessionView.permission, ['read']);
  assert.equal(acquiredSessionView.networkContext.host, 'www.instagram.com');
  assert.equal(Object.hasOwn(acquiredSessionView.networkContext, 'headers'), false);
  assert.equal(Object.hasOwn(acquiredSessionView.networkContext, 'cookies'), false);
  assert.equal(Object.hasOwn(acquiredSessionView, 'profilePath'), false);
  assert.equal(Object.hasOwn(acquiredSessionView, 'browserProfileRoot'), false);
  assert.equal(Object.hasOwn(acquiredSessionView, 'userDataDir'), false);
  assert.doesNotMatch(
    JSON.stringify(acquiredSessionView),
    /synthetic-|cookie|headers|authorization|csrf|token|Bearer|refresh_token|profilePath|browserProfileRoot|userDataDir/iu,
  );
  assert.equal(resolverSessionView.schemaVersion, SESSION_VIEW_SCHEMA_VERSION);
  assert.equal(resolverSessionView.status, 'ready');
  assert.equal(resolverSessionView.profileRef, 'anonymous');
  assert.deepEqual(resolverSessionView.permission, ['read']);
  assert.equal(Object.hasOwn(resolverSessionView.networkContext, 'headers'), false);
  assert.equal(Object.hasOwn(resolverSessionView.networkContext, 'cookies'), false);
  assert.equal(Object.hasOwn(resolverSessionView, 'profilePath'), false);
  assert.equal(Object.hasOwn(resolverSessionView, 'browserProfileRoot'), false);
  assert.equal(Object.hasOwn(resolverSessionView, 'userDataDir'), false);
  assert.doesNotMatch(
    JSON.stringify(resolverSessionView),
    /synthetic-|cookie|headers|authorization|csrf|token|Bearer|refresh_token|profilePath|browserProfileRoot|userDataDir/iu,
  );
  assert.equal(Object.hasOwn(resolverLeaseSnapshot, 'headers'), false);
  assert.equal(Object.hasOwn(resolverLeaseSnapshot, 'cookies'), false);
  assert.equal(Object.hasOwn(resolverLeaseSnapshot, 'profilePath'), false);
  assert.equal(Object.hasOwn(resolverLeaseSnapshot, 'browserProfileRoot'), false);
  assert.equal(Object.hasOwn(resolverLeaseSnapshot, 'userDataDir'), false);
  assert.equal(Object.hasOwn(resolverLeaseSnapshot, 'csrf'), false);
  assert.equal(Object.hasOwn(resolverLeaseSnapshot, 'token'), false);
  assert.equal(Object.hasOwn(resolverLeaseSnapshot, 'authorization'), false);
  assert.equal(Object.hasOwn(resolverLeaseSnapshot, 'Authorization'), false);
  assert.doesNotMatch(
    JSON.stringify(resolverLeaseSnapshot),
    /synthetic-ready-lease-|cookie|headers|authorization|csrf|token|Bearer|profilePath|browserProfileRoot|userDataDir/iu,
  );
  assert.equal(result.sessionLease.sessionView.schemaVersion, SESSION_VIEW_SCHEMA_VERSION);
  assert.equal(result.sessionLease.sessionView.profileRef, 'anonymous');
  assert.deepEqual(result.sessionLease.sessionView.permission, ['read']);
  assert.equal(Object.hasOwn(result.sessionLease.sessionView, 'profilePath'), false);
  assert.equal(Object.hasOwn(result.sessionLease.sessionView, 'browserProfileRoot'), false);
  assert.equal(Object.hasOwn(result.sessionLease.sessionView, 'userDataDir'), false);
  assert.equal(Object.hasOwn(result.sessionLease, 'headers'), false);
  assert.equal(Object.hasOwn(result.sessionLease, 'cookies'), false);
  assert.equal(Object.hasOwn(result.sessionLease, 'csrf'), false);
  assert.equal(Object.hasOwn(result.sessionLease, 'token'), false);
  assert.doesNotMatch(
    JSON.stringify(result.sessionLease),
    /synthetic-|cookie|headers|authorization|csrf|token|Bearer|refresh_token|profilePath|browserProfileRoot|userDataDir/iu,
  );
  assert.equal(result.manifest.status, 'skipped');
  assert.equal(result.manifest.reason, 'dry-run');
  assert.equal(result.manifest.session.provider, 'unified-session-runner');
  assert.equal(result.manifest.session.healthManifest, sessionManifestPath);
  assert.equal(result.manifest.session.sessionView.schemaVersion, SESSION_VIEW_SCHEMA_VERSION);
  assert.equal(result.manifest.session.sessionView.status, 'ready');
  assert.equal(result.manifest.session.sessionView.profileRef, 'anonymous');
  assert.deepEqual(result.manifest.session.sessionView.permission, ['read']);
  assert.equal(result.manifest.session.sessionView.networkContext.host, 'www.instagram.com');
  assert.equal(result.manifest.session.sessionViewMaterializationAudit.eventType, 'session.materialized');
  assert.equal(result.manifest.session.sessionViewMaterializationAudit.boundary, 'SessionView');
  assert.equal(result.manifest.session.sessionViewMaterializationAudit.profileRef, 'anonymous');
  assert.deepEqual(result.manifest.session.sessionViewMaterializationAudit.permission, ['read']);
  assert.equal(result.manifest.session.sessionViewMaterializationAudit.rawCredentialAccess, false);
  assert.equal(result.manifest.session.sessionViewMaterializationAudit.artifactPersistenceAllowed, false);
  assert.deepEqual(result.manifest.session.sessionViewMaterializationAudit.purposeIsolation, {
    enforced: true,
    purpose: 'download',
    scope: ['instagram', 'www.instagram.com', 'download'],
  });
  assert.deepEqual(result.manifest.session.sessionViewMaterializationAudit.revocation, {
    boundary: 'SessionProvider',
    handlePresent: false,
    reasonCode: 'session-revocation-handle-missing',
  });
  assert.equal(Object.hasOwn(result.manifest.session, 'headers'), false);
  assert.equal(Object.hasOwn(result.manifest.session, 'cookies'), false);
  assert.equal(Object.hasOwn(result.manifest.session.sessionView, 'profilePath'), false);
  assert.equal(Object.hasOwn(result.manifest.session.sessionView, 'browserProfileRoot'), false);
  assert.equal(Object.hasOwn(result.manifest.session.sessionView, 'userDataDir'), false);
  const persisted = await readJsonFile(result.manifest.artifacts.manifest);
  assert.equal(persisted.session.sessionView.schemaVersion, SESSION_VIEW_SCHEMA_VERSION);
  assert.equal(persisted.session.sessionView.status, 'ready');
  assert.equal(persisted.session.sessionView.profileRef, 'anonymous');
  assert.equal(persisted.session.sessionViewMaterializationAudit.eventType, 'session.materialized');
  assert.equal(persisted.session.sessionViewMaterializationAudit.profileRef, 'anonymous');
  assert.equal(persisted.session.sessionViewMaterializationAudit.rawCredentialAccess, false);
  assert.equal(persisted.session.sessionViewMaterializationAudit.artifactPersistenceAllowed, false);
  assert.deepEqual(persisted.session.sessionViewMaterializationAudit.purposeIsolation, {
    enforced: true,
    purpose: 'download',
    scope: ['instagram', 'www.instagram.com', 'download'],
  });
  assert.deepEqual(persisted.session.sessionViewMaterializationAudit.revocation, {
    boundary: 'SessionProvider',
    handlePresent: false,
    reasonCode: 'session-revocation-handle-missing',
  });
  assert.equal(Object.hasOwn(persisted.session.sessionView, 'profilePath'), false);
  assert.equal(Object.hasOwn(persisted.session.sessionView, 'browserProfileRoot'), false);
  assert.equal(Object.hasOwn(persisted.session.sessionView, 'userDataDir'), false);
  assert.doesNotMatch(
    JSON.stringify(persisted.session),
    /synthetic-|cookie|headers|authorization|csrf|token|Bearer|refresh_token|profilePath|browserProfileRoot|userDataDir/iu,
  );
});

test('legacy executor normalizes successful action stdout into a download manifest', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-legacy-success-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    taskType: 'video',
    adapterVersion: 'bilibili-adapter-v1',
    source: { input: 'BV1legacySuccess' },
    policy: { dryRun: false, concurrency: 2, skipExisting: true },
    output: { root: runRoot },
    legacy: {
      entrypoint: 'src/entrypoints/sites/bilibili-action.mjs',
      executorKind: 'node',
    },
  });
  let capturedCommand = null;
  let capturedArgs = null;
  const nativeFallback = {
    reason: 'bilibili-playurl-evidence-missing',
    resolver: {
      adapterId: 'bilibili',
      method: 'native-bilibili-page-seeds',
    },
    completeness: {
      expectedCount: 1,
      resolvedCount: 0,
      complete: false,
      reason: 'bilibili-playurl-evidence-missing',
    },
  };
  const hookRegistry = createCapabilityHookRegistry([{
    id: 'download-legacy-completed-observer',
    phase: 'after_download',
    subscriber: {
      name: 'download-legacy-completed-observer',
      modulePath: 'src/sites/capability/lifecycle-events.mjs',
      entrypoint: 'observe',
      order: 1,
    },
    filters: {
      eventTypes: ['download.legacy.completed'],
      siteKeys: ['bilibili'],
    },
  }]);
  const manifest = await executeLegacyDownloadTask(plan, {
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    status: 'ready',
    mode: 'reusable-profile',
    riskSignals: ['refresh_token=synthetic-legacy-refresh-token'],
  }, {
    input: 'BV1legacySuccess',
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    nativeFallback,
  }, {
    capabilityHookRegistry: hookRegistry,
    spawnJsonCommand: async (command, args) => {
      capturedCommand = command;
      capturedArgs = args;
      return {
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          ok: true,
          action: 'download',
          reasonCode: 'download-started',
          downloadResult: {
            manifest: {
              runDir: path.join(runRoot, 'legacy-bilibili-run'),
              summary: {
                total: 1,
                successful: 1,
                failed: 0,
                skipped: 0,
                planned: 0,
              },
              results: [{
                status: 'success',
                finalUrl: 'https://www.bilibili.com/video/BV1legacySuccess/',
                outputPath: path.join(runRoot, 'legacy-bilibili-run', 'video.mp4'),
              }],
            },
          },
        }),
      };
    },
  });

  assert.equal(capturedCommand, process.execPath);
  assert.equal(capturedArgs.includes(path.join(REPO_ROOT, 'src', 'entrypoints', 'sites', 'bilibili-action.mjs')), true);
  assert.equal(capturedArgs.includes('download'), true);
  assert.equal(capturedArgs.includes('BV1legacySuccess'), true);
  assert.equal(capturedArgs.includes('--out-dir'), true);
  assert.equal(capturedArgs.includes('--skip-existing'), true);
  assert.equal(manifest.status, 'passed');
  assert.equal(manifest.counts.downloaded, 1);
  assert.equal(manifest.files.length, 1);
  assert.equal(manifest.legacy.exitCode, 0);
  assert.deepEqual(manifest.legacy.nativeFallback, nativeFallback);
  assert.equal(manifest.schemaVersion, DOWNLOAD_RUN_MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.artifacts.source.runDir, path.join(runRoot, 'legacy-bilibili-run'));
  const resolvedTask = await readJsonFile(manifest.artifacts.resolvedTask);
  assert.equal(resolvedTask.completeness.reason, 'legacy-downloader-required');
  assert.deepEqual(resolvedTask.metadata.nativeFallback, nativeFallback);
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.equal(persisted.planId, plan.id);
  assert.equal(JSON.stringify(persisted).includes('synthetic-legacy-refresh-token'), false);
  assert.deepEqual(persisted.session.riskSignals, [REDACTION_PLACEHOLDER]);
  assert.equal(typeof persisted.artifacts.standardTaskList, 'string');
  const standardTaskList = await readJsonFile(persisted.artifacts.standardTaskList);
  assert.equal(standardTaskList.schemaVersion, STANDARD_TASK_LIST_SCHEMA_VERSION);
  assert.equal(assertSchemaCompatible('StandardTaskList', standardTaskList), true);
  assert.equal(standardTaskList.siteKey, 'bilibili');
  assert.equal(standardTaskList.taskType, 'video');
  assert.equal(standardTaskList.policyRef, `download-plan:${plan.id}:policy`);
  assert.deepEqual(standardTaskList.items, []);
  assert.equal(JSON.stringify(standardTaskList).includes('legacy-bilibili-run'), false);
  assert.equal(JSON.stringify(standardTaskList).includes('video.mp4'), false);
  assert.doesNotMatch(
    JSON.stringify(standardTaskList),
    /synthetic|headers|authorization|cookie|csrf|token|Bearer/iu,
  );
  assert.equal(typeof persisted.artifacts.redactionAudit, 'string');
  const audit = await readJsonFile(persisted.artifacts.redactionAudit);
  assert.equal(JSON.stringify(audit).includes('synthetic-legacy-refresh-token'), false);
  assert.deepEqual(audit.redactedPaths, ['session.riskSignals.0']);
  assert.deepEqual(audit.findings, [{
    path: 'session.riskSignals.0',
    pattern: 'sensitive-query-assignment',
  }]);
  assert.equal(typeof persisted.artifacts.lifecycleEvent, 'string');
  assert.equal(typeof persisted.artifacts.lifecycleEventRedactionAudit, 'string');
  const lifecycleEvent = await readJsonFile(persisted.artifacts.lifecycleEvent);
  assert.equal(lifecycleEvent.schemaVersion, LIFECYCLE_EVENT_SCHEMA_VERSION);
  assert.equal(assertSchemaCompatible('LifecycleEvent', lifecycleEvent), true);
  assert.equal(lifecycleEvent.eventType, 'download.legacy.completed');
  assert.equal(lifecycleEvent.traceId, persisted.runId);
  assert.equal(lifecycleEvent.correlationId, persisted.planId);
  assert.equal(lifecycleEvent.taskId, persisted.runId);
  assert.equal(lifecycleEvent.siteKey, 'bilibili');
  assert.equal(lifecycleEvent.taskType, plan.taskType);
  assert.equal(lifecycleEvent.adapterVersion, 'bilibili-adapter-v1');
  assert.equal(lifecycleEvent.reasonCode, DEFAULT_DOWNLOAD_COMPLETED_REASON);
  assert.equal(lifecycleEvent.details.status, 'passed');
  assert.deepEqual(lifecycleEvent.details.counts, persisted.counts);
  assert.deepEqual(lifecycleEvent.details.riskSignals, [REDACTION_PLACEHOLDER]);
  assert.deepEqual(lifecycleEvent.details.capabilityHookMatches.phases, ['after_download', 'on_completion']);
  assert.equal(lifecycleEvent.details.capabilityHookMatches.matchCount, 1);
  assert.equal(
    lifecycleEvent.details.capabilityHookMatches.matches[0].id,
    'download-legacy-completed-observer',
  );
  assert.equal(
    Object.hasOwn(lifecycleEvent.details.capabilityHookMatches.matches[0].subscriber, 'modulePath'),
    false,
  );
  assert.equal(
    Object.hasOwn(lifecycleEvent.details.capabilityHookMatches.matches[0].subscriber, 'entrypoint'),
    false,
  );
  assert.equal(JSON.stringify(lifecycleEvent).includes('synthetic-legacy-refresh-token'), false);
  const lifecycleAudit = await readJsonFile(persisted.artifacts.lifecycleEventRedactionAudit);
  assert.equal(JSON.stringify(lifecycleAudit).includes('synthetic-legacy-refresh-token'), false);
  assert.equal(lifecycleAudit.redactedPaths.includes('details.riskSignals.0'), true);
  assert.deepEqual(lifecycleAudit.findings, [{
    path: 'details.riskSignals.0',
    pattern: 'sensitive-query-assignment',
  }]);
  assert.deepEqual(manifest.session.riskSignals, ['refresh_token=synthetic-legacy-refresh-token']);
});

test('legacy executor success lifecycle subscriber failure fails closed before manifest write', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-legacy-lifecycle-failure-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const runId = 'legacy-success-lifecycle-failure';

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    taskType: 'video',
    source: { input: 'BV1legacyFailure' },
    output: { root: runRoot },
    legacy: {
      entrypoint: 'src/entrypoints/sites/bilibili-action.mjs',
      executorKind: 'node',
    },
  });

  await assert.rejects(
    () => executeLegacyDownloadTask(plan, {
      siteKey: 'bilibili',
      host: 'www.bilibili.com',
      status: 'ready',
      mode: 'reusable-profile',
    }, {
      input: 'BV1legacyFailure',
    }, {
      workspaceRoot: REPO_ROOT,
      runRoot,
      runId,
    }, {
      spawnJsonCommand: async () => ({
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          ok: true,
          action: 'download',
          reasonCode: 'download-started',
          downloadResult: {
            manifest: {
              summary: {
                total: 1,
                successful: 1,
                failed: 0,
                skipped: 0,
                planned: 0,
              },
              results: [{
                status: 'success',
                outputPath: path.join(runRoot, 'legacy-output.mp4'),
              }],
            },
          },
        }),
      }),
      lifecycleEventSubscribers: [
        async () => {
          throw new Error('synthetic-legacy-lifecycle-failure');
        },
      ],
    }),
    /synthetic-legacy-lifecycle-failure/u,
  );
  await assert.rejects(
    () => readFile(path.join(runRoot, runId, 'manifest.json'), 'utf8'),
    /ENOENT/u,
  );
  await assert.rejects(
    () => readFile(path.join(runRoot, runId, 'lifecycle-event.json'), 'utf8'),
    /ENOENT/u,
  );
  await assert.rejects(
    () => readFile(path.join(runRoot, runId, 'lifecycle-event-redaction-audit.json'), 'utf8'),
    /ENOENT/u,
  );
});

test('legacy executor normalizes action stdout source artifacts into manifest refs', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-legacy-action-artifacts-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const legacyRunDir = path.join(runRoot, 'legacy-x-run');
  const plan = normalizeDownloadTaskPlan({
    siteKey: 'x',
    host: 'x.com',
    taskType: 'social-archive',
    source: { input: 'openai' },
    policy: { dryRun: false, maxItems: 2 },
    output: { root: runRoot },
    legacy: {
      entrypoint: 'src/entrypoints/sites/x-action.mjs',
      executorKind: 'node',
    },
  });

  const manifest = await executeLegacyDownloadTask(plan, {
    siteKey: 'x',
    host: 'x.com',
    status: 'ready',
    mode: 'reusable-profile',
    riskSignals: [],
  }, {
    input: 'openai',
    account: 'openai',
    downloadMedia: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    spawnJsonCommand: async () => ({
      code: 0,
      stderr: '',
      stdout: JSON.stringify({
        ok: true,
        status: 'degraded',
        reason: 'soft-cursor-exhausted',
        artifacts: {
          runDir: legacyRunDir,
          manifest: path.join(legacyRunDir, 'manifest.json'),
          items: path.join(legacyRunDir, 'items.jsonl'),
          downloadsJsonl: path.join(legacyRunDir, 'downloads.jsonl'),
          mediaHashManifestPath: path.join(legacyRunDir, 'media-manifest.json'),
          mediaQueuePath: path.join(legacyRunDir, 'media-queue.json'),
          reportPath: path.join(legacyRunDir, 'report.md'),
        },
        counts: {
          rows: 2,
          failed: 0,
          skipped: 0,
        },
      }),
    }),
  });

  assert.equal(manifest.status, 'partial');
  assert.equal(manifest.reason, 'soft-cursor-exhausted');
  assert.equal(manifest.counts.expected, 2);
  assert.equal(manifest.counts.downloaded, 2);
  assert.equal(manifest.artifacts.manifest.endsWith('manifest.json'), true);
  assert.equal(manifest.artifacts.queue.endsWith('queue.json'), true);
  assert.equal(manifest.artifacts.downloadsJsonl.endsWith('downloads.jsonl'), true);
  assert.deepEqual(manifest.artifacts.source, {
    runDir: legacyRunDir,
    manifest: path.join(legacyRunDir, 'manifest.json'),
    itemsJsonl: path.join(legacyRunDir, 'items.jsonl'),
    downloadsJsonl: path.join(legacyRunDir, 'downloads.jsonl'),
    mediaManifest: path.join(legacyRunDir, 'media-manifest.json'),
    mediaQueue: path.join(legacyRunDir, 'media-queue.json'),
    reportMarkdown: path.join(legacyRunDir, 'report.md'),
  });
  assert.deepEqual(manifest.legacy.artifacts, manifest.artifacts.source);
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.equal(typeof persisted.artifacts.standardTaskList, 'string');
  const standardTaskList = await readJsonFile(persisted.artifacts.standardTaskList);
  assert.equal(standardTaskList.schemaVersion, STANDARD_TASK_LIST_SCHEMA_VERSION);
  assert.equal(assertSchemaCompatible('StandardTaskList', standardTaskList), true);
  assert.equal(standardTaskList.siteKey, 'x');
  assert.equal(standardTaskList.taskType, 'social-archive');
  assert.equal(standardTaskList.policyRef, `download-plan:${plan.id}:policy`);
  assert.deepEqual(standardTaskList.items, []);
  assert.equal(JSON.stringify(standardTaskList).includes(legacyRunDir), false);
  assert.equal(JSON.stringify(standardTaskList).includes('items.jsonl'), false);
  assert.equal(JSON.stringify(standardTaskList).includes('downloads.jsonl'), false);
  assert.equal(JSON.stringify(standardTaskList).includes('media-queue.json'), false);
  assert.doesNotMatch(
    JSON.stringify(standardTaskList),
    /synthetic|headers|authorization|cookie|csrf|token|Bearer/iu,
  );
  const report = await readFile(manifest.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /Status explanation:/u);
  assert.match(report, /Next resume command: .*--resume/u);
  assert.match(report, /Next retry-failed command: .*--retry-failed/u);
  assert.match(report, /Source artifact mediaQueue:/u);
  assert.match(report, /Source artifact indexCsv:|Source artifact manifest:/u);
});

test('legacy executor maps blocked legacy failures into blocked manifests', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-legacy-blocked-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    taskType: 'video',
    source: { input: 'https://www.bilibili.com/festival/private' },
    policy: { dryRun: false },
    output: { root: runRoot },
    legacy: {
      entrypoint: 'src/entrypoints/sites/bilibili-action.mjs',
      executorKind: 'node',
    },
  });
  const manifest = await executeLegacyDownloadTask(plan, {
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    status: 'ready',
    mode: 'reusable-profile',
    riskSignals: [],
  }, {}, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    spawnJsonCommand: async () => ({
      code: 1,
      stderr: 'login is required',
      stdout: JSON.stringify({
        ok: false,
        reasonCode: 'login-bootstrap-failed',
      }),
    }),
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.reason, 'login-bootstrap-failed');
  assert.match(manifest.resumeCommand, /node src\/entrypoints\/cli\.mjs download execute/u);
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.equal(typeof persisted.artifacts.standardTaskList, 'string');
  const standardTaskList = await readJsonFile(persisted.artifacts.standardTaskList);
  assert.equal(standardTaskList.schemaVersion, STANDARD_TASK_LIST_SCHEMA_VERSION);
  assert.equal(assertSchemaCompatible('StandardTaskList', standardTaskList), true);
  assert.equal(standardTaskList.siteKey, 'bilibili');
  assert.equal(standardTaskList.taskType, 'video');
  assert.equal(standardTaskList.policyRef, `download-plan:${plan.id}:policy`);
  assert.deepEqual(standardTaskList.items, []);
  assert.doesNotMatch(
    JSON.stringify(standardTaskList),
    /synthetic|headers|authorization|cookie|csrf|token|Bearer/iu,
  );
});

test('legacy executor classifies Cloudflare challenge stderr before generic legacy reason', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-legacy-cloudflare-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'bz888',
    host: 'www.bz888888888.com',
    taskType: 'book',
    source: { input: '玄牝之门' },
    policy: { dryRun: false },
    output: { root: runRoot },
    legacy: {
      entrypoint: 'src/sites/chapter-content/download/python/book.py',
      executorKind: 'python',
    },
  });
  const manifest = await executeLegacyDownloadTask(plan, {
    siteKey: 'bz888',
    host: 'www.bz888888888.com',
    status: 'ready',
    mode: 'anonymous',
    riskSignals: [],
  }, {}, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    spawnJsonCommand: async () => ({
      code: 1,
      stdout: JSON.stringify({
        ok: false,
        reasonCode: 'session-invalid',
      }),
      stderr: 'HTTP 403 Forbidden for url https://www.bz888888888.com/ss/ Cf-Mitigated: challenge Server: cloudflare',
    }),
  });

  const expectedRecovery = reasonCodeSummary('blocked-by-cloudflare-challenge');
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.reason, 'blocked-by-cloudflare-challenge');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.legacy.reasonCode, 'session-invalid');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const lifecycleEvent = await readJsonFile(persisted.artifacts.lifecycleEvent);
  assert.equal(lifecycleEvent.eventType, 'download.legacy.completed');
  assert.equal(lifecycleEvent.reasonCode, 'blocked-by-cloudflare-challenge');
  assert.deepEqual(lifecycleEvent.details.reasonRecovery, expectedRecovery);
  assert.equal(lifecycleEvent.details.legacyReasonCode, 'session-invalid');
  assert.doesNotMatch(
    JSON.stringify(lifecycleEvent),
    /HTTP 403 Forbidden|Cf-Mitigated|https:\/\/www\.bz888888888\.com\/ss\//iu,
  );
});

test('legacy executor completed failure lifecycle summarizes recovery without raw failure details', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-legacy-failure-lifecycle-summary-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    taskType: 'video',
    source: { input: 'BV1legacyFailureSummary' },
    policy: { dryRun: false },
    output: { root: runRoot },
    legacy: {
      entrypoint: 'src/entrypoints/sites/bilibili-action.mjs',
      executorKind: 'node',
    },
  });
  const manifest = await executeLegacyDownloadTask(plan, {
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    status: 'ready',
    mode: 'reusable-profile',
    riskSignals: ['refresh_token=synthetic-legacy-failure-token'],
  }, {}, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    spawnJsonCommand: async () => ({
      code: 1,
      stderr: 'synthetic legacy stderr should stay out of lifecycle',
      stdout: JSON.stringify({
        ok: false,
        status: 'failed',
        reasonCode: 'download-failures',
        counts: {
          expected: 1,
          failed: 1,
        },
        results: [{
          id: 'legacy-failed-resource',
          status: 'failed',
          url: 'https://example.com/legacy-failed-resource.bin',
          filePath: 'C:/synthetic/legacy-failed-resource.bin',
          reason: 'fetch-error',
          error: 'synthetic legacy resource failure should stay out of lifecycle',
        }],
      }),
    }),
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'download-failures');
  assert.deepEqual(manifest.reasonRecovery, reasonCodeSummary('download-failures'));
  assert.equal(manifest.failedResources[0].reason, 'fetch-error');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  const lifecycleEvent = await readJsonFile(persisted.artifacts.lifecycleEvent);
  assert.equal(lifecycleEvent.eventType, 'download.legacy.completed');
  assert.equal(lifecycleEvent.reasonCode, 'download-failures');
  assert.deepEqual(lifecycleEvent.details.reasonRecovery, reasonCodeSummary('download-failures'));
  assert.deepEqual(lifecycleEvent.details.failedResourceReasonCounts, { 'fetch-error': 1 });
  assert.deepEqual(lifecycleEvent.details.riskSignals, [REDACTION_PLACEHOLDER]);
  assert.doesNotMatch(
    JSON.stringify(lifecycleEvent),
    /synthetic legacy stderr|synthetic legacy resource failure|legacy-failed-resource\.bin|https:\/\/example\.com\/legacy-failed-resource|synthetic-legacy-failure-token/iu,
  );
});

test('legacy executor converts spawn errors into failed manifests', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-legacy-spawn-error-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    taskType: 'video',
    source: { input: 'BV1spawnError' },
    policy: { dryRun: false },
    output: { root: runRoot },
    legacy: {
      entrypoint: 'src/entrypoints/sites/bilibili-action.mjs',
      executorKind: 'node',
    },
  });
  const manifest = await executeLegacyDownloadTask(plan, {
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    status: 'ready',
    mode: 'reusable-profile',
    riskSignals: [],
  }, {}, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    spawnJsonCommand: async () => {
      throw new Error('spawn ENOENT');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'spawn ENOENT');
  assert.equal(manifest.legacy.exitCode, 1);
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.equal(typeof persisted.artifacts.standardTaskList, 'string');
  const standardTaskList = await readJsonFile(persisted.artifacts.standardTaskList);
  assert.equal(standardTaskList.schemaVersion, STANDARD_TASK_LIST_SCHEMA_VERSION);
  assert.equal(assertSchemaCompatible('StandardTaskList', standardTaskList), true);
  assert.equal(standardTaskList.siteKey, 'bilibili');
  assert.equal(standardTaskList.taskType, 'video');
  assert.equal(standardTaskList.policyRef, `download-plan:${plan.id}:policy`);
  assert.deepEqual(standardTaskList.items, []);
  assert.doesNotMatch(
    JSON.stringify(standardTaskList),
    /synthetic|headers|authorization|cookie|csrf|token|Bearer/iu,
  );
});

test('download runner executes bilibili legacy adapter when no resources are resolved', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-legacy-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  let invoked = false;
  const result = await runDownloadTask({
    site: 'bilibili',
    input: 'BV1runnerLegacy',
    dryRun: false,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    spawnJsonCommand: async (command, args) => {
      invoked = true;
      assert.equal(command, process.execPath);
      assert.equal(args.includes('BV1runnerLegacy'), true);
      return {
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          ok: true,
          reasonCode: 'download-started',
          actionSummary: {
            total: 1,
            successful: 1,
            failed: 0,
            skipped: 0,
          },
        }),
      };
    },
  });

  assert.equal(invoked, true);
  assert.equal(result.manifest.status, 'passed');
  assert.equal(result.manifest.counts.downloaded, 1);
  assert.equal(result.manifest.legacy.entrypoint.endsWith(path.join('src', 'entrypoints', 'sites', 'bilibili-action.mjs')), true);
});

test('download runner executes Bilibili native DASH resources without legacy fallback', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-bili-native-dash-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  let genericExecutorInvoked = false;
  let legacyInvoked = false;
  const fetchedPaths = [];
  const fetchedHeaders = [];
  const result = await runDownloadTask({
    site: 'bilibili',
    input: 'https://www.bilibili.com/video/BV1runnerNativeDash/',
    dryRun: false,
    headers: {
      Authorization: 'Bearer synthetic-bilibili-request-token',
      Cookie: 'SESSDATA=synthetic-bilibili-request-cookie',
      'X-CSRF-Token': 'synthetic-bilibili-request-csrf',
      Range: 'bytes=0-1023',
      Referer: 'https://www.bilibili.com/video/BV1runnerNativeDash/',
    },
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    resolveNetwork: true,
    enableDerivedMux: true,
  }, {
    acquireSessionLease: async () => ({
      siteKey: 'bilibili',
      host: 'www.bilibili.com',
      status: 'ready',
      mode: 'authenticated',
      headers: {
        Authorization: 'Bearer synthetic-bilibili-native-token',
        Cookie: 'SESSDATA=synthetic-bilibili-native-cookie',
        Range: 'bytes=0-1023',
      },
      riskSignals: [],
    }),
    releaseSessionLease: async () => {},
    mockResolverFetchImpl: async (url, init = {}) => {
      const parsed = new URL(url);
      fetchedPaths.push(parsed.pathname);
      fetchedHeaders.push(init.headers ?? {});
      if (parsed.pathname === '/x/web-interface/view') {
        return {
          code: 0,
          data: {
            bvid: 'BV1runnerNativeDash',
            aid: 62001,
            title: 'Runner Native DASH',
            pages: [{ cid: 6200101, page: 1, part: 'Runner Part' }],
          },
        };
      }
      if (parsed.pathname === '/x/player/playurl') {
        return {
          code: 0,
          data: {
            result: 'suee',
            dash: {
              video: [{
                id: 80,
                baseUrl: 'https://upos.example.test/runner/video.m4s',
                mimeType: 'video/mp4',
                bandwidth: 2400000,
              }],
              audio: [{
                id: 30280,
                baseUrl: 'https://upos.example.test/runner/audio.m4s',
                mimeType: 'audio/mp4',
                bandwidth: 128000,
              }],
            },
          },
        };
      }
      throw new Error(`unexpected Bilibili API URL: ${url}`);
    },
    executeResolvedDownloadTask: async (resolvedTask, plan, sessionLease, options) => {
      genericExecutorInvoked = true;
      assert.equal(options.enableDerivedMux, true);
      assert.equal(sessionLease.status, 'ready');
      assert.equal(resolvedTask.resources.length, 2);
      assert.deepEqual(resolvedTask.resources.map((resource) => resource.metadata.muxRole), ['video', 'audio']);
      assert.deepEqual([...new Set(resolvedTask.resources.map((resource) => resource.groupId))], [
        'bilibili:BV1runnerNativeDash:p1',
      ]);
      return normalizeDownloadRunManifest({
        siteKey: plan.siteKey,
        status: 'passed',
        counts: {
          expected: 2,
          attempted: 2,
          downloaded: 2,
          skipped: 0,
          failed: 0,
        },
        session: sessionLease,
      });
    },
    executeLegacyDownloadTask: async () => {
      legacyInvoked = true;
      throw new Error('legacy adapter should not run when Bilibili native DASH resources resolve');
    },
  });

  assert.deepEqual(fetchedPaths, ['/x/web-interface/view', '/x/player/playurl']);
  assert.equal(fetchedHeaders.length, 2);
  for (const headers of fetchedHeaders) {
    assert.equal(headers.Accept, 'application/json, text/plain, */*');
    assert.equal(headers.Referer, 'https://www.bilibili.com/video/BV1runnerNativeDash/');
    assert.equal(headers['User-Agent'], 'Mozilla/5.0 Browser-Wiki-Skill native resolver');
    assert.equal(headers.Range, 'bytes=0-1023');
    assert.equal(headers.Authorization, undefined);
    assert.equal(headers.Cookie, undefined);
    assert.equal(headers['X-CSRF-Token'], undefined);
    assert.equal(JSON.stringify(headers).includes('synthetic-bilibili-native'), false);
    assert.equal(JSON.stringify(headers).includes('synthetic-bilibili-request'), false);
  }
  const bilibiliModuleSource = await readFile(
    path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'site-modules', 'bilibili.mjs'),
    'utf8',
  );
  assert.match(bilibiliModuleSource, /normalizeSessionLeaseConsumerHeaders/u);
  assert.match(bilibiliModuleSource, /normalizeDownloadResourceConsumerHeaders/u);
  assert.doesNotMatch(bilibiliModuleSource, /sessionLease\?\.headers/u);
  assert.doesNotMatch(bilibiliModuleSource, /\.\.\.\(isObject\(request\.headers\)/u);
  assert.equal(genericExecutorInvoked, true);
  assert.equal(legacyInvoked, false);
  assert.equal(result.resolvedTask.metadata.resolver.method, 'native-bilibili-resource-seeds');
  assert.equal(result.resolvedTask.completeness.complete, true);
  assert.equal(result.manifest.status, 'passed');
});

test('download runner passes native miss trace into legacy fallback options', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-native-miss-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  let capturedNativeFallback = null;
  const result = await runDownloadTask({
    site: 'bilibili',
    input: 'https://www.bilibili.com/video/BV1nativeMissTrace/',
    dryRun: false,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    acquireSessionLease: async () => ({
      siteKey: 'bilibili',
      host: 'www.bilibili.com',
      status: 'ready',
      mode: 'anonymous',
      riskSignals: [],
    }),
    releaseSessionLease: async () => {},
    resolveDownloadResources: async (plan) => ({
      planId: plan.id,
      siteKey: plan.siteKey,
      taskType: plan.taskType,
      resources: [],
      metadata: {
        resolver: {
          adapterId: 'bilibili',
          method: 'native-bilibili-page-seeds',
        },
      },
      completeness: {
        expectedCount: 1,
        resolvedCount: 0,
        complete: false,
        reason: 'bilibili-playurl-evidence-missing',
      },
    }),
    executeLegacyDownloadTask: async (_plan, _sessionLease, _request, options) => {
      capturedNativeFallback = options.nativeFallback;
      return normalizeDownloadRunManifest({
        status: 'passed',
        siteKey: 'bilibili',
        counts: {
          expected: 1,
          downloaded: 1,
          skipped: 0,
          failed: 0,
        },
        legacy: {
          entrypoint: _plan.legacy.entrypoint,
          nativeFallback: options.nativeFallback,
        },
      });
    },
  });

  assert.equal(result.resolvedTask.resources.length, 0);
  assert.equal(capturedNativeFallback.reason, 'bilibili-playurl-evidence-missing');
  assert.equal(capturedNativeFallback.resolver.adapterId, 'bilibili');
  assert.equal(capturedNativeFallback.resolver.method, 'native-bilibili-page-seeds');
  assert.deepEqual(capturedNativeFallback.completeness, {
    expectedCount: 1,
    resolvedCount: 0,
    complete: false,
    reason: 'bilibili-playurl-evidence-missing',
  });
  assert.deepEqual(result.manifest.legacy.nativeFallback, capturedNativeFallback);
});

test('download runner maps social requests to legacy action argv and source artifacts', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-social-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const legacyRunDir = path.join(runRoot, 'legacy-social-search');
  let capturedCommand = null;
  let capturedArgs = null;
  const result = await runDownloadTask({
    site: 'x',
    input: 'https://x.com/search?q=codex',
    dryRun: false,
    date: '2026-04-26',
    maxItems: 4,
    downloadMedia: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    inspectSessionHealth: async () => ({
      siteKey: 'x',
      host: 'x.com',
      status: 'ready',
      mode: 'reusable-profile',
      headers: {
        Authorization: 'Bearer synthetic-social-native-token',
        Cookie: 'auth_token=synthetic-social-native-cookie',
        Range: 'bytes=0-1023',
      },
      riskSignals: [],
    }),
    acquireSessionLease: async () => ({
      siteKey: 'x',
      host: 'x.com',
      status: 'ready',
      mode: 'reusable-profile',
      riskSignals: [],
    }),
    releaseSessionLease: async () => {},
    spawnJsonCommand: async (command, args) => {
      capturedCommand = command;
      capturedArgs = args;
      return {
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          ok: true,
          status: 'complete',
          artifacts: {
            runDir: legacyRunDir,
            manifestPath: path.join(legacyRunDir, 'manifest.json'),
            itemsJsonlPath: path.join(legacyRunDir, 'items.jsonl'),
            downloadsJsonlPath: path.join(legacyRunDir, 'downloads.jsonl'),
            mediaQueuePath: path.join(legacyRunDir, 'media-queue.json'),
            mediaHashManifestPath: path.join(legacyRunDir, 'media-manifest.json'),
          },
          counts: {
            rows: 1,
            failed: 0,
            skipped: 0,
          },
        }),
      };
    },
  });

  assert.equal(capturedCommand, process.execPath);
  assert.equal(capturedArgs.includes(path.join(REPO_ROOT, 'src', 'entrypoints', 'sites', 'x-action.mjs')), true);
  assert.equal(capturedArgs[1], 'search');
  assert.equal(capturedArgs[capturedArgs.indexOf('--query') + 1], 'codex');
  assert.equal(capturedArgs[capturedArgs.indexOf('--date') + 1], '2026-04-26');
  assert.equal(capturedArgs[capturedArgs.indexOf('--max-items') + 1], '4');
  assert.equal(capturedArgs.includes('--download-media'), true);
  assert.equal(result.manifest.status, 'passed');
  assert.deepEqual(result.manifest.artifacts.source, {
    runDir: legacyRunDir,
    manifest: path.join(legacyRunDir, 'manifest.json'),
    itemsJsonl: path.join(legacyRunDir, 'items.jsonl'),
    downloadsJsonl: path.join(legacyRunDir, 'downloads.jsonl'),
    mediaManifest: path.join(legacyRunDir, 'media-manifest.json'),
    mediaQueue: path.join(legacyRunDir, 'media-queue.json'),
  });
  assert.deepEqual(result.manifest.legacy.artifacts, result.manifest.artifacts.source);
});

test('download runner executes gated social native resources without spawning legacy', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-social-native-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  let executorInvoked = false;
  let legacyInvoked = false;
  const result = await runDownloadTask({
    site: 'x',
    input: 'https://x.com/openai',
    nativeResolver: true,
    dryRun: false,
    mediaItems: [{
      tweetId: 'tweet-native',
      media: [{
        id: 'media-native',
        type: 'video',
        variants: [{ contentType: 'video/mp4', bitrate: 1024, url: 'https://video.twimg.example.test/native.mp4' }],
      }],
    }],
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    acquireSessionLease: async () => ({
      siteKey: 'x',
      host: 'x.com',
      status: 'ready',
      mode: 'reusable-profile',
      riskSignals: [],
    }),
    releaseSessionLease: async () => {},
    executeResolvedDownloadTask: async (resolvedTask, plan) => {
      executorInvoked = true;
      assert.equal(resolvedTask.resources.length, 1);
      assert.equal(resolvedTask.resources[0].url, 'https://video.twimg.example.test/native.mp4');
      assert.equal(resolvedTask.resources[0].headers.Authorization, undefined);
      assert.equal(resolvedTask.resources[0].headers.Cookie, undefined);
      assert.equal(JSON.stringify(resolvedTask.resources[0].headers).includes('synthetic-social-native'), false);
      assert.equal(resolvedTask.metadata.resolver.method, 'native-x-social-resource-seeds');
      const resourceSeedModuleSource = await readFile(
        path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'resource-seeds.mjs'),
        'utf8',
      );
      assert.match(resourceSeedModuleSource, /normalizeSessionLeaseConsumerHeaders/u);
      assert.doesNotMatch(resourceSeedModuleSource, /sessionLease\?\.headers/u);
      return normalizeDownloadRunManifest({
        runId: 'social-native',
        planId: plan.id,
        siteKey: plan.siteKey,
        status: 'passed',
        counts: {
          expected: 1,
          attempted: 1,
          downloaded: 1,
          skipped: 0,
          failed: 0,
        },
        artifacts: {
          manifest: path.join(runRoot, 'manifest.json'),
          queue: path.join(runRoot, 'queue.json'),
          downloadsJsonl: path.join(runRoot, 'downloads.jsonl'),
          reportMarkdown: path.join(runRoot, 'report.md'),
        },
      });
    },
    executeLegacyDownloadTask: async () => {
      legacyInvoked = true;
      throw new Error('legacy adapter should not execute for gated native social resources');
    },
    spawnJsonCommand: async () => {
      legacyInvoked = true;
      throw new Error('legacy spawn should not run for gated native social resources');
    },
  });

  assert.equal(executorInvoked, true);
  assert.equal(legacyInvoked, false);
  assert.equal(result.manifest.status, 'passed');
  assert.equal(result.manifest.legacy, undefined);
});

test('xiaohongshu fetched-html resolver keeps injected page-fetch cookies behind artifact boundary', async () => {
  const fetchedHeaders = [];
  const plan = normalizeDownloadTaskPlan({
    siteKey: 'xiaohongshu',
    host: 'www.xiaohongshu.com',
    taskType: 'media-bundle',
    source: { input: 'https://www.xiaohongshu.com/explore/synthetic-note' },
  });
  const resolved = await resolveXiaohongshuResources(plan, {
    siteKey: 'xiaohongshu',
    host: 'www.xiaohongshu.com',
    status: 'ready',
    mode: 'reusable-profile',
    headers: {
      Authorization: 'Bearer synthetic-xhs-native-token',
      Cookie: 'a1=synthetic-xhs-native-cookie',
      Range: 'bytes=0-1023',
    },
    riskSignals: [],
  }, {
    request: {
      input: 'https://www.xiaohongshu.com/explore/synthetic-note',
      requiredHeaderNames: ['User-Agent'],
      headers: {
        Authorization: 'Bearer synthetic-xhs-request-token',
        Cookie: 'a1=synthetic-xhs-request-cookie',
        'X-CSRF-Token': 'synthetic-xhs-request-csrf',
        Range: 'bytes=1024-2047',
        Referer: 'https://www.xiaohongshu.com/explore/synthetic-note',
      },
    },
    mockFetchImpl: async (url, init = {}) => {
      fetchedHeaders.push(init.headers ?? {});
      return {
        ok: true,
        url,
        async text() {
          return '<html><body><img src="https://sns-img.example.test/synthetic-note.jpg"></body></html>';
        },
      };
    },
  });

  assert.equal(resolved.resources.length, 1);
  assert.equal(fetchedHeaders.length, 1);
  assert.equal(fetchedHeaders[0].Accept, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
  assert.equal(fetchedHeaders[0]['User-Agent'], 'Mozilla/5.0 Browser-Wiki-Skill native resolver');
  assert.equal(fetchedHeaders[0].Range, 'bytes=1024-2047');
  assert.equal(fetchedHeaders[0].Referer, 'https://www.xiaohongshu.com/explore/synthetic-note');
  assert.equal(fetchedHeaders[0].Authorization, undefined);
  assert.equal(fetchedHeaders[0].Cookie, 'a1=synthetic-xhs-native-cookie');
  assert.equal(fetchedHeaders[0]['X-CSRF-Token'], undefined);
  assert.equal(JSON.stringify(fetchedHeaders[0]).includes('synthetic-xhs-request'), false);
  assert.equal(JSON.stringify(fetchedHeaders[0]).includes('synthetic-xhs-native-token'), false);
  assert.equal(resolved.resources[0].headers.Range, 'bytes=1024-2047');
  assert.equal(resolved.resources[0].headers.Authorization, undefined);
  assert.equal(resolved.resources[0].headers.Cookie, undefined);
  assert.equal(resolved.resources[0].headers['X-CSRF-Token'], undefined);
  assert.equal(JSON.stringify(resolved.resources[0].headers).includes('synthetic-xhs-request'), false);
  assert.equal(JSON.stringify(resolved.resources[0].headers).includes('synthetic-xhs-native'), false);
  assert.deepEqual(resolved.metadata.resolution.headerFreshness.requestHeaderNames, ['Range', 'Referer']);
  assert.deepEqual(resolved.metadata.resolution.headerFreshness.sessionHeaderNames, ['Cookie', 'Range']);
  assert.equal(resolved.metadata.resolution.headerFreshness.sessionStatus, undefined);
  assert.equal(resolved.metadata.resolution.headerFreshness.cookieEvidence, true);
  assert.equal(JSON.stringify(resolved.metadata.resolution.headerFreshness).includes('synthetic-xhs-request'), false);
  assert.equal(JSON.stringify(resolved.metadata.resolution.headerFreshness).includes('synthetic-xhs-native'), false);

  const xiaohongshuModuleSource = await readFile(
    path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'site-modules', 'xiaohongshu.mjs'),
    'utf8',
  );
  assert.match(xiaohongshuModuleSource, /normalizeDownloadResourceConsumerHeaders\(request\.headers\)/u);
  assert.match(xiaohongshuModuleSource, /normalizeSessionLeaseConsumerHeaders/u);
  assert.doesNotMatch(xiaohongshuModuleSource, /\.\.\.\(isObject\(request\.headers\)/u);
  assert.doesNotMatch(xiaohongshuModuleSource, /sessionLease\?\.headers/u);
  assert.doesNotMatch(xiaohongshuModuleSource, /sessionLease\?\.(?:status|mode|authStatus|profilePath|browserProfileRoot|userDataDir)\b/u);
});

test('xiaohongshu asset resource seed helper exposes a low-permission resolver shape', () => {
  const seed = createXiaohongshuAssetResourceSeed({
    id: 'synthetic-image-id',
    url: 'https://sns-img.example.test/synthetic-note.jpg',
    previewUrl: 'https://sns-img.example.test/synthetic-preview.jpg',
    width: 1080,
    height: 1440,
    headers: {
      Authorization: 'Bearer synthetic-xhs-shape-token',
      Cookie: 'a1=synthetic-xhs-shape-cookie',
      'X-CSRF-Token': 'synthetic-xhs-shape-csrf',
      Range: 'bytes=0-1023',
      Referer: 'https://www.xiaohongshu.com/explore/synthetic-note',
    },
  }, 'image', 0, {
    noteId: 'synthetic-note-id',
    noteTitle: 'Synthetic Xiaohongshu Note',
    authorName: 'Synthetic Author',
    authorUserId: 'synthetic-author-id',
    authorUrl: 'https://www.xiaohongshu.com/user/profile/synthetic-author',
    publishedAt: '2026-05-01T00:00:00.000Z',
    tagNames: ['synthetic'],
    sourceUrl: 'https://www.xiaohongshu.com/explore/synthetic-note',
  }, 'page-facts');

  assert.ok(seed);
  assert.equal(seed.id, 'synthetic-image-id');
  assert.equal(seed.url, 'https://sns-img.example.test/synthetic-note.jpg');
  assert.equal(seed.mediaType, 'image');
  assert.equal(seed.title, 'Synthetic Xiaohongshu Note');
  assert.equal(seed.sourceUrl, 'https://www.xiaohongshu.com/explore/synthetic-note');
  assert.equal(seed.referer, 'https://www.xiaohongshu.com/explore/synthetic-note');
  assert.deepEqual(seed.headers, {
    Range: 'bytes=0-1023',
    Referer: 'https://www.xiaohongshu.com/explore/synthetic-note',
  });
  assert.equal(seed.metadata.noteId, 'synthetic-note-id');
  assert.equal(seed.metadata.noteTitle, 'Synthetic Xiaohongshu Note');
  assert.equal(seed.metadata.authorName, 'Synthetic Author');
  assert.equal(seed.metadata.authorUserId, 'synthetic-author-id');
  assert.equal(seed.metadata.assetType, 'image');
  assert.equal(seed.metadata.assetId, 'synthetic-image-id');
  assert.equal(seed.metadata.sourceType, 'page-facts');
  assert.equal(seed.metadata.width, 1080);
  assert.equal(seed.metadata.height, 1440);
  assert.doesNotMatch(
    JSON.stringify(seed),
    /synthetic-xhs-shape-|authorization|cookie|csrf|token|Bearer/iu,
  );
});

test('douyin media resource seed helper exposes a low-permission resolver shape', () => {
  const seed = createDouyinMediaResourceSeed({
    videoId: '7123456789012345678',
    title: 'Synthetic Douyin Shape',
    mediaUrl: 'https://v.douyin.example.test/synthetic-shape.mp4',
    url: 'https://www.douyin.com/video/7123456789012345678',
    authorName: 'Synthetic Author',
    headers: {
      Authorization: 'Bearer synthetic-douyin-shape-token',
      Cookie: 'sessionid=synthetic-douyin-shape-cookie',
      'X-CSRF-Token': 'synthetic-douyin-shape-csrf',
      Range: 'bytes=0-1023',
      Referer: 'https://www.douyin.com/video/7123456789012345678',
    },
    resolvedFormat: {
      formatId: 'synthetic-format',
      codec: 'h264',
      width: 1920,
      height: 1080,
    },
  }, 0, {
    sourceType: 'ordinary-video',
    evidenceId: 'synthetic-evidence-id',
  });

  assert.ok(seed);
  assert.equal(seed.id, '7123456789012345678');
  assert.equal(seed.url, 'https://v.douyin.example.test/synthetic-shape.mp4');
  assert.equal(seed.mediaType, 'video');
  assert.equal(seed.title, 'Synthetic Douyin Shape');
  assert.equal(seed.sourceUrl, 'https://www.douyin.com/video/7123456789012345678');
  assert.deepEqual(seed.headers, {
    Range: 'bytes=0-1023',
    Referer: 'https://www.douyin.com/video/7123456789012345678',
  });
  assert.equal(seed.metadata.videoId, '7123456789012345678');
  assert.equal(seed.metadata.authorName, 'Synthetic Author');
  assert.equal(seed.metadata.sourceType, 'ordinary-video');
  assert.equal(seed.metadata.evidenceId, 'synthetic-evidence-id');
  assert.equal(seed.metadata.formatId, 'synthetic-format');
  assert.equal(seed.metadata.codec, 'h264');
  assert.equal(seed.metadata.width, 1920);
  assert.equal(seed.metadata.height, 1080);
  assert.doesNotMatch(
    JSON.stringify(seed),
    /synthetic-douyin-shape-|authorization|cookie|csrf|token|Bearer/iu,
  );
});

test('douyin native resolver filters raw session evidence through central boundary', async () => {
  const plan = normalizeDownloadTaskPlan({
    siteKey: 'douyin',
    host: 'www.douyin.com',
    taskType: 'media-bundle',
    source: { input: 'https://www.douyin.com/video/7123456789012345678' },
  });
  const resolved = await resolveDouyinResources(plan, {
    siteKey: 'douyin',
    host: 'www.douyin.com',
    status: 'ready',
    mode: 'reusable-profile',
    headers: {
      Authorization: 'Bearer synthetic-douyin-native-token',
      Cookie: 'sessionid=synthetic-douyin-native-cookie',
      Range: 'bytes=0-1023',
    },
    cookies: [{ name: 'sessionid', value: 'synthetic-douyin-native-cookie' }],
    riskSignals: [],
  }, {
    request: {
      input: 'https://www.douyin.com/video/7123456789012345678',
      mediaResults: [{
        videoId: '7123456789012345678',
        title: 'Synthetic Douyin Native',
        mediaUrl: 'https://v.douyin.example.test/synthetic-native.mp4',
      }],
    },
  });

  assert.equal(resolved.resources.length, 1);
  assert.equal(resolved.resources[0].headers.Range, 'bytes=0-1023');
  assert.equal(resolved.resources[0].headers.Authorization, undefined);
  assert.equal(resolved.resources[0].headers.Cookie, undefined);
  assert.equal(JSON.stringify(resolved.resources[0].headers).includes('synthetic-douyin-native'), false);
  const sessionEvidence = resolved.metadata.resolution.evidence.session;
  assert.deepEqual(sessionEvidence.headerNames, ['Range']);
  assert.equal(sessionEvidence.cookieEvidence, undefined);
  assert.equal(JSON.stringify(sessionEvidence).includes('synthetic-douyin-native'), false);

  const douyinModuleSource = await readFile(
    path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'site-modules', 'douyin.mjs'),
    'utf8',
  );
  assert.match(douyinModuleSource, /normalizeSessionLeaseConsumerHeaders/u);
  assert.doesNotMatch(douyinModuleSource, /sessionLease\?\.headers/u);
  assert.doesNotMatch(douyinModuleSource, /sessionLease\?\.cookies/u);
  assert.doesNotMatch(douyinModuleSource, /sessionLease\?\.(?:status|mode|authStatus|profilePath|browserProfileRoot|userDataDir)\b/u);
});

test('douyin native resolver filters raw fetch headers through central boundary', async () => {
  const fetchedHeaders = [];
  const plan = normalizeDownloadTaskPlan({
    siteKey: 'douyin',
    host: 'www.douyin.com',
    taskType: 'media-bundle',
    source: { input: 'https://www.douyin.com/video/7123456789012345678' },
  });
  const resolved = await resolveDouyinResources(plan, {
    siteKey: 'douyin',
    host: 'www.douyin.com',
    status: 'ready',
    mode: 'reusable-profile',
    headers: {
      Authorization: 'Bearer synthetic-douyin-native-token',
      Cookie: 'sessionid=synthetic-douyin-native-cookie',
      Range: 'bytes=0-1023',
    },
    riskSignals: [],
  }, {
    request: {
      input: 'https://www.douyin.com/video/7123456789012345678',
      douyinApiUrl: 'https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=7123456789012345678&a_bogus=synthetic-signature&msToken=synthetic-ms-token',
      fetchHeaders: {
        Authorization: 'Bearer synthetic-douyin-request-token',
        Cookie: 'sessionid=synthetic-douyin-request-cookie',
        'X-CSRF-Token': 'synthetic-douyin-request-csrf',
        Range: 'bytes=1024-2047',
        Referer: 'https://www.douyin.com/video/7123456789012345678',
      },
      mockFetchImpl: async (_url, init = {}) => {
        fetchedHeaders.push(init.headers ?? {});
        return {
          ok: true,
          async json() {
            return {
              aweme_detail: {
                aweme_id: '7123456789012345678',
                desc: 'Synthetic Douyin Fetch',
                video: {
                  play_addr: {
                    url_list: ['https://v.douyin.example.test/synthetic-fetch.mp4'],
                  },
                },
              },
            };
          },
        };
      },
    },
  });

  assert.equal(resolved.resources.length, 1);
  assert.equal(fetchedHeaders.length, 1);
  assert.equal(fetchedHeaders[0].Range, 'bytes=1024-2047');
  assert.equal(fetchedHeaders[0].Referer, 'https://www.douyin.com/video/7123456789012345678');
  assert.equal(fetchedHeaders[0].Authorization, undefined);
  assert.equal(fetchedHeaders[0].Cookie, 'sessionid=synthetic-douyin-request-cookie');
  assert.equal(fetchedHeaders[0]['X-CSRF-Token'], undefined);
  assert.equal(JSON.stringify(fetchedHeaders[0]).includes('synthetic-douyin-request-token'), false);
  assert.equal(JSON.stringify(fetchedHeaders[0]).includes('synthetic-douyin-request-csrf'), false);
  assert.equal(resolved.resources[0].headers.Authorization, undefined);
  assert.equal(resolved.resources[0].headers.Cookie, undefined);
  assert.equal(JSON.stringify(resolved.resources[0].headers).includes('synthetic-douyin-request'), false);
  assert.equal(JSON.stringify(resolved.resources[0].headers).includes('synthetic-douyin-native'), false);
  const requestEvidence = resolved.metadata.resolution.evidence.request;
  assert.deepEqual(requestEvidence.headersPresent, ['Cookie', 'Range', 'Referer']);
  assert.deepEqual(requestEvidence.headerNamesPresent, ['Cookie', 'Range', 'Referer']);
  assert.equal(requestEvidence.cookieEvidence, true);
  assert.equal(JSON.stringify(requestEvidence).includes('synthetic-douyin-request'), false);

  const douyinModuleSource = await readFile(
    path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'site-modules', 'douyin.mjs'),
    'utf8',
  );
  assert.match(douyinModuleSource, /normalizeDouyinResolverRequestHeaders\(request\.fetchHeaders\)/u);
  assert.match(douyinModuleSource, /normalizeDownloadResourceConsumerHeaders/u);
  assert.match(douyinModuleSource, /normalizeSessionLeaseConsumerHeaders/u);
  assert.doesNotMatch(douyinModuleSource, /headers: isObject\(request\.fetchHeaders\)/u);
  assert.doesNotMatch(douyinModuleSource, /Object\.keys\(request\.fetchHeaders\)/u);
  assert.doesNotMatch(douyinModuleSource, /sessionLease\?\.headers/u);
  assert.doesNotMatch(douyinModuleSource, /sessionLease\?\.cookies/u);
});

test('22biqu chapter resource seed helper exposes a low-permission resolver shape', () => {
  const plan = normalizeDownloadTaskPlan({
    siteKey: '22biqu',
    host: 'www.22biqu.com',
    taskType: 'book',
    source: {
      input: 'https://www.22biqu.com/biqu123/',
      title: 'Synthetic 22biqu Book',
    },
  });
  const resource = create22BiquChapterResourceSeed({
    plan,
    request: {
      bookId: 'synthetic-book-id',
      title: 'Synthetic 22biqu Book',
    },
    sessionLease: native22BiquSessionLease('download:book', {
      headers: {
        Authorization: 'Bearer synthetic-22biqu-shape-token',
        Cookie: 'sid=synthetic-22biqu-shape-cookie',
        Range: 'bytes=0-1023',
      },
    }),
    chapter: {
      href: '1.html',
      title: 'Chapter One',
      chapterIndex: 1,
    },
    index: 0,
    baseUrl: 'https://www.22biqu.com/biqu123/',
    bookUrl: 'https://www.22biqu.com/biqu123/',
    sourceTitle: 'Synthetic 22biqu Book',
  });

  assert.ok(resource);
  assert.equal(resource.url, 'https://www.22biqu.com/biqu123/1.html');
  assert.equal(resource.mediaType, 'text');
  assert.equal(resource.fileName, '0001-Chapter One.txt');
  assert.equal(resource.sourceUrl, 'https://www.22biqu.com/biqu123/');
  assert.equal(resource.referer, 'https://www.22biqu.com/biqu123/');
  assert.equal(resource.groupId, 'synthetic-book-id');
  assert.deepEqual(resource.metadata, {
    siteResolver: '22biqu',
    chapterIndex: 1,
    title: 'Chapter One',
    bookTitle: 'Synthetic 22biqu Book',
  });
  assert.deepEqual(resource.headers, {
    Range: 'bytes=0-1023',
  });
  assert.doesNotMatch(
    JSON.stringify(resource),
    /synthetic-22biqu-shape-|authorization|cookie|csrf|token|Bearer/iu,
  );
});

test('22biqu directory fetch filters request headers through central boundary', async () => {
  const fetchedHeaders = [];
  const plan = normalizeDownloadTaskPlan({
    siteKey: '22biqu',
    host: 'www.22biqu.com',
    taskType: 'book',
    source: { input: 'https://www.22biqu.com/biqu123/' },
  });
  const resolved = await resolve22BiquResources(plan, native22BiquSessionLease('download:book', {
    headers: {
      Authorization: 'Bearer synthetic-22biqu-native-token',
      Cookie: 'sid=synthetic-22biqu-native-cookie',
      Range: 'bytes=0-1023',
    },
  }), {
    request: {
      input: 'https://www.22biqu.com/biqu123/',
      headers: {
        Authorization: 'Bearer synthetic-22biqu-request-token',
        Cookie: 'sid=synthetic-22biqu-request-cookie',
        'X-CSRF-Token': 'synthetic-22biqu-request-csrf',
        Range: 'bytes=1024-2047',
        Referer: 'https://www.22biqu.com/biqu123/',
      },
      mockFetchImpl: async (url, init = {}) => {
        fetchedHeaders.push(init.headers ?? {});
        return {
          ok: true,
          url,
          async text() {
            return `
              <html>
                <head>
                  <title>Synthetic 22biqu Book</title>
                  <meta property="og:novel:book_name" content="Synthetic 22biqu Book">
                </head>
                <body>
                  <a href="1.html">Chapter One</a>
                  <a href="2.html">Chapter Two</a>
                </body>
              </html>
            `;
          },
        };
      },
    },
  });

  assert.equal(fetchedHeaders.length, 1);
  assert.equal(fetchedHeaders[0].Range, 'bytes=1024-2047');
  assert.equal(fetchedHeaders[0].Referer, 'https://www.22biqu.com/biqu123/');
  assert.equal(fetchedHeaders[0].Authorization, undefined);
  assert.equal(fetchedHeaders[0].Cookie, undefined);
  assert.equal(fetchedHeaders[0]['X-CSRF-Token'], undefined);
  assert.equal(JSON.stringify(fetchedHeaders[0]).includes('synthetic-22biqu-request'), false);
  assert.equal(resolved.metadata.resolver.method, 'native-22biqu-directory');
  assert.equal(resolved.resources.length, 2);
  for (const resource of resolved.resources) {
    assert.equal(resource.headers.Range, 'bytes=0-1023');
    assert.equal(resource.headers.Authorization, undefined);
    assert.equal(resource.headers.Cookie, undefined);
    assert.equal(JSON.stringify(resource.headers).includes('synthetic-22biqu'), false);
  }

  const biquModuleSource = await readFile(
    path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'site-modules', '22biqu.mjs'),
    'utf8',
  );
  assert.match(biquModuleSource, /normalizeDownloadResourceConsumerHeaders\(request\.headers\)/u);
  assert.match(biquModuleSource, /normalizeSessionLeaseConsumerHeaders/u);
  assert.doesNotMatch(biquModuleSource, /\.\.\.\(isObject\(request\.headers\)/u);
  assert.doesNotMatch(biquModuleSource, /sessionLease\?\.headers/u);
});

test('download runner dry-run does not execute legacy adapters', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-legacy-dry-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const result = await runDownloadTask({
    site: 'bilibili',
    input: 'BV1runnerDryRun',
    dryRun: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    spawnJsonCommand: async () => {
      throw new Error('legacy adapter should not execute during dry-run');
    },
  });

  assert.equal(result.manifest.status, 'skipped');
  assert.equal(result.manifest.reason, 'dry-run');
  assert.equal(result.manifest.legacy, undefined);
});

test('download runner dry-run routes native resolved resources through the generic executor', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-native-dry-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  let genericExecutorInvoked = false;
  let legacyInvoked = false;
  let fetchInvoked = false;
  const result = await runDownloadTask(native22BiquRequest({ dryRun: true }), {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    acquireSessionLease: async (_siteKey, purpose) => native22BiquSessionLease(purpose, {
      headers: {
        Authorization: 'Bearer synthetic-22biqu-native-token',
        Cookie: 'sid=synthetic-22biqu-native-cookie',
        Range: 'bytes=0-1023',
      },
    }),
    releaseSessionLease: async () => {},
    executeResolvedDownloadTask: async (resolvedTask, plan, sessionLease, options, executorDeps) => {
      genericExecutorInvoked = true;
      return await executeResolvedDownloadTask(resolvedTask, plan, sessionLease, options, executorDeps);
    },
    executeLegacyDownloadTask: async () => {
      legacyInvoked = true;
      throw new Error('legacy adapter should not execute when native resources are resolved');
    },
    spawnJsonCommand: async () => {
      legacyInvoked = true;
      throw new Error('legacy spawn should not run when native resources are resolved');
    },
    fetchImpl: async () => {
      fetchInvoked = true;
      throw new Error('dry-run should not fetch native resources');
    },
  });

  assert.equal(genericExecutorInvoked, true);
  assert.equal(legacyInvoked, false);
  assert.equal(fetchInvoked, false);
  assert.equal(result.plan.legacy.entrypoint.endsWith(path.join('src', 'sites', 'chapter-content', 'download', 'python', 'book.py')), true);
  assert.equal(result.resolvedTask.metadata.resolver.method, 'native-22biqu-chapters');
  assert.equal(result.resolvedTask.resources.length, 2);
  for (const resource of result.resolvedTask.resources) {
    assert.equal(resource.headers.Range, 'bytes=0-1023');
    assert.equal(resource.headers.Authorization, undefined);
    assert.equal(resource.headers.Cookie, undefined);
    assert.equal(JSON.stringify(resource.headers).includes('synthetic-22biqu-native'), false);
  }
  const biquModuleSource = await readFile(
    path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'site-modules', '22biqu.mjs'),
    'utf8',
  );
  assert.match(biquModuleSource, /normalizeSessionLeaseConsumerHeaders/u);
  assert.doesNotMatch(biquModuleSource, /sessionLease\?\.headers/u);
  assert.equal(result.manifest.status, 'skipped');
  assert.equal(result.manifest.reason, 'dry-run');
  assert.equal(result.manifest.legacy, undefined);

  const artifacts = await assertDownloadRunArtifactBundle(result.manifest);
  assert.equal(artifacts.persistedManifest.planId, result.plan.id);
  assert.equal(artifacts.plan.id, result.plan.id);
  assert.equal(artifacts.resolvedTask.planId, result.plan.id);
  assert.equal(artifacts.resolvedTask.resources.length, 2);
  assert.deepEqual(artifacts.queue.map((entry) => entry.status), ['pending', 'pending']);
  assert.deepEqual(artifacts.downloads, []);
  assert.match(artifacts.report, /Status: skipped/u);
  assert.match(artifacts.report, /Reason: dry-run/u);
  assert.doesNotMatch(
    JSON.stringify(artifacts),
    /synthetic-22biqu-native-|Authorization|Cookie|X-CSRF-Token|authorization|cookie|csrf|token|Bearer/iu,
  );
});

test('download executor dry-run manifest redacts synthetic forbidden session signals before persisting', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-executor-redaction-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    adapterVersion: 'example-adapter-v1',
    source: { input: 'https://example.com/redacted-dry-run' },
    output: { root: runRoot },
  });
  const hookRegistry = createCapabilityHookRegistry([{
    id: 'download-executor-dry-run-observer',
    phase: 'after_download',
    subscriber: {
      name: 'download-executor-dry-run-observer',
      modulePath: 'src/sites/capability/lifecycle-events.mjs',
      entrypoint: 'observe',
      order: 1,
    },
    filters: {
      eventTypes: ['download.executor.dry_run'],
      siteKeys: ['example'],
      reasonCodes: ['dry-run'],
    },
  }]);
  const manifest = await executeResolvedDownloadTask({
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'resource-1',
      url: 'https://example.com/redacted-dry-run.txt',
      fileName: 'redacted-dry-run.txt',
      mediaType: 'text',
    }],
    completeness: {
      expectedCount: 1,
      resolvedCount: 1,
      complete: false,
      reason: 'refresh_token=synthetic-executor-report-token',
    },
  }, plan, {
    siteKey: 'example',
    host: 'example.com',
    mode: 'reusable-profile',
    status: 'ready',
    sessionView: {
      schemaVersion: SESSION_VIEW_SCHEMA_VERSION,
      siteKey: 'example',
      purpose: 'download',
      status: 'ready',
      profileRef: 'anonymous',
      permission: ['read'],
      ttlSeconds: 60,
      networkContext: { host: 'example.com' },
    },
    riskSignals: ['refresh_token=synthetic-executor-refresh-token'],
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    dryRun: true,
  }, {
    capabilityHookRegistry: hookRegistry,
  });

  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.equal(JSON.stringify(persisted).includes('synthetic-executor-refresh-token'), false);
  assert.deepEqual(persisted.session.riskSignals, [REDACTION_PLACEHOLDER]);
  assert.equal(typeof persisted.artifacts.redactionAudit, 'string');
  const audit = await readJsonFile(persisted.artifacts.redactionAudit);
  assert.equal(JSON.stringify(audit).includes('synthetic-executor-refresh-token'), false);
  assert.deepEqual(audit.redactedPaths, ['session.riskSignals.0']);
  assert.deepEqual(audit.findings, [{
    path: 'session.riskSignals.0',
    pattern: 'sensitive-query-assignment',
  }]);
  assert.equal(typeof persisted.artifacts.lifecycleEvent, 'string');
  assert.equal(typeof persisted.artifacts.lifecycleEventRedactionAudit, 'string');
  const lifecycleEvent = await readJsonFile(persisted.artifacts.lifecycleEvent);
  assert.equal(lifecycleEvent.schemaVersion, LIFECYCLE_EVENT_SCHEMA_VERSION);
  assert.equal(assertSchemaCompatible('LifecycleEvent', lifecycleEvent), true);
  assert.equal(assertLifecycleEventObservabilityFields(lifecycleEvent, {
    requiredFields: [
      'traceId',
      'correlationId',
      'taskId',
      'siteKey',
      'taskType',
      'adapterVersion',
      'reasonCode',
    ],
    requiredDetailFields: [
      'counts',
      'profileRef',
      'riskSignals',
      'capabilityHookMatches',
    ],
  }), true);
  assert.equal(lifecycleEvent.eventType, 'download.executor.dry_run');
  assert.equal(lifecycleEvent.traceId, persisted.runId);
  assert.equal(lifecycleEvent.correlationId, persisted.planId);
  assert.equal(lifecycleEvent.taskId, persisted.runId);
  assert.equal(lifecycleEvent.siteKey, 'example');
  assert.equal(lifecycleEvent.taskType, plan.taskType);
  assert.equal(lifecycleEvent.adapterVersion, 'example-adapter-v1');
  assert.equal(lifecycleEvent.reasonCode, 'dry-run');
  assert.deepEqual(lifecycleEvent.details.counts, persisted.counts);
  assert.equal(lifecycleEvent.details.profileRef, 'anonymous');
  assert.deepEqual(lifecycleEvent.details.riskSignals, [REDACTION_PLACEHOLDER]);
  assert.deepEqual(lifecycleEvent.details.capabilityHookMatches.phases, ['after_download']);
  assert.equal(lifecycleEvent.details.capabilityHookMatches.matchCount, 1);
  assert.equal(
    lifecycleEvent.details.capabilityHookMatches.matches[0].id,
    'download-executor-dry-run-observer',
  );
  assert.equal(
    Object.hasOwn(lifecycleEvent.details.capabilityHookMatches.matches[0].subscriber, 'modulePath'),
    false,
  );
  assert.equal(
    Object.hasOwn(lifecycleEvent.details.capabilityHookMatches.matches[0].subscriber, 'entrypoint'),
    false,
  );
  assert.equal(JSON.stringify(lifecycleEvent).includes('synthetic-executor-refresh-token'), false);
  const lifecycleAudit = await readJsonFile(persisted.artifacts.lifecycleEventRedactionAudit);
  assert.equal(JSON.stringify(lifecycleAudit).includes('synthetic-executor-refresh-token'), false);
  assert.equal(lifecycleAudit.redactedPaths.includes('details.riskSignals.0'), true);
  assert.deepEqual(lifecycleAudit.findings, [{
    path: 'details.riskSignals.0',
    pattern: 'sensitive-query-assignment',
  }]);
  assert.deepEqual(manifest.session.riskSignals, ['refresh_token=synthetic-executor-refresh-token']);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.equal(report.includes('synthetic-executor-report-token'), false);
  assert.match(report, /Resolution: \[REDACTED\]/u);
  assert.doesNotMatch(report, /refresh_token=|Bearer|SESSDATA=/iu);
});

test('download executor emits before_download hook evidence before fetch execution', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-before-hook-evidence-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    adapterVersion: 'example-adapter-v1',
    source: { input: 'https://example.com/before-download' },
    output: { root: runRoot },
    policy: {
      dryRun: false,
      retries: 0,
      retryBackoffMs: 0,
    },
  });
  const hookRegistry = createCapabilityHookRegistry([{
    id: 'download-before-guard',
    phase: 'before_download',
    hookType: 'guard',
    subscriber: {
      name: 'download-before-guard',
      modulePath: 'src/sites/capability/download-policy.mjs',
      entrypoint: 'normalizeDownloadPolicy',
      capability: 'download-policy',
      order: 1,
    },
    filters: {
      eventTypes: ['download.executor.before_download'],
      siteKeys: ['example'],
      taskTypes: ['generic-resource'],
    },
  }]);
  const lifecycleEvents = [];
  let fetchSawBeforeDownload = false;

  const manifest = await executeResolvedDownloadTask({
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'resource-1',
      url: 'https://example.com/before-download.txt',
      fileName: 'before-download.txt',
      mediaType: 'text',
    }],
  }, plan, {
    siteKey: 'example',
    host: 'example.com',
    mode: 'reusable-profile',
    status: 'ready',
    sessionView: {
      schemaVersion: SESSION_VIEW_SCHEMA_VERSION,
      siteKey: 'example',
      purpose: 'download',
      status: 'ready',
      profileRef: 'anonymous',
      permission: ['read'],
      ttlSeconds: 60,
      networkContext: { host: 'example.com' },
    },
    riskSignals: ['refresh_token=synthetic-before-download-token'],
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    dryRun: false,
  }, {
    capabilityHookRegistry: hookRegistry,
    lifecycleEventSubscribers: [async (event) => {
      lifecycleEvents.push(JSON.parse(JSON.stringify(event)));
    }],
    fetchImpl: async () => {
      fetchSawBeforeDownload = lifecycleEvents.some((event) => (
        event.eventType === 'download.executor.before_download'
      ));
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return Buffer.from('before download body', 'utf8');
        },
      };
    },
  });

  assert.equal(fetchSawBeforeDownload, true);
  assert.equal(manifest.status, 'passed');
  const beforeLifecycleEvent = lifecycleEvents.find((event) => (
    event.eventType === 'download.executor.before_download'
  ));
  assert.equal(beforeLifecycleEvent.schemaVersion, LIFECYCLE_EVENT_SCHEMA_VERSION);
  assert.equal(assertSchemaCompatible('LifecycleEvent', beforeLifecycleEvent), true);
  assert.equal(assertLifecycleEventObservabilityFields(beforeLifecycleEvent, {
    requiredFields: [
      'traceId',
      'correlationId',
      'taskId',
      'siteKey',
      'taskType',
      'adapterVersion',
      'reasonCode',
    ],
    requiredDetailFields: [
      'counts',
      'capabilityHookPhase',
      'capabilityHookMatches',
      'capabilityHookLifecycleEvidence',
    ],
  }), true);
  assert.equal(beforeLifecycleEvent.traceId, manifest.runId);
  assert.equal(beforeLifecycleEvent.correlationId, manifest.planId);
  assert.equal(beforeLifecycleEvent.taskId, manifest.runId);
  assert.equal(beforeLifecycleEvent.siteKey, 'example');
  assert.equal(beforeLifecycleEvent.taskType, plan.taskType);
  assert.equal(beforeLifecycleEvent.adapterVersion, 'example-adapter-v1');
  assert.equal(beforeLifecycleEvent.reasonCode, 'before-download');
  assert.equal(beforeLifecycleEvent.details.status, 'planned');
  assert.equal(beforeLifecycleEvent.details.reason, 'before-download');
  assert.deepEqual(beforeLifecycleEvent.details.counts, {
    expected: 1,
    attempted: 0,
    downloaded: 0,
    skipped: 0,
    failed: 0,
  });
  assert.equal(beforeLifecycleEvent.details.capabilityHookPhase, 'before_download');
  assert.deepEqual(beforeLifecycleEvent.details.riskSignals, [REDACTION_PLACEHOLDER]);
  assert.deepEqual(beforeLifecycleEvent.details.capabilityHookMatches.executionPolicy, CAPABILITY_HOOK_EXECUTION_POLICY);
  assert.deepEqual(beforeLifecycleEvent.details.capabilityHookMatches.phases, ['before_download']);
  assert.equal(beforeLifecycleEvent.details.capabilityHookMatches.matchCount, 1);
  assert.equal(beforeLifecycleEvent.details.capabilityHookMatches.matches[0].id, 'download-before-guard');
  assert.equal(
    Object.hasOwn(beforeLifecycleEvent.details.capabilityHookMatches.matches[0].subscriber, 'modulePath'),
    false,
  );
  assert.equal(
    Object.hasOwn(beforeLifecycleEvent.details.capabilityHookMatches.matches[0].subscriber, 'entrypoint'),
    false,
  );
  assert.equal(
    beforeLifecycleEvent.details.capabilityHookLifecycleEvidence.evidenceType,
    'capability_hook.lifecycle_match_summary',
  );
  assert.equal(
    beforeLifecycleEvent.details.capabilityHookLifecycleEvidence.descriptorPolicy.descriptorOnly,
    true,
  );
  assert.deepEqual(
    beforeLifecycleEvent.details.capabilityHookLifecycleEvidence.executionPolicy,
    CAPABILITY_HOOK_EXECUTION_POLICY,
  );
  assert.equal(JSON.stringify(beforeLifecycleEvent).includes('synthetic-before-download-token'), false);
  assert.doesNotMatch(
    JSON.stringify(beforeLifecycleEvent),
    /headers|authorization|cookie|csrf|Bearer|modulePath|entrypoint/iu,
  );

  const persistedBeforeLifecycleEvent = await readJsonFile(
    path.join(path.dirname(manifest.artifacts.manifest), 'before-download-lifecycle-event.json'),
  );
  assert.deepEqual(persistedBeforeLifecycleEvent, beforeLifecycleEvent);
  const beforeLifecycleAudit = await readJsonFile(
    path.join(path.dirname(manifest.artifacts.manifest), 'before-download-lifecycle-event-redaction-audit.json'),
  );
  assert.deepEqual(beforeLifecycleAudit.redactedPaths, []);
  assert.equal(JSON.stringify(beforeLifecycleAudit).includes('synthetic-before-download-token'), false);
});

test('download executor dry-run lifecycle subscriber failure fails closed before manifest write', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-executor-lifecycle-failure-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const runId = 'executor-dry-run-lifecycle-failure';

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/fail-closed-dry-run' },
    output: { root: runRoot },
  });

  await assert.rejects(
    () => executeResolvedDownloadTask({
      planId: plan.id,
      siteKey: plan.siteKey,
      taskType: plan.taskType,
      resources: [{
        id: 'resource-1',
        url: 'https://example.com/fail-closed-dry-run.txt',
        fileName: 'fail-closed-dry-run.txt',
        mediaType: 'text',
      }],
    }, plan, {
      siteKey: 'example',
      host: 'example.com',
      mode: 'reusable-profile',
      status: 'ready',
    }, {
      workspaceRoot: REPO_ROOT,
      runRoot,
      runId,
      dryRun: true,
    }, {
      lifecycleEventSubscribers: [
        async () => {
          throw new Error('synthetic-executor-lifecycle-failure');
        },
      ],
    }),
    /synthetic-executor-lifecycle-failure/u,
  );
  await assert.rejects(
    () => readFile(path.join(runRoot, runId, 'manifest.json'), 'utf8'),
    /ENOENT/u,
  );
});

test('download executor runtime compatibility gate fails closed before artifact writes', async (t) => {
  const cases = [
    {
      name: 'future DownloadPolicy',
      mutate({ plan }) {
        plan.policy = {
          ...plan.policy,
          schemaVersion: DOWNLOAD_POLICY_SCHEMA_VERSION + 1,
        };
      },
      expected: /DownloadPolicy schemaVersion .* is not compatible/u,
    },
    {
      name: 'future SessionView',
      sessionLease: {
        siteKey: 'example',
        host: 'example.com',
        mode: 'authenticated',
        status: 'ready',
        sessionView: {
          schemaVersion: SESSION_VIEW_SCHEMA_VERSION + 1,
          siteKey: 'example',
          purpose: 'download',
          status: 'ready',
        },
      },
      expected: /SessionView schemaVersion .* is not compatible/u,
    },
    {
      name: 'inactive ApiCatalogEntry provenance',
      resolvedMetadata: {
        apiCatalogEntry: {
          schemaVersion: API_CATALOG_ENTRY_SCHEMA_VERSION,
          status: 'cataloged',
          invalidationStatus: 'stale',
        },
      },
      expected: /requires an active cataloged ApiCatalogEntry/u,
    },
  ];

  for (const testCase of cases) {
    const runRoot = await mkdtemp(path.join(os.tmpdir(), `bwk-download-runtime-compat-${testCase.name.replace(/\W+/gu, '-')}-`));
    t.after(() => rm(runRoot, { recursive: true, force: true }));
    const plan = normalizeDownloadTaskPlan({
      siteKey: 'example',
      host: 'example.com',
      taskType: 'generic-resource',
      source: { input: `https://example.com/${testCase.name}` },
      output: { root: runRoot },
      policy: { dryRun: true, retries: 0 },
    });
    testCase.mutate?.({ plan });
    const resolvedTask = {
      planId: plan.id,
      siteKey: plan.siteKey,
      taskType: plan.taskType,
      metadata: testCase.resolvedMetadata,
      resources: [{
        id: 'resource-1',
        url: `https://example.com/${testCase.name}.txt`,
        fileName: 'resource-1.txt',
        mediaType: 'text',
      }],
    };

    await assert.rejects(
      () => executeResolvedDownloadTask(
        resolvedTask,
        plan,
        testCase.sessionLease ?? null,
        {
          workspaceRoot: REPO_ROOT,
          runRoot,
          dryRun: true,
        },
      ),
      testCase.expected,
    );
    assert.deepEqual(await readdir(runRoot), []);
  }
});

test('download executor runtime compatibility gate returns governed StandardTaskList evidence', () => {
  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/runtime-compatible' },
    policy: { dryRun: true, retries: 0 },
  });
  const result = assertRuntimeDownloadCompatibility({
    plan,
    resolvedTask: {
      planId: plan.id,
      siteKey: plan.siteKey,
      taskType: plan.taskType,
      metadata: {
        apiCatalogEntry: {
          schemaVersion: API_CATALOG_ENTRY_SCHEMA_VERSION,
          status: 'cataloged',
          invalidationStatus: 'active',
        },
      },
      resources: [{
        id: 'resource-1',
        url: 'https://example.com/runtime-compatible.txt',
        mediaType: 'text',
      }],
    },
    sessionLease: {
      sessionView: {
        schemaVersion: SESSION_VIEW_SCHEMA_VERSION,
        siteKey: 'example',
        purpose: 'download',
        status: 'ready',
      },
    },
  });

  assert.equal(result.catalogEntryChecked, true);
  assert.equal(result.sessionViewChecked, true);
  assert.equal(result.standardTaskList.schemaVersion, STANDARD_TASK_LIST_SCHEMA_VERSION);
  assert.equal(assertSchemaCompatible('StandardTaskList', result.standardTaskList), true);
});

test('download runner runtime compatibility gate blocks inactive catalog provenance before downloader branches', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-runtime-compat-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  let resolverInvoked = false;
  let executorInvoked = false;
  let legacyInvoked = false;
  await assert.rejects(
    () => runDownloadTask(native22BiquRequest({ dryRun: false }), {
      workspaceRoot: REPO_ROOT,
      runRoot,
    }, {
      acquireSessionLease: async (_siteKey, purpose) => native22BiquSessionLease(purpose),
      releaseSessionLease: async () => {},
      resolveDownloadResources: async (plan) => {
        resolverInvoked = true;
        return {
          planId: plan.id,
          siteKey: plan.siteKey,
          taskType: plan.taskType,
          metadata: {
            apiCatalogEntry: {
              schemaVersion: API_CATALOG_ENTRY_SCHEMA_VERSION,
              status: 'cataloged',
              invalidationStatus: 'stale',
            },
          },
          resources: [{
            id: 'resource-1',
            url: 'https://www.22biqu.com/biqu123/1.html',
            fileName: 'chapter-one.txt',
            mediaType: 'text',
          }],
        };
      },
      executeResolvedDownloadTask: async () => {
        executorInvoked = true;
        throw new Error('executor must not run after runtime compatibility failure');
      },
      executeLegacyDownloadTask: async () => {
        legacyInvoked = true;
        throw new Error('legacy executor must not run after runtime compatibility failure');
      },
    }),
    /requires an active cataloged ApiCatalogEntry/u,
  );
  assert.equal(resolverInvoked, true);
  assert.equal(executorInvoked, false);
  assert.equal(legacyInvoked, false);
  assert.deepEqual(await readdir(runRoot), []);
});

test('download runner rejects blocked planner health gates before downloader branches', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-health-gate-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  let definitionInvoked = false;
  let planInvoked = false;
  let resolverInvoked = false;
  await assert.rejects(
    () => runDownloadTask({
      site: 'example',
      input: 'https://example.com/protected',
      plannerHandoff: {
        downloadPolicy: normalizeDownloadPolicy({
          siteKey: 'example',
          taskType: 'archive-items',
          dryRun: false,
          sessionRequirement: 'required',
        }),
        taskList: normalizeStandardTaskList({
          siteKey: 'example',
          taskType: 'archive-items',
          items: [{
            id: 'protected-write',
            kind: 'request',
            endpoint: 'https://example.com/protected',
            capability: 'post.write',
            mode: 'write',
            healthGate: {
              allowed: false,
              reason: 'captcha-required',
              actions: ['require-user-action', 'safe-stop'],
            },
          }],
        }),
      },
    }, {
      workspaceRoot: REPO_ROOT,
      runRoot,
    }, {
      resolveDownloadSiteDefinition: async () => {
        definitionInvoked = true;
        throw new Error('definition resolution must not run after health gate failure');
      },
      createDownloadPlan: async () => {
        planInvoked = true;
        throw new Error('plan creation must not run after health gate failure');
      },
      resolveDownloadResources: async () => {
        resolverInvoked = true;
        throw new Error('resolver must not run after health gate failure');
      },
    }),
    /blocked by SiteHealthExecutionGate: captcha-required/u,
  );
  assert.equal(definitionInvoked, false);
  assert.equal(planInvoked, false);
  assert.equal(resolverInvoked, false);
  assert.deepEqual(await readdir(runRoot), []);
});

test('download runner execute downloads native resolved resources through the generic executor', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-native-exec-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  let genericExecutorInvoked = false;
  let legacyInvoked = false;
  const fetchedUrls = [];
  const result = await runDownloadTask(native22BiquRequest({ dryRun: false }), {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    acquireSessionLease: async (_siteKey, purpose) => native22BiquSessionLease(purpose),
    releaseSessionLease: async () => {},
    executeResolvedDownloadTask: async (resolvedTask, plan, sessionLease, options, executorDeps) => {
      genericExecutorInvoked = true;
      return await executeResolvedDownloadTask(resolvedTask, plan, sessionLease, options, executorDeps);
    },
    executeLegacyDownloadTask: async () => {
      legacyInvoked = true;
      throw new Error('legacy adapter should not execute when native resources are resolved');
    },
    spawnJsonCommand: async () => {
      legacyInvoked = true;
      throw new Error('legacy spawn should not run when native resources are resolved');
    },
    fetchImpl: async (url) => {
      fetchedUrls.push(String(url));
      const payload = Buffer.from(`chapter body for ${url}`, 'utf8');
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      };
    },
  });

  assert.equal(genericExecutorInvoked, true);
  assert.equal(legacyInvoked, false);
  assert.deepEqual(fetchedUrls.sort(), [
    'https://www.22biqu.com/biqu123/1.html',
    'https://www.22biqu.com/biqu123/2.html',
  ]);
  assert.equal(result.plan.legacy.entrypoint.endsWith(path.join('src', 'sites', 'chapter-content', 'download', 'python', 'book.py')), true);
  assert.equal(result.resolvedTask.metadata.resolver.method, 'native-22biqu-chapters');
  assert.equal(result.manifest.status, 'passed');
  assert.equal(result.manifest.reason, DEFAULT_DOWNLOAD_COMPLETED_REASON);
  assert.equal(result.manifest.counts.expected, 2);
  assert.equal(result.manifest.counts.downloaded, 2);
  assert.equal(result.manifest.counts.failed, 0);
  assert.equal(result.manifest.legacy, undefined);
  assert.equal(result.manifest.files.length, 2);
  assert.match(await readFile(result.manifest.files[0].filePath, 'utf8'), /chapter body for/u);

  const artifacts = await assertDownloadRunArtifactBundle(result.manifest);
  assert.equal(artifacts.persistedManifest.planId, result.plan.id);
  assert.equal(artifacts.plan.id, result.plan.id);
  assert.equal(artifacts.plan.policy.dryRun, false);
  assert.equal(artifacts.resolvedTask.resources.length, 2);
  assert.deepEqual(artifacts.queue.map((entry) => entry.status), ['downloaded', 'downloaded']);
  assert.equal(artifacts.downloads.length, 2);
  assert.equal(artifacts.downloads.every((entry) => entry.ok === true), true);
  assert.match(artifacts.report, /Status: passed/u);
  assert.match(artifacts.report, /Manifest:/u);
  assert.match(artifacts.report, /Queue:/u);
  assert.match(artifacts.report, /Downloads JSONL:/u);
});

test('download executor consumes resolved resources without site-specific logic', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-executor-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    adapterVersion: 'example-adapter-v1',
    source: { input: 'https://example.com/file.txt?cursor=1' },
    policy: { dryRun: false, verify: true, retries: 0 },
    output: { root: runRoot },
  });
  const payload = Buffer.from('download body', 'utf8');
  const manifest = await executeResolvedDownloadTask({
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'resource-1',
      url: 'https://example.com/file.txt?access_token=synthetic-standard-task-token&cursor=1',
      method: 'POST',
      headers: {
        authorization: 'Bearer synthetic-standard-task-header',
        cookie: 'sid=synthetic-standard-task-cookie',
      },
      body: 'csrf=synthetic-standard-task-csrf&token=synthetic-standard-task-body-token',
      fileName: 'file.txt',
      mediaType: 'text',
      expectedBytes: payload.length,
    }],
  }, plan, {
    siteKey: 'example',
    host: 'example.com',
    status: 'ready',
    mode: 'anonymous',
    riskSignals: ['refresh_token=synthetic-executor-result-token'],
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    dryRun: false,
  }, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async arrayBuffer() {
        return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
      },
    }),
  });

  assert.equal(manifest.status, 'passed');
  assert.equal(manifest.counts.downloaded, 1);
  assert.equal(await readFile(manifest.files[0].filePath, 'utf8'), 'download body');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.equal(typeof persisted.artifacts.standardTaskList, 'string');
  const standardTaskList = await readJsonFile(persisted.artifacts.standardTaskList);
  assert.equal(standardTaskList.schemaVersion, STANDARD_TASK_LIST_SCHEMA_VERSION);
  assert.equal(standardTaskList.siteKey, 'example');
  assert.equal(standardTaskList.taskType, 'generic-resource');
  assert.equal(standardTaskList.policyRef, `download-plan:${plan.id}:policy`);
  assert.equal(standardTaskList.items.length, 1);
  assert.deepEqual(standardTaskList.items[0], {
    id: 'resource-1',
    kind: 'download',
    endpoint: standardTaskList.items[0].endpoint,
    method: 'POST',
    retry: {
      retries: 0,
      retryBackoffMs: 1000,
    },
    cacheKey: 'resource-1',
    dedupKey: 'resource-1',
  });
  assert.equal(
    standardTaskList.items[0].endpoint.includes(REDACTION_PLACEHOLDER)
      || standardTaskList.items[0].endpoint.includes(encodeURIComponent(REDACTION_PLACEHOLDER)),
    true,
  );
  assert.doesNotMatch(
    JSON.stringify(standardTaskList),
    /synthetic-standard-task-|headers|authorization|cookie|csrf|Bearer/iu,
  );
  const runDir = path.dirname(persisted.artifacts.manifest);
  const resolvedTaskArtifact = await readJsonFile(path.join(runDir, 'resolved-task.json'));
  const queueArtifact = await readJsonFile(persisted.artifacts.queue);
  const downloadsArtifact = await readJsonLinesFile(persisted.artifacts.downloadsJsonl);
  for (const artifact of [resolvedTaskArtifact, queueArtifact, downloadsArtifact]) {
    assert.doesNotMatch(
      JSON.stringify(artifact),
      /synthetic-standard-task-|headers|authorization|cookie|csrf|Bearer/iu,
    );
  }
  assert.equal(JSON.stringify(persisted).includes('synthetic-executor-result-token'), false);
  assert.equal(JSON.stringify(persisted).includes('synthetic-standard-task-token'), false);
  assert.deepEqual(persisted.session.riskSignals, [REDACTION_PLACEHOLDER]);
  assert.equal(typeof persisted.artifacts.redactionAudit, 'string');
  const audit = await readJsonFile(persisted.artifacts.redactionAudit);
  assert.equal(JSON.stringify(audit).includes('synthetic-executor-result-token'), false);
  assert.equal(JSON.stringify(audit).includes('synthetic-standard-task-token'), false);
  assert.deepEqual(audit.redactedPaths.sort(), ['session.riskSignals.0']);
  assert.equal(audit.findings.some((finding) => finding.path === 'files.0.url'), false);
  assert.equal(audit.findings.some((finding) => finding.path === 'session.riskSignals.0'), true);
  assert.equal(typeof persisted.artifacts.lifecycleEvent, 'string');
  assert.equal(typeof persisted.artifacts.lifecycleEventRedactionAudit, 'string');
  const lifecycleEvent = await readJsonFile(persisted.artifacts.lifecycleEvent);
  assert.equal(lifecycleEvent.schemaVersion, LIFECYCLE_EVENT_SCHEMA_VERSION);
  assert.equal(assertSchemaCompatible('LifecycleEvent', lifecycleEvent), true);
  assert.equal(lifecycleEvent.eventType, 'download.executor.completed');
  assert.equal(lifecycleEvent.traceId, persisted.runId);
  assert.equal(lifecycleEvent.correlationId, persisted.planId);
  assert.equal(lifecycleEvent.taskId, persisted.runId);
  assert.equal(lifecycleEvent.siteKey, 'example');
  assert.equal(lifecycleEvent.taskType, plan.taskType);
  assert.equal(lifecycleEvent.adapterVersion, 'example-adapter-v1');
  assert.equal(lifecycleEvent.reasonCode, DEFAULT_DOWNLOAD_COMPLETED_REASON);
  assert.equal(lifecycleEvent.details.status, 'passed');
  assert.deepEqual(lifecycleEvent.details.counts, persisted.counts);
  assert.deepEqual(lifecycleEvent.details.riskSignals, [REDACTION_PLACEHOLDER]);
  assert.equal(JSON.stringify(lifecycleEvent).includes('synthetic-executor-result-token'), false);
  const lifecycleAudit = await readJsonFile(persisted.artifacts.lifecycleEventRedactionAudit);
  assert.equal(JSON.stringify(lifecycleAudit).includes('synthetic-executor-result-token'), false);
  assert.equal(lifecycleAudit.redactedPaths.includes('details.riskSignals.0'), true);
  assert.deepEqual(lifecycleAudit.findings, [{
    path: 'details.riskSignals.0',
    pattern: 'sensitive-query-assignment',
  }]);
  assert.deepEqual(manifest.session.riskSignals, ['refresh_token=synthetic-executor-result-token']);
});

test('download executor ignores raw session lease headers when SessionView is present', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-executor-session-view-headers-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const payload = Buffer.from('download body', 'utf8');
  let capturedHeaders = null;
  const hookRegistry = createCapabilityHookRegistry([{
    id: 'download-executor-completed-observer',
    phase: 'after_download',
    subscriber: {
      name: 'download-executor-completed-observer',
      modulePath: 'src/sites/capability/lifecycle-events.mjs',
      entrypoint: 'observe',
      order: 1,
    },
    filters: {
      eventTypes: ['download.executor.completed'],
      siteKeys: ['example'],
    },
  }]);

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    adapterVersion: 'example-adapter-v1',
    source: { input: 'https://example.com/session-view-headers.txt' },
    policy: { dryRun: false, verify: false, retries: 0 },
    output: { root: runRoot },
  });

  const manifest = await executeResolvedDownloadTask({
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'resource-1',
      url: 'https://example.com/session-view-headers.txt',
      headers: {
        'x-resource-header': 'resource-safe-value',
      },
      referer: 'https://example.com/source-page',
      fileName: 'session-view-headers.txt',
      mediaType: 'text',
      expectedBytes: payload.length,
    }],
  }, plan, {
    siteKey: 'example',
    host: 'example.com',
    status: 'ready',
    mode: 'authenticated',
    headers: {
      authorization: 'Bearer synthetic-sessionview-lease-token',
      cookie: 'sid=synthetic-sessionview-lease-cookie',
    },
    sessionView: {
      schemaVersion: SESSION_VIEW_SCHEMA_VERSION,
      siteKey: 'example',
      purpose: 'download',
      status: 'ready',
      profileRef: 'anonymous',
      permission: ['read'],
      ttlSeconds: 60,
      networkContext: { host: 'example.com' },
    },
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    dryRun: false,
  }, {
    capabilityHookRegistry: hookRegistry,
    fetchImpl: async (_url, init = {}) => {
      capturedHeaders = init.headers;
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      };
    },
  });

  assert.equal(capturedHeaders.authorization, undefined);
  assert.equal(capturedHeaders.Authorization, undefined);
  assert.equal(capturedHeaders.cookie, undefined);
  assert.equal(capturedHeaders.Cookie, undefined);
  assert.equal(capturedHeaders['x-resource-header'], 'resource-safe-value');
  assert.equal(capturedHeaders.referer, 'https://example.com/source-page');
  assert.equal(manifest.status, 'passed');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.equal(persisted.session.sessionView.schemaVersion, SESSION_VIEW_SCHEMA_VERSION);
  assert.equal(JSON.stringify(persisted).includes('synthetic-sessionview-lease-token'), false);
  assert.equal(JSON.stringify(persisted).includes('synthetic-sessionview-lease-cookie'), false);
  const lifecycleEvent = await readJsonFile(persisted.artifacts.lifecycleEvent);
  assert.equal(lifecycleEvent.schemaVersion, LIFECYCLE_EVENT_SCHEMA_VERSION);
  assert.equal(assertSchemaCompatible('LifecycleEvent', lifecycleEvent), true);
  assert.equal(assertLifecycleEventObservabilityFields(lifecycleEvent, {
    requiredFields: [
      'traceId',
      'correlationId',
      'taskId',
      'siteKey',
      'taskType',
      'adapterVersion',
    ],
    requiredDetailFields: [
      'counts',
      'profileRef',
      'capabilityHookMatches',
    ],
  }), true);
  assert.equal(lifecycleEvent.eventType, 'download.executor.completed');
  assert.equal(lifecycleEvent.taskType, plan.taskType);
  assert.deepEqual(lifecycleEvent.details.counts, persisted.counts);
  assert.equal(lifecycleEvent.details.profileRef, 'anonymous');
  assert.deepEqual(lifecycleEvent.details.capabilityHookMatches.phases, ['after_download', 'on_completion']);
  assert.equal(lifecycleEvent.details.capabilityHookMatches.matchCount, 1);
  assert.equal(lifecycleEvent.details.capabilityHookMatches.matches[0].id, 'download-executor-completed-observer');
  assert.equal(
    Object.hasOwn(lifecycleEvent.details.capabilityHookMatches.matches[0].subscriber, 'modulePath'),
    false,
  );
  assert.equal(
    Object.hasOwn(lifecycleEvent.details.capabilityHookMatches.matches[0].subscriber, 'entrypoint'),
    false,
  );
  assert.equal(JSON.stringify(lifecycleEvent).includes('synthetic-sessionview-lease-token'), false);
  assert.equal(JSON.stringify(lifecycleEvent).includes('synthetic-sessionview-lease-cookie'), false);
  const queueArtifact = await readJsonFile(persisted.artifacts.queue);
  const downloadsArtifact = await readJsonLinesFile(persisted.artifacts.downloadsJsonl);
  for (const artifact of [persisted, lifecycleEvent, queueArtifact, downloadsArtifact]) {
    assert.doesNotMatch(
      JSON.stringify(artifact),
      /synthetic-sessionview-lease-|authorization|cookie|Bearer/iu,
    );
  }
});

test('download executor keeps no-SessionView legacy raw lease fields out of artifacts', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-executor-legacy-lease-artifacts-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const payload = Buffer.from('download body', 'utf8');
  let capturedHeaders = null;

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/legacy-lease.txt' },
    policy: { dryRun: false, verify: false, retries: 0 },
    output: { root: runRoot },
  });

  const manifest = await executeResolvedDownloadTask({
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'resource-1',
      url: 'https://example.com/legacy-lease.txt',
      fileName: 'legacy-lease.txt',
      mediaType: 'text',
      expectedBytes: payload.length,
    }],
  }, plan, {
    siteKey: 'example',
    host: 'example.com',
    status: 'ready',
    mode: 'authenticated',
    browserProfileRoot: 'C:/synthetic-legacy-executor-profile-root',
    userDataDir: 'C:/synthetic-legacy-executor-user-data-dir',
    headers: {
      Authorization: 'Bearer synthetic-legacy-executor-lease-token',
      Cookie: 'sid=synthetic-legacy-executor-lease-cookie',
      'X-CSRF-Token': 'synthetic-legacy-executor-lease-csrf',
      'User-Agent': 'synthetic-safe-legacy-user-agent',
    },
    cookies: [{ name: 'sid', value: 'synthetic-legacy-executor-cookie' }],
    riskSignals: ['refresh_token=synthetic-legacy-executor-risk-token'],
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    dryRun: false,
  }, {
    fetchImpl: async (_url, init = {}) => {
      capturedHeaders = init.headers;
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      };
    },
  });

  assert.equal(capturedHeaders.Authorization, undefined);
  assert.equal(capturedHeaders.authorization, undefined);
  assert.equal(capturedHeaders.Cookie, undefined);
  assert.equal(capturedHeaders.cookie, undefined);
  assert.equal(capturedHeaders['X-CSRF-Token'], undefined);
  assert.equal(capturedHeaders['User-Agent'], 'synthetic-safe-legacy-user-agent');
  assert.equal(manifest.status, 'passed');

  const persisted = await readJsonFile(manifest.artifacts.manifest);
  const resolvedTaskArtifact = await readJsonFile(path.join(path.dirname(persisted.artifacts.manifest), 'resolved-task.json'));
  const queueArtifact = await readJsonFile(persisted.artifacts.queue);
  const downloadsArtifact = await readJsonLinesFile(persisted.artifacts.downloadsJsonl);
  const standardTaskList = await readJsonFile(persisted.artifacts.standardTaskList);
  const redactionAudit = await readJsonFile(persisted.artifacts.redactionAudit);
  const lifecycleEvent = await readJsonFile(persisted.artifacts.lifecycleEvent);
  const lifecycleAudit = await readJsonFile(persisted.artifacts.lifecycleEventRedactionAudit);
  assert.equal(standardTaskList.schemaVersion, STANDARD_TASK_LIST_SCHEMA_VERSION);
  assert.equal(assertSchemaCompatible('StandardTaskList', standardTaskList), true);
  assert.equal(lifecycleEvent.eventType, 'download.executor.completed');
  assert.equal(assertSchemaCompatible('LifecycleEvent', lifecycleEvent), true);
  assert.deepEqual(persisted.session.riskSignals, [REDACTION_PLACEHOLDER]);
  assert.equal(Object.hasOwn(persisted.session, 'headers'), false);
  assert.equal(Object.hasOwn(persisted.session, 'cookies'), false);
  assert.equal(Object.hasOwn(persisted.session, 'browserProfileRoot'), false);
  assert.equal(Object.hasOwn(persisted.session, 'userDataDir'), false);

  for (const artifact of [
    persisted,
    resolvedTaskArtifact,
    queueArtifact,
    downloadsArtifact,
    standardTaskList,
    redactionAudit,
    lifecycleEvent,
    lifecycleAudit,
  ]) {
    assert.doesNotMatch(
      JSON.stringify(artifact),
      /synthetic-legacy-executor-(?:lease|cookie|profile|user-data|risk)|authorization|cookie|csrf|Bearer|browserProfileRoot|userDataDir/iu,
    );
  }
});

test('registry download resolver does not promote raw lease headers when SessionView is present', async () => {
  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/session-view-registry' },
    policy: { dryRun: false, verify: false, retries: 0 },
  });
  const sessionLease = {
    siteKey: 'example',
    host: 'example.com',
    status: 'ready',
    mode: 'authenticated',
    headers: {
      authorization: 'Bearer synthetic-registry-lease-token',
      cookie: 'sid=synthetic-registry-lease-cookie',
    },
    sessionView: {
      schemaVersion: SESSION_VIEW_SCHEMA_VERSION,
      siteKey: 'example',
      purpose: 'download',
      status: 'ready',
      permission: ['read'],
      ttlSeconds: 60,
      networkContext: { host: 'example.com' },
    },
  };

  const resolved = await resolveRegistryDownloadResources(plan, sessionLease, {
    request: {
      mediaType: 'text',
      headers: {
        Authorization: 'Bearer synthetic-registry-request-token',
        Cookie: 'sid=synthetic-registry-request-cookie',
        Range: 'bytes=0-1023',
      },
      downloadHeaders: {
        'X-CSRF-Token': 'synthetic-registry-download-csrf',
        Referer: 'https://example.com/source-page',
      },
      resources: [
        {
          url: 'https://example.com/no-explicit-headers.txt',
          fileName: 'no-explicit-headers.txt',
        },
        {
          url: 'https://example.com/explicit-safe-header.txt',
          fileName: 'explicit-safe-header.txt',
          headers: {
            'x-resource-header': 'resource-safe-value',
            Cookie: 'sid=synthetic-registry-resource-cookie',
            'x-access-token': 'synthetic-registry-resource-access-token',
          },
        },
      ],
    },
  });

  assert.equal(resolved.resources.length, 2);
  assert.deepEqual(resolved.resources[0].headers, {
    Referer: 'https://example.com/source-page',
  });
  assert.equal(Object.hasOwn(resolved.resources[1].headers, 'Range'), false);
  assert.equal(resolved.resources[1].headers.Referer, 'https://example.com/source-page');
  assert.equal(resolved.resources[1].headers['x-resource-header'], 'resource-safe-value');
  for (const resource of resolved.resources) {
    assert.equal(resource.headers.authorization, undefined);
    assert.equal(resource.headers.Authorization, undefined);
    assert.equal(resource.headers.cookie, undefined);
    assert.equal(resource.headers.Cookie, undefined);
    assert.equal(resource.headers['X-CSRF-Token'], undefined);
    assert.equal(resource.headers['x-access-token'], undefined);
  }
  assert.doesNotMatch(
    JSON.stringify(resolved),
    /synthetic-registry-(lease|request|download|resource)-|authorization|cookie|csrf|token|Bearer/iu,
  );

  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-registry-boundary-'));
  try {
    const manifest = await executeResolvedDownloadTask(resolved, plan, sessionLease, {
      workspaceRoot: REPO_ROOT,
      runRoot,
      dryRun: true,
    });
    const persistedManifest = await readJsonFile(manifest.artifacts.manifest);
    const persistedStandardTaskList = await readJsonFile(persistedManifest.artifacts.standardTaskList);
    const persistedRedactionAudit = await readJsonFile(persistedManifest.artifacts.redactionAudit);
    const persistedTexts = [
      JSON.stringify(persistedManifest),
      JSON.stringify(persistedStandardTaskList),
      JSON.stringify(persistedRedactionAudit),
    ];
    for (const text of persistedTexts) {
      assert.doesNotMatch(
        text,
        /synthetic-registry-(lease|request|download|resource)-|authorization|cookie|csrf|token|Bearer/iu,
      );
    }
    assert.equal(persistedManifest.session.sessionView.schemaVersion, SESSION_VIEW_SCHEMA_VERSION);
    assert.equal(Object.hasOwn(persistedManifest.session, 'headers'), false);
    assert.equal(Object.hasOwn(persistedManifest.session, 'cookies'), false);
    assert.equal(persistedStandardTaskList.schemaVersion, STANDARD_TASK_LIST_SCHEMA_VERSION);
  } finally {
    await rm(runRoot, { force: true, recursive: true });
  }
});

test('shared native resource seed resolver keeps a no-network low-permission boundary', async () => {
  const resourceSeedModuleSource = await readFile(
    path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'resource-seeds.mjs'),
    'utf8',
  );
  assert.doesNotMatch(resourceSeedModuleSource, /\bfetch\s*\(/u);
  assert.doesNotMatch(resourceSeedModuleSource, /from ['"]node:(?:http|https)['"]/u);

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/source-page' },
    policy: { dryRun: true, verify: false, retries: 0 },
  });
  const sessionLease = {
    siteKey: 'example',
    host: 'example.com',
    status: 'ready',
    mode: 'authenticated',
    headers: {
      Authorization: 'Bearer synthetic-shared-lease-token',
      Cookie: 'sid=synthetic-shared-lease-cookie',
    },
    sessionView: {
      schemaVersion: SESSION_VIEW_SCHEMA_VERSION,
      siteKey: 'example',
      purpose: 'download',
      status: 'ready',
      permission: ['read'],
      ttlSeconds: 60,
      networkContext: { host: 'example.com' },
    },
  };

  const resolved = resolveNativeResourceSeeds('example', plan, sessionLease, {
    request: {
      baseUrl: 'https://example.com/articles/42',
      title: 'Synthetic Shared Resource',
      headers: {
        Authorization: 'Bearer synthetic-shared-request-token',
        Cookie: 'sid=synthetic-shared-request-cookie',
        Accept: 'text/plain',
        Range: 'bytes=0-10',
      },
      downloadHeaders: {
        'X-CSRF-Token': 'synthetic-shared-download-csrf',
        Referer: 'https://example.com/articles/42',
      },
      resourceSeeds: [{
        id: 'shared-resource-1',
        url: '/media/shared-resource.txt',
        mediaType: 'text',
        fileName: 'shared-resource.txt',
        headers: {
          'x-safe-resource-header': 'safe-value',
          Cookie: 'sid=synthetic-shared-resource-cookie',
          'x-access-token': 'synthetic-shared-resource-access-token',
        },
      }],
    },
  }, {
    method: 'native-shared-resource-seeds',
    defaultMediaType: 'text',
  });

  assert.ok(resolved);
  assert.equal(resolved.planId, plan.id);
  assert.equal(resolved.siteKey, 'example');
  assert.equal(resolved.taskType, 'generic-resource');
  assert.equal(resolved.resources.length, 1);
  assert.equal(resolved.metadata.resolver.method, 'native-shared-resource-seeds');
  assert.equal(resolved.resources[0].url, 'https://example.com/media/shared-resource.txt');
  assert.equal(resolved.resources[0].fileName, 'shared-resource.txt');
  assert.equal(resolved.resources[0].headers.Accept, 'text/plain');
  assert.equal(resolved.resources[0].headers.Range, 'bytes=0-10');
  assert.equal(resolved.resources[0].headers.Referer, 'https://example.com/articles/42');
  assert.equal(resolved.resources[0].headers['x-safe-resource-header'], 'safe-value');
  assert.equal(Object.hasOwn(resolved.resources[0].headers, 'Authorization'), false);
  assert.equal(Object.hasOwn(resolved.resources[0].headers, 'authorization'), false);
  assert.equal(Object.hasOwn(resolved.resources[0].headers, 'Cookie'), false);
  assert.equal(Object.hasOwn(resolved.resources[0].headers, 'cookie'), false);
  assert.equal(Object.hasOwn(resolved.resources[0].headers, 'X-CSRF-Token'), false);
  assert.equal(Object.hasOwn(resolved.resources[0].headers, 'x-access-token'), false);
  assert.doesNotMatch(
    JSON.stringify(resolved),
    /synthetic-shared-(lease|request|download|resource)-|authorization|cookie|csrf|token|Bearer/iu,
  );

  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-shared-native-boundary-'));
  try {
    const manifest = await executeResolvedDownloadTask(resolved, plan, sessionLease, {
      workspaceRoot: REPO_ROOT,
      runRoot,
      dryRun: true,
    });
    const persistedManifest = await readJsonFile(manifest.artifacts.manifest);
    const persistedStandardTaskList = await readJsonFile(persistedManifest.artifacts.standardTaskList);
    assert.equal(persistedManifest.session.sessionView.schemaVersion, SESSION_VIEW_SCHEMA_VERSION);
    assert.equal(Object.hasOwn(persistedManifest.session, 'headers'), false);
    assert.equal(Object.hasOwn(persistedManifest.session, 'cookies'), false);
    assert.equal(persistedStandardTaskList.schemaVersion, STANDARD_TASK_LIST_SCHEMA_VERSION);
    assert.doesNotMatch(
      JSON.stringify([persistedManifest, persistedStandardTaskList]),
      /synthetic-shared-(lease|request|download|resource)-|authorization|cookie|csrf|token|Bearer/iu,
    );
  } finally {
    await rm(runRoot, { force: true, recursive: true });
  }
});

test('download low-permission consumers centralize raw lease header decisions', async () => {
  const blockedHeaders = normalizeSessionLeaseConsumerHeaders({
    headers: {
      authorization: 'Bearer synthetic-low-permission-token',
      cookie: 'sid=synthetic-low-permission-cookie',
    },
    sessionView: {
      schemaVersion: SESSION_VIEW_SCHEMA_VERSION,
      siteKey: 'example',
      purpose: 'download',
      status: 'ready',
      permission: ['read'],
      ttlSeconds: 60,
      networkContext: { host: 'example.com' },
    },
  });
  assert.deepEqual(blockedHeaders, {});

  const legacyHeaders = normalizeSessionLeaseConsumerHeaders({
    headers: {
      Accept: 'application/json',
      Range: 'bytes=0-1023',
      Referer: 'https://example.com/source',
      Authorization: 'Bearer synthetic-legacy-allowlist-token',
      Cookie: 'sid=synthetic-legacy-allowlist-cookie',
      'X-CSRF-Token': 'synthetic-legacy-allowlist-csrf',
      'x-access-token': 'synthetic-legacy-allowlist-access-token',
    },
  });
  assert.deepEqual(legacyHeaders, {
    Accept: 'application/json',
    Range: 'bytes=0-1023',
    Referer: 'https://example.com/source',
  });
  assert.equal(JSON.stringify(legacyHeaders).includes('synthetic-legacy-allowlist'), false);

  for (const file of ['executor.mjs', 'registry.mjs']) {
    const source = await readFile(path.join(REPO_ROOT, 'src', 'sites', 'downloads', file), 'utf8');
    assert.match(source, /normalizeSessionLeaseConsumerHeaders/u, `${file} must use the central lease header boundary`);
    assert.doesNotMatch(source, /sessionLease\?\.headers/u, `${file} must not read lease headers directly`);
  }
});

test('download contract boundary omits raw credential and site semantic fields', () => {
  const lease = normalizeSessionLease({
    siteKey: 'example',
    host: 'example.com',
    mode: 'authenticated',
    status: 'ready',
    authStatus: 'authenticated',
    profilePath: 'C:/profiles/example/profile.json',
    browserProfileRoot: 'C:/profiles',
    userDataDir: 'C:/profiles/example',
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer synthetic-contract-boundary-auth',
      Cookie: 'sid=synthetic-contract-boundary-cookie',
      'X-CSRF-Token': 'synthetic-contract-boundary-csrf',
    },
    cookies: [{ name: 'sid', value: 'synthetic-contract-boundary-cookie' }],
    sessionView: {
      schemaVersion: SESSION_VIEW_SCHEMA_VERSION,
      siteKey: 'example',
      purpose: 'download',
      status: 'ready',
      permission: ['read'],
      ttlSeconds: 60,
      networkContext: {
        host: 'example.com',
        authStatus: 'authenticated',
        browserProfileRoot: 'C:/profiles',
        userDataDir: 'C:/profiles/example',
        headers: { authorization: 'Bearer synthetic-contract-boundary-network-auth' },
        cookies: [{ name: 'sid', value: 'synthetic-contract-boundary-network-cookie' }],
        transport: 'https',
      },
    },
  });

  assert.deepEqual(lease.headers, {});
  assert.deepEqual(lease.cookies, []);
  assert.equal(lease.browserProfileRoot, undefined);
  assert.equal(lease.userDataDir, undefined);
  assert.equal(lease.sessionView.networkContext.host, 'example.com');
  assert.equal(lease.sessionView.networkContext.transport, 'https');
  for (const field of ['authStatus', 'browserProfileRoot', 'userDataDir', 'headers', 'cookies']) {
    assert.equal(Object.hasOwn(lease.sessionView.networkContext, field), false);
  }
  assert.doesNotMatch(JSON.stringify(lease.sessionView), /synthetic-contract-boundary-|authStatus|browserProfileRoot|userDataDir/iu);

  const manifest = normalizeDownloadRunManifest({
    runId: 'run-contract-boundary',
    planId: 'plan-contract-boundary',
    siteKey: 'example',
    status: 'skipped',
    reason: 'dry-run',
    dryRun: true,
    session: {
      ...lease,
      headers: { Authorization: 'Bearer synthetic-contract-boundary-manifest-auth' },
      cookies: [{ name: 'sid', value: 'synthetic-contract-boundary-manifest-cookie' }],
      authStatus: 'authenticated',
      browserProfileRoot: 'C:/profiles',
      userDataDir: 'C:/profiles/example',
    },
  });
  assert.equal(Object.hasOwn(manifest.session, 'headers'), false);
  assert.equal(Object.hasOwn(manifest.session, 'cookies'), false);
  assert.equal(Object.hasOwn(manifest.session, 'authStatus'), false);
  assert.equal(Object.hasOwn(manifest.session, 'browserProfileRoot'), false);
  assert.equal(Object.hasOwn(manifest.session, 'userDataDir'), false);
  assert.doesNotMatch(JSON.stringify(manifest.session), /synthetic-contract-boundary-|authStatus|browserProfileRoot|userDataDir/iu);

  const resolved = normalizeResolvedDownloadTask({
    planId: 'plan-contract-boundary',
    siteKey: 'example',
    taskType: 'generic-resource',
    metadata: {
      resolver: 'unit-test',
      authStatus: 'authenticated',
      sessionLease: { headers: { authorization: 'Bearer synthetic-contract-boundary-resolved-auth' } },
      publicScope: 'download',
    },
    groups: [{
      id: 'group-contract-boundary',
      label: 'safe group',
      rawHeaders: { Authorization: 'Bearer synthetic-contract-boundary-group-auth' },
      rawBody: 'csrf=synthetic-contract-boundary-group-csrf',
      siteAdapterState: { cookie: 'sid=synthetic-contract-boundary-group-cookie' },
      siteSemanticState: { authStatus: 'authenticated' },
      nested: {
        publicLabel: 'safe nested group',
        requestBody: 'sessionid=synthetic-contract-boundary-group-session',
      },
    }],
    resources: [{
      id: 'resource-contract-boundary',
      url: 'https://example.com/resource.txt',
      fileName: 'resource.txt',
      mediaType: 'text',
      headers: {
        Accept: 'text/plain',
        Authorization: 'Bearer synthetic-contract-boundary-resource-auth',
        Cookie: 'sid=synthetic-contract-boundary-resource-cookie',
        'X-CSRF-Token': 'synthetic-contract-boundary-resource-csrf',
      },
      metadata: {
        title: 'Safe Resource',
        authStatus: 'authenticated',
        browserProfileRoot: 'C:/profiles',
        diagnostic: 'Bearer synthetic-contract-boundary-resource-token',
        nested: {
          publicLabel: 'safe',
          csrf: 'synthetic-contract-boundary-resource-csrf',
        },
      },
    }, {
      id: 'resource-contract-boundary-post',
      url: 'https://example.com/resource-post.txt',
      method: 'POST',
      body: 'publicField=ok',
      fileName: 'resource-post.txt',
      mediaType: 'text',
    }, {
      id: 'resource-contract-boundary-sensitive-post',
      url: 'https://example.com/resource-sensitive-post.txt',
      method: 'POST',
      body: 'csrf=synthetic-contract-boundary-resource-body-csrf',
      fileName: 'resource-sensitive-post.txt',
      mediaType: 'text',
    }],
  });
  assert.deepEqual(resolved.resources[0].headers, { Accept: 'text/plain' });
  assert.deepEqual(resolved.groups, [{
    id: 'group-contract-boundary',
    label: 'safe group',
    nested: { publicLabel: 'safe nested group' },
  }]);
  assert.equal(resolved.resources[1].body, 'publicField=ok');
  assert.equal(resolved.resources[2].body, undefined);
  assert.deepEqual(resolved.metadata, {
    resolver: 'unit-test',
    publicScope: 'download',
  });
  assert.deepEqual(resolved.resources[0].metadata, {
    title: 'Safe Resource',
    nested: { publicLabel: 'safe' },
  });
  assert.doesNotMatch(
    JSON.stringify(resolved),
    /synthetic-contract-boundary-|authStatus|browserProfileRoot|sessionLease|authorization|cookie|csrf|Bearer/iu,
  );
});

test('download executor normalizes resolved resource headers before fetch', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-resource-header-boundary-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/raw-resource-headers' },
    output: { root: runRoot },
    policy: {
      dryRun: false,
      verify: false,
      retries: 0,
    },
  });
  const fetchCalls = [];

  const manifest = await executeResolvedDownloadTask({
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'resource-header-boundary',
      url: 'https://example.com/resource-header-boundary.txt',
      mediaType: 'text',
      fileName: 'resource-header-boundary.txt',
      headers: {
        Accept: 'text/plain',
        Range: 'bytes=0-10',
        Authorization: 'Bearer synthetic-resource-header-token',
        Cookie: 'sid=synthetic-resource-header-cookie',
        'X-CSRF-Token': 'synthetic-resource-header-csrf',
        'x-access-token': 'synthetic-resource-header-access-token',
      },
    }],
  }, plan, null, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    dryRun: false,
    verify: false,
  }, {
    fetchImpl: async (url, init = {}) => {
      fetchCalls.push({ url, headers: init.headers });
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return Buffer.from('synthetic download body', 'utf8');
        },
      };
    },
  });

  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(fetchCalls[0].headers, {
    Accept: 'text/plain',
    Range: 'bytes=0-10',
  });
  assert.doesNotMatch(
    JSON.stringify(fetchCalls),
    /synthetic-resource-header-|authorization|cookie|csrf|token|Bearer/iu,
  );

  const persistedManifest = await readJsonFile(manifest.artifacts.manifest);
  const persistedStandardTaskList = await readJsonFile(persistedManifest.artifacts.standardTaskList);
  const persistedDownloadsJsonl = await readFile(persistedManifest.artifacts.downloadsJsonl, 'utf8');
  assert.equal(persistedStandardTaskList.schemaVersion, STANDARD_TASK_LIST_SCHEMA_VERSION);
  assert.doesNotMatch(
    JSON.stringify([persistedManifest, persistedStandardTaskList, persistedDownloadsJsonl]),
    /synthetic-resource-header-|authorization|cookie|csrf|token|Bearer/iu,
  );
});

test('download executor result lifecycle subscriber failure fails closed before manifest write', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-executor-result-lifecycle-failure-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const runId = 'executor-result-lifecycle-failure';
  const payload = Buffer.from('download body', 'utf8');

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/result-fail-closed' },
    output: { root: runRoot },
  });

  await assert.rejects(
    () => executeResolvedDownloadTask({
      planId: plan.id,
      siteKey: plan.siteKey,
      taskType: plan.taskType,
      resources: [{
        id: 'resource-1',
        url: 'https://example.com/result-fail-closed.txt',
        fileName: 'result-fail-closed.txt',
        mediaType: 'text',
        expectedBytes: payload.length,
      }],
    }, plan, {
      siteKey: 'example',
      host: 'example.com',
      status: 'ready',
      mode: 'anonymous',
    }, {
      workspaceRoot: REPO_ROOT,
      runRoot,
      runId,
      dryRun: false,
    }, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      }),
      lifecycleEventSubscribers: [
        async () => {
          throw new Error('synthetic-executor-result-lifecycle-failure');
        },
      ],
    }),
    /synthetic-executor-result-lifecycle-failure/u,
  );
  await assert.rejects(
    () => readFile(path.join(runRoot, runId, 'manifest.json'), 'utf8'),
    /ENOENT/u,
  );
  await assert.rejects(
    () => readFile(path.join(runRoot, runId, 'lifecycle-event.json'), 'utf8'),
    /ENOENT/u,
  );
  await assert.rejects(
    () => readFile(path.join(runRoot, runId, 'lifecycle-event-redaction-audit.json'), 'utf8'),
    /ENOENT/u,
  );
});

test('download executor muxes completed audio and video resources as a derived artifact', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-executor-mux-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    taskType: 'video',
    source: { input: 'https://www.bilibili.com/video/BV1muxFixture/' },
    policy: { dryRun: false, concurrency: 2, retries: 0, retryBackoffMs: 0 },
    output: { root: runRoot },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: 'bilibili',
    taskType: 'video',
    resources: [{
      id: 'dash-video',
      url: 'https://upos.example.test/mux/video.m4s',
      fileName: 'dash-video.m4s',
      mediaType: 'video',
      groupId: 'bilibili:BV1muxFixture:p1',
      metadata: {
        muxRole: 'video',
        muxKind: 'dash-audio-video',
      },
    }, {
      id: 'dash-audio',
      url: 'https://upos.example.test/mux/audio.m4s',
      fileName: 'dash-audio.m4s',
      mediaType: 'audio',
      groupId: 'bilibili:BV1muxFixture:p1',
      metadata: {
        muxRole: 'audio',
        muxKind: 'dash-audio-video',
      },
    }],
  };
  const fetchUrls = [];
  const muxCalls = [];
  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    runRoot,
    dryRun: false,
  }, {
    fetchImpl: async (url) => {
      fetchUrls.push(String(url));
      const payload = Buffer.from(String(url).includes('video') ? 'video stream' : 'audio stream', 'utf8');
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      };
    },
    muxMediaPair: async ({ videoFile, audioFile, outputFile, groupId }) => {
      muxCalls.push({ videoFile, audioFile, outputFile, groupId });
      const video = await readFile(videoFile, 'utf8');
      const audio = await readFile(audioFile, 'utf8');
      await writeFile(outputFile, `${video}+${audio}`, 'utf8');
      return { ok: true };
    },
  });

  assert.deepEqual(fetchUrls.sort(), [
    'https://upos.example.test/mux/audio.m4s',
    'https://upos.example.test/mux/video.m4s',
  ]);
  assert.equal(muxCalls.length, 1);
  assert.equal(muxCalls[0].groupId, 'bilibili:BV1muxFixture:p1');
  assert.equal(manifest.counts.expected, 2);
  assert.equal(manifest.counts.downloaded, 2);
  assert.equal(manifest.counts.failed, 0);
  assert.equal(manifest.files.length, 3);
  const muxFile = manifest.files.find((entry) => entry.derived === true);
  assert.equal(Boolean(muxFile), true);
  assert.equal(muxFile.resourceId, 'mux:bilibili:BV1muxFixture:p1');
  assert.equal(muxFile.groupId, 'bilibili:BV1muxFixture:p1');
  assert.equal(await readFile(muxFile.filePath, 'utf8'), 'video stream+audio stream');

  const artifacts = await assertDownloadRunArtifactBundle(manifest);
  assert.equal(artifacts.queue.length, 2);
  assert.equal(artifacts.downloads.length, 3);
  assert.equal(artifacts.downloads[2].derived, true);
});

test('download executor default ffmpeg muxer accepts derived file arguments', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-executor-ffmpeg-mux-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    taskType: 'video',
    source: { input: 'https://www.bilibili.com/video/BV1muxFfmpeg/' },
    policy: { dryRun: false, concurrency: 2, retries: 0, retryBackoffMs: 0 },
    output: { root: runRoot },
  });
  const spawnCalls = [];
  const manifest = await executeResolvedDownloadTask({
    planId: plan.id,
    siteKey: 'bilibili',
    taskType: 'video',
    resources: [{
      id: 'dash-video',
      url: 'https://upos.example.test/mux/video.m4s',
      fileName: 'dash-video.m4s',
      mediaType: 'video',
      groupId: 'bilibili:BV1muxFfmpeg:p1',
      metadata: {
        muxRole: 'video',
        muxKind: 'dash-audio-video',
      },
    }, {
      id: 'dash-audio',
      url: 'https://upos.example.test/mux/audio.m4s',
      fileName: 'dash-audio.m4s',
      mediaType: 'audio',
      groupId: 'bilibili:BV1muxFfmpeg:p1',
      metadata: {
        muxRole: 'audio',
        muxKind: 'dash-audio-video',
      },
    }],
  }, plan, null, {
    runRoot,
    dryRun: false,
    enableDerivedMux: true,
  }, {
    fetchImpl: async (url) => {
      const payload = Buffer.from(String(url).includes('video') ? 'video stream' : 'audio stream', 'utf8');
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      };
    },
    spawnProcess: async (command, args) => {
      spawnCalls.push({ command, args });
      await writeFile(args.at(-1), 'muxed stream', 'utf8');
      return { code: 0, stderr: '' };
    },
  });

  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, 'ffmpeg');
  assert.equal(spawnCalls[0].args.includes('-i'), true);
  const muxFile = manifest.files.find((entry) => entry.derived === true);
  assert.equal(Boolean(muxFile), true);
  assert.equal(await readFile(muxFile.filePath, 'utf8'), 'muxed stream');
  const artifacts = await assertDownloadRunArtifactBundle(manifest);
  assert.equal(artifacts.downloads.at(-1).reason, 'dash-mux');
  assert.equal(manifest.status, 'passed');
});

test('download executor reports incomplete mux groups as derived failures', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-executor-mux-missing-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    taskType: 'video',
    source: { input: 'https://www.bilibili.com/video/BV1muxMissing/' },
    policy: { dryRun: false, concurrency: 1, retries: 0, retryBackoffMs: 0 },
    output: { root: runRoot },
  });
  const manifest = await executeResolvedDownloadTask({
    planId: plan.id,
    siteKey: 'bilibili',
    taskType: 'video',
    resources: [{
      id: 'dash-video-only',
      url: 'https://upos.example.test/mux/video-only.m4s',
      fileName: 'dash-video-only.m4s',
      mediaType: 'video',
      groupId: 'bilibili:BV1muxMissing:p1',
      metadata: {
        muxRole: 'video',
        muxKind: 'dash-audio-video',
      },
    }],
  }, plan, null, {
    runRoot,
    dryRun: false,
    enableDerivedMux: true,
  }, {
    fetchImpl: async () => ({
      ok: true,
      async arrayBuffer() {
        return Buffer.from('video stream').buffer;
      },
    }),
  });

  assert.equal(manifest.status, 'partial');
  assert.equal(manifest.counts.downloaded, 1);
  assert.equal(manifest.counts.failed, 1);
  assert.equal(manifest.failedResources[0].resourceId, 'mux:bilibili:BV1muxMissing:p1');
  assert.equal(manifest.failedResources[0].reason, 'mux-missing-audio');
  assert.equal(manifest.failedResources[0].derived, true);
  const report = await readFile(manifest.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /Derived Mux Diagnostics/u);
  assert.match(report, /mux-missing-audio/u);
});

test('download executor treats retries zero as a single attempt', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-retries-zero-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/fails.txt' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { root: runRoot },
  });
  let calls = 0;
  const manifest = await executeResolvedDownloadTask({
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'resource-1',
      url: 'https://example.com/fails.txt',
      fileName: 'fails.txt',
      mediaType: 'text',
    }],
  }, plan, null, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    dryRun: false,
  }, {
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: false,
        status: 500,
      };
    },
  });

  assert.equal(calls, 1);
  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'download-failures');
  assert.deepEqual(manifest.reasonRecovery, reasonCodeSummary('download-failures'));
  assert.equal(manifest.failedResources[0].reason, 'http-500');
  const http500Recovery = reasonCodeSummary('http-500');
  assert.equal(http500Recovery.retryable, true);
  assert.equal(http500Recovery.artifactWriteAllowed, true);
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, reasonCodeSummary('download-failures'));
  const report = await readFile(manifest.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /download-failures/u);
  assert.match(report, /resource-1: http-500/u);
  assert.match(report, /Reason retryable: true/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.equal(manifest.resumeCommand.includes('--resume'), true);
  assert.doesNotThrow(() => parseArgs([
    '--site',
    manifest.siteKey,
    '--input',
    plan.source.input,
    '--execute',
    '--run-dir',
    path.dirname(manifest.artifacts.manifest),
    '--resume',
  ]));
});

test('download executor reports thrown fetch errors with taxonomy semantics', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-fetch-error-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/fetch-error.txt' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { root: runRoot },
  });
  let calls = 0;
  const manifest = await executeResolvedDownloadTask({
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'fetch-error-resource',
      url: 'https://example.com/fetch-error.txt',
      fileName: 'fetch-error.txt',
      mediaType: 'text',
    }],
  }, plan, null, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    dryRun: false,
  }, {
    fetchImpl: async () => {
      calls += 1;
      throw new Error('synthetic fetch transport failure');
    },
  });

  assert.equal(calls, 1);
  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'download-failures');
  assert.deepEqual(manifest.reasonRecovery, reasonCodeSummary('download-failures'));
  assert.equal(manifest.failedResources.length, 1);
  assert.equal(manifest.failedResources[0].reason, 'fetch-error');
  assert.match(manifest.failedResources[0].error, /synthetic fetch transport failure/u);
  const fetchErrorRecovery = reasonCodeSummary('fetch-error');
  assert.equal(fetchErrorRecovery.retryable, true);
  assert.equal(fetchErrorRecovery.artifactWriteAllowed, true);
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, reasonCodeSummary('download-failures'));
  assert.equal(persisted.failedResources[0].reason, 'fetch-error');
  const report = await readFile(manifest.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /download-failures/u);
  assert.match(report, /fetch-error-resource: fetch-error/u);
  assert.match(report, /Reason retryable: true/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  const lifecycleEvent = await readJsonFile(persisted.artifacts.lifecycleEvent);
  assert.equal(lifecycleEvent.eventType, 'download.executor.completed');
  assert.equal(lifecycleEvent.reasonCode, 'download-failures');
  assert.deepEqual(lifecycleEvent.details.reasonRecovery, reasonCodeSummary('download-failures'));
  assert.deepEqual(lifecycleEvent.details.failedResourceReasonCounts, { 'fetch-error': 1 });
  assert.equal(JSON.stringify(lifecycleEvent).includes('synthetic fetch transport failure'), false);
});

test('download executor retries failed resources when configured', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-retries-one-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/retry.txt' },
    policy: { dryRun: false, retries: 1, retryBackoffMs: 0 },
    output: { root: runRoot },
  });
  const payload = Buffer.from('retry body', 'utf8');
  let calls = 0;
  const manifest = await executeResolvedDownloadTask({
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'resource-1',
      url: 'https://example.com/retry.txt',
      fileName: 'retry.txt',
      mediaType: 'text',
    }],
  }, plan, null, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    dryRun: false,
  }, {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 500,
        };
      }
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      };
    },
  });

  assert.equal(calls, 2);
  assert.equal(manifest.status, 'passed');
  assert.equal(await readFile(manifest.files[0].filePath, 'utf8'), 'retry body');
});

test('download executor resumes fixed run directories and retries incomplete resources', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-resume-run-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/resume' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [
      {
        id: 'done',
        url: 'https://example.com/done.txt',
        fileName: 'done.txt',
        mediaType: 'text',
      },
      {
        id: 'failed',
        url: 'https://example.com/failed.txt',
        fileName: 'failed.txt',
        mediaType: 'text',
      },
    ],
  };

  let firstRunCalls = 0;
  const firstManifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
  }, {
    fetchImpl: async (url) => {
      firstRunCalls += 1;
      if (String(url).includes('failed')) {
        return { ok: false, status: 500 };
      }
      const payload = Buffer.from('already downloaded', 'utf8');
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      };
    },
  });
  assert.equal(firstRunCalls, 2);
  assert.equal(firstManifest.status, 'partial');

  const secondRunUrls = [];
  const secondManifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    resume: true,
  }, {
    fetchImpl: async (url) => {
      secondRunUrls.push(String(url));
      if (String(url).includes('done')) {
        throw new Error('completed resource should be skipped during resume');
      }
      const payload = Buffer.from('retried body', 'utf8');
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      };
    },
  });

  assert.deepEqual(secondRunUrls, ['https://example.com/failed.txt']);
  assert.equal(secondManifest.status, 'passed');
  assert.equal(secondManifest.counts.downloaded, 1);
  assert.equal(secondManifest.counts.skipped, 1);
  assert.equal(secondManifest.files.find((entry) => entry.resourceId === 'done').skipped, true);
  assert.equal(await readFile(secondManifest.files.find((entry) => entry.resourceId === 'failed').filePath, 'utf8'), 'retried body');
});

test('download executor reports manifest queue mismatch as a stable recovery reason', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-recovery-mismatch-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/recovery-mismatch' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [
      {
        id: 'one',
        url: 'https://example.com/one.txt',
        fileName: 'one.txt',
        mediaType: 'text',
      },
      {
        id: 'two',
        url: 'https://example.com/two.txt',
        fileName: 'two.txt',
        mediaType: 'text',
      },
    ],
  };

  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'partial',
    counts: {
      expected: 2,
      attempted: 1,
      downloaded: 0,
      skipped: 0,
      failed: 1,
    },
    files: [],
    failedResources: [],
  });
  await writeJsonFile(path.join(runDir, 'queue.json'), [{
    id: 'one',
    status: 'failed',
    url: 'https://example.com/one.txt',
    filePath: path.join(runDir, 'files', '0001-one.txt'),
  }]);
  await writeFile(path.join(runDir, 'downloads.jsonl'), '', 'utf8');

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('recovery mismatch should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'manifest-queue-count-mismatch');
  assert.equal(requireReasonCodeDefinition(manifest.reason, { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(requireReasonCodeDefinition(manifest.reason, { family: 'download' }).retryable, false);
  const expectedMismatchRecovery = reasonCodeSummary('manifest-queue-count-mismatch');
  assert.deepEqual(manifest.reasonRecovery, expectedMismatchRecovery);
  const persistedManifest = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persistedManifest.reasonRecovery, expectedMismatchRecovery);
  assert.equal(manifest.counts.failed, 2);
  assert.equal(manifest.failedResources[0].reason, 'manifest-queue-count-mismatch');
  const report = await readFile(manifest.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /manifest-queue-count-mismatch/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports manifest queue resource mismatch with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-resource-mismatch-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/recovery-resource-mismatch' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'one',
      url: 'https://example.com/one.txt',
      fileName: 'one.txt',
      mediaType: 'text',
    }],
  };

  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-resource-mismatch-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'partial',
    counts: {
      expected: 1,
      attempted: 1,
      downloaded: 1,
      skipped: 0,
      failed: 0,
    },
    files: [{
      id: 'ghost',
      resourceId: 'ghost',
      url: 'https://example.com/ghost.txt',
      filePath: path.join(runDir, 'files', 'ghost.txt'),
    }],
    failedResources: [],
  });
  await writeJsonFile(path.join(runDir, 'queue.json'), [{
    id: 'one',
    status: 'failed',
    url: 'https://example.com/one.txt',
    filePath: path.join(runDir, 'files', '0001-one.txt'),
  }]);
  await writeFile(path.join(runDir, 'downloads.jsonl'), '', 'utf8');

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('recovery resource mismatch should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'manifest-queue-resource-mismatch');
  const expectedRecovery = reasonCodeSummary('manifest-queue-resource-mismatch');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'manifest-queue-resource-mismatch');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /manifest-queue-resource-mismatch/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports queue downloads resource mismatch with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-downloads-resource-mismatch-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/downloads-resource-mismatch' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'one',
      url: 'https://example.com/one.txt',
      fileName: 'one.txt',
      mediaType: 'text',
    }],
  };

  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-downloads-resource-mismatch-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'partial',
    counts: {
      expected: 1,
      attempted: 1,
      downloaded: 0,
      skipped: 0,
      failed: 1,
    },
    files: [],
    failedResources: [],
  });
  await writeJsonFile(path.join(runDir, 'queue.json'), [{
    id: 'one',
    status: 'failed',
    url: 'https://example.com/one.txt',
    filePath: path.join(runDir, 'files', '0001-one.txt'),
  }]);
  await writeFile(path.join(runDir, 'downloads.jsonl'), `${JSON.stringify({
    id: 'ghost',
    resourceId: 'ghost',
    status: 'completed',
    url: 'https://example.com/ghost.txt',
  })}\n`, 'utf8');

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('downloads resource mismatch should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'queue-downloads-resource-mismatch');
  const expectedRecovery = reasonCodeSummary('queue-downloads-resource-mismatch');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'queue-downloads-resource-mismatch');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /queue-downloads-resource-mismatch/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor retry-failed without failed queue entries skips and reuses successes', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-retry-none-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const filesDir = path.join(runDir, 'files');
  await mkdir(filesDir, { recursive: true });
  const filePath = path.join(filesDir, '0001-done.txt');
  await writeFile(filePath, 'already done', 'utf8');

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/retry-none' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'done',
      url: 'https://example.com/done.txt',
      fileName: 'done.txt',
      mediaType: 'text',
    }],
  };
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'passed',
    counts: {
      expected: 1,
      attempted: 1,
      downloaded: 1,
      skipped: 0,
      failed: 0,
    },
    files: [{
      resourceId: 'done',
      url: 'https://example.com/done.txt',
      filePath,
      bytes: 'already done'.length,
      mediaType: 'text',
      skipped: false,
    }],
    failedResources: [],
  });
  await writeJsonFile(path.join(runDir, 'queue.json'), [{
    id: 'done',
    status: 'downloaded',
    url: 'https://example.com/done.txt',
    filePath,
    bytes: 'already done'.length,
    mediaType: 'text',
  }]);
  await writeFile(path.join(runDir, 'downloads.jsonl'), `${JSON.stringify({
    ok: true,
    resourceId: 'done',
    url: 'https://example.com/done.txt',
    filePath,
    bytes: 'already done'.length,
    mediaType: 'text',
  })}\n`, 'utf8');

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with no failures should not fetch');
    },
  });

  assert.equal(manifest.status, 'skipped');
  assert.equal(manifest.reason, 'retry-failed-none');
  const retryNoneReason = requireReasonCodeDefinition(manifest.reason, { family: 'download' });
  assert.equal(retryNoneReason.retryable, false);
  assert.equal(retryNoneReason.degradable, true);
  assert.equal(retryNoneReason.artifactWriteAllowed, true);
  const expectedRetryNoneRecovery = reasonCodeSummary('retry-failed-none');
  assert.deepEqual(manifest.reasonRecovery, expectedRetryNoneRecovery);
  const persistedManifest = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persistedManifest.reasonRecovery, expectedRetryNoneRecovery);
  const report = await readFile(manifest.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: false/u);
  assert.match(report, /Reason degradable: true/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
  assert.equal(manifest.counts.skipped, 1);
  assert.equal(manifest.files.length, 1);
  assert.equal(manifest.files[0].resourceId, 'done');
  assert.equal(manifest.files[0].skipped, true);
});

test('download executor reports missing recovered artifact with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-recovery-artifact-missing-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const missingFilePath = path.join(runDir, 'files', 'missing-done.txt');
  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/recovery-artifact-missing' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'done',
      url: 'https://example.com/done.txt',
      fileName: 'done.txt',
      mediaType: 'text',
    }],
  };
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-missing-artifact-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'passed',
    counts: {
      expected: 1,
      attempted: 1,
      downloaded: 1,
      skipped: 0,
      failed: 0,
    },
    files: [{
      resourceId: 'done',
      url: 'https://example.com/done.txt',
      filePath: missingFilePath,
      bytes: 0,
      mediaType: 'text',
      skipped: false,
    }],
    failedResources: [],
  });
  await writeJsonFile(path.join(runDir, 'queue.json'), [{
    id: 'done',
    status: 'downloaded',
    url: 'https://example.com/done.txt',
    filePath: missingFilePath,
    bytes: 0,
    mediaType: 'text',
  }]);
  await writeFile(path.join(runDir, 'downloads.jsonl'), `${JSON.stringify({
    ok: true,
    resourceId: 'done',
    url: 'https://example.com/done.txt',
    filePath: missingFilePath,
    bytes: 0,
    mediaType: 'text',
  })}\n`, 'utf8');

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with missing recovered artifact should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'recovery-artifact-missing');
  const expectedRecovery = reasonCodeSummary('recovery-artifact-missing');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'recovery-artifact-missing');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /recovery-artifact-missing/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports non-file recovered artifact with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-recovery-artifact-not-file-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const directoryArtifactPath = path.join(runDir, 'files', 'directory-artifact');
  await mkdir(directoryArtifactPath, { recursive: true });
  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/recovery-artifact-not-file' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'done',
      url: 'https://example.com/done.txt',
      fileName: 'done.txt',
      mediaType: 'text',
    }],
  };
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-not-file-artifact-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'passed',
    counts: {
      expected: 1,
      attempted: 1,
      downloaded: 1,
      skipped: 0,
      failed: 0,
    },
    files: [{
      resourceId: 'done',
      url: 'https://example.com/done.txt',
      filePath: directoryArtifactPath,
      bytes: 0,
      mediaType: 'text',
      skipped: false,
    }],
    failedResources: [],
  });
  await writeJsonFile(path.join(runDir, 'queue.json'), [{
    id: 'done',
    status: 'downloaded',
    url: 'https://example.com/done.txt',
    filePath: directoryArtifactPath,
    bytes: 0,
    mediaType: 'text',
  }]);
  await writeFile(path.join(runDir, 'downloads.jsonl'), `${JSON.stringify({
    ok: true,
    resourceId: 'done',
    url: 'https://example.com/done.txt',
    filePath: directoryArtifactPath,
    bytes: 0,
    mediaType: 'text',
  })}\n`, 'utf8');

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with non-file recovered artifact should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'recovery-artifact-not-file');
  const expectedRecovery = reasonCodeSummary('recovery-artifact-not-file');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'recovery-artifact-not-file');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /recovery-artifact-not-file/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports recovered artifact size mismatch with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-recovery-artifact-size-mismatch-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const filesDir = path.join(runDir, 'files');
  await mkdir(filesDir, { recursive: true });
  const filePath = path.join(filesDir, 'size-mismatch.txt');
  await writeFile(filePath, 'abc', 'utf8');
  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/recovery-artifact-size-mismatch' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'done',
      url: 'https://example.com/done.txt',
      fileName: 'done.txt',
      mediaType: 'text',
    }],
  };
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-size-mismatch-artifact-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'passed',
    counts: {
      expected: 1,
      attempted: 1,
      downloaded: 1,
      skipped: 0,
      failed: 0,
    },
    files: [{
      resourceId: 'done',
      url: 'https://example.com/done.txt',
      filePath,
      bytes: 99,
      mediaType: 'text',
      skipped: false,
    }],
    failedResources: [],
  });
  await writeJsonFile(path.join(runDir, 'queue.json'), [{
    id: 'done',
    status: 'downloaded',
    url: 'https://example.com/done.txt',
    filePath,
    bytes: 99,
    mediaType: 'text',
  }]);
  await writeFile(path.join(runDir, 'downloads.jsonl'), `${JSON.stringify({
    ok: true,
    resourceId: 'done',
    url: 'https://example.com/done.txt',
    filePath,
    bytes: 99,
    mediaType: 'text',
  })}\n`, 'utf8');

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with size-mismatched recovered artifact should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'recovery-artifact-size-mismatch');
  const expectedRecovery = reasonCodeSummary('recovery-artifact-size-mismatch');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'recovery-artifact-size-mismatch');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /recovery-artifact-size-mismatch/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports retry-failed non-failed skips with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-retry-failed-not-failed-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/retry-failed-not-failed' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'pending',
      url: 'https://example.com/pending.txt',
      fileName: 'pending.txt',
      mediaType: 'text',
    }],
  };
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-retry-not-failed-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'partial',
    counts: {
      expected: 2,
      attempted: 2,
      downloaded: 0,
      skipped: 0,
      failed: 1,
    },
    files: [],
    failedResources: [],
  });
  await writeJsonFile(path.join(runDir, 'queue.json'), [
    {
      id: 'pending',
      status: 'pending',
      url: 'https://example.com/pending.txt',
      filePath: path.join(runDir, 'files', 'pending.txt'),
    },
    {
      id: 'failed-extra',
      status: 'failed',
      url: 'https://example.com/failed-extra.txt',
      filePath: path.join(runDir, 'files', 'failed-extra.txt'),
    },
  ]);
  await writeFile(path.join(runDir, 'downloads.jsonl'), '', 'utf8');

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed non-failed resource should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'skipped');
  assert.equal(manifest.reason, 'retry-failed-not-failed');
  const expectedRecovery = reasonCodeSummary('retry-failed-not-failed');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.deepEqual(manifest.failedResources, []);
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /retry-failed-not-failed/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: false/u);
  assert.match(report, /Reason degradable: true/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports missing retry queue with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-retry-queue-missing-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/retry-queue-missing' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'missing-queue-resource',
      url: 'https://example.com/missing-queue.txt',
      fileName: 'missing-queue.txt',
      mediaType: 'text',
    }],
  };
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'partial',
    counts: {
      expected: 0,
      attempted: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
    },
    files: [],
    failedResources: [],
  });

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with missing queue should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'retry-queue-missing');
  const expectedRecovery = reasonCodeSummary('retry-queue-missing');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'retry-queue-missing');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /retry-queue-missing/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports invalid retry queue JSON with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-queue-invalid-json-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/queue-invalid-json' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'invalid-queue-json-resource',
      url: 'https://example.com/invalid-queue-json.txt',
      fileName: 'invalid-queue-json.txt',
      mediaType: 'text',
    }],
  };
  await writeFile(path.join(runDir, 'queue.json'), '{"queue": ');

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with invalid queue JSON should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'queue-invalid-json');
  const expectedRecovery = reasonCodeSummary('queue-invalid-json');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'queue-invalid-json');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /queue-invalid-json/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports invalid media queue JSON with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-media-queue-invalid-json-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/media-queue-invalid-json' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'invalid-media-queue-json-resource',
      url: 'https://example.com/invalid-media-queue-json.txt',
      fileName: 'invalid-media-queue-json.txt',
      mediaType: 'text',
    }],
  };
  await writeFile(path.join(runDir, 'media-queue.json'), '{"queue": ');

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with invalid media queue JSON should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'media-queue-invalid-json');
  const expectedRecovery = reasonCodeSummary('media-queue-invalid-json');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'media-queue-invalid-json');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /media-queue-invalid-json/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports invalid retry queue shape with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-queue-invalid-shape-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/queue-invalid-shape' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'invalid-queue-resource',
      url: 'https://example.com/invalid-queue.txt',
      fileName: 'invalid-queue.txt',
      mediaType: 'text',
    }],
  };
  await writeJsonFile(path.join(runDir, 'queue.json'), { queue: 'not-an-array' });

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with invalid queue shape should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'queue-invalid-shape');
  const expectedRecovery = reasonCodeSummary('queue-invalid-shape');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'queue-invalid-shape');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /queue-invalid-shape/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports invalid media queue shape with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-media-queue-invalid-shape-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/media-queue-invalid-shape' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'invalid-media-queue-resource',
      url: 'https://example.com/invalid-media-queue.txt',
      fileName: 'invalid-media-queue.txt',
      mediaType: 'text',
    }],
  };
  await writeJsonFile(path.join(runDir, 'media-queue.json'), { queue: 'not-an-array' });

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with invalid media queue shape should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'media-queue-invalid-shape');
  const expectedRecovery = reasonCodeSummary('media-queue-invalid-shape');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'media-queue-invalid-shape');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /media-queue-invalid-shape/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports invalid source queue shape with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-source-queue-invalid-shape-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const sourceRunDir = path.join(runDir, 'source-action-run');
  await mkdir(sourceRunDir, { recursive: true });
  const sourceQueuePath = path.join(sourceRunDir, 'queue.json');
  await writeJsonFile(sourceQueuePath, { queue: 'not-an-array' });

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/source-queue-invalid-shape' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'invalid-source-queue-resource',
      url: 'https://example.com/invalid-source-queue.txt',
      fileName: 'invalid-source-queue.txt',
      mediaType: 'text',
    }],
  };
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-source-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'partial',
    counts: {
      expected: 0,
      attempted: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
    },
    files: [],
    failedResources: [],
    artifacts: {
      source: {
        queue: sourceQueuePath,
      },
    },
  });

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with invalid source queue shape should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'source-queue-invalid-shape');
  const expectedRecovery = reasonCodeSummary('source-queue-invalid-shape');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'source-queue-invalid-shape');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /source-queue-invalid-shape/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports invalid source queue JSON with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-source-queue-invalid-json-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const sourceRunDir = path.join(runDir, 'source-action-run');
  await mkdir(sourceRunDir, { recursive: true });
  const sourceQueuePath = path.join(sourceRunDir, 'queue.json');
  await writeFile(sourceQueuePath, '{"queue": ');

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/source-queue-invalid-json' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'invalid-source-queue-json-resource',
      url: 'https://example.com/invalid-source-queue-json.txt',
      fileName: 'invalid-source-queue-json.txt',
      mediaType: 'text',
    }],
  };
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-source-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'partial',
    counts: {
      expected: 0,
      attempted: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
    },
    files: [],
    failedResources: [],
    artifacts: {
      source: {
        queue: sourceQueuePath,
      },
    },
  });

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with invalid source queue JSON should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'source-queue-invalid-json');
  const expectedRecovery = reasonCodeSummary('source-queue-invalid-json');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'source-queue-invalid-json');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /source-queue-invalid-json/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports missing source queue with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-source-queue-missing-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const sourceRunDir = path.join(runDir, 'source-action-run');
  const missingSourceQueuePath = path.join(sourceRunDir, 'queue.json');

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/source-queue-missing' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'missing-source-queue-resource',
      url: 'https://example.com/missing-source-queue.txt',
      fileName: 'missing-source-queue.txt',
      mediaType: 'text',
    }],
  };
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-source-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'partial',
    counts: {
      expected: 0,
      attempted: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
    },
    files: [],
    failedResources: [],
    artifacts: {
      source: {
        queue: missingSourceQueuePath,
      },
    },
  });

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with missing source queue should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'source-queue-missing');
  const expectedRecovery = reasonCodeSummary('source-queue-missing');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'source-queue-missing');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /source-queue-missing/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports invalid manifest JSON with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-manifest-invalid-json-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/manifest-invalid-json' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'invalid-manifest-resource',
      url: 'https://example.com/invalid-manifest.txt',
      fileName: 'invalid-manifest.txt',
      mediaType: 'text',
    }],
  };
  await writeFile(path.join(runDir, 'manifest.json'), '{"status": ');

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with invalid manifest JSON should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'manifest-invalid-json');
  const expectedRecovery = reasonCodeSummary('manifest-invalid-json');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'manifest-invalid-json');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /manifest-invalid-json/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports invalid media manifest JSON with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-media-manifest-invalid-json-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/media-manifest-invalid-json' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'invalid-media-manifest-resource',
      url: 'https://example.com/invalid-media-manifest.txt',
      fileName: 'invalid-media-manifest.txt',
      mediaType: 'text',
    }],
  };
  await writeFile(path.join(runDir, 'media-manifest.json'), '{"entries": ');

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with invalid media manifest JSON should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'media-manifest-invalid-json');
  const expectedRecovery = reasonCodeSummary('media-manifest-invalid-json');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'media-manifest-invalid-json');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /media-manifest-invalid-json/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports invalid downloads JSONL with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-downloads-invalid-jsonl-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/downloads-invalid-jsonl' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'invalid-downloads-jsonl-resource',
      url: 'https://example.com/invalid-downloads-jsonl.txt',
      fileName: 'invalid-downloads-jsonl.txt',
      mediaType: 'text',
    }],
  };
  await writeFile(path.join(runDir, 'downloads.jsonl'), '{"status":"ok"}\n{"status": ');

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with invalid downloads JSONL should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'downloads-invalid-jsonl');
  const expectedRecovery = reasonCodeSummary('downloads-invalid-jsonl');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'downloads-invalid-jsonl');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /downloads-invalid-jsonl/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports unreadable downloads JSONL with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-downloads-read-failed-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/downloads-read-failed' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'unreadable-downloads-jsonl-resource',
      url: 'https://example.com/unreadable-downloads-jsonl.txt',
      fileName: 'unreadable-downloads-jsonl.txt',
      mediaType: 'text',
    }],
  };
  await mkdir(path.join(runDir, 'downloads.jsonl'));

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with unreadable downloads JSONL should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'downloads-read-failed');
  const expectedRecovery = reasonCodeSummary('downloads-read-failed');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'downloads-read-failed');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  assert.equal(path.basename(persisted.artifacts.downloadsJsonl), 'downloads.recovery.jsonl');
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /downloads-read-failed/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports invalid source downloads JSONL with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-source-downloads-invalid-jsonl-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const sourceRunDir = path.join(runDir, 'source-action-run');
  await mkdir(sourceRunDir, { recursive: true });
  const sourceDownloadsPath = path.join(sourceRunDir, 'downloads.jsonl');
  await writeFile(sourceDownloadsPath, '{"status":"ok"}\n{"status": ');

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/source-downloads-invalid-jsonl' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'invalid-source-downloads-jsonl-resource',
      url: 'https://example.com/invalid-source-downloads-jsonl.txt',
      fileName: 'invalid-source-downloads-jsonl.txt',
      mediaType: 'text',
    }],
  };
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-source-downloads-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'partial',
    counts: {
      expected: 0,
      attempted: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
    },
    files: [],
    failedResources: [],
    artifacts: {
      source: {
        downloadsJsonl: sourceDownloadsPath,
      },
    },
  });

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with invalid source downloads JSONL should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'source-downloads-invalid-jsonl');
  const expectedRecovery = reasonCodeSummary('source-downloads-invalid-jsonl');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'source-downloads-invalid-jsonl');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /source-downloads-invalid-jsonl/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports unreadable source downloads JSONL with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-source-downloads-read-failed-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const sourceRunDir = path.join(runDir, 'source-action-run');
  await mkdir(sourceRunDir, { recursive: true });
  const sourceDownloadsPath = path.join(sourceRunDir, 'downloads.jsonl');
  await mkdir(sourceDownloadsPath);

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/source-downloads-read-failed' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'unreadable-source-downloads-jsonl-resource',
      url: 'https://example.com/unreadable-source-downloads-jsonl.txt',
      fileName: 'unreadable-source-downloads-jsonl.txt',
      mediaType: 'text',
    }],
  };
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-source-downloads-read-failed-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'partial',
    counts: {
      expected: 0,
      attempted: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
    },
    files: [],
    failedResources: [],
    artifacts: {
      source: {
        downloadsJsonl: sourceDownloadsPath,
      },
    },
  });

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with unreadable source downloads JSONL should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'source-downloads-read-failed');
  const expectedRecovery = reasonCodeSummary('source-downloads-read-failed');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'source-downloads-read-failed');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /source-downloads-read-failed/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports missing source manifest with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-source-manifest-missing-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const sourceRunDir = path.join(runDir, 'source-action-run');
  const missingSourceManifestPath = path.join(sourceRunDir, 'manifest.json');

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/source-manifest-missing' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'missing-source-manifest-resource',
      url: 'https://example.com/missing-source-manifest.txt',
      fileName: 'missing-source-manifest.txt',
      mediaType: 'text',
    }],
  };
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-source-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'partial',
    counts: {
      expected: 0,
      attempted: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
    },
    files: [],
    failedResources: [],
    artifacts: {
      source: {
        manifest: missingSourceManifestPath,
      },
    },
  });

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with missing source manifest should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'source-manifest-missing');
  const expectedRecovery = reasonCodeSummary('source-manifest-missing');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'source-manifest-missing');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /source-manifest-missing/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports invalid source manifest JSON with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-source-manifest-invalid-json-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const sourceRunDir = path.join(runDir, 'source-action-run');
  await mkdir(sourceRunDir, { recursive: true });
  const sourceManifestPath = path.join(sourceRunDir, 'manifest.json');
  await writeFile(sourceManifestPath, '{"status": ');

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/source-manifest-invalid-json' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'invalid-source-manifest-resource',
      url: 'https://example.com/invalid-source-manifest.txt',
      fileName: 'invalid-source-manifest.txt',
      mediaType: 'text',
    }],
  };
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-source-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'partial',
    counts: {
      expected: 0,
      attempted: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
    },
    files: [],
    failedResources: [],
    artifacts: {
      source: {
        manifest: sourceManifestPath,
      },
    },
  });

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with invalid source manifest JSON should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'source-manifest-invalid-json');
  const expectedRecovery = reasonCodeSummary('source-manifest-invalid-json');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'source-manifest-invalid-json');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /source-manifest-invalid-json/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports missing source media manifest with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-source-media-manifest-missing-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const sourceRunDir = path.join(runDir, 'source-action-run');
  const missingSourceMediaManifestPath = path.join(sourceRunDir, 'media-manifest.json');

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/source-media-manifest-missing' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'missing-source-media-manifest-resource',
      url: 'https://example.com/missing-source-media-manifest.txt',
      fileName: 'missing-source-media-manifest.txt',
      mediaType: 'text',
    }],
  };
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-source-media-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'partial',
    counts: {
      expected: 0,
      attempted: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
    },
    files: [],
    failedResources: [],
    artifacts: {
      source: {
        mediaManifest: missingSourceMediaManifestPath,
      },
    },
  });

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with missing source media manifest should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'source-media-manifest-missing');
  const expectedRecovery = reasonCodeSummary('source-media-manifest-missing');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'source-media-manifest-missing');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /source-media-manifest-missing/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports invalid source media manifest JSON with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-source-media-manifest-invalid-json-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const sourceRunDir = path.join(runDir, 'source-action-run');
  await mkdir(sourceRunDir, { recursive: true });
  const sourceMediaManifestPath = path.join(sourceRunDir, 'media-manifest.json');
  await writeFile(sourceMediaManifestPath, '{"entries": ');

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/source-media-manifest-invalid-json' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'invalid-source-media-manifest-resource',
      url: 'https://example.com/invalid-source-media-manifest.txt',
      fileName: 'invalid-source-media-manifest.txt',
      mediaType: 'text',
    }],
  };
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-source-media-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'partial',
    counts: {
      expected: 0,
      attempted: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
    },
    files: [],
    failedResources: [],
    artifacts: {
      source: {
        mediaManifest: sourceMediaManifestPath,
      },
    },
  });

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with invalid source media manifest JSON should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'source-media-manifest-invalid-json');
  const expectedRecovery = reasonCodeSummary('source-media-manifest-invalid-json');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'source-media-manifest-invalid-json');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /source-media-manifest-invalid-json/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports invalid source media queue shape with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-source-media-queue-invalid-shape-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const sourceRunDir = path.join(runDir, 'source-action-run');
  await mkdir(sourceRunDir, { recursive: true });
  const sourceMediaQueuePath = path.join(sourceRunDir, 'media-queue.json');
  await writeJsonFile(sourceMediaQueuePath, { queue: 'not-an-array' });

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/source-media-queue-invalid-shape' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'invalid-source-media-queue-resource',
      url: 'https://example.com/invalid-source-media-queue.txt',
      fileName: 'invalid-source-media-queue.txt',
      mediaType: 'text',
    }],
  };
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-source-media-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'partial',
    counts: {
      expected: 0,
      attempted: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
    },
    files: [],
    failedResources: [],
    artifacts: {
      source: {
        mediaQueue: sourceMediaQueuePath,
      },
    },
  });

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with invalid source media queue shape should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'source-media-queue-invalid-shape');
  const expectedRecovery = reasonCodeSummary('source-media-queue-invalid-shape');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'source-media-queue-invalid-shape');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /source-media-queue-invalid-shape/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor reports invalid source media queue JSON with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-source-media-queue-invalid-json-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const sourceRunDir = path.join(runDir, 'source-action-run');
  await mkdir(sourceRunDir, { recursive: true });
  const sourceMediaQueuePath = path.join(sourceRunDir, 'media-queue.json');
  await writeFile(sourceMediaQueuePath, '{"queue": ');

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/source-media-queue-invalid-json' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'invalid-source-media-queue-json-resource',
      url: 'https://example.com/invalid-source-media-queue-json.txt',
      fileName: 'invalid-source-media-queue-json.txt',
      mediaType: 'text',
    }],
  };
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-source-media-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'partial',
    counts: {
      expected: 0,
      attempted: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
    },
    files: [],
    failedResources: [],
    artifacts: {
      source: {
        mediaQueue: sourceMediaQueuePath,
      },
    },
  });

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with invalid source media queue JSON should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'source-media-queue-invalid-json');
  const expectedRecovery = reasonCodeSummary('source-media-queue-invalid-json');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'source-media-queue-invalid-json');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /source-media-queue-invalid-json/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('download executor report includes next recovery commands and artifact paths', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-report-commands-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/report.txt' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { root: runRoot },
  });
  const manifest = await executeResolvedDownloadTask({
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'report',
      url: 'https://example.com/report.txt',
      fileName: 'report.txt',
      mediaType: 'text',
    }],
  }, plan, null, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    dryRun: false,
  }, {
    fetchImpl: async () => ({
      ok: false,
      status: 503,
    }),
  });

  const report = await readFile(manifest.artifacts.reportMarkdown, 'utf8');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  const expectedRecovery = reasonCodeSummary('download-failures');
  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'download-failures');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  assert.equal(manifest.resumeCommand.includes('--resume'), true);
  assert.equal(manifest.failedResources.length, 1);
  assert.equal(manifest.failedResources[0].reason, 'http-503');
  assert.match(report, /Status explanation:/u);
  assert.match(report, /download-failures/u);
  assert.match(report, /Reason retryable: true/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: false/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
  assert.match(report, /Next resume command: .*--resume/u);
  assert.match(report, /Next retry-failed command: .*--retry-failed/u);
  assert.match(report, new RegExp(`Manifest: ${manifest.artifacts.manifest.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u'));
  assert.match(report, new RegExp(`Queue: ${manifest.artifacts.queue.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u'));
  assert.match(report, new RegExp(`Downloads JSONL: ${manifest.artifacts.downloadsJsonl.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u'));
});

test('download executor retry-failed only reattempts previous failures', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-retry-failed-run-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/retry-failed' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [
      {
        id: 'pending',
        url: 'https://example.com/pending.txt',
        fileName: 'pending.txt',
        mediaType: 'text',
      },
      {
        id: 'failed',
        url: 'https://example.com/failed.txt',
        fileName: 'failed.txt',
        mediaType: 'text',
      },
    ],
  };

  await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
  }, {
    fetchImpl: async (url) => {
      if (String(url).includes('failed')) {
        return { ok: false, status: 500 };
      }
      const payload = Buffer.from('already successful', 'utf8');
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      };
    },
  });

  const retriedUrls = [];
  const retryManifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async (url) => {
      retriedUrls.push(String(url));
      if (String(url).includes('pending')) {
        throw new Error('successful resources should be reused, not retried');
      }
      const payload = Buffer.from('retry failed only', 'utf8');
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      };
    },
  });

  assert.deepEqual(retriedUrls, ['https://example.com/failed.txt']);
  assert.equal(retryManifest.status, 'passed');
  assert.equal(retryManifest.counts.downloaded, 1);
  assert.equal(retryManifest.counts.skipped, 1);
  assert.equal(retryManifest.files.find((entry) => entry.resourceId === 'pending').skipped, true);
});

test('download executor retry-failed recognizes media queue state', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-media-queue-retry-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const mediaDir = path.join(runDir, 'media');
  await mkdir(mediaDir, { recursive: true });
  const donePath = path.join(mediaDir, 'done.jpg');
  await writeFile(donePath, 'done-media', 'utf8');

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'x',
    host: 'x.com',
    taskType: 'media-bundle',
    source: { input: 'https://x.com/openai/status/1' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [
      {
        id: 'done-media',
        url: 'https://pbs.twimg.com/media/done.jpg',
        fileName: 'done.jpg',
        mediaType: 'image',
      },
      {
        id: 'failed-media',
        url: 'https://pbs.twimg.com/media/failed.jpg',
        fileName: 'failed.jpg',
        mediaType: 'image',
      },
    ],
  };

  await writeJsonFile(path.join(runDir, 'media-queue.json'), {
    schemaVersion: 1,
    queue: [
      {
        key: 'image:https://pbs.twimg.com/media/done.jpg',
        status: 'done',
        url: 'https://pbs.twimg.com/media/done.jpg',
        type: 'image',
        result: {
          ok: true,
          url: 'https://pbs.twimg.com/media/done.jpg',
          filePath: donePath,
          bytes: 'done-media'.length,
          type: 'image',
        },
      },
      {
        key: 'image:https://pbs.twimg.com/media/failed.jpg',
        status: 'failed',
        url: 'https://pbs.twimg.com/media/failed.jpg',
        type: 'image',
        result: {
          ok: false,
          url: 'https://pbs.twimg.com/media/failed.jpg',
          reason: 'http-503',
        },
      },
    ],
  });

  const retriedUrls = [];
  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async (url) => {
      retriedUrls.push(String(url));
      if (String(url).includes('done.jpg')) {
        throw new Error('completed media should be reused from media-queue.json');
      }
      const payload = Buffer.from('retried-media', 'utf8');
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      };
    },
  });

  assert.deepEqual(retriedUrls, ['https://pbs.twimg.com/media/failed.jpg']);
  assert.equal(manifest.status, 'passed');
  assert.equal(manifest.counts.downloaded, 1);
  assert.equal(manifest.counts.skipped, 1);
  assert.equal(manifest.files.find((entry) => entry.resourceId === 'done-media').skipped, true);
});

test('legacy executor reports unsupported retry-failed recovery with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-legacy-retry-unsupported-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const failedFile = path.join(runDir, 'files', '0001-failed.txt');
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-legacy-run',
    planId: 'old-plan',
    siteKey: 'example',
    status: 'partial',
    counts: {
      expected: 1,
      attempted: 1,
      downloaded: 0,
      skipped: 0,
      failed: 1,
    },
    files: [],
    failedResources: [{
      resourceId: 'failed-resource',
      url: 'https://example.com/failed.txt',
      filePath: failedFile,
      reason: 'fetch-error',
    }],
  });
  await writeJsonFile(path.join(runDir, 'queue.json'), [{
    id: 'failed-resource',
    status: 'failed',
    url: 'https://example.com/failed.txt',
    filePath: failedFile,
  }]);
  await writeFile(path.join(runDir, 'downloads.jsonl'), '', 'utf8');

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/failed.txt' },
    policy: { dryRun: false },
    output: { runDir },
    legacy: {
      entrypoint: 'src/entrypoints/sites/generic-download.mjs',
      executorKind: 'node',
    },
  });
  let spawned = false;
  const manifest = await executeLegacyDownloadTask(plan, {
    siteKey: 'example',
    host: 'example.com',
    status: 'ready',
    mode: 'anonymous',
    riskSignals: [],
  }, {
    input: 'https://example.com/failed.txt',
    retryFailedOnly: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runDir,
    retryFailedOnly: true,
  }, {
    spawnJsonCommand: async () => {
      spawned = true;
      throw new Error('legacy command should not spawn when retry-failed is unsupported');
    },
  });

  assert.equal(spawned, false);
  assert.equal(manifest.status, 'skipped');
  assert.equal(manifest.reason, 'legacy-retry-failed-unsupported');
  const expectedRecovery = reasonCodeSummary('legacy-retry-failed-unsupported');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'legacy-retry-failed-unsupported');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /legacy-retry-failed-unsupported/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: false/u);
  assert.match(report, /Reason degradable: true/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('legacy executor reports missing resume state with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-legacy-resume-missing-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/resume-missing.txt' },
    policy: { dryRun: false },
    output: { runDir },
    legacy: {
      entrypoint: 'src/entrypoints/sites/generic-download.mjs',
      executorKind: 'node',
    },
  });
  let spawned = false;
  const manifest = await executeLegacyDownloadTask(plan, {
    siteKey: 'example',
    host: 'example.com',
    status: 'ready',
    mode: 'anonymous',
    riskSignals: [],
  }, {
    input: 'https://example.com/resume-missing.txt',
    resume: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runDir,
    resume: true,
  }, {
    spawnJsonCommand: async () => {
      spawned = true;
      throw new Error('legacy command should not spawn when resume state is missing');
    },
  });

  assert.equal(spawned, false);
  assert.equal(manifest.status, 'skipped');
  assert.equal(manifest.reason, 'resume-state-missing');
  const expectedRecovery = reasonCodeSummary('resume-state-missing');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.deepEqual(manifest.failedResources, []);
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /resume-state-missing/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: false/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('legacy executor reports unsupported resume recovery with taxonomy semantics', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-legacy-resume-unsupported-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const failedFile = path.join(runDir, 'files', '0001-resume-failed.txt');
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-legacy-run',
    planId: 'old-plan',
    siteKey: 'example',
    status: 'partial',
    counts: {
      expected: 1,
      attempted: 1,
      downloaded: 0,
      skipped: 0,
      failed: 1,
    },
    files: [],
    failedResources: [{
      resourceId: 'resume-failed-resource',
      url: 'https://example.com/resume-failed.txt',
      filePath: failedFile,
      reason: 'fetch-error',
    }],
  });
  await writeJsonFile(path.join(runDir, 'queue.json'), [{
    id: 'resume-failed-resource',
    status: 'failed',
    url: 'https://example.com/resume-failed.txt',
    filePath: failedFile,
  }]);
  await writeFile(path.join(runDir, 'downloads.jsonl'), '', 'utf8');

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/resume-failed.txt' },
    policy: { dryRun: false },
    output: { runDir },
    legacy: {
      entrypoint: 'src/entrypoints/sites/generic-download.mjs',
      executorKind: 'node',
    },
  });
  let spawned = false;
  const manifest = await executeLegacyDownloadTask(plan, {
    siteKey: 'example',
    host: 'example.com',
    status: 'ready',
    mode: 'anonymous',
    riskSignals: [],
  }, {
    input: 'https://example.com/resume-failed.txt',
    resume: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runDir,
    resume: true,
  }, {
    spawnJsonCommand: async () => {
      spawned = true;
      throw new Error('legacy command should not spawn when resume is unsupported');
    },
  });

  assert.equal(spawned, false);
  assert.equal(manifest.status, 'skipped');
  assert.equal(manifest.reason, 'legacy-resume-unsupported');
  const expectedRecovery = reasonCodeSummary('legacy-resume-unsupported');
  assert.deepEqual(manifest.reasonRecovery, expectedRecovery);
  assert.equal(manifest.failedResources[0].reason, 'legacy-resume-unsupported');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedRecovery);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /legacy-resume-unsupported/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: false/u);
  assert.match(report, /Reason degradable: true/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
});

test('legacy executor returns stable recovery reason for missing source media queue', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-legacy-source-missing-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const sourceRunDir = path.join(runDir, 'source-action-run');
  const missingMediaQueue = path.join(sourceRunDir, 'media-queue.json');
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-legacy-run',
    planId: 'old-plan',
    siteKey: 'x',
    status: 'partial',
    counts: {
      expected: 1,
      attempted: 1,
      downloaded: 0,
      skipped: 0,
      failed: 1,
    },
    files: [],
    failedResources: [],
    artifacts: {
      source: {
        runDir: sourceRunDir,
        mediaQueue: missingMediaQueue,
        diagnostic: 'refresh_token=synthetic-legacy-report-token',
      },
    },
  });

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'x',
    host: 'x.com',
    taskType: 'social-archive',
    adapterVersion: 'x-adapter-v1',
    source: { input: 'openai' },
    policy: { dryRun: false },
    output: { runDir },
    legacy: {
      entrypoint: 'src/entrypoints/sites/x-action.mjs',
      executorKind: 'node',
    },
  });
  let spawned = false;
  const hookRegistry = createCapabilityHookRegistry([{
    id: 'download-legacy-recovery-preflight-observer',
    phase: 'after_download',
    subscriber: {
      name: 'download-legacy-recovery-preflight-observer',
      modulePath: 'src/sites/capability/lifecycle-events.mjs',
      entrypoint: 'observe',
      order: 1,
    },
    filters: {
      eventTypes: ['download.legacy.recovery_preflight'],
      siteKeys: ['x'],
      reasonCodes: ['source-media-queue-missing'],
    },
  }]);
  const manifest = await executeLegacyDownloadTask(plan, {
    siteKey: 'x',
    host: 'x.com',
    status: 'ready',
    mode: 'reusable-profile',
    riskSignals: ['refresh_token=synthetic-legacy-recovery-token'],
  }, {
    input: 'openai',
    retryFailedOnly: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runDir,
    retryFailedOnly: true,
  }, {
    capabilityHookRegistry: hookRegistry,
    spawnJsonCommand: async () => {
      spawned = true;
      throw new Error('legacy command should not spawn when source recovery artifacts are missing');
    },
  });

  assert.equal(spawned, false);
  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'source-media-queue-missing');
  assert.equal(requireReasonCodeDefinition(manifest.reason, { family: 'download' }).manualRecoveryNeeded, true);
  assert.equal(requireReasonCodeDefinition(manifest.reason, { family: 'download' }).retryable, false);
  const expectedSourceQueueRecovery = reasonCodeSummary('source-media-queue-missing');
  assert.deepEqual(manifest.reasonRecovery, expectedSourceQueueRecovery);
  assert.equal(manifest.legacy.recovery.problems[0].reason, 'source-media-queue-missing');
  const persisted = await readJsonFile(manifest.artifacts.manifest);
  assert.deepEqual(persisted.reasonRecovery, expectedSourceQueueRecovery);
  assert.equal(JSON.stringify(persisted).includes('synthetic-legacy-recovery-token'), false);
  assert.equal(JSON.stringify(persisted).includes('synthetic-legacy-report-token'), false);
  assert.deepEqual(persisted.session.riskSignals, [REDACTION_PLACEHOLDER]);
  const report = await readFile(persisted.artifacts.reportMarkdown, 'utf8');
  assert.equal(report.includes('synthetic-legacy-report-token'), false);
  assert.match(report, /Source artifact diagnostic: \[REDACTED\]/u);
  assert.match(report, /Reason retryable: false/u);
  assert.match(report, /Reason cooldown needed: false/u);
  assert.match(report, /Reason isolation needed: false/u);
  assert.match(report, /Reason manual recovery needed: true/u);
  assert.match(report, /Reason degradable: false/u);
  assert.match(report, /Reason artifact write allowed: true/u);
  assert.match(report, /Reason catalog action: none/u);
  assert.doesNotMatch(report, /refresh_token=|Bearer|SESSDATA=/iu);
  assert.equal(typeof persisted.artifacts.standardTaskList, 'string');
  const standardTaskList = await readJsonFile(persisted.artifacts.standardTaskList);
  assert.equal(standardTaskList.schemaVersion, STANDARD_TASK_LIST_SCHEMA_VERSION);
  assert.equal(assertSchemaCompatible('StandardTaskList', standardTaskList), true);
  assert.equal(standardTaskList.siteKey, 'x');
  assert.equal(standardTaskList.taskType, 'social-archive');
  assert.equal(standardTaskList.policyRef, `download-plan:${plan.id}:policy`);
  assert.deepEqual(standardTaskList.items, []);
  assert.doesNotMatch(
    JSON.stringify(standardTaskList),
    /synthetic-legacy-recovery-token|headers|authorization|cookie|csrf|token|Bearer/iu,
  );
  assert.equal(typeof persisted.artifacts.redactionAudit, 'string');
  const audit = await readJsonFile(persisted.artifacts.redactionAudit);
  assert.equal(JSON.stringify(audit).includes('synthetic-legacy-recovery-token'), false);
  assert.equal(JSON.stringify(audit).includes('synthetic-legacy-report-token'), false);
  assert.deepEqual(audit.redactedPaths, [
    'artifacts.source.diagnostic',
    'legacy.artifacts.diagnostic',
    'session.riskSignals.0',
  ]);
  assert.deepEqual(audit.findings, [{
    path: 'artifacts.source.diagnostic',
    pattern: 'sensitive-query-assignment',
  }, {
    path: 'legacy.artifacts.diagnostic',
    pattern: 'sensitive-query-assignment',
  }, {
    path: 'session.riskSignals.0',
    pattern: 'sensitive-query-assignment',
  }]);
  assert.equal(typeof persisted.artifacts.lifecycleEvent, 'string');
  assert.equal(typeof persisted.artifacts.lifecycleEventRedactionAudit, 'string');
  const lifecycleEvent = await readJsonFile(persisted.artifacts.lifecycleEvent);
  assert.equal(lifecycleEvent.schemaVersion, LIFECYCLE_EVENT_SCHEMA_VERSION);
  assert.equal(assertSchemaCompatible('LifecycleEvent', lifecycleEvent), true);
  assert.equal(assertLifecycleEventObservabilityFields(lifecycleEvent, {
    requiredFields: [
      'traceId',
      'correlationId',
      'taskId',
      'siteKey',
      'taskType',
      'adapterVersion',
      'reasonCode',
    ],
    requiredDetailFields: [
      'counts',
      'reasonRecovery',
      'riskSignals',
      'capabilityHookMatches',
    ],
  }), true);
  assert.equal(lifecycleEvent.eventType, 'download.legacy.recovery_preflight');
  assert.equal(lifecycleEvent.traceId, persisted.runId);
  assert.equal(lifecycleEvent.correlationId, persisted.planId);
  assert.equal(lifecycleEvent.taskId, persisted.runId);
  assert.equal(lifecycleEvent.siteKey, 'x');
  assert.equal(lifecycleEvent.taskType, plan.taskType);
  assert.equal(lifecycleEvent.adapterVersion, 'x-adapter-v1');
  assert.equal(lifecycleEvent.reasonCode, 'source-media-queue-missing');
  assert.equal(lifecycleEvent.details.status, 'failed');
  assert.deepEqual(lifecycleEvent.details.counts, persisted.counts);
  assert.deepEqual(lifecycleEvent.details.reasonRecovery, expectedSourceQueueRecovery);
  assert.deepEqual(lifecycleEvent.details.riskSignals, [REDACTION_PLACEHOLDER]);
  assert.deepEqual(lifecycleEvent.details.capabilityHookMatches.phases, ['after_download']);
  assert.equal(lifecycleEvent.details.capabilityHookMatches.matchCount, 1);
  assert.equal(
    lifecycleEvent.details.capabilityHookMatches.matches[0].id,
    'download-legacy-recovery-preflight-observer',
  );
  assert.equal(
    Object.hasOwn(lifecycleEvent.details.capabilityHookMatches.matches[0].subscriber, 'modulePath'),
    false,
  );
  assert.equal(
    Object.hasOwn(lifecycleEvent.details.capabilityHookMatches.matches[0].subscriber, 'entrypoint'),
    false,
  );
  assert.equal(JSON.stringify(lifecycleEvent).includes('synthetic-legacy-recovery-token'), false);
  const lifecycleAudit = await readJsonFile(persisted.artifacts.lifecycleEventRedactionAudit);
  assert.equal(JSON.stringify(lifecycleAudit).includes('synthetic-legacy-recovery-token'), false);
  assert.equal(lifecycleAudit.redactedPaths.includes('details.riskSignals.0'), true);
  assert.deepEqual(lifecycleAudit.findings, [{
    path: 'details.riskSignals.0',
    pattern: 'sensitive-query-assignment',
  }]);
  assert.deepEqual(manifest.session.riskSignals, ['refresh_token=synthetic-legacy-recovery-token']);
});

test('legacy recovery lifecycle subscriber failure fails closed before manifest overwrite', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-legacy-recovery-lifecycle-failure-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const sourceRunDir = path.join(runDir, 'source-action-run');
  const missingMediaQueue = path.join(sourceRunDir, 'media-queue.json');
  const manifestPath = path.join(runDir, 'manifest.json');
  await writeJsonFile(manifestPath, {
    runId: 'old-legacy-run',
    planId: 'old-plan',
    siteKey: 'x',
    status: 'partial',
    counts: {
      expected: 1,
      attempted: 1,
      downloaded: 0,
      skipped: 0,
      failed: 1,
    },
    files: [],
    failedResources: [],
    artifacts: {
      source: {
        runDir: sourceRunDir,
        mediaQueue: missingMediaQueue,
      },
    },
  });

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'x',
    host: 'x.com',
    taskType: 'social-archive',
    adapterVersion: 'x-adapter-v1',
    source: { input: 'openai' },
    policy: { dryRun: false },
    output: { runDir },
    legacy: {
      entrypoint: 'src/entrypoints/sites/x-action.mjs',
      executorKind: 'node',
    },
  });

  await assert.rejects(
    () => executeLegacyDownloadTask(plan, {
      siteKey: 'x',
      host: 'x.com',
      status: 'ready',
      mode: 'reusable-profile',
      riskSignals: ['refresh_token=synthetic-legacy-recovery-token'],
    }, {
      input: 'openai',
      retryFailedOnly: true,
    }, {
      workspaceRoot: REPO_ROOT,
      runDir,
      retryFailedOnly: true,
    }, {
      spawnJsonCommand: async () => {
        throw new Error('legacy command should not spawn when source recovery artifacts are missing');
      },
      lifecycleEventSubscribers: [async () => {
        throw new Error('synthetic-legacy-recovery-lifecycle-failure');
      }],
    }),
    /synthetic-legacy-recovery-lifecycle-failure/u,
  );

  const persisted = await readJsonFile(manifestPath);
  assert.equal(persisted.runId, 'old-legacy-run');
  assert.equal(persisted.status, 'partial');
  assert.equal(persisted.reason, undefined);
  assert.equal(JSON.stringify(persisted).includes('synthetic-legacy-recovery-lifecycle-failure'), false);
  assert.equal(JSON.stringify(persisted).includes('synthetic-legacy-recovery-token'), false);
  await assert.rejects(
    () => readFile(path.join(runDir, 'lifecycle-event.json'), 'utf8'),
    /ENOENT/u,
  );
  await assert.rejects(
    () => readFile(path.join(runDir, 'lifecycle-event-redaction-audit.json'), 'utf8'),
    /ENOENT/u,
  );
});

test('download recovery reports missing and corrupt artifacts without fetching', async (t) => {
  const missingRunDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-recovery-missing-'));
  const corruptRunDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-recovery-corrupt-'));
  t.after(async () => {
    await rm(missingRunDir, { recursive: true, force: true });
    await rm(corruptRunDir, { recursive: true, force: true });
  });

  const missingPlan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/missing-state' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir: missingRunDir },
  });
  const resolvedTask = {
    planId: missingPlan.id,
    siteKey: missingPlan.siteKey,
    taskType: missingPlan.taskType,
    resources: [{
      id: 'resource-1',
      url: 'https://example.com/resource-1.txt',
      fileName: 'resource-1.txt',
      mediaType: 'text',
    }],
  };

  const missingManifest = await executeResolvedDownloadTask(resolvedTask, missingPlan, null, {
    workspaceRoot: REPO_ROOT,
    runDir: missingRunDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('missing retry state should not fetch');
    },
  });
  assert.equal(missingManifest.status, 'skipped');
  assert.equal(missingManifest.reason, 'retry-state-missing');
  const missingRetryStateReason = requireReasonCodeDefinition(missingManifest.reason, { family: 'download' });
  assert.equal(missingRetryStateReason.retryable, false);
  assert.equal(missingRetryStateReason.artifactWriteAllowed, true);
  const expectedMissingReasonRecovery = reasonCodeSummary('retry-state-missing');
  assert.deepEqual(missingManifest.reasonRecovery, expectedMissingReasonRecovery);
  const persistedMissingManifest = await readJsonFile(missingManifest.artifacts.manifest);
  assert.deepEqual(persistedMissingManifest.reasonRecovery, expectedMissingReasonRecovery);
  const missingReport = await readFile(missingManifest.artifacts.reportMarkdown, 'utf8');
  assert.match(missingReport, /Reason retryable: false/u);
  assert.match(missingReport, /Reason manual recovery needed: false/u);
  assert.match(missingReport, /Reason degradable: false/u);
  assert.match(missingReport, /Reason artifact write allowed: true/u);

  const corruptPlan = normalizeDownloadTaskPlan({
    ...missingPlan,
    output: { runDir: corruptRunDir },
  });
  await writeFile(path.join(corruptRunDir, 'media-queue.json'), '{not json', 'utf8');
  const corruptManifest = await executeResolvedDownloadTask({
    ...resolvedTask,
    planId: corruptPlan.id,
  }, corruptPlan, null, {
    workspaceRoot: REPO_ROOT,
    runDir: corruptRunDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('corrupt retry state should not fetch');
    },
  });
  assert.equal(corruptManifest.status, 'failed');
  assert.equal(corruptManifest.reason, 'media-queue-invalid-json');
});

test('download runner keeps site-specific resolver dependency names outside the consumer path', async () => {
  const runnerSource = await readFile(path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'runner.mjs'), 'utf8');
  const modulesSource = await readFile(path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'modules.mjs'), 'utf8');
  const siteResolverDeps = [
    'resolveBilibiliApiEvidence',
    'resolveDouyinMediaBatch',
    'enumerateDouyinAuthorVideos',
    'queryDouyinFollow',
    'queryXiaohongshuFollow',
    'resolveXiaohongshuFreshEvidence',
  ];

  assert.match(runnerSource, /resolverDependenciesFromRuntime/u);
  assert.match(modulesSource, /resolverDependenciesFromRuntime/u);
  for (const depName of siteResolverDeps) {
    assert.equal(
      runnerSource.includes(depName),
      false,
      `runner.mjs must not hard-code site resolver dependency ${depName}`,
    );
    assert.equal(
      modulesSource.includes(depName),
      true,
      `modules.mjs should own site resolver dependency ${depName}`,
    );
  }
  assert.doesNotMatch(runnerSource, /site-modules\/(?:22biqu|bilibili|douyin|social|xiaohongshu)\.mjs/u);
});

test('download executors stay independent from concrete site routers and session plumbing', async () => {
  const files = ['executor.mjs', 'media-executor.mjs'];
  const forbiddenPatterns = [
    ['concrete site source path', /src\/sites\/(?:bilibili|douyin|xiaohongshu|social|instagram|x)\//u],
    ['concrete site relative import', /\\.\\.\/(?:bilibili|douyin|xiaohongshu|social|instagram|x)\//u],
    ['download registry import', /from ['"]\.\/registry\.mjs['"]/u],
    ['download module router import', /from ['"]\.\/modules\.mjs['"]/u],
    ['session manager import', /from ['"]\.\/session-manager\.mjs['"]/u],
    ['core adapter import', /core\/adapters/u],
    ['legacy command builder', /buildLegacyDownloadCommand/u],
    ['resource resolver', /resolveDownloadResources/u],
    ['session acquisition', /acquireSessionLease/u],
    ['site-specific branch', /siteKey\s*={2,3}\s*['"][a-z0-9_-]+['"]/iu],
    ['concrete site identifier', /\b(?:22biqu|bilibili|douyin|instagram|jable|moodyz|xiaohongshu)\b/iu],
  ];

  for (const file of files) {
    const source = await readFile(path.join(REPO_ROOT, 'src', 'sites', 'downloads', file), 'utf8');
    for (const [label, pattern] of forbiddenPatterns) {
      assert.equal(pattern.test(source), false, `${file} must not depend on ${label}`);
    }
  }
});

test('download executors do not read raw credential or profile fields directly', async () => {
  const files = [
    { name: 'executor.mjs', headerBoundaryPattern: /normalizeSessionLeaseConsumerHeaders/u },
    { name: 'media-executor.mjs', headerBoundaryPattern: /headers,\s*outDir/u },
    { name: 'legacy-executor.mjs' },
  ];
  const forbiddenPatterns = [
    ['raw lease headers', /sessionLease\??\.(?:headers|cookies)\b/u],
    ['raw profile paths', /\b(?:profilePath|browserProfileRoot|userDataDir)\b/u],
    ['raw credential field names', /\b(?:authorization|cookie|csrf|accessToken|refreshToken|SESSDATA)\b/iu],
  ];

  for (const file of files) {
    const source = await readFile(path.join(REPO_ROOT, 'src', 'sites', 'downloads', file.name), 'utf8');
    if (file.headerBoundaryPattern) {
      assert.match(
        source,
        file.headerBoundaryPattern,
        `${file.name} should consume already-normalized headers rather than raw session material`,
      );
    }
    for (const [label, pattern] of forbiddenPatterns) {
      assert.equal(pattern.test(source), false, `${file.name} must not read ${label}`);
    }
  }
});
