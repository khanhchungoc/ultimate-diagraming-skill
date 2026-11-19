#!/usr/bin/env python3
"""Tests the subprocess flows of a flowchart (plan: dev/plans/plan-subprocess.md, Phase 1).

  1. Reader: a `sub_` block becomes `children[slug]`, lanes are global (one id per actor), a repeated lane with another name warns,
     an arrow across a `sub_` boundary is dropped with a warning; the writer gives the same data back (also the stock-Mermaid form).
  2. Disk format: child positions go into the one `layout` map and come back; child ids are renamed with the parent's.
  3. Limits and contract (`subprocess_flow.checks`): 30 steps, 6 lanes, a `sub_` with no `[["..."]]` step, start pills, end count
     against the branches of the decision after the step; the candidate regions above 30 steps.
  4. CLI on dev/fixtures/subprocess/laptop-purchase.mmd: `--layout` is clean, `--extract` prints outline, parent, children, and
     `--layout` of that text gives the same diagram; `--sub`, `--flat`; a flat flow has every step of every tab.

Usage: python dev/test_subprocess.py [-v|--verbose]        Exit codes: 0 all passed, 2 a check failed.
"""
from __future__ import annotations

import argparse
import copy
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import disk_format as df  # noqa: E402
import layout_engine as le  # noqa: E402
import subprocess_flow as sub  # noqa: E402

_ap = argparse.ArgumentParser(description="Test the flowchart subprocess flows.")
_ap.add_argument("-v", "--verbose", action="store_true", help="Print passing checks")
VERBOSE = _ap.parse_args().verbose
total = 0
failures = 0
tmp = Path(tempfile.mkdtemp(prefix="test_subprocess_"))
FIXTURE = ROOT / "dev" / "fixtures" / "subprocess" / "laptop-purchase.mmd"


def check(name: str, ok: bool, detail: str = "") -> None:
    global total, failures
    total += 1
    if not ok or VERBOSE:
        print(f"[{'PASS' if ok else 'FAIL'}] {name}{'' if ok else ' - ' + str(detail)[:400]}")
    failures += 0 if ok else 1


def cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(ROOT / "scripts" / "layout_engine.py"), *map(str, args)], capture_output=True,
                          text=True, encoding="utf-8", cwd=tmp)


def read(text: str) -> dict:
    return le.run_mermaid("from", "flowchart", text)


TEXT = """flowchart
  subgraph lane_a["Alpha"]
    s(["Start"])
    sp[["Do Part"]]
    d{"Done?"}
    ok(["Fine"])
    bad(["Bad"])
  end
  s --> sp --> d
  d -->|"Yes"| ok
  d -->|"No"| bad
  subgraph sub_sp["Do Part"]
    subgraph lane_a["Alpha"]
      c0(["Do Part"])
      c1["Work"]
      cy(["Part Done"])
    end
    subgraph lane_b["Beta"]
      c2["Check"]
      c3{"Check Passed?"}
      cn(["Part Failed"])
    end
  end
  c0 --> c1 --> c2 --> c3
  c3 -->|"Yes"| cy
  c3 -->|"No"| cn
  n1>"Child note"] -.- c2
"""

# 1. Reader and writer
r = read(TEXT)
d = r["data"]
check("reader: no warnings", not r["warnings"], r["warnings"])
check("reader: one child under its slug, named by the block", list(d.get("children", {})) == ["sp"] and d["children"]["sp"]["name"] == "Do Part")
check("reader: lanes are global, first occurrence first", [x["id"] for x in d["lanes"]] == ["lane_a", "lane_b"])
check("reader: parent holds only its steps", [n["id"] for n in d["nodes"]] == ["s", "sp", "d", "ok", "bad"], [n["id"] for n in d["nodes"]])
kid = d["children"]["sp"]
check("reader: child steps, lane order, arrows and note", [n["id"] for n in kid["nodes"]] == ["c0", "c1", "cy", "c2", "c3", "cn"]
      and kid["laneOrder"] == ["lane_a", "lane_b"] and len(kid["edges"]) == 5 and kid["notes"][0]["nodes"] == ["c2"], kid)
