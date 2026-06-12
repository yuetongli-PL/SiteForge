import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildTaskPlan,
  inferRedditRequest,
  parseArgs,
  runRedditResearchTask,
} from '../../scripts/reddit-research-task-runner.mjs';

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'siteforge-reddit-research-task-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function createBuildArtifacts(root) {
  const buildDir = path.join(root, 'build');
  const evidenceDir = path.join(root, 'evidence');
  await writeJson(path.join(buildDir, 'auth_state_report.json'), {
    verified: true,
    browserBridge: {
      routeCount: 3,
      capturedRouteCount: 3,
      missingRouteCount: 0,
      persisted: false,
    },
    sessionMaterialPersisted: false,
    cookieMaterialPersisted: false,
    browserProfilePersisted: false,
  });
  await writeJson(path.join(buildDir, 'crawl_authenticated.json'), {
    authenticatedPages: [
      {
        routeTemplate: '/r/siteforge',
        routePath: '/r/siteforge/',
        normalizedUrl: 'https://www.reddit.com/r/siteforge/',
        pageType: 'category-page',
        visibleItemCount: 12,
        listPresent: true,
        emptyStatePresent: false,
        evidenceStatus: 'structure_summary_present',
        evidenceLevel: 'browser_structure_verified',
        riskLevel: 'read_public_low',
        structureHash: 'browser-structure:test',
        collection: { status: 'success' },
      },
      {
        routeTemplate: '/search',
        routePath: '/search/',
        normalizedUrl: 'https://www.reddit.com/search/?q=siteforge',
        pageType: 'search-results-page',
        visibleItemCount: 10,
        listPresent: true,
        emptyStatePresent: false,
        evidenceStatus: 'structure_summary_present',
        evidenceLevel: 'browser_structure_verified',
        riskLevel: 'read_public_low',
        structureHash: 'browser-structure:search',
        collection: { status: 'success' },
      },
    ],
  });
  await fs.mkdir(evidenceDir, { recursive: true });
  return { buildDir, evidenceDir };
}

function baseOptions(root, args) {
  return parseArgs([
    ...args,
    '--out-dir',
    path.join(root, 'out'),
    '--build-dir',
    path.join(root, 'build'),
    '--evidence-dir',
    path.join(root, 'evidence'),
    '--now',
    '2026-06-09',
  ]);
}

test('reddit research task runner builds high-level task plans', async (t) => {
  const root = await tempDir(t);
  const cases = [
    [['--task', 'subreddit-full-archive', '--subreddit', 'siteforge'], ['subreddit-hot', 'subreddit-new', 'subreddit-rising', 'subreddit-search', 'subreddit-about']],
    [['--task', 'keyword-trend', '--query', 'siteforge'], ['search-posts', 'search-communities', 'search-users']],
    [['--task', 'redditor-profile', '--account', 'reddit'], ['user-about', 'user-submitted', 'user-comments']],
    [['--task', 'community-discovery', '--query', 'agent'], ['community-search', 'community-users-search', 'community-recommend']],
    [['--task', 'event-timeline', '--query', 'gpt-5'], ['event-search-new', 'event-search-relevance']],
    [['--task', 'saved-history-archive'], ['saved-route-structure', 'subscribed-communities']],
  ];

  for (const [argv, expectedBuckets] of cases) {
    const plan = buildTaskPlan(baseOptions(root, argv));
    assert.equal(plan.schemaVersion, 1);
    assert.equal(plan.task.noStallPolicy.apiFirstFallback, 'verified_site_fallback_without_cooldown');
    assert.equal(plan.outputContract.requiredArtifacts.includes('raw-items.jsonl'), true);
    assert.equal(plan.safety.mutationActionsDefault, 'blocked');
    for (const bucketId of expectedBuckets) {
      assert.equal(plan.buckets.some((bucket) => bucket.id === bucketId), true, `${plan.task.id} missing ${bucketId}`);
    }
    if (plan.task.id === 'subreddit-full-archive') {
      const aboutBucket = plan.buckets.find((bucket) => bucket.id === 'subreddit-about');
      assert.equal(aboutBucket.activeProgrammatic.provider, 'reddit_public_atom_feed');
      assert.equal(aboutBucket.activeProgrammatic.operation.profileOnly, true);
      assert.equal(aboutBucket.activeProgrammatic.operation.profileKind, 'subreddit');
    }
    if (plan.task.id === 'redditor-profile') {
      const aboutBucket = plan.buckets.find((bucket) => bucket.id === 'user-about');
      assert.equal(aboutBucket.activeProgrammatic.provider, 'reddit_public_atom_feed');
      assert.equal(aboutBucket.activeProgrammatic.operation.profileOnly, true);
      assert.equal(aboutBucket.activeProgrammatic.operation.profileKind, 'redditor');
    }
  }
});

