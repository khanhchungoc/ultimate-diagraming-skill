// Use case layout engine. Pure JS, no DOM. Run by the page (Tidy, edits, saved-page routes) and by
// scripts/run_engine.mjs (--layout), so both use this one implementation. Plan: dev/plans/plan-usecase.md.
//
// Input:  title?, subjects?[{id,name,collapsed?}], actors[{id,name,kind?,side?,parent?}],
//         useCases[{id,name,subject?,color?,level?,extensionPoints?,parent?}],
//         links[{id,type: association|include|extend, from, to, condition?}]
// Output (derived, written in place; units are canvas px, top-left origin):
//         actors[].x,y,w,h,_side,_figW,_figH   the whole actor (figure or tile, name below); _figW/_figH = the drawn figure
//                                              (human: figure box at the top of the actor; tile: the whole actor)
//         useCases[].x,y,w,h,_lines,_compH,_hidden   ellipse box (compartment included), name wrapped to <= 2 lines,
//                                              extension-points compartment height, true inside a collapsed subject (w = h = 0)
//         subjects[].x,y,w,h,_titleH           boundary box (data._subjects for an implicit `_main` subject)
//         links[].points,labelBox,_hidden      2 points straight, 3 points a quadratic curve (middle = control); [] when hidden
//         data._parents[{from,to,kind,points}] one line per `parent` (to = the parent, the triangle sits at the last point)
//         data.canvas {width,height,crossings,hits}
// layoutDiagram(data): full layout. routeDiagram(data): keeps every x/y, recomputes the rest (lays out when one is missing).
// Deterministic: no randomness, stable sorts.

const UC = {
  // text (widths only through TOKENS.font.metrics)
  CHAR_W: TOKENS.font.metrics.label, DETAIL_W: TOKENS.font.metrics.detail, TITLE_W: TOKENS.font.metrics.title,
  LABEL_W: TOKENS.font.metrics.edgeLabel, WRAP_W: TOKENS.font.metrics.edgeWrap,
  TEXT_H: 18, DETAIL_H: 16, LABEL_LINE_H: 16,
  // ellipse
  WRAP: 156, MIN_W: 128, MIN_H: 44, PAD_TXT: 14, ONE_LINE_K: 1.12, TWO_LINE_K: 1.22, GRID: 4,
  LEVEL_K: { summary: 1.14, user: 1, subfunction: 0.86 },
  COMP_PAD: 10,                                  // compartment: COMP_PAD + one DETAIL_H per extension point
  // actors
  FIG_W: 36, FIG_H: 56, ACTOR_WRAP: 120, NAME_GAP: 6, TILE_MIN_W: 112, TILE_H: 84, TILE_PAD: 24, ACTOR_MIN_W: 48,
  ACTOR_GAP_Y: 24, ACTOR_CHILD_GAP: 44, ACTOR_GAP: 96,
  // subjects
  TITLE_H: 36, TITLE_PAD_X: 44, PAD_X: 28, PAD_Y: 20, SUBJ_GAP: 32, EMPTY_BODY: 56,
  // placement
  ROW_GAP: 10, CHILD_GAP: 22, GAP_MIN: 84, GAP_MAX: 200, GAP_PER_LABEL: 28, MARGIN: 40, BUCKET: 24, SWEEPS: 12, PASSES: 4, SWAP_PASSES: 3,
  // lines and labels
  CLEAR: 4, LABEL_H: 22, LABEL_X: 12, CURVE_OFFS: [0, 28, -28, 56, -56, 90, -90, 130, -130, 180, -180, 240, -240],
  W_CROSS: 100, W_HIT: 250, W_LEN: 0.01
};

const ucGrid = (v) => Math.ceil(v / UC.GRID) * UC.GRID;
const ucTextW = (t, cw) => Math.ceil(String(t == null ? '' : t).length * cw);
const ucR1 = (v) => Math.round(v * 10) / 10;

// The name wrapped to at most two lines: one line when it fits UC.WRAP, else the word split with the narrowest widest line.
function ucWrap(text, cw, limit) {
  const s = String(text == null ? '' : text).trim().replace(/\s+/g, ' ');
  if (ucTextW(s, cw) <= limit) return [s];
  const words = s.split(' ');
  if (words.length < 2) return [s];
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const w = Math.max(a.length, b.length);
    if (!best || w < best.w) best = { w, lines: [a, b] };
  }
  return best.lines;
}

// ---------- model ----------

function ucModel(data) {
  const actors = data.actors || [], cases = data.useCases || [], links = data.links || [];
  let subjects = data.subjects && data.subjects.length ? data.subjects : null;
  if (subjects) delete data._subjects;
  else subjects = data._subjects = [{ id: '_main', name: data.title || '' }];
  const m = { data, actors, cases, links, subjects, actorBy: {}, caseBy: {}, aIdx: {}, cIdx: {}, sIdx: {}, sz: {} };
  actors.forEach((a, i) => { m.actorBy[a.id] = a; m.aIdx[a.id] = i; });
  cases.forEach((c, i) => { m.caseBy[c.id] = c; m.cIdx[c.id] = i; });
  subjects.forEach((s, i) => { m.sIdx[s.id] = i; });
  m.si = {};                                        // case id -> subject index (unknown or missing: the first)
  cases.forEach((c) => { m.si[c.id] = m.sIdx[c.subject] !== undefined ? m.sIdx[c.subject] : 0; });
  m.subj = subjects.map((s, i) => ({ s, i, collapsed: s.collapsed === true, cases: [] }));
  cases.forEach((c) => m.subj[m.si[c.id]].cases.push(c));
  m.hidden = {};
  cases.forEach((c) => { m.hidden[c.id] = m.subj[m.si[c.id]].collapsed; });
  m.links = links.filter((l) => (m.actorBy[l.from] || m.caseBy[l.from]) && (m.actorBy[l.to] || m.caseBy[l.to]));
  m.colorRank = {};
  cases.forEach((c) => { if (c.color != null && m.colorRank[c.color] === undefined) m.colorRank[c.color] = Object.keys(m.colorRank).length; });
  // neighbours for the barycentre: actor <-> case, case <-> case through include and extend
  m.nbr = {};
  const add = (a, b) => { (m.nbr[a] = m.nbr[a] || []).push(b); (m.nbr[b] = m.nbr[b] || []).push(a); };
  m.links.forEach((l) => {
    if (l.from === l.to) return;
    const fa = !!m.actorBy[l.from], ta = !!m.actorBy[l.to];
    if (l.type === 'association' ? fa !== ta : (!fa && !ta)) add(l.from, l.to);
  });
  ucSides(m);
  return m;
}

