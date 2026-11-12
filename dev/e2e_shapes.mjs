// Interaction test for the classic flowchart shapes (subprocess, io, document, database, delay; plus the decision's
// diamond, which shares their outline code). Driven over the Chrome DevTools Protocol, see cdp.mjs.
//
//   node dev/e2e_shapes.mjs --browser <chrome> --page <laid-out.html>
//
// --page: dev/fixtures/flowchart/classic-shapes.json laid out by `layout_engine.py --layout` (one of each shape)
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { argOf, launch } from './cdp.mjs';

const browser = argOf('browser'), page = argOf('page');
if (!browser || !page) { console.error('usage: --browser <chrome> --page <html>'); process.exit(1); }

const SHAPES = ['subprocess', 'io', 'document', 'database', 'delay'];
const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
try {
  await t.open(page);
  const graph = `JSON.stringify({ n: document.querySelectorAll('.flow-node').length, e: document.querySelectorAll('.connector-path').length })`;

  // 1. Every shape renders as its outline inside a transparent box
  const drawn = await t.ev(`${JSON.stringify(SHAPES)}.map(s => {
    const n = document.querySelector('.flow-node.type-' + s);
    return n && !!n.querySelector('svg.shape-outline .shape-path') && getComputedStyle(n).backgroundColor === 'rgba(0, 0, 0, 0)';
  })`);
  t.check('each classic shape renders an SVG outline in a transparent box', drawn.every(Boolean) && t.errors.length === 0,
    `drawn=${JSON.stringify(drawn)} errors=${t.errors.join(' | ')}`);

  // 2. Arrow ends sit on the outline, left to right and top to bottom. Each end of each arrow that lands on a shaped
  // node is compared with the outline, sampled in the node's own px (the viewBox is the box, 1 unit = 1 px).
  const endsOff = `(() => {
    const scale = (() => { const n = document.querySelector('.flow-node'); return n.getBoundingClientRect().width / n.offsetWidth; })();
    const shaped = [...document.querySelectorAll('.flow-node')].filter(n => n.querySelector('svg.shape-outline'));
    const outline = new Map(shaped.map(n => {
      const pts = [];
      n.querySelectorAll('.shape-outline .shape-path').forEach(p => { const L = p.getTotalLength(); for (let s = 0; s <= L; s += 0.5) { const q = p.getPointAtLength(s); pts.push([q.x, q.y]); } });
      return [n, pts];
    }));
    const bad = [];
    let checked = 0;
    for (const p of document.querySelectorAll('.connector-path')) {
      const L = p.getTotalLength(), m = p.getScreenCTM();
      for (const s of [0, L]) {
        const q = p.getPointAtLength(s), x = q.x * m.a + m.e, y = q.y * m.d + m.f;
        const n = shaped.find(n => { const r = n.getBoundingClientRect(); return x > r.left - 3 && x < r.right + 3 && y > r.top - 3 && y < r.bottom + 3; });
        if (!n) continue;
        const r = n.getBoundingClientRect(), lx = (x - r.left) / scale, ly = (y - r.top) / scale;
        const d = Math.min(...outline.get(n).map(([ox, oy]) => Math.hypot(ox - lx, oy - ly)));
        checked++;
        if (d > 2.5) bad.push(n.className.match(/type-(\\w+)/)[1] + ' ' + p.dataset.edgeId + (s ? ' end' : ' start') + ' off by ' + d.toFixed(1));
      }
    }
    return { checked, bad };
  })()`;
  const lr = await t.ev(endsOff);
  t.check('left to right: every arrow end on a shaped node touches its outline', lr.checked >= 10 && lr.bad.length === 0, JSON.stringify(lr));
  await t.ev(`document.getElementById('btn-direction').click()`);
  const tb = await t.ev(endsOff);
  t.check('top to bottom: every arrow end on a shaped node touches its outline', tb.checked >= 10 && tb.bad.length === 0, JSON.stringify(tb));
  await t.ev(t.key('z', { ctrlKey: true }));

  // 3. Each palette tile adds its own shape, with the outline and its default label
  const g0 = JSON.parse(await t.ev(graph));
  for (const s of SHAPES) {
    const before = await t.ev(`document.querySelectorAll('.flow-node.type-${s}').length`);
    await t.ev(`document.querySelector('.btn-shape[data-node-type="${s}"]').click()`);
    const added = await t.ev(`(() => { const n = document.querySelector('.flow-node.selected'); return n && [n.classList.contains('type-${s}'), !!n.querySelector('.shape-outline'), n.querySelector('.node-label').textContent]; })()`);
    const after = await t.ev(`document.querySelectorAll('.flow-node.type-${s}').length`);
    t.check(`the ${s} tile adds one ${s} node with its outline`, after === before + 1 && added && added[0] && added[1] && added[2].length > 0, `before=${before} after=${after} added=${JSON.stringify(added)}`);
    await t.ev(t.key('z', { ctrlKey: true }));
  }
  t.check('undo removes each added shape', JSON.stringify(JSON.parse(await t.ev(graph))) === JSON.stringify(g0), await t.ev(graph));

  // 4. Each shape can be dropped onto an arrow: one node and one arrow more, the new arrow unlabelled
  const midOfArrow = `(() => {
    for (const p of document.querySelectorAll('.connector-path')) {
      const lbl = document.querySelector('.edge-label-container[data-edge-id="' + p.dataset.edgeId + '"] .edge-label-text');
      if (lbl && lbl.textContent.trim() && !/^\\+/.test(lbl.textContent.trim())) continue;
      const L = p.getTotalLength(), m = p.getScreenCTM();
      for (const f of [0.5, 0.35, 0.65]) {
        const q = p.getPointAtLength(L * f), x = q.x * m.a + m.e, y = q.y * m.d + m.f;
        const el = document.elementFromPoint(x, y);
        if (el && !el.closest('.flow-node') && !el.closest('.dock-area') && document.getElementById('viewport').contains(el)) return [x, y];
      }
    }
    return null;
  })()`;
  const drop = (type, x, y) => `(async () => {
    const b = document.querySelector('[data-node-type="${type}"]'), r = b.getBoundingClientRect();
    const o = (cx, cy) => ({ bubbles: true, button: 0, clientX: cx, clientY: cy, pointerId: 1, isPrimary: true });
    b.dispatchEvent(new PointerEvent('pointerdown', o(r.left + 10, r.top + 10)));
    window.dispatchEvent(new PointerEvent('pointermove', o(r.left + 30, r.top - 30)));
    window.dispatchEvent(new PointerEvent('pointermove', o(${x}, ${y})));
    const ghost = document.querySelector('.palette-ghost .shape-outline') ? 1 : 0;
    const hl = !!document.querySelector('.connector-path.insert-target');
    window.dispatchEvent(new PointerEvent('pointerup', o(${x}, ${y})));
    b.click();
    return [hl, ghost];
  })()`;
  for (const s of SHAPES) {
    const at = await t.ev(midOfArrow);
    if (!at) { t.check(`found an arrow to drop ${s} onto`, false); continue; }
    const [hl, ghost] = await t.ev(drop(s, at[0], at[1]));
    const g = JSON.parse(await t.ev(graph));
    const sel = await t.ev(`document.querySelector('.flow-node.selected')?.classList.contains('type-${s}')`);
    t.check(`dropping ${s} onto an arrow splices it in (ghost drawn as the outline)`, hl && ghost && sel && g.n === g0.n + 1 && g.e === g0.e + 1,
      `hl=${hl} ghost=${ghost} sel=${sel} graph=${JSON.stringify(g)}`);
    await t.ev(t.key('z', { ctrlKey: true }));
  }

  // 5. The SVG export carries every outline
  const svgText = await t.ev(`new Promise(res => {
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { URL.createObjectURL = orig; b.text().then(res); return 'blob:x'; };
    document.querySelector('[data-export="svg"]').click();
  })`);
  // The export inlines computed styles and drops class names, so each outline is recognised by its geometry
  // (SHAPE_OUTLINES in flowchart.js), drawn with a stroke
  const GEOMETRY = { subprocess: 'M13 1V63M131 1V63', io: '13,1 143,1 131,63 1,63', document: 'V57C119 49 96 49 72 57',
    database: 'A71 8 0 0 0 143 9', delay: 'H111A32 31 0 0 1 111 63' };
  const inExport = SHAPES.map(s => new RegExp(`${GEOMETRY[s].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*"[^>]*stroke:`).test(svgText));
  t.check('SVG export contains each shape\'s outline', inExport.every(Boolean), JSON.stringify(Object.fromEntries(SHAPES.map((s, i) => [s, inExport[i]]))));
  t.check('no page errors', t.errors.length === 0, t.errors.join(' | '));
} catch (err) {
  console.error('[ERROR]', err.message);
  code = 1;
} finally {
  await t.close();
}
process.exit(code || t.finish());
