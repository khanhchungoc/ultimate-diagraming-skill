// Router speed bench: routes synthetic N-node grids (chain + every-5th cross edge) through assets/shell/ortho-router.js
// and prints ms per pass. Usage: node dev/bench/bench_router.mjs [sizes...]   (default 25 100 400 1000)
// Usage: node dev/bench/bench_router.mjs --baseline [sizes...]   times the frozen pre-index router instead
// Zero dependencies. The router loads through new Function with TOKENS in scope, as scripts/run_engine.mjs loads it
// (a node:vm context makes every global lookup several times slower, which skews the numbers).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));

export const BASELINE_ROUTER = at('../tests/fixtures/router/ortho-router.baseline.js');

// Loads a router file in its own scope and returns its routeEdgesOrthogonal
export function loadRouter(routerPath = at('../../assets/shell/ortho-router.js')) {
  const tokens = JSON.parse(readFileSync(at('../../assets/tokens/default.json'), 'utf8'));
  const prefix = routerPath === BASELINE_ROUTER ? '' : `${readFileSync(at('../../assets/shell/curve-path.js'), 'utf8')}\n`;
  return new Function('TOKENS', `${prefix}${readFileSync(routerPath, 'utf8')}\nreturn routeEdgesOrthogonal;`)(tokens);
}

// The grid the review measured: sqrt(N) columns, 220 x 140 px pitch, 160 x 60 px boxes, LR, no lanes
export function gridModel(N) {
  const nodes = [], edges = [], boxes = {};
  const cols = Math.ceil(Math.sqrt(N));
  for (let i = 0; i < N; i++) {
    nodes.push({ id: `n${i}`, type: 'task' });
    boxes[`n${i}`] = { x: (i % cols) * 220, y: Math.floor(i / cols) * 140, w: 160, h: 60 };
  }
  for (let i = 1; i < N; i++) {
    edges.push({ id: `e${i}`, from: `n${i - 1}`, to: `n${i}` });
    if (i % 5 === 0) edges.push({ id: `x${i}`, from: `n${i}`, to: `n${(i * 7) % N}` });
  }
  return { chartData: { nodes, edges }, tb: false, boxes, laneDividers: [], loopSide: () => 'far', labelMaxW: 140 };
}

// ms for one routing pass (best of `runs`, so a GC pause does not decide the number)
export function timePass(route, N, runs = 1) {
  let best = Infinity;
  for (let r = 0; r < runs; r++) {
    const model = gridModel(N);
    const t = performance.now();
    route(model);
    best = Math.min(best, performance.now() - t);
  }
  return best;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sizes = process.argv.slice(2).map(Number).filter(n => n > 0);
  const route = loadRouter(process.argv.includes('--baseline') ? BASELINE_ROUTER : undefined);
  for (const N of sizes.length ? sizes : [25, 100, 400, 1000]) {
    const { chartData } = gridModel(N);
    console.log(`${String(N).padStart(5)} nodes ${String(chartData.edges.length).padStart(5)} edges ${timePass(route, N).toFixed(0).padStart(7)} ms`);
  }
}
