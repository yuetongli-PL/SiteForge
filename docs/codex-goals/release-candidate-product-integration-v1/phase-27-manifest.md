# Phase 27 Manifest: CI / Release Gate Integration

## Status

- phase: 27
- mode: npm scripts plus release gate runner, regression runner, CI-facing docs, and integration tests
- status: pass
- scope: runtime trust, runtime productization, regression, canary, production provider, runtime export, and optional live-smoke release gates

## Outputs

- `package.json`
- `scripts/runtime-productization-regression.mjs`
- `scripts/verify-release.mjs`
- `docs/release/release-gates.md`
- `tests/node/ci-release-gate-integration-v1.test.mjs`

## Implementation

- Added `npm run test:runtime-trust`.
- Added `npm run test:runtime-productization`.
- Added `npm run test:regression`.
- Added `npm run verify:release`.
- Integrated `npm run verify:release` into existing `npm run release:local` without removing the existing README, typecheck, syntax, focused Node, full Node, Python, secret scan, or `git diff --check` gates.
- Added `scripts/runtime-productization-regression.mjs` for deterministic trust, productization, and regression test grouping.
- Added `scripts/verify-release.mjs` as the release gate runner.
- Added `docs/release/release-gates.md` covering release commands, blockers, optional live smoke, and GitHub Actions integration through the existing `release:local` workflow path.

## Gate Coverage

- package scripts exist: PASS
- verify release command includes runtime trust and productization tests: PASS
- regression gate flags high-risk drift: PASS
- release gate blocks raw canary leakage: PASS
- release gate checks production payment/destructive provider absence: PASS
- release gate checks runtime/index export boundary: PASS
- release gate does not require live optional smoke by default: PASS
- optional live smoke remains opt-in via `SITEFORGE_OPTIONAL_LIVE_SMOKE`: PASS
- existing scripts are not weakened: PASS

## Acceptance Commands

- `node --test tests/node/ci-release-gate-integration-v1.test.mjs`: PASS, 11 tests passed.
- `node --test tests/node/runtime-ci-regression-harness-v1.test.mjs`: PASS, 14 tests passed.
- `npm run test:runtime-productization`: PASS, 75 tests passed.
- `npm run test:regression`: PASS, 25 tests passed.
- `npm run verify:release`: PASS:
  - `test:runtime-trust`: PASS, 63 tests passed.
  - `test:runtime-productization`: PASS, 75 tests passed.
  - `test:regression`: PASS, 25 tests passed.
  - `scan:secrets`: PASS, 796 candidate files scanned.
  - `git diff --check`: PASS.
- `npm run scan:secrets`: PASS, 796 candidate files scanned.
- `git diff --check`: PASS.

## Checkpoint

- result: PASS
- next phase: Phase 28 Runtime Operations UI / CLI V1 may start.