check("reader: a flowchart without sub_ has no children key", "children" not in read("flowchart\n  a[\"A\"] --> b[\"B\"]\n")["data"])

bad = read(TEXT.replace('subgraph lane_a["Alpha"]\n      c0', 'subgraph lane_a["Other"]\n      c0').replace("  c0 --> c1", "  c1 --> s\n  c0 --> c1"))
check("reader: a repeated lane with another name warns, the first name wins",
      any("lane_a" in w and "Other" in w for w in bad["warnings"]) and bad["data"]["lanes"][0]["name"] == "Alpha", bad["warnings"])
check("reader: an arrow across a sub_ boundary is dropped with a warning",
      any("crosses a sub_ boundary" in w for w in bad["warnings"]) and not any(e["from"] == "c1" and e["to"] == "s" for e in
                                                                              bad["data"]["edges"] + bad["data"]["children"]["sp"]["edges"]))

stock_text = le.run_mermaid("to", "flowchart", d, palette=None)
check("writer: the plain form keeps the shared lane id inside the block", stock_text.count("subgraph lane_a[") == 2)
check("writer: plain text reads back to the same data", read(stock_text)["data"] == d)

# 2. Disk format
laid = copy.deepcopy(d)
for i, n in enumerate(laid["nodes"]):
    n.update(x=100 + i, y=10)
for i, n in enumerate(laid["children"]["sp"]["nodes"]):
    n.update(x=300 - i, y=20)
laid["lanes"][0]["height"] = 200
laid["children"]["sp"]["laneHeights"] = {"lane_a": 240, "lane_b": 192}
disk = df.to_disk("flowchart", laid)
check("disk: child steps' positions are in the one layout map", disk["layout"]["c0"] == {"x": 300, "y": 20} and "x" not in disk["children"]["sp"]["nodes"][0])
check("disk: child steps are in flow order (x ascending)", [n["id"] for n in disk["children"]["sp"]["nodes"]] == ["cn", "c3", "c2", "cy", "c1", "c0"])
check("disk: key order puts children before layout", list(disk)[-2:] == ["children", "layout"], list(disk))
check("disk: round trip gives the positions back", {n["id"]: (n["x"], n["y"]) for n in df.from_disk("flowchart", disk)["children"]["sp"]["nodes"]}
      == {n["id"]: (n["x"], n["y"]) for n in laid["children"]["sp"]["nodes"]})
check("disk: laneHeights stay in the child and out of the authoring JSON", disk["children"]["sp"]["laneHeights"]["lane_b"] == 192
      and "laneHeights" not in df.authoring_json("flowchart", laid)["children"]["sp"])
gen = copy.deepcopy(laid)
gen["children"]["sp"]["nodes"][1]["id"] = "n_1700000000000"
gen["children"]["sp"]["edges"][0]["to"] = "n_1700000000000"
named = df.to_disk("flowchart", gen)
check("disk: an editor id in a child is renamed everywhere", "n_work" in json.dumps(named) and "n_1700000000000" not in json.dumps(named))

# 3. Limits and contract
def flow(n_steps: int, lanes: int = 1) -> dict:
    nodes = [{"id": f"t{i}", "laneId": f"l{i % lanes}", "type": "task", "label": f"Task {i}"} for i in range(n_steps)]
    return {"lanes": [{"id": f"l{i}", "name": f"L{i}"} for i in range(lanes)], "nodes": nodes,
            "edges": [{"id": f"e{i}", "from": f"t{i}", "to": f"t{i + 1}", "label": ""} for i in range(n_steps - 1)]}


check("limits: 30 steps and 6 lanes pass", not sub.checks(flow(30, 6)))
check("limits: 31 steps warn", any("31 steps" in w for w in sub.checks(flow(31))))
check("limits: 7 lanes warn", any("7 lanes" in w for w in sub.checks(flow(10, 7))))
check("limits: starts and ends do not count", not sub.checks({**flow(30), "nodes": flow(30)["nodes"] + [{"id": "s", "laneId": "l0", "type": "start", "label": "S"},
                                                                                                      {"id": "x", "laneId": "l0", "type": "end", "label": "X"}]}))
