#!/usr/bin/env python3
"""Check that the in-browser Auto-Tidy matches the Python layout engine.

The layout engine exists twice: scripts/layout_engine.py (CLI) and runLayoutEngine() in
assets/flowchart-template.html (the Auto-Tidy button). This script lays each diagram out with
Python, scrambles the positions, loads the page in headless Chrome/Edge with ?tidy (which runs
Auto-Tidy on load), and compares every node position and lane height. Run it after changing
either copy.

Usage:
  python scripts/check_tidy_parity.py [diagram.json ...]   (default: assets/example-flowchart.json)
Exit codes: 0 identical, 1 error, 2 mismatch.
"""

from __future__ import annotations

import argparse
import copy
import html
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from layout_engine import SwimlaneLayoutEngine, scaffold_html  # noqa: E402
from render_screenshot import find_browser  # noqa: E402

SKILL_DIR = Path(__file__).resolve().parent.parent
TEMPLATE = SKILL_DIR / "assets" / "flowchart-template.html"


def browser_layout(browser: Path, data: dict, timeout: int) -> dict:
    scrambled = copy.deepcopy(data)
    for i, node in enumerate(scrambled["nodes"]):
        node["x"], node["y"] = 17 * i, 5 * i  # the engine must ignore incoming positions
    work = Path(tempfile.mkdtemp(prefix="tidy_parity_"))
    try:
        page = work / "page.html"
        scaffold_html(TEMPLATE, scrambled, page)
        cmd = [
            str(browser), "--headless", "--disable-gpu", "--disable-dev-shm-usage",
            f"--user-data-dir={work / 'profile'}", "--window-size=1920,1080",
            "--virtual-time-budget=6000", "--dump-dom", page.as_uri() + "?tidy",
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                             encoding="utf-8", errors="replace", timeout=timeout, check=False)
        match = re.search(r'<script id="tidy-result" type="application/json">(\{.*?\})</script>', res.stdout, re.S)
        if not match:
            raise RuntimeError("Browser returned no tidy result (Edge returns no DOM; use Chrome or --browser).")
        return json.loads(html.unescape(match.group(1)))
    finally:
        shutil.rmtree(work, ignore_errors=True)


def compare(name: str, data: dict, browser: Path, timeout: int) -> list[str]:
    py = SwimlaneLayoutEngine(copy.deepcopy(data))
    py.compute_layout()
    js = browser_layout(browser, data, timeout)
    problems = []
    for node in py.nodes:
        got = js["nodes"].get(node["id"])
        if got is None:
            problems.append(f"{name}: node {node['id']} missing from browser result")
        elif (got["x"], got["y"]) != (node["x"], node["y"]):
            problems.append(f"{name}: node {node['id']} python=({node['x']},{node['y']}) browser=({got['x']},{got['y']})")
    for lane in py.lanes:
        if js["lanes"].get(lane["id"]) != lane.get("height"):
            problems.append(f"{name}: lane {lane['id']} height python={lane.get('height')} browser={js['lanes'].get(lane['id'])}")
    return problems


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(description="Compare browser Auto-Tidy with the Python layout engine.")
    parser.add_argument("diagrams", nargs="*", help="Diagram JSON files (default: assets/example-flowchart.json)")
    parser.add_argument("--browser", help="Path to Chrome/Chromium (Edge cannot return the page DOM)")
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args()

    files = [Path(f) for f in args.diagrams] or [SKILL_DIR / "assets" / "example-flowchart.json"]
    browser = Path(args.browser) if args.browser else find_browser()
    failed = False
    for path in files:
        data = json.loads(path.read_text(encoding="utf-8"))
        problems = compare(path.name, data, browser, args.timeout)
        if problems:
            failed = True
            print(f"[MISMATCH] {path.name}")
            for line in problems:
                print(f"  - {line}")
        else:
            print(f"[PASS] {path.name}: browser Auto-Tidy matches the Python layout ({len(data['nodes'])} nodes)")
    return 2 if failed else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)
