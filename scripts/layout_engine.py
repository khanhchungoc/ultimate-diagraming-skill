#!/usr/bin/env python3
"""Audit, scaffold and extract tool for interactive diagram HTML files.

- `--layout`: computes positions with the diagram type's JavaScript engine (assets/types/<type>/engine.js, the
  same file the page runs for Auto-Tidy; see engine_runner.py), then writes one standalone HTML file.
- `--verify`: routes every edge and audits overlaps, penetrations, lane overflow, crossings, straightness,
  complexity budget and self-containment. Needs no browser or Node.js.
- `--extract`: reads the live JSON back out of an edited HTML file.

Zero external dependencies (uses standard library Python 3).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from audit_sequence import SequenceAudit
from engine_runner import EngineUnavailable, run_layout


DEFAULT_COL_WIDTH = 200
START_X = 56

# Complexity budget (a diagram beyond these is too dense to read at Fit zoom on a 1920px screen)
SUPPORTED_TYPES = ("flowchart", "sequence")  # add a type here when its engine and reference exist
DEFAULT_TYPE = "flowchart"
SCHEMA_VERSION = 1

# Zero budget limits: diagrams can be as large as the user requires.
DEFAULT_NODE_WIDTH = 144
DEFAULT_NODE_HEIGHT = 64
DECISION_NODE_HEIGHT = 80
LANE_MIN_HEIGHT = 176
LANE_BOTTOM_PADDING = 36


class FlowchartAudit:
    def __init__(self, data: Dict[str, Any]):
        self.data = data
        self.lanes: List[Dict[str, Any]] = data.get("lanes", [])
        self.nodes: List[Dict[str, Any]] = data.get("nodes", [])
        self.edges: List[Dict[str, Any]] = data.get("edges", [])
        self.lane_map = {lane["id"]: idx for idx, lane in enumerate(self.lanes)}
        self.node_map = {node["id"]: node for node in self.nodes}
        # Node x/y are in flow terms (x along the flow, y across the lane) in both directions; a top-to-bottom
        # diagram ("direction": "TB") has its own sizes in those terms (engine.js LE_PROFILES.TB)
        if data.get("direction") == "TB":
            self.node_w, self.base_h, self.dec_h = 80, 144, 144
            self.lane_min, self.bottom_pad, self.col_w = 240, 32, 136
        else:
            self.node_w, self.base_h, self.dec_h = DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT, DECISION_NODE_HEIGHT
            self.lane_min, self.bottom_pad, self.col_w = LANE_MIN_HEIGHT, LANE_BOTTOM_PADDING, DEFAULT_COL_WIDTH

    def node_h(self, node: Dict[str, Any]) -> int:
        """A node's extent across its lane."""
        return self.dec_h if node.get("type") == "decision" else self.base_h

    title = "Flowchart"

    def pass_line(self, report: Dict[str, Any]) -> str:
        return (
            f"[PASS] Quality Score: {report['score']}/100 ({report['grade']}). "
            f"0 overlaps, 0 penetrations, {report['collinear_pct']}% collinear straightness."
        )

    def summary_lines(self, report: Dict[str, Any]) -> List[str]:
        return [
            f"Structure: {report['lane_count']} Lanes | {report['node_count']} Nodes | {report['edge_count']} Edges | {report['column_count']} Columns",
            f"Diagram Quality Score: {report['score']}/100  [GRADE: {report['grade']}]",
            f"----------------------------------------------------------------------",
            f"✓ Node-to-Node Overlaps:         {report['overlaps_count']} detected",
            f"✓ Swimlane Boundary Fit:         {report['overflows_count']} overflows",
            f"✓ Edge-through-Node Penetration: {report['penetrations_count']} penetrations",
            f"✓ Collinear Straightness:        {report['collinear_pct']}% ({report['doglegs_count']} dogleg kinks)",
            f"✓ Reference Integrity:           {report['dangling_count']} dangling endpoints",
            f"✓ Orthogonal Edge Crossings:     {report['edge_crossings']} crossings",
        ]

    def verify_collisions(self) -> Dict[str, Any]:
        """Comprehensive verification audit & diagram quality scoring engine.
        
        Evaluates 6 core dimensions:
        1. Reference Integrity (Dangling endpoints, invalid lane IDs)
        2. Node-to-Node Collisions (Bounding box overlaps)
        3. Swimlane Boundary Containment (Height & padding overflows)
        4. Edge Penetration (Connector lines cutting through non-incident nodes)
        5. Collinear Straightness (Ratio of 0-turn straight horizontal connections between same-row nodes in a lane)
        6. Orthogonal Edge Crossings
        """
        dangling_issues: List[str] = []
        overlap_issues: List[str] = []
        overflow_issues: List[str] = []
        penetrations: List[str] = []
        dogleg_issues: List[str] = []

        # 1. Reference Integrity
        for edge in self.edges:
            if edge["from"] not in self.node_map:
                dangling_issues.append(f"Edge '{edge['id']}' references non-existent source node '{edge['from']}'.")
            if edge["to"] not in self.node_map:
                dangling_issues.append(f"Edge '{edge['id']}' references non-existent target node '{edge['to']}'.")

        # Compute lane heights and tops
        lane_tops: Dict[str, int] = {}
        lane_heights: Dict[str, int] = {}
        curr_y = 0
        for lane in self.lanes:
            lid = lane["id"]
            lane_tops[lid] = curr_y
            max_y = max((n.get("y", 0) for n in self.nodes if n.get("laneId") == lid), default=48)
            h = max(lane.get("height", self.lane_min), max_y + self.dec_h + 30)
            lane_heights[lid] = h
            curr_y += h

        # 2. Containment Checks
        for node in self.nodes:
            lid = node["laneId"]
            nh = self.node_h(node)
            if lid not in self.lane_map:
                dangling_issues.append(f"Node '{node['id']}' references non-existent lane '{lid}'.")
            else:
                ny = node.get("y", 0)
                lh = lane_heights[lid]
                if ny < 10 or ny + nh > lh:
                    overflow_issues.append(
                        f"Node '{node['id']}' (y={ny}, h={nh}) overflows lane '{lid}' height ({lh}px)."
                    )

        # 3. Node Overlaps
        for i, n1 in enumerate(self.nodes):
            x1 = n1.get("x", 0)
            y1 = n1.get("y", 0)
            w1 = self.node_w
            h1 = self.node_h(n1)

            for j in range(i + 1, len(self.nodes)):
                n2 = self.nodes[j]
                if n1["laneId"] != n2["laneId"]:
                    continue
                x2 = n2.get("x", 0)
                y2 = n2.get("y", 0)
                w2 = self.node_w
                h2 = self.node_h(n2)

                overlap_x = max(0, min(x1 + w1, x2 + w2) - max(x1, x2))
                overlap_y = max(0, min(y1 + h1, y2 + h2) - max(y1, y2))

                if overlap_x > 0 and overlap_y > 0:
                    overlap_issues.append(
                        f"Collision between nodes '{n1['id']}' and '{n2['id']}' in lane '{n1['laneId']}' "
                        f"(overlap: {overlap_x}px x {overlap_y}px)."
                    )

        # 4. Rectangles & Polylines for Geometry Auditing
        rects: Dict[str, Tuple[float, float, float, float]] = {}
        for n in self.nodes:
            nx = float(n.get("x", 0))
            ny = float(lane_tops.get(n["laneId"], 0) + n.get("y", 0))
            nh = float(self.node_h(n))
            rects[n["id"]] = (nx, ny, float(self.node_w), nh)

        polylines = self._route_all_edges(rects)

        # 5. Edge-through-Node Penetration Checks
        for e in self.edges:
            eid = e["id"]
            if eid not in polylines:
                continue
            pts = polylines[eid]
            u_id, v_id = e["from"], e["to"]

            for other_node in self.nodes:
                oid = other_node["id"]
                if oid == u_id or oid == v_id:
                    continue
                if oid not in rects:
                    continue
                ox, oy, ow, oh = rects[oid]
                box_x1, box_y1 = ox + 3, oy + 3
                box_x2, box_y2 = ox + ow - 3, oy + oh - 3
                if box_x2 <= box_x1 or box_y2 <= box_y1:
                    continue

                for k in range(len(pts) - 1):
                    p1 = pts[k]
                    p2 = pts[k + 1]
                    seg_x1, seg_x2 = min(p1[0], p2[0]), max(p1[0], p2[0])
                    seg_y1, seg_y2 = min(p1[1], p2[1]), max(p1[1], p2[1])

                    if seg_x1 < box_x2 and seg_x2 > box_x1 and seg_y1 < box_y2 and seg_y2 > box_y1:
                        if abs(p1[0] - p2[0]) < 1:  # Vertical
                            if box_x1 <= p1[0] <= box_x2 and not (seg_y2 <= box_y1 or seg_y1 >= box_y2):
                                penetrations.append(f"Edge '{eid}' ({u_id} -> {v_id}) penetrates node '{oid}'")
                                break
                        elif abs(p1[1] - p2[1]) < 1:  # Horizontal
                            if box_y1 <= p1[1] <= box_y2 and not (seg_x2 <= box_x1 or seg_x1 >= box_x2):
                                penetrations.append(f"Edge '{eid}' ({u_id} -> {v_id}) penetrates node '{oid}'")
                                break

        # 6. Collinear Straightness Audit (Same-lane forward edges)
        same_lane_fwd_count = 0
        collinear_count = 0
        for e in self.edges:
            eid = e["id"]
            if eid not in polylines:
                continue
            u_id, v_id = e["from"], e["to"]
            if u_id not in self.node_map or v_id not in self.node_map:
                continue
            u, v = self.node_map[u_id], self.node_map[v_id]
            if u["laneId"] == v["laneId"] and v.get("x", 0) > u.get("x", 0):
                # Nodes on different sub-rows (a fork/join or a branch bypass) need a bend to connect;
                # only edges whose endpoints share a row can be flat, so only those are judged.
                if u_id in rects and v_id in rects:
                    ucy = rects[u_id][1] + rects[u_id][3] / 2
                    vcy = rects[v_id][1] + rects[v_id][3] / 2
                    if abs(ucy - vcy) >= 2:
                        continue
                same_lane_fwd_count += 1
                pts = polylines[eid]
                if len(pts) == 2 and abs(pts[0][1] - pts[1][1]) < 2:
                    collinear_count += 1
                else:
                    dogleg_issues.append(f"Same-lane edge '{eid}' ({u_id} -> {v_id}) has avoidable dogleg bends ({len(pts)-1} segments)")

        collinear_pct = (collinear_count / same_lane_fwd_count * 100.0) if same_lane_fwd_count > 0 else 100.0

        # 7. Crossings Count
        edge_crossings = self._count_crossings_from_polylines(polylines)
        bend_count = sum(max(0, len(pts) - 2) for pts in polylines.values())
        total_edge_length = sum(
            abs(pts[i + 1][0] - pts[i][0]) + abs(pts[i + 1][1] - pts[i][1])
            for pts in polylines.values() for i in range(len(pts) - 1)
        )

        # 8. Score Calculation (0-100)
        score = 100
        score -= len(dangling_issues) * 30
        score -= len(overlap_issues) * 25
        score -= len(overflow_issues) * 20
        score -= len(penetrations) * 15
        score -= len(dogleg_issues) * 5
        score -= min(15, edge_crossings * 2)
        score = max(0, min(100, score))

        grade = "A+" if score >= 95 else ("A" if score >= 90 else ("B" if score >= 80 else ("C" if score >= 70 else "F")))
        all_issues = dangling_issues + overlap_issues + overflow_issues + penetrations + dogleg_issues
        passed = (
            score >= 90
            and len(dangling_issues) == 0
            and len(overlap_issues) == 0
            and len(overflow_issues) == 0
            and len(penetrations) == 0
        )

        max_x = max((float(n.get("x", 0)) for n in self.nodes), default=float(START_X))
        column_count = int(round((max_x - START_X) / self.col_w)) + 1
        budget_warnings: List[str] = self._lane_icon_warnings() + self._outcome_label_warnings() + self._note_warnings()

        return {
            "passed": passed,
            "score": score,
            "grade": grade,
            "issues": all_issues,
            "node_count": len(self.nodes),
            "edge_count": len(self.edges),
            "lane_count": len(self.lanes),
            "edge_crossings": edge_crossings,
            "bend_count": bend_count,
            "total_edge_length": total_edge_length,
            "collinear_pct": round(collinear_pct, 1),
            "penetrations_count": len(penetrations),
            "overlaps_count": len(overlap_issues),
            "overflows_count": len(overflow_issues),
            "dangling_count": len(dangling_issues),
            "doglegs_count": len(dogleg_issues),
            "column_count": column_count,
            "budget_warnings": budget_warnings,
        }

    def _lane_icon_warnings(self) -> List[str]:
        """Every swimlane header carries an icon: it makes the owner recognisable at a glance."""
        icons_file = ASSETS_DIR / "types" / "flowchart" / "icons.json"
        known = set(json.loads(icons_file.read_text(encoding="utf-8"))) if icons_file.is_file() else set()
        names = ", ".join(sorted(known))
        warnings = []
        if self.data.get("swimlanes") is False:
            return warnings  # no-swimlane mode: the single lane has no visible header
        for lane in self.lanes:
            label = lane.get("name", lane.get("id"))
            icon = lane.get("icon")
            if not icon:
                warnings.append(f"Lane '{label}' has no \"icon\". Give every lane one (names: {names}).")
            elif known and icon not in known:
                warnings.append(f"Lane '{label}' uses unknown icon '{icon}'. Use one of: {names}.")
        return warnings

    OUTCOME_LABELS = {"yes", "no", "true", "false", "y", "n"}

    def _outcome_label_warnings(self, limit: int = 5) -> List[str]:
        """Yes/No labels belong on the branches of a decision. On an edge leaving a step they read as a
        question nobody asked, and the renderer draws them exactly like real outcomes."""
        stray = []
        for edge in self.edges:
            label = str(edge.get("label", "")).strip().lower().rstrip("?")
            src = self.node_map.get(edge.get("from"))
            if label in self.OUTCOME_LABELS and src and src.get("type") != "decision":
                dst = self.node_map.get(edge.get("to"), {})
                stray.append(
                    f"Edge '{edge.get('id')}' ({src.get('label', src['id'])} -> {dst.get('label', edge.get('to'))}) "
                    f"is labelled '{edge.get('label')}' but leaves a {src.get('type', 'task')}, not a decision. "
                    f"Clear the label, or make the source a decision."
                )
        if len(stray) > limit:
            stray = stray[:limit] + [f"... and {len(stray) - limit} more edges labelled Yes/No that do not leave a decision."]
        return stray

    NOTE_BUDGET = 140  # chars: about five lines of the 200px note card; keep in sync with references/types/flowchart.md

    def _note_warnings(self) -> List[str]:
        """Notes ("notes": [{id, text, nodes}]) add what labels cannot say. One linked to no existing step is never
        drawn; one that repeats its step's label adds nothing; one past the budget turns into a tall card that
        covers the gaps the other notes are fitted into."""
        warnings = []
        notes = self.data.get("notes") or []
        if not isinstance(notes, list):
            return ["\"notes\" must be a list of {\"id\", \"text\", \"nodes\"} objects."]
        for note in notes:
            text = str(note.get("text", "")).strip() if isinstance(note, dict) else ""
            nid = note.get("id", "?") if isinstance(note, dict) else "?"
            if not text:
                warnings.append(f"Note '{nid}' has no \"text\"; remove it.")
                continue
            ids = note.get("nodes") or []
            unknown = [i for i in ids if i not in self.node_map]
            if not ids or unknown:
                warnings.append(f"Note '{nid}' links to {'no step' if not ids else 'unknown node ids ' + ', '.join(map(str, unknown))}; "
                                f"\"nodes\" lists the ids of the steps it explains.")
            if len(text) > self.NOTE_BUDGET:
                warnings.append(f"Note '{nid}' is {len(text)} chars (budget {self.NOTE_BUDGET}). Keep the facts a reader needs; cut the rest.")
            labels = [str(self.node_map[i].get("label", "")).strip() for i in ids if i in self.node_map]
            if any(l and text.rstrip("?.!").lower() == l.rstrip("?.!").lower() for l in labels):
                warnings.append(f"Note '{nid}' repeats its step's label. Remove the note, or say what the label cannot.")
        return warnings

    def _count_crossings_from_polylines(
        self, polylines: Dict[str, List[Tuple[float, float]]]
    ) -> int:
        """Count orthogonal intersections between edges (perpendicular only for incident edges)."""
        crossings = 0
        listed = [e for e in self.edges if e["id"] in polylines]
        for i in range(len(listed)):
            e1 = listed[i]
            pts1 = polylines[e1["id"]]
            for j in range(i + 1, len(listed)):
                e2 = listed[j]
                incident = e1["from"] in (e2["from"], e2["to"]) or e1["to"] in (e2["from"], e2["to"])
                pts2 = polylines[e2["id"]]
                if self._polylines_intersect(pts1, pts2, incident=incident):
                    crossings += 1
        return crossings

    def _count_orthogonal_crossings(self) -> int:
        """Backward-compatible wrapper for counting crossings."""
        lane_tops: Dict[str, int] = {}
        curr_y = 0
        for lane in self.lanes:
            lid = lane["id"]
            lane_tops[lid] = curr_y
            max_y = max((n.get("y", 0) for n in self.nodes if n.get("laneId") == lid), default=48)
            h = max(lane.get("height", self.lane_min), max_y + self.base_h + self.bottom_pad)
            curr_y += h

        rects: Dict[str, Tuple[float, float, float, float]] = {}
        for n in self.nodes:
            nx = float(n.get("x", 0))
            ny = float(lane_tops.get(n["laneId"], 0) + n.get("y", 0))
            nh = float(self.node_h(n))
            rects[n["id"]] = (nx, ny, float(self.node_w), nh)

        polylines = self._route_all_edges(rects)
        return self._count_crossings_from_polylines(polylines)

    def _route_all_edges(
        self, rects: Dict[str, Tuple[float, float, float, float]]
    ) -> Dict[str, List[Tuple[float, float]]]:
        """Mirror the in-browser planar orthogonal routing algorithm."""
        out_edges: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        in_edges: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for e in self.edges:
            if e["from"] in rects and e["to"] in rects:
                out_edges[e["from"]].append(e)
                in_edges[e["to"]].append(e)

        def segment_clear(x1: float, y1: float, x2: float, y2: float, ignore: Tuple[str, ...]) -> bool:
            """True when an axis-aligned segment keeps 6px clear of every node except `ignore`."""
            min_x, max_x = min(x1, x2) - 6, max(x1, x2) + 6
            min_y, max_y = min(y1, y2) - 6, max(y1, y2) + 6
            for oid, (ox, oy, ow, oh) in rects.items():
                if oid in ignore:
                    continue
                if ox < max_x and ox + ow > min_x and oy < max_y and oy + oh > min_y:
                    return False
            return True

        def back_route_bends(f, t, fp: str, tp: str, ids: Tuple[str, ...]) -> Optional[int]:
            """Bend count of a candidate backward-arrow route, or None if invalid or blocked."""
            fx, fy, fw, fh = f
            tx, ty, tw, th = t
            fcx, fcy, tcx, tcy = fx + fw / 2, fy + fh / 2, tx + tw / 2, ty + th / 2
            if fp == "left" and tp == "right":
                sx, sy, ex, ey = fx, fcy, tx + tw, tcy
                if ex > sx - 12:
                    return None
                if abs(sy - ey) < 6:
                    pts = [(sx, sy), (ex, sy)]
                else:
                    mx = (sx + ex) / 2
                    pts = [(sx, sy), (mx, sy), (mx, ey), (ex, ey)]
            elif fp == "left":
                sx, sy, ex = fx, fcy, tcx
                ey = ty if tp == "top" else ty + th
                if ex > sx - 20 or (sy >= ey - 8 if tp == "top" else sy <= ey + 8):
                    return None
                pts = [(sx, sy), (ex, sy), (ex, ey)]
            elif tp == "right":
                sx, sy = fcx, (fy if fp == "top" else fy + fh)
                ex, ey = tx + tw, tcy
                if ex > sx - 20 or (ey >= sy - 8 if fp == "top" else ey <= sy + 8):
                    return None
                pts = [(sx, sy), (sx, ey), (ex, ey)]
            elif fp == "bottom" and tp == "bottom":
                sy, ey = fy + fh, ty + th
                g = max(sy, ey) + 20
                pts = [(fcx, sy), (fcx, g), (tcx, g), (tcx, ey)]
            else:
                return None
            for i in range(len(pts) - 1):
                if not segment_clear(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], ids):
                    return None
            return len(pts) - 2

        # Backward arrows: fewest-bend clear route, falling back to the legacy fixed rule
        back_ports: Dict[str, Tuple[str, str]] = {}
        for e in self.edges:
            if e["from"] not in rects or e["to"] not in rects:
                continue
            f, t = rects[e["from"]], rects[e["to"]]
            fcx, fcy = f[0] + f[2] / 2, f[1] + f[3] / 2
            tcx, tcy = t[0] + t[2] / 2, t[1] + t[3] / 2
            if not tcx < fcx - 30:
                continue
            dy = tcy - fcy
            legacy = ("left", "top") if dy > 30 else ("left", "bottom") if dy < -30 else ("bottom", "bottom")
            left_exit_free = not any(
                ie is not e and rects[ie["from"]][0] + rects[ie["from"]][2] / 2 < fcx - 30
                and abs(rects[ie["from"]][1] + rects[ie["from"]][3] / 2 - fcy) <= 30
                for ie in in_edges[e["from"]]
            )
            right_entry_free = not any(
                o is not e and rects[o["to"]][0] + rects[o["to"]][2] / 2 >= tcx - 30
                and abs(rects[o["to"]][0] + rects[o["to"]][2] / 2 - tcx) >= 30
                for o in out_edges[e["to"]]
            )
            same_row = abs(dy) <= 30
            cands: List[Tuple[str, str]] = []
            if right_entry_free:
                if left_exit_free:
                    cands.append(("left", "right"))
                if not same_row:
                    cands.append(("top" if dy < 0 else "bottom", "right"))
            if not same_row and left_exit_free:
                cands.append(("left", "bottom" if dy < 0 else "top"))
            cands.append(("bottom", "bottom"))
            best: Optional[Tuple[int, Tuple[str, str]]] = None
            for cand in cands:
                bends = back_route_bends(f, t, cand[0], cand[1], (e["from"], e["to"]))
                if bends is None:
                    continue
                if best is None or bends < best[0] or (bends == best[0] and cand == legacy):
                    best = (bends, cand)
            back_ports[e["id"]] = best[1] if best else legacy

        # Identify which nodes have a leftward loopback leaving their 'left' port
        has_left_loopback: Set[str] = set()
        for e in self.edges:
            bp = back_ports.get(e["id"])
            if bp and bp[0] == "left":
                tr, fr = rects[e["to"]], rects[e["from"]]
                if abs((tr[1] + tr[3] / 2) - (fr[1] + fr[3] / 2)) > 30:
                    has_left_loopback.add(e["from"])

        # Port selection per edge
        ports: Dict[str, Tuple[str, str]] = {}
        vertical_entry: Set[Tuple[str, bool]] = set()
        for u_id, u_outs in out_edges.items():
            fx, fy, fw, fh = rects[u_id]
            fcx, fcy = fx + fw / 2, fy + fh / 2
            u_node = self.node_map[u_id]

            fwd_outs = []
            for e in u_outs:
                tx, ty, tw, th = rects[e["to"]]
                tcx, tcy = tx + tw / 2, ty + th / 2
                if tcx < fcx - 30:
                    ports[e["id"]] = back_ports[e["id"]]
                else:
                    fwd_outs.append(e)

            # Assign forward exit ports
            top_taken = False
            bottom_taken = False
            # Sort upward candidates by target Y ascending, downward by target Y descending
            up_cands = [
                e for e in fwd_outs if (rects[e["to"]][1] + rects[e["to"]][3] / 2) < fcy - 30
            ]
            down_cands = [
                e for e in fwd_outs if (rects[e["to"]][1] + rects[e["to"]][3] / 2) > fcy + 30
            ]
            up_cands.sort(key=lambda e: rects[e["to"]][1])
            down_cands.sort(key=lambda e: rects[e["to"]][1], reverse=True)
            # A target directly above/below gets the top/bottom exit (straight line)
            up_cands.sort(key=lambda e: 0 if abs(rects[e["to"]][0] + rects[e["to"]][2] / 2 - fcx) < 30 else 1)
            down_cands.sort(key=lambda e: 0 if abs(rects[e["to"]][0] + rects[e["to"]][2] / 2 - fcx) < 30 else 1)

            is_multi_or_decision = u_node.get("type") == "decision" or len(fwd_outs) > 1
            top_edge_id = up_cands[0]["id"] if (is_multi_or_decision and up_cands) else None
            bottom_edge_id = down_cands[0]["id"] if (is_multi_or_decision and down_cands) else None
            if not top_edge_id and up_cands and abs(rects[up_cands[0]["to"]][0] + rects[up_cands[0]["to"]][2] / 2 - fcx) < 30:
                top_edge_id = up_cands[0]["id"]
            if not bottom_edge_id and down_cands and abs(rects[down_cands[0]["to"]][0] + rects[down_cands[0]["to"]][2] / 2 - fcx) < 30:
                bottom_edge_id = down_cands[0]["id"]

            for e in fwd_outs:
                v_id = e["to"]
                tx, ty, tw, th = rects[v_id]
                tcy = ty + th / 2
                from_port = "right"
                if e["id"] == top_edge_id and not top_taken:
                    from_port = "top"
                    top_taken = True
                elif e["id"] == bottom_edge_id and not bottom_taken:
                    from_port = "bottom"
                    bottom_taken = True

                to_port = "left"
                if v_id in has_left_loopback and abs(tcy - fcy) > 30:
                    to_port = "bottom" if tcy < fcy else "top"
                elif (from_port == "right" and len(fwd_outs) == 1 and u_node.get("type") != "decision"
                        and abs(tcy - fcy) > 30 and (abs(tx + tw / 2 - fcx) < 30 or tx > fcx + 40)):
                    # One step into another lane: top/bottom exit gives a single-bend L
                    from_port = "bottom" if tcy > fcy else "top"
                if from_port in ("top", "bottom") and abs((tx + tw / 2) - fcx) < 30:
                    to_port = "top" if tcy > fcy else "bottom"
                elif (from_port == "right" and to_port == "left" and abs(tcy - fcy) > 30
                        and tx + tw / 2 > fx + fw + 24 and (v_id, tcy > fcy) not in vertical_entry):
                    # Side exit into another lane: enter via bottom/top (one bend)
                    # unless an intermediate node obstructs the vertical drop at tcx
                    min_y, max_y = min(fcy, tcy), max(fcy, tcy)
                    blocked = False
                    for other_node in self.nodes:
                        oid = other_node["id"]
                        if oid == u_id or oid == v_id or oid not in rects:
                            continue
                        ox, oy, ow, oh = rects[oid]
                        if ox - 3 <= tcx <= ox + ow + 3 and oy < max_y and oy + oh > min_y:
                            blocked = True
                            break
                    if not blocked:
                        to_port = "top" if tcy > fcy else "bottom"
                        vertical_entry.add((v_id, tcy > fcy))
                ports[e["id"]] = (from_port, to_port)

        # Build polylines
        result: Dict[str, List[Tuple[float, float]]] = {}
        for e in self.edges:
            eid = e["id"]
            if eid not in ports:
                continue
            from_port, to_port = ports[eid]
            fx, fy, fw, fh = rects[e["from"]]
            tx, ty, tw, th = rects[e["to"]]
            fcx, fcy = fx + fw / 2, fy + fh / 2
            tcx, tcy = tx + tw / 2, ty + th / 2

            if to_port == "right":
                ex, ey = tx + tw, tcy
                if from_port == "left":
                    if abs(fcy - ey) < 6:
                        result[eid] = [(fx, fcy), (ex, fcy)]
                    else:
                        mx = (fx + ex) / 2
                        result[eid] = [(fx, fcy), (mx, fcy), (mx, ey), (ex, ey)]
                else:
                    sy = fy if from_port == "top" else fy + fh
                    result[eid] = [(fcx, sy), (fcx, ey), (ex, ey)]
            elif from_port == "left" and to_port in ("top", "bottom"):
                ey = ty if to_port == "top" else ty + th
                x_exit = fx - 24
                ids = (e["from"], e["to"])
                direct = (
                    (fcy < ey - 8 if to_port == "top" else fcy > ey + 8)
                    and tcx < fx - 20
                    and segment_clear(tcx, fcy, fx, fcy, ids)
                    and segment_clear(tcx, fcy, tcx, ey, ids)
                )
                if direct:
                    result[eid] = [(fx, fcy), (tcx, fcy), (tcx, ey)]
                    continue
                # Dedicated Outer Bypass Corridor: route outside node rows
                if to_port == "top":
                    bypass_y = min(fy - 20, ty - 20)
                else:
                    bypass_y = max(fy + fh + 20, ty + th + 20)
                bypass_y = max(20.0, bypass_y)
                result[eid] = [(fx, fcy), (x_exit, fcy), (x_exit, bypass_y), (tcx, bypass_y), (tcx, ey)]
            elif from_port in ("top", "bottom") and to_port in ("top", "bottom"):
                sy = fy if from_port == "top" else fy + fh
                ey = ty if to_port == "top" else ty + th
                if tcx < fcx - 30:  # Leftward loopback
                    gutter_y = min(fy - 20, ty - 20) if from_port == "top" else max(fy + fh + 20, ty + th + 20)
                    result[eid] = [(fcx, sy), (fcx, gutter_y), (tcx, gutter_y), (tcx, ey)]
                elif abs(fcx - tcx) < 1:
                    result[eid] = [(fcx, sy), (tcx, ey)]
                else:
                    mid_y = (sy + ey) / 2
                    result[eid] = [(fcx, sy), (fcx, mid_y), (tcx, mid_y), (tcx, ey)]
            elif from_port == "right" and to_port in ("top", "bottom"):
                ey = ty if to_port == "top" else ty + th
                result[eid] = [(fx + fw, fcy), (tcx, fcy), (tcx, ey)]
            elif from_port in ("top", "bottom") and to_port == "left":
                sy = fy if from_port == "top" else fy + fh
                result[eid] = [(fcx, sy), (fcx, tcy), (tx, tcy)]
            else:
                sx, sy = fx + fw, fcy
                ex, ey = tx, tcy
                if abs(sy - ey) < 2:
                    result[eid] = [(sx, sy), (ex, sy)]
                else:
                    mid_x = sx + (ex - sx) / 2
                    result[eid] = [(sx, sy), (mid_x, sy), (mid_x, ey), (ex, ey)]

        self._reroute_by_cost(result, rects, ports, segment_clear)
        return result

    def _lane_dividers(self) -> List[float]:
        """Y of every boundary between two stacked lanes (mirrors the browser's lane layout)."""
        dividers: List[float] = []
        curr_y = 0.0
        for lane in self.lanes[:-1]:
            lid = lane["id"]
            max_y = max((n.get("y", 0) for n in self.nodes if n.get("laneId") == lid), default=48)
            curr_y += max(lane.get("height", self.lane_min), max_y + self.base_h + self.bottom_pad)
            dividers.append(curr_y)
        return dividers

    def _reroute_by_cost(self, result, rects, ports, segment_clear) -> None:
        """Mirror of the browser's step 5a. Cost: overlap >> near-parallel > crossing (~1.75 bends)
        > bend > length, plus lane-divider hugging, crowding a node and left/right port clashes.
        Longest arrows go first; arrows already clean keep their standard route; switching needs a
        clear win (hysteresis), and changing sides is penalised against sliding a channel."""
        C_OVERLAP, C_NEAR, C_CROSS, C_BEND, C_DIVIDER, C_NEAR_NODE, C_PORT, C_SHARED_BRANCH = (
            20000, 2500, 1750, 1000, 1500, 600, 2500, 1200
        )
        dividers = self._lane_dividers()

        def poly_clear(pts, ids) -> bool:
            return all(segment_clear(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], ids)
                       for i in range(len(pts) - 1))

        def relate(pts, other, skip_first: bool = False, skip_last: bool = False):
            overlap = near = cross = 0.0
            for i in range(len(pts) - 1):
                (ax, ay), (bx, by) = pts[i], pts[i + 1]
                a_v, a_h = abs(ax - bx) < 1, abs(ay - by) < 1
                for j in range(len(other) - 1):
                    if skip_first and i == 0 and j == 0:
                        continue
                    if skip_last and i == len(pts) - 2 and j == len(other) - 2:
                        continue
                    (cx, cy), (dx, dy) = other[j], other[j + 1]
                    c_v, c_h = abs(cx - dx) < 1, abs(cy - dy) < 1
                    if a_v and c_v:
                        run = min(max(ay, by), max(cy, dy)) - max(min(ay, by), min(cy, dy))
                        if run > 1:
                            gap = abs(ax - cx)
                            if gap < 2:
                                overlap += run
                            elif gap < 18:
                                near += 1
                    elif a_h and c_h:
                        run = min(max(ax, bx), max(cx, dx)) - max(min(ax, bx), min(cx, dx))
                        if run > 1:
                            gap = abs(ay - cy)
                            if gap < 2:
                                overlap += run
                            elif gap < 18:
                                near += 1
                    elif (a_v and c_h) or (a_h and c_v):
                        if a_v:
                            vx, vy1, vy2, hy, hx1, hx2 = ax, min(ay, by), max(ay, by), cy, min(cx, dx), max(cx, dx)
                        else:
                            vx, vy1, vy2, hy, hx1, hx2 = cx, min(cy, dy), max(cy, dy), ay, min(ax, bx), max(ax, bx)
                        if hx1 + 1 < vx < hx2 - 1 and vy1 + 1 < hy < vy2 - 1:
                            cross += 1
            return overlap, near, cross

        def defects(pts, ids) -> float:
            d = 0.0
            for i in range(len(pts) - 1):
                (ax, ay), (bx, by) = pts[i], pts[i + 1]
                if abs(ay - by) < 1 and abs(ax - bx) > 30 and any(abs(ay - y) < 8 for y in dividers):
                    d += C_DIVIDER
                x1, x2 = min(ax, bx) - 14, max(ax, bx) + 14
                y1, y2 = min(ay, by) - 14, max(ay, by) + 14
                if any(oid not in ids and ox < x2 and ox + ow > x1 and oy < y2 and oy + oh > y1
                       for oid, (ox, oy, ow, oh) in rects.items()):
                    d += C_NEAR_NODE
            return d

        def port_clashes(e, fp, tp) -> int:
            n = 0
            for o in self.edges:
                if o is e or o["id"] not in ports:
                    continue
                if o["from"] == e["to"] and tp in ("left", "right") and ports[o["id"]][0] == tp:
                    n += 1
                if o["to"] == e["from"] and fp in ("left", "right") and ports[o["id"]][1] == fp:
                    n += 1
            return n

        def shared_branch_vertex(e, fp) -> int:
            fn = self.node_map.get(e["from"])
            if not fn or fn.get("type") != "decision":
                return 0
            lbl = (e.get("label") or "").strip().lower()
            n = 0
            for o in self.edges:
                if o is not e and o["from"] == e["from"] and o["id"] in ports and ports[o["id"]][0] == fp:
                    if lbl != (o.get("label") or "").strip().lower():
                        n += 1
            return n

        def route_cost(pts, e, others, fp, tp, limit=float("inf")):
            ids = (e["from"], e["to"])
            length = sum(abs(pts[i + 1][0] - pts[i][0]) + abs(pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1))
            if (len(pts) - 2) * C_BEND + length >= limit:
                return None  # cannot beat the best so far
            if not poly_clear(pts, ids):
                return None
            defect = (
                defects(pts, ids)
                + port_clashes(e, fp, tp) * C_PORT
                + shared_branch_vertex(e, fp) * C_SHARED_BRANCH
            )
            for o in others:
                op = ports.get(o["id"])
                skip_first = bool(op and o["from"] == e["from"] and op[0] == fp)
                skip_last = bool(op and o["to"] == e["to"] and op[1] == tp)
                ov, ne, cr = relate(pts, result[o["id"]], skip_first, skip_last)
                incident = bool({o["from"], o["to"]} & {e["from"], e["to"]})
                defect += (C_OVERLAP + ov if ov > 0 else 0) + (0 if incident else ne * C_NEAR) + cr * C_CROSS
            return (len(pts) - 2) * C_BEND + length + defect, defect

        def anchor(r, side):
            x, y, w, h = r
            return {"top": (x + w / 2, y), "bottom": (x + w / 2, y + h),
                    "left": (x, y + h / 2), "right": (x + w, y + h / 2)}[side]

        bounds = (min(r[0] for r in rects.values()), max(r[0] + r[2] for r in rects.values()),
                  min(r[1] for r in rects.values()), max(r[1] + r[3] for r in rects.values()))

        def alt_routes(f, t, deep):
            sides = ("top", "bottom", "left", "right")
            horiz = lambda s_: s_ in ("left", "right")
            for fp in sides:
                for tp in sides:
                    (sx, sy), (ex, ey) = anchor(f, fp), anchor(t, tp)
                    if horiz(fp) and horiz(tp):
                        if fp == tp:
                            continue
                        if not (ex > sx + 28 if fp == "right" else ex < sx - 28):
                            continue
                        if abs(sy - ey) < 6:
                            yield fp, tp, [(sx, sy), (ex, ey)], 0.0
                            continue
                        x = min(sx, ex) + 14
                        while x <= max(sx, ex) - 14:
                            yield fp, tp, [(sx, sy), (x, sy), (x, ey), (ex, ey)], abs(x - (sx + ex) / 2)
                            x += 10
                    elif not horiz(fp) and not horiz(tp):
                        if fp != tp:
                            if not (ey > sy + 28 if fp == "bottom" else ey < sy - 28):
                                continue
                            if abs(sx - ex) < 1:
                                yield fp, tp, [(sx, sy), (ex, ey)], 0.0
                                continue
                            y = min(sy, ey) + 14
                            while y <= max(sy, ey) - 14:
                                yield fp, tp, [(sx, sy), (sx, y), (ex, y), (ex, ey)], abs(y - (sy + ey) / 2)
                                y += 10
                        else:
                            for d in (14, 20, 28, 36, 48, 72):
                                g = min(sy, ey) - d if fp == "top" else max(sy, ey) + d
                                if g >= 8:
                                    yield fp, tp, [(sx, sy), (sx, g), (ex, g), (ex, ey)], 0.0
                    else:
                        # mixed orientation: one-bend L, then (if asked) three-bend corridor routes
                        if horiz(fp):
                            if not ((ex <= sx + 20) if fp == "right" else (ex >= sx - 20)) \
                                    and not ((ey <= sy + 8) if tp == "top" else (ey >= sy - 8)):
                                yield fp, tp, [(sx, sy), (ex, sy), (ex, ey)], 0.0
                        else:
                            if not ((sy <= ey + 8) if fp == "top" else (sy >= ey - 8)) \
                                    and not ((ex <= sx + 20) if tp == "left" else (ex >= sx - 20)):
                                yield fp, tp, [(sx, sy), (sx, ey), (ex, ey)], 0.0
                        if not deep:
                            continue
                        if not horiz(fp):
                            for d in (16, 20, 36, 56):
                                g = sy - d if fp == "top" else sy + d
                                x = bounds[0] - 24
                                while x <= bounds[1] + 24:
                                    ok = x <= ex - 14 if tp == "left" else x >= ex + 14
                                    if ok and abs(x - sx) >= 10 and abs(ey - g) >= 10:
                                        yield fp, tp, [(sx, sy), (sx, g), (x, g), (x, ey), (ex, ey)], 0.0
                                    x += 16
                        else:
                            for d in (16, 20, 36, 56):
                                x = sx + d if fp == "right" else sx - d
                                g = bounds[2] - 24
                                while g <= bounds[3] + 24:
                                    ok = g <= ey - 14 if tp == "top" else g >= ey + 14
                                    if ok and abs(g - sy) >= 10 and abs(ex - x) >= 10:
                                        yield fp, tp, [(sx, sy), (x, sy), (x, g), (ex, g), (ex, ey)], 0.0
                                    g += 16

        def manhattan(e) -> float:
            f, t = rects[e["from"]], rects[e["to"]]
            return abs(f[0] + f[2] / 2 - t[0] - t[2] / 2) + abs(f[1] + f[3] / 2 - t[1] - t[3] / 2)

        for e in sorted((x for x in self.edges if x["id"] in result and x["from"] != x["to"]),
                        key=manhattan, reverse=True):
            eid = e["id"]
            cur_fp, cur_tp = ports[eid]
            others = [o for o in self.edges if o is not e and o["id"] in result]
            base = route_cost(result[eid], e, others, cur_fp, cur_tp)
            if base is not None and base[1] == 0:
                continue
            base_cost = float("inf") if base is None else base[0]
            best = None
            deep = base is None or base[1] >= C_CROSS
            for fp, tp, pts, dev in alt_routes(rects[e["from"]], rects[e["to"]], deep):
                r = route_cost(pts, e, others, fp, tp, best[0] if best else base_cost - 250)
                if r is None:
                    continue
                cost = r[0] + dev * 0.3 + (600 if (fp, tp) != (cur_fp, cur_tp) else 0)
                if best is None or cost < best[0]:
                    best = (cost, pts, fp, tp)
            if best and best[0] < base_cost - 250:
                result[eid] = best[1]
                ports[eid] = (best[2], best[3])

    @staticmethod
    def _polylines_intersect(
        pts1: List[Tuple[float, float]],
        pts2: List[Tuple[float, float]],
        incident: bool = False,
    ) -> bool:
        def seg_intersect(
            p1: Tuple[float, float],
            p2: Tuple[float, float],
            p3: Tuple[float, float],
            p4: Tuple[float, float],
        ) -> bool:
            v1, v2 = abs(p1[0] - p2[0]) < 1, abs(p3[0] - p4[0]) < 1  # vertical?
            h1, h2 = abs(p1[1] - p2[1]) < 1, abs(p3[1] - p4[1]) < 1  # horizontal?
            if (v1 and h2) or (h1 and v2):
                # Perpendicular: crossing strictly inside both segments (endpoint contacts are joins)
                (vx, vy1, vy2), (hy, hx1, hx2) = (
                    ((p1[0], min(p1[1], p2[1]), max(p1[1], p2[1])),
                     (p3[1], min(p3[0], p4[0]), max(p3[0], p4[0])))
                    if v1 else
                    ((p3[0], min(p3[1], p4[1]), max(p3[1], p4[1])),
                     (p1[1], min(p1[0], p2[0]), max(p1[0], p2[0])))
                )
                return hx1 + 1 < vx < hx2 - 1 and vy1 + 1 < hy < vy2 - 1
            if incident:
                return False
            # Parallel: only a real overlap along a shared line counts
            x1, y1 = min(p1[0], p2[0]), min(p1[1], p2[1])
            x2, y2 = max(p1[0], p2[0]), max(p1[1], p2[1])
            x3, y3 = min(p3[0], p4[0]), min(p3[1], p4[1])
            x4, y4 = max(p3[0], p4[0]), max(p3[1], p4[1])
            if v1 and v2:
                return abs(x1 - x3) < 1 and min(y2, y4) - max(y1, y3) > 1
            if h1 and h2:
                return abs(y1 - y3) < 1 and min(x2, x4) - max(x1, x3) > 1
            return False

        for i in range(len(pts1) - 1):
            for j in range(len(pts2) - 1):
                if seg_intersect(pts1[i], pts1[i + 1], pts2[j], pts2[j + 1]):
                    return True
        return False


