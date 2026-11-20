#!/usr/bin/env python3
"""Layout metrics of the ERD engine (assets/types/erd/engine.js) for every ERD fixture.

Runs the engine through `node scripts/run_engine.mjs` and prints, per fixture: canvas, aspect (long side / short side),
fit zoom (view 1760 x 856, min(1, 1760/W, 856/H)), crossings, curve length (sum of the segment lengths of
relationships[].points), curves over unrelated tables, and where the three most connected tables sit.

  python3 dev/erd_layout_metrics.py            print the table
  python3 dev/erd_layout_metrics.py --check    also exit 1 when an acceptance target of dev/plans/plan-erd-layout-v3.md is missed
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from tokens import load_tokens, tokens_data  # noqa: E402
ENGINE = ROOT / "assets" / "types" / "erd" / "engine.js"
RUNNER = ROOT / "scripts" / "run_engine.mjs"
VIEW_W, VIEW_H = 1760, 856


def load_fixtures():
    out = {}
    for path in sorted((ROOT / "dev" / "fixtures" / "erd").glob("*.json")):
        data = json.loads(path.read_text(encoding="utf8"))
        if data.get("entities"):   # the blank fixture has no table: nothing to measure
            out[path.stem] = data
    out["example-erd"] = json.loads((ROOT / "dev" / "examples" / "example-erd.json").read_text(encoding="utf8"))
    return out


def run_engine(data):
    res = subprocess.run(["node", str(RUNNER), str(ENGINE)], input=json.dumps({"tokens": tokens_data(load_tokens()), "diagram": data}), capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or "engine failed")
    return res.stdout


def degrees(laid):
    deg = {}
    for rel in laid.get("relationships", []):
        if rel["from"] != rel["to"]:
            for k in (rel["from"], rel["to"]):
                deg[k] = deg.get(k, 0) + 1
    return deg


def centre(e):
    b = e["box"]
    return b["x"] + b["w"] / 2, b["y"] + b["h"] / 2


def table_hits(laid):
    """Curves that run through a table they are not part of (points of the curve, densified every ~4 px, inside the box)."""
    boxes = {e["id"]: e["box"] for e in laid["entities"]}
    n = 0
    for r in laid.get("relationships", []):
        pts = r.get("points") or []
        dense = []
        for a, b in zip(pts, pts[1:]):
            k = max(1, int(max(abs(b[0] - a[0]), abs(b[1] - a[1])) // 4))
            dense += [(a[0] + (b[0] - a[0]) * i / k, a[1] + (b[1] - a[1]) * i / k) for i in range(k)]
        dense += [tuple(p) for p in pts[-1:]]
        for tid, b in boxes.items():
            if tid in (r["from"], r["to"]):
                continue
            if any(b["x"] < x < b["x"] + b["w"] and b["y"] < y < b["y"] + b["h"] for x, y in dense):
                n += 1
    return n


def central_third(laid, ids):
    """True when the centre of every table in ids lies in the middle third of the tables' bounding box, on both axes."""
    boxes = [e["box"] for e in laid["entities"]]
    x0 = min(b["x"] for b in boxes); x1 = max(b["x"] + b["w"] for b in boxes)
    y0 = min(b["y"] for b in boxes); y1 = max(b["y"] + b["h"] for b in boxes)
    for e in laid["entities"]:
        if e["id"] in ids:
            cx, cy = centre(e)
            if not (x0 + (x1 - x0) / 3 <= cx <= x1 - (x1 - x0) / 3 and y0 + (y1 - y0) / 3 <= cy <= y1 - (y1 - y0) / 3):
                return False
    return True


def hub_spread(laid):
    """(hub id, hub offset from the bounding-box centre as a share of the box, number of sides its neighbours are on)."""
    deg = degrees(laid)
    hub = max(laid["entities"], key=lambda e: (deg.get(e["id"], 0), -laid["entities"].index(e)))
    by = {e["id"]: e for e in laid["entities"]}
    boxes = [e["box"] for e in laid["entities"]]
    x0 = min(b["x"] for b in boxes); x1 = max(b["x"] + b["w"] for b in boxes)
    y0 = min(b["y"] for b in boxes); y1 = max(b["y"] + b["h"] for b in boxes)
    hx, hy = centre(hub)
    off = max(abs(hx - (x0 + x1) / 2) / (x1 - x0), abs(hy - (y0 + y1) / 2) / (y1 - y0))
    sides = set()
    for r in laid["relationships"]:
        for a, b in ((r["from"], r["to"]), (r["to"], r["from"])):
            if a == hub["id"] and b != a:
                ox, oy = centre(by[b])
                dx, dy = (ox - hx) / hub["box"]["w"], (oy - hy) / hub["box"]["h"]
                sides.add(("r" if dx > 0 else "l") if abs(dx) >= abs(dy) else ("b" if dy > 0 else "t"))
    return hub["id"], off, len(sides)


