// C4 layout engine. Pure JS, no DOM, plain script. Run by the page (Tidy, edits, saved-page routes) and by
// scripts/run_engine.mjs (--layout), after assets/shell/ortho-router.js and assets/types/c4/route.js (routeC4Edges).
// Contract: dev/plans/plan-c4.md (Layout, Engine contract, Gutter routing interface). Sizes come from TOKENS.c4, text widths from
// TOKENS.font.metrics.
//
// Input:  data.arrange? ('surround' | 'flow' | 'layers'), groups[{id,name,kind,parent?,collapsed?,core?,side?}],
//         elements[{id,kind,name,tech?,description?,group?,core?,side?}], relations[{from,to,label,tech?,async?}]
// Output (derived, written in place; canvas px, top-left origin):
//   elements[].x,y,w,h,_hidden,_ring,_side   tile box; a hidden element keeps its x,y (where it sits when its group opens), w = h = 0,
//                                            and has no _ring / _side; members of a framed group take the group's ring and side
//   groups[].x,y,w,h,_depth,_collapsed,_hidden,_ring,_side
//                                            frame box (tag band included); a collapsed group is one tile; _hidden: inside a collapsed group
//   data._arrange                            the layout used after the default is applied
//   data._edges[{id,from,to,label,tech,async,count,members,points,path,labelBox,text}]   the arrows drawn
//   data.canvas {width,height}
// layoutDiagram(data): full layout. routeDiagram(data): keeps every visible x/y, recomputes frames, arrows, canvas.
// Groups are a tree of any depth: every step works on "a container and its visible members", never on a group kind.
// Deterministic: ties break by input order; no randomness.

const C4 = TOKENS.c4;
const C4_GRID = 4, C4_SWEEPS = 4, C4_PASSES = 4, C4_SIDES = ['S', 'W', 'E', 'N'];

const c4Num = (v) => typeof v === 'number' && isFinite(v);
const c4Grid = (v) => Math.ceil(v / C4_GRID) * C4_GRID;
const c4Vert = (s) => s === 'N' || s === 'S';

// Icon card size from the texts (widths only through TOKENS.font.metrics).
function c4Card(name, detail) {
  const M = TOKENS.font.metrics, nm = String(name == null ? '' : name), dt = String(detail == null ? '' : detail).slice(0, 30);
  const w = Math.min(C4.cardMaxW, Math.max(C4.cardW, c4Grid(Math.max(nm.length * M.title, dt.length * M.detail) + 2 * C4.pad)));
  const lines = Math.min(2, Math.max(1, Math.ceil(nm.length * M.title / (w - 2 * C4.pad))));
  return { w, h: C4.cardH + (lines - 1) * C4.cardLine };
}
const c4TagW = (g) => c4Grid(String(g.name || g.id).length * TOKENS.font.metrics.title + C4.tagPad);

// ---------- model ----------

// Nodes: one per element and per group, in a tree under `root` (members: elements first, then groups, in input order).
// Visible: no ancestor group is collapsed. A visible group that is collapsed itself is drawn as one tile.
function c4Model(data) {
  const els = data.elements || [], grs = data.groups || [], rels = data.relations || [];
  const m = { data, els, grs, rels, gBy: new Map(), info: new Map(), eN: new Map(), gN: new Map(), root: { kind: 'root', id: '', kids: [], depth: 0 } };
  grs.forEach((g) => { if (!m.gBy.has(g.id)) m.gBy.set(g.id, g); });
  // group info: parent (unknown or cyclic parents become top level), depth, effective collapsed, outermost collapsed ancestor-or-self
  grs.forEach((g) => {
    if (m.info.has(g.id)) return;
    const chain = [], seen = new Set();
    let cur = g;
    while (cur && !m.info.has(cur.id) && !seen.has(cur.id)) {
      seen.add(cur.id); chain.push(cur);
      cur = cur.parent !== cur.id && m.gBy.has(cur.parent) ? m.gBy.get(cur.parent) : null;
    }
    const baseId = cur && m.info.has(cur.id) ? cur.id : null;
    for (let i = chain.length - 1; i >= 0; i--) {
      const x = chain[i], parId = i === chain.length - 1 ? baseId : chain[i + 1].id, p = parId ? m.info.get(parId) : null;
      const self = x.collapsed === true;
      m.info.set(x.id, { par: parId, depth: p ? p.depth + 1 : 1, eff: self || !!(p && p.eff), top: p && p.eff ? p.top : (self ? x.id : null), cls: [0, 0, 0] });
    }
  });
  let uid = 0;
  const cont = (id) => (m.gN.get(id) || m.root);
  const K = (e) => (e.kind === 'person' ? 0 : e.kind === 'external' ? 2 : 1);
  const mk = (kind, ref, par, depth) => ({ kind, ref, id: ref.id, par, depth, uid: uid++, kids: [], ci: 0, w: 0, h: 0, rx: 0, ry: 0, ax: 0, ay: 0, vis: true, self: false, eff: false, cls: 1, ring: -1, side: null });
  grs.forEach((g) => {
    const gi = m.info.get(g.id);
    if (!gi || m.gBy.get(g.id) !== g) return;
    const n = mk('g', g, gi.par || '', gi.depth);
    n.self = g.collapsed === true; n.eff = gi.eff; n.vis = !(gi.par && m.info.get(gi.par).eff);
    const t = c4Card(g.name || g.id, ''); n.tw = t.w; n.th = t.h; n.w = t.w; n.h = t.h;
    m.gN.set(g.id, n);
  });
  els.forEach((e) => {
    if (m.eN.has(e.id)) return;
    const c = m.info.has(e.group) ? e.group : '', gi = c ? m.info.get(c) : null;
    const n = mk('e', e, c, gi ? gi.depth + 1 : 1);
    n.eff = !!(gi && gi.eff); n.vis = !n.eff; n.cls = K(e);
    const t = c4Card(e.name || e.id, e.tech || e.description); n.w = t.w; n.h = t.h;
    m.eN.set(e.id, n);
    for (let g = c; g; g = m.info.get(g).par) m.info.get(g).cls[K(e)]++;
  });
  m.eN.forEach((n) => { const p = cont(n.par); n.ci = p.kids.length; p.kids.push(n); });
  m.gN.forEach((n) => { const p = cont(n.par); n.ci = p.kids.length; p.kids.push(n); const cl = m.info.get(n.id).cls; n.cls = cl[0] && !cl[1] && !cl[2] ? 0 : cl[2] && !cl[0] && !cl[1] ? 2 : 1; });
  // the top-level item (a loose element or a top-level group) every node belongs to
  const topOf = (n) => { while (n.par) n = m.gN.get(n.par); return n; };
  m.eN.forEach((n) => { n.top = topOf(n); });
  m.gN.forEach((n) => { n.top = topOf(n); });
  m.items = m.root.kids;
  // a relation end resolves to the nearest visible node: the element, or the outermost collapsed group around it
  const endNode = (id) => {
    const e = m.eN.get(id);
    return e ? (e.vis ? e : m.gN.get(m.info.get(e.par).top)) : null;
  };
  m.rel2 = [];
  rels.forEach((r, i) => {
    const a = endNode(r.from), b = endNode(r.to);
    if (a && b && a !== b) m.rel2.push({ i, a, b, agg: a.id !== r.from || b.id !== r.to });
  });
  return m;
}

