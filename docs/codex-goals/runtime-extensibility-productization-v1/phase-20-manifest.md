# Phase 20 Manifest: Destructive Controlled Execution V2 Planning

## Goal

Create planning artifacts for future destructive controlled execution without implementing production destructive execution. The default runtime behavior remains `runtime.destructive_execution_blocked`.

## Allowed File Areas

- `src/domain/destructive-planning/`
- `tests/node/destructive-controlled-execution-v2-planning.test.mjs`
- `tests/node/fixtures/destructive-controlled-execution-v2-planning/`
- `docs/codex-goals/runtime-extensibility-productization-v1/`

## Forbidden File Areas

- production destructive execution
- production destructive provider registration
- runtime provider registry destructive defaults
- destructive confirmation token/phrase persistence
- natural-language-only authorization
- accepted destructive/runtime/audit/query/policy test weakening

## Planned Public API

Planned exports from `src/domain/destructive-planning/index.mjs`:

- `DESTRUCTIVE_EXECUTION_PLAN_SCHEMA_VERSION`
- `DESTRUCTIVE_PLANNING_SIMULATION_SCHEMA_VERSION`
- `DESTRUCTIVE_ACTION_CLASSES`
- `sanitizeDestructiveExecutionPlan`
- `validateDestructiveExecutionPlan`
- `assertDestructiveExecutionPlanValid`
- `assertNoDestructivePlanningRawMaterial`
- `createDestructiveProviderRequirements`
- `createDestructiveAuthorizationLifecycle`
- `verifyDestructiveTargetRef`
- `createDestructiveDryRunProof`
- `createDestructiveCompensationPlan`
- `simulateDestructiveExecutionPlan`
- `createDestructivePlanningAuditSummary`

## Semantics That Must Not Change

- planning artifacts explain requirements only.
- production execution default is blocked.
- natural language task text never authorizes destructive execution.
- `--confirm-destructive` alone does not execute.
- raw confirmation tokens or phrases are rejected and never persisted.
- no provider/browser/vault/network execution occurs.

## Security Boundary

- reject raw confirmation token/phrase, raw target material, cookie/token/header/body, and private target values.
- targetRef, authorization refs, dry-run proof refs, and compensation refs must be safe refs.
- audit summary includes only sanitized planning status and missing requirements.

## Architecture Boundary

- destructive planning lives in `src/domain/destructive-planning/`.
- may integrate by producing sanitized summaries consumable by audit viewer/query/policy simulation tests.
- must not import runtime provider implementations, provider registry, browser runtime, session vault, or execute runtime paths.

## Targeted Tests

- `node --test tests/node/destructive-controlled-execution-v2-planning.test.mjs`
- `node --test tests/node/destructive-strong-authorization-flow-v1.test.mjs`
- `node --test tests/node/policy-pack-authoring-simulation-v1.test.mjs`
- `node --test tests/node/runtime-audit-query-api-v1.test.mjs`
- `node --test tests/node/capability-contract-conformance.test.mjs`
- `npm run check:syntax`
- `npm run scan:secrets`
- `git diff --check`

## Targeted Grep / Static Checks

- `rg -n "src/app/runtime|providers/|provider-registry|browser-runtime|session-vault|executeRuntimeInvocation|provider\\.run|fetch\\(|openBrowserSession|getScopedSessionMaterial|inspectSession|applyEphemeralAuthCookies|createProductionRuntimeProviderRegistry|createRuntimeProviderRegistryWith" src/domain/destructive-planning tests/node/destructive-controlled-execution-v2-planning.test.mjs`
- `rg -n "sf_destructive_plan_confirmation_secret_123|sf_destructive_target_private_secret_456" src/domain/destructive-planning tests/node/destructive-controlled-execution-v2-planning.test.mjs tests/node/fixtures/destructive-controlled-execution-v2-planning`
- `rg -n "raw.*confirmation|confirmationToken|confirmationPhrase|raw.*target|cookie|token|authorization|headers?|credential|password|secret|paymentCredential" src/domain/destructive-planning`
- `rg -n "createMock|fake|fixture|testing|raw.*material" src/app/runtime/index.mjs`
- `rg -n "PaymentProvider|DestructiveProvider|payment_provider|destructive_provider|capabilityKinds.*payment|capabilityKinds.*destructive" src/app/runtime/providers src/app/runtime/provider-registry.mjs src/app/runtime/index.mjs`

## Definition of Done

