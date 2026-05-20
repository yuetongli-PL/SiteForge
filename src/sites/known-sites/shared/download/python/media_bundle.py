#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen

REPO_ROOT = Path(__file__).resolve().parents[6]
DEFAULT_OUTPUT_ROOT = REPO_ROOT / "media-downloads"
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36"
)
KNOWN_IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp")
LOCAL_HTTP_HOSTS = {"127.0.0.1", "localhost", "::1"}
SCHEMA_VERSION = 1
CACHE_DIR_NAME = ".cache"
ASSET_CACHE_DIR_NAME = "assets"
ASSET_CACHE_INDEX_NAME = "asset-index.json"
RUN_INDEX_MARKDOWN_NAME = "index.md"
ITEM_INDEX_MARKDOWN_NAME = "index.md"
LEGACY_ITEM_MARKDOWN_NAME = "note.md"


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def current_timestamp_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sanitize_host(host: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9.-]+", "-", normalize_text(host) or "unknown-host")
    cleaned = re.sub(r"-+", "-", cleaned).strip("-")
    return cleaned or "unknown-host"


def slugify_ascii(value: Any, fallback: str = "item") -> str:
    text = normalize_text(value)
    if not text:
        return fallback
    normalized = text.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", normalized).strip("-").lower()
    return slug or fallback


