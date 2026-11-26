#!/usr/bin/env python3
"""Audit, scaffold and extract tool for interactive diagram HTML files.

- `--layout`: computes positions with the diagram type's JavaScript engine (assets/types/<type>/engine.js, the
  same file the page runs for Auto-Tidy; see engine_runner.py), then writes one standalone HTML file.
- `--verify`: routes every edge and audits overlaps, penetrations, lane overflow, crossings, straightness,
  complexity budget and self-containment. Needs no browser or Node.js.
- `--extract`: reads the live JSON back out of an edited HTML file, as authoring JSON (no positions).

The page stores the model in its disk format (disk_format.py): positions sit in one trailing `layout` map
(flowchart) or are not saved (sequence). Everything here works on the in-memory model, with positions on the
objects; `assemble_page()` and `extract_data_from_html()` convert at the boundary.

Zero external dependencies (uses standard library Python 3).
"""

from __future__ import annotations

import argparse
import copy
import html
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from audit_c4 import C4Audit
from audit_erd import ErdAudit
from audit_gantt import GanttAudit
from audit_sequence import SequenceAudit
from audit_usecase import UsecaseAudit
from disk_format import (DISK_CODECS, SUPPORTED_TYPES, authoring_json, color_kind, format_json, free_notes, from_disk,  # noqa: F401 (DISK_CODECS: registry)
                         palette_slots, readme_text, stamp_reading_guide, to_disk, with_readme)
from holidays import resolve_holidays
import subprocess_flow as sub
from build_icon_pack import installed_packs, load_all_logos, load_logos, logo_refs
from engine_runner import DEFAULT_TIMEOUT, EngineUnavailable, layout_session, run_layout, run_mermaid
from save_helper import (extract_save_id, generate_save_id, handle_extract_html,
                         handle_layout_output, is_feature_enabled, stamp_save_id)
from tokens import expand_icons, load_icons, load_tokens, merge_theme, tokens_css, tokens_js
from strip_bundle import strip_css, strip_js
from version_check import REPO as GITHUB_REPO, check_nonblocking as check_version_nonblocking


REPO_URL = f"https://github.com/{GITHUB_REPO}"


DEFAULT_COL_WIDTH = 200
START_X = 56

# Complexity budget (a diagram beyond these is too dense to read at Fit zoom on a 1920px screen)
DEFAULT_TYPE = "flowchart"
SCHEMA_VERSION = 1
ERD_SCHEMA_VERSION = 3  # ERD layout v3 (disk_format.ERD_SCHEMA_VERSION)

# Zero budget limits: diagrams can be as large as the user requires.
DEFAULT_NODE_WIDTH = 144
DEFAULT_NODE_HEIGHT = 64
DECISION_NODE_HEIGHT = 96
LANE_MIN_HEIGHT = 192
LANE_BOTTOM_PADDING = 36

# Direction choice for a flowchart whose JSON leaves "direction" out (choose_flowchart_direction). The screen the page
# opens on, less fitView's 80px padding a side and the dock band; and the zoom at which node text (about 13px at 100%)
# stays at the 11px legibility minimum.
VIEW_W, VIEW_H = 1920 - 160, 1080 - 160 - 64
HALF_VIEW_W = 960 - 80  # half-screen agent/split-pane viewport width
READABLE_ZOOM = 0.84
TB_MIN_GAIN = 0.05  # top to bottom must make lanes-fill-the-screen zoom this much bigger to be worth the switch
TB_MAX_SCORE_LOSS = 5  # ... and may score at most this much lower in the audit (an extra crossing or two)

