"""Subprocess flows of a flowchart (plan: dev/plans/plan-subprocess.md): a parent flow plus child flows, one per `[["..."]]` step.

In memory a child is `data["children"][slug]` = {name, laneOrder, laneHeights, nodes, edges, notes}; `data["lanes"]` is the one list of
actors for every tab. Each tab is laid out on its own, as a plain flat flowchart (`flat_tab`), and merged back (`merge_tab`).
Standard library only.
"""

from __future__ import annotations

import copy
import re
from typing import Any, Dict, List, Optional, Tuple

STEP_LIMIT = 30  # steps per tab (starts, ends, connectors and notes excluded)
LANE_LIMIT = 6   # lanes per tab
RPST_LIMIT = 5   # candidates listed
MAX_FLOW_DEPTH = 4  # levels, 1 is the main flow (plan: dev/plans/plan-subprocess-depth.md); mirrors MMD_FLOW_MAX_DEPTH in mermaid.js

_NO_WORDS = re.compile(r"\b(not|no|fail|failed|reject|rejected|declin\w*|cancel\w*|denied|invalid|incomplete|unable|refused)\b", re.I)


def children(data: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return data.get("children") or {}


def parents(data: Dict[str, Any]) -> Dict[str, str]:
    """Child slug -> key of the flow holding its `[["..."]]` step ('' is the main flow); a slug with no such step is absent."""
    out: Dict[str, str] = {}
    kids = children(data)
    for key, nodes in [("", data.get("nodes") or [])] + [(k, c.get("nodes") or []) for k, c in kids.items()]:
        for n in nodes:
            if n.get("id") in kids and n["id"] != key:
                out.setdefault(n["id"], key)
    return out


def parent_of(data: Dict[str, Any], slug: str) -> Optional[str]:
    return parents(data).get(slug)


def depth_of(data: Dict[str, Any], key: str) -> int:
    """1 for the main flow (key ''), else 1 + the parent's depth; a flow with no parent step counts as a child of the main flow."""
    up, depth, seen = parents(data), 1, set()
    while key and key not in seen:
        seen.add(key)
        depth, key = depth + 1, up.get(key, "")
    return depth


def can_nest(data: Dict[str, Any], key: str) -> bool:
    return depth_of(data, key) < MAX_FLOW_DEPTH


def child_order(data: Dict[str, Any]) -> List[str]:
    """Child slugs depth first: each flow's children in the order of their steps in `nodes` (flow order on disk), then any
    whose parent step is missing."""
    kids, up = children(data), parents(data)
    order: List[str] = []

    def walk(key: str) -> None:
        for n in (data.get("nodes") if key == "" else kids[key].get("nodes")) or []:
            if n.get("id") in kids and up.get(n["id"]) == key and n["id"] not in order:
                order.append(n["id"])
                walk(n["id"])

    walk("")
    for k in kids:
        if k not in order:
            order.append(k)
            walk(k)
    return order


def is_step(n: Dict[str, Any]) -> bool:
    return n.get("type") not in ("start", "end", "connector")


def parent_lanes(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Lanes of the parent flow: with a parent step, or in no child's lane order or steps (mirrors mmdFlowParentLanes in mermaid.js)."""
    in_parent = {n.get("laneId") for n in data.get("nodes") or []}
    in_kids = {i for c in children(data).values() for i in (c.get("laneOrder") or []) + [n.get("laneId") for n in c.get("nodes") or []]}
    return [lane for lane in data.get("lanes") or [] if lane["id"] in in_parent or lane["id"] not in in_kids]


def child_lanes(data: Dict[str, Any], slug: str) -> List[Dict[str, Any]]:
    c = children(data)[slug]
    by_id = {lane["id"]: lane for lane in data.get("lanes") or []}
    order = [i for i in (c.get("laneOrder") or []) + [n.get("laneId") for n in c.get("nodes") or []] if i in by_id]
    return [by_id[i] for i in dict.fromkeys(order)]


def flat_tab(data: Dict[str, Any], slug: Optional[str] = None) -> Dict[str, Any]:
    """One tab as a plain flowchart: the parent (`slug` None) or a child, with only its lanes. A copy."""
    top = {k: v for k, v in data.items() if k not in ("children", "lanes", "nodes", "edges", "notes", "layout")}
    if slug is None:
        flat = {**top, "lanes": parent_lanes(data), "nodes": data.get("nodes") or [], "edges": data.get("edges") or [],
                "notes": data.get("notes") or []}
    else:
        c = children(data)[slug]
        heights = c.get("laneHeights") or {}
        lanes = [{**lane, **({"height": heights[lane["id"]]} if lane["id"] in heights else {})} for lane in child_lanes(data, slug)]
        for lane in lanes:
            if lane["id"] not in heights:
                lane.pop("height", None)
        flat = {**top, "lanes": lanes, "nodes": c.get("nodes") or [], "edges": c.get("edges") or [], "notes": c.get("notes") or []}
        flat.pop("title", None)
    if not flat["notes"]:
        flat.pop("notes")
    return copy.deepcopy(flat)


def merge_tab(data: Dict[str, Any], slug: Optional[str], laid: Dict[str, Any]) -> Dict[str, Any]:
    """`data` with the laid-out flat tab put back (the parent's lanes take the laid-out order and heights)."""
    if slug is None:
        shown = {lane["id"] for lane in laid["lanes"]}
        rest = [lane for lane in data.get("lanes") or [] if lane["id"] not in shown]
        out = {**data, "lanes": laid["lanes"] + rest, "nodes": laid["nodes"], "edges": laid["edges"]}
        out.update({"direction": laid["direction"]} if laid.get("direction") else {})
        if "notes" in laid or "notes" in out:
            out["notes"] = laid.get("notes", [])
        return out
    kid = {k: v for k, v in children(data)[slug].items() if k not in ("laneOrder", "laneHeights", "nodes", "edges", "notes")}
    kid.update(laneOrder=[lane["id"] for lane in laid["lanes"]],
               laneHeights={lane["id"]: lane["height"] for lane in laid["lanes"] if "height" in lane},
               nodes=laid["nodes"], edges=laid["edges"])
    if laid.get("notes"):
        kid["notes"] = laid["notes"]
    return {**data, "children": {**children(data), slug: kid}}


def tab_stats(nodes: List[Dict[str, Any]]) -> Tuple[int, int]:
    return sum(is_step(n) for n in nodes), len({n.get("laneId") for n in nodes if n.get("laneId")})


def _tabs(data: Dict[str, Any]) -> List[Tuple[Optional[str], str, List[Dict[str, Any]], List[Dict[str, Any]]]]:
    out = [(None, data.get("title") or "Parent flow", data.get("nodes") or [], data.get("edges") or [])]
    out += [(k, children(data)[k].get("name") or k, children(data)[k].get("nodes") or [], children(data)[k].get("edges") or [])
            for k in child_order(data)]
    return out


def host_view(data: Dict[str, Any], slug: str) -> Dict[str, Any]:
    """The flow holding the subprocess step `slug` (its nodes and edges) with that child, the shape `_ends_and_branches` reads."""
    up = parents(data).get(slug, "")
    host = data if up == "" else children(data)[up]
    return {"children": {slug: children(data)[slug]}, "nodes": host.get("nodes") or [], "edges": host.get("edges") or []}


def _ends_and_branches(data: Dict[str, Any], slug: str) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]], List[Dict[str, Any]]]:
    """(child end pills, the decision that follows the subprocess step or None, that decision's outgoing edges)."""
    c = children(data)[slug]
    ends = [n for n in c.get("nodes") or [] if n.get("type") == "end"]
    outs = [e for e in data.get("edges") or [] if e.get("from") == slug]
    by_id = {n["id"]: n for n in data.get("nodes") or []}
    d = by_id.get(outs[0]["to"]) if len(outs) == 1 else None
    if d is not None and d.get("type") == "decision":
        return ends, d, [e for e in data.get("edges") or [] if e.get("from") == d["id"]]
    return ends, None, outs


