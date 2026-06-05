---
name: 22biqu
description: Metadata/navigation-only SiteForge skill for www.22biqu.com live public discovery. It supports catalog, book-detail, chapter-navigation, author aggregate, history-page, and search-result metadata. Full chapter-body export is not enabled by this skill.
site:
  host: www.22biqu.com
  base_url: https://www.22biqu.com/
  site_key: 22biqu
  adapter_id: chapter-content
  archetype: chapter-content
  repo_skill_dir: skills/22biqu
  live_discovery_status: sampled-live-public
  generated_at: 2026-06-05T13:52:00+08:00
runtime:
  script_language: python
  interpreter_required: pypy3
  template_version: 3
safety:
  live_public_pages_only: true
  login_required: false
  persist_credentials_cookies_tokens_or_profiles: false
  bypass_access_controls: false
  bulk_chapter_body_export_enabled: false
---

# 22biqu SiteForge Skill

## Status

This skill was generated from SiteForge registry/capability records and live public metadata sampling of `https://www.22biqu.com/`.

The skill is **metadata/navigation-only**. It records route shapes, page types, intents, author aggregation, and extraction boundaries. It does not enable bulk chapter-body export or full-book materialization.

## Live-sampled public surfaces

| Surface | Route shape | Status | Extracted metadata |
|---|---|---:|---|
| Home | `/` | live-sampled | navigation links, featured lists, latest-added list, recent-update list |
| Category | `/fenlei/{categoryId}_{page}.html` | live-sampled | category title, book links, latest-chapter links, author names, update dates, pagination |
| Completed listing | `/quanben/fenlei/` | live-sampled | completed-list rows, book links, chapter links, authors, update dates, pagination |
| Book detail | `/biqu{bookId}/` | live-sampled | title, author, category, status, latest chapter, update time, summary metadata, chapter index links |
| Chapter navigation | `/biqu{bookId}/{chapterId}.html` | live-sampled | breadcrumb, chapter title, previous/catalog/next links, adjacent-book links |
| Author aggregate | search + book detail validation | derived | author name, matched work count, matched work metadata, unverified candidates |
| History utility | `/history.html` | live-sampled | reading-history shell only; do not persist browser/client state |

## Executable capabilities

| Capability ID | Intent | Execution mode | Output |
|---|---|---|---|
| `discover-home-links` | extended discovery | live public navigation | home navigation and list-entry metadata |
| `open-category` | `open-category` | live public navigation | category page metadata |
| `list-category-books` | `open-category` | live public parsing | book links and row metadata |
| `list-category-updates` | `open-category` / `open-chapter` | live public parsing | latest chapter links, authors, update dates |
| `list-completed-books` | `open-category` | live public parsing | completed listing metadata |
| `open-book` | `open-book` | live public navigation | book detail metadata |
| `extract-book-metadata` | `open-book` | live public parsing | title, author, category, status, latest chapter, update time |
| `list-chapter-index` | `open-book` / `open-chapter` | live public parsing | chapter titles and chapter URLs |
| `open-chapter-metadata` | `open-chapter` | metadata-only navigation | chapter title and previous/catalog/next links |
| `open-utility-page` | `open-utility-page` | live public navigation | utility shell metadata |
| `search-book-submit` | `search-book` | approval-gated request | user-directed search response page |
| `parse-search-results` | `search-book` | approval-gated parsing | search result book metadata |
| `open-author` | `open-author` | approval-gated derived aggregate | author name, matched work count, matched works, unverified candidates |

## Disabled capabilities

| Capability | Status | Reason |
|---|---:|---|
| `download-book` | disabled by generated skill | Registry-supported but not enabled by this metadata/navigation-only skill. |
| `full-book-materialization` | disabled | Full-text materialization is outside this skill boundary. |
| `bulk-chapter-body-export` | disabled | Bulk body export is outside this skill boundary. |
| `persist-reading-history` | disabled | Reading history may involve client state. |
| `login-auth-session` | disabled | No login flow is required for sampled public paths. |
| `persist-cookies-tokens-sessions` | disabled | Credential/session/profile persistence is prohibited. |
| `bypass-access-control` | disabled | Do not bypass CAPTCHA, risk controls, login walls, rate limits, or other controls. |

## Route templates and derived plans

