# Phase 22 Manifest: Independent Verification / Release Candidate Hardening

## Status

- phase: 22
- mode: verification plus boundary blocker repair after independent auditor stop condition
- status: pass_with_notes
- scope: independent release-candidate verification of Runtime Extensibility & Productization V1

## Allowed Work

- inspect current worktree state
- compare accepted phase ledger/manifests with current files and tests
- rerun accepted targeted and package test suites
- run release boundary static checks
- repair release-boundary blockers found by Phase 22 auditors before continuing
- write release verification report and phase ledger entries

## Forbidden Work

- no new runtime execution capability
- no automatic login or arbitrary authenticated browsing
- no payment execution
- no default destructive execution
- no raw auth/session/browser/private/payment/destructive material persistence
- no weakening of accepted tests, conformance checks, or canary checks

## Required Commands

- `git status --short`: PASS WITH NOTES; the checkout contains the accepted Runtime Extensibility & Productization V1 baseline plus Phase 22 docs.
- `git diff --stat`: PASS WITH NOTES; tracked diff includes the accepted baseline and the Phase 22 runtime export boundary repair.
- `git diff --name-only`: PASS WITH NOTES; tracked file list reviewed.
- `node --test tests/node/siteforge-runtime-productization-e2e-v1.test.mjs`: PASS, 5 tests passed.
- `node --test tests/node/capability-contract-conformance.test.mjs`: PASS, 8 tests passed.
- `node --test tests/node/runtime-ci-regression-harness-v1.test.mjs`: PASS, 14 tests passed.
- `node --test tests/node/skill-runtime-invocation-api-v1.test.mjs`: PASS, 15 tests passed.
- `node --test tests/node/runtime-operations-run-store-v1.test.mjs`: PASS, 12 tests passed.
- `node --test tests/node/payment-authorization-architecture-plan-v1.test.mjs`: PASS, 13 tests passed.
- `node --test tests/node/destructive-controlled-execution-v2-planning.test.mjs`: PASS, 14 tests passed.
- `node --test tests/node/payment-authorization-architecture-plan-v1.test.mjs tests/node/destructive-controlled-execution-v2-planning.test.mjs`: PASS, 27 tests passed after the export-boundary repair.
- `npm run check:syntax`: PASS, 689 files checked.
- `npm run typecheck`: PASS.
- `npm run scan:secrets`: PASS, 757 candidate files scanned.
- `npm run test:core`: PASS, 217 tests passed.
- `npm run test:capability`: PASS, 93 tests passed.
- `npm run test:pipeline`: PASS WITH OPTIONAL SKIP, 329 tests, 328 passed, 0 failed, 1 skipped optional live Tencent News smoke, duration 650176.9537ms.
- `git diff --check`: PASS.

## Static Checks

- `rg "createMock|fake|fixture|testing|raw.*material" src/app/runtime/index.mjs`: PASS, no matches.
- Runtime dynamic export probe for `/mock|fake|test|testing|fixture|raw/i`: PASS, no matches.
- compiler/planner/domain/pipeline provider implementation import boundary: PASS, no direct `providers/` imports found.
- production provider registry payment/destructive provider absence: PASS, default providers are `api_read_provider`, `download_provider`, and `browser_action_provider`; payment/destructive resolve to `null`.
- audit viewer/query/regression/run-store no-side-effect boundary: PASS, no provider/browser/vault/network execution grep matches.
- payment/destructive provider grep: PASS WITH NOTES, matches are regression-harness drift detectors for blocked-to-invoked provider regressions, not production provider registration.
- normal build/compiler/planner/domain default session/browser/raw material injection boundary: PASS WITH NOTES, broad matches are safety validators, redaction/report fields, session/domain profile modeling, and build profile safety checks; no default raw material injection was observed.

## Phase 22 Repairs

- Removed regression fixture re-export from `src/app/runtime/regression-harness/index.mjs`; fixture helpers are exposed through `src/app/runtime/testing.mjs`.
- Changed `src/app/runtime/index.mjs` to use explicit production-facing exports for provider SDK, provider sandbox, run store, skill invocation, and regression harness APIs, excluding `assertNo*RawMaterial` and fixture helpers from the public runtime facade.
- Updated tests to import `createRuntimeRegressionSnapshotFixture` from `src/app/runtime/testing.mjs`.
- Added a runtime index export assertion that no `mock`, `fake`, `test`, `testing`, `fixture`, or `raw` symbols are exposed.

## Notes

- The accepted Runtime Extensibility & Productization V1 baseline remains uncommitted in this checkout; Phase 23 is responsible for commit and PR decomposition.
- Existing accepted baseline manifests in `docs/codex-goals/runtime-extensibility-productization-v1/` include `phase-0`, `phase-11` through `phase-21`, and `e2e`; independent `phase-1` through `phase-10` manifests were not present in that directory.
- `src/app/run-build.mjs` from the plan does not exist in this repo; equivalent checks used `src/entrypoints/build/run-build.mjs` and the current pipeline/compiler/planner/domain paths.

## Checkpoint

- result: PASS WITH NOTES
- decision: Phase 22 acceptance criteria are satisfied after the runtime public export boundary repair and full rerun.
- next phase: Phase 23 may start only after the final independent Phase 22 re-audit returns PASS or PASS WITH NOTES.