def checks(data: Dict[str, Any]) -> List[str]:
    """[WARN] lines for the limits and the parent-child contract (plan sections 1 and 4)."""
    warns: List[str] = []
    for slug, name, nodes, _ in _tabs(data):
        steps, lane_count = tab_stats(nodes)
        tab = f'"{name}"' if slug else "the parent flow"
        if steps > STEP_LIMIT:
            warns.append(f"Flow {tab} has {steps} steps (limit {STEP_LIMIT}): move a block that ends in a business outcome into a "
                         "subprocess (flowchart reference, rule 12)")
        if lane_count > LANE_LIMIT:
            warns.append(f"Flow {tab} has {lane_count} lanes (limit {LANE_LIMIT}): show a system that only stores data as a database "
                         "shape, merge actors with the same role, or move the block that needs the extra lanes into a subprocess")
    up = parents(data)
    for slug in child_order(data):
        c = children(data)[slug]
        name = c.get("name") or slug
        host = data if up.get(slug, "") == "" else children(data)[up[slug]]
        step = next((n for n in host.get("nodes") or [] if n.get("id") == slug), {})
        if slug not in up or step.get("type") != "subprocess":
            warns.append(f'sub_{slug} ("{name}") has no matching [["..."]] step with the id {slug} in its parent flow')
        if depth_of(data, slug) > MAX_FLOW_DEPTH:
            warns.append(f'Flow "{name}" is on level {depth_of(data, slug)} (limit {MAX_FLOW_DEPTH}): move it up or merge it into its parent')
        starts = [n for n in c.get("nodes") or [] if n.get("type") == "start"]
        if len(starts) != 1:
            warns.append(f'Child flow "{name}" has {len(starts)} start pills (exactly one is needed)')
        if slug in up:
            ends, decision, branches = _ends_and_branches(host_view(data, slug), slug)
            want = len(branches) if decision is not None else (1 if branches else None)
            # one end per branch of the decision after the step; one end when the parent just continues
            if want is not None and len(ends) != want:
                after = f'the branches of "{decision.get("label")}"' if decision is not None else "the step after it"
                warns.append(f'Child flow "{name}" has {len(ends)} end pills but {after} {"has" if decision is not None else "needs"} {want}: '
                             "one end per branch of a following decision, a single end when the parent just continues")
    return warns