// The two siblings just below the lowest container that holds both nodes: the ancestor-or-self of each (equal when one holds the other).
function c4Sibs(m, x, y) {
  const up = (n) => m.gN.get(n.par);
  while (x.depth > y.depth) x = up(x);
  while (y.depth > x.depth) y = up(y);
  while (x.par !== y.par) { x = up(x); y = up(y); }
  return [x, y];
}

// Relations between members of one container, as [ci, cj, count] by container id (the lowest common container of the two elements).
function c4Links(m) {
  const sets = new Map();
  m.rels.forEach((r) => {
    const a0 = m.eN.get(r.from), b0 = m.eN.get(r.to);
    if (!a0 || !b0 || a0 === b0) return;
    const [x, y] = c4Sibs(m, a0, b0);
    if (x === y) return;
    const a = x.ci < y.ci ? x : y, b = a === x ? y : x, k = a.uid * 1e6 + b.uid;
    if (!sets.has(x.par)) sets.set(x.par, new Map());
    const mp = sets.get(x.par), e = mp.get(k);
    if (e) e[2]++; else mp.set(k, [a.ci, b.ci, 1]);
  });
  return sets;
}

// ---------- inside a group ----------

// Ranked small flow (top to bottom) of `its` along `edges` ([ai, bi, weight]); sets rx, ry; returns {w, h}.
function c4Flow(its, edges) {
  const n = its.length;
  // 1. rank: orient every edge toward the later class (people first, externals last), drop the back edges of a DFS, longest path
  const out = its.map(() => []), nbr = its.map(() => []), indeg = new Int32Array(n);
  edges.forEach((e) => {
    let u = e[0], v = e[1];
    if (its[u].cls > its[v].cls) { const t = u; u = v; v = t; }
    out[u].push(v); nbr[u].push(v); nbr[v].push(u); indeg[v]++;
  });
  const state = new Uint8Array(n), ptr = new Int32Array(n), fw = its.map(() => []), post = [], starts = [];
  for (let i = 0; i < n; i++) if (!indeg[i]) starts.push(i);
  for (let i = 0; i < n; i++) if (indeg[i]) starts.push(i);
  starts.forEach((s) => {
    if (state[s]) return;
    const stack = [s];
    state[s] = 1;
    while (stack.length) {
      const u = stack[stack.length - 1];
      if (ptr[u] < out[u].length) {
        const v = out[u][ptr[u]++];
        if (state[v] === 1) continue;
        fw[u].push(v);
        if (!state[v]) { state[v] = 1; stack.push(v); }
      } else { state[u] = 2; post.push(u); stack.pop(); }
    }
  });
  const rank = new Int32Array(n);
  for (let k = post.length - 1; k >= 0; k--) {
    const u = post[k];
    fw[u].forEach((v) => { if (rank[v] < rank[u] + 1) rank[v] = rank[u] + 1; });
  }
  let maxRank = 0;
  for (let i = 0; i < n; i++) if (rank[i] > maxRank) maxRank = rank[i];
  for (let i = 0; i < n; i++) if (!nbr[i].length && its[i].cls === 2) rank[i] = maxRank;
  const R = maxRank + 1, order = Array.from({ length: R }, () => []);
  for (let i = 0; i < n; i++) order[rank[i]].push(i);
  // 2. order inside each rank: barycentre sweeps
  const pos = new Float64Array(n);
  const setPos = (r) => order[r].forEach((i, k) => { pos[i] = (k + 0.5) / order[r].length; });
  for (let r = 0; r < R; r++) setPos(r);
  const sweep = (r, dir) => {
    if (order[r].length < 2) return;
    const keyed = order[r].map((i, k) => {
      let s = 0, c = 0;
      nbr[i].forEach((j) => { if (dir > 0 ? rank[j] < r : rank[j] > r) { s += pos[j]; c++; } });
      return [c ? s / c : pos[i], k, i];
    });
    keyed.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    order[r] = keyed.map((p) => p[2]);
    setPos(r);
  };
  for (let s = 0; s < C4_SWEEPS; s++) {
    for (let r = 1; r < R; r++) sweep(r, 1);
    for (let r = R - 2; r >= 0; r--) sweep(r, -1);
  }
  // 3. rows: a rank of more than rowMax items wraps into balanced rows
  const rows = [];
  for (let r = 0; r < R; r++) {
    const arr = order[r], k = Math.ceil(arr.length / C4.rowMax), size = Math.ceil(arr.length / k);
    for (let s = 0; s < arr.length; s += size) rows.push({ r, its: arr.slice(s, s + size), t: 0 });
  }
  rows.forEach((row) => { row.t = Math.max.apply(null, row.its.map((i) => its[i].h)); });
  // 4. across: centre each row, then pull items toward their neighbours' centres (isotonic regression keeps order and gaps)
  const xa = new Float64Array(n), G = C4.flowAcross;
  rows.forEach((row) => {
    let tot = -G;
    row.its.forEach((i) => { tot += its[i].w + G; });
    let x = -tot / 2;
    row.its.forEach((i) => { xa[i] = x; x += its[i].w + G; });
  });
  const rowOf = new Int32Array(n);
  rows.forEach((row, ri) => row.its.forEach((i) => { rowOf[i] = ri; }));
  const relax = (ri) => {
    const row = rows[ri], len = row.its.length, d = new Array(len), s = new Array(len);
    let off = 0;
    row.its.forEach((i, k) => {
      let sum = 0, c = 0;
      nbr[i].forEach((j) => { if (rowOf[j] !== ri) { sum += xa[j] + its[j].w / 2; c++; } });
      d[k] = c ? sum / c - its[i].w / 2 : xa[i];
      s[k] = off; off += its[i].w + G;
    });
    const blocks = [];
    for (let k = 0; k < len; k++) {
      blocks.push({ sum: d[k] - s[k], cnt: 1, from: k });
      while (blocks.length > 1) {
        const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
        if (a.sum / a.cnt <= b.sum / b.cnt) break;
        a.sum += b.sum; a.cnt += b.cnt; blocks.pop();
      }
    }
    blocks.forEach((b) => { const v = b.sum / b.cnt; for (let k = b.from; k < b.from + b.cnt; k++) xa[row.its[k]] = v + s[k]; });
  };
  for (let p = 0; p < C4_PASSES; p++) {
    for (let ri = 0; ri < rows.length; ri++) relax(ri);
    for (let ri = rows.length - 1; ri >= 0; ri--) relax(ri);
  }
  // 5. along: rows in rank order; the gap between ranks grows with the arrows that cross it (room for labels)
  const span = new Int32Array(R + 1);
  edges.forEach((e) => {
    const lo = Math.min(rank[e[0]], rank[e[1]]), hi = Math.max(rank[e[0]], rank[e[1]]);
    span[lo]++; span[hi]--;
  });
  const gapAt = new Array(R);
  let run = 0;
  for (let r = 0; r < R; r++) { run += span[r]; gapAt[r] = C4.flowAlong + C4.flowPerEdge * Math.min(C4.flowEdgeCap, run); }
  let along = 0, minX = Infinity, maxX = -Infinity;
  const ya = new Float64Array(n);
  rows.forEach((row, ri) => {
    if (ri) along += rows[ri - 1].r === row.r ? C4.flowRowGap : gapAt[rows[ri - 1].r];
    row.its.forEach((i) => {
      ya[i] = along + (row.t - its[i].h) / 2;
      if (xa[i] < minX) minX = xa[i];
      if (xa[i] + its[i].w > maxX) maxX = xa[i] + its[i].w;
    });
    along += row.t;
  });
  for (let i = 0; i < n; i++) { its[i].rx = Math.round(xa[i] - minX); its[i].ry = Math.round(ya[i]); }
  return { w: Math.round(maxX - minX), h: Math.round(along) };
}

