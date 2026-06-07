# Phase 17 Manifest: Runtime Operations / Run Store V1

## 阶段目标

把 runtime run artifacts 组织成 production-style run store，使每次 skill/runtime invocation 可被追踪、审计、查询和回归，同时不保存 raw sensitive material、不读取 raw artifact content、不执行 provider/browser/vault/network。

## 允许修改的文件区域

- `src/app/runtime/run-store/`
- `src/app/runtime/index.mjs` production-facing run store exports only
- `tests/node/runtime-operations-run-store-v1.test.mjs`
- `tests/node/fixtures/runtime-operations-run-store-v1/`
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

计划在 `src/app/runtime/run-store/index.mjs` 暴露：

- `RUNTIME_RUN_STORE_SCHEMA_VERSION`
- `RUNTIME_RUN_STORE_MANIFEST_SCHEMA_VERSION`
- `createRuntimeRunId`
- `sanitizeRunStoreManifest`
- `createRunStoreManifest`
- `createRunStoreIntegrityDigest`
- `createRunStoreRetentionMetadata`
- `resolveRunStorePath`
- `writeRuntimeRunStore`
- `loadRuntimeRunStore`
- `createRunStoreQueryIndex`
- `queryRunStoreIndex`

## 不得改变的旧语义

- replay/audit/query/regression 不执行 provider/browser/vault/network。
- run store 不保存 raw session material、raw request/response body、raw browser trace、raw DOM/screenshot/video。
- run store 不读取 raw artifact content。
- path traversal / absolute path outside root 必须 fail closed。

## 安全边界

- manifest、audit events、audit view、query index、artifact metadata 都必须 allowlist。
- durable output 不含 canaries：
  - `sf_runstore_cookie_secret_123`
  - `sf_runstore_token_secret_456`
  - `sf_runstore_artifact_secret_789`

## 架构边界

- run-store 位于 runtime operations 层。
- 不 import concrete providers、browser runtime、session vault material APIs。
- 不调用 `executeRuntimeInvocation`、provider `.run()`、`fetch`、browser/vault APIs。

## Targeted Tests

- `node --test tests/node/runtime-operations-run-store-v1.test.mjs`
- `node --test tests/node/runtime-execution-replay-audit-viewer-v1.test.mjs`
- `node --test tests/node/runtime-audit-query-api-v1.test.mjs`
- `node --test tests/node/runtime-worker-isolation-provider-sandbox-v1.test.mjs`
- `npm run check:syntax`
- `npm run scan:secrets`

## Targeted Grep / Static Checks

- `rg -n "providers/|provider-registry|browser-runtime|session-vault|executeRuntimeInvocation|provider\\.run|fetch\\(|openBrowserSession|getScopedSessionMaterial|inspectSession|applyEphemeralAuthCookies" src/app/runtime/run-store tests/node/runtime-operations-run-store-v1.test.mjs`
- `rg -n "sf_runstore_cookie_secret_123|sf_runstore_token_secret_456|sf_runstore_artifact_secret_789" src/app/runtime/run-store tests/node/runtime-operations-run-store-v1.test.mjs tests/node/fixtures/runtime-operations-run-store-v1`
- `rg -n "raw.*material|raw.*session|raw.*body|cookie|authorization|credential|password|storageState|localStorage|sessionStorage|IndexedDB|screenshot|video|trace|raw.*artifact|readFile\\(" src/app/runtime/run-store`
- `rg -n "createMock|fake|fixture|testing|raw.*material" src/app/runtime/index.mjs`
- `rg -n "PaymentProvider|DestructiveProvider|payment_provider|destructive_provider|capabilityKinds.*payment|capabilityKinds.*destructive" src/app/runtime/providers src/app/runtime/provider-registry.mjs src/app/runtime/index.mjs`
- `git diff --check`

## Definition of Done

- sanitized run creates manifest.
- audit viewer and query index can consume run store metadata.
- path traversal and unsafe absolute paths are rejected.
- oversized files fail closed.
- missing optional files warn, not crash.
- digest mismatch warning is reported.
- retention metadata recorded.
- raw artifact content is not read.
- no canaries stored.
- run store does not execute provider/vault/browser/network.
- `GOAL_LEDGER.md` records Phase 17 checkpoint.

