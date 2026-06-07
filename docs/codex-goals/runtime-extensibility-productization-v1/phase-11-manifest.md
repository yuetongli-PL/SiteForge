# Phase 11 Manifest: Capability Graph Versioning / Registry V1

## 阶段目标

建立稳定的 capability graph schema、版本、canonicalization、digest、diff、registry、compatibility check 和 migration hook，使网站能力变化可以被检测、治理、审计，并且不会执行 provider、vault、browser 或 network。

## 允许修改的文件区域

- `src/domain/capabilities/graph-registry/`
- `tests/node/capability-graph-versioning-registry-v1.test.mjs`
- `tests/node/fixtures/capability-graph-versioning-registry-v1/`
- `docs/codex-goals/runtime-extensibility-productization-v1/`

## 禁止修改的文件区域

- `src/app/runtime/providers/`
- `src/app/runtime/browser-runtime/`
- `src/app/runtime/session-vault/`
- `src/app/runtime/audit-viewer/`
- `src/app/runtime/audit-query/`
- `src/app/runtime/index.mjs`，除非只新增明确的 production-facing capability graph helper export 且不暴露 testing/mock/fake/raw helper
- `src/entrypoints/build/run-build.mjs`
- 已 accepted 阶段 1-10 测试的断言语义
- production provider registry 默认 destructive/payment 语义

## 新增 Public API

计划在 `src/domain/capabilities/graph-registry/index.mjs` 暴露：

- `CAPABILITY_GRAPH_SCHEMA_VERSION`
- `sanitizeCapabilityGraphForRegistry(graph, options)`
- `canonicalizeCapabilityGraph(graph, options)`
- `createCapabilityGraphDigest(graph, options)`
- `createStableCapabilityId(input, options)`
- `diffCapabilityGraphs(previousGraph, nextGraph, options)`
- `assessCapabilityContractCompatibility(previousGraph, nextGraph, options)`
- `assessCapabilityRiskDiff(previousGraph, nextGraph, options)`
- `assessCapabilityAuthDiff(previousGraph, nextGraph, options)`
- `assessCapabilityProviderCompatibility(previousGraph, nextGraph, options)`
- `createCapabilityGraphRegistry(options)`
- `migrateCapabilityGraph(graph, options)`

## 不得改变的旧语义

- Capability Contract Conformance Tests 仍是 runtime contract gate 的基线。
- compiler/planner/domain/governance/pipeline 不得 import runtime provider implementation。
- `runtime/index.mjs` 不得暴露 mock/fake/testing/raw helper。
- production provider registry 不得默认包含 payment/destructive executable provider。
- destructive/payment 仍为默认 blocked 或 planning-only，不得变成执行。
- replay/query/regression 不得执行 provider/browser/vault/network。

## 安全边界

- graph registry output 必须通过 allowlist construction。
- 不得将 raw input object 整体 `JSON.stringify` 后作为 durable output。
- 不得保存 raw cookie/token/Authorization/Cookie/Set-Cookie/header/body/sessionHandle/session object/vault response/material grant/storageState/localStorage/sessionStorage/IndexedDB/raw DOM/screenshot/video/full trace/raw submitted values/raw destructive confirmation token/raw payment credential。
- Phase 11 tests 必须包含 canary non-leakage：
  - `sf_graph_cookie_secret_123`
  - `sf_graph_private_form_secret_456`
  - `sf_graph_session_secret_789`

## 架构边界

- 新模块放在 domain capability registry 层，只处理 descriptor/graph/package metadata。
- 不 import `src/app/runtime/providers/*`。
- 不 import browser runtime、session vault、audit writer、execution runner。
- 不调用 `fetch`、provider `.run()`、browser/vault/network APIs。
- 只输出 sanitized graph、digest、diff、registry entry 和 compatibility assessment。

## Targeted Tests

- `node --test tests/node/capability-graph-versioning-registry-v1.test.mjs`
- `node --test tests/node/capability-contract-conformance.test.mjs`
- `npm run check:syntax`
- `npm run scan:secrets`

## Targeted Grep / Static Checks

