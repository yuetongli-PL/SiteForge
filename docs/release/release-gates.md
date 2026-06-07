# SiteForge Release Gates

## Commands

Release-candidate productization uses these local and CI-facing commands:

- `npm run test:runtime-trust`
- `npm run test:runtime-productization`
- `npm run test:regression`
- `npm run verify:release`
- `npm run scan:secrets`
- `git diff --check`

`npm run verify:release` runs the runtime trust, runtime productization, runtime regression, secret scan, and diff whitespace gates. `npm run release:local` keeps the existing README, typecheck, syntax, focused Node, full Node, Python, secret scan, and diff checks, and also includes `npm run verify:release`.

## Runtime Trust Gate

The runtime trust group covers capability contract conformance, capability packages, package diff behavior, policy simulation, audit query, provider SDK conformance, and runtime index export boundaries.

This gate blocks:

- `runtime/index.mjs` exporting mock, fake, testing, fixture, or raw-material helpers.
- raw material canary leakage in package, audit, policy, regression, or runtime outputs.
- production payment or destructive providers registered by default.
- CLI or release commands defaulting to session, browser, vault, or raw material injection.

## Productization Gate

The productization group covers the compile-package-skill-runtime-audit E2E path, local Skill Runtime service wrapper, first-party site pilot packages, Skill Runtime Invocation, run-store operations, provider sandbox boundary, and documentation regression tests.

This gate confirms:

- `dryRun` does not execute providers.
- public read and download paths stay bounded and sanitized.
- auth read uses safe session metadata only.
- controlled browser write keeps guards before material use.
- payment and destructive pilots remain blocked before provider execution.
- run store, audit view, audit query, and regression surfaces remain inspect-only.

## Regression Gate

The runtime regression gate fails closed on high-risk drift, including:

- `sideEffectAttempted` changing from `false` to `true`.
- `blocked` changing to `completed`.
- payment or destructive blocked cases invoking a provider.
- payment or destructive blocked reasons changing.
- auth scope widening.
- allowed origin widening.
- policy deny or blocked decisions becoming allow.
- unexpected provider id changes.
- stable reason renames.

Medium and low drift still appears in regression reports for review. High or critical drift blocks release.

## Optional Live Smoke

Optional live smoke is not part of default CI or `npm run verify:release`.

The opt-in switch is `SITEFORGE_OPTIONAL_LIVE_SMOKE=1` or `SITEFORGE_OPTIONAL_LIVE_SMOKE=true`. A future live smoke command must remain explicitly opt-in and must not become part of the default release gate.

## GitHub Actions

The repository workflow runs `npm run release:local`, which includes `npm run verify:release`. The release gate therefore runs on pull requests and pushes to `main` through the existing workflow path.
