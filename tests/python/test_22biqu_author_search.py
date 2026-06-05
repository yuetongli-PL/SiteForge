from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

import anyio


REPO_ROOT = Path(__file__).resolve().parents[2]
AUTHOR_MODULE_PATH = REPO_ROOT / "src" / "sites" / "known-sites" / "chapter-content" / "download" / "python" / "author.py"
AUTHOR_MODULE_DIR = AUTHOR_MODULE_PATH.parent

if str(AUTHOR_MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(AUTHOR_MODULE_DIR))

spec = importlib.util.spec_from_file_location("author_executor", AUTHOR_MODULE_PATH)
author_executor = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(author_executor)


class AuthorSearchExecutorTest(unittest.TestCase):
    def test_author_search_posts_author_name_and_counts_exact_author_matches(self) -> None:
        calls: list[dict[str, object]] = []

        def fake_search_request_candidates(search_cfg, base_url, query_text):
            self.assertEqual(query_text, "唐家三少")
            return [{
                "method": "POST",
                "url": "https://www.22biqu.com/ss/",
                "data": {"searchkey": query_text},
            }]

        async def fake_fetch_html(client, url, *, method="GET", data=None):
            calls.append({"url": url, "method": method, "data": data})
            if url == "https://www.22biqu.com/ss/":
                self.assertEqual(method, "POST")
                self.assertEqual(data, {"searchkey": "唐家三少"})
                return "<html>search</html>", url
            return "<html>detail</html>", url

        def fake_parse_search_results(html_text, final_url, profile):
            self.assertEqual(final_url, "https://www.22biqu.com/ss/")
            return {
                "queryText": "唐家三少",
                "resultCount": 4,
                "results": [
                    {"title": "斗罗大陆", "url": "https://www.22biqu.com/biqu1/", "authorName": "唐家三少"},
                    {"title": "斗罗大陆", "url": "https://www.22biqu.com/biqu1/", "authorName": "唐家三少"},
                    {"title": "神印王座II皓月当空", "url": "https://www.22biqu.com/biqu3992/", "authorName": "唐家三少"},
                    {"title": "误匹配", "url": "https://www.22biqu.com/biqu9999/", "authorName": "不是唐家三少"},
                ],
                "searchUrl": final_url,
            }

        def fake_parse_book_detail(html_text, final_url, profile):
            if final_url.endswith("/biqu9999/"):
                return {
                    "finalUrl": final_url,
                    "bookTitle": "误匹配",
                    "title": "误匹配",
                    "authorName": "其他作者",
                    "authorUrl": None,
                    "latestChapterName": "",
                    "latestChapterUrl": None,
                    "updateTime": "",
                    "chapterCount": 0,
                }
            title = "斗罗大陆" if final_url.endswith("/biqu1/") else "神印王座II皓月当空"
            return {
                "finalUrl": final_url,
                "bookTitle": title,
                "title": title,
                "authorName": "唐家三少",
                "authorUrl": None,
                "latestChapterName": "最新章节",
                "latestChapterUrl": final_url + "1.html",
                "updateTime": "2026-06-05 00:00:00",
                "chapterCount": 10,
            }

        original_search_request_candidates = author_executor.search_request_candidates
        original_fetch_html = author_executor.fetch_html
        original_parse_search_results = author_executor.parse_search_results
        original_parse_book_detail = author_executor.parse_book_detail
        try:
            author_executor.search_request_candidates = fake_search_request_candidates
            author_executor.fetch_html = fake_fetch_html
            author_executor.parse_search_results = fake_parse_search_results
            author_executor.parse_book_detail = fake_parse_book_detail

            result = anyio.run(
                author_executor.fetch_author_works_with_context,
                {
                    "host": "www.22biqu.com",
                    "baseUrl": "https://www.22biqu.com/",
                    "profile": {"search": {}, "bookDetail": {}},
                },
                author_name="唐家三少",
                client=object(),
            )
        finally:
            author_executor.search_request_candidates = original_search_request_candidates
            author_executor.fetch_html = original_fetch_html
            author_executor.parse_search_results = original_parse_search_results
            author_executor.parse_book_detail = original_parse_book_detail

        self.assertEqual(calls[0], {
            "url": "https://www.22biqu.com/ss/",
            "method": "POST",
            "data": {"searchkey": "唐家三少"},
        })
        self.assertEqual(result["source"], "site-search-author-name")
        self.assertEqual(result["matchedWorkCount"], 2)
        self.assertEqual([item["title"] for item in result["matchedWorks"]], ["斗罗大陆", "神印王座II皓月当空"])
        self.assertEqual(result["candidateCount"], 4)
        self.assertEqual(len(result["unverifiedCandidates"]), 1)
        self.assertFalse(result["chapterBodyPersisted"])
        self.assertEqual(result["searchAttempts"][0]["submittedFieldNames"], ["searchkey"])


if __name__ == "__main__":
    unittest.main()
