// Router perf budget: routes the 400-node synthetic grid of dev/bench/bench_router.mjs through assets/shell/ortho-router.js
// and fails when the best of three passes exceeds CEILING_MS. The ceiling is about 3x the measured time (~500 ms on a
// loaded 4-core dev box; the pre-index router took ~5 s), so it catches a return to whole-diagram scans, not CPU noise.
// Usage: node dev/tests/unit/check_router_perf.mjs     Exit code 0 when within budget.
import { loadRouter, timePass } from '../../bench/bench_router.mjs';

const N = 400, CEILING_MS = 1500;
const route = loadRouter();
timePass(route, 25);                       // warm the JIT on a small grid first
const ms = timePass(route, N, 3);
const ok = ms <= CEILING_MS;
console.log(`router perf: ${N}-node grid ${ms.toFixed(0)} ms (ceiling ${CEILING_MS} ms) ${ok ? 'ok' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
