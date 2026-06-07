# Phase 13 Manifest: Site Capability Compiler Hardening / Contract Extraction V2

## 阶段目标

增强 compiler 对任意网站能力的结构化静态提取能力，提高 capability graph / execution contract 的质量，同时保持 compiler 不执行 provider、不启动 browser、不访问 vault、不做 live network、不猜 selector 用于执行。

## 允许修改的文件区域

- `src/app/compiler/`
- `src/domain/capabilities/`
- `tests/node/site-capability-compiler-hardening-v2.test.mjs`
- `tests/node/fixtures/site-capability-compiler-hardening-v2/`
- `docs/codex-goals/runtime-extensibility-productization-v1/`

## 禁止修改的文件区域

- `src/app/runtime/providers/`
- `src/app/runtime/provider-registry.mjs`
- `src/app/runtime/provider-sdk/`
- `src/app/runtime/browser-runtime/`
- `src/app/runtime/session-vault/`
- `src/app/runtime/audit-viewer/`
- `src/app/runtime/audit-query/`
- `src/entrypoints/build/run-build.mjs`
- production provider registry 默认 destructive/payment 语义
- 已 accepted 阶段 1-12 测试断言语义

## 新增 Public API

计划在 `src/app/compiler/contract-extraction-v2.mjs` 暴露：

- `COMPILER_CONTRACT_EXTRACTION_V2_SCHEMA_VERSION`
- `extractStaticCapabilityContractsV2(source, options)`
- `extractFormActionContractsV2(source, options)`
- `extractDownloadExportHintsV2(source, options)`
- `extractApiEndpointHintsV2(source, options)`
- `extractAuthRequirementHintsV2(source, options)`
- `extractRiskHintsV2(source, options)`
- `scoreSelectorStability(selector, options)`
- `scoreContractConcreteness(contract, options)`
- `sanitizeCompilerExtractionOutput(output, options)`

计划从 `src/app/compiler/index.mjs` 导出上述 production-facing compiler helper。

## 不得改变的旧语义

- compiler 不 import runtime provider implementation。
- compiler 不执行 provider/browser/network。
- compiler 不提交表单、不点击、不登录、不收集 credentials。
- low confidence capability 只能进入 compile artifact，不能直接变成 executable contract。
- auth hints 只是 hints，不等于 authorization。
- risk hints 只是 classifier input，不等于 policy decision。
- execution contract concrete enough 仍由 runtime/conformance gate 判断。

## 安全边界

- extraction output 必须使用 allowlist construction。
- 不得保存 raw form value、raw credential、raw cookie/token/session/header/body、raw DOM、screenshot/video/trace。
- Phase 13 tests 必须包含 canaries：
  - `sf_compiler_private_form_secret_123`
  - `sf_compiler_cookie_secret_456`
  - `sf_compiler_login_secret_789`

## 架构边界

- 新 helper 位于 compiler 层，只做静态解析和 descriptor 输出。
- 不 import `src/app/runtime/providers/*`、provider registry、provider SDK、browser runtime、session vault、audit writer。
- 不调用 `fetch`、`executeRuntimeInvocation`、provider `.run()`、browser/vault APIs。

## Targeted Tests

- `node --test tests/node/site-capability-compiler-hardening-v2.test.mjs`
- `node --test tests/node/capability-graph-versioning-registry-v1.test.mjs`
- `node --test tests/node/capability-contract-conformance.test.mjs`
- `npm run check:syntax`
- `npm run scan:secrets`

## Targeted Grep / Static Checks

- `rg -n "providers/|provider-registry|provider-sdk|browser-runtime|session-vault|executeRuntimeInvocation|provider\\.run|fetch\\(|openBrowserSession" src/app/compiler/contract-extraction-v2.mjs tests/node/site-capability-compiler-hardening-v2.test.mjs`
- `rg -n "sf_compiler_private_form_secret_123|sf_compiler_cookie_secret_456|sf_compiler_login_secret_789" src/app/compiler tests/node/site-capability-compiler-hardening-v2.test.mjs tests/node/fixtures/site-capability-compiler-hardening-v2`
- `rg -n "raw.*value|raw.*dom|cookie|authorization|password|credential|storageState|localStorage|sessionStorage|IndexedDB" src/app/compiler/contract-extraction-v2.mjs`
- `rg -n "providers/" src/app/compiler src/app/planner src/domain src/app/pipeline`
- `git diff --check`

## Definition of Done

- Static form extraction produces slot schema.
- Submit/action extraction produces `form_or_action` capability descriptor.
- Download/export links are detected.
- API endpoint hints are detected without executing endpoints.
- Auth-required hints are detected without collecting credentials.
- destructive/payment hints are classified.
- selector stability, completion signal confidence, contract concreteness, and capability confidence are produced.
- missing completion signal lowers concreteness.
- low-confidence contracts are not executable by default.
- Compiler output does not leak canaries or raw private fixture values.
- Targeted tests and static checks pass.
- `GOAL_LEDGER.md` records Phase 13 checkpoint.

## Rollback / Stop Conditions

立即停止并不进入 Phase 14，如果出现：

- compiler imports provider implementation/runtime provider registry/browser runtime/session vault.
- compiler executes browser/provider/network/vault.
- extraction output leaks raw private/auth/session/browser material.
- low-confidence extraction becomes executable by default.
- auth hints become authorization or risk hints become policy decision.
- accepted conformance tests regress.

## Subagent / Auditor Plan

- 只读侦察子代理：检查现有 compiler extraction 模式、fields 和测试边界。
- 主执行线程：实现静态 extraction V2 helper、fixtures、tests、static checks、ledger 更新。

## Phase 13 Checkpoint

- status: PASS WITH NOTES
- implemented public API:
  - `COMPILER_CONTRACT_EXTRACTION_V2_SCHEMA_VERSION`
  - `extractStaticCapabilityContractsV2`
  - `extractFormActionContractsV2`
  - `extractDownloadExportHintsV2`
  - `extractApiEndpointHintsV2`
  - `extractAuthRequirementHintsV2`
  - `extractRiskHintsV2`
  - `scoreSelectorStability`
  - `scoreContractConcreteness`
  - `sanitizeCompilerExtractionOutput`
- targeted tests:
  - `node --test tests/node/site-capability-compiler-hardening-v2.test.mjs`: PASS, 14 tests passed.
  - `node --test tests/node/site-capability-compiler-executor/*.test.mjs`: PASS, 59 tests passed.
  - `node --test tests/node/capability-graph-versioning-registry-v1.test.mjs`: PASS, 20 tests passed.
  - `node --test tests/node/capability-contract-conformance.test.mjs`: PASS, 8 tests passed.
  - `npm run check:syntax`: PASS, 607 files checked.
  - `npm run scan:secrets`: PASS, 655 candidate files scanned.
  - `git diff --check`: PASS.
- static checks:
  - compiler runtime/provider/browser/vault import and execution grep: PASS WITH NOTE; matches are test guard assertions only.
  - canary grep: PASS; compiler canaries appear only in test/fixture inputs and are asserted absent from outputs.
  - runtime/index mock/fake/testing/raw helper grep: PASS.
  - production payment/destructive provider grep: PASS.
  - compiler/planner/domain/pipeline provider implementation import grep: PASS.
- notes:
  - V2 extraction is exposed as a compiler public API and remains independent from the existing config-backed static inventory input contract.
  - Broad sensitive-term grep has expected matches in sanitizer regex and classifier terms only.
