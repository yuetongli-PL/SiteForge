# Phase 12 Manifest: Provider Plugin API / Adapter SDK V1

## 阶段目标

标准化 runtime provider 接入方式，使新 provider 必须通过明确的 manifest、interface contract、risk profile、auth declaration、side-effect declaration、sanitizer contract、registration validator 和 conformance harness 后才能进入 registry。

## 允许修改的文件区域

- `src/app/runtime/provider-sdk/`
- `src/app/runtime/provider-registry.mjs`
- `src/app/runtime/providers/index.mjs`
- `src/app/runtime/index.mjs`，仅限导出 production-facing SDK helpers
- `tests/node/provider-plugin-api-adapter-sdk-v1.test.mjs`
- `tests/node/fixtures/provider-plugin-api-adapter-sdk-v1/`
- `docs/codex-goals/runtime-extensibility-productization-v1/`

## 禁止修改的文件区域

- `src/app/runtime/testing.mjs`
- `src/app/runtime/mock-providers.mjs`
- `src/app/runtime/mock-session-vault.mjs`
- `src/app/runtime/browser-runtime/`
- `src/app/runtime/session-vault/`
- `src/app/runtime/audit-viewer/`
- `src/app/runtime/audit-query/`
- `src/entrypoints/build/run-build.mjs`
- compiler/planner/domain/pipeline provider import 边界
- production registry 默认 destructive/payment 语义
- 已 accepted 阶段 1-10 测试断言语义

## 新增 Public API

计划在 `src/app/runtime/provider-sdk/index.mjs` 暴露：

- `PROVIDER_MANIFEST_SCHEMA_VERSION`
- `PROVIDER_CONFORMANCE_REPORT_SCHEMA_VERSION`
- `validateProviderManifest(manifest, options)`
- `assertProviderManifestValid(manifest, options)`
- `validateRuntimeProviderInterface(provider, options)`
- `validateProviderRiskProfile(manifest, options)`
- `validateProviderSideEffectProfile(manifest, options)`
- `validateProviderAuthDeclaration(manifest, options)`
- `sanitizeProviderResult(result, manifest, options)`
- `sanitizeProviderError(error, options)`
- `validateProviderRegistration(provider, options)`
- `createProviderAdapter({ manifest, implementation })`
- `createProviderConformanceHarness(options)`
- `runProviderConformance(provider, options)`
- `createSafeFixtureProvider(options)`
- `ProviderSdkValidationError`

## 不得改变的旧语义

- production registry 默认只包含现有 API read、download、controlled browser action provider。
- payment/destructive provider 默认仍不注册，仍保持 blocked。
- testing provider 只能从 `runtime/testing.mjs` 暴露。
- `runtime/index.mjs` 不得导出 mock/fake/testing helper。
- provider SDK 不得给 provider 直接暴露 SessionVault、raw session material、raw browser handle、audit/report writer。
- supports()/canExecute() 必须无副作用。

## 安全边界

- provider result 必须通过 allowlist sanitizer。
- provider errors 必须 sanitized，不能回显 raw headers/body/cookie/token/env/session material。
- provider manifest/result/conformance report 不得保存：
  - raw cookie/token/header/body/session/profile/storageState
  - raw auth/session/browser/private/payment/destructive material
  - payment credential/card/bank data
  - destructive confirmation token/phrase
- Phase 12 tests 必须包含 canaries：
  - `sf_provider_cookie_secret_123`
  - `sf_provider_token_secret_456`
  - `sf_provider_env_secret_789`
  - `sf_provider_raw_body_secret_000`

## 架构边界

- SDK 可以位于 runtime 层，但不得 import testing/mock providers。
- SDK validator 不得 import provider implementation。
- production provider registry 只能注册通过 validator 的 provider。
- provider 不得绕过 runtime gates、auth adapter、sandbox、sanitizer、audit。
- provider 不得直接写 audit/report/result 文件。

## Targeted Tests

- `node --test tests/node/provider-plugin-api-adapter-sdk-v1.test.mjs`
- `node --test tests/node/capability-graph-versioning-registry-v1.test.mjs`
- `node --test tests/node/capability-contract-conformance.test.mjs`
- `node --test tests/node/auth-runtime-integration-v1.test.mjs`
- `node --test tests/node/auth-aware-controlled-browser-runtime-v1.test.mjs`
- `npm run check:syntax`
- `npm run scan:secrets`

## Targeted Grep / Static Checks

- `rg -n "mock-providers|mock-session-vault|runtime/testing|testing\\.mjs|createMock|fake" src/app/runtime/provider-sdk src/app/runtime/index.mjs`
- `rg -n "SessionVault|getScopedSessionMaterial|inspectSession|applyEphemeralAuthCookies|storageState|localStorage|sessionStorage|cookie jar|browser profile" src/app/runtime/provider-sdk tests/node/provider-plugin-api-adapter-sdk-v1.test.mjs`
- `rg -n "writeFile|appendFile|createWriteStream|audit|report" src/app/runtime/provider-sdk`
- `rg -n "create.*Payment|PaymentProvider|payment_provider|create.*Destructive|DestructiveProvider|destructive_provider|PAYMENT_PROVIDER|DESTRUCTIVE_PROVIDER|capabilityKinds.*payment|capabilityKinds.*destructive" src/app/runtime/providers src/app/runtime/provider-registry.mjs src/app/runtime/index.mjs`
- `rg -n "createMock|fake|fixture|testing|raw.*material" src/app/runtime/index.mjs`
- `rg -n "providers/" src/app/compiler src/app/planner src/domain src/app/pipeline`
- `git diff --check`

## Definition of Done

- Provider manifest schema version exists.
- Valid provider manifest is accepted.
- Missing providerId/schemaVersion is rejected.
- payment/destructive side-effect provider is rejected from production registry by default.
- supports()/canExecute() side-effect attempts are detected by conformance harness.
- provider raw headers/body/cookie/token output is sanitized or rejected.
- provider direct audit/report write capability is not exposed by SDK harness.
- browser runtime provider requires controlled runtime service.
- auth material provider cannot access SessionVault directly through SDK.
- production registry validates providers.
- `runtime/index.mjs` exports only production-facing SDK helpers, not testing providers.
- Targeted tests and static checks pass.
- `GOAL_LEDGER.md` records Phase 12 checkpoint.

## Rollback / Stop Conditions

立即停止并不进入 Phase 13，如果出现：

- provider plugin can bypass runtime gates, auth adapter, sandbox, sanitizer, or audit.
- provider SDK exposes SessionVault/raw session material/raw browser handles.
- production registry registers payment/destructive executable provider by default.
- supports()/canExecute() require vault/browser/network/files.
- provider result/error leaks canary or raw private material.
- `runtime/index.mjs` exposes mock/fake/testing helper.
- accepted Auth/Browser/Audit tests regress.

## Subagent / Auditor Plan

- 只读侦察子代理：检查现有 provider/registry/testing 模式和 drift 风险。
- 主执行线程：实现 SDK、生产 registry 验证接入、targeted tests、static checks、ledger 更新。
