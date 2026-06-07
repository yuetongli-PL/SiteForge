# Phase 18 Manifest: Skill Runtime Invocation API V1

## Goal

Add a structured Skill Runtime Invocation API that lets skills reference compiled and packaged website capabilities through safe refs. Natural language task text is non-authoritative metadata only and never grants auth, destructive, or payment authorization.

## Allowed File Areas

- `src/app/runtime/skill-invocation/`
- `src/app/runtime/index.mjs` production-facing skill invocation exports only
- `tests/node/skill-runtime-invocation-api-v1.test.mjs`
- `tests/node/fixtures/skill-runtime-invocation-api-v1/`
- `docs/codex-goals/runtime-extensibility-productization-v1/`

## Forbidden File Areas

- production provider registry payment/destructive defaults
- concrete provider implementations
- browser runtime implementation
- session vault material APIs
- accepted test assertion weakening
- runtime mock/fake/testing exports through `src/app/runtime/index.mjs`

## Planned Public API

Planned exports from `src/app/runtime/skill-invocation/index.mjs`:

- `SKILL_RUNTIME_INVOCATION_SCHEMA_VERSION`
- `SKILL_RUNTIME_INVOCATION_RESULT_SCHEMA_VERSION`
- `validateSkillRuntimeInvocationRequest`
- `assertSkillRuntimeInvocationRequestValid`
- `sanitizeSkillRuntimeInvocationRequest`
- `assertNoSkillInvocationRawMaterial`
- `createSkillRuntimeInvocationRequest`
- `createSkillRuntimeInvocationResult`
- `createSkillInvocationIdempotencyLedger`
- `resolveSkillInvocationPackageRefs`
- `createSkillRuntimeDryRunPreview`
- `convertSkillInvocationToRuntimeInvocationRequest`
- `invokeSkillRuntime`

## Semantics That Must Not Change

- skill task text does not satisfy auth, destructive, or payment authorization.
- dryRun does not execute provider, browser, vault, or network.
- execute mode must route through existing runtime gates and `executeRuntimeInvocation`.
- skill request/result durable output contains only safe refs, never raw session/auth/browser/private/payment material.
- payment remains blocked.
- destructive execution remains blocked by default.

## Security Boundary

- reject or sanitize raw cookie/token/header/body/sessionHandle/storageState/localStorage/sessionStorage/IndexedDB material.
- allow only `sessionRef` in auth descriptors.
- allow only structured `destructiveAuthorization` refs; no natural-language authorization.
- return only `runId`, `auditViewRef`, runtime report summary, and sanitized refs.

## Architecture Boundary

- skill invocation API is an app/runtime boundary module.
- may import planner `createRuntimeInvocationRequest`, existing runtime execution runner, package ref resolvers, and policy pack simulator.
- must not import concrete providers, browser runtime, session vault material APIs, mock providers, or testing helpers.

## Targeted Tests

- `node --test tests/node/skill-runtime-invocation-api-v1.test.mjs`
- `node --test tests/node/capability-package-site-adapter-registry-v1.test.mjs`
- `node --test tests/node/policy-pack-authoring-simulation-v1.test.mjs`
- `node --test tests/node/runtime-operations-run-store-v1.test.mjs`
- `node --test tests/node/runtime-execution-replay-audit-viewer-v1.test.mjs`
- `node --test tests/node/capability-contract-conformance.test.mjs`
- `npm run check:syntax`
- `npm run scan:secrets`
- `git diff --check`

## Targeted Grep / Static Checks

- `rg -n "providers/|provider-registry|browser-runtime|session-vault|getScopedSessionMaterial|inspectSession|applyEphemeralAuthCookies|openBrowserSession|createMock|mock-providers|mock-session-vault|runtime/testing" src/app/runtime/skill-invocation tests/node/skill-runtime-invocation-api-v1.test.mjs`
- `rg -n "sf_skill_task_text_secret_should_not_authorize|sf_skill_cookie_secret_123|sf_skill_token_secret_456|sf_skill_session_ref_secret_should_not_log" src/app/runtime/skill-invocation tests/node/skill-runtime-invocation-api-v1.test.mjs tests/node/fixtures/skill-runtime-invocation-api-v1`
- `rg -n "raw.*material|raw.*session|sessionHandle|cookie|token|authorization|headers?|credential|password|storageState|localStorage|sessionStorage|IndexedDB|requestBody|responseBody|paymentCredential" src/app/runtime/skill-invocation`
- `rg -n "createMock|fake|fixture|testing|raw.*material" src/app/runtime/index.mjs`
- `rg -n "PaymentProvider|DestructiveProvider|payment_provider|destructive_provider|capabilityKinds.*payment|capabilityKinds.*destructive" src/app/runtime/providers src/app/runtime/provider-registry.mjs src/app/runtime/index.mjs`

## Definition of Done

- valid dryRun returns sanitized preview and does not execute provider/browser/vault/network.
- valid execute converts to `RuntimeInvocationRequest` and routes through existing runtime runner.
- natural-language authorization text is ignored.
- raw cookie/token/header/sessionHandle input is rejected.
- missing policyDecisionRef fails unless a configured policy pack simulation provides a structured decision.
- duplicate idempotency key behavior is stable.
- destructive skill request remains blocked without structured destructive authorization and still does not default-execute.
- payment skill request remains blocked.
- result returns safe `auditViewRef` and `runId`.
- package capabilityRef and executionContractRef are resolved through capability package metadata.
- `GOAL_LEDGER.md` records Phase 18 checkpoint.

## Checkpoint

