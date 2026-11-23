#!/usr/bin/env python3
"""Measure flowchart length along the flow and attribute critical-path length to its causes.

Phase 0 benchmark for `dev/plans/plan-flow-compaction.md`. Uses only the Python
standard library plus existing helpers in `scripts/`.

Usage:
  python3 dev/bench/measure_compaction.py
  python3 dev/bench/measure_compaction.py --all
  python3 dev/bench/measure_compaction.py --json
  python3 dev/bench/measure_compaction.py path/to/diagram.json ...
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import re
import sys
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from engine_runner import DEFAULT_TIMEOUT, layout_session, run_layout, run_mermaid  # noqa: E402
from layout_engine import (  # noqa: E402
    authoring_json,
    choose_flowchart_direction,
    make_audit,
    normalize_diagram_type,
    read_data_block,
)
from tokens import load_tokens, tokens_data  # noqa: E402

BENCHMARK_PATHS: Tuple[Path, ...] = (
    ROOT / "dev" / "samples" / "example-corporate-laptop-purchase-request.html",
    ROOT / "dev" / "samples" / "example-corporate-laptop-purchase-request-alternative.html",
    ROOT / "dev" / "tests" / "fixtures" / "flowchart" / "employee-onboarding.json",
    ROOT / "dev" / "tests" / "fixtures" / "flowchart" / "incident-response.json",
    ROOT / "dev" / "tests" / "fixtures" / "flowchart" / "order-fulfillment.json",
    ROOT / "dev" / "samples" / "motor-insurance-claim-processing.md",
    ROOT / "dev" / "examples" / "example-flowchart.json",
    ROOT / "dev" / "examples" / "example-flowchart-phases.json",
)

FIXTURES_DIR = ROOT / "dev" / "tests" / "fixtures" / "flowchart"

# Mirrors `LE_PROFILES` in `assets/types/flowchart/engine.js`.
PROFILES: Dict[str, Dict[str, Any]] = {
    "LR": {
        "col_w": 200.0,
        "tight_step": 144.0,
        "node_w": 144.0,
        "label_max_w": 140.0,
        "label_stub": 16.0,
        "label_across": False,
    },
    "TB": {
        "col_w": 136.0,
        "tight_step": 96.0,
        "node_w": 96.0,
        "label_max_w": 140.0,
        "label_stub": 16.0,
        "label_across": True,
    },
}

_MERMAID_FENCE_RE = re.compile(r"```mermaid\s*\n(.*?)```", re.S)


def _extract_mermaid(text: str) -> str:
    match = _MERMAID_FENCE_RE.search(text)
    if not match:
        raise ValueError("No ```mermaid ... ``` block found in Markdown file.")
    return match.group(1)


def load_diagram(path: Path, timeout: int = DEFAULT_TIMEOUT) -> Dict[str, Any]:
    """Load a flowchart into authoring JSON.

    For `.html` samples, drops `direction` so `choose_flowchart_direction` auto-picks it
    just like `--layout`. For `.json` and `.md`/`.mmd`, keeps declared `direction` if set.
    """
    suffix = path.suffix.lower()
    text = path.read_text(encoding="utf-8-sig")
    if suffix == ".html":
        raw = read_data_block(text)
        data = authoring_json("flowchart", raw)
        data = normalize_diagram_type(data)
        data = dict(data)
        data.pop("direction", None)
        return data
    if suffix in (".md", ".mmd"):
        mmd_text = _extract_mermaid(text) if suffix == ".md" else text
        parsed = run_mermaid("from", "flowchart", mmd_text, timeout=timeout)
        return normalize_diagram_type(parsed["data"])
    raw = json.loads(text)
    kind = raw.get("diagramType") or "flowchart"
    if "_readme" in raw or "layout" in raw:
        data = authoring_json(kind, raw)
    else:
        data = raw
    return normalize_diagram_type(data)


def _collapse_connectors(
    nodes: Sequence[Dict[str, Any]], edges: Sequence[Dict[str, Any]]
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Mirror `collapseConnectors` in `engine.js` so DAG analysis sees step-to-step edges."""
    by_id = {n["id"]: n for n in nodes}
    is_conn = lambda n: bool(n) and n.get("type") == "connector"
    conn_letter = lambda n: str((n or {}).get("label") or "").strip().upper()

    ins: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    outs: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for e in edges:
        if is_conn(by_id.get(e["to"])):
            ins[e["to"]].append(e)
        if is_conn(by_id.get(e["from"])):
            outs[e["from"]].append(e)

    sat_of: Dict[str, Dict[str, Any]] = {}
    out_of: Dict[str, Dict[str, Any]] = {}
    for n in nodes:
        if not is_conn(n):
            continue
        i_edges, o_edges = ins[n["id"]], outs[n["id"]]
        role = "in" if (i_edges and not o_edges) else ("out" if (o_edges and not i_edges) else None)
        stub = i_edges[0] if role == "in" else (o_edges[0] if role == "out" else None)
        anchor = by_id.get(stub["from"] if role == "in" else stub["to"]) if stub else None
        if not anchor or is_conn(anchor):
            continue
        sat = {"node": n, "anchor": anchor, "role": role}
        sat_of[n["id"]] = sat
        letter = conn_letter(n)
        if role == "out" and letter not in out_of:
            out_of[letter] = sat

    steps = [n for n in nodes if not is_conn(n)]
    step_ids = {n["id"] for n in steps}
    flat_edges: List[Dict[str, Any]] = []
    for e in edges:
        si = sat_of.get(e["to"])
        if si:
            so = out_of.get(conn_letter(si["node"]))
            if so and e["from"] in step_ids and so["anchor"]["id"] in step_ids:
                flat_edges.append({**e, "to": so["anchor"]["id"]})
            continue
        if e["from"] in sat_of:
            continue
        if e["from"] in step_ids and e["to"] in step_ids:
            flat_edges.append(e)
    return steps, flat_edges


