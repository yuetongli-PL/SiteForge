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
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
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
    sanitize_host,
    sha256_text,
    slugify_ascii,
    write_json,
    write_text,
)

DEFAULT_OUTPUT_ROOT = REPO_ROOT / "video-downloads"
DEFAULT_CONCURRENCY = 6
DEFAULT_CONCURRENT_FRAGMENTS = 8
DEFAULT_CONTAINER = "mp4"
DEFAULT_NAMING_STRATEGY = "title-id"
DEFAULT_DOWNLOAD_ARCHIVE_NAME = "download-archive.txt"
COOKIE_CACHE_MAX_AGE_SECONDS = 30 * 60
SUPPORTED_HOSTS = {"www.douyin.com", "www.iesdouyin.com", "iesdouyin.com"}
VIDEO_ID_PATTERN = re.compile(r"^\d{10,20}$")
VIDEO_URL_PATTERN = re.compile(r"/(?:video|shipin)/([^/?#]+)", re.IGNORECASE)
MEDIA_EXTENSIONS = {".mp4", ".mkv", ".webm", ".mov", ".m4v"}
EXPORT_SIDECAR_CANDIDATES = (
    "{name}.json",
    "{stem}.json",
    "{stem}.headers.json",
    "{stem}-headers.json",
    "{stem}.meta.json",
    "{stem}-meta.json",
    "douyin-browser-export.json",
    "douyin-browser-export.headers.json",
)
MEDIA_RESOLVER_INPUT_FILE_NAME = "douyin-media-resolver-input.txt"
DEFAULT_OUTPUT_MODE = "full"
DEFAULT_OUTPUT_FORMAT = "json"


class DownloadDouyinError(RuntimeError):
    pass


def current_time_ms() -> int:
    return int(time.time() * 1000)


def normalize_duration_ms(started_at_ms: int) -> int:
    return max(0, current_time_ms() - int(started_at_ms))


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


def default_douyin_profile_path() -> Path:
    return REPO_ROOT / "profiles" / "www.douyin.com.json"


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
            os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local"
        ) / "Browser-Wiki-Skill" / "browser-profiles"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Browser-Wiki-Skill" / "browser-profiles"
    return Path(
        os.environ.get("XDG_STATE_HOME") or (Path.home() / ".local" / "state")
    ) / "browser-wiki-skill" / "browser-profiles"


def resolve_persistent_user_data_dir(input_value: str, root_dir: str | Path | None = None) -> Path:
    root = Path(root_dir) if root_dir else resolve_default_persistent_browser_root()
    return root.resolve() / derive_persistent_profile_key(input_value)


def inspect_persistent_profile_health(user_data_dir: str | Path) -> dict[str, Any]:
    resolved_dir = Path(user_data_dir).resolve()
    default_dir = resolved_dir / "Default"
    cookies_path = default_dir / "Network" / "Cookies"
    preferences_path = default_dir / "Preferences"
    warnings: list[str] = []
    profile_in_use = any((resolved_dir / name).exists() for name in ("SingletonLock", "SingletonCookie", "SingletonSocket"))
    cookies_ready = cookies_path.exists()
    preferences_ready = preferences_path.exists()
    reusable = resolved_dir.exists() and cookies_ready and preferences_ready and not profile_in_use
    if not resolved_dir.exists():
        warnings.append(f"Persistent browser profile directory does not exist yet: {resolved_dir}")
    if not cookies_ready:
        warnings.append(f"Persistent browser profile is missing Cookies database: {cookies_path}")
    if not preferences_ready:
        warnings.append(f"Persistent browser profile is missing Preferences: {preferences_path}")
    if profile_in_use:
        warnings.append(f"Persistent browser profile appears to be in use: {resolved_dir}")
    return {
        "userDataDir": str(resolved_dir),
        "exists": resolved_dir.exists(),
        "cookiesPath": str(cookies_path),
        "preferencesPath": str(preferences_path),
        "loginStateLikelyAvailable": cookies_ready,
        "healthy": resolved_dir.exists() and cookies_ready and preferences_ready and not profile_in_use,
        "usableForCookies": reusable,
        "cookiesReady": cookies_ready,
        "profileInUse": profile_in_use,
        "warnings": warnings,
    }


def resolve_tool_path(name: str, explicit_path: str | None = None, *, required: bool = True) -> str | None:
    if explicit_path:
        candidate = Path(explicit_path).expanduser().resolve()
        if not candidate.exists():
            if required:
                raise DownloadDouyinError(f"{name} not found at explicit path: {candidate}")
            return None
        return str(candidate)
    discovered = shutil.which(name)
    if discovered:
        return discovered
    if required:
        raise DownloadDouyinError(f"Could not find {name} in PATH.")
    return None


def resolve_ffprobe_path(ffmpeg_path: str, explicit_path: str | None = None) -> str | None:
    if explicit_path:
        return resolve_tool_path("ffprobe", explicit_path)
    ffmpeg_resolved = Path(ffmpeg_path).resolve()
    candidates = [
        ffmpeg_resolved.parent / "ffprobe.exe",
        ffmpeg_resolved.parent / "ffprobe",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return resolve_tool_path("ffprobe", required=False)


def resolve_douyin_profile(profile_path: str | Path | None = None) -> dict[str, Any]:
    resolved_path = Path(profile_path or default_douyin_profile_path()).resolve()
    if not resolved_path.exists():
        raise DownloadDouyinError(f"Missing douyin profile: {resolved_path}")
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
        "maxBatchItems": max(1, int(config.get("maxBatchItems") or 500)),
        "defaultContainer": default_container,
        "defaultNamingStrategy": str(config.get("defaultNamingStrategy") or DEFAULT_NAMING_STRATEGY),
        "qualityPolicy": {
            "targetHeight": max(144, int(quality_policy.get("targetHeight") or 2160)),
            "targetCodec": normalize_text(quality_policy.get("targetCodec")).lower() or "auto",
            "defaultContainer": default_container,
            "fallbackPolicy": normalize_text(quality_policy.get("fallbackPolicy")) or "preserve-height-then-downgrade-codec",
        },
    }


def normalize_douyin_input(raw_value: str) -> dict[str, Any]:
    raw = normalize_text(raw_value)
    if not raw:
        raise DownloadDouyinError("Encountered an empty douyin input item.")
    if VIDEO_ID_PATTERN.match(raw):
        return {
            "raw": raw_value,
            "inputKind": "video-detail",
            "source": raw,
            "normalizedUrl": f"https://www.douyin.com/video/{raw}",
            "videoId": raw,
        }
    normalized_url = normalize_url_no_fragment(raw)
    parsed = urlparse(normalized_url or raw)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in SUPPORTED_HOSTS:
        raise DownloadDouyinError(f"Unsupported douyin input: {raw}")
    if parsed.hostname in {"www.iesdouyin.com", "iesdouyin.com"}:
        matched_share = re.search(r"/share/video/(\d{10,20})", parsed.path or "", re.IGNORECASE)
        if not matched_share:
            raise DownloadDouyinError(f"Unsupported Douyin share input: {normalized_url}")
        video_id = matched_share.group(1)
        return {
            "raw": raw_value,
            "inputKind": "video-detail",
            "source": raw,
            "normalizedUrl": f"https://www.douyin.com/video/{video_id}",
            "videoId": video_id,
        }
    matched = VIDEO_URL_PATTERN.search(parsed.path or "")
    if not matched:
        raise DownloadDouyinError(
            "src/sites/douyin/download/python/douyin.py only accepts resolved Douyin video URLs or IDs, "
            f"got: {normalized_url}"
        )
    return {
        "raw": raw_value,
        "inputKind": "video-detail",
        "source": raw,
        "normalizedUrl": normalized_url,
        "videoId": matched.group(1),
    }


def normalize_douyin_input_item(raw_value: Any) -> dict[str, Any]:
    if isinstance(raw_value, dict):
        source_value = (
            raw_value.get("normalizedUrl")
            or raw_value.get("finalUrl")
            or raw_value.get("url")
            or raw_value.get("source")
        )
        normalized = normalize_douyin_input(str(source_value or ""))
        normalized["source"] = normalize_text(raw_value.get("source")) or normalized.get("source")
        normalized["videoId"] = normalize_text(raw_value.get("videoId")) or normalized.get("videoId")
        resolved_media_url = normalize_text(raw_value.get("resolvedMediaUrl"))
        if resolved_media_url:
            normalized["resolvedMediaUrl"] = resolved_media_url
        resolved_title = normalize_text(raw_value.get("resolvedTitle") or raw_value.get("title"))
        if resolved_title:
            normalized["resolvedTitle"] = resolved_title
        if isinstance(raw_value.get("resolvedFormat"), dict):
            normalized["resolvedFormat"] = raw_value.get("resolvedFormat")
        if isinstance(raw_value.get("resolvedFormats"), list):
            normalized["resolvedFormats"] = raw_value.get("resolvedFormats")
        download_headers = extract_header_map(raw_value.get("downloadHeaders"))
        if download_headers:
            normalized["downloadHeaders"] = download_headers
        resolution_pathway = normalize_text(raw_value.get("resolutionPathway") or raw_value.get("resolvedVia"))
        if resolution_pathway:
            normalized["resolutionPathway"] = resolution_pathway
        return normalized
    text_value = normalize_text(raw_value)
    if text_value.startswith("{") and text_value.endswith("}"):
        try:
            parsed = json.loads(text_value)
        except Exception:
            parsed = None
        if isinstance(parsed, dict):
            return normalize_douyin_input_item(parsed)
    return normalize_douyin_input(text_value)


