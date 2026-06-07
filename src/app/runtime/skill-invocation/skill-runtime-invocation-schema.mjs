// @ts-check

export const SKILL_RUNTIME_INVOCATION_SCHEMA_VERSION = 'skill.runtime_invocation.v1';
export const SKILL_RUNTIME_INVOCATION_RESULT_SCHEMA_VERSION = 'skill.runtime_invocation_result.v1';
export const SKILL_RUNTIME_INVOCATION_PREVIEW_SCHEMA_VERSION = 'skill.runtime_invocation_preview.v1';
export const SKILL_RUNTIME_INVOCATION_IDEMPOTENCY_SCHEMA_VERSION = 'skill.runtime_invocation_idempotency.v1';

export const SKILL_RUNTIME_INVOCATION_MODES = Object.freeze([
  'dryRun',
  'execute',
]);

export const SKILL_RUNTIME_INVOCATION_POLICY_MODES = Object.freeze([
  'decision_ref_required',
  'simulate',
]);

export const SKILL_RUNTIME_INVOCATION_RESULT_STATUSES = Object.freeze([
  'preview',
  'completed',
  'blocked',
  'failed',
  'duplicate',
]);

export const SKILL_RUNTIME_INVOCATION_SAFE_REF_PATTERN = /^[a-z0-9][a-z0-9._:/@-]{0,199}$/iu;

export const SKILL_RUNTIME_INVOCATION_SCHEMA_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: 'SkillRuntimeInvocationRequest',
    version: SKILL_RUNTIME_INVOCATION_SCHEMA_VERSION,
    sourcePath: 'src/app/runtime/skill-invocation/skill-runtime-invocation-schema.mjs',
  }),
  Object.freeze({
    name: 'SkillRuntimeInvocationResult',
    version: SKILL_RUNTIME_INVOCATION_RESULT_SCHEMA_VERSION,
    sourcePath: 'src/app/runtime/skill-invocation/skill-runtime-invocation-schema.mjs',
  }),
  Object.freeze({
    name: 'SkillRuntimeInvocationDryRunPreview',
    version: SKILL_RUNTIME_INVOCATION_PREVIEW_SCHEMA_VERSION,
    sourcePath: 'src/app/runtime/skill-invocation/skill-runtime-invocation-schema.mjs',
  }),
  Object.freeze({
    name: 'SkillRuntimeInvocationIdempotencyLedger',
    version: SKILL_RUNTIME_INVOCATION_IDEMPOTENCY_SCHEMA_VERSION,
    sourcePath: 'src/app/runtime/skill-invocation/skill-runtime-invocation-schema.mjs',
  }),
]);

export function listSkillRuntimeInvocationSchemaDefinitions() {
  return SKILL_RUNTIME_INVOCATION_SCHEMA_DEFINITIONS.map((definition) => ({ ...definition }));
}
