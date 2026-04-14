#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata
from functools import partial
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse, urlunparse

import anyio
import httpx
from selectolax.parser import HTMLParser
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


TARGET_SLA_MS = 10_000
REPO_ROOT = Path(__file__).resolve().parent
FULLWIDTH_INDENT = "　　"
DEFAULT_CHAPTER_CONCURRENCY = 64
DEFAULT_MAX_CONNECTIONS = 128
DEFAULT_MAX_KEEPALIVE_CONNECTIONS = 96
DEFAULT_HEADERS = {
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
    ),
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
}


def normalize_whitespace(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_text(value: Any) -> str:
    return normalize_whitespace(unicodedata.normalize("NFKC", str(value or "")))


def normalize_url_no_fragment(value: Any) -> str | None:
    if not value:
        return None
    raw = str(value)
    try:
        parsed = urlparse(raw)
        return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, parsed.query, ""))
    except Exception:
        return raw.split("#", 1)[0]


def sanitize_host(host: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9.-]+", "-", host or "unknown-host")
    cleaned = re.sub(r"-+", "-", cleaned).strip("-")
    return cleaned or "unknown-host"


def slugify_ascii(value: Any, fallback: str = "item") -> str:
    normalized = unicodedata.normalize("NFKD", normalize_text(value))
    normalized = normalized.encode("ascii", "ignore").decode("ascii")
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", normalized)
    normalized = re.sub(r"-+", "-", normalized).strip("-").lower()
    return normalized or fallback


def safe_filename(value: Any, fallback: str = "download") -> str:
    text = normalize_text(value)
    text = re.sub(r'[<>:"/\\|?*]+', "_", text)
    text = text.strip(" .")
    return text or fallback


def sha256_text(value: Any) -> str:
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()


def to_relative_posix(base_dir: Path, target_path: Path) -> str:
    return str(target_path.relative_to(base_dir)).replace("\\", "/")


def load_json(path_value: str | Path) -> Any:
    return json.loads(Path(path_value).read_text(encoding="utf-8"))


def write_json(path_value: str | Path, payload: Any) -> None:
    path_obj = Path(path_value)
    path_obj.parent.mkdir(parents=True, exist_ok=True)
    path_obj.write_text(f"{json.dumps(payload, ensure_ascii=False, indent=2)}\n", encoding="utf-8")


def write_text(path_value: str | Path, payload: str) -> None:
    path_obj = Path(path_value)
    path_obj.parent.mkdir(parents=True, exist_ok=True)
    path_obj.write_text(payload.rstrip() + "\n", encoding="utf-8")


def append_text(path_value: str | Path, payload: str) -> None:
    path_obj = Path(path_value)
    path_obj.parent.mkdir(parents=True, exist_ok=True)
    with path_obj.open("a", encoding="utf-8") as handle:
        handle.write(payload)


def progress_log(message: str) -> None:
    sys.stderr.write(f"{message}\n")
    sys.stderr.flush()


def init_console_utf8() -> None:
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    os.environ.setdefault("PYTHONUTF8", "1")
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def child_utf8_env() -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("PYTHONIOENCODING", "utf-8")
    env.setdefault("PYTHONUTF8", "1")
    return env


def path_exists(path_value: str | Path) -> bool:
    return Path(path_value).exists()


def current_run_id(host: str) -> str:
    timestamp = time.strftime("%Y%m%dT%H%M%S", time.gmtime())
    milliseconds = f"{int((time.time() % 1) * 1000):03d}Z"
    return f"{timestamp}{milliseconds}_{sanitize_host(host)}_book-content"


def host_book_content_root(root: Path, host: str) -> Path:
    resolved = root.resolve()
    host_slug = sanitize_host(host)
    if resolved.name == host_slug:
        return resolved
    return resolved / host_slug


def titles_match(left: Any, right: Any) -> bool:
    a = normalize_text(left)
    b = normalize_text(right)
    if not a or not b:
        return False
    return a == b or a in b or b in a


def candidate_query_texts(book_title: str) -> list[str]:
    normalized = normalize_text(book_title)
    localized = normalized.translate(str.maketrans({
        "?": "？",
        "!": "！",
        ",": "，",
        ":": "：",
        ";": "；",
        "(": "（",
        ")": "）",
    }))
    candidates: list[str] = []
    for value in [
        normalized,
        localized,
        re.sub(r"[?？!！。．…]+$", "", normalized).strip(),
        re.sub(r"[?？!！。．…]+$", "", localized).strip(),
    ]:
        if value and value not in candidates:
            candidates.append(value)
    return candidates


def chapter_base_url(chapter_url: str | None) -> str | None:
    normalized = normalize_url_no_fragment(chapter_url)
    if not normalized:
        return None
    return re.sub(r"_(\d+)(\.html)$", r"\2", normalized, flags=re.IGNORECASE)


def is_same_chapter_chain(left: str | None, right: str | None) -> bool:
    left_base = chapter_base_url(left)
    right_base = chapter_base_url(right)
    return bool(left_base and right_base and left_base == right_base)


def compile_cleanup_patterns(raw_patterns: list[Any]) -> list[re.Pattern[str]]:
    patterns: list[re.Pattern[str]] = []
    for raw in raw_patterns:
        text = normalize_text(raw)
        if not text:
            continue
        patterns.append(re.compile(re.escape(text), re.IGNORECASE))
    return patterns


def first_css_text(document: HTMLParser, selectors: list[str]) -> str | None:
    for selector in selectors:
        node = document.css_first(selector)
        if not node:
            continue
        text = normalize_text(node.text(separator=" ", strip=True))
        if text:
            return text
    return None


def meta_content(document: HTMLParser, names: list[str]) -> str | None:
    for name in names:
        candidates = [
            f'meta[property="{name}"]',
            f'meta[name="{name}"]',
        ]
        for selector in candidates:
            node = document.css_first(selector)
            if not node:
                continue
            content = normalize_text(node.attributes.get("content"))
            if content:
                return content
    return None


def meta_link(document: HTMLParser, names: list[str], base_url: str) -> str | None:
    value = meta_content(document, names)
    return normalize_url_no_fragment(urljoin(base_url, value)) if value else None


def unique_by_key(items: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        value = str(item.get(key) or "")
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(item)
    return result


def href_numeric_id(href: str | None) -> int:
    if not href:
        return 0
    match = re.search(r"/(\d+)\.html$", href)
    if not match:
        return 0
    try:
        return int(match.group(1))
    except ValueError:
        return 0


def sort_chapter_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        entries,
        key=lambda item: (
            href_numeric_id(item.get("href")),
            normalize_text(item.get("title")),
        ),
    )


