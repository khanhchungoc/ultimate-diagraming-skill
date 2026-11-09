#!/usr/bin/env python3
"""Build the viewable example pages samples/example-<name>.html from samples/example-<name>.json.

The pages are generated output (shell + type plugin + laid-out data), so they go stale whenever the shell, a
plugin or an engine changes. Rebuild them after such a change:

  python dev/build_examples.py           rebuild every example page
  python dev/build_examples.py --check   exit 2 if any page is missing or out of date (does not write)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from engine_runner import run_layout  # noqa: E402
from layout_engine import assemble_page, normalize_diagram_type  # noqa: E402


def build(source: Path) -> str:
    data = normalize_diagram_type(json.loads(source.read_text(encoding="utf-8")))
    return assemble_page(data["diagramType"], run_layout(data["diagramType"], data))


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(description="Build samples/example-*.html from the example JSON files.")
    parser.add_argument("--check", action="store_true", help="Report pages that are missing or stale; write nothing")
    args = parser.parse_args()

    stale = False
    for source in sorted((ROOT / "samples").glob("example-*.json")):
        target = source.with_suffix(".html")
        page = build(source)
        # Compare as text so a CRLF checkout does not look stale.
        current = target.read_text(encoding="utf-8") if target.exists() else None
        if args.check:
            ok = current == page
            stale |= not ok
            print(f"[{'PASS' if ok else 'STALE'}] {target.relative_to(ROOT)}")
        else:
            target.write_text(page, encoding="utf-8", newline="\n")
            print(f"[OK] {target.relative_to(ROOT)} ({len(page) // 1024} KB)")
    return 2 if stale else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)
