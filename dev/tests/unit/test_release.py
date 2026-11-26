"""Unit tests for dev/tools/release.py. Run: python3 dev/tests/unit/test_release.py"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "dev" / "tools"))
import release  # noqa: E402


def _write_fixture(root: Path, version: str = "1.2.3") -> None:
    (root / "package.json").write_text(
        json.dumps({"name": "ultimate-diagram", "version": version}, indent=2) + "\n",
        encoding="utf-8",
    )
    (root / "package-lock.json").write_text(
        json.dumps(
            {
                "name": "ultimate-diagram",
                "version": version,
                "packages": {
                    "": {"name": "ultimate-diagram", "version": version},
                    "node_modules/dep": {"version": "9.9.9"},
                },
            },
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    (root / "SKILL.md").write_text(
        f"---\nname: ultimate-diagram\nversion: {version}\n---\n",
        encoding="utf-8",
    )


def test_bump_levels() -> None:
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        _write_fixture(root, "1.2.3")
        with mock.patch.object(release, "ROOT", root):
            assert release.bump() == "1.2.4"
            assert release.bump("patch") == "1.2.5"
            assert release.bump("minor") == "1.3.0"
            assert release.bump("major") == "2.0.0"

            pkg = json.loads((root / "package.json").read_text(encoding="utf-8"))
            lock = json.loads((root / "package-lock.json").read_text(encoding="utf-8"))
            skill = (root / "SKILL.md").read_text(encoding="utf-8")

            assert pkg["version"] == "2.0.0"
            assert lock["version"] == "2.0.0"
            assert lock["packages"][""]["version"] == "2.0.0"
            assert lock["packages"]["node_modules/dep"]["version"] == "9.9.9"
            assert "version: 2.0.0" in skill


def test_bump_rejects_invalid_level() -> None:
    try:
        release.bump("huge")
    except ValueError as exc:
        assert "Unsupported bump level" in str(exc)
    else:
        raise AssertionError("Expected ValueError for invalid bump level")


if __name__ == "__main__":
    test_bump_levels()
    test_bump_rejects_invalid_level()
    print("[PASS] release.py")