# Long arrows (flowchart rule 11): a routed arrow at least LONG_ARROW_COLS column widths long that crosses at least
# LONG_ARROW_MIN_CROSSINGS other arrows, or that crosses one and turns LONG_ARROW_MIN_BENDS times, is hard to follow
# and becomes a connector pair. A long arrow that crosses nothing still reads fine, so it stays an arrow.
LONG_ARROW_COLS = 6
LONG_ARROW_MIN_CROSSINGS = 2
LONG_ARROW_MIN_BENDS = 3
LONG_ARROW_PENALTY, LONG_ARROW_MAX_PENALTY = 5, 15
LONG_ARROW_MAX_PAIRS = 4   # letters in all: more pairs make the reader look letters up instead of following lines
LONG_ARROW_MAX_ROUNDS = 4  # split, re-layout, re-audit; stops earlier when a round does not improve


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
            self.node_w, self.base_h, self.dec_h = 96, 144, 144
            self.lane_min, self.bottom_pad, self.col_w = 240, 32, 136
        else:
            self.node_w, self.base_h, self.dec_h = DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT, DECISION_NODE_HEIGHT
            self.lane_min, self.bottom_pad, self.col_w = LANE_MIN_HEIGHT, LANE_BOTTOM_PADDING, DEFAULT_COL_WIDTH

    CONNECTOR_SIZE = 32  # engine.js CONN.SIZE: an on-page connector is a 32px circle at its own x/y, in both directions

    def node_h(self, node: Dict[str, Any]) -> int:
        """A node's extent across its lane."""
        if node.get("type") == "connector":
            return self.CONNECTOR_SIZE
        return self.dec_h if node.get("type") == "decision" else self.base_h

    def node_wf(self, node: Dict[str, Any]) -> int:
        """A node's extent along the flow."""
        return self.CONNECTOR_SIZE if node.get("type") == "connector" else self.node_w

    def _lane_floor(self, lid: str) -> int:
        """How tall a lane must be for its nodes: the lowest step plus decision room, or the lowest connector's bottom
        (a connector is placed inside the lane's existing bounds, so it never makes room for a decision below it)."""
        steps = [n.get("y", 0) for n in self.nodes if n.get("laneId") == lid and n.get("type") != "connector"]
        conns = [n.get("y", 0) + self.CONNECTOR_SIZE for n in self.nodes if n.get("laneId") == lid and n.get("type") == "connector"]
        return max([(max(steps) if steps else 48) + self.dec_h + 30] + conns)

    title = "Flowchart"

    def pass_line(self, report: Dict[str, Any]) -> str:
        # No grade on a pass: crossings and the score are not defects, so nothing here invites more tweaking
        return "[PASS] Layout clean." + (f" (audit score {report['score']}, for the report only; do not try to raise it)" if report["score"] < 100 else "")

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
            f"✓ Long Tangled Arrows:           {report['long_arrows_count']} (connector candidates)",
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
            h = max(lane.get("height", self.lane_min), self._lane_floor(lid))
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
                top_min = 2 if node.get("type") == "connector" else 10
                if ny < top_min or ny + nh > lh:
                    overflow_issues.append(
                        f"Node '{node['id']}' (y={ny}, h={nh}) overflows lane '{lid}' height ({lh}px)."
                    )

        # 3. Node Overlaps
        for i, n1 in enumerate(self.nodes):
            x1 = n1.get("x", 0)
            y1 = n1.get("y", 0)
            w1 = self.node_wf(n1)
            h1 = self.node_h(n1)

            for j in range(i + 1, len(self.nodes)):
                n2 = self.nodes[j]
                if n1["laneId"] != n2["laneId"]:
                    continue
                x2 = n2.get("x", 0)
                y2 = n2.get("y", 0)
                w2 = self.node_wf(n2)
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
            rects[n["id"]] = (nx, ny, float(self.node_wf(n)), nh)

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
                    # A row-mate between the two ends blocks the straight line, so the detour is
                    # unavoidable (a branch skipping ahead to a join); only a clear row is judged.
                    x_lo = rects[u_id][0] + rects[u_id][2]
                    x_hi = rects[v_id][0]
                    if any(
                        oid not in (u_id, v_id)
                        and ox < x_hi and ox + ow > x_lo and oy < ucy < oy + oh
                        for oid, (ox, oy, ow, oh) in rects.items()
                    ):
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
        # Crossings lower the score but never fail the gate: a large cross-functional process has
        # crossings no lane order removes, and failing on them only sends the agent chasing them.
        defect_score = max(0, score)
        score -= min(15, edge_crossings * 2)
        # Long tangled arrows likewise: score only, with a [WARN] that names the fix (a connector pair).
        long_arrows = self._long_arrows(polylines)
        score -= min(LONG_ARROW_MAX_PENALTY, len(long_arrows) * LONG_ARROW_PENALTY)
        score = max(0, min(100, score))

        grade = "A+" if score >= 95 else ("A" if score >= 90 else ("B" if score >= 80 else ("C" if score >= 70 else "F")))
        all_issues = dangling_issues + overlap_issues + overflow_issues + penetrations + dogleg_issues
        passed = (
            defect_score >= 90
            and len(dangling_issues) == 0
            and len(overlap_issues) == 0
            and len(overflow_issues) == 0
            and len(penetrations) == 0
        )

        max_x = max((float(n.get("x", 0)) for n in self.nodes), default=float(START_X))
        column_count = int(round((max_x - START_X) / self.col_w)) + 1
        budget_warnings: List[str] = (self._node_type_warnings() + self._connector_warnings() + self._lane_icon_warnings() + self._lane_color_warnings()
                                      + self._outcome_label_warnings() + self._note_warnings()
                                      + self._long_arrow_warnings(long_arrows))

        return {
            "passed": passed,
            "score": score,
            "grade": grade,
            "issues": all_issues,
            "data_issues": dangling_issues,
            "node_count": len(self.nodes),
            "edge_count": len(self.edges),
            "lane_count": len(self.lanes),
            "edge_crossings": edge_crossings,
            "long_arrows_count": len(long_arrows),
            "long_arrows": long_arrows,
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

    # Keep in sync with SHAPE_OUTLINES / NODE_DEFAULTS in flowchart.js and the schema in references/types/flowchart.md
    NODE_TYPES = ("start", "end", "task", "decision", "subprocess", "io", "document", "database", "delay", "connector")

    def _node_type_warnings(self) -> List[str]:
        """An unknown node type renders as a plain box, so the shape the author meant silently disappears."""
        valid = ", ".join(self.NODE_TYPES)
        return [
            f"Node '{n.get('id')}' ({n.get('label', '')}) has unknown type '{n.get('type')}'. Use one of: {valid}."
            for n in self.nodes
            if n.get("type", "task") not in self.NODE_TYPES
        ]

    # engine.js CONNECTOR_LETTERS: A-Z without I and O (read as 1 and 0), then AA, AB, ...
    CONNECTOR_LETTER = re.compile(r"^[A-HJ-NP-Z]+$")

    def _connector_warnings(self) -> List[str]:
        """On-page connectors come in pairs by letter: one out-connector (arrows out, none in) and one or more
        in-connectors (arrows in, none out). Anything else leaves a reader with an end that leads nowhere."""
        conns = [n for n in self.nodes if n.get("type") == "connector"]
        if not conns:
            return []
        ins = {c["id"]: [e for e in self.edges if e.get("to") == c["id"]] for c in conns}
        outs = {c["id"]: [e for e in self.edges if e.get("from") == c["id"]] for c in conns}
        warnings: List[str] = []
        by_letter: Dict[str, Dict[str, List[str]]] = {}
        for c in conns:
            cid, letter = c["id"], str(c.get("label", "")).strip().upper()
            if not self.CONNECTOR_LETTER.match(letter):
                warnings.append(f"Connector '{cid}' has label '{c.get('label', '')}'. A connector's label is its letter: "
                                f"A to Z without I and O, then AA, AB, ...")
            if ins[cid] and outs[cid]:
                warnings.append(f"Connector '{cid}' ({letter}) has arrows both in and out. An in-connector only takes "
                                f"arrows in, its out-connector only sends them on.")
            elif not ins[cid] and not outs[cid]:
                warnings.append(f"Connector '{cid}' ({letter}) has no arrows. Remove it, or connect it.")
            role = "in" if ins[cid] and not outs[cid] else "out" if outs[cid] and not ins[cid] else None
            if role:
                by_letter.setdefault(letter, {"in": [], "out": []})[role].append(cid)
            for e in ins[cid] + outs[cid]:
                other = self.node_map.get(e.get("from") if e.get("to") == cid else e.get("to"))
                if other and other.get("type") == "connector":
                    warnings.append(f"Edge '{e.get('id')}' joins two connectors. Each connector is one end of an arrow "
                                    f"between two steps.")
        for letter, roles in by_letter.items():
            if roles["in"] and not roles["out"]:
                warnings.append(f"Connector letter '{letter}' has no out-connector: the flow into "
                                f"{', '.join(roles['in'])} continues nowhere. Add one with an arrow to the next step.")
            if roles["out"] and not roles["in"]:
                warnings.append(f"Connector letter '{letter}' has no in-connector: nothing flows into "
                                f"{', '.join(roles['out'])}. Add one next to the step the flow comes from.")
            if len(roles["out"]) > 1:
                warnings.append(f"Connector letter '{letter}' has {len(roles['out'])} out-connectors "
                                f"({', '.join(roles['out'])}): one flow cannot continue in two places. Keep one.")
        return warnings

    def _lane_color_warnings(self) -> List[str]:
        """A lane's colour is a palette slot; a custom hex is drawn but its contrast is not checked."""
        slots = ", ".join(palette_slots()[:-1])
        out = []
        for lane in self.lanes:
            c, kind = lane.get("color"), color_kind(lane.get("color"))
            if c is None or kind == "slot":
                continue
            label = lane.get("name", lane.get("id"))
            out.append(f"Lane '{label}' colour {c} is not a palette slot, so its contrast is not checked: use a slot ({slots})."
                       if kind == "custom" else f"Lane '{label}' has unknown color '{c}': use a palette slot ({slots}).")
        return out

    def _lane_icon_warnings(self) -> List[str]:
        """An icon the page does not know. A lane without one gets one from its name (auto_lane_icons) before layout."""
        known = set(load_icons(load_tokens()))
        names = ", ".join(lane_icon_menu() or sorted(known))
        warnings = []
        if self.data.get("swimlanes") is False:
            return warnings  # no-swimlane mode: the single lane has no visible header
        for lane in self.lanes:
            label = lane.get("name", lane.get("id"))
            icon = lane.get("icon")
            if icon and known and icon not in known:
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
        drawn (unless it is free: no links and a "pos"); one that repeats its step's label adds nothing; one past the budget turns into a tall card that
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
            free = not ids and isinstance(note.get("pos"), dict)  # a free note: no links, an absolute "pos"
            if (not ids and not free) or unknown:
                what = "no step and has no \"pos\"" if not ids else "unknown node ids " + ", ".join(map(str, unknown))
                warnings.append(f"Note '{nid}' links to {what}; \"nodes\" lists the ids of the steps it explains "
                                f"(an empty list needs a \"pos\": a free note).")
            if len(text) > self.NOTE_BUDGET:
                warnings.append(f"Note '{nid}' is {len(text)} chars (budget {self.NOTE_BUDGET}). Keep the facts a reader needs; cut the rest.")
            labels = [str(self.node_map[i].get("label", "")).strip() for i in ids if i in self.node_map]
            if any(l and text.rstrip("?.!").lower() == l.rstrip("?.!").lower() for l in labels):
                warnings.append(f"Note '{nid}' repeats its step's label. Remove the note, or say what the label cannot.")
        return warnings

    def _long_arrows(self, polylines: Dict[str, List[Tuple[float, float]]]) -> List[Tuple[Dict[str, Any], float, int]]:
        """Arrows hard to follow (rule 11): routed at least LONG_ARROW_COLS column widths long and crossing at least
        LONG_ARROW_MIN_CROSSINGS other arrows, or (when spanning at least two ranks along the flow) crossing one with
        LONG_ARROW_MIN_BENDS bends or more, or wrapping across lanes for at least twice LONG_ARROW_COLS column widths
        with LONG_ARROW_MIN_BENDS bends or more.
        Most crossings first, then longest, as (edge, length in columns, crossings). Arrows into or out of a connector are already split."""
        found = []
        for e in self.edges:
            pts = polylines.get(e["id"])
            ends = (self.node_map.get(e["from"]), self.node_map.get(e["to"]))
            if not pts or any(n is None or n.get("type") == "connector" for n in ends):
                continue
            length = sum(abs(pts[i + 1][0] - pts[i][0]) + abs(pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1))
            cols = length / self.col_w
            if cols < LONG_ARROW_COLS:
                continue
            crossings = sum(
                1 for o in self.edges
                if o is not e and o["id"] in polylines and self._polylines_intersect(
                    pts, polylines[o["id"]], incident=bool({e["from"], e["to"]} & {o["from"], o["to"]})))
            bends = len(pts) - 2
            flow_span = abs((ends[1].get("x") or 0) - (ends[0].get("x") or 0))
            if crossings >= LONG_ARROW_MIN_CROSSINGS or (
                flow_span >= self.col_w * 2 and (
                    (crossings and bends >= LONG_ARROW_MIN_BENDS)
                    or (cols >= LONG_ARROW_COLS * 2
                        and bends >= LONG_ARROW_MIN_BENDS
                        and ends[0].get("laneId") != ends[1].get("laneId"))
                )
            ):
                found.append((e, cols, crossings))
        found.sort(key=lambda f: (-f[2], -f[1]))
        return found

    def _long_arrow_warnings(self, long_arrows: List[Tuple[Dict[str, Any], float, int]]) -> List[str]:
        """One [WARN] per connector letter to add (rule 11), longest arrow first.
        Long arrows into the same step share one letter (one out-connector, an in-connector per arrow)."""
        groups: Dict[str, List[Tuple[Dict[str, Any], float, int]]] = {}
        for item in long_arrows:  # longest first, so groups are ordered by their longest arrow
            groups.setdefault(item[0]["to"], []).append(item)
        if not groups:
            return []
        label = lambda nid: self.node_map[nid].get("label") or nid
        warnings = []
        for target, items in groups.items():
            arrows = "; ".join(
                f"'{e['id']}' ({label(e['from'])} -> {label(target)}, {cols:.0f} column widths"
                + (f", crosses {n}" if n else "") + ")"
                for e, cols, n in items
            )
            warnings.append(f"Long arrow{'s' if len(items) > 1 else ''} {arrows}: split into a connector pair (rule 11)"
                            + (", one letter for all of them." if len(items) > 1 else "."))
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
            rects[n["id"]] = (nx, ny, float(self.node_wf(n)), nh)

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

        rect_list = sorted(
            ((oid, ox, oy, ox + ow, oy + oh) for oid, (ox, oy, ow, oh) in rects.items()),
            key=lambda r: r[1],
        )

        def segment_clear(x1: float, y1: float, x2: float, y2: float, ignore: Tuple[str, ...]) -> bool:
            """True when an axis-aligned segment keeps 6px clear of every node except `ignore`."""
            min_x, max_x = (x1 if x1 < x2 else x2) - 6, (x2 if x1 < x2 else x1) + 6
            min_y, max_y = (y1 if y1 < y2 else y2) - 6, (y2 if y1 < y2 else y1) + 6
            for oid, ox, oy, ox2, oy2 in rect_list:
                if ox >= max_x:
                    break
                if ox2 > min_x and oy < max_y and oy2 > min_y and oid not in ignore:
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

            def _is_parallel_fork(cands):
                return (
                    u_node.get("type") != "decision"
                    and len(cands) >= 2
                    and all(not (e.get("label") or "").strip() and rects[e["to"]][0] > fx + fw + 20 for e in cands)
                )

            up_fork, down_fork = _is_parallel_fork(up_cands), _is_parallel_fork(down_cands)

            is_multi_or_decision = u_node.get("type") == "decision" or len(fwd_outs) > 1
            top_edge_id = up_cands[0]["id"] if (not up_fork and is_multi_or_decision and up_cands) else None
            bottom_edge_id = down_cands[0]["id"] if (not down_fork and is_multi_or_decision and down_cands) else None
            if not up_fork and not top_edge_id and up_cands and abs(rects[up_cands[0]["to"]][0] + rects[up_cands[0]["to"]][2] / 2 - fcx) < 30:
                top_edge_id = up_cands[0]["id"]
            if not down_fork and not bottom_edge_id and down_cands and abs(rects[down_cands[0]["to"]][0] + rects[down_cands[0]["to"]][2] / 2 - fcx) < 30:
                bottom_edge_id = down_cands[0]["id"]

            for e in fwd_outs:
                v_id = e["to"]
                in_fork = (up_fork and e in up_cands) or (down_fork and e in down_cands)
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
                elif (not in_fork and from_port == "right" and to_port == "left" and abs(tcy - fcy) > 30
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

        if rects:  # a blank diagram has no steps to route
            self._reroute_by_cost(result, rects, ports, segment_clear, rect_list)
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

    def _reroute_by_cost(self, result, rects, ports, segment_clear, rect_list=None) -> None:
        """Mirror of the browser's step 5a. Cost: overlap >> near-parallel > crossing (~1.75 bends)
        > bend > length, plus lane-divider hugging, crowding a node and left/right port clashes.
        Longest arrows go first; arrows already clean keep their standard route; switching needs a
        clear win (hysteresis), and changing sides is penalised against sliding a channel."""
        C_OVERLAP, C_NEAR, C_CROSS, C_BEND, C_DIVIDER, C_NEAR_NODE, C_PORT, C_SHARED_BRANCH = (
            20000, 2500, 1750, 1000, 1500, 600, 2500, 1200
        )
        dividers = self._lane_dividers()
        if rect_list is None:
            rect_list = sorted(
                ((oid, ox, oy, ox + ow, oy + oh) for oid, (ox, oy, ow, oh) in rects.items()),
                key=lambda r: r[1],
            )

        def poly_clear(pts, ids) -> bool:
            return all(segment_clear(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], ids)
                       for i in range(len(pts) - 1))

        def parse_poly(pts):
            segs = []
            min_x = min_y = float("inf")
            max_x = max_y = float("-inf")
            for i in range(len(pts) - 1):
                ax, ay = pts[i]
                bx, by = pts[i + 1]
                smin_x, smax_x = (ax, bx) if ax <= bx else (bx, ax)
                smin_y, smax_y = (ay, by) if ay <= by else (by, ay)
                if smin_x < min_x:
                    min_x = smin_x
                if smax_x > max_x:
                    max_x = smax_x
                if smin_y < min_y:
                    min_y = smin_y
                if smax_y > max_y:
                    max_y = smax_y
                segs.append((ax, ay, bx, by, abs(ax - bx) < 1, abs(ay - by) < 1, smin_x, smax_x, smin_y, smax_y))
            return (min_x, max_x, min_y, max_y), segs

        def relate_segs(
            c_segs, o_segs, skip_first: bool = False, skip_last: bool = False, skip_first_trunk: bool = False
        ):
            overlap = near = cross = 0.0
            last_i = len(c_segs) - 1
            last_j = len(o_segs) - 1
            both_trunks = last_i >= 2 and last_j >= 2
            for i, (ax, ay, bx, by, a_v, a_h, amin_x, amax_x, amin_y, amax_y) in enumerate(c_segs):
                for j, (cx, cy, dx, dy, c_v, c_h, cmin_x, cmax_x, cmin_y, cmax_y) in enumerate(o_segs):
                    if skip_first and (
                        (i == 0 and j == 0)
                        or (skip_first_trunk and both_trunks and i == 1 and j == 1)
                    ):
                        continue
                    if skip_last and (
                        (i == last_i and j == last_j)
                        or (both_trunks and i == last_i - 1 and j == last_j - 1)
                    ):
                        continue
                    if a_v and c_v:
                        run = (amax_y if amax_y < cmax_y else cmax_y) - (amin_y if amin_y > cmin_y else cmin_y)
                        if run > 1:
                            gap = abs(ax - cx)
                            if gap < 2:
                                overlap += run
                            elif gap < 18:
                                near += 1
                    elif a_h and c_h:
                        run = (amax_x if amax_x < cmax_x else cmax_x) - (amin_x if amin_x > cmin_x else cmin_x)
                        if run > 1:
                            gap = abs(ay - cy)
                            if gap < 2:
                                overlap += run
                            elif gap < 18:
                                near += 1
                    elif (a_v and c_h) or (a_h and c_v):
                        if a_v:
                            vx, vy1, vy2, hy, hx1, hx2 = ax, amin_y, amax_y, cy, cmin_x, cmax_x
                        else:
                            vx, vy1, vy2, hy, hx1, hx2 = cx, cmin_y, cmax_y, ay, amin_x, amax_x
                        if hx1 + 1 < vx < hx2 - 1 and vy1 + 1 < hy < vy2 - 1:
                            cross += 1
            return overlap, near, cross

        def defects(segs, ids) -> float:
            d = 0.0
            for ax, ay, bx, by, _, is_h, smin_x, smax_x, smin_y, smax_y in segs:
                if dividers and is_h and abs(ax - bx) > 30 and any(abs(ay - y) < 8 for y in dividers):
                    d += C_DIVIDER
                x1, x2 = smin_x - 14, smax_x + 14
                y1, y2 = smin_y - 14, smax_y + 14
                for oid, ox, oy, ox2, oy2 in rect_list:
                    if ox >= x2:
                        break
                    if ox2 > x1 and oy < y2 and oy2 > y1 and oid not in ids:
                        d += C_NEAR_NODE
                        break
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

        geom_cache = {eid: parse_poly(pts) for eid, pts in result.items()}

        def route_cost(pts, e, other_entries, fp, tp, limit=float("inf"), port_cache=None):
            e_from, e_to = e["from"], e["to"]
            ids = (e_from, e_to)
            length = sum(abs(pts[i + 1][0] - pts[i][0]) + abs(pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1))
            bend_len = (len(pts) - 2) * C_BEND + length
            if bend_len >= limit:
                return None  # cannot beat the best so far
            if not poly_clear(pts, ids):
                return None
            if port_cache is not None:
                key = (fp, tp)
                port_pen = port_cache.get(key)
                if port_pen is None:
                    port_pen = port_clashes(e, fp, tp) * C_PORT + shared_branch_vertex(e, fp) * C_SHARED_BRANCH
                    port_cache[key] = port_pen
            else:
                port_pen = port_clashes(e, fp, tp) * C_PORT + shared_branch_vertex(e, fp) * C_SHARED_BRANCH
            (cmin_x, cmax_x, cmin_y, cmax_y), c_segs = parse_poly(pts)
            defect = defects(c_segs, ids) + port_pen
            if bend_len + defect >= limit:
                return None
            cx1, cx2, cy1, cy2 = cmin_x - 18, cmax_x + 18, cmin_y - 18, cmax_y + 18
            for o_from, o_to, op, omin_x, omax_x, omin_y, omax_y, o_segs, incident, unlabelled_pair in other_entries:
                if cx2 <= omin_x or cx1 >= omax_x or cy2 <= omin_y or cy1 >= omax_y:
                    continue
                skip_first = bool(op and o_from == e_from and op[0] == fp)
                skip_last = bool(op and o_to == e_to and op[1] == tp)
                ov, ne, cr = relate_segs(c_segs, o_segs, skip_first, skip_last, skip_first and unlabelled_pair)
                delta = (C_OVERLAP + ov if ov > 0 else 0) + (0 if incident else ne * C_NEAR) + cr * C_CROSS
                if delta:
                    defect += delta
                    if bend_len + defect >= limit:
                        return None
            return bend_len + defect, defect

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
                            for d in (28, 36, 48, 72):
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
            e_from, e_to = e["from"], e["to"]
            e_unlabelled = not (e.get("label") or "").strip()
            other_entries = []
            for o in self.edges:
                if o is e:
                    continue
                oid = o["id"]
                if oid not in result:
                    continue
                (omin_x, omax_x, omin_y, omax_y), o_segs = geom_cache[oid]
                o_from, o_to = o["from"], o["to"]
                other_entries.append((
                    o_from,
                    o_to,
                    ports.get(oid),
                    omin_x,
                    omax_x,
                    omin_y,
                    omax_y,
                    o_segs,
                    o_from == e_from or o_from == e_to or o_to == e_from or o_to == e_to,
                    e_unlabelled and not (o.get("label") or "").strip(),
                ))
            port_cache: Dict[Tuple[str, str], float] = {}
            base = route_cost(result[eid], e, other_entries, cur_fp, cur_tp, port_cache=port_cache)
            if base is not None and base[1] == 0:
                continue
            base_cost = float("inf") if base is None else base[0]
            best = None
            deep = base is None or base[1] >= C_CROSS
            for fp, tp, pts, dev in alt_routes(rects[e_from], rects[e_to], deep):
                r = route_cost(pts, e, other_entries, fp, tp, best[0] if best else base_cost - 250, port_cache)
                if r is None:
                    continue
                cost = r[0] + dev * 0.3 + (600 if (fp, tp) != (cur_fp, cur_tp) else 0)
                if best is None or cost < best[0]:
                    best = (cost, pts, fp, tp)
            if best and best[0] < base_cost - 250:
                result[eid] = best[1]
                ports[eid] = (best[2], best[3])
                geom_cache[eid] = parse_poly(best[1])

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
    data.setdefault("schemaVersion", ERD_SCHEMA_VERSION if kind == "erd" else SCHEMA_VERSION)
    return data


_DATA_BLOCK_RE = re.compile(r'<script id="diagram-data" type="application/json">\s*([\s\S]*?)\s*</script>')


def read_data_block(html_content: str) -> Dict[str, Any]:
    """The diagram JSON block of a standalone page, exactly as stored (disk format)."""
    # The full opening tag, so the page's reading-guide comment (which never spells it) cannot match
    match = _DATA_BLOCK_RE.search(html_content)
    if not match:
        raise ValueError('Could not find the diagram data block (<script id="diagram-data">) in the specified HTML file.')
    return json.loads(match.group(1))


def read_data_block_from_path(path: Path) -> Dict[str, Any]:
    """Read the disk-format diagram JSON from a standalone HTML page, a split artifact index.html, or a .json file."""
    if path.suffix.lower() == ".json":
        return json.loads(path.read_text(encoding="utf-8"))
    html_text = path.read_text(encoding="utf-8")
    if not _DATA_BLOCK_RE.search(html_text):
        sibling = path.with_name("diagram.json")
        if sibling.is_file():
            return json.loads(sibling.read_text(encoding="utf-8"))
    return read_data_block(html_text)


def strip_free_notes(kind: str, data: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    """(data without its free notes, one `%% <id>: <text>` line per free note, `(in sub_<slug>)` for a subprocess flow's).
    Mermaid has no line for a note that explains nothing, so --extract lists them in a Notes section after the diagram."""
    lines: List[str] = []
    out = dict(data)
    flows = [(None, data)] + (list((data.get("children") or {}).items()) if kind == "flowchart" else [])
    for slug, flow in flows:
        free = free_notes(kind, {"notes": flow.get("notes")})
        if not free:
            continue
        where = f" (in sub_{slug})" if slug else ""
        lines += [f"%% {n.get('id')}{where}: " + " ".join(str(n.get("text") or "").split()) for n in free]
        keep = [n for n in flow.get("notes") or [] if not any(n is f for f in free)]
        target = out
        if slug is not None:
            out["children"] = dict(out["children"])
            target = out["children"][slug] = dict(flow)
        if keep:
            target["notes"] = keep
        else:
            target.pop("notes", None)
    return out, lines


def extract_data_from_html(html_content: str) -> Dict[str, Any]:
    """The in-memory model of a page: its data block with the saved positions merged back onto the objects.
    A sequence page saves no positions; run its engine (engine_runner.run_layout) before auditing it."""
    data = read_data_block(html_content)
    return from_disk(data.get("diagramType") or DEFAULT_TYPE, data)


def _load_input(path: Path, force_from_disk: bool = False) -> Tuple[Dict[str, Any], Optional[str], bool, bool]:
    """Load (in_memory_data, html_text_for_theme, is_split_html, needs_engine_for_verify) from an HTML or JSON file."""
    if path.suffix.lower() == ".html":
        html_text = path.read_text(encoding="utf-8")
        is_split = not _DATA_BLOCK_RE.search(html_text) and path.with_name("diagram.json").is_file()
        raw = read_data_block_from_path(path)
        return from_disk(raw.get("diagramType") or DEFAULT_TYPE, raw), html_text, is_split, True
    raw = read_data_block_from_path(path)
    sibling_index = path.with_name("index.html")
    html_text = sibling_index.read_text(encoding="utf-8") if path.name == "diagram.json" and sibling_index.is_file() else None
    kind = raw.get("diagramType") or DEFAULT_TYPE
    is_disk = force_from_disk or "_readme" in raw or ("layout" in raw and kind != "sequence") or (kind == "erd" and "groups" in raw)
    data = from_disk(kind, raw) if is_disk else raw
    needs_engine = "_readme" in raw or ("layout" in raw and kind in ("erd", "usecase", "c4"))
    return data, html_text, False, needs_engine


# --- Mermaid input and output ---------------------------------------------------------------------------------------------
def is_mermaid_input(path: Path) -> bool:
    """A `.mmd` file, or any file whose text does not start with `{` (JSON) or `<` (an HTML page)."""
    if path.suffix.lower() == ".mmd":
        return True
    return not path.read_text(encoding="utf-8-sig").lstrip().startswith(("{", "<"))


def mermaid_kind(text: str) -> str:
    """The diagram type of Mermaid text, from its header (`flowchart`/`graph`, or use case with `%% @type usecase`)."""
    body = re.sub(r"\A\s*---\n.*?\n---\n", "", text.lstrip("\ufeff"), flags=re.S)
    header = next((ln.split()[0] for ln in body.splitlines() if ln.strip() and not ln.strip().startswith("%%")), "")
    if header in ("flowchart", "graph"):
        return "usecase" if re.search(r"^\s*%%\s*@type\s+usecase\b", text, re.M) else "flowchart"
    if header == "sequenceDiagram":
        return "sequence"
    if header == "erDiagram":
        return "erd"
    if header in ("C4Context", "C4Container", "C4Component", "C4Dynamic", "C4Deployment"):
        return "c4"
    if header == "gantt":
        return "gantt"
    sys.exit(f"[ERROR] Not a Mermaid diagram this tool reads: the first line is {header!r}. "
             "Supported: flowchart / graph (use case: add `%% @type usecase`), sequenceDiagram, erDiagram, C4Context / C4Container / C4Component, gantt.")


def theme_palette(tokens: Dict[str, Any]) -> List[str]:
    """The colours of palette slots 1 to 8 (the slot's `hex`, else its light fill) for the Mermaid writer's classDef lines."""
    return [slot.get("hex") or slot["light"]["soft"] for slot in tokens["palette"][:8]]


def item_ids(kind: str, data: Dict[str, Any]) -> Set[Tuple[str, Any]]:
    """The ids --keep-from compares: lanes and steps, subjects / actors / use cases, tables, participants. A sequence's
    messages have positional ids in Mermaid, so only their count counts."""
    keys = {"flowchart": ("lanes", "nodes"), "usecase": ("subjects", "actors", "useCases"), "erd": ("entities",),
            "sequence": ("participants",), "c4": ("groups", "elements"), "gantt": ("items", "markers")}[kind]
    ids = {(k, it["id"]) for k in keys for it in data.get(k) or []}
    ids |= {("nodes", n["id"]) for c in (data.get("children") or {}).values() for n in c.get("nodes") or []}
    if kind == "sequence":
        ids |= {("message", i) for i in range(len(data.get("messages") or []))}
    return ids


def keep_positions_from(kind: str, new: Dict[str, Any], old: Dict[str, Any], timeout: int, browser: Optional[str]
                        ) -> Tuple[Optional[Dict[str, Any]], str]:
    """(new diagram carrying the old page's positions, "") when both have the same item ids, else (None, why not).
    `old` is the in-memory model of the old page; its ids are spelled as the Mermaid writer spells them first."""
    if (old.get("diagramType") or DEFAULT_TYPE) != kind:
        return None, f"the old file is a {old.get('diagramType') or DEFAULT_TYPE}, the new one a {kind}"
    old_disk = to_disk(kind, old)
    spelled = run_mermaid("ids", kind, old_disk, timeout, browser)
    same = lambda ids: {(k, spelled.get(v, v) if k != "message" else v) for k, v in ids}
    before, after = same(item_ids(kind, old)), item_ids(kind, new)
    if before != after:
        show = lambda ids: ", ".join(str(v) for _, v in sorted(ids, key=str)[:6]) + (", ..." if len(ids) > 6 else "")
        parts = [f"{what} {show(ids)}" for what, ids in (("added", after - before), ("removed", before - after)) if ids]
        return None, "; ".join(parts)
    layout = {spelled.get(k, k): v for k, v in (old_disk.get("layout") or {}).items()}
    disk = {**new, "schemaVersion": old_disk.get("schemaVersion", new.get("schemaVersion"))}
    old_kids = old_disk.get("children") or {}
    if disk.get("children"):  # a child keeps its lane order and heights while its steps are the same
        disk["children"] = {k: {**c, **{f: old_kids[k][f] for f in ("laneOrder", "laneHeights") if f in old_kids.get(k, {})}}
                            for k, c in disk["children"].items()}
    if layout:
        disk["layout"] = layout
    return from_disk(kind, {k: v for k, v in disk.items() if v is not None}), ""


# --- Themes: which one a run uses, and the copy a page keeps ----------------------------------------------------------
THEME_OPEN = '<script id="diagram-theme" type="application/json">'
PROJECT_THEME = Path(".ultimate-diagram") / "theme.json"
SKILL_THEME = Path(__file__).resolve().parent.parent / "theme.json"


def read_stored_theme(html_content: str) -> Optional[Dict[str, Any]]:
    """The theme a page carries (the diagram-theme script after the data block), or None for a page saved before themes."""
    m = re.search(r'<script id="diagram-theme" type="application/json">\s*([\s\S]*?)\s*</script>', html_content)
    return json.loads(m.group(1)) if m else None


def theme_script(theme: Optional[Dict[str, Any]]) -> str:
    """The page text that stores `theme`, placed right after the data block's end comment (so below the reading guide's range)."""
    if theme is None:
        return ""
    return f"\n  {THEME_OPEN}{json.dumps(theme, separators=(',', ':')).replace('<', chr(92) + 'u003c')}</script>"


def resolve_theme(theme_arg: Optional[str], page_html: Optional[str] = None) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]], str]:
    """(merged tokens, theme to store in the page or None, note for the report). First match wins: --theme (or
    '--theme default' to clear a stored/saved theme), the theme stored in the page being updated,
    .ultimate-diagram/theme.json in the current directory, <skill-dir>/theme.json, then the default tokens."""
    if theme_arg == "default":
        return merge_theme(None), None, "[NOTE] Theme reset to default."
    try:
        if theme_arg:
            theme, source = json.loads(Path(theme_arg).read_text(encoding="utf-8")), f"--theme {theme_arg}"
        elif page_html is not None and (stored := read_stored_theme(page_html)) is not None:
            theme, source = stored, "stored in the page"
        elif PROJECT_THEME.is_file():
            theme, source = json.loads(PROJECT_THEME.read_text(encoding="utf-8")), f"project theme {PROJECT_THEME.as_posix()}"
        elif SKILL_THEME.is_file():
            theme, source = json.loads(SKILL_THEME.read_text(encoding="utf-8")), f"skill theme {SKILL_THEME.as_posix()}"
        else:
            return merge_theme(None), None, ""
        tokens = merge_theme(theme, source)
    except (OSError, ValueError) as exc:
        sys.exit(f"[ERROR] theme ({theme_arg or 'stored, project, or skill theme'}): {exc}")
    note = f"[NOTE] Theme {tokens['name']!r} ({source})."
    if (source.startswith("project") or source.startswith("skill")) and page_html is not None:
        kind = "project" if source.startswith("project") else "skill"
        note += f" This page was saved before themes, so it takes the {kind} theme now; the stored copy is written on this run."
    return tokens, theme, note


