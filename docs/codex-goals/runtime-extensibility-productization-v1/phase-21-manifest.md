# Phase 21 Manifest: Payment Authorization Architecture Plan

## Goal

Create payment authorization planning artifacts without implementing production payment execution. Runtime payment behavior remains `runtime.payment_execution_blocked`.

## Allowed File Areas

- `src/domain/payment-authorization/`
- `tests/node/payment-authorization-architecture-plan-v1.test.mjs`
- `tests/node/fixtures/payment-authorization-architecture-plan-v1/`
- `docs/codex-goals/runtime-extensibility-productization-v1/`

## Forbidden File Areas

- payment execution
- production payment provider registration
- payment credential/card/bank material persistence
- natural-language-only payment authorization
- payment network calls
- accepted payment/destructive/runtime/audit/query/package/policy test weakening

## Planned Public API

Planned exports from `src/domain/payment-authorization/index.mjs`:

- `PAYMENT_AUTHORIZATION_PLAN_SCHEMA_VERSION`
- `PAYMENT_POLICY_SIMULATION_SCHEMA_VERSION`
- `PAYMENT_CAPABILITY_CLASSES`
- `sanitizePaymentAuthorizationPlan`
- `validatePaymentAuthorizationPlan`
- `assertPaymentAuthorizationPlanValid`
- `assertNoPaymentAuthorizationRawMaterial`
- `classifyPaymentCapability`
- `createPaymentAuthorizationRequirements`
- `createPaymentPartyVerificationPlan`
- `simulatePaymentPolicy`
- `createPaymentAuditPlanningSummary`
- `assertProductionPaymentProviderProhibited`

## Semantics That Must Not Change

- planning artifacts explain payment requirements only.
- production execution default is blocked.
- runtime payment remains `runtime.payment_execution_blocked`.
- natural language task text never authorizes payment.
- raw payment credentials, card, bank, account, token, or phrase material are rejected and never persisted.
- production provider registry has no payment executable provider.
- no provider/browser/vault/network execution occurs.

## Security Boundary

- reject raw payment credential/card/bank/account/token/authorization phrase material.
- amount, currency, payee, approval, and authorization inputs must be safe refs or sanitized metadata.
- audit summary includes only sanitized planning status and missing requirements.

## Architecture Boundary

- payment authorization planning lives in `src/domain/payment-authorization/`.
- may be consumed by tests with audit viewer/query/package/skill APIs through sanitized summaries and classifications.
- must not import runtime provider implementations, provider registry, browser runtime, session vault, or execute runtime paths.

## Targeted Tests

- `node --test tests/node/payment-authorization-architecture-plan-v1.test.mjs`
- `node --test tests/node/destructive-controlled-execution-v2-planning.test.mjs`
- `node --test tests/node/capability-package-site-adapter-registry-v1.test.mjs`
- `node --test tests/node/policy-pack-authoring-simulation-v1.test.mjs`
- `node --test tests/node/capability-contract-conformance.test.mjs`
- `npm run check:syntax`
- `npm run scan:secrets`
- `git diff --check`

## Targeted Grep / Static Checks

- `rg -n "src/app/runtime|providers/|provider-registry|browser-runtime|session-vault|executeRuntimeInvocation|provider\\.run|fetch\\(|openBrowserSession|getScopedSessionMaterial|inspectSession|applyEphemeralAuthCookies|createProductionRuntimeProviderRegistry|createRuntimeProviderRegistryWith" src/domain/payment-authorization tests/node/payment-authorization-architecture-plan-v1.test.mjs`
- `rg -n "sf_payment_card_secret_123|sf_payment_bank_secret_456|sf_payment_token_secret_789|sf_payment_authorization_phrase_secret_000" src/domain/payment-authorization tests/node/payment-authorization-architecture-plan-v1.test.mjs tests/node/fixtures/payment-authorization-architecture-plan-v1`
- `rg -n "raw.*payment|paymentCredential|card|bank|account|token|authorizationPhrase|cookie|authorization|headers?|credential|password|secret" src/domain/payment-authorization`
- `rg -n "createMock|fake|fixture|testing|raw.*material" src/app/runtime/index.mjs`
- `rg -n "PaymentProvider|payment_provider|capabilityKinds.*payment" src/app/runtime/providers src/app/runtime/provider-registry.mjs src/app/runtime/index.mjs`

## Definition of Done

- valid payment authorization plan accepted.
- missing amount/currency/payee flagged.
- natural language authorization rejected.
- missing out-of-band approval flagged.
- payment capability classified.
- policy simulation returns blocked by default.
- runtime payment remains `runtime.payment_execution_blocked`.
- production registry has no payment executable provider.
- audit viewer displays payment planning summary safely.
- query filters payment blocked/planned entries.
- capability package records payment classification.
- skill invocation cannot authorize payment through task text.
- no raw payment credential leakage.
- `GOAL_LEDGER.md` records Phase 21 checkpoint.

## Checkpoint

