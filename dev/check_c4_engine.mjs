// C4 engine check: loads the shared router, assets/types/c4/route.js (when it exists) and assets/types/c4/engine.js the way
// scripts/run_engine.mjs does and checks the Engine contract and the Layout of dev/plans/plan-c4.md on every dev/fixtures/c4/*.json
// and on a generated 2,000-element landscape. Usage: node dev/check_c4_engine.mjs     Exit code 0 when every check passes.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const tokens = JSON.parse(readFileSync(at('../assets/tokens/default.json'), 'utf8'));
const read = (p) => readFileSync(at(p), 'utf8');
const hasRoute = existsSync(at('../assets/types/c4/route.js'));
const routerSrc = read('../assets/shell/ortho-router.js'), engineSrc = read('../assets/types/c4/engine.js');
const make = (routeSrc) => new Function('TOKENS', `${routerSrc}\n${routeSrc}\n${engineSrc}\nreturn { layoutDiagram, routeDiagram };`)(tokens);
const { layoutDiagram, routeDiagram } = make(hasRoute ? read('../assets/types/c4/route.js') : '');
const fixture = (n) => JSON.parse(read(`./fixtures/c4/${n}.json`));
const clone = (d) => JSON.parse(JSON.stringify(d));
const LIMIT_MS = 3000;
if (!hasRoute) console.log('note: assets/types/c4/route.js is missing; arrows use the engine fallback and the arrow-vs-box checks are skipped');

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

// Sweep over x: visible boxes (elements, collapsed tiles) and frames (expanded groups) must not overlap, except a frame with what it holds.
function noOverlap(d, name) {
  const gBy = new Map(d.groups.map((g) => [g.id, g]));
  const anc = (o) => { const s = new Set(); for (let g = gBy.get(o.group || o.parent); g; g = gBy.get(g.parent)) s.add(g.id); return s; };
  const rects = d.elements.filter((e) => !e._hidden).map((e) => ({ id: e.id, anc: anc(e), ...boxOf(e) }))
    .concat(d.groups.filter((g) => !g._hidden).map((g) => ({ id: g.id, anc: anc(g), ...boxOf(g) })))
    .sort((a, b) => a.x - b.x);
  let bad = 0;
  for (let i = 0; i < rects.length && bad < 3; i++) {
    for (let j = i + 1; j < rects.length && rects[j].x < rects[i].x + rects[i].w; j++) {
      if (rects[i].anc.has(rects[j].id) || rects[j].anc.has(rects[i].id)) continue;
      if (overlap(rects[i], rects[j])) { bad++; check(false, `${name}: ${rects[i].id} and ${rects[j].id} overlap`); }
    }
  }
  check(rects.every((t) => t.w > 0 && t.h > 0 && Number.isFinite(t.x) && Number.isFinite(t.y)), `${name}: every visible box and frame has a position and size`);
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
  check(['surround', 'flow', 'layers'].includes(d._arrange), `${name}: _arrange is set`);
  d.elements.forEach((e) => check(e._hidden ? !('_ring' in e) : Number.isInteger(e._ring) && e._ring >= 0, `${name}: ${e.id} _ring`));
  d.groups.forEach((g) => check(Number.isInteger(g._depth) && typeof g._collapsed === 'boolean', `${name}: ${g.id} _depth and _collapsed`));
  const visible = d.elements.filter((e) => !e._hidden).length;
  console.log(`${name}: ${visible}/${d.elements.length} elements visible, ${d._edges.length} arrows, ${d._arrange}, canvas ${d.canvas.width}x${d.canvas.height}, ${ms.toFixed(0)} ms`);
  return ms;
}

const stable = (d) => JSON.stringify(d);
const withCollapsed = (d, id, v) => { const c = clone(d); c.groups.find((g) => g.id === id).collapsed = v; return c; };
const elOf = (d, id) => d.elements.find((e) => e.id === id);
const segHits = (p, q, b) => { // an axis-aligned segment through the inside of box b (1 px clear)
  const x0 = Math.min(p[0], q[0]), x1 = Math.max(p[0], q[0]), y0 = Math.min(p[1], q[1]), y1 = Math.max(p[1], q[1]);
  return x1 > b.x + 1 && x0 < b.x + b.w - 1 && y1 > b.y + 1 && y0 < b.y + b.h - 1;
};