def canonicalize_douyin_video_url(final_url: str | None, video_id: str | None = None) -> str:
    resolved_video_id = normalize_text(video_id)
    if resolved_video_id:
        return f"https://www.douyin.com/video/{resolved_video_id}"
    normalized_url = normalize_url_no_fragment(final_url or "")
    return normalize_text(normalized_url or final_url)


def build_content_key(video_id: str | None, canonical_url: str | None) -> str:
    resolved_video_id = normalize_text(video_id)
    if resolved_video_id:
        return f"douyin:video:{resolved_video_id}"
    resolved_url = normalize_text(canonical_url)
    if resolved_url:
        return f"douyin:url:{resolved_url}"
    return "douyin:unknown"


def build_archive_keys(task: dict[str, Any], info: dict[str, Any] | None = None) -> set[str]:
    resolved_video_id = (
        normalize_text(task.get("videoId"))
        or normalize_text((info or {}).get("id"))
    )
    canonical_url = canonicalize_douyin_video_url(
        normalize_text((info or {}).get("webpage_url")) or normalize_text(task.get("finalUrl")),
        resolved_video_id,
    )
    raw_final_url = normalize_text(task.get("finalUrl"))
    keys = {
        build_content_key(resolved_video_id, canonical_url),
        canonical_url,
    }
    if raw_final_url:
        keys.add(raw_final_url)
    return {key for key in keys if normalize_text(key)}


def infer_resolution_pathway(source_text: str | None, resolved_media_url: str | None = None) -> str | None:
    source = normalize_text(source_text).lower()
    media_url = normalize_text(resolved_media_url).lower()
    if "cache" in source:
        return "cache"
    if "api" in source:
        return "api"
    if "detail" in source or "browser" in source:
        return "detail"
    if looks_like_direct_media_url(media_url):
        return "direct-media"
    if source:
        return source
    return None


def increment_counter(counter: dict[str, int], key: str | None, amount: int = 1) -> None:
    normalized_key = normalize_text(key)
    if not normalized_key:
        return
    counter[normalized_key] = counter.get(normalized_key, 0) + amount


def progress_log_stderr(message: str) -> None:
    text = normalize_text(message)
    if not text:
        return
    sys.stderr.write(f"{text}\n")
    sys.stderr.flush()


def load_input_items(inputs: list[str], input_file: str | None = None) -> list[dict[str, Any]]:
    raw_items: list[Any] = [str(value).strip() for value in inputs if str(value).strip()]
    if input_file:
        file_path = Path(input_file).resolve()
        if not file_path.exists():
            raise DownloadDouyinError(f"Input file does not exist: {file_path}")
        for line in file_path.read_text(encoding="utf-8").splitlines():
            text = line.strip()
            if text and not text.startswith("#"):
                raw_items.append(text)
    if not raw_items:
        raise DownloadDouyinError("No Douyin video inputs were provided.")
    unique_items = []
    seen = set()
    for raw in raw_items:
        normalized = normalize_douyin_input_item(raw)
        canonical_url = canonicalize_douyin_video_url(normalized.get("normalizedUrl"), normalized.get("videoId"))
        key = build_content_key(normalized.get("videoId"), canonical_url)
        if key in seen:
            continue
        seen.add(key)
        unique_items.append(normalized)
    return unique_items


def run_subprocess(command: list[str], *, cwd: str | Path | None = None, timeout: int | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        check=False,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        timeout=timeout,
        env=child_utf8_env(),
    )


def export_cookies(settings: dict[str, Any], run_dir: Path) -> dict[str, Any]:
    if settings.get("reuseLoginState") is not True:
        return {"path": None, "generated": False, "details": None}
    if settings.get("cookiesFile"):
        return {"path": str(Path(settings["cookiesFile"]).resolve()), "generated": False, "details": None}
    persistent_user_data_dir = resolve_persistent_user_data_dir(
        "https://www.douyin.com/",
        root_dir=settings.get("profileRoot"),
    )
    out_path = Path(persistent_user_data_dir / ".bws" / "douyin-cookies.txt").resolve()
    if settings.get("dryRun") and out_path.exists():
        age_seconds = max(0.0, time.time() - out_path.stat().st_mtime)
        if age_seconds <= COOKIE_CACHE_MAX_AGE_SECONDS and out_path.stat().st_size > 0:
            return {
                "path": str(out_path),
                "generated": False,
                "details": {
                    "ok": True,
                    "path": str(out_path),
                    "cookieCount": None,
                    "cacheHit": True,
                    "ageSeconds": age_seconds,
                },
            }
    node_path = resolve_tool_path("node", settings.get("nodePath"))
    last_error = None
    for attempt in range(1, 4):
        command = [
            node_path,
            str((REPO_ROOT / "scripts" / "export-douyin-cookies.mjs").resolve()),
            "https://www.douyin.com/",
            "--out-file",
            str(out_path),
            "--profile-path",
            str(settings.get("profilePath") or default_douyin_profile_path()),
            "--timeout",
            str(int((settings.get("browserTimeoutMs") or 30_000) * attempt)),
        ]
        if settings.get("profileRoot"):
            command.extend(["--browser-profile-root", str(settings["profileRoot"])])
        if settings.get("browserPath"):
            command.extend(["--browser-path", str(settings["browserPath"])])
        if settings.get("headless") is False:
            command.append("--no-headless")
        result = run_subprocess(command, cwd=REPO_ROOT)
        if result.returncode == 0:
            payload = json.loads(result.stdout or "{}")
            exported_path = Path(payload.get("path") or out_path).resolve()
            if not exported_path.exists():
                raise DownloadDouyinError(f"Douyin cookie export reported success but file is missing: {exported_path}")
            return {"path": str(exported_path), "generated": True, "details": payload}
        last_error = f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        time.sleep(min(attempt, 2))
    if out_path.exists() and out_path.stat().st_size > 0:
        return {
            "path": str(out_path),
            "generated": False,
            "details": {
                "ok": True,
                "path": str(out_path),
                "cookieCount": None,
                "cacheHit": True,
                "staleFallback": True,
            },
        }
    raise DownloadDouyinError(
        f"Failed to export Douyin cookies from the local browser profile.\n{last_error or ''}"
    )


def normalize_browser_header_name(value: str | None) -> str:
    text = normalize_text(value)
    if not text:
        return ""
    return "-".join(segment[:1].upper() + segment[1:].lower() for segment in re.split(r"[-_]+", text) if segment)


def extract_header_map(payload: Any) -> dict[str, str]:
    if not isinstance(payload, dict):
        return {}
    resolved: dict[str, str] = {}
    for key, value in payload.items():
        header_name = normalize_browser_header_name(str(key))
        header_value = normalize_text(value)
        if not header_name or not header_value:
            continue
        resolved[header_name] = header_value
    return resolved


def merge_header_maps(*payloads: Any) -> dict[str, str]:
    resolved: dict[str, str] = {}
    for payload in payloads:
        resolved.update(extract_header_map(payload))
    return resolved


def filter_media_request_headers(headers: dict[str, str] | None) -> dict[str, str]:
    allowed = {
        "Accept-Language",
        "Origin",
        "Sec-Ch-Ua",
        "Sec-Ch-Ua-Mobile",
        "Sec-Ch-Ua-Platform",
        "User-Agent",
        "Referer",
    }
    resolved: dict[str, str] = {}
    for header_name, header_value in extract_header_map(headers).items():
        if header_name not in allowed:
            continue
        resolved[header_name] = header_value
    return resolved


def looks_like_direct_media_url(value: str | None) -> bool:
    text = normalize_text(value)
    if not text:
        return False
    try:
        parsed = urlparse(text)
    except Exception:
        return False
    hostname = normalize_text(parsed.hostname).lower()
    path = normalize_text(parsed.path).lower()
    if hostname.endswith("douyinvod.com") or hostname.endswith("douyinstatic.com"):
        return True
    if any(path.endswith(extension) for extension in MEDIA_EXTENSIONS):
        return True
    if ".mp4" in path or ".m3u8" in path:
        return True
    return False


def is_transient_media_resolver_failure(message: str | None) -> bool:
    text = normalize_text(message)
    if not text:
        return False
    return bool(
        re.search(
            r"CDP timeout for Runtime\.evaluate|Target closed|Session closed|Execution context was destroyed|Browser exited before DevTools became ready|timed out after",
            text,
            re.IGNORECASE,
        )
    )


