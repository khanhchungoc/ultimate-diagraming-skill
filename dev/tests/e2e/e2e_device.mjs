// Phone check for every diagram type, with motion on: real touch input on a mobile-emulated 390x844 screen (as on an iPhone;
// Gantt on a 1024x768 touch tablet, where its bars are on screen),
// then a note's round trip through the shared notes controller (assets/shell/notes.js).
//   touch: a tap selects an item; a selected item shows its connect ports at finger size (components/port.css, .is-touch)
//          where the type has ports; a tap on blank canvas clears the selection.
//   notes: "Add note" on the selected item opens a card being typed, typed text is kept after a tap elsewhere, and emptying the
//          card removes it with a morph (a ghost that moves and scales towards the badge, never a plain fade).
// Builds each page from dev/examples into a temp directory. Driven over the Chrome DevTools Protocol, see cdp.mjs.
//
//   node dev/tests/e2e/e2e_device.mjs [--browser <chrome>] [--type flowchart,erd]
// Not a real device: an emulated phone (touch events, mobile viewport). Gantt and sequence note removal is checked once Wave C lands.
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { argOf, findBrowser, launch, sleep } from './cdp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TYPES = {
  flowchart: { src: ['dev/examples/example-flowchart.json'], item: '.flow-node.type-task', ports: true },
  sequence: { src: ['dev/examples/example-sequence.json'], item: '.seq-participant', ports: false },
  erd: { src: ['dev/examples/example-erd.json'], item: '.erd-entity', ports: true },
  usecase: { src: ['dev/examples/example-usecase.json'], item: '.uc-case', ports: true },
  c4: { src: ['dev/examples/example-c4.json'], item: '.c4-node', ports: true },
  gantt: { src: ['dev/examples/example-gantt.mmd', '--no-holidays'], item: '.gantt-bar', ports: true, size: [1024, 768], reveal: true, keepSel: true },   // keepSel: its blank spot is the task-list header, not empty timeline   // a touch tablet: on a phone the task list fills the width and the bars sit off-screen
};
const only = (argOf('type') || '').split(',').filter(Boolean);
const types = Object.keys(TYPES).filter((k) => !only.length || only.includes(k));
const W = 390, H = 844;

const dir = mkdtempSync(join(tmpdir(), 'e2e-device-'));
const pages = {};
for (const k of types) {
  const [src, ...extra] = TYPES[k].src;
  const page = join(dir, `${k}.html`);
  const r = spawnSync('python3', [join(root, 'scripts', 'layout_engine.py'), '--layout', join(root, src), '-o', page, '--no-save-helper', ...extra], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('[ERROR] build', k, r.stderr || r.stdout); process.exit(1); }
  pages[k] = page;
}

const t = await launch(findBrowser(argOf('browser'))).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
const touch = (type, points) => t.send('Input.dispatchTouchEvent', { type, touchPoints: points });
const tap = async (x, y) => { await touch('touchStart', [{ x, y, id: 1 }]); await sleep(40); await touch('touchEnd', []); await sleep(260); };
// The first item fully on screen (the view may be panned), its centre in window coordinates
const itemAt = (sel) => `(() => {
  const vw = innerWidth, vh = innerHeight;
  const all = [...document.querySelectorAll(${JSON.stringify(sel)})];
  const bare = all.filter((el) => !el.querySelector('.note-badge, .c4-note-pin'));   // an item without a note: Add note makes a new one
  for (const el of [...bare, ...all]) {
    const r = el.getBoundingClientRect();
    if (r.width > 8 && r.height > 8 && r.left > 4 && r.top > 80 && r.right < vw - 4 && r.bottom < vh - 120) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return null;
})()`;
// A point on blank canvas: no item, no chrome
const blankAt = `(() => {
  for (let y = 140; y < innerHeight - 140; y += 23) for (let x = 20; x < innerWidth - 20; x += 23) {
    const e = document.elementFromPoint(x, y);
    if (e && (e.id === 'viewport' || e.id === 'stage' || e.closest('#viewport')) && !e.closest('[data-item], .flow-node, .seq-participant, .erd-entity, .uc-case, .uc-actor, .c4-node, .c4-group, .gantt-bar, .gantt-milestone, .edge-label, .note, .actionbar, svg path, svg line, .lane-pill, button, [role=button]')) return { x, y };
  }
  return null;
})()`;
const selectedCount = `document.querySelectorAll('.selected:not(.lane-pill)').length`;

