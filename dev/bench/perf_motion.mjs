// Main-thread cost of the motion system under a 4x CPU throttle (plan: dev/plans/plan-animations.md section 7.3).
// For one animated action per diagram type it reports long tasks (> 50ms, PerformanceObserver), the forced-layout and
// style-recalc counts (CDP Performance metrics: LayoutCount, RecalcStyleCount, LayoutDuration), and the rAF frame-time
// p95 while the animation runs, each also with motion off (prefers-reduced-motion emulated) as the baseline: the layout
// engine's own cost is not the motion system's. Exits 2 only when motion adds a lot on top of that baseline. Driven over CDP, see cdp.mjs.
//
//   node dev/perf_motion.mjs --browser <chrome> --flowchart <html> --sequence <html> --erd <html> --usecase <html> [--throttle 4]
//
// Pages: flowchart = a large one (employee-onboarding.json, 57 steps; undo of a delete), sequence = checkout-with-fragments
// (Focus), erd = saas-billing.json (Columns view toggle), usecase = library-platform.json (collapse a subject).
import { argOf, launch, sleep } from '../tests/e2e/cdp.mjs';

const browser = argOf('browser');
const pages = { flowchart: argOf('flowchart'), sequence: argOf('sequence'), erd: argOf('erd'), usecase: argOf('usecase') };
if (!browser || Object.values(pages).some((p) => !p)) {
  console.error('usage: --browser <chrome> --flowchart <html> --sequence <html> --erd <html> --usecase <html> [--throttle 4]');
  process.exit(1);
}
const RATE = Number(argOf('throttle') || 4);
// Generous: a regression that blocks the main thread for half a second or drops the animation to a slideshow
// (the thresholds compare motion on with the same action under reduced motion)
const EXTRA_LONG_TASK_MS = 400, MAX_P95_FRAME_MS = 100, EXTRA_LAYOUTS = 40;

const ACTIONS = {
  flowchart: { prep: async (t) => { await t.ev(t.drag('.flow-node')); await t.ev(t.key('Delete')); await sleep(800); }, run: (t) => t.key('z', { ctrlKey: true }), label: 'undo a delete (57 steps)' },
  sequence: { run: () => `document.querySelector('.seq-frag-focus').click()`, label: 'Focus a fragment' },
  erd: { run: () => `document.getElementById('btn-columns').click()`, label: 'Columns view toggle (30 tables)' },
  usecase: { run: () => `document.querySelector('.uc-subject .chevron').click()`, label: 'collapse a subject' },
};

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
const rows = [];
try {
  await t.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await t.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const measure = async (type, reduced) => {
    const a = ACTIONS[type];
    await t.send('Emulation.setEmulatedMedia', { features: reduced ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : [] });
    await t.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await t.open(pages[type]);
    if (a.prep) await a.prep(t);
    await t.ev(`window.__long = []; window.__frames = [];
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({ entryTypes: ['longtask'] }); true`);
    await t.send('Emulation.setCPUThrottlingRate', { rate: RATE });
    const m0 = await metrics();
    // rAF sampler runs from just before the action until 700ms after it, so it covers the whole animation
    await t.ev(`(() => { let last = performance.now(); const end = last + 1500;
      const tick = (now) => { window.__frames.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); };
      requestAnimationFrame(tick); return true; })()`);
    await sleep(50);
    const anims = await t.ev(`(() => { ${a.run(t)}; return document.getAnimations().length; })()`);
    await sleep(1600);
    const m1 = await metrics();
    await t.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const { long, frames } = await t.ev(`({ long: window.__long, frames: window.__frames.slice(1) })`);
    const sorted = [...frames].sort((x, y) => x - y);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 0;
    // frames after the animation are idle rAF (about 16.7ms) and dilute the p95, so the worst three are reported too
    const worst = sorted.slice(-3).map((x) => Math.round(x));
    return {
      type, action: a.label, anims,
      longTasks: long.length, longest: Math.round(Math.max(0, ...long)),
      layouts: Math.round(m1.LayoutCount - m0.LayoutCount), recalcs: Math.round(m1.RecalcStyleCount - m0.RecalcStyleCount),
      layoutMs: Math.round((m1.LayoutDuration - m0.LayoutDuration) * 1000), scriptMs: Math.round((m1.ScriptDuration - m0.ScriptDuration) * 1000),
      p95: Math.round(p95 * 10) / 10, worst,
    };
  };
  for (const type of Object.keys(ACTIONS)) rows.push({ on: await measure(type, false), off: await measure(type, true) });
  await t.send('Emulation.setEmulatedMedia', { features: [] });
  console.log(`CPU throttle ${RATE}x (long task > 50ms; frame times in ms; layouts/recalcs counted over the action plus 1.6s)`);
  const line = (r) => `animations=${r.anims} longTasks=${r.longTasks} (longest ${r.longest}ms) layouts=${r.layouts} recalcs=${r.recalcs} layout=${r.layoutMs}ms script=${r.scriptMs}ms frame p95=${r.p95}ms worst=${r.worst.join('/')}ms`;
  for (const { on, off } of rows) {
    console.log(`${on.type.padEnd(9)} ${on.action}\n  motion on : ${line(on)}\n  motion off: ${line(off)}`);
    const bad = [];
    if (on.longest > off.longest * 1.5 + EXTRA_LONG_TASK_MS) bad.push(`long task ${on.longest}ms vs ${off.longest}ms off`);
    if (on.p95 > MAX_P95_FRAME_MS && on.p95 > off.p95 * 1.5) bad.push(`frame p95 ${on.p95}ms > ${MAX_P95_FRAME_MS}`);
    if (on.layouts > off.layouts + EXTRA_LAYOUTS) bad.push(`${on.layouts} layouts vs ${off.layouts} off`);
    if (bad.length) { console.log(`[FAIL] ${on.type}: ${bad.join('; ')}`); code = 2; }
  }
} catch (e) {
  console.error('[ERROR]', e.message);
  code = 1;
} finally {
  await t.close();
}
process.exit(code);
