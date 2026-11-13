#!/usr/bin/env python3
"""Check that an installed ultimate-diagram skill can run: its files, Python, a browser, Node.js.

Run by the installers after copying or linking the skill. Exit 0 when the skill can run (warnings
allowed), 1 when something it needs is missing. Standard library only; must run on Python 3.9.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
MIN_PYTHON = (3, 9)
MIN_NODE = 18

REQUIRED_FILES = [
    "SKILL.md",
    "references/types/flowchart.md",
    "references/types/sequence.md",
    "references/examples/example-flowchart.json",
    "references/examples/example-flowchart-phases.json",
    "references/examples/example-sequence.json",
    "scripts/layout_engine.py",
    "scripts/engine_runner.py",
    "scripts/audit_sequence.py",
    "scripts/render_screenshot.py",
    "scripts/run_engine.mjs",
    "assets/shell/shell.html",
    "assets/shell/shell.css",
    "assets/shell/shell.js",
    "assets/types/flowchart/engine.js",
    "assets/types/sequence/engine.js",
]


def node_major(node: str) -> int:
    try:
        out = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return 0
    m = re.match(r"v(\d+)", out.strip())
    return int(m.group(1)) if m else 0


def main() -> int:
    ok = True
    print(f"==> Checking ultimate-diagram at {SKILL_DIR}")

    missing = [f for f in REQUIRED_FILES if not (SKILL_DIR / f).is_file()]
    if missing:
        ok = False
        print(f"[MISSING] Skill files not installed: {', '.join(missing)}. Re-run the installer.")
    else:
        print(f"[OK] Skill files complete ({len(REQUIRED_FILES)} checked)")

    py = ".".join(map(str, sys.version_info[:3]))
    if sys.version_info[:2] < MIN_PYTHON:
        ok = False
        print(f"[MISSING] Python {py} is too old; install Python {MIN_PYTHON[0]}.{MIN_PYTHON[1]}+.")
    else:
        print(f"[OK] Python {py}")

    sys.dont_write_bytecode = True  # leave no __pycache__ in the installed skill
    sys.path.insert(0, str(SKILL_DIR / "scripts"))
    try:
        from render_screenshot import find_browser
        browser = find_browser()
    except Exception:  # FileNotFoundError when no browser; ImportError if the file is missing
        browser = None
    if browser:
        print(f"[OK] Browser for screenshots: {browser}")
    else:
        ok = False
        print("[MISSING] Chrome, Chromium or Edge: needed to render and check every diagram. Install one.")

    node = shutil.which("node")
    major = node_major(node) if node else 0
    if major >= MIN_NODE:
        print(f"[OK] Node.js v{major}")
    elif browser:
        print(f"[INFO] Node.js {MIN_NODE}+ not found; layout will run in the browser instead (slower).")
    else:
        print(f"[MISSING] Node.js {MIN_NODE}+ (or a browser) is needed to lay out diagrams.")

    print("[READY] ultimate-diagram can run." if ok else
          "[NOT READY] Install what is marked [MISSING] above, then re-run this check.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
