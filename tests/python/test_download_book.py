import importlib.util
import json
import subprocess
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


download_book = load_internal_module(
    "test_download_book_module",
    "src/sites/chapter-content/download/python/book.py",
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
            self.assertEqual(scoped, root / "www.22biqu.com")

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


if __name__ == "__main__":
    unittest.main()