AUDITS = {"flowchart": FlowchartAudit, "sequence": SequenceAudit, "erd": ErdAudit, "usecase": UsecaseAudit, "c4": C4Audit, "gantt": GanttAudit}


# Where local icon packs (icons/<pack>.json) are looked for: set by main() (--icons, else next to the input, else ./icons), plus bundled logos
ICON_DIRS: List[Path] = [Path("icons"), Path(__file__).resolve().parent.parent / "assets" / "logos"]


def make_audit(data: Dict[str, Any], tokens: Optional[Dict[str, Any]] = None):
    """The audit for `data`'s type; the sequence audit estimates text width from the theme's font.metrics, the c4 audit
    learns which icon packs are installed."""
    cls = AUDITS[data["diagramType"]]
    if cls is C4Audit:
        return cls(data, icon_packs=installed_packs(ICON_DIRS))
    return cls(data, tokens["font"]["metrics"] if tokens else None) if cls is SequenceAudit else cls(data)


def logo_warnings(data: Dict[str, Any]) -> List[str]:
    """One [WARN] per `logo:<pack>/<icon>` whose pack is installed but has no such entry (a missing pack is the audit's)."""
    _, absent = load_logos(logo_refs(data), ICON_DIRS)
    return [f"Icon pack '{r.split('/', 1)[0]}' has no entry '{r.split('/', 1)[1]}': elements using logo:{r} show the icon of their kind." for r in absent]
