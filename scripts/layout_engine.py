#!/usr/bin/env python3
"""Autonomous Layout & Verification Engine for Interactive Multi-Swimlane Flowcharts.

Features:
- Sugiyama layered layout constrained to swimlanes (topological rank leveling).
- Barycentric crossing reduction for parallel branches.
- Dynamic lane height computation to prevent vertical node overflow.
- Overlap detection and zero-penetration collision verification.
- Scaffolding into self-saving standalone HTML templates.
- Extraction of live JSON state from edited HTML files.

Zero external dependencies (uses standard library Python 3).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple


DEFAULT_COL_WIDTH = 240
START_X = 56

# Complexity budget (a diagram beyond these is too dense to read at Fit zoom on a 1920px screen)
MAX_NODES = 12
MAX_LANES = 5
MAX_COLUMNS = 7
DEFAULT_ROW_HEIGHT = 96
DEFAULT_NODE_WIDTH = 168
DEFAULT_NODE_HEIGHT = 56
DECISION_NODE_HEIGHT = 64
LANE_MIN_HEIGHT = 160
LANE_TOP_PADDING = 48
LANE_BOTTOM_PADDING = 48


class SwimlaneLayoutEngine:
    def __init__(self, data: Dict[str, Any]):
        self.data = data
        self.lanes: List[Dict[str, Any]] = data.get("lanes", [])
        self.nodes: List[Dict[str, Any]] = data.get("nodes", [])
        self.edges: List[Dict[str, Any]] = data.get("edges", [])
        self.lane_map = {lane["id"]: idx for idx, lane in enumerate(self.lanes)}
        self.node_map = {node["id"]: node for node in self.nodes}

    def compute_layout(self) -> Dict[str, Any]:
        """Compute optimal collision-free coordinates for all nodes in their swimlanes."""
        if not self.nodes:
            return self.data

        # 1. Build adjacency graph & detect cycles/back-edges
        adj: Dict[str, List[str]] = defaultdict(list)
        rev_adj: Dict[str, List[str]] = defaultdict(list)
        for edge in self.edges:
            adj[edge["from"]].append(edge["to"])
            rev_adj[edge["to"]].append(edge["from"])

        # Edges marked "feedback": true are always loops; DFS only decides the rest.
        forced_back = {(e["from"], e["to"]) for e in self.edges if e.get("feedback")}
        search_adj: Dict[str, List[str]] = defaultdict(list)
        for edge in self.edges:
            if (edge["from"], edge["to"]) not in forced_back:
                search_adj[edge["from"]].append(edge["to"])
        back_edges = self._find_back_edges(search_adj) | forced_back
        forward_edges = [e for e in self.edges if (e["from"], e["to"]) not in back_edges]

        fwd_adj: Dict[str, List[str]] = defaultdict(list)
        fwd_in_degree: Dict[str, int] = {node["id"]: 0 for node in self.nodes}
        for edge in forward_edges:
            fwd_adj[edge["from"]].append(edge["to"])
            fwd_in_degree[edge["to"]] = fwd_in_degree.get(edge["to"], 0) + 1

        # 2. Topological rank assignment (longest path layering)
        ranks = self._assign_topological_ranks(fwd_adj, fwd_in_degree)

        # 3. Group nodes by (laneId, rank) and order by barycenter
        lane_rank_groups: Dict[Tuple[str, int], List[Dict[str, Any]]] = defaultdict(list)
        for node in self.nodes:
            r = ranks.get(node["id"], 0)
            lane_rank_groups[(node["laneId"], r)].append(node)

        for (lane_id, r), group in lane_rank_groups.items():
            if len(group) > 1:
                group.sort(key=lambda n: self._compute_barycenter(n["id"], rev_adj, ranks))

        # 4. Compute lane heights & vertical positions
        lane_subrows: Dict[str, int] = defaultdict(lambda: 1)
        for (lane_id, r), group in lane_rank_groups.items():
            lane_subrows[lane_id] = max(lane_subrows[lane_id], len(group))

        lane_positions: Dict[str, Tuple[int, int]] = {}
        curr_y = 0
        for lane in self.lanes:
            lid = lane["id"]
            subrows = lane_subrows[lid]
            max_node_h = max(
                (DECISION_NODE_HEIGHT if n.get("type") == "decision" else DEFAULT_NODE_HEIGHT for n in self.nodes if n.get("laneId") == lid),
                default=DEFAULT_NODE_HEIGHT
            )
            req_height = LANE_TOP_PADDING + (subrows - 1) * DEFAULT_ROW_HEIGHT + max_node_h + LANE_BOTTOM_PADDING
            height = max(LANE_MIN_HEIGHT, req_height)
            lane["height"] = height
            lane_positions[lid] = (curr_y, height)
            curr_y += height

        # 5. Assign concrete X, Y coordinates
        start_x = START_X
        for (lane_id, r), group in lane_rank_groups.items():
            lane_top, lane_height = lane_positions.get(lane_id, (0, LANE_MIN_HEIGHT))
            for sub_idx, node in enumerate(group):
                nh = DECISION_NODE_HEIGHT if node.get("type") == "decision" else DEFAULT_NODE_HEIGHT
                node["x"] = start_x + r * DEFAULT_COL_WIDTH
                if len(group) == 1 and lane_subrows[lane_id] == 1:
                    # Center vertically in single-row lane, snapped to 4px
                    node["y"] = int(((lane_height - nh) // 8) * 4)
                else:
                    node["y"] = LANE_TOP_PADDING + sub_idx * DEFAULT_ROW_HEIGHT
                node["_globalY"] = lane_top + node["y"]

        # 6. Apply Nudge-to-Align heuristic (<= 35px) for 0-turn collinear horizontal connections
        self._apply_nudge_to_align(lane_positions, lane_rank_groups)

        return self.data

    def _apply_nudge_to_align(
        self,
        lane_positions: Dict[str, Tuple[int, int]],
        lane_rank_groups: Dict[Tuple[str, int], List[Dict[str, Any]]],
    ):
        """Nudge nodes vertically (<= 35px) to achieve 0-turn collinear horizontal connections.
        
        Rule borrowed from BPMN & Draw.io layout standards: when sequential nodes within the same lane
        have a minor vertical discrepancy (e.g. 56px task vs 64px decision, or subrow differences),
        nudging the target or source node aligns their center Y and collapses 3-segment doglegs into
        a razor-flat 0-degree straight horizontal line.
        """
        for edge in self.edges:
            u_id = edge["from"]
            v_id = edge["to"]
            if u_id not in self.node_map or v_id not in self.node_map:
                continue
            u = self.node_map[u_id]
            v = self.node_map[v_id]
            if u["laneId"] != v["laneId"]:
                continue
            # Forward horizontal edge (v is to the right of u)
            if v.get("x", 0) <= u.get("x", 0):
                continue

            lid = u["laneId"]
            lane_top, lane_h = lane_positions.get(lid, (0, LANE_MIN_HEIGHT))
            uh = DECISION_NODE_HEIGHT if u.get("type") == "decision" else DEFAULT_NODE_HEIGHT
            vh = DECISION_NODE_HEIGHT if v.get("type") == "decision" else DEFAULT_NODE_HEIGHT
            u_cy = u.get("y", 0) + uh / 2.0
            v_cy = v.get("y", 0) + vh / 2.0

            delta_y = u_cy - v_cy
            if 0 < abs(delta_y) <= 35:
                # Try nudging v to align its center with u
                target_v_y = int(round((u_cy - vh / 2.0) / 4.0) * 4)
                if target_v_y >= 20 and (target_v_y + vh) <= (lane_h - 20):
                    v_rank = (v["laneId"], int((v.get("x", START_X) - START_X) // DEFAULT_COL_WIDTH))
                    siblings = [s for s in lane_rank_groups.get(v_rank, []) if s["id"] != v["id"]]
                    collides = False
                    for s in siblings:
                        sh = DECISION_NODE_HEIGHT if s.get("type") == "decision" else DEFAULT_NODE_HEIGHT
                        sy = s.get("y", 0)
                        if max(target_v_y, sy) < min(target_v_y + vh, sy + sh) + 12:
                            collides = True
                            break
                    if not collides:
                        v["y"] = target_v_y
                        v["_globalY"] = lane_top + target_v_y

    def _find_back_edges(self, adj: Dict[str, List[str]]) -> Set[Tuple[str, str]]:
        """DFS traversal with 3-color marks (white=0, gray=1, black=2) to identify back-edges."""
        color: Dict[str, int] = {node["id"]: 0 for node in self.nodes}
        back_edges: Set[Tuple[str, str]] = set()

        def dfs(u: str):
            color[u] = 1
            for v in adj.get(u, []):
                if v not in color:
                    continue
                if color[v] == 1:
                    back_edges.add((u, v))
                elif color[v] == 0:
                    dfs(v)
            color[u] = 2

        for node in self.nodes:
            if color[node["id"]] == 0:
                dfs(node["id"])

        return back_edges

    def _assign_topological_ranks(self, adj: Dict[str, List[str]], in_degree: Dict[str, int]) -> Dict[str, int]:
        ranks: Dict[str, int] = {n["id"]: 0 for n in self.nodes}
        queue = deque([nid for nid, deg in in_degree.items() if deg == 0])

        if not queue and self.nodes:
            queue.append(self.nodes[0]["id"])

        visited = set()
        while queue:
            curr = queue.popleft()
            visited.add(curr)
            curr_rank = ranks[curr]
            for nxt in adj.get(curr, []):
                ranks[nxt] = max(ranks.get(nxt, 0), curr_rank + 1)
                in_degree[nxt] = in_degree.get(nxt, 1) - 1
                if in_degree[nxt] <= 0 and nxt not in visited:
                    queue.append(nxt)

        for node in self.nodes:
            if node["id"] not in visited:
                ranks[node["id"]] = 0

        return ranks

    def _compute_barycenter(self, node_id: str, rev_adj: Dict[str, List[str]], ranks: Dict[str, int]) -> float:
        preds = rev_adj.get(node_id, [])
        if not preds:
            return 0.0
        return sum(
            self.lane_map.get(self.node_map[p]["laneId"], 0) * 100 + ranks.get(p, 0)
            for p in preds
            if p in self.node_map
        ) / len(preds)

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

        column_count = len({round(float(n.get("x", 0)) / 8) for n in self.nodes})
        budget_warnings = []
        if len(self.nodes) > MAX_NODES:
            budget_warnings.append(f"{len(self.nodes)} nodes exceeds the budget of {MAX_NODES}; split into overview + detail diagrams.")
        if len(self.lanes) > MAX_LANES:
            budget_warnings.append(f"{len(self.lanes)} lanes exceeds the budget of {MAX_LANES}.")
        if column_count > MAX_COLUMNS:
            budget_warnings.append(f"{column_count} columns (longest path) exceeds the budget of {MAX_COLUMNS}; text will be too small at Fit zoom. Shorten the chain or split the diagram.")

        return {
            "passed": passed,
            "score": score,
            "grade": grade,
            "issues": all_issues,
            "node_count": len(self.nodes),
            "edge_count": len(self.edges),
            "lane_count": len(self.lanes),
            "edge_crossings": edge_crossings,
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
        edge_ids = [e["id"] for e in self.edges if e["id"] in polylines]
        for i in range(len(edge_ids)):
            e1 = self.edges[i]
            pts1 = polylines[edge_ids[i]]
            for j in range(i + 1, len(edge_ids)):
                e2 = self.edges[j]
                if e1["from"] in (e2["from"], e2["to"]) or e1["to"] in (e2["from"], e2["to"]):
                    continue
                pts2 = polylines[edge_ids[j]]
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
            x1, y1 = min(p1[0], p2[0]), min(p1[1], p2[1])
            x2, y2 = max(p1[0], p2[0]), max(p1[1], p2[1])
            x3, y3 = min(p3[0], p4[0]), min(p3[1], p4[1])
            x4, y4 = max(p3[0], p4[0]), max(p3[1], p4[1])
            return max(x1, x3) <= min(x2, x4) - 1 and max(y1, y3) <= min(y2, y4) - 1

        for i in range(len(pts1) - 1):
            for j in range(len(pts2) - 1):
                if seg_intersect(pts1[i], pts1[i + 1], pts2[j], pts2[j + 1]):
                    return True
        return False


def extract_data_from_html(html_content: str) -> Dict[str, Any]:
    """Extract canonical flowchart-data JSON block from standalone HTML."""
    match = re.search(
        r'<script id="flowchart-data" type="application/json">\s*([\s\S]*?)\s*</script>',
        html_content,
    )
    if not match:
        raise ValueError('Could not find <script id="flowchart-data"> tag in the specified HTML file.')
    return json.loads(match.group(1))


def scaffold_html(template_path: Path, data: Dict[str, Any], output_path: Path):
    """Scaffold standalone HTML with auto-laid out diagram data."""
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found at: {template_path}")

    template_str = template_path.read_text(encoding="utf-8")
    json_str = json.dumps(data, indent=2)

    updated_html = re.sub(
        r'(<script id="flowchart-data" type="application/json">)[\s\S]*?(</script>)',
        f"\\1\n{json_str}\n  \\2",
        template_str,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(updated_html, encoding="utf-8")
    print(f"[OK] Generated interactive flowchart: {output_path}")


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
    parser.add_argument(
        "--template",
        "-t",
        default=str(Path(__file__).parent.parent / "assets" / "flowchart-template.html"),
        help="Path to flowchart-template.html",
    )
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

        engine = SwimlaneLayoutEngine(data)
        report = engine.verify_collisions()

        print(f"\n======================================================================")
        print(f"--- Flowchart Verification & Quality Audit: {p.name} ---")
        print(f"======================================================================")
        print(f"Structure: {report['lane_count']} Lanes | {report['node_count']} Nodes | {report['edge_count']} Edges | {report['column_count']} Columns")
        print(f"Diagram Quality Score: {report['score']}/100  [GRADE: {report['grade']}]")
        print(f"----------------------------------------------------------------------")
        print(f"✓ Node-to-Node Overlaps:         {report['overlaps_count']} detected")
        print(f"✓ Swimlane Boundary Fit:         {report['overflows_count']} overflows")
        print(f"✓ Edge-through-Node Penetration: {report['penetrations_count']} penetrations")
        print(f"✓ Collinear Straightness:        {report['collinear_pct']}% ({report['doglegs_count']} dogleg kinks)")
        print(f"✓ Reference Integrity:           {report['dangling_count']} dangling endpoints")
        print(f"✓ Orthogonal Edge Crossings:     {report['edge_crossings']} crossings")
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

        engine = SwimlaneLayoutEngine(data)
        laid_out_data = engine.compute_layout()
        report = engine.verify_collisions()

        out_path = Path(args.output) if args.output else in_p.with_suffix(".html")
        template_path = Path(args.template)
        scaffold_html(template_path, laid_out_data, out_path)

        if not report["passed"]:
            print(f"[WARNING] Layout computed with quality score {report['score']}/100 ({report['grade']}):")
            for issue in report["issues"]:
                print(f"  - {issue}")
        else:
            print(
                f"[PASS] Quality Score: {report['score']}/100 ({report['grade']}). "
                f"0 overlaps, 0 penetrations, {report['collinear_pct']}% collinear straightness."
            )


if __name__ == "__main__":
    main()