- Phase 18 PASS WITH NOTES.
- Modified files:
  - `src/app/runtime/skill-invocation/skill-runtime-invocation-schema.mjs`
  - `src/app/runtime/skill-invocation/skill-runtime-invocation-sanitizer.mjs`
  - `src/app/runtime/skill-invocation/skill-runtime-invocation-validator.mjs`
  - `src/app/runtime/skill-invocation/skill-runtime-invocation-idempotency.mjs`
  - `src/app/runtime/skill-invocation/skill-runtime-invocation-package-resolver.mjs`
  - `src/app/runtime/skill-invocation/skill-runtime-invocation-result.mjs`
  - `src/app/runtime/skill-invocation/skill-runtime-invocation-runner.mjs`
  - `src/app/runtime/skill-invocation/index.mjs`
  - `src/app/runtime/index.mjs`
  - `tests/node/skill-runtime-invocation-api-v1.test.mjs`
  - `tests/node/fixtures/skill-runtime-invocation-api-v1/skill-package.json`
  - `docs/codex-goals/runtime-extensibility-productization-v1/phase-18-manifest.md`
- Public APIs:
  - `SKILL_RUNTIME_INVOCATION_SCHEMA_VERSION`
  - `SKILL_RUNTIME_INVOCATION_RESULT_SCHEMA_VERSION`
  - `SKILL_RUNTIME_INVOCATION_PREVIEW_SCHEMA_VERSION`
  - `SKILL_RUNTIME_INVOCATION_IDEMPOTENCY_SCHEMA_VERSION`
  - `listSkillRuntimeInvocationSchemaDefinitions`
  - `assertNoSkillInvocationRawMaterial`
  - `safeSkillInvocationRef`
  - `sanitizeSkillRuntimeInvocationRequest`
  - `sanitizeSkillRuntimeInvocationSummary`
  - `validateSkillRuntimeInvocationRequest`
  - `assertSkillRuntimeInvocationRequestValid`
  - `createSkillRuntimeInvocationRequest`
  - `createSkillInvocationIdempotencyLedger`
  - `resolveSkillInvocationPackageRefs`
  - `createSkillRuntimeInvocationResult`
  - `convertSkillInvocationToRuntimeInvocationRequest`
  - `createSkillRuntimeDryRunPreview`
  - `invokeSkillRuntime`
- Targeted tests:
  - `node --test tests/node/skill-runtime-invocation-api-v1.test.mjs`: PASS, 15 tests passed.
  - `node --test tests/node/capability-package-site-adapter-registry-v1.test.mjs`: PASS, 18 tests passed.
  - `node --test tests/node/policy-pack-authoring-simulation-v1.test.mjs`: PASS, 14 tests passed.
  - `node --test tests/node/runtime-operations-run-store-v1.test.mjs`: PASS, 12 tests passed.
  - `node --test tests/node/runtime-execution-replay-audit-viewer-v1.test.mjs`: PASS, 6 tests passed.
  - `node --test tests/node/capability-contract-conformance.test.mjs`: PASS, 8 tests passed.
  - `npm run check:syntax`: PASS, 658 files checked.
  - `npm run scan:secrets`: PASS, 715 candidate files scanned.
  - `git diff --check`: PASS.
- Two-phase regression subset after Phase 17-18:
  - `node --test tests/node/runtime-operations-run-store-v1.test.mjs`: PASS, 12 tests passed.
  - `node --test tests/node/skill-runtime-invocation-api-v1.test.mjs`: PASS, 15 tests passed.
  - `node --test tests/node/runtime-execution-replay-audit-viewer-v1.test.mjs`: PASS, 6 tests passed.
  - `node --test tests/node/runtime-audit-query-api-v1.test.mjs`: PASS, 7 tests passed.
  - `npm run test:capability`: PASS, 93 tests passed.
- Static checks:
  - provider/browser/vault/testing helper import grep: NOTE, only the Phase 18 test's own `assert.doesNotMatch` guard matched; production skill invocation modules had no matches.
  - skill canary grep: PASS, canaries appear only in Phase 18 test injection/assertion paths.
  - raw/sensitive grep: NOTE, expected sanitizer reject-pattern matches plus authRequirement allowed-type descriptors (`bearer_token`, `cookie`, `custom_header`); reviewed as safe descriptor metadata, not material.
  - runtime/index mock/fake/testing/raw helper grep: PASS, no matches.
  - production payment/destructive provider grep: PASS, no matches.
- Canary non-leakage: PASS, dryRun preview, execute result, idempotency result, package resolution, and blocked destructive/payment outputs do not contain skill canaries.
- Architecture boundary: PASS, skill invocation modules do not import concrete providers, provider registry, browser runtime, session vault material APIs, mock providers, or testing helpers; execute mode calls the existing runtime runner.
- Runtime semantics: PASS, dryRun does not execute provider/browser/vault/network; execute mode routes through `executeRuntimeInvocation`; payment remains blocked; destructive execution remains blocked by default.
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
  - Non-blocking note: package `executionContractRef` values may include package-version syntax such as `@`; conversion maps them into runtime-safe `execution-contract:` refs before calling the existing runtime runner.
  - Continue: Phase 19 may begin.

## Rollback / Stop Conditions

Stop and do not enter Phase 19 if:

- task text grants auth/destructive/payment authorization.
- skill dryRun invokes provider/browser/vault/network.
- skill execute bypasses runtime gates.
- skill request/result leaks raw auth/session/browser/private/payment material.
- production registry gains payment/destructive executable providers by default.
- accepted run store, audit, package, policy, or conformance tests regress.
