import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildTaskPlan,
  executeCommand,
  findActiveRateLimitSurfaces,
  isApiLocalStall,
  parseArgs,
  runXResearchTask,
} from '../../scripts/x-research-task-runner.mjs';
import { selectSocialApiSeed } from '../../src/sites/known-sites/social/actions/router.mjs';
import { createSocialMediaDownloadReport } from '../../src/sites/known-sites/social/actions/download-boundary.mjs';

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'siteforge-x-research-task-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function writeJsonl(filePath, rows) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseJsonLine(line) {
  return JSON.parse(line);
}

function baseOptions(root, args) {
  return parseArgs([
    ...args,
    '--out-dir',
    path.join(root, 'out'),
    '--runs-root',
    path.join(root, 'runs'),
    '--now',
    '2026-06-02',
  ]);
}

test('x research task runner builds the six supported task plans', async (t) => {
  const root = await tempDir(t);
  const cases = [
    [['--task', 'account-full-archive', '--account', 'dotey'], ['posts', 'replies', 'media', 'following', 'highlights']],
    [['--task', 'keyword-trend', '--query', 'codex与claude', '--from', '2026-05-01', '--to', '2026-06-01'], ['trend-codex-zh-2026-05-01-2026-06-01', 'trend-claude-en-2026-05-01-2026-06-01']],
    [['--task', 'account-composite-profile', '--account', 'YueTongLi_pler'], ['following', 'followers', 'profile-likes-route']],
    [['--task', 'industry-report', '--query', 'agent'], ['industry-weekly-zh', 'industry-monthly-en']],
    [['--task', 'event-timeline', '--query', 'gpt5.6', '--from', '2026-05-01', '--to', '2026-06-01'], ['event-zh-2026-05-01-2026-06-01']],
    [['--task', 'similar-account-discovery', '--account', 'Lili_amamiya22'], ['seed-posts', 'candidate-search-en']],
  ];

  for (const [argv, expectedBucketIds] of cases) {
    const plan = buildTaskPlan(baseOptions(root, argv));
    assert.equal(plan.schemaVersion, 1);
    assert.equal(plan.buckets.length > 0, true);
    for (const expectedId of expectedBucketIds) {
      assert.equal(plan.buckets.some((bucket) => bucket.id === expectedId), true, `${plan.task.id} missing ${expectedId}`);
    }
    assert.equal(plan.task.noStallPolicy.apiLocalStallFallback, 'immediate-page-fallback');
    assert.equal(plan.buckets.every((bucket) => Array.isArray(bucket.command)), true);
  }
});

test('x research account archive includes following but not followers by default', async (t) => {
  const root = await tempDir(t);
  const plan = buildTaskPlan(baseOptions(root, [
    '--task',
    'account-full-archive',
    '--account',
    'dotey',
  ]));

  assert.equal(plan.buckets.some((bucket) => bucket.id === 'following'), true);
  assert.equal(plan.buckets.some((bucket) => bucket.id === 'followers'), false);
  const following = plan.buckets.find((bucket) => bucket.id === 'following');
  assert.equal(following.action, 'profile-following');
  assert.equal(following.command.includes('--max-users'), true);
  assert.equal(plan.task.defaults.downloadMedia, true);
  assert.equal(plan.task.defaults.mediaDownloadLimit, 0);
  assert.equal(plan.layout.archiveManifestPath.endsWith('archive-manifest.json'), true);
  assert.equal(plan.layout.mediaDir.includes(`${path.sep}archive${path.sep}media`), true);
});

test('x account articles route does not reuse generic home timeline API seeds', () => {
  const config = { siteKey: 'x' };
  const plan = {
    siteKey: 'x',
    action: 'read-route',
    routeName: 'account-articles',
    routePath: '/{account}/articles',
    account: 'HiTw93',
  };
  const homeTimeline = {
    response: {
      url: 'https://x.com/i/api/graphql/home/HomeLatestTimeline',
      status: 200,
      operationName: 'HomeLatestTimeline',
      json: {},
    },
    parsed: {
      items: [{
        id: 'home-1',
        text: 'home timeline item',
        timestamp: '2026-06-01T00:00:00.000Z',
        author: { handle: 'someone' },
      }],
      nextCursor: 'home-cursor',
    },
  };
  const articleTimeline = {
    response: {
      url: 'https://x.com/i/api/graphql/articles/UserArticles',
      status: 200,
      operationName: 'UserArticles',
      json: {},
    },
    parsed: {
      items: [{
        id: 'article-1',
        text: 'article timeline item',
        timestamp: '2026-06-01T00:00:00.000Z',
        author: { handle: 'HiTw93' },
      }],
      nextCursor: 'article-cursor',
    },
  };

  assert.equal(selectSocialApiSeed([homeTimeline], config, plan), null);
  assert.equal(selectSocialApiSeed([homeTimeline, articleTimeline], config, plan), articleTimeline);
});

test('x research account archive saves following users into local accounts artifacts', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');

  const result = await runXResearchTask(parseArgs([
    '--task',
    'account-full-archive',
    '--account',
    'dotey',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
    '--max-buckets-per-run',
    '0',
  ]), {
    findActiveCooldownSurfaces: async () => ({ active: false, surfaces: [] }),
    executeCommand: async (_command, args) => {
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const runDir = path.join(runsRoot, artifactRunId);
      const itemsPath = path.join(runDir, 'items.jsonl');
      const usersPath = path.join(runDir, 'users.jsonl');
      const isFollowing = artifactRunId.includes('following');
      const items = isFollowing ? [] : [{
        id: `${artifactRunId}-item`,
        url: 'https://x.com/dotey/status/123',
        text: 'account archive item',
        createdAt: '2026-05-15T00:00:00.000Z',
      }];
      const users = isFollowing ? [
        { handle: 'followed_one', name: 'Followed One' },
        { handle: 'followed_two', name: 'Followed Two' },
      ] : [];
      await writeJsonl(itemsPath, items);
      await writeJsonl(usersPath, users);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          outcome: { status: 'completed' },
          runtimeRisk: { rateLimited: false, hardStop: false },
          result: { items, users },
          artifacts: { items: itemsPath, users: usersPath, runDir },
        })}\n`,
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  const accounts = (await fs.readFile(path.join(outDir, 'accounts.jsonl'), 'utf8')).trim().split('\n').map(parseJsonLine);
  assert.equal(accounts.some((account) => account.handle === 'followed_one' && account.bucketId === 'following'), true);
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
  const followingCoverage = summary.analysis.archiveCoverage.find((bucket) => bucket.id === 'following');
  assert.equal(followingCoverage.userCount, 2);
  assert.equal(summary.quality.zeroEvidenceBuckets.includes('following'), false);
});

test('x research task runner preserves partial following users after command timeout', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');
  let followingTimeoutMs = 0;

  const result = await runXResearchTask(parseArgs([
    '--task',
    'account-full-archive',
    '--account',
    'dotey',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
    '--max-buckets-per-run',
    '0',
  ]), {
    findActiveCooldownSurfaces: async () => ({ active: false, surfaces: [] }),
    executeCommand: async (_command, args, commandOptions = {}) => {
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const runDir = path.join(runsRoot, artifactRunId);
      const itemsPath = path.join(runDir, 'items.jsonl');
      const statePath = path.join(runDir, 'state.json');
      await fs.mkdir(runDir, { recursive: true });
      if (artifactRunId.includes('following')) {
        followingTimeoutMs = commandOptions.timeoutMs;
        await writeJsonl(itemsPath, [
          { kind: 'user', handle: 'partial_followed', name: 'Partial Followed' },
        ]);
        await fs.writeFile(statePath, JSON.stringify({
          artifacts: {
            runDir,
            items: itemsPath,
            state: statePath,
          },
          archive: {
            strategy: 'api-relation',
            reason: 'max-api-pages',
            pages: 12,
            nextCursor: 'cursor-12',
          },
        }), 'utf8');
        return {
          exitCode: 124,
          stdout: '',
          stderr: 'runner-timeout-ms=150000',
        };
      }

      const item = {
        id: `${artifactRunId}-item`,
        url: 'https://x.com/dotey/status/123',
        text: 'account archive item',
        createdAt: '2026-05-15T00:00:00.000Z',
      };
      await writeJsonl(itemsPath, [item]);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          outcome: { status: 'completed' },
          runtimeRisk: { rateLimited: false, hardStop: false },
          result: { items: [item], users: [] },
          artifacts: { items: itemsPath, runDir },
        })}\n`,
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(followingTimeoutMs > 150_000, true);
  const accounts = (await fs.readFile(path.join(outDir, 'accounts.jsonl'), 'utf8')).trim().split('\n').map(parseJsonLine);
  assert.equal(accounts.some((account) => account.handle === 'partial_followed' && account.bucketId === 'following'), true);
  const state = JSON.parse(await fs.readFile(path.join(outDir, 'task-state.json'), 'utf8'));
  const following = state.buckets.find((bucket) => bucket.id === 'following');
  assert.equal(following.status, 'captured-with-warning');
  assert.equal(following.noWaitFallback.source, 'partial-artifact');
  assert.equal(following.noWaitFallback.users, 1);
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
  const followingCoverage = summary.analysis.archiveCoverage.find((bucket) => bucket.id === 'following');
  assert.equal(followingCoverage.userCount, 1);
  assert.equal(summary.quality.zeroEvidenceBuckets.includes('following'), false);
});

