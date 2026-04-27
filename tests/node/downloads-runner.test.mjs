import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { readJsonFile } from '../../src/infra/io.mjs';
import { parseArgs } from '../../src/entrypoints/sites/download.mjs';
import { normalizeDownloadTaskPlan } from '../../src/sites/downloads/contracts.mjs';
import { executeResolvedDownloadTask } from '../../src/sites/downloads/executor.mjs';
import { executeLegacyDownloadTask } from '../../src/sites/downloads/legacy-executor.mjs';
import { listDownloadSiteDefinitions } from '../../src/sites/downloads/registry.mjs';
import { runDownloadTask } from '../../src/sites/downloads/runner.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');

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

test('download registry exposes dry-run plans for every configured download site', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-dry-run-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const definitions = await listDownloadSiteDefinitions(REPO_ROOT);
  const siteKeys = definitions.map((definition) => definition.siteKey).sort();
  assert.deepEqual(siteKeys, [
    '22biqu',
    'bilibili',
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

test('legacy executor normalizes successful action stdout into a download manifest', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-legacy-success-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    taskType: 'video',
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
  const manifest = await executeLegacyDownloadTask(plan, {
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    status: 'ready',
    mode: 'reusable-profile',
    riskSignals: [],
  }, {
    input: 'BV1legacySuccess',
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
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
  assert.equal((await readJsonFile(manifest.artifacts.manifest)).planId, plan.id);
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
  assert.equal(manifest.resumeCommand.includes('--execute'), true);
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

test('download executor consumes resolved resources without site-specific logic', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-executor-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/file.txt' },
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
      url: 'https://example.com/file.txt',
      fileName: 'file.txt',
      mediaType: 'text',
      expectedBytes: payload.length,
    }],
  }, plan, {
    siteKey: 'example',
    host: 'example.com',
    status: 'ready',
    mode: 'anonymous',
    riskSignals: [],
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
  assert.equal(manifest.failedResources[0].reason, 'http-500');
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
    fetchImpl: async (url) => ({ ok: false, status: String(url).includes('failed') ? 500 : 404 }),
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

  assert.deepEqual(retriedUrls.sort(), ['https://example.com/failed.txt', 'https://example.com/pending.txt']);
  assert.equal(retryManifest.status, 'passed');
});

test('download executor stays independent from concrete site routers', async () => {
  const source = await readFile(path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'executor.mjs'), 'utf8');
  assert.equal(/src\/sites\/(?:bilibili|douyin|xiaohongshu|social)\//u.test(source), false);
  assert.equal(/\\.\\.\/(?:bilibili|douyin|xiaohongshu|social)\//u.test(source), false);
});