function ucRoot(by, id) {                           // top of a `parent` chain (cycle safe)
  let cur = by[id], n = 0;
  while (cur && cur.parent && by[cur.parent] && n++ < 50) cur = by[cur.parent];
  return cur;
}

function ucSides(m) {
  m.side = {};
  m.actors.forEach((a) => {
    const r = ucRoot(m.actorBy, a.id) || a;
    let side = r.side === 'left' || r.side === 'right' ? r.side : null;
    if (!side) {
      let starts = false, ends = false;
      // a root and its descendants decide together
      m.actors.forEach((b) => {
        if ((ucRoot(m.actorBy, b.id) || b) !== r) return;
        m.links.forEach((l) => { if (l.type === 'association') { if (l.from === b.id) starts = true; else if (l.to === b.id) ends = true; } });
      });
      side = !starts && ends ? 'right' : 'left';
    }
    m.side[a.id] = side;
    a._side = side;
  });
}

// ---------- sizes ----------

function ucSizes(m) {
  m.actors.forEach((a) => {
    const kind = a.kind === 'system' || a.kind === 'time' ? a.kind : 'human';
    const lines = ucWrap(a.name, UC.CHAR_W, UC.ACTOR_WRAP);
    a._lines = lines;
    const tw = Math.max(...lines.map((l) => ucTextW(l, UC.CHAR_W)));
    if (kind === 'human') {
      a.w = ucGrid(Math.max(UC.ACTOR_MIN_W, tw + 8));
      a.h = ucGrid(UC.FIG_H + UC.NAME_GAP + lines.length * UC.TEXT_H);
      a._figW = UC.FIG_W; a._figH = UC.FIG_H;
    } else {
      a.w = ucGrid(Math.max(UC.TILE_MIN_W, tw + UC.TILE_PAD));
      a.h = ucGrid(UC.TILE_H + (lines.length - 1) * UC.TEXT_H);
      a._figW = a.w; a._figH = a.h;
    }
    m.sz[a.id] = { w: a.w, h: a.h, anchor: kind === 'human' ? UC.FIG_H / 2 : a.h / 2 };
  });
  m.cases.forEach((c) => {
    if (m.hidden[c.id]) {
      c._lines = ucWrap(c.name, UC.CHAR_W, UC.WRAP); c._compH = 0; c._hidden = true; c.w = 0; c.h = 0;
      m.sz[c.id] = { w: 0, h: 0, anchor: 0 };
      return;
    }
    delete c._hidden;
    const lines = ucWrap(c.name, UC.CHAR_W, UC.WRAP);
    const tw = Math.max(...lines.map((l) => ucTextW(l, UC.CHAR_W)));
    const k = UC.LEVEL_K[c.level] || 1;
    let w = (tw * (lines.length > 1 ? UC.TWO_LINE_K : UC.ONE_LINE_K) + 2 * UC.PAD_TXT) * k;
    let h = (lines.length > 1 ? lines.length * UC.TEXT_H + 24 : UC.MIN_H) * k;
    w = Math.max(UC.MIN_W * k, w);
    const pts = (c.extensionPoints || []).map(String);
    const compH = pts.length ? UC.COMP_PAD + pts.length * UC.DETAIL_H : 0;
    if (pts.length) w = Math.max(w, Math.max(...pts.map((p) => ucTextW(p, UC.DETAIL_W))) * 1.4 + 2 * UC.PAD_TXT);
    c._lines = lines; c._compH = compH;
    c.w = ucGrid(w); c.h = ucGrid(h + compH);
    m.sz[c.id] = { w: c.w, h: c.h, anchor: c.h / 2 };
  });
}

// ---------- ranks and units ----------

