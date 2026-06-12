---
name: X只读动作
description: Use verified SiteForge X live evidence to satisfy natural-language requests against X.com read-only capabilities and APIs. Trigger this skill when the user asks Codex to inspect, search, archive, read, compare trends, analyze sentiment/opinions, or operate on X/Twitter profiles, timelines, posts, followers, lists, bookmarks, communities, notifications, spaces, settings, or discovered X API operations, especially when Codex should prefer verified executable APIs and fall back to verified site capabilities.
---

# X只读动作

Use this skill to translate a natural-language X/Twitter request into a verified SiteForge X action. It is built from the current X live report and supports API-first execution with site fallback.

## Core Rule

For the same intent:

1. Prefer a verified API path when `references/x-live-catalog.json` marks the matched surface `api.verified=true`.
2. If no verified API exists, the API command is unavailable, or it fails without a hard safety gate, use the matched `siteFallback.commandTemplate`.
3. If an API cursor is locally limited and the evidence clearly identifies the API/cursor layer, switch to verified site/page collection immediately.
4. On same-surface `rate-limited`, auth-blocked, mutation-risk, or `hardStop=true`, do not wait for cooldown and do not retry the same live surface. Switch to Browser Bridge sanitized structure fallback, local evidence reuse, an explicitly different verified surface, or a degraded/captured-with-warning terminal bucket only when no verified structure evidence exists.

Do not perform write actions such as post, reply, like, retweet, follow, subscribe, DM, account setting changes, or payment/premium actions. Treat those as blocked even if the UI/API was observed.

## Controlled Structure Fallback

For X auth/profile/local API failures such as missing or unhealthy `profiles/x.com.json`, unavailable API cursor, or same-surface hard stop, prefer verified Browser Bridge sanitized structure fallback when the latest SiteForge X build verification is passed and the task can be completed at route/structure level. Use `--build-dir .siteforge/sites/x.com-326a6450/builds/20260609T115724405Z` to pin the current verified build when profile reuse is unavailable.

The fallback evidence source is `browser-bridge-sanitized-structure`. Task summaries must make the boundary explicit with `completionScope="controlled_structure_scope"`, `contentCompletenessClaim="not_claimed"`, `controlledEvidence`, and `verification.status="verified-controlled-structure"`. Descriptor rows such as `browser_bridge_sanitized_route_summary` prove verified route/structure coverage only; never treat them as tweet bodies, full-history content, private content, full search results, or full relation lists.

## Six Research Task Templates

For these higher-level requests, use the SiteForge task runner instead of mapping the request to one low-level surface:

1. `account-full-archive`: specified account historical archive, including posts, replies, media, highlights, articles route, and following list.
2. `keyword-trend`: keyword or subject trend analysis.
3. `account-composite-profile`: specified account content + relation profile.
4. `industry-report`: industry weekly/monthly report.
5. `event-timeline`: event timeline reconstruction.
6. `similar-account-discovery`: similar account discovery from a seed account profile.

Plan first:

```powershell
node scripts/x-research-task-runner.mjs --task <task-id> --account <account> --out-dir .siteforge/x-research-tasks/<run-id> --runs-root .siteforge/x-live-runs-skill --dry-run --json
node scripts/x-research-task-runner.mjs --task <task-id> --query "<query>" --out-dir .siteforge/x-research-tasks/<run-id> --runs-root .siteforge/x-live-runs-skill --max-buckets-per-run 1 --dry-run --json
```

Execute with resume:

```powershell
node scripts/x-research-task-runner.mjs --task <task-id> --account <account> --out-dir .siteforge/x-research-tasks/<run-id> --runs-root .siteforge/x-live-runs-skill --execute --resume --json
node scripts/x-research-task-runner.mjs --task <task-id> --query "<query>" --out-dir .siteforge/x-research-tasks/<run-id> --runs-root .siteforge/x-live-runs-skill --execute --resume --max-buckets-per-run 1 --json
```