// Members in one line (a row, or a column when `vert`); `gapOf(prev, it)` is the space between neighbours. Returns the line's size.
function c4Line(its, vert, gapOf) {
  const cross = Math.max.apply(null, its.map((i) => (vert ? i.w : i.h)));
  let p = 0;
  its.forEach((it, k) => {
    if (k) p += gapOf(its[k - 1], it);
    if (vert) { it.rx = Math.round((cross - it.w) / 2); it.ry = p; p += it.h; } else { it.ry = Math.round((cross - it.h) / 2); it.rx = p; p += it.w; }
  });
  return vert ? { w: cross, h: p } : { w: p, h: cross };
}

// Sizes group `g` (and the groups below it): lays its members out, sets the frame (fw, fh) and w, h as drawn inside its parent.
// vert: the group sits beside the centre, so its members form a column. Members: no links, a row; links between neighbours,
// the row with room for the label; a link that skips a member (or too many members), a small flow.
function c4Size(m, g, vert) {
  g.kids.forEach((k) => { if (k.kind === 'g') c4Size(m, k, false); });
  const its = g.kids, n = its.length, pairs = m.links.has(g.id) ? Array.from(m.links.get(g.id).values()) : [];
  let c;
  g.line = null;   // 'row' or 'col' when the members form one plain line (c4Order may reorder it), else null
  if (!n) c = { w: 0, h: 0 };
  else if (pairs.some((p) => p[1] - p[0] !== 1) || (pairs.length && n > C4.rowMax)) c = c4Flow(its, pairs);
  else {
    const linked = new Set(pairs.map((p) => p[0])), gap = (a) => (linked.has(a.ci) ? (vert ? C4.innerLinkY : C4.innerLinkX) : C4.innerGap);
    const lines = [];
    for (let o = 0; o < n; o += C4.rowMax) lines.push(its.slice(o, o + C4.rowMax));
    if (lines.length === 1) g.line = vert ? 'col' : 'row';
    c = { w: 0, h: 0 };
    let off = 0;
    lines.forEach((ln) => {
      const s = c4Line(ln, vert, (a) => gap(a));
      ln.forEach((it) => { if (vert) it.rx += off; else it.ry += off; });
      off += (vert ? s.w : s.h) + C4.innerGap;
      c = vert ? { w: off - C4.innerGap, h: Math.max(c.h, s.h) } : { w: Math.max(c.w, s.w), h: off - C4.innerGap };
    });
  }
  g.cx = 0;
  g.fw = n ? Math.max(c.w + 2 * C4.pad, c4TagW(g.ref)) : C4.emptyW;
  g.fh = n ? c.h + C4.tagH + C4.padB : C4.emptyH;
  g.w = g.self ? g.tw : g.fw; g.h = g.self ? g.th : g.fh;
}

