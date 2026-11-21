#!/usr/bin/env python3
"""Tests the CLI's Mermaid side (plan: dev/plans/plan-mermaid-input.md, Phase 4).

  1. `--layout x.mmd` for every type, from dev/examples/*.json written as Mermaid by `--extract`.
  2. `--extract` prints Mermaid by default, `--json` keeps the old JSON, `-o` writes the file, `--theme` sets the palette.
  3. `--keep-from`: same ids keep every position, a text edit redraws only labels, an added item resets with an [INFO] line,
     the old page's stored theme is kept.
  4. Automatic lane icons for a flowchart.

Usage: python dev/test_cli_mermaid.py [-v|--verbose]        Exit codes: 0 all passed, 2 a check failed.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import layout_engine as le  # noqa: E402

_ap = argparse.ArgumentParser(description="Test the CLI Mermaid reader/writer.")
_ap.add_argument("-v", "--verbose", action="store_true", help="Print passing checks")
VERBOSE = _ap.parse_args().verbose
total = 0
failures = 0
tmp = Path(tempfile.mkdtemp(prefix="test_cli_mermaid_"))


def check(name: str, ok: bool, detail: str = "") -> None:
    global total, failures
    total += 1
    if not ok or VERBOSE:
        print(f"[{'PASS' if ok else 'FAIL'}] {name}{'' if ok else ' - ' + str(detail)[:400]}")
    failures += 0 if ok else 1


def cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(ROOT / "scripts" / "layout_engine.py"), *map(str, args)], capture_output=True,
                          text=True, encoding="utf-8", cwd=tmp)


def layout_of(page: Path) -> dict:
    return le.read_data_block(page.read_text(encoding="utf-8")).get("layout", {})


KINDS = ("flowchart", "usecase", "sequence", "erd", "c4")

# 1 and 2. each example: JSON -> Mermaid (--extract) -> page (--layout) -> same ids again (--keep-from) ---------------------------
for kind in KINDS:
    example = ROOT / "dev" / "examples" / f"example-{kind}.json"
    mmd, page, page2 = tmp / f"{kind}.mmd", tmp / f"{kind}.html", tmp / f"{kind}-2.html"
    r = cli("--extract", example, "-o", mmd)
    text = mmd.read_text(encoding="utf-8") if mmd.is_file() else ""
    header = {"flowchart": "flowchart", "usecase": "flowchart", "sequence": "sequenceDiagram", "erd": "erDiagram", "c4": "C4Container"}[kind]
    check(f"{kind}: --extract -o writes Mermaid", r.returncode == 0 and header in text and not text.lstrip().startswith("{"), r.stdout + r.stderr)
    r = cli("--layout", mmd, "-o", page)
    check(f"{kind}: --layout x.mmd ends in [DONE] or [NEXT], no [ERROR]",
          r.returncode == 0 and "[ERROR]" not in r.stdout + r.stderr and ("[DONE]" in r.stdout or "[NEXT]" in r.stdout) and page.is_file(), r.stdout[-300:] + r.stderr[-300:])
    check(f"{kind}: the page holds a {kind}", le.read_data_block(page.read_text(encoding="utf-8")).get("diagramType") == kind)
    r = cli("--layout", mmd, "--keep-from", page, "-o", page2)
    check(f"{kind}: --keep-from with the same ids keeps the positions",
          r.returncode == 0 and "Positions reset" not in r.stdout and layout_of(page) == layout_of(page2), r.stdout[-300:] + r.stderr[-300:])
    page_mmd = cli("--extract", page).stdout
    check(f"{kind}: --extract of a page prints Mermaid on stdout", page_mmd.lstrip().startswith(("---", header)))
    as_json = json.loads(cli("--extract", page, "--json").stdout)
    check(f"{kind}: --extract --json prints the old JSON", as_json.get("diagramType") == kind and "layout" not in as_json)

# c4: the type comes from the C4 header, a Dynamic or Deployment view is refused, hints come back, a level-1 text reads as a Context
c4_ctx = tmp / "ctx.mmd"
c4_ctx.write_text('C4Context\n  title Shop\n  Person(c, "Customer")\n  System(s, "Shop", "Sells things")\n  Rel(c, s, "Buys", "HTTPS")\n  %% @icon c user\n', encoding="utf-8")
r = cli("--layout", c4_ctx, "-o", tmp / "ctx.html")
check("c4: C4Context text is read as a c4 page", r.returncode == 0 and "[DONE]" in r.stdout and le.read_data_block((tmp / "ctx.html").read_text(encoding="utf-8")).get("diagramType") == "c4", r.stdout[-300:] + r.stderr[-300:])
ctx_back = cli("--extract", tmp / "ctx.html").stdout
check("c4: --extract writes C4Context with the icon hint and the relation", ctx_back.startswith("C4Context") and "%% @icon c user" in ctx_back and 'Rel(c, s, "Buys", "HTTPS")' in ctx_back, ctx_back)
for view in ("C4Dynamic", "C4Deployment"):
    (tmp / "view.mmd").write_text(view + '\n  Person(a, "A")\n', encoding="utf-8")
    r = cli("--layout", tmp / "view.mmd", "-o", tmp / "view.html")
    check(f"c4: {view} is refused with a message", r.returncode != 0 and f"{view} is not supported" in r.stdout + r.stderr and not (tmp / "view.html").exists(), r.stdout + r.stderr)
(tmp / "bad.mmd").write_text('C4Context\n  Person(a, "A")\n  Frobnicate(x)\n  Rel(a, nope, "x")\n', encoding="utf-8")
r = cli("--layout", tmp / "bad.mmd", "-o", tmp / "bad.html")
check("c4: an unknown statement and a dangling relation are [WARN] lines and end in [NEXT]", r.stdout.count("[WARN]") >= 2 and "Frobnicate" in r.stdout and "[NEXT]" in r.stdout, r.stdout[-400:])

# JSON input still works as before
r = cli("--layout", ROOT / "dev/examples/example-flowchart.json", "-o", tmp / "old.html")
check("JSON input still works", r.returncode == 0 and "[DONE]" in r.stdout and "Lane icons" not in r.stdout, r.stdout[-300:] + r.stderr[-300:])
r = cli("--layout", tmp / "flowchart.mmd", "--keep-layout")
check("--keep-layout with Mermaid input is refused, pointing at --keep-from", r.returncode != 0 and "--keep-from" in r.stdout + r.stderr)
r = cli("--layout", ROOT / "dev/examples/example-flowchart.json", "--keep-from", tmp / "flowchart.html")
check("--keep-from with JSON input is refused", r.returncode != 0 and "--keep-from" in r.stdout + r.stderr)

# text detection: no .mmd extension, no leading { or <
plain = tmp / "diagram.txt"
plain.write_text((tmp / "erd.mmd").read_text(encoding="utf-8"), encoding="utf-8")
r = cli("--layout", plain, "-o", tmp / "plain.html")
check("Mermaid text is detected without the .mmd extension", r.returncode == 0 and (tmp / "plain.html").is_file(), r.stdout[-200:] + r.stderr[-200:])

# a reader [WARN] ends the run in [NEXT]
warn = tmp / "warn.mmd"
warn.write_text("flowchart\n  subgraph lane_a[\"A\"]\n    s([\"Start\"]) --> t[\"Task\"]\n  end\n  loose[\"Loose\"]\n  t --> loose\n", encoding="utf-8")
r = cli("--layout", warn, "-o", tmp / "warn.html")
check("a reader [WARN] is printed and ends in [NEXT]", "[WARN]" in r.stdout and "[NEXT]" in r.stdout and "[DONE]" not in r.stdout, r.stdout[-400:])

# 2. the palette of --theme reaches the Mermaid classDef lines
theme = tmp / "theme.json"
base = json.loads((ROOT / "assets/tokens/default.json").read_text(encoding="utf-8"))
palette = base["palette"]
palette[0]["hex"] = "#123456"
theme.write_text(json.dumps({"tokensVersion": 1, "name": "pal", "palette": palette}), encoding="utf-8")
colored = tmp / "colored.mmd"
colored.write_text('flowchart\n  subgraph lane_a["A"]\n    s(["Start"]) --> t["Task"]\n  end\n  class lane_a c1\n', encoding="utf-8")
themed = tmp / "themed.html"
cli("--layout", colored, "--theme", theme, "-o", themed)
out = cli("--extract", themed).stdout
check("--extract writes the palette of the page's stored theme", "#123456" in out, out[:400])
out = cli("--extract", themed, "--theme", ROOT / "assets/tokens/default.json").stdout
check("--extract --theme beats the stored theme", "#123456" not in out and "classDef c1" in out, out[:400])

# 3. --keep-from details, on a flowchart
src = (tmp / "flowchart.mmd").read_text(encoding="utf-8")
old_page = themed
old_mmd = cli("--extract", old_page).stdout
edited = tmp / "edited.mmd"
edited.write_text(old_mmd.replace('"Task"', '"Task renamed"'), encoding="utf-8")
r = cli("--layout", edited, "--keep-from", old_page, "-o", tmp / "edited.html")
check("--keep-from: a text edit keeps positions and the stored theme",
      "Positions reset" not in r.stdout and layout_of(old_page) == layout_of(tmp / "edited.html")
      and (le.read_stored_theme((tmp / "edited.html").read_text(encoding="utf-8")) or {}).get("name") == "pal", r.stdout[-300:] + r.stderr[-300:])
added = tmp / "added.mmd"
added.write_text(old_mmd.replace("  end\n", '    extra["Extra step"]\n  end\n', 1), encoding="utf-8")
r = cli("--layout", added, "--keep-from", old_page, "-o", tmp / "added.html")
check("--keep-from: an added item resets with the info line", "[INFO] Positions reset: added extra" in r.stdout and "[DONE]" in r.stdout, r.stdout[-300:])
kind_changed = tmp / "other.mmd"
kind_changed.write_text((tmp / "erd.mmd").read_text(encoding="utf-8"), encoding="utf-8")
r = cli("--layout", kind_changed, "--keep-from", old_page, "-o", tmp / "other.html")
check("--keep-from: another diagram type resets with the info line", "[INFO] Positions reset:" in r.stdout and "[DONE]" in r.stdout, r.stdout[-300:])

# 4. lane icons
lanes = [{"id": "a", "name": "Customer"}, {"id": "b", "name": "Warehouse Team"}, {"id": "c", "name": "Finance"},
         {"id": "d", "name": "Customers"}, {"id": "e", "name": "Zzz"}]
data, note = le.auto_lane_icons({"lanes": lanes})
icons = [l["icon"] for l in data["lanes"]]
check("lane icons: a name matches the table's keywords (customer=user, warehouse=truck, finance=banknote)",
      icons[:3] == ["user", "truck", "banknote"], icons)
check("lane icons: each icon is used once, a repeated match takes the next unused icon", len(set(icons)) == len(icons) and icons[3] != "user", icons)
check("lane icons: no match takes the next unused icon in table order", icons[4] == next(i for i in le.lane_icon_menu() if i not in icons[:4]), icons)
check("lane icons: one [INFO] text lists them in lane order", note.startswith("Lane icons: Customer=user, Warehouse Team=truck, Finance=banknote"), note)
same = [{"id": "a", "name": "Customer", "icon": "cog"}]
check("lane icons: lanes that all have an icon stay untouched", le.auto_lane_icons({"lanes": same}) == ({"lanes": same}, ""))
d2 = {"swimlanes": False, "lanes": [{"id": "a", "name": "Customer"}]}
check("lane icons: swimlanes false stays untouched", le.auto_lane_icons(d2) == (d2, "") and "icon" not in d2["lanes"][0])
check("lane icons: an icon an author set is not handed out again",
      le.auto_lane_icons({"lanes": [{"id": "a", "name": "Customer", "icon": "user"}, {"id": "b", "name": "Customer"}]})[0]["lanes"][1]["icon"] != "user")
iconless = tmp / "iconless.mmd"
iconless.write_text('flowchart\n  subgraph a["Customer"]\n    s(["Start"]) --> t["Pay"]\n  end\n  subgraph b["Finance"]\n    t --> e(["End"])\n  end\n', encoding="utf-8")
r = cli("--layout", iconless, "-o", tmp / "iconless.html")
check("lane icons: --layout prints the [INFO] line and no 'has no icon' [WARN]",
      "[INFO] Lane icons: Customer=user, Finance=banknote" in r.stdout and "has no" not in r.stdout and "[DONE]" in r.stdout, r.stdout[-400:])
unknown = {"diagramType": "flowchart", "lanes": [{"id": "a", "name": "A", "icon": "nope"}], "nodes": [], "edges": []}
check("lane icons: an unknown icon is still a [WARN]", any("unknown icon 'nope'" in w for w in le.FlowchartAudit(unknown)._lane_icon_warnings()))

print(f"{total - failures}/{total} checks passed" + (f" ({failures} failed)" if failures else ""))
sys.exit(2 if failures else 0)
