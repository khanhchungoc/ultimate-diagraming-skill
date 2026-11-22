"""Unit tests for scripts/version_check.py. Run: python3 dev/tests/unit/test_version_check.py"""
from __future__ import annotations

import http.server
import json
import os
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "scripts"))
import version_check as vc  # noqa: E402


def test_semver_comparison() -> None:
    assert vc.parse_version("1.1.50") == (1, 1, 50)
    assert vc.parse_version("v1.2.0") == (1, 2, 0)
    assert vc.parse_version("1.2.0-rc1") is None
    assert vc.parse_version("not-a-version") is None

    assert vc.is_newer("1.1.51", "1.1.50")
    assert vc.is_newer("v1.2.0", "1.1.50")
    assert vc.is_newer("2.0.0", "1.9.99")
    assert not vc.is_newer("1.1.50", "1.1.50")
    assert not vc.is_newer("1.1.49", "1.1.50")
    assert not vc.is_newer("bad", "1.1.50")


def test_read_installed_version_and_update_command() -> None:
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        (root / "SKILL.md").write_text("---\nname: ultimate-diagram\nversion: 1.2.3\n---\n", encoding="utf-8")
        assert vc.read_installed_version(root) == "1.2.3"
        assert vc.detect_update_command(root) == f"npx {vc.REPO}"

        # Fallback to package.json when SKILL.md is absent
        (root / "SKILL.md").unlink()
        (root / "package.json").write_text(json.dumps({"version": "1.2.4"}), encoding="utf-8")
        assert vc.read_installed_version(root) == "1.2.4"

        # Git clone / symlink detects git pull
        (root / ".git").mkdir()
        cmd = vc.detect_update_command(root)
        assert cmd.startswith("git -C ") and cmd.endswith(" pull"), cmd


def test_cache_freshness_and_backoff() -> None:
    now = 2_000_000.0
    assert not vc.cache_is_fresh(None, now=now)
    assert vc.cache_is_fresh({"checked_at": now - 100, "latest": "1.1.51", "error": None}, now=now)
    assert not vc.cache_is_fresh({"checked_at": now - vc.CACHE_TTL - 1, "latest": "1.1.51", "error": None}, now=now)
    # Error uses shorter backoff
    assert vc.cache_is_fresh({"checked_at": now - 100, "latest": None, "error": "timeout"}, now=now)
    assert not vc.cache_is_fresh({"checked_at": now - vc.ERROR_BACKOFF - 1, "latest": None, "error": "timeout"}, now=now)


def test_nonblocking_check_and_opt_out() -> None:
    with tempfile.TemporaryDirectory() as d:
        root = Path(d) / "skill"
        root.mkdir()
        (root / "SKILL.md").write_text("---\nversion: 1.1.50\n---\n", encoding="utf-8")
        cache_file = Path(d) / "version.json"
        now = 2_000_000.0

        # Fresh cache with newer version: emits [INFO] and does not spawn refresh
        vc.write_cache({"checked_at": now - 60, "latest": "1.1.55", "release_url": None, "error": None}, cache_file)
        with (
            mock.patch.dict(os.environ, {}, clear=False),
            mock.patch.object(vc, "is_disabled", return_value=False),
            mock.patch.object(vc, "spawn_background_refresh") as spawn_mock,
        ):
            line = vc.check_nonblocking(skill_dir=root, cache_file=cache_file, now=now)
            assert line is not None and line.startswith("[INFO] Update available")
            assert "v1.1.50 -> v1.1.55" in line
            assert f"npx {vc.REPO}" in line
            spawn_mock.assert_not_called()

        # Stale cache: spawns detached refresh without blocking
        vc.write_cache({"checked_at": now - vc.CACHE_TTL - 10, "latest": "1.1.50", "release_url": None, "error": None}, cache_file)
        with (
            mock.patch.object(vc, "is_disabled", return_value=False),
            mock.patch.object(vc, "spawn_background_refresh") as spawn_mock,
        ):
            line = vc.check_nonblocking(skill_dir=root, cache_file=cache_file, now=now)
            assert line is None
            spawn_mock.assert_called_once()

        # Opt-out env var suppresses both output and refresh
        with (
            mock.patch.dict(os.environ, {vc.OPT_OUT_ENV: "1"}),
            mock.patch.object(vc, "spawn_background_refresh") as spawn_mock,
        ):
            assert vc.check_nonblocking(skill_dir=root, cache_file=cache_file, now=now) is None
            spawn_mock.assert_not_called()


