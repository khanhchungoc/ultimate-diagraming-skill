// Interaction test for the shared shell through the flowchart plugin (the shell is type-independent;
// dev/e2e_sequence.mjs covers the second plugin). Driven over the Chrome DevTools Protocol, see cdp.mjs.
//
//   node dev/e2e_shell.mjs --browser <chrome> --laid <laid-out.html> --scrambled <scrambled-positions.html>
//
// --laid:      page produced by `layout_engine.py --layout` (reference positions)
// --scrambled: same diagram with node x/y scrambled (Auto-Tidy must restore the reference positions)
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
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
    const ok = lit.length === 1 && lit[0] === lane && getComputedStyle(lane.querySelector('.lane-track')).boxShadow !== 'none';
    c.dispatchEvent(new PointerEvent('pointerleave'));
    return ok && !document.querySelector('.swimlane.lane-hover');
  })()`);
  t.check('the lane under the pointer is highlighted (also over an arrow label) and clears on leave', hoverCheck);

  // 8. Floating lane pills: pan the header column out of view and every lane shows its name pill near the
  //    viewport's left edge (on the lane rail); the pill text stays smaller than the header text but never
  //    below 11px on screen; Fit hides them again
  const pills = `(() => { const vp = document.getElementById('viewport').getBoundingClientRect();
    return [...document.querySelectorAll('.lane-pill')].filter(p => getComputedStyle(p).display !== 'none')
      .map(p => { const r = p.getBoundingClientRect(), k = r.width / p.offsetWidth;
        return { dx: Math.round(r.left - vp.left), px: Math.round(parseFloat(getComputedStyle(p).fontSize) * k * 10) / 10 }; }); })()`;
  const laneCount = await t.ev(`document.querySelectorAll('.swimlane').length`);
  t.check('no lane pills while the header column is in view', (await t.ev(pills)).length === 0);
  await t.ev(`document.getElementById('viewport').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 900, deltaY: 0, deltaMode: 0, clientX: 600, clientY: 400 }))`);
  const zoom = `parseInt(document.getElementById('zoom-level').textContent) / 100`;
  const shown = await t.ev(pills), z1 = await t.ev(zoom);
  for (let i = 0; i < 6; i++) await t.ev(`document.getElementById('btn-zoom-out').click()`);
  const zoomedOut = await t.ev(pills), z2 = await t.ev(zoom);
  const titlePx = await t.ev(`parseFloat(getComputedStyle(document.querySelector('.lane-title')).fontSize)`);
  t.check('after panning right, every lane shows a name pill at the viewport left edge',
    shown.length === laneCount && shown.every(p => Math.abs(p.dx - 12) <= 2) && zoomedOut.length === laneCount,
    `shown=${JSON.stringify(shown)} zoomedOut=${JSON.stringify(zoomedOut)}`);
  t.check('pill text is smaller than the header text at the same zoom, and never below 11px on screen',
    shown[0].px < titlePx * z1 && zoomedOut[0].px >= 10.9 && zoomedOut[0].px <= shown[0].px,
    `pill=${shown[0]?.px}px header=${titlePx * z1}px at ${z1}; zoomed-out pill=${zoomedOut[0]?.px}px at ${z2}`);
  // An export taken while the pills are showing leaves them out (each lane name appears once, in its header)
  const svgText = await t.ev(`new Promise(res => {
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { URL.createObjectURL = orig; b.text().then(res); return 'blob:x'; };
    document.querySelector('[data-export="svg"]').click();
  })`);
  const laneNames = await t.ev(`[...document.querySelectorAll('.lane-title')].map(t => t.textContent)`);
  const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const counts = laneNames.map(n => svgText.split('>' + esc(n) + '<').length - 1);
  t.check('SVG export leaves the floating pills out', counts.every(c => c === 1), `counts=${counts}`);
  await t.ev(`document.getElementById('btn-zoom-reset').click()`);
  t.check('Fit hides the pills again', (await t.ev(pills)).length === 0);

  // 9. No-swimlane mode ("swimlanes": false)
  const nolanes = argOf('nolanes');
  if (nolanes) {
    await t.open(nolanes);
    const visible = await t.ev(`[...document.querySelectorAll('.lane-header')].filter(h => getComputedStyle(h).display !== 'none').length`);
    const n = await t.ev(`document.querySelectorAll('.flow-node').length`);
    const label = await t.ev(`document.querySelector('#btn-add-lane .btn-label').textContent`);
    t.check('swimlanes:false renders the nodes with no visible lane header', n > 0 && visible === 0 && t.errors.length === 0, `nodes=${n} headers=${visible} errors=${t.errors.join(' | ')}`);
    await t.ev(`document.getElementById('btn-add-lane').click()`);
    const shown = await t.ev(`[...document.querySelectorAll('.lane-header')].filter(h => getComputedStyle(h).display !== 'none').length`);
    t.check('the Lane button ("' + label + '") turns swimlanes back on', shown === 1, `headers=${shown}`);
  }

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