- `rg -n "providers/" src/domain/capabilities/graph-registry tests/node/capability-graph-versioning-registry-v1.test.mjs`
- `rg -n "fetch\\(|provider\\.run|executeRuntimeInvocation|browserRuntime|sessionVault|getScopedSessionMaterial|inspectSession|applyEphemeralAuthCookies" src/domain/capabilities/graph-registry tests/node/capability-graph-versioning-registry-v1.test.mjs`
- `rg -n "sf_graph_cookie_secret_123|sf_graph_private_form_secret_456|sf_graph_session_secret_789" src/domain/capabilities/graph-registry tests/node/capability-graph-versioning-registry-v1.test.mjs tests/node/fixtures/capability-graph-versioning-registry-v1`
- `rg -n "createMock|fake|fixture|testing|raw.*material" src/app/runtime/index.mjs`
- `rg -n "payment.*provider|destructive.*provider" src/app/runtime/providers src/app/runtime/provider-registry.mjs src/app/runtime/index.mjs`
- `git diff --check`

## Definition of Done

- Graph schema version constant exists.
- Stable capability ID logic exists and is deterministic.
- Canonicalization makes semantically equivalent metadata ordering stable.
- Digest changes on meaningful contract changes.
- Registry stores sanitized graph only.
- Diff identifies high-risk changes:
  - public -> auth required
  - auth scope widened
  - read -> write
  - write -> destructive
  - non-payment -> payment
  - side-effect-free -> side-effecting
  - provider compatibility changed
  - selector confidence decreased below threshold
  - execution contract concrete -> not concrete
  - allowedOrigins widened
  - material type widened
  - injectionTarget changed
  - completion signal removed
- Targeted tests pass.
- Targeted static checks pass or have documented non-blocking explanations.
- `GOAL_LEDGER.md` records Phase 11 checkpoint.

## Rollback / Stop Conditions

立即停止并不进入 Phase 12，如果出现：

- Phase 11 新模块执行 provider/vault/browser/network。
- Graph registry output 泄漏 raw auth/session/private/payment/destructive material。
- Diff 不能识别计划要求的高风险变化。
- 新增代码修改 runtime/provider/session/browser production execution 语义。
- `runtime/index.mjs` 暴露 mock/fake/testing/raw helper。
- production registry 默认包含 payment/destructive executable provider。
- `node --test tests/node/capability-contract-conformance.test.mjs` 回退。
- `npm run scan:secrets` 失败且无法在边界内修复。

## Subagent / Auditor Plan

环境支持 subagents。Phase 11 使用：

- 代码库侦察子代理：只读检查现有 capability graph/fixtures/API 命名模式。
- 边界审计子代理：只读检查 static checks、stop conditions、canary coverage。
- 主执行线程：实现 Phase 11 模块、测试、ledger 更新和 phase lock。

## Phase 11 Checkpoint

阶段状态：PASS WITH NOTES。

修改摘要：

- 新增独立 `graph-registry` domain 模块族，提供 schema、stable capability ID、canonicalization、digest、diff、contract compatibility、risk/auth/provider compatibility、migration 和 sanitized registry。
- 新增 Phase 11 fixtures，包含 graph canary 污染输入，验证 registry durable output 不泄漏 raw material。
- 新增 targeted test，覆盖 Phase 11 计划要求的 17 类能力图谱版本化、digest、diff、registry 和 no-side-effect 行为。

测试结果：

- `node --test tests/node/capability-graph-versioning-registry-v1.test.mjs`: PASS, 20 tests passed.
- `node --test tests/node/capability-contract-conformance.test.mjs`: PASS, 8 tests passed.
- `npm run check:syntax`: PASS.
- `npm run scan:secrets`: PASS.
- `git diff --check`: PASS.

边界结果：

- 架构边界：PASS，无 runtime/provider/browser/vault import。
- 安全边界：PASS，canary 只出现在测试输入中，Phase 11 输出均断言不包含 canary。
- Runtime semantics：PASS，无 provider invocation、browser launch、vault access、network call、payment execution、destructive execution。

Notes：

- `JSON.stringify` 静态检查有一个命中：`stringifyCanonicalCapabilityGraph` 用于 canonical digest，输入已经过 sanitizer/canonicalizer；不是 raw input durable output。
- 未把 Phase 11 schema 写入全局 schema inventory，因为 manifest allowlist 未包含 `src/domain/schemas/`，且这不是进入 Phase 12 的阻断条件。

结论：可以进入 Phase 12。
