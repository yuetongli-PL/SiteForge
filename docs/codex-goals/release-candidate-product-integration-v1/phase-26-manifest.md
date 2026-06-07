# Phase 26 Manifest: First-party Site Package Pilot V1

## Status

- phase: 26
- mode: first-party fixture packages plus runtime integration tests
- status: pass
- scope: safe pilot packages for public read, public download, controlled form action, auth read, auth controlled browser write, destructive blocked, and payment blocked/planned

## Outputs

- `packages/siteforge-sites/public-read-fixture/site.capability_package.json`
- `packages/siteforge-sites/public-read-fixture/README.md`
- `packages/siteforge-sites/public-download-fixture/site.capability_package.json`
- `packages/siteforge-sites/public-download-fixture/README.md`
- `packages/siteforge-sites/contact-form-fixture/site.capability_package.json`
- `packages/siteforge-sites/contact-form-fixture/README.md`
- `packages/siteforge-sites/auth-read-fixture/site.capability_package.json`
- `packages/siteforge-sites/auth-read-fixture/README.md`
- `packages/siteforge-sites/auth-browser-write-fixture/site.capability_package.json`
- `packages/siteforge-sites/auth-browser-write-fixture/README.md`
- `packages/siteforge-sites/destructive-blocked-fixture/site.capability_package.json`
- `packages/siteforge-sites/destructive-blocked-fixture/README.md`
- `packages/siteforge-sites/payment-blocked-fixture/site.capability_package.json`
- `packages/siteforge-sites/payment-blocked-fixture/README.md`
- `src/app/runtime/skill-invocation/skill-runtime-invocation-package-resolver.mjs`
- `src/app/runtime/skill-invocation/skill-runtime-invocation-runner.mjs`
- `tests/node/first-party-site-package-pilot-v1.test.mjs`

## Implementation

- Added seven first-party pilot package fixtures under `packages/siteforge-sites/`.
- Kept payment and destructive packages non-default-executable and provider-blocked before material use.
- Preserved package manifests as descriptor-only JSON with safe provenance and audit metadata.
- Added package-origin propagation in skill invocation package resolution.
- Added internal package-auth descriptor to runtime-auth mapping in skill invocation runner:
  - package `siteOrigin` becomes the runtime auth scope origin.
  - read packages map to `http_request` bearer-token auth descriptors.
  - controlled browser write packages map to `browser_context` cookie auth descriptors.
  - safe `sessionRef` is converted to a runtime session handle ref only inside the runtime boundary.
  - a structured auth gate summary is created from the governed runtime policy decision.
- Added `first-party-site-package-pilot-v1.test.mjs` covering validation, digest stability, ref resolution, dryRun/execute behavior, audit view generation, regression snapshots, and canary non-leakage.

## Boundary Coverage

- all pilot packages validate: PASS
- package digests stable across canonical round trips: PASS
- `capabilityRef` resolves: PASS
- `executionContractRef` resolves: PASS
- public read dryRun/execute read-only behavior: PASS
- public download dryRun/execute safe metadata behavior: PASS
- controlled form fixture executes through controlled runtime provider path: PASS
- auth read fixture uses safe mock session metadata: PASS
- auth controlled browser write installs guards before material use: PASS
- destructive pilot blocked before provider execution: PASS
- payment pilot blocked/planned before provider execution: PASS
- audit views generated from pilot execution summaries: PASS
- regression snapshots generated: PASS
- canaries do not leak:
  - `sf_pilot_cookie_secret_123`: PASS
  - `sf_pilot_private_form_secret_456`: PASS
  - `sf_pilot_payment_secret_789`: PASS
  - `sf_pilot_destructive_secret_000`: PASS

## Acceptance Commands

- `node --test tests/node/first-party-site-package-pilot-v1.test.mjs`: PASS, 14 tests passed.
- `node --test tests/node/siteforge-runtime-productization-e2e-v1.test.mjs`: PASS, 5 tests passed.
- `node --test tests/node/capability-package-site-adapter-registry-v1.test.mjs`: PASS, 18 tests passed.
- `node --test tests/node/skill-runtime-invocation-api-v1.test.mjs`: PASS, 15 tests passed.
- `npm run check:syntax`: PASS, 696 files checked.
- `npm run scan:secrets`: PASS, 791 candidate files scanned.
- `git diff --check`: PASS.

## Checkpoint

- result: PASS
- next phase: Phase 27 CI / Release Gate Integration may start.
