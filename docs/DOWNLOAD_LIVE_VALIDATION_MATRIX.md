# Download Live Validation Matrix

This matrix is a live-readiness checklist only. It does not approve or execute
live login, live smoke, real downloads, profile repair, cookie import, or push
work. Every case below requires a separate operator approval before execution.

## Global Rules

- Run from `C:\Users\lyt-p\Desktop\Browser-Wiki-Skill` on local `main`.
- Re-check `git status --short --branch --untracked-files=all` before each
  approved live case.
- Use a unique `--run-dir` under `runs/downloads/live-validation/<site>/<case>`.
- Keep max item counts small on first pass.
- Stop immediately on login wall, challenge, rate limit, missing required
  session, unexpected schema drift, or evidence that would expose cookies,
  auth headers, raw cursors, profile roots, or downloaded private data.
- A planned `--live-validation` flag only writes manifest metadata. It is not
  approval to run live smoke by itself.
- A case can be marked production-capable only when artifacts prove:
  manifest complete, resources exist, size/hash are auditable, fallback did not
  trigger unexpectedly, and the recovery command can be rerun.

## Approval Record

Each live case must record this approval block before execution:

```json
{
  "approvalId": "",
  "approvedBy": "",
  "approvedAt": "",
  "siteKey": "",
  "caseId": "",
  "accountOrProfile": "",
  "maxItems": 0,
  "timeoutSeconds": 0,
  "runDir": "",
  "allowedActions": [],
  "stopConditions": []
}
```

`allowedActions` must name exactly what is permitted, for example
`resolve-network`, `execute-download`, `derived-mux`, `profile-keepalive`, or
`browser-login`. Anything not listed remains blocked.

## Case Matrix

| Site | Case ID | Purpose | Requires approval for | First-pass limit | Expected artifacts | Production gate |
| --- | --- | --- | --- | --- | --- | --- |
| Bilibili | `bilibili-bv-playurl` | Resolve an ordinary BV through real view/playurl API evidence. | `resolve-network` | 1 video page | `manifest.json`, `resolved-task.json`, `queue.json`, `downloads.jsonl`, report markdown | Native resources complete; no legacy fallback; no auth/header secrets in manifest. |
| Bilibili | `bilibili-collection-up` | Resolve collection/series/UP-space archive through real list/playurl evidence. | `resolve-network` | 2 videos | Same as above | Every listed entry has matching playurl evidence or returns fallback with explicit incomplete reason. |
| Bilibili | `bilibili-dash-mux` | Download DASH audio/video and mux into a derived artifact. | `resolve-network`, `execute-download`, `derived-mux` | 1 video | Original stream files, derived mux file, queue, downloads JSONL, report markdown | Mux file exists, ffprobe/size evidence is recorded, original stream queue remains auditable. |
| Douyin | `douyin-video-native` | Resolve ordinary video via native evidence path. | `resolve-network`, optional reusable session | 1 video | Manifest, resolved task, queue, downloads JSONL if executing | `douyin-native-evidence-v1` complete; no signing/header/cookie secrets; fallback only on explicit incomplete evidence. |
| Douyin | `douyin-author-native` | Enumerate author videos into native resource seeds. | `resolve-network`, optional reusable session | 2 videos | Manifest, resolved task, queue | Author enumeration side effects remain bounded; cache refresh only if approved. |
| Douyin | `douyin-followed-native` | Resolve followed updates without unsafe profile side effects. | `resolve-network`, reusable session, optional cache refresh | 2 videos or 2 creators | Manifest, resolved task, queue, sanitized session health | Cache refresh requires explicit approval; login wall/rate limit stops the run. |
| Xiaohongshu | `xiaohongshu-note-native` | Resolve ordinary note media through page/API fetch. | `resolve-network`, reusable session if required | 1 note | Manifest, resolved task, queue | `xiaohongshu-header-freshness-v1` is sanitized; note media complete or fallback reason explicit. |
| Xiaohongshu | `xiaohongshu-search-native` | Resolve search results into note media seeds. | `resolve-network`, reusable session if required | 2 notes | Manifest, resolved task, queue | Search evidence complete; headers refreshed by approved layer only. |
| Xiaohongshu | `xiaohongshu-author-native` | Resolve author page notes into native resource seeds. | `resolve-network`, reusable session if required | 2 notes | Manifest, resolved task, queue | Author pagination bounded; no profile side effects outside approval. |
| Xiaohongshu | `xiaohongshu-followed-native` | Resolve followed-user updates into native seeds. | reusable session, optional `resolve-network` | 2 users or 2 notes | Manifest, resolved task, queue, sanitized session health | Login wall/rate limit stops the run; no cookies or raw headers in artifacts. |
| X | `x-archive-replay-native` | Move captured archive replay artifacts into native resource resolution. | reusable session if capturing, `resolve-network` only if replay capture is approved | 2 posts | `items.jsonl`, `state.json`, `manifest.json`, native download manifest | `social-archive-v2` sanitized metadata; raw cursor/request secrets are not written. |
| X | `x-media-download-native` | Download media resources from native-mapped candidates. | `execute-download` | 2 media files | Queue, downloads JSONL, media files, report markdown | Media files exist with size/hash evidence; fallback not triggered for supported candidate shape. |
| Instagram | `instagram-feed-user-native` | Resolve feed-user/archive payloads into native resources. | reusable session, optional `resolve-network` | 2 posts | `items.jsonl`, `state.json`, `manifest.json`, native download manifest | Feed discovery complete or blocked/skipped explicitly; schema metadata sanitized. |
| Instagram | `instagram-media-download-native` | Download native-mapped feed media. | `execute-download` | 2 media files | Queue, downloads JSONL, media files, report markdown | Media files exist with size/hash evidence; relation/followed-date remains legacy unless separately approved. |

