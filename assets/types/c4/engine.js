// C4 layout engine. Pure JS, no DOM, plain script. Run by the page (Tidy, edits, saved-page routes) and by
// scripts/run_engine.mjs (--layout), after assets/shell/ortho-router.js. Contract: dev/plans/plan-c4.md (Engine contract).
//
// Input:  groups[{id,name,kind,parent?,collapsed?}], elements[{id,kind,name,tech?,description?,group?}],
//         relations[{from,to,label,tech?,async?}], direction? ('LR' | 'TB'; else chosen like the flowchart)
// Output (derived, written in place; canvas px, top-left origin):
//   elements[].x,y,w,h,_hidden          tile box; a hidden element (inside a collapsed group) keeps its x,y, w = h = 0
//   groups[].x,y,w,h,_depth,_collapsed,_hidden
//                                       frame box (tag band included); a collapsed group is one tile (w,h of a tile);
//                                       _hidden is true for a group inside a collapsed one (w = h = 0)
//   data._edges[{id,from,to,label,tech,async,count,members,points,path,labelBox,text}]
//                                       the arrows drawn; `text` is the pill's label line (`label` plus ` xN` when merged)
//   data.canvas {width,height}; data._dir 'LR' | 'TB' (the flow axis used)
// layoutDiagram(data): full layout. routeDiagram(data): keeps every visible x/y, recomputes frames, arrows, canvas.
// Groups are a tree of any depth: every step below works on "a container and its visible items", never on a group kind.
// Deterministic: ties break by input order; no randomness.

const C4 = {
  // tiles
  TILE_MIN_W: 160, TILE_MAX_W: 240, PAD_X: 14, PAD_Y: 12, TITLE_H: 18, DETAIL_H: 16, MIN_H: 64, PERSON_EXTRA: 44, DESC_LINES: 3, GRID: 4,
  // frames
  GROUP_PAD: 24, TAG_H: 32, TAG_PAD_X: 72, EMPTY_W: 200, EMPTY_H: 96,
  // placement
  GAP_ACROSS: 40, GAP_ALONG_TB: 72, GAP_ALONG_LR: 150, GAP_PER_EDGE: 10, GAP_EDGE_CAP: 8, ROW_MAX: 10, ROW_GAP: 40, MARGIN: 48,
  SWEEPS: 4, PASSES: 4, SEP: 24,
  // direction choice (the flowchart's rule: scripts/layout_engine.py VIEW_W, VIEW_H, READABLE_ZOOM, TB_MIN_GAIN)
  VIEW_W: 1760, VIEW_H: 856, READABLE_ZOOM: 0.84, TB_MIN_GAIN: 0.05,
  // arrows
  LABEL_W: 160, LABEL_LINE_H: 16, LABEL_PAD_Y: 12
};

const c4Num = (v) => typeof v === 'number' && isFinite(v);
const c4Grid = (v) => Math.ceil(v / C4.GRID) * C4.GRID;
const c4Lines = (text, cw, limit, max) => {
  const n = String(text == null ? '' : text).trim().length;
  return n ? Math.min(max, Math.max(1, Math.ceil(n * cw / limit))) : 0;
};

// Tile size from the texts (widths only through TOKENS.font.metrics). `tech` is true when a detail line is shown.
function c4TileSize(name, tech, desc, person) {
  const M = TOKENS.font.metrics;
  const want = Math.max(String(name).length * M.title, tech ? (String(tech).length + 2) * M.detail : 0) + 2 * C4.PAD_X;
  const w = Math.min(C4.TILE_MAX_W, Math.max(C4.TILE_MIN_W, c4Grid(want)));
  const inner = w - 2 * C4.PAD_X;
  const h = 2 * C4.PAD_Y + c4Lines(name, M.title, inner, 2) * C4.TITLE_H + (tech ? C4.DETAIL_H : 0)
    + c4Lines(desc, M.detail, inner, C4.DESC_LINES) * C4.DETAIL_H + (person ? C4.PERSON_EXTRA : 0);
  return { w, h: Math.max(C4.MIN_H, c4Grid(h)) };
}

// ---------- model ----------

