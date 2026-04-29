# Download Runner Next Steps

Phase 2 should stop at runner contracts, resumable artifacts, legacy adapter
normalization, and seeded native resource execution. Future work now continues
on local `main` in the current project directory. Do not create new branches or
extra worktrees unless the operator explicitly asks for that.

## Local Main Workstreams

1. Native resolvers
   - Deepen real native resolvers for one site at a time.
   - Start with inputs that can produce concrete `resources[]` without invoking legacy entrypoints.
   - Keep page parsing, API signing, cursor discovery, and auth recovery inside site modules, not the generic executor.
   - Acceptance: dry-run and execute produce native `resolved-task.json`, `queue.json`, `downloads.jsonl`, `manifest.json`, and `report.md` without `legacy-downloader-required`.

2. Legacy reduction
   - Reduce fallback usage only after the matching native resolver passes focused tests.
   - Move one task shape at a time from legacy adapter to native execution.
   - Keep legacy adapters available for unsupported shapes until replacement coverage is proven.
   - Acceptance: migration matrix names the exact native task shapes and the remaining fallback reasons.

3. Session governance
   - Connect session health to real reusable profile governance instead of static preflight hints.
   - Normalize blocked states for expired sessions, login walls, challenges, quarantine, and manual recovery.
   - Store only sanitized operational metadata in runner artifacts.
   - Acceptance: required-session tasks stop before resolver or legacy spawn when profile health is blocked, and optional-session tasks can continue only when the site declares anonymous execution safe.

4. Live smoke boundaries
   - Define explicit approval boundaries for live smoke runs.
   - Default all smoke tooling to dry-run.
   - Require an explicit `--execute`, selected site/account, bounded item counts, timeout, and run directory before live traffic.
   - Acceptance: live smoke reports classify `passed`, `failed`, `blocked`, `skipped`, and `unknown` from artifacts, not from command exit code alone.

5. Release gates
   - Add release gate documentation and focused test commands before publishing.
   - Separate unit tests, fixture-backed native resolver tests, recovery/resume tests, and approved live smoke evidence.
   - Acceptance: publication is blocked until the required tests pass, branch stack is current with upstream, release notes match actual scope, and dirty unrelated work is absent.

## Operating Rules

- Keep each change small, path-scoped, and independently verifiable on `main`.
- Do not modify release notes while planning the next workstream step; update
  them only when a local change is ready for publication.
- Do not remove a legacy fallback in the same change that introduces an unproven native resolver.
- Do not treat a reusable profile path as healthy unless health tooling reports it as usable.
- Do not run live traffic from tests or release scripts without explicit operator approval.
- Do not write cookies, headers, browser profile roots, or other profile material into download runner artifacts.

## Publication Preconditions

- `node --test tests\node\*.test.mjs`
- `python -m unittest discover -s tests\python -p "test_*.py"`
- Native resolver fixture tests for any newly migrated task shape.
- Recovery and resume tests for any changed manifest, queue, or downloads JSONL behavior.
- Approved live smoke evidence only for branches that claim live authenticated behavior.
- `git status --short --branch` reviewed before staging, with unrelated work left untouched.