def test_refresh_and_hooks_with_mock_http() -> None:
    payload = {"tag_name": "v9.9.9", "html_url": "https://example.invalid/releases/v9.9.9"}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: object) -> None:  # noqa: A002
            pass

    with socketserver.TCPServer(("127.0.0.1", 0), Handler) as srv:
        port = srv.server_address[1]
        thread = threading.Thread(target=srv.serve_forever, daemon=True)
        thread.start()
        try:
            url = f"http://127.0.0.1:{port}/latest"
            with tempfile.TemporaryDirectory() as d:
                root = Path(d) / "skill"
                root.mkdir()
                (root / "SKILL.md").write_text("---\nversion: 1.1.50\n---\n", encoding="utf-8")
                cache_file = Path(d) / "version.json"

                # Claude hook refreshes inline when stale and emits hookSpecificOutput JSON
                with mock.patch.object(vc, "is_disabled", return_value=False):
                    out = vc.run_hook("claude", skill_dir=root, cache_file=cache_file, url=url)
                parsed = json.loads(out)
                assert parsed["hookSpecificOutput"]["hookEventName"] == "SessionStart"
                assert "v1.1.50 -> v9.9.9" in parsed["hookSpecificOutput"]["additionalContext"]

                # Gemini hook reads fresh cache and emits additionalContext JSON
                with (
                    mock.patch.object(vc, "is_disabled", return_value=False),
                    mock.patch.object(vc, "spawn_background_refresh") as spawn_mock,
                ):
                    gout = vc.run_hook("gemini", skill_dir=root, cache_file=cache_file, url=url)
                    spawn_mock.assert_not_called()
                gp = json.loads(gout)
                assert "v1.1.50 -> v9.9.9" in gp["hookSpecificOutput"]["additionalContext"]

                # Up to date: both hooks stay completely silent
                (root / "SKILL.md").write_text("---\nversion: 9.9.9\n---\n", encoding="utf-8")
                with mock.patch.object(vc, "is_disabled", return_value=False):
                    assert vc.run_hook("claude", skill_dir=root, cache_file=cache_file, url=url) == ""
                    assert vc.run_hook("gemini", skill_dir=root, cache_file=cache_file, url=url) == ""
        finally:
            srv.shutdown()


def test_extract_stdout_stays_clean() -> None:
    """When cache reports an update, layout_engine.py --extract stdout stays pure JSON/Mermaid (notice goes to stderr)."""
    with tempfile.TemporaryDirectory() as d:
        cache_dir = Path(d)
        vc.write_cache(
            {"checked_at": int(time.time()), "latest": "9.9.9", "release_url": None, "error": None},
            cache_dir / "version.json",
        )
        env = {k: v for k, v in os.environ.items() if k not in ("CI", "GITHUB_ACTIONS", vc.OPT_OUT_ENV)}
        env[vc.CACHE_DIR_ENV] = str(cache_dir)
        sample = REPO_ROOT / "dev" / "samples" / "example-flowchart.html"
        res = subprocess.run(
            [sys.executable, str(REPO_ROOT / "scripts" / "layout_engine.py"), "--extract", str(sample), "--json"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=env,
        )
        assert res.returncode == 0, res.stderr
        parsed = json.loads(res.stdout)  # stdout must remain valid JSON!
        assert parsed.get("diagramType") == "flowchart"
        assert "[INFO] Update available" in res.stderr


def main() -> None:
    test_semver_comparison()
    test_read_installed_version_and_update_command()
    test_cache_freshness_and_backoff()
    test_nonblocking_check_and_opt_out()
    test_refresh_and_hooks_with_mock_http()
    test_extract_stdout_stays_clean()
    print("[PASS] version_check.py")


if __name__ == "__main__":
    main()
