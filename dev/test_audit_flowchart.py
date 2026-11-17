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
from layout_engine import FlowchartAudit, LONG_ARROW_COLS  # noqa: E402


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

    # 1. Clean 7-column arrow with 0 crossings is not flagged
    a1 = _audit(
        [{"id": "n1", "laneId": "l1", "type": "start", "label": "A", "x": 56, "y": 48},
         {"id": "n2", "laneId": "l1", "type": "end", "label": "B", "x": 1600, "y": 48}],
        [{"id": "e1", "from": "n1", "to": "n2", "label": ""}],
    )
    r1 = a1.verify_collisions()
    check("clean 7-col arrow without crossings is not flagged",
          r1["long_arrows_count"] == 0 and not r1["budget_warnings"], str(r1))

    # 2. A very long arrow that crosses nothing is not flagged: it still reads fine
    a2 = _audit(
        [{"id": "n1", "laneId": "l1", "type": "start", "label": "A", "x": 56, "y": 48},
         {"id": "n2", "laneId": "l1", "type": "end", "label": "B", "x": 56 + 12 * 200, "y": 48}],
        [{"id": "e1", "from": "n1", "to": "n2", "label": ""}],
    )
    r2 = a2.verify_collisions()
    check("12-col arrow with 0 crossings is not flagged",
          r2["long_arrows_count"] == 0 and not r2["budget_warnings"], str(r2["budget_warnings"]))

    # 3. A long arrow is flagged only once it crosses 2 others; its clean return leg is not
    a3 = _audit(
        [{"id": "n1", "laneId": "l1", "type": "task", "label": "Step 1", "x": 56, "y": 48},
         {"id": "n2", "laneId": "l1", "type": "task", "label": "Step 2", "x": 56 + LONG_ARROW_COLS * 200 + 200, "y": 48}],
        [{"id": "e_fwd", "from": "n1", "to": "n2", "label": ""},
         {"id": "e_back", "from": "n2", "to": "n1", "label": "", "feedback": True}],
    )
    polys3 = {
        "e_fwd": [(200.0, 80.0), (1456.0, 80.0)],
        "e_back": [(1456.0, 120.0), (1456.0, 160.0), (128.0, 160.0), (128.0, 112.0)],
        "e_cross": [(600.0, 20.0), (600.0, 100.0)],
    }
    a3.edges.append({"id": "e_cross", "from": "n1", "to": "n2", "label": ""})
    one = {e["id"] for e, _, _ in a3._long_arrows(polys3)}
    polys3["e_cross2"] = [(900.0, 20.0), (900.0, 100.0)]
    a3.edges.append({"id": "e_cross2", "from": "n1", "to": "n2", "label": ""})
    two = {e["id"] for e, _, _ in a3._long_arrows(polys3)}
    check("long arrow flagged at 2 crossings, not at 1; clean return leg never",
          one == set() and two == {"e_fwd"}, f"one={one} two={two}")
    # ... and with 1 crossing once it turns 3 times
    polys3["e_fwd"] = [(200.0, 80.0), (400.0, 80.0), (400.0, 60.0), (1300.0, 60.0), (1300.0, 80.0), (1456.0, 80.0)]
    del polys3["e_cross2"]
    a3.edges.pop()
    bent = {e["id"] for e, _, _ in a3._long_arrows(polys3)}
    check("long arrow with 1 crossing and 3+ bends is flagged", bent == {"e_fwd"}, f"bent={bent}")

    # 4. pass_line shows no grade; a score below 100 only as a report note
    p_100 = a1.pass_line({"score": 100, "grade": "A+"})
    p_85 = a1.pass_line({"score": 85, "grade": "B"})
    check("pass_line has no grade and notes a score below 100 for the report only",
          p_100 == "[PASS] Layout clean." and "audit score 85" in p_85 and "B" not in p_85.replace("PASS", ""),
          f"p_100={p_100!r} p_85={p_85!r}")

    # 5. A 0-crossing multi-lane perimeter wrap (>= 2 * LONG_ARROW_COLS and >= 3 bends) is flagged;
    #    a straight 12-col 0-bend arrow (even across lanes) is not
    a5 = _audit(
        [{"id": "n1", "laneId": "l1", "type": "task", "label": "Start", "x": 56, "y": 48},
         {"id": "n2", "laneId": "l2", "type": "task", "label": "End", "x": 56 + 12 * 200, "y": 240}],
        [{"id": "e_wrap", "from": "n1", "to": "n2", "label": ""},
         {"id": "e_straight", "from": "n1", "to": "n2", "label": ""}],
        lanes=[{"id": "l1", "name": "A", "icon": "user"}, {"id": "l2", "name": "B", "icon": "cpu"}],
    )
    polys5 = {
        "e_wrap": [(128.0, 48.0), (128.0, 16.0), (2600.0, 16.0), (2600.0, 320.0), (2550.0, 320.0), (2550.0, 272.0)],
        "e_straight": [(200.0, 80.0), (2456.0, 272.0)],
    }
    flagged5 = {e["id"] for e, _, _ in a5._long_arrows(polys5)}
    check("0-crossing multi-lane perimeter wrap (12+ cols, 4 bends) is flagged while 0-bend is not",
          flagged5 == {"e_wrap"}, f"flagged5={flagged5}")

    print(f"{6 - failed}/6 cases passed")
    return 2 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
