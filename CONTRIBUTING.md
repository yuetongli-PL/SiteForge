# Contributing

This repository is local-first automation infrastructure. Keep changes scoped,
auditable, and safe to publish.

## Before a Commit

Review scope before staging:

- Run `git status --short`.
- Split unrelated work into separate commits where possible.
- Confirm deleted files are intentional.
- Keep local runtime outputs out of Git.

Run the focused checks that match the touched area. For broad Site Capability
Layer or downloader/session changes, use:

```powershell
node --test tests\node\site-capability-matrix.test.mjs
node --test tests\node\site-adapter-contract.test.mjs tests\node\site-onboarding-discovery.test.mjs
node --test tests\node\site-health-recovery.test.mjs tests\node\site-health-execution-gate.test.mjs
node --test tests\node\downloads-runner.test.mjs tests\node\planner-policy-handoff.test.mjs
node tools\prepublish-secret-scan.mjs
git diff --check
```

## Release And Versioning Policy

Release scope is the set of source, tests, config, schema, repo-local skills,
tools, and root-document edits that directly belong to the current batch.
Before staging, re-run `git status --short --branch --untracked-files=all` and
separate unrelated dirty work from the release report. Local runtime outputs,
browser profile material, downloaded media, logs, generated run artifacts, raw
session material, and unrelated dirty files are excluded from release scope.

Contract versions are governed by compatibility evidence. Additive compatible
fields keep the current schema or artifact version and must preserve existing
compatibility tests. Incompatible persisted or public contract changes require
an explicit version bump, schema inventory or compatibility registry updates,
migration or rejection tests, matrix evidence, and Agent B acceptance before a
status or release claim is promoted.

Passing local validation does not imply a tag, package version bump, push, PR,
publication, live capability claim, or live authenticated validation. Those
actions require an explicit operator request. Release-sized changes must rerun
the broad Node/Python checks, `node tools\prepublish-secret-scan.mjs`, and
`git diff --check`; live claims additionally require explicit approval,
bounded scope, stop conditions, and sanitized artifacts.

## Safety Boundaries

- Do not commit raw credentials, cookies, CSRF values, authorization headers,
  SESSDATA, tokens, session ids, browser profiles, or equivalent session
  material.
- Do not implement CAPTCHA bypass, MFA bypass, platform-risk bypass,
  access-control bypass, credential extraction, or silent privilege expansion.
- Keep site-specific interpretation in SiteAdapter code.
- Keep reusable mechanisms in capability services.
- Keep downloader code as a low-permission consumer of governed tasks,
  policies, minimal session views, and resolved resources.

## Runtime Artifacts

`runs/`, `book-content/`, `.playwright-mcp/`, caches, logs, and downloaded media
are local runtime artifacts. They should not be committed.

`profiles/*.json` files in this repo are site capability/profile configuration
sources. They must stay free of browser profile paths and session material.

## Documentation Source Of Truth

The repository-level `docs/` directory is retired except for explicit,
goal-scoped acceptance artifacts requested by an operator, such as
`docs/site-capability-compiler-executor/`. Keep durable project guidance in
these root documents:

- `README.md`: public overview, supported workflows, source layout, and common commands.
- `AGENTS.md`: repo-local execution rules for Codex and A/B loop work.
- `CONTRIBUTING.md`: contributor checks, safety gates, operational runbooks, Site Capability Layer matrix, and focused regression batch definition.

Short-lived handoff reports, one-off release notes, dated validation snapshots,
and status tables should be folded into one of those sources or deleted.

## Site Capability Compiler / Executor Status

The current Site Capability Compiler / Executor implementation lives in:

- `src/sites/capability/compiler/`
- `src/sites/capability/execution/`
- `src/entrypoints/sites/site-capability-compile.mjs`
- `tests/node/site-capability-compiler-executor/`

Current optimized scope: config-backed compile loading from repo-local
`config/site-registry.json` and `config/site-capabilities.json` with repo-local
path guards, source digest and incremental compile summaries, manifest digest
governance, descriptor-only Graph emission with redacted compiler provenance,
Planner dry-run consumption of validated compiler-built Graphs,
`ExecutionPolicyDecision` preflight, redacted `CoverageDelta` artifact queue
preparation, and optional compiler artifact writes guarded by SecurityGuard /
Redaction.

Focused validation:

```powershell
node --test tests\node\site-capability-compiler-executor\*.test.mjs
node --test tests\node\progress-cli-integration.test.mjs
node tools\prepublish-secret-scan.mjs
git diff --check -- docs\site-capability-compiler-executor src\sites\capability\compiler src\sites\capability\execution src\entrypoints\sites\site-capability-compile.mjs tests\node\site-capability-compiler-executor CONTRIBUTING.md
```

Safety boundaries remain unchanged: the compiler only consumes repo-local
descriptors or redacted artifacts, Planner only consumes validated Graphs, and
execution descriptors do not invoke downloader, SiteAdapter, SessionView,
browser runtime, external telemetry, or live site access.

## Root Compatibility Migration

Do not recreate retired root shims. Use canonical locations:

- Pipeline CLI: `src/entrypoints/pipeline/run-pipeline.mjs`,
  `src/entrypoints/pipeline/generate-skill.mjs`, and
  `src/entrypoints/pipeline/generate-crawler-script.mjs`.
- Public CLI facade: `src/entrypoints/cli.mjs`.
- Compatibility site entrypoints remain under `src/entrypoints/sites/` and
  `scripts/`, but new documentation and generated commands should route
  through `node .\src\entrypoints\cli.mjs ...`.
- Python entrypoints: `src/sites/**/python/*.py`.
- Metadata: `config/site-registry.json` and `config/site-capabilities.json`.

If a caller still depends on old root paths such as `run-pipeline.mjs`,
`download_book.py`, `site-registry.json`, or `site-capabilities.json`, migrate
that caller instead of adding compatibility back.

## CLI Progress Feedback

Primary long-running Node CLI tasks use `src/infra/cli/progress.mjs` and centralized
copy in `src/infra/cli/progress-copy.mjs`. The renderer is site-agnostic and
supports task, stage, subtask, current item, artifacts, warnings, failures,
download bytes, speed, ETA, retries, skipped-existing counts, and verified
counts.

Rules for new CLI tasks:

- Keep stdout machine-readable when the entrypoint returns JSON. Human progress
  goes to stderr.
- `--json` suppresses human progress and must not mix text into stdout.
- `--quiet` suppresses human progress.
- `--progress auto|interactive|plain`, `--force-tty`, and `--no-tty` are the
  supported control flags.
- Interactive mode may use ANSI refresh, Unicode icons, spinner frames,
  progress bars, percent, ETA, and speed.
- Plain mode must be stable line-by-line text with no cursor control, no
  animation frames, and no color by default.
- `build` defaults to a human-readable package-manager-style progress panel and
  summary. It must not dump raw JSON unless `--json` or `--debug` explicitly
  requests diagnostics.
- Build-specific modes are `--verbose`, `--debug`, `--no-color`, `--ascii`, and
  `--compact`. Keep these flags local to build unless another CLI has a matching
  UX need and tests.
- Non-TTY confirmation and selection APIs must not block; they return defaults
  or throw a clear non-TTY error.
- Failure output must include task, stage, reason, safe-stop text, next action,
  and report path when available.
- Never print raw credentials, cookies, CSRF values, authorization headers,
  SESSDATA, tokens, session ids, browser profile roots, user data directories,
  or equivalent sensitive material.
- CAPTCHA, MFA, platform risk, rate limits, permission checks, and
  access-control pages are manual safety boundaries. Progress messages must
  report a safe stop, not bypass behavior.

Current progress-enabled entrypoints:

```powershell
node .\src\entrypoints\pipeline\run-pipeline.mjs <url> [--json|--quiet|--progress plain]
node .\src\entrypoints\pipeline\generate-skill.mjs <url> [--json|--quiet|--progress plain]
node .\src\entrypoints\pipeline\capture.mjs <url> [--json|--quiet|--progress plain]
node .\src\entrypoints\pipeline\expand-states.mjs <url> --initial-manifest <path> [--json|--quiet|--progress plain]
node .\src\entrypoints\pipeline\collect-book-content.mjs <url> [--json|--quiet|--progress plain]
node .\src\entrypoints\pipeline\analyze-states.mjs <url> --expanded-dir <dir> [--json|--quiet|--progress plain]
node .\src\entrypoints\pipeline\abstract-interactions.mjs <url> --analysis-dir <dir> [--json|--quiet|--progress plain]
node .\src\entrypoints\pipeline\nl-entry.mjs <url> --abstraction-dir <dir> [--json|--quiet|--progress plain]
node .\src\entrypoints\pipeline\generate-docs.mjs <url> --nl-entry-dir <dir> [--json|--quiet|--progress plain]
node .\src\entrypoints\pipeline\govern-interactions.mjs <url> --docs-dir <dir> [--json|--quiet|--progress plain]
node .\src\entrypoints\pipeline\compile-wiki.mjs compile <url> [--json|--quiet|--progress plain]
node .\src\entrypoints\pipeline\compile-wiki.mjs lint --kb-dir <dir> [--json|--quiet|--progress plain]
node .\src\entrypoints\pipeline\generate-crawler-script.mjs <url> [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs download plan <target> --site <site> [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs download execute <target> --site <site> [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs site doctor <url> [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs site login <url> [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs site keepalive <url> [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs site nl-login "<request>" [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs session health --site <site> [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs site repair-plan --site <site> [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs bilibili action <action> ... [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs douyin action <action> ... [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs xiaohongshu action <action> ... [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs catalog jable-ranking <url> --query <text> [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs catalog jp-av-release --start <date> --end <date> [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs catalog moodyz-month --month <YYYY-MM> [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs site credentials <set|show|delete> <url> [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs site scaffold <url> --archetype <type> [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs bilibili open <url> [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs bilibili extract-links <url> [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs social auth-import --site <site> [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs douyin export-cookies [url] [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs x action <action> ... [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs instagram action <action> ... [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs douyin follow [url] [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs douyin resolve-media <url...> [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs social live-verify --live --site <site> [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs social kb-refresh [--execute] [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs social resume --state <path> [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs social report [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs social dashboard [--quiet|--progress plain]
node .\src\entrypoints\cli.mjs social auth-recover [--execute] [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs social health-watch [--execute] [--json|--quiet|--progress plain]
node .\src\entrypoints\cli.mjs social templates [--json|--quiet|--progress plain]
```

Jable download routing is experimental placeholder coverage only. `download plan|execute --site jable --task-type video` must stop with `jable-native-resolver-required` until a safety-reviewed native resolver exists; do not parse Jable player pages, raw media URLs, CDN URLs, manifests, sessions, or browser profiles.

Focused tests:

```powershell
node --test tests\node\progress-renderer.test.mjs tests\node\progress-cli-integration.test.mjs
```

Wrapper scripts under `scripts/` and thin src entrypoints may stay progress-free
when they only forward to a progress-enabled canonical module. Remaining
specialized candidates should be migrated by runtime value, not mechanically.
Social helper scripts that operators run directly, including
`social-auth-recover.mjs`, `social-health-watch.mjs`, and
`social-command-templates.mjs`, now share the renderer and keep `--json`
machine-readable.

## New Site Onboarding

URL-Only New-Site Intake Contract: a bare URL is full onboarding by default.

A user-provided new site URL is full onboarding by default, not a request to
only draft a skill or profile. Complete or explicitly block these items before
calling the site onboarded:

- profile, registry, capability record, SiteAdapter mapping, and repo-local skill;
- safe `site-doctor` discovery or a clearly labeled simulation;
- `NODE_INVENTORY`, `API_INVENTORY`, `UNKNOWN_NODE_REPORT`,
  `BLOCKED_NODE_REPORT`, `UNKNOWN_API_REPORT`, `BLOCKED_API_REPORT`,
  `CAPABILITY_TARGETS`, `CAPABILITY_GAP_REPORT`, `SITE_CAPABILITY_REPORT`,
  and `DISCOVERY_AUDIT`;
- `recognized`, `unknown`, or `ignored` classification plus
  `discovered`, `verified`, `observed_only`, `unknown`, `blocked`,
  `skipped_by_budget`, `skipped_by_policy`, `unattempted`, `failed_trigger`,
  `duplicate_trigger`, `requires_login`, `requires_manual_review`,
  `requires_adapter_evidence`, `requires_schema_evidence`, or
  `requires_test_evidence` discovery status for every discovered node/API/capability,
  with reasons for ignored, blocked, skipped, or unverified items;
- coverage gate, site-specific onboarding test, onboarding discovery gate,
  site-doctor artifact gate, SiteAdapter contract test, matrix test, and
  Agent B acceptance or requested reviewer acceptance.

Do not silently skip login walls, paywalls, VIP access, CAPTCHA, risk-control,
permission checks, rate limits, recovery entries, or manual-risk states. Record
them as inventory entries, unknowns, ignored-with-reason items, or blocked
surfaces. Onboarding never includes paid/VIP chapter reading, CAPTCHA bypass,
anti-bot bypass, access-control bypass, credential extraction, or silent
privilege expansion.

