// Interaction test for flowchart arrows and anchor points (dev/plans/plan-subprocess-depth.md, sections 9 and 10),
// with real mouse and keyboard input. Driven over the Chrome DevTools Protocol, see cdp.mjs.
//
//   node dev/e2e_arrows.mjs --browser <chrome> --page <default.html> --split <connector-forward.html>
//
// --page:  assets/types/flowchart/default.json laid out (has labelled and unlabelled arrows)
// --split: dev/fixtures/flowchart/connector-forward.json laid out (an A pair in place: connector-adjacent arrows)
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser'), page = argOf('page'), split = argOf('split');
if (!browser || !page || !split) { console.error('usage: --browser <chrome> --page <html> --split <html>'); process.exit(1); }

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;

const edgeCount = () => t.ev(`document.querySelectorAll('.edge-line').length`);
const bar = `document.querySelector('.edge-bar')`;
// Viewport point on an arrow, as a fraction of its length (0.5 = the midpoint the label and toolbar hang from)
const pointOn = (id, f = 0.5) => t.ev(`(() => { const p = document.querySelector('.edge-line[data-edge-id="${id}"]');
  const q = p.getPointAtLength(p.getTotalLength() * ${f}).matrixTransform(p.getScreenCTM()); return { x: q.x, y: q.y }; })()`);
// An arrow without / with a label, whose ends are both steps
const pickEdges = () => t.ev(`(() => {
  const ok = (p) => !/^c/.test(p.dataset.from) && !/^c/.test(p.dataset.to) && p.dataset.from !== p.dataset.to;
  const labelled = (p) => document.querySelector('.edge-label[data-edge-id="' + p.dataset.edgeId + '"]').classList.contains('has-label');
  const all = [...document.querySelectorAll('.edge-line')].filter(ok);
  return { plain: all.find(p => !labelled(p))?.dataset.edgeId, named: all.find(labelled)?.dataset.edgeId };
})()`);
const labelBox = (id) => `document.querySelector('.edge-label[data-edge-id="${id}"]')`;
const shown = (expr) => `(() => { const el = ${expr}; return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0; })()`;
const deselect = async () => { await t.click(5, 5); await sleep(80); };
const editing = () => t.ev(`!!document.activeElement && document.activeElement.classList.contains('edge-label-text') && document.activeElement.isContentEditable`);