def sha256_text(value: Any) -> str:
    return hashlib.sha256(normalize_text(value).encode("utf-8")).hexdigest()


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def unique_strings(values: list[Any]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        text = normalize_text(value)
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def ensure_dir(path_value: str | Path) -> Path:
    path_obj = Path(path_value)
    path_obj.mkdir(parents=True, exist_ok=True)
    return path_obj


def write_json(path_value: str | Path, payload: Any) -> None:
    path_obj = Path(path_value)
    ensure_dir(path_obj.parent)
    path_obj.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_text(path_value: str | Path, payload: str) -> None:
    path_obj = Path(path_value)
    ensure_dir(path_obj.parent)
    path_obj.write_text(payload, encoding="utf-8")


def format_timestamp_for_dir(date: datetime | None = None) -> str:
    current = date or datetime.now(timezone.utc)
    return current.strftime("%Y%m%dT%H%M%S%fZ")


def normalize_https_url(value: Any) -> str | None:
    text = normalize_text(value)
    if not text:
        return None
    if text.startswith("//"):
        text = f"https:{text}"
    if text.startswith("http://"):
        hostname = urlparse(text).hostname or ""
        if hostname not in LOCAL_HTTP_HOSTS:
            text = "https://" + text.removeprefix("http://")
    return text


def guess_extension(url: str | None, fallback: str = ".jpg") -> str:
    text = normalize_text(url)
    if not text:
        return fallback
    parsed = urlparse(text)
    suffix = Path(parsed.path).suffix.lower()
    if suffix in KNOWN_IMAGE_SUFFIXES:
        return suffix
    lowered = parsed.path.lower()
    for candidate in ("webp", "jpeg", "jpg", "png", "gif", "bmp"):
        if candidate in lowered:
            return f".{candidate}"
    return fallback


def load_input_items(positionals: list[str] | None = None, input_file: str | Path | None = None) -> list[Any]:
    if input_file:
        text = Path(input_file).read_text(encoding="utf-8")
        stripped = text.strip()
        if not stripped:
            return []
        if stripped.startswith("["):
            payload = json.loads(stripped)
            return payload if isinstance(payload, list) else [payload]
        if stripped.startswith("{"):
            payload = json.loads(stripped)
            return [payload]
        items: list[Any] = []
        for line in text.splitlines():
            stripped_line = line.strip()
            if not stripped_line:
                continue
            if stripped_line.startswith("{"):
                items.append(json.loads(stripped_line))
            else:
                items.append(stripped_line)
        return items
    return list(positionals or [])


def merge_settings(
    raw: dict[str, Any] | None = None,
    downloader_config: dict[str, Any] | None = None,
    *,
    default_output_root: str | Path | None = None,
) -> dict[str, Any]:
    config = dict(downloader_config or {})
    settings = {
        "dryRun": bool((raw or {}).get("dryRun", False)),
        "outDir": str(
            Path(
                normalize_text((raw or {}).get("outDir"))
                or normalize_text(config.get("defaultOutputRoot"))
                or str(default_output_root or DEFAULT_OUTPUT_ROOT)
            ).resolve()
        ),
        "maxItems": int((raw or {}).get("maxItems") or config.get("maxBatchItems") or 10),
        "requestTimeoutSeconds": int((raw or {}).get("requestTimeoutSeconds") or 30),
        "userAgent": normalize_text((raw or {}).get("userAgent")) or DEFAULT_USER_AGENT,
        "namingStrategy": (
            normalize_text((raw or {}).get("namingStrategy"))
            or normalize_text((raw or {}).get("defaultNamingStrategy"))
            or normalize_text(config.get("defaultNamingStrategy"))
            or "title-id"
        ),
    }
    if settings["maxItems"] < 1:
        settings["maxItems"] = 1
    if settings["requestTimeoutSeconds"] < 1:
        settings["requestTimeoutSeconds"] = 30
    if settings["namingStrategy"] not in {"title-id", "stable-id"}:
        settings["namingStrategy"] = "title-id"
    return settings


def build_content_key(item: dict[str, Any], host: str, index: int) -> str:
    note_id = normalize_text(item.get("noteId") or item.get("id"))
    source_url = normalize_text(item.get("finalUrl") or item.get("url") or item.get("sourceUrl"))
    if note_id:
        return f"{host}:note:{note_id}"
    if source_url:
        return f"{host}:url:{source_url}"
    return f"{host}:item:{index}"


def build_asset_identity(asset: dict[str, Any]) -> str:
    return normalize_text(asset.get("url")) or normalize_text(asset.get("previewUrl"))


def build_asset_cache_key(asset: dict[str, Any]) -> str:
    return sha256_text(build_asset_identity(asset))


def normalize_asset(asset: dict[str, Any], index: int, headers: dict[str, str] | None = None) -> dict[str, Any] | None:
    source = asset if isinstance(asset, dict) else {}
    url = normalize_https_url(source.get("url"))
    if not url:
        return None
    preview_url = normalize_https_url(source.get("previewUrl"))
    merged_headers = {
        **(headers or {}),
        **{
            normalize_text(key): normalize_text(value)
            for key, value in dict(source.get("headers") or {}).items()
            if normalize_text(key) and normalize_text(value)
        },
    }
    return {
        "assetId": normalize_text(source.get("assetId")) or f"image-{index + 1:02d}",
        "kind": normalize_text(source.get("kind")) or "image",
        "url": url,
        "previewUrl": preview_url or None,
        "width": int(source["width"]) if str(source.get("width") or "").isdigit() else None,
        "height": int(source["height"]) if str(source.get("height") or "").isdigit() else None,
        "headers": merged_headers,
        "sourceUrls": unique_strings(list(source.get("sourceUrls") or []) + [url, preview_url]),
        "cacheKey": build_asset_cache_key({"url": url, "previewUrl": preview_url}),
    }


def normalize_item(item: Any, host: str, index: int) -> dict[str, Any] | None:
    source = item if isinstance(item, dict) else {"sourceUrl": item}
    bundle = source.get("downloadBundle") or {}
    headers = {
        normalize_text(key): normalize_text(value)
        for key, value in dict(bundle.get("headers") or {}).items()
        if normalize_text(key) and normalize_text(value)
    }
    seen_assets: set[str] = set()
    assets: list[dict[str, Any]] = []
    for asset_index, asset in enumerate(bundle.get("assets") or []):
        normalized = normalize_asset(asset, asset_index, headers)
        if not normalized:
            continue
        identity = build_asset_identity(normalized)
        if identity in seen_assets:
            continue
        seen_assets.add(identity)
        assets.append(normalized)
    title = normalize_text(source.get("title") or source.get("contentTitle") or source.get("bookTitle"))
    body_text = str(
        source.get("bodyText")
        or source.get("contentBodyText")
        or bundle.get("textBody")
        or source.get("contentExcerpt")
        or ""
    ).strip()
    final_url = normalize_https_url(source.get("finalUrl") or source.get("url") or source.get("sourceUrl"))
    if not final_url and not assets:
        return None
    normalized = {
        "host": host,
        "title": title or "Untitled note",
        "noteId": normalize_text(source.get("noteId") or source.get("id")),
        "finalUrl": final_url,
        "sourceUrl": normalize_https_url(source.get("sourceUrl")) or final_url,
        "authorName": normalize_text(source.get("authorName")),
        "authorUserId": normalize_text(source.get("authorUserId") or source.get("userId")),
        "authorUrl": normalize_https_url(source.get("authorUrl")),
        "publishedAt": normalize_text(source.get("publishedAt") or source.get("publishedDateLocal")),
        "queryText": normalize_text(source.get("queryText")),
        "sourceType": normalize_text(source.get("sourceType")),
        "tagNames": unique_strings(source.get("tagNames") or []),
        "bodyText": body_text,
        "assets": assets,
    }
    normalized["contentKey"] = build_content_key(normalized, host, index)
    return normalized


def build_item_slug(item: dict[str, Any], settings: dict[str, Any]) -> str:
    note_id = normalize_text(item.get("noteId"))
    stable_fragment = slugify_ascii(note_id, "") or sha256_text(item.get("contentKey"))[:12]
    if normalize_text(settings.get("namingStrategy")).lower() == "stable-id":
        return stable_fragment if note_id else f"item-{stable_fragment}"
    title_slug = slugify_ascii(item.get("title"), "note")
    if note_id and title_slug == "note":
        return stable_fragment
    return f"{title_slug}-{stable_fragment}"


def relative_to(path_value: str | Path, base_dir: str | Path) -> str:
    return Path(path_value).resolve().relative_to(Path(base_dir).resolve()).as_posix()


def download_binary(url: str, headers: dict[str, str], timeout_seconds: int) -> bytes:
    request = Request(url, headers=headers)
    with urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310
        return response.read()


def build_asset_filename(asset: dict[str, Any], index: int) -> str:
    kind_slug = slugify_ascii(asset.get("kind"), "asset")
    asset_slug = slugify_ascii(asset.get("assetId"), f"{kind_slug}-{index + 1:02d}")
    return f"{kind_slug}-{index + 1:02d}-{asset_slug}{guess_extension(asset.get('url'))}"


def create_empty_cache_index() -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "media-asset-cache",
        "updatedAt": current_timestamp_iso(),
        "assets": {},
    }


