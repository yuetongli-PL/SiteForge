#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

def ensure_internal_python_paths() -> Path:
    file_path = Path(__file__).resolve()
    repo_root = file_path.parents[5]
    support_dirs = [
        repo_root,
        file_path.parents[3] / "chapter-content" / "download" / "python",
    ]
    for candidate in support_dirs:
        candidate_str = str(candidate)
        if candidate_str not in sys.path:
            sys.path.insert(0, candidate_str)
    return repo_root


REPO_ROOT = ensure_internal_python_paths()


from book import (
    child_utf8_env,
    init_console_utf8,
    normalize_text,
    normalize_url_no_fragment,
    progress_log,
    sanitize_host,
    sha256_text,
    slugify_ascii,
    write_json,
    write_text,
)

DEFAULT_OUTPUT_ROOT = REPO_ROOT / "video-downloads"
DEFAULT_CONCURRENCY = 3
DEFAULT_MAX_PLAYLIST_ITEMS = 20
DEFAULT_CONCURRENT_FRAGMENTS = 4
DEFAULT_PAGE_SIZE = 30
DEFAULT_CONTAINER = "mp4"
DEFAULT_NAMING_STRATEGY = "title-id"
DEFAULT_DOWNLOAD_ARCHIVE_NAME = "download-archive.txt"
DEFAULT_TARGET_HEIGHT = 1080
DEFAULT_TARGET_CODEC = "h264"
DEFAULT_FALLBACK_POLICY = "preserve-height-then-downgrade-codec"
AUTO_LOGIN_REQUIRED_INPUT_KINDS = frozenset({"favorite-list", "watch-later-list"})
SUPPORTED_HOSTS = {"www.bilibili.com", "space.bilibili.com"}
BV_PATTERN = re.compile(r"^(BV[0-9A-Za-z]+)$")
AV_PATTERN = re.compile(r"^(av\d+)$", re.IGNORECASE)
EP_PATTERN = re.compile(r"^(ep\d+)$", re.IGNORECASE)


class DownloadBilibiliError(RuntimeError):
    pass


def format_timestamp_for_dir(now: float | None = None) -> str:
    current = now if now is not None else time.time()
    timestamp = time.strftime("%Y%m%dT%H%M%S", time.gmtime(current))
    milliseconds = f"{int((current % 1) * 1000):03d}Z"
    return f"{timestamp}{milliseconds}"


def current_run_id(host: str, now: float | None = None) -> str:
    return f"{format_timestamp_for_dir(now)}_{sanitize_host(host)}_video-download"


def host_video_download_root(root: Path, host: str) -> Path:
    resolved = root.resolve()
    host_slug = sanitize_host(host)
    if resolved.name == host_slug:
        return resolved
    return resolved / host_slug


def load_json(path_value: str | Path) -> Any:
    return json.loads(Path(path_value).read_text(encoding="utf-8"))


def default_bilibili_profile_path() -> Path:
    return REPO_ROOT / "profiles" / "www.bilibili.com.json"


def resolve_hostname(input_value: str | None) -> str | None:
    if not input_value:
        return None
    try:
        return urlparse(str(input_value)).hostname or None
    except Exception:
        return str(input_value).strip() or None


def derive_persistent_profile_key(input_value: str | None) -> str:
    hostname = resolve_hostname(input_value)
    if not hostname:
        return "default"

    normalized = hostname.lower()
    labels = [label for label in normalized.split(".") if label]
    if len(labels) >= 2:
        return sanitize_host(".".join(labels[-2:]))
    return sanitize_host(normalized)


def resolve_default_persistent_browser_root() -> Path:
    if sys.platform == "win32":
        return Path(
            os.environ.get("LOCALAPPDATA")
            or Path.home() / "AppData" / "Local"
        ) / "Browser-Wiki-Skill" / "browser-profiles"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Browser-Wiki-Skill" / "browser-profiles"
    return Path(
        os.environ.get("XDG_STATE_HOME")
        or (Path.home() / ".local" / "state")
    ) / "browser-wiki-skill" / "browser-profiles"


def resolve_persistent_user_data_dir(input_value: str, root_dir: str | Path | None = None) -> Path:
    root = Path(root_dir) if root_dir else resolve_default_persistent_browser_root()
    return root.resolve() / derive_persistent_profile_key(input_value)


def inspect_persistent_profile_health(user_data_dir: str | Path) -> dict[str, Any]:
    resolved_dir = Path(user_data_dir).resolve()
    default_dir = resolved_dir / "Default"
    cookies_path = default_dir / "Network" / "Cookies"
    preferences_path = default_dir / "Preferences"
    sessions_path = default_dir / "Sessions"
    warnings: list[str] = []

    preferences = {}
    if preferences_path.exists():
        try:
            preferences = load_json(preferences_path)
        except Exception:
            warnings.append(f"Failed to parse browser profile Preferences: {preferences_path}")

    last_exit_type = str(preferences.get("profile", {}).get("exit_type") or "").strip() or None
    profile_in_use = any((resolved_dir / name).exists() for name in ("SingletonLock", "SingletonCookie", "SingletonSocket"))

    cookies_ready = cookies_path.exists()
    preferences_ready = preferences_path.exists()
    reusable = resolved_dir.exists() and cookies_ready and not profile_in_use

    if not resolved_dir.exists():
        warnings.append(f"Persistent browser profile directory does not exist yet: {resolved_dir}")
    if not cookies_ready:
        warnings.append(f"Persistent browser profile is missing Cookies database: {cookies_path}")
    if not preferences_ready:
        warnings.append(f"Persistent browser profile is missing Preferences: {preferences_path}")
    if not sessions_path.exists():
        warnings.append(f"Persistent browser profile is missing Sessions directory: {sessions_path}")
    if last_exit_type and last_exit_type.lower() != "normal":
        warnings.append(f"Persistent browser profile last exit type was {last_exit_type}.")
    if profile_in_use:
        warnings.append(f"Persistent browser profile appears to be in use: {resolved_dir}")

    return {
        "userDataDir": str(resolved_dir),
        "exists": resolved_dir.exists(),
        "cookiesPath": str(cookies_path),
        "preferencesPath": str(preferences_path),
        "sessionsPath": str(sessions_path),
        "loginStateLikelyAvailable": cookies_ready,
        "healthy": resolved_dir.exists() and cookies_ready and preferences_ready and not profile_in_use,
        "usableForCookies": reusable,
        "cookiesReady": cookies_ready,
        "profileInUse": profile_in_use,
        "lastExitType": last_exit_type,
        "warnings": warnings,
    }


def resolve_tool_path(name: str, explicit_path: str | None = None, *, required: bool = True) -> str | None:
    if explicit_path:
        candidate = Path(explicit_path).expanduser().resolve()
        if not candidate.exists():
            if required:
                raise DownloadBilibiliError(f"{name} not found at explicit path: {candidate}")
            return None
        return str(candidate)
    discovered = shutil.which(name)
    if discovered:
        return discovered
    if required:
        raise DownloadBilibiliError(
            f"Could not find {name} in PATH. Ensure it is installed before using the bilibili downloader."
        )
    return None


def resolve_bilibili_profile(profile_path: str | Path | None = None) -> dict[str, Any]:
    resolved_path = Path(profile_path or default_bilibili_profile_path()).resolve()
    if not resolved_path.exists():
        raise DownloadBilibiliError(f"Missing bilibili profile: {resolved_path}")
    profile = load_json(resolved_path)
    return {
        "path": str(resolved_path),
        "profile": profile,
    }


def resolve_downloader_config(profile: dict[str, Any]) -> dict[str, Any]:
    config = profile.get("downloader") or {}
    quality_policy = config.get("qualityPolicy") or {}
    default_container = str(
        quality_policy.get("defaultContainer")
        or config.get("defaultContainer")
        or DEFAULT_CONTAINER
    )
    return {
        "defaultOutputRoot": str(config.get("defaultOutputRoot") or DEFAULT_OUTPUT_ROOT),
        "requiresLoginForHighestQuality": config.get("requiresLoginForHighestQuality") is True,
        "authorVideoListPathPrefixes": [
            str(value).strip()
            for value in (config.get("authorVideoListPathPrefixes") or ["/video", "/upload/video"])
            if str(value).strip()
        ],
        "favoriteListPathPrefixes": [
            str(value).strip()
            for value in (config.get("favoriteListPathPrefixes") or ["/favlist"])
            if str(value).strip()
        ],
        "watchLaterPathPrefixes": [
            str(value).strip()
            for value in (config.get("watchLaterPathPrefixes") or ["/watchlater"])
            if str(value).strip()
        ],
        "collectionPathPrefixes": [
            str(value).strip()
            for value in (config.get("collectionPathPrefixes") or ["/list/", "/medialist/play/"])
            if str(value).strip()
        ],
        "channelPathPrefixes": [
            str(value).strip()
            for value in (config.get("channelPathPrefixes") or ["/v/", "/anime", "/movie"])
            if str(value).strip()
        ],
        "maxBatchItems": max(1, int(config.get("maxBatchItems") or DEFAULT_MAX_PLAYLIST_ITEMS)),
        "playlistPageSize": max(1, int(config.get("playlistPageSize") or DEFAULT_PAGE_SIZE)),
        "defaultContainer": default_container,
        "defaultNamingStrategy": str(config.get("defaultNamingStrategy") or DEFAULT_NAMING_STRATEGY),
        "qualityPolicy": {
            "targetHeight": max(144, int(quality_policy.get("targetHeight") or DEFAULT_TARGET_HEIGHT)),
            "targetCodec": normalize_text(quality_policy.get("targetCodec")).lower() or DEFAULT_TARGET_CODEC,
            "defaultContainer": default_container,
            "fallbackPolicy": normalize_text(quality_policy.get("fallbackPolicy")) or DEFAULT_FALLBACK_POLICY,
        },
    }


