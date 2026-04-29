# Download Legacy Reduction Migration Matrix

Phase 3 records which download task shapes can run through native resource
resolution and which shapes must keep the legacy adapters. This document is an
evidence matrix, not a removal plan. Unsupported shapes must continue to fall
back to legacy until a matching native resolver has fixture-backed tests and
runner coverage.

## Scope

- Branch: local `main`
- Base assumption: Phase 2 runner contracts and native resolver follow-up work
  are already available locally.
- Current policy: do not delete or bypass legacy fallback paths.
- Live traffic status: not claimed. Native coverage here is fixture-backed,
  request-injected, injected-fetch backed, or injected-resolver backed only.

## Migration Matrix

| Site | Task shape | Native status | Resolver method | Completion reason | Evidence | Legacy fallback |
| --- | --- | --- | --- | --- | --- | --- |
| 22biqu | Request provides direct chapter entries through `chapters`, `chapterUrls`, or equivalent chapter seed fields. | Native | `native-22biqu-chapters` | `22biqu-chapters-provided` | `tests/node/download-site-modules.test.mjs`; `tests/node/downloads-runner.test.mjs` | Keep Python book downloader for inputs without chapter seeds. |
| 22biqu | Ordinary book URL or title resolved from local book-content artifacts via `bookContentDir`. | Native | `native-22biqu-book-content` | `22biqu-book-content-provided` | `tests/node/download-22biqu-native-resolver.test.mjs` | Keep Python book downloader when no matching artifact exists. |
| 22biqu | Ordinary book title resolved from a compiled KB root through `fixtureDir` and `index/sources.json`. | Native | `native-22biqu-book-content` | `22biqu-book-content-provided` | `tests/node/download-22biqu-native-resolver.test.mjs` | Keep Python book downloader when the KB root does not point to matching book-content artifacts. |
| 22biqu | Directory HTML supplied directly as `fixtureHtml`. | Native | `native-22biqu-directory` | `22biqu-directory-provided` | `tests/node/download-22biqu-native-resolver.test.mjs` | Keep Python book downloader when the HTML has no chapter links. |
| 22biqu | Directory HTML supplied from a local fixture file or book-content `directoryHtmlFile`. | Native | `native-22biqu-directory` | `22biqu-directory-provided` | `tests/node/download-22biqu-native-resolver.test.mjs` | Keep Python book downloader when the file is missing, unmatched, or has no chapter links. |
| 22biqu | Directory HTML supplied by an injected mock fetch function (`fetchImpl` / `mockFetchImpl`). | Native | `native-22biqu-directory` | `22biqu-directory-provided` | `tests/node/download-22biqu-native-resolver.test.mjs` | Keep Python book downloader when no injected fetch is supplied or it returns no parseable chapter links. |
| Bilibili | Request provides concrete resource seeds (`resources`, `resourceSeeds`, resolved media fields, etc.). | Native | `native-bilibili-resource-seeds` | `bilibili-resource-seeds-provided` | `tests/node/download-site-modules.test.mjs`; `tests/node/download-native-seed-schema.test.mjs` | Keep Bilibili legacy action for ordinary page or BV inputs without resource seeds. |
| Bilibili | Request provides offline `dash` or `durl` playurl payloads. | Native | `native-bilibili-page-seeds` | `bilibili-page-seeds-provided` | `tests/node/download-bilibili-page-seed-resolver.test.mjs` | Keep Bilibili legacy action when playurl evidence is missing or unsupported. |
| Bilibili | BV view payload plus matching multi-P `playUrlPayloads`. | Native | `native-bilibili-page-seeds` | `bilibili-page-seeds-provided` | `tests/node/download-bilibili-page-seed-resolver.test.mjs` | Keep Bilibili legacy action when any requested page lacks matching playurl evidence. |
| Bilibili | Collection, series, or UP-space archive payload plus matching `playUrlPayloads`. | Native | `native-bilibili-page-seeds` | `bilibili-page-seeds-provided` | `tests/node/download-bilibili-page-seed-resolver.test.mjs` | Keep Bilibili legacy action when list evidence or per-entry playurl evidence is incomplete. |
| Bilibili | Ordinary BV, collection, series, or UP-space input resolved by request-injected `bilibiliApiEvidence` or injected `resolveBilibiliApiEvidence`. | Native | `native-bilibili-page-seeds` | `bilibili-page-seeds-provided` | `tests/node/download-bilibili-page-seed-resolver.test.mjs` | Keep Bilibili legacy action when the evidence provider is missing, returns partial evidence, or any playurl evidence is incomplete. |
| Bilibili | Ordinary BV, collection, series, or UP-space input resolved by the built-in API evidence fetcher through injected/mock fetch, or through `globalThis.fetch` only when `allowNetworkResolve` is true. | Native | `native-bilibili-page-seeds` | `bilibili-page-seeds-provided` | `tests/node/download-bilibili-page-seed-resolver.test.mjs` | Keep Bilibili legacy action when the network gate is closed, API evidence is incomplete, WBI/signature requirements block live UP listing, or playurl evidence is missing. |
| Douyin | Request provides concrete direct media seeds. | Native | `native-douyin-resource-seeds` | `douyin-resource-seeds-provided` | `tests/node/download-site-modules.test.mjs`; `tests/node/download-native-seed-schema.test.mjs` | Keep Douyin legacy action for ordinary video, user, search, or feed inputs without media evidence. |
| Douyin | Ordinary video input resolved by fixture/API detail payload, fixture HTML JSON, injected fetch JSON, direct injected media results, or `resolveDouyinMediaBatch` using `douyin-native-resolver-deps-v1` plus sanitized `douyin-native-evidence-v1`. | Native | `native-douyin-resource-seeds` | `douyin-native-complete` or `douyin-native-payload-incomplete` | `tests/node/download-douyin-native-resolver.test.mjs` | Keep Douyin legacy action when no direct media or injected resolver result exists, or when payload completeness is false. |
| Douyin | Author input enumerated by injected author video results, with only unresolved entries passed through the injected media resolver. Deps use `douyin-native-resolver-deps-v1`. | Native | `native-douyin-resource-seeds` | `douyin-resource-seeds-provided` | `tests/node/download-douyin-native-resolver.test.mjs` | Keep Douyin legacy action when author enumeration is missing, empty, or unresolved. |
| Douyin | Followed-updates input resolved from injected followed update query results using `douyin-native-resolver-deps-v1`; cache refresh is allowed only when both `refreshCache` and the network gate are set. | Native | `native-douyin-resource-seeds` | `douyin-native-complete` | `tests/node/download-douyin-native-resolver.test.mjs` | Keep Douyin legacy action when signing, cache refresh side effects, profile side effects, or live followed queries are required. |
| Xiaohongshu | Request provides concrete download bundle assets or resource seeds. | Native | `native-xiaohongshu-resource-seeds` | `xiaohongshu-resource-seeds-provided` | `tests/node/download-site-modules.test.mjs`; `tests/node/download-native-seed-schema.test.mjs` | Keep Xiaohongshu legacy action for ordinary note, search, or followed-user inputs without resource seeds. |
| Xiaohongshu | Note payload, `pageFacts`, or fixture HTML provides note image/video media. | Native | `native-xiaohongshu-resource-seeds` | `xiaohongshu-resource-seeds-provided` | `tests/node/download-xiaohongshu-page-seed-resolver.test.mjs` | Keep Xiaohongshu legacy action when note evidence has no parseable media. |
| Xiaohongshu | Ordinary note/profile/search HTML fetched through injected/mock fetch, or through `globalThis.fetch` only when `allowNetworkResolve` is true, and parsed into media seeds. Resolution includes sanitized `xiaohongshu-header-freshness-v1` metadata. | Native | `native-xiaohongshu-resource-seeds` | `xiaohongshu-resource-seeds-provided` | `tests/node/download-xiaohongshu-page-seed-resolver.test.mjs` | Keep Xiaohongshu legacy action when the network gate is closed, fetched HTML has no media, headers are stale, or API/session side effects are required. |
| Xiaohongshu | Search, author, or followed mock notes provide note media or injected followed query results. Follow deps use `xiaohongshu-native-resolver-deps-v1`. | Native | `native-xiaohongshu-resource-seeds` | `xiaohongshu-resource-seeds-provided` | `tests/node/download-xiaohongshu-page-seed-resolver.test.mjs` | Keep Xiaohongshu legacy action when mock note lists or injected query results are absent. |
| X | Gated `profile-content`, `full-archive`, or `search` input provides media candidates, including nested timeline archive payloads. | Native | `native-x-social-resource-seeds` | `x-social-resource-seeds-provided` | `tests/node/download-social-native-resolver.test.mjs`; `tests/node/downloads-runner.test.mjs` | Keep social legacy action when the native gate is off or media candidates are absent. |
| X | Gated native input provides captured social API/replay payloads or local archive artifacts (`items.jsonl`, `state.json`, `manifest.json`) with media candidates and sanitized archive schema v1/v2 metadata. | Native | `native-x-social-resource-seeds` | `x-social-resource-seeds-provided` | `tests/node/download-social-native-resolver.test.mjs` | Keep social legacy action for seed capture, live cursor replay, checkpoint continuation, and auth recovery. |
| X | Relation, followed-date, follower/following, checkpoint, resume, or cursor discovery inputs. | Legacy | `native-x-social-resource-seeds` records unsupported metadata when gated | `legacy-downloader-required` | `tests/node/download-social-native-resolver.test.mjs`; `tests/node/downloads-runner.test.mjs` | Required. These flows remain in the social legacy action. |
| Instagram | Gated `profile-content` or `full-archive` input provides feed-user/archive media candidates, including GraphQL sidecar archive payloads. | Native | `native-instagram-social-resource-seeds` | `instagram-social-resource-seeds-provided` | `tests/node/download-social-native-resolver.test.mjs`; `tests/node/downloads-runner.test.mjs` | Keep social legacy action when the native gate is off or media candidates are absent. |
| Instagram | Gated native input provides captured feed-user/API/replay payloads or local archive artifacts with media candidates and sanitized archive schema v1/v2 metadata. | Native | `native-instagram-social-resource-seeds` | `instagram-social-resource-seeds-provided` | `tests/node/download-social-native-resolver.test.mjs` | Keep social legacy action for authenticated feed discovery, live cursor replay, checkpoint continuation, and auth recovery. |
| Instagram | Relation, follower/following, followed-users, checkpoint, resume, or authenticated feed discovery inputs. | Legacy | `native-instagram-social-resource-seeds` records unsupported metadata when gated | `legacy-downloader-required` | `tests/node/download-social-native-resolver.test.mjs`; `tests/node/downloads-runner.test.mjs` | Required. These flows remain in the social legacy action. |

