# Social Live Verification

`scripts/social-live-verify.mjs` is the repeatable live acceptance runner for the X and Instagram social entrypoints. `scripts/social-kb-refresh.mjs` is the scenario-level KB state refresh runner for login walls, challenge/risk pages, search, author/profile pages, following lists/dialogs, and empty DOM app shells. `scripts/social-live-resume.mjs`, `scripts/social-live-report.mjs`, `scripts/social-health-watch.mjs`, and `scripts/social-command-templates.mjs` cover archive resume planning, report aggregation, account health checks, and reusable command templates. `scripts/social-auth-recover.mjs` is the auth recovery wrapper that checks reusable sessions, optionally opens visible `site-login` for manual recovery, and can rerun auth verification cases after recovery. `scripts/social-auth-import.mjs` imports externally provided cookies into the reusable browser profile when password/challenge automation is not viable. These scripts are intentionally plan-first.

## Safety Model

- Default mode is `not-run`: invoking `social-live-verify` without the full live boundary prints a boundary message and does not plan, open, log in, or download anything.
- `social-live-verify` requires explicit `--live`, `--site`, account, item limit, timeout, case timeout, and `--run-root` before it emits even a dry-run live plan. Case-specific boundaries are explicit too: `instagram-followed-date` needs `--date` and `--max-users`; media cases need `--max-media-downloads`.
- `--execute` is rejected unless `--live` is present.
- `--execute` runs selected commands sequentially, not in parallel.
- Execution writes the explicitly configured `<run-root>/<timestamp>/manifest.json` with command order, options, timestamps, exit codes, artifact summaries, archive completeness, auth recovery status, runtime risk, and media completeness.
- `social-kb-refresh` writes `runs/social-kb-refresh/<timestamp>/manifest.json` even in dry-run mode so the exact scenario command and expected artifact contract can be reviewed before live traffic.
- `social-kb-refresh --schedule-interval-minutes <n>`, `--watch`, and `--once` record the automatic refresh policy in the manifest. Dry-run never opens a browser or starts a long-running loop.
- `social-kb-refresh` applies a per-scenario outer timeout with `--case-timeout <ms>` in addition to the `site-doctor` `--timeout <ms>` flag. A timed-out scenario is recorded as `blocked` with reason `timeout`.
- `social-health-watch` is dry-run by default; `--execute` is required before it runs `site-keepalive` and `site-doctor`.
- `social-kb-refresh` continues after failed, blocked, or timed-out scenarios by default and aggregates the final manifest status after the selected matrix completes. Use `--fail-fast` to stop after the first non-passing scenario; the manifest records whether fail-fast triggered and which cases were skipped.
- The runner does not modify router code, tests, profiles, or entrypoints.

## Quick Start

```powershell
# Boundary check only. This prints not-run and does not emit live commands.
node .\scripts\social-live-verify.mjs

# Preview only Instagram followed-date verification.
node .\scripts\social-live-verify.mjs --live --site instagram --case instagram-followed-date --ig-account instagram --date 2026-04-26 --max-items 10 --max-users 10 --timeout 120000 --case-timeout 600000 --run-root .\runs\social-live-verify

# Preview scenario-level KB state refresh without live traffic.
node .\scripts\social-kb-refresh.mjs --site all

# Diagnose X auth recovery without live traffic.
node .\scripts\social-auth-recover.mjs --site x --verify

# Preview cookie import without writing to the browser profile.
node .\scripts\social-auth-import.mjs --site x --cookie-file C:\tmp\x-cookies.json

# Preview archive resume commands after cooldown.
node .\scripts\social-live-resume.mjs --state .\runs\social-live-verify\<timestamp>\manifest.json --cooldown-minutes 30 --max-attempts 3

# Aggregate the latest X/Instagram manifests into JSON and Markdown.
node .\scripts\social-live-report.mjs

# Preview account health keepalive/auth-doctor commands.
node .\scripts\social-health-watch.mjs --site all

# Preview the Windows scheduled task that would run account health checks.
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\install-social-health-watch-task.ps1 -Site all -IntervalMinutes 60

# Print production/resume/cooldown command templates.
node .\scripts\social-command-templates.mjs --site all

# Execute a bounded smoke matrix with explicit accounts.
node .\scripts\social-live-verify.mjs --live --execute --site all --x-account opensource --ig-account instagram --date 2026-04-26 --max-items 10 --max-users 10 --max-media-downloads 5 --timeout 120000 --case-timeout 600000 --run-root .\runs\social-live-verify
```

