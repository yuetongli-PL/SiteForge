# -*- coding: utf-8 -*-
from __future__ import annotations

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sys


def resolve_repo_root(file_path: str) -> Path:
    return Path(file_path).resolve().parent


def ensure_repo_root_on_path(repo_root: Path) -> None:
    repo_root_str = str(repo_root)
    if repo_root_str not in sys.path:
        sys.path.insert(0, repo_root_str)


def load_module_from_path(module_name: str, module_path: Path):
    spec = spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module from {module_path}")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def reexport_public_symbols(module, namespace: dict) -> None:
    for name in dir(module):
        if name.startswith("__"):
            continue
        namespace[name] = getattr(module, name)


def run_cli_entry(entrypoint) -> None:
    raise SystemExit(entrypoint())
