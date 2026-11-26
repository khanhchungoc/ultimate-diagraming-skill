// Interaction test for the Gantt roadmap diagram plugin:
//   1. Initial render (#gantt-root, sidebar tree, bars, milestones, markers, deps + .violated, today line/pill, time states)
//   2. Zoom presets (Month -> Week -> Day -> Week -> Month -> Quarter -> Year, data-zoom, weekend shading)
//   3. Collapse & expand unlimited subtasks (plat -> hides api, auth, audit, ui, qa, beta; re-expand restores)
//   4. Drag bar & live parent rollup + Ctrl+Z undo
//   5. Multi-select (Ctrl+click) & group timeline move + single Ctrl+Z undo
//   6. Add items (Task, Row Milestone, Vertical Marker) & Notes toggle / add / edit
//   7. Holidays popover (2 embedded holidays + add custom holiday)
//   8. Jump to Today scrolls Today line into view
//   9. Dark theme toggle & ?present mode (hides editing UI, keeps zoom & collapse working)
//  10. Save codec parity (Ctrl+S -> #diagram-data matches Python gantt_to_disk)
//
// Usage:
//   node dev/tests/e2e/e2e_gantt.mjs [--browser <chrome>] [--page <page.html>] [--noanim]
// Without --page, lays out dev/examples/example-gantt.mmd into a temp directory.
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argOf, findBrowser, isNoAnim, launch, sleep } from './cdp.mjs';