## Natural Language Trigger Guide

X and Instagram profiles expose these operational intents through `social.naturalLanguage`. Treat the examples as aliases for the listed command shapes; keep dry-run/plan mode unless the user explicitly asks to execute live traffic.

| User wording | Intent | Command shape |
| --- | --- | --- |
| `X 全量续跑 <handle>` / `IG 全量续跑 <handle>` / `resume full archive` | `resume-full-archive` | `node src/entrypoints/sites/<site>-action.mjs profile-content <handle> --content-type posts --full-archive --run-dir <previous-or-new-run>` |
| `限流冷却后继续` / `continue after rate limit cooldown` | `resume-after-cooldown` | `node src/entrypoints/sites/<site>-action.mjs profile-content <handle> --content-type posts --full-archive --risk-backoff-ms <ms> --risk-retries <n>` |
| `媒体高速下载` / `fast media download` | `media-fast-download` | `node src/entrypoints/sites/<site>-action.mjs profile-content <handle> --content-type media --download-media --max-media-downloads <n>` |
| `健康检查` / `session health check` | `health-check` | `node scripts/social-auth-recover.mjs --execute --site x|instagram --verify` |
| `live 验收报告` / `live acceptance report` | `live-acceptance-report` | `node scripts/social-live-verify.mjs --live --execute --site x|instagram --x-account <handle>` or `--ig-account <handle>` plus explicit limits, timeouts, and `--run-root` |
| `KB 刷新` / `scenario KB refresh` | `kb-refresh` | `node scripts/social-kb-refresh.mjs --execute --site x|instagram --x-account <handle>` or `--ig-account <handle>` |

## Command Matrix

Each matrix row has three separate classifications:

- `command`: child process result, recorded from `exitCode` and `signal`.
- `artifact`: parsed command output, usually the action manifest, `doctor-report.json`, or KB refresh manifest.
- `status`: aggregate acceptance status for the live matrix. Artifact classification wins over raw command failure when the artifact clearly reports `blocked` or `skipped`.

