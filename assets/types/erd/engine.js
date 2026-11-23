// ER layout engine (v3). Pure JS, no DOM. Run by the page (Tidy, edits, and the saved-page routes) and by
// scripts/run_engine.mjs (--layout), so both use this one implementation. Plan: dev/plans/plan-erd-layout-v3.md.
//
// Input:  detail? ("all" | "keys" | "names"), showTypes?,
//         entities[{id,name,color?,columns?[{name,type?,pk?,fk?,unique?,nullable?,note?}],collapsed?}],
//         relationships[{id,from,to,columns?,toColumns?,fromEnd?,toEnd?,identifying?,label?}]
//           (from = the child table that holds the foreign key, to = the parent).
// Output (derived, written in place):
//         entities[].x / entities[].y   top-left of the table, absolute screen px (saved by the page)
//         entities[].box {x,y,w,h}      the table's rectangle
//         relationships[].curve [P0,P1,P2,P3]  one cubic Bezier per line, leaving each port at right angles to its side
//         relationships[].points        the curve sampled into ER.SEG segments (for crossing and hit tests)
//         relationships[].labelBox      {x,y,w,h} at the curve's midpoint, when "label" is set
//         data.canvas {width,height,crossings,length,hits}   hits = curves running through a table they do not join
// layoutDiagram(data, opts): places the tables as a node graph, then routes. Deterministic (no randomness, stable order).
//   Cold (default): stress majorization from a seeded start, 18 variants, local search on the best few.
//   opts.warm: starts from the saved x/y (a table without one starts beside its neighbours), keeps the shape and only
//   makes room and repairs lines (about 1 s for 30 tables, against about 7 s cold). Components may be re-packed.
// routeDiagram(data): routes from the saved x/y alone (lays out when a table has no position yet).
// Also used by the page: erVisibleColumns, erEntitySize, erRelEnds, and the ER constants (HEAD_H, ROW_H, MORE_H, MIN_W, MARGIN, ...).

const ER = {
  HEAD_H: 36, ROW_H: 26, MORE_H: 22,            // header strip, one column row, the "+ N more" row
  CHAR_W: TOKENS.font.metrics.label, TITLE_CHAR_W: TOKENS.font.metrics.title, TYPE_CHAR_W: TOKENS.font.metrics.type, PAD_X: 12, GLYPH_W: 22, TYPE_GAP: 16,
  MIN_W: 168, MAX_W: 360, GRID: 4,
  GAP_X: 80, GAP_Y: 56,                          // clear space kept between tables (the overlap removal)
  REL_GAP: 98, REL_LABEL_GAP: 66,                // related tables keep this much clear on the axis their line uses (98: 2 px for rounding), and label width + 66 when the line has a label
  EVEN_K: 2.0, HOLE_OK: 0.10, HOLE_CELLS: 1200,  // a table's nearest gap may be this many times the median; an empty rectangle may cover this share of the box (the cost counts the excess); grid cells in the hole search
  SAME_COLOR: 0.8,                               // tables of one colour count as this much closer
  ASPECT_LO: 1.6, ASPECT_HI: 2.0, ASPECT_T: 1.9, // the layout is scaled toward this width / height range
  STRESS_IT: 200, FORCE_IT: 50, WARM_FORCE_IT: 20,
  HUB_PULL: [0, 1.2e-4, 3e-4],                              // pull of the three most connected tables toward the centre (stress weight)
  AREA_DIV: 20000,                                          // bounding-box area counts as area / AREA_DIV in the cost
  // shortcut: a fixed nominal view (1760x856 at 66%) instead of the real viewport, upgrade if layouts must fit other screens
  VIEW_W: 1760, VIEW_H: 856, FIT_MIN: 0.62,
  UNHIT_IT: 30, SQUEEZE_STEPS: 30,
  SHAPE_X: 0.25,                                 // share of the aspect change done by stretching x (the rest squashes y)
  REFINE: 2, REFINE_SMALL: 12, SMALL: 16,        // candidates refined by the local search (a diagram of up to SMALL tables refines more)
  REPAIR_PASSES: 10, POLISH_T: [600, 300, 150, 0], REPAIR_T: [2500, 1200, 600, 300, 150, 0], WARM_T: [300, 0],
  VARIANTS: 18,                                  // candidate layouts tried (seed angle and direction differ)
  LITE: 9, LITE_VARIANTS: 6, LITE_REFINE: 1, LITE_T: [600, 150, 0],   // above LITE tables: fewer candidates, LITE_REFINE refined, a short schedule, no polish
  SEG: 16,                                       // segments per sampled curve
  PORT_GAP: 22, PORT_MARGIN: 14,                 // spacing of lines on one side, and the corner margin
  CTRL_MIN: 40, CTRL_MAX: 160, CTRL_DIV: 2.5,    // control distance = clamp(distance / CTRL_DIV, CTRL_MIN, CTRL_MAX)
  SELF_CTRL: 60,                                 // self-reference loop: right side out, top in
  LABEL_H: 22, LABEL_X: 12, LABEL_CHAR_W: TOKENS.font.metrics.edgeLabel,
  MARGIN: 40, CLEAR: 24                          // canvas margin; clearance a curve keeps from a table it passes
};

const erGrid = (v) => Math.ceil(v / ER.GRID) * ER.GRID;
const erTextW = (t, cw) => Math.ceil(String(t == null ? '' : t).length * cw);
const erName = (e) => (e.name !== undefined && e.name !== null ? e.name : e.id);

// Which columns a table shows at the current detail: { cols: [{col, index}], more: N }
function erVisibleColumns(entity, data) {
  const all = entity.columns || [];
  if (entity.collapsed === true || data.detail === 'names') return { cols: [], more: 0 };
  if (data.detail === 'keys') {
    const cols = [];
    all.forEach((col, index) => { if (col.pk || col.fk) cols.push({ col, index }); });
    return { cols, more: all.length - cols.length };
  }
  return { cols: all.map((col, index) => ({ col, index })), more: 0 };
}

// On-screen size of a table: { w, h }
function erEntitySize(entity, data) {
  const vis = erVisibleColumns(entity, data);
  const showTypes = data.showTypes !== false;
  let nameW = 0, typeW = 0, noteRowW = 0;
  vis.cols.forEach(({ col }) => {
    const nw = erTextW(col.name, ER.CHAR_W);
    const tw = Math.ceil((String(col.type == null ? '' : col.type).length + (col.nullable ? 2 : 0)) * ER.TYPE_CHAR_W);
    nameW = Math.max(nameW, nw);
    typeW = Math.max(typeW, tw);
    if (col.note) noteRowW = Math.max(noteRowW, ER.PAD_X + ER.GLYPH_W + nw + erTextW(col.note, ER.TYPE_CHAR_W) + 16 + (showTypes ? ER.TYPE_GAP + tw : 0) + ER.PAD_X);
  });
  const rows = vis.cols.length
    ? Math.max(noteRowW, ER.PAD_X + ER.GLYPH_W + nameW + (showTypes ? ER.TYPE_GAP + typeW : 0) + ER.PAD_X) : 0;
  const head = erTextW(erName(entity), ER.TITLE_CHAR_W) + 2 * ER.PAD_X + 24;
  const w = erGrid(Math.min(ER.MAX_W, Math.max(ER.MIN_W, head, rows)));
  return { w, h: ER.HEAD_H + vis.cols.length * ER.ROW_H + (vis.more ? ER.MORE_H : 0) };
}

// The two ends of a relationship with the defaults applied
function erRelEnds(rel, data) {
  let toEnd = rel.toEnd;
  if (!toEnd) {
    toEnd = 'one';
    const from = (data.entities || []).find((e) => e.id === rel.from);
    const names = Array.isArray(rel.columns) ? rel.columns : [];
    if (from && names.length && names.every((n) => (from.columns || []).some((c) => c.name === n && c.nullable === true))) toEnd = 'zeroOrOne';
  }
  return { fromEnd: rel.fromEnd || 'zeroOrMany', toEnd };
}

function erClearDerived(data) {
  (data.entities || []).forEach((e) => { delete e.box; });
  (data.relationships || []).forEach((r) => { delete r.curve; delete r.points; delete r.labelBox; });
  delete data.canvas;
}

// Undirected neighbour lists over the relationships (self-references and unknown ids ignored)
function erGraph(data) {
  const ents = data.entities || [];
  const idx = {};
  ents.forEach((e, i) => { idx[e.id] = i; });
  const adj = ents.map(() => []);
  (data.relationships || []).forEach((r) => {
    const a = idx[r.from], b = idx[r.to];
    if (a === undefined || b === undefined || a === b) return;
    if (!adj[a].includes(b)) adj[a].push(b);
    if (!adj[b].includes(a)) adj[b].push(a);
  });
  return { idx, adj };
}

// Shortest-path distances (Floyd-Warshall) with each edge's length from the two tables' sizes and their colours
function erDistances(data, adj, sizes) {
  const ents = data.entities || [], n = ents.length;
  const D = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)));
  for (let a = 0; a < n; a++) {
    adj[a].forEach((b) => {
      const g = erNeed ? erNeed[a * n + b] : 0;     // the room the line needs counts as the gap
      let d = ((sizes[a].w + sizes[b].w) / 2 + Math.max(ER.GAP_X, g) + (sizes[a].h + sizes[b].h) / 2 + Math.max(ER.GAP_Y, g)) / 2;
      if (ents[a].color && ents[a].color === ents[b].color) d *= ER.SAME_COLOR;
      D[a][b] = d;
    });
  }
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (D[i][k] + D[k][j] < D[i][j]) D[i][j] = D[i][k] + D[k][j];
  }
  return D;
}

// The room each related pair of tables needs between them, set by layoutDiagram: erNeed[a * erNeedN + b] is 0 for an
// unrelated pair, else the clear space the line between them needs on the axis it runs along.
let erNeed = null, erNeedN = 0, erRel = null;   // erRel[a]: the tables related to a
function erNeedOf(data, sizes) {
  const ents = data.entities || [], n = ents.length, idx = {};
  ents.forEach((e, i) => { idx[e.id] = i; });
  const need = new Float64Array(n * n);
  (data.relationships || []).forEach((r) => {
    const a = idx[r.from], b = idx[r.to];
    if (a === undefined || b === undefined || a === b) return;
    const g = Math.max(ER.REL_GAP, r.label ? erTextW(r.label, ER.LABEL_CHAR_W) + 2 * ER.LABEL_X + ER.REL_LABEL_GAP : 0);
    need[a * n + b] = need[b * n + a] = Math.max(need[a * n + b], g);
  });
  return need;
}

