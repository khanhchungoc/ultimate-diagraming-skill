#!/usr/bin/env python3
"""Unit cases for the sequence audit rules (scripts/audit_sequence.py): each rule has one failing case, and the
valid forms it must accept.

Usage: python dev/test_audit_sequence.py [-v|--verbose]
Exit codes: 0 all passed, 2 a case failed.
"""

from __future__ import annotations

import argparse
import copy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
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


def msgs_with(i, **extra):
    ms = copy.deepcopy(BASE["messages"])
    ms[i].update(extra)
    return ms


CASES = [
    # (name, changes, expected substring of an issue, or None for no structural issue)
    ("a note placed between lifelines is valid", dict(notes=[{"id": "n", "text": "x", "place": 0.5, "after": "m1"}]), None),
    ("a note with both over and place", dict(notes=[{"id": "n", "text": "x", "over": "a", "place": 0.5}]), "both 'over' and 'place'"),
    ("a note place that is not a number", dict(notes=[{"id": "n", "text": "x", "place": "middle"}]), "place must be a number"),
    ("activation overrides on a call are valid", dict(messages=msgs_with(1, activate=False, until="m4")), None),
    ("activate that is not a boolean", dict(messages=msgs_with(1, activate="no")), "activate must be true or false"),
    ("until naming an earlier message", dict(messages=msgs_with(3, until="m1")), "until must name a later message"),
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
    ("break fragment is valid", dict(fragments=[{"id": "f", "kind": "break", "label": "card declined", "from": "m2", "to": "m3"}]), None),
    ("branches on a break", dict(fragments=[{"id": "f", "kind": "break", "label": "x", "from": "m1", "to": "m4",
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
    ("a participant colour that is neither a slot nor a hex",
     dict(participants=[{"id": "a", "name": "A", "color": "pink"}, {"id": "b", "name": "B"}]), "unknown color 'pink'"),
    ("a palette slot is a valid participant colour",
     dict(participants=[{"id": "a", "name": "A", "color": "1"}, {"id": "b", "name": "B"}], colorKey={"1": "Ours"}), None),
    ("an old palette hex is still a valid participant colour (colorKey keyed by the hex too)",
     dict(participants=[{"id": "a", "name": "A", "color": "#e0f2fe"}, {"id": "b", "name": "B"}], colorKey={"#e0f2fe": "Ours"}), None),
    ("a custom hex is valid (it only warns, see COLOUR cases)",
     dict(participants=[{"id": "a", "name": "A", "color": "#123456"}, {"id": "b", "name": "B"}], colorKey={"#123456": "x"}), None),
    ("a frame slot, an old frame colour name and a custom hex are valid",
     dict(fragments=[{"id": "f", "kind": "group", "label": "x", "from": "m1", "to": "m2", "color": "9"},
                     {"id": "g", "kind": "group", "label": "x", "from": "m3", "to": "m4", "color": "green"},
                     {"id": "h", "kind": "group", "label": "x", "from": "m5", "to": "m5", "color": "#123456"}]), None),
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
    parser = argparse.ArgumentParser(description="Unit cases for the sequence audit rules.")
    parser.add_argument("-v", "--verbose", action="store_true", help="Print passing cases")
    args = parser.parse_args()
    failed = 0
    total = 0

    def check(name: str, cond: bool, detail: str = "") -> None:
        nonlocal failed, total
        total += 1
        failed += not cond
        if not cond or args.verbose:
            print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" - {detail}" if detail and not cond else ""))

    # The audit mirrors the engine's constants; when the engine changes them and the audit is not updated, a label the
    # engine wraps or spaces correctly is flagged (it happened: box 168, number 28, label cap 288, 14/13 and 12/11 text scale)
    import math
    import re
    import audit_sequence as aud
    engine = (ROOT / "assets" / "types" / "sequence" / "engine.js").read_text(encoding="utf-8")
    sq = lambda key: int(re.search(rf"\b{key}: (\d+)", engine).group(1))  # noqa: E731
    for key, value in (("BOX_W", aud.BOX_W), ("NUM_W", aud.NUM_W), ("LABEL_MAX_W", aud.LABEL_MAX_W), ("SELF_LOOP", aud.SELF_LOOP), ("RAIL_W", aud.RAIL_W)):
        check(f"audit {key} mirrors SQ.{key} in the engine", sq(key) == value, f"engine {sq(key)}, audit {value}")
    m = {"label": 6.5, "detail": 5.5}
    sa = SequenceAudit(copy.deepcopy(BASE), m)
    check("audit label width uses the engine's 14/13 scale, rounded to a tenth",
          "TOKENS.font.metrics.label * (14 / 13) * 10) / 10" in engine and sa.label_char_w == math.floor(6.5 * 14 / 13 * 10 + 0.5) / 10)
    check("audit detail width uses the engine's 12/11 scale, rounded to a tenth",
          "TOKENS.font.metrics.detail * (12 / 11) * 10) / 10" in engine and sa.detail_char_w == math.floor(5.5 * 12 / 11 * 10 + 0.5) / 10)
    for name, changes, expect in CASES:
        issues, _ = audit(**changes)
        ok = not issues if expect is None else any(expect in i for i in issues)
        check(name, ok, f"issues: {issues}")
    # Nesting deeper than 3 is a warning, not an error; phase group blocks (rect) do not count toward depth
    nest = [{"id": f"f{k}", "kind": "opt", "label": "x", "from": f"m{k}", "to": f"m{7 - k}"} for k in range(1, 4)]
    _, three = audit(fragments=nest)
    _, four = audit(fragments=nest + [{"id": "f4", "kind": "opt", "label": "x", "from": "m3", "to": "m3"}])
    _, grouped_three = audit(fragments=[{"id": "g1", "kind": "group", "label": "Phase", "from": "m1", "to": "m6"}] + nest)
    _, grouped_four = audit(fragments=[{"id": "g1", "kind": "group", "label": "Phase", "from": "m1", "to": "m6"}] + nest +
                            [{"id": "f4", "kind": "break", "label": "abort", "from": "m3", "to": "m3"}])
    ok = (not three["budget_warnings"] and any("nest 4 deep" in w for w in four["budget_warnings"])
          and not grouped_three["budget_warnings"] and any("nest 4 deep" in w for w in grouped_four["budget_warnings"]))
    check("nesting depth warns above 3 (excluding group)", ok,
          f"{three['budget_warnings']} {four['budget_warnings']} {grouped_three['budget_warnings']}")
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
        ("a custom hex warns that its contrast is not checked",
         audit(participants=[{"id": "a", "name": "A", "color": "#123456"}, {"id": "b", "name": "B"}], colorKey={"#123456": "x"})[1]["budget_warnings"], "contrast is not checked"),
    ]
    for name, warnings, expect in colour_cases:
        check(name, any(expect in w for w in warnings), str(warnings))
    two = coloured(2, {"#e0f2fe": "Ours", "#fef3c7": "Customer"})[1]["budget_warnings"]
    check("two coloured participants with a full colorKey do not warn", not two, str(two))
    # Codec: old palette hex and old frame colour names in, slots out; a custom hex is written unchanged
    from disk_format import authoring_json, from_disk, to_disk
    old = {"diagramType": "sequence", "colorKey": {"#e0f2fe": "Ours", "#123456": "Mine", "#fef3c7": "unused"},
           "participants": [{"id": "a", "name": "A", "color": "#e0f2fe"}, {"id": "b", "name": "B", "color": "#123456"}],
           "messages": [], "fragments": [{"id": "f1", "kind": "group", "color": c} for c in ("blue", "green", "yellow", "red", "purple", "gray", "#fee2e2")]}
    disk = to_disk("sequence", old)
    ok = (disk["colorKey"] == {"1": "Ours", "#123456": "Mine"} and [p["color"] for p in disk["participants"]] == ["1", "#123456"]
          and [f["color"] for f in disk["fragments"]] == ["1", "3", "2", "4", "5", "9", "4"]
          and to_disk("sequence", from_disk("sequence", disk)) == disk and from_disk("sequence", old)["participants"][0]["color"] == "1")
    check("codec: old hex and frame names become slots, a custom hex stays", ok, str(disk["colorKey"]))

    import json
    from layout_engine import apply_sequence_defaults, order_sequence_participants, pack_sequence_columns

    # participantOrder disk_format round-trip and key placement (before colorKey, keeping colorKey right before participants)
    po_data = {
        "diagramType": "sequence", "lifespans": True, "participantOrder": "fixed",
        "colorKey": {"1": "Ours"}, "participants": [{"id": "a", "name": "A", "color": "1"}], "messages": [],
    }
    po_disk = to_disk("sequence", po_data)
    po_keys = list(po_disk.keys())
    check("disk_format keeps participantOrder between lifespans and colorKey, and colorKey before participants",
          po_disk.get("participantOrder") == "fixed"
          and po_keys.index("lifespans") < po_keys.index("participantOrder") < po_keys.index("colorKey")
          and po_keys.index("colorKey") == po_keys.index("participants") - 1
          and to_disk("sequence", from_disk("sequence", po_disk)) == po_disk,
          str(po_keys))

    # order_sequence_participants: reduces span, keeps actor/ui leftmost, preserves ties and opt-outs
    reorder_in = {
        "diagramType": "sequence",
        "participants": [
            {"id": "u", "name": "User", "kind": "actor"},
            {"id": "c", "name": "Unused", "kind": "system"},
            {"id": "b", "name": "Service", "kind": "system"},
            {"id": "a", "name": "Gateway", "kind": "system"},
            {"id": "ui", "name": "Portal", "kind": "ui"},
        ],
        "messages": [
            {"id": "m1", "from": "u", "to": "a", "label": "1"},
            {"id": "m2", "from": "a", "to": "b", "label": "2"},
            {"id": "m3", "from": "ui", "to": "b", "label": "3"},
        ],
    }
    reordered, r_note = order_sequence_participants(reorder_in)
    r_ids = [p["id"] for p in reordered["participants"]]
    check("order_sequence_participants keeps actor/ui leftmost and reduces span",
          set(r_ids[:2]) == {"u", "ui"} and r_ids[-1] == "c" and "Participant order:" in r_note,
          f"{r_ids} {r_note!r}")
    tied = {
        "diagramType": "sequence",
        "participants": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}, {"id": "c", "name": "C"}],
        "messages": [{"id": "m1", "from": "a", "to": "c", "label": "1"}],
    }
    # [a, b, c] span=2; [a, c, b] span=1 -> reorders; when already optimal [a, c, b], keeps authored on tie
    opt_tied, _ = order_sequence_participants(tied)
    tied2 = {**tied, "participants": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}, {"id": "c", "name": "C"}],
             "messages": [{"id": "m1", "from": "a", "to": "b", "label": "1"}, {"id": "m2", "from": "b", "to": "c", "label": "2"}]}
    kept_tied, t_note = order_sequence_participants(tied2)
    check("order_sequence_participants keeps authored order on ties",
          [p["id"] for p in opt_tied["participants"]] == ["a", "c", "b"]
          and [p["id"] for p in kept_tied["participants"]] == ["a", "b", "c"] and t_note == "",
          f"{[p['id'] for p in kept_tied['participants']]} {t_note!r}")
    fixed_out, fixed_note = order_sequence_participants({**reorder_in, "participantOrder": "fixed"})
    col_out, col_note = order_sequence_participants({
        **reorder_in,
        "participants": [reorder_in["participants"][0], {**reorder_in["participants"][1], "column": "u"}, *reorder_in["participants"][2:]],
    })
    two_out, two_note = order_sequence_participants({
        "diagramType": "sequence", "participants": [{"id": "b", "name": "B"}, {"id": "a", "name": "A", "kind": "actor"}],
        "messages": [{"id": "m1", "from": "a", "to": "b", "label": "1"}],
    })
    check("order_sequence_participants skips fixed, <= 2 participants, and authored column",
          fixed_out is not None and [p["id"] for p in fixed_out["participants"]] == [p["id"] for p in reorder_in["participants"]]
          and fixed_note == "" and col_note == "" and two_note == ""
          and [p["id"] for p in two_out["participants"]] == ["b", "a"])

    pay_fixture = json.loads((ROOT / "dev" / "tests" / "fixtures" / "sequence" / "payment-phases.json").read_text(encoding="utf-8"))
    pay_ordered, pay_note = order_sequence_participants(pay_fixture)
    pay_ids = [p["id"] for p in pay_ordered["participants"]]
    check("order_sequence_participants on payment-phases keeps spm before job and pol before db",
          bool(pay_note) and pay_ids.index("spm") < pay_ids.index("job") and pay_ids.index("pol") < pay_ids.index("db"),
          str(pay_ids))

    # auto-numbered at >= 20 messages when omitted, respecting explicit False
    mk_msgs = lambda n: [{"id": f"m{i}", "from": "a", "to": "b", "label": str(i)} for i in range(1, n + 1)]  # noqa: E731
    d19, _ = apply_sequence_defaults({"diagramType": "sequence", "participants": BASE["participants"], "messages": mk_msgs(19)})
    d20, _ = apply_sequence_defaults({"diagramType": "sequence", "participants": BASE["participants"], "messages": mk_msgs(20)})
    d20_off, _ = apply_sequence_defaults({"diagramType": "sequence", "numbered": False, "participants": BASE["participants"], "messages": mk_msgs(20)})
    check("auto-numbered sets true at >= 20 messages when omitted and respects explicit false",
          "numbered" not in d19 and d20.get("numbered") is True and d20_off.get("numbered") is False,
          f"19={d19.get('numbered')} 20={d20.get('numbered')} off={d20_off.get('numbered')}")

    # auto-lifespans & column packing
    pack_in = {
        "diagramType": "sequence",
        "participants": [
            {"id": "a", "name": "A"}, {"id": "b", "name": "B"},
            {"id": "c", "name": "C"}, {"id": "d", "name": "D"},
            {"id": "idle", "name": "Idle"},
        ],
        "messages": [
            {"id": "m1", "from": "a", "to": "b", "label": "1"},
            {"id": "m2", "from": "c", "to": "d", "label": "2"},
        ],
    }
    packed, p_note = pack_sequence_columns(pack_in)
    p_cols = {p["id"]: p.get("column") for p in packed["participants"]}
    p_errs = SequenceAudit(packed).column_errors({m["id"]: i for i, m in enumerate(packed["messages"])})
    check("pack_sequence_columns packs >= 2 non-overlapping spans, skips None spans, and passes column_errors",
          packed.get("lifespans") is True and p_cols == {"a": None, "b": None, "c": "a", "d": "b", "idle": None}
          and not p_errs and bool(p_note),
          f"{p_cols} errs={p_errs} note={p_note!r}")

    one_save_in = {
        "diagramType": "sequence",
        "participants": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}, {"id": "c", "name": "C"}, {"id": "idle", "name": "Idle"}],
        "messages": [
            {"id": "m1", "from": "a", "to": "b", "label": "1"},
            {"id": "m2", "from": "b", "to": "c", "label": "2"},
        ],
    }
    one_save, one_note = pack_sequence_columns(one_save_in)
    ls_false, ls_false_note = pack_sequence_columns({**pack_in, "lifespans": False})
    has_start, start_note = pack_sequence_columns({
        **pack_in, "participants": [{**pack_in["participants"][0], "start": "m1"}, *pack_in["participants"][1:]],
    })
    check("pack_sequence_columns skips saving < 2 columns, explicit lifespans, and start/end/column overrides",
          "lifespans" not in one_save and one_note == ""
          and ls_false.get("lifespans") is False and ls_false_note == ""
          and "lifespans" not in has_start and start_note == "",
          f"one={one_note!r} ls={ls_false_note!r} start={start_note!r}")

    # P1/P2: break survives disk_format, and authoring_json strips only engine-packed lifespans/column
    brk_disk = to_disk("sequence", {**BASE, "fragments": [{"id": "f1", "kind": "break", "label": "declined", "from": "m1", "to": "m2"}]})
    check("disk_format round-trips break fragment",
          brk_disk["fragments"][0]["kind"] == "break" and from_disk("sequence", brk_disk)["fragments"][0]["kind"] == "break",
          str(brk_disk["fragments"]))

    stripped = authoring_json("sequence", packed)
    explicit_start = authoring_json("sequence", {
        **packed, "participants": [{**packed["participants"][0], "start": "m1"}, *packed["participants"][1:]],
    })
    explicit_custom = authoring_json("sequence", {
        **pack_in, "lifespans": True,
        "participants": [pack_in["participants"][0], pack_in["participants"][1],
                         {**pack_in["participants"][2], "column": "b"}, {**pack_in["participants"][3], "column": "a"}, pack_in["participants"][4]],
    })
    explicit_only_ls = authoring_json("sequence", {**pack_in, "lifespans": True})
    check("authoring_json strips engine-assigned lifespans/column and keeps explicit author settings",
          "lifespans" not in stripped and all("column" not in p for p in stripped["participants"])
          and explicit_start.get("lifespans") is True and explicit_start["participants"][2].get("column") == "a"
          and explicit_custom.get("lifespans") is True and explicit_custom["participants"][2].get("column") == "b"
          and explicit_only_ls.get("lifespans") is True,
          f"stripped={stripped.get('lifespans')} custom={explicit_custom.get('lifespans')}")

    print(f"{total - failed}/{total} cases passed")
    return 2 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
