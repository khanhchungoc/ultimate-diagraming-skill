// Touch test for the shell's pan and zoom on a phone: one finger pans 1:1, two fingers pinch-zoom (the page itself
// never zooms), a drag that starts on an unselected item pans instead of moving it, a tap selects (even when the
// browser's touch adjustment would have hit a step's connect port), a selected item drags, a tap on blank canvas
// clears the selection; and the sequence participant row pins, over an opaque band, once panned off by touch.
// Real touch input over the Chrome DevTools Protocol (Input.dispatchTouchEvent), phone-sized and mobile-emulated.
//
//   node dev/e2e_touch.mjs --browser <chrome> --sequence <html> --flowchart <html>
//
// --sequence:  dev/fixtures/sequence/payment-phases.json laid out by `layout_engine.py --layout` (a long diagram)
// --flowchart: dev/fixtures/flowchart/loan-application.json laid out
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser'), sequence = argOf('sequence'), flowchart = argOf('flowchart');
if (!browser || !sequence || !flowchart) {
  console.error('usage: --browser <chrome> --sequence <html> --flowchart <html>');
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
  const canvas = document.getElementById('seq-canvas'), band = canvas.querySelector('.seq-pin-band');
  const box = canvas.querySelector('.seq-participant').getBoundingClientRect(), vp = document.getElementById('viewport').getBoundingClientRect();
  const b = band.getBoundingClientRect(), c = canvas.getBoundingClientRect();
  return { pinned: canvas.classList.contains('seq-pinned'), boxTop: box.top, vpTop: vp.top, bandW: b.width, canvasW: c.width,
    bandCovers: b.top <= box.top && b.bottom >= box.bottom };
})()`);
t.check('the participant row pins once panned off by touch', pin.pinned);
t.check('the pinned row sits at the top of the viewport', pin.boxTop >= pin.vpTop - 1 && pin.boxTop < pin.vpTop + 60, `${pin.boxTop} vs ${pin.vpTop}`);
t.check('the band behind the pinned row spans the diagram and covers the boxes', Math.abs(pin.bandW - pin.canvasW) < 4 && pin.bandCovers, JSON.stringify(pin));

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

t.check('no page errors', t.errors.length === 0, t.errors.join(' | '));
const code = t.finish();
await t.close();
process.exit(code);