- valid destructive execution plan accepted.
- plan without strong authorization rejected.
- plan allowing natural language authorization rejected.
- plan without targetRef rejected.
- plan without dry-run proof flagged.
- plan without compensation model flagged.
- simulation produces blocked-by-default decision.
- runtime destructive remains blocked.
- production registry has no destructive provider.
- confirm-destructive alone remains blocked.
- audit viewer displays planning summary safely.
- query filters destructive planning entries.
- skill task text cannot authorize destructive.
- no raw confirmation token/phrase leakage.
- `GOAL_LEDGER.md` records Phase 20 checkpoint.

## Checkpoint

- Phase 20 PASS WITH NOTES.
- Modified files:
  - `src/domain/destructive-planning/destructive-execution-plan-schema.mjs`
  - `src/domain/destructive-planning/destructive-execution-plan-validator.mjs`
  - `src/domain/destructive-planning/destructive-provider-requirements.mjs`
  - `src/domain/destructive-planning/destructive-authorization-lifecycle.mjs`
  - `src/domain/destructive-planning/destructive-target-verification.mjs`
  - `src/domain/destructive-planning/destructive-dry-run-proof.mjs`
  - `src/domain/destructive-planning/destructive-compensation-plan.mjs`
  - `src/domain/destructive-planning/destructive-planning-simulator.mjs`
  - `src/domain/destructive-planning/destructive-planning-audit-summary.mjs`
  - `src/domain/destructive-planning/index.mjs`
  - `tests/node/destructive-controlled-execution-v2-planning.test.mjs`
  - `tests/node/fixtures/destructive-controlled-execution-v2-planning/safe-destructive-plan.json`
  - `docs/codex-goals/runtime-extensibility-productization-v1/phase-20-manifest.md`
- Public APIs:
  - `DESTRUCTIVE_EXECUTION_PLAN_SCHEMA_VERSION`
  - `DESTRUCTIVE_PLANNING_SIMULATION_SCHEMA_VERSION`
  - `DESTRUCTIVE_ACTION_CLASSES`
  - `sanitizeDestructiveExecutionPlan`
  - `validateDestructiveExecutionPlan`
  - `assertDestructiveExecutionPlanValid`
  - `assertNoDestructivePlanningRawMaterial`
  - `createDestructiveProviderRequirements`
  - `createDestructiveAuthorizationLifecycle`
  - `verifyDestructiveTargetRef`
  - `createDestructiveDryRunProof`
  - `createDestructiveCompensationPlan`
  - `simulateDestructiveExecutionPlan`
  - `createDestructivePlanningAuditSummary`
- Targeted tests:
  - `node --test tests/node/destructive-controlled-execution-v2-planning.test.mjs`: PASS, 14 tests passed.
  - `node --test tests/node/destructive-strong-authorization-flow-v1.test.mjs`: PASS, 6 tests passed.
  - `node --test tests/node/policy-pack-authoring-simulation-v1.test.mjs`: PASS, 14 tests passed.
  - `node --test tests/node/runtime-audit-query-api-v1.test.mjs`: PASS, 7 tests passed.
  - `node --test tests/node/capability-contract-conformance.test.mjs`: PASS, 8 tests passed.
  - `npm run check:syntax`: PASS, 678 files checked.
  - `npm run scan:secrets`: PASS, 739 candidate files scanned.
  - `git diff --check`: PASS.
- Static checks:
  - runtime/provider/browser/vault/network grep: NOTE, matches are test-only assertions that production runtime still blocks destructive execution and production registry has no destructive provider.
  - destructive canary grep: PASS, canaries appear only in Phase 20 test injection/assertion paths.
  - raw/sensitive grep: NOTE, expected validator reject-pattern matches and structured authorization lifecycle names only; no raw confirmation, target, token, phrase, or payment material is persisted.
  - runtime/index mock/fake/testing/raw helper grep: PASS, no matches.
  - production payment/destructive provider grep: PASS, no matches.
- Canary non-leakage: PASS, plan validation, simulation, audit view, query results, and runtime blocked reports do not contain destructive canaries.
- Architecture boundary: PASS, destructive planning modules do not import runtime provider implementations, provider registry, browser runtime, session vault, network APIs, or execution paths.
- Runtime semantics: PASS, planning artifacts explain requirements only; runtime destructive execution remains blocked by default; `--confirm-destructive` and task text do not grant authorization.
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
  - Non-blocking note: Phase 20 is planning-only. It intentionally does not add production destructive execution, provider registration, or live side effects.
  - Continue: Phase 21 may begin.

## Rollback / Stop Conditions

Stop and do not enter Phase 21 if:

- destructive planning becomes destructive execution.
- production registry includes destructive executable provider by default.
- natural language text or confirm flag alone grants authorization.
- raw confirmation or target secrets leak into output.
- accepted destructive/runtime/audit/query/policy tests regress.
