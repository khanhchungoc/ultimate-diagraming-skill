// Zero-dependency unit tests for assets/types/gantt/mermaid.js.
// Run: node dev/tests/unit/test_gantt_mermaid.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function loadGanttMermaid() {
  const flowSrc = readFileSync(join(ROOT, 'assets/shell/mermaid-flow.js'), 'utf8');
  const ganttSrc = readFileSync(join(ROOT, 'assets/types/gantt/mermaid.js'), 'utf8');
  const fn = new Function(
    flowSrc + '\n' + ganttSrc + '\nreturn { fromMermaid, toMermaid, mmdGanttParseDate, mmdGanttFormatDate, mmdGanttAddDays };',
  );
  return fn();
}

const { fromMermaid, toMermaid, mmdGanttParseDate, mmdGanttFormatDate, mmdGanttAddDays } = loadGanttMermaid();

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed++;
    console.error(`[FAIL] ${name}`);
    console.error('      ', err.stack || err.message);
  }
}

test('parses plan-gantt.md flagship roadmap example', () => {
  const mmd = `
gantt
    title Q2–Q3 Product Roadmap
    dateFormat YYYY-MM-DD
    %% @zoom month
    %% @holidays auto
    %% @colorKey 1: Engineering, 2: Design, 4: Go-to-Market
    %% @marker Launch Day : 2026-07-15 4

    section Discovery
    User research          :res, 2026-04-01, 2026-04-14
    %% @color res 2
    %% @progress res 100
    %% @note res Interview 12 enterprise buyers across US and APAC.

    section Build
    Core platform          :plat, 2026-04-10, 2026-06-15
    %% @color plat 1
    API layer              :api, after res, 21d
    %% @parent api plat
    %% @progress api 60
    Auth & SSO             :auth, 2026-04-20, 14d
    %% @parent auth api
    %% @dep auth start-start api
    Web UI                 :ui, after api, 2026-06-15
    %% @parent ui plat
    %% @color ui 2
    Beta ready             :milestone, beta, after ui, 0d
    %% @parent beta plat
`;
  const { data, warnings } = fromMermaid(mmd);
  assert.deepEqual(warnings, []);
  assert.equal(data.diagramType, 'gantt');
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.title, 'Q2–Q3 Product Roadmap');
  assert.equal(data.zoom, 'month');
  assert.equal(data._holidaysMode, 'auto');
  assert.deepEqual(data.colorKey, { '1': 'Engineering', '2': 'Design', '4': 'Go-to-Market' });
  assert.deepEqual(data.markers, [{ id: 'm_launch_day', label: 'Launch Day', date: '2026-07-15', color: '4' }]);

  const byId = Object.fromEntries(data.items.map((it) => [it.id, it]));
  assert.equal(byId.discovery.kind, 'group');
  assert.equal(byId.res.parent, 'discovery');
  assert.equal(byId.res.start, '2026-04-01');
  assert.equal(byId.res.end, '2026-04-14');
  assert.equal(byId.res.color, '2');
  assert.equal(byId.res.progress, undefined);

  assert.equal(byId.api.parent, 'plat');
  assert.equal(byId.api.start, '2026-04-14');
  assert.equal(byId.api.end, '2026-05-05');
  assert.equal(byId.api.progress, undefined);

  assert.equal(byId.auth.parent, 'api');
  assert.equal(byId.auth.start, '2026-04-20');
  assert.equal(byId.auth.end, '2026-05-04');

  assert.equal(byId.ui.parent, 'plat');
  assert.equal(byId.ui.start, '2026-05-05');
  assert.equal(byId.ui.end, '2026-06-15');

  assert.equal(byId.beta.kind, 'milestone');
  assert.equal(byId.beta.parent, 'plat');
  assert.equal(byId.beta.start, '2026-06-15');
  assert.equal(byId.beta.end, '2026-06-15');

  assert.deepEqual(data.dependencies, [
    { from: 'res', to: 'api', type: 'fs' },
    { from: 'api', to: 'ui', type: 'fs' },
    { from: 'ui', to: 'beta', type: 'fs' },
    { from: 'api', to: 'auth', type: 'ss' },
  ]);
  assert.deepEqual(data.notes, [
    { id: 'n1', text: 'Interview 12 enterprise buyers across US and APAC.', target: 'res' },
  ]);
});

test('round-trips blank.json and default.json losslessly', () => {
  for (const rel of ['assets/types/gantt/blank.json', 'assets/types/gantt/default.json']) {
    const orig = JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
    const mmd = toMermaid(orig);
    const { data, warnings } = fromMermaid(mmd);
    assert.deepEqual(warnings, [], `${rel} produced warnings: ${warnings.join('; ')}`);
    assert.deepEqual(data, orig, `${rel} did not round-trip identically`);
  }
});