When pinning the current verified SiteForge X build or when profile reuse is unavailable, add:

```powershell
--build-dir .siteforge/sites/x.com-326a6450/builds/20260609T115724405Z
```

A 100-point controlled-scope run requires all six research templates to complete with non-empty descriptor evidence, terminal bucket states, no blocking issues, no sensitive persisted material, and explicit `controlled_structure_scope` / `not_claimed` boundaries.

Account archives must save offline-readable Markdown and playable/editable local media by default. The planner should include:

```powershell
node scripts/x-research-task-runner.mjs --task account-full-archive --account <account> --out-dir .siteforge/x-research-tasks/<run-id> --runs-root .siteforge/x-live-runs-skill --execute --resume --download-media --media-download-limit 0 --json
```

Use account inputs for `account-full-archive`, `account-composite-profile`, and `similar-account-discovery`. Use query inputs for `keyword-trend`, `industry-report`, and `event-timeline`.
Search-style tasks default to one bucket per invocation. If a search surface is blocked, the runner must not wait for cooldown; it should preserve partial evidence, use verified Browser Bridge sanitized structure fallback, reuse local `.siteforge` cache, or backfill from discovered profile/link surfaces and mark the bucket `captured-with-warning` when evidence is degraded. If no structure, cache, or alternate evidence is available for a confirmed blocked search or non-search surface, mark an empty degraded terminal bucket instead of waiting or interrupting the run.

The runner's no-stall policy is:

- API-local cursor/seed stalls immediately switch to Browser Bridge/page collection when a fallback exists.
- Same-surface X hard stops use no-wait continuation: partial evidence, Browser Bridge sanitized structure fallback, local cache reuse, alternate verified surfaces, or an empty degraded terminal bucket only as a last resort instead of cooldown waits.
- Existing task state is reused before any live retry, so the user does not need to restate the task after an interruption.

Expected task artifacts:

- `task-plan.json`
- `task-state.json`
- `task-summary.json`
- `task-report.md`
- `raw-items.jsonl`
- `deduped-items.jsonl`
- `accounts.jsonl`
- `cache-index.json` and `cache-index.jsonl`
- `media-assets.json` and `media-assets.jsonl`
- `archive-manifest.json`
- `archive/posts/*.md`
- `archive/articles/*.md`
- `archive/following.md`
- local media files under `archive/media/images/` and `archive/media/videos/`

Quality layers in `task-summary.json`:

- `evidenceCompleteness`: weighted score and grade for bucket coverage, item volume, time/relation/media coverage, and no-wait cleanliness.
- `quality`: bucket-level warnings, zero-evidence buckets, dedupe drops, missing text/time, and no-wait degraded buckets.
- `controlledEvidence`, `completionScope`, and `contentCompletenessClaim`: required when a task completes from controlled Browser Bridge structure evidence. `raw-items.jsonl` may contain descriptor rows such as `browser_bridge_sanitized_route_summary`; these rows are route/structure evidence, not extracted post content.
- `mediaArchive`: media inventory and binary download status. For `account-full-archive`, local media download is required and `--media-download-limit 0` should be used unless the user explicitly requests a bounded test run.
- `analysis`: sentiment, themes, top domains, representative items, investment signals, and task-specific outputs.
- `analysis.candidateAccounts`: for similar-account discovery, structured score, priority, confidence, content-term overlap, domain overlap, style similarity, relation hits, and sample URLs.

## Trend and Opinion Analysis

For standalone product/model UX or opinion requests that are not one of the six research task templates, use the SiteForge trend sampler instead of relying on the generic planner. The generic planner can misclassify broad analysis requests as relations or dynamic routes.

For OpenAI/Anthropic product or model experience analysis, keep the live sampling scope fixed to product/model entities and user-experience or user-love evidence. Do not live-query separate pricing, safety, legal, funding, governance, or company-performance topics. The sampler collects by subject, language, and month first, then filters and classifies UX/love evidence offline.

