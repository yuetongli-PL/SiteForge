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

`--resume` reads the previous `manifest.json`, `queue.json`, and `downloads.jsonl`
when they exist. Valid completed artifacts are reused, incomplete resources are
attempted again, and corrupted or inconsistent recovery artifacts produce a
stable manifest `reason` instead of a thrown parser error.

Retry only resources recorded as failed:

```powershell
node src\entrypoints\sites\download.mjs --site example --input https://example.com/file --execute --run-dir runs\downloads\example\20260427-example --retry-failed
```

`--retry-failed` requires old queue state. It reuses successful resources,
retries only resources whose old queue status is `failed`, and skips resources
that were not previously failed. If no old state exists it writes a skipped
manifest with `reason: retry-state-missing`; if the old queue has no failed
entries it writes `reason: retry-failed-none`.

Every `report.md` includes a status explanation, next `--resume` and
`--retry-failed` commands, and the exact manifest, queue, and downloads JSONL
paths for the run.

## Manifest Fields

- `status`: `passed`, `partial`, `failed`, `blocked`, or `skipped`.
- `reason`: stable failure or skip reason when available.
- `counts`: expected, attempted, downloaded, skipped, and failed counts.
- `files`: successful or resumed file records.
- `failedResources`: failed resource records with reason and error fields.
- `resumeCommand`: generated command for blocked, partial, or failed runs.
- `artifacts`: paths to manifest, queue, JSONL downloads, and Markdown report.
- `legacy`: legacy adapter command metadata when the run used an existing site downloader.

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