// ---- the layouts: every fixture that exists, with the rings it must give (element id -> ring)
const FIXTURES = {
  'one-centre': { arrange: 'surround', rings: { core: 0, cust: 1, agent: 1, wh: 1, erp: 1, pay: 1, idp: 1, ship: 1, mail: 1, cards: 2 } },
  'group-centre': { arrange: 'surround', rings: { core: 0, erp: 0, crm: 0, cust: 1, agent: 1, wh: 1, pay: 1, idp: 1, ship: 1, mail: 1, cards: 2 } },
  'two-centres': { arrange: 'surround', rings: { core: 0, portal: 0, cust: 1, agent: 1, wh: 1, pay: 1, idp: 1, ship: 1, mail: 1, cards: 2 } },
  'four-centres': { arrange: 'surround', rings: { core: 0, portal: 0, erp: 0, crm: 0, cust: 1, agent: 1, wh: 1, pay: 1, ship: 1, mail: 1, cards: 2 } },
  'no-centre': { arrange: 'flow', rings: { web: 0, app: 0, gw: 1, orders: 2, catalog: 2, bill: 3, inv: 3, notif: 3, supp: 4, smtp: 4 } },
  layers: { arrange: 'layers', rings: { web: 0, app: 0, catalog: 1, orders: 1, bill: 1, inv: 2, notif: 2, supp: 3, smtp: 3 } },
  'inner-links': { arrange: 'surround', rings: { gw: 0, orders: 0, bus: 0, worker: 0, ui: 1, bff: 1, pay: 1, cart: 2, pricing: 2, tax: 2, cust: 2 } },
  landscape: { arrange: 'surround', rings: { web: 0, api: 0, orddb: 0, crm: 0, cust: 1, support: 1, pay: 1, mail: 1 } }
};

// Which sides of a centre box face open space: no other centre box beyond it in that direction (worked out from the boxes alone).
function exposedSides(b, centre) {
  const e = { N: true, S: true, E: true, W: true };
  centre.forEach((o) => {
    if (o === b) return;
    const ox = b.x < o.x + o.w && o.x < b.x + b.w, oy = b.y < o.y + o.h && o.y < b.y + b.h;
    if (ox && o.y + o.h <= b.y) e.N = false;
    if (ox && o.y >= b.y + b.h) e.S = false;
    if (oy && o.x + o.w <= b.x) e.W = false;
    if (oy && o.x >= b.x + b.w) e.E = false;
  });
  return e;
}

function layoutChecks(name, d, spec) {
  check(d._arrange === spec.arrange, `${name}: arrange is ${d._arrange} (want ${spec.arrange})`);
  Object.entries(spec.rings).forEach(([id, r]) => check(elOf(d, id)._ring === r, `${name}: ring of ${id} is ${elOf(d, id)._ring} (want ${r})`));
  const byEl = (id) => elOf(d, id);
  if (spec.arrange === 'surround') {
    // exposure rule: a ring-1 item sits on a side every linked centre box exposes (unless the author set `side`)
    const centre = d.elements.filter((e) => e._ring === 0 && !e._hidden).map(boxOf);
    const box = (e) => centre.find((c) => c.x === e.x && c.y === e.y);
    d.elements.filter((e) => e._ring === 1 && !e._hidden).forEach((e) => {
      const hinted = e.side || (d.groups.find((g) => g.id === e.group) || {}).side;
      const linked = d.relations.filter((r) => (r.from === e.id && byEl(r.to)._ring === 0) || (r.to === e.id && byEl(r.from)._ring === 0))
        .map((r) => byEl(r.from === e.id ? r.to : r.from));
      let ok = null;
      linked.forEach((c) => { const x = exposedSides(box(c), centre); ok = (ok || ['N', 'S', 'E', 'W']).filter((k) => x[k]); });
      if (!hinted && ok && ok.length) check(ok.includes(e._side), `${name}: ${e.id} is on side ${e._side}, linked centre boxes only expose ${ok}`);
      if (hinted) check(e._side === hinted, `${name}: ${e.id} keeps its side hint ${hinted}`);
    });
    // people go on top when that side is open
    d.elements.filter((e) => e._ring === 1 && e.kind === 'person' && !e.side).forEach((e) => check(e._side === 'N', `${name}: person ${e.id} is on top`));
    check(d.elements.filter((e) => e._ring === 0).every((e) => e._side === undefined), `${name}: a centre item has no side`);
  }
  if (spec.arrange === 'flow' || spec.arrange === 'layers') {
    d.elements.filter((e) => e._ring > 0).forEach((e) => check(e._side === 'S', `${name}: ${e.id} is below`));
    // every ring lies below the one before it
    const bottom = {}, top = {};
    d.elements.forEach((e) => { bottom[e._ring] = Math.max(bottom[e._ring] || 0, e.y + e.h); top[e._ring] = Math.min(top[e._ring] ?? Infinity, e.y); });
    Object.keys(top).forEach((r) => { if (+r > 0) check(top[r] >= bottom[r - 1], `${name}: ring ${r} lies below ring ${r - 1}`); });
  }
  if (spec.arrange === 'layers') {
    const bands = d.groups.filter((g) => !g.parent);
    check(bands.every((g) => g.x === bands[0].x && g.w === bands[0].w), `${name}: every band has the same x and width`);
    bands.forEach((g, i) => { if (i) check(g.y >= bands[i - 1].y + bands[i - 1].h, `${name}: band ${g.id} is below ${bands[i - 1].id}`); });
    check(bands.some((g) => d.elements.filter((e) => e.group === g.id).length < 3) && new Set(bands.map((g) => d.elements.filter((e) => e.group === g.id).length)).size > 1, `${name}: bands hold different numbers of elements but are equally wide`);
  }
  // arrows against boxes (needs the real gutter routing): a link inside one group never passes through a sibling (inner flow)
  if (hasRoute) {
    d.relations.forEach((r, i) => {
      const a = byEl(r.from), b = byEl(r.to);
      if (!a.group || a.group !== b.group || a._hidden) return;
      const e = d._edges.find((q) => q.members.includes(i));
      const sib = d.elements.filter((o) => o.group === a.group && o !== a && o !== b && !o._hidden);
      check(e && !e.points.some((p, k) => k && sib.some((o) => segHits(e.points[k - 1], p, boxOf(o)))), `${name}: link ${r.from} -> ${r.to} passes through a sibling`);
    });
  }
}