def browser_export_candidate_paths(cookies_path: Path, details: dict[str, Any] | None = None) -> list[Path]:
    candidates: list[Path] = []

    def add_candidate(value: str | None) -> None:
        text = normalize_text(value)
        if not text:
            return
        candidate = Path(text).expanduser()
        if not candidate.is_absolute():
            candidate = (cookies_path.parent / candidate).resolve()
        else:
            candidate = candidate.resolve()
        if candidate not in candidates:
            candidates.append(candidate)

    if isinstance(details, dict):
        for key in ("headersPath", "metadataPath", "sidecarPath", "artifactPath"):
            add_candidate(details.get(key))
        for nested_key in ("headers", "metadata", "sidecar", "artifacts"):
            nested = details.get(nested_key)
            if isinstance(nested, dict):
                for key in ("path", "headersPath", "metadataPath", "sidecarPath"):
                    add_candidate(nested.get(key))

    for template in EXPORT_SIDECAR_CANDIDATES:
        add_candidate(cookies_path.parent / template.format(name=cookies_path.name, stem=cookies_path.stem))
    return candidates


def resolve_browser_export_metadata(
    cookies_file: str | None,
    details: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    if not cookies_file:
        return None
    cookies_path = Path(cookies_file).resolve()
    if not cookies_path.exists():
        return None

    direct_headers = merge_header_maps(
        (details or {}).get("headers"),
        (details or {}).get("requestHeaders"),
        (details or {}).get("extraHeaders"),
        (details or {}).get("observedRequestHeaders"),
    ) if isinstance(details, dict) else {}
    direct_user_agent = normalize_text(
        (details or {}).get("userAgent")
        or (details or {}).get("user_agent")
        or ((details or {}).get("navigator") or {}).get("userAgent")
        or ((details or {}).get("browser") or {}).get("userAgent")
        or direct_headers.get("User-Agent")
    )
    direct_referer = normalize_text(
        (details or {}).get("referer")
        or (details or {}).get("refererUrl")
        or ((details or {}).get("page") or {}).get("referrer")
        or ((details or {}).get("page") or {}).get("url")
        or direct_headers.get("Referer")
    )
    metadata: dict[str, Any] = {
        "cookiesPath": str(cookies_path),
        "sidecarPath": None,
        "userAgent": direct_user_agent or None,
        "referer": direct_referer or None,
        "headers": {},
    }
    metadata["headers"].update(direct_headers)

    for candidate in browser_export_candidate_paths(cookies_path, details):
        if not candidate.exists() or not candidate.is_file():
            continue
        try:
            sidecar = load_json(candidate)
        except Exception:
            continue
        if not isinstance(sidecar, dict):
            continue
        metadata["sidecarPath"] = str(candidate)
        sidecar_headers = merge_header_maps(
            sidecar.get("headers"),
            sidecar.get("requestHeaders"),
            sidecar.get("extraHeaders"),
            sidecar.get("observedRequestHeaders"),
        )
        page_payload = sidecar.get("page") if isinstance(sidecar.get("page"), dict) else {}
        navigator_payload = sidecar.get("navigator") if isinstance(sidecar.get("navigator"), dict) else {}
        browser_payload = sidecar.get("browser") if isinstance(sidecar.get("browser"), dict) else {}
        metadata["headers"].update(sidecar_headers)
        metadata["userAgent"] = (
            metadata.get("userAgent")
            or normalize_text(sidecar.get("userAgent") or sidecar.get("user_agent"))
            or normalize_text(navigator_payload.get("userAgent") or browser_payload.get("userAgent"))
            or metadata.get("headers", {}).get("User-Agent")
        )
        metadata["referer"] = (
            metadata.get("referer")
            or normalize_text(sidecar.get("referer") or sidecar.get("refererUrl"))
            or normalize_text(page_payload.get("referrer") or page_payload.get("url"))
            or metadata.get("headers", {}).get("Referer")
        )
        page_origin = normalize_text(page_payload.get("origin"))
        if page_origin:
            metadata["headers"].setdefault("Origin", page_origin)
        break

    if metadata["userAgent"]:
        metadata["headers"].setdefault("User-Agent", metadata["userAgent"])
    if metadata["referer"]:
        metadata["headers"].setdefault("Referer", metadata["referer"])
    if not metadata["headers"] and not metadata["userAgent"] and not metadata["referer"]:
        return None
    return metadata


def normalize_media_candidate(candidate: dict[str, Any] | None, fallback_headers: dict[str, str] | None = None) -> dict[str, Any] | None:
    if not isinstance(candidate, dict):
        return None
    url = normalize_text(candidate.get("url") or candidate.get("playUrl") or candidate.get("src"))
    if not looks_like_direct_media_url(url):
        return None
    protocol = normalize_text(candidate.get("protocol") or candidate.get("source") or "")
    if not protocol:
        protocol = "hls" if ".m3u8" in url.lower() else "direct-http"
    height_value = candidate.get("height")
    bitrate_value = candidate.get("tbr") or candidate.get("bitrate") or candidate.get("vbr")
    return {
        "url": url,
        "formatId": normalize_text(candidate.get("formatId") or candidate.get("format_id") or candidate.get("id")),
        "height": int(height_value) if isinstance(height_value, (int, float)) or str(height_value).isdigit() else None,
        "bitrate": float(bitrate_value) if isinstance(bitrate_value, (int, float)) or normalize_text(bitrate_value).replace(".", "", 1).isdigit() else None,
        "protocol": protocol,
        "headers": merge_header_maps(fallback_headers, candidate.get("headers")),
    }


def media_candidate_sort_key(candidate: dict[str, Any]) -> tuple[int, float, int]:
    height = int(candidate.get("height") or 0)
    bitrate = float(candidate.get("bitrate") or 0.0)
    direct_http_bonus = 1 if normalize_text(candidate.get("protocol")).lower() != "hls" else 0
    return (height, bitrate, direct_http_bonus)


def select_media_candidate(task: dict[str, Any]) -> dict[str, Any] | None:
    candidates: list[dict[str, Any]] = []
    fallback_headers = task.get("downloadHeaders")
    primary_candidate = normalize_media_candidate(
        {
            "url": task.get("resolvedMediaUrl"),
            "formatId": (task.get("resolvedFormat") or {}).get("formatId"),
            "height": (task.get("resolvedFormat") or {}).get("height"),
            "protocol": "hls" if ".m3u8" in normalize_text(task.get("resolvedMediaUrl")).lower() else "direct-http",
            "headers": fallback_headers,
        },
        fallback_headers,
    )
    if primary_candidate:
        candidates.append(primary_candidate)
    for raw_candidate in task.get("resolvedFormats") or []:
        candidate = normalize_media_candidate(raw_candidate, fallback_headers)
        if not candidate:
            continue
        if any(existing.get("url") == candidate["url"] for existing in candidates):
            continue
        candidates.append(candidate)
    if not candidates:
        return None
    candidates.sort(key=media_candidate_sort_key, reverse=True)
    return candidates[0]


def resolve_media_tasks(
    tasks: list[dict[str, Any]],
    settings: dict[str, Any],
    run_dir: Path,
) -> dict[str, Any]:
    started_at_ms = current_time_ms()
    if settings.get("dryRun"):
        path_stats: dict[str, int] = {}
        for task in tasks:
            increment_counter(
                path_stats,
                infer_resolution_pathway(task.get("resolutionPathway"), task.get("resolvedMediaUrl")) or "page",
            )
        return {
            "tasks": tasks,
            "report": {
                "ok": True,
                "skipped": True,
                "results": [],
                "resolvedCount": sum(1 for task in tasks if normalize_text(task.get("resolvedMediaUrl"))),
                "preResolvedCount": sum(1 for task in tasks if normalize_text(task.get("resolvedMediaUrl"))),
                "pathStats": path_stats,
                "timingsMs": {
                    "total": normalize_duration_ms(started_at_ms),
                },
            },
            "warnings": [],
        }
    if not tasks or settings.get("reuseLoginState") is not True:
        return {
            "tasks": tasks,
            "report": None,
            "warnings": [],
        }

    unresolved_tasks = [
        task
        for task in tasks
        if not normalize_text(task.get("resolvedMediaUrl"))
    ]
    if not unresolved_tasks:
        path_stats: dict[str, int] = {}
        for task in tasks:
            increment_counter(
                path_stats,
                infer_resolution_pathway(task.get("resolutionPathway"), task.get("resolvedMediaUrl")) or "direct-media",
            )
        return {
            "tasks": tasks,
            "report": {
                "ok": True,
                "results": [],
                "resolvedCount": len(tasks),
                "preResolvedCount": len(tasks),
                "pathStats": path_stats,
                "timingsMs": {
                    "total": normalize_duration_ms(started_at_ms),
                },
            },
            "warnings": [],
        }

    node_path = resolve_tool_path("node", settings.get("nodePath"))
    input_file = (run_dir / MEDIA_RESOLVER_INPUT_FILE_NAME).resolve()
    input_file.write_text(
        "".join(
            f"{normalize_text(task.get('finalUrl'))}\n"
            for task in unresolved_tasks
            if normalize_text(task.get("finalUrl"))
        ),
        encoding="utf-8",
    )
    resolver_timeout_seconds = max(
        60,
        min(
            10 * 60,
            int(max(30_000, settings.get("browserTimeoutMs") or 30_000) * max(2, len(tasks)) / 1_000),
        ),
    )
    command = [
        node_path,
        str((REPO_ROOT / "scripts" / "resolve-douyin-media.mjs").resolve()),
        "--input-file",
        str(input_file),
        "--profile-path",
        str(settings.get("profilePath") or default_douyin_profile_path()),
        "--timeout",
        str(int(settings.get("browserTimeoutMs") or 30_000)),
    ]
    if settings.get("profileRoot"):
        command.extend(["--browser-profile-root", str(settings["profileRoot"])])
    if settings.get("browserPath"):
        command.extend(["--browser-path", str(settings["browserPath"])])
    if settings.get("headless") is False:
        command.append("--no-headless")
    elif settings.get("headless") is True:
        command.append("--headless")

    process_result = None
    payload = None
    warnings: list[str] = []
    path_stats: dict[str, int] = {}
    for task in tasks:
        increment_counter(
            path_stats,
            infer_resolution_pathway(task.get("resolutionPathway"), task.get("resolvedMediaUrl")),
        )
    last_timeout_error: subprocess.TimeoutExpired | None = None
    for attempt in range(1, 3):
        try:
            process_result = run_subprocess(
                command,
                cwd=REPO_ROOT,
                timeout=resolver_timeout_seconds * attempt,
            )
        except subprocess.TimeoutExpired as error:
            last_timeout_error = error
            if attempt >= 2:
                warnings.append(
                    "Douyin media resolver timed out; falling back to page URLs. "
                    f"PARTIAL STDOUT:\n{(error.stdout or '')}\nPARTIAL STDERR:\n{(error.stderr or '')}"
                )
                return {
                    "tasks": tasks,
                    "report": {
                        "ok": False,
                        "process": {
                            "returncode": None,
                            "stdout": error.stdout or "",
                            "stderr": error.stderr or "",
                            "timeout": resolver_timeout_seconds * attempt,
                        },
                        "pathStats": path_stats,
                        "timingsMs": {
                            "total": normalize_duration_ms(started_at_ms),
                        },
                    },
                    "warnings": warnings,
                }
            warnings.append(
                f"Douyin media resolver timed out on attempt {attempt}; retrying once with a longer timeout."
            )
            continue
        payload = None
        if process_result.stdout.strip():
            try:
                payload = json.loads(process_result.stdout)
            except Exception as error:
                warnings.append(f"Douyin media resolver returned invalid JSON: {error}")
        transient_failure = process_result.returncode != 0 and not payload and is_transient_media_resolver_failure(
            f"{process_result.stdout}\n{process_result.stderr}"
        )
        if transient_failure and attempt < 2:
            warnings.append(
                f"Douyin media resolver hit a transient startup/runtime failure on attempt {attempt}; retrying once."
            )
            continue
        break
    if process_result is None:
        timeout_stdout = getattr(last_timeout_error, "stdout", "") if last_timeout_error else ""
        timeout_stderr = getattr(last_timeout_error, "stderr", "") if last_timeout_error else ""
        return {
            "tasks": tasks,
            "report": {
                "ok": False,
                "process": {
                    "returncode": None,
                    "stdout": timeout_stdout or "",
                    "stderr": timeout_stderr or "",
                },
                "pathStats": path_stats,
                "timingsMs": {
                    "total": normalize_duration_ms(started_at_ms),
                },
            },
            "warnings": warnings,
        }
    if process_result.returncode != 0 and not payload:
        warnings.append(
            "Douyin media resolver failed; falling back to page URLs. "
            f"STDOUT:\n{process_result.stdout}\nSTDERR:\n{process_result.stderr}"
        )
        return {
            "tasks": tasks,
            "report": {
                "ok": False,
                "process": {
                    "returncode": process_result.returncode,
                    "stdout": process_result.stdout,
                    "stderr": process_result.stderr,
                },
                "pathStats": path_stats,
                "timingsMs": {
                    "total": normalize_duration_ms(started_at_ms),
                },
            },
            "warnings": warnings,
        }

    result_map: dict[str, dict[str, Any]] = {}
    for item in (payload or {}).get("results") or []:
        requested_url = normalize_url_no_fragment(item.get("requestedUrl") or "")
        if requested_url:
            result_map[requested_url] = item

    resolved_count = 0
    for task in tasks:
        if normalize_text(task.get("resolvedMediaUrl")):
            resolved_count += 1
            continue
        requested_url = normalize_url_no_fragment(task.get("finalUrl") or "")
        resolved = result_map.get(requested_url)
        if not resolved:
            continue
        task["mediaResolution"] = resolved
        task["downloadHeaders"] = merge_header_maps(
            task.get("downloadHeaders"),
            resolved.get("headers"),
        )
        if resolved.get("resolved") is True and normalize_text(resolved.get("bestUrl")):
            task["resolvedMediaUrl"] = normalize_text(resolved.get("bestUrl"))
            task["resolvedTitle"] = normalize_text(resolved.get("title")) or None
            task["resolvedFormat"] = resolved.get("bestFormat")
            task["resolvedFormats"] = resolved.get("formats") or []
            task["resolvedUserAgent"] = normalize_text(
                resolved.get("userAgent") or extract_header_map(resolved.get("headers")).get("User-Agent")
            ) or None
            task["resolvedReferer"] = normalize_text(
                resolved.get("referer") or extract_header_map(resolved.get("headers")).get("Referer")
            ) or None
            task["resolvedVia"] = "browser-detail"
            task["resolutionPathway"] = infer_resolution_pathway(
                normalize_text(resolved.get("resolutionPathway") or resolved.get("source") or "detail"),
                task.get("resolvedMediaUrl"),
            ) or "detail"
            increment_counter(path_stats, task.get("resolutionPathway"))
            resolved_count += 1

    if resolved_count <= 0:
        warnings.append("Douyin media resolver did not produce any direct media URLs; falling back to page URLs.")

    report = payload or {
        "ok": process_result.returncode == 0,
        "results": [],
    }
    report["process"] = {
        "returncode": process_result.returncode,
        "stdout": process_result.stdout,
        "stderr": process_result.stderr,
    }
    report["resolvedCount"] = resolved_count
    report["preResolvedCount"] = len(tasks) - len(unresolved_tasks)
    report["pathStats"] = path_stats
    report["timingsMs"] = {
        "total": normalize_duration_ms(started_at_ms),
    }
    return {
        "tasks": tasks,
        "report": report,
        "warnings": warnings,
    }


def build_format_selector(settings: dict[str, Any]) -> str:
    max_height = settings.get("maxHeight")
    if max_height:
        return (
            f"bestvideo*[height<={int(max_height)}]+bestaudio/"
            f"best[height<={int(max_height)}]/"
            "bestvideo*+bestaudio/best"
        )
    return "bestvideo*+bestaudio/best"


def build_output_template(settings: dict[str, Any]) -> str:
    if settings["namingStrategy"] == "stable-id":
        return "%(id)s.%(ext)s"
    return "%(title).180B [%(id)s].%(ext)s"


def build_task_output_template(task: dict[str, Any], settings: dict[str, Any]) -> str:
    if not normalize_text(task.get("resolvedMediaUrl")):
        return build_output_template(settings)
    video_id = normalize_text(task.get("videoId"))
    if settings["namingStrategy"] == "stable-id":
        return f"{slugify_ascii(video_id) or video_id or 'video'}.%(ext)s"
    resolved_title = normalize_text(task.get("resolvedTitle")) or video_id or "douyin-video"
    safe_title = slugify_ascii(resolved_title) or slugify_ascii(video_id) or video_id or "douyin-video"
    if video_id:
        return f"{safe_title} [{video_id}].%(ext)s"
    return f"{safe_title}.%(ext)s"


def resolve_download_request_context(task: dict[str, Any], tool_state: dict[str, Any]) -> dict[str, Any]:
    selected_media = select_media_candidate(task)
    download_url = normalize_text(selected_media.get("url") if selected_media else task.get("resolvedMediaUrl")) or task["finalUrl"]
    browser_export = tool_state.get("browserExport") or {}
    effective_headers = merge_header_maps(
        browser_export.get("headers"),
        selected_media.get("headers") if selected_media else None,
        task.get("downloadHeaders"),
    )
    media_headers = filter_media_request_headers(effective_headers)
    user_agent = normalize_text(
        task.get("resolvedUserAgent")
        or browser_export.get("userAgent")
        or media_headers.get("User-Agent"),
    )
    referer = normalize_text(
        task.get("resolvedReferer")
        or browser_export.get("referer")
        or media_headers.get("Referer")
        or (task["finalUrl"] if download_url != task["finalUrl"] else ""),
    )
    if user_agent:
        media_headers["User-Agent"] = user_agent
    if referer:
        media_headers["Referer"] = referer
    return {
        "downloadUrl": download_url,
        "mediaHeaders": media_headers,
        "userAgent": user_agent,
        "referer": referer,
        "selectedMedia": selected_media,
    }


def build_ytdlp_args(task: dict[str, Any], task_dir: Path, settings: dict[str, Any], tool_state: dict[str, Any]) -> list[str]:
    request_context = resolve_download_request_context(task, tool_state)
    download_url = request_context["downloadUrl"]
    media_headers = request_context["mediaHeaders"]
    user_agent = request_context["userAgent"]
    referer = request_context["referer"]
    selected_media = request_context["selectedMedia"] or {}
    direct_media = looks_like_direct_media_url(download_url)
    is_hls_direct = normalize_text(selected_media.get("protocol")).lower() == "hls" or ".m3u8" in download_url.lower()
    args = [
        tool_state["ytDlpPath"],
        "--no-playlist",
        "--newline",
        "--ignore-errors",
        "--no-warnings",
        "--continue",
        "--no-overwrites",
        "--retries",
        str(settings["taskRetries"]),
        "--fragment-retries",
        str(settings["taskRetries"]),
        "--concurrent-fragments",
        str(settings["concurrentFragments"]),
        "--merge-output-format",
        settings["container"],
        "--ffmpeg-location",
        tool_state["ffmpegLocation"],
        "--write-info-json",
        "--output",
        str(task_dir / build_task_output_template(task, settings)),
        download_url,
    ]
    if direct_media and is_hls_direct:
        args[1:1] = ["--hls-prefer-native"]
    if not direct_media:
        args[1:1] = ["--format", build_format_selector(settings)]
    if tool_state.get("cookiesFile"):
        args[1:1] = ["--cookies", tool_state["cookiesFile"]]
    if user_agent:
        args[1:1] = ["--user-agent", user_agent]
    if referer:
        args[1:1] = ["--referer", referer]
    extra_headers = media_headers
    for header_name, header_value in sorted(extra_headers.items()):
        if header_name.lower() in {"cookie", "user-agent", "referer"}:
            continue
        args[1:1] = ["--add-headers", f"{header_name}: {header_value}"]
    if settings.get("useDownloadArchive", True) and settings.get("downloadArchivePath"):
        args[1:1] = ["--download-archive", str(settings["downloadArchivePath"])]
    return args


def should_use_direct_media_download(task: dict[str, Any]) -> bool:
    selected_media = select_media_candidate(task) or {}
    download_url = normalize_text(selected_media.get("url") or task.get("resolvedMediaUrl"))
    if not looks_like_direct_media_url(download_url):
        return False
    return normalize_text(selected_media.get("protocol")).lower() != "hls" and ".m3u8" not in download_url.lower()


def infer_direct_media_extension(task: dict[str, Any], response_headers: Any | None = None) -> str:
    selected_media = select_media_candidate(task) or {}
    download_url = normalize_text(selected_media.get("url") or task.get("resolvedMediaUrl"))
    path = normalize_text(urlparse(download_url).path).lower()
    for extension in sorted(MEDIA_EXTENSIONS):
        if path.endswith(extension):
            return extension.lstrip(".")
    content_type = normalize_text(
        response_headers.get("Content-Type") if response_headers is not None else ""
    ).lower()
    if "webm" in content_type:
        return "webm"
    if "quicktime" in content_type or "mov" in content_type:
        return "mov"
    if "matroska" in content_type or "mkv" in content_type:
        return "mkv"
    return normalize_text(task.get("container") or "") or "mp4"


def build_direct_media_output_path(task: dict[str, Any], task_dir: Path, settings: dict[str, Any], response_headers: Any | None = None) -> Path:
    extension = infer_direct_media_extension(task, response_headers)
    template = build_task_output_template(task, settings)
    filename = template.replace("%(ext)s", extension)
    return task_dir / filename


def download_direct_media(task: dict[str, Any], task_dir: Path, settings: dict[str, Any], tool_state: dict[str, Any]) -> dict[str, Any]:
    request_context = resolve_download_request_context(task, tool_state)
    download_url = request_context["downloadUrl"]
    headers = dict(request_context["mediaHeaders"])
    request = Request(download_url, headers=headers)
    timeout_seconds = max(30, int(max(30_000, settings.get("browserTimeoutMs") or 30_000) / 1_000))
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            output_path = build_direct_media_output_path(task, task_dir, settings, response.headers)
            with output_path.open("wb") as handle:
                shutil.copyfileobj(response, handle, length=1024 * 1024)
        write_json(
            task_dir / f"{output_path.stem}.info.json",
            {
                "id": task.get("videoId"),
                "title": task.get("resolvedTitle"),
                "webpage_url": task.get("finalUrl"),
                "url": download_url,
                "format_id": (task.get("resolvedFormat") or {}).get("formatId"),
                "ext": output_path.suffix.lower().lstrip("."),
            },
        )
        return {
            "ok": True,
            "downloadedFile": str(output_path.resolve()),
            "stdout": f"[direct-media] Downloaded {download_url} -> {output_path.name}",
            "stderr": "",
        }
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        return {
            "ok": False,
            "downloadedFile": None,
            "stdout": "",
            "stderr": "",
            "error": str(error),
        }


def verify_downloaded_file(file_path: Path, ffprobe_path: str | None = None) -> tuple[bool, str | None]:
    if not file_path.exists() or file_path.stat().st_size <= 0:
        return False, "missing-or-empty-file"
    if not ffprobe_path:
        return True, None
    result = run_subprocess(
        [
            ffprobe_path,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nokey=1:noprint_wrappers=1",
            str(file_path),
        ]
    )
    if result.returncode != 0:
        return False, result.stderr.strip() or "ffprobe-failed"
    return True, None


def load_download_archive(path_value: Path) -> set[str]:
    if not path_value.exists():
        return set()
    return {line.strip() for line in path_value.read_text(encoding="utf-8").splitlines() if line.strip()}


def append_download_archive(path_value: Path, entries: set[str], archive_state: dict[str, Any] | None = None) -> None:
    if not entries:
        return
    path_value.parent.mkdir(parents=True, exist_ok=True)
    if archive_state is None:
        existing = load_download_archive(path_value)
        existing.update(entries)
        path_value.write_text("".join(f"{entry}\n" for entry in sorted(existing)), encoding="utf-8")
        return
    with archive_state["lock"]:
        archive_state["entries"].update(entries)
        path_value.write_text("".join(f"{entry}\n" for entry in sorted(archive_state["entries"])), encoding="utf-8")


def find_primary_media_file(task_dir: Path) -> Path | None:
    candidates = [
        candidate
        for candidate in task_dir.iterdir()
        if candidate.is_file()
        and candidate.suffix.lower() in MEDIA_EXTENSIONS
        and candidate.stat().st_size > 0
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda item: item.stat().st_size, reverse=True)
    return candidates[0]


def parse_info_json(task_dir: Path) -> dict[str, Any] | None:
    for candidate in sorted(task_dir.glob("*.info.json")):
        try:
            return load_json(candidate)
        except Exception:
            continue
    return None


def task_directory_name(task: dict[str, Any], settings: dict[str, Any]) -> str:
    title_seed = task.get("videoId") or sha256_text(task["finalUrl"])[:12]
    if settings["namingStrategy"] == "stable-id":
        return slugify_ascii(title_seed) or title_seed
    slug = slugify_ascii(task.get("videoId") or title_seed) or title_seed
    return slug


def build_download_result(
    task: dict[str, Any],
    *,
    status: str,
    task_dir: Path | None,
    downloaded_file: str | None = None,
    title: str | None = None,
    quality: dict[str, Any] | None = None,
    stdout: str = "",
    stderr: str = "",
    error: str | None = None,
    info: dict[str, Any] | None = None,
    pathway: str | None = None,
    timings_ms: dict[str, Any] | None = None,
) -> dict[str, Any]:
    archive_keys = sorted(build_archive_keys(task, info))
    canonical_url = canonicalize_douyin_video_url(
        normalize_text((info or {}).get("webpage_url")) or normalize_text(task.get("finalUrl")),
        normalize_text(task.get("videoId")) or normalize_text((info or {}).get("id")),
    )
    content_key = build_content_key(
        normalize_text(task.get("videoId")) or normalize_text((info or {}).get("id")),
        canonical_url,
    )
    return {
        "finalUrl": task["finalUrl"],
        "canonicalUrl": canonical_url,
        "contentKey": content_key,
        "archiveKeys": archive_keys,
        "videoId": normalize_text(task.get("videoId")) or normalize_text((info or {}).get("id")) or None,
        "status": status,
        "taskDir": str(task_dir) if task_dir else None,
        "downloadedFile": downloaded_file,
        "title": title,
        "quality": quality,
        "stdout": stdout,
        "stderr": stderr,
        "error": error,
        "pathway": normalize_text(pathway) or None,
        "resolutionPathway": infer_resolution_pathway(task.get("resolutionPathway"), task.get("resolvedMediaUrl")),
        "timingsMs": timings_ms or {},
    }


def execute_download_task(
    task: dict[str, Any],
    *,
    run_dir: Path,
    settings: dict[str, Any],
    tool_state: dict[str, Any],
    archive_state: dict[str, Any] | None = None,
) -> dict[str, Any]:
    started_at_ms = current_time_ms()
    task_dir = run_dir / task_directory_name(task, settings)
    task_dir.mkdir(parents=True, exist_ok=True)
    archive_keys = build_archive_keys(task)
    if archive_state and archive_keys.intersection(archive_state["entries"]):
        return build_download_result(
            task,
            status="skipped",
            task_dir=task_dir,
            title=task.get("resolvedTitle"),
            pathway="archive-skip",
            timings_ms={
                "total": normalize_duration_ms(started_at_ms),
            },
        )
    if settings["dryRun"]:
        return build_download_result(
            task,
            status="planned",
            task_dir=task_dir,
            quality={
                "container": settings["container"],
                "maxHeight": settings.get("maxHeight"),
            },
            pathway="dry-run",
            timings_ms={
                "total": normalize_duration_ms(started_at_ms),
            },
        )

    direct_download_result = None
    direct_media_duration_ms = 0
    if should_use_direct_media_download(task):
        direct_started_at_ms = current_time_ms()
        direct_download_result = download_direct_media(task, task_dir, settings, tool_state)
        direct_media_duration_ms = normalize_duration_ms(direct_started_at_ms)
        if direct_download_result.get("ok") and direct_download_result.get("downloadedFile"):
            media_file = Path(direct_download_result["downloadedFile"]).resolve()
            verified = True
            verify_error = None
            verify_duration_ms = 0
            if settings.get("verifyDownload", True):
                verify_started_at_ms = current_time_ms()
                verified, verify_error = verify_downloaded_file(media_file, tool_state.get("ffprobePath"))
                verify_duration_ms = normalize_duration_ms(verify_started_at_ms)
            if verified:
                if archive_state:
                    append_download_archive(Path(archive_state["path"]), archive_keys, archive_state)
                return build_download_result(
                    task,
                    status="success",
                    task_dir=task_dir,
                    downloaded_file=str(media_file),
                    title=task.get("resolvedTitle"),
                    quality={
                        "container": media_file.suffix.lower().lstrip("."),
                        "height": (task.get("resolvedFormat") or {}).get("height"),
                        "formatId": (task.get("resolvedFormat") or {}).get("formatId"),
                    },
                    stdout=direct_download_result.get("stdout") or "",
                    stderr=direct_download_result.get("stderr") or "",
                    pathway="direct-media",
                    timings_ms={
                        "directMedia": direct_media_duration_ms,
                        "verify": verify_duration_ms,
                        "total": normalize_duration_ms(started_at_ms),
                    },
                )
            direct_download_result["error"] = verify_error or "download-verification-failed"

    ytdlp_started_at_ms = current_time_ms()
    command = build_ytdlp_args(task, task_dir, settings, tool_state)
    result = run_subprocess(command, cwd=task_dir)
    ytdlp_duration_ms = normalize_duration_ms(ytdlp_started_at_ms)
    info = parse_info_json(task_dir) or {}
    media_file = find_primary_media_file(task_dir)
    combined_output = f"{result.stdout}\n{result.stderr}".lower()
    archive_skipped = (
        media_file is None
        and (
            "already been recorded in the archive" in combined_output
            or "has already been downloaded" in combined_output
        )
    )

    if archive_skipped:
        return build_download_result(
            task,
            status="skipped",
            task_dir=task_dir,
            title=info.get("title") or task.get("resolvedTitle"),
            stdout=result.stdout,
            stderr=result.stderr,
            info=info,
            pathway="archive-skip",
            timings_ms={
                "directMedia": direct_media_duration_ms,
                "ytDlp": ytdlp_duration_ms,
                "total": normalize_duration_ms(started_at_ms),
            },
        )

    if result.returncode != 0 and not media_file:
        return build_download_result(
            task,
            status="failed",
            task_dir=task_dir,
            title=info.get("title") or task.get("resolvedTitle"),
            stdout=result.stdout,
            stderr=result.stderr,
            error=(
                f"direct-media-fallback: {direct_download_result.get('error')}; " if direct_download_result and direct_download_result.get("error") else ""
            ) + (result.stderr.strip() or result.stdout.strip() or f"yt-dlp exited with code {result.returncode}"),
            info=info,
            pathway="yt-dlp-direct-media" if looks_like_direct_media_url(normalize_text(task.get("resolvedMediaUrl"))) else "yt-dlp-page",
            timings_ms={
                "directMedia": direct_media_duration_ms,
                "ytDlp": ytdlp_duration_ms,
                "total": normalize_duration_ms(started_at_ms),
            },
        )

    verified = True
    verify_error = None
    verify_duration_ms = 0
    if settings.get("verifyDownload", True) and media_file:
        verify_started_at_ms = current_time_ms()
        verified, verify_error = verify_downloaded_file(media_file, tool_state.get("ffprobePath"))
        verify_duration_ms = normalize_duration_ms(verify_started_at_ms)

    if media_file and verified:
        if archive_state:
            append_download_archive(Path(archive_state["path"]), build_archive_keys(task, info), archive_state)
        direct_url = normalize_text(resolve_download_request_context(task, tool_state).get("downloadUrl"))
        pathway = "yt-dlp-page"
        if looks_like_direct_media_url(direct_url):
            pathway = "yt-dlp-direct-hls" if ".m3u8" in direct_url.lower() else "yt-dlp-direct-media"
        return build_download_result(
            task,
            status="success",
            task_dir=task_dir,
            downloaded_file=str(media_file.resolve()),
            title=info.get("title") or task.get("resolvedTitle"),
            quality={
                "container": media_file.suffix.lower().lstrip("."),
                "height": info.get("height"),
                "formatId": info.get("format_id"),
            },
            stdout=result.stdout,
            stderr=result.stderr,
            info=info,
            pathway=pathway,
            timings_ms={
                "directMedia": direct_media_duration_ms,
                "ytDlp": ytdlp_duration_ms,
                "verify": verify_duration_ms,
                "total": normalize_duration_ms(started_at_ms),
            },
        )

    direct_url = normalize_text(resolve_download_request_context(task, tool_state).get("downloadUrl"))
    pathway = "yt-dlp-page"
    if looks_like_direct_media_url(direct_url):
        pathway = "yt-dlp-direct-hls" if ".m3u8" in direct_url.lower() else "yt-dlp-direct-media"
    return build_download_result(
        task,
        status="failed",
        task_dir=task_dir,
        downloaded_file=str(media_file.resolve()) if media_file else None,
        title=info.get("title") or task.get("resolvedTitle"),
        stdout=result.stdout,
        stderr=result.stderr,
        error=(
            f"direct-media-fallback: {direct_download_result.get('error')}; " if direct_download_result and direct_download_result.get("error") else ""
        ) + (verify_error or "download-verification-failed"),
        info=info,
        pathway=pathway,
        timings_ms={
            "directMedia": direct_media_duration_ms,
            "ytDlp": ytdlp_duration_ms,
            "verify": verify_duration_ms,
            "total": normalize_duration_ms(started_at_ms),
        },
    )


def execute_download_plan(
    tasks: list[dict[str, Any]],
    *,
    run_dir: Path,
    settings: dict[str, Any],
    tool_state: dict[str, Any],
    archive_state: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    if settings["dryRun"] or settings["concurrency"] <= 1 or len(tasks) <= 1:
        return [
            execute_download_task(task, run_dir=run_dir, settings=settings, tool_state=tool_state, archive_state=archive_state)
            for task in tasks
        ]

    results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=settings["concurrency"]) as executor:
        future_map = {
            executor.submit(
                execute_download_task,
                task,
                run_dir=run_dir,
                settings=settings,
                tool_state=tool_state,
                archive_state=archive_state,
            ): task
            for task in tasks
        }
        for future in as_completed(future_map):
            task = future_map[future]
            try:
                results.append(future.result())
            except Exception as error:
                results.append(
                    build_download_result(
                        task,
                        status="failed",
                        task_dir=run_dir / task_directory_name(task, settings),
                        error=str(error),
                        pathway="executor-error",
                    )
                )
    results.sort(key=lambda item: normalize_text(item.get("finalUrl")))
    return results


def collect_result_path_stats(results: list[dict[str, Any]]) -> dict[str, int]:
    stats: dict[str, int] = {}
    for item in results:
        increment_counter(stats, item.get("pathway"))
    return stats


def collect_step_timing_totals(results: list[dict[str, Any]]) -> dict[str, int]:
    totals: dict[str, int] = {}
    for item in results:
        for key, value in (item.get("timingsMs") or {}).items():
            if isinstance(value, (int, float)):
                totals[key] = totals.get(key, 0) + int(value)
    return totals


def build_summary_view(manifest: dict[str, Any]) -> dict[str, Any]:
    return {
        "host": manifest.get("host"),
        "runDir": manifest.get("runDir"),
        "dryRun": manifest.get("dryRun"),
        "usedLoginState": manifest.get("usedLoginState"),
        "summary": manifest.get("summary") or {},
        "statistics": manifest.get("statistics") or {},
        "downloadArchive": manifest.get("downloadArchive") or {},
        "warnings": manifest.get("warnings") or [],
    }


def resolve_tool_state(settings: dict[str, Any], downloader_config: dict[str, Any], run_dir: Path) -> dict[str, Any]:
    user_data_dir = resolve_persistent_user_data_dir(
        "https://www.douyin.com/",
        root_dir=settings.get("profileRoot"),
    ) if settings.get("reuseLoginState") else None
    profile_health = inspect_persistent_profile_health(user_data_dir) if user_data_dir else None
    warnings = []
    if profile_health:
        warnings.extend(profile_health.get("warnings") or [])
    if downloader_config.get("requiresLoginForHighestQuality") and not (profile_health and profile_health.get("usableForCookies")):
        warnings.append("Reusable Douyin login state is unavailable; highest quality and protected pages require a healthy local session.")
    if settings.get("dryRun"):
        return {
            "ytDlpPath": None,
            "ffmpegPath": None,
            "ffprobePath": None,
            "ffmpegLocation": None,
            "profileHealth": profile_health,
            "cookiesFile": None,
            "usedLoginState": False,
            "cookiesExport": None,
            "browserExport": None,
            "warnings": warnings,
        }
    yt_dlp_path = resolve_tool_path("yt-dlp", settings.get("ytDlpPath"))
    ffmpeg_path = resolve_tool_path("ffmpeg", settings.get("ffmpegPath"))
    ffprobe_path = resolve_ffprobe_path(ffmpeg_path, settings.get("ffprobePath"))
    cookies_export = export_cookies(settings, run_dir) if settings.get("reuseLoginState") else {"path": None, "generated": False, "details": None}
    browser_export = resolve_browser_export_metadata(cookies_export.get("path"), cookies_export.get("details"))
    return {
        "ytDlpPath": yt_dlp_path,
        "ffmpegPath": ffmpeg_path,
        "ffprobePath": ffprobe_path,
        "ffmpegLocation": str(Path(ffmpeg_path).resolve().parent),
        "profileHealth": profile_health,
        "cookiesFile": cookies_export.get("path"),
        "usedLoginState": bool(cookies_export.get("path") or browser_export),
        "cookiesExport": cookies_export.get("details"),
        "browserExport": browser_export,
        "warnings": warnings,
    }


def merge_settings(options: dict[str, Any] | None = None) -> dict[str, Any]:
    merged = {
        "inputFile": None,
        "outDir": None,
        "reuseLoginState": True,
        "profileRoot": None,
        "profilePath": None,
        "cookiesFile": None,
        "concurrency": DEFAULT_CONCURRENCY,
        "maxItems": None,
        "taskRetries": 5,
        "concurrentFragments": DEFAULT_CONCURRENT_FRAGMENTS,
        "dryRun": False,
        "verifyDownload": True,
        "useDownloadArchive": True,
        "downloadArchivePath": None,
        "browserPath": None,
        "browserTimeoutMs": 30_000,
        "nodePath": None,
        "container": DEFAULT_CONTAINER,
        "maxHeight": None,
        "namingStrategy": DEFAULT_NAMING_STRATEGY,
        "ytDlpPath": None,
        "ffmpegPath": None,
        "ffprobePath": None,
        "headless": None,
    }
    merged.update(options or {})
    merged["concurrency"] = max(1, int(merged["concurrency"]))
    merged["taskRetries"] = max(0, int(merged["taskRetries"]))
    merged["concurrentFragments"] = max(1, int(merged["concurrentFragments"]))
    if merged["maxItems"] is not None:
        merged["maxItems"] = max(1, int(merged["maxItems"]))
    merged["container"] = normalize_text(merged["container"]).lower() or DEFAULT_CONTAINER
    if merged["container"] not in {"mp4", "mkv"}:
        raise DownloadDouyinError("Unsupported --container value. Supported values are mp4 and mkv.")
    if merged["maxHeight"] is not None:
        merged["maxHeight"] = max(144, int(merged["maxHeight"]))
    merged["namingStrategy"] = normalize_text(merged["namingStrategy"]).lower() or DEFAULT_NAMING_STRATEGY
    if merged["namingStrategy"] not in {"title-id", "stable-id"}:
        raise DownloadDouyinError("Unsupported --naming-strategy value. Supported values are title-id and stable-id.")
    return merged


def resolve_output_root(settings: dict[str, Any], downloader_config: dict[str, Any]) -> Path:
    explicit = settings.get("outDir")
    if explicit:
        return Path(explicit).resolve()
    configured = downloader_config.get("defaultOutputRoot")
    if configured:
        return (REPO_ROOT / configured).resolve() if not Path(configured).is_absolute() else Path(configured).resolve()
    return DEFAULT_OUTPUT_ROOT.resolve()


def build_report_markdown(manifest: dict[str, Any]) -> str:
    summary = manifest.get("summary") or {}
    statistics = manifest.get("statistics") or {}
    path_stats = statistics.get("pathStats") or {}
    media_path_stats = ((manifest.get("mediaResolution") or {}).get("pathStats")) or {}
    timings_ms = statistics.get("timingsMs") or {}
    lines = [
        "# Douyin Download Report",
        "",
        f"- Run Dir: `{manifest.get('runDir')}`",
        f"- Total: {summary.get('total', 0)}",
        f"- Successful: {summary.get('successful', 0)}",
        f"- Failed: {summary.get('failed', 0)}",
        f"- Skipped: {summary.get('skipped', 0)}",
        f"- Planned: {summary.get('planned', 0)}",
        f"- Used Login State: {manifest.get('usedLoginState')}",
        "",
        "## Path Stats",
    ]
    for key in sorted(path_stats):
        lines.append(f"- Download `{key}`: {path_stats[key]}")
    for key in sorted(media_path_stats):
        lines.append(f"- Media Resolve `{key}`: {media_path_stats[key]}")
    lines.extend([
        "",
        "## Timings",
    ])
    for key in sorted(timings_ms):
        lines.append(f"- `{key}`: {timings_ms[key]} ms")
    lines.extend([
        "",
        "## Results",
    ])
    for item in manifest.get("results") or []:
        lines.append(
            f"- `{item.get('status')}` | `{item.get('pathway') or 'unknown'}` | "
            f"{item.get('title') or item.get('videoId') or item.get('finalUrl')} | "
            f"{item.get('downloadedFile') or item.get('error') or 'pending'}"
        )
    if manifest.get("warnings"):
        lines.extend([
            "",
            "## Warnings",
            *[f"- {warning}" for warning in manifest["warnings"]],
        ])
    return "\n".join(lines) + "\n"


def build_cli_output(manifest: dict[str, Any], output_mode: str, output_format: str) -> str:
    mode = normalize_text(output_mode).lower() or DEFAULT_OUTPUT_MODE
    fmt = normalize_text(output_format).lower() or DEFAULT_OUTPUT_FORMAT
    payload: Any
    if mode == "summary":
        payload = manifest.get("summaryView") or build_summary_view(manifest)
    elif mode == "results":
        payload = manifest.get("results") or []
    else:
        payload = manifest
    if fmt == "markdown":
        if mode == "summary":
            summary_view = payload if isinstance(payload, dict) else build_summary_view(manifest)
            lines = [
                "# Douyin Download Summary",
                "",
                f"- Run Dir: `{summary_view.get('runDir')}`",
                f"- Total: {(summary_view.get('summary') or {}).get('total', 0)}",
                f"- Successful: {(summary_view.get('summary') or {}).get('successful', 0)}",
                f"- Failed: {(summary_view.get('summary') or {}).get('failed', 0)}",
                f"- Skipped: {(summary_view.get('summary') or {}).get('skipped', 0)}",
                f"- Planned: {(summary_view.get('summary') or {}).get('planned', 0)}",
                "",
            ]
            for key, value in sorted(((summary_view.get("statistics") or {}).get("pathStats") or {}).items()):
                lines.append(f"- Path `{key}`: {value}")
            return "\n".join(lines).rstrip() + "\n"
        return manifest.get("reportMarkdown") or build_report_markdown(manifest)
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def download_douyin(inputs: list[str], options: dict[str, Any] | None = None) -> dict[str, Any]:
    started_at_ms = current_time_ms()
    settings = merge_settings(options)
    profile_bundle = resolve_douyin_profile(settings.get("profilePath"))
    profile = profile_bundle["profile"]
    downloader_config = resolve_downloader_config(profile)
    if settings["maxHeight"] is None and downloader_config["qualityPolicy"].get("targetHeight"):
        settings["maxHeight"] = int(downloader_config["qualityPolicy"]["targetHeight"])
    if settings["container"] == DEFAULT_CONTAINER and downloader_config.get("defaultContainer"):
        settings["container"] = downloader_config["defaultContainer"]
    if settings["namingStrategy"] == DEFAULT_NAMING_STRATEGY and downloader_config.get("defaultNamingStrategy"):
        settings["namingStrategy"] = downloader_config["defaultNamingStrategy"]
    input_items = load_input_items(inputs, settings.get("inputFile"))
    if settings["maxItems"] is not None:
        input_items = input_items[: settings["maxItems"]]

    output_root = resolve_output_root(settings, downloader_config)
    host_root = host_video_download_root(output_root, "www.douyin.com")
    host_root.mkdir(parents=True, exist_ok=True)
    run_dir = host_root / current_run_id("www.douyin.com")
    run_dir.mkdir(parents=True, exist_ok=True)

    if settings.get("useDownloadArchive", True) and not settings.get("downloadArchivePath"):
        settings["downloadArchivePath"] = str((host_root / DEFAULT_DOWNLOAD_ARCHIVE_NAME).resolve())

    tool_state_started_at_ms = current_time_ms()
    tool_state = resolve_tool_state(settings, downloader_config, run_dir)
    tool_state_duration_ms = normalize_duration_ms(tool_state_started_at_ms)
    archive_state = None
    if settings.get("useDownloadArchive", True):
        download_archive_path = Path(settings["downloadArchivePath"]).resolve()
        archive_state = {
            "path": str(download_archive_path),
            "entries": load_download_archive(download_archive_path),
            "lock": threading.Lock(),
        }
    tasks = [
        {
            "finalUrl": item["normalizedUrl"],
            "videoId": item.get("videoId"),
            "source": item["source"],
            "resolvedMediaUrl": item.get("resolvedMediaUrl"),
            "resolvedTitle": item.get("resolvedTitle"),
            "resolvedFormat": item.get("resolvedFormat"),
            "resolvedFormats": item.get("resolvedFormats") or [],
            "downloadHeaders": item.get("downloadHeaders") or {},
        }
        for item in input_items
    ]
    media_resolution_started_at_ms = current_time_ms()
    media_resolution = resolve_media_tasks(tasks, settings, run_dir)
    media_resolution_duration_ms = normalize_duration_ms(media_resolution_started_at_ms)
    tasks = media_resolution["tasks"]
    if media_resolution["report"] and media_resolution["report"].get("resolvedCount"):
        progress_log_stderr(f"Resolved {media_resolution['report']['resolvedCount']} Douyin media URL(s) via browser detail API")
    for warning in media_resolution["warnings"]:
        tool_state["warnings"].append(warning)
    progress_log_stderr(f"Resolved {len(tasks)} Douyin download task(s) into {run_dir}")
    download_plan_started_at_ms = current_time_ms()
    results = execute_download_plan(
        tasks,
        run_dir=run_dir,
        settings=settings,
        tool_state=tool_state,
        archive_state=archive_state,
    )
    download_plan_duration_ms = normalize_duration_ms(download_plan_started_at_ms)
    summary = {
        "total": len(results),
        "successful": sum(1 for item in results if item["status"] == "success"),
        "failed": sum(1 for item in results if item["status"] == "failed"),
        "skipped": sum(1 for item in results if item["status"] == "skipped"),
        "planned": sum(1 for item in results if item["status"] == "planned"),
    }
    statistics = {
        "pathStats": collect_result_path_stats(results),
        "timingsMs": {
            "toolSetup": tool_state_duration_ms,
            "mediaResolution": media_resolution_duration_ms,
            "downloadPlan": download_plan_duration_ms,
            "taskTotals": collect_step_timing_totals(results),
            "total": normalize_duration_ms(started_at_ms),
        },
    }
    manifest = {
        "host": "www.douyin.com",
        "profilePath": profile_bundle["path"],
        "runDir": str(run_dir.resolve()),
        "inputItems": input_items,
        "concurrency": settings["concurrency"],
        "dryRun": settings["dryRun"],
        "usedLoginState": tool_state["usedLoginState"],
        "profileHealth": tool_state["profileHealth"],
        "cookiesExport": tool_state.get("cookiesExport"),
        "browserExport": tool_state.get("browserExport"),
        "mediaResolution": media_resolution.get("report"),
        "qualityPolicy": {
            "container": settings["container"],
            "maxHeight": settings["maxHeight"],
            "requiresLoginForHighestQuality": downloader_config["requiresLoginForHighestQuality"],
        },
        "downloadArchive": {
            "enabled": bool(settings.get("useDownloadArchive", True)),
            "path": settings.get("downloadArchivePath"),
            "entriesKnown": len(archive_state["entries"]) if archive_state else 0,
        },
        "tools": {
            "ytDlpPath": tool_state["ytDlpPath"],
            "ffmpegPath": tool_state["ffmpegPath"],
            "ffprobePath": tool_state.get("ffprobePath"),
            "cookiesFile": tool_state.get("cookiesFile"),
            "browserExport": tool_state.get("browserExport"),
        },
        "results": results,
        "summary": summary,
        "statistics": statistics,
        "warnings": tool_state["warnings"],
    }
    manifest["summaryView"] = build_summary_view(manifest)
    manifest["reportMarkdown"] = build_report_markdown(manifest)
    write_json(run_dir / "download-manifest.json", manifest)
    write_text(run_dir / "download-report.md", manifest["reportMarkdown"])
    return manifest


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Download resolved Douyin video URLs with highest available quality.",
    )
    parser.add_argument("inputs", nargs="*", help="Douyin video URLs or numeric video IDs")
    parser.add_argument("--input-file", dest="input_file", help="Optional file containing one Douyin video URL per line")
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY, help="Number of concurrent video downloads")
    parser.add_argument("--out-dir", dest="out_dir", help="Output root directory for downloaded Douyin videos")
    parser.add_argument("--reuse-login-state", dest="reuse_login_state", action="store_true", default=True, help="Reuse the project Douyin persistent browser profile for cookies")
    parser.add_argument("--no-reuse-login-state", dest="reuse_login_state", action="store_false", help="Do not reuse browser login state")
    parser.add_argument("--profile-root", dest="profile_root", help="Override the project browser profile root directory")
    parser.add_argument("--profile-path", dest="profile_path", help="Override the Douyin profile JSON path")
    parser.add_argument("--cookies-file", dest="cookies_file", help="Optional Netscape cookie file path; overrides automatic cookie export")
    parser.add_argument("--dry-run", action="store_true", help="Resolve tasks without downloading media")
    parser.add_argument("--max-items", type=int, help="Maximum number of resolved video items to download")
    parser.add_argument("--task-retries", type=int, default=5, help="Number of retry attempts after the initial download try")
    parser.add_argument("--concurrent-fragments", type=int, default=DEFAULT_CONCURRENT_FRAGMENTS, help="yt-dlp concurrent fragment count per video")
    parser.add_argument("--container", default=DEFAULT_CONTAINER, help="Merged output container: mp4 or mkv")
    parser.add_argument("--max-height", type=int, help="Prefer formats at or below this height")
    parser.add_argument("--naming-strategy", default=DEFAULT_NAMING_STRATEGY, help="Task directory naming strategy: title-id or stable-id")
    parser.add_argument("--download-archive", dest="download_archive_path", help="Path to the content-level download archive text file")
    parser.add_argument("--no-download-archive", dest="use_download_archive", action="store_false", default=True, help="Disable the content-level download archive")
    parser.add_argument("--no-verify-download", dest="verify_download", action="store_false", default=True, help="Skip post-download media verification")
    parser.add_argument("--yt-dlp-path", dest="yt_dlp_path", help="Optional explicit path to yt-dlp")
    parser.add_argument("--ffmpeg-path", dest="ffmpeg_path", help="Optional explicit path to ffmpeg")
    parser.add_argument("--ffprobe-path", dest="ffprobe_path", help="Optional explicit path to ffprobe")
    parser.add_argument("--browser-path", dest="browser_path", help="Optional explicit browser path for cookie export")
    parser.add_argument("--node-path", dest="node_path", help="Optional explicit Node.js path for cookie export")
    parser.add_argument("--browser-timeout", dest="browser_timeout_ms", type=int, default=30_000, help="Timeout for browser-based cookie export")
    parser.add_argument("--headless", dest="headless", action="store_true", default=None, help="Export cookies using a headless browser session")
    parser.add_argument("--no-headless", dest="headless", action="store_false", help="Export cookies using a visible browser session")
    parser.add_argument("--output", default=DEFAULT_OUTPUT_MODE, choices=["full", "summary", "results"], help="CLI output payload selection")
    parser.add_argument("--format", dest="output_format", default=DEFAULT_OUTPUT_FORMAT, choices=["json", "markdown"], help="CLI output format")
    return parser


