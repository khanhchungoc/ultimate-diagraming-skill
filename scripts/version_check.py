#!/usr/bin/env python3
"""Runtime-agnostic async version check for ultimate-diagram.

Checks the installed version (SKILL.md / package.json) against the latest
GitHub Release using a 24-hour local cache and a detached background refresh
worker so neither session startup nor layout_engine.py ever blocks on network.

Zero external dependencies (Python 3.9+ stdlib only).

CLI modes:
  python version_check.py --check         Print an [INFO] line if an update is cached; refresh in background if stale.
  python version_check.py --refresh       Fetch the latest GitHub release and update the local cache.
  python version_check.py --hook claude   Emit SessionStart hook JSON for Claude Code (silent when up to date).
  python version_check.py --hook gemini   Emit SessionStart hook JSON for Gemini CLI (silent when up to date).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional, Tuple

REPO = "khanhchungoc/ultimate-diagraming-skill"
API_URL = f"https://api.github.com/repos/{REPO}/releases/latest"
CACHE_TTL = 24 * 60 * 60      # 24 hours for a successful check
ERROR_BACKOFF = 4 * 60 * 60   # 4 hours backoff after a network/API error
FETCH_TIMEOUT = 3.0           # seconds
OPT_OUT_ENV = "ULTIMATE_DIAGRAM_NO_UPDATE_CHECK"
CACHE_DIR_ENV = "ULTIMATE_DIAGRAM_CACHE_DIR"
SKILL_ROOT = Path(__file__).resolve().parent.parent

_SEMVER_RE = re.compile(r"^\s*v?(\d+)\.(\d+)\.(\d+)\s*$")
_FRONTMATTER_VERSION_RE = re.compile(r"(?m)^version:\s*['\"]?([0-9]+\.[0-9]+\.[0-9]+)['\"]?\s*$")


def is_disabled() -> bool:
    """Return True when update checks are disabled via env var or CI environment."""
    for key in (OPT_OUT_ENV, "CI", "GITHUB_ACTIONS"):
        if os.environ.get(key, "").strip().lower() in ("1", "true", "yes"):
            return True
    return False


def cache_path() -> Path:
    """Return the local cache file path for version check results."""
    override = os.environ.get(CACHE_DIR_ENV, "").strip()
    if override:
        return Path(override) / "version.json"
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_CACHE_HOME") or (Path.home() / ".cache"))
    return base / "ultimate-diagram" / "version.json"


def parse_version(raw: Any) -> Optional[Tuple[int, int, int]]:
    """Parse a strict major.minor.patch version string (optional leading 'v')."""
    if not isinstance(raw, str):
        return None
    m = _SEMVER_RE.match(raw)
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)), int(m.group(3))


def is_newer(latest: Any, current: Any) -> bool:
    """Return True iff both versions are valid semver tuples and latest > current."""
    lat = parse_version(latest)
    cur = parse_version(current)
    return lat is not None and cur is not None and lat > cur


def read_installed_version(skill_dir: Optional[Path] = None) -> Optional[str]:
    """Read the installed skill version from SKILL.md frontmatter, falling back to package.json."""
    root = Path(skill_dir) if skill_dir is not None else SKILL_ROOT
    skill_md = root / "SKILL.md"
    if skill_md.is_file():
        try:
            text = skill_md.read_text(encoding="utf-8")
            if text.startswith("---"):
                end = text.find("\n---", 3)
                frontmatter = text[3:end] if end > 0 else text[:500]
                m = _FRONTMATTER_VERSION_RE.search(frontmatter)
                if m:
                    return m.group(1)
        except OSError:
            pass
    pkg_json = root / "package.json"
    if pkg_json.is_file():
        try:
            data = json.loads(pkg_json.read_text(encoding="utf-8"))
            ver = data.get("version")
            if isinstance(ver, str) and parse_version(ver):
                return ver.lstrip("vV")
        except (OSError, ValueError):
            pass
    return None


def detect_update_command(skill_dir: Optional[Path] = None) -> str:
    """Return the appropriate update command for either a git-clone/symlink or copy install."""
    root = Path(skill_dir) if skill_dir is not None else SKILL_ROOT
    try:
        resolved = root.resolve()
        if (resolved / ".git").exists():
            return f'git -C "{resolved}" pull'
    except OSError:
        pass
    return "npx ultimate-diagram@latest"


def read_cache(path: Optional[Path] = None) -> Optional[dict]:
    """Read the version cache JSON; return None if missing or invalid."""
    p = path if path is not None else cache_path()
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def write_cache(data: dict, path: Optional[Path] = None) -> None:
    """Atomically write the version cache JSON."""
    p = path if path is not None else cache_path()
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".version-", suffix=".tmp", dir=str(p.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(data, fh, indent=2)
                fh.write("\n")
            os.replace(tmp, p)
        except OSError:
            try:
                os.unlink(tmp)
            except OSError:
                pass
    except OSError:
        pass


def cache_is_fresh(cache: Optional[dict], now: Optional[float] = None) -> bool:
    """Return True if the cached check is still within its TTL (or error backoff window)."""
    if not isinstance(cache, dict):
        return False
    checked_at = cache.get("checked_at")
    if not isinstance(checked_at, (int, float)):
        return False
    ts = time.time() if now is None else now
    if ts < checked_at:
        return False
    ttl = ERROR_BACKOFF if cache.get("error") else CACHE_TTL
    return (ts - checked_at) < ttl


def fetch_latest_release(
    url: str = API_URL,
    timeout: float = FETCH_TIMEOUT,
    prev_cache: Optional[dict] = None,
) -> dict:
    """Fetch the latest GitHub release metadata and return a cache record."""
    now = int(time.time())
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "ultimate-diagram-version-check",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        tag = payload.get("tag_name") if isinstance(payload, dict) else None
        parsed = parse_version(tag)
        if not parsed:
            raise ValueError(f"unexpected tag_name: {tag!r}")
        latest = f"{parsed[0]}.{parsed[1]}.{parsed[2]}"
        release_url = payload.get("html_url") if isinstance(payload.get("html_url"), str) else None
        return {
            "checked_at": now,
            "latest": latest,
            "release_url": release_url,
            "error": None,
        }
    except (OSError, ValueError, urllib.error.URLError) as exc:
        return {
            "checked_at": now,
            "latest": prev_cache.get("latest") if isinstance(prev_cache, dict) else None,
            "release_url": prev_cache.get("release_url") if isinstance(prev_cache, dict) else None,
            "error": str(exc)[:200],
        }


def refresh_cache(
    path: Optional[Path] = None,
    url: str = API_URL,
    timeout: float = FETCH_TIMEOUT,
) -> dict:
    """Fetch the latest release and persist it to the local cache."""
    p = path if path is not None else cache_path()
    prev = read_cache(p)
    record = fetch_latest_release(url=url, timeout=timeout, prev_cache=prev)
    write_cache(record, p)
    return record


def spawn_background_refresh(script_path: Optional[Path] = None) -> bool:
    """Launch a detached background worker to refresh the version cache without blocking."""
    script = Path(script_path) if script_path is not None else Path(__file__).resolve()
    kwargs: dict[str, Any] = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "close_fds": True,
    }
    if sys.platform == "win32":
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000) | getattr(subprocess, "DETACHED_PROCESS", 0x00000008)
        kwargs["creationflags"] = flags
    else:
        kwargs["start_new_session"] = True
    try:
        subprocess.Popen([sys.executable, str(script), "--refresh"], **kwargs)
        return True
    except OSError:
        return False


def format_update_notice(current: str, latest: str, update_cmd: str) -> str:
    """Build the agent-facing instruction when a newer release exists."""
    return (
        f"Update available for ultimate-diagram (v{current} -> v{latest}). "
        f"Inform the user on your next reply and let them choose whether you should run "
        f"`{update_cmd}` for them or they prefer to update it themselves."
    )


def check_nonblocking(
    skill_dir: Optional[Path] = None,
    cache_file: Optional[Path] = None,
    now: Optional[float] = None,
) -> Optional[str]:
    """Read local cache (<1 ms), trigger background refresh if stale, and return an [INFO] line if outdated."""
    if is_disabled():
        return None
    current = read_installed_version(skill_dir)
    if not current:
        return None
    cache = read_cache(cache_file)
    if not cache_is_fresh(cache, now=now):
        spawn_background_refresh()
    if cache and is_newer(cache.get("latest"), current):
        cmd = detect_update_command(skill_dir)
        return f"[INFO] {format_update_notice(current, cache['latest'], cmd)}"
    return None


def run_hook(
    runtime: str,
    skill_dir: Optional[Path] = None,
    cache_file: Optional[Path] = None,
    url: str = API_URL,
    now: Optional[float] = None,
) -> str:
    """Produce SessionStart hook JSON for the given runtime, or empty string when up to date."""
    if is_disabled():
        return ""
    current = read_installed_version(skill_dir)
    if not current:
        return ""
    p = cache_file if cache_file is not None else cache_path()
    cache = read_cache(p)
    if not cache_is_fresh(cache, now=now):
        if runtime == "claude":
            # Claude Code runs this hook with `"async": true`, so refreshing inline never delays startup.
            cache = refresh_cache(path=p, url=url)
        else:
            spawn_background_refresh()
    if not (cache and is_newer(cache.get("latest"), current)):
        return ""
    notice = format_update_notice(current, cache["latest"], detect_update_command(skill_dir))
    if runtime == "claude":
        payload = {
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": notice,
            }
        }
    else:
        payload = {
            "hookSpecificOutput": {
                "additionalContext": notice,
            }
        }
    return json.dumps(payload)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Async version checker for ultimate-diagram.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true", help="Non-blocking cache check (prints [INFO] line if outdated)")
    group.add_argument("--refresh", action="store_true", help="Fetch latest GitHub release and update cache")
    group.add_argument("--hook", choices=("claude", "gemini"), help="Emit SessionStart hook JSON for the given runtime")
    args = parser.parse_args(argv)

    if args.refresh:
        if not is_disabled():
            refresh_cache()
        return 0
    if args.check:
        line = check_nonblocking()
        if line:
            print(line)
        return 0
    if args.hook:
        out = run_hook(args.hook)
        if out:
            print(out)
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
