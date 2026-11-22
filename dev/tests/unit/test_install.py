"""Unit tests for scripts/install.py link and Windows junction fallback. Run: python3 dev/tests/unit/test_install.py"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
import install  # noqa: E402


def test_windows_junction_uses_subprocess_argv() -> None:
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        source = root / 'src & "quoted"'
        target = root / 'dst & "quoted"' / "ultimate-diagram"
        source.mkdir(parents=True)

        fake_result = subprocess.CompletedProcess(args=[], returncode=0)
        with (
            mock.patch.object(install.sys, "platform", "win32"),
            mock.patch.object(Path, "symlink_to", side_effect=OSError("no privilege")),
            mock.patch.object(os, "system", side_effect=AssertionError("os.system must not be called")),
            mock.patch.object(install.subprocess, "run", return_value=fake_result) as run_mock,
            mock.patch.object(install, "copy_skill", side_effect=AssertionError("copy fallback should not run")),
        ):
            install.create_link(source, target)

        run_mock.assert_called_once_with(
            ["cmd", "/c", "mklink", "/J", str(target), str(source)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        assert not run_mock.call_args.kwargs.get("shell", False)


def test_windows_junction_failure_falls_back_to_copy() -> None:
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        source = root / "src"
        target = root / "dst" / "ultimate-diagram"
        source.mkdir()

        fake_result = subprocess.CompletedProcess(args=[], returncode=1)
        with (
            mock.patch.object(install.sys, "platform", "win32"),
            mock.patch.object(Path, "symlink_to", side_effect=OSError("no privilege")),
            mock.patch.object(install.subprocess, "run", return_value=fake_result),
            mock.patch.object(install, "copy_skill") as copy_mock,
        ):
            install.create_link(source, target)

        copy_mock.assert_called_once_with(source, target)


def test_posix_create_link_creates_symlink() -> None:
    if sys.platform == "win32":
        return
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        source = root / "src"
        target = root / "link"
        source.mkdir()
        install.create_link(source, target)
        assert target.is_symlink() and target.resolve() == source.resolve()


def main() -> None:
    test_windows_junction_uses_subprocess_argv()
    test_windows_junction_failure_falls_back_to_copy()
    test_posix_create_link_creates_symlink()
    print("[PASS] install.py create_link")


if __name__ == "__main__":
    main()
