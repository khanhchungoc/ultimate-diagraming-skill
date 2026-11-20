// C4 engine check: loads the shared router and assets/types/c4/engine.js the way scripts/run_engine.mjs does and checks the
// Engine contract of dev/plans/plan-c4.md on the fixtures and on a generated 2,000-element landscape.
// Usage: node dev/check_c4_engine.mjs     Exit code 0 when every check passes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const tokens = JSON.parse(readFileSync(at('../assets/tokens/default.json'), 'utf8'));
const src = readFileSync(at('../assets/shell/ortho-router.js'), 'utf8') + '\n' + readFileSync(at('../assets/types/c4/engine.js'), 'utf8');
const { layoutDiagram, routeDiagram } = new Function('TOKENS', `${src}\nreturn { layoutDiagram, routeDiagram };`)(tokens);
const fixture = (n) => JSON.parse(readFileSync(at(`./fixtures/c4/${n}.json`), 'utf8'));
const clone = (d) => JSON.parse(JSON.stringify(d));
const LIMIT_MS = 3000;

let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log(`  FAIL ${msg}`); } };

// A 2,000-element landscape: 40 `system` groups of 50 containers each, 6 people, a fan-out tree of calls inside every group,
// cross-group relations to a few shared platforms (groups 0..3) and a ring of async links; groups collapsed unless told otherwise.
function bigFixture(collapsed) {
  const groups = [], elements = [], relations = [];
  for (let p = 0; p < 6; p++) elements.push({ id: `p${p}`, kind: 'person', name: `Person ${p}` });
  for (let g = 0; g < 40; g++) {
    groups.push({ id: `g${g}`, name: `System ${g}`, kind: 'system', collapsed });
    for (let i = 0; i < 50; i++) {
      elements.push({ id: `g${g}e${i}`, kind: i % 9 === 0 ? 'database' : 'container', name: `Service ${g}-${i}`, tech: 'Node.js', group: `g${g}` });
      if (i) relations.push({ from: `g${g}e${Math.floor((i - 1) / 3)}`, to: `g${g}e${i}`, label: 'Calls', tech: 'REST' });
    }
    relations.push({ from: `p${g % 6}`, to: `g${g}e0`, label: 'Uses' });
    if (g > 3) relations.push({ from: `g${g}e1`, to: `g${g % 4}e2`, label: 'Syncs', async: true });
    if (g > 3 && g % 5 === 0) relations.push({ from: `g${g}e4`, to: `g${(g + 1) % 40}e5`, label: 'Notifies' });
  }
  return { diagramType: 'c4', schemaVersion: 1, title: 'Big', groups, elements, relations };
}

const boxOf = (o) => ({ x: o.x, y: o.y, w: o.w, h: o.h });
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a, g) => a.x >= g.x && a.y >= g.y && a.x + a.w <= g.x + g.w && a.y + a.h <= g.y + g.h;

// Sweep over x: visible tiles (elements and collapsed group tiles) must not overlap.
function noOverlap(d, name) {
  const tiles = d.elements.filter((e) => !e._hidden).map((e) => ({ id: e.id, ...boxOf(e) }))
    .concat(d.groups.filter((g) => g._collapsed && !g._hidden).map((g) => ({ id: g.id, ...boxOf(g) })))
    .sort((a, b) => a.x - b.x);
  let bad = 0;
  for (let i = 0; i < tiles.length && bad < 3; i++) {
    for (let j = i + 1; j < tiles.length && tiles[j].x < tiles[i].x + tiles[i].w; j++) {
      if (overlap(tiles[i], tiles[j])) { bad++; check(false, `${name}: tiles ${tiles[i].id} and ${tiles[j].id} overlap`); }
    }
  }
  check(tiles.every((t) => t.w > 0 && t.h > 0 && Number.isFinite(t.x) && Number.isFinite(t.y)), `${name}: every visible tile has a position and size`);
}