test('supports unlimited nesting, nested groups, custom section IDs, and top-level tasks after sections', () => {
  const input = {
    diagramType: 'gantt',
    schemaVersion: 1,
    title: 'Deep Hierarchy',
    zoom: 'week',
    showNotes: true,
    showToday: false,
    items: [
      { id: 'sec_alpha', kind: 'group', label: 'Program Alpha', collapsed: true },
      { id: 'sub_grp', kind: 'group', label: 'Subgroup', parent: 'sec_alpha', color: '3' },
      { id: 'l1', kind: 'task', label: 'Level 1', parent: 'sub_grp', start: '2026-01-01', end: '2026-03-01' },
      { id: 'l2', kind: 'task', label: 'Level 2', parent: 'l1', start: '2026-01-05', end: '2026-02-15' },
      { id: 'l3', kind: 'task', label: 'Level 3', parent: 'l2', start: '2026-01-10', end: '2026-01-25' },
      { id: 'l4', kind: 'milestone', label: 'Level 4 Gate', parent: 'l3', start: '2026-01-25', end: '2026-01-25' },
      { id: 'orphan', kind: 'task', label: 'Top-level after section', start: '2026-03-01', end: '2026-03-10' },
    ],
    dependencies: [
      { from: 'l3', to: 'l4', type: 'fs' },
      { from: 'l1', to: 'l2', type: 'ss' },
    ],
  };

  const mmd = toMermaid(input);
  const { data, warnings } = fromMermaid(mmd);
  assert.deepEqual(warnings, []);
  assert.deepEqual(data, input);
});

test('UTC calendar date math handles leap years, month/year rollovers, and durations', () => {
  assert.equal(mmdGanttAddDays('2024-02-28', 1), '2024-02-29');
  assert.equal(mmdGanttAddDays('2024-02-28', 2), '2024-03-01');
  assert.equal(mmdGanttAddDays('2026-02-28', 1), '2026-03-01');
  assert.equal(mmdGanttAddDays('2026-12-28', 7), '2027-01-04');
  assert.equal(mmdGanttParseDate('2026-02-29'), null);
  assert.equal(mmdGanttParseDate('2026-04-31'), null);
  assert.equal(mmdGanttFormatDate(mmdGanttParseDate('2026-07-04')), '2026-07-04');

  const mmd = `
gantt
    dateFormat YYYY-MM-DD
    Task A :a, 2026-02-25, 1w
    Task B :b, after a, 10d
    Task C :c, 2026-03-01, 2w
    Task D :d, after b c, 5d
`;
  const { data, warnings } = fromMermaid(mmd);
  assert.deepEqual(warnings, []);
  const byId = Object.fromEntries(data.items.map((it) => [it.id, it]));
  assert.equal(byId.a.end, '2026-03-04');
  assert.equal(byId.b.start, '2026-03-04');
  assert.equal(byId.b.end, '2026-03-14');
  assert.equal(byId.c.end, '2026-03-15');
  assert.equal(byId.d.start, '2026-03-15');
  assert.equal(byId.d.end, '2026-03-20');
  assert.deepEqual(data.dependencies, [
    { from: 'a', to: 'b', type: 'fs' },
    { from: 'b', to: 'd', type: 'fs' },
    { from: 'c', to: 'd', type: 'fs' },
  ]);
});

test('handles tags (done, active, crit, milestone) and silently ignores @progress', () => {
  const mmd = `
gantt
    Done default :done, t1, 2026-05-01, 5d
    Done overridden :done, t2, 2026-05-01, 5d
    %% @progress t2 80
    Critical active :crit, active, t3, 2026-05-06, 1w
    Auto ID task :2026-05-10, 3d
    Gate :milestone, g1, 2026-05-13, 0d
`;
  const { data, warnings } = fromMermaid(mmd);
  assert.deepEqual(warnings, []);
  const byId = Object.fromEntries(data.items.map((it) => [it.id, it]));
  assert.equal(byId.t1.progress, undefined);
  assert.equal(byId.t2.progress, undefined);
  assert.equal(byId.t3.progress, undefined);
  assert.equal(byId.auto_id_task.start, '2026-05-10');
  assert.equal(byId.auto_id_task.end, '2026-05-13');
  assert.equal(byId.g1.kind, 'milestone');
  assert.equal(byId.g1.start, '2026-05-13');
  assert.equal(byId.g1.end, '2026-05-13');
});

