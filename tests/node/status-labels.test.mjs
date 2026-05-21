import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStatusLabel,
  collectionStatusLabel,
  completionCurrentOutputLabel,
  completionRegistryLabel,
  completionVerificationLabel,
  resultBuildStatusLabel,
  resultStatusLabel,
  setupStatusLabel,
  verificationStatusLabel,
} from '../../src/infra/cli/status-labels.mjs';

test('status labels preserve user-facing build and verification wording', () => {
  assert.equal(resultStatusLabel('success'), '成功');
  assert.equal(resultStatusLabel('failed'), '失败');
  assert.equal(resultStatusLabel('partial'), '部分成功');
  assert.equal(buildStatusLabel('blocked'), '已阻止');
  assert.equal(verificationStatusLabel('registered'), '已注册');
  assert.equal(setupStatusLabel('reused'), '已复用');
});

test('resultBuildStatusLabel keeps result fallback behavior', () => {
  assert.equal(resultBuildStatusLabel({ user_report: { result_status: 'success' }, status: 'failed' }), '成功');
  assert.equal(resultBuildStatusLabel({ userReport: { result_status: 'failed' }, status: 'success' }), '失败');
  assert.equal(resultBuildStatusLabel({ status: 'success' }), '成功');
  assert.equal(resultBuildStatusLabel({ status: 'blocked' }), '部分成功');
});

test('completion labels preserve report-specific wording', () => {
  assert.equal(completionVerificationLabel('passed'), '通过');
  assert.equal(completionVerificationLabel('failed'), '未通过');
  assert.equal(completionCurrentOutputLabel(true), '已更新');
  assert.equal(completionCurrentOutputLabel(false), '未更新');
  assert.equal(completionRegistryLabel(true), '已注册');
  assert.equal(completionRegistryLabel(false), '未注册');
});

test('collectionStatusLabel preserves collection status wording', () => {
  assert.equal(collectionStatusLabel('candidate'), '候选');
  assert.equal(collectionStatusLabel('discarded'), '丢弃');
  assert.equal(collectionStatusLabel('skipped'), '已跳过');
  assert.equal(collectionStatusLabel('blocked'), '已阻止');
  assert.equal(collectionStatusLabel('custom'), 'custom');
});