// How much short of its need a related pair is on each axis: the line leaves on the side that faces the other table (as
// in erRouteAll), so only the axes the two ends face along count. Sets erShort to [x, y] and returns true when the pair
// is short on either (erShort is shared, not allocated, because the overlap removal calls this in its inner loop).
const erShort = [0, 0];
function erRelShort(dx, dy, sa, sb, need) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  const fa = ax / sa.w >= ay / sa.h, fb = ax / sb.w >= ay / sb.h;      // true: the end faces along x
  const sx = fa || fb ? need - (ax - (sa.w + sb.w) / 2) : 0, sy = !fa || !fb ? need - (ay - (sa.h + sb.h) / 2) : 0;
  erShort[0] = sx > 0 ? sx : 0; erShort[1] = sy > 0 ? sy : 0;
  return sx > 0 || sy > 0;
}

// Clash test: does table i (at centre P) overlap another table in ids, with the clearance gaps
function erClashes(i, ids, P, sizes) {
  return ids.some((j) => j !== i &&
    ((Math.abs(P.x[i] - P.x[j]) < (sizes[i].w + sizes[j].w) / 2 + ER.GAP_X &&
    Math.abs(P.y[i] - P.y[j]) < (sizes[i].h + sizes[j].h) / 2 + ER.GAP_Y) ||
    (erNeed && erNeed[i * erNeedN + j] > 0 && erRelShort(P.x[j] - P.x[i], P.y[j] - P.y[i], sizes[i], sizes[j], erNeed[i * erNeedN + j]))));
}

// Stress majorization (SMACOF): pulls each table toward its shortest-path distance from every other table
function erStress(ids, D, P, iters, hubs, pull) {
  for (let it = 0; it < iters; it++) {
    let cx = 0, cy = 0;
    ids.forEach((i) => { cx += P.x[i]; cy += P.y[i]; });
    cx /= ids.length; cy /= ids.length;
    ids.forEach((i) => {
      let nx = 0, ny = 0, den = 0;
      ids.forEach((j) => {
        const d = D[i][j];
        if (j === i || !(d < Infinity)) return;
        const w = 1 / (d * d);
        const dx = P.x[i] - P.x[j], dy = P.y[i] - P.y[j];
        const len = Math.hypot(dx, dy) || 1;
        nx += w * (P.x[j] + d * dx / len); ny += w * (P.y[j] + d * dy / len); den += w;
      });
      if (hubs.includes(i)) { nx += pull * cx; ny += pull * cy; den += pull; }
      if (den > 0) { P.x[i] = nx / den; P.y[i] = ny / den; }
    });
  }
}

// Edge-node repulsion: a table near the straight line of an edge it is not part of is pushed off it, so the curves pass
// beside tables rather than through them
function erForce(ids, edges, P, sizes, iters) {
  for (let it = 0; it < iters; it++) {
    ids.forEach((k) => edges.forEach(([a, b]) => {
      if (a === k || b === k) return;
      const vx = P.x[b] - P.x[a], vy = P.y[b] - P.y[a], L2 = vx * vx + vy * vy;
      if (L2 === 0) return;
      const t = ((P.x[k] - P.x[a]) * vx + (P.y[k] - P.y[a]) * vy) / L2;
      if (t < 0.05 || t > 0.95) return;
      const L = Math.sqrt(L2), nx = -vy / L, ny = vx / L;
      const s = (P.x[k] - (P.x[a] + t * vx)) * nx + (P.y[k] - (P.y[a] + t * vy)) * ny;
      const reach = sizes[k].w / 2 * Math.abs(nx) + sizes[k].h / 2 * Math.abs(ny) + ER.CLEAR;
      if (Math.abs(s) >= reach) return;
      const sign = s >= 0 ? 1 : -1, push = (reach - Math.abs(s)) * 0.5;
      P.x[k] += sign * nx * push; P.y[k] += sign * ny * push;
    }));
  }
}

// Rectangle-aware overlap removal: a pair that is closer than the gaps on both axes is pushed apart along the axis
// where it overlaps less. With only (table ids), the tables not in it start clear of each other, so a pair is looked at
// only once one of its tables is in only or has been moved: the same result as the full pass, in less time.
// Math.sin, cos and pow may differ in the last bit between JavaScript engines (Node and the browser), and the layout
// search amplifies that, so their results are rounded to keep the layout identical everywhere.
const erFix = (v) => Math.round(v * 1e6) / 1e6;

function erSeparate(ids, P, sizes, limit, only) {
  const n = ids.length, X = P.x, Y = P.y, lim = limit || 200, NE = erNeed, NN = erNeedN;
  const W = Float64Array.from(ids, (i) => sizes[i].w), H = Float64Array.from(ids, (i) => sizes[i].h);
  const act = ids.map((i) => !only || only.includes(i)), list = [];   // list: positions of the active tables, ascending
  act.forEach((on, p) => { if (on) list.push(p); });
  const wake = (k) => { if (act[k]) return; act[k] = true; let t = list.length; while (t > 0 && list[t - 1] > k) t--; list.splice(t, 0, k); };
  let big = false;
  const mv = new Uint8Array(n);                      // moved in this pass
  const dsp = new Float64Array(n);
  const shift = (p, q, d) => { dsp[p] += d; dsp[q] += d; if (dsp[p] > SLACK / 2 || dsp[q] > SLACK / 2) big = true; };
  // Pushes the pair (p, q) apart when it overlaps; true when it moved
  const pair = (p, q) => {
    const a = ids[p], b = ids[q];
    const dx = X[b] - X[a];
    const need = NE ? NE[a * NN + b] : 0;
    if (need > 0) {                                  // related tables: room for the line on the axis it runs along
      const dy = Y[b] - Y[a];
      if (erRelShort(dx, dy, sizes[a], sizes[b], need)) {
        const sx = dx >= 0 ? 1 : -1, sy = dy >= 0 ? 1 : -1;
        X[a] -= sx * erShort[0] / 2; X[b] += sx * erShort[0] / 2; Y[a] -= sy * erShort[1] / 2; Y[b] += sy * erShort[1] / 2;
        shift(p, q, (erShort[0] + erShort[1]) / 2);
        wake(p); wake(q); mv[p] = mv[q] = 1;
        return true;
      }
    }
    const oy0 = (H[p] + H[q]) / 2 + ER.GAP_Y - Math.abs(Y[b] - Y[a]);
    if (oy0 <= 0) return false;                      // cheap reject first: the pair is clear vertically
    const ox = (W[p] + W[q]) / 2 + ER.GAP_X - Math.abs(dx);
    if (ox <= 0) return false;
    if (ox < oy0) {
      const s = dx >= 0 ? 1 : -1;
      X[a] -= s * ox / 2; X[b] += s * ox / 2;
      shift(p, q, ox / 2);
    } else {
      const dy = Y[b] - Y[a], s = dy >= 0 ? 1 : -1;
      Y[a] -= s * oy0 / 2; Y[b] += s * oy0 / 2;
      shift(p, q, oy0 / 2);
    }
    wake(p); wake(q); mv[p] = mv[q] = 1;
    return true;
  };
  // Candidates: a sweep over x lists, for each table, the later tables that can reach it. A table moves, so the lists are
  // padded by SLACK; once the moves of one table since the last sweep add up to half of that (big), the sweep is done
  // again from the current positions. So every pair that can act is looked at, as in the full scan, in the same order.
  const SLACK = 64, wMax = W.reduce((m, w) => Math.max(m, w), 0);
  let pos = null;                                    // position of each table id in ids, built when the first sweep needs it
  let order = null, cand = null;
  const sweep = () => {
    big = false; dsp.fill(0);
    if (!order) { order = Array.from({ length: n }, (_, p) => p); cand = Array.from({ length: n }, () => []); }
    if (!pos) { pos = new Int32Array(NN || 1).fill(-1); ids.forEach((id, p) => { pos[id] = p; }); }
    for (let p = 0; p < n; p++) { const c = cand[p]; c.length = 0; if (NE) for (const b of erRel[ids[p]]) if (pos[b] > p) c.push(pos[b]); }
    for (let t = 1; t < n; t++) {                    // insertion sort by x: the order is nearly sorted already
      const u = order[t], xu = X[ids[u]];
      let k = t;
      while (k > 0 && X[ids[order[k - 1]]] > xu) { order[k] = order[k - 1]; k--; }
      order[k] = u;
    }
    for (let t = 0; t < n; t++) {
      const u = order[t], reach = (W[u] + wMax) / 2 + ER.GAP_X + SLACK;
      for (let s = t + 1; s < n && X[ids[order[s]]] - X[ids[u]] < reach; s++) {
        const v = order[s], lo = u < v ? u : v, hi = u < v ? v : u;
        if (Math.abs(X[ids[v]] - X[ids[u]]) < (W[u] + W[v]) / 2 + ER.GAP_X + SLACK && Math.abs(Y[ids[v]] - Y[ids[u]]) < (H[u] + H[v]) / 2 + ER.GAP_Y + SLACK) cand[lo].push(hi);
      }
    }
    for (let p = 0; p < n; p++) cand[p].sort((u, v) => u - v);
  };
  big = true;
  let swept = false, plain = 0;
  const PLAIN = 12;
  let moved = false;
  const scan = (p, q) => {                           // pair (p, q) for every q from q on that can touch p
    if (big && !swept && plain++ < PLAIN) { for (; q < n; q++) if (pair(p, q)) moved = true; return; }   // a few scans are cheaper than a sweep
    swept = true;
    for (let k = 0; ; ) {
      if (big) { sweep(); k = 0; }
      const cl = cand[p];
      while (k < cl.length && cl[k] < q) k++;
      if (k >= cl.length) return;
      q = cl[k++];
      if (pair(p, q)) moved = true;
      q++;
    }
  };
  for (let pass = 0; pass < lim; pass++) {
    moved = false;
    for (let p = 0; p < n; p++) {
      let q = p + 1;
      if (!act[p]) {                                 // until p moves, only an active table after it can overlap it
        if (!(p < list[list.length - 1])) break;     // none is active after p, and none can wake: the rest of the pass is clear
        for (let t = 0; t < list.length && !act[p]; t++) {
          const v = list[t];
          if (v > p && pair(p, v)) { moved = true; q = v + 1; }
        }
        if (!act[p]) continue;
      }
      scan(p, q);
    }
    if (!moved) return true;
    // next pass: only a table that moved in this one can have a new overlap, the others are clear of each other
    const next = list.filter((p) => mv[p] === 1);
    list.forEach((p) => { act[p] = false; mv[p] = 0; });
    list.length = 0;
    next.forEach((p) => { act[p] = true; list.push(p); });
  }
  return false;
}

