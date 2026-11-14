#!/usr/bin/env python3
"""Unit cases for the sequence audit rules (scripts/audit_sequence.py): each rule has one failing case, and the
valid forms it must accept.

Usage: python dev/test_audit_sequence.py
Exit codes: 0 all passed, 2 a case failed.
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from audit_sequence import SequenceAudit  # noqa: E402

BASE = {
    "diagramType": "sequence",
    "participants": [{"id": "a", "name": "A"}, {"id": "b", "name": "B", "kind": "queue"}],
    "messages": [{"id": f"m{i}", "from": "a", "to": "b", "label": f"Step {i}"} for i in range(1, 7)],
    "fragments": [],
}


COLS = lambda host: [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}, {"id": "c", "name": "C", "column": host}]  # noqa: E731
# a and b talk first, then b and c: a and c never overlap
SPLIT = [{"id": "m1", "from": "a", "to": "b", "label": "x"}, {"id": "m2", "from": "a", "to": "b", "label": "y"},
         {"id": "m3", "from": "b", "to": "c", "label": "z"}, {"id": "m4", "from": "c", "to": "b", "label": "w"}]


def audit(**changes):
    d = copy.deepcopy(BASE)
    d.update(changes)
    report = SequenceAudit(d).verify_collisions()
    # Structure only: the geometry needs a layout, which these cases do not run
    return [i for i in report["issues"] if "not laid out" not in i], report


CASES = [
    # (name, changes, expected substring of an issue, or None for no structural issue)
    ("alt with labelled branches is valid",
     dict(fragments=[{"id": "f", "kind": "alt", "label": "x", "from": "m1", "to": "m6",
                      "branches": [{"at": "m3", "label": "y"}, {"at": "m5", "label": "z"}]}]), None),
    ("branch at the frame's first message", dict(fragments=[{"id": "f", "kind": "alt", "label": "x", "from": "m2", "to": "m4",
                                                             "branches": [{"at": "m2", "label": "y"}]}]), "after its first message"),
    ("branch after the frame's last message", dict(fragments=[{"id": "f", "kind": "alt", "label": "x", "from": "m2", "to": "m4",
                                                               "branches": [{"at": "m5", "label": "y"}]}]), "after its first message"),
    ("two branches share an at", dict(fragments=[{"id": "f", "kind": "par", "label": "x", "from": "m1", "to": "m4",
                                                  "branches": [{"at": "m3", "label": "y"}, {"at": "m3", "label": "z"}]}]), "two branches"),
    ("branches on a loop", dict(fragments=[{"id": "f", "kind": "loop", "label": "x", "from": "m1", "to": "m4",
                                            "branches": [{"at": "m3", "label": "y"}]}]), "only alt and par"),
    ("elseAt on a group", dict(fragments=[{"id": "f", "kind": "group", "label": "x", "from": "m1", "to": "m4", "elseAt": "m3"}]), "only alt and par"),
    ("both branches and elseAt", dict(fragments=[{"id": "f", "kind": "alt", "label": "x", "from": "m1", "to": "m4", "elseAt": "m2",
                                                  "branches": [{"at": "m3", "label": "y"}]}]), "both 'branches' and 'elseAt'"),
    ("unknown colour", dict(fragments=[{"id": "f", "kind": "group", "label": "x", "from": "m1", "to": "m4", "color": "pink"}]), "unknown color"),
    ("unknown participant kind", dict(participants=[{"id": "a", "name": "A", "kind": "boundary"}, {"id": "b", "name": "B"}]), "unknown kind"),
    ("note over an unknown participant", dict(notes=[{"id": "n", "text": "t", "over": "zz"}]), "unknown participant"),
    ("note after an unknown message", dict(notes=[{"id": "n", "text": "t", "over": "a", "after": "m99"}]), "after unknown message"),
    ("note before an unknown message", dict(notes=[{"id": "n", "text": "t", "over": "a", "before": "m99"}]), "before unknown message"),
    ("note over three participants", dict(notes=[{"id": "n", "text": "t", "over": ["a", "b", "a"]}]), "two to span"),
    ("note spanning two lifelines is valid", dict(notes=[{"id": "n", "text": "t", "over": ["a", "b"], "before": "m2"}]), None),
    ("collapsed frame partly overlapping another",
     dict(fragments=[{"id": "f1", "kind": "group", "label": "x", "from": "m1", "to": "m3", "collapsed": True},
                     {"id": "f2", "kind": "opt", "label": "y", "from": "m2", "to": "m5"}]), "partly overlaps"),
    ("collapsed frame around a whole frame is valid",
     dict(fragments=[{"id": "f1", "kind": "group", "label": "x", "from": "m1", "to": "m5", "collapsed": True},
                     {"id": "f2", "kind": "opt", "label": "y", "from": "m2", "to": "m3"}]), None),
    ("numbered is not a boolean", dict(numbered="yes"), "'numbered' must be true or false"),
    ("rails is not a boolean", dict(rails="yes"), "'rails' must be true or false"),
    ("rails true is valid", dict(rails=True), None),
    ("lifespans is not a boolean", dict(lifespans="yes"), "'lifespans' must be true or false"),
    ("lifespans true is valid", dict(lifespans=True), None),
    # Participant colours: errors here, warnings in COLOUR_CASES below
    ("a participant colour that is not a lane swatch",
     dict(participants=[{"id": "a", "name": "A", "color": "#123456"}, {"id": "b", "name": "B"}], colorKey={"#123456": "x"}), "unknown color '#123456'"),
    ("a flowchart swatch is a valid participant colour",
     dict(participants=[{"id": "a", "name": "A", "color": "#e0f2fe"}, {"id": "b", "name": "B"}], colorKey={"#e0f2fe": "Ours"}), None),
    ("colorKey is not an object", dict(colorKey=["#e0f2fe"]), "'colorKey' must be an object"),
    # Shared columns, start and end
    ("column without lifespans", dict(participants=COLS("a")), "no 'lifespans': true"),
    ("column that is not earlier", dict(lifespans=True, participants=[{"id": "a", "name": "A", "column": "c"}, {"id": "b", "name": "B"}, {"id": "c", "name": "C"}]), "must be an earlier participant"),
    ("column of an unknown participant", dict(lifespans=True, participants=COLS("zz")), "unknown participant"),
    ("a host that shares a column itself (a chain)",
     dict(lifespans=True, participants=[{"id": "a", "name": "A"}, {"id": "b", "name": "B", "column": "a"}, {"id": "c", "name": "C", "column": "b"}],
          messages=SPLIT), "chains are not allowed"),
    ("column over an overlap, notes included",
     dict(lifespans=True, participants=COLS("a"), messages=SPLIT, notes=[{"id": "n", "text": "t", "over": "c", "before": "m1"}]), "are both active at step 1"),
    ("column over an overlap of two messages",
     dict(lifespans=True, participants=COLS("a"), messages=[{"id": "m1", "from": "a", "to": "b", "label": "x"}, {"id": "m2", "from": "c", "to": "b", "label": "y"},
                                                          {"id": "m3", "from": "a", "to": "b", "label": "z"}]), "are both active at step 2"),
    ("column with lifespans that never overlap is valid", dict(lifespans=True, participants=COLS("a"), messages=SPLIT), None),
    ("start after the first message", dict(lifespans=True, participants=[{"id": "a", "name": "A", "start": "m5"}, {"id": "b", "name": "B"}]), "can only begin a lifeline earlier"),
    ("end before the last message", dict(lifespans=True, participants=[{"id": "a", "name": "A", "end": "m1"}, {"id": "b", "name": "B"}]), "can only end a lifeline later"),
    ("start at an unknown message", dict(lifespans=True, participants=[{"id": "a", "name": "A", "start": "m99"}, {"id": "b", "name": "B"}]), "unknown message"),
    ("start earlier and end later are valid",
     dict(lifespans=True, participants=[{"id": "a", "name": "A", "end": "m4"}, {"id": "b", "name": "B"}, {"id": "c", "name": "C", "start": "m1"}], messages=SPLIT), None),
]


def main() -> int:
    failed = 0
    for name, changes, expect in CASES:
        issues, _ = audit(**changes)
        ok = not issues if expect is None else any(expect in i for i in issues)
        failed += not ok
        print(f"[{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f" - issues: {issues}"))
    # Nesting deeper than 3 is a warning, not an error
    nest = [{"id": f"f{k}", "kind": "opt", "label": "x", "from": f"m{k}", "to": f"m{7 - k}"} for k in range(1, 4)]
    _, three = audit(fragments=nest)
    _, four = audit(fragments=nest + [{"id": "f4", "kind": "opt", "label": "x", "from": "m3", "to": "m3"}])
    ok = not three["budget_warnings"] and any("nest 4 deep" in w for w in four["budget_warnings"])
    failed += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] nesting depth warns above 3 - {three['budget_warnings']} {four['budget_warnings']}")
    # Colour warnings (not errors): a colour without a key, a key nobody uses, a rainbow
    def coloured(n, key, **kw):
        cols = ["#e0f2fe", "#fef3c7", "#dcfce7", "#fee2e2", "#f3e8ff", "#ffedd5"][:n]
        ps = [{"id": f"p{i}", "name": f"P{i}", "color": c} for i, c in enumerate(cols)]
        return audit(participants=ps, messages=[{"id": "m1", "from": "p0", "to": "p1", "label": "x"}], **dict(kw, **({"colorKey": key} if key is not None else {})))
    allkey = {c: "meaning" for c in ["#e0f2fe", "#fef3c7", "#dcfce7", "#fee2e2", "#f3e8ff", "#ffedd5"]}
    colour_cases = [
        ("colour without a colorKey warns", coloured(2, None)[1]["budget_warnings"], "does not say what it means"),
        ("an entry with no label warns", coloured(2, {"#e0f2fe": "", "#fef3c7": "Customer"})[1]["budget_warnings"], "does not say what it means"),
        ("a colorKey entry nobody uses warns", audit(participants=[{"id": "a", "name": "A"}, {"id": "b", "name": "B"}], colorKey={"#e0f2fe": "Ours"})[1]["budget_warnings"], "no participant uses"),
        ("more than 4 colours warns", coloured(5, allkey)[1]["budget_warnings"], "should group participants"),
        ("every participant a different colour warns", coloured(3, allkey)[1]["budget_warnings"], "not label each one"),
    ]
    for name, warnings, expect in colour_cases:
        ok = any(expect in w for w in warnings)
        failed += not ok
        print(f"[{'PASS' if ok else 'FAIL'}] {name} - {warnings}")
    two = coloured(2, {"#e0f2fe": "Ours", "#fef3c7": "Customer"})[1]["budget_warnings"]
    ok = not two
    failed += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] two coloured participants with a full colorKey do not warn - {two}")
    # The audit lists the same swatches as the page (SWATCHES in assets/shell/shell.js)
    import re
    from audit_sequence import SWATCHES
    shell = (ROOT / "assets" / "shell" / "shell.js").read_text(encoding="utf-8")
    block = shell[shell.index("const SWATCHES = ["):]
    block = block[:block.index("];")]
    in_shell = tuple(re.findall(r"hex: '(#[0-9a-f]{6})'", block))
    ok = in_shell == SWATCHES
    failed += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] the audit's swatches are the shell's, in order - {in_shell}")
    total = len(CASES) + 1 + len(colour_cases) + 2
    print(f"{total - failed}/{total} cases passed")
    return 2 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
