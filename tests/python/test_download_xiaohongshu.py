from __future__ import annotations

import importlib.util
import json
import sys
import threading
import unittest
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock


def load_internal_module(module_name: str, relative_path: str):
    module_path = Path(__file__).resolve().parents[2] / relative_path
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


download_xiaohongshu = load_internal_module(
    "test_download_xiaohongshu_module",
    "src/sites/known-sites/xiaohongshu/download/python/xiaohongshu.py",
)
media_bundle = sys.modules["media_bundle"]


def asset_cache_index_path(output_root: str | Path) -> Path:
    return Path(output_root, "www.xiaohongshu.com", ".cache", "asset-index.json")


def load_asset_cache_index(output_root: str | Path) -> dict[str, object]:
    return json.loads(asset_cache_index_path(output_root).read_text(encoding="utf-8"))


def get_first_asset_paths(manifest: dict[str, object]) -> tuple[dict[str, object], dict[str, object], Path]:
    result = manifest["results"][0]
    asset = result["assets"][0]
    asset_path = Path(result["itemDir"]) / asset["itemRelativePath"]
    return result, asset, asset_path


def build_image_note_item(
    asset_url: str,
    *,
    preview_url: str | None = None,
    duplicate_asset: bool = False,
    asset_headers: dict[str, str] | None = None,
) -> list[dict[str, object]]:
    assets = [{
        "assetId": "img-1",
        "url": asset_url,
        "previewUrl": preview_url or asset_url,
        "width": 1080,
        "height": 1440,
        "headers": asset_headers or {},
    }]
    if duplicate_asset:
        assets.append({
            "assetId": "img-1-duplicate",
            "url": asset_url,
            "previewUrl": preview_url or asset_url,
            "width": 1080,
            "height": 1440,
            "headers": asset_headers or {},
        })
    return [{
        "noteId": "note-image",
        "title": "Spring Outfit",
        "sourceUrl": "https://www.xiaohongshu.com/explore/note-image",
        "authorName": "Image Author",
        "authorUserId": "user-image",
        "tagNames": ["outfit", "commute"],
        "queryText": "outfit",
        "sourceType": "search-initial-state",
        "bodyText": "Weekly commute image bundle",
        "downloadBundle": {
            "headers": asset_headers or {},
            "assets": assets,
        },
    }]


@contextmanager
def serve_binary_files(routes: dict[str, bytes], content_type: str = "image/webp"):
    hits: dict[str, int] = {}
    captured_headers: dict[str, dict[str, str]] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            hits[self.path] = hits.get(self.path, 0) + 1
            captured_headers[self.path] = {
                key.lower(): value
                for key, value in self.headers.items()
            }
            payload = routes.get(self.path)
            if payload is None:
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format: str, *args) -> None:  # noqa: A003
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", hits, captured_headers
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()