function inGroups(d, name) {
  const gBy = new Map(d.groups.map((g) => [g.id, g]));
  d.elements.forEach((e) => {
    if (e._hidden) { check(e.w === 0 && e.h === 0, `${name}: hidden ${e.id} has no size`); return; }
    for (let g = gBy.get(e.group); g; g = gBy.get(g.parent)) check(inside(e, g), `${name}: ${e.id} inside ${g.id}`);
  });
  d.groups.forEach((g) => {
    if (g._hidden) return;
    for (let p = gBy.get(g.parent); p; p = gBy.get(p.parent)) check(inside(g, p), `${name}: group ${g.id} inside ${p.id}`);
  });
  // sibling frames never overlap one another either
  const byPar = new Map();
  d.groups.filter((g) => !g._hidden).forEach((g) => { const k = g.parent || ''; if (!byPar.has(k)) byPar.set(k, []); byPar.get(k).push(g); });
  byPar.forEach((list) => list.forEach((a, i) => list.slice(i + 1).forEach((b) => check(!overlap(a, b), `${name}: groups ${a.id} and ${b.id} overlap`))));
}

function orthogonal(d, name) {
  (d._edges || []).forEach((e) => {
    const p = e.points;
    check(Array.isArray(p) && p.length >= 2, `${name}: ${e.id} has points`);
    for (let i = 1; i < p.length; i++) check(p[i][0] === p[i - 1][0] || p[i][1] === p[i - 1][1], `${name}: ${e.id} segment ${i} is not axis-aligned`);
    check(typeof e.path === 'string' && e.path.startsWith('M'), `${name}: ${e.id} has a path`);
    check(e.labelBox && e.labelBox.w > 0 && e.labelBox.h > 0, `${name}: ${e.id} has a label box`);
    check(e.count === e.members.length && e.count >= 1, `${name}: ${e.id} count matches members`);
  });
}

// The arrows a diagram should draw, worked out from the relations alone (no engine code).
function expectedEdges(d) {
  const gBy = new Map(d.groups.map((g) => [g.id, g]));
  const elBy = new Map(d.elements.map((e) => [e.id, e]));
  const top = (id) => { let t = null; for (let g = gBy.get(id); g; g = gBy.get(g.parent)) if (g.collapsed === true) t = g.id; return t; };
  const vis = (id) => { const e = elBy.get(id); return (e.group && top(e.group)) || id; };
  const pairs = new Map();
  d.relations.forEach((r, i) => {
    const a = vis(r.from), b = vis(r.to);
    if (a === b) return;
    const k = `${a}>${b}`;
    if (!pairs.has(k)) pairs.set(k, []);
    pairs.get(k).push(i);
  });
  return pairs;
}

function hiddenAndAgg(d, name) {
  d.elements.forEach((e) => {
    const collapsed = (g) => { for (let x = d.groups.find((q) => q.id === g); x; x = d.groups.find((q) => q.id === x.parent)) if (x.collapsed === true) return true; return false; };
    check(e._hidden === !!(e.group && collapsed(e.group)), `${name}: ${e.id} _hidden`);
  });
  const want = expectedEdges(d), got = new Map();
  (d._edges || []).forEach((e) => {
    check(!(d.elements.find((x) => x.id === e.from) || {})._hidden && !(d.elements.find((x) => x.id === e.to) || {})._hidden, `${name}: ${e.id} ends are visible`);
    const k = `${e.from}>${e.to}`;
    got.set(k, (got.get(k) || 0) + e.count);
  });
  want.forEach((idx, k) => check(got.get(k) === idx.length, `${name}: arrow ${k} count ${got.get(k)} (want ${idx.length})`));
  got.forEach((c, k) => check(want.has(k), `${name}: unexpected arrow ${k}`));
}

function run(name, d) {
  const t0 = performance.now();
  layoutDiagram(d);
  const ms = performance.now() - t0;
  noOverlap(d, name); inGroups(d, name); orthogonal(d, name); hiddenAndAgg(d, name);
  check(d.canvas && d.canvas.width > 0 && d.canvas.height > 0, `${name}: canvas`);
  const visible = d.elements.filter((e) => !e._hidden).length;
  console.log(`${name}: ${visible}/${d.elements.length} elements visible, ${d._edges.length} arrows, canvas ${d.canvas.width}x${d.canvas.height}, ${d._dir}, ${ms.toFixed(0)} ms`);
  return ms;
}

const stable = (d) => JSON.stringify(d);
const withCollapsed = (d, id, v) => { const c = clone(d); c.groups.find((g) => g.id === id).collapsed = v; return c; };