def normalize_paragraphs(raw_html: str, cleanup_patterns: list[re.Pattern[str]]) -> list[str]:
    working = raw_html or ""
    working = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", working)
    working = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", working)
    working = re.sub(r"(?i)<br\s*/?>", "\n", working)
    working = re.sub(r"(?i)</p\s*>", "\n", working)
    working = re.sub(r"(?i)</div\s*>", "\n", working)
    working = re.sub(r"(?i)</li\s*>", "\n", working)
    working = re.sub(r"(?is)<[^>]+>", " ", working)
    working = html.unescape(working)
    lines = []
    for raw_line in re.split(r"[\r\n]+", working):
        line = normalize_text(raw_line)
        if not line:
            continue
        for pattern in cleanup_patterns:
            line = normalize_text(pattern.sub(" ", line))
        if not line:
            continue
        if line in {"上一章", "下一章", "返回目录", "加入书签", "章节报错", "投推荐票"}:
            continue
        lines.append(line)
    return dedupe_adjacent_lines(lines)


def dedupe_adjacent_lines(lines: list[str]) -> list[str]:
    result: list[str] = []
    previous = None
    for line in lines:
        if line == previous:
            continue
        result.append(line)
        previous = line
    return result


def format_txt_paragraphs(lines: list[str]) -> list[str]:
    formatted: list[str] = []
    for raw_line in lines:
        line = normalize_text(raw_line)
        if not line:
            continue
        if re.match(r"^第[\d一二三四五六七八九十百千零〇两]+[章节回卷部篇]", line):
            formatted.append(line)
            continue
        if re.match(r"^[（(].+[）)]$", line) or re.match(r"^[-=]{3,}$", line):
            formatted.append(line)
            continue
        formatted.append(f"{FULLWIDTH_INDENT}{line}")
    return formatted


def drop_overlapping_prefix(current_lines: list[str], next_lines: list[str]) -> list[str]:
    if not current_lines or not next_lines:
        return next_lines
    max_overlap = min(len(current_lines), len(next_lines), 8)
    for overlap in range(max_overlap, 0, -1):
        if current_lines[-overlap:] == next_lines[:overlap]:
            return next_lines[overlap:]
    return next_lines


