# Download Native Resolvers Release Notes

These notes describe the integrated native resolver state on local `main`.
They do not authorize push, PR creation, live login, live smoke, or real
downloads.

## Included Capabilities

- 22biqu native directory/book-content resolution with fixture, local artifact,
  and injected-fetch coverage.
- Bilibili native BV, multi-P, collection/series, UP-space archive, and playurl
  evidence expansion. Built-in API fetch paths stay behind injected fetch or
  `--resolve-network`.
- Bilibili DASH derived mux planning and executor support behind
  `--enable-derived-mux`, `--mux-derived-media`, or `--dash-mux`.
- Xiaohongshu note/page-facts/HTML/search/author/followed note media expansion
  with sanitized `xiaohongshu-header-freshness-v1` metadata.
- Douyin fixture/API detail, fixture HTML JSON, injected fetch JSON, ordinary
  video, author, and followed-update native evidence handling with sanitized
  `douyin-native-evidence-v1` metadata.
- X and Instagram gated social native resource mapping from captured payloads
  and local archive artifacts, including sanitized `social-archive-v2` metadata.
- Session governance preflight blocks unhealthy required sessions before native
  resolvers or legacy adapters run; manifests contain sanitized health and
  repair guidance only.
- `session-repair-plan --execute` constructs approved audit commands for
  allowlisted actions but never spawns login, keepalive, rebuild, or smoke work.

## Not Included

- No live authenticated capability is claimed from offline tests.
- No live smoke or real media/book download has been run in this closeout.
- No automatic Douyin signing/session side effects are moved into native.
- No X/Instagram live cursor replay or relation pagination is moved fully into
  native.
- No legacy fallback path is deleted. Fallback reduction remains gated by
  fixture, injected, runner, and live evidence for each task shape.

## Required Validation

Focused gate:

```powershell
node --test tests\node\download-*.test.mjs tests\node\site-session-governance.test.mjs tests\node\session-repair-plan.test.mjs
```

Full gate:

```powershell
node --test tests\node\*.test.mjs
python -m unittest discover -s tests\python -p "test_*.py"
```

Live release gate remains `not-run` until each site/case is separately
approved with a bounded plan and auditable output directory.
