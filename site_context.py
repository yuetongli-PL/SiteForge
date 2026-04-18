#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

SITE_REGISTRY_FILE_NAME = "site-registry.json"
SITE_CAPABILITIES_FILE_NAME = "site-capabilities.json"


def sanitize_host(host: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9.-]+", "-", str(host or "unknown-host"))
    cleaned = re.sub(r"-+", "-", cleaned).strip("-")
    return cleaned or "unknown-host"


def unique_sorted_strings(values: list[Any]) -> list[str]:
    normalized: list[str] = []
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if not text:
            continue
        normalized.append(text)
    return sorted(set(normalized), key=str.casefold)


def _default_document() -> dict[str, Any]:
    return {
        "version": 1,
        "generatedAt": None,
        "sites": {},
    }


def _load_json_document(path_value: str | Path) -> dict[str, Any]:
    path_obj = Path(path_value)
    if not path_obj.exists():
        return _default_document()
    document = json.loads(path_obj.read_text(encoding="utf-8"))
    document.setdefault("version", 1)
    document.setdefault("generatedAt", None)
    document.setdefault("sites", {})
    return document


def _write_json_document(path_value: str | Path, payload: dict[str, Any]) -> None:
    path_obj = Path(path_value)
    path_obj.parent.mkdir(parents=True, exist_ok=True)
    path_obj.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build_site_registry_path(repo_root: str | Path) -> Path:
    return Path(repo_root).resolve() / SITE_REGISTRY_FILE_NAME


def build_site_capabilities_path(repo_root: str | Path) -> Path:
    return Path(repo_root).resolve() / SITE_CAPABILITIES_FILE_NAME


def read_site_registry(repo_root: str | Path) -> dict[str, Any]:
    return _load_json_document(build_site_registry_path(repo_root))


def read_site_capabilities(repo_root: str | Path) -> dict[str, Any]:
    return _load_json_document(build_site_capabilities_path(repo_root))


def read_site_context(host: str, repo_root: str | Path) -> dict[str, Any]:
    host_key = sanitize_host(host)
    registry = read_site_registry(repo_root)
    capabilities = read_site_capabilities(repo_root)
    return {
        "host": host_key,
        "registry": registry,
        "capabilities": capabilities,
        "registryRecord": registry.get("sites", {}).get(host_key),
        "capabilitiesRecord": capabilities.get("sites", {}).get(host_key),
    }


def resolve_primary_archetype(site_context: dict[str, Any], *fallbacks: Any) -> str | None:
    candidates = [
        (site_context.get("capabilitiesRecord") or {}).get("primaryArchetype"),
        (site_context.get("registryRecord") or {}).get("siteArchetype"),
        *fallbacks,
    ]
    for value in candidates:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _resolve_fallback_values(*fallbacks: Any) -> list[str]:
    values: list[Any] = []
    for fallback in fallbacks:
        if isinstance(fallback, (list, tuple, set)):
            values.extend(list(fallback))
        elif fallback is not None:
            values.append(fallback)
    return unique_sorted_strings(values)


def _resolve_string_list(site_context: dict[str, Any], capabilities_key: str, registry_key: str | None = None, *fallbacks: Any) -> list[str]:
    fallback_values = _resolve_fallback_values(*fallbacks)
    if fallback_values:
        return fallback_values

    values: list[Any] = []
    capabilities_record = site_context.get("capabilitiesRecord") or {}
    registry_record = site_context.get("registryRecord") or {}
    values.extend(capabilities_record.get(capabilities_key, []) or [])
    if registry_key:
        values.extend(registry_record.get(registry_key, []) or [])
    return unique_sorted_strings(values)


def resolve_capability_families(site_context: dict[str, Any], *fallbacks: Any) -> list[str]:
    return _resolve_string_list(site_context, "capabilityFamilies", "capabilityFamilies", *fallbacks)


def resolve_page_types(site_context: dict[str, Any], *fallbacks: Any) -> list[str]:
    return _resolve_string_list(site_context, "pageTypes", None, *fallbacks)


def resolve_supported_intents(site_context: dict[str, Any], *fallbacks: Any) -> list[str]:
    return _resolve_string_list(site_context, "supportedIntents", None, *fallbacks)


def resolve_safe_action_kinds(site_context: dict[str, Any], *fallbacks: Any) -> list[str]:
    return _resolve_string_list(site_context, "safeActionKinds", None, *fallbacks)


def upsert_site_registry_record(host: str, patch: dict[str, Any], repo_root: str | Path) -> dict[str, Any]:
    registry_path = build_site_registry_path(repo_root)
    registry = read_site_registry(repo_root)
    host_key = sanitize_host(host)
    previous = registry.get("sites", {}).get(host_key, {})
    next_record = {
        **previous,
        **patch,
        "host": host_key,
        "capabilityFamilies": unique_sorted_strings([
            *(previous.get("capabilityFamilies", []) or []),
            *(patch.get("capabilityFamilies", []) or []),
        ]),
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    registry["generatedAt"] = next_record["updatedAt"]
    registry.setdefault("sites", {})
    registry["sites"][host_key] = next_record
    _write_json_document(registry_path, registry)
    return {
        "registryPath": str(registry_path),
        "record": next_record,
    }


def upsert_site_capabilities_record(host: str, patch: dict[str, Any], repo_root: str | Path) -> dict[str, Any]:
    capabilities_path = build_site_capabilities_path(repo_root)
    document = read_site_capabilities(repo_root)
    host_key = sanitize_host(host)
    previous = document.get("sites", {}).get(host_key, {})
    next_record = {
        **previous,
        **patch,
        "host": host_key,
        "pageTypes": unique_sorted_strings([*(previous.get("pageTypes", []) or []), *(patch.get("pageTypes", []) or [])]),
        "capabilityFamilies": unique_sorted_strings([*(previous.get("capabilityFamilies", []) or []), *(patch.get("capabilityFamilies", []) or [])]),
        "supportedIntents": unique_sorted_strings([*(previous.get("supportedIntents", []) or []), *(patch.get("supportedIntents", []) or [])]),
        "safeActionKinds": unique_sorted_strings([*(previous.get("safeActionKinds", []) or []), *(patch.get("safeActionKinds", []) or [])]),
        "approvalActionKinds": unique_sorted_strings([*(previous.get("approvalActionKinds", []) or []), *(patch.get("approvalActionKinds", []) or [])]),
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    document["generatedAt"] = next_record["updatedAt"]
    document.setdefault("sites", {})
    document["sites"][host_key] = next_record
    _write_json_document(capabilities_path, document)
    return {
        "capabilitiesPath": str(capabilities_path),
        "record": next_record,
    }
