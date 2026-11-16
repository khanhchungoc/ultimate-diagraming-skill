"""Audit for use case diagrams (diagramType "usecase"): structure, geometry and complexity budget.

Checks the laid-out JSON only (actor and use case boxes, subject boxes, line routes and label boxes written by
assets/types/usecase/engine.js; see the Engine contract in dev/plans/plan-usecase.md), so it needs no browser and never
computes a layout. A use case is the ellipse inscribed in its box `x, y, w, h`; a link route `points` has two points
(a straight line) or three (a quadratic curve whose middle point is the control point). The audit reads no text widths.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Set, Tuple

from disk_format import color_kind, color_slot, palette_slots, slot_key

LINK_TYPES = ("association", "include", "extend")
ACTOR_KINDS = ("human", "system", "time")
SIDES = ("left", "right")
LEVELS = ("summary", "user", "subfunction")

# Budgets (characters). Over a budget is a warning: the page truncates the text.
MAX_ACTOR = 24
MAX_USE_CASE = 40
MAX_CONDITION = 40
MAX_REF = 12
MAX_NOTE = 120
COLOR_MIN_USE_CASES = 12   # more use cases than this and none coloured: suggest colouring by feature area
CHAIN_WARN_HOPS = 3        # a chain of this many include hops or more reads as a flow
ERROR_PENALTY = 12
CURVE_STEPS = 16
INSIDE = 0.98              # a point is inside an ellipse when its normalised distance is under this (tolerates rounding)

# Simple English check for "verb + object" names (info only). A name whose first word is not here gets an [INFO].
VERBS = frozenset("""accept activate add allow answer apply approve archive ask assign assess authenticate authorise authorize
back block book borrow browse bill buy calculate cancel capture change charge check choose claim clear close collect compare
complete configure confirm contact convert count create deactivate delete deliver deposit dispatch download edit enable enter
escalate evaluate export extend attach file find fulfil fulfill generate handle import invite invoice issue join leave link list load lock
log look maintain make manage mark match merge monitor move notify offer open order pack pause pay pick place plan post
prepare print process publish purchase query quote rate receive reconcile record redeem refund register reject release remove
renew rent replace report request reserve reset resolve restore resume retire retrieve return review revoke route run save scan
schedule search select sell send set settle share ship show sign sort split start stop store submit subscribe suspend sync take
tag terminate test top track transfer trigger unlock unsubscribe update upload use validate verify view vote watch withdraw
write""".split())

Box = Dict[str, float]


def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _is_box(b: Any) -> bool:
    return isinstance(b, dict) and all(_num(b.get(k)) for k in ("x", "y", "w", "h"))


def _has_box(o: Dict[str, Any]) -> bool:
    return _is_box(o)


def _rects_overlap(a: Box, b: Box) -> bool:
    """True when the rectangles overlap (touching edges do not)."""
    return (a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"]
            and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"])


def _contains(outer: Box, inner: Box, tol: float = 0.5) -> bool:
    return (inner["x"] >= outer["x"] - tol and inner["y"] >= outer["y"] - tol
            and inner["x"] + inner["w"] <= outer["x"] + outer["w"] + tol
            and inner["y"] + inner["h"] <= outer["y"] + outer["h"] + tol)


def _unit(e: Box, p: Tuple[float, float]) -> Tuple[float, float]:
    """`p` in the ellipse's own space, where the ellipse is the unit circle."""
    a, b = max(e["w"] / 2, 1e-9), max(e["h"] / 2, 1e-9)
    return (p[0] - (e["x"] + e["w"] / 2)) / a, (p[1] - (e["y"] + e["h"] / 2)) / b


def _ellipses_overlap(a: Box, b: Box) -> bool:
    """Boundary points of one ellipse inside the other (two overlapping or nested ellipses always have some)."""
    for e, f in ((a, b), (b, a)):
        cx, cy, rx, ry = e["x"] + e["w"] / 2, e["y"] + e["h"] / 2, e["w"] / 2, e["h"] / 2
        for k in range(72):
            t = 2 * math.pi * k / 72
            u, v = _unit(f, (cx + rx * math.cos(t), cy + ry * math.sin(t)))
            if u * u + v * v < INSIDE * INSIDE:
                return True
    return False