def rpst_candidates(flat: Dict[str, Any]) -> List[str]:
    """Single-entry, single-exit regions of a flow (a refined process structure tree, in node form), largest first,
    as `[INFO]` text. A region runs from entry step `a` to exit step `b`: every arrow into it reaches `a`, every arrow out
    of it leaves from `b`."""
    nodes = {n["id"]: n for n in flat.get("nodes") or []}
    out: Dict[str, List[str]] = {i: [] for i in nodes}
    inc: Dict[str, List[str]] = {i: [] for i in nodes}
    for e in flat.get("edges") or []:
        if e.get("from") in nodes and e.get("to") in nodes and e["from"] != e["to"]:
            out[e["from"]].append(e["to"])
            inc[e["to"]].append(e["from"])
    total = sum(is_step(n) for n in nodes.values())
    found: List[Tuple[int, int, str, str, set]] = []
    for a in nodes:
        if nodes[a]["type"] in ("start", "end") or not inc[a]:
            continue
        for b in nodes:
            if b == a or nodes[b]["type"] in ("start", "end"):
                continue
            region, todo = {a}, [a]
            while todo:
                v = todo.pop()
                if v == b:
                    continue
                for w in out[v]:
                    if w not in region:
                        region.add(w)
                        todo.append(w)
            if b not in region:
                continue
            if any(p not in region for v in region if v != a for p in inc[v]):
                continue
            if any(w not in region for v in region if v != b for w in out[v]):
                continue
            if not any(p not in region for p in inc[a]) or not any(w not in region for w in out[b]):
                continue
            steps = sum(is_step(nodes[v]) for v in region)
            if 3 <= steps <= STEP_LIMIT and steps < total:
                found.append((steps, len({nodes[v].get("laneId") for v in region}), a, b, region))
    found.sort(key=lambda r: (-r[0], r[2], r[3]))
    lines, taken = [], set()
    for steps, lane_count, a, b, region in found:
        if region & taken:
            continue
        taken |= region
        lines.append(f"[INFO] Subprocess candidate: {a}..{b} ({steps} steps, {lane_count} lanes)")
        if len(lines) == RPST_LIMIT:
            break
    return lines


def outline(data: Dict[str, Any], only: Optional[str] = None) -> List[str]:
    """The `%%` header of --extract: totals, then one line per subprocess."""
    nodes_of = {n["id"]: n for n in data.get("nodes") or []}
    lines = []
    for slug in child_order(data):
        if only and slug != only:
            continue
        c = children(data)[slug]
        steps, lane_count = tab_stats(c.get("nodes") or [])
        ends = [n.get("label", "") for n in c.get("nodes") or [] if n.get("type") == "end"]
        label = nodes_of.get(slug, {}).get("label") or c.get("name") or slug
        lines.append(f"%% {'  ' * (depth_of(data, slug) - 2)}{slug} [[{label}]] -> sub_{slug}: {steps} steps, {lane_count} lanes, ends {' | '.join(ends) or 'none'}")
    if only:
        return lines
    every = [n for _, _, ns, _ in _tabs(data) for n in ns]
    head = f"%% {data.get('title') or 'Diagram'}: {sum(is_step(n) for n in every)} steps, {len(data.get('lanes') or [])} lanes, {len(lines)} subprocess{"" if len(lines) == 1 else "es"}"
    return [head] + lines


