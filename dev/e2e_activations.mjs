// Activation bars (sequence): one check per rule in seqActivations (assets/types/sequence/sequence.js).
//   node dev/e2e_activations.mjs --browser <chrome> --page <activations.html>
// --page: dev/fixtures/sequence/activations.json laid out with `layout_engine.py --layout`.
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser'), page = argOf('page');
if (!browser || !page) { console.error('usage: --browser <chrome> --page <html>'); process.exit(1); }
const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
try {
  await t.open(page);
  // Each bar as [participant, first message it covers, last message it covers, depth (x offset)]
  const bars = JSON.parse(await t.ev(`(() => {
    const ys = {};
    document.querySelectorAll('.seq-line[data-edge-id]').forEach((l) => { ys[l.dataset.edgeId] = +l.getAttribute('d').split(' ')[2]; });
    const ids = Object.keys(ys);
    const xs = {};
    return JSON.stringify([...document.querySelectorAll('.seq-activation')].map((r) => {
      const y1 = +r.getAttribute('y'), y2 = y1 + +r.getAttribute('height'), pid = r.dataset.nodeId, x = +r.getAttribute('x');
      const inside = ids.filter((id) => ys[id] >= y1 && ys[id] <= y2);
      xs[pid] = Math.min(xs[pid] === undefined ? x : xs[pid], x);
      return { pid, from: inside[0] || null, to: inside[inside.length - 1] || null, x, y1, y2 };
    }).map((b) => Object.assign(b, { depth: Math.round((b.x - xs[b.pid]) / 5) })));
  })()`));
  const of = (pid) => bars.filter((b) => b.pid === pid);
  const show = (pid) => JSON.stringify(of(pid).map((b) => [b.from, b.to, b.depth]));
  const check = (name, ok, info) => { console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${ok ? '' : ' - ' + info}`); if (!ok) code = 2; };
  check('a person who starts the flow gets no bar', of('u').length === 0, show('u'));
  const a0 = of('a').filter((b) => b.depth === 0);
  check('the participant handling the first call has one continuous bar until its reply', a0.length === 1 && a0[0].from === 'm1' && a0[0].to === 'm12', show('a'));
  const b0 = of('b').filter((b) => b.from !== 'm13' && b.from !== 'm14');
  check('two calls answered one after the other give the callee two separate bars', b0.length === 2 && b0[0].from === 'm2' && b0[0].to === 'm3' && b0[1].from === 'm4' && b0[1].to === 'm7', show('b'));
  check('a callback while busy is a bar on a bar', of('a').some((b) => b.depth === 1 && b.from === 'm5' && b.to === 'm6'), show('a'));
  check('a self-call is a short bar on a bar where the loop returns', of('a').some((b) => b.depth === 1 && b !== of('a').find((x) => x.from === 'm5') && b.y1 > 0 && (b.from === 'm8' || b.from === null || b.to === 'm8' || b.to === null)), show('a'));
  check('an async message whose target does nothing gets no bar', of('q').length === 0, show('q'));
  const c = of('c');
  check('a call with no reply is a short bar that ends when the caller moves on', c.length >= 2 && c[0].from === 'm10' && c[0].to === 'm10' && c[1].from === 'm11', show('c'));
  check('a system that starts the flow is busy from its first call until it is next called', of('j')[0] && of('j')[0].from === 'm13' && ['m18', 'm19', 'm20'].includes(of('j')[0].to), show('j'));
  check('"activate": false opens no bar', !of('b').some((b) => b.from === 'm15' || b.to === 'm15'), show('b'));
  const cu = c.find((b) => b.from === 'm17');
  check('"until" stretches a bar to that message', !!cu && cu.to === 'm18', show('c'));
  check('a bar stretched with "until" stays one bar when that participant calls out inside it', of('k').length === 1 && of('k')[0].from === 'm19' && of('k')[0].to === 'm22', show('k'));
  // The message bar's Bar button writes "activate": a sync call's bar can be switched off and on by hand
  const barsOf = (pid) => t.ev(`document.querySelectorAll('.seq-activation[data-node-id="${pid}"]').length`);
  await t.clickOn('.seq-msg-hit[data-edge-id="m15"]');
  const before = await barsOf('b');
  await t.clickOn('.seq-actionbar [data-act="activate"]');
  const on = await barsOf('b');
  check('the message bar has a Bar button, pressed when the call opens a bar; "activate": false was off, one click turns it on', before + 1 === on && on > before, `${before} -> ${on}`);
  await t.clickOn('.seq-msg-hit[data-edge-id="m15"]');
  await t.clickOn('.seq-actionbar [data-act="activate"]');
  check('and a second click turns it off again', (await barsOf('b')) === before, `${await barsOf('b')} vs ${before}`);

  // --- Stretch a bar with the handle at its bottom end ("until", and "activate": false on the calls it swallows) ---
  const saved = async () => { await t.press('s', { modifiers: 2 }); await sleep(300); return t.ev(`document.getElementById('diagram-data').textContent`); };
  const msgs = async () => Object.fromEntries(JSON.parse(await saved()).messages.map((m) => [m.id, m]));
  const rowY = (id) => t.ev(`document.querySelector('.seq-line[data-edge-id="${id}"]').getBoundingClientRect().top + 6`);
  const handle = (id) => `.seq-barend[data-id="${id}"]`;
  const stretch = async (id, to, escape = false) => {
    await t.clickOn(`.seq-msg-label[data-edge-id="${id}"]`);
    const h = await t.at(handle(id));
    if (!h) throw new Error(`no stretch handle on ${id}`);
    const y = await rowY(to);
    if (escape) {
      await t.mouse('mouseMoved', h.x, h.y); await t.mouse('mousePressed', h.x, h.y, { button: 'left', buttons: 1, clickCount: 1 });
      await t.mouse('mouseMoved', h.x, y, { button: 'left', buttons: 1 }); await t.press('Escape');
      await t.mouse('mouseReleased', h.x, y, { button: 'left', buttons: 0, clickCount: 1 }); await sleep(80);
    } else await t.dragTo(h.x, h.y, h.x, y);
  };
  let ms = await msgs();
  check('no stretch handle on the bar of a flow initiator, nor with nothing selected', (await t.at('.seq-barend')) === null && ms.m4.until === undefined);
  await stretch('m4', 'm9');
  ms = await msgs();
  check('dragging the bar end to a later row sets "until" on the opening message (no flags when no call is swallowed)', ms.m4.until === 'm9' && ms.m8.activate === undefined, JSON.stringify(ms.m4));
  check('and the bar now reaches that row', (await t.ev(`document.querySelector('.seq-activation[data-mid="m4"]').getBoundingClientRect().bottom`)) > (await rowY('m8')));
  await t.press('z', { modifiers: 2 });
  ms = await msgs();
  check('one undo takes it away', ms.m4.until === undefined, JSON.stringify(ms.m4));
  await stretch('m2', 'm7');
  ms = await msgs();
  check('stretching over a later call to the same participant sets "until" and "activate": false on that call', ms.m2.until === 'm7' && ms.m4.activate === false && ms.m5.activate === undefined, JSON.stringify([ms.m2, ms.m4]));
  check('the two bars became one', (await t.ev(`document.querySelectorAll('.seq-activation[data-node-id="b"][data-mid="m2"]').length`)) === 1 && (await t.ev(`!document.querySelector('.seq-activation[data-mid="m4"]')`)));
  const savedText = await saved();
  check('Save writes them to the data block', JSON.parse(savedText).messages.find((m) => m.id === 'm2').until === 'm7');
  const out = join(mkdtempSync(join(tmpdir(), 'act_')), 'saved.html');
  writeFileSync(out, readFileSync(page, 'utf8').replace(/(<script id="diagram-data" type="application\/json">)[\s\S]*?(<\/script>)/, (_, a, b) => a + savedText + b));
  await t.open(out);
  check('after a reload the bar is still one, stretched to that row', (await t.ev(`!document.querySelector('.seq-activation[data-mid="m4"]') && !!document.querySelector('.seq-activation[data-mid="m2"]')`)));
  await t.clickOn('.seq-msg-label[data-edge-id="m2"]');
  check('the opening message shows Reset bar (only when "until" is set)', (await t.at('.seq-actionbar [data-act="resetbar"]')) !== null);
  await t.clickOn('.seq-actionbar [data-act="resetbar"]');
  ms = await msgs();
  check('Reset bar removes "until" and the "activate": false it added', ms.m2.until === undefined && ms.m4.activate === undefined, JSON.stringify([ms.m2, ms.m4]));
  check('and a call with no "until" has no Reset bar button', (await t.at('.seq-actionbar [data-act="resetbar"]')) === null);
  await stretch('m2', 'm7');
  await stretch('m2', 'm3');
  ms = await msgs();
  check('dragging the end back to its natural end clears them', ms.m2.until === undefined && ms.m4.activate === undefined, JSON.stringify([ms.m2, ms.m4]));
  const was = JSON.stringify(await msgs());
  await stretch('m4', 'm1');
  check('a drop above the opening message changes nothing', JSON.stringify(await msgs()) === was);
  await stretch('m4', 'm9', true);
  check('Escape cancels the drag', JSON.stringify(await msgs()) === was);
  // With lifespans a bar cannot run past the end of its lifeline
  const ls = join(mkdtempSync(join(tmpdir(), 'act_')), 'lifespans.html');
  writeFileSync(ls, readFileSync(page, 'utf8').replace(/(<script id="diagram-data" type="application\/json">)([\s\S]*?)(<\/script>)/, (_, a, d, b) => a + JSON.stringify(Object.assign(JSON.parse(d), { lifespans: true })) + b));
  await t.open(ls);
  const lsWas = JSON.stringify(await msgs());
  await stretch('m13', 'm22');
  check('with lifespans, a drop past the end of the participant\'s lifeline changes nothing', JSON.stringify(await msgs()) === lsWas);
  await t.open(page, '?present');
  check('?present shows no handle, even hovering a bar', await (async () => { await t.clickOn('.seq-activation'); return (await t.ev(`document.querySelectorAll('.seq-barend').length`)) === 0; })());
  await t.open(page);
  await t.clickOn('.seq-msg-label[data-edge-id="m4"]');
  const svg = await t.ev(`new Promise(res => {
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { URL.createObjectURL = orig; b.text().then(res); return 'blob:x'; };
    document.querySelector('[data-export="svg"]').click();
  })`);
  check('an SVG export has no stretch handle', svg.length > 1000 && !/seq-barend|seq-handle/.test(svg));
} catch (e) {
  console.error('[ERROR]', e.message);
  code = 1;
} finally {
  await t.close();
}
process.exit(code);
