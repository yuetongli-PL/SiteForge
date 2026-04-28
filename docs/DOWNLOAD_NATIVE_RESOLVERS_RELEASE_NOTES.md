# Download Native Resolvers Release Notes

This branch is stacked on the frozen Phase 2 download runner branch. Do not
open it directly against `origin/main`.

## Current Stack

- Base branch: `codex/download-runner-phase2` at `4a6137b docs(downloads): finalize phase2 publication package`.
- Feature branch: `codex/download-native-resolvers`.
- Implementation commit: `90909a3 feat(downloads): expand native resolver execution path`.
- Release package commit: this document-only release note commit.
- Stack shape: `origin/main` < `codex/download-runner-base` < `codex/download-runner-phase2` < `codex/download-native-resolvers`.
- Implementation delta before release packaging: this branch was ahead of `codex/download-runner-phase2` by 1 commit and ahead of `origin/main` by 29 commits.
- After this release note is committed, the branch should be ahead of `codex/download-runner-phase2` by 2 commits.

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
4. If any lower stack branch is rebased or merged first, re-check this branch before publication.

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

## Next Branch

Do not keep adding new resolver behavior to this release branch. Recommended next feature branch:

- `codex/download-legacy-reduction`: document the 22biqu native task shapes now covered and list the remaining legacy fallback reasons.

After that, use a separate branch for:

- `codex/download-session-governance`: connect runner preflight to real reusable profile governance without exposing cookies, headers, or profile material.
