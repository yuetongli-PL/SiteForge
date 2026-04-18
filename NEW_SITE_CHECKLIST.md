# New Site Onboarding Checklist

This checklist is the first-pass template for onboarding a new host into the current repository layout without changing the main scripts.

## 1. Pick the host profile shape

- Use `profiles/template.navigation-catalog.json` when the site is mainly category/search/detail/author navigation, similar to the existing `moodyz.com` profile.
- Use `profiles/template.chapter-content.json` when the site has searchable book detail pages and chapter content extraction, similar to the existing `www.22biqu.com` profile and `download_book.py` flow.
- The templates now declare `archetype` and `schemaVersion`; keep those fields unless the schema version changes.
- You can bootstrap a new profile with:

```powershell
node .\scripts\site-scaffold.mjs https://<host>/ --archetype <navigation-catalog|chapter-content>
```

## 2. Fill the host profile

- Keep the file name equal to `parsed.hostname`, because the current scripts resolve profiles by `profiles/<hostname>.json`.
- For navigation-style sites, fill `pageTypes`, `search`, `sampling`, `navigation`, `contentDetail`, and `author`.
- For chapter/content sites, fill `search`, `bookDetail`, and `chapter`.
- Prefer selectors that survive minor DOM changes: start with semantic attributes, then add class-based fallbacks.
- Add at least one `knownQueries` entry once a query and destination URL are stable enough to regression-test manually.

## 3. Verify the repository artifact map

- `profiles/<host>.json`: the source-of-truth host profile.
- `crawler-scripts/<host>/`: generated or reused crawler script plus metadata.
- `knowledge-base/<host>/`: pipeline output, including `raw/`, `index/`, `reports/`, `schema/`, and `wiki/`.
- `skills/<skill-name>/`: generated repo-local skill package for the host.
- `site-registry.json`: records the profile, crawler, skill, knowledge-base, and download entrypoint paths.
- `site-capabilities.json`: records archetype, page types, capability families, safe actions, and approval actions.

## 4. Validate the host locally

- Run the onboarding doctor first:

```powershell
node .\scripts\site-doctor.mjs https://<host>/ --query "<sample>"
```

- The report marks profile/crawler/capture/expand/search/detail/author-or-chapter checks in one place before you run the full pipeline.

## 5. Run the existing entrypoints

- Generate or refresh the crawler:

```powershell
node .\generate-crawler-script.mjs https://<host>/
```

- Run the analysis/wiki pipeline for the host:

```powershell
node .\run-pipeline.mjs https://<host>/
```

- Generate the host skill package:

```powershell
node .\generate-skill.mjs https://<host>/
```

- If the site is chapter/book oriented, verify the download path through the preserved Python entrypoint:

```powershell
pypy3 .\download_book.py https://<host>/ --book-title "<title>"
```

## 6. Check expected outputs

- `crawler-scripts/<host>/crawler.meta.json` exists and matches the chosen host profile.
- `knowledge-base/<host>/raw/step-*` directories are present after the pipeline run.
- `knowledge-base/<host>/wiki/README.md` and related wiki folders are generated.
- `skills/<skill-name>/SKILL.md` exists and references the correct host behavior.
- `site-registry.json` points to the new profile, crawler, knowledge-base, and skill paths.
- `site-capabilities.json` shows the expected archetype and capability families for the host.

## 7. Manual acceptance before calling it done

- Search can reach a real content/detail page from a stable query.
- Detail pages expose enough selectors or metadata to reach author/work/chapter targets.
- Cleanup patterns remove obvious boilerplate without deleting 正文 content.
- The host profile works with the existing scripts as-is; if a site needs new fields or logic, record that as a follow-up instead of patching scripts ad hoc.
- Only add a new site adapter when `generic-navigation` or `chapter-content` cannot express the host behavior.

## 8. Deliberately out of scope for this first version

- No schema migration for main scripts.
- No container or service deployment for doctor; it is a local CLI only.
- No changes to `download_book.py` entrypoint semantics.
