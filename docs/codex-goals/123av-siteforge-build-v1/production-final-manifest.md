# 123av Production Skill Final Manifest

## Scope

Target: `https://123av.com/zh/dm9`

Goal: upgrade the current generated 123av SiteForge skill into a production task skill with high-level task templates, API-first planning, verified site fallback, resumable execution, structured artifacts, and strict safety governance.

## Added

- `scripts/123av-research-task-runner.mjs`
- `tests/node/123av-research-task-runner.test.mjs`
- `skills/123av/SKILL.md`
- `skills/123av/references/123av-live-catalog.json`
- `skills/123av/references/123av-live-catalog.md`
- `.siteforge/sites/123av.com-a26d204b/current/production_task_templates.json`
- `.siteforge/sites/123av.com-a26d204b/current/production_capability_diff.json`
- `.siteforge/sites/123av.com-a26d204b/current/production_runtime_examples.json`
- `docs/codex-goals/123av-siteforge-build-v1/production-skill-evaluation.json`
- `docs/codex-goals/123av-siteforge-build-v1/production-skill-evaluation.md`

## Updated

- `.siteforge/sites/123av.com-a26d204b/current/skill.yaml`

## E2E Artifacts

- `.siteforge/123av-production-tasks/e2e-channel-full-archive`
- `.siteforge/123av-production-tasks/e2e-author-full-archive`
- `.siteforge/123av-production-tasks/e2e-keyword-trend`
- `.siteforge/123av-production-tasks/e2e-entity-profile`
- `.siteforge/123av-production-tasks/e2e-content-profile`
- `.siteforge/123av-production-tasks/e2e-list-history-collection`
- `.siteforge/123av-production-tasks/e2e-event-timeline-report`

## Verification

- `node --check scripts/123av-research-task-runner.mjs`
- `node --test --test-concurrency=1 tests/node/123av-research-task-runner.test.mjs`
- Seven representative E2E executions under `.siteforge/123av-production-tasks/`, including the `author-full-archive` alias.
- Sensitive material scan over `.siteforge/123av-production-tasks/` returned no matches for raw site URLs, auth material, raw body/html fields, title/description/comment/thumbnail fields.

## Score

Final Chinese three-layer score: 100.