check("contract: the reader's fixture has none", not sub.checks(d), sub.checks(d))
check("contract: a sub_ without its [[...]] step warns", any("no matching" in w for w in sub.checks({**d, "nodes": [n for n in d["nodes"] if n["id"] != "sp"]})))
two = copy.deepcopy(d)
two["children"]["sp"]["nodes"].append({"id": "c9", "laneId": "lane_a", "type": "start", "label": "Again"})
check("contract: two start pills warn", any("2 start pills" in w for w in sub.checks(two)))
three = copy.deepcopy(d)
three["children"]["sp"]["nodes"] += [{"id": "cx", "laneId": "lane_a", "type": "end", "label": "Part Skipped"}]
check("contract: three end pills against the two branches of the decision after the step warn", any("3 end pills" in w and "has 2" in w for w in sub.checks(three)), sub.checks(three))
single = copy.deepcopy(d)
single["children"]["sp"]["nodes"] = [n for n in single["children"]["sp"]["nodes"] if n["id"] != "cn"]
check("contract: one end pill against the two branches of the decision after the step warns", any("1 end pills" in w and "has 2" in w for w in sub.checks(single)), sub.checks(single))
none = copy.deepcopy(d)
none["children"]["sp"]["nodes"] = [n for n in none["children"]["sp"]["nodes"] if n["type"] != "end"]
check("contract: a child with no end pill warns", any("0 end pills" in w for w in sub.checks(none)), sub.checks(none))
one = copy.deepcopy(d)
one["nodes"] = [n for n in one["nodes"] if n["id"] not in ("d", "ok", "bad")]
one["edges"] = [{"id": "e1", "from": "s", "to": "sp", "label": ""}, {"id": "e2", "from": "sp", "to": "ok2", "label": ""}]
one["nodes"].append({"id": "ok2", "laneId": "lane_a", "type": "task", "label": "Next"})
check("contract: a step that just continues needs one end", any("2 end pills" in w and "needs 1" in w for w in sub.checks(one)), sub.checks(one))

big = flow(34)
big["nodes"] = [{**n, "x": i} for i, n in enumerate(big["nodes"])]
big["nodes"].insert(0, {"id": "st", "laneId": "l0", "type": "start", "label": "Go"})
big["edges"].insert(0, {"id": "e", "from": "st", "to": "t0", "label": ""})
cand = sub.rpst_candidates(big)
check("candidates: a 34-step chain lists regions of at most 30 steps, largest first", cand and "30 steps" in cand[0], cand)
check("candidates: none for a region that is one or two steps", not sub.rpst_candidates(flow(3)) or "3 steps" in sub.rpst_candidates(flow(3))[0])

# 5. Nesting up to 4 levels (plan: dev/plans/archive/plan-subprocess-depth.md, sections 1 and 3)
def nested_text(levels: int) -> str:
    """Like chain() but each block is closed right after its own lane, then the blocks close from the inside out."""
    out = ["flowchart", '  subgraph lane_a["Alpha"]', '    m0(["Start"])', '    s1[["Step 1"]]', '    m9(["End"])', "  end"]
    for lv in range(2, levels + 1):
        pad = "  " * (lv - 1)
        out += [f'{pad}subgraph sub_s{lv - 1}["Step {lv - 1}"]', f'{pad}  subgraph lane_a["Alpha"]', f'{pad}    b{lv}(["Begin {lv}"])']
        out += [f'{pad}    s{lv}[["Step {lv}"]]'] if lv < levels else [f'{pad}    w{lv}["Work {lv}"]']
        out += [f'{pad}    e{lv}(["Done {lv}"])', f"{pad}  end"]
    for lv in range(levels, 1, -1):
        out.append("  " * (lv - 1) + "end")
    out.append("  m0 --> s1 --> m9")
    for lv in range(2, levels + 1):
        out += [f"  b{lv} --> " + (f"s{lv}" if lv < levels else f"w{lv}") + f" --> e{lv}"]
    return "\n".join(out) + "\n"


