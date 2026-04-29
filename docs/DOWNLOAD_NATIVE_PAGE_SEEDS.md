# Download Native Page Seed Follow-up

This local follow-up branch deepens fixture-backed and injected-resolver native
coverage without running live site traffic or removing legacy fallback paths.

## Covered Shapes

- Bilibili offline `dash`/`durl` playurl payloads can resolve to native video
  and audio resources when the request provides a fixture/API payload.
- Bilibili BV view payloads, multi-P `playUrlPayloads`, and collection/series or
  UP-space archive payloads can expand to native grouped resources when each
  entry has matching offline playurl evidence.
- Bilibili ordinary BV, collection, series, and UP-space inputs can request
  API evidence through `bilibiliApiEvidence`, injected
  `resolveBilibiliApiEvidence`, or the built-in API evidence fetcher. The
  built-in fetcher supports `x/web-interface/view`, `x/player/playurl`,
  `x/polymer/web-space/seasons_archives_list`, and
  `x/space/wbi/arc/search` shapes, but it only uses injected/mock fetch by
  default. It can use `globalThis.fetch` only when the runner passes the
  explicit network gate.
- Xiaohongshu `xiaohongshuNotePayload`, `pageFacts`, fixture HTML, search note
  lists, author note lists, and followed note lists can resolve to native image
  or video resources when the request provides fixture/media payloads, mock
  notes, or an injected `queryXiaohongshuFollow` result. Ordinary page HTML can
  also be fetched through injected/mock fetch, or through `globalThis.fetch`
  only behind the explicit network gate.
- Douyin direct media results, `resolvedVideos`, injected
  `resolveDouyinMediaBatch`, author enumerator results, and injected followed
  update query results can resolve to native media seeds without refreshing live
  state. Injected deps receive `douyin-native-resolver-deps-v1` descriptors.
- Xiaohongshu followed-user injected queries receive
  `xiaohongshu-native-resolver-deps-v1` descriptors and remain side-effect free.
- X and Instagram expose gated social native resolvers through
  `nativeResolver`/`nativeSocialResolver`. X supports injected media candidates
  for `profile-content`, `full-archive`, and `search`, including nested timeline
  archive payloads; Instagram supports `profile-content` and `full-archive`,
  including `instagramFeedUserPayload` and GraphQL sidecar archive payloads.
  Native social resolution also consumes already-captured social API/replay
  payloads and local social archive artifacts such as `items.jsonl`,
  `state.json`, and `manifest.json`; it records cursor metadata but does not
  execute cursor replay itself.
  When the gate is enabled but cursor discovery, relation flow, followed-date,
  checkpoint/resume, or authenticated feed discovery is still required, the
  native resolver records an unsupported reason and returns no resources so the
  legacy action remains responsible.
- Existing explicit `resourceSeeds`, `resources`, and `downloadBundle` inputs
  keep their original precedence and schema.

## Still Legacy

- Bilibili ordinary BV/video page, collection, or creator inputs without
  request-injected/API evidence, injected/mock fetch, explicit network-gated
  fetch, view/list payloads, and matching playurl evidence still use the legacy
  action. UP `arc/search` may require WBI signing or account/session evidence in
  live conditions and is not claimed by offline tests.
- Xiaohongshu ordinary note, search, profile, and followed-user inputs without
  payloads, page facts, fixture HTML, injected/mock fetched HTML, mock notes, or
  injected query results still use the legacy action. Header freshness and
  session side effects remain outside the native resolver.
- Douyin ordinary video, author, search, or followed-update inputs without
  direct media entries or injected resolver/enumerator/query results still use
  the legacy action. Live parsing, signing, session-aware discovery, and direct
  URL freshness are deferred to a separate Douyin-specific migration.
- X and Instagram relation, follower/following, followed-users, followed-date,
  checkpoint, resume, and cursor-discovery flows continue to use the social
  legacy action even when the native gate is enabled. Native resolution only
  consumes already-captured archive/media payloads.

## Verification Boundary

All new coverage is fixture-backed, request-injected, or injected-resolver
backed. This branch does not perform real downloads, real account login, live
page fetches, or live smoke validation.

## Network Gate

- Download runner defaults `allowNetworkResolve` to `false` for native resolver
  deps and evidence providers.
- Injected deps may be used in tests with either gate value, but they must not
  perform live fetches unless the runner or request explicitly sets
  `resolveNetwork` / `allowNetworkResolve`.
- Bilibili and Xiaohongshu native fetchers prefer `fetchImpl` / `mockFetchImpl`
  from the request or resolver context. They do not call `globalThis.fetch`
  unless `allowNetworkResolve` is true.
- `--resolve-network` is the CLI gate that turns the runner context gate on; it
  does not bypass session preflight.
- Required unhealthy sessions block before native resolver deps, fetch resolvers,
  or legacy adapters run.
- Blocked or unhealthy session manifests may include a sanitized `repairPlan`
  with suggested operator action and risk reason. The runner does not execute
  profile repair, login, or keepalive implicitly.

## Still Not Claimed

- Bilibili DASH mux now has an executor-level derived artifact path for native
  downloads, but it is explicit opt-in only (`enableDerivedMux`/injected mux
  hook). DASH audio and video streams with the same `groupId` can be muxed after
  both stream resources complete. Tests use an injected mux hook; live
  ffmpeg/download validation remains not-run.
- Douyin signing, page/API parsing, cache refresh, and profile side effects
  remain in the existing action/query layer. Native resolution only consumes
  direct media evidence or injected resolver/enumerator/query results.
- Xiaohongshu API calls, header refresh, and session side effects remain in the
  existing action/query layer. Native HTML fetch is side-effect free and
  fixture/injected-fetch testable.
- Social cursor/API replay execution, relation pagination, followed-date
  selection, checkpoint/resume continuation, and authenticated feed discovery
  remain in the social legacy action. Native resolution only consumes captured
  replay results or local artifacts.
- Live smoke and real download verification remain `not-run`.