test('reddit research task runner dispatches natural-language requests to high-level templates', async (t) => {
  const root = await tempDir(t);
  const cases = [
    {
      request: 'Archive all public activity for r/SiteForge',
      expectedTask: 'subreddit-full-archive',
      expected: { subreddit: 'SiteForge' },
      expectedSignal: 'subreddit_reference',
    },
    {
      request: 'Build a redditor profile for u/example_author',
      expectedTask: 'redditor-profile',
      expected: { account: 'example_author' },
      expectedSignal: 'account_reference',
    },
    {
      request: 'Build an event timeline for "OpenAI Codex"',
      expectedTask: 'event-timeline',
      expected: { query: 'OpenAI Codex' },
      expectedSignal: 'timeline_keyword',
    },
    {
      request: 'Find related Reddit communities about "agent runtime"',
      expectedTask: 'community-discovery',
      expected: { query: 'agent runtime' },
      expectedSignal: 'community_discovery_keyword',
    },
  ];

  for (const { request, expectedTask, expected, expectedSignal } of cases) {
    const options = baseOptions(root, ['--request', request]);
    const plan = buildTaskPlan(options);
    assert.equal(options.task, expectedTask);
    assert.equal(plan.task.id, expectedTask);
    assert.equal(plan.planner.mode, 'natural_language_request');
    assert.equal(plan.planner.inference.signals.includes(expectedSignal), true);
    for (const [key, value] of Object.entries(expected)) {
      assert.equal(options[key], value);
      assert.equal(plan.inputs[key], value);
    }
  }
});

test('reddit research task runner exposes request inference for planner audit', () => {
  const inference = inferRedditRequest('Analyze Reddit trend around "siteforge runtime"');
  assert.equal(inference.task, 'keyword-trend');
  assert.equal(inference.query, 'siteforge runtime');
  assert.equal(inference.confidence > 0, true);
});

