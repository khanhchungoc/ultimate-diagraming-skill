// C4 gutter routing. Pure JS, no DOM, no imports: a plain script loaded after assets/shell/ortho-router.js and before
// engine.js (ENGINE_JS in layout_engine.py, scripts/run_engine.mjs, scripts/engine_runner.py). Contract: Gutter routing
// interface in dev/plans/plan-c4.md.
//
// routeC4Edges(nodes, edges) -> [{ d, points, lx, ly, w }], one per edge, same order.
//   nodes  { id: { x, y, w, h, item: { id, x, y, w, h } } }   x, y = centre; item = the frame (or loose element) the box is in
//   edges  [{ from, to, label, tech, hint }]                    hint: 'v' | 'h' | 'u' | absent
// One bend (a loop under a row has two); the run sits between the facing edges of the two ITEMS; ports on a side follow the
// order of the targets; runs that share a gutter get their own lane; loops under a row get lanes 16px apart; labels sit on a
// run (or leg) long enough for them and slide along it off any other pill or box. Text widths: TOKENS.font.metrics.
// Path rounding: buildCurvedPathWithHops (ortho-router.js). Deterministic; O(n log n) in nodes + edges (grid lookups only).

const C4R = { PILL_H: 32, LOOP_GAP: 40, LOOP_LANE: 16, RUN_LANE: 10, MAX_W: 240, CELL: 96, ARROW: 16 };

function c4rLabelW(label, tech) {
  const M = TOKENS.font.metrics, t = String(label == null ? '' : label);
  if (!t) return 0;
  const techW = tech ? (String(tech).length + 2) * M.detail + 20 : 0;
  return Math.round(Math.max(48, Math.min(t.length * M.edgeLabel + 20, C4R.MAX_W), Math.min(techW, C4R.MAX_W)));
}

// Hash grid of rectangles {x, y, w, h} (top-left): cells hold the rects touching them.
function c4rGrid() {
  const cells = new Map(), K = C4R.CELL;
  const key = (i, j) => (i + 50000) * 100000 + (j + 50000);
  const span = (r, pad) => [Math.floor((r.x - pad) / K), Math.floor((r.x + r.w + pad) / K), Math.floor((r.y - pad) / K), Math.floor((r.y + r.h + pad) / K)];
  return {
    add(r) {
      const [i0, i1, j0, j1] = span(r, 0);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const k = key(i, j); let c = cells.get(k);
        if (!c) cells.set(k, c = []);
        c.push(r);
      }
    },
    hit(r, pad) {
      const [i0, i1, j0, j1] = span(r, pad);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const c = cells.get(key(i, j));
        if (c) for (const o of c) if (r.x - pad < o.x + o.w && o.x < r.x + r.w + pad && r.y - pad < o.y + o.h && o.y < r.y + r.h + pad) return true;
      }
      return false;
    }
  };
}

// Greedy interval lanes: items [{lo, hi}] in the order given; returns a lane number per item (smallest lane whose
// intervals do not touch it). Lanes keep their intervals sorted, so a check is a binary search.
function c4rLanes(items, gap) {
  const lanes = [], out = [];
  for (const it of items) {
    let lane = 0;
    for (; lane < lanes.length; lane++) {
      const L = lanes[lane];
      let a = 0, b = L.length;                                   // first interval whose lo >= it.lo
      while (a < b) { const m = (a + b) >> 1; if (L[m].lo < it.lo) a = m + 1; else b = m; }
      if ((a === 0 || L[a - 1].hi + gap <= it.lo) && (a === L.length || it.hi + gap <= L[a].lo)) { L.splice(a, 0, it); break; }
    }
    if (lane === lanes.length) lanes.push([it]);
    out.push(lane);
  }
  return { lane: out, count: lanes.length };
}

