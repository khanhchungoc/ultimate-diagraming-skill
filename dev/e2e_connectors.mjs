// Interaction test for on-page connectors (dev/plans/plan-connectors.md). Driven over the Chrome DevTools Protocol,
// see cdp.mjs.
//
//   node dev/e2e_connectors.mjs --browser <chrome> --forward <html> --loop <html> --merge <html> --split <html>
//
// --forward / --loop / --merge: dev/fixtures/flowchart/unsplit/connector-*.json laid out (whole arrows, no connectors)
// --split: dev/fixtures/flowchart/connector-forward.json laid out (an A pair already in place)
// The page keeps its state private; like e2e_shell.mjs, the test reads it back through Save (Ctrl+S writes the
// current diagram into the page's diagram-data block). Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser');
const pages = { forward: argOf('forward'), loop: argOf('loop'), merge: argOf('merge'), split: argOf('split') };
if (!browser || Object.values(pages).some(p => !p)) {
  console.error('usage: --browser <chrome> --forward <html> --loop <html> --merge <html> --split <html>');
  process.exit(1);
}

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;

// The diagram as saved, plus summaries of it
async function state() {
  await t.ev(t.key('s', { ctrlKey: true }));
  await sleep(250);
  return JSON.parse(await t.ev(`document.getElementById('diagram-data').textContent`));
}
const stepsOf = (d) => JSON.stringify(d.nodes.filter(n => n.type !== 'connector').map(n => [n.id, n.laneId, n.x, n.y]));
const connsOf = (d) => d.nodes.filter(n => n.type === 'connector');
const edgeOf = (d, id) => d.edges.find(e => e.id === id) || null;