function c4Model(data) {
  const els = data.elements || [], grs = data.groups || [], rels = data.relations || [];
  const m = { data, els, grs, rels, gBy: new Map(), info: new Map(), elIt: new Map(), grIt: new Map(), kids: new Map(), members: new Map(), items: [] };
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
  m.members.set('', []);
  grs.forEach((g) => { if (m.info.get(g.id) && m.gBy.get(g.id) === g) m.members.set(g.id, []); });
  const elCont = (e) => (m.info.has(e.group) ? e.group : '');
  // class of an item: persons first (0), externals last (2); a group takes its members' class when they all agree
  const K = (e) => (e.kind === 'person' ? 0 : e.kind === 'external' ? 2 : 1);
  els.forEach((e) => {
    const c = elCont(e);
    m.members.get(c).push(e);
    for (let g = c; g; g = m.info.get(g).par) m.info.get(g).cls[K(e)]++;
  });
  grs.forEach((g) => { if (m.gBy.get(g.id) === g) m.members.get(m.info.get(g.id).par || '').push(g); });
  // visible items: elements and groups whose container is not hidden; ordered elements first, then groups, in input order
  let uid = 0;
  const addItem = (it) => { it.uid = uid++; it.ci = 0; m.items.push(it); return it; };
  els.forEach((e) => {
    const c = elCont(e);
    if (c && m.info.get(c).eff) return;
    if (m.elIt.has(e.id)) return;
    const s = c4TileSize(e.name || e.id, e.tech ? e.tech : '', e.description, e.kind === 'person');
    const it = addItem({ kind: 'e', ref: e, id: e.id, par: c, depth: c ? m.info.get(c).depth + 1 : 1, w: s.w, h: s.h, cls: K(e) });
    m.elIt.set(e.id, it);
  });
  grs.forEach((g) => {
    const gi = m.info.get(g.id);
    if (m.gBy.get(g.id) !== g || (gi.par && m.info.get(gi.par).eff)) return;
    const cl = gi.cls, cls = cl[0] && !cl[1] && !cl[2] ? 0 : cl[2] && !cl[0] && !cl[1] ? 2 : 1;
    const it = addItem({ kind: 'g', ref: g, id: g.id, par: gi.par || '', depth: gi.depth, cls, collapsed: gi.eff, w: 0, h: 0 });
    if (gi.eff) { const s = c4TileSize(g.name || g.id, ' ', '', false); it.w = s.w; it.h = s.h; }
    m.grIt.set(g.id, it);
  });
  m.kids.set('', []);
  m.grIt.forEach((it, id) => { if (!it.collapsed) m.kids.set(id, []); });   // an empty expanded group still gets a frame
  m.items.forEach((it) => {
    if (!m.kids.has(it.par)) m.kids.set(it.par, []);
    const list = m.kids.get(it.par);
    it.ci = list.length;
    list.push(it);
  });
  // a relation end resolves to the nearest visible item: the element, or the outermost collapsed group around it
  const endItem = (id) => {
    const e = m.elIt.get(id);
    if (e) return e;
    const el = m.elByIdAll || (m.elByIdAll = new Map(els.map((x) => [x.id, x])));
    const x = el.get(id);
    if (!x) return null;
    const c = elCont(x);
    return c && m.info.get(c).eff ? m.grIt.get(m.info.get(c).top) : null;
  };
  m.rels2 = [];
  rels.forEach((r, i) => {
    const a = endItem(r.from), b = endItem(r.to);
    if (a && b && a !== b) m.rels2.push({ i, a, b, agg: a.id !== r.from || b.id !== r.to });
  });
  return m;
}

// ---------- placement of one container ----------

