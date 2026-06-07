# Phase 30 Manifest: Controlled Destructive Execution Lab V1

## Status

- phase: 30
- mode: lab-only / testing-only controlled destructive provider loop
- status: pass
- scope: testing-only provider, explicit lab runtime context, structured authorization, dry-run proof, target verification, compensation summary, audit/query/regression integration

## Outputs

- `src/app/runtime/testing-destructive-provider.mjs`
- `src/app/runtime/testing.mjs`
- `src/app/runtime/execution-runner.mjs`
- `src/app/runtime/audit-viewer/audit-view-builder.mjs`
- `src/app/runtime/regression-harness/runtime-regression-compare.mjs`
- `tests/node/controlled-destructive-execution-lab-v1.test.mjs`
- `tests/node/fixtures/controlled-destructive-execution-lab-v1/structured-authorization.json`
- `tests/node/fixtures/controlled-destructive-execution-lab-v1/dry-run-proof.json`
- `tests/node/fixtures/controlled-destructive-execution-lab-v1/target-verification.json`
- `tests/node/fixtures/controlled-destructive-execution-lab-v1/compensation-plan.json`

## Implementation

- Added `createTestingDestructiveProvider()` and `TESTING_DESTRUCTIVE_LAB_PROVIDER_ID` only through `src/app/runtime/testing.mjs`.
- Added a narrow `controlledDestructiveLab` runtime exception in `executeRuntimeInvocation()` that applies only when:
  - the selected provider is testing-only;
  - the provider is marked `destructiveLabOnly`;
  - `runtimeContext.controlledDestructiveLab === true`;
  - `runtimeContext.destructiveLab.enabled === true`.
- Kept payment blocking higher priority than destructive lab execution.
- Added lab provider checks for structured destructive authorization, policy gate, dry-run proof, verified target ref, and compensation plan.
- Rejected natural language authorization in the lab provider.
- Added sanitized lab result summary with explicit `sideEffectAttempted` semantics: lab-controlled simulated side effect only.
- Updated audit view decisions/timeline so lab destructive authorization is represented as allowed only for completed lab reports.
- Updated regression comparison so destructive blocked -> invoked remains high/critical unless the next snapshot is explicitly lab-only.

## Boundary Coverage

- production destructive still blocked: PASS.
- production registry has no destructive executable provider: PASS.
- testing-only destructive provider not exported from `runtime/index.mjs`: PASS.
- lab provider available from `runtime/testing.mjs`: PASS.
- lab execution requires structured `destructiveAuthorization`: PASS.
- lab execution rejects natural language task authorization: PASS.
- lab execution requires dry-run proof: PASS.
- lab execution requires target verification: PASS.
- lab execution records compensation summary: PASS.
- lab `sideEffectAttempted` semantics are explicit and lab-only: PASS.
- audit view explains lab destructive execution: PASS.
- audit query filters lab destructive execution: PASS.
- regression flags destructive blocked -> invoked except explicit lab mode: PASS.
- no raw confirmation/target canary leakage: PASS.
- payment remains blocked even with lab provider and lab context: PASS.

## Acceptance Commands

- `node --test tests/node/controlled-destructive-execution-lab-v1.test.mjs`: PASS, 11 tests passed.
- `node --test tests/node/destructive-controlled-execution-v2-planning.test.mjs`: PASS, 14 tests passed.
- `node --test tests/node/destructive-strong-authorization-flow-v1.test.mjs`: PASS, 6 tests passed.
- `node --test tests/node/runtime-ci-regression-harness-v1.test.mjs`: PASS, 14 tests passed.
- `node --test tests/node/capability-contract-conformance.test.mjs`: PASS, 8 tests passed.
- `npm run check:syntax`: PASS, 710 files checked.
- `npm run scan:secrets`: PASS, 815 candidate files scanned.
- `git diff --check`: PASS.

## Checkpoint

- result: PASS
- next phase: Phase 31 Payment Authorization Lab / Threat Model may start.
