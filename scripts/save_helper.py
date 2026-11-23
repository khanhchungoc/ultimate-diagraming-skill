#!/usr/bin/env python3
"""Opt-in local background direct-save helper for ultimate-diagram HTML files.

Listens on 127.0.0.1 (ports 19847..19851) so a diagram opened via file://
(or a local preview server such as VS Code's integrated browser) can save
JSON edits straight back to disk in one click without a file picker dialog.

Security model:
- Opt-in only: never starts unless <cache-dir>/config.json has direct_save_helper=true.
- Loopback only (127.0.0.1) with strict Origin check (null or loopback) and custom header.
- Per-file 128-bit random <meta name="diagram-save-id"> registered in allowed-ids.json
  and verified against the target file on disk before writing.
- JSON-only atomic patching via disk_format.format_json() + stamp_reading_guide().

Zero external dependencies (Python 3.9+ stdlib only).
"""

from __future__ import annotations

import argparse
import hmac
import html as html_lib
import json
import os
import re
import secrets
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Tuple

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from disk_format import SUPPORTED_TYPES, format_json, stamp_reading_guide

APP_NAME = "ultimate-diagram-save-helper"
HELPER_VERSION = 1
HOST = "127.0.0.1"
PORT_RANGE = tuple(range(19847, 19852))  # 19847..19851
DEFAULT_IDLE_TIMEOUT = 60 * 60           # 60 minutes
MAX_BODY_BYTES = 10 * 1024 * 1024        # 10 MB
MAX_ALLOWED_IDS = 500
HEALTH_TIMEOUT = 0.15                    # seconds

OPT_OUT_ENV = "ULTIMATE_DIAGRAM_NO_SAVE_HELPER"
CACHE_DIR_ENV = "ULTIMATE_DIAGRAM_CACHE_DIR"
ALLOW_HEADLESS_ENV = "ULTIMATE_DIAGRAM_ALLOW_HEADLESS_SAVE_HELPER"

SAVE_ID_RE = re.compile(r'^[0-9a-f]{32}$')
META_SAVE_ID_RE = re.compile(
    r'<meta\s+name="diagram-save-id"\s+content="([0-9a-f]{32})"\s*/?>'
)
META_CHARSET_RE = re.compile(r'([ \t]*<meta\s+charset="UTF-8"\s*/?>)', re.IGNORECASE)
DATA_BLOCK_RE = re.compile(
    r'(<script id="diagram-data" type="application/json">)[\s\S]*?(</script>)'
)
RENDER_REPORT_RE = re.compile(
    r'<script id="render-report" type="application/json">[\s\S]*?</script>'
)
TITLE_RE = re.compile(r'(<title>)[\s\S]*?(</title>)')
H1_TITLE_RE = re.compile(r'(<h1 id="chart-title"[^>]*>)[\s\S]*?(</h1>)')
LOOPBACK_ORIGIN_RE = re.compile(r'^http://(127\.0\.0\.1|localhost)(:\d{1,5})?$')


# --- Cache directory, config, and registry ---


def cache_dir() -> Path:
    """Return the per-user cache directory (matches scripts/version_check.py)."""
    override = os.environ.get(CACHE_DIR_ENV, "").strip()
    if override:
        return Path(override)
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_CACHE_HOME") or (Path.home() / ".cache"))
    return base / "ultimate-diagram"


def config_path() -> Path:
    return cache_dir() / "config.json"


def registry_path() -> Path:
    return cache_dir() / "allowed-ids.json"


def server_state_path() -> Path:
    return cache_dir() / "server.json"