Use Browser Bridge/page collection by default for this trend task. Do not use API cursor collection unless the user explicitly asks for API mode. Page collection still counts as X search and can trigger same-surface rate limits; when that happens, do not wait. Reuse local evidence, refresh summaries, or continue non-conflicting buckets/surfaces with degraded labels.

If explicit API mode is used, the sampler defaults to `--api-rate-limit-fallback page`: API-local cursor limits are retried immediately with Browser Bridge/page collection for the same bucket. Do not apply that fallback when the manifest/result reports `taskId=x:search`, a generic same-surface search cooldown, auth risk, mutation risk, or `hardStop=true` without an API/cursor marker.

Default product/model subjects:

- `codex-product`
- `claude-code-product`
- `chatgpt-product`
- `claude-product`
- `gpt-model-family`
- `claude-model-family`

Run plan generation first from the SiteForge repo:

```powershell
node scripts/social-trend-sampler.mjs --from 2025-12-02 --to 2026-06-03 --mode full --languages zh,en --target-samples 12000 --collection-mode page --max-buckets-per-run 1 --max-scrolls 60 --scroll-wait-ms 1000 --out-dir .siteforge/x-trend-analysis/<run-id> --runs-root .siteforge/x-live-runs-skill --dry-run
```

The default date range is `2025-12-02` to `2026-06-03` UTC. With the six default subjects, `--languages zh,en`, and monthly buckets, the generated plan should contain 84 buckets.

Execute after the generated buckets look right. Active same-surface blockers must be handled by no-wait local evidence reuse, non-conflicting alternatives, or `captured_with_warning` degraded buckets, not by waiting:

```powershell
node scripts/social-trend-sampler.mjs --from 2025-12-02 --to 2026-06-03 --mode full --languages zh,en --target-samples 12000 --collection-mode page --max-buckets-per-run 1 --max-scrolls 60 --scroll-wait-ms 1000 --out-dir .siteforge/x-trend-analysis/<run-id> --runs-root .siteforge/x-live-runs-skill --execute --resume
```

To refresh reports from a checkpoint without live collection:

```powershell
node scripts/social-trend-sampler.mjs --out-dir .siteforge/x-trend-analysis/<run-id> --runs-root .siteforge/x-live-runs-skill --refresh-summary
```

Expected output files:

- `raw-items.jsonl`
- `deduped-items.jsonl`
- `ux-love-items.jsonl`
- `bucket-summary.json`
- `bucket-summary.csv`
- `trend-summary.json`
- `trend-summary.md`
- `trend-run-state.json`

Acceptance for the default UX/love analysis is deduped and filtered effective samples `>=10000`, with `zh>=5000` and `en>=5000`. If the sampler finishes below those thresholds, use the `refillPlan` and `yieldProjection` in `trend-summary.json` before making final claims.

If the sampler sees a search cooldown or same-surface X search hard stop, it must not wait and must not run another same-surface X search bucket. It should preserve partial artifacts when present, otherwise write an empty degraded `captured_with_warning` bucket so the run can continue and the coverage gap is explicit. The only immediate live fallback exception is the sampler's built-in API-local cursor fallback described above.

Trend outputs are directional X latest-search evidence, not a statistically representative poll. Say that boundary explicitly in the final answer.

## Workflow

1. Run the planner from the SiteForge repo:

```powershell
node .agents/skills/x-live-actions/scripts/plan-x-action.mjs --request "<user request>" --json
```

Add known parameters when available:

```powershell
node .agents/skills/x-live-actions/scripts/plan-x-action.mjs --request "get OpenAI likes" --account OpenAI --max-items 20 --json
```

Run the planner from the SiteForge repo when possible. It first refreshes the local `social-live-report` from existing `.siteforge` artifacts, then uses the refreshed report to plan against current rate-limit boundary state. Use `--report <path>` to force a specific refreshed report, or `--no-refresh-report` to skip the preflight refresh and use the newest existing report.

