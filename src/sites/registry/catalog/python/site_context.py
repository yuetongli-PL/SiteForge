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
SITE_CONFIG_DIRECTORY_NAME = "config"
SITE_RUNTIME_METADATA_DIRECTORY_NAME = "runs/site-metadata"
SITE_RUNTIME_REGISTRY_FILE_NAME = "site-registry.runtime.json"
SITE_RUNTIME_CAPABILITIES_FILE_NAME = "site-capabilities.runtime.json"
REGISTRY_STABLE_PATH_KEYS = (
    "downloadEntrypoint",
    "rankingQueryEntrypoint",
    "repoSkillDir",
    "crawlerScriptsDir",
)
CAPABILITIES_STABLE_KEYS = {
    "baseUrl",
    "siteKey",
    "adapterId",
    "primaryArchetype",
    "pageTypes",
    "capabilityFamilies",
    "supportedIntents",
    "safeActionKinds",
    "approvalActionKinds",
    "rankingSupported",
    "rankingModes",
    "categoryTaxonomySupported",
}


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


def is_url_like(value: Any) -> bool:
    return bool(re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", str(value or "").strip()))


def _to_repo_relative_path(repo_root: str | Path, value: Any) -> Any:
    text = str(value or "").strip()
    if not text or is_url_like(text):
        return value
    root_path = Path(repo_root).resolve()
    resolved_value = Path(text)
    if not resolved_value.is_absolute():
        resolved_value = (root_path / resolved_value).resolve()
    else:
        resolved_value = resolved_value.resolve()
    try:
        return resolved_value.relative_to(root_path).as_posix()
    except ValueError:
        return value


def _resolve_repo_relative_path(repo_root: str | Path, value: Any) -> Any:
    text = str(value or "").strip()
    if not text or is_url_like(text):
        return value
    path_value = Path(text)
    if path_value.is_absolute():
        return str(path_value)
    return str((Path(repo_root).resolve() / Path(text)).resolve())


def _normalize_registry_stable_patch(repo_root: str | Path, patch: dict[str, Any]) -> dict[str, Any]:
    normalized_patch = dict(patch or {})
    for key in REGISTRY_STABLE_PATH_KEYS:
        if key in normalized_patch:
            normalized_patch[key] = _to_repo_relative_path(repo_root, normalized_patch[key])
    return normalized_patch


def _resolve_registry_record_paths(repo_root: str | Path, record: dict[str, Any]) -> dict[str, Any]:
    resolved_record = dict(record or {})
    for key in REGISTRY_STABLE_PATH_KEYS:
        if key in resolved_record:
            resolved_record[key] = _resolve_repo_relative_path(repo_root, resolved_record[key])
    return resolved_record


def _split_capabilities_patch(patch: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    stable_patch = {key: value for key, value in (patch or {}).items() if key in CAPABILITIES_STABLE_KEYS}
    runtime_patch = {key: value for key, value in (patch or {}).items() if key not in CAPABILITIES_STABLE_KEYS}
    return stable_patch, runtime_patch


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
    return Path(repo_root).resolve() / SITE_CONFIG_DIRECTORY_NAME / SITE_REGISTRY_FILE_NAME


def build_site_capabilities_path(repo_root: str | Path) -> Path:
    return Path(repo_root).resolve() / SITE_CONFIG_DIRECTORY_NAME / SITE_CAPABILITIES_FILE_NAME


def build_site_runtime_registry_path(repo_root: str | Path) -> Path:
    return Path(repo_root).resolve() / SITE_RUNTIME_METADATA_DIRECTORY_NAME / SITE_RUNTIME_REGISTRY_FILE_NAME


def build_site_runtime_capabilities_path(repo_root: str | Path) -> Path:
    return Path(repo_root).resolve() / SITE_RUNTIME_METADATA_DIRECTORY_NAME / SITE_RUNTIME_CAPABILITIES_FILE_NAME


def _merge_documents(stable_document: dict[str, Any], runtime_document: dict[str, Any]) -> dict[str, Any]:
    merged_sites: dict[str, Any] = {}
    site_keys = set((stable_document.get("sites") or {}).keys()) | set((runtime_document.get("sites") or {}).keys())
    for site_key in site_keys:
        merged_sites[site_key] = {
            **((stable_document.get("sites") or {}).get(site_key) or {}),
            **((runtime_document.get("sites") or {}).get(site_key) or {}),
            "host": site_key,
        }
    return {
        **(stable_document or {}),
        "generatedAt": runtime_document.get("generatedAt") or stable_document.get("generatedAt"),
        "sites": merged_sites,
    }


def _resolve_registry_document_paths(document: dict[str, Any], repo_root: str | Path) -> dict[str, Any]:
    sites = document.get("sites") or {}
    return {
        **document,
        "sites": {
            site_key: _resolve_registry_record_paths(repo_root, record or {})
            for site_key, record in sites.items()
        },
    }


def read_site_registry(repo_root: str | Path) -> dict[str, Any]:
    return _resolve_registry_document_paths(_merge_documents(
        _load_json_document(build_site_registry_path(repo_root)),
        _load_json_document(build_site_runtime_registry_path(repo_root)),
    ), repo_root)


def read_site_capabilities(repo_root: str | Path) -> dict[str, Any]:
    return _merge_documents(
        _load_json_document(build_site_capabilities_path(repo_root)),
        _load_json_document(build_site_runtime_capabilities_path(repo_root)),
    )


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
    runtime_registry_path = build_site_runtime_registry_path(repo_root)
    registry = _load_json_document(registry_path)
    runtime_registry = _load_json_document(runtime_registry_path)
    host_key = sanitize_host(host)
    previous = registry.get("sites", {}).get(host_key, {})
    runtime_previous = runtime_registry.get("sites", {}).get(host_key, {})
    stable_keys = {
        "canonicalBaseUrl",
        "siteKey",
        "adapterId",
        "siteArchetype",
        "downloadEntrypoint",
        "interpreterRequired",
        "scriptLanguage",
        "templateVersion",
        "rankingQueryEntrypoint",
        "repoSkillDir",
        "crawlerScriptsDir",
        "capabilityFamilies",
    }
    stable_patch = _normalize_registry_stable_patch(repo_root, {
        key: value for key, value in patch.items() if key in stable_keys
    })
    runtime_patch = {key: value for key, value in patch.items() if key not in stable_keys}
    next_record = {
        **previous,
        **stable_patch,
        "host": host_key,
        "capabilityFamilies": unique_sorted_strings([
            *(previous.get("capabilityFamilies", []) or []),
            *(stable_patch.get("capabilityFamilies", []) or []),
        ]),
    }
    registry.setdefault("sites", {})
    registry["sites"][host_key] = next_record
    runtime_record = {
        **runtime_previous,
        **runtime_patch,
        "host": host_key,
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    runtime_registry["generatedAt"] = runtime_record["updatedAt"]
    runtime_registry.setdefault("sites", {})
    runtime_registry["sites"][host_key] = runtime_record
    _write_json_document(registry_path, registry)
    _write_json_document(runtime_registry_path, runtime_registry)
    return {
        "registryPath": str(registry_path),
        "runtimeRegistryPath": str(runtime_registry_path),
        "record": {
            **_resolve_registry_record_paths(repo_root, next_record),
            **runtime_record,
        },
    }


def upsert_site_capabilities_record(host: str, patch: dict[str, Any], repo_root: str | Path) -> dict[str, Any]:
    capabilities_path = build_site_capabilities_path(repo_root)
    runtime_capabilities_path = build_site_runtime_capabilities_path(repo_root)
    document = _load_json_document(capabilities_path)
    runtime_document = _load_json_document(runtime_capabilities_path)
    host_key = sanitize_host(host)
    stable_patch, runtime_patch = _split_capabilities_patch(patch)
    previous = document.get("sites", {}).get(host_key, {})
    next_record = {
        **previous,
        **stable_patch,
        "host": host_key,
        "pageTypes": unique_sorted_strings([*(previous.get("pageTypes", []) or []), *(stable_patch.get("pageTypes", []) or [])]),
        "capabilityFamilies": unique_sorted_strings([*(previous.get("capabilityFamilies", []) or []), *(stable_patch.get("capabilityFamilies", []) or [])]),
        "supportedIntents": unique_sorted_strings([*(previous.get("supportedIntents", []) or []), *(stable_patch.get("supportedIntents", []) or [])]),
        "safeActionKinds": unique_sorted_strings([*(previous.get("safeActionKinds", []) or []), *(stable_patch.get("safeActionKinds", []) or [])]),
        "approvalActionKinds": unique_sorted_strings([*(previous.get("approvalActionKinds", []) or []), *(stable_patch.get("approvalActionKinds", []) or [])]),
    }
    document.setdefault("sites", {})
    document["sites"][host_key] = next_record
    runtime_record = {
        **(runtime_document.get("sites", {}).get(host_key, {}) or {}),
        **runtime_patch,
        "host": host_key,
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    runtime_document["generatedAt"] = runtime_record["updatedAt"]
    runtime_document.setdefault("sites", {})
    runtime_document["sites"][host_key] = runtime_record
    _write_json_document(capabilities_path, document)
    _write_json_document(runtime_capabilities_path, runtime_document)
    return {
        "capabilitiesPath": str(capabilities_path),
        "runtimeCapabilitiesPath": str(runtime_capabilities_path),
        "record": {
            **next_record,
            **runtime_record,
        },
    }
