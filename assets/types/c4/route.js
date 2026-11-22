// C4 gutter routing. Pure JS, no DOM, no imports: a plain script loaded after assets/shell/ortho-router.js and before
// engine.js (ENGINE_JS in layout_engine.py, scripts/run_engine.mjs, scripts/engine_runner.py). Contract: Gutter routing
// interface in dev/plans/plan-c4.md.
//
// routeC4Edges(nodes, edges, opts) -> [{ d, points, lx, ly, w }], one per edge, same order.
//   nodes  { id: { x, y, w, h } }                                         x, y = centre
//   edges  [{ from, to, label, tech, hint, itemA, itemB }]               hint: 'v' | 'h' | 'u' | 'r' | 'l' | absent
//          itemA, itemB = { id, x, y, w, h }: the two sibling items below the lowest group holding both ends (missing: the boxes)
// One bend (a loop has two: 'u' under a row, 'r' / 'l' out to the right / left of a column); the run sits between the facing edges of itemA and itemB; ports on a side follow the
// order of the targets; a leg that would cross a sibling box or a foreign frame moves along the side, else leaves through the
// frame's padding (side with more room, the 30px tag band excluded) and adds two bends; runs that share a gutter get their own
// lane; loops get lanes 16px apart (under a row, or sideways out of a column); labels sit on a run (or leg) long enough for them and slide along it off every
// box, tag band, other route and pill (least overlap if nothing is free). Text widths: TOKENS.font.metrics.
// Manual mode (opts.manual: boxes dragged anywhere): the same routes first, then every route that crosses a box it does not end on or a
// frame it does not enter is re-routed by c4rDetours (visibility grid, bends first, then length). opts.frames: [{id, x, y, w, h}] (centre) of all
// expanded frames. Detours: pad 20, 12 or 6px (the first that leaves a path), regions grown 40 -> 160 -> 600 -> whole scene, a fixed work budget per call (C4R.WORK; routes past it keep their ring route). Without opts the output is the ring layout's, byte for byte.
// Path rounding: buildCurvedPathWithHops (ortho-router.js). Deterministic; O(n log n) in nodes + edges (grid lookups only).

const C4R = { PAD: 12, PADS: [20, 12, 6], SHARE: 2000, WORK: 13000, SEARCH: 4000,  LANE: 12, MARGINS: [40, 160, 600], BIG: 1e6, PILL_H: 32, PILL_H2: 38, LOOP_GAP: 40, LOOP_LANE: 16, RUN_LANE: 10, MAX_W: 240, CELL: 96, ARROW: 16, TAG: (typeof TOKENS !== 'undefined' && TOKENS.c4 && TOKENS.c4.tagH) || 44, ESC_MIN: 6 };

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
    // visits each distinct rect near r (grown by pad) that passes pred; cb returns true to stop
    scan(r, pad, pred, cb, dedupe) {
      const [i0, i1, j0, j1] = span(r, pad), seen = dedupe ? new Set() : null;
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const c = cells.get(key(i, j));
        if (c) for (const o of c) if (r.x - pad < o.x + o.w && o.x < r.x + r.w + pad && r.y - pad < o.y + o.h && o.y < r.y + r.h + pad && (!seen || !seen.has(o)) && (!pred || pred(o))) {
          if (seen) seen.add(o);
          if (cb && cb(o)) return;
        }
      }
    },
    hit(r, pad, pred) { let h = false; this.scan(r, pad, pred, () => (h = true)); return h; },
    count(r, pad, pred) { let n = 0; this.scan(r, pad, pred, () => { n++; }, true); return n; }
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

// ---- manual mode: obstacle-avoiding detours ----
// Binary min-heap on (cost, seq): the seq makes ties deterministic.
function c4rHeap() {
  const c = [], q = [], s = [];
  const less = (a, b) => c[a] < c[b] || (c[a] === c[b] && q[a] < q[b]);
  const swap = (a, b) => { let t = c[a]; c[a] = c[b]; c[b] = t; t = q[a]; q[a] = q[b]; q[b] = t; t = s[a]; s[a] = s[b]; s[b] = t; };
  let n = 0, seq = 0;
  return {
    cost: 0,
    get size() { return n; },
    push(cost, st) {
      c[n] = cost; q[n] = seq++; s[n] = st;
      for (let i = n++; i > 0;) { const p = (i - 1) >> 1; if (!less(i, p)) break; swap(i, p); i = p; }
    },
    pop() {
      const st = s[0]; this.cost = c[0]; n--;
      if (n > 0) {
        c[0] = c[n]; q[0] = q[n]; s[0] = s[n];
        for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < n && less(l, m)) m = l; if (r < n && less(r, m)) m = r; if (m === i) break; swap(i, m); i = m; }
      }
      return st;
    }
  };
}