def _atomic_write_json(path: Path, payload: Dict[str, Any], private: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    tmp_path = Path(tmp_name)
    try:
        if private and os.name != "nt":
            os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
        if private and os.name != "nt":
            try:
                os.chmod(path, 0o600)
            except OSError:
                pass
    except BaseException:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def _read_json_dict(path: Path) -> Dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except (OSError, ValueError):
        return {}


def read_config() -> Dict[str, Any]:
    return _read_json_dict(config_path())


def get_direct_save_enabled() -> Optional[bool]:
    """Return True/False if configured, or None if the user has not opted in/out yet."""
    val = read_config().get("direct_save_helper")
    return val if isinstance(val, bool) else None


def set_direct_save_enabled(enabled: bool) -> Path:
    cfg = read_config()
    cfg["direct_save_helper"] = bool(enabled)
    target = config_path()
    _atomic_write_json(target, cfg, private=True)
    return target


def is_env_disabled() -> bool:
    """Return True when the environment should never auto-start the local save helper."""
    for key in (OPT_OUT_ENV, "CI", "GITHUB_ACTIONS"):
        if os.environ.get(key, "").strip().lower() in ("1", "true", "yes"):
            return True
    if os.environ.get("SSH_CONNECTION") or os.environ.get("SSH_CLIENT"):
        return True
    if sys.platform.startswith("linux"):
        allow_headless = os.environ.get(ALLOW_HEADLESS_ENV, "").strip().lower() in ("1", "true", "yes")
        if not allow_headless and not os.environ.get("DISPLAY") and not os.environ.get("WAYLAND_DISPLAY"):
            return True
    return False


# --- Per-file save ID stamping and registry ---


def generate_save_id() -> str:
    return secrets.token_hex(16)


def extract_save_id(html_text: str) -> Optional[str]:
    match = META_SAVE_ID_RE.search(html_text)
    return match.group(1) if match else None


def stamp_save_id(html_text: str, save_id: str) -> str:
    """Insert or replace <meta name="diagram-save-id"> in <head> and refresh line-2 guide."""
    if not SAVE_ID_RE.match(save_id):
        raise ValueError("Invalid diagram-save-id format.")
    tag = f'<meta name="diagram-save-id" content="{save_id}">'
    if META_SAVE_ID_RE.search(html_text):
        updated = META_SAVE_ID_RE.sub(tag, html_text, count=1)
    elif META_CHARSET_RE.search(html_text):
        def _insert(m: re.Match) -> str:
            line = m.group(1)
            indent = line[: len(line) - len(line.lstrip(" \t"))]
            return f"{line}\n{indent}{tag}"
        updated = META_CHARSET_RE.sub(_insert, html_text, count=1)
    elif "<head>" in html_text:
        updated = html_text.replace("<head>", f"<head>\n  {tag}", 1)
    else:
        raise ValueError("HTML page is missing a <head> section.")
    return stamp_reading_guide(updated)


def read_registry() -> Dict[str, Dict[str, Any]]:
    raw = _read_json_dict(registry_path()).get("ids")
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, Dict[str, Any]] = {}
    for sid, entry in raw.items():
        if isinstance(sid, str) and SAVE_ID_RE.match(sid) and isinstance(entry, dict):
            path_val = entry.get("path")
            updated_at = entry.get("updated_at")
            if isinstance(path_val, str) and path_val:
                out[sid] = {
                    "path": path_val,
                    "updated_at": float(updated_at) if isinstance(updated_at, (int, float)) else 0.0,
                }
    return out


def register_save_id(save_id: str, file_path: Path) -> None:
    if not SAVE_ID_RE.match(save_id):
        raise ValueError("Invalid diagram-save-id format.")
    resolved = str(Path(file_path).resolve())
    entries = read_registry()
    entries[save_id] = {"path": resolved, "updated_at": time.time()}
    if len(entries) > MAX_ALLOWED_IDS:
        # Keep the newest MAX_ALLOWED_IDS entries
        ordered = sorted(entries.items(), key=lambda kv: kv[1].get("updated_at", 0.0), reverse=True)
        entries = dict(ordered[:MAX_ALLOWED_IDS])
    _atomic_write_json(registry_path(), {"ids": entries}, private=True)


def lookup_registered_id(save_id: str) -> Optional[Dict[str, Any]]:
    if not isinstance(save_id, str) or not SAVE_ID_RE.match(save_id):
        return None
    entries = read_registry()
    for registered_id, entry in entries.items():
        if hmac.compare_digest(registered_id, save_id):
            return entry
    return None


# --- JSON-only atomic HTML patcher ---


