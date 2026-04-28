# Download Stack Local Release Closeout

This document records the local release stack state only. It is not a push
plan to execute from this worktree.

## Current Local Stack

- Remote base: `origin/main`.
- Phase 1 base branch: local `main`, ahead of `origin/main` by 6 commits.
- Phase 2 branch: `codex/download-runner-phase2`, ahead of local `main` by 22 commits.
- Native resolver branch: `codex/download-native-resolvers`, ahead of `codex/download-runner-phase2` by 3 commits after this local closeout document.
- Current worktree branch: `codex/download-native-resolvers`.

Stack shape:

```text
origin/main
  -> main (+6)
  -> codex/download-runner-phase2 (+22)
  -> codex/download-native-resolvers (+3)
```

## Publication Order

Use stacked review order. Do not collapse the stack into a single PR unless the
review target intentionally changes.

1. Publish Phase 1 base against `origin/main`.
2. Publish Phase 2 against the Phase 1 base branch after Phase 1 is available
   for review or merged.
3. Publish native resolvers against `codex/download-runner-phase2` after Phase 2
   is available for review or merged.

Expected PR bases:

```text
base PR:              main -> origin/main
phase2 PR:            codex/download-runner-phase2 -> main
native resolvers PR:  codex/download-native-resolvers -> codex/download-runner-phase2
```

If a lower stack branch is rebased, merged, or renamed before publication,
re-check the three ahead counts before opening the next PR.

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
