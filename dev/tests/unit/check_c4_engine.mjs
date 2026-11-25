// C4 engine check: loads the shared router, assets/types/c4/route.js (when it exists) and assets/types/c4/engine.js the way
// scripts/run_engine.mjs does and checks the Engine contract and the Layout of dev/plans/plan-c4.md on every dev/tests/fixtures/c4/*.json
// and on a generated 2,000-element landscape. Usage: node dev/check_c4_engine.mjs     Exit code 0 when every check passes.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const tokens = JSON.parse(readFileSync(at('../../../assets/tokens/default.json'), 'utf8'));
const read = (p) => readFileSync(at(p), 'utf8');
const hasRoute = existsSync(at('../../../assets/types/c4/route.js'));
const routerSrc = read('../../../assets/shell/ortho-router.js'), engineSrc = read('../../../assets/types/c4/engine.js');
const make = (routeSrc) => new Function('TOKENS', `${routerSrc}\n${routeSrc}\n${engineSrc}\nreturn { layoutDiagram, routeDiagram };`)(tokens);
const routeSrc = hasRoute ? read('../../../assets/types/c4/route.js') : '';
const { layoutDiagram, routeDiagram } = make(routeSrc);
// the router with every call recorded: the edges the engine hands it (the last call of a layout is the one drawn)
const spy = () => new Function('TOKENS', `const calls = [];\n${routerSrc}\n${routeSrc.replace('function routeC4Edges(', 'function realRoute(')}\n${engineSrc}\n` +
  `function routeC4Edges(n, e, o) { calls.push(e); return ${hasRoute ? 'realRoute(n, e, o)' : 'c4Fallback(n, e)'}; }\nreturn { layoutDiagram, routeDiagram, calls };`)(tokens);
const newRouter = hasRoute && routeSrc.includes('itemA');
const fixture = (n) => JSON.parse(read(`../fixtures/c4/${n}.json`));
const clone = (d) => JSON.parse(JSON.stringify(d));
const LIMIT_MS = 3000;
if (hasRoute && !newRouter) console.log('note: assets/types/c4/route.js does not take itemA/itemB yet; the arrow-vs-box check on all fixtures is skipped');
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

const stable = (d) => JSON.stringify(d, (k, v) => (k === '_manual' ? undefined : v));   // _manual only tells the mode
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
  if (!existsSync(at(`../fixtures/c4/${n}.json`))) { console.log(`note: dev/tests/fixtures/c4/${n}.json is missing, skipped`); continue; }
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
{
  const shop = JSON.parse(readFileSync(at('../../examples/example-c4.json'), 'utf8'));
  layoutDiagram(shop);
  const byId = (id) => shop.elements.find((e) => e.id === id) || shop.groups.find((g) => g.id === id);
  const cx = (o) => o.x + o.w / 2, cy = (o) => o.y + o.h / 2;
  const sup = byId('support'), cust = byId('cust'), ops = byId('ops');
  const g1 = cust.x - (sup.x + sup.w), g2 = ops.x - (cust.x + cust.w);
  check(Math.abs(g1 - g2) <= 1, 'example-c4: top people row keeps even spacing');
  const supEdge = shop._edges.find((e) => e.from === 'support' && e.to === 'crm');
  check(supEdge && supEdge.points.length === 2 && supEdge.points[0][0] === supEdge.points[1][0], 'example-c4: Support agent -> CRM is a straight vertical line');
  check(Math.abs(cx(byId('pay')) - cx(byId('third'))) <= 1, 'example-c4: Third-party services cards are centered inside their frame');
  check(cy(byId('third')) > cy(byId('shopco')), 'example-c4: Third-party services shifts down to align with its callers');
  check(shop._edges.every((e) => !e.labelBox || e.labelBox.w <= 140), 'example-c4: every edge label fits within 140px max width');
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

// ---- itemA / itemB, hints, member order, arrows against boxes, canvas
// Independent of the engine: the chain of a node (itself, then its groups outward) from the plain data.
const chainOf = (d, id) => {
  const gBy = new Map(d.groups.map((g) => [g.id, g])), out = [id];
  for (let g = gBy.get((elOf(d, id) || {}).group); g; g = gBy.get(g.parent)) out.push(g.id);
  return out;
};
const nodeBox = (d, id) => { const o = elOf(d, id) || d.groups.find((g) => g.id === id); return boxOf(o); };
const ctrBox = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2, w: b.w, h: b.h });

function itemChecks(name, spec) {
  const s = spy(), d = fixture(name);
  s.layoutDiagram(d);
  const calls = s.calls[s.calls.length - 1];
  check(calls.length === d._edges.length, `${name}: router gets one edge per arrow`);
  const seen = {};
  let shift = null;
  calls.forEach((e) => {
    const ca = chainOf(d, e.from).reverse(), cb = chainOf(d, e.to).reverse();   // outermost first
    let k = 0;
    while (k < ca.length - 1 && k < cb.length - 1 && ca[k] === cb[k]) k++;
    const A = ca[k], B = cb[k];
    check(e.itemA && e.itemB && e.itemA.id === A && e.itemB.id === B, `${name}: ${e.from} -> ${e.to} items are ${A}, ${B} (got ${e.itemA && e.itemA.id}, ${e.itemB && e.itemB.id})`);
    if (e.itemA && e.itemB) {
      const bA = ctrBox(nodeBox(d, A)), bB = ctrBox(nodeBox(d, B));
      if (!shift) shift = [bA.x - e.itemA.x, bA.y - e.itemA.y];
      const [dx, dy] = shift;
      check(e.itemA.w === bA.w && e.itemA.h === bA.h && Math.abs((bA.x - e.itemA.x) - dx) < 0.01 && Math.abs((bA.y - e.itemA.y) - dy) < 0.01, `${name}: ${e.from} -> ${e.to} itemA box`);
      check(e.itemB.w === bB.w && e.itemB.h === bB.h && Math.abs((bB.x - e.itemB.x) - dx) < 0.01 && Math.abs((bB.y - e.itemB.y) - dy) < 0.01, `${name}: ${e.from} -> ${e.to} itemB box`);
    }
    seen[`${e.from}>${e.to}`] = e;
  });
  Object.entries(spec).forEach(([k, [a, b, hint]]) => {
    const e = seen[k];
    check(e && e.itemA.id === a && e.itemB.id === b, `${name}: ${k} items ${a}, ${b}`);
    if (hint !== undefined) check(e && e.hint === hint, `${name}: ${k} hint ${hint} (got ${e && e.hint})`);
  });
  return d;
}
// nested (landscape): shopco > platform > api; an arrow from inside a group to a sibling of the group; two siblings inside a group
itemChecks('landscape', {
  'api>crm': ['platform', 'crm', undefined], 'cust>web': ['cust', 'shopco', undefined], 'api>pay': ['shopco', 'third', undefined],
  'web>api': ['web', 'api', 'u'], 'api>orddb': ['api', 'orddb', 'h']
});
itemChecks('inner-links', { 'ui>bff': ['ui', 'bff', 'v'], 'gw>orders': ['gw', 'orders', 'h'], 'bff>cart': ['front', 'checkout', undefined], 'bff>gw': ['front', 'platform', undefined] });

