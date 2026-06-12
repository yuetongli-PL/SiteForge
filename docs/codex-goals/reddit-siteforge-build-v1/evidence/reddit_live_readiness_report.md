# Reddit Live Readiness Report

Generated: 2026-06-09T01:25:34.802Z

Summary:
- Live successes: 0
- Blockers: 1
- Selected API plans: 78
- API plans blocked: 0
- API plans succeeded: 0
- Browser Bridge eligible routes: 362
- Browser Bridge captured routes: 0
- Browser Bridge missing routes: 0
- Browser Bridge raw missing routes: 0
- Browser Bridge boundary dispositions: 0
- Can execute OAuth read batch: false
- Can retry Browser Bridge routes: false

Status:
- fullSiteLiveReadiness: blocked_external_access_boundary
- genericLiveCrawl: not_blocked_by_supplied_robots_evidence
- oauthReadBatch: blocked_missing_oauth_input
- browserBridgeRoutes: waiting_for_verified_browser_bridge_session
- cookieCrawl: not_verified
- writeAndMutationActions: recorded_disabled_by_default

Blockers:
- reddit_oauth_api_runtime: reddit_oauth_credential_and_user_agent_required; Provide a runtime Reddit OAuth credential and descriptive User-Agent, then run the read-only API batch.

Boundary dispositions:

Next steps:
- provide-oauth-inputs: required; Provide Reddit OAuth credential and descriptive User-Agent as runtime environment inputs.
- verify-browser-bridge-session: required_before_route_retry; Verify Browser Bridge session and robots-allowed route access before retrying authenticated routes.

Commands:
- readOnlyApiBatch: blocked_until_oauth_inputs
- readOnlyApiBatchAfterOauth: node src/entrypoints/sites/reddit-action.mjs api-read-batch --runtime-index docs\codex-goals\reddit-siteforge-build-v1\evidence\reddit_oauth_api_runtime_plan_index.json --out-dir docs\codex-goals\reddit-siteforge-build-v1\evidence --batch-mode execute-all --include-parameterized --limit 78 --json
- browserBridgeRouteQueue: node src/entrypoints/sites/reddit-action.mjs browser-bridge-route-queue --out-dir docs\codex-goals\reddit-siteforge-build-v1\evidence --json

Execution boundary:
- This report stores only readiness booleans, counts, route classes, and public command templates.
- Runtime credentials, cookies, browser state, raw HTML, and response bodies are not persisted.
- Write and mutation actions remain recorded but disabled by default.
