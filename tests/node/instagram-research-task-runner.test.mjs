import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildTaskPlan,
  classifyFailure,
  parseArgs,
  runInstagramResearchTask,
} from '../../scripts/instagram-research-task-runner.mjs';

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'siteforge-instagram-task-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function baseOptions(root, args) {
  return parseArgs([
    ...args,
    '--out-dir',
    path.join(root, 'out'),
    '--runs-root',
    path.join(root, 'runs'),
    '--now',
    '2026-06-09',
  ]);
}

async function writeJsonl(filePath, rows) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, rows.length ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '', 'utf8');
}

function parseJsonl(text) {
  return text.trim() ? text.trim().split(/\r?\n/u).map((line) => JSON.parse(line)) : [];
}

test('instagram research runner builds production task templates with verified site fallback', async (t) => {
  const root = await tempDir(t);
  const cases = [
    [['--task', 'account-full-archive', '--account', 'openai'], ['account-info', 'posts', 'reels', 'following', 'followers']],
    [['--task', 'account-works-archive', '--account', 'openai'], ['account-info', 'posts', 'reels', 'media', 'highlights']],
    [['--task', 'keyword-trend', '--query', 'siteforge,codex'], ['search-1', 'search-2']],
    [['--task', 'industry-report', '--query', 'ai tools'], ['search-1']],
    [['--task', 'account-composite-profile', '--account', 'openai'], ['account-info', 'posts', 'followers']],
    [['--task', 'account-content-profile', '--account', 'openai'], ['account-info', 'posts', 'reels']],
    [['--task', 'relation-list-collection', '--account', 'openai'], ['following', 'followers']],
    [['--task', 'event-timeline', '--query', 'siteforge launch'], ['search-1']],
    [['--task', 'similar-account-discovery', '--account', 'openai'], ['seed-profile', 'candidate-search']],
  ];

  for (const [argv, expectedBucketIds] of cases) {
    const plan = buildTaskPlan(baseOptions(root, argv));
    assert.equal(plan.schemaVersion, 1);
    assert.equal(plan.siteKey, 'instagram');
    assert.equal(plan.apiFirstPolicy.status, 'active_api_with_verified_site_fallback');
    assert.equal(plan.apiFirstPolicy.reasonCode, null);
    assert.equal(plan.apiFirstPolicy.activeApiCapabilities.includes('instagram-api-profile-relations'), true);
    assert.equal(plan.buckets.length > 0, true);
    for (const bucketId of expectedBucketIds) {
      assert.equal(plan.buckets.some((bucket) => bucket.id === bucketId), true, `${plan.task.id} missing ${bucketId}`);
    }
    for (const bucket of plan.buckets) {
      if (
        bucket.action === 'profile-following'
        || bucket.action === 'profile-followers'
        || (bucket.action === 'profile-content' && bucket.contentType === 'posts')
      ) {
        assert.equal(bucket.apiFirst.active, true);
        assert.equal(bucket.apiFirst.verified, true);
        assert.match(bucket.apiFirst.operationId, /^instagram-/u);
      } else {
        assert.equal(bucket.apiFirst.active, false);
        assert.equal(bucket.apiFirst.reasonCode, 'no_replay_verified_instagram_api_for_bucket');
      }
      assert.equal(bucket.siteFallback.verified, true);
      assert.equal(Array.isArray(bucket.siteFallback.command), true);
      assert.equal(bucket.siteFallback.command.includes('src/entrypoints/sites/instagram-action.mjs'), true);
    }
    assert.equal(plan.artifactContract.requiredFiles.includes('task-plan.json'), true);
    assert.equal(plan.artifactContract.requiredFiles.includes('raw-items.jsonl'), true);
    assert.equal(plan.artifactContract.materialPolicy.savedMaterial, 'sanitized_summary_only');
  }
});

