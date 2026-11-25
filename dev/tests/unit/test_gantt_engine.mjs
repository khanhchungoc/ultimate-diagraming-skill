#!/usr/bin/env node
// Unit tests for assets/types/gantt/engine.js.
// Zero dependencies; run with: node dev/tests/unit/test_gantt_engine.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const tokens = JSON.parse(readFileSync(join(ROOT, 'assets/tokens/default.json'), 'utf8'));
const routerSrc = readFileSync(join(ROOT, 'assets/shell/ortho-router.js'), 'utf8');
const engineSrc = readFileSync(join(ROOT, 'assets/types/gantt/engine.js'), 'utf8');

const engine = new Function(
  'TOKENS',
  `${routerSrc}\n${engineSrc}\nreturn { layoutDiagram, GANTT_ZOOMS, ganttParseDate, ganttFormatDate, ganttAddDays, ganttDiffDays };`
)(tokens);

const {
  layoutDiagram,
  GANTT_ZOOMS,
  ganttParseDate,
  ganttFormatDate,
  ganttAddDays,
  ganttDiffDays
} = engine;

const clone = (o) => JSON.parse(JSON.stringify(o));

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function assertOrthogonal(points) {
  assert.ok(Array.isArray(points) && points.length >= 2, 'points must have >= 2 vertices');
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const horiz = Math.abs(y1 - y2) < 1e-6;
    const vert = Math.abs(x1 - x2) < 1e-6;
    assert.ok(horiz || vert, `segment ${i} (${x1},${y1})->(${x2},${y2}) is not orthogonal`);
  }
}

console.log('Running Gantt engine unit tests...');

test('pure UTC date helpers', () => {
  const d = ganttParseDate('2026-04-01');
  assert.ok(d instanceof Date);
  assert.equal(ganttFormatDate(d), '2026-04-01');
  assert.equal(ganttParseDate('2026-02-31'), null);
  assert.equal(ganttParseDate('not-a-date'), null);
  assert.equal(ganttFormatDate(ganttParseDate('2024-02-29')), '2024-02-29');
  assert.equal(ganttAddDays('2026-04-01', 14), '2026-04-15');
  assert.equal(ganttAddDays('2026-04-01', -1), '2026-03-31');
  assert.equal(ganttDiffDays('2026-04-01', '2026-04-01'), 0);
  assert.equal(ganttDiffDays('2026-04-01', '2026-04-15'), 14);
  assert.equal(ganttDiffDays('2026-04-15', '2026-04-01'), -14);
});

