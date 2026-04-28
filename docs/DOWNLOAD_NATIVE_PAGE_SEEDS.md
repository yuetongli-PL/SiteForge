# Download Native Page Seed Follow-up

This local follow-up branch deepens native resolver coverage without running
live site traffic or removing legacy fallback paths.

## Covered Shapes

- Bilibili single-video offline playurl payloads can resolve to native video and
  audio resources when the request provides a fixture/API payload.
- Xiaohongshu single-note offline payloads can resolve to native image or video
  resources when the request provides a fixture/media payload.
- Existing explicit `resourceSeeds`, `resources`, and `downloadBundle` inputs
  keep their original precedence and schema.

## Still Legacy

- Bilibili ordinary BV/video page inputs without fixture/API payload still use
  the legacy action.
- Xiaohongshu ordinary note, search, profile, and followed-user inputs without
  fixture/media payload still use the legacy action.
- Douyin ordinary video/user/search/followed-update inputs remain legacy in this
  branch. Direct media seed support is unchanged; live parsing, signing,
  session-aware discovery, and direct URL freshness are deferred to a separate
  Douyin-specific migration.

## Verification Boundary

All new coverage is fixture-backed. This branch does not perform real downloads,
real account login, live page fetches, or live smoke validation.
