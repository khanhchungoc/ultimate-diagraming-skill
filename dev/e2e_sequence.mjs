// Interaction test for the sequence plugin (selection, reorder by drag, add/delete, text edit, frames).
//   node dev/e2e_sequence.mjs --browser <chrome> --page <laid-out sequence.html> [--artifact <same, --target artifact>]
// Use dev/fixtures/sequence/checkout-with-fragments.json laid out with `layout_engine.py --layout`.
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { readFileSync } from 'node:fs';
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser'), page = argOf('page'), artifact = argOf('artifact');
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

  // Click selects; Delete removes the message and keeps frames valid
  await t.ev(t.drag(`.seq-msg-label[data-edge-id="m6"]`));
  const selected = await t.ev(`!!document.querySelector('.seq-msg-label.selected')`);
  await t.ev(t.key('Delete'));
  const m1 = JSON.parse(await t.ev(labels));
  t.check('click selects a message and Delete removes it', selected && m1.length === 6 && !m1.includes('Release stock'), JSON.stringify(m1));
  t.check('frame survives its last message being deleted (alt now ends earlier)', (await count('.seq-frag-label')) === 2 && t.errors.length === 0, t.errors.join(' | '));

  // Drag a participant right over its neighbour: order changes
  await t.open(page);
  const x1 = await t.ev(`document.querySelectorAll('.seq-participant')[1].getBoundingClientRect().left`);
  const x2 = await t.ev(`document.querySelectorAll('.seq-participant')[2].getBoundingClientRect().left`);
  await t.ev(t.drag('.seq-participant[data-node-id="p2"]', x2 - x1 + 20, 0));
  const reordered = JSON.parse(await t.ev(names));
  t.check('dragging a participant sideways reorders the lifelines', reordered.join() === 'Customer,Payment,Shop,Warehouse', reordered.join());

  // Drag a message up past the previous one: time order changes
  await t.open(page);
  const before = JSON.parse(await t.ev(labels));
  await t.ev(t.drag('.seq-msg-label[data-edge-id="m3"]', 0, -130));
  const after = JSON.parse(await t.ev(labels));
  t.check('dragging a message vertically changes its time order', before.indexOf('Stock reserved') > after.indexOf('Stock reserved'), `${before.join('|')} -> ${after.join('|')}`);

  // Add participant and message
  await t.open(page);
  await t.ev(`document.getElementById('btn-add-participant').click()`);
  await t.ev(`document.getElementById('btn-add-message').click()`);
  t.check('toolbar adds a participant and a message', (await count('.seq-participant')) === 5 && (await count('.seq-msg-label')) === 8 && t.errors.length === 0, t.errors.join(' | '));

  // Frame button wraps the selected message; second click cycles its kind
  await t.ev(`document.getElementById('btn-frame').click()`);
  await t.ev(`document.getElementById('btn-frame').click()`);
  t.check('Frame wraps the selected message, then cycles opt to alt',
    (await count('.seq-frag-label')) === 3 && (await t.ev(`document.querySelector('.seq-frag-label.selected .seq-frag-kind').textContent`)) === 'alt');

  // Inline editing: dblclick, type, blur
  await t.open(page);
  await t.ev(`(() => { const el = document.querySelector('.seq-msg-label[data-edge-id="m1"] .seq-msg-label-text');
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); el.textContent = 'Submit order now'; el.blur(); })()`);
  t.check('double-click edit renames a message and re-lays out', JSON.parse(await t.ev(labels))[0] === 'Submit order now' && t.errors.length === 0, t.errors.join(' | '));

  // Auto-Tidy and save path
  await t.ev(`document.getElementById('btn-auto-tidy').click()`);
  await t.ev(t.key('s', { ctrlKey: true }));
  t.check('Auto-Tidy and Ctrl+S run without errors', t.errors.length === 0, t.errors.join(' | '));

  // Round-trip parity: a generated page saved without edits writes its data block byte-identical (the page's
  // toDisk + formatJson agree with scripts/disk_format.py), and no positions are saved
  await t.open(page);
  const block = (readFileSync(page, 'utf8').replace(/\r\n/g, '\n').match(/<script id="diagram-data" type="application\/json">([\s\S]*?)<\/script>/) || [])[1];
  await t.ev(t.key('s', { ctrlKey: true }));
  await sleep(300);
  const savedBlock = await t.ev(`document.getElementById('diagram-data').textContent`);
  t.check('Save without edits writes the data block byte-identical to the generated page, with no positions',
    savedBlock === block && !/"(x|y|w|h|elseY|layout)":/.test(savedBlock), JSON.stringify(savedBlock.slice(0, 200)));

  // Present mode
  await t.open(page, '?present');
  t.check('?present makes the diagram read-only', await t.ev(`getComputedStyle(document.querySelector('.seq-participant')).pointerEvents === 'none'`));
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
