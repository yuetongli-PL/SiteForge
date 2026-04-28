# Download Stack Local Release Closeout

This document records the local release stack state only. It is not a push
plan to execute from this worktree.

## Current Local Stack

- Remote base: `origin/main`.
- Phase 1 base branch: local `main` / `codex/download-runner-base`, both at
  the same commit and ahead of `origin/main` by 6 commits.
- Phase 2 branch: `codex/download-runner-phase2`, ahead of local `main` by 22 commits.
- Native resolver branch: `codex/download-native-resolvers`, ahead of `codex/download-runner-phase2` by 4 commits in the current local stack.
- 22biqu URL resolver follow-on branch: `codex/download-native-22biqu-url-resolver`, ahead of `codex/download-native-resolvers` by 1 commit.
- Page seed resolver follow-on branch: `codex/download-native-page-seeds`, ahead of `codex/download-native-22biqu-url-resolver` by 1 commit.
- Current worktree branch: `codex/download-native-resolvers`.

Stack shape:

```text
origin/main
  -> local main / codex/download-runner-base (+6)
  -> codex/download-runner-phase2 (+22)
  -> codex/download-native-resolvers (+4)
  -> codex/download-native-22biqu-url-resolver (+1)
  -> codex/download-native-page-seeds (+1)
```

## Publication Order

Use stacked review order. Do not collapse the stack into a single PR unless the
review target intentionally changes.

1. Publish Phase 1 base against `origin/main`.
2. Publish Phase 2 against the Phase 1 base branch after Phase 1 is available
   for review or merged.
3. Publish native resolvers against `codex/download-runner-phase2` after Phase 2
   is available for review or merged.
4. Publish 22biqu URL resolver against `codex/download-native-resolvers`.
5. Publish page seed resolvers against `codex/download-native-22biqu-url-resolver`.

Expected PR bases:

```text
base PR:              local main / codex/download-runner-base -> origin/main
phase2 PR:            codex/download-runner-phase2 -> main
native resolvers PR:  codex/download-native-resolvers -> codex/download-runner-phase2
22biqu URL PR:        codex/download-native-22biqu-url-resolver -> codex/download-native-resolvers
page seed PR:         codex/download-native-page-seeds -> codex/download-native-22biqu-url-resolver
```

If a lower stack branch is rebased, merged, or renamed before publication,
re-check the three ahead counts before opening the next PR.

## Parallel Sibling Branches

These sibling branches were created from an earlier `codex/download-native-resolvers`
tip and currently each differs from the latest native branch by one native
release-documentation commit plus one branch-specific commit. They can still be
reviewed in parallel after the native resolver stack is available, but re-check
or rebase their base before publication if the review target requires a clean
zero-behind branch:

- `codex/download-legacy-reduction`
- `codex/download-session-governance`
- `codex/download-live-smoke-boundaries`

Do not force these sibling branches into a linear sequence on top of each other
unless review feedback or conflict resolution explicitly requires that. Their
default review base is `codex/download-native-resolvers`, not another sibling.

## Explicit Non-Actions

- Do not push from this local closeout task.
- Do not open PRs from this local closeout task.
- Do not run test suites from this local closeout task.
- Do not perform any further original worktree cleanup from this release
  closeout. The approved social dirty-file cleanup was handled separately with
  a local backup patch.

## Out Of Scope

The original social dirty patch was backed up locally at
`reports/social-dirty-backup.patch` and the two original worktree files were
restored. Keep that local backup out of the release stack and do not publish it.