// Absolute positions of everything inside item `n` from its own position and the members' relative ones.
function c4Assign(n) {
  n.ref.x = n.ax; n.ref.y = n.ay;
  if (n.kind !== 'g') return;
  const ox = n.ax + C4.pad + n.cx, oy = n.ay + C4.tagH;
  n.kids.forEach((k) => { k.ax = ox + k.rx; k.ay = oy + k.ry; c4Assign(k); });
}

// ---------- rings, sides ----------

// arrange, items, links between items and rings. Ring: surround = links from the nearest centre item; flow = links from the items
// nobody points at; layers = index of the top-level group (loose elements after the groups).
function c4Rings(m) {
  const data = m.data, items = m.items;
  items.forEach((it) => { it.ring = -1; it.adj = []; it.nb = new Set(); it.pointed = false; });
  const core = new Set();
  m.eN.forEach((n) => { if (n.ref.core === true) core.add(n.top); });
  m.gN.forEach((n) => { if (n.ref.core === true) core.add(n.top); });
  let arrange = data.arrange === 'surround' || data.arrange === 'flow' || data.arrange === 'layers' ? data.arrange : (core.size ? 'surround' : 'flow');
  if (arrange === 'surround' && !core.size) arrange = 'flow';
  m.arrange = arrange;
  m.rel2.forEach((r) => {
    const a = r.a.top, b = r.b.top;
    if (a === b) return;
    b.pointed = true;
    if (!a.nb.has(b)) { a.nb.add(b); b.nb.add(a); a.adj.push(b); b.adj.push(a); }
  });
  const bfs = (seeds, base) => {
    const q = seeds.slice();
    q.forEach((i) => { i.ring = base; });
    for (let h = 0; h < q.length; h++) q[h].adj.forEach((n) => { if (n.ring < 0) { n.ring = q[h].ring + 1; q.push(n); } });
  };
  if (arrange === 'layers') {
    const ord = items.filter((i) => i.kind === 'g').concat(items.filter((i) => i.kind === 'e'));
    ord.forEach((i, k) => { i.ring = k; });
  } else if (arrange === 'surround') {
    bfs(items.filter((i) => core.has(i)), 0);
    items.forEach((i) => { if (i.ring < 0) bfs([i], 1); });
  } else {
    const roots = items.filter((i) => !i.pointed);
    bfs(roots.length ? roots : items.slice(0, 1), 0);
    items.forEach((i) => { if (i.ring < 0) bfs([i], 0); });
  }
  m.maxRing = items.reduce((a, i) => Math.max(a, i.ring), 0);
  m.byRing = Array.from({ length: m.maxRing + 1 }, () => []);
  items.forEach((i) => m.byRing[i.ring].push(i));
  // links to the inner rings (they set the gutter), and the centre nodes each item links to
  items.forEach((i) => { i.nIn = 0; i.cl = null; });
  m.rel2.forEach((r) => {
    const a = r.a.top, b = r.b.top;
    if (a === b || a.ring === b.ring) return;
    const o = a.ring > b.ring ? a : b, inner = o === a ? r.b : r.a;
    o.nIn++;
    if (arrange === 'surround' && inner.top.ring === 0) (o.cl || (o.cl = [])).push(inner);
  });
  return m;
}

// The visible boxes of a node: the node itself when it is an element or a collapsed tile, else the boxes of its members.
function c4Leaves(n, out) {
  if (n.kind === 'e' || n.self) out.push(n); else n.kids.forEach((k) => c4Leaves(k, out));
  return out;
}

// Which sides of a centre box face open space (no other centre box beyond it in that direction).
function c4Exposed(a, all) {
  const e = { N: true, S: true, E: true, W: true };
  all.forEach((b) => {
    if (b === a) return;
    const ox = a.ax < b.ax + b.w && b.ax < a.ax + a.w, oy = a.ay < b.ay + b.h && b.ay < a.ay + a.h;
    if (ox && b.ay + b.h <= a.ay) e.N = false;
    if (ox && b.ay >= a.ay + a.h) e.S = false;
    if (oy && b.ax + b.w <= a.ax) e.W = false;
    if (oy && b.ax >= a.ax + a.w) e.E = false;
  });
  return e;
}

// A side for every ring item (surround): the author's hint, people on top, else the emptiest allowed side; a ring-1 item may only sit
// on a side that every centre box it links to exposes; later rings follow their inner neighbour. Flow and layers: below (S).
function c4Sides(m) {
  const { byRing, maxRing } = m;
  if (m.arrange !== 'surround') { for (let r = 1; r <= maxRing; r++) byRing[r].forEach((i) => { i.side = 'S'; }); return; }
  const centre = [];
  byRing[0].forEach((i) => c4Leaves(i, centre));
  const expo = new Map(), exposed = (b) => { if (!expo.has(b)) expo.set(b, c4Exposed(b, centre)); return expo.get(b); };
  const allowed = (it) => {
    let a = null;
    (it.cl || []).forEach((b) => { const e = exposed(b); a = a ? a.filter((s) => e[s]) : ['N', 'S', 'E', 'W'].filter((s) => e[s]); });
    return a && a.length ? a : ['N', 'S', 'E', 'W'];
  };
  const people = (i) => i.cls === 0;
  const hint = (i) => (/^[NSEW]$/.test(String(i.ref.side).toUpperCase()) ? String(i.ref.side).toUpperCase() : null);
  for (let r = 1; r <= maxRing; r++) {
    const cnt = { N: 0, S: 0, E: 0, W: 0 }, ring = byRing[r];
    ring.forEach((it) => {
      const h = hint(it);
      if (h) it.side = h;
      else if (r > 1) { const nb = it.adj.find((x) => x.ring === r - 1); it.side = nb && nb.side ? nb.side : 'S'; } else if (people(it) && allowed(it).includes('N')) it.side = 'N';
      if (it.side) cnt[it.side]++;
    });
    ring.forEach((it) => {
      if (it.side) return;
      const ok = C4_SIDES.filter((s) => allowed(it).includes(s));
      it.side = ok.reduce((a, b) => (cnt[b] < cnt[a] ? b : a));
      cnt[it.side]++;
    });
  }
}

