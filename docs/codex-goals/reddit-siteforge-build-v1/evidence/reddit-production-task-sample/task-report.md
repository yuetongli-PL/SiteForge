# Reddit task report: keyword-trend

Target: siteforge
Status: completed
Buckets: 3/3
API completed buckets: 0
Site fallback buckets: 3
Blocked buckets: 0
Raw items: 27
Deduped items: 18
Descriptor-only route summaries: 18

## Failure and recovery

- search-posts: site_fallback_degraded_structure_only / api_unavailable_use_verified_browser_bridge; Use OAuth API replay for item-level content; this fallback preserves route structure only.
- search-communities: site_fallback_degraded_structure_only / api_unavailable_use_verified_browser_bridge; Use OAuth API replay for item-level content; this fallback preserves route structure only.
- search-users: site_fallback_degraded_structure_only / api_unavailable_use_verified_browser_bridge; Use OAuth API replay for item-level content; this fallback preserves route structure only.

## Safety

- No cookies, tokens, auth headers, browser profile, or raw private body are persisted.
