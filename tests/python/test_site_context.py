from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

def load_internal_module(module_name: str, relative_path: str):
    module_path = Path(__file__).resolve().parents[2] / relative_path
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


site_context = load_internal_module(
    "test_site_context_module",
    "src/sites/catalog/python/site_context.py",
)
build_site_capabilities_path = site_context.build_site_capabilities_path
build_site_registry_path = site_context.build_site_registry_path
build_site_runtime_capabilities_path = site_context.build_site_runtime_capabilities_path
build_site_runtime_registry_path = site_context.build_site_runtime_registry_path
read_site_context = site_context.read_site_context
resolve_capability_families = site_context.resolve_capability_families
resolve_page_types = site_context.resolve_page_types
resolve_primary_archetype = site_context.resolve_primary_archetype
resolve_safe_action_kinds = site_context.resolve_safe_action_kinds
resolve_supported_intents = site_context.resolve_supported_intents
upsert_site_capabilities_record = site_context.upsert_site_capabilities_record
upsert_site_registry_record = site_context.upsert_site_registry_record


class SiteContextTests(unittest.TestCase):
    def test_read_site_context_merges_isolated_host_records(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            build_site_registry_path(root).parent.mkdir(parents=True, exist_ok=True)
            build_site_registry_path(root).write_text(json.dumps({
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
            build_site_capabilities_path(root).write_text(json.dumps({
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

            registry = json.loads(build_site_registry_path(root).read_text(encoding="utf-8"))
            capabilities = json.loads(build_site_capabilities_path(root).read_text(encoding="utf-8"))
            self.assertIn("www.22biqu.com", registry["sites"])
            self.assertIn("www.22biqu.com", capabilities["sites"])
            self.assertEqual(["download-content"], registry["sites"]["www.22biqu.com"]["capabilityFamilies"])
            self.assertEqual(["download-book"], capabilities["sites"]["www.22biqu.com"]["supportedIntents"])
            self.assertFalse((root / "site-registry.json").exists())
            self.assertFalse((root / "site-capabilities.json").exists())

    def test_runtime_snapshot_fields_are_split_from_stable_config_documents(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            upsert_site_registry_record("www.22biqu.com", {
                "canonicalBaseUrl": "https://www.22biqu.com/",
                "siteKey": "22biqu",
                "adapterId": "chapter-content",
                "knowledgeBaseDir": str(root / "knowledge-base" / "www.22biqu.com"),
                "latestDownloadMode": "artifact-hit",
            }, root)
            upsert_site_capabilities_record("www.22biqu.com", {
                "baseUrl": "https://www.22biqu.com/",
                "siteKey": "22biqu",
                "adapterId": "chapter-content",
                "capabilityFamilies": ["download-content"],
            }, root)

            stable_registry = json.loads(build_site_registry_path(root).read_text(encoding="utf-8"))
            runtime_registry = json.loads(build_site_runtime_registry_path(root).read_text(encoding="utf-8"))
            stable_capabilities = json.loads(build_site_capabilities_path(root).read_text(encoding="utf-8"))
            runtime_capabilities = json.loads(build_site_runtime_capabilities_path(root).read_text(encoding="utf-8"))
            context = read_site_context("www.22biqu.com", root)

            self.assertNotIn("knowledgeBaseDir", stable_registry["sites"]["www.22biqu.com"])
            self.assertEqual("artifact-hit", runtime_registry["sites"]["www.22biqu.com"]["latestDownloadMode"])
            self.assertEqual(
                str(root / "knowledge-base" / "www.22biqu.com"),
                context["registryRecord"]["knowledgeBaseDir"],
            )

            self.assertNotIn("updatedAt", stable_capabilities["sites"]["www.22biqu.com"])
            self.assertIn("updatedAt", runtime_capabilities["sites"]["www.22biqu.com"])
            self.assertEqual("22biqu", context["capabilitiesRecord"]["siteKey"])


if __name__ == "__main__":
    unittest.main()