// ---------- placement ----------

const c4Union = (rs) => {
  const x0 = Math.min.apply(null, rs.map((r) => r.ax)), y0 = Math.min.apply(null, rs.map((r) => r.ay));
  const x1 = Math.max.apply(null, rs.map((r) => r.ax + r.w)), y1 = Math.max.apply(null, rs.map((r) => r.ay + r.h));
  return { ax: x0, ay: y0, w: x1 - x0, h: y1 - y0 };
};

// Items in lines (rowMax per line) on side `s` of box `B`, centred on the origin along the side; further lines go outward.
function c4Lane(its, s, B, gap) {
  const horiz = c4Vert(s), dir = s === 'N' || s === 'W' ? -1 : 1;
  let edge = s === 'N' ? B.ay - gap : s === 'S' ? B.ay + B.h + gap : s === 'E' ? B.ax + B.w + gap : B.ax - gap;
  for (let o = 0; o < its.length; o += C4.rowMax) {
    const line = its.slice(o, o + C4.rowMax);
    const gaps = line.map((it, k) => (k ? (it.nb.has(line[k - 1]) ? (horiz ? C4.ringLinkX : C4.ringLinkY) : C4.ringGap) : 0));
    const thick = Math.max.apply(null, line.map((i) => (horiz ? i.h : i.w)));
    let p = -(line.reduce((t, i, k) => t + (horiz ? i.w : i.h) + gaps[k], 0)) / 2;
    line.forEach((it, k) => {
      p += gaps[k];
      if (horiz) { it.ax = Math.round(p); it.ay = s === 'N' ? edge - it.h : edge; p += it.w; } else { it.ay = Math.round(p); it.ax = s === 'W' ? edge - it.w : edge; p += it.h; }
    });
    edge += dir * (thick + C4.ringGap);
  }
}

// Positions every item (ax, ay: the centre set at the middle, then each ring around the box built so far) and every node inside.
function c4Place(m) {
  const { byRing, maxRing, items } = m, flat = m.arrange !== 'surround';
  // surround: the centre is sized first (its boxes decide the sides), the rest once their side is known; flow and layers: all at once
  (flat ? items : byRing[0]).forEach((i) => { if (i.kind === 'g') c4Size(m, i, false); });
  if (m.arrange === 'layers') {
    const bands = items.filter((i) => i.kind === 'g' && !i.self), mw = Math.max.apply(null, bands.map((i) => i.fw));
    bands.forEach((i) => { i.cx = Math.round((mw - i.fw) / 2); i.fw = mw; i.w = mw; });
  }
  const cs = byRing[0], linked = (its) => its.some((a, i) => its.some((b, j) => j > i && a.nb.has(b)));
  let B;
  if (flat) { c4Lane(cs, 'S', { ax: 0, ay: 0, w: 0, h: 0 }, 0); B = c4Union(cs); } else {
    const cols = Math.ceil(Math.sqrt(cs.length)), rows = [], lk = linked(cs);
    for (let i = 0; i < cs.length; i += cols) rows.push(cs.slice(i, i + cols));
    const gx = lk ? C4.ringLinkX : C4.centreGap, gy = lk ? C4.ringLinkY : C4.centreGap;
    const rh = rows.map((r) => Math.max.apply(null, r.map((c) => c.h))), th = rh.reduce((s, h) => s + h, 0) + (rows.length - 1) * gy;
    let cy = -th / 2;
    rows.forEach((r, ri) => {
      let x = -(r.reduce((s, c) => s + c.w, 0) + (r.length - 1) * gx) / 2;
      r.forEach((c) => { c.ax = Math.round(x); c.ay = Math.round(cy + (rh[ri] - c.h) / 2); x += c.w + gx; });
      cy += rh[ri] + gy;
    });
    B = c4Union(cs);
  }
  cs.forEach(c4Assign);
  c4Sides(m);
  // the other items, sized for their side (a framed item beside the centre holds its members in a column)
  if (!flat) items.forEach((i) => { if (i.ring > 0 && i.kind === 'g') c4Size(m, i, i.side === 'E' || i.side === 'W'); });
  for (let r = 1; r <= maxRing; r++) {
    const ring = byRing[r], placed = [];
    const ctr = (n) => ({ x: n.ax + n.w / 2, y: n.ay + n.h / 2 });
    const key = new Map(ring.map((it) => {
      const ns = it.adj.filter((n) => n.ring < r).map(ctr), v = c4Vert(it.side) ? 'x' : 'y';
      return [it, ns.length ? ns.reduce((s, p) => s + p[v], 0) / ns.length : 0];
    }));
    const side = (s) => ring.filter((i) => i.side === s).sort((a, b) => key.get(a) - key.get(b));
    const gutter = (its, base) => base + C4.ringStagger * Math.min(C4.ringStaggerCap, Math.max(0, its.reduce((t, i) => t + i.nIn, 0) - 3));
    const N = side('N'), S = side('S'), E = side('E'), W = side('W');
    if (N.length) { c4Lane(N, 'N', B, gutter(N, C4.ringV)); placed.push(...N); }
    if (S.length) { c4Lane(S, 'S', B, gutter(S, C4.ringV)); placed.push(...S); }
    const B2 = placed.length ? c4Union([B, ...placed]) : B;
    if (E.length) { c4Lane(E, 'E', B2, gutter(E, C4.ringH)); placed.push(...E); }
    if (W.length) { c4Lane(W, 'W', B2, gutter(W, C4.ringH)); placed.push(...W); }
    placed.forEach(c4Assign);
    B = c4Union([B, ...placed]);
  }
  // top-left origin: the picture starts at the margin
  const b = c4Union(items), dx = C4.margin - b.ax, dy = C4.margin - b.ay;
  items.forEach((i) => { i.ax += dx; i.ay += dy; c4Assign(i); });
}

// ---------- member order ----------