| Case | Coverage | Command | Primary artifact | Artifact/status classification |
| --- | --- | --- | --- | --- |
| `x-full-archive` | X full archive | `node src/entrypoints/sites/x-action.mjs full-archive <x-account> --max-items <n> --timeout <ms> --run-dir <run>` | `<run>/manifest.json` | `passed` when archive is complete or bounded; `failed` when archive is incomplete; `blocked` for rate limits, login wall, challenge, session invalidation, fingerprint risk, or timeout; `skipped` when reusable login credentials are unavailable. |
| `instagram-full-archive` | IG full archive | `node src/entrypoints/sites/instagram-action.mjs full-archive <ig-account> --max-items <n> --timeout <ms> --run-dir <run>` | `<run>/manifest.json` plus archive JSON/JSONL, CSV, and HTML indexes | Same archive rules as X. The formal IG profile-content/full-archive path should prefer authenticated `api/v1/feed/user/<userId>/` pagination, fall back through compatible captured API payloads, and use DOM only as the final fallback. Missing Instagram login is `skipped`; Instagram login wall, challenge, expired session, or recovery-needed state is `blocked`, not a generic failure. |
| `instagram-followed-date` | IG followed-date | `node src/entrypoints/sites/instagram-action.mjs followed-posts-by-date --date <YYYY-MM-DD> --max-users <n> --max-items <n> --timeout <ms> --run-dir <run>` | `<run>/manifest.json` | `passed` when the bounded followed-date scan completes; `blocked` for auth/risk/runtime blocks; `skipped` when no reusable logged-in Instagram session is available. |
| `x-media-download` | X media download | `node src/entrypoints/sites/x-action.mjs profile-content <x-account> --content-type media --download-media --max-items <n> --max-media-downloads <n> --timeout <ms> --run-dir <run>` | `<run>/manifest.json`, optional `<run>/downloads.jsonl` | `passed` when expected media downloads are present; `failed` when expected media exists but not all downloads complete; `blocked` for auth/risk/runtime blocks; `skipped` when download session/login state is unavailable before media work can start. |
| `instagram-media-download` | IG media download | `node src/entrypoints/sites/instagram-action.mjs profile-content <ig-account> --content-type media --download-media --max-items <n> --max-media-downloads <n> --timeout <ms> --run-dir <run>` | `<run>/manifest.json`, optional `<run>/downloads.jsonl`, `media-queue.json`, and `media-manifest.json` | Same media rules as X. Downloads should be resumable, retry failed media entries without redownloading completed files, and pass hash/type/size/video validation before acceptance. Missing Instagram login/download session is `skipped`; login wall, challenge, expired session, or platform throttle is `blocked`. |
| `x-auth-doctor` | X auth recovery/site-doctor | `node src/entrypoints/sites/site-doctor.mjs https://x.com/home --profile-path profiles/x.com.json --knowledge-base-dir knowledge-base/x.com --reuse-login-state --no-headless` | latest `<out-dir>/*/doctor-report.json` | `passed` when scenarios pass or are intentionally skipped; `failed` for scenario fail/error; `blocked` for `not-logged-in`, anti-crawl, rate-limit, fingerprint, or platform-boundary reason codes. |
| `instagram-auth-doctor` | IG auth recovery/site-doctor | `node src/entrypoints/sites/site-doctor.mjs https://www.instagram.com/ --profile-path profiles/www.instagram.com.json --knowledge-base-dir knowledge-base/www.instagram.com --reuse-login-state --no-headless` | latest `<out-dir>/*/doctor-report.json` | Same doctor rules as X. Auth-only Instagram scenarios skipped with `not-logged-in` are classified as `blocked` for acceptance. |
| `x-kb-refresh` | X scenario KB state refresh | `node scripts/social-kb-refresh.mjs --site x --run-root <run>` | latest `<run>/manifest.json` | `passed` when selected scenario cases pass; `failed` for child failures; `blocked` for timeouts and blocked scenario reason codes. |
| `instagram-kb-refresh` | IG scenario KB state refresh | `node scripts/social-kb-refresh.mjs --site instagram --run-root <run>` | latest `<run>/manifest.json` | Same KB refresh rules as X, including `not-logged-in` and timeout as `blocked`. |

Final matrix `status` values:

- `passed`: every selected artifact passed.
- `failed`: at least one artifact failed, or a command failed without a more specific artifact classification.
- `blocked`: at least one artifact is blocked by auth, platform risk, rate limit, challenge, or timeout.
- `skipped`: at least one artifact is skipped because required reusable login/session material is absent before live validation can proceed.
- `unknown`: required artifacts are missing or cannot be classified.

## Scenario KB Refresh

Use `social-kb-refresh` when the acceptance target is KB state freshness rather than archive/media behavior. Dry-run mode writes a manifest and prints the concrete `site-doctor` commands without opening a browser:

```powershell
node .\scripts\social-kb-refresh.mjs --site all
```

Record an automatic refresh cadence without live traffic:

```powershell
node .\scripts\social-kb-refresh.mjs --site all --watch --schedule-interval-minutes 720
```

Execute one scheduled iteration:

```powershell
node .\scripts\social-kb-refresh.mjs --execute --once --site all --schedule-interval-minutes 720
```

Bound an execute watch loop for automation:

```powershell
node .\scripts\social-kb-refresh.mjs --execute --watch --schedule-interval-minutes 720 --max-watch-iterations 1
```

Execute one focused scenario:

```powershell
node .\scripts\social-kb-refresh.mjs --execute --case instagram-following-modal --ig-account instagram --case-timeout 600000
```

Execute all search and empty-DOM probes for both sites:

```powershell
node .\scripts\social-kb-refresh.mjs --execute --surface search --surface empty-dom --query "open source"
```

Scenario case ids:

