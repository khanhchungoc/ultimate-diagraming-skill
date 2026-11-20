// Subprocess flows on the flowchart page (plan: dev/plans/plan-subprocess.md, Phase 2): the tab row, the button on a subprocess
// step, "Parent", a pan and zoom per tab, one actor list for every tab, a lane that another tab still uses, Auto-Tidy and
// direction per tab, Save and reopen, export of one tab and of all, Copy as Mermaid, Collapse to subprocess and Expand (Phase 3).
// Driven with real input, see cdp.mjs.
//
//   node dev/e2e_subprocess.mjs --browser <chrome> --page <laid-out.html> [--plain <html>]
//
// --page:  dev/fixtures/subprocess/laptop-purchase.mmd laid out by `layout_engine.py --layout`
// --plain: any page without subprocess flows (no tab row must show)
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { execFileSync } from 'node:child_process';
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
  // Only the path and the current flow's children are drawn: a tab that is not there is reached through the main flow
  const goTab = async (name) => {
    if (!(await t.ev(`!!document.querySelector('.flow-tab[data-tab="${name}"]')`))) { await t.clickOn(`.flow-tab[data-tab=""]`); await sleep(250); }
    await t.clickOn(`.flow-tab[data-tab="${name}"]`); await sleep(250);
  };
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
  t.check('the button opens the child: its tab is selected and it shows only its own three lanes', J(await tabs()) === J(['Main flow', 'Procure Laptop*'])
    && J(childLanes) === J(['Procurement', 'Finance', 'Line Manager']), J(await tabs()) + J(childLanes));
  t.check('a child tab: subprocess tabs sit inside the main flow box, no open buttons', (await t.ev(`!!document.querySelector('#flow-tabs > .flow-subtabs .flow-tab[aria-selected="true"]') && !document.querySelector('.flow-up')`)) && (await t.ev(`document.querySelectorAll('.sub-open').length`)) === 0);
  t.check('the child holds its own steps', (await nodeIds()).includes('obtain_price') && !(await nodeIds()).includes('submit_request'));
  await t.clickOn(`#flow-tabs > .flow-tab[data-tab=""]`);
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
  t.check('the saved file reopens with the same tabs and the new step in its child', J(await tabs()) === J(['Main flow', 'Source from Supplier*'])
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

  // 13. Collapse to subprocess and Expand (the editor)
  await t.open(page);
  const clickStep = async (id, modifiers = 0) => { await t.clickOn(`.flow-node[data-node-id="${id}"] .node-label`, { modifiers }); await sleep(120); };
  const stepsOf = (model) => J(model.nodes.map((n) => n.id).sort());
  const edgeSet = (edges) => J(edges.map((e) => [e.from, e.to, e.label || '', !!e.feedback].join('|')).sort());
  const orig = JSON.parse(blockOf(readFileSync(page, 'utf8')));
  const visible = (sel) => t.ev(`(() => { const b = document.querySelector(${J(sel)}); return !!b && !b.hidden; })()`);
  await clickStep('configure_laptop');
  t.check('one step selected: no Collapse (a run of two or more), no Expand', !(await visible('#btn-collapse-sub')) && !(await visible('#btn-expand-sub')));
  await clickStep('assign_laptop', 2);
  t.check('two steps in a run: Collapse is offered', await visible('#btn-collapse-sub'));
  await clickStep('configure_laptop');
  await clickStep('close_request', 2);
  t.check('steps that are not one run: no Collapse', !(await visible('#btn-collapse-sub')));
  await clickStep('configure_laptop');
  await clickStep('assign_laptop', 2);
  await t.clickOn('#btn-collapse-sub');
  await sleep(700);
  const after = await tabs();
  t.check('Collapse makes a new tab, leaves one subprocess step with its open button, and its name in edit',
    after.length === 5 && after[4] === 'New Subprocess' && (await t.ev(`document.querySelectorAll('.sub-open').length`)) === 4
    && (await t.ev(`document.activeElement.classList.contains('node-label') && document.activeElement.isContentEditable`)), J(after));
  await t.type('Prepare Laptop');
  await t.press('Enter');
  await sleep(250);
  const sName = await tabs();
  t.check('naming the step names its tab', sName.includes('Prepare Laptop') && !sName.includes('New Subprocess'), J(sName));
  const sid = await t.ev(`document.querySelector('.flow-node.type-subprocess.selected')?.dataset.nodeId || ''`);
  t.check('the parent no longer has the two steps, the child does, with a start pill named like the step and one end', await (async () => {
    const ids = await nodeIds();
    await goTab(sid);
    const kid = await t.ev(`JSON.stringify([...document.querySelectorAll('.flow-node')].map((n) => [n.dataset.nodeId, n.className, n.textContent.trim().slice(0, 40)]))`);
    const k = JSON.parse(kid);
    const ok = !ids.includes('configure_laptop') && ids.includes(sid) && k.some((x) => x[0] === 'configure_laptop') && k.some((x) => x[0] === 'assign_laptop')
      && k.filter((x) => /type-start/.test(x[1])).length === 1 && k.filter((x) => /type-end/.test(x[1])).length === 1 && k.some((x) => /type-start/.test(x[1]) && /Prepare Laptop/.test(x[2]));
    await goTab('');
    return ok;
  })());
  t.check('a level-2 flow can be collapsed again (Collapse is offered there)', await (async () => {
    await goTab(sid);
    await clickStep('configure_laptop');
    await clickStep('assign_laptop', 2);
    const r = await visible('#btn-collapse-sub');
    await goTab('');
    return r;
  })());
  const savedC = JSON.parse(blockOf(await save()));
  t.check('the saved file has the new child under the step (a renamed id), the check on its lanes and steps passes', Object.keys(savedC.children).length === 4
    && Object.keys(savedC.children).every((k) => savedC.nodes.some((n) => n.id === k && n.type === 'subprocess')) && !Object.keys(savedC.children).some((k) => /^n_\d{12}/.test(k)), J(Object.keys(savedC.children)));
  // Undo: the name and then the whole move are one undo step each
  await t.ev(`document.getElementById('btn-undo').click()`);
  await t.ev(`document.getElementById('btn-undo').click()`);
  await sleep(300);
  t.check('Undo brings the original flow back: the rename is one step, the Collapse one step', J(await tabs()) === J(first) && J(await nodeIds()) === J(parentNodes), J(await tabs()));
  // Collapse then Expand gives the same steps and arrows
  await clickStep('configure_laptop');
  await clickStep('assign_laptop', 2);
  await t.clickOn('#btn-collapse-sub');
  await sleep(500);
  await t.press('Escape');
  await clickStep(await t.ev(`document.querySelector('.flow-node.type-subprocess[data-node-id^="n_"]').dataset.nodeId`));
  t.check('a subprocess step with a child offers Expand', await visible('#btn-expand-sub'));
  await t.clickOn('#btn-expand-sub');
  await sleep(500);
  const round = JSON.parse(blockOf(await save()));
  t.check('Collapse then Expand gives back the same steps and the same arrows', stepsOf(round) === stepsOf(orig) && edgeSet(round.edges) === edgeSet(orig.edges)
    && J(Object.keys(round.children)) === J(Object.keys(orig.children)), stepsOf(round).length + ' vs ' + stepsOf(orig).length);
  // Expanding every child equals `--extract --flat` (the same wiring in JS and Python)
  await t.open(page);
  for (const k of ['approve_spec', 'procure_laptop', 'source_laptop']) {
    await t.ev(`document.getElementById('btn-zoom-reset').click()`);
    await sleep(200);
    await clickStep(k);
    await t.clickOn('#btn-expand-sub');
    await sleep(500);
  }
  const flatPage = JSON.parse(blockOf(await save()));
  const flatPy = JSON.parse(execFileSync('python3', [join(import.meta.dirname, '..', 'scripts', 'layout_engine.py'), '--extract', page, '--flat', '--json'], { encoding: 'utf8', maxBuffer: 1 << 26 }));
  t.check('expanding every subprocess in the editor gives what --extract --flat prints (steps and arrows)', !flatPage.children && stepsOf(flatPage) === stepsOf(flatPy) && edgeSet(flatPage.edges) === edgeSet(flatPy.edges),
    `${stepsOf(flatPage) === stepsOf(flatPy)} ${J(JSON.parse(edgeSet(flatPage.edges)).filter((e) => !JSON.parse(edgeSet(flatPy.edges)).includes(e)))} ${J(JSON.parse(edgeSet(flatPy.edges)).filter((e) => !JSON.parse(edgeSet(flatPage.edges)).includes(e)))}`);
  t.check('with no child left the tab row is gone', await t.ev(`document.getElementById('flow-tabs').hidden`) && !(await t.ev(`!!document.querySelector('.sub-open')`)));


  // 14. A page with no children has no tab row
  if (plain) {
    await t.open(plain);
    t.check('a diagram without subprocess flows shows no tab row and no SVG-per-tab item', await t.ev(`document.getElementById('flow-tabs').hidden && document.querySelector('[data-export="svg-all"]').hidden`));
    // 15. A Subprocess shape added from Shapes gets a tab of its own (start, one step, end); undo takes both away
    await t.ev(`document.getElementById('btn-add-subprocess').click()`);
    await sleep(400);
    t.check('a Subprocess from Shapes adds its tab and the open button', J(await tabs()) === J(['Main flow*', 'Subprocess']) && (await t.ev(`document.querySelectorAll('.sub-open').length`)) === 1, J(await tabs()));
    await t.ev(`document.querySelectorAll('.flow-tab')[1].click()`);
    await sleep(400);
    t.check('its flow is a start pill named like the step, one step and an end pill', J(await t.ev(`[...document.querySelectorAll('.flow-node')].map((n) => n.textContent.trim())`)) === J(['Subprocess', 'New Step', 'Subprocess Done']),
      J(await t.ev(`[...document.querySelectorAll('.flow-node')].map((n) => n.textContent.trim())`)));
    await t.ev(`document.getElementById('btn-add-subprocess').click()`);
    await sleep(400);
    t.check('a Subprocess added inside a child flow gets a tab of its own, shown as its child', J(await tabs()) === J(['Main flow', 'Subprocess*', 'Subprocess']), J(await tabs()));
    await t.ev(`document.getElementById('btn-undo').click()`);
    await t.ev(`document.getElementById('btn-undo').click()`);
    await sleep(400);
    t.check('undo removes the step and its tab', await t.ev(`document.getElementById('flow-tabs').hidden`), J(await tabs()));
  }

  // 16. Four levels (plan-subprocess-depth.md): the nested tab bar, the level-4 limit, back up, delete / merge
  if (plain) {
    await t.open(plain);
    const shotDir = argOf('shots');
    const shot = async (name) => { if (!shotDir) return; const r = await t.ev(`(() => { const b = document.getElementById('flow-tabs').getBoundingClientRect(); return { x: 0, y: Math.max(0, b.top - 8), width: Math.max(b.right + 16, 200), height: b.height + 16 }; })()`);
      const { data } = await t.send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } }); writeFileSync(join(shotDir, `tabs-${name}.png`), Buffer.from(data, 'base64')); };
    const chips = () => t.ev(`[...document.querySelectorAll('.flow-tab')].map((b) => b.dataset.tab)`);
    const active = () => t.ev(`document.querySelector('.flow-tab[aria-selected="true"]').dataset.tab`);
    const boxes = () => t.ev(`document.querySelectorAll('.flow-subtabs').length`);
    const addSub = async () => { await t.ev(`document.getElementById('btn-add-subprocess').click()`); await sleep(300); };
    const openLast = async () => { const k = (await chips()).pop(); await t.clickOn(`.flow-tab[data-tab="${k}"]`); await sleep(300); return k; };
    await shot('1-level');
    await addSub();
    t.check('level 1: the main flow and its child in an inner box', J(await tabs()) === J(['Main flow*', 'Subprocess']) && (await boxes()) === 1);
    const l2 = await openLast();
    await addSub();
    t.check('level 2: path boxes, the child of the current flow innermost', (await boxes()) === 2 && (await chips()).length === 3 && (await active()) === l2);
    await shot('2-levels');
    const l3 = await openLast();
    await addSub();
    const l4 = await openLast();
    t.check('level 4: four boxes, no inner box for children', (await boxes()) === 3 && J(await chips()) === J(['', l2, l3, l4]) && (await active()) === l4, J(await chips()));
    await shot('4-levels');
    const tile = await t.ev(`(() => { const b = document.getElementById('btn-add-subprocess'); return { off: b.disabled, title: b.title }; })()`);
    t.check('level 4: the Subprocess tile is disabled with a reason', tile.off && /deepest level is 4/.test(tile.title), J(tile));
    const n4 = (await nodeIds()).length;
    await t.ev(`document.getElementById('btn-add-subprocess').click()`);
    const tp = await t.at('#btn-add-subprocess');
    await t.dragTo(tp.x, tp.y, 600, 400);
    await sleep(200);
    t.check('level 4: neither a click nor a drag adds a subprocess', (await nodeIds()).length === n4 && (await boxes()) === 3);
    // keyboard: Alt+Up goes to the parent flow with the step selected
    await t.ev(`document.querySelector('.flow-tab[aria-selected="true"]').focus()`);
    await t.press('ArrowUp', { modifiers: 1 });
    await sleep(300);
    t.check('Alt+Up goes to the parent flow, at the step that opened this one', (await active()) === l3
      && await t.ev(`[...document.querySelectorAll('.flow-node.selected')].map((e) => e.dataset.nodeId).join()`) === l4);
    t.check('on level 3 the tile works again', await t.ev(`!document.getElementById('btn-add-subprocess').disabled`));
    // a tab in an outer box goes up to that flow, with the step that leads down selected
    await t.clickOn(`.flow-tab[data-tab=""]`);
    await sleep(300);
    t.check('a tab in an outer box goes up: only the direct child shows, its step selected', J(await chips()) === J(['', l2]) && await t.ev(`[...document.querySelectorAll('.flow-node.selected')].map((e) => e.dataset.nodeId).join()`) === l2, J(await chips()));
    // export of every tab walks the tree (the page offers one SVG per flow)
    const all4 = await download(exportMenu('[data-export="svg-all"]'), '.svg');
    t.check('"every tab" writes one SVG per flow of the four levels', all4.length === 4, all4.map((f) => f[0]).join());
    // delete: a blank subprocess goes at once; one with content asks
    await goTab(l2);
    await goTab(l3);
    await t.clickOn(`.flow-node[data-node-id="${l4}"] .node-label`);
    await t.press('Delete');
    await sleep(200);
    t.check('a blank subprocess is deleted without a question', !(await t.ev(`!!document.querySelector('.confirm')`)) && !(await nodeIds()).includes(l4) && (await boxes()) === 2, J(await chips()));
    await t.ev(`document.getElementById('btn-undo').click()`);
    await sleep(300);
    // give the level-4 flow content so the delete asks
    await goTab(l4);
    await t.clickOn('.flow-node[data-node-id]:not(.type-start):not(.type-end) .node-label', { count: 2 });
    await t.type('Checked');
    await t.press('Enter');
    await sleep(200);
    await goTab(l3);
    await t.clickOn(`.flow-node[data-node-id="${l4}"] .node-label`);
    await t.press('Delete');
    await sleep(200);
    t.check('a subprocess with content asks: Merge, Delete everything, Cancel', await t.ev(`[...document.querySelectorAll('.confirm button')].map((b) => b.textContent).join('|')`) === 'Cancel|Merge into parent|Delete everything');
    await t.press('Escape');
    t.check('Escape cancels and changes nothing', !(await t.ev(`!!document.querySelector('.confirm')`)) && (await nodeIds()).includes(l4));
    await t.clickOn(`.flow-node[data-node-id="${l4}"] .node-label`);
    await t.press('Delete');
    await t.clickOn('.confirm .confirm-alt');
    await sleep(300);
    t.check('Merge puts the child steps into the parent and removes the step and its tab', !(await nodeIds()).includes(l4) && (await t.ev(`[...document.querySelectorAll('.flow-node .node-label')].some((e) => e.textContent.trim() === 'Checked')`)) && (await boxes()) === 2, J(await chips()));
    await t.ev(`document.getElementById('btn-undo').click()`);
    await sleep(300);
    t.check('Merge is one undo step', (await chips()).length === 4, J(await tabs()));
    // the tab menu: right-click on a subprocess tab, none on the main flow tab
    const press = async (sel, button) => { const p = await t.at(sel); await t.mouse('mousePressed', p.x, p.y, { button, buttons: button === 'right' ? 2 : 1, clickCount: 1 }); await t.mouse('mouseReleased', p.x, p.y, { button, buttons: 0, clickCount: 1 }); await sleep(150); };
    await press(`.flow-tab[data-tab=""]`, 'right');
    t.check('the main flow tab has no menu', !(await t.ev(`!!document.querySelector('.tab-menu')`)));
    await press(`.flow-tab[data-tab="${l3}"]`, 'right');
    t.check('a subprocess tab has a menu with Delete', await t.ev(`[...document.querySelectorAll('.tab-menu button')].map((b) => b.textContent).join()`) === 'Delete');
    await t.press('Escape');
    t.check('Escape closes the menu and the tab keeps focus', !(await t.ev(`!!document.querySelector('.tab-menu')`)) && await t.ev(`document.activeElement.dataset.tab`) === l3);
    await t.press('F10', { modifiers: 8 });
    t.check('Shift+F10 opens it from the keyboard', await t.ev(`!!document.querySelector('.tab-menu')`));
    t.check('the menu item has focus', await t.ev(`document.activeElement.getAttribute('role') === 'menuitem'`));
    await t.ev(`document.activeElement.click()`);   // raw key events carry no text, so Enter would not click a button here
    await sleep(300);
    t.check('Delete from the menu goes to the parent flow and asks', (await active()) === l2 && await t.ev(`!!document.querySelector('.confirm .confirm-alt')`), `${await active()} ${l2} ${await t.ev(`!!document.querySelector('.confirm')`)} ${J(await chips())}`);
    await t.clickOn('.confirm .confirm-ok');
    await sleep(300);
    t.check('Delete everything removes the flow and everything below it', J(await chips()) === J(['', l2]) && (await t.ev(`document.querySelectorAll('.flow-node.type-subprocess').length`)) === 0, J(await chips()));
    await t.ev(`document.getElementById('btn-undo').click()`);
    await sleep(300);
    t.check('and is one undo step: the subtree is back', (await download(exportMenu('[data-export="svg-all"]'), '.svg')).length === 4);
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
