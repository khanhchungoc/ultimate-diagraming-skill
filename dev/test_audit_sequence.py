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
    print(f"{len(CASES) + 1 - failed}/{len(CASES) + 1} cases passed")
    return 2 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
