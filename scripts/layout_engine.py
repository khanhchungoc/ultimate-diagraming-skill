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
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from audit_sequence import SequenceAudit
from engine_runner import EngineUnavailable, run_layout


DEFAULT_COL_WIDTH = 240
START_X = 56

# Complexity budget (a diagram beyond these is too dense to read at Fit zoom on a 1920px screen)
SUPPORTED_TYPES = ("flowchart", "sequence")  # add a type here when its engine and reference exist
DEFAULT_TYPE = "flowchart"
SCHEMA_VERSION = 1

# Zero budget limits: diagrams can be as large as the user requires.
DEFAULT_NODE_WIDTH = 168
DEFAULT_NODE_HEIGHT = 56
DECISION_NODE_HEIGHT = 64
LANE_MIN_HEIGHT = 160
LANE_BOTTOM_PADDING = 48


class FlowchartAudit:
    def __init__(self, data: Dict[str, Any]):
        self.data = data
        self.lanes: List[Dict[str, Any]] = data.get("lanes", [])
        self.nodes: List[Dict[str, Any]] = data.get("nodes", [])
        self.edges: List[Dict[str, Any]] = data.get("edges", [])
        self.lane_map = {lane["id"]: idx for idx, lane in enumerate(self.lanes)}
        self.node_map = {node["id"]: node for node in self.nodes}

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
        5. Collinear Straightness (Ratio of 0-turn straight horizontal connections)
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
            h = max(lane.get("height", LANE_MIN_HEIGHT), max_y + DECISION_NODE_HEIGHT + 30)
            lane_heights[lid] = h
            curr_y += h

        # 2. Containment Checks
        for node in self.nodes:
            lid = node["laneId"]
            nh = DECISION_NODE_HEIGHT if node.get("type") == "decision" else DEFAULT_NODE_HEIGHT
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
            w1 = DEFAULT_NODE_WIDTH
            h1 = DECISION_NODE_HEIGHT if n1.get("type") == "decision" else DEFAULT_NODE_HEIGHT

            for j in range(i + 1, len(self.nodes)):
                n2 = self.nodes[j]
                if n1["laneId"] != n2["laneId"]:
                    continue
                x2 = n2.get("x", 0)
                y2 = n2.get("y", 0)
                w2 = DEFAULT_NODE_WIDTH
                h2 = DECISION_NODE_HEIGHT if n2.get("type") == "decision" else DEFAULT_NODE_HEIGHT

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
            nh = float(DECISION_NODE_HEIGHT if n.get("type") == "decision" else DEFAULT_NODE_HEIGHT)
            rects[n["id"]] = (nx, ny, float(DEFAULT_NODE_WIDTH), nh)

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
        column_count = int(round((max_x - START_X) / DEFAULT_COL_WIDTH)) + 1
        budget_warnings: List[str] = []

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

    def _count_crossings_from_polylines(
        self, polylines: Dict[str, List[Tuple[float, float]]]
    ) -> int:
        """Count orthogonal intersections between non-incident edges."""
        crossings = 0
        listed = [e for e in self.edges if e["id"] in polylines]
        for i in range(len(listed)):
            e1 = listed[i]
            pts1 = polylines[e1["id"]]
            for j in range(i + 1, len(listed)):
                e2 = listed[j]
                if e1["from"] in (e2["from"], e2["to"]) or e1["to"] in (e2["from"], e2["to"]):
                    continue
                pts2 = polylines[e2["id"]]
                if self._polylines_intersect(pts1, pts2):
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
            h = max(lane.get("height", LANE_MIN_HEIGHT), max_y + DEFAULT_NODE_HEIGHT + LANE_BOTTOM_PADDING)
            curr_y += h

        rects: Dict[str, Tuple[float, float, float, float]] = {}
        for n in self.nodes:
            nx = float(n.get("x", 0))
            ny = float(lane_tops.get(n["laneId"], 0) + n.get("y", 0))
            nh = float(DECISION_NODE_HEIGHT if n.get("type") == "decision" else DEFAULT_NODE_HEIGHT)
            rects[n["id"]] = (nx, ny, float(DEFAULT_NODE_WIDTH), nh)

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

        # Identify which nodes have a leftward loopback leaving their 'left' port
        has_left_loopback: Set[str] = set()
        for e in self.edges:
            if e["from"] not in rects or e["to"] not in rects:
                continue
            fx, fy, fw, fh = rects[e["from"]]
            tx, ty, tw, th = rects[e["to"]]
            if tx + tw / 2 < fx + fw / 2 - 30 and abs((ty + th / 2) - (fy + fh / 2)) > 30:
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
                    if tcy > fcy + 30:
                        ports[e["id"]] = ("left", "top")
                    elif tcy < fcy - 30:
                        ports[e["id"]] = ("left", "bottom")
                    else:
                        ports[e["id"]] = ("bottom", "bottom")
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
                if v_id in has_left_loopback:
                    to_port = "bottom" if tcy < fcy else "top"
                elif (from_port == "right" and len(fwd_outs) == 1 and u_node.get("type") != "decision"
                        and abs(tcy - fcy) > 30 and tx > fcx + 40):
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

            if from_port == "left" and to_port in ("top", "bottom"):
                ey = ty if to_port == "top" else ty + th
                x_exit = fx - 24
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
        return result

    @staticmethod
    def _polylines_intersect(
        pts1: List[Tuple[float, float]], pts2: List[Tuple[float, float]]
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
        "TYPE_JS": _read_asset(type_dir / f"{kind}.js").rstrip(chr(10)),
    }
    # One pass: substituted text is never re-scanned, and an unknown placeholder fails loudly.
    return re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: parts[m.group(1)], _read_asset(ASSETS_DIR / "shell" / "shell.html"))


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
            external_refs = sorted(set(re.findall(
                r"""(?:src|href)\s*=\s*["']https?://[^"']+|@import[^;]+|url\(\s*["']?https?://[^)]+""",
                html_text,
            )))
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

        if not report["passed"]:
            print(f"[WARNING] Layout computed with quality score {report['score']}/100 ({report['grade']}):")
            for issue in report["issues"]:
                print(f"  - {issue}")
        else:
            print(audit.pass_line(report))


if __name__ == "__main__":
    main()