// Page-side selectors and actions (DOM only). A connector's role shows in its accessible name.
const conn = (role) => `[...document.querySelectorAll('.flow-node.type-connector')].find(el => /${role === 'in' ? 'continues at' : ', from '}/.test(el.getAttribute('aria-label')))`;
const selectEdge = (id) => t.ev(`document.querySelector('.connector-path[data-edge-id="${id}"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
const split = async (id) => { await selectEdge(id); await t.ev(`document.querySelector('.edge-split-chip').click()`); };
const click = (sel) => t.ev(`(() => {
  const el = ${sel}; const r = el.getBoundingClientRect();
  const o = { bubbles: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, isPrimary: true };
  el.dispatchEvent(new PointerEvent('pointerdown', o));
  window.dispatchEvent(new PointerEvent('pointerup', o));
})()`);
const rename = (sel, text) => t.ev(`(() => {
  const el = ${sel}; el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const l = el.querySelector('.node-label'); l.textContent = ${JSON.stringify(text)}; l.blur();
  // Headless Chrome has no window focus, so blur() fires no blur event there: deliver it by hand
  if (l.isContentEditable) l.dispatchEvent(new FocusEvent('blur'));
})()`);
const letters = () => t.ev(`JSON.stringify([...document.querySelectorAll('.flow-node.type-connector')].map(el => el.textContent.trim()).sort())`);
// How far the element is from the viewport's centre, in screen px
const offCentre = (sel) => t.ev(`(() => {
  const r = (${sel}).getBoundingClientRect(), v = document.getElementById('viewport').getBoundingClientRect();
  return [Math.round(r.left + r.width / 2 - (v.left + v.width / 2)), Math.round(r.top + r.height / 2 - (v.top + v.height / 2))];
})()`);
const undo = t.key('z', { ctrlKey: true }), redo = t.key('y', { ctrlKey: true });

try {
  // 1. Split a long forward arrow: an A pair, no step moves, the label stays on the in-side
  await t.open(pages.forward);
  const d0 = await state();
  await selectEdge('e8');
  t.check('the selected arrow shows a Split chip', await t.ev(`!!document.querySelector('.edge-split-chip')`));
  await t.ev(`document.querySelector('.edge-split-chip').click()`);
  const d1 = await state();
  const e8 = edgeOf(d1, 'e8');
  t.check('Split makes an A pair; the arrow keeps its id and its "Yes" label on the in-side',
    JSON.stringify(connsOf(d1).map(n => n.label)) === '["A","A"]' && e8.label === 'Yes' && connsOf(d1).some(n => n.id === e8.to),
    JSON.stringify({ conns: connsOf(d1), e8 }));
  t.check('splitting moves no step (Auto-Tidy on)', stepsOf(d1) === stepsOf(d0), `before=${stepsOf(d0)}\nafter=${stepsOf(d1)}`);
  const drawn = await t.ev(`[...document.querySelectorAll('.flow-node.type-connector')].map(el => [el.offsetWidth, el.textContent.trim(), getComputedStyle(el).borderRadius])`);
  t.check('each connector draws as a 32px circle with its letter', drawn.length === 2 && drawn.every(([w, l, r]) => w === 32 && l === 'A' && r === '50%'), JSON.stringify(drawn));
  const aria = await t.ev(`[...document.querySelectorAll('.flow-node.type-connector')].map(el => el.getAttribute('aria-label')).sort()`);
  t.check('accessible names say where each end leads', aria.includes('Connector A, continues at Pay Claim') && aria.includes('Connector A, from Fast-Track Eligible?'), JSON.stringify(aria));
  t.check('connectors have no ports and no note chip', await t.ev(`[...document.querySelectorAll('.flow-node.type-connector')].every(el => !el.querySelector('.port, .note-add, .note-badge'))`));

  // 2. Hover lights both circles and draws one guide between them
  await t.ev(`(${conn('in')}).dispatchEvent(new MouseEvent('mouseenter'))`);
  const lit = await t.ev(`[document.querySelectorAll('.flow-node.type-connector.pair-lit').length, document.querySelectorAll('.connector-guide').length]`);
  await t.ev(`(${conn('in')}).dispatchEvent(new MouseEvent('mouseleave'))`);
  const unlit = await t.ev(`document.querySelectorAll('.pair-lit, .connector-guide').length`);
  t.check('hovering a connector lights its partner and draws one guide; leaving clears both', lit[0] === 2 && lit[1] === 1 && unlit === 0, `lit=${JSON.stringify(lit)} unlit=${unlit}`);
  // Hovering the step the arrow leaves (wired to the in-connector) shows the same pair and guide
  const srcStep = `document.getElementById('node-' + ${JSON.stringify(e8.from)})`;
  await t.ev(`(${srcStep}).dispatchEvent(new MouseEvent('mouseenter'))`);
  const litStep = await t.ev(`[document.querySelectorAll('.flow-node.type-connector.pair-lit').length, document.querySelectorAll('.connector-guide').length]`);
  await t.ev(`(${srcStep}).dispatchEvent(new MouseEvent('mouseleave'))`);
  const unlitStep = await t.ev(`document.querySelectorAll('.pair-lit, .connector-guide').length`);
  t.check('hovering a step wired to a connector lights the pair and draws its guide; leaving clears both', litStep[0] === 2 && litStep[1] === 1 && unlitStep === 0, `lit=${JSON.stringify(litStep)} unlit=${unlitStep}`);
  const look = await t.ev(`(() => { const s = getComputedStyle(${conn('in')}); return [s.borderTopStyle, s.borderTopWidth]; })()`);
  t.check('a connector wears a solid 2px ring (not the terminator look)', look[0] === 'solid' && look[1] === '2px', JSON.stringify(look));

  // 3. A click pans to the partner (same zoom) and pulses it
  const zoom0 = await t.ev(`document.getElementById('zoom-level')?.textContent || ''`);
  await click(conn('in'));
  await sleep(450);
  const centred = await offCentre(conn('out'));
  const pulsed = await t.ev(`(${conn('out')}).classList.contains('connector-pulse')`);
  const zoom1 = await t.ev(`document.getElementById('zoom-level')?.textContent || ''`);
  t.check('clicking the in-connector centres its out-connector at the same zoom, with a pulse',
    Math.abs(centred[0]) <= 3 && Math.abs(centred[1]) <= 3 && pulsed && zoom1 === zoom0, JSON.stringify({ centred, pulsed, zoom0, zoom1 }));

  // 4. Rename renames the pair; a letter in use or not a letter is refused
  await rename(conn('in'), 'c');
  t.check('renaming one connector renames its pair (lower case accepted)', (await letters()) === '["C","C"]', await letters());
  await rename(conn('out'), 'I');
  t.check('a letter that reads as a digit (I) is refused', (await letters()) === '["C","C"]', await letters());
  await split('e4');
  const two = await letters();
  await rename(`[...document.querySelectorAll('.flow-node.type-connector')].find(el => el.textContent.trim() === 'A')`, 'C');
  const refused = await letters();
  t.check('a second split takes the next free letter, and renaming it to a letter in use is refused',
    two === '["A","A","C","C"]' && refused === two, `two=${two} refused=${refused}`);
  await t.ev(undo);
  t.check('undo removes the second pair in one step', (await letters()) === '["C","C"]', await letters());

  // 5. Delete = join: the whole arrow returns with its label; undo / redo
  await click(conn('in'));
  await t.ev(t.key('Delete'));
  const d2 = await state();
  const joined = edgeOf(d2, 'e8');
  t.check('Delete on a connector joins the arrow back (n4 -> n8, "Yes") and removes both circles',
    joined && joined.from === 'n4' && joined.to === 'n8' && joined.label === 'Yes' && !connsOf(d2).length && d2.edges.length === d0.edges.length,
    JSON.stringify(joined));
  t.check('joining moves no step', stepsOf(d2) === stepsOf(d0));
  await t.ev(undo);
  const back = await letters();
  await t.ev(redo);
  t.check('undo brings the pair back, redo joins again', back === '["C","C"]' && (await letters()) === '[]', back);

  // 6. Refusals: no arrow drawn by hand to a connector; no note on one
  await split('e8');
  const before = (await state()).edges.length;
  await t.ev(`(() => {
    const port = document.querySelector('#node-n2 .port-right'), pr = port.getBoundingClientRect();
    const c = ${conn('in')}, r = c.getBoundingClientRect();
    const o = (x, y) => ({ bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1, isPrimary: true });
    port.dispatchEvent(new PointerEvent('pointerdown', o(pr.left + 4, pr.top + 4)));
    window.dispatchEvent(new PointerEvent('pointermove', o(r.left + r.width / 2, r.top + r.height / 2)));
    window.dispatchEvent(new PointerEvent('pointerup', o(r.left + r.width / 2, r.top + r.height / 2)));
  })()`);
  const hint = await t.ev(`document.querySelector('.flow-hint')?.textContent || ''`);
  await click(conn('in'));
  await t.ev(t.key('n'));
  await sleep(100);
  const d3 = await state();
  t.check('an arrow dragged onto a connector is refused with a hint', d3.edges.length === before && /splitting an arrow/.test(hint), `edges ${before} -> ${d3.edges.length}, hint=${hint}`);
  t.check('a connector takes no note (N does nothing)', !(d3.notes || []).length && !(await t.ev(`document.querySelector('.flow-note')`)));

  // 7. Deleting a stub arrow deletes the whole split arrow
  const stub = d3.edges.find(e => connsOf(d3).some(c => c.id === e.from)).id;
  await selectEdge(stub);
  await t.ev(t.key('Delete'));
  const d4 = await state();
  t.check('deleting a stub removes the pair and the in-arrow', !connsOf(d4).length && !edgeOf(d4, 'e8'), JSON.stringify(connsOf(d4)));

  // 8. SVG export: circles in, hover guide out
  await t.ev(undo);
  await t.ev(`(${conn('in')}).dispatchEvent(new MouseEvent('mouseenter'))`);
  const svgText = await t.ev(`new Promise(res => {
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { URL.createObjectURL = orig; b.text().then(res); return 'blob:x'; };
    document.querySelector('[data-export="svg"]').click();
  })`);
  await t.ev(`(${conn('in')}).dispatchEvent(new MouseEvent('mouseleave'))`);
  t.check('SVG export carries both connector letters but not the hover guide',
    (svgText.match(/>\s*A\s*</g) || []).length >= 2 && !/dasharray[^;"]*1[ ,px]+5/.test(svgText), `letters=${(svgText.match(/>\s*A\s*</g) || []).length}`);

  // 8b. Drag the out-circle onto another step: the pair continues there and the circle moves beside it
  const dragTo = (from, toSel) => t.ev(`(() => {
    const c = ${from}, r = c.getBoundingClientRect(), s = document.querySelector(${JSON.stringify(toSel)}).getBoundingClientRect();
    const o = (x, y) => ({ bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1, isPrimary: true });
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2, x1 = s.left + s.width / 2, y1 = s.top + s.height / 2;
    c.dispatchEvent(new PointerEvent('pointerdown', o(x0, y0)));
    window.dispatchEvent(new PointerEvent('pointermove', o(x0 + 10, y0 + 10)));
    window.dispatchEvent(new PointerEvent('pointermove', o(x1, y1)));
    const lit = !!document.querySelector(${JSON.stringify(toSel)} + '.connect-target');
    window.dispatchEvent(new PointerEvent('pointerup', o(x1, y1)));
    return lit;
  })()`);
  // Screen gap between two elements' boxes (0 when they touch)
  const gapBetween = (a, b) => t.ev(`(() => {
    const p = (${a}).getBoundingClientRect(), q = (${b}).getBoundingClientRect();
    return Math.round(Math.hypot(Math.max(0, q.left - p.right, p.left - q.right), Math.max(0, q.top - p.bottom, p.top - q.bottom)));
  })()`);
  const outEdge = (d) => d.edges.find(e => connsOf(d).some(c => c.id === e.from));   // the out-connector's stub
  const g0 = await state();
  const hit = await dragTo(conn('out'), '#node-n9');
  const g1 = await state();
  const near = await gapBetween(conn('out'), `document.getElementById('node-n9')`);
  t.check('dragging the out-circle onto a step highlights it, re-points the pair there and moves the circle beside it',
    hit && outEdge(g0).to === 'n8' && outEdge(g1).to === 'n9' && near <= 60, JSON.stringify({ hit, before: outEdge(g0), after: outEdge(g1), near }));
  await t.ev(undo);
  t.check('undo puts the pair back on its old step', outEdge(await state()).to === 'n8');
  await t.ev(`(() => {
    const c = ${conn('out')}, r = c.getBoundingClientRect(), v = document.getElementById('viewport').getBoundingClientRect();
    const o = (x, y) => ({ bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1, isPrimary: true });
    c.dispatchEvent(new PointerEvent('pointerdown', o(r.left + 16, r.top + 16)));
    window.dispatchEvent(new PointerEvent('pointermove', o(r.left + 40, r.top + 40)));
    window.dispatchEvent(new PointerEvent('pointermove', o(v.left + 30, v.bottom - 120)));
    window.dispatchEvent(new PointerEvent('pointerup', o(v.left + 30, v.bottom - 120)));
  })()`);
  const g2 = await state();
  t.check('a circle dropped on empty canvas goes back beside its step, nothing rewired',
    outEdge(g2).to === 'n8' && JSON.stringify(connsOf(g2)) === JSON.stringify(connsOf(g0)), JSON.stringify(connsOf(g2)));
  // The old way still works: re-attach the stub's step end; the circle follows
  const stubId = outEdge(g2).id;
  await selectEdge(stubId);
  await t.ev(`(() => {
    const h = document.querySelector('.edge-end-handle:not(.at-connector)'), r = h.getBoundingClientRect(), s = document.getElementById('node-n9').getBoundingClientRect();
    const o = (x, y) => ({ bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1, isPrimary: true });
    h.dispatchEvent(new PointerEvent('pointerdown', o(r.left + 7, r.top + 7)));
    window.dispatchEvent(new PointerEvent('pointermove', o(s.left + s.width / 2, s.top + s.height / 2)));
    window.dispatchEvent(new PointerEvent('pointerup', o(s.left + s.width / 2, s.top + s.height / 2)));
  })()`);
  const near2 = await gapBetween(conn('out'), `document.getElementById('node-n9')`);
  t.check('re-attaching the stub\'s arrowhead to another step moves its circle there too', outEdge(await state()).to === 'n9' && near2 <= 60, `gap=${near2}`);

  // The stub's handle at the circle end: dropped on a step, the circle moves there
  const dragHandle = (handleSel, toSel) => t.ev(`(() => {
    const h = document.querySelector(${JSON.stringify(handleSel)}), r = h.getBoundingClientRect(), s = (${toSel}).getBoundingClientRect();
    const o = (x, y) => ({ bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1, isPrimary: true });
    h.dispatchEvent(new PointerEvent('pointerdown', o(r.left + 7, r.top + 7)));
    window.dispatchEvent(new PointerEvent('pointermove', o(s.left + s.width / 2, s.top + s.height / 2)));
    window.dispatchEvent(new PointerEvent('pointerup', o(s.left + s.width / 2, s.top + s.height / 2)));
  })()`);
  await selectEdge(outEdge(await state()).id);
  const handles = await t.ev(`[document.querySelectorAll('.edge-end-handle').length, document.querySelectorAll('.edge-end-handle.at-connector').length]`);
  await dragHandle('.edge-end-handle.at-connector', `document.getElementById('node-n8')`);
  const near3 = await gapBetween(conn('out'), `document.getElementById('node-n8')`);
  t.check('a stub shows a handle at both ends; the circle-end handle dropped on a step moves the circle there',
    handles[0] === 2 && handles[1] === 1 && outEdge(await state()).to === 'n8' && near3 <= 60, JSON.stringify({ handles, near3 }));

  // 9. A loop-back keeps its feedback flag through split and join
  await t.open(pages.loop);
  const l0 = await state();
  await split('e7');
  const l1 = await state();
  const e7 = edgeOf(l1, 'e7');
  t.check('splitting a loop-back keeps "No" and feedback on the in-side; no step moves', e7.feedback === true && e7.label === 'No' && stepsOf(l1) === stepsOf(l0), JSON.stringify(e7));
  await click(conn('out'));
  await t.ev(t.key('Delete'));
  const e7b = edgeOf(await state(), 'e7');
  t.check('deleting the out-connector joins the loop back with its feedback flag', e7b.to === 'n3' && e7b.feedback === true && e7b.label === 'No', JSON.stringify(e7b));

  // 10. Merge: a second arrow into the same step joins the existing letter
  await t.open(pages.merge);
  const m0 = await state();
  await split('e3');
  await split('e6');
  const menu = await t.ev(`[...document.querySelectorAll('.edge-split-menu button')].map(b => b.textContent)`);
  t.check('the Split chip offers to join A when A continues at the same step', menu.length === 2 && /^Split into new B/.test(menu[0]) && /^Join A/.test(menu[1]), JSON.stringify(menu));
  await t.ev(`[...document.querySelectorAll('.edge-split-menu button')].find(b => b.textContent.startsWith('Join A')).click()`);
  const m1 = await state();
  const outs = connsOf(m1).filter(c => m1.edges.some(e => e.from === c.id));
  t.check('joining makes a merge: three A circles, one out-connector, no step moved',
    JSON.stringify(connsOf(m1).map(n => n.label)) === '["A","A","A"]' && outs.length === 1 && stepsOf(m1) === stepsOf(m0), JSON.stringify(connsOf(m1)));
  await click(conn('out'));
  await t.ev(t.key('Delete'));
  const m2 = await state();
  t.check('deleting the out-connector of a merge joins every source',
    edgeOf(m2, 'e3').to === 'n9' && edgeOf(m2, 'e3').label === 'Yes' && edgeOf(m2, 'e6').to === 'n9' && edgeOf(m2, 'e6').label === 'No' && !connsOf(m2).length,
    JSON.stringify([edgeOf(m2, 'e3'), edgeOf(m2, 'e6')]));

  // 10b. An arrowhead dropped on a circle sends that arrow into the pair (a new circle beside its source)
  await t.ev(undo);   // back to the merge: A pair from e3 and e6
  await t.ev(undo);   // ... and to e3 alone split into A
  const j0 = await state();
  await selectEdge('e6');
  await dragHandle('.edge-end-handle:not(.at-connector)[data-tip*="target"]', conn('out'));
  const j1 = await state();
  const e6 = edgeOf(j1, 'e6'), c6 = connsOf(j1).find(c => c.id === e6.to);
  t.check('dragging an arrowhead onto a circle joins that pair: a new A beside its source, label kept, no step moved',
    connsOf(j0).length === 2 && c6 && c6.label === 'A' && c6.laneId === 'lane-eng' && e6.label === 'No' && connsOf(j1).length === 3 && stepsOf(j1) === stepsOf(j0),
    JSON.stringify({ e6, conns: connsOf(j1) }));

  // 10c. The Connector tile (Shapes menu, Flow): drag it onto an arrow; click it, then an arrow; or click it with an
  // arrow selected. Each breaks that arrow into a pair.
  await t.open(pages.forward);
  const k0 = await state();
  const intoPair = (d, id) => connsOf(d).some(c => c.id === (edgeOf(d, id) || {}).to) && connsOf(d).length === 2;
  const mid = await t.ev(`(() => {
    const p = document.querySelector('.connector-path[data-edge-id="e8"]'), L = p.getTotalLength(), m = p.getScreenCTM();
    const q = p.getPointAtLength(L * 0.5); return [q.x * m.a + m.e, q.y * m.d + m.f];
  })()`);
  const lit2 = await t.ev(`(() => {
    const b = document.getElementById('btn-add-connector'), r = b.getBoundingClientRect();
    const o = (x, y) => ({ bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1, isPrimary: true });
    b.dispatchEvent(new PointerEvent('pointerdown', o(r.left + 10, r.top + 10)));
    window.dispatchEvent(new PointerEvent('pointermove', o(r.left + 40, r.top - 40)));
    window.dispatchEvent(new PointerEvent('pointermove', o(${mid[0]}, ${mid[1]})));
    const lit = [!!document.querySelector('.connector-path.insert-target[data-edge-id="e8"]'), !!document.querySelector('.connector-ghost.over-arrow')];
    window.dispatchEvent(new PointerEvent('pointerup', o(${mid[0]}, ${mid[1]})));
    b.click();   // the click that follows a drag is swallowed
    return lit;
  })()`);
  const k1 = await state();
  t.check('dragging the Connector tile onto an arrow highlights it and breaks it into an A pair (no step moved)',
    lit2[0] && lit2[1] && intoPair(k1, 'e8') && stepsOf(k1) === stepsOf(k0), JSON.stringify({ lit2, conns: connsOf(k1) }));
  await t.ev(undo);
  await t.ev(`document.getElementById('btn-add-connector').click()`);
  const prompt = await t.ev(`document.querySelector('.connector-pick-hint')?.textContent || ''`);
  await selectEdge('e4');
  const k2 = await state();
  t.check('clicking the tile waits for an arrow (with a prompt); the next arrow clicked is split',
    /Click an arrow/.test(prompt) && intoPair(k2, 'e4') && !(await t.ev(`!!document.querySelector('.connector-pick-hint')`)), JSON.stringify({ prompt, conns: connsOf(k2) }));
  await t.ev(undo);
  await selectEdge('e8');
  await t.ev(`document.getElementById('btn-add-connector').click()`);
  await sleep(50);
  t.check('clicking the tile with an arrow selected splits that arrow', intoPair(await state(), 'e8'));
  await t.ev(undo);
  await t.ev(`document.getElementById('btn-add-connector').click()`);
  await t.ev(t.key('Escape'));
  t.check('Escape cancels waiting for an arrow', !(await t.ev(`!!document.querySelector('.connector-pick-hint')`)) && !(await t.ev(`document.body.classList.contains('connector-picking')`)));

  // 11. ?present: read-only, but a click still jumps to the other end
  await t.open(pages.split, '?present');
  // The stub's label has room: clear of both its step and the circle
  const lbl = `document.querySelector('.edge-label-container[data-edge-id="e8"]')`;
  const roomStep = await gapBetween(lbl, `document.getElementById('node-n4')`), roomCircle = await gapBetween(lbl, conn('in'));
  t.check('the "Yes" label on the in-stub keeps at least 10px from its step and from the circle', roomStep >= 10 && roomCircle >= 10, JSON.stringify({ roomStep, roomCircle }));
  const p0 = await offCentre(conn('out'));
  await click(conn('in'));
  await sleep(450);
  const p1 = await offCentre(conn('out'));
  const selected = await t.ev(`!!document.querySelector('.flow-node.selected')`);
  t.check('in ?present a click on a connector centres its partner without selecting anything',
    Math.abs(p1[0]) <= 3 && Math.abs(p1[1]) <= 3 && (p0[0] !== p1[0] || p0[1] !== p1[1]) && !selected, JSON.stringify({ p0, p1, selected }));
  t.check('no page errors', t.errors.length === 0, t.errors.join(' | '));
} catch (err) {
  console.error('[ERROR]', err.message);
  code = 1;
} finally {
  await t.close();
}
process.exit(code || t.finish());