# DISK_CODECS (disk_format.py): per type, (to_disk, from_disk) between the in-memory model and the page block

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"
BUNDLED_LOGOS_DIR = ASSETS_DIR / "logos"
TARGETS = ("file", "artifact")


def _read_asset(path: Path) -> str:
    return path.read_text(encoding="utf-8")  # text mode normalizes CRLF to LF


# --- claude.ai Artifact target ---------------------------------------------------------------------------------
# A page that republishes itself (editor Save inside a claude.ai artifact) must be exactly this skeleton, then the
# page content, then the closing tags: that is the shape the Artifact tool publishes, and any other shape makes a
# later publish nest one page inside another. Nothing else may sit in <head>, with no whitespace between the tags.
# The same two constants live in assets/shell/shell.js (ARTIFACT_RESET_CSS, ARTIFACT_HEAD); dev/check_artifact_shape.py
# fails if they differ. The RESET text is copied byte for byte from an `Artifact read` of a published page (verified
# 2026-11-14, runtime contract 0.2.96); if claude.ai changes its skeleton, copy the new one into both constants.
ARTIFACT_RESET_CSS = ":root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}"
ARTIFACT_HEAD = ('<!doctype html><html><head><meta charset=utf8><meta name=viewport '
                 'content="width=device-width,initial-scale=1,viewport-fit=cover">'
                 f'<style>{ARTIFACT_RESET_CSS}</style></head><body>')
ARTIFACT_TAIL = "</body></html>"
# Last line of our own content in an artifact page. The editor keeps only <title>..this marker when it republishes,
# so anything the claude.ai viewer appends to <body> at run time is never saved back. Mirrored in shell.js.
ARTIFACT_END_MARKER = "<!-- end ultimate-diagram page -->"


ARTIFACT_AGENT_COMMENT = (
    '<!-- For agents: the diagram model (JSON, disk format) is in diagram.json in this artifact '
    '(Artifact read with path: "diagram.json"). Do not read app.css or app.js to understand the diagram. -->'
)


def _split_shell_html(shell_html: str) -> Tuple[str, str, str]:
    """Split shell.html into (head_links, body_markup, inline_script_template) so split artifacts stay in sync."""
    m = re.match(
        r"\s*<!DOCTYPE html>\n<!--[\s\S]*?-->\n<html[^>]*>\n<head>\n"
        r"(?P<head>[\s\S]*?)</head>\n<body>(?P<body>[\s\S]*)</body>\n</html>\s*$",
        shell_html,
    )
    if not m:
        raise ValueError("shell.html no longer has the expected doctype / guide / head / body layout")
    head = m["head"]
    if head.count("<title>") != 1 or not re.search(r"^[ \t]*<title>[^\n]*</title>\n", head, flags=re.M):
        raise ValueError("shell.html head must hold exactly one <title> line")
    head = re.sub(r"^[ \t]*<meta [^>]*>\n", "", head, flags=re.M)
    head = re.sub(r"^[ \t]*<title>[^\n]*</title>\n", "", head, count=1, flags=re.M)
    head, n_data = re.subn(
        r'(?:[ \t]*<!-- Diagram model:[^\n]*\n)?[ \t]*<script id="diagram-data"[\s\S]*?<!-- end diagram-data -->(?:\{\{THEME\}\})?\n',
        "",
        head,
        count=1,
    )
    if n_data != 1:
        raise ValueError("shell.html head must hold the diagram-data block")
    head, n_style = re.subn(r"[ \t]*<style>[\s\S]*?</style>\n", "", head, count=1)
    if n_style != 1:
        raise ValueError("shell.html head must hold exactly one <style> block")

    body_match = re.match(
        r"(?P<markup>[\s\S]*?)(?:[ \t]*<!-- Interactive Diagram Script:[^\n]*\n)?[ \t]*<script>\n(?P<script>[\s\S]*?)[ \t]*</script>\n\s*$",
        m["body"],
    )
    if not body_match:
        raise ValueError("shell.html body must end with the inline <script> block")
    return head, body_match["markup"], body_match["script"]


def artifact_index_template(shell_html: str) -> str:
    """Derive the split artifact index.html template from shell.html so font links and body markup never drift."""
    head_links, body_markup, _ = _split_shell_html(shell_html)
    return (
        ARTIFACT_HEAD + "\n"
        + "<title>{{PAGE_TITLE}}</title>\n"
        + ARTIFACT_AGENT_COMMENT + "{{THEME}}\n"
        + head_links
        + '  <link rel="stylesheet" href="app.css">\n'
        + body_markup
        + '  <script src="app.js"></script>\n'
        + ARTIFACT_END_MARKER + "\n" + ARTIFACT_TAIL
    )


def lane_icon_table() -> List[Tuple[str, str]]:
    """(icon, "use" words) for each lane icon, in order (assets/icons/lanes.json); empty when the file is not there."""
    path = ASSETS_DIR / "icons" / "lanes.json"
    if not path.is_file():
        return []
    return [(row["icon"], row["use"]) for row in json.loads(path.read_text(encoding="utf-8"))["lanes"]]


def lane_icon_menu() -> List[str]:
    """The icon names a lane can use (assets/icons/lanes.json), the agent's menu."""
    return [icon for icon, _ in lane_icon_table()]


_ICON_STOP_WORDS = {"a", "an", "and", "or", "the", "of", "for", "to"}


def _icon_words(text: str) -> List[str]:
    """Lower-case words of `text` without filler words; a trailing plural s is dropped so "customers" matches "customer"."""
    return [w[:-1] if len(w) > 3 and w.endswith("s") else w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in _ICON_STOP_WORDS]


def auto_lane_icons(data: Dict[str, Any]) -> Tuple[Dict[str, Any], str]:
    """Give every lane without an `icon` one from its name: for the name's words in order, the first icon in the table
    order whose "Use for" words contain the word; else the next unused icon in table order. Each icon is used once per diagram.
    Returns (data, the [INFO] line, or "" when nothing changed)."""
    lanes = data.get("lanes") or []
    known = set(load_icons(load_tokens()))
    table = [(icon, set(_icon_words(use))) for icon, use in lane_icon_table() if icon in known]
    if data.get("swimlanes") is False or not table or all(l.get("icon") for l in lanes):
        return data, ""
    used = {l["icon"] for l in lanes if l.get("icon")}
    picked = []
    for lane in lanes:
        if lane.get("icon"):
            continue
        words = _icon_words(str(lane.get("name", lane.get("id", ""))))
        icon = next((i for w in words for i, kw in table if i not in used and w in kw), None) or next((i for i, _ in table if i not in used), None)
        if icon is None:
            continue
        lane["icon"] = icon
        used.add(icon)
        picked.append(f"{lane.get('name', lane.get('id'))}={icon}")
    return data, f"Lane icons: {', '.join(picked)}" if picked else ""


