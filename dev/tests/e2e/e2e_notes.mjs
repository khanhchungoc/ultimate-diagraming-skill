// Interaction test for flowchart notes: add (N / "+" chip / Note tile; with nothing selected a free note at the view centre), edit (Enter = new line), badge, hover
// peek, the dock's Notes toggle, fitting clear of nodes, drag to pin (the note then follows its node, also through
// Auto-Tidy), linking one note to several steps, delete, undo, and exports leaving peeked notes out; free notes (saved with an empty link
// list and a pos, disk / memory / disk unchanged, left in place by Auto-Tidy, drop on a step links and elsewhere is free, the link handle links one). Driven over the Chrome DevTools Protocol, see cdp.mjs.
//
//   node dev/e2e_notes.mjs --browser <chrome> --page <flowchart.html>
//
// --page: any laid-out flowchart page with at least two steps that have no note (e.g. dev/samples/example-flowchart.html)
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser'), page = argOf('page');
if (!browser || !page) { console.error('usage: --browser <chrome> --page <html>'); process.exit(1); }

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
try {
  await t.open(page);
  // A step without a note: a task if there is one, else any node
  const nodeId = await t.ev(`(document.querySelector('.flow-node.type-task:not(:has(.note-badge))')
    || document.querySelector('.flow-node:not(.type-connector):not(:has(.note-badge))')).dataset.nodeId`);
  const N = `.flow-node[data-node-id="${nodeId}"]`;
  const card = `document.querySelector('.note[data-nodes~="${nodeId}"]')`;
  const visible = (expr) => `(() => { const el = ${expr}; return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0; })()`;
  const key = (k, mods = {}) => `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: '${k}', bubbles: true, cancelable: true }, ${JSON.stringify(mods)})))`;
  const enterKey = key('Enter', { ctrlKey: true });   // finishes a note (a plain Enter adds a line)
  const countOf = `Number(document.querySelector('#btn-notes .btn-count').textContent || 0)`;
  // A click on the empty canvas: down and up, or the shell keeps panning on every later pointer move
  const deselect = `(() => { const c = document.querySelector('#swimlanes-container'); c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); })()`;
  const box = (expr) => `(() => { const r = ${expr}.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`;

  // 1. Selecting a step without a note shows its "+" chip; N opens an empty note
  const startCount = await t.ev(countOf);
  await t.ev(t.drag(N));
  const chip = await t.ev(visible(`document.querySelector('${N} .node-bar [data-act="note"]')`));
  await t.ev(t.key('n'));
  const editing = await t.ev(`document.activeElement && document.activeElement.classList.contains('note-text') && document.activeElement.isContentEditable`);
  t.check('a selected step shows the note button of its bar (no hover + chip), and N opens an empty note for typing', chip && editing, `chip=${chip} editing=${editing}`);

  // 2. Enter adds a line; Ctrl+Enter commits: the node gets a badge, the Notes button counts it
  await t.ev(`document.execCommand('insertText', false, 'Checked against the product checklist')`);
  await t.ev(key('Enter'));
  const stillEditing = await t.ev(`document.activeElement.classList.contains('note-text')`);
  await t.ev(`document.execCommand('insertText', false, 'Second line')`);
  await t.ev(enterKey);
  await sleep(50);
  const badge = await t.ev(`document.querySelector('${N} .note-badge')?.getAttribute('aria-label') || ''`);
  const count = await t.ev(countOf);
  const lines = await t.ev(`${card}.querySelector('.note-text').textContent`);
  t.check('Enter adds a new line and Ctrl+Enter saves the note: badge on the node, Notes count up by one',
    stillEditing && /product checklist\nSecond line/.test(lines) && /product checklist/.test(badge) && count === startCount + 1,
    `editing=${stillEditing} text=${JSON.stringify(lines)} badge=${badge} count ${startCount}->${count}`);

  // 3. Undo removes the note, redo brings it back
  await t.ev(`document.activeElement && document.activeElement.blur()`);
  await t.ev(t.key('z', { ctrlKey: true }));
  const undone = await t.ev(`!document.querySelector('${N} .note-badge')`);
  await t.ev(t.key('y', { ctrlKey: true }));
  const redone = await t.ev(`!!document.querySelector('${N} .note-badge')`);
  t.check('Ctrl+Z removes the new note and Ctrl+Y restores it', undone && redone, `undo=${undone} redo=${redone}`);

  // 4. Hidden by default; hovering the badge peeks it at once, leaving lets it go
  await t.ev(deselect);
  const hiddenAtRest = !(await t.ev(visible(card)));
  await t.ev(`document.querySelector('${N} .note-badge').dispatchEvent(new MouseEvent('mouseenter'))`);
  await sleep(60);
  const peeked = await t.ev(visible(card));
  // While peeked, an export leaves it out (it shows only what the Notes button shows)
  const inExport = await t.ev(`(() => { document.body.classList.add('exporting'); const v = getComputedStyle(${card}).display; document.body.classList.remove('exporting'); return v; })()`);
  await t.ev(`document.querySelector('${N} .note-badge').dispatchEvent(new MouseEvent('mouseleave'))`);
  await t.ev(`document.querySelector('${N}').dispatchEvent(new MouseEvent('mouseleave'))`);
  await sleep(350);
  const gone = !(await t.ev(visible(card)));
  t.check('notes are hidden at rest, the badge peeks one on hover, it hides again on leave, and exports skip a peeked note',
    hiddenAtRest && peeked && gone && inExport === 'none', `rest=${hiddenAtRest} peek=${peeked} leave=${gone} export=${inExport}`);

  // 5. The Notes button shows every note, fitted clear of every node; badges step aside
  await t.ev(`document.getElementById('btn-notes').click()`);
  const shown = await t.ev(visible(card));
  const pressed = await t.ev(`document.getElementById('btn-notes').getAttribute('aria-pressed')`);
  const badgeHidden = !(await t.ev(visible(`document.querySelector('${N} .note-badge')`)));
  const clear = await t.ev(`(() => {
    const c = ${card}.getBoundingClientRect();
    return [...document.querySelectorAll('.flow-node')].every(n => { const r = n.getBoundingClientRect();
      return c.right <= r.left || c.left >= r.right || c.bottom <= r.top || c.top >= r.bottom; });
  })()`);
  const leader = await t.ev(`(() => { const l = document.querySelector('.note-leader[data-node-id="${nodeId}"]'); return !!l && getComputedStyle(l).display !== 'none'; })()`);
  t.check('Notes shows every note (pressed, badges hidden) with a leader, fitted clear of all nodes',
    shown && pressed === 'true' && badgeHidden && clear && leader, `shown=${shown} pressed=${pressed} badge=${!badgeHidden} clear=${clear} leader=${leader}`);

  // 6. Drag the note: it moves freely, then follows its node when the node is dragged, and through Auto-Tidy
  const offsetOf = `(() => { const c = ${card}.getBoundingClientRect(), n = document.querySelector('${N}').getBoundingClientRect(); return [Math.round(c.left - n.left), Math.round(c.top - n.top)]; })()`;
  const before = await t.ev(offsetOf);
  await t.ev(t.drag(`.note[data-nodes~="${nodeId}"]`, 40, 60));
  const moved = await t.ev(offsetOf);
  await t.ev(t.drag(N, 0, 24));
  const afterNodeDrag = await t.ev(offsetOf);
  await t.ev(`document.getElementById('btn-auto-tidy').click()`);
  await sleep(50);
  const afterTidy = await t.ev(offsetOf);
  const near = (a, b, tol = 6) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
  t.check('a dragged note stays where it is put and keeps its place beside its node (node drag, Auto-Tidy)',
    !near(before, moved) && near(moved, afterNodeDrag) && near(moved, afterTidy),
    `before=${before} moved=${moved} nodeDrag=${afterNodeDrag} tidy=${afterTidy}`);

  // 7. Double-click edits; clearing the text removes the note
  await t.ev(`${card}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  const reEdit = await t.ev(`document.activeElement.classList.contains('note-text')`);
  await t.ev(`document.execCommand('selectAll'); document.execCommand('delete')`);
  await t.ev(enterKey);
  await sleep(50);
  const clearedGone = await t.ev(`!document.querySelector('${N} .note-badge') && !${card}`);
  await t.ev(t.key('z', { ctrlKey: true }));
  t.check('double-click edits a note, and an emptied note is removed', reEdit && clearedGone, `edit=${reEdit} gone=${clearedGone}`);

  // 8. Clicking a note selects it; Delete removes only the note (not its step)
  const nodesBefore = await t.ev(`document.querySelectorAll('.flow-node').length`);
  await t.ev(t.drag(`.note[data-nodes~="${nodeId}"]`));
  const sel = await t.ev(`${card}.classList.contains('selected')`);
  await t.ev(t.key('Delete'));
  const deleted = await t.ev(`!${card} && !document.querySelector('${N} .note-badge')`);
  const nodesAfter = await t.ev(`document.querySelectorAll('.flow-node').length`);
  t.check('a clicked note is selected and Delete removes the note but keeps its step', sel && deleted && nodesAfter === nodesBefore,
    `selected=${sel} deleted=${deleted} nodes ${nodesBefore}->${nodesAfter}`);

  // 9. A note opened and left empty is dropped without an undo step
  await t.ev(t.drag(N));
  await t.ev(t.key('n'));
  await t.ev(enterKey);
  await sleep(50);
  t.check('a note left empty is not kept', await t.ev(`!document.querySelector('${N} .note-badge') && !${card}`));

  // 10. Shapes › Note tile: click with a step selected adds the note there; with nothing selected it waits for a
  // step (prompt shown; Escape cancels); dragging it onto a step gives that step the note
  const type = (s) => t.ev(`document.execCommand('insertText', false, ${JSON.stringify(s)})`);
  await t.ev(t.drag(N));
  await t.ev(`document.getElementById('btn-add-note').click()`);
  await sleep(30);   // the note opens once the click is done (the Shapes bubble moves focus first)
  await type('From the tile');
  await t.ev(enterKey);
  await sleep(50);
  const viaClick = await t.ev(`document.querySelector('${N} .note-badge')?.getAttribute('aria-label') || ''`);
  t.check('Note tile click adds a note to the selected step', /From the tile/.test(viaClick), `badge=${viaClick}`);

  // Nothing selected: the tile (and N) add a free note at the centre of the view: no links, no badge, no leader
  await t.ev(deselect);
  await t.ev(`document.getElementById('btn-add-note').click()`);
  await sleep(30);
  await type('Centred');
  await t.ev(enterKey);
  await sleep(50);
  const freeCard = (txt) => `[...document.querySelectorAll('.note')].find(c => c.dataset.nodes === '' && c.textContent.includes('${txt}'))`;
  const centred = await t.ev(`(() => { const v = document.getElementById('viewport').getBoundingClientRect(), el = ${freeCard('Centred')}; if (!el) return null;
    const c = el.getBoundingClientRect(); return [Math.round(c.left + c.width / 2 - (v.left + v.width / 2)), Math.round(c.top + c.height / 2 - (v.top + v.height / 2)), getComputedStyle(el).display]; })()`);
  const noMarks = await t.ev(`(() => { const el = ${freeCard('Centred')}; return !!el && !document.querySelector('.note-leader[data-note-id="' + el.dataset.noteId + '"]') && ![...document.querySelectorAll('.note-badge')].some(b => /Centred/.test(b.getAttribute('aria-label'))); })()`);
  await t.ev(deselect);
  await t.ev(t.key('n'));
  await type('By key');
  await t.ev(enterKey);
  await sleep(50);
  t.check('with nothing selected the Note tile and N add a free note at the view centre: shown at rest, no leader, no badge',
    !!centred && Math.abs(centred[0]) < 120 && Math.abs(centred[1]) < 60 && centred[2] !== 'none' && noMarks && (await t.ev(`!!(${freeCard('By key')})`)),
    `centre=${centred} noMarks=${noMarks}`);

  // Target: a step without a note that the pointer can actually reach (on screen, not under a note or the
  // dock), chosen in the same instant as the drag
  const [third, dropped] = await t.ev(`(async () => {
    const n = [...document.querySelectorAll('.flow-node')].find(n => {
      if (n.querySelector('.note-badge') || n.classList.contains('type-connector')) return false;   // a connector takes no notes
      const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit && hit.closest('.flow-node') === n;
    });
    if (!n) return [null, 'no reachable step without a note'];
    const tile = document.getElementById('btn-add-note'), a = tile.getBoundingClientRect(), b = n.getBoundingClientRect();
    const x = b.left + b.width / 2, y = b.top + b.height / 2;
    const o = (cx, cy) => ({ bubbles: true, button: 0, clientX: cx, clientY: cy, pointerId: 1, isPrimary: true });
    tile.dispatchEvent(new PointerEvent('pointerdown', o(a.left + 5, a.top + 5)));
    window.dispatchEvent(new PointerEvent('pointermove', o(a.left + 40, a.top - 40)));
    window.dispatchEvent(new PointerEvent('pointermove', o(x, y)));
    const lit = n.classList.contains('note-target') && !!document.querySelector('.note-ghost');
    window.dispatchEvent(new PointerEvent('pointerup', o(x, y)));
    return [n.dataset.nodeId, lit];
  })()`);
  const T = `.flow-node[data-node-id="${third}"]`;
  await type('Dropped');
  await t.ev(enterKey);
  await sleep(50);
  const viaDrop = await t.ev(`document.querySelector('${T} .note-badge')?.getAttribute('aria-label') || ''`);
  const tidy = await t.ev(`!document.querySelector('.note-ghost') && !document.querySelector('.note-target')`);
  t.check('dragging the Note tile highlights the step under it and drops a note onto it', dropped === true && /Dropped/.test(viaDrop) && tidy,
    `highlight=${dropped} badge=${viaDrop} cleanedUp=${tidy}`);

  // 11. One note, several steps: with the note selected, Shift+click a step links it (a second badge and leader,
  // both steps outlined); again unlinks it; dragging the link handle onto a step links it too; the last link stays
  const noteId = await t.ev(`${card}.dataset.noteId`);
  const C = `document.querySelector('.note[data-note-id="${noteId}"]')`;
  const reachable = `[...document.querySelectorAll('.flow-node')].filter(n => {
    if (n.dataset.nodeId === '${nodeId}' || n.querySelector('.note-badge') || n.classList.contains('type-connector')) return false;   // steps with no note of their own (a connector takes none)
    const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit && hit.closest('.flow-node') === n;
  })`;
  const L1 = await t.ev(`${reachable}[0].dataset.nodeId`), L2 = L1;   // L1 is free again once unlinked
  const linkState = (id) => t.ev(`[document.querySelectorAll('.note-leader[data-note-id="${noteId}"]').length,
    document.querySelectorAll('.flow-node.note-linked').length, !!document.querySelector('.flow-node[data-node-id="${id}"] .note-badge')]`);
  const shiftClick = (id) => t.ev(`(() => { const n = document.querySelector('.flow-node[data-node-id="${id}"]'), r = n.getBoundingClientRect();
    const o = { bubbles: true, button: 0, shiftKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, isPrimary: true };
    n.dispatchEvent(new PointerEvent('pointerdown', o)); window.dispatchEvent(new PointerEvent('pointerup', o)); })()`);
  await t.ev(t.drag(`.note[data-note-id="${noteId}"]`));
  await shiftClick(L1);
  const linked = await linkState(L1);
  await shiftClick(L1);
  const unlinked = await linkState(L1);
  t.check('Shift+click links a selected note to another step (two leaders, both outlined, badge) and again unlinks it',
    linked[0] === 2 && linked[1] === 2 && linked[2] && unlinked[0] === 1 && !unlinked[2], `linked=${linked} unlinked=${unlinked}`);

  const viaHandle = await t.ev(`(() => {
    const h = ${C}.querySelector('.note-link'), a = h.getBoundingClientRect();
    const b = document.querySelector('.flow-node[data-node-id="${L2}"]').getBoundingClientRect();
    const o = (x, y) => ({ bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1, isPrimary: true });
    h.dispatchEvent(new PointerEvent('pointerdown', o(a.left + 5, a.top + 5)));
    window.dispatchEvent(new PointerEvent('pointermove', o(b.left + b.width / 2, b.top + b.height / 2)));
    const lit = document.querySelector('.flow-node[data-node-id="${L2}"]').classList.contains('note-target');
    window.dispatchEvent(new PointerEvent('pointerup', o(b.left + b.width / 2, b.top + b.height / 2)));
    return lit;
  })()`);
  const handleLinked = await linkState(L2);
  await shiftClick(L2);
  await shiftClick(nodeId);   // the last link: refused
  const lastKept = await t.ev(`!!${C} && document.querySelectorAll('.note-leader[data-note-id="${noteId}"]').length === 1`);
  t.check('dragging the link handle onto a step links it; the last link cannot be removed',
    viaHandle && handleLinked[0] === 2 && handleLinked[2] && lastKept, `highlight=${viaHandle} state=${handleLinked} lastKept=${lastKept}`);

  // 12. Free notes: no links, an absolute pos
  const saved = async () => { await t.press('s', { modifiers: 2 }); await sleep(250); return t.ev(`document.getElementById('diagram-data').textContent`); };
  const raw1 = await saved(), d1 = JSON.parse(raw1);
  const free1 = (d1.notes || []).filter((n) => !(n.nodes || []).length);
  t.check('free notes are saved with an empty link list and a numeric pos (no new key)',
    free1.length >= 2 && free1.every((n) => Number.isFinite(n.pos?.x) && Number.isFinite(n.pos?.y) && Object.keys(n).every((k) => ['id', 'text', 'nodes', 'pos'].includes(k))), JSON.stringify(free1));
  const dir = mkdtempSync(join(tmpdir(), 'e2e_notes_'));
  const again = join(dir, 'again.html');
  writeFileSync(again, readFileSync(page, 'utf8').replace(/(<script id="diagram-data" type="application\/json">)[\s\S]*?(<\/script>)/, (m, a, b) => a + raw1 + b));
  await t.open(again);
  const raw2 = await saved();
  const shownAgain = await t.ev(`[...document.querySelectorAll('.note')].filter(c => c.dataset.nodes === '' && getComputedStyle(c).display !== 'none').length`);
  t.check('a free note round trips: disk, memory, disk is the same text, and both free notes are on show at rest', raw2 === raw1 && shownAgain === free1.length, `shown=${shownAgain} same=${raw2 === raw1}`);

  // Auto-Tidy and a node drag leave a free note where it is (in the container's own units)
  const place = (txt) => t.ev(`(() => { const el = ${freeCard(txt)}, k = document.getElementById('swimlanes-container'), c = el.getBoundingClientRect(), r = k.getBoundingClientRect(), f = r.width / k.offsetWidth;
    return [Math.round((c.left - r.left) / f), Math.round((c.top - r.top) / f)]; })()`);
  const f0 = await place('Centred');
  await t.ev(t.drag(N, 0, 40));
  await t.ev(`document.getElementById('btn-auto-tidy').click()`);
  await sleep(120);
  const f1 = await place('Centred');
  t.check('Auto-Tidy leaves a free note in place', near(f0, f1, 2), `before=${f0} after=${f1}`);

  // Dropping the Note tile on empty canvas makes a free note there; on a step it links (checked above)
  const spot = await t.ev(`(() => { const v = document.getElementById('viewport').getBoundingClientRect();
    for (let y = v.top + 90; y < v.bottom - 160; y += 24) for (let x = v.left + 60; x < v.right - 260; x += 24) {
      const h = document.elementFromPoint(x, y);
      if (h && document.getElementById('viewport').contains(h) && !h.closest('.flow-node, .note, .edge-label, .lane-pill, .dock-area, .zoom-dock, .toolbar') && !['path', 'line', 'polyline'].includes(h.tagName)) return [x, y];
    } return null; })()`);
  const nodesWithBadge = () => t.ev(`document.querySelectorAll('.note-badge').length`);
  const badges0 = await nodesWithBadge();
  await t.ev(`(() => { const tile = document.getElementById('btn-add-note'), a = tile.getBoundingClientRect();
    const o = (cx, cy) => ({ bubbles: true, button: 0, clientX: cx, clientY: cy, pointerId: 1, isPrimary: true });
    tile.dispatchEvent(new PointerEvent('pointerdown', o(a.left + 5, a.top + 5)));
    window.dispatchEvent(new PointerEvent('pointermove', o(a.left + 40, a.top - 40)));
    window.dispatchEvent(new PointerEvent('pointermove', o(${spot[0]}, ${spot[1]})));
    window.dispatchEvent(new PointerEvent('pointerup', o(${spot[0]}, ${spot[1]}))); })()`);
  await sleep(30);
  await type('Dropped free');
  await t.ev(enterKey);
  await sleep(50);
  const dropAt = await t.ev(`(() => { const c = ${freeCard('Dropped free')}; if (!c) return null; const r = c.getBoundingClientRect(); return [Math.round(r.left - ${spot[0]}), Math.round(r.top - ${spot[1]})]; })()`);
  t.check('dropping the Note tile on empty canvas makes a free note at the drop point (no badge, no link)',
    !!dropAt && Math.abs(dropAt[0]) < 16 && Math.abs(dropAt[1]) < 16 && (await nodesWithBadge()) === badges0, `offset=${dropAt} badges ${badges0}->${await nodesWithBadge()}`);

  // A free note's link handle: dropped on a step it becomes anchored, and stays where it is; then its last link is kept
  const target = await t.ev(`${reachable}[0].dataset.nodeId`);
  const cardBox = () => t.ev(`(() => { const r = ${freeCard('Dropped free')}.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; })()`);
  const where0 = await cardBox();
  await t.ev(t.drag(`.note[data-note-id="${await t.ev(`${freeCard('Dropped free')}.dataset.noteId`)}"]`));
  await t.ev(`(() => { const h = ${freeCard('Dropped free')}.querySelector('.note-link'), a = h.getBoundingClientRect();
    const b = document.querySelector('.flow-node[data-node-id="${target}"]').getBoundingClientRect();
    const o = (x, y) => ({ bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1, isPrimary: true });
    h.dispatchEvent(new PointerEvent('pointerdown', o(a.left + 5, a.top + 5)));
    window.dispatchEvent(new PointerEvent('pointermove', o(b.left + b.width / 2, b.top + b.height / 2)));
    window.dispatchEvent(new PointerEvent('pointerup', o(b.left + b.width / 2, b.top + b.height / 2))); })()`);
  await sleep(50);
  const where1 = await t.ev(`(() => { const c = document.querySelector('.note[data-nodes~="${target}"]'); if (!c) return null; const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; })()`);
  const d3 = JSON.parse(await saved());
  const freeLinked = (d3.notes || []).find((n) => n.text === 'Dropped free');
  await shiftClick(target);   // the last link cannot be removed
  const stillLinked = (JSON.parse(await saved()).notes || []).find((n) => n.text === 'Dropped free');
  t.check('dragging a free note onto a step links it (it stays where it is, now relative to the step, with a leader and a badge); the link then stays',
    !!where1 && near(where0, where1, 2) && freeLinked && freeLinked.nodes.join() === target && Number.isFinite(freeLinked.pos?.x) && stillLinked.nodes.join() === target
      && (await t.ev(`!!document.querySelector('.flow-node[data-node-id="${target}"] .note-badge') && !!document.querySelector('.note-leader[data-node-id="${target}"]')`)),
    `before=${where0} after=${where1} note=${JSON.stringify(freeLinked)}`);

  t.check('no script errors', t.errors.length === 0, t.errors.join(' | '));
  code = t.finish();
} catch (err) {
  console.error('[ERROR]', err.stack || err.message);
  code = 1;
} finally {
  await t.close();
}
process.exit(code);
