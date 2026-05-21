import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  SITEFORGE_DEBUG_REPORT_FILE,
  SITEFORGE_DEBUG_REPORT_JSON_ALIAS,
  SITEFORGE_INDEX_REPORT_FILE,
  SITEFORGE_REQUIRED_ARTIFACTS,
  SITEFORGE_REQUIRED_FINAL_ARTIFACTS,
  SITEFORGE_REQUIRED_PRE_PROMOTION_ARTIFACTS,
  SITEFORGE_REPORT_ALIASES,
  SITEFORGE_USER_REPORT_FILE,
  SITEFORGE_USER_REPORT_JSON_ALIAS,
  SITEFORGE_USER_REPORT_MARKDOWN_ALIAS,
  SITEFORGE_USER_REPORT_MARKDOWN_FILE,
} from '../../src/app/pipeline/build/artifact-contract.mjs';
import {
  SITEFORGE_REQUIRED_FINAL_ARTIFACTS as VALIDATION_FINAL_ARTIFACTS,
  SITEFORGE_REQUIRED_PRE_PROMOTION_ARTIFACTS as VALIDATION_PRE_PROMOTION_ARTIFACTS,
} from '../../src/app/pipeline/build/output-validation.mjs';

test('build pipeline and output validation share one required artifact contract', () => {
  assert.deepEqual(SITEFORGE_REQUIRED_ARTIFACTS, SITEFORGE_REQUIRED_FINAL_ARTIFACTS);
  assert.deepEqual(VALIDATION_PRE_PROMOTION_ARTIFACTS, SITEFORGE_REQUIRED_PRE_PROMOTION_ARTIFACTS);
  assert.deepEqual(VALIDATION_FINAL_ARTIFACTS, SITEFORGE_REQUIRED_FINAL_ARTIFACTS);
});

test('build report filenames and aliases are contract-backed', () => {
  assert.equal(SITEFORGE_USER_REPORT_FILE, 'build_report.user.json');
  assert.equal(SITEFORGE_USER_REPORT_MARKDOWN_FILE, 'build_report.user.md');
  assert.equal(SITEFORGE_DEBUG_REPORT_FILE, 'build_report.debug.json');
  assert.equal(SITEFORGE_INDEX_REPORT_FILE, 'build_report.json');
  assert.deepEqual(SITEFORGE_REPORT_ALIASES[SITEFORGE_USER_REPORT_FILE], [
    SITEFORGE_USER_REPORT_JSON_ALIAS,
    SITEFORGE_USER_REPORT_MARKDOWN_ALIAS,
  ]);
  assert.deepEqual(SITEFORGE_REPORT_ALIASES[SITEFORGE_DEBUG_REPORT_FILE], [
    SITEFORGE_DEBUG_REPORT_JSON_ALIAS,
  ]);
});

test('README does not carry drifted legacy build artifact names', async () => {
  const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
  assert.doesNotMatch(readme, /run-manifest|pipeline runtime/u);
  assert.match(readme, /build_report\.user\.json|Site workspace/u);
});
