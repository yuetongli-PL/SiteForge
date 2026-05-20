from __future__ import annotations

import shutil
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[2]


def long_path(path: Path) -> str:
    resolved = str(path.resolve())
    if resolved.startswith("\\\\?\\"):
        return resolved
    if resolved.startswith("\\\\"):
        return "\\\\?\\UNC\\" + resolved[2:]
    return "\\\\?\\" + resolved


def remove_path_best_effort(path: Path) -> None:
    try:
        is_dir = path.is_dir()
    except FileNotFoundError:
        return
    if is_dir:
        shutil.rmtree(long_path(path), ignore_errors=True)
        if not path.exists():
            return
        try:
            children = list(path.iterdir())
        except FileNotFoundError:
            return
        for child in children:
            remove_path_best_effort(child)
        try:
            path.rmdir()
        except FileNotFoundError:
            return
        except OSError:
            try:
                Path(long_path(path)).rmdir()
            except FileNotFoundError:
                return
    else:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            Path(long_path(path)).unlink(missing_ok=True)


class RepoCleanlinessTest(unittest.TestCase):
    def test_repo_transient_outputs_are_cleaned_after_tests(self) -> None:
        transient_roots = [
            REPO_ROOT / "runs",
            REPO_ROOT / "knowledge-base",
            REPO_ROOT / "book-content",
        ]

        for target in transient_roots:
            if target.exists():
                for child in target.iterdir():
                    if child.is_dir():
                        shutil.rmtree(long_path(child), ignore_errors=True)
                        remove_path_best_effort(child)
                    else:
                        child.unlink(missing_ok=True)
                remove_path_best_effort(target)
            else:
                self.assertFalse(target.exists())

        for pycache_dir in REPO_ROOT.rglob("__pycache__"):
            shutil.rmtree(pycache_dir, ignore_errors=True)
            remove_path_best_effort(pycache_dir)

        for target in transient_roots:
            self.assertFalse(target.exists(), f"transient root should be removed: {target}")

        remaining_pycache = list(REPO_ROOT.rglob("__pycache__"))
        self.assertEqual(remaining_pycache, [])


if __name__ == "__main__":
    unittest.main()