function ucRanks(m) {
  m.rank = {};
  m.cases.forEach((c) => { m.rank[c.id] = 0; });
  const same = (a, b) => m.si[a] === m.si[b] && !m.hidden[a] && m.caseBy[a] && m.caseBy[b];
  const cons = [];                                  // [lo, hi, delta]: rank[hi] >= rank[lo] + delta, delta 0 both ways
  m.links.forEach((l) => {
    if (!m.caseBy[l.from] || !m.caseBy[l.to] || !same(l.from, l.to) || l.from === l.to) return;
    if (l.type === 'include') cons.push([l.from, l.to, 1]);
    else if (l.type === 'extend') cons.push([l.to, l.from, 1]);
  });
  m.cases.forEach((c) => { if (c.parent && m.caseBy[c.parent] && same(c.id, c.parent)) { cons.push([c.parent, c.id, 0]); cons.push([c.id, c.parent, 0]); } });
  const n = m.cases.length;
  for (let pass = 0, ch = true; ch && pass < n + 2; pass++) {
    ch = false;
    cons.forEach(([lo, hi, d]) => { if (m.rank[hi] < m.rank[lo] + d) { m.rank[hi] = m.rank[lo] + d; ch = true; } });
  }
  // a case only a right-side actor reaches (and nothing builds on) moves to the right-most column of its subject
  const succ = {}, grouped = {};
  cons.forEach(([lo, , d]) => { if (d === 1) succ[lo] = true; });
  m.cases.forEach((c) => { if (c.parent && m.caseBy[c.parent]) { grouped[c.id] = true; grouped[c.parent] = true; } });
  m.subj.forEach((sj) => {
    if (sj.collapsed) return;
    const movable = [], rest = [];
    sj.cases.forEach((c) => {
      const act = (m.nbr[c.id] || []).filter((id) => m.actorBy[id]);
      (act.length && act.every((id) => m.side[id] === 'right') && !succ[c.id] && !grouped[c.id] ? movable : rest).push(c);
    });
    if (!movable.length) return;
    const maxR = rest.length ? Math.max(...rest.map((c) => m.rank[c.id])) : -1;
    const target = rest.length ? Math.max(maxR, 1) : 0;
    movable.forEach((c) => { m.rank[c.id] = Math.max(m.rank[c.id], target); });
  });
}

// units: a root and its `parent` descendants stacked below it
function ucUnits(m) {
  m.unit = {};                                      // root id -> {id, members:[{id,off,anch}], H, actor}
  m.unitOf = {};                                    // any id -> root id
  const build = (list, by, childGap, isActor, valid) => {
    const kids = {};
    list.forEach((x) => { if (x.parent && by[x.parent] && valid(x, by[x.parent])) (kids[x.parent] = kids[x.parent] || []).push(x); });
    const seen = {};
    const make = (root) => {
      const members = []; let off = 0;
      const walk = (x) => {
        if (seen[x.id]) return; seen[x.id] = true;
        const z = m.sz[x.id];
        members.push({ id: x.id, off, anch: z.anchor, h: z.h });
        off += z.h + childGap;
        (kids[x.id] || []).forEach(walk);
        m.unitOf[x.id] = root.id;
      };
      walk(root);
      const last = members[members.length - 1];
      m.unit[root.id] = { id: root.id, members, H: last.off + last.h, actor: isActor };
    };
    list.forEach((x) => { if (!(x.parent && by[x.parent] && valid(x, by[x.parent]))) make(x); });
    list.forEach((x) => { if (!seen[x.id]) make(x); });   // parent cycles
  };
  build(m.actors, m.actorBy, UC.ACTOR_CHILD_GAP, true, (x, p) => m.side[x.id] === m.side[p.id]);
  build(m.cases, m.caseBy, UC.CHILD_GAP, false, (x, p) => m.si[x.id] === m.si[p.id] && !m.hidden[x.id] && m.rank[x.id] === m.rank[p.id]);
}

// ---------- columns (x) ----------

function ucColumns(m) {
  // label widths between adjacent ranks widen the gap
  const lab = (l) => ucLabelLines(l).w;
  m.colX = []; m.cols = [];                         // colX[s][rank] = {x, w}
  let maxContent = 0, leftW = 0, rightW = 0;
  m.actors.forEach((a) => { if (m.side[a.id] === 'left') leftW = Math.max(leftW, a.w); else rightW = Math.max(rightW, a.w); });
  m.leftW = leftW; m.rightW = rightW;
  m.subj.forEach((sj) => {
    const ranks = {};
    sj.cases.forEach((c) => { if (!m.hidden[c.id]) (ranks[m.rank[c.id]] = ranks[m.rank[c.id]] || []).push(c); });
    sj.ranks = Object.keys(ranks).map(Number).sort((a, b) => a - b);
    sj.rankCases = ranks;
    sj.colW = sj.ranks.map((r) => Math.max(...ranks[r].map((c) => c.w)));
    sj.gap = sj.ranks.map((r, k) => {
      if (k === sj.ranks.length - 1) return 0;
      let lw = 0, nl = 0;
      m.links.forEach((l) => {
        if ((l.type !== 'include' && l.type !== 'extend') || !m.caseBy[l.from] || !m.caseBy[l.to]) return;
        const rf = m.rank[l.from], rt = m.rank[l.to];
        if (m.si[l.from] !== sj.i || m.si[l.to] !== sj.i) return;
        if (Math.min(rf, rt) === r && Math.max(rf, rt) === sj.ranks[k + 1]) { lw = Math.max(lw, lab(l)); nl++; }
      });
      return Math.min(UC.GAP_MAX, Math.max(UC.GAP_MIN, lw ? lw + 16 + UC.GAP_PER_LABEL * (nl - 1) : 0));
    });
    sj.content = sj.colW.reduce((s, w) => s + w, 0) + sj.gap.reduce((s, w) => s + w, 0);
    maxContent = Math.max(maxContent, sj.content);
  });
  const titleMin = Math.max(0, ...m.subj.map((sj) => ucTextW(sj.s.name, UC.TITLE_W) + UC.TITLE_PAD_X));
  const left = (leftW ? UC.MARGIN + leftW + UC.ACTOR_GAP : UC.MARGIN);
  const hasVis = m.subj.some((sj) => sj.ranks.length);
  m.W = Math.max(hasVis ? maxContent + 2 * UC.PAD_X : 0, titleMin);
  m.L = left;
  m.subj.forEach((sj) => {
    const out = [];
    const room = m.W - 2 * UC.PAD_X;
    let x = m.L + UC.PAD_X;
    if (sj.ranks.length === 1) x = m.L + Math.floor((m.W - sj.colW[0]) / 2);
    else if (sj.ranks.length > 1 && room > sj.content) { /* stretched below */ }
    const extra = sj.ranks.length > 1 ? (room - sj.content) / (sj.ranks.length - 1) : 0;
    let acc = 0;
    sj.ranks.forEach((r, k) => {
      out[r] = { x, w: sj.colW[k] };
      acc += extra;
      x += sj.colW[k] + sj.gap[k] + (Math.round(acc) - Math.round(acc - extra));
    });
    m.colX[sj.i] = out;
  });
  m.R = m.L + m.W;
  m.actors.forEach((a) => {
    a.x = m.side[a.id] === 'left' ? UC.MARGIN + Math.floor((leftW - a.w) / 2) : m.R + UC.ACTOR_GAP + Math.floor((rightW - a.w) / 2);
  });
  m.cases.forEach((c) => {
    if (m.hidden[c.id]) { c.x = m.L; return; }
    const col = m.colX[m.si[c.id]][m.rank[c.id]];
    c.x = col.x + Math.floor((col.w - c.w) / 2);
  });
}

