// Touch test for the shell's pan and zoom on a phone: one finger pans 1:1, two fingers pinch-zoom (the page itself
// never zooms), a drag that starts on an unselected item pans instead of moving it, a tap selects (even when the
// browser's touch adjustment would have hit a step's connect port), a selected item drags, a tap on blank canvas
// clears the selection; the sequence participant row pins (each pill in its halo) once panned off by touch; and a
// sequence message is drawn by touch from the lifeline of a selected participant (an unselected one pans).
// Real touch input over the Chrome DevTools Protocol (Input.dispatchTouchEvent), phone-sized and mobile-emulated.
//
//   node dev/e2e_touch.mjs --browser <chrome> --sequence <html> --flowchart <html> [--erd <html>]
//
// --sequence:  dev/tests/fixtures/sequence/payment-phases.json laid out by `layout_engine.py --layout` (a long diagram)
// --flowchart: dev/tests/fixtures/flowchart/loan-application.json laid out
// --erd (optional): dev/examples/example-erd.json laid out: pan, pinch, a drag that starts on an unselected table
//   pans, a tap selects, a selected table drags, a relationship is drawn by touch from a selected table's row port, a
//   tapped line's end handle re-points it, a tap on blank canvas clears
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser'), sequence = argOf('sequence'), flowchart = argOf('flowchart'), erd = argOf('erd');
if (!browser || !sequence || !flowchart) {
  console.error('usage: --browser <chrome> --sequence <html> --flowchart <html> [--erd <html>]');
  process.exit(1);
}

const t = await launch(browser);
const W = 412, H = 915;
await t.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
await t.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

const touch = (type, points) => t.send('Input.dispatchTouchEvent', { type, touchPoints: points });
async function drag(x, y, dx, dy, steps = 15) {
  await touch('touchStart', [{ x, y, id: 1 }]);
  for (let i = 1; i <= steps; i++) await touch('touchMove', [{ x: x + dx * i / steps, y: y + dy * i / steps, id: 1 }]);
  await touch('touchEnd', []);
  await sleep(150);
}
async function tap(x, y) {
  await touch('touchStart', [{ x, y, id: 1 }]);
  await touch('touchEnd', []);
  await sleep(200);
}
async function pinch(cx, cy, d0, d1, steps = 12) {
  const pts = (d) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
  await touch('touchStart', [pts(d0)[0]]);
  await touch('touchStart', pts(d0));
  for (let i = 1; i <= steps; i++) await touch('touchMove', pts(d0 + (d1 - d0) * i / steps));
  await touch('touchEnd', []);
  await sleep(150);
}
const view = () => t.ev(`(() => { const m = document.getElementById('stage').style.transform
  .match(/translate\\(([-\\d.]+)px, ([-\\d.]+)px\\) scale\\(([\\d.]+)\\)/); return { x: +m[1], y: +m[2], k: +m[3] }; })()`);

// --- Sequence: pinch, pan, pinned participant row ---
await t.open(sequence);
const v0 = await view();
await pinch(200, 450, 100, 300);
const v1 = await view();
t.check('a pinch from 100px to 300px zooms the diagram 3x', Math.abs(v1.k / v0.k - 3) < 0.15, `${v0.k} -> ${v1.k}`);
t.check('the page itself does not zoom', await t.ev('visualViewport.scale') === 1);
await drag(30, 750, 0, -400);
const v2 = await view();
t.check('a one-finger drag of 400px pans 400px', Math.abs(v2.y - v1.y + 400) < 2, `${(v2.y - v1.y).toFixed(1)}`);
await drag(30, 750, 0, -500);
await drag(30, 750, 0, -500);
const pin = await t.ev(`(() => {
  const canvas = document.getElementById('seq-canvas');
  const box = canvas.querySelector('.seq-participant').getBoundingClientRect(), vp = document.getElementById('viewport').getBoundingClientRect();
  return { pinned: canvas.classList.contains('seq-pinned'), boxTop: box.top, vpTop: vp.top };
})()`);
t.check('the participant row pins once panned off by touch', pin.pinned);
t.check('the pinned row sits at the top of the viewport', pin.boxTop >= pin.vpTop - 1 && pin.boxTop < pin.vpTop + 60, `${pin.boxTop} vs ${pin.vpTop}`);