function routeC4Edges(nodes, edges) {
  const H = C4R.PILL_H;
  // ---- per edge: axis, direction, side keys ----
  const info = edges.map((e, i) => {
    const A = nodes[e.from], B = nodes[e.to];
    if (!A || !B) throw new Error(`routeC4Edges: edge ${i} joins an unknown node (${e.from} -> ${e.to})`);
    const dx = B.x - A.x, dy = B.y - A.y;
    const gapV = Math.abs(dy) - (A.h + B.h) / 2, gapH = Math.abs(dx) - (A.w + B.w) / 2;
    let vert = e.hint === 'v' || e.hint === 'h' ? e.hint === 'v' : gapV >= gapH;
    if (e.hint === 'u') vert = true;
    if (e.hint !== 'u' && (vert ? gapV : gapH) < 0 && (vert ? gapH : gapV) > (vert ? gapV : gapH)) vert = !vert;   // boxes overlap on the chosen axis: use the other
    const M = vert ? 'y' : 'x', C = vert ? 'x' : 'y', S = vert ? 'h' : 'w', Z = vert ? 'w' : 'h';
    const s = Math.sign(B[M] - A[M]) || 1, u = e.hint === 'u';
    return { i, A, B, M, C, S, Z, s, vert, u, label: e.label, tech: e.tech, t0: vert ? 0.5 : 0.2,
      keyA: u ? e.from + '|y1' : e.from + '|' + M + s, keyB: u ? e.to + '|y1' : e.to + '|' + M + (-s) };
  });

  // ---- ports: along each node side, in the order of the targets (ties: input order) ----
  const sides = new Map();
  for (const e of info) {
    const a = e.u ? e.B.x : e.B[e.C], b = e.u ? e.A.x : e.A[e.C];
    for (const [k, end, o] of [[e.keyA, 'a', a], [e.keyB, 'b', b]]) {
      let g = sides.get(k); if (!g) sides.set(k, g = []);
      g.push({ e, end, o });
    }
  }
  for (const g of sides.values()) {
    g.sort((p, q) => p.o - q.o || p.e.i - q.e.i || (p.end < q.end ? -1 : 1));
    g.forEach((p, k) => {
      const n = p.end === 'a' ? p.e.A : p.e.B, C = p.e.u ? 'x' : p.e.C, Z = p.e.u ? 'w' : p.e.Z;
      p.e['p' + p.end] = n[C] + ((k + 1) / (g.length + 1) - 0.5) * n[Z];
    });
  }
  // near-aligned ends become one straight line
  for (const e of info) {
    if (e.u || Math.abs(e.pa - e.pb) >= 24) continue;
    const lo = Math.max(e.A[e.C] - e.A[e.Z] / 2, e.B[e.C] - e.B[e.Z] / 2) + 10, hi = Math.min(e.A[e.C] + e.A[e.Z] / 2, e.B[e.C] + e.B[e.Z] / 2) - 10;
    if (lo <= hi) { e.pa = e.pb = Math.min(hi, Math.max(lo, (e.pa + e.pb) / 2)); e.straight = true; }
  }
  // bends of arrows leaving one side nest: the widest spread bends nearest the source
  for (const g of sides.values()) {
    const a = g.filter((p) => p.end === 'a' && !p.e.u && !p.e.straight).sort((p, q) => Math.abs(q.e.pb - q.e.pa) - Math.abs(p.e.pb - p.e.pa) || p.e.i - q.e.i);
    if (a.length > 1) a.forEach((p, r) => { p.e.t0 = p.e.vert ? 0.3 + 0.55 * r / (a.length - 1) : 0.2 + 0.3 * r / (a.length - 1); });
  }

  // ---- one-bend runs: the bend lies between the facing edges of the two ITEMS ----
  const runs = new Map();
  for (const e of info) {
    if (e.u) continue;
    const { A, B, M, S, s } = e;
    e.m0 = A[M] + s * A[S] / 2; e.m1 = B[M] - s * B[S] / 2;
    const same = A.item.id === B.item.id;
    e.g0 = same ? e.m0 : A.item[M] + s * A.item[S] / 2;
    e.g1 = same ? e.m1 : B.item[M] - s * B.item[S] / 2;
    e.bend = e.g0 + (e.g1 - e.g0) * e.t0;
    if (e.straight) continue;
    const lo = Math.min(e.g0, e.g1), hi = Math.max(e.g0, e.g1), k = (e.vert ? 'v' : 'h') + Math.round(lo) + '|' + Math.round(hi);
    let r = runs.get(k); if (!r) runs.set(k, r = { lo, hi, list: [] });
    r.list.push(e);
  }
  // runs sharing a gutter and a stretch get a lane each (lanes evenly across the gutter), the rest keep their bend
  for (const r of runs.values()) {
    if (r.list.length < 2) continue;
    const ord = r.list.slice().sort((p, q) => p.bend - q.bend || p.i - q.i);
    const { lane, count } = c4rLanes(ord.map((e) => ({ lo: Math.min(e.pa, e.pb), hi: Math.max(e.pa, e.pb) })), 6);
    if (count < 2) continue;
    const slot = Math.min(C4R.RUN_LANE, (r.hi - r.lo) / (count + 1));
    const span = slot * (count - 1), mid = (r.lo + r.hi) / 2;
    ord.forEach((e, k) => { e.bend = mid - span / 2 + lane[k] * slot; });
  }

  // ---- loops under a row: base line below every item the span passes, then lanes 16px apart ----
  const loops = info.filter((e) => e.u);
  if (loops.length) {
    const K = 128, cols = new Map(), seen = new Set();
    for (const id in nodes) {
      const it = nodes[id].item; if (seen.has(it.id)) continue; seen.add(it.id);
      for (let c = Math.floor((it.x - it.w / 2) / K); c <= Math.floor((it.x + it.w / 2) / K); c++) {
        let a = cols.get(c); if (!a) cols.set(c, a = []); a.push(it);
      }
    }
    const groups = new Map();
    for (const e of loops) {
      const x0 = Math.min(e.pa, e.pb), x1 = Math.max(e.pa, e.pb), ia = e.A.item, ib = e.B.item;
      const top = Math.min(ia.y - ia.h / 2, ib.y - ib.h / 2);
      let bottom = Math.max(ia.y + ia.h / 2, ib.y + ib.h / 2);
      for (let c = Math.floor(x0 / K); c <= Math.floor(x1 / K); c++) {
        const a = cols.get(c);
        if (a) for (const it of a) if (it.x + it.w / 2 > x0 && it.x - it.w / 2 < x1 && it.y + it.h / 2 > top && it.y - it.h / 2 < bottom) bottom = Math.max(bottom, it.y + it.h / 2);
      }
      e.base = bottom + C4R.LOOP_GAP;
      let g = groups.get(e.base); if (!g) groups.set(e.base, g = []);
      g.push(e);
    }
    for (const g of groups.values()) {
      const ord = g.slice().sort((p, q) => Math.abs(p.pb - p.pa) - Math.abs(q.pb - q.pa) || p.i - q.i);   // inner (short) loops nest above outer ones
      const { lane } = c4rLanes(ord.map((e) => ({ lo: Math.min(e.pa, e.pb), hi: Math.max(e.pa, e.pb) })), 8);
      ord.forEach((e, k) => { e.yb = e.base + C4R.LOOP_LANE * lane[k]; });
    }
  }

  // ---- polylines ----
  for (const e of info) {
    const { A, B } = e;
    if (e.u) {
      e.pts = [[e.pa, A.y + A.h / 2], [e.pa, e.yb], [e.pb, e.yb], [e.pb, B.y + B.h / 2]];
    } else {
      const xy = (m, c) => (e.vert ? [c, m] : [m, c]);
      e.pts = e.pa === e.pb ? [xy(e.m0, e.pa), xy(e.m1, e.pb)] : [xy(e.m0, e.pa), xy(e.bend, e.pa), xy(e.bend, e.pb), xy(e.m1, e.pb)];
    }
  }

  // ---- labels, in input order: on a run long enough, slid along it off every placed pill and every box ----
  const boxes = c4rGrid(), pills = c4rGrid();
  for (const id in nodes) { const n = nodes[id]; boxes.add({ x: n.x - n.w / 2, y: n.y - n.h / 2, w: n.w, h: n.h }); }
  const out = new Array(edges.length);
  for (const e of info) {
    const w = c4rLabelW(e.label, e.tech), pts = e.pts;
    let pos = null;
    if (w) {
      // segments by preference: the run (middle segment) first, then the legs, longest first
      const segs = [];
      for (let k = 0; k < pts.length - 1; k++) {
        const p = pts[k], q = pts[k + 1], horiz = p[1] === q[1];
        segs.push({ k, p, q, horiz, len: Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]), fit: 0 });
      }
      for (const s of segs) {
        const room = s.horiz ? s.len - w - 16 : s.len - H - C4R.ARROW - 8;
        s.fit = room >= 0 ? 1 : 0;
        s.room = Math.max(0, room);
        s.mid = (s.k === 1 && pts.length === 4) || pts.length === 2 ? 0 : 1;
      }
      segs.sort((a, b) => b.fit - a.fit || a.mid - b.mid || b.len - a.len || a.k - b.k);
      let fallback = null;
      search: for (const s of segs) {
        // centre of the part the arrowhead leaves free on the last segment; slide outwards from there
        const last = s.k === pts.length - 2, t0 = last ? Math.max(0, s.len - C4R.ARROW) / 2 / (s.len || 1) : 0.5;
        const steps = Math.min(24, Math.ceil(s.room / 8));
        for (let n = 0; n <= 2 * steps; n++) {
          const off = (n === 0 ? 0 : (n & 1 ? 1 : -1) * Math.ceil(n / 2)) * (steps ? s.room / 2 / steps : 0);
          const f = t0 + (s.len ? off / s.len : 0);
          const cx = s.p[0] + (s.q[0] - s.p[0]) * f, cy = s.p[1] + (s.q[1] - s.p[1]) * f;
          const r = { x: cx - w / 2, y: cy - H / 2, w, h: H };
          if (!fallback) fallback = { cx, cy, r };
          if (!boxes.hit(r, 2) && !pills.hit(r, 2)) { pos = { cx, cy, r }; break search; }
          if (!steps) break;
        }
      }
      if (!pos) pos = fallback;
      pills.add(pos.r);
    } else {
      const a = pts[0], b = pts[pts.length - 1];
      pos = { cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2 };
    }
    out[e.i] = { d: buildCurvedPathWithHops(pts, [], 8), points: pts, lx: pos.cx, ly: pos.cy, w };
  }
  return out;
}
