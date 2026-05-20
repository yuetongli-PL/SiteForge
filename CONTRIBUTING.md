# Contributing

This repository is local-first automation infrastructure. Keep changes scoped,
auditable, and safe to publish.

## Before a Commit

Review scope before staging:

- Run `git status --short`.
- Split unrelated work into separate commits where possible.
- Confirm deleted files are intentional.
- Keep local runtime outputs out of Git.

Run the focused checks that match the touched area. The normalized local and CI
quality gate is:

```powershell
npm run verify
```

`npm run verify` runs syntax checks for the public/build entrypoints, the
focused Node CI suite, Python unittest discovery, the prepublish secret scan,
and whitespace validation with `git diff --check`.
`npm run test:node:all` is the broader Node sweep for release-sized changes and
uses a per-test timeout so a slow contract test fails explicitly instead of
hanging the shell.

For broad Site Capability Layer or governed-execution/session changes, add the focused
checks that match the touched area, for example:

```powershell
npm run test:unit
node --test tests\node\site-adapter-contract.test.mjs tests\node\site-onboarding-discovery.test.mjs
node --test tests\node\site-health-recovery.test.mjs tests\node\site-health-execution-gate.test.mjs
node --test tests\node\architecture-import-rules.test.mjs tests\node\planner-policy-handoff.test.mjs
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
`npm run verify` plus the broad Node checks with `npm run test:node:all`; live claims additionally require explicit approval,
bounded scope, stop conditions, and sanitized artifacts.
Release publication checks include `node tools\prepublish-secret-scan.mjs`.

## Safety Boundaries

- Do not commit raw credentials, cookies, CSRF values, authorization headers,
  SESSDATA, tokens, session ids, browser profiles, or equivalent session
  material.
- Do not implement CAPTCHA bypass, MFA bypass, platform-risk bypass,
  access-control bypass, credential extraction, or silent privilege expansion.
- Keep site-specific interpretation in SiteAdapter code.
- Keep reusable mechanisms in capability services.
- Keep download-like execution code as an internal governed consumer path, not
  a top-level architecture layer; it only receives governed tasks, policies,
  minimal session views, and resolved resources.

## Runtime Artifacts

`runs/`, `book-content/`, `knowledge-base/`, `profiles/`, `skills/`,
`crawler-scripts/`, `.playwright-mcp/`, caches, logs, downloaded media, and
generated site data are local artifacts. They should not be committed or kept
as project root directories.

Site profile samples, generated skill output, knowledge-base snapshots, and
crawler metadata belong in explicit test fixtures or a local runtime workspace,
not in root-level site data folders.

## Documentation Source Of Truth

The root files remain the primary source of truth. Historical design and matrix
snapshots were folded into this file or deleted; do not recreate retired docs
or retired fixture archives. Generated preview artifacts should target local
ignored workspaces, not tracked source. Keep durable project guidance in these
root documents:

- `README.md`: public overview, supported workflows, source layout, and common commands.
- `AGENTS.md`: repo-local execution rules for Codex and A/B loop work.
- `CONTRIBUTING.md`: contributor checks, safety gates, operational runbooks, Site Capability Layer matrix, and focused regression batch definition.

The repository-level `docs/` directory is allowed only for explicitly requested,
durable architecture or release maps such as `docs/architecture.md` and
`docs/release-hardening-plan.md`, plus task-specific validation notes an
operator asks to retain. These docs must not duplicate or supersede the matrix;
update the matrix only when implementation status or verification evidence
changes.

Short-lived handoff reports, one-off release notes, dated validation snapshots,
and status tables should be folded into one of those sources or deleted.

## SiteForge Rename Compatibility Record

The user-facing product brand is SiteForge. The physical workspace directory,
legacy GitHub URL examples, historical evidence fixtures, and old runtime
profile roots may still contain `Browser-Wiki-Skill` until external repository,
path, and operator-managed profile migration is explicitly requested.
The recommended post-migration checkout path is
`C:\Users\lyt-p\Desktop\SiteForge`; the legacy
`C:\Users\lyt-p\Desktop\Browser-Wiki-Skill` path is retained only as an active
checkout / historical reference until sessions are closed and the directory is
renamed externally.

New default persistent browser profile roots prefer SiteForge-branded paths.
Runtime code retains Browser-Wiki-Skill fallback candidates only to preserve
existing local profiles without moving, reading, or rewriting browser profile
material. Existing `BrowserWikiSkill:*` Windows Credential Manager targets
remain compatibility identifiers until an operator explicitly approves a
credential-target migration. Do not rewrite local runtime outputs, downloaded
media, generated crawler metadata, or test fixtures whose purpose is to prove
legacy-path redaction or compatibility.

Current allowed legacy-hit reasons:

- `legacy path`: the old checkout path can appear only as an active-session or
  historical path note.
- `GitHub redirect note`: the old repository URL can appear only as a redirect
  or migration reference.
- `historical fixture`: crawler metadata, generated examples, and tests may
  preserve old absolute paths when the path itself is the fixture evidence.
- `compatibility fallback`: browser profile roots, explicit legacy task names,
  and `BrowserWikiSkill:*` credential targets remain readable for existing
  local installations.
- `intentionally deferred`: real browser profile migration and remote
  repository rename are operator-managed external actions.

## Site Capability Compiler / Executor Status

The current Site Capability Compiler / Executor implementation lives in:

- `src/app/compiler/`
- `src/domain/policies/execution/`
- `src/entrypoints/sites/site-capability-compile.mjs`
- `tests/node/site-capability-compiler-executor/`

Current optimized scope: config-backed compile loading from repo-local
`config/site-registry.json` and `config/site-capabilities.json` with repo-local
path guards, source digest and incremental compile summaries, manifest digest
governance, descriptor-only Graph emission with redacted compiler provenance,
Planner dry-run consumption of validated compiler-built Graphs,
`ExecutionPolicyDecision` preflight, redacted `CoverageDelta` artifact queue
preparation, redacted Layer-owned runtime feedback artifact writes, and optional
compiler artifact writes guarded by SecurityGuard / Redaction. Compile artifact
writes now also include redacted Layer feedback files plus a redacted
`site-compile-result-summary.json` machine-readable summary that joins compile
result status, Layer-owned consumer receipt status, and site-specific evidence
summary for downstream Skill generation. `siteforge build <url>` is now the only
public command and runs knowledge-base generation, Graph + Planner Layer compile,
and Skill generation in one build; Skill generation consumes the compile summary
from that same build. The deep remaining paths now have focused evidence: real producer
DOM/a11y/governed-trigger/transport API intake, verified API catalog promotion
behind SiteAdapter/policy/schema/test gates, exact-quorum executable capability
evidence fixtures, and an artifact-backed Layer-owned runtime receipt consumer.

Focused validation:

```powershell
node --test tests\node\site-capability-compiler-executor\*.test.mjs
node --test tests\node\site-capability-remaining-deep-paths.test.mjs
node --test tests\node\progress-cli-integration.test.mjs tests\node\cli-compat.test.mjs tests\node\progress-renderer.test.mjs
node --test tests\node\run-pipeline.test.mjs
node --test tests\node\generate-skill.test.mjs tests\node\skill-coverage-regression-gate.test.mjs
node tools\prepublish-secret-scan.mjs
git diff --check
```

Safety boundaries remain unchanged: the compiler only consumes repo-local
descriptors or redacted artifacts, Planner only consumes validated Graphs, and
execution descriptors do not invoke downloader, SiteAdapter, SessionView,
browser runtime, external telemetry, or live site access.

## Root Compatibility Migration

Do not recreate retired root shims. Use canonical locations:

- Public CLI facade: `siteforge build <url>` through
  `src/entrypoints/cli/index.mjs`.
- Pipeline, skill, crawler, site, social, catalog, and downloader entrypoints
  under `src/entrypoints/` remain implementation details and test fixtures, not
  public commands.
- Compatibility site entrypoints remain under `src/entrypoints/sites/`.
  `scripts/` is only for retained operator wrappers with runtime value; new
  documentation and generated commands should route through `siteforge build
  <url>`.
- Python entrypoints: `src/sites/**/python/*.py`.
- Metadata: `config/site-registry.json` and `config/site-capabilities.json`.

If a caller still depends on old root paths such as `run-pipeline.mjs`,
`download_book.py`, `site-registry.json`, or `site-capabilities.json`, migrate
that caller instead of adding compatibility back.

## Public CLI Boundary

The public SiteForge CLI is intentionally a single-command facade:

```powershell
siteforge build <url>
```

Do not add public `siteforge` subcommands or public `siteforge build` flags by
default. New capabilities should normally enter the build pipeline, the Site
Capability Layer, or a direct internal Node entrypoint. Adding a public
subcommand or flag requires an explicit product decision, matching docs, and
focused tests.

Keep the boundary visible in user-facing copy:

- Public docs, help, failure text, and next-step guidance may show
  `siteforge build <url>`.
- They must not recommend non-build `siteforge` commands.
- They must not recommend adding flags after the build URL.
- Internal maintenance commands must be labeled as internal, operator-only, or
  direct Node entrypoints.

`tests/node/cli-compat.test.mjs` enforces this boundary with runtime checks and
static copy scans. Update that test intentionally if the public surface changes.

## CLI Progress Feedback

Primary long-running Node CLI tasks use `src/infra/cli/progress.mjs` and centralized
copy in `src/infra/cli/progress-copy.mjs`. The renderer is site-agnostic and
supports task, stage, subtask, current item, artifacts, warnings, failures,
download bytes, speed, ETA, retries, skipped-existing counts, and verified
counts.

Rules for internal CLI tasks and maintenance entrypoints:

- Keep stdout machine-readable when the entrypoint returns JSON. Human progress
  goes to stderr.
- Internal entrypoints may keep `--json`, `--quiet`, `--progress`,
  `--force-tty`, and `--no-tty` for focused tests and operator maintenance.
  These flags are not public `siteforge build` flags.
- Interactive mode may use ANSI refresh, Unicode icons, spinner frames,
  progress bars, percent, ETA, and speed.
- Plain mode must be stable line-by-line text with no cursor control, no
  animation frames, and no color by default.
- Public `siteforge build <url>` defaults to a human-readable
  package-manager-style progress panel and summary. It must reject arguments
  after the URL.
- Internal build-only modes such as `--verbose`, `--debug`, `--no-color`,
  `--ascii`, and `--compact` stay behind the direct Node pipeline entrypoint
  and must not be documented as public SiteForge CLI flags.
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

Current public progress-enabled command:

```powershell
siteforge build <url>
```

Jable download-like planning is blocked boundary coverage only. Internal Jable video planning must stop with `jable-native-resolver-required` until a safety-reviewed native resolver exists; do not parse Jable player pages, raw media URLs, CDN URLs, manifests, sessions, or browser profiles.

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

Useful manual verification command:

```powershell
siteforge build <url>
```

## Skill Generation And Install Sync

Skill rendering code lives under `src/skills/generation/`. Root-level
`skills/` directories are generated site data and are not project source.
Work only inside this project directory unless the user explicitly asks to
install or sync a generated skill into Codex.

Manual install or sync must be explicit and should copy from a reviewed
generated artifact path, not from a persistent root-level `skills/` folder.
## Site Capability Layer Design Contract

The Site Capability Layer is a multi-site capability architecture, not a site-specific runtime. Kernel/orchestrator owns lifecycle, context, artifact routing, common safety, schema governance, lifecycle events, and reason semantics. Capability Services own reusable mechanisms such as DOM discovery, accessibility/interaction discovery, network capture, node inventory, API discovery, coverage analysis, unknown-node reporting, security/redaction, session views, risk state, policy handoff, artifact schema, and capability hooks. SiteAdapter owns site identity, URL classification, node/API interpretation, pagination rules, login-state rules, health-signal mapping, field normalization, and capability mapping. Web UI and download are not top-level architecture layers: human interaction is represented by CLI/build records and local confirmation handoff, while download-like execution is an internal governed descriptor path behind StandardTaskList, DownloadPolicy, minimal SessionView, and artifact guards.

Non-goals remain explicit: no CAPTCHA bypass, MFA bypass, anti-bot bypass, access-control bypass, credential extraction, platform-risk evasion, silent privilege expansion, raw cookie persistence, raw CSRF persistence, authorization header persistence, SESSDATA/token/session id persistence, or browser profile persistence.

## Site Capability Layer Implementation Matrix

This compact matrix is the durable Site Capability Layer progress ledger. Keep the numbered sections, field names, status values, and focused regression JSON anchor stable; compress old validation history into the latest useful evidence.

### 1. Kernel orchestration
- Section name: Kernel orchestration
- Requirement summary: Keep orchestration site-agnostic and route work through capability services, registries, and governed stages.
- Current status: `verified`
- Existing code evidence: `src/entrypoints/cli/index.mjs`, `src/entrypoints/pipeline/run-pipeline.mjs`, `src/app/pipeline/runtime/create-default-runtime.mjs`, `src/app/pipeline/engine/stage-spec.mjs`, `src/app/pipeline/stages/capability-compile.mjs`, and `src/app/pipeline/build/` keep the public build facade, setup assistant, and URL-to-Skill DAG path site-agnostic.
- Existing test evidence: `tests/node/site-capability-kernel-contract.test.mjs`, `tests/node/layer-boundaries.test.mjs`, `tests/node/siteforge-build.test.mjs`, and architecture import rules cover the boundary, including non-interactive first-run setup handling and saved-profile reuse.
- Verification command: `node --test tests/node/progress-cli-integration.test.mjs tests/node/cli-compat.test.mjs tests/node/progress-renderer.test.mjs tests/node/run-pipeline.test.mjs tests/node/architecture-import-rules.test.mjs`; 2026-05-17 terminal UX smoke: `node --input-type=module -` against `renderSiteForgeBuildSummary`.
- Verification result: Focused CLI, build orchestration, and architecture import gates passed for the current site-agnostic Kernel boundary. 2026-05-17 terminal UX smoke confirmed the default build summary keeps debug reason codes and URL secrets out of user output while preserving the layered summary.
- Current gaps: None for the documented Kernel boundary.
- Next smallest task: Keep future site-specific routing out of Kernel modules.
- Risk notes: Treat direct concrete-site imports into Kernel as release blockers.
- Last updated: 2026-05-17

### 2. Capability service inventory
- Section name: Capability service inventory
- Requirement summary: Keep reusable cross-site mechanisms discoverable as capability services without site-specific behavior.
- Current status: `verified`
- Existing code evidence: `src/domain/capabilities/service-inventory.mjs`, trust-boundary modules, SecurityGuard, SessionView, policy, and lifecycle services define the inventory.
- Existing test evidence: `tests/node/service-inventory.test.mjs`, `tests/node/layer-boundaries.test.mjs`, and architecture import rules validate exported symbols and dependency direction.
- Verification command: `node --test tests/node/service-inventory.test.mjs tests/node/layer-boundaries.test.mjs tests/node/architecture-import-rules.test.mjs`
- Verification result: Capability service inventory and dependency boundary checks passed.
- Current gaps: None for the current service inventory.
- Next smallest task: Add inventory descriptors with tests when introducing a new reusable service.
- Risk notes: Capability services must not encode concrete site semantics or browser profile material.
- Last updated: 2026-05-16

### 3. SiteAdapter registry and contracts
- Section name: SiteAdapter registry and contracts
- Requirement summary: Keep site-specific interpretation behind SiteAdapter contracts and registry lookups.
- Current status: `verified`
- Existing code evidence: SiteAdapter registry, capability evidence fixtures, site modules, and `src/app/pipeline/build/pipeline.mjs` keep site interpretation out of Kernel and internal execution paths. `siteforge build <url>` writes per-site generated adapter profile and contract artifacts under the build workspace and `.siteforge/sites/<site_id>/adapter/`. The retired local Web interaction layer has been physically removed; build artifacts remain file/CLI driven.
- Existing test evidence: `tests/node/site-adapter-contract.test.mjs`, `tests/node/site-onboarding-discovery.test.mjs`, architecture import rules, and `tests/node/siteforge-build.test.mjs` cover contracts, ownership, generated per-site adapter artifacts, generated contract self-tests, current promotion, and crawl checkpoint linkage.
- Verification command: `node --test tests/node/siteforge-build.test.mjs --test-name-pattern "full-coverage catalog|route-family representatives|compiles the deterministic simple-shop"`
- Verification result: 2026-05-17 per-site adapter contract batch passed SiteForge build fixture coverage, route-family representative coverage, and deterministic fixture build checks. 2026-05-20 cleanup retired the local Web interaction layer and removed its stale test evidence from the matrix.
- Current gaps: None for current adapters.
- 2026-05-20 interaction-surface evidence update: Section 3 records the adapter-review contract as file/CLI driven build evidence, not a separate Web UI architecture layer. The old Web review panels and `web-interaction-*` source files must not be restored. Later 2026-05-20 A/B hardening kept Jable `download-content` blocked with `jable-native-resolver-required` when known-policy execution metadata is present and treats `download_high` replay as guarded/blocked.
- Next smallest task: Require contract fixtures before adding or promoting a new adapter capability.
- Risk notes: Do not move SiteAdapter semantics into internal execution paths or Kernel. Do not restore the deleted legacy panels as part of adapter evidence; the reference capability-map workspace is the retained review contract.
- Last updated: 2026-05-20

### 4. Reason semantics
- Section name: Reason semantics
- Requirement summary: Use stable reasonCode and safe-stop semantics across capture, session, health, downloader, planner, and Layer outputs.
- Current status: `verified`
- Existing code evidence: `src/domain/risks/reason-codes.mjs`, risk/health modules, downloader manifests, and social/session reporters share reason semantics.
- Existing test evidence: `tests/node/reason-codes.test.mjs`, risk-state tests, downloader tests, and site health tests cover mappings.
- Verification command: `node --test tests/node/reason-codes.test.mjs tests/node/risk-state.test.mjs tests/node/site-health-recovery.test.mjs`
- Verification result: Reason semantics focused gates passed with safe-stop mappings preserved.
- Current gaps: None for current reasonCode coverage.
- Next smallest task: Add reasonCode tests before introducing new failure or blocked states.
- Risk notes: Never report challenge, login wall, risk control, or access-control stops as success.
- Last updated: 2026-05-16

### 5. Risk and health recovery
- Section name: Risk and health recovery
- Requirement summary: Detect health/risk states, quarantine unsafe profiles, and require manual action instead of bypassing controls.
- Current status: `verified`
- Existing code evidence: Site health recovery, risk-state handling, session repair planning, and manual health guidance enforce visible recovery boundaries.
- Existing test evidence: `tests/node/site-health-recovery.test.mjs`, `tests/node/site-health-execution-gate.test.mjs`, and session repair tests cover profile-health-risk handling.
- Verification command: `node --test tests/node/site-health-recovery.test.mjs tests/node/site-health-execution-gate.test.mjs tests/node/session-repair-plan.test.mjs tests/node/session-repair-command.test.mjs`
- Verification result: Health recovery and execution-gate tests passed for manual recovery boundaries.
- Current gaps: None for current profile-health-risk policy.
- Next smallest task: Keep recovery additions dry-run or approval-gated before any live profile mutation.
- Risk notes: Do not delete, rebuild, or mutate browser profiles automatically.
- Last updated: 2026-05-16

### 6. Node discovery and inventory
- Section name: Node discovery and inventory
- Requirement summary: Produce bounded node inventories, unknown/blocked reports, and descriptor-only route evidence without executing risky actions.
- Current status: `verified`
- Existing code evidence: `src/domain/capabilities/site-onboarding-discovery.mjs`, capture expansion, route descriptor producers, `src/app/pipeline/build/auto-discovery.mjs`, `src/app/pipeline/build/pipeline.mjs`, and `src/app/pipeline/build/output-validation.mjs` generate bounded node evidence, preserve closure summaries, model X SPA route/tab/state structure without raw content, and fail closed for live robots-unavailable or robots-disallowed generic seed discovery before crawl or skill generation.
- Existing test evidence: `tests/node/site-onboarding-discovery.test.mjs`, `tests/node/capture-expand.test.mjs`, browser runtime session tests, `tests/node/siteforge-build.test.mjs`, and `tests/node/siteforge-output-validation.test.mjs` cover DOM, route, blocked-node descriptors, fixture robots determinism, live robots unavailable blocking, live `Disallow: /` early stop, and pre-promotion validation rejection for missing live robots evidence.
- Verification command: `node --test tests/node/siteforge-build.test.mjs tests/node/siteforge-output-validation.test.mjs`; `node --test tests/node/site-onboarding-discovery.test.mjs tests/node/capture-expand.test.mjs tests/node/browser-runtime-session.test.mjs`; 2026-05-17 focused auto-discovery smoke: `node --input-type=module -` with injected X user-authorized summaries.
- Verification result: SiteForge robots fail-closed focused gates passed with live robots-unavailable and live `Disallow: /` stopping before generic crawl or skill generation; prior node discovery and inventory focused gates passed with unknown, blocked, and descriptor-only route evidence retained. 2026-05-17 auto-discovery smoke passed with X default model `nodes_total=109`, `actionable_elements=238`, and deep/network pipeline graph types `page`, `content`, `operation`, `modal`, and `route_template`.
- Current gaps: None for bounded discovery artifacts.
- Next smallest task: Refresh X output regression expectations for the default auto-discovery path, then add descriptor fields and redaction tests when new node sources are captured.
- Risk notes: Discovery artifacts must not claim live full-web coverage or execute follow-up actions.
- Last updated: 2026-05-17

### 7. API discovery and catalog lifecycle
- Section name: API discovery and catalog lifecycle
- Requirement summary: Record observed API candidates safely and promote only verified candidates through policy, schema, test, and adapter evidence.
- Current status: `verified`
- Existing code evidence: API discovery, candidate normalization, preflight correlation, shape/message gaps, multi-step correlation, and API catalog promotion gates are implemented.
- Existing test evidence: `tests/node/api-discovery.test.mjs`, `tests/node/api-candidates.test.mjs`, `tests/node/site-onboarding-discovery.test.mjs`, and catalog promotion tests cover lifecycle transitions.
- Verification command: `node --test tests/node/api-discovery.test.mjs tests/node/api-candidates.test.mjs tests/node/site-onboarding-discovery.test.mjs`
- Verification result: API discovery and catalog lifecycle tests passed with observed-only candidates kept out of executable catalogs until verified.
- Current gaps: None for current observed and verified API lifecycle gates.
- Next smallest task: Add schema/test/policy evidence before enabling any new API catalog promotion.
- Risk notes: Do not replay observed requests, persist raw headers or bodies, or auto-promote observed APIs.
- Last updated: 2026-05-16

### 8. Artifact redaction and safety
- Section name: Artifact redaction and safety
- Requirement summary: Guard persistent artifact writes with SecurityGuard redaction, audit sidecars, and fail-closed behavior.
- Current status: `verified`
- Existing code evidence: SecurityGuard, artifact writer guards, redaction audits, partial preview writers, planner artifacts, download/session reports, auto-discovery summaries, `src/app/pipeline/build/risk-policy.mjs`, `src/app/pipeline/build/capability-interaction.mjs`, `src/app/pipeline/build/confirmation-flow.mjs`, normalized capability evidence in `src/app/pipeline/build/models.mjs`, setup evidence sanitization in `src/app/pipeline/build/setup-assistant.mjs`, and output validation privacy gates enforce guarded writes and keep X SPA/network observations to redacted structure fields only.
- Existing test evidence: `tests/node/security-guard-redaction.test.mjs`, `tests/node/test-coverage-regression.test.mjs`, `tests/node/siteforge-output-validation.test.mjs`, artifact guard tests, planner artifact tests, and download/session report tests cover sensitive write protection.
- Verification command: `node --test tests/node/siteforge-output-validation.test.mjs`; `node --test tests/node/siteforge-auto-capabilities.test.mjs`; `node --test tests/node/siteforge-x-generic-live-uncollectable.test.mjs`; `node --test tests/node/siteforge-build-x-output-regression.test.mjs`; syntax checks for touched `src/app/pipeline/build/*.mjs`; `git diff --check`
- Verification result: 2026-05-17 risk-policy calibration batch passed output validation, X auto-capability risk coverage, X user-authorized/generic gates, X user-output golden regression, syntax, and whitespace checks. 2026-05-17 capability selection model batch passed focused interaction, confirmation-flow, output-validation, and X output-regression tests; confirmation records now include usable safe-path metadata, disabled selections write `capability_remediation_plan.json`, and remediation plans distinguish immediate limited-use entries from explicit SiteAdapter-verification entries without enabling high-risk final actions. Recommended/following timelines are personal reads, followers/bookmarks/notifications require confirmation, private message and private body surfaces stay disabled, and high-risk writes remain discoverable but non-callable. 2026-05-17 route-state replay hardening added static crawl redaction coverage for page text, form values, and sensitive URLs, and passed `tests/node/siteforge-build-hardening.test.mjs` with the route-state focused tests.
- Current gaps: None for current artifact write surfaces.
- Next smallest task: Require fail-closed redaction tests for every new persisted artifact family.
- Risk notes: Raw cookies, authorization headers, tokens, sessions, profile paths, raw DOM/HTML, page bodies, DM bodies, notification bodies, and sensitive diagnostics must never be written.
- Last updated: 2026-05-17

### 9. SessionView and trust boundaries
- Section name: SessionView and trust boundaries
- Requirement summary: Materialize only minimal session views for approved purposes and prevent broad credential/profile access.
- Current status: `verified`
- Existing code evidence: SessionView, trust-boundary registry, unified session health planning, social auth import validation, and social/session health handoffs isolate sensitive state.
- Existing test evidence: `tests/node/session-view.test.mjs`, `tests/node/social-auth-import.test.mjs`, trust-boundary tests, social auth recovery tests, and architecture import rules cover purpose isolation.
- Verification command: `node --test tests/node/session-view.test.mjs tests/node/social-auth-import.test.mjs tests/node/social-auth-recover.test.mjs tests/node/architecture-import-rules.test.mjs`
- Verification result: SessionView and trust-boundary gates passed with raw session/profile material excluded from consumers, non-ready views prevented from granting permissions, expired ready views rejected when evaluated with `now`, and invalid cookie import inputs rejected before browser-profile mutation.
- Current gaps: No known gap for current session consumers; bridge-level expired-manifest coverage should be added before new consumers depend on time-bound leases.
- Next smallest task: Add a bridge-level regression for expired ready manifests flowing through `sessionOptionsFromRunManifest(..., { now })`.
- Risk notes: Downloader and Layer consumers must not receive raw credentials, browser profiles, or unredacted session material.
- Last updated: 2026-05-16

### 10. Downloader boundary
- Section name: Downloader boundary
- Requirement summary: Keep downloader as a low-permission consumer of planned tasks, policies, minimal session views, and resolved resources.
- Current status: `verified`
- Existing code evidence: The executable shared download runtime is physically removed. The retained boundary is descriptor-only: `src/domain/policies/standard-task-list.mjs`, `src/domain/policies/download-policy.mjs`, `src/app/planner/policy-handoff.mjs`, SessionView/trust-boundary contracts, and stable config gates prevent low-permission consumers from receiving raw credentials, raw profiles, or retired runtime paths.
- Existing test evidence: architecture import rules, `tests/node/standard-task-list.test.mjs`, `tests/node/download-policy.test.mjs`, and `tests/node/planner-policy-handoff.test.mjs` cover the remaining descriptor-only planning/policy contracts after the download runtime layer was removed.
- Verification command: `node --test tests/node/architecture-import-rules.test.mjs tests/node/standard-task-list.test.mjs tests/node/download-policy.test.mjs tests/node/planner-policy-handoff.test.mjs`
- Verification result: Descriptor-only downloader boundary gates passed after removing `src/sites/downloads/`, `src/entrypoints/sites/download.mjs`, and stable config references to retired download planner/resolver/executor paths.
- Current gaps: None for the current descriptor-only boundary.
- Next smallest task: Add a policy/SessionView/StandardTaskList regression before any new low-permission consumer is introduced.
- Risk notes: Do not parse raw player pages, raw media URLs, CDN manifests, sessions, or browser profiles through a shared download runtime.
- Last updated: 2026-05-20

### 11. Planner policy handoff
- Section name: Planner policy handoff
- Requirement summary: Pass validated graph and policy descriptors to Planner/Layer without executing downloader, SiteAdapter runtime, SessionView, or live tasks.
- Current status: `verified`
- Existing code evidence: Planner policy handoff, standard task lists, capability compile stage, and Layer-owned disabled consumers keep execution descriptor-only.
- Existing test evidence: `tests/node/planner-policy-handoff.test.mjs`, `tests/node/standard-task-list.test.mjs`, compiler executor tests, and run-pipeline tests cover handoff order.
- Verification command: `node --test tests/node/planner-policy-handoff.test.mjs tests/node/standard-task-list.test.mjs tests/node/site-capability-compiler-executor/compile-entrypoint.test.mjs tests/node/run-pipeline.test.mjs`
- Verification result: Planner policy handoff and capability compile integration tests passed with descriptor-only execution retained. 2026-05-17 safe-path descriptor batch passed web interaction model/server tests and SiteAdapter contract tests; sensitive reads now require a capability-level safe execution path before test success.
- Current gaps: None for current handoff shape.
- Next smallest task: Add policy fixtures before enabling new executor paths.
- Risk notes: Planner handoff cannot promote observed APIs, execute recovery, or materialize SessionView.
- Last updated: 2026-05-17

### 12. Schema governance and versioning
- Section name: Schema governance and versioning
- Requirement summary: Keep Kernel, SiteAdapter, CapabilityService, downloader, API catalog, artifact, and focused-regression contracts versioned and compatibility-checked.
- Current status: `verified`
- Existing code evidence: Schema inventory and compatibility registry record Kernel versioning, SiteAdapter versioning, CapabilityService versioning, downloader versioning, API catalog versioning, artifact versions, and FocusedRegressionBatchDefinition compatibility.
- Existing test evidence: `tests/node/schema-governance.test.mjs`, `tests/node/schema-inventory.test.mjs`, `tests/node/compatibility-registry.test.mjs`, and version compatibility tests cover governed contracts.
- Verification command: `node --test tests/node/schema-governance.test.mjs tests/node/schema-inventory.test.mjs tests/node/compatibility-registry.test.mjs`
- Verification result: Schema governance and compatibility tests passed for Kernel, SiteAdapter, CapabilityService, downloader, API catalog, artifacts, and regression batch definitions.
- Current gaps: None for current contract versions.
- Next smallest task: Add schema inventory and compatibility assertions before incompatible field changes.
- Risk notes: Incompatible or future schema versions must fail closed.
- Last updated: 2026-05-16

### 13. Lifecycle events and capability hooks
- Section name: Lifecycle events and capability hooks
- Requirement summary: Record descriptor-only lifecycle events and hook matches without executing hook code or registering live subscribers.
- Current status: `verified`
- Existing code evidence: Lifecycle events, capability-hook inventory, Layer-owned receipt events, and runtime producer descriptors are implemented as descriptor-only evidence.
- Existing test evidence: `tests/node/lifecycle-events.test.mjs`, `tests/node/capability-hook.test.mjs`, and remaining deep-path tests cover producer and hook metadata.
- Verification command: `node --test tests/node/lifecycle-events.test.mjs tests/node/capability-hook.test.mjs tests/node/site-capability-remaining-deep-paths.test.mjs`
- Verification result: Lifecycle and capability hook tests passed with descriptor-only hook matches and producer inventory aligned.
- Current gaps: None for current lifecycle event types.
- Next smallest task: Add producer descriptors when new lifecycle event types are introduced.
- Risk notes: Hook discovery is descriptor-only; executable dispatch remains disabled.
- Last updated: 2026-05-16

### 14. Data-flow evidence
- Section name: Data-flow evidence
- Requirement summary: Preserve auditable data-flow evidence from capture through discovery, compiler, planner, Layer receipt, and Skill generation.
- Current status: `verified`
- Existing code evidence: Capture outputs, onboarding reports, compiler summaries, Layer feedback artifacts, Skill compile-summary consumption, capability evidence normalization, risk-policy summaries, and validation gates preserve a linked evidence chain.
- Existing test evidence: `tests/node/site-capability-data-flow.test.mjs`, `tests/node/site-onboarding-discovery.test.mjs`, `tests/node/run-pipeline.test.mjs`, `tests/node/siteforge-output-validation.test.mjs`, `tests/node/siteforge-auto-capabilities.test.mjs`, and compiler executor tests cover the chain.
- Verification command: `node --test tests/node/siteforge-output-validation.test.mjs`; `node --test tests/node/siteforge-auto-capabilities.test.mjs`; `node --test tests/node/siteforge-x-generic-live-uncollectable.test.mjs`
- Verification result: 2026-05-17 risk-policy calibration batch passed. Each generated capability evidence object records `source`/`evidence_source`, `evidence_status`, `saved_material=sanitized_summary_only`, `raw_content_saved=false`, and `private_content_saved=false`; personal/private X capability records now carry conservative default policies without routing private bodies or high-risk writes into callable intents.
- Current gaps: None for current data-flow evidence.
- Next smallest task: Keep new producers connected to redacted artifact refs, sanitized evidence objects, risk-policy summaries, and matrix evidence.
- Risk notes: Evidence flow must not include raw browser profiles, sessions, credentials, or live runtime payloads.
- Last updated: 2026-05-16

### 15. Site health execution gate
- Section name: Site health execution gate
- Requirement summary: Keep health checks bounded, report risk states honestly, and require explicit operator approval for live recovery.
- Current status: `verified`
- Existing code evidence: Site health execution gate, social auth recovery, session repair planning, and manual health boundaries enforce approval-gated recovery.
- Existing test evidence: `tests/node/site-health-execution-gate.test.mjs`, `tests/node/site-health-recovery.test.mjs`, and social auth recovery tests cover health gates.
- Verification command: `node --test tests/node/site-health-execution-gate.test.mjs tests/node/site-health-recovery.test.mjs tests/node/social-auth-recover.test.mjs`
- Verification result: Site health execution and social auth recovery gates passed with profile-health-risk treated as manual recovery.
- Current gaps: None for current health execution gates.
- Next smallest task: Add explicit stop conditions before any live health workflow expansion.
- Risk notes: Do not bypass CAPTCHA, platform risk controls, permissions, account restrictions, or login walls.
- Last updated: 2026-05-16

### 16. Site onboarding producer integration
- Section name: Site onboarding producer integration
- Requirement summary: Produce the onboarding artifact set for new sites, including inventory, blocked/unknown reports, capability targets, gaps, audit, and closure summaries.
- Current status: `verified`
- Existing code evidence: Site onboarding discovery and site-doctor write NODE/API inventories, UNKNOWN/BLOCKED reports, CAPABILITY_TARGETS, CAPABILITY_GAP_REPORT, SITE_CAPABILITY_REPORT, and DISCOVERY_AUDIT.
- Existing test evidence: `tests/node/site-onboarding-discovery.test.mjs`, `tests/node/site-onboarding.test.mjs`, and capture-expand tests cover producer artifacts and redacted reports.
- Verification command: `node --test tests/node/site-onboarding-discovery.test.mjs tests/node/site-onboarding.test.mjs tests/node/capture-expand.test.mjs`
- Verification result: Onboarding producer integration gates passed with artifact accounting and closure evidence present.
- Current gaps: None for the current producer set.
- Next smallest task: Keep new site intake full-scope or explicitly blocked before reporting onboarding complete.
- Risk notes: Login, paywall, VIP, CAPTCHA, risk-control, permission, and rate-limit surfaces must be recorded as blocked, not bypassed.
- Last updated: 2026-05-16

### 17. Focused regression strategy
- Section name: Focused regression strategy
- Requirement summary: Prefer directly related tests and 3-5 same-type batches, rerun matrix checks after matrix updates, and defer wildcard Node/Python full suites unless release scope requires them.
- Current status: `verified`
- Existing code evidence: `CONTRIBUTING.md#focused-regression-batch-definition`, `src/domain/capabilities/focused-regression-batches.mjs`, `layeredValidationPolicy`, LifecycleEvent coverage, and focused batch definitions encode the strategy.
- Existing test evidence: `tests/node/site-capability-regression-batches.test.mjs`, `tests/node/site-capability-matrix.test.mjs`, `tests/node/siteforge-build.test.mjs`, `tests/node/session-view.test.mjs`, `tests/node/security-guard-redaction.test.mjs`, `tests/node/risk-state.test.mjs`, `tests/node/reason-codes.test.mjs`, `tests/node/capability-hook.test.mjs`, `tests/node/standard-task-list.test.mjs`, and `tests/node/download-policy.test.mjs` are priority coverage.
- Verification command: `node --test tests/node/site-capability-regression-batches.test.mjs tests/node/site-capability-matrix.test.mjs tests/node/schema-inventory.test.mjs`
- Verification result: Focused regression batch and matrix tests passed; directly related tests remain the default and broad wildcard suites stay release-scope only. 2026-05-20 cleanup retired the local Web interaction and download runtime layers, removed their stale focused tests from active regression commands, and kept descriptor-only planning/session/schema guards as the active coverage surface.
- Current gaps: None for the current focused regression strategy.
- Next smallest task: Update the batch JSON and this section together when a new validation tier is added.
- Risk notes: Do not promote status from documentation-only edits or unrun suites.
- Last updated: 2026-05-20

### 18. New site onboarding completion
- Section name: New site onboarding completion
- Requirement summary: Treat a bare new-site URL as full onboarding unless a surface is explicitly blocked and recorded.
- Current status: `verified`
- Existing code evidence: Profile/registry/capability records, SiteAdapter mapping, repo-local skill generation, discovery artifacts, coverage gates, and contract tests define full intake.
- Existing test evidence: `tests/node/site-onboarding.test.mjs`, `tests/node/site-onboarding-discovery.test.mjs`, site adapter contract tests, generated-skill tests, and the controlled `https://news.qq.com/` fixture/public-CLI pilot in `tests/node/siteforge-build.test.mjs` cover completion.
- Verification command: `node --test tests/node/site-onboarding.test.mjs tests/node/site-onboarding-discovery.test.mjs tests/node/site-adapter-contract.test.mjs tests/node/siteforge-build.test.mjs`
- Verification result: New-site onboarding completion gates passed for the current verified scope. The active tests no longer depend on checked-in legacy `profiles/*.json` or repo-local skill snapshots; they validate generated profiles, discovery artifacts, adapter contracts, and the public `siteforge build <url>` fixture path.
- Current gaps: None for current completed sites.
- Next smallest task: For each new URL, complete or explicitly block profile, registry, capability record, SiteAdapter mapping, skill, discovery artifacts, coverage gate, contract tests, matrix update, and review acceptance.
- Risk notes: Do not report a site as onboarded after only adding a profile, registry row, or skill.
- Last updated: 2026-05-20

### 19. Standard artifacts and inventories
- Section name: Standard artifacts and inventories
- Requirement summary: Keep artifact schemas, inventories, manifests, compile summaries, and regression batches governed and redacted.
- Current status: `verified`
- Existing code evidence: Artifact schema, schema inventory, onboarding inventories, API catalog artifacts, manifest bundles, partial preview artifacts, compile summaries, setup assistant artifacts (`setup_plan.json`, `user_choices.json`, `capability_hints.json`, `build_profile.json`), output validation gates in `src/app/pipeline/build/output-validation.mjs`, risk defaults in `src/app/pipeline/build/risk-policy.mjs`, visible disabled high-risk capability records, candidate capability blocks for execution plans and registry lookup, candidate-debug-only global intent filtering, per-site URL-to-Skill DAG workspaces under `.siteforge/sites/<site_id>/builds/<build_id>/`, generated per-site adapter contracts under `.siteforge/sites/<site_id>/adapter/`, `generated_adapter.json`, `adapter_contract_tests.json`, crawl checkpoints in `crawl_checkpoint.json`, verified active skill promotion under `.siteforge/sites/<site_id>/current/`, verified-only per-site runtime lookup through `.siteforge/sites/<site_id>/registry.json`, stable `last_successful_build.json`, normalized build report URLs, `confirmation_paths`, sanitized `capability_confirmations.json` decision records, `capability_remediation_plan.json` safe-path records, user-authorized collection review summaries in user/debug reports, redacted setup hint details, auto-discovery summary artifacts, safe build failure reason codes, and FocusedRegressionBatchDefinition are implemented. Retired Web UI and shared download runtime artifact families remain physically absent.
- Existing test evidence: `tests/node/schema-inventory.test.mjs`, `tests/node/schema-governance.test.mjs`, `tests/node/siteforge-output-validation.test.mjs`, `tests/node/siteforge-auto-capabilities.test.mjs`, `tests/node/siteforge-build.test.mjs`, `tests/node/siteforge-build-hardening.test.mjs`, `tests/node/siteforge-runtime-registry.test.mjs`, `tests/node/test-coverage-regression.test.mjs`, `tests/node/siteforge-confirmation-flow.test.mjs`, `tests/node/siteforge-build-x-output-regression.test.mjs`, `tests/node/cli-compat.test.mjs`, `tests/node/site-onboarding-discovery.test.mjs`, `tests/node/api-candidates.test.mjs`, compiler executor tests, generate-skill tests, and graph matrix tests cover artifact compatibility, including confirmation-required command paths, manual/default separation, validation error non-promotion, profile snapshots, ArtifactStore workspace containment, cross-site context rejection, current promotion, runtime domain/utterance registry lookup, candidate plan/lookup rejection, disabled high-risk non-callable intents, failed-record lookup rejection, and unsuccessful-build isolation.
- Verification command: `node --test tests/node/siteforge-output-validation.test.mjs`; `node --test tests/node/siteforge-auto-capabilities.test.mjs`; `node --test tests/node/siteforge-x-generic-live-uncollectable.test.mjs`; `node --test tests/node/siteforge-confirmation-flow.test.mjs tests/node/cli-compat.test.mjs`; `node --test tests/node/siteforge-build-x-output-regression.test.mjs`
- Verification result: 2026-05-21 broad artifact and inventory validation passed through `npm run test:node:all` with 1680 passed, 1 optional live smoke omitted by design, and zero failures. Focused SiteForge build, output validation, confirmation, runtime registry, compiler/planner, schema, documentation generation, cleanup boundary, and architecture import tests remain green with retired Web UI and shared download runtime paths absent.
- Current gaps: None for current standard artifact and inventory surfaces.
- Next smallest task: Add schema inventory and compatibility evidence before adding new artifact families.
- Risk notes: Artifact schemas must remain compatible before writes proceed. Do not reintroduce retired Web UI or shared download runtime artifact families as standard inventory surfaces.
- Last updated: 2026-05-21

### 20. Final goal
- Section name: Final goal
- Requirement summary: Complete the Site Capability Layer only when Sections 1-20 are verified and Agent B accepts the final state.
- Current status: `verified`
- Existing code evidence: The implementation matrix, compiler/executor, planner, downloader boundary, API lifecycle, SecurityGuard, SessionView, standard artifact paths, and deterministic URL-to-Skill build DAG are integrated for the verified scope.
- Existing test evidence: Matrix, regression, URL-to-Skill fixture build, download boundary, API, security, compiler/executor, architecture import, full Node, Python, secret scan, and whitespace gates cover the final state.
- Verification command: `npm run check:syntax`; `npm run test:node:focused`; `npm run test:node:all`; `npm run test:python`; `npm run scan:secrets`; `git diff --check`
- Verification result: 2026-05-21 final validation evidence: matrix gate passed; regression focused gate passed; download boundary gate passed; API focused gate passed; security focused gate passed; syntax gate passed; broad Node gate passed with 1680 pass and one optional live smoke omitted by design; focused Node gate passed with 296 pass and one optional live smoke omitted by design; Python gate passed with 60 tests; documentation generation gate passed; secret scan passed with 512 candidate files; whitespace gate passed with CRLF warnings only; Agent B final review will run on the staged commit set before GitHub merge.
- Current gaps: None for the verified Site Capability Layer scope.
- Next smallest task: Keep future changes in small focused batches with matrix updates when status evidence changes.
- Risk notes: No known serious safety or architecture violation remains for the current verified scope; future live claims still require explicit operator approval.
- Last updated: 2026-05-21

## SiteForge Tencent News Validation

`siteforge build https://news.qq.com/` has a controlled validation path for a
large public news portal. This section is the durable source-of-truth summary;
short-lived task notes were folded back into root documentation and removed from
`docs/`.

- Scope: shallow public content analysis only; no login, comment submit,
  account, upload, payment, checkout, mutation, CAPTCHA, or access-control
  bypass flow.
- Robots: `robots.txt` is parsed before seed and crawl expansion. `Disallow`
  rules are enforced for seeds and static crawl queue entries. The deterministic
  Tencent fixture asserts `/qqfile/`, `/sv1/`, and `/answer/` are excluded.
- Sitemap: sitemap indexes are expanded with a bounded `maxSitemaps` cap and
  sitemap XML files are not treated as page nodes.
- Limits: live smoke uses low depth/page/seed limits and fetch timeout/delay
  controls. The default CLI path also has bounded `maxPages`, `maxSeeds`, and
  `maxSitemaps` policies.
- Deterministic fixture: `tests/fixtures/sites/news-qq-com/` uses the real root
  URL `https://news.qq.com/` and validates homepage, channel, article, sitemap,
  and robots-disallowed links.
- CI fixture routing: `src/app/pipeline/build/source.mjs` maps
  `news.qq.com` to the deterministic fixture by default, so the public command
  remains `siteforge build https://news.qq.com/` with no fixture flag.
- Expected active fixture capabilities: `view news homepage`, `browse news
  channels`, and `view news article details`, all read-only and evidence-backed.
- Registry validation: the deterministic test proves `news.qq.com` plus
  `帮我看腾讯新闻首页` resolves to the generated Tencent News skill and homepage
  capability; channel lookup is covered when channel evidence exists.
- Latest deterministic CLI evidence: `node --test
  tests\node\siteforge-build.test.mjs` passed on 2026-05-16, including the
  public no-extra-param `siteforge build https://news.qq.com/` saved-profile
  path with fixture evidence, `verification_report.json: passed`, and zero
  crawled `/qqfile/`, `/sv1/`, or `/answer/` seed/page URLs.
- Latest live smoke evidence: the opt-in live test passed on 2026-05-16 with
  internal fixture routing disabled and shallow limits. This is smoke evidence,
  not a broad live capability claim.
- Optional live smoke: set `SITEFORGE_LIVE_NEWS_QQ=1` or
  `SITEFORGE_LIVE_TESTS=1` before running `node --test
  tests\node\siteforge-build.test.mjs`. Live failures may skip while preserving
  artifacts; deterministic fixture coverage remains the CI path.

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
      "command": "node --test --test-name-pattern \"kernel and pipeline boundary imports stay behind registries or capability services|non-goal boundary classifier catches raw session reads and SecurityGuard bypasses|capability services do not depend on concrete sites or runtime orchestration layers|NetworkCapture observed requests do not classify site semantics|SessionView purpose isolation blocks non-download purposes from download access and broad scopes|Section 20 final goal cannot be verified before prerequisite sections and final validation evidence\" tests/node/architecture-import-rules.test.mjs tests/node/network-capture.test.mjs tests/node/session-view.test.mjs tests/node/site-capability-matrix.test.mjs",
      "purpose": "Accelerated verification for recently added focused guards: architecture boundary checks, NetworkCapture no-site-semantics, SessionView purpose isolation, and the Section 20 final-goal readiness gate."
    },
    {
      "id": "scl-redaction-trust-boundaries",
      "sectionFocus": [13, 14],
      "command": "node --test tests/node/security-guard-redaction.test.mjs tests/node/session-view.test.mjs",
      "purpose": "Validate redaction guards and SessionView trust-boundary behavior."
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
      "command": "node --test tests/node/architecture-import-rules.test.mjs tests/node/standard-task-list.test.mjs tests/node/download-policy.test.mjs tests/node/planner-policy-handoff.test.mjs",
      "purpose": "Validate downloader boundaries, StandardTaskList, DownloadPolicy, and planner-policy handoff contracts."
    },
    {
      "id": "scl-risk-lifecycle-observability",
      "sectionFocus": [9, 15, 16, 18],
      "command": "node --test tests/node/risk-state.test.mjs tests/node/reason-codes.test.mjs tests/node/lifecycle-events.test.mjs tests/node/capability-hook.test.mjs",
      "purpose": "Validate RiskState, reasonCode, LifecycleEvent, and CapabilityHook contracts."
    },
    {
      "id": "scl-siteforge-build-single-command",
      "sectionFocus": [1, 11, 14, 17, 18, 19, 20],
      "command": "node --test tests/node/progress-cli-integration.test.mjs tests/node/cli-compat.test.mjs tests/node/progress-renderer.test.mjs tests/node/run-pipeline.test.mjs tests/node/site-capability-compiler-executor/compile-entrypoint.test.mjs tests/node/site-capability-compiler-executor/planner-integration.test.mjs tests/node/generate-skill.test.mjs tests/node/skill-coverage-regression-gate.test.mjs tests/node/architecture-import-rules.test.mjs",
      "purpose": "Validate that the public SiteForge CLI exposes only siteforge build <url>, that build includes Graph and Planner Layer compile before Skill generation, and that architecture boundaries remain intact."
    },
    {
      "id": "scl-recent-high-value-focused-regression",
      "sectionFocus": [1, 2, 3, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20],
      "command": "node --test tests/node/architecture-import-rules.test.mjs tests/node/session-view.test.mjs tests/node/site-session-runner.test.mjs tests/node/site-session-governance.test.mjs tests/node/security-guard-redaction.test.mjs tests/node/schema-governance.test.mjs tests/node/compatibility-registry.test.mjs tests/node/capability-hook.test.mjs tests/node/site-capability-matrix.test.mjs",
      "purpose": "Bounded regression batch for the recently passing 291/291 main focused gate across architecture import rules, SessionView, session runner/governance, SecurityGuard redaction, schema governance, compatibility registry, CapabilityHook, and matrix policy coverage; the same bounded file set reran as 292/292 on 2026-05-03 and then 296/296 on 2026-05-03 after test inventory drift. Prefer this precise batch over wildcard/full-suite reruns when the touched work matches these surfaces.",
      "recentPassingEvidence": [
        "main focused gate 291/291",
        "2026-05-03 bounded rerun 292/292",
        "2026-05-03 resumed bounded rerun 296/296",
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

The download runtime layer has been retired and physically removed. Public onboarding and regeneration stay on `siteforge build <url>`. Remaining descriptor-only planning surfaces such as StandardTaskList and DownloadPolicy are compatibility contracts, not executable download support.

### Download Commands
There is no public download command. Download planning remains an internal consumer path; the public command surface remains `siteforge build <url>`.

### Download Native / Legacy Ownership

Do not reintroduce executable download fallback paths without an explicit design review, sanitized artifacts, and focused architecture checks. Live traffic status: not claimed.

## Scope

- Branch/workspace: work continues on local `main` in the current project directory.
- Current policy: the old executable download runtime remains deleted.
- Live traffic status: not claimed.

## Migration Matrix

The executable native/legacy migration matrix was removed with the runtime layer. Site capability intake now records capability, intent, session, risk, and artifact evidence through the build pipeline rather than through download resolver tests.
Old executable download runtime status tables were retired. The current release gate is absence of executable download runtime paths, not native/legacy migration progress.

## Remaining Fallback Reasons

Retired download-specific reason codes may remain as historical compatibility values, but they are no longer backed by executable download modules.

## Test Gate

Focused retired-layer gate:

```powershell
node --test tests\node\architecture-import-rules.test.mjs tests\node\standard-task-list.test.mjs tests\node\download-policy.test.mjs tests\node\planner-policy-handoff.test.mjs tests\node\site-session-governance.test.mjs tests\node\session-repair-plan.test.mjs
```

Passing this gate proves the executable download runtime remains absent while descriptor-only planning, policy, and session repair contracts still validate.

## Derived Artifacts And Session Repair

- Derived media such as Bilibili DASH mux output is opt-in and must keep original resource manifests plus derived-output metadata.
- Download manifests may include sanitized repairPlan guidance. The runner does not login, keepalive, rebuild profiles, import cookies, or run live recovery by itself.
- `session-repair-plan` is dry-run by default; execution is allowlisted and operator-approved.

### Download Release Gate

Hard stops: branch/base uncertainty, unrelated dirty work, generated runtime artifacts, profile material, release notes claiming unverified behavior, live authenticated claims without approved artifacts, or any step requiring push/PR/live download/login/cookie import/profile recovery without explicit approval.

Minimum publication checks are broad Node/Python tests, the focused download gate above, `node tools\prepublish-secret-scan.mjs`, and `git diff --check`. Before any live-capability claim, run the offline release audit; it has no live/login/download side effects.

### Session Manifest Gate

Session traceability for authenticated or session-aware paths must name the
`unified-session-runner` source and the `legacy-session-provider` compatibility
boundary. The release gate records `--session-health-plan` and
`--session-manifest <path>` inputs while keeping the public workflow centered on
`siteforge build <url>`.

Blocked audit rows include a `repairPlan` guidance object. Offline only; no live/login/download side effects.

Current Local Evidence:

- clean worktree verified before evidence capture.
- Re-check the current ahead count before any publication step.
- Current closeout verification includes `node --test tests\node\*.test.mjs`
  and `python -m unittest discover -s tests\python -p "test_*.py"` when a
  release-sized download/session claim is being made.
- Retired-runtime status is not a live-capability claim.

#### Resolver Evidence Gate

Network-capable native resolvers require explicit network gating or injected/mock dependencies, ready session health when required, complete resolver evidence for the task shape, and sanitized manifest metadata. Current contracts include `bilibili-native-api-evidence-v1`, `douyin-native-evidence-v1`, `xiaohongshu-header-freshness-v1`, and `social-archive-v2`.

### Download Live Validation Gate

A planned live-validation flag records manifest metadata only. It is not approval to run live smoke. Approval must name site, account/profile, case, item limits, output directory, timeout, allowed actions, and stop conditions. Stop on login wall, challenge, rate limit, missing session, schema drift, cookies, auth headers, raw cursors, profile roots, browser profile paths, or downloaded private data.

## Download Boundary Workstreams

Future download-boundary work continues on local `main` in the current project directory unless the operator explicitly asks for branches or worktrees. Workstreams: architecture import rules, descriptor-only planning and policy contracts, session governance, live smoke boundaries, and release gates.
Do not create new branches or extra worktrees unless the operator explicitly asks.

### Local Main Workstreams

1. Architecture import rules
2. Descriptor-only planning and policy contracts
3. Session governance

## Social Live Verification

Social live verification is an internal plan-first maintenance workflow for X and Instagram. It is not part of the public SiteForge CLI surface; public site onboarding still goes through `siteforge build <url>`. `social-live-verify` requires explicit live scope, site, account, item limits, timeouts, run root, and `--execute` approval before sequential execution.

### Natural Language Trigger Guide

| User wording | Intent | Internal workflow shape |
| --- | --- | --- |
| `resume full archive` | `resume-full-archive` | Internal X/Instagram profile-content resume with session-health planning. |
| `continue after rate limit cooldown` | `resume-after-cooldown` | Internal profile-content resume with explicit risk backoff and retry budget. |
| `fast media download` | `media-fast-download` | Internal media-focused profile-content plan with governed media limits. |
| `session health check` | `health-check` | Internal auth-recovery verification with explicit operator approval. |
| `live acceptance report` | `live-acceptance-report` | Internal live verification with explicit site, account, limits, timeouts, and run root. |
| `scenario KB refresh` | `kb-refresh` | Internal scenario KB refresh with explicit site/account scope. |

Social matrix status values are `passed`, `failed`, `blocked`, `skipped`, and `unknown`. Artifact classification wins over raw process exit code when an artifact reports blocked or skipped. Login wall, challenge, expired session, platform throttle, rate limit, anti-crawl signal, and missing reusable login state must not be reported as live success.

Auth recovery remains bounded: reusable-profile health checks and visible manual login guidance are allowed; cookie import manifests may record cookie names/domains and missing required names but never cookie values. Do not automate password, challenge, CAPTCHA, risk-control, or permission bypass.
