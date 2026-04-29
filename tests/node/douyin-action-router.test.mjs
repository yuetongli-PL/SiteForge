import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import {
  buildDouyinActionRequest,
  parseDouyinActionArgs,
} from '../../src/entrypoints/sites/douyin-action.mjs';
import {
  classifyDouyinDownloadInput,
  planDouyinAction,
  runDouyinAction,
} from '../../src/sites/douyin/actions/router.mjs';

test('classifyDouyinDownloadInput recognizes video ids, detail urls, and author urls', () => {
  assert.equal(classifyDouyinDownloadInput('7487317288315258152').inputKind, 'video-detail');
  assert.equal(classifyDouyinDownloadInput('https://www.douyin.com/video/7487317288315258152').inputKind, 'video-detail');
  assert.equal(
    classifyDouyinDownloadInput('https://www.douyin.com/user/MS4wLjABAAAA-example?showTab=post').inputKind,
    'author-video-list',
  );
});

test('parseDouyinActionArgs accepts unified session traceability flags', () => {
  const parsed = parseDouyinActionArgs([
    'download',
    'https://www.douyin.com/video/7487317288315258152',
    '--session-manifest', 'runs/session/douyin/manifest.json',
    '--session-provider', 'unified-session-runner',
    '--no-session-health-plan',
  ]);

  assert.equal(parsed.action, 'download');
  assert.deepEqual(parsed.items, ['https://www.douyin.com/video/7487317288315258152']);
  assert.equal(parsed.sessionManifest, 'runs/session/douyin/manifest.json');
  assert.equal(parsed.sessionProvider, 'unified-session-runner');
  assert.equal(parsed.useUnifiedSessionHealth, false);
});