def try_extract_chapter_number(title: str) -> int | None:
    match = re.search(r"第\s*(\d+)\s*[章节回卷部篇]?", title)
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def maybe_reverse_chapters(chapters: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(chapters) < 2:
        return chapters
    first_number = try_extract_chapter_number(chapters[0].get("title", ""))
    last_number = try_extract_chapter_number(chapters[-1].get("title", ""))
    if first_number is not None and last_number is not None and first_number > last_number:
        return list(reversed(chapters))
    return chapters


async def fetch_html(client: httpx.AsyncClient, url: str, *, method: str = "GET", data: dict[str, str] | None = None) -> tuple[str, str]:
    attempts = 3
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            response = await client.request(method, url, data=data)
            response.raise_for_status()
            return response.text, str(response.url)
        except (httpx.RequestError, httpx.HTTPStatusError) as exc:
            last_error = exc
            if attempt >= attempts:
                break
            await anyio.sleep(0.5 * attempt)
    raise RuntimeError(str(last_error) if last_error else f"request-failed: {url}")


def parse_search_results(html_text: str, final_url: str, profile: dict[str, Any]) -> dict[str, Any]:
    document = HTMLParser(html_text)
    search_cfg = profile.get("search", {})
    title_text = first_css_text(document, search_cfg.get("resultTitleSelectors", [])) or ""
    query_match = re.search(r'搜索["“]?(.+?)["”]?\s+共有', title_text)
    count_match = re.search(r'共有\s*["“]?(\d+)["”]?\s*个结果', title_text)
    results: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for selector in search_cfg.get("resultBookSelectors", []):
        for node in document.css(selector):
            href = normalize_url_no_fragment(urljoin(final_url, node.attributes.get("href", "")))
            if not href or href in seen_urls:
                continue
            if not re.search(r"/biqu\d+/?$", href, re.IGNORECASE):
                continue
            seen_urls.add(href)
            title = normalize_text(node.text(separator=" ", strip=True))
            if not title:
                continue
            author_name = ""
            parent = node.parent
            if parent is not None:
                row = parent.parent if parent.parent is not None else parent
                author_node = row.css_first(".s4")
                if author_node:
                    author_name = normalize_text(author_node.text(separator=" ", strip=True))
            results.append({
                "title": title,
                "url": href,
                "authorName": author_name,
            })
    return {
        "queryText": normalize_text(query_match.group(1) if query_match else ""),
        "resultCount": int(count_match.group(1)) if count_match else len(results),
        "results": results,
        "searchUrl": final_url,
    }


async def resolve_book_target(
    client: httpx.AsyncClient,
    context: dict[str, Any],
    book_title: str | None,
    book_url: str | None,
) -> dict[str, Any]:
    if book_url:
        return {
            "bookUrl": normalize_url_no_fragment(book_url),
            "bookTitle": normalize_text(book_title or ""),
            "searchInfo": None,
            "mode": "book-url",
        }

    if not book_title:
        raise RuntimeError("Missing bookTitle or bookUrl.")

    profile = context["profile"]
    base_url = context["baseUrl"]
    known_queries = profile.get("search", {}).get("knownQueries", [])
    for entry in known_queries:
        if normalize_text(entry.get("query")) == normalize_text(book_title):
            return {
                "bookUrl": normalize_url_no_fragment(entry.get("url")),
                "bookTitle": normalize_text(entry.get("title") or book_title),
                "searchInfo": {
                    "queryText": normalize_text(book_title),
                    "resultCount": 1,
                    "results": [{
                        "title": normalize_text(entry.get("title") or book_title),
                        "url": normalize_url_no_fragment(entry.get("url")),
                        "authorName": normalize_text(entry.get("authorName")),
                    }],
                    "searchUrl": normalize_url_no_fragment(entry.get("url")),
                },
                "mode": "known-query",
            }

    for query_text in candidate_query_texts(book_title):
        html_text, final_url = await fetch_html(
            client,
            urljoin(base_url, "/ss/"),
            method="POST",
            data={"searchkey": query_text},
        )
        search_info = parse_search_results(html_text, final_url, profile)
        exact_results = [
            item for item in search_info["results"]
            if normalize_text(item.get("title")) == query_text
        ]
        fuzzy_results = [
            item for item in search_info["results"]
            if titles_match(item.get("title"), book_title)
        ]
        result = (
            exact_results[0] if exact_results else (
                fuzzy_results[0] if fuzzy_results else (
                    search_info["results"][0] if search_info["results"] else None
                )
            )
        )
        if not result or not result.get("url"):
            continue
        return {
            "bookUrl": normalize_url_no_fragment(result["url"]),
            "bookTitle": normalize_text(result.get("title") or book_title),
            "searchInfo": search_info,
            "mode": "search",
        }
    raise RuntimeError(f"search-no-results: {book_title}")


def parse_book_detail(html_text: str, final_url: str, profile: dict[str, Any]) -> dict[str, Any]:
    document = HTMLParser(html_text)
    detail_cfg = profile.get("bookDetail", {})
    book_title = (
        meta_content(document, ["og:novel:book_name"])
        or first_css_text(document, ["h1"])
        or first_css_text(document, ["title"])
        or normalize_text(final_url)
    )
    author_name = meta_content(document, detail_cfg.get("authorMetaNames", [])) or ""
    author_url = meta_link(document, detail_cfg.get("authorLinkMetaNames", []), final_url)
    latest_chapter_name = meta_content(document, detail_cfg.get("latestChapterNameMetaNames", [])) or ""
    latest_chapter_url = meta_link(document, detail_cfg.get("latestChapterMetaNames", []), final_url)
    update_time = meta_content(document, detail_cfg.get("updateTimeMetaNames", [])) or ""

    chapters: list[dict[str, Any]] = []
    for selector in detail_cfg.get("chapterLinkSelectors", []):
        for node in document.css(selector):
            href = normalize_url_no_fragment(urljoin(final_url, node.attributes.get("href", "")))
            if not href or not re.search(r"/biqu\d+/\d+\.html$", href, re.IGNORECASE):
                continue
            title = normalize_text(node.text(separator=" ", strip=True))
            if not title:
                continue
            chapters.append({
                "href": href,
                "title": title,
            })
    chapters = unique_by_key(chapters, "href")
    chapters = maybe_reverse_chapters(chapters)
    for index, chapter in enumerate(chapters, start=1):
        chapter["chapterIndex"] = index

    return {
        "finalUrl": normalize_url_no_fragment(final_url),
        "title": book_title,
        "bookTitle": book_title,
        "authorName": author_name,
        "authorUrl": author_url,
        "latestChapterName": latest_chapter_name,
        "latestChapterUrl": latest_chapter_url,
        "updateTime": update_time,
        "chapterCount": len(chapters),
        "chapters": chapters,
    }


async def fetch_book_metadata_with_context(
    context: dict[str, Any],
    *,
    book_title: str | None,
    book_url: str | None,
) -> dict[str, Any]:
    profile = context["profile"]
    host = context["host"]

    timeout = httpx.Timeout(8.0, connect=8.0)
    limits = httpx.Limits(
        max_connections=DEFAULT_MAX_CONNECTIONS,
        max_keepalive_connections=DEFAULT_MAX_KEEPALIVE_CONNECTIONS,
    )
    async with httpx.AsyncClient(
        headers=DEFAULT_HEADERS,
        follow_redirects=True,
        timeout=timeout,
        limits=limits,
        trust_env=False,
    ) as client:
        target = await resolve_book_target(client, context, book_title, book_url)
        progress_log(
            f"[metadata] resolved target: title='{normalize_text(target.get('bookTitle') or book_title or book_url)}' mode={target.get('mode')}"
        )
        detail_html, detail_url = await fetch_html(client, target["bookUrl"])
        book_detail = parse_book_detail(detail_html, detail_url, profile)
        progress_log(
            "[metadata] detail page: "
            f"title='{normalize_text(book_detail.get('bookTitle'))}' "
            f"latest='{normalize_text(book_detail.get('latestChapterName'))}' "
            f"updated='{normalize_text(book_detail.get('updateTime'))}'"
        )
        return {
            "host": host,
            "mode": target.get("mode"),
            "source": "live-detail-page",
            "bookTitle": book_detail["bookTitle"],
            "authorName": book_detail["authorName"],
            "authorUrl": book_detail["authorUrl"],
            "finalUrl": book_detail["finalUrl"],
            "latestChapterName": book_detail["latestChapterName"],
            "latestChapterUrl": book_detail["latestChapterUrl"],
            "updateTime": book_detail["updateTime"],
            "chapterCount": book_detail["chapterCount"],
            "searchInfo": target.get("searchInfo"),
        }


def extract_chapter_links(
    document: HTMLParser,
    final_url: str,
    selectors: list[str],
    detail_url: str,
) -> list[dict[str, Any]]:
    book_path_match = re.search(r"(/biqu\d+/)", detail_url)
    book_path = book_path_match.group(1) if book_path_match else ""
    entries: list[dict[str, Any]] = []
    for selector in selectors:
        for node in document.css(selector):
            href = normalize_url_no_fragment(urljoin(final_url, node.attributes.get("href", "")))
            if not href:
                continue
            if book_path and book_path not in href:
                continue
            if not re.search(r"/biqu\d+/\d+\.html$", href, re.IGNORECASE):
                continue
            title = normalize_text(node.text(separator=" ", strip=True))
            if not title:
                continue
            entries.append({
                "href": href,
                "title": title,
            })
    return unique_by_key(entries, "href")


async def fetch_paginated_chapter_index(
    client: httpx.AsyncClient,
    detail_url: str,
    detail_cfg: dict[str, Any],
) -> list[dict[str, Any]]:
    selectors = detail_cfg.get("directoryLinkSelectors") or []
    template = detail_cfg.get("directoryPageUrlTemplate")
    if not selectors or not template:
        return []

    start_page = int(detail_cfg.get("directoryPageStart", 1))
    max_page = int(detail_cfg.get("directoryPageMax", 32))
    minimum_expected = int(detail_cfg.get("directoryMinimumExpected", 0))
    seen_urls: set[str] = set()
    page_signatures: set[str] = set()
    merged: list[dict[str, Any]] = []

    for page in range(start_page, max_page + 1):
        page_url = template.format(detail_url=detail_url, page=page)
        html_text, final_url = await fetch_html(client, page_url)
        document = HTMLParser(html_text)
        page_entries = extract_chapter_links(document, final_url, selectors, detail_url)
        page_signature = "|".join(item["href"] for item in page_entries[-12:])
        if page_signature and page_signature in page_signatures:
            progress_log(f"[download] directory page {page}: repeated signature, stop")
            break
        if page_signature:
            page_signatures.add(page_signature)

        added = 0
        for entry in page_entries:
            href = entry["href"]
            if href in seen_urls:
                continue
            seen_urls.add(href)
            merged.append(entry)
            added += 1

        progress_log(f"[download] directory page {page}: +{added} new, total={len(merged)}")
        if page > start_page and added == 0:
            break
        if page > start_page and added < 5 and len(merged) >= minimum_expected:
            break

    merged = sort_chapter_entries(merged)
    for index, chapter in enumerate(merged, start=1):
        chapter["chapterIndex"] = index
    return merged


def extract_content_node(document: HTMLParser, selectors: list[str]):
    for selector in selectors:
        node = document.css_first(selector)
        if node:
            return node
    return None


async def fetch_chapter_chain(
    client: httpx.AsyncClient,
    chapter_entry: dict[str, Any],
    chapter_cfg: dict[str, Any],
    cleanup_patterns: list[re.Pattern[str]],
) -> dict[str, Any]:
    current_url = chapter_entry["href"]
    pages: list[dict[str, Any]] = []
    all_lines: list[str] = []
    seen_urls: set[str] = set()
    retries = 0
    prev_chapter_url = None

    while current_url and current_url not in seen_urls:
        seen_urls.add(current_url)
        html_text, final_url = await fetch_html(client, current_url)
        document = HTMLParser(html_text)
        title = first_css_text(document, chapter_cfg.get("titleSelectors", [])) or chapter_entry["title"]
        content_node = extract_content_node(document, chapter_cfg.get("contentSelectors", []))
        content_html = content_node.html if content_node is not None else ""
        lines = normalize_paragraphs(content_html, cleanup_patterns)
        if lines and normalize_text(lines[0]) == normalize_text(title):
            lines = lines[1:]
        if pages:
            lines = drop_overlapping_prefix(all_lines, lines)
        all_lines.extend(lines)
        pages.append({
            "url": normalize_url_no_fragment(final_url),
            "title": title,
            "lineCount": len(lines),
        })
        if prev_chapter_url is None and chapter_cfg.get("prevSelector"):
            prev_node = document.css_first(chapter_cfg["prevSelector"])
            if prev_node:
                candidate = normalize_url_no_fragment(urljoin(final_url, prev_node.attributes.get("href", "")))
                if candidate and not is_same_chapter_chain(final_url, candidate):
                    prev_chapter_url = candidate
        next_url = None
        if chapter_cfg.get("nextSelector"):
            next_node = document.css_first(chapter_cfg["nextSelector"])
            if next_node:
                next_url = normalize_url_no_fragment(urljoin(final_url, next_node.attributes.get("href", "")))
        if next_url and is_same_chapter_chain(final_url, next_url):
            current_url = next_url
            continue
        current_url = None

    full_text = "\n".join(all_lines).strip()
    return {
        "chapterIndex": chapter_entry["chapterIndex"],
        "href": chapter_entry["href"],
        "title": pages[0]["title"] if pages else chapter_entry["title"],
        "pageCount": len(pages),
        "finalUrl": pages[-1]["url"] if pages else chapter_entry["href"],
        "bodyTextLength": len(full_text),
        "firstParagraph": all_lines[0] if all_lines else "",
        "prevChapterUrl": prev_chapter_url,
        "pages": pages,
        "joinedParagraphs": all_lines,
        "fullText": full_text,
        "retryCount": retries,
    }


async def fetch_full_book_from_latest(
    client: httpx.AsyncClient,
    book_detail: dict[str, Any],
    chapter_cfg: dict[str, Any],
    cleanup_patterns: list[re.Pattern[str]],
    on_chapter: Any | None = None,
) -> list[dict[str, Any]]:
    current_url = normalize_url_no_fragment(book_detail.get("latestChapterUrl"))
    if not current_url:
        raise RuntimeError(f"chapter-not-found: {book_detail['finalUrl']}")

    chapters_desc: list[dict[str, Any]] = []
    seen_bases: set[str] = set()
    progress_log(f"[download] start latest-chapter backtrack: {book_detail.get('bookTitle') or book_detail.get('title')}")
    while current_url:
        current_base = chapter_base_url(current_url) or current_url
        if current_base in seen_bases:
            break
        seen_bases.add(current_base)
        chapter_result = await fetch_chapter_chain(
            client,
            {
                "chapterIndex": 0,
                "href": current_url,
                "title": "",
            },
            chapter_cfg,
            cleanup_patterns,
        )
        chapters_desc.append(chapter_result)
        count = len(chapters_desc)
        if on_chapter is not None:
            on_chapter(chapter_result, count)
        if count <= 5 or count % 25 == 0:
            progress_log(
                f"[download] fetched chapters: {count} latest-seen='{normalize_text(chapter_result.get('title'))}'"
            )
        current_url = normalize_url_no_fragment(chapter_result.get("prevChapterUrl"))

    chapters_desc.reverse()
    for index, chapter in enumerate(chapters_desc, start=1):
        chapter["chapterIndex"] = index
    progress_log(f"[download] chapter backtrack complete: total={len(chapters_desc)}")
    return chapters_desc


async def fetch_all_chapters(
    client: httpx.AsyncClient,
    chapters: list[dict[str, Any]],
    chapter_cfg: dict[str, Any],
    cleanup_patterns: list[re.Pattern[str]],
    concurrency: int,
    on_chapter: Any | None = None,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any] | None] = [None] * len(chapters)
    semaphore = anyio.Semaphore(concurrency)
    errors: list[str] = []
    completed_count = 0

    async def worker(index: int, chapter_entry: dict[str, Any]) -> None:
        nonlocal completed_count
        async with semaphore:
            attempts = 0
            while attempts < 3:
                attempts += 1
                try:
                    result = await fetch_chapter_chain(client, chapter_entry, chapter_cfg, cleanup_patterns)
                    result["retryCount"] = attempts - 1
                    results[index] = result
                    completed_count += 1
                    if on_chapter is not None:
                        on_chapter(result, completed_count)
                    if completed_count <= 5 or completed_count % 25 == 0:
                        progress_log(
                            f"[download] fetched chapters: {completed_count} latest-seen='{normalize_text(result.get('title'))}'"
                        )
                    return
                except Exception as exc:  # noqa: BLE001
                    if attempts >= 3:
                        errors.append(f"{chapter_entry['title']}: {exc}")
                        return
                    await anyio.sleep(0.2 * attempts)

    async with anyio.create_task_group() as task_group:
        for index, chapter_entry in enumerate(chapters):
            task_group.start_soon(worker, index, chapter_entry)

    if errors:
        raise RuntimeError("chapter-fetch-failed: " + "; ".join(errors[:8]))

    progress_log(f"[download] chapter fetch complete: total={len(chapters)}")
    return [item for item in results if item is not None]


