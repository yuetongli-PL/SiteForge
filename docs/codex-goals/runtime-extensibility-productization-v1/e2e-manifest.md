# E2E Manifest: Compile -> Package -> Skill -> Runtime -> Audit

## Goal

Prove the Phase 11-21 productization path holds end to end: static capability extraction can feed graph/package artifacts, structured skill invocation can call runtime, runtime can complete safe reads or block high-risk actions, and sanitized evidence flows into run store, audit view, query, and regression reports.

## Allowed File Areas

- `tests/node/siteforge-runtime-productization-e2e-v1.test.mjs`
- `tests/node/fixtures/siteforge-runtime-productization-e2e-v1/`
- `docs/codex-goals/runtime-extensibility-productization-v1/`

## Forbidden File Areas

- production runtime/provider/browser/session-vault implementation changes
- production payment/destructive provider registration
- automatic login or arbitrary authenticated browsing
- accepted phase 11-21 boundary weakening
- durable raw auth/session/browser/private/payment material

## Planned Coverage

- E2E 1: public read compile -> graph -> package -> policy -> skill dryRun/execute -> production `api_read_provider` -> run store -> audit view/query -> regression snapshot.
- E2E 2: auth controlled browser write fixture -> concrete contract -> controlled browser action provider -> guarded auth material -> run store -> audit view/query.
- E2E 3: destructive capability -> package risk -> skill natural-language attempt -> runtime blocked -> audit/query.
- E2E 4: payment capability -> package payment classification -> payment plan -> policy simulation blocked -> skill/runtime blocked -> audit/query.
- E2E 5: package/risk drift -> package diff -> runtime regression harness report.

## Targeted Tests

- `node --test tests/node/siteforge-runtime-productization-e2e-v1.test.mjs`
- `node --test tests/node/skill-runtime-invocation-api-v1.test.mjs`
- `node --test tests/node/runtime-operations-run-store-v1.test.mjs`
- `node --test tests/node/runtime-ci-regression-harness-v1.test.mjs`
- `npm run check:syntax`
- `npm run scan:secrets`
- `git diff --check`

## Definition of Done

- public read completes through production `api_read_provider`.
- skill dryRun does not invoke provider/browser/vault/network.
- run store contains sanitized metadata only.
- audit viewer/query can explain completed and blocked runs.
- controlled browser write applies auth only through sanitized guarded summary.
- destructive and payment remain blocked with accepted reason codes.
- natural language does not grant destructive/payment authorization.
- package/risk drift is high or critical in diff/regression evidence.
- no E2E canary leaks.
- `GOAL_LEDGER.md` records E2E checkpoint.

## Checkpoint

- E2E PASS WITH NOTES.
- Modified files:
  - `tests/node/siteforge-runtime-productization-e2e-v1.test.mjs`
  - `tests/node/fixtures/siteforge-runtime-productization-e2e-v1/fixture-site.html`
  - `docs/codex-goals/runtime-extensibility-productization-v1/e2e-manifest.md`
- E2E coverage:
  - public read: compiler extraction -> graph -> package -> policy simulation -> skill dryRun/execute -> production `api_read_provider` -> run store -> audit view/query -> regression snapshot.
  - auth controlled browser write: fixture contract -> production `browser_action_provider` with test-only controlled browser deps -> guarded auth material -> run store -> audit view/query.
  - destructive blocked: package destructive risk -> skill natural-language attempt -> runtime blocked with `runtime.destructive_execution_blocked` -> audit/query.
  - payment blocked/planned: package payment risk -> payment plan simulation -> skill/runtime blocked with `runtime.payment_execution_blocked` -> audit/query.
  - package/risk drift: package diff plus runtime regression harness reports high/critical sanitized drift.
- Targeted tests:
  - `node --test tests/node/siteforge-runtime-productization-e2e-v1.test.mjs`: PASS, 5 tests passed.
  - `node --test tests/node/skill-runtime-invocation-api-v1.test.mjs`: PASS, 15 tests passed.
  - `node --test tests/node/runtime-operations-run-store-v1.test.mjs`: PASS, 12 tests passed.
  - `node --test tests/node/runtime-ci-regression-harness-v1.test.mjs`: PASS, 14 tests passed.
  - `npm run check:syntax`: PASS, 689 files checked.
  - `npm run scan:secrets`: PASS, 754 candidate files scanned.
  - `git diff --check`: PASS.
- Static / boundary notes:
  - E2E added test/fixture/docs only; no production runtime/provider/browser/session-vault code was changed during E2E.
  - controlled browser write uses test-only fake browser deps and mock session vault; production runtime still gates auth material behind browser guard setup.
  - run store persists sanitized report/audit summaries only; full browser trace is inspected in test but not stored as run-store payload.
  - payment/destructive remain blocked by accepted runtime reason codes and do not invoke providers.
- Canary non-leakage: PASS, E2E outputs do not contain E2E/browser/destructive/payment canaries.
- Auditor conclusions:
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
  - Non-blocking note: E2E constructs graph/package fixtures inside the test to prove cross-phase compatibility without expanding production compiler APIs.
  - Continue: final global acceptance may begin.

## Rollback / Stop Conditions

Stop final acceptance if:

- E2E requires production runtime/provider changes.
- high-risk execution succeeds by default.
- payment/destructive provider is registered in production.
- any durable output contains raw auth/session/browser/private/payment material.
- accepted Phase 11-21 tests regress.
