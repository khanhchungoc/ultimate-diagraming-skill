// Copy as Mermaid, then Export > Import > Mermaid text, on all four diagram types, and on c4 when --c4 is given (split artifact pages, so Save shows the saved JSON).
//   node dev/e2e_mermaid.mjs --browser <chrome> --flowchart <dir/index.html> --usecase <dir/index.html> --sequence <dir/index.html> --erd <dir/index.html> [--c4 <dir/index.html>]
// Each page is `layout_engine.py --layout dev/examples/example-<type>.json --target artifact` (flowchart: the loan example).
// Per type: Copy then Import of the same text re-lays out cleanly and copies back identical; an edited text
// (one label changed, one item added) imports as one undo step (and canvas paste imports too); another type's text is refused with a message; the reader's notes are listed.
// Also: a flowchart page whose JSON has a step with no position loads with no step on another.
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser');
const pages = { flowchart: argOf('flowchart'), usecase: argOf('usecase'), sequence: argOf('sequence'), erd: argOf('erd') };
if (!browser || Object.values(pages).some((p) => !p)) {
  console.error('usage: --browser <chrome> --flowchart <index.html> --usecase <index.html> --sequence <index.html> --erd <index.html> [--c4 <index.html>]');
  process.exit(1);
}
if (argOf('c4')) pages.c4 = argOf('c4');   // a c4 page is the example built with --target artifact; it is the last, so the other four run as before

