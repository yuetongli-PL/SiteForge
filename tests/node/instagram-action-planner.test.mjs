import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  parseArgs,
  planInstagramAction,
  runSelfCheck,
} from '../../scripts/plan-instagram-action.mjs';

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'siteforge-instagram-planner-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('instagram action planner maps specified-user all works to works archive task without claiming completion', () => {
  const plan = planInstagramAction(parseArgs([
    '--request', 'archive all posts and reels for @openai',
    '--now', '2026-06-09',
  ]));

  assert.equal(plan.blocked, false);
  assert.equal(plan.matchedTask, 'account-works-archive');
  assert.equal(plan.parameters.account, 'openai');
  assert.deepEqual(plan.missingParameters, []);
  assert.equal(plan.apiFirst.primary.available, true);
  assert.equal(plan.apiFirst.primary.verified, true);
  assert.equal(plan.apiFirst.primary.reasonCode, null);
  assert.equal(plan.apiFirst.primary.activeApiCapabilities.includes('instagram-api-profile-posts'), true);
  assert.equal(plan.execution.kind, 'api-first-with-verified-site-fallback');
  assert.equal(plan.execution.command.includes('--download-media'), true);
  assert.equal(plan.resume.command.includes('--download-media'), true);
  assert.equal(plan.mediaDownloads.defaultEnabled, true);
  assert.deepEqual(plan.mediaDownloads.artifacts, ['media-assets.json', 'media-assets.jsonl']);
  assert.equal(plan.planPreview.bucketIds.includes('posts'), true);
  assert.equal(plan.planPreview.bucketIds.includes('reels'), true);
  assert.equal(plan.planPreview.bucketIds.includes('following'), false);
  assert.equal(plan.planPreview.bucketIds.includes('followers'), false);
  assert.equal(plan.planPreview.downloadMediaDefault, true);
  assert.deepEqual(plan.planPreview.mediaCapableBucketIds, ['posts', 'reels', 'media', 'highlights']);
  assert.equal(plan.artifactContract.requiredFiles.includes('media-assets.json'), true);
  assert.equal(plan.artifactContract.requiredFiles.includes('media-assets.jsonl'), true);
  assert.equal(plan.completionGate.specifiedUserAllWorks.requiredValue, 'supported_with_current_artifacts');
  assert.match(plan.completionGate.specifiedUserAllWorks.boundary, /Do not claim support/u);
  assert.deepEqual(plan.completionGate.specifiedUserAllWorks.mediaArtifacts, ['media-assets.json', 'media-assets.jsonl']);
  assert.doesNotMatch(JSON.stringify(plan), /Bearer\s+[A-Za-z0-9._-]+|set-cookie:|Authorization:\s*\S+|browserProfile|rawRequestBody/iu);
});

test('instagram action planner maps topic reports to industry-report query task', () => {
  const plan = planInstagramAction(parseArgs([
    '--request', '\u751f\u6210 openai codex \u4e3b\u9898\u62a5\u544a',
    '--now', '2026-06-09',
  ]));

  assert.equal(plan.blocked, false);
  assert.equal(plan.matchedTask, 'industry-report');
  assert.equal(plan.parameters.query, '\u751f\u6210 openai codex \u4e3b\u9898\u62a5\u544a');
  assert.equal(plan.execution.command.includes('--download-media'), false);
  assert.equal(plan.mediaDownloads.defaultEnabled, false);
  assert.deepEqual(plan.missingParameters, []);
  assert.equal(plan.planPreview.bucketIds.length >= 1, true);
  assert.equal(plan.planPreview.siteFallbacks.every((fallback) => fallback.verified === true), true);
});

test('instagram action planner maps profile analysis to content profile task', () => {
  const plan = planInstagramAction(parseArgs([
    '--request', 'build a content profile for @openai',
    '--now', '2026-06-09',
  ]));

  assert.equal(plan.blocked, false);
  assert.equal(plan.matchedTask, 'account-content-profile');
  assert.equal(plan.parameters.account, 'openai');
  assert.deepEqual(plan.planPreview.bucketIds, ['account-info', 'posts', 'reels']);
  assert.equal(plan.execution.command.includes('--download-media'), true);
  assert.deepEqual(plan.planPreview.mediaCapableBucketIds, ['posts', 'reels']);
});

test('instagram action planner blocks mutation requests before execution', () => {
  const plan = planInstagramAction(parseArgs([
    '--request', 'follow @openai and like latest post',
  ]));

  assert.equal(plan.blocked, true);
  assert.equal(plan.reasonCode, 'mutation_or_sensitive_action_blocked');
  assert.equal(plan.matchedTask, null);
  assert.equal(plan.execution, null);
  assert.equal(plan.safety.mutationActions, 'blocked_by_default');
});

test('instagram action planner reports missing account for all-post archive request', () => {
  const plan = planInstagramAction(parseArgs([
    '--request', 'archive all posts',
  ]));

  assert.equal(plan.blocked, false);
  assert.equal(plan.matchedTask, 'account-works-archive');
  assert.deepEqual(plan.missingParameters, ['account']);
  assert.equal(plan.planPreview, null);
  assert.equal(plan.reasonCode, 'planner.missing_parameters');
});

test('instagram planner self-check writes descriptor-only artifacts', async (t) => {
  const root = await tempDir(t);
  const result = await runSelfCheck(parseArgs([
    '--self-check',
    '--self-check-out-dir', root,
    '--now', '2026-06-09',
  ]));

  assert.equal(result.ok, true);
  await fs.access(path.join(root, 'planner-check.json'));
  await fs.access(path.join(root, 'planner-check.md'));
  const summary = JSON.parse(await fs.readFile(path.join(root, 'planner-check.json'), 'utf8'));
  assert.equal(summary.ok, true);
  assert.equal(summary.safety.descriptorOnly, true);
  assert.equal(summary.safety.sensitiveMaterialRead, false);
  assert.doesNotMatch(JSON.stringify(summary), /Bearer\s+[A-Za-z0-9._-]+|set-cookie:|Authorization:\s*\S+|browserProfile|rawRequestBody/iu);
});