// ---------- link text ----------

function ucLabelLines(l) {
  if (l.type !== 'include' && l.type !== 'extend') return { lines: [], w: 0, h: 0 };
  const lines = ['«' + l.type + '»'];
  let w = ucTextW(lines[0], UC.LABEL_W);
  if (l.type === 'extend' && l.condition) {
    const cond = ucWrap('[' + l.condition + ']', UC.WRAP_W, 150);
    cond.forEach((s) => { lines.push(s); w = Math.max(w, ucTextW(s, UC.WRAP_W)); });
  }
  return { lines, w: w + 2 * UC.LABEL_X, h: lines.length > 1 ? UC.LABEL_H + (lines.length - 1) * UC.LABEL_LINE_H : UC.LABEL_H };
}

// ---------- geometry helpers ----------

// the item's box and anchor for a line: ellipse, actor (figure) or the title bar of a collapsed subject
function ucItem(m, id) {
  const a = m.actorBy[id];
  if (a) {
    const human = a.kind !== 'system' && a.kind !== 'time';
    const fw = a._figW, fh = a._figH;
    return { kind: 'actor', id, cx: a.x + a.w / 2, cy: a.y + m.sz[id].anchor, box: { x: a.x + (a.w - fw) / 2, y: a.y, w: fw, h: fh }, whole: { x: a.x, y: a.y, w: a.w, h: a.h }, human };
  }
  const c = m.caseBy[id];
  if (!c) return null;
  if (m.hidden[id]) {
    const b = m.bars[m.si[id]];
    return { kind: 'bar', id, cx: b.x + b.w / 2, cy: b.y + b.h / 2, box: b, whole: b };
  }
  return { kind: 'case', id, cx: c.x + c.w / 2, cy: c.y + c.h / 2, a: c.w / 2, b: c.h / 2 };
}

function ucClip(it, tx, ty, whole) {                // the point where the ray from the item's anchor toward (tx, ty) leaves it
  const dx = tx - it.cx, dy = ty - it.cy;
  if (!dx && !dy) return [it.cx, it.cy];
  if (it.kind === 'case') {
    const t = 1 / Math.sqrt((dx / it.a) * (dx / it.a) + (dy / it.b) * (dy / it.b));
    return [it.cx + dx * t, it.cy + dy * t];
  }
  const r = whole ? it.whole : it.box;
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (r.x + r.w - it.cx) / dx); else if (dx < 0) t = Math.min(t, (r.x - it.cx) / dx);
  if (dy > 0) t = Math.min(t, (r.y + r.h - it.cy) / dy); else if (dy < 0) t = Math.min(t, (r.y - it.cy) / dy);
  if (!(t >= 0) || t === Infinity) t = 0;
  return [it.cx + dx * t, it.cy + dy * t];
}

function ucSegEllipse(p, q, e, inflate) {          // does segment p-q enter the ellipse (inflated)?
  const a = e.a + inflate, b = e.b + inflate;
  const x1 = (p[0] - e.cx) / a, y1 = (p[1] - e.cy) / b, x2 = (q[0] - e.cx) / a, y2 = (q[1] - e.cy) / b;
  const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
  let t = L ? -(x1 * dx + y1 * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + dx * t, py = y1 + dy * t;
  return px * px + py * py < 1;
}

function ucSegRect(p, q, r) {                      // segment against a rectangle (sampled)
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t;
    if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
  }
  return false;
}

const ucQuad = (p0, c, p1, t) => [(1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0], (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]];

function ucPolyline(pts) {
  if (pts.length === 3) { const out = []; for (let i = 0; i <= 16; i++) out.push(ucQuad(pts[0], pts[1], pts[2], i / 16)); return out; }
  return pts;
}

function ucSegCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// ---------- cost of an arrangement (straight lines) ----------

