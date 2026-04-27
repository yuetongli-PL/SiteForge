# Download Runner

The unified download runner keeps site-specific planning and resource resolution outside the generic executor.

## Flow

1. Generate a dry-run plan first.
2. Acquire a session lease when the site requires one.
3. Resolve concrete resources through the site module.
4. Execute either the generic resource executor or a legacy downloader adapter.
5. Write `manifest.json`, `queue.json`, `downloads.jsonl`, and `report.md`.

## Commands

Dry-run:

```powershell
node src\entrypoints\sites\download.mjs --site bilibili --input BV1example --json
```

Execute:

```powershell
node src\entrypoints\sites\download.mjs --site bilibili --input BV1example --execute --json
```

Resume a fixed run directory:

```powershell
node src\entrypoints\sites\download.mjs --site example --input https://example.com/file --execute --run-dir runs\downloads\example\20260427-example --resume
```

Retry only resources recorded as failed:

```powershell
node src\entrypoints\sites\download.mjs --site example --input https://example.com/file --execute --run-dir runs\downloads\example\20260427-example --retry-failed
```

## Manifest Fields

- `status`: `passed`, `partial`, `failed`, `blocked`, or `skipped`.
- `reason`: stable failure or skip reason when available.
- `counts`: expected, attempted, downloaded, skipped, and failed counts.
- `files`: successful or resumed file records.
- `failedResources`: failed resource records with reason and error fields.
- `resumeCommand`: generated command for blocked, partial, or failed runs.
- `artifacts`: paths to manifest, queue, JSONL downloads, and Markdown report.
- `legacy`: legacy adapter command metadata when the run used an existing site downloader.

## Boundaries

- The download executor consumes concrete resource URLs. It does not parse pages, discover cursors, sign API requests, or repair login.
- Site modules own planner, resolver, and legacy command construction.
- The session manager returns a lease and health status. It does not download resources.
- Legacy Python and action routers remain valid adapters until their resource resolvers are migrated.
