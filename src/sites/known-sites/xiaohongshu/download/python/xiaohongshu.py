#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[6]
SHARED_DOWNLOAD_DIR = REPO_ROOT / "src" / "sites" / "known-sites" / "shared" / "download" / "python"
if str(SHARED_DOWNLOAD_DIR) not in sys.path:
    sys.path.insert(0, str(SHARED_DOWNLOAD_DIR))

from media_bundle import (  # noqa: E402
    build_cli_output,
    download_media_bundle,
    load_input_items,
    merge_settings,
)

DEFAULT_HOST = "www.xiaohongshu.com"
DEFAULT_OUTPUT_ROOT = REPO_ROOT / "note-downloads"


def load_profile(profile_path: str | None) -> dict[str, Any]:
    if not profile_path:
        return {}
    path_obj = Path(profile_path).resolve()
    if not path_obj.exists():
        raise FileNotFoundError(f"Profile not found: {path_obj}")
    return json.loads(path_obj.read_text(encoding="utf-8"))


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download resolved Xiaohongshu image-note bundles into local markdown + assets.",
    )
    parser.add_argument("items", nargs="*", help="Optional resolved JSON lines or raw placeholders.")
    parser.add_argument("--input-file", help="Line-delimited resolved bundle input file.")
    parser.add_argument("--profile-path", help="Optional Xiaohongshu profile path.")
    parser.add_argument("--out-dir", help="Optional output directory root.")
    parser.add_argument("--max-items", type=int, default=None, help="Maximum number of resolved notes to download.")
    parser.add_argument("--timeout", type=int, default=30, help="Per-asset request timeout in seconds.")
    parser.add_argument("--dry-run", action="store_true", help="Plan downloads without fetching files.")
    parser.add_argument("--output", default="full", choices=["full", "summary", "results"])
    parser.add_argument("--output-format", default="json", choices=["json", "markdown"])
    return parser.parse_args(argv)


def build_settings(args: argparse.Namespace, downloader_config: dict[str, Any]) -> dict[str, Any]:
    return merge_settings(
        {
            "dryRun": bool(args.dry_run),
            "outDir": args.out_dir,
            "maxItems": args.max_items,
            "requestTimeoutSeconds": args.timeout,
        },
        downloader_config,
        default_output_root=DEFAULT_OUTPUT_ROOT,
    )


def download_xiaohongshu(items: list[Any], settings: dict[str, Any], downloader_config: dict[str, Any]) -> dict[str, Any]:
    return download_media_bundle(DEFAULT_HOST, items, settings, downloader_config)


def cli(argv: list[str] | None = None) -> int:
    args = parse_args(list(argv or sys.argv[1:]))
    profile = load_profile(args.profile_path) if args.profile_path else {}
    downloader_config = dict(profile.get("downloader") or {})
    items = load_input_items(args.items, args.input_file)
    if not items:
        raise SystemExit("No input items were provided. Pass --input-file with resolved bundles.")
    manifest = download_xiaohongshu(items, build_settings(args, downloader_config), downloader_config)
    sys.stdout.write(build_cli_output(manifest, args.output, args.output_format))
    summary = manifest.get("summary") or {}
    failed = int(summary.get("failed", 0)) + int(summary.get("partial", 0))
    return 1 if failed > 0 and not bool(args.dry_run) else 0


if __name__ == "__main__":
    raise SystemExit(cli())
