// Interaction test for flowchart multi-select (dev/plans/archive/plan-multi-select.md): Ctrl/Cmd+click, Shift+click
// runs, the Shift+drag selection box (the shell's opt-in selectInRect hook), Ctrl/Cmd+A, Escape, deleting several
// steps, moving them to another lane by drag and Alt+arrows, and moving a run elsewhere in the flow (Alt+drag onto an
// arrow, Alt+arrows along the flow). Driven over the Chrome DevTools Protocol, see cdp.mjs.
//
//   node dev/e2e_multiselect.mjs --browser <chrome> --loan <html> --zigzag <html> --connector <html> [--shot <png>]
//
// --loan:      dev/fixtures/flowchart/loan-application.json laid out by `layout_engine.py --layout`
// --zigzag:    dev/fixtures/flowchart/cross-lane-zigzag.json laid out (a straight chain of tasks, for reorder)
// --connector: dev/fixtures/flowchart/connector-forward.json laid out (an on-page connector pair)
// --shot:      optional PNG path: a screenshot of a multi-selection, to eyeball the styling
// The top-to-bottom cases switch the same pages with the dock's direction button.
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argOf, launch } from './cdp.mjs';

const browser = argOf('browser'), loan = argOf('loan'), zigzag = argOf('zigzag'), connector = argOf('connector'), shot = argOf('shot');
if (!browser || !loan || !zigzag || !connector) {
  console.error('usage: --browser <chrome> --loan <html> --zigzag <html> --connector <html> [--shot <png>]');
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// In-page helpers: synthetic pointer gestures with modifier keys, and readers for the selection and the graph
const HELPERS = `(() => {
  const ev = (type, x, y, m = {}) => new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    clientX: x, clientY: y, pointerId: 1, isPrimary: true }, m));
  const centre = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const node = (id) => document.getElementById('node-' + id);
  window.__t = {
    node, centre,
    sel: () => [...document.querySelectorAll('.flow-node.selected')].map(n => n.dataset.nodeId).sort(),
    // A click on a step (pointerdown + pointerup, no move), with modifiers such as { ctrlKey: true }
    click(id, m = {}) { const p = centre(node(id)); node(id).dispatchEvent(ev('pointerdown', p.x, p.y, m)); window.dispatchEvent(ev('pointerup', p.x, p.y, m)); node(id).dispatchEvent(new MouseEvent('click', Object.assign({ bubbles: true, clientX: p.x, clientY: p.y }, m))); },
    // Drag a step by (dx, dy) screen px, or to the point (to.x, to.y); m applies to the moves and the release
    drag(id, dx, dy, m = {}, to = null) {
      const p = centre(node(id)), q = to || { x: p.x + dx, y: p.y + dy };
      node(id).dispatchEvent(ev('pointerdown', p.x, p.y));
      for (const k of [0.25, 0.5, 0.75, 1]) window.dispatchEvent(ev('pointermove', p.x + (q.x - p.x) * k, p.y + (q.y - p.y) * k, m));
      window.dispatchEvent(ev('pointerup', q.x, q.y, m));
    },
    // A drag on blank canvas from (x0, y0) to (x1, y1): with Shift it draws a selection box, without it pans
    blankDrag(x0, y0, x1, y1, m = {}) {
      const el = document.elementFromPoint(x0, y0);
      el.dispatchEvent(ev('pointerdown', x0, y0, m));
      window.dispatchEvent(ev('pointermove', (x0 + x1) / 2, (y0 + y1) / 2, m));
      const box = document.querySelector('.marquee');
      const shown = !!box && box.getBoundingClientRect().width > 0;
      window.dispatchEvent(ev('pointermove', x1, y1, m));
      window.dispatchEvent(ev('pointerup', x1, y1, m));
      return { target: el.className, shown, left: !document.querySelector('.marquee') };
    },
    // Union of the steps' boxes, grown by pad
    boxAround(ids, pad = 8) {
      const rs = ids.map(id => node(id).getBoundingClientRect());
      return { l: Math.min(...rs.map(r => r.left)) - pad, t: Math.min(...rs.map(r => r.top)) - pad, r: Math.max(...rs.map(r => r.right)) + pad, b: Math.max(...rs.map(r => r.bottom)) + pad };
    },
    // A screen point in the middle of an arrow (from -> to)
    arrowPoint(from, to) {
      const p = document.querySelector('.connector-path[data-from="' + from + '"][data-to="' + to + '"]');
      const L = p.getTotalLength(), q = p.getPointAtLength(L / 2), m = p.getScreenCTM();
      return { x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f };
    },
    // The middle of a lane's track, and the offset from a step's centre to it
    toLane(id, laneId) { const c = centre(node(id)), r = document.querySelector('.lane-track[data-lane-id="' + laneId + '"]').getBoundingClientRect();
      return { dx: r.left + r.width / 2 - c.x, dy: r.top + r.height / 2 - c.y }; },
    // The page's state lives inside its script, so it is read from the DOM
    lanes: (ids) => ids.map(id => node(id).closest('.lane-track').dataset.laneId),
    ids: () => [...document.querySelectorAll('.flow-node[data-node-id]')].map(n => n.dataset.nodeId).sort(),
    arrows: () => [...document.querySelectorAll('.connector-path')].map(p => p.dataset.from + '>' + p.dataset.to).sort(),
    graph: () => JSON.stringify({ n: [...document.querySelectorAll('.flow-node[data-node-id]')].map(n => [n.dataset.nodeId, n.closest('.lane-track').dataset.laneId]).sort(),
      e: [...document.querySelectorAll('.connector-path')].map(p => [p.dataset.edgeId, p.dataset.from, p.dataset.to]).sort() }),
    // graph plus every step's position: equal before and after means nothing changed
    full: () => JSON.stringify([__t.graph(), [...document.querySelectorAll('.flow-node[data-node-id]')].map(n => [n.dataset.nodeId, n.style.left, n.style.top]).sort()]),
    pan: () => document.getElementById('stage').style.transform,
    hint: () => (document.querySelector('.flow-hint') || {}).textContent || '',
    clearHint: () => { const h = document.querySelector('.flow-hint'); if (h) h.remove(); },
    canUndo: () => !document.getElementById('btn-undo').disabled,
  };
})()`;

// The audit score of a diagram (the Python engine lays it out again and scores it)
const tmp = mkdtempSync(join(tmpdir(), 'e2e_ms_'));
function auditScore(json) {
  const f = join(tmp, `d${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, json);
  const r = spawnSync('python3', [join(root, 'scripts', 'layout_engine.py'), '--layout', f, '-o', f.replace(/\.json$/, '.html')], { encoding: 'utf8' });
  const m = /Quality Score: (\d+)/.exec((r.stdout || '') + (r.stderr || ''));
  return m ? Number(m[1]) : -1;
}

// The diagram as saved (Ctrl+S writes the page's data block), for the audit
async function saved() {
  await t.ev(t.key('s', { ctrlKey: true }));
  await t.ev(`new Promise(r => setTimeout(r, 250))`);
  return t.ev(`document.getElementById('diagram-data').textContent`);
}

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
const open = async (page, query = '', tb = false) => {
  await t.open(page, query);
  await t.ev(HELPERS);
  if (tb) {
    await t.ev(`document.getElementById('btn-direction').click()`);
    await t.ev(`new Promise(r => setTimeout(r, 300))`);
  }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const esc = () => t.ev(`__t.clearHint(), ${t.key('Escape')}`);
let code = 0;
try {
  // --- 1. Selection model (loan application, left to right) ---
  await open(loan);
  const all = await t.ev(`__t.ids()`);

  await t.ev(`__t.click('n2')`);
  t.check('a plain click still selects one step, with its ports and a plain "Delete"',
    same(await t.ev(`__t.sel()`), ['n2']) && !(await t.ev(`document.getElementById('swimlanes-container').classList.contains('multi-select')`))
    && (await t.ev(`document.querySelector('#btn-delete-selection .btn-label').textContent`)) === 'Delete');

  await t.ev(`__t.click('n5', { ctrlKey: true })`);
  const two = await t.ev(`__t.sel()`);
  const dock = await t.ev(`new Promise(r => requestAnimationFrame(() => r([document.querySelector('#btn-delete-selection .btn-label').textContent,
    document.getElementById('btn-delete-selection').classList.contains('show')])))`);
  const portsHidden = await t.ev(`getComputedStyle(document.querySelector('#node-n2 .port')).display === 'none'`);
  t.check('Ctrl+click adds a step; the dock shows "Delete 2" and connect ports hide', same(two, ['n2', 'n5']) && dock[0] === 'Delete 2' && dock[1] && portsHidden,
    `sel=${JSON.stringify(two)} dock=${JSON.stringify(dock)} portsHidden=${portsHidden}`);
  await t.ev(`__t.click('n5', { metaKey: true })`);
  t.check('Ctrl/Cmd+click on a selected step takes it out', same(await t.ev(`__t.sel()`), ['n2']));

  await t.ev(`__t.click('n2')`);
  await t.ev(`__t.click('n6', { shiftKey: true })`);
  const run = await t.ev(`__t.sel()`);
  t.check('Shift+click selects the run along the arrows from the anchor', same(run, ['n2', 'n3', 'n5', 'n6']), JSON.stringify(run));
  await t.ev(`__t.click('n4')`);
  await t.ev(`__t.click('n2', { shiftKey: true })`);
  const back = await t.ev(`__t.sel()`);
  t.check('Shift+click does not follow a loop-back arrow (n4 -> n2 is feedback, so the run is n2 n3 n4)', same(back, ['n2', 'n3', 'n4']), JSON.stringify(back));
  await t.ev(`__t.click('n8')`);
  await t.ev(`__t.click('n9', { shiftKey: true })`);
  const noPath = await t.ev(`__t.sel()`);
  t.check('Shift+click with no path along the arrows adds the step (as Ctrl+click)', same(noPath, ['n8', 'n9']), JSON.stringify(noPath));
  // Shift+click with a note selected still links the note: covered by e2e_notes.mjs

  // Selection box
  await esc();
  const b = await t.ev(`__t.boxAround(['n2', 'n3'])`);
  const box = await t.ev(`__t.blankDrag(${b.l}, ${b.t}, ${b.r}, ${b.b}, { shiftKey: true })`);
  const boxed = await t.ev(`__t.sel()`);
  t.check('Shift+drag on blank canvas draws a box and selects exactly the steps it touches', box.shown && box.left && same(boxed, ['n2', 'n3']),
    `${JSON.stringify(box)} sel=${JSON.stringify(boxed)}`);
  const b3 = await t.ev(`__t.boxAround(['n3'])`);
  const b5 = await t.ev(`__t.boxAround(['n5'])`);
  await t.ev(`__t.blankDrag(${b3.l}, ${b3.t}, ${b3.r}, ${b3.b}, { shiftKey: true, ctrlKey: true })`);
  await t.ev(`__t.blankDrag(${b5.l}, ${b5.t}, ${b5.r}, ${b5.b}, { shiftKey: true, ctrlKey: true })`);
  const toggled = await t.ev(`__t.sel()`);
  t.check('Ctrl+Shift+drag toggles the steps it touches', same(toggled, ['n2', 'n5']), JSON.stringify(toggled));
  const pan0 = await t.ev(`__t.pan()`);
  const pan = await t.ev(`__t.blankDrag(${b.l}, ${b.t}, ${b.r}, ${b.b})`);
  const pan1 = await t.ev(`__t.pan()`);
  t.check('a plain blank-canvas drag still pans and selects nothing', !pan.shown && !same(pan0, pan1) && same(await t.ev(`__t.sel()`), []),
    `${JSON.stringify(pan)} pan ${pan0} -> ${pan1}`);

  await t.ev(t.key('a', { ctrlKey: true }));
  const everything = await t.ev(`__t.sel()`);
  t.check('Ctrl+A selects every step', same(everything, all), JSON.stringify(everything));
  await esc();
  t.check('Escape clears a multi-selection', same(await t.ev(`__t.sel()`), []));
  const typed = await t.ev(`(() => { const f = document.getElementById('chart-title'); f.contentEditable = 'true'; f.focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true })); const s = __t.sel(); f.blur(); f.contentEditable = 'false'; return s.length; })()`);
  t.check('Ctrl+A while typing in a field is left to the browser', typed === 0, `selected=${typed}`);

  // Delete three steps: one edit, one undo
  const g0 = await t.ev(`__t.full()`);
  await t.ev(`__t.click('n4')`);
  await t.ev(`__t.click('n5', { ctrlKey: true })`);
  await t.ev(`__t.click('n7', { ctrlKey: true })`);
  await t.ev(t.key('Delete'));
  const afterDel = await t.ev(`({ n: __t.ids().length, dangling: __t.arrows().filter(a => /\\b(n4|n5|n7)\\b/.test(a)).length })`);
  t.check('Delete with 3 steps selected removes the 3 steps and their arrows',
    afterDel.n === all.length - 3 && afterDel.dangling === 0, JSON.stringify(afterDel));
  await t.ev(t.key('z', { ctrlKey: true }));
  t.check('one Ctrl+Z restores all of it (one undo step)', (await t.ev(`__t.full()`)) === g0 && same(await t.ev(`__t.sel()`), []));

  // --- 2. Move to another lane ---
  await t.ev(`__t.click('n2')`);
  await t.ev(`__t.click('n3', { ctrlKey: true })`);
  const d1 = await t.ev(`__t.toLane('n2', 'lane-engine')`);
  await t.ev(`__t.drag('n2', ${d1.dx}, ${d1.dy})`);
  const moved = await t.ev(`__t.lanes(['n2', 'n3'])`);
  t.check('dragging 2 selected steps onto another lane moves both and keeps the selection',
    same(moved, ['lane-engine', 'lane-engine']) && same(await t.ev(`__t.sel()`), ['n2', 'n3']),
    `lanes=${JSON.stringify(moved)}`);
  t.check('the group move re-lays out the diagram (nothing rewired)', (await t.ev(`__t.arrows()`)).length === 10
    && (await t.ev(`(() => { const pos = () => JSON.stringify([...document.querySelectorAll('.flow-node')].map(n => [n.dataset.nodeId, n.style.left, n.style.top]));
      const a = pos(); document.getElementById('btn-auto-tidy').click(); return a === pos(); })()`)));
  await t.ev(t.key('z', { ctrlKey: true }));
  t.check('one Ctrl+Z puts both back (one undo step)', (await t.ev(`__t.full()`)) === g0);

  await t.ev(`__t.click('n4')`);
  await t.ev(`__t.click('n2', { ctrlKey: true })`);
  const d2 = await t.ev(`__t.toLane('n2', 'lane-engine')`);
  await t.ev(`__t.drag('n2', ${d2.dx}, ${d2.dy})`);
  const spread = await t.ev(`__t.lanes(['n4', 'n2'])`);
  t.check('a selection spanning two lanes keeps its lane offset', same(spread, ['lane-officer', 'lane-engine']), JSON.stringify(spread));
  await t.ev(t.key('z', { ctrlKey: true }));

  await t.ev(`__t.click('n2')`);
  await t.ev(`__t.click('n3', { ctrlKey: true })`);
  await t.ev(t.key('ArrowDown', { altKey: true }));
  const altDown = await t.ev(`__t.lanes(['n2', 'n3'])`);
  await t.ev(t.key('ArrowUp', { altKey: true }));
  const altUp = await t.ev(`__t.lanes(['n2', 'n3'])`);
  await t.ev(t.key('ArrowDown', { altKey: true }));
  await t.ev(t.key('z', { ctrlKey: true }));
  t.check('Alt+Down moves the selection one lane down, Alt+Up back, each one undo step',
    same(altDown, ['lane-engine', 'lane-engine']) && same(altUp, ['lane-officer', 'lane-officer']) && (await t.ev(`__t.full()`)) === g0,
    `${altDown} / ${altUp}`);
  await t.ev(`__t.click('n7')`);
  await t.ev(`__t.click('n5', { ctrlKey: true })`);
  await t.ev(t.key('ArrowDown', { altKey: true }));
  t.check('Alt+Down stops at the last lane (the selection keeps its shape)', (await t.ev(`__t.full()`)) === g0);

  // Refusals: Alt+drag of a selection that is not a run, or one with Start/End, shows a hint and changes nothing
  const g1 = await t.ev(`__t.full()`);
  await esc();
  await t.ev(`__t.click('n2')`);
  await t.ev(`__t.click('n4', { ctrlKey: true })`);
  let q = await t.ev(`__t.arrowPoint('n5', 'n6')`);
  await t.ev(`__t.drag('n2', 0, 0, { altKey: true }, ${JSON.stringify(q)})`);
  const hint1 = await t.ev(`__t.hint()`);
  t.check('Alt+drag of a selection that is not a run: hint, no change', /one way in, one way out/.test(hint1) && (await t.ev(`__t.full()`)) === g1, hint1);
  await esc();
  await t.ev(`__t.click('n1')`);
  await t.ev(`__t.click('n2', { ctrlKey: true })`);
  q = await t.ev(`__t.arrowPoint('n5', 'n6')`);
  await t.ev(`__t.drag('n2', 0, 0, { altKey: true }, ${JSON.stringify(q)})`);
  const hint2 = await t.ev(`__t.hint()`);
  t.check('Alt+drag of a selection containing Start: hint, no change', /one way in, one way out/.test(hint2) && (await t.ev(`__t.full()`)) === g1, hint2);
  await esc();
  await t.ev(`__t.click('n5')`);
  q = await t.ev(`__t.arrowPoint('n6', 'n7')`);
  // Without Alt, a connected step dragged across an arrow is never rewired (only its lane changes)
  await t.ev(`__t.drag('n5', 0, 0, {}, ${JSON.stringify(q)})`);
  t.check('without Alt, dragging a connected step over an arrow rewires nothing', same(await t.ev(`__t.arrows()`), JSON.parse(JSON.parse(g1)[0]).e.map(e => e[1] + '>' + e[2]).sort()));

  if (shot) {
    await open(loan);
    await t.ev(`__t.click('n2')`);
    await t.ev(`__t.click('n3', { shiftKey: true })`);
    await t.ev(`__t.click('n5', { ctrlKey: true })`);
    await t.ev(`__t.click('n6', { ctrlKey: true })`);
    await t.ev(`new Promise(r => setTimeout(r, 300))`);
    const img = await t.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(shot, Buffer.from(img.data, 'base64'));
    console.log(`[INFO] screenshot of a 4-step selection: ${shot}`);
  }

  // --- 3. Reorder (a straight chain across lanes), left to right and top to bottom ---
  for (const tb of [false, true]) {
    const dir = tb ? 'top to bottom' : 'left to right';
    await open(zigzag, '', tb);
    const score0 = auditScore(await saved()), start = await t.ev(`__t.full()`);
    // Run n4 n5 (n3 -> n4 -> n5 -> n6) moved into the earlier arrow n1 -> n2
    await t.ev(`__t.click('n4')`);
    await t.ev(`__t.click('n5', { shiftKey: true })`);
    q = await t.ev(`__t.arrowPoint('n1', 'n2')`);
    await t.ev(`__t.drag('n4', 0, 0, { altKey: true }, ${JSON.stringify(q)})`);
    const arrows = await t.ev(`__t.arrows()`);
    const want = ['n1>n4', 'n2>n3', 'n3>n6', 'n4>n5', 'n5>n2', 'n6>n7'];
    const score1 = auditScore(await saved());
    t.check(`Alt+drag of a 2-step run onto an earlier arrow rewires it there (${dir})`, same(arrows, want), JSON.stringify(arrows));
    t.check(`... with no duplicate arrows, the audit score unchanged or better, selection kept (${dir})`,
      new Set(arrows).size === arrows.length && score1 >= score0 && same(await t.ev(`__t.sel()`), ['n4', 'n5']),
      `score ${score0} -> ${score1}`);
    await t.ev(t.key('z', { ctrlKey: true }));
    t.check(`one Ctrl+Z undoes the reorder (${dir})`, (await t.ev(`__t.full()`)) === start);

    // Alt + arrow along the flow: right/down (later) and left/up (earlier) follow the screen
    const later = tb ? 'ArrowDown' : 'ArrowRight', earlier = tb ? 'ArrowUp' : 'ArrowLeft', across = tb ? 'ArrowRight' : 'ArrowDown';
    await t.ev(`__t.click('n3')`);
    await t.ev(t.key(later, { altKey: true }));
    const fwd = await t.ev(`__t.arrows()`);
    t.check(`Alt+${later} moves the step one later in the flow (${dir})`, same(fwd, ['n1>n2', 'n2>n4', 'n3>n5', 'n4>n3', 'n5>n6', 'n6>n7']), JSON.stringify(fwd));
    await t.ev(t.key('z', { ctrlKey: true }));
    await t.ev(`__t.click('n3')`);
    await t.ev(t.key(earlier, { altKey: true }));
    const bwd = await t.ev(`__t.arrows()`);
    t.check(`Alt+${earlier} moves it one earlier (${dir})`, same(bwd, ['n1>n3', 'n2>n4', 'n3>n2', 'n4>n5', 'n5>n6', 'n6>n7']), JSON.stringify(bwd));
    await t.ev(t.key('z', { ctrlKey: true }));
    await t.ev(`__t.clearHint(), __t.click('n2')`);
    await t.ev(t.key(earlier, { altKey: true }));
    t.check(`Alt+${earlier} next to Start: hint, no change (${dir})`, (await t.ev(`__t.full()`)) === start && /one arrow in and one arrow out/.test(await t.ev(`__t.hint()`)));

    // Lane moves follow the screen too
    await t.ev(`__t.click('n2')`);
    await t.ev(`__t.click('n4', { ctrlKey: true })`);
    await t.ev(t.key(across, { altKey: true }));
    t.check(`Alt+${across} moves the selection one lane over (${dir})`, same(await t.ev(`__t.lanes(['n2', 'n4'])`), ['lane-c', 'lane-c']));
    await t.ev(t.key('z', { ctrlKey: true }));
    await t.ev(`__t.click('n2')`);
    await t.ev(`__t.click('n4', { ctrlKey: true })`);
    const d = await t.ev(`__t.toLane('n2', 'lane-a')`);
    await t.ev(`__t.drag('n2', ${d.dx}, ${d.dy})`);
    t.check(`dragging 2 selected steps onto another lane moves both (${dir})`, same(await t.ev(`__t.lanes(['n2', 'n4'])`), ['lane-a', 'lane-a']) && t.errors.length === 0, t.errors.join(' | '));
  }

  // --- 4. Connector pair: a moved step takes its circle along, and the pair stays intact ---
  for (const auto of [true, false]) {
    await open(connector);
    await t.ev(`(document.getElementById('btn-auto-layout').getAttribute('aria-checked') === 'true') !== ${auto} && document.getElementById('btn-auto-layout').click()`);
    const pairOk = `(() => { const c1 = __t.node('c1'), c2 = __t.node('c2'), a = __t.arrows();
      return !!c1 && !!c2 && c1.textContent.trim() === c2.textContent.trim() && a.includes('n4>c1') && a.includes('c2>n8'); })()`;
    await t.ev(`__t.click('n8')`);
    await t.ev(`__t.click('n9', { ctrlKey: true })`);
    await t.ev(t.key('ArrowUp', { altKey: true }));
    const circle = await t.ev(`(() => { const c = __t.node('c2').getBoundingClientRect(), n = __t.node('n8').getBoundingClientRect();
      return { lane: __t.node('n8').closest('.lane-track').dataset.laneId, gap: Math.hypot(c.left + c.width / 2 - (n.left + n.width / 2), c.top + c.height / 2 - (n.top + n.height / 2)) / (n.width || 1) }; })()`);
    t.check(`moving a step with a circle: the circle follows and the pair is intact (auto layout ${auto ? 'on' : 'off'})`,
      circle.lane === 'lane-assessor' && circle.gap < 2.5 && (await t.ev(pairOk)) && t.errors.length === 0, `${JSON.stringify(circle)} ${t.errors.join(' | ')}`);
  }

  // --- 5. Present mode: none of the gestures do anything ---
  await open(loan, '?present');
  await t.ev(t.key('a', { ctrlKey: true }));
  const pb = await t.ev(`__t.boxAround(['n2', 'n3'])`);
  const pbox = await t.ev(`__t.blankDrag(${pb.l}, ${pb.t}, ${pb.r}, ${pb.b}, { shiftKey: true })`);
  t.check('present mode: Ctrl+A and Shift+drag select nothing', same(await t.ev(`__t.sel()`), []) && !pbox.shown);
} catch (e) {
  console.error('[ERROR]', e.message);
  code = 1;
} finally {
  await t.close();
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(code || t.finish());