// Shortest orthogonal path on the visibility grid of the obstacle sides (padded). Directions 0 E, 1 S, 2 W, 3 N; cost = bends * BIG + length.
// starts / goals: [{ x, y, dir, pen, port }] stub points one pad off a box side (dir: the way out of the box). Returns [[x, y]...], null (no path) or false (work budget spent: W.left, per search C4R.SEARCH).
function c4rGridPath(region, obs, used, starts, goals, W) {
  const L = C4R.LANE, [rx0, ry0, rx1, ry1] = region;
  const xs = new Set([rx0, rx1]), ys = new Set([ry0, ry1]);
  const inX = (v) => v >= rx0 && v <= rx1, inY = (v) => v >= ry0 && v <= ry1;
  for (const o of obs) { for (const v of [o.x0, o.x1]) if (inX(v)) xs.add(v); for (const v of [o.y0, o.y1]) if (inY(v)) ys.add(v); }
  for (const t of starts.concat(goals)) { xs.add(t.x); ys.add(t.y); xs.add(t.port[0]); ys.add(t.port[1]); }
  for (const u of used) {                                                   // lanes beside a detour that is already there, and its corners
    for (const k of [-1, 0, 1]) { const v = u.c + k * L; if (u.h ? inY(v) : inX(v)) (u.h ? ys : xs).add(v); }
    for (const v of [u.lo, u.hi]) if (u.h ? inX(v) : inY(v)) (u.h ? xs : ys).add(v);
  }
  const X = Array.from(xs).sort((a, b) => a - b), Y = Array.from(ys).sort((a, b) => a - b), nx = X.length, ny = Y.length;
  W.left -= obs.length * 4;
  const cap = Math.min(W.left, C4R.SEARCH);                                 // work units: grid cells built + states popped
  if (nx * ny > cap / 2) { W.left -= (nx + ny) * 4; return false; }
  W.left -= nx * ny;
  let pops = 0;
  const lo = (A, v) => { let a = 0, b = A.length; while (a < b) { const m = (a + b) >> 1; if (A[m] < v) a = m + 1; else b = m; } return a; };   // first index with A[i] >= v
  const hi = (A, v) => { let a = 0, b = A.length; while (a < b) { const m = (a + b) >> 1; if (A[m] <= v) a = m + 1; else b = m; } return a; };   // first index with A[i] > v
  const bh = new Uint8Array(ny * (nx - 1)), bv = new Uint8Array((ny - 1) * nx), lh = new Uint8Array(ny * (nx - 1)), lv = new Uint8Array((ny - 1) * nx);
  for (const o of obs) {                                                    // an edge is blocked when its line is strictly inside and its span lies inside
    const xa = lo(X, o.x0), xb = hi(X, o.x1), ya = lo(Y, o.y0), yb = hi(Y, o.y1);      // grid lines on the obstacle: [xa, xb), [ya, yb)
    for (let j = hi(Y, o.y0); j < lo(Y, o.y1); j++) for (let i = xa; i < xb - 1; i++) bh[j * (nx - 1) + i] = 1;
    for (let i = hi(X, o.x0); i < lo(X, o.x1); i++) for (let j = ya; j < yb - 1; j++) bv[j * nx + i] = 1;
  }
  for (const u of used) {                                                   // parallel and overlapping a detour closer than one lane: blocked
    if (u.h) {
      for (let j = lo(Y, u.c - L + 1e-6); j < ny && Y[j] < u.c + L - 1e-6; j++) for (let i = lo(X, u.lo); i < nx - 1 && X[i + 1] <= u.hi; i++) lh[j * (nx - 1) + i] = 1;
    } else {
      for (let i = lo(X, u.c - L + 1e-6); i < nx && X[i] < u.c + L - 1e-6; i++) for (let j = lo(Y, u.lo); j < ny - 1 && Y[j + 1] <= u.hi; j++) lv[j * nx + i] = 1;
    }
  }
  const idx = (x, y) => { const i = lo(X, x), j = lo(Y, y); return X[i] === x && Y[j] === y ? j * nx + i : -1; };
  const stubOf = new Uint8Array(nx * ny), goalAt = new Map();
  const inside = (x, y) => obs.some((o) => x > o.x0 && x < o.x1 && y > o.y0 && y < o.y1);
  const ok = (t) => !inside(t.x, t.y);
  starts = starts.filter(ok); goals = goals.filter(ok);
  starts.forEach((t) => { t.n = idx(t.x, t.y); stubOf[t.n] = 1; });
  goals.forEach((t) => { t.n = idx(t.x, t.y); stubOf[t.n] = 1; (goalAt.get(t.n) || goalAt.set(t.n, []).get(t.n)).push(t); });
  if (!starts.length || !goals.length) return null;
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1], NS = nx * ny * 4, GOAL = NS;
  const dist = new Float64Array(NS + 1).fill(Infinity), par = new Int32Array(NS + 1).fill(-1), heap = c4rHeap();
  starts.forEach((t) => { const s = t.n * 4 + t.dir; if (t.pen < dist[s]) { dist[s] = t.pen; heap.push(t.pen, s); } });
  let end = null;
  while (heap.size) {
    const st = heap.pop(), cost = heap.cost;
    if (++pops > cap) { W.left -= pops; return false; }
    if (cost > dist[st]) continue;
    if (st === GOAL) { end = par[GOAL]; break; }
    const n = st >> 2, d = st & 3, i = n % nx, j = (n - i) / nx;
    const gs = goalAt.get(n);
    if (gs) for (const g of gs) { const f = cost + g.pen + (g.dir === d ? 0 : C4R.BIG); if (f < dist[GOAL]) { dist[GOAL] = f; par[GOAL] = st; heap.push(f, GOAL); } }
    for (let t = 0; t < 3; t++) {
      const nd = t === 0 ? d : (d + (t === 1 ? 1 : 3)) & 3;
      const ni = i + DX[nd], nj = j + DY[nd];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      const horiz = nd === 0 || nd === 2, k = horiz ? j * (nx - 1) + Math.min(i, ni) : Math.min(j, nj) * nx + i;
      if (horiz ? bh[k] : bv[k]) continue;
      const m = nj * nx + ni;
      const share = (horiz ? lh[k] : lv[k]) && !stubOf[n] && !stubOf[m] ? C4R.SHARE : 0;               // sharing a lane costs, never blocks
      const f = cost + share + Math.abs(X[ni] - X[i]) + Math.abs(Y[nj] - Y[j]) + (nd === d ? 0 : C4R.BIG), ns = m * 4 + nd;
      if (f < dist[ns]) { dist[ns] = f; par[ns] = st; heap.push(f, ns); }
    }
  }
  W.left -= pops;
  if (end === null) return null;
  const pts = [];
  for (let s = end; s !== -1; s = par[s]) { const n = s >> 2; pts.push([X[n % nx], Y[(n - n % nx) / nx]]); }
  return pts.reverse();
}