// --- Sequence: drawing a message by touch: tap its participant's pill (a lifeline tap selects nothing), then drag from the lifeline ---
const ids = await t.ev(`[...document.querySelectorAll('.seq-participant')].map((e) => e.dataset.nodeId)`);
const lineX = (pid) => t.ev(`(() => { const r = document.querySelector('.seq-life-hit[data-pid="${pid}"]').getBoundingClientRect(); return r.left + r.width / 2; })()`);
const msgCount = () => t.ev(`document.querySelectorAll('.seq-msg-label').length`);
const [pa, pb] = [ids[1], ids[2]];
const ya = 600, xa = await lineX(pa), xb = await lineX(pb);
const n0 = await msgCount(), u0 = await view();
await drag(xa, ya, xb - xa, 0);
const u1 = await view();
t.check('a drag from an unselected lifeline pans and draws nothing', (await msgCount()) === n0 && Math.abs(u1.x - u0.x - (xb - xa)) < 2, `${n0} ${JSON.stringify([u0, u1])}`);
const xa2 = await lineX(pa), xb2 = await lineX(pb);
const pill = await t.ev(`(() => { const r = document.querySelector('.seq-participant[data-node-id="${pa}"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
await tap(pill.x, pill.y);
t.check('a tap on a participant pill selects it', await t.ev(`document.querySelector('.seq-participant.selected')?.dataset.nodeId`) === pa);
await drag(xa2, ya, xb2 - xa2, 0);
await sleep(300);
const drew = await t.ev(`(() => { const a = document.activeElement; return !!a && a.isContentEditable; })()`);
t.check('then a drag from that lifeline to another draws a message (its label opens for editing)', (await msgCount()) === n0 + 1 && drew, `${n0} -> ${await msgCount()}`);

// --- Sequence: Focus by tap, and a rail named by a long press ---
await t.open(sequence);
for (let i = 0; i < 4; i++) { await t.ev(`document.getElementById('btn-zoom-in').click()`); await sleep(60); }
await sleep(260);   // the last zoom glide settles
// Pan by touch until the element is on screen (one finger pans 1:1)
async function bringIntoView(sel) {
  for (let i = 0; i < 40; i++) {
    const r = await t.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const dx = r.x < 40 ? 200 : r.x > W - 40 ? -200 : 0, dy = r.y < 130 ? 200 : r.y > H - 140 ? -200 : 0;
    if (!dx && !dy) return r;
    await drag(W / 2, H / 2, dx, dy, 6);
  }
  return null;
}
const summaries = () => t.ev(`document.querySelectorAll('.frame-summary').length`);
const focusBtn = await bringIntoView('.frame-tag[data-frag-id="f3"] .seq-frag-focus');
await tap(focusBtn.x, focusBtn.y);
const railCount = await t.ev(`document.querySelectorAll('.seq-participant.is-rail').length`);
t.check('a tap on a phase\'s Focus button collapses the other phases and turns the participants they leave into rails', (await summaries()) === 3 && railCount === 2, `${await summaries()} ${railCount}`);
const railPos = await bringIntoView('.seq-participant.is-rail[data-node-id="pol"]');
await touch('touchStart', [{ x: railPos.x, y: railPos.y, id: 1 }]);
await sleep(700);
await touch('touchEnd', []);
await sleep(250);
const tipTouch = await t.ev(`(() => { const e = document.querySelector('.seq-participant.is-rail.selected .seq-rail-tip'); return e ? [e.textContent, getComputedStyle(e).display] : null; })()`);
t.check('a long press on a rail selects it and shows its full name', !!tipTouch && tipTouch[0] === 'Policy Svc' && tipTouch[1] === 'block', JSON.stringify(tipTouch));

// --- Flowchart: what a touch on a step does ---
await t.open(flowchart);
const id = await t.ev(`document.querySelector('.flow-node:not(.terminal-dot)').dataset.nodeId`);
const SEL = `.flow-node[data-node-id="${id}"]`;
const centre = () => t.at(SEL);
const laneOf = () => t.ev(`document.querySelector('${SEL}').closest('[data-lane-id]').dataset.laneId`);
const posOf = () => t.ev(`(() => { const el = document.querySelector('${SEL}'); return el.closest('[data-lane-id]').dataset.laneId + '|' + el.style.left + '|' + el.style.top; })()`);
const selected = () => t.ev(`document.querySelector('${SEL}').classList.contains('selected')`);

// At fit zoom on a phone a step is ~36px wide: the browser's touch adjustment snaps a tap on it to a connect port
let c = await centre();
await tap(c.x, c.y);
t.check('a tap on a small step selects it (not its connect port)', await selected());
await tap(10, 300);
t.check('a tap on blank canvas clears the selection', !(await selected()));

await pinch(200, 450, 100, 250);
const p0 = await posOf(), w0 = await view();
c = await centre();
await drag(c.x, c.y, 60, 80);
const w1 = await view();
t.check('a drag that starts on an unselected step does not move it', await posOf() === p0);
t.check('it pans the canvas instead', Math.abs(w1.x - w0.x - 60) < 2 && Math.abs(w1.y - w0.y - 80) < 2, JSON.stringify([w0, w1]));
t.check('and does not select the step', !(await selected()));

c = await centre();
await tap(c.x, c.y);
t.check('a tap selects the step', await selected());
const lane0 = await laneOf(), w2 = await view();
const target = await t.ev(`(() => { const lanes = [...document.querySelectorAll('.lane-track')];
  const i = lanes.findIndex((l) => l.dataset.laneId === ${JSON.stringify(lane0)});
  const r = lanes[i + 1].getBoundingClientRect(); return r.top + r.height / 2; })()`);
c = await centre();
await drag(c.x, c.y, 0, target - c.y);
await sleep(500);
t.check('dragging the selected step moves it to another lane', await laneOf() !== lane0);
const w3 = await view();
t.check('and does not pan', Math.abs(w3.x - w2.x) < 1 && Math.abs(w3.y - w2.y) < 1);

// --- ER diagram: touch on tables, ports and lines (a dragged table stays where it is dropped) ---
if (erd) {
  await t.open(erd);
  const TB = (id) => `.erd-entity[data-node-id="${id}"]`;
  const tblPos = (id) => t.ev(`(() => { const el = document.querySelector('${TB(id)}'); return el.style.left + '|' + el.style.top; })()`);
  const tblSel = (id) => t.ev(`document.querySelector('${TB(id)}').classList.contains('selected')`);
  const nSelected = () => t.ev(`document.querySelectorAll('.erd-entity.selected, .erd-rel.selected').length`);
  const relCount = () => t.ev(`document.querySelectorAll('.erd-rel').length`);
  const zoomTo = async (sel) => {   // zoom in by pinch, then bring `sel` into view by one-finger pans
    for (let i = 0; i < 2; i++) await pinch(200, 450, 100, 220);
    for (let i = 0; i < 40; i++) {
      const r = await t.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      const dx = r.x < 100 ? 120 : r.x > W - 100 ? -120 : 0, dy = r.y < 160 ? 120 : r.y > H - 200 ? -120 : 0;
      if (!dx && !dy) return;
      await drag(W / 2, H / 2 + 100, dx, dy, 6);
    }
  };
  const e0 = await view();
  await pinch(200, 450, 100, 300);
  const e1 = await view();
  t.check('erd: a pinch from 100px to 300px zooms the diagram 3x (and the page does not zoom)', Math.abs(e1.k / e0.k - 3) < 0.2 && await t.ev('visualViewport.scale') === 1, `${e0.k} -> ${e1.k}`);
  await drag(30, 750, 0, -300);
  const e2 = await view();
  t.check('erd: a one-finger drag on blank canvas pans 1:1', Math.abs(e2.y - e1.y + 300) < 2 && Math.abs(e2.x - e1.x) < 2, JSON.stringify([e1, e2]));
  await t.open(erd);
  await zoomTo(TB('review'));
  const rp0 = await tblPos('review'), v3 = await view();
  let rc = await t.at(`${TB('review')} .erd-head`);
  await drag(rc.x, rc.y, 40, 60);
  const v4 = await view();
  t.check('erd: a drag that starts on an unselected table pans and moves nothing', await tblPos('review') === rp0 && !(await tblSel('review')) && Math.abs(v4.x - v3.x - 40) < 2 && Math.abs(v4.y - v3.y - 60) < 2, JSON.stringify([v3, v4]));
  rc = await t.at(`${TB('review')} .erd-head`);
  await tap(rc.x, rc.y);
  t.check('erd: a tap on a table selects it', await tblSel('review'));
  const portsShown = await t.ev(`(() => { const ps = [...document.querySelectorAll('${TB('review')} .erd-port')]; return ps.length > 1 && ps.every((p) => getComputedStyle(p).display !== 'none' && p.hasAttribute('data-touch-drag') && p.getBoundingClientRect().width >= 20); })()`);
  t.check('erd: the selected table shows its row and header ports as finger-sized touch targets', portsShown);
  t.check('erd: an unselected table shows none', await t.ev(`[...document.querySelectorAll('${TB('product')} .erd-port')].every((p) => getComputedStyle(p).display === 'none')`));
  // The selected table drags to move (it stays where it is dropped)
  const v5 = await view();
  rc = await t.at(`${TB('review')} .erd-head`);
  await drag(rc.x, rc.y, 30, 50);
  await sleep(200);
  const v6 = await view();
  t.check('erd: dragging the selected table moves it and does not pan', await tblPos('review') !== rp0 && Math.abs(v6.x - v5.x) < 1 && Math.abs(v6.y - v5.y) < 1, `${rp0} -> ${await tblPos('review')}`);
  // A finger on a row of the selected table moves the table too (a mouse would reorder the row)
  const cols0 = await t.ev(`[...document.querySelectorAll('${TB('review')} .erd-col-name')].map((e) => e.textContent).join()`);
  const rowC = await t.at(`${TB('review')} .erd-row:nth-of-type(3) .erd-col-name`);
  const rp1 = await tblPos('review');
  await drag(rowC.x, rowC.y, -20, 20);
  t.check('erd: dragging from a row of the selected table moves the table, not the column', await tblPos('review') !== rp1 && await t.ev(`[...document.querySelectorAll('${TB('review')} .erd-col-name')].map((e) => e.textContent).join()`) === cols0);
  // A relationship from a row port by touch
  await tap(rc.x + 30, rc.y + 50);   // the table moved by (30, 50): select it again if the drag left it unselected
  if (!(await tblSel('review'))) { rc = await t.at(`${TB('review')} .erd-head`); await tap(rc.x, rc.y); }
  // Bring the port and its goal on screen together: zoom out a little, then pan both to the middle (blank canvas pans)
  await pinch(200, 450, 220, 150);
  {
    const a1 = await t.at(`${TB('review')} .erd-row[data-col="rating"]`, 1, 0.5), b1 = await t.at(`${TB('product')} .erd-row[data-col="id"]`);
    await drag(10, 300, W / 2 - (a1.x + b1.x) / 2, H / 2 - (a1.y + b1.y) / 2, 10);
  }
  if (!(await tblSel('review'))) { rc = await t.at(`${TB('review')} .erd-head`); await tap(rc.x, rc.y); }
  const port = await t.at(`${TB('review')} .erd-row[data-col="rating"] .erd-port`);
  const goal = await t.at(`${TB('product')} .erd-row[data-col="id"]`);
  const onScreen = (q) => q && q.x > 0 && q.x < W && q.y > 100 && q.y < H - 120;
  let drawn = false;
  if (onScreen(port) && onScreen(goal)) {
    const n0 = await relCount();
    await drag(port.x, port.y, goal.x - port.x, goal.y - port.y, 20);
    await sleep(300);
    drawn = (await relCount()) === n0 + 1 && await t.ev(`!!document.querySelector('.erd-rel.selected[data-from="review"][data-to="product"]:not([data-edge-id="r8"])')`);
  }
  t.check('erd: a drag from a selected table\'s row port to another table\'s row draws a relationship', drawn, `${JSON.stringify(port)} ${JSON.stringify(goal)}`);
  t.check('erd: the new line is selected and its end handles are touch targets', await t.ev(`document.querySelectorAll('.erd-handle[data-touch-drag]').length`) === 2);
  t.check('erd: the drawn line is a cubic curve (M P0 C P1 P2 P3) and its end handles sit on its two ends', await t.ev(`(() => { const d = document.querySelector('.erd-rel.selected .edge-line').getAttribute('d'); return /^M [-\\d. ]+ C [-\\d. ]+$/.test(d) && document.querySelectorAll('.erd-handle').length === 2; })()`));
  // Re-point the new line's parent end by touch
  await pinch(W / 2, H / 2, 200, 110);   // zoom out: the neighbours of the two tables come on screen too
  const h = await t.at('.erd-handle[data-role="to"]');
  const ids2 = await t.ev(`[...document.querySelectorAll('.erd-entity')].map((e) => e.dataset.nodeId).filter((id) => id !== 'review' && id !== 'product')`);
  let goal2 = null, newTo = null;
  for (const id of ids2) { const q = await t.at(`${TB(id)} .erd-head`); if (onScreen(q) && !goal2) { goal2 = q; newTo = id; } }
  if (onScreen(h) && goal2) { await drag(h.x, h.y, goal2.x - h.x, goal2.y - h.y, 20); await sleep(300); }
  t.check('erd: dragging a selected line\'s end handle by touch re-points it', !!newTo && await t.ev(`!!document.querySelector('.erd-rel[data-from="review"][data-to="${newTo}"]:not([data-edge-id="r9"])') && document.querySelectorAll('.erd-rel[data-from="review"][data-to="product"]').length === 1`), `${newTo}`);
  // A tap on a line selects it
  await tap(10, 300);
  t.check('erd: a tap on blank canvas clears the selection', (await nSelected()) === 0 && (await t.ev(`document.querySelectorAll('.erd-handle').length`)) === 0);
  await sleep(400);   // the bar fades out (a bar is not zoomed, so at this zoom it is large)
  const lp = await t.ev(`(() => { const p = document.querySelector('.erd-rel[data-edge-id="r8"] .edge-hit'); const L = p.getTotalLength(), m = p.getScreenCTM();
    for (const f of [0.5, 0.4, 0.6, 0.3, 0.7]) { const q = p.getPointAtLength(L * f), x = m.a * q.x + m.e, y = m.d * q.y + m.f;
      const el = document.elementFromPoint(x, y); if (el && el.closest('.erd-rel[data-edge-id="r8"]') && x > 0 && x < ${W} && y > 100 && y < ${H - 120}) return { x, y }; } return null; })()`);
  if (lp) await tap(lp.x, lp.y);
  t.check('erd: a tap on a line selects it and shows its two end handles', !!lp && await t.ev(`!!document.querySelector('.erd-rel.selected[data-edge-id="r8"]')`) && await t.ev(`document.querySelectorAll('.erd-handle').length`) === 2, JSON.stringify(lp));
  await tap(10, 300);
  t.check('erd: blank canvas tap clears it again, and a pinch still zooms from here', (await nSelected()) === 0);
  const z0 = await view();
  await pinch(200, 450, 100, 160);
  t.check('erd: a pinch still zooms after all that', (await view()).k > z0.k * 1.4);
}

t.check('no page errors', t.errors.length === 0, t.errors.join(' | '));
const code = t.finish();
await t.close();
process.exit(code);