test('x research task runner backfills failed media bucket from local media evidence', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');

  const result = await runXResearchTask(parseArgs([
    '--task',
    'account-full-archive',
    '--account',
    'dotey',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
    '--max-buckets-per-run',
    '0',
    '--no-download-media',
  ]), {
    findActiveCooldownSurfaces: async () => ({ active: false, surfaces: [] }),
    executeCommand: async (_command, args) => {
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const runDir = path.join(runsRoot, artifactRunId);
      const itemsPath = path.join(runDir, 'items.jsonl');
      await fs.mkdir(runDir, { recursive: true });
      if (artifactRunId.includes('media')) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'Navigation failed: net::ERR_CONNECTION_CLOSED',
        };
      }
      const hasMedia = artifactRunId.includes('posts') || artifactRunId.includes('replies');
      const item = {
        id: `${artifactRunId}-item`,
        url: `https://x.com/dotey/status/${hasMedia ? '456' : '123'}`,
        text: 'account archive item',
        createdAt: '2026-05-15T00:00:00.000Z',
        media: hasMedia ? [{ type: 'image', url: 'https://pbs.twimg.com/media/example.jpg' }] : [],
      };
      await writeJsonl(itemsPath, [item]);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          outcome: { status: 'completed' },
          runtimeRisk: { rateLimited: false, hardStop: false },
          result: { items: [item], users: [] },
          artifacts: { items: itemsPath, runDir },
        })}\n`,
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  const state = JSON.parse(await fs.readFile(path.join(outDir, 'task-state.json'), 'utf8'));
  const media = state.buckets.find((bucket) => bucket.id === 'media');
  assert.equal(media.status, 'captured-with-warning');
  assert.equal(media.noWaitFallback.source, 'local-media-evidence');
  assert.equal(media.noWaitFallback.items > 0, true);
  assert.equal(media.noWaitFallback.media > 0, true);
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
  assert.equal(summary.quality.zeroEvidenceBuckets.includes('media'), false);
  const mediaCoverage = summary.analysis.archiveCoverage.find((bucket) => bucket.id === 'media');
  assert.equal(mediaCoverage.mediaCount > 0, true);
});

test('x research task runner plans page-first collection for search tasks', async (t) => {
  const root = await tempDir(t);
  const plan = buildTaskPlan(baseOptions(root, [
    '--task',
    'keyword-trend',
    '--query',
    'codex',
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
  ]));

  assert.equal(plan.task.collectionMode, 'page');
  assert.equal(plan.buckets.every((bucket) => bucket.command.includes('--no-api-cursor')), true);
  assert.equal(plan.buckets.every((bucket) => bucket.fallbackCommand === null), true);
});

test('x research task runner defaults search execution to one bucket per invocation', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');
  let calls = 0;

  const result = await runXResearchTask(parseArgs([
    '--task',
    'keyword-trend',
    '--query',
    'codex',
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
  ]), {
    findActiveCooldownSurfaces: async () => ({ active: false, surfaces: [] }),
    executeCommand: async (_command, args) => {
      calls += 1;
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const itemsPath = path.join(runsRoot, artifactRunId, 'items.jsonl');
      await writeJsonl(itemsPath, [{
        id: `search-${calls}`,
        text: 'codex usage',
        username: 'tester',
        createdAt: '2026-05-15T00:00:00.000Z',
      }]);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          outcome: { status: 'completed' },
          runtimeRisk: { rateLimited: false, hardStop: false },
          result: { items: [{ id: `search-${calls}` }] },
          artifacts: { items: itemsPath, runDir: path.dirname(itemsPath) },
        })}\n`,
        stderr: '',
      };
    },
  });

  assert.equal(result.executedBuckets, 1);
  assert.equal(calls, 1);
  const plan = JSON.parse(await fs.readFile(path.join(outDir, 'task-plan.json'), 'utf8'));
  assert.equal(plan.task.defaults.maxBucketsPerRun, 1);
  assert.equal(plan.task.defaults.bucketDelayMs, 0);
});