test('parses and round-trips FS/SS dependencies without duplicating after refs', () => {
  const mmd = `
gantt
    A :a, 2026-04-01, 2026-04-10
    B :b, after a, 10d
    %% @dep b fs a
    %% @dep b finish-start a
    C :c, 2026-04-05, 2026-04-15
    %% @dep c ss a
`;
  const { data, warnings } = fromMermaid(mmd);
  assert.deepEqual(warnings, []);
  assert.deepEqual(data.dependencies, [
    { from: 'a', to: 'b', type: 'fs' },
    { from: 'a', to: 'c', type: 'ss' },
  ]);
  const rt = fromMermaid(toMermaid(data));
  assert.deepEqual(rt.warnings, []);
  assert.deepEqual(rt.data, data);
});

test('parses and round-trips markers, holidays, excludes, and notes with escapes', () => {
  const mmd = `
---
title: "Front Matter Title"
---
gantt
    dateFormat YYYY-MM-DD
    excludes weekends, 2026-05-01
    %% @holidays VN,US
    %% @holiday 2026-07-04 Independence Day [US]
    %% @holiday 2026-01-28..2026-02-02 Lunar New Year [VN]
    %% @marker Code Freeze : 2026-06-01 #e11d48
    %% @marker GA Launch : 2026-07-01

    Phase: Alpha :p1, 2026-04-01, 2026-06-30
    %% @color p1 #2563eb
    %% @note p1 Line one\\nLine two\\nPath C:\\\\work
`;
  const { data, infos, warnings } = fromMermaid(mmd);
  assert.deepEqual(warnings, []);
  assert.ok(infos.some((s) => s.includes('excludes')));
  assert.equal(data.title, 'Front Matter Title');
  assert.equal(data._holidaysMode, 'VN,US');
  assert.deepEqual(data.holidays, [
    { date: '2026-05-01', end: '2026-05-01', name: 'Excluded' },
    { date: '2026-07-04', end: '2026-07-04', name: 'Independence Day', country: 'US' },
    { date: '2026-01-28', end: '2026-02-02', name: 'Lunar New Year', country: 'VN' },
  ]);
  assert.deepEqual(data.markers, [
    { id: 'm_code_freeze', label: 'Code Freeze', date: '2026-06-01', color: '#e11d48' },
    { id: 'm_ga_launch', label: 'GA Launch', date: '2026-07-01' },
  ]);
  assert.equal(data.items[0].color, '#2563eb');
  assert.equal(data.notes[0].text, 'Line one\nLine two\nPath C:\\work');

  const rt = fromMermaid(toMermaid(data));
  assert.deepEqual(rt.warnings, []);
  assert.deepEqual(rt.data, data);
});

test('handles malformed inputs gracefully with clear errors and warnings', () => {
  assert.throws(() => fromMermaid('flowchart LR\n  A --> B'), /expected "gantt"/);
  assert.throws(() => fromMermaid('   \n  '), /expected "gantt"/);

  const mmd = `
gantt
    %% @zoom decade
    %% @holidays invalid-code
    %% @holiday 2026-02-30 Bad Date
    %% @holiday 2026-05-10..2026-05-01 Reversed Range
    %% @marker Missing Date
    %% @marker Bad Date : 2026-13-01
    Valid task :t1, 2026-04-10, 2026-04-20
    Reversed task :t2, 2026-04-20, 2026-04-10
    Invalid date task :t3, 2026-02-30, 5d
    Bad after task :t4, after ghost, 5d
    Duplicate id :t1, 2026-04-21, 5d
    %% @parent t1 t1
    %% @parent t1 missing_parent
    %% @dep t1 ff t2
    %% @dep t1 fs t1
    %% @dep ghost fs t1
    %% @color t1 notacolor
    %% @collapsed ghost
    %% @note ghost Orphan note
    nonsense line without colon
`;
  const { data, warnings } = fromMermaid(mmd);
  assert.ok(data.items.some((it) => it.id === 't1'));
  assert.ok(warnings.length >= 14, `expected >= 14 warnings, got ${warnings.length}:\n${warnings.join('\n')}`);
  assert.ok(warnings.some((w) => w.includes('@zoom')));
  assert.ok(warnings.some((w) => w.includes('@holidays')));
  assert.ok(warnings.some((w) => w.includes('before start date')));
  assert.ok(warnings.some((w) => w.includes('unknown task "ghost"')));
  assert.ok(warnings.some((w) => w.includes('duplicate id "t1"')));
  assert.ok(warnings.some((w) => w.includes('own parent')));
  assert.ok(warnings.some((w) => w.includes('invalid dependency type')));
  assert.ok(warnings.some((w) => w.includes('self-dependency')));
});

test('warns on empty gantt chart without throwing', () => {
  const { data, warnings } = fromMermaid('gantt\n    title Empty\n');
  assert.equal(data.items.length, 0);
  assert.ok(warnings.some((w) => w.includes('no tasks or milestones')));
});

console.log(`\nGantt Mermaid tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
