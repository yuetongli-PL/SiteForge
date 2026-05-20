# AGENTS.md

## Core Principles

### Think Before Coding

- Inspect the relevant files before editing.
- State assumptions when they affect the result.
- Ask for clarification only when ambiguity blocks useful progress.
- If the requested approach seems more complex than necessary, say so and choose the simpler path when it still satisfies the task.

### Simplicity First

- Write the minimum code that solves the requested problem.
- Do not add speculative features, configuration, abstractions, or error handling.
- Avoid single-use abstractions.
- If a solution becomes larger than the problem warrants, simplify before continuing.

### Surgical Changes

- Touch only the files and lines needed for the task.
- Do not refactor, reformat, rename, move, or delete unrelated code.
- Match existing style, naming, layout, and test patterns.
- Remove only the unused imports, variables, functions, or files made obsolete by your own changes.
- Mention unrelated issues in the final report instead of fixing them silently.

### Goal-Driven Execution

- Convert the task into a small verifiable goal.
- For multi-step work, use a short plan with a verification step for each meaningful part.
- Update nearby tests when behavior changes.
- Loop until the goal is met, blocked, or the remaining gap is clearly identified.

## Repository Rules

- Work only inside this repository.
- Do not create branches, worktrees, pushes, pull requests, or tags unless explicitly requested.
- Do not overwrite or revert unrelated user changes.
- Preserve public behavior unless the task explicitly asks to change it.
- Do not add documentation-only or placeholder-only changes unless requested.

## Verification

- Run the smallest relevant check for the change.
- Prefer focused tests before broad suites.
- Do not report a check as passed unless it actually ran and passed.
- If verification is skipped, failed, or partial, state that directly.

## Reporting

End each batch with:

- Files changed.
- What changed.
- Verification run and result.
- Known gaps or next step.