// Member order: a member linked to something entirely beyond one end of its group is the end member there (when it is the only one).
function orderChecks(name, d, minHits) {
  const gBy = new Map(d.groups.map((g) => [g.id, g]));
  const inside = (id, gid) => chainOf(d, id).includes(gid) || (gBy.get(id) && (() => { for (let g = gBy.get(id); g; g = gBy.get(g.parent)) if (g.id === gid) return true; return false; })());
  let hits = 0;
  d.groups.filter((g) => !g._hidden && !g._collapsed).forEach((g) => {
    const kids = d.elements.filter((e) => e.group === g.id).map((e) => e.id).concat(d.groups.filter((q) => q.parent === g.id).map((q) => q.id));
    if (kids.length < 2) return;
    const boxes = kids.map((k) => nodeBox(d, k));
    const row = boxes.every((b) => boxes.every((c) => b.y < c.y + c.h && c.y < b.y + b.h)), col = boxes.every((b) => boxes.every((c) => b.x < c.x + c.w && c.x < b.x + b.w));
    if (!row && !col) return;
    const lo = (b) => (row ? b.x : b.y), hi = (b) => (row ? b.x + b.w : b.y + b.h), G = boxOf(g);
    const reach = kids.map((k) => ({ before: false, after: false }));
    d.relations.forEach((r) => {
      [[r.from, r.to], [r.to, r.from]].forEach(([me, other]) => {
        const i = kids.findIndex((k) => inside(me, k));
        if (i < 0 || inside(other, g.id)) return;
        const b = nodeBox(d, other);
        if (hi(b) <= lo(G)) reach[i].before = true;
        if (lo(b) >= hi(G)) reach[i].after = true;
      });
    });
    const order = kids.map((k, i) => i).sort((p, q) => lo(boxes[p]) - lo(boxes[q]));
    [['before', 0], ['after', kids.length - 1]].forEach(([side, end]) => {
      const who = reach.map((r, i) => (r[side] ? i : -1)).filter((i) => i >= 0);
      if (who.length !== 1 || reach[who[0]][side === 'before' ? 'after' : 'before']) return;
      hits++;
      check(order[end] === who[0], `${name}: in ${g.id}, ${kids[who[0]]} links ${side === 'before' ? (row ? 'left' : 'up') : (row ? 'right' : 'down')} and is not the end member there`);
    });
  });
  check(hits >= minHits, `${name}: reorder rule applied ${hits} times (want at least ${minHits})`);
}
{
  const d = fixture('landscape'); layoutDiagram(d);
  orderChecks('landscape', d, 1);
  const x = (id) => elOf(d, id).x;
  check(x('api') > x('web') && x('api') > x('orddb') && elOf(d, 'crm').x > x('api'), 'landscape: api is the member nearest crm');
  const w = fixture('landscape');   // the written order is not the drawn order, and the frame did not change
  const before = w.groups.find((g) => g.id === 'platform');
  check(before && d.groups.find((g) => g.id === 'platform').w === 736, 'landscape: reordering keeps the frame size');
  const i = fixture('inner-links'); layoutDiagram(i);
  orderChecks('inner-links', i, 1);
}
// every fixture: members stay in their frame at the same size whatever the order, and the order is stable
for (const n of ran) { const d = fixture(n); layoutDiagram(d); orderChecks(n, d, 0); }

// No arrow crosses a box it does not end on or a frame it does not enter.
function arrowsClear(name, d) {
  const gBy = new Map(d.groups.map((g) => [g.id, g]));
  const boxes = d.elements.filter((e) => !e._hidden).map((e) => ({ id: e.id, ...boxOf(e) }))
    .concat(d.groups.filter((g) => !g._hidden && g._collapsed).map((g) => ({ id: g.id, ...boxOf(g) })));
  const frames = d.groups.filter((g) => !g._hidden && !g._collapsed).map((g) => ({ id: g.id, ...boxOf(g) }));
  const up = (id) => { const s = new Set(); const e = elOf(d, id); for (let g = gBy.get(e ? e.group : (gBy.get(id) || {}).parent); g; g = gBy.get(g.parent)) s.add(g.id); return s; };
  d._edges.forEach((e) => {
    const enter = new Set([...up(e.from), ...up(e.to)]);
    const segs = e.points.slice(1).map((p, k) => [e.points[k], p]);
    boxes.forEach((b) => { if (b.id !== e.from && b.id !== e.to) check(!segs.some(([p, q]) => segHits(p, q, b)), `${name}: arrow ${e.from} -> ${e.to} crosses box ${b.id}`); });
    frames.forEach((f) => { if (!enter.has(f.id)) check(!segs.some(([p, q]) => segHits(p, q, f)), `${name}: arrow ${e.from} -> ${e.to} crosses frame ${f.id}`); });
  });
}
if (newRouter) {
  for (const n of ran) { const d = fixture(n); layoutDiagram(d); arrowsClear(n, d); }
} else if (hasRoute) {
  for (const n of ['inner-links', 'landscape']) { const d = fixture(n); layoutDiagram(d); arrowsClear(`${n} (sibling boxes)`, d); }
}