try {
  await t.open(page);
  const { plain, named } = await pickEdges();
  t.check('the page has an unlabelled and a labelled arrow', !!plain && !!named, JSON.stringify({ plain, named }));
  const n0 = await edgeCount();

  // 1. Section 9: no "+" at rest or on hover for an unlabelled arrow
  const mid = await pointOn(plain, 0.3);   // a point on the line, clear of the toolbar (which sits by the label point)
  const restHidden = !(await t.ev(shown(labelBox(plain)))) && !(await t.ev(`[...document.querySelectorAll('.edge-label-text')].some(e => e.textContent === '+')`));
  await t.mouse('mouseMoved', mid.x, mid.y);
  await sleep(120);
  t.check('an unlabelled arrow draws nothing at its midpoint, at rest or on hover', restHidden && !(await t.ev(shown(labelBox(plain)))));

  // 2. A single click on the midpoint selects and shows the toolbar, no typing
  await t.click(mid.x, mid.y);
  const acts = await t.ev(`[...document.querySelectorAll('.edge-bar .ab-btn')].map(b => b.dataset.act)`);
  t.check('a click selects the arrow and shows Connector, Label, Delete (no typing)',
    JSON.stringify(acts) === '["split","label","delete"]' && !(await editing()) && await t.ev(`document.querySelector('.edge-line[data-edge-id="${plain}"]').classList.contains('selected')`), JSON.stringify(acts));
  t.check('the toolbar is the shared action bar and does not cover where the arrow was clicked', await t.ev(`(() => { const b = ${bar}, r = b.getBoundingClientRect();
    return b.classList.contains('actionbar') && !(${mid.x} >= r.left && ${mid.x} <= r.right && ${mid.y} >= r.top && ${mid.y} <= r.bottom); })()`));

  // 3. Double-click on the arrow opens the editor (empty arrow); Enter commits; the toolbar is hidden while typing
  await deselect();
  await t.click(mid.x, mid.y, { count: 2 });
  await sleep(80);
  const typing = await editing(), barHidden = !(await t.ev(shown(bar)));
  await t.ev(`document.execCommand('insertText', false, 'Maybe')`);
  await t.press('Enter');
  await sleep(120);
  t.check('double-click on an unlabelled arrow opens the label editor (toolbar hidden); Enter saves',
    typing && barHidden && (await t.ev(`${labelBox(plain)}.classList.contains('has-label') && ${labelBox(plain)}.textContent === 'Maybe'`)));
  t.check('a label is one undo step', await (async () => { await t.ev(t.key('z', { ctrlKey: true })); await sleep(120); return await t.ev(`!${labelBox(plain)}.classList.contains('has-label')`); })());

  // 4. Double-click on a label edits it; Escape cancels; an empty result clears it
  await deselect();
  const lp = await t.at(`.edge-label[data-edge-id="${named}"]`);
  const was = await t.ev(`${labelBox(named)}.textContent`);
  await t.click(lp.x, lp.y, { count: 2 });
  await sleep(80);
  const typing2 = await editing();
  await t.ev(`document.execCommand('insertText', false, 'changed')`);
  await t.press('Escape');
  await sleep(120);
  t.check('double-click on a label edits it; Escape cancels', typing2 && (await t.ev(`${labelBox(named)}.textContent`)) === was);
  await t.click(lp.x, lp.y, { count: 2 });
  await t.ev(`document.execCommand('delete')`);
  await t.press('Enter');
  await sleep(120);
  t.check('an empty result clears the label and the arrow draws nothing again', await t.ev(`!${labelBox(named)}.classList.contains('has-label') && getComputedStyle(${labelBox(named)}).display === 'none'`));
  await t.ev(t.key('z', { ctrlKey: true }));
  await sleep(120);

  // 5. The toolbar sits beside the label, never over it, and follows a re-route
  await deselect();
  const lp2 = await t.at(`.edge-label[data-edge-id="${named}"]`);
  await t.click(lp2.x, lp2.y);
  await sleep(80);
  const apart = await t.ev(`(() => { const a = ${bar}.getBoundingClientRect(), b = ${labelBox(named)}.getBoundingClientRect();
    return a.left >= b.right - 1 || a.right <= b.left + 1 || a.top >= b.bottom - 1 || a.bottom <= b.top + 1; })()`);
  t.check('on a labelled arrow a click selects it and the toolbar does not cover the label', apart && !(await editing()));
  t.check('the toolbar sits just past the label, level with it', await t.ev(`(() => { const a = ${bar}.getBoundingClientRect(), b = ${labelBox(named)}.getBoundingClientRect();
    return a.left - b.right >= 0 && a.left - b.right < 24 && Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) < 3; })()`));

  // 6. Hidden while an end is dragged, in presentation and in capture
  await deselect();
  await t.click(mid.x, mid.y);
  const hides = await t.ev(`(() => { const vis = () => getComputedStyle(${bar}).display !== 'none'; const out = [vis()];
    for (const c of ['reconnecting', 'presentation', 'capture']) { document.body.classList.add(c); out.push(vis()); document.body.classList.remove(c); }
    return out; })()`);
  t.check('the toolbar shows, and is hidden while an end is dragged, in presentation and in capture', JSON.stringify(hides) === '[true,false,false,false]', JSON.stringify(hides));

  // 7. Label button opens the same editor
  await t.clickOn(`.edge-bar [data-act="label"]`);
  await sleep(80);
  t.check('the Label button opens the label editor', await editing());
  await t.press('Escape');
  await sleep(120);

  // 8. Delete button removes the arrow in one undo step, same as the Delete key
  await deselect();
  await t.click(mid.x, mid.y);
  await t.clickOn(`.edge-bar [data-act="delete"]`);
  await sleep(150);
  const afterBtn = await edgeCount();
  await t.ev(t.key('z', { ctrlKey: true }));
  await sleep(150);
  t.check('Delete removes the arrow and one Ctrl+Z brings it back', afterBtn === n0 - 1 && (await edgeCount()) === n0, `${n0} -> ${afterBtn} -> ${await edgeCount()}`);
  await deselect();
  await t.click(mid.x, mid.y);
  await t.press('Delete');
  await sleep(150);
  const afterKey = await edgeCount();
  await t.ev(t.key('z', { ctrlKey: true }));
  await sleep(150);
  t.check('the Delete key does the same', afterKey === n0 - 1 && (await edgeCount()) === n0);

  // 9. Connector button: absent when an end is a connector circle (and for a self-loop, which has no such arrow here)
  await t.open(split);
  const ends = await t.ev(`(() => {
    const isC = (id) => document.getElementById('node-' + id)?.classList.contains('type-connector');
    const lines = [...document.querySelectorAll('.edge-line')];
    return { adj: lines.find(p => isC(p.dataset.from) || isC(p.dataset.to))?.dataset.edgeId, whole: lines.find(p => !isC(p.dataset.from) && !isC(p.dataset.to))?.dataset.edgeId };
  })()`);
  const actsOf = async (id) => { await deselect(); const p = await pointOn(id, 0.3); await t.click(p.x, p.y); return t.ev(`[...document.querySelectorAll('.edge-bar .ab-btn')].map(b => b.dataset.act)`); };
  const adjActs = await actsOf(ends.adj);
  t.check('an arrow ending at a connector circle has Label and Delete but no Connector', JSON.stringify(adjActs) === '["label","delete"]', JSON.stringify(adjActs));
  if (ends.whole) t.check('an arrow between two steps has the Connector button', (await actsOf(ends.whole)).includes('split'));

  // 10. Section 10: anchor points show on hover only
  await t.open(page);
  const node = await t.ev(`document.querySelector('.flow-node.type-task').dataset.nodeId`);
  const N = `#node-${node}`;
  const portOp = () => t.ev(`getComputedStyle(document.querySelector('${N} .port')).opacity`);
  await t.mouse('mouseMoved', 5, 5);
  await sleep(300);
  const rest = await portOp();
  await t.clickOn(N);   // select the step, then move the pointer away
  await t.mouse('mouseMoved', 5, 5);
  await sleep(300);
  const selectedAway = await portOp();
  const np = await t.at(N);
  await t.mouse('mouseMoved', np.x, np.y);
  await sleep(300);
  const hovered = await portOp();
  // A touch-only browser (hover: none, as headless Chrome reports) keeps the anchor points on a selected step
  const touch = await t.ev(`matchMedia('(hover: none)').matches`);
  t.check('anchor points are hidden at rest, shown on hover, and on a selected step only without hover', rest === '0' && hovered === '1' && selectedAway === (touch ? '1' : '0'), JSON.stringify({ rest, selectedAway, hovered, touch }));
  await t.ev(`document.body.classList.add('connecting')`);
  await sleep(300);
  t.check('anchor points stay hidden while connecting', (await portOp()) === '0');
  await t.ev(`document.body.classList.remove('connecting')`);
  t.check('a selected step keeps its anchor points only under (hover: none)', await t.ev(`(() => {
    const rules = [];
    const walk = (list, media) => [...list].forEach(r => { if (r.media) walk(r.cssRules, r.media.mediaText); else if (/\\.port/.test(r.selectorText || '') && /selected/.test(r.selectorText)) rules.push(media); });
    [...document.styleSheets].forEach(s => { try { walk(s.cssRules, ''); } catch (e) {} });
    return rules.length > 0 && rules.every(m => /hover:\\s*none/.test(m));
  })()`));

  t.check('no page errors', t.errors.length === 0, t.errors.join(' | '));
  code = t.finish();
} catch (err) {
  console.error('[ERROR]', err.message);
  code = 1;
}
finally { await t.close(); }
process.exit(code);
