// Flowchart render path (dev/plans/plan-review-fixes.md, Phase 2 step 3 and Phase 3): step elements are kept across
// renders, events go through one listener per layer, and a drag re-routes only the arrows it can change, with a full
// pass on the drop. Real mouse input, driven over the Chrome DevTools Protocol, see cdp.mjs.
//
//   node dev/tests/e2e/e2e_render_reuse.mjs --browser <chrome> --page <loan-application.html>
//
// --page: dev/tests/fixtures/flowchart/loan-application.json laid out by `layout_engine.py --layout`
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser'), page = argOf('page');
if (!browser || !page) { console.error('usage: --browser <chrome> --page <html>'); process.exit(1); }

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
// Every arrow's path, keyed by its id and ends
const paths = () => t.ev(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('.edge-line')].map(e => [e.dataset.edgeId + ':' + e.dataset.from + '>' + e.dataset.to, e.getAttribute('d')])))`).then(JSON.parse);
const mouse = (type, x, y) => t.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
try {
  await t.open(page);

  // 1. A render (Undo / Redo restore a snapshot and render it) updates the step elements in place
  await t.ev(`document.querySelectorAll('.flow-node[data-node-id]').forEach(el => { el.__mark = el.dataset.nodeId; }); true`);
  await t.ev(`(() => { const h = document.getElementById('chart-title'); h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    h.textContent = 'Reuse check'; h.blur(); if (h.isContentEditable) h.dispatchEvent(new FocusEvent('blur')); return true; })()`);
  await t.ev(`document.getElementById('btn-undo').click(); document.getElementById('btn-redo').click(); true`);
  await t.settle();
  const kept = await t.ev(`(() => { const els = [...document.querySelectorAll('.flow-node[data-node-id]')];
    return els.length > 0 && els.every(el => el.__mark === el.dataset.nodeId); })()`);
  t.check('a render keeps every step element (identity for the morphs)', kept);

  // 2. One listener per layer: hover, click and the step's double-click still reach a kept element
  const step = await t.ev(`(() => { const el = [...document.querySelectorAll('.flow-node.type-task')].find(n => n.querySelector('.node-label').textContent.trim());
    const r = el.getBoundingClientRect(); return { id: el.dataset.nodeId, x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await t.mouse('mouseMoved', step.x, step.y);
  await sleep(60);
  const lit = await t.ev(`document.querySelectorAll('.edge-line.hl-in, .edge-line.hl-out').length`);
  await t.click(step.x, step.y);
  const selected = await t.ev(`document.getElementById('node-${step.id}').classList.contains('selected')`);
  await t.click(step.x, step.y, { count: 2 });
  await sleep(60);
  const editing = await t.ev(`!!document.activeElement && document.activeElement.classList.contains('node-label') && document.activeElement.isContentEditable`);
  await t.press('Escape');
  await t.ev(`document.activeElement && document.activeElement.blur(); true`);
  t.check('hover lights the step\'s arrows, a click selects it, a double-click edits its label', lit > 0 && selected && editing,
    `lit=${lit} selected=${selected} editing=${editing}`);

  // 3. A drag re-routes only the arrows of the moved step (and those it crosses); the drop routes everything, the same
  // as a full render of the dropped layout
  await t.click(5, 5);
  const before = await paths();
  const at = await t.ev(`(() => { const r = document.getElementById('node-${step.id}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await mouse('mousePressed', at.x, at.y);
  for (let i = 1; i <= 12; i++) { await mouse('mouseMoved', at.x + i * 4, at.y + i * 5); await sleep(20); }
  await sleep(60);
  const mid = await paths();
  const changed = Object.keys(mid).filter(k => mid[k] !== before[k]);
  const own = changed.filter(k => new RegExp(`:(${step.id}>|.*>${step.id}$)`).test(k));
  t.check('a drag frame redraws the moved step\'s arrows', own.length > 0, JSON.stringify(changed));
  t.check('a drag frame leaves most other arrows alone', changed.length < Object.keys(before).length, `${changed.length}/${Object.keys(before).length}`);
  await mouse('mouseReleased', at.x + 48, at.y + 60);
  await sleep(100);
  await t.settle();
  const dropped = await paths();
  await t.ev(`document.getElementById('btn-undo').click(); document.getElementById('btn-redo').click(); true`);
  await t.settle();
  const full = await paths();
  const differ = Object.keys(full).filter(k => full[k] !== dropped[k]);
  t.check('after the drop every arrow matches a full render of the same layout', differ.length === 0 && Object.keys(full).length === Object.keys(dropped).length, JSON.stringify(differ));
  t.check('no page errors', t.errors.length === 0, t.errors.join(' | '));
} catch (err) {
  console.error('[ERROR]', err.message);
  code = 1;
} finally {
  await t.close();
}
process.exit(code || t.finish());