def create_empty_cache_validation() -> dict[str, Any]:
    return {
        "scannedEntries": 0,
        "validEntries": 0,
        "indexRecovered": False,
    }


def create_empty_cache_gc() -> dict[str, int]:
    return {
        "removedMissingEntries": 0,
        "removedInvalidEntries": 0,
    }


def validate_asset_cache_index(
    cache_root: Path,
    index: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, int], bool]:
    validation = create_empty_cache_validation()
    gc = create_empty_cache_gc()
    assets = index.get("assets")
    if not isinstance(assets, dict):
        index["assets"] = {}
        validation["indexRecovered"] = True
        return index, validation, gc, True

    validated_assets: dict[str, dict[str, Any]] = {}
    dirty = False
    for raw_cache_key, raw_entry in assets.items():
        validation["scannedEntries"] += 1
        if not isinstance(raw_entry, dict):
            gc["removedInvalidEntries"] += 1
            dirty = True
            continue
        cache_key = normalize_text(raw_cache_key) or normalize_text(raw_entry.get("cacheKey"))
        cache_relative_path = normalize_text(raw_entry.get("cacheFile"))
        if not cache_key or not cache_relative_path:
            gc["removedInvalidEntries"] += 1
            dirty = True
            continue
        cache_path = resolve_cache_file({"root": cache_root}, cache_relative_path)
        if not cache_path.exists():
            gc["removedMissingEntries"] += 1
            dirty = True
            continue
        entry = dict(raw_entry)
        if normalize_text(entry.get("cacheKey")) != cache_key:
            entry["cacheKey"] = cache_key
            dirty = True
        validated_assets[cache_key] = entry
        validation["validEntries"] += 1

    if dirty:
        index["assets"] = validated_assets
    return index, validation, gc, dirty