function ucCost(m, pos) {
  const ell = {};
  const nodes = {};
  m.cases.forEach((c) => {
    const z = m.sz[c.id];
    if (m.hidden[c.id]) { nodes[c.id] = { kind: 'bar', cx: pos.barX, cy: pos.y[c.id] }; return; }
    nodes[c.id] = { kind: 'case', cx: pos.x[c.id] + z.w / 2, cy: pos.y[c.id] + z.h / 2, a: z.w / 2, b: z.h / 2 };
    ell[c.id] = nodes[c.id];
  });
  m.actors.forEach((a) => { nodes[a.id] = { kind: 'actor', cx: a.x + a.w / 2, cy: pos.y[a.id] + m.sz[a.id].anchor }; });
  const segs = [];
  m.links.forEach((l) => {
    const A = nodes[l.from], B = nodes[l.to];
    if (!A || !B || l.from === l.to) return;
    const p = A.kind === 'case' ? ucClip(A, B.cx, B.cy) : [A.cx, A.cy];
    const q = B.kind === 'case' ? ucClip(B, A.cx, A.cy) : [B.cx, B.cy];
    segs.push({ p, q, l });
  });
  let cross = 0, hits = 0, len = 0;
  const boxes = m.actors.map((a) => ({ id: a.id, x: a.x, y: pos.y[a.id], w: a.w, h: a.h }));
  segs.forEach((s) => {
    len += Math.hypot(s.q[0] - s.p[0], s.q[1] - s.p[1]);
    for (const id in ell) if (id !== s.l.from && id !== s.l.to && ucSegEllipse(s.p, s.q, ell[id], UC.CLEAR)) hits++;
    boxes.forEach((b) => { if (b.id !== s.l.from && b.id !== s.l.to && ucSegRect(s.p, s.q, b)) hits++; });
  });
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const a = segs[i].l, b = segs[j].l;
    if (a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to) continue;
    if (ucSegCross(segs[i].p, segs[i].q, segs[j].p, segs[j].q)) cross++;
  }
  return { crossings: cross, hits, length: len, cost: cross * UC.W_CROSS + hits * UC.W_HIT + len * UC.W_LEN };
}

// ---------- 1-D placement (isotonic regression with separation) ----------

// items in order: {H, d (desired top), w (weight)}; returns tops. lo/hi bound the whole stack.
function ucPlace1(items, gap, lo, hi) {
  const n = items.length, off = [];
  let o = 0;
  items.forEach((it, i) => { off[i] = o; o += it.H + gap; });
  const total = o - gap;
  const blocks = [];
  items.forEach((it, i) => {
    blocks.push({ s: i, e: i, sw: it.w, swq: it.w * (it.d - off[i]) });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (a.swq / a.sw <= b.swq / b.sw) break;
      a.e = b.e; a.sw += b.sw; a.swq += b.swq; blocks.pop();
    }
  });
  const tops = new Array(n);
  blocks.forEach((b) => {
    let q = Math.round(b.swq / b.sw);
    if (lo !== undefined) q = Math.max(q, lo);
    if (hi !== undefined) q = Math.min(q, hi - total);
    if (lo !== undefined && q < lo) q = lo;
    for (let i = b.s; i <= b.e; i++) tops[i] = q + off[i];
  });
  return tops;
}

// ---------- arrangement ----------

// where the unit wants to be: desired top and weight from its neighbours' current centres
function ucWant(m, u, cy) {
  let sw = 0, sd = 0;
  u.members.forEach((mem) => {
    (m.nbr[mem.id] || []).forEach((nid) => {
      const y = cy(nid);
      if (y === undefined) return;
      sd += y - mem.off - mem.anch; sw++;
    });
  });
  return sw ? { d: sd / sw, w: sw } : null;
}