test('x research task runner delays between explicitly unbounded search buckets', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');
  let calls = 0;
  const sleeps = [];

  const result = await runXResearchTask(parseArgs([
    '--task',
    'keyword-trend',
    '--query',
    'codex',
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
    '--max-buckets-per-run',
    '0',
    '--bucket-delay-ms',
    '123',
  ]), {
    findActiveCooldownSurfaces: async () => ({ active: false, surfaces: [] }),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    executeCommand: async (_command, args) => {
      calls += 1;
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const itemsPath = path.join(runsRoot, artifactRunId, 'items.jsonl');
      await writeJsonl(itemsPath, [{
        id: `search-${calls}`,
        text: 'codex usage',
        username: 'tester',
        createdAt: '2026-05-15T00:00:00.000Z',
      }]);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          outcome: { status: 'completed' },
          runtimeRisk: { rateLimited: false, hardStop: false },
          result: { items: [{ id: `search-${calls}` }] },
          artifacts: { items: itemsPath, runDir: path.dirname(itemsPath) },
        })}\n`,
        stderr: '',
      };
    },
  });

  assert.equal(result.executedBuckets, 2);
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [123]);
});

test('x research task runner derives item authors from X status URLs', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');

  const result = await runXResearchTask(parseArgs([
    '--task',
    'keyword-trend',
    '--query',
    'codex',
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
  ]), {
    findActiveCooldownSurfaces: async () => ({ active: false, surfaces: [] }),
    executeCommand: async (_command, args) => {
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const itemsPath = path.join(runsRoot, artifactRunId, 'items.jsonl');
      await writeJsonl(itemsPath, [{
        id: 'search-1',
        url: 'https://x.com/RealAuthor/status/123',
        text: 'codex usage',
        author: { handle: 'ViewerAccount' },
        createdAt: '2026-05-15T00:00:00.000Z',
      }]);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          outcome: { status: 'completed' },
          runtimeRisk: { rateLimited: false, hardStop: false },
          result: { items: [{ id: 'search-1' }] },
          artifacts: { items: itemsPath, runDir: path.dirname(itemsPath) },
        })}\n`,
        stderr: '',
      };
    },
  });

  assert.equal(result.executedBuckets, 1);
  const [itemLine] = (await fs.readFile(path.join(outDir, 'deduped-items.jsonl'), 'utf8')).trim().split('\n');
  const item = JSON.parse(itemLine);
  assert.equal(item.author.handle, 'RealAuthor');
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
  assert.equal(summary.analysis.topAuthors[0].value, 'RealAuthor');
});

test('x research task runner maps internal X status URLs to source account', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');

  await runXResearchTask(parseArgs([
    '--task',
    'account-full-archive',
    '--account',
    'dotey',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
    '--max-buckets-per-run',
    '1',
  ]), {
    findActiveCooldownSurfaces: async () => ({ active: false, surfaces: [] }),
    executeCommand: async (_command, args) => {
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const itemsPath = path.join(runsRoot, artifactRunId, 'items.jsonl');
      await writeJsonl(itemsPath, [{
        id: 'internal-1',
        url: 'https://x.com/i/status/123',
        text: 'internal article path',
        author: { handle: 'i' },
        sourceAccount: 'dotey',
        timestamp: '2026-05-15T00:00:00.000Z',
      }]);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          outcome: { status: 'completed' },
          runtimeRisk: { rateLimited: false, hardStop: false },
          result: { items: [{ id: 'internal-1' }] },
          artifacts: { items: itemsPath, runDir: path.dirname(itemsPath) },
        })}\n`,
        stderr: '',
      };
    },
  });

  const [itemLine] = (await fs.readFile(path.join(outDir, 'deduped-items.jsonl'), 'utf8')).trim().split('\n');
  const item = JSON.parse(itemLine);
  assert.equal(item.author.handle, 'dotey');
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
  assert.equal(summary.analysis.topAuthors[0].value, 'dotey');
});

test('x research task runner writes media archive manifests and downloads requested media', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');

  const result = await runXResearchTask(parseArgs([
    '--task',
    'account-full-archive',
    '--account',
    'dotey',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
    '--max-buckets-per-run',
    '1',
    '--download-media',
    '--media-download-limit',
    '0',
  ]), {
    findActiveCooldownSurfaces: async () => ({ active: false, surfaces: [] }),
    executeCommand: async (_command, args) => {
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const itemsPath = path.join(runsRoot, artifactRunId, 'items.jsonl');
      await writeJsonl(itemsPath, [{
        id: 'media-1',
        url: 'https://x.com/dotey/status/123',
        text: 'I love Codex growth and revenue momentum',
        createdAt: '2026-05-15T00:00:00.000Z',
        media: [{
          type: 'photo',
          url: 'data:image/png;base64,iVBORw0KGgo=',
        }, {
          type: 'video',
          video_info: {
            duration_millis: 1000,
            variants: [{
              content_type: 'video/mp4',
              bitrate: 128000,
              url: 'data:video/mp4;base64,AAAAIGZ0eXBpc29t',
            }],
          },
        }],
      }]);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          outcome: { status: 'completed' },
          runtimeRisk: { rateLimited: false, hardStop: false },
          result: { items: [{ id: 'media-1' }] },
          artifacts: { items: itemsPath, runDir: path.dirname(itemsPath) },
        })}\n`,
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  const mediaSummary = JSON.parse(await fs.readFile(path.join(outDir, 'media-assets.json'), 'utf8'));
  assert.equal(mediaSummary.unlimited, true);
  assert.equal(mediaSummary.counts.total, 2);
  assert.equal(mediaSummary.counts.images, 1);
  assert.equal(mediaSummary.counts.videos, 1);
  assert.equal(mediaSummary.counts.downloaded, 2);
  const records = (await fs.readFile(path.join(outDir, 'media-assets.jsonl'), 'utf8')).trim().split('\n').map(parseJsonLine);
  assert.equal(records.every((record) => record.status === 'downloaded'), true);
  assert.equal(records.some((record) => record.type === 'image' && record.localPath.includes(`${path.sep}images${path.sep}`)), true);
  assert.equal(records.some((record) => record.type === 'video' && record.localPath.includes(`${path.sep}videos${path.sep}`)), true);
  for (const record of records) {
    const stat = await fs.stat(record.localPath);
    assert.equal(stat.size > 0, true);
  }
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
  assert.equal(summary.mediaArchive.counts.downloaded, 2);
  assert.equal(summary.analysis.sentiment.positive, 1);
  assert.equal(summary.analysis.investmentSignals.adoption.count, 1);
  assert.equal(summary.analysis.investmentSignals.monetization.count, 1);
  assert.equal(summary.analysis.representativeItems.length, 1);
});

