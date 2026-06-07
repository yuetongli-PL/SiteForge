// @ts-check

export const LOCAL_SKILL_RUNTIME_SERVICE_SCHEMA_VERSION = 'skill.local_runtime_service.v1';
export const LOCAL_SKILL_RUNTIME_SERVICE_RESPONSE_SCHEMA_VERSION = 'skill.local_runtime_service_response.v1';

export const LOCAL_SKILL_RUNTIME_SERVICE_OPERATIONS = Object.freeze([
  'dryRun',
  'execute',
]);

export const LOCAL_SKILL_RUNTIME_SERVICE_NETWORK_BOUNDARY = Object.freeze({
  mode: 'local-sdk',
  serverEnabled: false,
  bindAddress: null,
  publicInterfaceBound: false,
  publicInternetService: false,
});

export const LOCAL_SKILL_RUNTIME_SERVICE_SCHEMA_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: 'LocalSkillRuntimeServiceRequest',
    version: LOCAL_SKILL_RUNTIME_SERVICE_SCHEMA_VERSION,
    sourcePath: 'src/app/runtime/skill-service/local-skill-runtime-service-schema.mjs',
  }),
  Object.freeze({
    name: 'LocalSkillRuntimeServiceResponse',
    version: LOCAL_SKILL_RUNTIME_SERVICE_RESPONSE_SCHEMA_VERSION,
    sourcePath: 'src/app/runtime/skill-service/local-skill-runtime-service-schema.mjs',
  }),
]);

export function listLocalSkillRuntimeServiceSchemaDefinitions() {
  return LOCAL_SKILL_RUNTIME_SERVICE_SCHEMA_DEFINITIONS.map((definition) => ({ ...definition }));
}