## Manual Health Recovery Boundaries

`profile-health-risk` and equivalent social/authenticated profile risks are
manual safety boundaries for X, Instagram, and authenticated Bilibili surfaces.

- Do not delete, rebuild, or mutate a browser profile automatically.
- Do not bypass CAPTCHA.
- Do not extract or persist raw cookies.
- Keep `profile-health-risk` blocked until a human repairs and verifies the
  profile in a visible browser.

Useful manual verification commands:

```powershell
node .\src\entrypoints\cli.mjs social health-watch --site x
node .\src\entrypoints\cli.mjs social health-watch --site instagram
node .\src\entrypoints\cli.mjs bilibili action login https://www.bilibili.com/
```

## Skill Source And Install Sync

Repo-local `skills/*/SKILL.md` files are the source of truth. Work only inside
this project directory unless the user explicitly asks to install or sync
skills into Codex.

Tracked core skill sources include:

- `skills/bilibili/SKILL.md`
- `skills/xiaohongshu-explore/SKILL.md`
- `skills/x/SKILL.md`
- `skills/instagram/SKILL.md`

Manual sync command, when explicitly allowed:

```powershell
Remove-Item C:\Users\lyt-p\.codex\skills\<skill-name> -Recurse -Force
Copy-Item .\skills\<skill-name> C:\Users\lyt-p\.codex\skills\<skill-name> -Recurse -Force
```
## Site Capability Layer Design Contract

The Site Capability Layer is a multi-site capability architecture, not a site-specific runtime. Kernel/orchestrator owns lifecycle, context, artifact routing, common safety, schema governance, lifecycle events, and reason semantics. Capability Services own reusable mechanisms such as DOM discovery, accessibility/interaction discovery, network capture, node inventory, API discovery, coverage analysis, unknown-node reporting, security/redaction, session views, risk state, policy handoff, artifact schema, and capability hooks. SiteAdapter owns site identity, URL classification, node/API interpretation, pagination rules, login-state rules, health-signal mapping, field normalization, and capability mapping. The downloader remains a low-permission consumer of StandardTaskList, DownloadPolicy, minimal SessionView, and resolved resources.

Non-goals remain explicit: no CAPTCHA bypass, MFA bypass, anti-bot bypass, access-control bypass, credential extraction, platform-risk evasion, silent privilege expansion, raw cookie persistence, raw CSRF persistence, authorization header persistence, SESSDATA/token/session id persistence, or browser profile persistence.

## Site Capability Layer Implementation Matrix

