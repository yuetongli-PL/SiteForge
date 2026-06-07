# Runtime Regression Harness

The runtime regression harness compares sanitized runtime snapshots and reports release-risk changes. It is a CI and release verification tool, not a runtime execution surface.

## Core APIs

Regression snapshots use:

- `RUNTIME_CI_REGRESSION_SNAPSHOT_SCHEMA_VERSION`
- `RUNTIME_CI_REGRESSION_REPORT_SCHEMA_VERSION`
- `RUNTIME_CI_REGRESSION_HARNESS_SCHEMA_VERSION`
- `RUNTIME_CI_REGRESSION_SCHEMA_DEFINITIONS`
- `RUNTIME_CI_REGRESSION_SEVERITIES`

Use these APIs:

- `assertRuntimeRegressionSnapshotValid`
- `sanitizeRuntimeRegressionSnapshot`
- `compareRuntimeRegressionSnapshots`
- `createRuntimeRegressionReport`
- `runRuntimeRegressionHarness`
- `classifyRuntimeRegressionSeverity`
- `maxRuntimeRegressionSeverity`
- `runtimeRegressionSnapshotsEqual`

## Boundary

The harness does not execute providers, browsers, vault calls, or network requests. It evaluates sanitized snapshots and flags drift such as blocked payment requests becoming provider-invoked, blocked destructive requests becoming provider-invoked, policy denial becoming allow, or auth scope widening.

Fixture factories are testing helpers. `createRuntimeRegressionSnapshotFixture` is exposed through `src/app/runtime/testing.mjs`, not through `src/app/runtime/index.mjs`.

Payment execution is not implemented. Default destructive execution is blocked.
