# Phase 25 Manifest: External Skill API / Local Service Wrapper V1

## Status

- phase: 25
- mode: local SDK wrapper only
- status: pass
- scope: local-only structured Skill Runtime Invocation service wrapper

## Outputs

- `src/app/runtime/skill-service/local-skill-runtime-service-schema.mjs`
- `src/app/runtime/skill-service/local-skill-runtime-service-sanitizer.mjs`
- `src/app/runtime/skill-service/local-skill-runtime-service.mjs`
- `src/app/runtime/skill-service/index.mjs`
- `src/app/runtime/index.mjs`
- `tests/node/external-skill-api-local-service-v1.test.mjs`
- `tests/node/fixtures/external-skill-api-local-service-v1/local-service-request.json`

## Design

- Implemented Option A: local SDK only.
- Added `createLocalSkillRuntimeService()` and `invokeLocalSkillRuntime()`.
- No local HTTP server was added.
- No public internet service or external listener was added.
- The service reports `LOCAL_SKILL_RUNTIME_SERVICE_NETWORK_BOUNDARY` with `serverEnabled: false`, `bindAddress: null`, and `publicInterfaceBound: false`.

## Boundary Coverage

- structured JSON request and response: PASS
- dryRun / execute separation: PASS
- idempotency support through existing Skill Runtime Invocation ledger: PASS
- `capabilityRef` and `executionContractRef` required by existing validator: PASS
- `policyDecisionRef` required unless explicit policy simulation mode is used: PASS
- safe `runId` / `auditViewRef` output: PASS
- sanitized error envelope: PASS
- raw cookie/token/header/sessionHandle rejected: PASS
- natural language authorization ignored: PASS
- payment request blocked: PASS
- destructive request blocked by default: PASS
- no provider execution during dryRun: PASS
- no vault material access during dryRun: PASS
- external request cannot provide direct provider/vault/runtime access fields: PASS

## Acceptance Commands

- `node --test tests/node/external-skill-api-local-service-v1.test.mjs`: PASS, 11 tests passed.
- `node --test tests/node/skill-runtime-invocation-api-v1.test.mjs`: PASS, 15 tests passed.
- `node --test tests/node/runtime-operations-run-store-v1.test.mjs`: PASS, 12 tests passed.
- `node --test tests/node/capability-contract-conformance.test.mjs`: PASS, 8 tests passed.
- runtime index forbidden export probe: PASS, no `mock`, `fake`, `test`, `testing`, `fixture`, or `raw` exports.
- `npm run check:syntax`: PASS, 695 files checked.
- `npm run scan:secrets`: PASS, 775 candidate files scanned.
- `git diff --check`: PASS.

## Checkpoint

- result: PASS
- next phase: Phase 26 First-party Site Package Pilot V1 may start.
