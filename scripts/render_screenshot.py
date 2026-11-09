#!/usr/bin/env python3
"""Headless Chromium/Edge Screenshot Renderer for Interactive HTML Flowcharts.

Renders a standalone HTML flowchart into a crisp PNG image for automated
multimodal visual review (view_image / read_file).
Zero external dependencies (uses standard library Python 3 + system Chrome/Edge).
"""

from __future__ import annotations

import argparse
import html
import json
import os
import shutil
import subprocess
import re
import sys
import tempfile
import time
import uuid
from pathlib import Path


# Chrome/Chromium first: Edge's launcher can return before the screenshot is
# written, so it is only a fallback (the wait loop in main() still handles it).
BROWSER_NAMES = (
    "chrome",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "msedge",
    "microsoft-edge",
)

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
POLL_INTERVAL = 0.2
STABLE_SECONDS = 0.6


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


def wait_for_png(path: Path, deadline: float) -> bool:
    """Wait until `path` exists and stops growing (some launchers return before writing)."""
    last_size, stable_since = -1, 0.0
    while time.monotonic() < deadline:
        if path.is_file():
            size = path.stat().st_size
            now = time.monotonic()
            if size > 0 and size == last_size:
                if now - stable_since >= STABLE_SECONDS:
                    return True
            else:
                last_size, stable_since = size, now
        time.sleep(POLL_INTERVAL)
    return False


def remove_stale_temp_files(output_path: Path) -> None:
    """Delete `<output>.<uuid>.png` leftovers from earlier interrupted renders."""
    pattern = re.compile(re.escape(output_path.name) + r"\.[0-9a-f]{32}\.png")
    for candidate in output_path.parent.iterdir():
        if pattern.fullmatch(candidate.name):
            try:
                candidate.unlink()
            except OSError:
                pass


def collect_layout_report(browser: Path, uri: str, width: int, height: int, timeout: int):
    """Open the page with ?report=1 and read the layout report it publishes into the DOM."""
    profile = tempfile.mkdtemp(prefix="flowchart_report_")
    cmd = [
        str(browser), "--headless", "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars",
        f"--user-data-dir={profile}", f"--window-size={width},{height}",
        "--virtual-time-budget=4000", "--dump-dom", f"{uri}?report=1",
    ]
    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                             encoding="utf-8", errors="replace", timeout=timeout, check=False)
        match = re.search(r'<script id="render-report" type="application/json">(\{.*?\})</script>', res.stdout, re.S)
        if not match:
            return None
        return json.loads(html.unescape(match.group(1)))
    except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError):
        return None
    finally:
        shutil.rmtree(profile, ignore_errors=True)


def _ensure_utf8_output() -> None:
    """Avoid UnicodeEncodeError on Windows consoles that default to cp1252."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def main() -> int:
    _ensure_utf8_output()
    parser = argparse.ArgumentParser(description="Render an HTML flowchart to PNG for visual inspection.")
    parser.add_argument("--input", "-i", required=True, help="Input HTML flowchart file")
    parser.add_argument("--output", "-o", help="Output PNG path (defaults to <input>.png)")
    parser.add_argument("--viewport", default="desktop", help="Viewport size preset or WIDTHxHEIGHT (default: 1440x900)")
    parser.add_argument("--timeout", type=int, default=20, help="Render timeout in seconds")
    parser.add_argument("--browser", help="Explicit path to Chrome/Edge executable")
    parser.add_argument("--no-report", action="store_true", help="Skip the in-page layout report (label overlaps, text size)")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    if not input_path.is_file():
        raise FileNotFoundError(f"Input HTML file does not exist: {input_path}")

    output_path = Path(args.output).resolve() if args.output else input_path.with_suffix(".png")
    width, height = parse_viewport(args.viewport)
    browser = Path(args.browser).resolve() if args.browser else find_browser()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    remove_stale_temp_files(output_path)
    profile = tempfile.mkdtemp(prefix="flowchart_render_")
    temp_out = output_path.with_name(f"{output_path.name}.{uuid.uuid4().hex}.png")

    cmd = [
        str(browser),
        "--headless",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--hide-scrollbars",
        f"--user-data-dir={profile}",
        f"--window-size={width},{height}",
        "--force-device-scale-factor=1",
        f"--screenshot={temp_out}",
        input_path.as_uri(),
    ]

    deadline = time.monotonic() + args.timeout
    try:
        try:
            res = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=args.timeout,
                check=False,
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"Browser did not finish within {args.timeout}s (try --timeout).")
        if res.returncode != 0:
            raise RuntimeError(f"Browser exited with code {res.returncode}: {res.stderr.strip()}")
        if not wait_for_png(temp_out, deadline):
            raise RuntimeError(
                f"Screenshot not written within {args.timeout}s by {browser.name}. "
                f"Try --browser with another Chrome/Edge path or a larger --timeout. "
                f"Browser stderr: {res.stderr.strip()[-300:]}"
            )
        raw = temp_out.read_bytes()
        if len(raw) < 24 or raw[:8] != PNG_SIGNATURE:
            raise RuntimeError("Rendered output is not a valid PNG file.")
        os.replace(temp_out, output_path)
        print(f"[OK] Rendered screenshot ({width}x{height}): {output_path}")
        if args.no_report:
            return 0
        report = collect_layout_report(browser, input_path.as_uri(), width, height, args.timeout)
        if report is None:
            print("[WARN] Layout report unavailable (the page may be an older template, or this browser returned no DOM). Review the screenshot manually.")
            return 0
        print(f"[REPORT] Fit zoom {int(report['fitScale'] * 100)}%; smallest node text {report['minNodeFontPx']}px, "
              f"smallest edge label {report['minEdgeFontPx']}px; {report['labelCount']} labels checked.")
        for msg in report["warnings"]:
            print(f"[WARN] {msg}")
        for msg in report["errors"]:
            print(f"[ERROR] {msg}")
        if report["errors"]:
            return 3
        print("[PASS] No edge-label overlaps with other labels or nodes.")
        return 0
    finally:
        if temp_out.exists():
            temp_out.unlink()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)