// ---- every fixture that exists
const ran = [];
for (const [n, spec] of Object.entries(FIXTURES)) {
  if (!existsSync(at(`./fixtures/c4/${n}.json`))) { console.log(`note: dev/fixtures/c4/${n}.json is missing, skipped`); continue; }
  const d0 = fixture(n), d = clone(d0);
  run(n, d);
  layoutChecks(n, d, spec);
  // determinism, and routeDiagram keeps positions and gives the same picture
  const b = clone(d0);
  layoutDiagram(b);
  check(stable(d) === stable(b), `${n}: two layouts are byte-equal`);
  const before = d.elements.concat(d.groups).map((o) => [o.x, o.y, o.w, o.h]);
  const r = clone(d);
  delete r._edges; delete r.canvas;
  routeDiagram(r);
  check(JSON.stringify(r.elements.concat(r.groups).map((o) => [o.x, o.y, o.w, o.h])) === JSON.stringify(before), `${n}: routeDiagram keeps every x, y, w, h`);
  check(stable(r) === stable(d), `${n}: routeDiagram on a laid-out diagram changes nothing`);
  const saved = clone(d0);
  d.elements.concat(d.groups).forEach((o) => { const t = saved.elements.concat(saved.groups).find((q) => q.id === o.id); t.x = o.x; t.y = o.y; });
  routeDiagram(saved);
  noOverlap(saved, `${n} (saved)`); inGroups(saved, `${n} (saved)`); orthogonal(saved, `${n} (saved)`);
  check(JSON.stringify(saved._edges.map((e) => e.points)) === JSON.stringify(d._edges.map((e) => e.points)), `${n}: saved positions route like the layout`);
  ran.push(n);
}
{
  // an explicit `arrange` wins over the default; surround without any core falls back to flow
  const d = fixture('landscape'); d.arrange = 'flow';
  layoutDiagram(d);
  check(d._arrange === 'flow' && d.elements.find((e) => e.id === 'cust')._ring === 0 && d.elements.every((e) => e._ring === 0 || e._side === 'S'), 'arrange: flow on a diagram with a core flag');
  const e = fixture('landscape'); e.arrange = 'surround'; e.groups.forEach((g) => { delete g.core; });
  layoutDiagram(e);
  check(e._arrange === 'flow', 'arrange: surround with no core is laid out as flow');
}

