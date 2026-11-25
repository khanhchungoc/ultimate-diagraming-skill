#!/usr/bin/env python3
"""Unit cases for the flowchart long-arrow audit rules and pass_line output (scripts/layout_engine.py).

Usage: python dev/test_audit_flowchart.py [-v|--verbose]
Exit codes: 0 all passed, 2 a case failed.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
from layout_engine import FlowchartAudit, LONG_ARROW_COLS, add_connector_pairs  # noqa: E402


def _audit(nodes, edges, lanes=None, direction="LR"):
    return FlowchartAudit({
        "diagramType": "flowchart",
        "direction": direction,
        "lanes": lanes or [{"id": "l1", "name": "Actor", "icon": "user"}],
        "nodes": nodes,
        "edges": edges,
    })


def _rects(audit: FlowchartAudit):
    lane_tops = {}
    curr_y = 0
    for lane in audit.lanes:
        lid = lane["id"]
        lane_tops[lid] = curr_y
        curr_y += max(lane.get("height", audit.lane_min), audit._lane_floor(lid))
    return {
        n["id"]: (
            float(n.get("x", 0)),
            float(lane_tops.get(n["laneId"], 0) + n.get("y", 0)),
            float(audit.node_wf(n)),
            float(audit.node_h(n)),
        )
        for n in audit.nodes
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Unit cases for the flowchart audit rules.")
    parser.add_argument("-v", "--verbose", action="store_true", help="Print passing cases")
    args = parser.parse_args()
    failed = 0
    total = 0

    def check(name: str, cond: bool, detail: str = "") -> None:
        nonlocal failed, total
        total += 1
        failed += not cond
        if not cond or args.verbose:
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

    # 6. Shared fan-in trunk routing in _route_all_edges: edges from lanes above and below share
    #    the penultimate vertical trunk into the target without crossing or looping backwards
    lanes6 = [{"id": f"l{i}", "name": f"L{i}", "icon": "user"} for i in range(1, 6)]
    nodes6 = [
        {"id": "u1", "laneId": "l1", "type": "task", "label": "U1", "x": 56, "y": 48},
        {"id": "u2", "laneId": "l2", "type": "task", "label": "U2", "x": 56, "y": 48},
        {"id": "u3", "laneId": "l3", "type": "task", "label": "U3", "x": 56, "y": 48},
        {"id": "u4", "laneId": "l4", "type": "task", "label": "U4", "x": 56, "y": 48},
        {"id": "u5", "laneId": "l5", "type": "task", "label": "U5", "x": 56, "y": 48},
        {"id": "b1", "laneId": "l1", "type": "task", "label": "B1", "x": 240, "y": 48},
        {"id": "b2", "laneId": "l2", "type": "task", "label": "B2", "x": 240, "y": 48},
        {"id": "b3", "laneId": "l3", "type": "task", "label": "B3", "x": 240, "y": 48},
        {"id": "b4", "laneId": "l4", "type": "task", "label": "B4", "x": 240, "y": 48},
        {"id": "b5", "laneId": "l5", "type": "task", "label": "B5", "x": 240, "y": 48},
        {"id": "above_tgt", "laneId": "l2", "type": "task", "label": "Above", "x": 420, "y": 48},
        {"id": "tgt", "laneId": "l3", "type": "task", "label": "Tgt", "x": 420, "y": 48},
        {"id": "below_tgt", "laneId": "l4", "type": "task", "label": "Below", "x": 420, "y": 48},
    ]
    edges6 = [
        {"id": "e1", "from": "u1", "to": "tgt", "label": ""},
        {"id": "e2", "from": "u2", "to": "tgt", "label": ""},
        {"id": "e3", "from": "b3", "to": "tgt", "label": ""},
        {"id": "e4", "from": "u4", "to": "tgt", "label": ""},
        {"id": "e5", "from": "u5", "to": "tgt", "label": ""},
    ]
    a6 = _audit(nodes6, edges6, lanes=lanes6)
    r6 = a6.verify_collisions()
    polys6 = a6._route_all_edges(_rects(a6))
    fan_in_polys = [polys6[eid] for eid in ("e1", "e2", "e4", "e5")]
    shared_trunk_x = {pts[-2][0] for pts in fan_in_polys}
    check("shared fan-in trunk routing shares penultimate vertical trunk cleanly without looping or crossing",
          r6["passed"] and r6["edge_crossings"] == 0 and r6["penetrations_count"] == 0
          and len(shared_trunk_x) == 1
          and all(abs(pts[-3][0] - pts[-2][0]) < 1 and min(x for x, _ in pts) >= 128.0 and max(x for x, _ in pts) <= 420.0
                  for pts in fan_in_polys),
          f"r6={r6} polys6={polys6}")

    # 7. Shared unlabelled fan-out trunk vs labelled fan-out branches
    lanes7 = lanes6[:4]
    def _fanout(l1: str, l2: str):
        nodes = [
            {"id": "src", "laneId": "l1", "type": "task", "label": "Src", "x": 56, "y": 48},
            {"id": "guard", "laneId": "l2", "type": "task", "label": "Guard", "x": 56, "y": 48},
            {"id": "blk", "laneId": "l1", "type": "task", "label": "Blk", "x": 420, "y": 48},
            {"id": "d1", "laneId": "l2", "type": "task", "label": "D1", "x": 420, "y": 48},
            {"id": "d2", "laneId": "l3", "type": "task", "label": "D2", "x": 420, "y": 48},
            {"id": "d3", "laneId": "l4", "type": "task", "label": "D3", "x": 420, "y": 48},
        ]
        edges = [
            {"id": "eo1", "from": "src", "to": "d1", "label": l1},
            {"id": "eo2", "from": "src", "to": "d2", "label": l2},
            {"id": "eo3", "from": "src", "to": "d3", "label": ""},
        ]
        a = _audit(nodes, edges, lanes=lanes7)
        return a.verify_collisions(), a._route_all_edges(_rects(a))

    r7_unlab, p7_unlab = _fanout("", "")
    r7_lab, p7_lab = _fanout("Branch A", "Branch B")
    r7_mix, p7_mix = _fanout("Branch A", "")
    check("unlabelled fan-out branches share vertical trunk while labelled fan-out branches avoid overlap",
          r7_unlab["passed"] and r7_unlab["edge_crossings"] == 0
          and abs(p7_unlab["eo1"][1][0] - p7_unlab["eo2"][1][0]) < 1
          and r7_lab["passed"] and r7_lab["edge_crossings"] == 0
          and abs(p7_lab["eo1"][1][0] - p7_lab["eo2"][1][0]) >= 2
          and r7_mix["passed"] and r7_mix["edge_crossings"] == 0
          and abs(p7_mix["eo1"][1][0] - p7_mix["eo2"][1][0]) >= 2,
          f"unlab={p7_unlab} lab={p7_lab} mix={p7_mix}")

    # 8. Reading-order lettering in add_connector_pairs and max_letters=1 severity selection
    lanes8 = [{"id": "l1", "name": "L1", "icon": "user"}, {"id": "l2", "name": "L2", "icon": "cpu"}]
    nodes8 = [
        {"id": "n1", "laneId": "l1", "type": "task", "label": "Early Src"},
        {"id": "n2", "laneId": "l1", "type": "task", "label": "Early Dst"},
        {"id": "n3", "laneId": "l2", "type": "task", "label": "Late Src"},
        {"id": "n4", "laneId": "l2", "type": "task", "label": "Late Dst"},
    ]
    edges8 = [
        {"id": "e_early", "from": "n1", "to": "n2", "label": ""},
        {"id": "e_late", "from": "n3", "to": "n4", "label": ""},
    ]
    data8 = {"diagramType": "flowchart", "lanes": lanes8, "nodes": nodes8, "edges": edges8}
    laid8 = {
        "direction": "LR",
        "lanes": lanes8,
        "nodes": [
            {"id": "n1", "laneId": "l1", "x": 56, "y": 48},
            {"id": "n2", "laneId": "l1", "x": 1400, "y": 48},
            {"id": "n3", "laneId": "l2", "x": 1600, "y": 48},
            {"id": "n4", "laneId": "l2", "x": 3000, "y": 48},
        ],
    }
    long8 = [(edges8[1], 7.0, 4), (edges8[0], 7.0, 2)]
    out8, info8 = add_connector_pairs(data8, laid8, long8)
    out8_edges = {e["id"]: e for e in out8["edges"]}
    out8_nodes = {n["id"]: n for n in out8["nodes"]}
    one8, info_one8 = add_connector_pairs(data8, laid8, long8, max_letters=1)
    one8_edges = {e["id"]: e for e in one8["edges"]}
    check("add_connector_pairs selects severest first and assigns letters in reading order",
          len(info8) == 2
          and out8_nodes["c_a_out"]["label"] == "A" and out8_edges["c_a_out_e"]["to"] == "n2"
          and out8_edges["e_early"]["to"] == "c_a_in"
          and out8_nodes["c_b_out"]["label"] == "B" and out8_edges["c_b_out_e"]["to"] == "n4"
          and out8_edges["e_late"]["to"] == "c_b_in"
          and len(info_one8) == 1
          and one8_edges["c_a_out_e"]["to"] == "n4" and one8_edges["e_late"]["to"] == "c_a_in"
          and one8_edges["e_early"]["to"] == "n2",
          f"info8={info8} info_one8={info_one8}")

    # 9. Unlabelled same-side parallel fork keeps all 4 branches on one shared fork bus (LR and TB)
    for d9 in ("LR", "TB"):
        lanes9 = [{"id": f"l{i}", "name": f"L{i}", "icon": "user"} for i in range(1, 6)]
        nodes9 = [
            {"id": "src", "laneId": "l1", "type": "task", "label": "Clear", "x": 56, "y": 48},
            {"id": "t1", "laneId": "l2", "type": "task", "label": "T1", "x": 256, "y": 48},
            {"id": "t2", "laneId": "l3", "type": "task", "label": "T2", "x": 256, "y": 48},
            {"id": "t3", "laneId": "l4", "type": "task", "label": "T3", "x": 256, "y": 48},
            {"id": "t4", "laneId": "l5", "type": "task", "label": "T4", "x": 256, "y": 48},
        ]
        edges9 = [{"id": f"ef{i}", "from": "src", "to": f"t{i}", "label": ""} for i in range(1, 5)]
        a9 = _audit(nodes9, edges9, lanes=lanes9, direction=d9)
        r9 = a9.verify_collisions()
        p9 = a9._route_all_edges(_rects(a9))
        bus_xs = {round(p9[f"ef{i}"][1][0], 1) for i in range(1, 5) if len(p9[f"ef{i}"]) == 4}
        check(f"unlabelled 4-way parallel fork shares one fork bus ({d9})",
              r9["passed"] and r9["edge_crossings"] == 0 and r9["long_arrows_count"] == 0 and len(bus_xs) == 1,
              f"d={d9} r9={r9} bus_xs={bus_xs} p9={p9}")

    # 10. Free notes (flowchart, ERD, use case): an empty link list plus an absolute pos. Disk round trip, audit, --extract
    import copy
    import json
    import subprocess
    import tempfile
    from audit_erd import ErdAudit
    from audit_usecase import UsecaseAudit
    from disk_format import check_notes, from_disk, to_disk

    steps = [{"id": "a", "laneId": "l1", "type": "task", "label": "A", "x": 56, "y": 48}]
    lane = [{"id": "l1", "name": "Actor", "icon": "user"}]
    models = {
        "flowchart": {"diagramType": "flowchart", "lanes": lane, "nodes": steps, "edges": [],
                      "notes": [{"id": "n1", "text": "Loose remark", "nodes": [], "pos": {"x": 300, "y": 120}},
                                {"id": "n2", "text": "On A", "nodes": ["a"]}]},
        "erd": {"diagramType": "erd", "entities": [{"id": "t", "name": "t", "columns": [{"name": "id", "pk": True}], "x": 20, "y": 20}], "relationships": [],
                "notes": [{"id": "n1", "text": "Loose remark", "entities": [], "pos": {"x": 300, "y": 120}},
                          {"id": "n2", "text": "On t", "entities": ["t"]}]},
        "usecase": {"diagramType": "usecase", "actors": [{"id": "u", "name": "User", "x": 20, "y": 20}], "useCases": [], "links": [],
                    "notes": [{"id": "n1", "text": "Loose remark", "useCases": [], "pos": {"x": 300, "y": 120}},
                              {"id": "n2", "text": "On u", "actors": ["u"], "_pos": {"x": 5, "y": 5}}]},
    }
    for kind, model in models.items():
        disk = to_disk(kind, model)
        back = from_disk(kind, disk)
        free = disk["notes"][0]
        check(f"free note ({kind}): kept with its empty list and absolute pos, no new key", free["pos"] == {"x": 300, "y": 120} and set(free) <= {"id", "text", "nodes", "entities", "useCases", "pos"}, str(free))
        check(f"free note ({kind}): disk, memory, disk is unchanged", to_disk(kind, back) == disk and back["notes"][0]["pos"] == {"x": 300, "y": 120})
        bare = copy.deepcopy(model)
        del bare["notes"][0]["pos"]
        try:
            check_notes(kind, bare)
            rejected = False
        except ValueError:
            rejected = True
        check(f"free note ({kind}): no pos is rejected by to_disk and from_disk", rejected and all(_raises(f, kind, bare) for f in (to_disk, from_disk)))
    check("free note (usecase): an anchored note's _pos is still not saved", "_pos" not in to_disk("usecase", models["usecase"])["notes"][1])
    fa = _audit(steps, [])
    fa.data["notes"] = models["flowchart"]["notes"]
    check("free note (flowchart): the audit does not warn on an empty link list", not any("Loose" in w or "n1" in w for w in fa._note_warnings()), str(fa._note_warnings()))
    fa.data["notes"] = [{"id": "n3", "text": "No home", "nodes": []}]
    check("free note (flowchart): an empty list with no pos still warns", any("n3" in w for w in fa._note_warnings()))
    ea = ErdAudit({**models["erd"], "canvas": {"width": 400, "height": 300}}).verify_collisions()
    ua = UsecaseAudit({**models["usecase"], "canvas": {"width": 400, "height": 300}}).verify_collisions()
    check("free note (erd, usecase): the audit reports nothing about a free note", not any("n1" in str(i) for i in ea["issues"] + ua["issues"]), str(ea["issues"] + ua["issues"]))
    with tempfile.TemporaryDirectory() as tmp:
        for kind, model in models.items():
            f = Path(tmp) / f"{kind}.json"
            f.write_text(json.dumps(to_disk(kind, model)), encoding="utf-8")
            run = subprocess.run([sys.executable, str(ROOT / "scripts" / "layout_engine.py"), "--extract", str(f)], capture_output=True, text=True, encoding="utf-8")
            out = run.stdout
            check(f"free note ({kind}): --extract prints it in a Notes section after the diagram", run.returncode == 0 and "%% Notes" in out and out.index("%% Notes") > out.index("\n") and "%% n1: Loose remark" in out and out.count("Loose remark") == 1, (out + run.stderr)[-400:])
            check(f"free note ({kind}): --extract still prints the anchored note with its target", "On " in out and out.count("%% Notes") == 1, out[-300:])

    # 11. Decision same-lane branch placement: 1 branch in LR goes right; 2+ may stack; 3+ balances terminal branch
    from engine_runner import run_layout
    d11_one = run_layout("flowchart", {
        "diagramType": "flowchart", "direction": "LR",
        "lanes": [{"id": "l1", "name": "L1", "icon": "user"}, {"id": "l2", "name": "L2", "icon": "cpu"}],
        "nodes": [
            {"id": "s", "laneId": "l1", "type": "start", "label": "Start"},
            {"id": "d", "laneId": "l1", "type": "decision", "label": "OK?"},
            {"id": "t", "laneId": "l1", "type": "task", "label": "Next"},
            {"id": "x", "laneId": "l2", "type": "task", "label": "Other"},
        ],
        "edges": [
            {"id": "e1", "from": "s", "to": "d", "label": ""},
            {"id": "e2", "from": "d", "to": "t", "label": "Yes"},
            {"id": "e3", "from": "d", "to": "x", "label": "No"},
            {"id": "e4", "from": "t", "to": "x", "label": ""},
        ],
    })
    by11 = {n["id"]: n for n in d11_one["nodes"]}
    check("LR decision with 1 same-lane branch places it to the right",
          by11["t"]["x"] > by11["d"]["x"], f"d={by11['d']} t={by11['t']}")

    for d11_dir in ("LR", "TB"):
        d11_three = run_layout("flowchart", {
            "diagramType": "flowchart", "direction": d11_dir,
            "lanes": [{"id": "l1", "name": "L1", "icon": "user"}],
            "nodes": [
                {"id": "s", "laneId": "l1", "type": "start", "label": "Start"},
                {"id": "d", "laneId": "l1", "type": "decision", "label": "Route?"},
                {"id": "a", "laneId": "l1", "type": "task", "label": "Opt A"},
                {"id": "b", "laneId": "l1", "type": "task", "label": "Opt B"},
                {"id": "c", "laneId": "l1", "type": "end", "label": "Reject"},
                {"id": "e", "laneId": "l1", "type": "end", "label": "Done"},
            ],
            "edges": [
                {"id": "e1", "from": "s", "to": "d", "label": ""},
                {"id": "e2", "from": "d", "to": "a", "label": "A"},
                {"id": "e3", "from": "d", "to": "b", "label": "B"},
                {"id": "e4", "from": "d", "to": "c", "label": "No"},
                {"id": "e5", "from": "a", "to": "e", "label": ""},
                {"id": "e6", "from": "b", "to": "e", "label": ""},
            ],
        })
        by3 = {n["id"]: n for n in d11_three["nodes"]}
        r3 = FlowchartAudit(d11_three).verify_collisions()
        check(f"3-way decision with terminal branch balances to 2 tracks ({d11_dir})",
              by3["c"]["x"] == by3["d"]["x"] and by3["a"]["x"] == by3["b"]["x"] > by3["d"]["x"] and r3["passed"],
              f"d={d11_dir} by3={by3} r3={r3}")

    # 12. Fan-out track cap: <=3 branches stay at <=2 sub-tracks; >3 branches stay at <=3 sub-tracks
    def track_count(laid_data):
        tb = laid_data.get("direction") == "TB"
        return len({round((n["y"] + (144 if tb else (96 if n["type"] == "decision" else 64)) / 2) / 40) for n in laid_data["nodes"]})

    for d12_dir in ("LR", "TB"):
        d12_three = run_layout("flowchart", {
            "diagramType": "flowchart", "direction": d12_dir,
            "lanes": [{"id": "l1", "name": "L1", "icon": "user"}],
            "nodes": [
                {"id": "s", "laneId": "l1", "type": "start", "label": "Start"},
                {"id": "d", "laneId": "l1", "type": "decision", "label": "Check?"},
                {"id": "c", "laneId": "l1", "type": "end", "label": "Needs Manual Review"},
                {"id": "a", "laneId": "l1", "type": "task", "label": "Opt A"},
                {"id": "b", "laneId": "l1", "type": "task", "label": "Opt B"},
                {"id": "ea", "laneId": "l1", "type": "end", "label": "Done A"},
                {"id": "eb", "laneId": "l1", "type": "end", "label": "Done B"},
            ],
            "edges": [
                {"id": "e1", "from": "s", "to": "d", "label": ""},
                {"id": "e2", "from": "d", "to": "c", "label": "Needs Manual Intervention"},
                {"id": "e3", "from": "d", "to": "a", "label": "Opt A"},
                {"id": "e4", "from": "d", "to": "b", "label": "Opt B"},
                {"id": "e5", "from": "a", "to": "ea", "label": ""},
                {"id": "e6", "from": "b", "to": "eb", "label": ""},
            ],
        })
        t3 = track_count(d12_three)
        r12_3 = FlowchartAudit(d12_three).verify_collisions()
        check(f"<=3 stacked branches cap at 2 sub-tracks ({d12_dir})",
              t3 <= 2 and r12_3["passed"], f"d={d12_dir} tracks={t3} r={r12_3}")

        d12_five = run_layout("flowchart", {
            "diagramType": "flowchart", "direction": d12_dir,
            "lanes": [{"id": "l1", "name": "L1", "icon": "user"}],
            "nodes": [
                {"id": "s", "laneId": "l1", "type": "start", "label": "Start"},
                {"id": "d", "laneId": "l1", "type": "decision", "label": "Status?"},
                {"id": "e500", "laneId": "l1", "type": "end", "label": "HTTP 500"},
                {"id": "ok", "laneId": "l1", "type": "task", "label": "Save"},
                {"id": "log", "laneId": "l1", "type": "task", "label": "Log"},
                {"id": "e404", "laneId": "l1", "type": "end", "label": "HTTP 404"},
                {"id": "e409", "laneId": "l1", "type": "end", "label": "HTTP 409"},
                {"id": "e201", "laneId": "l1", "type": "end", "label": "Done"},
                {"id": "e400", "laneId": "l1", "type": "end", "label": "HTTP 400"},
            ],
            "edges": [
                {"id": "e1", "from": "s", "to": "d", "label": ""},
                {"id": "e2", "from": "d", "to": "e500", "label": "Other / Error"},
                {"id": "e3", "from": "d", "to": "ok", "label": "HTTP 201"},
                {"id": "e4", "from": "d", "to": "log", "label": "HTTP 400"},
                {"id": "e5", "from": "d", "to": "e404", "label": "HTTP 404"},
                {"id": "e6", "from": "d", "to": "e409", "label": "HTTP 409"},
                {"id": "e7", "from": "ok", "to": "e201", "label": ""},
                {"id": "e8", "from": "log", "to": "e400", "label": ""},
            ],
        })
        t5 = track_count(d12_five)
        r12_5 = FlowchartAudit(d12_five).verify_collisions()
        check(f">3 stacked branches cap at 3 sub-tracks ({d12_dir})",
              t5 <= 3 and r12_5["passed"], f"d={d12_dir} tracks={t5} r={r12_5}")

    print(f"{total - failed}/{total} cases passed")
    return 2 if failed else 0


def _raises(fn, kind, data) -> bool:
    try:
        fn(kind, data)
    except ValueError:
        return True
    return False


if __name__ == "__main__":
    sys.exit(main())