```yaml
routes:
  home:
    path: /
    pageType: home
    capabilities: [discover-home-links, navigate-to-category, navigate-to-content]

  category:
    pathTemplate: /fenlei/{categoryId}_{page}.html
    example: /fenlei/1_1.html
    pageType: category-page
    capabilities: [open-category, list-category-books, list-category-updates]

  completed_category:
    path: /quanben/fenlei/
    pageType: category-page
    capabilities: [list-completed-books]

  book_detail:
    pathTemplate: /biqu{bookId}/
    example: /biqu100/
    pageType: book-detail-page
    capabilities: [open-book, extract-book-metadata, list-chapter-index]

  chapter_navigation:
    pathTemplate: /biqu{bookId}/{chapterId}.html
    example: /biqu100/10849559.html
    pageType: chapter-page
    capabilities: [open-chapter-metadata]
    extractionMode: metadata-only

  author_aggregate:
    intent: open-author
    routeType: derived
    executionPlan:
      - search-book-submit(authorName)
      - parse-search-results
      - open-book(candidateBookUrl)
      - extract-book-metadata
      - keep result only when normalized authorName exactly matches requested authorName
      - dedupe by canonical book URL, then title
      - return matchedWorkCount and matchedWorks
    capabilities: [open-author, search-book-submit, parse-search-results, open-book, extract-book-metadata]
    extractionMode: metadata-only

  history:
    path: /history.html
    pageType: history-page
    capabilities: [open-utility-page]
```

## Extraction rules

### Home

Extract only navigation labels/links, featured or recommended book links, latest-added rows, and recent-update rows.

### Category and completed-list pages

Extract only category/list title, book detail URLs, latest chapter URLs, author names, visible update dates, and pagination URLs.

### Book detail pages

Extract only book title, author name, category name, serial status, latest chapter metadata, update time, short summary metadata, and chapter index links/titles.

### Chapter pages

Extract only breadcrumb, book/catalog URL, chapter title, previous chapter URL, next chapter URL, and adjacent-book links. Do not export or persist full chapter body text through this skill.

### Author aggregate

`open-author(authorName)` is a derived, approval-gated aggregate. It must:

- submit the author name as a user-directed search query;
- parse search result metadata;
- open each candidate book detail page;
- extract the author field from the book detail page;
- count only records whose normalized author field exactly matches the requested author name;
- dedupe matches by canonical book URL, then by normalized title;
- return `matchedWorkCount`, `matchedWorks`, `unverifiedCandidates`, and `countMethod`;
- avoid returning chapter body text or full-book payloads.

## Execution guards

- Use live public pages only.
- Do not bypass robots.txt, rate limits, CAPTCHA, risk-control pages, login walls, paywalls, or other access controls.
- Do not persist cookies, tokens, credentials, authorization headers, session IDs, local storage, or browser profiles.
- Do not run bulk harvesting.
- Store artifacts as redacted route/metadata evidence, not full text payloads.
- Search and author aggregate execution require explicit user direction and approval.

## Minimal plans

### `open-category`

```json
{
  "siteKey": "22biqu",
  "intent": "open-category",
  "urlTemplate": "https://www.22biqu.com/fenlei/{categoryId}_{page}.html",
  "extract": ["categoryName", "bookLinks", "latestChapterLinks", "authorNames", "updateDates", "paginationLinks"]
}
```

### `open-book`

```json
{
  "siteKey": "22biqu",
  "intent": "open-book",
  "urlTemplate": "https://www.22biqu.com/biqu{bookId}/",
  "extract": ["title", "authorName", "categoryName", "serialStatus", "latestChapter", "updateTime", "chapterIndexLinks"]
}
```

### `open-chapter`

```json
{
  "siteKey": "22biqu",
  "intent": "open-chapter",
  "urlTemplate": "https://www.22biqu.com/biqu{bookId}/{chapterId}.html",
  "extract": ["breadcrumb", "chapterTitle", "previousChapterUrl", "catalogUrl", "nextChapterUrl"],
  "extractionMode": "metadata-only"
}
```

### `open-author`

```json
{
  "siteKey": "22biqu",
  "intent": "open-author",
  "authorName": "辰东",
  "executionPlan": [
    "search-book-submit(authorName)",
    "parse-search-results",
    "open-book(candidateBookUrl)",
    "extract-book-metadata",
    "filter authorName exact match",
    "dedupe canonical book URL/title",
    "return matchedWorkCount"
  ],
  "extract": ["authorName", "matchedWorkCount", "matchedWorks", "unverifiedCandidates", "countMethod"],
  "extractionMode": "metadata-only"
}
```
