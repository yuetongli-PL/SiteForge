import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReportWarningSummary,
  buildStageRecord,
  classifyBuildFailure,
  safeBuildMessagesForReport,
  safeBuildWarningForReport,
} from '../../src/app/pipeline/build/build-stage-report.mjs';

test('build stage report warning sanitizer preserves approved messages and normalizes unsafe messages', () => {
  assert.equal(
    safeBuildWarningForReport('Network summary requested; raw network traces were not captured or persisted.'),
    'Network summary requested; raw network traces were not captured or persisted.',
  );
  assert.equal(safeBuildWarningForReport('user token=secret failed'), 'validation-failed');
  assert.deepEqual(safeBuildMessagesForReport([
    '',
    'user token=secret failed',
    'Network summary requested; raw network traces were not captured or persisted.',
  ]), [
    'Network summary requested; raw network traces were not captured or persisted.',
    'validation-failed',
  ]);
});

test('build stage report records stage reason codes, sanitized messages, and artifacts', () => {
  const record = buildStageRecord(
    'crawlStatic',
    'failed',
    {
      reasonCode: 'robots-disallowed',
      warnings: [
        'robots excluded all planned seed URLs before crawl.',
        'unknown warning token=secret',
      ],
      errors: ['raw error token=secret'],
      artifactPaths: { crawl: 'build/crawl.json' },
      summary: { pages: 0 },
    },
    '2026-05-28T00:00:00.000Z',
    '2026-05-28T00:00:01.000Z',
  );

  assert.equal(record.name, 'crawlStatic');
  assert.equal(record.status, 'failed');
  assert.equal(record.reasonCode, 'robots-disallowed');
  assert.equal(record.failureClass, 'robots');
  assert.deepEqual(record.reasonCodes, ['robots-disallowed']);
  assert.deepEqual(record.warnings, [
    'robots excluded all planned seed URLs before crawl.',
    'robots-disallowed',
  ]);
  assert.deepEqual(record.errors, ['robots-disallowed']);
  assert.deepEqual(record.artifactPaths, { crawl: 'build/crawl.json' });
  assert.deepEqual(record.summary, { pages: 0 });
  assert.equal(Array.isArray(record.deps), true);
});

test('build report warning summary merges context and stage warnings safely', () => {
  const summary = buildReportWarningSummary({
    crawlStatic: {
      reasonCodes: ['robots-disallowed'],
      warnings: [
        'robots excluded all planned seed URLs before crawl.',
        'raw warning token=secret',
      ],
    },
    verifySkill: {
      reasonCodes: ['validation-failed'],
      warnings: ['Network summary requested; raw network traces were not captured or persisted.'],
    },
  }, [
    'context warning token=secret',
    'Network summary requested; raw network traces were not captured or persisted.',
  ]);

  assert.deepEqual(summary.warningCodes, [
    'network-fetch-failed',
    'robots-disallowed',
    'validation-failed',
  ]);
  assert.deepEqual(summary.reportWarnings, [
    'Network summary requested; raw network traces were not captured or persisted.',
    'robots excluded all planned seed URLs before crawl.',
    'validation-failed',
  ]);
  assert.doesNotMatch(JSON.stringify(summary), /secret/u);
});

test('build failure classifier prefers explicit and stage reason evidence', () => {
  assert.equal(classifyBuildFailure({ reasonCode: 'robots-unavailable' }, {})?.reasonCode, 'robots-unavailable');
  assert.equal(classifyBuildFailure({}, {
    crawlStatic: {
      status: 'failed',
      reasonCode: 'network-fetch-failed',
      reasonCodes: ['network-fetch-failed'],
    },
  })?.reasonCode, 'network-fetch-failed');
});
