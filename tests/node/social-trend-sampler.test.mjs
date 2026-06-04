import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildAnalysisArtifacts,
  buildCalendarBuckets,
  buildSearchQuery,
  buildTrendBuckets,
  classifyItem,
  createInitialState,
  findSearchCooldownBlocker,
  manifestIsSearchRateLimited,
  parseArgs,
  runTrendSampler,
} from '../../scripts/social-trend-sampler.mjs';

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'siteforge-trend-test-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeJsonl(filePath, items) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${items.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8');
}

async function countJsonl(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return text.split(/\r?\n/u).filter(Boolean).length;
}

function makeItems(count, language, subjectId, textFactory) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${subjectId}-${language}-${index}`,
    text: textFactory(index),
    createdAt: '2026-05-15T00:00:00.000Z',
    username: `user_${language}_${index}`,
  }));
}

test('social trend sampler builds clipped calendar buckets and 84 default product/model buckets', () => {
  const periods = buildCalendarBuckets(
    new Date('2025-12-02T00:00:00.000Z'),
    new Date('2026-06-03T00:00:00.000Z'),
  );
  assert.deepEqual(periods.map((bucket) => [bucket.since, bucket.until]), [
    ['2025-12-02', '2026-01-01'],
    ['2026-01-01', '2026-02-01'],
    ['2026-02-01', '2026-03-01'],
    ['2026-03-01', '2026-04-01'],
    ['2026-04-01', '2026-05-01'],
    ['2026-05-01', '2026-06-01'],
    ['2026-06-01', '2026-06-03'],
  ]);

  const options = parseArgs([
    '--from',
    '2025-12-02',
    '--to',
    '2026-06-03',
    '--languages',
    'zh,en',
    '--target-samples',
    '12000',
  ]);
  const buckets = buildTrendBuckets(options);
  assert.equal(buckets.length, 84);
  assert.deepEqual([...new Set(buckets.map((bucket) => bucket.subject.id))].sort(), [
    'chatgpt-product',
    'claude-code-product',
    'claude-model-family',
    'claude-product',
    'codex-product',
    'gpt-model-family',
  ]);
  assert.deepEqual([...new Set(buckets.map((bucket) => bucket.language))].sort(), ['en', 'zh']);
  assert.equal(buckets.every((bucket) => bucket.topic.id === 'ux-love'), true);
  assert.equal(buckets.every((bucket) => bucket.maxItems === 150), true);
  assert.equal(buckets.some((bucket) => /\bpricing\b|\blawsuit\b|\bfunding\b/u.test(bucket.query)), false);
});

test('social trend sampler calculates bilingual quotas and language-specific queries', () => {
  const options = parseArgs([
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
    '--subjects',
    'codex-product,claude-code-product',
    '--languages',
    'zh,en',
    '--target-samples',
    '12000',
    '--effective-min-total',
    '10000',
    '--min-language-samples',
    '5000',
  ]);
  const buckets = buildTrendBuckets(options);
  const state = createInitialState(options, buckets);
  assert.equal(buckets.length, 4);
  assert.deepEqual(state.request.languageQuotas, { zh: 5000, en: 5000 });
  assert.equal(state.request.targetPerBucket, 3000);
  assert.match(buckets.find((bucket) => bucket.subject.id === 'codex-product' && bucket.language === 'zh').query, /lang:zh/u);
  assert.match(buckets.find((bucket) => bucket.subject.id === 'claude-code-product' && bucket.language === 'en').query, /"Claude Code"/u);

  const query = buildSearchQuery(
    { query: { zh: 'ChatGPT', en: 'ChatGPT' } },
    { terms: '' },
    { since: '2026-01-01', until: '2026-02-01' },
    'en',
  );
  assert.equal(query, 'ChatGPT lang:en -is:retweet since:2026-01-01 until:2026-02-01');
});

test('social trend sampler filters for UX and user-love signals only', () => {
  assert.deepEqual(classifyItem('我每天用 Claude Code，工作流很顺手，响应流畅，强烈推荐').isUxLove, true);
  assert.equal(classifyItem('I love Codex as my daily driver, the workflow is smooth').sentiment, 'love/positive');
  assert.equal(classifyItem('ChatGPT 的上下文体验很卡顿，我已经弃用').sentiment, 'frustrated/negative');
  assert.equal(classifyItem('I love Claude but the UI workflow is still frustrating').sentiment, 'mixed');

  assert.equal(classifyItem('OpenAI is seeking a new valuation after the latest funding round').isUxLove, false);
  assert.equal(classifyItem('Claude lawsuit and safety policy news, according to a report').isUxLove, false);
  assert.equal(classifyItem('ChatGPT pricing is expensive and the subscription changed').isUxLove, false);
  assert.equal(classifyItem('A list of AI tools: ChatGPT, Claude, Codex, Gemini').isUxLove, false);
});

test('social trend sampler detects same-surface x search cooldown blockers', async (t) => {
  const root = await tempDir(t);
  const manifest = {
    generatedAt: '2026-06-02T09:17:18.000Z',
    plan: { action: 'search' },
    outcome: { status: 'blocked-risk', reason: 'rate-limited' },
    runtimeRisk: {
      rateLimited: true,
      hardStop: true,
      stopReason: 'rate-limited',
      riskState: {
        state: 'rate_limited',
        taskId: 'x:search',
      },
    },
  };
  await writeJson(path.join(root, 'x-search-blocked', 'manifest.json'), manifest);
  assert.equal(manifestIsSearchRateLimited(manifest), true);
  const blocker = await findSearchCooldownBlocker({
    runsRoot: root,
    cooldownMinutes: 30,
    now: new Date('2026-06-02T09:30:00.000Z'),
  });
  assert.equal(blocker.blocked, true);
  assert.equal(blocker.reason, 'search-rate-limited');
  assert.equal(blocker.taskId, 'x:search');

  const expired = await findSearchCooldownBlocker({
    runsRoot: root,
    cooldownMinutes: 30,
    now: new Date('2026-06-02T10:00:00.000Z'),
  });
  assert.equal(expired.blocked, false);
});

test('social trend sampler writes plan state and required output files without executing', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const result = await runTrendSampler(parseArgs([
    '--from',
    '2025-12-02',
    '--to',
    '2026-06-03',
    '--out-dir',
    outDir,
    '--runs-root',
    path.join(root, 'runs'),
  ]));
  assert.equal(result.ok, true);
  assert.equal(result.status, 'planned');
  const state = JSON.parse(await fs.readFile(path.join(outDir, 'trend-run-state.json'), 'utf8'));
  assert.equal(state.buckets.length, 84);
  assert.equal(state.request.collectionMode, 'page');
  assert.equal(state.request.maxBucketsPerRun, 1);
  assert.equal(state.buckets.every((bucket) => Array.isArray(bucket.command)), true);
  assert.equal(state.buckets.every((bucket) => bucket.command.includes('--no-api-cursor')), true);
  for (const fileName of [
    'raw-items.jsonl',
    'deduped-items.jsonl',
    'ux-love-items.jsonl',
    'bucket-summary.json',
    'bucket-summary.csv',
    'trend-summary.json',
    'trend-summary.md',
  ]) {
    await fs.access(path.join(outDir, fileName));
  }
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'trend-summary.json'), 'utf8'));
  assert.equal(summary.totals.buckets, 84);
  assert.equal(summary.yieldProjection.neededEffectiveTotal, 10000);
  assert.equal(summary.acceptance.ok, false);
  assert.equal(summary.refillPlan.suggestedBuckets.length > 0, true);
});

test('social trend sampler can plan Browser Bridge page collection without API cursor', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const result = await runTrendSampler(parseArgs([
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
    '--subjects',
    'codex-product',
    '--languages',
    'zh',
    '--collection-mode',
    'page',
    '--max-scrolls',
    '60',
    '--scroll-wait-ms',
    '1000',
    '--out-dir',
    outDir,
    '--runs-root',
    path.join(root, 'runs'),
  ]));
  assert.equal(result.ok, true);
  const state = JSON.parse(await fs.readFile(path.join(outDir, 'trend-run-state.json'), 'utf8'));
  assert.equal(state.request.collectionMode, 'page');
  assert.equal(state.buckets.length, 1);
  assert.equal(state.buckets[0].command.includes('--no-api-cursor'), true);
  assert.equal(state.buckets[0].command.includes('--api-cursor'), false);
  assert.equal(state.buckets[0].command.includes('--max-scrolls'), true);
  assert.equal(state.buckets[0].command[state.buckets[0].command.indexOf('--max-scrolls') + 1], '60');
  assert.equal(state.buckets[0].command.includes('--scroll-wait'), true);
  assert.equal(state.buckets[0].command[state.buckets[0].command.indexOf('--scroll-wait') + 1], '1000');
});

test('social trend sampler immediately falls back from API-local rate limit to page collection', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');
  const calls = [];

  const result = await runTrendSampler(parseArgs([
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
    '--subjects',
    'codex-product',
    '--languages',
    'en',
    '--collection-mode',
    'api',
    '--api-rate-limit-fallback',
    'page',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
    '--delay-ms',
    '0',
  ]), {
    findSearchCooldownBlocker: async () => ({ blocked: false }),
    executeCommand: async (_command, args) => {
      calls.push(args);
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const itemsPath = path.join(runsRoot, artifactRunId, 'items.jsonl');
      if (calls.length === 1) {
        assert.equal(args.includes('--api-cursor'), true);
        assert.equal(args.includes('--no-api-cursor'), false);
        return {
          exitCode: 0,
          stdout: `${JSON.stringify({
            ok: false,
            outcome: { status: 'blocked-risk', reason: 'api-cursor-rate-limited' },
            runtimeRisk: {
              rateLimited: true,
              hardStop: false,
              stopReason: 'api-cursor-rate-limited',
              riskState: {
                state: 'rate_limited',
                taskId: 'x:api-cursor',
              },
            },
          })}\n`,
          stderr: '',
        };
      }
      assert.equal(args.includes('--api-cursor'), false);
      assert.equal(args.includes('--no-api-cursor'), true);
      assert.match(artifactRunId, /-page-fallback$/u);
      await writeJsonl(itemsPath, [
        {
          id: 'fallback-1',
          text: 'I love Codex as my daily driver, the workflow is smooth',
          createdAt: '2026-05-16T00:00:00.000Z',
        },
      ]);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          outcome: { status: 'completed' },
          runtimeRisk: { rateLimited: false, hardStop: false },
          artifacts: { items: itemsPath, runDir: path.dirname(itemsPath) },
        })}\n`,
        stderr: '',
      };
    },
    sleep: async () => {},
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  const state = JSON.parse(await fs.readFile(path.join(outDir, 'trend-run-state.json'), 'utf8'));
  assert.equal(state.buckets[0].status, 'completed');
  assert.equal(state.buckets[0].collectionMode, 'page');
  assert.equal(state.buckets[0].apiAttempt.result.runtimeRisk.rateLimited, true);
  assert.equal(state.buckets[0].fallback.to, 'page');
  assert.equal(state.buckets[0].fallback.result.runtimeRisk.rateLimited, false);
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'trend-summary.json'), 'utf8'));
  assert.equal(summary.totals.uxLoveItems, 1);
  assert.equal(summary.totals.byCollectionMode.page, 1);
});

