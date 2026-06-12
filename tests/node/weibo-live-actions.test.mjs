import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import {
  buildSocialActionPlan,
} from '../../src/sites/known-sites/social/actions/router.mjs';
import {
  buildWeiboActionPlan,
} from '../../skills/weibo/scripts/plan-weibo-action.mjs';
import {
  runWeiboResearchTask,
} from '../../skills/weibo/scripts/weibo-research-task-runner.mjs';
import {
  runWeiboSkillCheck,
} from '../../skills/weibo/scripts/check-weibo-skill.mjs';
import {
  runWeiboTrendSampler,
} from '../../skills/weibo/scripts/weibo-trend-sampler.mjs';
import {
  runWeiboApiReplay,
} from '../../skills/weibo/scripts/weibo-api-replay.mjs';
import {
  runWeiboCandidateProbe,
} from '../../skills/weibo/scripts/weibo-candidate-probe.mjs';
import {
  runWeiboBrowserNetworkProbe,
} from '../../skills/weibo/scripts/weibo-browser-network-probe.mjs';
import {
  evaluateWeiboSkill,
} from '../../skills/weibo/scripts/evaluate-weibo-skill.mjs';

const EXPECTED_CANDIDATE_PROBE_IDS = Object.freeze([
  'hot-rank-variants',
  'hot-timeline-variants',
  'hot-band-extended-params',
  'hot-rank-route-pages',
  'profile-content-features',
  'profile-feature-sweep',
  'profile-waterfall-api',
  'profile-tab-metadata',
  'profile-tab-routes',
  'mobile-profile-containers',
  'frontend-api-patterns',
]);