const browser = findBrowser(argOf('browser'));
if (!browser) {
  console.error('[ERROR] Chrome/Chromium not found. Pass --browser <path> or set CHROME.');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const noAnim = isNoAnim();
const todayParam = '2026-05-20';
const defaultQuery = `?today=${todayParam}${noAnim ? '&noanim=1' : ''}`;
const baseQuery = `?today=${todayParam}&view=all${noAnim ? '&noanim=1' : ''}`;
const presentQuery = `?present&today=${todayParam}${noAnim ? '&noanim=1' : ''}`;
const WEEK_PX_PER_DAY = 18;

let work = null;
let pagePath = argOf('page');
if (pagePath) {
  pagePath = resolve(pagePath);
} else {
  work = mkdtempSync(join(tmpdir(), 'e2e_gantt_'));
  pagePath = join(work, 'gantt.html');
  const build = spawnSync(
    'python3',
    [
      join(root, 'scripts', 'layout_engine.py'),
      '--layout', join(root, 'dev', 'examples', 'example-gantt.mmd'),
      '-o', pagePath,
      '--no-holidays',
      '--no-save-helper',
    ],
    { encoding: 'utf8' }
  );
  if (build.status !== 0) {
    console.error('[ERROR] layout_engine.py failed:', build.stdout, build.stderr);
    rmSync(work, { recursive: true, force: true });
    process.exit(1);
  }
}

const cdp = await launch(browser);

function checkNoErrors(sectionName) {
  cdp.check(
    `${sectionName}: zero console/page errors`,
    cdp.errors.length === 0,
    cdp.errors.join(' | ')
  );
}

function diffDays(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

async function readDiagramData() {
  return cdp.ev(`JSON.parse(document.getElementById('diagram-data').textContent)`);
}

function itemOf(doc, id) {
  const it = (doc.items || []).find((x) => x && x.id === id);
  return it ? { start: it.start || null, end: it.end || null } : null;
}

async function getBarGeom(itemId) {
  return cdp.ev(`(() => {
    const el = document.querySelector('.gantt-bar[data-item-id=' + ${JSON.stringify(itemId)} + ']');
    if (!el) return null;
    return {
      left: parseFloat(el.style.left) || 0,
      width: parseFloat(el.style.width) || 0,
      right: (parseFloat(el.style.left) || 0) + (parseFloat(el.style.width) || 0),
      tip: el.dataset.tip || '',
    };
  })()`);
}

async function scrollBarIntoView(itemId) {
  await cdp.ev(`(() => {
    const el = document.querySelector('.gantt-bar[data-item-id=' + ${JSON.stringify(itemId)} + '], .gantt-milestone[data-item-id=' + ${JSON.stringify(itemId)} + ']');
    if (el) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  })()`);
  await sleep(noAnim ? 16 : 40);
}

async function selectZoom(preset) {
  const host = await cdp.at('#gantt-zoom-pills');
  if (!host) throw new Error('selectZoom: #gantt-zoom-pills not found');
  await cdp.mouse('mouseMoved', host.x, host.y);
  await sleep(noAnim ? 30 : 220);
  await cdp.clickOn(`#gantt-zoom-pills [data-zoom-set="${preset}"]`);
  await cdp.settle();
}

let exitCode = 0;
try {
  // ---------------------------------------------------------------------------
  // 1. Initial render
  // ---------------------------------------------------------------------------
  await cdp.section('initial-render', async () => {
    await cdp.open(pagePath, baseQuery);

    const state = await cdp.ev(`(() => {
      const rootEl = document.getElementById('gantt-root');
      const rows = [...document.querySelectorAll('#gantt-tree .gantt-tree-row')];
      const bars = [...document.querySelectorAll('#gantt-bars .gantt-bar')];
      const milestones = [...document.querySelectorAll('#gantt-bars .gantt-milestone')];
      const markers = [...document.querySelectorAll('#gantt-markers .gantt-marker-line')];
      const markerFlags = [...document.querySelectorAll('#gantt-header-markers .gantt-marker-flag')];
      const depGroups = [...document.querySelectorAll('#gantt-deps .gantt-dep-group')];
      const depPaths = [...document.querySelectorAll('#gantt-deps .gantt-dep-path')];
      const violatedDeps = [...document.querySelectorAll('#gantt-deps .gantt-dep-path.violated')];
      const todayLine = document.querySelector('#gantt-today .gantt-today-line');
      const todayPill = document.querySelector('#gantt-header-markers .gantt-today-pill');
      const past = document.querySelectorAll('#gantt-bars [data-time-state="past"]').length;
      const active = document.querySelectorAll('#gantt-bars [data-time-state="active"]').length;
      const upcoming = document.querySelectorAll('#gantt-bars [data-time-state="upcoming"]').length;
      return {
        hasRoot: !!rootEl && rootEl.getBoundingClientRect().width > 0,
        rowCount: rows.length,
        barCount: bars.length,
        milestoneCount: milestones.length,
        markerCount: markers.length,
        markerFlagCount: markerFlags.length,
        depGroupCount: depGroups.length,
        depPathCount: depPaths.length,
        violatedCount: violatedDeps.length,
        todayAttr: todayLine ? todayLine.dataset.today : null,
        todayPillText: todayPill ? todayPill.textContent.trim() : null,
        past,
        active,
        upcoming,
      };
    })()`);

    cdp.check('initial: #gantt-root rendered', state.hasRoot);
    cdp.check('initial: sidebar #gantt-tree has rows', state.rowCount >= 15, `rows=${state.rowCount}`);
    cdp.check('initial: #gantt-bars has task/summary bars', state.barCount >= 12, `bars=${state.barCount}`);
    cdp.check('initial: #gantt-bars has row milestones', state.milestoneCount >= 3, `milestones=${state.milestoneCount}`);
    cdp.check('initial: #gantt-markers has vertical marker line & flag', state.markerCount >= 1 && state.markerFlagCount >= 1, `lines=${state.markerCount} flags=${state.markerFlagCount}`);
    cdp.check('initial: #gantt-deps has SVG dependency paths', state.depGroupCount >= 1 && state.depPathCount >= 1, `groups=${state.depGroupCount}`);
    cdp.check('initial: overlapping FS dependency has .violated class', state.violatedCount >= 1, `violated=${state.violatedCount}`);
    cdp.check('initial: #gantt-today vertical line & Today pill rendered', state.todayAttr === todayParam && state.todayPillText.startsWith('Today') && state.todayPillText.includes('May 20'), `today=${state.todayAttr} pill=${state.todayPillText}`);
    cdp.check('initial: past/active/upcoming time states all present', state.past > 0 && state.active > 0 && state.upcoming > 0, `past=${state.past} active=${state.active} upcoming=${state.upcoming}`);
    checkNoErrors('initial-render');
  });

  // ---------------------------------------------------------------------------
  // 2. Zoom presets
  // ---------------------------------------------------------------------------
  await cdp.section('zoom-presets', async () => {
    await cdp.open(pagePath, baseQuery);

    const inZoomDock = await cdp.ev(`!!document.querySelector('.toolbar-zoom #gantt-zoom-pills')`);
    cdp.check('zoom: #gantt-zoom-pills mounted inside .toolbar-zoom', inZoomDock);

    const readZoom = () => cdp.ev(`(() => {
      const activePill = document.querySelector('#gantt-zoom-pills .gantt-zoom-pill.is-active');
      return {
        activeKey: activePill ? activePill.dataset.zoomSet : '',
        label: activePill ? activePill.textContent.trim() : '',
        dataZoom: document.getElementById('gantt-root')?.getAttribute('data-zoom') || '',
        weekends: document.querySelectorAll('#gantt-grid .gantt-weekend').length
      };
    })()`);

    const steps = [
      { select: false, label: 'Month', key: 'month', weekends: false },
      { select: true, label: 'Week', key: 'week', weekends: true },
      { select: true, label: 'Day', key: 'day', weekends: true },
      { select: true, label: 'Week', key: 'week', weekends: true },
      { select: true, label: 'Month', key: 'month', weekends: false },
      { select: true, label: 'Quarter', key: 'quarter', weekends: false },
      { select: true, label: 'Year', key: 'year', weekends: false },
    ];

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.select) {
        await selectZoom(s.key);
      }
      const z = await readZoom();
      cdp.check(`zoom[${i}] ${s.label}: active pill .is-active matches`, z.activeKey === s.key && z.label === s.label, `got=${z.activeKey}/${z.label}`);
      cdp.check(`zoom[${i}] ${s.label}: #gantt-root[data-zoom]="${s.key}"`, z.dataZoom === s.key, `got=${z.dataZoom}`);
      cdp.check(
        `zoom[${i}] ${s.label}: weekend shading ${s.weekends ? 'shown' : 'hidden'}`,
        s.weekends ? z.weekends > 0 : z.weekends === 0,
        `weekends=${z.weekends}`
      );
    }
    checkNoErrors('zoom-presets');
  });

  // ---------------------------------------------------------------------------
  // 3. Collapse & expand unlimited subtasks
  // ---------------------------------------------------------------------------
  await cdp.section('collapse-expand', async () => {
    await cdp.open(pagePath, baseQuery);

    const childrenIds = ['api', 'auth', 'audit', 'cache', 'ui', 'mobile', 'qa', 'beta'];
    const snapshot = () => cdp.ev(`(() => {
      const rows = [...document.querySelectorAll('#gantt-tree .gantt-tree-row')].map(r => r.dataset.itemId);
      const bars = [...document.querySelectorAll('#gantt-bars [data-item-id]')].map(b => b.dataset.itemId);
      const chev = document.querySelector('.gantt-tree-row[data-item-id="plat"] .chevron');
      return {
        rowCount: rows.length,
        rows,
        bars,
        expanded: chev ? chev.getAttribute('aria-expanded') : null,
      };
    })()`);

    const before = await snapshot();
    cdp.check('collapse: plat initially expanded', before.expanded === 'true', `expanded=${before.expanded}`);
    cdp.check(
      'collapse: plat descendants initially visible',
      childrenIds.every((id) => before.rows.includes(id) && before.bars.includes(id)),
      `rows=${before.rows.join(',')}`
    );

    await cdp.clickOn('.gantt-tree-row[data-item-id="plat"] .chevron');
    await cdp.settle();
    const collapsed = await snapshot();
    cdp.check('collapse: plat aria-expanded becomes false', collapsed.expanded === 'false', `expanded=${collapsed.expanded}`);
    cdp.check(
      'collapse: descendants hidden from tree & timeline',
      childrenIds.every((id) => !collapsed.rows.includes(id) && !collapsed.bars.includes(id)),
      `remaining=${collapsed.rows.join(',')}`
    );
    cdp.check(
      'collapse: visible row count reduced',
      collapsed.rowCount === before.rowCount - childrenIds.length,
      `before=${before.rowCount} after=${collapsed.rowCount}`
    );

    await cdp.clickOn('.gantt-tree-row[data-item-id="plat"] .chevron');
    await cdp.settle();
    const expanded = await snapshot();
    cdp.check('collapse: re-expanding sets aria-expanded="true"', expanded.expanded === 'true', `expanded=${expanded.expanded}`);
    cdp.check(
      'collapse: re-expanding restores row count & all descendants',
      expanded.rowCount === before.rowCount && childrenIds.every((id) => expanded.rows.includes(id) && expanded.bars.includes(id)),
      `before=${before.rowCount} restored=${expanded.rowCount}`
    );
    checkNoErrors('collapse-expand');
  });

  // ---------------------------------------------------------------------------
  // 4. Drag bar & live parent rollup + Ctrl+Z undo
  // ---------------------------------------------------------------------------
  await cdp.section('drag-rollup-undo', async () => {
    await cdp.open(pagePath, baseQuery);

    // Switch to Week zoom for higher pxPerDay precision (18 px/day, snapDays=1)
    await selectZoom('week');
    await scrollBarIntoView('audit');

    const beforeDoc = await readDiagramData();
    const beforeAudit = itemOf(beforeDoc, 'audit');
    const beforeApiGeom = await getBarGeom('api');

    const p = await cdp.at('.gantt-bar[data-item-id="audit"]');
    const shiftPx = Math.round(14 * WEEK_PX_PER_DAY);
    await cdp.dragTo(p.x, p.y, p.x + shiftPx, p.y, { steps: 8 });
    await cdp.settle();

    const afterApiGeom = await getBarGeom('api');
    const afterDoc = await cdp.saved();
    const afterAudit = itemOf(afterDoc, 'audit');
    const startDelta = diffDays(beforeAudit.start, afterAudit.start);
    const endDelta = diffDays(beforeAudit.end, afterAudit.end);

    cdp.check(
      'drag: leaf task audit start & end shifted forward equally',
      startDelta > 0 && startDelta === endDelta,
      `before=${beforeAudit.start}..${beforeAudit.end} after=${afterAudit.start}..${afterAudit.end} d=${startDelta}/${endDelta}`
    );
    cdp.check(
      'drag: parent api rolled-up bar extended to cover audit',
      afterApiGeom.right > beforeApiGeom.right && afterApiGeom.width > beforeApiGeom.width,
      `api right ${beforeApiGeom.right}->${afterApiGeom.right} tip=${afterApiGeom.tip}`
    );

    // Undo with Ctrl+Z
    await cdp.press('z', { modifiers: 2 });
    await cdp.settle();
    const undoneApiGeom = await getBarGeom('api');
    const undoneDoc = await cdp.saved();
    const undoneAudit = itemOf(undoneDoc, 'audit');

    cdp.check(
      'drag: Ctrl+Z reverts leaf task audit dates',
      undoneAudit.start === beforeAudit.start && undoneAudit.end === beforeAudit.end,
      `got=${undoneAudit.start}..${undoneAudit.end} want=${beforeAudit.start}..${beforeAudit.end}`
    );
    cdp.check(
      'drag: Ctrl+Z reverts parent api rolled-up span',
      Math.abs(undoneApiGeom.right - beforeApiGeom.right) < 1 && Math.abs(undoneApiGeom.width - beforeApiGeom.width) < 1,
      `got=${undoneApiGeom.right} want=${beforeApiGeom.right}`
    );
    checkNoErrors('drag-rollup-undo');
  });

  // ---------------------------------------------------------------------------
  // 5. Multi-select & group timeline move + single Ctrl+Z undo
  // ---------------------------------------------------------------------------
  await cdp.section('multi-select-move', async () => {
    await cdp.open(pagePath, baseQuery);

    // Switch to Week zoom for crisp 1-day snap
    await selectZoom('week');
    await scrollBarIntoView('ux');

    const beforeDoc = await readDiagramData();
    const beforeUx = itemOf(beforeDoc, 'ux');
    const beforeSpec = itemOf(beforeDoc, 'spec');

    await cdp.clickOn('.gantt-bar[data-item-id="ux"]');
    await cdp.clickOn('.gantt-bar[data-item-id="spec"]', { modifiers: 2 }); // Ctrl+click

    const selState = await cdp.ev(`({
      ux: document.querySelector('.gantt-bar[data-item-id="ux"]')?.classList.contains('selected') || false,
      spec: document.querySelector('.gantt-bar[data-item-id="spec"]')?.classList.contains('selected') || false,
      count: document.querySelectorAll('#gantt-bars .selected').length
    })`);
    cdp.check(
      'multi-select: Ctrl+clicking two leaf tasks selects both',
      selState.ux && selState.spec && selState.count === 2,
      JSON.stringify(selState)
    );

    const pUx = await cdp.at('.gantt-bar[data-item-id="ux"]');
    const shiftPx = Math.round(10 * WEEK_PX_PER_DAY);
    await cdp.dragTo(pUx.x, pUx.y, pUx.x + shiftPx, pUx.y, { steps: 8 });
    await cdp.settle();

    const afterDoc = await cdp.saved();
    const afterUx = itemOf(afterDoc, 'ux');
    const afterSpec = itemOf(afterDoc, 'spec');
    const deltaUx = diffDays(beforeUx.start, afterUx.start);
    const deltaSpec = diffDays(beforeSpec.start, afterSpec.start);
    const deltaUxEnd = diffDays(beforeUx.end, afterUx.end);
    const deltaSpecEnd = diffDays(beforeSpec.end, afterSpec.end);

    cdp.check(
      'multi-select: dragging one shifts both tasks by exact same day delta',
      deltaUx > 0 && deltaUx === deltaSpec && deltaUx === deltaUxEnd && deltaSpec === deltaSpecEnd,
      `ux=${deltaUx}/${deltaUxEnd} spec=${deltaSpec}/${deltaSpecEnd}`
    );

    // Single Ctrl+Z must revert both together
    await cdp.press('z', { modifiers: 2 });
    await cdp.settle();

    const undoneDoc = await cdp.saved();
    const undoneUx = itemOf(undoneDoc, 'ux');
    const undoneSpec = itemOf(undoneDoc, 'spec');
    cdp.check(
      'multi-select: single Ctrl+Z reverts both tasks together',
      undoneUx.start === beforeUx.start && undoneUx.end === beforeUx.end &&
      undoneSpec.start === beforeSpec.start && undoneSpec.end === beforeSpec.end,
      `ux=${undoneUx.start}..${undoneUx.end} spec=${undoneSpec.start}..${undoneSpec.end}`
    );
    checkNoErrors('multi-select-move');
  });

  // ---------------------------------------------------------------------------
  // 6. Add items & notes
  // ---------------------------------------------------------------------------
  await cdp.section('add-items-and-notes', async () => {
    await cdp.open(pagePath, baseQuery);

    const counts = () => cdp.ev(`({
      rows: document.querySelectorAll('#gantt-tree .gantt-tree-row').length,
      bars: document.querySelectorAll('#gantt-bars .gantt-bar').length,
      milestones: document.querySelectorAll('#gantt-bars .gantt-milestone').length,
      markers: document.querySelectorAll('#gantt-markers .gantt-marker-line').length,
      notesBtnChecked: document.getElementById('btn-notes')?.getAttribute('aria-checked'),
      visibleNotes: document.querySelectorAll('#gantt-notes .note').length,
    })`);

    const c0 = await counts();

    // Add Task via #btn-add -> #btn-add-task
    await cdp.clickOn('#btn-add');
    await cdp.clickOn('#btn-add-task');
    await cdp.press('Enter'); // commit default inline rename
    await cdp.settle();
    const c1 = await counts();
    cdp.check('add: Task added via #btn-add -> #btn-add-task', c1.rows === c0.rows + 1 && c1.bars === c0.bars + 1, `bars ${c0.bars}->${c1.bars}`);

    // Clear selection so milestone adds cleanly
    await cdp.press('Escape');

    // Add Row Milestone via #btn-add -> #btn-add-milestone
    await cdp.clickOn('#btn-add');
    await cdp.clickOn('#btn-add-milestone');
    await cdp.press('Enter');
    await cdp.settle();
    const c2 = await counts();
    cdp.check('add: Row Milestone added via #btn-add -> #btn-add-milestone', c2.milestones === c1.milestones + 1, `milestones ${c1.milestones}->${c2.milestones}`);

    // Add Vertical Marker via #btn-add -> #btn-add-marker
    await cdp.clickOn('#btn-add');
    await cdp.clickOn('#btn-add-marker');
    await cdp.settle();
    const c3 = await counts();
    cdp.check('add: Vertical Marker added via #btn-add -> #btn-add-marker', c3.markers === c2.markers + 1, `markers ${c2.markers}->${c3.markers}`);

    // Toggle Notes visibility via #btn-notes
    cdp.check('notes: #btn-notes initially aria-checked="false"', c3.notesBtnChecked === 'false', `got=${c3.notesBtnChecked}`);
    await cdp.clickOn('#btn-notes');
    await cdp.settle();
    const cNotesOn = await counts();
    cdp.check(
      'notes: clicking #btn-notes sets aria-checked="true" and shows note cards',
      cNotesOn.notesBtnChecked === 'true' && cNotesOn.visibleNotes >= 5,
      `checked=${cNotesOn.notesBtnChecked} notes=${cNotesOn.visibleNotes}`
    );

    // Toggle Notes back off, then add & edit a note on `ux` (which has no note initially)
    await cdp.clickOn('#btn-notes');
    await cdp.settle();

    await scrollBarIntoView('ux');
    await cdp.clickOn('.gantt-bar[data-item-id="ux"]');
    await cdp.clickOn('#btn-add');
    await cdp.clickOn('#btn-add-note');
    await cdp.type('E2E initial note');
    // Click outside (header) to commit the note
    await cdp.clickOn('#gantt-header-top');
    await cdp.settle();

    const docAfterAdd = await cdp.saved();
    const addedNote = (docAfterAdd.notes || []).find((n) => n && n.target === 'ux')?.text || '';
    cdp.check('notes: adding a note on selected task persists text', addedNote === 'E2E initial note', `got=${JSON.stringify(addedNote)}`);

    // Show notes, double-click the ux note card to edit it, commit
    await cdp.clickOn('#btn-notes');
    await cdp.settle();
    const uxNoteSel = await cdp.ev(`(() => {
      const cards = [...document.querySelectorAll('#gantt-notes .note')];
      const idx = cards.findIndex(c => (c.querySelector('.note-text')?.textContent || '').trim() === 'E2E initial note');
      return idx >= 0 ? '#gantt-notes .note:nth-child(' + (idx + 1) + ')' : null;
    })()`);
    cdp.check('notes: newly added note card is visible when Notes toggled on', !!uxNoteSel);

    if (uxNoteSel) {
      await cdp.ev(`document.querySelector(${JSON.stringify(uxNoteSel)})?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })`);
      await sleep(noAnim ? 16 : 40);
      await cdp.clickOn(uxNoteSel, { count: 2 });
      await cdp.type(' - edited');
      await cdp.clickOn('#gantt-header-top');
      await cdp.settle();
      const docAfterEdit = await cdp.saved();
      const editedNote = (docAfterEdit.notes || []).find((n) => n && n.target === 'ux')?.text || '';
      cdp.check('notes: editing note updates text', editedNote.includes('E2E initial note') && editedNote.includes('edited'), `got=${JSON.stringify(editedNote)}`);
    }
    checkNoErrors('add-items-and-notes');
  });

  // ---------------------------------------------------------------------------
  // 7. Holidays popover
  // ---------------------------------------------------------------------------
  await cdp.section('holidays-popover', async () => {
    await cdp.open(pagePath, baseQuery);

    const beforeBands = await cdp.ev(`document.querySelectorAll('#gantt-grid .gantt-holiday').length`);
    await cdp.clickOn('#btn-holidays');
    await cdp.settle();

    const opened = await cdp.ev(`({
      hidden: document.getElementById('gantt-holidays-pop')?.hidden,
      expanded: document.getElementById('btn-holidays')?.getAttribute('aria-expanded'),
      rows: [...document.querySelectorAll('#gantt-holidays-list .gantt-hol-row')].map(r => r.textContent.trim()),
    })`);
    cdp.check('holidays: popover opens on #btn-holidays click', opened.hidden === false && opened.expanded === 'true', JSON.stringify(opened));
    cdp.check('holidays: shows 3 embedded holidays', opened.rows.length === 3, `rows=${opened.rows.length}`);

    // Fill date & name and click Add
    await cdp.ev(`(() => {
      const d = document.getElementById('gantt-hol-date');
      const n = document.getElementById('gantt-hol-name');
      d.value = '2026-06-19';
      d.dispatchEvent(new Event('input', { bubbles: true }));
      n.value = 'Juneteenth';
      n.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await cdp.clickOn('#gantt-hol-add');
    await cdp.settle();

    const after = await cdp.ev(`({
      rows: [...document.querySelectorAll('#gantt-holidays-list .gantt-hol-row')].map(r => r.textContent.trim()),
      bands: document.querySelectorAll('#gantt-grid .gantt-holiday').length,
    })`);
    cdp.check(
      'holidays: adding custom holiday adds it to list',
      after.rows.length === 4 && after.rows.some((r) => r.includes('Juneteenth')),
      `rows=${after.rows.join(' | ')}`
    );
    cdp.check(
      'holidays: custom holiday renders band on timeline',
      after.bands === beforeBands + 1,
      `bands ${beforeBands}->${after.bands}`
    );

    await cdp.clickOn('#gantt-hol-close');
    await cdp.settle();
    const closed = await cdp.ev(`document.getElementById('gantt-holidays-pop')?.hidden === true`);
    cdp.check('holidays: close button hides popover', closed);
    checkNoErrors('holidays-popover');
  });

  // ---------------------------------------------------------------------------
  // 8. Jump to Today
  // ---------------------------------------------------------------------------
  await cdp.section('jump-to-today', async () => {
    await cdp.open(pagePath, baseQuery);

    // Zoom in to Day so timeline is wide and horizontally scrollable
    await selectZoom('day');

    // Snap far left so Today (2026-05-20) is offscreen to the right
    await cdp.ev(`(() => {
      const tl = document.getElementById('gantt-timeline');
      const prev = tl.style.scrollBehavior;
      tl.style.scrollBehavior = 'auto';
      tl.scrollLeft = 0;
      tl.style.scrollBehavior = prev;
    })()`);
    await sleep(noAnim ? 16 : 60);

    const beforeState = await cdp.ev(`(() => {
      const tl = document.getElementById('gantt-timeline');
      const line = document.querySelector('#gantt-today .gantt-today-line');
      const tr = tl.getBoundingClientRect();
      const lr = line.getBoundingClientRect();
      return { scrollLeft: tl.scrollLeft, inView: lr.left >= tr.left && lr.right <= tr.right };
    })()`);
    await cdp.clickOn('#btn-today');
    // Wait for smooth scroll (if animated) to bring Today line into view
    const inView = await cdp.waitFor(`(() => {
      const tl = document.getElementById('gantt-timeline');
      const line = document.querySelector('#gantt-today .gantt-today-line');
      if (!tl || !line) return false;
      const tr = tl.getBoundingClientRect();
      const lr = line.getBoundingClientRect();
      return lr.left >= tr.left && lr.right <= tr.right && tl.scrollLeft > ${beforeState.scrollLeft};
    })()`, { timeout: 2500 });

    const afterScroll = await cdp.ev(`document.getElementById('gantt-timeline').scrollLeft`);
    cdp.check(
      'today: clicking #btn-today scrolls timeline so Today line is in view',
      !!inView && !beforeState.inView && afterScroll > beforeState.scrollLeft,
      `beforeScroll=${beforeState.scrollLeft} beforeInView=${beforeState.inView} afterScroll=${afterScroll} inView=${inView}`
    );
    checkNoErrors('jump-to-today');
  });

  // ---------------------------------------------------------------------------
  // 9. Dark theme & ?present mode
  // ---------------------------------------------------------------------------
  await cdp.section('theme-and-present', async () => {
    await cdp.open(pagePath, baseQuery);

    await cdp.clickOn('#btn-theme');
    await cdp.settle();
    const theme = await cdp.ev(`document.documentElement.getAttribute('data-theme')`);
    cdp.check('theme: toggling #btn-theme switches [data-theme="dark"]', theme === 'dark', `got=${theme}`);
    checkNoErrors('theme-dark');

    // Open in ?present mode
    await cdp.open(pagePath, presentQuery);
    const pres = await cdp.ev(`(() => {
      const visible = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      };
      return {
        isPresent: document.body.classList.contains('presentation'),
        addVisible: visible('#btn-add'),
        addInlineVisible: visible('#btn-add-inline'),
        resizeHandles: document.querySelectorAll('.gantt-resize').length,
        ports: document.querySelectorAll('.port').length,
        zoomBefore: document.getElementById('gantt-root')?.getAttribute('data-zoom') || '',
        rowsBefore: document.querySelectorAll('#gantt-tree .gantt-tree-row').length,
      };
    })()`);

    cdp.check('present: body has .presentation class', pres.isPresent);
    cdp.check(
      'present: editing UI hidden (#btn-add, #btn-add-inline, resize handles, ports)',
      !pres.addVisible && !pres.addInlineVisible && pres.resizeHandles === 0 && pres.ports === 0,
      JSON.stringify(pres)
    );

    // Zoom still works in ?present mode
    await selectZoom('week');
    const zoomAfter = await cdp.ev(`document.getElementById('gantt-root')?.getAttribute('data-zoom') || ''`);
    cdp.check('present: zoom works (#gantt-zoom-pills changes month -> week)', pres.zoomBefore === 'month' && zoomAfter === 'week', `${pres.zoomBefore}->${zoomAfter}`);

    // Collapse & expand still works in ?present mode
    await cdp.clickOn('.gantt-tree-row[data-item-id="plat"] .chevron');
    await cdp.settle();
    const rowsCollapsed = await cdp.ev(`document.querySelectorAll('#gantt-tree .gantt-tree-row').length`);
    await cdp.clickOn('.gantt-tree-row[data-item-id="plat"] .chevron');
    await cdp.settle();
    const rowsRestored = await cdp.ev(`document.querySelectorAll('#gantt-tree .gantt-tree-row').length`);
    cdp.check(
      'present: collapse & expand still works',
      rowsCollapsed < pres.rowsBefore && rowsRestored === pres.rowsBefore,
      `before=${pres.rowsBefore} collapsed=${rowsCollapsed} restored=${rowsRestored}`
    );
    checkNoErrors('theme-and-present');
  });

  // ---------------------------------------------------------------------------
  // 10. Save codec parity (JS toDisk vs Python gantt_to_disk)
  // ---------------------------------------------------------------------------
  await cdp.section('save-codec-parity', async () => {
    await cdp.open(pagePath, baseQuery);

    // Add a task so there is a generated t_... ID to verify slug renaming on save
    await cdp.clickOn('#btn-add');
    await cdp.clickOn('#btn-add-task');
    await cdp.press('Enter');
    await cdp.settle();

    // Trigger Ctrl+S and capture #diagram-data
    const jsSaved = await cdp.saved();

    cdp.check('save: #diagram-data is valid JSON with diagramType="gantt"', !!jsSaved && jsSaved.diagramType === 'gantt' && jsSaved.schemaVersion === 1);

    // Check no _-prefixed keys anywhere (except optional top-level _readme)
    const underscoreKeys = [];
    for (const k of Object.keys(jsSaved || {})) {
      if (k.startsWith('_') && k !== '_readme') underscoreKeys.push(`top.${k}`);
    }
    for (const listKey of ['items', 'dependencies', 'markers', 'holidays', 'notes']) {
      for (const obj of (jsSaved && jsSaved[listKey]) || []) {
        if (obj && typeof obj === 'object') {
          for (const k of Object.keys(obj)) {
            if (k.startsWith('_')) underscoreKeys.push(`${listKey}.${k}`);
          }
        }
      }
    }
    cdp.check('save: no _-prefixed runtime keys leaked to disk', underscoreKeys.length === 0, underscoreKeys.join(', '));

    const hasGeneratedId = (jsSaved.items || []).some((it) => /^t_\d{12,}/.test(String(it.id || '')));
    const hasNewTaskSlug = (jsSaved.items || []).some((it) => it.id === 'new_task');
    cdp.check('save: generated task IDs renamed to clean slugs', !hasGeneratedId && hasNewTaskSlug, `hasGen=${hasGeneratedId} hasSlug=${hasNewTaskSlug}`);

    // Verify Python gantt_to_disk produces identical output & key ordering on the saved JSON
    const pyRes = spawnSync(
      'python3',
      [
        '-c',
        'import json, sys; sys.path.insert(0, sys.argv[1]); from disk_format import gantt_to_disk; data = json.loads(sys.stdin.read()); print(json.dumps(gantt_to_disk(data), ensure_ascii=False))',
        join(root, 'scripts'),
      ],
      { input: JSON.stringify(jsSaved), encoding: 'utf8' }
    );
    cdp.check('save: Python gantt_to_disk validates & accepts saved JSON', pyRes.status === 0, pyRes.stderr);
    if (pyRes.status === 0) {
      const pySaved = JSON.parse(pyRes.stdout);
      const stripReadme = (o) => {
        const c = { ...o };
        delete c._readme;
        return c;
      };
      const a = JSON.stringify(stripReadme(jsSaved));
      const b = JSON.stringify(stripReadme(pySaved));
      cdp.check('save: JS toDisk matches Python gantt_to_disk identically', a === b, a === b ? '' : `len js=${a.length} py=${b.length}`);
    }
    checkNoErrors('save-codec-parity');
  });

  // ---------------------------------------------------------------------------
  // 11. Search & synchronized row hover
  // ---------------------------------------------------------------------------
  await cdp.section('search-and-synced-hover', async () => {
    await cdp.open(pagePath, baseQuery);

    // Search: open #btn-search, type "Auth", verify #search-count & .search-current, press Escape to close
    await cdp.clickOn('#btn-search');
    await cdp.type('Auth');
    await cdp.settle();

    const searchState = await cdp.ev(`({
      barVisible: document.getElementById('search-bar')?.hidden === false,
      count: (document.getElementById('search-count')?.textContent || '').trim(),
      hasCurrent: !!document.querySelector('#gantt-root .search-current'),
    })`);
    cdp.check(
      'search: typing "Auth" shows match count and highlights .search-current',
      searchState.barVisible && /^\d+\s*\/\s*\d+$/.test(searchState.count) && searchState.hasCurrent,
      JSON.stringify(searchState)
    );

    await cdp.press('Escape');
    await cdp.settle();
    const afterEsc = await cdp.ev(`({
      barHidden: document.getElementById('search-bar')?.hidden === true,
      hasCurrent: !!document.querySelector('#gantt-root .search-current'),
    })`);
    cdp.check('search: Escape closes search bar and clears .search-current', afterEsc.barHidden && !afterEsc.hasCurrent, JSON.stringify(afterEsc));

    // Synced row hover: hovering sidebar row highlights both sidebar row & timeline row-bg
    const sidePos = await cdp.at('.gantt-tree-row[data-item-id="auth"]');
    await cdp.mouse('mouseMoved', sidePos.x, sidePos.y);
    await sleep(noAnim ? 16 : 40);
    const hoverSide = await cdp.ev(`({
      treeHovered: document.querySelector('.gantt-tree-row[data-item-id="auth"]')?.classList.contains('is-hovered') || false,
      bgHovered: document.querySelector('.gantt-row-bg[data-row-id="auth"]')?.classList.contains('is-hovered') || false,
    })`);
    cdp.check(
      'hover: hovering sidebar row syncs .is-hovered to timeline row-bg',
      hoverSide.treeHovered && hoverSide.bgHovered,
      JSON.stringify(hoverSide)
    );

    // Hovering timeline bar syncs .is-hovered to sidebar row and clears previous row
    await scrollBarIntoView('ux');
    const barPos = await cdp.at('.gantt-bar[data-item-id="ux"]');
    await cdp.mouse('mouseMoved', barPos.x, barPos.y);
    await sleep(noAnim ? 16 : 40);
    const hoverBar = await cdp.ev(`({
      uxTree: document.querySelector('.gantt-tree-row[data-item-id="ux"]')?.classList.contains('is-hovered') || false,
      uxBg: document.querySelector('.gantt-row-bg[data-row-id="ux"]')?.classList.contains('is-hovered') || false,
      authCleared: !document.querySelector('.gantt-tree-row[data-item-id="auth"]')?.classList.contains('is-hovered'),
    })`);
    cdp.check(
      'hover: hovering timeline bar syncs .is-hovered to sidebar row',
      hoverBar.uxTree && hoverBar.uxBg && hoverBar.authCleared,
      JSON.stringify(hoverBar)
    );
    checkNoErrors('search-and-synced-hover');
  });

  // ---------------------------------------------------------------------------
  // 12. Big-plan UX (Active & Upcoming default, View dropdown, In View hint &
  //     compaction, off-screen jump pills, sticky phase, legend filter, focus chain)
  // ---------------------------------------------------------------------------
  await cdp.section('big-plan-ux', async () => {
    await cdp.open(pagePath, defaultQuery);
    await sleep(noAnim ? 40 : 120);

    const defState = await cdp.ev(`({
      viewAttr: document.getElementById('gantt-root')?.getAttribute('data-view'),
      viewLabel: (document.getElementById('gantt-view-label')?.textContent || '').trim(),
      pastBars: document.querySelectorAll('#gantt-bars [data-time-state="past"]').length,
      activeBars: document.querySelectorAll('#gantt-bars [data-time-state="active"]').length,
      rowCount: document.querySelectorAll('#gantt-tree .gantt-tree-row').length,
      filterBarHidden: document.getElementById('gantt-filter-bar')?.hidden,
      filterBarText: (document.getElementById('gantt-filter-bar')?.textContent || '').trim(),
      hintHidden: document.getElementById('gantt-inview-hint')?.hidden,
      hintText: (document.getElementById('gantt-inview-hint-text')?.textContent || '').trim(),
    })`);
    cdp.check(
      'big-plan: defaults to Active & Upcoming and hides past tasks',
      defState.viewAttr === 'active' && defState.viewLabel === 'Active & Upcoming' && defState.pastBars === 0 && defState.activeBars > 0 && defState.filterBarHidden === false,
      JSON.stringify(defState)
    );

    // At Week zoom around Today, active tasks at top (Phase 1) and bottom (Phase 5) are separated by other phases -> In View hint appears
    await selectZoom('week');
    await cdp.clickOn('#btn-today');
    await sleep(noAnim ? 40 : 120);
    const weekHintState = await cdp.ev(`({
      rowCount: document.querySelectorAll('#gantt-tree .gantt-tree-row').length,
      hintHidden: document.getElementById('gantt-inview-hint')?.hidden,
      hintText: (document.getElementById('gantt-inview-hint-text')?.textContent || '').trim(),
    })`);
    cdp.check(
      'big-plan: In View hint appears when in-window tasks are off-screen vertically',
      weekHintState.hintHidden === false && /off-screen/.test(weekHintState.hintText),
      JSON.stringify(weekHintState)
    );

    // Clicking "Compact to In View" on the hint switches to In View, compacts rows, and hides hint
    await cdp.clickOn('#btn-inview-hint-apply');
    await cdp.settle();
    const inViewState = await cdp.ev(`({
      viewAttr: document.getElementById('gantt-root')?.getAttribute('data-view'),
      viewLabel: (document.getElementById('gantt-view-label')?.textContent || '').trim(),
      rowCount: document.querySelectorAll('#gantt-tree .gantt-tree-row').length,
      hintHidden: document.getElementById('gantt-inview-hint')?.hidden,
    })`);
    cdp.check(
      'big-plan: Compact to In View switches view, reduces rows, and hides hint',
      inViewState.viewAttr === 'in-view' && inViewState.viewLabel === 'In View' && inViewState.rowCount < weekHintState.rowCount && inViewState.hintHidden === true,
      `before=${weekHintState.rowCount} after=${inViewState.rowCount} ${JSON.stringify(inViewState)}`
    );

    // Switch via toolbar View dropdown to All Tasks
    await cdp.clickOn('#btn-view-filter');
    await sleep(noAnim ? 20 : 80);
    await cdp.clickOn('#gantt-view-pop [data-view-mode="all"]');
    await cdp.settle();
    const allState = await cdp.ev(`({
      viewAttr: document.getElementById('gantt-root')?.getAttribute('data-view'),
      pastBars: document.querySelectorAll('#gantt-bars [data-time-state="past"]').length,
      rowCount: document.querySelectorAll('#gantt-tree .gantt-tree-row').length,
    })`);
    cdp.check(
      'big-plan: View dropdown switches to All Tasks and reveals past tasks',
      allState.viewAttr === 'all' && allState.pastBars > 0 && allState.rowCount > defState.rowCount,
      JSON.stringify(allState)
    );

    // Sticky phase header appears when scrolling down into a phase and jumps back on click
    await cdp.ev(`(() => {
      const tl = document.getElementById('gantt-timeline');
      tl.scrollTop = 520;
    })()`);
    await sleep(noAnim ? 30 : 80);
    const stickyState = await cdp.ev(`({
      hidden: document.getElementById('gantt-sticky-phase')?.hidden,
      text: (document.getElementById('gantt-sticky-phase')?.textContent || '').trim(),
      scrollBefore: document.getElementById('gantt-timeline').scrollTop,
    })`);
    cdp.check(
      'big-plan: sticky phase header appears on vertical scroll',
      stickyState.hidden === false && stickyState.text.length > 0,
      JSON.stringify(stickyState)
    );
    if (!stickyState.hidden) {
      await cdp.clickOn('#gantt-sticky-phase');
      await sleep(noAnim ? 30 : 120);
      const scrollAfterSticky = await cdp.ev(`document.getElementById('gantt-timeline').scrollTop`);
      cdp.check('big-plan: clicking sticky phase header scrolls up to phase', scrollAfterSticky < stickyState.scrollBefore, `${stickyState.scrollBefore}->${scrollAfterSticky}`);
    }

    // Off-screen bar jump pills render for off-screen rows and jump horizontally on click
    await cdp.ev(`(() => {
      const tl = document.getElementById('gantt-timeline');
      tl.scrollTop = 0;
      tl.scrollLeft = 200;
    })()`);
    await sleep(noAnim ? 30 : 80);
    const pillBefore = await cdp.ev(`(() => {
      const pill = document.querySelector('#gantt-offscreen .gantt-offscreen-pill');
      return { count: document.querySelectorAll('#gantt-offscreen .gantt-offscreen-pill').length, hasPill: !!pill, scrollLeft: document.getElementById('gantt-timeline').scrollLeft };
    })()`);
    cdp.check('big-plan: off-screen jump pills render for bars outside viewport', pillBefore.count > 0, JSON.stringify(pillBefore));
    if (pillBefore.hasPill) {
      await cdp.clickOn('#gantt-offscreen .gantt-offscreen-pill');
      await sleep(noAnim ? 40 : 120);
      const pillAfterLeft = await cdp.ev(`document.getElementById('gantt-timeline').scrollLeft`);
      cdp.check('big-plan: clicking off-screen jump pill scrolls timeline horizontally', pillAfterLeft !== pillBefore.scrollLeft, `${pillBefore.scrollLeft}->${pillAfterLeft}`);
    }

    // Legend click-to-filter narrows tasks to one stream and clears on second click
    await cdp.clickOn('#btn-legend');
    await sleep(noAnim ? 20 : 60);
    await cdp.clickOn('#gantt-color-key .color-key-item[data-color="3"]');
    await cdp.settle();
    const legFiltered = await cdp.ev(`({
      rows: document.querySelectorAll('#gantt-tree .gantt-tree-row').length,
      btnFiltered: document.getElementById('btn-legend')?.classList.contains('is-filtered'),
    })`);
    cdp.check(
      'big-plan: clicking legend stream filters rows',
      legFiltered.rows < allState.rowCount && legFiltered.btnFiltered === true,
      `all=${allState.rowCount} filtered=${legFiltered.rows}`
    );
    await cdp.clickOn('#gantt-color-key .color-key-item[data-color="3"]');
    await cdp.settle();
    const legRestored = await cdp.ev(`document.querySelectorAll('#gantt-tree .gantt-tree-row').length`);
    cdp.check('big-plan: clicking legend stream again clears filter', legRestored === allState.rowCount, `${legRestored} vs ${allState.rowCount}`);
    await cdp.press('Escape'); // close legend popover cleanly
    await cdp.mouse('mouseMoved', 20, 20);
    await cdp.settle();

    // Focus chain isolates connected dependencies and Escape exits
    await scrollBarIntoView('audit');
    await sleep(noAnim ? 40 : 80);
    await cdp.clickOn('.gantt-bar[data-item-id="audit"]');
    await cdp.settle();
    await cdp.clickOn('.gantt-actionbar [data-act="focus-chain"]');
    await cdp.settle();
    const focusedRows = await cdp.ev(`document.querySelectorAll('#gantt-tree .gantt-tree-row').length`);
    cdp.check('big-plan: Focus chain isolates connected tasks', focusedRows > 0 && focusedRows < allState.rowCount, `focused=${focusedRows} all=${allState.rowCount}`);
    await cdp.press('Escape');
    await cdp.settle();
    const afterEscRows = await cdp.ev(`document.querySelectorAll('#gantt-tree .gantt-tree-row').length`);
    cdp.check('big-plan: Escape exits Focus chain', afterEscRows === allState.rowCount, `${afterEscRows} vs ${allState.rowCount}`);

    checkNoErrors('big-plan-ux');
  });

  // ---------------------------------------------------------------------------
  // 13. Table View (Excel-like sheet) & Calendar Date Pickers
  // ---------------------------------------------------------------------------
  await cdp.section('table-view-and-calendar-pickers', async () => {
    await cdp.open(pagePath, baseQuery);
    await sleep(noAnim ? 40 : 100);

    // Holidays popover date input opens our custom calendar picker on click
    await cdp.clickOn('#btn-holidays');
    await sleep(noAnim ? 20 : 60);
    await cdp.clickOn('#gantt-hol-date');
    await sleep(noAnim ? 20 : 60);
    const holCalOpen = await cdp.ev(`!!document.querySelector('.gantt-cal-pop')`);
    cdp.check('calendar: holidays Start input opens .gantt-cal-pop', holCalOpen);
    await cdp.press('Escape');
    await cdp.clickOn('#gantt-hol-close');
    await cdp.settle();

    // Switch to Table mode
    await cdp.clickOn('#btn-mode-table');
    await cdp.settle();
    const tableInit = await cdp.ev(`({
      rootMode: document.getElementById('gantt-root')?.getAttribute('data-mode'),
      tableHidden: document.getElementById('gantt-table-view')?.hidden,
      rowCount: document.querySelectorAll('#gantt-sheet tbody tr[data-item-id]').length,
      zoomVisible: !!(document.querySelector('.toolbar-zoom')?.offsetParent),
    })`);
    cdp.check(
      'table: switching to Table mode shows sheet and hides zoom dock',
      tableInit.rootMode === 'table' && tableInit.tableHidden === false && tableInit.rowCount > 0 && tableInit.zoomVisible === false,
      JSON.stringify(tableInit)
    );

    // Calendar picker in Table Start cell updates date
    const startBefore = await cdp.ev(`document.querySelector('#gantt-sheet tr[data-item-id="res"] .gt-date-btn[data-field="start"]')?.textContent?.trim()`);
    await cdp.clickOn('#gantt-sheet tr[data-item-id="res"] .gt-date-btn[data-field="start"]');
    await sleep(noAnim ? 20 : 60);
    const tableCalOpen = await cdp.ev(`!!document.querySelector('.gantt-cal-pop .gantt-cal-day')`);
    cdp.check('table: clicking Start date cell opens .gantt-cal-pop', tableCalOpen);
    await cdp.clickOn('.gantt-cal-pop .gantt-cal-day:not(.is-outside):not(.is-selected)');
    await cdp.settle();
    const startAfter = await cdp.ev(`document.querySelector('#gantt-sheet tr[data-item-id="res"] .gt-date-btn[data-field="start"]')?.textContent?.trim()`);
    cdp.check('table: picking calendar day updates Start date', Boolean(startAfter && startAfter !== startBefore), `${startBefore} -> ${startAfter}`);

    // Editing Duration recalculates End date
    await cdp.clickOn('#gantt-sheet tr[data-item-id="res"] .gt-col-dur');
    await sleep(noAnim ? 20 : 50);
    await cdp.ev(`(() => {
      const inp = document.querySelector('#gantt-sheet tr[data-item-id="res"] .gt-col-dur input');
      if (inp) { inp.value = '2w'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
    })()`);
    await cdp.settle();
    const durAfter = await cdp.ev(`document.querySelector('#gantt-sheet tr[data-item-id="res"] .gt-col-dur')?.textContent?.trim()`);
    cdp.check('table: typing 2w in Duration updates duration to 14d', durAfter === '14d', `got=${durAfter}`);

    // Quick-add row adds a new task on Enter
    await cdp.clickOn('#gantt-sheet-quick-add');
    await cdp.ev(`(() => {
      const q = document.getElementById('gantt-sheet-quick-add');
      q.value = 'Excel Import Task';
      q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    await cdp.settle();
    const afterQuickAdd = await cdp.ev(`({
      rowCount: document.querySelectorAll('#gantt-sheet tbody tr[data-item-id]').length,
      hasTask: [...document.querySelectorAll('#gantt-sheet .gt-label-text')].some((el) => el.textContent.trim() === 'Excel Import Task'),
    })`);
    cdp.check(
      'table: quick-add row creates new task on Enter',
      afterQuickAdd.rowCount === tableInit.rowCount + 1 && afterQuickAdd.hasTask,
      JSON.stringify(afterQuickAdd)
    );

    // Excel TSV paste creates multiple tasks
    const beforePaste = afterQuickAdd.rowCount;
    await cdp.ev(`(() => {
      const host = document.getElementById('gantt-table-view');
      const dt = new DataTransfer();
      dt.setData('text/plain', 'Task\\tStart\\tEnd\\nPasted Row A\\t2026-06-01\\t2026-06-10\\nPasted Row B\\t2026-06-11\\t2026-06-20');
      host.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    })()`);
    await cdp.settle();
    const afterPaste = await cdp.ev(`document.querySelectorAll('#gantt-sheet tbody tr[data-item-id]').length`);
    cdp.check('table: pasting TSV from Excel creates 2 tasks', afterPaste === beforePaste + 2, `${beforePaste} -> ${afterPaste}`);

    // Bulk selection shows bulk action bar
    await cdp.ev(`document.querySelector('#gantt-sheet tbody tr[data-item-id="res"]')?.scrollIntoView({ block: 'center' })`);
    await cdp.clickOn('#gantt-sheet tbody tr[data-item-id="res"] .gt-checkbox');
    await cdp.settle();
    const bulkVisible = await cdp.ev(`!document.getElementById('gantt-table-bulkbar')?.hidden`);
    cdp.check('table: checking row shows bulk action bar', bulkVisible);

    // Switch back to Timeline and confirm newly added Table tasks render as bars
    await cdp.clickOn('#btn-mode-timeline');
    await cdp.settle();
    const timelineSync = await cdp.ev(`({
      rootMode: document.getElementById('gantt-root')?.getAttribute('data-mode'),
      hasQuickTask: [...document.querySelectorAll('#gantt-tree .gantt-tree-label')].some((el) => el.textContent.trim() === 'Excel Import Task'),
      hasPastedTask: [...document.querySelectorAll('#gantt-tree .gantt-tree-label')].some((el) => el.textContent.trim() === 'Pasted Row A'),
    })`);
    cdp.check(
      'table->timeline: edits and pasted rows render immediately in Timeline',
      timelineSync.rootMode === 'timeline' && timelineSync.hasQuickTask && timelineSync.hasPastedTask,
      JSON.stringify(timelineSync)
    );

    checkNoErrors('table-view-and-calendar-pickers');
  });

  // ---------------------------------------------------------------------------
  // 14. Render reuse & event delegation (Timeline + Table)
  // ---------------------------------------------------------------------------
  await cdp.section('render-reuse-and-delegation', async () => {
    await cdp.open(pagePath, baseQuery);
    await sleep(noAnim ? 40 : 100);
    await cdp.ev(`(() => {
      document.querySelectorAll('#gantt-tree .gantt-tree-row, #gantt-bars .gantt-bar, #gantt-bars .gantt-milestone').forEach((el) => {
        el.__mark = el.dataset.itemId + ':' + el.className.split(' ')[0];
      });
    })()`);
    // Toggle Weekends twice to trigger full timeline re-renders
    await cdp.clickOn('#btn-weekends'); await cdp.settle();
    await cdp.clickOn('#btn-weekends'); await cdp.settle();
    const tlKept = await cdp.ev(`(() => {
      const els = [...document.querySelectorAll('#gantt-tree .gantt-tree-row, #gantt-bars .gantt-bar, #gantt-bars .gantt-milestone')];
      return { n: els.length, lost: els.filter((el) => el.__mark !== el.dataset.itemId + ':' + el.className.split(' ')[0]).map((el) => el.dataset.itemId) };
    })()`);
    cdp.check('timeline: re-rendering keeps tree row, bar, and milestone DOM identity', tlKept.n >= 6 && tlKept.lost.length === 0, JSON.stringify(tlKept));

    // Delegated click on a kept bar selects it
    await cdp.clickOn('.gantt-bar[data-item-id="res"]');
    await cdp.settle();
    const barSel = await cdp.ev(`document.querySelector('.gantt-bar[data-item-id="res"]')?.classList.contains('selected')`);
    cdp.check('timeline: delegated click on a kept bar selects it', barSel === true);

    // Table view: marking rows, toggling checkbox keeps every <tr> DOM identity
    await cdp.clickOn('#btn-mode-table');
    await cdp.settle();
    const wasChecked = await cdp.ev(`document.querySelector('#gantt-sheet tbody tr[data-item-id="res"] .gt-checkbox')?.checked`);
    await cdp.ev(`document.querySelectorAll('#gantt-sheet tbody tr[data-item-id]').forEach((tr) => { tr.__mark = tr.dataset.itemId; })`);
    await cdp.clickOn('#gantt-sheet tbody tr[data-item-id="res"] .gt-checkbox');
    await cdp.settle();
    const tblKept = await cdp.ev(`(() => {
      const rows = [...document.querySelectorAll('#gantt-sheet tbody tr[data-item-id]')];
      return { n: rows.length, lost: rows.filter((tr) => tr.__mark !== tr.dataset.itemId).map((tr) => tr.dataset.itemId), checked: document.querySelector('#gantt-sheet tbody tr[data-item-id="res"] .gt-checkbox')?.checked };
    })()`);
    cdp.check('table: re-rendering on selection keeps every row DOM identity', tblKept.n >= 4 && tblKept.lost.length === 0 && tblKept.checked !== wasChecked, JSON.stringify({ wasChecked, ...tblKept }));

    checkNoErrors('render-reuse-and-delegation');
  });

  // ---------------------------------------------------------------------------
  // 15. Narrow-viewport initial scroll & programmatic scrollLeft (with smooth scroll)
  // ---------------------------------------------------------------------------
  await cdp.section('narrow-viewport-scroll', async () => {
    // Open WITHOUT &noanim=1 so CSS `scroll-behavior: smooth` on #gantt-timeline is active
    // (the bug was masked under --noanim because noanim forces `scroll-behavior: auto !important`).
    const animQuery = `?today=${todayParam}`;
    try {
      for (const [w, h] of [[900, 768], [1024, 768]]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: w,
          height: h,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await cdp.open(pagePath, animQuery);
        await sleep(300);

        const initial = await cdp.ev(`(() => {
          const tl = document.getElementById('gantt-timeline');
          const tr = tl.getBoundingClientRect();
          const bars = [...document.querySelectorAll('#gantt-bars .gantt-bar')];
          const visBars = bars.filter((b) => {
            const r = b.getBoundingClientRect();
            return r.right > tr.left && r.left < tr.right;
          });
          const years = [...document.querySelectorAll('#gantt-header-top .gantt-tick')]
            .filter((t) => {
              const r = t.getBoundingClientRect();
              return r.right > tr.left && r.left < tr.right;
            })
            .map((t) => t.textContent.trim());
          return {
            scrollLeft: tl.scrollLeft,
            scrollWidth: tl.scrollWidth,
            clientWidth: tl.clientWidth,
            barCount: bars.length,
            visBarCount: visBars.length,
            years,
          };
        })()`);

        cdp.check(
          `narrow ${w}x${h}: opens with roadmap bars visible in 2026 (not scrolled to 2022/2023)`,
          initial.visBarCount > 0 && initial.years.includes('2026') && !initial.years.includes('2022') && !initial.years.includes('2023'),
          JSON.stringify(initial)
        );

        // Programmatically set scrollLeft and confirm it reaches & stays at target without snapping back
        const target = Math.min(initial.scrollLeft + 240, Math.max(0, initial.scrollWidth - initial.clientWidth - 200));
        await cdp.ev(`document.getElementById('gantt-timeline').scrollLeft = ${target}`);
        const landed = await cdp.waitFor(
          `Math.abs(document.getElementById('gantt-timeline').scrollLeft - ${target}) <= 2`,
          { timeout: 1500 }
        );
        await sleep(200);
        const settled = await cdp.ev(`document.getElementById('gantt-timeline').scrollLeft`);
        cdp.check(
          `narrow ${w}x${h}: programmatic scrollLeft=${target} stays where set without snapping back`,
          !!landed && Math.abs(settled - target) <= 2,
          `target=${target} settled=${settled}`
        );
      }
    } finally {
      await cdp.send('Emulation.clearDeviceMetricsOverride');
    }
    checkNoErrors('narrow-viewport-scroll');
  });

  exitCode = cdp.finish();
} finally {
  await cdp.close();
  if (work) rmSync(work, { recursive: true, force: true });
}
process.exit(exitCode);