test('social trend sampler degrades same-surface x search hardStop without page fallback', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');
  let calls = 0;

  const result = await runTrendSampler(parseArgs([
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
    '--subjects',
    'codex-product',
    '--languages',
    'en',
    '--collection-mode',
    'api',
    '--api-rate-limit-fallback',
    'page',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
    '--delay-ms',
    '0',
  ]), {
    findSearchCooldownBlocker: async () => ({ blocked: false }),
    executeCommand: async (_command, args) => {
      calls += 1;
      assert.equal(args.includes('--api-cursor'), true);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: false,
          outcome: { status: 'blocked-risk', reason: 'rate-limited' },
          runtimeRisk: {
            rateLimited: true,
            hardStop: true,
            stopReason: 'rate-limited',
            riskState: {
              state: 'rate_limited',
              taskId: 'x:search',
            },
          },
        })}\n`,
        stderr: '',
      };
    },
    sleep: async () => {},
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'complete');
  assert.equal(calls, 1);
  const state = JSON.parse(await fs.readFile(path.join(outDir, 'trend-run-state.json'), 'utf8'));
  assert.equal(state.status, 'complete');
  assert.equal(state.buckets[0].status, 'captured_with_warning');
  assert.equal(state.buckets[0].noWaitFallback.source, 'empty-degraded-terminal');
  assert.equal(state.buckets[0].fallback, undefined);
});

test('social trend sampler refreshes summary from existing state without changing run status', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const statePath = path.join(outDir, 'trend-run-state.json');
  const itemsPath = path.join(root, 'runs', 'items.jsonl');
  await writeJsonl(itemsPath, [
    {
      id: 'refresh-1',
      text: 'I love Codex, the workflow is smooth',
      createdAt: '2026-05-15T00:00:00.000Z',
    },
  ]);
  const options = parseArgs([
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
    '--subjects',
    'codex-product',
    '--languages',
    'en',
    '--out-dir',
    outDir,
    '--state',
    statePath,
  ]);
  const state = createInitialState(options, buildTrendBuckets(options));
  state.status = 'blocked';
  state.buckets[0].status = 'blocked';
  state.buckets[0].result = { artifacts: { items: itemsPath } };
  await writeJson(statePath, state);

  const result = await runTrendSampler(parseArgs([
    '--out-dir',
    outDir,
    '--state',
    statePath,
    '--refresh-summary',
  ]));
  assert.equal(result.ok, true);
  assert.equal(result.status, 'blocked');
  const refreshedState = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(refreshedState.status, 'blocked');
  assert.equal(refreshedState.buckets[0].status, 'blocked');
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'trend-summary.json'), 'utf8'));
  assert.equal(summary.totals.uxLoveItems, 1);
  assert.equal(summary.yieldProjection.rawToUxLoveRate, 1);
});

test('social trend sampler resolves active search cooldown without live execution', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const result = await runTrendSampler(parseArgs([
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
    '--subjects',
    'codex-product',
    '--languages',
    'zh',
    '--out-dir',
    outDir,
    '--runs-root',
    path.join(root, 'runs'),
    '--execute',
    '--delay-ms',
    '0',
  ]), {
    findSearchCooldownBlocker: async () => ({
      blocked: true,
      reason: 'search-rate-limited',
      remainingMs: 1000,
      cooldownUntil: '2026-06-02T09:47:18.000Z',
      manifestPath: path.join(root, 'runs', 'blocked', 'manifest.json'),
    }),
    executeCommand: async () => {
      throw new Error('should not execute while cooldown is active');
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'complete');
  const state = JSON.parse(await fs.readFile(path.join(outDir, 'trend-run-state.json'), 'utf8'));
  assert.equal(state.status, 'complete');
  assert.equal(state.buckets[0].status, 'captured_with_warning');
  assert.equal(state.buckets[0].noWaitFallback.source, 'empty-degraded-terminal');
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'trend-summary.json'), 'utf8'));
  assert.equal(summary.totals.blocked, 0);
  assert.equal(summary.totals.completed, 1);
});

test('social trend sampler resumes past blocked buckets that already captured items after cooldown', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');
  const statePath = path.join(outDir, 'trend-run-state.json');
  const blockedItemsPath = path.join(runsRoot, 'blocked', 'items.jsonl');
  await writeJsonl(blockedItemsPath, [
    {
      id: 'blocked-partial-1',
      text: '我喜欢 Codex，工作流顺手',
      createdAt: '2026-05-15T00:00:00.000Z',
    },
  ]);

  const options = parseArgs([
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
    '--subjects',
    'codex-product',
    '--languages',
    'zh,en',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--state',
    statePath,
  ]);
  const state = createInitialState(options, buildTrendBuckets(options));
  state.buckets[0].status = 'blocked';
  state.buckets[0].blockedReason = 'rate-limited';
  state.buckets[0].result = {
    runtimeRisk: {
      rateLimited: true,
      hardStop: true,
      stopReason: 'rate-limited',
    },
    artifacts: {
      items: blockedItemsPath,
    },
    itemCount: 1,
  };
  await writeJson(statePath, state);

  const result = await runTrendSampler(parseArgs([
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
    '--subjects',
    'codex-product',
    '--languages',
    'zh,en',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--state',
    statePath,
    '--execute',
    '--resume',
    '--delay-ms',
    '0',
  ]), {
    findSearchCooldownBlocker: async () => ({ blocked: false }),
    executeCommand: async (_command, args) => {
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const itemsPath = path.join(runsRoot, artifactRunId, 'items.jsonl');
      await writeJsonl(itemsPath, [
        {
          id: 'pending-run-1',
          text: 'I love Codex as my daily driver, the workflow is smooth',
          createdAt: '2026-05-16T00:00:00.000Z',
        },
      ]);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          outcome: { status: 'completed' },
          runtimeRisk: { rateLimited: false, hardStop: false },
          artifacts: { items: itemsPath, runDir: path.dirname(itemsPath) },
        })}\n`,
        stderr: '',
      };
    },
    sleep: async () => {},
  });

  assert.equal(result.ok, true);
  const resumedState = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(resumedState.buckets[0].status, 'captured_with_warning');
  assert.equal(resumedState.buckets[1].status, 'completed');
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'trend-summary.json'), 'utf8'));
  assert.equal(summary.totals.completed, 2);
  assert.equal(summary.totals.blocked, 0);
  assert.equal(summary.totals.uxLoveItems, 2);
});

