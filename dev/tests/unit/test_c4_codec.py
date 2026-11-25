#!/usr/bin/env python3
"""Unit cases for the c4 disk codec (scripts/disk_format.py): round trip, derived fields, layout order, id renaming,
boundary validation and the fixtures under dev/tests/fixtures/c4. No engine needed.

Usage: python dev/test_c4_codec.py
Exit codes: 0 all passed, 2 a case failed.
"""

from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
from disk_format import format_json, from_disk, to_disk  # noqa: E402
from tokens import load_tokens  # noqa: E402

KEYS = ["diagramType", "schemaVersion", "title", "arrange", "layerDirection", "showTech", "showNotes", "showSteps", "colorKey",
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
    m = json.loads((ROOT / "dev/tests/fixtures/c4/landscape.json").read_text(encoding="utf-8"))
    m.update(canvas={"w": 1, "h": 1}, showNotes=True, showTech=True, _band=1)
    for i, e in enumerate(m["elements"]):
        e.update(x=10 * i, y=5 * i, w=100, h=60, _lines=["a"])
    for i, g in enumerate(m["groups"]):
        g.update(x=1000 + i, y=2000 + i, w=300, h=200, _hidden=True)
    m["relations"][0].update(points=[[0, 0], [1, 1]], labelBox={"x": 1}, _k=1)
    m["notes"][0]["_x"] = 3
    return m


def main():
    global failed
    failed = 0
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
        "arrange": "layers",
        "layerDirection": "vertical",
        "groups": [{"id": "g_170000000000001", "name": "Order Platform", "kind": "system"},
                   {"id": "g_170000000000002", "name": "Inner", "kind": "boundary", "parent": "g_170000000000001"},
                   {"id": "g_170000000000006", "name": "Serve", "kind": "boundary"},
                   {"id": "g_170000000000007", "name": "Observability", "kind": "boundary", "shared": True,
                    "span": ["g_170000000000001", "g_170000000000006"]}],
        "elements": [{"id": "e_170000000000003", "kind": "person", "name": "Customer"},
                     {"id": "e_170000000000004", "kind": "container", "name": "Customer", "group": "g_170000000000002"},
                     {"id": "keep", "kind": "database", "name": "DB", "group": "g_170000000000001"}],
        "relations": [{"from": "e_170000000000003", "to": "e_170000000000004", "label": "Uses"},
                      {"from": "e_170000000000004", "to": "keep", "label": "Reads"},
                      {"from": "g_170000000000001", "to": "g_170000000000006", "label": "Feeds", "step": "1"}],
        "notes": [{"id": "n_170000000000005", "text": "t", "elements": ["e_170000000000003"], "groups": ["g_170000000000001"]}],
    }
    g = to_disk("c4", gen)
    ids = [o["id"] for k in ("groups", "elements", "notes") for o in g[k]]
    check("editor ids become slugs, n<N>, suffix on clash, authored kept",
          ids == ["order_platform", "inner", "serve", "observability", "customer", "customer_2", "keep", "n1"], ids)
    check("renamed ids are followed in every reference (including span and group relations)",
          g["groups"][1]["parent"] == "order_platform"
          and g["groups"][3]["span"] == ["order_platform", "serve"]
          and g["elements"][1]["group"] == "inner"
          and g["elements"][2]["group"] == "order_platform"
          and (g["relations"][0]["from"], g["relations"][0]["to"]) == ("customer", "customer_2")
          and (g["relations"][2]["from"], g["relations"][2]["to"]) == ("order_platform", "serve")
          and g["notes"][0]["elements"] == ["customer"] and g["notes"][0]["groups"] == ["order_platform"], g)

    base = lambda: copy.deepcopy(json.loads((ROOT / "dev/tests/fixtures/c4/landscape.json").read_text(encoding="utf-8")))  # noqa: E731
    bad = {}
    b = base(); b["elements"].append(copy.deepcopy(b["elements"][0])); bad["duplicate id"] = b
    b = base(); b["relations"][0]["to"] = "nope"; bad["relation to unknown id"] = b
    b = base(); b["relations"][0]["from"] = "platform"; bad["relation from ancestor group to descendant element"] = b
    b = base(); b["relations"].append({"from": "web", "to": "platform", "label": "x"}); bad["relation from descendant element to ancestor group"] = b
    b = base(); b["relations"].append({"from": "shopco", "to": "web", "label": "x"}); bad["relation from transitive ancestor group to element"] = b
    b = base(); b["relations"].append({"from": "web", "to": "shopco", "label": "x"}); bad["relation from element to transitive ancestor group"] = b
    b = base(); b["relations"].append({"from": "shopco", "to": "platform", "label": "x"}); bad["relation from parent group to child group"] = b
    b = base(); b["relations"].append({"from": "platform", "to": "shopco", "label": "x"}); bad["relation from child group to parent group"] = b
    b = base(); b["relations"].append({"from": "cust", "to": "cust", "label": "x"}); bad["self relation on element"] = b
    b = base(); b["relations"].append({"from": "shopco", "to": "shopco", "label": "x"}); bad["self relation on group"] = b
    b = base(); b["elements"][0]["group"] = "nope"; bad["unknown group"] = b
    b = base(); b["groups"][1]["parent"] = "nope"; bad["unknown parent"] = b
    b = base(); b["groups"][0]["parent"] = "platform"; bad["group cycle"] = b
    b = base(); b["groups"][0]["parent"] = "shopco"; bad["group is its own parent"] = b
    b = base(); b["elements"][0]["kind"] = "robot"; bad["unknown element kind"] = b
    b = base(); b["groups"][0]["kind"] = "zone"; bad["unknown group kind"] = b
    b = base(); b["notes"][0]["groups"] = ["nope"]; bad["note to unknown id"] = b
    b = base(); b["arrange"] = "radial"; bad["unknown arrange"] = b
    b = base(); b["layerDirection"] = "diagonal"; bad["unknown layerDirection"] = b
    b = base(); b["showSteps"] = "yes"; bad["non-boolean showSteps"] = b
    b = base(); b["elements"][0]["side"] = "up"; bad["bad element side"] = b
    b = base(); b["groups"][0]["side"] = "n"; bad["bad group side"] = b
    b = base(); b["elements"][0]["core"] = "yes"; bad["non-boolean core"] = b
    b = base(); b["groups"][0]["color"] = "teal"; bad["bad group colour"] = b
    b = base(); b["groups"][0]["shared"] = "yes"; bad["non-boolean shared"] = b
    b = base(); b["groups"][1]["shared"] = True; bad["shared group with parent"] = b
    b = base(); b["groups"].append({"id": "sh", "name": "Sh", "kind": "system", "shared": True}); bad["shared group with kind system"] = b
    b = base(); b["groups"][2]["span"] = []; bad["empty span"] = b
    b = base(); b["groups"][2]["span"] = "shopco"; bad["non-list span"] = b
    b = base(); b["groups"][2]["span"] = [123]; bad["non-string span entry"] = b
    b = base(); b["groups"][2]["span"] = ["nope"]; bad["span referencing unknown group"] = b
    b = base(); b["groups"][2]["span"] = ["platform"]; bad["span referencing nested group"] = b
    b = base(); b["groups"].append({"id": "sh1", "name": "Sh1", "kind": "boundary", "shared": True}); b["groups"].append({"id": "sh2", "name": "Sh2", "kind": "boundary", "shared": True, "span": ["sh1"]}); bad["span referencing shared group"] = b
    b = base(); b["relations"][0]["step"] = ""; bad["empty relation step"] = b
    b = base(); b["relations"][0]["step"] = "   "; bad["blank relation step"] = b
    b = base(); b["relations"][0]["step"] = 1; bad["non-string relation step"] = b
    b = base(); b["relations"][0]["color"] = "teal"; bad["bad relation color"] = b
    for name, model in bad.items():
        check(f"rejects {name}", raises(model))

    pal0 = load_tokens()["palette"][0]
    ok = base()
    ok.update(arrange="layers", layerDirection="vertical", showSteps=True)
    ok["groups"][0].update(core=True, side="N", color="#abcdef")
    ok["groups"].append({"id": "obs", "name": "Observability", "kind": "boundary", "shared": True, "side": "S", "span": ["shopco", "third"]})
    ok["elements"][0].update(core=True, side="W")
    ok["relations"][0].update(step="1", color=pal0["hex"])
    ok["relations"].append({"from": "shopco", "to": "third", "label": "Integrates", "step": "2a", "color": "#abcdef"})
    ok["relations"].append({"from": "cust", "to": "third", "label": "Notified by"})
    ok["relations"].append({"from": "third", "to": "api", "label": "Webhooks"})
    d2 = to_disk("c4", ok)
    check("accepts vertical layers, showSteps, shared/span, group & mixed relations, step, and relation colors",
          d2["arrange"] == "layers" and d2["layerDirection"] == "vertical" and d2["showSteps"] is True
          and list(d2) == [k for k in KEYS if k in d2]
          and d2["groups"][0]["color"] == "#abcdef" and d2["elements"][0]["core"] is True and d2["groups"][0]["side"] == "N"
          and d2["groups"][3]["shared"] is True and d2["groups"][3]["span"] == ["shopco", "third"]
          and d2["relations"][0]["step"] == "1" and d2["relations"][0]["color"] == pal0["slot"]
          and d2["relations"][-3]["color"] == "#abcdef"
          and to_disk("c4", from_disk("c4", d2)) == d2, d2)
    raw_rel_hex = copy.deepcopy(d2)
    raw_rel_hex["relations"][0]["color"] = pal0["hex"]
    check("from_disk normalizes relation palette hex to slot",
          from_disk("c4", raw_rel_hex)["relations"][0]["color"] == pal0["slot"])
    base_disk = to_disk("c4", base())
    check("absent optional fields stay absent",
          all(k not in base_disk for k in ("arrange", "layerDirection", "showSteps")))
    deep = {"diagramType": "c4", "groups": [{"id": f"g{i}", "name": "G", "kind": "boundary", **({"parent": f"g{i-1}"} if i else {})}
                                            for i in range(6)], "elements": [], "relations": []}
    check("no depth limit in the codec", not raises(deep))
    check("blank diagram is valid", to_disk("c4", json.loads((ROOT / "assets/types/c4/blank.json").read_text(encoding="utf-8")))["groups"] == [])

    for p in sorted((ROOT / "dev/tests/fixtures/c4").glob("*.json")) + sorted((ROOT / "dev/tests/fixtures/c4/level3").glob("*.json")) + [ROOT / "assets/types/c4/default.json"]:
        f = json.loads(p.read_text(encoding="utf-8"))
        check(f"{p.name}: disk form is a fixed point", to_disk("c4", from_disk("c4", f)) == f)
    print("all cases passed" if not failed else f"{failed} case(s) failed")
    return 2 if failed else 0


class TestC4Codec(unittest.TestCase):
    def test_c4_codec(self):
        self.assertEqual(main(), 0)


if __name__ == "__main__":
    sys.exit(main())