def load_asset_cache(host_root: Path) -> dict[str, Any]:
    cache_root = ensure_dir(host_root / CACHE_DIR_NAME)
    asset_root = ensure_dir(cache_root / ASSET_CACHE_DIR_NAME)
    index_path = cache_root / ASSET_CACHE_INDEX_NAME
    index = create_empty_cache_index()
    validation = create_empty_cache_validation()
    gc = create_empty_cache_gc()
    dirty = False
    if index_path.exists():
        try:
            loaded = json.loads(index_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                index = loaded
            else:
                dirty = True
                validation["indexRecovered"] = True
        except Exception:  # noqa: BLE001
            dirty = True
            validation["indexRecovered"] = True
            index = create_empty_cache_index()
    index, validated, gc_info, validated_dirty = validate_asset_cache_index(cache_root, index)
    validated["indexRecovered"] = bool(validation.get("indexRecovered")) or bool(validated.get("indexRecovered"))
    validation.update(validated)
    gc.update(gc_info)
    dirty = dirty or validated_dirty
    return {
        "root": cache_root,
        "assetRoot": asset_root,
        "indexPath": index_path,
        "index": index,
        "stats": {
            "assetHits": 0,
            "assetStores": 0,
            "assetMisses": 0,
            "assetHardlinkReuses": 0,
            "assetCopyReuses": 0,
        },
        "validation": validation,
        "gc": gc,
        "dirty": dirty,
    }


def resolve_cache_file(cache_context: dict[str, Any], relative_path: str) -> Path:
    candidate = Path(relative_path)
    if candidate.is_absolute():
        return candidate
    return (cache_context["root"] / candidate).resolve()


def find_cached_asset(cache_context: dict[str, Any], asset: dict[str, Any]) -> tuple[str, dict[str, Any], Path] | None:
    cache_key = normalize_text(asset.get("cacheKey"))
    if not cache_key:
        return None
    entry = dict((cache_context["index"].get("assets") or {}).get(cache_key) or {})
    if not entry:
        return None
    cache_relative_path = normalize_text(entry.get("cacheFile"))
    if not cache_relative_path:
        return None
    cache_path = resolve_cache_file(cache_context, cache_relative_path)
    if not cache_path.exists():
        cache_context["index"]["assets"].pop(cache_key, None)
        cache_context["gc"]["removedMissingEntries"] += 1
        cache_context["dirty"] = True
        return None
    return cache_key, entry, cache_path


def reuse_cached_asset(cache_path: Path, output_path: Path) -> str:
    ensure_dir(output_path.parent)
    if output_path.exists():
        output_path.unlink()
    try:
        os.link(cache_path, output_path)
        return "hardlink"
    except (AttributeError, NotImplementedError, OSError):
        shutil.copyfile(cache_path, output_path)
        return "copy"


def store_cached_asset(cache_context: dict[str, Any], asset: dict[str, Any], payload: bytes) -> dict[str, Any]:
    cache_key = normalize_text(asset.get("cacheKey")) or build_asset_cache_key(asset)
    cache_file = cache_context["assetRoot"] / f"{cache_key}{guess_extension(asset.get('url'))}"
    if not cache_file.exists():
        cache_file.write_bytes(payload)
    entry = {
        "cacheKey": cache_key,
        "cacheFile": relative_to(cache_file, cache_context["root"]),
        "sourceUrl": asset.get("url"),
        "previewUrl": asset.get("previewUrl"),
        "bytes": len(payload),
        "sha256": sha256_bytes(payload),
        "updatedAt": current_timestamp_iso(),
    }
    cache_context["index"]["assets"][cache_key] = entry
    cache_context["dirty"] = True
    return entry


def persist_asset_cache(cache_context: dict[str, Any]) -> None:
    if not cache_context.get("dirty") and Path(cache_context["indexPath"]).exists():
        return
    cache_context["index"]["updatedAt"] = current_timestamp_iso()
    write_json(cache_context["indexPath"], cache_context["index"])


def build_markdown(item: dict[str, Any], asset_results: list[dict[str, Any]]) -> str:
    lines = [f"# {item['title']}", ""]
    lines.append("## Metadata")
    lines.append("")
    lines.append(f"- Content Key: `{item['contentKey']}`")
    if item.get("noteId"):
        lines.append(f"- Note ID: `{item['noteId']}`")
    if item.get("sourceUrl"):
        lines.append(f"- Source: {item['sourceUrl']}")
    if item.get("finalUrl") and item.get("finalUrl") != item.get("sourceUrl"):
        lines.append(f"- Final URL: {item['finalUrl']}")
    if item.get("authorName"):
        author_line = f"- Author: {item['authorName']}"
        if item.get("authorUrl"):
            author_line += f" ({item['authorUrl']})"
        lines.append(author_line)
    if item.get("authorUserId"):
        lines.append(f"- Author User ID: `{item['authorUserId']}`")
    if item.get("publishedAt"):
        lines.append(f"- Published: {item['publishedAt']}")
    if item.get("queryText"):
        lines.append(f"- Query: {item['queryText']}")
    if item.get("sourceType"):
        lines.append(f"- Source Type: `{item['sourceType']}`")
    if item.get("tagNames"):
        lines.append(f"- Tags: {', '.join(item['tagNames'])}")
    lines.append(f"- Asset Count: {len(asset_results)}")
    lines.append("")
    if item.get("bodyText"):
        lines.append("## Body")
        lines.append("")
        lines.append(item["bodyText"])
        lines.append("")
    if asset_results:
        lines.append("## Assets")
        lines.append("")
        for asset in asset_results:
            file_label = normalize_text(asset.get("fileName")) or normalize_text(asset.get("assetId")) or "asset"
            status = normalize_text(asset.get("status")) or "unknown"
            bytes_text = f"{asset.get('bytes')} bytes" if asset.get("bytes") is not None else "pending"
            lines.append(f"- `{file_label}` | {status} | {bytes_text}")
            rendered = asset.get("localMarkdownPath")
            if rendered and status in {"downloaded", "cached", "planned"}:
                lines.append(f"![{asset.get('assetId') or 'image'}]({rendered})")
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def build_item_metadata(
    item: dict[str, Any],
    item_dir: Path,
    asset_results: list[dict[str, Any]],
    markdown_path: Path,
    legacy_markdown_path: Path,
    metadata_path: Path,
    manifest_path: Path,
) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "media-download-item",
        "generatedAt": current_timestamp_iso(),
        "host": item.get("host"),
        "contentKey": item.get("contentKey"),
        "title": item.get("title"),
        "noteId": item.get("noteId"),
        "sourceUrl": item.get("sourceUrl"),
        "finalUrl": item.get("finalUrl"),
        "author": {
            "name": item.get("authorName"),
            "userId": item.get("authorUserId"),
            "url": item.get("authorUrl"),
        },
        "publishedAt": item.get("publishedAt"),
        "queryText": item.get("queryText"),
        "sourceType": item.get("sourceType"),
        "tagNames": item.get("tagNames"),
        "bodyText": item.get("bodyText"),
        "bodyTextPresent": bool(item.get("bodyText")),
        "assetCount": len(asset_results),
        "assets": asset_results,
        "files": {
            "itemDir": str(item_dir.resolve()),
            "indexMarkdown": str(markdown_path.resolve()),
            "legacyMarkdown": str(legacy_markdown_path.resolve()),
            "metadata": str(metadata_path.resolve()),
            "manifest": str(manifest_path.resolve()),
        },
    }