## Command Templates

These are templates only. Replace approval IDs, inputs, and run directories
after a specific live case is approved.

### Bilibili BV Resolve

```powershell
node src\entrypoints\sites\download.mjs `
  --site bilibili `
  --input "<bilibili-bv-url>" `
  --resolve-network `
  --live-validation bilibili-bv-playurl `
  --live-approval-id "<approval-id>" `
  --run-dir "runs\downloads\live-validation\bilibili\bilibili-bv-playurl"
```

### Bilibili DASH Mux

```powershell
node src\entrypoints\sites\download.mjs `
  --site bilibili `
  --input "<bilibili-bv-url>" `
  --resolve-network `
  --execute `
  --dash-mux `
  --live-validation bilibili-dash-mux `
  --live-approval-id "<approval-id>" `
  --run-dir "runs\downloads\live-validation\bilibili\bilibili-dash-mux"
```

### Douyin Ordinary Video

```powershell
node src\entrypoints\sites\download.mjs `
  --site douyin `
  --input "<douyin-video-url>" `
  --session-optional `
  --resolve-network `
  --live-validation douyin-video-native `
  --live-approval-id "<approval-id>" `
  --run-dir "runs\downloads\live-validation\douyin\douyin-video-native"
```

### Xiaohongshu Note

```powershell
node src\entrypoints\sites\download.mjs `
  --site xiaohongshu `
  --input "<xiaohongshu-note-url>" `
  --session-optional `
  --resolve-network `
  --live-validation xiaohongshu-note-native `
  --live-approval-id "<approval-id>" `
  --run-dir "runs\downloads\live-validation\xiaohongshu\xiaohongshu-note-native"
```

### X Archive Replay

```powershell
node src\entrypoints\sites\download.mjs `
  --site x `
  --input "<x-profile-url>" `
  --task-type social-archive `
  --session-required `
  --live-validation x-archive-replay-native `
  --live-approval-id "<approval-id>" `
  --run-dir "runs\downloads\live-validation\x\x-archive-replay-native"
```

### Instagram Feed Archive

```powershell
node src\entrypoints\sites\download.mjs `
  --site instagram `
  --input "<instagram-profile-url>" `
  --task-type social-archive `
  --session-required `
  --live-validation instagram-feed-user-native `
  --live-approval-id "<approval-id>" `
  --run-dir "runs\downloads\live-validation\instagram\instagram-feed-user-native"
```

## Evidence Review Checklist

For each approved run, review artifacts before marking the case as passed:

- `manifest.json` has `liveValidation.status` updated from `planned` only when
  evidence supports it.
- `manifest.json` has sanitized session metadata only.
- `resolved-task.json` lists native resources for supported shapes.
- `queue.json` and `downloads.jsonl` agree on attempted resources.
- Resource file paths exist when `--execute` was approved.
- Each downloaded file has non-zero size and expected hash/size evidence when
  available.
- Fallback is absent for supported complete evidence, or present with a stable
  incomplete/unsupported reason.
- Resume/retry command can be rerun against the same run directory.
- No artifact contains cookies, auth headers, raw cursor strings, request
  template secrets, profile roots, or browser profile paths.

## Current Case Evidence

Latest local evidence on `main` remains mostly offline. Do not treat these rows
as production live passes.

| Site | Case ID | Latest evidence | Status | Notes |
| --- | --- | --- | --- | --- |
| Bilibili | `bilibili-dash-mux` | `runs\live-validation\bilibili-dash-mux\20260430T053612_BV1WjDDBGE3p\session-health\manifest.json` | `blocked` | Session health stopped the run before download/mux: `profile-health-risk`; repair plan is `rebuild-profile` and requires separate approval. |
| Douyin | `douyin-video-native`, `douyin-author-native`, `douyin-followed-native` | `douyin-native-evidence-v1` focused tests | `offline-only` | Signature completeness, missing signature params, API evidence mode, and cache refresh blocked reason are sanitized and fixture-backed. Real signing/API/page parsing/cache refresh/profile side effects are not claimed. |
| Xiaohongshu | `xiaohongshu-note-native`, `xiaohongshu-search-native`, `xiaohongshu-author-native`, `xiaohongshu-followed-native` | `xiaohongshu-header-freshness-v1` focused tests | `offline-only` | Header freshness status, required/missing headers, fetch source, network gate use, and fetched URL presence are sanitized and fixture/injected-fetch backed. No live fetch, header refresh, or risk-page handling is claimed. |
| X / Instagram | `x-archive-replay-native`, `instagram-feed-user-native` | `social-archive-v2` focused tests | `offline-only` | Replay policy evidence records `not-executed`, resume unsupported, rate-limit/API-drift presence, and `cursor-replay-not-executed` without leaking cursor or request-template values. Cursor/API replay is not executed in native yet. |

## Remaining 100 Percent Gates

After the matrix cases pass, the remaining closeout work is:

- Record the live evidence summary in release notes.
- Move task shapes with all four evidence classes, fixture, injected, runner,
  and live, from `legacy-required` to `native-owned`.
- Shrink legacy adapter responsibility only for those shapes.
- Re-run focused, full Node, and full Python gates.
- Keep any deletion of fallback code as a separate reviewable commit.
