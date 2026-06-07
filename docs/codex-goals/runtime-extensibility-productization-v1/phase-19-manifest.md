# Phase 19 Manifest: Runtime CI Regression Harness V1

## Goal

Combine conformance-style runtime snapshots, audit view comparison, policy simulation regression, capability graph diff, and package diff into a descriptor-only CI regression harness that blocks runtime safety drift without executing providers, browsers, vault material access, live websites, or arbitrary network.

## Allowed File Areas

- `src/app/runtime/regression-harness/`
- `src/app/runtime/index.mjs` production-facing regression harness exports only
- `tests/node/runtime-ci-regression-harness-v1.test.mjs`
- `tests/node/fixtures/runtime-ci-regression-harness-v1/`
- `docs/codex-goals/runtime-extensibility-productization-v1/`

## Forbidden File Areas

- provider/browser/vault/network execution paths
- raw artifact content reads
- concrete provider implementations
- browser runtime implementation
- session vault material APIs
- production payment/destructive provider registration
- accepted test assertion weakening

## Planned Public API

Planned exports from `src/app/runtime/regression-harness/index.mjs`:

- `RUNTIME_CI_REGRESSION_HARNESS_SCHEMA_VERSION`
- `RUNTIME_CI_REGRESSION_REPORT_SCHEMA_VERSION`
- `RUNTIME_CI_REGRESSION_SEVERITIES`
- `sanitizeRuntimeRegressionSnapshot`
- `assertRuntimeRegressionSnapshotValid`
- `assertNoRuntimeRegressionRawMaterial`
- `compareRuntimeRegressionSnapshots`
- `classifyRuntimeRegressionSeverity`
- `createRuntimeRegressionReport`
- `runRuntimeRegressionHarness`

## Semantics That Must Not Change

- regression harness never executes provider/browser/vault/network.
- regression harness reads only caller-provided sanitized snapshots and descriptors.
- payment/destructive blocked reasons remain stable and high-risk if changed.
- provider invocation for payment/destructive remains critical/high drift.
- raw material in snapshots fails closed.

## Security Boundary

- reject raw cookie/token/header/body/session/browser/private/payment material.
- reject malformed snapshots fail closed.
- sanitize regression reports and strip unknown unsafe fields.
- report can include stable refs, status, reasons, provider ids, auth summary, browser guard summary, policy/package/graph diff summaries only.

## Architecture Boundary

- may import audit-query compare/regression helpers, graph-registry diff, capability-package diff, and policy-pack regression.
- must not import concrete providers, provider registry, browser runtime, session vault material APIs, mock providers, testing helpers, fs readers, or network APIs.

## Targeted Tests

- `node --test tests/node/runtime-ci-regression-harness-v1.test.mjs`
- `node --test tests/node/runtime-audit-query-api-v1.test.mjs`
- `node --test tests/node/capability-graph-versioning-registry-v1.test.mjs`
- `node --test tests/node/capability-package-site-adapter-registry-v1.test.mjs`
- `node --test tests/node/policy-pack-authoring-simulation-v1.test.mjs`
- `npm run check:syntax`
- `npm run scan:secrets`
- `git diff --check`

## Targeted Grep / Static Checks

- `rg -n "providers/|provider-registry|browser-runtime|session-vault|executeRuntimeInvocation|provider\\.run|fetch\\(|openBrowserSession|getScopedSessionMaterial|inspectSession|applyEphemeralAuthCookies|readFile\\(|writeFile\\(|createReadStream|createWriteStream|createMock|mock-providers|mock-session-vault|runtime/testing" src/app/runtime/regression-harness tests/node/runtime-ci-regression-harness-v1.test.mjs`
- `rg -n "sf_regression_cookie_secret_123|sf_regression_token_secret_456|sf_regression_raw_body_secret_789" src/app/runtime/regression-harness tests/node/runtime-ci-regression-harness-v1.test.mjs tests/node/fixtures/runtime-ci-regression-harness-v1`
- `rg -n "raw.*material|raw.*session|raw.*body|cookie|token|authorization|headers?|credential|password|storageState|localStorage|sessionStorage|IndexedDB|screenshot|video|trace|paymentCredential" src/app/runtime/regression-harness`
- `rg -n "createMock|fake|fixture|testing|raw.*material" src/app/runtime/index.mjs`
- `rg -n "PaymentProvider|DestructiveProvider|payment_provider|destructive_provider|capabilityKinds.*payment|capabilityKinds.*destructive" src/app/runtime/providers src/app/runtime/provider-registry.mjs src/app/runtime/index.mjs`

## Definition of Done

- identical snapshots pass.
- sideEffectAttempted false -> true is high severity.
- blocked -> completed is high severity.
- payment blocked -> provider invoked is critical/high.
- destructive blocked -> provider invoked is critical/high.
- auth scope widening is high severity.
- allowedOrigins widening is high severity.
- providerId changed is flagged.
- reason rename is flagged.
- policy deny -> allow is high severity.
- safe metadata change is low severity.
- malformed snapshot fails closed.
- regression report is sanitized.
- canaries do not leak.
- `GOAL_LEDGER.md` records Phase 19 checkpoint.