## Remaining Fallback Reasons

The following task shapes intentionally remain on legacy fallback:

| Site | Shape | Stable reason | Why fallback remains |
| --- | --- | --- | --- |
| 22biqu | Live ordinary book URL or title with no local fixture, no KB root match, and no injected fetch/mock. | `legacy-downloader-required` | The native resolver does not perform real network crawling. Live book crawl remains in the Python downloader. |
| 22biqu | Local fixture or directory HTML exists but yields no chapter links. | `legacy-downloader-required` | Empty or unparseable local evidence is not enough to build a complete native resource queue. |
| Bilibili | Ordinary BV, video page, creator page, collection, or series input without request-injected/API evidence, injected/mock fetch, explicit network-gated fetch, and matching playurl evidence. | `legacy-downloader-required` | Unsupported API shapes, incomplete payloads, WBI/signature requirements, DASH mux, and live media verification still require fallback. |
| Douyin | Ordinary video, author, search, or feed input without fixture/API detail payloads, fixture HTML JSON, injected fetch JSON, direct media entries, mock media results, injected resolver output, author enumeration, or followed query results. | `legacy-downloader-required` | Auth/session-aware discovery, signing, cache refresh, and direct media freshness still live in the legacy site action. |
| Xiaohongshu | Ordinary note, search, profile, or followed-user input without fixture/API payload, page facts, fixture HTML, injected/mock fetched HTML, mock note list, or injected query result. | `legacy-downloader-required` | Browser/API discovery, header freshness, session side effects, and bundle construction still live in the legacy site action. |
| X | Native gate off, no media candidates, relation/followed-date/follower/following/followed-users, checkpoint, resume, or cursor discovery input. | `legacy-downloader-required` plus native unsupported metadata when gated | Social cursor discovery, archive state, relation handling, auth recovery, and media queue creation still live in the social legacy action. |
| Instagram | Native gate off, no feed-user/archive media candidates, relation/follower/following/followed-users, checkpoint, resume, or authenticated feed discovery input. | `legacy-downloader-required` plus native unsupported metadata when gated | Social cursor discovery, relation pagination, auth recovery, and media queue creation still live in the social legacy action. |

