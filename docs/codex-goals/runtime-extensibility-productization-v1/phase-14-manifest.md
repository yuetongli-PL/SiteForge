# Phase 14 Manifest: Capability Package / Site Adapter Registry V1

## 阶段目标

把编译出的 capability graph 打包为 skill 可引用、runtime 可执行、policy 可治理、audit 可追踪的 site capability package，并提供安全的 package registry、ref resolver、diff 和 compatibility check。

## 允许修改的文件区域

- `src/domain/capability-packages/`
- `tests/node/capability-package-site-adapter-registry-v1.test.mjs`
- `tests/node/fixtures/capability-package-site-adapter-registry-v1/`
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
- 已 accepted 阶段 1-13 测试断言语义

## 新增 Public API

计划在 `src/domain/capability-packages/index.mjs` 暴露：

- `CAPABILITY_PACKAGE_SCHEMA_VERSION`
- `CAPABILITY_PACKAGE_REGISTRY_ENTRY_SCHEMA_VERSION`
- `CAPABILITY_PACKAGE_DIFF_SCHEMA_VERSION`
- `CAPABILITY_PACKAGE_COMPATIBILITY_SCHEMA_VERSION`
- `sanitizeCapabilityPackageManifest`
- `buildCapabilityPackageFromGraph`
- `validateCapabilityPackageManifest`
- `assertCapabilityPackageManifestValid`
- `createCapabilityPackageDigest`
- `createCapabilityPackageRegistry`
- `resolvePackageCapabilityRef`
- `resolvePackageExecutionContractRef`
- `diffCapabilityPackages`
- `assessCapabilityPackageCompatibility`
- `createCapabilityPackageProvenance`
- `exportCapabilityPackageSafeJson`
- `importCapabilityPackageSafeJson`

## 不得改变的旧语义

- package builder 不执行 provider/browser/vault/network。
- package registry 不执行网站。
- package 不携带 raw session/private/auth/browser/payment material。
- skill invocation 只引用结构化 `capabilityRef`，不把 task text 当授权。
- runtime 是否执行仍由后续 runtime gates、provider、policy、auth、sandbox、audit 决定。

## 安全边界

- package manifest 使用 allowlist construction。
- `capabilities`、`executionContracts`、`policyRequirements`、`authRequirement`、`providerCompatibility`、`riskClassification` 均为 descriptor-only。
- 禁止 raw cookie/token/authorization/session/private form/payment/browser material。
- Phase 14 tests 必须包含 canaries：
  - `sf_package_cookie_secret_123`
  - `sf_package_private_form_secret_456`
  - `sf_package_session_secret_789`

## 架构边界

- package 模块位于 domain 层，只依赖 shared/domain graph-registry helper。
- 不 import runtime provider implementation、provider registry、provider SDK、browser runtime、session vault、audit viewer/query。
- 不调用 `fetch`、`executeRuntimeInvocation`、provider `.run()`、browser/vault APIs。

## Targeted Tests

- `node --test tests/node/capability-package-site-adapter-registry-v1.test.mjs`
- `node --test tests/node/capability-graph-versioning-registry-v1.test.mjs`
- `node --test tests/node/site-capability-compiler-hardening-v2.test.mjs`
- `node --test tests/node/capability-contract-conformance.test.mjs`
- `npm run check:syntax`
- `npm run scan:secrets`

## Targeted Grep / Static Checks

- `rg -n "providers/|provider-registry|provider-sdk|browser-runtime|session-vault|executeRuntimeInvocation|provider\\.run|fetch\\(|openBrowserSession|getScopedSessionMaterial|inspectSession|applyEphemeralAuthCookies" src/domain/capability-packages tests/node/capability-package-site-adapter-registry-v1.test.mjs`
- `rg -n "sf_package_cookie_secret_123|sf_package_private_form_secret_456|sf_package_session_secret_789" src/domain/capability-packages tests/node/capability-package-site-adapter-registry-v1.test.mjs tests/node/fixtures/capability-package-site-adapter-registry-v1`
- `rg -n "raw.*material|raw.*session|raw.*body|cookie|authorization|credential|password|storageState|localStorage|sessionStorage|IndexedDB|screenshot|video|trace" src/domain/capability-packages`
- `rg -n "createMock|fake|fixture|testing|raw.*material" src/app/runtime/index.mjs`
- `rg -n "create.*Payment|PaymentProvider|payment_provider|create.*Destructive|DestructiveProvider|destructive_provider|PAYMENT_PROVIDER|DESTRUCTIVE_PROVIDER|capabilityKinds.*payment|capabilityKinds.*destructive" src/app/runtime/providers src/app/runtime/provider-registry.mjs src/app/runtime/index.mjs`
- `git diff --check`