# Shared component styles (assets/components/<name>.css), in cascade order. The dock comes before the buttons because
# its `.toolbar-center .btn` rules and `.btn:disabled` have equal weight and the disabled look must win; toggle comes
# after both so a pressed toggle wins inside the dock.
COMPONENTS = ("dock", "badge", "button", "toggle", "toast", "hint", "popover", "note", "swatch", "pill", "edge", "frame", "chevron", "port", "item-states", "actionbar", "colorkey", "search")


def components_css() -> str:
    """The component stylesheets joined in COMPONENTS order; a file missing from the list or the list naming a missing file fails loudly."""
    found = {f.stem for f in (ASSETS_DIR / "components").glob("*.css")}
    if found != set(COMPONENTS):
        raise FileNotFoundError(f"assets/components must hold exactly {sorted(COMPONENTS)}; found {sorted(found)}")
    return "\n".join(_read_asset(ASSETS_DIR / "components" / f"{n}.css").rstrip(chr(10)) for n in COMPONENTS)


def _build_parts(kind: str, data: Optional[Dict[str, Any]] = None,
                 tokens: Optional[Dict[str, Any]] = None, theme: Optional[Dict[str, Any]] = None) -> Tuple[Dict[str, str], Dict[str, Any], Dict[str, str]]:
    """Collect template substitution parts, tokens and icons for a diagram type."""
    type_dir = ASSETS_DIR / "types" / kind
    if not type_dir.is_dir():
        raise FileNotFoundError(f"No assets for diagram type {kind!r} at: {type_dir}")
    meta = json.loads(_read_asset(type_dir / "meta.json"))
    if data is None:
        data = json.loads(_read_asset(type_dir / "default.json"))
    # Same text as the page's Save (formatJson in shell.js), so an unedited save changes nothing
    payload = format_json(with_readme(to_disk(kind, data), readme_text(meta["dataNote"])))
    tokens = tokens or load_tokens()
    icons = load_icons(tokens)

    def html_part(text: str) -> str:  # {{icon:name}} in a template becomes the icon's <svg> here, so the page does no work at start-up
        return expand_icons(text, tokens, icons)

    logos = load_logos(logo_refs(data), ICON_DIRS)[0]
    if kind == "c4" and BUNDLED_LOGOS_DIR.is_dir():
        logos = {**load_all_logos([BUNDLED_LOGOS_DIR]), **logos}
    extra_css = [type_dir / name for name in meta.get("extraCss", ())]
    extra_js = [type_dir / name for name in meta.get("extraJs", ())]
    parts = {
        "PAGE_TITLE": html.escape(str(data.get("title") or meta["title"]), quote=False),
        "REPO_NAME": html.escape(GITHUB_REPO, quote=True),
        "REPO_URL": html.escape(REPO_URL, quote=True),
        "TOKENS_CSS": tokens_css(tokens),
        "FONT_HREF": html.escape(tokens["font"]["href"]),
        "COMPONENTS_CSS": components_css(),
        "SHELL_CSS": _read_asset(ASSETS_DIR / "shell" / "shell.css").rstrip(chr(10)),
        "TYPE_CSS": "\n".join(_read_asset(f).rstrip(chr(10)) for f in (type_dir / f"{kind}.css", *extra_css)),
        "TYPE_TOOLBAR": html_part(_read_asset(type_dir / "toolbar.html").rstrip(chr(10))),
        "TYPE_ICON": html_part(f"{{{{icon:type-{kind}:xl}}}}"),  # the type's header icon is the registry entry type-<type>
        "TYPE_CHROME": html_part(_read_asset(type_dir / "chrome.html")),
        "TYPE_STAGE": html_part(_read_asset(type_dir / "stage.html").rstrip(chr(10))),
        "TYPE_HELP": html_part(_read_asset(type_dir / "help.html").rstrip(chr(10))),
        "SHELL_HELP": html_part(_read_asset(ASSETS_DIR / "shell" / "help.html").rstrip(chr(10))),
        "DATA": payload,
        "THEME": theme_script(theme),
        "SHELL_JS": "\n".join(_read_asset(ASSETS_DIR / "shell" / f).rstrip(chr(10)) for f in ("shell.js", "notes.js")),   # notes.js: the shared notes controller, after the shell it builds on
        "TOKENS_JS": tokens_js(tokens, logos),
        "ENGINE_JS": "\n".join(_read_asset(f).rstrip(chr(10)) for f in (ASSETS_DIR / "shell" / "ortho-router.js", type_dir / "route.js", type_dir / "engine.js") if f.is_file()),
        # The Mermaid reader and writer: the shared tokenizer, then the type's own (plain scripts, globals only)
        "MERMAID_JS": "\n".join(_read_asset(f).rstrip(chr(10)) for f in (ASSETS_DIR / "shell" / "mermaid-flow.js", type_dir / "mermaid.js") if f.is_file()),   # a type with no Mermaid reader yet has no mermaid.js
        "TYPE_JS": "\n".join(_read_asset(f).rstrip(chr(10)) for f in (*extra_js, type_dir / f"{kind}.js")),
    }
    for key in ("TOKENS_CSS", "COMPONENTS_CSS", "SHELL_CSS", "TYPE_CSS"):
        parts[key] = strip_css(parts[key])
    for key in ("SHELL_JS", "TOKENS_JS", "ENGINE_JS", "MERMAID_JS", "TYPE_JS"):
        parts[key] = strip_js(parts[key])
    return parts, tokens, icons


def assemble_page(kind: str, data: Optional[Dict[str, Any]] = None, target: str = "file",
                  tokens: Optional[Dict[str, Any]] = None, theme: Optional[Dict[str, Any]] = None) -> str:
    """Build one standalone HTML page for the local file target (`target="file"`).
    For split claude.ai Artifacts (`target="artifact"`), call `assemble_artifact()` instead."""
    if target != "file":
        raise ValueError(f"assemble_page() supports only target='file' (got {target!r}); use assemble_artifact() for split artifacts")
    parts, tokens, icons = _build_parts(kind, data, tokens, theme)
    # One pass: substituted text is never re-scanned, and an unknown placeholder fails loudly.
    template = _read_asset(ASSETS_DIR / "shell" / "shell.html")
    page = re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: parts[m.group(1)], expand_icons(template, tokens, icons))
    return stamp_reading_guide(page)  # the guide's line numbers, from the finished text


def assemble_artifact(kind: str, data: Optional[Dict[str, Any]] = None,
                      tokens: Optional[Dict[str, Any]] = None, theme: Optional[Dict[str, Any]] = None) -> Dict[str, str]:
    """Build the split claude.ai Artifact files: index.html, diagram.json, app.css and app.js."""
    parts, tokens, icons = _build_parts(kind, data, tokens, theme)
    shell_html = _read_asset(ASSETS_DIR / "shell" / "shell.html")
    _, _, script_template = _split_shell_html(shell_html)
    index_template = artifact_index_template(shell_html)
    index_html = re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: parts[m.group(1)], expand_icons(index_template, tokens, icons))
    app_css = "\n".join((parts["TOKENS_CSS"], parts["COMPONENTS_CSS"], parts["SHELL_CSS"], parts["TYPE_CSS"])) + "\n"
    app_js = re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: parts[m.group(1)], script_template.rstrip(chr(10)) + "\n")
    return {
        "index.html": index_html,
        "diagram.json": parts["DATA"] + "\n",
        "app.css": app_css,
        "app.js": app_js,
    }


# The web font (shell.html) is the one allowed network request: without it the page still works, in a system font
ALLOWED_EXTERNAL = re.compile(r"^https://fonts\.(googleapis|gstatic)\.com(/|$)")
_ANCHOR_TAG = re.compile(r"""<a\b(?:[^>"']|"[^"]*"|'[^']*')*>""", re.I)
_ANCHOR_HREF = re.compile(r"""\bhref\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)""", re.I)


def find_external_refs(html_text: str) -> List[str]:
    """Network references that would break the self-contained page."""
    # Passive <a href="..."> links only navigate on user click; strip href inside <a> tags
    # while still scanning any other attributes on <a> (e.g. style="url(...)") and all resource tags.
    stripped = _ANCHOR_TAG.sub(lambda m: _ANCHOR_HREF.sub("", m.group(0)), html_text)
    refs = re.findall(
        r"""(?:src|href)\s*=\s*["']https?://[^"']+|@import[^;]+|url\(\s*["']?https?://[^)]+""",
        stripped,
    )
    return sorted({r for r in refs if not ALLOWED_EXTERNAL.match(re.sub(r"""^(?:src|href)\s*=\s*["']""", "", r))})


def _artifact_external_refs(index_path: Path) -> List[str]:
    """Return any disallowed external references across a split artifact's index.html, app.css and app.js."""
    refs: Set[str] = set()
    for name in (index_path.name, "app.css", "app.js"):
        asset = index_path.with_name(name)
        if asset.is_file():
            refs.update(find_external_refs(asset.read_text(encoding="utf-8")))
    return sorted(refs)


def scaffold_html(data: Dict[str, Any], output_path: Path, target: str = "file", tokens: Optional[Dict[str, Any]] = None,
                  theme: Optional[Dict[str, Any]] = None, save_id: Optional[str] = None):
    """Write the standalone HTML for `data` (its diagramType selects the plugin)."""
    if target == "artifact":
        return scaffold_artifact(data, output_path, tokens, theme)
    html_text = assemble_page(data.get("diagramType") or DEFAULT_TYPE, data, target, tokens, theme)
    if save_id:
        html_text = stamp_save_id(html_text, save_id)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(html_text)
    print(f"[OK] Generated interactive {data.get('diagramType') or DEFAULT_TYPE}: {output_path} ({output_path.stat().st_size} B)")


def scaffold_artifact(data: Dict[str, Any], output_path: Path, tokens: Optional[Dict[str, Any]] = None,
                      theme: Optional[Dict[str, Any]] = None) -> Path:
    """Write the split claude.ai Artifact files (index.html, diagram.json, app.css, app.js) and return index.html."""
    kind = data.get("diagramType") or DEFAULT_TYPE
    out_dir = output_path.parent if output_path.suffix.lower() == ".html" else output_path
    out_dir.mkdir(parents=True, exist_ok=True)
    total_bytes = 0
    for name, content in assemble_artifact(kind, data, tokens, theme).items():
        p = out_dir / name
        with p.open("w", encoding="utf-8", newline="\n") as fh:
            fh.write(content)
        total_bytes += p.stat().st_size
    print(f"[OK] Generated interactive {kind} artifact: {out_dir} ({total_bytes} B)")
    return out_dir / "index.html"


def _ensure_utf8_output() -> None:
    """Avoid UnicodeEncodeError / decode errors on Windows consoles that default to cp1252."""
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            if stream is not None:
                stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def _flowchart_canvas(laid: Dict[str, Any]) -> Tuple[float, float]:
    """(along the flow, across the lanes) in px, from laid-out positions."""
    audit = FlowchartAudit(laid)
    along = max((n.get("x", 0) + audit.node_wf(n) for n in laid.get("nodes") or []), default=0) + START_X
    across = sum(lane.get("height", audit.lane_min) for lane in laid.get("lanes") or []) or audit.lane_min
    return along, across


def _score_without_long_arrows(report: Dict[str, Any]) -> int:
    """The audit score with the long-arrow penalty given back (choose_flowchart_direction compares directions on it)."""
    return report["score"] + min(LONG_ARROW_MAX_PENALTY, report["long_arrows_count"] * LONG_ARROW_PENALTY)


