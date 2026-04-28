# Download Release Gate

Initial release gate for download-runner follow-up branches.

This gate is documentation-only. It does not push branches, open pull requests,
run real downloads, or perform account login or recovery. Live work requires a
separate operator approval with a bounded plan.

## Scope

Use this gate before any download-runner branch is described as ready to
publish. It covers:

- Branch stack shape and base readiness.
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

## Stack Gate

Run only local inspection commands during the gate:

```powershell
git status --short --branch --untracked-files=all
git branch --list -vv
git log --oneline --decorate --max-count=30
git log --oneline main..HEAD
git log --oneline origin/main..HEAD
```

Pass criteria:

- The current branch name matches the release scope.
- The branch tip contains only the intended work for this branch.
- The base stack named by the release notes is present locally.
- Ahead counts are understood and match the release notes or current release
  draft.
- If the branch is stacked on Phase 2, the gate treats Phase 2 as a baseline,
  not as newly authored current-branch work.

Current next-branch caution:

- Any follow-up branch must not be represented as release-ready until it has
  branch-specific commits, resolver evidence, and updated branch-scoped docs.

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

## Gate Evidence Template

Use this template in a branch release note or handoff:

| Gate | Evidence | Status | Notes |
| --- | --- | --- | --- |
| Stack | `git status`, branch list, local logs | `pass` / `blocked` | Base and ahead counts |
| Dirty work | `git status`, diff file lists | `pass` / `blocked` | Unrelated files excluded |
| Tests | Full and focused test commands | `pass` / `blocked` | Include pass counts |
| Release notes | Branch-scoped note review | `pass` / `blocked` | No Phase 2 history rewrite |
| Live smoke | Approved artifacts or `not-run` | `pass` / `blocked` / `not-run` | State whether live behavior is claimed |

## Publication Boundary

This document stops before publication. After all gates pass, a separate
operator-approved publication step may decide whether to fetch, push, or open a
PR. That publication step must re-check stack and dirty work because other
agents may have edited the repository after this gate was prepared.
