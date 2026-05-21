#!/usr/bin/env node
// @ts-check

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, '..');

const SYNTAX_CHECK_FILES = Object.freeze([
  'src/entrypoints/cli/index.mjs',
  'src/entrypoints/operator/capabilities.mjs',
  'src/entrypoints/pipeline/run-pipeline.mjs',
  'src/app/pipeline/build/pipeline.mjs',
  'src/app/pipeline/build/setup-assistant.mjs',
  'src/app/pipeline/build/user-report.mjs',
  'src/app/pipeline/build/risk-policy.mjs',
  'src/app/pipeline/build/confirmation-flow.mjs',
  'src/app/pipeline/build/capability-decision-records.mjs',
  'src/app/pipeline/build/capability-interaction.mjs',
  'src/app/pipeline/stages/analyze.mjs',
  'src/app/pipeline/stages/collect-content.mjs',
  'src/app/pipeline/stages/abstract.mjs',
  'src/app/pipeline/stages/docs.mjs',
  'src/app/pipeline/stages/governance.mjs',
  'src/app/pipeline/stages/nl.mjs',
  'src/app/pipeline/stages/kb/layout.mjs',
  'src/domain/sessions/report-redaction-fields.mjs',
  'src/domain/sessions/fresh-evidence-redaction.mjs',
  'src/entrypoints/cli/public-build-contract.mjs',
  'src/infra/paths/repo-root.mjs',
  'src/infra/cli/internal-options.mjs',
  'src/infra/cli/parse-values.mjs',
  'src/infra/cli/path-display.mjs',
  'src/infra/cli/status-labels.mjs',
  'src/shared/boolean.mjs',
  'src/shared/clone.mjs',
  'src/shared/html-escape.mjs',
  'src/shared/time.mjs',
  'src/shared/url-safety.mjs',
  'src/sites/known-sites/paths.mjs',
  'src/sites/known-sites/bilibili/actions/router.mjs',
  'src/sites/known-sites/douyin/actions/router.mjs',
  'src/sites/known-sites/xiaohongshu/actions/router.mjs',
  'src/sites/known-sites/xiaohongshu/queries/follow-query.mjs',
  'src/sites/known-sites/social/actions/router.mjs',
]);

let failed = false;

for (const relativePath of SYNTAX_CHECK_FILES) {
  const result = spawnSync(process.execPath, ['--check', relativePath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    console.log(`ok ${relativePath}`);
    continue;
  }

  failed = true;
  console.error(`failed ${relativePath}`);
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`Syntax check passed for ${SYNTAX_CHECK_FILES.length} files.`);
}
