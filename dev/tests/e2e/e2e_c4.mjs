// Interaction test for the C4 diagram plugin: render (tiles, frames, arrows, labels), the Level control, collapse and expand,
// hover highlight, search, the dock (all seven kinds, by click and by joining a selected group), rename (double-click, F2,
// Enter, empty refused, Esc), selection (click, Ctrl+click, box, Ctrl+A, Esc), the action bar of an element, a group, an arrow
// and several selected, connecting (port drag and the connect button, the required label, Esc undoes the whole connection,
// self and duplicate refused), Delete and Backspace, undo and redo (add + rename and connect + label are one step each, bursts
// settle like slow steps), Auto-Tidy after every edit (no overlap, everything inside its frame, no orphan motion ghost, nothing
// still animating), the saved data block (slug ids, arrange / core / side kept, no sizes, a reload shows the same diagram),
// ?present, reduced motion and a keyboard-only path; and the notes (add to an element, group or arrow, the Notes switch,
// edit, delete, undo, save with renamed ids against the Python codec, collapse, search, present, reduced motion).
// Driven with real mouse and keyboard input over the Chrome DevTools Protocol (see cdp.mjs); a synthetic DOM event is used
// only where a comment says why. The contract is "Editing (phase 4)" in dev/plans/plan-c4.md; selectors the contract does not
// pin are in SELECTORS below, one line each.
//   node dev/e2e_c4.mjs --browser <chrome> [--page <assembled c4 page>]
// Without --page the test lays out its own small diagram with `scripts/layout_engine.py --layout` into a temp folder.
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
const work = mkdtempSync(join(tmpdir(), 'e2e_c4_'));

// Selectors the plan does not pin (a guess each; change here when the page names them differently)
const SELECTORS = {
  node: '.c4-node',                                   // an element tile (data-node-id)
  frame: '.c4-group.is-frame',                        // an open group (data-group-id)
  tile: '.c4-group.is-tile',                          // a collapsed group
  tag: '.c4-group .frame-tag',                        // the title tag of a frame
  chevron: '.chevron',                             // collapse / expand button (aria-expanded)
  edge: '.c4-edge',                                   // an arrow (g, data-edge-id)
  edgeHit: '.c4-edge .edge-hit',                      // its hit path
  label: '.edge-label.c4-label',                      // a label pill (data-edge-id)
  name: '.c4-name',                                   // the name line of a tile
  bar: '.c4-actionbar',                               // the action bar
  menuItem: '#c4-menu button, .c4-menu button, .menu button, [role="menuitem"]',   // a menu entry
  iconBtn: '#c4-icons button[data-icon]:not([data-icon=""])',   // an icon in the picker
  iconSearch: '#c4-icons input',                      // the picker's search box
  swatch: '.c4-actionbar [data-act="color"][data-value], .c4-actionbar .ab-swatch, .c4-actionbar [data-swatch]',   // one colour swatch
  addTiles: ['person', 'system', 'container', 'database', 'queue', 'external', 'group'],
  editor: 'input, textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]',   // the inline name editor
  confirm: '.confirm',                                // the shell's confirm bubble
  toast: '.toast',
  stage: '#viewport'
};
const A = SELECTORS;

const DIAGRAM = {
  diagramType: 'c4',
  schemaVersion: 1,
  title: 'Shop',
  arrange: 'surround',
  colorKey: { 1: 'Buyers' },
  groups: [{ id: 'platform', name: 'Platform', kind: 'system', core: true }],
  elements: [
    { id: 'cust', kind: 'person', name: 'Customer', description: 'Buys online', color: '1' },
    { id: 'api', kind: 'container', name: 'Web API', tech: 'Node', group: 'platform' },
    { id: 'db', kind: 'database', name: 'Order Store', group: 'platform' },
    { id: 'mail', kind: 'external', name: 'Mail Gateway', side: 'E' }
  ],
  relations: [
    { from: 'cust', to: 'api', label: 'Orders', tech: 'HTTPS' },
    { from: 'api', to: 'db', label: 'Reads' },
    { from: 'api', to: 'mail', label: 'Sends mail' }
  ]
};

const NOTED = {
  ...DIAGRAM,
  showNotes: true,
  notes: [
    { id: 'n1', text: 'Peak load is 10x on Fridays', elements: ['api'] },
    { id: 'n2', text: 'Owned by the platform team', groups: ['platform'] }
  ]
};
// Editor-made ids on a model with notes: the page must rename them on Save exactly as c4_to_disk does
const GENERATED = {
  diagramType: 'c4', schemaVersion: 1, title: 'Generated', showNotes: true,
  groups: [{ id: 'g_1700000000001', name: 'Core Platform', kind: 'system' }],
  elements: [
    { id: 'e_1700000000002', kind: 'container', name: 'Order API', group: 'g_1700000000001' },
    { id: 'e_1700000000003', kind: 'person', name: 'Shopper' }
  ],
  relations: [{ from: 'e_1700000000003', to: 'e_1700000000002', label: 'Orders' }],
  notes: [
    { id: 'n_1700000000004', text: 'about the api', elements: ['e_1700000000002'] },
    { id: 'n_1700000000005', text: 'about both', elements: ['e_1700000000003'], groups: ['g_1700000000001'] }
  ]
};
const laidOut = (model, name) => {
  const src = join(work, `${name}.json`), out = join(work, `${name}.html`);
  writeFileSync(src, JSON.stringify(model));
  const r = spawnSync('python3', [join(root, 'scripts', 'layout_engine.py'), '--layout', src, '-o', out], { encoding: 'utf8' });
  if (r.status !== 0) { console.error(`[ERROR] could not lay out ${name}:`, r.stdout, r.stderr); process.exit(1); }
  return out;
};
let _notedPage = null, _generatedPage = null;
const getNotedPage = () => (_notedPage ||= laidOut(NOTED, 'noted'));
const getGeneratedPage = () => (_generatedPage ||= laidOut(GENERATED, 'generated'));

