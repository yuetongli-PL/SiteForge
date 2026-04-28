# Download Native Page Seed Follow-up

This local follow-up branch deepens fixture-backed and injected-resolver native
coverage without running live site traffic or removing legacy fallback paths.

## Covered Shapes

- Bilibili offline `dash`/`durl` playurl payloads can resolve to native video
  and audio resources when the request provides a fixture/API payload.
- Bilibili BV view payloads, multi-P `playUrlPayloads`, and collection/series or
  UP-space archive payloads can expand to native grouped resources when each
  entry has matching offline playurl evidence.
- Xiaohongshu `xiaohongshuNotePayload`, `pageFacts`, fixture HTML, search note
  lists, author note lists, and followed note lists can resolve to native image
  or video resources when the request provides fixture/media payloads, mock
  notes, or an injected `queryXiaohongshuFollow` result.
- Douyin direct media results, `resolvedVideos`, injected
  `resolveDouyinMediaBatch`, author enumerator results, and injected followed
  update query results can resolve to native media seeds without refreshing live
  state.
- X and Instagram expose gated social native resolvers through
  `nativeResolver`/`nativeSocialResolver`. X supports injected media candidates
  for `profile-content`, `full-archive`, and `search`; Instagram supports
  `profile-content` and `full-archive`, including `instagramFeedUserPayload`.
- Existing explicit `resourceSeeds`, `resources`, and `downloadBundle` inputs
  keep their original precedence and schema.

## Still Legacy

- Bilibili ordinary BV/video page, collection, or creator inputs without
  view/list payloads and matching playurl fixtures still use the legacy action.
- Xiaohongshu ordinary note, search, profile, and followed-user inputs without
  payloads, page facts, fixture HTML, mock notes, or injected query results still
  use the legacy action.
- Douyin ordinary video, author, search, or followed-update inputs without
  direct media entries or injected resolver/enumerator/query results still use
  the legacy action. Live parsing, signing, session-aware discovery, and direct
  URL freshness are deferred to a separate Douyin-specific migration.
- X and Instagram relation, follower/following, followed-users, followed-date,
  checkpoint, and resume flows continue to use the social legacy action even
  when the native gate is enabled.

## Verification Boundary

All new coverage is fixture-backed, request-injected, or injected-resolver
backed. This branch does not perform real downloads, real account login, live
page fetches, or live smoke validation.
