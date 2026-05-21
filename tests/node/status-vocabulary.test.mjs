import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  BuildStatus,
  CapabilityEnablementStatus,
  DownloadStatus,
  EvidenceStatus,
  OutcomeStatus,
  StageStatus,
  isKnownStatus,
} from '../../src/domain/status/status-vocabulary.mjs';

test('status vocabulary defines the public report status sets', () => {
  assert.equal(isKnownStatus('BuildStatus', 'partial_success'), true);
  assert.equal(isKnownStatus('OutcomeStatus', 'failed'), true);
  assert.equal(isKnownStatus('DownloadStatus', 'blocked'), true);
  assert.equal(isKnownStatus('CapabilityEnablementStatus', 'debug_only'), true);
  assert.equal(isKnownStatus('EvidenceStatus', 'fixture_only'), true);
  assert.equal(isKnownStatus('StageStatus', 'passed'), true);
  assert.equal(isKnownStatus('BuildStatus', 'mystery'), false);
});

test('status vocabulary stays duplicate-free', () => {
  for (const [name, values] of Object.entries({
    StageStatus,
    BuildStatus,
    OutcomeStatus,
    DownloadStatus,
    CapabilityEnablementStatus,
    EvidenceStatus,
  })) {
    assert.equal(new Set(values).size, values.length, `${name} contains duplicate values`);
  }
});

test('result_status and legacy_status compatibility fields carry migration comments', async () => {
  const source = await readFile(new URL('../../src/app/pipeline/build/pipeline.mjs', import.meta.url), 'utf8');
  assert.match(source, /Migration: status remains the legacy stage\/build field; result_status/u);
  assert.match(source, /Migration: keep legacy_status during report consumers' transition/u);
});
