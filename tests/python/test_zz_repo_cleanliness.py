from __future__ import annotations

import shutil
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[2]


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
                        shutil.rmtree(child)
                    else:
                        child.unlink()
            else:
                target.mkdir(parents=True, exist_ok=True)

        for pycache_dir in REPO_ROOT.rglob("__pycache__"):
            shutil.rmtree(pycache_dir)

        for target in transient_roots:
            self.assertTrue(target.exists(), f"transient root should exist: {target}")
            self.assertEqual(list(target.iterdir()), [])

        remaining_pycache = list(REPO_ROOT.rglob("__pycache__"))
        self.assertEqual(remaining_pycache, [])


if __name__ == "__main__":
    unittest.main()
