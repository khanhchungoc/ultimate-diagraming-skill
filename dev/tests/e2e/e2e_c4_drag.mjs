// Moving boxes in the C4 page (phase 5): Auto-Tidy at load, the first drag (threshold, follow, arrows fade, layout map pinned,
// status line, re-route on release, one undo step, redo), dragging an element inside a group, a group by its tag (nested and
// collapsed members follow), a multi-selection, reparenting (join a frame, leave every frame, nest a group, refuse a group
// onto its own descendant), Esc cancelling, pinned semantics (the dropped item stays, the others shift, no overlaps), edits in
// manual mode that keep positions (add, connect, delete, ungroup, collapse, expand), Tidy back to Auto-Tidy, Save (the layout
// map only in manual mode, the Python codec's bytes, a reload opens in manual mode), Alt+arrow keys, ?present, reduced motion,
// touch (drag moves, empty canvas pans) and the release time on a 500-element diagram.
// Real mouse, keyboard and touch input over the Chrome DevTools Protocol (see cdp.mjs). The contract is "Moving boxes (phase 5)"
// and "Editing (phase 4)" in dev/plans/plan-c4.md; selectors the contract does not pin are in SELECTORS below, one line each.
//   node dev/e2e_c4_drag.mjs --browser <chrome> [--page <assembled c4 page of the DIAGRAM below>]
// Without --page the test lays out its own small diagram with `scripts/layout_engine.py --layout` into a temp folder (the
// layout map that step writes is stripped for the Auto-Tidy cases and kept for the manual-mode cases).
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser');
if (!browser) { console.error('usage: --browser <chrome> [--page <page.html>]'); process.exit(1); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const work = mkdtempSync(join(tmpdir(), 'e2e_c4_drag_'));

// Selectors the plan does not pin (a guess each; change here when the page names them differently)
const SELECTORS = {
  node: '.c4-node',                                   // an element tile (data-node-id)
  frame: '.c4-group.is-frame',                        // an open group (data-group-id)
  tile: '.c4-group.is-tile',                          // a collapsed group
  tagName: '.c4-tag-name',                            // the title text in a frame tag: the grip for dragging a group
  chevron: '.frame-chev',                             // collapse / expand button
  edge: '.c4-edge',                                   // an arrow (g, data-edge-id)
  edgePath: '.edge-hit',                              // its path (geometry only is read)
  edgeLine: '.edge-line',                             // the visible stroke (opacity is read)
  label: '.edge-label.c4-label',                      // a label pill (data-edge-id)
  name: '.c4-name',
  canvas: '#c4-canvas',                               // origin of diagram coordinates
  bar: '.c4-actionbar',
  statusRegions: '[role="status"], [aria-live], .toast',   // where "Manual layout on" may be announced (body text is read too)
  tidy: '#btn-auto-tidy',                             // the Tidy button
  undo: '#btn-undo',
  redo: '#btn-redo',
  fit: '#btn-zoom-reset',
  stage: '#viewport',
  toast: '.toast',
  confirm: '.confirm',
  stageContent: '#stage'                              // the transformed camera layer (touch pan)
};
const A = SELECTORS;

const DIAGRAM = {
  diagramType: 'c4', schemaVersion: 1, title: 'Drag',
  groups: [
    { id: 'platform', name: 'Platform', kind: 'system' },
    { id: 'services', name: 'Services', kind: 'boundary' },
    { id: 'inner', name: 'Inner', kind: 'boundary', parent: 'platform' },
    { id: 'legacy', name: 'Legacy', kind: 'system', parent: 'platform', collapsed: true }
  ],
  elements: [
    { id: 'api', kind: 'container', name: 'Web API', tech: 'Node', group: 'platform' },
    { id: 'db', kind: 'database', name: 'Order Store', group: 'platform' },
    { id: 'q', kind: 'queue', name: 'Events', group: 'platform' },
    { id: 'ia', kind: 'container', name: 'Inner App', tech: 'Go', group: 'inner' },
    { id: 'w1', kind: 'container', name: 'Worker', tech: 'Go', group: 'services' },
    { id: 'w2', kind: 'container', name: 'Cron', tech: 'Go', group: 'services' },
    { id: 'cust', kind: 'person', name: 'Customer' },
    { id: 'mail', kind: 'external', name: 'Mail Gateway' },
    { id: 'l1', kind: 'container', name: 'Old A', tech: 'Java', group: 'legacy' },
    { id: 'l2', kind: 'container', name: 'Old B', tech: 'Java', group: 'legacy' }
  ],
  relations: [
    { from: 'cust', to: 'api', label: 'Orders', tech: 'HTTPS' },
    { from: 'api', to: 'db', label: 'Reads' },
    { from: 'db', to: 'q', label: 'Publishes' },
    { from: 'q', to: 'w1', label: 'Feeds', tech: 'AMQP' },
    { from: 'w1', to: 'w2', label: 'Triggers', tech: 'REST' },
    { from: 'w2', to: 'mail', label: 'Sends mail' },
    { from: 'cust', to: 'mail', label: 'Gets mail' },
    { from: 'db', to: 'ia', label: 'Delegates', tech: 'gRPC' },
    { from: 'api', to: 'l1', label: 'Calls', tech: 'REST' },
    { from: 'l1', to: 'l2', label: 'Syncs', tech: 'REST' }
  ]
};
const ELEMENT_IDS = DIAGRAM.elements.map((e) => e.id);
const HIDDEN = ['l1', 'l2'];                       // members of the collapsed group
const COLLAPSED = ['legacy'];
const PLATFORM_BOXES = ['api', 'db', 'q', 'ia', 'l1', 'l2', 'legacy'];   // what moves with the group Platform (frames derive)

const DATA_RE = /(<script id="diagram-data" type="application\/json">)([\s\S]*?)(<\/script>)/;
const blockOf = (html) => JSON.parse(html.match(DATA_RE)[2]);
const withBlock = (html, obj) => html.replace(DATA_RE, (m, a, b) => a + (typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)) + '</script>');
const layoutPage = (model, name, keepLayout = false) => {
  const src = join(work, `${name}.json`), out = join(work, `${name}.html`);
  writeFileSync(src, JSON.stringify(model));
  const args = [join(root, 'scripts', 'layout_engine.py'), '--layout', src, ...(keepLayout ? ['--keep-layout'] : []), '-o', out];
  const r = spawnSync('python3', args, { encoding: 'utf8' });
  if (r.status !== 0) { console.error(`[ERROR] could not lay out ${name}:`, r.stdout, r.stderr); process.exit(1); }
  return out;
};

