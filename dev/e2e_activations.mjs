// Activation bars (sequence): one check per rule in seqActivations (assets/types/sequence/sequence.js).
//   node dev/e2e_activations.mjs --browser <chrome> --page <activations.html>
// --page: dev/fixtures/sequence/activations.json laid out with `layout_engine.py --layout`.
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { argOf, launch } from './cdp.mjs';

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
} catch (e) {
  console.error('[ERROR]', e.message);
  code = 1;
} finally {
  await t.close();
}
process.exit(code);
