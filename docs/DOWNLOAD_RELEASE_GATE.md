# Download Release Gate

Release gate for the integrated download architecture on local `main`.

This gate is documentation-only. It does not push branches, open pull requests,
run real downloads, or perform account login or recovery. Live work requires a
separate operator approval with a bounded plan.

## Scope

Use this gate before the local download architecture is described as ready to
ship or before any later push/PR step is separately approved. It covers:

- Local branch/base readiness.
- Dirty work and unrelated edits.
- Required local tests and focused download tests.
- Release notes accuracy.
- Live smoke evidence boundaries.

It does not replace the Phase 2 release notes. Historical Phase 2 facts stay in
`docs/DOWNLOAD_RUNNER_RELEASE_NOTES.md`; this gate may reference them only as
the previous stack baseline or as a source for the next branch's base.

## Hard Stops

Block publication when any of these are true:

- The branch is based directly on stale `origin/main` while its required base
  stack is still unpublished.
- `git status` shows unrelated dirty work, generated run artifacts, profile
  material, or edits from another owner that are not explicitly part of the
  release.
- Release notes claim behavior that is not covered by code, tests, or approved
  evidence.
- A branch claims live authenticated behavior without approved live smoke
  artifacts.
- A gate step would require pushing, opening a PR, real network downloads,
  account login, cookie import, or auth recovery.

## Local Branch Gate

Run only local inspection commands during the gate:

```powershell
git status --short --branch --untracked-files=all
git branch --list -vv
git log --oneline --decorate --max-count=30
git log --oneline main..HEAD
git log --oneline origin/main..HEAD
```

Pass criteria:

- The current branch is `main` unless a later task explicitly changes scope.
- The branch tip contains only intended download architecture work for the
  current commit.
- Ahead counts are understood before committing or publishing.
- The worktree has not created extra branches or worktrees for this closeout.

## Dirty Work Gate

Run:

```powershell
git status --short --branch --untracked-files=all
git diff --name-only
git diff --cached --name-only
```

If the release notes refer to the sibling source worktree, inspect it
read-only:

```powershell
git -C C:\Users\lyt-p\Desktop\Browser-Wiki-Skill status --short --branch --untracked-files=all
```

Pass criteria:

- Only release-owned files are modified.
- `runs/`, browser profiles, cookies, headers, downloaded media, and other
  runtime artifacts are absent from the candidate diff.
- Other agents' dirty files are left untouched and are called out as external
  to the release.
- Docs-only gate work stays under `docs/` unless a later approved task expands
  scope.

## Test Gate

Minimum full-suite commands before publication:

```powershell
node --test tests\node\*.test.mjs
python -m unittest discover -s tests\python -p "test_*.py"
```

Focused download gate commands:

```powershell
node --test `
  tests\node\downloads-runner.test.mjs `
  tests\node\download-site-modules.test.mjs `
  tests\node\download-native-seed-schema.test.mjs `
  tests\node\download-22biqu-native-resolver.test.mjs `
  tests\node\download-bilibili-page-seed-resolver.test.mjs `
  tests\node\download-xiaohongshu-page-seed-resolver.test.mjs `
  tests\node\download-douyin-native-resolver.test.mjs `
  tests\node\download-social-native-resolver.test.mjs `
  tests\node\download-media-executor.test.mjs `
  tests\node\douyin-media-resolver.test.mjs
```

Add branch-specific focused tests when the branch changes a resolver,
manifest field, queue behavior, recovery path, session preflight, or legacy
adapter contract.

Pass criteria:

- Full Node and Python suites pass.
- Focused download tests pass.
- Resolver branches include fixture-backed native resolver coverage for every
  migrated task shape.
- Native social resolver coverage documents gate flags and unsupported
  legacy-only actions, because social native resolution is intentionally gated
  rather than a default replacement.
- Network-capable resolver branches prove the gate in runner tests: default
  resolver deps receive `allowNetworkResolve: false`, `--resolve-network`
  flips it to `true`, and required unhealthy sessions block before resolver
  deps or legacy adapters run.
