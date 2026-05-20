# AGENTS.md

## Project

Recommended project path after external directory migration:

`C:\Users\lyt-p\Desktop\SiteForge`

This repository implements SiteForge. Active checkouts may still run from the legacy `C:\Users\lyt-p\Desktop\Browser-Wiki-Skill` path until the operator closes live sessions and renames the directory externally. The current long-term goal is the multi-site Site Capability Layer. `README.md`, `CONTRIBUTING.md`, and this `AGENTS.md` file are the working references.

## Working Rules

- Work only inside this project directory.
- Do not create branches, worktrees, pushes, or PRs unless the user explicitly asks.
- Do not overwrite or revert unrelated user changes.
- Do not persist raw credentials, cookies, CSRF values, authorization headers, SESSDATA, tokens, session ids, browser profiles, or equivalent sensitive material.
- Do not implement CAPTCHA bypass, anti-bot bypass, access-control bypass, credential extraction, or silent privilege expansion.
- Prefer small, reversible implementation batches with focused verification.

## Accelerated A/B Loop

Use an accelerated A/B loop by default:

- Agent A is the main execution agent and owns code edits, verification, matrix updates, and reporting.
- Agent A may create 6 subagents per batch.
- 5 acceleration subagents may be used to push implementation forward in parallel, including gap discovery, focused code edits, focused test additions, verification support, and implementation proposals.
- Acceleration subagents should receive narrow, disjoint ownership scopes from Agent A before editing files.
- Acceleration subagents must coordinate with Agent A's current batch, avoid overlapping write sets, and must not revert or overwrite work from Agent A, Agent B, the user, or other subagents.
- 1 subagent acts as Agent B for monitoring and review.
- Agent B reviews results and risk; Agent B does not edit files.

The loop should optimize for momentum. Do not wait for perfect global certainty before making a narrow useful change.

## Matrix And Status

Maintain the `Site Capability Layer Implementation Matrix` section in `CONTRIBUTING.md` as the progress record for design sections 1-20.

Allowed statuses:

- `not_started`
- `partial`
- `implemented`
- `verified`
- `blocked`

Use these statuses pragmatically:

- `partial`: some evidence exists, but important implementation or validation is missing.
- `implemented`: the intended code path exists and at least one relevant focused verification has been run or a clear reason for not running it is recorded.
- `verified`: evidence is strong enough for the current risk level, the matrix records the verification result, no known serious safety or architecture violation remains, and Agent B accepts the status.

Do not treat `verified` as requiring a fixed checklist every time. Use engineering judgment, proportional to risk and blast radius. High-risk security, session, credential, artifact, downloader-boundary, and schema/version gates need stronger evidence than low-risk documentation or narrow test-only changes.

Matrix updates may be compressed. For touched sections, record the useful facts: code evidence, verification evidence, current result, known gaps, and next task.

## Implementation Bias

Prefer implementation-first progress:

- Batch related same-type work when it reduces overhead without mixing unrelated concerns.
- Run focused tests first; defer broad suites to centralized verification batches when appropriate.
- Keep changes connected to real runtime paths, tests, or enforced boundaries.
- Avoid placeholder-only abstractions and documentation-only completion.
- Let existing code patterns guide structure.

Good batch types include:

- Runtime compatibility gates.
- SecurityGuard, redaction, or artifact-write guards.
- Downloader boundary and import-rule enforcement.
- Lifecycle hook and observability producer evidence.
- Schema governance and versioning integration.
- Failure-mode and reasonCode mapping.

## New Site Intake

A bare new-site URL is full onboarding by default. Do not stop after only adding
a profile, registry row, or skill. Complete or explicitly block profile,
registry, capability record, SiteAdapter mapping, repo-local skill, discovery
artifacts, coverage gate, SiteAdapter contract tests, matrix update, and review
acceptance before reporting the site as onboarded.

Discovery must include login-state nodes, permission/risk signals, restriction
pages, recovery entries, and manual-risk states. If those surfaces are blocked
by login, paywall, VIP access, CAPTCHA, risk-control, permission checks, or rate
limits, record the blocked surface instead of bypassing it.

## Architecture Guardrails

Keep the Site Capability Layer boundaries clear:

- Kernel/orchestrator stays site-agnostic and owns coordination, common safety, lifecycle, schema, and reason semantics.
- Capability Services provide reusable cross-site mechanisms.
- SiteAdapter owns site-specific interpretation and validation.
- downloader is a low-permission consumer of planned tasks, policies, minimal session views, and resolved resources.

Do not move site-specific semantics into downloader or Kernel. Do not give downloader raw credentials, raw browser profiles, or unredacted session material.

## Verification Guidance

Every implementation batch should run the smallest relevant focused verification when feasible.

Prefer tests close to the changed behavior:

- Unit or contract tests for changed modules.
- Redaction golden tests for sensitive writes.
- Schema/version compatibility tests for governed data.
- Downloader dry-run or boundary tests for downloader changes.
- Matrix tests after matrix updates.

If verification is skipped or deferred, record why and what remains risky. Never report unrun tests as passed.

## Documentation Retention

Keep primary project guidance in `README.md`, `CONTRIBUTING.md`, and
`AGENTS.md`. The Site Capability matrix and focused regression batch definition
live in `CONTRIBUTING.md`.

The repository-level `docs/` directory is allowed only for explicitly requested,
durable release or architecture maps such as `docs/architecture.md` and
`docs/release-hardening-plan.md`, plus task-specific validation notes that an
operator asks to retain. Fold short-lived handoffs, dated validation snapshots,
and duplicate status tables into the root sources or remove them during cleanup
batches.

## Reporting

Keep reports concise. Include:

- Batch goal.
- Sections touched.
- Files changed.
- What was implemented.
- Verification run and result.
- Matrix update.
- Safety-sensitive areas touched.
- Known gaps.
- Next recommended batch.

Agent B should answer with one of:

- `Accepted`
- `Needs changes`
- `Rejected`

If accepted and continuing, Agent B may reply:

`Continue.`

## Completion

The Site Capability Layer effort is complete only when the `CONTRIBUTING.md` matrix shows sections 1-20 as `verified` and Agent B accepts the final state.

Until then, continue in small accelerated batches unless the user stops or changes direction.
