# Download Stack Local Release Closeout

This document records the current local closeout state for the integrated
download architecture. It is not a push or pull-request plan.

## Current Local State

- Active branch: `main`.
- Remote base: `origin/main`.
- Local branch state: `main` contains the integrated download architecture work
  and is ahead of `origin/main`.
- Worktree policy: continue in `C:\Users\lyt-p\Desktop\Browser-Wiki-Skill`;
  do not create extra branches or worktrees unless explicitly requested.
- Publication policy: no push and no PR from this closeout task.

Re-check exact state immediately before any local commit or publication:

```powershell
git status --short --branch --untracked-files=all
git branch --list -vv
git log --oneline --decorate --max-count=30
```

## Integrated Capability Boundary

- Contracts, runner, executor, media executor, site modules, legacy adapter
  bridge, and session-manager bridge are integrated on `main`.
- Native resolvers cover fixture-backed, request-injected, injected-fetch, and
  gated-network evidence paths for 22biqu, Bilibili, Xiaohongshu, Douyin, X,
  and Instagram.
- Bilibili and Xiaohongshu real fetch paths remain behind `--resolve-network`;
  injected fetch tests cover the code path without hitting live sites.
- Derived DASH mux is explicit opt-in through `--enable-derived-mux`,
  `--mux-derived-media`, or `--dash-mux`. Offline tests use injected mux hooks;
  real ffmpeg/live media validation is still not run.
- Live validation is represented as manifest metadata through
  `--live-validation` and `--live-approval-id`. These flags do not run live
  smoke by themselves.
- Session repair `--execute` builds an auditable approved command only. It does
  not spawn login, keepalive, profile rebuild, or live smoke commands.

## Explicit Non-Actions

- Do not push from this local closeout task.
- Do not open PRs from this local closeout task.
- Do not run live smoke, real login, or real downloads without a separate
  bounded approval.
- Do not remove legacy fallback for a task shape until fixture, injected,
  runner, and live validation evidence are all present.
- Do not stage by broad commands such as `git add -A` or `git commit -a`; stage
  only the intended paths.
