"""Audit for sequence diagrams (diagramType "sequence"): structure, geometry and complexity budget.

Checks the laid-out JSON only, so it needs no browser. Geometry constants mirror assets/types/sequence/engine.js
(SQ.BOX_W, SQ.SELF_LOOP, SQ.CHAR_W); keep them in sync.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List

BOX_W = 148
SELF_LOOP = 40
CHAR_W = 7.4
LABEL_MARGIN = 16        # clear space a label needs beside its arrow ends
MAX_PARTICIPANTS = 6
MAX_MESSAGES = 16
MAX_FRAGMENT_DEPTH = 2
PARTICIPANT_KINDS = {"actor", "system"}
MESSAGE_KINDS = {"sync", "reply", "async"}
FRAGMENT_KINDS = {"opt", "alt", "loop"}
ERROR_PENALTY = 12


def text_width(text: Any) -> int:
    return math.ceil(len("" if text is None else str(text)) * CHAR_W)


class SequenceAudit:
    title = "Sequence"

    def pass_line(self, report: Dict[str, Any]) -> str:
        return f"[PASS] Quality Score: {report['score']}/100 ({report['grade']}). No spacing, label-fit or bounds problems."

    def __init__(self, data: Dict[str, Any]):
        self.data = data
        self.participants: List[Dict[str, Any]] = data.get("participants", [])
        self.messages: List[Dict[str, Any]] = data.get("messages", [])
        self.fragments: List[Dict[str, Any]] = data.get("fragments", [])

    def verify_collisions(self) -> Dict[str, Any]:
        errors: List[str] = []
        ps, ms, fs = self.participants, self.messages, self.fragments
        pmap = {p.get("id"): p for p in ps}
        midx = {m.get("id"): i for i, m in enumerate(ms)}

        # Structure: unique ids, known references and kinds.
        for label, items in (("participant", ps), ("message", ms), ("fragment", fs)):
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
                if later["y"] <= earlier["y"]:
                    errors.append(f"Messages '{earlier['id']}' and '{later['id']}' are out of time order.")
            for m in ms:
                a, b = pmap.get(m.get("from")), pmap.get(m.get("to"))
                if not a or not b:
                    continue
                label_w = text_width(m.get("label"))
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

        # Nesting depth and budget.
        spans = {f["id"]: (midx[f["from"]], midx[f["to"]]) for f in fs if f.get("from") in midx and f.get("to") in midx}

        def depth(fid: str) -> int:
            a, b = spans[fid]
            inner = [o for o, (oa, ob) in spans.items() if o != fid and a <= oa and ob <= b and (oa, ob) != (a, b)]
            return 1 + max((depth(o) for o in inner), default=0)

        max_depth = max((depth(fid) for fid in spans), default=0)
        budget: List[str] = []
        if len(ps) > MAX_PARTICIPANTS:
            budget.append(f"{len(ps)} participants exceeds the budget of {MAX_PARTICIPANTS}; split the interaction.")
        if len(ms) > MAX_MESSAGES:
            budget.append(f"{len(ms)} messages exceeds the budget of {MAX_MESSAGES}; split into overview + detail diagrams.")
        if max_depth > MAX_FRAGMENT_DEPTH:
            budget.append(f"Fragments nest {max_depth} deep; the budget is {MAX_FRAGMENT_DEPTH}.")

        score = max(0, 100 - ERROR_PENALTY * len(errors))
        grade = "A+" if score >= 98 else "A" if score >= 90 else "B" if score >= 80 else "C" if score >= 60 else "F"
        return {
            "passed": score >= 90 and not errors, "score": score, "grade": grade, "issues": errors,
            "participant_count": len(ps), "message_count": len(ms), "fragment_count": len(fs),
            "overlaps_count": overlaps, "overflows_count": overflows, "dangling_count": dangling,
            "budget_warnings": budget,
        }

    def summary_lines(self, report: Dict[str, Any]) -> List[str]:
        return [
            f"Structure: {report['participant_count']} Participants | {report['message_count']} Messages | {report['fragment_count']} Fragments",
            f"Diagram Quality Score: {report['score']}/100  [GRADE: {report['grade']}]",
            "-" * 70,
            f"✓ Spacing and Label Fit:         {report['overlaps_count']} problems",
            f"✓ Fragment/Diagram Bounds:       {report['overflows_count']} problems",
            f"✓ Reference Integrity:           {report['dangling_count']} dangling references",
        ]
