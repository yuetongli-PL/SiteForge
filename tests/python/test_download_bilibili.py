import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import download_bilibili


def create_profile(host="www.bilibili.com"):
    return {
        "host": host,
        "archetype": "navigation-catalog",
        "schemaVersion": 1,
        "primaryArchetype": "catalog-detail",
        "version": 1,
        "pageTypes": {
            "homeExact": ["/"],
            "homePrefixes": [],
            "searchResultsPrefixes": ["/all", "/video"],
            "contentDetailPrefixes": ["/video/", "/bangumi/play/"],
            "authorPrefixes": ["/space/"],
            "authorListExact": [],
            "authorListPrefixes": ["/video", "/upload/video"],
            "authorDetailPrefixes": ["/space/"],
            "chapterPrefixes": [],
            "historyPrefixes": [],
            "authPrefixes": ["/login"],
            "categoryPrefixes": ["/v/"],
        },
        "search": {
            "formSelectors": ["form[action*='/all']"],
            "inputSelectors": ["input[name='keyword']"],
            "submitSelectors": ["button[type='submit']"],
            "resultTitleSelectors": ["title"],
            "resultBookSelectors": ["a[href*='/video/']"],
            "knownQueries": [
                {
                    "query": "BV1WjDDBGE3p",
                    "title": "BV1WjDDBGE3p",
                    "url": "https://www.bilibili.com/video/BV1WjDDBGE3p/",
                    "authorName": "tester",
                }
            ],
        },
        "validationSamples": {
            "videoSearchQuery": "BV1WjDDBGE3p",
            "videoDetailUrl": "https://www.bilibili.com/video/BV1WjDDBGE3p/",
            "authorVideosUrl": "https://space.bilibili.com/1202350411/video",
        },
        "sampling": {
            "searchResultContentLimit": 5,
            "authorContentLimit": 10,
            "categoryContentLimit": 10,
            "fallbackContentLimitWithSearch": 8,
        },
        "navigation": {
            "allowedHosts": ["www.bilibili.com", "space.bilibili.com"],
            "contentPathPrefixes": ["/video/", "/bangumi/play/"],
            "authorPathPrefixes": ["/space/"],
            "authorListPathPrefixes": ["/video", "/upload/video"],
            "authorDetailPathPrefixes": ["/space/"],
            "categoryPathPrefixes": ["/v/"],
            "utilityPathPrefixes": ["/help"],
            "authPathPrefixes": ["/login"],
            "categoryLabelKeywords": ["popular"],
        },
        "contentDetail": {
            "titleSelectors": ["h1"],
            "authorNameSelectors": ["a[href*='/space/']"],
            "authorLinkSelectors": ["a[href*='/space/']"],
        },
        "author": {
            "titleSelectors": ["h1"],
            "workLinkSelectors": ["a[href*='/video/']"],
        },
        "downloader": {
            "defaultOutputRoot": "video-downloads",
            "requiresLoginForHighestQuality": True,
            "qualityPolicy": {
                "targetHeight": 1080,
                "targetCodec": "h264",
                "defaultContainer": "mp4",
                "fallbackPolicy": "preserve-height-then-downgrade-codec",
            },
            "authorVideoListPathPrefixes": ["/video", "/upload/video"],
            "favoriteListPathPrefixes": ["/favlist"],
            "watchLaterPathPrefixes": ["/watchlater"],
            "collectionPathPrefixes": ["/channel/collectiondetail", "/channel/seriesdetail"],
            "channelPathPrefixes": ["/v/popular", "/anime", "/movie"],
            "maxBatchItems": 5,
        },
    }


def fake_completed(args, stdout="", stderr="", returncode=0):
    return subprocess.CompletedProcess(args=args, returncode=returncode, stdout=stdout, stderr=stderr)


def create_tool_state(*, used_login_state=False, profile_health=None, warnings=None):
    return {
        "ytDlpPath": "yt-dlp",
        "ffmpegPath": "ffmpeg",
        "ffmpegLocation": ".",
        "profileHealth": profile_health,
        "cookiesFromBrowser": "chrome:C:\\fake\\Default" if used_login_state else None,
        "usedLoginState": used_login_state,
        "warnings": list(warnings or []),
    }


