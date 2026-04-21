import test from 'node:test';
import assert from 'node:assert/strict';

import * as douyinActionEntrypoint from '../../src/entrypoints/sites/douyin-action.mjs';
import * as douyinFollowEntrypoint from '../../src/entrypoints/sites/douyin-query-follow.mjs';
import * as douyinResolveEntrypoint from '../../src/entrypoints/sites/douyin-resolve-media.mjs';
import * as douyinCookiesEntrypoint from '../../src/entrypoints/sites/douyin-export-cookies.mjs';
import * as bilibiliActionEntrypoint from '../../src/entrypoints/sites/bilibili-action.mjs';
import * as bilibiliOpenEntrypoint from '../../src/entrypoints/sites/bilibili-open-page.mjs';
import * as bilibiliExtractEntrypoint from '../../src/entrypoints/sites/bilibili-extract-links.mjs';
import * as runPipelineEntrypoint from '../../src/entrypoints/pipeline/run-pipeline.mjs';
import * as captureEntrypoint from '../../src/entrypoints/pipeline/capture.mjs';
import * as expandStatesEntrypoint from '../../src/entrypoints/pipeline/expand-states.mjs';
import * as compileWikiEntrypoint from '../../src/entrypoints/pipeline/compile-wiki.mjs';
import * as generateSkillEntrypoint from '../../src/entrypoints/pipeline/generate-skill.mjs';

test('canonical site CLI entrypoints expose the expected Douyin handlers', () => {
  assert.equal(typeof douyinActionEntrypoint.runDouyinActionCli, 'function');
  assert.equal(typeof douyinFollowEntrypoint.runDouyinFollowQueryCli, 'function');
  assert.equal(typeof douyinResolveEntrypoint.runDouyinMediaResolverCli, 'function');
  assert.equal(typeof douyinCookiesEntrypoint.runDouyinExportCookiesCli, 'function');
});

test('canonical site CLI entrypoints expose the expected bilibili handlers', () => {
  assert.equal(typeof bilibiliActionEntrypoint.cli, 'function');
  assert.equal(typeof bilibiliOpenEntrypoint.openBilibiliPage, 'function');
  assert.equal(typeof bilibiliOpenEntrypoint.runBilibiliOpenCli, 'function');
  assert.equal(typeof bilibiliExtractEntrypoint.runBilibiliExtractLinksCli, 'function');
});

test('canonical pipeline entrypoints re-export the expected stage helpers', () => {
  assert.equal(typeof runPipelineEntrypoint.runPipeline, 'function');
  assert.equal(typeof captureEntrypoint.capture, 'function');
  assert.equal(typeof expandStatesEntrypoint.expandStates, 'function');
  assert.equal(typeof compileWikiEntrypoint.compileKnowledgeBase, 'function');
  assert.equal(typeof generateSkillEntrypoint.generateSkill, 'function');
});
