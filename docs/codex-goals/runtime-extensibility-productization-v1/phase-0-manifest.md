# Phase 0 Manifest: Implementation Recon / Plan Freeze

## 阶段目标

在任何功能代码修改前，完成只读侦察、基线测试、边界检查和计划冻结，确认是否可以进入 Phase 11。

## 允许修改的文件区域

- `docs/codex-goals/runtime-extensibility-productization-v1/`

## 禁止修改的文件区域

- `src/`
- `tests/`
- `config/`
- `schema/`
- `tools/`
- `scripts/`
- `package.json`
- `tsconfig.typecheck.json`
- 已 accepted 阶段 1-10 的测试断言与 fixture

## 新增 Public API

无。Phase 0 不新增运行时、编译器、provider、policy 或 Skill API。

## 不得改变的旧语义

- Controlled Runtime Execution V1
- Capability Contract Conformance Tests
- Controlled Browser Runtime V2
- Auth Runtime Integration V1
- Auth-aware Controlled Browser Runtime V1
- Runtime Execution Replay / Audit Viewer V1
- Session Vault Productionization V2
- Session Policy / Governance Integration V2
- Runtime Audit Query API / Replay Hardening
- Destructive Strong Authorization Flow

## 安全边界

- 不执行 live website action。
- 不访问 vault material。
- 不启动 browser。
- 不保存 raw auth/session/browser/private/payment/destructive material。
- 不修改 payment/destructive blocked 语义。

## 架构边界

- 只检查 `runtime/index.mjs`、production provider registry、compiler/planner/domain/pipeline import 边界。
- 不改变 runtime export 边界。
- 不改变 normal CLI 默认注入语义。

## Targeted Tests

- `node --test tests/node/capability-contract-conformance.test.mjs`
- `node --test tests/node/auth-runtime-integration-v1.test.mjs`
- `node --test tests/node/auth-aware-controlled-browser-runtime-v1.test.mjs`
- `node --test tests/node/runtime-execution-replay-audit-viewer-v1.test.mjs`
- `node --test tests/node/destructive-strong-authorization-flow-v1.test.mjs`
- `npm run scan:secrets`

## Targeted Grep / Static Checks

- `rg -n "mock|fake|testing|createMock|raw.*material" src/app/runtime/index.mjs`
- `rg -n "payment.*provider|destructive.*provider|destructive|payment" src/app/runtime/providers src/app/runtime/provider-registry.mjs src/app/runtime/index.mjs`
- `rg -n "providers/" src/app/compiler src/app/planner src/domain src/app/pipeline`
- `rg -n "executeRuntimeInvocation|provider\\.run|fetch\\(|browserRuntimeFactory|inspectSession|getScopedSessionMaterial|applyEphemeralAuthCookies" src/app/runtime/audit-viewer src/app/runtime/audit-query`
- `git status --short`
- `git diff --stat`
- `git diff --name-only`

## Definition of Done

- 当前工作树状态可判断。
- 已 accepted 关键测试通过。
- `runtime/index.mjs` 未暴露 mock/fake/testing/raw helper。
- production registry 未默认注册 payment/destructive executable provider。
- import 边界未发现 provider implementation 泄漏。
- `scan:secrets` 通过。
- `GOAL_LEDGER.md` 已创建或更新。

## Rollback / Stop Conditions

立即停止并不进入 Phase 11，如果出现：

- 已 accepted 关键测试失败。
- `runtime/index.mjs` 泄漏 testing/mock/fake API。
- production registry 默认包含 destructive/payment executable provider。
- 工作树状态无法判断且可能混入无关大改。
- `scan:secrets` 失败且与现有基线无关。

## Phase 0 Checkpoint

状态：PASS。

证据：

- baseline commit: `2f2da3e26d81612fbf36e44a64a494c46041a907`
- branch: `main`
- `git status --short --branch`: `## main`
- `git diff --stat`: 无输出
- `git diff --name-only`: 无输出
- accepted 关键测试和 `scan:secrets` 全部通过

结论：可以进入 Phase 11。