2. Inspect the plan:

- `primary.kind="api"` means run the API-first command first.
- `fallback.kind="site"` is the verified site capability to run if the API path is missing or fails without a hard gate.
- `blocked=true` means do not execute that same live surface. Prefer local evidence reuse, refresh-only reporting, or a non-conflicting verified surface; do not wait for cooldown.
- `missingParameters` must be filled before execution.
- `limits.mode="full-relation-archive"` means the request was understood as a full followers/following account list, including Chinese following-list or full-list phrases. The planner raises relation archive defaults to `--max-items 5000 --max-api-pages 250` unless explicit limits were provided.
- For full relation archives, the planner omits `--crawl-read-surfaces` by default so the command stays focused on API relation pagination instead of route discovery. Pass `--crawl-read-surfaces` to the planner only when route-surface evidence is explicitly needed.

For full relation archives, do not downscope to the default 20-item preview. If the plan is blocked because `catalog.boundaries.activeRateLimitBlocker=true`, do not wait; first reuse any saved relation cursor/artifact, then try a non-conflicting verified relation/page surface if available. If the resulting manifest still reports `bounded (max-items)`, resume from its saved cursor with larger explicit limits.

3. Execute from the SiteForge repo only after parameters are concrete. Keep output artifacts under `.siteforge/`.

4. After execution, inspect the generated `manifest.json`:

- If `runtimeRisk.rateLimited=true`, `runtimeRisk.hardStop=true`, auth is blocked, or the outcome is `blocked-risk`, do not retry that same live surface. Use API-local page fallback only when the blocker is clearly API/cursor-local; otherwise use local evidence reuse or a non-conflicting verified surface.
- If the API command exits nonzero because there is no API seed, no usable API cursor, or an API-local cursor rate limit, run the fallback site/page command.
- If the site fallback also fails, stop and report the manifest path and reason.

5. Manual evidence refresh is usually unnecessary because the planner performs the local report preflight. Use these commands only when you need to inspect or pin a specific report/seed plan:

```powershell
node scripts/social-live-report.mjs --runs-root .siteforge --site x --limit 1000 --out-dir .siteforge/x-live-report-20260531T1126 --progress plain --no-tty
node scripts/social-dynamic-seed-plan.mjs --report .siteforge/x-live-report-20260531T1126/social-live-report.json --out-dir .siteforge/x-live-report-20260531T1126
```

## References

- `references/x-live-catalog.json`: machine-readable catalog of discovered capabilities, intents, API operations, safety boundaries, and command templates.
- `references/x-live-catalog.md`: compact human summary of the same catalog.
- `references/evaluation.zh.md`: reproducible Chinese three-layer scoring report and 100-point completion gates generated by `scripts/evaluate-x-live-skill.mjs`.
- `references/x-live-sanitized-surface-ledger.json`: sanitized surface ledger for verified route/structure evidence used by controlled Browser Bridge fallback.

Use the JSON catalog as authoritative. It was generated from the current live report and contains only redacted evidence metadata, not cookies or payload bodies.

## Safety

- Never read or print `siteforge.local.json`.
- Never print cookies, auth tokens, CSRF tokens, bearer tokens, or captured request headers.
- Use `--reuse-login-state --no-session-health-plan --no-headless` only as black-box local session reuse.
- Avoid broad live retries. On same-surface rate limits, do not wait for cooldown and do not hit the same surface again; use local cache, checkpoint refresh, or non-conflicting verified surfaces. Only API-local cursor limits may switch immediately to verified page collection.
- For sensitive settings, DM, compose, commerce, and mutation-like surfaces, inspect structure only when the catalog says the read path is verified; never click controls that mutate state.
- Descriptor rows and controlled structure summaries prove route/structure only. Do not claim full post-body history, private content, full search result capture, full following lists, or media/content download from those descriptors.
