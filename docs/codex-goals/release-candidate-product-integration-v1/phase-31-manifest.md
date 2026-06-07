# Phase 31 Manifest: Payment Authorization Lab / Threat Model

## Status

- phase: 31
- mode: payment threat model and lab simulation only
- status: pass
- scope: threat model, safe-ref payment lab fixtures, amount/currency/payee verification simulation, out-of-band approval simulation, production payment provider prohibition, runtime blocking, audit/query/regression/package integration, raw material canary rejection

## Outputs

- `docs/security/payment-threat-model.md`
- `src/domain/payment-authorization/payment-audit-summary.mjs`
- `src/domain/payment-authorization/payment-requirement-validator.mjs`
- `src/app/runtime/execution-runner.mjs`
- `src/app/runtime/skill-invocation/skill-runtime-invocation-sanitizer.mjs`
- `src/app/runtime/audit-query/audit-query-sanitizer.mjs`
- `src/app/runtime/audit-query/audit-query-filter.mjs`
- `src/domain/capability-packages/capability-package-validator.mjs`
- `scripts/runtime-productization-regression.mjs`
- `tests/node/payment-authorization-lab-threat-model-v1.test.mjs`
- `tests/node/fixtures/payment-authorization-lab-threat-model-v1/payment-lab-plan.json`
- `tests/node/fixtures/payment-authorization-lab-threat-model-v1/out-of-band-approval.json`
- `tests/node/fixtures/payment-authorization-lab-threat-model-v1/policy-pack-payment-input.json`
- `tests/node/ci-release-gate-integration-v1.test.mjs`
- `tests/node/skill-runtime-invocation-api-v1.test.mjs`
- `tests/node/external-skill-api-local-service-v1.test.mjs`
- `tests/node/capability-package-site-adapter-registry-v1.test.mjs`

## Implementation

- Added `docs/security/payment-threat-model.md` with explicit payment non-execution, no real provider, no real card/bank/token, no payment network request, no raw material persistence, and no natural-language authorization boundaries.
- Added payment lab fixtures for safe amount/currency/payee refs, simulated out-of-band approval, and policy-pack payment input.
- Added `payment-authorization-lab-threat-model-v1.test.mjs` covering the Phase 31 acceptance boundary end to end.
- Extended payment raw-material scanning so lab payment canaries are rejected even when placed in nominal safe-ref fields.
- Updated payment audit summary to record simulated out-of-band approval observation while keeping `grantsExecution: false`.
- Moved payment runtime blocking before provider selection, so payment/funds actions return `runtime.payment_execution_blocked` without invoking `registry.resolve()`.
- Added Skill invocation task-text redaction for payment lab canary material and asserted task text still cannot authorize payment.
- Added audit-query `providerInvoked` filtering so anomalous payment-blocked provider invocation can be found directly.
- Tightened capability package validation so payment/destructive capabilities cannot be manually marked `runtimeCallable: true`.
- Added the Phase 31 lab test to the runtime productization release-gate group.

## Boundary Coverage

- threat model document exists and states no payment execution: PASS.
- no real payment provider, payment credential, token, or payment network request is introduced: PASS.
- lab payment simulation verifies amount safe ref, ISO currency, and payee safe ref: PASS.
- missing out-of-band approval is blocked: PASS.
- natural language authorization is rejected and cannot grant execution: PASS.
- production payment provider remains absent: PASS.
- payment runtime is blocked before provider invocation: PASS.
- payment runtime is blocked before provider selection: PASS.
- payment audit summary is sanitized and records simulation without execution: PASS.
- policy-pack simulation blocks payment without provider/browser/vault/network execution: PASS.
- audit query filters payment blocked entries and provider-invoked anomalies: PASS.
- regression comparison flags payment-blocked provider invocation as critical: PASS.
- capability package classification preserves payment non-runtime-callable/non-executable defaults: PASS.
- hand-authored payment runtimeCallable drift is rejected: PASS.
- Skill task text redacts payment lab canary material: PASS.
- no raw card/bank/token canary leakage in sanitized payment outputs: PASS.

## Acceptance Commands

- `node --test tests/node/payment-authorization-lab-threat-model-v1.test.mjs`: PASS, 13 tests passed.
- `node --test tests/node/payment-authorization-architecture-plan-v1.test.mjs`: PASS, 13 tests passed.
- `node --test tests/node/policy-pack-authoring-simulation-v1.test.mjs`: PASS, 14 tests passed.
- `node --test tests/node/runtime-ci-regression-harness-v1.test.mjs`: PASS, 14 tests passed.
- `node --test tests/node/capability-contract-conformance.test.mjs`: PASS, 8 tests passed.
- `npm run check:syntax`: PASS, 711 files checked.
- `npm run scan:secrets`: PASS, 821 candidate files scanned.
- `git diff --check`: PASS.

## Additional Verification

- `node --test tests/node/app-runtime-execution-runner.test.mjs`: PASS, 12 tests passed.
- `node --test tests/node/controlled-destructive-execution-lab-v1.test.mjs tests/node/destructive-strong-authorization-flow-v1.test.mjs`: PASS, 17 tests passed.
- `node --test tests/node/skill-runtime-invocation-api-v1.test.mjs tests/node/external-skill-api-local-service-v1.test.mjs`: PASS, 26 tests passed.
- `node --test tests/node/ci-release-gate-integration-v1.test.mjs tests/node/runtime-audit-query-api-v1.test.mjs tests/node/capability-package-site-adapter-registry-v1.test.mjs`: PASS, 36 tests passed.
- `npm run test:runtime-productization`: PASS, 88 tests passed.

## Independent Review

- subagent `019ea158-8b46-7df1-b7a5-a809e8793508`: PASS WITH ACTIONABLE FINDINGS.
- Repairs completed before acceptance:
  - Phase 31 test included in runtime productization gate.
  - Skill task text redacts payment lab canary material.
  - payment runtime blocks before provider selection.
  - package validator rejects payment/destructive `runtimeCallable: true`.
  - audit query supports `providerInvoked` filtering.

## Checkpoint

- result: PASS
- next phase: final acceptance for Release Candidate & Product Integration V1 may start.