// The canvas is tight: the content starts at the margin and ends one margin before the right and bottom edge.
function canvasTight(name, d) {
  const M = tokens.c4.margin;
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  const grow = (x0, y0, x1, y1) => { l = Math.min(l, x0); t = Math.min(t, y0); r = Math.max(r, x1); b = Math.max(b, y1); };
  d.elements.concat(d.groups).filter((o) => !o._hidden && o.w > 0).forEach((o) => grow(o.x, o.y, o.x + o.w, o.y + o.h));
  d._edges.forEach((e) => { e.points.forEach((p) => grow(p[0], p[1], p[0], p[1])); grow(e.labelBox.x, e.labelBox.y, e.labelBox.x + e.labelBox.w, e.labelBox.y + e.labelBox.h); if (e.badge) grow(e.badge.x, e.badge.y, e.badge.x + e.badge.w, e.badge.y + e.badge.h); });
  check(Math.abs(l - M) <= 1 && Math.abs(t - M) <= 1, `${name}: content starts at the margin (${l}, ${t})`);
  check(d.canvas.width - r >= M - 1 && d.canvas.width - r <= M + 1 && d.canvas.height - b >= M - 1 && d.canvas.height - b <= M + 1, `${name}: canvas ends one margin after the content (${d.canvas.width - r}, ${d.canvas.height - b})`);
}
for (const n of ran) { const d = fixture(n); layoutDiagram(d); canvasTight(n, d); }
{ const d = clone(landC); layoutDiagram(d); canvasTight('landscape collapsed', d); }

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
  // routeDiagram runs in manual mode here, where arrows the ring router sent through boxes are legitimately re-routed
  // around them (the dense 500-element fixture has hundreds of such arrows), so the arrow PATHS may differ from the
  // full layout's; what must not change is every position and size, and the arrows drawn (same ids, ends and count).
  const geo = (x) => JSON.stringify(x.elements.concat(x.groups).map((o) => [o.id, o.x, o.y, o.w, o.h]));
  const ends = (x) => JSON.stringify(x._edges.map((e) => [e.id, e.from, e.to, e.count]));
  check(geo(r) === geo(d) && ends(r) === ends(d), 'big: routeDiagram on the laid-out diagram keeps every position, size and arrow');
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
// ---- loop-unders for side columns: an E and a W column of 3, a link first to last (and one between neighbours), no model file
for (const side of ['E', 'W']) {
  const d = { diagramType: 'c4', groups: [], elements: [{ id: 'hub', kind: 'system', name: 'Hub', core: true }].concat(
    ['a', 'b', 'c'].map((k) => ({ id: k, kind: 'external', name: k.toUpperCase(), side })), [{ id: 'z', kind: 'external', name: 'Z', side: 'N' }]),
    relations: [{ from: 'hub', to: 'a', label: 'x' }, { from: 'hub', to: 'b', label: 'y' }, { from: 'hub', to: 'c', label: 'w' }, { from: 'a', to: 'c', label: 'Loops out' },
      { from: 'a', to: 'b', label: 'Next' }, { from: 'hub', to: 'z', label: 'v' }] };
  layoutDiagram(d);
  const ed = d._edges.find((e) => e.from === 'a' && e.to === 'c'), nb = d._edges.find((e) => e.from === 'a' && e.to === 'b');
  const col = ['a', 'b', 'c'].map((k) => elOf(d, k)), tag = `column ${side}`;
  check(col.every((e) => e._side === side), `${tag}: items sit on ${side}`);
  const far = side === 'E' ? Math.max(...col.map((e) => e.x + e.w)) : Math.min(...col.map((e) => e.x));
  check(ed && ed.points.length === 4 && ed.points[1][0] === ed.points[2][0], `${tag}: first-to-last link is a loop with a vertical run`);
  check(ed && (side === 'E' ? ed.points[1][0] > far : ed.points[1][0] < far), `${tag}: the run lies on the outer side of the column`);
  check(nb && nb.points.length <= 2 + 2, `${tag}: neighbours keep the plain route`);
  check(ed && ed.labelBox && ed.labelBox.w > 0, `${tag}: label placed`);
  check(ed && Math.abs(ed.labelBox.x + ed.labelBox.w / 2 - ed.points[1][0]) < 1, `${tag}: label sits on the run`);
  d.elements.forEach((e) => d._edges.forEach((r) => {
    if (r.from === e.id || r.to === e.id || e._hidden) return;
    r.points.slice(1).forEach((q, i) => check(!segHits(r.points[i], q, e), `${tag}: ${r.from}>${r.to} crosses box ${e.id}`));
  }));
  d.groups.forEach((g) => d._edges.forEach((r) => r.points.slice(1).forEach((q, i) => { if (!r.points.some((p) => p[0] > g.x && p[0] < g.x + g.w && p[1] > g.y && p[1] < g.y + g.h)) check(!segHits(r.points[i], q, g), `${tag}: crosses frame ${g.id}`); })));
}