// Does any pair of the tables in ids lie closer than the gaps on both axes?
function erOverlaps(ids, P, sizes) {
  return ids.some((a, p) => ids.some((b, q) => q > p &&
    ((Math.abs(P.x[b] - P.x[a]) < (sizes[a].w + sizes[b].w) / 2 + ER.GAP_X && Math.abs(P.y[b] - P.y[a]) < (sizes[a].h + sizes[b].h) / 2 + ER.GAP_Y) ||
    (erNeed && erNeed[a * erNeedN + b] > 0 && erRelShort(P.x[b] - P.x[a], P.y[b] - P.y[a], sizes[a], sizes[b], erNeed[a * erNeedN + b])))));
}

// Bounding box of the tables in ids: { x0, y0, x1, y1 } (centres ± half sizes)
function erBounds(ids, P, sizes) {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  ids.forEach((i) => {
    b.x0 = Math.min(b.x0, P.x[i] - sizes[i].w / 2); b.x1 = Math.max(b.x1, P.x[i] + sizes[i].w / 2);
    b.y0 = Math.min(b.y0, P.y[i] - sizes[i].h / 2); b.y1 = Math.max(b.y1, P.y[i] + sizes[i].h / 2);
  });
  return b;
}

// Scales the axes toward the target aspect (wider than tall). Scaling about the centre only adds clearance, so it
// creates no overlap.
function erShape(ids, P, sizes) {
  const b = erBounds(ids, P, sizes);
  const W = b.x1 - b.x0, H = b.y1 - b.y0;
  if (W <= 0 || H <= 0) return;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  let sx = 1, sy = 1;
  if (W / H < ER.ASPECT_LO || W / H > ER.ASPECT_HI) { const r = ER.ASPECT_T * H / W; sx = erFix(Math.pow(r, ER.SHAPE_X)); sy = erFix(Math.pow(r, ER.SHAPE_X - 1)); }
  ids.forEach((i) => { P.x[i] = cx + (P.x[i] - cx) * sx; P.y[i] = cy + (P.y[i] - cy) * sy; });
}

// Compaction: slides each table toward the centre of the component, the outermost first, in 8 px steps along x and then y,
// for as long as it clears every other table (the gaps stay)
function erCompact(ids, P, sizes, passes) {
  for (let p = 0; p < passes; p++) {
    const bnd = erBounds(ids, P, sizes), cx = (bnd.x0 + bnd.x1) / 2, cy = (bnd.y0 + bnd.y1) / 2;
    let moved = false;
    ids.slice().sort((a, b) => Math.hypot(P.x[b] - cx, P.y[b] - cy) - Math.hypot(P.x[a] - cx, P.y[a] - cy) || a - b).forEach((i) => {
      [['x', cx], ['y', cy]].forEach(([ax, c]) => {
        for (let k = 0; k < 60; k++) {
          const dir = c > P[ax][i] ? 1 : -1;
          if (Math.abs(c - P[ax][i]) < 8) break;
          const o = P[ax][i];
          P[ax][i] += dir * 8;
          if (erClashes(i, ids, P, sizes)) { P[ax][i] = o; break; }
          moved = true;
        }
      });
    });
    if (!moved) return;
  }
}

// Places one connected component. variant 1 starts the rings in the opposite angular order (another candidate shape).
function erLayoutComponent(ids, D, adj, P, sizes, variant, warm) {
  const hubs = ids.slice().sort((a, b) => adj[b].length - adj[a].length || a - b).slice(0, 3);
  const pull = ER.HUB_PULL[(variant >> 1) % ER.HUB_PULL.length];
  const edges = [];
  ids.forEach((a) => adj[a].forEach((b) => { if (a < b) edges.push([a, b]); }));
  if (!warm) {
    // Seed: the most connected table at the centre, the others on rings by hop count, id order within a ring
    const hub = ids.reduce((best, i) => (adj[i].length > adj[best].length ? i : best), ids[0]);
    const hops = { [hub]: 0 }, queue = [hub];
    for (let q = 0; q < queue.length; q++) adj[queue[q]].forEach((j) => { if (!(j in hops)) { hops[j] = hops[queue[q]] + 1; queue.push(j); } });
    const ring = {};
    ids.forEach((i) => { (ring[hops[i]] = ring[hops[i]] || []).push(i); });
    const near = ids.filter((j) => j !== hub && D[hub][j] < Infinity);
    const step = near.length ? near.reduce((sum, j) => sum + D[hub][j], 0) / near.length : ER.GAP_X;
    Object.keys(ring).map(Number).sort((a, b) => a - b).forEach((k) => {
      const members = ring[k].sort((a, b) => a - b);
      members.forEach((i, pos) => {
        const ang = (variant % 2 ? -1 : 1) * (2 * Math.PI * pos) / members.length + k * 0.3 + variant * 0.7;
        P.x[i] = k * step * erFix(Math.cos(ang)); P.y[i] = k * step * erFix(Math.sin(ang));
      });
    });
    erStress(ids, D, P, ER.STRESS_IT, hubs, pull);
    erForce(ids, edges, P, sizes, ER.FORCE_IT);
  } else {                                          // warm: keep the saved shape, only make room
    erForce(ids, edges, P, sizes, ER.WARM_FORCE_IT);
    erSeparate(ids, P, sizes);
    return;
  }
  erSeparate(ids, P, sizes);
  for (let round = 0; round < 3; round++) {         // widen toward the target aspect, clear overlaps, slide back in
    erShape(ids, P, sizes);
    erSeparate(ids, P, sizes);
    erCompact(ids, P, sizes, 12);
  }
  erForce(ids, edges, P, sizes, ER.FORCE_IT);
  erSeparate(ids, P, sizes);
}

// Places every component (the largest first, shelf-packed, each normalised to the origin), then the isolated tables in
// a row beneath. Returns the centres in P.
function erPlaceAll(adj, D, sizes, variant, warm, P) {
  const n = adj.length;
  const seen = new Array(n).fill(false), comps = [];
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    const ids = [s]; seen[s] = true;
    for (let q = 0; q < ids.length; q++) adj[ids[q]].forEach((j) => { if (!seen[j]) { seen[j] = true; ids.push(j); } });
    comps.push(ids.sort((a, b) => a - b));
  }
  const groups = comps.filter((c) => c.length > 1).sort((a, b) => b.length - a.length || a[0] - b[0]);
  const isolated = comps.filter((c) => c.length === 1).map((c) => c[0]);
  let total = 0;
  groups.forEach((ids) => {
    erLayoutComponent(ids, D, adj, P, sizes, variant, warm);
    const b = erBounds(ids, P, sizes);
    total += (b.x1 - b.x0) * (b.y1 - b.y0);
  });
  isolated.forEach((i) => { total += sizes[i].w * sizes[i].h; });
  const rowW = Math.max(groups.reduce((m, ids) => {
    const b = erBounds(ids, P, sizes); return Math.max(m, b.x1 - b.x0);
  }, 0), Math.sqrt(total) * ER.ASPECT_T, sizes.reduce((m, s) => Math.max(m, s.w), 0));
  let x = 0, y = 0, rowH = 0;
  groups.forEach((ids) => {
    const b = erBounds(ids, P, sizes), w = b.x1 - b.x0, h = b.y1 - b.y0;
    if (x > 0 && x + w > rowW) { x = 0; y += rowH + ER.GAP_Y; rowH = 0; }
    ids.forEach((i) => { P.x[i] += x - b.x0; P.y[i] += y - b.y0; });
    x += w + ER.GAP_X; rowH = Math.max(rowH, h);
  });
  if (groups.length && isolated.length) { y += rowH + ER.GAP_Y * 2; x = 0; rowH = 0; }
  isolated.forEach((i) => {
    if (x > 0 && x + sizes[i].w > rowW) { x = 0; y += rowH + ER.GAP_Y; rowH = 0; }
    P.x[i] = x + sizes[i].w / 2; P.y[i] = y + sizes[i].h / 2;
    x += sizes[i].w + ER.GAP_X; rowH = Math.max(rowH, sizes[i].h);
  });
  // components are placed with their own overlap removal; one pass over all tables catches any touching edges
  erSeparate(Array.from({ length: n }, (_, i) => i), P, sizes);
}

// Does the sampled curve (flat x,y list) pass through the open rectangle (x0, y0, x1, y1)? Liang-Barsky clip per segment
function erPolyHits(f, x0, y0, x1, y1) {
  for (let k = 2; k < f.length; k += 2) {
    const ax = f[k - 2], ay = f[k - 1], dx = f[k] - ax, dy = f[k + 1] - ay;
    let t0 = 0, t1 = 1, ok = true;
    for (let e = 0; e < 4 && ok; e++) {
      const pp = e === 0 ? -dx : e === 1 ? dx : e === 2 ? -dy : dy;
      const qq = e === 0 ? ax - x0 : e === 1 ? x1 - ax : e === 2 ? ay - y0 : y1 - ay;
      if (pp === 0) { if (qq <= 0) ok = false; continue; }
      const r = qq / pp;
      if (pp < 0) { if (r > t1) ok = false; else if (r > t0) t0 = r; } else if (r < t0) ok = false; else if (r < t1) t1 = r;
    }
    if (ok && t1 - t0 > 1e-9) return true;
  }
  return false;
}