// Reorders the members of every plain row or column of members (one line, same sizes) by the barycentre of the elements they link to
// OUTSIDE their group, along the line's axis, so a member whose arrows leave toward a side sits at that end. A member with no outside
// link takes the mean of its linked members' keys, else keeps its place; ties by input order. The line keeps its total length (links
// that are no longer adjacent give their label room back), so nothing around it moves. Outer groups first: moving a member moves
// everything in it, and an inner group then sees the final position of its siblings. Run after c4Place.
function c4Order(m) {
  const up = (n) => m.gN.get(n.par);
  m.eN.forEach((n) => { n.outs = null; });
  m.gN.forEach((n) => { n.outs = null; });
  m.rel2.forEach((r) => {
    const [x, y] = c4Sibs(m, r.a, r.b);
    for (let n = r.a; n !== x; n = up(n)) (n.outs || (n.outs = [])).push(r.b);
    for (let n = r.b; n !== y; n = up(n)) (n.outs || (n.outs = [])).push(r.a);
  });
  const groups = Array.from(m.gN.values()).filter((g) => g.vis && !g.self && g.line && g.kids.length > 1);
  groups.sort((p, q) => p.depth - q.depth || p.uid - q.uid);
  groups.forEach((g) => {
    const its = g.kids, n = its.length, vert = g.line === 'col';
    const at = (k) => (vert ? k.ay + k.h / 2 : k.ax + k.w / 2);
    let key = its.map((k) => (k.outs ? k.outs.reduce((s, o) => s + at(o), 0) / k.outs.length : null));
    if (key.every((k) => k === null)) return;
    const pairs = m.links.has(g.id) ? Array.from(m.links.get(g.id).values()) : [], nbr = its.map(() => []);
    pairs.forEach((p) => { nbr[p[0]].push(p[1]); nbr[p[1]].push(p[0]); });
    // a member with no outside link takes its linked members' mean key and, on a tie, sits on the inner side of them
    const mid = vert ? g.ay + g.h / 2 : g.ax + g.w / 2, tie = its.map(() => 0);
    for (let again = true; again;) {
      again = false;
      const next = key.slice();
      key.forEach((k, i) => {
        if (k !== null) return;
        const ks = nbr[i].filter((j) => key[j] !== null).map((j) => key[j]);
        if (ks.length) { next[i] = ks.reduce((s, v) => s + v, 0) / ks.length; tie[i] = next[i] > mid ? -1 : 1; again = true; }
      });
      key = next;
    }
    key = key.map((k, i) => (k === null ? at(its[i]) : k));
    const order = its.map((_, i) => i).sort((p, q) => key[p] - key[q] || tie[p] - tie[q] || p - q);
    if (order.every((i, k) => i === k)) return;
    const seq = order.map((i) => its[i]), linked = new Set(pairs.map((p) => p[0] * n + p[1]));
    const link = vert ? C4.innerLinkY : C4.innerLinkX, size = (k) => (vert ? k.h : k.w);
    const base = seq.map((k, i) => (i ? (linked.has(Math.min(k.ci, seq[i - 1].ci) * n + Math.max(k.ci, seq[i - 1].ci)) ? link : C4.innerGap) : 0));
    const total = seq.reduce((s, k, i) => s + size(k) + base[i], 0);
    const old = Math.max.apply(null, its.map((k) => (vert ? k.ry : k.rx) + size(k)));
    if (total > old) return;
    const slack = old - total, each = Math.floor(slack / (n - 1)), rest = slack - each * (n - 1);
    c4Line(seq, vert, (a, k) => { const i = seq.indexOf(k); return base[i] + each + (i === n - 1 ? rest : 0); });
    c4Assign(g);
  });
}

// ---------- state, frames ----------

// Sizes and flags that never come from the saved file.
function c4Stamp(m) {
  m.eN.forEach((n) => { n.ref._hidden = !n.vis; n.ref.w = n.vis ? n.w : 0; n.ref.h = n.vis ? n.h : 0; });
  m.gN.forEach((n) => {
    const g = n.ref;
    g._depth = n.depth; g._collapsed = n.eff; g._hidden = !n.vis;
    if (!n.vis) { g.w = 0; g.h = 0; } else if (n.self) { g.w = n.tw; g.h = n.th; }
  });
}

// _ring and _side: on the top-level items and on everything visible inside them; hidden nodes have neither.
function c4StampRings(m) {
  const set = (n, ring, side) => {
    const o = n.ref;
    if (n.vis) { o._ring = ring; if (side) o._side = side; else delete o._side; } else { delete o._ring; delete o._side; }
    n.kids.forEach((k) => set(k, ring, side));
  };
  m.items.forEach((it) => set(it, it.ring, it.side));
}

function c4Shift(n, dx, dy) {
  if (c4Num(n.ref.x)) n.ref.x += dx;
  if (c4Num(n.ref.y)) n.ref.y += dy;
  n.kids.forEach((k) => c4Shift(k, dx, dy));
}

// Siblings never overlap: when one grows into the next (a group expanded), everything past it moves as one block.
function c4Separate(its) {
  const n = its.length;
  for (let pass = 0; pass <= n; pass++) {
    const byX = its.slice().sort((p, q) => p.ref.x - q.ref.x || p.ref.y - q.ref.y || p.ci - q.ci);
    let hit = null;
    for (let i = 0; i < n && !hit; i++) {
      const a = byX[i].ref;
      for (let j = i + 1; j < n; j++) {
        const b = byX[j].ref;
        if (b.x >= a.x + a.w + C4.sep) break;
        if (b.y < a.y + a.h + C4.sep && a.y < b.y + b.h + C4.sep) { hit = [byX[i], byX[j]]; break; }
      }
    }
    if (!hit) return;
    const [p, q] = hit[0].ref.y < hit[1].ref.y || (hit[0].ref.y === hit[1].ref.y && hit[0].ref.x <= hit[1].ref.x) ? hit : [hit[1], hit[0]];
    const a = p.ref, b = q.ref;
    const dx = a.x + a.w + C4.sep - b.x, dy = a.y + a.h + C4.sep - b.y;
    const canX = b.x > a.x, canY = b.y > a.y, useX = canX && (!canY || dx < dy);
    if (!canX && !canY) { c4Shift(q, 0, dy); continue; }
    its.forEach((s) => {
      if (s === p) return;
      if (useX ? s.ref.x >= b.x : s.ref.y >= b.y) c4Shift(s, useX ? dx : 0, useX ? 0 : dy);
    });
  }
}

