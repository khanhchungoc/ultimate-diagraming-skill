#!/usr/bin/env python3
"""Unit cases for the use case diagram audit rules (scripts/audit_usecase.py): each rule has one failing case, and the
valid forms it must accept. Inputs are laid out by hand (x, y, w, h, points, labelBox, canvas), so no engine is needed.
Also the codec: round trip, derived fields, layout map and editor-id renaming (scripts/disk_format.py).

Usage: python dev/test_audit_usecase.py [-v|--verbose]
Exit codes: 0 all passed, 2 a case failed.
"""

from __future__ import annotations

import argparse
import copy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from audit_usecase import UsecaseAudit  # noqa: E402

# Subject (160,20)-(640,360); ellipses are 160 x 70; actors 80 x 100 outside the boundary.
BASE = {
    "diagramType": "usecase",
    "title": "Shop",
    "subjects": [{"id": "shop", "name": "Storefront", "x": 160, "y": 20, "w": 480, "h": 340}],
    "actors": [
        {"id": "customer", "name": "Customer", "x": 20, "y": 110, "w": 80, "h": 100},
        {"id": "psp", "name": "Payment gateway", "kind": "system", "side": "right", "x": 700, "y": 170, "w": 80, "h": 100},
    ],
    "useCases": [
        {"id": "browse", "name": "Browse catalogue", "subject": "shop", "x": 200, "y": 50, "w": 160, "h": 70},
        {"id": "checkout", "name": "Check out", "subject": "shop", "x": 200, "y": 200, "w": 160, "h": 70,
         "extensionPoints": ["Payment"]},
        {"id": "pay", "name": "Take payment", "subject": "shop", "x": 440, "y": 200, "w": 160, "h": 70},
        {"id": "voucher", "name": "Apply voucher", "subject": "shop", "x": 440, "y": 60, "w": 160, "h": 70},
    ],
    "links": [
        {"id": "l1", "type": "association", "from": "customer", "to": "browse", "points": [[100, 140], [203, 95]]},
        {"id": "l2", "type": "association", "from": "customer", "to": "checkout", "points": [[100, 180], [205, 225]]},
        {"id": "l3", "type": "include", "from": "checkout", "to": "pay", "points": [[360, 235], [440, 235]],
         "labelBox": {"x": 372, "y": 215, "w": 56, "h": 20}},
        {"id": "l4", "type": "extend", "from": "voucher", "to": "checkout", "condition": "customer has a code",
         "extensionPoint": "Payment", "points": [[460, 125], [345, 210]], "labelBox": {"x": 374, "y": 157, "w": 56, "h": 20}},
        {"id": "l5", "type": "association", "from": "pay", "to": "psp", "points": [[600, 235], [700, 225]]},
    ],
    "canvas": {"width": 800, "height": 380},
}


def audit(**changes):
    d = copy.deepcopy(BASE)
    d.update(changes)
    report = UsecaseAudit(d).verify_collisions()
    return report["issues"], report


def uc(uid, x, y, **extra):
    return {"id": uid, "name": extra.pop("name", f"Browse {uid}"), "subject": "shop", "x": x, "y": y, "w": 160, "h": 70, **extra}


def ucs(*extra, drop=()):
    """BASE use cases plus `extra`, without the ids in `drop`."""
    return [u for u in copy.deepcopy(BASE["useCases"]) if u["id"] not in drop] + list(extra)


def link(lid, kind, a, b, points=None, **extra):
    return {"id": lid, "type": kind, "from": a, "to": b, "points": points or [[0, 0], [1, 1]], **extra}


def with_links(*extra, drop=()):
    return [lk for lk in copy.deepcopy(BASE["links"]) if lk["id"] not in drop] + list(extra)


def edit_link(lid, **changes):
    return [{**lk, **changes} if lk["id"] == lid else lk for lk in copy.deepcopy(BASE["links"])]


def edit_uc(uid, **changes):
    return [{**u, **changes} if u["id"] == uid else u for u in copy.deepcopy(BASE["useCases"])]


def edit_actor(aid, **changes):
    return [{**a, **changes} if a["id"] == aid else a for a in copy.deepcopy(BASE["actors"])]


