// @ts-check

export const RUNTIME_RUN_STORE_SCHEMA_VERSION = 'runtime.run_store.v1';
export const RUNTIME_RUN_STORE_MANIFEST_SCHEMA_VERSION = 1;
export const RUNTIME_RUN_STORE_QUERY_INDEX_SCHEMA_VERSION = 1;
export const RUNTIME_RUN_STORE_RETENTION_SCHEMA_VERSION = 1;

export const RUN_STORE_FILE_KINDS = Object.freeze([
  'runtime_execution_report',
  'audit_events',
  'audit_view',
  'query_index',
  'artifact_metadata',
]);
