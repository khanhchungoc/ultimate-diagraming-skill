#!/usr/bin/env python3
"""Unit cases for the C4 audit rules (scripts/audit_c4.py): each rule has one failing case and one passing case. Inputs
are laid out by hand (logical JSON), so no engine is needed.

Usage: python dev/test_audit_c4.py
Exit codes: 0 all passed, 2 a case failed.
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import audit_c4  # noqa: E402
from audit_c4 import C4Audit  # noqa: E402

BASE = {
    "diagramType": "c4",
    "groups": [
        {"id": "shopco", "name": "ShopCo", "kind": "boundary"},
        {"id": "platform", "name": "Platform", "kind": "system", "parent": "shopco"},
    ],
    "elements": [
        {"id": "cust", "kind": "person", "name": "Customer"},
        {"id": "api", "kind": "container", "name": "API", "group": "platform"},
        {"id": "db", "kind": "database", "name": "DB", "group": "platform"},
        {"id": "pay", "kind": "external", "name": "Payments"},
    ],
    "relations": [
        {"from": "cust", "to": "api", "label": "Orders", "tech": "HTTPS"},
        {"from": "api", "to": "db", "label": "Reads and writes"},
        {"from": "api", "to": "pay", "label": "Charges cards"},
    ],
}

FAILED = []


def run(mutate=None, packs=()):
    d = copy.deepcopy(BASE)
    if mutate:
        mutate(d)
    return C4Audit(d, packs).verify_collisions()


def has(lst, text):
    return any(text in s for s in lst)


def check(name, ok):
    if not ok:
        FAILED.append(name)
        print(f"FAIL {name}")


def err(name, mutate, text):
    r = run(mutate)
    check(name + " (fails)", has(r["issues"], text) and not r["passed"])


def warn(name, mutate, text):
    check(name + " (warns)", has(run(mutate)["budget_warnings"], text))


def no_warn(name, mutate, text, packs=()):
    check(name + " (passes)", not has(run(mutate, packs)["budget_warnings"], text))


def no_err(name, mutate, text):
    check(name + " (passes)", not has(run(mutate)["issues"], text))


check("base passes", run()["passed"] and not run()["issues"])
check("base has no warnings", not run()["budget_warnings"])

# Errors.
err("duplicate id", lambda d: d["elements"].append({"id": "api", "kind": "system", "name": "x"}), "Duplicate id 'api'")
err("duplicate id across group and element", lambda d: d["elements"].append({"id": "shopco", "kind": "system", "name": "x"}), "Duplicate id 'shopco'")
no_err("unique ids", None, "Duplicate")
err("unknown relation target", lambda d: d["relations"].append({"from": "api", "to": "ghost", "label": "x"}), "unknown id 'ghost'")
err("relation to a group", lambda d: d["relations"].append({"from": "api", "to": "platform", "label": "x"}), "unknown id 'platform'")
no_err("known relation ends", None, "unknown id")
err("group cycle", lambda d: d["groups"][0].update(parent="platform"), "parent cycle")
no_err("acyclic groups", None, "cycle")
err("element in two groups", lambda d: d["elements"][1].update(group=["platform", "shopco"]), "2 groups")
no_err("element in one group", None, "2 groups")
err("relation without label", lambda d: d["relations"][0].pop("label"), "has no label")
err("relation with blank label", lambda d: d["relations"][0].update(label="  "), "has no label")
no_err("labelled relations", None, "no label")
err("nesting too deep",
    lambda d: d["groups"].append({"id": "inner", "name": "Inner", "kind": "system", "parent": "platform"}), "at most 2 deep")
no_err("depth 2", None, "deep")
err("container group kind", lambda d: d["groups"][1].update(kind="container"), "container groups arrive with Level 3")
no_err("boundary and system kinds", None, "kind")


# Raising MAX_GROUP_DEPTH is the only change that accepts system > container > component.
def level3(d):
    d["groups"][1].pop("parent")
    d["groups"].append({"id": "cart", "name": "Cart", "kind": "container", "parent": "platform"})
    d["elements"].append({"id": "cmp", "kind": "component", "name": "Cart", "group": "cart"})
    d["relations"].append({"from": "cmp", "to": "db", "label": "Stores", "tech": "SQL"})


check("level 3 rejected at the v1 limit", has(run(level3)["issues"], "container groups arrive with Level 3"))
old = audit_c4.MAX_GROUP_DEPTH
try:
    audit_c4.MAX_GROUP_DEPTH = 3
    r = run(level3)
    check("level 3 accepted when the limit is raised", r["passed"] and not r["issues"])

    def too_deep(d):
        level3(d)
        d["groups"].append({"id": "z", "name": "Z", "kind": "system", "parent": "cart"})
        d["groups"].append({"id": "y", "name": "Y", "kind": "system", "parent": "z"})

    check("depth 4 rejected at limit 3", has(run(too_deep)["issues"], "at most 3 deep"))
finally:
    audit_c4.MAX_GROUP_DEPTH = old
check("limit restored", audit_c4.MAX_GROUP_DEPTH == 2)


# Warns.
def cc(d, tech=None):
    d["elements"][2] = {"id": "db", "kind": "container", "name": "DB", "group": "platform"}
    if tech:
        d["relations"][1]["tech"] = tech


warn("container-to-container without tech", cc, "no 'tech'")
no_warn("container-to-container with tech", lambda d: cc(d, "SQL"), "no 'tech'")
warn("element with no relation", lambda d: d["elements"].append({"id": "lone", "kind": "system", "name": "L"}), "Element 'lone' has no relation")
warn("person with no relation", lambda d: d["elements"].append({"id": "p2", "kind": "person", "name": "P"}), "Person 'p2' has no relation")
no_warn("related elements", None, "no relation")
warn("external inside system group", lambda d: d["elements"][3].update(group="platform"), "External element 'pay'")
no_warn("external outside", None, "External element")


def crowd(d):
    for i in range(13):
        d["elements"].append({"id": f"k{i}", "kind": "container", "name": "K", "group": "platform"})
        d["relations"].append({"from": "api", "to": f"k{i}", "label": "Calls", "tech": "REST"})


warn("group with over 12 children", crowd, "has 15 children")
no_warn("collapsed crowded group", lambda d: (crowd(d), d["groups"][1].update(collapsed=True)), "children")
warn("long label", lambda d: d["relations"][0].update(label="x" * 41), "over 40 characters")
no_warn("short label", None, "characters")
warn("duplicate relation", lambda d: d["relations"].append({"from": "cust", "to": "api", "label": "Orders"}), "appears twice")
no_warn("same pair, other label", lambda d: d["relations"].append({"from": "cust", "to": "api", "label": "Browses"}), "twice")
aws = lambda d: d["elements"][1].update(icon="logo:aws/s3")
warn("missing icon pack", aws, "pack 'aws'")
no_warn("installed icon pack", aws, "pack", packs=["aws"])
no_warn("generic icon", lambda d: d["elements"][1].update(icon="server"), "pack")

# Info: the level it opens at.
check("info level 2", has(run()["info"], "Level 2"))
check("info level 1", has(run(lambda d: d["groups"][1].update(collapsed=True))["info"], "Level 1"))
check("data_issues mirrors errors (the page assembler reads it)", run(lambda d: d["relations"][0].update(label=""))["data_issues"] == run(lambda d: d["relations"][0].update(label=""))["issues"] != [])

if FAILED:
    print(f"{len(FAILED)} case(s) failed")
    sys.exit(2)
print("test_audit_c4: all cases passed")
