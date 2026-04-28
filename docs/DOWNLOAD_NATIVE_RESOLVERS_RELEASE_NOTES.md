# Download Native Resolvers Release Notes

This branch is stacked on the frozen Phase 2 download runner branch. Do not
open it directly against `origin/main`.

## Current Stack

- Base branch: `codex/download-runner-phase2` at `4a6137b docs(downloads): finalize phase2 publication package`.
- Feature branch: `codex/download-native-resolvers`.
- Implementation commit: `90909a3 feat(downloads): expand native resolver execution path`.
- Release package commit: this document-only release note commit.
- Local closeout commit: documents local stack release order without pushing.
- Stack shape: `origin/main` -> local `main` / `codex/download-runner-base` (+6) -> `codex/download-runner-phase2` (+22) -> `codex/download-native-resolvers` (+4).
- Implementation delta before release packaging: this branch was ahead of `codex/download-runner-phase2` by 1 commit and ahead of `origin/main` by 29 commits.
- After the local stack closeout document is committed, the branch should be ahead of `codex/download-runner-phase2` by 4 commits.

## Included Capabilities

- Adds a native 22biqu directory resolver for ordinary book directory inputs when local fixture HTML, a fixture HTML file, or an injected mock `fetchImpl` is provided.
- Keeps 22biqu Python legacy fallback for unsupported inputs, missing local data, or directory pages without chapter links.
- Tightens Bilibili, Douyin, and Xiaohongshu native seed resolver schema tests for multi-resource field consistency.
- Adds runner coverage proving native resources flow through the generic executor instead of legacy spawn, including dry-run and mocked execute paths.
- Adds the download release gate document for future stacked branches.

## Not Included

- No real 22biqu network crawl, real book download, or public-site smoke test.
- No account login, credential import, profile recovery, or live authenticated verification.
- No removal of legacy fallback paths.
- No changes to the original worktree social dirty files.
- No push or pull request creation.

## Publication Sequence

1. Publish or merge `codex/download-runner-base` against `origin/main`.
2. Publish or review `codex/download-runner-phase2` against `codex/download-runner-base`.
3. Publish `codex/download-native-resolvers` against `codex/download-runner-phase2`.
4. Publish `codex/download-native-22biqu-url-resolver` against `codex/download-native-resolvers`.
5. Publish `codex/download-native-page-seeds` against `codex/download-native-22biqu-url-resolver`.
6. Review sibling branches based on `codex/download-native-resolvers` in parallel; do not force them into a linear sibling-on-sibling stack.
7. If any lower stack branch is rebased or merged first, re-check this branch before publication.

Sibling branches currently based on `codex/download-native-resolvers`:

- `codex/download-legacy-reduction`
- `codex/download-session-governance`
- `codex/download-live-smoke-boundaries`

## Validation

Latest local verification for this branch:

- Focused download suite: 70 passed.
- `node --test tests\node\*.test.mjs`: 565 passed.
- `python -m unittest discover -s tests\python -p "test_*.py"`: 46 passed.

Required before publication:

```powershell
node --test tests\node\download-22biqu-native-resolver.test.mjs tests\node\download-site-modules.test.mjs tests\node\download-native-seed-schema.test.mjs tests\node\downloads-runner.test.mjs tests\node\download-media-executor.test.mjs
node --test tests\node\*.test.mjs
python -m unittest discover -s tests\python -p "test_*.py"
git status --short --branch
git -C C:\Users\lyt-p\Desktop\Browser-Wiki-Skill status --short --branch
```

## Gate Status

- Stack gate: current branch is `codex/download-native-resolvers`, stacked on Phase 2 with one implementation commit plus this release package commit.
- Dirty work gate: downloads worktree should be clean after this release note commit; original worktree still has the expected social router/test dirty files and remains out of scope.
- Test gate: full Node and Python suites passed locally after the feature commit.
- Live smoke gate: not run and not claimed.

## Sibling Branches

Do not keep adding new resolver behavior to this release branch. The follow-on
work is split into sibling branches based on `codex/download-native-resolvers`:

- `codex/download-legacy-reduction`: document the 22biqu native task shapes now covered and list the remaining legacy fallback reasons.
- `codex/download-session-governance`: connect runner preflight to real reusable profile governance without exposing cookies, headers, or profile material.
- `codex/download-live-smoke-boundaries`: gate live smoke verification boundaries without claiming live coverage from local tests alone.

These sibling branches can be reviewed in parallel. Do not stack them on top of
each other unless a reviewer explicitly asks for a combined sequence.

Follow-on resolver branches created after this release note:

- `codex/download-native-22biqu-url-resolver`: adds explicit `--resolve-network` gating and injected-fetch support for 22biqu URL directory resolution.
- `codex/download-native-page-seeds`: adds offline Bilibili and Xiaohongshu page/API seed fixture resolvers while keeping ordinary pages on legacy fallback.