def execute_item_download(
    item: dict[str, Any],
    run_dir: Path,
    settings: dict[str, Any],
    cache_context: dict[str, Any],
) -> dict[str, Any]:
    item_dir = ensure_dir(run_dir / "items" / build_item_slug(item, settings))
    assets_dir = ensure_dir(item_dir / "assets")
    asset_results: list[dict[str, Any]] = []
    failures: list[str] = []
    for index, asset in enumerate(item.get("assets") or []):
        file_name = build_asset_filename(asset, index)
        output_path = assets_dir / file_name
        result = {
            "assetId": asset.get("assetId"),
            "kind": asset.get("kind"),
            "url": asset.get("url"),
            "previewUrl": asset.get("previewUrl"),
            "width": asset.get("width"),
            "height": asset.get("height"),
            "sourceUrls": asset.get("sourceUrls") or [],
            "cacheKey": asset.get("cacheKey"),
            "fileName": file_name,
            "relativePath": relative_to(output_path, run_dir),
            "itemRelativePath": relative_to(output_path, item_dir),
            "localMarkdownPath": relative_to(output_path, item_dir).replace(" ", "%20"),
            "status": "planned" if settings["dryRun"] else "downloaded",
            "cacheStatus": "dry-run" if settings["dryRun"] else "miss",
            "reuseMode": "dry-run" if settings["dryRun"] else "download",
        }
        if settings["dryRun"]:
            asset_results.append(result)
            continue

        cached = find_cached_asset(cache_context, asset)
        if cached:
            _, cache_entry, cache_path = cached
            reuse_mode = reuse_cached_asset(cache_path, output_path)
            cache_context["stats"]["assetHits"] += 1
            if reuse_mode == "hardlink":
                cache_context["stats"]["assetHardlinkReuses"] += 1
            else:
                cache_context["stats"]["assetCopyReuses"] += 1
            result.update({
                "status": "cached",
                "cacheStatus": "hit",
                "cacheFile": str(cache_path.resolve()),
                "bytes": int(cache_entry.get("bytes") or output_path.stat().st_size),
                "sha256": normalize_text(cache_entry.get("sha256")) or None,
                "reuseMode": reuse_mode,
            })
            asset_results.append(result)
            continue

        cache_context["stats"]["assetMisses"] += 1
        try:
            payload = download_binary(asset["url"], asset.get("headers") or {}, settings["requestTimeoutSeconds"])
            output_path.write_bytes(payload)
            cache_entry = store_cached_asset(cache_context, asset, payload)
            cache_context["stats"]["assetStores"] += 1
            result.update({
                "status": "downloaded",
                "cacheStatus": "stored",
                "cacheFile": str(resolve_cache_file(cache_context, cache_entry["cacheFile"]).resolve()),
                "bytes": len(payload),
                "sha256": cache_entry.get("sha256"),
                "reuseMode": "download",
            })
            asset_results.append(result)
        except Exception as error:  # noqa: BLE001
            result["status"] = "failed"
            result["cacheStatus"] = "failed"
            result["reuseMode"] = "failed"
            result["error"] = str(error)
            failures.append(str(error))
            asset_results.append(result)

    markdown_payload = build_markdown(item, asset_results)
    markdown_path = item_dir / ITEM_INDEX_MARKDOWN_NAME
    legacy_markdown_path = item_dir / LEGACY_ITEM_MARKDOWN_NAME
    metadata_path = item_dir / "metadata.json"
    item_manifest_path = item_dir / "download-manifest.json"
    write_text(markdown_path, markdown_payload)
    write_text(legacy_markdown_path, markdown_payload)
    metadata_payload = build_item_metadata(
        item,
        item_dir,
        asset_results,
        markdown_path,
        legacy_markdown_path,
        metadata_path,
        item_manifest_path,
    )
    write_json(metadata_path, metadata_payload)

    if settings["dryRun"]:
        status = "planned"
    elif failures and len(failures) == len(asset_results):
        status = "failed"
    elif failures:
        status = "partial"
    else:
        status = "downloaded"
    item_result = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "media-download-item-result",
        "generatedAt": current_timestamp_iso(),
        "contentKey": item.get("contentKey"),
        "noteId": item.get("noteId"),
        "title": item.get("title"),
        "sourceUrl": item.get("sourceUrl"),
        "status": status,
        "itemDir": str(item_dir.resolve()),
        "taskDir": str(item_dir.resolve()),
        "markdownFile": str(markdown_path.resolve()),
        "indexMarkdownFile": str(markdown_path.resolve()),
        "legacyMarkdownFile": str(legacy_markdown_path.resolve()),
        "metadataFile": str(metadata_path.resolve()),
        "manifestFile": str(item_manifest_path.resolve()),
        "assets": asset_results,
        "assetCount": len(asset_results),
        "bodyTextPresent": bool(item.get("bodyText")),
    }
    write_json(item_manifest_path, item_result)
    return item_result


