#!/usr/bin/env python3
"""Check the direction --layout picks for a flowchart that leaves "direction" out (choose_flowchart_direction).

  python dev/check_direction.py     exit 1 if any pick differs from the expected one

Cases: the short loan example stays left to right (it fits the screen whole); the 55-step laptop sample goes top
to bottom; so do copies of it with 1, 2, 3 and 5 extra lanes (8 to 12 lanes), because a landscape screen is about
twice as wide as tall. Each extra lane takes a few of the sample's own task steps, so the flow stays valid.
"""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
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
    loan = json.loads((ROOT / "references" / "examples" / "example-flowchart.json").read_text(encoding="utf-8"))
    page = (ROOT / "dev" / "samples" / "corporate-laptop-purchase-request.html").read_text(encoding="utf-8")
    laptop = authoring_json("flowchart", read_data_block(page))
    laptop.pop("direction", None)
    cases = [("loan example, 4 lanes, 17 steps", loan, "LR"), ("laptop sample, 7 lanes, 55 steps", laptop, "TB")]
    # 9 lanes: top to bottom has two more edge crossings (88 against 92); crossings never fail the audit, so TB
    cases += [(f"laptop sample + {k} lanes ({7 + k} lanes)", with_extra_lanes(laptop, k), "TB") for k in (1, 2, 3, 5)]
    failed = 0
    for name, data, expected in cases:
        laid, why = choose_flowchart_direction(data, 30, None)
        got = laid.get("direction", "LR")
        ok = got == expected
        failed += not ok
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: {got} (expected {expected}){' - ' + why if why else ''}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