| Case | Surface | Start URL shape | Primary artifact root |
| --- | --- | --- | --- |
| `x-login-wall` | login wall | `https://x.com/i/flow/login` | `runs/social-kb-refresh/<timestamp>/x-login-wall/` |
| `x-challenge` | challenge/risk | `https://x.com/home` | `runs/social-kb-refresh/<timestamp>/x-challenge/` |
| `x-search` | search | `https://x.com/search?q=<query>&src=typed_query&f=live` | `runs/social-kb-refresh/<timestamp>/x-search/` |
| `x-author-page` | author page | `https://x.com/<x-account>` | `runs/social-kb-refresh/<timestamp>/x-author-page/` |
| `x-following-modal` | following list | `https://x.com/<x-account>/following` | `runs/social-kb-refresh/<timestamp>/x-following-modal/` |
| `x-empty-dom` | empty DOM/app shell | `https://x.com/` | `runs/social-kb-refresh/<timestamp>/x-empty-dom/` |
| `instagram-login-wall` | login wall | `https://www.instagram.com/accounts/login/` | `runs/social-kb-refresh/<timestamp>/instagram-login-wall/` |
| `instagram-challenge` | challenge/risk | `https://www.instagram.com/challenge/` | `runs/social-kb-refresh/<timestamp>/instagram-challenge/` |
| `instagram-search` | search | `https://www.instagram.com/explore/search/?q=<query>` | `runs/social-kb-refresh/<timestamp>/instagram-search/` |
| `instagram-author-page` | author page | `https://www.instagram.com/<ig-account>/` | `runs/social-kb-refresh/<timestamp>/instagram-author-page/` |
| `instagram-following-modal` | following dialog/list | `https://www.instagram.com/<ig-account>/following/` | `runs/social-kb-refresh/<timestamp>/instagram-following-modal/` |
| `instagram-empty-dom` | empty DOM/app shell | `https://www.instagram.com/` | `runs/social-kb-refresh/<timestamp>/instagram-empty-dom/` |

Each command writes a top-level `manifest.json` plus `site-doctor` artifacts under the case artifact root. After execution, the manifest records the discovered `doctor-report.json`, `doctor-report.md`, capture manifest, expand manifest, scenario count, and per-scenario status/reason codes when the doctor report can be parsed.

The KB refresh manifest also records:

- `timeoutPolicy.forwardedTimeoutMs`: the inner `site-doctor --timeout` value.
- `timeoutPolicy.caseTimeoutMs`: the outer per-scenario child-process timeout.
- `failFast`: whether fail-fast was enabled, whether it triggered, the case that stopped execution, and skipped case ids.
- `schedulePolicy`: whether automatic refresh is enabled, `once` versus `watch`, interval minutes, and optional max watch iterations.
- `results[].timeout`: whether the outer timeout fired for that scenario.
- `results[].blocked`: blocked status and reason, including `timeout`, `not-logged-in`, `anti-crawl-*`, `browser-fingerprint-risk`, or `platform-boundary`.

## Resume, Reports, Health, and Templates

Use `social-live-resume` to inspect a previous state or manifest and generate resume commands for incomplete X/Instagram full archives. It honors cooldown and max-attempt limits, and dry-run mode only prints the plan:

```powershell
node .\scripts\social-live-resume.mjs --state .\runs\social-live-verify\<timestamp>\manifest.json --cooldown-minutes 30 --max-attempts 3
```

Use `social-live-report` to scan `runs/`, select the latest X/Instagram manifests, and write:

- `runs/social-live-report/social-live-report.json`
- `runs/social-live-report/social-live-report.md`

Use `social-health-watch` before long live runs to check account health. Dry-run prints the keepalive and auth-doctor commands plus `nextSuggestedKeepalive`; execute mode runs them sequentially:

```powershell
node .\scripts\social-health-watch.mjs --site all
node .\scripts\social-health-watch.mjs --execute --site x --interval-minutes 60
```

On Windows, `tools/install-social-health-watch-task.ps1` creates a Task Scheduler entry that runs `scripts/social-health-watch.mjs --execute` on a fixed minute interval. The installer and uninstaller are dry-run by default and also support PowerShell `-WhatIf`; they only call `schtasks.exe` when `-Execute` is present.

```powershell
# Preview the default scheduled task. This does not install anything.
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\install-social-health-watch-task.ps1

# Preview a user-scoped Instagram health task every two hours.
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\install-social-health-watch-task.ps1 `
  -UserScope `
  -Site instagram `
  -IntervalMinutes 120 `
  -TaskName SocialHealthInstagram `
  -NodePath "C:\Program Files\nodejs\node.exe"

