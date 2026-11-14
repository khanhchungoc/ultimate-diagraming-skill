"""Audit for sequence diagrams (diagramType "sequence"): structure, geometry and complexity budget.

Checks the laid-out JSON only, so it needs no browser. Geometry constants mirror assets/types/sequence/engine.js
(SQ.BOX_W, SQ.SELF_LOOP, SQ.CHAR_W, SQ.DETAIL_CHAR_W, SQ.NUM_W); keep them in sync.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List

BOX_W = 148
SELF_LOOP = 40
CHAR_W = 7.4
DETAIL_CHAR_W = 6.4      # a message's detail line (smaller text)
NUM_W = 26               # the step number before a label when "numbered"
LABEL_MARGIN = 16        # clear space a label needs beside its arrow ends
MAX_PARTICIPANTS = 6
MAX_MESSAGES = 16
MAX_FRAGMENT_DEPTH = 3   # deeper nesting is a warning, not an error
PARTICIPANT_KINDS = {"actor", "system", "ui", "database", "queue", "external"}
MESSAGE_KINDS = {"sync", "reply", "async"}
FRAGMENT_KINDS = {"opt", "alt", "loop", "par", "group"}
BRANCH_KINDS = {"alt", "par"}
FRAGMENT_COLORS = {"blue", "green", "yellow", "red", "purple", "gray"}
ERROR_PENALTY = 12


def text_width(text: Any) -> int:
    return math.ceil(len("" if text is None else str(text)) * CHAR_W)


def branches_of(f: Dict[str, Any]) -> List[Dict[str, Any]]:
    """A fragment's further branches as [{at, label}]: "branches", or the short form "elseAt"."""
    if isinstance(f.get("branches"), list):
        return [b if isinstance(b, dict) else {} for b in f["branches"]]
    return [] if f.get("elseAt") is None else [{"at": f["elseAt"]}]


def note_over(n: Dict[str, Any]) -> List[Any]:
    over = n.get("over")
    return list(over) if isinstance(over, list) else [] if over is None else [over]


