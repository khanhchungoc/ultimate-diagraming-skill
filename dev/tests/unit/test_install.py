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


def test_register_version_hook_merges_and_is_idempotent() -> None:
    import json
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        settings = root / ".claude" / "settings.json"
        settings.parent.mkdir(parents=True)
        existing = {
            "theme": "dark",
            "hooks": {
                "SessionStart": [{"hooks": [{"type": "command", "command": "echo hi"}]}],
                "PreToolUse": [{"hooks": [{"type": "command", "command": "echo pre"}]}],
            },
        }
        settings.write_text(json.dumps(existing), encoding="utf-8")
        dest = root / ".claude" / "skills" / "ultimate-diagram"

        ok1, _ = install.register_version_hook("claude", settings, dest)
        ok2, _ = install.register_version_hook("claude", settings, dest)
        assert ok1 and ok2

        merged = json.loads(settings.read_text(encoding="utf-8"))
        assert merged["theme"] == "dark"
        assert len(merged["hooks"]["PreToolUse"]) == 1
        ss = merged["hooks"]["SessionStart"]
        assert len(ss) == 2, ss  # original entry + one idempotent ultimate-diagram entry
        ours = ss[1]["hooks"][0]
        assert ours["async"] is True and "--hook claude" in ours["command"]

        # Corrupt JSON must not be clobbered
        bad = root / "bad.json"
        bad.write_text("{not valid json", encoding="utf-8")
        ok_bad, msg = install.register_version_hook("gemini", bad, dest)
        assert not ok_bad and "could not parse JSON" in msg
        assert bad.read_text(encoding="utf-8") == "{not valid json"


def test_node_installer_hooks_and_no_hooks() -> None:
    import json
    repo_root = Path(__file__).resolve().parents[3]
    with tempfile.TemporaryDirectory() as d:
        proj = Path(d) / "proj"
        proj.mkdir()
        res = subprocess.run(
            ["node", str(repo_root / "bin" / "install.js"), "--project", "--target-path", str(proj),
             "--runtime", "claude", "--mode", "copy", "--claude-output", "file"],
            capture_output=True, text=True, encoding="utf-8",
        )
        assert res.returncode == 0, res.stdout + res.stderr
        settings = proj / ".claude" / "settings.json"
        assert settings.is_file()
        data = json.loads(settings.read_text(encoding="utf-8"))
        assert len(data["hooks"]["SessionStart"]) == 1
        assert data["hooks"]["SessionStart"][0]["hooks"][0]["async"] is True

        # --no-hooks skips writing settings.json
        proj2 = Path(d) / "proj2"
        proj2.mkdir()
        res2 = subprocess.run(
            ["node", str(repo_root / "bin" / "install.js"), "--project", "--target-path", str(proj2),
             "--runtime", "claude", "--mode", "copy", "--claude-output", "file", "--no-hooks"],
            capture_output=True, text=True, encoding="utf-8",
        )
        assert res2.returncode == 0, res2.stdout + res2.stderr
        assert not (proj2 / ".claude" / "settings.json").exists()


def main() -> None:
    test_windows_junction_uses_subprocess_argv()
    test_windows_junction_failure_falls_back_to_copy()
    test_posix_create_link_creates_symlink()
    test_register_version_hook_merges_and_is_idempotent()
    test_node_installer_hooks_and_no_hooks()
    print("[PASS] install.py + install.js")


if __name__ == "__main__":
    main()