// ---- landscape: expanded and collapsed
const land = fixture('landscape');
run('landscape (expanded)', clone(land));
const landC = withCollapsed(land, 'platform', true);
run('landscape (platform collapsed)', clone(landC));
{
  const d = clone(landC);
  layoutDiagram(d);
  const a = d._edges.find((e) => e.from === 'platform' && e.to === 'crm') || d._edges.find((e) => e.from === 'platform');
  check(d.elements.filter((e) => e.group === 'platform').every((e) => e._hidden), 'landscape: platform children hidden');
  check(d.groups.find((g) => g.id === 'platform')._collapsed === true && d.groups.find((g) => g.id === 'platform').w > 0, 'landscape: platform draws as one tile');
  check(a && a.count >= 1, 'landscape: aggregated arrow from platform exists');
  // web -> api and api -> orddb live inside the collapsed group: not drawn
  check(!d._edges.some((e) => e.members.some((i) => ['web', 'api', 'orddb'].includes(d.relations[i].from) && ['web', 'api', 'orddb'].includes(d.relations[i].to))), 'landscape: relation inside a collapsed group is not drawn');
  const out = d._edges.filter((e) => e.from === 'platform' && e.to === 'pay');
  check(out.length === 1 && out[0].count === 1, 'landscape: platform -> pay is one arrow');
  // cust -> web becomes cust -> platform; support -> crm stays
  check(d._edges.some((e) => e.from === 'cust' && e.to === 'platform'), 'landscape: cust -> platform');
}
// Two relations between the same visible pair merge with a count: collapse both groups of a made-up diagram.
{
  const d = { diagramType: 'c4', groups: [{ id: 's', name: 'S', kind: 'system', collapsed: true }, { id: 't', name: 'T', kind: 'system', collapsed: true }],
    elements: [{ id: 'a', kind: 'container', name: 'A', group: 's' }, { id: 'b', kind: 'container', name: 'B', group: 's' }, { id: 'c', kind: 'container', name: 'C', group: 't' }, { id: 'x', kind: 'container', name: 'X', group: 't' }],
    relations: [{ from: 'a', to: 'c', label: 'One' }, { from: 'b', to: 'x', label: 'Two' }, { from: 'a', to: 'b', label: 'Inside' }, { from: 'c', to: 'a', label: 'Back' }] };
  layoutDiagram(d);
  const e = d._edges.find((q) => q.from === 's' && q.to === 't');
  check(d._edges.length === 2 && e && e.count === 2 && e.label === 'One' && e.members.join() === '0,1', 'two collapsed groups: 2 relations merge (count 2, first label), inside one dropped, reverse kept apart');
}

// ---- components (system > container > component: any depth)
const comp = fixture('components');
run('components (expanded)', clone(comp));
const compC = withCollapsed(comp, 'apiapp', true);
run('components (apiapp collapsed)', clone(compC));
{
  const d = withCollapsed(comp, 'platform', true);
  layoutDiagram(d);
  check(d.groups.find((g) => g.id === 'apiapp')._hidden === true && d.groups.find((g) => g.id === 'apiapp')._depth === 2, 'components: nested group hidden and depth 2');
  check(d.elements.find((e) => e.id === 'ctrl')._hidden === true, 'components: component hidden under a collapsed system');
}

// ---- deterministic, and routeDiagram keeps positions
for (const [name, d0] of [['landscape', land], ['landscape collapsed', landC], ['components', comp]]) {
  const a = clone(d0), b = clone(d0);
  layoutDiagram(a); layoutDiagram(b);
  check(stable(a) === stable(b), `${name}: two layouts are byte-equal`);
  const before = a.elements.concat(a.groups).map((o) => [o.x, o.y]);
  const r = clone(a);
  delete r._edges; delete r.canvas;
  routeDiagram(r);
  const after = r.elements.concat(r.groups).map((o) => [o.x, o.y]);
  check(JSON.stringify(before) === JSON.stringify(after), `${name}: routeDiagram keeps every x, y`);
  check(stable(r) === stable(a), `${name}: routeDiagram on a laid-out diagram changes nothing`);
  // a saved diagram (positions only, as the disk layout map) routes to the same picture
  const saved = clone(d0);
  a.elements.concat(a.groups).forEach((o) => { const t = (saved.elements.concat(saved.groups)).find((q) => q.id === o.id); t.x = o.x; t.y = o.y; });
  routeDiagram(saved);
  noOverlap(saved, `${name} (saved)`); inGroups(saved, `${name} (saved)`); orthogonal(saved, `${name} (saved)`);
  check(JSON.stringify(saved._edges.map((e) => e.points)) === JSON.stringify(a._edges.map((e) => e.points)), `${name}: saved positions route like the layout`);
}

