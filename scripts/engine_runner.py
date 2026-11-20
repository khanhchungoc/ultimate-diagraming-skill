"""Run a diagram type's JavaScript layout engine from Python.

The engine (assets/types/<type>/engine.js) is the single source of truth for layout: the page runs it for
Auto-Tidy and this module runs the very same file for `layout_engine.py --layout`. Node.js is used when
available; otherwise headless Chrome/Chromium loads a generated page with ?tidy. Standard library only.
"""

from __future__ import annotations

import contextvars
import json
import os
import queue
import shutil
import subprocess
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterator, Optional

from tokens import load_tokens, tokens_data

SCRIPTS_DIR = Path(__file__).resolve().parent
ASSETS_DIR = SCRIPTS_DIR.parent / "assets"
ROUTER_PATH = ASSETS_DIR / "shell" / "ortho-router.js"   # the shared orthogonal router, loaded ahead of every engine
_active_session: contextvars.ContextVar[Optional["_NodeSession"]] = contextvars.ContextVar(
    "_active_layout_session", default=None
)


class EngineUnavailable(RuntimeError):
    """Neither Node.js nor Chrome/Chromium could run the layout engine."""


def _engine_path(kind: str) -> Path:
    return ASSETS_DIR / "types" / kind / "engine.js"


def _utf8_env() -> Dict[str, str]:
    """Ensure child processes inherit UTF-8 stdio settings on Windows."""
    return {**os.environ, "PYTHONIOENCODING": "utf-8"}


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
            errors="replace",
            env=_utf8_env(),
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
        input=json.dumps({"tokens": tokens_data(tokens), "diagram": data}), capture_output=True, text=True,
        encoding="utf-8", errors="replace", env=_utf8_env(), timeout=timeout,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Layout engine failed under Node.js:\n{proc.stderr.strip()}")
    return json.loads(proc.stdout)


def _via_browser(data: Dict[str, Any], timeout: int, browser: Optional[str], tokens: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    # Use a DevTools session rather than one-shot --dump-dom, which hangs in some sandboxes.
    from measure_font import chrome_session
    from render_screenshot import find_browser, page_value

    try:
        chrome = Path(browser) if browser else find_browser()
    except Exception:
        return None
    kind = data.get("diagramType") or "flowchart"
    engine_src = ROUTER_PATH.read_text(encoding="utf-8") + "\n" + _engine_path(kind).read_text(encoding="utf-8")
    payload = json.dumps({"tokens": tokens_data(tokens), "diagram": data})
    js = (
        f"(() => {{\nconst __req = {payload};\nconst TOKENS = __req.tokens;\n"
        f"{engine_src}\nlayoutDiagram(__req.diagram);\nreturn JSON.stringify(__req.diagram);\n}})()"
    )
    try:
        with chrome_session(str(chrome), timeout, ()) as call:
            text = page_value(call, js)
    except (RuntimeError, ConnectionError, OSError):
        return None
    return json.loads(text)


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


# --- Mermaid reader and writer ------------------------------------------------------------------------------------------
# The same JavaScript the page uses (assets/shell/mermaid-flow.js + assets/types/<kind>/mermaid.js). With Node.js it runs
# through scripts/mermaid_io.mjs (one process per call); without it, in headless Chrome like the layout engines.
MERMAID_KINDS = ("flowchart", "usecase", "sequence", "erd")

# Runs in Chrome after the sources; the same three operations as mermaid_io.mjs (`from`, `to`, `ids`).
_MERMAID_RUN_JS = """
const req = %s;
if (req.op === 'from') return JSON.stringify(fromMermaid(req.payload));
if (req.op === 'to') return JSON.stringify(toMermaid(req.payload, { palette: req.palette }));
const used = new Set(), map = {};
['lanes', 'nodes', 'subjects', 'actors', 'useCases', 'entities', 'participants'].forEach((k) => (req.payload[k] || []).forEach((it) => {
  if (it && typeof it.id === 'string' && !(it.id in map)) map[it.id] = mmdSafeId(it.id, used);
}));
return JSON.stringify(map);
"""


def _mermaid_via_node(op: str, kind: str, payload: Any, palette: Optional[list], timeout: int) -> Any:
    node = shutil.which("node")
    if not node:
        return None
    cmd = [node, str(SCRIPTS_DIR / "mermaid_io.mjs"), op, kind] + (["--palette", ",".join(palette)] if palette else [])
    proc = subprocess.run(cmd, input=payload if op == "from" else json.dumps(payload), capture_output=True, text=True,
                          encoding="utf-8", errors="replace", env=_utf8_env(), timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "Mermaid conversion failed under Node.js.")
    return proc.stdout if op == "to" else json.loads(proc.stdout)


def _mermaid_via_browser(op: str, kind: str, payload: Any, palette: Optional[list], timeout: int, browser: Optional[str]) -> Any:
    # A DevTools session, not a one-shot --dump-dom: that never exits in some sandboxes (see render_screenshot.open_page).
    from measure_font import chrome_session
    from render_screenshot import find_browser, page_value

    try:
        chrome = Path(browser) if browser else find_browser()
    except Exception:
        return None
    sources = "\n".join((ASSETS_DIR / f).read_text(encoding="utf-8") for f in ("shell/mermaid-flow.js", f"types/{kind}/mermaid.js"))
    req = json.dumps({"op": op, "payload": payload, "palette": palette})
    try:
        with chrome_session(str(chrome), timeout, ()) as call:
            text = page_value(call, "(() => {\n" + sources + _MERMAID_RUN_JS % req + "})()")
    except (RuntimeError, ConnectionError, OSError) as exc:
        raise RuntimeError(f"Mermaid conversion failed in the browser: {exc}")
    out = json.loads(text)
    return out


def run_mermaid(op: str, kind: str, payload: Any, timeout: int = 30, browser: Optional[str] = None,
                palette: Optional[list] = None) -> Any:
    """`from`: Mermaid text -> {data, infos, warnings}. `to`: diagram JSON -> Mermaid text (`palette`: hex colours of the
    slots, for the classDef lines). `ids`: diagram JSON -> {id: id as the writer spells it}. Node first, then Chrome."""
    out = _mermaid_via_node(op, kind, payload, palette, timeout)
    if out is None:
        out = _mermaid_via_browser(op, kind, payload, palette, timeout, browser)
    if out is None:
        raise EngineUnavailable(
            "Mermaid conversion needs Node.js (https://nodejs.org) or Chrome/Chromium. "
            "Install one, or pass --browser <path-to-chrome>."
        )
    return out.rstrip("\n") + "\n" if op == "to" else out