## Test Gate

Focused gate for this branch:

```powershell
node --test tests\node\download-22biqu-native-resolver.test.mjs tests\node\download-bilibili-page-seed-resolver.test.mjs tests\node\download-xiaohongshu-page-seed-resolver.test.mjs tests\node\download-douyin-native-resolver.test.mjs tests\node\download-social-native-resolver.test.mjs tests\node\download-site-modules.test.mjs tests\node\download-native-seed-schema.test.mjs tests\node\downloads-runner.test.mjs tests\node\download-media-executor.test.mjs tests\node\site-session-governance.test.mjs tests\node\session-repair-plan.test.mjs
```

Passing this gate proves only fixture-backed, request-injected, or
injected-resolver native resolution, native seed execution, legacy fallback
routing, and generic media executor behavior. It does not prove live crawling,
authenticated social archive capability, or safe fallback removal.

## Derived Artifacts And Session Repair

- Bilibili DASH audio/video streams can be muxed as an explicit opt-in derived
  artifact after both stream resources complete. CLI aliases are
  `--enable-derived-mux`, `--mux-derived-media`, and `--dash-mux`. The queue
  still tracks the original resources; the mux output is appended to manifest
  files and downloads JSONL as `derived: true`. Missing audio/video streams and
  mux failures are reported as derived failures in the manifest and report.
- Session governance health can attach a sanitized `repairPlan` to blocked
  download manifests. This is operator guidance only; download runner does not
  perform login, keepalive, profile rebuild, or live recovery by itself. The
  `session-repair-plan` entrypoint is dry-run by default; `--execute` only
  constructs an approved audit command for allowlisted actions and never spawns
  child commands.