## Checkpoint

- Phase 17 PASS WITH NOTES.
- Modified files:
  - `src/app/runtime/run-store/run-store-schema.mjs`
  - `src/app/runtime/run-store/run-store-sanitizer.mjs`
  - `src/app/runtime/run-store/run-store-retention.mjs`
  - `src/app/runtime/run-store/run-store-integrity.mjs`
  - `src/app/runtime/run-store/run-store-paths.mjs`
  - `src/app/runtime/run-store/run-store-manifest.mjs`
  - `src/app/runtime/run-store/run-store-query-index.mjs`
  - `src/app/runtime/run-store/run-store-writer.mjs`
  - `src/app/runtime/run-store/run-store-loader.mjs`
  - `src/app/runtime/run-store/index.mjs`
  - `src/app/runtime/index.mjs`
  - `tests/node/runtime-operations-run-store-v1.test.mjs`
  - `docs/codex-goals/runtime-extensibility-productization-v1/phase-17-manifest.md`
- Public APIs:
  - `RUNTIME_RUN_STORE_SCHEMA_VERSION`
  - `RUNTIME_RUN_STORE_MANIFEST_SCHEMA_VERSION`
  - `RUNTIME_RUN_STORE_QUERY_INDEX_SCHEMA_VERSION`
  - `RUNTIME_RUN_STORE_RETENTION_SCHEMA_VERSION`
  - `RUNTIME_RUN_STORE_MAX_JSON_BYTES`
  - `createRuntimeRunId`
  - `resolveRunStorePath`
  - `sanitizeRunStoreManifest`
  - `assertNoRunStoreRawMaterial`
  - `createRunStoreManifest`
  - `createRunStoreIntegrityDigest`
  - `createContentDigest`
  - `createRunStoreRetentionMetadata`
  - `writeRuntimeRunStore`
  - `loadRuntimeRunStore`
  - `createRunStoreQueryIndex`
  - `queryRunStoreIndex`
- Targeted tests:
  - `node --test tests/node/runtime-operations-run-store-v1.test.mjs`: PASS, 12 tests passed.
  - `node --test tests/node/runtime-execution-replay-audit-viewer-v1.test.mjs`: PASS, 6 tests passed.
  - `node --test tests/node/runtime-audit-query-api-v1.test.mjs`: PASS, 7 tests passed.
  - `node --test tests/node/runtime-worker-isolation-provider-sandbox-v1.test.mjs`: PASS, 14 tests passed.
  - `npm run check:syntax`: PASS, 649 files checked.
  - `npm run scan:secrets`: PASS, 704 candidate files scanned.
  - `git diff --check`: PASS.
- Static checks:
  - provider/browser/vault/network execution grep over `src/app/runtime/run-store` and the Phase 17 test: PASS, no matches.
  - run store canary grep: PASS, canaries appear only in the Phase 17 test injection/assertion paths.
  - sensitive/raw material grep: NOTE, expected sanitizer reject-pattern matches plus bounded JSON `readFile` in the run store loader; reviewed as safe because the loader reads only confined run store JSON files and does not read raw artifact content.
  - runtime/index mock/fake/testing/raw helper grep: PASS, no matches.
  - production payment/destructive provider grep: PASS, no matches.
- Canary non-leakage: PASS, manifest, audit events, audit view, query index, retention metadata, load result, and durable JSON output do not contain run store canaries.
- Architecture boundary: PASS, run store modules do not import concrete providers, provider registry, browser runtime, session vault APIs, audit query execution paths, or provider execution paths.
- Runtime semantics: PASS, run store writing/loading/querying does not execute provider, browser, vault, network, payment, or destructive actions.
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
  - Non-blocking note: the run store loader uses bounded, path-confined JSON reads for run store-owned artifacts only; raw artifact files are intentionally not read.
  - Continue: Phase 18 may begin.

## Rollback / Stop Conditions

立即停止并不进入 Phase 18，如果出现：

- run store stores raw auth/session/browser/private/payment material.
- run store reads raw artifact content.
- replay/query/regression can execute provider/browser/vault/network.
- path confinement fails.
- accepted replay/audit/query/sandbox tests regress.
