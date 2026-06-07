# Phase 15 Manifest: Policy Pack Authoring / Simulation V1

## 阶段目标

把 session policy / governance policy 组织成可版本化、可测试、可模拟、可解释的 policy pack，让 capability package metadata 可在不执行 provider/browser/vault/network 的情况下得到 allow/deny 决策、稳定 reason 和解释。

## 允许修改的文件区域

- `src/domain/policies/policy-pack/`
- `tests/node/policy-pack-authoring-simulation-v1.test.mjs`
- `tests/node/fixtures/policy-pack-authoring-simulation-v1/`
- `docs/codex-goals/runtime-extensibility-productization-v1/`

## 禁止修改的文件区域

- `src/app/runtime/providers/`
- `src/app/runtime/provider-registry.mjs`
- `src/app/runtime/provider-sdk/`
- `src/app/runtime/browser-runtime/`
- `src/app/runtime/session-vault/`
- `src/app/runtime/audit-viewer/`
- `src/app/runtime/audit-query/`
- `src/app/run-build.mjs`
- production provider registry 默认 destructive/payment 语义
- 已 accepted 阶段 1-14 测试断言语义

## 新增 Public API

计划在 `src/domain/policies/policy-pack/index.mjs` 暴露：

- `POLICY_PACK_SCHEMA_VERSION`
- `POLICY_PACK_SIMULATION_SCHEMA_VERSION`
- `POLICY_PACK_DIFF_SCHEMA_VERSION`
- `validatePolicyPack`
- `assertPolicyPackValid`
- `sanitizePolicyPack`
- `sanitizePolicySimulationInput`
- `simulatePolicyPack`
- `explainPolicyDecision`
- `diffPolicyPacks`
- `createPolicyRegressionSnapshot`
- `migratePolicyPack`

## 不得改变的旧语义

- policy evaluator 不 import provider implementation。
- policy simulation 不执行 provider/browser/vault/network。
- policy input/output 不含 raw auth/session/browser/private/payment/destructive material。
- policy decision 不能把 natural language task text 当授权。
- destructive/payment 默认 deny，只能产生 planning/simulation 结果，不能执行。

## 安全边界

- simulation input 只允许 capability/package/provider/policy/session inspection metadata。
- output 只包含 `allowed`、stable `reason`、safe `decisionId`、safe `policyId`、matched rule summary、constraints 和 explanation。
- Phase 15 tests 必须包含 canaries：
  - `sf_policy_cookie_secret_123`
  - `sf_policy_token_secret_456`
  - `sf_policy_raw_body_secret_789`

## 架构边界

- 新模块位于 domain policy 层。
- 不 import `src/app/runtime/providers/*`、provider registry、provider SDK、browser runtime、session vault、audit viewer/query。
- 不调用 `fetch`、`executeRuntimeInvocation`、provider `.run()`、browser/vault APIs。

## Targeted Tests

- `node --test tests/node/policy-pack-authoring-simulation-v1.test.mjs`
- `node --test tests/node/session-policy-governance-integration-v2.test.mjs`
- `node --test tests/node/runtime-execution-replay-audit-viewer-v1.test.mjs`
- `node --test tests/node/capability-package-site-adapter-registry-v1.test.mjs`
- `node --test tests/node/capability-contract-conformance.test.mjs`
- `npm run check:syntax`
- `npm run scan:secrets`

## Targeted Grep / Static Checks

- `rg -n "providers/|provider-registry|provider-sdk|browser-runtime|session-vault|executeRuntimeInvocation|provider\\.run|fetch\\(|openBrowserSession|getScopedSessionMaterial|inspectSession|applyEphemeralAuthCookies" src/domain/policies/policy-pack tests/node/policy-pack-authoring-simulation-v1.test.mjs`
- `rg -n "sf_policy_cookie_secret_123|sf_policy_token_secret_456|sf_policy_raw_body_secret_789" src/domain/policies/policy-pack tests/node/policy-pack-authoring-simulation-v1.test.mjs tests/node/fixtures/policy-pack-authoring-simulation-v1`
- `rg -n "raw.*material|raw.*session|raw.*body|cookie|authorization|credential|password|storageState|localStorage|sessionStorage|IndexedDB|screenshot|video|trace|paymentCredential|confirmationToken|naturalLanguage.*author" src/domain/policies/policy-pack`
- `rg -n "createMock|fake|fixture|testing|raw.*material" src/app/runtime/index.mjs`
- `rg -n "PaymentProvider|DestructiveProvider|payment_provider|destructive_provider|capabilityKinds.*payment|capabilityKinds.*destructive" src/app/runtime/providers src/app/runtime/provider-registry.mjs src/app/runtime/index.mjs`
- `git diff --check`

## Definition of Done