SPACED = ("saas-billing", "example-erd", "hub-and-spokes", "two-clusters", "four-areas-wide")
REL_GAP, REL_GAP_LABEL, EVEN_MAX, HOLE_MAX = 96, 64, 2.5, 0.12
GAP_X, GAP_Y = 80, 56   # the engine's clear space between tables (ER.GAP_X, ER.GAP_Y)


def side_of(pt, b):
    """Side of the box a curve end sits on: 0 right, 1 left, 2 bottom, 3 top."""
    d = [abs(pt[0] - (b["x"] + b["w"])), abs(pt[0] - b["x"]), abs(pt[1] - (b["y"] + b["h"])), abs(pt[1] - b["y"])]
    return d.index(min(d))


def rel_gaps(laid):
    """[(gap px, needed px, 'from -> to')]: edge-to-edge gap along the axis of the side each curve leaves its first table by,
    and the least it needs (96, or label width + 64 when the line has a label)."""
    by = {e["id"]: e["box"] for e in laid["entities"]}
    out = []
    for r in laid.get("relationships", []):
        if r["from"] == r["to"] or "curve" not in r:
            continue
        a, b = by[r["from"]], by[r["to"]]
        s = side_of(r["curve"][0], a)
        if s < 2:
            gap = b["x"] - (a["x"] + a["w"]) if b["x"] >= a["x"] else a["x"] - (b["x"] + b["w"])
        else:
            gap = b["y"] - (a["y"] + a["h"]) if b["y"] >= a["y"] else a["y"] - (b["y"] + b["h"])
        need = max(REL_GAP, r["labelBox"]["w"] + REL_GAP_LABEL) if r.get("label") and "labelBox" in r else REL_GAP
        out.append((gap, need, f"{r['from']} -> {r['to']}"))
    return out


def nearest_gaps(laid):
    """Per table, the edge-to-edge distance to its nearest other table."""
    boxes = [(e["id"], e["box"]) for e in laid["entities"]]
    out = []
    for i, (k, a) in enumerate(boxes):
        best = min(
            (max(0, a["x"] - (b["x"] + b["w"]), b["x"] - (a["x"] + a["w"])) ** 2 + max(0, a["y"] - (b["y"] + b["h"]), b["y"] - (a["y"] + a["h"])) ** 2) ** 0.5
            for j, (_, b) in enumerate(boxes) if j != i)
        out.append((best, k))
    return out


def hole_share(laid):
    """Largest empty axis-aligned rectangle in the tables' bounding box that touches no table (each inflated by gap/2),
    as a share of the box area. Corners come from the inflated edges, so the search is exact."""
    boxes = [e["box"] for e in laid["entities"]]
    x0 = min(b["x"] for b in boxes); x1 = max(b["x"] + b["w"] for b in boxes)
    y0 = min(b["y"] for b in boxes); y1 = max(b["y"] + b["h"] for b in boxes)
    inf = [(b["x"] - GAP_X / 2, b["y"] - GAP_Y / 2, b["x"] + b["w"] + GAP_X / 2, b["y"] + b["h"] + GAP_Y / 2) for b in boxes]
    xs = sorted({x0, x1, *(min(max(v, x0), x1) for r in inf for v in (r[0], r[2]))})
    best = 0
    for i, xl in enumerate(xs):
        for xr in xs[i + 1:]:
            blocked = sorted((max(r[1], y0), min(r[3], y1)) for r in inf if r[0] < xr and r[2] > xl)
            top = y0
            for lo, hi in blocked:
                best = max(best, (xr - xl) * (lo - top)); top = max(top, hi)
            best = max(best, (xr - xl) * (y1 - top))
    return best / ((x1 - x0) * (y1 - y0))


