# Phase 23 Manifest: Commit / PR Decomposition

## Status

- phase: 23
- mode: commit plan only
- status: pass_with_notes
- scope: decompose the accepted uncommitted Runtime Extensibility & Productization V1 baseline plus Phase 22 release verification artifacts into reviewable commit or PR groups

## Required Commands

- `git status --short`: PASS WITH NOTES; checkout contains the accepted baseline, Phase 22 boundary repair, and release-candidate docs.
- `git diff --stat`: PASS WITH NOTES; tracked diff contains six modified files, while most baseline artifacts are currently untracked.
- `git diff --name-only`: PASS WITH NOTES; tracked file list reviewed.
- `git ls-files --others --exclude-standard`: PASS WITH NOTES; untracked baseline and docs file list reviewed for grouping.

## Decision

No commits were created in Phase 23. The plan allows commit-plan-only mode, and the user has not explicitly authorized local commits. Several shared facade files also require careful hunk staging, so the safe action is to record the decomposition and leave commit execution for explicit approval.

## Recommended Commit / PR Groups

### 1. `feat(capability): add graph versioning and registry`

File boundary:

- `src/domain/capabilities/graph-registry/**`
- `tests/node/capability-graph-versioning-registry-v1.test.mjs`
- `tests/node/fixtures/capability-graph-versioning-registry-v1/**`

Review focus:

- graph digest, diff, canonicalization, migration, compatibility, auth/risk/provider deltas
- no runtime provider execution
- no raw material persistence

### 2. `feat(runtime): add provider plugin SDK`

File boundary:

- `src/app/runtime/provider-sdk/**`
- `src/app/runtime/provider-registry.mjs`
- provider-SDK export block in `src/app/runtime/index.mjs`
- provider manifest integration hunks in `src/app/runtime/providers/index.mjs`
- provider SDK tests and fixtures:
  - `tests/node/provider-plugin-api-adapter-sdk-v1.test.mjs`
  - `tests/node/fixtures/provider-plugin-api-adapter-sdk-v1/**`

Review focus:

- conformance harness
- manifest validation
- production registration rejection for payment/destructive providers
- raw provider output sanitization

### 3. `feat(compiler): harden capability contract extraction`

File boundary:

- `src/app/compiler/contract-extraction-v2.mjs`
- contract extraction export hunk in `src/app/compiler/index.mjs`
- `tests/node/site-capability-compiler-hardening-v2.test.mjs`
- `tests/node/fixtures/site-capability-compiler-hardening-v2/**`

Review focus:

- descriptor-only extraction
- redaction and canary rejection
- no runtime provider imports

### 4. `feat(capability): add site capability package registry`

File boundary:

- `src/domain/capability-packages/**`
- `tests/node/capability-package-site-adapter-registry-v1.test.mjs`
- `tests/node/fixtures/capability-package-site-adapter-registry-v1/**`

Review focus:

- capability package schema and provenance
- capability and execution contract ref resolution
- no raw private/session material in package artifacts

### 5. `feat(policy): add policy pack simulation`

File boundary:

- `src/domain/policies/policy-pack/**`
- `tests/node/policy-pack-authoring-simulation-v1.test.mjs`
- `tests/node/fixtures/policy-pack-authoring-simulation-v1/**`

Review focus:

- policy pack validation and simulation
- task text does not become authorization
- raw material rejection

### 6. `feat(runtime): add provider sandbox boundary`

File boundary:

- `src/app/runtime/provider-sandbox/**`
- provider-sandbox export block in `src/app/runtime/index.mjs`
- run-store writer architecture allowlist hunk in `tests/node/architecture-import-rules.test.mjs` only if staged with the run-store group instead
- `tests/node/runtime-worker-isolation-provider-sandbox-v1.test.mjs`
- `tests/node/fixtures/runtime-worker-isolation-provider-sandbox-v1/**`

Review focus:

- worker isolation
- restricted services
- no direct session vault, browser launch, or raw runtime context access

### 7. `feat(runtime): add run store operations`

File boundary:

- `src/app/runtime/run-store/**`
- run-store export block in `src/app/runtime/index.mjs`
- run-store writer architecture allowlist hunk in `tests/node/architecture-import-rules.test.mjs`
- `tests/node/runtime-operations-run-store-v1.test.mjs`

Review focus:

- sanitized run, audit, manifest, query index, and retention persistence
- path confinement
- no raw artifact content reads