def _rect_hits_ellipse(r: Box, e: Box) -> bool:
    """A rectangle that covers part of the ellipse's interior (clamp the centre into the rectangle in ellipse space)."""
    lo = _unit(e, (r["x"], r["y"]))
    hi = _unit(e, (r["x"] + r["w"], r["y"] + r["h"]))
    u, v = min(max(0.0, lo[0]), hi[0]), min(max(0.0, lo[1]), hi[1])
    return u * u + v * v < INSIDE * INSIDE


def _segment_hits_ellipse(p: List[float], q: List[float], e: Box) -> bool:
    """A segment that passes through the interior of the ellipse (distance from the unit circle's centre)."""
    (u0, v0), (u1, v1) = _unit(e, (p[0], p[1])), _unit(e, (q[0], q[1]))
    du, dv = u1 - u0, v1 - v0
    d2 = du * du + dv * dv
    t = 0.0 if d2 == 0 else min(1.0, max(0.0, -(u0 * du + v0 * dv) / d2))
    return math.hypot(u0 + t * du, v0 + t * dv) < INSIDE


def _segment_hits_rect(p: List[float], q: List[float], box: Box) -> bool:
    """A segment that passes through the interior of `box` (Liang-Barsky clip)."""
    t0, t1 = 0.0, 1.0
    for d, lo, hi, a in ((q[0] - p[0], box["x"], box["x"] + box["w"], p[0]), (q[1] - p[1], box["y"], box["y"] + box["h"], p[1])):
        if d == 0:
            if a <= lo or a >= hi:
                return False
            continue
        ta, tb = sorted(((lo - a) / d, (hi - a) / d))
        t0, t1 = max(t0, ta), min(t1, tb)
        if t0 >= t1:
            return False
    return True


def _polyline(points: List[List[float]]) -> List[List[float]]:
    """The route as straight pieces: two points as is, three points sampled as a quadratic curve."""
    if len(points) != 3:
        return points
    (x0, y0), (cx, cy), (x1, y1) = points
    out = []
    for k in range(CURVE_STEPS + 1):
        t = k / CURVE_STEPS
        s = 1 - t
        out.append([s * s * x0 + 2 * s * t * cx + t * t * x1, s * s * y0 + 2 * s * t * cy + t * t * y1])
    return out


def _cycle(edges: Dict[Any, List[Any]]) -> Optional[List[Any]]:
    """One cycle of the directed graph as a list of ids, or None."""
    state: Dict[Any, int] = {}
    stack: List[Any] = []

    def visit(n: Any) -> Optional[List[Any]]:
        state[n] = 1
        stack.append(n)
        for m in edges.get(n, []):
            if state.get(m) == 1:
                return stack[stack.index(m):] + [m]
            if state.get(m) is None:
                found = visit(m)
                if found:
                    return found
        stack.pop()
        state[n] = 2
        return None

    for n in list(edges):
        if state.get(n) is None:
            found = visit(n)
            if found:
                return found
    return None