# Create or update the task after reviewing the dry-run command.
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\install-social-health-watch-task.ps1 `
  -Execute `
  -Site all `
  -IntervalMinutes 60 `
  -RepoRoot C:\Users\lyt-p\Desktop\Browser-Wiki-Skill

# Preview deletion. This does not delete anything.
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\uninstall-social-health-watch-task.ps1

# Delete the matching user-scoped task.
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\uninstall-social-health-watch-task.ps1 `
  -Execute `
  -UserScope `
  -TaskName SocialHealthInstagram
```

Task names that do not start with `\` are placed under `\Browser-Wiki-Skill\`. With `-UserScope`, they are placed under `\Browser-Wiki-Skill\<windows-user>\` so multiple local users can keep separate tasks.

Use `social-command-templates` when you need consistent production, resume, cooldown, health, and KB refresh command shapes:

```powershell
node .\scripts\social-command-templates.mjs --site all --x-account <x-account> --ig-account <ig-account> --date <YYYY-MM-DD>
```

## Common Options

```powershell
node .\scripts\social-live-verify.mjs `
  --live `
  --site instagram `
  --case instagram-full-archive `
  --case instagram-media-download `
  --ig-account instagram `
  --max-items 25 `
  --max-media-downloads 100 `
  --timeout 120000 `
  --case-timeout 600000 `
  --run-root .\runs\social-live-verify
```

- `--live` acknowledges that live smoke commands may be planned; without it the tool remains `not-run`.
- `--site x|instagram|all` filters site-specific matrix rows and is required for live smoke planning.
- `--case <id>` can be repeated for a custom subset.
- `--account <handle>` applies one account to both sites; `--x-account` and `--ig-account` override per site.
- `--date <YYYY-MM-DD>` drives the IG followed-date case.
- `--max-items`, `--max-users`, and `--timeout` keep live acceptance bounded and must be explicit when applicable.
- `--case-timeout` bounds each matrix command from outside the child process and must be explicit.
- `--fail-fast` makes `social-kb-refresh` stop after the first failed, blocked, or timed-out scenario; without it, later cases still run.
- `--max-media-downloads` bounds the media download cases independently from post count and must be explicit for media cases.
- `--run-root` must be explicit so live smoke artifacts cannot silently land in the default repo `runs/` tree.
- `--browser-profile-root`, `--browser-path`, and `--user-data-dir` are forwarded to social actions and site-doctor where supported.
- `--headless` or `--no-headless` controls browser visibility; default is `--no-headless` for auth-sensitive checks.

## Auth Recovery

Use `social-auth-recover` before rerunning X or Instagram live cases when the last matrix says `credentials-unavailable`, `login-wall`, `session-invalid`, or `needsRecovery`.

```powershell
# Non-interactive reusable-profile health check.
node .\scripts\social-auth-recover.mjs --execute --site x --verify

# Open a visible browser, wait for one manual login, then rerun x-auth-doctor.
node .\scripts\social-auth-recover.mjs --execute --site x --manual --verify --manual-timeout 600000

# Reuse an already logged-in Chrome profile or cookie-backed user data directory.
node .\scripts\social-auth-recover.mjs --execute --site x --manual --verify --user-data-dir C:\Path\To\Chrome\UserData\Profile
```

The recovery manifest is written under `runs/social-auth-recover/<timestamp>/manifest.json`. A `needs-manual-login` result is not a parser failure; it means the persistent profile is not authenticated and the manifest includes the exact `site-login` command to run. After the manual login command completes with `persistenceVerified: true`, rerun `social-auth-recover --execute --site x --verify` or the full `social-live-verify` matrix.

When X blocks the username-to-password step or requires browser-side verification, import a current cookie set instead of automating the password flow. Prefer a local file or environment variable so secrets do not enter shell history or chat logs:

```powershell
# JSON export, Netscape cookies.txt, raw Cookie header, and Set-Cookie lines are supported.
node .\scripts\social-auth-import.mjs --execute --site x --cookie-file C:\tmp\x-cookies.json