// Per type: [text to replace, its replacement] for the label change, the text added (anchor line, then what follows it), and what to look for
const EDIT = {
  flowchart: { label: ['"Verify Income & Employment"', '"Verify Income and Employment"'], found: 'Verify Income and Employment',
    add: ['    n_loan_funded(["Loan Funded"])\n', '    n_extra_check["Extra manual check"]\n'], after: '  n_verify_income_employment --> n_extra_check --> n_store_application_record\n', list: 'nodes' },
  usecase: { label: ['"Borrow book"', '"Borrow a book"'], found: 'Borrow a book',
    add: ['    notify(["Send reminder"]):::c2\n', '    renew(["Renew card"])\n'], after: '  member --- renew\n', list: 'useCases' },
  sequence: { label: ['Place order', 'Place the order'], found: 'Place the order',
    add: ['  p3-->>p2: Payment result\n', '  p2->>p1: Send receipt\n'], after: '', list: 'messages' },
  erd: { label: ['"has"', '"owns"'], found: 'owns',
    add: ['  customer ||..o{ review : ""\n', '  tag {\n    uuid id PK\n    text name\n  }\n  product ||..o{ tag : "is tagged"\n'], after: '', list: 'entities' },
  c4: { label: ['"Browses and orders"', '"Browses and buys"'], found: 'Browses and buys',
    add: ['      Container(worker, "Fulfilment Worker", "Python")\n', '      Container(audit, "Audit Log", "Go")\n'], after: '  Rel(worker, audit, "Writes", "gRPC")\n', list: 'elements' },
};
// The first path where two saved diagrams differ, for the failure message
const firstDiff = (a, b, path = '') => {
  if (JSON.stringify(a) === JSON.stringify(b)) return '';
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], `${path}/${k}`); if (d) return d; }
  }
  return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`.slice(0, 300);
};
const OTHER = { flowchart: 'erd', usecase: 'sequence', sequence: 'flowchart', erd: 'usecase', c4: 'erd' };
const TYPE_NAME = { flowchart: 'flowchart', usecase: 'use case diagram', sequence: 'sequence diagram', erd: 'ER diagram', c4: 'C4 diagram' };

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
const tmp = mkdtempSync(join(tmpdir(), 'e2e_mmd_'));
try {
  // A synthetic clipboard (headless Chrome from a page has no permission) and a recorder for Save, which publishes diagram.json
  await t.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__clip = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (s) => (window.__clip.push(s), Promise.resolve()) } });
    window.__alerts = []; window.alert = (m) => window.__alerts.push(String(m)); window.__pub = [];
    window.claude = { use: async (n) => n === 'artifact' ? { publish: async (files) => { window.__pub.push(files); } } : null };` });

  const save = async () => {
    await t.ev(`document.getElementById('btn-save').click()`);
    await sleep(400);
    return JSON.parse(await t.ev(`window.__pub[window.__pub.length - 1]['diagram.json']`));
  };
  const copyText = async () => {
    await t.ev(`window.__clip = []; document.getElementById('btn-export').click()`);
    await t.clickOn('[data-copy="mermaid"]');
    await sleep(150);
    return t.ev(`window.__clip[0]`);
  };
  const openImport = async () => {
    await t.clickOn('#btn-import-mermaid');
    await sleep(100);
  };
  // Opens the bubble, types the text into its box and presses Import; returns the error text ('' when none)
  const importText = async (text) => {
    await openImport();
    await t.ev(`document.querySelector('.confirm-field').focus()`);
    await t.type(text);
    await t.clickOn('.confirm-ok');
    await sleep(500);
    return t.ev(`(() => { const e = document.querySelector('.confirm-error'); return e && !e.hidden ? e.textContent : ''; })()`);
  };
  const undoSteps = () => t.ev(`document.getElementById('btn-undo').disabled`);

  for (const [kind, file] of Object.entries(pages)) {
    const E = EDIT[kind];
    await t.open(file);
    t.check(`${kind}: the header offers Import`, await t.ev(`!document.getElementById('btn-import-mermaid').hidden`));
    const base = await save();
    const text = await copyText();
    t.check(`${kind}: Copy as Mermaid wrote the diagram's own type`, new RegExp(kind === 'erd' ? 'erDiagram' : kind === 'sequence' ? 'sequenceDiagram' : kind === 'c4' ? 'C4Container' : 'flowchart').test(text), text.slice(0, 40));

    // 1. The same text back: lays out fresh and copies back identical
    const err1 = await importText(text);
    const after1 = await save();
    const again = await copyText();
    const layoutOk = kind === 'c4'
      ? !after1.layout && (await t.ev(`document.querySelectorAll('.c4-node[data-node-id]').length`)) === (base.elements || []).length
      : Object.keys(after1.layout || {}).length === Object.keys(base.layout || {}).length;
    t.check(`${kind}: importing the copied text lays out cleanly`, !err1 && layoutOk,
      err1 || `layout ${Object.keys(after1.layout || {}).length} vs ${Object.keys(base.layout || {}).length}`);
    t.check(`${kind}: and copying again gives the same Mermaid text`, again === text, firstDiff(text.split('\n'), again.split('\n')));
    t.check(`${kind}: no page errors`, t.errors.length === 0, t.errors.join(' | '));
    if (kind === 'c4') {
      // Mermaid has no `async` and no notes; everything else (icon, colour, centre, side, tech) comes back through the %% lines
      const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
      const rel = (d) => d.relations.map(({ async: _a, ...r }) => r);
      const grp = (d) => d.groups.map(({ collapsed, ...g }) => (collapsed ? { ...g, collapsed } : g));   // collapsed: false is the default
      const sorted = (d) => [...d.elements].sort((a, b) => (a.id < b.id ? -1 : 1));
      t.check('c4: elements (with icon, colour, centre, side) come back as they were', canon(sorted(after1)) === canon(sorted(base)), firstDiff(sorted(base), sorted(after1)));
      t.check('c4: groups, relations (without async) and the arrange hint come back as they were',
        canon(grp(after1)) === canon(grp(base)) && canon(rel(after1)) === canon(rel(base)) && after1.arrange === base.arrange && canon(after1.colorKey) === canon(base.colorKey),
        firstDiff({ g: grp(base), r: rel(base) }, { g: grp(after1), r: rel(after1) }));
    }

    // 2. An edited text: one label changed, one item added
    let edited = text.replace(E.label[0], E.label[1]);
    t.check(`${kind}: (setup) the label is in the copied text`, edited !== text && text.includes(E.add[0]), E.label[0]);
    edited = edited.replace(E.add[0], E.add[0] + E.add[1]);
    if (E.after) edited = edited.replace(/\n$/, '\n') + E.after;
    const err2 = await importText(edited);
    const after2 = await save();
    t.check(`${kind}: the edited text imports without an error`, !err2, err2);
    t.check(`${kind}: the label change reached the diagram`, JSON.stringify(after2).includes(E.found));
    t.check(`${kind}: one item was added (${E.list} ${base[E.list].length} -> ${after2[E.list].length})`, after2[E.list].length === base[E.list].length + 1);
    t.check(`${kind}: no page errors`, t.errors.length === 0, t.errors.join(' | '));
    t.check(`${kind}: the edited import left an undo step`, !(await undoSteps()));
    await t.ev(`document.getElementById('btn-undo').click()`);
    await sleep(150);
    t.check(`${kind}: one Undo takes the edited import back`, JSON.stringify(await save()) === JSON.stringify(after1));
    await t.ev(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(edited)});
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
    await sleep(400);
    t.check(`${kind}: pasting Mermaid onto the canvas imports it`, (await save())[E.list].length === base[E.list].length + 1);

    // 3. Text of another diagram type is refused with a message, and the diagram stays
    await t.open(file);
    await save();
    const other = OTHER[kind];
    const otherText = await (async () => {
      await t.open(pages[other]);
      const x = await copyText();
      await t.open(file);
      await save();
      return x;
    })();
    const err3 = await importText(otherText);
    t.check(`${kind}: ${TYPE_NAME[other]} text is refused, naming both types`, err3.includes(TYPE_NAME[other]) && err3.includes(TYPE_NAME[kind]), err3);
    t.check(`${kind}: the refused text changed nothing (no undo step, bubble still open)`, await undoSteps() && await t.ev(`!!document.querySelector('.confirm-field')`));
    const err4 = await (async () => { await t.ev(`document.querySelector('.confirm-field').value = ''`); await t.ev(`document.querySelector('.confirm-field').focus()`); await t.type('not mermaid at all'); await t.clickOn('.confirm-ok'); await sleep(200); return t.ev(`document.querySelector('.confirm-error').textContent`); })();
    t.check(`${kind}: text that is no Mermaid gets a plain message`, /not Mermaid text/.test(err4), err4);
    await t.press('Escape');
    t.check(`${kind}: Escape closes the bubble`, await t.ev(`!document.querySelector('.confirm-field')`));
  }

  // 4. The reader's notes are shown: an ignored style line on a flowchart
  await t.open(pages.flowchart);
  const text = await copyText();
  const err = await importText(text + '  style n_submit_application fill:#f00\n');
  const notes = JSON.parse(await t.ev(`JSON.stringify([...document.querySelectorAll('.confirm-list li')].map((li) => li.textContent))`));
  t.check('flowchart: an ignored style line is listed after the import', !err && notes.length > 0 && /style/.test(notes.join(' ')), notes.join(' | ') || err);
  await t.clickOn('.confirm-ok');
  t.check('flowchart: Close closes the list', await t.ev(`!document.querySelector('.confirm')`));

  // 5. A flowchart page whose JSON has a step with no position (added by hand): it loads with no step on another
  await save();   // unsaved changes would make the next load wait on the browser's leave-page prompt
  const dir = join(tmp, 'flow');
  cpSync(dirname(pages.flowchart), dir, { recursive: true });
  const json = JSON.parse(readFileSync(join(dir, 'diagram.json'), 'utf8'));
  const lane = json.lanes[0].id, from = json.nodes.find((n) => n.laneId === lane && n.type === 'task').id;
  json.nodes.push({ id: 'added_by_hand', laneId: lane, type: 'task', label: 'Added by hand' });
  json.edges.push({ id: 'e_added_by_hand', from, to: 'added_by_hand' });
  writeFileSync(join(dir, 'diagram.json'), JSON.stringify(json, null, 1));
  await t.open(join(dir, 'index.html'));
  const boxes = JSON.parse(await t.ev(`JSON.stringify([...document.querySelectorAll('.flow-node[data-node-id]')].map((e) => { const r = e.getBoundingClientRect(); return [e.dataset.nodeId, r.left, r.top, r.right, r.bottom]; }))`));
  const clash = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a[1] < b[3] && b[1] < a[3] && a[2] < b[4] && b[2] < a[4]) clash.push(`${a[0]} / ${b[0]}`);
  }
  t.check(`flowchart: a step without a position is drawn (${boxes.length} steps) and sits on no other step`, boxes.some((b) => b[0] === 'added_by_hand') && clash.length === 0, clash.join(', '));
  t.check('flowchart: loading the unplaced page raised no error', t.errors.length === 0, t.errors.join(' | '));
} catch (err) {
  console.error('[ERROR]', err.message);
  code = 1;
} finally {
  await t.close();
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(code || t.finish());
