import importlib.util
import json
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


bz888 = load_internal_module(
    "test_bz888_download_module",
    "src/sites/known-sites/bz888/download/python/bz888.py",
)


class Bz888DownloadTests(unittest.TestCase):
    def test_decode_html_defaults_to_gbk_compatible_text(self):
        payload = "玄牝之门".encode("gbk")

        decoded = bz888.decode_html(payload, "")

        self.assertEqual(decoded, "玄牝之门")

    def test_challenge_response_is_detected(self):
        request = httpx.Request("GET", "https://www.bz888888888.com/")
        response = httpx.Response(
            403,
            request=request,
            headers={
                "server": "cloudflare",
                "cf-mitigated": "challenge",
            },
            text="<html><title>Just a moment...</title></html>",
        )

        self.assertTrue(bz888.response_is_cloudflare_challenge(response))

    def test_fixture_download_writes_txt_manifest_and_chapters(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fixture_dir = root / "fixtures"
            out_dir = root / "out"
            fixture_dir.mkdir()
            (fixture_dir / "52_52885.html").write_text(
                """
                <html><head><title>玄牝之门最新章节_SSXXZZYY新书作品_123小说网</title></head>
                <body>
                  <a href="/52/52885/10124.html">玄牝之门（02）</a>
                  <a href="/52/52885/10123.html">从头开始阅读</a>
                </body></html>
                """,
                encoding="utf-8",
            )
            (fixture_dir / "52_52885_10123.html").write_text(
                """
                <html><body>
                  <h1>玄牝之门（01）</h1>
                  <div id="content">第一章<br>长安城的雪已经下了三天。</div>
                </body></html>
                """,
                encoding="utf-8",
            )
            (fixture_dir / "52_52885_10124.html").write_text(
                """
                <html><body>
                  <h1>玄牝之门（02）</h1>
                  <div id="content">第二章<br>龙气在夜色里散尽。</div>
                </body></html>
                """,
                encoding="utf-8",
            )

            exit_code = bz888.main([
                "--book-url",
                "https://www.bz888888888.com/52/52885/",
                "--fixture-dir",
                str(fixture_dir),
                "--out-dir",
                str(out_dir),
                "--max-pages",
                "2",
            ])

            self.assertEqual(exit_code, 0)
            manifest_path = next(out_dir.glob("*/manifest.json"))
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            txt_path = Path(manifest["downloadFile"])
            chapters_path = Path(manifest["chaptersFile"])
            self.assertTrue(txt_path.exists())
            self.assertTrue(chapters_path.exists())
            self.assertEqual(manifest["chapterCount"], 2)
            self.assertEqual(manifest["cookieMode"], "none")
            self.assertIn("长安城的雪已经下了三天", txt_path.read_text(encoding="utf-8"))
            chapters = json.loads(chapters_path.read_text(encoding="utf-8"))
            self.assertEqual([item["chapterIndex"] for item in chapters], [1, 2])

    def test_html_dir_import_accepts_arbitrary_saved_file_names(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            html_dir = root / "saved-pages"
            out_dir = root / "out"
            html_dir.mkdir()
            (html_dir / "catalog saved from browser.html").write_text(
                """
                <html><head><title>Demo Book latest chapters</title></head>
                <body>
                  <a href="/52/52885/10124.html">Demo Book (02)</a>
                  <a href="/52/52885/10123.html">Read from beginning</a>
                </body></html>
                """,
                encoding="utf-8",
            )
            (html_dir / "saved first chapter page.html").write_text(
                """
                <html><head><title>Demo Book (01)-123</title></head><body>
                  <h1>Demo Book (01)</h1>
                  <div id="content">Chapter one<br>first body line</div>
                </body></html>
                """,
                encoding="utf-8",
            )
            (html_dir / "saved second chapter page.html").write_text(
                """
                <html><head><title>Demo Book (02)-123</title></head><body>
                  <h1>Demo Book (02)</h1>
                  <div id="content">Chapter two<br>second body line</div>
                </body></html>
                """,
                encoding="utf-8",
            )

            exit_code = bz888.main([
                "--book-url",
                "https://www.bz888888888.com/52/52885/",
                "--html-dir",
                str(html_dir),
                "--out-dir",
                str(out_dir),
            ])

            self.assertEqual(exit_code, 0)
            manifest = json.loads(next(out_dir.glob("*/manifest.json")).read_text(encoding="utf-8"))
            txt = Path(manifest["downloadFile"]).read_text(encoding="utf-8")
            chapters = json.loads(Path(manifest["chaptersFile"]).read_text(encoding="utf-8"))
            self.assertEqual(manifest["chapterCount"], 2)
            self.assertIn("first body line", txt)
            self.assertIn("second body line", txt)
            self.assertEqual([item["chapterIndex"] for item in chapters], [1, 2])


if __name__ == "__main__":
    unittest.main()
