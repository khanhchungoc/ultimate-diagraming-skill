#!/usr/bin/env python3
"""Regression check for the layout engine and the audit, against frozen golden outputs.

For every dev/fixtures/<type>/*.json it runs the diagram type's JavaScript engine (the same file the page uses
for Auto-Tidy) and compares the full laid-out data with dev/fixtures/<type>/golden/<name>.json, then audits the
result with `layout_engine.py --verify` logic (score >= 90, no overlaps/penetrations/overflows).

For a sequence fixture frozen before frames had branches, notes and collapsing (dev/fixtures/sequence/golden/v1/),
it also checks back-compatibility: every x, y, w, h is unchanged, and the old elseY is the one divider's y.

For a flowchart it also checks that the page's disk format is layout-neutral: writing the laid-out diagram with
its steps in flow order (disk_format.py) and laying that out again moves nothing, left to right and top to bottom.

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
from disk_format import from_disk, to_disk  # noqa: E402
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


def flow_order_problems(data: dict, laid: dict) -> list:
    """Saving writes the steps in flow order. If the engine broke ties by input order, a save followed by Tidy
    would move steps: lay out the saved (sorted) model again and require identical positions."""
    if data["diagramType"] != "flowchart":
        return []
    problems = []
    for direction in ("LR", "TB"):
        a = copy.deepcopy(data)
        a["direction"] = direction
        first = laid if direction == (data.get("direction") or "LR") else run_layout("flowchart", a)
        again = run_layout("flowchart", from_disk("flowchart", to_disk("flowchart", first)))
        where = {n["id"]: (n.get("laneId"), n.get("x"), n.get("y")) for n in again["nodes"]}
        moved = [n["id"] for n in first["nodes"] if where.get(n["id"]) != (n.get("laneId"), n.get("x"), n.get("y"))]
        if moved:
            problems.append(f"{direction}: laying out the flow-ordered save moves {', '.join(moved[:6])}")
        if [l.get("height") for l in first["lanes"]] != [l.get("height") for l in again["lanes"]]:
            problems.append(f"{direction}: laying out the flow-ordered save changes lane heights")
    return problems


def legacy_problems(path: Path, laid: dict) -> list:
    """A sequence page saved before the v2 fields must lay out exactly as it did (golden/v1 was frozen then)."""
    v1_path = path.parent / "golden" / "v1" / path.name
    if not v1_path.is_file():
        return []
    v1 = json.loads(v1_path.read_text(encoding="utf-8"))
    problems = []
    if v1.get("layout") != laid.get("layout"):
        problems.append(f"v1: canvas {v1.get('layout')} became {laid.get('layout')}")
    for items in ("participants", "messages", "fragments"):
        for old, new in zip(v1.get(items) or [], laid.get(items) or []):
            for k in ("x", "y", "w", "h"):
                if old.get(k) != new.get(k):
                    problems.append(f"v1: {items} {old.get('id')} {k} {old.get(k)} became {new.get(k)}")
            if "elseY" in old and [d.get("y") for d in new.get("dividers") or []] != [old["elseY"]]:
                problems.append(f"v1: fragment {old.get('id')} elseY {old['elseY']} is not its divider")
    return problems


def rail_problems(data: dict, laid: dict) -> list:
    """Rails (sequence, "rails": true): a rail is a participant with something in the collapsed frames and nothing
    outside them, and drawn RAIL_W (36) wide, so the diagram is narrower than the expanded one. With every frame
    expanded there are none, and the layout is the one without the flag."""
    if data["diagramType"] != "sequence" or data.get("rails") is not True:
        return []
    problems, ms, ps = [], laid["messages"], laid["participants"]
    drawn = {m["from"] for m in ms if not m.get("hidden")} | {m["to"] for m in ms if not m.get("hidden")}
    drawn |= {o for n in laid.get("notes") or [] if "x" in n for o in (n["over"] if isinstance(n["over"], list) else [n["over"]])}
    hidden = {m["from"] for m in ms if m.get("hidden")} | {m["to"] for m in ms if m.get("hidden")}
    for p in ps:
        if bool(p.get("rail")) != (p["id"] in hidden and p["id"] not in drawn):
            problems.append(f"rail: {p['id']} is {'' if p.get('rail') else 'not '}a rail, but it {'has' if p['id'] in drawn else 'has no'} drawn message or note")
    rails = [p for p in ps if p.get("rail")]
    if not rails:
        problems.append("rail: the fixture is meant to have rails")
    for left, right in zip(ps, ps[1:]):
        if left.get("rail") and right.get("rail") and right["x"] - left["x"] != 36 + 24:   # RAIL_W + the clear space beside a rail
            problems.append(f"rail: {left['id']} and {right['id']} are {right['x'] - left['x']}px apart, not RAIL_W + 24")
    expanded = copy.deepcopy(data)
    for f in expanded.get("fragments") or []:
        f.pop("collapsed", None)
    plain = copy.deepcopy(expanded)
    plain.pop("rails")
    a, b = run_layout("sequence", expanded), run_layout("sequence", plain)
    a.pop("rails", None)
    if list(differences(b, a)):
        problems.append("rail: with every frame expanded the layout differs from the layout without rails")
    if laid["layout"]["width"] >= b["layout"]["width"]:
        problems.append("rail: the focused diagram is not narrower than the expanded one")
    return problems


def lifespan_problems(data: dict, laid: dict) -> list:
    """Lifespans (sequence, "lifespans": true): every box sits above its first row and its lifeline ends below its
    last; participants that share a column have one x and lifelines that never overlap in y."""
    if data["diagramType"] != "sequence" or data.get("lifespans") is not True:
        return []
    problems, ps, ms = [], laid["participants"], laid["messages"]
    for p in ps:
        ys = [m["y"] for m in ms if p["id"] in (m["from"], m["to"])]
        if "top" not in p or "bottom" not in p:
            problems.append(f"lifespans: {p['id']} has no top/bottom")
        elif ys and not (p["top"] < min(ys) and p["bottom"] > max(ys)):
            problems.append(f"lifespans: {p['id']} spans {p['top']}-{p['bottom']} but takes part from {min(ys)} to {max(ys)}")
    for i, p in enumerate(ps):
        host = next((q for q in ps[:i] if q["id"] == p.get("column")), None)
        if host and (p["x"] != host["x"] or not (p["top"] > host["bottom"] or p["bottom"] < host["top"])):
            problems.append(f"lifespans: {p['id']} shares {host['id']}'s column but is not alone in it")
    plain = copy.deepcopy(data)
    for k in ("lifespans",):
        plain.pop(k, None)
    for q in plain["participants"]:
        for k in ("column", "start", "end"):
            q.pop(k, None)
    flat = run_layout("sequence", plain)
    if any("top" in p or "bottom" in p for p in flat["participants"]):
        problems.append("lifespans: a diagram without the flag has top/bottom")
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
        problems += flow_order_problems(data, laid)
        problems += legacy_problems(path, laid)
        problems += rail_problems(data, laid) + lifespan_problems(data, laid)
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
