#!/usr/bin/env python3
"""Layout metrics of the ERD engine (assets/types/erd/engine.js) for every ERD fixture.

Runs the engine through `node scripts/run_engine.mjs` and prints, per fixture: canvas, aspect (long side / short side),
fit zoom (view 1760 x 856, min(1, 1760/W, 856/H)), crossings, line length (sum of the Manhattan segment lengths of
relationships[].points), bends (points - 2 per relationship) and density (sum of table box areas / canvas area).

  python3 dev/erd_layout_metrics.py            print the table
  python3 dev/erd_layout_metrics.py --check    also exit 1 when an acceptance target of dev/plans/plan-erd-layout-v2.md is missed

The fixtures are dev/fixtures/erd/*.json plus the example (dev/samples/example-erd.html). The v1 baseline rows are the
numbers measured on the band/rank engine, kept here to show progress and to derive the relative targets.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENGINE = ROOT / "assets" / "types" / "erd" / "engine.js"
RUNNER = ROOT / "scripts" / "run_engine.mjs"
VIEW_W, VIEW_H = 1760, 856

# v1 baseline (plan-erd-layout-v2.md): canvas w, h, crossings, length, bends
BASELINE = {
    "example-erd": (1308, 625, 0, 2751, 20, 0.29),
    "saas-billing": (2226, 2880, 4, 27981, 190, 0.15),
    "four-areas-wide": (3376, 914, 0, 2158, 6, 0.08),
}


def load_fixtures():
    out = {}
    for path in sorted((ROOT / "dev" / "fixtures" / "erd").glob("*.json")):
        out[path.stem] = json.loads(path.read_text(encoding="utf8"))
    sample = ROOT / "dev" / "samples" / "example-erd.html"
    if sample.exists():
        m = re.search(r'<script id="diagram-data" type="application/json">(.*?)</script>', sample.read_text(encoding="utf8"), re.S)
        if m:
            out["example-erd"] = json.loads(m.group(1))
    return out


def run_engine(data):
    res = subprocess.run(["node", str(RUNNER), str(ENGINE)], input=json.dumps(data), capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or "engine failed")
    return json.loads(res.stdout)


def median_low(vals):
    v = sorted(vals)
    return v[(len(v) - 1) // 2]


def hub_distance(laid):
    """Per group of >= 4 tables: distance of its most connected table from the centre of the group's grid, in cells
    (Chebyshev, in grid cells: column and row ranks against the grid's centre). The best of the tied tables counts. Returns the worst group (0 if none)."""
    deg = {}
    for rel in laid.get("relationships", []):
        if rel["from"] != rel["to"]:
            for k in (rel["from"], rel["to"]):
                deg[k] = deg.get(k, 0) + 1
    by_group = {}
    for e in laid["entities"]:
        if e.get("group") in {g["id"] for g in laid.get("groups", [])}:
            by_group.setdefault(e["group"], []).append(e)
    worst = 0.0
    for tabs in by_group.values():
        if len(tabs) < 4:
            continue
        # cell of a table = rank of its column centre / its top among the group's distinct values
        cxs = sorted({e["box"]["x"] + e["box"]["w"] / 2 for e in tabs})
        # rows: tops closer than 90 px are one row (tables are shifted down up to 78 px to align row anchors)
        tops, rows = sorted({e["box"]["y"] for e in tabs}), []
        for y in tops:
            if rows and y - rows[-1][-1] < 90:
                rows[-1].append(y)
            else:
                rows.append([y])
        row_of = {y: i for i, r in enumerate(rows) for y in r}
        mid_c, mid_r = (len(cxs) - 1) / 2, (len(rows) - 1) / 2
        top = max(deg.get(e["id"], 0) for e in tabs)
        best = min(
            max(abs(cxs.index(e["box"]["x"] + e["box"]["w"] / 2) - mid_c), abs(row_of[e["box"]["y"]] - mid_r))
            for e in tabs if deg.get(e["id"], 0) == top
        )
        worst = max(worst, best)
    return worst


def empty_area(laid):
    """Share of the bounding box of all group boxes and ungrouped tables that no box covers."""
    rects = [g["box"] for g in laid.get("groups", []) if g.get("box")]
    ids = {g["id"] for g in laid.get("groups", [])}
    rects += [e["box"] for e in laid["entities"] if e.get("group") not in ids]
    if not rects:
        return 0.0
    x1 = min(r["x"] for r in rects); x2 = max(r["x"] + r["w"] for r in rects)
    y1 = min(r["y"] for r in rects); y2 = max(r["y"] + r["h"] for r in rects)
    return 1 - sum(r["w"] * r["h"] for r in rects) / ((x2 - x1) * (y2 - y1))


def foreign_label_hits(laid):
    """Labels with another relationship's segment running through them."""
    n = 0
    rels = laid.get("relationships", [])
    for i, r in enumerate(rels):
        lb = r.get("labelBox")
        if not lb:
            continue
        hit = False
        for j, o in enumerate(rels):
            if i == j:
                continue
            pts = o.get("points") or []
            for a, b in zip(pts, pts[1:]):
                if min(a[0], b[0]) < lb["x"] + lb["w"] and max(a[0], b[0]) > lb["x"] and min(a[1], b[1]) <= lb["y"] + lb["h"] and max(a[1], b[1]) >= lb["y"]:
                    hit = True
        n += hit
    return n


def measure(laid):
    c = laid["canvas"]
    w, h = c["width"], c["height"]
    length = bends = 0
    for rel in laid.get("relationships", []):
        pts = rel.get("points") or []
        bends += max(0, len(pts) - 2)
        for a, b in zip(pts, pts[1:]):
            length += abs(b[0] - a[0]) + abs(b[1] - a[1])
    area = sum(e["box"]["w"] * e["box"]["h"] for e in laid["entities"])
    return {
        "w": w, "h": h, "aspect": max(w, h) / min(w, h), "wide": w >= h,
        "zoom": min(1.0, VIEW_W / w, VIEW_H / h), "crossings": c["crossings"],
        "length": length, "bends": bends, "density": area / (w * h),
        "hub": hub_distance(laid), "empty": empty_area(laid), "labels": foreign_label_hits(laid),
    }


def targets(name, m):
    """List of (description, ok) for the acceptance table."""
    base = BASELINE.get(name)
    t = [("hub of every group of 4+ tables within half a cell of its centre", m["hub"] <= 0.51),
         ("no label under another line", m["labels"] == 0)]
    if name == "saas-billing":
        t += [("fit zoom >= 40%", m["zoom"] >= 0.40), ("density >= 22%", m["density"] >= 0.22),
              ("line length <= 60% of baseline", m["length"] <= 0.6 * base[3]), ("crossings <= 4", m["crossings"] <= 4),
              ("bends <= 60% of baseline", m["bends"] <= 0.6 * base[4]),
              ("aspect 1.0..1.9, wider than tall", 1.0 <= m["aspect"] <= 1.9 and m["wide"])]
    elif name == "four-areas-wide":
        t += [("aspect <= 2.0", m["aspect"] <= 2.0), ("fit zoom >= 70%", m["zoom"] >= 0.70)]
    elif name == "example-erd":
        t += [("aspect <= 2.0", m["aspect"] <= 2.0), ("crossings 0", m["crossings"] == 0), ("line length <= baseline", m["length"] <= base[3])]
    return t


def main():
    check = "--check" in sys.argv[1:]
    rows = []
    failed = []
    for name, data in load_fixtures().items():
        m = measure(run_engine(data))
        rows.append((name, m))
        for desc, ok in targets(name, m):
            if not ok:
                failed.append(f"{name}: {desc}")
    head = f"{'Fixture':<20}{'Canvas':>12}{'Aspect':>8}{'Fit zoom':>10}{'Cross':>7}{'Length':>9}{'Bends':>7}{'Density':>9}{'Hub':>6}{'Empty':>7}{'LblHit':>7}"
    print(head)
    print("-" * len(head))
    for name, m in rows:
        print(f"{name:<20}{str(m['w']) + 'x' + str(m['h']):>12}{m['aspect']:>8.2f}{m['zoom']:>9.0%}{m['crossings']:>7}{m['length']:>9}{m['bends']:>7}{m['density']:>9.0%}{m['hub']:>6.1f}{m['empty']:>7.0%}{m['labels']:>7}")
        b = BASELINE.get(name)
        if b:
            asp = max(b[0], b[1]) / min(b[0], b[1])
            z = min(1.0, VIEW_W / b[0], VIEW_H / b[1])
            print(f"{'  v1 baseline':<20}{str(b[0]) + 'x' + str(b[1]):>12}{asp:>8.2f}{z:>9.0%}{b[2]:>7}{b[3]:>9}{b[4]:>7}{b[5]:>9.0%}")
    if check:
        if failed:
            print("\nTARGETS MISSED:")
            for f in failed:
                print("  - " + f)
            return 1
        print("\nall acceptance targets met")
    return 0


if __name__ == "__main__":
    sys.exit(main())