test('social trend sampler can limit live execution to a small bucket batch', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');
  let calls = 0;
  const result = await runTrendSampler(parseArgs([
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
    '--subjects',
    'codex-product',
    '--languages',
    'zh,en',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
    '--delay-ms',
    '0',
    '--max-buckets-per-run',
    '1',
  ]), {
    findSearchCooldownBlocker: async () => ({ blocked: false }),
    executeCommand: async (_command, args) => {
      calls += 1;
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const itemsPath = path.join(runsRoot, artifactRunId, 'items.jsonl');
      await writeJsonl(itemsPath, [
        {
          id: `batch-${calls}`,
          text: '我喜欢 Codex，工作流顺手',
          createdAt: '2026-05-15T00:00:00.000Z',
        },
      ]);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          outcome: { status: 'completed' },
          runtimeRisk: { rateLimited: false, hardStop: false },
          artifacts: { items: itemsPath, runDir: path.dirname(itemsPath) },
        })}\n`,
        stderr: '',
      };
    },
    sleep: async () => {},
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'partial');
  assert.equal(result.executedBuckets, 1);
  assert.equal(calls, 1);
  const state = JSON.parse(await fs.readFile(path.join(outDir, 'trend-run-state.json'), 'utf8'));
  assert.equal(state.buckets[0].status, 'completed');
  assert.equal(state.buckets[1].status, 'pending');
});

test('social trend sampler applies adaptive post-cooldown throttle before live execution', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');
  const sleeps = [];
  const result = await runTrendSampler(parseArgs([
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
    '--subjects',
    'codex-product',
    '--languages',
    'zh',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
    '--delay-ms',
    '0',
    '--post-cooldown-throttle-ms',
    '5',
    '--recent-rate-limit-window-minutes',
    '120',
  ]), {
    findSearchCooldownBlocker: async () => ({
      blocked: false,
      reason: 'search-rate-limited',
      observedAt: new Date().toISOString(),
      cooldownUntil: new Date().toISOString(),
      remainingMs: 0,
      taskId: 'x:search',
    }),
    executeCommand: async (_command, args) => {
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const itemsPath = path.join(runsRoot, artifactRunId, 'items.jsonl');
      await writeJsonl(itemsPath, [
        {
          id: 'throttled-1',
          text: '我喜欢 Codex，工作流顺手',
          createdAt: '2026-05-15T00:00:00.000Z',
        },
      ]);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          outcome: { status: 'completed' },
          runtimeRisk: { rateLimited: false, hardStop: false },
          artifacts: { items: itemsPath, runDir: path.dirname(itemsPath) },
        })}\n`,
        stderr: '',
      };
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(sleeps, [5]);
  const state = JSON.parse(await fs.readFile(path.join(outDir, 'trend-run-state.json'), 'utf8'));
  assert.equal(state.throttle.active, false);
  assert.equal(state.throttle.reason, 'recent-search-rate-limit');
});

