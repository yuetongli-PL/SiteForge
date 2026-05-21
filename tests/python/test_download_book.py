import importlib.util
import asyncio
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import httpx

def load_internal_module(module_name: str, relative_path: str):
    module_path = Path(__file__).resolve().parents[2] / relative_path
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


download_book = load_internal_module(
    "test_download_book_module",
    "src/sites/known-sites/chapter-content/download/python/book.py",
)


class DownloadBookTests(unittest.TestCase):
    def test_cli_help_is_available_without_pypy_runtime(self):
        completed = subprocess.run(
            [sys.executable, str(Path(download_book.__file__).resolve()), "--help"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("Download a full public novel as pretty TXT.", completed.stdout)
        self.assertIn("--book-title", completed.stdout)

    def test_host_book_content_root_scopes_by_host(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "book-content"
            scoped = download_book.host_book_content_root(root, "www.22biqu.com")
            self.assertEqual(scoped, root.resolve() / "www.22biqu.com")

    def test_load_json_accepts_utf8_bom(self):
        with tempfile.TemporaryDirectory() as tmp:
            payload_path = Path(tmp) / "context.json"
            payload_path.write_text('{"host":"www.22biqu.com"}', encoding="utf-8-sig")

            loaded = download_book.load_json(payload_path)

            self.assertEqual(loaded["host"], "www.22biqu.com")

    def test_resolve_profile_path_ignores_redacted_registry_value(self):
        resolved = download_book.resolve_profile_path("[REDACTED]", "www.bz888888888.com")

        self.assertEqual(
            resolved,
            Path(download_book.REPO_ROOT) / "profiles" / "www.bz888888888.com.json",
        )

    def test_validate_artifact_accepts_full_pretty_txt(self):
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            manifest_path = run_dir / "book-content-manifest.json"
            book_file = run_dir / "books" / "book-1" / "book.json"
            chapters_file = run_dir / "books" / "book-1" / "chapters.json"
            download_file = run_dir / "downloads" / "玄鉴仙族.txt"

            book_file.parent.mkdir(parents=True, exist_ok=True)
            download_file.parent.mkdir(parents=True, exist_ok=True)

            manifest_path.write_text(json.dumps({
                "host": "www.22biqu.com",
                "completeness": "full-book",
                "downloadOrdering": "ascending",
                "formatting": "pretty-txt",
                "summary": {"durationMs": 1234},
                "interpreter": "pypy3",
            }, ensure_ascii=False), encoding="utf-8")
            book_file.write_text(json.dumps({
                "chapterOrder": "ascending",
                "downloadFormat": "pretty-txt",
            }, ensure_ascii=False), encoding="utf-8")
            chapters_file.write_text(json.dumps([
                {"chapterIndex": 1, "title": "第1章 初入"},
                {"chapterIndex": 2, "title": "第2章 进山"},
            ], ensure_ascii=False), encoding="utf-8")
            download_file.write_text("玄鉴仙族\n", encoding="utf-8")

            validated = download_book.validate_artifact({
                "title": "玄鉴仙族",
                "downloadFile": "downloads/玄鉴仙族.txt",
                "bookFile": "books/book-1/book.json",
                "chaptersFile": "books/book-1/chapters.json",
                "finalUrl": "https://www.22biqu.com/biqu5735/",
            }, manifest_path, run_dir)

            self.assertIsNotNone(validated)
            self.assertTrue(validated["isComplete"])

    def test_render_pretty_txt_keeps_chapter_spacing(self):
        rendered = download_book.render_pretty_txt(
            book_title="玄鉴仙族",
            author_name="季越人",
            detail_url="https://www.22biqu.com/biqu5735/",
            chapters=[
                {
                    "title": "第1章 初入",
                    "joinedParagraphs": ["第一段", "第二段"],
                }
            ],
        )
        self.assertIn("玄鉴仙族", rendered)
        self.assertIn("第1章 初入\n\n", rendered)
        self.assertIn("第一段", rendered)
        self.assertIn("第二段", rendered)


    def test_ocr_rejects_access_control_images_before_fetch(self):
        class RejectingClient:
            async def get(self, url):
                raise AssertionError(f"access-control image should not be fetched: {url}")

        async def run_case():
            return await download_book.ocr_image_text(
                RejectingClient(),
                "https://www.bz888888888.com/cdn-cgi/challenge-platform/captcha.png",
                '<img src="/cdn-cgi/challenge-platform/captcha.png" alt="captcha verification">',
                {"enabled": True, "textAttributes": ["alt"]},
            )

        text, source = asyncio.run(run_case())

        self.assertEqual(text, "")
        self.assertEqual(source, "access-control-image")

    def test_ocr_allows_public_chapter_body_attribute_text(self):
        class RejectingClient:
            async def get(self, url):
                raise AssertionError(f"attribute OCR should not fetch image: {url}")

        async def run_case():
            return await download_book.ocr_image_text(
                RejectingClient(),
                "https://www.bz888888888.com/book/123/chapter-body-1.png",
                '<img src="/book/123/chapter-body-1.png" data-ocr-text="public chapter line">',
                {"enabled": True, "textAttributes": ["data-ocr-text", "alt"]},
            )

        text, source = asyncio.run(run_case())

        self.assertEqual(text, "public chapter line")
        self.assertEqual(source, "attribute")

    def test_required_ocr_missing_dependency_uses_stable_reason_code(self):
        class ImageClient:
            async def get(self, url):
                request = httpx.Request("GET", url)
                return httpx.Response(200, request=request, content=b"not-a-real-image")

        async def run_case():
            return await download_book.normalize_paragraphs_with_ocr(
                ImageClient(),
                '<p>before</p><img src="/chapter-body.png">',
                [],
                base_url="https://www.bz888888888.com/book/1/",
                ocr_config={
                    "enabled": True,
                    "required": True,
                    "command": "siteforge-missing-tesseract-for-test",
                    "imageSourceAttributes": ["src"],
                    "textAttributes": [],
                },
            )

        with self.assertRaisesRegex(RuntimeError, r"ocr-dependency-missing"):
            asyncio.run(run_case())

    def test_fetch_html_reports_cloudflare_challenge_reason(self):
        class ChallengeClient:
            async def request(self, method, url, data=None):
                request = httpx.Request(method, url)
                return httpx.Response(
                    403,
                    request=request,
                    headers={
                        "server": "cloudflare",
                        "cf-mitigated": "challenge",
                    },
                    text="<html><title>Just a moment...</title></html>",
                )

        async def run_case():
            return await download_book.fetch_html(
                ChallengeClient(),
                "https://www.bz888888888.com/ss/",
                method="POST",
                data={"searchkey": "玄牝之门"},
            )

        with self.assertRaisesRegex(RuntimeError, r"blocked-by-cloudflare-challenge: HTTP 403"):
            asyncio.run(run_case())

    def test_resolve_book_target_uses_profile_search_candidates(self):
        class SearchClient:
            def __init__(self):
                self.requests = []

            async def request(self, method, url, data=None):
                self.requests.append({"method": method, "url": url, "data": data})
                request = httpx.Request(method, url)
                return httpx.Response(
                    200,
                    request=request,
                    text='<html><body><a href="/book/123/">玄牝之门</a></body></html>',
                )

        async def run_case():
            client = SearchClient()
            resolved = await download_book.resolve_book_target(
                client,
                {
                    "baseUrl": "https://www.bz888888888.com/",
                    "profile": {
                        "search": {
                            "knownQueries": [],
                            "requestCandidates": [{
                                "method": "GET",
                                "path": "/custom-search/",
                                "query": {"searchkey": "{query}"},
                            }],
                            "resultBookSelectors": ["a[href]"],
                            "resultTitleSelectors": ["title"],
                        },
                        "bookDetail": {
                            "bookUrlPatterns": ["/book/\\d+/?$"],
                        },
                    },
                },
                "玄牝之门",
                None,
            )
            return client.requests, resolved

        requests, resolved = asyncio.run(run_case())

        self.assertEqual(requests[0]["method"], "GET")
        self.assertIn("/custom-search/?searchkey=", requests[0]["url"])
        self.assertNotIn("/ss/", requests[0]["url"])
        self.assertEqual(resolved["bookUrl"], "https://www.bz888888888.com/book/123/")
        self.assertEqual(resolved["mode"], "search")

    def test_run_generated_crawler_preserves_stable_block_reason(self):
        with tempfile.TemporaryDirectory() as tmp:
            crawler_script = Path(tmp) / "crawler.py"
            crawler_script.write_text(
                "import sys\n"
                "sys.stderr.write('blocked-by-cloudflare-challenge: HTTP 403 at https://example.test/ss/\\n')\n"
                "raise SystemExit(1)\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(RuntimeError, r"blocked-by-cloudflare-challenge: HTTP 403"):
                download_book.run_generated_crawler(
                    crawler_script=crawler_script,
                    book_title="玄牝之门",
                    book_url=None,
                    out_dir=Path(tmp),
                )


if __name__ == "__main__":
    unittest.main()