// Place everything for the given case column orders. Returns positions and the cost.
function ucArrangeOnce(m, orders, actorOrderIn, fixedActors) {
  const y = {}, xs = {};
  m.cases.forEach((c) => { xs[c.id] = c.x; });
  // subject bands
  let top = UC.MARGIN;
  const bands = m.subj.map((sj) => {
    const band = { top };
    if (sj.collapsed) { band.bodyTop = top + UC.TITLE_H / 2; band.bodyH = 0; top += UC.TITLE_H + UC.SUBJ_GAP; }
    else {
      let bodyH = 0;
      sj.ranks.forEach((r) => {
        const col = orders[sj.i][r];
        const h = col.reduce((s, id) => s + m.unit[id].H, 0) + Math.max(0, col.length - 1) * UC.ROW_GAP;
        bodyH = Math.max(bodyH, h);
      });
      if (!sj.ranks.length) bodyH = UC.EMPTY_BODY;
      band.bodyTop = top + UC.TITLE_H + UC.PAD_Y; band.bodyH = bodyH;
      top = band.bodyTop + bodyH + UC.PAD_Y + UC.SUBJ_GAP;
    }
    return band;
  });
  const barX = m.L + m.W / 2;
  // initial: columns centred in the body, hidden cases at the bar centre
  const unitTop = {};
  m.subj.forEach((sj) => {
    if (sj.collapsed) { sj.cases.forEach((c) => { y[c.id] = bands[sj.i].top + UC.TITLE_H / 2; }); return; }
    sj.ranks.forEach((r) => {
      const col = orders[sj.i][r];
      const h = col.reduce((s, id) => s + m.unit[id].H, 0) + Math.max(0, col.length - 1) * UC.ROW_GAP;
      let t = bands[sj.i].bodyTop + Math.round((bands[sj.i].bodyH - h) / 2);
      col.forEach((id) => { unitTop[id] = t; t += m.unit[id].H + UC.ROW_GAP; });
    });
  });
  const setUnit = (id, t) => { unitTop[id] = t; m.unit[id].members.forEach((mem) => { y[mem.id] = t + mem.off; }); };
  Object.keys(unitTop).forEach((id) => setUnit(id, unitTop[id]));
  const cy = (id) => {
    if (y[id] === undefined) return undefined;
    return y[id] + m.sz[id].anchor;
  };
  // actor stacks: initial order authored, then by desired
  const actorOrder = { left: [], right: [] };
  let aprev = actorOrderIn || null;
  const placeActors = (resort) => {
    ['left', 'right'].forEach((side) => {
      let ids = aprev ? aprev[side].slice() : m.actors.filter((a) => m.unit[a.id] && m.unit[a.id].actor && m.unitOf[a.id] === a.id && m.side[a.id] === side).map((a) => a.id);
      const want = {};
      ids.forEach((id) => { want[id] = ucWant(m, m.unit[id], cy); });
      if (resort && !fixedActors) {
        const key = (id) => (want[id] ? want[id].d + m.unit[id].H / 2 : (y[id] !== undefined ? y[id] + m.unit[id].H / 2 : 1e9));
        ids = ids.map((id, i) => ({ id, k: key(id), i })).sort((p, q) => p.k - q.k || p.i - q.i).map((p) => p.id);
      }
      let fall = UC.MARGIN;
      const items = ids.map((id) => {
        const wnt = want[id];
        const d = wnt ? wnt.d : (y[id] !== undefined ? y[id] : fall);
        fall += m.unit[id].H + UC.ACTOR_GAP_Y;
        return { H: m.unit[id].H, d, w: wnt ? wnt.w : 0.01 };
      });
      const tops = ucPlace1(items, UC.ACTOR_GAP_Y, UC.MARGIN);
      ids.forEach((id, i) => setUnit(id, tops[i]));
      actorOrder[side] = ids;
    });
    aprev = actorOrder;
  };
  placeActors(true);
  for (let pass = 0; pass < UC.PASSES; pass++) {
    m.subj.forEach((sj) => {
      if (sj.collapsed) return;
      const ranks = pass % 2 ? sj.ranks.slice().reverse() : sj.ranks;
      ranks.forEach((r) => {
        const col = orders[sj.i][r];
        const items = col.map((id) => {
          const u = m.unit[id], wnt = ucWant(m, u, cy);
          return { H: u.H, d: wnt ? wnt.d : unitTop[id], w: wnt ? wnt.w : 0.01 };
        });
        const lo = bands[sj.i].bodyTop, hi = lo + bands[sj.i].bodyH;
        const tops = ucPlace1(items, UC.ROW_GAP, lo, hi);
        col.forEach((id, i) => setUnit(id, tops[i]));
      });
    });
    placeActors(true);
  }
  const res = { y, x: xs, bands, barX, orders, actorOrder };
  Object.assign(res, ucCost(m, res));
  return res;
}

const ucCloneOrders = (o) => o.map((s) => { const r = {}; Object.keys(s).forEach((k) => { r[k] = s[k].slice(); }); return r; });

// barycentre reorder of every column from the neighbours' centres in `res`, ties by colour then authored order
function ucReorder(m, res) {
  const cy = (id) => (res.y[id] === undefined ? undefined : res.y[id] + m.sz[id].anchor);
  const out = ucCloneOrders(res.orders);
  m.subj.forEach((sj) => {
    if (sj.collapsed) return;
    sj.ranks.forEach((r) => {
      const col = out[sj.i][r];
      const key = (id) => {
        const u = m.unit[id], w = ucWant(m, u, cy);
        return w ? w.d + u.H / 2 : res.y[id] + u.H / 2;
      };
      const colr = (id) => { const c = m.caseBy[id]; return c.color != null && m.colorRank[c.color] !== undefined ? m.colorRank[c.color] : 99; };
      out[sj.i][r] = col.map((id, i) => ({ id, k: Math.round(key(id) / UC.BUCKET), c: colr(id), a: m.cIdx[id], i }))
        .sort((p, q) => p.k - q.k || p.c - q.c || p.a - q.a).map((p) => p.id);
    });
  });
  return out;
}

function ucArrange(m) {
  ucUnits(m);
  const orders = m.subj.map((sj) => {
    const o = {};
    sj.ranks.forEach((r) => { o[r] = sj.rankCases[r].filter((c) => m.unitOf[c.id] === c.id).map((c) => c.id); });
    return o;
  });
  let cur = ucArrangeOnce(m, orders, null), best = cur;
  for (let i = 0; i < UC.SWEEPS; i++) {
    cur = ucArrangeOnce(m, ucReorder(m, cur), cur.actorOrder);
    if (cur.cost < best.cost - 1e-9) best = cur;
  }
  // adjacent swaps while the cost drops
  for (let pass = 0; pass < UC.SWAP_PASSES; pass++) {
    let improved = false;
    m.subj.forEach((sj) => sj.collapsed || sj.ranks.forEach((r) => {
      for (let i = 0; i + 1 < best.orders[sj.i][r].length; i++) {
        const o = ucCloneOrders(best.orders), col = o[sj.i][r];
        [col[i], col[i + 1]] = [col[i + 1], col[i]];
        const t = ucArrangeOnce(m, o, best.actorOrder, true);
        if (t.cost < best.cost - 1e-9) { best = t; improved = true; }
      }
    }));
    ['left', 'right'].forEach((side) => {
      for (let i = 0; i + 1 < best.actorOrder[side].length; i++) {
        const ao = { left: best.actorOrder.left.slice(), right: best.actorOrder.right.slice() }, col = ao[side];
        [col[i], col[i + 1]] = [col[i + 1], col[i]];
        const t = ucArrangeOnce(m, best.orders, ao, true);
        if (t.cost < best.cost - 1e-9) { best = t; improved = true; }
      }
    });
    if (!improved) break;
  }
  m.final = best;
  m.actors.forEach((a) => { a.y = best.y[a.id]; });
  m.cases.forEach((c) => { c.y = best.y[c.id]; });
}

