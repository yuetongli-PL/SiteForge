import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';

import {
  knowledgeBaseLintReportArtifactPaths,
  writeKnowledgeBaseLintReports,
} from '../../src/app/pipeline/stages/kb/lint-report.mjs';
import { assertSchemaCompatible } from '../../src/domain/schemas/compatibility-registry.mjs';

const KB_FILES = {
  lintReportJson: 'lint-report.json',
  lintReportMd: 'lint-report.md',
  gapReportJson: 'gap-report.json',
  gapReportMd: 'gap-report.md',
};

function syntheticLintReport() {
  return {
    generatedAt: '2026-05-02T00:00:00.000Z',
    kbDir: 'C:/synthetic/kb',
    summary: {
      passed: false,
      errorCount: 1,
      warningCount: 1,
    },
    errors: [{
      code: 'synthetic-error',
      message: 'Authorization: Bearer synthetic-kb-lint-token',
      path: 'wiki/error.md',
    }],
    warnings: [{
      code: 'synthetic-warning',
      message: 'access_token=synthetic-kb-lint-access',
      path: 'wiki/warning.md',
    }],
  };
}

function syntheticGapReport() {
  return {
    generatedAt: '2026-05-02T00:00:00.000Z',
    kbDir: 'C:/synthetic/kb',
    groups: {
      orphanPages: [{
        code: 'orphan-page',
        message: 'refresh_token=synthetic-kb-gap-refresh',
        path: 'wiki/orphan.md',
      }],
      other: [],
    },
  };
}

test('knowledge base lint reports write redacted JSON and Markdown audit sidecars', async (t) => {
  const reportDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-kb-lint-report-'));
  t.after(() => rm(reportDir, { recursive: true, force: true }));

  const result = await writeKnowledgeBaseLintReports(
    reportDir,
    KB_FILES,
    syntheticLintReport(),
    syntheticGapReport(),
  );
  const paths = knowledgeBaseLintReportArtifactPaths(reportDir, KB_FILES);
  assert.deepEqual(result.paths, paths);
  assert.deepEqual(result.artifacts, {
    schemaVersion: 1,
    ...paths,
  });
  assert.equal(assertSchemaCompatible('ArtifactReferenceSet', result.artifacts), true);

  const texts = await Promise.all(Object.values(paths).map((filePath) => readFile(filePath, 'utf8')));
  assert.doesNotMatch(
    texts.join('\n'),
    /synthetic-kb-|Authorization: Bearer|access_token=|refresh_token=/iu,
  );

  const lintReport = JSON.parse(await readFile(paths.lintReportJson, 'utf8'));
  const gapReport = JSON.parse(await readFile(paths.gapReportJson, 'utf8'));
  assert.equal(lintReport.errors[0].message, 'Authorization: [REDACTED]');
  assert.equal(lintReport.warnings[0].message, '[REDACTED]');
  assert.equal(gapReport.groups.orphanPages[0].message, '[REDACTED]');
  assert.match(await readFile(paths.lintReportMd, 'utf8'), /^# Lint Report/mu);
  assert.match(await readFile(paths.gapReportMd, 'utf8'), /^# Gap Report/mu);

  const lintAudit = JSON.parse(await readFile(paths.lintReportJsonAudit, 'utf8'));
  const gapAudit = JSON.parse(await readFile(paths.gapReportJsonAudit, 'utf8'));
  assert.equal(lintAudit.redactedPaths.includes('errors.0.message'), true);
  assert.equal(gapAudit.redactedPaths.includes('groups.orphanPages.0.message'), true);
});

test('knowledge base lint report writer fails closed before report files are written', async (t) => {
  const reportDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-kb-lint-report-fail-closed-'));
  t.after(() => rm(reportDir, { recursive: true, force: true }));
  const badReport = {
    toJSON() {
      throw new Error(
        'Authorization: Bearer synthetic-kb-lint-cause-token access_token=synthetic-kb-lint-cause-access',
      );
    },
  };

  await assert.rejects(
    () => writeKnowledgeBaseLintReports(reportDir, KB_FILES, badReport, syntheticGapReport()),
    (error) => {
      assert.equal(error.name, 'KnowledgeBaseLintReportRedactionFailure');
      assert.equal(error.reasonCode, 'redaction-failed');
      assert.equal(error.artifactWriteAllowed, false);
      assert.equal(Object.hasOwn(error, 'cause'), false);
      assert.deepEqual(error.causeSummary, {
        name: 'Error',
        code: null,
      });
      assert.doesNotMatch(
        `${error.message}\n${JSON.stringify(error)}`,
        /synthetic-kb-lint-cause-|Authorization: Bearer|access_token=/iu,
      );
      return true;
    },
  );
  assert.deepEqual(await readdir(reportDir), []);
});