def tall(n):
    """n extra use cases below the base ones, each a specialization of 'browse' (so reached), in a taller subject."""
    extra = [uc(f"x{i}", 200 + 170 * (i % 2), 400 + 80 * (i // 2), parent="browse", name=f"Browse topic {i}") for i in range(n)]
    h = 420 + 80 * (n // 2 + 1)
    return dict(useCases=ucs(*extra), subjects=[{**BASE["subjects"][0], "h": h - 20}], canvas={"width": 800, "height": h + 20})


# Errors: (name, changes, expected substring of an issue, or None for no issue)
CASES = [
    ("the base diagram is valid", {}, None),
    ("a diagram that is not laid out", dict(useCases=[{k: v for k, v in u.items() if k not in "xywh"} for u in BASE["useCases"]]), "not laid out"),
    ("a collapsed use case has no box and is valid", dict(useCases=edit_uc("voucher", _hidden=True, w=0, h=0),
                                                         links=with_links(drop=("l4",))), None),
    # Structure
    ("duplicate actor id", dict(actors=BASE["actors"] + [{**BASE["actors"][0]}]), "Duplicate actor id 'customer'"),
    ("an actor and a use case with one id", dict(actors=BASE["actors"] + [{**BASE["actors"][0], "id": "browse"}]), "Duplicate use case id 'browse'"),
    ("duplicate link id", dict(links=with_links(copy.deepcopy(BASE["links"][0]))), "Duplicate link id 'l1'"),
    ("unknown actor kind", dict(actors=edit_actor("psp", kind="robot")), "unknown kind 'robot'"),
    ("unknown actor side", dict(actors=edit_actor("psp", side="top")), "unknown side 'top'"),
    ("unknown level", dict(useCases=edit_uc("pay", level="epic")), "unknown level 'epic'"),
    ("level subfunction is valid", dict(useCases=edit_uc("pay", level="subfunction")), None),
    ("unknown colour", dict(useCases=edit_uc("pay", color="pink")), "unknown color 'pink'"),
    ("a palette slot is a valid colour", dict(useCases=edit_uc("pay", color="1"), colorKey={"1": "Payments"}), None),
    ("an unknown link type", dict(links=edit_link("l1", type="uses")), "unknown type 'uses'"),
    ("showRefs is not a boolean", dict(showRefs="yes"), "'showRefs' must be true or false"),
    ("a use case with no subject among two subjects",
     dict(subjects=BASE["subjects"] + [{"id": "office", "name": "Back office", "x": 700, "y": 20, "w": 10, "h": 10}],
          useCases=edit_uc("pay", subject=None)), "has no 'subject'"),
    # Unknown ids
    ("link from an unknown id", dict(links=edit_link("l1", **{"from": "ghost"})), "from unknown id 'ghost'"),
    ("link to an unknown id", dict(links=edit_link("l1", to="ghost")), "to unknown id 'ghost'"),
    ("use case in an unknown subject", dict(useCases=edit_uc("pay", subject="ghost")), "unknown subject 'ghost'"),
    ("actor with an unknown parent", dict(actors=edit_actor("customer", parent="ghost")), "parent unknown actor 'ghost'"),
    ("use case with an unknown parent", dict(useCases=edit_uc("pay", parent="ghost")), "parent unknown use case 'ghost'"),
    ("note on an unknown use case", dict(notes=[{"id": "n1", "text": "t", "useCases": ["ghost"]}]), "unknown use case 'ghost'"),
    ("note on an unknown actor", dict(notes=[{"id": "n1", "text": "t", "actors": ["ghost"]}]), "unknown actor 'ghost'"),
    ("note on a known use case and actor is valid", dict(notes=[{"id": "n1", "text": "t", "useCases": ["pay"], "actors": ["psp"]}]), None),
    ("a note without text", dict(notes=[{"id": "n1", "text": " ", "useCases": ["pay"]}]), "has no text"),
    ("a known actor parent is valid", dict(actors=BASE["actors"] + [{"id": "member", "name": "Member", "parent": "customer",
                                                                       "x": 20, "y": 230, "w": 80, "h": 100}]), None),
    # Link kinds
    ("association between two actors", dict(links=edit_link("l1", to="psp")), "not between an actor and a use case"),
    ("association between two use cases", dict(links=edit_link("l1", **{"from": "browse", "to": "pay"})), "not between an actor and a use case"),
    ("association drawn use case to actor is valid", dict(links=edit_link("l1", **{"from": "browse", "to": "customer"})), None),
    ("include from an actor", dict(links=edit_link("l3", **{"from": "customer"})), "not between two use cases"),
    ("extend to an actor", dict(links=edit_link("l4", to="customer", extensionPoint=None)), "not between two use cases"),
    # Cycles
    ("an include cycle of two",
     dict(links=with_links(link("l6", "include", "pay", "checkout", [[440, 250], [360, 250]]))), "include cycle"),
    ("an include cycle of three",
     dict(links=with_links(link("l6", "include", "pay", "voucher", [[520, 200], [520, 130]]), link("l7", "include", "voucher", "checkout",
                                                                                                    [[440, 100], [360, 210]]))),
     "include cycle"),
    ("an include of itself", dict(links=with_links(link("l6", "include", "pay", "pay"))), "include cycle"),
    ("include in a line without a cycle is valid",
     dict(links=with_links(link("l6", "include", "voucher", "pay", [[520, 130], [520, 200]]))), None),
    ("an actor parent cycle",
     dict(actors=[{**a, "parent": "psp"} if a["id"] == "customer" else {**a, "parent": "customer"} for a in BASE["actors"]]), "parent cycle (actor)"),
    ("a use case parent cycle",
     dict(useCases=[{**u, "parent": "pay"} if u["id"] == "browse" else {**u, "parent": "browse"} if u["id"] == "pay" else u
                    for u in BASE["useCases"]]), "parent cycle (use case)"),
    # Extension points
    ("an extensionPoint the base does not list", dict(links=edit_link("l4", extensionPoint="Delivery")), "not an extension point of 'checkout'"),
    ("an extensionPoint the base lists is valid", dict(links=edit_link("l4", extensionPoint="Payment")), None),
    ("an extend without extensionPoint is valid", dict(links=edit_link("l4", extensionPoint=None)), None),
    # Geometry
    ("two ellipses overlap", dict(useCases=edit_uc("pay", x=300, y=210)), "Use cases 'checkout' and 'pay' overlap"),
    ("ellipses whose boxes overlap at the corners are valid",
     dict(useCases=edit_uc("pay", x=330, y=140), links=with_links(drop=("l3", "l4", "l5"))), None),
    ("ellipses that touch are valid", dict(useCases=edit_uc("pay", x=360, y=200), links=with_links(drop=("l3", "l5"))), None),
    ("two actors overlap", dict(actors=edit_actor("psp", x=40, y=150)), "Actors 'customer' and 'psp' overlap"),
    ("an actor on a use case", dict(actors=edit_actor("customer", x=150, y=220)), "overlaps use case 'checkout'"),
    ("an actor inside a boundary", dict(actors=edit_actor("psp", x=560, y=300)), "sits inside subject 'shop'"),
    ("a use case outside its subject", dict(useCases=edit_uc("voucher", x=600, y=60)), "is not inside its subject 'shop'"),
    ("an ellipse past the canvas edge", dict(canvas={"width": 600, "height": 380}), "extends past the diagram edge"),
    ("a line through another ellipse",
     dict(links=edit_link("l1", points=[[100, 160], [520, 95]])), "passes through use case 'voucher'"),
    ("a curve through another ellipse",
     dict(links=edit_link("l2", points=[[100, 180], [300, 10], [345, 235]])), "passes through use case 'browse'"),
    ("a curve that bends clear of ellipses is valid", dict(links=edit_link("l2", points=[[100, 180], [140, 215], [205, 225]])), None),
    ("a line through an actor",
     dict(links=edit_link("l5", points=[[600, 235], [60, 150]])), "passes through actor 'customer'"),
    ("a line that ends on its own ellipse is valid", dict(links=edit_link("l1", points=[[100, 140], [280, 85]])), None),
    ("a malformed route", dict(links=edit_link("l1", points=[[100, "x"], [203, 95]])), "malformed route"),
    ("two labels overlap", dict(links=edit_link("l4", labelBox={"x": 380, "y": 225, "w": 56, "h": 20})), "Labels of links 'l3' and 'l4' overlap"),
    ("a label over an ellipse", dict(links=edit_link("l3", labelBox={"x": 330, "y": 200, "w": 56, "h": 20})), "sits over use case 'checkout'"),
    ("a label over an actor", dict(links=edit_link("l3", labelBox={"x": 30, "y": 130, "w": 56, "h": 20})), "sits over actor 'customer'"),
    ("a malformed labelBox", dict(links=edit_link("l3", labelBox={"x": 1})), "malformed labelBox"),
    ("a generalization line through an ellipse",
     dict(**{"_parents": [{"from": "pay", "to": "voucher", "kind": "useCase", "points": [[520, 200], [280, 85]]}]}),
     "Generalization 'pay' to 'voucher' passes through use case 'browse'"),
]

# Warnings go to budget_warnings and never change the score: (name, changes, expected substring of a warning, or None for none)
WARNINGS = [
    ("the base diagram has no warnings", {}, None),
    ("an actor with no association", dict(links=with_links(drop=("l5",))), "Actor 'psp' has no association"),
    ("an actor that reaches a use case through its parent is fine",
     dict(actors=BASE["actors"] + [{"id": "member", "name": "Member", "parent": "customer", "x": 20, "y": 230, "w": 80, "h": 100}]), None),
    ("an abstract actor with no association is fine",
     dict(actors=BASE["actors"] + [{"id": "person", "name": "Person", "abstract": True, "x": 20, "y": 250, "w": 80, "h": 100}]), None),
    ("a use case no actor reaches", dict(useCases=ucs(uc("lonely", 200, 290, name="Archive orders"))), "Use case 'lonely' is not reached"),
    ("use cases reached only through include (pay) and extend (voucher) are fine",
     dict(links=with_links(drop=("l5",)), actors=[BASE["actors"][0]]), None),
    ("a use case reached through its parent is fine", dict(useCases=ucs(uc("lonely", 200, 290, name="Archive orders", parent="browse"))), None),
    ("an include chain of 3 hops",
     dict(useCases=ucs(uc("a", 200, 290, name="Add item"), uc("b", 440, 290, name="Add tax")),
          links=with_links(link("l6", "include", "pay", "a"), link("l7", "include", "a", "b"), link("l8", "association", "customer", "a"))),
     "this is a flow"),
    ("an include chain of 2 hops is fine",
     dict(useCases=ucs(uc("a", 200, 290, name="Add item")), links=with_links(link("l6", "include", "pay", "a"), link("l8", "association", "customer", "a"))),
     None),
    ("a long actor name is fine (cut with a hover tip)", dict(actors=edit_actor("psp", name="x" * 25)), None),
    ("a long use case name is fine", dict(useCases=edit_uc("pay", name="Take " + "x" * 36)), None),
    ("a long condition is fine", dict(links=edit_link("l4", condition="x" * 41)), None),
    ("a ref over 12 characters", dict(useCases=edit_uc("pay", refs=["FR-1", "x" * 13])), "Ref 'xxxxxxxxxxxxx'"),
    ("a ref of 12 characters is fine", dict(useCases=edit_uc("pay", refs=["x" * 12])), None),
    ("a note over 120 characters", dict(notes=[{"id": "n1", "text": "x" * 121, "useCases": ["pay"]}]), "Note 'n1' is over 120"),
    ("a note of 120 characters is fine", dict(notes=[{"id": "n1", "text": "x" * 120, "useCases": ["pay"]}]), None),
    ("13 use cases and no colour", tall(9), "none has a 'color'"),
    ("12 use cases and no colour is fine", tall(8), None),
    ("13 use cases with one coloured is fine",
     {**tall(9), "useCases": [{**u, "color": "1"} if u["id"] == "pay" else u for u in tall(9)["useCases"]], "colorKey": {"1": "Payments"}}, None),
    ("a colour with no colorKey entry", dict(useCases=edit_uc("pay", color="1")), "does not say what it means"),
    ("a custom hex warns that its contrast is not checked",
     dict(useCases=edit_uc("pay", color="#123456"), colorKey={"#123456": "Payments"}), "contrast is not checked"),
]

# Info lines go to report["info"]: (name, changes, expected substring of an info line, or None for no info)
INFO = [
    ("the base diagram has no info lines", {}, None),
    ("an include with a single base",
     dict(useCases=ucs(uc("a", 200, 290, name="Add item")), links=with_links(link("l6", "include", "checkout", "a", [[280, 270], [280, 290]]))),
     "Use case 'a' is included only by 'checkout'"),
    ("an included use case with two bases is fine",
     dict(useCases=ucs(uc("a", 200, 290, name="Add item")),
          links=with_links(link("l6", "include", "checkout", "a"), link("l7", "include", "browse", "a"))), None),
    ("an included use case an actor also uses is fine",
     dict(useCases=ucs(uc("a", 200, 290, name="Add item")),
          links=with_links(link("l6", "include", "checkout", "a"), link("l8", "association", "customer", "a"))), None),
    ("a name that does not start with a verb", dict(useCases=edit_uc("pay", name="Payment")), "does not start with a verb"),
    ("a name that starts with a listed verb is fine", dict(useCases=edit_uc("pay", name="Refund payment")), None),
]


def main() -> int:
    parser = argparse.ArgumentParser(description="Unit cases for the use case diagram audit rules.")
    parser.add_argument("-v", "--verbose", action="store_true", help="Print passing cases")
    args = parser.parse_args()
    failed = 0
    total = 0

    def check(name: str, ok: bool, detail: object = "") -> None:
        nonlocal failed, total
        total += 1
        failed += not ok
        if not ok or args.verbose:
            tail = "" if ok or detail == "" else f" - {detail}"
            print(f"[{'PASS' if ok else 'FAIL'}] {name}{tail}")

    for name, changes, expect in CASES:
        issues, report = audit(**changes)
        ok = not issues if expect is None else any(expect in i for i in issues)
        check(name, ok, f"issues: {issues}")
    for name, changes, expect in WARNINGS:
        issues, report = audit(**changes)
        warnings = report["budget_warnings"]
        ok = (not warnings) if expect is None else any(expect in w for w in warnings)
        ok = ok and report["score"] == 100 - 12 * len(issues)  # warnings never change the score
        check(f"warning: {name}", ok, f"warnings: {warnings} issues: {issues}")
    for name, changes, expect in INFO:
        issues, report = audit(**changes)
        info = report["info"]
        ok = (not info) if expect is None else any(expect in i for i in info)
        ok = ok and not report["budget_warnings"] and not issues  # info lines are never a warning or an error
        check(f"info: {name}", ok, f"info: {info} warnings: {report['budget_warnings']} issues: {issues}")
    # Report shape, summary and the clean pass line
    audit_obj = UsecaseAudit(copy.deepcopy(BASE))
    report = audit_obj.verify_collisions()
    ok = ({"passed", "score", "grade", "issues", "budget_warnings", "info"} <= set(report) and report["passed"] and report["score"] == 100
          and report["grade"] == "A+" and audit_obj.pass_line(report).startswith("[PASS] Layout clean.")
          and UsecaseAudit.title == "Use Case Diagram"
          and audit_obj.summary_lines(report)[0].startswith("Structure: 2 Actors | 4 Use cases | 5 Links"))
    check("report shape, pass line and summary", ok, str(report))
    # An error costs 12 points, and a score under 90 does not pass
    _, report = audit(links=edit_link("l1", **{"from": "ghost"}) + [link("l9", "association", "customer", "ghost")])
    ok = report["score"] == 100 - 12 * len(report["issues"]) and not report["passed"]
    check("score is 100 minus 12 per error", ok, str(report["score"]))
    # An implicit subject (no `subjects`, boxes in _subjects) is checked like a named one
    implicit = copy.deepcopy(BASE)
    implicit.pop("subjects")
    implicit["_subjects"] = [{"id": "_main", "name": "Shop", "x": 160, "y": 20, "w": 480, "h": 340}]
    for u in implicit["useCases"]:
        u.pop("subject")
    report = UsecaseAudit(implicit).verify_collisions()
    implicit["actors"][1].update(x=560, y=300)
    report2 = UsecaseAudit(implicit).verify_collisions()
    ok = not report["issues"] and any("sits inside subject '_main'" in i for i in report2["issues"])
    check("implicit subject _main", ok, f"{report['issues']} {report2['issues']}")

    codec_tests(check)
    print(f"{total - failed}/{total} cases passed")
    return 2 if failed else 0


def codec_tests(check) -> None:
    from disk_format import format_json, from_disk, to_disk, authoring_json

    laid = copy.deepcopy(BASE)
    laid.update(showNotes=True, showRefs=False, colorKey={"#e0f2fe": "Ordering"}, notes=[{"id": "n1", "text": "t", "useCases": ["checkout"], "_x": 1}])
    laid["useCases"][1]["color"] = "#e0f2fe"
    laid["useCases"][0]["_lines"] = ["Browse", "catalogue"]
    laid["actors"][0]["_side"] = "left"
    laid["_subjects"] = [{"id": "_main"}]
    laid["_parents"] = [{"from": "a", "to": "b", "kind": "actor", "points": [[0, 0], [1, 1]]}]
    laid["links"][0]["curve"] = None
    laid["schemaVersion"] = 1
    disk = to_disk("usecase", laid)
    check("codec: key order and schemaVersion",
          list(disk) == ["diagramType", "schemaVersion", "title", "showRefs", "showNotes", "colorKey", "subjects", "actors",
                         "useCases", "links", "notes", "layout"] and disk["schemaVersion"] == 1, list(disk))
    check("codec: derived fields are dropped",
          "canvas" not in disk and "_subjects" not in disk and "_parents" not in disk
          and all(k not in o for o in disk["subjects"] for k in ("x", "y", "w", "h"))
          and all(k not in o for o in disk["actors"] + disk["useCases"] for k in ("x", "y", "w", "h", "_lines", "_side"))
          and all(k not in lk for lk in disk["links"] for k in ("points", "labelBox")) and "_x" not in disk["notes"][0], disk)
    check("codec: layout holds actors then use cases, positions only",
          list(disk["layout"]) == ["customer", "psp", "browse", "checkout", "pay", "voucher"]
          and disk["layout"]["checkout"] == {"x": 200, "y": 200}, disk["layout"])
    check("codec: colours become slots", disk["colorKey"] == {"1": "Ordering"} and disk["useCases"][1]["color"] == "1")
    back = from_disk("usecase", disk)
    check("codec: round trip puts the positions back and is stable",
          "layout" not in back and (back["actors"][1]["x"], back["useCases"][1]["y"]) == (700, 200)
          and to_disk("usecase", back) == disk and format_json(to_disk("usecase", back)) == format_json(disk))
    check("codec: a block with another schemaVersion drops its layout",
          "x" not in from_disk("usecase", {**disk, "schemaVersion": 2})["actors"][0])
    check("codec: a block with no schemaVersion keeps its layout",
          from_disk("usecase", {k: v for k, v in disk.items() if k != "schemaVersion"})["actors"][0]["x"] == 20)
    check("codec: --extract JSON has no layout", "layout" not in authoring_json("usecase", laid) and "x" not in authoring_json("usecase", laid)["actors"][0])
    check("codec: _readme survives to_disk", to_disk("usecase", {**laid, "_readme": "r"}).get("_readme") == "r")

    gen = {
        "diagramType": "usecase",
        "subjects": [{"id": "s_170000000000001", "name": "Back Office"}],
        "actors": [{"id": "a_170000000000002", "name": "Warehouse clerk", "x": 1, "y": 2},
                   {"id": "a_170000000000003_1", "name": "Warehouse clerk", "parent": "a_170000000000002", "x": 3, "y": 4},
                   {"id": "keep", "name": "Authored", "x": 5, "y": 6}],
        "useCases": [{"id": "u_170000000000004", "name": "Pick order!", "subject": "s_170000000000001", "x": 7, "y": 8},
                     {"id": "u_170000000000005", "name": "Pack order", "subject": "s_170000000000001", "parent": "u_170000000000004", "x": 9, "y": 10}],
        "links": [{"id": "l_170000000000006", "type": "association", "from": "a_170000000000002", "to": "u_170000000000004"},
                  {"id": "l1", "type": "include", "from": "u_170000000000004", "to": "u_170000000000005"},
                  {"id": "l_170000000000007", "type": "association", "from": "keep", "to": "u_170000000000005"}],
        "notes": [{"id": "n_170000000000008", "text": "t", "useCases": ["u_170000000000004"], "actors": ["a_170000000000002"]}],
    }
    g = to_disk("usecase", gen)
    ids = [o["id"] for k in ("subjects", "actors", "useCases", "links", "notes") for o in g[k]]
    check("codec: editor ids become name slugs, l<N> and n<N>; a taken name gets a suffix; authored ids stay",
          ids == ["back_office", "warehouse_clerk", "warehouse_clerk_2", "keep", "pick_order", "pack_order", "l2", "l1", "l3", "n1"], ids)
    check("codec: every reference follows a rename",
          g["actors"][1]["parent"] == "warehouse_clerk" and g["useCases"][0]["subject"] == "back_office"
          and g["useCases"][1]["parent"] == "pick_order"
          and (g["links"][0]["from"], g["links"][0]["to"]) == ("warehouse_clerk", "pick_order")
          and (g["links"][1]["from"], g["links"][1]["to"]) == ("pick_order", "pack_order")
          and g["notes"][0]["useCases"] == ["pick_order"] and g["notes"][0]["actors"] == ["warehouse_clerk"], g)
    check("codec: layout keys are the renamed ids", list(g["layout"]) == ["warehouse_clerk", "warehouse_clerk_2", "keep", "pick_order", "pack_order"]
          and g["layout"]["pack_order"] == {"x": 9, "y": 10}, g["layout"])
    check("codec: saving twice changes nothing", to_disk("usecase", from_disk("usecase", g)) == g)


if __name__ == "__main__":
    sys.exit(main())