// Routes every relationship from the table boxes: sets curve, points, labelBox; returns the score data (quick: score
// only, nothing written to the relationships). With quick, base is the state (.st) of an earlier quick result for the same
// data: curves whose control points are unchanged keep their samples, and a crossing or hit is only recounted for a pair
// where a curve or the table changed. The totals equal a full count exactly.
function erRouteAll(data, boxes, quick, base, useAlt) {
  const alt = useAlt !== undefined ? useAlt : !quick;
  const ents = data.entities || [], rels = data.relationships || [], n = boxes.length;
  const idx = {};
  ents.forEach((e, i) => { idx[e.id] = i; });
  const cx = boxes.map((b) => b.x + b.w / 2), cy = boxes.map((b) => b.y + b.h / 2);
  const live = [];                                   // relationships with both ends present
  rels.forEach((r, ri) => {
    const a = idx[r.from], b = idx[r.to];
    if (a === undefined || b === undefined) { if (!quick) { delete r.curve; delete r.points; delete r.labelBox; } return; }
    live.push({ r, ri, a, b, self: a === b, sa: 0, sb: 0, alt: false, k1: 0, k2: 0, p0: null, p3: null });
  });
  // Sides: 0 right, 1 left, 2 bottom, 3 top. A line leaves on the side that faces the other table (the centre-to-centre
  // direction against the table's proportions); lines on one side spread evenly along it, ordered by where the other end
  // lies, so they do not cross at the table.
  const facing = (A, B) => {
    const dx = cx[B] - cx[A], dy = cy[B] - cy[A];
    if (Math.abs(dx) / boxes[A].w >= Math.abs(dy) / boxes[A].h) return dx >= 0 ? 0 : 1;
    return dy >= 0 ? 2 : 3;
  };
  const old = quick && base && base.live.length === live.length ? base : null;
  const moved = old ? boxes.map((b, j) => { const o = old.boxes[j]; return o.x !== b.x || o.y !== b.y || o.w !== b.w || o.h !== b.h; }) : null;
  const m = ER.CLEAR / 2;
  const hx0 = Float64Array.from(boxes, (b) => b.x - m), hy0 = Float64Array.from(boxes, (b) => b.y - m);   // the boxes grown by m
  const hx1 = Float64Array.from(boxes, (b) => b.x + b.w + m), hy1 = Float64Array.from(boxes, (b) => b.y + b.h + m);
  const movedIds = moved ? moved.reduce((acc, v, j) => { if (v) acc.push(j); return acc; }, []) : [];
  const oldHitLines = old ? new Set(old.hs.map((pr) => pr[0])) : null;
  // A cached curve stays valid only if neither endpoint moved, it had no hits or alt route, and no moved table entered its bbox
  const reuse = (L, li) => {
    if (!old) return false;
    const B0 = old.live[li];
    if (B0.alt || oldHitLines.has(li) || moved[L.a] || moved[L.b]) return false;
    const bb = B0.bb;
    for (let u = 0; u < movedIds.length; u++) {
      const j = movedIds[u];
      if (j === L.a || j === L.b) continue;
      if (!(bb[2] <= hx0[j] || bb[0] >= hx1[j] || bb[3] <= hy0[j] || bb[1] >= hy1[j])) return false;
    }
    return true;
  };
  const NX = [1, -1, 0, 0], NY = [0, 0, 1, -1];
  const SEG = ER.SEG, R = (v) => Math.round(v * 10) / 10;
  const sampleC = (c) => {
    const f = new Float64Array(2 * (SEG + 1));
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG, u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
      f[2 * s] = w0 * c[0][0] + w1 * c[1][0] + w2 * c[2][0] + w3 * c[3][0];
      f[2 * s + 1] = w0 * c[0][1] + w1 * c[1][1] + w2 * c[2][1] + w3 * c[3][1];
    }
    for (let q = 0; q < f.length; q++) f[q] = R(f[q]);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let q = 0; q < f.length; q += 2) { x0 = Math.min(x0, f[q]); x1 = Math.max(x1, f[q]); y0 = Math.min(y0, f[q + 1]); y1 = Math.max(y1, f[q + 1]); }
    return { f, bb: [x0, y0, x1, y1] };
  };
  const hitsOf = (f, bb, a, b) => {
    let cnt = 0;
    for (let j = 0; j < n; j++) {
      if (j === a || j === b) continue;
      if (bb[2] <= hx0[j] || bb[0] >= hx1[j] || bb[3] <= hy0[j] || bb[1] >= hy1[j]) continue;
      if (erPolyHits(f, hx0[j], hy0[j], hx1[j], hy1[j])) cnt++;
    }
    return cnt;
  };
  const sidePt = (i, side, off = 0) => {
    const b = boxes[i];
    if (side === 0) return [b.x + b.w, cy[i] + off];
    if (side === 1) return [b.x, cy[i] + off];
    if (side === 2) return [cx[i] + off, b.y + b.h];
    return [cx[i] + off, b.y];
  };
  const setFromSlots = (list, keepOld) => {
    const slots = new Array(n * 4);
    list.forEach((L, li) => {
      if (L.self) return;
      (slots[L.a * 4 + L.sa] = slots[L.a * 4 + L.sa] || []).push({ end: li * 2, other: L.b });
      (slots[L.b * 4 + L.sb] = slots[L.b * 4 + L.sb] || []).push({ end: li * 2 + 1, other: L.a });
    });
    const port = new Array(list.length * 2), ends = new Array(n * 4);
    slots.forEach((slot, k) => {
      if (!slot) return;
      const i = k >> 2, side = k & 3, b = boxes[i], horiz = side < 2;
      ends[k] = slot.map((p) => p.end);
      const was = keepOld && old && old.ends[k];
      if (was && !moved[i] && was.length === slot.length && slot.every((p, q) => p.end === was[q] && !moved[p.other])) {
        slot.forEach((p) => { port[p.end] = old.port[p.end]; });
        return;
      }
      slot.sort((p, q) => (horiz ? cy[p.other] - cy[q.other] : cx[p.other] - cx[q.other]) || p.end - q.end);
      const sz = slot.length, span = horiz ? b.h : b.w;
      const spacing = sz > 1 ? Math.min(ER.PORT_GAP, (span - 2 * ER.PORT_MARGIN) / (sz - 1)) : 0;
      slot.forEach((p, q) => { port[p.end] = sidePt(i, side, (q - (sz - 1) / 2) * spacing); });
    });
    return { port, ends };
  };
  const buildCurve = (L, port) => {
    if (L.self) {
      const A = boxes[L.a], p0 = [A.x + A.w, cy[L.a]], p3 = [cx[L.a], A.y];
      return [p0, [p0[0] + ER.SELF_CTRL, p0[1]], [p3[0], p3[1] - ER.SELF_CTRL], p3];
    }
    const p0 = port[L.li * 2], p3 = port[L.li * 2 + 1];
    const kDef = Math.min(ER.CTRL_MAX, Math.max(ER.CTRL_MIN, Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) / ER.CTRL_DIV));
    const k1 = L.alt ? L.k1 : kDef, k2 = L.alt ? L.k2 : kDef;
    return [p0, [p0[0] + NX[L.sa] * k1, p0[1] + NY[L.sa] * k1], [p3[0] + NX[L.sb] * k2, p3[1] + NY[L.sb] * k2], p3];
  };
  live.forEach((L, li) => {
    L.li = li;
    if (L.self) return;
    if (reuse(L, li)) { L.sa = old.live[li].sa; L.sb = old.live[li].sb; }
    else { L.sa = facing(L.a, L.b); L.sb = facing(L.b, L.a); }
  });
  let { port, ends } = setFromSlots(live, true);
  // Precompute default curves first so alternate routing can also avoid crossings against other lines
  const crossOf = (f, bb, selfIdx, list) => {
    const orient = (ax, ay, bx, by, px, py) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    let cnt = 0;
    for (let b = 0; b < list.length; b++) {
      if (b === selfIdx || !list[b].f) continue;
      const B = list[b].f, ob = list[b].bb;
      if (bb[2] < ob[0] || ob[2] < bb[0] || bb[3] < ob[1] || ob[3] < bb[1]) continue;
      let hit = false;
      for (let i = 2; i < f.length && !hit; i += 2) {
        const px = f[i - 2], py = f[i - 1], qx = f[i], qy = f[i + 1];
        if (Math.max(px, qx) < ob[0] || Math.min(px, qx) > ob[2] || Math.max(py, qy) < ob[1] || Math.min(py, qy) > ob[3]) continue;
        for (let j = 2; j < B.length; j += 2) {
          const rx = B[j - 2], ry = B[j - 1], sx = B[j], sy = B[j + 1];
          if ((px === rx && py === ry) || (px === sx && py === sy) || (qx === rx && qy === ry) || (qx === sx && qy === sy)) continue;
          const d1 = orient(px, py, qx, qy, rx, ry), d2 = orient(px, py, qx, qy, sx, sy);
          if (!((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))) continue;
          const d3 = orient(rx, ry, sx, sy, px, py), d4 = orient(rx, ry, sx, sy, qx, qy);
          if ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)) { hit = true; break; }
        }
      }
      if (hit) cnt++;
    }
    return cnt;
  };
  // Find clean (sa, sb, k1, k2) for a curve that hits an unrelated table, minimizing hits, short rel-gaps, crossings, side detour, and length
  const findClearRoute = (L, curP0, curP3, useExactPorts, tryEdgeOffsets) => {
    const sa0 = facing(L.a, L.b), sb0 = facing(L.b, L.a);
    const dx = cx[L.b] - cx[L.a], dy = cy[L.b] - cy[L.a];
    const sxA = dx >= 0 ? 0 : 1, syA = dy >= 0 ? 2 : 3, sxB = dx >= 0 ? 1 : 0, syB = dy >= 0 ? 3 : 2;
    const A = boxes[L.a], B = boxes[L.b];
    const gapX = B.x >= A.x ? B.x - (A.x + A.w) : A.x - (B.x + B.w);
    const gapY = B.y >= A.y ? B.y - (A.y + A.h) : A.y - (B.y + B.h);
    const need = erNeed && erNeedN === n ? erNeed[L.a * n + L.b] : 0;
    const pairs = [];
    for (let sa = 0; sa < 4; sa++) for (let sb = 0; sb < 4; sb++) {
      const pen = (sa === sa0 ? 0 : sa === sxA || sa === syA ? 1 : 2.5) + (sb === sb0 ? 0 : sb === sxB || sb === syB ? 1 : 2.5);
      const shortGap = need > 0 && ((sa < 2 ? gapX : gapY) < need) ? 1 : 0;
      pairs.push({ sa, sb, pen, shortGap });
    }
    pairs.sort((u, v) => u.shortGap - v.shortGap || u.pen - v.pen || u.sa - v.sa || u.sb - v.sb);
    let best = null;
    const offsets = tryEdgeOffsets ? [0, -0.35, 0.35] : [0];
    for (const { sa, sb, pen, shortGap } of pairs) {
      if (best && best.hits === 0 && best.shortGap === 0 && (shortGap > best.shortGap || (best.cross === 0 && pen > best.pen + 1.5))) continue;
      for (const fa of offsets) for (const fb of offsets) {
        if (fa !== 0 && fb !== 0) continue;
        const p0 = (useExactPorts && sa === L.sa && fa === 0) ? curP0 : sidePt(L.a, sa, fa * Math.max(0, (sa < 2 ? A.h : A.w) / 2 - ER.PORT_MARGIN));
        const p3 = (useExactPorts && sb === L.sb && fb === 0) ? curP3 : sidePt(L.b, sb, fb * Math.max(0, (sb < 2 ? B.h : B.w) / 2 - ER.PORT_MARGIN));
        const dist = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
        const kDef = Math.min(ER.CTRL_MAX, Math.max(ER.CTRL_MIN, dist / ER.CTRL_DIV));
        const ks = [];
        if (sa === sb) {
          const horiz = sa < 2, base = horiz ? (sa === 0 ? Math.max(p0[0], p3[0]) : Math.min(p0[0], p3[0])) : (sa === 2 ? Math.max(p0[1], p3[1]) : Math.min(p0[1], p3[1]));
          const dir = sa === 0 || sa === 2 ? 1 : -1;
          [60, 110, 170, 240, 330, 460, 640].forEach((d) => {
            const out = base + dir * d;
            ks.push([Math.abs(out - (horiz ? p0[0] : p0[1])), Math.abs(out - (horiz ? p3[0] : p3[1]))]);
          });
        } else if ((sa < 2) !== (sb < 2)) {
          const hx = Math.abs(p3[0] - p0[0]), vy = Math.abs(p3[1] - p0[1]);
          const b1 = sa < 2 ? hx : vy, b2 = sb < 2 ? hx : vy;
          const cap1 = Math.max(520, b1 * 1.15), cap2 = Math.max(520, b2 * 1.15);
          [[0.6, 0.6], [0.85, 0.45], [0.45, 0.85], [1.05, 0.25], [0.25, 1.05], [1.2, 1.2], [0.25, 0.25]].forEach(([f1, f2]) => {
            ks.push([Math.min(cap1, Math.max(40, b1 * f1)), Math.min(cap2, Math.max(40, b2 * f2))]);
          });
        } else {
          const span = sa < 2 ? Math.abs(p3[0] - p0[0]) : Math.abs(p3[1] - p0[1]);
          const big = Math.min(1200, Math.max(340, span * 0.9));
          [[kDef, kDef], [40, kDef], [kDef, 40], [40, big], [big, 40], [220, 220], [360, 360], [540, 540]].forEach((pair) => ks.push(pair));
        }
        for (const [k1, k2] of ks) {
          const c = [p0, [p0[0] + NX[sa] * k1, p0[1] + NY[sa] * k1], [p3[0] + NX[sb] * k2, p3[1] + NY[sb] * k2], p3];
          const s = sampleC(c);
          const h = hitsOf(s.f, s.bb, L.a, L.b);
          if (best && h > best.hits) continue;
          const cross = crossOf(s.f, s.bb, L.li, live);
          const edgeShift = (fa !== 0 || fb !== 0) ? 0.5 : 0;
          const len = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) + Math.hypot(c[2][0] - c[1][0], c[2][1] - c[1][1]) + Math.hypot(c[3][0] - c[2][0], c[3][1] - c[2][1]);
          const better = !best || h < best.hits || (h === best.hits && (
            shortGap < best.shortGap || (shortGap === best.shortGap && (
            cross < best.cross || (cross === best.cross && (
            (pen + edgeShift) < (best.pen + best.edgeShift) - 0.1 || (Math.abs((pen + edgeShift) - (best.pen + best.edgeShift)) <= 0.1 && len < best.len)))))));
          if (better) {
            best = { sa, sb, k1, k2, hits: h, shortGap, cross, pen, edgeShift, len, p0, p3, fa, fb };
            if (h === 0 && shortGap === 0 && cross === 0 && pen === 0 && edgeShift === 0) break;
          }
        }
        if (best && best.hits === 0 && best.shortGap === 0 && best.cross === 0 && pen === 0) break;
      }
      if (best && best.hits === 0 && best.shortGap === 0 && best.cross === 0 && pen === 0) break;
    }
    return best;
  };
  let sidesChanged = false;
  if (alt) {
    live.forEach((L) => { const s = sampleC(buildCurve(L, port)); L.f = s.f; L.bb = s.bb; });
    live.forEach((L, li) => {
      if (L.self) return;
      if (reuse(L, li)) return;
      const h0 = hitsOf(L.f, L.bb, L.a, L.b);
      if (!h0) return;
      let pick = findClearRoute(L, port[li * 2], port[li * 2 + 1], false, false);
      if (pick && (pick.hits > 0 || (!quick && pick.cross > 0))) pick = findClearRoute(L, port[li * 2], port[li * 2 + 1], false, true);
      if (pick && (pick.hits < h0 || pick.hits === 0)) {
        if (pick.sa !== L.sa || pick.sb !== L.sb) sidesChanged = true;
        L.sa = pick.sa; L.sb = pick.sb; L.alt = true; L.k1 = pick.k1; L.k2 = pick.k2;
        if (pick.fa || pick.fb) { L.fa = pick.fa; L.fb = pick.fb; }
        const s = sampleC([pick.p0, [pick.p0[0] + NX[pick.sa] * pick.k1, pick.p0[1] + NY[pick.sa] * pick.k1], [pick.p3[0] + NX[pick.sb] * pick.k2, pick.p3[1] + NY[pick.sb] * pick.k2], pick.p3]);
        L.f = s.f; L.bb = s.bb;
      }
    });
  }
  if (sidesChanged) ({ port, ends } = setFromSlots(live, false));
  live.forEach((L, li) => {
    const B0 = old && old.live[li];
    if (B0 && !sidesChanged && reuse(L, li) && (L.self ? !moved[L.a] : port[li * 2] === old.port[li * 2] && port[li * 2 + 1] === old.port[li * 2 + 1] && L.sa === B0.sa && L.sb === B0.sb)) {
      L.c = B0.c; L.f = B0.f; L.bb = B0.bb; L.seg = B0.seg; return;
    }
    if (L.fa) port[li * 2] = sidePt(L.a, L.sa, L.fa * Math.max(0, (L.sa < 2 ? boxes[L.a].h : boxes[L.a].w) / 2 - ER.PORT_MARGIN));
    if (L.fb) port[li * 2 + 1] = sidePt(L.b, L.sb, L.fb * Math.max(0, (L.sb < 2 ? boxes[L.b].h : boxes[L.b].w) / 2 - ER.PORT_MARGIN));
    let c = buildCurve(L, port), s = sampleC(c);
    // If slot spreading nudged an alt route (or newly created a grazing hit), refine (sa, sb, k1, k2) on its actual port
    if (alt && !L.self && (sidesChanged || L.alt) && hitsOf(s.f, s.bb, L.a, L.b) > 0) {
      let pick = findClearRoute(L, port[li * 2], port[li * 2 + 1], true, false);
      if (pick && (pick.hits > 0 || (!quick && pick.cross > 0))) pick = findClearRoute(L, port[li * 2], port[li * 2 + 1], true, true);
      if (pick && pick.hits < hitsOf(s.f, s.bb, L.a, L.b)) {
        L.alt = true; L.k1 = pick.k1; L.k2 = pick.k2;
        if (pick.sa === L.sa && pick.sb === L.sb) {
          if (pick.fa) port[li * 2] = pick.p0;
          if (pick.fb) port[li * 2 + 1] = pick.p3;
          c = buildCurve(L, port); s = sampleC(c);
        }
      }
    }
    L.c = c;
    if (B0 && B0.c.every((pt, q) => pt[0] === c[q][0] && pt[1] === c[q][1])) { L.f = B0.f; L.bb = B0.bb; L.seg = B0.seg; return; }
    L.dirty = true;
    L.f = s.f; L.bb = s.bb;
    L.seg = new Float64Array(SEG);
    for (let q = 2; q < s.f.length; q += 2) L.seg[q / 2 - 1] = Math.hypot(s.f[q] - s.f[q - 2], s.f[q + 1] - s.f[q - 1]);
    if (!quick) {
      L.r.curve = c.map((pt) => [R(pt[0]), R(pt[1])]);
      L.r.points = []; for (let q = 0; q < s.f.length; q += 2) L.r.points.push([s.f[q], s.f[q + 1]]);
    }
  });
  // Labels: slide along t and normal until clear of every table and placed label
  if (!quick) {
    const evalC = (c, t) => {
      const u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
      return [w0 * c[0][0] + w1 * c[1][0] + w2 * c[2][0] + w3 * c[3][0], w0 * c[0][1] + w1 * c[1][1] + w2 * c[2][1] + w3 * c[3][1]];
    };
    const placedLabels = [];
    const overlapsBox = (a, b, pad = 0) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
    const placeLabel = (L, skip) => {
      const r = L.r, c = L.c;
      const w = erTextW(r.label, ER.LABEL_CHAR_W) + 2 * ER.LABEL_X, h = ER.LABEL_H;
      let best = null;
      for (const u of [0.5, 0.42, 0.58, 0.34, 0.66, 0.25, 0.75]) {
        const mid = evalC(c, u), p1 = evalC(c, Math.min(1, u + 0.02)), p0 = evalC(c, Math.max(0, u - 0.02));
        const tx = p1[0] - p0[0], ty = p1[1] - p0[1], tl = Math.hypot(tx, ty) || 1;
        const nrm = [-ty / tl, tx / tl];
        for (const o of [0, 14, -14, 28, -28, 42, -42, 60, -60]) {
          const box = { x: mid[0] + nrm[0] * o - w / 2, y: mid[1] + nrm[1] * o - h / 2, w, h };
          let s = Math.abs(o) * 0.05 + Math.abs(u - 0.5) * 15;
          if (boxes.some((b) => overlapsBox(box, b, 0))) s += 1000;
          if (placedLabels.some((p) => p !== skip && overlapsBox(box, p.box, 2))) s += 500;
          if (!best || s < best.s) best = { box, s };
          if (s === 0) { r.labelBox = box; return 0; }
        }
      }
      r.labelBox = best.box;
      return best.s;
    };
    live.forEach((L) => {
      if (!L.r.label) return;
      const s = placeLabel(L, null);
      placedLabels.push({ L, box: L.r.labelBox, s });
    });
    // One follow-up pass for any label that collided so earlier/later labels can make room
    placedLabels.forEach((entry) => {
      if (entry.s >= 500) {
        entry.s = placeLabel(entry.L, entry);
        entry.box = entry.L.r.labelBox;
      }
    });
  }
  // Bounds of everything drawn (the caller moves the tables when some lie left of or above the margin)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  boxes.forEach((b) => { grow(b.x, b.y); grow(b.x + b.w, b.y + b.h); });
  live.forEach((L) => { grow(L.bb[0], L.bb[1]); grow(L.bb[2], L.bb[3]); if (L.r.labelBox) grow(L.r.labelBox.x, L.r.labelBox.y); });
  // Crossings: pairs of segments of different lines that properly cross (sharing an end point does not count)
  let length = 0;
  const cul = new Set();                             // tables involved in a hit or a crossing (the repair moves these)
  const orient = (ax, ay, bx, by, px, py) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const nl = live.length, xs = [], hs = [];          // the crossing pairs [a, b] and the line-over-table pairs [line, table]
  if (old) old.xs.forEach((pr) => { if (!live[pr[0]].dirty && !live[pr[1]].dirty) xs.push(pr); });
  for (let a = 0; a < nl; a++) {
    const A = live[a].f, sa = live[a].seg;
    for (let k = 0; k < sa.length; k++) length += sa[k];
    for (let b = a + 1; b < nl; b++) {
      if (old && !live[a].dirty && !live[b].dirty) continue;   // counted already, kept above
      const ba = live[a].bb, bb = live[b].bb, B = live[b].f;
      let hit = false;
      if (!(ba[2] < bb[0] || bb[2] < ba[0] || ba[3] < bb[1] || bb[3] < ba[1]))
      for (let i = 2; i < A.length && !hit; i += 2) {
        const px = A[i - 2], py = A[i - 1], qx = A[i], qy = A[i + 1];
        if (Math.max(px, qx) < bb[0] || Math.min(px, qx) > bb[2] || Math.max(py, qy) < bb[1] || Math.min(py, qy) > bb[3]) continue;
        for (let j = 2; j < B.length; j += 2) {
          const rx = B[j - 2], ry = B[j - 1], sx = B[j], sy = B[j + 1];
          if ((px === rx && py === ry) || (px === sx && py === sy) || (qx === rx && qy === ry) || (qx === sx && qy === sy)) continue;
          const d1 = orient(px, py, qx, qy, rx, ry), d2 = orient(px, py, qx, qy, sx, sy);
          if (!((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))) continue;
          const d3 = orient(rx, ry, sx, sy, px, py), d4 = orient(rx, ry, sx, sy, qx, qy);
          if ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)) { hit = true; break; }
        }
      }
      if (hit) xs.push([a, b]);
    }
  }
  xs.forEach(([a, b]) => { cul.add(live[a].a); cul.add(live[a].b); cul.add(live[b].a); cul.add(live[b].b); });
  const crossings = xs.length;
  // Hits: a line that runs through a table it is not part of
  if (old) old.hs.forEach((pr) => { if (!live[pr[0]].dirty && !moved[pr[1]]) hs.push(pr); });
  live.forEach((L, li) => {
    const bb = L.bb;
    for (let j = 0; j < n; j++) {
      if (j === L.a || j === L.b || (old && !L.dirty && !moved[j])) continue;
      if (bb[2] <= hx0[j] || bb[0] >= hx1[j] || bb[3] <= hy0[j] || bb[1] >= hy1[j]) continue;
      if (erPolyHits(L.f, hx0[j], hy0[j], hx1[j], hy1[j])) hs.push([li, j]);
    }
  });
  const hitCul = new Set();
  hs.forEach(([li, j]) => { cul.add(j); cul.add(live[li].a); cul.add(live[li].b); hitCul.add(j); hitCul.add(live[li].a); hitCul.add(live[li].b); });
  const hits = hs.length;
  const width = isFinite(x1) ? Math.round(x1 + ER.MARGIN) : 0, height = isFinite(y1) ? Math.round(y1 + ER.MARGIN) : 0;
  if (!quick) data.canvas = { width, height, crossings, length: Math.round(length), hits };
  return { hits, crossings, length, minX: x0, minY: y0, curves: live, cul: Array.from(cul).sort((p, q) => p - q), hitCul: Array.from(hitCul).sort((p, q) => p - q), st: { boxes, live, xs, hs, port, ends } };
}

