import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOCTOR_STAGE_COPY,
  doctorStageTitle,
} from '../../src/entrypoints/sites/site-doctor-progress-copy.mjs';

test('site-doctor progress copy owns doctor stage titles', () => {
  assert.equal(DOCTOR_STAGE_COPY.profile.en, 'Checking site profile');
  assert.equal(doctorStageTitle('download', 'en'), 'Checking download readiness');
  assert.equal(doctorStageTitle('unknown-stage', 'en'), 'unknown-stage');
});
