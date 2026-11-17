#!/usr/bin/env python3
"""Headless Chromium/Edge renderer and layout checker for interactive HTML flowcharts.

1. Opens the page in report mode and measures it (edge-label overlaps, rendered text
   size at the "Fit" zoom, natural diagram size).
2. Captures a clean PNG: editing controls hidden, cropped to the diagram, 1.5x by default.

Exit codes: 0 ok, 1 render failure. Edge-label overlaps and text below --min-text-px are layout findings: they
print as "[INFO] Layout: ..." (to report, not to fix in the JSON) and never fail the run. Truncated labels are data
problems and print as [WARN].
Zero external dependencies (standard library Python 3 + system Chrome/Edge).
"""

from __future__ import annotations

import argparse
import base64
import contextlib
import functools
import http.server
import json
import math
import os
import re
import shutil
import struct
import sys
import threading
import time
import urllib.parse
import uuid
from pathlib import Path


# Chrome/Chromium first: Edge's launcher can return before the screenshot is
# written, so it is only a fallback (the wait loop below still handles it).
BROWSER_NAMES = (
    "chrome",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "msedge",
    "microsoft-edge",
)

LAYOUT_NOTE = "report it; do not change the JSON for it"

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def find_browser() -> Path:
    for name in BROWSER_NAMES:
        executable = shutil.which(name)
        if executable:
            return Path(executable)

    locations = []
    bases = [
        os.environ.get("ProgramFiles"),
        os.environ.get("ProgramFiles(x86)"),
        os.environ.get("LOCALAPPDATA"),
    ]
    for base in bases:
        if base:
            locations.append(Path(base) / "Google/Chrome/Application/chrome.exe")
    for base in bases:
        if base:
            locations.append(Path(base) / "Microsoft/Edge/Application/msedge.exe")
    locations.extend((
        Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        Path("/Applications/Chromium.app/Contents/MacOS/Chromium"),
        Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
        Path("/usr/bin/google-chrome"),
        Path("/usr/bin/chromium"),
        Path("/usr/bin/microsoft-edge"),
        Path("/snap/bin/chromium"),
    ))
    for location in locations:
        if location.is_file():
            return location
    raise FileNotFoundError(
        "No Chromium or Edge browser executable found. Install Chrome/Edge or pass --browser PATH."
    )


def parse_viewport(value: str) -> tuple[int, int]:
    presets = {
        "desktop": (1440, 900),
        "wide": (1920, 1080),
        "compact": (1280, 800),
    }
    v = value.strip().lower()
    if v in presets:
        return presets[v]
    if "x" in v:
        parts = v.split("x")
        if len(parts) == 2 and all(p.isdigit() and int(p) > 0 for p in parts):
            return int(parts[0]), int(parts[1])
    raise ValueError("Invalid viewport. Use 'desktop', 'wide', 'compact', or WIDTHxHEIGHT (e.g. 1440x900).")


