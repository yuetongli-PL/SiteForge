import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SITEFORGE_BUILD_STAGE_NAMES,
} from '../../src/app/pipeline/build/stage-plan.mjs';
import {
  SITEFORGE_BUILD_STAGE_COPY,
  siteForgeBuildStageTitle,
} from '../../src/app/pipeline/build/progress-copy.mjs';

test('SiteForge build progress copy stays aligned with the build stage plan', () => {
  assert.deepEqual(Object.keys(SITEFORGE_BUILD_STAGE_COPY), SITEFORGE_BUILD_STAGE_NAMES);

  for (const stageName of SITEFORGE_BUILD_STAGE_NAMES) {
    assert.notEqual(siteForgeBuildStageTitle(stageName), stageName);
    assert.notEqual(siteForgeBuildStageTitle(stageName, 'en'), stageName);
  }
});

test('SiteForge build progress stage titles keep stable localized labels', () => {
  assert.equal(siteForgeBuildStageTitle('registerSite'), '\u6ce8\u518c\u7ad9\u70b9');
  assert.equal(siteForgeBuildStageTitle('discoverSeeds'), '\u53d1\u73b0\u79cd\u5b50\u9875\u9762');
  assert.equal(siteForgeBuildStageTitle('crawlStatic'), '\u91c7\u96c6\u9759\u6001\u9875\u9762');
  assert.equal(siteForgeBuildStageTitle('authStateCheck'), '\u68c0\u67e5\u8ba4\u8bc1\u72b6\u6001');
  assert.equal(siteForgeBuildStageTitle('crawlAuthenticated'), '\u91c7\u96c6\u8ba4\u8bc1\u9875\u9762');
  assert.equal(siteForgeBuildStageTitle('writeBuildReport'), '\u5199\u5165\u6784\u5efa\u62a5\u544a');
  assert.equal(siteForgeBuildStageTitle('registerSite', 'en'), 'Registering site');
  assert.equal(siteForgeBuildStageTitle('unknownStage'), 'unknownStage');
});
