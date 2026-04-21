# Root File Retirement Migration

This repo now treats root-file retirement as a deliberate breaking change.

## What changed

- Root `*.mjs` CLI files are gone.
- Root Python entrypoints are gone:
  - `download_bilibili.py`
  - `download_book.py`
  - `download_douyin.py`
  - `site_context.py`
- Root metadata files are gone:
  - `site-registry.json`
  - `site-capabilities.json`
- Root onboarding doc moved:
  - `NEW_SITE_CHECKLIST.md` -> `docs/NEW_SITE_CHECKLIST.md`

## Canonical replacements

- Pipeline CLI:
  - `node src/entrypoints/pipeline/run-pipeline.mjs ...`
  - `node src/entrypoints/pipeline/generate-skill.mjs ...`
  - `node src/entrypoints/pipeline/generate-crawler-script.mjs ...`
- Site CLI:
  - `node src/entrypoints/sites/site-doctor.mjs ...`
  - `node src/entrypoints/sites/site-scaffold.mjs ...`
  - `node src/entrypoints/sites/douyin-query-follow.mjs ...`
- Python:
  - `python src/sites/bilibili/download/python/bilibili.py ...`
  - `python src/sites/chapter-content/download/python/book.py ...`
  - `python src/sites/douyin/download/python/douyin.py ...`
  - `python src/sites/catalog/python/site_context.py ...`
- Metadata:
  - `config/site-registry.json`
  - `config/site-capabilities.json`

## Root contract

Repository root regular files are now limited to:

- `.gitignore`
- `README.md`

Everything else at the root should be a directory.

## Typical rewrites

```powershell
# before
node .\run-pipeline.mjs https://www.22biqu.com/

# after
node .\src\entrypoints\pipeline\run-pipeline.mjs https://www.22biqu.com/
```

```powershell
# before
pypy3 .\download_book.py https://www.22biqu.com/ --book-title "<title>"

# after
pypy3 .\src\sites\chapter-content\download\python\book.py https://www.22biqu.com/ --book-title "<title>"
```

```powershell
# before
Get-Content .\site-registry.json

# after
Get-Content .\config\site-registry.json
```

## Caller guidance

- Do not recreate root shims.
- Do not point new docs or scripts at retired root paths.
- If a caller still depends on root paths, migrate that caller instead of adding compatibility back.