- Recovery or resume branches include artifact-level tests for `manifest.json`,
  `queue.json`, and `downloads.jsonl`.
- Test failures are not waived by release notes. They must be fixed or the
  branch must be marked blocked.

## Release Notes Gate

Use release notes as an evidence index, not as a place to rewrite history.

Pass criteria:

- Phase 2 historical facts remain unchanged unless correcting a factual typo.
- A next-branch release draft names only the current branch delta.
- Stack base, ahead counts, and target base branch are current at verification
  time.
- Test results list exact commands and pass counts from the current branch.
- Any missing live smoke is stated explicitly as not covered.
- Publication instructions say where the branch should be based, but this gate
  itself does not push or open a PR.

For Phase 2, keep using:

- `docs/DOWNLOAD_RUNNER_RELEASE_NOTES.md`
- `docs/DOWNLOAD_RUNNER_PHASE2_PR.md`

For a follow-up branch, create a separate branch-scoped release note or append
a clearly dated current-branch section in a new document. Do not silently
rewrite the Phase 2 release package as if it described the follow-up branch.

## Live Smoke Gate

Default live smoke status is `not-run`. That is acceptable only when the branch
does not claim live authenticated behavior.

Use `docs/DOWNLOAD_LIVE_VALIDATION_MATRIX.md` as the approval checklist and
case matrix before any live run.

This gate must not:

- Run `--execute` against live sites.
- Download real media or books.
- Open browser login flows.
- Import cookies.
- Recover or mutate a reusable account profile.
- Treat command exit code alone as live acceptance.

Live smoke can be attached later only with explicit operator approval and a
bounded plan that names:

- Site and account.
- Case or task type.
- Maximum item or user count.
- Timeout.
- Output run directory.
- Expected artifact files.
- Stop conditions for login wall, challenge, rate limit, or missing session.

Live smoke evidence must classify each case from artifacts as one of:

- `passed`
- `failed`
- `blocked`
- `skipped`
- `unknown`

`blocked` and `skipped` are valid evidence outcomes, but they do not prove live
download capability.

## Live Validation Manifest Schema

`--live-validation <scenario>` records planned validation metadata only. It
must not be treated as approval to run live smoke. The normalized manifest field
is:

```json
{
  "liveValidation": {
    "status": "planned",
    "requiresApproval": true,
    "approvalId": "operator-ticket-or-empty",
    "siteKey": "bilibili",
    "scenario": "bilibili-dash-mux",
    "evidenceLevel": "fixture|injected|live-smoke|real-download",
    "liveSmoke": false,
    "realDownload": false,
    "authenticated": false
  }
}
```

Accepted statuses are `not-run`, `planned`, `approved`, `running`, `passed`,
`failed`, `blocked`, `skipped`, and `unknown`. A case can move to `approved` or
`running` only after a separate bounded approval names site, account/profile,
case, item limits, output directory, timeout, and stop conditions.

## Resolver Evidence Gate

Every native resolver that touches real network code must satisfy all gates:

- `--resolve-network` or an injected/mock fetch dependency is present.
- Required session health is ready before resolver deps run.
- Resolver evidence is complete for the task shape; partial evidence returns no
  native resources or marks completeness false.
- Manifest metadata is sanitized. It may include header names, cookie presence,
  risk flags, cursor availability, and schema versions, but not cookie values,
  auth headers, raw cursor strings, request-template secrets, or profile roots.

Current native evidence contracts include:

- `bilibili-native-api-evidence-v1`
- `douyin-native-evidence-v1`
- `xiaohongshu-header-freshness-v1`
- `social-archive-v2`

## Session Manifest Gate

Download, site-doctor, and social live validation entrypoints must make session
state auditable before claiming authenticated capability.

Accepted session providers:

- `unified-session-runner`: a sanitized manifest exists under
  `runs/session/.../manifest.json`, or an explicit per-run session health
  directory such as `x-session-health/manifest.json`.
- `legacy-session-provider`: the command is still using the older site-login,
  site-keepalive, site-doctor, or action-layer provider and does not claim
  unified session governance coverage.

