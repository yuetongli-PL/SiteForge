# Phase 24 Manifest: Developer Documentation / SDK Guide V1

## Status

- phase: 24
- mode: documentation plus documentation regression test
- status: pass
- scope: Provider SDK, Skill Invocation, Capability Package, Policy Pack, Run Store, Regression Harness, and runtime/security boundaries

## Outputs

- `docs/runtime/provider-sdk.md`
- `docs/runtime/skill-invocation-api.md`
- `docs/runtime/capability-package.md`
- `docs/runtime/policy-pack.md`
- `docs/runtime/run-store.md`
- `docs/runtime/regression-harness.md`
- `docs/security/runtime-boundaries.md`
- `docs/security/provider-sandbox-limitations.md`
- `docs/security/payment-destructive-boundaries.md`
- `tests/node/documentation-runtime-productization-v1.test.mjs`

## Required Coverage

- provider cannot directly access vault: PASS
- provider cannot directly launch browser: PASS
- provider cannot directly write audit/report/result/run-store artifacts: PASS
- provider must pass SDK/conformance/registration validation: PASS
- skill task text is not authorization: PASS
- skill dryRun does not execute provider: PASS
- skill execute still goes through runtime gates: PASS
- payment/destructive default blocked: PASS
- destructive controlled execution remains planning/lab-only: PASS
- payment authorization remains architecture/threat model and not execution: PASS
- sandbox V1 is a provider service boundary, not a full OS sandbox: PASS
- run store / audit query / replay do not execute provider/browser/vault/network paths: PASS
- capability packages do not carry raw private/session material: PASS

## Forbidden Documentation Claims

- automatic login supported: absent
- arbitrary authenticated browsing supported: absent
- payment execution supported: absent
- default destructive execution supported: absent
- sandbox is a full OS sandbox: absent
- Skill natural-language authorization for high-risk actions: absent
- raw credentials can be passed to Skill API: absent

## Acceptance Commands

- `node --test tests/node/documentation-runtime-productization-v1.test.mjs`: PASS, 4 tests passed.
- `npm run check:syntax`: PASS, 690 files checked.
- `npm run scan:secrets`: PASS, 768 candidate files scanned.
- `git diff --check`: PASS.

## Notes

- Documentation references live schema/API names including `PROVIDER_MANIFEST_SCHEMA_VERSION`, `SKILL_RUNTIME_INVOCATION_SCHEMA_VERSION`, `CAPABILITY_PACKAGE_SCHEMA_VERSION`, `POLICY_PACK_SCHEMA_VERSION`, `RUNTIME_RUN_STORE_SCHEMA_VERSION`, `RUNTIME_CI_REGRESSION_SNAPSHOT_SCHEMA_VERSION`, `PROVIDER_SANDBOX_PROTOCOL_SCHEMA_VERSION`, `PAYMENT_AUTHORIZATION_PLAN_SCHEMA_VERSION`, and `DESTRUCTIVE_EXECUTION_PLAN_SCHEMA_VERSION`.
- The documentation test checks required docs, boundary language, schema references, canary absence, and forbidden positive safety claims.

## Checkpoint

- result: PASS
- next phase: Phase 25 External Skill API / Local Service Wrapper V1 may start.
