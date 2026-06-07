# Release Candidate Product Integration V1

Date: 2026-06-07
PR: https://github.com/yuetongli-PL/SiteForge/pull/8

## Summary

Release Candidate Product Integration V1 promotes the accepted Runtime Extensibility & Productization work through release-candidate hardening, developer documentation, local Skill Runtime wrapper, first-party package pilots, release gates, runtime operations tooling, production session vault adapter planning, controlled destructive lab simulation, and payment authorization threat-model/lab coverage.

The branch is split into focused commits for capability registries, policy packs, compiler hardening, provider SDK/sandboxing, run store/regression tooling, Skill invocation, destructive/payment planning labs, session vault adapter boundaries, first-party package pilots, runtime operations CLI, release gates, runtime wiring, and release records.

## User Impact

- Providers now have SDK validation, conformance checks, sandbox boundary documentation, and production registration safeguards.
- Skill invocation supports dry-run previews, idempotency, package ref resolution, and local service wrapping without exposing a public network service.
- Runtime run-store, audit query, audit viewer, and regression comparison surfaces provide read-only operational inspection.
- First-party site package fixtures exercise public read, download, controlled form, auth read, auth browser write, destructive-blocked, and payment-blocked paths.
- CI-facing release gates now run runtime trust, productization, regression, secret scan, and diff whitespace checks.

## Security Boundary

- No automatic login was added.
- No arbitrary authenticated browsing was added.
- No payment execution was added.
- No production destructive execution was added.
- No production payment or destructive executable provider was added.
- No raw auth/session/browser/private/payment/destructive material persistence was added.
- Natural language task text remains non-authorizing.
- Testing/raw helper exports remain outside the production runtime facade.

## Verification

Local branch verification:

- `npm run verify:release`: PASS.
  - runtime trust: 63 tests passed.
  - runtime productization: 88 tests passed.
  - runtime regression: 25 tests passed.
  - secret scan: 823 candidate files scanned.
  - diff whitespace check: PASS.

Clean checkout verification from remote PR branch:

- checkout: `codex/release-candidate-product-integration-v1` from GitHub.
- dependency install: `npm install`: PASS, 0 vulnerabilities.
- `npm run verify:release`: PASS.
  - runtime trust: 63 tests passed.
  - runtime productization: 88 tests passed.
  - runtime regression: 25 tests passed.
  - secret scan: 824 candidate files scanned after local dependency install.
  - diff whitespace check: PASS.

## Review Notes

- PR opened as draft first so clean checkout verification and this release note could land before review.
- GitHub CLI was unavailable in the local PATH, so the PR was created with the GitHub connector after a normal `git push`.
- The clean checkout produced an untracked local `package-lock.json` after `npm install`; it was not committed.