def build_pretty_txt(
    *,
    book_title: str,
    author_name: str,
    detail_url: str,
    chapters: list[dict[str, Any]],
) -> str:
    parts = [
        book_title,
        f"作者：{author_name or '未知'}",
        f"目录页：{detail_url}",
        "",
    ]
    for chapter in chapters:
        parts.append(chapter["title"])
        parts.append("")
        if chapter["joinedParagraphs"]:
            parts.extend(chapter["joinedParagraphs"])
        parts.append("")
    return "\n".join(parts).rstrip() + "\n"


def render_pretty_txt(
    *,
    book_title: str,
    author_name: str,
    detail_url: str,
    chapters: list[dict[str, Any]],
) -> str:
    author_display = normalize_text(author_name) or "未知"
    parts = [normalize_text(book_title), f"作者：{author_display}", f"目录页：{detail_url}", ""]
    for chapter in chapters:
        chapter_title = normalize_text(chapter.get("title"))
        if chapter_title:
            parts.append(chapter_title)
            parts.append("")
        parts.extend(format_txt_paragraphs(chapter.get("joinedParagraphs") or []))
        parts.append("")
    return "\n".join(parts).rstrip() + "\n"


def render_partial_chapter_block(chapter: dict[str, Any]) -> str:
    parts: list[str] = []
    chapter_title = normalize_text(chapter.get("title"))
    if chapter_title:
        parts.extend([chapter_title, ""])
    parts.extend(format_txt_paragraphs(chapter.get("joinedParagraphs") or []))
    return "\n".join(parts).rstrip() + "\n\n"