test('x research account archive writes offline markdown posts articles media and following list', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');

  const result = await runXResearchTask(parseArgs([
    '--task',
    'account-full-archive',
    '--account',
    'dotey',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
  ]), {
    findActiveCooldownSurfaces: async () => ({ active: false, surfaces: [] }),
    executeCommand: async (_command, args) => {
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const runDir = path.join(runsRoot, artifactRunId);
      const itemsPath = path.join(runDir, 'items.jsonl');
      const usersPath = path.join(runDir, 'users.jsonl');
      let items = [];
      let users = [];
      if (artifactRunId.includes('posts')) {
        items = [{
          id: 'post-1',
          url: 'https://x.com/dotey/status/111',
          text: 'Post body with local image',
          createdAt: '2026-05-15T10:00:00.000Z',
          favorite_count: 3,
          media: [{ type: 'photo', url: 'data:image/jpeg;base64,aGVsbG8=' }],
        }];
      } else if (artifactRunId.includes('media')) {
        items = [{
          id: 'video-post-1',
          url: 'https://x.com/dotey/status/222',
          text: 'Video post body',
          createdAt: '2026-05-15T11:00:00.000Z',
          media: [{
            type: 'video',
            video_info: {
              variants: [{ content_type: 'video/mp4', bitrate: 256000, url: 'data:video/mp4;base64,AAAAIGZ0eXBpc29t' }],
            },
          }],
        }];
      } else if (artifactRunId.includes('following')) {
        users = [{
          id: 'followed-1',
          handle: 'followed_builder',
          displayName: 'Followed Builder',
          description: 'Builds useful things',
          profileImageUrl: 'data:image/jpeg;base64,YXZhdGFy',
          profileBannerUrl: 'data:image/jpeg;base64,YmFubmVy',
        }];
      } else if (artifactRunId.includes('articles-route')) {
        items = [{
          id: 'article-1',
          url: 'https://x.com/dotey/articles/333',
          title: 'Article Title',
          text: 'Article body paragraph\n\nSecond paragraph',
          createdAt: '2026-05-16T09:00:00.000Z',
          author: { handle: 'dotey' },
          media: [{ type: 'photo', url: 'data:image/jpeg;base64,YXJ0aWNsZQ==' }],
        }];
      }
      await writeJsonl(itemsPath, items);
      await writeJsonl(usersPath, users);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          outcome: { status: 'completed' },
          runtimeRisk: { rateLimited: false, hardStop: false },
          result: { items, users },
          artifacts: { items: itemsPath, users: usersPath, runDir },
        })}\n`,
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  const manifest = JSON.parse(await fs.readFile(path.join(outDir, 'archive-manifest.json'), 'utf8'));
  assert.equal(manifest.offlineComplete, true);
  assert.equal(manifest.counts.posts, 2);
  assert.equal(manifest.counts.articles, 1);
  assert.equal(manifest.counts.following, 1);
  assert.equal(manifest.counts.mediaDownloaded, 5);
  assert.equal(manifest.counts.mediaTotal, 5);
  assert.equal(manifest.validation.status, 'passed');
  assert.equal(manifest.incremental.resumable, true);
  assert.equal(manifest.incremental.checksumValidation, true);
  const postFiles = await fs.readdir(path.join(outDir, 'archive', 'posts'));
  const articleFiles = await fs.readdir(path.join(outDir, 'archive', 'articles'));
  assert.equal(postFiles.filter((name) => name.endsWith('.md')).length, 2);
  assert.equal(articleFiles.filter((name) => name.endsWith('.md')).length, 1);
  const postFile = postFiles.find((name) => name.includes('post-1'));
  assert.match(postFile, /^2026-05-15_10-00-00_post-1\.md$/u);
  const postMarkdown = await fs.readFile(path.join(outDir, 'archive', 'posts', postFile), 'utf8');
  assert.equal(postMarkdown.startsWith('---\n'), true);
  assert.match(postMarkdown, /type: "post"/u);
  assert.match(postMarkdown, /x_id: "post-1"/u);
  assert.match(postMarkdown, /has_media: true/u);
  assert.match(postMarkdown, /media_count: 1/u);
  assert.match(postMarkdown, /Post body with local image/u);
  assert.match(postMarkdown, /\.\.\/media\/images\//u);
  assert.doesNotMatch(postMarkdown, /data:image|data:video/u);
  const articleMarkdown = await fs.readFile(path.join(outDir, 'archive', 'articles', articleFiles[0]), 'utf8');
  assert.match(articleMarkdown, /# Article Title/u);
  assert.match(articleMarkdown, /\.\.\/media\/images\//u);
  const followingMarkdown = await fs.readFile(path.join(outDir, 'archive', 'following.md'), 'utf8');
  assert.match(followingMarkdown, /Followed Builder/u);
  assert.match(followingMarkdown, /@followed_builder/u);
  assert.match(followingMarkdown, /media\/images\//u);
  const followingJson = JSON.parse(await fs.readFile(path.join(outDir, 'archive', 'following.json'), 'utf8'));
  assert.equal(followingJson[0].handle, 'followed_builder');
  assert.equal(followingJson[0].avatarStatus, 'downloaded');
  assert.equal(followingJson[0].bannerStatus, 'downloaded');
  assert.match(followingJson[0].avatarLocalPath, /^media\/images\//u);
  const followingCsv = await fs.readFile(path.join(outDir, 'archive', 'following.csv'), 'utf8');
  assert.match(followingCsv, /displayName,handle,userId,bio,profileUrl,avatarLocalPath,bannerLocalPath/u);
  const imageFiles = await fs.readdir(path.join(outDir, 'archive', 'media', 'images'));
  const videoFiles = await fs.readdir(path.join(outDir, 'archive', 'media', 'videos'));
  assert.equal(imageFiles.length, 4);
  assert.equal(videoFiles.length, 1);
  const rawMediaManifest = JSON.parse(await fs.readFile(path.join(outDir, 'archive', 'raw', 'media_manifest.json'), 'utf8'));
  assert.equal(rawMediaManifest.records.length, 5);
  assert.equal((await fs.readFile(path.join(outDir, 'archive', 'raw', 'posts.jsonl'), 'utf8')).trim().split('\n').length, 2);
  assert.equal((await fs.readFile(path.join(outDir, 'archive', 'raw', 'articles.jsonl'), 'utf8')).trim().split('\n').length, 1);
  assert.equal(JSON.parse(await fs.readFile(path.join(outDir, 'archive', 'raw', 'following.json'), 'utf8')).rows.length, 1);
  assert.equal(JSON.parse(await fs.readFile(path.join(outDir, 'archive', 'raw', 'archive_manifest.json'), 'utf8')).offlineComplete, true);
  assert.match(await fs.readFile(path.join(outDir, 'archive', 'index.md'), 'utf8'), /Posts index/u);
  assert.match(await fs.readFile(path.join(outDir, 'archive', 'posts_index.md'), 'utf8'), /post-1/u);
  assert.match(await fs.readFile(path.join(outDir, 'archive', 'articles_index.md'), 'utf8'), /article-1/u);
  assert.match(await fs.readFile(path.join(outDir, 'archive', 'media_index.md'), 'utf8'), /downloaded/u);
  assert.match(await fs.readFile(path.join(outDir, 'archive', 'archive_report.md'), 'utf8'), /Validation status: passed/u);
  assert.equal(await fs.readFile(path.join(outDir, 'archive', 'errors.log'), 'utf8'), 'No errors.\n');
  const checksumManifest = JSON.parse(await fs.readFile(path.join(outDir, 'archive', 'checksum_manifest.json'), 'utf8'));
  assert.equal(checksumManifest.algorithm, 'sha256');
  assert.equal(checksumManifest.files.some((file) => file.relativePath === 'following.json'), true);
  assert.equal(checksumManifest.files.some((file) => file.relativePath.includes('media/images/')), true);
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
  assert.equal(summary.task.defaults.downloadMedia, true);
  assert.equal(summary.task.defaults.mediaDownloadLimit, 0);
  assert.equal(summary.mediaArchive.counts.downloaded, 5);
  assert.equal(summary.offlineArchive.offlineComplete, true);
});

test('x research account archive applies offline time range filters', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');

  const result = await runXResearchTask(parseArgs([
    '--task',
    'account-full-archive',
    '--account',
    'dotey',
    '--from',
    '2026-05-16',
    '--to',
    '2026-05-17',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
  ]), {
    findActiveCooldownSurfaces: async () => ({ active: false, surfaces: [] }),
    executeCommand: async (_command, args) => {
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const runDir = path.join(runsRoot, artifactRunId);
      const itemsPath = path.join(runDir, 'items.jsonl');
      const usersPath = path.join(runDir, 'users.jsonl');
      let items = [];
      if (artifactRunId.includes('posts')) {
        items = [{
          id: 'out-of-range-post',
          url: 'https://x.com/dotey/status/111',
          text: 'Outside range',
          createdAt: '2026-05-15T10:00:00.000Z',
        }];
      } else if (artifactRunId.includes('articles-route')) {
        items = [{
          id: 'in-range-article',
          url: 'https://x.com/dotey/articles/333',
          title: 'In Range Article',
          text: 'Inside range',
          createdAt: '2026-05-16T09:00:00.000Z',
        }];
      }
      await writeJsonl(itemsPath, items);
      await writeJsonl(usersPath, []);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          outcome: { status: 'completed' },
          runtimeRisk: { rateLimited: false, hardStop: false },
          result: { items, users: [] },
          artifacts: { items: itemsPath, users: usersPath, runDir },
        })}\n`,
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  const manifest = JSON.parse(await fs.readFile(path.join(outDir, 'archive-manifest.json'), 'utf8'));
  assert.equal(manifest.counts.posts, 0);
  assert.equal(manifest.counts.articles, 1);
  assert.equal(manifest.counts.rangeFilteredOutPosts, 1);
  assert.equal(manifest.counts.rangeFilteredOutArticles, 0);
  assert.equal(manifest.incremental.timeRange.from, '2026-05-16');
  assert.equal(manifest.incremental.timeRange.to, '2026-05-17');
  assert.equal((await fs.readdir(path.join(outDir, 'archive', 'posts'))).filter((name) => name.endsWith('.md')).length, 0);
  assert.equal((await fs.readdir(path.join(outDir, 'archive', 'articles'))).filter((name) => name.endsWith('.md')).length, 1);
  assert.equal(await fs.readFile(path.join(outDir, 'archive', 'raw', 'posts.jsonl'), 'utf8'), '');
  assert.equal((await fs.readFile(path.join(outDir, 'archive', 'raw', 'articles.jsonl'), 'utf8')).includes('in-range-article'), true);
});