// auto: page with no layout map (Auto-Tidy at load); kept: page with its laid-out positions in `layout` (manual mode at load)
const autoPage = layoutPage(DIAGRAM, 'auto');
const keptModel = (() => {
  const tok = JSON.parse(spawnSync('python3', ['-c', 'import json,sys;sys.path.insert(0,"scripts");import tokens;print(json.dumps(tokens.tokens_data(tokens.load_tokens())))'], { cwd: root, encoding: 'utf8' }).stdout);
  const r = spawnSync('node', [join(root, 'scripts', 'run_engine.mjs'), join(root, 'assets', 'types', 'c4', 'engine.js')], {
    input: JSON.stringify({ tokens: tok, diagram: JSON.parse(JSON.stringify(DIAGRAM)) }), encoding: 'utf8'
  });
  if (r.status !== 0) { console.error('[ERROR] could not pre-layout kept:', r.stderr); process.exit(1); }
  const laid = JSON.parse(r.stdout);
  const layout = {};
  for (const e of laid.elements || []) if (Number.isFinite(e.x) && Number.isFinite(e.y)) layout[e.id] = { x: e.x, y: e.y };
  for (const g of laid.groups || []) if (g.collapsed === true && Number.isFinite(g.x) && Number.isFinite(g.y)) layout[g.id] = { x: g.x, y: g.y };
  return { ...DIAGRAM, layout };
})();
const keptPage = argOf('page') || layoutPage(keptModel, 'kept', true);
const keptHtml = readFileSync(keptPage, 'utf8');
const KEPT = blockOf(keptHtml);
// shifted: a saved layout map that differs from the tidy one (Customer far right, Mail Gateway lower)
const SHIFT = { cust: { dx: 520, dy: 0 }, mail: { dx: 0, dy: 140 } };
const shiftedPage = join(work, 'shifted.html');
let shiftedLayout = null;
if (KEPT.layout) {
  shiftedLayout = JSON.parse(JSON.stringify(KEPT.layout));
  for (const [id, s] of Object.entries(SHIFT)) if (shiftedLayout[id]) { shiftedLayout[id].x += s.dx; shiftedLayout[id].y += s.dy; }
  writeFileSync(shiftedPage, withBlock(keptHtml, { ...KEPT, layout: shiftedLayout }));
}
// big: 500 elements in 24 groups plus loose ones
const BIG = { diagramType: 'c4', schemaVersion: 1, title: 'Big', groups: [], elements: [], relations: [] };
for (let g = 0; g < 24; g++) {
  BIG.groups.push({ id: `g${g}`, name: `Group ${g}`, kind: 'boundary' });
  for (let i = 0; i < 20; i++) {
    BIG.elements.push({ id: `e${g}_${i}`, kind: 'container', name: `Svc ${g}.${i}`, tech: 'Go', group: `g${g}` });
    if (i) BIG.relations.push({ from: `e${g}_${i - 1}`, to: `e${g}_${i}`, label: `calls ${g}.${i}`, tech: 'REST' });
  }
  if (g) BIG.relations.push({ from: `e${g - 1}_0`, to: `e${g}_0`, label: `links ${g}`, tech: 'REST' });
}
for (let i = 0; i < 20; i++) BIG.elements.push({ id: `x${i}`, kind: 'external', name: `Ext ${i}` });

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
const errs = [];
try {
  const J = JSON.stringify;
  const count = (sel) => t.ev(`document.querySelectorAll(${J(sel)}).length`);
  const present = (sel) => t.ev(`!!document.querySelector(${J(sel)})`);
  const item = (id) => `[data-node-id="${id}"], .c4-group.is-tile[data-group-id="${id}"]`;
  const grp = (id) => `[data-group-id="${id}"]`;
  const WAAPI = `document.getAnimations().filter((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation)).length`;
  const GHOSTS = `document.querySelectorAll('[data-motion-ghost]').length`;

  // --- helpers that live in the page: boxes, arrow crossings, free spots ---------------------------------------
  const HELP = `window.__e2e = {
    R(e) { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; },
    boxes() {
      const c = document.querySelector(${J(A.canvas)}).getBoundingClientRect();
      const o = { origin: { x: c.left, y: c.top }, tiles: {}, frames: {} };
      document.querySelectorAll(${J(A.node)}).forEach((e) => { o.tiles[e.dataset.nodeId] = this.R(e); });
      document.querySelectorAll(${J(A.tile)}).forEach((e) => { o.tiles[e.dataset.groupId] = this.R(e); });
      document.querySelectorAll(${J(A.frame)}).forEach((e) => { o.frames[e.dataset.groupId] = this.R(e); });
      return o;
    },
    rel() {   // the same, relative to the canvas origin (a camera move or a pan does not change it)
      const b = this.boxes(), f = (r) => ({ l: r.l - b.origin.x, t: r.t - b.origin.y, r: r.r - b.origin.x, b: r.b - b.origin.y });
      const out = { tiles: {}, frames: {} };
      for (const k in b.tiles) out.tiles[k] = f(b.tiles[k]);
      for (const k in b.frames) out.frames[k] = f(b.frames[k]);
      return out;
    },
    crossings() {   // arrows that pass through a tile they do not end on
      const b = this.boxes(), bad = [];
      document.querySelectorAll(${J(A.edge)}).forEach((g) => {
        const p = g.querySelector(${J(A.edgePath)}); if (!p) return;
        const L = p.getTotalLength(), m = p.getScreenCTM(); if (!L || !m) return;
        const pts = []; for (let i = 0; i <= 48; i++) { const q = p.getPointAtLength(L * i / 48); pts.push({ x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f }); }
        const ends = [pts[0], pts[48]];
        for (const id in b.tiles) {
          const r = b.tiles[id];
          if (ends.some((e) => e.x > r.l - 12 && e.x < r.r + 12 && e.y > r.t - 12 && e.y < r.b + 12)) continue;
          if (pts.some((q) => q.x > r.l + 3 && q.x < r.r - 3 && q.y > r.t + 3 && q.y < r.b - 3)) bad.push((g.dataset.edgeId || '?') + '>' + id);
        }
      });
      return bad;
    },
    edgeIdByLabel(txt) { const l = [...document.querySelectorAll(${J(A.label)})].find((e) => e.textContent.includes(txt)); return l ? l.dataset.edgeId : null; },
    opacity(id) {   // the lowest opacity among an arrow's group, its stroke and its label
      const g = document.querySelector(${J(A.edge)} + '[data-edge-id="' + id + '"]'), l = document.querySelector(${J(A.label)} + '[data-edge-id="' + id + '"]');
      const o = [g, g && g.querySelector(${J(A.edgeLine)}), l].filter(Boolean).map((e) => +getComputedStyle(e).opacity);
      return o.length ? Math.min(...o) : null;
    },
    frameClasses() { const o = {}; document.querySelectorAll(${J(A.frame)}).forEach((e) => { o[e.dataset.groupId] = e.getAttribute('class') + ' | ' + (e.firstElementChild ? e.firstElementChild.getAttribute('class') || '' : ''); }); return o; },
    freeSpot(tx, ty, clear) {   // the free canvas point nearest (tx, ty): clear of every tile, frame, arrow and overlay
      const b = this.boxes(), all = Object.values(b.tiles).concat(Object.values(b.frames));
      const vp = document.querySelector(${J(A.stage)}).getBoundingClientRect();
      let best = null;
      for (let x = vp.left + 120; x < vp.right - 120; x += 20) for (let y = vp.top + 140; y < vp.bottom - 140; y += 20) {
        if (all.some((r) => x > r.l - clear && x < r.r + clear && y > r.t - clear && y < r.b + clear)) continue;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !hit.closest(${J(A.stage)}) || hit.closest('.c4-node, .c4-group, .c4-edge, .edge-label, .note, .c4-actionbar')) continue;
        const d = Math.hypot(x - tx, y - ty);
        if (!best || d < best.d) best = { x, y, d };
      }
      return best;
    }
  }; true`;

  // The disk model, read after a save (chartData lives in the page's closure)
  const saved = () => t.saved();
  const rawSaved = () => t.saved({ raw: true });
  const layoutOf = async () => (await saved()).layout || null;
  const isAuto = async () => { const l = (await saved()).layout; return !l || Object.keys(l).length === 0; };
  const undoOff = () => t.ev(`document.querySelector(${J(A.undo)}).disabled`);
  const redoOff = () => t.ev(`document.querySelector(${J(A.redo)}).disabled`);
  const settleAll = async () => { await t.settle(1500); };
  const undo = async () => { await t.press('z', { modifiers: 2 }); await t.settle(1500); };
  const redo = async () => { await t.press('y', { modifiers: 2 }); await t.settle(1500); };
  const blank = async () => { await t.press('Escape'); await t.press('Escape'); await sleep(40); };
  const fit = async () => { await t.clickOn(A.fit); await t.settle(); };
  const freshPage = async (file = autoPage, query = '', opts = {}) => {
    errs.push(...t.errors);
    await t.open(file, query, opts);
    await t.ev(HELP);
    await fit();
  };
  const rel = () => t.ev(`__e2e.rel()`);
  const crossings = () => t.ev(`__e2e.crossings()`);
  const selectedIds = () => t.ev(`[...document.querySelectorAll('.c4-node.selected, .c4-group.selected')].map((e) => e.dataset.nodeId || e.dataset.groupId).sort().join(',')`);
  const centre = (r) => ({ x: (r.l + r.r) / 2, y: (r.t + r.b) / 2 });
  const close = (a, b, tol) => Math.abs(a - b) <= tol;
  // The engine trims the canvas on release ("shifts the whole picture"), so a box is compared after taking out the shift
  // every unmoved box shares (the median over the boxes not in `skip`).
  const med = (xs) => (xs.length ? [...xs].sort((p, q) => p - q)[xs.length >> 1] : 0);
  const shiftOf = (a, b, skip = []) => {
    const ids = Object.keys(a.tiles).filter((id) => !skip.includes(id) && b.tiles[id]);
    return { x: med(ids.map((id) => b.tiles[id].l - a.tiles[id].l)), y: med(ids.map((id) => b.tiles[id].t - a.tiles[id].t)) };
  };
  // how far a tile's centre moved, minus that shared shift (skip: boxes that moved on purpose)
  const dl = (a, b, id, skip = []) => {
    const s = shiftOf(a, b, [...skip, id]), ca = centre(a.tiles[id]), cb = centre(b.tiles[id]);
    return { x: cb.x - ca.x - s.x, y: cb.y - ca.y - s.y };
  };
  // ids whose box differs by more than tol between two rel() snapshots (after the shared shift); skip: ignored
  const moved = (a, b, tol = 2, skip = []) => {
    const out = [], s = shiftOf(a, b, skip);
    for (const kind of ['tiles', 'frames']) for (const id of Object.keys(a[kind])) {
      if (skip.includes(id) || !b[kind][id]) continue;
      const p = a[kind][id], q = b[kind][id];
      if (!(close(q.l - p.l, s.x, tol) && close(q.t - p.t, s.y, tol) && close(q.r - p.r, s.x, tol) && close(q.b - p.b, s.y, tol))) out.push(id);
    }
    return out;
  };
  const sameIds = (a, b) => J(Object.keys(a.tiles).sort()) === J(Object.keys(b.tiles).sort()) && J(Object.keys(a.frames).sort()) === J(Object.keys(b.frames).sort());
  const layoutMoved = (a, b, skip = [], tol = 0.5) => {   // ids whose saved position changed (after the shared shift)
    const ids = Object.keys(a).filter((id) => !skip.includes(id) && b[id]), sx = med(ids.map((id) => b[id].x - a[id].x)), sy = med(ids.map((id) => b[id].y - a[id].y));
    return ids.filter((id) => !(close(b[id].x - a[id].x, sx, tol) && close(b[id].y - a[id].y, sy, tol)));
  };
  const groupChain = (d, id) => {   // an element or group id -> the set of its ancestor group ids
    const gp = Object.fromEntries((d.groups || []).map((g) => [g.id, g.parent])), el = Object.fromEntries((d.elements || []).map((e) => [e.id, e.group]));
    const out = new Set(); let cur = id in el ? el[id] : gp[id];
    while (cur && !out.has(cur)) { out.add(cur); cur = gp[cur]; }
    return out;
  };
  // No two boxes overlap, no frame overlaps a frame that is not nested with it, no box straddles a frame or sits in one it is not a member of
  const overlaps = async () => {
    const b = await t.ev(`__e2e.boxes()`), d = await saved(), bad = [];
    const hit = (a, c) => a.l < c.r - 2 && c.l < a.r - 2 && a.t < c.b - 2 && c.t < a.b - 2;
    const inside = (a, c) => a.l >= c.l - 2 && a.t >= c.t - 2 && a.r <= c.r + 2 && a.b <= c.b + 2;
    const tiles = Object.entries(b.tiles), frames = Object.entries(b.frames);
    const known = new Set([...(d.elements || []), ...(d.groups || [])].map((o) => o.id));
    for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) if (hit(tiles[i][1], tiles[j][1])) bad.push(`tile ${tiles[i][0]}/${tiles[j][0]}`);
    for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) {
      const a = frames[i][1], c = frames[j][1];
      if (hit(a, c) && !inside(a, c) && !inside(c, a)) bad.push(`frame ${frames[i][0]}/${frames[j][0]}`);
    }
    for (const [id, r] of tiles) for (const [gid, f] of frames) {
      if (!hit(r, f)) continue;
      if (!inside(r, f)) bad.push(`straddle ${id}/${gid}`);
      else if (known.has(id) && !groupChain(d, id).has(gid)) bad.push(`${id} sits in non-member ${gid}`);   // an id the page has not renamed yet is not in the saved model
    }
    return bad;
  };
  const clean = async (what) => {
    const o = await overlaps(), x = await crossings();
    t.check(`${what}: no box or frame overlaps, no arrow crosses a box it does not end on, no ghost, nothing animating`,
      !o.length && !x.length && (await t.ev(GHOSTS)) === 0 && (await t.ev(WAAPI)) === 0, J({ overlaps: o, crossings: x, ghosts: await t.ev(GHOSTS), waapi: await t.ev(WAAPI) }));
  };
  const statusSeen = async (re, ms = 1500) => {
    for (let i = 0; i < ms / 100; i++) {
      const txt = await t.ev(`[...document.querySelectorAll(${J(A.statusRegions)})].map((e) => e.textContent).join(' / ') + ' / ' + document.body.innerText`);
      if (re.test(txt)) return true;
      await sleep(100);
    }
    return false;
  };
  const clickName = async (id, opts) => { await t.clickOn(item(id), opts); await sleep(120); };
  const clickTag = async (gid, opts) => { await t.clickOn(`${grp(gid)} ${A.tagName}`, opts); await sleep(120); };
  const centreOf = async (id) => t.at(item(id));
  const tagOf = async (gid) => t.at(`${grp(gid)} ${A.tagName}`);
  // press, move in steps, optionally hold, release (the real pointer; a person's drag)
  const down = async (p, mods = 0) => { await t.mouse('mouseMoved', p.x, p.y, { modifiers: mods }); await t.mouse('mousePressed', p.x, p.y, { button: 'left', buttons: 1, clickCount: 1, modifiers: mods }); };
  const glide = async (p, q, steps = 8, mods = 0) => {
    for (let i = 1; i <= steps; i++) { await t.mouse('mouseMoved', p.x + (q.x - p.x) * i / steps, p.y + (q.y - p.y) * i / steps, { button: 'left', buttons: 1, modifiers: mods }); await sleep(15); }
  };
  const up = (q, mods = 0) => t.mouse('mouseReleased', q.x, q.y, { button: 'left', buttons: 0, clickCount: 1, modifiers: mods });
  const dragFull = async (p, q, { steps = 8, mods = 0 } = {}) => { await down(p, mods); await glide(p, q, steps, mods); await up(q, mods); await settleAll(); };
  const spotNear = async (p, clear = 70) => { const s = await t.ev(`__e2e.freeSpot(${p.x}, ${p.y}, ${clear})`); if (!s) throw new Error('no free canvas spot'); return s; };
  const section = (name, fn) => t.section(name, fn, () => { errs.push(...t.errors); t.errors.length = 0; });
  // dock, rename, connect (same helpers as dev/e2e_c4.mjs)
  const openAdd = async () => {
    const p = await t.at('#btn-add');
    await t.mouse('mouseMoved', p.x, p.y);
    await t.waitFor(`(() => { const pop = document.querySelector('#btn-add')?.closest('[data-dock-pop]')?.querySelector('.dock-pop'); return pop && pop.closest('.open') && getComputedStyle(pop).opacity === '1'; })()`);
  };
  const addNamed = async (kind, name) => {
    await openAdd(); await t.clickOn(`#btn-add-${kind}`); await t.settle();
    await t.press('a', { modifiers: 2 }); await t.type(name); await t.press('Enter'); await t.settle(1500);
  };
  const portOf = async (id) => {
    const r = await t.at(item(id));
    await t.mouse('mouseMoved', r.x, r.y);
    await sleep(120);
    return t.at(`${item(id).split(',')[0]} .c4-port`);
  };
  const clickAct = async (a) => { await t.clickOn(`${A.bar} [data-act="${a}"]`); await sleep(200); };

  // =========================================================================================================
  await section('load', async () => {
    await freshPage(autoPage);
    t.check('a diagram with no layout map opens in Auto-Tidy: nothing saved in a layout map, no undo step', (await isAuto()) && (await undoOff()), J(await layoutOf()));
    t.check('the page shows the 8 visible elements, 3 frames open (Platform with its nested Inner, Services), 1 collapsed tile', (await count(A.node)) === 8 && (await count(A.frame)) === 3 && (await count(A.tile)) === 1, `${await count(A.node)} ${await count(A.frame)} ${await count(A.tile)}`);
    await clean('Auto-Tidy at load');
    if (shiftedLayout) {
      await freshPage(shiftedPage);
      const d = await saved(), L = d.layout || {};
      t.check('a diagram with a saved layout map opens in manual mode: the same positions are written back, none dropped', !!d.layout && ELEMENT_IDS.every((id) => L[id] && close(L[id].x, shiftedLayout[id].x, 0.5) && close(L[id].y, shiftedLayout[id].y, 0.5)), J(L));
      // the tiles sit where the map says: tile left/top = s * x/y + offset, with one scale s for every element
      const b = await t.ev(`__e2e.boxes()`);
      const [a, c] = ['cust', 'mail'].map((id) => ({ id, ...b.tiles[id], x: shiftedLayout[id].x, y: shiftedLayout[id].y }));
      const sc = (a.l - c.l) / (a.x - c.x);
      const off = a.l - sc * a.x, offY = a.t - sc * a.y;
      const wrong = ELEMENT_IDS.filter((id) => b.tiles[id] && !(close(b.tiles[id].l, sc * shiftedLayout[id].x + off, 3) && close(b.tiles[id].t, sc * shiftedLayout[id].y + offY, 3)));
      t.check('the tiles are drawn at the saved positions (manual mode keeps them, no Auto-Tidy on load)', sc > 0 && !wrong.length, `scale ${sc}, off: ${wrong}`);
      await clean('the saved layout map at load');
      await t.clickOn(A.tidy); await settleAll();
      t.check('Tidy on such a diagram clears the layout map (Auto-Tidy again) and lays everything out afresh', await isAuto());
      const r1 = await rel(), r0 = (await freshPage(autoPage), await rel());
      t.check('the Tidy layout equals the Auto-Tidy layout of the same data', sameIds(r0, r1) && !moved(r0, r1, 3).length, J(moved(r0, r1, 3)));
    }
  });

  // --- the first drag --------------------------------------------------------------------------------------
  await section('click', async () => {
    await freshPage(autoPage);
    const r0 = await rel(), p = await centreOf('cust');
    await t.dragTo(p.x, p.y, p.x + 3, p.y, { steps: 1 });
    await settleAll();
    t.check('a 3px move is a click: Customer is selected, nothing moved, no layout map, no undo step',
      (await selectedIds()) === 'cust' && !moved(r0, await rel(), 1.5).length && (await isAuto()) && (await undoOff()), `${await selectedIds()} ${J(moved(r0, await rel(), 1.5))}`);
  });

  await section('first', async () => {
    await freshPage(autoPage);
    const r0 = await rel(), p = await centreOf('cust');
    const target = await spotNear({ x: p.x + 260, y: p.y + 90 });
    const dx = target.x - p.x, dy = target.y - p.y;
    await down(p);
    await glide(p, { x: p.x + 5, y: p.y }, 2);
    await sleep(120);
    const r5 = await rel();
    t.check('a 5px move starts the drag: the element has moved with the pointer', r5.tiles.cust.l - r0.tiles.cust.l >= 1, `${r5.tiles.cust.l - r0.tiles.cust.l}`);
    await glide({ x: p.x + 5, y: p.y }, target, 10);
    await sleep(450);
    const rm = await rel();
    { const m = dl(r0, rm, 'cust'); t.check('the dragged element follows the pointer (centre within 8px of it)', close(m.x, dx, 8) && close(m.y, dy, 8), J([m, dx, dy])); }
    const orders = await t.ev(`__e2e.edgeIdByLabel('Orders')`), reads = await t.ev(`__e2e.edgeIdByLabel('Reads')`), gets = await t.ev(`__e2e.edgeIdByLabel('Gets mail')`);
    const fadeO = await t.ev(`[__e2e.opacity(${J(orders)}), __e2e.opacity(${J(gets)}), __e2e.opacity(${J(reads)})]`);
    t.check('during the drag the arrows of the moved element fade out (they are not re-routed live)', fadeO[0] < 0.6 && fadeO[1] < 0.6, J(fadeO));
    t.check('other elements stay put while one is dragged', !moved(r0, rm, 2, ['cust']).length, J(moved(r0, rm, 2, ['cust'])));
    await up(target);
    await settleAll();
    const d = await saved(), L = d.layout || {};
    const need = [...ELEMENT_IDS, ...COLLAPSED];
    t.check('the first drag creates the layout map: every element and every collapsed group has a position', need.every((id) => L[id] && Number.isFinite(L[id].x) && Number.isFinite(L[id].y)), `missing ${need.filter((id) => !L[id])}`);
    t.check('the status line says manual layout is on', await statusSeen(/manual layout/i), 'no "Manual layout" text in a status region, toast or the body');
    const r1 = await rel();
    { const m = dl(r0, r1, 'cust'); t.check('release: the element stays where it was dropped', close(m.x, dx, 6) && close(m.y, dy, 6), J([m, dx, dy])); }
    t.check('release: every other box and frame kept the place Auto-Tidy gave it (the first drag pins the current positions)', !moved(r0, r1, 2, ['cust']).length, J(moved(r0, r1, 2, ['cust'])));
    t.check('release: the arrows are back (opacity 1)', (await t.ev(`__e2e.opacity(${J(orders)})`)) > 0.95);
    await clean('after the first drag');
    t.check('the drag made one undo step (undo is enabled)', !(await undoOff()));
    await undo();
    const r2 = await rel();
    t.check('one undo restores the old position and Auto-Tidy (the layout map is gone, undo is off again)', (await isAuto()) && (await undoOff()) && !moved(r0, r2, 2).length, J({ auto: await isAuto(), off: await undoOff(), moved: moved(r0, r2, 2) }));
    await redo();
    const r3 = await rel(), d3 = await saved();
    t.check('redo puts it back: manual mode, same place, same layout map', !!d3.layout && J(d3.layout) === J(d.layout) && !moved(r1, r3, 2).length && (await redoOff()), J(moved(r1, r3, 2)));
    await undo();
    t.check('and undo again returns to Auto-Tidy (the step is repeatable)', await isAuto());
  });

  // --- moving inside a group, a group, a selection -----------------------------------------------------------------
  await section('moves', async () => {
    // an element inside a group: the frame follows, the other members stay
    await freshPage(keptPage);
    let r0 = await rel(), L0 = await layoutOf();
    let p = await centreOf('db');
    // a delta that puts it on free ground (no other box within 30px), inside its frame when there is room
    const free = await t.ev(`(() => { const b = __e2e.boxes(), me = b.tiles.db, f = b.frames.platform; const all = Object.entries(b.tiles).filter(([k]) => k !== 'db').map(([, r]) => r);
      const cands = [[0, -90], [90, 0], [-90, 0], [0, 90], [70, 70], [-70, -70], [70, -70], [-70, 70], [0, 160], [160, 0]];
      const ok = (d, inFrame) => { const r = { l: me.l + d[0], t: me.t + d[1], r: me.r + d[0], b: me.b + d[1] };
        return !all.some((o) => r.l < o.r + 30 && o.l < r.r + 30 && r.t < o.b + 30 && o.t < r.b + 30) && (!inFrame || (r.l >= f.l && r.r <= f.r && r.t >= f.t && r.b <= f.b)); };
      return cands.find((d) => ok(d, true)) || cands.find((d) => ok(d, false)) || [0, 0]; })()`);
    let dx = free[0], dy = free[1];
    await dragFull(p, { x: p.x + dx, y: p.y + dy });
    let r1 = await rel(), L1 = await layoutOf();
    { const m = dl(r0, r1, 'db'); t.check('dragging Order Store (in Platform): it moves by the pointer delta', close(m.x, dx, 6) && close(m.y, dy, 6), J([m, dx, dy])); }
    t.check('the other members of the group keep their positions (the frame is derived and follows)', !layoutMoved(L0, L1, ['db', 'platform', 'inner', 'services']).filter((id) => ['api', 'q', 'ia', 'l1', 'l2', 'legacy'].includes(id)).length, J(layoutMoved(L0, L1, ['db'])));
    t.check('the frame still holds the moved member', r1.frames.platform.b >= r1.tiles.db.b - 2 && r1.frames.platform.t <= r0.frames.platform.t + 2, J([r1.frames.platform, r1.tiles.db]));
    t.check('the frame did not need to move with it, Platform keeps its group', (await saved()).elements.find((e) => e.id === 'db').group === 'platform');
    await clean('after moving a member');

    // a group by its tag: every descendant moves by the same delta, hidden members included
    await freshPage(keptPage);
    r0 = await rel(); L0 = await layoutOf();
    p = await tagOf('platform');
    dx = 200; dy = 240;
    const f0 = r0.frames.platform;
    await dragFull(p, { x: p.x + dx, y: p.y + dy });
    r1 = await rel(); L1 = await layoutOf();
    const deltas = PLATFORM_BOXES.map((id) => [L1[id].x - L0[id].x, L1[id].y - L0[id].y]);
    t.check('dragging the Platform tag moves every descendant of the group by one and the same delta (nested Inner App and the hidden Old A, Old B, and the collapsed Legacy tile)',
      deltas.every((d) => close(d[0], deltas[0][0], 0.5) && close(d[1], deltas[0][1], 0.5)) && deltas[0][0] > 0 && deltas[0][1] > 0, J(deltas));
    { const sh = shiftOf(r0, r1, PLATFORM_BOXES); t.check('the frame followed the pointer', close(r1.frames.platform.l - f0.l - sh.x, dx, 7) && close(r1.frames.platform.t - f0.t - sh.y, dy, 7), J([r1.frames.platform, f0, sh])); }
    t.check('the group kept its members and its parent', J((await saved()).elements.filter((e) => e.group === 'platform').map((e) => e.id).sort()) === J(['api', 'db', 'q']));
    await clean('after dragging a group');
    // open the collapsed child afterwards: it opens at the moved place
    const before = L1.l1;
    await t.clickOn(`${item('legacy')} ${A.chevron}`);
    await settleAll();
    const L2 = await layoutOf(), r2 = await rel();
    t.check('opening Legacy after the group moved puts Old A and Old B at the moved place (the saved positions)', close(L2.l1.x, before.x, 0.5) && close(L2.l1.y, before.y, 0.5) && !!r2.frames.legacy && r2.tiles.l1.l >= r2.frames.legacy.l - 2 && r2.frames.legacy.l >= r2.frames.platform.l - 2, J([before, L2.l1]));
    await clean('after opening the collapsed child');

    // a multi-selection moves together
    await freshPage(keptPage);
    r0 = await rel(); L0 = await layoutOf();
    await clickName('cust');
    await clickName('mail', { modifiers: 2 });
    t.check('Customer and Mail Gateway are both selected', (await selectedIds()) === 'cust,mail', await selectedIds());
    p = await centreOf('cust');
    const spot = await spotNear({ x: p.x + 90, y: p.y + 40 }, 90);
    dx = spot.x - p.x; dy = spot.y - p.y;
    await dragFull(p, spot);
    r1 = await rel();
    { const m = ['cust', 'mail'].map((id) => dl(r0, r1, id, ['cust', 'mail'])); t.check('dragging one of two selected elements moves both by the same delta', m.every((v) => close(v.x, dx, 7) && close(v.y, dy, 7)), J([m, dx, dy])); }
    await clean('after a multi-selection drag');
    await undo();
    t.check('one undo moves both back', !moved(r0, await rel(), 2).length && (await undoOff()), J(moved(r0, await rel(), 2)));
  });

  // --- reparent --------------------------------------------------------------------------------------------------
  await section('reparent', async () => {
    // an element dropped inside another group's frame joins it; the frame is highlighted while hovering
    await freshPage(keptPage);
    let r0 = await rel(), L0 = await layoutOf();
    let p = await centreOf('cust'), fr = r0.frames.services;
    const o = (await t.ev(`__e2e.boxes()`)).origin;
    let target = { x: o.x + centre(fr).x, y: o.y + centre(fr).y };
    const cls0 = await t.ev(`__e2e.frameClasses()`);
    await down(p); await glide(p, target, 10); await sleep(350);
    const cls1 = await t.ev(`__e2e.frameClasses()`);
    const added = (a, b) => b.split(/\s+/).filter((c) => c && !a.split(/\s+/).includes(c) && c !== 'selected');
    t.check('hovering over the Services frame with an element highlights it (a class appears on the frame)', added(cls0.services, cls1.services).length > 0 && !added(cls0.platform, cls1.platform).length, J([cls0.services, cls1.services]));
    await up(target); await settleAll();
    let d = await saved();
    t.check('dropping Customer inside the Services frame makes it a member (saved group field)', d.elements.find((e) => e.id === 'cust').group === 'services', J(d.elements.find((e) => e.id === 'cust')));
    t.check('the highlight is gone after the drop', !(await t.ev(`Object.values(__e2e.frameClasses()).some((c) => /target|drop|join|hl/.test(c))`)));
    await clean('after joining a group');
    await undo();
    d = await saved();
    t.check('one undo undoes the move and the membership together', d.elements.find((e) => e.id === 'cust').group === undefined && !moved(r0, await rel(), 2).length && (await undoOff()), J(d.elements.find((e) => e.id === 'cust')));

    // dropped outside every frame: leaves its group
    await freshPage(keptPage);
    r0 = await rel();
    p = await centreOf('w2');
    target = await spotNear({ x: p.x + 200, y: p.y }, 90);
    await dragFull(p, target);
    d = await saved();
    t.check('dropping Cron outside every frame removes it from Services', d.elements.find((e) => e.id === 'w2').group === undefined, J(d.elements.find((e) => e.id === 'w2')));
    await clean('after leaving a group');
    await undo();
    t.check('one undo puts it back in the group and in place', (await saved()).elements.find((e) => e.id === 'w2').group === 'services' && !moved(r0, await rel(), 2).length && (await undoOff()));

    // a group dropped onto another nests it
    await freshPage(keptPage);
    r0 = await rel();
    p = await tagOf('services');
    const ps = centre(r0.frames.platform), ss = centre(r0.frames.services);
    await dragFull(p, { x: p.x + ps.x - ss.x, y: p.y + ps.y - ss.y });
    d = await saved();
    const par = d.groups.find((g) => g.id === 'services').parent;
    t.check('dropping the group Services onto Platform nests it (its parent is Platform, or Inner inside it)', par === 'platform' || par === 'inner', `${par}`);
    await clean('after nesting a group');
    await undo();
    t.check('one undo un-nests it and moves it back', (await saved()).groups.find((g) => g.id === 'services').parent === undefined && !moved(r0, await rel(), 2).length && (await undoOff()));

    // a group onto its own descendant: refused, it returns
    await freshPage(keptPage);
    r0 = await rel();
    p = await tagOf('platform');
    const pc = centre(r0.frames.platform), ic = centre(r0.frames.inner);
    await dragFull(p, { x: p.x + ic.x - pc.x, y: p.y + ic.y - pc.y });
    d = await saved();
    t.check('dropping Platform onto its own descendant Inner is refused: no group changes parent', d.groups.find((g) => g.id === 'platform').parent === undefined && d.groups.find((g) => g.id === 'inner').parent === 'platform', J(d.groups));
    const r1 = await rel();
    t.check('the refused group returns to where it was, with no undo step', !moved(r0, r1, 2).length && (await undoOff()), J({ moved: moved(r0, r1, 2), off: await undoOff() }));
    // a small move of a group (its pointer ends inside itself) is only a move
    await dragFull(await tagOf('platform'), { x: p.x + 30, y: p.y });
    t.check('a group dropped onto itself only moves: still no parent', (await saved()).groups.find((g) => g.id === 'platform').parent === undefined);
  });

  // --- Esc cancels -----------------------------------------------------------------------------------------------
  await section('esc', async () => {
    await freshPage(autoPage);
    const r0 = await rel(), p = await centreOf('cust');
    await down(p); await glide(p, { x: p.x + 140, y: p.y + 60 }, 8); await sleep(200);
    await t.press('Escape');
    await sleep(150);
    await up({ x: p.x + 140, y: p.y + 60 });
    await settleAll();
    t.check('Esc during a drag cancels it: the element is back, Auto-Tidy stays, no undo step', !moved(r0, await rel(), 2).length && (await isAuto()) && (await undoOff()), J({ moved: moved(r0, await rel(), 2), off: await undoOff() }));
    await clean('after a cancelled drag');
    await freshPage(keptPage);
    const k0 = await rel(), q = await centreOf('db');
    await down(q); await glide(q, { x: q.x + 100, y: q.y + 80 }, 8); await sleep(150);
    await t.press('Escape'); await sleep(150);
    await up({ x: q.x + 100, y: q.y + 80 }); await settleAll();
    t.check('Esc cancels a drag in manual mode too (no move, no step)', !moved(k0, await rel(), 2).length && (await undoOff()));
  });

  // --- pinned semantics ------------------------------------------------------------------------------------------
  await section('pinned', async () => {
    await freshPage(keptPage);
    const r0 = await rel(), L0 = await layoutOf();
    const p = await centreOf('cust'), q = await centreOf('db');
    await dragFull(p, q);
    const r1 = await rel(), L1 = await layoutOf();
    { const m = dl(r0, r1, 'cust', ['db']); t.check('dropping Customer on the place of Order Store: the dropped element stays where it was dropped', close(m.x, q.x - p.x, 7) && close(m.y, q.y - p.y, 7), J([m, q.x - p.x, q.y - p.y])); }
    t.check('the element that was there is shifted away (the others give way)', !!L1.db && (!close(L1.db.x, L0.db.x, 0.5) || !close(L1.db.y, L0.db.y, 0.5)), J([L0.db, L1.db]));
    await clean('after dropping on an occupied place');
    // a group dropped over loose elements: the group stays, the loose elements shift
    await freshPage(keptPage);
    const s0 = await rel(), SL0 = await layoutOf();
    const tg = await tagOf('services'), m = await centreOf('mail');
    const mc = s0.frames.services, sc = centre(mc);
    const o = (await t.ev(`__e2e.boxes()`)).origin;
    await dragFull(tg, { x: tg.x + (o.x + centre(s0.tiles.mail).x - o.x - sc.x), y: tg.y + (centre(s0.tiles.mail).y - sc.y) });
    const s1 = await rel(), SL1 = await layoutOf();
    t.check('a group dropped on Mail Gateway keeps the place it was dropped and Mail Gateway gives way', !close(SL1.mail.x, SL0.mail.x, 0.5) || !close(SL1.mail.y, SL0.mail.y, 0.5), J([SL0.mail, SL1.mail]));
    await clean('after dropping a group on a loose element');
  });

  // --- edits in manual mode keep positions -------------------------------------------------------------------------
  await section('edits', async () => {
    const keep = async (what, L0, skip = []) => {
      const L1 = await layoutOf();
      const diff = layoutMoved(L0, L1, skip);
      t.check(`${what}: every untouched item keeps its position`, !!L1 && !diff.length, `moved: ${J(diff.map((id) => [id, L0[id], L1[id]]))}`);
      return L1;
    };
    // add a loose element
    await freshPage(keptPage);
    let L0 = await layoutOf();
    await addNamed('system', 'Ledger');
    await blank();
    let d = await saved();
    const led = d.elements.find((e) => e.name === 'Ledger');
    const L1 = await keep('adding an element', L0);
    t.check('the new element has a position of its own', !!led && !!L1[led.id], J(L1));
    await clean('after adding a loose element');
    // add an element to a selected group
    await freshPage(keptPage);
    L0 = await layoutOf();
    await clickTag('services');
    await addNamed('container', 'Billing');
    await blank();
    d = await saved();
    const bill = d.elements.find((e) => e.name === 'Billing');
    await keep('adding an element to the Services group', L0);
    t.check('the new element joined the selected group and sits inside its frame', bill && bill.group === 'services' && (await t.ev(`(() => { const b = __e2e.boxes(), n = [...document.querySelectorAll(${J(A.node)})].find((e) => e.querySelector(${J(A.name)}).textContent === 'Billing'), t = n && b.tiles[n.dataset.nodeId], f = b.frames.services; return !!t && !!f && t.l >= f.l - 2 && t.r <= f.r + 2 && t.t >= f.t - 2 && t.b <= f.b + 2; })()`)), J(bill));
    await clean('after adding to a group');
    // connect
    await freshPage(keptPage);
    L0 = await layoutOf();
    const pp = await portOf('cust'), qq = await centreOf('db');
    await t.dragTo(pp.x, pp.y, qq.x, qq.y, { steps: 8 });
    await sleep(250);
    if (await present('.c4-label-text.is-editing')) { await t.type('Browses'); await t.press('Enter'); await sleep(300); await t.settle(1500); }
    d = await saved();
    t.check('connect: the new relation exists', d.relations.some((r) => r.from === 'cust' && r.to === 'db' && r.label === 'Browses'), J(d.relations.length));
    await keep('connecting two elements', L0);
    await clean('after connect');
    // delete
    await freshPage(keptPage);
    L0 = await layoutOf();
    await clickName('mail');
    await t.press('Delete'); await sleep(300); await t.settle(1500);
    await keep('deleting an element', L0, ['mail']);
    t.check('the deleted element is gone from the map', !(await layoutOf()).mail);
    await clean('after delete');
    // ungroup
    await freshPage(keptPage);
    L0 = await layoutOf();
    await clickTag('services');
    await clickAct('ungroup');
    await settleAll();
    d = await saved();
    t.check('ungroup: Services is gone and its members are loose', !d.groups.some((g) => g.id === 'services') && d.elements.filter((e) => e.group === 'services').length === 0, J(d.groups.map((g) => g.id)));
    await keep('ungrouping', L0, ['services']);
    await clean('after ungroup');
    // collapse and expand
    await freshPage(keptPage);
    L0 = await layoutOf();
    await t.clickOn(`${grp('services')} ${A.chevron}`);
    await settleAll();
    t.check('collapse: Services became one tile', (await count(`${A.tile}[data-group-id="services"]`)) === 1);
    await keep('collapsing a group', L0, ['services', 'w1', 'w2']);
    await clean('after collapse');
    await t.clickOn(`${grp('services')} ${A.chevron}`);
    await settleAll();
    t.check('expand: the members are back at their saved places', !layoutMoved(L0, await layoutOf(), ['services']).length, J(layoutMoved(L0, await layoutOf(), ['services'])));
    await clean('after expand');
  });

  // --- Tidy ------------------------------------------------------------------------------------------------------
  await section('tidy', async () => {
    await freshPage(autoPage);
    const r0 = await rel();
    const p = await centreOf('cust'), spot = await spotNear({ x: p.x + 240, y: p.y + 80 });
    await dragFull(p, spot);
    t.check('after a drag the diagram is in manual mode', !(await isAuto()));
    await t.clickOn(A.tidy);
    await settleAll();
    t.check('Tidy clears the layout map and Auto-Tidy is back', await isAuto());
    const r1 = await rel();
    t.check('Tidy re-lays out every item: the picture equals the Auto-Tidy one', !moved(r0, r1, 3).length, J(moved(r0, r1, 3)));
    await clean('after Tidy');
    await undo();
    t.check('one undo of Tidy brings back the manual layout', !(await isAuto()) && moved(r0, await rel(), 3).includes('cust'), J(await layoutOf()));
  });

  // --- Save ------------------------------------------------------------------------------------------------------
  await section('save', async () => {
    await freshPage(autoPage);
    const noMap = await saved();
    t.check('Save in Auto-Tidy writes no layout map', !('layout' in noMap), J(noMap.layout));
    const p = await centreOf('cust'), spot = await spotNear({ x: p.x + 240, y: p.y + 80 });
    await dragFull(p, spot);
    const q = await centreOf('w1');
    await dragFull(q, { x: q.x + 60, y: q.y + 30 });
    const raw = await rawSaved();
    const got = JSON.parse(raw);
    const keys = Object.keys(got.layout || {});
    const elOrder = DIAGRAM.elements.map((e) => e.id);
    const grOrder = DIAGRAM.groups.map((g) => g.id);
    t.check('Save in manual mode writes the layout map: elements in model order, then groups in model order (the collapsed one among them)',
      J(keys.filter((k) => elOrder.includes(k))) === J(elOrder) && J(keys.slice(0, elOrder.length)) === J(elOrder) && keys.slice(elOrder.length).every((k) => grOrder.includes(k)) && keys.includes('legacy'), J(keys));
    const fileIn = join(work, 'saved.json');
    writeFileSync(fileIn, raw);
    const py = spawnSync('python3', ['-I', '-c', `
import json, sys
sys.path.insert(0, ${J(join(root, 'scripts'))})
from disk_format import to_disk, from_disk, format_json
raw = open(${J(fileIn)}).read()
got = json.loads(raw)
want = to_disk('c4', from_disk('c4', json.loads(raw)))
body = {k: v for k, v in got.items() if k != '_readme'}
same_data = format_json(want) == format_json(body)
same_bytes = raw.strip() == format_json(got)
print('SAME' if same_data and same_bytes else 'DIFF data=%s bytes=%s\\n%s' % (same_data, same_bytes, format_json(want)[:600]))`], { encoding: 'utf8' });
    t.check('the saved block is what to_disk("c4", ...) writes, byte for byte', py.stdout.trim() === 'SAME', py.stdout + py.stderr);
    // a reload of the saved page opens in manual mode with the same positions
    const reloaded = join(work, 'saved.html');
    writeFileSync(reloaded, withBlock(readFileSync(autoPage, 'utf8'), raw));
    const before = await rel();
    await freshPage(reloaded);
    const rawAgain = await rawSaved();
    t.check('reloading the saved page opens in manual mode: Save gives the same bytes again', rawAgain === raw, 'saved block differs after a reload');
    const after0 = await rel();
    // the fit zoom can differ after a reload (the canvas was trimmed): bring the picture to the old scale first
    const k = (before.tiles.api.r - before.tiles.api.l) / (after0.tiles.api.r - after0.tiles.api.l), sc = (r) => ({ l: r.l * k, t: r.t * k, r: r.r * k, b: r.b * k });
    const after = { tiles: Object.fromEntries(Object.entries(after0.tiles).map(([i, r]) => [i, sc(r)])), frames: Object.fromEntries(Object.entries(after0.frames).map(([i, r]) => [i, sc(r)])) };
    const mv = moved(before, after, 3);
    t.check('and the boxes sit at the same places', !mv.length, J({ mv, shift: shiftOf(before, after), eg: mv.slice(0, 3).map((id) => [id, before.tiles[id] || before.frames[id], after.tiles[id] || after.frames[id]]) }));
    await clean('after reloading a manual page');
  });

  // --- keyboard --------------------------------------------------------------------------------------------------
  await section('keys', async () => {
    await freshPage(autoPage);
    await clickName('cust');
    await t.press('ArrowRight', { modifiers: 1 });
    await sleep(250);
    t.check('the first Alt+arrow turns manual mode on and announces it', !(await isAuto()) && (await statusSeen(/manual layout on/i)), 'no "Manual layout on" announcement');
    // positions move with the canvas trim, so a delta is read against the shift the other items share
    const ldl = (A0, A1, id) => {
      const o = Object.keys(A0).filter((k) => k !== id && A1[k]);
      return { x: A1[id].x - A0[id].x - med(o.map((k) => A1[k].x - A0[k].x)), y: A1[id].y - A0[id].y - med(o.map((k) => A1[k].y - A0[k].y)) };
    };
    const L1 = await layoutOf();
    await t.press('ArrowRight', { modifiers: 1 });
    await sleep(250);
    const L2 = await layoutOf(), a1 = ldl(L1, L2, 'cust');
    t.check('Alt+Right moves the selection by 8px', close(a1.x, 8, 0.5) && close(a1.y, 0, 0.5), J(a1));
    await t.press('ArrowDown', { modifiers: 9 });
    await sleep(250);
    const L3 = await layoutOf(), a2 = ldl(L2, L3, 'cust');
    t.check('Shift+Alt+Down moves it by 40px', close(a2.y, 40, 0.5) && close(a2.x, 0, 0.5), J(a2));
    await undo();
    const L4 = await layoutOf(), a3 = ldl(L2, L4, 'cust');
    t.check('one undo steps back one key press (each press released is one step)', close(a3.y, 0, 0.5) && close(a3.x, 0, 0.5), J(a3));
    // a held key (auto-repeat) is one undo step after the key is released
    await clickName('cust');   // an undo may leave nothing selected
    const kd = (extra) => t.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39, modifiers: 1, ...extra });
    await kd({}); await sleep(40); await kd({ autoRepeat: true }); await sleep(40); await kd({ autoRepeat: true }); await sleep(40);
    await t.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39, modifiers: 1 });
    await sleep(300); await t.settle(1500);
    const L5 = await layoutOf(), a4 = ldl(L4, L5, 'cust');
    t.check('a held Alt+Right moves by 8px per repeat (3 repeats: 24px)', close(a4.x, 24, 0.5), J(a4));
    await undo();
    const a5 = ldl(L4, await layoutOf(), 'cust');
    t.check('and one undo reverts the whole held move', close(a5.x, 0, 0.5), J(a5));
    await clean('after keyboard moves');
    // a selected group moves with its members
    await freshPage(keptPage);
    const K0 = await layoutOf();
    await clickTag('services');
    await t.press('ArrowLeft', { modifiers: 1 });
    await sleep(250);
    const K2 = await layoutOf(), g1 = ldl(K0, K2, 'w1'), g2 = ldl(K0, K2, 'w2');
    t.check('Alt+Left on a selected group moves its members by 8px', close(g1.x, -8, 0.5) && close(g2.x, -8, 0.5) && close(g1.y, 0, 0.5), J([g1, g2]));
  });

  // --- ?present --------------------------------------------------------------------------------------------------
  await section('present', async () => {
    await freshPage(keptPage, '?present');
    const r0 = await rel(), L0 = await layoutOf(), p = await centreOf('cust');
    await dragFull(p, { x: p.x + 160, y: p.y + 60 });
    const tg = await tagOf('services');
    await dragFull(tg, { x: tg.x + 100, y: tg.y - 60 });
    await clickName('db');
    await t.press('ArrowRight', { modifiers: 1 });
    await sleep(250);
    t.check('?present: no drag and no Alt+arrow changes anything (positions and layout map)', !moved(r0, await rel(), 1.5).length && J(await layoutOf()) === J(L0), J(moved(r0, await rel(), 1.5)));
    t.check('?present: no drag state is left behind and no undo step exists', !(await t.ev(`document.body.classList.contains('c4-dragging')`)) && (await undoOff()));
  });

  // --- reduced motion --------------------------------------------------------------------------------------------
  await section('reduced', async () => {
    await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      await freshPage(autoPage, '', { motion: true });
      const probe = async (name, fn) => {
        await fn();
        const r = [await t.ev(WAAPI), await t.ev(GHOSTS)];
        await sleep(80);
        r.push(await t.ev(WAAPI), await t.ev(GHOSTS));
        t.check(`reduced motion: ${name} creates no animation and no ghost`, r.every((n) => n === 0), J(r));
      };
      const p = await centreOf('cust');
      await down(p); await glide(p, { x: p.x + 120, y: p.y + 70 }, 8);
      await probe('releasing a drag', () => up({ x: p.x + 120, y: p.y + 70 }));
      await sleep(200);
      t.check('reduced motion: the drag still worked (manual mode)', !(await isAuto()));
      await probe('undo of a drag', () => undo());
      const q = await tagOf('services');
      await down(q); await glide(q, { x: q.x + 50, y: q.y + 40 }, 6);
      await probe('releasing a group drag', () => up({ x: q.x + 50, y: q.y + 40 }));
      await probe('Tidy', () => t.clickOn(A.tidy));
    } finally { await t.send('Emulation.setEmulatedMedia', { features: [] }); }
  });

  // --- touch -----------------------------------------------------------------------------------------------------
  await section('touch', async () => {
    await t.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    try {
      const touch = (type, pts) => t.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
      const swipe = async (p, q, steps = 12) => {
        await touch('touchStart', [{ x: p.x, y: p.y, id: 1 }]);
        for (let i = 1; i <= steps; i++) { await touch('touchMove', [{ x: p.x + (q.x - p.x) * i / steps, y: p.y + (q.y - p.y) * i / steps, id: 1 }]); await sleep(15); }
        await touch('touchEnd', []);
        await settleAll();
      };
      await freshPage(autoPage);
      const r0 = await rel(), b0 = await t.ev(`__e2e.boxes()`), p = await centreOf('cust');
      const spot = await spotNear({ x: p.x + 220, y: p.y + 90 });
      await swipe(p, spot);
      const r1 = await rel();
      { const m = dl(r0, r1, 'cust'); t.check('touch: a drag on an element moves it with the finger', close(m.x, spot.x - p.x, 10) && close(m.y, spot.y - p.y, 10) && !(await isAuto()), J([m, spot.x - p.x, spot.y - p.y])); }
      t.check('touch: the other boxes did not move', !moved(r0, r1, 2.5, ['cust']).length, J(moved(r0, r1, 2.5, ['cust'])));
      await undo();
      // a drag that starts on empty canvas pans and moves no element
      const r2 = await rel(), e0 = await t.ev(`__e2e.boxes()`);
      const from = await spotNear({ x: 400, y: 600 }, 80);
      await swipe(from, { x: from.x + 150, y: from.y + 90 });
      const e1 = await t.ev(`__e2e.boxes()`), r3 = await rel();
      t.check('touch: a drag on empty canvas pans (every box moved on screen by the same amount)', e1.tiles.api.l - e0.tiles.api.l > 40 || e1.tiles.api.t - e0.tiles.api.t > 20, J([e0.tiles.api, e1.tiles.api]));
      t.check('touch: ...and moved no element (relative positions the same, still Auto-Tidy, no undo step)', !moved(r2, r3, 2).length && (await isAuto()) && (await undoOff()), J(moved(r2, r3, 2)));
    } finally { await t.send('Emulation.setTouchEmulationEnabled', { enabled: false }); }
  });

  // --- scale -----------------------------------------------------------------------------------------------------
  await section('scale', async () => {
    const t0 = Date.now();
    const bigPage = layoutPage(BIG, 'big');
    console.log(`(500-element diagram laid out in ${Date.now() - t0} ms)`);
    await freshPage(bigPage);
    t.check('the 500-element diagram opens with no errors', (await count(A.node)) >= 400 && t.errors.length === 0, `${await count(A.node)} ${t.errors.join(' | ')}`);
    await t.ev(`window.__rel = []; window.addEventListener('pointerup', () => { const t0 = performance.now(), r = { script: 0, frame: 0 }; window.__rel.push(r);
      setTimeout(() => { r.script = performance.now() - t0; }, 0); requestAnimationFrame(() => requestAnimationFrame(() => { r.frame = performance.now() - t0; })); }, true); true`);
    const pick = async (skip) => {   // a tile that the pointer really hits at fit zoom
      return t.ev(`(() => { for (const e of document.querySelectorAll(${J(A.node)})) { if (${J(skip)}.includes(e.dataset.nodeId)) continue; const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        const h = document.elementFromPoint(x, y); if (h && h.closest(${J(A.node)}) === e && x > 100 && y > 150 && x < innerWidth - 100 && y < innerHeight - 100) return { id: e.dataset.nodeId, x, y }; } return null; })()`);
    };
    const first = await pick([]);
    t.check('a tile can be picked on the big diagram at fit zoom', !!first);
    if (!first) return;
    await dragFull({ x: first.x, y: first.y }, { x: first.x + 25, y: first.y + 18 }, { steps: 4 });
    const second = await pick([first.id]);
    await dragFull({ x: second.x, y: second.y }, { x: second.x - 22, y: second.y + 16 }, { steps: 4 });
    const rels = await t.ev(`window.__rel`);
    console.log(`(release on 500 elements: first drag ${rels[0].script.toFixed(1)} ms script / ${rels[0].frame.toFixed(1)} ms to the second frame; second drag ${rels[1].script.toFixed(1)} / ${rels[1].frame.toFixed(1)})`);
    t.check('a release on the 500-element diagram completes in under 160 ms of script time (manual mode)', rels.length >= 2 && rels[1].script < 160, J(rels));
    t.check('...and the first release too, which builds the layout map (under 200 ms)', rels[0].script < 200, J(rels));
    t.check('the big diagram is in manual mode afterwards and the dropped tile stays', !(await isAuto()));
  });

  errs.push(...t.errors);
  t.check('no console errors anywhere in the run', errs.length === 0, [...new Set(errs)].slice(0, 5).join(' | '));
} catch (err) {
  console.error('[ERROR]', err.stack || err.message);
  code = 1;
} finally {
  await t.close();
  if (process.env.E2E_KEEP) console.log(`(temp files kept in ${work})`);
  else try { rmSync(work, { recursive: true, force: true }); } catch { /* temp folder */ }
}
process.exit(code || t.finish());
