// Interaction test for the sequence plugin: selection, editing (create, rename, retarget, reorder, frames, branches,
// notes, keyboard), reading a long diagram (pinned row, collapse, ?present), the saved data block and, with
// --artifact, Save inside a claude.ai artifact.
// Driven with real mouse and keyboard input over the Chrome DevTools Protocol (see cdp.mjs): a synthetic DOM
// event may only be used where a comment says why.
//   node dev/e2e_sequence.mjs --browser <chrome> --page <checkout.html> --long <payment.html> [--artifact <html>]
// --page: dev/fixtures/sequence/checkout-with-fragments.json laid out with `layout_engine.py --layout`.
// --long: dev/fixtures/sequence/payment-phases.json laid out the same way (uses every optional field).
// --artifact: the --page fixture laid out with `--target artifact`.
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { readFileSync } from 'node:fs';
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser'), page = argOf('page'), long = argOf('long'), artifact = argOf('artifact');
if (!browser || !page || !long) { console.error('usage: --browser <chrome> --page <html> --long <html> [--artifact <html>]'); process.exit(1); }

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
try {
  const names = `JSON.stringify([...document.querySelectorAll('.seq-participant-name')].map(e => e.textContent))`;
  const labels = `JSON.stringify([...document.querySelectorAll('.seq-msg-label-text')].map(e => e.textContent))`;
  const count = (sel) => t.ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const model = () => t.ev(`JSON.parse(JSON.stringify(chartData))`).catch(() => null);
  // chartData lives in the page script's closure: read the model the way an agent would, from a save
  const block = (html) => (html.replace(/\r\n/g, '\n').match(/<script id="diagram-data" type="application\/json">([\s\S]*?)<\/script>/) || [])[1];
  const saved = async () => {
    await t.press('s', { modifiers: 2 });
    await sleep(300);
    return JSON.parse(await t.ev(`document.getElementById('diagram-data').textContent`));
  };
  const disabled = (id) => t.ev(`document.getElementById(${JSON.stringify(id)}).disabled`);
  const editing = () => t.ev(`(document.activeElement && document.activeElement.isContentEditable) ? document.activeElement.textContent : null`);
  const onScreen = (sel) => t.ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()`);
  const lifelineAt = (pid, y) => t.ev(`(() => { const l = document.querySelector('.seq-lifeline[data-node-id="${pid}"]').getBoundingClientRect();
    return { x: l.left + l.width / 2, y: ${y} }; })()`);
  // Screen y of the gap between two messages (mid-way between their arrows)
  const gapY = (a, b) => t.ev(`(() => { const y = (id) => { const r = document.querySelector('.seq-line[data-edge-id="' + id + '"]').getBoundingClientRect(); return r.top + r.height / 2; };
    return ${b ? `(y('${a}') + y('${b}')) / 2` : `y('${a}') + 30`}; })()`);
  void model;

  await t.open(page);
  const p0 = JSON.parse(await t.ev(names)), m0 = JSON.parse(await t.ev(labels));
  t.check('renders participants, messages, frames without errors',
    p0.length === 4 && m0.length === 7 && (await count('.seq-frag-label')) === 2 && t.errors.length === 0, `p=${p0.length} m=${m0.length} ${t.errors.join(' | ')}`);

  // Every click, double-click, drag and key below is real input (Input.dispatchMouseEvent / dispatchKeyEvent):
  // the browser does the hit-testing and makes the click and dblclick events itself.

  // --- Repair (step 0) ---
  t.check('Message, Frame and Note are disabled with nothing selected, and say what to select',
    (await disabled('btn-add-message')) && (await disabled('btn-frame')) && (await disabled('btn-add-note'))
      && /Select a message/.test(await t.ev(`document.getElementById('btn-frame').title`)) && !(await t.ev(`!!document.getElementById('btn-toggle-kind')`)));
  await t.clickOn(`.seq-msg-label[data-edge-id="m6"]`);
  const selected = await t.ev(`!!document.querySelector('.seq-msg-label.selected')`);
  t.check('selecting a message enables Message, Frame and Note, and shows its action bar',
    !(await disabled('btn-add-message')) && !(await disabled('btn-frame')) && !(await disabled('btn-add-note')) && (await count('.seq-actionbar .seq-ab-btn[data-act="type"]')) === 0
      && (await count('.seq-actionbar .seq-ab-btn[data-act="async"]')) === 1);
  await t.press('Delete');
  const m1 = JSON.parse(await t.ev(labels));
  t.check('click selects a message and Delete removes it', selected && m1.length === 6 && !m1.includes('Release stock'), JSON.stringify(m1));
  t.check('frame survives its last message being deleted (alt now ends earlier)', (await count('.seq-frag-label')) === 2 && t.errors.length === 0, t.errors.join(' | '));

  await t.open(page);
  await t.clickOn(`.seq-msg-label[data-edge-id="m2"]`);
  await t.press('Escape');
  t.check('Escape clears the selection', (await count('.seq-msg-label.selected')) === 0);
  await t.clickOn(`.seq-msg-label[data-edge-id="m2"]`);
  await t.clickOn('.seq-actionbar .seq-ab-btn[data-act="async"]');
  const typed = await t.ev(`document.querySelector('.seq-line[data-edge-id="m2"]').getAttribute('marker-end')`);
  const pressedOn = await t.ev(`document.querySelector('.seq-ab-btn[data-act="async"]').getAttribute('aria-pressed')`);
  await t.press('z', { modifiers: 2 });
  const afterUndo = await t.ev(`document.querySelector('.seq-msg-label.selected')?.dataset.edgeId`);
  await t.press('y', { modifiers: 2 });
  const afterRedo = await t.ev(`document.querySelector('.seq-msg-label.selected')?.dataset.edgeId`);
  await t.clickOn('.seq-actionbar .seq-ab-btn[data-act="async"]');
  const typedBack = await t.ev(`document.querySelector('.seq-line[data-edge-id="m2"]').getAttribute('marker-end')`);
  t.check('"No reply expected" toggles a call to async and back (pressed while on)', /open/.test(typed) && pressedOn === 'true' && /solid/.test(typedBack), `${typed} ${pressedOn} ${typedBack}`);
  await t.clickOn('.seq-msg-label[data-edge-id="m3"]');
  t.check('a reply has no "No reply expected" toggle', (await count('.seq-actionbar .seq-ab-btn[data-act="async"]')) === 0);
  t.check('undo and redo keep the selection', afterUndo === 'm2' && afterRedo === 'm2', `${afterUndo} ${afterRedo}`);

  await t.open(page);
  const b1 = await t.at('.seq-participant[data-node-id="p2"]'), b2 = await t.at('.seq-participant[data-node-id="p3"]');
  await t.dragTo(b1.x, b1.y, b2.x + 30, b1.y);
  const reordered = JSON.parse(await t.ev(names));
  t.check('dragging a participant sideways reorders the lifelines', reordered.join() === 'Customer,Payment,Shop,Warehouse', reordered.join());

  await t.open(page);
  const before = JSON.parse(await t.ev(labels));
  const l3 = await t.at('.seq-msg-label[data-edge-id="m3"]'), l2 = await t.at('.seq-msg-label[data-edge-id="m2"]');
  await t.dragTo(l3.x, l3.y, l3.x, l2.y - 20);
  const after = JSON.parse(await t.ev(labels));
  t.check('dragging a message vertically changes its time order', before.indexOf('Stock reserved') > after.indexOf('Stock reserved'), `${before.join('|')} -> ${after.join('|')}`);

  await t.open(page);
  for (const [what, sel, read] of [
    ['a message', '.seq-msg-label[data-edge-id="m1"]', labels],
    ['a participant', '.seq-participant[data-node-id="p2"]', names],
    ['a frame', '.seq-frag-label[data-frag-id="f2"] .seq-frag-text', `JSON.stringify([...document.querySelectorAll('.seq-frag-text')].map(e => e.textContent))`],
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

  await t.open(page);
  await t.clickOn('#btn-add-participant');
  const newP = await editing();
  await t.type('Ledger');
  await t.press('Enter');
  t.check('a new participant opens in edit, on screen, and takes the typed name',
    /^Participant/.test(newP || '') && JSON.parse(await t.ev(names))[4] === 'Ledger' && (await onScreen('.seq-participant.selected')), `${newP} ${await t.ev(names)}`);
  await t.clickOn('.seq-msg-label[data-edge-id="m7"]');
  await t.clickOn('#btn-add-message');
  const newM = await editing();
  await t.type('Post entry');
  await t.press('Enter');
  t.check('Message inserts after the selected message, in edit and on screen',
    newM === 'Message' && JSON.parse(await t.ev(labels)).at(-1) === 'Post entry' && (await onScreen('.seq-msg-label.selected')), `${newM} ${await t.ev(labels)}`);
  await t.clickOn('#btn-frame');
  const newF = await editing();
  await t.type('ledger enabled');
  await t.press('Enter');
  t.check('Frame wraps the selected message and opens its condition in edit',
    newF === 'condition' && (await count('.seq-frag-label')) === 3 && (await t.ev(`document.querySelector('.seq-frag-label.selected .seq-frag-text').textContent`)) === 'ledger enabled' && t.errors.length === 0, `${newF} ${t.errors.join(' | ')}`);

  // The dock's Message button infers the kind like drawing does: a call, or the reply of an open call
  await t.open(page);
  await t.clickOn('.seq-msg-label[data-edge-id="m1"]');
  await t.clickOn('#btn-add-message');
  await t.press('Enter');
  await t.clickOn('.seq-ab-btn[data-act="reverse"]');
  let dk = await saved();
  const x1 = dk.messages[1];
  await t.clickOn('#btn-add-message');
  await t.press('Enter');
  dk = await saved();
  t.check('Message after a message adds a call; after a call that reopens the other way, the reply of the open call',
    x1.kind === 'sync' && x1.from === 'p2' && x1.to === 'p1' && dk.messages[2].kind === 'reply' && dk.messages[2].label === 'Reply' && dk.messages[2].from === 'p2' && dk.messages[2].to === 'p1',
    JSON.stringify(dk.messages.slice(0, 4)));
  await t.open(page);
  await t.clickOn('.seq-participant[data-node-id="p2"]');
  await t.clickOn('#btn-add-message');
  await t.press('Enter');
  dk = await saved();
  t.check('Message from a selected participant adds a call at the first row', dk.messages[0].kind === 'sync' && dk.messages[0].from === 'p2', JSON.stringify(dk.messages[0]));

  // --- Messages and participants (step 4) ---
  // Drag from the + on a lifeline to another lifeline: a call at the dropped row, label in edit
  await t.open(page);
  const yGap = await gapY('m1', 'm2');
  // From Payment to Shop (Shop's lifeline is under the opt frame's tag at this row)
  const shopA = await lifelineAt('p2', yGap), payA = await lifelineAt('p3', yGap);
  await t.mouse('mouseMoved', payA.x, yGap);
  await sleep(80);
  const plusShown = await t.ev(`getComputedStyle(document.querySelector('.seq-plus')).display === 'flex'`);
  const plus = await t.at('.seq-plus');
  await t.dragTo(plus.x, plus.y, shopA.x + 20, yGap + 4);
  const drawn = await editing();
  await t.type('Check fraud');
  await t.press('Enter');
  let d = await saved();
  t.check('dragging from a lifeline + to another lifeline draws a call at that row, in edit',
    plusShown && drawn === 'Message' && d.messages[1].label === 'Check fraud' && d.messages[1].from === 'p3' && d.messages[1].to === 'p2' && d.messages[1].kind === 'sync',
    `plus=${plusShown} edit=${drawn} ${JSON.stringify(d.messages[1])}`);
  // Released on the same lifeline: a self-message
  const yGap2 = await gapY('m3', 'm4');
  const shopB = await lifelineAt('p2', yGap2);
  await t.mouse('mouseMoved', shopB.x, yGap2);
  await sleep(80);
  const plus2 = await t.at('.seq-plus');
  // Out to the side and back onto the same lifeline (a self-message needs the pointer to leave the lifeline)
  await t.mouse('mousePressed', plus2.x, plus2.y, { button: 'left', buttons: 1, clickCount: 1 });
  for (const [x, y] of [[plus2.x + 30, plus2.y + 10], [plus2.x + 60, plus2.y + 20], [shopB.x + 6, yGap2 + 30]]) {
    await t.mouse('mouseMoved', x, y, { button: 'left', buttons: 1 });
    await sleep(15);
  }
  await t.mouse('mouseReleased', shopB.x + 6, yGap2 + 30, { button: 'left', buttons: 0, clickCount: 1 });
  await sleep(80);
  await t.press('Enter');
  d = await saved();
  const selfMsg = d.messages.find((m) => m.from === 'p2' && m.to === 'p2');
  t.check('dragging from a lifeline + out to the side and back onto the same lifeline makes a self-message', !!selfMsg, JSON.stringify(d.messages.map((m) => m.from + m.to)));
  t.check('ids made in the page are saved as readable ids, references intact',
    d.messages.every((m) => /^m\d+$/.test(m.id)) && new Set(d.messages.map((m) => m.id)).size === d.messages.length
      && d.fragments.every((f) => d.messages.some((m) => m.id === f.from) && d.messages.some((m) => m.id === f.to)), JSON.stringify(d.messages.map((m) => m.id)));

  // Retarget: drag the "to" handle of a selected message to another lifeline
  await t.open(page);
  await t.clickOn('.seq-msg-label[data-edge-id="m1"]');
  const toHandle = await t.at('.seq-handle[data-role="to"]');
  const ware = await lifelineAt('p4', toHandle.y);
  await t.dragTo(toHandle.x, toHandle.y, ware.x, toHandle.y);
  d = await saved();
  t.check('dragging an end handle retargets that end', d.messages[0].to === 'p4' && d.messages[0].from === 'p1', JSON.stringify(d.messages[0]));

  // Reverse and Reply from the action bar
  await t.open(page);
  await t.clickOn('.seq-msg-label[data-edge-id="m4"]');
  await t.clickOn('.seq-ab-btn[data-act="reverse"]');
  d = await saved();
  t.check('Reverse swaps the two ends', d.messages[3].from === 'p3' && d.messages[3].to === 'p2', JSON.stringify(d.messages[3]));
  await t.open(page);
  await t.clickOn('.seq-msg-label[data-edge-id="m1"]');
  await t.clickOn('.seq-ab-btn[data-act="reply"]');
  const replyEdit = await editing();
  await t.press('Enter');
  d = await saved();
  const reply = d.messages.find((m) => m.label === 'Reply');
  t.check('Reply adds the reverse dashed message under the last message of the bar, in edit',
    replyEdit === 'Reply' && reply && reply.from === 'p2' && reply.to === 'p1' && reply.kind === 'reply', JSON.stringify(reply));

  // Insert a participant between two boxes
  await t.open(page);
  const row = await t.at('.seq-participant[data-node-id="p2"]');
  await t.mouse('mouseMoved', row.x + 100, row.y);
  await sleep(80);
  await t.clickOn('.seq-insert[data-index="2"]');
  await t.type('Fraud');
  await t.press('Enter');
  t.check('the + between two participant boxes inserts one there, name in edit', JSON.parse(await t.ev(names)).join() === 'Customer,Shop,Fraud,Payment,Warehouse', await t.ev(names));
  // The participant kind from the action bar
  await t.clickOn('.seq-participant[data-node-id="p3"]');
  await t.clickOn('.seq-ab-btn[data-value="database"]');
  t.check('the action bar sets the participant kind (icon in the box)', (await count('.seq-participant[data-node-id="p3"] .seq-kind-icon')) === 1);

  // Delete a participant with messages: asks first
  await t.open(page);
  await t.clickOn('.seq-participant[data-node-id="p2"]');
  await t.press('Delete');
  const ask = await t.ev(`document.querySelector('.seq-confirm-msg')?.textContent`);
  await t.clickOn('.seq-confirm-cancel');
  const kept = JSON.parse(await t.ev(names)).length;
  await t.clickOn('.seq-participant[data-node-id="p2"]');
  await t.clickOn('#btn-delete-selection');
  await t.clickOn('.seq-confirm-delete');
  t.check('deleting a participant with messages asks first ("Delete Shop and its N messages?")',
    /^Delete Shop and its \d+ messages\?$/.test(ask || '') && kept === 4 && JSON.parse(await t.ev(names)).length === 3, `${ask} kept=${kept}`);

  // Moving a message across frame edges: f2 (opt) covers m2..m3, f1 (alt) m4..m6 with else at m6
  await t.open(page);
  let la = await t.at('.seq-msg-label[data-edge-id="m1"]');
  await t.dragTo(la.x, la.y, la.x, (await gapY('m2', 'm3')) - 26 + 10);
  d = await saved();
  const f2a = d.fragments.find((f) => f.id === 'f2');
  t.check('a message dropped between two messages of a frame joins it', d.messages.map((m) => m.id).join() === 'm2,m1,m3,m4,m5,m6,m7' && f2a.from === 'm2' && f2a.to === 'm3', `${d.messages.map((m) => m.id)} ${JSON.stringify(f2a)}`);
  await t.open(page);
  la = await t.at('.seq-msg-label[data-edge-id="m2"]');
  await t.dragTo(la.x, la.y, la.x, (await t.at('.seq-msg-label[data-edge-id="m1"]')).y - 40);
  d = await saved();
  const f2b = d.fragments.find((f) => f.id === 'f2');
  t.check("moving a frame's first message out leaves the frame's edge on the neighbour", d.messages[0].id === 'm2' && f2b.from === 'm3' && f2b.to === 'm3', JSON.stringify(f2b));
  await t.open(page);
  la = await t.at('.seq-msg-label[data-edge-id="m6"]');
  await t.dragTo(la.x, la.y, la.x, (await gapY('m7')) + 10);
  d = await saved();
  const f1a = d.fragments.find((f) => f.id === 'f1');
  t.check('a branch whose message leaves goes when it would be empty; the frame edge follows', f1a.to === 'm5' && f1a.elseAt === undefined && !f1a.branches, JSON.stringify(f1a));

  // --- Frames and notes (step 5) ---
  // Shift+click a range, then Frame
  await t.open(page);
  await t.clickOn('.seq-msg-label[data-edge-id="m1"]');
  await t.clickOn('.seq-msg-label[data-edge-id="m3"]', { modifiers: 8 });
  const rangeSel = await count('.seq-msg-label.selected');
  await t.clickOn('#btn-frame');
  await t.type('signed in');
  await t.press('Enter');
  d = await saved();
  const nf = d.fragments.find((f) => f.label === 'signed in');
  t.check('Shift+click selects a range and Frame wraps it', rangeSel === 3 && nf && nf.from === 'm1' && nf.to === 'm3' && /^f\d+$/.test(nf.id), `${rangeSel} ${JSON.stringify(nf)}`);
  // A range that cuts a frame cannot be framed
  await t.clickOn('.seq-msg-label[data-edge-id="m3"]');
  await t.clickOn('.seq-msg-label[data-edge-id="m5"]', { modifiers: 8 });
  t.check('Frame is disabled, and says why, when a frame edge cuts through the range',
    (await disabled('btn-frame')) && /cuts through/.test(await t.ev(`document.getElementById('btn-frame').title`)));

  // Drag a frame's bottom edge down one row
  await t.open(page);
  await t.clickOn('.seq-frag-label[data-frag-id="f2"] .seq-frag-kind');
  const bottom = await t.at('.seq-handle[data-role="bottom"]');
  await t.dragTo(bottom.x, bottom.y, bottom.x, await gapY('m4', 'm5'), { steps: 8 });
  d = await saved();
  t.check("a frame edge cannot be dragged to where the frame would cross another (f2 into f1)", d.fragments.find((f) => f.id === 'f2').to === 'm3', JSON.stringify(d.fragments));
  await t.clickOn('.seq-frag-label[data-frag-id="f1"] .seq-frag-kind');
  const bottom1 = await t.at('.seq-handle[data-role="bottom"]');
  await t.dragTo(bottom1.x, bottom1.y, bottom1.x, await gapY('m7'), { steps: 8 });
  d = await saved();
  t.check("dragging a frame's bottom handle down takes in the next message", d.fragments.find((f) => f.id === 'f1').to === 'm7', JSON.stringify(d.fragments));
  await t.open(page);
  await t.clickOn('.seq-frag-label[data-frag-id="f1"] .seq-frag-kind');
  const top = await t.at('.seq-handle[data-role="top"]');
  await t.dragTo(top.x, top.y, top.x, await gapY('m4', 'm5'), { steps: 8 });
  d = await saved();
  const f1b = d.fragments.find((f) => f.id === 'f1');
  t.check("dragging a frame's top handle down drops the first message (the frame never crosses another)",
    f1b.from === 'm5' && d.fragments.find((f) => f.id === 'f2').to === 'm3', JSON.stringify(d.fragments));

  // Kind, colour, + branch, rename, drag and delete a branch
  await t.open(page);
  await t.clickOn('.seq-frag-label[data-frag-id="f2"] .seq-frag-kind');
  await t.clickOn('.seq-ab-btn[data-act="fkind"][data-value="alt"]');
  await t.clickOn('.seq-ab-btn[data-act="color"][data-value="purple"]');
  await t.clickOn('.seq-add-branch');
  const brEdit = await editing();
  await t.type('stock low');
  await t.press('Enter');
  d = await saved();
  let f2c = d.fragments.find((f) => f.id === 'f2');
  t.check('the kind and colour come from the action bar; + branch adds a divider above the last message, condition in edit',
    f2c.kind === 'alt' && f2c.color === 'purple' && brEdit === 'condition' && JSON.stringify(f2c.branches) === '[{"at":"m3","label":"stock low"}]', `${brEdit} ${JSON.stringify(f2c)}`);
  await t.clickOn('.seq-frag-branch-label[data-frag-id="f2"]', { count: 2 });
  await t.type('stock very low');
  await t.press('Enter');
  d = await saved();
  t.check('double-click renames a branch', d.fragments.find((f) => f.id === 'f2').branches[0].label === 'stock very low');
  // f1 (alt m4..m6, else at m6): drag the else divider up one row, then delete it
  const div = await t.at('.seq-div-hit[data-frag-id="f1"]');
  await t.dragTo(div.x + 120, div.y, div.x + 120, await gapY('m4', 'm5'), { steps: 8 });
  d = await saved();
  const f1c = d.fragments.find((f) => f.id === 'f1');
  await t.press('Delete');
  d = await saved();
  t.check('a divider drags between rows, and Delete removes it (the branches merge)', f1c.elseAt === 'm5' && d.fragments.find((f) => f.id === 'f1').elseAt === undefined, JSON.stringify(f1c));
  await t.clickOn('.seq-frag-label[data-frag-id="f2"] .seq-frag-kind');
  await t.clickOn('.seq-ab-btn[data-act="fkind"][data-value="loop"]');
  d = await saved();
  f2c = d.fragments.find((f) => f.id === 'f2');
  t.check('changing a frame away from alt removes its branches', f2c.kind === 'loop' && !f2c.branches && f2c.elseAt === undefined, JSON.stringify(f2c));

  // Notes: add, edit (Shift+Enter breaks a line), move, stretch
  await t.open(page);
  await t.clickOn('.seq-msg-label[data-edge-id="m2"]');
  await t.clickOn('#btn-add-note');
  const noteEdit = await editing();
  await t.type('Held for 15 min');
  await t.press('Enter', { modifiers: 8 });
  await t.type('then released');
  await t.press('Enter');
  d = await saved();
  const n1 = d.notes && d.notes[0];
  t.check('Note adds a note under the selected message over its sender, text in edit (Shift+Enter breaks a line)',
    noteEdit === 'Note' && n1 && n1.over === 'p2' && n1.after === 'm2' && n1.text === 'Held for 15 min\nthen released' && n1.id === 'n1', JSON.stringify(d.notes));
  const nb = await t.at('.seq-note');
  const target = await lifelineAt('p3', 0);
  await t.dragTo(nb.x, nb.y, nb.x + (target.x - (await lifelineAt('p2', 0)).x), (await gapY('m4', 'm5')), { steps: 8 });
  d = await saved();
  t.check('dragging a note moves it to another row gap and lifeline', d.notes[0].over === 'p3' && d.notes[0].before === 'm5' && d.notes[0].after === undefined, JSON.stringify(d.notes[0]));
  await t.clickOn('.seq-note');
  const st = await t.at('.seq-handle[data-role="stretch"]');
  const wh = await lifelineAt('p4', st.y);
  await t.dragTo(st.x, st.y, wh.x, st.y);
  d = await saved();
  t.check("the note's stretch handle spans it over a second lifeline", JSON.stringify(d.notes[0].over) === '["p3","p4"]', JSON.stringify(d.notes[0]));

  // Draw from a lifeline or an activation bar: a drag to another lifeline adds a message from that row gap. Drawn back
  // to a caller whose call is still open, it is the call's reply; otherwise a call. A click selects the participant.
  await t.open(page);
  const barAt = (pid, y) => t.ev(`(() => { const r = [...document.querySelectorAll('.seq-activation[data-node-id="${pid}"]')]
    .map((b) => b.getBoundingClientRect()).find((b) => b.top <= ${y} && ${y} <= b.bottom); return r ? { x: r.left + r.width / 2, y: ${y} } : null; })()`);
  const gy = await gapY('m2', 'm3');
  const bar = await barAt('p4', gy);
  const shop = await lifelineAt('p2', gy);
  await t.dragTo(bar.x, bar.y, shop.x, gy, { steps: 10 });
  await t.press('Enter');   // leave the label editor the new message opens in
  d = await saved();
  const fromBar = d.messages[2];
  t.check('a drag from an activation bar back to the caller adds the reply of the open call, in that row gap',
    !!bar && fromBar.from === 'p4' && fromBar.to === 'p2' && fromBar.kind === 'reply' && d.messages[3].id === 'm3', JSON.stringify(fromBar));
  const gy2 = await gapY('m1', 'm2');
  const cust = await lifelineAt('p1', gy2), pay = await lifelineAt('p3', gy2);
  await t.dragTo(cust.x, gy2, pay.x, gy2, { steps: 10 });
  await t.press('Enter');
  d = await saved();
  t.check('a drag from a lifeline with no bar adds a call', d.messages[1].from === 'p1' && d.messages[1].to === 'p3' && d.messages[1].kind === 'sync', JSON.stringify(d.messages[1]));
  const msgsBefore = d.messages.length;
  const c1 = await lifelineAt('p1', await gapY('m4', 'm5'));
  await t.dragTo(c1.x, c1.y, c1.x + 6, c1.y + 14, { steps: 4 });
  const msgsAfter = (await saved()).messages.length;
  t.check('a wobble along a lifeline draws nothing', msgsAfter === msgsBefore, `${msgsBefore} -> ${msgsAfter}`);
  const barClick = await barAt('p4', await gapY('m2', 'm3'));
  await t.click(barClick.x, barClick.y);
  t.check('a click on an activation bar selects its participant',
    await t.ev(`document.querySelector('.seq-participant.selected')?.dataset.nodeId`) === 'p4');

  // Keyboard: arrows walk, Enter edits, Tab moves to the detail, Alt+Down moves, Shift+Down grows a range
  await t.open(page);
  await t.click(5, 300);   // focus the page (a blank spot of the viewport)
  await t.press('ArrowDown');
  await t.press('ArrowDown');
  const k1 = await t.ev(`document.querySelector('.seq-msg-label.selected')?.dataset.edgeId`);
  await t.press('Enter');
  await t.type('Reserve items');
  await t.press('Tab');
  const inDetail = await t.ev(`document.activeElement?.classList.contains('seq-msg-detail-text')`);
  await t.type('sku, quantity');
  await t.press('Enter');
  d = await saved();
  t.check('arrow keys walk the messages; Enter edits; Tab moves on to the detail', k1 === 'm2' && inDetail && d.messages[1].label === 'Reserve items' && d.messages[1].detail === 'sku, quantity', `${k1} ${inDetail} ${JSON.stringify(d.messages[1])}`);
  await t.press('ArrowDown', { modifiers: 1 });
  d = await saved();
  t.check('Alt+Down moves the selected message one row (into the frame rule)', d.messages[2].id === 'm2', d.messages.map((m) => m.id).join());
  await t.press('ArrowDown', { modifiers: 8 });
  await t.press('ArrowDown', { modifiers: 8 });
  t.check('Shift+Down grows the range', (await count('.seq-msg-label.selected')) === 3);
  await t.press('ArrowRight');
  t.check('Left/Right walk the participants', (await count('.seq-participant.selected')) === 1);

  // Auto-Tidy and save path
  await t.clickOn('#btn-auto-tidy');
  await t.press('s', { modifiers: 2 });
  t.check('Auto-Tidy and Ctrl+S run without errors', t.errors.length === 0, t.errors.join(' | '));

  // Round-trip parity: a generated page saved without edits writes its data block byte-identical (the page's
  // toDisk + formatJson agree with scripts/disk_format.py), and no positions are saved
  for (const [what, file] of [['the checkout page', page], ['a page using every new field', long]]) {
    await t.open(file);
    const gen = block(readFileSync(file, 'utf8'));
    await t.press('s', { modifiers: 2 });
    await sleep(300);
    const savedBlock = await t.ev(`document.getElementById('diagram-data').textContent`);
    t.check(`Save without edits writes the data block byte-identical (${what}), with no positions`,
      savedBlock === gen && !/"(x|y|w|h|elseY|dividers|hidden|layout)":/.test(savedBlock), JSON.stringify(savedBlock.slice(0, 200)));
  }

  // --- Reading a long diagram (steps 2 and 3) ---
  await t.open(long);
  t.check('the long page renders every message, frame and note without errors',
    (await count('.seq-msg-label')) === 42 && (await count('.seq-frag-label')) === 7 && (await count('.seq-note')) === 4 && t.errors.length === 0, t.errors.join(' | '));
  // Collapse a phase: its messages hide, the numbers stay
  const num = (id) => t.ev(`document.querySelector('.seq-msg-label[data-edge-id="${id}"] .seq-msg-num')?.textContent`);
  await t.clickOn('.seq-frag-label[data-frag-id="f1"] .seq-frag-chev');
  const sum = await t.ev(`document.querySelector('.seq-frag-summary')?.textContent`);
  t.check('collapsing a frame hides its messages behind one summary row and keeps every step number',
    sum === '9 messages hidden (steps 2–10)' && (await count('.seq-msg-label')) === 33 && (await num('m11')) === '11' && (await num('m1')) === '1', `${sum} ${await count('.seq-msg-label')}`);
  await t.clickOn('.seq-frag-summary');
  t.check('clicking the summary row expands the frame again', (await count('.seq-msg-label')) === 42 && (await count('.seq-frag-summary')) === 0);
  // Focus
  await t.clickOn('.seq-participant[data-node-id="spm"]');
  const dim = await count('.seq-msg-label.is-dim');
  await t.clickOn('.seq-msg-label[data-edge-id="m6"]');
  t.check('a selected participant dims the messages that do not touch it; a selected message lights its two boxes',
    dim > 20 && dim < 42 && (await count('.seq-participant.linked')) === 2);
  // Pan down: the participant row is pinned at the top of the viewport; an SVG export has it at the top
  await t.press('Escape');
  await t.clickOn('#btn-zoom-in');
  // A wheel over the viewport scrolls the canvas (synthetic: the CDP mouseWheel event would also work, but the
  // shell's own test drives the wheel this way)
  await t.ev(`document.getElementById('viewport').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 1500, deltaMode: 0, clientX: 600, clientY: 400 }))`);
  await sleep(100);
  const pinned = await t.ev(`(() => { const c = document.getElementById('seq-canvas'); const b = document.querySelector('.seq-participant').getBoundingClientRect();
    const v = document.getElementById('viewport').getBoundingClientRect(); return c.classList.contains('seq-pinned') && b.top >= v.top - 1 && b.top < v.top + 40; })()`);
  t.check('panned down, the participant row is pinned at the top of the viewport', pinned);
  const svgText = await t.ev(`new Promise(res => {
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { URL.createObjectURL = orig; b.text().then(res); return 'blob:x'; };
    document.querySelector('[data-export="svg"]').click();
  })`);
  t.check('an SVG export shows the row unpinned (no band, no offset)', !/seq-pin-band|translate: 0px \d/.test(svgText) && !/translate:\s*0px\s+[1-9]/.test(svgText) && svgText.length > 1000);

  // --- Rails and Focus (step 2) ---
  // The long diagram has phases for most of its messages: wrap the three loose ones (steps 17-19) in a frame too, so that
  // every participant outside the SPM phase has something to fold. Then Focus on SPM.
  await t.open(long);
  const canvasW = () => t.ev(`document.getElementById('seq-canvas').offsetWidth`);
  const summaries = () => count('.seq-frag-summary');
  const rails = () => t.ev(`JSON.stringify([...document.querySelectorAll('.seq-participant.is-rail')].map((e) => e.dataset.nodeId))`);
  await t.clickOn('.seq-msg-label[data-edge-id="m17"]');
  await t.clickOn('.seq-msg-label[data-edge-id="m19"]', { modifiers: 8 });
  await t.clickOn('#btn-frame');
  await t.type('Status update');
  await t.press('Enter');
  await t.press('Escape');
  const wideW = await canvasW();
  t.check('with every frame expanded there are no rails, and the Show all button is not offered',
    (await count('.seq-participant.is-rail')) === 0 && (await t.ev(`document.getElementById('btn-show-all').hidden`)), `${await rails()}`);
  await t.clickOn('.seq-frag-label[data-frag-id="f3"] .seq-frag-focus');
  const narrowW = await canvasW();
  const railList = JSON.parse(await rails());
  const railBox = await t.ev(`(() => { const e = document.querySelector('.seq-participant.is-rail'); return e ? e.getBoundingClientRect().width / (document.getElementById('seq-canvas').getBoundingClientRect().width / document.getElementById('seq-canvas').offsetWidth) : 0; })()`);
  t.check('Focus on a phase collapses every other top-level frame and expands that one',
    (await summaries()) === 4 && (await t.ev(`!document.querySelector('.seq-frag-label[data-frag-id="f3"]').classList.contains('is-collapsed')`)), `${await summaries()}`);
  t.check('the participants the other phases leave become rails, RAIL_W wide', railList.sort().join() === 'bus,db,job,pol' && Math.round(railBox) === 36, `${railList} ${railBox}`);
  t.check('Focus on SPM makes the canvas at least 35% narrower', narrowW <= wideW * 0.65, `${wideW} -> ${narrowW} (${(100 - 100 * narrowW / wideW).toFixed(1)}%)`);
  t.check('the Show all button appears while a frame is collapsed', !(await t.ev(`document.getElementById('btn-show-all').hidden`)));
  await t.press('z', { modifiers: 2 });
  t.check('Focus is one undo step', (await summaries()) === 0 && (await count('.seq-participant.is-rail')) === 0 && (await canvasW()) === wideW, `${await summaries()} ${await rails()}`);
  await t.press('y', { modifiers: 2 });
  t.check('and one redo step', (await summaries()) === 4 && (await count('.seq-participant.is-rail')) === 4);
  // A rail: select it, hover shows the name, and Show opens the frames that hide it
  await t.clickOn('.seq-participant.is-rail[data-node-id="spm"], .seq-participant.is-rail[data-node-id="bus"]');
  const tip = await t.ev(`(() => { const e = document.querySelector('.seq-participant.is-rail.selected .seq-rail-tip'); return e ? [e.textContent, getComputedStyle(e).display] : null; })()`);
  t.check('clicking a rail selects its participant and names it in full', !!tip && tip[0] === 'Service Bus' && tip[1] === 'block', JSON.stringify(tip));
  t.check('its frames stay collapsed, and its action bar offers Show', (await summaries()) === 4 && (await count('.seq-actionbar .seq-ab-btn[data-act="show"]')) === 1);
  await t.clickOn('.seq-actionbar .seq-ab-btn[data-act="show"]');
  t.check('Show expands the frames that hide the participant, so it is no longer a rail',
    !JSON.parse(await rails()).includes('bus') && (await summaries()) < 4 && (await count('.seq-participant.is-rail')) < 4, `${await rails()} ${await summaries()}`);
  await t.clickOn('#btn-show-all');
  t.check('Show all expands every frame again (and then hides itself)', (await summaries()) === 0 && (await count('.seq-participant.is-rail')) === 0 && (await t.ev(`document.getElementById('btn-show-all').hidden`)));
  // Focus is a toggle, and a frame's action bar has it too
  await t.clickOn('.seq-frag-label[data-frag-id="f3"] .seq-frag-kind, .seq-frag-label[data-frag-id="f3"] .seq-frag-text');
  await t.clickOn('.seq-actionbar .seq-ab-btn[data-act="focus"]');
  const viaBar = await summaries();
  await t.clickOn('.seq-actionbar .seq-ab-btn[data-act="focus"]');
  t.check('a frame\'s action bar has Focus, and pressing it again on the focused frame shows everything',
    viaBar === 4 && (await summaries()) === 0, `${viaBar} ${await summaries()}`);
  // Drawing a message to a rail opens the frames that hide it first
  await t.clickOn('.seq-frag-label[data-frag-id="f3"] .seq-frag-focus');
  const railX = await t.ev(`(() => { const r = document.querySelector('.seq-life-hit[data-pid="pol"]').getBoundingClientRect(); return r.left + r.width / 2; })()`);
  const fromX = await t.ev(`(() => { const r = document.querySelector('.seq-life-hit[data-pid="spm"]').getBoundingClientRect(); return r.left + r.width / 2; })()`);
  const rowY = (await t.at('.seq-msg-label[data-edge-id="m14"]')).y + 14;
  await t.dragTo(fromX, rowY, railX, rowY, { steps: 10 });
  await t.press('Enter');
  t.check('drawing a message to a rail expands the frames that hide it, so it is never drawn into a collapsed frame',
    (await count('.seq-participant.is-rail[data-node-id="pol"]')) === 0 && t.errors.length === 0, `${await rails()} ${t.errors.join(' | ')}`);

  // --- Lifespans (step 3) ---
  await t.open(long);
  const boxTop = (pid) => t.ev(`parseFloat(document.querySelector('.seq-participant[data-node-id="${pid}"]').style.top)`);
  const lifeLen = (pid) => t.ev(`(() => { const l = document.querySelector('.seq-lifeline[data-node-id="${pid}"]'); return +l.getAttribute('y2') - +l.getAttribute('y1'); })()`);
  const fullH = await t.ev(`document.getElementById('seq-canvas').offsetHeight`);
  const tallLife = await lifeLen('spm');
  await t.clickOn('#btn-lifespans');
  const trimmed = { spm: await boxTop('spm'), cust: await boxTop('cust'), job: await boxTop('job'), len: await lifeLen('spm') };
  t.check('Trim lifelines draws each box at the top of its lifeline, which ends in a short cap',
    trimmed.cust === 24 && trimmed.spm > 400 && trimmed.job > trimmed.spm && trimmed.len < tallLife / 2 && (await count('.seq-cap')) === 8, JSON.stringify(trimmed));
  t.check('the participants that start in the top rows stay in the top row; a header slot makes the diagram taller, not wider',
    (await t.ev(`document.getElementById('seq-canvas').offsetHeight`)) > fullH && (await t.ev(`document.getElementById('btn-lifespans').getAttribute('aria-pressed')`)) === 'true');
  await t.press('z', { modifiers: 2 });
  t.check('the toggle is one undo step', (await count('.seq-cap')) === 0 && (await boxTop('spm')) === 24 && (await lifeLen('spm')) === tallLife);
  await t.press('y', { modifiers: 2 });
  // The pinned row names only the lifelines alive under it, at two scroll positions
  const scrollTo = async (sel, y) => {
    for (let i = 0; i < 6; i++) {
      const cur = await t.ev(`document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect().top`);
      if (Math.abs(cur - y) < 12) return;
      await t.ev(`document.getElementById('viewport').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: ${cur - y}, deltaMode: 0, clientX: 600, clientY: 400 }))`);
      await sleep(80);
    }
  };
  const pinnedNow = () => t.ev(`(() => { const vp = document.getElementById('viewport').getBoundingClientRect();
    return JSON.stringify([...document.querySelectorAll('.seq-participant')].filter((e) => e.getBoundingClientRect().top < vp.top + 90 && e.getBoundingClientRect().bottom > vp.top && !e.classList.contains('is-gone')).map((e) => e.dataset.nodeId).sort()); })()`);
  await t.press('Escape');
  for (let i = 0; i < 4; i++) await t.clickOn('#btn-zoom-in');   // about 100%: the viewport shows a few rows, as on a screen
  await scrollTo('.seq-line[data-edge-id="m14"]', 300);
  const posA = JSON.parse(await pinnedNow());
  await scrollTo('.seq-line[data-edge-id="m33"]', 300);
  const posB = JSON.parse(await pinnedNow());
  t.check('the pinned row shows only the lifelines alive at the rows under it (SPM phase: no Background Job, no bus yet)',
    posA.includes('spm') && posA.includes('cust') && !posA.includes('job') && !posA.includes('bus'), posA.join());
  t.check('further down it has dropped SPM and named Background Job and the bus, which have begun',
    !posB.includes('spm') && posB.includes('job') && posB.includes('bus'), posB.join());
  const exported = await t.ev(`new Promise(res => {
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { URL.createObjectURL = orig; b.text().then(res); return 'blob:x'; };
    document.querySelector('[data-export="svg"]').click();
  })`);
  t.check('an SVG export of a trimmed diagram has every box at the start of its lifeline (nothing pinned, nothing faded)',
    !/translate:\s*0px\s+[1-9]/.test(exported) && !/opacity:\s*0;/.test(exported.replace(/[^;]*seq-pin[^;]*;/g, '')) && exported.length > 1000);
  t.check('and no page errors so far', t.errors.length === 0, t.errors.join(' | '));

  // --- Shared columns and start / end handles (step 4) ---
  await t.open(long);
  await t.clickOn('#btn-lifespans');
  const gapAt = (a, b) => gapY(a, b);
  // Start handle: drag the Service Bus's start box up to before step 16 (its own first message is step 19)
  await t.clickOn('.seq-participant[data-node-id="bus"]');
  const hs = await t.at('.seq-handle[data-role="pstart"]');
  await t.dragTo(hs.x, hs.y, hs.x, await gapAt('m15', 'm16'), { steps: 8 });
  d = await saved();
  t.check('a start handle drags a lifeline earlier: only outward, onto a message id', d.participants.find((q) => q.id === 'bus').start === 'm16', JSON.stringify(d.participants.find((q) => q.id === 'bus')));
  // Deleting the message a start override names must not leave a dangling id behind
  await t.clickOn('.seq-msg-label[data-edge-id="m16"]');
  await t.press('Delete');
  d = await saved();
  t.check('deleting the message a start names drops the override', !d.messages.some((m) => m.id === 'm16') && d.participants.every((q) => q.start === undefined || d.messages.some((m) => m.id === q.start)), JSON.stringify(d.participants.find((q) => q.id === 'bus')));
  await t.press('z', { modifiers: 2 });
  await t.clickOn('.seq-participant[data-node-id="bus"]');
  const hs2 = await t.at('.seq-handle[data-role="pstart"]');
  await t.dragTo(hs2.x, hs2.y, hs2.x, await gapAt('m22', 'm23'), { steps: 8 });
  d = await saved();
  t.check('dragged back inside its own span, the override goes', d.participants.find((q) => q.id === 'bus').start === undefined);
  // End handle: the SPM lifeline (steps 7-16) ends later, at step 23
  await t.clickOn('.seq-participant[data-node-id="spm"]');
  const he = await t.at('.seq-handle[data-role="pend"]');
  await t.dragTo(he.x, he.y, he.x, await gapAt('m23', 'm24'), { steps: 8 });
  d = await saved();
  t.check('an end handle drags the cap down onto a later message', d.participants.find((q) => q.id === 'spm').end === 'm23', JSON.stringify(d.participants.find((q) => q.id === 'spm')));
  // Share a column: drop Background Job's box (steps 27-36) on SPM's lifeline
  const jobBox = await t.at('.seq-participant[data-node-id="job"]');
  const spmLine = await lifelineAt('spm', jobBox.y);
  const widthBefore = await canvasW();
  await t.dragTo(jobBox.x, jobBox.y, spmLine.x, jobBox.y, { steps: 10 });
  d = await saved();
  const sameCol = await t.ev(`(() => { const l = (id) => document.querySelector('.seq-participant[data-node-id="' + id + '"]').style.left; return l('spm') === l('job'); })()`);
  t.check('dropping a box on another lifeline puts them in one column when their lifespans do not overlap',
    d.participants.find((q) => q.id === 'job').column === 'spm' && sameCol && (await canvasW()) < widthBefore, `${JSON.stringify(d.participants.find((q) => q.id === 'job'))} ${widthBefore} -> ${await canvasW()}`);
  // The end handle may not reach into the other participant's span
  await t.clickOn('.seq-participant[data-node-id="spm"]');
  const he2 = await t.at('.seq-handle[data-role="pend"]');
  await t.dragTo(he2.x, he2.y, he2.x, await gapAt('m29', 'm30'), { steps: 8 });
  d = await saved();
  const hint1 = await t.ev(`document.querySelector('.seq-hint')?.textContent`);
  t.check('a handle that would make the two lifespans overlap is refused, with the reason',
    d.participants.find((q) => q.id === 'spm').end === 'm23' && /^SPM and Background Job are both active at step 27$/.test(hint1 || ''), `${hint1} ${d.participants.find((q) => q.id === 'spm').end}`);
  // A box dropped on a lifeline it overlaps is refused with the reason
  const dbBox = await t.at('.seq-participant[data-node-id="db"]');
  const polLine = await lifelineAt('pol', dbBox.y);
  await t.dragTo(dbBox.x, dbBox.y, polLine.x, dbBox.y, { steps: 10 });
  const hint2 = await t.ev(`document.querySelector('.seq-hint')?.textContent`);
  d = await saved();
  t.check('dropping a box where the lifespans overlap is refused, and the reason names both and the step',
    d.participants.find((q) => q.id === 'db').column === undefined && /^Policy Svc and Policy DB are both active at step 3$/.test(hint2 || '') && !(await t.ev(`document.querySelector('.seq-participant.dragging')`)), `${hint2}`);
  await t.clickOn('.seq-participant[data-node-id="job"]');
  await t.clickOn('.seq-actionbar .seq-ab-btn[data-act="own"]');
  d = await saved();
  t.check('"Own column" in the action bar undoes the share', d.participants.find((q) => q.id === 'job').column === undefined);
  await t.press('z', { modifiers: 2 });
  t.check('and it is one undo step', (await t.ev(`(() => { const l = (id) => document.querySelector('.seq-participant[data-node-id="' + id + '"]').style.left; return l('spm') === l('job'); })()`)));
  await t.clickOn('#btn-lifespans');
  d = await saved();
  t.check('turning Trim lifelines off drops the shared columns (they need lifespans)', d.lifespans === undefined && d.participants.every((q) => q.column === undefined));
  t.check('no page errors in the column steps', t.errors.length === 0, t.errors.join(' | '));

  // --- Participant colours (step 5) ---
  await t.open(page);
  const SKY = '#e0f2fe', AMBER = '#fef3c7';
  const boxStyle = (pid) => t.ev(`(() => { const b = document.querySelector('.seq-participant[data-node-id="${pid}"]'); const c = getComputedStyle(b);
    return { top: c.borderTopWidth, topColor: c.borderTopColor, bg: c.backgroundColor, scoped: b.classList.contains('swatch-scope') }; })()`);
  const plain = await boxStyle('p2');
  await t.clickOn('.seq-participant[data-node-id="p2"]');
  t.check('a participant\'s action bar has a "none" swatch and the eight flowchart swatches', (await count('.seq-actionbar .swatch-btn')) === 9);
  await t.clickOn(`.seq-actionbar .swatch-btn[data-value="${SKY}"]`);
  const coloured = await boxStyle('p2');
  const lifeStroke = await t.ev(`getComputedStyle(document.querySelector('.seq-lifeline[data-node-id="p2"]')).stroke`);
  const plainLife = await t.ev(`getComputedStyle(document.querySelector('.seq-lifeline[data-node-id="p3"]')).stroke`);
  const barFill = await t.ev(`(() => { const b = document.querySelector('.seq-activation[data-node-id="p2"]'); return b ? [b.classList.contains('swatch-scope'), getComputedStyle(b).stroke, getComputedStyle(b).fill] : null; })()`);
  t.check('a swatch colours the box (4px top border, faint tint), the lifeline and the activation bars',
    coloured.scoped && coloured.top === '4px' && coloured.topColor !== plain.topColor && coloured.bg !== plain.bg && lifeStroke !== plainLife
      && !!barFill && barFill[0] && barFill[1] !== 'rgb(100, 116, 139)', `${JSON.stringify([plain, coloured, lifeStroke, plainLife, barFill])}`);
  const keyItems = await t.ev(`[...document.querySelectorAll('.seq-key-item')].map((e) => [e.querySelector('.seq-key-label').textContent, e.querySelector('.seq-key-label').dataset.hint])`);
  t.check('the first use of a colour adds a key entry with no label, prompting "What does sky mean?"', JSON.stringify(keyItems) === JSON.stringify([['', 'What does sky mean?']]), JSON.stringify(keyItems));
  await t.press('z', { modifiers: 2 });
  t.check('one undo takes the colour and the key entry away together', !(await boxStyle('p2')).scoped && (await count('.seq-key')) === 0 && !(await t.ev(`!!document.querySelector('.seq-activation.swatch-scope')`)));
  await t.press('y', { modifiers: 2 });
  await t.clickOn('.seq-key-label', { count: 2 });
  await t.type('Our services');
  await t.press('Enter');
  d = await saved();
  t.check('the key label edits by double-click and is saved in colorKey, the participant colour as its hex',
    d.colorKey && d.colorKey[SKY] === 'Our services' && d.participants[1].color === SKY && Object.keys(d)[Object.keys(d).indexOf('participants') - 1] === 'colorKey', JSON.stringify([d.colorKey, d.participants[1]]));
  await t.clickOn('.seq-participant[data-node-id="p3"]');
  await t.clickOn(`.seq-actionbar .swatch-btn[data-value="${AMBER}"]`);
  t.check('a second colour adds a second key entry', (await count('.seq-key-item')) === 2);
  // Export: the SVG carries the colours and the key
  const topColor = (await boxStyle('p2')).topColor;
  const svgOut = await t.ev(`new Promise(res => {
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { URL.createObjectURL = orig; b.text().then(res); return 'blob:x'; };
    document.querySelector('[data-export="svg"]').click();
  })`);
  t.check('an SVG export carries the participant colours and the key, including its label', svgOut.includes('Our services') && svgOut.includes('border-top-width:4px') && /stroke:(oklch|oklab)\(/.test(svgOut)
    && !/What does/.test(svgOut), `${svgOut.includes('Our services')} ${svgOut.includes('border-top-width:4px')} ${/stroke:(oklch|oklab)\(/.test(svgOut)} ${(svgOut.match(/.{30}What does.{30}/) || [''])[0]}`);
  // Clearing: "none" removes the colour, and an unused key entry is dropped on save
  await t.clickOn('.seq-participant[data-node-id="p2"]');
  await t.clickOn('.seq-actionbar .swatch-btn[data-value=""]');
  d = await saved();
  t.check('"none" clears the colour; a key entry no participant uses is dropped on save',
    !(await boxStyle('p2')).scoped && d.participants[1].color === undefined && d.colorKey && !(SKY in d.colorKey) && AMBER in d.colorKey, JSON.stringify(d.colorKey));
  await t.clickOn('.seq-participant[data-node-id="p3"]');
  await t.clickOn('.seq-actionbar .swatch-btn[data-value=""]');
  d = await saved();
  t.check('with no colour left, the key goes too', d.colorKey === undefined && (await count('.seq-key')) === 0, JSON.stringify(d.colorKey));
  // Contrast: every swatch's line colour on the panel and on a frame's wash (one or two layers), both themes
  const contrast = () => t.ev(`(() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
    const rgb = (css) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const over = (top, a, base) => top.map((v, i) => v * a + base[i] * (1 - a));
    const probe = document.createElement('div'); document.body.appendChild(probe);
    probe.style.color = 'var(--bg-panel)'; const panel = rgb(getComputedStyle(probe).color);
    const tints = ['blue', 'green', 'yellow', 'red', 'purple', 'gray'].map((n) => { probe.className = 'seq-tint-' + n; return rgb(getComputedStyle(probe).getPropertyValue('--seq-tint').trim()); });
    let min = 99;
    ['#e0f2fe', '#fef3c7', '#dcfce7', '#fee2e2', '#f3e8ff', '#ffedd5', '#ccfbf1', '#e0e7ff'].forEach((hex) => {
      const el = document.createElement('div'); el.className = 'swatch-scope'; el.style.setProperty('--swatch-color', hex); document.body.appendChild(el);
      el.style.color = 'var(--sw-line)'; const line = rgb(getComputedStyle(el).color);
      min = Math.min(min, ratio(line, panel));
      tints.forEach((c) => [0.07, 0.14].forEach((a) => { min = Math.min(min, ratio(line, over(c, a, panel))); }));
      el.remove();
    });
    probe.remove();
    return min;
  })()`);
  const lightMin = await contrast();
  await t.clickOn('#btn-theme');
  const darkMin = await contrast();
  await t.clickOn('#btn-theme');
  t.check('every swatch\'s line colour reaches 3:1 on the panel and on a frame\'s wash, in both themes', lightMin >= 3 && darkMin >= 3, `light ${lightMin.toFixed(2)} dark ${darkMin.toFixed(2)}`);
  t.check('no page errors in the colour steps', t.errors.length === 0, t.errors.join(' | '));

  // ?present: read-only, but frames still collapse and expand
  await t.open(long, '?present');
  t.check('?present makes the diagram read-only', await t.ev(`getComputedStyle(document.querySelector('.seq-participant')).pointerEvents === 'none'`));
  await t.clickOn('.seq-frag-label[data-frag-id="f5"] .seq-frag-chev');
  const presentCollapsed = await count('.seq-frag-summary');
  const badge = await t.ev(`document.getElementById('save-status').textContent`);
  await t.clickOn('.seq-frag-summary');
  const unsavedBefore = /unsaved/i.test(await t.ev(`document.getElementById('save-status').textContent`));
  await t.clickOn('.seq-frag-label[data-frag-id="f3"] .seq-frag-focus');
  const focusedPresent = await summaries();
  t.check('Focus works in ?present and changes the view only (no unsaved badge)',
    focusedPresent >= 3 && (await count('.seq-participant.is-rail')) >= 1 && !unsavedBefore && !/unsaved/i.test(await t.ev(`document.getElementById('save-status').textContent`)), `${focusedPresent}`);
  await t.clickOn('.seq-frag-label[data-frag-id="f3"] .seq-frag-focus');
  t.check('and pressing Focus again there shows every frame', (await summaries()) === 0);
  t.check('collapse and expand work in ?present, and change the view only', presentCollapsed === 1 && (await count('.seq-frag-summary')) === 0 && !/unsaved/i.test(badge) && t.errors.length === 0, `${presentCollapsed} ${badge}`);

  // claude.ai Artifact (only with --artifact): Save publishes through a stubbed window.claude; the sequence page
  // saves no positions, so the published block must still be the generated one
  if (artifact) {
    const gen = readFileSync(artifact, 'utf8').replace(/\r\n/g, '\n');
    const skeleton = gen.slice(0, gen.indexOf('<body>') + 6);
    const blockOf = (h) => (h.match(/<script id="diagram-data" type="application\/json">([\s\S]*?)<\/script>/) || [])[1];
    const { identifier } = await t.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__pub = [];
      window.claude = { use: async (n) => n === 'artifact' ? { publish: async (h) => { window.__pub.push(h); } } : null };` });
    await t.open(artifact);
    await t.ev(`document.getElementById('btn-save').click()`);
    await sleep(400);
    const pub = JSON.parse(await t.ev(`JSON.stringify(window.__pub)`));
    t.check('artifact: Save publishes once, in the skeleton, with the generated data block and no positions',
      pub.length === 1 && pub[0].startsWith(skeleton + '\n<title>') && pub[0].endsWith('</body></html>') && blockOf(pub[0]) === blockOf(gen)
      && !/"(x|y|w|h|elseY|layout)":/.test(blockOf(pub[0])) && t.errors.length === 0, `${pub.length} ${t.errors.join(' | ')}`);
    await t.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
} catch (err) {
  console.error('[ERROR]', err.message);
  code = 1;
} finally {
  await t.close();
}
process.exit(code || t.finish());
