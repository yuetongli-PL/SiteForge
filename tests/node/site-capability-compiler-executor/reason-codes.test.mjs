import test from 'node:test';
import assert from 'node:assert/strict';

import {
  listCompilerExecutorReasonCodeDefinitions,
  requireCompilerExecutorReasonCodeDefinition,
} from '../../../src/sites/capability/compiler/index.mjs';

const REQUIRED_CODES = [
  'compiler.request_invalid',
  'compiler.scope_invalid',
  'compiler.capability_intake_invalid',
  'compiler.raw_sensitive_material_rejected',
  'compiler.manifest_invalid',
  'compiler.coverage_incomplete',
  'compiler.graph_build_failed',
  'execution.plan_invalid',
  'execution.layer_handoff_unavailable',
  'execution.policy_denied',
  'execution.redaction_failed',
  'execution.feedback_write_failed',
];

test('compiler/executor reason codes are cataloged with gate semantics', () => {
  const definitions = listCompilerExecutorReasonCodeDefinitions();
  const byCode = new Map(definitions.map((definition) => [definition.code, definition]));

  for (const code of REQUIRED_CODES) {
    const definition = byCode.get(code);
    assert.notEqual(definition, undefined, `${code} should be defined`);
    assert.equal(typeof definition.retryable, 'boolean');
    assert.equal(typeof definition.cooldownRequired, 'boolean');
    assert.equal(typeof definition.manualInterventionRequired, 'boolean');
    assert.equal(typeof definition.degradable, 'boolean');
    assert.equal(typeof definition.artifactWriteAllowed, 'boolean');
    assert.equal(typeof definition.plannerHandoffAllowed, 'boolean');
    assert.equal(typeof definition.layerHandoffAllowed, 'boolean');
  }
});

test('unknown compiler/executor reason codes fail closed', () => {
  assert.throws(
    () => requireCompilerExecutorReasonCodeDefinition('compiler.unknown'),
    (error) => error.code === 'compiler.reason_code_unknown',
  );
});
