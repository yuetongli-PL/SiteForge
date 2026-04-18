from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from site_context import (
    read_site_context,
    resolve_capability_families,
    resolve_page_types,
    resolve_primary_archetype,
    resolve_safe_action_kinds,
    resolve_supported_intents,
    upsert_site_capabilities_record,
    upsert_site_registry_record,
)


class SiteContextTests(unittest.TestCase):
    def test_read_site_context_merges_isolated_host_records(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / "site-registry.json").write_text(json.dumps({
                "version": 1,
                "generatedAt": None,
                "sites": {
                    "example.com": {
                        "host": "example.com",
                        "siteArchetype": "navigation-hub",
                        "capabilityFamilies": ["navigate-to-content"],
                    }
                },
            }, ensure_ascii=False, indent=2), encoding="utf-8")
            (root / "site-capabilities.json").write_text(json.dumps({
                "version": 1,
                "generatedAt": None,
                "sites": {
                    "example.com": {
                        "host": "example.com",
                        "primaryArchetype": "catalog-detail",
                        "capabilityFamilies": ["search-content"],
                    }
                },
            }, ensure_ascii=False, indent=2), encoding="utf-8")

            context = read_site_context("example.com", root)
            self.assertEqual("example.com", context["host"])
            self.assertEqual("catalog-detail", resolve_primary_archetype(context))
            self.assertEqual(
                ["navigate-to-content", "search-content"],
                resolve_capability_families(context),
            )

    def test_fallback_arrays_override_stale_stored_arrays(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            upsert_site_capabilities_record("jable.tv", {
                "baseUrl": "https://jable.tv/",
                "capabilityFamilies": ["navigate-to-content", "search-content"],
                "supportedIntents": ["download-book", "open-video"],
                "safeActionKinds": ["download-book", "navigate"],
                "pageTypes": ["book-detail-page", "category-page"],
            }, root)

            context = read_site_context("jable.tv", root)

            self.assertEqual(
                ["query-ranked-content"],
                resolve_capability_families(context, ["query-ranked-content"]),
            )
            self.assertEqual(
                ["list-category-videos"],
                resolve_supported_intents(context, ["list-category-videos"]),
            )
            self.assertEqual(
                ["navigate", "query-ranking"],
                resolve_safe_action_kinds(context, ["navigate", "query-ranking"]),
            )
            self.assertEqual(
                ["ranking-page"],
                resolve_page_types(context, ["ranking-page"]),
            )
            self.assertEqual(
                ["navigate-to-content", "search-content"],
                resolve_capability_families(context),
            )

    def test_upsert_site_documents_keep_host_isolation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            upsert_site_registry_record("www.22biqu.com", {
                "canonicalBaseUrl": "https://www.22biqu.com/",
                "capabilityFamilies": ["download-content"],
            }, root)
            upsert_site_capabilities_record("www.22biqu.com", {
                "baseUrl": "https://www.22biqu.com/",
                "capabilityFamilies": ["download-content"],
                "supportedIntents": ["download-book"],
            }, root)

            registry = json.loads((root / "site-registry.json").read_text(encoding="utf-8"))
            capabilities = json.loads((root / "site-capabilities.json").read_text(encoding="utf-8"))
            self.assertIn("www.22biqu.com", registry["sites"])
            self.assertIn("www.22biqu.com", capabilities["sites"])
            self.assertEqual(["download-content"], registry["sites"]["www.22biqu.com"]["capabilityFamilies"])
            self.assertEqual(["download-book"], capabilities["sites"]["www.22biqu.com"]["supportedIntents"])


if __name__ == "__main__":
    unittest.main()
