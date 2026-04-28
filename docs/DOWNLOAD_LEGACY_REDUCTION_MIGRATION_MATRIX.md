# Download Legacy Reduction Migration Matrix

Phase 3 records which download task shapes can run through native resource
resolution and which shapes must keep the legacy adapters. This document is an
evidence matrix, not a removal plan. Unsupported shapes must continue to fall
back to legacy until a matching native resolver has fixture-backed tests and
runner coverage.

## Scope

- Branch: `codex/download-architecture-integrated`
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
| Douyin | Request provides concrete direct media seeds. | Native | `native-douyin-resource-seeds` | `douyin-resource-seeds-provided` | `tests/node/download-site-modules.test.mjs`; `tests/node/download-native-seed-schema.test.mjs` | Keep Douyin legacy action for ordinary video, user, search, or feed inputs without media evidence. |
| Douyin | Ordinary video input resolved by direct injected media results or `resolveDouyinMediaBatch`. | Native | `native-douyin-resource-seeds` | `douyin-resource-seeds-provided` | `tests/node/download-douyin-native-resolver.test.mjs` | Keep Douyin legacy action when no direct media or injected resolver result exists. |
| Douyin | Author input enumerated by injected author video results, with only unresolved entries passed through the injected media resolver. | Native | `native-douyin-resource-seeds` | `douyin-resource-seeds-provided` | `tests/node/download-douyin-native-resolver.test.mjs` | Keep Douyin legacy action when author enumeration is missing, empty, or unresolved. |
| Douyin | Followed-updates input resolved from injected followed update query results. | Native | `native-douyin-resource-seeds` | `douyin-resource-seeds-provided` | `tests/node/download-douyin-native-resolver.test.mjs` | Keep Douyin legacy action when cache refresh, profile side effects, or live followed queries are required. |
| Xiaohongshu | Request provides concrete download bundle assets or resource seeds. | Native | `native-xiaohongshu-resource-seeds` | `xiaohongshu-resource-seeds-provided` | `tests/node/download-site-modules.test.mjs`; `tests/node/download-native-seed-schema.test.mjs` | Keep Xiaohongshu legacy action for ordinary note, search, or followed-user inputs without resource seeds. |
| Xiaohongshu | Note payload, `pageFacts`, or fixture HTML provides note image/video media. | Native | `native-xiaohongshu-resource-seeds` | `xiaohongshu-resource-seeds-provided` | `tests/node/download-xiaohongshu-page-seed-resolver.test.mjs` | Keep Xiaohongshu legacy action when note evidence has no parseable media. |
| Xiaohongshu | Search, author, or followed mock notes provide note media or injected followed query results. | Native | `native-xiaohongshu-resource-seeds` | `xiaohongshu-resource-seeds-provided` | `tests/node/download-xiaohongshu-page-seed-resolver.test.mjs` | Keep Xiaohongshu legacy action when mock note lists or injected query results are absent. |
| X | Gated `profile-content`, `full-archive`, or `search` input provides media candidates. | Native | `native-x-social-resource-seeds` | `x-social-resource-seeds-provided` | `tests/node/download-social-native-resolver.test.mjs`; `tests/node/downloads-runner.test.mjs` | Keep social legacy action when the native gate is off or media candidates are absent. |
| X | Relation, followed-date, follower/following, checkpoint, and resume inputs. | Legacy | n/a | `legacy-downloader-required` | `tests/node/download-social-native-resolver.test.mjs`; `tests/node/downloads-runner.test.mjs` | Required. These flows remain in the social legacy action. |
| Instagram | Gated `profile-content` or `full-archive` input provides feed-user/archive media candidates. | Native | `native-instagram-social-resource-seeds` | `instagram-social-resource-seeds-provided` | `tests/node/download-social-native-resolver.test.mjs`; `tests/node/downloads-runner.test.mjs` | Keep social legacy action when the native gate is off or media candidates are absent. |
| Instagram | Relation, follower/following, followed-users, checkpoint, and resume inputs. | Legacy | n/a | `legacy-downloader-required` | `tests/node/download-social-native-resolver.test.mjs`; `tests/node/downloads-runner.test.mjs` | Required. These flows remain in the social legacy action. |

## Remaining Fallback Reasons

The following task shapes intentionally remain on legacy fallback:

| Site | Shape | Stable reason | Why fallback remains |
| --- | --- | --- | --- |
| 22biqu | Live ordinary book URL or title with no local fixture, no KB root match, and no injected fetch/mock. | `legacy-downloader-required` | The native resolver does not perform real network crawling. Live book crawl remains in the Python downloader. |
| 22biqu | Local fixture or directory HTML exists but yields no chapter links. | `legacy-downloader-required` | Empty or unparseable local evidence is not enough to build a complete native resource queue. |
| Bilibili | Ordinary BV, video page, creator page, collection, or series input without fixture/API payload and matching playurl evidence. | `legacy-downloader-required` | Page parsing, list discovery, and live media URL discovery still live in the legacy site action. |
| Douyin | Ordinary video, author, search, or feed input without direct media entries, mock media results, injected resolver output, author enumeration, or followed query results. | `legacy-downloader-required` | Auth/session-aware discovery, signing, cache refresh, and direct media freshness still live in the legacy site action. |
| Xiaohongshu | Ordinary note, search, profile, or followed-user input without fixture/API payload, page facts, fixture HTML, mock note list, or injected query result. | `legacy-downloader-required` | Browser/API discovery and bundle construction still live in the legacy site action. |
| X | Native gate off, no media candidates, relation/followed-date/follower/following/followed-users, checkpoint, or resume input. | `legacy-downloader-required` | Social cursor discovery, archive state, relation handling, auth recovery, and media queue creation still live in the social legacy action. |
| Instagram | Native gate off, no feed-user/archive media candidates, relation/follower/following/followed-users, checkpoint, or resume input. | `legacy-downloader-required` | Social cursor discovery, relation pagination, auth recovery, and media queue creation still live in the social legacy action. |

## Test Gate

Focused gate for this branch:

```powershell
node --test tests\node\download-22biqu-native-resolver.test.mjs tests\node\download-bilibili-page-seed-resolver.test.mjs tests\node\download-xiaohongshu-page-seed-resolver.test.mjs tests\node\download-douyin-native-resolver.test.mjs tests\node\download-social-native-resolver.test.mjs tests\node\download-site-modules.test.mjs tests\node\download-native-seed-schema.test.mjs tests\node\downloads-runner.test.mjs tests\node\download-media-executor.test.mjs
```

Passing this gate proves only fixture-backed, request-injected, or
injected-resolver native resolution, native seed execution, legacy fallback
routing, and generic media executor behavior. It does not prove live crawling,
authenticated social archive capability, or safe fallback removal.
