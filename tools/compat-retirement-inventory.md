# Compatibility Retirement Inventory

This file tracks what has already been retired outside the canonical `src/` tree and which compatibility layers still remain on purpose.

## Retired in the root-file breaking change

- Root pipeline shims:
  - `run-pipeline.mjs`
  - `capture.mjs`
  - `expand-states.mjs`
  - `collect-book-content.mjs`
  - `analyze-states.mjs`
  - `abstract-interactions.mjs`
  - `nl-entry.mjs`
  - `generate-docs.mjs`
  - `govern-interactions.mjs`
  - `compile-wiki.mjs`
  - `generate-skill.mjs`
  - `generate-crawler-script.mjs`
  - `migrate-book-content.mjs`
- Root site/query shims:
  - `query-douyin-follow.mjs`
  - `query-jable-ranking.mjs`
- Root Python shims:
  - `download_bilibili.py`
  - `download_douyin.py`
  - `download_book.py`
  - `site_context.py`
- Root truth/config files:
  - `site-registry.json`
  - `site-capabilities.json`
- Root checklist doc:
  - `NEW_SITE_CHECKLIST.md`

Canonical replacements:

- Pipeline CLI: `src/entrypoints/pipeline/*.mjs`
- Site/query CLI: `src/entrypoints/sites/*.mjs`
- Python download and site-context entrypoints: `src/sites/**/python/*.py`
- Site truth/config: `config/site-registry.json`, `config/site-capabilities.json`
- Checklist doc: `docs/NEW_SITE_CHECKLIST.md`

## Keep for now

- `scripts/*.mjs` and `scripts/<site>/*.mjs`
- `lib/`

## Remaining follow-up boundaries

### `scripts/`

- Remove only after all external callers and docs stop referencing script paths directly.
- Today these files are compat-only shims and should not receive new business logic.

### `lib/`

- Retired from the internal dependency graph.
- Do not recreate `lib/`; canonical implementations now live directly under `src/`.

### `downloaders/`

- Retired from the repository after root Python shims were switched to import `src/sites/*/download/python/*` directly.
- Do not recreate this directory; canonical Python entrypoints live under `src/sites/*/download/python/*`.

## Do not treat as cleanup targets

These are not compatibility clutter and should stay as root directories:

- `profiles/`
- `schema/`
- `config/`
- `crawler-scripts/`
- `knowledge-base/`
- `book-content/`
- `skills/`
- `video-downloads/`
