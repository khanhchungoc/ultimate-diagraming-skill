"""Run a diagram type's JavaScript layout engine from Python.

The engine (assets/types/<type>/engine.js) is the single source of truth for layout: the page runs it for
Auto-Tidy and this module runs the very same file for `layout_engine.py --layout`. Node.js is used when
available; otherwise headless Chrome/Chromium loads a generated page with ?tidy. Standard library only.
"""

from __future__ import annotations

import contextvars
import json
import queue
import re
import shutil
import subprocess
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterator, Optional

from tokens import load_tokens, tokens_data

SCRIPTS_DIR = Path(__file__).resolve().parent
ASSETS_DIR = SCRIPTS_DIR.parent / "assets"
_active_session: contextvars.ContextVar[Optional["_NodeSession"]] = contextvars.ContextVar(
    "_active_layout_session", default=None
)


class EngineUnavailable(RuntimeError):
    """Neither Node.js nor Chrome/Chromium could run the layout engine."""


def _engine_path(kind: str) -> Path:
    return ASSETS_DIR / "types" / kind / "engine.js"


class _NodeSession:
    """Persistent `node run_engine.mjs --server` worker scoped to one layout_session()."""

    def __init__(self, node: str) -> None:
        self._node = node
        self._proc: Optional[subprocess.Popen[str]] = None
        self._lines: Optional[queue.Queue[Optional[str]]] = None
        self._last_tokens_json: Optional[str] = None

    def _start(self) -> None:
        proc = subprocess.Popen(
            [self._node, str(SCRIPTS_DIR / "run_engine.mjs"), "--server"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        lines: queue.Queue[Optional[str]] = queue.Queue()

        def _reader() -> None:
            try:
                assert proc.stdout is not None
                for line in iter(proc.stdout.readline, ""):
                    lines.put(line)
            finally:
                lines.put(None)

        threading.Thread(target=_reader, daemon=True).start()
        self._proc = proc
        self._lines = lines
        self._last_tokens_json = None

    def close(self) -> None:
        """Close worker stdin and wait briefly before killing it."""
        proc, self._proc, self._lines, self._last_tokens_json = self._proc, None, None, None
        if proc is None:
            return
        try:
            if proc.stdin and not proc.stdin.closed:
                proc.stdin.close()
        except OSError:
            pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()

    def run(self, kind: str, data: Dict[str, Any], timeout: int, tokens: Dict[str, Any], keep: bool) -> Optional[Dict[str, Any]]:
        """Send one layout request; drop the worker and return None on failure or timeout."""
        tdata = tokens_data(tokens)
        tjson = json.dumps(tdata, separators=(",", ":"), sort_keys=True)
        payload: Dict[str, Any] = {
            "engine": str(_engine_path(kind)),
            "diagram": data,
            "keep": keep,
        }
        try:
            if self._proc is None or self._proc.poll() is not None:
                self.close()
                self._start()
            if tjson != self._last_tokens_json:
                payload["tokens"] = tdata
            assert self._proc is not None and self._proc.stdin is not None and self._lines is not None
            self._proc.stdin.write(json.dumps(payload) + "\n")
            self._proc.stdin.flush()
            line = self._lines.get(timeout=timeout)
            if line is None:
                raise RuntimeError("Layout worker exited unexpectedly.")
            resp = json.loads(line)
            if not resp.get("ok"):
                raise RuntimeError(resp.get("error") or "Layout worker returned failure.")
            self._last_tokens_json = tjson
            return resp["diagram"]
        except Exception:
            self.close()
            return None


@contextmanager
def layout_session() -> Iterator[None]:
    """Reuse one persistent Node.js layout worker across run_layout() calls in this context."""
    if _active_session.get() is not None:
        yield
        return
    node = shutil.which("node")
    if not node:
        yield
        return
    session = _NodeSession(node)
    token = _active_session.set(session)
    try:
        yield
    finally:
        _active_session.reset(token)
        session.close()


def _via_node(kind: str, data: Dict[str, Any], timeout: int, tokens: Dict[str, Any], keep: bool = False) -> Optional[Dict[str, Any]]:
    node = shutil.which("node")
    if not node:
        return None
    proc = subprocess.run(
        [node, str(SCRIPTS_DIR / "run_engine.mjs"), str(_engine_path(kind))] + (["--keep"] if keep else []),
        input=json.dumps({"tokens": tokens_data(tokens), "diagram": data}), capture_output=True, text=True, encoding="utf-8", timeout=timeout,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Layout engine failed under Node.js:\n{proc.stderr.strip()}")
    return json.loads(proc.stdout)


def _via_browser(data: Dict[str, Any], timeout: int, browser: Optional[str], tokens: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    # Imported lazily: only the fallback needs the browser lookup and page assembly.
    from layout_engine import scaffold_html
    from render_screenshot import find_browser

    try:
        chrome = Path(browser) if browser else find_browser()
    except Exception:
        return None
    work = Path(tempfile.mkdtemp(prefix="engine_run_"))
    try:
        page = work / "page.html"
        scaffold_html(data, page, tokens=tokens)  # the page defines TOKENS (TOKENS_JS) before the engine, as Node does
        res = subprocess.run(
            [str(chrome), "--headless=new", "--disable-gpu", f"--user-data-dir={work / 'profile'}",
             "--virtual-time-budget=4000", "--dump-dom", page.as_uri() + "?tidy"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout,
        )
        match = re.search(r'<script id="tidy-result" type="application/json">(.*?)</script>', res.stdout, re.S)
        if not match:
            return None
        # Script text is not entity-escaped by the DOM serializer, so it parses as-is.
        return json.loads(match.group(1))
    finally:
        shutil.rmtree(work, ignore_errors=True)


def run_layout(kind: str, data: Dict[str, Any], timeout: int = 30, browser: Optional[str] = None,
               tokens: Optional[Dict[str, Any]] = None, keep: bool = False) -> Dict[str, Any]:
    """Return `data` with positions computed by the type's JS engine (Node first, then headless Chrome).
    `tokens` is the merged token set (the theme); the default set when omitted.
    `keep`: keep the positions `data` already has (Node only; the engine only redraws lines and labels)."""
    tokens = tokens or load_tokens()
    session = _active_session.get()
    laid = session.run(kind, data, timeout, tokens, keep) if session is not None else None
    if laid is None:
        laid = _via_node(kind, data, timeout, tokens, keep)
    if laid is None and keep:
        raise EngineUnavailable("--keep-layout needs Node.js: the browser fallback would lay everything out again.")
    if laid is None:
        # The page prints scaffold progress; the browser path only needs the positions it publishes.
        laid = _via_browser(json.loads(json.dumps(data)), timeout, browser, tokens)
    if laid is None:
        raise EngineUnavailable(
            "Layout needs Node.js (https://nodejs.org) or Chrome/Chromium to run the layout engine. "
            "Install one, or pass --browser <path-to-chrome>."
        )
    return laid