def _ensure_utf8_output() -> None:
    """Avoid UnicodeEncodeError on Windows consoles that default to cp1252."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def open_page(call, uri: str, width: int, height: int, scale: float, timeout: int) -> None:
    """Navigate a DevTools session (measure_font.chrome_session) to `uri` at a window size and wait for it to load.
    A one-shot `--dump-dom` or `--screenshot` run never exits in some sandboxes, DevTools does not."""
    call("Emulation.setDeviceMetricsOverride", {"width": width, "height": height, "deviceScaleFactor": scale, "mobile": False})
    call("Page.enable")
    call("Page.navigate", {"url": uri})
    call.settimeout(timeout)
    deadline = time.monotonic() + timeout
    # A stalled third-party stylesheet (the Google Fonts link, offline) must not hold the report back: go on after half the time.
    while time.monotonic() < deadline - timeout / 2 and not any(m == "Page.loadEventFired" for m, _ in call.events):
        call("Runtime.evaluate", {"expression": "1"})
        time.sleep(0.1)


def page_value(call, expression: str, await_promise: bool = False):
    res = call("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": await_promise})
    if "exceptionDetails" in res:
        raise RuntimeError(res["exceptionDetails"].get("exception", {}).get("description", "script error in the page"))
    return res["result"].get("value")


def axe_path() -> Path | None:
    """axe-core is a dev dependency (npm install in the repo); an installed skill has none, so the step is skipped."""
    p = Path(__file__).resolve().parent.parent / "node_modules" / "axe-core" / "axe.min.js"
    return p if p.is_file() else None


def run_axe(call, axe: Path) -> dict:
    """Violations axe-core finds on the open page, in light and then dark mode: {mode: [(id, impact, nodes, first target)]}."""
    page_value(call, axe.read_text(encoding="utf-8"))
    out = {}
    for mode in ("light", "dark"):
        page_value(call, f"document.documentElement.setAttribute('data-theme', '{mode}')")
        found = page_value(call, "axe.run(document, {resultTypes: ['violations'], runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']}).then(r => r.violations.map(v => "
                                 "[v.id, v.impact, v.nodes.length, (v.nodes[0].target || []).join(' ')]))", True)
        out[mode] = found
    return out


def collect_layout_report(browser: Path, uri: str, width: int, height: int, timeout: int, min_px: float, with_axe: bool = False):
    """Open the page in report mode and read the layout report it publishes into the DOM (and, when asked, run axe).
    Returns (report or None, axe result or None)."""
    from measure_font import chrome_session  # not at the top: measure_font imports find_browser from here
    try:
        with chrome_session(str(browser), timeout, (f"--window-size={width},{height}", "--hide-scrollbars")) as call:
            open_page(call, f"{uri}?report&present&minpx={min_px}", width, height, 1, timeout)
            deadline = time.monotonic() + timeout / 2
            text = None
            while text is None and time.monotonic() < deadline:
                text = page_value(call, "(document.getElementById('render-report') || {}).textContent || null")
                time.sleep(0.1)
            axe = axe_path() if with_axe and text else None
            try:
                return json.loads(text) if text else None, (run_axe(call, axe) if axe else None)
            except RuntimeError as exc:  # axe failing must not lose the layout report
                print(f"[WARN] axe-core step failed: {exc}")
                return json.loads(text), None
    except (RuntimeError, ConnectionError, OSError, json.JSONDecodeError):
        return None, None


def _is_split_artifact(input_path: Path) -> bool:
    """Return True when the input HTML loads an external app.js or relies on a sibling diagram.json."""
    text = input_path.read_text(encoding="utf-8", errors="replace")
    return '<script src="app.js">' in text or (
        '<script id="diagram-data"' not in text and input_path.with_name("diagram.json").is_file()
    )


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    """Serve split artifact assets quietly with reliable MIME types on Windows."""
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
    }

    def log_message(self, format: str, *args) -> None:
        pass


@contextlib.contextmanager
def _serve_dir(directory: Path):
    """Serve `directory` over a loopback HTTP server in a daemon thread until the context exits."""
    handler = functools.partial(_QuietHandler, directory=str(directory))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


def take_screenshot(browser: Path, uri: str, width: int, height: int, scale: float,
                    output_path: Path, timeout: int, wait_ready: bool = False) -> None:
    from measure_font import chrome_session
    with chrome_session(str(browser), timeout, (f"--window-size={width},{height}", "--hide-scrollbars")) as call:
        open_page(call, uri, width, height, scale, timeout)
        if wait_ready:
            # Split artifacts fetch('diagram.json') after load; wait briefly for diagramReady before capturing.
            deadline = time.monotonic() + 3.0
            while time.monotonic() < deadline:
                if page_value(call, "document.documentElement && document.documentElement.dataset.diagramReady === '1'"):
                    break
                time.sleep(0.05)
            else:
                time.sleep(0.5)
        else:
            time.sleep(0.5)  # the page renders after load
        raw = base64.b64decode(call("Page.captureScreenshot", {"format": "png"})["data"])
    if len(raw) < 24 or raw[:8] != PNG_SIGNATURE:
        raise RuntimeError("Rendered output is not a valid PNG file.")
    temp_out = output_path.with_name(f"{output_path.name}.{uuid.uuid4().hex}.png")
    try:
        temp_out.write_bytes(raw)
        os.replace(temp_out, output_path)
    finally:
        temp_out.unlink(missing_ok=True)


def png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as fh:
        head = fh.read(24)
    return struct.unpack(">II", head[16:24])


def main() -> int:
    _ensure_utf8_output()
    parser = argparse.ArgumentParser(description="Render an HTML flowchart to PNG and check its layout.")
    parser.add_argument("--input", "-i", required=True, help="Input HTML flowchart file")
    parser.add_argument("--output", "-o", help="Output PNG path (defaults to <input>.png)")
    parser.add_argument("--viewport", default="wide",
                        help="Screen size the diagram is judged at: wide (1920x1080), desktop (1440x900), compact, or WIDTHxHEIGHT (default: wide)")
    parser.add_argument("--timeout", type=int, default=20, help="Render timeout in seconds")
    parser.add_argument("--browser", help="Explicit path to Chrome/Edge executable")
    parser.add_argument("--scale", type=float, default=1.5, help="Screenshot device scale factor (default: 1.5)")
    parser.add_argument("--max-width", type=int, default=1600,
                        help="Widest the cropped screenshot is laid out, in CSS px (default: 1600)")
    parser.add_argument("--min-text-px", type=float, default=11.0,
                        help="Report (an [INFO] Layout line) text that renders smaller than this at Fit zoom (default: 11)")
    parser.add_argument("--full-window", action="store_true",
                        help="Screenshot the whole viewport instead of cropping to the diagram")
    parser.add_argument("--no-report", action="store_true",
                        help="Skip the layout report (label overlaps, text size); screenshot only")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    if not input_path.is_file():
        raise FileNotFoundError(f"Input HTML file does not exist: {input_path}")

    output_path = Path(args.output).resolve() if args.output else input_path.with_suffix(".png")
    width, height = parse_viewport(args.viewport)
    browser = Path(args.browser).resolve() if args.browser else find_browser()
    is_split = _is_split_artifact(input_path)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    ctx = _serve_dir(input_path.parent) if is_split else contextlib.nullcontext()
    with ctx as base_url:
        uri = f"{base_url}/{urllib.parse.quote(input_path.name)}" if is_split else input_path.as_uri()
        report, axe = None, None
        if not args.no_report:
            for _attempt in range(2):  # the first browser launch occasionally returns no DOM
                report, axe = collect_layout_report(browser, uri, width, height, args.timeout, args.min_text_px, True)
                if report is not None:
                    break

        shot_w, shot_h, query = width, height, "?present"
        cropped = False
        if report and report.get("natural") and report["natural"].get("w") and not args.full_window:
            nat = report["natural"]
            crop_w = min(int(nat["w"]), args.max_width)
            crop_h = math.ceil(nat["h"] * crop_w / nat["w"])
            # In screenshot mode the page viewport equals the window, so no offset is needed.
            shot_w, shot_h, query, cropped = crop_w, crop_h, f"?capture&w={crop_w}", True

        take_screenshot(browser, uri + query, shot_w, shot_h, args.scale, output_path, args.timeout, wait_ready=is_split)
    px_w, px_h = png_size(output_path)
    mode = "cropped to diagram" if cropped else "full window"
    print(f"[OK] Rendered screenshot ({px_w}x{px_h}px, {args.scale:g}x, {mode}): {output_path}")

    if args.no_report:
        return 0
    if report is None:
        print("[INFO] Layout: report unavailable (older template, or this browser returned no DOM), "
              "so label overlaps were not checked (report it; do not change the JSON for it).")
        return 0

    for mode, found in (axe or {}).items():
        for rule, impact, count, target in found:
            print(f"[INFO] Layout: axe ({mode} mode): {rule} ({impact}), {count} element{'s' if count != 1 else ''}, first {target} ({LAYOUT_NOTE})")
        if not found:
            print(f"[PASS] axe ({mode} mode): no violations.")
    for msg in report.get("warnings", []):
        # Truncated text the reader can still hover to read is layout; anything else is data to shorten
        print(f"[INFO] Layout: {msg} ({LAYOUT_NOTE})" if "shows on hover" in msg else f"[WARN] {msg}")
    for msg in report["errors"]:
        print(f"[INFO] Layout: {msg.rstrip('.')} ({LAYOUT_NOTE})")
    # Small text at the fit zoom: only worth reporting on a diagram meant for one screen (12 nodes or fewer);
    # a larger one is read with pan and zoom
    if report.get("nodeCount", 0) <= 12:
        for msg in report.get("legibility", []):
            print(f"[INFO] Layout: {msg.rstrip('.')} ({LAYOUT_NOTE})")
    if not report["errors"]:
        print("[PASS] No edge-label overlaps detected.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)
