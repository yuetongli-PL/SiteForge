# Runtime Boundaries

SiteForge runtime boundaries separate descriptors, policy decisions, provider registration, sandbox services, audit views, run stores, and user-facing reports. The default release posture is fail closed.

## Non-Goals

Automatic login is not supported. Arbitrary authenticated browsing is not supported. Payment execution is not implemented. Default destructive execution is blocked.

Runtime code must not persist literal credentials, cookie values, token values, Authorization headers, Cookie headers, browser storage state, raw DOM, raw screenshots, full request or response bodies, or private session material.

## Provider Boundary

Providers cannot directly access the session vault. Providers cannot directly launch a browser. Providers cannot directly write audit, report, result, or run-store files. Providers must pass SDK validation, conformance checks, and production registration validation before use.

Production runtime provider registration defaults to API read, bounded download, and controlled browser action providers. Production payment providers and production destructive providers are not registered by default.

## Inspection Boundary

Run store, audit query, audit viewer, and regression replay inspect sanitized summaries only. They do not execute provider, browser, vault, or network paths.

## Skill Boundary

Skill task text is not authorization. A skill request must provide structured safe refs and pass runtime gates. `dryRun` does not execute a provider. `execute` still uses policy, provider registration, sandbox, auth, and audit gates.