t4 = read(nested_text(4))
d4 = t4["data"]
check("nesting: a 4-level file reads with no warning or info", not t4["warnings"] and not t4["infos"], (t4["warnings"], t4["infos"]))
check("nesting: children are one flat map keyed by slug, parent before child", list(d4.get("children", {})) == ["s1", "s2", "s3"], list(d4.get("children", {})))
check("nesting: each flow holds only its own steps", [n["id"] for n in d4["children"]["s2"]["nodes"]] == ["b3", "s3", "e3"]
      and [n["id"] for n in d4["children"]["s3"]["nodes"]] == ["b4", "w4", "e4"], d4["children"])
check("nesting: parentOf and depthOf follow the step", sub.parent_of(d4, "s3") == "s2" and sub.parent_of(d4, "s1") == "" and
      [sub.depth_of(d4, k) for k in ("", "s1", "s2", "s3")] == [1, 2, 3, 4] and sub.can_nest(d4, "s2") and not sub.can_nest(d4, "s3"))
check("nesting: child order is depth first", sub.child_order(d4) == ["s1", "s2", "s3"])
check("nesting: no [WARN] from the contract check", not [w for w in sub.checks(d4) if "end pills" not in w], sub.checks(d4))
back = le.run_mermaid("to", "flowchart", d4, palette=None)
check("nesting: the writer nests each block in its parent's block", back.index("subgraph sub_s2") > back.index("subgraph sub_s1")
      and back.index("subgraph sub_s2") < back.index("\n    end\n  end") and "    subgraph sub_s2[" in back and "      subgraph sub_s3[" in back, back)
check("nesting: memory -> Mermaid -> memory is the same data", read(back)["data"] == d4)
disk4 = df.to_disk("flowchart", d4)
check("nesting: disk keeps the flat children map, no new field", list(disk4["children"]) == ["s1", "s2", "s3"]
      and all(set(c) <= set(df.CHILD_KEYS) for c in disk4["children"].values()), list(disk4))
mem4 = df.from_disk("flowchart", disk4)
check("nesting: disk -> memory -> disk is byte-identical", json.dumps(df.to_disk("flowchart", mem4)) == json.dumps(disk4))
check("nesting: disk -> memory -> Mermaid -> memory -> disk is the same", json.dumps(df.to_disk("flowchart", read(le.run_mermaid("to", "flowchart", mem4, palette=None))["data"])) == json.dumps(disk4))
flat4 = sub.flatten(d4)
check("nesting: --flat expands every level into one flow", "children" not in flat4 and sorted(n["id"] for n in flat4["nodes"]) == ["m0", "m9", "w4"],
      sorted(n["id"] for n in flat4["nodes"]))
check("nesting: the outline indents one step per level", [ln.index("s") for ln in sub.outline(d4)[1:]] == [3, 5, 7], sub.outline(d4))

t5 = read(nested_text(5))
d5 = t5["data"]
check("nesting: level 5 stays a plain label with an [INFO]", list(d5["children"]) == ["s1", "s2", "s3"] and any("nested subgraphs flattened" in i and "sub_s4" in i for i in t5["infos"])
      and next(n for n in d5["children"]["s3"]["nodes"] if n["id"] == "s4")["type"] == "subprocess", (t5["infos"], list(d5["children"])))
missing = copy.deepcopy(d4)
missing["children"]["s2"]["nodes"] = [n for n in missing["children"]["s2"]["nodes"] if n["id"] != "s3"]
check("nesting: a sub_ whose parent step is missing at a deep level warns", any("sub_s3" in w and "no matching" in w for w in sub.checks(missing)), sub.checks(missing))
deep = copy.deepcopy(d4)
deep["children"]["s3"]["nodes"].append({"id": "s5", "laneId": "lane_a", "type": "subprocess", "label": "Step 5"})
deep["children"]["s5"] = {"name": "Step 5", "laneOrder": ["lane_a"], "nodes": [{"id": "b6", "laneId": "lane_a", "type": "start", "label": "Begin"}], "edges": []}
check("nesting: a flow deeper than 4 warns", any("level 5" in w for w in sub.checks(deep)), sub.checks(deep))

