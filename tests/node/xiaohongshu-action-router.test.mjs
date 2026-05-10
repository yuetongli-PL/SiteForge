import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import {
  buildXiaohongshuActionRequest,
  parseXiaohongshuActionArgs,
  runXiaohongshuActionCli,
  xiaohongshuActionCliJson,
  xiaohongshuActionCliMarkdown,
  XIAOHONGSHU_ACTION_HELP,
} from '../../src/entrypoints/sites/xiaohongshu-action.mjs';
import { readJsonFile } from '../../src/infra/io.mjs';
import {
  classifyXiaohongshuDownloadInput,
  resolveXiaohongshuFreshEvidence,
  runXiaohongshuAction,
} from '../../src/sites/xiaohongshu/actions/router.mjs';
import { reasonCodeSummary } from '../../src/sites/capability/reason-codes.mjs';

function createHtmlResponse(url, html, responseUrl = url) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    url: responseUrl,
    async text() {
      return html;
    },
  };
}

function buildInitialStateHtml(initialState) {
  return `<script>window.__INITIAL_STATE__=${JSON.stringify(initialState)}</script>`;
}

function buildSearchHtml() {
  return buildInitialStateHtml({
    search: {
      searchContext: {
        keyword: 'outfit',
        page: 1,
        pageSize: 20,
      },
      currentSearchType: 'all',
      feeds: [
        {
          id: 'feed-video',
          noteCard: {
            noteId: 'note-video',
            displayTitle: 'Video Note',
            desc: 'moving outfit clip',
            type: 'video',
            user: {
              userId: 'user-video',
              nickname: 'Video Author',
            },
            tagList: [{ name: 'video' }],
          },
        },
        {
          id: 'feed-image',
          noteCard: {
            noteId: 'note-image',
            displayTitle: 'Image Note',
            desc: 'commute outfit moodboard',
            type: 'normal',
            user: {
              userId: 'user-image',
              nickname: 'Image Author',
            },
            tagList: [{ name: 'outfit' }, { name: 'commute' }],
            imageList: [{ urlDefault: '//ci.xiaohongshu.com/img-1-default.webp' }],
          },
        },
      ],
    },
  });
}

function buildAuthorHtml({ page = 1, hasMore = false, notes = [] } = {}) {
  return buildInitialStateHtml({
    user: {
      userPageData: {
        basicInfo: {
          nickname: 'Image Author',
          desc: 'Posts image-first notes only',
          redId: 'red-image',
        },
      },
      notes,
      notesPageInfo: {
        page,
        hasMore,
      },
    },
  });
}

function buildAuthorNote(noteId, {
  title,
  type = 'normal',
  imageCount = 1,
  xsecToken = null,
} = {}) {
  return {
    noteCard: {
      noteId,
      displayTitle: title,
      desc: `${title} summary`,
      type,
      xsecToken,
      user: {
        userId: 'user-image',
        nickname: 'Image Author',
      },
      imageList: imageCount > 0 ? Array.from({ length: imageCount }, (_value, index) => ({
        urlDefault: `//ci.xiaohongshu.com/${noteId}-${index + 1}.webp`,
      })) : [],
      tagList: [{ name: 'outfit' }],
    },
  };
}

function buildVideoNoteHtml(noteId = 'note-video') {
  return buildInitialStateHtml({
    note: {
      noteDetailMap: {
        [noteId]: {
          note: {
            noteId,
            title: 'Video Note',
            desc: 'This should not be selected for image download.',
            type: 'video',
            time: 1776450600,
            user: {
              userId: 'user-video',
              nickname: 'Video Author',
            },
          },
        },
      },
    },
  });
}

function buildImageNoteHtml(noteId = 'note-image', title = 'Image Note') {
  return buildInitialStateHtml({
    note: {
      noteDetailMap: {
        [noteId]: {
          note: {
            noteId,
            title,
            desc: 'Weekly commute image bundle',
            type: 'normal',
            time: 1776450600,
            user: {
              userId: 'user-image',
              nickname: 'Image Author',
              redId: 'red-image',
            },
            tagList: [
              { name: 'outfit' },
              { name: 'commute' },
            ],
            imageList: [
              {
                traceId: `${noteId}-img-1`,
                width: 1080,
                height: 1440,
                urlDefault: `//ci.xiaohongshu.com/${noteId}-default.webp`,
                urlPre: `//ci.xiaohongshu.com/${noteId}-preview.webp`,
                infoList: [
                  { url: `//ci.xiaohongshu.com/${noteId}-preview.webp`, imageScene: 'WB_PRV' },
                  { url: `//ci.xiaohongshu.com/${noteId}-default.webp`, imageScene: 'WB_DFT' },
                ],
              },
            ],
          },
        },
      },
    },
  });
}

test('classifyXiaohongshuDownloadInput recognizes note, author, search, and free-text inputs', () => {
  assert.equal(
    classifyXiaohongshuDownloadInput('https://www.xiaohongshu.com/explore/662233445566778899aabbcc').inputKind,
    'note-detail',
  );
  assert.equal(
    classifyXiaohongshuDownloadInput('https://www.xiaohongshu.com/user/profile/5acc62a7e8ac2b04829875e1').inputKind,
    'author-note-list',
  );
  assert.equal(
    classifyXiaohongshuDownloadInput('https://www.xiaohongshu.com/search_result?keyword=outfit').inputKind,
    'search-results',
  );
  assert.equal(classifyXiaohongshuDownloadInput('outfit').inputKind, 'search-query');
});

test('parseXiaohongshuActionArgs accepts followed-user batch download flags', () => {
  const parsed = parseXiaohongshuActionArgs([
    'download',
    '--followed-users',
    '--followed-user-limit', '6',
    '--max-items', '30',
    '--author-page-limit', '5',
    '--no-headless',
    '--reuse-login-state',
    '--session-manifest', 'runs/session/xiaohongshu/manifest.json',
  ]);

  assert.equal(parsed.action, 'download');
  assert.deepEqual(parsed.items, []);
  assert.equal(parsed.followedUsers, true);
  assert.equal(parsed.followedUserLimit, 6);
  assert.equal(parsed.download.maxItems, 30);
  assert.equal(parsed.download.authorPageLimit, 5);
  assert.equal(parsed.headless, false);
  assert.equal(parsed.reuseLoginState, true);
  assert.equal(parsed.sessionManifest, 'runs/session/xiaohongshu/manifest.json');
});