// Places `its` (the visible items of one container) with `edges` ([ai, bi, weight] on indexes into `its`); sets each item's
// rx, ry (relative to the container's content origin) and returns the content size {w, h}.
function c4Flow(its, edges, tb) {
  const n = its.length;
  if (!n) return { w: 0, h: 0 };
  const A = (i) => (tb ? its[i].h : its[i].w), X = (i) => (tb ? its[i].w : its[i].h);
  // 1. rank: orient every edge toward the later class (people first, externals last), drop the back edges of a DFS, longest path
  const out = its.map(() => []), nbr = its.map(() => []), indeg = new Int32Array(n);
  edges.forEach((e) => {
    let u = e[0], v = e[1];
    if (its[u].cls > its[v].cls) { const t = u; u = v; v = t; }
    out[u].push(v); nbr[u].push(v); nbr[v].push(u); indeg[v]++;
  });
  const state = new Uint8Array(n), ptr = new Int32Array(n), fw = its.map(() => []), post = [];
  const starts = [];
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
        if (state[v] === 1) continue;                   // back edge: dropped from the ranking only
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
  // 2. order inside each rank: barycentre sweeps with a fixed pass count
  const pos = new Float64Array(n);
  const setPos = (r) => order[r].forEach((i, k) => { pos[i] = (k + 0.5) / order[r].length; });
  for (let r = 0; r < R; r++) setPos(r);
  const sweep = (r, dir) => {
    const arr = order[r];
    if (arr.length < 2) return;
    const keyed = arr.map((i, k) => {
      let s = 0, c = 0;
      nbr[i].forEach((j) => { if (dir > 0 ? rank[j] < r : rank[j] > r) { s += pos[j]; c++; } });
      return [c ? s / c : pos[i], k, i];
    });
    keyed.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    order[r] = keyed.map((p) => p[2]);
    setPos(r);
  };
  for (let s = 0; s < C4.SWEEPS; s++) {
    for (let r = 1; r < R; r++) sweep(r, 1);
    for (let r = R - 2; r >= 0; r--) sweep(r, -1);
  }
  // 3. rows: a rank of more than ROW_MAX items wraps into balanced rows
  const rows = [];
  for (let r = 0; r < R; r++) {
    const arr = order[r], k = Math.ceil(arr.length / C4.ROW_MAX), size = Math.ceil(arr.length / k);
    for (let s = 0; s < arr.length; s += size) rows.push({ r, its: arr.slice(s, s + size), t: 0 });
  }
  rows.forEach((row) => { row.t = Math.max.apply(null, row.its.map(A)); });
  // 4. across: centre each row, then pull items toward their neighbours' centres (isotonic regression keeps order and gaps)
  const xa = new Float64Array(n), G = C4.GAP_ACROSS;
  rows.forEach((row) => {
    let tot = -G;
    row.its.forEach((i) => { tot += X(i) + G; });
    let x = -tot / 2;
    row.its.forEach((i) => { xa[i] = x; x += X(i) + G; });
  });
  const rowOf = new Int32Array(n);
  rows.forEach((row, ri) => row.its.forEach((i) => { rowOf[i] = ri; }));
  const relax = (ri) => {
    const row = rows[ri], len = row.its.length, d = new Array(len), s = new Array(len);
    let off = 0;
    row.its.forEach((i, k) => {
      let sum = 0, c = 0;
      nbr[i].forEach((j) => { if (rowOf[j] !== ri) { sum += xa[j] + X(j) / 2; c++; } });
      d[k] = c ? sum / c - X(i) / 2 : xa[i];
      s[k] = off; off += X(i) + G;
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
  for (let p = 0; p < C4.PASSES; p++) {
    for (let ri = 0; ri < rows.length; ri++) relax(ri);
    for (let ri = rows.length - 1; ri >= 0; ri--) relax(ri);
  }
  // 5. along: rows in rank order; the gap between ranks grows with the arrows that cross it (room for labels and channels)
  const span = new Int32Array(R + 1);
  edges.forEach((e) => {
    const lo = Math.min(rank[e[0]], rank[e[1]]), hi = Math.max(rank[e[0]], rank[e[1]]);
    span[lo]++; span[hi]--;
  });
  const gapBase = tb ? C4.GAP_ALONG_TB : C4.GAP_ALONG_LR, gapAt = new Array(R);
  let run = 0;
  for (let r = 0; r < R; r++) { run += span[r]; gapAt[r] = gapBase + C4.GAP_PER_EDGE * Math.min(C4.GAP_EDGE_CAP, run); }
  const ya = new Float64Array(n);
  let along = 0, minX = Infinity, maxX = -Infinity;
  rows.forEach((row, ri) => {
    if (ri) along += rows[ri - 1].r === row.r ? C4.ROW_GAP : gapAt[rows[ri - 1].r];
    row.its.forEach((i) => {
      ya[i] = along + (row.t - A(i)) / 2;
      if (xa[i] < minX) minX = xa[i];
      if (xa[i] + X(i) > maxX) maxX = xa[i] + X(i);
    });
    along += row.t;
  });
  for (let i = 0; i < n; i++) {
    const across = xa[i] - minX;
    its[i].rx = Math.round(tb ? across : ya[i]);
    its[i].ry = Math.round(tb ? ya[i] : across);
  }
  const ac = Math.round(maxX - minX), al = Math.round(along);
  return tb ? { w: ac, h: al } : { w: al, h: ac };
}

const c4TagW = (g) => String(g.name || g.id).length * TOKENS.font.metrics.title + C4.TAG_PAD_X;

// Lays out every container, deepest first (a group box is one item of its parent's ranking), then writes absolute positions.
function c4Arrange(m, tb) {
  const edgeSets = new Map(), N = m.items.length || 1;
  m.rels2.forEach((r) => {
    let x = r.a, y = r.b;
    const up = (it) => m.grIt.get(it.par);
    while (x.depth > y.depth) x = up(x);
    while (y.depth > x.depth) y = up(y);
    while (x.par !== y.par) { x = up(x); y = up(y); }
    if (!edgeSets.has(x.par)) edgeSets.set(x.par, new Map());
    const mp = edgeSets.get(x.par), k = x.uid * N + y.uid, e = mp.get(k);
    if (e) e[2]++; else mp.set(k, [x.ci, y.ci, 1]);
  });
  const conts = Array.from(m.kids.keys());
  const depthOf = (id) => (id ? m.info.get(id).depth : 0);
  conts.sort((p, q) => depthOf(q) - depthOf(p));
  const content = new Map();
  conts.forEach((id) => {
    const its = m.kids.get(id), es = edgeSets.has(id) ? Array.from(edgeSets.get(id).values()) : [];
    const c = c4Flow(its, es, tb);
    content.set(id, c);
    if (!id) return;
    const git = m.grIt.get(id);
    if (!git.collapsed) {
      const g = git.ref;
      git.w = c.w || c.h ? Math.max(c.w + 2 * C4.GROUP_PAD, c4TagW(g)) : C4.EMPTY_W;
      git.h = c.w || c.h ? c.h + 2 * C4.GROUP_PAD + C4.TAG_H : C4.EMPTY_H;
    }
  });
  const root = content.get('');
  m.canvas = { width: root.w + 2 * C4.MARGIN, height: root.h + 2 * C4.MARGIN };
  conts.sort((p, q) => depthOf(p) - depthOf(q));
  conts.forEach((id) => {
    const ox = id ? m.grIt.get(id).ax + C4.GROUP_PAD : C4.MARGIN, oy = id ? m.grIt.get(id).ay + C4.GROUP_PAD + C4.TAG_H : C4.MARGIN;
    m.kids.get(id).forEach((it) => { it.ax = ox + it.rx; it.ay = oy + it.ry; });
  });
}

// ---------- state, frames ----------

// Sizes and flags that never come from the saved file.
function c4Stamp(m) {
  m.els.forEach((e) => {
    const it = m.elIt.get(e.id);
    e._hidden = !it;
    e.w = it ? it.w : 0;
    e.h = it ? it.h : 0;
  });
  m.grs.forEach((g) => {
    const gi = m.info.get(g.id);
    if (!gi || m.gBy.get(g.id) !== g) return;
    g._depth = gi.depth;
    g._collapsed = gi.eff;
    g._hidden = !!(gi.par && m.info.get(gi.par).eff);
    const it = m.grIt.get(g.id);
    if (g._hidden) { g.w = 0; g.h = 0; } else if (it.collapsed) { g.w = it.w; g.h = it.h; }
  });
}

function c4Shift(m, it, dx, dy) {
  const mv = (o) => { if (c4Num(o.x)) o.x += dx; if (c4Num(o.y)) o.y += dy; };
  mv(it.ref);
  if (it.kind !== 'g') return;
  const stack = [it.id];
  while (stack.length) {
    (m.members.get(stack.pop()) || []).forEach((o) => { mv(o); if (m.members.has(o.id) && m.gBy.get(o.id) === o) stack.push(o.id); });
  }
}

// Siblings never overlap: when one grows into the next (a group expanded), everything past it moves as one block.
function c4Separate(m, its) {
  const n = its.length;
  for (let pass = 0; pass <= n; pass++) {
    const byX = its.slice().sort((p, q) => p.ref.x - q.ref.x || p.ref.y - q.ref.y || p.ci - q.ci);
    let hit = null;
    for (let i = 0; i < n && !hit; i++) {
      const a = byX[i].ref;
      for (let j = i + 1; j < n; j++) {
        const b = byX[j].ref;
        if (b.x >= a.x + a.w + C4.SEP) break;
        if (b.y < a.y + a.h + C4.SEP && a.y < b.y + b.h + C4.SEP) { hit = [byX[i], byX[j]]; break; }
      }
    }
    if (!hit) return;
    // the earlier one in reading order stays; the later one and everything past it on the chosen axis shifts
    const [p, q] = hit[0].ref.y < hit[1].ref.y || (hit[0].ref.y === hit[1].ref.y && hit[0].ref.x <= hit[1].ref.x) ? hit : [hit[1], hit[0]];
    const a = p.ref, b = q.ref;
    const dx = a.x + a.w + C4.SEP - b.x, dy = a.y + a.h + C4.SEP - b.y;
    const canX = b.x > a.x, canY = b.y > a.y;
    const useX = canX && (!canY || dx < dy);
    if (!canX && !canY) { c4Shift(m, q, 0, dy); continue; }
    its.forEach((s) => {
      if (s === p) return;
      if (useX ? s.ref.x >= b.x : s.ref.y >= b.y) c4Shift(m, s, useX ? dx : 0, useX ? 0 : dy);
    });
  }
}

// Frames of the expanded groups from their visible items, deepest first; siblings are separated on the way.
function c4Frames(m) {
  const conts = Array.from(m.kids.keys());
  const depthOf = (id) => (id ? m.info.get(id).depth : 0);
  conts.sort((p, q) => depthOf(q) - depthOf(p));
  conts.forEach((id) => {
    const its = m.kids.get(id);
    c4Separate(m, its);
    if (!id) return;
    const git = m.grIt.get(id);
    if (git.collapsed) return;
    const g = git.ref;
    if (!its.length) {
      if (!c4Num(g.x)) g.x = 0;
      if (!c4Num(g.y)) g.y = 0;
      g.w = C4.EMPTY_W; g.h = C4.EMPTY_H;
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
    g.x = x0 - C4.GROUP_PAD; g.y = y0 - C4.GROUP_PAD - C4.TAG_H;
    g.w = Math.max(x1 - x0 + 2 * C4.GROUP_PAD, c4TagW(g)); g.h = y1 - y0 + 2 * C4.GROUP_PAD + C4.TAG_H;
  });
}

// ---------- arrows ----------

function c4LabelBox(text, tech, cx, cy) {
  const M = TOKENS.font.metrics, t = String(text || '');
  if (!t) return { x: cx, y: cy, w: 0, h: 0 };
  const lw = t.length * M.edgeLabel + 20, lines = Math.max(1, Math.ceil(lw / C4.LABEL_W));
  const techW = tech ? (String(tech).length + 2) * M.detail + 20 : 0;
  const w = Math.round(Math.max(48, Math.min(lw, C4.LABEL_W), Math.min(techW, C4.LABEL_W)));
  const h = C4.LABEL_PAD_Y + lines * C4.LABEL_LINE_H + (tech ? C4.LABEL_LINE_H : 0);
  return { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h };
}

// One arrow per visible pair: relations with an aggregated end merge by pair; direct ones merge when pair, label and tech match.
function c4Edges(m) {
  const map = new Map(), list = [];
  m.rels2.forEach((r) => {
    const rel = m.rels[r.i], label = String(rel.label == null ? '' : rel.label), tech = rel.tech ? String(rel.tech) : '';
    const key = r.agg ? `${r.a.uid}>${r.b.uid}` : `${r.a.uid}>${r.b.uid}|${label}|${tech}`;
    let e = map.get(key);
    if (!e) {
      e = { id: `r${r.i}`, from: r.a.id, to: r.b.id, label, tech, async: true, count: 0, members: [] };
      map.set(key, e);
      list.push(e);
    }
    e.count++; e.members.push(r.i);
    if (rel.async !== true) e.async = false;
  });
  list.forEach((e) => { e.text = e.count > 1 ? `${e.label} ×${e.count}` : e.label; });
  return list;
}

function c4Route(m, tb) {
  const data = m.data, edges = c4Edges(m), boxes = {}, nodes = [];
  m.items.forEach((it) => {
    if (it.kind === 'g' && !it.collapsed) return;
    const r = it.ref;
    boxes[it.id] = { x: r.x, y: r.y, w: r.w, h: r.h };
    nodes.push({ id: it.id, type: 'process' });
  });
  const routes = edges.length ? routeEdgesOrthogonal({
    chartData: { nodes, edges: edges.map((e) => ({ id: e.id, from: e.from, to: e.to, label: e.text })) },
    tb, boxes, laneDividers: [], loopSide: () => 'far', outlineInset: () => 0, labelMaxW: C4.LABEL_W
  }) : {};
  let right = 0, bottom = 0;
  const grow = (x, y) => { if (x > right) right = x; if (y > bottom) bottom = y; };
  m.items.forEach((it) => grow(it.ref.x + it.ref.w, it.ref.y + it.ref.h));
  data._edges = [];
  edges.forEach((e) => {
    const rt = routes[e.id];
    if (!rt || !rt.points) return;
    e.points = rt.points.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
    e.path = rt.path;
    e.labelBox = c4LabelBox(e.text, e.tech, rt.midX, rt.midY);
    e.points.forEach((p) => grow(p[0], p[1]));
    grow(e.labelBox.x + e.labelBox.w, e.labelBox.y + e.labelBox.h);
    data._edges.push(e);
  });
  data.canvas = { width: Math.ceil(right + C4.MARGIN), height: Math.ceil(bottom + C4.MARGIN) };
}

// ---------- entry points ----------

const c4DirOf = (data) => (/^tb$/i.test(data.direction) ? 'TB' : /^lr$/i.test(data.direction) ? 'LR' : null);

// Hidden members of a collapsed group sit where they would be inside it: lay out a copy with every group open.
function c4PlaceHidden(m, tb) {
  if (!m.grs.some((g) => m.info.has(g.id) && m.info.get(g.id).eff)) return;
  const copy = { groups: JSON.parse(JSON.stringify(m.grs)), elements: m.els.map((e) => ({ id: e.id, kind: e.kind, name: e.name, tech: e.tech, description: e.description, group: e.group })), relations: m.rels };
  copy.groups.forEach((g) => { delete g.collapsed; });
  const o = c4Model(copy);
  c4Arrange(o, tb);
  const place = (obj, id, top) => {
    const t = m.grIt.get(top), a = o.elIt.get(id) || o.grIt.get(id), at = o.grIt.get(top);
    if (!t || !a || !at) return;
    obj.x = t.ref.x + (a.ax - at.ax);
    obj.y = t.ref.y + (a.ay - at.ay);
  };
  m.els.forEach((e) => {
    const c = m.info.has(e.group) ? e.group : '';
    if (c && m.info.get(c).eff) place(e, e.id, m.info.get(c).top);
  });
  m.grs.forEach((g) => {
    const gi = m.info.get(g.id);
    if (gi && m.gBy.get(g.id) === g && gi.par && m.info.get(gi.par).eff) place(g, g.id, m.info.get(gi.par).top);
  });
}

function layoutDiagram(data) {
  const m = c4Model(data);
  let dir = c4DirOf(data);
  if (dir) c4Arrange(m, dir === 'TB');
  else {
    c4Arrange(m, false);
    const lr = m.canvas;
    dir = 'LR';
    if (Math.min(1, C4.VIEW_W / lr.width, C4.VIEW_H / lr.height) < C4.READABLE_ZOOM) {
      c4Arrange(m, true);
      const tbc = m.canvas;
      if (Math.min(1, C4.VIEW_W / tbc.width) >= Math.min(1, C4.VIEW_H / lr.height) + C4.TB_MIN_GAIN) dir = 'TB';
      else c4Arrange(m, false);
    }
  }
  const tb = dir === 'TB';
  m.items.forEach((it) => { it.ref.x = it.ax; it.ref.y = it.ay; });
  c4Stamp(m);
  c4PlaceHidden(m, tb);
  c4Frames(m);
  data._dir = dir;
  c4Route(m, tb);
  return data;
}

function routeDiagram(data) {
  const m = c4Model(data);
  if (m.items.some((it) => (it.kind === 'e' || it.collapsed) && !(c4Num(it.ref.x) && c4Num(it.ref.y)))) return layoutDiagram(data);
  c4Stamp(m);
  m.els.forEach((e) => { if (e._hidden && !(c4Num(e.x) && c4Num(e.y))) { const gi = m.info.get(e.group); const t = gi && m.grIt.get(gi.top); e.x = t ? t.ref.x : 0; e.y = t ? t.ref.y : 0; } });
  c4Frames(m);
  let dir = c4DirOf(data);
  if (!dir) {
    let dx = 0, dy = 0;
    m.rels2.forEach((r) => { dx += Math.abs(r.a.ref.x + r.a.ref.w / 2 - r.b.ref.x - r.b.ref.w / 2); dy += Math.abs(r.a.ref.y + r.a.ref.h / 2 - r.b.ref.y - r.b.ref.h / 2); });
    dir = dy >= dx ? 'TB' : 'LR';
    if (!m.rels2.length) dir = data._dir === 'TB' ? 'TB' : 'LR';
  }
  data._dir = dir;
  c4Route(m, dir === 'TB');
  return data;
}
