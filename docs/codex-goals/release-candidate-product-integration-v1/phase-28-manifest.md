# Phase 28 Manifest: Runtime Operations UI / CLI V1

## Status

- phase: 28
- mode: internal safe read-only CLI
- status: pass
- scope: run inspect, audit view/query, package inspect/diff, policy simulate, and regression compare

## Outputs

- `src/app/cli/runtime-ops.mjs`
- `src/infra/cli/command-map.mjs`
- `tests/node/runtime-operations-cli-v1.test.mjs`

## Implementation

- Added `src/app/cli/runtime-ops.mjs` as an internal read-only runtime operations CLI.
- Supported commands:
  - `run inspect <run-store-path>`
  - `audit view <run-store-path|audit-view-json> --format text|json`
  - `audit query <run-store-path> --filter <status|providerId|policyId|reason>=<value>`
  - `package inspect <package-path>`
  - `package diff <old-package> <new-package>`
  - `policy simulate <policy-pack> <capability-package>`
  - `regression compare <old-snapshot> <new-snapshot>`
- Added `runtimeOpsCliCommand()` to `src/infra/cli/command-map.mjs`.
- Kept the public `siteforge build` facade unchanged; runtime ops uses the internal `node src/app/cli/runtime-ops.mjs` entrypoint.

## Boundary Coverage

- audit view CLI text/json: PASS
- audit query CLI safe filter: PASS
- run inspect CLI sanitized output: PASS
- package inspect CLI sanitized output: PASS
- package diff CLI detects risk widening: PASS
- policy simulate CLI does not execute runtime/provider/browser/vault/network: PASS
- regression compare CLI flags high-risk drift: PASS
- path traversal rejected: PASS
- raw artifact content not printed: PASS
- no provider/browser/vault/network calls: PASS
- payment/destructive CLI actions are not available: PASS
- canaries do not leak:
  - `sf_cli_cookie_secret_123`: PASS
  - `sf_cli_token_secret_456`: PASS
  - `sf_cli_raw_body_secret_789`: PASS

## Acceptance Commands

- `node --test tests/node/runtime-operations-cli-v1.test.mjs`: PASS, 11 tests passed.
- `node --test tests/node/runtime-operations-run-store-v1.test.mjs`: PASS, 12 tests passed.
- `node --test tests/node/runtime-execution-replay-audit-viewer-v1.test.mjs`: PASS, 6 tests passed.
- `node --test tests/node/runtime-audit-query-api-v1.test.mjs`: PASS, 7 tests passed.
- `npm run check:syntax`: PASS, 701 files checked.
- `npm run scan:secrets`: PASS, 799 candidate files scanned.
- `git diff --check`: PASS.

## Checkpoint

- result: PASS
- next phase: Phase 29 Production Session Vault Adapter Planning / Prototype may start.
