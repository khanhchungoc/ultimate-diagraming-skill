"""Audit for ER diagrams (diagramType "erd"): structure, geometry and complexity budget.

Checks the laid-out JSON only (entity and group boxes, relationship routes and label boxes written by
assets/types/erd/engine.js), so it needs no browser and never computes a layout. Constants mirror the `ER` block in
assets/types/erd/engine.js (HEAD_H, ROW_H, MORE_H, CHAR_W, ...); keep them in sync.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

HEAD_H, ROW_H, MORE_H = 36, 26, 22
CHAR_W, TYPE_CHAR_W = 7.4, 6.6
PAD_X, GLYPH_W, TYPE_GAP = 12, 22, 16
MIN_W, MAX_W = 168, 360
RANK_GAP, LABEL_PAD, STACK_GAP = 112, 32, 40
BAND_HEAD, BAND_PAD, BAND_MIN = 48, 28, 140
MARGIN, STUB, CHANNEL_STEP, OBSTACLE_PAD, GRID = 40, 20, 8, 12, 4

END_KINDS = {"one", "zeroOrOne", "oneOrMany", "zeroOrMany"}
MANY_ENDS = {"oneOrMany", "zeroOrMany"}
DETAILS = {"all", "keys", "names"}
DIRECTIONS = {"LR", "TB"}
# Same lane swatches as the sequence audit and assets/shell/shell.js (SWATCHES): the hex values
SWATCHES = ("#e0f2fe", "#fef3c7", "#dcfce7", "#fee2e2", "#f3e8ff", "#ffedd5", "#ccfbf1", "#e0e7ff")

# Budgets (characters). Over a budget is a warning: the page truncates the text.
MAX_TABLE_NAME = 28
MAX_COLUMN_NAME = 28
MAX_TYPE = 16
MAX_LABEL = 20
MAX_NOTE = 120
MAX_COLUMNS_ALL = 25     # more columns than this at detail "all": suggest "keys"
MAX_PER_BAND_RANK = 12   # more tables than this in one band at one rank: suggest another area
ERROR_PENALTY = 12

Box = Dict[str, float]


def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _is_box(b: Any) -> bool:
    return isinstance(b, dict) and all(_num(b.get(k)) for k in ("x", "y", "w", "h"))


def _inside(a: Box, b: Box, pad: float = 0) -> bool:
    """True when the rectangles overlap by more than `pad` on both axes (touching edges do not overlap)."""
    return (a["x"] < b["x"] + b["w"] - pad and b["x"] < a["x"] + a["w"] - pad
            and a["y"] < b["y"] + b["h"] - pad and b["y"] < a["y"] + a["h"] - pad)


def _segment_hits(p: List[float], q: List[float], box: Box) -> bool:
    """An axis-aligned segment p-q that passes through the interior of `box`."""
    x0, x1 = sorted((p[0], q[0]))
    y0, y1 = sorted((p[1], q[1]))
    return x0 < box["x"] + box["w"] and x1 > box["x"] and y0 < box["y"] + box["h"] and y1 > box["y"]


def rel_columns(rel: Dict[str, Any]) -> List[Any]:
    cols = rel.get("columns")
    return list(cols) if isinstance(cols, list) else []


class ErdAudit:
    title = "ER Diagram"

    def __init__(self, data: Dict[str, Any]):
        self.data = data
        self.groups: List[Dict[str, Any]] = data.get("groups") or []
        self.entities: List[Dict[str, Any]] = data.get("entities") or []
        self.relationships: List[Dict[str, Any]] = data.get("relationships") or []
        self.notes: List[Dict[str, Any]] = data.get("notes") or []

    def pass_line(self, report: Dict[str, Any]) -> str:
        return f"[PASS] Quality Score: {report['score']}/100 ({report['grade']}). No overlap, route or label-fit problems."

    # --- helpers -------------------------------------------------------------------------------------------------

    @staticmethod
    def columns_of(e: Dict[str, Any]) -> List[Dict[str, Any]]:
        cols = e.get("columns")
        return [c if isinstance(c, dict) else {} for c in cols] if isinstance(cols, list) else []

    def ends_of(self, rel: Dict[str, Any], emap: Dict[Any, Dict[str, Any]]) -> Tuple[Any, Any]:
        """(fromEnd, toEnd) with the defaults: zeroOrMany, and one (zeroOrOne when every FK column is nullable)."""
        child = emap.get(rel.get("from"))
        cols = rel_columns(rel)
        by_name = {c.get("name"): c for c in self.columns_of(child)} if child else {}
        nullable = bool(cols) and all(by_name.get(n, {}).get("nullable") is True for n in cols)
        return rel.get("fromEnd") or "zeroOrMany", rel.get("toEnd") or ("zeroOrOne" if nullable else "one")

    # --- audit ---------------------------------------------------------------------------------------------------

    def verify_collisions(self) -> Dict[str, Any]:
        errors: List[str] = []
        budget: List[str] = []
        info: List[str] = []
        es, rs, gs, ns = self.entities, self.relationships, self.groups, self.notes
        emap = {e.get("id"): e for e in es}
        gmap = {g.get("id"): g for g in gs}
        dangling = 0

        for flag in ("showTypes", "showNotes"):
            if flag in self.data and not isinstance(self.data[flag], bool):
                errors.append(f"'{flag}' must be true or false.")
        if self.data.get("direction") is not None and self.data["direction"] not in DIRECTIONS:
            errors.append(f"'direction' must be LR or TB, not '{self.data['direction']}'.")
        if self.data.get("detail") is not None and self.data["detail"] not in DETAILS:
            errors.append(f"'detail' must be all, keys or names, not '{self.data['detail']}'.")

        # Structure: unique ids, known references, kinds.
        for label, items in (("group", gs), ("entity", es), ("relationship", rs), ("note", ns)):
            seen = set()
            for item in items:
                if item.get("id") in seen:
                    errors.append(f"Duplicate {label} id '{item.get('id')}'.")
                seen.add(item.get("id"))
        for g in gs:
            if g.get("color") is not None and g["color"] not in SWATCHES:
                errors.append(f"Group '{g.get('id')}' has unknown color '{g['color']}' (use one of the lane swatches: {', '.join(SWATCHES)}).")
        for e in es:
            eid = e.get("id")
            if e.get("group") is not None and e["group"] not in gmap:
                dangling += 1
                errors.append(f"Entity '{eid}' is in unknown group '{e['group']}'.")
            if e.get("color") is not None and e["color"] not in SWATCHES:
                errors.append(f"Entity '{eid}' has unknown color '{e['color']}' (use one of the lane swatches: {', '.join(SWATCHES)}).")
            if not isinstance(e.get("columns", []), list):
                errors.append(f"Entity '{eid}' columns must be a list of column objects.")
            names = set()
            for c in self.columns_of(e):
                n = c.get("name")
                if not str(n or "").strip():
                    errors.append(f"A column of entity '{eid}' has no name.")
                elif n in names:
                    errors.append(f"Duplicate column '{n}' in entity '{eid}'.")
                names.add(n)
                for flag in ("pk", "fk", "unique", "nullable"):
                    if flag in c and not isinstance(c[flag], bool):
                        errors.append(f"Column '{n}' of entity '{eid}': '{flag}' must be true or false.")
        for r in rs:
            rid = r.get("id")
            ok = True
            for end in ("from", "to"):
                if r.get(end) not in emap:
                    dangling += 1
                    ok = False
                    errors.append(f"Relationship '{rid}' {end} unknown entity '{r.get(end)}'.")
            for key in ("fromEnd", "toEnd"):
                if r.get(key) is not None and r[key] not in END_KINDS:
                    errors.append(f"Relationship '{rid}' has unknown {key} '{r[key]}' (use {', '.join(sorted(END_KINDS))}).")
            if "identifying" in r and not isinstance(r["identifying"], bool):
                errors.append(f"Relationship '{rid}': 'identifying' must be true or false.")
            for key, side in (("columns", "from"), ("toColumns", "to")):
                if key in r and not isinstance(r[key], list):
                    errors.append(f"Relationship '{rid}' {key} must be a list of column names.")
                elif ok:
                    have = {c.get("name") for c in self.columns_of(emap[r[side]])}
                    for n in r.get(key) or []:
                        if n not in have:
                            dangling += 1
                            errors.append(f"Relationship '{rid}' {key} unknown column '{n}' in '{r[side]}'.")
            if ok and r.get("from") == r.get("to") and not rel_columns(r):
                errors.append(f"Relationship '{rid}' is a self-reference without 'columns': name the FK column.")
        for n in ns:
            if not str(n.get("text") or "").strip():
                errors.append(f"Note '{n.get('id')}' has no text.")
            for eid in n.get("entities") or []:
                if eid not in emap:
                    dangling += 1
                    errors.append(f"Note '{n.get('id')}' is attached to unknown entity '{eid}'.")

        # Geometry (only meaningful once laid out).
        laid_out = all(_is_box(e.get("box")) for e in es) and all(isinstance(r.get("points"), list) and len(r["points"]) >= 2 for r in rs)
        overlaps = overflows = 0
        crossings = 0
        if (es or rs) and not laid_out:
            errors.append("Diagram is not laid out (entities need box, relationships need points): run --layout.")
        elif laid_out:
            canvas = self.data.get("canvas") or {}
            width, height = canvas.get("width", math.inf), canvas.get("height", math.inf)
            crossings = int(canvas.get("crossings") or 0)
            for i, a in enumerate(es):
                for b in es[i + 1:]:
                    if _inside(a["box"], b["box"]):
                        overlaps += 1
                        errors.append(f"Entities '{a.get('id')}' and '{b.get('id')}' overlap.")
                bx = a["box"]
                if bx["x"] < 0 or bx["y"] < 0 or bx["x"] + bx["w"] > width or bx["y"] + bx["h"] > height:
                    overflows += 1
                    errors.append(f"Entity '{a.get('id')}' extends past the diagram edge.")
            for r in rs:
                pts = r["points"]
                ends = {r.get("from"), r.get("to")}
                if any(not (isinstance(p, (list, tuple)) and len(p) == 2 and _num(p[0]) and _num(p[1])) for p in pts):
                    errors.append(f"Relationship '{r.get('id')}' has a malformed route.")
                    continue
                if any(p[0] != q[0] and p[1] != q[1] for p, q in zip(pts, pts[1:])):
                    errors.append(f"Relationship '{r.get('id')}' route is not orthogonal.")
                for k in (0, -2):  # first and last segment: a horizontal stub the crow's foot is drawn on
                    p, q = pts[k], pts[k + 1]
                    if p[1] != q[1] or abs(p[0] - q[0]) < STUB - 0.5:
                        errors.append(f"Relationship '{r.get('id')}' route needs a horizontal stub of at least {STUB}px at each end.")
                        break
                for e in es:
                    if e.get("id") in ends:
                        continue
                    if any(_segment_hits(p, q, e["box"]) for p, q in zip(pts, pts[1:])):
                        errors.append(f"Relationship '{r.get('id')}' passes through entity '{e.get('id')}'.")
                lb = r.get("labelBox")
                if lb is not None and not _is_box(lb):
                    errors.append(f"Relationship '{r.get('id')}' has a malformed labelBox.")
            labelled = [r for r in rs if _is_box(r.get("labelBox"))]
            for i, a in enumerate(labelled):
                for b in labelled[i + 1:]:
                    if _inside(a["labelBox"], b["labelBox"]):
                        overlaps += 1
                        errors.append(f"Labels '{a.get('label')}' and '{b.get('label')}' overlap.")
                for e in es:
                    if _inside(a["labelBox"], e["box"]):
                        overlaps += 1
                        errors.append(f"Label '{a.get('label')}' sits over entity '{e.get('id')}'.")

        # Warnings (never change the score).
        grouped = bool(gs)
        used_cols: Dict[Tuple[Any, Any], bool] = {}
        for r in rs:
            for n in rel_columns(r):
                used_cols[(r.get("from"), n)] = True
        for e in es:
            eid, cols = e.get("id"), self.columns_of(e)
            for c in cols:
                if c.get("fk") is True and (eid, c.get("name")) not in used_cols:
                    budget.append(f"Column '{eid}.{c.get('name')}' is marked fk but no relationship uses it: add the relationship, or drop 'fk'.")
            if cols and not any(c.get("pk") is True for c in cols) and not str(e.get("note") or "").strip():
                budget.append(f"Table '{eid}' has no primary key: mark one 'pk', or say why in the table's 'note'.")
            if len(cols) > MAX_COLUMNS_ALL and self.data.get("detail", "all") == "all" and not e.get("collapsed"):
                budget.append(f"Table '{eid}' has {len(cols)} columns at detail 'all' (keep to {MAX_COLUMNS_ALL}): set \"detail\": \"keys\".")
            if len(str(e.get("name") or "")) > MAX_TABLE_NAME:
                budget.append(f"Table name '{e.get('name')}' is over {MAX_TABLE_NAME} characters and will be truncated.")
            for c in cols:
                if len(str(c.get("name") or "")) > MAX_COLUMN_NAME:
                    budget.append(f"Column name '{eid}.{c.get('name')}' is over {MAX_COLUMN_NAME} characters and will be truncated.")
                if len(str(c.get("type") or "")) > MAX_TYPE:
                    budget.append(f"Type '{c.get('type')}' of '{eid}.{c.get('name')}' is over {MAX_TYPE} characters and will be truncated.")
                if len(str(c.get("note") or "")) > MAX_NOTE:
                    budget.append(f"Note of column '{eid}.{c.get('name')}' is over {MAX_NOTE} characters and will be truncated.")
        for r in rs:
            by_name = {c.get("name"): c for c in self.columns_of(emap.get(r.get("from")) or {})}
            for n in rel_columns(r):
                if n in by_name and by_name[n].get("fk") is not True:
                    budget.append(f"Relationship '{r.get('id')}' uses column '{r.get('from')}.{n}' which is not marked fk.")
            cols = rel_columns(r)
            if cols and "identifying" not in r and all(by_name.get(n, {}).get("pk") is True for n in cols):
                budget.append(f"Relationship '{r.get('id')}': every column in 'columns' is a pk, so it is identifying: set \"identifying\": true.")
            if len(str(r.get("label") or "")) > MAX_LABEL:
                budget.append(f"Label '{r.get('label')}' is over {MAX_LABEL} characters and will be truncated.")
        for n in ns:
            if len(str(n.get("text") or "")) > MAX_NOTE:
                budget.append(f"Note '{n.get('id')}' is over {MAX_NOTE} characters: shorten it.")
        if laid_out:
            flow = "y" if self.data.get("direction") == "TB" else "x"
            stacks: Dict[Tuple[Any, Any], int] = {}
            for e in es:
                key = (e.get("group") if e.get("group") in gmap else None, round(e["box"][flow]))
                stacks[key] = stacks.get(key, 0) + 1
            for (gid, _), count in stacks.items():
                if count > MAX_PER_BAND_RANK:
                    where = f"area '{gmap[gid].get('name', gid)}'" if gid in gmap else "the diagram"
                    budget.append(f"{count} tables stack in one rank of {where} (keep to {MAX_PER_BAND_RANK}): split it into another area.")
        if not grouped and any(e.get("color") for e in es):
            key = self.data.get("colorKey") if isinstance(self.data.get("colorKey"), dict) else {}
            for c in dict.fromkeys(e.get("color") for e in es if e.get("color") in SWATCHES):
                if not str(key.get(c) or "").strip():
                    budget.append(f"Tables use {c} but 'colorKey' does not say what it means: add \"colorKey\": {{\"{c}\": \"Billing\"}}.")
        elif grouped and any(e.get("color") for e in es):
            budget.append("Tables have 'color' but the diagram uses 'groups': the area sets the colour, drop the table colours.")

        # Info lines.
        if crossings:
            info.append(f"{crossings} line crossing{'s' if crossings != 1 else ''}.")
        for r in rs:
            f_end, t_end = self.ends_of(r, emap)
            if f_end in MANY_ENDS and t_end in MANY_ENDS:
                info.append(f"Relationship '{r.get('id')}' ({r.get('from')} to {r.get('to')}) is many-to-many drawn directly: "
                            "for a physical schema add a junction table.")

        score = max(0, 100 - ERROR_PENALTY * len(errors))
        grade = "A+" if score >= 98 else "A" if score >= 90 else "B" if score >= 80 else "C" if score >= 60 else "F"
        return {
            "passed": score >= 90 and not errors, "score": score, "grade": grade, "issues": errors,
            "entity_count": len(es), "relationship_count": len(rs), "group_count": len(gs), "note_count": len(ns),
            "overlaps_count": overlaps, "overflows_count": overflows, "dangling_count": dangling,
            "crossings_count": crossings, "info": info, "budget_warnings": budget,
        }

    def summary_lines(self, report: Dict[str, Any]) -> List[str]:
        lines = [
            f"Structure: {report['entity_count']} Tables | {report['relationship_count']} Relationships | {report['group_count']} Areas | {report['note_count']} Notes",
            f"Diagram Quality Score: {report['score']}/100  [GRADE: {report['grade']}]",
            "-" * 70,
            f"✓ Spacing and Label Fit:         {report['overlaps_count']} problems",
            f"✓ Diagram Bounds:                {report['overflows_count']} problems",
            f"✓ Reference Integrity:           {report['dangling_count']} dangling references",
        ]
        lines.extend(f"[INFO] {line}" for line in report.get("info", []))
        return lines