def measure(laid):
    c = laid["canvas"]
    w, h = c["width"], c["height"]
    length = 0
    for rel in laid.get("relationships", []):
        pts = rel.get("points") or []
        for a, b in zip(pts, pts[1:]):
            length += ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5
    deg = degrees(laid)
    top3 = {k for k, _ in sorted(deg.items(), key=lambda kv: (-kv[1], kv[0]))[:3]}
    hub, off, sides = hub_spread(laid)
    rg = rel_gaps(laid)
    ng = nearest_gaps(laid)
    gs = sorted(g for g, _ in ng)
    med = gs[len(gs) // 2] if len(gs) % 2 else (gs[len(gs) // 2 - 1] + gs[len(gs) // 2]) / 2
    wn = max(ng)
    return {
        "relMin": min((g for g, _, _ in rg), default=0), "relShort": [f"{k} {g:.0f}<{n:.0f}" for g, n, k in rg if g < n],
        "evenWorst": wn[1], "evenRatio": wn[0] / med if med else 0, "hole": hole_share(laid),
        "w": w, "h": h, "aspect": max(w, h) / min(w, h), "wide": w >= h,
        "zoom": min(1.0, VIEW_W / w, VIEW_H / h), "crossings": c["crossings"], "length": round(length),
        "hits": table_hits(laid), "top3": central_third(laid, top3), "hub": hub, "hubOff": off, "hubSides": sides,
    }


def targets(name, m):
    """List of (description, ok) for the acceptance table."""
    t = []
    if name in SPACED:
        t += [("every relationship gap >= 96 px (label width + 64 px with a label): " + "; ".join(m["relShort"]), not m["relShort"]),
              (f"nearest-neighbour gap <= 2.5 x median: {m['evenRatio']:.2f} at {m['evenWorst']}", m["evenRatio"] <= EVEN_MAX),
              (f"largest empty rectangle <= 12% of the box: {m['hole']:.1%}", m["hole"] <= HOLE_MAX)]
    if name == "saas-billing":
        t += [("fit zoom >= 60%", m["zoom"] >= 0.60), ("crossings <= 2", m["crossings"] <= 2),
              # above ER.LITE tables the engine runs a lighter search, so a large schema may keep one curve over a table and its hubs off-centre
              ("at most 1 curve over an unrelated table", m["hits"] <= 1), ("aspect 1.2..2.0, wider than tall", 1.2 <= m["aspect"] <= 2.0 and m["wide"])]
    elif name == "example-erd":
        t += [("crossings 0", m["crossings"] == 0), ("0 curves over unrelated tables", m["hits"] == 0)]
    elif name == "hub-and-spokes":
        t += [("hub centred (within 10% of the box)", m["hubOff"] <= 0.10), ("neighbours on >= 3 sides", m["hubSides"] >= 3)]
    return t


def main():
    check = "--check" in sys.argv[1:]
    rows, failed = [], []
    for name, data in load_fixtures().items():
        raw = run_engine(data)
        if run_engine(data) != raw:
            failed.append(f"{name}: not deterministic (two runs differ)")
        m = measure(json.loads(raw))
        rows.append((name, m))
        for desc, ok in targets(name, m):
            if not ok:
                failed.append(f"{name}: {desc}")
    head = f"{'Fixture':<20}{'Canvas':>12}{'Aspect':>8}{'Fit zoom':>10}{'Cross':>7}{'Length':>9}{'Hits':>6}{'Top3 mid':>10}{'Hub off':>9}{'Sides':>6}"
    print(head)
    print("-" * len(head))
    for name, m in rows:
        print(f"{name:<20}{str(m['w']) + 'x' + str(m['h']):>12}{m['aspect']:>8.2f}{m['zoom']:>9.0%}{m['crossings']:>7}{m['length']:>9}{m['hits']:>6}{str(m['top3']):>10}{m['hubOff']:>9.2f}{m['hubSides']:>6}")
    print(f"\n{'Fixture':<20}{'Rel gap min':>12}{'short rels':>11}{'Even x med':>11}{'worst table':>16}{'Hole':>7}")
    for name, m in rows:
        if name in SPACED:
            print(f"{name:<20}{m['relMin']:>12.0f}{len(m['relShort']):>11}{m['evenRatio']:>11.2f}{m['evenWorst']:>16}{m['hole']:>7.1%}")
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