test('social media downloader saves standalone payload media arrays', async (t) => {
  const root = await tempDir(t);
  const mediaDir = path.join(root, 'media');

  const report = await createSocialMediaDownloadReport({
    payload: {
      finalUrl: 'https://x.com/dotey',
      media: [{
        type: 'photo',
        url: 'data:image/png;base64,iVBORw0KGgo=',
      }],
    },
    mediaDir,
    limit: 0,
  });

  assert.equal(report.blocked, false);
  assert.equal(report.expectedMedia.length, 1);
  assert.equal(report.downloads.length, 1);
  assert.equal(report.downloads[0].status, 'downloaded');
  assert.equal(report.downloads[0].localPath.includes(`${path.sep}images${path.sep}`), true);
  const stat = await fs.stat(report.downloads[0].localPath);
  assert.equal(stat.size > 0, true);
});

test('x research task runner expands event version queries', async (t) => {
  const root = await tempDir(t);
  const plan = buildTaskPlan(baseOptions(root, [
    '--task',
    'event-timeline',
    '--query',
    'gpt5.6',
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
  ]));
  assert.match(plan.buckets[0].query, /gpt5\.6/u);
  assert.match(plan.buckets[0].query, /"gpt 5\.6"/u);
  assert.match(plan.buckets[0].query, /"gpt-5\.6"/u);
});

test('x research task runner detects api-local stalls', () => {
  assert.equal(isApiLocalStall({
    outcome: { status: 'blocked-risk', reason: 'api-cursor-rate-limited' },
    runtimeRisk: {
      rateLimited: true,
      hardStop: false,
      stopReason: 'api-cursor-rate-limited',
      riskState: { state: 'rate_limited', taskId: 'x:api-cursor', scope: 'api' },
    },
  }), true);

  assert.equal(isApiLocalStall({
    outcome: { status: 'blocked-risk', reason: 'rate-limited' },
    runtimeRisk: {
      rateLimited: true,
      hardStop: true,
      stopReason: 'rate-limited',
      riskState: { state: 'rate_limited', taskId: 'x:search' },
    },
  }), false);
});

test('x research task runner command watchdog kills hung child processes', async () => {
  const result = await executeCommand(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], {
    timeoutMs: 50,
  });
  assert.equal(result.exitCode, 124);
  assert.equal(result.timedOut, true);
  assert.match(result.stderr, /runner-timeout-ms=50/u);
});

test('x research task runner immediately falls back from api stall to page collection', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');
  const calls = [];

  const result = await runXResearchTask(parseArgs([
    '--task',
    'account-full-archive',
    '--account',
    'dotey',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
    '--max-buckets-per-run',
    '1',
  ]), {
    executeCommand: async (_command, args) => {
      calls.push(args);
      if (calls.length === 1) {
        assert.equal(args.includes('--api-cursor'), true);
        const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
        const primaryItemsPath = path.join(runsRoot, `${artifactRunId}-api`, 'items.jsonl');
        await writeJsonl(primaryItemsPath, [{
          id: 'api-1',
          text: 'primary api partial item',
          username: 'dotey',
          createdAt: '2026-06-01T00:00:00.000Z',
        }]);
        return {
          exitCode: 0,
          stdout: `${JSON.stringify({
            ok: false,
            outcome: { status: 'blocked-risk', reason: 'api-cursor-rate-limited' },
            runtimeRisk: {
              rateLimited: true,
              hardStop: false,
              stopReason: 'api-cursor-rate-limited',
                riskState: { state: 'rate_limited', taskId: 'x:api-cursor', scope: 'api' },
              },
            result: { items: [{ id: 'api-1' }] },
            artifacts: { items: primaryItemsPath, runDir: path.dirname(primaryItemsPath) },
          })}\n`,
          stderr: '',
        };
      }
      assert.equal(args.includes('--no-api-cursor'), true);
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const itemsPath = path.join(runsRoot, artifactRunId, 'items.jsonl');
      await writeJsonl(itemsPath, [{
        id: 'page-1',
        text: 'fallback item',
        username: 'dotey',
        createdAt: '2026-06-01T00:00:00.000Z',
      }]);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          outcome: { status: 'completed' },
          runtimeRisk: { rateLimited: false, hardStop: false },
          result: { items: [{ id: 'page-1' }] },
          artifacts: { items: itemsPath, runDir: path.dirname(itemsPath) },
        })}\n`,
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  const state = JSON.parse(await fs.readFile(path.join(outDir, 'task-state.json'), 'utf8'));
  assert.equal(state.buckets[0].status, 'completed');
  assert.equal(state.buckets[0].fallback.to, 'page');
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
  assert.equal(summary.evidenceCounts.dedupedItems, 2);
  const rows = (await fs.readFile(path.join(outDir, 'deduped-items.jsonl'), 'utf8')).trim().split('\n').map(parseJsonLine);
  assert.deepEqual(rows.map((row) => row._artifactSource).sort(), ['fallback', 'primary']);
});

test('x research task runner treats ordinary page fallback failure as failed', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');
  const calls = [];

  const result = await runXResearchTask(parseArgs([
    '--task',
    'account-full-archive',
    '--account',
    'dotey',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
    '--max-buckets-per-run',
    '1',
  ]), {
    executeCommand: async (_command, args) => {
      calls.push(args);
      if (calls.length === 1) {
        return {
          exitCode: 0,
          stdout: `${JSON.stringify({
            ok: false,
            outcome: { status: 'blocked-risk', reason: 'api-cursor-rate-limited' },
            runtimeRisk: {
              rateLimited: true,
              hardStop: false,
              stopReason: 'api-cursor-rate-limited',
              riskState: { state: 'rate_limited', taskId: 'x:api-cursor', scope: 'api' },
            },
          })}\n`,
          stderr: '',
        };
      }
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: false,
          outcome: { status: 'failed', reason: 'selector-drift' },
          runtimeRisk: { rateLimited: false, hardStop: false },
          artifacts: {},
        })}\n`,
        stderr: '',
      };
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  const state = JSON.parse(await fs.readFile(path.join(outDir, 'task-state.json'), 'utf8'));
  assert.equal(state.buckets[0].status, 'failed');
  assert.equal(state.buckets[0].error, 'selector-drift');
});

