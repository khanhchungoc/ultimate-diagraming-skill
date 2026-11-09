"""Run a diagram type's JavaScript layout engine from Python.

The engine (assets/types/<type>/engine.js) is the single source of truth for layout: the page runs it for
Auto-Tidy and this module runs the very same file for `layout_engine.py --layout`. Node.js is used when
available; otherwise headless Chrome/Chromium loads a generated page with ?tidy. Standard library only.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional

SCRIPTS_DIR = Path(__file__).resolve().parent
ASSETS_DIR = SCRIPTS_DIR.parent / "assets"


class EngineUnavailable(RuntimeError):
    """Neither Node.js nor Chrome/Chromium could run the layout engine."""


def _via_node(kind: str, data: Dict[str, Any], timeout: int) -> Optional[Dict[str, Any]]:
    node = shutil.which("node")
    if not node:
        return None
    engine = ASSETS_DIR / "types" / kind / "engine.js"
    proc = subprocess.run(
        [node, str(SCRIPTS_DIR / "run_engine.mjs"), str(engine)],
        input=json.dumps(data), capture_output=True, text=True, encoding="utf-8", timeout=timeout,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Layout engine failed under Node.js:\n{proc.stderr.strip()}")
    return json.loads(proc.stdout)


def _via_browser(data: Dict[str, Any], timeout: int, browser: Optional[str]) -> Optional[Dict[str, Any]]:
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
        scaffold_html(data, page)
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


def run_layout(kind: str, data: Dict[str, Any], timeout: int = 30, browser: Optional[str] = None) -> Dict[str, Any]:
    """Return `data` with positions computed by the type's JS engine (Node first, then headless Chrome)."""
    laid = _via_node(kind, data, timeout)
    if laid is None:
        # The page prints scaffold progress; the browser path only needs the positions it publishes.
        laid = _via_browser(json.loads(json.dumps(data)), timeout, browser)
    if laid is None:
        raise EngineUnavailable(
            "Layout needs Node.js (https://nodejs.org) or Chrome/Chromium to run the layout engine. "
            "Install one, or pass --browser <path-to-chrome>."
        )
    return laid