// Routes with positions as they are (a table without a position is laid out first)
function erRouteFromPositions(data) {
  const ents = data.entities || [];
  const sizes = ents.map((e) => erEntitySize(e, data));
  const boxes = ents.map((e, i) => ({ x: e.x, y: e.y, w: sizes[i].w, h: sizes[i].h }));
  erRouteAll(data, boxes);
  ents.forEach((e, i) => { e.box = { x: boxes[i].x, y: boxes[i].y, w: sizes[i].w, h: sizes[i].h }; });
}

// Pushes every table that a line runs through off that line: each pass routes the curves, then moves a table out of the
// way along the axis where the line is closest to leaving it, and removes the overlaps again
function erUnhit(P, sizes, score, iters) {
  const n = sizes.length, all = sizes.map((_, i) => i), m = ER.CLEAR / 2;
  for (let it = 0; it < iters; it++) {
    const boxes = sizes.map((z, i) => ({ x: P.x[i] - z.w / 2, y: P.y[i] - z.h / 2, w: z.w, h: z.h }));
    const sc = score(boxes);
    if (!sc.hits) return;
    const mx = new Float64Array(n), my = new Float64Array(n);
    sc.curves.forEach((L) => boxes.forEach((b, j) => {
      if (j === L.a || j === L.b) return;
      if (L.bb[2] <= b.x - m || L.bb[0] >= b.x + b.w + m || L.bb[3] <= b.y - m || L.bb[1] >= b.y + b.h + m) return;
      const inside = [];
      for (let q = 0; q < L.f.length; q += 2) {
        const px = L.f[q], py = L.f[q + 1];
        if (px > b.x - m && px < b.x + b.w + m && py > b.y - m && py < b.y + b.h + m) inside.push([px, py]);
      }
      if (!inside.length) return;                    // the line only clips a corner between two samples
      if (!inside.length) return;
      // smallest shift of the table that frees every sampled point (it moves, the line stays)
      const cand = [
        [Math.max(...inside.map((p) => p[0])) - (b.x - m), 0], [-(b.x + b.w + m - Math.min(...inside.map((p) => p[0]))), 0],
        [0, Math.max(...inside.map((p) => p[1])) - (b.y - m)], [0, -(b.y + b.h + m - Math.min(...inside.map((p) => p[1])))]
      ];
      const pick = cand.reduce((u, v) => (Math.abs(v[0]) + Math.abs(v[1]) < Math.abs(u[0]) + Math.abs(u[1]) ? v : u));
      mx[j] += pick[0] * 0.6; my[j] += pick[1] * 0.6;
    }));
    for (let i = 0; i < n; i++) { P.x[i] += mx[i]; P.y[i] += my[i]; }
    erSeparate(all, P, sizes);
  }
}

