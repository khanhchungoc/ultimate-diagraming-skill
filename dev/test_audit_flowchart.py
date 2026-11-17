#!/usr/bin/env python3
"""Unit cases for the flowchart long-arrow audit rules and pass_line output (scripts/layout_engine.py).

Usage: python dev/test_audit_flowchart.py
Exit codes: 0 all passed, 2 a case failed.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from layout_engine import FlowchartAudit, LONG_ARROW_COLS, LONG_ARROW_DETOUR_COLS  # noqa: E402


def _audit(nodes, edges, lanes=None, direction="LR"):
    return FlowchartAudit({
        "diagramType": "flowchart",
        "direction": direction,
        "lanes": lanes or [{"id": "l1", "name": "Actor", "icon": "user"}],
        "nodes": nodes,
        "edges": edges,
    })


def main() -> int:
    failed = 0

    def check(name: str, cond: bool, detail: str = "") -> None:
        nonlocal failed
        failed += not cond
        print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" - {detail}" if detail and not cond else ""))

    # 1. Clean 7-column arrow (below LONG_ARROW_DETOUR_COLS) with 0 crossings is not flagged
    a1 = _audit(
        [{"id": "n1", "laneId": "l1", "type": "start", "label": "A", "x": 56, "y": 48},
         {"id": "n2", "laneId": "l1", "type": "end", "label": "B", "x": 1600, "y": 48}],
        [{"id": "e1", "from": "n1", "to": "n2", "label": ""}],
    )
    r1 = a1.verify_collisions()
    check("clean 7-col arrow without crossings is not flagged",
          r1["long_arrows_count"] == 0 and not r1["budget_warnings"], str(r1))

    # 2. Extreme outer detour (>= LONG_ARROW_DETOUR_COLS) with 0 crossings IS flagged, with no "crosses 0"
    a2 = _audit(
        [{"id": "n1", "laneId": "l1", "type": "start", "label": "A", "x": 56, "y": 48},
         {"id": "n2", "laneId": "l1", "type": "end", "label": "B", "x": 56 + LONG_ARROW_DETOUR_COLS * 200 + 200, "y": 48}],
        [{"id": "e1", "from": "n1", "to": "n2", "label": ""}],
    )
    r2 = a2.verify_collisions()
    check("detour >= 10 cols with 0 crossings is flagged without 'crosses 0'",
          r2["long_arrows_count"] == 1
          and any("Long arrow 'e1'" in w and "crosses 0" not in w for w in r2["budget_warnings"]),
          str(r2["budget_warnings"]))

    # 3. Round-trip: opposite >= 6-col clean leg is also flagged when partner crosses another arrow
    a3 = _audit(
        [{"id": "n1", "laneId": "l1", "type": "task", "label": "Step 1", "x": 56, "y": 48},
         {"id": "n2", "laneId": "l1", "type": "task", "label": "Step 2", "x": 56 + LONG_ARROW_COLS * 200 + 200, "y": 48}],
        [{"id": "e_fwd", "from": "n1", "to": "n2", "label": ""},
         {"id": "e_back", "from": "n2", "to": "n1", "label": "", "feedback": True}],
    )
    polys3 = {
        "e_fwd": [(200.0, 80.0), (1456.0, 80.0)],
        "e_back": [(1456.0, 120.0), (1456.0, 160.0), (128.0, 160.0), (128.0, 112.0)],
        "e_cross": [(600.0, 20.0), (600.0, 140.0)],
    }
    a3.edges.append({"id": "e_cross", "from": "n1", "to": "n2", "label": ""})
    long3 = a3._long_arrows(polys3)
    ids3 = {e["id"] for e, _, _ in long3}
    check("round-trip clean return leg >= 6 cols is flagged when partner crosses",
          ids3 == {"e_fwd", "e_back"}, str(ids3))

    # 4. pass_line separates crossings (score only) from long arrows (fix [WARN] above)
    p_cross = a1.pass_line({"score": 96, "grade": "A+", "collinear_pct": 100.0,
                            "edge_crossings": 2, "long_arrows_count": 0})
    p_long = a1.pass_line({"score": 85, "grade": "B", "collinear_pct": 100.0,
                           "edge_crossings": 2, "long_arrows_count": 1})
    check("pass_line marks crossings as score only and long arrows as fix [WARN] above",
          "(score only, not a defect)" in p_cross
          and "long arrows" not in p_cross
          and "1 long arrows (fix [WARN] above)" in p_long,
          f"p_cross={p_cross!r} p_long={p_long!r}")

    print(f"{4 - failed}/4 cases passed")
    return 2 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
