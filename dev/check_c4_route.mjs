// C4 gutter routing check: loads ortho-router.js then assets/types/c4/route.js the way scripts/run_engine.mjs does and checks the
// Gutter routing interface of dev/plans/plan-c4.md on a hand-made scene (2x2 centre grid, three rings on four sides, groups, loops)
// and on a 5,000-edge grid (timing). Usage: node dev/check_c4_route.mjs     Exit code 0 when every check passes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const tokens = JSON.parse(readFileSync(at('../assets/tokens/default.json'), 'utf8'));
const src = readFileSync(at('../assets/shell/ortho-router.js'), 'utf8') + '\n' + readFileSync(at('../assets/types/c4/route.js'), 'utf8');
const { routeC4Edges } = new Function('TOKENS', `${src}\nreturn { routeC4Edges };`)(tokens);

let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log(`  FAIL ${msg}`); } };

// ---------- scene ----------
const BW = 150, BH = 110, PAD = 16, TAG = 30;
const nodes = {}, frames = {};
function frameOf(id, ids) {
  const bs = ids.map((i) => nodes[i]);
  const x0 = Math.min(...bs.map((b) => b.x - b.w / 2)) - PAD, x1 = Math.max(...bs.map((b) => b.x + b.w / 2)) + PAD;
  const y0 = Math.min(...bs.map((b) => b.y - b.h / 2)) - PAD - TAG, y1 = Math.max(...bs.map((b) => b.y + b.h / 2)) + PAD;
  const item = { id, x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  frames[id] = item;
  ids.forEach((i) => { nodes[i].item = item; });
}
const box = (id, x, y) => { nodes[id] = { x, y, w: BW, h: BH }; };
const loose = (id, x, y) => { box(id, x, y); nodes[id].item = { id, x, y, w: BW, h: BH }; };
// centre: 2x2 grid of loose elements
loose('C00', -130, -100); loose('C01', 130, -100); loose('C10', -130, 100); loose('C11', 130, 100);
// ring 1 and 2, one framed group per side and ring
[[-1, 'N', 'y'], [1, 'S', 'y']].forEach(([sg, n]) => {
  [1, 2].forEach((r) => {
    const ids = (r === 1 ? [-200, 0, 200] : [-100, 100]).map((x, k) => { const id = `${n}${r}_${k}`; box(id, x, sg * (r === 1 ? 345 : 650)); return id; });
    frameOf(`G${n}${r}`, ids);
  });
});
[[-1, 'W'], [1, 'E']].forEach(([sg, n]) => {
  [1, 2].forEach((r) => {
    const ids = [-100, 100].map((y, k) => { const id = `${n}${r}_${k}`; box(id, sg * (r === 1 ? 480 : 900), y); return id; });
    frameOf(`G${n}${r}`, ids);
  });
});
const E = (from, to, hint, label = 'Reads', tech = 'HTTPS') => ({ from, to, label, tech, hint });
const edges = [
  E('N1_0', 'C00', 'v'), E('N1_1', 'C00', 'v'), E('N1_1', 'C01', 'v', 'Publishes events to the bus', 'AMQP'), E('N1_2', 'C01', 'v'),
  E('N2_0', 'N1_0', 'v'), E('N2_0', 'N1_1', 'v'), E('N2_1', 'N1_1', 'v'), E('N2_1', 'N1_2', 'v'),
  E('C10', 'S1_0', 'v'), E('S1_1', 'C10', 'v'), E('S1_1', 'C11', 'v'), E('S1_2', 'C11', 'v'),
  E('S1_0', 'S2_0', 'v'), E('S1_2', 'S2_1', 'v'), E('S1_1', 'S2_0', 'v'),
  E('E1_0', 'C01', 'h'), E('E1_1', 'C01', 'h'), E('C11', 'E1_1', 'h'), E('E2_0', 'E1_0', 'h'), E('E2_1', 'E1_0', 'h'), E('E2_1', 'E1_1', 'h'),
  E('C00', 'W1_0', 'h'), E('W1_1', 'C00', 'h'), E('W1_1', 'C10', 'h'), E('W2_0', 'W1_0', 'h'), E('W2_1', 'W1_0', 'h'),
  E('S1_0', 'S1_2', 'u', 'Backs up'), E('S1_0', 'S1_1', 'u', 'Replicates'), E('S1_1', 'S1_2', 'u', 'Syncs'), E('S1_2', 'S1_0', 'u', 'Audits', ''),
  E('C00', 'C01'), E('C10', 'C11', undefined, 'Calls'), E('C00', 'C10'), E('N1_0', 'W1_0', undefined, ''),
];
// itemA / itemB of an edge: the two sibling items under the lowest group holding both ends (here: frames are one level, so the
// two frames, or the two boxes when both ends share a frame)
const boxItem = (id) => ({ id, x: nodes[id].x, y: nodes[id].y, w: nodes[id].w, h: nodes[id].h });
edges.forEach((e) => {
  const same = nodes[e.from].item.id === nodes[e.to].item.id;
  e.itemA = same ? boxItem(e.from) : nodes[e.from].item; e.itemB = same ? boxItem(e.to) : nodes[e.to].item;
});
const plain = (ns) => Object.fromEntries(Object.entries(ns).map(([k, n]) => [k, { x: n.x, y: n.y, w: n.w, h: n.h }]));
const res = routeC4Edges(plain(nodes), edges);

// ---------- geometry helpers ----------
const rectOf = (n) => ({ x0: n.x - n.w / 2, x1: n.x + n.w / 2, y0: n.y - n.h / 2, y1: n.y + n.h / 2 });
const frameRect = (f) => rectOf(f);
const has = (r, p) => p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1;
const segs = (pts) => pts.slice(1).map((q, i) => [pts[i], q]);
const hits = (s, r) => {   // axis-parallel segment through the interior of r (1px shrink)
  const [p, q] = s, e = 1;
  const x0 = Math.min(p[0], q[0]), x1 = Math.max(p[0], q[0]), y0 = Math.min(p[1], q[1]), y1 = Math.max(p[1], q[1]);
  return x1 > r.x0 + e && x0 < r.x1 - e && y1 > r.y0 + e && y0 < r.y1 - e;
};
const eq = (a, b) => Math.abs(a - b) < 0.01;

function checkScene() {
  check(res.length === edges.length, 'one result per edge');
  const items = {}; for (const id in nodes) items[nodes[id].item.id] = nodes[id].item;
  edges.forEach((e, i) => {
    const r = res[i], A = nodes[e.from], B = nodes[e.to], tag = `${e.from}>${e.to}[${e.hint || 'auto'}]`;
    check(typeof r.d === 'string' && r.d.startsWith('M') && Array.isArray(r.points) && r.points.length >= 2, `${tag} has d and points`);
    const ss = segs(r.points);
    check(ss.every(([p, q]) => eq(p[0], q[0]) || eq(p[1], q[1])), `${tag} is orthogonal`);
    if (e.hint === 'u') check(r.points.length === 4, `${tag} loop has two bends`);
    else check(r.points.length <= 4, `${tag} has at most one bend run`);
    // never through a box or a frame it does not belong to
    for (const id in nodes) if (id !== e.from && id !== e.to) check(!ss.some((s) => hits(s, rectOf(nodes[id]))), `${tag} crosses box ${id}`);
    for (const id in items) if (id !== A.item.id && id !== B.item.id && !items[id].isBox) check(!ss.some((s) => hits(s, frameRect(items[id]))), `${tag} crosses frame ${id}`);
    check(!ss.some((s) => hits(s, rectOf(A)) || hits(s, rectOf(B))), `${tag} runs through its own boxes`);
    // the run lies in the gutter between the facing edges of the two items
    if (e.hint !== 'u' && r.points.length === 4) {
      const vert = eq(r.points[0][0], r.points[1][0]), M = vert ? 1 : 0, S = vert ? 'h' : 'w', c = vert ? 'y' : 'x';
      const [lo, hi] = e.itemA[c] < e.itemB[c]
        ? [e.itemA[c] + e.itemA[S] / 2, e.itemB[c] - e.itemB[S] / 2] : [e.itemB[c] + e.itemB[S] / 2, e.itemA[c] - e.itemA[S] / 2];
      check(r.points[1][M] >= lo - 0.01 && r.points[1][M] <= hi + 0.01, `${tag} run ${r.points[1][M]} outside gutter [${lo}, ${hi}]`);
    }
  });

  // ports on one side: target order, no two alike
  const side = new Map();
  edges.forEach((e, i) => {
    const pts = res[i].points;
    [[e.from, pts[0], e.hint === 'u' ? nodes[e.to].x : null, e.to], [e.to, pts[pts.length - 1], e.hint === 'u' ? nodes[e.from].x : null, e.from]].forEach(([id, p, , other]) => {
      const r = rectOf(nodes[id]);
      const sd = eq(p[1], r.y0) ? 'T' : eq(p[1], r.y1) ? 'B' : eq(p[0], r.x0) ? 'L' : 'R';
      const k = id + sd, along = sd === 'T' || sd === 'B' ? p[0] : p[1], tgt = sd === 'T' || sd === 'B' ? nodes[other].x : nodes[other].y;
      (side.get(k) || side.set(k, []).get(k)).push({ along, tgt, other, i });
    });
  });
  for (const [k, g] of side) {
    g.sort((a, b) => a.along - b.along);
    for (let j = 1; j < g.length; j++) {
      check(g[j].along - g[j - 1].along > 1, `ports coincide on ${k} (edges ${g[j - 1].i}, ${g[j].i})`);
      check(g[j].tgt >= g[j - 1].tgt - 0.01, `ports out of target order on ${k} (edges ${g[j - 1].i}, ${g[j].i})`);
    }
  }

  // loops staggered 16px apart where they overlap along x
  const loops = edges.map((e, i) => [e, res[i], i]).filter(([e]) => e.hint === 'u');
  for (let a = 0; a < loops.length; a++) for (let b = a + 1; b < loops.length; b++) {
    const [, ra] = loops[a], [, rb] = loops[b], ya = ra.points[1][1], yb = rb.points[1][1];
    const xa = [Math.min(ra.points[1][0], ra.points[2][0]), Math.max(ra.points[1][0], ra.points[2][0])], xb = [Math.min(rb.points[1][0], rb.points[2][0]), Math.max(rb.points[1][0], rb.points[2][0])];
    if (xa[1] > xb[0] && xb[1] > xa[0]) check(Math.abs(ya - yb) >= 16 - 0.01, `loops ${loops[a][2]} and ${loops[b][2]} share a gutter line`);
  }

  // label pills do not overlap
  const pills = res.map((r, i) => ({ i, x0: r.lx - r.w / 2, x1: r.lx + r.w / 2, y0: r.ly - 16, y1: r.ly + 16, w: r.w })).filter((p) => p.w > 0);
  for (let a = 0; a < pills.length; a++) for (let b = a + 1; b < pills.length; b++) {
    const p = pills[a], q = pills[b];
    check(!(p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1), `label pills of edges ${p.i} and ${q.i} overlap`);
  }
  pills.forEach((p) => { for (const id in nodes) { const r = rectOf(nodes[id]); check(!(p.x0 < r.x1 && r.x0 < p.x1 && p.y0 < r.y1 && r.y0 < p.y1), `label of edge ${p.i} sits on box ${id}`); } });
  check(res[edges.length - 1].w === 0, 'an empty label has no pill');
}

// pills sit on no tag band and on no other route's line
function checkPills(results, pills, frameList) {
  for (const p of pills) {
    for (const f of frameList) { const r = frameRect(f); check(!(p.x0 < r.x1 && r.x0 < p.x1 && p.y0 < r.y0 + TAG && r.y0 < p.y1), `label of edge ${p.i} sits on the tag band of ${f.id}`); }
    results.forEach((o, j) => { if (j !== p.i) check(!segs(o.points).some((s) => hits(s, { x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1 })), `label of edge ${p.i} sits on the route of edge ${j}`); });
  }
}
checkScene();


// ---------- nested groups, 3 levels like dev/fixtures/c4/landscape.json ----------
// ShopCo > Order Platform > Web App, API Gateway, Order DB (a row); CRM beside Order Platform; User above; Payment to the right.
{
  const nn = {}, fr = {};
  const put = (id, x, y) => { nn[id] = { x, y, w: BW, h: BH }; };
  const wrap = (id, members) => {
    const rs = members.map((m) => rectOf(nn[m] || fr[m]));
    const x0 = Math.min(...rs.map((r) => r.x0)) - PAD, x1 = Math.max(...rs.map((r) => r.x1)) + PAD;
    const y0 = Math.min(...rs.map((r) => r.y0)) - PAD - TAG, y1 = Math.max(...rs.map((r) => r.y1)) + PAD;
    fr[id] = { id, x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  };
  put('Web', 0, 0); put('Api', 200, 0); put('Db', 400, 0); wrap('OP', ['Web', 'Api', 'Db']);
  put('Crm', 850, 0); nn.Crm.h = 220; wrap('Shop', ['OP', 'Crm']);
  put('User', 200, -420); put('Pay', 1300, 0); put('Q', 200, 420);
  const it = (id) => fr[id] || { id, ...nn[id] };
  const N = (from, to, iA, iB, hint, label = 'Uses', tech = 'HTTPS') => ({ from, to, label, tech, hint, itemA: it(iA), itemB: it(iB) });
  const ed = [
    N('Web', 'Crm', 'OP', 'Crm', undefined, 'Syncs customers'), N('Api', 'Crm', 'OP', 'Crm', undefined, 'Syncs orders'), N('Db', 'Crm', 'OP', 'Crm'),
    N('Crm', 'Web', 'Crm', 'OP', undefined, 'Pulls profiles'), N('User', 'Web', 'User', 'Shop', undefined, 'Shops'),
    N('Db', 'Pay', 'Shop', 'Pay', undefined, 'Charges cards'), N('Web', 'Db', 'Web', 'Db', 'u', 'Replicates'), N('Api', 'Q', 'Shop', 'Q', undefined, 'Queues jobs'),
  ];
  const rr = routeC4Edges(nn, ed), frs = Object.values(fr);
  ed.forEach((e, i) => {
    const pts = rr[i].points, ss = segs(pts), tag = `nested ${e.from}>${e.to}`, A = nn[e.from], B = nn[e.to];
    check(ss.every(([p, q]) => eq(p[0], q[0]) || eq(p[1], q[1])), `${tag} is orthogonal`);
    for (const id in nn) if (id !== e.from && id !== e.to) check(!ss.some((s) => hits(s, rectOf(nn[id]))), `${tag} crosses box ${id}`);
    for (const f of frs) if (!has(frameRect(f), A) && !has(frameRect(f), B)) check(!ss.some((s) => hits(s, frameRect(f))), `${tag} crosses frame ${f.id} it does not enter`);
    check(!ss.some((s) => hits(s, rectOf(A)) || hits(s, rectOf(B))), `${tag} runs through its own boxes`);
  });
  // the Web>Crm / Api>Crm / Db>Pay routes leave through the frame padding (two bends more), not through a sibling
  check(rr[0].points.length === 5 && rr[1].points.length === 5, 'a middle element leaves through the padding of its frame');
  check(rr[5].points.length === 5, 'Order DB leaves Shop through the padding, not through CRM');
  // no two routes share a line stretch
  for (let a = 0; a < rr.length; a++) for (let b = a + 1; b < rr.length; b++) for (const [p, q] of segs(rr[a].points)) for (const [u, v] of segs(rr[b].points)) {
    const h = eq(p[1], q[1]) && eq(u[1], v[1]) && eq(p[1], u[1]), vv = eq(p[0], q[0]) && eq(u[0], v[0]) && eq(p[0], u[0]);
    if (h) check(Math.min(Math.max(p[0], q[0]), Math.max(u[0], v[0])) - Math.max(Math.min(p[0], q[0]), Math.min(u[0], v[0])) <= 1, `nested routes ${a} and ${b} share a horizontal line`);
    if (vv) check(Math.min(Math.max(p[1], q[1]), Math.max(u[1], v[1])) - Math.max(Math.min(p[1], q[1]), Math.min(u[1], v[1])) <= 1, `nested routes ${a} and ${b} share a vertical line`);
  }
  // pills: not on a box, a tag band or another route, not on each other
  const pl = rr.map((r, i) => ({ i, x0: r.lx - r.w / 2, x1: r.lx + r.w / 2, y0: r.ly - 16, y1: r.ly + 16, w: r.w })).filter((p) => p.w > 0);
  pl.forEach((p, a) => {
    for (const id in nn) check(!(p.x0 < rectOf(nn[id]).x1 && rectOf(nn[id]).x0 < p.x1 && p.y0 < rectOf(nn[id]).y1 && rectOf(nn[id]).y0 < p.y1), `nested label ${p.i} sits on box ${id}`);
    for (const q of pl.slice(a + 1)) check(!(p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1), `nested labels ${p.i} and ${q.i} overlap`);
  });
  checkPills(rr, pl, frs);
  check(JSON.stringify(routeC4Edges(nn, ed)) === JSON.stringify(rr), 'nested scene is deterministic');
}

// near-aligned ends give a straight route; a far-apart pair bends
{
  const n = { a: { x: 0, y: 0, w: 100, h: 60 }, b: { x: 12, y: 200, w: 100, h: 60 }, c: { x: 90, y: 400, w: 100, h: 60 } };
  const r = routeC4Edges(n, [{ from: 'a', to: 'b', label: 'x' }]), r2 = routeC4Edges(n, [{ from: 'a', to: 'c', label: 'y', hint: 'v' }]);   // no itemA/itemB: the boxes
  check(r[0].points.length === 2 && r[0].points[0][0] === r[0].points[1][0], 'near-aligned ends give a straight route');
  check(r2[0].points.length === 4, 'far-apart ends bend');
}

// determinism
check(JSON.stringify(routeC4Edges(plain(nodes), edges)) === JSON.stringify(res), 'same input, byte-equal output');

// ---------- 5,000 edges ----------
{
  const cols = 50, rows = 40, big = {}, bigEdges = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const id = `n${r}_${c}`; big[id] = { x: c * 260, y: r * 260, w: 150, h: 110 };
  }
  for (let k = 0; k < 5000; k++) {
    const r = k % rows, c = (k * 7) % cols, r2 = Math.min(rows - 1, r + 1 + (k % 3 === 0 ? 1 : 0)), c2 = Math.min(cols - 1, Math.max(0, c + (k % 5) - 2));
    const hint = k % 11 === 0 ? 'u' : undefined;
    bigEdges.push({ from: `n${r}_${c}`, to: hint ? `n${r}_${Math.min(cols - 1, c + 1 + (k % 4))}` : `n${r2}_${c2}`, label: `Link ${k}`, tech: k % 2 ? 'gRPC' : '', hint });
  }
  const t0 = process.hrtime.bigint();
  const out = routeC4Edges(big, bigEdges);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`5,000 edges on ${Object.keys(big).length} boxes: ${ms.toFixed(0)} ms`);
  check(out.length === 5000, '5,000 results');
  check(ms < 1000, `5,000 edges took ${ms.toFixed(0)} ms (limit 1000)`);
}

console.log(failures ? `${failures} check(s) failed` : `OK: ${edges.length} edges routed, all checks passed`);
process.exit(failures ? 1 : 0);