// Frames of the expanded groups from their members, deepest first; siblings are separated on the way. In layers every band spans the
// same width.
function c4Frames(m) {
  const conts = [m.root].concat(Array.from(m.gN.values()).filter((n) => n.vis && !n.self));
  conts.sort((p, q) => q.depth - p.depth);
  conts.forEach((c) => {
    const its = c.kids;
    c4Separate(its);
    if (c === m.root) return;
    const g = c.ref;
    if (!its.length) {
      if (!c4Num(g.x)) g.x = 0;
      if (!c4Num(g.y)) g.y = 0;
      g.w = C4.emptyW; g.h = C4.emptyH;
      return;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    its.forEach((it) => {
      const r = it.ref;
      if (r.x < x0) x0 = r.x;
      if (r.y < y0) y0 = r.y;
      if (r.x + r.w > x1) x1 = r.x + r.w;
      if (r.y + r.h > y1) y1 = r.y + r.h;
    });
    g.x = x0 - C4.pad; g.y = y0 - C4.tagH;
    g.w = Math.max(x1 - x0 + 2 * C4.pad, c4TagW(g)); g.h = y1 - y0 + C4.tagH + C4.padB;
  });
  if (m.arrange === 'layers') {
    const bands = m.items.filter((i) => i.kind === 'g' && !i.self).map((i) => i.ref);
    if (bands.length) {
      const x0 = Math.min.apply(null, bands.map((g) => g.x)), x1 = Math.max.apply(null, bands.map((g) => g.x + g.w));
      bands.forEach((g) => { g.x = x0; g.w = x1 - x0; });
    }
  }
}

// ---------- arrows ----------

// One arrow per visible pair: relations with an aggregated end merge by pair; direct ones merge when pair, label and tech match.
function c4Edges(m) {
  const map = new Map(), list = [];
  m.rel2.forEach((r) => {
    const rel = m.rels[r.i], label = String(rel.label == null ? '' : rel.label), tech = rel.tech ? String(rel.tech) : '';
    const key = r.agg ? `${r.a.uid}>${r.b.uid}` : `${r.a.uid}>${r.b.uid}|${label}|${tech}`;
    let e = map.get(key);
    if (!e) {
      e = { id: `r${r.i}`, from: r.a.id, to: r.b.id, label, tech, async: true, count: 0, members: [], a: r.a, b: r.b };
      map.set(key, e);
      list.push(e);
    }
    e.count++; e.members.push(r.i);
    if (rel.async !== true) e.async = false;
  });
  list.forEach((e) => { e.text = e.count > 1 ? `${e.label} ×${e.count}` : e.label; });
  return list;
}

// Stand-in for assets/types/c4/route.js (routeC4Edges): one bend, the run halfway between the two boxes. Only used when that file is absent.
function c4Fallback(nodes, edges) {
  const M = TOKENS.font.metrics;
  return edges.map((e) => {
    const a = nodes[e.from], b = nodes[e.to], vert = e.hint ? e.hint !== 'h' : Math.abs(b.y - a.y) - (a.h + b.h) / 2 >= Math.abs(b.x - a.x) - (a.w + b.w) / 2;
    const s = vert ? Math.sign(b.y - a.y) || 1 : Math.sign(b.x - a.x) || 1;
    const p0 = vert ? [a.x, a.y + s * a.h / 2] : [a.x + s * a.w / 2, a.y], p1 = vert ? [b.x, b.y - s * b.h / 2] : [b.x - s * b.w / 2, b.y];
    const mid = vert ? (p0[1] + p1[1]) / 2 : (p0[0] + p1[0]) / 2;
    const pts = vert ? [p0, [p0[0], mid], [p1[0], mid], p1] : [p0, [mid, p0[1]], [mid, p1[1]], p1];
    const w = Math.max(48, Math.min(C4.cardMaxW, e.label.length * M.edgeLabel + 20));
    return { d: 'M' + pts.map((p) => p.join(' ')).join('L'), points: pts, lx: (pts[1][0] + pts[2][0]) / 2, ly: (pts[1][1] + pts[2][1]) / 2, w };
  });
}

function c4Route(m, again) {
  const data = m.data, edges = c4Edges(m), nodes = {}, box = (n) => ({ x: n.ref.x + n.ref.w / 2, y: n.ref.y + n.ref.h / 2, w: n.ref.w, h: n.ref.h });
  const leaves = c4Leaves(m.root, []);
  // `item` (the top-level item of the end) is only read by a router that predates itemA/itemB
  leaves.forEach((n) => { nodes[n.id] = Object.assign(box(n), { item: Object.assign(box(n.top), { id: n.top.id }) }); });
  // the lane of every top-level item: same ring and side, in reading order (a loop under the row unless the two are single boxes side by side)
  const lanes = new Map();
  m.items.forEach((i) => { if (/^[NSEW]$/.test(i.side)) { const k = `${i.ring}${i.side}`; (lanes.get(k) || lanes.set(k, []).get(k)).push(i); } });
  lanes.forEach((l, k) => { const v = c4Vert(k.slice(-1)); l.sort((p, q) => (v ? p.ref.x - q.ref.x : p.ref.y - q.ref.y)); l.forEach((i, j) => { i.lane = j; }); });
  const single = (i) => i.kind === 'e' || i.self;
  // two siblings inside one group: side by side in a row, 'h' when next to each other and 'u' (loop under) when another member lies
  // between; one above the other, 'v' when next to each other; anywhere else the router chooses by the gap
  const innerHint = (x, y) => {
    const X = x.ref, Y = y.ref, mid = (r, ax) => (ax ? r.y + r.h / 2 : r.x + r.w / 2);
    const rowLike = X.y < Y.y + Y.h && Y.y < X.y + X.h, colLike = X.x < Y.x + Y.w && Y.x < X.x + X.w;
    if (!rowLike && !colLike) return undefined;
    const ax = rowLike ? 0 : 1, lo = Math.min(mid(X, ax), mid(Y, ax)), hi = Math.max(mid(X, ax), mid(Y, ax));
    const b0 = rowLike ? Math.min(X.y, Y.y) : Math.min(X.x, Y.x), b1 = rowLike ? Math.max(X.y + X.h, Y.y + Y.h) : Math.max(X.x + X.w, Y.x + Y.w);
    const between = m.gN.get(x.par).kids.some((s) => {
      const r = s.ref, c = mid(r, ax), o0 = rowLike ? r.y : r.x, o1 = rowLike ? r.y + r.h : r.x + r.w;
      return s !== x && s !== y && c > lo && c < hi && o0 < b1 && b0 < o1;
    });
    return rowLike ? (between ? 'u' : 'h') : (between ? undefined : 'v');
  };
  const hint = (A, B) => {
    if (A.par) return innerHint(A, B);
    if (A.ring !== B.ring) { const o = A.ring > B.ring ? A : B; return c4Vert(o.side) ? 'v' : 'h'; }
    if (A.side !== B.side || !A.side) return undefined;
    if (Math.abs(A.lane - B.lane) === 1 && single(A) && single(B)) return undefined;
    return c4Vert(A.side) ? 'u' : A.side === 'E' ? 'r' : 'l';   // under a row; out of a column, away from the centre
  };
  const item = (n) => ({ id: n.id, x: n.ref.x + n.ref.w / 2, y: n.ref.y + n.ref.h / 2, w: n.ref.w, h: n.ref.h });
  const rEdges = edges.map((e) => {
    const [A, B] = c4Sibs(m, e.a, e.b);
    return { from: e.from, to: e.to, label: e.text, tech: e.tech, hint: hint(A, B), itemA: item(A), itemB: item(B) };
  });
  const res = !edges.length ? [] : typeof routeC4Edges === 'function' ? routeC4Edges(nodes, rEdges) : c4Fallback(nodes, rEdges);
  let right = 0, bottom = 0, left = Infinity, top = Infinity;
  const grow = (x, y) => { if (x > right) right = x; if (y > bottom) bottom = y; if (x < left) left = x; if (y < top) top = y; };
  leaves.forEach((n) => { grow(n.ref.x, n.ref.y); grow(n.ref.x + n.ref.w, n.ref.y + n.ref.h); });
  m.items.forEach((n) => { grow(n.ref.x, n.ref.y); grow(n.ref.x + n.ref.w, n.ref.y + n.ref.h); });
  data._edges = [];
  edges.forEach((e, k) => {
    const rt = res[k];
    delete e.a; delete e.b;
    if (!rt || !rt.points) return;
    e.points = rt.points.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
    e.path = rt.d;
    e.labelBox = { x: Math.round(rt.lx - rt.w / 2), y: Math.round(rt.ly - 16), w: Math.round(rt.w), h: 32 };
    e.points.forEach((p) => grow(p[0], p[1]));
    grow(e.labelBox.x, e.labelBox.y); grow(e.labelBox.x + e.labelBox.w, e.labelBox.y + e.labelBox.h);
    data._edges.push(e);
  });
  // the picture starts at the margin: an arrow outside it moves the whole picture in, then the arrows are routed again
  if (!again && (left !== C4.margin || top !== C4.margin) && left < Infinity) {
    const dx = C4.margin - left, dy = C4.margin - top;
    m.items.forEach((i) => c4Shift(i, dx, dy));
    c4Route(m, true);
    return;
  }
  data.canvas = { width: Math.ceil(right + C4.margin), height: Math.ceil(bottom + C4.margin) };
}

// ---------- entry points ----------

function layoutDiagram(data) {
  const m = c4Model(data);
  m.links = c4Links(m);
  c4Rings(m);
  c4Place(m);
  c4Order(m);
  c4Stamp(m);
  c4StampRings(m);
  c4Frames(m);
  data._arrange = m.arrange;
  delete data._dir;
  c4Route(m);
  return data;
}

function routeDiagram(data) {
  const m = c4Model(data), hasPos = (n) => c4Num(n.ref.x) && c4Num(n.ref.y);
  const anyPos = (n) => hasPos(n) || n.kids.some(anyPos);
  if (m.items.some((i) => !(i.kind === 'g' && !i.self ? anyPos(i) : hasPos(i)))) return layoutDiagram(data);
  m.links = c4Links(m);
  c4Stamp(m);
  // a node without a position (hidden, or the members of a group just opened) sits where the group's own layout would put it
  if (Array.from(m.eN.values()).concat(Array.from(m.gN.values())).some((n) => !hasPos(n))) {
    m.gN.forEach((g) => { if (!g.par) c4Size(m, g, false); });
    const fill = (g) => {
      const known = g.kids.find(hasPos);
      const ox = hasPos(g) ? g.ref.x : known ? known.ref.x - known.rx - C4.pad : 0, oy = hasPos(g) ? g.ref.y : known ? known.ref.y - known.ry - C4.tagH : 0;
      g.kids.forEach((k) => {
        if (!hasPos(k)) { k.ref.x = ox + C4.pad + k.rx; k.ref.y = oy + C4.tagH + k.ry; }
        if (k.kind === 'g') fill(k);
      });
    };
    m.gN.forEach((g) => { if (!g.par) fill(g); });
  }
  c4Rings(m);
  m.items.forEach((i) => { c4Leaves(i, []).forEach((n) => { n.ax = n.ref.x; n.ay = n.ref.y; n.w = n.ref.w; n.h = n.ref.h; }); });
  c4Sides(m);
  c4StampRings(m);
  c4Frames(m);
  data._arrange = m.arrange;
  delete data._dir;
  c4Route(m);
  return data;
}