### 8. `feat(runtime): add skill invocation API`

File boundary:

- `src/app/runtime/skill-invocation/**`
- skill-invocation export block in `src/app/runtime/index.mjs`
- `tests/node/skill-runtime-invocation-api-v1.test.mjs`
- `tests/node/fixtures/skill-runtime-invocation-api-v1/**`

Review focus:

- dryRun does not execute providers
- execute still routes through runtime gates
- raw cookies/tokens/session handles are rejected

### 9. `feat(runtime): add CI regression harness`

File boundary:

- `src/app/runtime/regression-harness/**`
- regression-harness export block in `src/app/runtime/index.mjs`
- regression fixture export in `src/app/runtime/testing.mjs`
- `tests/node/runtime-ci-regression-harness-v1.test.mjs`
- `tests/node/fixtures/runtime-ci-regression-harness-v1/**`

Review focus:

- regression comparisons and severity classification
- payment/destructive blocked-to-invoked regression detection
- fixture helpers stay behind `runtime/testing.mjs`, never `runtime/index.mjs`

### 10. `feat(domain): add destructive execution planning`

File boundary:

- `src/domain/destructive-planning/**`
- `tests/node/destructive-controlled-execution-v2-planning.test.mjs`
- `tests/node/fixtures/destructive-controlled-execution-v2-planning/**`

Review focus:

- planning and simulation only
- production destructive provider remains absent
- strong authorization and dry-run proof requirements

### 11. `feat(domain): add payment authorization planning`

File boundary:

- `src/domain/payment-authorization/**`
- `tests/node/payment-authorization-architecture-plan-v1.test.mjs`
- `tests/node/fixtures/payment-authorization-architecture-plan-v1/**`

Review focus:

- threat-model and authorization planning only
- no payment provider or payment network execution
- raw card/bank/token material rejection

### 12. `test(e2e): add compile-package-skill-runtime-audit flow`

File boundary:

- `tests/node/siteforge-runtime-productization-e2e-v1.test.mjs`
- `tests/node/fixtures/siteforge-runtime-productization-e2e-v1/**`
- shared runtime index/provider registry hunks only if needed to support the covered integration flow and already reviewed in earlier runtime groups

Review focus:

- compile package to skill invocation to runtime audit flow
- payment/destructive remain blocked
- sanitized run store output

### 13. `docs(runtime): add productization goal ledger`

File boundary:

- `docs/codex-goals/runtime-extensibility-productization-v1/**`

Review focus:

- phase 0, phase 11-21, and E2E accepted baseline record
- command evidence and boundary decisions
- no canary secret leakage

### 14. `docs(release): add runtime productization verification report`

File boundary:

- `docs/releases/runtime-extensibility-productization-v1-verification.md`
- `docs/codex-goals/release-candidate-product-integration-v1/phase-22-manifest.md`
- `docs/codex-goals/release-candidate-product-integration-v1/phase-23-manifest.md`
- `docs/codex-goals/release-candidate-product-integration-v1/GOAL_LEDGER.md`

Review focus:

- Phase 22 PASS WITH NOTES evidence
- Phase 23 decomposition
- no docs claim production payment execution or production destructive execution exists

## Shared Staging Notes

- `src/app/runtime/index.mjs` is a shared facade. Split it by export block across groups 2, 6, 7, 8, and 9, or stage it once as a dedicated runtime public facade commit after those groups.
- `src/app/runtime/providers/index.mjs` belongs with provider SDK and production registry validation in group 2.
- `tests/node/architecture-import-rules.test.mjs` currently has a single run-store writer allowlist hunk; stage it with group 7.
- Phase 22 repair to keep fixture/raw helpers out of `runtime/index.mjs` should be preserved in groups 2 and 9, with the explicit boundary test in group 2.

## Acceptance

- commit grouping complete: PASS
- file boundaries clear: PASS WITH NOTES because `src/app/runtime/index.mjs` needs hunk staging or a dedicated facade commit
- unrelated files: PASS, all current uncommitted files map to the accepted baseline, Phase 22 repair, or Phase 23 docs
- code behavior unchanged by Phase 23: PASS, this phase only wrote decomposition documentation
- no downstream verification skipped: PASS, Phase 22 verification remains recorded and Phase 24 has not started yet

## Checkpoint

- result: PASS WITH NOTES
- next phase: Phase 24 Developer Documentation / SDK Guide V1 may start.