test('buildDouyinActionRequest carries unified session manifest options into router request', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'douyin-session-manifest-'));
  try {
    const manifestPath = path.join(tempDir, 'manifest.json');
    await writeFile(manifestPath, `${JSON.stringify({
      schemaVersion: 1,
      runId: 'douyin-session-test',
      siteKey: 'douyin',
      host: 'www.douyin.com',
      purpose: 'download',
      status: 'blocked',
      reason: 'session-invalid',
      health: {
        status: 'blocked',
        reason: 'session-invalid',
        authStatus: 'unknown',
        riskCauseCode: 'session-invalid',
      },
      artifacts: {},
    }, null, 2)}\n`, 'utf8');
    const parsed = parseDouyinActionArgs([
      'download',
      'https://www.douyin.com/video/7487317288315258152',
      '--session-manifest',
      manifestPath,
      '--session-health-plan',
    ]);

    const request = await buildDouyinActionRequest(parsed);

    assert.deepEqual(request.items, ['https://www.douyin.com/video/7487317288315258152']);
    assert.equal(request.sessionManifest, manifestPath);
    assert.equal(request.useUnifiedSessionHealth, true);
    assert.equal(request.sessionStatus, 'blocked');
    assert.equal(request.sessionReason, 'session-invalid');
    assert.equal(request.sessionHealthManifest.healthStatus, 'blocked');
    assert.equal(request.sessionManifestPath, path.resolve(manifestPath));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('runDouyinAction blocks unhealthy download sessions before legacy inspection', async () => {
  const result = await runDouyinAction({
    action: 'download',
    items: ['https://www.douyin.com/video/7487317288315258152'],
    sessionManifest: 'runs/session/douyin/manifest.json',
    sessionStatus: 'blocked',
    sessionReason: 'session-invalid',
    sessionHealthManifest: {
      healthStatus: 'blocked',
      reason: 'session-invalid',
      riskCauseCode: 'session-invalid',
    },
    download: {
      dryRun: true,
    },
  }, {
    async inspectRequestReusableSiteSession() {
      assert.fail('legacy session inspection should not run after unhealthy session gate');
    },
    async bootstrapReusableSiteSession() {
      assert.fail('login bootstrap should not run after unhealthy session gate');
    },
    async queryDouyinFollow() {
      assert.fail('follow query should not run after unhealthy session gate');
    },
    async spawnJsonCommand() {
      assert.fail('download subprocess should not run after unhealthy session gate');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, 'session-unhealthy');
  assert.equal(result.sessionGate.status, 'blocked');
  assert.equal(result.sessionGate.reason, 'session-invalid');
  assert.equal(result.plan.route, 'blocked-before-session-inspection');
  assert.deepEqual(result.resolvedInputs, []);
});

test('runDouyinAction does not block login repair action on unhealthy session manifest', async () => {
  let inspected = false;
  let bootstrapped = false;
  const result = await runDouyinAction({
    action: 'login',
    sessionStatus: 'blocked',
    sessionReason: 'session-invalid',
    sessionHealthManifest: {
      healthStatus: 'blocked',
      reason: 'session-invalid',
    },
  }, {
    async inspectRequestReusableSiteSession() {
      inspected = true;
      return {
        authAvailable: false,
        userDataDir: 'C:/profiles/douyin.com',
        profileHealth: { status: 'manual-required' },
        profilePath: 'profiles/www.douyin.com.json',
      };
    },
    async bootstrapReusableSiteSession() {
      bootstrapped = true;
      return {
        ok: true,
        report: {
          status: 'completed',
        },
      };
    },
  });

  assert.equal(inspected, true);
  assert.equal(bootstrapped, true);
  assert.equal(result.ok, true);
  assert.equal(result.action, 'login');
  assert.equal(result.reasonCode, 'login-finished');
});

test('planDouyinAction routes downloads through login bootstrap when reusable auth is missing', async () => {
  const plan = await planDouyinAction({
    action: 'download',
    items: ['https://www.douyin.com/video/7487317288315258152'],
    reuseLoginState: true,
  }, {
    async resolveSiteBrowserSessionOptions() {
      return {
        reuseLoginState: true,
        userDataDir: 'C:/profiles/douyin.com',
        authProfile: { filePath: 'profiles/www.douyin.com.json' },
      };
    },
    async inspectPersistentProfileHealth() {
      return {
        usableForCookies: false,
      };
    },
  });

  assert.equal(plan.route, 'download-after-login');
  assert.equal(plan.authRequired, true);
});

test('runDouyinAction resolves followed updates and author pages into concrete download urls', async () => {
  let capturedInputPayload = null;
  let capturedArgs = null;
  let mediaResolveCalled = false;
  const result = await runDouyinAction({
    action: 'download',
    items: ['https://www.douyin.com/user/MS4wLjABAAAA-example?showTab=post'],
    followUpdatesWindow: '今天',
    reuseLoginState: true,
    profilePath: 'profiles/www.douyin.com.json',
    timeoutMs: 45000,
    download: {
      dryRun: true,
      maxItems: 5,
      concurrency: 4,
    },
  }, {
    async resolveSiteBrowserSessionOptions() {
      return {
        reuseLoginState: true,
        userDataDir: 'C:/profiles/douyin.com',
        authProfile: { filePath: 'profiles/www.douyin.com.json' },
      };
    },
    async inspectPersistentProfileHealth() {
      return {
        usableForCookies: true,
      };
    },
    async enumerateDouyinAuthorVideos() {
      return {
        result: {
          videos: [
            {
              url: 'https://www.douyin.com/video/111',
              videoId: '111',
              resolvedMediaUrl: 'https://sf5-hl-ali-cdn-tos.douyinstatic.com/obj/tos-cn-ve-2774/example111',
              resolvedTitle: 'Author Video',
            },
            { url: 'https://www.douyin.com/video/222' },
          ],
        },
      };
    },
    async queryDouyinFollow() {
      return {
        result: {
          videos: [
            { url: 'https://www.douyin.com/video/222' },
            {
              url: 'https://www.douyin.com/video/333',
              videoId: '333',
              resolvedMediaUrl: 'https://v26-web.douyinvod.com/example/333.mp4',
              resolvedTitle: 'Follow Video',
            },
          ],
        },
      };
    },
    async resolveDouyinMediaBatch() {
      mediaResolveCalled = true;
      throw new Error('dry-run should not pre-resolve media');
    },
    async spawnJsonCommand(_command, args) {
      capturedArgs = args;
      const index = args.indexOf('--input-file');
      const inputFile = index >= 0 ? args[index + 1] : null;
      capturedInputPayload = inputFile ? await readFile(inputFile, 'utf8') : null;
      return {
        code: 0,
        stdout: JSON.stringify({
          summary: { total: 3, successful: 0, failed: 0, planned: 3 },
        }),
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.reasonCode, 'download-started');
  assert.equal(result.mediaResolution?.skipped, true);
  assert.equal(result.mediaResolution?.attemptedCount, 0);
  assert.equal(result.mediaResolution?.resolvedCount, 2);
  assert.equal(result.mediaResolution?.preResolvedCount, 2);
  assert.deepEqual(result.resolvedInputs, [
    'https://www.douyin.com/video/111',
    'https://www.douyin.com/video/222',
    'https://www.douyin.com/video/333',
  ]);
  assert.equal(result.download.summary.total, 3);
  assert.equal(typeof capturedInputPayload, 'string');
  assert.ok(Array.isArray(capturedArgs));
  assert.match(String(capturedArgs[0]).replace(/\\/gu, '/'), /\/src\/sites\/douyin\/download\/python\/douyin\.py$/u);
  assert.ok(capturedArgs.includes('--browser-timeout'));
  assert.equal(capturedArgs[capturedArgs.indexOf('--browser-timeout') + 1], '45000');
  assert.equal(mediaResolveCalled, false);
  assert.match(capturedInputPayload, /"resolvedMediaUrl":"https:\/\/sf5-hl-ali-cdn-tos\.douyinstatic\.com\/obj\/tos-cn-ve-2774\/example111"/u);
  assert.match(capturedInputPayload, /https:\/\/www\.douyin\.com\/video\/222/u);
});

test('runDouyinAction pre-resolves direct douyin video inputs before spawning python downloader', async () => {
  let capturedArgs = null;
  let capturedInputPayload = null;
  const result = await runDouyinAction({
    action: 'download',
    items: ['https://www.douyin.com/video/7592547346870620763'],
    reuseLoginState: true,
    profilePath: 'profiles/www.douyin.com.json',
    timeoutMs: 45000,
    download: {
      dryRun: false,
      maxItems: 1,
    },
  }, {
    async resolveSiteBrowserSessionOptions() {
      return {
        reuseLoginState: true,
        userDataDir: 'C:/profiles/douyin.com',
        authProfile: { filePath: 'profiles/www.douyin.com.json' },
      };
    },
    async inspectPersistentProfileHealth() {
      return {
        usableForCookies: true,
      };
    },
    async resolveDouyinMediaBatch() {
      return {
        results: [
          {
            requestedUrl: 'https://www.douyin.com/video/7592547346870620763',
            videoId: '7592547346870620763',
            resolved: true,
            bestUrl: 'https://v26-web.douyinvod.com/example/direct.mp4',
            title: 'Direct Video',
            bestFormat: { formatId: '1080p' },
            formats: [{ formatId: '1080p', url: 'https://v26-web.douyinvod.com/example/direct.mp4' }],
            headers: {
              Referer: 'https://www.douyin.com/video/7592547346870620763',
              Origin: 'https://www.douyin.com',
            },
          },
        ],
      };
    },
    async spawnJsonCommand(_command, args) {
      capturedArgs = args;
      const index = args.indexOf('--input-file');
      const inputFile = index >= 0 ? args[index + 1] : null;
      capturedInputPayload = inputFile ? await readFile(inputFile, 'utf8') : null;
      return {
        code: 0,
        stdout: JSON.stringify({
          summary: { total: 1, successful: 0, failed: 0, planned: 1 },
        }),
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.reasonCode, 'download-started');
  assert.equal(result.mediaResolution?.attemptedCount, 1);
  assert.equal(result.mediaResolution?.resolvedCount, 1);
  assert.equal(typeof capturedInputPayload, 'string');
  assert.match(String(capturedArgs?.[0] ?? '').replace(/\\/gu, '/'), /\/src\/sites\/douyin\/download\/python\/douyin\.py$/u);
  assert.match(capturedInputPayload, /"resolvedMediaUrl":"https:\/\/v26-web\.douyinvod\.com\/example\/direct\.mp4"/u);
  assert.match(capturedInputPayload, /"videoId":"7592547346870620763"/u);
});

test('runDouyinAction retries transient direct video pre-resolution failures once', async () => {
  let attempts = 0;
  const result = await runDouyinAction({
    action: 'download',
    items: ['https://www.douyin.com/video/7592547346870620763'],
    reuseLoginState: true,
    profilePath: 'profiles/www.douyin.com.json',
    download: {
      dryRun: false,
      maxItems: 1,
    },
  }, {
    async resolveSiteBrowserSessionOptions() {
      return {
        reuseLoginState: true,
        userDataDir: 'C:/profiles/douyin.com',
        authProfile: { filePath: 'profiles/www.douyin.com.json' },
      };
    },
    async inspectPersistentProfileHealth() {
      return {
        usableForCookies: true,
      };
    },
    async resolveDouyinMediaBatch() {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('CDP timeout for Runtime.evaluate');
      }
      return {
        results: [
          {
            requestedUrl: 'https://www.douyin.com/video/7592547346870620763',
            videoId: '7592547346870620763',
            resolved: true,
            bestUrl: 'https://v26-web.douyinvod.com/example/direct.mp4',
            title: 'Direct Video',
            bestFormat: { formatId: '1080p' },
            formats: [{ formatId: '1080p', url: 'https://v26-web.douyinvod.com/example/direct.mp4' }],
            headers: { Referer: 'https://www.douyin.com/video/7592547346870620763' },
          },
        ],
      };
    },
    async spawnJsonCommand() {
      return {
        code: 0,
        stdout: JSON.stringify({
          summary: { total: 1, successful: 0, failed: 0, planned: 1 },
        }),
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(attempts, 2);
  assert.equal(result.mediaResolution?.retryCount, 1);
});

test('runDouyinAction skips media pre-resolution for dry-run direct inputs', async () => {
  let resolveCalls = 0;
  let capturedInputPayload = null;
  const result = await runDouyinAction({
    action: 'download',
    items: ['https://www.douyin.com/video/7592547346870620763'],
    reuseLoginState: true,
    profilePath: 'profiles/www.douyin.com.json',
    download: {
      dryRun: true,
      maxItems: 1,
    },
  }, {
    async resolveSiteBrowserSessionOptions() {
      return {
        reuseLoginState: true,
        userDataDir: 'C:/profiles/douyin.com',
        authProfile: { filePath: 'profiles/www.douyin.com.json' },
      };
    },
    async inspectPersistentProfileHealth() {
      return {
        usableForCookies: true,
      };
    },
    async resolveDouyinMediaBatch() {
      resolveCalls += 1;
      throw new Error('dry-run should not call media resolver');
    },
    async spawnJsonCommand(_command, args) {
      const index = args.indexOf('--input-file');
      const inputFile = index >= 0 ? args[index + 1] : null;
      capturedInputPayload = inputFile ? await readFile(inputFile, 'utf8') : null;
      return {
        code: 0,
        stdout: JSON.stringify({
          summary: { total: 1, successful: 0, failed: 0, planned: 1 },
        }),
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(resolveCalls, 0);
  assert.equal(result.mediaResolution?.skipped, true);
  assert.equal(result.mediaResolution?.attemptedCount, 0);
  assert.match(String(capturedInputPayload), /https:\/\/www\.douyin\.com\/video\/7592547346870620763/u);
});

test('runDouyinAction retries transient author enumeration failures once', async () => {
  let attempts = 0;
  const result = await runDouyinAction({
    action: 'download',
    items: ['https://www.douyin.com/user/MS4wLjABAAAAexample?showTab=post'],
    reuseLoginState: true,
    profilePath: 'profiles/www.douyin.com.json',
    download: {
      dryRun: true,
      maxItems: 1,
    },
  }, {
    async resolveSiteBrowserSessionOptions() {
      return {
        reuseLoginState: true,
        userDataDir: 'C:/profiles/douyin.com',
        authProfile: { filePath: 'profiles/www.douyin.com.json' },
      };
    },
    async inspectPersistentProfileHealth() {
      return {
        usableForCookies: true,
      };
    },
    async enumerateDouyinAuthorVideos() {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('CDP socket closed: 1006');
      }
      return {
        result: {
          videos: [
            { url: 'https://www.douyin.com/video/111', videoId: '111' },
          ],
        },
      };
    },
    async resolveDouyinMediaBatch() {
      return {
        results: [
          {
            requestedUrl: 'https://www.douyin.com/video/111',
            videoId: '111',
            resolved: true,
            bestUrl: 'https://v26-web.douyinvod.com/example/111.mp4',
            title: 'Recovered Author Video',
            bestFormat: { formatId: '1080p' },
            formats: [{ formatId: '1080p', url: 'https://v26-web.douyinvod.com/example/111.mp4' }],
            headers: { Referer: 'https://www.douyin.com/video/111' },
          },
        ],
      };
    },
    async spawnJsonCommand() {
      return {
        code: 0,
        stdout: JSON.stringify({
          summary: { total: 1, successful: 0, failed: 0, planned: 1 },
        }),
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(attempts, 2);
});