class SequenceAudit:
    title = "Sequence"

    def pass_line(self, report: Dict[str, Any]) -> str:
        return f"[PASS] Quality Score: {report['score']}/100 ({report['grade']}). No spacing, label-fit or bounds problems."

    def __init__(self, data: Dict[str, Any]):
        self.data = data
        self.participants: List[Dict[str, Any]] = data.get("participants", [])
        self.messages: List[Dict[str, Any]] = data.get("messages", [])
        self.fragments: List[Dict[str, Any]] = data.get("fragments", [])
        self.notes: List[Dict[str, Any]] = data.get("notes") or []

    def verify_collisions(self) -> Dict[str, Any]:
        errors: List[str] = []
        ps, ms, fs, ns = self.participants, self.messages, self.fragments, self.notes
        pmap = {p.get("id"): p for p in ps}
        midx = {m.get("id"): i for i, m in enumerate(ms)}
        numbered = bool(self.data.get("numbered"))
        show_details = self.data.get("showDetails") is not False

        # Structure: unique ids, known references and kinds.
        for flag in ("numbered", "showDetails"):
            if flag in self.data and not isinstance(self.data[flag], bool):
                errors.append(f"'{flag}' must be true or false.")
        for label, items in (("participant", ps), ("message", ms), ("fragment", fs), ("note", ns)):
            seen = set()
            for item in items:
                if item.get("id") in seen:
                    errors.append(f"Duplicate {label} id '{item.get('id')}'.")
                seen.add(item.get("id"))
        for p in ps:
            if p.get("kind", "system") not in PARTICIPANT_KINDS:
                errors.append(f"Participant '{p['id']}' has unknown kind '{p.get('kind')}'.")
        dangling = 0
        for m in ms:
            if m.get("kind", "sync") not in MESSAGE_KINDS:
                errors.append(f"Message '{m['id']}' has unknown kind '{m.get('kind')}'.")
            for end in ("from", "to"):
                if m.get(end) not in pmap:
                    dangling += 1
                    errors.append(f"Message '{m['id']}' {end} unknown participant '{m.get(end)}'.")
        for f in fs:
            if f.get("kind") not in FRAGMENT_KINDS:
                errors.append(f"Fragment '{f['id']}' has unknown kind '{f.get('kind')}'.")
            a, b = midx.get(f.get("from")), midx.get(f.get("to"))
            if a is None or b is None:
                dangling += 1
                errors.append(f"Fragment '{f['id']}' references an unknown message.")
            elif a > b:
                errors.append(f"Fragment '{f['id']}' starts after it ends.")
            elif f.get("elseAt") is not None and not (a < midx.get(f["elseAt"], -1) <= b):
                errors.append(f"Fragment '{f['id']}' elseAt must be a message after its first and within its range.")
            if f.get("color") is not None and f.get("color") not in FRAGMENT_COLORS:
                errors.append(f"Fragment '{f['id']}' has unknown color '{f.get('color')}' (use {', '.join(sorted(FRAGMENT_COLORS))}).")
            if "branches" in f:
                if f.get("elseAt") is not None:
                    errors.append(f"Fragment '{f['id']}' has both 'branches' and 'elseAt': use one.")
                if not isinstance(f["branches"], list):
                    errors.append(f"Fragment '{f['id']}' branches must be a list of {{at, label}}.")
            if (f.get("elseAt") is not None or f.get("branches")) and f.get("kind") not in BRANCH_KINDS:
                errors.append(f"Fragment '{f['id']}' is a '{f.get('kind')}': only alt and par have branches.")
            seen_at = set()
            for br in branches_of(f) if "branches" in f else []:
                at = midx.get(br.get("at"))
                if at is None:
                    dangling += 1
                    errors.append(f"Fragment '{f['id']}' branch at unknown message '{br.get('at')}'.")
                elif a is not None and b is not None and not (a < at <= b):
                    errors.append(f"Fragment '{f['id']}' branch at '{br.get('at')}' must be after its first message and within its range.")
                elif at in seen_at:
                    errors.append(f"Fragment '{f['id']}' has two branches at '{br.get('at')}'.")
                seen_at.add(at)
        for n in ns:
            over = note_over(n)
            if not str(n.get("text") or "").strip():
                errors.append(f"Note '{n.get('id')}' has no text.")
            if not 1 <= len(over) <= 2:
                errors.append(f"Note '{n.get('id')}' over must be one participant id, or two to span between.")
            for pid in over:
                if pid not in pmap:
                    dangling += 1
                    errors.append(f"Note '{n.get('id')}' is over unknown participant '{pid}'.")
            if n.get("after") is not None and n.get("before") is not None:
                errors.append(f"Note '{n.get('id')}' has both 'after' and 'before': use one.")
            for key in ("after", "before"):
                if n.get(key) is not None and n[key] not in midx:
                    dangling += 1
                    errors.append(f"Note '{n.get('id')}' {key} unknown message '{n[key]}'.")
        # A collapsed frame hides everything inside it, so no frame may cross its edge
        ranges = [(f, midx[f["from"]], midx[f["to"]]) for f in fs
                  if f.get("from") in midx and f.get("to") in midx and midx[f["from"]] <= midx[f["to"]]]
        for f, a, b in ranges:
            if not f.get("collapsed"):
                continue
            for o, oa, ob in ranges:
                if o is not f and (oa < a <= ob < b or a < oa <= b < ob):
                    errors.append(f"Collapsed fragment '{f['id']}' partly overlaps fragment '{o['id']}': half a frame cannot be hidden.")

        # Geometry (only meaningful once laid out).
        laid_out = all(isinstance(p.get("x"), (int, float)) for p in ps) and all(isinstance(m.get("y"), (int, float)) for m in ms)
        overlaps = overflows = 0
        if (ps or ms) and not laid_out:
            errors.append("Diagram is not laid out (participants need x, messages need y): run --layout.")
        elif laid_out:
            layout = self.data.get("layout") or {}
            width, height = layout.get("width", math.inf), layout.get("height", math.inf)
            for left, right in zip(ps, ps[1:]):
                if right["x"] - left["x"] < BOX_W + LABEL_MARGIN:
                    overlaps += 1
                    errors.append(f"Participants '{left['name']}' and '{right['name']}' overlap.")
            for earlier, later in zip(ms, ms[1:]):
                # Messages hidden in one collapsed frame share its summary row
                if later["y"] < earlier["y"] or (later["y"] == earlier["y"] and not (earlier.get("hidden") and later.get("hidden"))):
                    errors.append(f"Messages '{earlier['id']}' and '{later['id']}' are out of time order.")
            for m in ms:
                a, b = pmap.get(m.get("from")), pmap.get(m.get("to"))
                if not a or not b:
                    continue
                detail = m.get("detail") if show_details else None
                label_w = max(text_width(m.get("label")) + (NUM_W if numbered else 0),
                              math.ceil(len(str(detail or "")) * DETAIL_CHAR_W))
                if a is b:
                    pos = ps.index(a)
                    nxt = ps[pos + 1]["x"] if pos + 1 < len(ps) else math.inf
                    if a["x"] + SELF_LOOP + 8 + label_w + 8 > nxt:
                        overlaps += 1
                        errors.append(f"Self-message '{m.get('label')}' runs into the next lifeline.")
                elif abs(b["x"] - a["x"]) < label_w + LABEL_MARGIN:
                    overlaps += 1
                    errors.append(f"Label '{m.get('label')}' is wider than the space between its lifelines.")
                if m["y"] > height:
                    overflows += 1
            for f in fs:
                if "x" not in f:
                    continue
                a, b = midx.get(f.get("from")), midx.get(f.get("to"))
                if a is None or b is None:
                    continue
                for m in ms[a:b + 1]:
                    ends = [pmap[e] for e in (m.get("from"), m.get("to")) if e in pmap]
                    inside_y = f["y"] < m["y"] < f["y"] + f["h"]
                    inside_x = all(f["x"] <= e["x"] <= f["x"] + f["w"] for e in ends)
                    if not (inside_y and inside_x):
                        overflows += 1
                        errors.append(f"Message '{m['id']}' sticks out of fragment '{f['id']}'.")
                if f["x"] + f["w"] > width:
                    overflows += 1
                    errors.append(f"Fragment '{f['id']}' extends past the diagram edge.")
            for n in ns:
                if "x" in n and (n["x"] < 0 or n["x"] + n["w"] > width or n["y"] + n["h"] > height):
                    overflows += 1
                    errors.append(f"Note '{n.get('id')}' extends past the diagram edge.")

        # Nesting depth and budget.
        spans = {f["id"]: (midx[f["from"]], midx[f["to"]]) for f in fs if f.get("from") in midx and f.get("to") in midx}

        def depth(fid: str) -> int:
            a, b = spans[fid]
            inner = [o for o, (oa, ob) in spans.items() if o != fid and a <= oa and ob <= b and (oa, ob) != (a, b)]
            return 1 + max((depth(o) for o in inner), default=0)

        max_depth = max((depth(fid) for fid in spans), default=0)
        budget: List[str] = []
        if max_depth > MAX_FRAGMENT_DEPTH:
            budget.append(f"Frames nest {max_depth} deep (keep to {MAX_FRAGMENT_DEPTH}): put a rare exit in a note, "
                          "or split the flow.")

        score = max(0, 100 - ERROR_PENALTY * len(errors))
        grade = "A+" if score >= 98 else "A" if score >= 90 else "B" if score >= 80 else "C" if score >= 60 else "F"
        return {
            "passed": score >= 90 and not errors, "score": score, "grade": grade, "issues": errors,
            "participant_count": len(ps), "message_count": len(ms), "fragment_count": len(fs), "note_count": len(ns),
            "overlaps_count": overlaps, "overflows_count": overflows, "dangling_count": dangling,
            "budget_warnings": budget,
        }

    def summary_lines(self, report: Dict[str, Any]) -> List[str]:
        return [
            f"Structure: {report['participant_count']} Participants | {report['message_count']} Messages | {report['fragment_count']} Fragments | {report['note_count']} Notes",
            f"Diagram Quality Score: {report['score']}/100  [GRADE: {report['grade']}]",
            "-" * 70,
            f"✓ Spacing and Label Fit:         {report['overlaps_count']} problems",
            f"✓ Fragment/Diagram Bounds:       {report['overflows_count']} problems",
            f"✓ Reference Integrity:           {report['dangling_count']} dangling references",
        ]
