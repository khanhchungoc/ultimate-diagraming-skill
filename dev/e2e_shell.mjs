// Interaction test for the shared shell through the flowchart plugin (the shell is type-independent;
// dev/e2e_sequence.mjs covers the second plugin). Driven over the Chrome DevTools Protocol, see cdp.mjs.
//
//   node dev/e2e_shell.mjs --browser <chrome> --laid <laid-out.html> --scrambled <scrambled-positions.html>
//
// --laid:      page produced by `layout_engine.py --layout` (reference positions)
// --scrambled: same diagram with node x/y scrambled (Auto-Tidy must restore the reference positions)
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser'), laid = argOf('laid'), scrambled = argOf('scrambled');
if (!browser || !laid || !scrambled) { console.error('usage: --browser <chrome> --laid <html> --scrambled <html>'); process.exit(1); }

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
try {
  const positions = `JSON.stringify([...document.querySelectorAll('.flow-node')].map(n => [n.dataset.nodeId, n.style.left, n.style.top]).sort())`;

  // 1. Load: plugin registered, content rendered, no errors
  await t.open(laid);
  const refPositions = await t.ev(positions);
  const nodeCount = await t.ev(`document.querySelectorAll('.flow-node').length`);
  t.check('laid-out page renders nodes without errors', nodeCount > 0 && t.errors.length === 0, `nodes=${nodeCount} errors=${t.errors.join(' | ')}`);

  // 2. Selection + Delete key (shell keydown -> plugin.deleteSelection)
  const firstId = await t.ev(`document.querySelector('.flow-node').dataset.nodeId`);
  await t.ev(t.drag('.flow-node'));
  const selected = await t.ev(`!!document.querySelector('.flow-node.selected')`);
  await t.ev(t.key('Delete'));
  const afterDelete = await t.ev(`document.querySelectorAll('.flow-node').length`);
  const gone = await t.ev(`!document.querySelector('.flow-node[data-node-id="${firstId}"]')`);
  t.check('Delete key removes the selected node via plugin.deleteSelection', selected && afterDelete === nodeCount - 1 && gone, `selected=${selected} before=${nodeCount} after=${afterDelete}`);

  // 3. Background click clears selection (shell pointerdown -> plugin.isBackground/clearSelection); Escape is safe
  await t.ev(`document.getElementById('viewport').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5, pointerId: 1 }))`);
  await t.ev(`window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))`);
  await t.ev(t.key('Escape'));
  t.check('background click and Escape leave no selection and raise no errors', (await t.ev(`!document.querySelector('.flow-node.selected')`)) && t.errors.length === 0, t.errors.join(' | '));

  // 4. Theme toggle (shell) re-renders through the plugin
  const before = await t.ev(`document.documentElement.getAttribute('data-theme')`);
  await t.ev(`document.getElementById('btn-theme').click()`);
  const afterTheme = await t.ev(`document.documentElement.getAttribute('data-theme')`);
  t.check('theme toggle flips data-theme and keeps the diagram', before !== afterTheme && (await t.ev(`document.querySelectorAll('.flow-node').length`)) === nodeCount - 1 && t.errors.length === 0, t.errors.join(' | '));

  // 5. Auto-Tidy button restores the reference layout from scrambled positions
  await t.open(scrambled);
  const scrambledPositions = await t.ev(positions);
  await t.ev(`document.getElementById('btn-auto-tidy').click()`);
  await sleep(300);
  const tidied = await t.ev(positions);
  const status = await t.ev(`document.getElementById('save-status').textContent`);
  t.check('scrambled page differs from the reference before Auto-Tidy', scrambledPositions !== refPositions);
  t.check('Auto-Tidy button restores the reference positions', tidied === refPositions, `got ${tidied.slice(0, 120)}...`);
  t.check('Auto-Tidy marks the document unsaved', /unsaved/i.test(status), status);

  // 6. Ctrl+S runs the shell save path without throwing (the file dialog itself needs a user click)
  await t.ev(t.key('s', { ctrlKey: true }));
  await sleep(500);
  t.check('Ctrl+S save path raises no errors', t.errors.length === 0, t.errors.join(' | '));

  // 7. ?present hides editing chrome
  await t.open(laid, '?present');
  t.check('?present hides Save and toolbar', await t.ev(`document.body.classList.contains('presentation') && getComputedStyle(document.getElementById('btn-save')).display === 'none' && getComputedStyle(document.querySelector('.toolbar-center')).display === 'none'`));
} catch (err) {
  console.error('[ERROR]', err.message);
  code = 1;
} finally {
  await t.close();
}
process.exit(code || t.finish());
