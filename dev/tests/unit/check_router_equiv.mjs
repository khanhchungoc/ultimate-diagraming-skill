// Router equivalence check: routes the same inputs through assets/shell/ortho-router.js and the frozen copy of the router
// before its speed work (dev/tests/fixtures/router/ortho-router.baseline.js) and requires byte-identical output
// (JSON.stringify of every route). Inputs: every flowchart golden layout (LR and TB, boxes as the engine places them)
// plus seeded pseudo-random diagrams (lanes, labels, decisions, loop-backs, two-way pairs, 10-300 nodes).
// Usage: node dev/tests/unit/check_router_equiv.mjs     Exit code 0 when every case matches.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BASELINE_ROUTER, gridModel, loadRouter } from '../../bench/bench_router.mjs';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const current = loadRouter();
const baseline = loadRouter(BASELINE_ROUTER);

// The flowchart engine's sizes (assets/types/flowchart/engine.js LE): extent along / across the flow
const SIZE = { LR: { along: 144, across: 64, decision: 96 }, TB: { along: 96, across: 144, decision: 144 } };

// Same rule as the flowchart's loopSides(): a lane whose loops would cross its outgoing cross-lane arrows loops on the near side
function loopSides(nodes, edges, lanes) {
  const li = {}, laneOf = {}, far = {}, near = {};
  lanes.forEach((l, i) => { li[l.id] = i; });
  nodes.forEach(n => { laneOf[n.id] = li[n.laneId]; });
  edges.forEach(e => {
    const a = laneOf[e.from], b = laneOf[e.to];
    if (a === undefined || b === undefined) return;
    if (b > a) far[e.from] = true;
    if (b < a) near[e.from] = true;
  });
  return (e) => ((far[e.from] || far[e.to]) && !(near[e.from] || near[e.to]) ? 'near' : 'far');
}

// A stand-in for the page's outline insets: a diamond's sides slope away from its vertices, an io slants
function outlineInset(node, r, side, along) {
  if (node.type === 'decision') {
    const horiz = side === 'top' || side === 'bottom';
    const half = horiz ? r.w / 2 : r.h / 2, c = horiz ? r.x + r.w / 2 : r.y + r.h / 2;
    return (Math.min(half, Math.abs(along - c)) / half) * (horiz ? r.h / 2 : r.w / 2);
  }
  return node.type === 'io' && (side === 'left' || side === 'right') ? 8 : 0;
}

// Screen boxes from an engine layout: x runs along the flow, y across it inside the node's lane
function modelFromLayout(d) {
  const tb = d.direction === 'TB';
  const S = SIZE[tb ? 'TB' : 'LR'];
  const lanes = d.lanes && d.lanes.length ? d.lanes : [{ id: '__lane', height: 192 }];
  const laneTop = {}, laneDividers = [];
  let off = 0;
  lanes.forEach((l, i) => {
    laneTop[l.id] = off;
    off += l.height || (tb ? 240 : 192);
    if (i < lanes.length - 1) laneDividers.push(off);
  });
  const boxes = {};
  d.nodes.forEach(n => {
    if (typeof n.x !== 'number' || typeof n.y !== 'number') return;
    const across = n.type === 'decision' ? S.decision : S.across;
    const a = n.x, c = (laneTop[n.laneId] ?? laneTop[lanes[0].id]) + n.y;
    boxes[n.id] = tb ? { x: c, y: a, w: across, h: S.along } : { x: a, y: c, w: S.along, h: across };
  });
  return {
    chartData: { nodes: d.nodes, edges: d.edges }, tb, boxes, laneDividers,
    loopSide: loopSides(d.nodes, d.edges, lanes), outlineInset, labelMaxW: 140,
  };
}

// mulberry32: a small seeded PRNG, so the synthetic diagrams are the same on every run
function prng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPES = ['task', 'task', 'task', 'decision', 'io', 'document', 'database', 'subprocess', 'start', 'end', 'delay', 'connector'];
const WORDS = ['yes', 'no', 'retry', 'approved', 'needs more information', 'timeout', 'escalate to manager', 'ok', ''];

