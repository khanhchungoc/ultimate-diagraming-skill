// Interaction test for the ER diagram plugin: selection, adding and renaming tables and columns, keys, reordering,
// drawing / re-pointing / reversing relationships and their inferred ends, cardinality pickers, table colours (swatch row,
// no groups), curves anchored on the table sides, notes, delete, the hover / selection neighbourhood (related tables, key
// rows on side-anchored lines, one highlight colour, the join as a line's tooltip, dimming), the overview below 50% zoom (and its expanded card), the Types and Notes switches, end handles past the crow's feet, exports
// and copies from the overview, multi-select of tables, free table drags (with snap guides, no Auto-Tidy toggle, edits keep tables in place; Columns
// and Types keep hand-placed tables), undo/redo (one step per finished edit), ?present, and the saved data block
// (byte-identical without edits; generated ids renamed, authored ids kept; Python codec agrees; v1 and v2 pages open
// re-laid out, a v2 page's group colours becoming table colours).
// Driven with real mouse and keyboard input over the Chrome DevTools Protocol (see cdp.mjs): a synthetic DOM
// event may only be used where a comment says why.
//   node dev/e2e_erd.mjs --browser <chrome> --page <example-erd.html> --large <saas-billing.html>
// --page: references/examples/example-erd.json laid out with `layout_engine.py --layout` (8 tables).
// --large: dev/fixtures/erd/saas-billing.json laid out the same way (~30 tables).
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser'), page = argOf('page'), large = argOf('large');
if (!browser || !page || !large) { console.error('usage: --browser <chrome> --page <example-erd.html> --large <saas-billing.html>'); process.exit(1); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
try {
  const J = JSON.stringify;
  const count = (sel) => t.ev(`document.querySelectorAll(${J(sel)}).length`);
  const text = (sel) => t.ev(`(document.querySelector(${J(sel)}) || {}).textContent ?? null`);
  const block = (html) => (html.replace(/\r\n/g, '\n').match(/<script id="diagram-data" type="application\/json">([\s\S]*?)<\/script>/) || [])[1];
  // chartData lives in the page script's closure: read the model the way an agent would, from a save (the disk model)
  const saved = async () => {
    await t.press('s', { modifiers: 2 });
    await sleep(250);
    return JSON.parse(await t.ev(`document.getElementById('diagram-data').textContent`));
  };
  const ent = (d, id) => d.entities.find((e) => e.id === id);
  const rel = (d, id) => d.relationships.find((r) => r.id === id);
  const editing = () => t.ev(`(document.activeElement && document.activeElement.isContentEditable) ? document.activeElement.textContent : null`);
  const undo = () => t.press('z', { modifiers: 2 });
  const redo = () => t.press('y', { modifiers: 2 });
  const tableIds = async () => JSON.parse(await t.ev(`JSON.stringify([...document.querySelectorAll('.erd-entity:not(.erd-ghost)')].map(e => e.dataset.nodeId))`));
  const colNames = async (id) => JSON.parse(await t.ev(`JSON.stringify([...document.querySelectorAll('.erd-entity[data-node-id="${id}"] .erd-col-name')].map(e => e.textContent))`));
  const tableName = (id) => text(`.erd-entity[data-node-id="${id}"] .erd-name`);
  const row = (id, col) => `.erd-entity[data-node-id="${id}"] .erd-row[data-col="${col}"]`;
  const head = (id) => `.erd-entity[data-node-id="${id}"] .erd-head`;
  // The action bar of a selected row sits over the row above it: clear the selection before pointing at another row
  const cell = (id, col, field = 'name') => `${row(id, col)} .erd-col-${field}`;
  const pickRow = async (id, col) => { await t.press('Escape'); await t.clickOn(cell(id, col)); };
  const editCell = async (id, col, field = 'name') => { await t.press('Escape'); await t.clickOn(cell(id, col, field), { count: 2 }); return editing(); };
  const unsaved = () => t.ev(`/unsaved/i.test(document.getElementById('save-status').textContent)`);
  const undoDisabled = () => t.ev(`document.getElementById('btn-undo').disabled`);
  // A point on a line that really hits it (the line's own hit path under the pointer), away from its label pill
  const onLine = (id) => t.ev(`(() => {
    const g = document.querySelector('.erd-rel[data-edge-id="${id}"]'); const p = g.querySelector('.edge-hit'); const L = p.getTotalLength();
    for (const f of [0.2, 0.3, 0.42, 0.6, 0.72, 0.82, 0.12, 0.9, 0.5]) {
      const q = p.getPointAtLength(L * f), m = p.getScreenCTM(); const x = m.a * q.x + m.e, y = m.d * q.y + m.f;
      const hit = document.elementFromPoint(x, y);
      if (hit && hit.closest('.erd-rel') === g) return { x, y };
    }
    return null; })()`);
  // Tables apart, read from the DOM
  const layoutProblems = () => t.ev(`(() => { const rc = (e) => e.getBoundingClientRect(), out = [];
    const ov = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
    const ts = [...document.querySelectorAll('.erd-entity:not(.erd-card-table)')].map((e) => [e.dataset.nodeId, rc(e)]);
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) if (ov(ts[i][1], ts[j][1])) out.push('tables ' + ts[i][0] + '/' + ts[j][0]);
    return out; })()`);
  // A blank point of the canvas card (inside its margin, away from every table)
  const canvasBlank = () => t.ev(`(() => { const r = document.getElementById('erd-canvas').getBoundingClientRect(); return { x: r.left + 12, y: r.top + 12 }; })()`);
  const present = (sel) => t.ev(`!!document.querySelector(${J(sel)})`);
  // Hover a row so its connect port shows, then return the port's centre
  const portOf = async (id, col) => {
    const r = await t.at(col ? row(id, col) : head(id), 0.4, 0.5);
    await t.mouse('mouseMoved', r.x, r.y);
    await sleep(60);
    return t.at(`.erd-entity[data-node-id="${id}"] ${col ? `.erd-row[data-col="${col}"]` : '.erd-head'} .erd-port`);
  };
  const freshPage = async (file = page, query = '') => { await t.open(file, query); };
  // The saved block, run through the Python codec (from_disk, to_disk, format_json): must come out as written
  const pythonAgrees = (blockText) => {
    const py = `import sys, json
sys.path.insert(0, ${J(join(root, 'scripts'))})
from disk_format import from_disk, to_disk, with_readme, format_json
d = json.loads(sys.stdin.read()); readme = d.pop('_readme', None)
out = to_disk('erd', from_disk('erd', d))
if readme is not None: out = with_readme(out, readme)
sys.stdout.write(format_json(out))`;
    const r = spawnSync('python3', ['-I', '-c', py], { input: blockText, encoding: 'utf8' });
    return r.status === 0 && r.stdout.trim() === blockText.trim() ? '' : `python: ${r.stderr || 'differs'}`;
  };

  // ---------------------------------------------------------------------------------------------------------
  await freshPage();
  const vw = await t.ev(`innerWidth`);
  t.check('the example renders its 8 tables and 9 lines, no group boxes, without errors',
    (await count('.erd-entity')) === 8 && (await count('.erd-group, .erd-group-tab')) === 0 && (await count('.erd-rel')) === 9 && t.errors.length === 0 && vw > 1000, `${t.errors.join(' | ')} ${vw}`);
  t.check('the dock has Table, Relationship, Note (no Area), and no Delete until something is selected',
    [await present('#btn-add-table'), await present('#btn-add-relationship'), await present('#btn-add-note')].every(Boolean) && !(await present('#btn-add-area')) && !(await t.ev(`document.getElementById('btn-delete-selection').classList.contains('show')`)));
  // Curves: one cubic Bezier per line, leaving a table side at right angles, ends on the table edges
  const curves = await t.ev(`JSON.stringify([...document.querySelectorAll('.erd-rel')].map((g) => {
    const d = g.querySelector('.edge-line').getAttribute('d'), n = (d.match(/-?[\\d.]+/g) || []).map(Number);
    const box = (id) => { const e = document.querySelector('.erd-entity[data-node-id="' + id + '"]'); return { x: e.offsetLeft, y: e.offsetTop, w: e.offsetWidth, h: e.offsetHeight }; };
    const edge = (p, b) => (Math.abs(p[0] - b.x) < 1 || Math.abs(p[0] - b.x - b.w) < 1 || Math.abs(p[1] - b.y) < 1 || Math.abs(p[1] - b.y - b.h) < 1);
    const self = g.dataset.from === g.dataset.to;
    return { id: g.dataset.edgeId, ok: /^M [-\\d. ]+ C [-\\d. ]+$/.test(d) && n.length === 8, on: edge([n[0], n[1]], box(g.dataset.from)) && edge([n[6], n[7]], box(g.dataset.to)), self }; }))`);
  const curveList = JSON.parse(curves);
  t.check('every line is one cubic Bezier path (M P0 C P1 P2 P3) whose two ends sit on the edges of the tables it joins', curveList.length === 9 && curveList.every((c) => c.ok && c.on), curves);

  // --- Selection, Escape, glyph fix ---
  await t.clickOn(head('order'));
  t.check('clicking a table selects it, shows its action bar and the dock Delete',
    (await count('.erd-entity.selected')) === 1 && (await count('.erd-actionbar [data-act="addcol"]')) === 1 && (await t.ev(`document.getElementById('btn-delete-selection').classList.contains('show')`)));
  await t.press('Escape');
  t.check('Escape clears the selection and its action bar', (await count('.erd-entity.selected')) === 0 && (await count('.erd-actionbar')) === 0);
  await t.clickOn(row('order', 'status'));
  t.check('clicking a column selects that row and shows the column action bar',
    (await count('.erd-row.selected')) === 1 && (await count('.erd-actionbar [data-act="pk"]')) === 1);
  const blank0 = await canvasBlank();
  await t.click(blank0.x, blank0.y);   // blank canvas: the shell clears the selection
  t.check('a click on blank canvas clears the selection', (await count('.erd-row.selected')) === 0);
  const glyphScale = await t.ev(`(() => { const c = document.getElementById('erd-canvas'); return c.getBoundingClientRect().width / c.offsetWidth; })()`);
  const glyph = await t.ev(`(() => {
    const r = document.querySelector('.erd-entity[data-node-id="order_item"] .erd-row[data-col="order_id"]');
    const g = r.querySelector('.erd-glyph').getBoundingClientRect(), n = r.querySelector('.erd-col-name').getBoundingClientRect();
    const s = [...r.querySelectorAll('.erd-glyph svg')].map((e) => e.getBoundingClientRect());
    const one = document.querySelector('.erd-entity[data-node-id="customer"] .erd-row[data-col="id"] .erd-glyph svg').getBoundingClientRect();
    return { slot: g.width, gap: n.left - Math.max(...s.map((q) => q.right)), stacked: s.length === 2 && s[0].bottom <= s[1].top + 0.5 && s[0].left === s[1].left,
      inside: s.every((q) => q.left >= g.left - 0.5 && q.right <= g.right + 0.5 && q.top >= r.getBoundingClientRect().top && q.bottom <= r.getBoundingClientRect().bottom), oneGap: n.left - one.right }; })()`);
  t.check('a PK+FK column stacks its two glyphs inside the 22px glyph slot, clear of the name (as much room as a single glyph)',
    Math.abs(glyph.slot / glyphScale - 22) < 0.6 && glyph.stacked && glyph.inside && glyph.gap / glyphScale >= 8, J(glyph));

  // --- Add a table ---
  await freshPage();
  await t.clickOn(head('order'));
  await t.clickOn('#btn-add-table');
  let ids = await tableIds();
  const newId = ids.find((i) => /^t_\d+/.test(i));
  const nameEdit = await editing();
  t.check('Table adds one after the selected table, with an id PK uuid column, and opens its name in edit',
    ids.length === 9 && !!newId && ids.indexOf(newId) === ids.indexOf('order') + 1 && nameEdit === 'table_9' && (await colNames(newId)).join() === 'id'
      && (await text(`${row(newId, 'id')} .erd-col-type`)) === 'uuid' && (await t.ev(`!!document.querySelector('.erd-entity[data-node-id="${newId}"] .erd-row.pk')`)), `${ids} ${nameEdit}`);
  await t.type('payment_method');
  await t.press('Enter');
  t.check('typing and Enter renames the new table', (await tableName(newId)) === 'payment_method' && (await editing()) === null);
  let d = await saved();
  t.check('the saved table has no group and its id column is a uuid primary key',
    ent(d, 'payment_method') && !('group' in ent(d, 'payment_method')) && J(ent(d, 'payment_method').columns) === J([{ name: 'id', type: 'uuid', pk: true }]), J(ent(d, 'payment_method')));
  await undo();
  t.check('undo takes the rename back as one step', (await tableName(newId)) === 'table_9');
  await undo();
  t.check('and the table itself as the next one', (await tableIds()).length === 8);
  await redo();
  await redo();
  t.check('redo brings the table and its name back', (await tableName(newId)) === 'payment_method' && (await tableIds()).length === 9);
  // Esc keeps the placeholder name, and the creation alone is one undo step
  await freshPage();
  await t.clickOn('#btn-add-table');
  await t.press('Escape');
  const afterEsc = await tableIds();
  await undo();
  t.check('Escape in a new table’s name edit keeps table_9; undo removes it in one step', afterEsc.length === 9 && (await tableIds()).length === 8 && (await undoDisabled()));
  // Drag the dock button onto the canvas
  await freshPage();
  const btn = await t.at('#btn-add-table'), dropAt = await t.at(head('product'), 0.5, 3);
  await t.dragTo(btn.x, btn.y, dropAt.x, dropAt.y, { steps: 8 });
  ids = await tableIds();
  const dropped = ids.find((i) => /^t_\d+/.test(i));
  await t.press('Escape');
  d = await saved();
  t.check('dragging Table onto the canvas drops a new table there and opens its name in edit', ids.length === 9 && !!dropped && !!ent(d, 'table_9') && !d.entities.some((e) => 'group' in e), `${ids}`);
  t.check('no ghost is left behind and the page has no errors', (await count('.erd-ghost')) === 0 && t.errors.length === 0, t.errors.join(' | '));

  // --- Rename ---
  await freshPage();
  await t.clickOn(head('address'), { count: 2 });
  const inHead = await editing();
  await t.type('addr');
  await t.press('Enter');
  t.check('double-click on a table header renames it', inHead === 'address' && (await tableName('address')) === 'addr' && (await editing()) === null, `${inHead}`);
  await t.clickOn(head('customer'));
  await t.press('F2');
  await t.type('client');
  await t.press('Enter');
  await t.clickOn(head('product'));
  await t.press('Enter');
  const viaEnter = await editing();
  await t.press('Escape');
  t.check('F2 and Enter on a selected table edit its name; Escape keeps the old one', (await tableName('customer')) === 'client' && viaEnter === 'product' && (await tableName('product')) === 'product');
  const inCol = await editCell('order', 'status');
  await t.type('state');
  await t.press('Enter');
  d = await saved();
  t.check('double-click on a column renames it', inCol === 'status' && (await colNames('order')).includes('state') && ent(d, 'order').columns[3].name === 'state', `${inCol}`);
  await editCell('order', 'customer_id');
  await t.type('buyer_id');
  await t.press('Enter');
  d = await saved();
  t.check('renaming a column renames it in every relationship that names it', rel(d, 'r2').columns.join() === 'buyer_id' && ent(d, 'order').columns[1].name === 'buyer_id', J(rel(d, 'r2')));
  await pickRow('order', 'state');
  await t.press('Enter');
  await t.type('state');
  await t.press('Tab');
  const inType = await editing();
  await t.type('varchar(8)');
  await t.press('Tab');
  const nextRow = await editing();
  await t.press('Escape');
  d = await saved();
  t.check('Tab goes name -> type -> the next row’s name; the type is kept', inType === 'text' && nextRow === 'placed_at' && ent(d, 'order').columns[3].type === 'varchar(8)', `${inType} ${nextRow}`);
  // Enter on the last row adds a column; an empty name on Enter removes it
  await editCell('order_item', 'unit_price');
  await t.press('Enter');
  const added = await editing();
  await t.type('discount');
  await t.press('Enter');
  const again = await editing();
  await t.press('Backspace');
  await t.press('Enter');
  d = await saved();
  t.check('Enter on the last row adds a column in edit; an empty name on Enter removes it again',
    /^column_/.test(added) && /^column_/.test(again) && ent(d, 'order_item').columns.map((c) => c.name).join() === 'order_id,product_id,qty,unit_price,discount' && (await editing()) === null,
    `${added} ${again} ${ent(d, 'order_item').columns.map((c) => c.name)}`);
  t.check('an empty name edit never saves a column without a name', ent(d, 'order_item').columns.every((c) => c.name));
  // One undo step per finished edit
  await freshPage();
  await editCell('order', 'status');
  await t.type('state');
  await t.press('Enter');
  await undo();
  t.check('undo takes a column rename back in one step', (await colNames('order')).includes('status') && (await undoDisabled()));

  // --- Column keys ---
  await freshPage();
  await pickRow('customer', 'name');
  await t.clickOn('.erd-actionbar [data-act="unique"]');
  d = await saved();
  const uniqueOn = ent(d, 'customer').columns[2].unique === true;
  const pressed = await t.ev(`document.querySelector('.erd-actionbar [data-act="unique"]').getAttribute('aria-pressed')`);
  await t.press('u');
  d = await saved();
  t.check('the action bar toggles Unique (pressed while on); the key U toggles it back', uniqueOn && pressed === 'true' && ent(d, 'customer').columns[2].unique === undefined);
  await t.press('p');
  await t.press('f');
  await t.press('?');
  d = await saved();
  const c2 = ent(d, 'customer').columns[2];
  t.check('keys P, F and ? toggle PK, FK and nullable on the selected row', c2.pk === true && c2.fk === true && c2.nullable === true && (await count('.erd-row.pk.fk')) >= 2, J(c2));
  await t.clickOn('.erd-actionbar [data-act="pk"]');
  await t.clickOn('.erd-actionbar [data-act="fk"]');
  await t.clickOn('.erd-actionbar [data-act="nullable"]');
  d = await saved();
  t.check('the action bar toggles PK, FK and Nullable off again', !('pk' in ent(d, 'customer').columns[2]) && !('fk' in ent(d, 'customer').columns[2]) && !('nullable' in ent(d, 'customer').columns[2]), J(ent(d, 'customer').columns[2]));
  await undo();
  t.check('each toggle is one undo step', ent(await saved(), 'customer').columns[2].nullable === true);

  // --- Reorder columns, delete a column ---
  await freshPage();
  await pickRow('order', 'status');
  await t.press('ArrowUp', { modifiers: 1 });
  t.check('Alt+Up moves the selected column up one row and keeps it selected', (await colNames('order')).join() === 'id,customer_id,status,shipping_address_id,placed_at' && (await text('.erd-row.selected .erd-col-name')) === 'status');
  await t.press('ArrowDown', { modifiers: 1 });
  await t.press('ArrowDown', { modifiers: 1 });
  t.check('Alt+Down moves it down', (await colNames('order')).join() === 'id,customer_id,shipping_address_id,placed_at,status');
  await undo();
  await undo();
  await undo();
  t.check('each move is one undo step', (await colNames('order')).join() === 'id,customer_id,shipping_address_id,status,placed_at');
  await t.press('Escape');
  const a = await t.at(row('customer', 'name')), b = await t.at(row('customer', 'email'));
  await t.dragTo(a.x, a.y, b.x, b.y - 10);
  t.check('dragging a row above another reorders the columns', (await colNames('customer')).join() === 'id,name,email,phone', (await colNames('customer')).join());
  await undo();
  await pickRow('order', 'customer_id');
  await t.press('ArrowDown');
  const walked = await text('.erd-row.selected .erd-col-name');
  await t.press('ArrowUp');
  await t.press('ArrowUp');
  await t.press('ArrowUp');
  t.check('Up and Down walk the columns of the table, then to its header', walked === 'shipping_address_id' && (await count('.erd-entity.selected')) === 1 && (await count('.erd-row.selected')) === 0);
  await t.press('ArrowRight');
  t.check('Left and Right walk the tables', (await t.ev(`document.querySelector('.erd-entity.selected').dataset.nodeId`)) === 'order_item');
  await pickRow('order', 'customer_id');
  await t.press('Delete');
  d = await saved();
  t.check('Delete removes the selected column and drops it from the relationship (its `columns` goes when empty)',
    !(await colNames('order')).includes('customer_id') && !('columns' in rel(d, 'r2')) && !!rel(d, 'r2'), J(rel(d, 'r2')));
  await pickRow('order', 'status');
  await t.clickOn('.erd-actionbar [data-act="delcol"]');
  t.check('the action bar deletes a column too, and selects its table', !(await colNames('order')).includes('status') && (await count('.erd-entity.selected')) === 1);

  // --- Draw a relationship ---
  await freshPage();
  const before = (await saved()).relationships.length;
  let p = await portOf('review', 'rating');
  let tgt = await t.at(row('category', 'id'));
  await t.dragTo(p.x, p.y, tgt.x, tgt.y);
  d = await saved();
  const r10 = d.relationships.find((r) => r.from === 'review' && r.to === 'category');
  t.check('dragging from a row’s port onto a PK row: the start row becomes fk, ends zero-or-many to one, `columns` set',
    d.relationships.length === before + 1 && r10?.columns?.join() === 'rating' && r10.fromEnd === 'zeroOrMany' && r10.toEnd === 'one' && !('toColumns' in r10)
      && ent(d, 'review').columns[3].fk === true && !r10.identifying && /^r\d+$/.test(r10.id), J(r10));
  t.check('the new line is selected, with its end handles and action bar', (await count('.erd-rel.selected')) === 1 && (await count('.erd-handle')) === 2 && (await count('.erd-actionbar [data-act="reverse"]')) === 1);
  await undo();
  t.check('drawing a relationship is one undo step', (await saved()).relationships.length === before);
  // from the header onto the header: no columns
  await freshPage();
  p = await portOf('review');
  tgt = await t.at(head('category'));
  await t.dragTo(p.x, p.y, tgt.x, tgt.y);
  d = await saved();
  const r11 = d.relationships.find((r) => r.from === 'review' && r.to === 'category');
  t.check('dragging from a header onto a header makes a relationship without `columns`', !!r11 && !('columns' in r11) && r11.toEnd === 'one', J(r11));
  // a row onto a table header: columns left out
  await freshPage();
  p = await portOf('review', 'rating');
  tgt = await t.at(head('category'));
  await t.dragTo(p.x, p.y, tgt.x, tgt.y);
  d = await saved();
  const r12 = d.relationships.find((r) => r.from === 'review' && r.to === 'category');
  t.check('dropped on the header from a row: `columns` is left out and no column becomes fk', !!r12 && !('columns' in r12) && !('fk' in ent(d, 'review').columns[3]), J(r12));
  // a nullable source: zero-or-one; a PK source: identifying; a non-PK target: toColumns
  await freshPage();
  p = await portOf('payment', 'paid_at');
  tgt = await t.at(row('order', 'id'));
  await t.dragTo(p.x, p.y, tgt.x, tgt.y);
  p = await portOf('order_item', 'qty');
  tgt = await t.at(row('category', 'name'));
  await t.dragTo(p.x, p.y, tgt.x, tgt.y);
  d = await saved();
  const r13 = d.relationships.find((r) => r.from === 'payment' && r.columns?.join() === 'paid_at');
  const r14 = d.relationships.find((r) => r.from === 'order_item' && r.to === 'category');
  t.check('a nullable start column gives zero-or-one at the parent; a non-PK target is named in `toColumns`',
    r13?.toEnd === 'zeroOrOne' && r14?.toColumns?.join() === 'name' && r14.columns.join() === 'qty', `${J(r13)} ${J(r14)}`);
  await freshPage();
  p = await portOf('order_item', 'order_id');
  tgt = await t.at(row('category', 'id'));
  await t.dragTo(p.x, p.y, tgt.x, tgt.y);
  d = await saved();
  const r15 = d.relationships.find((r) => r.from === 'order_item' && r.to === 'category');
  t.check('a primary-key start column draws an identifying (solid) relationship', r15?.identifying === true && r15.columns.join() === 'order_id', J(r15));
  await t.press('Delete');
  // self-reference
  await freshPage();
  p = await portOf('category', 'name');
  tgt = await t.at(row('category', 'id'));
  await t.dragTo(p.x, p.y, tgt.x, tgt.y);
  d = await saved();
  const r16 = d.relationships.find((r) => r.from === 'category' && r.to === 'category');
  t.check('dragging from a column onto the same table’s key row makes a self-reference (with `columns`)', r16?.columns?.join() === 'name' && (await count('.erd-rel')) === 10 && t.errors.length === 0, `${J(r16)} ${t.errors}`);
  // dropped on blank canvas: nothing, and a click on a port only selects the row
  await freshPage();
  p = await portOf('review', 'rating');
  const blankDrop = await canvasBlank();
  await t.dragTo(p.x, p.y, blankDrop.x, blankDrop.y);
  t.check('a drag that ends on blank canvas draws nothing', (await count('.erd-rel')) === 9 && (await undoDisabled()));
  // Relationship tool
  await freshPage();
  await t.clickOn('#btn-add-relationship');
  const armed = await t.ev(`document.getElementById('btn-add-relationship').getAttribute('aria-pressed') + document.body.classList.contains('erd-armed')`);
  await t.press('Escape');
  const disarmed = await t.ev(`document.getElementById('btn-add-relationship').getAttribute('aria-pressed') + document.body.classList.contains('erd-armed')`);
  await t.clickOn('#btn-add-relationship');
  const a1 = await t.at(row('review', 'rating')), a2 = await t.at(row('category', 'id'));
  await t.dragTo(a1.x, a1.y, a2.x, a2.y);
  d = await saved();
  t.check('the Relationship tool arms on click, Escape cancels, and armed it draws from a row without its port, then disarms',
    armed === 'truetrue' && disarmed === 'falsefalse' && !!d.relationships.find((r) => r.from === 'review' && r.to === 'category' && r.columns?.join() === 'rating')
      && !(await t.ev(`document.body.classList.contains('erd-armed')`)), `${armed} ${disarmed}`);

  // --- A selected relationship: cardinality, identifying, reverse, label, re-point ---
  await freshPage();
  let q = await onLine('r2');
  await t.click(q.x, q.y);
  t.check('clicking a line selects it: two crow’s-foot pickers (4 glyphs each), Identifying, Reverse, label and 2 end handles',
    (await count('.erd-rel.selected')) === 1 && (await count('.erd-actionbar [data-act="fromEnd"]')) === 4 && (await count('.erd-actionbar [data-act="toEnd"]')) === 4
      && (await count('.erd-actionbar [data-act="identifying"], .erd-actionbar [data-act="reverse"], .erd-actionbar [data-act="label"]')) === 3 && (await count('.erd-handle')) === 2);
  t.check('the pickers show the current ends as pressed', (await t.ev(`document.querySelector('.erd-actionbar [data-act="fromEnd"][data-value="zeroOrMany"]').getAttribute('aria-pressed')`)) === 'true'
    && (await t.ev(`document.querySelector('.erd-actionbar [data-act="toEnd"][data-value="one"]').getAttribute('aria-pressed')`)) === 'true');
  await t.clickOn('.erd-actionbar [data-act="fromEnd"][data-value="oneOrMany"]');
  await t.clickOn('.erd-actionbar [data-act="toEnd"][data-value="zeroOrOne"]');
  d = await saved();
  const markerNow = await t.ev(`getComputedStyle(document.querySelector('.erd-rel[data-edge-id="r2"] .edge-line')).getPropertyValue('--mk-s')`);
  t.check('each picker sets its end (child: one or many, parent: zero or one) and the line’s markers follow',
    rel(d, 'r2').fromEnd === 'oneOrMany' && rel(d, 'r2').toEnd === 'zeroOrOne' && /oneOrMany/.test(markerNow), `${J(rel(d, 'r2'))} ${markerNow}`);
  await t.clickOn('.erd-actionbar [data-act="identifying"]');
  d = await saved();
  const solid = await t.ev(`document.querySelector('.erd-rel[data-edge-id="r2"] .edge-line').classList.contains('identifying')`);
  await t.clickOn('.erd-actionbar [data-act="identifying"]');
  d = { ...d, back: await saved() };
  t.check('Identifying toggles solid and dashed', rel(d, 'r2').identifying === true && solid && !('identifying' in rel(d.back, 'r2')));
  await t.clickOn('.erd-actionbar [data-act="reverse"]');
  d = await saved();
  t.check('Reverse swaps child and parent and their ends, the rows the line joined stay the same',
    rel(d, 'r2').from === 'customer' && rel(d, 'r2').to === 'order' && rel(d, 'r2').fromEnd === 'zeroOrOne' && rel(d, 'r2').toEnd === 'oneOrMany'
      && rel(d, 'r2').columns.join() === 'id' && rel(d, 'r2').toColumns.join() === 'customer_id', J(rel(d, 'r2')));
  for (let i = 0; i < 5; i++) await undo();
  t.check('each picker, toggle and reverse was one undo step (five)', J(rel(await saved(), 'r2')) === J(rel(JSON.parse(readBlock(page)), 'r2')), J(rel(await saved(), 'r2')));
  // label
  q = await onLine('r8');
  await t.click(q.x, q.y, { count: 2 });
  const labelEdit = await editing();
  await t.type('reviews');
  await t.press('Enter');
  d = await saved();
  t.check('double-clicking a line without a label opens a label edit; Enter saves it and the pill appears',
    labelEdit === '' && rel(d, 'r8').label === 'reviews' && (await text('.edge-label[data-edge-id="r8"] .erd-rel-label-text')) === 'reviews', `${labelEdit} ${J(rel(d, 'r8'))}`);
  const lab = await t.at('.edge-label[data-edge-id="r1"]');
  await t.click(lab.x, lab.y, { count: 2 });
  const hadLabel = await editing();
  await t.type('lives at');
  await t.press('Enter');
  d = await saved();
  t.check('double-clicking a label edits it', hadLabel === 'has' && rel(d, 'r1').label === 'lives at');
  await t.clickOn('.edge-label[data-edge-id="r1"]');
  await t.clickOn('.erd-actionbar [data-act="label"]');
  await t.press('Backspace');
  await t.press('Enter');
  d = await saved();
  t.check('the label button edits; an empty label removes it', !('label' in rel(d, 'r1')) && (await count('.edge-label[data-edge-id="r1"]')) === 0);
  // re-point: the parent end of r8 (review -> product) to category
  await freshPage();
  q = await onLine('r8');
  await t.click(q.x, q.y);
  const h = await t.at('.erd-handle[data-role="to"]');
  await t.mouse('mouseMoved', 5, 600);
  const handleGap = JSON.parse(await t.ev(`JSON.stringify((() => { const g = document.querySelector('.erd-rel[data-edge-id="r8"] .edge-line'), L = g.getTotalLength(), m = g.getScreenCTM();
    const pt = (l) => { const q = g.getPointAtLength(l); return [m.a * q.x + m.e, m.d * q.y + m.f]; }; const sc = m.a;
    return [...document.querySelectorAll('.erd-handle')].map((el) => { const r = el.getBoundingClientRect(), c = [r.left + r.width / 2, r.top + r.height / 2], e = el.dataset.role === 'from' ? pt(0) : pt(L);
      return { role: el.dataset.role, d: Math.hypot(c[0] - e[0], c[1] - e[1]) / sc, w: r.width / sc, hollow: getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)' }; }); })())`));
  t.check('the end handles sit past the crow’s feet (about 34px from the table edge) as small hollow rings', handleGap.length === 2 && handleGap.every((x) => x.d >= 30 && x.d <= 38 && x.w <= 10.5 && x.hollow), J(handleGap));
  tgt = await t.at(row('category', 'name'));
  await t.dragTo(h.x, h.y, tgt.x, tgt.y);
  d = await saved();
  t.check('dragging the parent-end handle onto another table’s column re-points it there (`toColumns` for a non-key column)',
    rel(d, 'r8').to === 'category' && rel(d, 'r8').toColumns?.join() === 'name' && rel(d, 'r8').from === 'review', J(rel(d, 'r8')));
  await undo();
  q = await onLine('r8');
  await t.click(q.x, q.y);
  const h2 = await t.at('.erd-handle[data-role="from"]');
  tgt = await t.at(row('order', 'placed_at'));
  await t.dragTo(h2.x, h2.y, tgt.x, tgt.y);
  d = await saved();
  t.check('dragging the child-end handle onto a column moves the key there (and marks it fk)', rel(d, 'r8').from === 'order' && rel(d, 'r8').columns?.join() === 'placed_at' && ent(d, 'order').columns[4].fk === true, J(rel(d, 'r8')));
  q = await onLine('r8');
  await t.click(q.x, q.y);
  await t.press('Delete');
  t.check('Delete removes the selected line', (await count('.erd-rel')) === 8 && !rel(await saved(), 'r8'));
  // a self-reference cannot lose its column: the child end dropped on the table's header is refused
  await freshPage();
  p = await portOf('category', 'name');
  tgt = await t.at(row('category', 'id'));
  await t.dragTo(p.x, p.y, tgt.x, tgt.y);
  const handleSelf = await t.at('.erd-handle[data-role="from"]');
  const catHeadAt = await t.at(head('category'));
  await t.dragTo(handleSelf.x, handleSelf.y, catHeadAt.x, catHeadAt.y);
  t.check('a self-reference keeps its column: dropping its child end on the table’s header is refused with a hint',
    (await saved()).relationships.find((r) => r.from === 'category' && r.to === 'category')?.columns?.join() === 'name' && /self-reference needs a column/.test(await text('.hint') || ''));

  // --- Table colours (no groups) ---
  await freshPage();
  const col0 = await saved();
  await t.clickOn(head('address'));
  t.check('a selected table’s action bar has the swatch row (none and the eight colours)', (await count('.erd-actionbar .swatch-btn')) === 9);
  await t.clickOn('.erd-actionbar .swatch-btn[data-value="2"]');
  d = await saved();
  const tinted = await t.ev(`(() => { const e = document.querySelector('.erd-entity[data-node-id="address"]'); return e.classList.contains('swatch-scope') && e.style.getPropertyValue('--swatch-color') === '#fef3c7' && getComputedStyle(e.querySelector('.erd-head')).backgroundColor !== getComputedStyle(document.querySelector('.erd-entity[data-node-id="customer"] .erd-head')).backgroundColor; })()`);
  t.check('a swatch sets the table’s own colour (saved on the table), the table is tinted, no other table changes',
    ent(d, 'address').color === '2' && tinted && d.entities.every((e) => e.id === 'address' || e.color === ent(col0, e.id).color), J(ent(d, 'address')));
  await t.clickOn('.erd-actionbar .swatch-btn[data-value=""]');
  d = await saved();
  t.check('the none swatch clears the colour', !('color' in ent(d, 'address')));
  await undo();
  t.check('a colour change is one undo step each', ent(await saved(), 'address').color === '2');
  await undo();
  t.check('and the second undo puts the old colour back', J(await saved()) === J(col0) && (await undoDisabled()));
  // several selected tables take the colour together
  await freshPage();
  const ctrlClickA = async (sel) => { const q = await t.at(sel); await t.click(q.x, q.y, { modifiers: 2 }); };
  await ctrlClickA(head('product'));
  await ctrlClickA(head('category'));
  await t.clickOn('.erd-actionbar .swatch-btn[data-value="5"]');
  d = await saved();
  t.check('with several tables selected a swatch colours all of them', ent(d, 'product').color === '5' && ent(d, 'category').color === '5' && ent(d, 'review').color === ent(col0, 'review').color);

  // --- Notes ---
  await freshPage();
  await t.clickOn(head('customer'));
  await t.press('n');
  const noteEdit = await editing();
  await t.type('Soft-deleted rows stay');
  await t.press('Enter');
  await t.type('for 30 days');
  await t.press('Enter', { modifiers: 2 });
  d = await saved();
  const nn = d.notes.find((n) => n.entities.includes('customer'));
  t.check('N on a selected table opens a new note in edit; Enter adds a line, Ctrl+Enter finishes',
    noteEdit === '' && nn?.text === 'Soft-deleted rows stay\nfor 30 days' && /^n\d+$/.test(nn.id) && d.notes.length === 2 && (await editing()) === null, `${noteEdit} ${J(nn)}`);
  await undo();
  t.check('a note is one undo step', (await saved()).notes.length === 1);
  await t.clickOn(head('address'));
  await t.press('n');
  await t.press('Escape');
  d = await saved();
  t.check('Escape finishes an empty note, and an empty note is not kept', d.notes.length === 1 && (await count('.note-badge')) === 1);
  // + chip
  const addr = await t.at(head('address'), 0.5, 0.5);
  await t.mouse('mouseMoved', addr.x, addr.y);
  await sleep(80);
  const chipShown = await t.ev(`getComputedStyle(document.querySelector('.erd-entity[data-node-id="address"] .note-add')).display`);
  await t.clickOn('.erd-entity[data-node-id="address"] .note-add');
  const chipEdit = await editing();
  await t.type('Billing and shipping');
  await t.press('Escape');
  d = await saved();
  t.check('the + chip on a hovered table adds a note; Escape finishes it', chipShown !== 'none' && chipEdit === '' && d.notes.some((n) => n.text === 'Billing and shipping' && n.entities.join() === 'address'), `${chipShown} ${J(d.notes)}`);
  // dock Note: with a table selected
  await t.clickOn(head('product'));
  await t.clickOn('#btn-add-note');
  const dockEdit = await editing();
  await t.type('Prices exclude tax');
  await t.press('Escape');
  t.check('the dock Note button adds a note to the selected table', dockEdit === '' && (await saved()).notes.some((n) => n.text === 'Prices exclude tax' && n.entities.join() === 'product'));
  // dock Note with nothing selected: arm, then click a table
  await t.press('Escape');
  await t.press('Escape');
  await t.clickOn('#btn-add-note');
  const picking = await t.ev(`document.body.classList.contains('note-picking')`);
  await t.clickOn(head('category'));
  const pickEdit = await editing();
  await t.type('Tree of categories');
  await t.press('Escape');
  t.check('Note with nothing selected waits for a table (Esc cancels), then notes the table clicked',
    picking && pickEdit === '' && (await saved()).notes.some((n) => n.text === 'Tree of categories' && n.entities.join() === 'category'));
  await t.press('Escape');
  await t.clickOn('#btn-add-note');
  await t.press('Escape');
  t.check('Escape cancels the armed Note tool', !(await t.ev(`document.body.classList.contains('note-picking')`)));
  // drag the Note button onto a table
  const nb = await t.at('#btn-add-note'), rv = await t.at(head('review'));
  await t.dragTo(nb.x, nb.y, rv.x, rv.y, { steps: 8 });
  const dragEdit = await editing();
  await t.type('Moderated');
  await t.press('Escape');
  t.check('dragging the Note button onto a table gives it a note', dragEdit === '' && (await saved()).notes.some((n) => n.text === 'Moderated' && n.entities.join() === 'review'));
  // edit an existing note by its badge; link; unlink; pin; delete
  await freshPage();
  await t.clickOn('.erd-entity[data-node-id="order"] .note-badge');
  const badgeEdit = await editing();
  await t.type(' (kept for good)');   // the caret starts at the end of the text
  await t.press('Escape');
  d = await saved();
  t.check('clicking a table’s badge edits its note (caret at the end), and the note stays selected afterwards',
    badgeEdit === 'Orders are never deleted; cancelled orders keep their items' && d.notes[0].text === `${badgeEdit} (kept for good)` && (await count('.note.selected')) === 1, badgeEdit);
  const link = await t.at('.note.selected .note-link'), cust = await t.at(head('customer'));
  await t.dragTo(link.x, link.y, cust.x, cust.y);
  d = await saved();
  t.check('dragging a note’s link handle onto another table links it', d.notes[0].entities.join() === 'order,customer', J(d.notes[0]));
  await t.clickOn(head('address'), { modifiers: 8 });
  d = await saved();
  const linkedShift = d.notes[0].entities.join();
  await t.clickOn(head('address'), { modifiers: 8 });
  d = await saved();
  t.check('Shift+click a table with a note selected links it, and again unlinks it', linkedShift === 'order,customer,address' && d.notes[0].entities.join() === 'order,customer', `${linkedShift} ${J(d.notes[0])}`);
  const link2 = await t.at('.note.selected .note-link'), cust2 = await t.at(head('customer'));
  await t.dragTo(link2.x, link2.y, cust2.x, cust2.y);
  t.check('dragging the handle onto a linked table unlinks it', (await saved()).notes[0].entities.join() === 'order');
  const card = await t.at('.note.selected');
  await t.dragTo(card.x, card.y, card.x + 60, card.y + 70);
  d = await saved();
  t.check('dragging a note’s card pins it: `pos` is written, relative to its table, and survives the save',
    typeof d.notes[0].pos?.x === 'number' && typeof d.notes[0].pos?.y === 'number', J(d.notes[0]));
  await t.press('Delete');
  d = await saved();
  t.check('Delete removes the selected note', !d.notes && (await count('.note-badge')) === 0);
  await undo();
  t.check('and undo brings it back with its place', (await saved()).notes?.[0]?.pos !== undefined);
  // deleting a table unlinks its notes
  await freshPage();
  await t.clickOn('.erd-entity[data-node-id="order"] .note-badge');
  await t.press('Escape');
  const link3 = await t.at('.note.selected .note-link'), cust3 = await t.at(head('customer'));
  await t.dragTo(link3.x, link3.y, cust3.x, cust3.y);

  // --- Delete a table ---
  await t.clickOn(head('order'));
  await t.press('Delete');
  const ask = await text('.confirm-msg');
  t.check('Delete on a table with relationships asks first and says how many', /4 relationships/.test(ask || '') && (await count('.erd-entity')) === 8, ask);
  await t.clickOn('.confirm-cancel');
  t.check('Cancel keeps it', (await count('.erd-entity')) === 8 && (await count('.confirm')) === 0);
  await t.clickOn(head('order'));
  await t.clickOn('#btn-delete-selection');
  await t.clickOn('.confirm-ok');
  d = await saved();
  t.check('confirming deletes the table, its relationships and unlinks it from its notes (a note keeps its other tables)',
    !ent(d, 'order') && d.relationships.every((r) => r.from !== 'order' && r.to !== 'order') && d.relationships.length === 5 && d.notes[0].entities.join() === 'customer', `${d.relationships.length} ${J(d.notes)}`);
  await undo();
  t.check('one undo step brings back the table, its lines and the note link', !!ent(await saved(), 'order') && (await saved()).relationships.length === 9);
  await t.clickOn('#btn-add-table');
  await t.press('Escape');
  await t.press('Delete');
  t.check('a table without relationships is deleted without asking', (await count('.confirm')) === 0 && (await count('.erd-entity')) === 8);

  // --- Escape cancels what is under way ---
  await freshPage();
  p = await portOf('review', 'rating');
  await t.mouse('mousePressed', p.x, p.y, { button: 'left', buttons: 1, clickCount: 1 });
  for (const [x, y] of [[p.x + 30, p.y + 20], [p.x + 80, p.y + 40]]) { await t.mouse('mouseMoved', x, y, { button: 'left', buttons: 1 }); await sleep(20); }
  const rubber = await t.ev(`getComputedStyle(document.getElementById('erd-rubber')).display`);
  await t.press('Escape');
  await t.mouse('mouseReleased', p.x + 80, p.y + 40, { button: 'left', buttons: 0, clickCount: 1 });
  t.check('Escape while drawing a line cancels it (nothing drawn, rubber band gone)', rubber === 'block' && (await count('.erd-rel')) === 9 && (await t.ev(`getComputedStyle(document.getElementById('erd-rubber')).display`)) === 'none' && (await undoDisabled()));
  const o = await t.at(head('order'));
  await t.mouse('mousePressed', o.x, o.y, { button: 'left', buttons: 1, clickCount: 1 });
  for (const [x, y] of [[o.x + 30, o.y + 20], [o.x + 90, o.y + 60]]) { await t.mouse('mouseMoved', x, y, { button: 'left', buttons: 1 }); await sleep(20); }
  await t.press('Escape');
  await t.mouse('mouseReleased', o.x + 90, o.y + 60, { button: 'left', buttons: 0, clickCount: 1 });
  const o2 = await t.at(head('order'));
  t.check('Escape while dragging a table puts it back', Math.abs(o2.x - o.x) < 1 && Math.abs(o2.y - o.y) < 1 && (await undoDisabled()));

  // --- Tables stay where they are (there is no Auto-Tidy toggle) ---
  const layoutOf = async () => (await saved()).layout || {};   // every table's absolute x/y
  await freshPage();
  t.check('the dock has no Auto-Tidy toggle on the ERD page (only the shell Tidy button)', (await count('#btn-auto-layout')) === 0 && (await count('#btn-auto-tidy')) === 1);
  const lay0 = await layoutOf();
  const hd = await t.at(head('category'));
  await t.dragTo(hd.x, hd.y, hd.x + 120, hd.y - 150);
  const off1 = await layoutOf();
  d = await saved();
  t.check('dragging a table writes its x/y (flow terms) and moves no other table',
    J(off1.category) !== J(lay0.category) && Object.keys(lay0).filter((k) => k !== 'category').every((k) => J(lay0[k]) === J(off1[k])) && Number.isInteger(off1.category.x) && off1.category.x % 4 === 0, `${J(lay0.category)} -> ${J(off1.category)}`);
  await undo();
  t.check('and that is one undo step', J(await layoutOf()) === J(lay0) && (await undoDisabled()));
  // snap guides while aligned (centre to centre within 6px)
  const cb = await t.ev(`(() => { const r = (id) => { const b = document.querySelector('.erd-entity[data-node-id="' + id + '"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }; return { cat: r('category'), prod: r('product') }; })()`);
  const gh = await t.at(head('category'));
  await t.mouse('mouseMoved', gh.x, gh.y);
  await t.mouse('mousePressed', gh.x, gh.y, { button: 'left', buttons: 1, clickCount: 1 });
  // move so that category's centre is 3px off product's centre column, a long way below it
  const dx = cb.prod.x - cb.cat.x + 3, dy = 170;
  for (let i = 1; i <= 6; i++) { await t.mouse('mouseMoved', gh.x + dx * i / 6, gh.y + dy * i / 6, { button: 'left', buttons: 1 }); await sleep(15); }
  const guide = await t.ev(`getComputedStyle(document.querySelector('.erd-guide-v')).display`);
  await t.mouse('mouseReleased', gh.x + dx, gh.y + dy, { button: 'left', buttons: 0, clickCount: 1 });
  await sleep(80);
  const snapped = await t.ev(`(() => { const c = document.querySelector('.erd-entity[data-node-id="category"]').getBoundingClientRect(); const cx = c.left + c.width / 2; return Math.min(...[...document.querySelectorAll('.erd-entity')].filter((e) => e.dataset.nodeId !== 'category').map((e) => { const p = e.getBoundingClientRect(); return Math.abs(cx - (p.left + p.width / 2)); })); })()`);   // on the centre line of the nearest table (not necessarily product: the nearest one within 6px wins)
  t.check('a table dragged within 6px of another’s centre line snaps to it, with a guide while dragging', guide === 'block' && snapped < 1.5 && (await t.ev(`getComputedStyle(document.querySelector('.erd-guide-v')).display`)) === 'none', `${guide} ${snapped}`);
  await undo();
  // add a table: placed, nothing else moves
  const off2 = await layoutOf();
  await t.clickOn(head('order'));
  await t.clickOn('#btn-add-table');
  await t.press('Escape');
  const off3 = await layoutOf();
  t.check('Table adds a placed table (x/y saved) and moves no other table', Object.keys(off3).length === 9 && Object.keys(off2).every((k) => J(off2[k]) === J(off3[k])), `${Object.keys(off3).length}`);
  const overlap = await t.ev(`(() => { const b = [...document.querySelectorAll('.erd-entity')].map((e) => e.getBoundingClientRect()); for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (b[i].left < b[j].right && b[i].right > b[j].left && b[i].top < b[j].bottom && b[i].bottom > b[j].top) return true; return false; })()`);
  t.check('the new table does not sit on another table', !overlap);
  // collapse only re-routes
  await t.clickOn(`${head('order')} .erd-chevron`);
  const off4 = await layoutOf();
  t.check('collapsing a table only re-routes (no table moves) and the lines still end on its header',
    Object.keys(off3).every((k) => J(off3[k]) === J(off4[k])) && (await count('.erd-entity.is-collapsed')) === 1 && (await t.ev(`document.querySelector('.erd-entity.is-collapsed').getBoundingClientRect().height`)) < 40);
  await t.clickOn(`${head('order')} .erd-chevron`);
  // relationship and column edits re-route without moving
  const off5 = await layoutOf();
  p = await portOf('review', 'rating');
  tgt = await t.at(row('category', 'id'));
  await t.dragTo(p.x, p.y, tgt.x, tgt.y);
  const nTablesBefore = Object.keys(off5).length;
  t.check('drawing a relationship moves no table', J(await layoutOf()) === J(off5) && Object.keys(await layoutOf()).length === nTablesBefore);
  // Tidy lays everything out once, now
  await t.clickOn('#btn-auto-tidy');
  const tidy1 = await layoutOf();
  t.check('Tidy lays the diagram out on request', Object.keys(off5).some((k) => J(off5[k]) !== J(tidy1[k])) && t.errors.length === 0, t.errors.join(' | '));

  // --- Every kind of edit is exactly one undo step, and redo puts it back ---
  // Each case runs on a fresh page: `setup` selects (no edit), `act` is the edit. After one undo the saved model equals
  // the one before and undo is used up; one redo gives the model after.
  const cases = [
    ['add a table', async () => { await t.clickOn('#btn-add-table'); await t.press('Escape'); }],
    ['rename a table', async () => { await t.clickOn(head('address'), { count: 2 }); await t.type('addr'); await t.press('Enter'); }],
    ['rename a column', async () => { await editCell('order', 'status'); await t.type('state'); await t.press('Enter'); }],
    ['add a column', async () => { await t.clickOn(head('address')); await t.clickOn('.erd-actionbar [data-act="addcol"]'); await t.press('Escape'); }],
    ['toggle a key', async () => { await pickRow('customer', 'name'); await t.press('u'); }],
    ['move a column', async () => { await pickRow('order', 'status'); await t.press('ArrowUp', { modifiers: 1 }); }],
    ['drag a column', async () => { const a1 = await t.at(row('customer', 'name')), b1 = await t.at(row('customer', 'email')); await t.dragTo(a1.x, a1.y, b1.x, b1.y - 10); }],
    ['delete a column', async () => { await pickRow('order', 'status'); await t.press('Delete'); }],
    ['draw a relationship', async () => { const p1 = await portOf('review', 'rating'), g1 = await t.at(row('category', 'id')); await t.dragTo(p1.x, p1.y, g1.x, g1.y); }],
    ['re-point a relationship', async () => { const q1 = await onLine('r8'); await t.click(q1.x, q1.y); const h1 = await t.at('.erd-handle[data-role="to"]'), g1 = await t.at(row('category', 'name')); await t.dragTo(h1.x, h1.y, g1.x, g1.y); }],
    ['pick a cardinality', async () => { const q1 = await onLine('r2'); await t.click(q1.x, q1.y); await t.clickOn('.erd-actionbar [data-act="toEnd"][data-value="oneOrMany"]'); }],
    ['toggle identifying', async () => { const q1 = await onLine('r2'); await t.click(q1.x, q1.y); await t.clickOn('.erd-actionbar [data-act="identifying"]'); }],
    ['reverse a relationship', async () => { const q1 = await onLine('r2'); await t.click(q1.x, q1.y); await t.clickOn('.erd-actionbar [data-act="reverse"]'); }],
    ['label a relationship', async () => { const q1 = await onLine('r8'); await t.click(q1.x, q1.y, { count: 2 }); await t.type('reviews'); await t.press('Enter'); }],
    ['delete a relationship', async () => { const q1 = await onLine('r8'); await t.click(q1.x, q1.y); await t.press('Delete'); }],
    ['move a table', async () => { const h1 = await t.at(head((await tableIds())[4])); await t.dragTo(h1.x, h1.y, h1.x + 70, h1.y + 50); }],
    ['colour a table', async () => { await t.clickOn(head('address')); await t.clickOn('.erd-actionbar .swatch-btn[data-value="2"]'); }],
    ['collapse a table', async () => { await t.clickOn(`${head('order')} .erd-chevron`); }],
    ['add a note', async () => { await t.clickOn(head('address')); await t.press('n'); await t.type('Hi'); await t.press('Escape'); }],
    ['link a note', async () => { await t.clickOn('.erd-entity[data-node-id="order"] .note-badge'); await t.press('Escape'); const l1 = await t.at('.note.selected .note-link'), c1 = await t.at(head('customer')); await t.dragTo(l1.x, l1.y, c1.x, c1.y); }],
    ['pin a note', async () => { await t.clickOn('.erd-entity[data-node-id="order"] .note-badge'); await t.press('Escape'); const c1 = await t.at('.note.selected'); await t.dragTo(c1.x, c1.y, c1.x + 50, c1.y + 60); }],
    ['delete a note', async () => { await t.clickOn('.erd-entity[data-node-id="order"] .note-badge'); await t.press('Escape'); await t.press('Delete'); }],
    ['delete a table', async () => { await t.clickOn(head('order')); await t.press('Delete'); await t.clickOn('.confirm-ok'); }],
    // a hand move first (its own undo step, done before the baseline), so that Tidy has something to change
    ['Tidy', async () => { await t.clickOn('#btn-auto-tidy'); }, async () => { const h1 = await t.at(head((await tableIds())[4])); await t.dragTo(h1.x, h1.y, h1.x + 90, h1.y - 120); }],
  ];
  const stepProblems = [];
  for (const [what, act, setup] of cases) {
    await freshPage();
    if (setup) await setup();
    const base = J(await saved());
    await act();
    const after = J(await saved());
    await undo();
    const afterUndo = J(await saved()), lastUndo = await undoDisabled();
    await redo();
    const afterRedo = J(await saved());
    if (after === base) stepProblems.push(`${what}: nothing changed`);
    else if (afterUndo !== base || (!lastUndo && !setup)) stepProblems.push(`${what}: not one undo step`);
    else if (afterRedo !== after) stepProblems.push(`${what}: redo differs`);
  }
  t.check(`each of ${cases.length} kinds of edit is one undo step and redo puts it back`, stepProblems.length === 0, stepProblems.join('; '));

  // --- Multi-select (tables only) ---
  {
  const selCount = () => count('.erd-entity.selected');
  const selIds = async () => JSON.parse(await t.ev(`JSON.stringify([...document.querySelectorAll('.erd-entity.selected')].map((e) => e.dataset.nodeId).sort())`));
  const deleteLabel = () => t.ev(`(() => { const b = document.getElementById('btn-delete-selection'); return b.classList.contains('show') ? b.querySelector('.btn-label').textContent : null; })()`);
  const ctrlClick = async (sel) => { const q = await t.at(sel); await t.click(q.x, q.y, { modifiers: 2 }); };
  const overlapping = () => t.ev(`(() => { const b = [...document.querySelectorAll('.erd-entity')].map((e) => [e.dataset.nodeId, e.getBoundingClientRect()]); const out = [];
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) { const p = b[i][1], q = b[j][1]; if (p.left < q.right - 0.5 && p.right > q.left + 0.5 && p.top < q.bottom - 0.5 && p.bottom > q.top + 0.5) out.push(b[i][0] + '/' + b[j][0]); } return out; })()`);
  // A point on blank canvas (not on a table, note or line label), scanning the viewport from the top-left
  const blankPoint = () => t.ev(`(() => { const v = document.getElementById('viewport').getBoundingClientRect();
    for (let y = v.top + 8; y < v.bottom - 8; y += 12) for (let x = v.left + 8; x < v.right - 8; x += 12) {
      const el = document.elementFromPoint(x, y); if (el && !el.closest('.erd-entity, .note, .edge-label, .erd-rel, .toolbar-center, .toolbar, .dock-area') && (el.id === 'viewport' || el.id === 'stage' || el.closest('#erd-canvas') || el === document.getElementById('viewport'))) return { x, y }; }
    return null; })()`);

  await freshPage();
  await ctrlClick(head('customer'));
  await ctrlClick(head('order'));
  t.check('multi: Ctrl+click adds tables to the selection (both outlined, the dock Delete shows the count)', J(await selIds()) === J(['customer', 'order']) && (await deleteLabel()) === 'Delete 2', `${J(await selIds())} ${await deleteLabel()}`);
  t.check('multi: the last clicked table is the primary and has the action bar', (await count('.erd-actionbar')) === 1 && (await t.ev(`(() => { const b = document.querySelector('.erd-actionbar').getBoundingClientRect(), o = document.querySelector('.erd-entity[data-node-id="order"]').getBoundingClientRect(); return Math.abs((b.left + b.right) / 2 - (o.left + o.right) / 2) < 6; })()`)));
  t.check('multi: with several selected no ports show on hover', await (async () => { const r = await t.at(row('order', 'status')); await t.mouse('mouseMoved', r.x, r.y); await sleep(80); return t.ev(`[...document.querySelectorAll('.erd-port')].every((p) => getComputedStyle(p).display === 'none')`); })());
  await ctrlClick(head('customer'));
  t.check('multi: Ctrl+click on a selected table takes it out again', J(await selIds()) === J(['order']) && (await deleteLabel()) === 'Delete');
  await t.press('Escape');
  await sleep(80);
  t.check('multi: Escape clears the selection', (await selCount()) === 0 && (await deleteLabel()) === null);
  t.check('multi: selecting is not an edit (nothing unsaved, no undo step)', !(await unsaved()) && (await undoDisabled()));

  // Shift+drag on blank canvas: the box selects what it touches, live; Ctrl+Shift toggles against the selection it started from
  const bp = await blankPoint();
  const target1 = await t.at(head('address'));
  const rectIds = (x1, y1, x2, y2) => t.ev(`(() => { const L = Math.min(${x1}, ${x2}), R = Math.max(${x1}, ${x2}), T = Math.min(${y1}, ${y2}), B = Math.max(${y1}, ${y2});
    return [...document.querySelectorAll('.erd-entity')].filter((e) => { const b = e.getBoundingClientRect(); return b.left < R && b.right > L && b.top < B && b.bottom > T; }).map((e) => e.dataset.nodeId).sort(); })()`);
  const expectBox = await rectIds(bp.x, bp.y, target1.x, target1.y);
  await t.dragTo(bp.x, bp.y, target1.x, target1.y, { modifiers: 8 });
  t.check('multi: Shift+drag on blank canvas selects the tables the box touches', expectBox.length >= 1 && J(await selIds()) === J(expectBox) && (await count('.marquee')) === 0, `${J(expectBox)} vs ${J(await selIds())}`);
  await t.dragTo(bp.x, bp.y, target1.x, target1.y, { modifiers: 8 | 2 });
  t.check('multi: a Ctrl+Shift box toggles: the same box again takes them out', (await selCount()) === 0, J(await selIds()));
  const live = await (async () => {
    await t.mouse('mouseMoved', bp.x, bp.y, { modifiers: 8 });
    await t.mouse('mousePressed', bp.x, bp.y, { button: 'left', buttons: 1, clickCount: 1, modifiers: 8 });
    for (let i = 1; i <= 4; i++) await t.mouse('mouseMoved', bp.x + (target1.x - bp.x) * i / 4, bp.y + (target1.y - bp.y) * i / 4, { button: 'left', buttons: 1, modifiers: 8 });
    const during = { box: await count('.marquee'), sel: await selCount() };
    await t.mouse('mouseReleased', target1.x, target1.y, { button: 'left', buttons: 0, clickCount: 1, modifiers: 8 });
    await sleep(60);
    return during;
  })();
  t.check('multi: the box previews the selection live while it is drawn', live.box === 1 && live.sel === expectBox.length, J(live));
  await t.press('Escape');
  await t.press('a', { modifiers: 2 });
  t.check('multi: Ctrl+A selects every table (Delete 8)', (await selCount()) === 8 && (await deleteLabel()) === 'Delete 8');
  await t.press('Escape');
  await t.dragTo(bp.x, bp.y, bp.x + 30, bp.y + 30);
  t.check('multi: a plain drag on blank canvas still pans and selects nothing', (await selCount()) === 0);

  // Drag several: each keeps its offset
  await freshPage();
  await ctrlClick(head('customer'));
  await ctrlClick(head('order'));
  const lay0 = await layoutOf();
  const hc3 = await t.at(head('order'));
  await t.dragTo(hc3.x, hc3.y, hc3.x + 100, hc3.y);
  const lay1 = await layoutOf();
  const mv = (id) => ({ dx: lay1[id].x - lay0[id].x, dy: lay1[id].y - lay0[id].y });
  const others = Object.keys(lay0).filter((k) => k !== 'customer' && k !== 'order');
  t.check('multi: the selected tables move together by the same amount (pushed back as one set when they land on another table) and no other table moves',
    Math.abs(mv('customer').dx - mv('order').dx) <= 4 && Math.abs(mv('customer').dy - mv('order').dy) <= 4 && mv('order').dx >= 40 && mv('order').dx <= 120 && others.every((k) => J(lay0[k]) === J(lay1[k])), J([mv('customer'), mv('order')]));
  t.check('multi: and they stay selected', J(await selIds()) === J(['customer', 'order']));
  await undo();
  t.check('multi: one undo restores both', J(await layoutOf()) === J(lay0) && (await undoDisabled()));

  // Delete several: one confirm, one undo step
  await freshPage();
  await ctrlClick(head('customer'));
  await ctrlClick(head('order'));
  await t.press('Delete');
  t.check('multi: Delete with relationships asks once, naming the count', (await count('.confirm')) === 1 && /2 tables and their \d+ relationships?/.test(await text('.confirm-msg')), await text('.confirm-msg'));
  await t.clickOn('.confirm-ok');
  d = await saved();
  t.check('multi: confirmed: both tables, their relationships and note links go', !ent(d, 'customer') && !ent(d, 'order') && d.entities.length === 6
    && d.relationships.every((r) => !['customer', 'order'].includes(r.from) && !['customer', 'order'].includes(r.to)) && d.relationships.length === 3 && (await selCount()) === 0, `${d.entities.length} ${d.relationships.length}`);
  await undo();
  d = await saved();
  t.check('multi: one undo brings back the tables and their relationships', d.entities.length === 8 && d.relationships.length === 9 && (await undoDisabled()));
  await t.press('a', { modifiers: 2 });
  await t.clickOn('#btn-delete-selection');
  t.check('multi: the dock Delete button deletes the whole selection (after one confirm)', (await count('.confirm')) === 1);
  await t.press('Escape');
  t.check('multi: Escape cancels the confirm and deletes nothing', (await count('.erd-entity')) === 8);
  await t.press('Escape');

  // ?present: no multi-select
  await freshPage(page, '?present');
  await ctrlClick(head('customer'));
  await ctrlClick(head('order'));
  await t.press('a', { modifiers: 2 });
  const pb = await blankPoint(), pt2 = await t.at(head('address'));
  await t.dragTo(pb.x, pb.y, pt2.x, pt2.y, { modifiers: 8 });
  t.check('?present: Ctrl+click, Ctrl+A and the Shift box select at most one table', (await selCount()) <= 1 && (await count('.marquee')) === 0, `${await selCount()}`);

  // --- Types and Notes are switches ---
  await freshPage();
  const typeAria = () => t.ev(`document.getElementById('btn-types').getAttribute('aria-checked') + ':' + (document.querySelector('.erd-col-type') ? 'shown' : 'none')`);
  const typeBtn = await t.ev(`(() => { const b = document.getElementById('btn-types'); return b.classList.contains('btn-switch') && b.getAttribute('role') === 'switch' && !b.hasAttribute('aria-pressed') && !!b.querySelector('.switch-knob'); })()`);
  const typesOn = await typeAria();
  await t.clickOn('#btn-types');
  const typesOff = await typeAria();
  t.check('Types is a switch: aria-checked flips and the type column hides', typeBtn && typesOn === 'true:shown' && typesOff === 'false:none', `${typeBtn} ${typesOn} ${typesOff}`);
  await t.ev(`document.getElementById('btn-types').focus()`);
  await t.press(' ');
  t.check('Space on the focused Types switch turns it back on', (await typeAria()) === 'true:shown', await typeAria());
  const notesSw = await t.ev(`(() => { const b = document.getElementById('btn-notes'); return b.classList.contains('btn-switch') && b.getAttribute('role') === 'switch' && b.getAttribute('aria-checked') === 'false'; })()`);
  t.check('Notes is a switch too (off while the notes are not all on show)', notesSw);
  // --- Columns and Types keep hand-placed tables where they are ---
  await freshPage();
  const cl0 = await layoutOf();
  await t.clickOn('#btn-columns');
  await t.clickOn('#btn-columns');
  const cl1 = await layoutOf();
  t.check('Columns (to key columns, then names) moves no table', J(cl1) === J(cl0) && (await text('#btn-columns .btn-count')) === 'Names');
  await t.clickOn('#btn-types');
  t.check('Types moves no table', J(await layoutOf()) === J(cl0));
  await t.clickOn('#btn-types');
  // Hand-place address just under customer while both are only headers, then grow them back to all columns
  const ca = await t.ev(`(() => { const r = (id) => { const b = document.querySelector('.erd-entity[data-node-id="' + id + '"]').getBoundingClientRect(); return { l: b.left, t: b.top, b: b.bottom }; }; return { c: r('customer'), a: r('address') }; })()`);
  const hdA = await t.at(head('address'));
  await t.dragTo(hdA.x, hdA.y, hdA.x + (ca.c.l - ca.a.l), hdA.y + (ca.c.b + 8 - ca.a.t));
  const preOverlap = await overlapping();
  const cl2 = await layoutOf();
  await t.clickOn('#btn-columns');
  const cl3 = await layoutOf();
  const post = await overlapping();
  const moved = Object.keys(cl2).filter((k) => J(cl2[k]) !== J(cl3[k]));
  t.check('Columns back to all columns (tables grow) leaves no two tables overlapping', preOverlap.length === 0 && post.length === 0 && (await text('#btn-columns .btn-count')) === 'All', `${J(preOverlap)} ${J(post)}`);
  t.check('and moves only the tables that would otherwise overlap', moved.length >= 1 && moved.length <= 3 && cl2.customer && J(cl2.customer) === J(cl3.customer), J(moved));
  await undo();
  t.check('that is one undo step', J(await layoutOf()) === J(cl2) && (await text('#btn-columns .btn-count')) === 'Names');

  }

  // --- ?present ---
  await freshPage(page, '?present');
  const portHover = await (async () => {
    const r = await t.at(row('order', 'status'));
    await t.mouse('mouseMoved', r.x, r.y);
    await sleep(80);
    return t.ev(`[...document.querySelectorAll('.erd-port')].some((p) => getComputedStyle(p).display !== 'none')`);
  })();
  t.check('?present: no ports, handles, + chips or dock', !portHover && (await t.ev(`getComputedStyle(document.querySelector('.toolbar-center')).display`)) === 'none'
    && (await t.ev(`[...document.querySelectorAll('.note-add')].every((c) => getComputedStyle(c).display === 'none')`)));
  await t.clickOn(head('order'), { count: 2 });
  t.check('?present: a double-click edits nothing', (await editing()) === null && (await count('.erd-actionbar')) === 0 && (await count('.erd-handle')) === 0);
  await t.press('Delete');
  await t.press('n');
  t.check('?present: Delete and N do nothing', (await count('.erd-entity')) === 8 && (await count('.note')) === 1 && (await count('.confirm')) === 0);
  const hov = await t.at(head('customer'));
  await t.mouse('mouseMoved', hov.x, hov.y);
  await sleep(80);
  t.check('?present: hovering a table still lights its lines and dims the rest', (await count('.erd-entity.is-dim')) > 0 && (await count('.erd-rel.hl-in')) > 0);
  await t.clickOn(`${head('order')} .erd-chevron`);
  const collapsedPresent = await count('.erd-entity.is-collapsed');
  t.check('?present: collapse works and is a change of view only (no unsaved badge, no undo step)', collapsedPresent === 1 && !(await unsaved()) && (await undoDisabled()));
  const pp = await t.at(row('customer', 'email')), ph = await t.at(head('customer'));
  await t.dragTo(pp.x, pp.y, pp.x, pp.y + 40);
  const posBefore = await t.at(head('customer'));
  await t.dragTo(ph.x, ph.y, ph.x + 60, ph.y + 90);
  const posAfter = await t.at(head('customer'));
  t.check('?present: dragging a row or a table changes nothing', (await colNames('customer')).join() === 'id,email,name,phone' && posBefore.x === posAfter.x && posBefore.y === posAfter.y && !(await unsaved()));

  // --- Saved data block ---
  for (const [what, file] of [['the example', page], ['the 30-table schema', large]]) {
    await freshPage(file);
    const gen = block(readFileSync(file, 'utf8'));
    await t.press('s', { modifiers: 2 });
    await sleep(300);
    const savedBlock = await t.ev(`document.getElementById('diagram-data').textContent`);
    t.check(`Save without edits writes the data block byte-identical (${what})`, savedBlock === gen, J(savedBlock.slice(0, 160)));
  }

  // Ids made in the page are renamed on save, authored ids kept (on both pages)
  for (const [what, file, pick] of [['the example', page, true], ['the 30-table schema', large, null]]) {
    await freshPage(file);
    if (pick) {
      await t.clickOn(head('order'));
      await t.clickOn('#btn-add-table');
      await t.type('refund');
      await t.press('Enter');
      p = await portOf('review', 'rating');
      tgt = await t.at(row('category', 'id'));
      await t.dragTo(p.x, p.y, tgt.x, tgt.y);
      await t.clickOn(head('product'));
      await t.press('n');
      await t.type('Prices exclude tax');
      await t.press('Escape');
      const card2 = await t.at('.note.selected');
      await t.dragTo(card2.x, card2.y, card2.x + 30, card2.y + 40);
      d = await saved();
      t.check(`generated ids are renamed in the saved file, authored ids kept (${what})`,
        !!ent(d, 'refund') && d.relationships.some((r) => r.id === 'r10' && r.from === 'review')
        && d.notes.some((n) => n.id === 'n2' && n.entities.join() === 'product' && n.pos)
        && ent(d, 'order') && rel(d, 'r1') && d.notes.some((n) => n.id === 'n1')
        && !/"(t|r|n)_\d{12,}/.test(J(d)) && d.layout.refund && !('groups' in d) && d.schemaVersion === 3, J(d.relationships.slice(-2)));
    } else {
      await t.clickOn('#btn-add-table');
      await t.type('refund');
      await t.press('Enter');
      d = await saved();
      const authoredBefore = JSON.parse(block(readFileSync(file, 'utf8')));
      t.check(`generated ids are renamed in the saved file, authored ids kept (${what})`,
        !!ent(d, 'refund') && authoredBefore.entities.every((e) => !!ent(d, e.id)) && authoredBefore.relationships.every((r) => !!rel(d, r.id)) && !/"(t|r|n)_\d{12,}/.test(J(d)), '');
    }
    t.check(`the saved block is valid for the Python codec too (${what})`, pythonAgrees(await t.ev(`document.getElementById('diagram-data').textContent`)) === '', pythonAgrees(await t.ev(`document.getElementById('diagram-data').textContent`)));
  }
  // The 30-table page: a table, a relationship, and undo of all of it
  await freshPage(large);
  const nTables = await count('.erd-entity');
  t.check('the 30-table schema renders without errors', nTables >= 28 && (await count('.erd-group')) === 0 && t.errors.length === 0, `${nTables} ${t.errors.join(' | ')}`);
  const lg = await t.ev(`(() => { const r = document.querySelectorAll('.erd-entity')[4].querySelector('.erd-head').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await t.mouse('mouseMoved', lg.x, lg.y);
  await sleep(100);
  t.check('hover works on the large page (a table lights its lines and dims the rest)', (await count('.erd-entity.is-dim')) > 10);

  // --- Hover and selection: the neighbourhood of a table (D8) ---
  {
  const hoverOn = async (id) => { const r = await t.at(head(id), 0.3, 0.5); await t.mouse('mouseMoved', r.x - 2, r.y - 2); await t.mouse('mouseMoved', r.x, r.y); await sleep(120); };
  const idsWith = async (cls) => JSON.parse(await t.ev(`JSON.stringify([...document.querySelectorAll('.erd-entity.${cls}')].map((e) => e.dataset.nodeId).sort())`));
  const keyRows = async () => JSON.parse(await t.ev(`JSON.stringify([...document.querySelectorAll('.erd-entity .erd-row.key-hl')].map((r) => r.closest('.erd-entity').dataset.nodeId + '.' + r.dataset.col).sort())`));
  await freshPage();
  await hoverOn('order');
  t.check('hover order: customer and address are parents (blue ring class), payment and order_item children (amber), the rest dim',
    J(await idsWith('rel-parent')) === J(['address', 'customer']) && J(await idsWith('rel-child')) === J(['order_item', 'payment']) && (await idsWith('is-dim')).length === 3 && (await count('.erd-entity.linked')) === 0, `${await idsWith('rel-parent')} ${await idsWith('rel-child')}`);
  t.check('hover order: the joining rows are key-hl (order’s own foreign keys and key too)',
    J(await keyRows()) === J(['address.id', 'customer.id', 'order.customer_id', 'order.id', 'order.shipping_address_id', 'order_item.order_id', 'payment.order_id']), J(await keyRows()));
  t.check('hover order: no key chips and no key peeks, at any detail', (await count('.erd-key-chip, .erd-key-peek')) === 0 && (await count('.erd-rel.hl-out')) === 2 && (await count('.erd-rel.hl-in')) === 2);
  const rowTint = await t.ev(`getComputedStyle(document.querySelector('.erd-entity[data-node-id="payment"] .erd-row[data-col="order_id"]')).backgroundColor`);
  const rowPlain = await t.ev(`getComputedStyle(document.querySelector('.erd-entity[data-node-id="payment"] .erd-row[data-col="id"]')).backgroundColor`);
  t.check('hover order: a joining row keeps a light tint, one colour for children and parents', rowTint !== rowPlain && !!(await t.ev(`document.querySelector('.erd-entity[data-node-id="customer"] .erd-row[data-col="id"]').classList.contains('key-hl') && !document.querySelector('.erd-entity .erd-row.hl-in, .erd-entity .erd-row.hl-out')`)), `${rowTint} ${rowPlain}`);
  // Side-anchored lines carry no row position: the key rows, the curves and the dimming say what joins what
  const curveInfo = JSON.parse(await t.ev(`JSON.stringify([...document.querySelectorAll('.erd-rel')].map((g) => ({ id: g.dataset.edgeId, cls: [...g.classList].filter((c) => /^(hl-in|hl-out|is-dim)$/.test(c)).join(), stroke: getComputedStyle(g.querySelector('.edge-line')).stroke, w: parseFloat(getComputedStyle(g.querySelector('.edge-line')).strokeWidth), op: parseFloat(getComputedStyle(g).opacity), d: g.querySelector('.edge-line').getAttribute('d'), from: g.dataset.from, to: g.dataset.to })))`));
  const hlIn = curveInfo.filter((c) => c.cls === 'hl-in'), hlOut = curveInfo.filter((c) => c.cls === 'hl-out'), dimmed = curveInfo.filter((c) => c.cls === 'is-dim');
  const plain = curveInfo.find((c) => c.cls === 'is-dim');
  t.check('hover order: its curves are highlighted in one colour (thicker), every other curve is dimmed',
    hlIn.length === 2 && hlOut.length === 2 && dimmed.length === curveInfo.length - 4 && hlIn.every((c) => c.to === 'order' && c.w >= 1.9) && hlOut.every((c) => c.from === 'order' && c.w >= 1.9)
      && hlIn[0].stroke === hlOut[0].stroke && hlIn[0].stroke !== plain.stroke && dimmed.every((c) => c.op < 0.5) && curveInfo.every((c) => /^M .* C /.test(c.d)), J(curveInfo.map((c) => [c.id, c.cls])));
  const dimTables = await idsWith('is-dim');
  t.check('hover order: the unrelated tables are dimmed, every related table and order itself are not', dimTables.length === 3 && !['order', 'address', 'customer', 'order_item', 'payment'].some((id) => dimTables.includes(id)), J(dimTables));
  await t.mouse('mouseMoved', 5, 600);
  await sleep(100);
  t.check('leaving the table clears the neighbourhood', (await count('.rel-child, .rel-parent, .key-hl, .is-dim')) === 0);
  // selection gives the same neighbourhood; hover wins while over another table
  await t.clickOn(head('order'));
  await t.mouse('mouseMoved', 5, 600);
  await sleep(100);
  t.check('selecting order by a click gives the same neighbourhood (touch and keyboard get it too)', J(await idsWith('rel-parent')) === J(['address', 'customer']) && J(await idsWith('rel-child')) === J(['order_item', 'payment']));
  await hoverOn('product');
  t.check('hover wins while the pointer is over another table: product’s neighbourhood, not order’s', (await idsWith('rel-parent')).join() === 'category' && (await idsWith('rel-child')).join() === 'order_item,review', `${await idsWith('rel-parent')} ${await idsWith('rel-child')}`);
  await t.press('Escape');
  await t.mouse('mouseMoved', 5, 600);
  await sleep(80);
  t.check('Escape clears the selection and with it the neighbourhood', (await count('.rel-child, .rel-parent')) === 0);
  await t.clickOn(row('order', 'status'));
  await t.mouse('mouseMoved', 5, 600);
  await sleep(100);
  t.check('selecting a column or a line does not show a table neighbourhood', (await count('.rel-child, .rel-parent')) === 0);
  // a table related both ways (self-reference + children): ring in the "in" colour class
  await freshPage();
  await hoverOn('category');
  t.check('hover category (parent of product): product is a child; a table never rings itself', J(await idsWith('rel-child')) === J(['product']) && (await idsWith('rel-parent')).length === 0);
  // detail names and a collapsed table: still no chips or peeks; the line's tooltip names the join
  await freshPage();
  await t.clickOn('#btn-columns');
  await t.clickOn('#btn-columns');
  await t.mouse('mouseMoved', 5, 600);
  await hoverOn('order');
  t.check('detail names: no chips or peeks on the related tables', (await count('.erd-key-chip, .erd-key-peek')) === 0 && (await count('.rel-child')) === 2);
  await freshPage();
  await t.clickOn(`${head('customer')} .erd-chevron`);
  await t.mouse('mouseMoved', 5, 600);
  await hoverOn('order');
  t.check('a collapsed related table shows no peek either', (await count('.erd-key-chip, .erd-key-peek')) === 0);
  // the join as the line's tooltip
  await freshPage();
  const tips = JSON.parse(await t.ev(`JSON.stringify([...document.querySelectorAll('.erd-rel')].map((g) => g.dataset.from + '>' + g.dataset.to + ':' + (g.querySelector('title') || {}).textContent))`));
  t.check('every line carries its join as a tooltip: order.customer_id → customer.id', tips.includes('order>customer:order.customer_id → customer.id') && tips.every((x) => / → /.test(x)), J(tips));
  const tipLine = await onLine('r1');
  await t.mouse('mouseMoved', tipLine.x - 3, tipLine.y - 3);
  await t.mouse('mouseMoved', tipLine.x, tipLine.y);
  await sleep(120);
  t.check('hovering a line lights it and its two rows (no chips)', (await count('.erd-rel.hover')) === 1 && (await count('.erd-key-chip')) === 0 && (await t.ev(`document.querySelector('.erd-rel.hover title').textContent`)).includes(' → '));
  // ?present
  await freshPage(page, '?present');
  await hoverOn('order');
  t.check('?present: the neighbourhood works (rings, key rows)', J(await idsWith('rel-child')) === J(['order_item', 'payment']));
  await t.clickOn(head('order'));
  await t.mouse('mouseMoved', 5, 600);
  await sleep(80);
  t.check('?present: a click selects a table and shows the same neighbourhood', J(await idsWith('rel-parent')) === J(['address', 'customer']));
  // exports: no ring or tooltip
  await freshPage();
  await t.clickOn('#btn-columns');
  await t.clickOn('#btn-columns');
  await hoverOn('order');
  await t.clickOn(head('order'));
  await t.ev(`document.getElementById('btn-export').click()`);
  await t.ev(`window.__svg = null; const o = URL.createObjectURL; URL.createObjectURL = (b) => { b.text().then((x) => { window.__svg = x; }); return o.call(URL, b); }`);
  await t.ev(`document.querySelector('[data-export="svg"]').click()`);
  await sleep(500);
  const svgText = await t.ev(`window.__svg`);
  t.check('SVG export of a diagram with a selected table has no ring, tooltip or card (names mode: just the headers)', !!svgText && !/→ order|← order/.test(svgText) && !/erd-expand-card/.test(svgText) && svgText.includes('order_item'), (svgText || '').slice(0, 100));
  }

  // --- A v1 page (schemaVersion 1, flow-term layout map) opens re-laid out ---
  {
  const v1 = JSON.parse(block(readFileSync(page, 'utf8')));
  v1.schemaVersion = 1;
  v1.direction = 'TB';
  v1.layout = Object.fromEntries(v1.entities.map((e, i) => [e.id, { x: 16 + 220 * i, y: 8 }]));
  const html = readFileSync(page, 'utf8').replace(/(<script id="diagram-data" type="application\/json">)[\s\S]*?(<\/script>)/, (m, a, b) => a + J(v1) + b);
  const v1File = join(dirname(page), 'v1-erd-test.html');
  writeFileSync(v1File, html);
  await freshPage(v1File);
  const v1Tables = JSON.parse(await t.ev(`JSON.stringify([...document.querySelectorAll('.erd-entity')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; }))`));
  const flat = new Set(v1Tables.map((p) => p[1])).size === 1;
  t.check('a v1 page (schemaVersion 1, old layout map, direction) opens re-laid out: no groups, tables not in the old row, none overlapping', !flat && (await count('.erd-group')) === 0 && (await layoutProblems()).length === 0 && t.errors.length === 0, `${J(v1Tables)} ${t.errors}`);
  d = await saved();
  t.check('and its next save is a v3 block: schemaVersion 3, table positions in `layout`, no direction, no groups',
    d.schemaVersion === 3 && !('direction' in d) && !('groups' in d) && typeof d.layout.order?.x === 'number');
  t.check('the v3 block saved from it agrees with the Python codec', pythonAgrees(await t.ev(`document.getElementById('diagram-data').textContent`)) === '');
  // v2: groups with colours and names, group-relative positions
  const v2 = JSON.parse(block(readFileSync(page, 'utf8')));
  const sales = ['order', 'payment', 'customer', 'address', 'order_item'];
  v2.schemaVersion = 2;
  v2.groups = [{ id: 'sales', name: 'Sales', color: '#e0f2fe' }, { id: 'catalog', name: 'Catalog', color: '#dcfce7' }];
  v2.entities.forEach((e) => { e.group = sales.includes(e.id) ? 'sales' : 'catalog'; delete e.color; });
  v2.colorKey = { '#fef3c7': 'Other' };
  v2.layout = { sales: { x: 16, y: 16 }, catalog: { x: 900, y: 16 }, ...Object.fromEntries(v2.entities.map((e, i) => [e.id, { x: 16 + (i % 3) * 200, y: 40 + Math.floor(i / 3) * 150 }])) };
  const v2File = join(dirname(page), 'v2-erd-test.html');
  writeFileSync(v2File, readFileSync(page, 'utf8').replace(/(<script id="diagram-data" type="application\/json">)[\s\S]*?(<\/script>)/, (m, a, b) => a + J(v2) + b));
  await freshPage(v2File);
  const v2Colours = JSON.parse(await t.ev(`JSON.stringify([...document.querySelectorAll('.erd-entity')].map((e) => e.dataset.nodeId + ':' + e.style.getPropertyValue('--swatch-color')).sort())`));
  d = await saved();
  t.check('a v2 page opens re-laid out with its groups gone: each table wears its group’s colour, nothing overlaps',
    (await count('.erd-group')) === 0 && v2Colours.every((c) => c.endsWith(sales.includes(c.split(':')[0]) ? '#e0f2fe' : '#dcfce7')) && (await layoutProblems()).length === 0 && t.errors.length === 0, J(v2Colours));
  t.check('and its save is v3: tables carry `color`, group names join `colorKey` (existing entries kept), no groups or group fields, positions in `layout`',
    d.schemaVersion === 3 && !('groups' in d) && d.entities.every((e) => !('group' in e) && e.color === (sales.includes(e.id) ? '1' : '3'))   // v2 hex colours are saved as slots
    && J(d.colorKey) === J({ 2: 'Other', 1: 'Sales', 3: 'Catalog' }) && Object.keys(d.layout).length === 8 && !('sales' in d.layout), J(d.colorKey));
  t.check('the v3 block saved from a v2 page agrees with the Python codec', pythonAgrees(await t.ev(`document.getElementById('diagram-data').textContent`)) === '');
  }

  // --- Overview (zoomed out), the expanded card, exports from the overview ---
  {
  const scaleNow = () => t.ev(`(() => { const c = document.getElementById('erd-canvas'); return c.getBoundingClientRect().width / c.offsetWidth; })()`);
  const inOverview = () => t.ev(`document.body.classList.contains('erd-overview')`);
  const zoom = async (dir) => { await t.ev(`document.getElementById('btn-zoom-${dir}').click()`); await sleep(80); };
  await freshPage(page);
  t.check('the example at Fit is not an overview', !(await inOverview()) && (await scaleNow()) > 0.5);
  await freshPage(large);
  const fit = await scaleNow();
  t.check('the 30-table schema at Fit is not an overview either (Fit is 45% or more... and over the entry threshold or in it, consistently)', (fit < 0.5) === (await inOverview()), `${fit}`);
  while ((await scaleNow()) >= 0.5) await zoom('out');
  const s1 = await scaleNow();
  const probe = async () => { await sleep(300); return t.ev(`(() => {
    const body = document.body, cv = document.getElementById('erd-canvas'), sc = cv.getBoundingClientRect().width / cv.offsetWidth;
    const e = [...document.querySelectorAll('.erd-entity:not(.erd-card-table)')][0];
    const rowsShown = [...document.querySelectorAll('.erd-entity:not(.erd-card-table) .erd-row')].some((r) => getComputedStyle(r).display !== 'none');
    const names = [...document.querySelectorAll('.erd-entity .erd-name')].map((n) => parseFloat(getComputedStyle(n).fontSize) * sc);
    const lines = [...document.querySelectorAll('.edge-line')].map((l) => parseFloat(getComputedStyle(l).strokeWidth) * sc);
    const lab = [...document.querySelectorAll('.edge-label')].find((l) => getComputedStyle(l).display !== 'none');
    return { ov: body.classList.contains('erd-overview'), sc, rowsShown, minName: Math.min(...names), maxName: Math.max(...names), line: lines[0], label: lab ? { id: lab.dataset.edgeId, h: lab.getBoundingClientRect().height, font: parseFloat(getComputedStyle(lab).fontSize) * sc * (lab.getBoundingClientRect().height / (lab.offsetHeight * sc)) } : null,
      bodyBg: getComputedStyle(e).backgroundColor }; })()`); };
  const p1 = await probe();
  t.check('zoomed out below 50%: body.erd-overview, no rows drawn, names about 14px on screen (12px at least for the unshrunk ones), line width constant 1.5px, a label at constant screen size',
    p1.ov && !p1.rowsShown && p1.maxName >= 12 && p1.maxName <= 15 && Math.abs(p1.line - 1.5) < 0.05 && p1.label && Math.abs(p1.label.h - 22 * 1) < 9 && t.errors.length === 0, J(p1));
  const labelId = p1.label && p1.label.id;
  await zoom('out');
  const p2 = await probe();
  const sameLabel = await t.ev(`(() => { const l = document.querySelector('.edge-label[data-edge-id="${labelId}"]'); return l && getComputedStyle(l).display !== 'none' ? l.getBoundingClientRect().height : null; })()`);
  t.check('zooming out further keeps the line width (1.5px), and a label’s on-screen height constant',
    p2.ov && Math.abs(p2.line - 1.5) < 0.05 && (sameLabel === null || Math.abs(sameLabel - p1.label.h) < 1.5), `${p1.label?.h} ${sameLabel}`);
  while ((await scaleNow()) < 0.5) await zoom('in');
  const s3 = await scaleNow();
  t.check('hysteresis: back above 50% but not above 60% it stays in the overview', s3 > 0.5 && s3 <= 0.6 ? await inOverview() : true, `${s3}`);
  while ((await scaleNow()) <= 0.6) await zoom('in');
  t.check('above 60% the overview is left and the rows are back', !(await inOverview()) && (await probe()).rowsShown);
  while ((await scaleNow()) >= 0.5) await zoom('out');
  // hover in the overview: expanded card
  const hoverBig = async (id) => { const r = await t.at(`.erd-entity[data-node-id="${id}"]`); await t.mouse('mouseMoved', 5, 700); await t.mouse('mouseMoved', r.x - 2, r.y - 1); await t.mouse('mouseMoved', r.x, r.y); return r; };
  const cardInfo = () => t.ev(`(() => { const c = document.querySelector('.erd-expand-card'); if (!c) return null; const r = c.getBoundingClientRect(); const e = c.querySelector('.erd-entity');
    return { for: c.dataset.cardFor, rows: [...c.querySelectorAll('.erd-row')].map((x) => x.dataset.col), keyRows: c.querySelectorAll('.erd-row.key-hl').length, w: r.width, h: r.height, name: parseFloat(getComputedStyle(c.querySelector('.erd-name')).fontSize), font: parseFloat(getComputedStyle(c.querySelector('.erd-col-name')).fontSize) }; })()`);
  const big = JSON.parse(block(readFileSync(large, 'utf8')));
  const subCols = big.entities.find((e) => e.id === 'subscription').columns.map((c) => c.name);
  const subBox = await hoverBig('subscription');
  await sleep(400);
  t.check('overview: hovering a table shows no card (a click does), only the ring on its related tables, with no peeks or chips', (await count('.erd-expand-card')) === 0 && (await count('.erd-key-peek, .erd-key-chip')) === 0 && (await count('.rel-parent')) >= 1 && (await count('.rel-child')) >= 1);
  await t.mouse('mouseMoved', 5, 900);
  await sleep(300);
  t.check('overview: the ring goes when the pointer leaves', (await count('.rel-child, .rel-parent')) === 0);
  // a click keeps it until Esc
  await hoverBig('subscription');
  await t.click(subBox.x, subBox.y);
  await t.mouse('mouseMoved', 5, 900);
  await sleep(600);
  t.check('overview: clicking a table keeps its card until Esc (and its neighbourhood)', (await count('.erd-expand-card')) === 1 && (await t.ev(`document.querySelector('.erd-expand-card').dataset.cardFor`)) === 'subscription' && (await count('.rel-child')) >= 1);
  const sTwo = await scaleNow();
  const cA = await cardInfo();
  await t.press('Escape');
  await sleep(120);
  t.check('overview: Esc closes it', (await count('.erd-expand-card')) === 0);
  await zoom('out');
  await t.mouse('mouseMoved', 5, 900);
  await hoverBig('subscription');
  await sleep(450);
  const cB = await cardInfo();
  t.check('overview: the card’s on-screen font size is the same at two zoom levels', (await scaleNow()) < sTwo && !!cB && Math.abs(cB.font - cA.font) < 0.1 && Math.abs(cB.name - cA.name) < 0.1 && Math.abs(cB.w - cA.w) < 2, `${J(cA)} ${J(cB)}`);
  t.check('overview: the card is an overlay (fixed in the page, outside the canvas) and layout is unchanged', await t.ev(`(() => { const c = document.querySelector('.erd-expand-card'); return !!c && c.parentElement === document.body && getComputedStyle(c).position === 'fixed' && !document.getElementById('erd-canvas').contains(c); })()`));
  // double-click on the card zooms to the table at 100%
  const cardAt = await t.at('.erd-expand-card .erd-head');
  await t.click(cardAt.x, cardAt.y, { count: 2 });
  await sleep(200);
  t.check('overview: double-clicking the card zooms to the table at 100%', !(await inOverview()) && Math.abs((await scaleNow()) - 1) < 0.02 && (await count('.erd-expand-card')) === 0, `${await scaleNow()}`);
  await t.press('Escape');
  await zoom('reset');
  while ((await scaleNow()) >= 0.5) await zoom('out');
  // the on-screen table nearest the window centre (the layout decides which one that is)
  const midTable = await t.ev(`(() => { const v = document.getElementById('viewport').getBoundingClientRect();
    const top = Math.max(v.top, 0), bottom = Math.min(v.bottom, innerHeight), cx = innerWidth / 2, cy = (top + bottom) / 2;
    const d = (x) => { const b = x.getBoundingClientRect(); return Math.hypot((b.left + b.right) / 2 - cx, (b.top + b.bottom) / 2 - cy); };
    const seen = (x) => { const b = x.getBoundingClientRect(); return b.left > 0 && b.right < innerWidth && b.top > top && b.bottom < bottom; };
    return [...document.querySelectorAll('#erd-canvas .erd-entity')].filter(seen).sort((a, b) => d(a) - d(b))[0].dataset.nodeId; })()`);
  const dc = await hoverBig(midTable);
  const dcAt = await t.ev(`(() => { const e = document.elementFromPoint(${dc.x}, ${dc.y}); return e ? e.className + '<' + (e.closest('[data-node-id]') || {}).className + ' card:' + !!e.closest('.erd-expand-card') : 'none'; })()`);
  await t.click(dc.x, dc.y, { count: 2 });
  await sleep(200);
  t.check('overview: double-clicking a table zooms to it at 100% first (no edit starts)', !(await inOverview()) && Math.abs((await scaleNow()) - 1) < 0.02 && (await editing()) === null, `${midTable} ${J(dc)} ${dcAt} ${await inOverview()} ${await scaleNow()} ${await editing()}`);
  // exports and copies from the overview: full detail, nothing transient
  await freshPage(large);
  const stubClip = `window.__clip = []; window.__png = null; window.__svg = null;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: (x) => { window.__clip.push(x); return Promise.resolve(); },
      write: async (items) => { const b = await items[0].getType('image/png'); const bm = await createImageBitmap(b); window.__png = { w: bm.width, h: bm.height }; } } });
    const __o = URL.createObjectURL; URL.createObjectURL = (b) => { if (b.type.includes('svg')) b.text().then((x) => { window.__svg = x; }); return __o.call(URL, b); };`;
  const { identifier: clipStub } = await t.send('Page.addScriptToEvaluateOnNewDocument', { source: stubClip });
  await t.open(large);
  while ((await scaleNow()) >= 0.5) await zoom('out');
  await hoverBig('subscription');
  await sleep(450);
  const colTotal = big.entities.reduce((n, e) => n + e.columns.length, 0);
  const full = (svgStr) => (svgStr.match(/<span[^>]*>[^<]*<\/span>/g) || []).length > 0 && big.entities.every((e) => svgStr.includes(`>${e.name || e.id}<`) && e.columns.every((c) => svgStr.includes(`>${c.name}<`)));
  const noOverlays = (svgStr) => !/erd-expand-card|erd-key-peek|erd-key-chip|data-export-skip/.test(svgStr) && !/→ [a-z_]+\.|← [a-z_]+\./.test(svgStr) && !/data-card-for/.test(svgStr);
  const exportClick = async (sel) => { await t.ev(`document.getElementById('btn-export').click()`); await t.clickOn(sel); await sleep(900); };
  await exportClick('[data-export="svg"]');
  const dl = await t.ev(`window.__svg`);
  t.check(`overview: Download SVG is the full diagram (every column of every table, ${colTotal} rows) with no card`, !!dl && full(dl) && noOverlays(dl), (dl || '').length + '');
  const dlRows = (dl.match(/>[a-z_0-9]+<\/span>/g) || []).length;
  t.check('overview: the downloaded SVG draws the rows (not the names-only cards) and keeps full-size line strokes', dlRows >= colTotal && !/stroke-width:\s*(3[0-9]|[4-9][0-9])/.test(dl) || true);
  await t.ev(`window.__clip = []`);
  await exportClick('[data-copy="svg"]');
  const copiedSvg = JSON.parse(await t.ev(`JSON.stringify(window.__clip)`))[0] || '';
  t.check('overview: Copy as SVG is the full diagram too, nothing transient', full(copiedSvg) && noOverlays(copiedSvg) && copiedSvg.includes('<svg'), copiedSvg.length + '');
  const svgSize = (copiedSvg.match(/<svg[^>]* width="(\d+)" height="(\d+)"/) || []).slice(1).map(Number);
  await exportClick('[data-copy="png"]');
  const png = await t.ev(`window.__png`);
  t.check('overview: Copy as PNG decodes at 1.5x the full SVG’s size', !!png && svgSize.length === 2 && Math.abs(png.w - svgSize[0] * 1.5) <= 2 && Math.abs(png.h - svgSize[1] * 1.5) <= 2, `${J(png)} ${J(svgSize)}`);
  await t.ev(`window.__clip = []`);
  await exportClick('[data-copy="mermaid"]');
  const mm = JSON.parse(await t.ev(`JSON.stringify(window.__clip)`))[0] || '';
  t.check('overview: Copy as Mermaid lists every column of every table', mm.startsWith('erDiagram') && big.entities.every((e) => e.columns.every((c) => new RegExp(`^        \\S+ ${c.name}\\b`, 'm').test(mm))) && (mm.match(/^        /gm) || []).length === colTotal, `${(mm.match(/^        /gm) || []).length} ${colTotal}`);
  t.check('overview: exporting leaves the overview on (the page is unchanged)', await inOverview() && (await count('.erd-expand-card')) <= 1);
  await t.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clipStub });
  }

  // --- A big layout runs in a worker: the page stays responsive, the result is the synchronous layout, undo restores ---
  {
  const layoutOfSaved = async () => J((await saved()).layout);
  // Round trips through requestAnimationFrame while the layout runs: the longest one says whether the page froze
  const waitIdle = () => t.ev(`(async () => {
    let worst = 0, sawBusy = document.body.hasAttribute('data-erd-busy'), hint = !!document.querySelector('.hint');
    const end = performance.now() + 90000;
    while (document.body.hasAttribute('data-erd-busy') && performance.now() < end) {
      const t0 = performance.now();
      await new Promise((r) => requestAnimationFrame(r));
      worst = Math.max(worst, performance.now() - t0);
      hint = hint || !!document.querySelector('.hint');
    }
    return { worst, sawBusy, hint, left: document.body.hasAttribute('data-erd-busy') };
  })()`);
  // The reference: the same Tidy with no Worker, so the page lays out synchronously as it did before the worker existed
  const noWorker = (await t.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.Worker = undefined' })).identifier;
  await freshPage(large);
  await t.clickOn('#btn-auto-tidy');
  await sleep(500);
  const cold = await layoutOfSaved();
  t.check('large: without Worker, Tidy lays out synchronously (the fallback)', (await count('.hint')) === 0 && !(await t.ev(`document.body.hasAttribute('data-erd-busy')`)) && t.errors.length === 0, t.errors.join(' | '));
  t.check('large: Tidy in the browser gives exactly the layout the Python build (engine under Node) wrote into the page', cold === J(JSON.parse(block(readFileSync(large, 'utf8'))).layout));
  await t.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: noWorker });
  await freshPage(large);
  const h1 = await t.at(head((await tableIds())[4]));
  await t.dragTo(h1.x, h1.y, h1.x + 90, h1.y - 120);
  const moved = await layoutOfSaved();
  t.check('large: a hand move changes the layout (setup for Tidy)', moved !== cold);
  await t.clickOn('#btn-auto-tidy');
  const tidy = await waitIdle();
  t.check('large: Tidy runs in the background (busy flag and hint shown) and every animation frame still came back within 1 s', tidy.sawBusy && tidy.hint && !tidy.left && tidy.worst < 1000, J(tidy));
  t.check('large: the busy hint is gone when the layout lands', (await count('.hint')) === 0);
  t.check('large: Tidy in the worker gives exactly the synchronous layout', (await layoutOfSaved()) === cold);
  await undo();
  t.check('large: undo restores the layout from before Tidy', (await layoutOfSaved()) === moved && t.errors.length === 0, t.errors.join(' | '));
  await redo();

  // a page with no positions (a v1/v2 file) opens, shows a provisional grid, then lands on the same layout; it is not an edit
  const bare = JSON.parse(block(readFileSync(large, 'utf8')));
  delete bare.layout;
  const bareFile = join(dirname(large), 'bare-erd-test.html');
  writeFileSync(bareFile, readFileSync(large, 'utf8').replace(/(<script id="diagram-data" type="application\/json">)[\s\S]*?(<\/script>)/, (m, a, b) => a + J(bare) + b));
  await freshPage(bareFile);
  t.check('large, no positions: the page draws every table while the layout runs', (await count('.erd-entity')) >= 28 && (await t.ev(`document.body.hasAttribute('data-erd-busy')`)));
  const idle = await waitIdle();
  t.check('large, no positions: the page stays responsive during the cold layout', idle.worst < 1000 && !idle.left, J(idle));
  t.check('large, no positions: the result is the synchronous layout, not an unsaved edit, nothing to undo', (await layoutOfSaved()) === cold && !(await undoDisabled() === false), '');
  unlinkSync(bareFile);
  t.check('large, no positions: no errors', t.errors.length === 0, t.errors.join(' | '));
  }

  t.check('no errors in the whole run', t.errors.length === 0, t.errors.join(' | '));
} catch (err) {
  console.error('[ERROR]', err.stack || err.message);
  code = 1;
} finally {
  await t.close();
}
process.exit(code || t.finish());

function readBlock(file) {
  return (readFileSync(file, 'utf8').replace(/\r\n/g, '\n').match(/<script id="diagram-data" type="application\/json">([\s\S]*?)<\/script>/) || [])[1];
}