test('x research task runner checkpoints same-surface hard stops without losing task state', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');

  const result = await runXResearchTask(parseArgs([
    '--task',
    'keyword-trend',
    '--query',
    'codex',
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
    '--max-buckets-per-run',
    '1',
  ]), {
    executeCommand: async (_command, args) => {
      assert.equal(args.includes('--no-api-cursor'), true);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: false,
          outcome: { status: 'blocked-risk', reason: 'rate-limited' },
          runtimeRisk: {
            rateLimited: true,
            hardStop: true,
            stopReason: 'rate-limited',
            riskState: { state: 'rate_limited', taskId: 'x:search' },
          },
        })}\n`,
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'partial');
  const state = JSON.parse(await fs.readFile(path.join(outDir, 'task-state.json'), 'utf8'));
  assert.equal(state.buckets[0].status, 'captured-with-warning');
  assert.equal(state.buckets[0].noWaitFallback.source, 'empty-profile-backfill');
  const report = await fs.readFile(path.join(outDir, 'task-report.md'), 'utf8');
  assert.match(report, /no-wait continuation/u);
});

test('x research task runner resolves active search cooldowns without live search execution', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  let calls = 0;

  const result = await runXResearchTask(parseArgs([
    '--task',
    'keyword-trend',
    '--query',
    'codex',
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
    '--out-dir',
    outDir,
    '--runs-root',
    path.join(root, 'runs'),
    '--execute',
  ]), {
    findActiveCooldownSurfaces: async () => ({
      active: true,
      reportPath: path.join(root, 'report', 'social-live-report.json'),
      surfaces: ['search'],
    }),
    executeCommand: async () => {
      calls += 1;
      throw new Error('should not execute a preflight-blocked surface');
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'complete');
  assert.equal(calls, 0);
  const state = JSON.parse(await fs.readFile(path.join(outDir, 'task-state.json'), 'utf8'));
  assert.equal(state.buckets.every((bucket) => bucket.status === 'captured-with-warning'), true);
  assert.equal(state.buckets[0].skippedReason, 'preflight-active-rate-limit-empty-profile-backfill');
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
  assert.equal(summary.noStallPolicySatisfied, true);
  assert.equal(summary.verification.status, 'degraded-complete');
  const report = await fs.readFile(path.join(outDir, 'task-report.md'), 'utf8');
  assert.match(report, /Verification status: degraded-complete/u);
  assert.match(report, /No-stall ok: true/u);
});

test('x research task runner resolves non-search cooldowns as degraded terminal buckets', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  let calls = 0;

  const result = await runXResearchTask(parseArgs([
    '--task',
    'account-full-archive',
    '--account',
    'dotey',
    '--out-dir',
    outDir,
    '--runs-root',
    path.join(root, 'runs'),
    '--execute',
  ]), {
    findActiveCooldownSurfaces: async () => ({
      active: true,
      surfaces: [
        'account-info',
        'profile-content:posts',
        'profile-content:replies',
        'profile-content:media',
        'profile-following',
        'profile-content:highlights',
        'read-route:account-articles',
      ],
    }),
    executeCommand: async () => {
      calls += 1;
      throw new Error('should not execute preflight-blocked non-search surfaces');
    },
  });

  assert.equal(calls, 0);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'complete');
  const state = JSON.parse(await fs.readFile(path.join(outDir, 'task-state.json'), 'utf8'));
  assert.equal(state.buckets.every((bucket) => bucket.status === 'captured-with-warning'), true);
  assert.equal(state.buckets.every((bucket) => bucket.noWaitFallback?.source === 'empty-degraded-terminal'), true);
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
  assert.equal(summary.verification.status, 'degraded-complete');
  assert.equal(summary.bucketCounts.failed, 0);
});

test('x research task runner reuses local cache instead of live search during state cooldown', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');
  let calls = 0;

  await runXResearchTask(parseArgs([
    '--task',
    'keyword-trend',
    '--query',
    'codex',
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--dry-run',
  ]));

  await writeJsonl(path.join(runsRoot, 'cache-hit', 'items.jsonl'), [{
    id: 'cached-1',
    url: 'https://x.com/cache_author/status/123',
    text: 'codex usage cache hit',
    createdAt: '2026-05-15T00:00:00.000Z',
  }]);
  const statePath = path.join(outDir, 'task-state.json');
  const initialState = JSON.parse(await fs.readFile(statePath, 'utf8'));
  initialState.cooldowns = {
    search: {
      observedAt: new Date().toISOString(),
      reason: 'rate-limited',
      bucketId: 'trend-codex-zh-2026-05-01-2026-06-01',
    },
  };
  await fs.writeFile(statePath, `${JSON.stringify(initialState, null, 2)}\n`, 'utf8');

  const resumed = await runXResearchTask(parseArgs([
    '--task',
    'keyword-trend',
    '--query',
    'codex',
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
    '--resume',
    '--max-buckets-per-run',
    '1',
  ]), {
    findActiveCooldownSurfaces: async () => ({ active: false, surfaces: [] }),
    executeCommand: async () => {
      calls += 1;
      throw new Error('should not execute during state cooldown');
    },
  });

  assert.equal(calls, 0);
  assert.equal(resumed.status, 'complete');
  const state = JSON.parse(await fs.readFile(path.join(outDir, 'task-state.json'), 'utf8'));
  assert.equal(state.buckets[0].skippedReason, 'state-active-rate-limit-local-cache');
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
  assert.equal(summary.evidenceCounts.dedupedItems, 1);
});

test('x research task runner reuses task cache index before scanning live run files', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'tasks', 'out');
  const runsRoot = path.join(root, 'runs');
  let calls = 0;

  await runXResearchTask(parseArgs([
    '--task',
    'keyword-trend',
    '--query',
    'codex',
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--dry-run',
  ]));

  await writeJsonl(path.join(root, 'tasks', 'previous', 'cache-index.jsonl'), [{
    taskId: 'keyword-trend',
    bucketId: 'previous',
    sourceItemsPath: path.join(root, 'previous-items.jsonl'),
    item: {
      id: 'indexed-1',
      url: 'https://x.com/cache_index_author/status/123',
      text: 'codex usage from indexed cache',
      createdAt: '2026-05-15T00:00:00.000Z',
    },
  }]);

  const statePath = path.join(outDir, 'task-state.json');
  const initialState = JSON.parse(await fs.readFile(statePath, 'utf8'));
  initialState.cooldowns = {
    search: {
      observedAt: new Date().toISOString(),
      reason: 'rate-limited',
      bucketId: 'trend-codex-zh-2026-05-01-2026-06-01',
    },
  };
  await fs.writeFile(statePath, `${JSON.stringify(initialState, null, 2)}\n`, 'utf8');

  const resumed = await runXResearchTask(parseArgs([
    '--task',
    'keyword-trend',
    '--query',
    'codex',
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
    '--resume',
    '--max-buckets-per-run',
    '1',
  ]), {
    findActiveCooldownSurfaces: async () => ({ active: false, surfaces: [] }),
    executeCommand: async () => {
      calls += 1;
      throw new Error('should not execute during state cooldown');
    },
  });

  assert.equal(calls, 0);
  assert.equal(resumed.status, 'complete');
  const state = JSON.parse(await fs.readFile(path.join(outDir, 'task-state.json'), 'utf8'));
  assert.equal(state.buckets[0].skippedReason, 'state-active-rate-limit-cache-index');
  assert.equal(state.buckets[0].noWaitFallback.source, 'cache-index');
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
  assert.equal(summary.evidenceCounts.dedupedItems, 1);
});

test('x research task runner ranks similar accounts with structured similarity evidence', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');

  const result = await runXResearchTask(parseArgs([
    '--task',
    'similar-account-discovery',
    '--account',
    'SeedAcct',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
  ]), {
    findActiveCooldownSurfaces: async () => ({ active: false, surfaces: [] }),
    executeCommand: async (_command, args) => {
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const runDir = path.join(runsRoot, artifactRunId);
      const itemsPath = path.join(runDir, 'items.jsonl');
      const usersPath = path.join(runDir, 'users.jsonl');
      let items = [];
      let users = [];
      if (artifactRunId.includes('seed-posts')) {
        items = [{
          id: 'seed-post',
          url: 'https://x.com/SeedAcct/status/1',
          text: 'ai agents revenue growth roadmap',
          createdAt: '2026-05-15T00:00:00.000Z',
        }];
      } else if (artifactRunId.includes('seed-following')) {
        users = [{ handle: 'SimilarDev' }];
      } else if (artifactRunId.includes('candidate-search')) {
        items = [{
          id: 'candidate-post',
          url: 'https://x.com/SimilarDev/status/2',
          text: 'ai agents revenue growth roadmap for developers',
          createdAt: '2026-05-16T00:00:00.000Z',
        }];
      }
      await writeJsonl(itemsPath, items);
      await writeJsonl(usersPath, users);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          outcome: { status: 'completed' },
          runtimeRisk: { rateLimited: false, hardStop: false },
          result: { items, users },
          artifacts: { items: itemsPath, users: usersPath, runDir },
        })}\n`,
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
  const [candidate] = summary.analysis.candidateAccounts;
  assert.equal(candidate.handle, 'SimilarDev');
  assert.equal(candidate.priority, 'high');
  assert.equal(candidate.confidence, 'high');
  assert.equal(candidate.similarity.contentTermOverlap > 0, true);
  assert.equal(candidate.relationHits > 0, true);
});