test('instagram research runner writes plan state summary report and empty data artifacts in plan mode', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const result = await runInstagramResearchTask(baseOptions(root, [
    '--task', 'account-composite-profile',
    '--account', 'openai',
  ]));

  assert.equal(result.ok, true);
  assert.equal(result.status, 'planned');
  await fs.access(path.join(outDir, 'task-plan.json'));
  await fs.access(path.join(outDir, 'task-state.json'));
  await fs.access(path.join(outDir, 'task-summary.json'));
  await fs.access(path.join(outDir, 'task-report.md'));
  await fs.access(path.join(outDir, 'raw-items.jsonl'));
  await fs.access(path.join(outDir, 'deduped-items.jsonl'));
  await fs.access(path.join(outDir, 'accounts', 'items.jsonl'));
  await fs.access(path.join(outDir, 'authors', 'items.jsonl'));
  await fs.access(path.join(outDir, 'cache-index.json'));
  await fs.access(path.join(outDir, 'cache-index.jsonl'));
  await fs.access(path.join(outDir, 'archive', 'index.md'));
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
  assert.equal(summary.apiFirst.status, 'active_api_with_verified_site_fallback');
  assert.equal(summary.apiFirst.activeApiCapabilities.includes('instagram-api-profile-posts'), true);
  assert.equal(summary.quality.savedMaterial, 'sanitized_summary_only');
});

test('instagram research runner executes verified site fallback and dedupes item/account artifacts', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');
  const result = await runInstagramResearchTask(baseOptions(root, [
    '--task', 'relation-list-collection',
    '--account', 'openai',
    '--execute',
    '--max-buckets-per-run', '0',
  ]), {
    executeCommand: async (_command, args) => {
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const runDir = path.join(runsRoot, artifactRunId);
      const itemsPath = path.join(runDir, 'items.jsonl');
      const usersPath = path.join(runDir, 'users.jsonl');
      await writeJsonl(itemsPath, [
        { id: `${artifactRunId}-1`, url: 'https://www.instagram.com/p/ABC/' },
      ]);
      await writeJsonl(usersPath, [
        { handle: 'candidate_one', name: 'Candidate One' },
        { handle: 'candidate_one', name: 'Candidate One Duplicate' },
      ]);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          siteKey: 'instagram',
          result: { items: [{ id: `${artifactRunId}-1` }], users: [{ handle: 'candidate_one' }] },
          artifacts: { runDir, items: itemsPath, users: usersPath, manifest: path.join(runDir, 'manifest.json'), report: path.join(runDir, 'report.md') },
        })}\n`,
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'completed');
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
  assert.equal(summary.apiFirst.fallbackUsed, true);
  assert.equal(summary.itemCounts.raw, 2);
  assert.equal(summary.itemCounts.deduped, 2);
  assert.equal(summary.itemCounts.accounts, 1);
  const accounts = parseJsonl(await fs.readFile(path.join(outDir, 'accounts', 'items.jsonl'), 'utf8'));
  assert.equal(accounts.some((account) => account.handle === 'candidate_one'), true);
  assert.doesNotMatch(JSON.stringify(summary), /Bearer|set-cookie|sf_fixture_cookie|rawRequestBody|rawResponseBody|browserProfilePath|userDataDir/iu);
});

test('instagram research runner uses cookie file only as transient child-command input', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');
  const cookiePath = path.join(root, 'ig-cookies.txt');
  await fs.writeFile(cookiePath, 'sessionid\tsecret-session\t.instagram.com\t/\t2027-06-09T00:00:00.000Z\n', 'utf8');
  let sawTransientCookieFile = false;

  await runInstagramResearchTask(baseOptions(root, [
    '--task', 'account-content-profile',
    '--account', 'openai',
    '--execute',
    '--max-buckets-per-run', '1',
    '--cookie-file', cookiePath,
  ]), {
    executeCommand: async (_command, args) => {
      sawTransientCookieFile = args.includes('--cookie-file') && args.includes(cookiePath);
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const runDir = path.join(runsRoot, artifactRunId);
      const itemsPath = path.join(runDir, 'items.jsonl');
      await writeJsonl(itemsPath, [
        { id: `${artifactRunId}-1`, url: 'https://www.instagram.com/p/ABC/' },
      ]);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          siteKey: 'instagram',
          result: {
            items: [{ id: `${artifactRunId}-1` }],
          },
          artifacts: { runDir, items: itemsPath },
        })}\n`,
        stderr: '',
      };
    },
  });

  assert.equal(sawTransientCookieFile, true);
  const planText = await fs.readFile(path.join(outDir, 'task-plan.json'), 'utf8');
  const stateText = await fs.readFile(path.join(outDir, 'task-state.json'), 'utf8');
  const summaryText = await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8');
  assert.doesNotMatch(planText, /ig-cookies|secret-session/u);
  assert.doesNotMatch(stateText, /ig-cookies|secret-session/u);
  assert.doesNotMatch(summaryText, /ig-cookies|secret-session/u);
  const summary = JSON.parse(summaryText);
  assert.equal(summary.quality.providedLoginState.usedForChildCommands, true);
  assert.equal(summary.quality.providedLoginState.filePathPersisted, false);
});