def parse_args(argv: list[str]) -> argparse.Namespace:
    return build_arg_parser().parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    init_console_utf8()
    args = parse_args(argv or sys.argv[1:])
    manifest = download_douyin(
        args.inputs,
        options={
            "inputFile": args.input_file,
            "concurrency": args.concurrency,
            "outDir": args.out_dir,
            "reuseLoginState": args.reuse_login_state,
            "profileRoot": args.profile_root,
            "profilePath": args.profile_path,
            "cookiesFile": args.cookies_file,
            "dryRun": args.dry_run,
            "maxItems": args.max_items,
            "taskRetries": args.task_retries,
            "concurrentFragments": args.concurrent_fragments,
            "container": args.container,
            "maxHeight": args.max_height,
            "namingStrategy": args.naming_strategy,
            "downloadArchivePath": args.download_archive_path,
            "useDownloadArchive": args.use_download_archive,
            "verifyDownload": args.verify_download,
            "ytDlpPath": args.yt_dlp_path,
            "ffmpegPath": args.ffmpeg_path,
            "ffprobePath": args.ffprobe_path,
            "browserPath": args.browser_path,
            "nodePath": args.node_path,
            "browserTimeoutMs": args.browser_timeout_ms,
            "headless": args.headless,
        },
    )
    sys.stdout.write(build_cli_output(manifest, args.output, args.output_format))
    return 1 if manifest["summary"]["failed"] > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
