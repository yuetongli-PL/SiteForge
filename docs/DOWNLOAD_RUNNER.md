# Download Runner

The unified download runner keeps site-specific planning and resource resolution outside the generic executor. It is the migration wrapper for Phase 6 download operations: plan first, write stable run artifacts, then either execute native resolved resources or invoke an existing legacy site downloader as a fallback.

Publish caveat: the current download runner branch is stacked on earlier work and is not pushed. Do not document it as released or available on `main` until the stack is merged and pushed.

## Flow

1. Generate a dry-run plan first.
2. Acquire a session lease when the site requires one.
3. Resolve concrete resources through the site module.
4. Execute either the native resource executor or a legacy downloader adapter.
5. Write `plan.json`, `resolved-task.json`, `manifest.json`, `queue.json`, `downloads.jsonl`, and `report.md`.

## Site Migration Matrix

The runner can always execute already-resolved resources passed with `--resource`. Site modules decide whether a normal site request produces native resources or falls through to the legacy adapter.

| Site key | Host | Current path | Notes |
| --- | --- | --- | --- |
| `22biqu` | `www.22biqu.com` | Hybrid native + legacy fallback | Native when chapter resources are provided directly, or when dry-run is given a local book-content fixture/KB root. Normal unmatched book-title/book-url downloads still fall back to `src/sites/chapter-content/download/python/book.py`. |
| `bilibili` | `www.bilibili.com` | Hybrid native + legacy fallback | Native can consume fixture/injected/gated API evidence for playurl `dash`/`durl`, BV multi-P, collection/series, and UP archive shapes. Missing view/list/playurl evidence, unsupported live signatures, or incomplete payloads still fall back to `src/entrypoints/sites/bilibili-action.mjs download`. |
| `douyin` | `www.douyin.com` | Hybrid native + legacy fallback | Native can consume fixture/injected media detail, direct media, author enumeration, and followed-update seeds without refreshing live state. Live signing, cache refresh, profile side effects, and unsupported discovery still fall back to `src/entrypoints/sites/douyin-action.mjs download` or the existing query/action layer. |
| `xiaohongshu` | `www.xiaohongshu.com` | Hybrid native + legacy fallback | Native can consume fixture/injected note, search, author, followed, page facts, and side-effect-free fetch evidence. Header refresh, session side effects, and unsupported live API/page fetches still fall back to `src/entrypoints/sites/xiaohongshu-action.mjs download`. |
| `x` | `x.com` | Hybrid native + legacy fallback | Native can consume gated captured archive/media candidates and local social archive artifacts. Relation flows, followed-date, checkpoint/resume, cursor discovery, and unsupported archive state still fall back to `src/entrypoints/sites/x-action.mjs`. |
| `instagram` | `www.instagram.com` | Hybrid native + legacy fallback | Native can consume gated captured feed-user/archive payloads, media candidates, and local social archive artifacts. Relation flows, followed-users, checkpoint/resume, authenticated feed discovery, and unsupported archive state still fall back to `src/entrypoints/sites/instagram-action.mjs`. |

Native runner execution means `resolved-task.json` contains concrete `resources[]` and the shared executor downloads them into `files/`. Legacy fallback means `resolved-task.json` records `legacy-downloader-required`, then the runner spawns the site entrypoint and normalizes its JSON output into the unified manifest.

Hybrid native status is not a live-capability claim. Current native coverage is
fixture-backed, request-injected, injected-fetch, or explicitly gated by
`--resolve-network`; live smoke, real login, and real download validation remain
separate release gates.

## Commands

Dry-run:

```powershell
node src\entrypoints\sites\download.mjs --site bilibili --input BV1example --json
```

Execute:

```powershell
node src\entrypoints\sites\download.mjs --site bilibili --input BV1example --execute --json
```

Execute a native generic resource:

```powershell
node src\entrypoints\sites\download.mjs --site example --input https://example.com/file.bin --resource https://example.com/file.bin --file-name file.bin --media-type binary --execute --json
```

Resume a fixed run directory:

```powershell
node src\entrypoints\sites\download.mjs --site example --input https://example.com/file --execute --run-dir runs\downloads\example\20260427-example --resume
```

`--resume` reads the previous `manifest.json`, `queue.json`, and `downloads.jsonl`
when they exist. Valid completed artifacts are reused, incomplete resources are
attempted again, and corrupted or inconsistent recovery artifacts produce a
stable manifest `reason` instead of a thrown parser error.

Retry only resources recorded as failed:

```powershell
node src\entrypoints\sites\download.mjs --site example --input https://example.com/file --execute --run-dir runs\downloads\example\20260427-example --retry-failed
```

Quote Windows paths with spaces:

```powershell
node src\entrypoints\sites\download.mjs --site example --input https://example.com/file --execute --run-dir "C:\Users\me\Downloads\Browser Wiki Runs\example" --resume
```

`--retry-failed` requires old queue state. It reuses successful resources,
retries only resources whose old queue status is `failed`, and skips resources
that were not previously failed. If no old state exists it writes a skipped
manifest with `reason: retry-state-missing`; if the old queue has no failed
entries it writes `reason: retry-failed-none`.