test('instagram research runner does not mark content profile as all-works archive support', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');
  const result = await runInstagramResearchTask(baseOptions(root, [
    '--task', 'account-content-profile',
    '--account', 'openai',
    '--execute',
    '--max-buckets-per-run', '0',
  ]), {
    executeCommand: async (_command, args) => {
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const runDir = path.join(runsRoot, artifactRunId);
      const itemsPath = path.join(runDir, 'items.jsonl');
      await writeJsonl(itemsPath, [
        { id: `${artifactRunId}-1`, url: 'https://www.instagram.com/p/ABC/' },
      ]);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          siteKey: 'instagram',
          result: {
            account: { handle: 'openai', displayName: 'OpenAI' },
            items: [{ id: `${artifactRunId}-1` }],
          },
          artifacts: { runDir, items: itemsPath, manifest: path.join(runDir, 'manifest.json'), report: path.join(runDir, 'report.md') },
        })}\n`,
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'completed');
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
  assert.equal(summary.productionEvidence.contentCollectionComplete, true);
  assert.equal(summary.productionEvidence.accountContentProfileSupport, 'supported_with_current_artifacts');
  assert.equal(summary.productionEvidence.userArchiveSupport, 'content_profile_supported_full_archive_not_proven');
  assert.match(summary.productionEvidence.supportBoundary, /full user works and relation archive is not proven/u);
});

test('instagram research runner marks works archive as specified-user works support when completed', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');
  const result = await runInstagramResearchTask(baseOptions(root, [
    '--task', 'account-works-archive',
    '--account', 'openai',
    '--execute',
    '--max-buckets-per-run', '0',
  ]), {
    executeCommand: async (_command, args) => {
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const runDir = path.join(runsRoot, artifactRunId);
      const itemsPath = path.join(runDir, 'items.jsonl');
      await writeJsonl(itemsPath, [
        { id: `${artifactRunId}-1`, url: 'https://www.instagram.com/p/ABC/' },
      ]);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          siteKey: 'instagram',
          result: {
            account: { handle: 'openai', displayName: 'OpenAI' },
            items: [{ id: `${artifactRunId}-1` }],
          },
          artifacts: { runDir, items: itemsPath, manifest: path.join(runDir, 'manifest.json'), report: path.join(runDir, 'report.md') },
        })}\n`,
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'completed');
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
  assert.equal(summary.productionEvidence.contentCollectionComplete, true);
  assert.equal(summary.productionEvidence.accountContentProfileSupport, 'supported_with_current_artifacts');
  assert.equal(summary.productionEvidence.userArchiveSupport, 'supported_with_current_artifacts');
  assert.match(summary.productionEvidence.supportBoundary, /account works archive/u);
});

