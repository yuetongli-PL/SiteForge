import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCompilerLifecycleEvent,
} from '../../../src/sites/capability/compiler/index.mjs';

test('compiler lifecycle event requires redaction and required trace fields', () => {
  const event = createCompilerLifecycleEvent({
    traceId: 'trace:synthetic',
    correlationId: 'correlation:synthetic',
    site: 'synthetic.example',
    compileId: 'compile:synthetic',
    validationResult: 'passed',
    coverageMode: 'declared_only',
    coverageCompleteness: 'partial',
  });

  assert.equal(event.eventType, 'compiler.manifest.generated');
  assert.equal(event.redactionRequired, true);
  assert.equal(event.redactionEvent.redactionRequired, true);
});

test('compiler lifecycle event rejects sensitive values without echoing them', () => {
  assert.throws(
    () => createCompilerLifecycleEvent({
      traceId: 'trace:synthetic',
      correlationId: 'correlation:synthetic',
      site: 'synthetic.example',
      compileId: 'compile:synthetic',
      validationResult: 'passed',
      reasonCode: 'https://synthetic.example/?access_token=synthetic-secret-value',
    }),
    (error) => {
      assert.equal(error.code, 'compiler.raw_sensitive_material_rejected');
      assert.doesNotMatch(error.message, /synthetic-secret-value/u);
      return true;
    },
  );
});