// ---- expanding one group keeps positions outside it (shifted as one block, never changed relative to each other)
{
  const a = clone(landC);
  layoutDiagram(a);
  const b = clone(a);
  b.groups.find((g) => g.id === 'platform').collapsed = false;
  routeDiagram(b);
  noOverlap(b, 'expand'); inGroups(b, 'expand'); orthogonal(b, 'expand');
  const inPlat = new Set(['web', 'api', 'orddb']);
  const outside = a.elements.filter((e) => !inPlat.has(e.id));
  const dx = new Set(), dy = new Set();
  outside.forEach((e) => { const n = b.elements.find((q) => q.id === e.id); dx.add(n.x - e.x); dy.add(n.y - e.y); });
  // every outside item either stays or moves by one of two block offsets (right of it, below it)
  check(dx.size <= 2 && dy.size <= 2, `expand: outside items shift as blocks (dx ${[...dx]}, dy ${[...dy]})`);
  check(b.elements.filter((e) => inPlat.has(e.id)).every((e) => !e._hidden && e.w > 0), 'expand: children visible');
  const col = clone(b);
  col.groups.find((g) => g.id === 'platform').collapsed = true;
  routeDiagram(col);
  noOverlap(col, 'collapse again'); inGroups(col, 'collapse again');
  check(col.elements.filter((e) => !inPlat.has(e.id)).every((e) => { const n = b.elements.find((q) => q.id === e.id); return n.x === e.x && n.y === e.y; }), 'collapse: outside items stay');
}

// ---- large landscape
let worst = 0;
{
  const d = bigFixture(true);
  worst = Math.max(worst, run('big 2000 elements, 40 groups collapsed', d));
  check(d._edges.length > 40, 'big: arrows drawn');
  const again = bigFixture(true);
  layoutDiagram(again);
  check(stable(d) === stable(again), 'big: two layouts are byte-equal');
  const t0 = performance.now();
  const r = clone(d);
  routeDiagram(r);
  console.log(`big: routeDiagram ${(performance.now() - t0).toFixed(0)} ms`);
  check(stable(r) === stable(d), 'big: routeDiagram on the laid-out diagram changes nothing');
  const one = clone(d);
  one.groups[7].collapsed = false;
  const t1 = performance.now();
  routeDiagram(one);
  const ms1 = performance.now() - t1;
  console.log(`big: expand one group (routeDiagram, 6 + 39 tiles + 50 children visible, router included) ${ms1.toFixed(0)} ms (not gated: the shared router is quadratic in arrows)`);
  noOverlap(one, 'big expand one'); inGroups(one, 'big expand one'); orthogonal(one, 'big expand one');
  check(one.elements.filter((e) => e.group === 'g7').every((e) => !e._hidden), 'big: expanded group shows its children');
}
{
  // Placement and frames alone with all 2,000 elements visible (the router is replaced by a stub: it is quadratic in the arrows
  // it routes, which is why a landscape this size opens collapsed; see the plan's scale budget).
  const stub = new Function('TOKENS', `function routeEdgesOrthogonal() { return {}; }\n${src.slice(src.indexOf('// C4 layout engine'))}\nreturn { layoutDiagram };`)(tokens);
  const d = bigFixture(false);
  const t0 = performance.now();
  stub.layoutDiagram(d);
  const ms = performance.now() - t0;
  console.log(`big, all 2000 expanded, placement only (no router): ${ms.toFixed(0)} ms, canvas ${d.canvas.width}x${d.canvas.height}`);
  worst = Math.max(worst, ms);
  noOverlap(d, 'big expanded'); inGroups(d, 'big expanded');
}
check(worst < LIMIT_MS, `large fixture under ${LIMIT_MS} ms (worst ${worst.toFixed(0)} ms)`);

console.log(failures ? `\n${failures} check(s) failed` : '\nall c4 engine checks passed');
process.exit(failures ? 1 : 0);
