// Interaction test for the shared shell through the flowchart plugin (the shell is type-independent;
// dev/e2e_sequence.mjs covers the second plugin). Driven over the Chrome DevTools Protocol, see cdp.mjs.
//
//   node dev/e2e_shell.mjs --browser <chrome> --laid <laid-out.html> --scrambled <scrambled-positions.html> [--artifact <dir/index.html>]
//
// --laid:      page produced by `layout_engine.py --layout` (reference positions)
// --scrambled: same diagram with node x/y scrambled (Auto-Tidy must restore the reference positions)
// --artifact:  split artifact index.html from `layout_engine.py --layout ... --target artifact` (enables the claude.ai
//              Artifact checks: Save publishes diagram.json through a stubbed window.claude, see dev/plans/plan-artifact-split-files.md)
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser'), laid = argOf('laid'), scrambled = argOf('scrambled'), artifact = argOf('artifact');
if (!browser || !laid || !scrambled) { console.error('usage: --browser <chrome> --laid <html> --scrambled <html>'); process.exit(1); }

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
const dlDir = mkdtempSync(join(tmpdir(), 'save_'));
let code = 0;
try {
  const positions = `JSON.stringify([...document.querySelectorAll('.flow-node')].map(n => [n.dataset.nodeId, n.style.left, n.style.top]).sort())`;

  await t.section('core-tidy-save', async () => {
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

  // 2b. Undo / redo (shell history snapshots taken at updateStatus(true))
  await t.ev(t.key('z', { ctrlKey: true }));
  const afterUndo = await t.ev(`document.querySelectorAll('.flow-node').length`);
  const backAgain = await t.ev(`!!document.querySelector('.flow-node[data-node-id="${firstId}"]')`);
  const undoStatus = await t.ev(`document.getElementById('save-status').textContent`);
  t.check('Ctrl+Z restores the deleted node and clears the Unsaved badge', afterUndo === nodeCount && backAgain && !/unsaved/i.test(undoStatus), `after=${afterUndo} status=${undoStatus}`);
  await t.ev(t.key('y', { ctrlKey: true }));
  const afterRedo = await t.ev(`document.querySelectorAll('.flow-node').length`);
  t.check('Ctrl+Y redoes the delete', afterRedo === nodeCount - 1 && (await t.ev(`document.getElementById('btn-redo').disabled`)), `after=${afterRedo}`);

  // 2b2. Auto-tidy on edit: after a structural edit every node sits where the engine puts it; a drag inside the
  // lane snaps back into the flow; each edit plus its re-layout is one undo step
  // "Already tidy" = pressing Auto-Tidy moves nothing (an unchanged snapshot adds no undo step, so this probe is safe)
  const tidy = `(() => { const pos = () => JSON.stringify([...document.querySelectorAll('.flow-node')].map(n => [n.dataset.nodeId, n.style.left, n.style.top]));
    const a = pos(); document.getElementById('btn-auto-tidy').click(); return a === pos(); })()`;
  t.check('after a delete the layout equals a fresh Auto-Tidy', await t.ev(tidy));
  const dragId = await t.ev(`document.querySelectorAll('.flow-node')[1].dataset.nodeId`);
  const posOf = `(() => { const n = document.getElementById('node-${dragId}'); return [n.style.left, n.style.top, n.closest('.lane-track').dataset.laneId]; })()`;
  const before2 = await t.ev(posOf);
  await t.ev(t.drag(`.flow-node[data-node-id="${dragId}"]`, 160, 0));
  const after2 = await t.ev(posOf);
  t.check('a drag inside the lane is re-laid out back into the flow', JSON.stringify(before2) === JSON.stringify(after2) && (await t.ev(tidy)),
    `${JSON.stringify(before2)} -> ${JSON.stringify(after2)}`);
  // Drag it into the next lane: it keeps that lane, the rest re-flows, and one Ctrl+Z puts it back
  const dyLane = await t.ev(`(() => { const el = document.getElementById('node-${dragId}'), L = el.closest('.swimlane'), nx = L.nextElementSibling || L.previousElementSibling;
    const r = el.getBoundingClientRect(), q = nx.getBoundingClientRect(); return (q.top + q.height / 2 - (r.top + r.height / 2)); })()`);
  await t.ev(t.drag(`.flow-node[data-node-id="${dragId}"]`, 0, dyLane));
  const after3 = await t.ev(posOf);
  t.check('a drag into another lane keeps that lane and re-lays out the diagram', after3[2] !== before2[2] && (await t.ev(tidy)), `${before2[2]} -> ${after3[2]}`);
  await t.ev(t.key('z', { ctrlKey: true }));
  t.check('one Ctrl+Z undoes the move and its re-layout', JSON.stringify(await t.ev(posOf)) === JSON.stringify(before2)
    && (await t.ev(`document.querySelectorAll('.flow-node').length`)) === nodeCount - 1);

  // 2b3. Arrow edits never re-lay out (so the order can be rewired one arrow at a time); undo brings the arrow back
  const allPos = `JSON.stringify([...document.querySelectorAll('.flow-node')].map(n => [n.dataset.nodeId, n.style.left, n.style.top]))`;
  const posBeforeArrow = await t.ev(allPos);
  const edgesBefore = await t.ev(`document.querySelectorAll('.edge-line').length`);
  await t.ev(`document.querySelector('.edge-hit').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await t.ev(t.key('Delete'));
  t.check('deleting an arrow moves no step', (await t.ev(`document.querySelectorAll('.edge-line').length`)) === edgesBefore - 1
    && (await t.ev(allPos)) === posBeforeArrow);
  await t.ev(t.key('z', { ctrlKey: true }));

  // 2b4. The dock's Auto-Tidy switch: off, a drag inside the lane stays where it is dropped; turning it on tidies at once
  const autoBtn = `document.getElementById('btn-auto-layout')`;
  t.check('the Auto-Tidy switch is on by default', (await t.ev(`${autoBtn}.getAttribute('aria-checked')`)) === 'true');
  await t.ev(`${autoBtn}.click()`);
  await t.ev(t.drag(`.flow-node[data-node-id="${dragId}"]`, 160, 0));
  const manual = await t.ev(posOf);
  t.check('Auto off: a dragged step stays where it is dropped', (await t.ev(`${autoBtn}.getAttribute('aria-checked')`)) === 'false'
    && manual[0] !== before2[0], `${JSON.stringify(before2)} -> ${JSON.stringify(manual)}`);
  await t.ev(`${autoBtn}.click()`);
  t.check('turning Auto back on re-lays out the diagram', JSON.stringify(await t.ev(posOf)) === JSON.stringify(before2) && (await t.ev(tidy)));
  await t.ev(t.key('z', { ctrlKey: true }));
  await t.ev(t.key('z', { ctrlKey: true }));

  // 2c. Lanes alternate white / grey (no lane-colour tint); click a lane pill + Delete removes the lane with its
  // steps; undo restores it
  const laneBgs = await t.ev(`[...document.querySelectorAll('.lane-track')].slice(0, 2).map(e => getComputedStyle(e).backgroundColor)`);
  t.check('lanes alternate two plain backgrounds', laneBgs.length === 2 && laneBgs[0] !== laneBgs[1]
    && laneBgs.every(c => { const [r, g, b] = c.match(/\d+/g).map(Number); return Math.max(r, g, b) - Math.min(r, g, b) <= 8; }), JSON.stringify(laneBgs));
  const lanesBefore = await t.ev(`document.querySelectorAll('.swimlane').length`);
  const nodesBefore = await t.ev(`document.querySelectorAll('.flow-node').length`);
  const laneNodes = await t.ev(`document.querySelectorAll('.swimlane:nth-child(2) .flow-node').length`);
  await t.ev(`document.querySelector('.swimlane:nth-child(2) .lane-pill').click()`);
  const laneSel = await t.ev(`!!document.querySelector('.swimlane:nth-child(2).lane-selected')`);
  await t.ev(t.key('Delete'));
  // Deleting a lane asks first: the popover names the lane; Cancel (and Escape) keep it
  const asked = await t.ev(`document.querySelector('.confirm')?.textContent || ''`);
  await t.ev(`document.querySelector('.confirm-cancel').click()`);
  const keptOnCancel = (await t.ev(`document.querySelectorAll('.swimlane').length`)) === lanesBefore && !(await t.ev(`!!document.querySelector('.confirm')`));
  await t.ev(t.key('Delete'));
  await t.ev(t.key('Escape'));
  const keptOnEscape = (await t.ev(`document.querySelectorAll('.swimlane').length`)) === lanesBefore && !(await t.ev(`!!document.querySelector('.confirm')`));
  t.check('deleting a lane asks for confirmation; Cancel and Escape keep the lane', /delete/i.test(asked) && keptOnCancel && keptOnEscape,
    `asked=${JSON.stringify(asked)} cancel=${keptOnCancel} escape=${keptOnEscape}`);
  await t.ev(t.key('Delete'));
  await t.ev(`document.querySelector('.confirm-ok').click()`);
  const lanesAfter = await t.ev(`document.querySelectorAll('.swimlane').length`);
  const nodesAfter = await t.ev(`document.querySelectorAll('.flow-node').length`);
  t.check('clicking a lane pill selects the lane and Delete (confirmed) removes it with its steps', laneSel && lanesAfter === lanesBefore - 1
    && nodesAfter === nodesBefore - laneNodes, `selected=${laneSel} lanes ${lanesBefore}->${lanesAfter} nodes ${nodesBefore}->${nodesAfter} (lane had ${laneNodes})`);
  await t.ev(t.key('z', { ctrlKey: true }));
  t.check('Ctrl+Z restores the deleted lane', (await t.ev(`document.querySelectorAll('.swimlane').length`)) === lanesBefore
    && (await t.ev(`document.querySelectorAll('.flow-node').length`)) === nodesBefore);

  // 2d. Hovering a lane shows no action bar; selecting it (pill click) shows it (rename, delete, colour: only that lane), and delete removes the lane
  const toolsShown = await t.ev(`(() => {
    const L = document.querySelector('.swimlane:nth-child(2)'), r = L.getBoundingClientRect();
    L.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + 400, clientY: r.top + 40 }));
    const vis = el => !!el && el.getBoundingClientRect().width > 0;
    const onHover = vis(L.querySelector('.lane-bar'));
    L.querySelector('.lane-pill').click();
    return [onHover, vis(L.querySelector('.lane-bar [data-act="rename"]')), vis(L.querySelector('.lane-bar [data-act="delete"]')),
      vis(document.querySelector('.swimlane:nth-child(1) .lane-bar')), !!L.querySelector('.lane-tools')];
  })()`);
  await t.ev(`document.querySelector('.swimlane:nth-child(2) .lane-bar [data-act="delete"]').click()`);
  await t.ev(`document.querySelector('.confirm-ok').click()`);
  const lanesAfterTool = await t.ev(`document.querySelectorAll('.swimlane').length`);
  t.check('hovering a lane hides its bar; selecting it shows rename + delete (only that lane), and delete (confirmed) removes the lane',
    !toolsShown[0] && toolsShown[1] && toolsShown[2] && !toolsShown[3] && !toolsShown[4] && lanesAfterTool === lanesBefore - 1, `${JSON.stringify(toolsShown)} lanes=${lanesAfterTool}`);
  await t.ev(t.key('z', { ctrlKey: true }));

  // 2d2. The pill reads as a drag handle: move cursor, and a primary ring when the pointer is on it
  const pillLook = await t.ev(`(() => {
    const p = document.querySelector('.swimlane:nth-child(1) .lane-pill'), cs = getComputedStyle(p);
    // (skip the cross-origin Google Fonts sheet: reading its rules throws)
    const ring = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch (_) { return []; } }).find(r => r.selectorText === '.swatch-pill:hover');
    return [cs.cursor, ring ? ring.style.boxShadow : ''];
  })()`);
  t.check('the lane pill shows a move cursor and a 2px primary ring on hover', pillLook[0] === 'move' && pillLook[1].includes('var(--ring-md) var(--primary)'), JSON.stringify(pillLook));

  // 2e. A real (native, trusted) drag of the pill itself moves the lane: mouse press on the pill, move down past the
  // third lane, release (Chrome runs the HTML5 drag-and-drop itself)
  const gripNames = `[...document.querySelectorAll('.lane-title')].map(e => e.textContent)`;
  const namesBefore = await t.ev(gripNames);
  const [gx, gy, tx, ty] = await t.ev(`(() => {
    const L = document.querySelectorAll('.swimlane');
    const g = L[0].querySelector('.lane-pill').getBoundingClientRect(), d = L[2].getBoundingClientRect();
    return [g.left + g.width / 2, g.top + g.height / 2, d.left + 400, d.bottom - 10];
  })()`);
  const mouse = (type, x, y, buttons = 1) => t.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 });
  await mouse('mouseMoved', gx, gy, 0);
  await mouse('mousePressed', gx, gy);
  for (let k = 1; k <= 20; k++) await mouse('mouseMoved', gx + (tx - gx) * k / 20, gy + (ty - gy) * k / 20);
  await mouse('mouseReleased', tx, ty, 0);
  await new Promise((r) => setTimeout(r, 300));
  const namesAfter = await t.ev(gripNames);
  t.check('dragging the lane pill moves the lane (real mouse drag)', namesAfter[2] === namesBefore[0] && namesAfter[0] === namesBefore[1],
    `${JSON.stringify(namesBefore)} -> ${JSON.stringify(namesAfter)}`);
  await t.ev(t.key('z', { ctrlKey: true }));

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
  const stageView = `document.getElementById('stage').style.transform`;
  await t.ev(`document.getElementById('btn-zoom-in').click()`);
  await sleep(260);
  const viewBefore = await t.ev(stageView);
  await t.ev(`document.getElementById('btn-auto-tidy').click()`);
  await sleep(300);
  const tidied = await t.ev(positions);
  t.check('Auto-Tidy keeps the current zoom and pan', viewBefore !== '' && (await t.ev(stageView)) === viewBefore, `before=${viewBefore}`);
  const status = await t.ev(`document.getElementById('save-status').textContent`);
  t.check('scrambled page differs from the reference before Auto-Tidy', scrambledPositions !== refPositions);
  t.check('Auto-Tidy button restores the reference positions', tidied === refPositions, `got ${tidied.slice(0, 120)}...`);
  t.check('Auto-Tidy marks the document unsaved', /unsaved/i.test(status), status);

  // 6. Ctrl+S runs the shell save path without throwing (the file dialog itself needs a user click)
  await t.ev(t.key('s', { ctrlKey: true }));
  await sleep(500);
  t.check('Ctrl+S save path raises no errors', t.errors.length === 0, t.errors.join(' | '));

  // 6b. First Save of a file opened from disk when directory picking is unavailable (no Link folder button):
  //     Save copies the file's path at once and shows it in a bubble; the bubble's button opens the dialog.
  await t.open(laid);
  await t.ev(`(() => {
    delete window.showDirectoryPicker;
    window.__picked = []; window.__copied = []; window.__written = null;
    window.showSaveFilePicker = async (o) => { window.__picked.push(o); return { name: o.suggestedName,
      createWritable: async () => ({ write: async (h) => { window.__written = h; }, close: async () => {} }) }; };
    navigator.clipboard.writeText = async (s) => { window.__copied.push(s); };
  })()`);
  const laidPath = resolve(laid);
  await t.ev(t.key('s', { ctrlKey: true }));
  await sleep(300);
  const b1 = await t.ev(`(() => { const p = document.querySelector('.confirm .save-where'); return p && { path: p.textContent,
    title: document.querySelector('.confirm .confirm-title').textContent, msg: document.querySelector('.confirm .confirm-msg').textContent,
    hasAlt: !!document.querySelector('.confirm .confirm-alt'), ok: document.querySelector('.confirm .confirm-ok').textContent,
    copied: window.__copied, picked: window.__picked.length }; })()`);
  const expectedPath = process.platform === 'darwin' ? dirname(laidPath) : laidPath;
  const saveShortcut = process.platform === 'win32' ? /Ctrl\+A, Ctrl\+V/ : process.platform === 'darwin' ? /⌘⇧G/ : /Ctrl\+L/;
  t.check('save location: when directory picking is unavailable, Link folder is hidden and first Save copies the path with overwrite instructions',
    b1 && b1.path === expectedPath && b1.title === 'Path copied' && saveShortcut.test(b1.msg) && /overwrite/i.test(b1.msg) && !b1.hasAlt && b1.ok === 'Choose\u2026' && JSON.stringify(b1.copied) === JSON.stringify([expectedPath]) && b1.picked === 0,
    JSON.stringify(b1));
  await t.ev(`document.querySelector('.confirm .confirm-ok').click()`);
  await sleep(300);
  const pick1 = await t.ev(`({ picked: window.__picked.map(o => o.suggestedName), written: !!window.__written && window.__written.includes('id="diagram-data"'),
    open: !!document.querySelector('.save-where'), status: document.getElementById('save-status').textContent })`);
  t.check('save location: the bubble\'s button opens the dialog with the file\'s name and writes the file',
    JSON.stringify(pick1.picked) === JSON.stringify([basename(laidPath)]) && pick1.written && !pick1.open && pick1.status === `Saved to ${basename(laidPath)}`, JSON.stringify(pick1));
  await t.ev(`window.__written = null`);
  await t.ev(t.key('s', { ctrlKey: true }));
  await sleep(300);
  t.check('save location: the next Save writes straight to the chosen file with no bubble or dialog',
    (await t.ev(`!!window.__written && !document.querySelector('.save-where') && window.__picked.length === 1`)));
  // 6c. Reopening a file saved on an earlier visit (including with a different query string): the badge names the file Save writes to.
  //     The stored handle is faked as a plain { name } record (a real one needs the Save dialog).
  const badgeOf = () => t.ev(`(() => { const b = document.getElementById('save-status'); return { text: b.textContent, title: b.title }; })()`);
  await t.open(laid, '?keep-picker');
  await t.ev(`new Promise((res, rej) => { const q = indexedDB.open('ultimate-diagram', 2);
    q.onupgradeneeded = () => {
      if (!q.result.objectStoreNames.contains('handles')) q.result.createObjectStore('handles');
      if (!q.result.objectStoreNames.contains('folders')) q.result.createObjectStore('folders', { autoIncrement: true });
    };
    q.onsuccess = () => { const tx = q.result.transaction('handles', 'readwrite'); tx.objectStore('handles').put({ name: 'flow-old.html' }, location.href.split(/[?#]/)[0]); tx.oncomplete = res; tx.onerror = rej; };
    q.onerror = rej; })`);
  await t.open(laid, '?keep-picker&theme=dark');
  const stored = await badgeOf();
  t.check('remembered file: the badge reads "Saves to <file>" even with a different query string and says the browser may ask once per session',
    stored.text === 'Saves to flow-old.html' && /once per session/.test(stored.title), JSON.stringify(stored));
  await t.open(laid);
  t.check('remembered file: a page with no stored file still reads "Ready"', (await badgeOf()).text === 'Ready');

  // 6d. No Save dialog (Firefox, Safari): Save downloads a copy, the badge says so, and a toast says once that the
  //     opened file was not changed
  await t.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: mkdtempSync(join(tmpdir(), 'dlcopy_')) });
  const copyToasts = `[...document.querySelectorAll('.toast')].filter(e => /file you opened was not changed/.test(e.textContent)).length`;
  await t.ev(t.key('s', { ctrlKey: true }));
  await sleep(400);
  const dl1 = await badgeOf();
  const toasts1 = await t.ev(copyToasts);
  await t.ev(t.key('s', { ctrlKey: true }));
  await sleep(400);
  t.check('download: the badge reads "Downloaded a copy" and one toast says the opened file was not changed, also after a second Save',
    dl1.text === 'Downloaded a copy' && /not changed/.test(dl1.title) && toasts1 === 1 && (await t.ev(copyToasts)) === 1, JSON.stringify({ dl1, toasts1 }));

  await t.open(laid);
  await t.ev(`(() => {
    delete window.showDirectoryPicker;
    window.__picked = []; window.__execCopied = 0; window.__execOk = true;
    window.showSaveFilePicker = async (o) => { window.__picked.push(o); throw new DOMException('x', 'AbortError'); };
    navigator.clipboard.writeText = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    document.execCommand = (cmd) => { if (cmd === 'copy') { window.__execCopied++; return window.__execOk; } return false; };
  })()`);
  await t.ev(t.key('s', { ctrlKey: true }));
  await sleep(300);
  const fb = await t.ev(`({ execCopied: window.__execCopied, title: document.querySelector('.confirm .confirm-title')?.textContent })`);
  t.check('save location: falls back to execCommand when clipboard.writeText rejects',
    fb.execCopied === 1 && fb.title === 'Path copied', JSON.stringify(fb));
  await t.ev(`document.querySelector('.confirm .confirm-cancel').click()`);
  await sleep(100);
  t.check('save location: Cancel closes the bubble without opening the dialog',
    (await t.ev(`!document.querySelector('.save-where') && window.__picked.length === 0`)) && t.errors.length === 0, t.errors.join(' | '));
  await t.ev(`window.__execOk = false`);
  await t.ev(t.key('s', { ctrlKey: true }));
  await sleep(300);
  const noCopy = await t.ev(`({ title: document.querySelector('.confirm .confirm-title')?.textContent, msg: document.querySelector('.confirm .confirm-msg')?.textContent })`);
  t.check('save location: when copying fails, prompts to copy the path and overwrite the file',
    noCopy.title === 'Save over this file' && /^Copy path, /.test(noCopy.msg) && /overwrite/i.test(noCopy.msg), JSON.stringify(noCopy));
  await t.ev(`document.querySelector('.confirm .confirm-cancel').click()`);
  await sleep(100);

  // 6e. Linked folder (showDirectoryPicker): Link folder is primary, copies parent folder to clipboard on click,
  //     resolves nested child files (including CRLF on disk), rejects mismatched files, and handles system/host blocks.
  const laidParent = basename(dirname(laidPath));
  const laidGrandparent = basename(dirname(dirname(laidPath)));
  const laidName = basename(laidPath);
  const laidFolder = dirname(laidPath);
  await t.open(laid);
  await t.ev(`(() => {
    window.__dirWritten = null; window.__picked = []; window.__copied = [];
    navigator.clipboard.writeText = async (s) => { window.__copied.push(s); };
    window.showSaveFilePicker = async (o) => { window.__picked.push(o); throw new DOMException('x', 'AbortError'); };
    const makeTree = (dataText) => ({
      name: ${JSON.stringify(laidGrandparent)},
      queryPermission: async () => 'granted',
      getDirectoryHandle: async (sub) => {
        if (sub !== ${JSON.stringify(laidParent)}) throw new DOMException('not found', 'NotFoundError');
        return {
          name: sub,
          getFileHandle: async (fn) => {
            if (fn !== ${JSON.stringify(laidName)}) throw new DOMException('not found', 'NotFoundError');
            return {
              name: fn,
              getFile: async () => ({ text: async () => '<script id="diagram-data" type="application/' + 'json">\\r\\n' + dataText + '\\r\\n</' + 'script>' }),
              createWritable: async () => ({ write: async (h) => { window.__dirWritten = h; }, close: async () => {} })
            };
          }
        };
      }
    });
    window.__makeTree = makeTree;
    window.showDirectoryPicker = async () => makeTree('{"wrong":"diagram"}');
  })()`);
  await t.ev(t.key('s', { ctrlKey: true }));
  await sleep(300);
  const tipInfo = await t.ev(`({
    title: document.querySelector('.confirm .confirm-title')?.textContent || '',
    tips: [...document.querySelectorAll('.confirm .save-folder-tip')].map(e => e.textContent).join(' | '),
    alt: document.querySelector('.confirm .confirm-alt')?.textContent || '',
    ok: document.querySelector('.confirm .confirm-ok')?.textContent || ''
  })`);
  t.check('linked folder: first-save bubble makes Link folder primary and explains both options clearly',
    tipInfo.title === 'Save to disk' && /copies this file.s folder/i.test(tipInfo.tips) && /Choose file/i.test(tipInfo.alt) && /Link folder/i.test(tipInfo.ok),
    JSON.stringify(tipInfo));
  // Click Link folder with a same-named folder whose on-disk diagram-data does NOT match: copies parent folder, refuses overwrite
  await t.ev(`window.__copied = []; document.querySelector('.confirm .confirm-ok').click()`);
  await sleep(300);
  const mismatch = await t.ev(`({ copied: window.__copied, written: window.__dirWritten, toasts: [...document.querySelectorAll('.toast')].map(e => e.textContent) })`);
  t.check('linked folder: clicking Link folder copies parent folder to clipboard and rejects mismatched diagram-data',
    JSON.stringify(mismatch.copied) === JSON.stringify([laidFolder]) && mismatch.written === null && mismatch.toasts.some(s => /does not contain/i.test(s)),
    JSON.stringify(mismatch));

  // SecurityError (blocked system folder): shows plain-English toast and keeps Link folder available
  await t.ev(`window.showDirectoryPicker = async () => { throw new DOMException('Cannot open system files', 'SecurityError'); }`);
  await t.ev(t.key('s', { ctrlKey: true }));
  await sleep(300);
  await t.ev(`document.querySelector('.confirm .confirm-ok').click()`);
  await sleep(300);
  const sysErr = await t.ev(`[...document.querySelectorAll('.toast')].some(e => /blocks system folders/i.test(e.textContent))`);
  t.check('linked folder: shows plain-English toast when browser blocks a system folder', sysErr);

  // Matching top grandparent folder with CRLF line endings on disk: resolves nested child file, verifies diagram-data, and saves directly
  await t.ev(`window.showDirectoryPicker = async () => window.__makeTree(document.getElementById('diagram-data').textContent.trim().replace(/\\n/g, '\\r\\n'))`);
  await t.ev(t.key('s', { ctrlKey: true }));
  await sleep(300);
  await t.ev(`document.querySelector('.confirm .confirm-ok').click()`);
  await sleep(350);
  const linkedOk = await t.ev(`({
    written: !!window.__dirWritten && window.__dirWritten.includes('id="diagram-data"'),
    status: document.getElementById('save-status').textContent,
    toast: [...document.querySelectorAll('.toast')].some(e => /Linked /.test(e.textContent)),
    picked: window.__picked.length
  })`);
  t.check('linked folder: linking parent folder matches CRLF files on disk and saves nested child diagram straight to disk',
    linkedOk.written && linkedOk.status === `Saved to ${laidName}` && linkedOk.toast && linkedOk.picked === 0, JSON.stringify(linkedOk));

  // Non-system SecurityError (embedded/VS Code frame): shows clear unsupported toast and hides Link folder on next Save
  await t.open(laid);
  await t.ev(`(() => {
    window.showSaveFilePicker = async () => { throw new DOMException('x', 'AbortError'); };
    window.showDirectoryPicker = async () => { throw new DOMException('Cross origin sub frames are not allowed to show a file picker.', 'SecurityError'); };
  })()`);
  await t.ev(t.key('s', { ctrlKey: true }));
  await sleep(300);
  await t.ev(`document.querySelector('.confirm .confirm-ok').click()`);
  await sleep(300);
  const hostBlockedToast = await t.ev(`[...document.querySelectorAll('.toast')].some(e => /not supported in this browser window/i.test(e.textContent))`);
  await t.ev(t.key('s', { ctrlKey: true }));
  await sleep(300);
  const hiddenAfterBlock = await t.ev(`({ hasAlt: !!document.querySelector('.confirm .confirm-alt'), ok: document.querySelector('.confirm .confirm-ok')?.textContent || '' })`);
  t.check('linked folder: non-system SecurityError explains browser limitation and hides Link folder afterwards',
    hostBlockedToast && !hiddenAfterBlock.hasAlt && hiddenAfterBlock.ok === 'Choose\u2026', JSON.stringify({ hostBlockedToast, hiddenAfterBlock }));

  });

  // 7. Drag shapes out of the dock (flowchart plugin): empty canvas adds a node, an arrow gets the node spliced in
  await t.section('dock-lanes-wheel-copy', async () => {
  await t.open(laid);
  const graph = `JSON.stringify({ n: document.querySelectorAll('.flow-node').length, e: document.querySelectorAll('.edge-line').length })`;
  // Screen points sampled along every arrow, so a test point can keep clear of them
  const pathPts = `[...document.querySelectorAll('.edge-line')].flatMap(p => { const L = p.getTotalLength(), m = p.getScreenCTM(), o = []; for (let s = 0; s <= L; s += 4) { const q = p.getPointAtLength(s); o.push([q.x * m.a + m.e, q.y * m.d + m.f]); } return o; })`;
  const paletteDrop = (type, x, y) => `(async () => {
    const b = document.querySelector('[data-node-type="${type}"]'), r = b.getBoundingClientRect();
    const o = (cx, cy) => ({ bubbles: true, button: 0, clientX: cx, clientY: cy, pointerId: 1, isPrimary: true });
    b.dispatchEvent(new PointerEvent('pointerdown', o(r.left + 10, r.top + 10)));
    window.dispatchEvent(new PointerEvent('pointermove', o(r.left + 30, r.top - 30)));
    window.dispatchEvent(new PointerEvent('pointermove', o(${x}, ${y})));
    const hl = !!document.querySelector('.edge-line.insert-target');
    window.dispatchEvent(new PointerEvent('pointerup', o(${x}, ${y})));
    b.click();   // the click a real drop onto the button would produce must be swallowed
    return hl;
  })()`;
  const g0 = JSON.parse(await t.ev(graph));
  const emptyPt = await t.ev(`(() => {
    const pts = ${pathPts}, nodes = [...document.querySelectorAll('.flow-node')].map(n => n.getBoundingClientRect());
    const vp = document.getElementById('viewport').getBoundingClientRect();
    for (let y = vp.top + 60; y < vp.bottom - 140; y += 16) for (let x = vp.left + 300; x < vp.right - 60; x += 16) {
      const el = document.elementFromPoint(x, y);
      if (!el || !el.classList.contains('lane-track')) continue;
      if (pts.some(([px, py]) => Math.hypot(px - x, py - y) < 90)) continue;
      if (nodes.some(r => x > r.left - 110 && x < r.right + 110 && y > r.top - 70 && y < r.bottom + 70)) continue;
      return [x, y, el.dataset.laneId];
    }
    return null;
  })()`);
  if (emptyPt) {
    const xy0 = JSON.parse(await t.ev(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('.flow-node')].map(n => [n.dataset.nodeId, [n.style.left, n.style.top, n.parentElement.dataset.laneId]])))`));
    const hl = await t.ev(paletteDrop('task', emptyPt[0], emptyPt[1]));
    const g1 = JSON.parse(await t.ev(graph));
    const lane = await t.ev(`document.querySelector('.flow-node.selected')?.parentElement.dataset.laneId`);
    t.check('dragging Step from the dock onto empty canvas adds exactly one node in the lane under the pointer', !hl && g1.n === g0.n + 1 && g1.e === g0.e && lane === emptyPt[2], `hl=${hl} before=${JSON.stringify(g0)} after=${JSON.stringify(g1)} lane=${lane} want=${emptyPt[2]}`);
    // No Auto-Tidy on a palette drop: the new node stays where it was dropped and no other node moves
    const moved = await t.ev(`(() => { const before = ${JSON.stringify(xy0)};
      return [...document.querySelectorAll('.flow-node')].filter(n => { const b = before[n.dataset.nodeId];
        return b && (b[0] !== n.style.left || b[1] !== n.style.top || b[2] !== n.parentElement.dataset.laneId); }).length; })()`);
    t.check('a shape dropped on empty canvas does not re-lay out the diagram (no Auto-Tidy)', moved === 0, `moved=${moved}`);
    await t.ev(t.key('z', { ctrlKey: true }));
  } else t.check('found an empty canvas spot for the dock-drag test', false);

  // Drop onto the middle of an unlabelled arrow between two nodes
  const edgeInfo = await t.ev(`(() => {
    for (const p of document.querySelectorAll('.edge-line')) {
      const lbl = document.querySelector('.edge-label[data-edge-id="' + p.dataset.edgeId + '"] .edge-label-text');
      if (lbl && lbl.textContent.trim() && !/^\\+/.test(lbl.textContent.trim())) continue;
      const L = p.getTotalLength(), m = p.getScreenCTM();
      for (const f of [0.5, 0.35, 0.65]) {
        const q = p.getPointAtLength(L * f), x = q.x * m.a + m.e, y = q.y * m.d + m.f;
        const el = document.elementFromPoint(x, y);
        if (el && !el.closest('.flow-node') && !el.closest('.dock-area') && document.getElementById('viewport').contains(el)) return [p.dataset.edgeId, x, y];
      }
    }
    return null;
  })()`);
  if (edgeInfo) {
    // Arrow ends read from the hover highlight: hovering a node colours its incoming (hl-in) and outgoing (hl-out) arrows
    const endsOf = (edgeId) => t.ev(`(() => {
      const res = {};
      for (const n of document.querySelectorAll('.flow-node')) {
        n.dispatchEvent(new MouseEvent('mouseenter'));
        const p = [...document.querySelectorAll('.edge-line')].find(x => x.dataset.edgeId === ${JSON.stringify(edgeId)});
        if (p && p.classList.contains('hl-out')) res.from = n.dataset.nodeId;
        if (p && p.classList.contains('hl-in')) res.to = n.dataset.nodeId;
        n.dispatchEvent(new MouseEvent('mouseleave'));
      }
      return res;
    })()`);
    const ends0 = await endsOf(edgeInfo[0]);
    const ids = `JSON.stringify([...document.querySelectorAll('.flow-node')].map(n => n.dataset.nodeId))`;
    const idsBefore = JSON.parse(await t.ev(ids));
    const hl = await t.ev(paletteDrop('task', edgeInfo[1], edgeInfo[2]));
    const g2 = JSON.parse(await t.ev(graph));
    const newId = JSON.parse(await t.ev(ids)).find(id => !idsBefore.includes(id));
    t.check('dragging over an arrow highlights it, and dropping adds one node and one arrow', hl && g2.n === g0.n + 1 && g2.e === g0.e + 1 && !!newId, `hl=${hl} before=${JSON.stringify(g0)} after=${JSON.stringify(g2)}`);
    // The original arrow A->B now ends at the new node N, a new arrow N->B leaves it, and the tidy put N between A and B
    const ends1 = await endsOf(edgeInfo[0]);
    const outOfNew = await t.ev(`(() => {
      const n = document.getElementById('node-${newId}'); n.dispatchEvent(new MouseEvent('mouseenter'));
      const out = [...document.querySelectorAll('.edge-line.hl-out')].map(p => p.dataset.edgeId);
      n.dispatchEvent(new MouseEvent('mouseleave')); return out;
    })()`);
    const outEnds = outOfNew.length === 1 ? await endsOf(outOfNew[0]) : {};
    const xs = await t.ev(`[${JSON.stringify(ends0.from)}, ${JSON.stringify(newId)}, ${JSON.stringify(ends0.to)}].map(id => parseFloat(document.getElementById('node-' + id).style.left))`);
    t.check('the arrow is rewired A->new->B and the tidy keeps A <= new < B left to right (a cross-lane step may stack under A)', ends1.from === ends0.from && ends1.to === newId && outEnds.to === ends0.to && xs[0] <= xs[1] && xs[1] < xs[2],
      `before=${JSON.stringify(ends0)} after=${JSON.stringify(ends1)} newOut=${JSON.stringify(outEnds)} xs=${xs}`);
    await t.ev(t.key('z', { ctrlKey: true }));
    const g3 = JSON.parse(await t.ev(graph));
    t.check('one Ctrl+Z undoes the whole insert', g3.n === g0.n && g3.e === g0.e, JSON.stringify(g3));
  } else t.check('found an arrow for the insert test', false);

  // 7b. Lane hover: the lane under the pointer is lit, even while the pointer is over an arrow's label
  const hoverCheck = await t.ev(`(() => {
    const c = document.getElementById('swimlanes-container');
    const label = [...document.querySelectorAll('.edge-label')].find(l => l.getBoundingClientRect().width);
    const r = label.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const lane = [...document.querySelectorAll('.swimlane')].find(l => { const b = l.getBoundingClientRect(); return y >= b.top && y < b.bottom; });
    label.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
    const lit = [...document.querySelectorAll('.swimlane.lane-hover')];
    // The hovered lane's background token switches to the one shared highlight colour (white and grey lanes alike)
    const cs = getComputedStyle(lane);
    const ok = lit.length === 1 && lit[0] === lane && cs.getPropertyValue('--lane-bg').trim() === cs.getPropertyValue('--lane-hover-bg').trim();
    c.dispatchEvent(new PointerEvent('pointerleave'));
    return ok && !document.querySelector('.swimlane.lane-hover');
  })()`);
  t.check('the lane under the pointer is highlighted (also over an arrow label) and clears on leave', hoverCheck);

  // 8. Lane name pills (no header column): every lane always shows its pill at the visible top-left; a gutter
  //    indents the nodes so no pill sits on one at any zoom; the pill follows the viewport's left edge when
  //    panned, scales with the diagram, and exports at the lane's own top-left
  const pills = `(() => { const vp = document.getElementById('viewport').getBoundingClientRect();
    return [...document.querySelectorAll('.lane-pill')].filter(p => getComputedStyle(p).display !== 'none')
      .map(p => { const r = p.getBoundingClientRect(), k = r.width / p.offsetWidth, laneEl = p.closest('.swimlane'), lane = laneEl.getBoundingClientRect();
        const firstNode = Math.min(...[...laneEl.querySelectorAll('.flow-node')].map(n => n.getBoundingClientRect().left));
        return { dx: Math.round(r.left - vp.left), laneDx: Math.round(r.left - lane.left), clear: Math.round(firstNode - r.right), px: Math.round(parseFloat(getComputedStyle(p).fontSize) * k * 10) / 10 }; }); })()`;
  const laneCount = await t.ev(`document.querySelectorAll('.swimlane').length`);
  const zoom = `parseInt(document.getElementById('zoom-level').textContent) / 100`;
  const atRest = await t.ev(pills);
  for (let i = 0; i < 6; i++) await t.ev(`document.getElementById('btn-zoom-out').click()`);
  const restOut = await t.ev(pills);
  await t.ev(`document.getElementById('btn-zoom-reset').click()`);
  t.check("no header column: every lane shows its pill at its top-left, clear of the lane's nodes at any zoom",
    !(await t.ev(`!!document.querySelector('.lane-header')`)) && atRest.length === laneCount
      && [...atRest, ...restOut].every(p => p.laneDx >= 3 && p.laneDx <= 20 && p.clear > 0),
    `fit=${JSON.stringify(atRest)} zoomedOut=${JSON.stringify(restOut)}`);
  await t.ev(`document.getElementById('viewport').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 900, deltaY: 0, deltaMode: 0, clientX: 600, clientY: 400 }))`);
  const shown = await t.ev(pills), z1 = await t.ev(zoom);
  t.check('after panning right, every pill sits at the viewport left edge',
    shown.length === laneCount && shown.every(p => Math.abs(p.dx - 12 * z1) <= 2), `shown=${JSON.stringify(shown)} zoom=${z1}`);
  t.check('pill text scales with the diagram (15px at 100%)', shown.every(p => Math.abs(p.px - 15 * z1) <= 0.6), `px=${shown.map(p => p.px)} zoom=${z1}`);
  // An export taken while panned draws every pill once, at its lane's own top-left (no view offset)
  const svgText = await t.ev(`new Promise(res => {
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { URL.createObjectURL = orig; b.text().then(res); return 'blob:x'; };
    document.querySelector('[data-export="svg"]').click();
  })`);
  const laneNames = await t.ev(`[...document.querySelectorAll('.lane-title')].map(t => t.textContent)`);
  const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const counts = laneNames.map(n => svgText.split('>' + esc(n) + '<').length - 1);
  const pillMoves = [...svgText.matchAll(/matrix\(1, 0, 0, 1, ([\d.]+), ([\d.]+)\)/g)].filter(m => +m[1] === 12 && +m[2] === 12).length;
  t.check("SVG export names every lane once, with pills at the lanes' own top-left", counts.every(c => c === 1) && pillMoves === laneCount, `counts=${counts} pillsAtLaneCorner=${pillMoves}/${laneCount}`);
  await t.ev(`document.getElementById('btn-zoom-reset').click()`);
  await sleep(280);
  const afterFit = await t.ev(pills);
  t.check("Fit brings the pills back to the lanes' top-left", afterFit.every(p => p.laneDx >= 3 && p.laneDx <= 20), JSON.stringify(afterFit));
  // Rename by double-clicking the pill's name
  const renamed = await t.ev(`(async () => {
    const title = document.querySelector('.lane-pill .lane-title');
    title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const editing = title.isContentEditable;
    title.textContent = 'Renamed Lane';
    title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // Headless Chrome has no window focus, so Enter's blur() fires no blur event there: deliver it by hand
    if (title.isContentEditable) title.dispatchEvent(new FocusEvent('blur'));
    await new Promise(r => setTimeout(r, 50));
    const ok = editing && document.querySelector('.lane-pill .lane-title').textContent === 'Renamed Lane' && /unsaved/i.test(document.getElementById('save-status').textContent);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    return ok;
  })()`);
  t.check('double-clicking a pill renames the lane (undoable)', renamed);

  // 9. No-swimlane mode ("swimlanes": false)
  const nolanes = argOf('nolanes');
  if (nolanes) {
    await t.open(nolanes);
    const visiblePills = `[...document.querySelectorAll('.lane-pill')].filter(h => getComputedStyle(h).display !== 'none').length`;
    const visible = await t.ev(visiblePills);
    const n = await t.ev(`document.querySelectorAll('.flow-node').length`);
    const label = await t.ev(`document.querySelector('#btn-add-lane .btn-label').textContent`);
    t.check('swimlanes:false renders the nodes with no lane pill', n > 0 && visible === 0 && t.errors.length === 0, `nodes=${n} pills=${visible} errors=${t.errors.join(' | ')}`);
    await t.ev(`document.getElementById('btn-add-lane').click()`);
    const shown = await t.ev(visiblePills);
    t.check('the Lane button ("' + label + '") turns swimlanes back on', shown === 1, `pills=${shown}`);
  }

  // 9a. Mouse wheel: scrolls the canvas (Shift: sideways); Ctrl + wheel zooms one gentle step per notch
  await t.open(laid);
  const view = `(() => { const r = document.getElementById('swimlanes-container').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), z: parseInt(document.getElementById('zoom-level').textContent) }; })()`;
  const wheel = (o) => `document.getElementById('viewport').dispatchEvent(new WheelEvent('wheel', Object.assign({ bubbles: true, cancelable: true, deltaX: 0, deltaY: 0, deltaMode: 0, clientX: 600, clientY: 400 }, ${JSON.stringify(o)})))`;
  const w0 = await t.ev(view);
  await t.ev(wheel({ deltaY: 100 }));
  const w1 = await t.ev(view);
  await t.ev(wheel({ deltaY: 100, shiftKey: true }));
  const w2 = await t.ev(view);
  await t.ev(wheel({ deltaY: 10 }));
  const w3 = await t.ev(view);
  t.check('a wheel notch scrolls the canvas 40px vertically (Shift: sideways) without zooming; small trackpad deltas stay 1:1',
    w1.y === w0.y - 40 && w1.x === w0.x && w1.z === w0.z && w2.x === w1.x - 40 && w2.y === w1.y && w2.z === w0.z && w3.y === w2.y - 10,
    JSON.stringify([w0, w1, w2, w3]));
  await t.ev(wheel({ deltaY: -100, ctrlKey: true }));
  const zA = (await t.ev(view)).z;
  await t.ev(wheel({ deltaY: -100, ctrlKey: true }));
  const zB = (await t.ev(view)).z;
  t.check('Ctrl + wheel zooms in one ~15% step per notch, not to the zoom limit',
    zA > w0.z && zA <= Math.ceil(w0.z * 1.16) && zB > zA && zB <= Math.ceil(zA * 1.16), `zoom ${w0.z}% -> ${zA}% -> ${zB}%`);

  // 9b. Top-to-bottom layout: the dock's direction toggle lays the diagram out vertically (lanes as columns),
  //     is saved in the data ("direction": "TB") so the file reopens vertical, and toggling back restores the
  //     left-to-right layout exactly
  await t.open(laid);
  const refLaid = await t.ev(positions);
  await t.ev(`document.getElementById('btn-direction').click()`);
  await sleep(700);   // the direction switch animates for 520 ms
  const columns = `(() => {
    const lanes = [...document.querySelectorAll('.swimlane')].map(l => l.getBoundingClientRect());
    const sideBySide = lanes.every((r, i) => i === 0 || (r.left >= lanes[i - 1].right - 2 && Math.abs(r.top - lanes[0].top) < 1));
    const nodes = [...document.querySelectorAll('.flow-node')].map(n => ({ r: n.getBoundingClientRect(), lane: n.closest('.swimlane').getBoundingClientRect() }));
    const inLane = nodes.every(({ r, lane }) => r.left >= lane.left - 1 && r.right <= lane.right + 1);
    const overlaps = nodes.filter((a, i) => nodes.some((b, j) => j > i && a.r.left < b.r.right && b.r.left < a.r.right && a.r.top < b.r.bottom && b.r.top < a.r.bottom)).length;
    const pills = [...document.querySelectorAll('.swimlane')].map(l => { const p = l.querySelector('.lane-pill').getBoundingClientRect(), r = l.getBoundingClientRect(); return { dy: Math.round(p.top - r.top), inside: p.left >= r.left && p.right <= r.right + 1, off: Math.round((p.left + p.right) / 2 - (r.left + r.right) / 2) }; });
    const firstNodeTop = Math.min(...nodes.map(n => n.r.top)), pillBottom = Math.max(...[...document.querySelectorAll('.lane-pill')].map(p => p.getBoundingClientRect().bottom));
    return { tb: document.getElementById('swimlanes-container').classList.contains('dir-tb'), sideBySide, inLane, overlaps, pills, clear: firstNodeTop > pillBottom,
      label: document.querySelector('#btn-direction .btn-label').textContent, arrows: document.querySelectorAll('.edge-line').length, status: document.getElementById('save-status').textContent };
  })()`;
  const v = await t.ev(columns);
  t.check('the Vertical toggle lays lanes out as side-by-side columns with every node inside its column, none overlapping',
    v.tb && v.sideBySide && v.inLane && v.overlaps === 0 && v.arrows > 0 && v.label === 'Horizontal' && /unsaved/i.test(v.status) && t.errors.length === 0,
    JSON.stringify(v) + ' ' + t.errors.join(' | '));
  t.check('vertical: every pill sits centred at the top of its own column, above the first node',
    v.pills.every(p => p.dy >= 3 && p.dy <= 20 && p.inside && Math.abs(p.off) <= 1) && v.clear, JSON.stringify(v.pills));
  await t.ev(`document.getElementById('viewport').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 0, deltaY: 500, deltaMode: 0, clientX: 600, clientY: 400 }))`);
  await sleep(100);
  const pinnedTop = await t.ev(`(() => { const vp = document.getElementById('viewport').getBoundingClientRect(), c = document.getElementById('swimlanes-container').getBoundingClientRect();
    const safeTop = Math.max(vp.top, ...[...document.querySelectorAll('header .toolbar-left, header .toolbar-right')].map((el) => el.getBoundingClientRect().bottom));
    return { below: c.top < vp.top, dy: [...document.querySelectorAll('.lane-pill')].map(p => Math.round(p.getBoundingClientRect().top - safeTop)) }; })()`);
  t.check('vertical: after panning down, every pill sits below the floating header pills',
    pinnedTop.below && pinnedTop.dy.every(d => d >= 4 && d <= 20), JSON.stringify(pinnedTop));
  // Save, then reopen the saved file: it opens vertical
  await t.ev(t.key('s', { ctrlKey: true }));
  await sleep(400);
  // (as the shell's save does: the page's file with its diagram-data block replaced)
  const savedJson = await t.ev(`document.getElementById('diagram-data').textContent`);
  const savedHtml = readFileSync(laid, 'utf8').replace(/(<script id="diagram-data" type="application\/json">)[\s\S]*?(<\/script>)/, (m, a, b) => a + savedJson + b);
  const savedFile = join(mkdtempSync(join(tmpdir(), 'tb_')), 'vertical.html');
  writeFileSync(savedFile, savedHtml);
  t.check('vertical: Save writes "direction": "TB" into the diagram data', /"direction":\s*"TB"/.test(savedHtml));
  await t.open(savedFile);
  const reopened = await t.ev(columns);
  t.check('vertical: the saved file reopens top-to-bottom', reopened.tb && reopened.sideBySide && reopened.overlaps === 0 && reopened.label === 'Horizontal' && t.errors.length === 0,
    JSON.stringify(reopened) + ' ' + t.errors.join(' | '));
  await t.ev(`document.getElementById('btn-direction').click()`);
  await sleep(700);   // the direction switch animates for 520 ms
  const back = await t.ev(positions);
  t.check('toggling back to Horizontal restores the left-to-right layout exactly', back === refLaid && !(await t.ev(`document.getElementById('swimlanes-container').classList.contains('dir-tb')`)),
    `got ${back.slice(0, 120)}...`);

  // 9b. Export › Copy › PNG puts a PNG of the diagram on the clipboard and flashes the badge
  await t.open(laid);
  await t.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await t.send('Page.bringToFront');
  await t.send('Emulation.setFocusEmulationEnabled', { enabled: true });   // headless has no focused window
  const badgeBefore = await t.ev(`document.getElementById('save-status').textContent`);
  const copyVisible = await t.ev(`!document.querySelector('[data-copy="png"]').hidden && !document.querySelector('[data-copy-label]').hidden`);
  // userGesture: the clipboard write must start inside a user activation, as a real click gives
  await t.send('Runtime.evaluate', { expression: `document.querySelector('[data-copy="png"]').click()`, userGesture: true });
  let copied = null, badgeCopied = '';
  for (let i = 0; i < 40 && !copied; i++) {
    await sleep(100);
    const statusNow = await t.ev(`document.getElementById('save-status').textContent`);
    if (/copied/i.test(statusNow)) {
      badgeCopied = statusNow;
      copied = await t.ev(`navigator.clipboard.read().then(async items => {
        const it = items.find(x => x.types.includes('image/png'));
        if (!it) return { types: items.flatMap(x => x.types) };
        const b = await it.getType('image/png'), head = new Uint8Array(await b.slice(0, 8).arrayBuffer());
        const bmp = await createImageBitmap(b);
        return { size: b.size, png: head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47, w: bmp.width, h: bmp.height };
      }, e => ({ error: e.message }))`);
    }
  }
  if (!badgeCopied) badgeCopied = await t.ev(`document.getElementById('save-status').textContent`);
  await sleep(1700);
  const badgeAfter = await t.ev(`document.getElementById('save-status').textContent`);
  t.check('Copy › PNG puts a 1.5x PNG on the clipboard; the badge says "Copied as PNG" then returns', copyVisible && copied && copied.png && copied.size > 1000
    && copied.w > 200 && copied.h > 100 && /copied as png/i.test(badgeCopied) && badgeAfter === badgeBefore && t.errors.length === 0,
    `visible=${copyVisible} clip=${JSON.stringify(copied)} badge=${badgeBefore}->${badgeCopied}->${badgeAfter} errors=${t.errors.join(' | ')}`);

  // 9c. The flowchart has toMermaid: the Mermaid item shows (when the browser can write the clipboard) beside the other Copy items
  t.check('flowchart: the Copy group shows Mermaid, SVG and the heading',
    await t.ev(`!document.querySelector('[data-copy="mermaid"]').hidden && !document.querySelector('[data-copy="svg"]').hidden && !document.querySelector('[data-copy-label]').hidden`));

  });

  // 10. ?present hides editing chrome
  await t.section('present-saved', async () => {
  await t.open(laid, '?present');
  t.check('?present hides Save and toolbar', await t.ev(`document.body.classList.contains('presentation') && getComputedStyle(document.getElementById('btn-save')).display === 'none' && getComputedStyle(document.querySelector('.toolbar-center')).display === 'none'`));
  t.check('?present starts with the Present button pressed', await t.ev(`document.getElementById('btn-present').getAttribute('aria-pressed') === 'true'`));

  // 10a. Top floating corner pills: full-bleed viewport, labeled Present and Save, icon-only tools, progressive tablet/phone compaction
  await t.open(laid);
  t.check('viewport starts at top: 0 (no full-width top navbar)',
    await t.ev(`(() => { const r = document.getElementById('viewport').getBoundingClientRect(); return r.top === 0 && r.height === window.innerHeight; })()`));
  t.check('Present and Save are labeled; Search, Theme, Help, Import and Export are icon-only',
    await t.ev(`[...document.querySelectorAll('header .toolbar-right > .btn, header .menu-wrap > .btn')].filter(b => b.getClientRects().length).every(b => !!b.textContent.trim() === !['btn-search', 'btn-theme', 'btn-help', 'btn-import-mermaid', 'btn-export', 'btn-more'].includes(b.id))`));
  t.check('every header button has an aria-label and a title',
    await t.ev(`[...document.querySelectorAll('header .toolbar-right > .btn, header .menu-wrap > .btn')].every(b => b.getAttribute('aria-label') && b.title)`));
  t.check('Undo and Redo sit in the zoom dock, not the header',
    await t.ev(`!!document.querySelector('.toolbar-zoom #btn-undo') && !!document.querySelector('.toolbar-zoom #btn-redo') && !document.querySelector('header #btn-undo, header #btn-redo')`));
  await t.send('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false });
  await t.ev(`(() => { const h1 = document.getElementById('chart-title'); h1.textContent = 'Customer Loan Application Process'; h1.dispatchEvent(new Event('dblclick')); h1.dispatchEvent(new Event('blur')); })()`);
  await sleep(60);
  t.check('tablet portrait folds secondary controls into #btn-more while keeping Save labeled, pills separated, and edit dock bottom-right',
    await t.ev(`(() => {
      const tl = document.querySelector('.toolbar-left').getBoundingClientRect();
      const tr = document.querySelector('.toolbar-right').getBoundingClientRect();
      const tc = document.querySelector('.toolbar-center').getBoundingClientRect();
      return document.getElementById('btn-more').getClientRects().length > 0
        && document.getElementById('btn-theme').getClientRects().length === 0
        && getComputedStyle(document.querySelector('#btn-present .btn-label')).display === 'none'
        && getComputedStyle(document.querySelector('#btn-save .btn-label')).display !== 'none'
        && tr.left - tl.right >= 12 && tr.right <= window.innerWidth
        && Math.abs(tc.right - tr.right) <= 2;
    })()`));
  await t.clickOn('#btn-more');
  t.check('More menu opens on tablet portrait with theme, shortcuts, and export actions',
    await t.ev(`!document.getElementById('more-menu').hidden && !![...document.querySelectorAll('#more-menu [role="menuitem"]')].find(b => /Dark mode|Light mode/.test(b.textContent)) && !![...document.querySelectorAll('#more-menu [role="menuitem"]')].find(b => /SVG image/.test(b.textContent))`));
  await t.ev(t.key('Escape'));
  t.check('Escape closes the More menu and restores focus to #btn-more',
    await t.ev(`document.getElementById('more-menu').hidden && document.activeElement.id === 'btn-more'`));
  await t.send('Emulation.setDeviceMetricsOverride', { width: 480, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(60);
  t.check('phone width also switches Save to icon-only and keeps Save on screen',
    await t.ev(`getComputedStyle(document.querySelector('#btn-save .btn-label')).display === 'none' && document.getElementById('btn-save').getBoundingClientRect().right <= window.innerWidth`));
  await t.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await t.ev(`(() => { const h1 = document.getElementById('chart-title'); h1.textContent = 'Flow'; h1.dispatchEvent(new Event('dblclick')); h1.dispatchEvent(new Event('blur')); })()`);
  await sleep(60);
  t.check('wide viewport + short title restores full right pill and labels',
    await t.ev(`!document.querySelector('header').classList.contains('is-compact') && !document.querySelector('header').classList.contains('is-tight') && document.getElementById('btn-more').getClientRects().length === 0 && getComputedStyle(document.querySelector('#btn-present .btn-label')).display !== 'none' && getComputedStyle(document.querySelector('#btn-save .btn-label')).display !== 'none'`));
  await t.send('Emulation.clearDeviceMetricsOverride');
  await sleep(40);
  t.check('wide desktop (>1300px) keeps bottom edit dock centered',
    await t.ev(`(() => { const tc = document.querySelector('.toolbar-center').getBoundingClientRect(); return window.innerWidth > 1300 && Math.abs((tc.left + tc.right) / 2 - window.innerWidth / 2) <= 2; })()`));
  await t.clickOn('#btn-export');
  t.check('Export menu opens on click', !(await t.ev(`document.getElementById('export-menu').hidden`)));
  await t.ev(t.key('Escape'));
  t.check('Escape closes the Export menu', await t.ev(`document.getElementById('export-menu').hidden`));
  const themeNow = await t.ev(`document.documentElement.getAttribute('data-theme')`);
  t.check('#btn-theme aria-pressed follows the theme', await t.ev(`document.getElementById('btn-theme').getAttribute('aria-pressed')`) === String(themeNow === 'dark'));
  await t.ev(`document.getElementById('btn-theme').click()`);
  t.check('#btn-theme aria-pressed flips with the toggle', await t.ev(`document.getElementById('btn-theme').getAttribute('aria-pressed')`) === String(themeNow !== 'dark'));
  await t.ev(`document.getElementById('btn-theme').click()`);
  await t.ev(`document.getElementById('btn-help').click()`);
  t.check('Help button opens the help drawer', await t.ev(`document.getElementById('help-drawer').classList.contains('open')`));
  await t.ev(`document.getElementById('help-close').click()`);
  t.check('closing help returns focus to #btn-help', await t.ev(`document.activeElement.id === 'btn-help'`));
  t.check('no page errors in the header checks', t.errors.length === 0, t.errors.join(' | '));

  // 10b. The Present button toggles in place; only the zoom dock and the button stay; pan and zoom work; no edit gets through
  await t.open(laid);
  const isPres = `document.body.classList.contains('presentation')`, prsd = `document.getElementById('btn-present').getAttribute('aria-pressed')`;
  const visChrome = `[...document.querySelectorAll('header button, header .menu-wrap, .toolbar-left, .toolbar-center, .toolbar-zoom, .toolbar-zoom button, #search-bar, #help-drawer')].filter(e => e.getClientRects().length).map(e => e.id || e.className)`;
  const chromeBefore = await t.ev(`(${visChrome}).length`);
  await t.clickOn('#btn-present');
  const gotToast = await t.ev(`/Esc or the Present button/.test((document.querySelector('.toast') || {}).textContent || '')`);
  t.check('Present button turns presentation on in place, aria-pressed follows, a hint toast shows',
    await t.ev(isPres) && await t.ev(prsd) === 'true' && gotToast && chromeBefore > 4, `chromeBefore=${chromeBefore}`);
  t.check('in presentation only Present and the zoom dock (3 buttons) are visible',
    await t.ev(`JSON.stringify(${visChrome}.filter(c => c !== 'toolbar-zoom'))`) === JSON.stringify(['btn-present', 'btn-zoom-out', 'btn-zoom-in', 'btn-zoom-reset']) && await t.ev(`getComputedStyle(document.getElementById('btn-present')).display !== 'none' && document.getElementById('btn-present').getBoundingClientRect().top < 56`));
  const nodeX = `Math.round(document.querySelector('.flow-node').getBoundingClientRect().left)`;
  const nodeCount2 = await t.ev(`document.querySelectorAll('.flow-node').length`);
  const posBefore = await t.ev(positions), x0 = await t.ev(nodeX);
  const np = await t.at('.flow-node');
  await t.dragTo(np.x, np.y, np.x + 60, np.y + 40);
  const x1 = await t.ev(nodeX);
  await t.click(np.x, np.y, { count: 2 });
  await t.ev(t.key('Delete')); await t.ev(t.key('z', { ctrlKey: true })); await t.ev(t.key('s', { ctrlKey: true }));
  t.check('presentation: dragging a step pans the view, double-click, Delete, Ctrl+Z and Ctrl+S change nothing',
    x1 !== x0 && await t.ev(positions) === posBefore && await t.ev(`document.querySelectorAll('.flow-node').length`) === nodeCount2
    && await t.ev(`!document.querySelector('[contenteditable="true"]') && document.getElementById('save-status').textContent`) !== 'Unsaved changes' && t.errors.length === 0, `x ${x0}->${x1} errors=${t.errors.join(' | ')}`);
  const z0 = await t.ev(`document.getElementById('zoom-level').textContent`);
  await t.clickOn('#btn-zoom-in');
  t.check('presentation: zoom still works', await t.ev(`document.getElementById('zoom-level').textContent`) !== z0);
  await t.ev(t.key('Escape'));
  t.check('Esc leaves presentation and the Present button follows', !(await t.ev(isPres)) && await t.ev(prsd) === 'false');
  await t.ev(t.key('Escape'));
  await t.clickOn('#btn-present'); await t.clickOn('#btn-present');
  t.check('the Present button toggles back off', !(await t.ev(isPres)) && await t.ev(prsd) === 'false' && (await t.ev(`(${visChrome}).length`)) === chromeBefore);

  // 11. The saved file (dev/plans/plan-agent-readable-data.md). Without a user gesture the file picker refuses, so
  //     Save takes its download path: capture the download and read what an agent would read
  await t.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  const saveAndRead = async () => {
    readdirSync(dlDir).forEach(f => rmSync(join(dlDir, f), { force: true }));
    await t.ev(t.key('s', { ctrlKey: true }));
    for (let i = 0; i < 60; i++) {
      const f = readdirSync(dlDir).find(n => n.endsWith('.html'));
      if (f) { await sleep(200); return readFileSync(join(dlDir, f), 'utf8'); }
      await sleep(100);
    }
    return '';
  };
  const blockOf = (html) => (html.match(/<script id="diagram-data" type="application\/json">([\s\S]*?)<\/script>/) || [])[1];
  const generated = readFileSync(laid, 'utf8').replace(/\r\n/g, '\n');
  const genModel = JSON.parse(blockOf(generated));

  // 11a. Round-trip parity: the page's toDisk + formatJson write exactly what Python's assemble_page() wrote
  await t.open(laid);
  const saved0 = await saveAndRead();
  t.check('Save without edits writes the data block byte-identical to the generated page (JS and Python codecs agree)',
    saved0 && blockOf(saved0) === blockOf(generated), `saved ${saved0.length} chars; block ${JSON.stringify((blockOf(saved0) || '').slice(0, 200))}`);
  t.check('the saved file keeps the reading guide on line 2 and the end marker after the block',
    saved0.split('\n')[1].startsWith('<!-- For agents:') && /<\/script>\n {2}<!-- end diagram-data -->/.test(saved0) && saved0.indexOf(`id="diagram-data"`) < saved0.indexOf('</head>'),
    saved0.split('\n').slice(0, 3).join(' / '));

  // 11b. Save writes the diagram title into <title> and the header <h1>, escaped
  await t.ev(`(() => { const h = document.getElementById('chart-title'); h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    h.textContent = 'A & <B>'; h.blur(); if (h.isContentEditable) h.dispatchEvent(new FocusEvent('blur')); })()`);
  const saved1 = await saveAndRead();
  t.check('Save writes the renamed title, escaped, into <title> and <h1>',
    saved1.includes('<title>A &amp; &lt;B&gt;</title>') && /<h1 id="chart-title"[^>]*>A &amp; &lt;B&gt;<\/h1>/.test(saved1) && JSON.parse(blockOf(saved1)).title === 'A & <B>',
    (saved1.match(/<title>[\s\S]*?<\/title>/) || [''])[0]);
  const reopenFile = join(dlDir, 'reopen.html');
  writeFileSync(reopenFile, saved1);
  await t.open(reopenFile);
  t.check('the saved file reopens with its title and every step', (await t.ev(`document.getElementById('chart-title').textContent`)) === 'A & <B>'
    && (await t.ev(`document.title`)) === 'A & <B>' && (await t.ev(`document.querySelectorAll('.flow-node').length`)) === genModel.nodes.length && t.errors.length === 0,
    t.errors.join(' | '));

  // 11c. Ids the editor generates are renamed on save (after the label / connector letter / next free e<N>);
  //      authored ids and the page's own (in-memory) ids are untouched
  await t.open(laid);
  await t.ev(`document.querySelector('.btn-shape[data-node-type="task"]').click()`);
  await sleep(200);
  const pathBetweenSteps = `[...document.querySelectorAll('.edge-line')].find(p => !/^c/.test(p.dataset.from) && !/^c/.test(p.dataset.to) && document.getElementById('node-' + p.dataset.to)?.classList.contains('type-task'))`;
  await t.ev(`(${pathBetweenSteps}).dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await t.ev(`document.querySelector('.edge-bar [data-act="split"]')?.click()`);
  await sleep(200);
  const saved2 = JSON.parse(blockOf(await saveAndRead()));
  const ids = new Set(saved2.nodes.map(n => n.id));
  const generatedId = /^(n|c|e|lane)_\d{12,}(_\d+)?$/;
  const all = [...saved2.lanes, ...saved2.nodes, ...saved2.edges].map(o => o.id);
  const keptAuthored = [...genModel.lanes, ...genModel.nodes, ...genModel.edges].every(o => all.includes(o.id));
  const conns = saved2.nodes.filter(n => n.type === 'connector').map(n => n.id).sort();
  const refsOk = saved2.edges.every(e => ids.has(e.from) && ids.has(e.to)) && (saved2.notes || []).every(n => n.nodes.every(i => ids.has(i)))
    && Object.keys(saved2.layout).every(k => ids.has(k) || saved2.lanes.some(l => l.id === k)) && saved2.nodes.every(n => saved2.layout[n.id]);
  t.check('Save renames generated ids: a new step is n_new_step, a split pair c_<letter>_in/out, its arrow e<N>; references follow',
    ids.has('n_new_step') && conns.length === 2 && /^c_[a-z]+_in$/.test(conns[0]) && /^c_[a-z]+_out$/.test(conns[1]) && !all.some(i => generatedId.test(i)) && refsOk,
    JSON.stringify({ conns, generated: all.filter(i => generatedId.test(i)), refsOk, ids: [...ids] }));
  t.check('Save keeps every authored id', keptAuthored);
  t.check('in the page the new step keeps its own id until it is reopened (selection and undo are undisturbed)',
    await t.ev(`!!document.querySelector('.flow-node[data-node-id^="n_1"]') && !document.querySelector('.flow-node[data-node-id="n_new_step"]')`));
  const laneIdx = Object.fromEntries(saved2.lanes.map((l, i) => [l.id, i]));
  const keyOf = (n) => [saved2.layout[n.id].x, laneIdx[n.laneId], saved2.layout[n.id].y];
  const inFlowOrder = saved2.nodes.every((n, i) => i === 0 || (() => { const a = keyOf(saved2.nodes[i - 1]), b = keyOf(n);
    return a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] <= b[2]))); })());
  t.check('saved steps are in flow order (x, then lane, then y), with positions only in "layout"',
    inFlowOrder && saved2.nodes.every(n => !('x' in n) && !('y' in n)) && saved2.lanes.every(l => !('height' in l)));
  });

  // 12. claude.ai Artifact (only with --artifact): Save publishes files-form updates through the artifact capability.
  await t.section('artifact', async () => {
  //     window.claude is stubbed before the page's scripts run; use() answers from a script-controlled config.
  if (artifact) {
    const genData = readFileSync(join(dirname(artifact), 'diagram.json'), 'utf8').replace(/\r\n/g, '\n');
    const artModel = JSON.parse(genData);
    const stub = (cfg) => `(() => {
      const cfg = ${JSON.stringify(cfg)};
      window.__pub = []; window.__dl = [];
      window.claude = { use: async (name) => {
        if (name === 'artifact') {
          if (cfg.artifact === null) return null;
          return { publish: async (files) => { window.__pub.push(files); await new Promise(r => setTimeout(r, window.__delay || 150)); if (window.__reject) throw Object.assign(new Error('stub ' + window.__reject), { code: window.__reject }); } };
        }
        if (name === 'downloads') return cfg.downloads === false ? null : { save: async (a) => { window.__dl.push({ filename: a.filename, type: a.data.type, text: typeof a.data === 'string' ? a.data : await a.data.text() }); } };
        return null;
      } };
      // What a viewer may inject at run time: a runtime script in <head> and one appended to <body> after our content
      if (cfg.inject) document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('script'); s.id = 'claude-runtime-probe'; s.textContent = '/* injected */';
        document.head.appendChild(s.cloneNode(true)); document.body.appendChild(s);
      });
    })()`;
    let stubId = null;
    const openWith = async (cfg) => {
      if (stubId) await t.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: stubId });
      stubId = cfg ? (await t.send('Page.addScriptToEvaluateOnNewDocument', { source: stub(cfg) })).identifier : null;
      await t.open(artifact);
      await sleep(300);
    };
    const badge = () => t.ev(`document.getElementById('save-status').textContent`);
    const toast = () => t.ev(`[...document.querySelectorAll('.toast')].map(x => x.textContent).join('|')`);
    const saveVisible = () => t.ev(`getComputedStyle(document.getElementById('btn-save')).display !== 'none' && !document.getElementById('btn-save').disabled`);
    const dataBlockOf = (html) => (html.match(/<script id="diagram-data" type="application\/json">([\s\S]*?)<\/script>/) || [])[1];
    const rename = (name) => t.ev(`(() => { const h = document.getElementById('chart-title'); h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      h.textContent = ${JSON.stringify(name)}; h.blur(); if (h.isContentEditable) h.dispatchEvent(new FocusEvent('blur')); })()`);

    // 12a. Inside an artifact: Save publishes once (a double click is one publish), with {'diagram.json': genData}
    await openWith({ inject: true });
    t.check('artifact: badge reads "Saved to artifact" and Save is enabled once use("artifact") resolves',
      (await badge()) === 'Saved to artifact' && await saveVisible() && t.errors.length === 0, `${await badge()} ${t.errors.join(' | ')}`);
    await t.ev(`(() => { document.getElementById('btn-save').click(); document.getElementById('btn-save').click(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })); })()`);
    await sleep(500);
    const pub = JSON.parse(await t.ev(`JSON.stringify(window.__pub)`));
    t.check('artifact: Save publishes exactly once (double click and Ctrl+S while in flight add nothing)', pub.length === 1, `publishes=${pub.length}`);
    const files1 = pub[0] || {};
    t.check('artifact: Save publishes {"diagram.json": genData} byte-identical to sibling diagram.json',
      Object.keys(files1).length === 1 && files1['diagram.json'] === genData, JSON.stringify(Object.keys(files1)));
    t.check('artifact: nothing the viewer injected is published',
      !Object.values(files1).some(v => String(v).includes('claude-runtime-probe')));
    t.check('artifact: the page after publishing says "Saved to artifact"', (await badge()) === 'Saved to artifact' && await saveVisible());

    // 12b. Edits: Unsaved changes, Save carries edits in diagram.json, selection and undo stack survive Save
    const origTitle = await t.ev(`document.getElementById('chart-title').textContent`);
    const origNodes = await t.ev(`document.querySelectorAll('.flow-node').length`);
    await rename('Edited <title>');
    t.check('artifact: an edit shows "Unsaved changes"', (await badge()) === 'Unsaved changes');
    await t.ev(`document.querySelector('.btn-shape[data-node-type="task"]').click()`);
    await sleep(200);
    const selId = await t.ev(`document.querySelector('.flow-node.selected')?.dataset.nodeId`);
    t.check('artifact: adding a step selects it and increases node count',
      !!selId && (await t.ev(`document.querySelectorAll('.flow-node').length`)) === origNodes + 1);
    await t.ev(`document.getElementById('btn-save').click()`);
    await sleep(500);
    const pub2 = JSON.parse(await t.ev(`JSON.stringify(window.__pub)`));
    const json2 = (pub2[1] && pub2[1]['diagram.json']) || '';
    const d2 = json2 ? JSON.parse(json2) : null;
    const idx2 = (pub2[1] && pub2[1]['index.html']) || '';
    t.check('artifact: a rename also publishes index.html with the new <title> (the artifact keeps its name), nothing else changes in it',
      Object.keys(pub2[1] || {}).sort().join() === 'diagram.json,index.html' && idx2.includes('<title>Edited &lt;title&gt;</title>')
      && idx2.replace(/<title>[\s\S]*?<\/title>/, '') === readFileSync(artifact, 'utf8').replace(/<title>[\s\S]*?<\/title>/, ''), idx2.slice(0, 120));
    t.check('artifact: the second publish carries the title and diagram edit in diagram.json',
      pub2.length === 2 && json2.endsWith('\n')
      && d2 && d2.title === 'Edited <title>' && d2.nodes.length === origNodes + 1
      && (await t.ev(`document.title`)) === 'Edited <title>' && (await t.ev(`document.getElementById('chart-title').textContent`)) === 'Edited <title>',
      `${pub2.length} title=${d2 && d2.title}`);
    t.check('artifact: selection stays selected, undo stack survives Save, and badge returns to "Saved to artifact"',
      (await t.ev(`document.querySelector('.flow-node.selected')?.dataset.nodeId`)) === selId
      && !(await t.ev(`document.getElementById('btn-undo').disabled`))
      && (await badge()) === 'Saved to artifact' && await saveVisible() && t.errors.length === 0,
      `sel=${await t.ev(`document.querySelector('.flow-node.selected')?.dataset.nodeId`)} badge=${await badge()}`);
    await t.ev(t.key('z', { ctrlKey: true }));
    t.check('artifact: Ctrl+Z works after Save (undoes diagram edit and marks Unsaved changes)',
      (await t.ev(`document.querySelectorAll('.flow-node').length`)) === origNodes && (await badge()) === 'Unsaved changes',
      `${await t.ev(`document.querySelectorAll('.flow-node').length`)} ${await badge()}`);
    await t.ev(t.key('z', { ctrlKey: true }));
    t.check('artifact: second Ctrl+Z undoes title edit',
      (await t.ev(`document.getElementById('chart-title').textContent`)) === origTitle
      && (await t.ev(`document.title`)) === origTitle && (await badge()) === 'Unsaved changes',
      `${await t.ev(`document.getElementById('chart-title').textContent`)} ${await badge()}`);

    // 12c. Rejections
    await openWith({});
    await t.ev(`window.__reject = 'conflict'`);
    await rename('X1');
    await t.ev(`document.getElementById('btn-save').click()`);
    await sleep(500);
    t.check('artifact: a conflict shows a toast and is not retried', /Someone else saved first/.test(await toast()) && (await t.ev(`window.__pub.length`)) === 1, await toast());
    for (const codeName of ['not_writer', 'capability_disabled']) {
      await openWith({});
      await t.ev(`window.__reject = ${JSON.stringify(codeName)}`);
      await rename('X2');
      await t.ev(`document.getElementById('btn-save').click()`);
      await sleep(500);
      t.check(`artifact: ${codeName} switches to View only with no #btn-download-html and mentions Export > HTML file`,
        (await badge()) === 'View only' && !(await saveVisible())
        && await t.ev(`document.getElementById('btn-save').hidden && !document.getElementById('btn-download-html')`)
        && /Export > HTML file/.test(await toast())
        && /Export > HTML file/.test(await t.ev(`document.getElementById('save-status').title`)),
        `${await badge()} | ${await toast()} | ${await t.ev(`document.getElementById('save-status').title`)}`);
    }
    await openWith({});
    await t.ev(`window.__reject = 'network down'`);   // an unknown code counts as upstream_error: retried once
    await rename('X3');
    await t.ev(`document.getElementById('btn-save').click()`);
    await sleep(2600);
    t.check('artifact: upstream_error (or an unknown code) is retried once, then toasts, keeps "Unsaved changes" and re-enables Save',
      /Save failed \(upstream_error\)/.test(await toast()) && (await t.ev(`window.__pub.length`)) === 2 && (await badge()) === 'Unsaved changes' && await saveVisible(),
      `${await toast()} ${await badge()} publishes=${await t.ev(`window.__pub.length`)}`);
    await openWith({});
    await t.ev(`window.__reject = 'rate_limited'`);
    await rename('X4');
    await t.ev(`document.getElementById('btn-save').click()`);
    await sleep(500);
    t.check('artifact: rate_limited is not retried and asks the viewer to wait',
      /Saving too often/.test(await toast()) && (await t.ev(`window.__pub.length`)) === 1 && await saveVisible(), await toast());

    // 12c'. Ctrl+S while the one retry waits is not a second publish
    await openWith({});
    await t.ev(`window.__reject = 'upstream_error'`);
    await rename('X5');
    await t.ev(`document.getElementById('btn-save').click()`);
    await sleep(400);   // the first publish has failed and the retry delay (0.5-1.5 s) is running
    await t.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))`);
    await sleep(2600);
    t.check('artifact: Ctrl+S during the retry delay adds no third publish (first try + one retry only)',
      (await t.ev(`window.__pub.length`)) === 2, `publishes=${await t.ev(`window.__pub.length`)}`);
    // 12c''. An edit made while a publish is in flight stays "Unsaved changes"
    await openWith({});
    await t.ev(`window.__delay = 600`);
    await t.ev(`document.getElementById('btn-save').click()`);
    await sleep(150);
    await rename('Edited mid-publish');
    await sleep(900);
    t.check('artifact: an edit made while a publish is in flight is not reported as saved',
      (await badge()) === 'Unsaved changes', await badge());

    // 12d. use("artifact") -> null: a viewer who cannot save uses Export > HTML file
    await openWith({ artifact: null });
    t.check('artifact: use() -> null shows "View only", hides Save, and adds no #btn-download-html',
      (await badge()) === 'View only' && !(await saveVisible())
      && await t.ev(`document.getElementById('btn-save').hidden && !document.getElementById('btn-download-html') && !!document.querySelector('[data-export="html"]')`),
      await badge());
    await t.ev(`document.getElementById('btn-export').click()`);
    await t.ev(`document.querySelector('[data-export="html"]').click()`);
    let dl = [];
    for (let i = 0; i < 20 && !dl.length; i++) {
      await sleep(100);
      dl = JSON.parse(await t.ev(`JSON.stringify(window.__dl)`));
    }
    const fileDoc = (dl[0] || {}).text || '';
    const gl = fileDoc.match(/on lines (\d+)-(\d+) of this file\. Read lines 1-(\d+) only \(offset 1, limit (\d+)\)/);
    const lines = fileDoc.split('\n');
    const realStart = lines.findIndex((l) => l.includes('<script id="diagram-data" type="application/json">')) + 1;
    const realEnd = lines.findIndex((l) => l.includes('<!-- end diagram-data -->')) + 1;
    const headEnd = fileDoc.indexOf('</head>');
    const headSection = headEnd > 0 ? fileDoc.slice(fileDoc.indexOf('<head>'), headEnd) : '';
    const pageShell = fileDoc.lastIndexOf('\n  <script>\n') > 0 ? fileDoc.slice(0, fileDoc.lastIndexOf('\n  <script>\n')) : fileDoc;
    t.check('artifact: Export > HTML file hands downloads.save a valid file-target page (doctype, head data block, exact guide lines, inlined assets)',
      dl.length === 1 && /\.html$/.test(dl[0].filename) && fileDoc.startsWith('<!DOCTYPE html>\n<!-- For agents:') && fileDoc.indexOf('<head>') > 0
      && headSection.includes('<script id="diagram-data" type="application/json">')
      && gl && realStart > 0 && realEnd > realStart && +gl[1] === realStart && +gl[2] === realEnd && +gl[3] === realEnd && +gl[4] === realEnd
      && (dataBlockOf(fileDoc) || '').trim() === genData.trim()
      && !pageShell.includes('href="app.css"') && !pageShell.includes('src="app.js"')
      && fileDoc.includes('<style>') && fileDoc.includes('<script>')
      && (await t.ev(`window.__pub.length`)) === 0, fileDoc.slice(0, 200));
    const dlFile = join(dlDir, 'downloaded.html');
    writeFileSync(dlFile, fileDoc);
    await t.open(dlFile);
    t.check('artifact: the exported file opens offline as an ordinary diagram page',
      (await t.ev(`document.querySelectorAll('.flow-node').length`)) === artModel.nodes.length
      && (!artModel.title || (await t.ev(`document.getElementById('chart-title').textContent`)) === artModel.title)
      && t.errors.length === 0 && (await badge()) === 'Ready', t.errors.join(' | '));
    // Export SVG goes through the downloads capability instead of <a download>
    await openWith({});
    await t.ev(`document.getElementById('btn-export').click()`);
    await t.ev(`document.querySelector('[data-export="svg"]').click()`);
    await sleep(500);
    const dl2 = JSON.parse(await t.ev(`JSON.stringify(window.__dl)`));
    t.check('artifact: Export SVG goes through downloads.save', dl2.length === 1 && /\.svg$/.test(dl2[0].filename) && dl2[0].text.includes('<svg'), JSON.stringify(dl2).slice(0, 200));

    // 12e. No window.claude: Ready badge, Save enabled, no artifact Export > HTML menu item
    await openWith(null);
    t.check('artifact page without window.claude: Ready badge, Save enabled, no artifact UI',
      (await badge()) === 'Ready' && await saveVisible()
      && await t.ev(`!document.getElementById('btn-download-html') && !document.querySelector('[data-export="html"]')`)
      && t.errors.length === 0, `${await badge()} ${t.errors.join(' | ')}`);
  }
  });

  // 13. Direct-save helper: file:// diagram with diagram-save-id saves straight through save_helper.py
  //     on first Ctrl+S with zero bubble and zero picker, and falls back cleanly when stopped
  await t.section('direct-save-helper', async () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const helperScript = join(repoRoot, 'scripts', 'save_helper.py');
    const helperCache = mkdtempSync(join(tmpdir(), 'save_helper_cache_'));
    const helperFile = join(dlDir, 'helper-direct.html');
    const saveId = '0123456789abcdef0123456789abcdef';
    const rawHtml = readFileSync(laid, 'utf8');
    const stampedHtml = rawHtml.includes('name="diagram-save-id"')
      ? rawHtml.replace(/<meta\s+name="diagram-save-id"\s+content="[0-9a-f]{32}"\s*\/?>/, `<meta name="diagram-save-id" content="${saveId}">`)
      : rawHtml.replace(/(<meta\s+charset="UTF-8"\s*\/?>)/i, `$1\n  <meta name="diagram-save-id" content="${saveId}">`);
    writeFileSync(helperFile, stampedHtml, 'utf8');
    writeFileSync(join(helperCache, 'allowed-ids.json'), JSON.stringify({
      ids: { [saveId]: { path: resolve(helperFile), updated_at: Date.now() / 1000 } }
    }), 'utf8');

    const port = await new Promise((res, rej) => {
      const s = createServer();
      s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
      s.on('error', rej);
    });
    const proc = spawn(process.platform === 'win32' ? 'python' : 'python3',
      [helperScript, 'serve', '--port', String(port), '--idle-timeout', '30'],
      { env: { ...process.env, ULTIMATE_DIAGRAM_CACHE_DIR: helperCache }, stdio: 'ignore' });
    try {
      let healthy = false;
      for (let i = 0; i < 40 && !healthy; i++) {
        try {
          const r = await fetch(`http://127.0.0.1:${port}/health`);
          if (r.ok) healthy = true;
        } catch { /* wait for bind */ }
        if (!healthy) await sleep(75);
      }
      t.check('direct-save helper test server starts and passes /health', healthy, `port=${port}`);

      await t.open(helperFile);
      await t.ev(`window.__ULTIMATE_DIAGRAM_HELPER_PORTS__ = [${port}]`);
      await t.ev(`(() => { const h = document.getElementById('chart-title'); h.textContent = 'Saved via Helper'; h.dispatchEvent(new Event('input', { bubbles: true })); h.dispatchEvent(new Event('blur')); })()`);
      await t.ev(t.key('s', { ctrlKey: true }));
      let savedBadge = '', savedTip = '', hasPop = false;
      for (let i = 0; i < 30; i++) {
        savedBadge = await t.ev(`document.getElementById('save-status').textContent.trim()`);
        savedTip = await t.ev(`document.getElementById('save-status').getAttribute('title') || ''`);
        hasPop = await t.ev(`!!document.querySelector('.confirm .save-where')`);
        if (savedBadge === 'Saved to helper-direct.html') break;
        await sleep(100);
      }
      t.check('file:// Ctrl+S saves straight through local helper with zero bubble or picker',
        savedBadge === 'Saved to helper-direct.html' && /local helper/i.test(savedTip) && !hasPop,
        `badge=${savedBadge} tip=${savedTip} pop=${hasPop}`);

      // Reload the file from disk to verify the helper patched it cleanly
      await t.open(helperFile);
      const reloadedTitle = await t.ev(`document.getElementById('chart-title').textContent.trim()`);
      t.check('reloading the helper-saved file shows the edited title and zero runtime errors',
        reloadedTitle === 'Saved via Helper' && t.errors.length === 0, `title=${reloadedTitle} errors=${t.errors.join(' | ')}`);

      // Stop helper and verify Ctrl+S falls back cleanly to the existing first-save bubble
      await new Promise((res) => { proc.once('exit', res); proc.kill('SIGKILL'); });
      await t.ev(`(() => {
        window.__ULTIMATE_DIAGRAM_HELPER_PORTS__ = [${port}];
        delete window.showDirectoryPicker;
        navigator.clipboard.writeText = async () => {};
        window.showSaveFilePicker = async () => { throw new DOMException('x', 'AbortError'); };
        const h = document.getElementById('chart-title');
        h.textContent = 'After Helper Stopped';
        h.dispatchEvent(new Event('input', { bubbles: true }));
        h.dispatchEvent(new Event('blur'));
      })()`);
      await t.ev(t.key('s', { ctrlKey: true }));
      let fallbackPop = false;
      for (let i = 0; i < 20 && !fallbackPop; i++) {
        fallbackPop = await t.ev(`!!document.querySelector('.confirm .save-where')`);
        if (!fallbackPop) await sleep(100);
      }
      t.check('when helper is stopped, Ctrl+S falls back cleanly to the first-save bubble', fallbackPop);
    } finally {
      try { proc.kill(); } catch { /* already stopped */ }
      try { rmSync(helperCache, { recursive: true, force: true }); } catch { /* temp dir */ }
    }
  });
} catch (err) {
  console.error('[ERROR]', err.message);
  code = 1;
} finally {
  await t.close();
  try { rmSync(dlDir, { recursive: true, force: true }); } catch { /* temp dir */ }
}
process.exit(code || t.finish());
