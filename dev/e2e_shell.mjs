// Interaction test for the shared shell through the flowchart plugin (the shell is type-independent;
// dev/e2e_sequence.mjs covers the second plugin). Driven over the Chrome DevTools Protocol, see cdp.mjs.
//
//   node dev/e2e_shell.mjs --browser <chrome> --laid <laid-out.html> --scrambled <scrambled-positions.html>
//
// --laid:      page produced by `layout_engine.py --layout` (reference positions)
// --scrambled: same diagram with node x/y scrambled (Auto-Tidy must restore the reference positions)
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser'), laid = argOf('laid'), scrambled = argOf('scrambled');
if (!browser || !laid || !scrambled) { console.error('usage: --browser <chrome> --laid <html> --scrambled <html>'); process.exit(1); }

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
try {
  const positions = `JSON.stringify([...document.querySelectorAll('.flow-node')].map(n => [n.dataset.nodeId, n.style.left, n.style.top]).sort())`;

  // 1. Load: plugin registered, content rendered, no errors
  await t.open(laid);
  const refPositions = await t.ev(positions);
  const nodeCount = await t.ev(`document.querySelectorAll('.flow-node').length`);
  t.check('laid-out page renders nodes without errors', nodeCount > 0 && t.errors.length === 0, `nodes=${nodeCount} errors=${t.errors.join(' | ')}`);

  // 2. Selection + Delete key (shell keydown -> plugin.deleteSelection)
  const firstId = await t.ev(`document.querySelector('.flow-node').dataset.nodeId`);
  await t.ev(t.drag('.flow-node'));
  const selected = await t.ev(`!!document.querySelector('.flow-node.selected')`);
  await t.ev(t.key('Delete'));
  const afterDelete = await t.ev(`document.querySelectorAll('.flow-node').length`);
  const gone = await t.ev(`!document.querySelector('.flow-node[data-node-id="${firstId}"]')`);
  t.check('Delete key removes the selected node via plugin.deleteSelection', selected && afterDelete === nodeCount - 1 && gone, `selected=${selected} before=${nodeCount} after=${afterDelete}`);

  // 2b. Undo / redo (shell history snapshots taken at updateStatus(true))
  await t.ev(t.key('z', { ctrlKey: true }));
  const afterUndo = await t.ev(`document.querySelectorAll('.flow-node').length`);
  const backAgain = await t.ev(`!!document.querySelector('.flow-node[data-node-id="${firstId}"]')`);
  const undoStatus = await t.ev(`document.getElementById('save-status').textContent`);
  t.check('Ctrl+Z restores the deleted node and clears the Unsaved badge', afterUndo === nodeCount && backAgain && !/unsaved/i.test(undoStatus), `after=${afterUndo} status=${undoStatus}`);
  await t.ev(t.key('y', { ctrlKey: true }));
  const afterRedo = await t.ev(`document.querySelectorAll('.flow-node').length`);
  t.check('Ctrl+Y redoes the delete', afterRedo === nodeCount - 1 && (await t.ev(`document.getElementById('btn-redo').disabled`)), `after=${afterRedo}`);

  // 2c. Lanes alternate white / grey (no lane-colour tint); click a lane pill + Delete removes the lane with its
  // steps; undo restores it
  const laneBgs = await t.ev(`[...document.querySelectorAll('.lane-track')].slice(0, 2).map(e => getComputedStyle(e).backgroundColor)`);
  t.check('lanes alternate two plain backgrounds', laneBgs.length === 2 && laneBgs[0] !== laneBgs[1]
    && laneBgs.every(c => { const [r, g, b] = c.match(/\d+/g).map(Number); return Math.max(r, g, b) - Math.min(r, g, b) <= 8; }), JSON.stringify(laneBgs));
  const lanesBefore = await t.ev(`document.querySelectorAll('.swimlane').length`);
  const nodesBefore = await t.ev(`document.querySelectorAll('.flow-node').length`);
  const laneNodes = await t.ev(`document.querySelectorAll('.swimlane:nth-child(2) .flow-node').length`);
  await t.ev(`document.querySelector('.swimlane:nth-child(2) .lane-pill').click()`);
  const laneSel = await t.ev(`!!document.querySelector('.swimlane:nth-child(2).lane-selected')`);
  await t.ev(t.key('Delete'));
  const lanesAfter = await t.ev(`document.querySelectorAll('.swimlane').length`);
  const nodesAfter = await t.ev(`document.querySelectorAll('.flow-node').length`);
  t.check('clicking a lane pill selects the lane and Delete removes it with its steps', laneSel && lanesAfter === lanesBefore - 1
    && nodesAfter === nodesBefore - laneNodes, `selected=${laneSel} lanes ${lanesBefore}->${lanesAfter} nodes ${nodesBefore}->${nodesAfter} (lane had ${laneNodes})`);
  await t.ev(t.key('z', { ctrlKey: true }));
  t.check('Ctrl+Z restores the deleted lane', (await t.ev(`document.querySelectorAll('.swimlane').length`)) === lanesBefore
    && (await t.ev(`document.querySelectorAll('.flow-node').length`)) === nodesBefore);

  // 3. Background click clears selection (shell pointerdown -> plugin.isBackground/clearSelection); Escape is safe
  await t.ev(`document.getElementById('viewport').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5, pointerId: 1 }))`);
  await t.ev(`window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))`);
  await t.ev(t.key('Escape'));
  t.check('background click and Escape leave no selection and raise no errors', (await t.ev(`!document.querySelector('.flow-node.selected')`)) && t.errors.length === 0, t.errors.join(' | '));

  // 4. Theme toggle (shell) re-renders through the plugin
  const before = await t.ev(`document.documentElement.getAttribute('data-theme')`);
  await t.ev(`document.getElementById('btn-theme').click()`);
  const afterTheme = await t.ev(`document.documentElement.getAttribute('data-theme')`);
  t.check('theme toggle flips data-theme and keeps the diagram', before !== afterTheme && (await t.ev(`document.querySelectorAll('.flow-node').length`)) === nodeCount - 1 && t.errors.length === 0, t.errors.join(' | '));

  // 5. Auto-Tidy button restores the reference layout from scrambled positions
  await t.open(scrambled);
  const scrambledPositions = await t.ev(positions);
  await t.ev(`document.getElementById('btn-auto-tidy').click()`);
  await sleep(300);
  const tidied = await t.ev(positions);
  const status = await t.ev(`document.getElementById('save-status').textContent`);
  t.check('scrambled page differs from the reference before Auto-Tidy', scrambledPositions !== refPositions);
  t.check('Auto-Tidy button restores the reference positions', tidied === refPositions, `got ${tidied.slice(0, 120)}...`);
  t.check('Auto-Tidy marks the document unsaved', /unsaved/i.test(status), status);

  // 6. Ctrl+S runs the shell save path without throwing (the file dialog itself needs a user click)
  await t.ev(t.key('s', { ctrlKey: true }));
  await sleep(500);
  t.check('Ctrl+S save path raises no errors', t.errors.length === 0, t.errors.join(' | '));

  // 7. Drag shapes out of the dock (flowchart plugin): empty canvas adds a node, an arrow gets the node spliced in
  await t.open(laid);
  const graph = `JSON.stringify({ n: document.querySelectorAll('.flow-node').length, e: document.querySelectorAll('.connector-path').length })`;
  // Screen points sampled along every arrow, so a test point can keep clear of them
  const pathPts = `[...document.querySelectorAll('.connector-path')].flatMap(p => { const L = p.getTotalLength(), m = p.getScreenCTM(), o = []; for (let s = 0; s <= L; s += 4) { const q = p.getPointAtLength(s); o.push([q.x * m.a + m.e, q.y * m.d + m.f]); } return o; })`;
  const paletteDrop = (type, x, y) => `(async () => {
    const b = document.querySelector('[data-node-type="${type}"]'), r = b.getBoundingClientRect();
    const o = (cx, cy) => ({ bubbles: true, button: 0, clientX: cx, clientY: cy, pointerId: 1, isPrimary: true });
    b.dispatchEvent(new PointerEvent('pointerdown', o(r.left + 10, r.top + 10)));
    window.dispatchEvent(new PointerEvent('pointermove', o(r.left + 30, r.top - 30)));
    window.dispatchEvent(new PointerEvent('pointermove', o(${x}, ${y})));
    const hl = !!document.querySelector('.connector-path.insert-target');
    window.dispatchEvent(new PointerEvent('pointerup', o(${x}, ${y})));
    b.click();   // the click a real drop onto the button would produce must be swallowed
    return hl;
  })()`;
  const g0 = JSON.parse(await t.ev(graph));
  const emptyPt = await t.ev(`(() => {
    const pts = ${pathPts}, nodes = [...document.querySelectorAll('.flow-node')].map(n => n.getBoundingClientRect());
    const vp = document.getElementById('viewport').getBoundingClientRect();
    for (let y = vp.top + 60; y < vp.bottom - 140; y += 16) for (let x = vp.left + 300; x < vp.right - 60; x += 16) {
      const el = document.elementFromPoint(x, y);
      if (!el || !el.classList.contains('lane-track')) continue;
      if (pts.some(([px, py]) => Math.hypot(px - x, py - y) < 90)) continue;
      if (nodes.some(r => x > r.left - 110 && x < r.right + 110 && y > r.top - 70 && y < r.bottom + 70)) continue;
      return [x, y, el.dataset.laneId];
    }
    return null;
  })()`);
  if (emptyPt) {
    const hl = await t.ev(paletteDrop('task', emptyPt[0], emptyPt[1]));
    const g1 = JSON.parse(await t.ev(graph));
    const lane = await t.ev(`document.querySelector('.flow-node.selected')?.parentElement.dataset.laneId`);
    t.check('dragging Step from the dock onto empty canvas adds exactly one node in the lane under the pointer', !hl && g1.n === g0.n + 1 && g1.e === g0.e && lane === emptyPt[2], `hl=${hl} before=${JSON.stringify(g0)} after=${JSON.stringify(g1)} lane=${lane} want=${emptyPt[2]}`);
    await t.ev(t.key('z', { ctrlKey: true }));
  } else t.check('found an empty canvas spot for the dock-drag test', false);

  // Drop onto the middle of an unlabelled arrow between two nodes
  const edgeInfo = await t.ev(`(() => {
    for (const p of document.querySelectorAll('.connector-path')) {
      const lbl = document.querySelector('.edge-label-container[data-edge-id="' + p.dataset.edgeId + '"] .edge-label-text');
      if (lbl && lbl.textContent.trim() && !/^\\+/.test(lbl.textContent.trim())) continue;
      const L = p.getTotalLength(), m = p.getScreenCTM();
      for (const f of [0.5, 0.35, 0.65]) {
        const q = p.getPointAtLength(L * f), x = q.x * m.a + m.e, y = q.y * m.d + m.f;
        const el = document.elementFromPoint(x, y);
        if (el && !el.closest('.flow-node') && !el.closest('.dock-area') && document.getElementById('viewport').contains(el)) return [p.dataset.edgeId, x, y];
      }
    }
    return null;
  })()`);
  if (edgeInfo) {
    // Arrow ends read from the hover highlight: hovering a node colours its incoming (hl-in) and outgoing (hl-out) arrows
    const endsOf = (edgeId) => t.ev(`(() => {
      const res = {};
      for (const n of document.querySelectorAll('.flow-node')) {
        n.dispatchEvent(new MouseEvent('mouseenter'));
        const p = [...document.querySelectorAll('.connector-path')].find(x => x.dataset.edgeId === ${JSON.stringify(edgeId)});
        if (p && p.classList.contains('hl-out')) res.from = n.dataset.nodeId;
        if (p && p.classList.contains('hl-in')) res.to = n.dataset.nodeId;
        n.dispatchEvent(new MouseEvent('mouseleave'));
      }
      return res;
    })()`);
    const ends0 = await endsOf(edgeInfo[0]);
    const ids = `JSON.stringify([...document.querySelectorAll('.flow-node')].map(n => n.dataset.nodeId))`;
    const idsBefore = JSON.parse(await t.ev(ids));
    const hl = await t.ev(paletteDrop('task', edgeInfo[1], edgeInfo[2]));
    const g2 = JSON.parse(await t.ev(graph));
    const newId = JSON.parse(await t.ev(ids)).find(id => !idsBefore.includes(id));
    t.check('dragging over an arrow highlights it, and dropping adds one node and one arrow', hl && g2.n === g0.n + 1 && g2.e === g0.e + 1 && !!newId, `hl=${hl} before=${JSON.stringify(g0)} after=${JSON.stringify(g2)}`);
    // The original arrow A->B now ends at the new node N, a new arrow N->B leaves it, and the tidy put N between A and B
    const ends1 = await endsOf(edgeInfo[0]);
    const outOfNew = await t.ev(`(() => {
      const n = document.getElementById('node-${newId}'); n.dispatchEvent(new MouseEvent('mouseenter'));
      const out = [...document.querySelectorAll('.connector-path.hl-out')].map(p => p.dataset.edgeId);
      n.dispatchEvent(new MouseEvent('mouseleave')); return out;
    })()`);
    const outEnds = outOfNew.length === 1 ? await endsOf(outOfNew[0]) : {};
    const xs = await t.ev(`[${JSON.stringify(ends0.from)}, ${JSON.stringify(newId)}, ${JSON.stringify(ends0.to)}].map(id => parseFloat(document.getElementById('node-' + id).style.left))`);
    t.check('the arrow is rewired A->new->B and the tidy keeps A <= new < B left to right (a cross-lane step may stack under A)', ends1.from === ends0.from && ends1.to === newId && outEnds.to === ends0.to && xs[0] <= xs[1] && xs[1] < xs[2],
      `before=${JSON.stringify(ends0)} after=${JSON.stringify(ends1)} newOut=${JSON.stringify(outEnds)} xs=${xs}`);
    await t.ev(t.key('z', { ctrlKey: true }));
    const g3 = JSON.parse(await t.ev(graph));
    t.check('one Ctrl+Z undoes the whole insert', g3.n === g0.n && g3.e === g0.e, JSON.stringify(g3));
  } else t.check('found an arrow for the insert test', false);

  // 7b. Lane hover: the lane under the pointer is lit, even while the pointer is over an arrow's label
  const hoverCheck = await t.ev(`(() => {
    const c = document.getElementById('swimlanes-container');
    const label = [...document.querySelectorAll('.edge-label-container')].find(l => l.getBoundingClientRect().width);
    const r = label.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const lane = [...document.querySelectorAll('.swimlane')].find(l => { const b = l.getBoundingClientRect(); return y >= b.top && y < b.bottom; });
    label.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
    const lit = [...document.querySelectorAll('.swimlane.lane-hover')];
    // The hovered lane's background token switches to the one shared highlight colour (white and grey lanes alike)
    const cs = getComputedStyle(lane);
    const ok = lit.length === 1 && lit[0] === lane && cs.getPropertyValue('--lane-bg').trim() === cs.getPropertyValue('--lane-hover-bg').trim();
    c.dispatchEvent(new PointerEvent('pointerleave'));
    return ok && !document.querySelector('.swimlane.lane-hover');
  })()`);
  t.check('the lane under the pointer is highlighted (also over an arrow label) and clears on leave', hoverCheck);

  // 8. Lane name pills (no header column): every lane always shows its pill at the visible top-left; a gutter
  //    indents the nodes so no pill sits on one at any zoom; the pill follows the viewport's left edge when
  //    panned, scales with the diagram, and exports at the lane's own top-left
  const pills = `(() => { const vp = document.getElementById('viewport').getBoundingClientRect();
    return [...document.querySelectorAll('.lane-pill')].filter(p => getComputedStyle(p).display !== 'none')
      .map(p => { const r = p.getBoundingClientRect(), k = r.width / p.offsetWidth, laneEl = p.closest('.swimlane'), lane = laneEl.getBoundingClientRect();
        const firstNode = Math.min(...[...laneEl.querySelectorAll('.flow-node')].map(n => n.getBoundingClientRect().left));
        return { dx: Math.round(r.left - vp.left), laneDx: Math.round(r.left - lane.left), clear: Math.round(firstNode - r.right), px: Math.round(parseFloat(getComputedStyle(p).fontSize) * k * 10) / 10 }; }); })()`;
  const laneCount = await t.ev(`document.querySelectorAll('.swimlane').length`);
  const zoom = `parseInt(document.getElementById('zoom-level').textContent) / 100`;
  const atRest = await t.ev(pills);
  for (let i = 0; i < 6; i++) await t.ev(`document.getElementById('btn-zoom-out').click()`);
  const restOut = await t.ev(pills);
  await t.ev(`document.getElementById('btn-zoom-reset').click()`);
  t.check("no header column: every lane shows its pill at its top-left, clear of the lane's nodes at any zoom",
    !(await t.ev(`!!document.querySelector('.lane-header')`)) && atRest.length === laneCount
      && [...atRest, ...restOut].every(p => p.laneDx >= 3 && p.laneDx <= 20 && p.clear > 0),
    `fit=${JSON.stringify(atRest)} zoomedOut=${JSON.stringify(restOut)}`);
  await t.ev(`document.getElementById('viewport').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 900, deltaY: 0, deltaMode: 0, clientX: 600, clientY: 400 }))`);
  const shown = await t.ev(pills), z1 = await t.ev(zoom);
  t.check('after panning right, every pill sits at the viewport left edge',
    shown.length === laneCount && shown.every(p => Math.abs(p.dx - 12 * z1) <= 2), `shown=${JSON.stringify(shown)} zoom=${z1}`);
  t.check('pill text scales with the diagram (14px at 100%)', shown.every(p => Math.abs(p.px - 14 * z1) <= 0.6), `px=${shown.map(p => p.px)} zoom=${z1}`);
  // An export taken while panned draws every pill once, at its lane's own top-left (no view offset)
  const svgText = await t.ev(`new Promise(res => {
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { URL.createObjectURL = orig; b.text().then(res); return 'blob:x'; };
    document.querySelector('[data-export="svg"]').click();
  })`);
  const laneNames = await t.ev(`[...document.querySelectorAll('.lane-title')].map(t => t.textContent)`);
  const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const counts = laneNames.map(n => svgText.split('>' + esc(n) + '<').length - 1);
  const pillMoves = [...svgText.matchAll(/matrix\(1, 0, 0, 1, ([\d.]+), ([\d.]+)\)/g)].filter(m => +m[1] === 12 && +m[2] === 12).length;
  t.check("SVG export names every lane once, with pills at the lanes' own top-left", counts.every(c => c === 1) && pillMoves === laneCount, `counts=${counts} pillsAtLaneCorner=${pillMoves}/${laneCount}`);
  await t.ev(`document.getElementById('btn-zoom-reset').click()`);
  const afterFit = await t.ev(pills);
  t.check("Fit brings the pills back to the lanes' top-left", afterFit.every(p => p.laneDx >= 3 && p.laneDx <= 20), JSON.stringify(afterFit));
  // Rename by double-clicking the pill's name
  const renamed = await t.ev(`(async () => {
    const title = document.querySelector('.lane-pill .lane-title');
    title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const editing = title.isContentEditable;
    title.textContent = 'Renamed Lane';
    title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // Headless Chrome has no window focus, so Enter's blur() fires no blur event there: deliver it by hand
    if (title.isContentEditable) title.dispatchEvent(new FocusEvent('blur'));
    await new Promise(r => setTimeout(r, 50));
    const ok = editing && document.querySelector('.lane-pill .lane-title').textContent === 'Renamed Lane' && /unsaved/i.test(document.getElementById('save-status').textContent);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    return ok;
  })()`);
  t.check('double-clicking a pill renames the lane (undoable)', renamed);

  // 9. No-swimlane mode ("swimlanes": false)
  const nolanes = argOf('nolanes');
  if (nolanes) {
    await t.open(nolanes);
    const visiblePills = `[...document.querySelectorAll('.lane-pill')].filter(h => getComputedStyle(h).display !== 'none').length`;
    const visible = await t.ev(visiblePills);
    const n = await t.ev(`document.querySelectorAll('.flow-node').length`);
    const label = await t.ev(`document.querySelector('#btn-add-lane .btn-label').textContent`);
    t.check('swimlanes:false renders the nodes with no lane pill', n > 0 && visible === 0 && t.errors.length === 0, `nodes=${n} pills=${visible} errors=${t.errors.join(' | ')}`);
    await t.ev(`document.getElementById('btn-add-lane').click()`);
    const shown = await t.ev(visiblePills);
    t.check('the Lane button ("' + label + '") turns swimlanes back on', shown === 1, `pills=${shown}`);
  }

  // 9a. Mouse wheel: scrolls the canvas (Shift: sideways); Ctrl + wheel zooms one gentle step per notch
  await t.open(laid);
  const view = `(() => { const r = document.getElementById('swimlanes-container').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), z: parseInt(document.getElementById('zoom-level').textContent) }; })()`;
  const wheel = (o) => `document.getElementById('viewport').dispatchEvent(new WheelEvent('wheel', Object.assign({ bubbles: true, cancelable: true, deltaX: 0, deltaY: 0, deltaMode: 0, clientX: 600, clientY: 400 }, ${JSON.stringify(o)})))`;
  const w0 = await t.ev(view);
  await t.ev(wheel({ deltaY: 100 }));
  const w1 = await t.ev(view);
  await t.ev(wheel({ deltaY: 100, shiftKey: true }));
  const w2 = await t.ev(view);
  await t.ev(wheel({ deltaY: 10 }));
  const w3 = await t.ev(view);
  t.check('a wheel notch scrolls the canvas 40px vertically (Shift: sideways) without zooming; small trackpad deltas stay 1:1',
    w1.y === w0.y - 40 && w1.x === w0.x && w1.z === w0.z && w2.x === w1.x - 40 && w2.y === w1.y && w2.z === w0.z && w3.y === w2.y - 10,
    JSON.stringify([w0, w1, w2, w3]));
  await t.ev(wheel({ deltaY: -100, ctrlKey: true }));
  const zA = (await t.ev(view)).z;
  await t.ev(wheel({ deltaY: -100, ctrlKey: true }));
  const zB = (await t.ev(view)).z;
  t.check('Ctrl + wheel zooms in one ~15% step per notch, not to the zoom limit',
    zA > w0.z && zA <= Math.ceil(w0.z * 1.16) && zB > zA && zB <= Math.ceil(zA * 1.16), `zoom ${w0.z}% -> ${zA}% -> ${zB}%`);

  // 9b. Top-to-bottom layout: the dock's direction toggle lays the diagram out vertically (lanes as columns),
  //     is saved in the data ("direction": "TB") so the file reopens vertical, and toggling back restores the
  //     left-to-right layout exactly
  await t.open(laid);
  const refLaid = await t.ev(positions);
  await t.ev(`document.getElementById('btn-direction').click()`);
  await sleep(300);
  const columns = `(() => {
    const lanes = [...document.querySelectorAll('.swimlane')].map(l => l.getBoundingClientRect());
    const sideBySide = lanes.every((r, i) => i === 0 || (r.left >= lanes[i - 1].right - 2 && Math.abs(r.top - lanes[0].top) < 1));
    const nodes = [...document.querySelectorAll('.flow-node')].map(n => ({ r: n.getBoundingClientRect(), lane: n.closest('.swimlane').getBoundingClientRect() }));
    const inLane = nodes.every(({ r, lane }) => r.left >= lane.left - 1 && r.right <= lane.right + 1);
    const overlaps = nodes.filter((a, i) => nodes.some((b, j) => j > i && a.r.left < b.r.right && b.r.left < a.r.right && a.r.top < b.r.bottom && b.r.top < a.r.bottom)).length;
    const pills = [...document.querySelectorAll('.swimlane')].map(l => { const p = l.querySelector('.lane-pill').getBoundingClientRect(), r = l.getBoundingClientRect(); return { dy: Math.round(p.top - r.top), inside: p.left >= r.left && p.right <= r.right + 1, off: Math.round((p.left + p.right) / 2 - (r.left + r.right) / 2) }; });
    const firstNodeTop = Math.min(...nodes.map(n => n.r.top)), pillBottom = Math.max(...[...document.querySelectorAll('.lane-pill')].map(p => p.getBoundingClientRect().bottom));
    return { tb: document.getElementById('swimlanes-container').classList.contains('dir-tb'), sideBySide, inLane, overlaps, pills, clear: firstNodeTop > pillBottom,
      label: document.querySelector('#btn-direction .btn-label').textContent, arrows: document.querySelectorAll('.connector-path').length, status: document.getElementById('save-status').textContent };
  })()`;
  const v = await t.ev(columns);
  t.check('the Vertical toggle lays lanes out as side-by-side columns with every node inside its column, none overlapping',
    v.tb && v.sideBySide && v.inLane && v.overlaps === 0 && v.arrows > 0 && v.label === 'Horizontal' && /unsaved/i.test(v.status) && t.errors.length === 0,
    JSON.stringify(v) + ' ' + t.errors.join(' | '));
  t.check('vertical: every pill sits centred at the top of its own column, above the first node',
    v.pills.every(p => p.dy >= 3 && p.dy <= 20 && p.inside && Math.abs(p.off) <= 1) && v.clear, JSON.stringify(v.pills));
  await t.ev(`document.getElementById('viewport').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 0, deltaY: 500, deltaMode: 0, clientX: 600, clientY: 400 }))`);
  await sleep(100);
  const pinnedTop = await t.ev(`(() => { const vp = document.getElementById('viewport').getBoundingClientRect(), c = document.getElementById('swimlanes-container').getBoundingClientRect();
    return { below: c.top < vp.top, dy: [...document.querySelectorAll('.lane-pill')].map(p => Math.round(p.getBoundingClientRect().top - vp.top)) }; })()`);
  t.check('vertical: after panning down, every pill sits at the viewport top edge',
    pinnedTop.below && pinnedTop.dy.every(d => d >= 4 && d <= 20), JSON.stringify(pinnedTop));
  // Save, then reopen the saved file: it opens vertical
  await t.ev(t.key('s', { ctrlKey: true }));
  await sleep(400);
  // (as the shell's save does: the page's file with its diagram-data block replaced)
  const savedJson = await t.ev(`document.getElementById('diagram-data').textContent`);
  const savedHtml = readFileSync(laid, 'utf8').replace(/(<script id="diagram-data" type="application\/json">)[\s\S]*?(<\/script>)/, (m, a, b) => a + savedJson + b);
  const savedFile = join(mkdtempSync(join(tmpdir(), 'tb_')), 'vertical.html');
  writeFileSync(savedFile, savedHtml);
  t.check('vertical: Save writes "direction": "TB" into the diagram data', /"direction":\s*"TB"/.test(savedHtml));
  await t.open(savedFile);
  const reopened = await t.ev(columns);
  t.check('vertical: the saved file reopens top-to-bottom', reopened.tb && reopened.sideBySide && reopened.overlaps === 0 && reopened.label === 'Horizontal' && t.errors.length === 0,
    JSON.stringify(reopened) + ' ' + t.errors.join(' | '));
  await t.ev(`document.getElementById('btn-direction').click()`);
  await sleep(300);
  const back = await t.ev(positions);
  t.check('toggling back to Horizontal restores the left-to-right layout exactly', back === refLaid && !(await t.ev(`document.getElementById('swimlanes-container').classList.contains('dir-tb')`)),
    `got ${back.slice(0, 120)}...`);

  // 10. ?present hides editing chrome
  await t.open(laid, '?present');
  t.check('?present hides Save and toolbar', await t.ev(`document.body.classList.contains('presentation') && getComputedStyle(document.getElementById('btn-save')).display === 'none' && getComputedStyle(document.querySelector('.toolbar-center')).display === 'none'`));
} catch (err) {
  console.error('[ERROR]', err.message);
  code = 1;
} finally {
  await t.close();
}
process.exit(code || t.finish());
