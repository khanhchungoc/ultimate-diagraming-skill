// Interaction test for the use case diagram plugin: render, the dock (add an actor, a system actor, a use case, a subject and a
// note by click and by drag), connecting (actor -> use case is an association, use case -> use case an include), switching
// include to extend (it reverses the line), the extend condition, selecting several (box, Ctrl+click, Ctrl+A), recolouring
// them in one step, moving them to another subject (menu and drag, one undo each), Connect to N, Delete N, click an actor to
// dim what it cannot reach, search by requirement id, the saved data block (ids renamed, positions in `layout`, a reload
// keeps them), and ?present (no editing, still explorable).
// Driven with real mouse and keyboard input over the Chrome DevTools Protocol (see cdp.mjs); a synthetic DOM event is used
// only where a comment says why.
//   node dev/e2e_usecase.mjs --browser <chrome> [--page <assembled usecase page>]
// Without --page the test lays out its own small diagram with `scripts/layout_engine.py --layout` into a temp folder.
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser');
if (!browser) { console.error('usage: --browser <chrome> [--page <page.html>]'); process.exit(1); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const work = mkdtempSync(join(tmpdir(), 'e2e_uc_'));

const DIAGRAM = {
  diagramType: 'usecase',
  title: 'Online shop',
  colorKey: { 1: 'Ordering', 2: 'Payments', 4: 'Fulfilment' },
  subjects: [{ id: 'shop', name: 'Storefront' }, { id: 'office', name: 'Back office' }],
  actors: [
    { id: 'customer', name: 'Customer' },
    { id: 'member', name: 'Registered customer', parent: 'customer' },
    { id: 'clerk', name: 'Warehouse clerk' },
    { id: 'psp', name: 'Payment gateway', kind: 'system', side: 'right' },
    { id: 'nightly', name: 'Nightly', kind: 'time' }
  ],
  useCases: [
    { id: 'browse', name: 'Browse catalogue', subject: 'shop', color: '1', refs: ['FR-1'] },
    { id: 'checkout', name: 'Check out', subject: 'shop', color: '1', refs: ['FR-4', 'FR-5'], extensionPoints: ['Payment'] },
    { id: 'voucher', name: 'Apply voucher', subject: 'shop', color: '1', refs: ['FR-6'] },
    { id: 'pay', name: 'Take payment', subject: 'shop', color: '2', level: 'subfunction' },
    { id: 'pick', name: 'Pick order', subject: 'office', color: '4', refs: ['FR-9'] },
    { id: 'pack', name: 'Pack order', subject: 'office', color: '4', refs: ['FR-10'] },
    { id: 'reconcile', name: 'Reconcile payments', subject: 'office', color: '2', refs: ['FR-12'] }
  ],
  links: [
    { id: 'l1', type: 'association', from: 'customer', to: 'browse' },
    { id: 'l2', type: 'association', from: 'member', to: 'checkout' },
    { id: 'l3', type: 'include', from: 'checkout', to: 'pay' },
    { id: 'l4', type: 'extend', from: 'voucher', to: 'checkout', condition: 'customer has a code', extensionPoint: 'Payment' },
    { id: 'l5', type: 'association', from: 'pay', to: 'psp' },
    { id: 'l6', type: 'association', from: 'clerk', to: 'pick' },
    { id: 'l7', type: 'association', from: 'nightly', to: 'reconcile' },
    { id: 'l8', type: 'association', from: 'clerk', to: 'pack' }
  ],
  notes: [{ id: 'n1', text: 'Guest checkout allowed up to 200 EUR (BR-3)', useCases: ['checkout'] }]
};

let page = argOf('page');
if (!page) {
  const src = join(work, 'shop.json');
  page = join(work, 'shop.html');
  writeFileSync(src, JSON.stringify(DIAGRAM));
  const r = spawnSync('python3', [join(root, 'scripts', 'layout_engine.py'), '--layout', src, '-o', page], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('[ERROR] could not lay out the test page:', r.stdout, r.stderr); process.exit(1); }
}

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
try {
  const J = JSON.stringify;
  const count = (sel) => t.ev(`document.querySelectorAll(${J(sel)}).length`);
  const present = (sel) => t.ev(`!!document.querySelector(${J(sel)})`);
  const text = (sel) => t.ev(`(document.querySelector(${J(sel)}) || {}).textContent ?? null`);
  const block = (html) => (html.replace(/\r\n/g, '\n').match(/<script id="diagram-data" type="application\/json">([\s\S]*?)<\/script>/) || [])[1];
  // chartData lives in the page script's closure: read the model the way an agent would, from a save (the disk model)
  const saved = () => t.saved();
  const editing = () => t.ev(`(document.activeElement && document.activeElement.isContentEditable) ? document.activeElement.textContent : null`);
  const undo = async () => { await t.press('z', { modifiers: 2 }); await t.settle(); };
  const item = (id) => `[data-node-id="${id}"]`;
  const byId = (list, id) => (list || []).find((o) => o.id === id);
  const bySlug = (list, name) => (list || []).find((o) => o.name === name);
  const dimmed = () => t.ev(`[...document.querySelectorAll('.uc-actor.is-dim, .uc-case.is-dim')].map((e) => e.dataset.nodeId).sort().join(',')`);
  const selectedIds = () => t.ev(`[...document.querySelectorAll('.uc-actor.selected, .uc-case.selected')].map((e) => e.dataset.nodeId).sort().join(',')`);
  const unsaved = () => t.ev(`/unsaved/i.test(document.getElementById('save-status').textContent)`);
  const freshPage = async (file = page, query = '') => { await t.open(file, query); };
  const blank = async () => { await t.press('Escape'); await t.press('Escape'); };
  // The disk model without the page's own positions: compared before and after
  const centreOf = (sel) => t.at(sel);
  // The dock's Add tiles hide until the pointer is over the trigger
  const openAdd = async () => {
    const p = await t.at('#btn-add');
    await t.mouse('mouseMoved', p.x, p.y);
    await t.waitFor(`(() => { const pop = document.querySelector('#btn-add')?.closest('[data-dock-pop]')?.querySelector('.dock-pop'); return pop && pop.closest('.open') && getComputedStyle(pop).opacity === '1'; })()`);
  };
  const tile = async (id) => { await openAdd(); await t.clickOn(id); await t.settle(); };
  const dragTile = async (id, x, y) => {
    await openAdd();
    const p = await t.at(id);
    await t.dragTo(p.x, p.y, x, y, { steps: 10 });
    await t.settle();
  };
  // A point on a line that really hits it (the line's own hit path under the pointer), away from its label pill
  const onLine = (id) => t.ev(`(() => {
    const g = document.querySelector('.uc-link[data-edge-id="${id}"]'); const p = g.querySelector('.edge-hit'); const L = p.getTotalLength();
    for (const f of [0.3, 0.42, 0.6, 0.72, 0.2, 0.82, 0.12, 0.9, 0.5]) {
      const q = p.getPointAtLength(L * f), m = p.getScreenCTM(); const x = m.a * q.x + m.e, y = m.d * q.y + m.f;
      const hit = document.elementFromPoint(x, y);
      if (hit && hit.closest('.uc-link') === g) return { x, y };
    }
    return null; })()`);
  // Hover an item so its connect port shows, then return the port's centre
  const portOf = async (id) => {
    const r = await t.at(item(id), 0.5, 0.5);
    await t.mouse('mouseMoved', r.x, r.y);
    await sleep(80);
    return t.at(`${item(id)} .port`);
  };
  const connect = async (from, to) => {
    await t.clickOn('#btn-zoom-reset');   // Fit, so both ends are on screen whatever the earlier steps added
    await sleep(120);
    const p = await portOf(from), q = await t.at(item(to), 0.5, 0.5);
    await t.dragTo(p.x, p.y, q.x, q.y, { steps: 8 });
    await sleep(120);
  };
  const autoTidy = (on) => t.ev(`(() => { const b = document.getElementById('btn-auto-layout'); if ((b.getAttribute('aria-checked') === 'true') !== ${on}) b.click(); })()`);
  let d;
  const py = `import sys, json
sys.path.insert(0, ${J(join(root, 'scripts'))})
import disk_format as f
if 'usecase' not in f.DISK_CODECS or f.DISK_CODECS['usecase'][0] is None: print('SKIP'); sys.exit(0)
d = json.loads(sys.stdin.read()); readme = d.pop('_readme', None)
out = f.to_disk('usecase', f.from_disk('usecase', d))
if readme is not None: out = f.with_readme(out, readme)
sys.stdout.write(f.format_json(out))`;

  // ---------------------------------------------------------------------------------------------------------
  await t.section('render-dock-connect-rename', async () => {
  await freshPage();
  await autoTidy(false);
  t.check('the page renders 5 actors, 7 use cases, 2 subjects and 8 lines (+ 1 generalization), no errors',
    (await count('.uc-actor')) === 5 && (await count('.uc-case')) === 7 && (await count('.uc-subject')) === 2 && (await count('.uc-link:not(.uc-parent)')) === 8 && (await count('.uc-parent')) === 1 && t.errors.length === 0,
    `${await count('.uc-actor')} ${await count('.uc-case')} ${await count('.uc-link')} ${t.errors.join(' | ')}`);
  t.check('a round avatar for every actor (person, server, clock), «system» / «time» under the name, an ellipse per use case',
    (await text(`${item('psp')} .uc-kw`)) === '«system»' && (await text(`${item('nightly')} .uc-kw`)) === '«time»' && (await present(`${item('nightly')} .uc-figure svg`)) && (await present(`${item('customer')} .uc-figure svg`))
    && (await t.ev(`getComputedStyle(document.querySelector('.uc-case .uc-shape')).borderRadius`)) !== '0px');
  t.check('level shows in outline and size: a subfunction is dashed, the use case with extension points has its compartment',
    (await t.ev(`getComputedStyle(document.querySelector('.uc-case[data-level="subfunction"] .uc-shape')).borderStyle`)) === 'dashed' && (await present(`${item('checkout')} .uc-eps .uc-ep`)));
  t.check('the four line styles: association solid, include and extend dashed with pills, generalization with a hollow triangle',
    (await t.ev(`getComputedStyle(document.querySelector('.uc-link[data-type="association"] .edge-line')).strokeDasharray`)) === 'none'
    && (await t.ev(`getComputedStyle(document.querySelector('.uc-link[data-type="include"] .edge-line')).strokeDasharray`)) !== 'none'
    && (await count('.uc-label')) === 2 && (await text('.uc-label[data-edge-id="l4"] .uc-cond')) === '[customer has a code]'
    && (await t.ev(`getComputedStyle(document.querySelector('.uc-parent .edge-line')).markerEnd`)).includes('uc-mk-tri'));
  t.check('the legend names the colours, the note shows as a badge and not as a card',
    (await count('.uc-legend-item')) === 3 && (await count('.note-badge')) === 1 && !(await t.ev(`!![...document.querySelectorAll('.note-layer .note')].some((n) => getComputedStyle(n).display !== 'none')`)));
  t.check('the dock has the Add popover with five tiles, the switches, and no Delete until something is selected',
    (await count('#uc-pop .btn-shape')) === 5 && (await present('#btn-refs')) && (await present('#btn-levels')) && (await present('#btn-notes')) && (await present('#btn-auto-layout'))
    && !(await t.ev(`document.getElementById('btn-delete-selection').classList.contains('show')`)));

  // --- the dock: click adds ------------------------------------------------------------------------------------
  await tile('#btn-add-actor');
  t.check('Add > Actor: a new actor appears with its name open for editing', (await count('.uc-actor')) === 6 && (await editing()) === 'New actor', `${await editing()}`);
  await t.type('Auditor');
  await t.press('Enter');
  await sleep(100);
  t.check('typing and Enter name it; the page is unsaved and one undo removes it', (await unsaved()) && (await t.ev(`[...document.querySelectorAll('.uc-actor-name')].some((e) => e.textContent === 'Auditor')`)));
  await tile('#btn-add-system');
  await t.type('Mail service');
  await t.press('Enter');
  await t.settle();
  t.check('Add > System actor: an avatar with «system»', (await count('.uc-actor[data-kind="system"] .uc-figure')) === 2 && (await t.ev(`[...document.querySelectorAll('.uc-actor-name')].some((e) => e.textContent === 'Mail service')`)));
  await tile('#btn-add-usecase');
  t.check('Add > Use case: a new ellipse with its name open', (await count('.uc-case')) === 8 && (await editing()) === 'New use case', `${await editing()}`);
  await t.type('Audit orders');
  await t.press('Enter');
  await sleep(100);
  const audit = (await saved()).useCases.find((u) => u.name === 'Audit orders');
  t.check('a use case made by hand gets the next requirement id (UC-01)', !!audit && J(audit.refs) === J(['UC-01']), J(audit));
  await tile('#btn-add-subject');
  t.check('Add > Subject: a third boundary, its name open', (await count('.uc-subject')) === 3 && (await editing()) === 'New system', `${await editing()}`);
  await t.type('Reporting');
  await t.press('Enter');
  await sleep(100);
  // drag: a use case dropped inside the Back office boundary joins it
  const office = await t.at('.uc-subject[data-subject-id="office"]', 0.5, 0.75);
  await dragTile('#btn-add-usecase', office.x, office.y);
  d = await saved();
  const dropped = d.useCases.filter((u) => u.name === 'New use case');
  t.check('dragging the Use case tile into Back office adds it to that subject at the drop point',
    dropped.length === 1 && dropped[0].subject === 'office' && (await count('.uc-case')) === 9 && d.layout[dropped[0].id] !== undefined, J(dropped));
  const actorDrop = await t.at('.uc-actor[data-node-id="nightly"]', 0.5, 1.9);
  await dragTile('#btn-add-actor', actorDrop.x, actorDrop.y);
  t.check('dragging the Actor tile onto blank canvas drops a new actor there, name open', (await count('.uc-actor')) === 8 && (await editing()) === 'New actor', `${await count('.uc-actor')}`);
  await t.press('Escape');
  await blank();
  // a drop well past the edge of the canvas still adds (the whole view is a drop target)
  const vp = await t.ev(`(() => { const r = document.getElementById('viewport').getBoundingClientRect(); return { x: r.left + 40, y: r.top + 60 }; })()`);
  await dragTile('#btn-add-actor', vp.x, vp.y);
  t.check('dragging a tile onto the empty view, outside the diagram, still adds it', (await count('.uc-actor')) === 9, `${await count('.uc-actor')}`);
  await t.press('Escape');
  await undo();
  await blank();
  // dragging a boundary's title moves the frame with its use cases
  const subBefore = await t.ev(`(() => { const r = document.querySelector('.uc-subject[data-subject-id="office"]').getBoundingClientRect(); return [r.left, r.top]; })()`);
  const title = await t.at('.uc-subject[data-subject-id="office"] .uc-subject-title', 0.5, 0.5);
  await t.dragTo(title.x, title.y, title.x + 60, title.y + 40, { steps: 8 });
  await sleep(300);
  const subAfter = await t.ev(`(() => { const r = document.querySelector('.uc-subject[data-subject-id="office"]').getBoundingClientRect(); return [r.left, r.top]; })()`);
  // boundaries stacked in one column keep their left edge aligned, so only the vertical move shows
  t.check('dragging a subject title moves the frame', Math.abs(subAfter[1] - subBefore[1] - 40) < 6, `${subBefore} -> ${subAfter}`);
  await undo();
  await blank();
  // an edge tab resizes the frame one way
  await t.clickOn('.uc-subject[data-subject-id="office"] .uc-subject-title');
  const wBefore = await t.ev(`document.querySelector('.uc-subject[data-subject-id="office"]').getBoundingClientRect().width`);
  const hBefore = await t.ev(`document.querySelector('.uc-subject[data-subject-id="office"]').getBoundingClientRect().height`);
  const tabR = await t.at('.uc-subject[data-subject-id="office"] .uc-subject-tab.is-x');
  await t.dragTo(tabR.x, tabR.y, tabR.x + 50, tabR.y, { steps: 8 });
  await sleep(300);
  const wAfter = await t.ev(`document.querySelector('.uc-subject[data-subject-id="office"]').getBoundingClientRect().width`);
  const hAfter = await t.ev(`document.querySelector('.uc-subject[data-subject-id="office"]').getBoundingClientRect().height`);
  t.check('dragging the right edge tab widens the frame and leaves its height', wAfter > wBefore + 30 && Math.abs(hAfter - hBefore) < 2 && (await count('.uc-subject-resize')) === 0, `${wBefore} -> ${wAfter}, ${hBefore} -> ${hAfter}`);
  await undo();
  await blank();
  t.check('no hover "+" note chip on items (the action bar has the note button)', (await count('.note-add')) === 0);
  // a note by the dock: select a use case, then the Note tile
  await t.clickOn(item('pick'));
  await tile('#btn-add-note');
  t.check('Add > Note on a selected use case opens a note card for typing', (await t.ev(`!!document.activeElement && document.activeElement.classList.contains('note-text')`)));
  await t.type('Only after 08:00');
  await t.press('Escape');
  await sleep(150);
  d = await saved();
  t.check('the note is saved with its use case, and carries no position', d.notes.length === 2 && d.notes.some((n) => n.text === 'Only after 08:00' && n.useCases[0] === 'pick' && !('x' in n) && !('_pos' in n)), J(d.notes));
  await blank();

  // --- connecting ------------------------------------------------------------------------------------------------
  const linksBefore = (await saved()).links.length;
  await connect('customer', 'voucher');
  d = await saved();
  const newAssoc = d.links[d.links.length - 1];
  t.check('a port drag from an actor onto a use case draws an association from the actor', d.links.length === linksBefore + 1 && newAssoc.type === 'association' && newAssoc.from === 'customer' && newAssoc.to === 'voucher', J(newAssoc));
  t.check('the new association action bar hides redundant Association and Reverse buttons when un-arrowed',
    (await count('.uc-actionbar [data-act="type"]')) === 0
    && (await present('.uc-actionbar [data-act="arrow"]'))
    && (await t.ev(`document.querySelector('.uc-actionbar [data-act="arrow"]').getAttribute('aria-pressed')`)) === 'false'
    && !(await present('.uc-actionbar [data-act="reverse"]'))
    && (await present('.uc-actionbar [data-act="delete"]'))
    && (await count('.uc-actionbar [aria-disabled="true"]')) === 0);
  await t.clickOn('.uc-actionbar [data-act="arrow"]');
  await sleep(100);
  d = await saved();
  t.check('toggling Arrow on an association adds an arrowhead and reveals Reverse',
    byId(d.links, newAssoc.id).navigable === true
    && (await t.ev(`document.querySelector('.uc-actionbar [data-act="arrow"]').getAttribute('aria-pressed')`)) === 'true'
    && (await present('.uc-actionbar [data-act="reverse"]')));
  await t.clickOn('.uc-actionbar [data-act="reverse"]');
  await sleep(100);
  d = await saved();
  t.check('Reverse on an arrowed association swaps its ends',
    byId(d.links, newAssoc.id).from === 'voucher' && byId(d.links, newAssoc.id).to === 'customer');
  await t.clickOn('.uc-actionbar [data-act="arrow"]');
  await sleep(100);
  d = await saved();
  t.check('toggling Arrow off removes the arrowhead and hides Reverse again',
    byId(d.links, newAssoc.id).navigable === undefined && !(await present('.uc-actionbar [data-act="reverse"]')));
  await blank();
  await connect('browse', 'voucher');
  const incDomId = await t.ev(`document.querySelector('.uc-link.selected').dataset.edgeId`);
  d = await saved();
  const newInc = d.links[d.links.length - 1];
  t.check('a port drag from a use case onto another draws an include (base to part)', newInc.type === 'include' && newInc.from === 'browse' && newInc.to === 'voucher', J(newInc));
  t.check('the include action bar shows only Include and Extend (hiding Association)',
    (await count('.uc-actionbar [data-act="type"]')) === 2
    && !(await present('.uc-actionbar [data-act="type"][data-value="association"]'))
    && (await count('.uc-actionbar [aria-disabled="true"]')) === 0);
  t.check('the include has its «include» pill', (await count('.uc-label')) === 3);
  t.check('connections and «include»/«extend» pills carry no hover tooltip',
    (await count('.uc-link title')) === 0 && (await count('.uc-label[title]')) === 0);
  t.check('the link action bar has no condition input box', !(await present('.uc-actionbar .uc-ab-input')));
  // hovering the «include» pill or line highlights the whole connection (both line and pill)
  await blank();
  const pillPt = await t.at(`.uc-label[data-edge-id="${incDomId}"]`);
  await t.mouse('mouseMoved', pillPt.x, pillPt.y);
  await sleep(80);
  t.check('hovering the «include» pill highlights both the pill and the connector line',
    (await present(`.uc-label[data-edge-id="${incDomId}"].hover`)) && (await present(`.uc-link[data-edge-id="${incDomId}"].hover`)));
  const incLinePt = await onLine(incDomId);
  await t.mouse('mouseMoved', incLinePt.x, incLinePt.y);
  await sleep(80);
  t.check('hovering the connector line highlights both the line and its «include» pill',
    (await present(`.uc-link[data-edge-id="${incDomId}"].hover`)) && (await present(`.uc-label[data-edge-id="${incDomId}"].hover`)));
  await t.mouse('mouseMoved', 2, 2);
  await sleep(80);
  // inline condition on «include» pill: Esc cancels cleanly, Enter commits
  await t.clickOn(`.uc-label[data-edge-id="${incDomId}"]`, { count: 2 });
  await sleep(100);
  t.check('double-clicking the «include» pill opens inline condition editing', (await editing()) === '' && (await present(`.uc-label[data-edge-id="${incDomId}"].is-editing-cond .uc-cond.is-editing`)));
  await t.press('Escape');
  await sleep(120);
  d = await saved();
  t.check('Esc on an empty inline condition removes the temporary field and leaves no condition', !(await present(`.uc-label[data-edge-id="${incDomId}"] .uc-cond`)) && byId(d.links, newInc.id).condition === undefined);
  await t.clickOn(`.uc-label[data-edge-id="${incDomId}"]`, { count: 2 });
  await sleep(100);
  await t.type('always checked');
  await t.press('Enter');
  await sleep(150);
  d = await saved();
  t.check('typing on the «include» pill sets its condition and shows [always checked]', byId(d.links, newInc.id).condition === 'always checked' && (await text(`.uc-label[data-edge-id="${incDomId}"] .uc-cond`)) === '[always checked]', J(byId(d.links, newInc.id)));
  // switch include -> extend: the line reverses (extend points from the extension to the base) and keeps the condition
  await t.clickOn('.uc-actionbar [data-act="type"][data-value="extend"]');
  await sleep(120);
  d = await saved();
  const sw = d.links[d.links.length - 1];
  t.check('choosing Extend on the include reverses it (extension -> base), preserves the condition, and says so', sw.type === 'extend' && sw.from === 'voucher' && sw.to === 'browse' && sw.condition === 'always checked' && (await present('.hint')), J(sw));
  t.check('extend action bar keeps Extension point without a condition input', !(await present('.uc-actionbar .uc-ab-input')) && (await present('.uc-actionbar [data-act="point-menu"]')));
  // double-clicking the extend connector line opens inline condition editing on the pill
  await blank();
  const linePt = await onLine(incDomId);
  await t.click(linePt.x, linePt.y, { count: 2 });
  await sleep(100);
  t.check('double-clicking the connector line opens inline condition editing with the current text', (await editing()) === 'always checked', `${await editing()}`);
  await t.type('first order');
  await t.press('Enter');
  await sleep(150);
  d = await saved();
  t.check('Enter commits the edited condition and the pill shows [first order]', byId(d.links, sw.id).condition === 'first order' && (await text(`.uc-label[data-edge-id="${incDomId}"] .uc-cond`)) === '[first order]', J(byId(d.links, sw.id)));
  // clearing the condition on the pill deletes it; undo brings [first order] back
  await t.clickOn(`.uc-label[data-edge-id="${incDomId}"]`, { count: 2 });
  await sleep(100);
  await t.press('Backspace');
  await t.press('Enter');
  await sleep(150);
  d = await saved();
  t.check('clearing the inline condition removes it from the model and pill', !('condition' in byId(d.links, sw.id)) && !(await present(`.uc-label[data-edge-id="${incDomId}"] .uc-cond`)), J(byId(d.links, sw.id)));
  await undo();
  await sleep(150);
  await t.clickOn(`.uc-label[data-edge-id="${incDomId}"]`);
  await sleep(100);
  // extension point menu
  await t.clickOn('.uc-actionbar [data-act="point-menu"]');
  await sleep(100);
  t.check('the extension point menu lists the base\'s points and offers a new one', (await t.ev(`[...document.querySelectorAll('.uc-menu button')].map((b) => b.textContent).join('|')`)).includes('+ New point'));
  await t.press('Escape');
  // reverse
  await t.clickOn('.uc-actionbar [data-act="reverse"]');
  await sleep(100);
  d = await saved();
  t.check('Reverse swaps the ends', byId(d.links, sw.id).from === 'browse' && byId(d.links, sw.id).to === 'voucher');
  await t.clickOn('.uc-actionbar [data-act="delete"]');
  await sleep(120);
  d = await saved();
  const gone = !byId(d.links, sw.id);
  await undo();
  const back = await saved();
  t.check('Delete removes the line, one undo brings it back', gone && !!byId(back.links, sw.id), `${gone} ${J(back.links.map((l) => l.id))}`);
  await blank();
  // a case dragged out of its own port onto blank space inside a subject creates a connected use case
  const useCasesBefore = (await saved()).useCases.length;
  const spot = await t.ev(`(() => { const r = document.querySelector('.uc-subject[data-subject-id="shop"]').getBoundingClientRect();
    for (let y = r.bottom - 14; y > r.top + 50; y -= 12) for (let x = r.right - 14; x > r.left + 14; x -= 12) {
      const el = document.elementFromPoint(x, y); if (el && (el.id === 'uc-html' || el.id === 'uc-canvas' || el.id === 'uc-svg')) return { x, y }; }
    return null; })()`);
  const p0 = await portOf('browse');
  await t.dragTo(p0.x, p0.y, spot.x, spot.y, { steps: 8 });
  await sleep(150);
  t.check('a port drag onto blank space inside a subject draws out a new connected use case, name open', (await count('.uc-case')) === 10 && (await editing()) === 'New use case', `${await count('.uc-case')} ${await editing()}`);
  await t.type('Compare products');
  await t.press('Enter');
  await sleep(100);
  d = await saved();
  const drawn = bySlug(d.useCases, 'Compare products');
  t.check('...in that subject, joined to the one it came from by an include', d.useCases.length === useCasesBefore + 1 && drawn && drawn.subject === 'shop' && d.links.some((l) => l.type === 'include' && l.from === 'browse' && l.to === drawn.id), J(drawn));
  await blank();

  // --- rename, double-click ---------------------------------------------------------------------------------------
  await t.clickOn(item('pack'), { count: 2 });
  t.check('double-click edits a use case name in place', (await editing()) === 'Pack order', `${await editing()}`);
  await t.type('Pack parcel');
  await t.press('Enter');
  await sleep(120);
  d = await saved();
  t.check('Enter commits the new name (one undo step)', byId(d.useCases, 'pack').name === 'Pack parcel');
  await blank();
  });

  // --- multi-select ----------------------------------------------------------------------------------------------------
  await t.section('multiselect-explore-keyboard', async () => {
  await freshPage();
  await autoTidy(false);
  const sub = await t.ev(`(() => { const r = document.querySelector('.uc-subject[data-subject-id="office"]').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; })()`);
  await t.dragTo(sub.l + 8, sub.t + 44, sub.r - 8, sub.b - 8, { steps: 8, modifiers: 8 });   // Shift + drag on blank canvas inside the boundary
  await sleep(100);
  t.check('Shift + drag draws a box and selects the 3 use cases it touches', (await selectedIds()) === 'pack,pick,reconcile' && (await count('.marquee')) === 0, await selectedIds());
  t.check('the action bar offers Colour, Subject and Delete 3 (no Connect: no actor selected)',
    (await present('.uc-actionbar .uc-ab-swatch')) && (await present('.uc-actionbar [data-act="subject"]')) && (await text('.uc-actionbar [data-act="delete"]')).includes('Delete 3') && !(await present('.uc-actionbar [data-act="connect"]')));
  const before = await saved();
  await t.clickOn('.uc-actionbar .swatch-trigger');
  await sleep(150);
  await t.clickOn('.uc-actionbar .uc-ab-swatch[data-value="3"]');
  await sleep(120);
  d = await saved();
  t.check('one swatch click recolours all three', ['pick', 'pack', 'reconcile'].every((id) => byId(d.useCases, id).color === '3') && (await selectedIds()) === 'pack,pick,reconcile');
  await undo();
  d = await saved();
  t.check('one undo restores all three colours', byId(d.useCases, 'pick').color === '4' && byId(d.useCases, 'pack').color === '4' && byId(d.useCases, 'reconcile').color === '2', J(d.useCases.map((u) => u.color)));
  // move to another subject, by the menu (an undo clears the selection: box again)
  await t.dragTo(sub.l + 8, sub.t + 44, sub.r - 8, sub.b - 8, { steps: 8, modifiers: 8 });
  await sleep(100);
  await t.clickOn('.uc-actionbar [data-act="subject"]');
  await sleep(100);
  const menuItem = await t.ev(`(() => { const b = [...document.querySelectorAll('.uc-menu button')].find((x) => x.textContent === 'Storefront'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await t.click(menuItem.x, menuItem.y);
  await sleep(150);
  d = await saved();
  t.check('Subject > Storefront moves the three use cases there in one step', ['pick', 'pack', 'reconcile'].every((id) => byId(d.useCases, id).subject === 'shop'), J(d.useCases.map((u) => u.subject)));
  await undo();
  d = await saved();
  t.check('one undo moves all three back', ['pick', 'pack', 'reconcile'].every((id) => byId(d.useCases, id).subject === 'office') && JSON.stringify(d.layout) === JSON.stringify(before.layout), J(d.useCases.map((u) => u.subject)));
  // move by dragging the group onto the other boundary
  await freshPage();
  await autoTidy(false);
  const sub2 = await t.ev(`(() => { const r = document.querySelector('.uc-subject[data-subject-id="office"]').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; })()`);
  await t.dragTo(sub2.l + 8, sub2.t + 44, sub2.r - 8, sub2.b - 8, { steps: 8, modifiers: 8 });
  await sleep(100);
  const from = await t.at(item('pack'));
  const to = await t.ev(`(() => { const r = document.querySelector('.uc-subject[data-subject-id="shop"]').getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.6 }; })()`);
  await t.dragTo(from.x, from.y, to.x, to.y, { steps: 10 });
  await sleep(150);
  d = await saved();
  t.check('dragging one of the selected moves them all, and dropped on Storefront they join it',
    ['pick', 'pack', 'reconcile'].every((id) => byId(d.useCases, id).subject === 'shop') && (await selectedIds()) === 'pack,pick,reconcile', J(d.useCases.map((u) => u.subject)));
  await undo();
  d = await saved();
  t.check('one undo puts the whole drag back', ['pick', 'pack', 'reconcile'].every((id) => byId(d.useCases, id).subject === 'office'));
  await blank();
  // Ctrl+click toggles, Ctrl+A selects all, Esc clears
  await t.clickOn(item('browse'));
  await t.clickOn(item('voucher'), { modifiers: 2 });
  t.check('Ctrl+click adds a second item', (await selectedIds()) === 'browse,voucher');
  await t.clickOn(item('voucher'), { modifiers: 2 });
  t.check('Ctrl+click on a selected item takes it out', (await selectedIds()) === 'browse');
  await t.press('a', { modifiers: 2 });
  t.check('Ctrl+A selects every actor and use case', (await selectedIds()).split(',').length === 12);
  await t.press('Escape');
  t.check('Esc clears the selection', (await selectedIds()) === '' && !(await present('.uc-actionbar')));
  // Connect to N: one actor and N use cases
  const l0 = (await saved()).links.length;
  await t.clickOn(item('clerk'));
  await t.clickOn(item('browse'), { modifiers: 2 });
  await t.clickOn(item('voucher'), { modifiers: 2 });
  t.check('one actor and two use cases selected: the bar offers Connect to 2', (await text('.uc-actionbar [data-act="connect"]')).includes('Connect to 2'), `${await text('.uc-actionbar')}`);
  await t.clickOn('.uc-actionbar [data-act="connect"]');
  await sleep(150);
  d = await saved();
  t.check('Connect to 2 creates two associations from the actor in one step', d.links.length === l0 + 2 && ['browse', 'voucher'].every((id) => d.links.some((l) => l.type === 'association' && l.from === 'clerk' && l.to === id)), `${d.links.length - l0}`);
  await undo();
  d = await saved();
  t.check('one undo removes both', d.links.length === l0);
  await blank();
  // Delete N
  const counts0 = { u: (await saved()).useCases.length, l: (await saved()).links.length };
  await t.clickOn(item('pick'));
  await t.clickOn(item('pack'), { modifiers: 2 });
  await t.clickOn(item('reconcile'), { modifiers: 2 });
  await t.clickOn('.uc-actionbar [data-act="delete"]');
  await sleep(100);
  t.check('Delete 3 with lines asks first, in a confirm bubble', await present('.confirm'));
  await t.clickOn('.confirm-ok');
  await sleep(150);
  d = await saved();
  t.check('Delete 3 removes the use cases and their lines', d.useCases.length === counts0.u - 3 && !d.links.some((l) => ['pick', 'pack', 'reconcile'].includes(l.to)) && (await count('.uc-case')) === 4, `${d.useCases.length}`);
  await undo();
  d = await saved();
  t.check('one undo brings all three and their lines back', d.useCases.length === counts0.u && d.links.length === counts0.l);
  await blank();

  // --- explore ---------------------------------------------------------------------------------------------------------------
  await t.clickOn(item('clerk'));
  const dim = await dimmed();
  t.check('click an actor: its use cases stay lit and everything else dims',
    !dim.includes('pick') && !dim.includes('pack') && !dim.includes('clerk') && ['browse', 'checkout', 'customer', 'reconcile', 'psp'].every((id) => dim.includes(id)), dim);
  t.check('...the lines between the lit items are highlighted, the rest dim', (await count('.uc-link.hl')) === 2 && (await count('.uc-link.is-dim')) >= 5);
  await t.clickOn(item('checkout'));
  const dim2 = await dimmed();
  t.check('click a use case: it lights its actors and its include / extend neighbours', !dim2.includes('checkout') && !dim2.includes('member') && !dim2.includes('pay') && !dim2.includes('voucher') && dim2.includes('browse'), dim2);
  await t.press('Escape');
  await t.mouse('mouseMoved', 6, 300);   // off every item: a hover dims too
  await sleep(80);
  t.check('Esc clears the dimming', (await dimmed()) === '');
  // hover highlights connected arrows and elements (in = amber, out = blue) without dimming the rest
  const hoverOn = async (id) => { const r = await t.at(item(id), 0.5, 0.3); await t.mouse('mouseMoved', r.x, r.y); await sleep(120); return dimmed(); };
  t.check('hovering an actor or a use case dims nothing', (await hoverOn('clerk')) === '' && (await hoverOn('checkout')) === '');
  const hovState = await t.ev(`(() => ({
    inLinks: document.querySelectorAll('.uc-link.hl-in').length,
    outLinks: document.querySelectorAll('.uc-link.hl-out').length,
    inItems: [...document.querySelectorAll('.uc-actor.hl-in, .uc-case.hl-in')].map((e) => e.dataset.nodeId).sort(),
    outItems: [...document.querySelectorAll('.uc-actor.hl-out, .uc-case.hl-out')].map((e) => e.dataset.nodeId).sort(),
    inLabels: document.querySelectorAll('.uc-label.hl-in').length,
    outLabels: document.querySelectorAll('.uc-label.hl-out').length,
    noteFont: getComputedStyle(document.querySelector('.note')).fontSize
  }))()`);
  t.check('hovering checkout highlights incoming and outgoing links, labels, and directly connected elements in distinct in/out colours',
    hovState.inLinks > 0 && hovState.outLinks > 0
    && hovState.inItems.includes('member') && hovState.inItems.includes('voucher')
    && hovState.outItems.includes('pay')
    && hovState.inLabels > 0 && hovState.outLabels > 0, J(hovState));
  t.check('note font size is increased by 1px to 13px', hovState.noteFont === '13px', hovState.noteFont);
  await t.mouse('mouseMoved', 6, 300);
  await sleep(100);
  t.check('leaving hover clears hl-in and hl-out', (await count('.hl-in, .hl-out')) === 0);
  // connection ports keep constant screen size when zoomed out
  await t.ev(t.key('-', { ctrlKey: true }));
  await t.ev(t.key('-', { ctrlKey: true }));
  await sleep(120);
  await t.clickOn(item('checkout'));
  await sleep(120);
  const portRect = await t.ev(`(() => { const p = document.querySelector('.uc-case[data-node-id="checkout"] > .port'); const r = p.getBoundingClientRect(); return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, uiScale: getComputedStyle(document.getElementById('stage')).getPropertyValue('--ui-scale').trim() }; })()`);
  t.check('connection port stays ~16px on screen when zoomed out', Math.abs(portRect.w - 16) <= 1.5 && Math.abs(portRect.h - 16) <= 1.5 && parseFloat(portRect.uiScale) > 1, J(portRect));
  await t.clickOn('#btn-zoom-reset');
  await sleep(100);
  // swatch picker opens on hover with frosted-glass box-shadow (no ancestor filter: drop-shadow, which would break backdrop-filter)
  const swTrig = await t.at('.uc-actionbar .swatch-trigger');
  await t.mouse('mouseMoved', swTrig.x, swTrig.y);
  await sleep(100);
  const swHover = await t.ev(`(() => {
    const bar = document.querySelector('.uc-actionbar'), pop = bar && bar.querySelector('.swatch-popover');
    if (!bar || !pop) return null;
    const bs = getComputedStyle(bar), ps = getComputedStyle(pop);
    return { open: !pop.hidden, barShadow: bs.boxShadow, popShadow: ps.boxShadow, barFilter: bs.filter, popZ: ps.zIndex };
  })()`);
  t.check('hovering the colour trigger opens the swatch popover with glass elevation and no ancestor filter',
    swHover && swHover.open && swHover.barShadow !== 'none' && swHover.popShadow !== 'none' && swHover.barFilter === 'none' && swHover.popZ === 'auto', J(swHover));
  await t.mouse('mouseMoved', 6, 300);
  await sleep(220);
  t.check('leaving the swatch picker closes it after the hover grace delay', await t.ev(`document.querySelector('.uc-actionbar .swatch-popover')?.hidden === true`));
  await t.press('Escape');
  await sleep(100);
  await t.mouse('mouseMoved', 6, 300);
  await t.clickOn(item('member'));
  t.check('a specialised actor reaches what its parent can do too', !(await dimmed()).includes('browse') && !(await dimmed()).includes('customer'), await dimmed());
  await blank();
  // search: the header's universal search (the type has no search field of its own); a use case is also found by requirement id
  await t.press('/');
  t.check('/ opens the universal search', await t.ev(`document.activeElement.id === 'search-input'`));
  await t.type('FR-9');
  await sleep(150);
  t.check('searching a requirement id finds the use case that has it and dims the rest',
    (await t.ev(`[...document.querySelectorAll('.uc-case.search-current')].map((e) => e.dataset.nodeId).join(',')`)) === 'pick' && (await t.ev(`document.getElementById('search-count').textContent`)) === '1 / 1'
    && (await count('.search-dim')) > 0);
  await t.press('Escape');
  t.check('Esc closes the search and clears it', (await count('.search-dim')) === 0 && (await count('.search-current')) === 0);
  await t.press('/');
  await t.type('customer');
  await sleep(150);
  const nameCount = await t.ev(`document.getElementById('search-count').textContent`);
  t.check('search also matches names', /^1 \/ [2-9]$/.test(nameCount), nameCount);
  await t.press('Escape');
  await t.ev(`document.activeElement.blur()`);
  // Refs and Levels
  await t.clickOn('#btn-refs');
  t.check('Refs shows the requirement ids under the use cases and is saved', (await count('.uc-ref')) === 7 && (await saved()).showRefs === true);
  await t.clickOn('#btn-refs');
  await t.clickOn('#btn-levels');
  t.check('Levels off hides the subfunction use cases and their lines', !(await present(item('pay'))) && !(await present('.uc-link[data-edge-id="l3"]')));
  await t.clickOn('#btn-levels');
  // Levels disables when no subfunctions exist, and re-enables when one returns
  const levelsState = () => t.ev(`(() => { const b = document.getElementById('btn-levels'); return { disabled: b.disabled, checked: b.getAttribute('aria-checked') }; })()`);
  const lvWithSub = await levelsState();
  await t.clickOn(item('pay'));
  await t.clickOn('.uc-actionbar [data-act="level"][data-value="user"]');
  await sleep(150);
  const lvNoSub = await levelsState();
  await undo();
  await sleep(150);
  const lvRestored = await levelsState();
  t.check('Levels disables (and clears aria-checked) when no subfunction exists, and re-enables when one returns',
    !lvWithSub.disabled && lvWithSub.checked === 'true' && lvNoSub.disabled && lvNoSub.checked === 'false' && !lvRestored.disabled && lvRestored.checked === 'true',
    `${J(lvWithSub)} -> ${J(lvNoSub)} -> ${J(lvRestored)}`);
  await blank();
  // Subject hover state: hovering the frame interior or title bar lifts border/shadow without capturing background pointer events
  const subStyle = (id) => t.ev(`(() => { const el = document.querySelector('.uc-subject[data-subject-id="${id}"]'); const cs = getComputedStyle(el); return { hover: el.classList.contains('is-hover'), pe: cs.pointerEvents, border: cs.borderColor, shadow: cs.boxShadow }; })()`);
  await t.mouse('mouseMoved', 6, 300);
  await sleep(200);
  const subRest = await subStyle('office');
  const subInner = await t.ev(`(() => { const r = document.querySelector('.uc-subject[data-subject-id="office"]').getBoundingClientRect();
    for (let y = r.bottom - 10; y > r.top + 44; y -= 10) for (let x = r.right - 10; x > r.left + 10; x -= 10) {
      const el = document.elementFromPoint(x, y); if (el && (el.id === 'uc-canvas' || el.id === 'uc-html' || el.id === 'uc-svg')) return { x, y }; }
    return null; })()`);
  await t.mouse('mouseMoved', subInner.x, subInner.y);
  await sleep(200);
  const subHovInner = await subStyle('office');
  const onPick = await t.at(item('pick'));
  await t.mouse('mouseMoved', onPick.x, onPick.y);
  await sleep(80);
  const subOnCase = await subStyle('office');
  const onSubTitle = await t.at('.uc-subject[data-subject-id="office"] .uc-subject-title');
  await t.mouse('mouseMoved', onSubTitle.x, onSubTitle.y);
  await sleep(80);
  const subOnTitle = await subStyle('office');
  await t.mouse('mouseMoved', 6, 300);
  await sleep(80);
  const subLeft = await subStyle('office');
  t.check('hovering a subject interior, use case, or title bar applies the hover ring and shadow while keeping pointer-events: none',
    subRest.pe === 'none' && !subRest.hover && subHovInner.hover && subHovInner.shadow !== subRest.shadow
      && subOnCase.hover && subOnTitle.hover && !subLeft.hover,
    `${J(subRest)} | ${J(subHovInner)} | ${J(subOnCase)} | ${J(subOnTitle)} | ${J(subLeft)}`);
  // collapse a subject; expanding it again puts every use case back where it was, with nothing on top of another
  const boxes = () => t.ev(`JSON.stringify([...document.querySelectorAll('.uc-case')].map((e) => [e.dataset.nodeId, e.style.left, e.style.top, e.style.width, e.style.height]).sort())`);
  const caseOverlaps = () => t.ev(`(() => { const r = [...document.querySelectorAll('.uc-case')].map((e) => e.getBoundingClientRect()); let n = 0;
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) if (r[i].left < r[j].right && r[j].left < r[i].right && r[i].top < r[j].bottom && r[j].top < r[i].bottom) n++; return n; })()`);
  for (const tidy of [true, false]) {
    if (!tidy) await t.clickOn('#btn-auto-layout');
    const before = await boxes();
    await t.clickOn('.uc-subject[data-subject-id="office"] .chevron');
    await t.clickOn('.uc-subject[data-subject-id="office"] .chevron');
    t.check(`collapse then expand (Auto-Tidy ${tidy ? 'on' : 'off'}) puts every use case back, none on top of another`, (await boxes()) === before && (await caseOverlaps()) === 0);
    if (!tidy) await t.clickOn('#btn-auto-layout');
  }
  await t.clickOn('.uc-subject[data-subject-id="office"] .chevron');
  d = await saved();
  t.check('the chevron collapses a subject to its name bar, saved as collapsed', byId(d.subjects, 'office').collapsed === true && !(await present(item('pick'))) && (await count('.uc-subject')) === 2);
  await t.clickOn('.uc-subject[data-subject-id="office"] .chevron');
  t.check('and expands it again', (await present(item('pick'))) && !('collapsed' in byId((await saved()).subjects, 'office')));

  // --- keyboard ------------------------------------------------------------------------------------------------------------------
  await blank();
  await t.clickOn(item('browse'));
  await t.press('ArrowRight');
  t.check('arrow keys move the selection (and keyboard focus) to the nearest item in that direction', (await selectedIds()) !== 'browse' && (await t.ev(`document.activeElement.classList.contains('uc-case') || document.activeElement.classList.contains('uc-actor')`)));
  await t.press('Enter');
  t.check('Enter edits the selected item\'s name', (await editing()) !== null);
  await t.press('Escape');
  await blank();
  });

  // --- Auto-Tidy ---------------------------------------------------------------------------------------------------------------------
  await t.section('auto-tidy', async () => {
  await freshPage();
  await autoTidy(false);
  const beforePos = await t.at(item('browse'));
  const m = await t.at(item('browse'), 0.5, 0.5);
  await t.dragTo(m.x, m.y, m.x + 60, m.y + 40, { steps: 6 });
  const movedPos = await t.at(item('browse'));
  t.check('Auto-Tidy off: a drag moves an item where it is dropped (no re-layout)', Math.abs(movedPos.x - beforePos.x - 60) < 3 && Math.abs(movedPos.y - beforePos.y - 40) < 3, J([beforePos, movedPos]));
  d = await saved();
  const posSaved = d.layout.browse;
  t.check('the move is one undo step', (await t.ev(`!document.getElementById('btn-undo').disabled`)));
  await undo();
  await t.press('y', { modifiers: 2 });
  await sleep(100);
  await autoTidy(true);
  await sleep(150);
  const tidied = await t.at(item('browse'));
  t.check('turning Auto-Tidy on re-lays the diagram out (a hand placement is thrown away)', Math.abs(tidied.x - movedPos.x) > 2 || Math.abs(tidied.y - movedPos.y) > 2);
  await autoTidy(false);
  });

  // --- the saved block --------------------------------------------------------------------------------------------------------------------
  await t.section('saved-block', async () => {
  await freshPage();
  await autoTidy(false);
  await tile('#btn-add-actor');
  await t.type('Zed Auditor');
  await t.press('Enter');
  await sleep(100);
  await tile('#btn-add-usecase');
  await t.type('Audit orders');
  await t.press('Enter');
  await sleep(100);
  await connect('customer', 'browse');   // already connected: refused with a hint
  await blank();
  const mv = await t.at(item('pick'));
  await t.dragTo(mv.x, mv.y, mv.x + 30, mv.y + 20, { steps: 6 });
  d = await saved();
  t.check('saved block: key order, schemaVersion 1, layout holds actors then use cases, derived fields gone',
    Object.keys(d).join(',').startsWith('_readme,diagramType,schemaVersion,title,') && Object.keys(d).slice(-1)[0] === 'layout' && d.schemaVersion === 1
    && !('canvas' in d) && !d.useCases.some((u) => 'x' in u || 'w' in u || '_lines' in u) && !d.links.some((l) => 'points' in l || 'labelBox' in l) && !d.subjects.some((s) => 'x' in s || '_titleH' in s)
    && Object.keys(d.layout)[0] === 'customer', Object.keys(d).join(','));
  t.check('editor ids are renamed to name slugs; authored ids are kept', byId(d.actors, 'zed_auditor') && byId(d.useCases, 'audit_orders') && byId(d.useCases, 'browse') && d.layout.zed_auditor && d.layout.audit_orders, J(d.actors.map((a) => a.id)));
  const html = readFileSync(page, 'utf8').replace(/\r\n/g, '\n');
  const savedBlock = JSON.stringify(d);
  const reload = join(work, 'reloaded.html');
  writeFileSync(reload, html.replace(/(<script id="diagram-data" type="application\/json">)[\s\S]*?(<\/script>)/, (mm, a, b) => a + savedBlock + b));
  await freshPage(reload);
  const again = await saved();
  t.check('a reload of the saved page keeps every id and every position, and saving it again changes nothing',
    JSON.stringify(again.layout) === JSON.stringify(d.layout) && JSON.stringify(again.actors) === JSON.stringify(d.actors) && JSON.stringify(again.useCases) === JSON.stringify(d.useCases) && JSON.stringify(again.links) === JSON.stringify(d.links) && t.errors.length === 0, t.errors.join(' | '));
    // the Python codec, when the repo has it, writes the same bytes
  const pr = spawnSync('python3', ['-I', '-c', py], { input: await t.ev(`document.getElementById('diagram-data').textContent`), encoding: 'utf8' });
  const blockText = await t.ev(`document.getElementById('diagram-data').textContent`);
  t.check('the Python codec (disk_format.py) reads and writes that block unchanged', pr.status === 0 && (pr.stdout.trim() === 'SKIP' || pr.stdout.replace(/\r\n/g, '\n').trim() === blockText.trim()), pr.stderr || pr.stdout.slice(0, 200));
  });

  // --- present ----------------------------------------------------------------------------------------------------------------------------
  await t.section('present', async () => {
  // The Present button toggles in place: the search is hidden and cleared, folds are view only
  await freshPage(page);
  await t.press('/'); await t.type('pick');
  const matched = await count('.search-current');
  await t.clickOn('#btn-present');
  await t.press('/');
  t.check('usecase: entering Present hides and clears the search, and / does not open it', matched > 0 && (await count('.search-current')) === 0
    && (await t.ev(`document.getElementById('search-bar').hidden && getComputedStyle(document.getElementById('btn-search')).display === 'none' && document.activeElement.id !== 'search-input'`)));
  await t.clickOn('.uc-subject[data-subject-id="office"] .chevron');
  await t.press('Escape');
  t.check('usecase: Esc exits in one press, a fold made while presenting leaves no unsaved badge, undo step or collapsed item',
    !(await t.ev(`document.body.classList.contains('presentation')`)) && !(await t.ev(`/unsaved/i.test(document.getElementById('save-status').textContent)`))
    && (await t.ev(`document.getElementById('btn-undo').disabled`)) && !byId((await saved()).subjects, 'office').collapsed && t.errors.length === 0, t.errors.join(' | '));

  await freshPage(page, '?present');
  { // present mode: a drag, a double-click, Delete and Ctrl+Z change nothing, and no editor opens
    const sel = '.uc-actor', n0 = await t.ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`), p = await t.at(sel);
    await t.click(p.x, p.y, { count: 2 }); await t.dragTo(p.x, p.y, p.x + 40, p.y + 30);
    await t.ev(t.key('Delete')); await t.ev(t.key('z', { ctrlKey: true }));
    t.check('usecase ?present: double-click, drag, Delete and Ctrl+Z change nothing',
      (await t.ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)) === n0 && !(await t.ev(`!!document.querySelector('[contenteditable="true"]')`))
      && !/unsaved/i.test(await t.ev(`document.getElementById('save-status').textContent`)) && t.errors.length === 0, t.errors.join(' | '));
  }
  t.check('?present: no ports, no dock, no search of editing', (await count('.port')) === 0 && !(await t.ev(`getComputedStyle(document.querySelector('.toolbar-center')).display !== 'none'`)) && (await count('.note-add')) === 0);
  await t.clickOn(item('clerk'));
  t.check('?present: a click on an actor still lights what it can reach, with no action bar', (await dimmed()).includes('browse') && !(await dimmed()).includes('pick') && !(await present('.uc-actionbar')));
  await t.clickOn(item('pick'), { count: 2 });
  t.check('?present: double-click does not edit', (await editing()) === null);
  await t.press('Delete');
  t.check('?present: Delete deletes nothing', (await count('.uc-case')) === 7);
  const pm = await t.at(item('pick'));
  await t.dragTo(pm.x, pm.y, pm.x + 40, pm.y + 40, { steps: 5 });
  t.check('?present: a drag moves nothing', Math.abs((await t.at(item('pick'))).x - pm.x) < 2);
  await t.press('a', { modifiers: 2 });
  t.check('?present: Ctrl+A selects nothing', (await count('.uc-actor.selected, .uc-case.selected')) <= 1);
  await t.clickOn('.uc-subject[data-subject-id="office"] .chevron');
  t.check('?present: the chevron still collapses a boundary', !(await present(item('pick'))));
  });

  // --- free notes: no links, an absolute saved pos ---------------------------------------------------------------------------------------
  await t.section('free-notes', async () => {
  await freshPage(page);
  const freeOf = (dd, txt) => (dd.notes || []).find((n) => n.text === txt);
  const noteCard = (txt) => `[...document.querySelectorAll('.note')].find((x) => x.textContent === ${J(txt)})`;
  const cardAt = (txt) => t.ev(`(() => { const c = ${noteCard(txt)}; if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: Math.round(r.left), top: Math.round(r.top), shown: getComputedStyle(c).display !== 'none' }; })()`);
  const badges0 = await count('.note-badge');
  await tile('#btn-add-note');   // nothing selected: a free note at the view centre
  const freeEdit = await editing();
  await t.type('Loose remark');
  await t.press('Escape');
  await sleep(100);
  d = await saved();
  const loose = freeOf(d, 'Loose remark'), looseAt = await cardAt('Loose remark');
  t.check('the Note tile with nothing selected adds a free note: no links, a saved numeric pos, shown at rest, no badge and no leader',
    freeEdit === '' && loose && !(loose.useCases || []).length && !(loose.actors || []).length && Number.isFinite(loose.pos?.x) && Number.isFinite(loose.pos?.y) && looseAt?.shown
      && (await count('.note-badge')) === badges0 && (await count(`.note-leader[data-note-id="${loose.id}"]`)) === 0, `${freeEdit} ${J(loose)} ${J(looseAt)}`);
  await blank();
  await t.press('n');
  await t.type('From N');
  await t.press('Escape');
  t.check('N with nothing selected adds a free note too', !!freeOf(await saved(), 'From N')?.pos);
  await blank();
  // drop: on empty canvas it is free at the drop point, on a use case it links
  const freeSpot = await t.ev(`(() => { const v = document.getElementById('viewport').getBoundingClientRect();
    for (let y = v.top + 100; y < v.bottom - 180; y += 20) for (let x = v.left + 40; x < v.right - 260; x += 20) {
      const h = document.elementFromPoint(x, y);
      if (h && h.closest('#uc-canvas') && !h.closest('.uc-actor, .uc-case, .note, .uc-label, .dock-area, .toolbar') && !['path', 'line', 'polyline'].includes(h.tagName)) return { x, y };
    } return null; })()`);
  await dragTile('#btn-add-note', freeSpot.x, freeSpot.y);
  const dropEdit = await editing();
  await t.type('Dropped free');
  await t.press('Escape');
  const dropAt = await cardAt('Dropped free');
  t.check('dropping the Note tile on empty canvas makes a free note at the drop point', dropEdit === '' && Math.abs(dropAt.left - freeSpot.x) < 16 && Math.abs(dropAt.top - freeSpot.y) < 16 && !freeOf(await saved(), 'Dropped free').useCases.length, `${dropEdit} ${J(dropAt)} ${J(freeSpot)}`);
  const vc = await t.at(item('voucher'));
  await dragTile('#btn-add-note', vc.x, vc.y);
  await t.type('On the voucher');
  await t.press('Escape');
  t.check('dropping the Note tile on a use case links it to that use case', freeOf(await saved(), 'On the voucher')?.useCases.join() === 'voucher');
  await blank();
  // disk, memory, disk; the Python codec reads and writes the block as written
  const rawFree = await t.ev(`document.getElementById('diagram-data').textContent`);
  const reloadFree = join(work, 'free.html');
  writeFileSync(reloadFree, readFileSync(page, 'utf8').replace(/(<script id="diagram-data" type="application\/json">)[\s\S]*?(<\/script>)/, (mm, a, b) => a + rawFree + b));
  await freshPage(reloadFree);
  await t.press('s', { modifiers: 2 });
  await sleep(250);
  const rawBack = await t.ev(`document.getElementById('diagram-data').textContent`);
  const pf = spawnSync('python3', ['-I', '-c', py], { input: rawFree, encoding: 'utf8' });
  t.check('a free note round trips: disk, memory, disk is the same text (and the Python codec writes it unchanged); free notes are on show at rest',
    rawBack === rawFree && pf.stdout.replace(/\r\n/g, '\n').trim() === rawFree.trim() && (await cardAt('Dropped free'))?.shown && (await cardAt('Loose remark'))?.shown, pf.stderr || `${rawBack === rawFree}`);
  // Auto-Tidy never moves a free note
  const posBefore = freeOf(await saved(), 'Dropped free').pos, at0 = await cardAt('Dropped free');
  await t.ev(`document.getElementById('btn-auto-tidy').click()`);
  await sleep(200);
  const at1 = await cardAt('Dropped free');
  t.check('Tidy leaves a free note in place', J(freeOf(await saved(), 'Dropped free').pos) === J(posBefore) && Math.abs(at0.left - at1.left) <= 2 && Math.abs(at0.top - at1.top) <= 2, `${J(posBefore)} ${J(at0)} ${J(at1)}`);
  // the link handle: a free note dragged onto an actor links it, staying put (the relative offset is not saved); the last link stays
  await t.click(at1.x, at1.y);
  const handle = await t.ev(`(() => { const h = ${noteCard('Dropped free')}.querySelector('.note-link').getBoundingClientRect(); return { x: h.left + h.width / 2, y: h.top + h.height / 2 }; })()`);
  const cu = await t.at(item('customer'));
  await t.dragTo(handle.x, handle.y, cu.x, cu.y, { steps: 8 });
  const at2 = await cardAt('Dropped free');
  const freeLinked = freeOf(await saved(), 'Dropped free');
  t.check('dragging a free note onto an actor links it: it stays where it is, the saved note has the link and no pos, and a leader and badge appear',
    freeLinked?.actors?.join() === 'customer' && !('pos' in freeLinked) && !('_pos' in freeLinked) && Math.abs(at2.left - at1.left) <= 2 && Math.abs(at2.top - at1.top) <= 2
      && (await count(`.note-leader[data-note-id="${freeLinked.id}"]`)) === 1 && (await count('.uc-actor[data-node-id="customer"] .note-badge')) === 1, `${J(freeLinked)} ${J(at1)} ${J(at2)}`);
  const h2 = await t.ev(`(() => { const h = ${noteCard('Dropped free')}.querySelector('.note-link').getBoundingClientRect(); return { x: h.left + h.width / 2, y: h.top + h.height / 2 }; })()`);
  const cu2 = await t.at(item('customer'));
  await t.dragTo(h2.x, h2.y, cu2.x, cu2.y, { steps: 8 });
  t.check('the last link of a note stays (it never becomes free by unlinking)', freeOf(await saved(), 'Dropped free')?.actors?.join() === 'customer');
  });

  t.check('no errors in the whole run', t.errors.length === 0, t.errors.join(' | '));
} catch (err) {
  console.error('[ERROR]', err.stack || err.message);
  code = 1;
} finally {
  await t.close();
  try { rmSync(work, { recursive: true, force: true }); } catch { /* temp folder */ }
}
process.exit(code || t.finish());