Pass criteria:

- A real download or live smoke manifest either references a unified session
  health manifest or explicitly marks the session provider as
  `legacy-session-provider`.
- Required-session download and site-doctor CLI runs default to a read-only
  unified health plan. `--session-health-plan` remains an explicit form of the
  same behavior.
- `--no-session-health-plan` is the explicit escape hatch for legacy provider
  runs; those runs must write `legacy-session-provider` before they can pass
  this traceability gate.
- `--session-manifest <path>` consumes an existing unified health manifest
  without triggering login, keepalive, profile rebuild, cookie import, or live
  downloads.
- `site-doctor` and site action manifests record a `sessionHealth` summary and
  `sessionProvider`.
- Social live plans include `x-session-health` and/or
  `instagram-session-health` before the corresponding auth doctor case.
- Before any live-capability claim, run the offline audit against the candidate
  artifacts:
  `node scripts/download-release-audit.mjs --runs-root runs --out-dir runs/download-release-audit`.
  The audit is read-only and must report no blocked authenticated session gate
  rows unless the run is explicitly marked `legacy-session-provider`.
- Blocked audit rows include a `repairPlan` guidance object and the Markdown
  report includes a `Repair Plan` column. The suggested command stays dry-run,
  for example:
  `node src/entrypoints/sites/session-repair-plan.mjs --site x --audit-manifest runs/download-release-audit/download-release-audit.json`.
- Download and social action reports include `Next session repair command`
  when the per-run session traceability gate is blocked. Social live matrix
  reports surface the same guidance in their `Repair Plan` column. These
  commands route to `node src/entrypoints/sites/session-repair-plan.mjs --site <site> --session-gate-reason <reason>`
  and do not execute login, keepalive, or profile repair.
- Session manifests stay sanitized: no cookie values, auth headers, raw cursor
  state, profile root, or `userDataDir` raw path.

This gate is a traceability gate, not live evidence. A `ready` session health
manifest proves only that the health layer accepted the current evidence; it
does not prove real downloads or authenticated archive completion without the
separate live smoke gate.

## Session Repair Execution Gate

`session-repair-plan` is dry-run by default. In `--execute` mode it only builds
an audit command after `--approve-action <action>` matches the suggested
allowlisted action. It never spawns child commands.

Allowlisted command construction:

- `site-login`
- `site-keepalive`
- `inspect-session-health`

Dangerous or non-allowlisted actions such as `rebuild-profile` remain blocked
and require a human runbook plus separate approval before any real operation.

## Gate Evidence Template

Use this template in a branch release note or handoff:

| Gate | Evidence | Status | Notes |
| --- | --- | --- | --- |
| Local branch | `git status`, branch list, local logs | `pass` / `blocked` | Base and ahead counts |
| Dirty work | `git status`, diff file lists | `pass` / `blocked` | Unrelated files excluded |
| Tests | Full and focused test commands | `pass` / `blocked` | Include pass counts |
| Session gate audit | `scripts/download-release-audit.mjs` JSON/Markdown | `pass` / `blocked` | Offline only; no live/login/download side effects |
| Release notes | Branch-scoped note review | `pass` / `blocked` | No Phase 2 history rewrite |
| Live smoke | Approved artifacts or `not-run` | `pass` / `blocked` / `not-run` | State whether live behavior is claimed |

## Current Local Evidence

Latest local offline evidence on `main`:

- `git status --short --branch --untracked-files=all`: clean,
  `main...origin/main [ahead 67]`.
- `node --test tests\node\*.test.mjs`: 668 passed, 0 failed.
- `python -m unittest discover -s tests\python -p "test_*.py"`: 46 tests OK.
- Live smoke: `not-run`.
- Real login: `not-run`.
- Real download: `not-run`.

## Publication Boundary

This document stops before publication. After all gates pass, a separate
operator-approved publication step may decide whether to fetch, push, or open a
PR. That publication step must re-check stack and dirty work because other
agents may have edited the repository after this gate was prepared.