def build_summary(results: list[dict[str, Any]]) -> dict[str, int]:
    summary = {
        "total": len(results),
        "successful": 0,
        "failed": 0,
        "partial": 0,
        "planned": 0,
    }
    for result in results:
        status = normalize_text(result.get("status"))
        if status == "downloaded":
            summary["successful"] += 1
        elif status == "planned":
            summary["planned"] += 1
        elif status == "partial":
            summary["partial"] += 1
        else:
            summary["failed"] += 1
    return summary


def build_cache_summary(cache_context: dict[str, Any]) -> dict[str, Any]:
    return {
        "root": str(Path(cache_context["root"]).resolve()),
        "assetIndexFile": str(Path(cache_context["indexPath"]).resolve()),
        **dict(cache_context.get("stats") or {}),
        "gc": dict(cache_context.get("gc") or {}),
        "validation": dict(cache_context.get("validation") or {}),
    }


def build_summary_view(manifest: dict[str, Any]) -> dict[str, Any]:
    return {
        "host": manifest.get("host"),
        "runDir": manifest.get("runDir"),
        "dryRun": manifest.get("dryRun"),
        "summary": manifest.get("summary") or {},
        "cache": manifest.get("cache") or {},
        "warnings": manifest.get("warnings") or [],
    }


def build_report_markdown(manifest: dict[str, Any]) -> str:
    summary = manifest.get("summary") or {}
    cache = manifest.get("cache") or {}
    lines = [
        "# Media Download Summary",
        "",
        f"- Host: {manifest.get('host')}",
        f"- Run Dir: `{manifest.get('runDir')}`",
        f"- Dry Run: {manifest.get('dryRun')}",
        f"- Total: {summary.get('total', 0)}",
        f"- Successful: {summary.get('successful', 0)}",
        f"- Partial: {summary.get('partial', 0)}",
        f"- Failed: {summary.get('failed', 0)}",
        f"- Planned: {summary.get('planned', 0)}",
        f"- Asset Cache Hits: {cache.get('assetHits', 0)}",
        f"- Asset Cache Stores: {cache.get('assetStores', 0)}",
        f"- Asset Cache Misses: {cache.get('assetMisses', 0)}",
        f"- Asset Cache Hardlink Reuses: {cache.get('assetHardlinkReuses', 0)}",
        f"- Asset Cache Copy Reuses: {cache.get('assetCopyReuses', 0)}",
        f"- Cache GC Removed Missing Entries: {(cache.get('gc') or {}).get('removedMissingEntries', 0)}",
        f"- Cache GC Removed Invalid Entries: {(cache.get('gc') or {}).get('removedInvalidEntries', 0)}",
        f"- Cache Validation Scanned Entries: {(cache.get('validation') or {}).get('scannedEntries', 0)}",
    ]
    if manifest.get("warnings"):
        lines.extend(["", "## Warnings", ""])
        lines.extend([f"- {warning}" for warning in manifest["warnings"]])
    if manifest.get("results"):
        lines.extend(["", "## Items", ""])
        run_dir = Path(manifest.get("runDir") or ".")
        for result in manifest["results"]:
            markdown_file = normalize_text(result.get("markdownFile"))
            relative_markdown = ""
            if markdown_file:
                try:
                    relative_markdown = relative_to(markdown_file, run_dir)
                except Exception:  # noqa: BLE001
                    relative_markdown = markdown_file
            rendered_path = f" (`{relative_markdown}`)" if relative_markdown else ""
            lines.append(f"- [{result.get('status')}] {result.get('title') or result.get('sourceUrl')}{rendered_path}")
    return "\n".join(lines).strip() + "\n"