test('runXiaohongshuActionCli help exposes unified session flags without running actions', async () => {
  let output = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk, ...args) => {
    output += String(chunk);
    const callback = args.find((arg) => typeof arg === 'function');
    callback?.();
    return true;
  };
  try {
    const result = await runXiaohongshuActionCli(['--help']);

    assert.deepEqual(result, { help: XIAOHONGSHU_ACTION_HELP });
    assert.match(output, /--session-manifest <path>/u);
    assert.match(output, /--session-health-plan/u);
    assert.match(output, /--no-session-health-plan/u);
    assert.match(output, /--followed-users/u);
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('Xiaohongshu action CLI JSON output redacts sensitive diagnostics', () => {
  const output = xiaohongshuActionCliJson({
    ok: false,
    authHealth: {
      headers: {
        authorization: 'Bearer synthetic-xhs-cli-json-auth',
        cookie: 'web_session=synthetic-xhs-cli-json-cookie',
      },
      csrfToken: 'synthetic-xhs-cli-json-csrf',
    },
    runtimeRisk: {
      details: 'refresh_token=synthetic-xhs-cli-json-refresh',
    },
  });

  assert.doesNotMatch(
    output,
    /synthetic-xhs-cli-json-|web_session=|refresh_token=|Bearer/iu,
  );
  const parsed = JSON.parse(output);
  assert.equal(parsed.authHealth.headers.authorization, '[REDACTED]');
  assert.equal(parsed.authHealth.headers.cookie, '[REDACTED]');
  assert.equal(parsed.authHealth.csrfToken, '[REDACTED]');
  assert.equal(parsed.runtimeRisk.details, '[REDACTED]');
});

test('Xiaohongshu action CLI Markdown output redacts sensitive diagnostics and fallback JSON', () => {
  const markdown = xiaohongshuActionCliMarkdown([
    '# Xiaohongshu Download Action',
    'Authorization: Bearer synthetic-xhs-cli-markdown-auth',
    'csrf=synthetic-xhs-cli-markdown-csrf',
  ].join('\n'));
  assert.doesNotMatch(
    markdown,
    /synthetic-xhs-cli-markdown-|Authorization: Bearer|csrf=/iu,
  );
  assert.match(markdown, /\[REDACTED\]/u);

  const fallback = xiaohongshuActionCliMarkdown('', {
    ok: false,
    headers: {
      authorization: 'Bearer synthetic-xhs-cli-fallback-auth',
    },
  });
  assert.doesNotMatch(fallback, /synthetic-xhs-cli-fallback-|Bearer/iu);
  assert.equal(JSON.parse(fallback).headers.authorization, '[REDACTED]');
});

test('Xiaohongshu action CLI output fails closed without raw cause exposure', () => {
  const recovery = reasonCodeSummary('redaction-failed');
  const payload = {
    toJSON() {
      throw new Error(
        'Authorization: Bearer synthetic-xhs-cli-cause-token csrf=synthetic-xhs-cli-cause-csrf',
      );
    },
  };

  assert.throws(
    () => xiaohongshuActionCliJson(payload),
    (error) => {
      assert.equal(error.name, 'XiaohongshuActionCliOutputRedactionFailure');
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
        /synthetic-xhs-cli-cause-|Authorization: Bearer|csrf=/iu,
      );
      return true;
    },
  );
});

test('buildXiaohongshuActionRequest carries unified session manifest options into router request', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'xiaohongshu-session-manifest-'));
  try {
    const manifestPath = path.join(tempDir, 'manifest.json');
    await writeFile(manifestPath, `${JSON.stringify({
      schemaVersion: 1,
      runId: 'xiaohongshu-session-test',
      siteKey: 'xiaohongshu',
      host: 'www.xiaohongshu.com',
      purpose: 'followed',
      status: 'blocked',
      reason: 'session-invalid',
      health: {
        status: 'blocked',
        reason: 'session-invalid',
        authStatus: 'unknown',
        riskCauseCode: 'session-invalid',
        riskAction: 'manual-login-required',
      },
      repairPlan: {
        actions: [{
          kind: 'site-login',
          command: 'node src/entrypoints/sites/site-login.mjs --site xiaohongshu',
        }],
      },
      artifacts: {},
    }, null, 2)}\n`, 'utf8');
    const parsed = parseXiaohongshuActionArgs([
      'download',
      '--followed-users',
      '--session-manifest',
      manifestPath,
      '--session-health-plan',
    ]);

    const request = await buildXiaohongshuActionRequest(parsed);

    assert.equal(request.followedUsers, true);
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

test('runXiaohongshuAction blocks followed-users when unified session manifest is unhealthy', async () => {
  const result = await runXiaohongshuAction({
    action: 'download',
    items: [],
    followedUsers: true,
    sessionManifest: 'runs/session/xiaohongshu/manifest.json',
    sessionStatus: 'blocked',
    sessionReason: 'session-invalid',
    sessionHealthManifest: {
      healthStatus: 'blocked',
      reason: 'session-invalid',
      riskCauseCode: 'session-invalid',
      repairPlan: {
        actions: [{ kind: 'site-login' }],
      },
    },
    download: {
      dryRun: true,
    },
  }, {
    async queryXiaohongshuFollow() {
      assert.fail('follow query should not run after unhealthy session gate');
    },
    async fetchImpl() {
      assert.fail('fetch should not run after unhealthy session gate');
    },
    async spawnJsonCommand() {
      assert.fail('download subprocess should not run after unhealthy session gate');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, 'session-unhealthy');
  assert.equal(result.sessionGate.status, 'blocked');
  assert.equal(result.sessionGate.reason, 'session-invalid');
  assert.equal(result.downloadSession.status, 'blocked');
  assert.equal(result.resolution.followedUsersRequested, true);
  assert.equal(result.resolution.followedUsersStatus, 'blocked');
});

test('runXiaohongshuAction blocks generated unhealthy followed-users session health before follow query', async () => {
  const result = await runXiaohongshuAction({
    action: 'download',
    items: [],
    followedUsers: true,
    useUnifiedSessionHealth: true,
    download: {
      dryRun: true,
    },
  }, {
    async runSessionTask() {
      return {
        manifest: {
          plan: {
            siteKey: 'xiaohongshu',
            host: 'www.xiaohongshu.com',
            purpose: 'followed',
            sessionRequirement: 'required',
          },
          health: {
            status: 'blocked',
            reason: 'session-invalid',
            riskCauseCode: 'session-invalid',
          },
          repairPlan: {
            action: 'site-login',
            command: 'site-login',
            reason: 'session-invalid',
            requiresApproval: true,
          },
          artifacts: {
            manifest: 'runs/session/xiaohongshu/generated/manifest.json',
            runDir: 'runs/session/xiaohongshu/generated',
          },
        },
      };
    },
    async queryXiaohongshuFollow() {
      assert.fail('follow query should not run after generated unhealthy session gate');
    },
    async fetchImpl() {
      assert.fail('fetch should not run after generated unhealthy session gate');
    },
    async spawnJsonCommand() {
      assert.fail('download subprocess should not run after generated unhealthy session gate');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, 'session-unhealthy');
  assert.equal(result.sessionGate.status, 'blocked');
  assert.equal(result.sessionGate.reason, 'session-invalid');
  assert.equal(result.sessionGate.provider, 'unified-session-runner');
  assert.equal(result.resolution.followedUsersStatus, 'blocked');
});

test('runXiaohongshuAction resolves a search query into image-note bundles and scans past video candidates', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.xiaohongshu.com.json'));
  let capturedArgs = null;
  let capturedPayload = null;
  const fetchMap = new Map([
    ['https://www.xiaohongshu.com/search_result?keyword=outfit', buildSearchHtml()],
    ['https://www.xiaohongshu.com/explore/note-video', buildVideoNoteHtml('note-video')],
    ['https://www.xiaohongshu.com/explore/note-image', buildImageNoteHtml('note-image')],
  ]);

  const result = await runXiaohongshuAction({
    action: 'download',
    items: ['outfit'],
    profilePath: path.resolve('profiles/www.xiaohongshu.com.json'),
    timeoutMs: 45_000,
    reuseLoginState: false,
    useUnifiedSessionHealth: true,
    sessionStatus: 'blocked',
    sessionReason: 'session-invalid',
    download: {
      dryRun: true,
      maxItems: 1,
    },
  }, {
    siteProfile,
    async runSessionTask() {
      assert.fail('public search downloads should not generate a session health plan');
    },
    async fetchImpl(url) {
      const html = fetchMap.get(String(url));
      assert.ok(html, `unexpected fetch url: ${url}`);
      return createHtmlResponse(String(url), html);
    },
    async spawnJsonCommand(_command, args) {
      capturedArgs = args;
      const inputFile = args[args.indexOf('--input-file') + 1];
      capturedPayload = JSON.parse(await readFile(inputFile, 'utf8'));
      return {
        code: 0,
        stdout: JSON.stringify({
          runDir: 'C:/tmp/xiaohongshu-download',
          summary: { total: 1, successful: 0, partial: 0, failed: 0, planned: 1 },
          reportMarkdown: '# Xiaohongshu Download Action\n',
          warnings: [],
        }),
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.reasonCode, 'download-started');
  assert.equal(result.resolution.resolvedNotes, 1);
  assert.equal(result.resolution.skippedVideoNotes, 0);
  assert.equal(result.downloadSession?.status, 'reuse-disabled');
  assert.deepEqual(result.resolvedInputs, ['https://www.xiaohongshu.com/explore/note-image']);
  assert.match(String(capturedArgs?.[0] ?? '').replace(/\\/gu, '/'), /\/src\/sites\/xiaohongshu\/download\/python\/xiaohongshu\.py$/u);
  assert.equal(capturedPayload.length, 1);
  assert.equal(capturedPayload[0].noteId, 'note-image');
  assert.equal(capturedPayload[0].title, 'Image Note');
  assert.equal(capturedPayload[0].bodyText, 'Weekly commute image bundle');
  assert.equal(capturedPayload[0].queryText, 'outfit');
  assert.equal(capturedPayload[0].sourceType, 'search-initial-state');
  assert.equal(capturedPayload[0].downloadBundle.assets[0].url, 'https://ci.xiaohongshu.com/note-image-default.webp');
  assert.equal(capturedPayload[0].downloadBundle.assets[0].previewUrl, 'https://ci.xiaohongshu.com/note-image-preview.webp');
  assert.equal(capturedPayload[0].downloadBundle.assets[0].headers.Referer, 'https://www.xiaohongshu.com/explore/note-image');
});

test('runXiaohongshuAction expands followed users into author-page image-note downloads', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.xiaohongshu.com.json'));
  let capturedPayload = null;
  let capturedFollowOptions = null;
  let sessionHealthRequested = false;
  const outDir = path.join(os.tmpdir(), 'bwk-xiaohongshu-session-plan-ready');
  const sessionRunDir = path.join(outDir, 'session-health');
  const sessionManifest = path.join(sessionRunDir, 'manifest.json');
  const alphaUrl = 'https://www.xiaohongshu.com/user/profile/u-1';
  const betaUrl = 'https://www.xiaohongshu.com/user/profile/u-2';
  const fetchMap = new Map([
    [alphaUrl, buildAuthorHtml({
      page: 1,
      hasMore: false,
      notes: [[
        buildAuthorNote('note-alpha-1', { title: 'Alpha Image Note', type: 'normal', imageCount: 2 }),
      ]],
    })],
    [betaUrl, buildAuthorHtml({
      page: 1,
      hasMore: false,
      notes: [[
        buildAuthorNote('note-beta-1', { title: 'Beta Image Note', type: 'normal', imageCount: 1 }),
      ]],
    })],
    ['https://www.xiaohongshu.com/explore/note-alpha-1', buildImageNoteHtml('note-alpha-1', 'Alpha Image Note')],
    ['https://www.xiaohongshu.com/explore/note-beta-1', buildImageNoteHtml('note-beta-1', 'Beta Image Note')],
  ]);

  const result = await runXiaohongshuAction({
    action: 'download',
    items: [],
    followedUsers: true,
    followedUserLimit: 2,
    profilePath: path.resolve('profiles/www.xiaohongshu.com.json'),
    outDir,
    useUnifiedSessionHealth: true,
    reuseLoginState: false,
    download: {
      dryRun: true,
      maxItems: 2,
      authorPageLimit: 2,
    },
  }, {
    siteProfile,
    async runSessionTask(request) {
      sessionHealthRequested = true;
      assert.equal(request.site, 'xiaohongshu');
      assert.equal(request.host, 'www.xiaohongshu.com');
      assert.equal(request.purpose, 'followed');
      assert.equal(request.sessionRequirement, 'required');
      assert.equal(request.runDir, sessionRunDir);
      return {
        manifest: {
          plan: {
            siteKey: 'xiaohongshu',
            host: 'www.xiaohongshu.com',
            purpose: 'followed',
            sessionRequirement: 'required',
          },
          health: {
            status: 'ready',
            authStatus: 'authenticated',
            identityConfirmed: true,
          },
          artifacts: {
            manifest: sessionManifest,
            runDir: sessionRunDir,
          },
        },
      };
    },
    async queryXiaohongshuFollow(inputUrl, options) {
      capturedFollowOptions = { inputUrl, options };
      return {
        auth: { status: 'authenticated' },
        result: {
          queryType: 'list-followed-users',
          status: 'success',
          reasonCode: null,
          users: [
            { name: 'Alpha', userId: 'u-1', redId: 'red-1', url: alphaUrl },
            { name: 'Beta', userId: 'u-2', redId: 'red-2', url: betaUrl },
          ],
          matchedUsers: 2,
          totalFollowedUsers: 2,
          scannedUsers: 2,
          followedUsersSource: 'official-api-intimacy-list',
          errors: [],
        },
        warnings: [],
      };
    },
    async fetchImpl(url) {
      const html = fetchMap.get(String(url));
      assert.ok(html, `unexpected fetch url: ${url}`);
      return createHtmlResponse(String(url), html);
    },
    async spawnJsonCommand(_command, args) {
      const inputFile = args[args.indexOf('--input-file') + 1];
      capturedPayload = JSON.parse(await readFile(inputFile, 'utf8'));
      return {
        code: 0,
        stdout: JSON.stringify({
          runDir: 'C:/tmp/xiaohongshu-download',
          summary: { total: 2, successful: 0, partial: 0, failed: 0, planned: 2 },
          reportMarkdown: '# Xiaohongshu Download Action\n',
          warnings: [],
        }),
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.reasonCode, 'download-started');
  assert.equal(sessionHealthRequested, true);
  assert.equal(capturedFollowOptions?.options?.intent, 'list-followed-users');
  assert.equal(capturedFollowOptions?.options?.limit, 2);
  assert.equal(result.resolution.followedUsersRequested, true);
  assert.equal(result.resolution.followedUsersStatus, 'success');
  assert.equal(result.resolution.followedUsersMatched, 2);
  assert.equal(result.resolution.followedUsersExpanded, 2);
  assert.deepEqual(result.resolution.followedUserUrls, [alphaUrl, betaUrl]);
  assert.equal(result.resolution.inputKinds['author-note-list'], 2);
  assert.equal(result.resolution.resolvedNotes, 2);
  assert.deepEqual(
    [...result.resolvedInputs].sort(),
    [
      'https://www.xiaohongshu.com/explore/note-alpha-1',
      'https://www.xiaohongshu.com/explore/note-beta-1',
    ],
  );
  assert.equal(capturedPayload.length, 2);
  assert.deepEqual(
    [...capturedPayload.map((entry) => entry.noteId)].sort(),
    ['note-alpha-1', 'note-beta-1'],
  );
});

test('runXiaohongshuAction collects author notes across continuation pages before downloading image notes', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.xiaohongshu.com.json'));
  let capturedPayload = null;
  const authorUrl = 'https://www.xiaohongshu.com/user/profile/user-image';
  const fetchMap = new Map([
    [authorUrl, buildAuthorHtml({
      page: 1,
      hasMore: true,
      notes: [[
        buildAuthorNote('note-video', { title: 'Video Note', type: 'video', imageCount: 0 }),
        buildAuthorNote('note-image-1', { title: 'Image Note One', type: 'normal', imageCount: 1 }),
      ]],
    })],
    [`${authorUrl}?page=2`, buildAuthorHtml({
      page: 2,
      hasMore: false,
      notes: [[
        buildAuthorNote('note-image-2', { title: 'Image Note Two', type: 'normal', imageCount: 1 }),
      ]],
    })],
    ['https://www.xiaohongshu.com/explore/note-video', buildVideoNoteHtml('note-video')],
    ['https://www.xiaohongshu.com/explore/note-image-1', buildImageNoteHtml('note-image-1', 'Image Note One')],
    ['https://www.xiaohongshu.com/explore/note-image-2', buildImageNoteHtml('note-image-2', 'Image Note Two')],
  ]);

  const result = await runXiaohongshuAction({
    action: 'download',
    items: [authorUrl],
    profilePath: path.resolve('profiles/www.xiaohongshu.com.json'),
    reuseLoginState: false,
    download: {
      dryRun: true,
      maxItems: 2,
      authorPageLimit: 3,
    },
  }, {
    siteProfile,
    async fetchImpl(url) {
      const html = fetchMap.get(String(url));
      assert.ok(html, `unexpected fetch url: ${url}`);
      return createHtmlResponse(String(url), html);
    },
    async spawnJsonCommand(_command, args) {
      const inputFile = args[args.indexOf('--input-file') + 1];
      capturedPayload = JSON.parse(await readFile(inputFile, 'utf8'));
      return {
        code: 0,
        stdout: JSON.stringify({
          runDir: 'C:/tmp/xiaohongshu-download',
          summary: { total: 2, successful: 0, partial: 0, failed: 0, planned: 2 },
          reportMarkdown: '# Xiaohongshu Download Action\n',
          warnings: [],
        }),
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.resolution.inputKinds['author-note-list'], 1);
  assert.equal(result.resolution.attemptedPages, 2);
  assert.equal(result.resolution.resolvedNotes, 2);
  assert.deepEqual(
    [...result.resolvedInputs].sort(),
    [
      'https://www.xiaohongshu.com/explore/note-image-1',
      'https://www.xiaohongshu.com/explore/note-image-2',
    ],
  );
  assert.equal(capturedPayload.length, 2);
  assert.equal(capturedPayload[0].authorName, 'Image Author');
  assert.equal(capturedPayload[0].authorUserId, 'user-image');
  assert.deepEqual(
    [...capturedPayload.map((entry) => entry.noteId)].sort(),
    ['note-image-1', 'note-image-2'],
  );
  assert.equal(result.resolution.authorContinuations.length, 1);
  assert.equal(result.resolution.authorContinuations[0].exhausted, true);
  assert.deepEqual(result.resolution.authorResumeStates, []);
});

test('runXiaohongshuAction emits author resume state and accepts it to continue from the next page', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.xiaohongshu.com.json'));
  const authorUrl = 'https://www.xiaohongshu.com/user/profile/user-image';

  const firstRun = await runXiaohongshuAction({
    action: 'download',
    items: [authorUrl],
    profilePath: path.resolve('profiles/www.xiaohongshu.com.json'),
    reuseLoginState: false,
    download: {
      dryRun: true,
      maxItems: 1,
      authorPageLimit: 1,
    },
  }, {
    siteProfile,
    async fetchImpl(url) {
      if (String(url) === authorUrl) {
        return createHtmlResponse(String(url), buildAuthorHtml({
          page: 1,
          hasMore: true,
          notes: [[
            buildAuthorNote('note-image-1', { title: 'Image Note One', type: 'normal', imageCount: 1 }),
          ]],
        }));
      }
      if (String(url) === 'https://www.xiaohongshu.com/explore/note-image-1') {
        return createHtmlResponse(String(url), buildImageNoteHtml('note-image-1', 'Image Note One'));
      }
      assert.fail(`unexpected fetch url: ${url}`);
    },
    async spawnJsonCommand(_command, args) {
      const inputFile = args[args.indexOf('--input-file') + 1];
      const payload = JSON.parse(await readFile(inputFile, 'utf8'));
      return {
        code: 0,
        stdout: JSON.stringify({
          runDir: 'C:/tmp/xiaohongshu-download',
          summary: { total: payload.length, successful: 0, partial: 0, failed: 0, planned: payload.length },
          reportMarkdown: '# Xiaohongshu Download Action\n',
          warnings: [],
        }),
        stderr: '',
      };
    },
  });

  assert.equal(firstRun.ok, true);
  assert.equal(firstRun.resolution.authorResumeStates.length, 1);
  assert.equal(firstRun.resolution.authorContinuations[0].resumeApplied, false);
  assert.equal(firstRun.resolution.authorContinuations[0].exhausted, false);
  assert.equal(firstRun.resolution.authorResumeStates[0].page, 2);
  assert.deepEqual(firstRun.resolution.authorResumeStates[0].seenNoteIds, ['note-image-1']);

  const secondRun = await runXiaohongshuAction({
    action: 'download',
    items: [authorUrl],
    profilePath: path.resolve('profiles/www.xiaohongshu.com.json'),
    reuseLoginState: false,
    download: {
      dryRun: true,
      maxItems: 1,
      authorPageLimit: 2,
      authorResumeState: firstRun.resolution.authorResumeStates[0],
    },
  }, {
    siteProfile,
    async fetchImpl(url) {
      if (String(url) === `${authorUrl}?page=2`) {
        return createHtmlResponse(String(url), buildAuthorHtml({
          page: 2,
          hasMore: false,
          notes: [[
            buildAuthorNote('note-image-2', { title: 'Image Note Two', type: 'normal', imageCount: 1 }),
          ]],
        }));
      }
      if (String(url) === 'https://www.xiaohongshu.com/explore/note-image-2') {
        return createHtmlResponse(String(url), buildImageNoteHtml('note-image-2', 'Image Note Two'));
      }
      assert.fail(`unexpected resumed fetch url: ${url}`);
    },
    async spawnJsonCommand(_command, args) {
      const inputFile = args[args.indexOf('--input-file') + 1];
      const payload = JSON.parse(await readFile(inputFile, 'utf8'));
      return {
        code: 0,
        stdout: JSON.stringify({
          runDir: 'C:/tmp/xiaohongshu-download',
          summary: { total: payload.length, successful: 0, partial: 0, failed: 0, planned: payload.length },
          reportMarkdown: '# Xiaohongshu Download Action\n',
          warnings: [],
        }),
        stderr: '',
      };
    },
  });

  assert.equal(secondRun.ok, true);
  assert.equal(secondRun.resolution.authorContinuations[0].resumeApplied, true);
  assert.equal(secondRun.resolution.authorContinuations[0].attemptedPages, 1);
  assert.deepEqual(secondRun.resolvedInputs, ['https://www.xiaohongshu.com/explore/note-image-2']);
});

test('runXiaohongshuAction synthesizes tokenized note navigation for author cards before resolving image notes', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.xiaohongshu.com.json'));
  let capturedPayload = null;
  const authorUrl = 'https://www.xiaohongshu.com/user/profile/user-image';
  const tokenizedNoteUrl = 'https://www.xiaohongshu.com/explore/note-image-1?xsec_token=token-author-1&xsec_source=pc_user';

  const result = await runXiaohongshuAction({
    action: 'download',
    items: [authorUrl],
    profilePath: path.resolve('profiles/www.xiaohongshu.com.json'),
    reuseLoginState: false,
    download: {
      dryRun: true,
      maxItems: 1,
      authorPageLimit: 1,
    },
  }, {
    siteProfile,
    async fetchImpl(url) {
      if (String(url) === authorUrl) {
        return createHtmlResponse(String(url), buildAuthorHtml({
          page: 1,
          hasMore: false,
          notes: [[
            buildAuthorNote('note-image-1', {
              title: 'Image Note One',
              type: 'normal',
              imageCount: 1,
              xsecToken: 'token-author-1',
            }),
          ]],
        }));
      }
      if (String(url) === tokenizedNoteUrl) {
        return createHtmlResponse(String(url), buildImageNoteHtml('note-image-1', 'Image Note One'));
      }
      assert.fail(`unexpected fetch url: ${url}`);
    },
    async spawnJsonCommand(_command, args) {
      const inputFile = args[args.indexOf('--input-file') + 1];
      capturedPayload = JSON.parse(await readFile(inputFile, 'utf8'));
      return {
        code: 0,
        stdout: JSON.stringify({
          runDir: 'C:/tmp/xiaohongshu-download',
          summary: { total: 1, successful: 0, partial: 0, failed: 0, planned: 1 },
          reportMarkdown: '# Xiaohongshu Download Action\n',
          warnings: [],
        }),
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.resolution.attemptedPages, 1);
  assert.equal(result.resolution.resolvedNotes, 1);
  assert.equal(result.resolution.skippedNoImageNotes, 0);
  assert.equal(result.resolution.failedNotes, 0);
  assert.deepEqual(result.resolvedInputs, ['https://www.xiaohongshu.com/explore/note-image-1']);
  assert.equal(capturedPayload.length, 1);
  assert.equal(capturedPayload[0].noteId, 'note-image-1');
  assert.equal(capturedPayload[0].downloadBundle.assets[0].url, 'https://ci.xiaohongshu.com/note-image-1-default.webp');
});

test('runXiaohongshuAction reuses exported session headers for page fetches and download bundles', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.xiaohongshu.com.json'));
  let capturedPayload = null;
  const observedFetchHeaders = [];

  const result = await runXiaohongshuAction({
    action: 'download',
    items: ['outfit'],
    profilePath: path.resolve('profiles/www.xiaohongshu.com.json'),
    timeoutMs: 20_000,
    download: {
      dryRun: true,
      maxItems: 1,
    },
  }, {
    siteProfile,
    async inspectRequestReusableSiteSession() {
      return {
        authAvailable: true,
        userDataDir: 'C:/profiles/xiaohongshu.com',
        profileHealth: {
          healthy: true,
        },
        authConfig: {
          keepaliveUrl: 'https://www.xiaohongshu.com/notification',
          preferVisibleBrowserForAuthenticatedFlows: true,
        },
      };
    },
    async openBrowserSession() {
      return {
        client: {
          async send(method) {
            assert.equal(method, 'Storage.getCookies');
            return {
              cookies: [
                { domain: '.xiaohongshu.com', name: 'sid', value: 'abc123' },
                { domain: '.xiaohongshu.com', name: 'web_session', value: 'xyz789' },
              ],
            };
          },
        },
        browserAttachedVia: 'existing-target',
        reusedBrowserInstance: true,
        async navigateAndWait() {},
        async getPageMetadata() {
          return {
            finalUrl: 'https://www.xiaohongshu.com/notification',
          };
        },
        async evaluateValue(expression) {
          if (expression.includes('navigator.userAgent')) {
            return 'SiteForge Test UA';
          }
          if (expression.includes('navigator.languages')) {
            return 'zh-CN, en-US';
          }
          if (expression === 'document.referrer') {
            return '';
          }
          return null;
        },
        async close() {},
      };
    },
    async fetchImpl(url, options = {}) {
      observedFetchHeaders.push(options.headers ?? {});
      if (String(url) === 'https://www.xiaohongshu.com/search_result?keyword=outfit') {
        return createHtmlResponse(String(url), buildSearchHtml());
      }
      if (String(url) === 'https://www.xiaohongshu.com/explore/note-video') {
        return createHtmlResponse(String(url), buildVideoNoteHtml('note-video'));
      }
      if (String(url) === 'https://www.xiaohongshu.com/explore/note-image') {
        return createHtmlResponse(String(url), buildImageNoteHtml('note-image'));
      }
      assert.fail(`unexpected fetch url: ${url}`);
    },
    async spawnJsonCommand(_command, args) {
      const inputFile = args[args.indexOf('--input-file') + 1];
      capturedPayload = JSON.parse(await readFile(inputFile, 'utf8'));
      return {
        code: 0,
        stdout: JSON.stringify({
          runDir: 'C:/tmp/xiaohongshu-download',
          summary: { total: 1, successful: 0, partial: 0, failed: 0, planned: 1 },
          reportMarkdown: '# Xiaohongshu Download Action\n',
          warnings: [],
        }),
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.downloadSession?.status, 'session-exported');
  assert.equal(result.downloadSession?.cookieCount, 2);
  assert.equal(observedFetchHeaders.length, 2);
  assert.match(String(observedFetchHeaders[0].Cookie ?? ''), /sid=abc123/u);
  assert.equal(observedFetchHeaders[0]['User-Agent'], 'SiteForge Test UA');
  assert.equal(capturedPayload.length, 1);
  assert.match(String(capturedPayload[0].downloadBundle.headers.Cookie ?? ''), /web_session=xyz789/u);
  assert.equal(capturedPayload[0].downloadBundle.assets[0].headers['User-Agent'], 'SiteForge Test UA');
  assert.equal(capturedPayload[0].downloadBundle.assets[0].headers.Referer, 'https://www.xiaohongshu.com/explore/note-image');
});

test('resolveXiaohongshuFreshEvidence emits sanitized page facts and resource seeds from a reusable session', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.xiaohongshu.com.json'));
  const noteUrl = 'https://www.xiaohongshu.com/explore/note-image';
  let observedFetchHeaders = null;

  const evidence = await resolveXiaohongshuFreshEvidence(noteUrl, {
    request: {
      profilePath: path.resolve('profiles/www.xiaohongshu.com.json'),
      timeoutMs: 20_000,
      download: {
        dryRun: true,
        maxItems: 1,
      },
    },
  }, {
    siteProfile,
    async inspectRequestReusableSiteSession() {
      return {
        authAvailable: true,
        userDataDir: 'C:/profiles/xiaohongshu.com',
        profileHealth: { healthy: true },
        authConfig: {
          keepaliveUrl: 'https://www.xiaohongshu.com/notification',
          preferVisibleBrowserForAuthenticatedFlows: true,
        },
      };
    },
    async openBrowserSession() {
      return {
        client: {
          async send(method) {
            assert.equal(method, 'Storage.getCookies');
            return {
              cookies: [
                { domain: '.xiaohongshu.com', name: 'sid', value: 'fresh-cookie' },
                { domain: '.xiaohongshu.com', name: 'web_session', value: 'fresh-session' },
              ],
            };
          },
        },
        browserAttachedVia: 'existing-target',
        reusedBrowserInstance: true,
        async navigateAndWait() {},
        async getPageMetadata() {
          return { finalUrl: 'https://www.xiaohongshu.com/notification' };
        },
        async evaluateValue(expression) {
          if (expression.includes('navigator.userAgent')) {
            return 'Fresh Evidence UA';
          }
          if (expression.includes('navigator.languages')) {
            return 'zh-CN';
          }
          return '';
        },
        async close() {},
      };
    },
    async fetchImpl(url, options = {}) {
      assert.equal(String(url), noteUrl);
      observedFetchHeaders = options.headers ?? {};
      return createHtmlResponse(String(url), buildImageNoteHtml('note-image', 'Fresh Evidence Note'));
    },
  });

  assert.match(String(observedFetchHeaders?.Cookie ?? ''), /fresh-cookie/u);
  assert.equal(evidence.status, 'resource-seeds-provided');
  assert.equal(evidence.pageFacts.noteId, 'note-image');
  assert.equal(evidence.resourceSeeds.length, 1);
  assert.equal(evidence.resourceSeeds[0].url, 'https://ci.xiaohongshu.com/note-image-default.webp');
  assert.equal(evidence.resourceSeeds[0].headers['User-Agent'], 'Fresh Evidence UA');
  assert.equal(evidence.resourceSeeds[0].headers.Referer, noteUrl);
  assert.equal(Object.hasOwn(evidence.resourceSeeds[0].headers, 'Cookie'), false);
  assert.equal(evidence.headerFreshness.freshnessStatus, 'fresh-evidence-produced');
  assert.equal(evidence.resolution.downloadSession.cookieEvidence, true);
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /fresh-cookie|fresh-session|web_session|C:\/profiles|"Cookie"/u);
});

test('resolveXiaohongshuFreshEvidence falls back to browser page facts when header fetch has no note assets', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.xiaohongshu.com.json'));
  const noteUrl = 'https://www.xiaohongshu.com/explore/note-browser';
  let openCount = 0;

  const evidence = await resolveXiaohongshuFreshEvidence(noteUrl, {
    request: {
      profilePath: path.resolve('profiles/www.xiaohongshu.com.json'),
      timeoutMs: 20_000,
      headless: false,
      download: {
        dryRun: true,
        maxItems: 1,
      },
    },
  }, {
    siteProfile,
    async inspectRequestReusableSiteSession() {
      return {
        authAvailable: true,
        userDataDir: 'C:/profiles/xiaohongshu.com',
        profileHealth: { healthy: true },
        authConfig: {
          keepaliveUrl: 'https://www.xiaohongshu.com/notification',
          preferVisibleBrowserForAuthenticatedFlows: true,
        },
      };
    },
    async openBrowserSession(settings) {
      openCount += 1;
      return {
        client: {
          async send() {
            return {
              cookies: [{ domain: '.xiaohongshu.com', name: 'sid', value: 'browser-cookie' }],
            };
          },
        },
        browserAttachedVia: openCount === 1 ? 'keepalive-target' : 'note-target',
        reusedBrowserInstance: true,
        async navigateAndWait() {},
        async getPageMetadata() {
          return {
            finalUrl: settings.startupUrl,
            title: openCount === 1 ? 'Notification' : 'Browser Evidence Note',
          };
        },
        async evaluateValue(expression) {
          if (expression.includes('navigator.userAgent')) {
            return 'Browser Evidence UA';
          }
          if (expression.includes('navigator.languages')) {
            return 'zh-CN';
          }
          return '';
        },
        async callPageFunction() {
          return {
            finalUrl: noteUrl,
            title: 'Browser Evidence Note',
            pageType: 'book-detail-page',
            pageFacts: {
              noteId: 'note-browser',
              contentTitle: 'Browser Evidence Note',
              contentType: 'normal',
              authorName: 'Browser Author',
              contentImages: [{
                assetId: 'browser-image-1',
                url: 'https://ci.xiaohongshu.example.test/browser/image.webp',
                previewUrl: 'https://ci.xiaohongshu.example.test/browser/preview.webp',
                headers: {
                  Cookie: 'sid=browser-cookie',
                  'User-Agent': 'Browser Evidence UA',
                },
              }],
              contentImageCount: 1,
            },
          };
        },
        async close() {},
      };
    },
    async fetchImpl(url) {
      assert.equal(String(url), noteUrl);
      return createHtmlResponse(
        'https://www.xiaohongshu.com/404?error_code=300031&verifyMsg=',
        '<title>not found</title><script>window.__INITIAL_STATE__={}</script>',
      );
    },
  });

  assert.equal(openCount, 2);
  assert.equal(evidence.status, 'resource-seeds-provided');
  assert.equal(evidence.resourceSeeds.length, 1);
  assert.equal(evidence.resourceSeeds[0].url, 'https://ci.xiaohongshu.example.test/browser/image.webp');
  assert.equal(evidence.resourceSeeds[0].headers['User-Agent'], 'Browser Evidence UA');
  assert.equal(Object.hasOwn(evidence.resourceSeeds[0].headers, 'Cookie'), false);
  assert.equal(evidence.resolution.browserEvidence.status, 'browser-page-facts-read');
  assert.equal(JSON.stringify(evidence).includes('browser-cookie'), false);
});

test('resolveXiaohongshuFreshEvidence emits sanitized video resource seeds from browser page facts', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.xiaohongshu.com.json'));
  const noteUrl = 'https://www.xiaohongshu.com/explore/note-video-fresh?xsec_token=input-secret-xsec-token&xsec_source=pc_note';

  const evidence = await resolveXiaohongshuFreshEvidence(noteUrl, {
    request: {
      profilePath: path.resolve('profiles/www.xiaohongshu.com.json'),
      timeoutMs: 20_000,
      headless: false,
      download: {
        dryRun: true,
        maxItems: 1,
      },
    },
  }, {
    siteProfile,
    async inspectRequestReusableSiteSession() {
      return {
        authAvailable: true,
        userDataDir: 'C:/profiles/xiaohongshu.com',
        profileHealth: { healthy: true },
        authConfig: {
          keepaliveUrl: 'https://www.xiaohongshu.com/notification',
          preferVisibleBrowserForAuthenticatedFlows: true,
        },
      };
    },
    async openBrowserSession(settings) {
      return {
        client: {
          async send() {
            return {
              cookies: [{ domain: '.xiaohongshu.com', name: 'sid', value: 'video-cookie' }],
            };
          },
        },
        browserAttachedVia: 'note-target',
        reusedBrowserInstance: true,
        async navigateAndWait() {},
        async getPageMetadata() {
          return {
            finalUrl: settings.startupUrl,
            title: 'Fresh Video Note',
          };
        },
        async evaluateValue(expression) {
          if (expression.includes('navigator.userAgent')) {
            return 'Fresh Video UA';
          }
          if (expression.includes('navigator.languages')) {
            return 'zh-CN';
          }
          return '';
        },
        async callPageFunction() {
          return {
            finalUrl: noteUrl,
            title: 'Fresh Video Note',
            pageType: 'book-detail-page',
            pageFacts: {
              noteId: 'note-video-fresh',
              contentTitle: 'Fresh Video Note',
              contentType: 'video',
              authorName: 'Video Author',
              contentVideos: [{
                id: 'video-1',
                width: 1080,
                height: 1920,
                sourceUrls: [
                  'https://www.xiaohongshu.com/explore/note-video-fresh?xsec_token=secret-xsec-token&xsec_source=pc_note',
                ],
                media: {
                  stream: {
                    h264: [{
                      master_url: 'https://sns-video.example.test/fresh/video.mp4',
                    }],
                  },
                },
                headers: {
                  Cookie: 'sid=video-cookie',
                  'User-Agent': 'Fresh Video UA',
                },
              }],
            },
          };
        },
        async close() {},
      };
    },
    async fetchImpl(url) {
      assert.equal(String(url), noteUrl);
      return createHtmlResponse(
        'https://www.xiaohongshu.com/404?error_code=300031&verifyMsg=',
        '<title>not found</title><script>window.__INITIAL_STATE__={}</script>',
      );
    },
  });

  assert.equal(evidence.status, 'resource-seeds-provided');
  assert.equal(evidence.pageFacts.contentType, 'video');
  assert.equal(evidence.pageFacts.contentVideos.length, 1);
  assert.equal(evidence.resourceSeeds.length, 1);
  assert.equal(evidence.resourceSeeds[0].mediaType, 'video');
  assert.equal(evidence.resourceSeeds[0].url, 'https://sns-video.example.test/fresh/video.mp4');
  assert.equal(evidence.resourceSeeds[0].headers['User-Agent'], 'Fresh Video UA');
  assert.equal(Object.hasOwn(evidence.resourceSeeds[0].headers, 'Cookie'), false);
  assert.equal(evidence.resourceSeeds[0].metadata.assetType, 'video');
  assert.equal(evidence.resolution.browserEvidence.status, 'browser-page-facts-read');
  assert.equal(JSON.stringify(evidence).includes('video-cookie'), false);
  assert.equal(JSON.stringify(evidence).includes('secret-xsec-token'), false);
  assert.equal(JSON.stringify(evidence).includes('input-secret-xsec-token'), false);
  assert.equal(JSON.stringify(evidence).includes('%5BREDACTED%5D'), true);
  assert.equal(JSON.stringify(evidence).includes('C:/profiles'), false);
});

test('runXiaohongshuAction consumes Xiaohongshu passthrough sidecar headers when provided via env', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.xiaohongshu.com.json'));
  let capturedPayload = null;

  const result = await runXiaohongshuAction({
    action: 'download',
    items: ['outfit'],
    profilePath: path.resolve('profiles/www.xiaohongshu.com.json'),
    download: {
      dryRun: true,
      maxItems: 1,
    },
  }, {
    env: {
      BWS_XIAOHONGSHU_DOWNLOAD_AUTH_SIDECAR: 'C:/tmp/xiaohongshu-download-auth.json',
    },
    siteProfile,
    async readJsonFile(filePath) {
      assert.equal(path.normalize(filePath), path.normalize('C:/tmp/xiaohongshu-download-auth.json'));
      return {
        ok: true,
        generatedAt: new Date().toISOString(),
        cookieCount: 2,
        userDataDir: 'C:/profiles/xiaohongshu.com',
        page: {
          url: 'https://www.xiaohongshu.com/notification',
        },
        headers: {
          Cookie: 'sid=abc123; web_session=xyz789',
          'User-Agent': 'SiteForge Sidecar UA',
          'Accept-Language': 'zh-CN, en-US',
          Referer: 'https://www.xiaohongshu.com/notification',
          Origin: 'https://www.xiaohongshu.com',
        },
      };
    },
    async fetchImpl(url, options = {}) {
      assert.match(String(options.headers?.Cookie ?? ''), /sid=abc123/u);
      if (String(url) === 'https://www.xiaohongshu.com/search_result?keyword=outfit') {
        return createHtmlResponse(String(url), buildSearchHtml());
      }
      if (String(url) === 'https://www.xiaohongshu.com/explore/note-video') {
        return createHtmlResponse(String(url), buildVideoNoteHtml('note-video'));
      }
      if (String(url) === 'https://www.xiaohongshu.com/explore/note-image') {
        return createHtmlResponse(String(url), buildImageNoteHtml('note-image'));
      }
      assert.fail(`unexpected fetch url: ${url}`);
    },
    async spawnJsonCommand(_command, args) {
      const inputFile = args[args.indexOf('--input-file') + 1];
      capturedPayload = JSON.parse(await readFile(inputFile, 'utf8'));
      return {
        code: 0,
        stdout: JSON.stringify({
          runDir: 'C:/tmp/xiaohongshu-download',
          summary: { total: 1, successful: 0, partial: 0, failed: 0, planned: 1 },
          reportMarkdown: '# Xiaohongshu Download Action\n',
          warnings: [],
        }),
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.downloadSession?.status, 'sidecar-reused');
  assert.equal(result.downloadSession?.cookieCount, 2);
  assert.equal(capturedPayload[0].downloadBundle.headers['User-Agent'], 'SiteForge Sidecar UA');
});

test('runXiaohongshuAction refreshes an expired passthrough sidecar before downloading', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.xiaohongshu.com.json'));
  let capturedPayload = null;

  const result = await runXiaohongshuAction({
    action: 'download',
    items: ['outfit'],
    profilePath: path.resolve('profiles/www.xiaohongshu.com.json'),
    download: {
      dryRun: true,
      maxItems: 1,
      sessionMaxAgeMs: 1_000,
    },
  }, {
    env: {
      BWS_XIAOHONGSHU_DOWNLOAD_AUTH_SIDECAR: 'C:/tmp/xiaohongshu-download-auth.json',
    },
    siteProfile,
    async readJsonFile(filePath) {
      assert.equal(path.normalize(filePath), path.normalize('C:/tmp/xiaohongshu-download-auth.json'));
      return {
        ok: true,
        generatedAt: '2024-01-01T00:00:00.000Z',
        cookieCount: 1,
        userDataDir: 'C:/profiles/xiaohongshu.com',
        page: {
          url: 'https://www.xiaohongshu.com/notification',
        },
        headers: {
          Cookie: 'sid=stale-cookie',
          Referer: 'https://www.xiaohongshu.com/notification',
          Origin: 'https://www.xiaohongshu.com',
        },
      };
    },
    async inspectRequestReusableSiteSession() {
      return {
        authAvailable: true,
        userDataDir: 'C:/profiles/xiaohongshu.com',
        profileHealth: { healthy: true },
        authConfig: {
          keepaliveUrl: 'https://www.xiaohongshu.com/notification',
          preferVisibleBrowserForAuthenticatedFlows: true,
        },
      };
    },
    async openBrowserSession() {
      return {
        client: {
          async send() {
            return {
              cookies: [
                { domain: '.xiaohongshu.com', name: 'sid', value: 'fresh-cookie' },
              ],
            };
          },
        },
        browserAttachedVia: 'existing-target',
        reusedBrowserInstance: true,
        async navigateAndWait() {},
        async getPageMetadata() {
          return {
            finalUrl: 'https://www.xiaohongshu.com/notification',
          };
        },
        async evaluateValue(expression) {
          if (expression.includes('navigator.userAgent')) {
            return 'Fresh Browser Session UA';
          }
          if (expression.includes('navigator.languages')) {
            return 'zh-CN';
          }
          return '';
        },
        async close() {},
      };
    },
    async fetchImpl(url, options = {}) {
      assert.match(String(options.headers?.Cookie ?? ''), /fresh-cookie/u);
      if (String(url) === 'https://www.xiaohongshu.com/search_result?keyword=outfit') {
        return createHtmlResponse(String(url), buildSearchHtml());
      }
      if (String(url) === 'https://www.xiaohongshu.com/explore/note-image') {
        return createHtmlResponse(String(url), buildImageNoteHtml('note-image'));
      }
      assert.fail(`unexpected fetch url: ${url}`);
    },
    async spawnJsonCommand(_command, args) {
      const inputFile = args[args.indexOf('--input-file') + 1];
      capturedPayload = JSON.parse(await readFile(inputFile, 'utf8'));
      return {
        code: 0,
        stdout: JSON.stringify({
          runDir: 'C:/tmp/xiaohongshu-download',
          summary: { total: 1, successful: 0, partial: 0, failed: 0, planned: 1 },
          reportMarkdown: '# Xiaohongshu Download Action\n',
          warnings: [],
        }),
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.downloadSession?.initialStatus, 'sidecar-expired');
  assert.equal(result.downloadSession?.status, 'session-exported');
  assert.equal(result.downloadSession?.previousSidecarStatus, 'sidecar-expired');
  assert.equal(result.downloadSession?.refreshAttempted, false);
  assert.equal(capturedPayload[0].downloadBundle.headers.Cookie, 'sid=fresh-cookie');
});

test('runXiaohongshuAction refreshes the download session once after an auth-page miss', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.xiaohongshu.com.json'));
  let capturedPayload = null;
  let searchFetchCount = 0;

  const result = await runXiaohongshuAction({
    action: 'download',
    items: ['outfit'],
    profilePath: path.resolve('profiles/www.xiaohongshu.com.json'),
    download: {
      dryRun: true,
      maxItems: 1,
    },
  }, {
    env: {
      BWS_XIAOHONGSHU_DOWNLOAD_AUTH_SIDECAR: 'C:/tmp/xiaohongshu-download-auth.json',
    },
    siteProfile,
    async readJsonFile() {
      return {
        ok: true,
        generatedAt: new Date().toISOString(),
        cookieCount: 1,
        userDataDir: 'C:/profiles/xiaohongshu.com',
        page: {
          url: 'https://www.xiaohongshu.com/notification',
        },
        headers: {
          Cookie: 'sid=stale-cookie',
          'User-Agent': 'Stale Sidecar UA',
          Referer: 'https://www.xiaohongshu.com/notification',
          Origin: 'https://www.xiaohongshu.com',
        },
      };
    },
    async inspectRequestReusableSiteSession() {
      return {
        authAvailable: true,
        userDataDir: 'C:/profiles/xiaohongshu.com',
        profileHealth: { healthy: true },
        authConfig: {
          keepaliveUrl: 'https://www.xiaohongshu.com/notification',
          preferVisibleBrowserForAuthenticatedFlows: true,
        },
      };
    },
    async openBrowserSession() {
      return {
        client: {
          async send() {
            return {
              cookies: [
                { domain: '.xiaohongshu.com', name: 'sid', value: 'fresh-cookie' },
              ],
            };
          },
        },
        browserAttachedVia: 'existing-target',
        reusedBrowserInstance: true,
        async navigateAndWait() {},
        async getPageMetadata() {
          return {
            finalUrl: 'https://www.xiaohongshu.com/notification',
          };
        },
        async evaluateValue(expression) {
          if (expression.includes('navigator.userAgent')) {
            return 'Fresh Browser Session UA';
          }
          if (expression.includes('navigator.languages')) {
            return 'zh-CN';
          }
          return '';
        },
        async close() {},
      };
    },
    async fetchImpl(url, options = {}) {
      if (String(url) === 'https://www.xiaohongshu.com/search_result?keyword=outfit') {
        searchFetchCount += 1;
        const cookie = String(options.headers?.Cookie ?? '');
        if (searchFetchCount === 1) {
          assert.match(cookie, /stale-cookie/u);
          return {
            ...createHtmlResponse(
              'https://www.xiaohongshu.com/website-login/error?error_code=300012',
              '<title>安全限制</title><div class="fe-verify-box"><div class="desc-code">300012</div></div>',
            ),
            url: 'https://www.xiaohongshu.com/website-login/error?error_code=300012',
          };
        }
        assert.match(cookie, /fresh-cookie/u);
        return createHtmlResponse(String(url), buildSearchHtml());
      }
      if (String(url) === 'https://www.xiaohongshu.com/explore/note-image') {
        return createHtmlResponse(String(url), buildImageNoteHtml('note-image'));
      }
      assert.fail(`unexpected fetch url: ${url}`);
    },
    async spawnJsonCommand(_command, args) {
      const inputFile = args[args.indexOf('--input-file') + 1];
      capturedPayload = JSON.parse(await readFile(inputFile, 'utf8'));
      return {
        code: 0,
        stdout: JSON.stringify({
          runDir: 'C:/tmp/xiaohongshu-download',
          summary: { total: 1, successful: 0, partial: 0, failed: 0, planned: 1 },
          reportMarkdown: '# Xiaohongshu Download Action\n',
          warnings: [],
        }),
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(searchFetchCount, 2);
  assert.equal(result.downloadSession?.initialStatus, 'sidecar-reused');
  assert.equal(result.downloadSession?.refreshAttempted, true);
  assert.equal(result.downloadSession?.refreshSucceeded, true);
  assert.equal(result.downloadSession?.refreshReason, 'restriction-page');
  assert.equal(result.downloadSession?.refreshCount, 1);
  assert.equal(result.downloadSession?.status, 'session-exported');
  assert.match(String(result.downloadSession?.lastMissedUrl ?? ''), /website-login\/error/u);
  assert.equal(capturedPayload[0].downloadBundle.headers.Cookie, 'sid=fresh-cookie');
});