# 4. CLI
page = tmp / "lp.html"
out = cli("--layout", FIXTURE, "-o", page)
check("cli: --layout of the fixture is final with no [WARN]", "[DONE]" in out.stdout and "[WARN]" not in out.stdout and out.returncode == 0, out.stdout + out.stderr)
check("cli: the page data block has the children", len(le.read_data_block(page.read_text(encoding="utf-8")).get("children", {})) == 3)
ex = cli("--extract", page)
lines = ex.stdout.splitlines()
head = [ln for ln in lines if ln.startswith("%% ") and "->" in ln]
check("cli: --extract prints the outline first", lines[3].startswith("%% Corporate Laptop Purchase Request: 54 steps, 7 lanes, 3 subprocesses") and len(head) == 3, lines[:6])
check("cli: --extract prints the children in the order the parent reaches them",
      [ln for ln in lines if ln.startswith("  subgraph sub_")] == ['  subgraph sub_approve_spec["Approve Specification"]', '  subgraph sub_procure_laptop["Procure Laptop"]',
                                                                  '  subgraph sub_source_laptop["Source from Supplier"]'])
(tmp / "ex.mmd").write_text(ex.stdout, encoding="utf-8")
page2 = tmp / "lp2.html"
cli("--layout", tmp / "ex.mmd", "-o", page2)
a, b = (json.loads(cli("--extract", p, "--json").stdout) for p in (page, page2))
check("cli: --extract then --layout gives the same diagram", a == b)
one_sub = cli("--extract", page, "--sub", "source_laptop").stdout
check("cli: --sub prints one child as its own flowchart", sum("->" in ln for ln in one_sub.splitlines() if ln.startswith("%% ")) == 1 and "check_stock" in one_sub and "submit_request" not in one_sub and "subgraph sub_" not in one_sub, one_sub[:300])
check("cli: --sub with an unknown slug lists the real ones", "approve_spec, procure_laptop, source_laptop" in cli("--extract", page, "--sub", "nope").stderr)
flat = cli("--extract", page, "--flat").stdout
check("cli: --flat has no sub_ block and every step of every tab", "subgraph sub_" not in flat and all(s in flat for s in ("review_justification", "obtain_price", "deliver_laptop", "submit_request")))
flat_data = json.loads(cli("--extract", page, "--flat", "--json").stdout)
whole = json.loads(cli("--extract", page, "--json").stdout)
tabs = [whole] + list(whole["children"].values())
steps = {n["id"] for t in tabs for n in t["nodes"] if n["type"] not in ("start", "end") and n["id"] not in whole["children"]}
check("cli: --flat keeps every step except the subprocess steps and the routing decisions after them",
      {n["id"] for n in flat_data["nodes"] if n["type"] not in ("start", "end")} == steps - {"spec_outcome", "po_sent"}, sorted(steps ^ {n["id"] for n in flat_data["nodes"]}))
check("cli: --flat arrows all join existing steps", all(e["from"] in {n["id"] for n in flat_data["nodes"]} and e["to"] in {n["id"] for n in flat_data["nodes"]}
                                                        for e in flat_data["edges"]))
check("cli: a file without children refuses --flat", cli("--extract", ROOT / "dev/samples/example-flowchart.html", "--flat").returncode != 0)
two_big = tmp / "big.mmd"
two_big.write_text("flowchart\n" + "\n".join(f'  t{i}["Task {i}"]' for i in range(32)) + "\n" + "\n".join(f"  t{i} --> t{i + 1}" for i in range(31)) + "\n", encoding="utf-8")
over = cli("--layout", two_big, "-o", tmp / "big.html")
check("cli: --layout warns above 30 steps and lists candidates", "[WARN]" in over.stdout and "32 steps" in over.stdout and "Subprocess candidate" in over.stdout, over.stdout)

print(f"{total - failures}/{total} checks passed" + (f" ({failures} failed)" if failures else ""))
sys.exit(2 if failures else 0)