try {
  await t.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  for (const k of types) {
    const cfg = TYPES[k];
    const [w, h] = cfg.size || [W, H];
    await t.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await t.open(pages[k], '', { motion: true });
    await sleep(500);
    await t.section(`${k}`, async () => {
      // Gantt: bars off the visible timeframe show a "Jump to" pill at the edge; tap one for a task without a note
      if (cfg.reveal) {
        const pill = await t.ev(`(() => { const p = [...document.querySelectorAll('.gantt-offscreen-pill')].find((x) => { const b = document.querySelector('.gantt-bar[data-item-id="' + x.dataset.itemId + '"]'); return b && !b.querySelector('.note-badge') && b.getBoundingClientRect().height > 12; }); if (!p) return null; const r = p.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        if (pill) { await tap(pill.x, pill.y); await sleep(700); }
      }
      // Pan with one finger until an item without a note sits mid-screen (a phone shows only part of the diagram)
      const far = await t.ev(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(cfg.item)})].find((e) => !e.querySelector('.note-badge, .c4-note-pin') && e.getBoundingClientRect().width > 8);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { dx: innerWidth / 2 - (r.left + r.width / 2), dy: innerHeight / 2 - (r.top + r.height / 2) };
      })()`);
      const start = await t.ev(blankAt);
      if (far && start && (Math.abs(far.dx) > 40 || Math.abs(far.dy) > 40)) {
        await touch('touchStart', [{ x: start.x, y: start.y, id: 1 }]);
        for (let i = 1; i <= 10; i++) await touch('touchMove', [{ x: start.x + far.dx * i / 10, y: start.y + far.dy * i / 10, id: 1 }]);
        await touch('touchEnd', []);
        await sleep(400);
      }
      const p = await t.ev(itemAt(cfg.item));
      t.check(`${k}: an item is on screen to tap`, !!p, cfg.item);
      if (!p) return;
      await tap(p.x, p.y);
      t.check(`${k}: tapped ` + await t.ev(`[...document.querySelectorAll('.selected')].map((e) => (e.dataset.nodeId || '') + ':' + !!e.querySelector('.note-badge')).join()`), true);
      t.check(`${k}: a tap selects the item`, (await t.ev(selectedCount)) >= 1);
      if (cfg.ports) {
        const ports = await t.ev(`(() => {
          const sel = document.querySelector(${JSON.stringify(cfg.item)} + '.selected') || document.querySelector('.selected');
          const ps = sel ? [...sel.querySelectorAll(':scope > .port:not(.port-end), .port:not(.port-end)')] : [];
          const shown = ps.filter((e) => getComputedStyle(e).opacity === '1' && getComputedStyle(e).pointerEvents !== 'none');
          return { touch: document.body.classList.contains('is-touch'), n: ps.length, shown: shown.length, size: shown[0] ? getComputedStyle(shown[0]).width : '' };
        })()`);
        t.check(`${k}: the body is .is-touch and the selected item shows finger-sized ports`, ports.touch && ports.shown > 0 && ports.size === '20px', JSON.stringify(ports));
      }
      // Notes: add on the selected item, type, finish with a tap elsewhere
      const canAdd = await t.ev(`(() => { const b = document.getElementById('btn-add-note'); return !!b && !b.hidden && !b.disabled && b.getBoundingClientRect().width > 0; })()`);
      t.check(`${k}: "Add note" is offered`, canAdd);
      if (canAdd) {
        const before = await t.ev(`document.querySelectorAll('.note').length`);
        // On a phone the add tools fold into the dock's Add menu: open it first, as a person would
        const trig = await t.ev(`(() => { const w = document.getElementById('btn-add-note').closest('[data-dock-pop]'); const b = w && w.querySelector('.dock-pop-trigger'); if (!b || b.getAttribute('aria-expanded') === 'true') return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        if (trig) { await tap(trig.x, trig.y); await sleep(200); }
        const nb = await t.ev(`(() => { const r = document.getElementById('btn-add-note').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        await tap(nb.x, nb.y);   // a real tap: some docks act on pointer up, not on a scripted click
        await sleep(300);
        const editing = await t.ev(`(() => { const a = document.activeElement; return !!a && a.classList.contains('note-text') && a.isContentEditable; })()`);
        t.check(`${k}: the new note opens being typed`, editing);
        await t.send('Input.insertText', { text: 'Device check' });
        const b = await t.ev(blankAt);
        t.check(`${k}: blank canvas to tap`, !!b);
        if (b) await tap(b.x, b.y);
        await sleep(250);
        const kept = await t.ev(`[...document.querySelectorAll('.note .note-text')].some((e) => e.textContent.trim() === 'Device check')`);
        const after = await t.ev(`JSON.stringify({ sel: [...document.querySelectorAll('.selected')].map((e) => e.dataset.nodeId || e.className).join(), nodes: [...document.querySelectorAll('.note')].filter((n) => /Device/.test(n.textContent)).map((n) => n.dataset.nodes), n: document.querySelectorAll('.note').length, dev: [...document.querySelectorAll('.note .note-text')].filter((e) => /Device/.test(e.textContent)).map((e) => [e.textContent, e.isContentEditable, getComputedStyle(e.closest('.note')).display]), active: document.activeElement && document.activeElement.className, blank: ${JSON.stringify(b)}, at: (() => { const e = document.elementFromPoint(${b ? b.x : 0}, ${b ? b.y : 0}); return e ? e.id + '.' + (e.className.baseVal ?? e.className) : ''; })() })`);
        t.check(`${k}: the typed note is kept after a tap elsewhere`, kept, after);
        if (b && !cfg.keepSel) t.check(`${k}: that tap also cleared the selection`, (await t.ev(selectedCount)) === 0, String(await t.ev(selectedCount)));
        // Empty it: edit, clear the text, tap away; the card leaves as a morph
        const card = `[...document.querySelectorAll('.note')].find((n) => n.querySelector('.note-text') && n.querySelector('.note-text').textContent.trim() === 'Device check')`;
        await t.ev(`(() => { const tx = (${card}).querySelector('.note-text'); tx.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`);
        await sleep(200);
        const reopened = await t.ev(`(() => { const a = document.activeElement; return !!a && a.classList.contains('note-text') && a.isContentEditable; })()`);
        t.check(`${k}: a double-tap on the note's text edits it again`, reopened);
        await t.ev(`(() => { const a = document.activeElement; if (a && a.isContentEditable) { a.textContent = ''; } })()`);
        await t.ev(`window.__ghosts = []; window.__mo = new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
          if (n.nodeType === 1 && n.hasAttribute('data-motion-ghost')) window.__ghosts.push(n.getAnimations().map((a) => a.effect.getKeyframes().map((f) => Object.keys(f).filter((x) => !['offset', 'easing', 'composite', 'computedOffset'].includes(x)))).flat(2));
        }))); window.__mo.observe(document.body, { childList: true, subtree: true });`);
        if (b) await tap(b.x, b.y);
        await sleep(400);
        const gone = await t.ev(`!(${card})`);
        const ghosts = await t.ev(`(() => { window.__mo.disconnect(); return window.__ghosts; })()`);
        t.check(`${k}: emptying the note removes it`, gone);
        t.check(`${k}: it leaves as a morph (a ghost that moves or scales, not only a fade)`, ghosts.length > 0 && ghosts.some((props) => props.includes('transform') || props.includes('width') || props.includes('clipPath')), JSON.stringify(ghosts));
      }
      t.check(`${k}: no page errors`, t.errors.length === 0, t.errors.join(' | '));

      // Dock overflow & More menu across phone widths (320, 390, 412 px)
      for (const pw of [320, 390, 412]) {
        await t.send('Emulation.setDeviceMetricsOverride', { width: pw, height: H, deviceScaleFactor: 2, mobile: true });
        await sleep(220);
        const dockInfo = await t.ev(`(() => {
          const dock = document.querySelector('.toolbar-center');
          if (!dock) return { missing: true };
          const vw = window.innerWidth;
          const dr = dock.getBoundingClientRect();
          const kids = [...dock.children].filter((el) => !el.hidden && getComputedStyle(el).display !== 'none');
          const bad = kids.map((el) => {
            const r = el.getBoundingClientRect();
            return { id: el.id || el.className, l: Math.round(r.left * 10) / 10, r: Math.round(r.right * 10) / 10, w: Math.round(r.width) };
          }).filter((x) => x.w > 0 && (x.l < -0.5 || x.r > vw + 0.5));
          const folded = [...dock.children].filter((el) => el.dataset.dockFolded === 'true').map((el) => el.id || el.className);
          const moreBtn = document.getElementById('btn-dock-more');
          const moreVisible = !!moreBtn && !moreBtn.closest('[hidden]') && getComputedStyle(moreBtn).display !== 'none' && moreBtn.getBoundingClientRect().width > 0;
          return { vw, dockL: Math.round(dr.left), dockR: Math.round(dr.right), bad, folded, moreVisible };
        })()`);
        t.check(`${k} @${pw}px: no visible dock child overflows viewport`, !dockInfo.missing && dockInfo.bad.length === 0 && dockInfo.dockL >= 0 && dockInfo.dockR <= dockInfo.vw + 0.5, JSON.stringify(dockInfo));
        if (dockInfo.folded && dockInfo.folded.length > 0) {
          t.check(`${k} @${pw}px: #btn-dock-more is visible when controls are folded`, dockInfo.moreVisible, JSON.stringify(dockInfo));
        }
      }

      // Exercise the More menu at 320px when items are folded (Gantt, etc.)
      await t.send('Emulation.setDeviceMetricsOverride', { width: 320, height: H, deviceScaleFactor: 2, mobile: true });
      await sleep(220);
      const foldedCount = await t.ev(`document.querySelectorAll('.toolbar-center > [data-dock-folded="true"]').length`);
      if (k === 'gantt') {
        t.check(`${k} @320px: secondary controls fold into More`, foldedCount > 0, String(foldedCount));
      }
      if (foldedCount > 0) {
        const morePos = await t.ev(`(() => { const r = document.getElementById('btn-dock-more').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        await tap(morePos.x, morePos.y);
        await sleep(220);
        const menuState = await t.ev(`(() => {
          const btn = document.getElementById('btn-dock-more');
          const menu = document.getElementById('dock-more-menu');
          const items = [...menu.querySelectorAll('[role^="menuitem"]')];
          const minH = items.reduce((m, el) => Math.min(m, el.getBoundingClientRect().height), Infinity);
          const mr = menu.getBoundingClientRect();
          return {
            expanded: btn.getAttribute('aria-expanded'),
            hidden: menu.hidden,
            role: menu.getAttribute('role'),
            count: items.length,
            minH: Math.round(minH),
            inView: mr.left >= 0 && mr.right <= window.innerWidth + 0.5,
            checkboxes: items.filter((el) => el.getAttribute('role') === 'menuitemcheckbox').map((el) => ({ forId: el.dataset.dockFor, checked: el.getAttribute('aria-checked') })),
          };
        })()`);
        t.check(`${k} @320px: opening #btn-dock-more shows folded items (>=24px height, on screen)`, menuState.expanded === 'true' && !menuState.hidden && menuState.role === 'menu' && menuState.count > 0 && menuState.minH >= 24 && menuState.inView, JSON.stringify(menuState));

        if (menuState.checkboxes.length > 0) {
          const cb = menuState.checkboxes[0];
          const cbPos = await t.ev(`(() => { const el = document.querySelector('#dock-more-menu [data-dock-for="' + ${JSON.stringify(cb.forId)} + '"]'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
          await tap(cbPos.x, cbPos.y);
          await sleep(180);
          const afterToggle = await t.ev(`(() => {
            const item = document.querySelector('#dock-more-menu [data-dock-for="' + ${JSON.stringify(cb.forId)} + '"]');
            const orig = document.getElementById(${JSON.stringify(cb.forId)});
            return {
              itemChecked: item ? item.getAttribute('aria-checked') : null,
              origChecked: orig ? (orig.getAttribute('aria-checked') ?? orig.getAttribute('aria-pressed')) : null,
            };
          })()`);
          const expected = cb.checked === 'true' ? 'false' : 'true';
          t.check(`${k} @320px: activating folded toggle (${cb.forId}) updates both menu item and original aria-checked`, afterToggle.itemChecked === expected && afterToggle.origChecked === expected, JSON.stringify({ before: cb.checked, afterToggle }));
        }

        // Escape closes and returns focus to #btn-dock-more
        await t.ev(`document.getElementById('dock-more-menu').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
        await sleep(150);
        const afterEsc = await t.ev(`({ hidden: document.getElementById('dock-more-menu').hidden, expanded: document.getElementById('btn-dock-more').getAttribute('aria-expanded'), focused: document.activeElement && document.activeElement.id })`);
        t.check(`${k} @320px: Escape closes More menu and returns focus to #btn-dock-more`, afterEsc.hidden && afterEsc.expanded === 'false' && afterEsc.focused === 'btn-dock-more', JSON.stringify(afterEsc));

        // Unfold when resized back to desktop width
        await t.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
        await sleep(220);
        const wideState = await t.ev(`({ folded: document.querySelectorAll('.toolbar-center > [data-dock-folded="true"]').length, moreHidden: document.getElementById('btn-dock-more').closest('.dock-more-wrap').hidden })`);
        t.check(`${k} @1400px: controls unfold and #btn-dock-more hides when space returns`, wideState.folded === 0 && wideState.moreHidden, JSON.stringify(wideState));
      }
      t.check(`${k}: no page errors after dock overflow checks`, t.errors.length === 0, t.errors.join(' | '));
    });
  }
  code = t.finish();
} catch (err) {
  console.error('[ERROR]', err.message);
  code = 1;
} finally {
  await t.close();
}
process.exit(code);
