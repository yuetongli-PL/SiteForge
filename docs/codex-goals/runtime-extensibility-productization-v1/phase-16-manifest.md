# Phase 16 Manifest: Runtime Worker Isolation / Provider Sandbox V1

## 阶段目标

建立 provider sandbox 边界，提供 provider worker protocol、sandbox envelope、restricted runtime services、timeout/cleanup、sanitized result/error channel，并明确 V1 不是 OS-level sandbox。

## 允许修改的文件区域

- `src/app/runtime/provider-sandbox/`
- `src/app/runtime/index.mjs` production-facing sandbox helper exports only
- `tests/node/runtime-worker-isolation-provider-sandbox-v1.test.mjs`
- `tests/node/fixtures/runtime-worker-isolation-provider-sandbox-v1/`
- `docs/codex-goals/runtime-extensibility-productization-v1/`

## 禁止修改的文件区域

- `src/app/runtime/providers/`
- production provider registry 默认 destructive/payment 语义
- `src/app/runtime/browser-runtime/`
- `src/app/runtime/session-vault/`
- `src/app/runtime/audit-viewer/`
- `src/app/runtime/audit-query/`
- `src/app/run-build.mjs`
- accepted tests assertion weakening

## 新增 Public API

计划在 `src/app/runtime/provider-sandbox/index.mjs` 暴露：

- `PROVIDER_SANDBOX_PROTOCOL_SCHEMA_VERSION`
- `PROVIDER_SANDBOX_RESULT_SCHEMA_VERSION`
- `PROVIDER_SANDBOX_LIMITATION_STATEMENT`
- `createProviderSandboxEnvelope`
- `sanitizeProviderSandboxMessage`
- `createRestrictedProviderSandboxServices`
- `validateProviderSandboxPolicy`
- `assertProviderSandboxPolicyValid`
- `sanitizeProviderSandboxResult`
- `sanitizeProviderSandboxError`
- `runProviderInRestrictedSandbox`
- `withProviderSandboxTimeout`

计划从 `src/app/runtime/index.mjs` 导出上述 production-facing sandbox helper，不导出 testing/mock/fake helper。

## 不得改变的旧语义

- provider sandbox 不绕过 runtime gates、auth adapter、sanitizer 或 audit。
- provider sandbox 不直接暴露 raw runtimeContext、raw vault、raw browser handle、raw environment。
- payment/destructive 仍默认 blocked，不注册 production executable provider。
- existing api/download/browser core providers 语义不变。

## 安全边界

- sandbox envelope 只能包含 sanitized invocation subset 和 sanitized execution contract subset。
- services 只能是 allowlisted proxy flags/functions，不能包含 raw handles。
- process.env 不转发给 provider。
- output writer 必须受 output gate 控制。
- audit emitter 只接受 sanitized event。
- provider raw result/error 必须进入 sanitizer。
- Phase 16 tests 必须包含 canaries：
  - `sf_sandbox_env_secret_123`
  - `sf_sandbox_raw_context_secret_456`
  - `sf_sandbox_auth_secret_789`
  - `sf_sandbox_file_secret_000`

## 架构边界

- sandbox 模块位于 runtime/provider-sandbox，不 import concrete production providers。
- 不访问 session vault internals，不创建 browser runtime，不读 process.env secrets。
- 不实现 full OS-level sandbox claim。

## Targeted Tests

- `node --test tests/node/runtime-worker-isolation-provider-sandbox-v1.test.mjs`
- `node --test tests/node/provider-plugin-api-adapter-sdk-v1.test.mjs`
- `node --test tests/node/auth-aware-controlled-browser-runtime-v1.test.mjs`
- `node --test tests/node/auth-runtime-integration-v1.test.mjs`
- `node --test tests/node/capability-contract-conformance.test.mjs`
- `npm run check:syntax`
- `npm run scan:secrets`

## Targeted Grep / Static Checks