def write_previous_run(run_dir, results):
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "download-manifest.json").write_text(
        json.dumps(
            {
                "host": "www.bilibili.com",
                "runDir": str(run_dir),
                "results": results,
                "summary": {
                    "total": len(results),
                    "successful": sum(1 for item in results if item["status"] == "success"),
                    "failed": sum(1 for item in results if item["status"] == "failed"),
                    "skipped": sum(1 for item in results if item["status"] == "skipped"),
                    "planned": sum(1 for item in results if item["status"] == "planned"),
                },
            },
            ensure_ascii=False,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )


class DownloadBilibiliTests(unittest.TestCase):
    def test_cli_help_is_available(self):
        completed = subprocess.run(
            [sys.executable, str(Path(download_bilibili.__file__).resolve()), "--help"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("Download bilibili videos", completed.stdout)
        self.assertIn("--input-file", completed.stdout)
        self.assertIn("--resume", completed.stdout)
        self.assertIn("--retry-failed-only", completed.stdout)
        self.assertIn("--skip-existing", completed.stdout)
        self.assertIn("--download-archive", completed.stdout)
        self.assertIn("--auto-login-bootstrap", completed.stdout)
        self.assertIn("--prefer-av1", completed.stdout)
        self.assertIn("--max-height", completed.stdout)
        self.assertIn("--container", completed.stdout)
        self.assertIn("--filename-template", completed.stdout)
        self.assertIn("--playlist-start", completed.stdout)
        self.assertIn("--playlist-end", completed.stdout)
        self.assertIn("--title-include", completed.stdout)

    def test_load_input_items_accepts_bv_url_and_author_video_list(self):
        items = download_bilibili.load_input_items([
            "BV1WjDDBGE3p",
            "https://www.bilibili.com/bangumi/play/ep508404",
            "https://space.bilibili.com/1202350411/video",
        ])
        self.assertEqual([item["inputKind"] for item in items], [
            "video-detail",
            "bangumi-detail",
            "author-video-list",
        ])

    def test_load_input_items_accepts_favorite_watch_later_collection_and_channel_pages(self):
        items = download_bilibili.load_input_items([
            "https://space.bilibili.com/1202350411/favlist?fid=998877",
            "https://www.bilibili.com/watchlater/#/list",
            "https://space.bilibili.com/1202350411/channel/collectiondetail?sid=556677",
            "https://www.bilibili.com/v/popular/all",
        ])
        self.assertEqual(
            [item["inputKind"] for item in items],
            ["favorite-list", "watch-later-list", "collection-list", "channel-list"],
        )

    def test_resolve_download_tasks_expands_author_video_list(self):
        settings = download_bilibili.merge_settings({"maxPlaylistItems": 5})
        tool_state = create_tool_state()

        def runner(args, **_kwargs):
            if "--flat-playlist" in args:
                return fake_completed(args, stdout=json.dumps({
                    "title": "Uploader Videos",
                    "entries": [
                        {"id": "BV1WjDDBGE3p"},
                        {"webpage_url": "https://www.bilibili.com/video/BV1uT41147VW/"},
                    ],
                }))
            raise AssertionError(f"Unexpected args: {args}")

        plan = download_bilibili.resolve_download_tasks(
            [{"inputKind": "author-video-list", "normalizedUrl": "https://space.bilibili.com/1202350411/video", "source": "https://space.bilibili.com/1202350411/video"}],
            settings,
            create_profile(),
            tool_state,
            runner=runner,
        )
        self.assertEqual(len(plan["tasks"]), 2)
        self.assertEqual(plan["resolvedItems"][0]["resolvedVideoUrls"][0], "https://www.bilibili.com/video/BV1WjDDBGE3p/")

    def test_resolve_download_tasks_applies_playlist_window_and_title_filters(self):
        settings = download_bilibili.merge_settings({
            "maxPlaylistItems": 10,
            "playlistStart": 2,
            "playlistEnd": 4,
            "titleIncludes": ["猫"],
        })
        tool_state = create_tool_state()
        seen_args = []

        def runner(args, **_kwargs):
            seen_args.append(list(args))
            if "--flat-playlist" in args:
                return fake_completed(args, stdout=json.dumps({
                    "title": "Uploader Videos",
                    "entries": [
                        {"id": "BV1111111111", "title": "猫视频 1"},
                        {"id": "BV2222222222", "title": "狗视频 2"},
                        {"id": "BV3333333333", "title": "猫视频 3"},
                        {"id": "BV4444444444", "title": "测试 4"},
                    ],
                }))
            raise AssertionError(f"Unexpected args: {args}")

        plan = download_bilibili.resolve_download_tasks(
            [{"inputKind": "author-video-list", "normalizedUrl": "https://space.bilibili.com/1202350411/video", "source": "https://space.bilibili.com/1202350411/video"}],
            settings,
            create_profile(),
            tool_state,
            runner=runner,
        )
        playlist_call = seen_args[0]
        self.assertIn("--playlist-start", playlist_call)
        self.assertIn("2", playlist_call)
        self.assertIn("--playlist-end", playlist_call)
        self.assertIn("4", playlist_call)
        self.assertEqual([task["resolvedUrl"] for task in plan["tasks"]], ["https://www.bilibili.com/video/BV3333333333/"])

    def test_resolve_tool_state_keeps_login_state_when_only_historical_crash_warning_exists(self):
        profile_health = {
            "userDataDir": "C:\\fake\\bilibili.com",
            "exists": True,
            "cookiesPath": "C:\\fake\\bilibili.com\\Default\\Network\\Cookies",
            "preferencesPath": "C:\\fake\\bilibili.com\\Default\\Preferences",
            "sessionsPath": "C:\\fake\\bilibili.com\\Default\\Sessions",
            "loginStateLikelyAvailable": True,
            "healthy": False,
            "profileInUse": False,
            "lastExitType": "Crashed",
            "warnings": ["Persistent browser profile last exit type was Crashed."],
        }
        with patch.object(download_bilibili, "resolve_tool_path", side_effect=["yt-dlp", "ffmpeg"]), patch.object(
            download_bilibili,
            "inspect_persistent_profile_health",
            return_value=profile_health,
        ):
            state = download_bilibili.resolve_tool_state(
                {"reuseLoginState": True, "profileRoot": "C:\\fake"},
                create_profile()["downloader"],
            )
        self.assertTrue(state["usedLoginState"])
        self.assertTrue(state["cookiesFromBrowser"].startswith("chrome:"))
        self.assertNotIn(
            "Reusable bilibili login state is unavailable; highest available quality or protected content may require running site-login first.",
            state["warnings"],
        )

    def test_download_bilibili_dry_run_writes_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile_path = Path(tmp) / "www.bilibili.com.json"
            profile_path.write_text(json.dumps(create_profile(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

            def runner(args, **_kwargs):
                if "--flat-playlist" in args:
                    return fake_completed(args, stdout=json.dumps({
                        "title": "Uploader Videos",
                        "entries": [{"id": "BV1WjDDBGE3p"}],
                    }))
                return fake_completed(args, stdout=json.dumps({
                    "id": "BV1WjDDBGE3p",
                    "bvid": "BV1WjDDBGE3p",
                    "title": "Test Video",
                    "uploader": "Tester",
                    "uploader_id": "1202350411",
                    "webpage_url": "https://www.bilibili.com/video/BV1WjDDBGE3p/",
                }))

            with patch.object(download_bilibili, "resolve_tool_state", return_value={
                **create_tool_state(
                    used_login_state=True,
                    profile_health={"userDataDir": str(Path(tmp) / "browser-profile"), "loginStateLikelyAvailable": True},
                ),
            }):
                manifest = download_bilibili.download_bilibili(
                    ["BV1WjDDBGE3p", "https://space.bilibili.com/1202350411/video"],
                    {
                        "profilePath": str(profile_path),
                        "outDir": str(Path(tmp) / "downloads"),
                        "dryRun": True,
                    },
                    {"runner": runner},
                )

            self.assertEqual(manifest["usedLoginState"], True)
            self.assertGreaterEqual(len(manifest["results"]), 1)
            self.assertTrue(any(result["status"] == "planned" for result in manifest["results"]))
            self.assertTrue(Path(manifest["runDir"], "download-manifest.json").exists())

    def test_download_bilibili_bootstraps_login_for_watch_later_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile_path = Path(tmp) / "www.bilibili.com.json"
            profile_path.write_text(json.dumps(create_profile(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            tool_states = [
                create_tool_state(used_login_state=False),
                create_tool_state(used_login_state=True),
            ]
            bootstrap_calls = []

            def fake_resolve_tool_state(_settings, _downloader_config):
                return tool_states.pop(0)

            def fake_bootstrap(_settings, **_kwargs):
                bootstrap_calls.append(True)
                return {
                    "auth": {
                        "status": "session-reused",
                        "persistenceVerified": True,
                    },
                    "site": {
                        "userDataDir": "C:\\fake\\bilibili.com",
                    },
                }

            def runner(args, **_kwargs):
                if "--flat-playlist" in args:
                    return fake_completed(args, stdout=json.dumps({
                        "title": "Watch Later",
                        "entries": [{"id": "BV1WjDDBGE3p"}],
                    }))
                return fake_completed(args, stdout=json.dumps({
                    "id": "BV1WjDDBGE3p",
                    "bvid": "BV1WjDDBGE3p",
                    "title": "Test Video",
                    "uploader": "Tester",
                    "uploader_id": "1202350411",
                    "webpage_url": "https://www.bilibili.com/video/BV1WjDDBGE3p/",
                }))

            with patch.object(download_bilibili, "resolve_tool_state", side_effect=fake_resolve_tool_state):
                manifest = download_bilibili.download_bilibili(
                    ["https://www.bilibili.com/watchlater/#/list"],
                    {
                        "profilePath": str(profile_path),
                        "outDir": str(Path(tmp) / "downloads"),
                        "dryRun": True,
                    },
                    {"runner": runner, "loginBootstrap": fake_bootstrap},
                )

            self.assertEqual(len(bootstrap_calls), 1)
            self.assertTrue(manifest["usedLoginState"])
            self.assertTrue(manifest["loginBootstrap"]["attempted"])
            self.assertEqual(manifest["loginBootstrap"]["status"], "session-reused")

    def test_download_bilibili_does_not_bootstrap_login_for_public_bv_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile_path = Path(tmp) / "www.bilibili.com.json"
            profile_path.write_text(json.dumps(create_profile(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

            def fake_bootstrap(_settings, **_kwargs):
                raise AssertionError("login bootstrap should not run for public BV inputs")

            def runner(args, **_kwargs):
                return fake_completed(args, stdout=json.dumps({
                    "id": "BV1WjDDBGE3p",
                    "bvid": "BV1WjDDBGE3p",
                    "title": "Test Video",
                    "uploader": "Tester",
                    "uploader_id": "1202350411",
                    "webpage_url": "https://www.bilibili.com/video/BV1WjDDBGE3p/",
                }))

            with patch.object(download_bilibili, "resolve_tool_state", return_value=create_tool_state(used_login_state=False)):
                manifest = download_bilibili.download_bilibili(
                    ["BV1WjDDBGE3p"],
                    {
                        "profilePath": str(profile_path),
                        "outDir": str(Path(tmp) / "downloads"),
                        "dryRun": True,
                    },
                    {"runner": runner, "loginBootstrap": fake_bootstrap},
                )

            self.assertFalse(manifest["loginBootstrap"]["attempted"])

    def test_download_bilibili_skip_existing_marks_result_skipped_without_download(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile_path = Path(tmp) / "www.bilibili.com.json"
            profile_path.write_text(json.dumps(create_profile(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            output_root = Path(tmp) / "downloads"
            host_root = output_root / "www.bilibili.com"
            run_dir = host_root / "resume-case"
            task_dir = run_dir / "001_existing_BV1WjDDBGE3p"
            task_dir.mkdir(parents=True, exist_ok=True)
            output_path = task_dir / "video.mp4"
            output_path.write_bytes(b"existing-video")
            write_previous_run(run_dir, [{
                "source": "BV1WjDDBGE3p",
                "inputKind": "video-detail",
                "finalUrl": "https://www.bilibili.com/video/BV1WjDDBGE3p/",
                "title": "Existing Video",
                "outputPath": str(output_path),
                "status": "success",
                "error": None,
                "usedLoginState": True,
                "taskDir": str(task_dir),
            }])

            def runner(args, **_kwargs):
                if "--dump-single-json" in args:
                    return fake_completed(args, stdout=json.dumps({
                        "id": "BV1WjDDBGE3p",
                        "bvid": "BV1WjDDBGE3p",
                        "title": "Existing Video",
                        "uploader": "Tester",
                        "uploader_id": "1202350411",
                        "webpage_url": "https://www.bilibili.com/video/BV1WjDDBGE3p/",
                    }))
                raise AssertionError(f"download should have been skipped, got args: {args}")

            with patch.object(download_bilibili, "resolve_tool_state", return_value=create_tool_state(used_login_state=True)), patch.object(
                download_bilibili,
                "current_run_id",
                return_value="resume-case",
            ):
                manifest = download_bilibili.download_bilibili(
                    ["BV1WjDDBGE3p"],
                    {
                        "profilePath": str(profile_path),
                        "outDir": str(output_root),
                        "resume": True,
                        "skipExisting": True,
                    },
                    {"runner": runner},
                )

            self.assertEqual(manifest["summary"]["skipped"], 1)
            self.assertTrue(any(result["status"] == "skipped" for result in manifest["results"]))

    def test_download_bilibili_skip_existing_uses_download_archive_without_existing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile_path = Path(tmp) / "www.bilibili.com.json"
            profile_path.write_text(json.dumps(create_profile(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            output_root = Path(tmp) / "downloads"
            host_root = output_root / "www.bilibili.com"
            host_root.mkdir(parents=True, exist_ok=True)
            (host_root / "download-archive.txt").write_text("bvid:BV1WjDDBGE3p\n", encoding="utf-8")

            def runner(args, **_kwargs):
                if "--dump-single-json" in args:
                    return fake_completed(args, stdout=json.dumps({
                        "id": "BV1WjDDBGE3p",
                        "bvid": "BV1WjDDBGE3p",
                        "title": "Archived Video",
                        "uploader": "Tester",
                        "uploader_id": "1202350411",
                        "webpage_url": "https://www.bilibili.com/video/BV1WjDDBGE3p/",
                    }))
                raise AssertionError(f"download should have been skipped by archive, got args: {args}")

            with patch.object(download_bilibili, "resolve_tool_state", return_value=create_tool_state(used_login_state=True)):
                manifest = download_bilibili.download_bilibili(
                    ["BV1WjDDBGE3p"],
                    {
                        "profilePath": str(profile_path),
                        "outDir": str(output_root),
                        "skipExisting": True,
                    },
                    {"runner": runner},
                )

            self.assertEqual(manifest["summary"]["skipped"], 1)
            self.assertIn("download-archive", manifest["results"][0]["note"].lower())

    def test_download_bilibili_retry_failed_only_reruns_failed_results_from_previous_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile_path = Path(tmp) / "www.bilibili.com.json"
            profile_path.write_text(json.dumps(create_profile(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            output_root = Path(tmp) / "downloads"
            host_root = output_root / "www.bilibili.com"
            run_dir = host_root / "retry-case"
            successful_dir = run_dir / "001_existing_BV1WjDDBGE3p"
            successful_dir.mkdir(parents=True, exist_ok=True)
            successful_path = successful_dir / "video.mp4"
            successful_path.write_bytes(b"existing-video")
            write_previous_run(run_dir, [
                {
                    "source": "BV1WjDDBGE3p",
                    "inputKind": "video-detail",
                    "finalUrl": "https://www.bilibili.com/video/BV1WjDDBGE3p/",
                    "title": "Existing Video",
                    "outputPath": str(successful_path),
                    "status": "success",
                    "error": None,
                    "usedLoginState": True,
                    "taskDir": str(successful_dir),
                },
                {
                    "source": "BV1uT41147VW",
                    "inputKind": "video-detail",
                    "finalUrl": "https://www.bilibili.com/video/BV1uT41147VW/",
                    "title": "Retry Video",
                    "outputPath": None,
                    "status": "failed",
                    "error": "network error",
                    "usedLoginState": True,
                    "taskDir": None,
                },
            ])

            actual_download_urls = []

            def runner(args, **_kwargs):
                if "--dump-single-json" in args:
                    url = args[-1]
                    identifier = "BV1WjDDBGE3p" if "BV1WjDDBGE3p" in url else "BV1uT41147VW"
                    return fake_completed(args, stdout=json.dumps({
                        "id": identifier,
                        "bvid": identifier,
                        "title": f"Title {identifier}",
                        "uploader": "Tester",
                        "uploader_id": "1202350411",
                        "webpage_url": f"https://www.bilibili.com/video/{identifier}/",
                    }))
                actual_download_urls.append(args[-1])
                output_template = Path(args[args.index("--output") + 1].replace("%(ext)s", "mp4"))
                output_template.parent.mkdir(parents=True, exist_ok=True)
                output_template.write_bytes(b"new-video")
                return fake_completed(args)

            with patch.object(download_bilibili, "resolve_tool_state", return_value=create_tool_state(used_login_state=True)), patch.object(
                download_bilibili,
                "current_run_id",
                return_value="retry-case",
            ):
                manifest = download_bilibili.download_bilibili(
                    ["BV1WjDDBGE3p", "BV1uT41147VW"],
                    {
                        "profilePath": str(profile_path),
                        "outDir": str(output_root),
                        "resume": True,
                        "retryFailedOnly": True,
                    },
                    {"runner": runner},
                )

            self.assertEqual(actual_download_urls, ["https://www.bilibili.com/video/BV1uT41147VW/"])
            self.assertEqual(manifest["summary"]["successful"], 1)
            self.assertEqual(manifest["summary"]["failed"], 0)
            self.assertEqual(manifest["summary"]["skipped"], 1)

    def test_download_bilibili_validation_fails_when_output_is_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile_path = Path(tmp) / "www.bilibili.com.json"
            profile_path.write_text(json.dumps(create_profile(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

            def runner(args, **_kwargs):
                if "--dump-single-json" in args:
                    return fake_completed(args, stdout=json.dumps({
                        "id": "BV1WjDDBGE3p",
                        "bvid": "BV1WjDDBGE3p",
                        "title": "Validation Video",
                        "uploader": "Tester",
                        "uploader_id": "1202350411",
                        "webpage_url": "https://www.bilibili.com/video/BV1WjDDBGE3p/",
                    }))
                return fake_completed(args)

            with patch.object(download_bilibili, "resolve_tool_state", return_value=create_tool_state()):
                manifest = download_bilibili.download_bilibili(
                    ["BV1WjDDBGE3p"],
                    {
                        "profilePath": str(profile_path),
                        "outDir": str(Path(tmp) / "downloads"),
                    },
                    {"runner": runner},
                )

            self.assertEqual(manifest["summary"]["failed"], 1)
            self.assertTrue(any("validation" in (result.get("error") or "").lower() or "missing" in (result.get("error") or "").lower() for result in manifest["results"]))

    def test_download_bilibili_validation_accepts_non_empty_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile_path = Path(tmp) / "www.bilibili.com.json"
            profile_path.write_text(json.dumps(create_profile(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

            def runner(args, **_kwargs):
                if "--dump-single-json" in args:
                    return fake_completed(args, stdout=json.dumps({
                        "id": "BV1WjDDBGE3p",
                        "bvid": "BV1WjDDBGE3p",
                        "title": "Validation Video",
                        "uploader": "Tester",
                        "uploader_id": "1202350411",
                        "webpage_url": "https://www.bilibili.com/video/BV1WjDDBGE3p/",
                    }))
                output_template = Path(args[args.index("--output") + 1].replace("%(ext)s", "mkv"))
                output_template.parent.mkdir(parents=True, exist_ok=True)
                output_template.write_bytes(b"verified-video")
                return fake_completed(args)

            with patch.object(download_bilibili, "resolve_tool_state", return_value=create_tool_state()):
                manifest = download_bilibili.download_bilibili(
                    ["BV1WjDDBGE3p"],
                    {
                        "profilePath": str(profile_path),
                        "outDir": str(Path(tmp) / "downloads"),
                        "container": "mkv",
                    },
                    {"runner": runner},
                )

            self.assertEqual(manifest["summary"]["successful"], 1)
            self.assertTrue(any(result["status"] == "success" for result in manifest["results"]))

    def test_download_bilibili_quality_container_and_filename_strategy_flow_into_download_args(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile_path = Path(tmp) / "www.bilibili.com.json"
            profile_path.write_text(json.dumps(create_profile(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            recorded_download_args = []

            def runner(args, **_kwargs):
                if "--dump-single-json" in args:
                    return fake_completed(args, stdout=json.dumps({
                        "id": "BV1WjDDBGE3p",
                        "bvid": "BV1WjDDBGE3p",
                        "title": "Test Video",
                        "uploader": "Tester",
                        "uploader_id": "1202350411",
                        "webpage_url": "https://www.bilibili.com/video/BV1WjDDBGE3p/",
                    }))
                recorded_download_args.append(list(args))
                output_template = Path(args[args.index("--output") + 1].replace("%(ext)s", "mkv"))
                output_template.parent.mkdir(parents=True, exist_ok=True)
                output_template.write_bytes(b"video")
                return fake_completed(args)

            with patch.object(download_bilibili, "resolve_tool_state", return_value=create_tool_state(used_login_state=True)):
                manifest = download_bilibili.download_bilibili(
                    ["BV1WjDDBGE3p"],
                    {
                        "profilePath": str(profile_path),
                        "outDir": str(Path(tmp) / "downloads"),
                        "preferCodec": "av1",
                        "maxHeight": 1080,
                        "container": "mkv",
                        "filenameTemplate": "{bvid}_{title}",
                    },
                    {"runner": runner},
                )

            self.assertEqual(manifest["summary"]["successful"], 1)
            self.assertEqual(len(recorded_download_args), 1)
            download_args = recorded_download_args[0]
            self.assertIn("--merge-output-format", download_args)
            self.assertIn("mkv", download_args)
            self.assertTrue(any("av1" in argument.lower() for argument in download_args))
            self.assertTrue(any("1080" in argument for argument in download_args))
            output_arg = download_args[download_args.index("--output") + 1]
            self.assertIn("BV1WjDDBGE3p", output_arg)
            self.assertIn("test-video", output_arg.lower())

    def test_download_bilibili_uses_profile_quality_defaults_and_records_quality_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile_path = Path(tmp) / "www.bilibili.com.json"
            profile_path.write_text(json.dumps(create_profile(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            recorded_download_args = []

            def runner(args, **_kwargs):
                if "--dump-single-json" in args:
                    return fake_completed(args, stdout=json.dumps({
                        "id": "BV1WjDDBGE3p",
                        "bvid": "BV1WjDDBGE3p",
                        "title": "Unified Policy Video",
                        "uploader": "Tester",
                        "uploader_id": "1202350411",
                        "duration": 95,
                        "webpage_url": "https://www.bilibili.com/video/BV1WjDDBGE3p/",
                        "requested_formats": [
                            {"format_id": "137", "vcodec": "h264", "height": 1080},
                            {"format_id": "140", "acodec": "aac"},
                        ],
                    }))
                recorded_download_args.append(list(args))
                output_template = Path(args[args.index("--output") + 1].replace("%(ext)s", "mp4"))
                output_template.parent.mkdir(parents=True, exist_ok=True)
                output_template.write_bytes(b"video")
                return fake_completed(args)

            with patch.object(download_bilibili, "resolve_tool_state", return_value=create_tool_state(used_login_state=True)):
                manifest = download_bilibili.download_bilibili(
                    ["BV1WjDDBGE3p"],
                    {
                        "profilePath": str(profile_path),
                        "outDir": str(Path(tmp) / "downloads"),
                    },
                    {"runner": runner},
                )

            self.assertEqual(manifest["qualityPolicy"]["targetHeight"], 1080)
            self.assertEqual(manifest["qualityPolicy"]["targetCodec"], "h264")
            self.assertEqual(manifest["qualityPolicy"]["fallbackPolicy"], "preserve-height-then-downgrade-codec")
            result_quality = manifest["results"][0]["quality"]
            self.assertEqual(result_quality["classification"]["pageType"], "video-detail")
            self.assertEqual(result_quality["classification"]["tier"], "short-video")
            self.assertEqual(result_quality["targetHeight"], 1080)
            self.assertEqual(result_quality["targetCodec"], "h264")
            self.assertEqual(result_quality["selectionReason"], "target-met")
            download_args = recorded_download_args[0]
            self.assertTrue(any("1080" in argument for argument in download_args))
            self.assertTrue(any("codec:h264" in argument.lower() for argument in download_args))

    def test_build_quality_summary_prefers_same_height_codec_downgrade_before_height_downgrade(self):
        quality = download_bilibili.build_quality_summary(
            {
                "webpage_url": "https://www.bilibili.com/video/BV1WjDDBGE3p/",
                "duration": 1200,
                "requested_formats": [
                    {"format_id": "999", "vcodec": "hevc", "height": 1080},
                    {"format_id": "140", "acodec": "aac"},
                ],
            },
            settings={
                "codecPreference": "h264",
                "maxHeight": 1080,
                "container": "mp4",
                "fallbackPolicy": "preserve-height-then-downgrade-codec",
            },
            used_login_state=True,
            requires_login_for_highest_quality=True,
        )
        self.assertEqual(quality["classification"]["tier"], "long-video")
        self.assertEqual(quality["selectionReason"], "same-height-codec-downgrade")

    def test_build_quality_summary_reports_height_downgrade_when_1080_is_unavailable(self):
        quality = download_bilibili.build_quality_summary(
            {
                "webpage_url": "https://www.bilibili.com/bangumi/play/ep508404/",
                "requested_formats": [
                    {"format_id": "888", "vcodec": "h264", "height": 720},
                    {"format_id": "140", "acodec": "aac"},
                ],
            },
            settings={
                "codecPreference": "h264",
                "maxHeight": 1080,
                "container": "mp4",
                "fallbackPolicy": "preserve-height-then-downgrade-codec",
            },
            used_login_state=False,
            requires_login_for_highest_quality=True,
        )
        self.assertEqual(quality["classification"]["pageType"], "bangumi-detail")
        self.assertEqual(quality["classification"]["tier"], "long-video")
        self.assertEqual(quality["selectionReason"], "height-downgrade")

    def test_resolve_download_tasks_uses_browser_fallback_for_empty_favorite_list(self):
        settings = download_bilibili.merge_settings({"maxPlaylistItems": 3})
        tool_state = create_tool_state(used_login_state=True)

        def runner(args, **_kwargs):
            if "--flat-playlist" in args:
                return fake_completed(args, stdout=json.dumps({"title": "Favorite List", "entries": []}))
            raise AssertionError(f"Unexpected args: {args}")

        with patch.object(download_bilibili, "run_browser_link_extractor", return_value=[
            {
                "resolvedUrl": "https://www.bilibili.com/video/BV1WjDDBGE3p/",
                "contentId": "BV1WjDDBGE3p",
                "title": "Favorite Result",
            },
        ]):
            plan = download_bilibili.resolve_download_tasks(
                [{
                    "inputKind": "favorite-list",
                    "normalizedUrl": "https://space.bilibili.com/1202350411/favlist?fid=998877",
                    "source": "https://space.bilibili.com/1202350411/favlist?fid=998877",
                }],
                settings,
                create_profile(),
                tool_state,
                runner=runner,
            )

        self.assertEqual(len(plan["tasks"]), 1)
        self.assertEqual(plan["tasks"][0]["resolvedUrl"], "https://www.bilibili.com/video/BV1WjDDBGE3p/")

    def test_resolve_download_tasks_uses_favorite_api_fallback(self):
        settings = download_bilibili.merge_settings({"maxPlaylistItems": 2})
        tool_state = create_tool_state(used_login_state=True)

        def runner(args, **_kwargs):
            if "--flat-playlist" in args:
                raise download_bilibili.DownloadBilibiliError("flat playlist unavailable")
            raise AssertionError(f"Unexpected args: {args}")

        with patch.object(download_bilibili, "fetch_json_url", return_value={
            "code": 0,
            "data": {
                "info": {"title": "默认收藏夹", "media_count": 1},
                "medias": [{"bvid": "BV1WjDDBGE3p", "title": "Favorite API Result"}],
            },
        }), patch.object(download_bilibili, "fetch_page_html", return_value="<html></html>"), patch.object(
            download_bilibili,
            "run_browser_link_extractor",
            return_value=[],
        ):
            plan = download_bilibili.resolve_download_tasks(
                [{
                    "inputKind": "favorite-list",
                    "normalizedUrl": "https://space.bilibili.com/1202350411/favlist?fid=998877",
                    "source": "https://space.bilibili.com/1202350411/favlist?fid=998877",
                }],
                settings,
                create_profile(),
                tool_state,
                runner=runner,
            )

        self.assertEqual(plan["resolvedItems"][0]["title"], "默认收藏夹")
        self.assertEqual(plan["tasks"][0]["resolvedUrl"], "https://www.bilibili.com/video/BV1WjDDBGE3p/")

    def test_resolve_download_tasks_uses_collection_api_fallback(self):
        settings = download_bilibili.merge_settings({"maxPlaylistItems": 2})
        tool_state = create_tool_state(used_login_state=True)

        def runner(args, **_kwargs):
            if "--flat-playlist" in args:
                raise download_bilibili.DownloadBilibiliError("flat playlist unavailable")
            raise AssertionError(f"Unexpected args: {args}")

        fetch_payloads = [
            {"code": -404, "data": None},
            {
                "code": 0,
                "data": {
                    "items_lists": {
                        "page": {"page_num": 1, "page_size": 20, "total": 1},
                        "seasons_list": [{
                            "meta": {"season_id": 556677, "name": "Collection API Result"},
                            "archives": [{"bvid": "BV1uT41147VW", "title": "Collection Video"}],
                        }],
                        "series_list": [],
                    },
                },
            },
        ]

        with patch.object(download_bilibili, "fetch_json_url", side_effect=fetch_payloads), patch.object(
            download_bilibili,
            "fetch_page_html",
            return_value="<html></html>",
        ), patch.object(download_bilibili, "run_browser_link_extractor", return_value=[]):
            plan = download_bilibili.resolve_download_tasks(
                [{
                    "inputKind": "collection-list",
                    "normalizedUrl": "https://space.bilibili.com/1202350411/channel/collectiondetail?sid=556677",
                    "source": "https://space.bilibili.com/1202350411/channel/collectiondetail?sid=556677",
                }],
                settings,
                create_profile(),
                tool_state,
                runner=runner,
            )

        self.assertEqual(plan["resolvedItems"][0]["title"], "Collection API Result")
        self.assertEqual(plan["tasks"][0]["resolvedUrl"], "https://www.bilibili.com/video/BV1uT41147VW/")

    def test_resolve_download_tasks_reports_not_logged_in_diagnostics_for_watch_later(self):
        settings = download_bilibili.merge_settings({"maxPlaylistItems": 2})
        tool_state = create_tool_state(used_login_state=False)

        def runner(args, **_kwargs):
            if "--flat-playlist" in args:
                return fake_completed(args, stdout=json.dumps({"title": "Watch Later", "entries": []}))
            raise AssertionError(f"Unexpected args: {args}")

        with patch.object(download_bilibili, "run_browser_link_extractor", return_value=[]):
            plan = download_bilibili.resolve_download_tasks(
                [{
                    "inputKind": "watch-later-list",
                    "normalizedUrl": "https://www.bilibili.com/watchlater/#/list",
                    "source": "https://www.bilibili.com/watchlater/#/list",
                }],
                settings,
                create_profile(),
                tool_state,
                runner=runner,
            )

        diagnostics = plan["resolvedItems"][0]["diagnostics"]
        self.assertEqual(diagnostics["status"], "empty")
        self.assertEqual(diagnostics["reasonCode"], "not-logged-in")
        self.assertEqual(diagnostics["authRequired"], True)
        self.assertEqual(diagnostics["authAvailable"], False)

    def test_resolve_download_tasks_reports_content_empty_diagnostics_for_empty_favorite(self):
        settings = download_bilibili.merge_settings({"maxPlaylistItems": 2})
        tool_state = create_tool_state(used_login_state=True)

        def runner(args, **_kwargs):
            if "--flat-playlist" in args:
                raise download_bilibili.DownloadBilibiliError("flat playlist unavailable")
            raise AssertionError(f"Unexpected args: {args}")

        with patch.object(download_bilibili, "fetch_json_url", return_value={
            "code": 0,
            "data": {
                "info": {"title": "Empty Favorite", "media_count": 0},
                "medias": [],
            },
        }), patch.object(download_bilibili, "fetch_page_html", return_value="<html></html>"), patch.object(
            download_bilibili,
            "run_browser_link_extractor",
            return_value=[],
        ):
            plan = download_bilibili.resolve_download_tasks(
                [{
                    "inputKind": "favorite-list",
                    "normalizedUrl": "https://space.bilibili.com/1202350411/favlist?fid=998877",
                    "source": "https://space.bilibili.com/1202350411/favlist?fid=998877",
                }],
                settings,
                create_profile(),
                tool_state,
                runner=runner,
            )

        diagnostics = plan["resolvedItems"][0]["diagnostics"]
        self.assertEqual(diagnostics["status"], "empty")
        self.assertEqual(diagnostics["reasonCode"], "content-empty")
        self.assertIn("favorite-api", diagnostics["usedPaths"])

    def test_download_bilibili_parallel_partial_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile_path = Path(tmp) / "www.bilibili.com.json"
            profile_path.write_text(json.dumps(create_profile(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

            def runner(args, **_kwargs):
                if "--dump-single-json" in args:
                    url = args[-1]
                    identifier = "BV1WjDDBGE3p" if "BV1WjDDBGE3p" in url else "BV1uT41147VW"
                    return fake_completed(args, stdout=json.dumps({
                        "id": identifier,
                        "bvid": identifier,
                        "title": f"Title {identifier}",
                        "uploader": "Tester",
                        "uploader_id": "1202350411",
                        "webpage_url": f"https://www.bilibili.com/video/{identifier}/",
                    }))
                url = args[-1]
                if "BV1uT41147VW" in url:
                    raise download_bilibili.DownloadBilibiliError("download blocked")
                output_template = Path(args[args.index("--output") + 1].replace("%(ext)s", "mp4"))
                output_template.parent.mkdir(parents=True, exist_ok=True)
                output_template.write_bytes(b"video")
                return fake_completed(args)

            with patch.object(download_bilibili, "resolve_tool_state", return_value=create_tool_state()):
                manifest = download_bilibili.download_bilibili(
                    ["BV1WjDDBGE3p", "BV1uT41147VW"],
                    {
                        "profilePath": str(profile_path),
                        "outDir": str(Path(tmp) / "downloads"),
                        "concurrency": 2,
                    },
                    {"runner": runner},
                )

            self.assertEqual(manifest["summary"]["successful"], 1)
            self.assertEqual(manifest["summary"]["failed"], 1)


if __name__ == "__main__":
    unittest.main()