def _choose_flowchart_direction(data: Dict[str, Any], timeout: int, browser: Optional[str],
                                tokens: Optional[Dict[str, Any]] = None) -> Tuple[Dict[str, Any], Optional[Any], Optional[Dict[str, Any]], str]:
    """Lay out a flowchart without "direction" in the direction that reads best; return (laid data, audit, report, why)."""
    lr = run_layout("flowchart", {**data, "direction": "LR"}, timeout=timeout, browser=browser, tokens=tokens)
    along, across = _flowchart_canvas(lr)
    fit_half = min(1.0, HALF_VIEW_W / along, VIEW_H / across)
    if fit_half >= READABLE_ZOOM:
        return lr, None, None, ""
    tb = run_layout("flowchart", {**data, "direction": "TB"}, timeout=timeout, browser=browser, tokens=tokens)
    tb_along, tb_across = _flowchart_canvas(tb)
    lr_zoom = min(1.0, VIEW_H / across)
    half_tb_zoom = min(1.0, HALF_VIEW_W / tb_across)
    fit_all = min(1.0, VIEW_W / along, VIEW_H / across)
    tb_zoom = min(1.0, VIEW_W / tb_across)
    # Half-screen viewports (agent/split-pane workflows): when LR overflows horizontally and TB fits the
    # half-screen width cleanly (>= READABLE_ZOOM), prefer vertical TB scrolling over sideways panning.
    half_screen_tb = half_tb_zoom >= READABLE_ZOOM and half_tb_zoom >= lr_zoom - 0.02
    if not half_screen_tb and (fit_all >= READABLE_ZOOM or tb_zoom < lr_zoom + TB_MIN_GAIN):
        return lr, None, None, ""
    # Rotating the same graph can add an edge crossing or two (score only, never a gate failure); that is worth much
    # bigger lanes, but a real defect (overlap, penetration, overflow) that left to right does not have is not.
    # Long arrows are left out of the comparison: the workflow splits them into connector pairs after layout (rule
    # 11), and a flow turned top to bottom often has a few backward ones that left to right does not flag.
    lr_audit, tb_audit = make_audit(lr, tokens), make_audit(tb, tokens)
    lr_report, tb_report = lr_audit.verify_collisions(), tb_audit.verify_collisions()
    score_loss = 10 if half_screen_tb else TB_MAX_SCORE_LOSS
    tb_quality_ok = (tb_report["passed"] or not lr_report["passed"]) and \
        _score_without_long_arrows(tb_report) >= _score_without_long_arrows(lr_report) - score_loss
    if tb_quality_ok:
        shown_zoom = half_tb_zoom if half_screen_tb else tb_zoom
        return tb, tb_audit, tb_report, (
            f"top to bottom: a long flow; lanes fill the screen at {shown_zoom:.0%} "
            f"({tb_across:.0f} x {tb_along:.0f} px) against {lr_zoom:.0%} left to right "
            f"({along:.0f} x {across:.0f} px)"
        )
    return lr, lr_audit, lr_report, ""


def choose_flowchart_direction(data: Dict[str, Any], timeout: int, browser: Optional[str],
                               tokens: Optional[Dict[str, Any]] = None) -> Tuple[Dict[str, Any], str]:
    """Lay out a flowchart that does not set "direction", in the direction that reads best; return (laid data, why).

    Left to right is kept when the whole diagram fits the screen at a readable zoom. Otherwise the lanes should fill
    the screen while the reader scrolls along the flow, and the direction whose lanes fill it at the bigger zoom wins:
    a landscape screen is about twice as wide as tall, so a long flow almost always reads better top to bottom. Only
    positions are compared (no render); the second layout costs about 0.2 s with Node.js."""
    laid, _, _, note = _choose_flowchart_direction(data, timeout, browser, tokens)
    return laid, note


def add_connector_pairs(data: Dict[str, Any], laid: Dict[str, Any], long_arrows: List[Tuple[Dict[str, Any], float, int]],
                        max_letters: int = LONG_ARROW_MAX_PAIRS) -> Tuple[Dict[str, Any], List[str]]:
    """Rule 11: split the long arrows the audit found into connector pairs; return (new authoring data, [INFO] lines).

    Works on the authoring data, not the laid-out copy, and keeps the laid direction so the second layout matches the
    first. One letter per target (at most max_letters, severest/longest first, lettered in reading order); letters
    already on a connector are skipped."""
    groups: Dict[str, List[str]] = {}
    for e, _, _ in long_arrows:
        groups.setdefault(e["to"], []).append(e["id"])
    used = {str(n.get("label")) for n in data["nodes"] if n.get("type") == "connector"}
    letters = (l for l in [chr(c) for c in range(65, 91) if chr(c) not in "IO"]
               + [a + b for a in "AB" for b in "ABCDEFGHJKLMNPQRSTUVWXYZ"] if l not in used)
    nodes, edges = list(data["nodes"]), [dict(e) for e in data["edges"]]
    by_id = {e["id"]: e for e in edges}
    node_map = {n["id"]: n for n in nodes}
    laid_map = {n["id"]: n for n in laid.get("nodes") or []}
    lane_rank = {l["id"]: i for i, l in enumerate(laid.get("lanes") or data.get("lanes") or [])}
    selected = sorted(
        list(groups.items())[:max(0, max_letters)],
        key=lambda item: (
            min(laid_map.get(by_id[eid]["from"], {}).get("x", 0) for eid in item[1]),
            laid_map.get(item[0], {}).get("x", 0),
            lane_rank.get(laid_map.get(item[0], {}).get("laneId"), 0),
        ),
    )
    info = []
    for target, eids in selected:
        letter = next(letters)
        low = letter.lower()
        nodes.append({"id": f"c_{low}_out", "laneId": node_map[target]["laneId"], "type": "connector", "label": letter})
        edges.append({"id": f"c_{low}_out_e", "from": f"c_{low}_out", "to": target, "label": ""})
        for i, eid in enumerate(eids, 1):
            e = by_id[eid]
            cid = f"c_{low}_in" + (f"_{i}" if len(eids) > 1 else "")
            nodes.append({"id": cid, "laneId": node_map[e["from"]]["laneId"], "type": "connector", "label": letter})
            e["to"] = cid
        names = ", ".join(str(node_map[by_id[i]["from"]].get("label") or by_id[i]["from"]) for i in eids)
        info.append(f"[INFO] Added connector pair {letter}: {names} -> {node_map[target].get('label') or target}")
    out = {**data, "nodes": nodes, "edges": edges}
    if "direction" in laid:
        out["direction"] = laid["direction"]
    return out, info


def split_long_arrows(data: Dict[str, Any], laid: Dict[str, Any], audit: Any, report: Dict[str, Any], timeout: int,
                      browser: Optional[str], tokens: Optional[Dict[str, Any]], prefix: str = "") -> Tuple[Dict[str, Any], Any, Dict[str, Any]]:
    """Rule 11: the tool splits the long arrows itself, round after round, and keeps the best layout seen.
    Returns (laid out data, audit, report); prints one [INFO] line per connector pair."""
    quality = lambda r: (not r["passed"], len(r["issues"]), r["long_arrows_count"], r["edge_crossings"])  # noqa: E731
    base, letters = data, 0
    for _ in range(LONG_ARROW_MAX_ROUNDS):
        if not report["long_arrows"] or letters >= LONG_ARROW_MAX_PAIRS:
            break
        split, info = add_connector_pairs(base, laid, report["long_arrows"], LONG_ARROW_MAX_PAIRS - letters)
        laid2 = run_layout("flowchart", split, timeout=timeout, browser=browser, tokens=tokens)
        audit2 = make_audit(laid2, tokens)
        report2 = audit2.verify_collisions()
        if quality(report2) >= quality(report):
            break
        base, letters = split, letters + len(info)
        laid, audit, report = laid2, audit2, report2
        print("\n".join(info if not prefix else [i.replace("[INFO] ", f"[INFO] {prefix}", 1) for i in info]))
    return laid, audit, report