class SaveError(Exception):
    """Structured error mapped to an HTTP status code."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _validate_target_path(raw_path: str) -> Path:
    if not isinstance(raw_path, str) or not raw_path.strip() or "\x00" in raw_path:
        raise SaveError(400, "Invalid target file path.")
    candidate = Path(raw_path)
    if candidate.is_symlink():
        raise SaveError(403, "Symlink targets are not allowed.")
    try:
        resolved = candidate.resolve(strict=True)
    except OSError:
        raise SaveError(404, "Target HTML file does not exist.")
    if resolved.is_symlink() or not resolved.is_file():
        raise SaveError(403, "Target path must be a regular HTML file.")
    if resolved.suffix.lower() not in (".html", ".htm"):
        raise SaveError(403, "Only .html and .htm files can be saved.")
    return resolved


def patch_diagram_html(
    file_path: Path,
    save_id: str,
    data: Any,
    title: Optional[str] = None,
) -> Path:
    """Validate save_id + diagram JSON and atomically patch only data/title/reading guide."""
    if not isinstance(save_id, str) or not SAVE_ID_RE.match(save_id):
        raise SaveError(403, "Invalid diagram save ID.")
    if not isinstance(data, dict):
        raise SaveError(400, "Diagram data must be a JSON object.")
    kind = data.get("diagramType")
    if kind not in SUPPORTED_TYPES:
        raise SaveError(400, f"Unsupported diagramType: {kind!r}.")

    target = _validate_target_path(str(file_path))
    try:
        original = target.read_text(encoding="utf-8")
    except OSError:
        raise SaveError(404, "Could not read target HTML file.")

    disk_id = extract_save_id(original)
    if not disk_id or not hmac.compare_digest(disk_id, save_id):
        raise SaveError(403, "Target file save ID does not match.")
    if not DATA_BLOCK_RE.search(original):
        raise SaveError(400, "Target file does not contain a diagram-data block.")

    formatted_json = format_json(data)
    raw_title = title if isinstance(title, str) and title.strip() else str(data.get("title") or "")
    escaped_title = html_lib.escape(raw_title, quote=False)

    updated = RENDER_REPORT_RE.sub("", original, count=1)
    updated = DATA_BLOCK_RE.sub(
        lambda m: f"{m.group(1)}\n{formatted_json}\n  {m.group(2)}",
        updated,
        count=1,
    )
    if escaped_title:
        updated = TITLE_RE.sub(lambda m: f"{m.group(1)}{escaped_title}{m.group(2)}", updated, count=1)
        updated = H1_TITLE_RE.sub(lambda m: f"{m.group(1)}{escaped_title}{m.group(2)}", updated, count=1)
    updated = stamp_reading_guide(updated)

    # Atomic replace in the same directory so crashes never truncate the diagram
    fd, tmp_name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=str(target.parent))
    tmp_path = Path(tmp_name)
    try:
        try:
            mode = target.stat().st_mode & 0o777
            if os.name != "nt":
                os.fchmod(fd, mode)
        except OSError:
            pass
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            handle.write(updated)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, target)
    except OSError:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise SaveError(500, "Failed to write target HTML file.")

    return target


# --- HTTP Server ---


def is_allowed_origin(origin: Optional[str]) -> bool:
    if origin in ("null", "file://"):
        return True
    if isinstance(origin, str) and LOOPBACK_ORIGIN_RE.match(origin):
        return True
    return False


class SaveHelperServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, server_address: Tuple[str, int], idle_timeout: float = DEFAULT_IDLE_TIMEOUT):
        super().__init__(server_address, _SaveRequestHandler)
        self.idle_timeout = float(idle_timeout)
        self._activity_lock = threading.Lock()
        self.last_activity = time.monotonic()

    def touch(self) -> None:
        with self._activity_lock:
            self.last_activity = time.monotonic()

    def idle_seconds(self) -> float:
        with self._activity_lock:
            return time.monotonic() - self.last_activity


class _SaveRequestHandler(BaseHTTPRequestHandler):
    server: SaveHelperServer

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return  # Keep background helper silent on stderr

    def _send_cors_headers(self, origin: Optional[str]) -> None:
        if is_allowed_origin(origin):
            self.send_header("Access-Control-Allow-Origin", origin)  # type: ignore[arg-type]
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Ultimate-Diagram-Save")
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def _send_json(self, status: int, payload: Dict[str, Any], origin: Optional[str] = None) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._send_cors_headers(origin)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.server.touch()
        origin = self.headers.get("Origin")
        if not is_allowed_origin(origin):
            self._send_json(403, {"ok": False, "error": "Origin not allowed."})
            return
        self.send_response(204)
        self._send_cors_headers(origin)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        self.server.touch()
        origin = self.headers.get("Origin")
        if self.path == "/health":
            self._send_json(
                200,
                {"ok": True, "app": APP_NAME, "version": HELPER_VERSION},
                origin=origin,
            )
            return
        self._send_json(404, {"ok": False, "error": "Not found."}, origin=origin)

    def do_POST(self) -> None:  # noqa: N802
        self.server.touch()
        origin = self.headers.get("Origin")
        if self.path != "/save":
            self._send_json(404, {"ok": False, "error": "Not found."}, origin=origin)
            return
        if not is_allowed_origin(origin):
            self._send_json(403, {"ok": False, "error": "Origin not allowed."})
            return
        if self.headers.get("X-Ultimate-Diagram-Save") != "1":
            self._send_json(403, {"ok": False, "error": "Missing save header."}, origin=origin)
            return

        raw_len = self.headers.get("Content-Length")
        try:
            content_len = int(raw_len) if raw_len is not None else -1
        except ValueError:
            content_len = -1
        if content_len <= 0:
            self._send_json(400, {"ok": False, "error": "Missing or empty request body."}, origin=origin)
            return
        if content_len > MAX_BODY_BYTES:
            self._send_json(413, {"ok": False, "error": "Payload exceeds 10 MB limit."}, origin=origin)
            return

        try:
            body_bytes = self.rfile.read(content_len)
            payload = json.loads(body_bytes.decode("utf-8"))
        except (OSError, UnicodeDecodeError, ValueError):
            self._send_json(400, {"ok": False, "error": "Invalid JSON body."}, origin=origin)
            return

        if not isinstance(payload, dict):
            self._send_json(400, {"ok": False, "error": "Request body must be a JSON object."}, origin=origin)
            return

        save_id = payload.get("saveId")
        reg_entry = lookup_registered_id(save_id) if isinstance(save_id, str) else None
        if reg_entry is None:
            self._send_json(403, {"ok": False, "error": "Diagram save ID is not registered."}, origin=origin)
            return

        req_path = payload.get("path")
        if isinstance(req_path, str) and req_path.strip():
            target_path_str = req_path
        elif origin != "null":
            # Loopback preview (e.g. VS Code Live Preview) cannot see the local file path;
            # resolve it from the registered ID entry (still verified against on-disk ID).
            target_path_str = reg_entry["path"]
        else:
            self._send_json(400, {"ok": False, "error": "Missing target file path."}, origin=origin)
            return

        try:
            saved_target = patch_diagram_html(
                Path(target_path_str),
                save_id,
                payload.get("data"),
                payload.get("title") if isinstance(payload.get("title"), str) else None,
            )
        except SaveError as exc:
            self._send_json(exc.status, {"ok": False, "error": exc.message}, origin=origin)
            return

        # Keep registry path fresh if the user moved or renamed the file on file://
        try:
            if str(saved_target) != reg_entry["path"]:
                register_save_id(save_id, saved_target)
        except OSError:
            pass

        self._send_json(200, {"ok": True, "name": saved_target.name}, origin=origin)


def create_server(
    ports: Iterable[int] = PORT_RANGE,
    idle_timeout: float = DEFAULT_IDLE_TIMEOUT,
) -> SaveHelperServer:
    """Bind SaveHelperServer to the first free port on 127.0.0.1."""
    last_err: Optional[OSError] = None
    for port in ports:
        try:
            return SaveHelperServer((HOST, port), idle_timeout=idle_timeout)
        except OSError as exc:
            last_err = exc
    raise OSError(f"Could not bind save helper on {HOST} ports {list(ports)}: {last_err}")


def probe_health(port: int, timeout: float = HEALTH_TIMEOUT) -> bool:
    url = f"http://{HOST}:{port}/health"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                return False
            data = json.loads(resp.read(4096).decode("utf-8"))
            return bool(data.get("ok") and data.get("app") == APP_NAME)
    except (OSError, urllib.error.URLError, ValueError):
        return False


def find_running_port(ports: Iterable[int] = PORT_RANGE, timeout: float = HEALTH_TIMEOUT) -> Optional[int]:
    state = _read_json_dict(server_state_path())
    state_port = state.get("port")
    checked = set()
    if isinstance(state_port, int) and state_port > 0:
        checked.add(state_port)
        if probe_health(state_port, timeout=timeout):
            return state_port
    for port in ports:
        if port in checked:
            continue
        if probe_health(port, timeout=timeout):
            return port
    return None


def serve_forever(
    ports: Iterable[int] = PORT_RANGE,
    idle_timeout: float = DEFAULT_IDLE_TIMEOUT,
    write_state: bool = True,
) -> int:
    """Run the save helper server until idle timeout or SIGTERM/SIGINT."""
    srv = create_server(ports=ports, idle_timeout=idle_timeout)
    port = srv.server_address[1]
    if write_state:
        _atomic_write_json(
            server_state_path(),
            {"pid": os.getpid(), "port": port, "started_at": time.time()},
            private=True,
        )

    stop_event = threading.Event()

    def _watchdog() -> None:
        poll = min(1.0, max(0.05, idle_timeout / 10.0))
        while not stop_event.wait(poll):
            if srv.idle_seconds() >= srv.idle_timeout:
                srv.shutdown()
                return

    watcher = threading.Thread(target=_watchdog, daemon=True)
    watcher.start()

    def _handle_sig(_signum: int, _frame: Any) -> None:
        threading.Thread(target=srv.shutdown, daemon=True).start()

    prev_term = None
    if threading.current_thread() is threading.main_thread():
        try:
            prev_term = signal.signal(signal.SIGTERM, _handle_sig)
        except (OSError, ValueError):
            prev_term = None

    try:
        srv.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        stop_event.set()
        srv.server_close()
        if prev_term is not None:
            try:
                signal.signal(signal.SIGTERM, prev_term)
            except (OSError, ValueError):
                pass
        if write_state:
            state = _read_json_dict(server_state_path())
            if state.get("pid") == os.getpid():
                try:
                    server_state_path().unlink(missing_ok=True)
                except OSError:
                    pass
    return port


def spawn_detached(idle_timeout: float = DEFAULT_IDLE_TIMEOUT) -> bool:
    """Launch a detached background save helper process (never awaited)."""
    cmd = [sys.executable, str(Path(__file__).resolve()), "serve"]
    if idle_timeout != DEFAULT_IDLE_TIMEOUT:
        cmd.extend(["--idle-timeout", str(idle_timeout)])
    kwargs: Dict[str, Any] = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "close_fds": True,
    }
    if sys.platform == "win32":
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000) | getattr(
            subprocess, "DETACHED_PROCESS", 0x00000008
        )
        kwargs["creationflags"] = flags
    else:
        kwargs["start_new_session"] = True
    try:
        subprocess.Popen(cmd, **kwargs)
        return True
    except OSError:
        return False


def ensure_running(idle_timeout: float = DEFAULT_IDLE_TIMEOUT) -> bool:
    """Ensure a single background helper instance is running; return True if running/spawned."""
    if find_running_port() is not None:
        return True
    return spawn_detached(idle_timeout=idle_timeout)


def ensure_running_if_opted_in(idle_timeout: float = DEFAULT_IDLE_TIMEOUT) -> bool:
    """Start the background helper only when opted in and allowed by the environment."""
    if is_env_disabled() or get_direct_save_enabled() is not True:
        return False
    return ensure_running(idle_timeout=idle_timeout)


def stop_running() -> bool:
    """Stop the running background helper recorded in server.json, if alive."""
    state_file = server_state_path()
    state = _read_json_dict(state_file)
    pid = state.get("pid")
    port = state.get("port")
    if not isinstance(pid, int) or pid <= 0:
        state_file.unlink(missing_ok=True)
        return False
    if not isinstance(port, int) or not probe_health(port):
        state_file.unlink(missing_ok=True)
        return False
    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        else:
            os.kill(pid, signal.SIGTERM)
    except OSError:
        pass
    state_file.unlink(missing_ok=True)
    return True


# --- Integration hooks for layout_engine.py ---


FIRST_RUN_INFO_LINE = (
    "[INFO] Direct-save helper not configured yet. Ask the user whether to enable one-click "
    "direct saving for local HTML diagrams (default: Yes), explain with concrete examples, "
    "then run: python scripts/save_helper.py config --enable (or --disable)."
)


def handle_layout_output(file_path: Path, save_id: str, no_helper: bool = False) -> Optional[str]:
    """Register save_id after --layout writes a local HTML file.

    Returns FIRST_RUN_INFO_LINE when opt-in has not been configured yet; otherwise None.
    Starts the background helper only when opted in and allowed by the environment.
    """
    try:
        register_save_id(save_id, file_path)
    except OSError:
        return None
    if no_helper or is_env_disabled():
        return None
    enabled = get_direct_save_enabled()
    if enabled is True:
        ensure_running()
        return None
    if enabled is None:
        return FIRST_RUN_INFO_LINE
    return None


def handle_extract_html(file_path: Path, html_text: str, no_helper: bool = False) -> None:
    """Register an existing diagram-save-id on --extract and ensure helper is running if opted in."""
    save_id = extract_save_id(html_text)
    if not save_id:
        return
    try:
        register_save_id(save_id, file_path)
    except OSError:
        return
    if not no_helper and not is_env_disabled() and get_direct_save_enabled() is True:
        ensure_running()


# --- CLI ---


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Local background direct-save helper for ultimate-diagram.")
    sub = parser.add_subparsers(dest="command", required=True)

    p_serve = sub.add_parser("serve", help="Run the helper HTTP server in the foreground.")
    p_serve.add_argument("--port", type=int, default=None, help="Specific loopback port (default: 19847..19851).")
    p_serve.add_argument("--idle-timeout", type=float, default=DEFAULT_IDLE_TIMEOUT, help="Idle shutdown seconds.")

    p_start = sub.add_parser("start", help="Start the background helper if not already running.")
    p_start.add_argument("--idle-timeout", type=float, default=DEFAULT_IDLE_TIMEOUT, help="Idle shutdown seconds.")

    sub.add_parser("stop", help="Stop the running background helper.")
    sub.add_parser("status", help="Show opt-in config and running helper status.")

    p_cfg = sub.add_parser("config", help="Enable, disable, or inspect the opt-in direct-save setting.")
    group = p_cfg.add_mutually_exclusive_group(required=True)
    group.add_argument("--enable", action="store_true", help="Enable direct-save helper and start it now.")
    group.add_argument("--disable", action="store_true", help="Disable direct-save helper and stop if running.")
    group.add_argument("--status", action="store_true", help="Print current opt-in setting.")

    args = parser.parse_args(argv)

    if args.command == "serve":
        ports = (args.port,) if args.port is not None else PORT_RANGE
        serve_forever(ports=ports, idle_timeout=args.idle_timeout, write_state=(args.port is None))
        return 0

    if args.command == "start":
        port = find_running_port()
        if port is not None:
            print(f"[OK] Direct-save helper already running on http://{HOST}:{port}")
            return 0
        if spawn_detached(idle_timeout=args.idle_timeout):
            # Brief poll so CLI callers can report the bound port
            deadline = time.monotonic() + 2.0
            while time.monotonic() < deadline:
                port = find_running_port()
                if port is not None:
                    print(f"[OK] Direct-save helper started on http://{HOST}:{port}")
                    return 0
                time.sleep(0.05)
            print("[OK] Direct-save helper launched in background.")
            return 0
        print("[ERROR] Could not launch direct-save helper.", file=sys.stderr)
        return 1

    if args.command == "stop":
        if stop_running():
            print("[OK] Direct-save helper stopped.")
        else:
            print("[OK] Direct-save helper is not running.")
        return 0

    if args.command == "status":
        enabled = get_direct_save_enabled()
        cfg_label = "enabled" if enabled is True else "disabled" if enabled is False else "unset"
        port = find_running_port()
        run_label = f"running on http://{HOST}:{port}" if port is not None else "stopped"
        print(f"direct_save_helper: {cfg_label} ({run_label})")
        return 0

    if args.command == "config":
        if args.status:
            enabled = get_direct_save_enabled()
            print("enabled" if enabled is True else "disabled" if enabled is False else "unset")
            return 0
        if args.enable:
            path = set_direct_save_enabled(True)
            started = not is_env_disabled() and ensure_running()
            suffix = " (helper running)" if started else ""
            print(f"[OK] Direct-save helper enabled in {path}{suffix}")
            return 0
        if args.disable:
            path = set_direct_save_enabled(False)
            stop_running()
            print(f"[OK] Direct-save helper disabled in {path}")
            return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