// Bounding box of the boxes: { w, h, area }, the content size plus the canvas margin on every side
function erExtent(boxes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  boxes.forEach((b) => { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
  return { w: x1 - x0 + 2 * ER.MARGIN, h: y1 - y0 + 2 * ER.MARGIN };
}

// Penalty for a bounding box outside the target aspect range, and for not fitting a nominal view at FIT_MIN zoom (both x1000)
function erOffAspect(boxes) {
  const e = erExtent(boxes), a = e.w / e.h;
  return Math.round(Math.max(0, ER.ASPECT_LO - a, a - ER.ASPECT_HI + 0.05) * 1000);
}
function erOffFit(boxes) {
  const e = erExtent(boxes);
  return Math.round(Math.max(0, Math.max(e.w / ER.VIEW_W, e.h / ER.VIEW_H) - 1 / ER.FIT_MIN) * 1000);
}

// Unevenness: how far (px, summed) the tables' nearest-neighbour edge gaps exceed EVEN_K times their median, so a table
// left far from the rest costs
function erUneven(boxes) {
  const n = boxes.length;
  if (n < 3) return 0;
  const near = boxes.map((a, i) => {
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const b = boxes[j], gx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w)), gy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
      best = Math.min(best, gx * gx + gy * gy);
    }
    return Math.sqrt(best);
  });
  const sorted = near.slice().sort((p, q) => p - q), med = sorted[n >> 1];
  return Math.round(near.reduce((sum, g) => sum + Math.max(0, g - ER.EVEN_K * med), 0));
}

// Empty space: the largest rectangle of the bounding box that touches no table (each table counts GAP / 2 larger), on a
// grid of about HOLE_CELLS cells (a cell is full when its centre lies in a table), as a share of the box; the cost counts what is over HOLE_OK
// (per mille). The classic largest-rectangle-in-a-histogram scan.
function erHoles(boxes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  boxes.forEach((b) => { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
  const C = Math.max(8, Math.sqrt((x1 - x0) * (y1 - y0) / ER.HOLE_CELLS)), cols = Math.ceil((x1 - x0) / C), rows = Math.ceil((y1 - y0) / C);
  const full = new Uint8Array(cols * rows);
  boxes.forEach((b) => {
    const ca = Math.max(0, Math.ceil((b.x - ER.GAP_X / 2 - x0) / C - 0.5)), cb = Math.min(cols, Math.ceil((b.x + b.w + ER.GAP_X / 2 - x0) / C - 0.5));
    const ra = Math.max(0, Math.ceil((b.y - ER.GAP_Y / 2 - y0) / C - 0.5)), rb = Math.min(rows, Math.ceil((b.y + b.h + ER.GAP_Y / 2 - y0) / C - 0.5));
    for (let r = ra; r < rb; r++) for (let c = ca; c < cb; c++) full[r * cols + c] = 1;
  });
  const h = new Int32Array(cols), stack = new Int32Array(cols + 1);
  let best = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) h[c] = full[r * cols + c] ? 0 : h[c] + 1;
    let top = 0;
    for (let c = 0; c <= cols; c++) {
      const v = c < cols ? h[c] : 0;
      while (top > 0 && h[stack[top - 1]] >= v) {
        const height = h[stack[--top]], left = top ? stack[top - 1] + 1 : 0;
        best = Math.max(best, height * (c - left));
      }
      stack[top++] = c;
    }
  }
  return Math.round(Math.max(0, best / (cols * rows) - ER.HOLE_OK) * 1000);
}