def _find_forward_edges(
    steps: Sequence[Dict[str, Any]], edges: Sequence[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Mirror `engine.js` back-edge removal (forced feedback, DFS cycles, loop-closing arrows)."""
    node_ids = [n["id"] for n in steps]
    node_set = set(node_ids)
    forced: Set[Tuple[str, str]] = {
        (e["from"], e["to"]) for e in edges if e.get("feedback")
    }
    search_adj: Dict[str, List[str]] = {nid: [] for nid in node_ids}
    for e in edges:
        u, v = e["from"], e["to"]
        if (u, v) not in forced and u in search_adj and v in node_set:
            search_adj[u].append(v)

    back: Set[Tuple[str, str]] = set(forced)
    color: Dict[str, int] = {nid: 0 for nid in node_ids}

    def dfs(u: str) -> None:
        color[u] = 1
        for v in search_adj.get(u, ()):
            if v not in color:
                continue
            if color[v] == 1:
                back.add((u, v))
            elif color[v] == 0:
                dfs(v)
        color[u] = 2

    for nid in node_ids:
        if color[nid] == 0:
            dfs(nid)

    forward_edges = [
        e for e in edges if (e["from"], e["to"]) not in back and e["from"] in node_set and e["to"] in node_set
    ]

    # Loop-closing arrow pruning (mirrors engine.js lines 134-161).
    def compute_ranks(fwd: Sequence[Dict[str, Any]]) -> Dict[str, int]:
        adj: Dict[str, List[str]] = {nid: [] for nid in node_ids}
        indeg: Dict[str, int] = {nid: 0 for nid in node_ids}
        ranks: Dict[str, int] = {nid: 0 for nid in node_ids}
        for e in fwd:
            adj[e["from"]].append(e["to"])
            indeg[e["to"]] += 1
        q = deque(nid for nid in node_ids if indeg[nid] == 0)
        if not q and node_ids:
            q.append(node_ids[0])
        seen: Set[str] = set()
        while q:
            cur = q.popleft()
            seen.add(cur)
            for nxt in adj[cur]:
                ranks[nxt] = max(ranks[nxt], ranks[cur] + 1)
                indeg[nxt] -= 1
                if indeg[nxt] <= 0 and nxt not in seen:
                    q.append(nxt)
        return ranks

    def reaches(src: str, dst: str, fwd: Sequence[Dict[str, Any]]) -> bool:
        adj: Dict[str, List[str]] = defaultdict(list)
        for x in fwd:
            adj[x["from"]].append(x["to"])
        seen = {src}
        stack = [src]
        while stack:
            c = stack.pop()
            if c == dst:
                return True
            for nxt in adj.get(c, ()):
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        return False

    ranks0 = compute_ranks(forward_edges)
    back_out: Dict[str, List[str]] = defaultdict(list)
    for a, b in back:
        back_out[a].append(b)

    for e in list(forward_edges):
        bo = back_out.get(e["to"])
        if not bo:
            continue
        others = [x for x in forward_edges if x is not e and x["to"] == e["to"]]
        if not others:
            continue
        without = max(ranks0[x["from"]] + 1 for x in others)
        if ranks0[e["from"]] + 1 <= without:
            continue
        rest = [x for x in forward_edges if x is not e]
        if any(w == e["from"] or reaches(w, e["from"], rest) for w in bo):
            back.add((e["from"], e["to"]))
            forward_edges = rest

    return forward_edges


def _label_gap(label: Any, profile: Dict[str, Any], font_m: Dict[str, float]) -> float:
    """Mirror `labelGap` in `engine.js` lines 165-175."""
    t = str(label or "").strip()
    if not t:
        return 0.0
    longest = max(len(w) for w in t.split())
    w = max(
        longest * font_m["label"] + 20.0,
        min(len(t) * font_m["edgeWrap"] + 18.0, profile["label_max_w"]),
    )
    lines = math.ceil((len(t) * font_m["edgeWrap"] + 18.0) / profile["label_max_w"])
    across = 8.0 + 17.0 * min(lines, 3) if profile["label_across"] else w
    return across + 2.0 * profile["label_stub"]


def _topological_order(
    node_ids: Sequence[str], forward_edges: Sequence[Dict[str, Any]]
) -> List[str]:
    adj: Dict[str, List[str]] = {nid: [] for nid in node_ids}
    indeg: Dict[str, int] = {nid: 0 for nid in node_ids}
    for e in forward_edges:
        adj[e["from"]].append(e["to"])
        indeg[e["to"]] += 1
    q = deque(nid for nid in node_ids if indeg[nid] == 0)
    order: List[str] = []
    seen: Set[str] = set()
    while q:
        u = q.popleft()
        order.append(u)
        seen.add(u)
        for v in adj[u]:
            indeg[v] -= 1
            if indeg[v] == 0 and v not in seen:
                q.append(v)
    for nid in node_ids:
        if nid not in seen:
            order.append(nid)
    return order


def _classify_edge_step(
    dx: float,
    cross_lane: bool,
    label_gap: float,
    profile: Dict[str, Any],
) -> Dict[str, Any]:
    """Decompose an edge's horizontal advance `dx` into exact additive components.

    Guarantees: `base_px + label_widening_px + other_slack_px == dx`.
    """
    col_w = profile["col_w"]
    tight_step = profile["tight_step"]
    node_w = profile["node_w"]
    tol = 0.51

    if dx <= tol:
        return {
            "kind": "zero",
            "dx": max(0.0, dx),
            "base_px": 0.0,
            "label_widening_px": 0.0,
            "other_slack_px": max(0.0, dx),
            "cross_lane": cross_lane,
        }

    lbl_req = (node_w + label_gap) if label_gap > 0 else 0.0

    # Exact tight step (no label widening).
    if abs(dx - tight_step) <= tol:
        return {
            "kind": "tight",
            "dx": dx,
            "base_px": tight_step,
            "label_widening_px": 0.0,
            "other_slack_px": dx - tight_step,
            "cross_lane": cross_lane,
        }

    # Exact full column (no label widening).
    if abs(dx - col_w) <= tol:
        return {
            "kind": "full_col",
            "dx": dx,
            "base_px": col_w,
            "label_widening_px": 0.0,
            "other_slack_px": dx - col_w,
            "cross_lane": cross_lane,
        }

    # Label-widened tight step (cross-lane labelled edge whose label exceeds tight_step but < col_w).
    if cross_lane and lbl_req > tight_step + tol and lbl_req < col_w - tol and abs(dx - lbl_req) <= tol:
        return {
            "kind": "tight",
            "dx": dx,
            "base_px": tight_step,
            "label_widening_px": lbl_req - tight_step,
            "other_slack_px": dx - lbl_req,
            "cross_lane": cross_lane,
        }

    # Label-widened full column (labelled edge whose label exceeds col_w).
    if lbl_req > col_w + tol and abs(dx - lbl_req) <= tol:
        return {
            "kind": "full_col",
            "dx": dx,
            "base_px": col_w,
            "label_widening_px": lbl_req - col_w,
            "other_slack_px": dx - lbl_req,
            "cross_lane": cross_lane,
        }

    # Above full column (or above label-widened full column): full_col + label_widening + slack.
    if dx >= col_w - tol:
        lbl_extra = max(0.0, lbl_req - col_w) if lbl_req > col_w else 0.0
        slack = dx - col_w - lbl_extra
        if slack < 0:
            lbl_extra = max(0.0, dx - col_w)
            slack = 0.0
        return {
            "kind": "full_col",
            "dx": dx,
            "base_px": col_w,
            "label_widening_px": lbl_extra,
            "other_slack_px": slack,
            "cross_lane": cross_lane,
        }

    # Between tight_step and col_w (e.g. tight + label widening + snapping/shift).
    if dx >= tight_step - tol:
        lbl_extra = max(0.0, min(dx, lbl_req) - tight_step) if (cross_lane and lbl_req > tight_step) else 0.0
        slack = dx - tight_step - lbl_extra
        return {
            "kind": "tight",
            "dx": dx,
            "base_px": tight_step,
            "label_widening_px": lbl_extra,
            "other_slack_px": slack,
            "cross_lane": cross_lane,
        }

    # Between 0 and tight_step (e.g. zero step nudged by snapping or end-node blocker shift).
    return {
        "kind": "zero",
        "dx": dx,
        "base_px": 0.0,
        "label_widening_px": 0.0,
        "other_slack_px": dx,
        "cross_lane": cross_lane,
    }


def _analyze_structure_and_critical_path(
    laid: Dict[str, Any],
    profile: Dict[str, Any],
    font_m: Dict[str, float],
) -> Dict[str, Any]:
    steps, flat_edges = _collapse_connectors(laid.get("nodes", []), laid.get("edges", []))
    if not steps:
        return {
            "steps": 0,
            "longest_chain": 0,
            "forced_advancing_chain": 0,
            "all_zero_handoffs": 0,
            "all_advancing_handoffs": 0,
            "length_px": 0.0,
            "cols": 0.0,
            "attribution": {},
        }

    step_map = {n["id"]: n for n in steps}
    step_ids = [n["id"] for n in steps]
    forward_edges = _find_forward_edges(steps, flat_edges)
    topo = _topological_order(step_ids, forward_edges)

    incoming: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for e in forward_edges:
        incoming[e["to"]].append(e)

    # Longest chain in DAG (edges) and longest same-lane/forced-advancing chain (edges).
    dag_len: Dict[str, int] = {nid: 0 for nid in step_ids}
    forced_len: Dict[str, int] = {nid: 0 for nid in step_ids}
    for v in topo:
        for e in incoming[v]:
            u = e["from"]
            dag_len[v] = max(dag_len[v], dag_len[u] + 1)
            same_lane = step_map[u].get("laneId") == step_map[v].get("laneId")
            forced_len[v] = max(forced_len[v], forced_len[u] + (1 if same_lane else 0))

    longest_chain = max(dag_len.values(), default=0)
    forced_advancing_chain = max(forced_len.values(), default=0)

    # Count zero vs advancing cross-lane hand-offs across all forward edges.
    all_zero_handoffs = 0
    all_advancing_handoffs = 0
    for e in forward_edges:
        u, v = step_map[e["from"]], step_map[e["to"]]
        if u.get("laneId") != v.get("laneId"):
            dx = float(v.get("x", 0.0)) - float(u.get("x", 0.0))
            if abs(dx) <= 0.51:
                all_zero_handoffs += 1
            elif dx > 0.51:
                all_advancing_handoffs += 1

    xs = {nid: float(step_map[nid].get("x", 0.0)) for nid in step_ids}
    min_x = min(xs.values())
    max_x = max(xs.values())
    node_w = profile["node_w"]
    length_px = max_x - min_x + node_w
    cols = length_px / profile["col_w"]

    # Critical-path DP: trace from min_x to max_x minimizing total unexplained slack.
    # State per node: (total_slack, -edge_count, prev_edge_info)
    dp_slack: Dict[str, float] = {}
    dp_edges: Dict[str, int] = {}
    dp_prev: Dict[str, Optional[Tuple[str, Dict[str, Any]]]] = {}

    for v in topo:
        # Option 0: start the path at v (incurs start offset x[v] - min_x as slack).
        best_slack = max(0.0, xs[v] - min_x)
        best_edges = 0
        best_prev: Optional[Tuple[str, Dict[str, Any]]] = None

        for e in incoming[v]:
            u = e["from"]
            dx = xs[v] - xs[u]
            if dx < -0.51:
                continue
            cross_lane = step_map[u].get("laneId") != step_map[v].get("laneId")
            lg = _label_gap(e.get("label"), profile, font_m)
            info = _classify_edge_step(max(0.0, dx), cross_lane, lg, profile)
            cand_slack = dp_slack[u] + info["other_slack_px"]
            cand_edges = dp_edges[u] + 1
            if (cand_slack < best_slack - 1e-6) or (
                abs(cand_slack - best_slack) <= 1e-6 and cand_edges > best_edges
            ):
                best_slack = cand_slack
                best_edges = cand_edges
                best_prev = (u, info)

        dp_slack[v] = best_slack
        dp_edges[v] = best_edges
        dp_prev[v] = best_prev

    # Pick the terminal node at max_x with minimum slack (tie-break: more edges).
    max_nodes = [nid for nid in step_ids if abs(xs[nid] - max_x) <= 0.51]
    end_node = min(max_nodes, key=lambda nid: (dp_slack[nid], -dp_edges[nid]))

    path_infos: List[Dict[str, Any]] = []
    cur = end_node
    while dp_prev[cur] is not None:
        prev_u, info = dp_prev[cur]  # type: ignore[misc]
        path_infos.append(info)
        cur = prev_u
    path_infos.reverse()
    start_offset_px = max(0.0, xs[cur] - min_x)

    full_col_count = sum(1 for i in path_infos if i["kind"] == "full_col")
    full_col_px = sum(i["base_px"] for i in path_infos if i["kind"] == "full_col")
    tight_count = sum(1 for i in path_infos if i["kind"] == "tight")
    tight_px = sum(i["base_px"] for i in path_infos if i["kind"] == "tight")
    zero_count = sum(1 for i in path_infos if i["kind"] == "zero" and i["cross_lane"])
    nonzero_handoff_count = sum(1 for i in path_infos if i["cross_lane"] and i["dx"] > 0.51)
    nonzero_handoff_px = sum(i["dx"] for i in path_infos if i["cross_lane"] and i["dx"] > 0.51)
    label_widening_count = sum(1 for i in path_infos if i["label_widening_px"] > 0.5)
    label_widening_px = sum(i["label_widening_px"] for i in path_infos)
    other_slack_px = start_offset_px + sum(i["other_slack_px"] for i in path_infos)
    if abs(other_slack_px) < 0.05:
        other_slack_px = 0.0

    attribution = {
        "cp_edges": len(path_infos),
        "node_w_px": round(node_w, 1),
        "full_col_count": full_col_count,
        "full_col_px": round(full_col_px, 1),
        "tight_count": tight_count,
        "tight_px": round(tight_px, 1),
        "zero_handoff_count": zero_count,
        "nonzero_handoff_count": nonzero_handoff_count,
        "nonzero_handoff_px": round(nonzero_handoff_px, 1),
        "label_widening_count": label_widening_count,
        "label_widening_px": round(label_widening_px, 1),
        "other_slack_px": round(other_slack_px, 1),
        "check_sum_px": round(
            node_w + full_col_px + tight_px + label_widening_px + other_slack_px, 1
        ),
    }

    return {
        "steps": len(steps),
        "longest_chain": longest_chain,
        "forced_advancing_chain": forced_advancing_chain,
        "all_zero_handoffs": all_zero_handoffs,
        "all_advancing_handoffs": all_advancing_handoffs,
        "length_px": round(length_px, 1),
        "cols": round(cols, 2),
        "attribution": attribution,
    }


def measure_one(
    path: Path,
    tokens: Dict[str, Any],
    font_m: Dict[str, float],
    timeout: int = DEFAULT_TIMEOUT,
) -> Dict[str, Any]:
    rel = str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path)
    data = load_diagram(path, timeout=timeout)
    non_conn = [n for n in data.get("nodes", []) if n.get("type") != "connector"]
    if not non_conn:
        return {
            "name": path.stem,
            "path": rel,
            "steps": 0,
            "lanes": len(data.get("lanes", [])),
            "direction": data.get("direction") or "LR",
            "longest_chain": 0,
            "forced_advancing_chain": 0,
            "all_zero_handoffs": 0,
            "all_advancing_handoffs": 0,
            "length_px": 0.0,
            "cols": 0.0,
            "fill_pct": 0.0,
            "crossings": 0,
            "defects": 0,
            "long_arrows": 0,
            "audit_score": 100,
            "layout_s": 0.0,
            "attribution": {},
        }

    if "direction" not in data:
        chosen_laid, _ = choose_flowchart_direction(data, timeout, None, tokens)
        direction = chosen_laid.get("direction") or "LR"
        layout_input = {**copy.deepcopy(data), "direction": direction}
    else:
        direction = data["direction"] or "LR"
        layout_input = copy.deepcopy(data)

    t0 = time.perf_counter()
    laid = run_layout("flowchart", layout_input, timeout=timeout, tokens=tokens)
    layout_s = time.perf_counter() - t0

    direction = laid.get("direction") or direction
    profile = PROFILES["TB" if direction == "TB" else "LR"]
    struct = _analyze_structure_and_critical_path(laid, profile, font_m)

    audit = make_audit(laid, tokens)
    report = audit.verify_collisions()

    lanes = len(laid.get("lanes", []))
    cols = struct["cols"]
    fill_pct = (struct["steps"] / (lanes * cols) * 100.0) if (lanes > 0 and cols > 0) else 0.0

    return {
        "name": path.stem,
        "path": rel,
        "steps": struct["steps"],
        "lanes": lanes,
        "direction": direction,
        "longest_chain": struct["longest_chain"],
        "forced_advancing_chain": struct["forced_advancing_chain"],
        "all_zero_handoffs": struct["all_zero_handoffs"],
        "all_advancing_handoffs": struct["all_advancing_handoffs"],
        "length_px": struct["length_px"],
        "cols": cols,
        "fill_pct": round(fill_pct, 1),
        "crossings": report["edge_crossings"],
        "defects": len(report["issues"]),
        "long_arrows": report["long_arrows_count"],
        "audit_score": report["score"],
        "layout_s": round(layout_s, 3),
        "attribution": struct["attribution"],
    }


def _collect_targets(args: argparse.Namespace) -> List[Path]:
    if args.paths:
        return [Path(p).resolve() for p in args.paths]
    targets: List[Path] = list(BENCHMARK_PATHS)
    if args.all:
        seen = {p.resolve() for p in targets}
        for p in sorted(FIXTURES_DIR.glob("*.json")):
            if p.name == "blank.json":
                continue
            rp = p.resolve()
            if rp not in seen:
                targets.append(rp)
                seen.add(rp)
    return targets


def _format_markdown(rows: Sequence[Dict[str, Any]]) -> str:
    lines: List[str] = []
    lines.append("## Flowchart Compaction Baseline")
    lines.append("")
    lines.append(
        "| Diagram | Steps | Lanes | Dir | Chain (DAG / forced) | Hand-offs (0 / >0) | Length (px) | Cols | Fill | Crossings | Defects | Long arrows | Score | Layout (s) |"
    )
    lines.append("|---|---:|---:|:---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for r in rows:
        chain_str = f"{r['longest_chain']} / {r['forced_advancing_chain']}"
        ho_str = f"{r['all_zero_handoffs']} / {r['all_advancing_handoffs']}"
        lines.append(
            f"| {r['name']} | {r['steps']} | {r['lanes']} | {r['direction']} | {chain_str} | {ho_str} "
            f"| {r['length_px']:.0f} | {r['cols']:.1f} | {r['fill_pct']:.0f}% | {r['crossings']} "
            f"| {r['defects']} | {r['long_arrows']} | {r['audit_score']} | {r['layout_s']:.2f} |"
        )

    lines.append("")
    lines.append("## Critical-Path Length Attribution")
    lines.append("")
    lines.append(
        "| Diagram | Dir | Length (px) | Node W | Full col (n / px) | Tight (n / px) | Label widen (n / px) | Other slack (px) | CP hand-offs (0 / >0: px) |"
    )
    lines.append("|---|:---:|---:|---:|---:|---:|---:|---:|---:|")
    for r in rows:
        a = r.get("attribution") or {}
        if not a:
            continue
        lines.append(
            f"| {r['name']} | {r['direction']} | {r['length_px']:.0f} | {a['node_w_px']:.0f} "
            f"| {a['full_col_count']} / {a['full_col_px']:.0f} "
            f"| {a['tight_count']} / {a['tight_px']:.0f} "
            f"| {a['label_widening_count']} / {a['label_widening_px']:.0f} "
            f"| {a['other_slack_px']:.0f} "
            f"| {a['zero_handoff_count']} / {a['nonzero_handoff_count']}: {a['nonzero_handoff_px']:.0f} |"
        )
    return "\n".join(lines)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Measure flowchart compaction metrics and critical-path attribution.")
    parser.add_argument("paths", nargs="*", help="Optional explicit diagram paths (.html, .json, .md, .mmd).")
    parser.add_argument("--benchmarks", action="store_true", help="Run the default benchmark set (default when no paths given).")
    parser.add_argument("--all", action="store_true", help="Include all dev/tests/fixtures/flowchart/*.json (excluding blank.json).")
    parser.add_argument("--json", action="store_true", dest="as_json", help="Emit machine-readable JSON.")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="Per-layout timeout in seconds.")
    args = parser.parse_args(argv)

    targets = _collect_targets(args)
    tokens = load_tokens()
    font_m = tokens_data(tokens)["font"]["metrics"]

    results: List[Dict[str, Any]] = []
    with layout_session():
        for path in targets:
            results.append(measure_one(path, tokens, font_m, timeout=args.timeout))

    if args.as_json:
        print(json.dumps(results, indent=2))
    else:
        print(_format_markdown(results))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