test('reddit research task runner immediately falls back to verified site structure when API lacks credentials', async (t) => {
  const root = await tempDir(t);
  await createBuildArtifacts(root);
  const result = await runRedditResearchTask(baseOptions(root, [
    '--task',
    'saved-history-archive',
    '--collection-mode',
    'api-first',
    '--execute',
    '--max-buckets-per-run',
    '2',
  ]), {
    executeCommand: async () => ({
      exitCode: 1,
      stdout: `${JSON.stringify({
        ok: false,
        execution: {
          status: 'blocked',
          reasonCode: 'reddit_oauth_bearer_token_required',
        },
      }, null, 2)}\n`,
      stderr: '',
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.siteFallbackBucketCount, 2);
  assert.equal(result.summary.descriptorOnlyItemCount > 0, true);
  const oauthResult = result.state.bucketResults.find((bucketResult) => bucketResult.bucketId === 'subscribed-communities');
  assert.equal(oauthResult.failure.apiFailure.layer, 'api_auth');
  const rawItems = await fs.readFile(path.join(root, 'out', 'raw-items.jsonl'), 'utf8');
  assert.match(rawItems, /verified_site_route_summary/);
  const report = await fs.readFile(path.join(root, 'out', 'task-report.md'), 'utf8');
  assert.match(report, /site_fallback_degraded_structure_only/);
  const savedResult = result.state.bucketResults.find((bucketResult) => bucketResult.bucketId === 'saved-route-structure');
  assert.equal(savedResult.api.status, 'blocked');
  assert.equal(savedResult.api.reasonCode, 'reddit_oauth_bearer_token_required');
  assert.equal(savedResult.failure.apiFailure.layer, 'api_auth');
  assert.equal(savedResult.items.every((item) => item.privateContentPersisted === false), true);
});

test('reddit research task runner records sanitized public feed items for replay-verified feed buckets', async (t) => {
  const root = await tempDir(t);
  await createBuildArtifacts(root);
  const result = await runRedditResearchTask(baseOptions(root, [
    '--task',
    'subreddit-full-archive',
    '--subreddit',
    'siteforge',
    '--execute',
    '--max-buckets-per-run',
    '1',
  ]), {
    executeCommand: async () => ({
      exitCode: 0,
      stdout: `<?xml version="1.0" encoding="UTF-8"?>
<feed>
  <entry>
    <id>t3_feed1</id>
    <title>SiteForge feed item</title>
    <author><name>feed_author</name></author>
    <link rel="alternate" href="https://www.reddit.com/r/siteforge/comments/feed1/example/"/>
    <published>2026-06-09T00:00:00Z</published>
    <content type="html">&lt;p&gt;public preview with &lt;strong&gt;markup&lt;/strong&gt;&lt;/p&gt;</content>
  </entry>
</feed>
SITEFORGE_HTTP_STATUS:200
`,
      stderr: '',
    }),
  });

  assert.equal(result.summary.apiCompletedBucketCount, 1);
  assert.equal(result.summary.siteFallbackBucketCount, 0);
  assert.equal(result.summary.descriptorOnlyItemCount, 0);
  const items = await fs.readFile(path.join(root, 'out', 'items.jsonl'), 'utf8');
  assert.match(items, /SiteForge feed item/);
  assert.match(items, /feed_author/);
  assert.doesNotMatch(items, /<feed>/);
  assert.doesNotMatch(items, /<strong>/);
  const rows = items.trim().split(/\r?\n/u).map((line) => JSON.parse(line));
  const feedItem = rows.find((item) => item.title === 'SiteForge feed item');
  assert.equal(feedItem.contentText, 'public preview with markup');
  assert.equal(feedItem.contentTextLength, 'public preview with markup'.length);
  assert.equal(feedItem.contentTextTruncated, false);
  assert.equal(feedItem.contentSourceElement, 'content');
  assert.equal(feedItem.contentPreview, 'public preview with markup');
  assert.equal(feedItem.contentHtmlPersisted, false);
  assert.equal(feedItem.rawContentPersisted, false);
  assert.equal(feedItem.rawFeedPersisted, false);
});

test('reddit research task runner bounds public feed content with explicit truncation metadata', async (t) => {
  const root = await tempDir(t);
  await createBuildArtifacts(root);
  const result = await runRedditResearchTask(baseOptions(root, [
    '--task',
    'subreddit-full-archive',
    '--subreddit',
    'siteforge',
    '--execute',
    '--max-buckets-per-run',
    '1',
    '--max-content-chars',
    '12',
  ]), {
    executeCommand: async () => ({
      exitCode: 0,
      stdout: `<feed>
  <entry>
    <id>long_feed_1</id>
    <title>Long public feed item</title>
    <author><name>feed_author</name></author>
    <link rel="alternate" href="https://www.reddit.com/r/siteforge/comments/long_feed_1/example/"/>
    <summary>abcdefghijklmnopqrstuvwxyz</summary>
  </entry>
</feed>
SITEFORGE_HTTP_STATUS:200
`,
      stderr: '',
    }),
  });

  assert.equal(result.summary.apiCompletedBucketCount, 1);
  const items = await fs.readFile(path.join(root, 'out', 'items.jsonl'), 'utf8');
  const row = items.trim().split(/\r?\n/u).map((line) => JSON.parse(line))[0];
  assert.equal(row.contentText, 'abcdefghijkl');
  assert.equal(row.contentTextLength, 26);
  assert.equal(row.contentTextTruncated, true);
  assert.equal(row.contentSourceElement, 'summary');
  assert.equal(row.contentHtmlPersisted, false);
});

test('reddit research task runner uses public search feed for keyword trend buckets', async (t) => {
  const root = await tempDir(t);
  await createBuildArtifacts(root);
  const plan = buildTaskPlan(baseOptions(root, [
    '--task',
    'keyword-trend',
    '--query',
    'siteforge',
  ]));
  assert.equal(plan.buckets[0].activeProgrammatic.provider, 'reddit_public_atom_feed');
  assert.match(plan.buckets[0].activeProgrammatic.operation.url, /search\.rss\?q=siteforge/u);
  assert.equal(plan.buckets[1].activeProgrammatic.provider, 'reddit_public_atom_feed');
  assert.equal(plan.buckets[1].activeProgrammatic.operation.pathParams.derivedEntity, 'communities');
  assert.equal(plan.buckets[2].activeProgrammatic.provider, 'reddit_public_atom_feed');
  assert.equal(plan.buckets[2].activeProgrammatic.operation.pathParams.derivedEntity, 'authors');

  const result = await runRedditResearchTask(baseOptions(root, [
    '--task',
    'keyword-trend',
    '--query',
    'siteforge',
    '--execute',
  ]), {
    executeCommand: async () => ({
      exitCode: 0,
      stdout: `<feed>
  <entry>
    <id>search_feed_1</id>
    <title>Keyword feed result</title>
    <author><name>search_author</name></author>
    <link rel="alternate" href="https://www.reddit.com/r/siteforge/comments/search_feed_1/example/"/>
    <category term="siteforge" label="r/siteforge"/>
    <updated>2026-06-09T00:00:00Z</updated>
  </entry>
</feed>
SITEFORGE_HTTP_STATUS:200
`,
      stderr: '',
    }),
  });

  assert.equal(result.summary.apiCompletedBucketCount, 3);
  assert.equal(result.summary.descriptorOnlyItemCount, 0);
  const communities = await fs.readFile(path.join(root, 'out', 'communities.jsonl'), 'utf8');
  assert.match(communities, /siteforge/);
  const accounts = await fs.readFile(path.join(root, 'out', 'accounts.jsonl'), 'utf8');
  assert.match(accounts, /search_author/);
});

test('reddit research task runner records public feed profile summaries for about buckets', async (t) => {
  const root = await tempDir(t);
  await createBuildArtifacts(root);
  const result = await runRedditResearchTask(baseOptions(root, [
    '--task',
    'redditor-profile',
    '--account',
    'reddit',
    '--execute',
    '--max-buckets-per-run',
    '2',
  ]), {
    executeCommand: async () => ({
      exitCode: 0,
      stdout: `<feed>
  <title>reddit overview</title>
  <subtitle>Public Reddit account feed metadata</subtitle>
  <updated>2026-06-09T00:00:00Z</updated>
  <link rel="alternate" href="https://www.reddit.com/user/reddit/"/>
  <entry>
    <id>user_feed_1</id>
    <title>Reddit feed item</title>
    <author><name>reddit</name></author>
    <link rel="alternate" href="https://www.reddit.com/r/siteforge/comments/user_feed_1/example/"/>
  </entry>
</feed>
SITEFORGE_HTTP_STATUS:200
`,
      stderr: '',
    }),
  });

  assert.equal(result.summary.apiCompletedBucketCount, 2);
  assert.equal(result.summary.siteFallbackBucketCount, 0);
  assert.equal(result.summary.descriptorOnlyItemCount, 0);
  const aboutResult = result.state.bucketResults.find((bucketResult) => bucketResult.bucketId === 'user-about');
  assert.equal(aboutResult.items.length, 1);
  assert.equal(aboutResult.items[0].itemType, 'account');
  assert.equal(aboutResult.items[0].username, 'reddit');
  assert.equal(aboutResult.items[0].rawFeedPersisted, false);
  const accounts = await fs.readFile(path.join(root, 'out', 'accounts.jsonl'), 'utf8');
  assert.match(accounts, /reddit/);
  assert.doesNotMatch(accounts, /<feed>/);
});

test('reddit research task runner marks public redditor comments as comment items', async (t) => {
  const root = await tempDir(t);
  await createBuildArtifacts(root);
  const result = await runRedditResearchTask(baseOptions(root, [
    '--task',
    'redditor-profile',
    '--account',
    'reddit',
    '--execute',
    '--max-buckets-per-run',
    '4',
  ]), {
    executeCommand: async () => ({
      exitCode: 0,
      stdout: `<feed>
  <entry>
    <id>comment_feed_1</id>
    <title>Comment feed item</title>
    <author><name>reddit</name></author>
    <link rel="alternate" href="https://www.reddit.com/r/siteforge/comments/comment_feed_1/example/comment_1/"/>
    <content>Public comment body</content>
  </entry>
</feed>
SITEFORGE_HTTP_STATUS:200
`,
      stderr: '',
    }),
  });

  assert.equal(result.summary.apiCompletedBucketCount, 4);
  const commentsResult = result.state.bucketResults.find((bucketResult) => bucketResult.bucketId === 'user-comments');
  assert.equal(commentsResult.items[0].itemType, 'comment');
  assert.equal(commentsResult.items[0].contentText, 'Public comment body');
});

test('reddit research task runner falls back when public feed replay fails', async (t) => {
  const root = await tempDir(t);
  await createBuildArtifacts(root);
  const result = await runRedditResearchTask(baseOptions(root, [
    '--task',
    'redditor-profile',
    '--account',
    'reddit',
    '--execute',
    '--max-buckets-per-run',
    '1',
  ]), {
    executeCommand: async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'fetch failed',
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.siteFallbackBucketCount, 1);
  assert.equal(result.state.bucketResults[0].failure.apiFailure.layer, 'api');
  assert.equal(result.state.bucketResults[0].failure.apiFailure.reasonCode, 'reddit_public_feed_fetch_failed');
});

test('reddit research task runner records sanitized API items when API execution succeeds', async (t) => {
  const root = await tempDir(t);
  await createBuildArtifacts(root);
  const result = await runRedditResearchTask(baseOptions(root, [
    '--task',
    'saved-history-archive',
    '--collection-mode',
    'api-first',
    '--allow-private-content',
    '--execute',
    '--max-buckets-per-run',
    '2',
  ]), {
    executeCommand: async () => ({
      exitCode: 0,
      stdout: `${JSON.stringify({
        ok: true,
        execution: {
          status: 'success',
          reasonCode: null,
          httpStatus: 200,
          items: [{
            id: 't3_1',
            itemType: 'post',
            title: 'SiteForge launch',
            author: 'example_author',
            selftext: 'raw field must not persist',
            body: 'raw body must not persist',
            rawBodyPersisted: false,
            authMaterialPersisted: false,
          }],
        },
      })}\n`,
      stderr: '',
    }),
  });

  assert.equal(result.summary.apiCompletedBucketCount, 2);
  assert.equal(result.summary.siteFallbackBucketCount, 0);
  assert.equal(result.summary.dedupedItemCount >= 1, true);
  const items = await fs.readFile(path.join(root, 'out', 'items.jsonl'), 'utf8');
  assert.doesNotMatch(items, /raw field must not persist/);
  assert.doesNotMatch(items, /raw body must not persist/);
  assert.match(items, /explicit_allow_private_content/);
  assert.match(items, /privateContentFields/);
  const accounts = await fs.readFile(path.join(root, 'out', 'accounts.jsonl'), 'utf8');
  assert.match(accounts, /example_author/);
});

test('reddit research task runner gates private API items without explicit authorization', async (t) => {
  const root = await tempDir(t);
  await createBuildArtifacts(root);
  const result = await runRedditResearchTask(baseOptions(root, [
    '--task',
    'saved-history-archive',
    '--collection-mode',
    'api-first',
    '--execute',
    '--max-buckets-per-run',
    '1',
  ]), {
    executeCommand: async () => ({
      exitCode: 0,
      stdout: `${JSON.stringify({
        ok: true,
        execution: {
          status: 'success',
          reasonCode: null,
          httpStatus: 200,
          items: [{
            id: 't3_private_1',
            itemType: 'post',
            title: 'Private saved item',
            author: 'private_author',
          }],
        },
      }, null, 2)}\n`,
      stderr: '',
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.apiCompletedBucketCount, 0);
  assert.equal(result.summary.siteFallbackBucketCount, 1);
  const savedResult = result.state.bucketResults.find((bucketResult) => bucketResult.bucketId === 'saved-route-structure');
  assert.equal(savedResult.api.status, 'blocked');
  assert.equal(savedResult.api.reasonCode, 'private_content_authorization_required');
  assert.equal(savedResult.failure.apiFailure.layer, 'safety');
  const items = await fs.readFile(path.join(root, 'out', 'items.jsonl'), 'utf8');
  assert.doesNotMatch(items, /Private saved item/);
  assert.match(items, /verified_site_route_summary/);
});

test('reddit research task runner writes actionable planner failure for missing parameters', async (t) => {
  const root = await tempDir(t);
  const result = await runRedditResearchTask(baseOptions(root, [
    '--task',
    'subreddit-full-archive',
  ]));

  assert.equal(result.ok, false);
  assert.equal(result.summary.status, 'blocked');
  assert.deepEqual(result.state.bucketResults[0].failure.missingParameters, ['subreddit']);
  assert.equal(result.state.bucketResults[0].failure.layer, 'planner');
});
