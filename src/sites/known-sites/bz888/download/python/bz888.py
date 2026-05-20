#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import asyncio
import hashlib
import html
import json
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus, urljoin, urlparse

import httpx
from selectolax.parser import HTMLParser


HOST = "www.bz888888888.com"
BASE_URL = f"https://{HOST}/"
DEFAULT_HEADERS = {
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
    ),
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
}


@dataclass(frozen=True)
class ChapterLink:
    title: str
    href: str


@dataclass(frozen=True)
class FixtureDocument:
    path: Path
    html_text: str
    title: str
    url_hint: str


def normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def safe_filename(value: Any, fallback: str = "bz888-book") -> str:
    text = normalize_text(value)
    text = re.sub(r'[<>:"/\\|?*]+', "_", text).strip(" .")
    return text or fallback


def sha256_text(value: Any) -> str:
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()


def normalize_match_text(value: Any) -> str:
    return re.sub(r"\s+", "", normalize_text(value)).lower()


def is_bz888_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and parsed.netloc.lower() == HOST


def ensure_bz888_url(value: str) -> str:
    url = urljoin(BASE_URL, value)
    if not is_bz888_url(url):
        raise ValueError(f"unsupported-bz888-url: {value}")
    return url


def response_is_cloudflare_challenge(response: httpx.Response) -> bool:
    headers = {key.lower(): value.lower() for key, value in response.headers.items()}
    body = response.text[:4096].lower()
    evidence = " ".join([
        str(response.url).lower(),
        headers.get("server", ""),
        headers.get("cf-mitigated", ""),
        headers.get("cf-ray", ""),
        body,
    ])
    has_cloudflare = any(token in evidence for token in [
        "cloudflare",
        "cf-mitigated",
        "cf-ray",
        "/cdn-cgi/challenge-platform",
        "challenge-platform",
    ])
    has_challenge = any(token in evidence for token in [
        "challenge",
        "captcha",
        "just a moment",
        "checking your browser",
        "attention required",
    ])
    return (
        headers.get("cf-mitigated") == "challenge"
        or "/cdn-cgi/challenge-platform" in evidence
        or (response.status_code in {403, 429, 503} and has_cloudflare and has_challenge)
    )


def decode_html(content: bytes, content_type: str = "") -> str:
    header_match = re.search(r"charset=([a-zA-Z0-9_-]+)", content_type or "", re.IGNORECASE)
    raw_sample = content[:4096].decode("ascii", errors="ignore")
    meta_match = re.search(r"charset=['\"]?([a-zA-Z0-9_-]+)", raw_sample, re.IGNORECASE)
    candidates = [
        header_match.group(1) if header_match else "",
        meta_match.group(1) if meta_match else "",
        "gb18030",
        "gbk",
        "utf-8",
    ]
    seen: set[str] = set()
    for encoding in candidates:
        normalized = encoding.lower().strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        try:
            return content.decode(normalized)
        except UnicodeDecodeError:
            continue
        except LookupError:
            continue
    return content.decode("utf-8", errors="replace")


def read_local_html(path: Path) -> str:
    return decode_html(path.read_bytes())


async def fetch_public_html(client: httpx.AsyncClient, url: str) -> tuple[str, str]:
    final_url = ensure_bz888_url(url)
    response = await client.get(final_url)
    if response_is_cloudflare_challenge(response):
        raise RuntimeError(f"blocked-by-cloudflare-challenge: HTTP {response.status_code} at {final_url}")
    response.raise_for_status()
    html_text = decode_html(response.content, response.headers.get("content-type", ""))
    return html_text, str(response.url)


def fixture_name_candidates(fixture_dir: Path, url: str) -> list[Path]:
    parsed = urlparse(ensure_bz888_url(url))
    path = parsed.path.strip("/") or "index"
    if path.endswith("/"):
        path = f"{path.rstrip('/')}/index"
    fixture_name = re.sub(r"[^a-zA-Z0-9._-]+", "_", path)
    candidates = [fixture_dir / fixture_name] if fixture_name.endswith(".html") else []
    candidates.extend([
        fixture_dir / f"{fixture_name}.html",
        fixture_dir / f"{sha256_text(url)[:16]}.html",
    ])
    return candidates