def layout_children(data: Dict[str, Any], report: Dict[str, Any], keep: bool, timeout: int, browser: Optional[str],
                    tokens: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Lay out each child flow of a flowchart as its own flat diagram (same direction as the parent), merge it back and add
    its audit lines to `report` (prefixed with the flow's name)."""
    for slug in sub.child_order(data):
        name = data["children"][slug].get("name") or slug
        flat = sub.flat_tab(data, slug)
        if not keep:
            flat, note = order_flowchart_lanes(flat, timeout, browser, tokens)
            if note:
                print(f"[INFO] {name}: {note}")
        laid = run_layout("flowchart", flat, timeout=timeout, browser=browser, tokens=tokens, keep=keep)
        audit = make_audit(laid, tokens)
        rep = audit.verify_collisions()
        if not keep and rep["long_arrows"]:
            laid, audit, rep = split_long_arrows(flat, laid, audit, rep, timeout, browser, tokens, prefix=f"{name}: ")
        data = sub.merge_tab(data, slug, laid)
        for key in ("issues", "data_issues", "budget_warnings"):
            report[key] = list(report[key]) + [f"{name}: {i}" for i in rep[key]]
    return data


def order_flowchart_lanes(data: Dict[str, Any], timeout: int, browser: Optional[str],
                          tokens: Optional[Dict[str, Any]] = None) -> Tuple[Dict[str, Any], str]:
    """Order swimlanes by each lane's first step on the flow (flowchart rule: lane order follows the flow); return
    (data, INFO note, empty when nothing changed). Lanes the walk never reaches keep their relative order after the
    others. Kept as the user wrote it: "laneOrder": "fixed", no swimlanes, two lanes or fewer, phase lanes (every
    non-feedback edge goes to the same or a later lane, or the names read Step/Phase/Stage). The reordered layout is
    only used when its audit shows no more long arrows plus crossings than the user's order (two layouts, ~0.4 s)."""
    lanes, nodes = data.get("lanes") or [], data.get("nodes") or []
    if data.get("laneOrder") == "fixed" or data.get("swimlanes") is False or len(lanes) <= 2:
        return data, ""
    rank = {lane["id"]: i for i, lane in enumerate(lanes)}
    lane_of = {n["id"]: n.get("laneId") for n in nodes}
    edges = [e for e in data.get("edges") or [] if not e.get("feedback") and e.get("from") in lane_of and e.get("to") in lane_of]
    if all(rank.get(lane_of[e["from"]], 0) <= rank.get(lane_of[e["to"]], 0) for e in edges) or \
            all(re.match(r"(step|phase|stage)\b", str(lane.get("name", "")), re.I) for lane in lanes):
        return data, ""
    out: Dict[str, List[str]] = {}
    for e in edges:
        out.setdefault(e["from"], []).append(e["to"])
    seen: List[str] = []
    queue = [n["id"] for n in nodes if n.get("type") == "start"] or [nodes[0]["id"]]
    for nid in queue:  # breadth first: the queue grows as nodes are visited
        if nid not in seen:
            seen.append(nid)
            queue.extend(out.get(nid, []))
    first: List[str] = []
    for nid in seen:
        if lane_of[nid] in rank and lane_of[nid] not in first:
            first.append(lane_of[nid])
    order = first + [lane["id"] for lane in lanes if lane["id"] not in first]
    if order == [lane["id"] for lane in lanes]:
        return data, ""
    by_id = {lane["id"]: lane for lane in lanes}
    new = {**data, "lanes": [by_id[i] for i in order]}

    def cost(d: Dict[str, Any]) -> int:
        report = make_audit(run_layout("flowchart", {"direction": "LR", **d}, timeout=timeout, browser=browser, tokens=tokens), tokens).verify_collisions()
        return report["long_arrows_count"] + report["edge_crossings"]

    if cost(new) > cost(data):
        return data, ""
    return new, f"Lane order: {', '.join(by_id[i].get('name', i) for i in order)} (by first step on the flow; set \"laneOrder\": \"fixed\" to keep yours)."


def order_sequence_participants(data: Dict[str, Any]) -> Tuple[Dict[str, Any], str]:
    """Order sequence participants to reduce total message span while keeping actor and ui leftmost.

    Compares authored order against BFS from the first message sender and greedy adjacent swaps (never crossing the
    actor/ui boundary), keeping authored order on ties. Returns (data, note)."""
    ps = data.get("participants") or []
    by_id = {p["id"]: p for p in ps if "id" in p}
    if (data.get("participantOrder") == "fixed" or len(ps) <= 2 or len(by_id) != len(ps)
            or any(p.get("column") is not None for p in ps)):
        return data, ""
    ms = [m for m in data.get("messages") or [] if m.get("from") in by_id and m.get("to") in by_id]
    if not ms:
        return data, ""
    authored = [p["id"] for p in ps]
    is_left = lambda pid: by_id[pid].get("kind") in ("actor", "ui")  # noqa: E731
    partition = lambda ids: [i for i in ids if is_left(i)] + [i for i in ids if not is_left(i)]  # noqa: E731

    def span(ids: List[str]) -> int:
        idx = {pid: i for i, pid in enumerate(ids)}
        return sum(abs(idx[m["from"]] - idx[m["to"]]) for m in ms)

    adj: Dict[str, List[str]] = {}
    for m in ms:
        u, v = m["from"], m["to"]
        if u != v:
            if v not in adj.setdefault(u, []):
                adj[u].append(v)
            if u not in adj.setdefault(v, []):
                adj[v].append(u)
    seen: List[str] = []
    for seed in [ms[0]["from"]] + authored:
        if seed in seen:
            continue
        queue = [seed]
        for u in queue:
            if u not in seen:
                seen.append(u)
                queue.extend(adj.get(u, []))

    def tighten(ids: List[str]) -> Tuple[int, List[str]]:
        cur = partition(ids)
        cur_span = span(cur)
        improved = True
        while improved:
            improved = False
            for i in range(len(cur) - 1):
                if is_left(cur[i]) != is_left(cur[i + 1]):
                    continue
                cand = cur[:]
                cand[i], cand[i + 1] = cand[i + 1], cand[i]
                cand_span = span(cand)
                if cand_span < cur_span:
                    cur, cur_span, improved = cand, cand_span, True
        return cur_span, cur

    bfs = partition(seen)
    auth_left = partition(authored)
    starts = (bfs, auth_left) if span(bfs) < span(auth_left) else (auth_left, bfs)
    best_span, best = min((tighten(s) for s in starts), key=lambda r: r[0])
    if best_span >= span(authored) or best == authored:
        return data, ""
    ordered = [by_id[pid] for pid in best]
    names = ", ".join(str(p.get("name") or p["id"]) for p in ordered)
    return {**data, "participants": ordered}, f"Participant order: {names} (set \"participantOrder\": \"fixed\" to keep yours)."


def pack_sequence_columns(data: Dict[str, Any]) -> Tuple[Dict[str, Any], str]:
    """Enable lifespans and pack non-overlapping participants into shared columns when it saves >= 2 columns."""
    ps = data.get("participants") or []
    if ("lifespans" in data or len(ps) <= 2
            or any("id" not in p for p in ps) or len({p["id"] for p in ps}) != len(ps)
            or any(p.get(k) is not None for p in ps for k in ("column", "start", "end"))):
        return data, ""
    audit = SequenceAudit(data)
    spans = {p["id"]: audit.own_span(p["id"]) for p in ps}
    columns: List[List[Tuple[str, List[int]]]] = []
    solo = 0
    assigned: Dict[str, str] = {}
    for p in ps:
        pid = p["id"]
        sp = spans[pid]
        if sp is None:
            solo += 1
            continue
        for col in columns:
            if all(max(sp[0], osp[0]) > min(sp[1], osp[1]) for _, osp in col):
                col.append((pid, sp))
                assigned[pid] = col[0][0]
                break
        else:
            columns.append([(pid, sp)])
    if len(ps) - (len(columns) + solo) < 2:
        return data, ""
    new_ps = [{**p, "column": assigned[p["id"]]} if p["id"] in assigned else dict(p) for p in ps]
    names = {p["id"]: str(p.get("name") or p["id"]) for p in ps}
    pairs = ", ".join(f"{names[s]} with {names[h]}" for s, h in assigned.items())
    return {**data, "lifespans": True, "participants": new_ps}, (
        f"Lifespans: shared {len(assigned)} columns ({pairs}; set \"lifespans\": false to keep separate)."
    )


def apply_sequence_defaults(data: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    """Apply sequence CLI defaults (--layout without --keep-layout): auto-numbered, participant order, column packing."""
    notes: List[str] = []
    for step in (order_sequence_participants, pack_sequence_columns):
        data, note = step(data)
        if note:
            notes.append(note)
    return data, notes


def apply_erd_defaults(data: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    """Apply ERD CLI defaults (--layout without --keep-layout): mark every column a relationship names as "fk", make a
    relationship whose columns are all "pk" identifying (unless the author set "identifying"), and open at detail "keys"
    for more than 15 tables, or a table with more than 25 columns, when the author left "detail" out."""
    ents = [dict(e, columns=[dict(c) for c in e.get("columns") or [] if isinstance(c, dict)]) if isinstance(e, dict) else e
            for e in data.get("entities") or []]
    by_id = {e.get("id"): e for e in ents if isinstance(e, dict)}
    rels = []
    for r in data.get("relationships") or []:
        if not isinstance(r, dict):
            rels.append(r)
            continue
        names = r.get("columns") if isinstance(r.get("columns"), list) else []
        cols = {c.get("name"): c for c in (by_id.get(r.get("from")) or {}).get("columns", [])}
        for n in names:
            if n in cols:
                cols[n]["fk"] = True
        if names and "identifying" not in r and all(cols.get(n, {}).get("pk") is True for n in names):
            r = {**r, "identifying": True}
        rels.append(r)
    if "entities" in data and "relationships" in data:
        data = {**data, "entities": ents, "relationships": rels}
    if "detail" in data or not (len(ents) > 15 or any(len(e.get("columns") or []) > 25 for e in ents if isinstance(e, dict))):
        return data, []
    return {**data, "detail": "keys"}, ["Detail: keys (only key columns shown; the Columns button shows the rest)"]


LAYOUT_NOTE = "report it; do not change the JSON for it"


def main():
    _ensure_utf8_output()
    parser = argparse.ArgumentParser(description="Multi-Swimlane Flowchart Layout & Verification Engine")
    parser.add_argument("--layout", "-l", help="Input Mermaid file (.mmd), or a JSON or HTML file, to compute layout for")
    parser.add_argument("--output", "-o", help="Output HTML file path (or the Mermaid / JSON path if extracting)")
    parser.add_argument("--browser", help="Chrome/Chromium path for --layout when Node.js is not installed")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help=f"Seconds allowed for the layout engine (default: {DEFAULT_TIMEOUT})")
    parser.add_argument("--verify", "-v", help="Verify collisions and layout constraints for an HTML or JSON file")
    parser.add_argument("--extract", "-e", help="Print the diagram of an HTML page (or a diagram.json / JSON file) as Mermaid, "
                                                 "written with the page's stored theme palette")
    parser.add_argument("--json", action="store_true", help="With --extract: print the canonical JSON instead of Mermaid")
    parser.add_argument("--flat", action="store_true", help="With --extract: one flow with every subprocess expanded in place")
    parser.add_argument("--sub", metavar="SLUG", help="With --extract: only this subprocess flow (a child), as its own flowchart")
    parser.add_argument("--keep-from", help="With --layout <file.mmd>: an older HTML page or diagram.json; when both have exactly "
                                            "the same item ids, take its positions and only redraw lines and labels")
    parser.add_argument("--keep-layout", action="store_true",
                        help="With --layout: keep the positions saved in the input's `layout` map and only redraw lines and labels "
                             "(rebuild a page with a newer engine and UI without moving anything the user placed).")
    parser.add_argument("--target", choices=TARGETS, default="file",
                        help="With --layout: file (default) writes the standalone HTML file; artifact writes the page "
                             "in the shape a claude.ai Artifact needs (publish it with the Artifact tool)")
    parser.add_argument("--icons", metavar="DIR", help="Folder of local icon packs (<pack>.json, see references/icon-packs.md); "
                        "default: icons/ next to the input file, then ./icons")
    parser.add_argument("--theme", help="Theme file (tokens in the shape of assets/tokens/default.json; omitted keys keep "
                                        "the default) or 'default' to reset to the default theme: page styles, fonts and text widths for --layout and --verify. "
                                        "Without it: the theme stored in the page, then .ultimate-diagram/theme.json, then <skill-dir>/theme.json, then the default")
    parser.add_argument("--extract-theme", help="Write the theme stored in this HTML page to --output (or print it)")
    parser.add_argument("--screenshot", "-s",
                        help="With --layout: also render a PNG here and run the layout report (one command does both)")
    parser.add_argument("--rm-input", action="store_true",
                        help="With --layout: delete the Mermaid input file once layout finishes with [DONE]")
    parser.add_argument("--no-save-helper", action="store_true",
                        help="Skip registering or starting the local direct-save helper for this run")
    parser.add_argument("--no-holidays", action="store_true",
                        help="With --layout on a gantt diagram: skip online public-holiday fetching")
    parser.epilog = "SKILL.md documents every flag an agent needs; no others are required."

    args = parser.parse_args()
    tokens = theme = None
    given = next((Path(v) for v in (args.layout, args.verify, args.extract) if v), None)
    ICON_DIRS[:] = ([Path(args.icons)] if args.icons else [(given.parent if given else Path(".")) / "icons", Path("icons")]) + [BUNDLED_LOGOS_DIR]

    if args.extract_theme:
        stored = read_stored_theme(Path(args.extract_theme).read_text(encoding="utf-8"))
        if stored is None:
            sys.exit("[NOTE] This page has no stored theme (saved before themes, or built with the default theme).")
        text = json.dumps(stored, indent=2) + chr(10)
        if args.output:
            Path(args.output).parent.mkdir(parents=True, exist_ok=True)
            Path(args.output).write_text(text, encoding="utf-8")
            print(f"[OK] Stored theme saved to: {args.output}")
        else:
            print(text, end="")
        return

    if args.extract:
        ext_p = Path(args.extract)
        raw = read_data_block_from_path(ext_p)
        kind = raw.get("diagramType") or DEFAULT_TYPE
        # Authoring JSON: the block without its `layout` map (--layout recomputes positions anyway)
        model = from_disk(kind, raw)
        data = authoring_json(kind, model)
        head = []
        if (args.flat or args.sub) and not (kind == "flowchart" and data.get("children")):
            sys.exit("[ERROR] --flat and --sub need a flowchart with subprocess flows (a sub_ block); this file has none.")
        if kind == "flowchart" and data.get("children"):
            head = sub.outline(data, args.sub)
            if args.sub:
                if args.sub not in data["children"]:
                    sys.exit(f"[ERROR] No subprocess flow {args.sub!r}. This file has: {', '.join(sub.child_order(data))}.")
                data = sub.flat_tab(data, args.sub)
            elif args.flat:
                data = sub.flatten(data)
        ext_html_text = ext_p.read_text(encoding="utf-8") if ext_p.is_file() and ext_p.suffix.lower() in (".html", ".htm") else None
        if args.json:
            text, what = format_json(data), "Extracted data"
        else:
            # The palette of --theme, else of the theme the page stores, else the default
            page = ext_p if ext_p.suffix.lower() in (".html", ".htm") else ext_p.with_name("index.html")
            page_text = ext_html_text if ext_html_text is not None else (
                page.read_text(encoding="utf-8") if page.is_file() and ext_p.name == "diagram.json" else None
            )
            # A lane's colour sits in the page's layout map, not in the authoring JSON, but Mermaid can say it (`class lane c3`)
            colors = {l["id"]: l["color"] for l in model.get("lanes") or [] if l.get("color")}
            data = {**data, "lanes": [{**l, "color": colors[l["id"]]} if l["id"] in colors else l for l in data.get("lanes") or []]} if colors else data
            data, free = strip_free_notes(kind, data)
            try:
                text = run_mermaid("to", kind, data, args.timeout, args.browser, theme_palette(resolve_theme(args.theme, page_text)[0])).rstrip("\n")
            except (EngineUnavailable, RuntimeError) as exc:
                sys.exit(f"[ERROR] {exc}")
            what = "Mermaid"
            if head:
                text = re.sub(r"(?m)^flowchart", "\n".join(head) + "\nflowchart", text, count=1)
            if free:
                text += "\n%% Notes (free: they explain nothing in particular)\n" + "\n".join(free)
        if ext_html_text is not None:
            handle_extract_html(ext_p, ext_html_text, no_helper=args.no_save_helper)
        update_note = check_version_nonblocking()
        if args.output:
            out_p = Path(args.output)
            out_p.parent.mkdir(parents=True, exist_ok=True)
            out_p.write_text(text + chr(10), encoding="utf-8")
            print(f"[OK] {what} saved to: {out_p}")
            if update_note:
                print(update_note)
        else:
            print(text)
            if update_note:
                print(update_note, file=sys.stderr)
        return

    if args.verify:
        p = Path(args.verify)
        is_html = p.suffix.lower() == ".html"
        data, html_text, is_split, needs_engine = _load_input(p)
        external_refs = (_artifact_external_refs(p) if is_split else find_external_refs(html_text)) if is_html else []
        tokens, theme, note = resolve_theme(args.theme, html_text)
        tokens = tokens if theme is not None else None
        if note:
            print(note)

        data = normalize_diagram_type(data)
        if (is_html or needs_engine) and data["diagramType"] in ("sequence", "erd", "usecase", "c4"):
            # A sequence page saves no positions and an ER or use case page no routes: run the engine, as the page does on load
            try:
                data = run_layout(data["diagramType"], data, timeout=args.timeout, browser=args.browser, tokens=tokens)
            except EngineUnavailable as exc:
                sys.exit(f"[ERROR] {exc}")
        audit = make_audit(data, tokens)
        report = audit.verify_collisions()
        if data["diagramType"] == "flowchart" and data.get("children"):
            report["budget_warnings"] = list(report["budget_warnings"]) + sub.checks(data)

        print(f"\n======================================================================")
        print(f"--- {audit.title} Verification & Quality Audit: {p.name} ---")
        print(f"======================================================================")
        for line in audit.summary_lines(report):
            print(line)
        if is_html:
            print(f"{'✓' if not external_refs else '✗'} Self-Containment:              {len(external_refs)} external references")
        print(f"======================================================================")

        for warning in report["budget_warnings"]:
            print(f"[WARN] {warning}")
        if is_html and not is_split and stamp_reading_guide(html_text) != html_text:
            # The JSON was edited by hand: line 2 names the wrong range (Save or --layout rewrites it)
            print("[WARN] The reading guide's line numbers (line 2) no longer match the data block. "
                  "Save the page or re-run --layout to update them.")
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
        keep = args.keep_layout  # keep the saved positions: --keep-layout, or --keep-from with the same item ids
        mermaid_bad = False
        is_mmd = is_mermaid_input(in_p)
        if is_mmd:
            if args.keep_layout:
                sys.exit("[ERROR] --keep-layout needs a page or JSON that carries positions. For Mermaid input use --keep-from <old page>.")
            text = in_p.read_text(encoding="utf-8-sig")
            kind = mermaid_kind(text)
            try:
                read = run_mermaid("from", kind, text, args.timeout, args.browser)
            except (EngineUnavailable, RuntimeError) as exc:
                sys.exit(f"[ERROR] {in_p.name}: {exc}")
            data, page_text = read["data"], None
            # The use case reader leaves its lines without the tag the others carry
            for tag, lines in (("[INFO]", read["infos"]), ("[WARN]", read["warnings"])):
                for line in lines:
                    print(line if line.startswith("[") else f"{tag} {line}")
            mermaid_bad = bool(read["warnings"])
            if args.keep_from:
                old, page_text, _, _ = _load_input(Path(args.keep_from), force_from_disk=True)
                try:
                    kept, why = keep_positions_from(kind, normalize_diagram_type(data), old, args.timeout, args.browser)
                except (EngineUnavailable, RuntimeError) as exc:
                    sys.exit(f"[ERROR] {exc}")
                if kept is None:
                    print(f"[INFO] Positions reset: {why}")
                else:
                    data, keep = kept, True
        else:
            if args.keep_from:
                sys.exit("[ERROR] --keep-from needs Mermaid input to --layout (a .mmd file). For JSON or a page use --keep-layout.")
            data, page_text, _, _ = _load_input(in_p, force_from_disk=args.keep_layout)
        tokens, theme, note = resolve_theme(args.theme, page_text)
        tokens = tokens if theme is not None else None
        if note:
            print(note)

        data = normalize_diagram_type(data)
        c4_has_pos = data["diagramType"] == "c4" and any(
            "x" in obj and "y" in obj
            for list_key in ("elements", "groups")
            for obj in (data.get(list_key) or [])
        )
        if data["diagramType"] == "flowchart" and not args.keep_layout:
            data, icon_note = auto_lane_icons(data)
            if icon_note:
                print(f"[INFO] {icon_note}")
        kids = data["diagramType"] == "flowchart" and data.get("children")
        if kids:
            full, data = data, sub.flat_tab(data)
        direction_note = ""
        audit = report = None
        try:
            with layout_session():
                if not keep and data["diagramType"] == "flowchart":
                    data, lane_note = order_flowchart_lanes(data, args.timeout, args.browser, tokens)
                    if lane_note:
                        print(f"[INFO] {lane_note}")
                elif not keep and data["diagramType"] == "sequence":
                    data, seq_notes = apply_sequence_defaults(data)
                    for seq_note in seq_notes:
                        print(f"[INFO] {seq_note}")
                elif not keep and data["diagramType"] == "erd":
                    data, erd_notes = apply_erd_defaults(data)
                    for erd_note in erd_notes:
                        print(f"[INFO] {erd_note}")
                elif data["diagramType"] == "gantt":
                    for h_note in resolve_holidays(data, no_holidays=args.no_holidays):
                        print(f"[INFO] {h_note}")
                if not keep and data["diagramType"] == "flowchart" and "direction" not in data:
                    laid_out_data, audit, report, direction_note = _choose_flowchart_direction(
                        data, args.timeout, args.browser, tokens
                    )
                else:
                    laid_out_data = run_layout(data["diagramType"], data, timeout=args.timeout, browser=args.browser, tokens=tokens, keep=keep)
                if direction_note:
                    print(f"[INFO] Direction: {direction_note}. To force one, set \"direction\" in the JSON.")
                if audit is None or report is None:
                    audit = make_audit(laid_out_data, tokens)
                    report = audit.verify_collisions()
                if data["diagramType"] == "flowchart" and not keep and report["long_arrows"]:
                    laid_out_data, audit, report = split_long_arrows(data, laid_out_data, audit, report, args.timeout, args.browser, tokens)
                if kids:
                    laid_out_data = sub.merge_tab(full, None, laid_out_data)
                    laid_out_data = layout_children(laid_out_data, report, keep, args.timeout, args.browser, tokens)
        except EngineUnavailable as exc:
            sys.exit(f"[ERROR] {exc}")

        # What is left of the long arrows is layout: report it, never a reason to edit the JSON
        is_long = lambda w: "Long arrow" in w or "long, tangled arrow" in w
        for w in [w for w in report["budget_warnings"] if is_long(w)]:
            print(f"[INFO] Layout: {w.split(': split')[0]} ({LAYOUT_NOTE})")
        report["budget_warnings"] = [w for w in report["budget_warnings"] if not is_long(w)]
        if laid_out_data["diagramType"] == "flowchart":
            report["budget_warnings"] = list(report["budget_warnings"]) + sub.checks(laid_out_data)
            for slug in [None, *sub.child_order(laid_out_data)]:
                tab = sub.flat_tab(laid_out_data, slug)
                if sub.tab_stats(tab["nodes"])[0] > sub.STEP_LIMIT:
                    print("\n".join(sub.rpst_candidates(tab)))
            if kids:
                names = ", ".join(f"{c.get('name') or k} ({sub.tab_stats(c['nodes'])[0]} steps, {sub.tab_stats(c['nodes'])[1]} lanes)"
                                  for k, c in laid_out_data["children"].items())
                print(f"[INFO] Subprocess flows, one tab each: {names}.")

        page_data = laid_out_data
        if laid_out_data["diagramType"] == "c4" and not (keep and c4_has_pos):
            # C4 opens in Auto-Tidy unless the source already carried pinned positions (`layout` map):
            # strip computed x/y so to_disk writes no `layout` map.
            page_data = copy.deepcopy(laid_out_data)
            for list_key in ("elements", "groups"):
                for obj in page_data.get(list_key) or []:
                    obj.pop("x", None)
                    obj.pop("y", None)

        save_id = None
        if args.target == "artifact":
            out_path = Path(args.output) if args.output else in_p.with_suffix("")
            render_target = scaffold_artifact(page_data, out_path, tokens, theme)
            external_refs = _artifact_external_refs(render_target)
        else:
            out_path = Path(args.output) if args.output else in_p.with_suffix(".html")
            if is_feature_enabled():
                for candidate in (Path(args.keep_from) if args.keep_from else None, in_p, out_path):
                    if candidate and candidate.is_file() and candidate.suffix.lower() in (".html", ".htm"):
                        try:
                            save_id = extract_save_id(candidate.read_text(encoding="utf-8"))
                        except OSError:
                            save_id = None
                        if save_id:
                            break
                if not save_id:
                    save_id = generate_save_id()
            scaffold_html(page_data, out_path, "file", tokens, theme, save_id=save_id)
            external_refs = find_external_refs(out_path.read_text(encoding="utf-8"))
            render_target = out_path

        # DATA problems (the agent fixes the JSON) are [WARN]/[ERROR] and the only reason for [NEXT]; LAYOUT problems
        # (the engine's job) are [INFO] Layout lines that never fail the run. --verify keeps the strict gates.
        data_bad = mermaid_bad
        for warning in list(report["budget_warnings"]) + logo_warnings(laid_out_data):
            data_bad = True
            print(f"[WARN] {warning}")
        if external_refs:
            data_bad = True
            print("[FAIL] HTML loads external resources (must be fully self-contained):")
            for ref in external_refs:
                print(f"  - {ref}")
        for issue in report["data_issues"]:
            data_bad = True
            print(f"[WARN] {issue}")
        layout_issues = [i for i in report["issues"] if i not in report["data_issues"]]
        for issue in layout_issues:
            print(f"[INFO] Layout: {issue} ({LAYOUT_NOTE})")
        if layout_issues:
            print(f"[INFO] Layout: Quality score {report['score']}/100, HTML still written ({LAYOUT_NOTE})")
        elif not report["data_issues"]:
            print(audit.pass_line(report))

        render_code = 0
        if args.screenshot:
            render_code, render_clean = run_render(render_target, Path(args.screenshot), args.browser)
            data_bad = data_bad or not render_clean
        if render_code:
            sys.exit(render_code)
        if not data_bad and args.rm_input and is_mmd and in_p.resolve() != render_target.resolve():
            in_p.unlink(missing_ok=True)
        if not data_bad:
            if save_id and args.target == "file":
                helper_note = handle_layout_output(out_path, save_id, no_helper=args.no_save_helper)
                if helper_note:
                    print(helper_note)
            update_note = check_version_nonblocking()
            if update_note:
                print(update_note)
        print("[NEXT] Fix the [WARN] lines (data) and re-run." if data_bad else
              "[DONE] The diagram is final: do not re-word, re-run or re-render; report only actionable [INFO] lines (problems, resets, updates).")
        if external_refs or report["data_issues"]:
            sys.exit(1)


def run_render(html_path: Path, png_path: Path, browser: Optional[str]) -> Tuple[int, bool]:
    """Run render_screenshot on the written HTML; return (exit code, clean = no WARN/ERROR lines)."""
    from render_screenshot import render_and_report
    return render_and_report(html_path, png_path, browser=browser)


if __name__ == "__main__":
    main()
