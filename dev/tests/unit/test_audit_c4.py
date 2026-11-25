#!/usr/bin/env python3
"""Unit cases for the C4 audit rules (scripts/audit_c4.py): each rule has one failing case and one passing case. Inputs
are laid out by hand (logical JSON), so no engine is needed.

Usage: python dev/test_audit_c4.py
Exit codes: 0 all passed, 2 a case failed.
"""

from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
import audit_c4  # noqa: E402
from audit_c4 import C4Audit  # noqa: E402
from build_icon_pack import installed_packs  # noqa: E402

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


def main():
    FAILED.clear()
    check("base passes", run()["passed"] and not run()["issues"])
    check("base has no warnings", not run()["budget_warnings"])

    # Errors.
    err("duplicate id", lambda d: d["elements"].append({"id": "api", "kind": "system", "name": "x"}), "Duplicate id 'api'")
    err("duplicate id across group and element", lambda d: d["elements"].append({"id": "shopco", "kind": "system", "name": "x"}), "Duplicate id 'shopco'")
    no_err("unique ids", None, "Duplicate")
    err("unknown relation target", lambda d: d["relations"].append({"from": "api", "to": "ghost", "label": "x"}), "unknown id 'ghost'")
    err("relation from descendant to ancestor group", lambda d: d["relations"].append({"from": "api", "to": "platform", "label": "x"}), "own descendant")
    err("relation from transitive descendant to ancestor group", lambda d: d["relations"].append({"from": "api", "to": "shopco", "label": "x"}), "own descendant")
    err("relation from parent group to child group", lambda d: d["relations"].append({"from": "shopco", "to": "platform", "label": "x"}), "own descendant")
    err("relation from child group to parent group", lambda d: d["relations"].append({"from": "platform", "to": "shopco", "label": "x"}), "own descendant")
    err("group self relation", lambda d: d["relations"].append({"from": "shopco", "to": "shopco", "label": "Loops"}), "to itself")
    no_err("known relation ends", None, "unknown id")
    no_err("mixed element-to-group relation", lambda d: d["relations"].append({"from": "cust", "to": "platform", "label": "Uses"}), "unknown id")
    no_err("group-to-group relation",
           lambda d: (d["groups"].append({"id": "ext", "name": "Ext", "kind": "boundary"}),
                      d["relations"].append({"from": "shopco", "to": "ext", "label": "Calls"})),
           "unknown id")
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
    warn("long step badge", lambda d: d["relations"][0].update(step="123456789"), "over 8 characters")
    no_warn("step badge within budget", lambda d: d["relations"][0].update(step="2a"), "over 8 characters")
    no_warn("step badge at exact limit", lambda d: d["relations"][0].update(step="12345678"), "over 8 characters")
    err("empty step badge", lambda d: d["relations"][0].update(step="  "), "empty 'step'")
    warn("duplicate relation", lambda d: d["relations"].append({"from": "cust", "to": "api", "label": "Orders"}), "appears twice")
    no_warn("same pair, other label", lambda d: d["relations"].append({"from": "cust", "to": "api", "label": "Browses"}), "twice")
    aws = lambda d: d["elements"][1].update(icon="logo:aws/s3")
    warn("missing icon pack", aws, "pack 'aws'")
    no_warn("installed icon pack", aws, "pack", packs=["aws"])
    bundled_packs = installed_packs([ROOT / "assets" / "logos"])
    check("bundled devicon pack installed", "devicon" in bundled_packs)
    no_warn("bundled devicon logo", lambda d: d["elements"][1].update(icon="logo:devicon/postgresql"), "pack", packs=bundled_packs)
    no_warn("generic icon", lambda d: d["elements"][1].update(icon="server"), "pack")

    # Arrange.
    err("unknown arrange", lambda d: d.update(arrange="radial"), "Unknown arrange 'radial'")
    no_err("known arrange", lambda d: d.update(arrange="surround"), "Unknown arrange")
    err("unknown layerDirection", lambda d: d.update(arrange="layers", layerDirection="diagonal"), "Unknown layerDirection 'diagonal'")
    err("relation to itself", lambda d: d["relations"].append({"from": "api", "to": "api", "label": "Loops"}), "to itself")
    no_err("relations between two elements", None, "to itself")

    def layers(d, loose=False, skip=False, vertical=False, group_links=False, shared=False, span=None):
        d["arrange"] = "layers"
        if vertical:
            d["layerDirection"] = "vertical"
        d["groups"] = [{"id": "top", "name": "Top", "kind": "boundary"}, {"id": "mid", "name": "Mid", "kind": "boundary"},
                       {"id": "low", "name": "Low", "kind": "boundary"}, {"id": "sub", "name": "Sub", "kind": "boundary", "parent": "low"}]
        d["elements"] = [{"id": "a", "kind": "system", "name": "A", "group": "top"}, {"id": "b", "kind": "system", "name": "B", "group": "mid"},
                         {"id": "c", "kind": "system", "name": "C", "group": "sub"}]
        if group_links:
            d["relations"] = [{"from": "top", "to": "mid", "label": "Feeds", "step": "1"},
                              {"from": "mid", "to": "low", "label": "Stores", "step": "2"}]
        else:
            d["relations"] = [{"from": "a", "to": "b", "label": "Calls"}, {"from": "b", "to": "c", "label": "Calls"}]
        if shared:
            sg = {"id": "obs", "name": "Observability", "kind": "boundary", "shared": True, "side": "S"}
            if span is not None:
                sg["span"] = span
            d["groups"].append(sg)
            d["elements"].append({"id": "mon", "kind": "system", "name": "Monitor", "group": "obs"})
        if loose:
            d["elements"].append({"id": "x", "kind": "external", "name": "X"})
            d["relations"].append({"from": "c", "to": "x", "label": "Calls"})
        if skip:
            d["relations"].append({"from": "a", "to": "c", "label": "Skips"})

    err("layers with an element outside a top-level group", lambda d: layers(d, loose=True), "'x' is not in a top-level group")
    no_err("layers with every element in a band", layers, "top-level group")
    no_warn("layers with a relation that skips a layer produces no warning", lambda d: layers(d, skip=True), "skips a layer")
    check("layers with skipped relation passes cleanly", run(lambda d: layers(d, skip=True))["passed"]
          and not run(lambda d: layers(d, skip=True))["budget_warnings"])
    no_warn("elements connected via layer-to-layer relation do not warn", lambda d: layers(d, group_links=True), "has no relation")
    check("layer-to-layer vertical pipeline passes cleanly",
          run(lambda d: layers(d, vertical=True, group_links=True, shared=True, span=["top", "mid"]))["passed"]
          and not run(lambda d: layers(d, vertical=True, group_links=True, shared=True, span=["top", "mid"]))["budget_warnings"])
    no_warn("elements inside shared layer do not warn", lambda d: layers(d, shared=True), "has no relation")
    no_err("valid contiguous span (reversed order)", lambda d: layers(d, shared=True, span=["mid", "top"]), "contiguous")
    err("non-contiguous span", lambda d: layers(d, shared=True, span=["top", "low"]), "not contiguous")
    err("span referencing nested group", lambda d: layers(d, shared=True, span=["sub"]), "not a top-level non-shared layer")
    err("span referencing shared group", lambda d: layers(d, shared=True, span=["obs"]), "not a top-level non-shared layer")
    err("span referencing unknown group", lambda d: layers(d, shared=True, span=["ghost"]), "not a top-level non-shared layer")
    err("empty span", lambda d: layers(d, shared=True, span=[]), "invalid span")
    err("shared group with parent",
        lambda d: (layers(d), d["groups"][3].update(shared=True)), "must be top-level")
    err("shared group with kind system",
        lambda d: (layers(d), d["groups"].append({"id": "shsys", "name": "S", "kind": "system", "shared": True})), "kind 'system'")
    err("non-boolean shared",
        lambda d: (layers(d), d["groups"][0].update(shared="yes")), "non-boolean shared")

    no_err("loose element outside layers", None, "top-level group")
    warn("core on an element with no relation", lambda d: d["elements"].append({"id": "lone", "kind": "system", "name": "L", "core": True}), "'lone' is marked core")
    warn("core on a group with no relation", lambda d: (d["groups"].append({"id": "empty", "name": "E", "kind": "boundary", "core": True}),
                                                        d["elements"].append({"id": "q", "kind": "system", "name": "Q", "group": "empty"})),
         "'empty' is marked core")
    no_warn("core on a related element", lambda d: d["elements"][1].update(core=True), "marked core")
    no_warn("core on a group whose member has relations", lambda d: d["groups"][1].update(core=True), "marked core")
    check("info names the default layout flow", has(run()["info"], "Layout: flow"))
    check("info names the default layout surround", has(run(lambda d: d["elements"][0].update(core=True))["info"], "Layout: surround"))
    check("info names the chosen layout", has(run(lambda d: d.update(arrange="flow"))["info"], "Layout: flow.")
          and has(run(layers)["info"], "Layout: layers.")
          and has(run(lambda d: layers(d, vertical=True))["info"], "Layout: layers (vertical)."))
    check("info notes unused layerDirection outside layers",
          has(run(lambda d: d.update(arrange="flow", layerDirection="vertical"))["info"], "only applies when arrange is 'layers'"))
    check("info notes unused shared group outside layers",
          has(run(lambda d: (d.update(arrange="flow"), d["groups"][0].update(shared=True)))["info"], "only apply when arrange is 'layers'"))

    # Info: the level it opens at.
    check("info level 2", has(run()["info"], "Level 2"))
    check("info level 1", has(run(lambda d: d["groups"][1].update(collapsed=True))["info"], "Level 1"))
    check("data_issues mirrors errors (the page assembler reads it)", run(lambda d: d["relations"][0].update(label=""))["data_issues"] == run(lambda d: d["relations"][0].update(label=""))["issues"] != [])

    if FAILED:
        print(f"{len(FAILED)} case(s) failed")
        return 2
    print("test_audit_c4: all cases passed")
    return 0


class TestAuditC4(unittest.TestCase):
    def test_audit_c4(self):
        self.assertEqual(main(), 0)


if __name__ == "__main__":
    sys.exit(main())
