from __future__ import annotations

import importlib.util
import sys
import unittest
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


download_douyin = load_internal_module(
    "test_download_douyin_module",
    "src/sites/douyin/download/python/douyin.py",
)


class DownloadDouyinTests(unittest.TestCase):
    def test_build_archive_keys_prefers_video_id_and_canonical_url(self) -> None:
        task = {
            "finalUrl": "https://www.douyin.com/shipin/abc?foo=1",
            "videoId": "7487317288315258152",
        }
        keys = download_douyin.build_archive_keys(task)
        self.assertIn("douyin:video:7487317288315258152", keys)
        self.assertIn("https://www.douyin.com/video/7487317288315258152", keys)
        self.assertIn("https://www.douyin.com/shipin/abc?foo=1", keys)

    def test_load_input_items_dedupes_same_video_by_content_key(self) -> None:
        items = download_douyin.load_input_items([
            "https://www.douyin.com/video/7487317288315258152",
            "https://www.douyin.com/shipin/7487317288315258152?foo=1",
            "7487317288315258152",
        ])
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["videoId"], "7487317288315258152")

    def test_select_media_candidate_prefers_highest_height_then_bitrate(self) -> None:
        task = {
            "resolvedMediaUrl": "https://cdn.example.com/video-720.mp4",
            "resolvedFormat": {"formatId": "720p", "height": 720},
            "resolvedFormats": [
                {"url": "https://cdn.example.com/video-1080.m3u8", "formatId": "1080p-hls", "height": 1080, "protocol": "hls"},
                {"url": "https://cdn.example.com/video-1080.mp4", "formatId": "1080p-http", "height": 1080, "bitrate": 8000},
            ],
        }
        candidate = download_douyin.select_media_candidate(task)
        self.assertIsNotNone(candidate)
        self.assertEqual(candidate["url"], "https://cdn.example.com/video-1080.mp4")
        self.assertEqual(candidate["formatId"], "1080p-http")

    def test_build_cli_output_summary_markdown_uses_summary_view(self) -> None:
        manifest = {
            "host": "www.douyin.com",
            "runDir": "C:/tmp/run",
            "summary": {"total": 3, "successful": 2, "failed": 1, "skipped": 0, "planned": 0},
            "statistics": {"pathStats": {"yt-dlp-direct-hls": 2}},
            "summaryView": {
                "runDir": "C:/tmp/run",
                "summary": {"total": 3, "successful": 2, "failed": 1, "skipped": 0, "planned": 0},
                "statistics": {"pathStats": {"yt-dlp-direct-hls": 2}},
            },
        }
        markdown = download_douyin.build_cli_output(manifest, "summary", "markdown")
        self.assertIn("# Douyin Download Summary", markdown)
        self.assertIn("yt-dlp-direct-hls", markdown)

    def test_resolve_tool_state_skips_cookie_export_for_dry_run(self) -> None:
        settings = download_douyin.merge_settings({
            "dryRun": True,
            "reuseLoginState": True,
        })
        with TemporaryDirectory() as temp_dir:
            with mock.patch.object(download_douyin, "resolve_tool_path", side_effect=AssertionError("tool lookup should be skipped for dry-run")):
                with mock.patch.object(download_douyin, "export_cookies", side_effect=AssertionError("cookie export should be skipped for dry-run")):
                    tool_state = download_douyin.resolve_tool_state(
                        settings,
                        {"requiresLoginForHighestQuality": True},
                        Path(temp_dir),
                    )
        self.assertIsNone(tool_state["ytDlpPath"])
        self.assertIsNone(tool_state["cookiesFile"])
        self.assertFalse(tool_state["usedLoginState"])

    def test_resolve_media_tasks_skips_browser_resolver_for_dry_run(self) -> None:
        settings = download_douyin.merge_settings({
            "dryRun": True,
            "reuseLoginState": True,
        })
        tasks = [
            {"finalUrl": "https://www.douyin.com/video/111", "resolvedMediaUrl": ""},
            {"finalUrl": "https://www.douyin.com/video/222", "resolvedMediaUrl": "https://v26-web.douyinvod.com/example/222.mp4"},
        ]
        with TemporaryDirectory() as temp_dir:
            with mock.patch.object(download_douyin, "resolve_tool_path", side_effect=AssertionError("browser resolver should be skipped for dry-run")):
                report = download_douyin.resolve_media_tasks(tasks, settings, Path(temp_dir))
        self.assertEqual(report["tasks"], tasks)
        self.assertTrue(report["report"]["ok"])
        self.assertTrue(report["report"]["skipped"])
        self.assertEqual(report["report"]["resolvedCount"], 1)

    def test_execute_download_plan_wraps_executor_errors_in_result_shape(self) -> None:
        settings = download_douyin.merge_settings({
            "dryRun": False,
            "concurrency": 2,
        })
        tasks = [
            {
                "finalUrl": "https://www.douyin.com/video/111",
                "videoId": "111",
                "normalizedUrl": "https://www.douyin.com/video/111",
            },
            {
                "finalUrl": "https://www.douyin.com/video/222",
                "videoId": "222",
                "normalizedUrl": "https://www.douyin.com/video/222",
            },
        ]
        with TemporaryDirectory() as temp_dir:
            with mock.patch.object(download_douyin, "execute_download_task", side_effect=RuntimeError("boom")):
                results = download_douyin.execute_download_plan(
                    tasks,
                    run_dir=Path(temp_dir),
                    settings=settings,
                    tool_state={},
                    archive_state=None,
                )
        self.assertEqual(len(results), 2)
        self.assertTrue(all(item["status"] == "failed" for item in results))
        self.assertTrue(all(item["pathway"] == "executor-error" for item in results))
        self.assertEqual({item["contentKey"] for item in results}, {"douyin:video:111", "douyin:video:222"})


if __name__ == "__main__":
    unittest.main()