- valid policy pack accepted.
- invalid policy pack rejected with sanitized errors.
- simulation allows auth read and controlled browser write when metadata matches rules.
- simulation denies destructive and payment by default.
- diff detects scope widening and deny-to-allow effect change.
- simulator proves no provider/vault/browser/network execution.
- policy evaluator has no provider implementation import.
- audit/query can consume policy decision summaries without executing.
- policy input/output rejects canaries and raw material.
- `GOAL_LEDGER.md` records Phase 15 checkpoint.

## Rollback / Stop Conditions

立即停止并不进入 Phase 16，如果出现：

- policy pack evaluator imports provider implementation/provider registry/browser runtime/session vault.
- policy simulation executes provider/browser/vault/network.
- policy input/output leaks raw private/auth/session/browser/payment material.
- natural language task text can satisfy auth/destructive/payment authorization.
- destructive/payment simulation becomes execution.
- accepted conformance or Phase 11-14 tests regress.

## Phase 15 Checkpoint

- status: PASS WITH NOTES
- implemented public API:
  - `POLICY_PACK_SCHEMA_VERSION`
  - `POLICY_PACK_SIMULATION_SCHEMA_VERSION`
  - `POLICY_PACK_DECISION_SCHEMA_VERSION`
  - `POLICY_PACK_DIFF_SCHEMA_VERSION`
  - `POLICY_PACK_REGRESSION_SCHEMA_VERSION`
  - `validatePolicyPack`
  - `assertPolicyPackValid`
  - `sanitizePolicyPack`
  - `sanitizePolicySimulationInput`
  - `assertNoPolicyPackRawMaterial`
  - `simulatePolicyPack`
  - `explainPolicyDecision`
  - `diffPolicyPacks`
  - `createPolicyRegressionSnapshot`
  - `migratePolicyPack`
  - `listPolicyPackSchemaDefinitions`
- targeted tests:
  - `node --test tests/node/policy-pack-authoring-simulation-v1.test.mjs`: PASS, 14 tests passed.
  - `node --test tests/node/session-policy-governance-integration-v2.test.mjs`: PASS, 6 tests passed.
  - `node --test tests/node/runtime-execution-replay-audit-viewer-v1.test.mjs`: PASS, 6 tests passed.
  - `node --test tests/node/capability-package-site-adapter-registry-v1.test.mjs`: PASS, 18 tests passed.
  - `node --test tests/node/capability-contract-conformance.test.mjs`: PASS, 8 tests passed.
  - `npm run check:syntax`: PASS, 628 files checked.
  - `npm run scan:secrets`: PASS, 680 candidate files scanned.
  - `git diff --check`: PASS.
- two-phase regression subset after Phase 14-15:
  - `node --test tests/node/runtime-audit-query-api-v1.test.mjs`: PASS, 7 tests passed.
  - `node --test tests/node/destructive-strong-authorization-flow-v1.test.mjs`: PASS, 6 tests passed.
  - `node --test tests/node/controlled-browser-runtime-v2.test.mjs`: PASS, 14 tests passed.
  - `node --test tests/node/auth-runtime-integration-v1.test.mjs`: PASS, 13 tests passed.
  - `node --test tests/node/auth-aware-controlled-browser-runtime-v1.test.mjs`: PASS, 9 tests passed.
  - `node --test tests/node/session-vault-productionization-v2.test.mjs`: PASS, 7 tests passed.
- static checks:
  - policy pack runtime/provider/browser/vault import and execution grep: PASS WITH NOTE; matches are test guard assertions only.
  - policy canary grep: PASS; canaries appear only in test inputs and are asserted absent from outputs.
  - policy sensitive-term grep: PASS WITH NOTE; matches are sanitizer reject patterns and raw-material error codes only.
  - runtime/index mock/fake/testing/raw helper grep: PASS.
  - production payment/destructive provider grep: PASS.
- canary non-leakage: PASS, policy pack validation reports, simulation inputs/outputs, decision explanation, query/audit summaries, and regression snapshots do not contain policy canaries.
- architecture boundary: PASS, policy pack modules do not import provider implementation, provider registry, provider SDK, browser runtime, session vault, audit viewer/query, or runtime execution APIs.
- runtime semantics: PASS, policy simulation does not invoke provider, browser, vault, network, payment, or destructive execution; destructive/payment remain denied by default.
- subagent/auditor conclusions:
  - Coordinator Agent: PASS.
  - Dependency / Ordering Auditor: PASS.
  - Architecture Boundary Auditor: PASS.
  - Security / Sanitization Auditor: PASS.
  - Runtime Semantics Auditor: PASS.
  - Compiler / Capability Integrity Auditor: PASS.
  - Skill Invocation Auditor: PASS.
  - Test / CI Auditor: PASS.
  - Documentation / Report Auditor: PASS.
- notes:
  - Policy pack simulation represents audit/query integration as sanitized decision summaries only; no audit/query runtime module was modified.