// ---------- subject boxes, lines, labels, canvas ----------

function ucSubjects(m) {
  const vis = m.subj.filter((sj) => !sj.collapsed && sj.cases.length);
  const hid = m.cases.filter((c) => m.hidden[c.id]);
  const titleMin = Math.max(0, ...m.subj.map((sj) => ucTextW(sj.s.name, UC.TITLE_W) + UC.TITLE_PAD_X));
  let L, R;
  if (vis.length) {
    const cs = [].concat(...vis.map((sj) => sj.cases));
    L = Math.min(...cs.map((c) => c.x)) - UC.PAD_X; R = Math.max(...cs.map((c) => c.x + c.w)) + UC.PAD_X;
    if (R - L < titleMin) { const g = (titleMin - (R - L)) / 2; L -= g; R += g; }
  } else if (hid.length) { L = Math.min(...hid.map((c) => c.x)); R = L + titleMin; }
  else {
    let lw = 0;
    m.actors.forEach((a) => { if (m.side[a.id] === 'left') lw = Math.max(lw, a.w); });
    L = lw ? UC.MARGIN + lw + UC.ACTOR_GAP : UC.MARGIN; R = L + titleMin;
  }
  L = Math.round(L * 10) / 10; R = Math.round(R * 10) / 10;
  let prev = null;
  m.bars = [];
  m.subj.forEach((sj) => {
    const s = sj.s, ys = sj.cases.map((c) => c.y), top0 = prev === null ? UC.MARGIN : prev + UC.SUBJ_GAP;
    s.x = L; s.w = R - L; s._titleH = UC.TITLE_H;
    const own = sj.cases.filter((c) => !m.hidden[c.id]);
    if (sj.collapsed) {
      s.y = ys.length ? Math.round((ys[0] - UC.TITLE_H / 2) * 10) / 10 : top0; s.h = UC.TITLE_H;
    } else if (own.length) {
      const t = Math.min(...own.map((c) => c.y)), b = Math.max(...own.map((c) => c.y + c.h));
      s.y = t - UC.PAD_Y - UC.TITLE_H; s.h = b - t + 2 * UC.PAD_Y + UC.TITLE_H;
    } else { s.y = top0; s.h = UC.TITLE_H + 2 * UC.PAD_Y + UC.EMPTY_BODY; }
    m.bars[sj.i] = { x: s.x, y: s.y, w: s.w, h: UC.TITLE_H };
    prev = s.y + s.h;
  });
  m.cases.forEach((c) => { if (m.hidden[c.id]) { c.x = L; c.y = m.bars[m.si[c.id]].y + UC.TITLE_H / 2; } });
}

function ucOverlapRect(a, b, pad) { return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad; }
function ucRectEllipse(r, e, pad) {
  const nx = Math.max(r.x, Math.min(e.cx, r.x + r.w)), ny = Math.max(r.y, Math.min(e.cy, r.y + r.h));
  const dx = (nx - e.cx) / (e.a + pad), dy = (ny - e.cy) / (e.b + pad);
  return dx * dx + dy * dy < 1;
}