This compact matrix is the durable Site Capability Layer progress ledger. Short-lived handoffs, status tables, runbooks, and dated validation reports have been folded into `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, or this CONTRIBUTING.md section.

### 1. Kernel orchestration
- Section name: Kernel orchestration
- Requirement summary: Keep orchestration site-agnostic while routing common lifecycle, schema, safety, and reason semantics.
- Current status: `verified`
- Existing code evidence: `src/kernel/`, `src/pipeline/engine/engine.mjs`, `src/pipeline/runtime/create-default-runtime.mjs`, and `src/sites/capability/*` keep Kernel coordination separate from SiteAdapter interpretation.
- Existing test evidence: `tests/node/site-capability-kernel-contract.test.mjs`, `tests/node/layer-boundaries.test.mjs`, and `tests/node/architecture-import-rules.test.mjs`.
- Verification command: `node --test tests\node\site-capability-kernel-contract.test.mjs tests\node\layer-boundaries.test.mjs tests\node\architecture-import-rules.test.mjs`
- Verification result: Focused Kernel gate passed in the current validation set.
- Current gaps: No current blocker for the documented Kernel boundary.
- Next smallest task: Keep future site-specific routing out of Kernel modules.
- Risk notes: Treat any direct concrete-site import into Kernel as a release blocker.
- Last updated: 2026-05-04T13:45:00+08:00

### 2. Capability service inventory
- Section name: Capability service inventory
- Requirement summary: Keep reusable cross-site discovery, inventory, API, health, policy, redaction, and coverage mechanisms in Capability Services.
- Current status: `verified`
- Existing code evidence: `src/sites/capability/site-onboarding-discovery.mjs`, `api-discovery.mjs`, `api-candidates.mjs`, `service-inventory.mjs`, `security-guard.mjs`, `site-health-recovery.mjs`, and `site-health-execution-gate.mjs`. 2026-05-10 discovery hardening adds 90-point target taxonomy plus `FullDiscoveryMode` / `ExhaustiveDiscoveryMode` artifacts for controlled-scope node/API/capability discovery, blocked surfaces, unknowns, and capability gaps while keeping evidence scores separate from architecture readiness.
- Existing test evidence: `tests/node/service-inventory.test.mjs`, `tests/node/site-onboarding-discovery.test.mjs`, `tests/node/api-discovery.test.mjs`, and health recovery focused tests.
- Verification command: `node --test tests\node\service-inventory.test.mjs tests\node\site-onboarding-discovery.test.mjs tests\node\api-discovery.test.mjs tests\node\site-health-recovery.test.mjs`
- Verification result: Focused Capability Service gate passed in the current validation set; 2026-05-10 FullDiscovery focused gates passed for `site-onboarding-discovery` 19/19, `site-onboarding` 28/28, `api-discovery` 20/20, and `security-guard-redaction` 13/13.
- Current gaps: No current blocker for the shared service inventory.
- Next smallest task: Add new reusable services only when a runtime path or contract test consumes them.
- Risk notes: Do not move SiteAdapter interpretation or downloader execution into Capability Services.
- Last updated: 2026-05-10T00:00:00+08:00

### 3. SiteAdapter registry and contracts
- Section name: SiteAdapter registry and contracts
- Requirement summary: Keep site identity, URL family checks, routing, semantic interpretation, health signal mapping, and capability declarations in SiteAdapter implementations.
- Current status: `verified`
- Existing code evidence: `src/sites/core/adapters/factory.mjs`, `resolver.mjs`, `generic-navigation.mjs`, `jp-av-catalog.mjs`, `src/sites/jp-av-catalog/queries/release-catalog.mjs`, and concrete adapters for 22biqu, Bilibili, Douyin, X, Instagram, Xiaohongshu, Jable, Moodyz, Qidian, and AV catalog sites.
- Existing test evidence: `tests/node/site-adapter-contract.test.mjs`, `tests/node/qidian-site.test.mjs`, `tests/node/batch1-av-sites.test.mjs` through `tests/node/batch3-av-sites.test.mjs`, and `tests/node/jp-av-release-catalog.test.mjs`.
- Verification command: `node --test tests\node\site-adapter-contract.test.mjs tests\node\qidian-site.test.mjs tests\node\batch1-av-sites.test.mjs tests\node\batch2-av-sites.test.mjs tests\node\batch3-av-sites.test.mjs tests\node\jp-av-release-catalog.test.mjs`
- Verification result: Focused SiteAdapter/release-catalog gate passed in the current validation set. JP AV release aggregation now covers same-structure `/works/date` sites plus DAHLIA `/work/`, T-Powers `/release/`, KM Produce `/works?archive=...`, and MAXING EUC-JP public shop/top lists while keeping 8MAN/SOD/DOGMA as explicit skipped/blocked coverage.
- Current gaps: Additional live producer fixtures remain incremental hardening.
- Next smallest task: Add site-specific producer recognition only through adapters.
- Risk notes: Do not put concrete site semantics in Kernel or downloader.
- Last updated: 2026-05-04T13:58:00+08:00

### 4. Reason semantics
- Section name: Reason semantics
- Requirement summary: Use unified reasonCode semantics for unsupported URLs, parse failures, missing fields, auth, access gates, rate limits, policy blocks, downloader boundaries, and schema failures.
- Current status: `verified`
- Existing code evidence: `src/sites/capability/reason-codes.mjs` defines the governed catalog and health/download/API/onboarding reason families, including `blocked-by-cloudflare-challenge` for public request challenge stop boundaries and `jable-native-resolver-required` for the Jable experimental download placeholder.
- Existing test evidence: `tests/node/reason-codes.test.mjs`, adapter failure-path tests, and download/session runner tests.
- Verification command: `node --test tests\node\reason-codes.test.mjs tests\node\site-adapter-contract.test.mjs tests\node\downloads-runner.test.mjs`
- Verification result: Reason semantics focused gate passed in the current validation set; `blocked-by-cloudflare-challenge` now carries cooldown, isolation, manual recovery, degradable, and artifact-write semantics. Jable placeholder routing records `jable-native-resolver-required` as a degradable download reason without claiming resource resolution. Current Jable/download/audit focused gate passed 157/157, and reason/download-policy focused gate passed 14/14.
- Current gaps: Keep adding reason codes with tests when new failure modes become runtime-visible.
- Next smallest task: Reject ad hoc string-only failure semantics in new modules.
- Risk notes: Unknown or unsafe failure states must fail closed and remain auditable.
- Last updated: 2026-05-04T14:29:17+08:00

### 5. Risk and health recovery
- Section name: Risk and health recovery
- Requirement summary: Normalize site-specific health signals into generic SiteHealthRisk and CapabilityHealthRisk outcomes, then recover, degrade, quarantine, or stop through the generic engine.
- Current status: `verified`
- Existing code evidence: `src/sites/capability/site-health-recovery.mjs`, `site-health-execution-gate.mjs`, `risk-state.mjs`, adapter health signal maps, and profile lifecycle classification.
- Existing test evidence: `tests/node/site-health-recovery.test.mjs`, `tests/node/site-health-execution-gate.test.mjs`, `tests/node/site-health-recovery-execution-gate.test.mjs`, and `tests/node/site-health-recovery-runtime-integration.test.mjs`.
- Verification command: `node --test tests\node\site-health-recovery.test.mjs tests\node\site-health-execution-gate.test.mjs tests\node\site-health-recovery-execution-gate.test.mjs tests\node\site-health-recovery-runtime-integration.test.mjs`
- Verification result: Health recovery focused gate passed; `profile-health-risk` remains a generic `platform-risk-detected` style manual boundary rather than an X-only branch.
- Current gaps: Full live social account recovery still requires explicit operator approval and visible browser validation.
- Next smallest task: Keep capability-level degradation local to affected capabilities.
- Risk notes: Do not bypass CAPTCHA, MFA, platform risk, account restriction, rate limits, permission checks, or access-control boundaries.
- Last updated: 2026-05-04T13:45:00+08:00

### 6. Node discovery and inventory
- Section name: Node discovery and inventory
- Requirement summary: Discover DOM, accessibility, interaction, login-state, permission/risk, restriction, recovery, and manual-risk nodes and classify every item as recognized, unknown, or ignored.
- Current status: `verified`
- Existing code evidence: `src/sites/capability/site-onboarding-discovery.mjs` creates `NODE_INVENTORY`, `UNKNOWN_NODE_REPORT`, `BLOCKED_NODE_REPORT`, `SITE_CAPABILITY_REPORT`, and `DISCOVERY_AUDIT`; it emits `FullDiscoveryMode` / `ExhaustiveDiscoveryMode`, status counts for `discovered`, `verified`, `observed_only`, `unknown`, `blocked`, `skipped_by_budget`, `skipped_by_policy`, `unattempted`, `failed_trigger`, `duplicate_trigger`, `requires_login`, `requires_manual_review`, `requires_adapter_evidence`, `requires_schema_evidence`, and `requires_test_evidence`, plus runtimeEvidence/authSession/sessionHealth/riskRecovery/budget/warning node seeds. `src/sites/capability/site-onboarding-discovery.mjs` now directly ingests capture/expand/site-doctor DOM node summaries and accessibility/a11y node summaries, including `unknownDomNodes`, `blockedDomNodes`, `unknownAccessibilityNodes`, `blockedAccessibilityNodes`, skipped node summaries, and nested a11y children, as bounded redacted node evidence without auto-promoting producer evidence to verified. It also ingests bounded descriptor-only JS route, script route, lazy route, and dynamic import summaries from capture/expand/site-doctor inputs, records unknown/blocked/skipped/unattempted/failed/duplicate JS route surfaces, rejects raw JS source/header/session/profile/sourceMap fields, redacts route/import/chunk query secrets, and keeps all producer route evidence non-executable and unverified. `BrowserSession.getObservedPageDomRouteHints()` now collects href/data-route/link prefetch/script src descriptors plus descriptor-only runtime route hints from `window.location.pathname`, `window.location.hash`, `window.__NEXT_DATA__.page`, Remix location metadata, and allowlisted `window.history.state` route descriptor keys without reading JS source, storage, cookies, headers, form values, raw state objects, or browser profile state; capture persists those hints as redacted observed-only `jsRoutes` / `scriptRoutes`. `src/pipeline/stages/expand.mjs` persists redacted DOM/a11y trigger outcome inventories for candidate, budget-skipped, unattempted, failed, and duplicate triggers before `site-doctor` writes onboarding JSON+Markdown artifacts. Trigger gap node entries now include descriptor-only `followUpStrategy` and `attemptResult` metadata for policy-skipped, budget-skipped, unattempted, failed, and duplicate trigger surfaces so follow-up handling and attempt state are machine-readable without executing retries. Blocked node entries now include descriptor-only `blockedSurfaceClassification` plus `surfaceCategoryCounts` in `BLOCKED_NODE_REPORT`, distinguishing login, paywall/VIP/CAPTCHA/MFA/risk/permission/rate-limit, policy/budget, unattempted, failed, duplicate, and manual-review surfaces with bypass prohibited.
- Existing test evidence: `tests/node/site-onboarding-discovery.test.mjs`, `tests/node/browser-runtime-session.test.mjs`, `tests/node/capture-expand.test.mjs`, `tests/node/site-onboarding.test.mjs`, and site-specific onboarding fixtures.
- Verification command: `node --test tests\node\browser-runtime-session.test.mjs`; `node --test tests\node\capture-expand.test.mjs`; `node --test tests\node\site-onboarding-discovery.test.mjs`; `node --test tests\node\site-capability-matrix.test.mjs`; scoped `git diff --check`; `node tools\prepublish-secret-scan.mjs`
- Verification result: Node discovery focused gate passed with tri-state classification, unknown reporting, blocked report generation, ignore reasons, blocked/skipped/login/manual-review required-item failures, coverage gate enforcement, full-discovery artifact readiness, runtime evidence node seeding, direct DOM/a11y node-summary ingestion, nested a11y child retention, attribute-name filtering, bounded node text, email/IP/account display-name redaction in node reports, generic raw DOM/a11y producer evidence downshifted away from self-verified status, producer-observed evidence staying unverified, descriptor-only JS route/lazy route/dynamic import ingestion, raw JS source/header/session/profile/sourceMap rejection, redacted route/import/chunk query secrets, distinct trigger/route outcome statuses, trigger gap follow-up strategies, trigger attempt results, and blocked surface classifications; 2026-05-10 `browser-runtime-session.test.mjs` passed 13/13 with DOM, runtime, and history-state route hint helper coverage, `capture-expand.test.mjs` passed 28/28 with manifest persistence/redaction for route hints, `site-onboarding-discovery.test.mjs` passed 46/46 with descriptor-only trigger follow-up strategy, attempt-result, blocked surface classification, category counts, bypass-prohibited flags, and unsafe blocked-surface material redaction, `site-capability-matrix.test.mjs` passed 6/6, scoped `git diff --check` passed, and `prepublish-secret-scan` passed across 656 candidate files.
- Current gaps: Actual evidence score still depends on live/governed capture breadth; FullDiscoveryMode records unknown/blocked/skipped/unattempted/failed/duplicate gaps rather than claiming unobserved surfaces do not exist. This section is verified for the current Site Capability Layer contract, but the separate 100-point full-discovery loop is not complete until deeper interaction-trigger expansion and actual governed retry attempts are complete.
- Next smallest task: Add actual governed trigger retry attempt fixtures or API/capability correlation evidence without bypassing policy or saving raw payloads.
- Risk notes: No discovered node may be silently dropped.
- Last updated: 2026-05-10T16:54:00+08:00

### 7. API discovery and catalog lifecycle
- Section name: API discovery and catalog lifecycle
- Requirement summary: Capture observed network/API requests as candidates, verify them explicitly, and keep observed APIs out of the verified catalog until policy and adapter validation pass.
- Current status: `verified`
- Existing code evidence: `src/sites/capability/api-discovery.mjs`, `api-candidates.mjs`, `network-capture.mjs`, `src/infra/browser/session.mjs`, verified evidence producers, catalog writers, and planner handoff. `apiCandidateFromObservedRequest()` now records a redaction-safe `canonicalEndpointKey`, `observedApiAutoPromotionAllowed: false`, transport-aware `endpointKind` / `riskClass`, and target taxonomy fields while redacting endpoint URLs, headers, bodies, and bounded redirect evidence before candidate persistence. Network capture now preserves redacted WebSocket, SSE/EventSource, OPTIONS/preflight, and redirect surfaces as observed-only transport evidence. `BrowserSession.getObservedPageResourceApiHints()` and capture manifest writing add bounded page resource/performance API hints plus descriptor-only DOM hidden API hints from `form[action]` and safe `data-*` endpoint attributes to observed request candidates without submitting forms, replaying requests, reading values/storage/cookies/headers/profiles, or promoting to catalog. API discovery now correlates OPTIONS/preflight candidates with same-path follow-up observed requests via redacted canonical endpoint path keys, and onboarding preserves that correlation in `API_INVENTORY` as observed-only evidence. `API_INVENTORY` now records `requestShapeStatus`, `responseShapeStatus`, redacted `shapeGaps`, streaming `messageShapeStatus`, bounded `messageShape`, redacted `messageShapeGaps`, and descriptor-only `multiStepCorrelation` flow metadata when observed APIs expose safe flow/trigger/sequence/request relationship evidence, so missing or partial API relationship coverage is explicit without replaying requests or promoting to catalog. `SITE_CAPABILITY_REPORT.fullDiscoveryClosure.apiControlledScopeClosure` now machine-checks API artifact presence, observed/unknown/blocked/duplicate/status coverage, shape/message/preflight/multi-step surface accounting, and no Graph/Planner/Layer/downloader promotion for observed APIs.
- Existing test evidence: `tests/node/network-capture.test.mjs`, `tests/node/api-discovery.test.mjs`, `tests/node/api-candidates.test.mjs`, `tests/node/site-onboarding-discovery.test.mjs`, `tests/node/browser-runtime-session.test.mjs`, `tests/node/capture-expand.test.mjs`, and `tests/node/planner-policy-handoff.test.mjs`.
- Verification command: `node --test tests\node\network-capture.test.mjs tests\node\api-discovery.test.mjs`; `node --test tests\node\site-onboarding-discovery.test.mjs`; `node --test tests\node\api-candidates.test.mjs`; `node --test tests\node\site-capability-matrix.test.mjs`
- Verification result: API focused gate passed; observed API candidates are not automatically promoted. 2026-05-10 transport/resource-focused gates passed for `network-capture.test.mjs` 11/11, `browser-runtime-session.test.mjs` 12/12, `capture-expand.test.mjs` 28/28, and `site-onboarding-discovery.test.mjs` 31/31, covering WebSocket/SSE/preflight/redirect observed evidence, SSE capture without blocking network idle, page resource/performance API hints appended to capture `networkRequests`, generated API candidates from those hints, redacted redirect status/url/mimeType only, API inventory `transport` / `resourceType` / `endpointKind` / `riskClass`, bounded request shape summaries, duplicate API endpoint retention, `networkResponseSummaries` status/contentType/headerNames/bodyShape/responseSchemaHash joins without raw samples, UNKNOWN_API_REPORT entries, and no verified catalog promotion. Round 13 preflight-correlation gates passed with `api-discovery.test.mjs` 23/23, `api-candidates.test.mjs` 86/86, and `site-onboarding-discovery.test.mjs` 31/31; correlated preflight/follow-up evidence remains observed-only, unsafe/missing request ids are replaced with safe candidate ids, and catalog promotion stays disabled. Round 16 DOM hidden API hint gates passed with `browser-runtime-session.test.mjs` 13/13, `capture-expand.test.mjs` 28/28, `api-discovery.test.mjs` + `api-candidates.test.mjs` 109/109, and `site-onboarding-discovery.test.mjs` 32/32; form/action and data-* endpoint descriptors are redacted, persisted as observed candidates, and remain catalog-promotion-disabled. Round 19 API shape-gap gates passed with `site-onboarding-discovery.test.mjs` 35/35, covering request/response shape status, reason-coded missing-shape gap rows, descriptor-only shape gap whitelisting, and no raw request/response/header/sample persistence. Round 22 streaming message-shape gates passed with `site-onboarding-discovery.test.mjs` 39/39, covering WebSocket/SSE message shape status, missing stream-message gap rows, bounded message shape summaries, and raw payload/header/sample dropping. Round 26 multi-step API correlation gates passed with `site-onboarding-discovery.test.mjs` 47/47, covering safe flow/trigger/initiator/sequence/previous/next/phase descriptors, observed-only reason codes, `catalogPromotionAllowed:false`, `verifiedCatalogAllowed:false`, `executionPlanAllowed:false`, and raw URL/query/header/body/payload/response/session/profile/IP/executable-ref dropping. Round 29 API controlled-scope closure gate passed with `site-onboarding-discovery.test.mjs` 48/48, covering API closure accounting for observed, unknown, duplicate, shape-gap, stream-message-gap, preflight-correlation, multi-step-correlation, and blocked report surfaces without live-network coverage claims or Graph/Planner/Layer/downloader promotion.
- Current gaps: Verified live API evidence remains site-specific and must be explicitly recorded; actual governed trigger retry evidence and verified API catalog promotion remain separate tasks. The controlled-scope API closure now accounts for current artifact families without treating observed APIs as verified catalog entries.
- Next smallest task: Add capability controlled-scope closure evidence without treating observed DOM/API response descriptors as executable.
- Risk notes: Do not persist raw cookies, authorization headers, CSRF values, tokens, session ids, or browser profile material.
- Last updated: 2026-05-10T17:24:06+08:00

### 8. Artifact redaction and safety
- Section name: Artifact redaction and safety
- Requirement summary: Guard persistent artifact writes with redaction, compatibility checks, and fail-closed behavior.
- Current status: `verified`
- Existing code evidence: `src/sites/capability/security-guard.mjs`, redaction audit writers, downloader/session/capture/API artifact guards, `src/sites/chapter-content/download/python/book.py` OCR access-control image guard plus Cloudflare challenge response classification, and `tools/prepublish-secret-scan.mjs`. The guard now redacts generic `token`, `auth` query params, `x-auth-token`, `x-api-key`, body `auth`, body `token`, and raw body/header fields without treating safe `authRequirement` metadata as credentials.
- Existing test evidence: `tests/node/security-guard-redaction.test.mjs`, `tests/node/capture-manifest-redaction.test.mjs`, `tests/node/trust-boundary.test.mjs`, `tests/python/test_download_book.py`, and prepublish scan.
- Verification command: `node --test tests\node\security-guard-redaction.test.mjs tests\node\capture-manifest-redaction.test.mjs tests\node\trust-boundary.test.mjs`; `python -m unittest .\tests\python\test_download_book.py`
- Verification result: Security/redaction focused gate passed; 2026-05-10 `security-guard-redaction.test.mjs` passed 13/13 with generic token/auth/api-key redaction coverage. `test_download_book.py` passed 11/11 including BZ888 OCR access-control-image rejection, public chapter body image attribute OCR allowance, redacted registry profile fallback, and stable Cloudflare challenge reporting.
- Current gaps: Continue scanning before staging.
- Next smallest task: Add golden redaction tests for new artifact families.
- Risk notes: Raw credentials, cookies, CSRF, Authorization, SESSDATA, tokens, session ids, browser profiles, and equivalent material must not be persisted.
- Last updated: 2026-05-04T14:29:17+08:00

### 9. SessionView and trust boundaries
- Section name: SessionView and trust boundaries
- Requirement summary: Give consumers only minimized session views and governed trust-boundary crossings.
- Current status: `verified`
- Existing code evidence: `src/sites/capability/session-view.mjs`, `trust-boundary.mjs`, session manifest bridge, and downloader session manager.
- Existing test evidence: `tests/node/session-view.test.mjs`, `tests/node/trust-boundary.test.mjs`, and session runner focused tests.
- Verification command: `node --test tests\node\session-view.test.mjs tests\node\trust-boundary.test.mjs tests\node\site-session-runner.test.mjs`
- Verification result: SessionView and trust-boundary focused gate passed; 2026-05-04T13:48:09+08:00 live X auth recovery evidence passed through `scripts/social-auth-recover.mjs --execute --site x --verify`, with `x-session-health` artifact `passed` and `x-auth-doctor` artifact `passed` after scoped auth-doctor dependency and unified session-health handoff fixes.
- Current gaps: Live session evidence remains bounded by explicit operator approval; the non-auth X primary chain `home-search-post-detail-author` still reports an author-link expansion gap and is tracked separately from login-state reuse.
- Next smallest task: Keep new consumers off raw lease/session/profile structures.
- Risk notes: Downloader must remain a low-permission consumer.
- Last updated: 2026-05-04T13:48:09+08:00

### 10. Downloader boundary
- Section name: Downloader boundary
- Requirement summary: Keep downloader behind planned tasks, policies, minimized session views, and resolved resources.
- Current status: `verified`
- Existing code evidence: `src/sites/downloads/contracts.mjs`, `modules.mjs`, `runner.mjs`, `session-manager.mjs`, native resource seed modules, legacy fallback boundaries, `src/sites/downloads/site-modules/jable.mjs` recording experimental no-resource download placeholders, `src/sites/downloads/site-modules/bz888.mjs` routing BZ888 public book downloads to the chapter-content Python downloader without raw session material, and `src/sites/downloads/legacy-executor.mjs` classifying Cloudflare challenge stderr before generic legacy reasons.
- Existing test evidence: `tests/node/downloads-runner.test.mjs`, `tests/node/download-policy.test.mjs`, `tests/node/download-site-modules.test.mjs`, and native resolver tests.
- Verification command: `node --test tests\node\downloads-runner.test.mjs tests\node\download-policy.test.mjs tests\node\download-site-modules.test.mjs`
- Verification result: Download focused gate passed for low-permission planning and dry-run boundaries; focused Node batch passed 172/172; current Jable/download/audit focused gate passed 157/157, and reason/download-policy focused gate passed 14/14; live BZ888 execute for the target catalog produced blocked manifest `runs/downloads/bz888/20260504T062914706Z-bz888-generic-resource/manifest.json` with reason `blocked-by-cloudflare-challenge`, no downloaded files, and no raw session material. After separate human challenge completion in a visible browser, read-only page health showed the target chapter page rendered and the three catalog pages exposed 58 chapter links; this is manual browser evidence only and does not grant downloader raw-cookie or challenge-bypass access.
- Current gaps: Some live native resolver paths remain dependent on current public/session evidence; Jable remains an experimental placeholder that returns `jable-native-resolver-required` with no resources until a safety-reviewed native resolver exists; BZ888 direct downloader/public automation remains blocked by Cloudflare challenge and must stay a governed stop boundary unless a future approved path provides safe, non-sensitive evidence.
- Next smallest task: Remove legacy fallback only after fixture, injected, runner, and live evidence all exist.
- Risk notes: Downloader must not receive raw credentials, raw browser profiles, unredacted session material, or site-specific Kernel logic.
- Last updated: 2026-05-04T15:22:01+08:00

### 11. Planner policy handoff
- Section name: Planner policy handoff
- Requirement summary: Convert verified catalog and policy data into downloader-safe standard task lists without executing downloader/session runtime.
- Current status: `verified`
- Existing code evidence: `src/sites/capability/planner-policy-handoff.mjs`, `standard-task-list.mjs`, `download-policy.mjs`, and `site-health-execution-gate.mjs`.
- Existing test evidence: `tests/node/planner-policy-handoff.test.mjs`, `tests/node/standard-task-list.test.mjs`, and architecture import rules.
- Verification command: `node --test tests\node\planner-policy-handoff.test.mjs tests\node\standard-task-list.test.mjs tests\node\architecture-import-rules.test.mjs`
- Verification result: Planner handoff focused gate passed with no downloader execution or session runtime dependency.
- Current gaps: New task shapes need explicit policy evidence.
- Next smallest task: Add policy fixtures before enabling new executor paths.
- Risk notes: Policy handoff cannot promote observed API candidates or execute recovery.
- Last updated: 2026-05-04T13:45:00+08:00

### 12. Schema governance and versioning
- Section name: Schema governance and versioning
- Requirement summary: Keep Kernel, SiteAdapter, CapabilityService, downloader, and API catalog contracts versioned and compatibility-checked.
- Current status: `verified`
- Existing code evidence: Kernel versioning evidence in lifecycle/schema governance, SiteAdapter version evidence in adapter candidate decisions, CapabilityService version evidence across reasonCode/LifecycleEvent/SessionView/StandardTaskList, downloader version evidence in DownloadRunManifest and DownloadPolicy, and API catalog version evidence in ApiCandidate/ApiCatalog/ApiCatalogIndex.
- Existing test evidence: `tests/node/schema-governance.test.mjs`, `tests/node/schema-inventory.test.mjs`, `tests/node/compatibility-registry.test.mjs`, and version compatibility unit tests.
- Verification command: `node --test tests\node\schema-governance.test.mjs tests\node\schema-inventory.test.mjs tests\node\compatibility-registry.test.mjs`
- Verification result: Schema/version focused gate passed for Kernel version evidence, SiteAdapter version evidence, CapabilityService version evidence, downloader version evidence, and API catalog version evidence.
- Current gaps: New governed schemas must be added to inventory before verified status is claimed.
- Next smallest task: Keep schema inventory synchronized with new public contracts.
- Risk notes: Incompatible or future schema versions must fail closed.
- Last updated: 2026-05-04T13:45:00+08:00

### 13. Lifecycle events and capability hooks
- Section name: Lifecycle events and capability hooks
- Requirement summary: Record safe descriptor-only lifecycle events and capability hook matches without executing hook code.
- Current status: `verified`
- Existing code evidence: `src/sites/capability/lifecycle-events.mjs`, `capability-hook.mjs`, and runtime producers in capture, API, downloader, session, social, and site health modules.
- Existing test evidence: `tests/node/lifecycle-events.test.mjs`, `tests/node/capability-hook.test.mjs`, and architecture import rules.
- Verification command: `node --test tests\node\lifecycle-events.test.mjs tests\node\capability-hook.test.mjs tests\node\architecture-import-rules.test.mjs`
- Verification result: Lifecycle/hook focused gate passed with site health recovery producer inventory aligned to runtime events.
- Current gaps: No current blocker for descriptor-only hook inventory.
- Next smallest task: Add producer descriptors when new lifecycle event types are introduced.
- Risk notes: Hook discovery is descriptor-only; executable dispatch remains disabled.
- Last updated: 2026-05-04T13:45:00+08:00

### 14. Data-flow evidence
- Section name: Data-flow evidence
- Requirement summary: Keep evidence from capture, discovery, API, planner, downloader, and skill generation auditable without leaking sensitive data.
- Current status: `verified`
- Existing code evidence: `src/sites/capability/data-flow-evidence.mjs`, capture/expand producer integration, API candidate artifacts, and site-doctor onboarding artifacts, including FullDiscoveryMode UNKNOWN/BLOCKED/GAP artifact families. Capability target and gap artifacts now include per-required-evidence gap details and descriptor-only `evidenceCompletionStrategy` metadata for adapter/schema/test/policy quorum so unverified capability surfaces remain machine-auditable without being promoted to executable capabilities. Static SiteAdapter capability evidence arrays and fixture-backed `capabilityEvidenceFixtures` can feed CAPABILITY_TARGETS and DISCOVERY_SCORECARD as redacted adapter/schema/test/policy evidence without invoking adapter methods or executing site behavior. Observed API response shape evidence now maps into capability targets as non-quorum `api-response-evidence` descriptors with bounded field hints, source API ids, and non-executable mapping metadata. `SITE_CAPABILITY_REPORT` and `DISCOVERY_AUDIT` now include controlled-scope full-discovery closure evidence plus API/capability sub-closures that account for artifact families, unknowns, blocked surfaces, capability gaps, adapter/schema/test/policy quorum state, and no-promotion/no-bypass invariants without claiming live full-web crawl coverage.
- Existing test evidence: `tests/node/site-capability-data-flow.test.mjs`, `tests/node/capture-expand.test.mjs`, `tests/node/site-onboarding.test.mjs`, and `tests/node/site-onboarding-discovery.test.mjs`.
- Verification command: `node --test tests\node\site-onboarding-discovery.test.mjs`; `node --test tests\node\site-onboarding.test.mjs`; `node --test tests\node\site-capability-matrix.test.mjs`; scoped `git diff --check`; `node tools\prepublish-secret-scan.mjs`
- Verification result: Data-flow focused gate passed in the current validation set; 2026-05-10 Round 15 capability gap evidence gates passed with `site-onboarding-discovery.test.mjs` 32/32 and `site-onboarding.test.mjs` 28/28, covering per-evidence adapter/schema/test/policy gap rows, requested-capability `required` state, redacted unsafe requested capability targets, and no observed-to-executable promotion. Round 18 static adapter capability evidence gates passed with `site-onboarding-discovery.test.mjs` 34/34 and `site-onboarding.test.mjs` 28/28, covering adapter/schema/test/policy evidence quorum from static adapter metadata, partial-evidence quorum gaps, and redacted evidence refs. Round 21 capability completion-strategy gates passed with `site-onboarding-discovery.test.mjs` 37/37, covering missing-evidence next-action metadata, missing verified-claim gaps, unsafe target redaction, and no auto-promotion. Round 24 fixture-backed capability evidence gates passed with `site-onboarding-discovery.test.mjs` 45/45, covering explicit verified adapter/schema/test/policy fixture quorum, verified-only exact-kind executable quorum, non-executable mixed or unverified fixture claims, compound-kind rejection, and unsafe fixture ref redaction. Round 27 capability-to-API response evidence gates passed with `site-onboarding-discovery.test.mjs` 47/47, covering non-quorum `api-response-evidence`, bounded response field hints, missing adapter/schema/test/policy gaps preserved, and raw response/header/body/payload/session/profile/executable-ref dropping. Round 28 controlled-scope closure gates passed with `site-onboarding-discovery.test.mjs` 47/47, covering artifact-accounting closure, no live/execution/full-web claim, no promotion, no bypass, artifact refs as names only, and visible unresolved/blocked/gap counts. Round 30 capability closure gates passed with `site-onboarding-discovery.test.mjs` 49/49, covering target/gap accounting, observed capability non-execution, verified adapter/schema/test/policy quorum requirements, descriptor-only mappings/gaps, and no Graph/Planner/Layer/downloader promotion.
- Current gaps: More live producer evidence can be added incrementally; capability verification still requires explicit SiteAdapter/schema/test/policy quorum and remains blocked when evidence is missing, unverified, or only observed. Controlled-scope capability closure now accounts for current targets and gaps without treating observed evidence as executable.
- Next smallest task: Run final six-agent quality-gate review and confirm 100-point scoring without claiming live full-web completion.
- Risk notes: Evidence must stay redacted and provenance-preserving.
- Last updated: 2026-05-10T17:31:10+08:00

### 15. Site health execution gate
- Section name: Site health execution gate
- Requirement summary: Gate each capability independently so one risky capability does not shut down the whole site unnecessarily.
- Current status: `verified`
- Existing code evidence: `src/sites/capability/site-health-execution-gate.mjs` and planner task-list integration.
- Existing test evidence: `tests/node/site-health-execution-gate.test.mjs`, `tests/node/site-health-recovery-execution-gate.test.mjs`, and runtime integration tests.
- Verification command: `node --test tests\node\site-health-execution-gate.test.mjs tests\node\site-health-recovery-execution-gate.test.mjs tests\node\site-health-recovery-runtime-integration.test.mjs`
- Verification result: Capability health execution gate passed; X live auth recovery now keeps the scoped `x-auth-doctor` check behind a generated `x-session-health` manifest and treats ready unified session health as reusable auth evidence only for authenticated scenario validation.
- Current gaps: Full live recovery remains an explicit operator workflow; public navigation primary-chain failures must not be confused with authenticated session reuse failures.
- Next smallest task: Keep write capabilities disabled when readonly fallback is active.
- Risk notes: Account restriction, platform risk, CAPTCHA, MFA, and verification surfaces require user action or quarantine.
- Last updated: 2026-05-04T13:48:09+08:00

### 16. Site onboarding producer integration
- Section name: Site onboarding producer integration
- Requirement summary: Feed real or safely simulated capture/expand/site-doctor outputs into the discovery artifacts.
- Current status: `verified`
- Existing code evidence: `src/sites/capability/site-onboarding-discovery.mjs` and `src/entrypoints/sites/site-doctor.mjs` write ten onboarding artifacts: `NODE_INVENTORY`, `API_INVENTORY`, `UNKNOWN_NODE_REPORT`, `BLOCKED_NODE_REPORT`, `UNKNOWN_API_REPORT`, `BLOCKED_API_REPORT`, `CAPABILITY_TARGETS`, `CAPABILITY_GAP_REPORT`, `SITE_CAPABILITY_REPORT`, and `DISCOVERY_AUDIT`. `site-doctor` writes both Markdown and redacted JSON forms so coverage, blocked surfaces, unknowns, and capability gaps are machine-verifiable. `CAPABILITY_TARGETS` now records descriptor-only `evidenceMappings` / `mappingSummary`, `evidenceRequirementGaps`, and `evidenceCompletionStrategy` metadata from DOM/API/JS-route/API-response descriptor fields, and can also consume static SiteAdapter capability evidence arrays or fixture-backed `capabilityEvidenceFixtures` as adapter/schema/test/policy evidence when the full quorum is explicitly declared; `CAPABILITY_GAP_REPORT` records `mappingGaps`, per-evidence adapter/schema/test/policy requirement gaps, completion strategies, missing verified-claim guidance, and all required execution evidence statuses, including policy, without changing the adapter/schema/test/policy quorum. API inventory now retains repeated observed method+endpoint evidence as `duplicate_trigger` records with normalized no-query `duplicateGroupKey` / safe `duplicateOf`, OPTIONS/preflight follow-up correlation evidence, page resource/performance hints, descriptor-only DOM hidden API hints, request/response shape gaps, WebSocket/SSE message shape gaps, descriptor-only multi-step API flow correlation, and an API controlled-scope closure subreport instead of silently dropping or promoting them. Capability targets now also feed a capability controlled-scope closure subreport that accounts for canonical targets, observed/unknown/verified states, required gaps, descriptor-only mappings/gaps, and explicit adapter/schema/test/policy executable quorum. Trigger gap node artifacts retain descriptor-only `followUpStrategy` and `attemptResult` evidence. Blocked node artifacts retain descriptor-only `blockedSurfaceClassification` and `surfaceCategoryCounts` for access boundaries, policy/budget skips, unattempted/failed/duplicate triggers, and manual-review surfaces. `SITE_CAPABILITY_REPORT` and `DISCOVERY_AUDIT` now carry controlled-scope closure evidence that proves artifact accounting and unresolved/blocked/gap visibility without claiming live full-web discovery. Capture now appends page resource/performance API hints and DOM hidden API hints to redacted `networkRequests` before API candidate artifact generation, keeping them observed-only, and persists DOM/script/runtime/history-state route descriptors as redacted `jsRoutes` / `scriptRoutes` for node discovery.
- Existing test evidence: `tests/node/site-onboarding.test.mjs`, `tests/node/site-onboarding-discovery.test.mjs`, and site-specific Qidian/AV onboarding tests.
- Verification command: `node --test tests\node\site-onboarding.test.mjs tests\node\site-onboarding-discovery.test.mjs tests\node\qidian-site.test.mjs`
- Verification result: Onboarding producer integration focused gate passed with all ten onboarding artifacts; 2026-05-10 `site-onboarding-discovery.test.mjs` passed 31/31 and `site-onboarding-discovery.test.mjs` + `site-onboarding.test.mjs` + `capture-expand.test.mjs` passed 87/87 with Markdown+JSON artifact checks, FullDiscoveryMode mode semantics, UNKNOWN/BLOCKED/GAP reports, 90-point architecture/evidence score separation, requested-capability evidence separation, DOM/API/JS-route descriptor field mapping into CAPABILITY_TARGETS / CAPABILITY_GAP_REPORT without executable promotion, redacted capability target source refs, evidenceMappings/mappingGaps auditability, explicit adapter/schema/test/policy evidence quorum before verified executable capability status, no `recognizedCapabilities` verified-summary bypass, bounded API shape summaries, and duplicate API endpoint observations retained as `duplicate_trigger` evidence with query/token/executable-looking refs stripped from duplicate metadata. Round 10 capture/resource gates passed with `browser-runtime-session.test.mjs` 12/12 and `capture-expand.test.mjs` 28/28; resource hints are written as redacted observed API candidates without catalog promotion. Round 11 route-hint gates passed with `browser-runtime-session.test.mjs` 13/13, `capture-expand.test.mjs` 28/28, `site-onboarding-discovery.test.mjs` 31/31, `site-capability-matrix.test.mjs` 6/6, scoped `git diff --check`, and `prepublish-secret-scan` 656 files; DOM href/data-route/link/script-src descriptors are persisted as redacted route evidence without JS source. Round 12 compiler capability-gap gates passed with `compile-entrypoint.test.mjs` 9/9, `static-compiler.test.mjs` 4/4, and `schema-validator.test.mjs` 10/10; missing requested capabilities now block unrelated Planner/Layer handoff readiness and remain descriptor-only gap evidence. Round 13 API preflight-correlation gates passed with `api-discovery.test.mjs` 23/23, `api-candidates.test.mjs` 86/86, and `site-onboarding-discovery.test.mjs` 31/31. Round 14 runtime route gates passed with `browser-runtime-session.test.mjs` 13/13, `capture-expand.test.mjs` 28/28, and `site-onboarding-discovery.test.mjs` 31/31; runtime route descriptors from safe page route metadata remain observed-only, redacted, and non-executable. Round 15 capability quorum-gap gates passed with `site-onboarding-discovery.test.mjs` 32/32 and `site-onboarding.test.mjs` 28/28; CAPABILITY_TARGETS and CAPABILITY_GAP_REPORT now expose per-required-evidence adapter/schema/test/policy gaps, requested capability targets are marked required, unsafe requested target strings are redacted, and observed capability evidence still cannot promote to executable. Round 16 DOM hidden API gates passed with `browser-runtime-session.test.mjs` 13/13, `capture-expand.test.mjs` 28/28, `api-discovery.test.mjs` + `api-candidates.test.mjs` 109/109, and `site-onboarding-discovery.test.mjs` 32/32. Round 17 history-state route gates passed with `browser-runtime-session.test.mjs` 13/13, `capture-expand.test.mjs` 28/28, and `site-onboarding-discovery.test.mjs` 32/32; allowlisted history/router state route descriptors remain observed-only and redacted, and raw state objects are not persisted. Round 18 static SiteAdapter capability evidence gates passed with `site-onboarding-discovery.test.mjs` 34/34 and `site-onboarding.test.mjs` 28/28; declared adapter/schema/test/policy evidence can satisfy the existing quorum without invoking adapter methods, partial evidence leaves explicit missing schema/test/policy gaps, and unsafe evidence refs are redacted. Round 19 API shape-gap gates passed with `site-onboarding-discovery.test.mjs` 35/35; APIs lacking request/response shape summaries now carry explicit redacted descriptor-only gap rows with reason codes, and raw request/response/header/sample material is dropped. Round 20 trigger follow-up strategy gates passed with `site-onboarding-discovery.test.mjs` 36/36; trigger gaps now carry descriptor-only retry/policy/manual-review guidance in node and blocked-node artifacts without executing retries, and unsafe runtime refs are dropped. Round 21 capability completion strategy gates passed with `site-onboarding-discovery.test.mjs` 37/37; CAPABILITY_TARGETS and CAPABILITY_GAP_REPORT expose missing-evidence next actions, missing verified-claim gaps, and no auto-promotion. Round 22 streaming message-shape gates passed with `site-onboarding-discovery.test.mjs` 39/39; WebSocket/SSE endpoints expose missing message-shape gaps or bounded message shape summaries without raw payload persistence. Round 23 trigger attempt-result gates passed with `site-onboarding-discovery.test.mjs` 40/40; trigger gaps now expose descriptor-only attempt status/count/governance metadata and drop unsafe runtime refs. Round 24 fixture-backed capability evidence gates passed with `site-onboarding-discovery.test.mjs` 45/45; fixture-backed SiteAdapter metadata can satisfy explicit verified adapter/schema/test/policy quorum only when every required exact evidence kind has a verified entry, mixed/unverified fixtures remain non-executable with `requires_verified_evidence_claim`, compound kinds are rejected from executable quorum, and unsafe fixture refs are reduced to redacted descriptors. Round 25 blocked node classification gates passed with `site-onboarding-discovery.test.mjs` 46/46; blocked/unreachable node surfaces now carry descriptor-only categories, reason codes, follow-up actions, bypass-prohibited flags, non-executable flags, category counts, and unsafe URL/path/IP/executable/session material redaction. Round 26 multi-step API correlation gates passed with `site-onboarding-discovery.test.mjs` 47/47; observed API flow correlation is descriptor-only, non-catalog, non-executable, and drops unsafe URL/query/header/body/payload/response/session/profile/IP/executable refs. Round 27 capability-to-API response evidence gates passed with `site-onboarding-discovery.test.mjs` 47/47; `api-response-evidence` mappings are non-quorum, descriptor-only, non-executable, preserve missing adapter/schema/test/policy gaps, and drop raw response/header/body/payload/session/profile/executable refs. Round 28 controlled-scope closure gates passed with `site-onboarding-discovery.test.mjs` 47/47; closure evidence appears in JSON+Markdown report/audit outputs, keeps unknown/blocked/gap counts visible, forbids promotion/bypass/execution, and explicitly does not claim live full-web crawl coverage. Round 29 API closure gates passed with `site-onboarding-discovery.test.mjs` 48/48; API closure appears under `fullDiscoveryClosure.apiControlledScopeClosure` in report/audit outputs and accounts for API observed/unknown/blocked/duplicate/shape/message/preflight/multi-step surfaces without live coverage or promotion claims. Round 30 capability closure gates passed with `site-onboarding-discovery.test.mjs` 49/49; capability closure appears under `fullDiscoveryClosure.capabilityControlledScopeClosure` and accounts for canonical targets, observed/unknown/verified states, required gaps, descriptor-only mappings/gaps, and verified adapter/schema/test/policy quorum before execution. The compiler/executor unsafe ref focused gate also passed 21/21 and the full compiler-executor suite passed 51/51 with raw URL/path/account/IP/query/executable-looking source/evidence/artifact refs rejected before derived artifact writes.
- Current gaps: More sites can add direct capture fixtures; FullDiscoveryMode records gaps and blocked surfaces inside controlled scope but does not claim inaccessible or unobserved surfaces were absent. Capability targets now retain observed DOM/API/JS-route/runtime-route/history-state/API-response descriptor evidence, machine-readable mapping gaps, per-evidence quorum gaps, completion strategies, static adapter capability evidence, fixture-backed capability evidence, and controlled-scope closure; explicit verified SiteAdapter/schema/test/policy evidence is still required before verified/executable capability status.
- Next smallest task: Run final six-agent quality-gate review and confirm 100-point scoring without claiming live full-web completion.
- Risk notes: Do not claim completion when discovery is blocked by login, paywall, VIP access, CAPTCHA, risk-control, or permission checks.
- Last updated: 2026-05-10T17:31:10+08:00

### 17. Focused regression strategy
- Section name: Focused regression strategy
- Requirement summary: Prefer directly related tests for each batch, record focused regression batch definitions, and defer wildcard Node/Python full suites to broad validation checkpoints.
- Current status: `verified`
- Existing code evidence: `CONTRIBUTING.md#focused-regression-batch-definition`, `src/sites/capability/focused-regression-batches.mjs`, and layeredValidationPolicy evidence in regression batch definitions.
- Existing test evidence: `tests/node/site-capability-regression-batches.test.mjs`, `tests/node/site-capability-matrix.test.mjs`, `tests/node/downloads-runner.test.mjs`, `tests/node/session-view.test.mjs`, `tests/node/security-guard-redaction.test.mjs`, `tests/node/risk-state.test.mjs`, `tests/node/reason-codes.test.mjs`, LifecycleEvent coverage in `tests/node/capability-hook.test.mjs`, `tests/node/standard-task-list.test.mjs`, `tests/node/download-policy.test.mjs`, `tests/node/site-capability-graph-matrix.test.mjs`, and `tests/node/site-capability-graph-final-validation.test.mjs`.
- Verification command: `node --test tests\node\site-capability-regression-batches.test.mjs tests\node\site-capability-matrix.test.mjs tests\node\downloads-runner.test.mjs tests\node\session-view.test.mjs tests\node\security-guard-redaction.test.mjs tests\node\risk-state.test.mjs tests\node\reason-codes.test.mjs tests\node\capability-hook.test.mjs tests\node\standard-task-list.test.mjs tests\node\download-policy.test.mjs`; `node --test tests\node\site-capability-graph-matrix.test.mjs tests\node\site-capability-graph-final-validation.test.mjs`
- Verification result: Focused regression batch strategy passed; directly related tests remain the required batch-level gate while broad wildcard suites are reserved for release checkpoints. Current Site Capability Graph closure validation passed on 2026-05-08 with matrix 108/108 and final-validation 8/8 after adding a verified-section blocker guard, moving legacy no-op partial wording behind the final validation gate, compressing the Section 20 legacy descriptor pipeline regression tail, and compressing source-alias fail-closed regressions into strict data-driven tables.
- Current gaps: Keep `Focused Regression Batch Definition` synchronized with new high-risk modules. Site Capability Graph delivery/no-op history is retained as regression coverage only and must not become new completion evidence.
- Next smallest task: Add new focused batches when API, health, downloader, or Graph final-validation contracts expand.
- Risk notes: Do not report unrun broad suites as passed.
- Last updated: 2026-05-08T00:00:00+08:00

### 18. New site onboarding completion
- Section name: New site onboarding completion
- Requirement summary: Treat a new URL as full onboarding: profile, registry, capabilities, SiteAdapter, skill, discovery artifacts, coverage gate, matrix update, and review acceptance.
- Current status: `verified`
- Existing code evidence: Qidian, BZ888, and the 11 AV catalog sites have profiles, registry/capability records, repo-local skills, SiteAdapter semantics, onboarding coverage fixtures or focused runtime gates. `src/sites/jp-av-catalog/queries/release-catalog.mjs` adds durable cross-site AV release aggregation and records 8MAN/SOD/DOGMA as explicit skipped/blocked release-table coverage. BZ888 records `blocked_live_cloudflare_challenge`, keeps OCR limited to public chapter body images, and does not permit Cloudflare/CAPTCHA/risk-control bypass.
- Existing test evidence: `tests/node/qidian-site.test.mjs`, `tests/node/batch1-av-sites.test.mjs`, `tests/node/batch2-av-sites.test.mjs`, `tests/node/batch3-av-sites.test.mjs`, `tests/node/jp-av-release-catalog.test.mjs`, `tests/node/site-onboarding-discovery.test.mjs`, `tests/node/site-registry.test.mjs`, `tests/node/profile-validation.test.mjs`, `tests/node/generate-skill.test.mjs`, and BZ888 downloader/OCR focused tests.
- Verification command: `node --test tests\node\qidian-site.test.mjs tests\node\batch1-av-sites.test.mjs tests\node\batch2-av-sites.test.mjs tests\node\batch3-av-sites.test.mjs tests\node\site-onboarding-discovery.test.mjs`
- Verification result: New-site focused gate passed for URL-only full-onboarding contract and ten-artifact FullDiscoveryMode generation paths; JP AV release-catalog focused test passed for site-specific list/detail adapters and skipped/blocked release coverage; BZ888 focused onboarding/downloader safety gate passed with current `download-site-modules`/`site-registry`/reason/runner batch 172/172 and Python download-book boundary tests 11/11. Separate visible-browser manual recovery confirmed catalog/chapter readability after human challenge, while keeping downloader access blocked from raw cookies and challenge-derived credentials.
- Current gaps: Verified API catalog promotion is separate from onboarding discovery evidence; BZ888 direct automated access remains a Cloudflare challenge stop boundary and is recorded as blocked/not bypassed even when a human-verified browser tab can read pages.
- Next smallest task: For any future bare URL, run the same full onboarding gate.
- Risk notes: Skill-only or profile-only additions are not complete onboarding.
- Last updated: 2026-05-04T15:22:01+08:00

### 19. Standard artifacts and inventories
- Section name: Standard artifacts and inventories
- Requirement summary: Keep standard artifact families, schema inventory, and onboarding inventories discoverable and versioned.
- Current status: `verified`
- Existing code evidence: `src/sites/capability/artifact-schema.mjs`, `schema-inventory.mjs`, onboarding artifact names, API catalog artifacts, and manifest bundle compatibility. Onboarding discovery now standardizes ten machine-readable artifact families, including UNKNOWN/BLOCKED node/API reports and CAPABILITY_TARGETS/CAPABILITY_GAP_REPORT.
- Existing test evidence: `tests/node/schema-inventory.test.mjs`, `tests/node/schema-governance.test.mjs`, `tests/node/site-onboarding-discovery.test.mjs`, `tests/node/api-candidates.test.mjs`, and `tests/node/site-capability-graph-matrix.test.mjs`. Current Site Capability Graph review-gate regression coverage is `Site Capability Graph Section 19 recent live integration review gates regression batch stays promotion-blocking`, covering aggregate execution boundary handoff, non-goal live consumer compatibility, and docs-output live consumer dispatch compatibility review gates without live wiring or promotion. Current Graph Section 18 external dispatch acceptance preflight coverage records `createGraphDocsOutputLiveConsumerExternalDispatchAcceptancePreflight()` as descriptor-only / blocked / redactionRequired evidence before any docs-output external dispatch can be considered.
- Verification command: `node --test tests\node\schema-inventory.test.mjs tests\node\schema-governance.test.mjs tests\node\site-onboarding-discovery.test.mjs tests\node\api-candidates.test.mjs`; `node --test tests\node\site-capability-graph-matrix.test.mjs --test-name-pattern "recent live integration review gates regression batch"`; `node --test tests\node\site-capability-graph-artifact-writer.test.mjs --test-name-pattern "external dispatch acceptance preflight"`; `node --test tests\node\site-capability-graph-matrix.test.mjs --test-name-pattern "external dispatch acceptance preflight"`
- Verification result: Standard artifact focused gate passed for ArtifactReferenceSet, ManifestArtifactBundle, LifecycleEvent, ApiCatalogIndex, StandardTaskList, onboarding inventories, and redaction audits. Current Site Capability Graph review-gate regression focused matrix validation passed 1/1 and full matrix validation passed 79/79 on 2026-05-07; this is durable ledger evidence only and does not enable live consumer wiring, repo/docs/runtime writes, external telemetry/dispatch, SiteAdapter, downloader, SessionView, or status promotion. Current Graph Section 18 external dispatch acceptance preflight focused artifact-writer validation passed 4/4 and focused matrix validation passed 1/1 on 2026-05-07; this keeps external dispatch, external telemetry, docs/repo/runtime writes, SiteAdapter, downloader, SessionView, task runner, and status promotion disabled.
- Current gaps: Keep generated inventories compact and avoid duplicate docs.
- Next smallest task: Fold dated status snapshots into matrix or CONTRIBUTING instead of adding more standalone docs.
- Risk notes: Artifact schemas must remain compatible before writes proceed.
- Last updated: 2026-05-04T13:45:00+08:00

### 20. Final goal
- Section name: Final goal
- Requirement summary: Keep Sections 1-19 verified, preserve safety boundaries, keep docs compact, and maintain final validation evidence.
- Current status: `verified`
- Existing code evidence: Sections 1-19 record code-backed evidence across Kernel, SiteAdapter, Capability Services, downloader boundary, schema governance, health recovery, discovery, and artifacts. Current Site Capability Graph final validation evidence lives in `src/sites/capability/site-capability-graph-final-validation.mjs`, with planner/Layer relationship evidence in `planner-policy-handoff.mjs` and lifecycle producer inventory evidence in `lifecycle-events.mjs`.
- Existing test evidence: The current focused validation set covers matrix/regression, download, API, security, lifecycle, health, onboarding, architecture gates, BZ888 OCR challenge boundary, redacted registry profile fallback, Cloudflare challenge reason recovery, Site Capability Graph matrix closure, final validation, planner/policy handoff, redaction persistence, lifecycle producer inventory, and observability boundaries.
- Verification command: `node --test tests\node\site-capability-matrix.test.mjs tests\node\download-site-modules.test.mjs tests\node\site-registry.test.mjs tests\node\profile-validation.test.mjs tests\node\generate-skill.test.mjs tests\node\site-onboarding-discovery.test.mjs`; `python -m unittest .\tests\python\test_download_book.py`; `node --test tests\node\site-capability-graph-matrix.test.mjs tests\node\site-capability-graph-final-validation.test.mjs tests\node\planner-policy-handoff.test.mjs tests\node\lifecycle-events.test.mjs tests\node\site-capability-graph-observability.test.mjs`
- Verification result: 2026-05-04 final validation evidence: matrix focused gate passed; regression focused gate passed; download focused gate passed; API focused gate passed; security focused gate passed; BZ888 onboarding/downloader/OCR/profile-fallback/Cloudflare-reason focused gates passed; live BZ888 execute produced governed challenge-stop manifest `20260504T062914706Z-bz888-generic-resource`; separate human-visible browser validation confirmed the target BZ888 catalog/chapter pages were readable after manual challenge completion without exposing raw cookies to the repo or downloader; live X auth recovery passed at 2026-05-04T13:48:09+08:00. 2026-05-08 Site Capability Graph final validation passed with `verified=20`, `partial=0`, `gaps=[]`, matrix 108/108 after Section 20 legacy descriptor pipeline and source-alias fail-closed regression compression, final-validation 8/8, planner-policy handoff 40/40, lifecycle-events 15/15, observability 53/53, and Agent B `Accepted`. 2026-05-08 release-scope broad validation passed with explicit Node test-file list 1971/1971, Python unittest discovery 58/58, prepublish secret scan 589 candidate files, and `git diff --check`.
- Current gaps: Future release-time broad wildcard validation should be rerun after additional changes; BZ888 direct downloader access remains blocked by Cloudflare challenge and must stay a recorded boundary rather than a bypass target; X public primary author-chain expansion remains a non-auth navigation gap. Site Capability Graph has no open partial section after the final validation gate.
- Next smallest task: Before staging, rerun the compact prepublish checklist in `CONTRIBUTING.md` and keep Graph delivery/no-op history as regression-only context.
- Risk notes: The 14 non-Douyin remaining items are consolidated here; Xiaohongshu fresh evidence, Bilibili UP-space diagnostics, native-miss-diagnostics-v1, profile-health-risk manual boundaries, and repo-local skills remain recorded without raw cookies, authorization headers, or CAPTCHA bypass. Graph completion is invalid if future changes reintroduce partial-state blockers, runtime execution, repo/docs/runtime writes, external telemetry, SiteAdapter/downloader invocation, SessionView materialization, or sensitive-material persistence.
- Last updated: 2026-05-08T00:00:00+08:00


## Focused Regression Batch Definition

The focused regression batch definition is embedded here because standalone docs/ has been retired. Keep this fenced JSON schema-compatible with FocusedRegressionBatchDefinition.

<!-- SCL_FOCUSED_REGRESSION_BATCHES_JSON_BEGIN -->
```json focused-regression-batches
{
  "schemaVersion": 1,
  "description": "Focused Site Capability Layer regression batches for A/B loop verification. These commands are intentionally bounded and do not replace full-suite release validation.",
  "layeredValidationPolicy": {
    "directTask": "Run the directly related unit, contract, schema, or guard test for each A task before matrix update.",
    "sameTypeBatch": "Run one matching focused batch after 3-5 same-type tasks, before B batch review, or before any status upgrade to implemented/verified.",
    "matrix": "Run tests/node/site-capability-matrix.test.mjs after every implementation matrix update.",
    "fullSuite": "Defer wildcard Node and Python full suites until status upgrade, release gate, final verification, or explicit B direction."
  },
  "batches": [
    {
      "id": "scl-matrix-schema-compatibility",
      "sectionFocus": [11, 12, 17],
      "command": "node --test tests/node/site-capability-matrix.test.mjs tests/node/schema-inventory.test.mjs tests/node/compatibility-registry.test.mjs",
      "purpose": "Validate the implementation matrix, schema inventory, and central compatibility registry."
    },
    {
      "id": "scl-priority-focused-guards",
      "sectionFocus": [1, 2, 3, 4, 13, 17, 20],
      "command": "node --test --test-name-pattern \"kernel and pipeline boundary imports stay behind registries or capability services|non-goal boundary classifier catches raw session reads and SecurityGuard bypasses|ordinary download runtime and pipeline paths do not cross non-goal session boundaries|capability services do not depend on concrete sites or runtime orchestration layers|download execution consumers do not import site semantics or session orchestration|NetworkCapture observed requests do not classify site semantics|SessionView purpose isolation blocks non-download purposes from download access and broad scopes|Section 20 final goal cannot be verified before prerequisite sections and final validation evidence\" tests/node/architecture-import-rules.test.mjs tests/node/network-capture.test.mjs tests/node/session-view.test.mjs tests/node/site-capability-matrix.test.mjs",
      "purpose": "Accelerated verification for recently added focused guards: architecture boundary checks, NetworkCapture no-site-semantics, SessionView purpose isolation, and the Section 20 final-goal readiness gate."
    },
    {
      "id": "scl-redaction-trust-boundaries",
      "sectionFocus": [13, 14],
      "command": "node --test tests/node/security-guard-redaction.test.mjs tests/node/session-view.test.mjs tests/node/download-media-executor.test.mjs",
      "purpose": "Validate redaction guards, SessionView trust-boundary behavior, and media queue artifact redaction."
    },
    {
      "id": "scl-api-knowledge-lifecycle",
      "sectionFocus": [4, 5, 7],
      "command": "node --test tests/node/network-capture.test.mjs tests/node/capture-manifest-redaction.test.mjs tests/node/api-discovery.test.mjs tests/node/api-candidates.test.mjs tests/node/site-adapter-contract.test.mjs",
      "purpose": "Validate observed request/response capture, capture manifest fail-closed artifact boundaries, API candidate generation, verified-only catalog guards, and SiteAdapter contracts."
    },
    {
      "id": "scl-downloader-boundaries",
      "sectionFocus": [8, 10, 19],
      "command": "node --test tests/node/architecture-import-rules.test.mjs tests/node/downloads-runner.test.mjs tests/node/standard-task-list.test.mjs tests/node/download-policy.test.mjs tests/node/planner-policy-handoff.test.mjs",
      "purpose": "Validate downloader boundaries, StandardTaskList, DownloadPolicy, and planner-policy handoff contracts."
    },
    {
      "id": "scl-risk-lifecycle-observability",
      "sectionFocus": [9, 15, 16, 18],
      "command": "node --test tests/node/risk-state.test.mjs tests/node/reason-codes.test.mjs tests/node/lifecycle-events.test.mjs tests/node/capability-hook.test.mjs",
      "purpose": "Validate RiskState, reasonCode, LifecycleEvent, and CapabilityHook contracts."
    },
    {
      "id": "scl-recent-high-value-focused-regression",
      "sectionFocus": [1, 2, 3, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20],
      "command": "node --test tests/node/downloads-runner.test.mjs tests/node/architecture-import-rules.test.mjs tests/node/session-view.test.mjs tests/node/site-session-runner.test.mjs tests/node/site-session-governance.test.mjs tests/node/security-guard-redaction.test.mjs tests/node/schema-governance.test.mjs tests/node/compatibility-registry.test.mjs tests/node/capability-hook.test.mjs tests/node/site-capability-matrix.test.mjs",
      "purpose": "Bounded regression batch for the recently passing 291/291 main focused gate across downloader boundary, architecture import rules, SessionView, session runner/governance, SecurityGuard redaction, schema governance, compatibility registry, CapabilityHook, and matrix policy coverage; the same bounded file set reran as 292/292 on 2026-05-03 and then 296/296 on 2026-05-03 after test inventory drift. Prefer this precise batch over wildcard/full-suite reruns when the touched work matches these surfaces.",
      "recentPassingEvidence": [
        "main focused gate 291/291",
        "2026-05-03 bounded rerun 292/292",
        "2026-05-03 resumed bounded rerun 296/296",
        "downloads-runner included",
        "architecture-import-rules included",
        "session-view included",
        "site-session-runner included",
        "site-session-governance included",
        "security-guard-redaction included",
        "schema-governance included",
        "compatibility-registry included",
        "capability-hook included",
        "site-capability-matrix included"
      ]
    }
  ],
  "fullSuitePolicy": {
    "nodeWildcard": "deferred until status upgrade, release gate, or B-directed full verification batch",
    "pythonUnittest": "deferred until status upgrade, release gate, or B-directed full verification batch"
  }
}

```
<!-- SCL_FOCUSED_REGRESSION_BATCHES_JSON_END -->

## Download Runner Operations

The unified download runner keeps site-specific planning and resource resolution outside the generic executor. It is dry-run by default, writes stable `plan.json`, `resolved-task.json`, `manifest.json`, `queue.json`, `downloads.jsonl`, and `report.md` artifacts, and supports `--execute`, `--resume`, and `--retry-failed`.

Hybrid native status is not a live-capability claim; live smoke, real login, and real download validation remain separate release gates. The generic executor consumes concrete resources only. Site modules own planner, resolver, and legacy command construction. The session manager returns sanitized lease and health metadata; it does not download resources. Legacy Python and action routers remain valid adapters until matching native resource resolvers are proven.

| Site key | Host | Current path | Notes |
| --- | --- | --- | --- |
| `22biqu` | `www.22biqu.com` | Hybrid native + legacy fallback | Native can use direct chapter resources, local book-content fixtures, KB roots, or directory HTML; unmatched live book requests fall back to `src/sites/chapter-content/download/python/book.py`. |
| `bilibili` | `www.bilibili.com` | Hybrid native + legacy fallback | Native can use fixture/injected/gated API evidence for playurl `dash`/`durl`, BV multi-P, collection/series, and UP archive shapes. |
| `douyin` | `www.douyin.com` | Hybrid native + legacy fallback | Native can consume fixture/injected media detail, direct media, author enumeration, and followed-update seeds without refreshing live state. |
| `xiaohongshu` | `www.xiaohongshu.com` | Hybrid native + legacy fallback | Native can consume fixture/injected note, search, author, followed, page facts, and side-effect-free fetch evidence. |
| `x` | `x.com` | Hybrid native + legacy fallback | Native can consume gated captured archive/media candidates and local social archive artifacts. |
| `instagram` | `www.instagram.com` | Hybrid native + legacy fallback | Native can consume gated captured feed-user/archive payloads, media candidates, and local social archive artifacts. |

### Download Commands
```powershell
node src\entrypoints\cli.mjs download plan BV1example --site bilibili --json
node src\entrypoints\cli.mjs download execute BV1example --site bilibili --json
node src\entrypoints\cli.mjs download execute https://example.com/file --site example --run-dir runs\downloads\example\run --resume
node src\entrypoints\cli.mjs download execute https://example.com/file --site example --run-dir runs\downloads\example\run --retry-failed
```

### Download Native / Legacy Ownership

Current policy: do not delete or bypass legacy fallback paths.
Live traffic status: not claimed.

Phase 3 records which download task shapes can run through native resource
resolution and which shapes must keep the legacy adapters. This document is an
evidence matrix, not a removal plan. Unsupported shapes must continue to fall
back to legacy until a matching native resolver has fixture-backed tests and
runner coverage.

## Scope

- Branch: local `main`
- Base assumption: Phase 2 runner contracts and native resolver follow-up work
  are already available locally.
- Current policy: do not delete or bypass legacy fallback paths.
- Live traffic status: not claimed. Native coverage here is fixture-backed,
  request-injected, injected-fetch backed, or injected-resolver backed only.

## Migration Matrix

| Site | Task shape | Native status | Resolver method | Completion reason | Evidence | Legacy fallback |
| --- | --- | --- | --- | --- | --- | --- |
| 22biqu | Request provides direct chapter entries through `chapters`, `chapterUrls`, or equivalent chapter seed fields. | Native | `native-22biqu-chapters` | `22biqu-chapters-provided` | `tests/node/download-site-modules.test.mjs`; `tests/node/downloads-runner.test.mjs` | Keep Python book downloader for inputs without chapter seeds. |
| 22biqu | Ordinary book URL or title resolved from local book-content artifacts via `bookContentDir`. | Native | `native-22biqu-book-content` | `22biqu-book-content-provided` | `tests/node/download-22biqu-native-resolver.test.mjs` | Keep Python book downloader when no matching artifact exists. |
| 22biqu | Ordinary book title resolved from a compiled KB root through `fixtureDir` and `index/sources.json`. | Native | `native-22biqu-book-content` | `22biqu-book-content-provided` | `tests/node/download-22biqu-native-resolver.test.mjs` | Keep Python book downloader when the KB root does not point to matching book-content artifacts. |
| 22biqu | Directory HTML supplied directly as `fixtureHtml`. | Native | `native-22biqu-directory` | `22biqu-directory-provided` | `tests/node/download-22biqu-native-resolver.test.mjs` | Keep Python book downloader when the HTML has no chapter links. |
| 22biqu | Directory HTML supplied from a local fixture file or book-content `directoryHtmlFile`. | Native | `native-22biqu-directory` | `22biqu-directory-provided` | `tests/node/download-22biqu-native-resolver.test.mjs` | Keep Python book downloader when the file is missing, unmatched, or has no chapter links. |
| 22biqu | Directory HTML supplied by an injected mock fetch function (`fetchImpl` / `mockFetchImpl`). | Native | `native-22biqu-directory` | `22biqu-directory-provided` | `tests/node/download-22biqu-native-resolver.test.mjs` | Keep Python book downloader when no injected fetch is supplied or it returns no parseable chapter links. |
| Bilibili | Request provides concrete resource seeds (`resources`, `resourceSeeds`, resolved media fields, etc.). | Native | `native-bilibili-resource-seeds` | `bilibili-resource-seeds-provided` | `tests/node/download-site-modules.test.mjs`; `tests/node/download-native-seed-schema.test.mjs` | Keep Bilibili legacy action for ordinary page or BV inputs without resource seeds. |
| Bilibili | Request provides offline `dash` or `durl` playurl payloads. | Native | `native-bilibili-page-seeds` | `bilibili-page-seeds-provided` | `tests/node/download-bilibili-page-seed-resolver.test.mjs` | Keep Bilibili legacy action when playurl evidence is missing or unsupported. |
| Bilibili | BV view payload plus matching multi-P `playUrlPayloads`. | Native | `native-bilibili-page-seeds` | `bilibili-page-seeds-provided` | `tests/node/download-bilibili-page-seed-resolver.test.mjs` | Keep Bilibili legacy action when any requested page lacks matching playurl evidence. |
| Bilibili | Collection, series, or UP-space archive payload plus matching `playUrlPayloads`. | Native | `native-bilibili-page-seeds` | `bilibili-page-seeds-provided` | `tests/node/download-bilibili-page-seed-resolver.test.mjs` | Keep Bilibili legacy action when list evidence or per-entry playurl evidence is incomplete. |
| Bilibili | Ordinary BV, collection, series, or UP-space input resolved by request-injected `bilibiliApiEvidence` or injected `resolveBilibiliApiEvidence`. | Native | `native-bilibili-page-seeds` | `bilibili-page-seeds-provided` | `tests/node/download-bilibili-page-seed-resolver.test.mjs` | Keep Bilibili legacy action when the evidence provider is missing, returns partial evidence, or any playurl evidence is incomplete. |
| Bilibili | Ordinary BV, collection, series, or UP-space input resolved by the built-in API evidence fetcher through injected/mock fetch, or through `globalThis.fetch` only when `allowNetworkResolve` is true. | Native | `native-bilibili-page-seeds` | `bilibili-page-seeds-provided`; live native miss records `bilibili-api-evidence-unavailable` | `tests/node/download-bilibili-page-seed-resolver.test.mjs` | Keep Bilibili legacy action when the network gate is closed. With the network gate open, incomplete live API evidence is reported as a native miss rather than `legacy-downloader-required`. |
| Douyin | Request provides concrete direct media seeds. | Native | `native-douyin-resource-seeds` | `douyin-resource-seeds-provided` | `tests/node/download-site-modules.test.mjs`; `tests/node/download-native-seed-schema.test.mjs` | Keep Douyin legacy action for ordinary video, user, search, or feed inputs without media evidence. |
| Douyin | Ordinary video input resolved by fixture/API detail payload, fixture HTML JSON, injected fetch JSON, direct injected media results, or `resolveDouyinMediaBatch` using `douyin-native-resolver-deps-v1` plus sanitized `douyin-native-evidence-v1`. `download.mjs --resolve-network` now wires the browser-backed resolver. | Native | `native-douyin-resource-seeds` | `douyin-native-complete`, `douyin-native-payload-incomplete`, or live `douyin-native-media-unresolved` | `tests/node/download-douyin-native-resolver.test.mjs` | Keep Douyin legacy action when the network gate is closed. With the network gate open, resolver/auth misses are reported as native misses rather than `legacy-downloader-required`. |
| Douyin | Author input enumerated by injected author video results, with only unresolved entries passed through the injected media resolver. Deps use `douyin-native-resolver-deps-v1`. | Native | `native-douyin-resource-seeds` | `douyin-resource-seeds-provided` | `tests/node/download-douyin-native-resolver.test.mjs` | Keep Douyin legacy action when author enumeration is missing, empty, or unresolved. |
| Douyin | Followed-updates input resolved from injected followed update query results using `douyin-native-resolver-deps-v1`; cache refresh is allowed only when both `refreshCache` and the network gate are set. | Native | `native-douyin-resource-seeds` | `douyin-native-complete` | `tests/node/download-douyin-native-resolver.test.mjs` | Keep Douyin legacy action when signing, cache refresh side effects, profile side effects, or live followed queries are required. |
| Xiaohongshu | Request provides concrete download bundle assets or resource seeds. | Native | `native-xiaohongshu-resource-seeds` | `xiaohongshu-resource-seeds-provided` | `tests/node/download-site-modules.test.mjs`; `tests/node/download-native-seed-schema.test.mjs` | Keep Xiaohongshu legacy action for ordinary note, search, or followed-user inputs without resource seeds. |
| Xiaohongshu | Note payload, `pageFacts`, or fixture HTML provides note image/video media. | Native | `native-xiaohongshu-resource-seeds` | `xiaohongshu-resource-seeds-provided` | `tests/node/download-xiaohongshu-page-seed-resolver.test.mjs` | Keep Xiaohongshu legacy action when note evidence has no parseable media. |
| Xiaohongshu | Ordinary note/profile/search HTML fetched through injected/mock fetch, or through `globalThis.fetch` only when `allowNetworkResolve` is true, and parsed into media seeds. Resolution includes sanitized `xiaohongshu-header-freshness-v1` metadata. | Native | `native-xiaohongshu-resource-seeds` | `xiaohongshu-resource-seeds-provided`; live native miss records `xiaohongshu-session-or-header-evidence-required` | `tests/node/download-xiaohongshu-page-seed-resolver.test.mjs` | Keep Xiaohongshu legacy action when the network gate is closed. With the network gate open, anonymous/freshness misses are reported as native misses rather than `legacy-downloader-required`. |
| Xiaohongshu | Search, author, or followed mock notes provide note media or injected followed query results. Follow deps use `xiaohongshu-native-resolver-deps-v1`. | Native | `native-xiaohongshu-resource-seeds` | `xiaohongshu-resource-seeds-provided` | `tests/node/download-xiaohongshu-page-seed-resolver.test.mjs` | Keep Xiaohongshu legacy action when mock note lists or injected query results are absent. |
| Jable | Experimental video download request without a safety-reviewed native resolver. | Native miss | `native-jable-resource-seeds` | `jable-native-resolver-required` | `tests/node/download-site-modules.test.mjs`; `tests/node/downloads-runner.test.mjs` | Produce no resources and do not parse player pages, raw media URLs, CDN URLs, manifests, sessions, or browser profiles. |
| X | Gated `profile-content`, `full-archive`, or `search` input provides media candidates, including nested timeline archive payloads. | Native | `native-x-social-resource-seeds` | `x-social-resource-seeds-provided` | `tests/node/download-social-native-resolver.test.mjs`; `tests/node/downloads-runner.test.mjs` | Keep social legacy action when the native gate is off or media candidates are absent. |
| X | Gated native input provides captured social API/replay payloads or local archive artifacts (`items.jsonl`, `state.json`, `manifest.json`) with media candidates and sanitized archive schema v1/v2 metadata. | Native | `native-x-social-resource-seeds` | `x-social-resource-seeds-provided` | `tests/node/download-social-native-resolver.test.mjs` | Keep social legacy action for seed capture, live cursor replay, checkpoint continuation, and auth recovery. |
| X | Relation, followed-date, follower/following, checkpoint, resume, or cursor discovery inputs. | Legacy | `native-x-social-resource-seeds` records unsupported metadata when gated | `legacy-downloader-required` | `tests/node/download-social-native-resolver.test.mjs`; `tests/node/downloads-runner.test.mjs` | Required. These flows remain in the social legacy action. |
| Instagram | Gated `profile-content` or `full-archive` input provides feed-user/archive media candidates, including GraphQL sidecar archive payloads. | Native | `native-instagram-social-resource-seeds` | `instagram-social-resource-seeds-provided` | `tests/node/download-social-native-resolver.test.mjs`; `tests/node/downloads-runner.test.mjs` | Keep social legacy action when the native gate is off or media candidates are absent. |
| Instagram | Gated native input provides captured feed-user/API/replay payloads or local archive artifacts with media candidates and sanitized archive schema v1/v2 metadata. | Native | `native-instagram-social-resource-seeds` | `instagram-social-resource-seeds-provided` | `tests/node/download-social-native-resolver.test.mjs` | Keep social legacy action for authenticated feed discovery, live cursor replay, checkpoint continuation, and auth recovery. |
| Instagram | Relation, follower/following, followed-users, checkpoint, resume, or authenticated feed discovery inputs. | Legacy | `native-instagram-social-resource-seeds` records unsupported metadata when gated | `legacy-downloader-required` | `tests/node/download-social-native-resolver.test.mjs`; `tests/node/downloads-runner.test.mjs` | Required. These flows remain in the social legacy action. |

## Remaining Fallback Reasons

The following task shapes intentionally remain on legacy fallback:

| Site | Shape | Stable reason | Why fallback remains |
| --- | --- | --- | --- |
| 22biqu | Live ordinary book URL or title with no local fixture, no KB root match, and no injected fetch/mock. | `legacy-downloader-required` | The native resolver does not perform real network crawling. Live book crawl remains in the Python downloader. |
| 22biqu | Local fixture or directory HTML exists but yields no chapter links. | `legacy-downloader-required` | Empty or unparseable local evidence is not enough to build a complete native resource queue. |
| Bilibili | Ordinary BV, video page, creator page, collection, or series input without request-injected/API evidence, injected/mock fetch, explicit network-gated fetch, and matching playurl evidence. | `legacy-downloader-required` when not network-gated; `bilibili-api-evidence-unavailable` when network-gated native API evidence is unavailable | Unsupported API shapes, incomplete payloads, WBI/signature requirements, DASH mux, and live media verification still require fallback or explicit native miss evidence. |
| Douyin | Ordinary video, author, search, or feed input without fixture/API detail payloads, fixture HTML JSON, injected fetch JSON, direct media entries, mock media results, injected resolver output, author enumeration, or followed query results. | `legacy-downloader-required` when not network-gated; `douyin-native-resolver-unavailable` or `douyin-native-media-unresolved` when network-gated native resolver work cannot produce media | Auth/session-aware discovery, signing, cache refresh, and direct media freshness require a healthy approved resolver/profile path. |
| Xiaohongshu | Ordinary note, search, profile, or followed-user input without fixture/API payload, page facts, fixture HTML, injected/mock fetched HTML, mock note list, or injected query result. | `legacy-downloader-required` when not network-gated; `xiaohongshu-session-or-header-evidence-required` when network-gated anonymous/freshness evidence is insufficient | Browser/API discovery, header freshness, session side effects, and bundle construction require reliable fresh session/header evidence. |
| X | Native gate off, no media candidates, relation/followed-date/follower/following/followed-users, checkpoint, resume, or cursor discovery input. | `legacy-downloader-required` plus native unsupported metadata when gated | Social cursor discovery, archive state, relation handling, auth recovery, and media queue creation still live in the social legacy action. |
| Instagram | Native gate off, no feed-user/archive media candidates, relation/follower/following/followed-users, checkpoint, resume, or authenticated feed discovery input. | `legacy-downloader-required` plus native unsupported metadata when gated | Social cursor discovery, relation pagination, auth recovery, and media queue creation still live in the social legacy action. |

## Test Gate

Focused gate for this branch:

```powershell
node --test tests\node\download-22biqu-native-resolver.test.mjs tests\node\download-bilibili-page-seed-resolver.test.mjs tests\node\download-xiaohongshu-page-seed-resolver.test.mjs tests\node\download-douyin-native-resolver.test.mjs tests\node\download-social-native-resolver.test.mjs tests\node\download-site-modules.test.mjs tests\node\download-native-seed-schema.test.mjs tests\node\downloads-runner.test.mjs tests\node\download-media-executor.test.mjs tests\node\site-session-governance.test.mjs tests\node\session-repair-plan.test.mjs
```

Passing this gate proves only fixture-backed, request-injected, or
injected-resolver native resolution, native seed execution, legacy fallback
routing, and generic media executor behavior. It does not prove live crawling,
authenticated social archive capability, or safe fallback removal.

Legacy fallback runs must keep native miss evidence auditable. When a native
resolver returns no resources and the runner delegates to legacy, manifests
record sanitized `legacy.nativeFallback` metadata and the release audit surfaces
that reason in its `Native Fallback` / `Native Resolver` columns. This evidence
is for review only; fallback can be removed only after fixture, injected,
runner, and approved live validation all cover the same task shape.

## Derived Artifacts And Session Repair

- Bilibili DASH audio/video streams can be muxed as an explicit opt-in derived
  artifact after both stream resources complete. CLI aliases are
  `--enable-derived-mux`, `--mux-derived-media`, and `--dash-mux`. The queue
  still tracks the original resources; the mux output is appended to manifest
  files and downloads JSONL as `derived: true`. Missing audio/video streams and
  mux failures are reported as derived failures in the manifest and report.
- Session governance health can attach a sanitized `repairPlan` to blocked
  download manifests. This is operator guidance only; download runner does not
  perform login, keepalive, profile rebuild, or live recovery by itself. The
  `session-repair-plan` entrypoint is dry-run by default; `--execute` only
  constructs an approved audit command for allowlisted actions and never spawns
  child commands.


### Download Release Gate

Hard stops for download publication: stale branch/base uncertainty, unrelated dirty work, generated runtime artifacts, profile material, release notes claiming unverified behavior, live authenticated claims without approved artifacts, or any gate step requiring push/PR/live download/login/cookie import/profile recovery without explicit approval.

Minimum publication checks:

```powershell
node --test tests\node\*.test.mjs
python -m unittest discover -s tests\python -p "test_*.py"
node --test tests\node\downloads-runner.test.mjs tests\node\download-site-modules.test.mjs tests\node\download-native-seed-schema.test.mjs tests\node\download-22biqu-native-resolver.test.mjs tests\node\download-bilibili-page-seed-resolver.test.mjs tests\node\download-xiaohongshu-page-seed-resolver.test.mjs tests\node\download-douyin-native-resolver.test.mjs tests\node\download-social-native-resolver.test.mjs tests\node\download-media-executor.test.mjs tests\node\douyin-media-resolver.test.mjs
```

#### Session Manifest Gate

Accepted session providers are `unified-session-runner` and `legacy-session-provider`. Required-session download and site-doctor CLI runs default to a read-only unified health plan via `--session-health-plan`; `--session-manifest <path>` consumes an existing unified health manifest without triggering login, keepalive, profile rebuild, cookie import, or live downloads. `--no-session-health-plan` is the explicit escape hatch for legacy-provider runs.

Before any live-capability claim, run the offline audit: `node scripts/download-release-audit.mjs --runs-root runs --out-dir runs/download-release-audit`. Blocked audit rows include a `repairPlan` guidance object, and Markdown reports include `Repair Plan` plus `Next session repair command`, for example `node src/entrypoints/cli.mjs site repair-plan --site x --audit-manifest runs/download-release-audit/download-release-audit.json`. Offline only; no live/login/download side effects.

#### Resolver Evidence Gate

Network-capable native resolvers require `--resolve-network` or injected/mock fetch dependencies, ready required-session health before resolver deps run, complete resolver evidence for the task shape, and sanitized manifest metadata. Current native evidence contracts include `bilibili-native-api-evidence-v1`, `douyin-native-evidence-v1`, `xiaohongshu-header-freshness-v1`, and `social-archive-v2`.

#### Current Local Evidence

Latest local evidence must be rechecked before publication. `git status --short --branch --untracked-files=all` should show only release-owned work; clean worktree verified before evidence capture is historical evidence only. Re-check the current ahead count before any publication step. Current closeout verification for this docs-retirement batch is recorded in the final task report, not as a permanent live-capability claim.

### Download Live Validation Gate

A planned `--live-validation <scenario>` flag writes manifest metadata only. It is not approval to run live smoke by itself. A case can move to `approved` or `running` only after a separate bounded approval names site, account/profile, case, item limits, output directory, timeout, allowed actions, and stop conditions.

Live validation status values are `not-run`, `planned`, `approved`, `running`, `passed`, `failed`, `blocked`, `skipped`, and `unknown`. Stop immediately on login wall, challenge, rate limit, missing required session, unexpected schema drift, cookies, auth headers, raw cursors, profile roots, browser profile paths, or downloaded private data.

## Download Runner Workstreams

Future download work continues on local `main` in the current project directory. Do not create new branches or
extra worktrees unless the operator explicitly asks.

### Local Main Workstreams

1. Native resolvers
2. Legacy reduction
3. Session governance
4. Live smoke boundaries
5. Release gates

Do not remove a legacy fallback in the same change that introduces an unproven native resolver. Do not treat a reusable profile path as healthy unless health tooling reports it as usable. Do not run live traffic from tests or release scripts without explicit operator approval.

## Social Live Verification

`node src/entrypoints/cli.mjs social live-verify` is the repeatable live acceptance runner for X and Instagram. `node src/entrypoints/cli.mjs social kb-refresh` refreshes scenario-level KB state. `social resume`, `social report`, `social health-watch`, and `social templates` cover archive resume planning, report aggregation, account health checks, and reusable command templates. These commands are plan-first.

Default mode is `not-run`. `social-live-verify` requires explicit `--live`, `--site`, account, item limit, timeout, case timeout, and `--run-root` before it emits even a dry-run live plan. `--execute` is rejected unless `--live` is present and runs selected commands sequentially.

### Natural Language Trigger Guide

| User wording | Intent | Command shape |
| --- | --- | --- |
| `resume full archive` | `resume-full-archive` | `node src/entrypoints/cli.mjs x action profile-content <handle> --content-type posts --full-archive --run-dir <previous-or-new-run> --session-health-plan` or `node src/entrypoints/cli.mjs instagram action ...` |
| `continue after rate limit cooldown` | `resume-after-cooldown` | `node src/entrypoints/cli.mjs x action profile-content <handle> --content-type posts --full-archive --risk-backoff-ms <ms> --risk-retries <n> --session-health-plan` |
| `fast media download` | `media-fast-download` | `node src/entrypoints/cli.mjs x action profile-content <handle> --content-type media --download-media --max-media-downloads <n> --session-health-plan` |
| `session health check` | `health-check` | `node src/entrypoints/cli.mjs social auth-recover --execute --site x|instagram --verify` |
| `live acceptance report` | `live-acceptance-report` | `node src/entrypoints/cli.mjs social live-verify --live --execute --site x|instagram --x-account <handle>` or `--ig-account <handle>` plus explicit limits, timeouts, and `--run-root` |
| `scenario KB refresh` | `kb-refresh` | `node src/entrypoints/cli.mjs social kb-refresh --execute --site x|instagram --x-account <handle>` or `--ig-account <handle>` |

Social matrix status values are `passed`, `failed`, `blocked`, `skipped`, and `unknown`. Artifact classification wins over raw process exit code when an artifact reports blocked or skipped. Login wall, challenge, expired session, platform throttle, rate limit, anti-crawl signal, and missing reusable login state must not be reported as live success.

Useful commands:

```powershell
node .\src\entrypoints\cli.mjs social live-verify
node .\src\entrypoints\cli.mjs social live-verify --live --site instagram --case instagram-followed-date --ig-account instagram --date 2026-04-26 --max-items 10 --max-users 10 --timeout 120000 --case-timeout 600000 --run-root .\runs\social-live-verify
node .\src\entrypoints\cli.mjs social kb-refresh --site all
node .\src\entrypoints\cli.mjs social auth-recover --site x --verify
node .\src\entrypoints\cli.mjs social resume --state .\runs\social-live-verify\<timestamp>\manifest.json --cooldown-minutes 30 --max-attempts 3
node .\src\entrypoints\cli.mjs social report
node .\src\entrypoints\cli.mjs social health-watch --site all
node .\src\entrypoints\cli.mjs social templates --site all
node .\src\entrypoints\cli.mjs social live-verify --live --execute --site all --x-account opensource --ig-account instagram --date 2026-04-26 --max-items 10 --max-users 10 --max-media-downloads 5 --timeout 120000 --case-timeout 600000 --run-root .\runs\social-live-verify
```

Auth recovery remains bounded: use `social-auth-recover` for reusable-profile health checks and visible manual login guidance; cookie import manifests record cookie names/domains and missing required cookie names but never cookie values. Do not automate password/challenge bypass.