def build_progress_manifest(
    *,
    host: str,
    base_url: str,
    interpreter: str,
    run_dir: Path,
    download_part_file: Path,
    chapters_part_file: Path,
    book_title: str,
    author_name: str,
    detail_url: str,
    written_chapters: int,
    latest_seen_title: str | None,
    started_at: float,
) -> dict[str, Any]:
    return {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "host": host,
        "baseUrl": base_url,
        "interpreter": interpreter,
        "status": "in-progress",
        "summary": {
            "writtenChapters": written_chapters,
            "durationMs": int((time.perf_counter() - started_at) * 1000),
            "latestSeenTitle": latest_seen_title,
        },
        "files": {
            "runDir": str(run_dir),
            "downloadPart": str(download_part_file),
            "chaptersPart": str(chapters_part_file),
        },
        "book": {
            "title": normalize_text(book_title),
            "authorName": normalize_text(author_name),
            "detailUrl": detail_url,
        },
    }


def list_run_dirs(dir_path: str | Path) -> list[Path]:
    root = Path(dir_path)
    if not root.exists():
        return []
    return sorted(
        [entry for entry in root.iterdir() if entry.is_dir()],
        key=lambda item: item.name,
        reverse=True,
    )


def validate_artifact(book: dict[str, Any], manifest_path: Path, run_dir: Path) -> dict[str, Any] | None:
    if not book.get("downloadFile") or not book.get("bookFile") or not book.get("chaptersFile"):
        return None
    manifest = load_json(manifest_path)
    if manifest.get("completeness") != "full-book":
        return None
    if manifest.get("downloadOrdering") != "ascending":
        return None
    if manifest.get("formatting") != "pretty-txt":
        return None

    book_file = Path(str(book["bookFile"])) if Path(str(book["bookFile"])).is_absolute() else run_dir / str(book["bookFile"])
    chapters_file = Path(str(book["chaptersFile"])) if Path(str(book["chaptersFile"])).is_absolute() else run_dir / str(book["chaptersFile"])
    download_file = Path(str(book["downloadFile"])) if Path(str(book["downloadFile"])).is_absolute() else run_dir / str(book["downloadFile"])
    if not book_file.exists() or not chapters_file.exists() or not download_file.exists():
        return None

    book_payload = load_json(book_file)
    chapters_payload = load_json(chapters_file)
    if book_payload.get("chapterOrder") != "ascending":
        return None
    if book_payload.get("downloadFormat") != "pretty-txt":
        return None
    if not isinstance(chapters_payload, list) or not chapters_payload:
        return None

    first_chapter = chapters_payload[0]
    last_chapter = chapters_payload[-1]
    if int(first_chapter.get("chapterIndex", 0)) != 1:
        return None
    if int(last_chapter.get("chapterIndex", 0)) != len(chapters_payload):
        return None

    return {
        "downloadFile": str(download_file),
        "manifestPath": str(manifest_path),
        "finalUrl": book.get("finalUrl"),
        "bookTitle": book.get("title"),
        "interpreter": manifest.get("interpreter"),
        "durationMs": manifest.get("summary", {}).get("durationMs"),
        "isComplete": True,
        "metTargetSla": bool((manifest.get("summary", {}).get("durationMs") or (TARGET_SLA_MS + 1)) <= TARGET_SLA_MS),
    }


def find_existing_artifact(
    *,
    host: str,
    book_title: str | None,
    book_url: str | None,
    knowledge_base_dir: Path,
    out_dir: Path,
) -> dict[str, Any] | None:
    host_root = host_book_content_root(out_dir, host)
    roots = [
        knowledge_base_dir / "raw" / "step-book-content",
        host_root,
        out_dir,
    ]
    for root in roots:
        for run_dir in list_run_dirs(root):
            books_path = run_dir / "books.json"
            manifest_path = run_dir / "book-content-manifest.json"
            if not books_path.exists() or not manifest_path.exists():
                continue
            manifest = load_json(manifest_path)
            manifest_host = sanitize_host(manifest.get("host") or urlparse(str(manifest.get("baseUrl") or "")).netloc)
            if manifest_host and manifest_host != sanitize_host(host):
                continue
            books = load_json(books_path)
            matched = None
            for book in books:
                if book_url and normalize_url_no_fragment(book.get("finalUrl")) == normalize_url_no_fragment(book_url):
                    matched = book
                    break
                if book_title and titles_match(book.get("title"), book_title):
                    matched = book
                    break
            if not matched:
                continue
            validated = validate_artifact(matched, manifest_path, run_dir)
            if not validated:
                continue
            return {
                "host": host,
                "mode": "artifact-hit",
                **validated,
            }
    return None


def sync_run_to_knowledge_base(run_dir: Path, kb_dir: Path) -> Path:
    destination = kb_dir / "raw" / "step-book-content" / run_dir.name
    if destination.resolve() == run_dir.resolve():
        return destination
    if not destination.exists():
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(run_dir, destination)
    return destination