// Re-routes (in input order) every route that crosses a box other than its two ends or a frame that holds neither end. Mutates info[].pts.
function c4rDetours(info, nodes, frames, boxes, frameGrid, simplify) {
  const used = [], W = { left: C4R.WORK };                                         // one work budget per call: the rest keep their route
  let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;           // the whole scene: the last resort region
  for (const n of Object.values(nodes).concat(Array.from(frames.values()))) {
    sx0 = Math.min(sx0, n.x - n.w / 2); sx1 = Math.max(sx1, n.x + n.w / 2); sy0 = Math.min(sy0, n.y - n.h / 2); sy1 = Math.max(sy1, n.y + n.h / 2);
  }
  const holds = (f, n) => n.x > f.x && n.x < f.x + f.w && n.y > f.y && n.y < f.y + f.h;
  const crosses = (e) => {
    const foreign = (f) => !holds(f, e.A) && !holds(f, e.B);
    for (let k = 0; k < e.pts.length - 1; k++) {
      const p = e.pts[k], q = e.pts[k + 1], r = { x: Math.min(p[0], q[0]), y: Math.min(p[1], q[1]), w: Math.abs(q[0] - p[0]), h: Math.abs(q[1] - p[1]) };
      if (boxes.hit(r, 0, (b) => b.id !== e.from && b.id !== e.to) || frameGrid.hit(r, 0, foreign)) return true;
    }
    return false;
  };
  for (const e of info) {
    if (W.left <= 0) break;
    if (!crosses(e)) continue;
    const first = e.pts[0], last = e.pts[e.pts.length - 1];
    const ra = { x0: e.A.x - e.A.w / 2, x1: e.A.x + e.A.w / 2, y0: e.A.y - e.A.h / 2, y1: e.A.y + e.A.h / 2 }, rb = { x0: e.B.x - e.B.w / 2, x1: e.B.x + e.B.w / 2, y0: e.B.y - e.B.h / 2, y1: e.B.y + e.B.h / 2 };
    // candidate stub points: the side facing the other end first (the route's own port when it sits there), then the rest
    const cands = (n, r, port, toward, P) => {
      const dx = toward.x - n.x, dy = toward.y - n.y, ax = Math.abs(dx) >= Math.abs(dy);
      const order = ax ? [dx >= 0 ? 0 : 2, dy >= 0 ? 1 : 3, dy >= 0 ? 3 : 1, dx >= 0 ? 2 : 0] : [dy >= 0 ? 1 : 3, dx >= 0 ? 0 : 2, dx >= 0 ? 2 : 0, dy >= 0 ? 3 : 1];
      return order.map((dir, rank) => {
        const horiz = dir === 0 || dir === 2, edge = dir === 0 ? r.x1 : dir === 1 ? r.y1 : dir === 2 ? r.x0 : r.y0;
        const onSide = horiz ? Math.abs(port[0] - edge) < 0.01 && port[1] > r.y0 && port[1] < r.y1 : Math.abs(port[1] - edge) < 0.01 && port[0] > r.x0 && port[0] < r.x1;
        const c = onSide ? (horiz ? port[1] : port[0]) : (horiz ? n.y : n.x), sg = dir === 0 || dir === 1 ? 1 : -1;
        const pt = horiz ? [edge, c] : [c, edge];
        return { x: horiz ? edge + sg * P : c, y: horiz ? c : edge + sg * P, dir, pen: rank * 20, port: pt };
      });
    };
    const bx0 = Math.min(ra.x0, rb.x0), bx1 = Math.max(ra.x1, rb.x1), by0 = Math.min(ra.y0, rb.y0), by1 = Math.max(ra.y1, rb.y1);
    let path = null;
    // pad 12 first; in a dense group (members closer than 24px) a narrower pad, before a wider region (small regions are cheap)
    search: for (const m of C4R.MARGINS.concat(Infinity)) for (const P of C4R.PADS) {
      const A = cands(e.A, ra, first, e.B, P), B = cands(e.B, rb, last, e.A, P);
      B.forEach((t) => { t.dir = (t.dir + 2) & 3; });                    // goals: the way INTO the box
      const reg = m === Infinity ? [sx0 - P, sy0 - P, sx1 + P, sy1 + P] : [bx0 - m, by0 - m, bx1 + m, by1 + m], obs = [];
      const add = (r, pad) => { obs.push({ x0: r.x - pad, x1: r.x + r.w + pad, y0: r.y - pad, y1: r.y + r.h + pad }); };
      const q = { x: reg[0], y: reg[1], w: reg[2] - reg[0], h: reg[3] - reg[1] };
      boxes.scan(q, 0, null, (b) => { add(b, P); }, true);
      frameGrid.scan(q, 0, null, (f) => {
        if (holds(f, e.A) || holds(f, e.B)) add({ x: f.x, y: f.y, w: f.w, h: Math.min(C4R.TAG, f.h) }, 0);   // a frame an end is in: its tag band only
        else add(f, P);
      }, true);
      const near = used.filter((u) => (u.h ? u.c >= reg[1] - 24 && u.c <= reg[3] + 24 : u.c >= reg[0] - 24 && u.c <= reg[2] + 24));
      const pts = c4rGridPath(reg, obs, near, A, B, W);
      if (pts === false) break search;
      if (pts) {
        // the grid path runs stub to stub: put the ports on both ends
        const sa = A.find((t) => t.x === pts[0][0] && t.y === pts[0][1]), sb = B.find((t) => t.x === pts[pts.length - 1][0] && t.y === pts[pts.length - 1][1]);
        path = simplify([sa.port].concat(pts, [sb.port]));
        break search;
      }
    }
    if (!path) continue;
    const pts = path;
    e.pts = pts;
    for (let k = 0; k < pts.length - 1; k++) {
      const p = pts[k], q = pts[k + 1], h = p[1] === q[1];
      used.push(h ? { h: true, c: p[1], lo: Math.min(p[0], q[0]), hi: Math.max(p[0], q[0]) } : { h: false, c: p[0], lo: Math.min(p[1], q[1]), hi: Math.max(p[1], q[1]) });
    }
  }
}