// ---- manual mode (phase 5): routeDiagram(data, { pinned }) keeps saved positions
const savedOf = (d) => { const o = clone(d); ['_edges', 'canvas', '_arrange', '_manual', '_dir'].forEach((k) => delete o[k]); return o; };
const posOf = (d) => new Map(d.elements.concat(d.groups).map((o) => [o.id, [o.x, o.y]]));
// every id in `ids` moved by one common (dx, dy) between two pictures (the canvas shift moves a picture as a whole)
const sameShift = (a, b, ids, msg) => {
  const pa = posOf(a), pb = posOf(b), ds = new Set(ids.map((id) => `${pb.get(id)[0] - pa.get(id)[0]},${pb.get(id)[1] - pa.get(id)[1]}`));
  check(ds.size === 1, `${msg} (shifts ${[...ds].slice(0, 3).join(' | ')})`);
};
const idsOf = (d) => d.elements.map((e) => e.id).concat(d.groups.map((g) => g.id));
const man = (d, o) => { routeDiagram(d, o); return d; };
for (const n of ran) {
  const d0 = fixture(n), laid = clone(d0);
  layoutDiagram(laid);
  const base = savedOf(laid);
  // routeDiagram with saved positions: _manual, byte-equal twice, layoutDiagram still ignores saved positions
  const a = man(clone(base)), b = man(clone(savedOf(a)));
  check(a._manual === true && b._manual === true && laid._manual === undefined, `${n}: _manual is set by routeDiagram only`);
  check(JSON.stringify(a) === JSON.stringify(b), `${n}: manual mode twice is byte-equal`);
  const ign = clone(base);
  ign.elements.forEach((e) => { e.x = 7; e.y = 7; });
  layoutDiagram(ign);
  check(stable(ign) === stable(laid), `${n}: layoutDiagram ignores saved positions`);
  // incomplete positions: every other element keeps its place, the missing one is placed, no full layout
  const vis = laid.elements.filter((e) => !e._hidden);
  const gone = vis.find((e) => e.group) || vis[vis.length - 1];
  const part = clone(base);
  const pe = part.elements.find((e) => e.id === gone.id);
  delete pe.x; delete pe.y;
  man(part);
  noOverlap(part, `${n} (incomplete)`); inGroups(part, `${n} (incomplete)`); orthogonal(part, `${n} (incomplete)`); arrowsClear(`${n} (incomplete)`, part);
  check(part._manual === true && Number.isFinite(part.elements.find((e) => e.id === gone.id).x), `${n}: an element without a position is placed`);
  // move one element onto another: no overlap, the pinned one stays (same shift as an untouched far item), the rest is separated
  const mv = clone(base), A = vis[0], B = vis.find((e) => e !== A && e.group !== A.group) || vis[1];
  const me = mv.elements.find((e) => e.id === A.id), tb = mv.elements.find((e) => e.id === B.id);
  me.x = tb.x + 10; me.y = tb.y + 6;
  man(mv, { pinned: [A.id] });
  noOverlap(mv, `${n} (moved)`); inGroups(mv, `${n} (moved)`); orthogonal(mv, `${n} (moved)`);
  arrowsClear(`${n} (moved)`, mv);   // manual mode routes around every box and frame
}
{
  // pinned items never move, others shift away; far items stay (all deltas below are the common canvas shift)
  const el = (id, x, y) => ({ id, kind: 'container', name: id, x, y });
  const d = { diagramType: 'c4', groups: [], elements: [el('a', 200, 200), el('b', 600, 200), el('far', 1200, 200), el('far2', 1200, 600)], relations: [{ from: 'a', to: 'far', label: 'x' }] };
  const pre = clone(d);
  pre.elements.find((e) => e.id === 'b').x = 210; pre.elements.find((e) => e.id === 'b').y = 210;
  const r = man(clone(pre), { pinned: ['b'] }), q = posOf(r), p0 = posOf(pre);
  const dl = (id) => [q.get(id)[0] - p0.get(id)[0], q.get(id)[1] - p0.get(id)[1]];
  check(JSON.stringify(dl('b')) === JSON.stringify(dl('far')) && JSON.stringify(dl('far')) === JSON.stringify(dl('far2')), 'pinned: b and the far items share one shift (b did not move)');
  check(JSON.stringify(dl('a')) !== JSON.stringify(dl('b')), 'pinned: a was shifted away from b');
  noOverlap(r, 'pinned'); 
  // pinned frames: dragging a group's member over a neighbour group moves the neighbour (a block, members with it)
  const g = { diagramType: 'c4', groups: [{ id: 'G', name: 'G', kind: 'system' }, { id: 'H', name: 'H', kind: 'system' }],
    elements: [{ ...el('g1', 100, 100), group: 'G' }, { ...el('g2', 300, 100), group: 'G' }, { ...el('h1', 700, 100), group: 'H' }, { ...el('h2', 900, 100), group: 'H' }], relations: [] };
  const g0 = clone(g); g0.elements.find((e) => e.id === 'g2').x = 650;
  const p = posOf(g0), gr = man(clone(g0), { pinned: ['g2'] }), q2 = posOf(gr);
  noOverlap(gr, 'pinned frames'); inGroups(gr, 'pinned frames');
  const sh = (id) => `${q2.get(id)[0] - p.get(id)[0]},${q2.get(id)[1] - p.get(id)[1]}`;
  check(sh('h1') === sh('h2') && sh('h1') !== sh('g2'), 'pinned frames: H (both members) shifts as one block, away from the pinned member');
  // two runs byte-equal
  check(JSON.stringify(man(clone(g0), { pinned: ['g2'] })) === JSON.stringify(gr), 'pinned: two runs are byte-equal');
}
{
  // new element placement
  const lay = fixture('landscape'); layoutDiagram(lay);
  const base = savedOf(lay), ids = idsOf(lay);
  const untouched = (d, extra, msg) => sameShift(lay, d, ids.filter((i) => !extra.includes(i) && !d.groups.some((g) => g.id === i && !g.collapsed && lay.groups.find((q) => q.id === i))), msg);
  // joins a group: the next slot in its row, the group grows, the picture around is separated
  const j = clone(base);
  j.elements.push({ id: 'nu', kind: 'container', name: 'New one', group: 'platform' });
  man(j);
  const nu = elOf(j, 'nu'), plat = j.groups.find((g) => g.id === 'platform'), kids = j.elements.filter((e) => e.group === 'platform' && e.id !== 'nu');
  check(nu && Number.isFinite(nu.x) && inside(nu, plat), 'new in group: placed inside the group frame');
  check(kids.every((k) => nu.x >= k.x + k.w) && Math.abs(nu.y + nu.h / 2 - (kids[0].y + kids[0].h / 2)) <= kids[0].h, 'new in group: next slot in the group row, after the last member');
  check(plat.w > lay.groups.find((g) => g.id === 'platform').w, 'new in group: the group grows');
  const others = lay.elements.filter((e) => e.group === 'platform').map((e) => e.id);   // outside neighbours may be pushed away by the growth
  sameShift(lay, j, others, 'new in group: no untouched member moves relative to the others (exact)');
  noOverlap(j, 'new in group'); inGroups(j, 'new in group'); orthogonal(j, 'new in group'); arrowsClear('new in group', j);
  // loose and linked: beside the item it is linked to
  const l = clone(base);
  l.elements.push({ id: 'lo', kind: 'external', name: 'Loose' });
  l.relations.push({ from: 'cust', to: 'lo', label: 'Sees' });
  man(l);
  const lo = elOf(l, 'lo'), cu = elOf(l, 'cust');
  noOverlap(l, 'new loose'); inGroups(l, 'new loose'); orthogonal(l, 'new loose'); arrowsClear('new loose', l);
  check(!l.groups.some((g) => inside(lo, g)), 'new loose: outside every frame');
  check(Math.hypot(lo.x - cu.x, lo.y - cu.y) < 420, `new loose: close to cust (${Math.round(Math.hypot(lo.x - cu.x, lo.y - cu.y))} px)`);
  sameShift(lay, l, ids, 'new loose: nothing else moved');
  // no relation: beside the centre, never over a box; two new ones land apart
  const c = clone(base);
  c.elements.push({ id: 'n1', kind: 'container', name: 'One' }, { id: 'n2', kind: 'container', name: 'Two' });
  man(c);
  noOverlap(c, 'new beside centre'); inGroups(c, 'new beside centre');
  sameShift(lay, c, ids, 'new beside centre: nothing else moved');
  // new empty group gets a free spot
  const eg = clone(base);
  eg.groups.push({ id: 'ng', name: 'Empty', kind: 'boundary' });
  man(eg);
  const ng = eg.groups.find((g) => g.id === 'ng');
  check(ng.w === tokens.c4.emptyW && ng.h === tokens.c4.emptyH, 'new empty group: has its size');
  noOverlap(eg, 'new empty group'); sameShift(lay, eg, ids, 'new empty group: nothing else moved');
  // a new group with members that have no positions: one block, members in its layout
  const bg = clone(base);
  bg.groups.push({ id: 'bg', name: 'Block', kind: 'system' });
  bg.elements.push({ id: 'b1', kind: 'container', name: 'B1', group: 'bg' }, { id: 'b2', kind: 'container', name: 'B2', group: 'bg' });
  man(bg);
  noOverlap(bg, 'new group with members'); inGroups(bg, 'new group with members');
  check(elOf(bg, 'b1').x < elOf(bg, 'b2').x, 'new group with members: members laid out in a row');
  // deterministic
  check(JSON.stringify(man(clone(j), undefined)) === JSON.stringify(man(clone(savedOf(j)))), 'new in group: second route changes nothing');
  const j2 = clone(base); j2.elements.push({ id: 'nu', kind: 'container', name: 'New one', group: 'platform' });
  check(stable(man(j2)) === stable(j), 'new in group: two runs are byte-equal');
}
{
  // edits in manual mode keep what they did not touch
  const lay = fixture('landscape'); layoutDiagram(lay);
  const base = savedOf(lay), ids = idsOf(lay);
  const conn = clone(base); conn.relations.push({ from: 'web', to: 'pay', label: 'New link' });
  man(conn); sameShift(lay, conn, ids, 'connect keeps every position');
  const del = clone(base); del.relations = del.relations.filter((r) => r.from !== 'crm' && r.to !== 'crm'); del.elements = del.elements.filter((e) => e.id !== 'crm');
  man(del); sameShift(lay, del, ids.filter((i) => i !== 'crm'), 'delete keeps every other position');
  const col = clone(base); col.groups.find((g) => g.id === 'platform').collapsed = true;
  man(col);
  const members = ['web', 'api', 'orddb'], keep = ids.filter((i) => !members.includes(i) && i !== 'platform');
  sameShift(lay, col, keep, 'collapse keeps every outside position');
  noOverlap(col, 'manual collapse');
  check(members.every((id) => elOf(col, id)._hidden && Number.isFinite(elOf(col, id).x)), 'collapse: hidden members keep their x, y');
  const ex = clone(savedOf(col)); ex.groups.find((g) => g.id === 'platform').collapsed = false;
  man(ex);
  noOverlap(ex, 'manual expand'); inGroups(ex, 'manual expand');
  // expanding puts the members where they were saved
  const rel = (d, a, b) => [elOf(d, a).x - elOf(d, b).x, elOf(d, a).y - elOf(d, b).y].join();
  check(rel(ex, 'web', 'api') === rel(lay, 'web', 'api') && rel(ex, 'api', 'orddb') === rel(lay, 'api', 'orddb'), 'expand: members keep their saved layout among themselves');
  // a tile dragged elsewhere takes its hidden members along (the page shifts them by the same delta): the engine only keeps them
  const tile = clone(savedOf(col)); const pl = tile.groups.find((g) => g.id === 'platform');
  pl.x += 300; pl.y += 200; members.forEach((id) => { const e = elOf(tile, id); e.x += 300; e.y += 200; });
  const ex2 = clone(tile); ex2.groups.find((g) => g.id === 'platform').collapsed = false;
  man(ex2, { pinned: ['platform'] });
  noOverlap(ex2, 'moved tile expands'); inGroups(ex2, 'moved tile expands');
  check(rel(ex2, 'web', 'api') === rel(lay, 'web', 'api'), 'moved tile: members keep their layout when it opens');
}