def _end_to_branch(ends: List[Dict[str, Any]], branches: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Map each child end id to a branch edge of the decision after the subprocess: by equal label, else Yes/No by wording
    (an end that says not, fail, reject, decline... is the No), else by position."""
    lab = lambda s: str(s or "").strip().lower()  # noqa: E731
    left = list(branches)
    out: Dict[str, Dict[str, Any]] = {}
    for end in ends:
        hit = next((b for b in left if lab(b.get("label")) == lab(end.get("label"))), None)
        if hit:
            out[end["id"]] = hit
            left.remove(hit)
    for end in [e for e in ends if e["id"] not in out]:  # a branch word inside the end's name: "Approved" in "Specification Approved"
        hit = next((b for b in left if lab(b.get("label")) and lab(b["label"]) in lab(end.get("label"))), None)
        if hit:
            out[end["id"]] = hit
            left.remove(hit)
    rest = [e for e in ends if e["id"] not in out]
    yes_no = {lab(b.get("label")): b for b in left}
    if len(rest) == 2 and set(yes_no) == {"yes", "no"}:
        neg = [e for e in rest if _NO_WORDS.search(str(e.get("label") or ""))]
        if len(neg) != 1:
            neg = [rest[1]]
        pos = next(e for e in rest if e is not neg[0])
        out[neg[0]["id"]], out[pos["id"]] = yes_no["no"], yes_no["yes"]
    else:
        out.update({e["id"]: b for e, b in zip(rest, left)})
    return out


def flatten(data: Dict[str, Any]) -> Dict[str, Any]:
    """One flow with every subprocess expanded in place: the subprocess step and the child's start pill disappear, the arrows into
    the step go to the child's first steps, and the child's ends are wired to the parent branches they stand for (the decision
    after the step goes too, the child already decided). A copy without `children`."""
    d = copy.deepcopy(data)
    kids = d.pop("children", None) or {}
    count = [0]

    def new_id() -> str:
        used = {e["id"] for t in [d, *kids.values()] for e in t.get("edges") or []}
        while True:
            count[0] += 1
            if f"e{count[0]}" not in used:
                return f"e{count[0]}"

    up = parents(data)
    for slug in sorted(child_order(data), key=lambda s: -depth_of(data, s)):  # deepest first: a child is whole before its parent takes it in
        c = kids[slug]
        host = d if up.get(slug, "") == "" else kids[up[slug]]
        p = next((n for n in host["nodes"] if n["id"] == slug and n.get("type") == "subprocess"), None)
        starts = [n for n in c.get("nodes") or [] if n.get("type") == "start"]
        if p is None or len(starts) != 1:
            continue
        sub = {"children": {slug: c}, "nodes": host["nodes"], "edges": host["edges"]}
        ends, decision, branches = _ends_and_branches(sub, slug)
        if decision is not None and (len(ends) != len(branches) or any(e["to"] == decision["id"] and e["from"] != slug for e in host["edges"])):
            decision = None
        outs = [e for e in host["edges"] if e["from"] == slug]
        drop, new_edges = {slug, starts[0]["id"]}, []
        kid_edges = list(c.get("edges") or [])
        first = [e for e in kid_edges if e["from"] == starts[0]["id"]]
        for ie in [e for e in host["edges"] if e["to"] == slug]:
            for s in first:
                new_edges.append({"id": new_id(), "from": ie["from"], "to": s["to"], "label": ie.get("label") or s.get("label") or "",
                                  **({"feedback": True} if ie.get("feedback") else {})})
        if outs:
            if decision is not None:
                mapping = _end_to_branch(ends, branches)
                targets = {e["id"]: [mapping[e["id"]]] for e in ends if e["id"] in mapping}
                drop.add(decision["id"])
                drop_edges = {e["id"] for e in branches}
            else:
                targets = {e["id"]: outs for e in ends}
                drop_edges = set()
            for end in ends:
                drop.add(end["id"])
                for ie in [e for e in kid_edges if e["to"] == end["id"]]:
                    for tgt in targets.get(end["id"], []):
                        new_edges.append({"id": new_id(), "from": ie["from"], "to": tgt["to"], "label": ie.get("label") or tgt.get("label") or "",
                                          **({"feedback": True} if ie.get("feedback") else {})})
            kid_edges = [e for e in kid_edges if e["to"] not in {x["id"] for x in ends}]
        else:
            drop_edges = set()
        kid_edges = [e for e in kid_edges if e["from"] != starts[0]["id"]]
        host["edges"] = [e for e in host["edges"] if e["from"] not in drop and e["to"] not in drop and e["id"] not in drop_edges] + kid_edges + new_edges
        host["nodes"] = [n for n in host["nodes"] if n["id"] not in drop] + [n for n in c.get("nodes") or [] if n["id"] not in drop]
        relink = first[0]["to"] if first else None
        notes = host.get("notes") or []
        for note in notes + (c.get("notes") or []):
            note["nodes"] = [relink if i == slug else i for i in note.get("nodes") or [] if i not in drop or i == slug]
        host["notes"] = [n for n in notes + (c.get("notes") or []) if n["nodes"]]
        if not host["notes"]:
            host.pop("notes")
    return d