def normalize_bilibili_input(raw_value: str) -> dict[str, Any]:
    raw = normalize_text(raw_value)
    if not raw:
        raise DownloadBilibiliError("Encountered an empty bilibili input item.")

    if BV_PATTERN.match(raw):
        return {
            "raw": raw_value,
            "inputKind": "video-detail",
            "source": raw,
            "normalizedUrl": f"https://www.bilibili.com/video/{raw}/",
        }
    if AV_PATTERN.match(raw):
        return {
            "raw": raw_value,
            "inputKind": "video-detail",
            "source": raw,
            "normalizedUrl": f"https://www.bilibili.com/video/{raw.lower()}/",
        }
    if EP_PATTERN.match(raw):
        return {
            "raw": raw_value,
            "inputKind": "bangumi-detail",
            "source": raw,
            "normalizedUrl": f"https://www.bilibili.com/bangumi/play/{raw.lower()}/",
        }

    normalized_url = normalize_url_no_fragment(raw)
    parsed = urlparse(normalized_url or raw)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in SUPPORTED_HOSTS:
        raise DownloadBilibiliError(f"Unsupported bilibili input: {raw}")

    path_value = parsed.path.rstrip("/")
    if parsed.hostname == "space.bilibili.com":
        if path_value.endswith("/video") or path_value.endswith("/upload/video"):
            return {
                "raw": raw_value,
                "inputKind": "author-video-list",
                "source": raw,
                "normalizedUrl": normalized_url,
            }
        if "/channel/collectiondetail" in path_value or "/channel/seriesdetail" in path_value:
            return {
                "raw": raw_value,
                "inputKind": "collection-list",
                "source": raw,
                "normalizedUrl": normalized_url,
            }
        if "/favlist" in path_value:
            return {
                "raw": raw_value,
                "inputKind": "favorite-list",
                "source": raw,
                "normalizedUrl": normalized_url,
            }
        raise DownloadBilibiliError(
            f"Unsupported bilibili author subpage for downloading: {normalized_url}. Supported list inputs are /video, /upload/video, and /favlist."
        )

    if "/video/" in path_value:
        return {
            "raw": raw_value,
            "inputKind": "video-detail",
            "source": raw,
            "normalizedUrl": normalized_url,
        }
    if "/bangumi/play/" in path_value:
        return {
            "raw": raw_value,
            "inputKind": "bangumi-detail",
            "source": raw,
            "normalizedUrl": normalized_url,
        }
    if path_value.startswith("/watchlater"):
        return {
            "raw": raw_value,
            "inputKind": "watch-later-list",
            "source": raw,
            "normalizedUrl": normalized_url,
        }
    if path_value.startswith("/list/") or "/medialist/play/" in path_value:
        return {
            "raw": raw_value,
            "inputKind": "collection-list",
            "source": raw,
            "normalizedUrl": normalized_url,
        }
    if path_value.startswith("/v/") or path_value.startswith("/anime") or path_value.startswith("/movie"):
        return {
            "raw": raw_value,
            "inputKind": "channel-list",
            "source": raw,
            "normalizedUrl": normalized_url,
        }

    raise DownloadBilibiliError(
        f"Unsupported bilibili URL for downloading: {normalized_url}. Supported inputs are video/bangumi detail URLs, UP video list URLs, favorites, watch-later, collections, and channel pages."
    )


def load_input_items(inputs: list[str], input_file: str | None = None) -> list[dict[str, Any]]:
    raw_items = [str(value).strip() for value in inputs if str(value).strip()]
    if input_file:
        file_path = Path(input_file).resolve()
        if not file_path.exists():
            raise DownloadBilibiliError(f"Input file does not exist: {file_path}")
        for line in file_path.read_text(encoding="utf-8").splitlines():
            text = line.strip()
            if not text or text.startswith("#"):
                continue
            raw_items.append(text)
    if not raw_items:
        raise DownloadBilibiliError("At least one bilibili URL/BV input or --input-file is required.")

    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in raw_items:
        item = normalize_bilibili_input(raw)
        key = item["normalizedUrl"]
        if key in seen:
            continue
        seen.add(key)
        normalized.append(item)
    return normalized


def build_format_selector(settings: dict[str, Any]) -> str:
    max_height = settings.get("maxHeight")
    video_selector = "bestvideo*"
    merged_selector = "best"
    if max_height:
        video_selector = f"{video_selector}[height<={int(max_height)}]"
        merged_selector = f"{merged_selector}[height<={int(max_height)}]"
    return f"{video_selector}+bestaudio/{merged_selector}"


def build_format_sort_args(settings: dict[str, Any]) -> list[str]:
    codec_preference = settings.get("codecPreference")
    base = "res,br,size"
    if codec_preference == "av1":
        return ["--format-sort", f"{base},codec:av1"]
    if codec_preference == "hevc":
        return ["--format-sort", f"{base},codec:h265"]
    if codec_preference == "h264":
        return ["--format-sort", f"{base},codec:h264"]
    return []


def build_ytdlp_common_args(settings: dict[str, Any], tool_state: dict[str, Any], include_ffmpeg: bool = False) -> list[str]:
    args = [
        tool_state["ytDlpPath"],
        "--ignore-config",
        "--no-warnings",
    ]
    if settings.get("reuseLoginState") and tool_state.get("cookiesFromBrowser"):
        args.extend(["--cookies-from-browser", tool_state["cookiesFromBrowser"]])
    if include_ffmpeg:
        args.extend(["--ffmpeg-location", tool_state["ffmpegLocation"]])
    args.extend(build_format_sort_args(settings))
    return args