test('instagram research runner downloads media by default for account archive tasks', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const runsRoot = path.join(root, 'runs');
  const seenProfileContentArgs = [];
  const result = await runInstagramResearchTask(baseOptions(root, [
    '--task', 'account-works-archive',
    '--account', 'openai',
    '--execute',
    '--max-buckets-per-run', '0',
  ]), {
    executeCommand: async (_command, args) => {
      const action = args[1];
      const artifactRunId = args[args.indexOf('--artifact-run-id') + 1];
      const runDir = path.join(runsRoot, artifactRunId);
      const itemsPath = path.join(runDir, 'items.jsonl');
      const itemId = `${artifactRunId}-1`;
      const sourceItemUrl = 'https://www.instagram.com/p/ABC/';
      await writeJsonl(itemsPath, [
        { id: itemId, url: sourceItemUrl },
      ]);
      const localPath = path.join(runDir, 'media', 'images', `${itemId}.jpg`);
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fs.writeFile(localPath, 'jpg', 'utf8');
      if (action === 'profile-content') {
        seenProfileContentArgs.push(args);
      }
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          siteKey: 'instagram',
          result: {
            account: action === 'account-info' ? { handle: 'openai', displayName: 'OpenAI' } : null,
            items: [{ id: itemId, url: sourceItemUrl }],
          },
          download: action === 'profile-content' ? {
            status: 'complete',
            supported: true,
            blocked: false,
            downloads: [{
              id: `media-${artifactRunId}`,
              url: 'https://cdn.example.test/media.jpg',
              type: 'image',
              sourceItemId: itemId,
              sourceItemUrl,
              mediaIndex: 0,
              localPath,
              status: 'downloaded',
              ok: true,
              bytes: 3,
            }],
            expectedMedia: [{
              id: `media-${artifactRunId}`,
              url: 'https://cdn.example.test/media.jpg',
              type: 'image',
              sourceItemId: itemId,
              sourceItemUrl,
              mediaIndex: 0,
              localPath,
              status: 'downloaded',
              ok: true,
              bytes: 3,
            }],
          } : null,
          artifacts: { runDir, items: itemsPath, manifest: path.join(runDir, 'manifest.json'), report: path.join(runDir, 'report.md') },
        })}\n`,
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(seenProfileContentArgs.length > 0, true);
  assert.equal(seenProfileContentArgs.every((args) => args.includes('--download-media')), true);
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
  assert.equal(summary.task.defaults.downloadMedia, true);
  assert.equal(summary.artifactContract.requiredFiles.includes('media-assets.json'), true);
  assert.equal(summary.artifactContract.requiredFiles.includes('media-assets.jsonl'), true);
  assert.equal(summary.mediaDownloads.enabled, true);
  assert.equal(summary.mediaDownloads.status, 'complete');
  assert.equal(summary.mediaDownloads.counts.downloaded, seenProfileContentArgs.length);
  const mediaSummary = JSON.parse(await fs.readFile(path.join(outDir, 'media-assets.json'), 'utf8'));
  assert.equal(mediaSummary.counts.downloaded, seenProfileContentArgs.length);
  const mediaRows = parseJsonl(await fs.readFile(path.join(outDir, 'media-assets.jsonl'), 'utf8'));
  assert.equal(mediaRows.length, seenProfileContentArgs.length);
  assert.equal(mediaRows.every((row) => row.status === 'downloaded' && row.localPath), true);
  const report = await fs.readFile(path.join(outDir, 'task-report.md'), 'utf8');
  assert.match(report, /Media downloaded:/u);
});

test('instagram research runner can explicitly disable default media downloads', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const result = await runInstagramResearchTask(baseOptions(root, [
    '--task', 'account-works-archive',
    '--account', 'openai',
    '--no-download-media',
  ]));

  assert.equal(result.ok, true);
  const state = JSON.parse(await fs.readFile(path.join(outDir, 'task-state.json'), 'utf8'));
  assert.equal(state.task.defaults.downloadMedia, false);
  assert.equal(state.buckets.some((bucket) => bucket.siteFallback.command.includes('--download-media')), false);
  const mediaSummary = JSON.parse(await fs.readFile(path.join(outDir, 'media-assets.json'), 'utf8'));
  assert.equal(mediaSummary.status, 'disabled');
});

test('instagram research runner records dry-run fallback as planned instead of fake completion', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const result = await runInstagramResearchTask(baseOptions(root, [
    '--task', 'keyword-trend',
    '--query', 'siteforge',
    '--execute',
    '--dry-run-actions',
  ]), {
    executeCommand: async () => ({
      exitCode: 0,
      stdout: `${JSON.stringify({
        ok: true,
        dryRun: true,
        artifacts: { runDir: path.join(root, 'run') },
      })}\n`,
      stderr: '',
    }),
  });

  assert.equal(result.ok, true);
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
  assert.equal(summary.bucketCounts.planned, 1);
  assert.equal(summary.quality.dryRunBuckets.includes('search-1'), true);
  assert.equal(summary.failures[0].reasonCode, 'dry_run_site_fallback');
});

test('instagram research runner can reuse authorized structure summary as degraded fallback on login failure', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const summaryPath = path.join(root, 'crawl_authenticated.json');
  await fs.writeFile(summaryPath, JSON.stringify({
    authenticatedPages: [
      {
        url: 'https://www.instagram.com/{account}/',
        canonicalUrl: 'https://www.instagram.com/{account}/',
        routeTemplate: '/{account}/',
        pageType: 'author-page',
        visibleItemCount: 12,
        listPresent: true,
        emptyStatePresent: false,
        structureHash: 'structure-profile',
      },
      {
        url: 'https://www.instagram.com/{account}/followers/',
        canonicalUrl: 'https://www.instagram.com/{account}/followers/',
        routeTemplate: '/{account}/followers/',
        pageType: 'author-list-page',
        visibleItemCount: 10,
        listPresent: true,
        emptyStatePresent: false,
        structureHash: 'structure-followers',
      },
    ],
  }), 'utf8');

  const result = await runInstagramResearchTask(baseOptions(root, [
    '--task', 'account-composite-profile',
    '--account', 'openai',
    '--execute',
    '--max-buckets-per-run', '1',
    '--use-build-summary-fallback',
    '--build-summary-path', summaryPath,
  ]), {
    executeCommand: async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'Login challenge required',
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'partial');
  const summary = JSON.parse(await fs.readFile(path.join(outDir, 'task-summary.json'), 'utf8'));
  assert.equal(summary.bucketCounts.captured_with_warning, 1);
  assert.equal(summary.productionEvidence.contentCollectionComplete, false);
  assert.equal(summary.productionEvidence.degradedBucketCount, 1);
  assert.match(summary.productionEvidence.supportBoundary, /degraded JSONL/u);
  const rawItems = parseJsonl(await fs.readFile(path.join(outDir, 'raw-items.jsonl'), 'utf8'));
  assert.equal(rawItems.length > 0, true);
  assert.equal(rawItems[0].degradation, 'structure_summary_only');
  assert.equal(rawItems[0].savedMaterial, 'sanitized_summary_only');
});

test('instagram research runner retry-failed requeues failed buckets before degraded fallback', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const summaryPath = path.join(root, 'crawl_authenticated.json');
  await fs.writeFile(summaryPath, JSON.stringify({
    authenticatedPages: [
      {
        canonicalUrl: 'https://www.instagram.com/{account}/',
        routeTemplate: '/{account}/',
        pageType: 'author-page',
        visibleItemCount: 12,
        listPresent: true,
        structureHash: 'structure-profile',
      },
    ],
  }), 'utf8');

  await runInstagramResearchTask(baseOptions(root, [
    '--task', 'account-composite-profile',
    '--account', 'openai',
    '--execute',
    '--max-buckets-per-run', '1',
  ]), {
    executeCommand: async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'Login challenge required',
    }),
  });
  const retried = await runInstagramResearchTask(baseOptions(root, [
    '--task', 'account-composite-profile',
    '--account', 'openai',
    '--execute',
    '--resume',
    '--retry-failed',
    '--max-buckets-per-run', '1',
    '--use-build-summary-fallback',
    '--build-summary-path', summaryPath,
  ]), {
    executeCommand: async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'Login challenge required',
    }),
  });

  assert.equal(retried.ok, true);
  const state = JSON.parse(await fs.readFile(path.join(outDir, 'task-state.json'), 'utf8'));
  assert.equal(state.buckets[0].status, 'captured_with_warning');
  assert.equal(state.buckets[0].previousFailure.reasonCode, 'login_or_session_required');
});

test('instagram research runner classifies actionable failure layers', () => {
  assert.equal(classifyFailure({ stderr: 'Login challenge required' }).layer, 'login');
  assert.equal(classifyFailure({ stdout: '{"outcome":{"reason":"relation-surface-empty"}}' }).layer, 'empty_result');
  assert.equal(classifyFailure({ stderr: 'robots disallowed' }).layer, 'robots');
  assert.equal(classifyFailure({ stderr: 'rate limit cooldown' }).layer, 'rate_limit');
  assert.equal(classifyFailure({ stderr: 'selector not found' }).layer, 'selector');
  assert.equal(classifyFailure({ stderr: '0 items' }).layer, 'empty_result');
  assert.equal(classifyFailure({ stderr: 'permission private blocked' }).layer, 'permission_or_policy');
});

test('instagram research runner treats account-info account object as structured account output', async (t) => {
  const root = await tempDir(t);
  const outDir = path.join(root, 'out');
  const result = await runInstagramResearchTask(baseOptions(root, [
    '--task', 'account-composite-profile',
    '--account', 'openai',
    '--execute',
    '--max-buckets-per-run', '1',
  ]), {
    executeCommand: async (_command, args) => {
      const runDir = path.join(root, 'runs', args[args.indexOf('--artifact-run-id') + 1]);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          ok: true,
          siteKey: 'instagram',
          result: { account: { handle: 'openai', displayName: 'OpenAI' } },
          artifacts: { runDir },
        })}\n`,
        stderr: '',
      };
    },
  });

  assert.equal(result.ok, true);
  const state = JSON.parse(await fs.readFile(path.join(outDir, 'task-state.json'), 'utf8'));
  assert.equal(state.buckets[0].status, 'completed');
  assert.equal(state.buckets[0].accountCount, 1);
  const accounts = parseJsonl(await fs.readFile(path.join(outDir, 'accounts', 'items.jsonl'), 'utf8'));
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].handle, 'openai');
});