## Checkpoint

- Phase 19 PASS WITH NOTES.
- Modified files:
  - `src/app/runtime/regression-harness/runtime-regression-schema.mjs`
  - `src/app/runtime/regression-harness/runtime-regression-sanitizer.mjs`
  - `src/app/runtime/regression-harness/runtime-regression-severity.mjs`
  - `src/app/runtime/regression-harness/runtime-regression-compare.mjs`
  - `src/app/runtime/regression-harness/runtime-regression-report.mjs`
  - `src/app/runtime/regression-harness/runtime-regression-runner.mjs`
  - `src/app/runtime/regression-harness/runtime-regression-fixtures.mjs`
  - `src/app/runtime/regression-harness/index.mjs`
  - `src/app/runtime/index.mjs`
  - `tests/node/runtime-ci-regression-harness-v1.test.mjs`
  - `tests/node/fixtures/runtime-ci-regression-harness-v1/golden-runtime-snapshot.json`
  - `docs/codex-goals/runtime-extensibility-productization-v1/phase-19-manifest.md`
- Public APIs:
  - `RUNTIME_CI_REGRESSION_HARNESS_SCHEMA_VERSION`
  - `RUNTIME_CI_REGRESSION_SNAPSHOT_SCHEMA_VERSION`
  - `RUNTIME_CI_REGRESSION_REPORT_SCHEMA_VERSION`
  - `RUNTIME_CI_REGRESSION_SEVERITIES`
  - `listRuntimeCiRegressionSchemaDefinitions`
  - `assertNoRuntimeRegressionRawMaterial`
  - `sanitizeRuntimeRegressionSnapshot`
  - `assertRuntimeRegressionSnapshotValid`
  - `classifyRuntimeRegressionSeverity`
  - `severityRank`
  - `maxRuntimeRegressionSeverity`
  - `compareRuntimeRegressionSnapshots`
  - `runtimeRegressionSnapshotsEqual`
  - `createRuntimeRegressionReport`
  - `runRuntimeRegressionHarness`
  - `createRuntimeRegressionSnapshotFixture`
- Targeted tests:
  - `node --test tests/node/runtime-ci-regression-harness-v1.test.mjs`: PASS, 14 tests passed.
  - `node --test tests/node/runtime-audit-query-api-v1.test.mjs`: PASS, 7 tests passed.
  - `node --test tests/node/capability-graph-versioning-registry-v1.test.mjs`: PASS, 20 tests passed.
  - `node --test tests/node/capability-package-site-adapter-registry-v1.test.mjs`: PASS, 18 tests passed.
  - `node --test tests/node/policy-pack-authoring-simulation-v1.test.mjs`: PASS, 14 tests passed.
  - `npm run check:syntax`: PASS, 667 files checked.
  - `npm run scan:secrets`: PASS, 726 candidate files scanned.
  - `git diff --check`: PASS.
- Static checks:
  - provider/browser/vault/network/fs/testing helper grep over regression harness and test: PASS, no matches.
  - regression canary grep: PASS, canaries appear only in Phase 19 test injection/assertion paths.
  - raw/sensitive grep: NOTE, expected sanitizer reject-pattern matches plus `bearer_token` descriptor fixture metadata; reviewed as safe descriptor metadata, not material.
  - runtime/index mock/fake/testing/raw helper grep: PASS, no matches.
  - production payment/destructive provider grep: PASS, no matches.
- Canary non-leakage: PASS, comparisons, failed-closed reports, and regression reports do not contain regression canaries.
- Architecture boundary: PASS, regression harness does not import concrete providers, provider registry, browser runtime, session vault material APIs, mock providers, testing helpers, fs readers/writers, or network APIs.
- Runtime semantics: PASS, harness compares caller-provided sanitized snapshots only; no provider, browser, vault, network, payment, or destructive execution occurs.
- Subagent/auditor conclusions:
  - Coordinator Agent: PASS.
  - Dependency / Ordering Auditor: PASS.
  - Architecture Boundary Auditor: PASS.
  - Security / Sanitization Auditor: PASS.
  - Runtime Semantics Auditor: PASS.
  - Compiler / Capability Integrity Auditor: PASS.
  - Skill Invocation Auditor: PASS.
  - Test / CI Auditor: PASS.
  - Documentation / Report Auditor: PASS.
- Notes:
  - Non-blocking note: the V1 harness accepts in-memory sanitized snapshots; it intentionally does not read snapshot files or raw artifact content.
  - Continue: Phase 20 may begin.

## Rollback / Stop Conditions

Stop and do not enter Phase 20 if:

- regression replay can execute provider/browser/vault/network.
- raw material is accepted into snapshots or reports.
- payment/destructive blocked drift is not high/critical.
- accepted audit/query/graph/package/policy tests regress.