test('no nondeterministic clock calls in engine source', () => {
  const codeOnly = engineSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.equal(/Date\.now\s*\(/.test(codeOnly), false, 'engine.js must not call Date.now()');
  assert.equal(/new\s+Date\s*\(\s*\)/.test(codeOnly), false, 'engine.js must not call new Date() with no args');
});

test('determinism: two runs produce identical JSON', () => {
  const sample = {
    diagramType: 'gantt',
    zoom: 'month',
    markers: [{ id: 'm1', label: 'Launch', date: '2026-06-20', color: '4' }],
    holidays: [{ date: '2026-05-01', end: '2026-05-01', name: 'Labor Day', country: 'VN' }],
    items: [
      { id: 'g1', kind: 'group', label: 'Build', collapsed: false },
      { id: 't1', kind: 'task', label: 'API', parent: 'g1', start: '2026-04-01', end: '2026-04-20' },
      { id: 't2', kind: 'task', label: 'UI', parent: 'g1', start: '2026-04-21', end: '2026-05-10' },
      { id: 'ms1', kind: 'milestone', label: 'Beta', parent: 'g1', start: '2026-05-15', end: '2026-05-15' }
    ],
    dependencies: [
      { from: 't1', to: 't2', type: 'fs' },
      { from: 't2', to: 'ms1', type: 'fs' }
    ]
  };
  const a = layoutDiagram(clone(sample));
  const b = layoutDiagram(clone(sample));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('all 5 zoom presets and 1-day bar width', () => {
  const expected = {
    day:     { pxPerDay: 44,  snapDays: 1, showWeekends: true,  label: 'Day' },
    week:    { pxPerDay: 18,  snapDays: 1, showWeekends: true,  label: 'Week' },
    month:   { pxPerDay: 6,   snapDays: 1, showWeekends: false, label: 'Month' },
    quarter: { pxPerDay: 2.4, snapDays: 7, showWeekends: false, label: 'Quarter' },
    year:    { pxPerDay: 1.0, snapDays: 7, showWeekends: false, label: 'Year' }
  };
  assert.deepEqual(GANTT_ZOOMS, expected);

  const widths = {};
  for (const zoom of ['day', 'week', 'month', 'quarter', 'year']) {
    const data = {
      diagramType: 'gantt',
      zoom,
      items: [
        { id: 'one', kind: 'task', label: 'One day', start: '2026-05-10', end: '2026-05-10' },
        { id: 'ten', kind: 'task', label: 'Ten days', start: '2026-05-10', end: '2026-05-19' }
      ]
    };
    layoutDiagram(data);
    assert.equal(data._range.pxPerDay, expected[zoom].pxPerDay);
    assert.equal(data.items[0]._bar.w, expected[zoom].pxPerDay);
    assert.equal(data.items[1]._bar.w, Math.round(10 * expected[zoom].pxPerDay * 10) / 10);
    widths[zoom] = data._range.timelineWidth;
  }
  assert.ok(widths.day > widths.week);
  assert.ok(widths.week > widths.month);
  assert.ok(widths.month > widths.quarter);
  assert.ok(widths.quarter > widths.year);
});

test('3+ levels of nesting, DFS order, and bottom-up parent rollup', () => {
  const data = {
    diagramType: 'gantt',
    zoom: 'month',
    items: [
      { id: 'p0', kind: 'group', label: 'Phase 1', collapsed: false },
      { id: 'p1', kind: 'task', label: 'Platform', parent: 'p0', collapsed: false },
      { id: 'p2', kind: 'task', label: 'Auth', parent: 'p1', collapsed: false },
      { id: 'p3a', kind: 'task', label: 'OAuth', parent: 'p2', start: '2026-04-05', end: '2026-04-12' },
      { id: 'p3b', kind: 'task', label: 'SAML', parent: 'p2', start: '2026-04-10', end: '2026-04-25' },
      { id: 'p1_sib', kind: 'task', label: 'Docs', parent: 'p0', start: '2026-04-01', end: '2026-04-30' },
      { id: 'root2', kind: 'task', label: 'Launch prep', start: '2026-05-01', end: '2026-05-05' }
    ]
  };
  layoutDiagram(data);
  const byId = Object.fromEntries(data.items.map((it) => [it.id, it]));

  // Depths
  assert.equal(byId.p0._depth, 0);
  assert.equal(byId.p1._depth, 1);
  assert.equal(byId.p2._depth, 2);
  assert.equal(byId.p3a._depth, 3);
  assert.equal(byId.p3b._depth, 3);
  assert.equal(byId.p1_sib._depth, 1);
  assert.equal(byId.root2._depth, 0);

  // _hasChildren
  assert.equal(byId.p0._hasChildren, true);
  assert.equal(byId.p1._hasChildren, true);
  assert.equal(byId.p2._hasChildren, true);
  assert.equal(byId.p3a._hasChildren, false);
  assert.equal(byId.root2._hasChildren, false);

  // DFS row order
  assert.deepEqual(
    ['p0', 'p1', 'p2', 'p3a', 'p3b', 'p1_sib', 'root2'].map((id) => byId[id]._row),
    [0, 1, 2, 3, 4, 5, 6]
  );

  // Bottom-up rollup across all 4 levels
  assert.equal(byId.p2._start, '2026-04-05');
  assert.equal(byId.p2._end, '2026-04-25');
  assert.equal(byId.p1._start, '2026-04-05');
  assert.equal(byId.p1._end, '2026-04-25');
  assert.equal(byId.p0._start, '2026-04-01');
  assert.equal(byId.p0._end, '2026-04-30');
});

test('collapsing hides descendants, re-indexes rows, preserves parent rollup, and filters deps', () => {
  const data = {
    diagramType: 'gantt',
    zoom: 'week',
    items: [
      { id: 'g', kind: 'group', label: 'Group', collapsed: false },
      { id: 'parent', kind: 'task', label: 'Parent', parent: 'g', collapsed: true },
      { id: 'child', kind: 'task', label: 'Child', parent: 'parent', start: '2026-04-02', end: '2026-04-08' },
      { id: 'grand', kind: 'task', label: 'Grandchild', parent: 'child', start: '2026-04-04', end: '2026-04-12' },
      { id: 'after', kind: 'task', label: 'After', parent: 'g', start: '2026-04-15', end: '2026-04-20' }
    ],
    dependencies: [
      { from: 'child', to: 'after', type: 'fs' },
      { from: 'parent', to: 'after', type: 'fs' }
    ]
  };
  layoutDiagram(data);
  const byId = Object.fromEntries(data.items.map((it) => [it.id, it]));

  assert.equal(byId.g._hidden, false);
  assert.equal(byId.parent._hidden, false);
  assert.equal(byId.child._hidden, true);
  assert.equal(byId.grand._hidden, true);
  assert.equal(byId.after._hidden, false);

  assert.equal(byId.g._row, 0);
  assert.equal(byId.parent._row, 1);
  assert.equal(byId.child._row, -1);
  assert.equal(byId.grand._row, -1);
  assert.equal(byId.after._row, 2);

  assert.equal(byId.child._bar, null);
  assert.equal(byId.grand._bar, null);

  // Collapsed parent still rolls up from hidden descendants
  assert.equal(byId.parent._start, '2026-04-04');
  assert.equal(byId.parent._end, '2026-04-12');
  assert.ok(byId.parent._bar !== null);

  // Only visible dependency remains
  assert.equal(data._deps.length, 1);
  assert.equal(data._deps[0].from, 'parent');
  assert.equal(data._deps[0].to, 'after');

  // Canvas height matches 3 visible rows
  assert.equal(data.canvas.height, data.canvas.headerHeight + 3 * data.canvas.rowHeight);
});

test('FS and SS dependency routing and violated flag', () => {
  const data = {
    diagramType: 'gantt',
    zoom: 'week',
    items: [
      { id: 'a', kind: 'task', label: 'A', start: '2026-04-01', end: '2026-04-10' },
      { id: 'b', kind: 'task', label: 'B', start: '2026-04-15', end: '2026-04-20' }, // clean FS after A
      { id: 'c', kind: 'task', label: 'C', start: '2026-04-05', end: '2026-04-14' }, // violated FS after A, clean SS after A
      { id: 'd', kind: 'task', label: 'D', start: '2026-03-28', end: '2026-04-04' }, // violated SS after A
      { id: 'm', kind: 'milestone', label: 'Sign-off', start: '2026-04-10', end: '2026-04-10' } // back-to-back row milestone after A
    ],
    dependencies: [
      { from: 'a', to: 'b', type: 'fs' },
      { from: 'a', to: 'c', type: 'fs' },
      { from: 'a', to: 'c', type: 'ss' },
      { from: 'a', to: 'd', type: 'ss' },
      { from: 'a', to: 'm', type: 'fs' },
      { from: 'a', to: 'a', type: 'fs' },      // self-loop ignored
      { from: 'a', to: 'missing', type: 'fs' } // unknown ignored
    ]
  };
  layoutDiagram(data);
  const byId = Object.fromEntries(data.items.map((it) => [it.id, it]));

  assert.equal(data._deps.length, 5);

  const [fsClean, fsViolated, ssClean, ssViolated, fsMilestone] = data._deps;

  assert.equal(fsClean.type, 'fs');
  assert.equal(fsClean.violated, false);
  assert.equal(fsClean.points.length, 3); // 1-bend L-shape exiting bottom/top edge
  assert.ok(fsClean.points[0][0] >= byId.a._bar.x && fsClean.points[0][0] <= byId.a._bar.x + byId.a._bar.w);
  assert.equal(fsClean.points[fsClean.points.length - 1][0], byId.b._bar.x);
  assertOrthogonal(fsClean.points);
  assert.ok(fsClean.path.startsWith('M '));

  assert.equal(fsViolated.type, 'fs');
  assert.equal(fsViolated.violated, true);
  assert.equal(fsViolated.points.length, 3); // 1-bend L-shape since c starts inside a's span
  assertOrthogonal(fsViolated.points);
  assert.ok(fsViolated.path.startsWith('M '));

  assert.equal(ssClean.type, 'ss');
  assert.equal(ssClean.violated, false);
  assert.equal(ssClean.points[0][0], byId.a._bar.x);
  assert.equal(ssClean.points[ssClean.points.length - 1][0], byId.c._bar.x);
  assertOrthogonal(ssClean.points);
  assert.ok(ssClean.path.startsWith('M '));

  assert.equal(ssViolated.type, 'ss');
  assert.equal(ssViolated.violated, true);
  assertOrthogonal(ssViolated.points);
  assert.ok(ssViolated.path.startsWith('M '));

  assert.equal(fsMilestone.type, 'fs');
  assert.equal(fsMilestone.violated, false);
  assert.equal(fsMilestone.points.length, 3); // 1-bend L-shape into back-to-back row milestone
  assert.ok(fsMilestone.points[0][0] >= byId.a._bar.x && fsMilestone.points[0][0] <= byId.a._bar.x + byId.a._bar.w);
  assert.equal(fsMilestone.points[fsMilestone.points.length - 1][0], byId.m._bar.x);
  assertOrthogonal(fsMilestone.points);
  assert.ok(fsMilestone.path.startsWith('M '));
});

test('row milestones, vertical markers, and clipped holidays', () => {
  const data = {
    diagramType: 'gantt',
    zoom: 'day', // pxPerDay = 44, pad before = 90, after = 180
    items: [
      { id: 't1', kind: 'task', label: 'Work', start: '2026-06-10', end: '2026-06-12' },
      { id: 'm_row', kind: 'milestone', label: 'Sign-off', start: '2026-06-12', end: '2026-06-12' }
    ],
    markers: [
      { id: 'mk1', label: 'Launch Day', date: '2026-06-15', color: '4' }
    ],
    holidays: [
      { date: '2026-06-11', end: '2026-06-11', name: 'Company Day', country: 'US' },
      { date: '2026-03-01', end: '2026-03-13', name: 'Early Span', country: 'US' }, // clipped at range start 2026-03-12
      { date: '2025-01-01', end: '2025-01-01', name: 'Out of Range', country: 'US' }
    ]
  };
  layoutDiagram(data);

  // Earliest is 2026-06-10 (-90 => 2026-03-12), latest is marker 2026-06-15 (+180 => 2026-12-12)
  assert.equal(data._range.start, '2026-03-12');
  assert.equal(data._range.end, '2026-12-12');
  assert.equal(data._range.contentStart, '2026-06-10');
  assert.equal(data._range.contentEnd, '2026-06-15');

  // Row milestone centered on 2026-06-12 (day offset 92 => center 92*44 + 22 = 4070)
  const msBar = data.items[1]._bar;
  assert.equal(msBar.w, 16);
  assert.equal(msBar.h, 16);
  assert.equal(msBar.x + msBar.w / 2, 92 * 44 + 22);

  // Vertical marker on 2026-06-15 (day offset 95 => center 95*44 + 22 = 4202)
  assert.equal(data._markers.length, 1);
  assert.equal(data._markers[0].x, 95 * 44 + 22);

  // Holidays: 2 in range, 1 excluded; Early Span clipped to 2026-03-12..2026-03-13 (2 days = 88px)
  assert.equal(data._holidays.length, 2);
  assert.equal(data._holidays[0].start, '2026-06-11');
  assert.equal(data._holidays[0].x, 91 * 44);
  assert.equal(data._holidays[0].w, 44);
  assert.equal(data._holidays[1].start, '2026-03-12');
  assert.equal(data._holidays[1].end, '2026-03-13');
  assert.equal(data._holidays[1].x, 0);
  assert.equal(data._holidays[1].w, 2 * 44);
});

test('empty chart fallback range and canvas', () => {
  const data = { diagramType: 'gantt', zoom: 'month', items: [] };
  layoutDiagram(data);
  assert.equal(data._range.start, '2026-01-01');
  assert.equal(data._range.end, '2026-03-31');
  assert.equal(data._range.contentStart, '2026-01-01');
  assert.equal(data._range.contentEnd, '2026-03-31');
  assert.equal(data._range.totalDays, 90);
  assert.equal(data._range.pxPerDay, 6);
  assert.equal(data._range.timelineWidth, 540);
  assert.deepEqual(data._deps, []);
  assert.deepEqual(data._markers, []);
  assert.deepEqual(data._holidays, []);
  assert.equal(data.canvas.rowHeight, 44);
  assert.equal(data.canvas.headerHeight, 58);
  assert.equal(data.canvas.width, data.canvas.sidebarWidth + 540);
  assert.equal(data.canvas.height, data.canvas.headerHeight + data.canvas.rowHeight);
});

test('updated layout metrics for rows, bars, groups, milestones, and header', () => {
  const data = {
    diagramType: 'gantt',
    zoom: 'month',
    items: [
      { id: 'g1', kind: 'group', label: 'Phase 1', collapsed: false },
      { id: 't1', kind: 'task', label: 'Task 1', parent: 'g1', start: '2026-04-01', end: '2026-04-10' },
      { id: 'm1', kind: 'milestone', label: 'Gate', parent: 'g1', start: '2026-04-10', end: '2026-04-10' }
    ]
  };
  layoutDiagram(data);
  assert.equal(data.canvas.rowHeight, 44);
  assert.equal(data.canvas.headerHeight, 58);
  assert.equal(data.canvas.height, 58 + 3 * 44);
  assert.equal(data.items[0]._bar.h, 10);
  assert.equal(data.items[1]._bar.h, 26);
  assert.equal(data.items[2]._bar.w, 16);
  assert.equal(data.items[2]._bar.h, 16);
});

test('runtime range extension via _extraStart/_extraEnd preserves contentStart/contentEnd', () => {
  const base = {
    diagramType: 'gantt',
    zoom: 'day',
    items: [
      { id: 't1', kind: 'task', label: 'Core', start: '2026-06-10', end: '2026-06-20' }
    ]
  };

  // Earlier _extraStart and later _extraEnd extend _range without altering contentStart/contentEnd
  const extended = clone(base);
  extended._extraStart = '2025-01-01';
  extended._extraEnd = '2028-01-01';
  layoutDiagram(extended);
  assert.equal(extended._range.start, '2025-01-01');
  assert.equal(extended._range.end, '2028-01-01');
  assert.equal(extended._range.contentStart, '2026-06-10');
  assert.equal(extended._range.contentEnd, '2026-06-20');

  // Narrower or invalid hints are ignored
  const narrower = clone(base);
  narrower._extraStart = '2026-06-01';
  narrower._extraEnd = '2026-07-01';
  layoutDiagram(narrower);
  assert.equal(narrower._range.start, ganttAddDays('2026-06-10', -90));
  assert.equal(narrower._range.end, ganttAddDays('2026-06-20', 180));

  const invalid = clone(base);
  invalid._extraStart = 'not-a-date';
  invalid._extraEnd = '2026-02-31';
  layoutDiagram(invalid);
  assert.equal(invalid._range.start, ganttAddDays('2026-06-10', -90));
  assert.equal(invalid._range.end, ganttAddDays('2026-06-20', 180));
});

test('unscheduled leaf tasks stay visible with _bar === null and do not break rollup or range', () => {
  const data = {
    diagramType: 'gantt',
    zoom: 'month',
    items: [
      { id: 'g1', kind: 'group', label: 'Mixed Group', collapsed: false },
      { id: 't_sched', kind: 'task', label: 'Scheduled', parent: 'g1', start: '2026-04-01', end: '2026-04-15' },
      { id: 't_unsched', kind: 'task', label: 'Unscheduled child', parent: 'g1' },
      { id: 'g_empty', kind: 'group', label: 'Unscheduled Group', collapsed: false },
      { id: 't_unsched2', kind: 'task', label: 'Unscheduled leaf', parent: 'g_empty' },
      { id: 't_root_unsched', kind: 'task', label: 'Backlog item' }
    ],
    dependencies: [
      { from: 't_sched', to: 't_unsched', type: 'fs' }
    ]
  };
  layoutDiagram(data);
  const byId = Object.fromEntries(data.items.map((it) => [it.id, it]));

  // All rows remain visible in DFS order
  assert.deepEqual(
    ['g1', 't_sched', 't_unsched', 'g_empty', 't_unsched2', 't_root_unsched'].map((id) => byId[id]._row),
    [0, 1, 2, 3, 4, 5]
  );

  // Unscheduled items have null dates and null bar
  for (const id of ['t_unsched', 'g_empty', 't_unsched2', 't_root_unsched']) {
    assert.equal(byId[id]._hidden, false);
    assert.equal(byId[id]._start, null);
    assert.equal(byId[id]._end, null);
    assert.equal(byId[id]._bar, null);
  }

  // Mixed group still rolls up scheduled child cleanly
  assert.equal(byId.g1._start, '2026-04-01');
  assert.equal(byId.g1._end, '2026-04-15');
  assert.ok(byId.g1._bar !== null);

  // Dependency targeting an unscheduled item is safely skipped
  assert.deepEqual(data._deps, []);

  // Chart with only unscheduled tasks falls back cleanly without crashing
  const onlyUnscheduled = {
    diagramType: 'gantt',
    zoom: 'month',
    items: [
      { id: 'u1', kind: 'task', label: 'Idea 1' },
      { id: 'u2', kind: 'task', label: 'Idea 2' }
    ]
  };
  layoutDiagram(onlyUnscheduled);
  assert.equal(onlyUnscheduled.items[0]._row, 0);
  assert.equal(onlyUnscheduled.items[0]._bar, null);
  assert.equal(onlyUnscheduled.items[1]._row, 1);
  assert.equal(onlyUnscheduled.items[1]._bar, null);
  assert.equal(onlyUnscheduled._range.start, '2026-01-01');
  assert.equal(onlyUnscheduled._range.end, '2026-03-31');
  assert.equal(onlyUnscheduled.canvas.height, 58 + 2 * 44);
});

test('cyclic parent references do not hang', () => {
  const data = {
    diagramType: 'gantt',
    zoom: 'month',
    items: [
      { id: 'x', kind: 'task', label: 'X', parent: 'y', start: '2026-04-01', end: '2026-04-05' },
      { id: 'y', kind: 'task', label: 'Y', parent: 'x', start: '2026-04-03', end: '2026-04-08' }
    ]
  };
  layoutDiagram(data);
  assert.equal(data.items[0]._depth, 0);
  assert.equal(data.items[1]._depth, 0);
  assert.equal(data.items[0]._row, 0);
  assert.equal(data.items[1]._row, 1);
});

test('_filterIds compacts visible rows while preserving parent rollups and timeline range', () => {
  const data = {
    diagramType: 'gantt',
    zoom: 'month',
    items: [
      { id: 'p1', kind: 'group', label: 'Phase 1' },
      { id: 'past', kind: 'task', label: 'Past task', parent: 'p1', start: '2026-02-01', end: '2026-02-20' },
      { id: 'act1', kind: 'task', label: 'Active 1', parent: 'p1', start: '2026-05-01', end: '2026-06-01' },
      { id: 'p2', kind: 'group', label: 'Phase 2' },
      { id: 'act2', kind: 'task', label: 'Active 2', parent: 'p2', start: '2026-05-15', end: '2026-06-15' }
    ],
    dependencies: [
      { from: 'past', to: 'act1', type: 'fs' },
      { from: 'act1', to: 'act2', type: 'fs' }
    ]
  };
  layoutDiagram(data);
  const fullRangeStart = data._range.start;
  const fullRangeEnd = data._range.end;

  data._filterIds = new Set(['p1', 'act1', 'p2', 'act2']);
  layoutDiagram(data);
  const byId = Object.fromEntries(data.items.map((it) => [it.id, it]));

  // Timeline range and parent rollup stay stable
  assert.equal(data._range.start, fullRangeStart);
  assert.equal(data._range.end, fullRangeEnd);
  assert.equal(byId.p1._start, '2026-02-01');
  assert.equal(byId.p1._end, '2026-06-01');

  // Filtered-out row is hidden and remaining rows pack densely 0..3
  assert.equal(byId.past._hidden, true);
  assert.equal(byId.past._row, -1);
  assert.equal(byId.past._bar, null);
  assert.equal(byId.p1._row, 0);
  assert.equal(byId.act1._row, 1);
  assert.equal(byId.p2._row, 2);
  assert.equal(byId.act2._row, 3);

  // Only dependency between visible items is routed
  assert.equal(data._deps.length, 1);
  assert.equal(data._deps[0].from, 'act1');
  assert.equal(data._deps[0].to, 'act2');
});

if (process.exitCode) {
  console.error(`\nFailed (${passed} passed before failure).`);
} else {
  console.log(`\nAll ${passed} Gantt engine tests passed.`);
}
