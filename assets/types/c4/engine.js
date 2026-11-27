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
// layoutDiagram(data): full layout, ignores saved positions. routeDiagram(data, {pinned}): manual mode, keeps every saved x/y (see below).
// Groups are a tree of any depth: every step works on "a container and its visible members", never on a group kind.
// Deterministic: ties break by input order; no randomness.

const C4 = TOKENS.c4;
const C4_GRID = 4, C4_SWEEPS = 4, C4_PASSES = 4, C4_SIDES = ['S', 'W', 'E', 'N'];

const c4Num = (v) => typeof v === 'number' && isFinite(v);
const c4Grid = (v) => Math.ceil(v / C4_GRID) * C4_GRID;
const c4Vert = (s) => s === 'N' || s === 'S';

// Icon card size from the texts (widths only through TOKENS.font.metrics).
function c4Card(name, detail, extra) {
  const M = TOKENS.font.metrics, nm = String(name == null ? '' : name);
  const dt = String(detail == null ? '' : detail), ex = String(extra == null ? '' : extra);
  const dtW = dt.slice(0, 30).length * M.detail, exW = ex.slice(0, 30).length * M.detail;
  const w = Math.min(C4.cardMaxW, Math.max(C4.cardW, c4Grid(Math.max(nm.length * M.title, dtW, exW) + 2 * C4.pad)));
  const avail = Math.max(1, w - 2 * C4.pad);
  const lines = Math.min(2, Math.max(1, Math.ceil(nm.length * M.title / avail)));
  const extraLines = dt && ex ? Math.max(1, Math.min(2, Math.max(1, Math.ceil((dt.length + 2) * M.detail / avail))) + Math.min(3, Math.max(1, Math.ceil(ex.length * M.detail / avail))) - 1) : 0;
  return { w, h: C4.cardH + (lines - 1 + extraLines) * C4.cardLine };
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
    const tech = m.data.showTech === false ? '' : (e.tech || '');
    const t = c4Card(e.name || e.id, tech || e.description, tech && e.description ? e.description : ''); n.w = t.w; n.h = t.h;
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
  // a relation end resolves to the nearest visible node: the element/group itself, or the outermost collapsed group around it
  const rawNode = (id) => m.eN.get(id) || m.gN.get(id) || null;
  const endNode = (id) => {
    const n = rawNode(id);
    return n ? (n.vis ? n : m.gN.get(m.info.get(n.par).top)) : null;
  };
  const sameBranch = (x, y) => { const [sx, sy] = c4Sibs(m, x, y); return sx === sy; };
  m.rel2 = [];
  rels.forEach((r, i) => {
    const a0 = rawNode(r.from), b0 = rawNode(r.to);
    if (!a0 || !b0 || sameBranch(a0, b0)) return;
    const a = endNode(r.from), b = endNode(r.to);
    if (a && b && a !== b && !sameBranch(a, b)) m.rel2.push({ i, a, b, agg: a.id !== r.from || b.id !== r.to });
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

// Label + badge bounding box and required arrow-axis clearance (label + badge + 16px arrowhead + 2 * minStem).
function c4EdgeDims(label, tech, step) {
  const t = label == null ? '' : String(label).trim();
  const s = step == null ? '' : String(step).trim();
  const sz = t
    ? (typeof c4rLabelSize === 'function'
      ? c4rLabelSize(t, tech)
      : { w: Math.max(48, Math.min(C4.cardMaxW, t.length * TOKENS.font.metrics.edgeLabel + 24)), h: tech ? 44 : 30 })
    : { w: 0, h: 0 };
  const bg = s && typeof c4rBadgeSize === 'function' ? c4rBadgeSize(s) : { w: 0, h: 0 };
  return { w: sz.w, h: sz.h, bw: bg.w, bh: bg.h };
}

function c4EdgeClear(d, vert, padTrim = 0) {
  const lbl = vert ? d.h : d.w;
  const bg = d.bw ? (vert ? d.bh : d.bw) + 8 : 0;
  if (!lbl && !bg) return 0;
  return Math.max(0, lbl + bg + 16 + 2 * (C4.minStem || 20) - padTrim);
}

// Relations between members of one container, as [ci, cj, count, hasLbl, vNeed, hNeed, lblW, lblH] by container id (the lowest common container of the two endpoints).
function c4Links(m) {
  const sets = new Map();
  m.rels.forEach((r) => {
    const a0 = m.eN.get(r.from) || m.gN.get(r.from), b0 = m.eN.get(r.to) || m.gN.get(r.to);
    if (!a0 || !b0 || a0 === b0) return;
    const [x, y] = c4Sibs(m, a0, b0);
    if (x === y) return;
    const a = x.ci < y.ci ? x : y, b = a === x ? y : x, k = a.uid * 1e6 + b.uid;
    if (!sets.has(x.par)) sets.set(x.par, new Map());
    const mp = sets.get(x.par), e = mp.get(k);
    const hasLbl = Boolean(r.label && String(r.label).trim());
    const d = c4EdgeDims(r.label, r.tech, r.step);
    const expTrim = ((x.kind === 'g' && !x.self ? 1 : 0) + (y.kind === 'g' && !y.self ? 1 : 0)) * C4.pad;
    const vn = c4EdgeClear(d, true, expTrim), hn = c4EdgeClear(d, false, expTrim), hnRaw = c4EdgeClear(d, false, 0);
    const ea = a === x ? a0 : b0, eb = a === x ? b0 : a0;
    if (e) {
      e[2]++; if (hasLbl) e[3] = true;
      if (vn > e[4]) e[4] = vn;
      if (hn > e[5]) e[5] = hn;
      if (d.w > e[6]) e[6] = d.w;
      if (d.h > e[7]) e[7] = d.h;
      e[8].push([ea, eb, hnRaw]);
    } else mp.set(k, [a.ci, b.ci, 1, hasLbl, vn, hn, d.w, d.h, [[ea, eb, hnRaw]]]);
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
  const rowOf = new Int32Array(n);
  rows.forEach((row, ri) => row.its.forEach((i) => { rowOf[i] = ri; }));
  const shareFan = (a, b) => {
    for (const p of nbr[a]) {
      if (Math.abs(rank[p] - rank[a]) === 1 && nbr[b].includes(p) && its[p].w <= C4.labelMaxW + 60) return true;
    }
    return false;
  };
  const pairGap = (row, k) => {
    const a = row.its[k - 1], b = row.its[k];
    return shareFan(a, b) ? Math.max(G, 120) : G;
  };
  rows.forEach((row) => {
    let tot = 0;
    row.its.forEach((i, k) => { tot += its[i].w + (k ? pairGap(row, k) : 0); });
    let x = -tot / 2;
    row.its.forEach((i, k) => { if (k) x += pairGap(row, k); xa[i] = x; x += its[i].w; });
  });
  const hasSpine = rows.filter((row) => row.its.length === 1).length >= 2;
  const relax = (ri) => {
    const row = rows[ri], len = row.its.length, d = new Array(len), s = new Array(len);
    if (hasSpine && len === 1) {
      xa[row.its[0]] = -its[row.its[0]].w / 2;
      return;
    }
    let off = 0;
    row.its.forEach((i, k) => {
      if (k) off += pairGap(row, k) + its[row.its[k - 1]].w;
      let sum = 0, c = 0;
      nbr[i].forEach((j) => { if (rowOf[j] !== ri) { sum += xa[j] + its[j].w / 2; c++; } });
      d[k] = c ? sum / c - its[i].w / 2 : xa[i];
      s[k] = off;
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
  // 4b. equalize aligned cards/tiles: rows share height; vertically aligned columns share width when row clearance permits
  const isCard = (it) => it.kind === 'e' || it.self;
  rows.forEach((row) => {
    const cardH = Math.max(0, ...row.its.filter((i) => isCard(its[i])).map((i) => its[i].h));
    if (cardH) row.its.forEach((i) => { if (isCard(its[i])) c4MatchSize(its[i], its[i].w, cardH); });
  });
  const colsX = [];
  for (let i = 0; i < n; i++) {
    if (!isCard(its[i])) continue;
    const cx = xa[i] + its[i].w / 2;
    let col = colsX.find((c) => Math.abs(c.cx - cx) <= 4);
    if (!col) { col = { cx, list: [] }; colsX.push(col); }
    col.list.push(i);
  }
  for (const col of colsX) {
    if (col.list.length < 2) continue;
    const colW = Math.max.apply(null, col.list.map((i) => its[i].w));
    const canWiden = col.list.every((i) => {
      if (its[i].w === colW) return true;
      const rIts = rows[rowOf[i]].its, posInRow = rIts.indexOf(i);
      const cx = xa[i] + its[i].w / 2, x0 = cx - colW / 2, x1 = cx + colW / 2;
      if (posInRow > 0) { const L = rIts[posInRow - 1]; if (xa[L] + its[L].w + G > x0) return false; }
      if (posInRow < rIts.length - 1) { const R = rIts[posInRow + 1]; if (x1 + G > xa[R]) return false; }
      return true;
    });
    if (canWiden) {
      for (const i of col.list) {
        const cx = xa[i] + its[i].w / 2;
        c4MatchSize(its[i], colW, its[i].h);
        xa[i] = Math.round(cx - colW / 2);
      }
    }
  }
  // 5. along: rows in rank order; the gap between ranks grows with crossing edges and their label heights
  const span = new Int32Array(R + 1);
  const needAt = new Float64Array(R);
  const byGap = Array.from({ length: R }, () => []);
  edges.forEach((e) => {
    const lo = Math.min(rank[e[0]], rank[e[1]]), hi = Math.max(rank[e[0]], rank[e[1]]);
    span[lo]++; span[hi]--;
    if (hi === lo + 1) {
      if ((e[4] || 0) > needAt[lo]) needAt[lo] = e[4];
      if ((e[7] || 0) > 0) byGap[lo].push(e);
    }
  });
  const minStem = C4.minStem || 20;
  for (let r = 0; r < R; r++) {
    if (byGap[r].length < 2) continue;
    const straight = [];
    for (const e of byGap[r]) {
      const a = e[0], b = e[1];
      const ov = Math.min(xa[a] + its[a].w, xa[b] + its[b].w) - Math.max(xa[a], xa[b]);
      if (ov >= 20) {
        const cx = (Math.max(xa[a], xa[b]) + Math.min(xa[a] + its[a].w, xa[b] + its[b].w)) / 2;
        straight.push({ cx, w: e[6] || 0, h: e[7] || 0 });
      }
    }
    straight.sort((p, q) => p.cx - q.cx);
    for (let k = 1; k < straight.length; k++) {
      const p = straight[k - 1], q = straight[k];
      if (q.cx - p.cx < (p.w + q.w) / 2 + 16) {
        const stagger = p.h + q.h + 8 + 16 + 2 * minStem;
        if (stagger > needAt[r]) needAt[r] = stagger;
      }
    }
  }
  const gapAt = new Array(R);
  let run = 0;
  for (let r = 0; r < R; r++) { run += span[r]; gapAt[r] = Math.max(C4.flowAlong + C4.flowPerEdge * Math.min(C4.flowEdgeCap, run), needAt[r]); }
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

function c4MatchSize(it, w, h) {
  if (it.kind === 'e') { it.w = w; it.h = h; }
  else if (it.self) { it.tw = it.w = w; it.th = it.h = h; }
}

// Members in one line (a row, or a column when `vert`); `gapOf(prev, it)` is the space between neighbours. Returns the line's size.
function c4Line(its, vert, gapOf) {
  const cross = Math.max.apply(null, its.map((i) => (vert ? i.w : i.h)));
  const cardCross = Math.max(0, ...its.filter((i) => i.kind === 'e' || i.self).map((i) => (vert ? i.w : i.h)));
  let p = 0;
  its.forEach((it, k) => {
    if (k) p += gapOf(its[k - 1], it);
    if (cardCross && (it.kind === 'e' || it.self)) c4MatchSize(it, vert ? cardCross : it.w, vert ? it.h : cardCross);
    if (vert) { it.rx = Math.round((cross - it.w) / 2); it.ry = p; p += it.h; } else { it.ry = Math.round((cross - it.h) / 2); it.rx = p; p += it.w; }
  });
  return vert ? { w: cross, h: p } : { w: p, h: cross };
}

const c4InsetX = (m, anc, node, fromRight) => {
  if (!m || !anc || !node || anc === node || anc.kind !== 'g' || anc.self) return 0;
  let x = 0, cur = node;
  while (cur && cur !== anc) {
    x += cur.rx;
    const p = m.gN.get(cur.par);
    if (!p) return 0;
    x += C4.pad + (p.cx || 0);
    cur = p;
  }
  if (cur !== anc) return 0;
  return fromRight ? Math.max(0, anc.fw - (x + node.w)) : Math.max(0, x);
};
const c4LinkGap = (a, b, vert, link = true, m = null) => {
  const labeled = typeof link === 'boolean' ? link : Boolean(link && link[3]);
  if (vert) return Math.max(C4.innerLinkY, (Array.isArray(link) && link[4]) || 0);
  if (!labeled) return Math.max(C4.innerGap, 56);
  const exp = (it) => it && it.kind === 'g' && !it.self;
  if ((exp(a) || exp(b)) && Array.isArray(link) && Array.isArray(link[8]) && m) {
    const flipped = a.ci > b.ci;
    let need = C4.innerGap * 2;
    for (const [e0, e1, hnRaw] of link[8]) {
      const leftEnd = flipped ? e1 : e0, rightEnd = flipped ? e0 : e1;
      const trim = c4InsetX(m, a, leftEnd, true) + c4InsetX(m, b, rightEnd, false);
      const ext = Math.max(C4.innerGap * 2, hnRaw - trim);
      if (ext > need) need = ext;
    }
    return need;
  }
  const baseH = exp(a) || exp(b) ? Math.max(C4.innerGap, Math.round(C4.innerLinkX * 0.55)) : C4.innerLinkX;
  return Math.max(baseH, (Array.isArray(link) && link[5]) || 0);
};

// Sizes group `g` (and the groups below it): lays its members out, sets the frame (fw, fh) and w, h as drawn inside its parent.
// vert: the group sits beside the centre, so its members form a column. Members: no links, a row; links between neighbours,
// the row with room for the label; a link that skips a member (or too many members), a small flow.
function c4Size(m, g, vert) {
  g.kids.forEach((k) => { if (k.kind === 'g') c4Size(m, k, false); });
  if (vert) {
    const subs = g.kids.filter((k) => k.kind === 'g' && !k.self);
    if (subs.length > 1) {
      const mw = Math.max.apply(null, subs.map((k) => k.fw));
      subs.forEach((k) => { k.cx += Math.round((mw - k.fw) / 2); k.fw = mw; k.w = mw; });
    }
  }
  const its = g.kids, n = its.length, pairs = m.links.has(g.id) ? Array.from(m.links.get(g.id).values()) : [];
  let c;
  g.line = null;   // 'row' or 'col' when the members form one plain line (c4Order may reorder it), else null
  if (!n) c = { w: 0, h: 0 };
  else if (pairs.some((p) => p[1] - p[0] !== 1) || (pairs.length && n > C4.rowMax)) c = c4Flow(its, pairs);
  else {
    const linked = new Map(pairs.map((p) => [p[0], p]));
    const gap = (a, b) => (linked.has(a.ci) ? c4LinkGap(a, b, vert, linked.get(a.ci), m) : C4.innerGap);
    const lines = [];
    for (let o = 0; o < n; o += C4.rowMax) lines.push(its.slice(o, o + C4.rowMax));
    if (lines.length === 1) g.line = vert ? 'col' : 'row';
    c = { w: 0, h: 0 };
    let off = 0;
    lines.forEach((ln) => {
      const s = c4Line(ln, vert, (a, b) => gap(a, b));
      ln.forEach((it) => { if (vert) it.rx += off; else it.ry += off; });
      off += (vert ? s.w : s.h) + C4.innerGap;
      c = vert ? { w: off - C4.innerGap, h: Math.max(c.h, s.h) } : { w: Math.max(c.w, s.w), h: off - C4.innerGap };
    });
  }
  g.fw = n ? Math.max(c.w + 2 * C4.pad, c4TagW(g.ref)) : C4.emptyW;
  g.cx = n ? Math.round((g.fw - 2 * C4.pad - c.w) / 2) : 0;
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

function c4SharedSide(m, s) {
  const raw = String(s.ref.side == null ? '' : s.ref.side).toUpperCase();
  if (/^[NSEW]$/.test(raw)) return raw;
  return m.layerDir === 'vertical' ? 'S' : 'E';
}

function c4SpanRange(m, s) {
  const n = m.mainLayers.length;
  if (!n) return null;
  if (Array.isArray(s.ref.span) && s.ref.span.length) {
    const idxBy = new Map(m.mainLayers.map((g, i) => [g.id, i]));
    const idxs = s.ref.span.map((id) => idxBy.get(id)).filter((i) => i !== undefined);
    if (idxs.length) return [Math.min.apply(null, idxs), Math.max.apply(null, idxs)];
  }
  return [0, n - 1];
}

// arrange, items, links between items and rings. Ring: surround = links from the nearest centre item; flow = links from the items
// nobody points at; layers = index of the top-level main group (loose elements after the groups; shared groups placed separately).
function c4Rings(m) {
  const data = m.data, items = m.items;
  items.forEach((it) => { it.ring = -1; it.adj = []; it.nb = new Set(); it.pointed = false; });
  const core = new Set();
  m.eN.forEach((n) => { if (n.ref.core === true) core.add(n.top); });
  m.gN.forEach((n) => { if (n.ref.core === true) core.add(n.top); });
  let arrange = data.arrange === 'surround' || data.arrange === 'flow' || data.arrange === 'layers' ? data.arrange : (core.size ? 'surround' : 'flow');
  if (arrange === 'surround' && !core.size) arrange = 'flow';
  m.arrange = arrange;
  m.layerDir = arrange === 'layers' && data.layerDirection === 'vertical' ? 'vertical' : 'horizontal';
  m.mainLayers = arrange === 'layers' ? items.filter((i) => i.kind === 'g' && i.ref.shared !== true) : [];
  m.sharedLayers = arrange === 'layers' ? items.filter((i) => i.kind === 'g' && i.ref.shared === true) : [];
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
  let ringItems = items;
  if (arrange === 'layers') {
    const ord = m.mainLayers.concat(items.filter((i) => i.kind === 'e'));
    ord.forEach((i, k) => { i.ring = k; });
    m.sharedLayers.forEach((s) => { s.ring = ord.length; });
    ringItems = ord;
  } else if (arrange === 'surround') {
    bfs(items.filter((i) => core.has(i)), 0);
    items.forEach((i) => { if (i.ring < 0) bfs([i], 1); });
  } else {
    const roots = items.filter((i) => !i.pointed);
    bfs(roots.length ? roots : items.slice(0, 1), 0);
    items.forEach((i) => { if (i.ring < 0) bfs([i], 0); });
  }
  m.maxRing = ringItems.reduce((a, i) => Math.max(a, i.ring), 0);
  m.byRing = Array.from({ length: m.maxRing + 1 }, () => []);
  ringItems.forEach((i) => m.byRing[i.ring].push(i));
  // links to the inner rings (they set the gutter), and the centre nodes each item links to
  items.forEach((i) => { i.nIn = 0; i.hasLabelIn = false; i.cl = null; i.maxVNeed = 0; i.maxHNeed = 0; i.maxLblH = 0; i.inTargets = null; });
  m.rel2.forEach((r) => {
    const a = r.a.top, b = r.b.top;
    if (a === b || a.ring === b.ring) return;
    const o = a.ring > b.ring ? a : b, inner = o === a ? r.b : r.a;
    o.nIn++;
    const rel = m.rels[r.i];
    if (Math.abs(a.ring - b.ring) === 1 && rel && rel.label && String(rel.label).trim()) o.hasLabelIn = true;
    if (Math.abs(a.ring - b.ring) === 1 && rel) {
      const d = c4EdgeDims(rel.label, rel.tech, rel.step);
      const vn = c4EdgeClear(d, true, 0), hn = c4EdgeClear(d, false, 0);
      if (vn > o.maxVNeed) o.maxVNeed = vn;
      if (hn > o.maxHNeed) o.maxHNeed = hn;
      if (d.h > o.maxLblH) o.maxLblH = d.h;
      (o.inTargets || (o.inTargets = new Set())).add(inner.id);
    }
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
// on a side that every centre box it links to exposes; later rings follow their inner neighbour. Flow and horizontal layers: below (S).
// Vertical layers: right (E). Shared layers: explicit side or default (S for vertical, E for horizontal).
function c4Sides(m) {
  const { byRing, maxRing } = m;
  if (m.arrange !== 'surround') {
    const dir = m.arrange === 'layers' && m.layerDir === 'vertical' ? 'E' : 'S';
    for (let r = 1; r <= maxRing; r++) byRing[r].forEach((i) => { i.side = dir; });
    if (m.arrange === 'layers') m.sharedLayers.forEach((s) => { s.side = c4SharedSide(m, s); });
    return;
  }
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
function c4Lane(its, s, B, gap, flat = false) {
  const horiz = c4Vert(s), dir = s === 'N' || s === 'W' ? -1 : 1;
  const shareTarget = (a, b) => {
    if (flat || !horiz || !a.inTargets || !b.inTargets) return false;
    for (const id of a.inTargets) if (b.inTargets.has(id)) return true;
    return false;
  };
  let edge = s === 'N' ? B.ay - gap : s === 'S' ? B.ay + B.h + gap : s === 'E' ? B.ax + B.w + gap : B.ax - gap;
  for (let o = 0; o < its.length; o += C4.rowMax) {
    const line = its.slice(o, o + C4.rowMax);
    const gaps = line.map((it, k) => {
      if (!k) return 0;
      if (it.nb.has(line[k - 1])) return horiz ? C4.ringLinkX : C4.ringLinkY;
      return shareTarget(line[k - 1], it) ? Math.max(C4.ringGap, 112) : C4.ringGap;
    });
    const thick = Math.max.apply(null, line.map((i) => (horiz ? i.h : i.w)));
    const cardThick = Math.max(0, ...line.filter((i) => i.kind === 'e' || i.self).map((i) => (horiz ? i.h : i.w)));
    if (cardThick) line.forEach((it) => { if (it.kind === 'e' || it.self) c4MatchSize(it, horiz ? it.w : cardThick, horiz ? cardThick : it.h); });
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
  const { byRing, maxRing, items } = m, flat = m.arrange !== 'surround', vertLayers = m.arrange === 'layers' && m.layerDir === 'vertical';
  // surround: the centre is sized first (its boxes decide the sides), the rest once their side is known; flow and layers: all main items at once
  if (m.arrange === 'layers') {
    m.mainLayers.forEach((i) => c4Size(m, i, vertLayers));
    if (vertLayers) {
      const cols = m.mainLayers.filter((i) => !i.self);
      if (cols.length) {
        const mh = Math.max.apply(null, cols.map((i) => i.fh));
        cols.forEach((i) => { i.fh = mh; i.h = mh; });
        const simple = cols.filter((i) => !i.kids.some((k) => k.kind === 'g'));
        if (simple.length > 1) {
          const mw = Math.max.apply(null, simple.map((i) => i.fw));
          simple.forEach((i) => { i.cx += Math.round((mw - i.fw) / 2); i.fw = mw; i.w = mw; });
        }
      }
    } else {
      const bands = m.mainLayers.filter((i) => !i.self);
      if (bands.length) {
        const mw = Math.max.apply(null, bands.map((i) => i.fw));
        bands.forEach((i) => { i.cx = Math.round((mw - i.fw) / 2); i.fw = mw; i.w = mw; });
      }
    }
  } else {
    (flat ? items : byRing[0]).forEach((i) => { if (i.kind === 'g') c4Size(m, i, false); });
  }
  const cs = byRing[0], linked = (its) => its.some((a, i) => its.some((b, j) => j > i && a.nb.has(b)));
  let B;
  if (!cs.length) { B = { ax: 0, ay: 0, w: 0, h: 0 }; }
  else if (flat) { c4Lane(cs, vertLayers ? 'E' : 'S', { ax: 0, ay: 0, w: 0, h: 0 }, 0, true); B = c4Union(cs); } else {
    const cols = Math.ceil(Math.sqrt(cs.length)), rows = [], lk = linked(cs);
    for (let i = 0; i < cs.length; i += cols) rows.push(cs.slice(i, i + cols));
    const rootLinks = m.links.has('') ? Array.from(m.links.get('').values()) : [];
    const maxHN = rootLinks.reduce((mx, p) => Math.max(mx, p[5] || 0), 0);
    const maxVN = rootLinks.reduce((mx, p) => Math.max(mx, p[4] || 0), 0);
    const gx = lk ? Math.max(C4.ringLinkX, maxHN) : C4.centreGap, gy = lk ? Math.max(C4.ringLinkY, maxVN) : C4.centreGap;
    const rh = rows.map((r) => Math.max.apply(null, r.map((c) => c.h))), th = rh.reduce((s, h) => s + h, 0) + (rows.length - 1) * gy;
    const cw = new Array(cols).fill(0);
    rows.forEach((r) => r.forEach((c, ci) => { if ((c.kind === 'e' || c.self) && c.w > cw[ci]) cw[ci] = c.w; }));
    rows.forEach((r, ri) => {
      const cardH = Math.max(0, ...r.filter((c) => c.kind === 'e' || c.self).map((c) => c.h));
      r.forEach((c, ci) => { if (c.kind === 'e' || c.self) c4MatchSize(c, cw[ci] || c.w, cardH || c.h); });
    });
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
  const maxLayerH = vertLayers ? m.mainLayers.reduce((mx, i) => Math.max(mx, i.maxHNeed || 0), 0) : 0;
  const vertColGap = vertLayers ? Math.max(m.mainLayers.some((i) => i.hasLabelIn) ? 112 : 84, maxLayerH) : 0;
  for (let r = 1; r <= maxRing; r++) {
    const ring = byRing[r], placed = [];
    const ctr = (n) => ({ x: n.ax + n.w / 2, y: n.ay + n.h / 2 });
    const key = new Map(ring.map((it) => {
      const ns = it.adj.filter((n) => n.ring < r).map(ctr), v = c4Vert(it.side) ? 'x' : 'y';
      return [it, ns.length ? ns.reduce((s, p) => s + p[v], 0) / ns.length : 0];
    }));
    const side = (s) => ring.filter((i) => i.side === s).sort((a, b) => key.get(a) - key.get(b));
    const gutter = (its, base, horiz) => {
      let g = base + C4.ringStagger * Math.min(C4.ringStaggerCap, Math.max(0, its.reduce((t, i) => t + i.nIn, 0) - 3));
      for (const it of its) {
        const need = horiz ? it.maxVNeed : it.maxHNeed;
        if (need > g) g = need;
      }
      if (horiz && its.length > 1) {
        const byT = new Map();
        for (const it of its) if (it.inTargets && it.maxLblH) for (const tid of it.inTargets) (byT.get(tid) || byT.set(tid, []).get(tid)).push(it);
        for (const grp of byT.values()) if (grp.length > 1) {
          const hs = grp.map((it) => it.maxLblH).sort((a, b) => b - a);
          const stagger = hs[0] + hs[1] + 8 + 16 + 2 * (C4.minStem || 20);
          if (stagger > g && grp.length > 2) g = stagger;
        }
      }
      return g;
    };
    const N = side('N'), S = side('S'), E = side('E'), W = side('W');
    if (N.length) { c4Lane(N, 'N', B, gutter(N, C4.ringV, true), flat); placed.push(...N); }
    if (S.length) { c4Lane(S, 'S', B, gutter(S, C4.ringV, true), flat); placed.push(...S); }
    const B2 = placed.length ? c4Union([B, ...placed]) : B;
    if (E.length) { c4Lane(E, 'E', B2, vertLayers ? vertColGap : gutter(E, C4.ringH, false), flat); placed.push(...E); }
    if (W.length) { c4Lane(W, 'W', B2, gutter(W, C4.ringH, false), flat); placed.push(...W); }
    placed.forEach(c4Assign);
    B = c4Union([B, ...placed]);
  }
  // shared (cross-cutting) layers on N/S/E/W with full or partial contiguous span
  if (m.arrange === 'layers' && m.sharedLayers.length) {
    let skipCount = 0;
    m.rel2.forEach((r) => {
      const a = r.a.top, b = r.b.top;
      if (a !== b && a.ref.shared !== true && b.ref.shared !== true && Math.abs(a.ring - b.ring) > 1) skipCount++;
    });
    m.sharedLayers.forEach((s) => {
      const horiz = c4Vert(s.side);
      c4Size(m, s, !horiz);
      const range = c4SpanRange(m, s);
      s.spanRange = range;
      if (range) {
        const sb = c4Union(m.mainLayers.slice(range[0], range[1] + 1));
        if (horiz) {
          if (!s.self && sb.w > s.fw) { s.cx += Math.round((sb.w - s.fw) / 2); s.fw = sb.w; s.w = sb.w; }
          s.ax = Math.round(sb.ax + (sb.w - s.w) / 2);
        } else {
          if (!s.self && sb.h > s.fh) { s.fh = sb.h; s.h = sb.h; }
          s.ay = Math.round(sb.ay + (sb.h - s.h) / 2);
        }
      } else { s.ax = 0; s.ay = 0; }
    });
    const placeSharedSide = (list, sd, box) => {
      if (!list.length) return;
      const horiz = c4Vert(sd), dir = sd === 'N' || sd === 'W' ? -1 : 1;
      const perpToFlow = vertLayers ? horiz : !horiz;
      const hasDirectLink = list.some((s) => m.rel2.some((r) => r.a.top === s || r.b.top === s));
      const baseGap = horiz ? Math.round(C4.ringV * (hasDirectLink ? 0.9 : 0.6)) : Math.round(C4.ringH * (hasDirectLink ? 0.9 : 0.6));
      const corridor = perpToFlow && skipCount > 0 ? Math.min(44, 16 + skipCount * 10) : 0;
      const gap = baseGap + corridor;
      let edge = sd === 'N' ? box.ay - gap : sd === 'S' ? box.ay + box.h + gap : sd === 'E' ? box.ax + box.w + gap : box.ax - gap;
      const tracks = [];
      list.forEach((s) => {
        const lo = horiz ? s.ax : s.ay, hi = lo + (horiz ? s.w : s.h);
        let tr = tracks.find((t) => t.every((o) => hi + C4.ringGap <= o.lo || lo >= o.hi + C4.ringGap));
        if (!tr) { tr = []; tracks.push(tr); }
        tr.push({ s, lo, hi });
      });
      tracks.forEach((tr) => {
        const thick = Math.max.apply(null, tr.map((o) => (horiz ? o.s.h : o.s.w)));
        tr.forEach(({ s }) => {
          if (horiz) s.ay = sd === 'N' ? edge - s.h : edge;
          else s.ax = sd === 'W' ? edge - s.w : edge;
          c4Assign(s);
        });
        edge += dir * (thick + C4.ringGap);
      });
    };
    const byS = (sd) => m.sharedLayers.filter((s) => s.side === sd);
    const sN = byS('N'), sS = byS('S'), sE = byS('E'), sW = byS('W');
    placeSharedSide(sN, 'N', B);
    placeSharedSide(sS, 'S', B);
    const B2 = sN.length || sS.length ? c4Union([B, ...sN, ...sS]) : B;
    placeSharedSide(sW, 'W', B2);
    placeSharedSide(sE, 'E', B2);
  }
  // top-left origin: the picture starts at the margin
  if (!items.length) return;
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
    const seq = order.map((i) => its[i]), linked = new Map(pairs.map((p) => [p[0] * n + p[1], p]));
    const size = (k) => (vert ? k.h : k.w);
    const base = seq.map((k, i) => {
      if (!i) return 0;
      const lk = linked.get(Math.min(k.ci, seq[i - 1].ci) * n + Math.max(k.ci, seq[i - 1].ci));
      return lk ? c4LinkGap(seq[i - 1], k, vert, lk, m) : C4.innerGap;
    });
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

// Spatial buckets: boxes by id in 256 px cells, so a query touches only what is near it (no all-pairs work).
function c4Cells() {
  const S = 256, cells = new Map(), box = new Map();
  const span = (r, g) => [Math.floor((r.x - g) / S), Math.floor((r.y - g) / S), Math.floor((r.x + r.w + g) / S), Math.floor((r.y + r.h + g) / S)];
  const each = (r, g, fn) => { const [i0, j0, i1, j1] = span(r, g); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) fn(i * 200003 + j); };
  return {
    add(id, r) { box.set(id, r); each(r, 0, (k) => { const a = cells.get(k); if (a) a.push(id); else cells.set(k, [id]); }); },
    box(id) { return box.get(id); },
    del(id) { const r = box.get(id); if (r) { box.delete(id); each(r, 0, (k) => { const a = cells.get(k); a.splice(a.indexOf(id), 1); }); } },
    // ids of the boxes within `g` px of rect r (overlapping once both are grown by g)
    near(r, g) {
      const seen = new Set(), out = [];
      each(r, g, (k) => (cells.get(k) || []).forEach((id) => {
        if (seen.has(id)) return;
        seen.add(id);
        const b = box.get(id);
        if (b.x < r.x + r.w + g && r.x < b.x + b.w + g && b.y < r.y + r.h + g && r.y < b.y + b.h + g) out.push(id);
      }));
      return out;
    }
  };
}

// Siblings never overlap. Without pins (a group expanded, a layout): when one grows into the next, everything past it moves as one block.
// With pins (items just moved or placed, `pin` on the node, set up to every ancestor): a pinned item stays; an unpinned one that touches
// anything is shifted, as a block, the shortest way (right, down, left or up, ties in that order) to the nearest free spot, one item
// after the other in input order, so each moves once and the run ends. Two pinned items that overlap stay as they are.
function c4Separate(its, pins) {
  if (pins) return c4Settle(its);
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

function c4Settle(its) {
  const grid = c4Cells(), G = C4.sep, rect = (n) => ({ x: n.ref.x, y: n.ref.y, w: n.ref.w, h: n.ref.h });
  its.forEach((n, i) => grid.add(i, rect(n)));
  const todo = [];
  // an unpinned item is in the way of a pinned one within `sep`; of another unpinned one only when they really overlap
  its.forEach((n, i) => { if (!n.pin && (grid.near(grid.box(i), G).some((j) => its[j].pin) || grid.near(grid.box(i), 0).length > 1)) todo.push(i); });
  todo.forEach((i) => grid.del(i));
  todo.forEach((i) => {
    const n = its[i], r0 = rect(n);
    let best = null;
    [[1, 0], [0, 1], [-1, 0], [0, -1]].forEach(([sx, sy]) => {
      const r = Object.assign({}, r0);
      for (let k = 0; k <= its.length; k++) {
        const hits = grid.near(r, G).map((j) => grid.box(j));
        if (!hits.length) break;
        if (sx) r.x = sx > 0 ? Math.max.apply(null, hits.map((b) => b.x + b.w)) + G : Math.min.apply(null, hits.map((b) => b.x)) - G - r.w;
        else r.y = sy > 0 ? Math.max.apply(null, hits.map((b) => b.y + b.h)) + G : Math.min.apply(null, hits.map((b) => b.y)) - G - r.h;
      }
      const cost = Math.abs(r.x - r0.x) + Math.abs(r.y - r0.y);
      if (!best || cost < best.cost) best = { cost, dx: r.x - r0.x, dy: r.y - r0.y };
    });
    if (best.dx || best.dy) c4Shift(n, best.dx, best.dy);
    grid.add(i, rect(n));
  });
}

// Frames of the expanded groups from their members, deepest first; siblings are separated on the way. In layers every band spans the
// same width.
function c4Frames(m) {
  const conts = [m.root].concat(Array.from(m.gN.values()).filter((n) => n.vis && !n.self));
  conts.sort((p, q) => q.depth - p.depth);
  conts.forEach((c) => {
    const its = c.kids;
    c4Separate(its, m.pins);
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
    const contentW = x1 - x0 + 2 * C4.pad;
    g.w = Math.max(contentW, c4TagW(g));
    g.x = x0 - C4.pad - Math.round((g.w - contentW) / 2);
    g.y = y0 - C4.tagH;
    g.h = y1 - y0 + C4.tagH + C4.padB;
  });
  if (m.arrange === 'layers' && !m.pins) {
    if (m.layerDir === 'vertical') {
      const cols = m.mainLayers.filter((i) => !i.self);
      cols.forEach((col) => {
        const subs = col.kids.filter((k) => k.kind === 'g' && !k.self).map((k) => k.ref);
        if (subs.length > 1) {
          const x0 = Math.min.apply(null, subs.map((g) => g.x)), x1 = Math.max.apply(null, subs.map((g) => g.x + g.w));
          subs.forEach((g) => { g.x = x0; g.w = x1 - x0; });
        }
      });
      if (cols.length) {
        const refs = cols.map((i) => i.ref);
        const y0 = Math.min.apply(null, refs.map((g) => g.y)), y1 = Math.max.apply(null, refs.map((g) => g.y + g.h));
        refs.forEach((g) => { g.y = y0; g.h = y1 - y0; });
        const simple = cols.filter((i) => !i.kids.some((k) => k.kind === 'g')).map((i) => i.ref);
        if (simple.length > 1) {
          const mw = Math.max.apply(null, simple.map((g) => g.w));
          simple.forEach((g) => { g.x -= Math.round((mw - g.w) / 2); g.w = mw; });
        }
      }
    } else {
      const bands = m.mainLayers.filter((i) => !i.self).map((i) => i.ref);
      if (bands.length) {
        const x0 = Math.min.apply(null, bands.map((g) => g.x)), x1 = Math.max.apply(null, bands.map((g) => g.x + g.w));
        bands.forEach((g) => { g.x = x0; g.w = x1 - x0; });
      }
    }
    if (m.sharedLayers.length && m.mainLayers.length) {
      m.sharedLayers.forEach((s) => {
        if (s.self) return;
        const range = s.spanRange || c4SpanRange(m, s);
        if (!range) return;
        const slice = m.mainLayers.slice(range[0], range[1] + 1).map((g) => g.ref);
        if (c4Vert(s.side)) {
          const x0 = Math.min.apply(null, slice.map((g) => g.x)), x1 = Math.max.apply(null, slice.map((g) => g.x + g.w));
          if (x1 - x0 > s.ref.w) { s.ref.x = x0; s.ref.w = x1 - x0; }
        } else {
          const y0 = Math.min.apply(null, slice.map((g) => g.y)), y1 = Math.max.apply(null, slice.map((g) => g.y + g.h));
          if (y1 - y0 > s.ref.h) { s.ref.y = y0; s.ref.h = y1 - y0; }
        }
      });
    }
  }
}

// ---------- arrows ----------

// One arrow per visible pair: relations with an aggregated end merge by pair; direct ones merge when pair, label and tech match.
function c4Edges(m) {
  const map = new Map(), list = [];
  m.rel2.forEach((r) => {
    const rel = m.rels[r.i], label = String(rel.label == null ? '' : rel.label), tech = rel.tech ? String(rel.tech) : '';
    const step = rel.step != null ? String(rel.step).trim() : '';
    const color = rel.color != null ? String(rel.color).trim() : '';
    const key = r.agg ? `${r.a.uid}>${r.b.uid}` : `${r.a.uid}>${r.b.uid}|${label}|${tech}`;
    let e = map.get(key);
    if (!e) {
      e = { id: `r${r.i}`, from: r.a.id, to: r.b.id, label, tech, async: true, count: 0, members: [], a: r.a, b: r.b, _step: step, _color: color, _colorSame: true };
      map.set(key, e);
      list.push(e);
    } else if (color !== e._color) {
      e._colorSame = false;
    }
    e.count++; e.members.push(r.i);
    if (rel.async !== true) e.async = false;
  });
  list.forEach((e) => {
    e.text = e.count > 1 ? `${e.label} ×${e.count}` : e.label;
    if (e.count === 1 && e._step) e.step = e._step;
    if (e._colorSame && e._color) e.color = e._color;
    delete e._step; delete e._color; delete e._colorSame;
  });
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
  // visible expanded groups that act as relation endpoints get a frame-box entry in `nodes`
  let hasGroupEnd = false;
  edges.forEach((e) => {
    [e.a, e.b].forEach((n) => {
      if (n.kind === 'g' && n.vis && !n.self) {
        hasGroupEnd = true;
        if (!nodes[n.id]) nodes[n.id] = Object.assign(box(n), { frame: true, item: Object.assign(box(n.top), { id: n.top.id }) });
      }
    });
  });
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
  let hasLayerSkip = false;
  const rEdges = edges.map((e) => {
    const [A, B] = c4Sibs(m, e.a, e.b);
    if (m.arrange === 'layers' && !A.par && Math.abs(A.ring - B.ring) > 1) hasLayerSkip = true;
    const re = { from: e.from, to: e.to, label: e.text, tech: e.tech, hint: hint(A, B), itemA: item(A), itemB: item(B) };
    if (e.step) re.step = e.step;
    return re;
  });
  // manual mode, group endpoints, or layered cross-layer/shared-layer scenes: pass all expanded frames and enable obstacle detours
  const needDetours = data._manual === true || hasGroupEnd || (m.arrange === 'layers' && (m.layerDir === 'vertical' || m.sharedLayers.length > 0 || hasLayerSkip));
  const ropts = needDetours ? {
    manual: data._manual === true,
    detours: true,
    frames: Array.from(m.gN.values()).filter((g) => g.vis && !g.self).map((g) => ({ id: g.id, x: g.ref.x + g.ref.w / 2, y: g.ref.y + g.ref.h / 2, w: g.ref.w, h: g.ref.h }))
  } : undefined;
  const res = !edges.length ? [] : typeof routeC4Edges === 'function' ? routeC4Edges(nodes, rEdges, ropts) : c4Fallback(nodes, rEdges);
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
    const lh = rt.h || (e.tech ? 38 : 32);
    e.labelBox = { x: Math.round(rt.lx - rt.w / 2), y: Math.round(rt.ly - lh / 2), w: Math.round(rt.w), h: lh };
    e.points.forEach((p) => grow(p[0], p[1]));
    grow(e.labelBox.x, e.labelBox.y); grow(e.labelBox.x + e.labelBox.w, e.labelBox.y + e.labelBox.h);
    if (rt.badge) {
      e.badge = { x: Math.round(rt.badge.x), y: Math.round(rt.badge.y), w: Math.round(rt.badge.w), h: Math.round(rt.badge.h) };
      grow(e.badge.x, e.badge.y); grow(e.badge.x + e.badge.w, e.badge.y + e.badge.h);
    }
    data._edges.push(e);
  });
  // the picture starts at the margin: an arrow outside it moves the whole picture in
  if (!again && (left !== C4.margin || top !== C4.margin) && left < Infinity) {
    const dx = C4.margin - left, dy = C4.margin - top;
    m.items.forEach((i) => c4Shift(i, dx, dy));
    if (typeof buildCurvedPathWithHops === 'function') {
      data._edges.forEach((e) => {
        e.points = e.points.map((p) => [Math.round((p[0] + dx) * 10) / 10, Math.round((p[1] + dy) * 10) / 10]);
        e.path = buildCurvedPathWithHops(e.points, [], 8);
        e.labelBox = { x: Math.round(e.labelBox.x + dx), y: Math.round(e.labelBox.y + dy), w: e.labelBox.w, h: e.labelBox.h };
        if (e.badge) e.badge = { x: Math.round(e.badge.x + dx), y: Math.round(e.badge.y + dy), w: e.badge.w, h: e.badge.h };
      });
      right += dx; bottom += dy;
    } else {
      c4Route(m, true);
      return;
    }
  }
  data.canvas = { width: Math.ceil(right + C4.margin), height: Math.ceil(bottom + C4.margin) };
}

// ---------- entry points ----------

function c4OrderRings(m) {
  if (m.arrange !== 'surround') return;
  const ctr = (n) => ({ x: n.ax + n.w / 2, y: n.ay + n.h / 2 });
  for (let r = 1; r <= m.maxRing; r++) {
    // pairs: [innerTargetCoord, outerMemberCenter] per ring-r item, so a framed side group aligns its members to their callers
    const innerPairs = new Map();
    const pushPair = (it, target, member) => { (innerPairs.get(it) || innerPairs.set(it, []).get(it)).push([ctr(target), ctr(member)]); };
    m.rel2.forEach((rel) => {
      const at = rel.a.top, bt = rel.b.top;
      if (at.ring === r && bt.ring < r) pushPair(at, rel.b, rel.a);
      else if (bt.ring === r && at.ring < r) pushPair(bt, rel.a, rel.b);
    });
    const innerItems = m.items.filter((i) => i.ring < r);
    const innerBox = innerItems.length ? c4Union(innerItems) : null;
    const groups = new Map();
    m.byRing[r].forEach((it) => {
      if (!it.side) return;
      const k = it.side + '|' + (c4Vert(it.side) ? it.ay : it.ax);
      (groups.get(k) || groups.set(k, []).get(k)).push(it);
    });
    groups.forEach((its) => {
      const vert = c4Vert(its[0].side), ax = vert ? 'ax' : 'ay', sz = vert ? 'w' : 'h', coord = vert ? 'x' : 'y';
      its.sort((a, b) => a[ax] - b[ax]);
      const lo = its[0][ax], hi = its[its.length - 1][ax] + its[its.length - 1][sz];
      const minB = innerBox ? Math.min(lo, innerBox[ax]) : lo;
      const maxB = innerBox ? Math.max(hi, innerBox[ax] + innerBox[sz]) : hi;
      const keys = new Map(its.map((it, idx) => {
        const ps = innerPairs.get(it);
        const key = ps && ps.length ? ps.reduce((s, p) => s + p[0][coord], 0) / ps.length : it[ax] + it[sz] / 2;
        return [it, { key, idx }];
      }));
      const seq = its.slice().sort((a, b) => keys.get(a).key - keys.get(b).key || keys.get(a).idx - keys.get(b).idx);
      const gaps = seq.map((it, k) => (k ? (it.nb.has(seq[k - 1]) ? (vert ? C4.ringLinkX : C4.ringLinkY) : C4.ringGap) : 0));
      const total = seq.reduce((t, it, k) => t + it[sz] + gaps[k], 0);
      if (total > maxB - minB) return;
      // Align each outer-ring item to its own connected inner targets while preserving order and minimum gaps (PAV isotonic)
      const off = [0];
      for (let i = 1; i < seq.length; i++) off.push(off[i - 1] + seq[i - 1][sz] + gaps[i]);
      const baseP0 = lo + (hi - lo - total) / 2;
      const desired = seq.map((it, i) => {
        const ps = innerPairs.get(it);
        if (!ps || !ps.length) return baseP0 + off[i];
        let sum = 0;
        for (const p of ps) sum += p[0][coord] - (p[1][coord] - it[ax]);
        return sum / ps.length;
      });
      const blocks = [];
      for (let i = 0; i < seq.length; i++) {
        blocks.push({ sum: desired[i] - off[i], cnt: 1, from: i });
        while (blocks.length > 1) {
          const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
          if (a.sum / a.cnt <= b.sum / b.cnt) break;
          a.sum += b.sum; a.cnt += b.cnt; blocks.pop();
        }
      }
      const pos = new Array(seq.length);
      blocks.forEach((b) => {
        const v = b.sum / b.cnt;
        for (let k = b.from; k < b.from + b.cnt; k++) pos[k] = v + off[k];
      });
      // Clamp within [minB, maxB] without breaking minimum gaps
      if (pos[0] < minB) {
        pos[0] = minB;
        for (let i = 1; i < seq.length; i++) pos[i] = Math.max(pos[i], pos[i - 1] + seq[i - 1][sz] + gaps[i]);
      }
      const last = seq.length - 1;
      if (pos[last] + seq[last][sz] > maxB) {
        pos[last] = maxB - seq[last][sz];
        for (let i = last - 1; i >= 0; i--) pos[i] = Math.min(pos[i], pos[i + 1] - gaps[i + 1] - seq[i][sz]);
      }
      seq.forEach((it, i) => {
        it[ax] = Math.round(pos[i]);
        c4Assign(it);
      });
    });
  }
}

function layoutDiagram(data) {
  const m = c4Model(data);
  m.links = c4Links(m);
  c4Rings(m);
  c4Place(m);
  c4Order(m);
  c4OrderRings(m);
  c4Stamp(m);
  c4StampRings(m);
  c4Frames(m);
  data._arrange = m.arrange;
  delete data._manual;
  delete data._dir;
  c4Route(m);
  return data;
}

// ---------- manual mode: items without a saved position ----------

const c4Has = (n) => c4Num(n.ref.x) && c4Num(n.ref.y);
const c4Placed = (n) => c4Has(n) || n.kids.some(c4Placed);
const c4In = (m, x, u) => { for (let n = x; n; n = m.gN.get(n.par)) if (n === u) return true; return false; };

// The box a visible node takes now: a tile, or the frame its positioned members give an expanded group; null when nothing is positioned.
function c4Rect(n) {
  if (!n.vis) return null;
  const r = n.ref;
  if (n.kind === 'e' || n.self) return c4Has(n) ? { x: r.x, y: r.y, w: n.kind === 'e' ? n.w : n.tw, h: n.kind === 'e' ? n.h : n.th } : null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  n.kids.forEach((k) => {
    const q = c4Rect(k);
    if (q) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x + q.w); y1 = Math.max(y1, q.y + q.h); }
  });
  if (x0 === Infinity) return c4Has(n) ? { x: r.x, y: r.y, w: C4.emptyW, h: C4.emptyH } : null;
  return { x: x0 - C4.pad, y: y0 - C4.tagH, w: Math.max(x1 - x0 + 2 * C4.pad, c4TagW(r)), h: y1 - y0 + C4.tagH + C4.padB };
}

function c4GroupVert(m, g) {
  if (!g || g.par || m.data.arrange !== 'layers') return false;
  const vertDir = m.data.layerDirection === 'vertical';
  if (g.ref.shared !== true) return vertDir;
  const raw = String(g.ref.side == null ? '' : g.ref.side).toUpperCase();
  const side = /^[NSEW]$/.test(raw) ? raw : (vertDir ? 'S' : 'E');
  return !c4Vert(side);
}

// The next slot in a group's line of members (its row, or column beside the centre; a flow goes below): after the last member.
function c4Slot(m, g, u, w, h) {
  const its = g.kids.filter((k) => k !== u).map((k) => ({ k, r: c4Rect(k) })).filter((q) => q.r);
  const U = its.reduce((a, q) => ({ x: Math.min(a.x, q.r.x), y: Math.min(a.y, q.r.y), x1: Math.max(a.x1, q.r.x + q.r.w), y1: Math.max(a.y1, q.r.y + q.r.h) }), { x: Infinity, y: Infinity, x1: -Infinity, y1: -Infinity });
  const f = its[0].r, rowLike = its.every((q) => q.r.y < f.y + f.h && f.y < q.r.y + q.r.h), colLike = its.every((q) => q.r.x < f.x + f.w && f.x < q.r.x + q.r.w);
  const vert = its.length > 1 ? !rowLike && colLike : (g.top.side === 'E' || g.top.side === 'W' || c4GroupVert(m, g));
  if (!rowLike && !colLike) return [U.x, U.y1 + C4.innerGap];
  const last = its.reduce((a, q) => ((vert ? q.r.y + q.r.h > a.r.y + a.r.h : q.r.x + q.r.w > a.r.x + a.r.w) ? q : a)), end = last.r;
  const linked = m.rel2.some((r) => (c4In(m, r.a, u) && c4In(m, r.b, last.k)) || (c4In(m, r.b, u) && c4In(m, r.a, last.k)));
  const gap = Math.max(C4.sep, linked ? (vert ? C4.innerLinkY : C4.innerLinkX) : C4.innerGap);
  return vert ? [Math.round((U.x + U.x1 - w) / 2), end.y + end.h + gap] : [end.x + end.w + gap, Math.round((U.y + U.y1 - h) / 2)];
}

// Nearest free spot (w x h, clear of every top-level box by `sep`) beside the item `u` links to, else beside the item nearest the
// centre of the picture; rings of growing distance, the side order S, E, W, N (N, E, W, S when u is the source of the link).
function c4Spot(m, ob, u, w, h) {
  let A = null, below = true;
  for (const r of m.rel2) {
    const other = c4In(m, r.a, u) ? r.b : c4In(m, r.b, u) ? r.a : null, q = other && other.top !== u.top && ob.rects.get(other.top);
    if (q) { A = q; below = other === r.a; break; }
  }
  const all = Array.from(ob.rects.values());
  if (!all.length) return [C4.margin, C4.margin];
  if (!A) {
    const cx = all.reduce((a, q) => a + q.x + q.w / 2, 0) / all.length, cy = all.reduce((a, q) => a + q.y + q.h / 2, 0) / all.length;
    A = all.reduce((a, q) => (Math.hypot(q.x + q.w / 2 - cx, q.y + q.h / 2 - cy) < Math.hypot(a.x + a.w / 2 - cx, a.y + a.h / 2 - cy) ? q : a));
  }
  const step = 40, cx = A.x + A.w / 2, cy = A.y + A.h / 2, K = Math.ceil((Math.max(A.w, A.h) + Math.max(w, h)) / step / 2) + 1;
  for (let ring = 0; ring < 300; ring++) {
    for (const s of below ? 'SEWN' : 'NEWS') {
      const v = c4Vert(s), gap = (v ? C4.ringV : C4.ringH) + ring * step;
      let best = null;
      for (let k = 0; k <= K; k++) {
        for (const sg of k ? [1, -1] : [1]) {
          const o = sg * k * step;
          const x = v ? cx - w / 2 + o : s === 'E' ? A.x + A.w + gap : A.x - gap - w, y = v ? (s === 'S' ? A.y + A.h + gap : A.y - gap - h) : cy - h / 2 + o;
          const d = Math.hypot(x + w / 2 - cx, y + h / 2 - cy);
          if ((!best || d < best.d) && !ob.grid.near({ x, y, w, h }, C4.sep).length) best = { x, y, d };
        }
      }
      if (best) return [Math.round(best.x), Math.round(best.y)];
    }
  }
  return [Math.round(Math.max.apply(null, all.map((q) => q.x + q.w)) + C4.ringH), Math.round(A.y)];
}

// Gives every visible item without a saved position one, never by the full layout. A group with nothing positioned inside is one block
// (its own layout: c4Size) put at its saved position, else at a slot or a free spot; an element or tile joins its group's line of
// members, or takes a free spot when loose. A collapsed tile with no position sits where its hidden members are. Returns the ids placed.
function c4Fill(m) {
  const fixed = [], free = [], done = [];
  const walk = (c) => c.kids.forEach((k) => {
    if (!k.vis) return;
    if (k.kind === 'g' && !k.self && k.kids.some(c4Placed)) { walk(k); return; }
    if (k.kind === 'g' && !k.self && k.kids.length && c4Has(k)) fixed.push(k);
    else if (!c4Has(k)) (k.kind === 'g' && k.self && k.kids.some(c4Placed) ? fixed : free).push(k);
  });
  walk(m.root);
  const put = (u, x, y) => {
    if (u.kind === 'g' && u.kids.length) c4Size(m, u, c4GroupVert(m, u));
    u.ax = x; u.ay = y; c4Assign(u);
    done.push(u.id);
  };
  fixed.forEach((u) => {
    if (c4Has(u)) { put(u, u.ref.x, u.ref.y); return; }
    let x = Infinity, y = Infinity;
    const lo = (n) => { if (n.kind === 'e' && c4Has(n)) { x = Math.min(x, n.ref.x); y = Math.min(y, n.ref.y); } n.kids.forEach(lo); };
    lo(u);
    u.ref.x = x - C4.pad; u.ref.y = y - C4.tagH;
    done.push(u.id);
  });
  if (!free.length) return done;
  const ob = { grid: c4Cells(), rects: new Map() };
  const set = (it) => { if (ob.rects.has(it)) { ob.grid.del(it); ob.rects.delete(it); } const r = c4Rect(it); if (r) { ob.rects.set(it, r); ob.grid.add(it, r); } };
  m.items.forEach(set);
  free.forEach((u) => {
    if (u.kind === 'g' && u.kids.length) c4Size(m, u, c4GroupVert(m, u));
    const [w, h] = u.kind === 'e' ? [u.w, u.h] : u.self ? [u.tw, u.th] : u.kids.length ? [u.fw, u.fh] : [C4.emptyW, C4.emptyH];
    const g = m.gN.get(u.par), [x, y] = g ? c4Slot(m, g, u, w, h) : c4Spot(m, ob, u, w, h);
    put(u, x, y);
    set(u.top);
  });
  return done;
}

function c4EqualizeSaved(m) {
  const isCard = (k) => k.vis && (k.kind === 'e' || k.self) && c4Has(k);
  const wOf = (k) => (k.kind === 'e' ? k.w : k.tw);
  const hOf = (k) => (k.kind === 'e' ? k.h : k.th);
  const boxOf = (o) => {
    const ow = o.kind === 'e' ? o.w : o.self ? o.tw : o.fw, oh = o.kind === 'e' ? o.h : o.self ? o.th : o.fh;
    return ow && oh ? { x: o.ref.x, y: o.ref.y, w: ow, h: oh } : null;
  };
  const sweep = (list) => {
    const cards = list.filter(isCard);
    if (cards.length < 2) return;
    const grid = list.length > 24 ? c4Cells() : null;
    if (grid) list.forEach((o) => { if (o.vis && c4Has(o)) { const b = boxOf(o); if (b) grid.add(o, b); } });
    const clearOf = (group, x0, y0, x1, y1) => {
      const r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      const cands = grid ? grid.near(r, 0) : list;
      return cands.every((o) => {
        if (!o.vis || group.includes(o) || !c4Has(o)) return true;
        const b = boxOf(o);
        return !b || !(x0 < b.x + b.w && b.x < x1 && y0 < b.y + b.h && b.y < y1);
      });
    };
    const byX = new Map();
    for (const c of cards) {
      const k = Math.round(c.ref.x);
      let g = byX.get(k) || byX.get(k - 1) || byX.get(k + 1);
      if (!g) { g = []; byX.set(k, g); }
      g.push(c);
    }
    for (const g of byX.values()) {
      if (g.length < 2) continue;
      const maxW = Math.max.apply(null, g.map(wOf));
      const ys = g.slice().sort((a, b) => a.ref.y - b.ref.y);
      if (ys.some((c, i) => i && ys[i - 1].ref.y + hOf(ys[i - 1]) > c.ref.y)) continue;
      if (g.every((c) => wOf(c) === maxW || clearOf(g, c.ref.x, c.ref.y, c.ref.x + maxW, c.ref.y + hOf(c)))) {
        g.forEach((c) => c4MatchSize(c, maxW, hOf(c)));
      }
    }
    const byY = new Map();
    for (const c of cards) {
      const k = Math.round(c.ref.y);
      let g = byY.get(k) || byY.get(k - 1) || byY.get(k + 1);
      if (!g) { g = []; byY.set(k, g); }
      g.push(c);
    }
    for (const g of byY.values()) {
      if (g.length < 2) continue;
      const maxH = Math.max.apply(null, g.map(hOf));
      const xs = g.slice().sort((a, b) => a.ref.x - b.ref.x);
      if (xs.some((c, i) => i && xs[i - 1].ref.x + wOf(xs[i - 1]) > c.ref.x)) continue;
      if (g.every((c) => hOf(c) === maxH || clearOf(g, c.ref.x, c.ref.y, c.ref.x + wOf(c), c.ref.y + maxH))) {
        g.forEach((c) => c4MatchSize(c, wOf(c), maxH));
      }
    }
  };
  sweep(m.items);
  m.gN.forEach((g) => { if (g.vis && !g.self) sweep(g.kids); });
}

// Keeps every saved position and recomputes frames, arrows and canvas. opts.pinned: ids (elements, groups) just moved; they stay when
// boxes or frames overlap and the others shift away as blocks. Items without a position are placed incrementally (c4Fill) and pinned.
// Nothing positioned at all: the full layout. data._manual: true when the saved positions were kept.
function routeDiagram(data, opts) {
  const m = c4Model(data);
  if (!m.items.some(c4Placed)) return layoutDiagram(data);
  m.links = c4Links(m);
  c4EqualizeSaved(m);
  c4Stamp(m);
  const pins = new Set((opts && opts.pinned) || []);
  c4Fill(m).forEach((id) => pins.add(id));
  // a hidden node without a position sits where its group's own layout would put it
  if (Array.from(m.eN.values()).concat(Array.from(m.gN.values())).some((n) => !n.vis && !c4Has(n))) {
    m.gN.forEach((g) => { if (!g.par) c4Size(m, g, false); });
    const fill = (g) => {
      const known = g.kids.find(c4Has);
      const ox = c4Has(g) ? g.ref.x : known ? known.ref.x - known.rx - C4.pad : 0, oy = c4Has(g) ? g.ref.y : known ? known.ref.y - known.ry - C4.tagH : 0;
      g.kids.forEach((k) => {
        if (!c4Has(k) && !k.vis) { k.ref.x = ox + C4.pad + k.rx; k.ref.y = oy + C4.tagH + k.ry; }
        if (k.kind === 'g') fill(k);
      });
    };
    m.gN.forEach((g) => { if (!g.par) fill(g); });
  }
  // a pin counts for every group around it: the frame it sits in moves with it
  pins.forEach((id) => { for (let n = m.eN.get(id) || m.gN.get(id); n; n = m.gN.get(n.par)) { n.pin = true; m.pins = true; } });
  c4Rings(m);
  m.items.forEach((i) => { c4Leaves(i, []).forEach((n) => { n.ax = n.ref.x; n.ay = n.ref.y; n.w = n.ref.w; n.h = n.ref.h; }); });
  c4Sides(m);
  c4StampRings(m);
  c4Frames(m);
  data._arrange = m.arrange;
  data._manual = true;
  delete data._dir;
  c4Route(m);
  return data;
}
