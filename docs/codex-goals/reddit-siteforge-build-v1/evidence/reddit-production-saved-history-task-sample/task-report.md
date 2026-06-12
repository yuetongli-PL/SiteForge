# Reddit task report: saved-history-archive

Target: reddit
Status: completed
Buckets: 2/2
API completed buckets: 0
Site fallback buckets: 2
Blocked buckets: 0
Raw items: 11
Deduped items: 7
Descriptor-only route summaries: 7

## Failure and recovery

- saved-route-structure: site_fallback_degraded_structure_only / private_api_disabled_use_verified_browser_structure; Use OAuth API replay for item-level content; this fallback preserves route structure only.
- subscribed-communities: site_fallback_degraded_structure_only / api_unavailable_use_verified_browser_bridge; Use OAuth API replay for item-level content; this fallback preserves route structure only.

## Safety

- No cookies, tokens, auth headers, browser profile, or raw private body are persisted.
