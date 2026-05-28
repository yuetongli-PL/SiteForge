import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SITEFORGE_BUILD_STAGE_DEPENDENCIES,
  SITEFORGE_BUILD_STAGE_NAMES,
  assertSiteForgeBuildStagePlan,
  siteForgeBuildStageDependencies,
  validateSiteForgeBuildStagePlan,
} from '../../src/app/pipeline/build/stage-plan.mjs';
import {
  SITEFORGE_BUILD_STAGE_NAMES as PIPELINE_STAGE_NAMES,
} from '../../src/app/pipeline/build/pipeline.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');

test('SiteForge build stage plan stays ordered and complete for pipeline orchestration', () => {
  assert.equal(assertSiteForgeBuildStagePlan(), true);
  assert.deepEqual(PIPELINE_STAGE_NAMES, SITEFORGE_BUILD_STAGE_NAMES);

  const seen = new Set();
  for (const stageName of SITEFORGE_BUILD_STAGE_NAMES) {
    assert.ok(
      Object.hasOwn(SITEFORGE_BUILD_STAGE_DEPENDENCIES, stageName),
      `${stageName} should declare dependencies`,
    );
    for (const dependency of SITEFORGE_BUILD_STAGE_DEPENDENCIES[stageName]) {
      assert.ok(seen.has(dependency), `${stageName} dependency ${dependency} should run earlier`);
    }
    seen.add(stageName);
  }

  assert.deepEqual(siteForgeBuildStageDependencies('crawlStatic'), ['discoverSeeds']);
  assert.deepEqual(siteForgeBuildStageDependencies('unknownStage'), []);
});

test('SiteForge build stage plan rejects dependency drift before runtime execution', () => {
  assert.deepEqual(
    validateSiteForgeBuildStagePlan({
      stageNames: ['first', 'second'],
      dependencies: {
        first: ['second'],
        second: [],
        ghost: [],
      },
    }),
    {
      valid: false,
      errors: [
        'dependency map contains unknown stage ghost',
        'stage first depends on later stage second',
      ],
    },
  );

  assert.throws(
    () => assertSiteForgeBuildStagePlan({
      stageNames: ['first'],
      dependencies: {
        first: ['missing'],
      },
    }),
    /Invalid SiteForge build stage plan: stage first depends on unknown stage missing/u,
  );
});

test('SiteForge build pipeline imports the stage plan instead of redefining it inline', async () => {
  const pipelineSource = await readFile(
    path.join(REPO_ROOT, 'src', 'app', 'pipeline', 'build', 'pipeline.mjs'),
    'utf8',
  );

  assert.match(pipelineSource, /from\s+['"]\.\/stage-plan\.mjs['"]/u);
  assert.doesNotMatch(
    pipelineSource,
    /(?:export\s+)?const\s+SITEFORGE_BUILD_STAGE_NAMES\s*=\s*Object\.freeze/u,
  );
  assert.doesNotMatch(
    pipelineSource,
    /(?:export\s+)?const\s+STAGE_DEPENDENCIES\s*=\s*Object\.freeze/u,
  );
});