def refresh_registry_usage(registry_path: Path, host: str, status: str) -> None:
    if not registry_path.exists():
        return
    registry = load_json(registry_path)
    registry["generatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    registry.setdefault("hosts", {})
    registry["hosts"][host] = {
        **registry["hosts"].get(host, {}),
        "host": host,
        "lastUsedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "status": status,
    }
    write_json(registry_path, registry)


def ensure_crawler_script(
    *,
    input_url: str,
    crawler_scripts_dir: Path,
    knowledge_base_dir: Path,
    profile_path: Path | None,
    node_executable: str,
) -> dict[str, Any]:
    command = [
        node_executable,
        str(REPO_ROOT / "generate-crawler-script.mjs"),
        input_url,
        "--crawler-scripts-dir",
        str(crawler_scripts_dir),
        "--knowledge-base-dir",
        str(knowledge_base_dir),
    ]
    if profile_path:
        command.extend(["--profile-path", str(profile_path)])
    completed = subprocess.run(
        command,
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=child_utf8_env(),
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(normalize_text(completed.stderr) or "Failed to generate crawler script.")
    return json.loads(completed.stdout)


def run_generated_crawler(
    *,
    crawler_script: Path,
    book_title: str | None,
    book_url: str | None,
    out_dir: Path,
) -> dict[str, Any]:
    command = [
        sys.executable,
        str(crawler_script),
        "--out-dir",
        str(out_dir),
    ]
    if book_title:
        command.extend(["--book-title", book_title])
    if book_url:
        command.extend(["--book-url", book_url])
    progress_log(f"[download] start crawler: {crawler_script.name}")
    completed = subprocess.Popen(
        command,
        cwd=str(REPO_ROOT),
        stdout=subprocess.PIPE,
        stderr=None,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=child_utf8_env(),
    )
    stdout_text, _ = completed.communicate()
    if completed.returncode != 0:
        raise RuntimeError(normalize_text(stdout_text) or "Generated crawler execution failed.")
    return json.loads(stdout_text)


async def crawl_book_with_context(
    context: dict[str, Any],
    *,
    book_title: str | None,
    book_url: str | None,
    out_dir: str | None,
) -> dict[str, Any]:
    started_at = time.perf_counter()
    profile = context["profile"]
    base_url = context["baseUrl"]
    host = context["host"]
    run_root = host_book_content_root(Path(out_dir).resolve(), host) if out_dir else host_book_content_root(Path.cwd() / "book-content", host)

    timeout = httpx.Timeout(8.0, connect=8.0)
    limits = httpx.Limits(
        max_connections=DEFAULT_MAX_CONNECTIONS,
        max_keepalive_connections=DEFAULT_MAX_KEEPALIVE_CONNECTIONS,
    )
    async with httpx.AsyncClient(
        headers=DEFAULT_HEADERS,
        follow_redirects=True,
        timeout=timeout,
        limits=limits,
        trust_env=False,
    ) as client:
        target = await resolve_book_target(client, context, book_title, book_url)
        progress_log(
            f"[download] resolved target: title='{normalize_text(target.get('bookTitle') or book_title or book_url)}' mode={target.get('mode')}"
        )
        detail_html, detail_url = await fetch_html(client, target["bookUrl"])
        book_detail = parse_book_detail(detail_html, detail_url, profile)
        progress_log(
            f"[download] detail page: title='{normalize_text(book_detail.get('bookTitle'))}' latest={normalize_url_no_fragment(book_detail.get('latestChapterUrl'))}"
        )
        book_id = f"book_{sha256_text(book_detail['finalUrl'])[:12]}"
        author_id = f"author_{sha256_text(book_detail['authorUrl'] or book_detail['authorName'] or 'unknown-author')[:12]}"
        download_name = f"{safe_filename(book_detail['bookTitle'], fallback=book_id)}.txt"
        run_id = current_run_id(host)
        run_dir = run_root / run_id
        downloads_dir = run_dir / "downloads"
        book_dir = run_dir / "books" / book_id
        download_file = downloads_dir / download_name
        book_file = book_dir / "book.json"
        chapters_file = book_dir / "chapters.json"
        author_file = book_dir / "author.json"
        manifest_file = run_dir / "book-content-manifest.json"
        books_index_file = run_dir / "books.json"
        download_part_file = downloads_dir / f"{download_name}.part"
        chapters_part_file = book_dir / "chapters.jsonl.part"
        manifest_part_file = run_dir / "book-content-manifest.part.json"
        downloads_dir.mkdir(parents=True, exist_ok=True)
        book_dir.mkdir(parents=True, exist_ok=True)
        write_text(
            download_part_file,
            "\n".join(
                [
                    normalize_text(book_detail["bookTitle"]),
                    f"作者：{normalize_text(book_detail['authorName']) or '未知'}",
                    f"目录页：{book_detail['finalUrl']}",
                    "",
                    "状态：下载中。临时文件按抓取顺序追加，仅用于观察进度；最终 TXT 会在完成后重排输出。",
                ]
            ),
        )
        write_text(chapters_part_file, "")
        write_json(
            manifest_part_file,
            build_progress_manifest(
                host=host,
                base_url=base_url,
                interpreter=os.path.basename(sys.executable),
                run_dir=run_dir,
                download_part_file=download_part_file,
                chapters_part_file=chapters_part_file,
                book_title=book_detail["bookTitle"],
                author_name=book_detail["authorName"],
                detail_url=book_detail["finalUrl"],
                written_chapters=0,
                latest_seen_title=None,
                started_at=started_at,
            ),
        )
        progress_log(f"[download] stream dir ready: {run_dir}")

        def on_partial_chapter(chapter_result: dict[str, Any], count: int) -> None:
            append_text(download_part_file, render_partial_chapter_block(chapter_result))
            append_text(
                chapters_part_file,
                json.dumps(
                    {
                        "chapterIndex": count,
                        "href": chapter_result.get("href"),
                        "title": chapter_result.get("title"),
                        "pageCount": chapter_result.get("pageCount"),
                        "finalUrl": chapter_result.get("finalUrl"),
                        "bodyTextLength": chapter_result.get("bodyTextLength"),
                        "firstParagraph": chapter_result.get("firstParagraph"),
                    },
                    ensure_ascii=False,
                )
                + "\n",
            )
            if count <= 3 or count % 25 == 0:
                write_json(
                    manifest_part_file,
                    build_progress_manifest(
                        host=host,
                        base_url=base_url,
                        interpreter=os.path.basename(sys.executable),
                        run_dir=run_dir,
                        download_part_file=download_part_file,
                        chapters_part_file=chapters_part_file,
                        book_title=book_detail["bookTitle"],
                        author_name=book_detail["authorName"],
                        detail_url=book_detail["finalUrl"],
                        written_chapters=count,
                        latest_seen_title=normalize_text(chapter_result.get("title")),
                        started_at=started_at,
                    ),
                )
        cleanup_patterns = compile_cleanup_patterns(profile.get("chapter", {}).get("cleanupPatterns", []))
        paginated_chapters = await fetch_paginated_chapter_index(
            client,
            book_detail["finalUrl"],
            profile.get("bookDetail", {}),
        )
        if paginated_chapters:
            book_detail["chapters"] = paginated_chapters
            book_detail["chapterCount"] = len(paginated_chapters)
            progress_log(f"[download] using paginated directory: chapters={len(paginated_chapters)}")
            chapters = await fetch_all_chapters(
                client,
                book_detail["chapters"],
                profile.get("chapter", {}),
                cleanup_patterns,
                concurrency=DEFAULT_CHAPTER_CONCURRENCY,
                on_chapter=on_partial_chapter,
            )
        elif book_detail.get("latestChapterUrl"):
            progress_log("[download] paginated directory unavailable, fallback to latest-chapter backtrack")
            chapters = await fetch_full_book_from_latest(
                client,
                book_detail,
                profile.get("chapter", {}),
                cleanup_patterns,
                on_chapter=on_partial_chapter,
            )
        else:
            if not book_detail["chapters"]:
                raise RuntimeError(f"chapter-not-found: {book_detail['finalUrl']}")
            progress_log(f"[download] using inline directory: chapters={len(book_detail['chapters'])}")
            chapters = await fetch_all_chapters(
                client,
                book_detail["chapters"],
                profile.get("chapter", {}),
                cleanup_patterns,
                concurrency=DEFAULT_CHAPTER_CONCURRENCY,
                on_chapter=on_partial_chapter,
            )

    pretty_txt = render_pretty_txt(
        book_title=book_detail["bookTitle"],
        author_name=book_detail["authorName"],
        detail_url=book_detail["finalUrl"],
        chapters=chapters,
    )

    duration_ms = int((time.perf_counter() - started_at) * 1000)
    book_payload = {
        "bookId": book_id,
        "queryText": normalize_text(book_title or target["bookTitle"]),
        "source": target["mode"],
        "finalUrl": book_detail["finalUrl"],
        "title": book_detail["bookTitle"],
        "authorName": book_detail["authorName"],
        "authorUrl": book_detail["authorUrl"],
        "authorId": author_id,
        "latestChapterUrl": book_detail["latestChapterUrl"],
        "chapterCount": len(chapters),
        "chapterOrder": "ascending",
        "downloadFormat": "pretty-txt",
        "downloadFile": str(download_file),
        "bookFile": str(book_file),
        "chaptersFile": str(chapters_file),
        "authorFile": str(author_file),
        "detailPageTitle": book_detail["title"],
        "pageFacts": {
            "pageType": "book-detail-page",
            "bookTitle": book_detail["bookTitle"],
            "authorName": book_detail["authorName"],
            "authorUrl": book_detail["authorUrl"],
            "chapterCount": len(chapters),
            "latestChapterUrl": book_detail["latestChapterUrl"],
        },
    }
    chapters_payload = [
        {
            "chapterIndex": item["chapterIndex"],
            "href": item["href"],
            "title": item["title"],
            "pageCount": item["pageCount"],
            "finalUrl": item["finalUrl"],
            "bodyTextLength": item["bodyTextLength"],
            "firstParagraph": item["firstParagraph"],
            "joinedParagraphs": item.get("joinedParagraphs", []),
            "fullText": item.get("fullText", ""),
        }
        for item in chapters
    ]
    author_payload = {
        "authorId": author_id,
        "authorName": book_detail["authorName"],
        "authorUrl": book_detail["authorUrl"],
        "sourceBookId": book_id,
    }
    manifest_payload = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "host": host,
        "baseUrl": base_url,
        "interpreter": os.path.basename(sys.executable),
        "summary": {
            "books": 1,
            "chapters": len(chapters),
            "successfulChapters": len(chapters),
            "durationMs": duration_ms,
        },
        "completeness": "full-book",
        "downloadOrdering": "ascending",
        "formatting": "pretty-txt",
        "files": {
            "manifest": str(manifest_file),
            "books": str(books_index_file),
            "download": str(download_file),
            "book": str(book_file),
            "chapters": str(chapters_file),
            "author": str(author_file),
        },
    }

    write_text(download_file, pretty_txt)
    write_json(book_file, book_payload)
    write_json(chapters_file, chapters_payload)
    write_json(author_file, author_payload)
    write_json(books_index_file, [book_payload])
    write_json(manifest_file, manifest_payload)
    if download_part_file.exists():
        download_part_file.unlink()
    if chapters_part_file.exists():
        chapters_part_file.unlink()
    if manifest_part_file.exists():
        manifest_part_file.unlink()
    progress_log(f"[download] write complete: chapters={len(chapters)} file={download_file}")

    return {
        "host": host,
        "baseUrl": base_url,
        "interpreter": os.path.basename(sys.executable),
        "bookTitle": book_payload["title"],
        "bookId": book_id,
        "finalUrl": book_payload["finalUrl"],
        "downloadFile": str(download_file),
        "manifestPath": str(manifest_file),
        "outDir": str(run_dir),
        "chapterCount": len(chapters),
        "durationMs": duration_ms,
        "isComplete": True,
        "metTargetSla": duration_ms <= TARGET_SLA_MS,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download a full public novel as pretty TXT.")
    parser.add_argument("url", nargs="?")
    parser.add_argument("--book-title", dest="book_title")
    parser.add_argument("--book-url", dest="book_url")
    parser.add_argument("--metadata-only", dest="metadata_only", action="store_true")
    parser.add_argument("--out-dir", dest="out_dir")
    parser.add_argument("--context-json", dest="context_json")
    parser.add_argument("--crawler-scripts-dir", dest="crawler_scripts_dir")
    parser.add_argument("--knowledge-base-dir", dest="knowledge_base_dir")
    parser.add_argument("--profile-path", dest="profile_path")
    parser.add_argument("--node-executable", dest="node_executable", default="node")
    parser.add_argument("--force-recrawl", dest="force_recrawl", action="store_true")
    return parser.parse_args(argv)


def cli_entry_for_generated(context: dict[str, Any]) -> None:
    init_console_utf8()
    args = parse_args(sys.argv[1:])
    try:
        if args.metadata_only:
            result = anyio.run(
                partial(
                    fetch_book_metadata_with_context,
                    context,
                    book_title=args.book_title,
                    book_url=args.book_url,
                ),
            )
        else:
            result = anyio.run(
                partial(
                    crawl_book_with_context,
                    context,
                    book_title=args.book_title,
                    book_url=args.book_url,
                    out_dir=args.out_dir,
                ),
            )
        sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"{exc}\n")
        raise SystemExit(1) from exc


def require_pypy_runtime() -> None:
    if getattr(sys.implementation, "name", "") != "pypy":
        raise SystemExit("download_book.py must be run with pypy3.")


def public_entry(args: argparse.Namespace) -> dict[str, Any]:
    init_console_utf8()
    require_pypy_runtime()
    if not args.url:
        raise SystemExit("Missing <url>")
    if not args.book_title and not args.book_url:
        raise SystemExit("Missing --book-title or --book-url")

    parsed = urlparse(args.url)
    if not parsed.scheme or not parsed.netloc:
        raise SystemExit(f"Invalid url: {args.url}")

    host = parsed.netloc
    site_context = read_site_context(host, REPO_ROOT)
    registry_record = site_context.get("registryRecord") or {}
    capabilities_record = site_context.get("capabilitiesRecord") or {}
    resolved_base_url = (
        registry_record.get("canonicalBaseUrl")
        or capabilities_record.get("baseUrl")
        or normalize_url_no_fragment(f"{parsed.scheme}://{parsed.netloc}/")
    )
    knowledge_base_dir = Path(args.knowledge_base_dir).resolve() if args.knowledge_base_dir else Path(
        registry_record.get("knowledgeBaseDir") or (REPO_ROOT / "knowledge-base" / sanitize_host(host))
    ).resolve()
    crawler_scripts_dir = Path(args.crawler_scripts_dir).resolve() if args.crawler_scripts_dir else Path(
        registry_record.get("crawlerScriptsDir") or (REPO_ROOT / "crawler-scripts")
    ).resolve()
    out_dir = host_book_content_root(Path(args.out_dir).resolve(), host) if args.out_dir else host_book_content_root(
        Path(registry_record.get("bookContentRoot")).resolve() if registry_record.get("bookContentRoot") else (REPO_ROOT / "book-content"),
        host,
    )
    profile_path = Path(args.profile_path).resolve() if args.profile_path else Path(
        registry_record.get("profilePath") or (REPO_ROOT / "profiles" / f"{parsed.hostname}.json")
    ).resolve()
    context = {
        "host": host,
        "baseUrl": resolved_base_url,
        "profile": load_json(profile_path),
        "siteContext": site_context,
    }
    resolved_primary_archetype = resolve_primary_archetype(site_context, context["profile"].get("primaryArchetype"))
    resolved_capability_families = resolve_capability_families(
        site_context,
        context["profile"].get("capabilityFamilies"),
        ["download-content"],
    )
    resolved_page_types = resolve_page_types(site_context, context["profile"].get("pageTypes"))
    resolved_supported_intents = resolve_supported_intents(site_context, ["download-book"])
    resolved_safe_action_kinds = resolve_safe_action_kinds(site_context)

    if args.metadata_only:
        return anyio.run(
            partial(
                fetch_book_metadata_with_context,
                context,
                book_title=args.book_title,
                book_url=args.book_url,
            ),
        )

    if not args.force_recrawl:
        artifact = find_existing_artifact(
            host=host,
            book_title=args.book_title,
            book_url=args.book_url,
            knowledge_base_dir=knowledge_base_dir,
            out_dir=out_dir,
        )
        if artifact:
            progress_log(f"[download] artifact hit: {artifact['downloadFile']}")
            upsert_site_registry_record(host, {
                "canonicalBaseUrl": context["baseUrl"],
                "siteArchetype": resolved_primary_archetype,
                "bookContentRoot": str(out_dir),
                "knowledgeBaseDir": str(knowledge_base_dir),
                "latestDownloadMode": artifact.get("mode"),
                "latestDownloadFile": artifact.get("downloadFile"),
                "latestDownloadManifest": artifact.get("manifestPath"),
                "downloadEntrypoint": "download_book.py",
                "interpreterRequired": "pypy3",
                "crawlerScriptsDir": str(crawler_scripts_dir),
                "capabilityFamilies": resolved_capability_families,
            }, REPO_ROOT)
            upsert_site_capabilities_record(host, {
                "baseUrl": context["baseUrl"],
                "primaryArchetype": resolved_primary_archetype,
                "pageTypes": resolved_page_types,
                "capabilityFamilies": resolved_capability_families,
                "supportedIntents": resolved_supported_intents,
                "safeActionKinds": resolved_safe_action_kinds,
            }, REPO_ROOT)
            return artifact

    progress_log(f"[download] ensure crawler script for host={host}")
    crawler = ensure_crawler_script(
        input_url=args.url,
        crawler_scripts_dir=crawler_scripts_dir,
        knowledge_base_dir=knowledge_base_dir,
        profile_path=profile_path,
        node_executable=args.node_executable,
    )
    progress_log(f"[download] crawler ready: status={crawler['status']} script={crawler['scriptPath']}")
    crawl_result = run_generated_crawler(
        crawler_script=Path(crawler["scriptPath"]),
        book_title=args.book_title,
        book_url=args.book_url,
        out_dir=out_dir,
    )
    local_run_dir = Path(crawl_result["manifestPath"]).resolve().parent
    synced_run_dir = sync_run_to_knowledge_base(local_run_dir, knowledge_base_dir)
    synced_manifest_path = synced_run_dir / "book-content-manifest.json"
    synced_download_file = synced_run_dir / Path(crawl_result["downloadFile"]).resolve().relative_to(local_run_dir)
    refresh_registry_usage(Path(crawler["registryPath"]), host, crawler["status"])
    upsert_site_registry_record(host, {
        "canonicalBaseUrl": context["baseUrl"],
        "siteArchetype": resolved_primary_archetype,
        "bookContentRoot": str(out_dir),
        "knowledgeBaseDir": str(knowledge_base_dir),
        "crawlerScriptPath": crawler["scriptPath"],
        "crawlerRegistryPath": crawler["registryPath"],
        "latestDownloadMode": "crawler-generated" if crawler["status"] == "generated" else "crawler-reused",
        "latestDownloadFile": str(synced_download_file),
        "latestDownloadManifest": str(synced_manifest_path),
        "downloadEntrypoint": "download_book.py",
        "interpreterRequired": "pypy3",
        "crawlerScriptsDir": str(crawler_scripts_dir),
        "capabilityFamilies": resolved_capability_families,
    }, REPO_ROOT)
    upsert_site_capabilities_record(host, {
        "baseUrl": context["baseUrl"],
        "primaryArchetype": resolved_primary_archetype,
        "pageTypes": resolved_page_types,
        "capabilityFamilies": resolved_capability_families,
        "supportedIntents": resolved_supported_intents,
        "safeActionKinds": resolved_safe_action_kinds,
    }, REPO_ROOT)

    return {
        "host": host,
        "bookTitle": crawl_result.get("bookTitle") or args.book_title or args.book_url,
        "mode": "crawler-generated" if crawler["status"] == "generated" else "crawler-reused",
        "downloadFile": str(synced_download_file),
        "crawlerScript": crawler["scriptPath"],
        "manifestPath": str(synced_manifest_path),
        "finalUrl": crawl_result.get("finalUrl"),
        "interpreter": crawl_result.get("interpreter") or sys.executable,
        "durationMs": crawl_result.get("durationMs"),
        "isComplete": bool(crawl_result.get("isComplete")),
        "metTargetSla": bool(crawl_result.get("metTargetSla")),
    }


def main() -> None:
    init_console_utf8()
    args = parse_args(sys.argv[1:])
    if args.context_json:
        context = load_json(args.context_json)
        cli_entry_for_generated(context)
        return
    result = public_entry(args)
    sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
