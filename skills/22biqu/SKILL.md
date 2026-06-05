---
name: 22biqu
description: Metadata/navigation-only SiteForge skill for www.22biqu.com live public discovery. It supports catalog, book-detail, chapter-navigation, history-page, and search-result metadata. Full chapter-body export is not enabled by this skill.
site:
  host: www.22biqu.com
  base_url: https://www.22biqu.com/
  site_key: 22biqu
  adapter_id: chapter-content
  archetype: chapter-content
  repo_skill_dir: skills/22biqu
  live_discovery_status: sampled-live-public
  generated_at: 2026-06-05T12:44:39+08:00
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

This skill was generated from SiteForge registry/capability records and a live public sample of `https://www.22biqu.com/`.

The generated skill is **metadata/navigation-only**. It records live route shapes and page metadata extraction rules. It does not enable bulk chapter-body export or full-book materialization.

## Live-sampled public surfaces

| Surface | Route shape | Status | Extracted metadata |
|---|---|---:|---|
| Home | `/` | live-sampled | top navigation, featured lists, latest-added list, recent-update list |
| Category | `/fenlei/{categoryId}_{page}.html` | live-sampled | category title, book links, latest-chapter links, author names, update dates, pagination |
| Completed listing | `/quanben/fenlei/` | live-sampled | completed-list rows, book links, chapter links, authors, update dates, pagination |
| Book detail | `/biqu{bookId}/` | live-sampled | title, author, category, status, latest chapter, update time, summary metadata, chapter index links |
| Chapter navigation | `/biqu{bookId}/{chapterId}.html` | live-sampled | breadcrumb, chapter title, previous/catalog/next links, adjacent-book links |
| History utility | `/history.html` | live-sampled | reading-history shell only; do not persist browser/client state |

## Capability families

| capabilityFamily | status | notes |
|---|---:|---|
| `navigate-to-category` | enabled | Public category/listing navigation. |
| `navigate-to-content` | enabled | Public book-detail metadata navigation. |
| `navigate-to-chapter` | metadata-only | Chapter title and navigation metadata only; body export disabled. |
| `navigate-to-utility-page` | enabled | Public utility pages such as reading history shell. |
| `search-content` | enabled-with-approval | User-directed search metadata only; no bulk harvesting. |
| `open-auth-page` | descriptor-only | Declared in SiteForge records; no login requirement was observed in sampled paths. |
| `download-content` | disabled-in-this-skill | SiteForge registry may contain a content export route, but this generated skill does not enable full-body export. |

## Supported intents

| intent | execution mode | Output |
|---|---|---|
| `open-category` | live public navigation | category metadata and rows |
| `open-book` | live public navigation | book metadata and chapter-link index |
| `open-chapter` | metadata-only navigation | chapter title and previous/catalog/next links |
| `open-utility-page` | live public navigation | utility page shell metadata |
| `search-book` | approval-gated metadata query | search result metadata only |
| `open-auth-page` | descriptor-only | no sampled login flow |

The registry-declared `download-book` route is not enabled by this generated skill.

## Route templates

```yaml
routes:
  home:
    path: /
    pageType: home
    capabilities: [navigate-to-category, navigate-to-content]

  category:
    pathTemplate: /fenlei/{categoryId}_{page}.html
    example: /fenlei/1_1.html
    pageType: category-page
    capabilities: [navigate-to-category, navigate-to-content, navigate-to-chapter]

  completed_category:
    path: /quanben/fenlei/
    pageType: category-page
    capabilities: [navigate-to-category, navigate-to-content, navigate-to-chapter]

  book_detail:
    pathTemplate: /biqu{bookId}/
    example: /biqu100/
    pageType: book-detail-page
    capabilities: [navigate-to-content, navigate-to-chapter]

  chapter_navigation:
    pathTemplate: /biqu{bookId}/{chapterId}.html
    example: /biqu100/10849559.html
    pageType: chapter-page
    capabilities: [navigate-to-chapter]
    extractionMode: metadata-only

  history:
    path: /history.html
    pageType: history-page
    capabilities: [navigate-to-utility-page]
```

## Extraction rules

### Home

Extract only:

- top navigation labels and links;
- featured/recommended book links;
- latest-added rows;
- recent-update rows.

### Category and completed-list pages

Extract only:

- category/list title;
- book detail URLs;
- latest chapter URLs;
- author names;
- visible update dates;
- pagination URLs.

### Book detail pages

Extract only:

- book title;
- author name;
- category name;
- serial status;
- latest chapter name and URL;
- update time;
- short summary metadata;
- chapter index links and titles.

### Chapter pages

Extract only:

- breadcrumb;
- book/catalog URL;
- chapter title;
- previous chapter URL;
- next chapter URL;
- adjacent-book links.

Do not export or persist full chapter body text through this skill.

## Execution guards

- Use live public pages only.
- Do not bypass robots.txt, rate limits, CAPTCHA, risk-control pages, login walls, paywalls, or other access controls.
- Do not persist cookies, tokens, credentials, authorization headers, session IDs, local storage, or browser profiles.
- Do not run bulk harvesting.
- Store artifacts as redacted route/metadata evidence, not full text payloads.
- Search execution requires user direction and approval.

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
