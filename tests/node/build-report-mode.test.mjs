import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReportPayloadForMode,
  normalizeReportMode,
} from '../../src/app/pipeline/build/build-report-mode.mjs';

test('build report mode normalization follows artifact contract modes', () => {
  assert.equal(normalizeReportMode('USER'), 'user');
  assert.equal(normalizeReportMode('debug'), 'debug');
  assert.equal(normalizeReportMode('both'), 'both');
  assert.equal(normalizeReportMode('unknown'), 'user');
  assert.equal(normalizeReportMode('unknown', 'debug'), 'debug');
});

test('build report payload selection returns mode-specific payloads', () => {
  const result = {
    status: 'success',
    buildId: 'build-1',
    skillId: 'skill-1',
    user_report: { kind: 'user' },
    debug_report: { kind: 'debug' },
  };

  assert.deepEqual(buildReportPayloadForMode(result, { reportMode: 'user' }), { kind: 'user' });
  assert.deepEqual(buildReportPayloadForMode(result, { report: 'debug' }), { kind: 'debug' });
  assert.deepEqual(buildReportPayloadForMode(result, { reportMode: 'both' }), {
    result_status: 'success',
    build_id: 'build-1',
    skill_id: 'skill-1',
    user: { kind: 'user' },
    debug: { kind: 'debug' },
    index: result,
  });
});