// A layered diagram: columns along the flow, lanes across it, jittered to 0.01px like the page's measured boxes
function synthetic(seed, N, tb) {
  const rnd = prng(seed);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const laneCount = 1 + Math.floor(rnd() * 6);
  const lanes = Array.from({ length: laneCount }, (_, i) => ({ id: `L${i}`, height: 160 + Math.floor(rnd() * 5) * 32 }));
  const cols = Math.max(2, Math.ceil(N / (laneCount * (1 + rnd() * 2))));
  const nodes = [], col = {};
  for (let i = 0; i < N; i++) {
    const lane = pick(lanes);
    const c = Math.floor((i / N) * cols + rnd() * 1.5);
    const x = Math.round((40 + c * (190 + rnd() * 40) + rnd() * 30) * 100) / 100;
    const y = Math.round((24 + rnd() * (lane.height - 120)) * 100) / 100;
    const n = { id: `s${i}`, laneId: lane.id, type: pick(TYPES), label: `Step ${i}`, x, y };
    nodes.push(n);
    col[n.id] = c;
  }
  const edges = [];
  let k = 0;
  const edge = (from, to, extra = {}) => edges.push({ id: `e${k++}`, from, to, label: rnd() < 0.35 ? pick(WORDS) : '', ...extra });
  for (let i = 1; i < N; i++) {
    edge(nodes[i - 1].id, nodes[i].id);
    const r = rnd();
    if (r < 0.18) edge(nodes[i].id, nodes[Math.min(N - 1, i + 1 + Math.floor(rnd() * 6))].id);       // forward skip / fork
    else if (r < 0.28) edge(nodes[i].id, nodes[Math.floor(rnd() * i)].id, { feedback: true });       // loop-back
    else if (r < 0.31) edge(nodes[i].id, nodes[i - 1].id);                                          // two-way pair
    else if (r < 0.32) edge(nodes[i].id, nodes[i].id);                                              // self loop
    else if (r < 0.34) edge(nodes[i - 1].id, nodes[i].id);                                          // parallel duplicate
  }
  if (N > 4) edges.push({ id: 'ghost', from: nodes[0].id, to: 'missing' });                        // an arrow without a box
  return modelFromLayout({ direction: tb ? 'TB' : 'LR', lanes, nodes, edges });
}

const cases = [];
const goldenDir = at('../fixtures/flowchart/golden/');
for (const f of readdirSync(goldenDir).filter(f => f.endsWith('.json')).sort()) {
  const d = JSON.parse(readFileSync(goldenDir + f, 'utf8'));
  cases.push([`golden/${f}`, () => modelFromLayout(d)]);
  // the same layout routed the other way round, so every fixture runs through both the LR and the TB paths
  cases.push([`golden/${f} (flipped)`, () => modelFromLayout({ ...d, direction: d.direction === 'TB' ? 'LR' : 'TB' })]);
}
for (const N of [25, 100]) cases.push([`grid ${N}`, () => gridModel(N)]);
const SIZES = [10, 12, 16, 20, 25, 32, 40, 50, 64, 80, 100, 128, 160, 200, 300];
SIZES.forEach((N, i) => {
  cases.push([`synthetic LR n=${N}`, () => synthetic(1000 + i, N, false)]);
  cases.push([`synthetic TB n=${N}`, () => synthetic(2000 + i, N, true)]);
});
// many small, crowded diagrams: cheap, and where tie-breaks between near-equal routes happen most
for (let i = 0; i < 60; i++) cases.push([`synthetic small #${i}`, () => synthetic(3000 + i, 10 + (i * 7) % 50, i % 2 === 1)]);

let failures = 0;
for (const [name, make] of cases) {
  const a = JSON.stringify(current(make())), b = JSON.stringify(baseline(make()));
  if (a !== b) {
    failures++;
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    console.log(`  FAIL ${name}: output differs at char ${i}\n    new:      ${a.slice(Math.max(0, i - 80), i + 80)}\n    baseline: ${b.slice(Math.max(0, i - 80), i + 80)}`);
  }
}
console.log(failures ? `router equivalence: ${failures} of ${cases.length} cases differ` : `router equivalence: ${cases.length} cases identical`);
process.exit(failures ? 1 : 0);