class DownloadXiaohongshuTests(unittest.TestCase):
    def test_download_xiaohongshu_dry_run_writes_standardized_bundle_artifacts(self) -> None:
        items = build_image_note_item(
            "https://ci.xiaohongshu.com/img-1-default.webp",
            preview_url="https://ci.xiaohongshu.com/img-1-preview.webp",
            duplicate_asset=True,
        )

        with TemporaryDirectory() as temp_dir:
            manifest = download_xiaohongshu.download_xiaohongshu(items, {
                "dryRun": True,
                "outDir": temp_dir,
                "maxItems": 5,
                "requestTimeoutSeconds": 10,
            }, {})

            self.assertEqual(manifest["summary"]["total"], 1)
            self.assertEqual(manifest["summary"]["planned"], 1)
            self.assertTrue(Path(manifest["runDir"]).exists())
            self.assertTrue(Path(manifest["runDir"], "index.md").exists())

            item_result = manifest["results"][0]
            metadata = json.loads(Path(item_result["metadataFile"]).read_text(encoding="utf-8"))
            markdown = Path(item_result["markdownFile"]).read_text(encoding="utf-8")
            legacy_markdown = Path(item_result["legacyMarkdownFile"]).read_text(encoding="utf-8")
            run_markdown = Path(manifest["runDir"], "index.md").read_text(encoding="utf-8")

            self.assertEqual(metadata["schemaVersion"], 1)
            self.assertEqual(metadata["noteId"], "note-image")
            self.assertEqual(metadata["author"]["userId"], "user-image")
            self.assertEqual(metadata["queryText"], "outfit")
            self.assertEqual(metadata["sourceType"], "search-initial-state")
            self.assertEqual(metadata["files"]["indexMarkdown"], item_result["markdownFile"])
            self.assertEqual(len(metadata["assets"]), 1)
            self.assertEqual(metadata["assets"][0]["status"], "planned")
            self.assertEqual(metadata["assets"][0]["reuseMode"], "dry-run")
            self.assertEqual(metadata["assets"][0]["fileName"], "image-01-img-1.webp")
            self.assertEqual(Path(item_result["markdownFile"]).name, "index.md")
            self.assertEqual(Path(item_result["legacyMarkdownFile"]).name, "note.md")
            self.assertIn("# Spring Outfit", markdown)
            self.assertIn("Author User ID: `user-image`", markdown)
            self.assertIn("Query: outfit", markdown)
            self.assertIn("Source Type: `search-initial-state`", markdown)
            self.assertIn("assets/image-01-img-1.webp", markdown)
            self.assertEqual(markdown, legacy_markdown)
            self.assertIn("# Media Download Summary", run_markdown)
            self.assertEqual(manifest["cache"]["gc"]["removedMissingEntries"], 0)
            self.assertEqual(manifest["cache"]["validation"]["scannedEntries"], 0)

    def test_download_xiaohongshu_reuses_cached_image_via_hardlink_and_cleans_missing_index_entries(self) -> None:
        payload = b"RIFF\x1a\x00\x00\x00WEBPVP8 \x0e\x00\x00\x000123456789abcd"
        forwarded_headers = {
            "Cookie": "sid=abc123; web_session=xyz",
            "Referer": "https://www.xiaohongshu.com/explore/note-image",
            "Origin": "https://www.xiaohongshu.com",
            "User-Agent": "SiteForge Test Agent",
        }

        with TemporaryDirectory() as temp_dir:
            with serve_binary_files({"/img-1-default.webp": payload}) as (base_url, hits, captured_headers):
                items = build_image_note_item(
                    f"{base_url}/img-1-default.webp",
                    asset_headers=forwarded_headers,
                )
                first_manifest = download_xiaohongshu.download_xiaohongshu(items, {
                    "dryRun": False,
                    "outDir": temp_dir,
                    "maxItems": 5,
                    "requestTimeoutSeconds": 2,
                }, {})
                cache_index_path = asset_cache_index_path(temp_dir)
                cache_index = load_asset_cache_index(temp_dir)
                cache_index["assets"]["stale-missing-entry"] = {
                    "cacheKey": "stale-missing-entry",
                    "cacheFile": "assets/missing.webp",
                    "sourceUrl": "https://www.xiaohongshu.com/explore/stale-missing-entry",
                    "bytes": 7,
                    "sha256": "deadbeef",
                    "updatedAt": "2026-01-01T00:00:00Z",
                }
                cache_index_path.write_text(json.dumps(cache_index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

                second_manifest = download_xiaohongshu.download_xiaohongshu(items, {
                    "dryRun": False,
                    "outDir": temp_dir,
                    "maxItems": 5,
                    "requestTimeoutSeconds": 1,
                }, {})

            _, first_asset, first_asset_path = get_first_asset_paths(first_manifest)
            cache_index = load_asset_cache_index(temp_dir)
            cache_file = cache_index_path.parent / cache_index["assets"][first_asset["cacheKey"]]["cacheFile"]

            self.assertEqual(first_manifest["summary"]["successful"], 1)
            self.assertEqual(first_asset["status"], "downloaded")
            self.assertEqual(first_asset["cacheStatus"], "stored")
            self.assertEqual(first_asset["reuseMode"], "download")
            self.assertEqual(first_manifest["cache"]["assetStores"], 1)
            self.assertEqual(hits["/img-1-default.webp"], 1)
            self.assertEqual(captured_headers["/img-1-default.webp"]["cookie"], forwarded_headers["Cookie"])
            self.assertEqual(captured_headers["/img-1-default.webp"]["referer"], forwarded_headers["Referer"])
            self.assertEqual(captured_headers["/img-1-default.webp"]["origin"], forwarded_headers["Origin"])
            self.assertEqual(captured_headers["/img-1-default.webp"]["user-agent"], forwarded_headers["User-Agent"])
            self.assertEqual(first_asset_path.read_bytes(), payload)
            self.assertIn(first_asset["cacheKey"], cache_index["assets"])

            _, second_asset, second_asset_path = get_first_asset_paths(second_manifest)

            self.assertEqual(second_manifest["summary"]["successful"], 1)
            self.assertEqual(second_asset["status"], "cached")
            self.assertEqual(second_asset["cacheStatus"], "hit")
            self.assertEqual(second_asset["reuseMode"], "hardlink")
            self.assertEqual(second_manifest["cache"]["assetHits"], 1)
            self.assertEqual(second_manifest["cache"]["assetStores"], 0)
            self.assertEqual(second_manifest["cache"]["assetHardlinkReuses"], 1)
            self.assertEqual(second_manifest["cache"]["assetCopyReuses"], 0)
            self.assertEqual(second_manifest["cache"]["gc"]["removedMissingEntries"], 1)
            self.assertGreaterEqual(second_manifest["cache"]["validation"]["scannedEntries"], 2)
            self.assertEqual(hits["/img-1-default.webp"], 1)
            self.assertEqual(second_asset_path.read_bytes(), payload)
            self.assertTrue(second_asset_path.samefile(cache_file))
            self.assertGreaterEqual(second_asset_path.stat().st_nlink, 2)
            self.assertNotIn("stale-missing-entry", cache_index["assets"])

    def test_download_xiaohongshu_falls_back_to_copy_when_hardlink_reuse_fails(self) -> None:
        payload = b"RIFF\x1a\x00\x00\x00WEBPVP8 \x0e\x00\x00\x000123456789copy"

        with TemporaryDirectory() as temp_dir:
            with serve_binary_files({"/img-1-copy.webp": payload}) as (base_url, hits, _captured_headers):
                items = build_image_note_item(f"{base_url}/img-1-copy.webp")
                first_manifest = download_xiaohongshu.download_xiaohongshu(items, {
                    "dryRun": False,
                    "outDir": temp_dir,
                    "maxItems": 5,
                    "requestTimeoutSeconds": 2,
                }, {})

                with mock.patch.object(media_bundle.os, "link", side_effect=OSError("hardlink disabled for test")):
                    second_manifest = download_xiaohongshu.download_xiaohongshu(items, {
                        "dryRun": False,
                        "outDir": temp_dir,
                        "maxItems": 5,
                        "requestTimeoutSeconds": 1,
                    }, {})

            cache_index = load_asset_cache_index(temp_dir)
            _, first_asset, _first_asset_path = get_first_asset_paths(first_manifest)
            cache_file = asset_cache_index_path(temp_dir).parent / cache_index["assets"][first_asset["cacheKey"]]["cacheFile"]
            _, second_asset, second_asset_path = get_first_asset_paths(second_manifest)

            self.assertEqual(first_manifest["summary"]["successful"], 1)
            self.assertEqual(second_manifest["summary"]["successful"], 1)
            self.assertEqual(second_asset["status"], "cached")
            self.assertEqual(second_asset["cacheStatus"], "hit")
            self.assertEqual(second_asset["reuseMode"], "copy")
            self.assertEqual(second_manifest["cache"]["assetHits"], 1)
            self.assertEqual(second_manifest["cache"]["assetHardlinkReuses"], 0)
            self.assertEqual(second_manifest["cache"]["assetCopyReuses"], 1)
            self.assertEqual(second_manifest["cache"]["gc"]["removedMissingEntries"], 0)
            self.assertEqual(hits["/img-1-copy.webp"], 1)
            self.assertEqual(second_asset_path.read_bytes(), payload)
            self.assertFalse(second_asset_path.samefile(cache_file))


if __name__ == "__main__":
    unittest.main()
