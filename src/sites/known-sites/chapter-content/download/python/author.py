#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import os
import sys
from functools import partial
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import anyio
import httpx

from book import (
    DEFAULT_HEADERS,
    DEFAULT_MAX_CONNECTIONS,
    DEFAULT_MAX_KEEPALIVE_CONNECTIONS,
    fetch_html,
    load_json,
    normalize_text,
    normalize_url_no_fragment,
    parse_book_detail,
    parse_search_results,
    read_site_context,
    resolve_profile_path,
    search_request_candidates,
)


def normalize_match_key(value: Any) -> str:
    return normalize_text(value).casefold()


def compact_work(book_detail: dict[str, Any], candidate: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "title": normalize_text(book_detail.get("bookTitle") or book_detail.get("title") or (candidate or {}).get("title")),
        "url": normalize_url_no_fragment(book_detail.get("finalUrl") or (candidate or {}).get("url")),
        "authorName": normalize_text(book_detail.get("authorName")),
        "authorUrl": normalize_url_no_fragment(book_detail.get("authorUrl")),
        "latestChapterName": normalize_text(book_detail.get("latestChapterName")),
        "latestChapterUrl": normalize_url_no_fragment(book_detail.get("latestChapterUrl")),
        "updateTime": normalize_text(book_detail.get("updateTime")),
        "chapterCount": int(book_detail.get("chapterCount") or 0),
    }


def dedupe_author_matches(matches: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    seen_titles: set[str] = set()
    for item in matches:
        url_key = normalize_url_no_fragment(item.get("url")) or ""
        title_key = normalize_match_key(item.get("title"))
        if url_key and url_key in seen_urls:
            continue
        if title_key and title_key in seen_titles:
            continue
        if url_key:
            seen_urls.add(url_key)
        if title_key:
            seen_titles.add(title_key)
        deduped.append(item)
    return deduped


async def _fetch_author_works_with_client(
    client: Any,
    context: dict[str, Any],
    *,
    author_name: str,
    max_candidates: int,
) -> dict[str, Any]:
    requested_author = normalize_text(author_name)
    if not requested_author:
        raise RuntimeError("missing-author-name")

    profile = context["profile"]
    base_url = context["baseUrl"]
    search_cfg = profile.get("search", {})
    detail_cfg = profile.get("bookDetail", {})

    search_attempts: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    last_error: Exception | None = None
    for request in search_request_candidates(search_cfg, base_url, requested_author):
        attempt = {
            "method": request["method"],
            "url": normalize_url_no_fragment(request["url"]),
            "submittedFieldNames": sorted((request.get("data") or {}).keys()),
        }
        try:
            html_text, final_url = await fetch_html(
                client,
                request["url"],
                method=request["method"],
                data=request.get("data"),
            )
        except RuntimeError as exc:
            last_error = exc
            attempt["status"] = "failed"
            attempt["reason"] = normalize_text(str(exc))
            search_attempts.append(attempt)
            continue
        search_info = parse_search_results(html_text, final_url, profile)
        attempt["status"] = "ok"
        attempt["finalUrl"] = normalize_url_no_fragment(final_url)
        attempt["resultCount"] = int(search_info.get("resultCount") or 0)
        search_attempts.append(attempt)
        candidates = list(search_info.get("results") or [])
        if candidates:
            break

    if not candidates and last_error is not None and not search_attempts:
        raise RuntimeError(f"author-search-request-failed: {last_error}") from last_error

    matched: list[dict[str, Any]] = []
    unverified: list[dict[str, Any]] = []
    for candidate in candidates[:max_candidates]:
        candidate_url = normalize_url_no_fragment(candidate.get("url"))
        if not candidate_url:
            unverified.append({
                "title": normalize_text(candidate.get("title")),
                "url": None,
                "reason": "missing-candidate-url",
            })
            continue
        try:
            detail_html, detail_url = await fetch_html(client, candidate_url)
            book_detail = parse_book_detail(detail_html, detail_url, profile)
        except RuntimeError as exc:
            unverified.append({
                "title": normalize_text(candidate.get("title")),
                "url": candidate_url,
                "reason": normalize_text(str(exc)),
            })
            continue
        work = compact_work(book_detail, candidate)
        if normalize_match_key(work.get("authorName")) == normalize_match_key(requested_author):
            matched.append(work)
        else:
            unverified.append({
                "title": normalize_text(candidate.get("title")),
                "url": candidate_url,
                "observedAuthorName": work.get("authorName"),
                "reason": "author-name-mismatch",
            })

    matched = dedupe_author_matches(matched)
    return {
        "host": context.get("host"),
        "baseUrl": base_url,
        "authorName": requested_author,
        "source": "site-search-author-name",
        "matchedWorkCount": len(matched),
        "matchedWorks": matched,
        "unverifiedCandidates": unverified,
        "candidateCount": len(candidates),
        "searchAttempts": search_attempts,
        "countMethod": "site-search-author-name -> parse-search-results -> open-book -> exact normalized author field match -> URL/title dedupe",
        "extractionMode": "metadata-only",
        "chapterBodyPersisted": False,
    }


async def fetch_author_works_with_context(
    context: dict[str, Any],
    *,
    author_name: str,
    max_candidates: int = 50,
    client: Any | None = None,
) -> dict[str, Any]:
    if client is not None:
        return await _fetch_author_works_with_client(
            client,
            context,
            author_name=author_name,
            max_candidates=max_candidates,
        )

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
    ) as active_client:
        return await _fetch_author_works_with_client(
            active_client,
            context,
            author_name=author_name,
            max_candidates=max_candidates,
        )


def build_context(args: argparse.Namespace) -> dict[str, Any]:
    if args.context_json:
        return load_json(args.context_json)
    if not args.url:
        raise SystemExit("Missing <url> or --context-json")
    parsed = urlparse(args.url)
    if not parsed.scheme or not parsed.netloc:
        raise SystemExit(f"Invalid url: {args.url}")
    site_context = read_site_context(parsed.netloc, Path(__file__).resolve().parents[6])
    registry_record = site_context.get("registryRecord") or {}
    capabilities_record = site_context.get("capabilitiesRecord") or {}
    base_url = (
        registry_record.get("canonicalBaseUrl")
        or capabilities_record.get("baseUrl")
        or normalize_url_no_fragment(f"{parsed.scheme}://{parsed.netloc}/")
    )
    profile_path = resolve_profile_path(args.profile_path or registry_record.get("profilePath"), parsed.hostname)
    return {
        "host": parsed.netloc,
        "baseUrl": base_url,
        "profile": load_json(profile_path),
        "siteContext": site_context,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Query public author/work metadata through a site search form.")
    parser.add_argument("url", nargs="?")
    parser.add_argument("--author-name", required=True)
    parser.add_argument("--max-candidates", type=int, default=50)
    parser.add_argument("--context-json")
    parser.add_argument("--profile-path")
    return parser.parse_args(argv)


def main() -> None:
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    os.environ.setdefault("PYTHONUTF8", "1")
    args = parse_args(sys.argv[1:])
    context = build_context(args)
    result = anyio.run(
        partial(
            fetch_author_works_with_context,
            context,
            author_name=args.author_name,
            max_candidates=args.max_candidates,
        ),
    )
    sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
