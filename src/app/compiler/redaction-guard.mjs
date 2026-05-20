// @ts-check

import {
  assertNoForbiddenPatterns,
  redactValue,
} from '../../domain/sessions/security-guard.mjs';
import {
  SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
} from './schema.mjs';
import {
  assertNoCompilerSensitiveMaterial,
} from './validator.mjs';

export function prepareCompilerDerivedArtifact({
  artifactType,
  value,
} = {}) {
  if (typeof artifactType !== 'string' || artifactType.trim() === '') {
    const error = new Error('Compiler artifact type is required');
    error.code = 'compiler.schema_invalid';
    throw error;
  }
  if (value?.redactionRequired !== true) {
    const error = new Error('Compiler-derived artifact redactionRequired must be true');
    error.code = 'compiler.redaction_required';
    throw error;
  }
  assertNoCompilerSensitiveMaterial(value);
  const redacted = redactValue(value);
  const artifactJson = JSON.stringify(redacted.value, null, 2);
  const auditJson = JSON.stringify(redacted.audit, null, 2);
  assertNoForbiddenPatterns(artifactJson);
  assertNoForbiddenPatterns(auditJson);
  return {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    artifactType,
    artifactJson,
    auditJson,
    redactionRequired: true,
    redactionApplied: true,
    writeAllowed: true,
  };
}