- `rg -n "mock-providers|mock-session-vault|runtime/testing|testing\\.mjs|createMock|fake" src/app/runtime/provider-sandbox src/app/runtime/index.mjs`
- `rg -n "src/app/runtime/providers/|api-read-provider|download-provider|browser-action-provider" src/app/runtime/provider-sandbox`
- `rg -n "process\\.env|sessionVault|getScopedSessionMaterial|inspectSession|applyEphemeralAuthCookies|storageState|browserContext|page\\.|writeFile|appendFile|createWriteStream" src/app/runtime/provider-sandbox`
- `rg -n "sf_sandbox_env_secret_123|sf_sandbox_raw_context_secret_456|sf_sandbox_auth_secret_789|sf_sandbox_file_secret_000" src/app/runtime/provider-sandbox tests/node/runtime-worker-isolation-provider-sandbox-v1.test.mjs tests/node/fixtures/runtime-worker-isolation-provider-sandbox-v1`
- `rg -n "create.*Payment|PaymentProvider|payment_provider|create.*Destructive|DestructiveProvider|destructive_provider|PAYMENT_PROVIDER|DESTRUCTIVE_PROVIDER|capabilityKinds.*payment|capabilityKinds.*destructive" src/app/runtime/providers src/app/runtime/provider-registry.mjs src/app/runtime/index.mjs`
- `git diff --check`

## Definition of Done

- sandboxed provider receives only allowed runtime services.
- provider cannot see raw runtimeContext/session vault/auth/browser/env material.
- output writer is gated.
- crash and timeout return sanitized errors.
- raw secret result is sanitized.
- provider cannot directly emit raw audit event.
- Provider SDK conformance remains compatible.
- Existing api/download/browser/auth tests pass.
- payment/destructive remain blocked.
- sandbox limitation statement exists.
- `GOAL_LEDGER.md` records Phase 16 checkpoint.

## Rollback / Stop Conditions

立即停止并不进入 Phase 17，如果出现：

- sandbox exposes raw runtimeContext/sessionVault/browser handle/env.
- sandbox bypasses runtime gates/sanitizer/audit.
- sandbox requires automatic login, profile persistence, storageState persistence, or arbitrary authenticated browsing.
- production provider registry adds destructive/payment provider.
- runtime/index exports mock/fake/testing helper.
- accepted runtime/auth/browser/provider tests regress.

## Phase 16 Checkpoint

- status: PASS WITH NOTES
- implemented public API:
  - `PROVIDER_SANDBOX_PROTOCOL_SCHEMA_VERSION`
  - `PROVIDER_SANDBOX_RESULT_SCHEMA_VERSION`
  - `PROVIDER_SANDBOX_LIMITATION_STATEMENT`
  - `ProviderSandboxError`
  - `createProviderSandboxEnvelope`
  - `sanitizeProviderSandboxMessage`
  - `assertNoProviderSandboxRawMaterial`
  - `createRestrictedProviderSandboxServices`
  - `validateProviderSandboxPolicy`
  - `assertProviderSandboxPolicyValid`
  - `sanitizeProviderSandboxResult`
  - `sanitizeProviderSandboxError`
  - `withProviderSandboxTimeout`
  - `runProviderInRestrictedSandbox`
  - `createProviderSandboxClient`
- targeted tests:
  - `node --test tests/node/runtime-worker-isolation-provider-sandbox-v1.test.mjs`: PASS, 14 tests passed.
  - `node --test tests/node/provider-plugin-api-adapter-sdk-v1.test.mjs`: PASS, 16 tests passed.
  - `node --test tests/node/auth-aware-controlled-browser-runtime-v1.test.mjs`: PASS, 9 tests passed.
  - `node --test tests/node/auth-runtime-integration-v1.test.mjs`: PASS, 13 tests passed.
  - `node --test tests/node/capability-contract-conformance.test.mjs`: PASS, 8 tests passed.
  - `npm run check:syntax`: PASS, 638 files checked.
  - `npm run scan:secrets`: PASS, 692 candidate files scanned.
  - `git diff --check`: PASS.
- static checks:
  - runtime/index mock/fake/testing/raw helper grep: PASS.
  - concrete production provider import grep: PASS.
  - process/env/vault/browser/fs broad grep: PASS WITH NOTE; matches are sanitizer reject patterns only.
  - sandbox canary grep: PASS; canaries appear only in tests and are asserted absent from outputs.
  - production payment/destructive provider grep: PASS.
- canary non-leakage: PASS, sandbox envelope, service summary, result channel, error channel, audit events, timeout output, and Provider SDK conformance report do not contain sandbox canaries.
- architecture boundary: PASS, provider-sandbox does not import concrete providers, session vault internals, browser runtime, audit viewer/query, or filesystem write APIs.
- runtime semantics: PASS, sandbox host does not bypass provider SDK sanitizer; payment/destructive remain blocked; no automatic login, profile/storageState persistence, arbitrary authenticated browsing, or raw env forwarding.
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
  - V1 implements an in-process restricted provider boundary and explicit limitation statement. It is not a full OS-level sandbox and does not claim Worker Thread isolation.
