// @ts-check

import {
  assertNoForbiddenPatterns,
  redactValue,
} from '../../sessions/security-guard.mjs';
import {
  assertNoExecutionSensitiveMaterial,
} from './validator.mjs';

export function prepareExecutionArtifactJsonWithAudit(value) {
  if (value?.redactionRequired !== true) {
    /** @type {Error & Record<string, any>} */
    const error = new Error('Execution artifact redactionRequired must be true');
    error.code = 'execution.redaction_required';
    throw error;
  }
  assertNoExecutionSensitiveMaterial(value);
  const redacted = redactValue(value);
  const artifactJson = JSON.stringify(redacted.value, null, 2);
  const auditJson = JSON.stringify(redacted.audit, null, 2);
  assertNoForbiddenPatterns(artifactJson);
  assertNoForbiddenPatterns(auditJson);
  return {
    artifactJson,
    auditJson,
    redactionRequired: true,
    redactionApplied: true,
  };
}