async function writeCandidateProbeFixture(outDir, overrides = {}) {
  await mkdir(outDir, { recursive: true });
  const frontendResult = {
    scriptFetchLimit: 5,
    scriptsFetched: 5,
    scriptsSkippedCount: 0,
    scriptFetchTruncated: false,
    scriptBlockedCount: 1,
    combinedEndpointPatternCount: 0,
    promotionEligible: false,
    ...overrides.frontend,
  };
  const report = {
    artifactFamily: 'siteforge-weibo-candidate-probe-report',
    schemaVersion: 1,
    generatedAt: '2026-06-09T00:00:00.000Z',
    status: 'completed',
    reasonCode: null,
    probes: EXPECTED_CANDIDATE_PROBE_IDS.map((id) => ({
      id,
      status: 'completed',
      results: id === 'frontend-api-patterns' ? [frontendResult] : [],
    })),
    summary: {
      probeCount: EXPECTED_CANDIDATE_PROBE_IDS.length,
      blockedCount: 0,
      promotionRecommendations: 0,
      promotionEligibleCount: 0,
      noAdditionalPromotions: true,
      ...overrides.summary,
    },
    safety: {
      rawCredentialMaterialPersisted: false,
      rawAuthHeaderPersisted: false,
      rawResponseBodyPersisted: false,
      rawTextOrTitlePersisted: false,
      rawFullUrlPersisted: false,
      rawMediaUrlPersisted: false,
      mutationAllowed: false,
      ...overrides.safety,
    },
    ...overrides.report,
  };
  const reportPath = path.join(outDir, 'candidate-probe-report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return reportPath;
}

async function writeBrowserNetworkProbeFixture(outDir, overrides = {}) {
  await mkdir(outDir, { recursive: true });
  const report = {
    artifactFamily: 'siteforge-weibo-browser-network-probe-report',
    schemaVersion: 1,
    generatedAt: '2026-06-09T00:00:00.000Z',
    status: 'completed',
    reasonCode: null,
    surfaces: [
      {
        id: 'hot-rank-ui',
        status: 'completed',
        routeCount: 1,
        routes: [{
          id: 'hotband-default',
          status: 'completed',
          requestCount: 1,
          requestShapes: [{
            shapeHash: 'fixture-hot-shape',
            resourceType: 'xhr',
            urlShape: { originKind: 'weibo', originHash: 'fixture', pathHash: 'fixture', queryKeys: [] },
          }],
          responseSummaryCount: 1,
          responseSummaries: [],
          promotionEligible: false,
        }],
      },
      {
        id: 'profile-tabs',
        status: 'completed',
        routeCount: 1,
        routes: [{
          id: 'profile-audio-tabtype',
          status: 'completed',
          requestCount: 1,
          requestShapes: [{
            shapeHash: 'fixture-profile-shape',
            resourceType: 'xhr',
            urlShape: { originKind: 'weibo', originHash: 'fixture', pathHash: 'fixture', queryKeys: ['tabtype'] },
          }],
          responseSummaryCount: 1,
          responseSummaries: [],
          promotionEligible: false,
        }],
      },
    ],
    summary: {
      surfaceCount: 2,
      blockedCount: 0,
      routeCount: 2,
      capturedRequestCount: 2,
      promotionRecommendations: 0,
      promotionEligibleCount: 0,
      noAdditionalPromotions: true,
      ...overrides.summary,
    },
    safety: {
      rawCredentialMaterialPersisted: false,
      rawAuthHeaderPersisted: false,
      rawResponseBodyPersisted: false,
      rawTextOrTitlePersisted: false,
      rawDomPersisted: false,
      rawFullUrlPersisted: false,
      rawMediaUrlPersisted: false,
      browserProfilePersisted: false,
      mutationAllowed: false,
      ...overrides.safety,
    },
    ...overrides.report,
  };
  const reportPath = path.join(outDir, 'browser-network-probe-report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return reportPath;
}

test('weibo social action dry-run planning requires auth for search', () => {
  const plan = buildSocialActionPlan({
    site: 'weibo',
    action: 'search',
    query: '高考',
  });

  assert.equal(plan.siteKey, 'weibo');
  assert.equal(plan.action, 'search');
  assert.equal(plan.requiresAuth, true);
  assert.equal(plan.url, 'https://s.weibo.com/weibo?q=%E9%AB%98%E8%80%83');
});

test('weibo social action planner keeps article tab distinct from generic posts', () => {
  const plan = buildSocialActionPlan({
    site: 'weibo',
    action: 'profile-content',
    account: '1234567890',
    contentType: 'articles',
  });

  assert.equal(plan.siteKey, 'weibo');
  assert.equal(plan.action, 'profile-content');
  assert.equal(plan.contentType, 'articles');
  assert.equal(plan.url, 'https://weibo.com/u/1234567890?tab=article');
});

test('weibo planner maps search and hot ranks to active runtime fallback', async () => {
  const search = await buildWeiboActionPlan({
    request: '搜索高考',
  });

  assert.equal(search.blocked, false);
  assert.equal(search.taskTemplate.id, 'keyword-trend');
  assert.equal(search.primary.status, 'unavailable');
  assert.equal(search.fallback.status, 'verified');
  assert.equal(search.fallback.providerId, 'weibo_readonly_provider');
  assert.equal(search.parameters.query, '高考');

  const hotRank = await buildWeiboActionPlan({
    request: '微博小时榜',
  });

  assert.equal(hotRank.blocked, false);
  assert.equal(hotRank.reasonCode, null);
  assert.equal(hotRank.fallback.capabilityId, 'weibo.hot-rank-hour');
  assert.equal(hotRank.fallback.status, 'verified');

  const hotTimeline = await buildWeiboActionPlan({
    request: '微博热榜',
  });

  assert.equal(hotTimeline.blocked, false);
  assert.equal(hotTimeline.fallback.capabilityId, 'weibo.hot-timeline');
  assert.equal(hotTimeline.fallback.status, 'verified');

  const femaleRank = await buildWeiboActionPlan({
    request: '微博女榜',
  });

  assert.equal(femaleRank.blocked, false);
  assert.equal(femaleRank.reasonCode, null);
  assert.equal(femaleRank.fallback.capabilityId, 'weibo.hot-rank-female');
  assert.equal(femaleRank.fallback.status, 'verified');

  const accountArchive = await buildWeiboActionPlan({
    request: '归档用户帖子相册文章视频音频精选',
    uid: '1234567890',
  });

  assert.equal(accountArchive.blocked, true);
  assert.equal(accountArchive.reasonCode, 'capability_candidate_not_replay_verified');
  assert.deepEqual(accountArchive.capabilities.map((capability) => capability.id), [
    'weibo.user-posts',
    'weibo.user-albums',
    'weibo.user-articles',
    'weibo.user-videos',
    'weibo.user-audio',
    'weibo.user-featured',
    'weibo.read-followed-users',
  ]);

  const albumArchive = await buildWeiboActionPlan({
    request: '归档用户相册',
    uid: '1234567890',
  });

  assert.equal(albumArchive.blocked, false);
  assert.equal(albumArchive.taskTemplate.id, 'account-albums-archive');
  assert.equal(albumArchive.primary.capabilityId, 'weibo.user-albums');
  assert.equal(albumArchive.fallback.status, 'verified');

  const videoArchive = await buildWeiboActionPlan({
    request: '归档用户视频',
    uid: '1234567890',
  });

  assert.equal(videoArchive.blocked, false);
  assert.equal(videoArchive.taskTemplate.id, 'account-videos-archive');
  assert.equal(videoArchive.primary.capabilityId, 'weibo.user-videos');
  assert.equal(videoArchive.fallback.status, 'verified');

  const articleArchive = await buildWeiboActionPlan({
    request: 'archive user articles',
    uid: '1234567890',
  });

  assert.equal(articleArchive.blocked, false);
  assert.equal(articleArchive.taskTemplate.id, 'account-articles-archive');
  assert.equal(articleArchive.primary.capabilityId, 'weibo.user-articles');
  assert.equal(articleArchive.fallback.status, 'verified');

  const audioArchive = await buildWeiboActionPlan({
    request: 'archive user audio',
    uid: '1234567890',
  });

  assert.equal(audioArchive.blocked, false);
  assert.equal(audioArchive.taskTemplate.id, 'account-audio-archive');
  assert.equal(audioArchive.primary.capabilityId, 'weibo.user-audio');
  assert.equal(audioArchive.fallback.status, 'verified');

  const pagedPostsArchive = await buildWeiboActionPlan({
    request: '归档用户帖子',
    uid: '1234567890',
    page: '2',
    maxPages: '2',
  });

  assert.match(pagedPostsArchive.commands.execute, /--page 2/u);
  assert.match(pagedPostsArchive.commands.execute, /--max-pages 2/u);
  assert.equal(pagedPostsArchive.parameters.page, '2');
  assert.equal(pagedPostsArchive.parameters.maxPages, '2');

  const compositeProfile = await buildWeiboActionPlan({
    request: '生成用户内容画像',
    uid: '1234567890',
  });

  assert.equal(compositeProfile.blocked, false);
  assert.equal(compositeProfile.taskTemplate.id, 'account-composite-profile');
  assert.deepEqual(compositeProfile.capabilities.map((capability) => capability.id), [
    'weibo.user-posts',
    'weibo.user-albums',
    'weibo.user-videos',
    'weibo.user-articles',
    'weibo.user-audio',
    'weibo.read-followed-users',
  ]);
});

test('weibo research task runner writes production-shaped dry-run artifacts', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-task-runner-'));
  try {
    const outDir = path.join(workspace, 'keyword-trend');
    const result = await runWeiboResearchTask({
      task: 'keyword-trend',
      query: '高考',
      outDir,
      dryRun: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'planned');
    assert.equal(result.reasonCode, null);

    const plan = JSON.parse(await readFile(path.join(outDir, 'task-plan.json'), 'utf8'));
    const summary = JSON.parse(await readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
    const report = await readFile(path.join(outDir, 'task-report.md'), 'utf8');
    const rawItems = await readFile(path.join(outDir, 'raw-items.jsonl'), 'utf8');
    const accountsItems = await readFile(path.join(outDir, 'accounts', 'items.jsonl'), 'utf8');
    const archiveReport = await readFile(path.join(outDir, 'archive', 'task.md'), 'utf8');

    assert.equal(plan.task, 'keyword-trend');
    assert.equal(plan.buckets[0].capabilityId, 'weibo.search-posts');
    assert.equal(plan.buckets[0].status, 'active');
    assert.equal(summary.counts.activeBuckets, 1);
    assert.match(report, /Weibo Task Report/u);
    assert.equal(rawItems, '');
    assert.equal(accountsItems, '');
    assert.match(archiveReport, /Artifact Contract/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo skill self-check writes planner matrix artifacts', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-skill-check-'));
  try {
    const candidateProbePath = await writeCandidateProbeFixture(path.join(workspace, 'candidate-probe'));
    const browserNetworkProbePath = await writeBrowserNetworkProbeFixture(path.join(workspace, 'browser-network-probe'));
    const result = await runWeiboSkillCheck({ outDir: workspace, candidateProbePath, browserNetworkProbePath });

    assert.equal(result.ok, true);
    assert.equal(result.catalog.counts.active, 15);
    assert.equal(result.catalog.counts.candidate, 1);
    assert.equal(result.catalog.counts.verifiedApi, 14);
    assert.equal(result.catalog.candidateProbe.frontend.scriptsFetched, 5);
    assert.equal(result.catalog.browserNetworkProbe.capturedRequestCount, 2);

    const checkJson = JSON.parse(await readFile(path.join(workspace, 'planner-check.json'), 'utf8'));
    const checkMarkdown = await readFile(path.join(workspace, 'planner-check.md'), 'utf8');

    assert.equal(checkJson.ok, true);
    assert.equal(checkJson.evidence.candidateProbe, candidateProbePath);
    assert.equal(checkJson.evidence.browserNetworkProbe, browserNetworkProbePath);
    assert.equal(checkJson.cases.find((entry) => entry.id === 'account-content-buckets').blocked, true);
    assert.match(checkMarkdown, /Weibo Skill Planner Check/u);
    assert.match(checkMarkdown, /candidateProbe: completed/u);
    assert.match(checkMarkdown, /browserNetworkProbe: completed/u);
    assert.match(checkMarkdown, /hot-rank-female/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo skill self-check fails on unreviewed frontend endpoint patterns', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-skill-check-probe-fail-'));
  try {
    const candidateProbePath = await writeCandidateProbeFixture(path.join(workspace, 'candidate-probe'), {
      frontend: { combinedEndpointPatternCount: 2 },
    });
    const browserNetworkProbePath = await writeBrowserNetworkProbeFixture(path.join(workspace, 'browser-network-probe'));
    const result = await runWeiboSkillCheck({ outDir: workspace, candidateProbePath, browserNetworkProbePath });

    assert.equal(result.ok, false);
    assert.match(result.catalog.failures.join('\n'), /frontend-api-patterns discovered 2 endpoint patterns/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo account archive exposes requested user content buckets as explicit candidates', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-account-archive-'));
  try {
    const outDir = path.join(workspace, 'account-full-archive');
    const result = await runWeiboResearchTask({
      task: 'account-full-archive',
      uid: '1234567890',
      outDir,
      dryRun: true,
    });

    assert.equal(result.ok, true);

    const plan = JSON.parse(await readFile(path.join(outDir, 'task-plan.json'), 'utf8'));
    const capabilityIds = plan.buckets.map((bucket) => bucket.capabilityId);

    assert.deepEqual(capabilityIds, [
      'weibo.user-posts',
      'weibo.user-albums',
      'weibo.user-articles',
      'weibo.user-videos',
      'weibo.user-audio',
      'weibo.user-featured',
      'weibo.read-followed-users',
    ]);
    assert.equal(plan.buckets.find((bucket) => bucket.capabilityId === 'weibo.user-posts').status, 'active');
    assert.equal(plan.buckets.find((bucket) => bucket.capabilityId === 'weibo.read-followed-users').status, 'active');
    assert.equal(plan.buckets.find((bucket) => bucket.capabilityId === 'weibo.user-albums').status, 'active');
    assert.equal(plan.buckets.find((bucket) => bucket.capabilityId === 'weibo.user-videos').status, 'active');
    assert.equal(plan.buckets.find((bucket) => bucket.capabilityId === 'weibo.user-articles').status, 'active');
    assert.equal(plan.buckets.find((bucket) => bucket.capabilityId === 'weibo.user-audio').status, 'active');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo account archive execute blocks on unverified candidate buckets before auth runtime', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-account-execute-'));
  try {
    const result = await runWeiboResearchTask({
      task: 'account-full-archive',
      uid: '1234567890',
      outDir: workspace,
      execute: true,
      dryRun: false,
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.equal(result.reasonCode, 'capability_candidate_not_replay_verified');

    const summary = JSON.parse(await readFile(path.join(workspace, 'task-summary.json'), 'utf8'));
    assert.equal(summary.reasonCode, 'capability_candidate_not_replay_verified');
    assert.match(summary.failureExplanation, /candidate bucket/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo account composite profile executes active buckets into merged artifacts', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-account-composite-'));
  const previousCookie = process.env.SITEFORGE_WEIBO_COOKIE;
  const fetchCalls = [];
  try {
    process.env.SITEFORGE_WEIBO_COOKIE = 'XSRF-TOKEN =synthetic_xsrf; sf_fixture_cookie=synthetic';
    const result = await runWeiboResearchTask({
      task: 'account-composite-profile',
      uid: '1234567890',
      outDir: workspace,
      execute: true,
      dryRun: false,
      fetchImpl: async (url, options) => {
        fetchCalls.push({ url: String(url), xsrf: options.headers['x-xsrf-token'] });
        if (String(url).includes('/ajax/statuses/mymblog') && String(url).includes('feature=0')) {
          return {
            status: 200,
            ok: true,
            headers: { get: () => 'application/json; charset=utf-8' },
            async json() {
              return { data: { list: [{ idstr: 'post-1', text_raw: 'sanitized post fixture' }] } };
            },
          };
        }
        if (String(url).includes('/photos/get_all')) {
          return {
            status: 200,
            ok: true,
            headers: { get: () => 'application/json' },
            async json() {
              return { data: { photo_list: [{ photo_id: 'photo-1', caption: 'sanitized photo fixture' }] } };
            },
          };
        }
        if (String(url).includes('/ajax/statuses/mymblog') && String(url).includes('feature=3')) {
          return {
            status: 200,
            ok: true,
            headers: { get: () => 'application/json; charset=utf-8' },
            async json() {
              return {
                data: {
                  list: [{
                    idstr: 'video-post-1',
                    text_raw: 'sanitized video fixture',
                    page_info: { type: '11', media_info: { duration: 60 } },
                  }],
                },
              };
            },
          };
        }
        if (String(url).includes('/ajax/statuses/mymblog') && String(url).includes('feature=7')) {
          return {
            status: 200,
            ok: true,
            headers: { get: () => 'application/json; charset=utf-8' },
            async json() {
              return {
                data: {
                  list: [{
                    idstr: 'article-post-1',
                    text_raw: 'sanitized article fixture https://example.invalid/raw-article-url',
                    page_info: { object_type: 'article', page_title: 'sanitized article title' },
                  }],
                },
              };
            },
          };
        }
        if (String(url).includes('/ajax/friendships/friends')) {
          return {
            status: 200,
            ok: true,
            headers: { get: () => 'application/json; charset=utf-8' },
            async json() {
              return { total_number: 1, users: [{ idstr: '2222222222' }] };
            },
          };
        }
        if (String(url).includes('/ajax/profile/getAudioList')) {
          return {
            status: 200,
            ok: true,
            headers: { get: () => 'application/json; charset=utf-8' },
            async json() {
              return { ok: 1, data: { list: [], next_cursor: 0 } };
            },
          };
        }
        throw new Error(`unexpected URL ${url}`);
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'completed');
    assert.equal(fetchCalls.length, 6);

    const state = JSON.parse(await readFile(path.join(workspace, 'task-state.json'), 'utf8'));
    const summary = JSON.parse(await readFile(path.join(workspace, 'task-summary.json'), 'utf8'));
    const runtimeReportText = await readFile(path.join(workspace, 'runtime_execution_report.json'), 'utf8');
    const runtimeReport = JSON.parse(runtimeReportText);
    const rawItemsText = await readFile(path.join(workspace, 'raw-items.jsonl'), 'utf8');
    const rawItems = rawItemsText.trim().split('\n').filter(Boolean).map(JSON.parse);
    const accounts = (await readFile(path.join(workspace, 'accounts', 'items.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
    const runtimeArchive = JSON.parse(await readFile(path.join(workspace, 'archive', 'raw', 'runtime-evidence.json'), 'utf8'));

    assert.equal(state.runtimeExecution.outcome, 'weibo_multi_bucket_read_completed');
    assert.equal(state.runtimeExecution.bucketExecutions.length, 6);
    assert.deepEqual(summary.quality.bucketCoverage.activeCovered, ['followed-users', 'user-posts', 'user-albums', 'user-videos', 'user-articles', 'user-audio']);
    assert.equal(summary.counts.rawItems, 6);
    assert.equal(summary.counts.accounts, 1);
    assert.deepEqual(rawItems.map((row) => row.recordKind).sort(), [
      'album-photo-summary',
      'followed-users-summary',
      'user-articles-summary',
      'user-audio-summary',
      'user-posts-summary',
      'user-videos-summary',
    ]);
    assert.equal(rawItems.find((row) => row.recordKind === 'user-audio-summary').emptyStatePresent, true);
    assert.deepEqual(accounts.map((account) => account.uid), ['2222222222']);
    assert.equal(runtimeReport.status, 'completed');
    assert.equal(runtimeReport.resultSummary.bucketCount, 6);
    assert.equal(runtimeReport.resultSummary.completedBucketCount, 6);
    assert.equal(runtimeArchive.bodySummary.length, 6);
    assert.doesNotMatch(runtimeReportText, /sf_fixture_cookie=synthetic|synthetic_xsrf/u);
    assert.doesNotMatch(rawItemsText, /sf_fixture_cookie=synthetic|synthetic_xsrf|raw-article-url/u);
  } finally {
    if (previousCookie === undefined) {
      delete process.env.SITEFORGE_WEIBO_COOKIE;
    } else {
      process.env.SITEFORGE_WEIBO_COOKIE = previousCookie;
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo runner explains robots policy blockers specifically', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-robots-block-'));
  const previousCookie = process.env.SITEFORGE_WEIBO_COOKIE;
  try {
    process.env.SITEFORGE_WEIBO_COOKIE = 'sf_fixture_cookie=synthetic';
    const result = await runWeiboResearchTask({
      task: 'keyword-trend',
      query: '高考',
      outDir: workspace,
      execute: true,
      dryRun: false,
      commandRunner: async () => ({
        code: 1,
        stdout: `${JSON.stringify({
          status: 'failed',
          reasonCode: 'setup-known-policy-robots-disallowed',
          artifactDir: path.join(workspace, 'runtime-build'),
        })}\n`,
        stderr: 'sanitized setup policy stderr',
      }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.equal(result.reasonCode, 'setup-known-policy-robots-disallowed');

    const summary = JSON.parse(await readFile(path.join(workspace, 'task-summary.json'), 'utf8'));
    assert.match(summary.failureExplanation, /known-site policy\/robots/u);
    assert.match(summary.failureExplanation, /不能通过重试或 cooldown 解决/u);
    assert.match(summary.recoveryActions.join('\n'), /config\/site-registry\.json/u);
  } finally {
    if (previousCookie === undefined) {
      delete process.env.SITEFORGE_WEIBO_COOKIE;
    } else {
      process.env.SITEFORGE_WEIBO_COOKIE = previousCookie;
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo runner direct provider executes search without persisting cookie material', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-direct-search-'));
  const previousCookie = process.env.SITEFORGE_WEIBO_COOKIE;
  const fetchCalls = [];
  try {
    process.env.SITEFORGE_WEIBO_COOKIE = 'sf_fixture_cookie=synthetic';
    const result = await runWeiboResearchTask({
      task: 'keyword-trend',
      query: '高考',
      outDir: workspace,
      execute: true,
      dryRun: false,
      commandRunner: null,
      fetchImpl: async (url, options) => {
        fetchCalls.push({
          url: String(url),
          method: options.method,
          cookie: options.headers?.cookie,
        });
        return {
          status: 200,
          ok: true,
          headers: {
            get(name) {
              return name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null;
            },
          },
          async text() {
            return '<html><body><div class="card-wrap"></div><div class="card-feed"></div></body></html>';
          },
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'completed');
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].method, 'GET');
    assert.match(fetchCalls[0].url, /^https:\/\/s\.weibo\.com\/weibo\?q=/u);
    assert.equal(fetchCalls[0].cookie, 'sf_fixture_cookie=synthetic');

    const state = JSON.parse(await readFile(path.join(workspace, 'task-state.json'), 'utf8'));
    const summary = JSON.parse(await readFile(path.join(workspace, 'task-summary.json'), 'utf8'));
    const runtimeReportText = await readFile(path.join(workspace, 'runtime_execution_report.json'), 'utf8');
    const rawItemsText = await readFile(path.join(workspace, 'raw-items.jsonl'), 'utf8');
    const archiveRuntimeText = await readFile(path.join(workspace, 'archive', 'raw', 'runtime-evidence.json'), 'utf8');
    const runtimeReport = JSON.parse(runtimeReportText);
    const rawItems = rawItemsText.trim().split('\n').filter(Boolean).map(JSON.parse);

    assert.equal(state.runtimeExecution.directProvider, true);
    assert.equal(state.runtimeExecution.providerId, 'weibo_readonly_provider');
    assert.equal(summary.quality.runtimeEvidenceAbsorbed, true);
    assert.equal(runtimeReport.status, 'completed');
    assert.equal(runtimeReport.resultSummary.outcome, 'weibo_search_read_completed');
    assert.equal(rawItems[0].recordKind, 'search-summary');
    assert.equal(rawItems[0].resultContainerSignals, 2);
    assert.doesNotMatch(runtimeReportText, /sf_fixture_cookie=synthetic/u);
    assert.doesNotMatch(rawItemsText, /sf_fixture_cookie=synthetic/u);
    assert.doesNotMatch(archiveRuntimeText, /sf_fixture_cookie=synthetic/u);
  } finally {
    if (previousCookie === undefined) {
      delete process.env.SITEFORGE_WEIBO_COOKIE;
    } else {
      process.env.SITEFORGE_WEIBO_COOKIE = previousCookie;
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo runner direct provider executes hot-search API into sanitized summary artifacts', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-direct-hot-search-'));
  const previousCookie = process.env.SITEFORGE_WEIBO_COOKIE;
  try {
    process.env.SITEFORGE_WEIBO_COOKIE = 'XSRF-TOKEN =synthetic_xsrf; sf_fixture_cookie=synthetic';
    const result = await runWeiboResearchTask({
      task: 'hot-search-monitor',
      mode: 'hot-search',
      outDir: workspace,
      execute: true,
      dryRun: false,
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://weibo.com/ajax/side/hotSearch');
        assert.equal(options.headers['x-xsrf-token'], 'synthetic_xsrf');
        return {
          status: 200,
          ok: true,
          headers: {
            get(name) {
              return name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null;
            },
          },
          async json() {
            return {
              ok: 1,
              data: {
                realtime: [
                  { note: '高考', num: 12345, category: '社会' },
                  { note: '志愿填报', raw_hot: 6789 },
                ],
              },
            };
          },
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'completed');

    const runtimeReportText = await readFile(path.join(workspace, 'runtime_execution_report.json'), 'utf8');
    const runtimeReport = JSON.parse(runtimeReportText);
    const rawItems = (await readFile(path.join(workspace, 'raw-items.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);

    assert.equal(runtimeReport.resultSummary.outcome, 'weibo_hot_search_api_read_completed');
    assert.equal(runtimeReport.resultSummary.response.bodySummary.itemCount, 2);
    assert.equal(rawItems[0].recordKind, 'hot-search-summary');
    assert.equal(rawItems[0].itemCount, 2);
    assert.equal(rawItems[0].topItems[0].label, '高考');
    assert.doesNotMatch(runtimeReportText, /sf_fixture_cookie=synthetic/u);
    assert.doesNotMatch(runtimeReportText, /synthetic_xsrf/u);
  } finally {
    if (previousCookie === undefined) {
      delete process.env.SITEFORGE_WEIBO_COOKIE;
    } else {
      process.env.SITEFORGE_WEIBO_COOKIE = previousCookie;
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo runner direct provider executes hot timeline API into sanitized summary artifacts', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-direct-hot-timeline-'));
  const previousCookie = process.env.SITEFORGE_WEIBO_COOKIE;
  try {
    process.env.SITEFORGE_WEIBO_COOKIE = 'XSRF-TOKEN =synthetic_xsrf; sf_fixture_cookie=synthetic';
    const result = await runWeiboResearchTask({
      task: 'hot-search-monitor',
      mode: 'timeline',
      outDir: workspace,
      execute: true,
      dryRun: false,
      fetchImpl: async (url, options) => {
        const parsed = new URL(url);
        assert.equal(`${parsed.origin}${parsed.pathname}`, 'https://weibo.com/ajax/feed/hottimeline');
        assert.equal(parsed.searchParams.get('group_id'), '102803');
        assert.equal(parsed.searchParams.get('containerid'), '102803');
        assert.equal(options.headers['x-xsrf-token'], 'synthetic_xsrf');
        return {
          status: 200,
          ok: true,
          headers: {
            get(name) {
              return name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null;
            },
          },
          async json() {
            return {
              ok: 1,
              statuses: [
                { idstr: 'timeline-1', text_raw: '热门微博内容摘要', user: { idstr: '2222222222' }, comments_count: 3 },
              ],
              total_number: 1,
            };
          },
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'completed');

    const runtimeReportText = await readFile(path.join(workspace, 'runtime_execution_report.json'), 'utf8');
    const runtimeReport = JSON.parse(runtimeReportText);
    const rawItems = (await readFile(path.join(workspace, 'raw-items.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);

    assert.equal(runtimeReport.resultSummary.outcome, 'weibo_hot_timeline_api_read_completed');
    assert.equal(runtimeReport.resultSummary.response.bodySummary.matchedArrayPath, 'statuses');
    assert.equal(runtimeReport.resultSummary.response.bodySummary.itemCount, 1);
    assert.equal(rawItems[0].recordKind, 'hot-timeline-summary');
    assert.equal(rawItems[0].mode, 'timeline');
    assert.equal(rawItems[0].topItems[0].label, '热门微博内容摘要');
    assert.doesNotMatch(runtimeReportText, /sf_fixture_cookie=synthetic/u);
    assert.doesNotMatch(runtimeReportText, /synthetic_xsrf/u);
  } finally {
    if (previousCookie === undefined) {
      delete process.env.SITEFORGE_WEIBO_COOKIE;
    } else {
      process.env.SITEFORGE_WEIBO_COOKIE = previousCookie;
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo runner direct provider executes split hot-rank API with explicit parameters', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-direct-hot-rank-female-'));
  const previousCookie = process.env.SITEFORGE_WEIBO_COOKIE;
  try {
    process.env.SITEFORGE_WEIBO_COOKIE = 'XSRF-TOKEN =synthetic_xsrf; sf_fixture_cookie=synthetic';
    const result = await runWeiboResearchTask({
      task: 'hot-search-monitor',
      mode: 'female',
      outDir: workspace,
      execute: true,
      dryRun: false,
      fetchImpl: async (url, options) => {
        const parsed = new URL(url);
        assert.equal(`${parsed.origin}${parsed.pathname}`, 'https://weibo.com/ajax/feed/hottimeline');
        assert.equal(parsed.searchParams.get('group_id'), '102803');
        assert.equal(parsed.searchParams.get('containerid'), '102803');
        assert.equal(parsed.searchParams.get('gender'), 'female');
        assert.equal(options.headers['x-xsrf-token'], 'synthetic_xsrf');
        return {
          status: 200,
          ok: true,
          headers: {
            get(name) {
              return name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null;
            },
          },
          async json() {
            return {
              ok: 1,
              statuses: [
                { idstr: 'female-rank-1', text_raw: 'female rank fixture', user: { idstr: '2222222222' }, comments_count: 3 },
              ],
              total_number: 1,
            };
          },
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'completed');

    const runtimeReportText = await readFile(path.join(workspace, 'runtime_execution_report.json'), 'utf8');
    const runtimeReport = JSON.parse(runtimeReportText);
    const rawItems = (await readFile(path.join(workspace, 'raw-items.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);

    assert.equal(runtimeReport.resultSummary.outcome, 'weibo_hot_rank_female_api_read_completed');
    assert.equal(runtimeReport.resultSummary.request.pathTemplate, '/ajax/feed/hottimeline?group_id=102803&containerid=102803&count=10&gender=female');
    assert.equal(runtimeReport.resultSummary.response.bodySummary.matchedArrayPath, 'statuses');
    assert.equal(runtimeReport.resultSummary.response.bodySummary.itemCount, 1);
    assert.equal(rawItems[0].recordKind, 'hot-rank-female-summary');
    assert.equal(rawItems[0].mode, 'female');
    assert.equal(rawItems[0].topItems[0].label, 'female rank fixture');
    assert.doesNotMatch(runtimeReportText, /sf_fixture_cookie=synthetic/u);
    assert.doesNotMatch(runtimeReportText, /synthetic_xsrf/u);
  } finally {
    if (previousCookie === undefined) {
      delete process.env.SITEFORGE_WEIBO_COOKIE;
    } else {
      process.env.SITEFORGE_WEIBO_COOKIE = previousCookie;
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo runner direct provider executes user posts into sanitized archive artifacts', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-direct-user-posts-'));
  const previousCookie = process.env.SITEFORGE_WEIBO_COOKIE;
  try {
    process.env.SITEFORGE_WEIBO_COOKIE = 'XSRF-TOKEN =synthetic_xsrf; sf_fixture_cookie=synthetic';
    const result = await runWeiboResearchTask({
      task: 'account-posts-archive',
      uid: '1234567890',
      page: '2',
      outDir: workspace,
      execute: true,
      dryRun: false,
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://weibo.com/ajax/statuses/mymblog?uid=1234567890&page=2&feature=0');
        assert.equal(options.headers['x-xsrf-token'], 'synthetic_xsrf');
        return {
          status: 200,
          ok: true,
          headers: {
            get(name) {
              return name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null;
            },
          },
          async json() {
            return {
              ok: 1,
              data: {
                list: [
                  {
                    idstr: 'post-1',
                    created_at: 'Tue Jun 09 12:00:00 +0800 2026',
                    text_raw: '高考相关公开帖子摘要 fixture',
                    comments_count: 2,
                  },
                ],
              },
            };
          },
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'completed');

    const runtimeReportText = await readFile(path.join(workspace, 'runtime_execution_report.json'), 'utf8');
    const runtimeReport = JSON.parse(runtimeReportText);
    const rawItems = (await readFile(path.join(workspace, 'raw-items.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);

    assert.equal(runtimeReport.resultSummary.outcome, 'weibo_user_posts_api_read_completed');
    assert.equal(runtimeReport.resultSummary.request.pageSlotUsed, true);
    assert.equal(runtimeReport.resultSummary.response.bodySummary.itemCount, 1);
    assert.equal(rawItems[0].recordKind, 'user-posts-summary');
    assert.equal(rawItems[0].posts[0].id, 'post-1');
    assert.equal(rawItems[0].posts[0].comments, 2);
    assert.doesNotMatch(runtimeReportText, /sf_fixture_cookie=synthetic/u);
    assert.doesNotMatch(runtimeReportText, /synthetic_xsrf/u);
  } finally {
    if (previousCookie === undefined) {
      delete process.env.SITEFORGE_WEIBO_COOKIE;
    } else {
      process.env.SITEFORGE_WEIBO_COOKIE = previousCookie;
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo runner executes bounded multi-page user posts into aggregated artifacts', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-direct-user-posts-pages-'));
  const previousCookie = process.env.SITEFORGE_WEIBO_COOKIE;
  const requestedUrls = [];
  try {
    process.env.SITEFORGE_WEIBO_COOKIE = 'XSRF-TOKEN =synthetic_xsrf; sf_fixture_cookie=synthetic';
    const result = await runWeiboResearchTask({
      task: 'account-posts-archive',
      uid: '1234567890',
      page: '2',
      maxPages: '2',
      outDir: workspace,
      execute: true,
      dryRun: false,
      fetchImpl: async (url, options) => {
        requestedUrls.push(url);
        assert.equal(options.headers['x-xsrf-token'], 'synthetic_xsrf');
        const pageMatch = String(url).match(/page=(\d+)/u);
        const page = pageMatch?.[1] ?? '0';
        return {
          status: 200,
          ok: true,
          headers: {
            get(name) {
              return name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null;
            },
          },
          async json() {
            return {
              ok: 1,
              data: {
                list: [
                  {
                    idstr: `post-page-${page}`,
                    created_at: 'Tue Jun 09 12:00:00 +0800 2026',
                    text_raw: `sanitized page ${page} fixture`,
                    comments_count: Number(page),
                  },
                ],
              },
            };
          },
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'completed');
    assert.deepEqual(requestedUrls, [
      'https://weibo.com/ajax/statuses/mymblog?uid=1234567890&page=2&feature=0',
      'https://weibo.com/ajax/statuses/mymblog?uid=1234567890&page=3&feature=0',
    ]);

    const runtimeReportText = await readFile(path.join(workspace, 'runtime_execution_report.json'), 'utf8');
    const runtimeReport = JSON.parse(runtimeReportText);
    const summary = JSON.parse(await readFile(path.join(workspace, 'task-summary.json'), 'utf8'));
    const rawItems = (await readFile(path.join(workspace, 'raw-items.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);

    assert.equal(runtimeReport.resultSummary.completedBucketCount, 2);
    assert.deepEqual(runtimeReport.resultSummary.bucketReports.map((entry) => entry.page), ['2', '3']);
    assert.equal(summary.counts.pagesAttempted, 2);
    assert.equal(summary.counts.pagesCompleted, 2);
    assert.deepEqual(rawItems.map((row) => row.page), ['2', '3']);
    assert.deepEqual(rawItems.map((row) => row.posts[0].id), ['post-page-2', 'post-page-3']);
    assert.doesNotMatch(runtimeReportText, /sf_fixture_cookie=synthetic|synthetic_xsrf/u);
  } finally {
    if (previousCookie === undefined) {
      delete process.env.SITEFORGE_WEIBO_COOKIE;
    } else {
      process.env.SITEFORGE_WEIBO_COOKIE = previousCookie;
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo runner direct provider executes user albums into sanitized archive artifacts', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-direct-user-albums-'));
  const previousCookie = process.env.SITEFORGE_WEIBO_COOKIE;
  try {
    process.env.SITEFORGE_WEIBO_COOKIE = 'XSRF-TOKEN =synthetic_xsrf; sf_fixture_cookie=synthetic';
    const result = await runWeiboResearchTask({
      task: 'account-albums-archive',
      uid: '1234567890',
      outDir: workspace,
      execute: true,
      dryRun: false,
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://photo.weibo.com/photos/get_all?uid=1234567890&page=1&count=30');
        assert.equal(options.headers['x-xsrf-token'], 'synthetic_xsrf');
        return {
          status: 200,
          ok: true,
          headers: {
            get(name) {
              return name.toLowerCase() === 'content-type' ? 'application/json' : null;
            },
          },
          async json() {
            return {
              code: 'A00006',
              data: {
                photo_list: [
                  {
                    photo_id: 'photo-1',
                    album_id: 'album-1',
                    caption: 'sanitized album caption fixture',
                    pic_host: 'https://example.invalid/raw-media-url',
                    pic_name: 'raw-media-name',
                  },
                ],
              },
            };
          },
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'completed');

    const runtimeReportText = await readFile(path.join(workspace, 'runtime_execution_report.json'), 'utf8');
    const runtimeReport = JSON.parse(runtimeReportText);
    const rawItemsText = await readFile(path.join(workspace, 'raw-items.jsonl'), 'utf8');
    const rawItems = rawItemsText.trim().split('\n').filter(Boolean).map(JSON.parse);
    const archiveRuntimeText = await readFile(path.join(workspace, 'archive', 'raw', 'runtime-evidence.json'), 'utf8');

    assert.equal(runtimeReport.resultSummary.outcome, 'weibo_user_albums_api_read_completed');
    assert.equal(runtimeReport.resultSummary.response.bodySummary.itemCount, 1);
    assert.equal(rawItems[0].recordKind, 'album-photo-summary');
    assert.equal(rawItems[0].photos[0].id, 'photo-1');
    assert.equal(rawItems[0].mediaDownloadsAllowed, false);
    assert.doesNotMatch(runtimeReportText, /sf_fixture_cookie=synthetic|synthetic_xsrf|raw-media-url|raw-media-name/u);
    assert.doesNotMatch(rawItemsText, /sf_fixture_cookie=synthetic|synthetic_xsrf|raw-media-url|raw-media-name/u);
    assert.doesNotMatch(archiveRuntimeText, /sf_fixture_cookie=synthetic|synthetic_xsrf|raw-media-url|raw-media-name/u);
  } finally {
    if (previousCookie === undefined) {
      delete process.env.SITEFORGE_WEIBO_COOKIE;
    } else {
      process.env.SITEFORGE_WEIBO_COOKIE = previousCookie;
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo runner direct provider executes user videos into sanitized archive artifacts', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-direct-user-videos-'));
  const previousCookie = process.env.SITEFORGE_WEIBO_COOKIE;
  try {
    process.env.SITEFORGE_WEIBO_COOKIE = 'XSRF-TOKEN =synthetic_xsrf; sf_fixture_cookie=synthetic';
    const result = await runWeiboResearchTask({
      task: 'account-videos-archive',
      uid: '1234567890',
      outDir: workspace,
      execute: true,
      dryRun: false,
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://weibo.com/ajax/statuses/mymblog?uid=1234567890&page=1&feature=3');
        assert.equal(options.headers['x-xsrf-token'], 'synthetic_xsrf');
        return {
          status: 200,
          ok: true,
          headers: {
            get(name) {
              return name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null;
            },
          },
          async json() {
            return {
              ok: 1,
              data: {
                list: [
                  {
                    idstr: 'video-post-1',
                    text_raw: 'sanitized video post fixture',
                    page_info: {
                      type: '11',
                      media_info: {
                        duration: 60,
                        stream_url: 'https://example.invalid/raw-video-url',
                      },
                    },
                  },
                ],
              },
            };
          },
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'completed');

    const runtimeReportText = await readFile(path.join(workspace, 'runtime_execution_report.json'), 'utf8');
    const runtimeReport = JSON.parse(runtimeReportText);
    const rawItemsText = await readFile(path.join(workspace, 'raw-items.jsonl'), 'utf8');
    const rawItems = rawItemsText.trim().split('\n').filter(Boolean).map(JSON.parse);
    const archiveRuntimeText = await readFile(path.join(workspace, 'archive', 'raw', 'runtime-evidence.json'), 'utf8');

    assert.equal(runtimeReport.resultSummary.outcome, 'weibo_user_videos_api_read_completed');
    assert.equal(runtimeReport.resultSummary.response.bodySummary.videoItemCount, 1);
    assert.equal(rawItems[0].recordKind, 'user-videos-summary');
    assert.equal(rawItems[0].videos[0].id, 'video-post-1');
    assert.equal(rawItems[0].mediaDownloadsAllowed, false);
    assert.doesNotMatch(runtimeReportText, /sf_fixture_cookie=synthetic|synthetic_xsrf|raw-video-url/u);
    assert.doesNotMatch(rawItemsText, /sf_fixture_cookie=synthetic|synthetic_xsrf|raw-video-url/u);
    assert.doesNotMatch(archiveRuntimeText, /sf_fixture_cookie=synthetic|synthetic_xsrf|raw-video-url/u);
  } finally {
    if (previousCookie === undefined) {
      delete process.env.SITEFORGE_WEIBO_COOKIE;
    } else {
      process.env.SITEFORGE_WEIBO_COOKIE = previousCookie;
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo runner direct provider executes user articles into sanitized archive artifacts', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-direct-user-articles-'));
  const previousCookie = process.env.SITEFORGE_WEIBO_COOKIE;
  try {
    process.env.SITEFORGE_WEIBO_COOKIE = 'XSRF-TOKEN =synthetic_xsrf; sf_fixture_cookie=synthetic';
    const result = await runWeiboResearchTask({
      task: 'account-articles-archive',
      uid: '1234567890',
      outDir: workspace,
      execute: true,
      dryRun: false,
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://weibo.com/ajax/statuses/mymblog?uid=1234567890&page=1&feature=7');
        assert.equal(options.headers['x-xsrf-token'], 'synthetic_xsrf');
        return {
          status: 200,
          ok: true,
          headers: {
            get(name) {
              return name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null;
            },
          },
          async json() {
            return {
              ok: 1,
              data: {
                list: [
                  {
                    idstr: 'article-post-1',
                    text_raw: 'sanitized article text https://example.invalid/raw-article-url',
                    page_info: {
                      object_type: 'article',
                      page_title: 'sanitized article title',
                      page_url: 'https://example.invalid/raw-page-url',
                    },
                  },
                  {
                    idstr: 'live-post-1',
                    text_raw: 'sanitized live fixture',
                    page_info: { object_type: 'live' },
                  },
                ],
              },
            };
          },
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'completed');

    const runtimeReportText = await readFile(path.join(workspace, 'runtime_execution_report.json'), 'utf8');
    const runtimeReport = JSON.parse(runtimeReportText);
    const rawItemsText = await readFile(path.join(workspace, 'raw-items.jsonl'), 'utf8');
    const rawItems = rawItemsText.trim().split('\n').filter(Boolean).map(JSON.parse);
    const archiveRuntimeText = await readFile(path.join(workspace, 'archive', 'raw', 'runtime-evidence.json'), 'utf8');

    assert.equal(runtimeReport.resultSummary.outcome, 'weibo_user_articles_api_read_completed');
    assert.equal(runtimeReport.resultSummary.response.bodySummary.itemCount, 2);
    assert.equal(runtimeReport.resultSummary.response.bodySummary.articleItemCount, 1);
    assert.equal(rawItems[0].recordKind, 'user-articles-summary');
    assert.equal(rawItems[0].articleItemCount, 1);
    assert.equal(rawItems[0].articles[0].id, 'article-post-1');
    assert.equal(rawItems[0].articles[0].textSummary.includes('[url]'), true);
    assert.doesNotMatch(runtimeReportText, /sf_fixture_cookie=synthetic|synthetic_xsrf|raw-article-url|raw-page-url/u);
    assert.doesNotMatch(rawItemsText, /sf_fixture_cookie=synthetic|synthetic_xsrf|raw-article-url|raw-page-url/u);
    assert.doesNotMatch(archiveRuntimeText, /sf_fixture_cookie=synthetic|synthetic_xsrf|raw-article-url|raw-page-url/u);
  } finally {
    if (previousCookie === undefined) {
      delete process.env.SITEFORGE_WEIBO_COOKIE;
    } else {
      process.env.SITEFORGE_WEIBO_COOKIE = previousCookie;
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo runner direct provider executes user audio into sanitized empty-state archive artifacts', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-direct-user-audio-'));
  const previousCookie = process.env.SITEFORGE_WEIBO_COOKIE;
  try {
    process.env.SITEFORGE_WEIBO_COOKIE = 'XSRF-TOKEN =synthetic_xsrf; sf_fixture_cookie=synthetic';
    const result = await runWeiboResearchTask({
      task: 'account-audio-archive',
      uid: '1234567890',
      outDir: workspace,
      execute: true,
      dryRun: false,
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://weibo.com/ajax/profile/getAudioList?profile_uid=1234567890&cursor=0');
        assert.equal(options.headers['x-xsrf-token'], 'synthetic_xsrf');
        return {
          status: 200,
          ok: true,
          headers: {
            get(name) {
              return name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null;
            },
          },
          async json() {
            return {
              ok: 1,
              data: {
                list: [],
                next_cursor: 0,
              },
            };
          },
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'completed');

    const runtimeReportText = await readFile(path.join(workspace, 'runtime_execution_report.json'), 'utf8');
    const runtimeReport = JSON.parse(runtimeReportText);
    const rawItemsText = await readFile(path.join(workspace, 'raw-items.jsonl'), 'utf8');
    const rawItems = rawItemsText.trim().split('\n').filter(Boolean).map(JSON.parse);
    const mediaAssets = JSON.parse(await readFile(path.join(workspace, 'media-assets.json'), 'utf8'));

    assert.equal(runtimeReport.resultSummary.outcome, 'weibo_user_audio_api_read_completed');
    assert.equal(runtimeReport.resultSummary.response.bodySummary.matchedArrayPath, 'data.list');
    assert.equal(runtimeReport.resultSummary.response.bodySummary.emptyStatePresent, true);
    assert.equal(rawItems[0].recordKind, 'user-audio-summary');
    assert.equal(rawItems[0].emptyStatePresent, true);
    assert.equal(rawItems[0].mediaDownloadsAllowed, false);
    assert.equal(mediaAssets.downloadsAllowed, false);
    assert.deepEqual(mediaAssets.assets, []);
    assert.doesNotMatch(runtimeReportText, /sf_fixture_cookie=synthetic|synthetic_xsrf/u);
    assert.doesNotMatch(rawItemsText, /sf_fixture_cookie=synthetic|synthetic_xsrf/u);
  } finally {
    if (previousCookie === undefined) {
      delete process.env.SITEFORGE_WEIBO_COOKIE;
    } else {
      process.env.SITEFORGE_WEIBO_COOKIE = previousCookie;
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo runner absorbs sanitized runtime evidence into account and archive artifacts', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-runtime-evidence-'));
  const previousCookie = process.env.SITEFORGE_WEIBO_COOKIE;
  try {
    process.env.SITEFORGE_WEIBO_COOKIE = 'sf_fixture_cookie=synthetic';
    const runtimeArtifactDir = path.join(workspace, 'runtime-build');
    await mkdir(runtimeArtifactDir, { recursive: true });
    await writeFile(path.join(runtimeArtifactDir, 'runtime_execution_report.json'), `${JSON.stringify({
      status: 'completed',
      providerId: 'weibo_readonly_provider',
      resultSummary: {
        outcome: 'weibo_followed_users_read_completed',
        responseMaterial: 'sanitized_summary_only',
        response: {
          status: 200,
          bodySummary: {
            kind: 'html',
            followedUserIdCount: 2,
            followedUserIds: ['2345678901', '3456789012'],
            emptyStatePresent: false,
            authOrChallengeSignals: 0,
            resultStateVerified: true,
          },
        },
      },
    }, null, 2)}\n`, 'utf8');

    const outDir = path.join(workspace, 'relation-archive');
    const result = await runWeiboResearchTask({
      task: 'relation-archive',
      uid: '1234567890',
      outDir,
      execute: true,
      dryRun: false,
      commandRunner: async () => ({
        code: 0,
        stdout: `${JSON.stringify({ status: 'completed', artifactDir: runtimeArtifactDir })}\n`,
        stderr: '',
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'completed');

    const rawItems = (await readFile(path.join(outDir, 'raw-items.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
    const accounts = (await readFile(path.join(outDir, 'accounts', 'items.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
    const archiveManifest = JSON.parse(await readFile(path.join(outDir, 'archive-manifest.json'), 'utf8'));
    const runtimeArchive = JSON.parse(await readFile(path.join(outDir, 'archive', 'raw', 'runtime-evidence.json'), 'utf8'));

    assert.equal(rawItems[0].recordKind, 'followed-users-summary');
    assert.equal(rawItems[0].followedUserIdCount, 2);
    assert.deepEqual(accounts.map((account) => account.uid), ['2345678901', '3456789012']);
    assert.equal(archiveManifest.runtimeEvidence.providerId, 'weibo_readonly_provider');
    assert.equal(archiveManifest.counts.accounts, 2);
    assert.equal(runtimeArchive.bodySummary.followedUserIdCount, 2);
  } finally {
    if (previousCookie === undefined) {
      delete process.env.SITEFORGE_WEIBO_COOKIE;
    } else {
      process.env.SITEFORGE_WEIBO_COOKIE = previousCookie;
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo runner records resume state and cache context', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-resume-state-'));
  try {
    await writeFile(path.join(workspace, 'task-state.json'), `${JSON.stringify({
      status: 'blocked',
      reasonCode: 'runtime.cookie_env_missing',
      updatedAt: '2026-06-09T00:00:00.000Z',
      completedBuckets: [],
      blockedBuckets: ['search-posts'],
    }, null, 2)}\n`, 'utf8');
    await writeFile(path.join(workspace, 'cache-index.json'), `${JSON.stringify({
      entries: [{ id: 'runtime-evidence:1', type: 'runtime-evidence' }],
    }, null, 2)}\n`, 'utf8');

    const result = await runWeiboResearchTask({
      task: 'keyword-trend',
      query: '高考',
      outDir: workspace,
      resume: true,
      dryRun: true,
    });

    assert.equal(result.ok, true);

    const plan = JSON.parse(await readFile(path.join(workspace, 'task-plan.json'), 'utf8'));
    const state = JSON.parse(await readFile(path.join(workspace, 'task-state.json'), 'utf8'));
    const summary = JSON.parse(await readFile(path.join(workspace, 'task-summary.json'), 'utf8'));
    const archiveManifest = JSON.parse(await readFile(path.join(workspace, 'archive-manifest.json'), 'utf8'));

    assert.equal(plan.resumeStrategy.resumeRequested, true);
    assert.equal(plan.resumeStrategy.previousStateLoaded, true);
    assert.equal(plan.resumeStrategy.previousStatus, 'blocked');
    assert.equal(plan.resumeStrategy.previousCacheEntries, 1);
    assert.equal(state.resume.previousReasonCode, 'runtime.cookie_env_missing');
    assert.equal(summary.quality.resume.reusedCacheEntries, 1);
    assert.equal(archiveManifest.resume.previousStatus, 'blocked');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo trend sampler writes bucket and trend summary artifacts for active hot ranks', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-trend-sampler-'));
  try {
    const result = await runWeiboTrendSampler({
      queries: ['高考'],
      modes: ['hour', 'female'],
      outDir: workspace,
      dryRun: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'planned');
    assert.equal(result.reasonCode, null);
    assert.equal(result.counts.totalBuckets, 3);
    assert.equal(result.counts.plannedBuckets, 3);
    assert.equal(result.counts.blockedBuckets, 0);

    const state = JSON.parse(await readFile(path.join(workspace, 'trend-run-state.json'), 'utf8'));
    const buckets = JSON.parse(await readFile(path.join(workspace, 'bucket-summary.json'), 'utf8'));
    const csv = await readFile(path.join(workspace, 'bucket-summary.csv'), 'utf8');
    const summary = JSON.parse(await readFile(path.join(workspace, 'trend-summary.json'), 'utf8'));
    const markdown = await readFile(path.join(workspace, 'trend-summary.md'), 'utf8');

    assert.equal(state.status, 'planned');
    assert.equal(buckets[0].fallbackCapabilityId, 'weibo.search-posts');
    assert.equal(buckets[1].fallbackCapabilityId, 'weibo.hot-rank-hour');
    assert.equal(buckets[1].blocked, false);
    assert.equal(buckets[2].fallbackCapabilityId, 'weibo.hot-rank-female');
    assert.equal(buckets[2].blocked, false);
    assert.match(csv, /hot-rank-female/u);
    assert.equal(summary.safety.rawCredentialMaterialPersisted, false);
    assert.match(markdown, /Weibo Trend Sampler Summary/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo trend sampler records previous trend state when resuming', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-trend-resume-'));
  try {
    await writeFile(path.join(workspace, 'trend-run-state.json'), `${JSON.stringify({
      status: 'partial',
      reasonCode: 'some_buckets_blocked',
      buckets: [{ id: 'query-1' }],
    }, null, 2)}\n`, 'utf8');

    const result = await runWeiboTrendSampler({
      queries: ['高考'],
      outDir: workspace,
      resume: true,
      dryRun: true,
    });

    assert.equal(result.status, 'planned');

    const summary = JSON.parse(await readFile(path.join(workspace, 'trend-summary.json'), 'utf8'));
    assert.equal(summary.resume.requested, true);
    assert.equal(summary.resume.previousStateLoaded, true);
    assert.equal(summary.resume.previousStatus, 'partial');
    assert.equal(summary.resume.previousBucketCount, 1);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo api replay blocks without cookie env and persists no credential material', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-api-replay-missing-cookie-'));
  try {
    const result = await runWeiboApiReplay({
      endpoints: ['hot-search'],
      outDir: workspace,
      cookieEnv: 'SITEFORGE_WEIBO_COOKIE_MISSING_FIXTURE',
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.equal(result.reasonCode, 'runtime.cookie_env_missing');

    const reportText = await readFile(path.join(workspace, 'api-replay-report.json'), 'utf8');
    const report = JSON.parse(reportText);

    assert.equal(report.summary.blockedCount, 1);
    assert.equal(report.results[0].capabilityId, 'weibo.hot-search');
    assert.equal(report.safety.rawCredentialMaterialPersisted, false);
    assert.doesNotMatch(reportText, /sf_fixture_cookie/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo api replay verifies synthetic json shapes without persisting response bodies', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-api-replay-verified-'));
  const fetchCalls = [];
  try {
    const result = await runWeiboApiReplay({
      endpoints: ['hot-search', 'hot-band', 'hot-timeline', 'hot-rank-yesterday', 'hot-rank-day-before-yesterday', 'hot-rank-week', 'hot-rank-male', 'hot-rank-female', 'followed-users', 'user-posts', 'user-albums', 'user-videos', 'user-articles', 'user-audio'],
      uid: '1234567890',
      outDir: workspace,
      cookie: 'XSRF-TOKEN =synthetic_xsrf; sf_fixture_cookie=synthetic',
      fetchImpl: async (url, options) => {
        fetchCalls.push({
          url,
          cookie: options.headers.cookie,
          xsrf: options.headers['x-xsrf-token'],
          requestedWith: options.headers['x-requested-with'],
          referer: options.headers.referer,
        });
        return {
          status: 200,
          ok: true,
          headers: {
            get(name) {
              return name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null;
            },
          },
          async json() {
            if (String(url).includes('/ajax/side/hotSearch')) {
              return { data: { realtime: [{ note: '高考' }] } };
            }
            if (String(url).includes('/ajax/statuses/hot_band')) {
              return { data: { band_list: [{ word: 'hot band fixture' }] } };
            }
            if (String(url).includes('/ajax/feed/hottimeline')) {
              const parsed = new URL(url);
              const rankSuffix = parsed.searchParams.get('ranking_type') ?? parsed.searchParams.get('gender') ?? 'timeline';
              return { statuses: [{ idstr: `hot-${rankSuffix}-1`, text_raw: `hot ${rankSuffix} fixture` }] };
            }
            if (String(url).includes('/ajax/friendships/friends')) {
              return { users: [{ idstr: '2222222222' }] };
            }
            if (String(url).includes('/photos/get_all')) {
              return { data: { photo_list: [{ photo_id: 'photo-1' }] } };
            }
            if (String(url).includes('feature=3')) {
              return {
                data: {
                  list: [{
                    id: 'video-post-1',
                    page_info: {
                      type: '11',
                      media_info: { duration: 30 },
                    },
                  }],
                },
              };
            }
            if (String(url).includes('feature=7')) {
              return {
                data: {
                  list: [{
                    id: 'article-post-1',
                    page_info: {
                      object_type: 'article',
                      page_title: 'sanitized article fixture',
                    },
                  }],
                },
              };
            }
            if (String(url).includes('/ajax/profile/getAudioList')) {
              return { data: { list: [], next_cursor: 0 } };
            }
            return { data: { list: [{ id: 'post-1', text_raw: 'sanitized fixture' }] } };
          },
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'verified');
    assert.equal(result.summary.replayVerifiedCount, 14);
    assert.equal(result.summary.promotionEligibleCount, 14);
    assert.equal(fetchCalls.length, 14);
    assert.equal(fetchCalls[0].cookie, 'XSRF-TOKEN =synthetic_xsrf; sf_fixture_cookie=synthetic');
    assert.equal(fetchCalls[0].xsrf, 'synthetic_xsrf');
    assert.equal(fetchCalls[0].requestedWith, 'XMLHttpRequest');
    assert.match(fetchCalls[0].referer, /^https:\/\/weibo\.com/u);

    const reportText = await readFile(path.join(workspace, 'api-replay-report.json'), 'utf8');
    const report = JSON.parse(reportText);
    const markdown = await readFile(path.join(workspace, 'api-replay-report.md'), 'utf8');

    assert.deepEqual(report.results.map((entry) => entry.status), Array.from({ length: 14 }, () => 'verified'));
    assert.deepEqual(report.results.map((entry) => entry.activationGate.promotionEligible), Array.from({ length: 14 }, () => true));
    assert.equal(report.results.every((entry) => entry.activationGate.missing.length === 0), true);
    assert.equal(report.results[0].response.shape.expectedShapeMatched, true);
    assert.equal(report.results.find((entry) => entry.endpointId === 'hot-timeline').capabilityId, 'weibo.hot-timeline');
    assert.equal(report.results.find((entry) => entry.endpointId === 'hot-timeline').response.semanticCheck.postLikeCount, 1);
    assert.equal(report.results.find((entry) => entry.endpointId === 'hot-rank-yesterday').capabilityId, 'weibo.hot-rank-yesterday');
    assert.equal(report.results.find((entry) => entry.endpointId === 'hot-rank-day-before-yesterday').response.semanticCheck.evidence.includes('day-before-yesterday'), true);
    assert.equal(report.results.find((entry) => entry.endpointId === 'hot-rank-week').request.pathTemplate.includes('ranking_type=week'), true);
    assert.equal(report.results.find((entry) => entry.endpointId === 'hot-rank-male').request.pathTemplate.includes('gender=male'), true);
    assert.equal(report.results.find((entry) => entry.endpointId === 'hot-rank-female').request.pathTemplate.includes('gender=female'), true);
    assert.equal(report.results.find((entry) => entry.endpointId === 'followed-users').response.shape.itemCount, 1);
    assert.equal(report.results.find((entry) => entry.endpointId === 'user-posts').response.shape.itemCount, 1);
    assert.equal(report.results.find((entry) => entry.endpointId === 'user-albums').response.shape.itemCount, 1);
    assert.equal(report.results.find((entry) => entry.endpointId === 'user-videos').response.semanticCheck.matched, true);
    assert.equal(report.results.find((entry) => entry.endpointId === 'user-articles').response.semanticCheck.matched, true);
    assert.equal(report.results.find((entry) => entry.endpointId === 'user-audio').response.shape.expectedShapeMatched, true);
    assert.equal(report.results.find((entry) => entry.endpointId === 'user-audio').response.shape.itemCount, 0);
    assert.equal(report.results[0].response.bodyPersisted, false);
    assert.equal(report.safety.rawResponseBodyPersisted, false);
    assert.doesNotMatch(reportText, /sf_fixture_cookie=synthetic/u);
    assert.doesNotMatch(reportText, /synthetic_xsrf/u);
    assert.match(markdown, /Weibo API Replay Report/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo api replay keeps user posts blocked until uid slot is provided', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-api-replay-missing-uid-'));
  try {
    const result = await runWeiboApiReplay({
      endpoints: ['user-posts'],
      outDir: workspace,
      cookie: 'sf_fixture_cookie=synthetic',
      fetchImpl: async () => {
        throw new Error('fetch should not run when uid is missing');
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.equal(result.reasonCode, 'missing_required_parameters');

    const report = JSON.parse(await readFile(path.join(workspace, 'api-replay-report.json'), 'utf8'));
    assert.equal(report.results[0].reasonCode, 'missing_required_parameters');
    assert.deepEqual(report.results[0].missingParameters, ['uid']);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo candidate probe writes shape hash evidence without promotions or raw material', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-candidate-probe-'));
  const fetchCalls = [];
  try {
    const result = await runWeiboCandidateProbe({
      uid: '1234567890',
      outDir: workspace,
      cookie: 'XSRF-TOKEN=synthetic_xsrf; sf_fixture_cookie=synthetic',
      fetchImpl: async (url, options) => {
        const parsedUrl = new URL(url);
        fetchCalls.push({
          pathname: parsedUrl.pathname,
          cookie: options.headers.cookie,
          xsrf: options.headers['x-xsrf-token'],
        });
        if (parsedUrl.pathname === '/u/1234567890') {
          return {
            status: 200,
            ok: true,
            headers: {
              get(name) {
                return name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null;
              },
            },
            async text() {
              return [
                '<html><head><title>raw-page-title-secret</title>',
                '<script src="/static/raw-secret-app.js?token=secret-script-token"></script>',
                '<script src="https://weibo.com/static/second-secret.js"></script>',
                '</head><body>',
                '<a href="/u/1234567890?tab=article">raw article tab</a>',
                '<a href="/u/1234567890?tab=audio">raw audio tab</a>',
                '<a href="/u/1234567890?tab=album">raw album tab</a>',
                'feature=7 feature=5 /ajax/statuses/mymblog /ajax/profile/info',
                '</body></html>',
              ].join('');
            },
          };
        }
        if (parsedUrl.pathname === '/top/summary') {
          return {
            status: 200,
            ok: true,
            headers: {
              get(name) {
                return name.toLowerCase() === 'content-type' ? 'text/html; charset=UTF-8' : null;
              },
            },
            async text() {
              const cate = parsedUrl.searchParams.get('cate') ?? 'default';
              return [
                '<html><body><table>',
                '<tr><td class="td-02">raw hot route secret one</td></tr>',
                '<tr><td class="td-02">raw hot route secret two</td></tr>',
                `<tr><td class="td-02">raw hot route ${cate} secret</td></tr>`,
                '</table></body></html>',
              ].join('');
            },
          };
        }
        if (parsedUrl.hostname === 'm.weibo.cn' && parsedUrl.pathname === '/api/container/getIndex') {
          return {
            status: 200,
            ok: true,
            headers: {
              get(name) {
                return name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null;
              },
            },
            async json() {
              return {
                ok: 1,
                url: 'https://m.weibo.cn/raw-mobile-redirect?token=secret-mobile-token',
              };
            },
          };
        }
        if (parsedUrl.pathname.startsWith('/static/')) {
          return {
            status: 200,
            ok: true,
            headers: {
              get(name) {
                return name.toLowerCase() === 'content-type' ? 'application/javascript; charset=utf-8' : null;
              },
            },
            async text() {
              return [
                'const rawSecretTitle = "raw frontend title secret";',
                'fetch("/ajax/statuses/mymblog?uid=1234567890&page=1&feature=7&token=secret");',
                'fetch("/ajax/statuses/hot_band?secret=raw-hot-secret");',
                'fetch("/ajax/article/raw-secret-article?token=secret");',
                'fetch("/ajax/audio/raw-secret-audio?ticket=secret");',
              ].join('\n');
            },
          };
        }
        return {
          status: 200,
          ok: true,
          headers: {
            get(name) {
              return name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null;
            },
          },
          async json() {
            if (parsedUrl.pathname === '/ajax/profile/getWaterFallContent') {
              return {
                data: {
                  list: [{
                    page_info: {
                      type: 'video',
                      object_type: 'video',
                      page_url: 'https://weibo.com/tv/raw-waterfall-video?token=secret',
                      media_info: {
                        media_id: 'waterfall-video',
                        audio_channel: 'fixture-audio-field',
                      },
                    },
                  }],
                },
              };
            }
            if (parsedUrl.pathname === '/ajax/feed/hottimeline') {
              return {
                statuses: [
                  {
                    idstr: 'timeline-1',
                    mblogid: 'timeline-a',
                    text_raw: 'raw hot timeline body fixture',
                    user: { idstr: 'timeline-user' },
                    reposts_count: 1,
                    comments_count: 2,
                    attitudes_count: 3,
                  },
                ],
              };
            }
            if (parsedUrl.pathname === '/ajax/statuses/hot_band') {
              return {
                data: {
                  band_list: [
                    { mid: 'hot-1', rank: 1, word: 'base-secret-label' },
                    { mid: 'hot-2', rank: 2, word: 'another-secret-label' },
                  ],
                },
              };
            }
            const feature = parsedUrl.searchParams.get('feature');
            if (feature === '7') {
              return {
                data: {
                  list: [
                    {
                      text_raw: 'raw article body fixture',
                      page_info: {
                        type: 'webpage',
                        object_type: 'article',
                        page_title: 'raw article title',
                        page_url: 'https://weibo.com/article/raw-secret-article-slug?token=secret-url-value',
                      },
                    },
                    {
                      page_info: {
                        type: 'webpage',
                        object_type: 'webpage',
                        page_url: 'https://example.invalid/landing/raw-secret-page?ticket=secret-ticket',
                      },
                    },
                    {
                      page_info: {
                        type: 'live',
                        object_type: 'live',
                        page_url: 'https://weibo.com/live/raw-secret-live?id=secret-id',
                      },
                    },
                  ],
                },
              };
            }
            if (feature === '3') {
              return {
                data: {
                  list: [{
                    page_info: {
                      type: 'video',
                      object_type: 'video',
                      media_info: {
                        duration: 30,
                        stream_url: 'https://example.invalid/raw-video-url',
                      },
                    },
                  }],
                },
              };
            }
            return { data: { list: [{ id: `feature-${feature}`, text_raw: 'raw post text fixture' }] } };
          },
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'completed');
    assert.equal(result.summary.promotionRecommendations, 0);
    assert.equal(result.summary.promotionEligibleCount, 0);

    const reportText = await readFile(path.join(workspace, 'candidate-probe-report.json'), 'utf8');
    const report = JSON.parse(reportText);
    const markdown = await readFile(path.join(workspace, 'candidate-probe-report.md'), 'utf8');

    assert.equal(report.summary.noAdditionalPromotions, true);
    assert.equal(report.safety.rawCredentialMaterialPersisted, false);
    assert.equal(report.safety.rawResponseBodyPersisted, false);
    assert.equal(report.safety.rawFullUrlPersisted, false);
    assert.equal(report.probes[0].results.every((entry) => entry.promotionEligible === false), true);
    assert.equal(report.probes[0].results[0].alreadyActive, true);
    assert.equal(report.probes[0].results[1].overlapWithBase, 1);
    const hotTimelineProbe = report.probes.find((probe) => probe.id === 'hot-timeline-variants');
    assert.equal(hotTimelineProbe.results.length, 11);
    assert.equal(hotTimelineProbe.results.every((entry) => entry.promotionEligible === false), true);
    assert.equal(hotTimelineProbe.results.find((entry) => entry.id === 'active-hot-timeline').alreadyActive, true);
    assert.equal(hotTimelineProbe.results.find((entry) => entry.id === 'ranking-type-week').postLikeCount, 1);
    const hotBandExtendedProbe = report.probes.find((probe) => probe.id === 'hot-band-extended-params');
    assert.equal(hotBandExtendedProbe.results.length, 11);
    assert.equal(hotBandExtendedProbe.results.every((entry) => entry.promotionEligible === false), true);
    assert.equal(hotBandExtendedProbe.results.find((entry) => entry.id === 'extended-base').alreadyActive, true);
    assert.equal(hotBandExtendedProbe.results.find((entry) => entry.id === 'rank-type-week').matchedArrayPath, 'data.band_list');
    const hotRouteProbe = report.probes.find((probe) => probe.id === 'hot-rank-route-pages');
    assert.equal(hotRouteProbe.results.length, 7);
    assert.equal(hotRouteProbe.results.every((entry) => entry.promotionEligible === false), true);
    assert.equal(hotRouteProbe.results.find((entry) => entry.id === 'summary-week').rowHashCount > 0, true);

    const featureResults = report.probes.find((probe) => probe.id === 'profile-content-features').results;
    const feature7 = featureResults.find((entry) => entry.feature === 7);
    const feature3 = featureResults.find((entry) => entry.feature === 3);
    assert.equal(feature7.articleObjectCount, 1);
    assert.equal(feature7.liveObjectCount, 1);
    assert.equal(feature7.coveredByActiveCapability, true);
    assert.equal(feature7.promotionEligible, false);
    assert.equal(feature3.coveredByActiveCapability, true);
    assert.equal(feature3.promotionEligible, false);
    const featureSweepResults = report.probes.find((probe) => probe.id === 'profile-feature-sweep').results;
    assert.equal(featureSweepResults.length, 11);
    assert.equal(featureSweepResults.every((entry) => entry.promotionEligible === false), true);
    assert.equal(featureSweepResults.find((entry) => entry.feature === 7).coveredByActiveCapability, true);
    assert.equal(featureSweepResults.find((entry) => entry.feature === 3).coveredByActiveCapability, true);
    assert.equal(featureSweepResults.find((entry) => entry.feature === 5).sweepOnly, false);
    assert.equal(featureSweepResults.find((entry) => entry.feature === 1).sweepOnly, true);
    const waterfallProbe = report.probes.find((probe) => probe.id === 'profile-waterfall-api');
    assert.equal(waterfallProbe.results.length, 1);
    assert.equal(waterfallProbe.results[0].videoObjectCount, 1);
    assert.equal(waterfallProbe.results[0].audioObjectCount, 0);
    assert.equal(waterfallProbe.results[0].promotionEligible, false);
    const profileProbe = report.probes.find((probe) => probe.id === 'profile-tab-metadata');
    const profileRouteProbe = report.probes.find((probe) => probe.id === 'profile-tab-routes');
    const mobileProbe = report.probes.find((probe) => probe.id === 'mobile-profile-containers');
    const frontendProbe = report.probes.find((probe) => probe.id === 'frontend-api-patterns');
    assert.equal(profileProbe.results[0].tabSignalCounts.article > 0, true);
    assert.equal(profileProbe.results[0].tabSignalCounts.audio > 0, true);
    assert.equal(profileRouteProbe.results.length, 10);
    assert.equal(profileRouteProbe.results.find((entry) => entry.id === 'profile-audio').promotionEligible, false);
    assert.equal(profileRouteProbe.results.find((entry) => entry.id === 'profile-featured').promotionEligible, false);
    assert.equal(mobileProbe.results.length, 7);
    assert.equal(mobileProbe.results.every((entry) => entry.promotionEligible === false), true);
    assert.equal(typeof mobileProbe.results[0].redirectShapeHash, 'string');
    assert.equal(frontendProbe.results[0].scriptsFetched, 2);
    assert.equal(frontendProbe.results[0].scriptsSkippedCount, 0);
    assert.equal(frontendProbe.results[0].scriptFetchTruncated, false);
    assert.equal(frontendProbe.results[0].combinedSemanticSignalCounts.article > 0, true);
    assert.equal(frontendProbe.results[0].combinedSemanticSignalCounts.audio > 0, true);
    assert.equal(frontendProbe.results[0].promotionEligible, false);
    assert.equal(fetchCalls.length, 73);
    assert.equal(fetchCalls[0].cookie, 'XSRF-TOKEN=synthetic_xsrf; sf_fixture_cookie=synthetic');
    assert.equal(fetchCalls[0].xsrf, 'synthetic_xsrf');
    assert.equal(fetchCalls.filter((call) => call.pathname.startsWith('/static/')).every((call) => call.cookie === undefined), true);

    assert.match(markdown, /Weibo Candidate Probe Report/u);
    assert.doesNotMatch(reportText, /sf_fixture_cookie=synthetic|synthetic_xsrf/u);
    assert.doesNotMatch(reportText, /base-secret-label|another-secret-label/u);
    assert.doesNotMatch(reportText, /raw hot timeline body fixture/u);
    assert.doesNotMatch(reportText, /raw hot route secret/u);
    assert.doesNotMatch(reportText, /raw article title|raw article body fixture|raw post text fixture/u);
    assert.doesNotMatch(reportText, /raw-secret|secret-url-value|secret-ticket|raw-video-url|raw-waterfall-video|secret-mobile-token|example\.invalid/u);
    assert.doesNotMatch(reportText, /raw-page-title-secret|secret-script-token|raw frontend title secret|raw-hot-secret/u);

    const unknownDir = path.join(workspace, 'unknown-probe');
    const unknownResult = await runWeiboCandidateProbe({
      outDir: unknownDir,
      cookie: 'sf_fixture_cookie=synthetic',
      probes: ['https://example.invalid/raw-title-secret?token=secret'],
      fetchImpl: async () => {
        throw new Error('unknown probe must not fetch');
      },
    });
    assert.equal(unknownResult.ok, false);
    assert.equal(unknownResult.reasonCode, 'unknown_probe');
    const unknownReportText = await readFile(path.join(unknownDir, 'candidate-probe-report.json'), 'utf8');
    const unknownReport = JSON.parse(unknownReportText);
    assert.equal(unknownReport.probes[0].id, 'unknown-probe');
    assert.equal(typeof unknownReport.probes[0].probeHash, 'string');
    assert.doesNotMatch(unknownReportText, /example\.invalid|raw-title-secret|token=secret/u);

    const unknownNoCookieDir = path.join(workspace, 'unknown-no-cookie-probe');
    const unknownNoCookieResult = await runWeiboCandidateProbe({
      outDir: unknownNoCookieDir,
      cookie: '',
      probes: ['https://example.invalid/raw-title-secret?token=secret'],
    });
    assert.equal(unknownNoCookieResult.ok, false);
    const unknownNoCookieReportText = await readFile(path.join(unknownNoCookieDir, 'candidate-probe-report.json'), 'utf8');
    assert.doesNotMatch(unknownNoCookieReportText, /example\.invalid|raw-title-secret|token=secret/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo browser network probe writes sanitized request shape evidence without promotion', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-browser-network-probe-'));
  const addedCookies = [];
  const launched = [];
  try {
    class MockRequest {
      constructor(url, resourceType = 'xhr') {
        this._url = url;
        this._resourceType = resourceType;
      }
      url() {
        return this._url;
      }
      resourceType() {
        return this._resourceType;
      }
    }
    class MockResponse {
      constructor(request, body, contentType = 'application/json; charset=utf-8') {
        this._request = request;
        this._body = body;
        this._contentType = contentType;
      }
      request() {
        return this._request;
      }
      url() {
        return this._request.url();
      }
      status() {
        return 200;
      }
      headers() {
        return { 'content-type': this._contentType };
      }
      async json() {
        return this._body;
      }
      async text() {
        return '<html><body>raw browser body secret</body></html>';
      }
    }
    class MockPage {
      constructor() {
        this.handlers = { request: new Set(), response: new Set() };
      }
      on(event, handler) {
        this.handlers[event]?.add(handler);
      }
      off(event, handler) {
        this.handlers[event]?.delete(handler);
      }
      async goto(url) {
        const apiUrl = String(url).includes('/hot/')
          ? 'https://weibo.com/ajax/statuses/hot_band?secret=raw-browser-secret&rank_type=week'
          : 'https://weibo.com/ajax/profile/getWaterFallContent?uid=1234567890&token=raw-browser-secret';
        const request = new MockRequest(apiUrl);
        for (const handler of this.handlers.request) handler(request);
        const body = String(url).includes('/hot/')
          ? { data: { band_list: [{ mid: 'hot-1', word: 'raw hot browser word' }] } }
          : { data: { list: [{ page_info: { object_type: 'video', page_url: 'https://weibo.com/raw-browser-video?token=secret' } }] } };
        const response = new MockResponse(request, body);
        for (const handler of this.handlers.response) handler(response);
        return { status: () => 200 };
      }
      async waitForTimeout() {}
      async close() {}
    }
    const browserLauncher = {
      async launch(options) {
        launched.push(options);
        return {
          async newContext() {
            return {
              async addCookies(cookies) {
                addedCookies.push(...cookies);
              },
              async newPage() {
                return new MockPage();
              },
              async close() {},
            };
          },
          async close() {},
        };
      },
    };

    const result = await runWeiboBrowserNetworkProbe({
      surfaces: ['hot-rank-ui', 'profile-tabs'],
      uid: '1234567890',
      outDir: workspace,
      cookie: 'XSRF-TOKEN=synthetic_xsrf; sf_fixture_cookie=synthetic',
      browserLauncher,
      timeoutMs: 1,
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'completed');
    assert.equal(result.summary.surfaceCount, 2);
    assert.equal(result.summary.promotionRecommendations, 0);
    assert.equal(launched[0].headless, true);
    assert.equal(addedCookies.length, 2);

    const reportText = await readFile(path.join(workspace, 'browser-network-probe-report.json'), 'utf8');
    const report = JSON.parse(reportText);
    const markdown = await readFile(path.join(workspace, 'browser-network-probe-report.md'), 'utf8');
    assert.equal(report.artifactFamily, 'siteforge-weibo-browser-network-probe-report');
    assert.equal(report.summary.noAdditionalPromotions, true);
    assert.equal(report.summary.capturedRequestCount > 0, true);
    assert.equal(report.summary.endpointShapeCounts.some((entry) => entry.pathPattern === '/ajax/statuses/hot_band'), true);
    assert.equal(report.summary.endpointShapeCounts.some((entry) => entry.pathPattern === '/ajax/profile/getWaterFallContent'), true);
    assert.equal(report.safety.rawCredentialMaterialPersisted, false);
    assert.equal(report.safety.rawResponseBodyPersisted, false);
    assert.equal(report.safety.rawFullUrlPersisted, false);
    assert.equal(report.safety.browserProfilePersisted, false);
    const hotShape = report.surfaces.find((surface) => surface.id === 'hot-rank-ui').routes[0].requestShapes[0].urlShape;
    assert.equal(hotShape.endpointFamily, 'ajax-statuses');
    assert.equal(hotShape.pathPattern, '/ajax/statuses/hot_band');
    assert.equal(hotShape.queryKeys.includes('rank_type'), true);
    assert.equal(report.surfaces.find((surface) => surface.id === 'profile-tabs').routes[0].routeShape.pathPattern, '/u/{number}');
    assert.equal(report.surfaces.find((surface) => surface.id === 'profile-tabs').routes[0].responseSummaries[0].bodySummary.objectTypeCounts.video, 1);
    assert.match(markdown, /Weibo Browser Network Probe Report/u);
    assert.doesNotMatch(reportText, /synthetic_xsrf|sf_fixture_cookie|XSRF-TOKEN/u);
    assert.doesNotMatch(reportText, /raw-browser-secret|raw hot browser word|raw-browser-video|raw browser body secret|1234567890/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo skill evaluator writes three-layer score report from artifacts', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-skill-eval-'));
  try {
    const plannerDir = path.join(workspace, 'planner-check');
    const trendDir = path.join(workspace, 'trend');
    const replayDir = path.join(workspace, 'api-replay');
    const taskDir = path.join(workspace, 'task');
    const candidateProbePath = await writeCandidateProbeFixture(path.join(workspace, 'candidate-probe'));
    const browserNetworkProbePath = await writeBrowserNetworkProbeFixture(path.join(workspace, 'browser-network-probe'));

    await runWeiboSkillCheck({ outDir: plannerDir, candidateProbePath, browserNetworkProbePath });
    await runWeiboTrendSampler({ queries: ['高考'], modes: ['hour'], outDir: trendDir, dryRun: true });
    await runWeiboApiReplay({ endpoints: ['hot-search'], outDir: replayDir, cookieEnv: 'SITEFORGE_WEIBO_COOKIE_MISSING_FIXTURE' });
    await runWeiboResearchTask({ task: 'keyword-trend', query: '高考', outDir: taskDir, dryRun: true });

    const result = await evaluateWeiboSkill({
      outDir: workspace,
      plannerCheckPath: path.join(plannerDir, 'planner-check.json'),
      apiReplayPath: path.join(replayDir, 'api-replay-report.json'),
      candidateProbePath,
      browserNetworkProbePath,
      trendSummaryPath: path.join(trendDir, 'trend-summary.json'),
      taskSummaryPaths: [path.join(taskDir, 'task-summary.json')],
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'not-production-ready');
    assert.ok(result.finalScore > 70);
    assert.equal(result.cappedScore, result.finalScore);

    const report = JSON.parse(await readFile(path.join(workspace, 'weibo-skill-evaluation.json'), 'utf8'));
    const markdown = await readFile(path.join(workspace, 'weibo-skill-evaluation.md'), 'utf8');

    assert.equal(report.layers.length, 3);
    assert.equal(report.hardCaps.length, 0);
    assert.equal(report.evidence.candidateProbe, candidateProbePath);
    assert.equal(report.evidence.browserNetworkProbe, browserNetworkProbePath);
    assert.equal(report.candidateProbeSummary.frontend.scriptsFetched, 5);
    assert.equal(report.browserNetworkProbeSummary.capturedRequestCount, 2);
    assert.match(markdown, /Weibo Skill 三层评估报告/u);
    assert.match(markdown, /frontend\.combinedEndpointPatternCount: 0/u);
    assert.match(markdown, /能力发现层/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo skill evaluator caps fake active api promotion at 70', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'weibo-skill-eval-cap-'));
  try {
    const catalogPath = path.join(workspace, 'fake-catalog.json');
    const originalCatalog = JSON.parse(await readFile(path.join('skills', 'weibo', 'references', 'weibo-live-catalog.json'), 'utf8'));
    originalCatalog.capabilities.push({
      id: 'weibo.fake-api',
      name: 'fake api',
      status: 'active',
      kind: 'api-runtime',
      api: { replayVerified: true, adapterBound: false, runtimeTested: false },
    });
    await writeFile(catalogPath, `${JSON.stringify(originalCatalog, null, 2)}\n`, 'utf8');

    const result = await evaluateWeiboSkill({ outDir: workspace, catalogPath, taskSummaryPaths: [] });
    assert.ok(result.finalScore > 70);
    assert.equal(result.cappedScore, 70);
    const report = JSON.parse(await readFile(path.join(workspace, 'weibo-skill-evaluation.json'), 'utf8'));
    assert.equal(report.hardCaps[0].rule, '虚构程序接口能力');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