def normalize_diagram_type(data: Dict[str, Any]) -> Dict[str, Any]:
    """Stamp diagramType/schemaVersion (files without them are flowcharts); reject unsupported types."""
    kind = data.get("diagramType") or DEFAULT_TYPE
    if kind not in SUPPORTED_TYPES:
        raise SystemExit(
            f"[ERROR] Unsupported diagramType {kind!r}. Supported: {', '.join(SUPPORTED_TYPES)}."
        )
    data["diagramType"] = kind
    data.setdefault("schemaVersion", SCHEMA_VERSION)
    return data


def extract_data_from_html(html_content: str) -> Dict[str, Any]:
    """Extract the canonical diagram JSON block from standalone HTML."""
    for block_id in DATA_BLOCK_IDS:
        match = re.search(
            rf'<script id="{block_id}" type="application/json">\s*([\s\S]*?)\s*</script>',
            html_content,
        )
        if match:
            return json.loads(match.group(1))
    raise ValueError('Could not find the diagram data block (<script id="diagram-data">) in the specified HTML file.')


AUDITS = {"flowchart": FlowchartAudit, "sequence": SequenceAudit}

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"
DATA_BLOCK_IDS = ("diagram-data", "flowchart-data")  # flowchart-data: pages saved before the shell split


def _read_asset(path: Path) -> str:
    return path.read_text(encoding="utf-8")  # text mode normalizes CRLF to LF