test('x research task runner refills completed zero-item search buckets from local cache', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');
  let calls = 0;

  await runXResearchTask(parseArgs([
    '--task',
    'industry-report',
    '--query',
    'agent',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--dry-run',
  ]));
  await writeJsonl(path.join(runsRoot, 'cache-hit', 'items.jsonl'), [{
    id: 'agent-cache-1',
    url: 'https://x.com/cache_author/status/456',
    text: 'agent industry cache hit',
    createdAt: new Date().toISOString(),
  }]);
  const statePath = path.join(outDir, 'task-state.json');
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  state.buckets[0] = {
    ...state.buckets[0],
    status: 'completed',
    result: {
      ok: true,
      outcome: { status: 'passed' },
      artifacts: {},
      counts: { items: 0, users: 0, media: 0 },
    },
  };
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  const result = await runXResearchTask(parseArgs([
    '--task',
    'industry-report',
    '--query',
    'agent',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
    '--resume',
    '--max-buckets-per-run',
    '1',
  ]), {
    findActiveCooldownSurfaces: async () => ({ active: false, surfaces: [] }),
    executeCommand: async () => {
      calls += 1;
      throw new Error('should not live execute while refilling zero bucket');
    },
  });

  assert.equal(calls, 0);
  assert.equal(result.ok, true);
  const refreshed = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(refreshed.buckets[0].status, 'captured-with-warning');
  assert.equal(refreshed.buckets[0].noWaitFallback.source, 'local-cache');
});

