#!/usr/bin/env python3
"""Unit cases for the c4 disk codec (scripts/disk_format.py): round trip, derived fields, layout order, id renaming,
boundary validation and the fixtures under dev/fixtures/c4. No engine needed.

Usage: python dev/test_c4_codec.py
Exit codes: 0 all passed, 2 a case failed.
"""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from disk_format import format_json, from_disk, to_disk  # noqa: E402

KEYS = ["diagramType", "schemaVersion", "title", "showTech", "showNotes", "colorKey",
        "groups", "elements", "relations", "notes", "layout"]
failed = 0


def check(name, ok, detail=""):
    global failed
    failed += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + ("" if ok else f" - {detail}"))


def raises(model):
    try:
        to_disk("c4", model)
    except ValueError:
        return True
    return False


def laid():
    m = json.loads((ROOT / "dev/fixtures/c4/landscape.json").read_text(encoding="utf-8"))
    m.update(canvas={"w": 1, "h": 1}, showNotes=True, showTech=True, _band=1)
    for i, e in enumerate(m["elements"]):
        e.update(x=10 * i, y=5 * i, w=100, h=60, _lines=["a"])
    for i, g in enumerate(m["groups"]):
        g.update(x=1000 + i, y=2000 + i, w=300, h=200, _hidden=True)
    m["relations"][0].update(points=[[0, 0], [1, 1]], labelBox={"x": 1}, _k=1)
    m["notes"][0]["_x"] = 3
    return m


def main():
    m = laid()
    disk = to_disk("c4", m)
    check("key order and schemaVersion", list(disk) == [k for k in KEYS if k in disk]
          and disk["schemaVersion"] == 1 and list(disk)[-1] == "layout", list(disk))
    check("derived fields dropped",
          "canvas" not in disk and "_band" not in disk
          and all(k not in e for e in disk["elements"] for k in ("x", "y", "w", "h", "_lines"))
          and all(k not in g for g in disk["groups"] for k in ("w", "h", "_hidden"))
          and all(k not in r for r in disk["relations"] for k in ("points", "labelBox", "_k"))
          and "_x" not in disk["notes"][0], disk)
    check("layout lists elements then groups", list(disk["layout"]) == [o["id"] for o in m["elements"] + m["groups"]]
          and disk["layout"]["cust"] == {"x": 0, "y": 0}, list(disk["layout"]))
    back = from_disk("c4", disk)
    check("round trip restores positions and is stable", "layout" not in back
          and (back["elements"][1]["x"], back["groups"][2]["y"]) == (10, 2002)
          and to_disk("c4", back) == disk and format_json(to_disk("c4", back)) == format_json(disk))
    check("other schemaVersion drops layout", "x" not in from_disk("c4", {**disk, "schemaVersion": 2})["elements"][0])
    check("_readme survives", to_disk("c4", {**m, "_readme": "r"}).get("_readme") == "r")

    gen = {
        "diagramType": "c4",
        "groups": [{"id": "g_170000000000001", "name": "Order Platform", "kind": "system"},
                   {"id": "g_170000000000002", "name": "Inner", "kind": "boundary", "parent": "g_170000000000001"}],
        "elements": [{"id": "e_170000000000003", "kind": "person", "name": "Customer"},
                     {"id": "e_170000000000004", "kind": "container", "name": "Customer", "group": "g_170000000000002"},
                     {"id": "keep", "kind": "database", "name": "DB", "group": "g_170000000000001"}],
        "relations": [{"from": "e_170000000000003", "to": "e_170000000000004", "label": "Uses"},
                      {"from": "e_170000000000004", "to": "keep", "label": "Reads"}],
        "notes": [{"id": "n_170000000000005", "text": "t", "elements": ["e_170000000000003"], "groups": ["g_170000000000001"]}],
    }
    g = to_disk("c4", gen)
    ids = [o["id"] for k in ("groups", "elements", "notes") for o in g[k]]
    check("editor ids become slugs, n<N>, suffix on clash, authored kept",
          ids == ["order_platform", "inner", "customer", "customer_2", "keep", "n1"], ids)
    check("renamed ids are followed in every reference",
          g["groups"][1]["parent"] == "order_platform" and g["elements"][1]["group"] == "inner"
          and g["elements"][2]["group"] == "order_platform"
          and (g["relations"][0]["from"], g["relations"][0]["to"]) == ("customer", "customer_2")
          and g["notes"][0]["elements"] == ["customer"] and g["notes"][0]["groups"] == ["order_platform"], g)

    base = lambda: copy.deepcopy(json.loads((ROOT / "dev/fixtures/c4/landscape.json").read_text(encoding="utf-8")))  # noqa: E731
    bad = {}
    b = base(); b["elements"].append(copy.deepcopy(b["elements"][0])); bad["duplicate id"] = b
    b = base(); b["relations"][0]["to"] = "nope"; bad["relation to unknown id"] = b
    b = base(); b["relations"][0]["from"] = "platform"; bad["relation from a group"] = b
    b = base(); b["elements"][0]["group"] = "nope"; bad["unknown group"] = b
    b = base(); b["groups"][1]["parent"] = "nope"; bad["unknown parent"] = b
    b = base(); b["groups"][0]["parent"] = "platform"; bad["group cycle"] = b
    b = base(); b["groups"][0]["parent"] = "shopco"; bad["group is its own parent"] = b
    b = base(); b["elements"][0]["kind"] = "robot"; bad["unknown element kind"] = b
    b = base(); b["groups"][0]["kind"] = "zone"; bad["unknown group kind"] = b
    b = base(); b["notes"][0]["groups"] = ["nope"]; bad["note to unknown id"] = b
    for name, model in bad.items():
        check(f"rejects {name}", raises(model))
    deep = {"diagramType": "c4", "groups": [{"id": f"g{i}", "name": "G", "kind": "boundary", **({"parent": f"g{i-1}"} if i else {})}
                                            for i in range(6)], "elements": [], "relations": []}
    check("no depth limit in the codec", not raises(deep))
    check("blank diagram is valid", to_disk("c4", json.loads((ROOT / "assets/types/c4/blank.json").read_text(encoding="utf-8")))["groups"] == [])

    for p in sorted((ROOT / "dev/fixtures/c4").glob("*.json")) + [ROOT / "assets/types/c4/default.json"]:
        f = json.loads(p.read_text(encoding="utf-8"))
        check(f"{p.name}: disk form is a fixed point", to_disk("c4", from_disk("c4", f)) == f)
    print("all cases passed" if not failed else f"{failed} case(s) failed")
    return 2 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
