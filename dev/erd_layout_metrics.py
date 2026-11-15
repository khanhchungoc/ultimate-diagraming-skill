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
ENGINE = ROOT / "assets" / "types" / "erd" / "engine.js"
RUNNER = ROOT / "scripts" / "run_engine.mjs"
VIEW_W, VIEW_H = 1760, 856


def load_fixtures():
    out = {}
    for path in sorted((ROOT / "dev" / "fixtures" / "erd").glob("*.json")):
        out[path.stem] = json.loads(path.read_text(encoding="utf8"))
    out["example-erd"] = json.loads((ROOT / "references" / "examples" / "example-erd.json").read_text(encoding="utf8"))
    return out


def run_engine(data):
    res = subprocess.run(["node", str(RUNNER), str(ENGINE)], input=json.dumps(data), capture_output=True, text=True)
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
    return {
        "w": w, "h": h, "aspect": max(w, h) / min(w, h), "wide": w >= h,
        "zoom": min(1.0, VIEW_W / w, VIEW_H / h), "crossings": c["crossings"], "length": round(length),
        "hits": table_hits(laid), "top3": central_third(laid, top3), "hub": hub, "hubOff": off, "hubSides": sides,
    }


def targets(name, m):
    """List of (description, ok) for the acceptance table."""
    t = []
    if name == "saas-billing":
        t += [("fit zoom >= 60%", m["zoom"] >= 0.60), ("crossings <= 2", m["crossings"] <= 2),
              ("0 curves over unrelated tables", m["hits"] == 0), ("aspect 1.2..2.0, wider than tall", 1.2 <= m["aspect"] <= 2.0 and m["wide"]),
              ("top-3-degree tables in the central third", m["top3"])]
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
