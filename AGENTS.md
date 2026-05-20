# AGENTS.md

## Purpose

This file contains lightweight working rules for AI coding agents operating in this repository. Keep it concise and stable.

## Working Rules

- Work only inside this repository.
- Do not create branches, worktrees, pushes, pull requests, or tags unless the user explicitly asks.
- Do not overwrite or revert unrelated user changes.
- Prefer small, reversible changes over broad rewrites.
- Follow existing code style, naming, file layout, and test patterns.
- Keep implementation changes tied to the requested task.
- Avoid placeholder-only abstractions and documentation-only completion unless the user asks for documentation.
- Ask for clarification only when the missing detail blocks useful progress.
- When a safe assumption is reasonable, state it in the final report.

## Implementation

- Start with the smallest useful change that moves the task forward.
- Keep related edits together; avoid mixing unrelated cleanup with feature or bug work.
- Update nearby tests when behavior changes.
- Preserve public behavior unless the task explicitly asks to change it.
- Do not rename, move, or delete major modules as part of cleanup unless needed for the task.

## New Site Work

- Treat a bare new-site URL as onboarding work unless the user narrows the scope.
- Do not report a site as onboarded unless the changed pieces are implemented, tested, or clearly marked as blocked.
- Record unavailable or blocked surfaces honestly.

## Verification

- Run the smallest relevant verification that fits the change.
- Prefer focused tests before broad suites.
- Do not report a check as passed unless it actually ran and exited successfully.
- If verification is skipped, fails, or is only partial, state that directly.

## Documentation

- Keep docs changes concise.
- Remove stale handoff notes, duplicate status tables, and temporary validation snapshots when encountered.
- Do not add durable docs unless the task requires them.

## Reporting

At the end of each batch, include:

- Goal.
- Files changed.
- What changed.
- Verification run and result.
- Known gaps.
- Recommended next step.