Every `report.md` includes a status explanation, next `--resume` and
`--retry-failed` commands, and the exact manifest, queue, and downloads JSONL
paths for the run.

## Session Preflight

Required-session downloads stop before resource resolution or legacy spawn when
health reports `blocked`, `manual-required`, `expired`, or `quarantine`.
Optional-session downloads may continue anonymously only when the task is not
marked login-required.

Manifests intentionally keep only operational session metadata: `siteKey`,
`host`, `mode`, `status`, `riskSignals`, `expiresAt`, `quarantineKey`,
`reason`, and `purpose`. They do not write cookies, headers, browser profile
roots, or user data directories.

## Manifest Fields

- `schemaVersion`: manifest schema version.
- `runId`: run directory id.
- `planId`: stable plan id for the site, task type, and input.
- `siteKey`: normalized site key.
- `status`: `passed`, `partial`, `failed`, `blocked`, or `skipped`.
- `reason`: stable failure or skip reason when available.
- `counts`: expected, attempted, downloaded, skipped, and failed counts.
- `files`: successful or resumed file records with `resourceId`, `url`, `filePath`, `bytes`, `mediaType`, `sha256`, and `skipped` when available.
- `failedResources`: failed resource records with `resourceId`, `url`, `filePath`, `reason`, `error`, and verification failures when available.
- `resumeCommand`: generated command for blocked, partial, or failed runs.
- `artifacts`: paths to `manifest`, `queue`, `downloadsJsonl`, `reportMarkdown`, `plan`, `resolvedTask`, `runDir`, and `filesDir`; legacy runs may also include `artifacts.source` pointing at the spawned downloader's own artifacts.
- `legacy`: legacy adapter command metadata when the run used an existing site downloader, including entrypoint, executor kind, command args, exit code, source manifest/run directory, and stderr preview.
- `session`: sanitized anonymous, reusable-profile, or authenticated lease metadata and risk/session status.

## Artifact Fields

- `plan.json`: normalized `siteKey`, `host`, `taskType`, source input, session requirement, resolver metadata, output policy, and legacy fallback metadata.
- `resolved-task.json`: normalized resolved resources. Native runs include concrete resources; legacy fallback runs use an empty resource list with `completeness.reason: legacy-downloader-required`.
- `queue.json`: per-resource status for native execution. Status values include `pending`, `running`, `downloaded`, `skipped`, and `failed`.
- `downloads.jsonl`: per-attempt native result rows, or one normalized legacy summary row for fallback execution.
- `report.md`: human-readable status, counts, artifact paths, and next resume/retry commands.
- `files/`: native downloaded files. Legacy adapters may write their own files elsewhere and expose those paths through `manifest.files` and `artifacts.source`.

## Social Media Executor Artifacts

X and Instagram media operations still run through the social action entrypoints during this phase. When `--download-media` is used, the social media executor writes its own artifacts in the action run directory:

- `downloads.jsonl`: one row per media download attempt, including URL, type, page/item references, file path, byte count, content hash, transport, retry attempts, and errors.
- `media-queue.json`: resumable queue with `schemaVersion`, counts, queue status, media references, fallback type, expected type, and the last result.
- `media-manifest.json`: aggregate download quality manifest with hashes, small-file anomalies, content-type mismatches, ffprobe video checks, poster-only video fallback counts, and media completeness signals.
- Action manifest / state files: archive status, bounded/degraded reasons, recovery runbook commands, and links to the media artifacts.
- CSV/HTML indexes may be written by full archive runs for local review when the action supports them.

For X video entries, API media is preferred. If only a poster URL is visible, artifacts mark `fallbackFrom: poster-only-video-fallback` and `expectedType: video`; do not call that a complete video download without checking the media manifest.

## Recovery Reasons

- `retry-state-missing`: `--retry-failed` was requested but no previous run
  artifacts existed in `--run-dir`.
- `retry-queue-missing`: previous state existed, but `queue.json` was missing.
- `retry-failed-none`: old `queue.json` contained no `failed` entries.
- `manifest-queue-count-mismatch`: manifest expected count and queue length
  disagree, so the runner does not guess which resources are safe to reuse.
- `manifest-queue-resource-mismatch`: manifest file entries reference resources
  that are not present in the old queue.
- `queue-downloads-resource-mismatch`: downloads JSONL references resources
  that are not present in the old queue.
- `recovery-artifact-missing`, `recovery-artifact-not-file`, and
  `recovery-artifact-size-mismatch`: a previously successful resource could not
  be reused from the recorded file path.

## Boundaries

- The download executor consumes concrete resource URLs. It does not parse pages, discover cursors, sign API requests, or repair login.
- Site modules own planner, resolver, and legacy command construction.
- The session manager returns a lease and health status. It does not download resources.
- Legacy Python and action routers remain valid adapters until their resource resolvers are migrated.
- Live authentication health is never implied by docs. If a site needs a reusable profile, verify or recover that profile through the documented site action flow before executing live traffic.
