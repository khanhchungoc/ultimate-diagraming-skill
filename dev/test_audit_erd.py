#!/usr/bin/env python3
"""Unit cases for the ER diagram audit rules (scripts/audit_erd.py): each rule has one failing case, and the valid
forms it must accept. Inputs are laid out by hand (box, points, labelBox, canvas), so no engine is needed.

Usage: python dev/test_audit_erd.py
Exit codes: 0 all passed, 2 a case failed.
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from audit_erd import ErdAudit, HEAD_H, ROW_H  # noqa: E402

CUSTOMER = [{"name": "id", "type": "uuid", "pk": True}, {"name": "email", "type": "text", "unique": True}]
ORDER = [{"name": "id", "type": "uuid", "pk": True}, {"name": "customer_id", "type": "uuid", "fk": True},
         {"name": "placed_at", "type": "timestamptz"}]
BASE = {
    "diagramType": "erd",
    "entities": [
        {"id": "customer", "name": "customer", "columns": CUSTOMER,
         "box": {"x": 40, "y": 40, "w": 168, "h": HEAD_H + 2 * ROW_H}},
        {"id": "order", "name": "order", "columns": ORDER,
         "box": {"x": 320, "y": 40, "w": 168, "h": HEAD_H + 3 * ROW_H}},
    ],
    "relationships": [
        # order (child) row customer_id -> customer (parent) row id
        {"id": "r1", "from": "order", "to": "customer", "columns": ["customer_id"], "fromEnd": "zeroOrMany", "toEnd": "one",
         "label": "places", "points": [[320, 115], [270, 115], [270, 89], [208, 89]],
         "labelBox": {"x": 212, "y": 60, "w": 56, "h": 22}},
    ],
    "canvas": {"width": 600, "height": 240, "crossings": 0, "length": 168},
}


def audit(**changes):
    d = copy.deepcopy(BASE)
    d.update(changes)
    report = ErdAudit(d).verify_collisions()
    return report["issues"], report


def ent(eid, columns, x, y, **extra):
    return {"id": eid, "name": eid, "columns": columns,
            "box": {"x": x, "y": y, "w": 168, "h": HEAD_H + len(columns) * ROW_H}, **extra}


def route(points, **extra):
    return {**BASE["relationships"][0], "points": points, **extra}


def edit(rel_changes=None, entity=None, **top):
    """BASE with the one relationship changed (and optionally the first entity replaced)."""
    d = {"relationships": [{**BASE["relationships"][0], **(rel_changes or {})}]}
    if entity is not None:
        d["entities"] = [entity, copy.deepcopy(BASE["entities"][1])]
    d.update(top)
    return d


TOO_LONG = "x" * 40
CASES = [
    # (name, changes, expected substring of an issue, or None for no issue)
    ("the base diagram is valid", {}, None),
    ("a diagram that is not laid out",
     dict(entities=[{k: v for k, v in e.items() if k != "box"} for e in BASE["entities"]]), "not laid out"),
    # Structure
    ("duplicate entity id", dict(entities=[BASE["entities"][0], {**BASE["entities"][1], "id": "customer"}]), "Duplicate entity id 'customer'"),
    ("duplicate relationship id", dict(relationships=[BASE["relationships"][0], BASE["relationships"][0]]), "Duplicate relationship id"),
    ("duplicate column name",
     edit(entity=ent("customer", CUSTOMER + [{"name": "email", "type": "text"}], 40, 40)), "Duplicate column 'email'"),
    ("a column without a name", edit(entity=ent("customer", CUSTOMER + [{"type": "text"}], 40, 40)), "has no name"),
    ("a key flag that is not a boolean", edit(entity=ent("customer", [{"name": "id", "pk": "yes"}], 40, 40)), "'pk' must be true or false"),
    ("relationship from an unknown entity", edit({"from": "ghost"}), "from unknown entity 'ghost'"),
    ("relationship to an unknown entity", edit({"to": "ghost"}), "to unknown entity 'ghost'"),
    ("unknown column in columns", edit({"columns": ["cust_id"]}), "columns unknown column 'cust_id'"),
    ("unknown column in toColumns", edit({"toColumns": ["uid"]}), "toColumns unknown column 'uid'"),
    ("toColumns naming a unique column is valid", edit({"toColumns": ["email"]}), None),
    ("a self-reference without columns",
     dict(entities=[BASE["entities"][0], ent("order", ORDER + [{"name": "parent_id", "fk": True}], 320, 40)],
          relationships=[{"id": "r1", "from": "order", "to": "order", "points": [[488, 115], [508, 115], [508, 89], [488, 89]]}]),
     "self-reference without 'columns'"),
    ("a self-reference with columns is valid",
     dict(entities=[BASE["entities"][0], ent("order", ORDER + [{"name": "parent_id", "fk": True}], 320, 40)],
          relationships=[{"id": "r1", "from": "order", "to": "order", "columns": ["parent_id"],
                          "points": [[488, 141], [528, 141], [528, 89], [488, 89]]}]), None),
    ("bad fromEnd", edit({"fromEnd": "many"}), "unknown fromEnd 'many'"),
    ("bad toEnd", edit({"toEnd": "exactlyOne"}), "unknown toEnd 'exactlyOne'"),
    ("all four end kinds are valid", edit({"fromEnd": "oneOrMany", "toEnd": "zeroOrOne"}), None),
    ("identifying is not a boolean", edit({"identifying": "yes"}), "'identifying' must be true or false"),
    ("unknown table colour", dict(entities=[{**BASE["entities"][0], "color": "#123456"}, BASE["entities"][1]]), "unknown color '#123456'"),
    ("a lane swatch is a valid table colour", dict(entities=[{**BASE["entities"][0], "color": "#e0f2fe"}, BASE["entities"][1]],
                                                    colorKey={"#e0f2fe": "Sales"}), None),
    ("unknown detail", dict(detail="some"), "'detail' must be all, keys or names"),
    ("detail keys is valid", dict(detail="keys"), None),
    ("showTypes is not a boolean", dict(showTypes="no"), "'showTypes' must be true or false"),
    ("a note without text", dict(notes=[{"id": "n1", "text": " ", "entities": ["order"]}]), "has no text"),
    ("a note on an unknown entity", dict(notes=[{"id": "n1", "text": "t", "entities": ["ghost"]}]), "unknown entity 'ghost'"),
    ("a note on a table is valid", dict(notes=[{"id": "n1", "text": "t", "entities": ["order"]}]), None),
    # Geometry
    ("two entities overlap", dict(entities=[BASE["entities"][0], {**BASE["entities"][1], "box": {"x": 100, "y": 60, "w": 168, "h": 114}}]), "overlap"),
    ("entities that touch do not overlap",
     dict(entities=[BASE["entities"][0], {**BASE["entities"][1], "box": {"x": 208, "y": 40, "w": 168, "h": 114}}],
          relationships=[route([[208, 115], [188, 115], [188, 89], [208, 89]], labelBox={"x": 100, "y": 150, "w": 56, "h": 22})]),
     None),
    ("an entity past the canvas edge", dict(canvas={"width": 400, "height": 240, "crossings": 0}), "past the diagram edge"),
    ("a route through another entity",
     dict(entities=BASE["entities"] + [ent("log", [{"name": "id", "pk": True}], 240, 90)],
          relationships=[route([[320, 115], [270, 115], [270, 89], [208, 89]], to="customer")]), "passes through entity 'log'"),
    ("a diagonal route past a table corner is valid",
     dict(entities=BASE["entities"] + [{**ent("log", [{"name": "id", "pk": True}], 230, 120), "box": {"x": 230, "y": 120, "w": 60, "h": 40}}],
          relationships=[route([[320, 115], [270, 100], [208, 89]])]), None),
    ("a diagonal route through another entity",
     dict(entities=BASE["entities"] + [ent("log", [{"name": "id", "pk": True}], 240, 90)],
          relationships=[route([[320, 115], [270, 100], [208, 89]])]), "passes through entity 'log'"),
    ("two labels overlap",
     dict(relationships=[BASE["relationships"][0], {**BASE["relationships"][0], "id": "r2", "label": "owns",
                                                    "labelBox": {"x": 230, "y": 66, "w": 56, "h": 22}}]), "Labels 'places' and 'owns' overlap"),
    ("a label over an entity", edit({"labelBox": {"x": 300, "y": 60, "w": 56, "h": 22}}), "sits over entity 'order'"),
    ("labels clear of each other are valid",
     dict(relationships=[BASE["relationships"][0], {**BASE["relationships"][0], "id": "r2", "label": "owns",
                                                    "labelBox": {"x": 212, "y": 120, "w": 56, "h": 22}}]), None),
]

# Warnings go to budget_warnings and never change the score: (name, changes, expected substring of a warning, or None)
WARNINGS = [
    ("the base diagram has no warnings", {}, None),
    ("an fk column no relationship uses", edit(relationships=[]), "marked fk but no relationship uses it"),
    ("a relationship column not marked fk",
     dict(entities=[BASE["entities"][0], ent("order", [{"name": "id", "pk": True}, {"name": "customer_id"}], 320, 40)]),
     "not marked fk"),
    ("a table with no primary key", dict(entities=[BASE["entities"][0], ent("order", [{"name": "customer_id", "fk": True}], 320, 40)]), "has no primary key"),
    ("a table with no primary key but a note saying why",
     dict(entities=[BASE["entities"][0], ent("order", [{"name": "customer_id", "fk": True}], 320, 40, note="append-only log")]), None),
    ("more than 25 columns at detail all",
     dict(entities=[BASE["entities"][0], ent("order", [{"name": "id", "pk": True}, {"name": "customer_id", "fk": True}] + [{"name": f"c{i}"} for i in range(25)], 320, 40)]),
     "set \"detail\": \"keys\""),
    ("25 columns at detail all is fine",
     dict(entities=[BASE["entities"][0], ent("order", [{"name": "id", "pk": True}, {"name": "customer_id", "fk": True}] + [{"name": f"c{i}"} for i in range(23)], 320, 40)]),
     None),
    ("a label over 20 characters", edit({"label": "x" * 21}), "Label 'xxxxxxxxxxxxxxxxxxxxx' is over 20"),
    ("a table name over 28 characters", edit(entity=ent("customer", CUSTOMER, 40, 40, name="x" * 29)), "Table name"),
    ("a column name over 28 characters", edit(entity=ent("customer", [{"name": "x" * 29, "pk": True}], 40, 40)), "Column name"),
    ("a type over 16 characters", edit(entity=ent("customer", [{"name": "id", "pk": True, "type": "x" * 17}], 40, 40)), "Type 'xxxxxxxxxxxxxxxxx'"),
    ("a note over 120 characters", dict(notes=[{"id": "n1", "text": "x" * 121, "entities": ["order"]}]), "Note 'n1' is over 120"),
    ("an all-pk relationship that is not marked identifying",
     dict(entities=[BASE["entities"][0], ent("order", [{"name": "customer_id", "pk": True, "fk": True}], 320, 40)]), "set \"identifying\": true"),
    ("an all-pk relationship marked identifying is fine",
     dict(entities=[BASE["entities"][0], ent("order", [{"name": "customer_id", "pk": True, "fk": True}], 320, 40)],
          relationships=[{**BASE["relationships"][0], "identifying": True}]), None),
    ("an all-pk relationship marked identifying false is fine",
     dict(entities=[BASE["entities"][0], ent("order", [{"name": "customer_id", "pk": True, "fk": True}], 320, 40)],
          relationships=[{**BASE["relationships"][0], "identifying": False}]), None),
    ("9 tables and no colour", dict(entities=BASE["entities"] + [ent(f"t{i}", [{"name": "id", "pk": True}], 20 + 180 * i, 260) for i in range(7)]),
     "none has a 'color'"),
    ("8 tables and no colour is fine", dict(entities=BASE["entities"] + [ent(f"t{i}", [{"name": "id", "pk": True}], 20 + 180 * i, 260) for i in range(6)]), None),
    ("9 tables with one coloured is fine",
     dict(entities=[{**BASE["entities"][0], "color": "#fef3c7"}] + BASE["entities"][1:] + [ent(f"t{i}", [{"name": "id", "pk": True}], 20 + 180 * i, 260) for i in range(7)],
          colorKey={"#fef3c7": "Sales"}), None),
    ("a colour with no colorKey entry", dict(entities=[{**BASE["entities"][0], "color": "#fef3c7"}, BASE["entities"][1]]), "does not say what it means"),
]


def main() -> int:
    failed = 0
    for name, changes, expect in CASES:
        issues, report = audit(**changes)
        ok = not issues if expect is None else any(expect in i for i in issues)
        failed += not ok
        print(f"[{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f" - issues: {issues}"))
    for name, changes, expect in WARNINGS:
        issues, report = audit(**changes)
        warnings = report["budget_warnings"]
        ok = (not warnings) if expect is None else any(expect in w for w in warnings)
        ok = ok and report["score"] == 100 - 12 * len(issues)  # warnings never change the score
        failed += not ok
        print(f"[{'PASS' if ok else 'FAIL'}] warning: {name}" + ("" if ok else f" - warnings: {warnings} issues: {issues}"))
    # A table with no columns at all is not a missing primary key
    _, report = audit(entities=[BASE["entities"][0], {**ent("order", [], 320, 40)}], relationships=[])
    ok = not report["budget_warnings"]
    failed += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] warning: a table with no columns yet does not warn - {report['budget_warnings']}")
    # Info lines: crossings and a direct many-to-many, in the summary and never a warning or an error
    issues, report = audit(canvas={"width": 600, "height": 240, "crossings": 3},
                           relationships=[{**BASE["relationships"][0], "fromEnd": "zeroOrMany", "toEnd": "oneOrMany"}])
    lines = ErdAudit(BASE).summary_lines(report)
    ok = (not issues and not report["budget_warnings"] and any("3 line crossings" in l for l in lines)
          and any("many-to-many" in l for l in lines) and report["passed"])
    failed += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] info: crossings and many-to-many are summary lines only - {lines}")
    # A nullable FK defaults toEnd to zeroOrOne, so it is not many-to-many either way
    nullable = ent("order", [{"name": "id", "pk": True}, {"name": "customer_id", "fk": True, "nullable": True}], 320, 40)
    _, report = audit(entities=[BASE["entities"][0], nullable],
                      relationships=[{k: v for k, v in BASE["relationships"][0].items() if k not in ("fromEnd", "toEnd")}])
    ok = not report["info"]
    failed += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] info: default ends of a nullable FK are not many-to-many - {report['info']}")
    # Report shape and the clean pass line
    audit_obj = ErdAudit(copy.deepcopy(BASE))
    report = audit_obj.verify_collisions()
    keys = {"passed", "score", "grade", "issues", "budget_warnings"}
    ok = keys <= set(report) and report["passed"] and report["score"] == 100 and report["grade"] == "A+" \
        and audit_obj.pass_line(report).startswith("[PASS] Quality Score: 100/100") and ErdAudit.title == "ER Diagram" \
        and audit_obj.summary_lines(report)[0].startswith("Structure: 2 Tables | 1 Relationships")
    failed += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] report shape, pass line and summary - {report}")
    # An error costs 12 points, and a score under 90 does not pass
    _, report = audit(relationships=[{**BASE["relationships"][0], "from": "ghost"}, {**BASE["relationships"][0], "id": "r2", "to": "ghost"}])
    ok = report["score"] == 100 - 12 * len(report["issues"]) and not report["passed"]
    failed += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] score is 100 minus 12 per error - {report['score']}")
    # The audit lists the same swatches as the page (SWATCHES in assets/shell/shell.js)
    import re
    from audit_erd import SWATCHES
    shell = (ROOT / "assets" / "shell" / "shell.js").read_text(encoding="utf-8")
    block = shell[shell.index("const SWATCHES = ["):]
    block = block[:block.index("];")]
    in_shell = tuple(re.findall(r"hex: '(#[0-9a-f]{6})'", block))
    ok = in_shell == SWATCHES
    failed += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] the audit's swatches are the shell's, in order - {in_shell}")
    # Codec: v3 round trip, v1/v2 blocks drop their layout, v2 groups become table colours, renamed ids rename layout keys
    from disk_format import from_disk, to_disk
    laid = copy.deepcopy(BASE)
    laid["entities"][0].update(x=24, y=40, color="#e0f2fe")
    laid["entities"][1].update(x=320, y=40)
    laid["colorKey"] = {"#e0f2fe": "Sales"}
    laid["direction"] = "LR"
    laid["_loose"] = {"x": 0, "y": 0, "w": 1, "h": 1}
    laid["relationships"][0]["curve"] = [[0, 0]] * 4
    disk = to_disk("erd", laid)
    ok = (disk["schemaVersion"] == 3 and "direction" not in disk and "_loose" not in disk and "canvas" not in disk
          and "groups" not in disk and list(disk["layout"]) == ["customer", "order"] and disk["layout"]["order"] == {"x": 320, "y": 40}
          and all(k not in disk["entities"][0] for k in ("x", "y", "box")) and disk["entities"][0]["color"] == "#e0f2fe"
          and all(k not in disk["relationships"][0] for k in ("curve", "points", "labelBox"))
          and list(disk)[:2] == ["diagramType", "schemaVersion"] and list(disk)[-1] == "layout")
    back = from_disk("erd", disk)
    ok = ok and "layout" not in back and (back["entities"][0]["x"], back["entities"][0]["y"]) == (24, 40) \
        and (back["entities"][1]["x"], back["entities"][1]["y"]) == (320, 40) and to_disk("erd", back) == disk
    failed += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] codec: v3 round trip keeps table positions and colours - {disk.get('layout')}")
    v1 = {**disk, "schemaVersion": 1}
    ok = "layout" not in from_disk("erd", v1) and "x" not in from_disk("erd", v1)["entities"][0]
    v0 = {k: v for k, v in disk.items() if k != "schemaVersion"}
    ok = ok and "layout" not in from_disk("erd", v0) and "direction" not in from_disk("erd", {**v1, "direction": "TB"})
    failed += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] codec: a v1 (or unversioned) block drops its layout")
    v2 = {"diagramType": "erd", "schemaVersion": 2, "colorKey": {"#fef3c7": "Kept"},
          "groups": [{"id": "g1", "name": "Sales", "color": "#e0f2fe"}, {"id": "g2", "name": "Ops", "color": "#fef3c7"},
                     {"id": "g3", "name": "Plain"}],
          "entities": [{"id": "a", "name": "a", "group": "g1"}, {"id": "b", "name": "b", "group": "g2"},
                       {"id": "c", "name": "c", "group": "g3", "color": "#dcfce7"}, {"id": "d", "name": "d"}],
          "layout": {"g1": {"x": 1, "y": 2}, "a": {"x": 3, "y": 4}}}
    m = from_disk("erd", v2)
    ok = ("groups" not in m and "layout" not in m and all("group" not in e and "x" not in e for e in m["entities"])
          and [e.get("color") for e in m["entities"]] == ["#e0f2fe", "#fef3c7", "#dcfce7", None]
          and m["colorKey"] == {"#fef3c7": "Kept", "#e0f2fe": "Sales"})
    failed += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] codec: v2 groups become table colours and colorKey, layout dropped - {m.get('colorKey')}")
    gen = copy.deepcopy(laid)
    gen["entities"][0]["id"] = "t_170000000000001"
    gen["entities"][0]["name"] = "Sales Area"
    gen["relationships"][0]["to"] = "t_170000000000001"
    gdisk = to_disk("erd", gen)
    ok = "sales_area" in gdisk["layout"] and "t_170000000000001" not in gdisk["layout"] and gdisk["relationships"][0]["to"] == "sales_area"
    failed += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] codec: renamed table ids rename their layout keys - {list(gdisk['layout'])}")
    total = len(CASES) + len(WARNINGS) + 10
    print(f"{total - failed}/{total} cases passed")
    return 2 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