// How far the given tables' centres lie outside the middle third of the layout (px, both axes summed)
function erOffCentre(boxes, ids) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  boxes.forEach((b) => { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  return Math.round(ids.reduce((sum, i, rank) => {
    const k = rank === 0 ? 11 : 6.4;                // the top table within 1/11 of the middle (the metric allows 1/10), the next two within the middle third (1/6) with some margin
    return sum + Math.max(0, Math.abs(boxes[i].x + boxes[i].w / 2 - mx) - (x1 - x0) / k) + Math.max(0, Math.abs(boxes[i].y + boxes[i].h / 2 - my) - (y1 - y0) / k);
  }, 0));
}

// Local search on a candidate: move one table to a nearby spot, push the others clear (overlap removal), and keep the
// move when the cost drops (hits, crossings, length, centre and aspect) without the bounding box growing more than 5%.
// Threshold accepting: early rounds also accept a slightly worse cost, to leave local minima; the last round accepts only
// improvements. The cheapest state seen is kept.
function erRepair(c, score, cost, floor, hubs, rounds, good) {
  const n = c.boxes.length, all = c.boxes.map((_, i) => i);
  const sizes = c.boxes.map((b) => ({ w: b.w, h: b.h }));
  const centres = (bs) => ({ x: Float64Array.from(bs, (b) => b.x + b.w / 2), y: Float64Array.from(bs, (b) => b.y + b.h / 2) });
  let P = centres(c.boxes), spare = { x: new Float64Array(n), y: new Float64Array(n) };   // spare: the trial positions, swapped with P when a trial is taken
  const toBoxes = (Q) => sizes.map((z, i) => ({ x: Q.x[i] - z.w / 2, y: Q.y[i] - z.h / 2, w: z.w, h: z.h }));
  const area = (bx) => { const b = erBounds(all, { x: bx.map((q) => q.x + q.w / 2), y: bx.map((q) => q.y + q.h / 2) }, sizes); return (b.x1 - b.x0) * (b.y1 - b.y0); };
  const cap = area(c.boxes) * 1.2;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
  let cur = { key: c.key, boxes: c.boxes };
  let clear = !erOverlaps(all, P, sizes);            // P has no overlap, so a one-table move only needs local separation
  rounds.forEach((T, round) => {
    const last = round === rounds.length - 1;
    for (let pass = 0; pass < (last ? (rounds === ER.WARM_T ? 3 : ER.REPAIR_PASSES) : 2); pass++) {
      let improved = false;
      // whole-layout moves: stretch or squeeze an axis, then push apart whatever now overlaps
      for (const [fx, fy] of [[1.06, 0.94], [0.94, 1.06], [1, 0.92], [0.92, 1], [1.1, 1], [1, 1.1], [1.04, 1.04]]) {
        const b0 = erBounds(all, P, sizes), mx = (b0.x0 + b0.x1) / 2, my = (b0.y0 + b0.y1) / 2;
        const Q = { x: P.x.map((v) => mx + (v - mx) * fx), y: P.y.map((v) => my + (v - my) * fy) };
        if (!erSeparate(all, Q, sizes, 60)) continue;
        const bx = toBoxes(Q);
        if (area(bx) > cap || floor(bx) >= cost(cur.key) + T - 1e-6) continue;
        const key = score(bx, cur.key);
        if (cost(key, cost(cur.key) + T - 1e-6) < cost(cur.key) + T - 1e-6 && cost(key) !== cost(cur.key)) {
          cur = { key, boxes: bx }; P = Q; clear = true; improved = true;
          if (cost(key) < cost(c.key) - 1e-6) { c.key = key; c.boxes = bx; if (good(key)) return; }
        }
      }
      const todo = cur.key.cul.concat(all.filter((i) => !cur.key.cul.includes(i)));
      for (const i of todo) {
        for (const step of [32, 96, 224]) for (const [dx, dy] of dirs) {
          const Q = spare; Q.x.set(P.x); Q.y.set(P.y);
          Q.x[i] += dx * step; Q.y[i] += dy * step;
          if (!erSeparate(all, Q, sizes, 40, clear ? [i] : null)) continue;
          const bx = toBoxes(Q);
          if (area(bx) > cap || floor(bx) >= cost(cur.key) + T - 1e-6) continue;
          const key = score(bx, cur.key);
          if (cost(key, cost(cur.key) + T - 1e-6) < cost(cur.key) + T - 1e-6 && cost(key) !== cost(cur.key)) {
            cur = { key, boxes: bx }; spare = P; P = Q; clear = true; improved = true;
            if (cost(key) < cost(c.key) - 1e-6) { c.key = key; c.boxes = bx; if (good(key)) return; }
          }
        }
      }
      // a hub that is off the centre swaps places with another table
      if (cur.key[3] > 0) for (const h of hubs) for (const j of all) {
        if (j === h || cur.key[3] === 0) continue;
        const Q = spare; Q.x.set(P.x); Q.y.set(P.y);
        Q.x[h] = P.x[j]; Q.y[h] = P.y[j]; Q.x[j] = P.x[h]; Q.y[j] = P.y[h];
        if (!erSeparate(all, Q, sizes, 40)) continue;
        const bx = toBoxes(Q);
        if (area(bx) > cap || floor(bx) >= cost(cur.key) + T - 1e-6) continue;
        const key = score(bx, cur.key);
        if (cost(key, cost(cur.key) + T - 1e-6) < cost(cur.key) + T - 1e-6 && cost(key) !== cost(cur.key)) {
          cur = { key, boxes: bx }; spare = P; P = Q; clear = true; improved = true;
          if (cost(key) < cost(c.key) - 1e-6) { c.key = key; c.boxes = bx; if (good(key)) return; }
        }
      }
      if (!improved) break;
    }
    // slide everything inward, then continue from the best state so far
    const Q = centres(c.boxes);
    erCompact(all, Q, sizes, 6);
    const bx = toBoxes(Q), key = score(bx, c.key);
    if (cost(key) < cost(c.key)) { c.key = key; c.boxes = bx; }
    cur = { key: c.key, boxes: c.boxes };
    P = centres(c.boxes);
    clear = !erOverlaps(all, P, sizes);
  });
}

// Last resort for hits the local search left: moves a table of the hit line (either end, or the table it runs through)
// by larger steps, with no cap on the bounding box, and keeps a move that removes a hit and leaves at most one crossing more than the layout had
function erClearHits(c, score) {
  const sizes = c.boxes.map((b) => ({ w: b.w, h: b.h })), all = sizes.map((_, i) => i), maxX = c.key[1] + 1;
  for (let round = 0; round < 4 && c.key[0]; round++) {
    let done = false;
    const P = { x: Float64Array.from(c.boxes, (b) => b.x + b.w / 2), y: Float64Array.from(c.boxes, (b) => b.y + b.h / 2) };
    const todo = c.key.hitCul && c.key.hitCul.length ? c.key.hitCul : c.key.cul;
    for (const i of todo) {
      let pick = null;
      for (const step of [64, 128, 192, 288, 400]) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const Q = { x: Float64Array.from(P.x), y: Float64Array.from(P.y) };
          Q.x[i] += dx * step; Q.y[i] += dy * step;
          if (!erSeparate(all, Q, sizes, 40, [i])) continue;
          const bx = sizes.map((z, j) => ({ x: Q.x[j] - z.w / 2, y: Q.y[j] - z.h / 2, w: z.w, h: z.h }));
          const key = score(bx, c.key);
          if (key[0] < c.key[0] && key[1] <= maxX && (!pick || key[0] < pick.key[0] || (key[0] === pick.key[0] && (key[1] < pick.key[1] || (key[1] === pick.key[1] && key[2] < pick.key[2]))))) pick = { key, boxes: bx };
        }
        if (pick && pick.key[0] === 0 && pick.key[1] <= c.key[1]) break;
      }
      if (!pick || pick.key[0] > 0) for (const j of all) {                         // or swap places with another table
        if (j === i) continue;
        const Q = { x: Float64Array.from(P.x), y: Float64Array.from(P.y) };
        Q.x[i] = P.x[j]; Q.y[i] = P.y[j]; Q.x[j] = P.x[i]; Q.y[j] = P.y[i];
        if (!erSeparate(all, Q, sizes, 40)) continue;
        const bx = sizes.map((z, k) => ({ x: Q.x[k] - z.w / 2, y: Q.y[k] - z.h / 2, w: z.w, h: z.h }));
        const key = score(bx, c.key);
        if (key[0] < c.key[0] && key[1] <= maxX && (!pick || key[0] < pick.key[0] || (key[0] === pick.key[0] && (key[1] < pick.key[1] || (key[1] === pick.key[1] && key[2] < pick.key[2]))))) pick = { key, boxes: bx };
        if (pick && pick.key[0] === 0 && pick.key[1] <= c.key[1]) break;
      }
      if (pick) { c.key = pick.key; c.boxes = pick.boxes; done = true; break; }
    }
    if (!done) return;
  }
}

// Squeeze: shrinks the layout toward its centre (each axis alone, or both) for as long as that adds no hit and no
// crossing, preferring the step that leaves the aspect closest to the target
function erSqueeze(c, score) {
  const sizes = c.boxes.map((b) => ({ w: b.w, h: b.h })), all = sizes.map((_, i) => i);
  for (let step = 0; step < ER.SQUEEZE_STEPS; step++) {
    const P = { x: c.boxes.map((b) => b.x + b.w / 2), y: c.boxes.map((b) => b.y + b.h / 2) };
    const b0 = erBounds(all, P, sizes), cx = (b0.x0 + b0.x1) / 2, cy = (b0.y0 + b0.y1) / 2;
    let pick = null;
    [[0.96, 1], [1, 0.96], [0.97, 0.97]].forEach(([fx, fy]) => {
      const Q = { x: P.x.map((v) => cx + (v - cx) * fx), y: P.y.map((v) => cy + (v - cy) * fy) };
      if (!erSeparate(all, Q, sizes, 40)) return;
      const bx = sizes.map((z, i) => ({ x: Q.x[i] - z.w / 2, y: Q.y[i] - z.h / 2, w: z.w, h: z.h }));
      const key = score(bx, c.key);
      if (key[0] > c.key[0] || key[1] > c.key[1]) return;
      const b = erBounds(all, Q, sizes), w = b.x1 - b.x0, h = b.y1 - b.y0;
      if ((w * h) >= (b0.x1 - b0.x0) * (b0.y1 - b0.y0)) return;
      const dev = Math.abs(w / h - ER.ASPECT_T);
      if (!pick || dev < pick.dev) pick = { key, boxes: bx, dev };
    });
    if (!pick) return;
    c.key = pick.key; c.boxes = pick.boxes;
  }
}

