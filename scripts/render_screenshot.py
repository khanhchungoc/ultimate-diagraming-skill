#!/usr/bin/env python3
"""Headless Chromium/Edge renderer and layout checker for interactive HTML flowcharts.

1. Opens the page in report mode and measures it (edge-label overlaps, rendered text
   size at the "Fit" zoom, natural diagram size).
2. Captures a clean PNG: editing controls hidden, cropped to the diagram, 2x by default.

Exit codes: 0 ok, 1 render failure, 3 edge-label overlap, 4 text below --min-text-px (diagrams of 12 nodes
or fewer; larger diagrams are read with pan and zoom, so for them it is only an [INFO] line).
Zero external dependencies (standard library Python 3 + system Chrome/Edge).
"""

from __future__ import annotations

import argparse
import html
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
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

# Diagrams above this size are explored with pan and zoom, so small text at Fit is not an error for them.
SINGLE_SCREEN_MAX_NODES = 12

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
    """Wait until `path` exists and finishes writing (checks PNG IEND trailer or size stability)."""
    last_size, stable_since = -1, 0.0
    while time.monotonic() < deadline:
        if path.is_file():
            try:
                size = path.stat().st_size
                if size >= 24:
                    with path.open("rb") as fh:
                        fh.seek(max(0, size - 12))
                        if fh.read().endswith(b"IEND\xaeB`\x82"):
                            return True
            except OSError:
                size = 0
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


def _ensure_utf8_output() -> None:
    """Avoid UnicodeEncodeError on Windows consoles that default to cp1252."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def collect_layout_report(browser: Path, uri: str, width: int, height: int, timeout: int, min_px: float):
    """Open the page in report mode and read the layout report it publishes into the DOM."""
    profile = tempfile.mkdtemp(prefix="flowchart_report_")
    cmd = [
        str(browser), "--headless", "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars",
        f"--user-data-dir={profile}", f"--window-size={width},{height}",
        "--virtual-time-budget=500", "--dump-dom", f"{uri}?report&present&minpx={min_px}",
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


def take_screenshot(browser: Path, uri: str, width: int, height: int, scale: float,
                    output_path: Path, timeout: int) -> None:
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
        f"--force-device-scale-factor={scale:g}",
        "--virtual-time-budget=500",
        f"--screenshot={temp_out}",
        uri,
    ]
    deadline = time.monotonic() + timeout
    try:
        try:
            res = subprocess.run(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                encoding="utf-8", errors="replace", timeout=timeout, check=False,
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"Browser did not finish within {timeout}s (try --timeout).")
        if res.returncode != 0:
            raise RuntimeError(f"Browser exited with code {res.returncode}: {res.stderr.strip()}")
        if not wait_for_png(temp_out, deadline):
            raise RuntimeError(
                f"Screenshot not written within {timeout}s by {browser.name}. "
                f"Try --browser with another Chrome/Edge path or a larger --timeout. "
                f"Browser stderr: {res.stderr.strip()[-300:]}"
            )
        raw = temp_out.read_bytes()
        if len(raw) < 24 or raw[:8] != PNG_SIGNATURE:
            raise RuntimeError("Rendered output is not a valid PNG file.")
        os.replace(temp_out, output_path)
    finally:
        if temp_out.exists():
            temp_out.unlink()
        shutil.rmtree(profile, ignore_errors=True)


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
    parser.add_argument("--scale", type=float, default=2.0, help="Screenshot device scale factor (default: 2)")
    parser.add_argument("--max-width", type=int, default=1600,
                        help="Widest the cropped screenshot is laid out, in CSS px (default: 1600)")
    parser.add_argument("--min-text-px", type=float, default=11.0,
                        help="Fail (exit 4) when text renders smaller than this at Fit zoom on --viewport, for diagrams of 12 nodes or fewer; "
                             "larger ones only get an [INFO] line (default: 11)")
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
    uri = input_path.as_uri()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    remove_stale_temp_files(output_path)

    report = None
    if not args.no_report:
        for _attempt in range(2):  # the first browser launch occasionally returns no DOM
            report = collect_layout_report(browser, uri, width, height, args.timeout, args.min_text_px)
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

    take_screenshot(browser, uri + query, shot_w, shot_h, args.scale, output_path, args.timeout)
    px_w, px_h = png_size(output_path)
    mode = "cropped to diagram" if cropped else "full window"
    print(f"[OK] Rendered screenshot ({px_w}x{px_h}px, {args.scale:g}x, {mode}): {output_path}")

    if args.no_report:
        return 0
    if report is None:
        print("[WARN] Layout report unavailable (older template, or this browser returned no DOM). "
              "Review the screenshot manually.")
        return 0

    print(f"[REPORT] Fit zoom {int(report['fitScale'] * 100)}% on {width}x{height}; "
          f"smallest node text {report['minNodeFontPx']}px, smallest edge label {report['minEdgeFontPx']}px "
          f"(minimum {args.min_text_px:g}px); {report['labelCount']} labels checked.")
    for msg in report.get("warnings", []):
        print(f"[WARN] {msg}")
    for msg in report["errors"]:
        print(f"[ERROR] {msg}")
    # Small text is a defect in a diagram meant to be read on one screen, and expected in a large one
    # that is explored with pan and zoom (SKILL.md: more than 12 nodes). Only the first fails the run.
    legibility = report.get("legibility", [])
    single_screen = report.get("nodeCount", 0) <= SINGLE_SCREEN_MAX_NODES
    for msg in legibility:
        if single_screen:
            print(f"[ERROR] {msg} Shorten labels, drop steps or columns, or split the diagram.")
        else:
            print(f"[INFO] {msg} Large diagram ({report['nodeCount']} nodes): read it with pan and zoom.")
    if report["errors"]:
        return 3
    print("[PASS] No edge-label overlaps detected.")
    if legibility and single_screen:
        return 4
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)
