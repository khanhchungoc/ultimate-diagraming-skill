// Subprocess flows on the flowchart page (plan: dev/plans/plan-subprocess.md, Phase 2): the tab row, the button on a subprocess
// step, "Parent", a pan and zoom per tab, one actor list for every tab, a lane that another tab still uses, Auto-Tidy and
// direction per tab, Save and reopen, export of one tab and of all, Copy as Mermaid. Driven with real input, see cdp.mjs.
//
//   node dev/e2e_subprocess.mjs --browser <chrome> --page <laid-out.html> [--plain <html>]
//
// --page:  dev/fixtures/subprocess/laptop-purchase.mmd laid out by `layout_engine.py --layout`
// --plain: any page without subprocess flows (no tab row must show)
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser'), page = argOf('page'), plain = argOf('plain');
if (!browser || !page) { console.error('usage: --browser <chrome> --page <html> [--plain <html>]'); process.exit(1); }
const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
try {
  const J = JSON.stringify;
  const tabs = () => t.ev(`[...document.querySelectorAll('.flow-tab')].map((b) => b.textContent + (b.getAttribute('aria-selected') === 'true' ? '*' : ''))`);
  const laneNames = () => t.ev(`[...document.querySelectorAll('.lane-title')].map((e) => e.textContent)`);
  const nodeIds = () => t.ev(`[...document.querySelectorAll('.flow-node[data-node-id]')].map((e) => e.dataset.nodeId).sort()`);
  const positions = () => t.ev(`J = JSON.stringify([...document.querySelectorAll('.flow-node')].map((n) => [n.dataset.nodeId, n.style.left, n.style.top]).sort())`);
  const goTab = async (name) => { await t.clickOn(`.flow-tab[data-tab="${name}"]`); await sleep(250); };
  const status = () => t.ev(`document.getElementById('save-status').textContent`);
  const dlDir = mkdtempSync(join(tmpdir(), 'sub_'));
  await t.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  const download = async (action, ext) => {
    readdirSync(dlDir).forEach((f) => rmSync(join(dlDir, f), { force: true }));
    await action();
    for (let i = 0; i < 60; i++) {
      const fs = readdirSync(dlDir).filter((n) => n.endsWith(ext));
      if (fs.length) { await sleep(300); return readdirSync(dlDir).filter((n) => n.endsWith(ext)).map((f) => [f, readFileSync(join(dlDir, f), 'utf8')]); }
      await sleep(100);
    }
    return [];
  };
  const blockOf = (html) => (html.match(/<script id="diagram-data" type="application\/json">([\s\S]*?)<\/script>/) || [])[1];
  // A lane's saved height is what the page measured: the last lane may carry the room for outer loop-backs (render), so it is not compared
  const same = (a, b) => !!a && a.replace(/"height": \d+/g, '"height": 0') === (b || '').replace(/"height": \d+/g, '"height": 0');
  const save = async () => (await download(() => t.ev(t.key('s', { ctrlKey: true })), '.html'))[0]?.[1] || '';
  const exportMenu = (sel) => async () => { await t.clickOn('#btn-export'); await t.clickOn(sel); };

  // 1. The tab row
  await t.open(page);
  t.check('the page loads with no errors', t.errors.length === 0, t.errors.join(' | '));
  const first = await tabs();
  t.check('the tab row has the parent first and the children in the order the parent reaches them',
    J(first) === J(['Main flow*', 'Approve Specification', 'Procure Laptop', 'Source from Supplier']), J(first));
  const parentNodes = await nodeIds();
  const parentLanes = await laneNames();
  t.check('the parent flow shows its own five lanes', J(parentLanes) === J(['Employee', 'System', 'IT Support', 'Line Manager', 'Supplier']), J(parentLanes));
  t.check('a subprocess step with a child has the open button (three), other steps none', (await t.ev(`document.querySelectorAll('.sub-open').length`)) === 3
    && (await t.ev(`[...document.querySelectorAll('.sub-open')].every((b) => b.parentElement.classList.contains('type-subprocess'))`)));
  t.check('the Export menu offers one SVG per tab', await t.ev(`!document.querySelector('[data-export="svg-all"]').hidden`));

  // 2. Open a child by its button, come back by "Parent"
  await t.ev(`document.querySelector('.flow-node[data-node-id="procure_laptop"] .sub-open').click()`);
  await sleep(300);
  const childLanes = await laneNames();
  t.check('the button opens the child: its tab is selected and it shows only its own three lanes', J(await tabs()) === J(['Main flow', 'Approve Specification', 'Procure Laptop*', 'Source from Supplier'])
    && J(childLanes) === J(['Procurement', 'Finance', 'Line Manager']), J(await tabs()) + J(childLanes));
  t.check('a child tab has the Parent link and no open buttons', (await t.ev(`!!document.querySelector('.flow-up')`)) && (await t.ev(`document.querySelectorAll('.sub-open').length`)) === 0);
  t.check('the child holds its own steps', (await nodeIds()).includes('obtain_price') && !(await nodeIds()).includes('submit_request'));
  await t.clickOn('.flow-up');
  await sleep(300);
  t.check('Parent returns to the main flow and selects the subprocess step', J(await tabs()) === J(first)
    && await t.ev(`[...document.querySelectorAll('.flow-node.selected')].map((e) => e.dataset.nodeId).join()`) === 'procure_laptop');
  t.check('every step of the parent is back', J(await nodeIds()) === J(parentNodes));
  t.check('switching tabs is not an edit', !/unsaved/i.test(await status()), await status());

  // 3. Each tab keeps its own pan and zoom
  await t.ev(`document.getElementById('btn-zoom-in').click()`);
  await t.ev(`document.getElementById('btn-zoom-in').click()`);
  const zoomParent = await t.ev(`document.getElementById('zoom-level').textContent`);
  await goTab('approve_spec');
  const zoomChild = await t.ev(`document.getElementById('zoom-level').textContent`);
  await goTab('');
  t.check('a tab remembers its zoom: back on the parent it is as left, the child had its own', (await t.ev(`document.getElementById('zoom-level').textContent`)) === zoomParent && zoomChild !== zoomParent,
    `parent ${zoomParent}, child ${zoomChild}, back ${await t.ev(`document.getElementById('zoom-level').textContent`)}`);

  // 4. Tidy works on the tab it is on and moves nothing in the others
  const parentPos = await positions();
  await goTab('source_laptop');
  const childPos = await positions();
  await t.ev(`document.getElementById('btn-auto-tidy').click()`);
  await sleep(300);
  t.check('Tidy on a child keeps a laid-out child where it was', (await positions()) === childPos);
  await goTab('');
  t.check('and the parent is untouched', (await positions()) === parentPos);

  // 5. One actor list: a rename or colour in one tab is the same in the others
  await goTab('approve_spec');
  await t.clickOn('.swimlane:nth-child(2) .lane-title');
  await sleep(150);
  await t.clickOn('.swimlane.lane-selected .lane-bar [data-act="rename"]');
  await t.type('Tech Desk');
  await t.press('Enter');
  await sleep(200);
  t.check('a lane renamed in a child shows its new name there', (await laneNames()).includes('Tech Desk'), J(await laneNames()));
  await goTab('');
  t.check('and in the parent (one actor, one name)', (await laneNames()).includes('Tech Desk') && !(await laneNames()).includes('IT Support'), J(await laneNames()));
  await goTab('source_laptop');
  t.check('and in every other child', (await laneNames()).includes('Tech Desk'), J(await laneNames()));
  const colorOf = (name) => t.ev(`(() => { const l = [...document.querySelectorAll('.swimlane')].find((e) => e.querySelector('.lane-title').textContent === ${J(name)}); return l && getComputedStyle(l).getPropertyValue('--lane-color'); })()`);
  const lmChild = await colorOf('Procurement');
  await goTab('procure_laptop');
  t.check('a lane has one colour in every flow', (await colorOf('Procurement')) === lmChild && lmChild);

  // 6. A lane that another tab still has steps in cannot be deleted
  await t.clickOn('.swimlane:nth-child(3) .lane-title');
  await sleep(150);
  const before = (await laneNames()).length;
  await t.press('Delete');
  await sleep(250);
  t.check('deleting a lane that the parent still uses is refused with a hint', (await laneNames()).length === before && !(await t.ev(`!!document.querySelector('.confirm')`))
    && /another flow/.test(await t.ev(`(document.querySelector('.flow-hint') || {}).textContent || ''`)), await t.ev(`(document.querySelector('.flow-hint') || {}).textContent || ''`));
  await goTab('');

  // 7. Direction: every tab is laid out again
  const isTB = () => t.ev(`document.getElementById('swimlanes-container').classList.contains('dir-tb')`);
  const noOverlap = () => t.ev(`(() => {
    const ns = [...document.querySelectorAll('.flow-node:not(.type-connector)')].map((n) => n.getBoundingClientRect());
    return !ns.some((a, i) => ns.some((b, j) => j > i && a.left < b.right - 2 && a.right > b.left + 2 && a.top < b.bottom - 2 && a.bottom > b.top + 2)); })()`);
  const tb0 = await isTB();
  await t.ev(`document.getElementById('btn-direction').click()`);
  await sleep(400);
  await goTab('approve_spec');
  t.check('the direction is shared: a child opens in the new direction, with no overlapping steps', (await isTB()) === !tb0 && (await noOverlap()));
  await goTab('');
  await t.ev(`document.getElementById('btn-direction').click()`);
  await sleep(400);
  await goTab('approve_spec');
  t.check('and back again', (await isTB()) === tb0 && (await noOverlap()));

  // 8. Save: the block holds every tab, positions in the one layout map; a reopened file looks the same
  await goTab('');
  const generated = readFileSync(page, 'utf8').replace(/\r\n/g, '\n');
  await t.open(page);
  const saved0 = await save();
  t.check('Save without edits writes the generated data block byte for byte (JS and Python codecs agree, children included)', same(blockOf(saved0), blockOf(generated)),
    (() => { const a = blockOf(saved0) || '', b = blockOf(generated) || ''; let i = 0; while (i < a.length && a[i] === b[i]) i++; return `first difference at ${i}: saved ${J(a.slice(i - 40, i + 80))} generated ${J(b.slice(i - 40, i + 80))}`; })());

  // 9. An edit in a child reaches the saved file under that child, and the file reopens with it
  await goTab('source_laptop');
  const kids0 = Object.keys(JSON.parse(blockOf(generated)).children);
  await t.ev(`document.getElementById('btn-add-step').click()`);
  await sleep(400);
  const saved1 = await save();
  const model1 = JSON.parse(blockOf(saved1));
  const added = model1.children.source_laptop.nodes.filter((n) => !JSON.parse(blockOf(generated)).children.source_laptop.nodes.some((m) => m.id === n.id));
  t.check('a step added in a child is saved in that child (renamed, positioned in the layout map), the parent and other children unchanged',
    added.length === 1 && /^n_/.test(added[0].id) && model1.layout[added[0].id] && model1.nodes.length === JSON.parse(blockOf(generated)).nodes.length
    && J(Object.keys(model1.children)) === J(kids0) && /unsaved/i.test(await status()) === false, J(added) + ' ' + await status());
  const reopen = join(mkdtempSync(join(tmpdir(), 'sub_re_')), 'reopened.html');
  writeFileSync(reopen, saved1);
  await t.open(reopen);
  await goTab('source_laptop');
  t.check('the saved file reopens with the same tabs and the new step in its child', J(await tabs()) === J(['Main flow', 'Approve Specification', 'Procure Laptop', 'Source from Supplier*'])
    && (await nodeIds()).includes(added[0].id) && t.errors.length === 0, t.errors.join(' | '));

  // 10. Undo follows the edit into its tab
  await t.open(page);
  await goTab('procure_laptop');
  const n0 = (await nodeIds()).length;
  await t.ev(`document.getElementById('btn-add-step').click()`);
  await sleep(300);
  await goTab('');
  await t.ev(`document.getElementById('btn-undo').click()`);
  await sleep(300);
  await goTab('procure_laptop');
  t.check('Undo of an edit made in a child takes the step out of that child, wherever the person is', (await nodeIds()).length === n0, (await nodeIds()).length + ' vs ' + n0);

  // 11. Export: the tab on screen, or every tab
  await goTab('source_laptop');
  const svg1 = await download(exportMenu('[data-export="svg"]'), '.svg');
  t.check('Export SVG takes the tab on screen only', svg1.length === 1 && svg1[0][1].includes('Check Stock') && !svg1[0][1].includes('Check Mandatory Info'), svg1.map((f) => f[0]).join());
  const all = await download(exportMenu('[data-export="svg-all"]'), '.svg');
  const names = all.map((f) => f[0]).sort();
  await sleep(500);
  t.check('"every tab" writes one SVG per tab, named after it', names.length === 4 && names.some((n) => /source-from-supplier/.test(n)) && names.some((n) => /main-flow/.test(n)), names.join());
  t.check('and leaves the tab it was on selected', (await tabs()).includes('Source from Supplier*'));

  // 12. Copy as Mermaid: one text with the sub_ blocks; a lane repeated in a block has its own id there (stock Mermaid merges repeats)
  await t.ev(`window.__copied = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: (s) => { window.__copied = s; return Promise.resolve(); } }, configurable: true })`);
  await t.ev(`document.querySelector('[data-copy="mermaid"]').hidden = false`);
  await t.clickOn('#btn-export');
  await t.clickOn('[data-copy="mermaid"]');
  await sleep(300);
  const mmd = await t.ev(`window.__copied`);
  t.check('Copy as Mermaid holds the parent, the three sub_ blocks and per-block lane ids', !!mmd && (mmd.match(/subgraph sub_/g) || []).length === 3 && /subgraph lane_manager__procure_laptop\[/.test(mmd) && /subgraph lane_manager\[/.test(mmd), (mmd || '').slice(0, 200));
  await t.ev(`document.getElementById('btn-import-mermaid').click()`);
  await sleep(200);
  t.check('the Paste Mermaid box opens', await t.ev(`!!document.querySelector('.confirm-field')`));
  await t.ev(`(() => { const f = document.querySelector('.confirm-field'); f.value = window.__copied; document.querySelector('.confirm-ok').click(); })()`);
  await sleep(900);
  t.check('pasting that text back gives the same tabs and lanes (the per-block ids read as the one actor)', J(await tabs()) === J(['Main flow*', 'Approve Specification', 'Procure Laptop', 'Source from Supplier'])
    && (await laneNames()).length === 5 && t.errors.length === 0, J(await tabs()) + J(await laneNames()) + t.errors.join(' | '));

  // 13. A page with no children has no tab row
  if (plain) {
    await t.open(plain);
    t.check('a diagram without subprocess flows shows no tab row and no SVG-per-tab item', await t.ev(`document.getElementById('flow-tabs').hidden && document.querySelector('[data-export="svg-all"]').hidden`));
  }
  t.check('no errors in the whole run', t.errors.length === 0, t.errors.join(' | '));
  code = t.finish();
} catch (e) {
  console.error('[ERROR]', e.stack || e.message);
  code = 1;
} finally {
  await t.close();
}
process.exit(code);