test('social trend sampler fake-run accepts 12000 balanced deduped UX/love samples', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');
  const result = await runTrendSampler(parseArgs([
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
    '--subjects',
    'codex-product',
    '--languages',
    'zh,en',
    '--target-samples',
    '12000',
    '--effective-min-total',
    '10000',
    '--min-language-samples',
    '5000',
    '--max-items',
    '6000',
    '--max-buckets-per-run',
    '10',
    '--out-dir',
    outDir,
    '--runs-root',
    runsRoot,
    '--execute',
    '--delay-ms',
    '0',
  ]), {
    findSearchCooldownBlocker: async () => ({ blocked: false }),
    executeCommand: async (_command, args) => {
      const query = args[args.indexOf('--query') + 1];
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const language = query.includes('lang:zh') ? 'zh' : 'en';
      const itemsPath = path.join(runsRoot, artifactRunId, 'items.jsonl');
      const items = makeItems(6000, language, 'codex-product', (index) => (
        language === 'zh'
          ? `我每天用 Codex，工作流顺手，响应流畅，强烈推荐 ${index}`
          : `I love Codex as my daily driver, the workflow is smooth and reliable ${index}`
      ));
      await writeJsonl(itemsPath, items);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          outcome: { status: 'completed' },
          runtimeRisk: { rateLimited: false, hardStop: false },
          artifacts: { items: itemsPath, runDir: path.dirname(itemsPath) },
        })}\n`,
        stderr: '',
      };
    },
    sleep: async () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'complete');
  assert.equal(await countJsonl(path.join(outDir, 'ux-love-items.jsonl')), 12000);
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'trend-summary.json'), 'utf8'));
  assert.equal(summary.acceptance.ok, true);
  assert.equal(summary.totals.byLanguage.zh, 6000);
  assert.equal(summary.totals.byLanguage.en, 6000);
  assert.equal(summary.yieldProjection.rawToUxLoveRate, 1);
  assert.equal(summary.yieldProjection.neededEffectiveTotal, 0);
  assert.equal(summary.refillPlan.suggestedBuckets.length, 0);
});

test('social trend sampler creates refill plans for language and subject shortages', async (t) => {
  const root = await tempDir(t);
  const zhPath = path.join(root, 'zh.jsonl');
  const enPath = path.join(root, 'en.jsonl');
  await writeJsonl(zhPath, makeItems(100, 'zh', 'codex-product', (index) => `我喜欢 Codex，工作流顺手 ${index}`));
  await writeJsonl(enPath, makeItems(6000, 'en', 'codex-product', (index) => `I love Codex, the workflow is smooth ${index}`));

  const options = parseArgs([
    '--from',
    '2026-05-01',
    '--to',
    '2026-06-01',
    '--subjects',
    'codex-product,claude-code-product',
    '--languages',
    'zh,en',
    '--effective-min-total',
    '10000',
    '--min-language-samples',
    '5000',
  ]);
  const state = createInitialState(options, buildTrendBuckets(options));
  for (const bucket of state.buckets) {
    bucket.status = 'completed';
    if (bucket.subject.id === 'codex-product' && bucket.language === 'zh') {
      bucket.result = { artifacts: { items: zhPath } };
    } else if (bucket.subject.id === 'codex-product' && bucket.language === 'en') {
      bucket.result = { artifacts: { items: enPath } };
    }
  }
  const artifacts = await buildAnalysisArtifacts(state);
  assert.equal(artifacts.summary.acceptance.ok, false);
  assert.equal(artifacts.summary.refillPlan.languageNeeds.zh, 4900);
  assert.equal(artifacts.summary.refillPlan.subjectNeeds['claude-code-product'] > 0, true);
  assert.equal(artifacts.summary.refillPlan.suggestedBuckets.some((bucket) => bucket.language === 'zh'), true);
  assert.equal(artifacts.summary.refillPlan.suggestedBuckets.some((bucket) => bucket.subjectId === 'claude-code-product'), true);
});
