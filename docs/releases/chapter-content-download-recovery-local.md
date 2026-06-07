# Chapter Content Download Recovery Local Release Note

## Status

- Result: PASS WITH NOTES
- Scope: local-only follow-up commits on `main`, not pushed to GitHub.
- Base: `952a707` (`origin/main`, PR #8 merge)
- Commits reviewed:
  - `632dc83 fix(pipeline): tighten chapter content capability modeling`
  - `81d1b5d feat(pipeline): generalize chapter content download recovery`

## Release Summary

This local update tightens chapter-content capability modeling while keeping public
download execution descriptor-only until an explicit governed runtime task is
selected. It also generalizes chapter-content download recovery away from a
single bundled site record, supports known-policy rendered recovery for public
route templates, preserves authorized-source sanitized summaries when public
robots rules block generic crawling, and exposes documented headless rendering
flags in the build CLI.

The update removes `www.22biqu.com` from stable bundled registry/capability
config and from site-specific adapter/domain allowlists. Chapter-content support
remains available through generic known-policy metadata and the shared
chapter-content downloader descriptor.

## Explicitly Not Included

- No GitHub push.
- No GitHub PR creation.
- No automatic login.
- No arbitrary authenticated browsing.
- No payment execution.
- No production destructive execution.
- No raw auth/session/browser/private/payment/destructive material persistence.
- No production registry addition for payment or destructive executable providers.

## Review Notes

- Capability labels: prose-like public labels remain evidence, not generated
  capability names.
- Read-only routes and search forms do not become write/action capabilities.
- Chapter-content coverage suppresses noisy per-route/per-element capabilities
  in favor of aggregate chapter-content capabilities.
- Known public route policies can recover from synthetic setup fallback only
  through sanitized public rendered structure evidence.
- Authorized source structure summaries are not generic crawl bypasses and are
  not discarded by public robots filtering, because they are user-provided
  sanitized summaries rather than fetched public pages.
- Runtime task dispatch can match structured intents and bounded natural
  language download-book requests to descriptor-only known-site downloader
  contracts.
- Book crawler fallback now prefers inline directory chapters before
  latest-chapter backtracking.

## Validation

Main worktree validation:

- `node --test tests/node/build-cli-values.test.mjs tests/node/cli-compat.test.mjs tests/node/progress-cli-integration.test.mjs tests/node/normalize.test.mjs tests/node/site-adapter-contract.test.mjs tests/node/site-registry.test.mjs tests/node/site-capability-graph-generated-fixture.test.mjs tests/node/site-recompile-preview-summary.test.mjs tests/node/siteforge-empty-dynamic-diagnostics.test.mjs tests/node/siteforge-output-validation.test.mjs tests/node/architecture-import-rules.test.mjs`: PASS
- `python -m unittest tests.python.test_download_book tests.python.test_site_context`: PASS
- `npm run check:syntax`: PASS
- `npm run typecheck`: PASS
- `npm run scan:secrets`: PASS
- `git diff --check`: PASS
- `npm run test:pipeline`: PASS, 332 pass, 1 optional live skip

Clean worktree validation at detached `81d1b5d`:

- Path: `%TEMP%\siteforge-clean-local-81d1b5d`
- `npm run check:syntax`: PASS
- `npm run typecheck`: PASS
- `npm run scan:secrets`: PASS
- `git diff --check`: PASS
- `npm run test:pipeline`: PASS, 332 pass, 1 optional live skip
- `npm run test:capability`: PASS, 93 pass
- `npm run test:python`: PASS, 62 pass
- `npm run readme:check`: PASS

Clean worktree validation rerun for basename-sensitive core tests:

- Path: `%TEMP%\siteforge-clean-local-81d1b5d-root\SiteForge`
- `npm run test:core`: PASS, 217 pass

Note: `npm run test:core` was first run in a temporary directory whose basename
was not `SiteForge`; the only failure was the repo-root basename assertion in
`tests/node/src-architecture-layout.test.mjs`. The same command passed in a
clean worktree whose checkout directory was named `SiteForge`.

## Local PR Review

Review stance: PASS WITH NOTES for local-only integration.

- Architecture boundary: PASS. Core/domain boundary tests and import rules pass.
- Security boundary: PASS. Secret scan and raw-material guard coverage pass.
- Runtime semantics: PASS. Payment/destructive execution remains blocked by
  existing conformance coverage; downloader execution remains descriptor-based
  until governed runtime dispatch.
- Site registry boundary: PASS. Stable config no longer carries the removed
  `www.22biqu.com` bundled record, while generic chapter-content policy and
  downloader descriptor coverage remain tested.
- Documentation/release readiness: PASS WITH NOTES. This record is local only
  because the user explicitly requested not to push to GitHub `main`.