class UsecaseAudit:
    title = "Use Case Diagram"

    def __init__(self, data: Dict[str, Any]):
        self.data = data
        self.actors: List[Dict[str, Any]] = data.get("actors") or []
        self.use_cases: List[Dict[str, Any]] = data.get("useCases") or []
        self.links: List[Dict[str, Any]] = data.get("links") or []
        self.notes: List[Dict[str, Any]] = data.get("notes") or []
        self.subjects: List[Dict[str, Any]] = data.get("subjects") or []

    def pass_line(self, report: Dict[str, Any]) -> str:
        return f"[PASS] Quality Score: {report['score']}/100 ({report['grade']}). No overlap, line or label-fit problems."

    # --- audit ---------------------------------------------------------------------------------------------------

    def verify_collisions(self) -> Dict[str, Any]:
        errors: List[str] = []
        budget: List[str] = []
        info: List[str] = []
        acs, ucs, ls, ns, ss = self.actors, self.use_cases, self.links, self.notes, self.subjects
        amap = {a.get("id"): a for a in acs}
        umap = {u.get("id"): u for u in ucs}
        smap = {s.get("id"): s for s in ss}
        dangling = 0

        for flag in ("showRefs", "showNotes"):
            if flag in self.data and not isinstance(self.data[flag], bool):
                errors.append(f"'{flag}' must be true or false.")

        # Structure: unique ids (actors, use cases and subjects share one namespace, as links reference both).
        seen: Set[Any] = set()
        for label, items in (("actor", acs), ("use case", ucs), ("subject", ss)):
            for item in items:
                if item.get("id") in seen:
                    errors.append(f"Duplicate {label} id '{item.get('id')}'.")
                seen.add(item.get("id"))
        for label, items in (("link", ls), ("note", ns)):
            seen = set()
            for item in items:
                if item.get("id") in seen:
                    errors.append(f"Duplicate {label} id '{item.get('id')}'.")
                seen.add(item.get("id"))
        for s in ss:
            if not str(s.get("name") or "").strip():
                errors.append(f"Subject '{s.get('id')}' has no name.")
        for a in acs:
            aid = a.get("id")
            if not str(a.get("name") or "").strip():
                errors.append(f"Actor '{aid}' has no name.")
            if a.get("kind") is not None and a["kind"] not in ACTOR_KINDS:
                errors.append(f"Actor '{aid}' has unknown kind '{a['kind']}' (use {', '.join(ACTOR_KINDS)}).")
            if a.get("side") is not None and a["side"] not in SIDES:
                errors.append(f"Actor '{aid}' has unknown side '{a['side']}' (use left or right).")
            if "abstract" in a and not isinstance(a["abstract"], bool):
                errors.append(f"Actor '{aid}': 'abstract' must be true or false.")
            if a.get("parent") is not None and a["parent"] not in amap:
                dangling += 1
                errors.append(f"Actor '{aid}' parent unknown actor '{a['parent']}'.")
        for u in ucs:
            uid = u.get("id")
            if not str(u.get("name") or "").strip():
                errors.append(f"Use case '{uid}' has no name.")
            if u.get("level") is not None and u["level"] not in LEVELS:
                errors.append(f"Use case '{uid}' has unknown level '{u['level']}' (use {', '.join(LEVELS)}).")
            if "abstract" in u and not isinstance(u["abstract"], bool):
                errors.append(f"Use case '{uid}': 'abstract' must be true or false.")
            if u.get("subject") is not None and u["subject"] not in smap:
                dangling += 1
                errors.append(f"Use case '{uid}' subject unknown subject '{u['subject']}'.")
            elif u.get("subject") is None and len(ss) > 1:
                errors.append(f"Use case '{uid}' has no 'subject': with {len(ss)} subjects every use case names its subject.")
            if u.get("parent") is not None and u["parent"] not in umap:
                dangling += 1
                errors.append(f"Use case '{uid}' parent unknown use case '{u['parent']}'.")
            for key in ("extensionPoints", "refs"):
                if key in u and not (isinstance(u[key], list) and all(isinstance(x, str) for x in u[key])):
                    errors.append(f"Use case '{uid}': '{key}' must be a list of strings.")
        for o in acs + ucs:
            if o.get("color") is not None and color_kind(o["color"]) == "bad":
                errors.append(f"'{o.get('id')}' has unknown color '{o['color']}' (use a palette slot: {', '.join(palette_slots()[:-1])}).")

        for lk in ls:
            lid, kind = lk.get("id"), lk.get("type")
            if kind not in LINK_TYPES:
                errors.append(f"Link '{lid}' has unknown type '{kind}' (use {', '.join(LINK_TYPES)}).")
            ok = True
            for end in ("from", "to"):
                if lk.get(end) not in amap and lk.get(end) not in umap:
                    dangling += 1
                    ok = False
                    errors.append(f"Link '{lid}' {end} unknown id '{lk.get(end)}'.")
            if ok and kind == "association":
                if (lk["from"] in amap) == (lk["to"] in amap):
                    errors.append(f"Link '{lid}' is an association but not between an actor and a use case.")
            elif ok and kind in ("include", "extend"):
                if lk["from"] not in umap or lk["to"] not in umap:
                    errors.append(f"Link '{lid}' is an {kind} but not between two use cases.")
            if kind == "extend" and ok and lk["to"] in umap and lk.get("extensionPoint") is not None:
                if lk["extensionPoint"] not in (umap[lk["to"]].get("extensionPoints") or []):
                    errors.append(f"Link '{lid}' extensionPoint '{lk['extensionPoint']}' is not an extension point of '{lk['to']}'.")
            if "navigable" in lk and not isinstance(lk["navigable"], bool):
                errors.append(f"Link '{lid}': 'navigable' must be true or false.")
        for n in ns:
            if not str(n.get("text") or "").strip():
                errors.append(f"Note '{n.get('id')}' has no text.")
            for key, known in (("useCases", umap), ("actors", amap)):
                for i in n.get(key) or []:
                    if i not in known:
                        dangling += 1
                        errors.append(f"Note '{n.get('id')}' is attached to unknown {'use case' if key == 'useCases' else 'actor'} '{i}'.")

        # Cycles: include, and the parent chains.
        inc: Dict[Any, List[Any]] = {}
        for lk in ls:
            if lk.get("type") == "include" and lk.get("from") in umap and lk.get("to") in umap:
                inc.setdefault(lk["from"], []).append(lk["to"])
        cyc = _cycle(inc)
        if cyc:
            errors.append(f"include cycle: {' -> '.join(map(str, cyc))}.")
        for label, items, known in (("actor", acs, amap), ("use case", ucs, umap)):
            par = {o.get("id"): [o["parent"]] for o in items if o.get("parent") in known}
            cyc = _cycle(par)
            if cyc:
                errors.append(f"parent cycle ({label}): {' -> '.join(map(str, cyc))}.")

        # Geometry (only meaningful once laid out). A use case in a collapsed subject has no box (_hidden).
        drawn_ucs = [u for u in ucs if not u.get("_hidden")]
        subj_boxes = ss if ss else (self.data.get("_subjects") or [])
        laid_out = (all(_has_box(a) for a in acs) and all(_has_box(u) for u in drawn_ucs)
                    and all(isinstance(lk.get("points"), list) and len(lk["points"]) >= 2 for lk in ls)
                    and all(_is_box(s) for s in subj_boxes))
        overlaps = overflows = 0
        if (acs or ucs) and not laid_out:
            errors.append("Diagram is not laid out (actors, use cases and subjects need x, y, w, h, links need points): run --layout.")
        elif laid_out:
            canvas = self.data.get("canvas") or {}
            width, height = canvas.get("width", math.inf), canvas.get("height", math.inf)
            items: List[Tuple[str, Dict[str, Any]]] = [("Actor", a) for a in acs] + [("Use case", u) for u in drawn_ucs] \
                + [("Subject", s) for s in subj_boxes]
            for label, o in items:
                if o["x"] < 0 or o["y"] < 0 or o["x"] + o["w"] > width or o["y"] + o["h"] > height:
                    overflows += 1
                    errors.append(f"{label} '{o.get('id')}' extends past the diagram edge.")
            for i, a in enumerate(drawn_ucs):
                for b in drawn_ucs[i + 1:]:
                    if _ellipses_overlap(a, b):
                        overlaps += 1
                        errors.append(f"Use cases '{a.get('id')}' and '{b.get('id')}' overlap.")
            for i, a in enumerate(acs):
                for b in acs[i + 1:]:
                    if _rects_overlap(a, b):
                        overlaps += 1
                        errors.append(f"Actors '{a.get('id')}' and '{b.get('id')}' overlap.")
                for u in drawn_ucs:
                    if _rect_hits_ellipse(a, u):
                        overlaps += 1
                        errors.append(f"Actor '{a.get('id')}' overlaps use case '{u.get('id')}'.")
            for i, a in enumerate(subj_boxes):
                for b in subj_boxes[i + 1:]:
                    if _rects_overlap(a, b):
                        overlaps += 1
                        errors.append(f"Subjects '{a.get('id')}' and '{b.get('id')}' overlap.")
            for a in acs:
                for s in subj_boxes:
                    if _rects_overlap(a, s):
                        overlaps += 1
                        errors.append(f"Actor '{a.get('id')}' sits inside subject '{s.get('id')}': actors stay outside the boundary.")
            for u in drawn_ucs:
                home = smap.get(u.get("subject")) if u.get("subject") else (subj_boxes[0] if len(subj_boxes) == 1 else None)
                if home is not None and _is_box(home) and not _contains(home, u):
                    errors.append(f"Use case '{u.get('id')}' is not inside its subject '{home.get('id')}'.")
            routes: List[Tuple[str, Set[Any], List[List[float]]]] = []
            for lk in ls:
                if any(not (isinstance(p, (list, tuple)) and len(p) == 2 and _num(p[0]) and _num(p[1])) for p in lk["points"]):
                    errors.append(f"Link '{lk.get('id')}' has a malformed route.")
                    continue
                routes.append((f"Link '{lk.get('id')}'", {lk.get("from"), lk.get("to")}, _polyline(lk["points"])))
                if lk.get("labelBox") is not None and not _is_box(lk["labelBox"]):
                    errors.append(f"Link '{lk.get('id')}' has a malformed labelBox.")
            for pl in self.data.get("_parents") or []:
                pts = pl.get("points")
                if isinstance(pts, list) and len(pts) >= 2 and all(isinstance(p, (list, tuple)) and len(p) == 2 for p in pts):
                    routes.append((f"Generalization '{pl.get('from')}' to '{pl.get('to')}'", {pl.get("from"), pl.get("to")}, _polyline(pts)))
            for what, ends, pts in routes:
                for u in drawn_ucs:
                    if u.get("id") not in ends and any(_segment_hits_ellipse(p, q, u) for p, q in zip(pts, pts[1:])):
                        errors.append(f"{what} passes through use case '{u.get('id')}'.")
                for a in acs:
                    if a.get("id") not in ends and any(_segment_hits_rect(p, q, a) for p, q in zip(pts, pts[1:])):
                        errors.append(f"{what} passes through actor '{a.get('id')}'.")
            labelled = [lk for lk in ls if _is_box(lk.get("labelBox"))]
            for i, a in enumerate(labelled):
                for b in labelled[i + 1:]:
                    if _rects_overlap(a["labelBox"], b["labelBox"]):
                        overlaps += 1
                        errors.append(f"Labels of links '{a.get('id')}' and '{b.get('id')}' overlap.")
                for u in drawn_ucs:
                    if _rect_hits_ellipse(a["labelBox"], u):
                        overlaps += 1
                        errors.append(f"Label of link '{a.get('id')}' sits over use case '{u.get('id')}'.")
                for ac in acs:
                    if _rects_overlap(a["labelBox"], ac):
                        overlaps += 1
                        errors.append(f"Label of link '{a.get('id')}' sits over actor '{ac.get('id')}'.")

        # Warnings (never change the score).
        assoc: Dict[Any, List[Any]] = {}   # actor id -> use case ids
        for lk in ls:
            if lk.get("type") == "association":
                a, u = (lk.get("from"), lk.get("to")) if lk.get("from") in amap else (lk.get("to"), lk.get("from"))
                if a in amap and u in umap:
                    assoc.setdefault(a, []).append(u)

        def ancestors(o: Dict[str, Any], known: Dict[Any, Dict[str, Any]]) -> List[Any]:
            out, cur = [], o
            while cur.get("parent") in known and cur["parent"] not in out and len(out) < 50:
                out.append(cur["parent"])
                cur = known[cur["parent"]]
            return out

        for a in acs:
            if a.get("abstract") is True:
                continue
            if not assoc.get(a.get("id")) and not any(assoc.get(p) for p in ancestors(a, amap)):
                budget.append(f"Actor '{a.get('id')}' has no association: connect it to a use case it takes part in, or drop it.")
        # A use case is reached through a direct association, or through include, extend or generalization to one that is.
        reached: Set[Any] = {u for us in assoc.values() for u in us}
        near: Dict[Any, Set[Any]] = {}
        for lk in ls:
            if lk.get("type") in ("include", "extend") and lk.get("from") in umap and lk.get("to") in umap:
                near.setdefault(lk["from"], set()).add(lk["to"])
                near.setdefault(lk["to"], set()).add(lk["from"])
        for u in ucs:
            if u.get("parent") in umap:
                near.setdefault(u["id"], set()).add(u["parent"])
                near.setdefault(u["parent"], set()).add(u["id"])
        todo = list(reached)
        while todo:
            for m in near.get(todo.pop(), ()):
                if m not in reached:
                    reached.add(m)
                    todo.append(m)
        for u in ucs:
            if u.get("id") not in reached:
                budget.append(f"Use case '{u.get('id')}' is not reached by any actor: associate an actor, or include, extend or generalize it from a use case an actor reaches.")
        # A chain of include hops is a flow.
        if not inc or not _cycle(inc):
            memo: Dict[Any, List[Any]] = {}

            def longest(n: Any) -> List[Any]:
                if n not in memo:
                    memo[n] = [n] + max((longest(m) for m in inc.get(n, [])), key=len, default=[])
                return memo[n]

            best = max((longest(n) for n in inc), key=len, default=[])
            if len(best) - 1 >= CHAIN_WARN_HOPS:
                budget.append(f"include chain {' -> '.join(map(str, best))} is {len(best) - 1} hops: this is a flow, use a flowchart "
                              "(or fold the steps into one use case).")
        for a in acs:
            if len(str(a.get("name") or "")) > MAX_ACTOR:
                budget.append(f"Actor name '{a.get('name')}' is over {MAX_ACTOR} characters and will be truncated.")
        for u in ucs:
            if len(str(u.get("name") or "")) > MAX_USE_CASE:
                budget.append(f"Use case name '{u.get('name')}' is over {MAX_USE_CASE} characters and will be truncated.")
            for ref in u.get("refs") or []:
                if len(str(ref)) > MAX_REF:
                    budget.append(f"Ref '{ref}' of use case '{u.get('id')}' is over {MAX_REF} characters and will be truncated.")
        for lk in ls:
            if len(str(lk.get("condition") or "")) > MAX_CONDITION:
                budget.append(f"Condition of link '{lk.get('id')}' is over {MAX_CONDITION} characters and will be truncated.")
        for n in ns:
            if len(str(n.get("text") or "")) > MAX_NOTE:
                budget.append(f"Note '{n.get('id')}' is over {MAX_NOTE} characters: shorten it.")
        coloured = [o for o in acs + ucs if o.get("color")]
        if coloured:
            key = slot_key(self.data.get("colorKey")) if isinstance(self.data.get("colorKey"), dict) else {}
            for c in dict.fromkeys(color_slot(o["color"]) for o in coloured if color_kind(o.get("color")) != "bad"):
                if color_kind(c) == "custom":
                    budget.append(f"Colour {c} is not a palette slot, so its contrast is not checked: use a slot ({', '.join(palette_slots()[:-1])}).")
                if not str(key.get(c) or "").strip():
                    budget.append(f"Use cases use {c} but 'colorKey' does not say what it means: add \"colorKey\": {{\"{c}\": \"Payments\"}}.")
        elif len(ucs) > COLOR_MIN_USE_CASES:
            budget.append(f"{len(ucs)} use cases and none has a 'color': colour-code them by feature area (one swatch per area) and name each in 'colorKey'.")

        # Info lines.
        included_by: Dict[Any, List[Any]] = {}
        for lk in ls:
            if lk.get("type") == "include" and lk.get("from") in umap and lk.get("to") in umap:
                included_by.setdefault(lk["to"], []).append(lk["from"])
        direct = {u for us in assoc.values() for u in us}
        for part, bases in included_by.items():
            if len(set(bases)) == 1 and part not in direct:
                info.append(f"Use case '{part}' is included only by '{bases[0]}': it is just a step, so fold it into '{bases[0]}' "
                            "unless another use case will share it.")
        for u in ucs:
            words = str(u.get("name") or "").split()
            if words and words[0].lower().strip(".,:;") not in VERBS:
                info.append(f"Use case '{u.get('id')}' name '{u.get('name')}' does not start with a verb: name goals verb + object.")

        score = max(0, 100 - ERROR_PENALTY * len(errors))
        grade = "A+" if score >= 98 else "A" if score >= 90 else "B" if score >= 80 else "C" if score >= 60 else "F"
        return {
            "passed": score >= 90 and not errors, "score": score, "grade": grade, "issues": errors,
            "actor_count": len(acs), "use_case_count": len(ucs), "link_count": len(ls), "note_count": len(ns),
            "subject_count": len(ss), "overlaps_count": overlaps, "overflows_count": overflows, "dangling_count": dangling,
            "info": info, "budget_warnings": budget,
        }

    def summary_lines(self, report: Dict[str, Any]) -> List[str]:
        lines = [
            f"Structure: {report['actor_count']} Actors | {report['use_case_count']} Use cases | {report['link_count']} Links | "
            f"{report['note_count']} Notes | {report['subject_count']} Subjects",
            f"Diagram Quality Score: {report['score']}/100  [GRADE: {report['grade']}]",
            "-" * 70,
            f"✓ Spacing and Label Fit:         {report['overlaps_count']} problems",
            f"✓ Diagram Bounds:                {report['overflows_count']} problems",
            f"✓ Reference Integrity:           {report['dangling_count']} dangling references",
        ]
        lines.extend(f"[INFO] {line}" for line in report.get("info", []))
        return lines