function routeC4Edges(nodes, edges, opts) {
  const manual = !!(opts && opts.manual), H = C4R.PILL_H;
  const boxOf = (id) => { const n = nodes[id]; return { id, x: n.x, y: n.y, w: n.w, h: n.h }; };
  const rectOf = (n) => ({ x: n.x - n.w / 2, y: n.y - n.h / 2, w: n.w, h: n.h });
  // ---- per edge: items, axis, direction, side keys ----
  const frames = new Map();                                     // frames seen as items (an item that is not an element)
  const info = edges.map((e, i) => {
    const A = nodes[e.from], B = nodes[e.to];
    if (!A || !B) throw new Error(`routeC4Edges: edge ${i} joins an unknown node (${e.from} -> ${e.to})`);
    const iA = e.itemA || boxOf(e.from), iB = e.itemB || boxOf(e.to);
    for (const it of [iA, iB]) if (!nodes[it.id] && !frames.has(it.id)) frames.set(it.id, it);
    const dx = iB.x - iA.x, dy = iB.y - iA.y;
    const gapV = Math.abs(dy) - (iA.h + iB.h) / 2, gapH = Math.abs(dx) - (iA.w + iB.w) / 2;
    let vert = e.hint === 'v' || e.hint === 'h' ? e.hint === 'v' : gapV >= gapH;
    if (e.hint === 'u' || e.hint === 'r' || e.hint === 'l') vert = true;
    if (e.hint !== 'u' && (vert ? gapV : gapH) < 0 && (vert ? gapH : gapV) > (vert ? gapV : gapH)) vert = !vert;   // items overlap on the chosen axis: use the other
    const M = vert ? 'y' : 'x', C = vert ? 'x' : 'y', S = vert ? 'h' : 'w', Z = vert ? 'w' : 'h';
    const s = Math.sign(iB[M] - iA[M]) || 1, sd = e.hint === 'r' ? 1 : e.hint === 'l' ? -1 : 0, u = e.hint === 'u' || sd !== 0;
    return { i, A, B, iA, iB, M, C, S, Z, s, vert, u, sd, label: e.label, tech: e.tech, t0: vert ? 0.5 : 0.2, from: e.from, to: e.to,
      keyA: u ? e.from + (sd ? '|x' + sd : '|y1') : e.from + '|' + M + s, keyB: u ? e.to + (sd ? '|x' + sd : '|y1') : e.to + '|' + M + (-s) };
  });

  // ---- ports: along each node side, in the order of the targets (ties: input order) ----
  const sides = new Map();
  for (const e of info) {
    const a = e.sd ? e.B.y : e.u ? e.B.x : e.B[e.C], b = e.sd ? e.A.y : e.u ? e.A.x : e.A[e.C];
    for (const [k, end, o] of [[e.keyA, 'a', a], [e.keyB, 'b', b]]) {
      let g = sides.get(k); if (!g) sides.set(k, g = []);
      g.push({ e, end, o });
    }
  }
  for (const g of sides.values()) {
    g.sort((p, q) => p.o - q.o || p.e.i - q.e.i || (p.end < q.end ? -1 : 1));
    g.forEach((p, k) => {
      const n = p.end === 'a' ? p.e.A : p.e.B, C = p.e.sd ? 'y' : p.e.u ? 'x' : p.e.C, Z = p.e.sd ? 'h' : p.e.u ? 'w' : p.e.Z;
      p.e['p' + p.end] = n[C] + ((k + 1) / (g.length + 1) - 0.5) * n[Z];
    });
  }
  // near-aligned ends become one straight line
  for (const e of info) {
    e.pa0 = e.pa; e.pb0 = e.pb;
    if (e.u || Math.abs(e.pa - e.pb) >= 24) continue;
    const lo = Math.max(e.A[e.C] - e.A[e.Z] / 2, e.B[e.C] - e.B[e.Z] / 2) + 10, hi = Math.min(e.A[e.C] + e.A[e.Z] / 2, e.B[e.C] + e.B[e.Z] / 2) - 10;
    if (lo <= hi) { e.pa = e.pb = Math.min(hi, Math.max(lo, (e.pa + e.pb) / 2)); e.straight = true; }
  }
  // bends of arrows leaving one side nest: the widest spread bends nearest the source
  for (const g of sides.values()) {
    const a = g.filter((p) => p.end === 'a' && !p.e.u && !p.e.straight).sort((p, q) => Math.abs(q.e.pb - q.e.pa) - Math.abs(p.e.pb - p.e.pa) || p.e.i - q.e.i);
    if (a.length > 1) a.forEach((p, r) => { p.e.t0 = p.e.vert ? 0.3 + 0.55 * r / (a.length - 1) : 0.2 + 0.3 * r / (a.length - 1); });
  }

  // manual mode: every expanded frame is known (opts.frames, centre x, y), not only the ones an edge sees as an item
  if (manual && opts.frames) for (const f of opts.frames) if (!frames.has(f.id)) frames.set(f.id, f);

  // ---- obstacles: boxes, frames, tag bands ----
  const boxes = c4rGrid(), frameGrid = c4rGrid(), tags = c4rGrid();
  for (const id in nodes) { const r = rectOf(nodes[id]); r.id = id; boxes.add(r); }
  for (const f of frames.values()) {
    const r = rectOf(f); r.id = f.id; frameGrid.add(r);
    tags.add({ x: r.x, y: r.y, w: r.w, h: Math.min(C4R.TAG, r.h) });
  }
  const inside = (f, p) => p.x > f.x && p.x < f.x + f.w && p.y > f.y && p.y < f.y + f.h;
  // a thin leg along axis M (vert: x = c, y in lo..hi) crosses a box, or a frame that holds none of the `own` points
  const legBlocked = (e, lo, hi, c, own) => {
    const r = e.vert ? { x: c - 0.5, y: Math.min(lo, hi), w: 1, h: Math.abs(hi - lo) } : { x: Math.min(lo, hi), y: c - 0.5, w: Math.abs(hi - lo), h: 1 };
    return boxes.hit(r, 0) || frameGrid.hit(r, 0, (f) => !own.some((p) => inside(f, p)));
  };
  // a leg along C (the escape's first step), at m, spanning lo..hi
  const crossBlocked = (e, m, lo, hi, own) => legBlocked({ vert: !e.vert }, lo, hi, m, own);

  // ---- ends: the port on the facing side if the leg is clear, else another spot on it, else out through the frame padding ----
  const escLane = new Map(), portLane = new Map();
  const pickEnd = (e, id, N, I, mEdge, gEdge, port, own) => {
    const fracs = [null, 0.5, 0.25, 0.75, 0.12, 0.88];
    for (const f of fracs) {
      const c = f === null ? port : N[e.C] + (f - 0.5) * N[e.Z];
      if (!legBlocked(e, mEdge, gEdge, c, own)) return { c };
    }
    if (nodes[I.id]) return { c: port };                      // the item is the element itself: no frame padding to use
    const lowLim = I[e.C] - I[e.Z] / 2 + (e.vert ? 0 : C4R.TAG), highLim = I[e.C] + I[e.Z] / 2;
    const roomLo = N[e.C] - N[e.Z] / 2 - lowLim, roomHi = highLim - (N[e.C] + N[e.Z] / 2);
    const order = roomHi >= roomLo ? [1, -1] : [-1, 1];
    let first = null;
    for (const sd of order) {
      const room = sd > 0 ? roomHi : roomLo;
      if (room < C4R.ESC_MIN) continue;
      const k = I.id + '|' + sd, n = escLane.get(k) || 0;
      const inset = Math.min(Math.min(6, room / 3) + 4 * n, room * 0.85);
      const line = sd > 0 ? highLim - inset : lowLim + inset, edge = N[e.C] + sd * N[e.Z] / 2;
      const pk = id + '|' + e.M + '|' + sd, np = portLane.get(pk) || 0;
      // exit spot on that side: off the centre (a loop port sits there), then alternating 16px steps, kept inside the box
      const m = N[e.M] + Math.max(-N[e.S] / 2 + 6, Math.min(N[e.S] / 2 - 6, (np & 1 ? -1 : 1) * 16 * Math.ceil((np + 1) / 2)));
      const esc = { c: line, edge, line, k, m, pk };
      if (!first) first = esc;
      if (!crossBlocked(e, m, Math.min(edge, line), Math.max(edge, line), own) && !legBlocked(e, m, gEdge, line, own)) { escLane.set(k, n + 1); portLane.set(pk, np + 1); return esc; }
    }
    if (first) { escLane.set(first.k, (escLane.get(first.k) || 0) + 1); portLane.set(first.pk, (portLane.get(first.pk) || 0) + 1); return first; }
    return { c: port };
  };
  for (const e of info) {
    if (e.u) continue;
    const { A, B, M, S, s } = e;
    e.m0 = A[M] + s * A[S] / 2; e.m1 = B[M] - s * B[S] / 2;
    e.g0 = e.iA[M] + s * e.iA[S] / 2; e.g1 = e.iB[M] - s * e.iB[S] / 2;
    e.bend = e.g0 + (e.g1 - e.g0) * e.t0;
    const pa = { x: A.x, y: A.y }, pb = { x: B.x, y: B.y };
    if (e.straight && legBlocked(e, e.m0, e.m1, e.pa, [pa, pb])) { e.straight = false; e.pa = e.pa0; e.pb = e.pb0; }
    if (e.straight) { e.ea = { c: e.pa }; e.eb = { c: e.pb }; continue; }
    e.ea = pickEnd(e, e.from, A, e.iA, e.m0, e.g0, e.pa, [pa]);
    e.eb = pickEnd(e, e.to, B, e.iB, e.m1, e.g1, e.pb, [pb]);
  }

  // ---- one-bend runs: the bend lies between the facing edges of the two ITEMS ----
  const runs = new Map();
  for (const e of info) {
    if (e.u || e.straight) continue;
    const lo = Math.min(e.g0, e.g1), hi = Math.max(e.g0, e.g1), k = (e.vert ? 'v' : 'h') + Math.round(lo) + '|' + Math.round(hi);
    let r = runs.get(k); if (!r) runs.set(k, r = { lo, hi, list: [] });
    r.list.push(e);
  }
  // runs sharing a gutter and a stretch get a lane each (lanes evenly across the gutter), the rest keep their bend
  for (const r of runs.values()) {
    if (r.list.length < 2) continue;
    const ord = r.list.slice().sort((p, q) => p.bend - q.bend || p.i - q.i);
    const { lane, count } = c4rLanes(ord.map((e) => ({ lo: Math.min(e.ea.c, e.eb.c), hi: Math.max(e.ea.c, e.eb.c) })), 6);
    if (count < 2) continue;
    const slot = Math.min(C4R.RUN_LANE, (r.hi - r.lo) / (count + 1));
    const span = slot * (count - 1), mid = (r.lo + r.hi) / 2;
    ord.forEach((e, k) => { e.bend = mid - span / 2 + lane[k] * slot; });
  }

  // ---- loops under a row: base line below every item the span passes, then lanes 16px apart ----
  const loops = info.filter((e) => e.u && !e.sd);
  if (loops.length) {
    const K = 128, cols = new Map(), seen = new Set();
    const addItem = (it) => {
      if (seen.has(it.id)) return; seen.add(it.id);
      for (let c = Math.floor((it.x - it.w / 2) / K); c <= Math.floor((it.x + it.w / 2) / K); c++) {
        let a = cols.get(c); if (!a) cols.set(c, a = []); a.push(it);
      }
    };
    for (const id in nodes) addItem(boxOf(id));
    for (const f of frames.values()) addItem(f);
    const groups = new Map();
    for (const e of loops) {
      const x0 = Math.min(e.pa, e.pb), x1 = Math.max(e.pa, e.pb), ia = e.iA, ib = e.iB;
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

  // ---- loops out of a column: base line beside every item the span passes, then lanes 16px apart ----
  const side = info.filter((e) => e.sd);
  if (side.length) {
    const K = 128, rows = new Map(), seen = new Set();
    const addItem = (it) => {
      if (seen.has(it.id)) return; seen.add(it.id);
      for (let c = Math.floor((it.y - it.h / 2) / K); c <= Math.floor((it.y + it.h / 2) / K); c++) {
        let a = rows.get(c); if (!a) rows.set(c, a = []); a.push(it);
      }
    };
    for (const id in nodes) addItem(boxOf(id));
    for (const f of frames.values()) addItem(f);
    const groups = new Map();
    for (const e of side) {
      const y0 = Math.min(e.pa, e.pb), y1 = Math.max(e.pa, e.pb), ia = e.iA, ib = e.iB, d = e.sd;
      const edge = (it) => it.x + d * it.w / 2;
      let base = d > 0 ? Math.max(edge(ia), edge(ib)) : Math.min(edge(ia), edge(ib));
      const lo = Math.min(ia.x - ia.w / 2, ib.x - ib.w / 2), hi = Math.max(ia.x + ia.w / 2, ib.x + ib.w / 2);
      for (let c = Math.floor(y0 / K); c <= Math.floor(y1 / K); c++) {
        const a = rows.get(c);
        if (a) for (const it of a) if (it.y + it.h / 2 > y0 && it.y - it.h / 2 < y1 && it.x + it.w / 2 > lo && it.x - it.w / 2 < hi) base = d > 0 ? Math.max(base, edge(it)) : Math.min(base, edge(it));
      }
      e.base = base + d * C4R.LOOP_GAP;
      const k = d + '|' + e.base; let g = groups.get(k); if (!g) groups.set(k, g = []);
      g.push(e);
    }
    for (const g of groups.values()) {
      const ord = g.slice().sort((p, q) => Math.abs(p.pb - p.pa) - Math.abs(q.pb - q.pa) || p.i - q.i);
      const { lane } = c4rLanes(ord.map((e) => ({ lo: Math.min(e.pa, e.pb), hi: Math.max(e.pa, e.pb) })), 8);
      ord.forEach((e, k) => { e.xb = e.base + e.sd * C4R.LOOP_LANE * lane[k]; });
    }
  }

  // ---- polylines (built in (m, c) = (along the legs, across), then mapped to x, y) ----
  const simplify = (pts) => {
    const q = [];
    for (const p of pts) { const l = q[q.length - 1]; if (!l || l[0] !== p[0] || l[1] !== p[1]) q.push(p); }
    const o = [];
    for (const p of q) {
      while (o.length > 1) {
        const a = o[o.length - 2], b = o[o.length - 1];
        if ((b[0] - a[0]) * (p[1] - b[1]) - (b[1] - a[1]) * (p[0] - b[0]) === 0) o.pop(); else break;
      }
      o.push(p);
    }
    return o;
  };
  for (const e of info) {
    const { A, B } = e;
    if (e.sd) { e.pts = [[A.x + e.sd * A.w / 2, e.pa], [e.xb, e.pa], [e.xb, e.pb], [B.x + e.sd * B.w / 2, e.pb]]; continue; }
    if (e.u) { e.pts = [[e.pa, A.y + A.h / 2], [e.pa, e.yb], [e.pb, e.yb], [e.pb, B.y + B.h / 2]]; continue; }
    const half = (n, en, mEdge) => (en.edge === undefined ? [[mEdge, en.c], [e.bend, en.c]] : [[en.m, en.edge], [en.m, en.line], [e.bend, en.line]]);
    const mc = half(A, e.ea, e.m0).concat(half(B, e.eb, e.m1).reverse());
    e.pts = simplify(mc.map(([m, c]) => (e.vert ? [c, m] : [m, c])));
  }

  if (manual) c4rDetours(info, nodes, frames, boxes, frameGrid, simplify);

  // ---- labels, in input order: on a run long enough, slid along it off every box, tag band, other route and pill ----
  const pills = c4rGrid(), routes = c4rGrid();
  for (const e of info) {
    for (let k = 0; k < e.pts.length - 1; k++) {
      const p = e.pts[k], q = e.pts[k + 1];
      routes.add({ x: Math.min(p[0], q[0]), y: Math.min(p[1], q[1]), w: Math.abs(q[0] - p[0]), h: Math.abs(q[1] - p[1]), o: e.i });
    }
  }
  const out = new Array(edges.length);
  for (const e of info) {
    const w = c4rLabelW(e.label, e.tech), h = e.tech ? C4R.PILL_H2 : H, pts = e.pts, mine = (o) => o.o !== e.i;
    let pos = null;
    if (w) {
      // segments by preference: a run between the legs first, then the legs, longest first
      const segs = [];
      for (let k = 0; k < pts.length - 1; k++) {
        const p = pts[k], q = pts[k + 1], horiz = p[1] === q[1];
        segs.push({ k, p, q, horiz, len: Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]), fit: 0 });
      }
      for (const s of segs) {
        const room = s.horiz ? s.len - w - 16 : s.len - h - C4R.ARROW - 8;
        s.fit = room >= 0 ? 1 : 0;
        s.room = Math.max(0, room);
        s.mid = (s.k > 0 && s.k < pts.length - 2) || pts.length === 2 ? 0 : 1;
      }
      segs.sort((a, b) => b.fit - a.fit || a.mid - b.mid || b.len - a.len || a.k - b.k);
      const free = (r) => !boxes.hit(r, 2) && !tags.hit(r, 2) && !pills.hit(r, 2) && !routes.hit(r, 2, mine);
      const tried = [];
      search: for (const s of segs) {
        if (!s.len) continue;
        const last = s.k === pts.length - 2;
        let segTried = 0;
        const pushCand = (cx, cy) => {
          const c = { cx, cy, s, r: { x: cx - w / 2, y: cy - h / 2, w, h } };
          if (free(c.r)) { pos = c; return true; }
          if (segTried < 8 && tried.length < 24) { tried.push(c); segTried++; }
          return false;
        };
        if (s.room > 0) {
          // centre of the part the arrowhead leaves free on the last segment; slide outwards from there
          const t0 = last ? Math.max(0, s.len - C4R.ARROW) / 2 / s.len : 0.5;
          const steps = Math.min(12, Math.ceil(s.room / 8));
          for (let n = 0; n <= 2 * steps; n++) {
            const off = (n === 0 ? 0 : (n & 1 ? 1 : -1) * Math.ceil(n / 2)) * (steps ? s.room / 2 / steps : 0);
            const f = t0 + off / s.len;
            if (pushCand(s.p[0] + (s.q[0] - s.p[0]) * f, s.p[1] + (s.q[1] - s.p[1]) * f)) break search;
            if (!steps) break;
          }
        } else {
          const t0 = last && s.len > C4R.ARROW ? Math.max(0.1, (s.len - C4R.ARROW) / 2 / s.len) : 0.5;
          const fracs = s.len >= 24 ? [t0, 0.25, 0.75] : [t0];
          for (const f of fracs) {
            if (pushCand(s.p[0] + (s.q[0] - s.p[0]) * f, s.p[1] + (s.q[1] - s.p[1]) * f)) break search;
          }
        }
      }
      if (!pos) {                                             // nothing free: the candidate with the least overlap
        const score = (r) => 100 * pills.count(r, 2) + 20 * (boxes.count(r, 2) + tags.count(r, 2)) + routes.count(r, 2, mine);   // pills worst, then boxes and bands, then lines
        let best = Infinity, bestCand = null;
        for (const c of tried) {
          const n = score(c.r);
          if (n < best) { best = n; bestCand = c; }
        }
        pos = bestCand || { cx: pts[0][0], cy: pts[0][1], r: { x: pts[0][0] - w / 2, y: pts[0][1] - h / 2, w, h } };
        if (best >= 20) {
          const anchors = [pos].concat(tried.filter((c) => c.s !== pos.s).slice(0, 2));
          nudge: for (const base of anchors) {
            const seg = base.s;
            if (!seg) continue;
            const offs = seg.horiz ? [0, -(h + 4), h + 4] : [0, -(w / 2 + 8), w / 2 + 8];
            const alongs = [0, 32, -32, 64, -64, 96, -96];
            for (const d1 of offs) for (const d2 of alongs) {
              if (!d1 && !d2) continue;
              const nx = base.cx + (seg.horiz ? d2 : d1), ny = base.cy + (seg.horiz ? d1 : d2);
              const nr = { x: nx - w / 2, y: ny - h / 2, w, h };
              const n = score(nr) + (d1 ? 5 : 2);
              if (n < best) { best = n; pos = { cx: nx, cy: ny, r: nr }; if (n < 20) break nudge; }
            }
          }
        }
      }
      pills.add(pos.r);
    } else {
      const a = pts[0], b = pts[pts.length - 1];
      pos = { cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2 };
    }
    out[e.i] = { d: buildCurvedPathWithHops(pts, [], 8), points: pts, lx: pos.cx, ly: pos.cy, w, h };
  }
  return out;
}