def iter_fixture_documents(fixture_dir: Path) -> list[FixtureDocument]:
    documents: list[FixtureDocument] = []
    for path in sorted(fixture_dir.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in {".html", ".htm"}:
            continue
        html_text = read_local_html(path)
        document = HTMLParser(html_text)
        title = ""
        title_node = document.css_first("title")
        if title_node:
            title = normalize_text(title_node.text(separator=" ", strip=True))
        documents.append(FixtureDocument(
            path=path,
            html_text=html_text,
            title=title,
            url_hint=path.as_uri(),
        ))
    return documents


def read_fixture_html(fixture_dir: Path, url: str) -> tuple[str, str]:
    candidates = fixture_name_candidates(fixture_dir, url)
    for candidate in candidates:
        if candidate.exists():
            return read_local_html(candidate), url
    normalized_url = ensure_bz888_url(url)
    for document in iter_fixture_documents(fixture_dir):
        if normalized_url in document.html_text:
            return document.html_text, normalized_url
    raise FileNotFoundError(f"fixture-not-found: {url}")


async def load_html(client: httpx.AsyncClient | None, url: str, fixture_dir: Path | None = None) -> tuple[str, str]:
    if fixture_dir:
        return read_fixture_html(fixture_dir, url)
    if client is None:
        raise RuntimeError("internal-error: missing http client")
    return await fetch_public_html(client, url)


def parse_book_title(document: HTMLParser, fallback: str) -> str:
    for selector in ["h1", ".book-title", ".title", "title"]:
        node = document.css_first(selector)
        if not node:
            continue
        text = normalize_text(node.text(separator=" ", strip=True))
        if text:
            return re.sub(r"(最新章节|章节目录|_.*$|-.*$)", "", text).strip() or text
    return fallback


def parse_directory_links(html_text: str, page_url: str, book_path_prefix: str) -> list[ChapterLink]:
    document = HTMLParser(html_text)
    links: list[ChapterLink] = []
    seen: set[str] = set()
    pattern = re.compile(rf"^{re.escape(book_path_prefix)}/\d+\.html$", re.IGNORECASE)
    for node in document.css("a[href]"):
        href = ensure_bz888_url(urljoin(page_url, node.attributes.get("href", "")))
        path = urlparse(href).path.rstrip("/")
        if not pattern.match(path):
            continue
        title = normalize_text(node.text(separator=" ", strip=True))
        if not title:
            title = Path(path).stem
        if href in seen:
            continue
        seen.add(href)
        links.append(ChapterLink(title=title, href=href))
    return links


def chapter_sort_key(chapter: ChapterLink) -> tuple[int, str]:
    match = re.search(r"/(\d+)\.html$", urlparse(chapter.href).path)
    return (int(match.group(1)) if match else 0, chapter.title)


def collect_directory_from_fixtures(fixture_dir: Path, book_url: str) -> tuple[str, list[ChapterLink]]:
    detail_url = ensure_bz888_url(book_url).rstrip("/") + "/"
    book_path_prefix = urlparse(detail_url).path.rstrip("/")
    collected: list[ChapterLink] = []
    seen: set[str] = set()
    best_title = book_path_prefix.rsplit("/", 1)[-1]
    best_count = 0
    for document in iter_fixture_documents(fixture_dir):
        links = parse_directory_links(document.html_text, detail_url, book_path_prefix)
        if len(links) > best_count:
            best_count = len(links)
            best_title = parse_book_title(HTMLParser(document.html_text), fallback=best_title)
        for link in links:
            if link.href in seen:
                continue
            seen.add(link.href)
            collected.append(link)
    collected.sort(key=chapter_sort_key)
    if not collected:
        raise RuntimeError(f"chapter-index-empty: {detail_url}")
    return best_title, collected


async def collect_directory(
    client: httpx.AsyncClient | None,
    book_url: str,
    *,
    fixture_dir: Path | None = None,
    max_pages: int = 8,
) -> tuple[str, list[ChapterLink]]:
    detail_url = ensure_bz888_url(book_url).rstrip("/") + "/"
    parsed = urlparse(detail_url)
    book_path_prefix = parsed.path.rstrip("/")
    if not re.match(r"^/\d+/\d+$", book_path_prefix):
        raise ValueError(f"unsupported-bz888-book-url: {book_url}")
    if fixture_dir:
        return collect_directory_from_fixtures(fixture_dir, detail_url)

    first_html, first_final_url = await load_html(client, detail_url, fixture_dir)
    title = parse_book_title(HTMLParser(first_html), fallback=book_path_prefix.rsplit("/", 1)[-1])
    collected: list[ChapterLink] = []
    seen: set[str] = set()

    for page_index in range(1, max_pages + 1):
        if page_index == 1:
            page_html = first_html
            page_url = first_final_url
        else:
            page_url = f"{detail_url.rstrip('/')}_{page_index}/"
            try:
                page_html, page_url = await load_html(client, page_url, fixture_dir)
            except FileNotFoundError:
                break
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404:
                    break
                raise
        page_links = parse_directory_links(page_html, page_url, book_path_prefix)
        new_links = [item for item in page_links if item.href not in seen]
        for item in new_links:
            seen.add(item.href)
            collected.append(item)
        if page_index > 1 and not new_links:
            break

    collected.sort(key=chapter_sort_key)
    if not collected:
        raise RuntimeError(f"chapter-index-empty: {detail_url}")
    return title, collected


def extract_chapter_body(html_text: str, page_url: str) -> tuple[str, list[str]]:
    document = HTMLParser(html_text)
    title = ""
    for selector in ["h1", ".chapter-title", ".title", "title"]:
        node = document.css_first(selector)
        if node:
            title = normalize_text(node.text(separator=" ", strip=True))
            if title:
                break
    for selector in ["#ChapterView .page-content", "#ChapterView .bd", "#content", ".content", ".chapter-content", "article"]:
        node = document.css_first(selector)
        if not node:
            continue
        raw_html = node.html or ""
        raw_html = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", raw_html)
        raw_html = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", raw_html)
        raw_html = re.sub(r"(?i)<br\s*/?>", "\n", raw_html)
        raw_html = re.sub(r"(?i)</p\s*>", "\n", raw_html)
        raw_html = re.sub(r"(?i)</div\s*>", "\n", raw_html)
        raw_html = re.sub(r"(?is)<[^>]+>", " ", raw_html)
        text = html.unescape(raw_html)
        paragraphs = [
            normalize_text(line)
            for line in re.split(r"[\r\n]+", text)
            if normalize_text(line)
        ]
        if paragraphs:
            return title or page_url, paragraphs
    raise RuntimeError(f"chapter-content-empty: {page_url}")


def extract_chapter_number(value: Any) -> int | None:
    text = normalize_text(value)
    match = re.search(r"[（(]\s*0*(\d+)\s*[）)]", text)
    if not match:
        match = re.search(r"(?:第|chapter\s*)0*(\d+)", text, re.IGNORECASE)
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def chapter_fixture_entries(fixture_dir: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for document in iter_fixture_documents(fixture_dir):
        try:
            title, paragraphs = extract_chapter_body(document.html_text, document.url_hint)
        except RuntimeError:
            continue
        entries.append({
            "path": document.path,
            "htmlText": document.html_text,
            "title": title,
            "titleKey": normalize_match_text(title),
            "number": extract_chapter_number(title),
            "paragraphs": paragraphs,
        })
    return entries


def fetch_chapters_from_fixture_dir(
    chapters: list[ChapterLink],
    fixture_dir: Path,
) -> list[dict[str, Any]]:
    entries = chapter_fixture_entries(fixture_dir)
    used_paths: set[Path] = set()
    results: list[dict[str, Any]] = []
    for index, chapter in enumerate(chapters, start=1):
        selected: dict[str, Any] | None = None
        try:
            html_text, final_url = read_fixture_html(fixture_dir, chapter.href)
            page_title, paragraphs = extract_chapter_body(html_text, final_url)
            selected = {
                "path": Path(final_url) if final_url.startswith("file:") else Path(),
                "title": page_title,
                "paragraphs": paragraphs,
                "finalUrl": chapter.href,
            }
        except (FileNotFoundError, RuntimeError, ValueError):
            selected = None
        chapter_title_key = normalize_match_text(chapter.title)
        if selected is None and chapter_title_key:
            for entry in entries:
                if entry["path"] in used_paths:
                    continue
                if chapter_title_key and (chapter_title_key in entry["titleKey"] or entry["titleKey"] in chapter_title_key):
                    selected = {**entry, "finalUrl": entry["urlHint"] if "urlHint" in entry else str(entry["path"])}
                    break
        if selected is None:
            for entry in entries:
                if entry["path"] in used_paths:
                    continue
                if entry["number"] == index:
                    selected = {**entry, "finalUrl": str(entry["path"])}
                    break
        if selected is None:
            raise RuntimeError(f"chapter-fixture-not-found: index={index} url={chapter.href} title={chapter.title}")
        selected_path = selected.get("path")
        if isinstance(selected_path, Path):
            used_paths.add(selected_path)
        paragraphs = list(selected["paragraphs"])
        results.append({
            "title": chapter.title if chapter.title and chapter.title not in {"从头开始阅读"} else selected["title"],
            "href": chapter.href,
            "finalUrl": selected.get("finalUrl") or chapter.href,
            "paragraphs": paragraphs,
            "bodyTextLength": sum(len(item) for item in paragraphs),
        })
    return results


async def fetch_chapter(
    client: httpx.AsyncClient | None,
    chapter: ChapterLink,
    *,
    fixture_dir: Path | None = None,
) -> dict[str, Any]:
    html_text, final_url = await load_html(client, chapter.href, fixture_dir)
    page_title, paragraphs = extract_chapter_body(html_text, final_url)
    return {
        "title": chapter.title or page_title,
        "href": chapter.href,
        "finalUrl": final_url,
        "paragraphs": paragraphs,
        "bodyTextLength": sum(len(item) for item in paragraphs),
    }


async def download_book(args: argparse.Namespace) -> dict[str, Any]:
    if not args.book_url and not args.book_title:
        raise SystemExit("Missing --book-url or --book-title")
    fixture_dir = Path(args.fixture_dir).resolve() if args.fixture_dir else None
    out_root = Path(args.out_dir or "book-content").resolve()
    out_root.mkdir(parents=True, exist_ok=True)

    limits = httpx.Limits(max_connections=max(1, args.concurrency), max_keepalive_connections=max(1, args.concurrency))
    timeout = httpx.Timeout(args.timeout, connect=args.timeout)
    async with httpx.AsyncClient(
        headers=DEFAULT_HEADERS,
        follow_redirects=True,
        timeout=timeout,
        limits=limits,
        trust_env=False,
    ) as client:
        active_client = None if fixture_dir else client
        book_url = args.book_url
        if not book_url:
            book_url = await resolve_book_url_by_title(active_client, args.book_title, fixture_dir=fixture_dir)
        title, chapters = await collect_directory(
            active_client,
            book_url,
            fixture_dir=fixture_dir,
            max_pages=args.max_pages,
        )
        if args.metadata_only:
            return {
                "host": HOST,
                "mode": "metadata-only",
                "bookTitle": title,
                "bookUrl": ensure_bz888_url(book_url),
                "chapterCount": len(chapters),
                "firstChapter": chapters[0].href,
                "lastChapter": chapters[-1].href,
            }

        if fixture_dir:
            chapter_results = fetch_chapters_from_fixture_dir(chapters, fixture_dir)
        else:
            semaphore = asyncio.Semaphore(max(1, args.concurrency))

            async def guarded_fetch(chapter: ChapterLink) -> dict[str, Any]:
                async with semaphore:
                    return await fetch_chapter(active_client, chapter, fixture_dir=fixture_dir)

            chapter_results = await asyncio.gather(*(guarded_fetch(chapter) for chapter in chapters))

    run_id = f"{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}_bz888_{sha256_text(book_url)[:10]}"
    run_dir = out_root / run_id
    downloads_dir = run_dir / "downloads"
    downloads_dir.mkdir(parents=True, exist_ok=True)
    txt_path = downloads_dir / f"{safe_filename(title)}.txt"
    manifest_path = run_dir / "manifest.json"
    chapters_path = run_dir / "chapters.json"

    txt_lines = [title, f"Source: {ensure_bz888_url(book_url)}", ""]
    for index, chapter in enumerate(chapter_results, start=1):
        txt_lines.extend([
            chapter["title"],
            "",
            *[f"  {paragraph}" for paragraph in chapter["paragraphs"]],
            "",
        ])
        chapter["chapterIndex"] = index

    txt_path.write_text("\n".join(txt_lines).rstrip() + "\n", encoding="utf-8")
    chapters_path.write_text(json.dumps(chapter_results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    manifest = {
        "host": HOST,
        "mode": "bz888-public-direct",
        "bookTitle": title,
        "bookUrl": ensure_bz888_url(book_url),
        "chapterCount": len(chapter_results),
        "downloadFile": str(txt_path),
        "chaptersFile": str(chapters_path),
        "blockedByChallenge": False,
        "cookieMode": "none",
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {**manifest, "manifestPath": str(manifest_path), "isComplete": True}


async def resolve_book_url_by_title(
    client: httpx.AsyncClient | None,
    book_title: str,
    *,
    fixture_dir: Path | None,
) -> str:
    query_url = f"{BASE_URL}ss/?searchkey={quote_plus(book_title)}"
    html_text, final_url = await load_html(client, query_url, fixture_dir)
    document = HTMLParser(html_text)
    for node in document.css("a[href]"):
        href = ensure_bz888_url(urljoin(final_url, node.attributes.get("href", "")))
        path = urlparse(href).path.rstrip("/")
        if re.match(r"^/\d+/\d+$", path):
            text = normalize_text(node.text(separator=" ", strip=True))
            if not text or book_title in text or text in book_title:
                return href
    raise RuntimeError(f"book-not-found: {book_title}")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "BZ888-only public HTML downloader. It does not read browser cookies, "
            "does not use downloader SessionView, and stops on Cloudflare challenge."
        )
    )
    parser.add_argument("--book-url")
    parser.add_argument("--book-title")
    parser.add_argument("--out-dir", default="book-content")
    parser.add_argument("--fixture-dir", "--html-dir", dest="fixture_dir")
    parser.add_argument("--metadata-only", action="store_true")
    parser.add_argument("--max-pages", type=int, default=8)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--timeout", type=float, default=15.0)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        result = asyncio.run(download_book(args))
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"{exc}\n")
        return 1
    sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
