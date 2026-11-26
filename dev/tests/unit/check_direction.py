#!/usr/bin/env python3
"""Check the direction --layout picks for a flowchart that leaves "direction" out (choose_flowchart_direction).

  python dev/check_direction.py [-v|--verbose]     exit 1 if any pick differs from the expected one

Cases: the short loan example stays left to right (it fits the screen whole); the 55-step laptop sample goes top
to bottom; so do copies of it with 1, 2, 3 and 5 extra lanes (8 to 12 lanes), because a landscape screen is about
twice as wide as tall. Each extra lane takes a few of the sample's own task steps, so the flow stays valid.
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
from layout_engine import authoring_json, choose_flowchart_direction, read_data_block  # noqa: E402


def with_extra_lanes(data: dict, k: int) -> dict:
    d = copy.deepcopy(data)
    tasks = [n for n in d["nodes"] if n["type"] == "task"]
    for i in range(k):
        lane_id = f"lane-extra-{i + 1}"
        d["lanes"].append({"id": lane_id, "name": f"Extra Team {i + 1}", "icon": "users"})
        for node in tasks[i::k + 1][:3]:
            node["laneId"] = lane_id
    return d


def main() -> int:
    parser = argparse.ArgumentParser(description="Check automatic flowchart direction picks.")
    parser.add_argument("-v", "--verbose", action="store_true", help="Print passing cases")
    args = parser.parse_args()
    loan = json.loads((ROOT / "dev" / "examples" / "example-flowchart.json").read_text(encoding="utf-8"))
    page = (ROOT / "dev" / "samples" / "example-corporate-laptop-purchase-request.html").read_text(encoding="utf-8")
    laptop = authoring_json("flowchart", read_data_block(page))
    laptop.pop("direction", None)
    cases = [
        ("loan example, 4 lanes, 17 steps", loan, "LR"),
        ("laptop sample, 7 lanes, 55 steps", laptop, "TB"),
        ("narrow 2-lane long flow, half-screen TB", {
            "diagramType": "flowchart",
            "lanes": [
                {"id": "l1", "name": "Policy Service", "icon": "cpu"},
                {"id": "l2", "name": "Partner API", "icon": "server"},
            ],
            "nodes": [
                {"id": "s", "laneId": "l1", "type": "start", "label": "Submit"},
                {"id": "v1", "laneId": "l1", "type": "decision", "label": "Valid Body?"},
                {"id": "v2", "laneId": "l1", "type": "decision", "label": "Config Found?"},
                {"id": "q", "laneId": "l1", "type": "database", "label": "Query Pending"},
                {"id": "c", "laneId": "l1", "type": "decision", "label": "One Record?"},
                {"id": "t", "laneId": "l2", "type": "task", "label": "Create Task"},
                {"id": "t_ok", "laneId": "l1", "type": "decision", "label": "Task Created?"},
                {"id": "p", "laneId": "l2", "type": "task", "label": "Purchase Plan"},
                {"id": "p_ok", "laneId": "l1", "type": "decision", "label": "Plan 200?"},
                {"id": "m_ok", "laneId": "l1", "type": "database", "label": "Mark Success"},
                {"id": "e400", "laneId": "l1", "type": "end", "label": "HTTP 400"},
                {"id": "e500", "laneId": "l1", "type": "end", "label": "HTTP 500"},
                {"id": "e200", "laneId": "l1", "type": "end", "label": "HTTP 200"},
            ],
            "edges": [
                {"id": "e1", "from": "s", "to": "v1", "label": ""},
                {"id": "e2", "from": "v1", "to": "e400", "label": "No"},
                {"id": "e3", "from": "v1", "to": "v2", "label": "Yes"},
                {"id": "e4", "from": "v2", "to": "e400", "label": "No"},
                {"id": "e5", "from": "v2", "to": "q", "label": "Yes"},
                {"id": "e6", "from": "q", "to": "c", "label": ""},
                {"id": "e7", "from": "c", "to": "e500", "label": "No"},
                {"id": "e8", "from": "c", "to": "t", "label": "Yes"},
                {"id": "e9", "from": "t", "to": "t_ok", "label": ""},
                {"id": "e10", "from": "t_ok", "to": "e500", "label": "No"},
                {"id": "e11", "from": "t_ok", "to": "p", "label": "Yes"},
                {"id": "e12", "from": "p", "to": "p_ok", "label": ""},
                {"id": "e13", "from": "p_ok", "to": "e500", "label": "No"},
                {"id": "e14", "from": "p_ok", "to": "m_ok", "label": "Yes"},
                {"id": "e15", "from": "m_ok", "to": "e200", "label": ""},
            ],
        }, "TB"),
    ]
    # 9 lanes: top to bottom has two more edge crossings (88 against 92); crossings never fail the audit, so TB
    cases += [(f"laptop sample + {k} lanes ({7 + k} lanes)", with_extra_lanes(laptop, k), "TB") for k in (1, 2, 3, 5)]
    failed = 0
    for name, data, expected in cases:
        laid, why = choose_flowchart_direction(data, 30, None)
        got = laid.get("direction", "LR")
        ok = got == expected
        failed += not ok
        if not ok or args.verbose:
            print(f"[{'PASS' if ok else 'FAIL'}] {name}: {got} (expected {expected}){' - ' + why if why else ''}")
    print(f"{len(cases) - failed}/{len(cases)} direction cases passed" + (f" ({failed} failed)" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