- Phase 21 PASS WITH NOTES.
- Modified files:
  - `src/domain/payment-authorization/payment-authorization-schema.mjs`
  - `src/domain/payment-authorization/payment-requirement-validator.mjs`
  - `src/domain/payment-authorization/payment-capability-classifier.mjs`
  - `src/domain/payment-authorization/payment-authorization-requirements.mjs`
  - `src/domain/payment-authorization/payment-party-verification-plan.mjs`
  - `src/domain/payment-authorization/payment-policy-simulator.mjs`
  - `src/domain/payment-authorization/payment-audit-summary.mjs`
  - `src/domain/payment-authorization/payment-provider-prohibition.mjs`
  - `src/domain/payment-authorization/index.mjs`
  - `tests/node/payment-authorization-architecture-plan-v1.test.mjs`
  - `tests/node/fixtures/payment-authorization-architecture-plan-v1/safe-payment-plan.json`
  - `docs/codex-goals/runtime-extensibility-productization-v1/phase-21-manifest.md`
- Public APIs:
  - `PAYMENT_AUTHORIZATION_PLAN_SCHEMA_VERSION`
  - `PAYMENT_POLICY_SIMULATION_SCHEMA_VERSION`
  - `PAYMENT_AUDIT_PLANNING_SUMMARY_SCHEMA_VERSION`
  - `PAYMENT_CAPABILITY_CLASSES`
  - `PAYMENT_PRODUCTION_EXECUTION_DEFAULT`
  - `listPaymentAuthorizationSchemaDefinitions`
  - `assertNoPaymentAuthorizationRawMaterial`
  - `sanitizePaymentAuthorizationPlan`
  - `validatePaymentAuthorizationPlan`
  - `assertPaymentAuthorizationPlanValid`
  - `classifyPaymentCapability`
  - `createPaymentAuthorizationRequirements`
  - `createPaymentPartyVerificationPlan`
  - `simulatePaymentPolicy`
  - `createPaymentAuditPlanningSummary`
  - `assertProductionPaymentProviderProhibited`
- Targeted tests:
  - `node --test tests/node/payment-authorization-architecture-plan-v1.test.mjs`: PASS, 13 tests passed.
  - `node --test tests/node/destructive-controlled-execution-v2-planning.test.mjs`: PASS, 14 tests passed.
  - `node --test tests/node/capability-package-site-adapter-registry-v1.test.mjs`: PASS, 18 tests passed.
  - `node --test tests/node/policy-pack-authoring-simulation-v1.test.mjs`: PASS, 14 tests passed.
  - `node --test tests/node/capability-contract-conformance.test.mjs`: PASS, 8 tests passed.
  - `npm run check:syntax`: PASS, 688 files checked.
  - `npm run scan:secrets`: PASS, 751 candidate files scanned.
  - `git diff --check`: PASS.
- Phase 19-21 regression subset:
  - `node --test tests/node/runtime-ci-regression-harness-v1.test.mjs`: PASS, 14 tests passed.
  - `node --test tests/node/destructive-controlled-execution-v2-planning.test.mjs`: PASS, 14 tests passed.
  - `node --test tests/node/payment-authorization-architecture-plan-v1.test.mjs`: PASS, 13 tests passed.
  - `node --test tests/node/capability-contract-conformance.test.mjs`: PASS, 8 tests passed.
  - `npm run test:capability`: PASS, 93 tests passed.
- Static checks:
  - runtime/provider/browser/vault/network grep: NOTE, matches are test-only assertions that runtime payment remains blocked and production registry has no payment provider.
  - payment canary grep: PASS, canaries appear only in Phase 21 test injection/assertion paths.
  - raw/sensitive grep: NOTE, expected schema path names, safe authorization ref descriptors, and validator reject-pattern matches only; no raw payment credential, card, bank, account, token, or phrase material is persisted.
  - runtime/index mock/fake/testing/raw helper grep: PASS, no matches.
  - production payment provider grep: PASS, no matches.
- Canary non-leakage: PASS, plan validation, classification, simulation, audit planning summary, audit view, query results, package classification, and skill invocation outputs do not contain payment canaries.
- Architecture boundary: PASS, payment authorization modules do not import runtime provider implementations, provider registry, browser runtime, session vault, network APIs, or execution paths.
- Runtime semantics: PASS, payment planning artifacts explain requirements only; runtime payment remains blocked by default; skill task text and out-of-band approval observation do not grant execution.
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
  - Non-blocking note: Phase 21 is architecture planning only. It intentionally does not add production payment execution, provider registration, credential handling, or payment network calls.
  - Continue: E2E may begin.

## Rollback / Stop Conditions

Stop and do not enter E2E if:

- payment planning becomes payment execution.
- production registry includes payment executable provider by default.
- natural language text grants payment authorization.
- raw payment credentials, card, bank, account, token, or phrase material leaks into output.
- accepted payment/destructive/runtime/audit/query/package/policy tests regress.