let page = argOf('page');
if (!page) {
  const src = join(work, 'shop.json');
  page = join(work, 'shop.html');
  writeFileSync(src, JSON.stringify(DIAGRAM));
  const r = spawnSync('python3', [join(root, 'scripts', 'layout_engine.py'), '--layout', src, '-o', page], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('[ERROR] could not lay out the test page:', r.stdout, r.stderr); process.exit(1); }
}

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
try {
  const J = JSON.stringify;
  const count = (sel) => t.ev(`document.querySelectorAll(${J(sel)}).length`);
  const present = (sel) => t.ev(`!!document.querySelector(${J(sel)})`);
  const text = (sel) => t.ev(`(document.querySelector(${J(sel)}) || {}).textContent ?? null`);
  const item = (id) => `[data-node-id="${id}"]`;
  const grp = (id) => `[data-group-id="${id}"]`;
  const WAAPI = `document.getAnimations().filter((a) => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation)).length`;
  const GHOSTS = `document.querySelectorAll('[data-motion-ghost]').length`;
  // The disk model, read the way an agent would: after a save (chartData lives in the page's closure)
  const saved = () => t.saved();
  const rawSaved = () => t.saved({ raw: true });
  const editing = () => t.ev(`(() => { const a = document.activeElement; if (!a || !a.matches(${J(A.editor)}) || a.id === 'search-input') return null;
    return a.isContentEditable ? a.textContent : (a.value ?? ''); })()`);
  const undo = async () => { await t.press('z', { modifiers: 2 }); await t.settle(); };
  const redo = async () => { await t.press('y', { modifiers: 2 }); await t.settle(); };
  const blank = async () => { await t.press('Escape'); await t.press('Escape'); await sleep(40); };
  const undoOff = () => t.ev(`document.getElementById('btn-undo').disabled`);
  const freshPage = async (file = page, query = '', opts = {}) => { await t.open(file, query, opts); };
  const byName = (list, name) => (list || []).find((o) => o.name === name);
  const idOf = (name) => t.ev(`(() => { const n = [...document.querySelectorAll('.c4-node, .c4-group.is-tile')].find((e) => (e.querySelector('.c4-name') || {}).textContent === ${J(name)});
    return n ? (n.dataset.nodeId || n.dataset.groupId) : null; })()`);
  const sel = async (name) => { const id = await idOf(name); if (!id) throw new Error(`no tile named ${name}`); return `[data-node-id="${id}"], .c4-group.is-tile[data-group-id="${id}"]`; };
  const clickName = async (name, opts) => { await t.clickOn(await sel(name), opts); await sleep(120); };
  const selectedCount = () => t.ev(`document.querySelectorAll('.c4-node.selected, .c4-group.selected, .c4-edge.selected').length`);
  const selectedNames = () => t.ev(`[...document.querySelectorAll('.c4-node.selected, .c4-group.is-tile.selected')].map((e) => e.querySelector('.c4-name').textContent).sort().join(',')`);
  const act = (a) => `${A.bar} [data-act="${a}"]`;
  const hasAct = (a) => present(act(a));
  const clickAct = async (a) => { await t.clickOn(act(a)); await sleep(150); };
  const tileNames = () => t.ev(`[...document.querySelectorAll('.c4-node .c4-name, .c4-group.is-tile .c4-name')].map((e) => e.textContent).sort().join('|')`);
  const toastText = () => t.ev(`[...document.querySelectorAll(${J(A.toast)})].map((e) => e.textContent).join(' / ')`);
  const dropToasts = () => t.ev(`document.querySelectorAll(${J(A.toast)}).forEach((e) => e.remove())`);
  // The dock's Add and Level tiles hide until the pointer is over their trigger
  const openPop = async (triggerSel) => {
    const p = await t.at(triggerSel);
    await t.mouse('mouseMoved', p.x, p.y);
    await t.waitFor(`(() => { const pop = document.querySelector(${J(triggerSel)})?.closest('[data-dock-pop]')?.querySelector('.dock-pop'); return pop && pop.closest('.open') && getComputedStyle(pop).opacity === '1'; })()`);
  };
  const openAdd = () => openPop('#btn-add');
  const openLevel = () => openPop('#btn-level');
  const pickLevel = async (n) => { await openLevel(); await t.clickOn(`#btn-level-${n}`); await sleep(500); await t.settle(1500); };
  const tile = async (kind) => { await openAdd(); await t.clickOn(`#btn-add-${kind}`); await t.settle(); };
  const addNamed = async (kind, name) => { await tile(kind); await t.press('a', { modifiers: 2 }); await t.type(name); await t.press('Enter'); await t.settle(); };
  // Click the visible menu / popover entry whose text matches (the entry is found by text, not by position)
  const menuPick = async (re) => {
    // mark the entry, then clickOn it: clickOn waits for the menu's own open animation to settle
    const found = await t.ev(`(() => { document.querySelectorAll('[data-e2e-pick]').forEach((e) => e.removeAttribute('data-e2e-pick'));
      const e = [...document.querySelectorAll(${J(A.menuItem)})].find((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && ${re}.test(b.textContent + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.title || '')) && !(b.matches('[data-act]') && b.closest(${J(A.bar)})); });
      if (!e) return false; e.setAttribute('data-e2e-pick', ''); return true; })()`);
    if (!found) return false;
    await t.clickOn('[data-e2e-pick]');
    await sleep(250);
    return true;
  };
  const menuTexts = () => t.ev(`[...document.querySelectorAll(${J(A.menuItem)})].filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.textContent.trim()).join('|')`);
  // A point on an arrow that really hits it
  const onEdge = (label) => t.ev(`(() => {
    const lab = [...document.querySelectorAll(${J(A.label)})].find((e) => e.textContent.includes(${J(label)})); if (!lab) return null;
    const g = document.querySelector('.c4-edge[data-edge-id="' + lab.dataset.edgeId + '"]'); const p = g.querySelector('.edge-hit'); const L = p.getTotalLength();
    for (const f of [0.15, 0.3, 0.5, 0.7, 0.85, 0.4, 0.6, 0.2, 0.8]) {
      const q = p.getPointAtLength(L * f), m = p.getScreenCTM(); const x = m.a * q.x + m.e, y = m.d * q.y + m.f;
      const hit = document.elementFromPoint(x, y);
      if (hit && hit.closest('.c4-edge') === g) return { x, y };
    }
    const r = lab.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const selectEdge = async (label) => { const p = await onEdge(label); if (!p) throw new Error(`no arrow labelled ${label}`); await t.click(p.x, p.y); await sleep(150); };
  // Hover a tile so its connect port shows, then return the port's centre
  const portOf = async (name, side) => {
    const s = await sel(name);
    const r = await t.at(s);
    await t.mouse('mouseMoved', r.x, r.y);
    await sleep(160);
    return t.at(`${s.split(',')[0]} .port${side ? `[data-side="${side}"]` : ''}`);
  };
  const fit = async () => { await t.clickOn('#btn-zoom-reset'); await sleep(200); await t.settle(); };
  const connect = async (from, to) => {
    await fit();
    const p = await portOf(from), q = await t.at(await sel(to));
    if (!p) throw new Error(`no port on ${from}`);
    await t.dragTo(p.x, p.y, q.x, q.y, { steps: 8 });
    await sleep(200);
  };
  // The Auto-Tidy invariants, read from the DOM: no two tiles overlap, a member sits inside its frame, no orphan ghost, nothing animating
  const tidyState = async () => {
    await sleep(500); await t.settle(1500);
    const d = await saved();
    await dropToasts(); await t.settle(1500);
    const dom = await t.ev(`(() => {
      const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
      const tiles = [...document.querySelectorAll('.c4-node, .c4-group.is-tile')].map((e) => ({ n: e.querySelector('.c4-name').textContent, ...R(e) }));
      const frames = [...document.querySelectorAll('.c4-group.is-frame')].map((e) => ({ n: (e.querySelector('.c4-tag-name') || {}).textContent, ...R(e) }));
      const hit = (a, b) => a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
      const overlaps = [];
      for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) if (hit(tiles[i], tiles[j])) overlaps.push(tiles[i].n + '/' + tiles[j].n);
      return { tiles, frames, overlaps, ghosts: ${GHOSTS}, waapi: ${WAAPI} }; })()`);
    const outside = [];
    const gName = Object.fromEntries((d.groups || []).map((g) => [g.id, g.name]));
    for (const e of d.elements || []) {
      if (!e.group) continue;
      const tl = dom.tiles.find((x) => x.n === e.name), fr = dom.frames.find((x) => x.n === gName[e.group]);
      if (tl && fr && !(tl.l >= fr.l - 1 && tl.t >= fr.t - 1 && tl.r <= fr.r + 1 && tl.b <= fr.b + 1)) outside.push(e.name);
    }
    return { overlaps: dom.overlaps, outside, ghosts: dom.ghosts, waapi: dom.waapi, data: d };
  };
  const tidy = async (what) => {
    const s = await tidyState();
    t.check(`Auto-Tidy after ${what}: no overlapping boxes, everything inside its frame, no ghost, nothing animating`,
      !s.overlaps.length && !s.outside.length && s.ghosts === 0 && s.waapi === 0, J({ overlaps: s.overlaps, outside: s.outside, ghosts: s.ghosts, waapi: s.waapi }));
    return s.data;
  };
  // A section that throws is one failed check, and the run goes on with a fresh page
  const section = (name, fn) => t.section(name, fn);

  // =========================================================================================================
  await section('render', async () => {
    await freshPage();
    t.check('the page renders 4 tiles, 1 frame, 3 arrows with 3 labels, no errors',
      (await count(A.node)) === 4 && (await count(A.frame)) === 1 && (await count(A.edge)) === 3 && (await count(A.label)) === 3 && t.errors.length === 0,
      `${await count(A.node)} ${await count(A.frame)} ${await count(A.edge)} ${await count(A.label)} ${t.errors.join(' | ')}`);
    t.check('a tile shows its name and its kind drawing; a labelled tile is named "name, kind, technology"',
      (await text(`${A.node}[data-kind="container"] .c4-name`)) === 'Web API' && (await t.ev(`document.querySelector('.c4-node[data-kind="container"]').getAttribute('aria-label')`)) === 'Web API, Container, Node'
      && (await present(`${A.node}[data-kind="person"] .c4-disc svg`)) && (await present(`${A.node}[data-kind="database"] .c4-disc svg`)));
    t.check('the frame has a tag with the group name and a chevron button with aria-expanded=true',
      (await text(`${A.tag} .c4-tag-name`)) === 'Platform' && (await t.ev(`document.querySelector(${J(A.chevron)}).getAttribute('aria-expanded')`)) === 'true');
    t.check('every arrow has a text label, and the tech shows under it', (await t.ev(`[...document.querySelectorAll(${J(A.label)})].map((e) => e.textContent).sort().join('|')`)).includes('Orders') && (await text(`${A.label} .c4-label-tech`)) === '[HTTPS]');
    // connector label pills hug content with balanced vertical padding
    const pillMetrics = await t.ev(`(() => [...document.querySelectorAll('.c4-label')].map((el) => {
      const cs = getComputedStyle(el);
      return { text: el.textContent, w: el.offsetWidth, h: el.offsetHeight, pt: parseFloat(cs.paddingTop), pb: parseFloat(cs.paddingBottom), inlineW: el.style.width, inlineH: el.style.height };
    }))()`);
    const readsPill = pillMetrics.find((m) => m.text === 'Reads'), mailPill = pillMetrics.find((m) => m.text === 'Sends mail'), ordersPill = pillMetrics.find((m) => m.text.includes('Orders'));
    t.check('connector labels hug their text with top/bottom padding and no fixed inline width/height',
      !!readsPill && !!mailPill && !!ordersPill && readsPill.w < mailPill.w && readsPill.pt >= 3 && readsPill.pb >= 3 && ordersPill.h > readsPill.h && !readsPill.inlineW && !readsPill.inlineH,
      J(pillMetrics));
    // connector anchor circles match Flowchart: hidden at rest, visible on hover, 16px diameter centered on edge
    const portRest = await t.ev(`(() => { const p = document.querySelector('.c4-node .port[data-side="N"]'); const cs = getComputedStyle(p); return { op: cs.opacity, pe: cs.pointerEvents, w: cs.width, h: cs.height, bw: cs.borderTopWidth, bs: cs.boxSizing }; })()`);
    t.check('connector ports are hidden at rest and use the shared 12px handle (border-box, 2px ring)',
      portRest.op === '0' && portRest.pe === 'none' && portRest.w === '12px' && portRest.h === '12px' && portRest.bw === '2px' && portRest.bs === 'border-box', J(portRest));
    const custPt = await t.at(await sel('Customer'));
    await t.mouse('mouseMoved', custPt.x, custPt.y);
    await sleep(180);
    const portHover = await t.ev(`(() => { const n = document.querySelector('.c4-node[data-kind="person"]'), p = n.querySelector('.port[data-side="N"]'); const cs = getComputedStyle(p), nr = n.getBoundingClientRect(), pr = p.getBoundingClientRect(); return { op: cs.opacity, pe: cs.pointerEvents, cx: Math.abs((pr.left + pr.width / 2) - (nr.left + nr.width / 2)), cy: Math.abs((pr.top + pr.height / 2) - nr.top) }; })()`);
    t.check('hovering a card reveals edge-centered anchor circles',
      portHover.op === '1' && portHover.pe === 'auto' && portHover.cx < 1.5 && portHover.cy < 1.5, J(portHover));
    await t.mouse('mouseMoved', 5, 5);
    await sleep(150);
    t.check('the colour key is shown above the diagram', (await present('.c4-key')) || (await present('.color-key')));
    const w = await t.ev(`(() => { const c = document.getElementById('c4-canvas').getBoundingClientRect(), v = document.querySelector(${J(A.stage)}).getBoundingClientRect(); return [c.width, c.height, v.width, v.height]; })()`);
    t.check('the diagram has a size', w[0] > 100 && w[1] > 100, J(w));
    t.check('no overlap, in frame, nothing animating at load', J((await tidyState()).overlaps) === '[]');
  });

  // --- Level, collapse, expand, hover, search ----------------------------------------------------------------
  await section('level', async () => {
    await freshPage();
    const lvState = () => t.ev(`(() => {
      const btn = document.getElementById('btn-level'), c = btn.querySelector('.btn-count');
      const l1 = document.getElementById('btn-level-1'), l2 = document.getElementById('btn-level-2');
      return { disabled: btn.disabled, badge: c.hidden ? '' : c.textContent, l1: l1.getAttribute('aria-checked'), l2: l2.getAttribute('aria-checked') };
    })()`);
    t.check('Level picker starts enabled with L2 badge and Level 2 radio checked',
      J(await lvState()) === J({ disabled: false, badge: 'L2', l1: 'false', l2: 'true' }), J(await lvState()));
    await pickLevel(1);
    t.check('Level 1 collapses the system group to one tile: its contents leave, the arrows aggregate (3 -> 2), badge shows L1',
      (await count(A.tile)) === 1 && (await count(A.frame)) === 0 && !(await present(item(await idOf('Web API') || 'x'))) && (await count(A.edge)) === 2
      && J(await lvState()) === J({ disabled: false, badge: 'L1', l1: 'true', l2: 'false' }), `${await count(A.tile)} ${await count(A.edge)} ${J(await lvState())}`);
    t.check('the collapsed tile is named "Platform" and says what is inside', (await text(`${A.tile} ${A.name}`)) === 'Platform' && /2 elements/.test(await text(`${A.tile} .c4-desc`) || ''));
    t.check('after Level 1: no ghost, nothing animating', (await t.ev(GHOSTS)) === 0 && (await t.ev(WAAPI)) === 0);
    await pickLevel(2);
    t.check('Level 2 opens it again: the frame, 4 tiles, 3 arrows, badge shows L2',
      (await count(A.frame)) === 1 && (await count(A.node)) === 4 && (await count(A.edge)) === 3
      && J(await lvState()) === J({ disabled: false, badge: 'L2', l1: 'false', l2: 'true' }));
    // the chevron and the tile
    await t.clickOn(A.chevron);
    await sleep(500); await t.settle(1500);
    t.check('the chevron collapses the group (aria-expanded=false on the tile), the arrows aggregate', (await count(A.tile)) === 1 && (await t.ev(`document.querySelector(${J(A.tile + ' ' + A.chevron)}).getAttribute('aria-expanded')`)) === 'false' && (await count(A.edge)) === 2);
    await t.clickOn(A.tile + ' ' + A.chevron);
    await sleep(500); await t.settle(1500);
    t.check('the chevron on the tile expands it again', (await count(A.frame)) === 1 && (await count(A.edge)) === 3);
    const s = await tidyState();
    t.check('after collapse and expand: no overlap, in frame, no ghost, nothing animating', !s.overlaps.length && !s.outside.length && s.ghosts === 0 && s.waapi === 0, J(s.overlaps));

    // Smart collapse: no collapsible groups disables #btn-level (no vacuous Level 1 highlight), and Level 2 reopens manually collapsed boundary
    const boundaryOnlyPage = laidOut({
      diagramType: 'c4', schemaVersion: 1, title: 'BoundaryOnly',
      groups: [{ id: 'third', name: 'Third-party', kind: 'boundary' }],
      elements: [
        { id: 'u', kind: 'person', name: 'User' },
        { id: 'ext', kind: 'external', name: 'Mail', group: 'third' }
      ],
      relations: [{ from: 'u', to: 'ext', label: 'Uses' }]
    }, 'boundary-only');
    await freshPage(boundaryOnlyPage);
    t.check('with no collapsible system/container groups, #btn-level is disabled and neither radio is checked',
      J(await lvState()) === J({ disabled: true, badge: '', l1: 'false', l2: 'false' }), J(await lvState()));
    const lvPt = await t.at('#btn-level');
    await t.mouse('mouseMoved', lvPt.x, lvPt.y);
    await sleep(160);
    t.check('hovering disabled #btn-level does not open #level-pop', !(await present('#btn-level:is(:disabled)') && await present('.dock-pop-wrap[data-level].open')));
    // manually collapse the boundary via chevron -> Level 2 reopens it
    await t.clickOn(A.chevron);
    await sleep(400); await t.settle(1500);
    t.check('manually collapsing a boundary enables #btn-level in mixed state', J(await lvState()) === J({ disabled: false, badge: '', l1: 'false', l2: 'false' }), J(await lvState()));
    await pickLevel(2);
    t.check('Level 2 reopens a manually collapsed boundary', (await count(A.frame)) === 1 && (await count(A.tile)) === 0);

    // Smart collapse: boundary holding containers auto-collapses at Level 1 while outer ownership boundary stays open
    const smartPage = laidOut({
      diagramType: 'c4', schemaVersion: 1, title: 'SmartCollapse',
      groups: [
        { id: 'org', name: 'ShopCo', kind: 'boundary' },
        { id: 'app', name: 'Checkout', kind: 'boundary', parent: 'org' }
      ],
      elements: [
        { id: 'u', kind: 'person', name: 'Shopper' },
        { id: 'web', kind: 'container', name: 'Web App', group: 'app' },
        { id: 'db', kind: 'database', name: 'Cart DB', group: 'app' }
      ],
      relations: [{ from: 'u', to: 'web', label: 'Shops' }, { from: 'web', to: 'db', label: 'Reads' }]
    }, 'smart-collapse');
    await freshPage(smartPage);
    await pickLevel(1);
    t.check('Level 1 collapses container-holding boundary while keeping outer ownership boundary open',
      (await present(`${A.frame}[data-group-id="org"]`)) && (await present(`${A.tile}[data-group-id="app"]`)));
    await pickLevel(2);
    t.check('Level 2 reopens container-holding boundary',
      (await present(`${A.frame}[data-group-id="org"]`)) && (await present(`${A.frame}[data-group-id="app"]`)));
  });

  await section('hover', async () => {
    await freshPage();
    const p = await t.at(await sel('Web API'));
    await t.mouse('mouseMoved', p.x, p.y);
    await sleep(200);
    const st = await t.ev(`({ lit: document.querySelectorAll('.edge-line.hl-in, .edge-line.hl-out').length, dimNodes: [...document.querySelectorAll('.c4-node.is-dim .c4-name')].map((e) => e.textContent), litNodes: [...document.querySelectorAll('.c4-node:not(.is-dim) .c4-name')].map((e) => e.textContent).sort() })`);
    t.check('hovering Web API lights its 3 arrows and dims nothing it is connected to', st.lit === 3 && st.dimNodes.length === 0, J(st));
    const q = await t.at(await sel('Order Store'));
    await t.mouse('mouseMoved', q.x, q.y);
    await sleep(200);
    const st2 = await t.ev(`({ lit: document.querySelectorAll('.edge-line.hl-in, .edge-line.hl-out').length, dim: [...document.querySelectorAll('.c4-node.is-dim .c4-name')].map((e) => e.textContent).sort().join(',') })`);
    t.check('hovering Order Store lights 1 arrow and dims the unconnected tiles', st2.lit === 1 && st2.dim === 'Customer,Mail Gateway', J(st2));
    await t.mouse('mouseMoved', 5, 5);
    await sleep(150);
    t.check('moving away clears the highlight', (await count('.is-dim')) === 0 && (await count('.edge-line.hl-in, .edge-line.hl-out')) === 0);
  });

  await section('search', async () => {
    await freshPage();
    await t.press('f', { modifiers: 2 });
    await sleep(200);
    await t.type('mail');
    await sleep(300);
    const n1 = await text('#search-count');
    t.check('search finds the element and the arrow label "Sends mail" (2 matches)', /2/.test(n1 || '') && (await present('#search-bar:not([hidden])')), `${n1}`);
    await t.press('Enter');
    await sleep(200);
    t.check('Enter moves to the next match (a highlight class is on a match)', (await t.ev(`!!document.querySelector('.search-hit, .search-current, [data-search-hit], .is-match, .search-match')`)));
    await t.press('a', { modifiers: 2 });
    await t.type('platform');
    await sleep(300);
    t.check('search finds a group by name', /1/.test((await text('#search-count')) || ''), `${await text('#search-count')}`);
    await t.press('a', { modifiers: 2 });
    await t.type('reads');
    await sleep(300);
    t.check('search finds a relation label', /1/.test((await text('#search-count')) || ''), `${await text('#search-count')}`);
    await t.press('Escape');
    await sleep(150);
  });

  // --- the dock ----------------------------------------------------------------------------------------------
  await section('dock', async () => {
    await freshPage();
    t.check('the dock has the Add popover with the 7 tiles', await (async () => {
      await openAdd();
      const ok = (await present('#c4-pop')) && (await t.ev(`${J(A.addTiles)}.every((k) => !!document.getElementById('btn-add-' + k))`));
      await t.press('Escape');
      return ok;
    })());
    let base = await count(A.node);
    for (const kind of A.addTiles.filter((k) => k !== 'group')) {
      await tile(kind);
      const ed = await editing();
      t.check(`Add > ${kind}: a new ${kind} appears, selected, its name open for editing`, (await count(A.node)) === ++base && ed !== null && (await count(`${A.node}.selected`)) === 1 && (await present(`${A.node}[data-kind="${kind}"].selected`)), `${await count(A.node)} ${ed}`);
      await t.press('a', { modifiers: 2 });
      await t.type(`New ${kind}`);
      await t.press('Enter');
      await sleep(150);
      await t.settle(1500);
      t.check(`${kind}: Enter names it "New ${kind}" and the editor closes`, (await present(`${A.node}[data-kind="${kind}"] ${A.name}`)) && (await tileNames()).includes(`New ${kind}`) && (await editing()) === null, await tileNames());
      await blank();
    }
    t.check('the new ids are e_<ms>', (await t.ev(`[...document.querySelectorAll('.c4-node')].filter((e) => /^e_\\d+$/.test(e.dataset.nodeId)).length`)) === 6);
    const g0 = await count(A.frame) + await count(A.tile);
    await tile('group');
    t.check('Add > group: a new group frame appears, selected, name open', (await count(A.frame)) + (await count(A.tile)) === g0 + 1 && (await editing()) !== null && (await t.ev(`[...document.querySelectorAll('.c4-group')].some((e) => /^g_\\d+$/.test(e.dataset.groupId))`)), `${await editing()}`);
    await t.press('a', { modifiers: 2 });
    await t.type('Extras');
    await t.press('Enter');
    await sleep(150);
    await t.settle(1500);
    await blank();
    const d = await tidy('adding all seven kinds');
    t.check('the saved model has the 6 new elements with slug ids and the new group', d.elements.length === 10 && d.groups.length === 2 && !d.elements.some((e) => /^e_\d/.test(e.id)) && !d.groups.some((g) => /^g_\d/.test(g.id)), J(d.elements.map((e) => e.id)));
    // joining a selected group
    await freshPage();
    await t.clickOn(A.tag);
    await sleep(150);
    await tile('database');
    await t.press('a', { modifiers: 2 });
    await t.type('Cache');
    await t.press('Enter');
    await sleep(200);
    await t.settle(1500);
    const d2 = await tidy('adding while a group is selected');
    t.check('an element added while a group is selected joins that group', byName(d2.elements, 'Cache')?.group === 'platform', J(byName(d2.elements, 'Cache')));
    await blank();
    await t.clickOn(A.tag);
    await tile('group');
    await t.press('a', { modifiers: 2 });
    await t.type('Inner');
    await t.press('Enter');
    await sleep(200);
    await t.settle(1500);
    const d3 = await saved();
    t.check('a group added while a group is selected becomes its child', byName(d3.groups, 'Inner')?.parent === 'platform', J(byName(d3.groups, 'Inner')));
  });

  // --- rename ------------------------------------------------------------------------------------------------
  await section('rename', async () => {
    await freshPage();
    const p = await t.at(`${await sel('Customer')} ${A.name}`);
    await t.click(p.x, p.y, { count: 2 });
    await sleep(200);
    t.check('double-click on a name opens the inline editor with the name', (await editing()) === 'Customer', `${await editing()}`);
    await t.press('a', { modifiers: 2 });
    await t.type('Client');
    await t.press('Enter');
    await sleep(200);
    t.check('Enter saves the new name and closes the editor', (await tileNames()).includes('Client') && !(await tileNames()).includes('Customer') && (await editing()) === null);
    await blank();
    await clickName('Client');
    await t.press('F2');
    await sleep(150);
    t.check('F2 on the selection opens the editor', (await editing()) === 'Client', `${await editing()}`);
    await t.press('a', { modifiers: 2 });
    await t.type('Buyer');
    await t.press('Enter');
    await sleep(200);
    t.check('F2 rename saved', (await tileNames()).includes('Buyer'));
    await t.press('Enter');
    await sleep(150);
    t.check('Enter on the selected tile opens the editor', (await editing()) === 'Buyer', `${await editing()}`);
    await t.press('Escape');
    await sleep(150);
    t.check('Esc leaves the name as it was', (await editing()) === null && (await tileNames()).includes('Buyer'));
    // empty refused
    await t.press('F2');
    await sleep(150);
    await t.press('a', { modifiers: 2 });
    await t.press('Delete');
    await t.press('Enter');
    await sleep(200);
    const stillOpen = (await editing()) !== null;
    t.check('an empty name is refused: the editor stays open or the old name is back, and no tile is nameless', (stillOpen || (await tileNames()).includes('Buyer')) && !(await tileNames()).split('|').includes(''), `${stillOpen} ${await tileNames()}`);
    await t.press('Escape');
    await sleep(100);
    // Esc cancels typed text
    await blank();
    await clickName('Buyer');
    await t.press('F2');
    await t.press('a', { modifiers: 2 });
    await t.type('zzz');
    await t.press('Escape');
    await sleep(150);
    t.check('Esc cancels the typed name', (await tileNames()).includes('Buyer') && !(await tileNames()).includes('zzz'));
    // a group's name by double-click on the tag
    const tg = await t.at(`${A.tag} .c4-tag-name`);
    await t.click(tg.x, tg.y, { count: 2 });
    await sleep(200);
    t.check('double-click on a group tag opens its editor', (await editing()) === 'Platform', `${await editing()}`);
    await t.press('a', { modifiers: 2 });
    await t.type('Core platform');
    await t.press('Enter');
    await sleep(200);
    t.check('the group is renamed', (await text(`${A.tag} .c4-tag-name`)) === 'Core platform');

    // Direct inline editing on cards: tech, description, ghost placeholders, and Tab cycling
    await freshPage();
    const apiSel = item(await idOf('Web API')), custSel = item(await idOf('Customer'));
    const apiTechPt = await t.at(`${apiSel} .c4-tech`);
    await t.click(apiTechPt.x, apiTechPt.y, { count: 2 });
    await sleep(200);
    t.check('double-click on .c4-tech opens inline editor with raw tech (no brackets)', (await editing()) === 'Node', `${await editing()}`);
    await t.press('a', { modifiers: 2 });
    await t.type('Go');
    await t.press('Enter');
    await sleep(250); await t.settle(1500);
    t.check('edited tech renders as [Go] and saves on the element', (await text(`${apiSel} .c4-tech`)) === '[Go]' && byName((await saved()).elements, 'Web API')?.tech === 'Go');
    // double-click .c4-desc on Customer
    const custDescPt = await t.at(`${custSel} .c4-desc`);
    await t.click(custDescPt.x, custDescPt.y, { count: 2 });
    await sleep(200);
    t.check('double-click on .c4-desc opens inline editor with description', (await editing()) === 'Buys online', `${await editing()}`);
    await t.press('a', { modifiers: 2 });
    await t.type('Pays the bills');
    await t.press('Enter');
    await sleep(250); await t.settle(1500);
    t.check('edited description saves on the element', byName((await saved()).elements, 'Customer')?.description === 'Pays the bills');
    // ghost placeholder + tech on selected card, then Tab / Shift+Tab cycling
    await clickName('Customer');
    t.check('selected card with missing tech shows ghost placeholder .c4-tech-ph', await t.ev(`(() => { const el = document.querySelector('.c4-node[data-kind="person"] .c4-tech-ph'); return !!el && getComputedStyle(el).display !== 'none' && el.hasAttribute('data-export-skip'); })()`));
    const phPt = await t.at('.c4-node[data-kind="person"] .c4-tech-ph');
    await t.click(phPt.x, phPt.y);
    await sleep(200);
    t.check('clicking + tech placeholder opens inline tech editor', (await editing()) === '' && (await present('.c4-node[data-kind="person"] .c4-tech-ph.is-editing')));
    await t.type('gRPC');
    await t.press('Enter');
    await sleep(250); await t.settle(1500);
    const cd = byName((await saved()).elements, 'Customer');
    t.check('saving tech via placeholder persists [gRPC] alongside description and grows card height',
      cd?.tech === 'gRPC' && cd?.description === 'Pays the bills' && (await text(`${custSel} .c4-tech`)) === '[gRPC]' && (await t.ev(`document.querySelector('.c4-node[data-kind="person"]').offsetHeight > 112`)), J(cd));
    // Tab / Shift+Tab cycling across Name -> Tech -> Description -> Tech
    const cNamePt = await t.at(`${custSel} .c4-name`);
    await t.click(cNamePt.x, cNamePt.y, { count: 2 });
    await sleep(180);
    t.check('Tab from name moves to tech inline editor', await (async () => { await t.press('Tab'); await sleep(180); return (await editing()) === 'gRPC'; })());
    t.check('Tab from tech moves to description inline editor', await (async () => { await t.press('Tab'); await sleep(180); return (await editing()) === 'Pays the bills'; })());
    t.check('Shift+Tab from description moves back to tech inline editor', await (async () => { await t.press('Tab', { modifiers: 8 }); await sleep(180); return (await editing()) === 'gRPC'; })());
    await t.press('Escape');
    await sleep(180);

    // Direct inline editing on connectors: label, + tech placeholder, tech, Tab cycling
    const readsPt = await t.ev(`(() => { const el = [...document.querySelectorAll('.c4-label')].find((x) => x.textContent.includes('Reads')); const r = el.querySelector('.c4-label-text').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await t.click(readsPt.x, readsPt.y, { count: 2 });
    await sleep(200);
    t.check('double-click on connector label edits inline inside .c4-label-text', (await editing()) === 'Reads' && (await present('.c4-label.is-editing .c4-label-text.is-editing')), `${await editing()}`);
    await t.press('a', { modifiers: 2 });
    await t.type('Queries');
    await t.press('Enter');
    await sleep(250); await t.settle(1500);
    t.check('Enter saves the inline connector label', (await saved()).relations.some((r) => r.label === 'Queries'));
    await selectEdge('Queries');
    t.check('selected direct arrow without tech shows + tech ghost placeholder', await t.ev(`(() => { const l = [...document.querySelectorAll('.c4-label')].find((x) => x.textContent.includes('Queries')); const ph = l && l.querySelector('.c4-label-tech-ph'); return !!ph && getComputedStyle(ph).display !== 'none' && ph.hasAttribute('data-export-skip'); })()`));
    const edgePhPt = await t.ev(`(() => { const l = [...document.querySelectorAll('.c4-label')].find((x) => x.textContent.includes('Queries')); const r = l.querySelector('.c4-label-tech-ph').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await t.click(edgePhPt.x, edgePhPt.y);
    await sleep(200);
    await t.type('SQL');
    await t.press('Enter');
    await sleep(250); await t.settle(1500);
    t.check('inline arrow tech renders [SQL] and saves on the relation', (await t.ev(`[...document.querySelectorAll('.c4-label-tech')].some((e) => e.textContent === '[SQL]')`)) && (await saved()).relations.some((r) => r.label === 'Queries' && r.tech === 'SQL'));
    // double-click .c4-label-tech opens raw tech and Tab cycles back to label
    const edgeTechPt = await t.ev(`(() => { const el = [...document.querySelectorAll('.c4-label-tech')].find((x) => x.textContent === '[SQL]'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await t.click(edgeTechPt.x, edgeTechPt.y, { count: 2 });
    await sleep(180);
    t.check('double-click on .c4-label-tech edits raw SQL and Tab cycles to label', (await editing()) === 'SQL' && await (async () => { await t.press('Tab'); await sleep(180); return (await editing()) === 'Queries'; })());
    await t.press('Escape');
    await sleep(180);
    await tidy('renaming and inline editing');
  });

  // --- selection ---------------------------------------------------------------------------------------------
  await section('selection', async () => {
    await freshPage();
    await clickName('Customer');
    t.check('click selects a tile (class selected)', (await selectedNames()) === 'Customer');
    await clickName('Mail Gateway', { modifiers: 2 });
    t.check('Ctrl+click adds a second', (await selectedNames()) === 'Customer,Mail Gateway', await selectedNames());
    await t.press('Escape');
    t.check('Esc clears the selection', (await selectedCount()) === 0 && !(await present(A.bar)));
    await clickName('Customer');
    await clickName('Mail Gateway', { modifiers: 8 });
    t.check('Shift+click adds too', (await selectedNames()) === 'Customer,Mail Gateway');
    await blank();
    await t.press('a', { modifiers: 2 });
    await sleep(150);
    t.check('Ctrl+A selects every tile', (await count(`${A.node}.selected`)) === 4, `${await count(`${A.node}.selected`)}`);
    await blank();
    // a click on an arrow and on a group tag
    await selectEdge('Reads');
    t.check('click on an arrow selects it (class selected on .c4-edge)', (await count(`${A.edge}.selected`)) === 1);
    await t.clickOn(A.tag);
    await sleep(150);
    t.check('click on a group tag selects the group', (await count(`${A.tag}.selected, ${A.frame}.selected`)) >= 1 && (await count(`${A.edge}.selected`)) === 0);
    await blank();
    // a box on empty canvas around Customer
    const cust = await t.at(await sel('Customer'));
    const box = await t.ev(`(() => { const e = document.querySelector('.c4-node[data-kind="person"]'); const r = e.getBoundingClientRect(); const bg = (x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h.id === 'c4-canvas' || h.id === 'c4-svg' || h.id === 'c4-html' || h.id === 'stage' || h.id === 'viewport'); };
      const corners = [[r.left - 25, r.top - 25, r.right + 25, r.bottom + 25], [r.right + 25, r.bottom + 25, r.left - 25, r.top - 25], [r.left - 25, r.bottom + 25, r.right + 25, r.top - 25], [r.right + 25, r.top - 25, r.left - 25, r.bottom + 25]];
      return corners.find((c) => bg(c[0], c[1])) || null; })()`);
    if (!box) t.check('a box select starts on empty canvas next to Customer', false, 'no empty corner');
    else {
      await t.dragTo(box[0], box[1], box[2], box[3], { steps: 8, modifiers: 8 });   // Shift + drag draws the box (the shell's marquee); a plain drag pans
      await sleep(200);
      t.check('Shift + a box dragged on empty canvas selects the tile it covers (and only that one)', (await selectedNames()) === 'Customer', await selectedNames());
    }
    void cust;
  });

  // --- the action bar ----------------------------------------------------------------------------------------
  await section('actionbar-element', async () => {
    await freshPage();
    await clickName('Customer');
    const topActs = await t.ev(`[...new Set([...document.querySelectorAll(${J(A.bar + ' [data-act]')})].map((e) => e.dataset.act))].sort()`);
    t.check('top-level element action bar has only icon, core, delete, color',
      (await present(A.bar)) && J(topActs) === J(['color', 'core', 'delete', 'icon']), J(topActs));
    await clickName('Web API');
    const groupedActs = await t.ev(`[...new Set([...document.querySelectorAll(${J(A.bar + ' [data-act]')})].map((e) => e.dataset.act))].sort()`);
    t.check('grouped element action bar omits core (only icon, delete, color)',
      J(groupedActs) === J(['color', 'delete', 'icon']), J(groupedActs));
    // icon picker
    await clickName('Customer');
    await clickAct('icon');
    t.check('the icon picker #c4-icons opens with a search box and icons', (await present('#c4-icons')) && (await present(A.iconSearch)) && (await count(A.iconBtn)) > 3, `${await count(A.iconBtn)}`);
    const all = await count(A.iconBtn);
    await t.clickOn(A.iconSearch);
    await t.type('cart');
    await sleep(250);
    const some = await count(A.iconBtn);
    t.check('typing in the picker filters the icons', some > 0 && some < all, `${all} -> ${some}`);
    // the picker is grouped and offers no app chrome (its search is cleared first)
    await t.ev(`(() => { const i = document.querySelector(${J(A.iconSearch)}); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(200);
    const CHROME = ['undo', 'redo', 'export', 'import', 'save', 'trash', 'plus', 'minus', 'close', 'chevron-down', 'chevron-up', 'fit', 'focus', 'grip', 'help', 'eye', 'label', 'present', 'search', 'sun', 'moon', 'tidy', 'type-c4', 'type-erd', 'type-flowchart', 'type-sequence', 'type-usecase', 'shape-process', 'shape-decision', 'direction-lr', 'direction-tb', 'line-solid', 'line-dashed', 'lifespans'];
    const pk = await t.ev(`(() => ({ names: [...document.querySelectorAll('#c4-icons button[data-icon]')].map((b) => b.dataset.icon), groups: [...document.querySelectorAll('#c4-icons .c4-icon-head')].map((h) => [h.textContent, h.nextElementSibling.querySelectorAll('button').length]) }))()`);
    t.check('the picker offers none of the app chrome icons', !CHROME.some((n) => pk.names.includes(n)), pk.names.filter((n) => CHROME.includes(n)).join(','));
    t.check('the picker has the seven generic groups plus Tech logos and each has icons', J(pk.groups.map((g) => g[0])) === J(['People', 'Devices and apps', 'Infrastructure', 'Data', 'Messaging', 'Business', 'Security', 'Tech logos']) && pk.groups.every((g) => g[1] > 0), J(pk.groups));
    t.check('the Default option stays and the current icon is marked', pk.names.includes('') && (await count('#c4-icons button[aria-pressed="true"]')) === 1);
    await t.clickOn(A.iconBtn);
    await sleep(250);
    t.check('choosing an icon sets it on the element', !!byName((await saved()).elements, 'Customer')?.icon, J(byName((await saved()).elements, 'Customer')));
    await clickName('Customer');
    await clickAct('icon');
    await t.clickOn(A.iconSearch);
    await t.type('postgresql');
    await sleep(250);
    t.check('searching postgresql shows logo:devicon/postgresql', (await present('#c4-icons button[data-icon="logo:devicon/postgresql"]')));
    await t.clickOn('#c4-icons button[data-icon="logo:devicon/postgresql"]');
    await sleep(250);
    t.check('choosing a bundled tech logo sets it on the element', byName((await saved()).elements, 'Customer')?.icon === 'logo:devicon/postgresql', J(byName((await saved()).elements, 'Customer')));
    await clickName('Customer');
    await clickAct('icon');
    await t.clickOn(A.iconSearch);
    await t.type('zzqqxx');
    await sleep(250);
    t.check('a name no icon has shows no icons (a missing pack is explained)', (await count(A.iconBtn)) === 0 || /pack|missing|no icon/i.test(await text('#c4-icons') || ''), `${await count(A.iconBtn)}`);
    await blank();
    // colour
    await clickName('Customer');
    await t.clickOn('.c4-actionbar .swatch-trigger');
    await sleep(150);
    const sw = await t.ev(`document.querySelectorAll(${J(A.swatch)}).length`);
    if (sw > 1) {
      const ps = await t.ev(`(() => { const e = document.querySelectorAll(${J(A.swatch)})[2]; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await t.click(ps.x, ps.y);
      await sleep(250);
      if ((await editing()) !== null) { await t.press('Enter'); await sleep(150); }
      t.check('choosing a swatch colours the element', !!byName((await saved()).elements, 'Customer')?.color, J(byName((await saved()).elements, 'Customer')));
    } else t.check('the colour action shows a swatch row', false, `swatches: ${sw}`);
    await blank();
    // core
    await clickName('Customer');
    await clickAct('core');
    await sleep(300); await t.settle(1500);
    t.check('core toggle sets core on the element', byName((await saved()).elements, 'Customer')?.core === true);
    await tidy('making it the centre');
    await clickName('Customer');
    await clickAct('core');
    await sleep(300); await t.settle(1500);
    t.check('core toggled again removes it', !byName((await saved()).elements, 'Customer')?.core);
    // delete
    await clickName('Customer');
    await clickAct('delete');
    await sleep(300); await t.settle(1500);
    const dd = await saved();
    t.check('delete removes the element and its arrows', !byName(dd.elements, 'Customer') && (await count(A.edge)) === 2 && dd.relations.length === 2, `${dd.relations.length}`);
    await undo();
    t.check('one undo brings it and its arrow back', (await tileNames()).includes('Customer') && (await count(A.edge)) === 3);
  });

  await section('actionbar-group', async () => {
    await freshPage();
    await t.clickOn(A.tag);
    await sleep(150);
    const gActs = await t.ev(`[...new Set([...document.querySelectorAll(${J(A.bar + ' [data-act]')})].map((e) => e.dataset.act))].sort()`);
    t.check('top-level group action bar has connect, core, ungroup, delete, color',
      (await present(A.bar)) && J(gActs) === J(['color', 'connect', 'core', 'delete', 'ungroup']), J(gActs));
    // nested group omits core
    await tile('group');
    await t.press('a', { modifiers: 2 });
    await t.type('Inner');
    await t.press('Enter');
    await sleep(250); await t.settle(1500);
    const nActs = await t.ev(`[...new Set([...document.querySelectorAll(${J(A.bar + ' [data-act]')})].map((e) => e.dataset.act))].sort()`);
    t.check('nested group action bar omits core (only connect, ungroup, delete, color)', J(nActs) === J(['color', 'connect', 'delete', 'ungroup']), J(nActs));
    await undo();
    await t.clickOn(A.tag);
    await clickAct('core');
    await sleep(300); await t.settle(1500);
    t.check('core on the group toggles it off', !(await saved()).groups[0].core);
    await undo();
    await t.clickOn(A.tag);
    await t.clickOn('.c4-actionbar .swatch-trigger');
    await sleep(150);
    const ps = await t.ev(`(() => { const e = document.querySelectorAll(${J(A.swatch)})[1]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (ps) { await t.click(ps.x, ps.y); await sleep(250); if ((await editing()) !== null) { await t.press('Enter'); await sleep(150); } }
    t.check('colour on the group is saved', !!(await saved()).groups[0].color, J((await saved()).groups[0]));
    await undo();
    await blank();
    // ungroup
    await t.clickOn(A.tag);
    await clickAct('ungroup');
    await sleep(400); await t.settle(1500);
    let d = await saved();
    t.check('ungroup removes the group and keeps its members', d.groups.length === 0 && d.elements.length === 4 && !d.elements.some((e) => e.group) && (await count(A.frame)) === 0);
    await tidy('ungroup');
    await undo();
    t.check('one undo puts the group back', (await count(A.frame)) === 1);
    // delete asks when it has members
    await blank();
    await t.clickOn(A.tag);
    await clickAct('delete');
    await sleep(250);
    t.check('deleting a group with members asks first, and nothing is gone yet', (await present(A.confirm)) && (await count(A.node)) === 4, `${await present(A.confirm)}`);
    await t.press('Escape');
    await sleep(250);
    t.check('Esc on the confirm keeps everything', !(await present(A.confirm)) && (await count(A.node)) === 4 && (await count(A.frame)) === 1);
    await t.clickOn(A.tag);
    await clickAct('delete');
    await sleep(250);
    const ok = await t.ev(`(() => { const b = [...document.querySelectorAll(${J(A.confirm + ' button')})].find((x) => /delete|remove|yes|ok/i.test(x.textContent)) || [...document.querySelectorAll(${J(A.confirm + ' button')})].pop(); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (ok) await t.click(ok.x, ok.y);
    await sleep(400); await t.settle(1500);
    d = await saved();
    t.check('confirming deletes the group with its members and their arrows', d.groups.length === 0 && d.elements.length === 2 && d.relations.length === 0 && (await count(A.node)) === 2, `${J(d.elements.map((e) => e.name))} ${d.relations.length}`);
    await tidy('deleting a group');
    await undo();
    t.check('one undo restores the group, its members and arrows', (await count(A.node)) === 4 && (await count(A.edge)) === 3 && (await count(A.frame)) === 1);
    // an empty group deletes without asking
    await blank();
    await tile('group');
    await t.press('a', { modifiers: 2 });
    await t.type('Empty');
    await t.press('Enter');
    await sleep(250); await t.settle(1500);
    await t.press('Delete');
    await sleep(300); await t.settle(1500);
    t.check('an empty group deletes without a question', !(await present(A.confirm)) && !(await t.ev(`[...document.querySelectorAll('.c4-tag-name')].some((e) => e.textContent === 'Empty')`)));
  });

  await section('actionbar-arrow', async () => {
    await freshPage();
    await selectEdge('Reads');
    const eActs = await t.ev(`[...new Set([...document.querySelectorAll(${J(A.bar + ' [data-act]')})].map((e) => e.dataset.act))].sort()`);
    t.check('direct arrow action bar has async, color, delete, reverse, step (no label or tech)',
      (await present(A.bar)) && J(eActs) === J(['async', 'color', 'delete', 'reverse', 'step']), J(eActs));
    await clickAct('async');
    await sleep(300); await t.settle(1500);
    t.check('async adds the dashed class and is saved', (await t.ev(`!!document.querySelector('.c4-edge.is-async')`)) && (await saved()).relations.some((r) => r.label === 'Reads' && r.async === true));
    await selectEdge('Reads');
    await clickAct('async');
    await sleep(300); await t.settle(1500);
    t.check('async again removes it', !(await t.ev(`!!document.querySelector('.c4-edge.is-async')`)));
    await selectEdge('Reads');
    await clickAct('reverse');
    await sleep(300); await t.settle(1500);
    const rv = (await saved()).relations.find((r) => r.label === 'Reads');
    t.check('reverse swaps the ends (Order Store -> Web API)', rv && rv.from === 'order-store' && rv.to === 'web-api' || (rv && rv.from === 'db' && rv.to === 'api'), J(rv));
    await tidy('reversing an arrow');
    await undo();
    t.check('one undo reverses back', (await saved()).relations.find((r) => r.label === 'Reads')?.from !== rv?.from);
    await selectEdge('Reads');
    await clickAct('delete');
    await sleep(300); await t.settle(1500);
    t.check('delete removes just the arrow', (await count(A.edge)) === 2 && (await count(A.node)) === 4);
  });

  await section('actionbar-several', async () => {
    await freshPage();
    await clickName('Customer');
    await clickName('Mail Gateway', { modifiers: 2 });
    await t.press('Escape', {});
    await clickName('Customer');
    await clickName('Mail Gateway', { modifiers: 2 });
    const acts = await t.ev(`[...document.querySelectorAll(${J(A.bar + ' [data-act]')})].map((e) => e.dataset.act)`);
    t.check('several selected: colour, group, delete (and no rename or connect)', ['color', 'group', 'delete'].every((a) => acts.includes(a)) && !acts.includes('rename') && !acts.includes('connect'), J(acts));
    t.check('delete carries the count', /2/.test((await text(act('delete'))) || ''), `${await text(act('delete'))}`);
    await clickAct('group');
    await menuPick(/platform/i);
    await sleep(300); await t.settle(1500);
    const d = await saved();
    t.check('the group menu moves both into the group', byName(d.elements, 'Customer')?.group === 'platform' && byName(d.elements, 'Mail Gateway')?.group === 'platform', J(d.elements));
    await tidy('moving two into a group');
    await undo();
    t.check('one undo undoes both', !byName((await saved()).elements, 'Customer')?.group && !byName((await saved()).elements, 'Mail Gateway')?.group);
    await blank();
    await clickName('Customer');
    await clickName('Mail Gateway', { modifiers: 2 });
    await t.clickOn('.c4-actionbar .swatch-trigger');
    await sleep(150);
    const ps = await t.ev(`(() => { const e = document.querySelectorAll(${J(A.swatch)})[1]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (ps) { await t.click(ps.x, ps.y); await sleep(250); if ((await editing()) !== null) { await t.press('Enter'); await sleep(150); } }
    const dc = await saved();
    t.check('colour sets both', !!byName(dc.elements, 'Customer')?.color && byName(dc.elements, 'Customer')?.color === byName(dc.elements, 'Mail Gateway')?.color, J(dc.elements));
    await blank();
    await clickName('Customer');
    await clickName('Mail Gateway', { modifiers: 2 });
    await clickAct('delete');
    await sleep(300); await t.settle(1500);
    const dd = await saved();
    t.check('Delete 2 removes both and their arrows', dd.elements.length === 2 && dd.relations.length === 1 && (await count(A.node)) === 2, `${dd.elements.length} ${dd.relations.length}`);
    await tidy('deleting two');
    await undo();
    t.check('one undo restores both', (await count(A.node)) === 4 && (await count(A.edge)) === 3);
  });

  // --- connecting --------------------------------------------------------------------------------------------
  await section('connect', async () => {
    await freshPage();
    const startUndoOff = await undoOff();
    await fit();
    const hover = await portOf('Customer');
    t.check('hovering a tile shows connect ports (.port)', !!hover && (await count(`${await sel('Customer')} .port`.replace(/, /, ' .port, ') )) >= 1);
    // Esc cancels the whole connection
    await connect('Customer', 'Order Store');
    t.check('a port drag onto another tile opens inline label editing inside .c4-label-text',
      (await present('.c4-label.is-editing .c4-label-text.is-editing')) && (await t.ev(`document.activeElement && document.activeElement.matches('.c4-label-text.is-editing')`)) && !(await present(A.bar)),
      `${await present('.c4-label-text.is-editing')}`);
    await t.press('Escape');
    await sleep(300); await t.settle(1500);
    t.check('Esc drops the whole connection (no new arrow, no relation) and the undo stack is as it was',
      (await count(A.edge)) === 3 && (await saved()).relations.length === 3 && !(await present('.c4-label-text.is-editing')) && (await undoOff()) === startUndoOff, `${await count(A.edge)} undoOff=${await undoOff()} was ${startUndoOff}`);
    // an empty label is refused
    await dropToasts();
    await connect('Customer', 'Order Store');
    await t.press('Enter');
    await sleep(250);
    t.check('an empty label is refused: the inline editor stays open and says a label is required',
      (await present('.c4-label-text.is-editing')) && /label/i.test(await toastText()), `${await toastText()}`);
    await t.type('Browses');
    await t.press('Enter');
    await sleep(300); await t.settle(1500);
    let d = await saved();
    const rel = d.relations.find((r) => r.label === 'Browses');
    t.check('typing a label and Enter makes the arrow, from the dragged-from tile to the target', d.relations.length === 4 && rel && (rel.from === 'customer' || rel.from === 'cust') && (rel.to === 'order-store' || rel.to === 'db'), J(rel));
    t.check('the new arrow is drawn with its label', (await count(A.edge)) === 4 && (await t.ev(`[...document.querySelectorAll(${J(A.label)})].some((e) => e.textContent.includes('Browses'))`)));
    await tidy('connecting');
    await undo();
    t.check('connect plus label is one undo step', (await saved()).relations.length === 3 && (await count(A.edge)) === 3);
    await redo();
    t.check('redo brings it back with its label', (await saved()).relations.some((r) => r.label === 'Browses'));
    await undo();
    // self connection refused
    await dropToasts();
    await connect('Customer', 'Customer');
    await sleep(300);
    t.check('a port drag dropped on its own tile is refused with a toast and no editor', (await saved()).relations.length === 3 && !(await present('.c4-label-text.is-editing')) && (await toastText()).length > 0, `toast=${await toastText()}`);
    await blank();
    // port drag from Mail Gateway to Customer, then duplicate refused
    await connect('Mail Gateway', 'Customer');
    await t.type('Notifies');
    await t.press('Enter');
    await sleep(300); await t.settle(1500);
    d = await saved();
    t.check('port drag made Mail Gateway -> Customer "Notifies"', d.relations.some((r) => r.label === 'Notifies'), J(d.relations));
    await dropToasts();
    await blank();
    await connect('Mail Gateway', 'Customer');
    if (await present('.c4-label-text.is-editing')) { await t.type('Notifies'); await t.press('Enter'); await sleep(300); }
    t.check('the same pair with the same label is refused (still one "Notifies")', (await saved()).relations.filter((r) => r.label === 'Notifies').length === 1 && (await toastText()).length > 0, `toast=${await toastText()}`);
    await blank();
    await tidy('connecting twice');
    // Level 1 after connecting
    await pickLevel(1);
    await tidy('Level 1 after connecting');
  });

  // --- delete keys -------------------------------------------------------------------------------------------
  await section('delete-keys', async () => {
    await freshPage();
    await clickName('Mail Gateway');
    await t.press('Delete');
    await sleep(300); await t.settle(1500);
    t.check('Delete removes the selected tile and its arrow', !(await tileNames()).includes('Mail Gateway') && (await count(A.edge)) === 2, await tileNames());
    await undo();
    t.check('undo brings it back', (await tileNames()).includes('Mail Gateway') && (await count(A.edge)) === 3);
    await blank();
    await clickName('Customer');
    await t.press('Backspace');
    await sleep(300); await t.settle(1500);
    t.check('Backspace removes the selected tile too', !(await tileNames()).includes('Customer') && (await count(A.edge)) === 2);
    await undo();
    await blank();
    await selectEdge('Reads');
    await t.press('Delete');
    await sleep(300); await t.settle(1500);
    t.check('Delete removes a selected arrow', (await count(A.edge)) === 2 && (await count(A.node)) === 4);
    await undo();
    await t.press('a', { modifiers: 2 });
    await t.press('Delete');
    await sleep(400); await t.settle(1500);
    const n = await count(A.node);
    t.check('Ctrl+A then Delete with a group among them: nothing is left, or the group asks first', n === 0 || (await present(A.confirm)), `${n}`);
    await t.press('Escape');
    await blank();
    await tidy('Delete');
  });

  // --- undo and redo -----------------------------------------------------------------------------------------
  await section('undo', async () => {
    await freshPage();
    const before = await tileNames();
    await addNamed('person', 'Auditor');
    t.check('add and the first rename are in place', (await tileNames()).includes('Auditor'));
    await undo();
    t.check('add + rename is one undo step: the tile is gone with one Ctrl+Z', (await tileNames()) === before, await tileNames());
    await redo();
    t.check('one redo brings back the tile with its name', (await tileNames()).includes('Auditor'));
    await undo();
    t.check('the undo button is off again after undoing everything', await undoOff());
    // burst: the same actions with 30ms and 700ms between them settle on the same state
    const run = async (gap) => {
      await freshPage();
      await addNamed('person', 'Auditor');
      await addNamed('queue', 'Events');
      const st = async () => {
        await sleep(900);
        return t.ev(`({ n: [...document.querySelectorAll('.c4-node, .c4-group')].map((e) => { const r = e.getBoundingClientRect(); return (e.querySelector('.c4-name, .c4-tag-name') || {}).textContent + ':' + [r.left, r.top, r.width, r.height].map((v) => Math.round(v)).join(','); }).sort(), edges: document.querySelectorAll('.c4-edge').length, ghosts: ${GHOSTS}, waapi: ${WAAPI} })`);
      };
      const key = async (k) => { await t.ev(t.key(k, { ctrlKey: true })); await sleep(gap); };
      for (const k of ['z', 'z', 'y', 'z', 'y', 'y', 'z', 'y']) await key(k);
      return st();
    };
    const fast = await run(30), slow = await run(700);
    t.check('a burst of 8 undo / redo 30ms apart settles on the same boxes as the slow run', J(fast.n) === J(slow.n) && fast.edges === slow.edges, `${J(fast.n)} vs ${J(slow.n)}`);
    t.check('after the burst: no orphan ghost, no running animation', fast.ghosts === 0 && fast.waapi === 0, J({ g: fast.ghosts, w: fast.waapi }));
    // collapse bursts
    const levelBurst = async (gap) => {
      await freshPage();
      for (let i = 0; i < 6; i++) { await t.ev(`document.getElementById('btn-level-${1 + (i % 2)}').click()`); await sleep(gap); }
      await sleep(900);
      return t.ev(`({ n: [...document.querySelectorAll('.c4-node, .c4-group')].map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((v) => Math.round(v)).join(','); }).sort(), ghosts: ${GHOSTS}, waapi: ${WAAPI} })`);
    };
    const lf = await levelBurst(30), ls = await levelBurst(700);
    t.check('six Level toggles 30ms apart settle like the slow run, with no ghost or animation', J(lf.n) === J(ls.n) && lf.ghosts === 0 && lf.waapi === 0, `${J(lf)} vs ${J(ls)}`);
  });

  // --- the saved data block ----------------------------------------------------------------------------------
  await section('save', async () => {
    await freshPage();
    await addNamed('system', 'Billing System');
    await addNamed('person', 'Mail Gateway Fan');
    await connect('Mail Gateway Fan', 'Billing System');
    await t.type('Pays');
    await t.press('Enter');
    await sleep(300); await t.settle(1500);
    await blank();
    await clickName('Billing System');
    await clickAct('core');
    await sleep(300); await t.settle(1500);
    const raw = await rawSaved();
    const d = JSON.parse(raw);
    const ids = new Set([...d.elements, ...d.groups].map((o) => o.id));
    t.check('editor ids e_/g_ are renamed to name slugs (unique, no e_<digits>)', !d.elements.concat(d.groups).some((o) => /^[eg]_\d/.test(o.id)) && ids.size === d.elements.length + d.groups.length && /^[a-z0-9][a-z0-9_-]*$/.test(byName(d.elements, 'Billing System')?.id || ''), J(d.elements.map((e) => e.id)));
    t.check('relations and group references use the slugs', d.relations.every((r) => ids.has(r.from) && ids.has(r.to)) && d.elements.every((e) => !e.group || ids.has(e.group)), J(d.relations));
    t.check('arrange, core and side are kept', d.arrange === 'surround' && byName(d.elements, 'Billing System')?.core === true && byName(d.elements, 'Mail Gateway')?.side === 'E' && d.groups[0].core === true, J(d.elements));
    t.check('Auto-Tidy saves no layout map, sizes or derived fields',
      !('layout' in d) && d.elements.every((e) => !('x' in e) && !('w' in e) && !('h' in e) && !Object.keys(e).some((k) => k[0] === '_')) && d.groups.every((g) => !('w' in g) && !('h' in g) && !('x' in g))
      && !('canvas' in d) && !('_edges' in d) && d.relations.every((r) => !('points' in r) && !('path' in r) && !('labelBox' in r) && !('id' in r)), J(Object.keys(d)));
    // a reload of the saved file shows the same diagram
    const geometry = () => t.ev(`[...document.querySelectorAll('.c4-node, .c4-group')].map((e) => { const r = e.getBoundingClientRect(); return (e.querySelector('.c4-name, .c4-tag-name') || {}).textContent + ':' + [r.left, r.top, r.width, r.height].map((v) => Math.round(v)).join(','); }).sort()`);
    await fit();
    const g1 = await geometry();
    const copy = join(work, 'reload.html');
    writeFileSync(copy, readFileSync(page, 'utf8').replace(/(<script id="diagram-data" type="application\/json">)[\s\S]*?(<\/script>)/, (m, a, b) => a + raw + b));
    await freshPage(copy);
    const raw2 = await rawSaved();
    await fit();
    t.check('reloading the saved file shows the same diagram (names, boxes) and saves the same text', J(await geometry()) === J(g1) && raw2 === raw, `${raw2 === raw}`);
    const py = spawnSync('python3', [join(root, 'scripts', 'layout_engine.py'), '--layout', copy, '-o', join(work, 'again.html')], { encoding: 'utf8' });
    t.check('the Python layout step accepts the saved file', py.status === 0, py.stdout + py.stderr);
  });


  // --- notes -------------------------------------------------------------------------------------------------
  await section('notes', async () => {
    const notedPage = getNotedPage();
    const generatedPage = getGeneratedPage();
    const cards = () => t.ev(`[...document.querySelectorAll('.note[data-note-id]')].map((c) => ({ id: c.dataset.noteId, text: c.querySelector('.note-text').textContent, label: c.getAttribute('aria-label'), tab: c.tabIndex,
      r: (({ left, top, right, bottom }) => [left, top, right, bottom])(c.getBoundingClientRect()) }))`);
    const ids = async () => (await cards()).map((c) => c.id).sort().join(',');
    const sw = () => t.ev(`(() => { const b = document.getElementById('btn-notes'); return { on: b.getAttribute('aria-checked'), count: b.querySelector('.btn-count').textContent, hidden: b.querySelector('.btn-count').hidden, disabled: b.disabled }; })()`);
    const addNote = async () => { await openAdd(); await t.clickOn('#btn-add-note'); await sleep(250); };
    const typeNote = async (txt) => { await t.type(txt); await t.press('Escape'); await sleep(250); await t.settle(1500); };
    const noteOf = (d, text) => (d.notes || []).find((n) => n.text === text);
    // every card clear of every tile and of the other cards; each within reach of the box it explains
    const fitState = (pairs) => t.ev(`(() => {
      const R = (e) => e.getBoundingClientRect(), hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      const cs = [...document.querySelectorAll('.note[data-note-id]')], tiles = [...document.querySelectorAll('.c4-node, .c4-group.is-tile')];
      const bad = [];
      cs.forEach((c, i) => { tiles.forEach((n) => { if (hit(R(c), R(n))) bad.push(c.dataset.noteId + '/tile'); }); cs.slice(i + 1).forEach((d) => { if (hit(R(c), R(d))) bad.push(c.dataset.noteId + '/' + d.dataset.noteId); }); });
      const far = [];
      Object.entries(${J(pairs || {})}).forEach(([id, sel]) => { const c = document.querySelector('.note[data-note-id="' + id + '"]'), a = document.querySelector(sel); if (!c || !a) { far.push(id + ':missing'); return; }
        const p = R(c), q = R(a), gap = Math.hypot(Math.max(0, q.left - p.right, p.left - q.right), Math.max(0, q.top - p.bottom, p.top - q.bottom)); if (gap > 90) far.push(id + ':' + Math.round(gap)); });
      return { bad, far }; })()`);
    const pairs = { n1: item('api'), n2: grp('platform') };

    // -- shown from the file, named, focusable, clear of the boxes
    await freshPage(notedPage, '', { motion: true });
    await fit();
    const c0 = await cards();
    t.check('showNotes in the file draws one card per note, in the note layer', c0.length === 2 && (await t.ev(`!!document.querySelector('#c4-notes') && document.querySelectorAll('#c4-notes > .note').length === 2`)), J(c0.map((c) => c.id)));
    t.check('each card is focusable and named "Note on <target>: <text>"', c0.every((c) => c.tab === 0 && /^Note on .+: .+/.test(c.label || '')) && c0.some((c) => c.label === 'Note on Web API: Peak load is 10x on Fridays'), J(c0.map((c) => c.label)));
    const f0 = await fitState(pairs);
    t.check('the cards overlap no tile and no other card, and stand within reach of their target', !f0.bad.length && !f0.far.length, J(f0));
    t.check('the Notes switch is on and counts 2', J(await sw()) === J({ on: 'true', count: '2', hidden: false, disabled: false }), J(await sw()));
    t.check('the diagram data keeps the notes (the Python layout step accepts the page)', (await saved()).notes.length === 2);

    // -- the Notes switch: hide and show, as a morph
    await t.clickOn('#btn-notes');
    const midOff = await t.ev(`${WAAPI} + ${GHOSTS}`);
    await sleep(500); await t.settle(1500);
    t.check('hiding folds the cards (an animation or a ghost runs), then nothing is left running', midOff > 0 && (await t.ev(WAAPI)) === 0 && (await t.ev(GHOSTS)) === 0, `${midOff}`);
    t.check('the Notes switch hides every card (aria-checked false, the count stays)', (await count('.note[data-note-id]')) === 0 && (await sw()).on === 'false' && (await sw()).count === '2' && !(await saved()).showNotes);
    await t.clickOn('#btn-notes');
    const midOn = await t.ev(WAAPI);
    await sleep(500); await t.settle(1500);
    t.check('the switch shows them again, growing out of their targets (animation runs), nothing left running', (await ids()) === 'n1,n2' && midOn > 0 && (await t.ev(WAAPI)) === 0 && (await saved()).showNotes === true, `${midOn}`);
    await undo();
    t.check('showing and hiding are undo steps', (await count('.note[data-note-id]')) === 0);
    await redo();
    t.check('redo shows them again', (await count('.note[data-note-id]')) === 2);

    // -- add to an element: one step with its text; undo and redo
    await fit();
    await blank();
    await clickName('Customer');
    await addNote();
    t.check('Add > Note on a selected element opens a card to type in (focus in it, not yet saved as text)', (await count('.note[data-note-id]')) === 3 && (await editing()) === '' && (await t.ev(`document.activeElement.closest('.note') !== null`)), `${await count('.note[data-note-id]')} ${await editing()}`);
    await typeNote('Billing rule');
    const d1 = await saved();
    const n3 = noteOf(d1, 'Billing rule');
    t.check('the text is saved with the element, under a fresh id n3', d1.notes.length === 3 && n3?.id === 'n3' && J(n3.elements) === J(['cust']) && !n3.groups, J(n3));
    t.check('the new card is named after its target', (await cards()).some((c) => c.label === 'Note on Customer: Billing rule'));
    const newId = (await cards()).find((c) => c.text === 'Billing rule').id;
    const f1 = await fitState({ ...pairs, [newId]: item('cust') });
    t.check('the new card clears every tile and card and stands by Customer', !f1.bad.length && !f1.far.length, J(f1));
    await undo();
    t.check('one undo takes away the whole note (add and text are one step)', (await count('.note[data-note-id]')) === 2 && (await saved()).notes.length === 2);
    await redo();
    t.check('one redo brings it back with its text', (await cards()).some((c) => c.text === 'Billing rule') && (await saved()).notes.length === 3);

    // -- add to a group, and to an arrow (both its ends)
    await blank();
    await addNamed('group', 'Edge Zone');
    await addNote();
    await typeNote('Group rule');
    const d2 = await saved();
    t.check('a note on the selected group is saved under groups', J(noteOf(d2, 'Group rule')?.groups) === J(['edge_zone']) && !noteOf(d2, 'Group rule')?.elements, J(noteOf(d2, 'Group rule')));
    await blank();
    await selectEdge('Orders');
    await addNote();
    await typeNote('Arrow rule');
    const d3 = await saved();
    t.check('a note on a selected arrow is linked to both its ends', J(noteOf(d3, 'Arrow rule')?.elements) === J(['cust', 'api']), J(noteOf(d3, 'Arrow rule')));
    await undo(); await undo(); await undo();

    // -- nothing selected: a toast, no card
    await blank();
    await dropToasts();
    const before = await count('.note[data-note-id]');
    await addNote();
    t.check('with nothing selected the Note tile asks to select something first (toast) and adds nothing', /select/i.test(await toastText()) && (await count('.note[data-note-id]')) === before && (await editing()) === null, await toastText());

    // -- an item that has a note: the tile edits it
    await clickName('Customer');
    await addNote();
    t.check('adding to an item that has a note edits that note', (await count('.note[data-note-id]')) === before && (await editing()) === 'Billing rule', `${await editing()}`);
    await t.press('Escape'); await sleep(250); await t.settle(1500);
    t.check('Esc with the text unchanged is no undo step', (await saved()).notes.length === 3);

    // -- an empty note is given up
    await blank();
    await clickName('Mail Gateway');
    await addNote();
    await t.press('Escape'); await sleep(300); await t.settle(1500);
    t.check('a note left empty is dropped and leaves no trace', (await count('.note[data-note-id]')) === before && (await saved()).notes.length === 3 && !(await t.ev(`document.querySelector('.note-text:empty')`)));

    // -- edit in place, with the mouse
    await blank();
    const tp = await t.at('.note[data-note-id="n1"] .note-text');
    await t.click(tp.x, tp.y, { count: 2 });
    await sleep(250);
    t.check('double-clicking a card opens its text for editing', (await editing()) === 'Peak load is 10x on Fridays', `${await editing()}`);
    await t.press('a', { modifiers: 2 });
    await t.type('Ten times on Fridays');
    await t.press('Enter', { modifiers: 2 });
    await sleep(300); await t.settle(1500);
    t.check('Ctrl+Enter saves the new text', noteOf(await saved(), 'Ten times on Fridays')?.id === 'n1' && (await editing()) === null);
    await undo();
    t.check('one undo puts the old text back', !!noteOf(await saved(), 'Peak load is 10x on Fridays'));

    // -- delete: the x button, then Delete on a selected card; undo
    await blank();
    const cp = await t.at('.note[data-note-id="n1"]');
    await t.mouse('mouseMoved', cp.x, cp.y);
    await sleep(200);
    await t.clickOn('.note[data-note-id="n1"] .note-del');
    await sleep(400); await t.settle(1500);
    t.check('the x button deletes the note and its card', !(await ids()).includes('n1') && !noteOf(await saved(), 'Peak load is 10x on Fridays') && (await t.ev(GHOSTS)) === 0);
    await undo();
    t.check('one undo brings it back', (await ids()).includes('n1') && !!noteOf(await saved(), 'Peak load is 10x on Fridays'));
    await blank();
    const sp = await t.at('.note[data-note-id="n2"]', 0.5, 0.15);
    await t.click(sp.x, sp.y);
    await sleep(150);
    t.check('a click selects a card (class selected) and marks what it explains', (await present('.note[data-note-id="n2"].selected')) && (await present(`${grp('platform')}.note-linked`)) && (await selectedCount()) === 0);
    await t.press('Delete');
    await sleep(400); await t.settle(1500);
    t.check('Delete removes the selected note', !(await ids()).includes('n2') && !noteOf(await saved(), 'Owned by the platform team'));
    await undo();
    t.check('undo brings it back', (await ids()).includes('n2'));

    // -- keyboard: a card is a tab stop; Enter edits, Delete removes
    await t.ev(`document.activeElement && document.activeElement.blur()`);
    let on = null;
    for (let i = 0; i < 80 && !on; i++) { await t.press('Tab'); on = await t.ev(`(() => { const a = document.activeElement; return a && a.matches('.note[data-note-id]') ? a.dataset.noteId : null; })()`); }
    t.check('Tab reaches a note card', !!on, `${on}`);
    await t.press('Enter'); await sleep(200);
    t.check('Enter on a focused card edits it', (await editing()) !== null, `${await editing()}`);
    await t.press('Escape'); await sleep(250); await t.settle(1500);

    // -- Auto-Tidy and collapse: cards follow their target
    await freshPage(notedPage, '', { motion: true });
    await fit();
    await addNamed('system', 'Billing System');
    await fit();
    const f2 = await fitState(pairs);
    t.check('after an add (Auto-Tidy) the cards still clear every tile and stand by their target', !f2.bad.length && !f2.far.length, J(f2));
    await openLevel();
    await t.clickOn('#btn-level-1');
    const midCollapse = await t.ev(WAAPI);
    await sleep(500); await t.settle(1500);
    t.check('Level 1: the note on a member of the closed group is hidden, the one on the collapsed tile stays', (await ids()) === 'n2' && (await present(`${A.tile}.c4-group[data-group-id="platform"]`)), await ids());
    t.check('the collapse plays the morph (cards included) and leaves nothing running', midCollapse > 0 && (await t.ev(WAAPI)) === 0 && (await t.ev(GHOSTS)) === 0);
    const f3 = await fitState({ n2: grp('platform') });
    t.check('the card of the collapsed tile stands by the tile, clear of every tile', !f3.bad.length && !f3.far.length, J(f3));
    await pickLevel(2);
    t.check('Level 2 brings the member note back', (await ids()) === 'n1,n2');

    // -- search finds note text, shown or not
    await freshPage(notedPage);
    await t.press('f', { modifiers: 2 });
    await sleep(200);
    await t.type('fridays');
    await sleep(300);
    t.check('search finds the text of a shown note (1 match)', /1/.test((await text('#search-count')) || ''), `${await text('#search-count')}`);
    await t.press('Escape'); await sleep(150);
    await t.clickOn('#btn-notes');
    await sleep(500); await t.settle(1500);
    await t.press('f', { modifiers: 2 });
    await sleep(200);
    await t.type('platform team');
    await sleep(300);
    t.check('search finds a note whose card is hidden too (it rings the target)', /1/.test((await text('#search-count')) || ''), `${await text('#search-count')}`);
    await t.press('Escape'); await sleep(150);

    // -- save: editor ids renamed exactly as the Python codec does
    await freshPage(generatedPage);
    const rawGen = await rawSaved();
    const jsOut = JSON.parse(rawGen);
    const hadLayout = !!jsOut.layout;
    delete jsOut.layout;
    delete jsOut._readme;   // the layout step adds it to every page; the input here has none
    const pyDir = join(work, 'parity');
    writeFileSync(`${pyDir}_in.json`, J(GENERATED));
    writeFileSync(`${pyDir}_js.json`, J(jsOut));
    const py = spawnSync('python3', ['-I', '-c', `
import json, sys
sys.path.insert(0, ${J(join(root, 'scripts'))})
from disk_format import to_disk
want = to_disk('c4', json.load(open(${J(`${pyDir}_in.json`)})))
want.pop('layout', None)
got = json.load(open(${J(`${pyDir}_js.json`)}))
a, b = json.dumps(want, indent=2), json.dumps(got, indent=2)
import difflib
print('SAME' if a == b else 'DIFF\\n' + '\\n'.join(difflib.unified_diff(a.splitlines(), b.splitlines(), 'python', 'page', lineterm='', n=1)))`], { encoding: 'utf8' });
    t.check('Save on editor ids (e_, g_, n_) gives the bytes of c4_to_disk: slugs for elements and groups, n1, n2 for notes, note references followed', py.stdout.trim() === 'SAME' && !hadLayout, py.stdout + py.stderr);
    t.check('the saved notes are renamed and point at the renamed ids', J(jsOut.notes) === J([{ id: 'n1', text: 'about the api', elements: ['order_api'] }, { id: 'n2', text: 'about both', elements: ['shopper'], groups: ['core_platform'] }]), J(jsOut.notes));
    // an edited model: the page-made note id (n_<ms>) is renamed to the next free n<N> and the file reloads the same
    await addNamed('system', 'Ledger');
    await clickName('Ledger');
    await addNote();
    await typeNote('Edited note');
    const rawEd = await rawSaved(), ed = JSON.parse(rawEd);
    t.check('a note added in the page is saved as the next free n<N>, pointing at the element slug', J(noteOf(ed, 'Edited note')) === J({ id: 'n3', text: 'Edited note', elements: ['ledger'] }), J(noteOf(ed, 'Edited note')));
    const copyN = join(work, 'noted-reload.html');
    writeFileSync(copyN, readFileSync(generatedPage, 'utf8').replace(/(<script id="diagram-data" type="application\/json">)[\s\S]*?(<\/script>)/, (m, a, b) => a + rawEd + b));
    await freshPage(copyN);
    t.check('reloading the saved file shows the same notes and saves the same text', (await ids()) === 'n1,n2,n3' && (await rawSaved()) === rawEd);

    // -- present: read only
    await freshPage(notedPage, '?present');
    t.check('?present shows the cards from the file, no Notes switch on the dock', (await count('.note[data-note-id]')) === 2 && !(await t.ev(`(() => { const b = document.getElementById('btn-notes'); const r = b.getBoundingClientRect(); return r.width > 0 && getComputedStyle(b).display !== 'none'; })()`)));
    const pp = await t.at('.note[data-note-id="n1"] .note-text');
    await t.click(pp.x, pp.y, { count: 2 });
    await sleep(250);
    await t.press('Delete'); await t.press('F2'); await sleep(200);
    t.check('?present: a double-click does not edit, Delete removes nothing, no x button shows', (await editing()) === null && (await count('.note[data-note-id]')) === 2 && !(await t.ev(`[...document.querySelectorAll('.note-del')].some((b) => b.getBoundingClientRect().width > 0)`)) && !(await t.ev(`!!document.querySelector('.note-text[contenteditable="true"]')`)));
    await clickName('Web API');
    await t.press('Delete'); await sleep(200);
    t.check('?present: the saved notes are untouched', (await saved()).notes.length === 2);

    // -- reduced motion: no animation, no ghost
    await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      await freshPage(notedPage, '', { motion: true });
      const probe = async (name, fn) => {
        await fn();
        const r = [await t.ev(WAAPI), await t.ev(GHOSTS)];
        await sleep(80);
        r.push(await t.ev(WAAPI), await t.ev(GHOSTS));
        t.check(`reduced motion: ${name} creates no animation and no ghost`, r.every((n) => n === 0), J(r));
      };
      await probe('the Notes switch off', () => t.ev(`document.getElementById('btn-notes').click()`));
      await probe('the Notes switch on', () => t.ev(`document.getElementById('btn-notes').click()`));
      await probe('adding a note', async () => { await blank(); await clickName('Customer'); await addNote(); await typeNote('Calm'); });
      await probe('deleting a note', async () => { await t.ev(`document.querySelector('.note[data-note-id="n1"] .note-del').click()`); });
      await probe('collapsing the group (cards included)', () => t.ev(`document.getElementById('btn-level-1').click()`));
      t.check('reduced motion: the Notes state is right at the end', (await ids()).includes('n2') && !(await ids()).includes('n1'), await ids());
    } finally { await t.send('Emulation.setEmulatedMedia', { features: [] }); }
  });

  // --- present mode ------------------------------------------------------------------------------------------
  await section('present', async () => {
    await freshPage(page, '?present');
    t.check('?present: no dock to add, no connect ports, no delete', !(await t.ev(`!!document.querySelector('#btn-add') && getComputedStyle(document.querySelector('.toolbar-center')).display !== 'none' && document.querySelector('#btn-add').getBoundingClientRect().width > 0`)) && (await t.ev(`[...document.querySelectorAll('.port')].filter((e) => e.getBoundingClientRect().width > 0).length`)) === 0);
    await clickName('Customer');
    t.check('?present: a click does not open the action bar', !(await present(A.bar)));
    await t.press('Delete');
    await t.press('F2');
    await sleep(200);
    t.check('?present: Delete and F2 change nothing', (await count(A.node)) === 4 && (await editing()) === null);
    const p = await t.at(`${await sel('Customer')} ${A.name}`);
    await t.click(p.x, p.y, { count: 2 });
    await sleep(200);
    t.check('?present: double-click does not rename', (await editing()) === null);
    t.check('?present: the Level control is on screen', await (async () => (await t.ev(`(() => { const b = document.getElementById('btn-level'); const r = b.getBoundingClientRect(); return r.width > 0 && getComputedStyle(b).visibility !== 'hidden' && !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('#btn-level'); })()`)))(), 'the Level picker is hidden (the shell hides .toolbar-center in present mode)');
    await pickLevel(1);
    t.check('?present: Level 1 collapses the group', (await count(A.tile)) === 1);
    await pickLevel(2);
    t.check('?present: Level 2 opens it again', (await count(A.frame)) === 1);
    await t.press('f', { modifiers: 2 });
    await sleep(200);
    t.check('?present: search is not available (the shell hides it, as for every type)', await t.ev(`getComputedStyle(document.getElementById('search-bar')).display === 'none' && getComputedStyle(document.getElementById('btn-search')).display === 'none'`));
    await t.press('Escape');
    const q = await t.at(await sel('Web API'));
    await t.mouse('mouseMoved', q.x, q.y);
    await sleep(200);
    t.check('?present: hover highlight still works', (await count('.edge-line.hl-in, .edge-line.hl-out')) === 3);
    t.check('?present: the saved model is untouched (nothing selectable to delete)', (await saved()).elements.length === 4);
  });

  // --- reduced motion ----------------------------------------------------------------------------------------
  await section('reduced', async () => {
    await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      await freshPage(page, '', { motion: true });
      const probe = async (name, fn) => {
        await fn();
        const r = [await t.ev(WAAPI), await t.ev(GHOSTS)];
        await sleep(80);
        r.push(await t.ev(WAAPI), await t.ev(GHOSTS));
        t.check(`reduced motion: ${name} creates no animation and no ghost`, r.every((n) => n === 0), J(r));
      };
      await probe('Level 1', () => t.ev(`document.getElementById('btn-level-1').click()`));
      await probe('Level 2', () => t.ev(`document.getElementById('btn-level-2').click()`));
      await probe('the chevron', () => t.ev(`document.querySelector(${J(A.chevron)}).click()`));
      await probe('expand', () => t.ev(`document.querySelector(${J(A.tile + ' ' + A.chevron)}).click()`));
      await probe('adding from the dock', async () => { await tile('person'); await t.press('Enter'); });
      await probe('Ctrl+Z', () => t.ev(t.key('z', { ctrlKey: true })));
      await probe('Ctrl+Y', () => t.ev(t.key('y', { ctrlKey: true })));
      await probe('Delete', async () => { await blank(); await clickName('Mail Gateway'); await t.press('Delete'); });
    } finally { await t.send('Emulation.setEmulatedMedia', { features: [] }); }
  });

  // --- motion: a normal run leaves nothing behind ------------------------------------------------------------
  await section('motion', async () => {
    await freshPage(page, '', { motion: true });
    await openLevel();
    await t.clickOn('#btn-level-1');
    const mid = await t.ev(`${WAAPI}`);
    t.check('collapsing plays a morph (animations run) in normal motion', mid > 0, `${mid}`);
    await sleep(900);
    t.check('and leaves none and no ghost behind', (await t.ev(WAAPI)) === 0 && (await t.ev(GHOSTS)) === 0);
  });

  // --- keyboard only -----------------------------------------------------------------------------------------
  await section('keyboard', async () => {
    await freshPage();
    await t.ev(`document.activeElement && document.activeElement.blur()`);
    let landed = null;
    for (let i = 0; i < 60 && !landed; i++) {
      await t.press('Tab');
      landed = await t.ev(`(() => { const a = document.activeElement; return a && a.closest && a.closest('.c4-node, .c4-group.is-tile') ? (a.closest('.c4-node, .c4-group.is-tile').querySelector('.c4-name') || {}).textContent : null; })()`);
    }
    t.check('Tab reaches a tile (the tab stop of the diagram)', !!landed, `${landed}`);
    t.check('the focused tile has an accessible name', !!(await t.ev(`(document.activeElement.getAttribute('aria-label') || '')`)));
    await t.press('Enter');
    await sleep(200);
    const ed = await editing();
    t.check('Enter on the focused tile opens the rename editor (it also selects it)', ed === landed, `${ed} vs ${landed}`);
    await t.press('a', { modifiers: 2 });
    await t.type('Keyed');
    await t.press('Enter');
    await sleep(250); await t.settle(1500);
    t.check('typing and Enter renames it, with no mouse', (await tileNames()).includes('Keyed'), await tileNames());
    t.check('the focus is back on the tile', await t.ev(`!!document.activeElement && !!document.activeElement.closest('.c4-node, .c4-group.is-tile')`));
    await t.press('F2');
    await sleep(150);
    t.check('F2 opens it again', (await editing()) === 'Keyed', `${await editing()}`);
    await t.press('Escape');
    await sleep(150);
    await t.press('Delete');
    await sleep(300); await t.settle(1500);
    t.check('Delete from the keyboard removes the focused tile', !(await tileNames()).includes('Keyed'));
    await undo();
    // every arrow label is a tab stop, named, editable and deletable from the keyboard
    {
      const nLabels = await count(A.label);
      await t.ev(`document.activeElement && document.activeElement.blur()`);
      const seen = new Set();
      for (let i = 0; i < 80 && seen.size < nLabels; i++) {
        await t.press('Tab');
        const l = await t.ev(`(() => { const a = document.activeElement; return a && a.matches('.edge-label.c4-label') ? [a.dataset.edgeId, a.getAttribute('aria-label')] : null; })()`);
        if (l) seen.add(l.join('|'));
      }
      const names = [...seen].map((x) => x.split('|')[1]);
      t.check('every arrow label is reachable by Tab with the name "label, from A to B"', seen.size === nLabels && names.every((n) => /^.+, from .+ to .+$/.test(n)), J(names));
      await t.press('Enter'); await sleep(250);
      const was = await t.ev(`document.querySelector('.c4-label-text.is-editing') ? document.querySelector('.c4-label-text.is-editing').textContent : null`);
      t.check('Enter on a focused label opens the inline label editor', was !== null, `${was}`);
      await t.press('a', { modifiers: 2 }); await t.type('Keyed arrow'); await t.press('Enter'); await sleep(300); await t.settle(1500);
      t.check('Enter saves the label and the focus is back on the label', (await saved()).relations.some((r) => r.label === 'Keyed arrow') && (await t.ev(`!!document.activeElement && document.activeElement.matches('.edge-label.c4-label') && document.activeElement.textContent.includes('Keyed arrow')`)));
      await t.press('F2'); await sleep(250);
      await t.press('Escape'); await sleep(250);
      t.check('F2 opens it and Esc returns the focus to the label', !(await present('.c4-label-text.is-editing')) && (await t.ev(`!!document.activeElement && document.activeElement.matches('.edge-label.c4-label')`)));
      await t.press('Delete'); await sleep(300); await t.settle(1500);
      t.check('Delete on a focused label removes the arrow', (await count(A.edge)) === nLabels - 1 && !(await saved()).relations.some((r) => r.label === 'Keyed arrow'), `${await count(A.edge)}`);
      await undo(); await undo();
    }
    // arrow keys move between tiles
    const first = await t.ev(`document.activeElement && document.activeElement.closest && (document.activeElement.closest('.c4-node') || {}).dataset ? document.activeElement.closest('.c4-node').dataset.nodeId : null`);
    t.check('undo keeps the diagram intact', (await count(A.node)) === 4, `${first}`);
  });

  await section('layered-pipeline', async () => {
    const pipeSrc = join(root, 'dev', 'examples', 'example-c4-pipeline.json');
    const pipePage = join(work, 'pipeline.html');
    const built = spawnSync('python3', [join(root, 'scripts', 'layout_engine.py'), '--layout', pipeSrc, '-o', pipePage], { encoding: 'utf8' });
    t.check('pipeline example builds cleanly with layout_engine.py', built.status === 0, built.stderr || built.stdout);
    await freshPage(pipePage);
    await t.settle(1500);

    // 1. Initial render: vertical columns, shared layers, step badges, colored arrows, legend
    const nShared = await count('.c4-group.is-shared');
    const nSteps = await count('.c4-step');
    const nColored = await count('.c4-edge.is-colored');
    const legendText = await t.ev(`(document.querySelector('.c4-key') || {}).textContent || ''`);
    t.check('vertical pipeline renders shared layers, step badges, colored arrows, and path legend',
      nShared === 2 && nSteps >= 8 && nColored >= 5 && /Hot streaming path/.test(legendText),
      `shared=${nShared} steps=${nSteps} colored=${nColored} legend=${legendText}`);

    // 2. Toolbar Columns <-> Bands switch
    const dirLabelBefore = await t.ev(`(document.querySelector('#btn-layer-dir .btn-label') || {}).textContent || ''`);
    t.check('Layers direction button is visible and shows Columns', !(await t.ev(`document.getElementById('btn-layer-dir').hidden`)) && dirLabelBefore === 'Columns', dirLabelBefore);
    await t.clickOn('#btn-layer-dir');
    await sleep(400); await t.settle(1500);
    const dirAfter = (await saved()).layerDirection;
    const dirLabelAfter = await t.ev(`(document.querySelector('#btn-layer-dir .btn-label') || {}).textContent || ''`);
    t.check('clicking Layers direction switches to horizontal Bands and omits layerDirection on save',
      dirAfter === undefined && dirLabelAfter === 'Bands', `dir=${dirAfter} label=${dirLabelAfter}`);
    await undo();
    t.check('undo restores vertical Columns', (await saved()).layerDirection === 'vertical');

    // 3. Toolbar Steps switch
    await t.clickOn('#btn-steps');
    await sleep(300); await t.settle(1500);
    t.check('Steps switch hides all step badges and saves showSteps: false',
      (await count('.c4-step')) === 0 && (await saved()).showSteps === false, `steps=${await count('.c4-step')}`);
    await t.clickOn('#btn-steps');
    await sleep(300); await t.settle(1500);
    t.check('Steps switch shows step badges again', (await count('.c4-step')) === nSteps, `steps=${await count('.c4-step')}`);

    // 4. Direct layer-to-layer arrow editing: step badge popover (clicking step badge directly on a label-free arrow)
    await t.clickOn('.c4-step[data-edge-id]');
    await sleep(200);
    await clickAct('step');
    await sleep(200);
    t.check('step button opens step popover on a direct layer-to-layer arrow', await present('#c4-step-input'));
    await t.press('a', { modifiers: 2 });
    await t.type('1x');
    await t.press('Enter');
    await sleep(300); await t.settle(1500);
    t.check('updated step badge is rendered and saved',
      (await saved()).relations.some((r) => r.step === '1x') &&
      (await t.ev(`[...document.querySelectorAll('.c4-step')].some((el) => el.textContent === '1x')`)));
    await undo();

    // 5. Shared layer group action bar: shared, side, span, connect
    await blank();
    await t.ev(`(() => { const tag = [...document.querySelectorAll('.c4-group.is-shared .frame-tag')].find((el) => el.textContent.includes('Platform')); if (tag) tag.scrollIntoView({ block: 'center', inline: 'center' }); })()`);
    await sleep(100);
    const platPos = await t.ev(`(() => { const tag = [...document.querySelectorAll('.c4-group.is-shared .frame-tag')].find((el) => el.textContent.includes('Platform')); if (!tag) return null; const r = tag.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (platPos) { await t.click(platPos.x, platPos.y); await sleep(250); }
    const sActs = await t.ev(`[...new Set([...document.querySelectorAll(${J(A.bar + ' [data-act]')})].map((e) => e.dataset.act))].sort()`);
    t.check('shared layer action bar exposes connect, shared, side, span, ungroup, delete, color',
      ['color', 'connect', 'delete', 'shared', 'side', 'span', 'ungroup'].every((a) => sActs.includes(a)), J(sActs));
  });

  t.check('no errors in the whole run', t.errors.length === 0, t.errors.join(' | '));
} catch (err) {
  console.error('[ERROR]', err.stack || err.message);
  code = 1;
} finally {
  await t.close();
  try { rmSync(work, { recursive: true, force: true }); } catch { /* temp folder */ }
}
process.exit(code || t.finish());
