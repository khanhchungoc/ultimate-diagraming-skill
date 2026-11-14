// Interaction test for the ER diagram plugin: selection, adding and renaming tables and columns, keys, reordering,
// drawing / re-pointing / reversing relationships and their inferred ends, cardinality pickers, areas, notes, delete,
// Auto-Tidy on and off with snap guides, undo/redo (one step per finished edit), ?present, and the saved data block
// (byte-identical without edits; generated ids renamed, authored ids kept; Python codec agrees).
// Driven with real mouse and keyboard input over the Chrome DevTools Protocol (see cdp.mjs): a synthetic DOM
// event may only be used where a comment says why.
//   node dev/e2e_erd.mjs --browser <chrome> --page <example-erd.html> --large <saas-billing.html>
// --page: references/examples/example-erd.json laid out with `layout_engine.py --layout` (8 tables, 2 areas).
// --large: dev/fixtures/erd/saas-billing.json laid out the same way (~30 tables, 4 areas).
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { readFileSync } from 'node:fs';
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
  // The Auto-Tidy preference lives in localStorage (read when the page script starts): set it before each load
  let autoScript = null;
  const setAuto = async (on) => {
    if (autoScript) await t.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: autoScript });
    ({ identifier: autoScript } = await t.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('erd-auto-layout', ${J(on ? 'on' : 'off')}); } catch (e) {}` }));
  };
  // A point on a line that really hits it (the line's own hit path under the pointer), away from its label pill
  const onLine = (id) => t.ev(`(() => {
    const g = document.querySelector('.erd-rel[data-edge-id="${id}"]'); const p = g.querySelector('.erd-rel-hit'); const L = p.getTotalLength();
    for (const f of [0.12, 0.2, 0.3, 0.42, 0.6, 0.72, 0.82, 0.9, 0.5]) {
      const q = p.getPointAtLength(L * f), m = p.getScreenCTM(); const x = m.a * q.x + m.e, y = m.d * q.y + m.f;
      const hit = document.elementFromPoint(x, y);
      if (hit && hit.closest('.erd-rel') === g) return { x, y };
    }
    return null; })()`);
  const bandRect = (id) => t.ev(`(() => { const r = document.querySelector('.erd-band[data-group-id="${id}"]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  const present = (sel) => t.ev(`!!document.querySelector(${J(sel)})`);
  // Hover a row so its connect port shows, then return the port's centre
  const portOf = async (id, col) => {
    const r = await t.at(col ? row(id, col) : head(id), 0.4, 0.5);
    await t.mouse('mouseMoved', r.x, r.y);
    await sleep(60);
    return t.at(`.erd-entity[data-node-id="${id}"] ${col ? `.erd-row[data-col="${col}"]` : '.erd-head'} .erd-port`);
  };
  const freshPage = async (file = page, query = '') => { await setAuto(true); await t.open(file, query); };
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
  t.check('the example renders its 8 tables, 2 areas and 9 lines without errors',
    (await count('.erd-entity')) === 8 && (await count('.erd-band')) === 2 && (await count('.erd-rel')) === 9 && t.errors.length === 0 && vw > 1000, `${t.errors.join(' | ')} ${vw}`);
  t.check('the dock has Table, Relationship, Area, Note, and no Delete until something is selected',
    ['btn-add-table', 'btn-add-relationship', 'btn-add-area', 'btn-add-note'].every((id) => present(`#${id}`)) && !(await t.ev(`document.getElementById('btn-delete-selection').classList.contains('show')`)));

  // --- Selection, Escape, glyph fix ---
  await t.clickOn(head('order'));
  t.check('clicking a table selects it, shows its action bar and the dock Delete',
    (await count('.erd-entity.selected')) === 1 && (await count('.erd-actionbar [data-act="addcol"]')) === 1 && (await t.ev(`document.getElementById('btn-delete-selection').classList.contains('show')`)));
  await t.press('Escape');
  t.check('Escape clears the selection and its action bar', (await count('.erd-entity.selected')) === 0 && (await count('.erd-actionbar')) === 0);
  await t.clickOn(row('order', 'status'));
  t.check('clicking a column selects that row and shows the column action bar',
    (await count('.erd-row.selected')) === 1 && (await count('.erd-actionbar [data-act="pk"]')) === 1);
  await t.clickOn('.erd-band[data-group-id="sales"]', {});   // blank band: the shell clears the selection (pans)
  t.check('a click on blank canvas clears the selection', (await count('.erd-row.selected')) === 0);
  const glyph = await t.ev(`(() => {
    const r = document.querySelector('.erd-entity[data-node-id="order_item"] .erd-row[data-col="order_id"]');
    const g = r.querySelector('.erd-glyph').getBoundingClientRect(), n = r.querySelector('.erd-col-name').getBoundingClientRect();
    const s = [...r.querySelectorAll('.erd-glyph svg')].map((e) => e.getBoundingClientRect());
    const one = document.querySelector('.erd-entity[data-node-id="customer"] .erd-row[data-col="id"] .erd-glyph svg').getBoundingClientRect();
    return { slot: g.width, gap: n.left - Math.max(...s.map((q) => q.right)), stacked: s.length === 2 && s[0].bottom <= s[1].top + 0.5 && s[0].left === s[1].left,
      inside: s.every((q) => q.left >= g.left - 0.5 && q.right <= g.right + 0.5 && q.top >= r.getBoundingClientRect().top && q.bottom <= r.getBoundingClientRect().bottom), oneGap: n.left - one.right }; })()`);
  t.check('a PK+FK column stacks its two glyphs inside the 22px glyph slot, clear of the name (as much room as a single glyph)',
    Math.abs(glyph.slot - 22) < 0.6 && glyph.stacked && glyph.inside && glyph.gap >= 8, J(glyph));

  // --- Add a table ---
  await freshPage();
  await t.clickOn(head('order'));
  await t.clickOn('#btn-add-table');
  let ids = await tableIds();
  const newId = ids.find((i) => /^t_\d+/.test(i));
  const nameEdit = await editing();
  t.check('Table adds one after the selected table, in its area, with an id PK uuid column, and opens its name in edit',
    ids.length === 9 && !!newId && ids.indexOf(newId) === ids.indexOf('order') + 1 && nameEdit === 'table_9' && (await colNames(newId)).join() === 'id'
      && (await text(`${row(newId, 'id')} .erd-col-type`)) === 'uuid' && (await t.ev(`!!document.querySelector('.erd-entity[data-node-id="${newId}"] .erd-row.pk')`)), `${ids} ${nameEdit}`);
  await t.type('payment_method');
  await t.press('Enter');
  t.check('typing and Enter renames the new table', (await tableName(newId)) === 'payment_method' && (await editing()) === null);
  let d = await saved();
  t.check('the saved table is in the Sales area and the id column is a uuid primary key',
    ent(d, 'payment_method')?.group === 'sales' && J(ent(d, 'payment_method').columns) === J([{ name: 'id', type: 'uuid', pk: true }]), J(ent(d, 'payment_method')));
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
  // Drag the dock button onto an area
  await freshPage();
  const btn = await t.at('#btn-add-table'), cat = await bandRect('catalog');
  await t.dragTo(btn.x, btn.y, cat.x + 70, cat.y + cat.h - 25, { steps: 8 });
  ids = await tableIds();
  const dropped = ids.find((i) => /^t_\d+/.test(i));
  await t.press('Escape');
  d = await saved();
  t.check('dragging Table onto the Catalog area drops it there and opens its name in edit', ids.length === 9 && !!dropped && ent(d, 'table_9')?.group === 'catalog', `${ids} ${J(d.entities.map((e) => [e.id, e.group]))}`);
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
  await t.dragTo(p.x, p.y, p.x - 60, p.y + 220);
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
  const markerNow = await t.ev(`getComputedStyle(document.querySelector('.erd-rel[data-edge-id="r2"] .erd-rel-line')).getPropertyValue('--mk-s')`);
  t.check('each picker sets its end (child: one or many, parent: zero or one) and the line’s markers follow',
    rel(d, 'r2').fromEnd === 'oneOrMany' && rel(d, 'r2').toEnd === 'zeroOrOne' && /oneOrMany/.test(markerNow), `${J(rel(d, 'r2'))} ${markerNow}`);
  await t.clickOn('.erd-actionbar [data-act="identifying"]');
  d = await saved();
  const solid = await t.ev(`document.querySelector('.erd-rel[data-edge-id="r2"] .erd-rel-line').classList.contains('identifying')`);
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
    labelEdit === '' && rel(d, 'r8').label === 'reviews' && (await text('.erd-rel-label[data-edge-id="r8"] .erd-rel-label-text')) === 'reviews', `${labelEdit} ${J(rel(d, 'r8'))}`);
  const lab = await t.at('.erd-rel-label[data-edge-id="r1"]');
  await t.click(lab.x, lab.y, { count: 2 });
  const hadLabel = await editing();
  await t.type('lives at');
  await t.press('Enter');
  d = await saved();
  t.check('double-clicking a label edits it', hadLabel === 'has' && rel(d, 'r1').label === 'lives at');
  await t.clickOn('.erd-rel-label[data-edge-id="r1"]');
  await t.clickOn('.erd-actionbar [data-act="label"]');
  await t.press('Backspace');
  await t.press('Enter');
  d = await saved();
  t.check('the label button edits; an empty label removes it', !('label' in rel(d, 'r1')) && (await count('.erd-rel-label[data-edge-id="r1"]')) === 0);
  // re-point: the parent end of r8 (review -> product) to category
  await freshPage();
  q = await onLine('r8');
  await t.click(q.x, q.y);
  const h = await t.at('.erd-handle[data-role="to"]');
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
    (await saved()).relationships.find((r) => r.from === 'category' && r.to === 'category')?.columns?.join() === 'name' && /self-reference needs a column/.test(await text('.erd-hint') || ''));

  // --- Areas ---
  await freshPage();
  await t.clickOn('#btn-add-area');
  const areaEdit = await editing();
  await t.type('Audit');
  await t.press('Enter');
  d = await saved();
  t.check('Area adds a band, selects it and opens its name in edit', areaEdit === 'Area 3' && d.groups.length === 3 && d.groups[2].name === 'Audit' && /^audit$/.test(d.groups[2].id) && (await count('.erd-band')) === 3, `${areaEdit} ${J(d.groups)}`);
  await undo();
  await undo();
  t.check('creating and renaming an area are two undo steps', (await count('.erd-band')) === 2);
  await t.clickOn('.erd-band[data-group-id="catalog"] .erd-band-pill', { count: 2 });
  const pillEdit = await editing();
  await t.type('Products');
  await t.press('Enter');
  d = await saved();
  t.check('double-clicking an area’s pill renames it', pillEdit === 'Catalog' && d.groups[1].name === 'Products' && d.groups[1].id === 'catalog', `${pillEdit} ${J(d.groups)}`);
  // reorder by dragging the pill
  const catPill = await t.at('.erd-band[data-group-id="catalog"] .erd-band-pill'), sal = await bandRect('sales');
  await t.dragTo(catPill.x, catPill.y, catPill.x, sal.y + 14);
  d = await saved();
  t.check('dragging an area’s name pill above the other reorders the areas', d.groups.map((g) => g.id).join() === 'catalog,sales', J(d.groups));
  await undo();
  // move a table to another band
  const catHead = await t.at(head('category')), sal2 = await bandRect('sales');
  await t.dragTo(catHead.x, catHead.y, sal2.x + sal2.w / 2, sal2.y + sal2.h / 2);
  d = await saved();
  t.check('dragging a table into another area changes its group (Auto-Tidy on: the layout places it)', ent(d, 'category').group === 'sales' && ent(d, 'product').group === 'catalog', J(d.entities.map((e) => e.group)));
  await undo();
  t.check('and that was one undo step', ent(await saved(), 'category').group === 'catalog');
  // colour and delete
  await t.clickOn('.erd-band[data-group-id="catalog"] .erd-band-pill');
  t.check('clicking a pill selects the area: swatches, rename and delete in its action bar', (await count('.erd-band.selected')) === 1 && (await count('.erd-actionbar .swatch-btn')) === 9 && (await count('.erd-actionbar [data-act="delband"]')) === 1);
  await t.clickOn('.erd-actionbar .swatch-btn[data-value="#fef3c7"]');
  d = await saved();
  t.check('a swatch sets the area’s colour (and it is saved)', d.groups[1].color === '#fef3c7', J(d.groups[1]));
  await t.press('Delete');
  t.check('Delete on an area asks first, naming the tables that move', (await count('.erd-confirm')) === 1 && /3 tables/.test(await text('.erd-confirm-msg')) && (await count('.erd-band')) === 2, await text('.erd-confirm-msg'));
  await t.press('Escape');
  t.check('Escape closes the question and changes nothing', (await count('.erd-confirm')) === 0 && (await count('.erd-band')) === 2);
  await t.press('Delete');
  await t.clickOn('.erd-confirm-delete');
  d = await saved();
  t.check('confirming moves the area’s tables to the first remaining area', d.groups.length === 1 && d.entities.every((e) => e.group === 'sales') && (await count('.erd-band')) === 1, J(d.entities.map((e) => e.group)));
  await t.clickOn('.erd-band[data-group-id="sales"] .erd-band-pill');
  await t.clickOn('.erd-actionbar [data-act="delband"]');
  await t.clickOn('.erd-confirm-delete');
  d = await saved();
  t.check('deleting the last area removes `groups` and every table’s `group`, and draws no band', !('groups' in d) && d.entities.every((e) => !('group' in e)) && (await count('.erd-band')) === 0, J(d.groups));
  await undo();
  t.check('and it is one undo step', (await saved()).groups.length === 1);

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
  t.check('Escape finishes an empty note, and an empty note is not kept', d.notes.length === 1 && (await count('.erd-note-badge')) === 1);
  // + chip
  const addr = await t.at(head('address'), 0.5, 0.5);
  await t.mouse('mouseMoved', addr.x, addr.y);
  await sleep(80);
  const chipShown = await t.ev(`getComputedStyle(document.querySelector('.erd-entity[data-node-id="address"] .erd-note-add')).display`);
  await t.clickOn('.erd-entity[data-node-id="address"] .erd-note-add');
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
  const picking = await t.ev(`document.body.classList.contains('erd-note-picking')`);
  await t.clickOn(head('category'));
  const pickEdit = await editing();
  await t.type('Tree of categories');
  await t.press('Escape');
  t.check('Note with nothing selected waits for a table (Esc cancels), then notes the table clicked',
    picking && pickEdit === '' && (await saved()).notes.some((n) => n.text === 'Tree of categories' && n.entities.join() === 'category'));
  await t.press('Escape');
  await t.clickOn('#btn-add-note');
  await t.press('Escape');
  t.check('Escape cancels the armed Note tool', !(await t.ev(`document.body.classList.contains('erd-note-picking')`)));
  // drag the Note button onto a table
  const nb = await t.at('#btn-add-note'), rv = await t.at(head('review'));
  await t.dragTo(nb.x, nb.y, rv.x, rv.y, { steps: 8 });
  const dragEdit = await editing();
  await t.type('Moderated');
  await t.press('Escape');
  t.check('dragging the Note button onto a table gives it a note', dragEdit === '' && (await saved()).notes.some((n) => n.text === 'Moderated' && n.entities.join() === 'review'));
  // edit an existing note by its badge; link; unlink; pin; delete
  await freshPage();
  await t.clickOn('.erd-entity[data-node-id="order"] .erd-note-badge');
  const badgeEdit = await editing();
  await t.type(' (kept for good)');   // the caret starts at the end of the text
  await t.press('Escape');
  d = await saved();
  t.check('clicking a table’s badge edits its note (caret at the end), and the note stays selected afterwards',
    badgeEdit === 'Orders are never deleted; cancelled orders keep their items' && d.notes[0].text === `${badgeEdit} (kept for good)` && (await count('.erd-note.selected')) === 1, badgeEdit);
  const link = await t.at('.erd-note.selected .erd-note-link'), cust = await t.at(head('customer'));
  await t.dragTo(link.x, link.y, cust.x, cust.y);
  d = await saved();
  t.check('dragging a note’s link handle onto another table links it', d.notes[0].entities.join() === 'order,customer', J(d.notes[0]));
  await t.clickOn(head('address'), { modifiers: 8 });
  d = await saved();
  const linkedShift = d.notes[0].entities.join();
  await t.clickOn(head('address'), { modifiers: 8 });
  d = await saved();
  t.check('Shift+click a table with a note selected links it, and again unlinks it', linkedShift === 'order,customer,address' && d.notes[0].entities.join() === 'order,customer', `${linkedShift} ${J(d.notes[0])}`);
  const link2 = await t.at('.erd-note.selected .erd-note-link'), cust2 = await t.at(head('customer'));
  await t.dragTo(link2.x, link2.y, cust2.x, cust2.y);
  t.check('dragging the handle onto a linked table unlinks it', (await saved()).notes[0].entities.join() === 'order');
  const card = await t.at('.erd-note.selected');
  await t.dragTo(card.x, card.y, card.x + 60, card.y + 70);
  d = await saved();
  t.check('dragging a note’s card pins it: `pos` is written, relative to its table, and survives the save',
    typeof d.notes[0].pos?.x === 'number' && typeof d.notes[0].pos?.y === 'number' && (d.notes[0].pos.x % 4 === 0), J(d.notes[0]));
  await t.press('Delete');
  d = await saved();
  t.check('Delete removes the selected note', !d.notes && (await count('.erd-note-badge')) === 0);
  await undo();
  t.check('and undo brings it back with its place', (await saved()).notes?.[0]?.pos !== undefined);
  // deleting a table unlinks its notes
  await freshPage();
  await t.clickOn('.erd-entity[data-node-id="order"] .erd-note-badge');
  await t.press('Escape');
  const link3 = await t.at('.erd-note.selected .erd-note-link'), cust3 = await t.at(head('customer'));
  await t.dragTo(link3.x, link3.y, cust3.x, cust3.y);

  // --- Delete a table ---
  await t.clickOn(head('order'));
  await t.press('Delete');
  const ask = await text('.erd-confirm-msg');
  t.check('Delete on a table with relationships asks first and says how many', /4 relationships/.test(ask || '') && (await count('.erd-entity')) === 8, ask);
  await t.clickOn('.erd-confirm-cancel');
  t.check('Cancel keeps it', (await count('.erd-entity')) === 8 && (await count('.erd-confirm')) === 0);
  await t.clickOn(head('order'));
  await t.clickOn('#btn-delete-selection');
  await t.clickOn('.erd-confirm-delete');
  d = await saved();
  t.check('confirming deletes the table, its relationships and unlinks it from its notes (a note keeps its other tables)',
    !ent(d, 'order') && d.relationships.every((r) => r.from !== 'order' && r.to !== 'order') && d.relationships.length === 5 && d.notes[0].entities.join() === 'customer', `${d.relationships.length} ${J(d.notes)}`);
  await undo();
  t.check('one undo step brings back the table, its lines and the note link', !!ent(await saved(), 'order') && (await saved()).relationships.length === 9);
  await t.clickOn('#btn-add-table');
  await t.press('Escape');
  await t.press('Delete');
  t.check('a table without relationships is deleted without asking', (await count('.erd-confirm')) === 0 && (await count('.erd-entity')) === 8);

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

  // --- Auto-Tidy ---
  const layoutOf = async () => { const dd = await saved(); return dd.layout; };
  await freshPage();
  t.check('Auto-Tidy is on by default', (await t.ev(`document.getElementById('btn-auto-layout').getAttribute('aria-checked')`)) === 'true');
  const lay0 = await layoutOf();
  await t.clickOn(head('order'));
  await t.clickOn('#btn-add-table');
  await t.press('Escape');
  const lay1 = await layoutOf();
  const movedOthers = Object.keys(lay0).filter((k) => J(lay0[k]) !== J(lay1[k])).length;
  t.check('on: a structural edit re-lays everything out (other tables move) as a single undo step', movedOthers > 0 && Object.keys(lay1).length === 9);
  await undo();
  t.check('and one undo restores every position', J(await layoutOf()) === J(lay0));
  // off
  await t.clickOn('#btn-auto-layout');
  t.check('the switch turns Auto-Tidy off and the choice is remembered in this browser', (await t.ev(`document.getElementById('btn-auto-layout').getAttribute('aria-checked')`)) === 'false' && (await t.ev(`localStorage.getItem('erd-auto-layout')`)) === 'off');
  const off0 = await layoutOf();
  const hd = await t.at(head('category'));
  await t.dragTo(hd.x, hd.y, hd.x + 120, hd.y - 150);
  const off1 = await layoutOf();
  d = await saved();
  t.check('off: dragging a table writes its x/y (flow terms) and moves no other table',
    J(off1.category) !== J(off0.category) && Object.keys(off0).filter((k) => k !== 'category').every((k) => J(off0[k]) === J(off1[k])) && Number.isInteger(off1.category.x) && off1.category.x % 4 === 0, `${J(off0.category)} -> ${J(off1.category)}`);
  await undo();
  t.check('and that is one undo step', J(await layoutOf()) === J(off0));
  // snap guides while aligned (centre to centre within 6px)
  const cb = await t.ev(`(() => { const r = (id) => { const b = document.querySelector('.erd-entity[data-node-id="' + id + '"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }; return { cat: r('category'), prod: r('product') }; })()`);
  const gh = await t.at(head('category'));
  await t.mouse('mouseMoved', gh.x, gh.y);
  await t.mouse('mousePressed', gh.x, gh.y, { button: 'left', buttons: 1, clickCount: 1 });
  // move so that category's centre is 3px off product's centre column, a long way below it
  const dx = cb.prod.x - cb.cat.x + 3, dy = 150;
  for (let i = 1; i <= 6; i++) { await t.mouse('mouseMoved', gh.x + dx * i / 6, gh.y + dy * i / 6, { button: 'left', buttons: 1 }); await sleep(15); }
  const guide = await t.ev(`getComputedStyle(document.querySelector('.erd-guide-v')).display`);
  await t.mouse('mouseReleased', gh.x + dx, gh.y + dy, { button: 'left', buttons: 0, clickCount: 1 });
  await sleep(80);
  const snapped = await t.ev(`(() => { const c = document.querySelector('.erd-entity[data-node-id="category"]').getBoundingClientRect(), p = document.querySelector('.erd-entity[data-node-id="product"]').getBoundingClientRect(); return Math.abs((c.left + c.width / 2) - (p.left + p.width / 2)); })()`);
  t.check('off: a table dragged within 6px of another’s centre line snaps to it, with a guide while dragging', guide === 'block' && snapped < 1.5 && (await t.ev(`getComputedStyle(document.querySelector('.erd-guide-v')).display`)) === 'none', `${guide} ${snapped}`);
  await undo();
  // group follows the band under the pointer
  const hd2 = await t.at(head('category')), sal3 = await bandRect('sales');
  await t.dragTo(hd2.x, hd2.y, hd2.x + 10, sal3.y + sal3.h - 50);
  d = await saved();
  t.check('off: dropping a table in another area changes its group, and the table stays where it was dropped', ent(d, 'category').group === 'sales', J(ent(d, 'category')));
  await undo();
  // add a table with Auto-Tidy off: placed, nothing else moves
  const off2 = await layoutOf();
  await t.clickOn(head('order'));
  await t.clickOn('#btn-add-table');
  await t.press('Escape');
  const off3 = await layoutOf();
  t.check('off: Table adds a placed table (x/y saved) and moves no other table', Object.keys(off3).length === 9 && Object.keys(off2).every((k) => J(off2[k]) === J(off3[k])), `${Object.keys(off3).length}`);
  const overlap = await t.ev(`(() => { const b = [...document.querySelectorAll('.erd-entity')].map((e) => e.getBoundingClientRect()); for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (b[i].left < b[j].right && b[i].right > b[j].left && b[i].top < b[j].bottom && b[i].bottom > b[j].top) return true; return false; })()`);
  t.check('off: the new table does not sit on another table', !overlap);
  // collapse only re-routes
  await t.clickOn(`${head('order')} .erd-chevron`);
  const off4 = await layoutOf();
  t.check('off: collapsing a table only re-routes (no table moves) and the lines still end on its header',
    Object.keys(off3).every((k) => J(off3[k]) === J(off4[k])) && (await count('.erd-entity.is-collapsed')) === 1 && (await t.ev(`document.querySelector('.erd-entity.is-collapsed').getBoundingClientRect().height`)) < 40);
  await t.clickOn(`${head('order')} .erd-chevron`);
  // relationship and column edits re-route without moving
  const off5 = await layoutOf();
  p = await portOf('review', 'rating');
  tgt = await t.at(row('category', 'id'));
  await t.dragTo(p.x, p.y, tgt.x, tgt.y);
  t.check('off: drawing a relationship moves no table', J(await layoutOf()) === J(off5));
  // Tidy lays everything out once, now
  await t.clickOn('#btn-auto-tidy');
  const tidy1 = await layoutOf();
  t.check('Tidy lays the diagram out on request even with Auto-Tidy off', Object.keys(off5).some((k) => J(off5[k]) !== J(tidy1[k])));
  // turning it back on lays out at once, as one step
  await t.clickOn('#btn-auto-layout');
  t.check('turning Auto-Tidy back on lays the diagram out again', (await t.ev(`localStorage.getItem('erd-auto-layout')`)) === 'on' && t.errors.length === 0, t.errors.join(' | '));
  await setAuto(true);

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
    ['add an area', async () => { await t.clickOn('#btn-add-area'); await t.press('Escape'); }],
    ['rename an area', async () => { await t.clickOn('.erd-band[data-group-id="catalog"] .erd-band-pill', { count: 2 }); await t.type('Products'); await t.press('Enter'); }],
    ['reorder areas', async () => { const pl = await t.at('.erd-band[data-group-id="catalog"] .erd-band-pill'), sb = await bandRect('sales'); await t.dragTo(pl.x, pl.y, pl.x, sb.y + 14); }],
    ['colour an area', async () => { await t.clickOn('.erd-band[data-group-id="catalog"] .erd-band-pill'); await t.clickOn('.erd-actionbar .swatch-btn[data-value="#fef3c7"]'); }],
    ['delete an area', async () => { await t.clickOn('.erd-band[data-group-id="catalog"] .erd-band-pill'); await t.press('Delete'); await t.clickOn('.erd-confirm-delete'); }],
    ['move a table to another area', async () => { const h1 = await t.at(head('category')), sb = await bandRect('sales'); await t.dragTo(h1.x, h1.y, sb.x + sb.w / 2, sb.y + sb.h / 2); }],
    ['collapse a table', async () => { await t.clickOn(`${head('order')} .erd-chevron`); }],
    ['add a note', async () => { await t.clickOn(head('address')); await t.press('n'); await t.type('Hi'); await t.press('Escape'); }],
    ['link a note', async () => { await t.clickOn('.erd-entity[data-node-id="order"] .erd-note-badge'); await t.press('Escape'); const l1 = await t.at('.erd-note.selected .erd-note-link'), c1 = await t.at(head('customer')); await t.dragTo(l1.x, l1.y, c1.x, c1.y); }],
    ['pin a note', async () => { await t.clickOn('.erd-entity[data-node-id="order"] .erd-note-badge'); await t.press('Escape'); const c1 = await t.at('.erd-note.selected'); await t.dragTo(c1.x, c1.y, c1.x + 50, c1.y + 60); }],
    ['delete a note', async () => { await t.clickOn('.erd-entity[data-node-id="order"] .erd-note-badge'); await t.press('Escape'); await t.press('Delete'); }],
    ['delete a table', async () => { await t.clickOn(head('order')); await t.press('Delete'); await t.clickOn('.erd-confirm-delete'); }],
    ['Tidy', async () => { const h1 = await t.at(head('category')); await t.dragTo(h1.x, h1.y, h1.x + 90, h1.y - 120); await t.clickOn('#btn-auto-tidy'); }],
  ];
  const stepProblems = [];
  for (const [what, act] of cases) {
    await freshPage();
    const base = J(await saved());
    await act();
    const after = J(await saved());
    await undo();
    const afterUndo = J(await saved()), lastUndo = await undoDisabled();
    await redo();
    const afterRedo = J(await saved());
    // Tidy is two edits here (a manual drag is not possible with Auto-Tidy on, so the drag was a no-op): same rule
    if (after === base) stepProblems.push(`${what}: nothing changed`);
    else if (afterUndo !== base || !lastUndo) stepProblems.push(`${what}: not one undo step`);
    else if (afterRedo !== after) stepProblems.push(`${what}: redo differs`);
  }
  t.check(`each of ${cases.length} kinds of edit is one undo step and redo puts it back`, stepProblems.length === 0, stepProblems.join('; '));

  // --- ?present ---
  await freshPage(page, '?present');
  const portHover = await (async () => {
    const r = await t.at(row('order', 'status'));
    await t.mouse('mouseMoved', r.x, r.y);
    await sleep(80);
    return t.ev(`[...document.querySelectorAll('.erd-port')].some((p) => getComputedStyle(p).display !== 'none')`);
  })();
  t.check('?present: no ports, handles, + chips or dock', !portHover && (await t.ev(`getComputedStyle(document.querySelector('.toolbar-center')).display`)) === 'none'
    && (await t.ev(`[...document.querySelectorAll('.erd-note-add')].every((c) => getComputedStyle(c).display === 'none')`)));
  await t.clickOn(head('order'), { count: 2 });
  t.check('?present: a double-click edits nothing', (await editing()) === null && (await count('.erd-actionbar')) === 0 && (await count('.erd-handle')) === 0);
  await t.press('Delete');
  await t.press('n');
  t.check('?present: Delete and N do nothing', (await count('.erd-entity')) === 8 && (await count('.erd-note')) === 1 && (await count('.erd-confirm')) === 0);
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
  for (const [what, file, pick] of [['the example', page, { table: 'order', group: 'sales', col: ['order', 'status'], other: ['product', 'category'] }],
    ['the 30-table schema', large, null]]) {
    await freshPage(file);
    if (pick) {
      await t.clickOn(head('order'));
      await t.clickOn('#btn-add-table');
      await t.type('refund');
      await t.press('Enter');
      await t.clickOn('#btn-add-area');
      await t.type('Billing ops');
      await t.press('Enter');
      p = await portOf('review', 'rating');
      tgt = await t.at(row('category', 'id'));
      await t.dragTo(p.x, p.y, tgt.x, tgt.y);
      await t.clickOn(head('product'));
      await t.press('n');
      await t.type('Prices exclude tax');
      await t.press('Escape');
      const card2 = await t.at('.erd-note.selected');
      await t.dragTo(card2.x, card2.y, card2.x + 30, card2.y + 40);
      d = await saved();
      t.check(`generated ids are renamed in the saved file, authored ids kept (${what})`,
        !!ent(d, 'refund') && d.groups.some((g) => g.id === 'billing_ops') && d.relationships.some((r) => r.id === 'r10' && r.from === 'review')
        && d.notes.some((n) => n.id === 'n2' && n.entities.join() === 'product' && n.pos)
        && ent(d, 'order') && rel(d, 'r1') && d.notes.some((n) => n.id === 'n1') && d.groups.some((g) => g.id === 'sales')
        && !/"(t|r|g|n)_\d{12,}/.test(J(d)) && d.layout.refund, J(d.groups) + J(d.relationships.slice(-2)));
    } else {
      await t.clickOn('#btn-add-table');
      await t.type('refund');
      await t.press('Enter');
      await t.clickOn('#btn-add-area');
      await t.press('Escape');
      d = await saved();
      const authoredBefore = JSON.parse(block(readFileSync(file, 'utf8')));
      t.check(`generated ids are renamed in the saved file, authored ids kept (${what})`,
        !!ent(d, 'refund') && d.groups.length === authoredBefore.groups.length + 1 && d.groups.at(-1).id === 'area_5'
        && authoredBefore.entities.every((e) => !!ent(d, e.id)) && authoredBefore.relationships.every((r) => !!rel(d, r.id)) && !/"(t|r|g|n)_\d{12,}/.test(J(d)), J(d.groups.at(-1)));
    }
    t.check(`the saved block is valid for the Python codec too (${what})`, pythonAgrees(await t.ev(`document.getElementById('diagram-data').textContent`)) === '', pythonAgrees(await t.ev(`document.getElementById('diagram-data').textContent`)));
  }
  // The 30-table page: a table, a relationship with Auto-Tidy on, and undo of all of it
  await freshPage(large);
  const nTables = await count('.erd-entity');
  t.check('the 30-table schema renders without errors', nTables >= 28 && (await count('.erd-band')) === 4 && t.errors.length === 0, `${nTables} ${t.errors.join(' | ')}`);
  const lg = await t.ev(`(() => { const r = document.querySelectorAll('.erd-entity')[4].querySelector('.erd-head').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await t.mouse('mouseMoved', lg.x, lg.y);
  await sleep(100);
  t.check('hover works on the large page (a table lights its lines and dims the rest)', (await count('.erd-entity.is-dim')) > 10);
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