// Full layout: node-graph placement, then the candidate with the fewest line-over-table hits, then the fewest crossings,
// then the shortest total length. opts.warm starts from the saved positions instead of the seed.
function layoutDiagram(data, opts) {
  erClearDerived(data);
  const ents = data.entities || [], n = ents.length;
  if (!n) { data.canvas = { width: 0, height: 0, crossings: 0, length: 0 }; return; }
  const placed = (e) => typeof e.x === 'number' && typeof e.y === 'number';
  const warm = !!(opts && opts.warm) && ents.some(placed);       // warm: tables without a position start beside their neighbours
  const sizes = ents.map((e) => erEntitySize(e, data));
  erNeed = erNeedOf(data, sizes); erNeedN = n;
  erRel = ents.map((_, a) => { const r = []; for (let b = 0; b < n; b++) if (erNeed[a * n + b] > 0) r.push(b); return r; });
  const { adj } = erGraph(data);
  const D = erDistances(data, adj, sizes);
  const lite = n > ER.LITE;
  const variants = warm ? [0] : Array.from({ length: lite ? ER.LITE_VARIANTS : ER.VARIANTS }, (_, v) => v);
  // Weights: a hit or a crossing beyond two outweighs everything; then the middle-third and fit and aspect misses; length last
  // The unevenness and empty-space terms (k[7], k[8]) are the slowest to compute, so they are worked out on demand: with a
  // limit, a key whose other terms already reach it is not worth them (the two terms only add)
  // the terms that depend on the boxes alone (centre, aspect, fit, area), a lower bound of the cost that costs no routing
  const fixed = (centre, aspect, fit, area) => centre * 60 + aspect * 80 + fit * 150 + area * 4;
  // scored at whole pixels, as the tables end up, so the search sees the hits and crossings of the final picture
  const snap = (free) => free.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: b.w, h: b.h }));
  const floor = (free) => { const boxes = snap(free), e = erExtent(boxes); return fixed(erOffCentre(boxes, hubs), erOffAspect(boxes), erOffFit(boxes), Math.round(e.w * e.h / ER.AREA_DIV)); };
  const cost = (k, limit) => {
    const base = k[0] * 6000 + k[1] * 3000 + Math.max(0, k[1] - 2) * 5000 + k[2] / 40 + fixed(k[3], k[4], k[5], k[6]);
    if (limit !== undefined && base >= limit) return base;
    if (k[7] === undefined) { k[7] = erUneven(k.bx); k[8] = erHoles(k.bx); }
    return base + k[7] * 8 + k[8] * 24;
  };
  const quickScore = (free, prev) => {
    const boxes = snap(free);
    const sc = erRouteAll(data, boxes, true, prev && prev.st);
    if (prev && globalThis.ER_CHECK) {                 // debug: the incremental totals must equal a full count
      const full = erRouteAll(data, boxes, true);
      if (full.hits !== sc.hits || full.crossings !== sc.crossings || full.length !== sc.length || full.cul.join() !== sc.cul.join()) throw new Error('erd: incremental score differs from a full route');
    }
    const e = erExtent(boxes);
    const key = [sc.hits, sc.crossings, sc.length, erOffCentre(boxes, hubs), erOffAspect(boxes), erOffFit(boxes), Math.round(e.w * e.h / ER.AREA_DIV)];
    key.bx = boxes; key.cul = sc.cul; key.hitCul = sc.hitCul; key.st = sc.st;
    return key;
  };
  // The most connected table (ties: the first), then the next two (ties by id), the way the layout metrics pick them
  const byDeg = adj.map((a, i) => i).sort((a, b) => adj[b].length - adj[a].length || a - b);
  const hubs = [byDeg[0]].concat(byDeg.slice(1).sort((a, b) => adj[b].length - adj[a].length || (ents[a].id < ents[b].id ? -1 : ents[a].id > ents[b].id ? 1 : 0)).slice(0, 2));
  // good enough to stop searching: no hit, at most two crossings, hubs central, aspect and fit inside their targets
  const small = n <= ER.SMALL;                     // a small diagram is cheap to search: more candidates, and no crossing accepted
  const good = (k) => !k[0] && k[1] <= (small ? 0 : 2) && !k[3] && !k[4] && !k[5] && !k[7] && !k[8];
  const cands = variants.map((variant) => {
    const P = { x: new Float64Array(n), y: new Float64Array(n) };
    if (warm) {
      ents.forEach((e, i) => { if (placed(e)) { P.x[i] = e.x + sizes[i].w / 2; P.y[i] = e.y + sizes[i].h / 2; } });
      ents.forEach((e, i) => {
        if (placed(e)) return;
        const nb = adj[i].filter((j) => placed(ents[j])), from = nb.length ? nb : ents.map((_, j) => j).filter((j) => placed(ents[j]));
        P.x[i] = from.reduce((m, j) => m + P.x[j], 0) / from.length + sizes[i].w; P.y[i] = from.reduce((m, j) => m + P.y[j], 0) / from.length;
      });
    }
    erPlaceAll(adj, D, sizes, variant, warm, P);
    erUnhit(P, sizes, (bx) => erRouteAll(data, bx, true), ER.UNHIT_IT);
    const boxes = ents.map((e, i) => ({ x: P.x[i] - sizes[i].w / 2, y: P.y[i] - sizes[i].h / 2, w: sizes[i].w, h: sizes[i].h }));
    return { key: quickScore(boxes), boxes };
  });
  // the best few are refined by the local search; the winner is the cheapest after it (stable sort: ties keep variant order)
  cands.sort((p, q) => cost(p.key) - cost(q.key));
  let best = null;
  cands.slice(0, warm ? 1 : lite ? ER.LITE_REFINE : small ? ER.REFINE_SMALL : ER.REFINE).forEach((c) => {
    if (best && good(best.key)) return;
    erRepair(c, quickScore, cost, floor, hubs, warm ? ER.WARM_T : lite ? ER.LITE_T : ER.REPAIR_T, good);
    erSqueeze(c, quickScore);
    if (!best || cost(c.key) < cost(best.key)) best = c;
  });
  if (!warm && !small && !lite) { erRepair(best, quickScore, cost, floor, hubs, ER.POLISH_T, good); erSqueeze(best, quickScore); }   // more search on the winner alone
  // Move blocking tables along natural paths first, then route any remaining obstacle hits cleanly
  if (best.key[0] && !warm) { erClearHits(best, quickScore); erSqueeze(best, quickScore); }
  const preHitCul = best.key.hitCul || [], preCross = best.key[1];
  const altScore = (free, prev) => {
    const boxes = snap(free);
    const sc = erRouteAll(data, boxes, true, prev && prev.st, true);
    const e = erExtent(boxes);
    const key = [sc.hits, sc.crossings, sc.length, erOffCentre(boxes, hubs), erOffAspect(boxes), erOffFit(boxes), Math.round(e.w * e.h / ER.AREA_DIV)];
    key.bx = boxes; key.cul = sc.cul; key.hitCul = sc.hitCul; key.st = sc.st;
    return key;
  };
  best.key = altScore(best.boxes);
  if (best.key[0] && !warm) { erClearHits(best, altScore); erSqueeze(best, altScore); }
  // If obstacle routing added crossings above the target (e.g. boxed-in hub/leaf), try moving or swapping a nearby blocked/alt/neighbor table
  if (!warm && !best.key[0] && best.key[1] > Math.max(2, preCross)) {
    const targetX = Math.max(2, preCross), all = best.boxes.map((_, i) => i);
    for (let pass = 0; pass < 2 && best.key[1] > targetX; pass++) {
      const altIds = new Set(pass ? [] : preHitCul);
      best.key.st.live.forEach((L) => {
        if (!L.alt) return;
        if (altIds.size < 8) { altIds.add(L.a); altIds.add(L.b); }
        if (pass && altIds.size < 12) { adj[L.a].forEach((nb) => { if (altIds.size < 12) altIds.add(nb); }); adj[L.b].forEach((nb) => { if (altIds.size < 12) altIds.add(nb); }); }
      });
      if (!pass && altIds.size < 6) best.key.st.live.forEach((L) => { if (L.alt && altIds.size < 8) { altIds.add(L.a); altIds.add(L.b); } });
      if (pass && altIds.size < 12) best.key.cul.forEach((i) => { if (altIds.size < 12) altIds.add(i); });
      let improved = false;
      for (const i of altIds) {
        let pick = null;
        const maxArea = erExtent(best.boxes), areaCap = maxArea.w * maxArea.h * 1.15;
        const P = { x: Float64Array.from(best.boxes, (b) => b.x + b.w / 2), y: Float64Array.from(best.boxes, (b) => b.y + b.h / 2) };
        const tryQ = (Q, only) => {
          if (!erSeparate(all, Q, sizes, 40, only)) return;
          const bx = sizes.map((z, j) => ({ x: Q.x[j] - z.w / 2, y: Q.y[j] - z.h / 2, w: z.w, h: z.h }));
          const ex = erExtent(bx);
          if (ex.w * ex.h > areaCap || erOffCentre(bx, hubs.slice(0, 1)) > erOffCentre(best.boxes, hubs.slice(0, 1)) || erOffAspect(bx) > best.key[4] || erOffFit(bx) > best.key[5] + 25) return;
          const key = altScore(bx, best.key);
          if (key[0] === 0 && key[1] < best.key[1] && (!pick || key[1] < pick.key[1] || (key[1] === pick.key[1] && key[2] < pick.key[2]))) pick = { key, boxes: bx };
        };
        for (const step of [64, 128, 192, 288, 400]) {
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
            const Q = { x: Float64Array.from(P.x), y: Float64Array.from(P.y) };
            Q.x[i] += dx * step; Q.y[i] += dy * step;
            tryQ(Q, [i]);
          }
          if (pick && pick.key[1] <= targetX) break;
        }
        if (!pick || pick.key[1] > targetX) for (const j of all) {
          if (j === i || Math.hypot(P.x[j] - P.x[i], P.y[j] - P.y[i]) > 600) continue;
          const Q = { x: Float64Array.from(P.x), y: Float64Array.from(P.y) };
          Q.x[i] = P.x[j]; Q.y[i] = P.y[j]; Q.x[j] = P.x[i]; Q.y[j] = P.y[i];
          tryQ(Q, null);
          if (pick && pick.key[1] <= targetX) break;
        }
        if (pick) { best.key = pick.key; best.boxes = pick.boxes; erSqueeze(best, altScore); improved = true; if (best.key[1] <= targetX) break; }
      }
      if (!improved) break;
    }
  }
  const found = erRouteAll(data, best.boxes, true, null, true);
  const dx = Math.round(ER.MARGIN - found.minX), dy = Math.round(ER.MARGIN - found.minY);
  ents.forEach((e, i) => { e.x = Math.round(best.boxes[i].x) + dx; e.y = Math.round(best.boxes[i].y) + dy; });
  erRouteFromPositions(data);
}

function routeDiagram(data) {
  const ents = data.entities || [];
  if (ents.some((e) => typeof e.x !== 'number' || typeof e.y !== 'number')) { layoutDiagram(data); return; }
  erRouteFromPositions(data);
}