// ---- manual mode at scale: a release (routeDiagram with pinned) on 500 and 2,000 visible elements
function scaleFixture(groups, per) {
  const g = [], e = [], r = [];
  for (let i = 0; i < groups; i++) {
    g.push({ id: `g${i}`, name: `System ${i}`, kind: 'system' });
    for (let k = 0; k < per; k++) {
      e.push({ id: `g${i}e${k}`, kind: 'container', name: `Service ${i}-${k}`, tech: 'Node.js', group: `g${i}` });
      if (k) r.push({ from: `g${i}e${Math.floor((k - 1) / 3)}`, to: `g${i}e${k}`, label: 'Calls' });
    }
    if (i) r.push({ from: `g${i}e1`, to: `g${i - 1}e2`, label: 'Syncs', async: true });
  }
  return { diagramType: 'c4', schemaVersion: 1, title: 'Scale', groups: g, elements: e, relations: r };
}
const releaseMs = {};
for (const [label, groups, per, limit] of [['500', 20, 25, 100], ['2000', 40, 50, 400]]) {
  const d = scaleFixture(groups, per);
  make('function routeC4Edges(nodes, edges) { return edges.map((e) => ({ d: "M0 0", points: [[0, 0], [0, 1]], lx: 0, ly: 0, w: 48 })); }').layoutDiagram(d);
  const base = savedOf(d), mv = clone(base);
  const a = mv.elements.find((e) => e.id === 'g3e5'), b = mv.elements.find((e) => e.id === 'g4e7');
  a.x = b.x + 12; a.y = b.y + 8;
  const r1 = clone(mv), r2 = clone(mv);
  const t0 = performance.now();
  routeDiagram(r1, { pinned: ['g3e5'] });
  const ms = performance.now() - t0;
  releaseMs[label] = ms;
  console.log(`manual: release on ${label} visible elements (routeDiagram with pinned, real router): ${ms.toFixed(0)} ms (limit ${limit})`);
  check(ms < limit, `release on ${label} elements under ${limit} ms (${ms.toFixed(0)} ms)`);
  routeDiagram(r2, { pinned: ['g3e5'] });
  check(JSON.stringify(r1) === JSON.stringify(r2), `scale ${label}: two releases are byte-equal`);
  noOverlap(r1, `scale ${label} moved`); inGroups(r1, `scale ${label} moved`);
  // placement of 20 new elements into groups and loose
  const nw = clone(base);
  for (let k = 0; k < 20; k++) nw.elements.push(k % 2 ? { id: `nw${k}`, kind: 'container', name: `New ${k}`, group: `g${k % groups}` } : { id: `nw${k}`, kind: 'external', name: `New ${k}` });
  const t1 = performance.now();
  routeDiagram(nw);
  console.log(`manual: place 20 new elements on ${label}: ${(performance.now() - t1).toFixed(0)} ms`);
  noOverlap(nw, `scale ${label} new`); inGroups(nw, `scale ${label} new`);
}

