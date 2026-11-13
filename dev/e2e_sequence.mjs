// Interaction test for the sequence plugin (selection, reorder by drag, add/delete, text edit, frames).
// Driven with real mouse and keyboard input over the Chrome DevTools Protocol (see cdp.mjs): a synthetic DOM
// event may only be used where a comment says why.
//   node dev/e2e_sequence.mjs --browser <chrome> --page <laid-out sequence.html>
// Use dev/fixtures/sequence/checkout-with-fragments.json laid out with `layout_engine.py --layout`.
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { readFileSync } from 'node:fs';
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser'), page = argOf('page');
if (!browser || !page) { console.error('usage: --browser <chrome> --page <html>'); process.exit(1); }

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
try {
  const names = `JSON.stringify([...document.querySelectorAll('.seq-participant-name')].map(e => e.textContent))`;
  const labels = `JSON.stringify([...document.querySelectorAll('.seq-msg-label-text')].map(e => e.textContent))`;
  const count = (sel) => t.ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);

  await t.open(page);
  const p0 = JSON.parse(await t.ev(names)), m0 = JSON.parse(await t.ev(labels));
  t.check('renders participants, messages, frames without errors',
    p0.length === 4 && m0.length === 7 && (await count('.seq-frag-label')) === 2 && t.errors.length === 0, `p=${p0.length} m=${m0.length} ${t.errors.join(' | ')}`);

  // Every click, double-click, drag and key below is real input (Input.dispatchMouseEvent / dispatchKeyEvent):
  // the browser does the hit-testing and makes the click and dblclick events itself.
  const disabled = (id) => t.ev(`document.getElementById(${JSON.stringify(id)}).disabled`);
  const editing = () => t.ev(`(document.activeElement && document.activeElement.isContentEditable) ? document.activeElement.textContent : null`);
  const onScreen = (sel) => t.ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()`);

  // Nothing selected: the buttons that need a selection are disabled and say why
  t.check('Message type and Frame are disabled with nothing selected, and say what to select',
    (await disabled('btn-toggle-kind')) && (await disabled('btn-frame')) && /Select a message/.test(await t.ev(`document.getElementById('btn-frame').title`)));

  // Click selects; Delete removes the message and keeps frames valid
  await t.clickOn(`.seq-msg-label[data-edge-id="m6"]`);
  const selected = await t.ev(`!!document.querySelector('.seq-msg-label.selected')`);
  t.check('selecting a message enables Message type and Frame', !(await disabled('btn-toggle-kind')) && !(await disabled('btn-frame')));
  await t.press('Delete');
  const m1 = JSON.parse(await t.ev(labels));
  t.check('click selects a message and Delete removes it', selected && m1.length === 6 && !m1.includes('Release stock'), JSON.stringify(m1));
  t.check('frame survives its last message being deleted (alt now ends earlier)', (await count('.seq-frag-label')) === 2 && t.errors.length === 0, t.errors.join(' | '));

  // Escape clears the selection; undo and redo keep it while the object exists
  await t.open(page);
  await t.clickOn(`.seq-msg-label[data-edge-id="m2"]`);
  await t.press('Escape');
  t.check('Escape clears the selection', (await count('.seq-msg-label.selected')) === 0);
  await t.clickOn(`.seq-msg-label[data-edge-id="m2"]`);
  await t.clickOn('#btn-toggle-kind');
  await t.press('z', { modifiers: 2 });
  const afterUndo = await t.ev(`document.querySelector('.seq-msg-label.selected')?.dataset.edgeId`);
  await t.press('y', { modifiers: 2 });
  const afterRedo = await t.ev(`document.querySelector('.seq-msg-label.selected')?.dataset.edgeId`);
  t.check('undo and redo keep the selection', afterUndo === 'm2' && afterRedo === 'm2', `${afterUndo} ${afterRedo}`);

  // Drag a participant right over its neighbour: order changes
  await t.open(page);
  const b1 = await t.at('.seq-participant[data-node-id="p2"]'), b2 = await t.at('.seq-participant[data-node-id="p3"]');
  await t.dragTo(b1.x, b1.y, b2.x + 30, b1.y);
  const reordered = JSON.parse(await t.ev(names));
  t.check('dragging a participant sideways reorders the lifelines', reordered.join() === 'Customer,Payment,Shop,Warehouse', reordered.join());

  // Drag a message up past the previous one: time order changes
  await t.open(page);
  const before = JSON.parse(await t.ev(labels));
  const l3 = await t.at('.seq-msg-label[data-edge-id="m3"]'), l2 = await t.at('.seq-msg-label[data-edge-id="m2"]');
  await t.dragTo(l3.x, l3.y, l3.x, l2.y - 20);
  const after = JSON.parse(await t.ev(labels));
  t.check('dragging a message vertically changes its time order', before.indexOf('Stock reserved') > after.indexOf('Stock reserved'), `${before.join('|')} -> ${after.join('|')}`);

  // Double-click renames a message, a participant and a frame
  await t.open(page);
  for (const [what, sel, read] of [
    ['a message', '.seq-msg-label[data-edge-id="m1"]', labels],
    ['a participant', '.seq-participant[data-node-id="p2"]', names],
    ['a frame', '.seq-frag-label[data-frag-id="f2"]', `JSON.stringify([...document.querySelectorAll('.seq-frag-text')].map(e => e.textContent))`],
  ]) {
    await t.clickOn(sel, { count: 2 });
    const inEdit = await editing();
    await t.type(`Renamed ${what}`);
    await t.press('Enter');
    t.check(`double-click renames ${what}`, inEdit !== null && JSON.parse(await t.ev(read)).includes(`Renamed ${what}`) && t.errors.length === 0, `inEdit=${inEdit} ${await t.ev(read)} ${t.errors.join(' | ')}`);
  }
  await t.clickOn('.seq-msg-label[data-edge-id="m3"]', { count: 2 });
  await t.type('Thrown away');
  await t.press('Escape');
  t.check('Escape in an edit keeps the old text', JSON.parse(await t.ev(labels)).includes('Stock reserved') && (await editing()) === null);

  // Create means name: a new participant, message and frame are on screen with their placeholder in edit
  await t.open(page);
  await t.clickOn('#btn-add-participant');
  const newP = await editing();
  await t.type('Ledger');
  await t.press('Enter');
  t.check('a new participant opens in edit, on screen, and takes the typed name',
    /^Participant/.test(newP || '') && JSON.parse(await t.ev(names))[4] === 'Ledger' && (await onScreen('.seq-participant.selected')), `${newP} ${await t.ev(names)}`);
  await t.clickOn('#btn-add-message');
  const newM = await editing();
  await t.type('Post entry');
  await t.press('Enter');
  t.check('a new message opens in edit, on screen, and takes the typed label',
    newM === 'Message' && JSON.parse(await t.ev(labels)).includes('Post entry') && (await onScreen('.seq-msg-label.selected')), `${newM} ${await t.ev(labels)}`);
  await t.clickOn('#btn-frame');
  const newF = await editing();
  await t.type('ledger enabled');
  await t.press('Enter');
  t.check('Frame wraps the selected message and opens its condition in edit',
    newF === 'condition' && (await count('.seq-frag-label')) === 3 && (await t.ev(`document.querySelector('.seq-frag-label.selected .seq-frag-text').textContent`)) === 'ledger enabled' && t.errors.length === 0, `${newF} ${t.errors.join(' | ')}`);

  // Auto-Tidy and save path
  await t.clickOn('#btn-auto-tidy');
  await t.press('s', { modifiers: 2 });
  t.check('Auto-Tidy and Ctrl+S run without errors', t.errors.length === 0, t.errors.join(' | '));

  // Round-trip parity: a generated page saved without edits writes its data block byte-identical (the page's
  // toDisk + formatJson agree with scripts/disk_format.py), and no positions are saved
  await t.open(page);
  const block = (readFileSync(page, 'utf8').replace(/\r\n/g, '\n').match(/<script id="diagram-data" type="application\/json">([\s\S]*?)<\/script>/) || [])[1];
  await t.press('s', { modifiers: 2 });
  await sleep(300);
  const savedBlock = await t.ev(`document.getElementById('diagram-data').textContent`);
  t.check('Save without edits writes the data block byte-identical to the generated page, with no positions',
    savedBlock === block && !/"(x|y|w|h|elseY|layout)":/.test(savedBlock), JSON.stringify(savedBlock.slice(0, 200)));

  // Present mode
  await t.open(page, '?present');
  t.check('?present makes the diagram read-only', await t.ev(`getComputedStyle(document.querySelector('.seq-participant')).pointerEvents === 'none'`));
} catch (err) {
  console.error('[ERROR]', err.message);
  code = 1;
} finally {
  await t.close();
}
process.exit(code || t.finish());
