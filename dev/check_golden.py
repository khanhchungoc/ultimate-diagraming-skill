#!/usr/bin/env python3
"""Regression check for the layout engine and the audit, against frozen golden outputs.

For every dev/fixtures/<type>/*.json it runs the diagram type's JavaScript engine (the same file the page uses
for Auto-Tidy) and compares the full laid-out data with dev/fixtures/<type>/golden/<name>.json, then audits the
result with `layout_engine.py --verify` logic (score >= 90, no overlaps/penetrations/overflows).

Usage:
  python dev/check_golden.py            check all fixtures
  python dev/check_golden.py --update   rewrite the goldens after an intentional engine change (review the diff)
Exit codes: 0 all match, 1 error, 2 mismatch or audit failure.
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from engine_runner import run_layout  # noqa: E402
from layout_engine import AUDITS, normalize_diagram_type  # noqa: E402


def differences(a, b, path=""):
    """Yield human-readable differences; numbers compare by value (296 == 296.0)."""
    if isinstance(a, dict) and isinstance(b, dict):
        for key in sorted(set(a) | set(b)):
            if key not in a or key not in b:
                yield f"{path}/{key}: only in {'expected' if key in a else 'actual'}"
            else:
                yield from differences(a[key], b[key], f"{path}/{key}")
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            yield f"{path}: length {len(a)} vs {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            yield from differences(x, y, f"{path}[{i}]")
    elif a != b:
        yield f"{path}: expected {a!r}, got {b!r}"


def twin_problems(path: Path, data: dict, laid: dict) -> list:
    """A connector fixture has an unsplit twin (dev/make_unsplit.py): the same diagram with every connector pair
    joined back into the whole arrow. Splitting an arrow must never move a step, so every step (and every lane
    height) must come out identical, left to right and top to bottom."""
    twin_path = path.parent / "unsplit" / path.name
    if not twin_path.is_file():
        return []
    twin = json.loads(twin_path.read_text(encoding="utf-8"))
    problems = []
    for direction in ("LR", "TB"):
        a, b = copy.deepcopy(data), copy.deepcopy(twin)
        if direction == "TB":
            a["direction"] = b["direction"] = "TB"
        la = laid if direction == "LR" and data.get("direction") != "TB" else run_layout("flowchart", a)
        lb = run_layout("flowchart", b)
        where = {n["id"]: (n.get("laneId"), n.get("x"), n.get("y")) for n in lb["nodes"]}
        for n in la["nodes"]:
            if n["id"] in where and (n.get("laneId"), n.get("x"), n.get("y")) != where[n["id"]]:
                problems.append(f"{direction}: step {n['id']} at {(n.get('laneId'), n.get('x'), n.get('y'))}, "
                                f"unsplit twin has it at {where[n['id']]}")
        if [l.get("height") for l in la["lanes"]] != [l.get("height") for l in lb["lanes"]]:
            problems.append(f"{direction}: lane heights differ from the unsplit twin")
    return problems


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(description="Check layout engine output against golden files.")
    parser.add_argument("--update", action="store_true", help="Rewrite golden files from the current engine")
    args = parser.parse_args()

    fixtures = sorted((ROOT / "dev" / "fixtures").glob("*/*.json"))
    if not fixtures:
        print("[ERROR] no fixtures found in dev/fixtures", file=sys.stderr)
        return 1
    failed = False
    for path in fixtures:
        data = normalize_diagram_type(json.loads(path.read_text(encoding="utf-8")))
        laid = run_layout(data["diagramType"], copy.deepcopy(data))
        golden_dir = path.parent / "golden"
        golden_dir.mkdir(exist_ok=True)
        golden_path = golden_dir / path.name
        if args.update:
            golden_path.write_text(json.dumps(laid, indent=2) + "\n", encoding="utf-8")
            print(f"[UPDATED] {path.parent.name}/{path.name}")
            continue
        problems = list(differences(json.loads(golden_path.read_text(encoding="utf-8")), laid))
        problems += twin_problems(path, data, laid)
        report = AUDITS[data["diagramType"]](copy.deepcopy(laid)).verify_collisions()
        if not report["passed"]:
            problems.append(f"audit failed: score {report['score']}, issues {report['issues']}")
        if problems:
            failed = True
            print(f"[MISMATCH] {path.parent.name}/{path.name}")
            for line in problems[:8]:
                print(f"  - {line}")
        else:
            print(f"[PASS] {path.parent.name}/{path.name}: matches golden; audit {report['score']}/100")
    return 2 if failed else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # setup problems (missing Node/Chrome, unreadable fixture)
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)