def assemble_page(kind: str, data: Optional[Dict[str, Any]] = None) -> str:
    """Build one standalone HTML page: shared shell + the diagram type's plugin, with `data` embedded."""
    type_dir = ASSETS_DIR / "types" / kind
    if not type_dir.is_dir():
        raise FileNotFoundError(f"No assets for diagram type {kind!r} at: {type_dir}")
    meta = json.loads(_read_asset(type_dir / "meta.json"))
    payload = _read_asset(type_dir / "default.json").rstrip(chr(10)) if data is None else json.dumps(data, indent=2)
    # Optional per-type icon set (name -> SVG inner markup), embedded so the page stays self-contained
    icons_path = type_dir / "icons.json"
    icons_js = f"const TYPE_ICONS = {json.dumps(json.loads(_read_asset(icons_path)), separators=(',', ':'))};\n" if icons_path.is_file() else ""
    parts = {
        "TYPE_TITLE": meta["title"],
        "SHELL_CSS": _read_asset(ASSETS_DIR / "shell" / "shell.css").rstrip(chr(10)),
        "TYPE_CSS": _read_asset(type_dir / f"{kind}.css").rstrip(chr(10)),
        "TYPE_TOOLBAR": _read_asset(type_dir / "toolbar.html").rstrip(chr(10)),
        "TYPE_ICON": _read_asset(type_dir / "icon.html").strip(),
        "TYPE_CHROME": _read_asset(type_dir / "chrome.html"),
        "TYPE_STAGE": _read_asset(type_dir / "stage.html").rstrip(chr(10)),
        "TYPE_HELP": _read_asset(type_dir / "help.html").rstrip(chr(10)),
        "SHELL_HELP": _read_asset(ASSETS_DIR / "shell" / "help.html").rstrip(chr(10)),
        "DATA": payload,
        "SHELL_JS": _read_asset(ASSETS_DIR / "shell" / "shell.js").rstrip(chr(10)),
        "ENGINE_JS": _read_asset(type_dir / "engine.js").rstrip(chr(10)),
        "TYPE_JS": icons_js + _read_asset(type_dir / f"{kind}.js").rstrip(chr(10)),
    }
    # One pass: substituted text is never re-scanned, and an unknown placeholder fails loudly.
    return re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: parts[m.group(1)], _read_asset(ASSETS_DIR / "shell" / "shell.html"))