## Definition of Done

- package can be built from a sanitized capability graph.
- package schema validation rejects malformed or raw-material manifests.
- capability and execution contract refs resolve deterministically.
- package digest is stable under metadata reorder.
- provenance includes compiler/source/graph metadata only.
- diff detects risk widening, auth scope widening, and provider compatibility change.
- package registry stores sanitized manifests only.
- package import/export safe JSON rejects raw canaries.
- tests prove no provider/vault/browser/network execution.
- `GOAL_LEDGER.md` records Phase 14 checkpoint.

## Rollback / Stop Conditions

立即停止并不进入 Phase 15，如果出现：

- package modules import runtime provider implementation/provider registry/browser runtime/session vault.
- package build/registry/diff executes provider/browser/vault/network.
- package output leaks raw private/auth/session/browser/payment material.
- package compatibility permits undefined execution contract or provider compatibility schema.
- production registry gains destructive/payment executable providers.
- accepted conformance or Phase 11-13 tests regress.

## Phase 14 Checkpoint

- status: PASS WITH NOTES
- implemented public API:
  - `CAPABILITY_PACKAGE_SCHEMA_VERSION`
  - `CAPABILITY_PACKAGE_REGISTRY_ENTRY_SCHEMA_VERSION`
  - `CAPABILITY_PACKAGE_DIFF_SCHEMA_VERSION`
  - `CAPABILITY_PACKAGE_COMPATIBILITY_SCHEMA_VERSION`
  - `SITE_ADAPTER_REGISTRY_SCHEMA_VERSION`
  - `sanitizeCapabilityPackageManifest`
  - `buildCapabilityPackageFromGraph`
  - `validateCapabilityPackageManifest`
  - `assertCapabilityPackageManifestValid`
  - `createCapabilityPackageDigest`
  - `createCapabilityPackageRegistry`
  - `resolvePackageCapabilityRef`
  - `resolvePackageExecutionContractRef`
  - `diffCapabilityPackages`
  - `assessCapabilityPackageCompatibility`
  - `createCapabilityPackageProvenance`
  - `exportCapabilityPackageSafeJson`
  - `importCapabilityPackageSafeJson`
  - `sanitizeSiteAdapterDescriptor`
  - `createSiteAdapterRegistry`
  - `resolveSiteAdapterDescriptor`
- targeted tests:
  - `node --test tests/node/capability-package-site-adapter-registry-v1.test.mjs`: PASS, 18 tests passed.
  - `node --test tests/node/capability-graph-versioning-registry-v1.test.mjs`: PASS, 20 tests passed.
  - `node --test tests/node/site-capability-compiler-hardening-v2.test.mjs`: PASS, 14 tests passed.
  - `node --test tests/node/capability-contract-conformance.test.mjs`: PASS, 8 tests passed.
  - `npm run check:syntax`: PASS, 619 files checked.
  - `npm run scan:secrets`: PASS, 669 candidate files scanned.
  - `git diff --check`: PASS.
- static checks:
  - runtime/provider/browser/vault import and execution grep: PASS, no matches.
  - package sensitive-term grep: PASS WITH NOTE; matches are sanitizer reject patterns and raw-material error codes only.
  - concrete site adapter / fs writer grep: PASS WITH NOTE; broad `resolveSiteAdapter` pattern matched this phase's `resolveSiteAdapterDescriptor` helper only, with no `src/sites/adapters` import and no filesystem write API.
  - package canary grep: PASS; canaries appear only in test inputs and are asserted absent from outputs.
  - runtime/index mock/fake/testing/raw helper grep: PASS.
  - production payment/destructive provider grep: PASS.
- canary non-leakage: PASS, package manifests, registry entries, safe JSON, resolver outputs, diff/compatibility outputs, and adapter descriptors do not contain package canaries.
- architecture boundary: PASS, package domain modules do not import runtime provider implementation, provider registry, provider SDK, browser runtime, session vault, audit viewer/query, concrete site adapters, or filesystem write APIs.
- runtime semantics: PASS, package build/registry/resolver/diff/import/export do not invoke provider, browser, vault, network, payment, or destructive execution.
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
  - Site adapter registry is descriptor-only and intentionally does not import concrete adapter resolver modules.
  - Audit/runtime/skill integration is represented as package metadata and structured refs only; executable integration remains reserved for later phases.