def build_cli_output(manifest: dict[str, Any], output_mode: str, output_format: str) -> str:
    mode = normalize_text(output_mode).lower() or "full"
    payload: Any
    if mode == "summary":
        payload = manifest.get("summaryView") or build_summary_view(manifest)
    elif mode == "results":
        payload = manifest.get("results") or []
    else:
        payload = manifest
    if normalize_text(output_format).lower() == "markdown":
        return build_report_markdown(manifest)
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def download_media_bundle(
    host: str,
    items: list[Any],
    settings: dict[str, Any] | None = None,
    downloader_config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    merged_settings = merge_settings(settings, downloader_config)
    normalized_items = []
    seen: set[str] = set()
    warnings: list[str] = []
    for index, item in enumerate(items):
        normalized = normalize_item(item, host, index)
        if not normalized:
            warnings.append(f"Skipped unresolved item at index {index}.")
            continue
        if normalized["contentKey"] in seen:
            continue
        seen.add(normalized["contentKey"])
        normalized_items.append(normalized)
    normalized_items = normalized_items[: merged_settings["maxItems"]]

    host_root = ensure_dir(Path(merged_settings["outDir"]) / sanitize_host(host))
    cache_context = load_asset_cache(host_root)
    run_dir = ensure_dir(host_root / format_timestamp_for_dir())
    results = [execute_item_download(item, run_dir, merged_settings, cache_context) for item in normalized_items]
    persist_asset_cache(cache_context)
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "media-download-run",
        "generatedAt": current_timestamp_iso(),
        "host": host,
        "hostRoot": str(host_root.resolve()),
        "runDir": str(run_dir.resolve()),
        "dryRun": merged_settings["dryRun"],
        "settings": merged_settings,
        "summary": build_summary(results),
        "cache": build_cache_summary(cache_context),
        "results": results,
        "warnings": warnings,
    }
    manifest["summaryView"] = build_summary_view(manifest)
    manifest["reportMarkdown"] = build_report_markdown(manifest)
    write_json(run_dir / "download-manifest.json", manifest)
    write_text(run_dir / "download-report.md", manifest["reportMarkdown"])
    write_text(run_dir / RUN_INDEX_MARKDOWN_NAME, manifest["reportMarkdown"])
    return manifest