test('x research task runner treats stale active rate-limit reports as cooldown-expired', async (t) => {
  const root = await tempDir(t);
  const reportPath = path.join(root, '.siteforge', 'x-live-report-test', 'social-live-report.json');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify({
    coverage: {
      x: {
        rateLimitBoundary: {
          activeRateLimitBlocker: true,
          activeBlockedSurfaces: ['read-route:profile-likes'],
          latestBlocker: {
            finishedAt: '2026-06-01T16:45:28.560Z',
          },
        },
      },
    },
  }, null, 2)}\n`, 'utf8');

  const fresh = await findActiveRateLimitSurfaces({
    runsRoot: path.join(root, '.siteforge', 'x-live-runs-skill'),
    cooldownMinutes: 30,
    now: new Date('2026-06-01T17:00:00.000Z'),
  });
  assert.equal(fresh.active, true);
  assert.deepEqual(fresh.surfaces, ['read-route:profile-likes']);

  const expired = await findActiveRateLimitSurfaces({
    runsRoot: path.join(root, '.siteforge', 'x-live-runs-skill'),
    cooldownMinutes: 30,
    now: new Date('2026-06-01T17:20:00.000Z'),
  });
  assert.equal(expired.active, false);
  assert.equal(expired.expiredActiveReport, true);
  assert.deepEqual(expired.surfaces, []);
});

test('x research task runner writes plan and report without live execution', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const result = await runXResearchTask(parseArgs([
    '--task',
    'similar-account-discovery',
    '--account',
    'Lili_amamiya22',
    '--out-dir',
    outDir,
    '--runs-root',
    path.join(root, 'runs'),
    '--dry-run',
  ]));

  assert.equal(result.ok, true);
  assert.equal(result.status, 'planned');
  await fs.access(path.join(outDir, 'task-plan.json'));
  await fs.access(path.join(outDir, 'task-state.json'));
  await fs.access(path.join(outDir, 'task-summary.json'));
  await fs.access(path.join(outDir, 'task-report.md'));
  await fs.access(path.join(outDir, 'cache-index.json'));
  await fs.access(path.join(outDir, 'cache-index.jsonl'));
  await fs.access(path.join(outDir, 'media-assets.json'));
  await fs.access(path.join(outDir, 'media-assets.jsonl'));
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
  assert.equal(summary.artifacts.cacheIndex.endsWith('cache-index.json'), true);
  assert.equal(summary.artifacts.mediaAssets.endsWith('media-assets.json'), true);
  assert.equal(summary.verification.status, 'not-verified');
  assert.equal(summary.evidenceCompleteness.grade, 'insufficient');
  assert.equal(summary.evidenceCompleteness.dimensions.some((dimension) => dimension.id === 'bucket-coverage'), true);
  const report = await fs.readFile(path.join(outDir, 'task-report.md'), 'utf8');
  assert.match(report, /Evidence completeness:/u);
  assert.match(report, /## Evidence Completeness/u);
});

test('x research task runner rejects resume when target fingerprint changes', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');

  await runXResearchTask(parseArgs([
    '--task',
    'keyword-trend',
    '--query',
    'codex',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--dry-run',
  ]));

  await assert.rejects(
    () => runXResearchTask(parseArgs([
      '--task',
      'keyword-trend',
      '--query',
      'claude',
      '--out-dir',
      outDir,
      '--runs-root',
      runsRoot,
      '--execute',
      '--resume',
    ]), {
      executeCommand: async () => {
        throw new Error('should not execute mismatched resume');
      },
    }),
    /resume target mismatch/u,
  );
});

async function createVerifiedBrowserBridgeBuild(root) {
  const buildDir = path.join(root, 'build');
  const basePage = {
    sourceLayer: 'authenticated',
    authRequired: true,
    authVerificationStatus: 'browser_verified_partial',
    evidenceStatus: 'structure_summary_present',
    riskLevel: 'read_personal_medium',
    links: [],
    controls: [],
    forms: [],
    structureItems: [{ kind: 'summary' }],
  };
  await writeJson(path.join(buildDir, 'crawl_authenticated.json'), {
    schemaVersion: 1,
    buildId: 'test-x-browser-bridge-build',
    siteId: 'x.com-test',
    authenticatedPages: [
      {
        ...basePage,
        normalizedUrl: 'https://x.com/OpenAI',
        routeTemplate: '/:account',
        routePath: '/:account',
        pageType: 'authenticated_browser_summary',
        evidenceLevel: 'browser_structure_verified',
        visibleItemCount: 1,
        listPresent: true,
        structureHash: 'browser-structure:profile',
      },
      {
        ...basePage,
        normalizedUrl: 'https://x.com/OpenAI/status/1',
        routeTemplate: '/:account/status/:id',
        routePath: '/:account/status/:id',
        pageType: 'authenticated_browser_summary',
        evidenceLevel: 'browser_structure_verified',
        visibleItemCount: 1,
        listPresent: true,
        structureHash: 'browser-structure:status',
      },
      {
        ...basePage,
        normalizedUrl: 'https://x.com/OpenAI/with_replies',
        routeTemplate: '/:account/:slug',
        routePath: '/:account/with_replies',
        pageType: 'authenticated_browser_summary',
        evidenceLevel: 'browser_structure_verified',
        visibleItemCount: 1,
        listPresent: true,
        structureHash: 'browser-structure:replies',
      },
      {
        ...basePage,
        normalizedUrl: 'https://x.com/OpenAI/media',
        routeTemplate: '/:account/media',
        routePath: '/:account/media',
        pageType: 'authenticated_route_proof',
        evidenceLevel: 'browser_route_verified',
        visibleItemCount: 0,
        listPresent: false,
        structureHash: 'browser-route-proof:media',
      },
      {
        ...basePage,
        normalizedUrl: 'https://x.com/following',
        routeTemplate: '/following',
        routePath: '/following',
        pageType: 'authenticated_route_proof',
        evidenceLevel: 'browser_route_verified',
        visibleItemCount: 0,
        listPresent: false,
        structureHash: 'browser-route-proof:following',
      },
      {
        ...basePage,
        normalizedUrl: 'https://x.com/search',
        routeTemplate: '/search',
        routePath: '/search',
        pageType: 'authenticated_route_proof',
        evidenceLevel: 'browser_route_verified',
        visibleItemCount: 0,
        listPresent: false,
        structureHash: 'browser-route-proof:search',
      },
      {
        ...basePage,
        normalizedUrl: 'https://x.com/explore',
        routeTemplate: '/explore',
        routePath: '/explore',
        pageType: 'authenticated_route_proof',
        evidenceLevel: 'browser_route_verified',
        visibleItemCount: 0,
        listPresent: false,
        structureHash: 'browser-route-proof:explore',
      },
      {
        ...basePage,
        normalizedUrl: 'https://x.com/i/lists',
        routeTemplate: '/i/lists',
        routePath: '/i/lists',
        pageType: 'authenticated_route_proof',
        evidenceLevel: 'browser_route_verified',
        visibleItemCount: 0,
        listPresent: false,
        structureHash: 'browser-route-proof:lists',
      },
    ],
    authenticatedOverlayPages: [],
    privacy: {
      rawDomSaved: false,
      rawHtmlSaved: false,
      rawContentSaved: false,
      privateContentSaved: false,
      cookiesSaved: false,
      tokensSaved: false,
      browserProfileSaved: false,
    },
  });
  await writeJson(path.join(buildDir, 'auth_state_report.json'), {
    verified: true,
    authVerificationStatus: 'browser_verified_partial',
    browserBridge: {
      used: true,
      capturedRouteCount: 8,
      missingRouteCount: 0,
      routeCoverageStatus: 'complete',
    },
  });
  await writeJson(path.join(buildDir, 'verification_report.json'), {
    status: 'passed',
  });
  return buildDir;
}

test('x research task runner falls back to verified Browser Bridge structure when login profile is missing', async (t) => {
  const root = await tempDir(t);
  const buildDir = await createVerifiedBrowserBridgeBuild(root);
  const result = await runXResearchTask(baseOptions(root, [
    '--task',
    'account-full-archive',
    '--account',
    'OpenAI',
    '--build-dir',
    buildDir,
    '--execute',
    '--max-buckets-per-run',
    '0',
    '--no-wait-profile-accounts',
    '0',
  ]), {
    executeCommand: async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'ENOENT: no such file or directory, open profiles\\x.com.json',
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'complete');
  assert.equal(result.complete, true);
  const summary = JSON.parse(await fs.readFile(path.join(root, 'out', 'task-summary.json'), 'utf8'));
  assert.equal(summary.completionScope, 'controlled_structure_scope');
  assert.equal(summary.contentCompletenessClaim, 'not_claimed');
  assert.equal(summary.verification.status, 'verified-controlled-structure');
  assert.equal(summary.controlledEvidence.source, 'browser-bridge-sanitized-structure');
  assert.equal(summary.controlledEvidence.rawContentPersisted, false);
  assert.equal(summary.controlledEvidence.privateContentPersisted, false);
  assert.equal(summary.controlledEvidence.cookieMaterialPersisted, false);
  assert.equal(summary.controlledEvidence.browserProfilePersisted, false);
  assert.equal(summary.evidenceCounts.rawItems > 0, true);
  assert.equal(summary.evidenceCounts.dedupedItems > 0, true);
  assert.equal(summary.evidenceCounts.accounts, 1);
  assert.equal(summary.evidenceCounts.contentRows, 0);
  assert.equal(summary.bucketCounts.pending, 0);
  assert.equal(summary.bucketCounts.failed, 0);
  const rawRows = (await fs.readFile(path.join(root, 'out', 'raw-items.jsonl'), 'utf8'))
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  assert.equal(rawRows.every((row) => row.itemType === 'browser_bridge_sanitized_route_summary'), true);
  assert.equal(rawRows.every((row) => row.contentCompletenessClaim === 'not_claimed'), true);
  assert.doesNotMatch(JSON.stringify(summary), /Bearer|set-cookie|auth_token|ct0|x-csrf-token|browserProfilePath|userDataDir/iu);
});