// ---- Phase 2: vertical layers, nested sub-zones, group endpoints, multi-side shared layers, cross-layer skips, step badges
{
  const byId = (d, id) => d.elements.find((e) => e.id === id) || d.groups.find((g) => g.id === id);
  const badgeChecks = (name, d) => {
    const badges = d._edges.filter((e) => e.badge).map((e) => ({ id: e.id, ...e.badge }));
    const labels = d._edges.filter((e) => e.labelBox && e.labelBox.w > 0).map((e) => ({ id: e.id, ...e.labelBox }));
    const boxes = d.elements.filter((e) => !e._hidden).map((e) => ({ id: e.id, ...boxOf(e) }))
      .concat(d.groups.filter((g) => !g._hidden && g._collapsed).map((g) => ({ id: g.id, ...boxOf(g) })));
    const tagBands = d.groups.filter((g) => !g._hidden && !g._collapsed).map((g) => ({ id: g.id, x: g.x, y: g.y, w: g.w, h: Math.min(tokens.c4.tagH, g.h) }));
    badges.forEach((b, i) => {
      check(b.w > 0 && b.h > 0 && Number.isFinite(b.x) && Number.isFinite(b.y), `${name}: badge ${b.id} has valid geometry`);
      boxes.forEach((o) => check(!overlap(b, o), `${name}: badge ${b.id} overlaps box ${o.id}`));
      tagBands.forEach((t) => check(!overlap(b, t), `${name}: badge ${b.id} overlaps tag band of ${t.id}`));
      labels.forEach((l) => check(!overlap(b, l), `${name}: badge ${b.id} overlaps label ${l.id}`));
      badges.slice(i + 1).forEach((o) => check(!overlap(b, o), `${name}: badges ${b.id} and ${o.id} overlap`));
    });
  };
  const arrowsClearGroups = (name, d) => {
    const gBy = new Map(d.groups.map((g) => [g.id, g]));
    const boxes = d.elements.filter((e) => !e._hidden).map((e) => ({ id: e.id, ...boxOf(e) }))
      .concat(d.groups.filter((g) => !g._hidden && g._collapsed).map((g) => ({ id: g.id, ...boxOf(g) })));
    const frames = d.groups.filter((g) => !g._hidden && !g._collapsed).map((g) => ({ id: g.id, ...boxOf(g) }));
    const up = (id) => {
      const s = new Set();
      const e = elOf(d, id);
      for (let g = gBy.get(e ? e.group : (gBy.get(id) || {}).parent); g; g = gBy.get(g.parent)) s.add(g.id);
      return s;
    };
    d._edges.forEach((e) => {
      const enter = new Set([...up(e.from), ...up(e.to)]);
      const segs = e.points.slice(1).map((p, k) => [e.points[k], p]);
      boxes.forEach((b) => { if (b.id !== e.from && b.id !== e.to) check(!segs.some(([p, q]) => segHits(p, q, b)), `${name}: arrow ${e.from} -> ${e.to} crosses box ${b.id}`); });
      frames.forEach((f) => { if (!enter.has(f.id) && f.id !== e.from && f.id !== e.to) check(!segs.some(([p, q]) => segHits(p, q, f)), `${name}: arrow ${e.from} -> ${e.to} crosses frame ${f.id}`); });
    });
  };

  // 1. Vertical layers with nested sub-zones, group-to-group + mixed relations, multi-side shared layers (full & partial spans), cross-layer skips, step badges, edge colors
  const pipe = {
    diagramType: 'c4', schemaVersion: 1, title: 'Data Pipeline', arrange: 'layers', layerDirection: 'vertical',
    groups: [
      { id: 'sources', name: 'Sources', kind: 'boundary' },
      { id: 'ingest', name: 'Ingest', kind: 'boundary' },
      { id: 'store', name: 'Store', kind: 'boundary' },
      { id: 'hot', name: 'Hot Path', kind: 'boundary', parent: 'store' },
      { id: 'cold', name: 'Cold Path', kind: 'boundary', parent: 'store' },
      { id: 'serve', name: 'Serve', kind: 'boundary' },
      { id: 'sh_s1', name: 'Edge Security', kind: 'boundary', shared: true, side: 'S', span: ['sources', 'ingest'] },
      { id: 'sh_s2', name: 'Data Governance', kind: 'boundary', shared: true, side: 'S', span: ['store', 'serve'] },
      { id: 'sh_s3', name: 'Observability', kind: 'boundary', shared: true, side: 'S' },
      { id: 'sh_n1', name: 'CI/CD', kind: 'boundary', shared: true, side: 'N', span: ['ingest', 'store'] },
      { id: 'sh_w1', name: 'Identity', kind: 'boundary', shared: true, side: 'W' },
      { id: 'sh_e1', name: 'Consumers', kind: 'boundary', shared: true, side: 'E' },
    ],
    elements: [
      { id: 'iot', kind: 'external', name: 'IoT Devices', group: 'sources' },
      { id: 'app', kind: 'system', name: 'Mobile App', group: 'sources' },
      { id: 'hub', kind: 'container', name: 'Event Hub', tech: 'Kafka', group: 'ingest' },
      { id: 'redis', kind: 'database', name: 'Cache', tech: 'Redis', group: 'hot' },
      { id: 'stream', kind: 'container', name: 'Stream Proc', tech: 'Flink', group: 'hot' },
      { id: 'lake', kind: 'database', name: 'Data Lake', tech: 'Parquet', group: 'cold' },
      { id: 'api', kind: 'container', name: 'Serving API', tech: 'REST', group: 'serve' },
      { id: 'waf', kind: 'container', name: 'WAF', group: 'sh_s1' },
      { id: 'cat', kind: 'container', name: 'Catalog', group: 'sh_s2' },
      { id: 'mon', kind: 'container', name: 'Monitor', group: 'sh_s3' },
      { id: 'log', kind: 'container', name: 'Logs', group: 'sh_s3' },
      { id: 'pipe_ci', kind: 'container', name: 'Build', group: 'sh_n1' },
      { id: 'iam', kind: 'container', name: 'IAM', group: 'sh_w1' },
      { id: 'bi', kind: 'external', name: 'BI Tool', group: 'sh_e1' },
    ],
    relations: [
      { from: 'sources', to: 'ingest', label: 'Streams', step: ' 1 ', color: '1' },
      { from: 'ingest', to: 'hot', label: 'Real-time', step: '2a', color: '2' },
      { from: 'ingest', to: 'cold', label: 'Batch', step: '2b', color: '3' },
      { from: 'cold', to: 'api', label: 'Queries', step: '3' },
      { from: 'sources', to: 'store', label: 'Direct backfill', step: '4', color: '4' },
      { from: 'hub', to: 'api', label: 'Fast alert', step: '5' },
      // ancestor-descendant relations must be ignored
      { from: 'store', to: 'hot', label: 'Invalid anc-desc' },
      { from: 'store', to: 'redis', label: 'Invalid anc-elem' },
    ]
  };
  const d = clone(pipe);
  layoutDiagram(d);
  noOverlap(d, 'pipeline'); inGroups(d, 'pipeline'); orthogonal(d, 'pipeline'); canvasTight('pipeline', d);
  if (hasRoute) { arrowsClearGroups('pipeline', d); badgeChecks('pipeline', d); }
  // vertical columns ordered left-to-right with equalized heights
  const cols = ['sources', 'ingest', 'store', 'serve'].map((id) => byId(d, id));
  for (let i = 1; i < cols.length; i++) {
    check(cols[i].x >= cols[i - 1].x + cols[i - 1].w, `pipeline: column ${cols[i].id} lies right of ${cols[i - 1].id}`);
    check(cols[i].y === cols[0].y && cols[i].h === cols[0].h, `pipeline: column ${cols[i].id} height equalized (${cols[i].y},${cols[i].h} vs ${cols[0].y},${cols[0].h})`);
  }
  // nested sub-zones stacked cleanly inside store
  const hot = byId(d, 'hot'), cold = byId(d, 'cold'), store = byId(d, 'store');
  check(inside(hot, store) && inside(cold, store) && !overlap(hot, cold), 'pipeline: hot and cold sub-zones sit cleanly inside store');
  check(Math.max(hot.y, cold.y) >= Math.min(hot.y + hot.h, cold.y + cold.h), 'pipeline: sub-zones stack vertically inside vertical layer column');
  // shared layers placement, partial & full spans, same-track packing
  const s1 = byId(d, 'sh_s1'), s2 = byId(d, 'sh_s2'), s3 = byId(d, 'sh_s3');
  const n1 = byId(d, 'sh_n1'), w1 = byId(d, 'sh_w1'), e1 = byId(d, 'sh_e1');
  check(s1.y === s2.y && s1.y > cols[0].y + cols[0].h, 'pipeline: non-overlapping S shared layers share track below main layers');
  check(s1.x <= cols[0].x && s1.x + s1.w >= cols[1].x + cols[1].w, 'pipeline: sh_s1 spans sources..ingest');
  check(s2.x <= cols[2].x && s2.x + s2.w >= cols[3].x + cols[3].w, 'pipeline: sh_s2 spans store..serve');
  check(s3.y >= Math.max(s1.y + s1.h, s2.y + s2.h) + tokens.c4.ringGap - 1, 'pipeline: overlapping full-span sh_s3 stacks outward below sh_s1/sh_s2');
  check(s3.x <= cols[0].x && s3.x + s3.w >= cols[3].x + cols[3].w, 'pipeline: sh_s3 spans all main layers');
  check(n1.y + n1.h < cols[0].y && n1.x <= cols[1].x && n1.x + n1.w >= cols[2].x + cols[2].w, 'pipeline: sh_n1 sits above main layers spanning ingest..store');
  check(w1.x + w1.w < cols[0].x && w1.y <= cols[0].y && w1.y + w1.h >= cols[0].y + cols[0].h, 'pipeline: sh_w1 sits left spanning main layers height');
  check(e1.x > cols[3].x + cols[3].w && e1.y <= cols[0].y && e1.y + e1.h >= cols[0].y + cols[0].h, 'pipeline: sh_e1 sits right spanning main layers height');
  // group endpoints, step trimming, colors, ancestor-descendant ignored
  check(d._edges.length === 6, `pipeline: 6 valid edges drawn (2 anc-desc ignored), got ${d._edges.length}`);
  const eSrc = d._edges.find((e) => e.from === 'sources' && e.to === 'ingest');
  check(eSrc && eSrc.step === '1' && eSrc.color === '1' && eSrc.badge && eSrc.badge.w >= 22, 'pipeline: group-to-group edge carries trimmed step, color, and badge');
  check(d._edges.some((e) => e.from === 'cold' && e.to === 'api' && e.step === '3'), 'pipeline: mixed sub-zone-to-element edge drawn');
  // determinism & routeDiagram stability
  const d2 = clone(pipe); layoutDiagram(d2);
  check(stable(d) === stable(d2), 'pipeline: layoutDiagram is deterministic');
  const dRoute = clone(d); delete dRoute._edges; delete dRoute.canvas;
  routeDiagram(dRoute);
  check(stable(dRoute) === stable(d), 'pipeline: routeDiagram on laid-out diagram is stable');
  // collapsed group merges arrows, omits step, keeps shared color only when uniform
  const colStore = clone(pipe);
  colStore.groups.find((g) => g.id === 'store').collapsed = true;
  layoutDiagram(colStore);
  noOverlap(colStore, 'pipeline collapsed'); inGroups(colStore, 'pipeline collapsed'); orthogonal(colStore, 'pipeline collapsed');
  const merged = colStore._edges.find((e) => e.from === 'ingest' && e.to === 'store');
  check(merged && merged.count === 2 && !('step' in merged) && !('color' in merged), 'pipeline collapsed: merged arrow omits step and mixed color');
  // manual drag of a shared layer keeps pinned position and re-routes cleanly
  const moved = clone(savedOf(d));
  const mSh = moved.groups.find((g) => g.id === 'sh_n1');
  mSh.x += 40; mSh.y -= 20;
  moved.elements.find((e) => e.id === 'pipe_ci').x += 40; moved.elements.find((e) => e.id === 'pipe_ci').y -= 20;
  routeDiagram(moved, { pinned: ['sh_n1'] });
  noOverlap(moved, 'pipeline manual move'); inGroups(moved, 'pipeline manual move'); orthogonal(moved, 'pipeline manual move');
  if (hasRoute) { arrowsClearGroups('pipeline manual move', moved); badgeChecks('pipeline manual move', moved); }

  // 2. Horizontal layers with default E shared layer + W partial-span shared layer + cross-layer skip
  const hPipe = {
    diagramType: 'c4', schemaVersion: 1, title: 'Horizontal Layers + Shared', arrange: 'layers',
    groups: [
      { id: 'b0', name: 'Presentation', kind: 'boundary' },
      { id: 'b1', name: 'Domain', kind: 'boundary' },
      { id: 'b2', name: 'Data', kind: 'boundary' },
      { id: 'ops', name: 'Platform Ops', kind: 'boundary', shared: true },
      { id: 'sec', name: 'Auth', kind: 'boundary', shared: true, side: 'W', span: ['b0', 'b1'] },
    ],
    elements: [
      { id: 'ui', kind: 'container', name: 'Web UI', group: 'b0' },
      { id: 'svc', kind: 'container', name: 'Core API', group: 'b1' },
      { id: 'db', kind: 'database', name: 'Postgres', group: 'b2' },
      { id: 'obs', kind: 'container', name: 'Telemetry', group: 'ops' },
      { id: 'sso', kind: 'container', name: 'SSO', group: 'sec' },
    ],
    relations: [
      { from: 'ui', to: 'svc', label: 'Calls', step: '1', color: '1' },
      { from: 'svc', to: 'db', label: 'Reads', step: '2', color: '1' },
      { from: 'b0', to: 'b2', label: 'Direct export', step: '3', color: '4' },
    ]
  };
  layoutDiagram(hPipe);
  noOverlap(hPipe, 'horiz shared'); inGroups(hPipe, 'horiz shared'); orthogonal(hPipe, 'horiz shared'); canvasTight('horiz shared', hPipe);
  if (hasRoute) { arrowsClearGroups('horiz shared', hPipe); badgeChecks('horiz shared', hPipe); }
  const b0 = byId(hPipe, 'b0'), b1 = byId(hPipe, 'b1'), b2 = byId(hPipe, 'b2'), ops = byId(hPipe, 'ops'), sec = byId(hPipe, 'sec');
  check(b0.x === b1.x && b0.w === b1.w && b1.w === b2.w, 'horiz shared: main bands equalized width');
  check(ops.x > b0.x + b0.w && ops.y <= b0.y && ops.y + ops.h >= b2.y + b2.h, 'horiz shared: default shared layer sits on E spanning all bands');
  check(sec.x + sec.w < b0.x && sec.y <= b0.y && sec.y + sec.h >= b1.y + b1.h, 'horiz shared: W partial shared layer spans b0..b1');
}

check(worst < LIMIT_MS, `large fixture under ${LIMIT_MS} ms (worst ${worst.toFixed(0)} ms)`);

console.log(failures ? `\n${failures} check(s) failed` : `\nall c4 engine checks passed (${ran.length} fixtures)`);
process.exit(failures ? 1 : 0);