function ucLines(m) {
  const items = {};
  m.actors.concat(m.cases).forEach((x) => { items[x.id] = ucItem(m, x.id); });
  const ellipses = m.cases.filter((c) => !m.hidden[c.id]).map((c) => items[c.id]);
  const obstacles = (a, b) => ({ ell: ellipses.filter((e) => e.id !== a && e.id !== b), rects: m.actors.filter((x) => x.id !== a && x.id !== b).map((x) => ({ x: x.x, y: x.y, w: x.w, h: x.h })) });
  const hitsOf = (pts, ob) => {
    const poly = ucPolyline(pts);
    let n = 0;
    for (let i = 0; i + 1 < poly.length; i++) {
      ob.ell.forEach((e) => { if (ucSegEllipse(poly[i], poly[i + 1], e, UC.CLEAR)) n++; });
      ob.rects.forEach((r) => { if (ucSegRect(poly[i], poly[i + 1], r)) n++; });
    }
    return n;
  };
  // straight, else the gentlest curve that clears every other ellipse and actor
  const route = (A, B, parent) => {
    const mx = (A.cx + B.cx) / 2, my = (A.cy + B.cy) / 2;
    const dx = B.cx - A.cx, dy = B.cy - A.cy, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    const ob = obstacles(A.id, B.id);
    let best = null;
    for (const off of UC.CURVE_OFFS) {
      let pts;
      if (!off) pts = [ucClip(A, B.cx, B.cy, parent), ucClip(B, A.cx, A.cy, true)];
      else {
        const c = [mx + nx * off, my + ny * off];
        pts = [ucClip(A, c[0], c[1], parent), c, ucClip(B, c[0], c[1], true)];
      }
      const h = hitsOf(pts, ob);
      if (!best || h < best.h) best = { pts, h };
      if (!h) break;
    }
    return best;
  };
  let hits = 0;
  const placed = [];
  m.links.forEach((l) => {
    const A = items[l.from], B = items[l.to];
    delete l.labelBox; delete l._hidden;
    if (!A || !B || (A.kind === 'bar' && B.kind === 'bar' && m.si[l.from] === m.si[l.to]) || l.from === l.to) { l.points = []; l._hidden = true; return; }
    const r = route(A, B, false);
    hits += r.h;
    l.points = r.pts.map((p) => [ucR1(p[0]), ucR1(p[1])]);
  });
  // labels: on the line at the middle, slid along it and then off it until nothing is covered
  const fixed = m.actors.map((a) => ({ x: a.x, y: a.y, w: a.w, h: a.h }));
  m.links.forEach((l) => {
    if ((l.type !== 'include' && l.type !== 'extend') || !l.points.length) return;
    const t = ucLabelLines(l), pts = l.points;
    const at = (u) => (pts.length === 3 ? ucQuad(pts[0], pts[1], pts[2], u) : [pts[0][0] + (pts[1][0] - pts[0][0]) * u, pts[0][1] + (pts[1][1] - pts[0][1]) * u]);
    const score = (u, off) => {
      const p = at(u);
      const d = pts.length === 3 ? ucQuad(pts[0], pts[1], pts[2], Math.min(1, u + 0.02)) : pts[1];
      const e = pts.length === 3 ? ucQuad(pts[0], pts[1], pts[2], Math.max(0, u - 0.02)) : pts[0];
      const tx = d[0] - e[0], ty = d[1] - e[1], tl = Math.hypot(tx, ty) || 1;
      const box = { x: Math.round(p[0] - t.w / 2 - (ty / tl) * off), y: Math.round(p[1] - t.h / 2 + (tx / tl) * off), w: t.w, h: t.h };
      let s = 0;
      ellipses.forEach((el) => { if (ucRectEllipse(box, el, 2)) s += 4; });
      placed.forEach((o) => { if (ucOverlapRect(box, o, 2)) s += 6; });
      fixed.forEach((o) => { if (ucOverlapRect(box, o, 0)) s += 4; });
      return { box, s: s + Math.abs(off) * 0.02 + Math.abs(u - 0.5) * 0.5 };
    };
    let best = null;
    const tries = [];
    [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7, 0.25, 0.75].forEach((u) => tries.push([u, 0]));
    [0.3, 0.55, 0.8, 1.2, 1.8].forEach((k) => [1, -1].forEach((sg) => [0.5, 0.4, 0.6, 0.3, 0.7].forEach((u) => tries.push([u, sg * t.h * k]))));
    for (const [u, off] of tries) {
      const r = score(u, off);
      if (!best || r.s < best.s) best = r;
      if (r.s < 0.6 && !off) break;
    }
    l.labelBox = best.box;
    placed.push(best.box);
  });
  // generalization lines
  const parents = [];
  m.actors.forEach((a) => {
    if (!a.parent || !items[a.parent] || a.parent === a.id) return;
    const c = items[a.id], p = items[a.parent];
    const pts = [ucClip(c, p.cx, p.cy, false), ucClip(p, c.cx, c.cy, true)];
    parents.push({ from: a.id, to: a.parent, kind: 'actor', points: pts.map((q) => [ucR1(q[0]), ucR1(q[1])]) });
  });
  m.cases.forEach((c) => {
    if (!c.parent || !items[c.parent] || c.parent === c.id) return;
    const a = items[c.id], p = items[c.parent];
    if (a.kind === 'bar' && p.kind === 'bar' && m.si[c.id] === m.si[c.parent]) return;
    const pts = [ucClip(a, p.cx, p.cy, true), ucClip(p, a.cx, a.cy, true)];
    parents.push({ from: c.id, to: c.parent, kind: 'useCase', points: pts.map((q) => [ucR1(q[0]), ucR1(q[1])]) });
  });
  m.data._parents = parents;
  m.hits = hits;
}

function ucCanvas(m) {
  let w = 0, h = 0;
  const grow = (x, y) => { w = Math.max(w, x); h = Math.max(h, y); };
  m.actors.forEach((a) => grow(a.x + a.w, a.y + a.h));
  m.cases.forEach((c) => { if (!m.hidden[c.id]) grow(c.x + c.w, c.y + c.h); });
  m.subj.forEach((sj) => grow(sj.s.x + sj.s.w, sj.s.y + sj.s.h));
  m.links.forEach((l) => { if (l.labelBox) grow(l.labelBox.x + l.labelBox.w, l.labelBox.y + l.labelBox.h); });
  // crossings of the drawn lines
  const polys = m.links.filter((l) => l.points && l.points.length).map((l) => ({ l, p: ucPolyline(l.points) }));
  let cross = 0;
  for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) {
    const a = polys[i].l, b = polys[j].l;
    if (a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to) continue;
    let hit = false;
    for (let s = 0; s + 1 < polys[i].p.length && !hit; s++) for (let t = 0; t + 1 < polys[j].p.length && !hit; t++) hit = ucSegCross(polys[i].p[s], polys[i].p[s + 1], polys[j].p[t], polys[j].p[t + 1]);
    if (hit) cross++;
  }
  m.data.canvas = { width: Math.ceil(w + UC.MARGIN), height: Math.ceil(h + UC.MARGIN), crossings: cross, hits: m.hits };
}

function ucFinish(m) {
  ucSubjects(m);
  ucLines(m);
  ucCanvas(m);
}

function ucPrepare(data) {
  const m = ucModel(data);
  ucSizes(m);
  ucRanks(m);
  return m;
}

function layoutDiagram(data) {
  const m = ucPrepare(data);
  ucColumns(m);
  ucArrange(m);
  ucFinish(m);
  return data;
}

function routeDiagram(data) {
  const m = ucPrepare(data);
  const num = (v) => typeof v === 'number' && isFinite(v);
  if (m.actors.concat(m.cases).some((x) => !num(x.x) || !num(x.y))) return layoutDiagram(data);
  m.final = null;
  ucFinish(m);
  return data;
}
