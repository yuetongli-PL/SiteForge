// @ts-check

export const RUNTIME_CI_REGRESSION_HARNESS_SCHEMA_VERSION = 'runtime.ci_regression_harness.v1';
export const RUNTIME_CI_REGRESSION_SNAPSHOT_SCHEMA_VERSION = 'runtime.ci_regression_snapshot.v1';
export const RUNTIME_CI_REGRESSION_REPORT_SCHEMA_VERSION = 'runtime.ci_regression_report.v1';

export const RUNTIME_CI_REGRESSION_SEVERITIES = Object.freeze([
  'none',
  'low',
  'medium',
  'high',
  'critical',
]);

export const RUNTIME_CI_REGRESSION_STATUS_VALUES = Object.freeze([
  'same',
  'changed',
  'failed_closed',
]);

export const RUNTIME_CI_REGRESSION_SCHEMA_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: 'RuntimeCiRegressionSnapshot',
    version: RUNTIME_CI_REGRESSION_SNAPSHOT_SCHEMA_VERSION,
    sourcePath: 'src/app/runtime/regression-harness/runtime-regression-schema.mjs',
  }),
  Object.freeze({
    name: 'RuntimeCiRegressionComparison',
    version: RUNTIME_CI_REGRESSION_HARNESS_SCHEMA_VERSION,
    sourcePath: 'src/app/runtime/regression-harness/runtime-regression-schema.mjs',
  }),
  Object.freeze({
    name: 'RuntimeCiRegressionReport',
    version: RUNTIME_CI_REGRESSION_REPORT_SCHEMA_VERSION,
    sourcePath: 'src/app/runtime/regression-harness/runtime-regression-schema.mjs',
  }),
]);

export function listRuntimeCiRegressionSchemaDefinitions() {
  return RUNTIME_CI_REGRESSION_SCHEMA_DEFINITIONS.map((definition) => ({ ...definition }));
}