def run_subprocess(
    args: list[str],
    *,
    cwd: str | Path | None = None,
    allow_failure: bool = False,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        args,
        cwd=str(cwd) if cwd else None,
        env=env or child_utf8_env(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    if not allow_failure and completed.returncode != 0:
        raise DownloadBilibiliError(
            f"Command failed ({completed.returncode}): {' '.join(args)}\n{completed.stderr.strip()}"
        )
    return completed


def run_ytdlp_json(
    url: str,
    settings: dict[str, Any],
    tool_state: dict[str, Any],
    *,
    flat_playlist: bool = False,
    playlist_start: int | None = None,
    playlist_end: int | None = None,
    no_playlist: bool = False,
    runner: Callable[..., subprocess.CompletedProcess[str]] = run_subprocess,
) -> dict[str, Any]:
    args = build_ytdlp_common_args(settings, tool_state)
    args.extend(["--dump-single-json"])
    if flat_playlist:
        args.append("--flat-playlist")
    if playlist_start:
        args.extend(["--playlist-start", str(int(playlist_start))])
    if playlist_end:
        args.extend(["--playlist-end", str(int(playlist_end))])
    if no_playlist:
        args.append("--no-playlist")
    args.extend([
        "--format",
        build_format_selector(settings),
        url,
    ])
    completed = runner(args, cwd=REPO_ROOT)
    payload = normalize_text(completed.stdout).strip()
    if not payload:
        raise DownloadBilibiliError(f"yt-dlp returned empty JSON output for {url}")
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise DownloadBilibiliError(f"Failed to parse yt-dlp JSON output for {url}: {error}") from error


def build_video_url_from_entry(entry: dict[str, Any]) -> str | None:
    for key in ("webpage_url", "original_url", "url"):
        value = normalize_url_no_fragment(entry.get(key))
        if value and value.startswith("http"):
            return value
    entry_id = normalize_text(entry.get("id"))
    if BV_PATTERN.match(entry_id):
        return f"https://www.bilibili.com/video/{entry_id}/"
    if AV_PATTERN.match(entry_id):
        return f"https://www.bilibili.com/video/{entry_id.lower()}/"
    if EP_PATTERN.match(entry_id):
        return f"https://www.bilibili.com/bangumi/play/{entry_id.lower()}/"
    return None


def normalize_playlist_entry(entry: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(entry, dict):
        return None
    resolved_url = build_video_url_from_entry(entry)
    if not resolved_url:
        return None
    return {
        "resolvedUrl": resolved_url,
        "contentId": normalize_text(entry.get("bvid") or entry.get("id")) or None,
        "title": normalize_text(entry.get("title")) or None,
    }


def resolve_playlist_window(settings: dict[str, Any], config: dict[str, Any]) -> tuple[int, int]:
    explicit_start = settings.get("playlistStart")
    explicit_end = settings.get("playlistEnd")
    if explicit_start is not None or explicit_end is not None:
        start_value = max(1, int(explicit_start or 1))
        end_value = max(start_value, int(explicit_end or start_value))
        return start_value, end_value
    page_size = max(1, int(settings.get("pageSize") or config.get("playlistPageSize") or DEFAULT_PAGE_SIZE))
    from_page = max(1, int(settings.get("fromPage") or 1))
    page_limit = settings.get("pageLimit")
    if page_limit is not None:
        page_limit = max(1, int(page_limit))
    max_items = settings.get("maxItems") or settings.get("maxPlaylistItems") or config.get("maxBatchItems") or DEFAULT_MAX_PLAYLIST_ITEMS
    max_items = max(1, int(max_items))
    if page_limit is not None:
        max_items = min(max_items, page_limit * page_size)
    playlist_start = ((from_page - 1) * page_size) + 1
    playlist_end = playlist_start + max_items - 1
    return playlist_start, playlist_end


def entry_matches_filters(entry: dict[str, Any], settings: dict[str, Any]) -> bool:
    include_bvids = settings.get("includeBvids") or []
    if include_bvids:
        allow = {normalize_text(item).upper() for item in include_bvids if normalize_text(item)}
        entry_id = normalize_text(entry.get("contentId")).upper()
        resolved_url = normalize_text(entry.get("resolvedUrl")).upper()
        if entry_id not in allow and not any(value in resolved_url for value in allow):
            return False
    match_title = normalize_text(settings.get("matchTitle"))
    title_includes = [normalize_text(value) for value in (settings.get("titleIncludes") or []) if normalize_text(value)]
    if match_title:
        title = normalize_text(entry.get("title")).casefold()
        if match_title.casefold() not in title:
            return False
    if title_includes:
        title = normalize_text(entry.get("title")).casefold()
        if not any(candidate.casefold() in title for candidate in title_includes):
            return False
    return True


def fetch_page_html(url: str) -> str:
    request = Request(url, headers={
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    })
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def fetch_json_url(url: str) -> dict[str, Any]:
    request = Request(url, headers={
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.bilibili.com/",
    })
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


def detect_bilibili_anti_crawl_signals(text: str) -> list[str]:
    normalized = normalize_text(text).lower()
    signals: list[str] = []
    if not normalized:
        return signals
    if any(token in normalized for token in ("验证码", "安全验证", "请完成验证", "challenge", "captcha", "verify")):
        signals.append("verify")
    if any(token in normalized for token in ("访问频繁", "稍后再试", "请求过于频繁", "rate limit", "too many requests", "风控")):
        signals.append("rate-limit")
    return sorted(set(signals))


def detect_bilibili_login_required(text: str) -> bool:
    normalized = normalize_text(text).lower()
    if not normalized:
        return False
    return any(token in normalized for token in (
        "请先登录",
        "登录后查看",
        "登录后可见",
        "登录后继续",
        "login",
        "sign in",
    ))


def run_browser_link_extractor(
    item_url: str,
    settings: dict[str, Any],
    *,
    max_items: int,
    runner: Callable[..., subprocess.CompletedProcess[str]] = run_subprocess,
) -> list[dict[str, Any]]:
    node_path = resolve_tool_path("node", settings.get("nodePath"), required=False)
    if not node_path:
        return []

    script_path = REPO_ROOT / "scripts" / "extract-bilibili-links.mjs"
    if not script_path.exists():
        return []

    args = [
        node_path,
        str(script_path),
        item_url,
        "--max-items",
        str(max(1, int(max_items))),
        "--timeout",
        str(max(5_000, int(settings.get("browserFallbackTimeoutMs") or 20_000))),
    ]
    if settings.get("reuseLoginState"):
        args.append("--reuse-login-state")
    else:
        args.append("--no-reuse-login-state")
    if settings.get("profileRoot"):
        args.extend(["--profile-root", str(settings["profileRoot"])])
    if settings.get("browserPath"):
        args.extend(["--browser-path", str(settings["browserPath"])])
    if settings.get("browserFallbackHeadless", True):
        args.append("--headless")
    else:
        args.append("--no-headless")

    completed = runner(args, cwd=REPO_ROOT, allow_failure=True)
    if completed.returncode != 0:
        return []
    try:
        payload = json.loads(completed.stdout or "{}")
    except json.JSONDecodeError:
        return []

    entries = []
    for item in payload.get("entries") or []:
        normalized = normalize_playlist_entry(item)
        if normalized and entry_matches_filters(normalized, settings):
            entries.append(normalized)
    return entries


def extract_video_entries_from_html(url: str, html: str, settings: dict[str, Any]) -> list[dict[str, Any]]:
    matches = re.findall(r"https://www\.bilibili\.com/video/(BV[0-9A-Za-z]+)/?", html, flags=re.IGNORECASE)
    if not matches:
        matches = re.findall(r'"/video/(BV[0-9A-Za-z]+)/?', html, flags=re.IGNORECASE)
    seen: set[str] = set()
    entries: list[dict[str, Any]] = []
    for match in matches:
        bvid = match.upper()
        resolved_url = f"https://www.bilibili.com/video/{bvid}/"
        if resolved_url in seen:
            continue
        seen.add(resolved_url)
        entry = {
            "resolvedUrl": resolved_url,
            "contentId": bvid,
            "title": bvid,
        }
        if entry_matches_filters(entry, settings):
            entries.append(entry)
    return entries


def extract_channel_entries_from_api(item_url: str, playlist_start: int, playlist_end: int, settings: dict[str, Any]) -> list[dict[str, Any]]:
    parsed = urlparse(item_url)
    if not parsed.path.startswith("/v/popular"):
        return []
    desired_count = playlist_end - playlist_start + 1
    page_size = max(20, min(50, desired_count + playlist_start))
    page_number = max(1, ((playlist_start - 1) // page_size) + 1)
    start_offset = (playlist_start - 1) % page_size
    payload = fetch_json_url(f"https://api.bilibili.com/x/web-interface/popular?pn={page_number}&ps={page_size}")
    items = (((payload.get("data") or {}).get("list")) or [])[start_offset:start_offset + desired_count]
    entries: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        bvid = normalize_text(item.get("bvid"))
        if not bvid:
            continue
        entry = {
            "resolvedUrl": f"https://www.bilibili.com/video/{bvid}/",
            "contentId": bvid,
            "title": normalize_text(item.get("title")) or bvid,
        }
        if entry_matches_filters(entry, settings):
            entries.append(entry)
    return entries


def slice_entries_for_window(entries: list[dict[str, Any]], playlist_start: int, playlist_end: int) -> list[dict[str, Any]]:
    start_index = max(0, playlist_start - 1)
    desired_count = max(0, playlist_end - playlist_start + 1)
    return entries[start_index:start_index + desired_count]


def extract_favorite_entries_from_api(item_url: str, playlist_start: int, playlist_end: int, settings: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None, int]:
    parsed = urlparse(item_url)
    if parsed.hostname != "space.bilibili.com" or "/favlist" not in parsed.path:
        return [], None, 0
    query = parse_qs(parsed.query)
    media_id = normalize_text((query.get("fid") or query.get("media_id") or [""])[0])
    if not media_id:
        return [], None, 0

    desired_count = playlist_end - playlist_start + 1
    page_size = max(20, min(50, desired_count + playlist_start))
    page_number = max(1, ((playlist_start - 1) // page_size) + 1)
    start_offset = (playlist_start - 1) % page_size
    payload = fetch_json_url(
        f"https://api.bilibili.com/x/v3/fav/resource/list?media_id={media_id}&pn={page_number}&ps={page_size}&keyword=&order=mtime&type=0&tid=0&platform=web"
    )
    data = payload.get("data") or {}
    items = ((data.get("medias") or []) if isinstance(data.get("medias"), list) else [])[start_offset:start_offset + desired_count]
    entries: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        bvid = normalize_text(item.get("bvid"))
        if not bvid:
            continue
        entry = {
            "resolvedUrl": f"https://www.bilibili.com/video/{bvid}/",
            "contentId": bvid,
            "title": normalize_text(item.get("title")) or bvid,
        }
        if entry_matches_filters(entry, settings):
            entries.append(entry)
    info = data.get("info") or {}
    playlist_title = normalize_text(info.get("title")) or None
    playlist_item_count = int(info.get("media_count") or len(entries) or 0)
    return entries, playlist_title, playlist_item_count


def normalize_api_archive_entry(item: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    bvid = normalize_text(item.get("bvid"))
    if not bvid:
        return None
    return {
        "resolvedUrl": f"https://www.bilibili.com/video/{bvid}/",
        "contentId": bvid,
        "title": normalize_text(item.get("title")) or bvid,
    }


def extract_collection_entries_from_api(item_url: str, playlist_start: int, playlist_end: int, settings: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None, int]:
    parsed = urlparse(item_url)
    if parsed.hostname != "space.bilibili.com":
        return [], None, 0
    query = parse_qs(parsed.query)
    sid = normalize_text((query.get("sid") or [""])[0])
    mid = normalize_text(next((segment for segment in parsed.path.split("/") if segment.isdigit()), ""))
    if not sid or not mid:
        return [], None, 0

    desired_count = playlist_end - playlist_start + 1
    page_size = max(20, min(50, desired_count + playlist_start))
    page_number = max(1, ((playlist_start - 1) // page_size) + 1)

    def build_from_payload(payload: dict[str, Any], *, list_key: str, meta_key: str) -> tuple[list[dict[str, Any]], str | None, int]:
        data = payload.get("data") or {}
        items_lists = data.get("items_lists") or data
        group_items = items_lists.get(list_key) or []
        for group in group_items:
            meta = group.get(meta_key) or group.get("meta") or {}
            candidate_id = normalize_text(meta.get("season_id") or meta.get("series_id") or meta.get("id"))
            if candidate_id != sid:
                continue
            archives = group.get("archives") or []
            normalized_entries = [
                normalized
                for normalized in (normalize_api_archive_entry(item) for item in archives)
                if normalized and entry_matches_filters(normalized, settings)
            ]
            playlist_title = normalize_text(meta.get("name")) or normalize_text(meta.get("title")) or None
            return slice_entries_for_window(normalized_entries, playlist_start, playlist_end), playlist_title, len(normalized_entries)
        return [], None, 0

    if "/channel/collectiondetail" in parsed.path:
        payload = fetch_json_url(
            f"https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?mid={mid}&season_id={sid}&page_num={page_number}&page_size={page_size}"
        )
        if payload.get("code") == 0 and payload.get("data"):
            archives = ((payload.get("data") or {}).get("archives") or [])
            normalized_entries = [
                normalized
                for normalized in (normalize_api_archive_entry(item) for item in archives)
                if normalized and entry_matches_filters(normalized, settings)
            ]
            meta = (payload.get("data") or {}).get("meta") or {}
            return slice_entries_for_window(normalized_entries, playlist_start, playlist_end), normalize_text(meta.get("name")) or None, len(normalized_entries)

        fallback_payload = fetch_json_url(
            f"https://api.bilibili.com/x/polymer/web-space/seasons_series_list?mid={mid}&page_num=1&page_size=20"
        )
        entries, title, total = build_from_payload(fallback_payload, list_key="seasons_list", meta_key="meta")
        return entries, title, total

    payload = fetch_json_url(
        f"https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?mid={mid}&series_id={sid}&page_num={page_number}&page_size={page_size}"
    )
    if payload.get("code") == 0 and payload.get("data"):
        archives = ((payload.get("data") or {}).get("archives") or [])
        normalized_entries = [
            normalized
            for normalized in (normalize_api_archive_entry(item) for item in archives)
            if normalized and entry_matches_filters(normalized, settings)
        ]
        meta = (payload.get("data") or {}).get("meta") or {}
        return slice_entries_for_window(normalized_entries, playlist_start, playlist_end), normalize_text(meta.get("name")) or None, len(normalized_entries)

    fallback_payload = fetch_json_url(
        f"https://api.bilibili.com/x/polymer/web-space/seasons_series_list?mid={mid}&page_num=1&page_size=20"
    )
    entries, title, total = build_from_payload(fallback_payload, list_key="series_list", meta_key="meta")
    return entries, title, total


def enumerate_playlist_video_urls(
    item: dict[str, Any],
    settings: dict[str, Any],
    tool_state: dict[str, Any],
    config: dict[str, Any],
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]] = run_subprocess,
) -> dict[str, Any]:
    playlist_start, playlist_end = resolve_playlist_window(settings, config)
    resolved_entries: list[dict[str, Any]] = []
    playlist_title = None
    playlist_item_count = 0
    used_paths: list[str] = []
    anti_crawl_signals: list[str] = []
    reason_code: str | None = None
    reason_detail: str | None = None
    html = ""
    auth_required = item["inputKind"] in {"favorite-list", "watch-later-list"}
    auth_available = bool(tool_state.get("usedLoginState")) if auth_required else None
    try:
        used_paths.append("yt-dlp-flat-playlist")
        playlist = run_ytdlp_json(
            item["normalizedUrl"],
            settings,
            tool_state,
            flat_playlist=True,
            playlist_start=playlist_start,
            playlist_end=playlist_end,
            runner=runner,
        )
        entries = playlist.get("entries") or []
        desired_count = playlist_end - playlist_start + 1
        if playlist_start > 1 and len(entries) > desired_count:
            entries = entries[playlist_start - 1:playlist_end]
        elif len(entries) > desired_count:
            entries = entries[:desired_count]
        seen: set[str] = set()
        for entry in entries:
            normalized_entry = normalize_playlist_entry(entry)
            if not normalized_entry or normalized_entry["resolvedUrl"] in seen or not entry_matches_filters(normalized_entry, settings):
                continue
            seen.add(normalized_entry["resolvedUrl"])
            resolved_entries.append(normalized_entry)
        playlist_title = playlist.get("title")
        playlist_item_count = len(entries)
    except DownloadBilibiliError:
        if item["inputKind"] not in {"channel-list", "collection-list", "favorite-list"}:
            raise
        if item["inputKind"] == "favorite-list":
            used_paths.append("favorite-api")
            resolved_entries, playlist_title, playlist_item_count = extract_favorite_entries_from_api(
                item["normalizedUrl"],
                playlist_start,
                playlist_end,
                settings,
            )
        elif item["inputKind"] == "collection-list":
            used_paths.append("collection-api")
            resolved_entries, playlist_title, playlist_item_count = extract_collection_entries_from_api(
                item["normalizedUrl"],
                playlist_start,
                playlist_end,
                settings,
            )
        else:
            used_paths.append("channel-api")
            resolved_entries = extract_channel_entries_from_api(item["normalizedUrl"], playlist_start, playlist_end, settings)
        if not resolved_entries:
            used_paths.append("html-fallback")
            html = fetch_page_html(item["normalizedUrl"])
            resolved_entries = extract_video_entries_from_html(item["normalizedUrl"], html, settings)
        desired_count = playlist_end - playlist_start + 1
        resolved_entries = resolved_entries[:desired_count]
        playlist_title = playlist_title or item["normalizedUrl"]
        playlist_item_count = playlist_item_count or len(resolved_entries)

    if not resolved_entries and item["inputKind"] in {
        "favorite-list",
        "watch-later-list",
        "collection-list",
        "channel-list",
    }:
        desired_count = playlist_end - playlist_start + 1
        used_paths.append("browser-fallback")
        resolved_entries = run_browser_link_extractor(
            item["normalizedUrl"],
            settings,
            max_items=desired_count,
            runner=runner,
        )[:desired_count]
        playlist_title = playlist_title or item["normalizedUrl"]
        playlist_item_count = len(resolved_entries)

    if not resolved_entries:
        anti_crawl_signals = detect_bilibili_anti_crawl_signals(html)
        if auth_required and auth_available is False:
            reason_code = "not-logged-in"
            reason_detail = "The requested bilibili list requires a reusable logged-in profile."
        elif anti_crawl_signals:
            if "verify" in anti_crawl_signals:
                reason_code = "anti-crawl-verify"
            elif "rate-limit" in anti_crawl_signals:
                reason_code = "anti-crawl-rate-limit"
            else:
                reason_code = "anti-crawl"
            reason_detail = "Bilibili returned verification or rate-limit signals while enumerating this list."
        elif detect_bilibili_login_required(html):
            reason_code = "not-logged-in"
            reason_detail = "The bilibili page indicates login is required before listing content."
        elif item["inputKind"] == "favorite-list" and playlist_item_count == 0:
            reason_code = "content-empty"
            reason_detail = "Favorite list enumeration returned media_count=0."
        elif item["inputKind"] in {"collection-list", "channel-list"} and playlist_item_count == 0:
            reason_code = "content-empty"
            reason_detail = f"{item['inputKind']} enumeration returned zero items."
        elif item["inputKind"] == "watch-later-list":
            reason_code = "unknown-empty"
            reason_detail = "Watch-later enumeration returned no items after all fallbacks."
        elif item["inputKind"] == "author-video-list":
            reason_code = "unknown-empty"
            reason_detail = "Author video enumeration returned no items after all fallbacks."
        else:
            reason_code = "unknown-empty"
            reason_detail = "Playlist enumeration returned no items after all fallbacks."

    return {
        "source": item["normalizedUrl"],
        "inputKind": item["inputKind"],
        "title": playlist_title,
        "resolvedVideoUrls": [entry["resolvedUrl"] for entry in resolved_entries],
        "resolvedEntries": resolved_entries,
        "playlistItemCount": playlist_item_count,
        "playlistStart": playlist_start,
        "playlistEnd": playlist_end,
        "diagnostics": {
            "status": "ok" if resolved_entries else "empty",
            "reasonCode": reason_code,
            "reasonDetail": reason_detail,
            "usedPaths": used_paths,
            "antiCrawlSignals": anti_crawl_signals,
            "authRequired": auth_required,
            "authAvailable": auth_available,
        },
    }


def extract_content_identifier(metadata: dict[str, Any], fallback_url: str) -> str:
    for key in ("bvid", "id", "season_id", "episode_id", "aid"):
        value = metadata.get(key)
        if value:
            return normalize_text(value)
    parsed = urlparse(fallback_url)
    parts = [part for part in parsed.path.split("/") if part]
    if parts:
        return normalize_text(parts[-1])
    return sha256_text(fallback_url)[:12]


def resolve_download_tasks(
    input_items: list[dict[str, Any]],
    settings: dict[str, Any],
    profile: dict[str, Any],
    tool_state: dict[str, Any],
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]] = run_subprocess,
) -> dict[str, Any]:
    config = resolve_downloader_config(profile)
    resolved_items: list[dict[str, Any]] = []
    tasks: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    playlist_kinds = {
        "author-video-list",
        "favorite-list",
        "watch-later-list",
        "collection-list",
        "channel-list",
    }

    for item in input_items:
        if item["inputKind"] in playlist_kinds:
            enumeration = enumerate_playlist_video_urls(
                item,
                settings,
                tool_state,
                config,
                runner=runner,
            )
            resolved_items.append(enumeration)
            for resolved_entry in enumeration["resolvedEntries"]:
                resolved_url = resolved_entry["resolvedUrl"]
                if resolved_url in seen_urls:
                    continue
                seen_urls.add(resolved_url)
                tasks.append({
                    "source": item["normalizedUrl"],
                    "inputKind": item["inputKind"],
                    "resolvedUrl": resolved_url,
                    "contentId": resolved_entry.get("contentId"),
                    "entryTitle": resolved_entry.get("title"),
                })
            continue

        resolved_items.append({
            "source": item["normalizedUrl"],
            "inputKind": item["inputKind"],
            "resolvedVideoUrls": [item["normalizedUrl"]],
        })
        if item["normalizedUrl"] not in seen_urls:
            seen_urls.add(item["normalizedUrl"])
            tasks.append({
                "source": item["normalizedUrl"],
                "inputKind": item["inputKind"],
                "resolvedUrl": item["normalizedUrl"],
            })

    return {
        "resolvedItems": resolved_items,
        "tasks": tasks,
        "config": config,
    }


def input_items_require_auto_login_bootstrap(input_items: list[dict[str, Any]]) -> bool:
    return any(item.get("inputKind") in AUTO_LOGIN_REQUIRED_INPUT_KINDS for item in input_items)


def run_site_login_bootstrap(
    settings: dict[str, Any],
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]] = run_subprocess,
) -> dict[str, Any]:
    node_path = resolve_tool_path("node", settings.get("nodePath"), required=False) or "node"
    script_path = REPO_ROOT / "scripts" / "site-login.mjs"
    if not script_path.exists():
        raise DownloadBilibiliError(f"Missing bilibili site-login helper: {script_path}")

    args = [
        node_path,
        str(script_path),
        "https://www.bilibili.com/",
        "--reuse-login-state",
        "--auto-login",
        "--no-headless",
    ]
    if settings.get("profileRoot"):
        args.extend(["--browser-profile-root", str(settings["profileRoot"])])
    if settings.get("profilePath"):
        args.extend(["--profile-path", str(settings["profilePath"])])
    if settings.get("browserPath"):
        args.extend(["--browser-path", str(settings["browserPath"])])

    completed = runner(args, cwd=REPO_ROOT, allow_failure=True)
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or f"site-login exited with code {completed.returncode}"
        raise DownloadBilibiliError(f"Automatic bilibili login bootstrap failed: {detail}")
    try:
        payload = json.loads(completed.stdout or "{}")
    except json.JSONDecodeError as error:
        raise DownloadBilibiliError(f"Automatic bilibili login bootstrap returned invalid JSON: {error}") from error
    if not isinstance(payload, dict):
        raise DownloadBilibiliError("Automatic bilibili login bootstrap returned an unexpected payload.")
    auth_payload = payload.get("auth") or {}
    if auth_payload.get("persistenceVerified") is not True:
        status = auth_payload.get("status") or "unknown"
        raise DownloadBilibiliError(
            f"Automatic bilibili login bootstrap did not produce a reusable session (status={status})."
        )
    return payload


def maybe_bootstrap_login_for_downloads(
    input_items: list[dict[str, Any]],
    settings: dict[str, Any],
    downloader_config: dict[str, Any],
    tool_state: dict[str, Any],
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]] = run_subprocess,
    bootstrap_runner: Callable[..., dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    if not settings.get("reuseLoginState"):
        return tool_state, None
    if settings.get("allowAutoLoginBootstrap") is False:
        return tool_state, None
    if tool_state.get("usedLoginState"):
        return tool_state, None
    if not input_items_require_auto_login_bootstrap(input_items):
        return tool_state, None

    bootstrap = (bootstrap_runner or run_site_login_bootstrap)(settings, runner=runner)
    refreshed_tool_state = resolve_tool_state(settings, downloader_config)
    if not refreshed_tool_state.get("usedLoginState"):
        raise DownloadBilibiliError(
            "Automatic bilibili login bootstrap completed, but the persistent profile still does not expose a reusable login state."
        )
    refreshed_tool_state["warnings"] = list(refreshed_tool_state.get("warnings") or [])
    refreshed_tool_state["warnings"].append(
        "Reusable bilibili login state was bootstrapped automatically before resolving authenticated download inputs."
    )
    return refreshed_tool_state, {
        "attempted": True,
        "status": (bootstrap.get("auth") or {}).get("status"),
        "persistenceVerified": (bootstrap.get("auth") or {}).get("persistenceVerified") is True,
        "profileDir": (bootstrap.get("site") or {}).get("userDataDir"),
    }


def resolve_output_root(settings: dict[str, Any], downloader_config: dict[str, Any]) -> Path:
    if settings.get("outDir"):
        return Path(settings["outDir"]).resolve()
    configured = downloader_config.get("defaultOutputRoot") or DEFAULT_OUTPUT_ROOT
    candidate = Path(str(configured))
    if not candidate.is_absolute():
        candidate = REPO_ROOT / candidate
    return candidate.resolve()


def sanitize_identifier(identifier: str, fallback: str = "video") -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", normalize_text(identifier))
    value = re.sub(r"-+", "-", value).strip("-")
    return value or fallback


def determine_task_directory(
    run_dir: Path,
    index: int,
    metadata: dict[str, Any],
    fallback_url: str,
    naming_strategy: str,
) -> Path:
    identifier = extract_content_identifier(metadata, fallback_url)
    title = normalize_text(metadata.get("title")) or identifier
    slug = slugify_ascii(title, fallback=identifier.lower())
    if naming_strategy == "stable-id":
        return run_dir / f"{index:03d}_{sanitize_identifier(identifier)}_{sanitize_identifier(slug)}"
    return run_dir / f"{index:03d}_{sanitize_identifier(slug)}_{sanitize_identifier(identifier)}"


def build_metadata_payload(
    metadata: dict[str, Any],
    *,
    source: str,
    final_url: str,
    output_path: str | None,
    used_login_state: bool,
    quality: dict[str, Any] | None = None,
    verification: dict[str, Any] | None = None,
) -> dict[str, Any]:
    requested_formats = metadata.get("requested_formats") or metadata.get("requested_downloads") or []
    return {
        "source": source,
        "finalUrl": final_url,
        "id": metadata.get("id"),
        "bvid": metadata.get("bvid"),
        "aid": metadata.get("aid"),
        "title": metadata.get("title"),
        "uploader": metadata.get("uploader"),
        "uploaderId": metadata.get("uploader_id"),
        "channelId": metadata.get("channel_id"),
        "duration": metadata.get("duration"),
        "webpageUrl": metadata.get("webpage_url") or final_url,
        "outputPath": output_path,
        "usedLoginState": used_login_state,
        "requestedFormats": requested_formats,
        "formatId": metadata.get("format_id"),
        "ext": metadata.get("ext"),
        "quality": quality,
        "verification": verification,
        "downloadedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def infer_classification_page_type(metadata: dict[str, Any], final_url: str) -> str | None:
    webpage_url = normalize_url_no_fragment(metadata.get("webpage_url") or final_url or "")
    if not webpage_url:
        return None
    try:
        parsed = urlparse(webpage_url)
    except Exception:
        return None
    path_value = parsed.path or ""
    if "/bangumi/play/" in path_value:
        return "bangumi-detail"
    if "/video/" in path_value:
        return "video-detail"
    return None


def classify_downloaded_content(metadata: dict[str, Any], final_url: str) -> dict[str, Any]:
    page_type = infer_classification_page_type(metadata, final_url)
    duration_seconds = None
    raw_duration = metadata.get("duration")
    try:
        duration_seconds = int(float(raw_duration)) if raw_duration is not None else None
    except Exception:
        duration_seconds = None

    if page_type == "bangumi-detail":
        tier = "long-video"
    elif duration_seconds is not None and duration_seconds >= 600:
        tier = "long-video"
    else:
        tier = "short-video"

    return {
        "pageType": page_type,
        "durationSeconds": duration_seconds,
        "tier": tier,
    }


def determine_quality_selection_reason(
    *,
    target_height: int | None,
    target_codec: str | None,
    selected_height: int | None,
    selected_video_codec: str | None,
) -> str:
    normalized_codec = normalize_text(selected_video_codec).lower() or None
    normalized_target = normalize_text(target_codec).lower() or None
    if target_height and selected_height == target_height:
        if normalized_target and normalized_codec == normalized_target:
            return "target-met"
        if normalized_target:
            return "same-height-codec-downgrade"
    if target_height and selected_height is not None and selected_height < target_height:
        return "height-downgrade"
    return "best-available-fallback"


def locate_downloaded_video(task_dir: Path, output_basename: str = "video") -> Path | None:
    candidates = [
        path
        for path in sorted(task_dir.iterdir())
        if path.is_file()
        and path.suffix.lower() not in {".json", ".part", ".ytdl"}
    ]
    return candidates[0] if candidates else None


def render_output_template(task_dir: Path, metadata: dict[str, Any], settings: dict[str, Any]) -> str:
    filename_template = normalize_text(settings.get("filenameTemplate"))
    if not filename_template:
        return str(task_dir / "video.%(ext)s")
    values = {
        "bvid": normalize_text(metadata.get("bvid")) or normalize_text(metadata.get("id")) or "video",
        "aid": normalize_text(metadata.get("aid")) or "",
        "id": normalize_text(metadata.get("id")) or "",
        "title": sanitize_identifier(slugify_ascii(normalize_text(metadata.get("title")) or "video", fallback="video")),
    }
    rendered = filename_template
    for key, value in values.items():
        rendered = rendered.replace(f"{{{key}}}", value)
    rendered = sanitize_identifier(rendered, fallback="video")
    return str(task_dir / f"{rendered}.%(ext)s")


def resolve_ffprobe_path(ffmpeg_path: str | None, explicit_path: str | None = None) -> str | None:
    explicit = resolve_tool_path("ffprobe", explicit_path, required=False)
    if explicit:
        return explicit
    if ffmpeg_path:
        sibling = Path(ffmpeg_path).resolve().with_name("ffprobe.exe" if sys.platform == "win32" else "ffprobe")
        if sibling.exists():
            return str(sibling)
    return resolve_tool_path("ffprobe", required=False)


def verify_downloaded_file(
    file_path: Path,
    tool_state: dict[str, Any],
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]] = run_subprocess,
) -> dict[str, Any]:
    result = {
        "ok": False,
        "exists": file_path.exists(),
        "sizeBytes": file_path.stat().st_size if file_path.exists() else 0,
        "ffprobeAvailable": bool(tool_state.get("ffprobePath")),
        "duration": None,
        "streams": [],
        "error": None,
    }
    if not result["exists"]:
        result["error"] = "Validation failed: downloaded file was not found."
        return result
    if result["sizeBytes"] <= 0:
        result["error"] = "Validation failed: downloaded file is empty."
        return result
    if not tool_state.get("ffprobePath"):
        result["ok"] = True
        return result

    completed = runner(
        [
            tool_state["ffprobePath"],
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
            str(file_path),
        ],
        cwd=REPO_ROOT,
        allow_failure=True,
    )
    if completed.returncode != 0:
        result["error"] = completed.stderr.strip() or f"ffprobe exited with code {completed.returncode}"
        return result
    try:
        payload = json.loads(completed.stdout or "{}")
    except json.JSONDecodeError as error:
        result["error"] = f"Failed to parse ffprobe output: {error}"
        return result
    streams = payload.get("streams") or []
    format_info = payload.get("format") or {}
    duration_value = format_info.get("duration")
    result["streams"] = [stream.get("codec_type") for stream in streams if isinstance(stream, dict)]
    try:
        result["duration"] = float(duration_value) if duration_value is not None else None
    except Exception:
        result["duration"] = None
    has_video_stream = any(stream.get("codec_type") == "video" for stream in streams if isinstance(stream, dict))
    result["ok"] = has_video_stream and (result["duration"] is None or result["duration"] > 0)
    if not result["ok"] and not result["error"]:
        result["error"] = "Validation failed: ffprobe did not report a valid video stream or duration."
    return result


def build_history_keys(metadata: dict[str, Any], source: str, final_url: str) -> set[str]:
    keys = {
        normalize_text(source),
        normalize_text(final_url),
        normalize_text(metadata.get("id")),
        normalize_text(metadata.get("bvid")),
        normalize_text(metadata.get("aid")),
    }
    return {key for key in keys if key}


def build_archive_keys(metadata: dict[str, Any], source: str, final_url: str) -> set[str]:
    keys = {
        f"source:{normalize_text(source)}",
        f"url:{normalize_text(final_url)}",
    }
    for key in ("bvid", "aid", "id", "season_id", "episode_id"):
        value = normalize_text(metadata.get(key))
        if value:
            keys.add(f"{key}:{value}")
    return {key for key in keys if ":" in key and key.split(":", 1)[1]}


def load_download_archive(path_value: Path) -> set[str]:
    if not path_value.exists():
        return set()
    entries: set[str] = set()
    for line in path_value.read_text(encoding="utf-8").splitlines():
        text = normalize_text(line)
        if text:
            entries.add(text)
    return entries


def append_download_archive(path_value: Path, entries: set[str], archive_state: dict[str, Any] | None = None) -> None:
    if not entries:
        return
    lock = archive_state.get("lock") if isinstance(archive_state, dict) else None
    known_entries = archive_state.get("entries") if isinstance(archive_state, dict) else None
    if lock:
        lock.acquire()
    try:
        missing = set(entries)
        if isinstance(known_entries, set):
            missing = {entry for entry in missing if entry not in known_entries}
        if not missing:
            return
        path_value.parent.mkdir(parents=True, exist_ok=True)
        with path_value.open("a", encoding="utf-8") as handle:
            for entry in sorted(missing):
                handle.write(f"{entry}\n")
        if isinstance(known_entries, set):
            known_entries.update(missing)
    finally:
        if lock:
            lock.release()


def load_existing_task_history(host_root: Path) -> dict[str, dict[str, Any]]:
    history: dict[str, dict[str, Any]] = {}
    if not host_root.exists():
        return history
    for manifest_path in sorted(host_root.rglob("download-manifest.json")):
        try:
            payload = load_json(manifest_path)
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue
        records = []
        if "status" in payload:
            records.append(payload)
        else:
            records.extend(item for item in (payload.get("results") or []) if isinstance(item, dict))
        for record_payload in records:
            task_dir = Path(record_payload.get("taskDir") or manifest_path.parent)
            metadata_path = task_dir / "metadata.json"
            metadata = load_json(metadata_path) if metadata_path.exists() else {}
            record = {
                "manifestPath": str(manifest_path),
                "taskDir": str(task_dir),
                "status": record_payload.get("status"),
                "outputPath": record_payload.get("outputPath"),
                "metadata": metadata,
                "source": normalize_text(record_payload.get("source") or metadata.get("source")),
                "finalUrl": normalize_text(record_payload.get("finalUrl") or metadata.get("finalUrl")),
                "updatedAt": manifest_path.stat().st_mtime,
            }
            for key in build_history_keys(metadata, record["source"], record["finalUrl"]):
                existing = history.get(key)
                if existing and existing["updatedAt"] > record["updatedAt"]:
                    continue
                history[key] = record
    return history


def resolve_existing_record(
    metadata: dict[str, Any],
    source: str,
    final_url: str,
    history_index: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    for key in build_history_keys(metadata, source, final_url):
        record = history_index.get(key)
        if record:
            return record
    return None


def build_quality_summary(
    metadata: dict[str, Any],
    *,
    settings: dict[str, Any],
    used_login_state: bool,
    requires_login_for_highest_quality: bool,
) -> dict[str, Any]:
    requested_formats = metadata.get("requested_formats") or metadata.get("requested_downloads") or []
    selected_video = None
    selected_audio = None
    for item in requested_formats:
        if not isinstance(item, dict):
            continue
        if item.get("vcodec") and item.get("vcodec") != "none" and not selected_video:
            selected_video = item
        if item.get("acodec") and item.get("acodec") != "none" and not selected_audio:
            selected_audio = item
    classification = classify_downloaded_content(metadata, metadata.get("webpage_url") or "")
    target_height = settings.get("maxHeight")
    target_codec = settings.get("codecPreference") or "auto"
    selected_height = selected_video.get("height") if isinstance(selected_video, dict) else metadata.get("height")
    selection_reason = determine_quality_selection_reason(
        target_height=target_height,
        target_codec=target_codec if target_codec != "auto" else None,
        selected_height=selected_height,
        selected_video_codec=selected_video.get("vcodec") if isinstance(selected_video, dict) else metadata.get("vcodec"),
    )
    return {
        "classification": classification,
        "requestedFormat": build_format_selector(settings),
        "codecPreference": settings.get("codecPreference") or "auto",
        "maxHeight": settings.get("maxHeight"),
        "container": settings.get("container") or DEFAULT_CONTAINER,
        "targetHeight": target_height,
        "targetCodec": target_codec,
        "fallbackPolicy": settings.get("fallbackPolicy") or DEFAULT_FALLBACK_POLICY,
        "requiresLoginForHighestQuality": requires_login_for_highest_quality,
        "usedLoginState": used_login_state,
        "highestQualityMayBeLimited": bool(requires_login_for_highest_quality and not used_login_state),
        "selectedFormatId": metadata.get("format_id"),
        "selectedVideoFormatId": selected_video.get("format_id") if isinstance(selected_video, dict) else None,
        "selectedAudioFormatId": selected_audio.get("format_id") if isinstance(selected_audio, dict) else None,
        "selectedVideoCodec": selected_video.get("vcodec") if isinstance(selected_video, dict) else metadata.get("vcodec"),
        "selectedAudioCodec": selected_audio.get("acodec") if isinstance(selected_audio, dict) else metadata.get("acodec"),
        "selectedHeight": selected_height,
        "selectionReason": selection_reason,
    }


def execute_download_task(
    task: dict[str, Any],
    *,
    index: int,
    run_dir: Path,
    settings: dict[str, Any],
    tool_state: dict[str, Any],
    downloader_config: dict[str, Any],
    history_index: dict[str, dict[str, Any]],
    archive_state: dict[str, Any] | None = None,
    runner: Callable[..., subprocess.CompletedProcess[str]] = run_subprocess,
) -> dict[str, Any]:
    metadata = run_ytdlp_json(
        task["resolvedUrl"],
        settings,
        tool_state,
        no_playlist=True,
        runner=runner,
    )
    final_url = metadata.get("webpage_url") or task["resolvedUrl"]
    quality = build_quality_summary(
        metadata,
        settings=settings,
        used_login_state=tool_state.get("usedLoginState", False),
        requires_login_for_highest_quality=downloader_config.get("requiresLoginForHighestQuality", False),
    )
    archive_keys = build_archive_keys(metadata, task["source"], final_url)
    existing_record = resolve_existing_record(metadata, task["source"], final_url, history_index)
    existing_output_path = None
    if existing_record and existing_record.get("outputPath"):
        existing_output_path = Path(existing_record["outputPath"])

    if settings.get("retryFailedOnly"):
        previous_status = existing_record.get("status") if existing_record else None
        if previous_status not in {"failed", "planned"}:
            return {
                "source": task["source"],
                "inputKind": task["inputKind"],
                "finalUrl": final_url,
                "title": metadata.get("title"),
                "outputPath": str(existing_output_path.resolve()) if existing_output_path and existing_output_path.exists() else None,
                "status": "skipped",
                "error": None,
                "usedLoginState": tool_state.get("usedLoginState", False),
                "taskDir": existing_record.get("taskDir") if existing_record else None,
                "verification": None,
                "quality": quality,
                "note": "No previous failed or incomplete download attempt matched this item.",
            }

    if settings.get("skipExisting") and existing_record and existing_record.get("status") == "success" and existing_output_path and existing_output_path.exists():
        verification = verify_downloaded_file(existing_output_path, tool_state, runner=runner) if settings.get("verifyDownload", True) else None
        if verification is None or verification.get("ok"):
            return {
                "source": task["source"],
                "inputKind": task["inputKind"],
                "finalUrl": final_url,
                "title": metadata.get("title"),
                "outputPath": str(existing_output_path.resolve()),
                "status": "skipped",
                "error": None,
                "usedLoginState": tool_state.get("usedLoginState", False),
                "taskDir": str(existing_output_path.parent),
                "verification": verification,
                "quality": quality,
                "archiveKeys": sorted(archive_keys),
                "note": "Skipped existing verified download.",
            }

    archive_entries = archive_state.get("entries") if isinstance(archive_state, dict) else None
    if settings.get("skipExisting") and isinstance(archive_entries, set) and archive_keys.intersection(archive_entries):
        return {
            "source": task["source"],
            "inputKind": task["inputKind"],
            "finalUrl": final_url,
            "title": metadata.get("title"),
            "outputPath": str(existing_output_path.resolve()) if existing_output_path and existing_output_path.exists() else None,
            "status": "skipped",
            "error": None,
            "usedLoginState": tool_state.get("usedLoginState", False),
            "taskDir": existing_record.get("taskDir") if existing_record else None,
            "verification": None,
            "quality": quality,
            "archiveKeys": sorted(archive_keys),
            "note": "Skipped because this content identifier already exists in download-archive.",
        }

    task_dir = None
    if settings.get("resume") and existing_record and existing_record.get("status") in {"failed", "planned"} and existing_record.get("taskDir"):
        candidate_dir = Path(existing_record["taskDir"])
        if candidate_dir.exists():
            task_dir = candidate_dir
    if task_dir is None:
        task_dir = determine_task_directory(
            run_dir,
            index,
            metadata,
            task["resolvedUrl"],
            settings.get("namingStrategy") or DEFAULT_NAMING_STRATEGY,
        )
    task_dir.mkdir(parents=True, exist_ok=True)

    if settings["dryRun"]:
        result = {
            "source": task["source"],
            "inputKind": task["inputKind"],
            "finalUrl": final_url,
            "title": metadata.get("title"),
            "outputPath": None,
            "status": "planned",
            "error": None,
            "usedLoginState": tool_state.get("usedLoginState", False),
            "taskDir": str(task_dir),
            "verification": None,
            "quality": quality,
            "archiveKeys": sorted(archive_keys),
            "note": "Dry run only; download was not executed.",
        }
        metadata_payload = build_metadata_payload(
            metadata,
            source=task["source"],
            final_url=final_url,
            output_path=None,
            used_login_state=result["usedLoginState"],
            quality=quality,
            verification=None,
        )
        write_json(task_dir / "metadata.json", metadata_payload)
        write_json(task_dir / "download-manifest.json", result)
        return result

    attempts = max(0, int(settings.get("taskRetries") or 0)) + 1
    verification = None
    output_path = None
    last_error = None
    for attempt in range(1, attempts + 1):
        output_template = render_output_template(task_dir, metadata, settings)
        download_args = build_ytdlp_common_args(settings, tool_state, include_ffmpeg=True)
        download_args.extend([
            "--no-playlist",
            "--continue" if settings.get("resume") else "--no-continue",
            "--part" if settings.get("resume") else "--no-part",
            "--retries",
            str(max(1, int(settings.get("taskRetries") or 1))),
            "--fragment-retries",
            str(max(1, int(settings.get("taskRetries") or 1))),
            "--file-access-retries",
            "5",
            "--merge-output-format",
            settings.get("container") or DEFAULT_CONTAINER,
            "--concurrent-fragments",
            str(settings["concurrentFragments"]),
            "--format",
            build_format_selector(settings),
            "--output",
            output_template,
            task["resolvedUrl"],
        ])
        completed = runner(download_args, cwd=REPO_ROOT, allow_failure=True)
        if completed.returncode != 0:
            last_error = completed.stderr.strip() or f"yt-dlp exited with code {completed.returncode}"
        else:
            downloaded_file = locate_downloaded_video(task_dir)
            if downloaded_file:
                output_path = str(downloaded_file.resolve())
                verification = verify_downloaded_file(downloaded_file, tool_state, runner=runner) if settings.get("verifyDownload", True) else None
                if verification is None or verification.get("ok"):
                    break
                last_error = verification.get("error") or "Downloaded file failed validation."
            else:
                last_error = "Validation failed: yt-dlp completed but no merged output file was found."
        if attempt < attempts:
            time.sleep(1.0)

    status = "success" if output_path and (verification is None or verification.get("ok")) else "failed"
    result = {
        "source": task["source"],
        "inputKind": task["inputKind"],
        "finalUrl": final_url,
        "title": metadata.get("title"),
        "outputPath": output_path,
        "status": status,
        "error": None if status == "success" else last_error,
        "usedLoginState": tool_state.get("usedLoginState", False),
        "taskDir": str(task_dir),
        "verification": verification,
        "quality": quality,
        "archiveKeys": sorted(archive_keys),
        "note": "Download completed successfully." if status == "success" else "Download failed after retries." if attempts > 1 else "Download failed.",
    }

    metadata_payload = build_metadata_payload(
        metadata,
        source=task["source"],
        final_url=final_url,
        output_path=result["outputPath"],
        used_login_state=result["usedLoginState"],
        quality=quality,
        verification=verification,
    )
    write_json(task_dir / "metadata.json", metadata_payload)
    write_json(task_dir / "download-manifest.json", result)
    if status == "success" and archive_state and archive_state.get("path"):
        append_download_archive(Path(archive_state["path"]), archive_keys, archive_state)
    return result


def build_report_markdown(manifest: dict[str, Any]) -> str:
    lines = [
        "# Bilibili Download",
        "",
        f"- Host: {manifest['host']}",
        f"- Run dir: {manifest['runDir']}",
        f"- Concurrency: {manifest['concurrency']}",
        f"- Dry run: {'yes' if manifest['dryRun'] else 'no'}",
        f"- Used login state: {'yes' if manifest['usedLoginState'] else 'no'}",
        f"- Login bootstrap attempted: {'yes' if (manifest.get('loginBootstrap') or {}).get('attempted') else 'no'}",
        f"- Login bootstrap status: {(manifest.get('loginBootstrap') or {}).get('status') or 'none'}",
        f"- Resume: {'yes' if manifest['resume'] else 'no'}",
        f"- Retry failed only: {'yes' if manifest['retryFailedOnly'] else 'no'}",
        f"- Skip existing: {'yes' if manifest['skipExisting'] else 'no'}",
        f"- Container: {manifest['qualityPolicy']['container']}",
        f"- Codec preference: {manifest['qualityPolicy']['codecPreference']}",
        f"- Max height: {manifest['qualityPolicy']['maxHeight'] or 'auto'}",
        f"- Naming strategy: {manifest['qualityPolicy']['namingStrategy']}",
        f"- yt-dlp: {manifest['tools']['ytDlpPath']}",
        f"- ffmpeg: {manifest['tools']['ffmpegPath']}",
        "",
        "## Summary",
        "",
        f"- Total results: {manifest['summary']['total']}",
        f"- Successful: {manifest['summary']['successful']}",
        f"- Failed: {manifest['summary']['failed']}",
        f"- Skipped: {manifest['summary']['skipped']}",
        f"- Planned: {manifest['summary']['planned']}",
        "",
        "## Results",
        "",
    ]
    for result in manifest["results"]:
        verification = ""
        if result.get("verification"):
            verification = f" [verify={'ok' if result['verification'].get('ok') else 'fail'}]"
        quality = ""
        if (result.get("quality") or {}).get("highestQualityMayBeLimited"):
            quality = " [login-limited]"
        note = f" [{result['note']}]" if result.get("note") else ""
        lines.append(
            f"- {result['status']}: {result.get('title') or result['finalUrl']} "
            f"({result['finalUrl']})"
            + (f" -> {result['outputPath']}" if result.get("outputPath") else "")
            + verification
            + quality
            + note
            + (f" [{result['error']}]" if result.get("error") else "")
        )
    if manifest.get("warnings"):
        lines.extend(["", "## Warnings", ""])
        lines.extend([f"- {warning}" for warning in manifest["warnings"]])
    return "\n".join(lines)


def execute_download_plan(
    tasks: list[dict[str, Any]],
    *,
    run_dir: Path,
    host_root: Path,
    settings: dict[str, Any],
    tool_state: dict[str, Any],
    downloader_config: dict[str, Any],
    history_index: dict[str, dict[str, Any]],
    archive_state: dict[str, Any] | None = None,
    runner: Callable[..., subprocess.CompletedProcess[str]] = run_subprocess,
) -> list[dict[str, Any]]:
    if not tasks:
        return []

    results: list[dict[str, Any]] = []
    if settings["concurrency"] <= 1 or len(tasks) == 1:
        for index, task in enumerate(tasks, start=1):
            results.append(
                execute_download_task(
                    task,
                    index=index,
                    run_dir=run_dir,
                    settings=settings,
                    tool_state=tool_state,
                    downloader_config=downloader_config,
                    history_index=history_index,
                    archive_state=archive_state,
                    runner=runner,
                )
            )
        return results

    with ThreadPoolExecutor(max_workers=settings["concurrency"]) as pool:
        future_map = {
            pool.submit(
                execute_download_task,
                task,
                index=index,
                run_dir=run_dir,
                settings=settings,
                tool_state=tool_state,
                downloader_config=downloader_config,
                history_index=history_index,
                archive_state=archive_state,
                runner=runner,
            ): task
            for index, task in enumerate(tasks, start=1)
        }
        for future in as_completed(future_map):
            task = future_map[future]
            try:
                results.append(future.result())
            except Exception as error:
                results.append({
                    "source": task["source"],
                    "inputKind": task["inputKind"],
                    "finalUrl": task["resolvedUrl"],
                    "title": task.get("entryTitle"),
                    "outputPath": None,
                    "status": "failed",
                    "error": str(error),
                    "usedLoginState": tool_state.get("usedLoginState", False),
                    "taskDir": None,
                    "verification": None,
                    "quality": None,
                    "archiveKeys": [],
                    "note": "Unexpected threaded execution failure.",
                })
    results.sort(key=lambda item: normalize_text(item.get("finalUrl")))
    return results


def resolve_tool_state(settings: dict[str, Any], downloader_config: dict[str, Any]) -> dict[str, Any]:
    yt_dlp_path = resolve_tool_path("yt-dlp", settings.get("ytDlpPath"))
    ffmpeg_path = resolve_tool_path("ffmpeg", settings.get("ffmpegPath"))
    try:
        ffprobe_path = resolve_ffprobe_path(ffmpeg_path, settings.get("ffprobePath"))
    except Exception:
        ffprobe_path = None
    user_data_dir = resolve_persistent_user_data_dir(
        "https://www.bilibili.com/",
        root_dir=settings.get("profileRoot"),
    ) if settings.get("reuseLoginState") else None
    profile_health = inspect_persistent_profile_health(user_data_dir) if user_data_dir else None
    profile_dir = Path(profile_health["userDataDir"]) if profile_health else None
    cookies_profile = profile_dir / "Default" if profile_dir and (profile_dir / "Default").exists() else profile_dir
    reusable_profile = None
    if profile_health:
        reusable_profile = profile_health.get("usableForCookies")
        if reusable_profile is None:
            reusable_profile = bool(profile_health.get("loginStateLikelyAvailable") and not profile_health.get("profileInUse"))
    used_login_state = bool(
        settings.get("reuseLoginState")
        and profile_health
        and reusable_profile
        and cookies_profile
    )

    warnings = []
    if profile_health:
        warnings.extend(profile_health.get("warnings") or [])
    if downloader_config.get("requiresLoginForHighestQuality") and not used_login_state:
        warnings.append("Reusable bilibili login state is unavailable; highest available quality or protected content may require running site-login first.")
    if settings.get("verifyDownload", True) and not ffprobe_path:
        warnings.append("ffprobe was not found; media verification will fall back to file existence and size checks only.")

    return {
        "ytDlpPath": yt_dlp_path,
        "ffmpegPath": ffmpeg_path,
        "ffprobePath": ffprobe_path,
        "ffmpegLocation": str(Path(ffmpeg_path).resolve().parent),
        "profileHealth": profile_health,
        "cookiesFromBrowser": f"chrome:{cookies_profile}" if used_login_state and cookies_profile else None,
        "usedLoginState": used_login_state,
        "warnings": warnings,
    }


def merge_settings(options: dict[str, Any] | None = None) -> dict[str, Any]:
    merged = {
        "inputFile": None,
        "outDir": None,
        "reuseLoginState": True,
        "profileRoot": None,
        "profilePath": None,
        "concurrency": DEFAULT_CONCURRENCY,
        "maxPlaylistItems": None,
        "maxItems": None,
        "fromPage": 1,
        "pageLimit": None,
        "pageSize": DEFAULT_PAGE_SIZE,
        "playlistStart": None,
        "playlistEnd": None,
        "matchTitle": None,
        "includeBvids": [],
        "titleIncludes": [],
        "skipExisting": False,
        "retryFailedOnly": False,
        "resume": True,
        "taskRetries": 1,
        "concurrentFragments": DEFAULT_CONCURRENT_FRAGMENTS,
        "dryRun": False,
        "verifyDownload": True,
        "useDownloadArchive": True,
        "downloadArchivePath": None,
        "browserPath": None,
        "nodePath": None,
        "browserFallbackTimeoutMs": 20_000,
        "browserFallbackHeadless": True,
        "container": DEFAULT_CONTAINER,
        "codecPreference": "auto",
        "maxHeight": None,
        "fallbackPolicy": DEFAULT_FALLBACK_POLICY,
        "namingStrategy": DEFAULT_NAMING_STRATEGY,
        "filenameTemplate": None,
        "allowAutoLoginBootstrap": True,
        "ytDlpPath": None,
        "ffmpegPath": None,
        "ffprobePath": None,
    }
    option_values = options or {}
    merged.update(option_values)
    if merged.get("preferCodec") and not option_values.get("codecPreference"):
        merged["codecPreference"] = merged["preferCodec"]
    if merged.get("titleIncludes") is None:
        merged["titleIncludes"] = []
    merged["concurrency"] = max(1, int(merged["concurrency"]))
    if merged["maxPlaylistItems"] is not None:
        merged["maxPlaylistItems"] = max(1, int(merged["maxPlaylistItems"]))
    if merged["maxItems"] is not None:
        merged["maxItems"] = max(1, int(merged["maxItems"]))
    merged["fromPage"] = max(1, int(merged["fromPage"]))
    if merged["playlistStart"] is not None:
        merged["playlistStart"] = max(1, int(merged["playlistStart"]))
    if merged["playlistEnd"] is not None:
        merged["playlistEnd"] = max(1, int(merged["playlistEnd"]))
    if merged["pageLimit"] is not None:
        merged["pageLimit"] = max(1, int(merged["pageLimit"]))
    merged["pageSize"] = max(1, int(merged["pageSize"]))
    merged["taskRetries"] = max(0, int(merged["taskRetries"]))
    merged["concurrentFragments"] = max(1, int(merged["concurrentFragments"]))
    merged["container"] = normalize_text(merged["container"]).lower() or DEFAULT_CONTAINER
    if merged["container"] not in {"mp4", "mkv"}:
        raise DownloadBilibiliError("Unsupported --container value. Supported values are mp4 and mkv.")
    merged["codecPreference"] = normalize_text(merged["codecPreference"]).lower() or "auto"
    if merged["codecPreference"] not in {"auto", "av1", "hevc", "h264"}:
        raise DownloadBilibiliError("Unsupported --codec-preference value. Supported values are auto, av1, hevc, h264.")
    if merged["maxHeight"] is not None:
        merged["maxHeight"] = max(144, int(merged["maxHeight"]))
    merged["namingStrategy"] = normalize_text(merged["namingStrategy"]).lower() or DEFAULT_NAMING_STRATEGY
    if merged["namingStrategy"] not in {"title-id", "stable-id"}:
        raise DownloadBilibiliError("Unsupported --naming-strategy value. Supported values are title-id and stable-id.")
    if isinstance(merged.get("includeBvids"), str):
        merged["includeBvids"] = [item.strip() for item in merged["includeBvids"].split(",") if item.strip()]
    if isinstance(merged.get("titleIncludes"), str):
        merged["titleIncludes"] = [merged["titleIncludes"]]
    return merged


def download_bilibili(inputs: list[str], options: dict[str, Any] | None = None, deps: dict[str, Any] | None = None) -> dict[str, Any]:
    settings = merge_settings(options)
    deps = deps or {}
    profile_bundle = resolve_bilibili_profile(settings.get("profilePath"))
    profile = profile_bundle["profile"]
    downloader_config = resolve_downloader_config(profile)
    if settings["maxPlaylistItems"] is None:
        settings["maxPlaylistItems"] = downloader_config.get("maxBatchItems", DEFAULT_MAX_PLAYLIST_ITEMS)
    if settings["pageSize"] == DEFAULT_PAGE_SIZE and downloader_config.get("playlistPageSize"):
        settings["pageSize"] = int(downloader_config["playlistPageSize"])
    quality_policy = downloader_config.get("qualityPolicy") or {}
    if settings["container"] == DEFAULT_CONTAINER and downloader_config.get("defaultContainer"):
        settings["container"] = downloader_config["defaultContainer"]
    if settings["codecPreference"] == "auto" and quality_policy.get("targetCodec"):
        settings["codecPreference"] = quality_policy["targetCodec"]
    if settings["maxHeight"] is None and quality_policy.get("targetHeight"):
        settings["maxHeight"] = int(quality_policy["targetHeight"])
    settings["fallbackPolicy"] = normalize_text(
        settings.get("fallbackPolicy") or quality_policy.get("fallbackPolicy") or DEFAULT_FALLBACK_POLICY
    ) or DEFAULT_FALLBACK_POLICY
    if settings["namingStrategy"] == DEFAULT_NAMING_STRATEGY and downloader_config.get("defaultNamingStrategy"):
        settings["namingStrategy"] = downloader_config["defaultNamingStrategy"]
    input_items = load_input_items(inputs, settings.get("inputFile"))
    tool_state = resolve_tool_state(settings, downloader_config)
    runner = deps.get("runner", run_subprocess)
    tool_state, login_bootstrap = maybe_bootstrap_login_for_downloads(
        input_items,
        settings,
        downloader_config,
        tool_state,
        runner=runner,
        bootstrap_runner=deps.get("loginBootstrap"),
    )

    planning = resolve_download_tasks(
        input_items,
        settings,
        profile,
        tool_state,
        runner=runner,
    )
    output_root = resolve_output_root(settings, downloader_config)
    host_root = host_video_download_root(output_root, "www.bilibili.com")
    host_root.mkdir(parents=True, exist_ok=True)
    history_index = load_existing_task_history(host_root)
    download_archive_path = None
    archive_state = None
    if settings.get("useDownloadArchive", True):
        download_archive_path = Path(settings.get("downloadArchivePath") or (host_root / DEFAULT_DOWNLOAD_ARCHIVE_NAME)).resolve()
        archive_state = {
            "path": str(download_archive_path),
            "entries": load_download_archive(download_archive_path),
            "lock": threading.Lock(),
        }
    run_dir = host_root / current_run_id("www.bilibili.com")
    run_dir.mkdir(parents=True, exist_ok=True)

    progress_log(f"Resolved {len(planning['tasks'])} bilibili download task(s) into {run_dir}")
    results = execute_download_plan(
        planning["tasks"],
        run_dir=run_dir,
        host_root=host_root,
        settings=settings,
        tool_state=tool_state,
        downloader_config=planning["config"],
        history_index=history_index,
        archive_state=archive_state,
        runner=runner,
    )
    summary = {
        "total": len(results),
        "successful": sum(1 for item in results if item["status"] == "success"),
        "failed": sum(1 for item in results if item["status"] == "failed"),
        "skipped": sum(1 for item in results if item["status"] == "skipped"),
        "planned": sum(1 for item in results if item["status"] == "planned"),
    }

    manifest = {
        "host": "www.bilibili.com",
        "profilePath": profile_bundle["path"],
        "runDir": str(run_dir.resolve()),
        "inputItems": input_items,
        "resolvedItems": planning["resolvedItems"],
        "concurrency": settings["concurrency"],
        "dryRun": settings["dryRun"],
        "resume": settings["resume"],
        "retryFailedOnly": settings["retryFailedOnly"],
        "skipExisting": settings["skipExisting"],
        "usedLoginState": tool_state["usedLoginState"],
        "loginBootstrap": login_bootstrap or {
            "attempted": False,
            "status": None,
            "persistenceVerified": None,
            "profileDir": None,
        },
        "profileHealth": tool_state["profileHealth"],
        "qualityPolicy": {
            "container": settings["container"],
            "codecPreference": settings["codecPreference"],
            "maxHeight": settings["maxHeight"],
            "targetHeight": settings["maxHeight"],
            "targetCodec": settings["codecPreference"],
            "fallbackPolicy": settings.get("fallbackPolicy") or DEFAULT_FALLBACK_POLICY,
            "namingStrategy": settings["namingStrategy"],
            "filenameTemplate": settings.get("filenameTemplate"),
            "requiresLoginForHighestQuality": planning["config"].get("requiresLoginForHighestQuality", False),
        },
        "downloadArchive": {
            "enabled": bool(settings.get("useDownloadArchive", True)),
            "path": str(download_archive_path) if download_archive_path else None,
            "entriesKnown": len(archive_state["entries"]) if archive_state else 0,
        },
        "filters": {
            "matchTitle": settings.get("matchTitle"),
            "titleIncludes": settings.get("titleIncludes") or [],
            "includeBvids": settings.get("includeBvids") or [],
            "fromPage": settings.get("fromPage"),
            "pageLimit": settings.get("pageLimit"),
            "pageSize": settings.get("pageSize"),
            "playlistStart": settings.get("playlistStart"),
            "playlistEnd": settings.get("playlistEnd"),
            "maxPlaylistItems": settings.get("maxPlaylistItems"),
        },
        "tools": {
            "ytDlpPath": tool_state["ytDlpPath"],
            "ffmpegPath": tool_state["ffmpegPath"],
            "ffprobePath": tool_state.get("ffprobePath"),
            "nodePath": resolve_tool_path("node", settings.get("nodePath"), required=False),
        },
        "results": results,
        "summary": summary,
        "warnings": tool_state["warnings"],
    }

    write_json(run_dir / "download-manifest.json", manifest)
    write_text(run_dir / "download-report.md", build_report_markdown(manifest))
    return manifest


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Download bilibili videos or playlist-like list pages with highest available quality.",
    )
    parser.add_argument("inputs", nargs="*", help="bilibili video/bangumi URLs, BV IDs, or playlist-like list URLs")
    parser.add_argument("--input-file", dest="input_file", help="Optional file containing one URL/BV per line")
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY, help="Number of concurrent video downloads")
    parser.add_argument("--out-dir", dest="out_dir", help="Output root directory for downloaded bilibili videos")
    parser.add_argument("--reuse-login-state", dest="reuse_login_state", action="store_true", default=True, help="Reuse the project bilibili persistent browser profile for cookies")
    parser.add_argument("--no-reuse-login-state", dest="reuse_login_state", action="store_false", help="Do not reuse browser login state")
    parser.add_argument("--auto-login-bootstrap", dest="allow_auto_login_bootstrap", action="store_true", default=True, help="Automatically run the bilibili login helper when authenticated download inputs need a reusable session")
    parser.add_argument("--no-auto-login-bootstrap", dest="allow_auto_login_bootstrap", action="store_false", help="Do not automatically run the bilibili login helper")
    parser.add_argument("--profile-root", dest="profile_root", help="Override the project browser profile root directory")
    parser.add_argument("--profile-path", dest="profile_path", help="Override the bilibili profile JSON path")
    parser.add_argument("--dry-run", action="store_true", help="Resolve tasks and metadata without downloading media")
    parser.add_argument("--max-playlist-items", type=int, default=None, help="Maximum items to resolve from a playlist-like source")
    parser.add_argument("--playlist-start", type=int, help="Direct yt-dlp playlist start index override")
    parser.add_argument("--playlist-end", type=int, help="Direct yt-dlp playlist end index override")
    parser.add_argument("--max-items", type=int, help="Alias for the resolved task item cap after playlist expansion")
    parser.add_argument("--from-page", type=int, default=1, help="Approximate page number to start from when enumerating playlist-like sources")
    parser.add_argument("--page-limit", type=int, help="Approximate number of pages to include when enumerating playlist-like sources")
    parser.add_argument("--page-size", type=int, default=DEFAULT_PAGE_SIZE, help="Approximate playlist page size for pagination windowing")
    parser.add_argument("--match-title", help="Only keep resolved entries whose title contains this text")
    parser.add_argument("--title-include", dest="title_includes", action="append", default=[], help="Keep resolved entries whose titles contain these substrings; can be repeated")
    parser.add_argument("--include-bvid", dest="include_bvids", action="append", default=[], help="Only keep resolved entries matching these BV IDs; can be repeated")
    parser.add_argument("--skip-existing", action="store_true", help="Skip verified downloads that already exist in previous bilibili download runs")
    parser.add_argument("--download-archive", dest="download_archive_path", help="Path to the content-level download archive text file")
    parser.add_argument("--no-download-archive", dest="use_download_archive", action="store_false", default=True, help="Disable the content-level download archive")
    parser.add_argument("--retry-failed-only", action="store_true", help="Only retry items that previously failed or were left planned/incomplete")
    parser.add_argument("--resume", dest="resume", action="store_true", default=True, help="Resume incomplete task directories when possible")
    parser.add_argument("--no-resume", dest="resume", action="store_false", help="Do not reuse incomplete task directories")
    parser.add_argument("--task-retries", type=int, default=1, help="Number of retry attempts after the initial download try")
    parser.add_argument("--container", default=DEFAULT_CONTAINER, help="Merged output container: mp4 or mkv")
    parser.add_argument("--codec-preference", default="auto", help="Preferred video codec ordering: auto, av1, hevc, h264")
    parser.add_argument("--prefer-av1", dest="prefer_codec", action="store_const", const="av1", help="Alias for --codec-preference av1")
    parser.add_argument("--prefer-hevc", dest="prefer_codec", action="store_const", const="hevc", help="Alias for --codec-preference hevc")
    parser.add_argument("--prefer-h264", dest="prefer_codec", action="store_const", const="h264", help="Alias for --codec-preference h264")
    parser.add_argument("--max-height", type=int, help="Prefer formats at or below this height")
    parser.add_argument("--naming-strategy", default=DEFAULT_NAMING_STRATEGY, help="Task directory naming strategy: title-id or stable-id")
    parser.add_argument("--filename-template", help="Custom output filename template using {bvid}, {aid}, {id}, {title}")
    parser.add_argument("--no-verify-download", dest="verify_download", action="store_false", default=True, help="Skip post-download media verification")
    parser.add_argument("--yt-dlp-path", dest="yt_dlp_path", help="Optional explicit path to yt-dlp")
    parser.add_argument("--ffmpeg-path", dest="ffmpeg_path", help="Optional explicit path to ffmpeg")
    parser.add_argument("--ffprobe-path", dest="ffprobe_path", help="Optional explicit path to ffprobe")
    parser.add_argument("--browser-path", dest="browser_path", help="Optional explicit browser path for browser-assisted playlist fallback")
    parser.add_argument("--node-path", dest="node_path", help="Optional explicit Node.js path for browser-assisted playlist fallback")
    return parser


def cli_entry(argv: list[str] | None = None) -> int:
    init_console_utf8()
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    try:
        manifest = download_bilibili(
            args.inputs,
            {
                "inputFile": args.input_file,
                "concurrency": args.concurrency,
                "outDir": args.out_dir,
                "reuseLoginState": args.reuse_login_state,
                "allowAutoLoginBootstrap": args.allow_auto_login_bootstrap,
                "profileRoot": args.profile_root,
                "profilePath": args.profile_path,
                "dryRun": args.dry_run,
                "maxPlaylistItems": args.max_playlist_items,
                "playlistStart": args.playlist_start,
                "playlistEnd": args.playlist_end,
                "maxItems": args.max_items,
                "fromPage": args.from_page,
                "pageLimit": args.page_limit,
                "pageSize": args.page_size,
                "matchTitle": args.match_title,
                "includeBvids": args.include_bvids,
                "titleIncludes": args.title_includes,
                "skipExisting": args.skip_existing,
                "useDownloadArchive": args.use_download_archive,
                "downloadArchivePath": args.download_archive_path,
                "retryFailedOnly": args.retry_failed_only,
                "resume": args.resume,
                "taskRetries": args.task_retries,
                "container": args.container,
                "codecPreference": args.codec_preference,
                "preferCodec": args.prefer_codec,
                "maxHeight": args.max_height,
                "namingStrategy": args.naming_strategy,
                "filenameTemplate": args.filename_template,
                "verifyDownload": args.verify_download,
                "ytDlpPath": args.yt_dlp_path,
                "ffmpegPath": args.ffmpeg_path,
                "ffprobePath": args.ffprobe_path,
                "browserPath": args.browser_path,
                "nodePath": args.node_path,
            },
        )
    except Exception as error:
        progress_log(f"[download-bilibili] {error}")
        return 1

    sys.stdout.write(f"{json.dumps(manifest, ensure_ascii=False, indent=2)}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(cli_entry())