# Safer for a raw Cookie header.
$env:X_COOKIE_HEADER = "auth_token=...; ct0=...; twid=..."
node .\scripts\social-auth-import.mjs --execute --site x --cookie-header-env X_COOKIE_HEADER
Remove-Item Env:\X_COOKIE_HEADER
```

The import manifest is written under `runs/social-auth-import/<timestamp>/manifest.json`. It records cookie names, domains, missing required cookie names, the target `userDataDir`, and the post-import auth probe, but it does not write cookie values. For X, `auth_token` and `ct0` are the minimum expected cookies; `twid` and other first-party cookies improve reuse reliability.

## Recommended Acceptance Passes

1. Run the full dry-run and inspect command targets:

```powershell
node .\scripts\social-live-verify.mjs --live --site all --x-account <x-account> --ig-account <ig-account> --date <YYYY-MM-DD> --max-items 10 --max-users 10 --max-media-downloads 5 --timeout 120000 --case-timeout 600000 --run-root .\runs\social-live-verify
```

2. Execute a narrow auth/KB pass before archive or media download:

```powershell
node .\scripts\social-live-verify.mjs --live --execute --site all --case x-auth-doctor --case instagram-auth-doctor --case x-kb-refresh --case instagram-kb-refresh --x-account <x-account> --ig-account <ig-account> --max-items 10 --timeout 120000 --case-timeout 600000 --run-root .\runs\social-live-verify
```

For a scenario-only KB refresh pass, prefer the focused runner:

```powershell
node .\scripts\social-kb-refresh.mjs --execute --site all --x-account <x-account> --ig-account <ig-account>
```

3. Execute bounded archive and media checks:

```powershell
node .\scripts\social-live-verify.mjs --live --execute --site all --case x-full-archive --case instagram-full-archive --case x-media-download --case instagram-media-download --x-account <x-account> --ig-account <ig-account> --max-items 10 --max-media-downloads 5 --timeout 120000 --case-timeout 600000 --run-root .\runs\social-live-verify
```

4. Execute the Instagram followed-date pass separately when the date is the acceptance target:

```powershell
node .\scripts\social-live-verify.mjs --live --execute --site instagram --case instagram-followed-date --ig-account <ig-account> --date <YYYY-MM-DD> --max-users 10 --max-items 10 --timeout 120000 --case-timeout 600000 --run-root .\runs\social-live-verify
```

## Manifest Review

After an execute run, inspect:

```powershell
Get-Content .\runs\social-live-verify\<timestamp>\manifest.json
Get-Content .\runs\social-kb-refresh\<timestamp>\manifest.json
```

Use `results[].artifactSummary` as the primary classification. `exitCode` is recorded for debugging, but acceptance and reports bucket live smoke rows from parsed artifacts into `passed`, `failed`, `blocked`, `skipped`, or `unknown`. For KB state refresh, also inspect `results[].artifacts.scenarioStatuses[]` for `not-logged-in`, `anti-crawl-*`, `empty-shell`, `platform-boundary`, or `matching-state-missing`.

For social action cases, inspect `results[].artifactSummary` first. It classifies each case as `passed`, `failed`, `blocked`, `skipped`, or `unknown`, and links the action `manifest.json`. Full action manifests include `outcome`, `runtimeRisk`, `authHealth`, `completeness`, `downloads`, `api-capture-debug.json`, optional `api-drift-samples.json`, and optional `downloads.jsonl`.

For Instagram full archive acceptance, confirm the archive strategy records `api/v1/feed/user/<userId>/` pagination when available, or a specific fallback reason when it is not. Also confirm that resumable state, failed-media retry state, automatic validation results, and CSV/HTML indexes are present before calling a full archive complete.

Useful risk controls:

```powershell
node .\scripts\social-live-verify.mjs --live --execute --site all --x-account <x-account> --ig-account <ig-account> --max-items 10 --max-users 10 --max-media-downloads 5 --timeout 120000 --case-timeout 600000 --run-root .\runs\social-live-verify --risk-backoff-ms 30000 --risk-retries 2 --api-retries 2
```

## Doctor Scenario Coverage

The X and Instagram `site-doctor` passes now run first-class scenario suites instead of only a generic auth probe. These suites validate public post/detail/profile states, authenticated search or inbox/following states, and report `not-logged-in`, `anti-crawl-*`, `empty-shell`, or platform-boundary reasons when a matched state is not usable.

Authenticated scenarios still require a reusable browser profile or `--user-data-dir`. Without a valid session, `site-doctor` skips those scenarios with `not-logged-in` rather than treating the skip as a parser failure.