def find_external_refs(html_text: str) -> List[str]:
    """Network references that would break the self-contained page."""
    return sorted(set(re.findall(
        r"""(?:src|href)\s*=\s*["']https?://[^"']+|@import[^;]+|url\(\s*["']?https?://[^)]+""",
        html_text,
    )))


def scaffold_html(data: Dict[str, Any], output_path: Path):
    """Write the standalone HTML for `data` (its diagramType selects the plugin)."""
    html_text = assemble_page(data.get("diagramType") or DEFAULT_TYPE, data)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html_text, encoding="utf-8")
    print(f"[OK] Generated interactive {data.get('diagramType') or DEFAULT_TYPE}: {output_path}")


def _ensure_utf8_output() -> None:
    """Avoid UnicodeEncodeError on Windows consoles that default to cp1252."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def main():
    _ensure_utf8_output()
    parser = argparse.ArgumentParser(description="Multi-Swimlane Flowchart Layout & Verification Engine")
    parser.add_argument("--layout", "-l", help="Input JSON file or HTML file to compute layout for")
    parser.add_argument("--output", "-o", help="Output HTML file path (or JSON path if extracting)")
    parser.add_argument("--browser", help="Chrome/Chromium path for --layout when Node.js is not installed")
    parser.add_argument("--timeout", type=int, default=30, help="Seconds allowed for the layout engine (default: 30)")
    parser.add_argument("--verify", "-v", help="Verify collisions and layout constraints for an HTML or JSON file")
    parser.add_argument("--extract", "-e", help="Extract canonical JSON data from an existing HTML file")
    parser.add_argument("--screenshot", "-s",
                        help="With --layout: also render a PNG here and run the layout report (one command does both)")
    parser.epilog = "SKILL.md documents every flag an agent needs; no others are required."

    args = parser.parse_args()

    if args.extract:
        html_path = Path(args.extract)
        data = extract_data_from_html(html_path.read_text(encoding="utf-8"))
        if args.output:
            out_p = Path(args.output)
            out_p.parent.mkdir(parents=True, exist_ok=True)
            out_p.write_text(json.dumps(data, indent=2), encoding="utf-8")
            print(f"[OK] Extracted data saved to: {out_p}")
        else:
            print(json.dumps(data, indent=2))
        return

    if args.verify:
        p = Path(args.verify)
        external_refs: List[str] = []
        if p.suffix == ".html":
            html_text = p.read_text(encoding="utf-8")
            data = extract_data_from_html(html_text)
            external_refs = find_external_refs(html_text)
        else:
            data = json.loads(p.read_text(encoding="utf-8"))

        data = normalize_diagram_type(data)
        audit = AUDITS[data["diagramType"]](data)
        report = audit.verify_collisions()

        print(f"\n======================================================================")
        print(f"--- {audit.title} Verification & Quality Audit: {p.name} ---")
        print(f"======================================================================")
        for line in audit.summary_lines(report):
            print(line)
        if p.suffix == ".html":
            print(f"{'✓' if not external_refs else '✗'} Self-Containment:              {len(external_refs)} external references")
        print(f"======================================================================")

        for warning in report["budget_warnings"]:
            print(f"[WARN] {warning}")
        if external_refs:
            print("[FAIL] HTML loads external resources (must be fully self-contained):")
            for ref in external_refs:
                print(f"  - {ref}")
            sys.exit(1)
        if report["passed"]:
            print("[PASS] Diagram satisfies all executive visual quality criteria.")
            sys.exit(0)
        else:
            print(f"[FAIL] Quality score {report['score']}/100 did not meet threshold (>= 90):")
            for issue in report["issues"]:
                print(f"  - {issue}")
            sys.exit(1)

    if args.layout:
        in_p = Path(args.layout)
        if in_p.suffix == ".html":
            data = extract_data_from_html(in_p.read_text(encoding="utf-8"))
        else:
            data = json.loads(in_p.read_text(encoding="utf-8"))

        data = normalize_diagram_type(data)
        try:
            laid_out_data = run_layout(data["diagramType"], data, timeout=args.timeout, browser=args.browser)
        except EngineUnavailable as exc:
            sys.exit(f"[ERROR] {exc}")
        audit = AUDITS[data["diagramType"]](laid_out_data)
        report = audit.verify_collisions()

        out_path = Path(args.output) if args.output else in_p.with_suffix(".html")
        scaffold_html(laid_out_data, out_path)

        # Same gates as --verify, so the agent never needs a second audit run.
        failed = False
        for warning in report["budget_warnings"]:
            print(f"[WARN] {warning}")
        external_refs = find_external_refs(out_path.read_text(encoding="utf-8"))
        if external_refs:
            failed = True
            print("[FAIL] HTML loads external resources (must be fully self-contained):")
            for ref in external_refs:
                print(f"  - {ref}")
        if not report["passed"]:
            failed = True
            print(f"[FAIL] Quality score {report['score']}/100 did not meet threshold (>= 90); HTML still written:")
            for issue in report["issues"]:
                print(f"  - {issue}")
        else:
            print(audit.pass_line(report))

        clean = not failed and not report["budget_warnings"]
        render_code = 0
        if args.screenshot:
            render_code, render_clean = run_render(out_path, Path(args.screenshot), args.browser)
            clean = clean and render_clean
            print("[DONE] Clean. View the PNG once against the visual checklist; if it passes, the diagram is final: "
                  "do not re-word, re-run or re-render." if clean else
                  "[NEXT] Fix only the [WARN]/[FAIL]/[ERROR] lines above, then re-run this same command.")
        if failed:
            sys.exit(1)
        if render_code:
            sys.exit(render_code)


def run_render(html_path: Path, png_path: Path, browser: Optional[str]) -> Tuple[int, bool]:
    """Run render_screenshot.py on the written HTML; return (exit code, clean = no WARN/ERROR lines)."""
    cmd = [sys.executable, str(Path(__file__).with_name("render_screenshot.py")),
           "--input", str(html_path), "--output", str(png_path)]
    if browser:
        cmd += ["--browser", browser]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = proc.stdout + proc.stderr
    print(out, end="" if out.endswith("\n") or not out else "\n")
    clean = proc.returncode == 0 and "[WARN]" not in out and "[ERROR]" not in out
    return proc.returncode, clean


if __name__ == "__main__":
    main()