// ---- landscape: collapsed groups, aggregation
const land = fixture('landscape');
run('landscape (expanded)', clone(land));
const landC = withCollapsed(land, 'platform', true);
run('landscape (platform collapsed)', clone(landC));
{
  const d = clone(landC);
  layoutDiagram(d);
  const a = d._edges.find((e) => e.from === 'platform' && e.to === 'crm') || d._edges.find((e) => e.from === 'platform');
  check(d.elements.filter((e) => e.group === 'platform').every((e) => e._hidden && !('_ring' in e) && e.w === 0), 'landscape: platform children hidden, no ring');
  check(d.groups.find((g) => g.id === 'platform')._collapsed === true && d.groups.find((g) => g.id === 'platform').w > 0, 'landscape: platform draws as one tile');
  check(d.groups.find((g) => g.id === 'platform').w === 156 && d.groups.find((g) => g.id === 'platform').h === 112, 'landscape: the tile is one card');
  check(a && a.count >= 1, 'landscape: aggregated arrow from platform exists');
  check(!d._edges.some((e) => e.members.some((i) => ['web', 'api', 'orddb'].includes(d.relations[i].from) && ['web', 'api', 'orddb'].includes(d.relations[i].to))), 'landscape: relation inside a collapsed group is not drawn');
  const out = d._edges.filter((e) => e.from === 'platform' && e.to === 'pay');
  check(out.length === 1 && out[0].count === 1, 'landscape: platform -> pay is one arrow');
  check(d._edges.some((e) => e.from === 'cust' && e.to === 'platform'), 'landscape: cust -> platform');
}
{
  const d = { diagramType: 'c4', groups: [{ id: 's', name: 'S', kind: 'system', collapsed: true }, { id: 't', name: 'T', kind: 'system', collapsed: true }],
    elements: [{ id: 'a', kind: 'container', name: 'A', group: 's' }, { id: 'b', kind: 'container', name: 'B', group: 's' }, { id: 'c', kind: 'container', name: 'C', group: 't' }, { id: 'x', kind: 'container', name: 'X', group: 't' }],
    relations: [{ from: 'a', to: 'c', label: 'One' }, { from: 'b', to: 'x', label: 'Two' }, { from: 'a', to: 'b', label: 'Inside' }, { from: 'c', to: 'a', label: 'Back' }] };
  layoutDiagram(d);
  const e = d._edges.find((q) => q.from === 's' && q.to === 't');
  check(d._edges.length === 2 && e && e.count === 2 && e.label === 'One' && e.members.join() === '0,1', 'two collapsed groups: 2 relations merge (count 2, first label), inside one dropped, reverse kept apart');
}

// ---- components (system > container > component: any depth)
const comp = fixture('level3/components');
run('components (expanded)', clone(comp));
run('components (apiapp collapsed)', clone(withCollapsed(comp, 'apiapp', true)));
{
  const d = withCollapsed(comp, 'platform', true);
  layoutDiagram(d);
  check(d.groups.find((g) => g.id === 'apiapp')._hidden === true && d.groups.find((g) => g.id === 'apiapp')._depth === 2, 'components: nested group hidden and depth 2');
  check(d.elements.find((e) => e.id === 'ctrl')._hidden === true, 'components: component hidden under a collapsed system');
}

// ---- deterministic, routeDiagram keeps positions (landscape variants and components)
for (const [name, d0] of [['landscape collapsed', landC], ['components', comp]]) {
  const a = clone(d0), b = clone(d0);
  layoutDiagram(a); layoutDiagram(b);
  check(stable(a) === stable(b), `${name}: two layouts are byte-equal`);
  const r = clone(a);
  delete r._edges; delete r.canvas;
  routeDiagram(r);
  check(stable(r) === stable(a), `${name}: routeDiagram on a laid-out diagram changes nothing`);
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
  const dx = new Set(), dy = new Set();
  a.elements.filter((e) => !inPlat.has(e.id)).forEach((e) => { const n = b.elements.find((q) => q.id === e.id); dx.add(n.x - e.x); dy.add(n.y - e.y); });
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
  console.log(`big: expand one group (routeDiagram, 50 children visible, router included) ${(performance.now() - t1).toFixed(0)} ms`);
  noOverlap(one, 'big expand one'); inGroups(one, 'big expand one'); orthogonal(one, 'big expand one');
  check(one.elements.filter((e) => e.group === 'g7').every((e) => !e._hidden), 'big: expanded group shows its children');
}
{
  // Placement and frames alone with all 2,000 elements visible (the router is a stub: a landscape this size opens collapsed, so its
  // arrows are not drawn all at once; see the plan's scale budget).
  const stub = make('function routeC4Edges(nodes, edges) { return edges.map((e) => ({ d: "M0 0", points: [[0, 0], [0, 1]], lx: 0, ly: 0, w: 48 })); }');
  const d = bigFixture(false);
  const t0 = performance.now();
  stub.layoutDiagram(d);
  const ms = performance.now() - t0;
  console.log(`big, all 2000 expanded, placement only (stub router): ${ms.toFixed(0)} ms`);
  worst = Math.max(worst, ms);
  noOverlap(d, 'big expanded'); inGroups(d, 'big expanded');
}
check(worst < LIMIT_MS, `large fixture under ${LIMIT_MS} ms (worst ${worst.toFixed(0)} ms)`);

console.log(failures ? `\n${failures} check(s) failed` : `\nall c4 engine checks passed (${ran.length} fixtures)`);
process.exit(failures ? 1 : 0);
