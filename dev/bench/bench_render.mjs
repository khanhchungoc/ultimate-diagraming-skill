// Flowchart render-path bench: lays out a synthetic N-step flowchart (default 500) with scripts/layout_engine.py,
// opens it in headless Chrome and reports
//   render    ms for one Undo or Redo (median of --runs): restoreSnapshot -> render(), with the layout it forces
//             read at the end
//   drag      main-thread busy ms (CDP Performance: script + layout + style) for a 60-move pointer drag of one
//             connected step, and that per move
// Motion is off (prefers-reduced-motion) so only the render path is timed. Driven over CDP, see cdp.mjs (zero deps).
//
//   node dev/bench/bench_render.mjs [--nodes 500] [--runs 5] [--moves 60] [--browser <chrome>] [--html <prebuilt.html>]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argOf, findBrowser, launch } from '../tests/e2e/cdp.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const N = Number(argOf('nodes') || 500), RUNS = Number(argOf('runs') || 5), MOVES = Number(argOf('moves') || 60);

// N steps over 6 lanes: a main chain with a decision every 12th step (yes: on, no: back 5 steps), so the page has
// cross-lane arrows, loop-backs and labels like a real chart
export function syntheticFlow(n) {
  const lanes = Array.from({ length: 6 }, (_, i) => ({ id: `l${i}`, name: `Lane ${i + 1}` }));
  const nodes = [], edges = [];
  for (let i = 0; i < n; i++) {
    const type = i === 0 ? 'start' : i === n - 1 ? 'end' : i % 12 === 0 ? 'decision' : 'task';
    nodes.push({ id: `n${i}`, laneId: `l${Math.floor(i / 3) % 6}`, type, label: type === 'decision' ? `Check ${i}?` : `Step ${i}` });
    if (i === 0) continue;
    const prev = nodes[i - 1];
    edges.push({ id: `e${i}`, from: prev.id, to: `n${i}`, ...(prev.type === 'decision' ? { label: 'Yes' } : {}) });
    if (type === 'decision' && i > 6) edges.push({ id: `b${i}`, from: `n${i}`, to: `n${i - 5}`, label: 'No', feedback: true });
  }
  // a decision's own "yes" arrow is the next chain arrow; its label was set above from the previous step
  return { diagramType: 'flowchart', title: `Bench ${n} steps`, lanes, nodes, edges };
}

function buildPage(n) {
  const dir = mkdtempSync(join(tmpdir(), 'bench_render_'));
  const src = join(dir, 'flow.json'), out = join(dir, 'flow.html');
  writeFileSync(src, JSON.stringify(syntheticFlow(n)));
  const r = spawnSync('python3', [join(root, 'scripts', 'layout_engine.py'), '--layout', src, '-o', out, '--timeout', '600'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`layout failed:\n${r.stdout}\n${r.stderr}`);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const browser = findBrowser(argOf('browser'));
  if (!browser) { console.error('[ERROR] Chrome/Chromium not found. Pass --browser <path>.'); process.exit(1); }
  const html = argOf('html') || buildPage(N);
  console.log(`page ${html} (reuse with --html)`);
  const t = await launch(browser);
  try {
    await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await t.open(html);
    const counts = await t.ev(`({ nodes: document.querySelectorAll('.flow-node').length, edges: document.querySelectorAll('.edge-line').length })`);
    // render() lives inside the page script, so it is reached the way a user reaches it: Undo / Redo restore a
    // snapshot and call render() (shell.js restoreSnapshot). One cheap edit (the title) gives them something to restore.
    await t.ev(`(() => { const h = document.getElementById('chart-title'); h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      h.textContent = 'Bench edit'; h.blur(); if (h.isContentEditable) h.dispatchEvent(new FocusEvent('blur')); return true; })()`);
    const renders = await t.ev(`(() => { const out = [], undo = document.getElementById('btn-undo'), redo = document.getElementById('btn-redo');
      for (let i = 0; i < ${RUNS + 1}; i++) {
        const t0 = performance.now(); (i % 2 ? redo : undo).click(); document.body.offsetHeight; out.push(performance.now() - t0);
      }
      return out.slice(1); })()`);   // the first call warms up
    renders.sort((a, b) => a - b);

    // Drag: a step in the middle of the chart with arrows, moved across a lane and back along the flow
    const start = await t.ev(`(() => { const id = 'n${Math.floor(N / 2) + 1}', el = document.getElementById('node-' + id);
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await t.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await t.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    const busy = (m) => m.ScriptDuration + m.LayoutDuration + m.RecalcStyleDuration;
    const mouse = (type, x, y) => t.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
    await mouse('mousePressed', start.x, start.y);
    const m0 = await metrics();
    for (let i = 1; i <= MOVES; i++) {
      await mouse('mouseMoved', start.x + i * 3, start.y + Math.sin(i / 10) * 90);
      await t.ev(`new Promise((r) => requestAnimationFrame(() => r()))`);   // let the per-frame re-route run
    }
    const m1 = await metrics();
    await mouse('mouseReleased', start.x + MOVES * 3, start.y);
    const dragMs = (busy(m1) - busy(m0)) * 1000;
    console.log(`${counts.nodes} steps ${counts.edges} arrows`);
    console.log(`render()  median ${renders[Math.floor(renders.length / 2)].toFixed(1)} ms  (min ${renders[0].toFixed(1)}, max ${renders[renders.length - 1].toFixed(1)}, ${RUNS} runs)`);
    console.log(`drag      ${dragMs.toFixed(0)} ms main-thread busy over ${MOVES} moves  (${(dragMs / MOVES).toFixed(1)} ms per move)`);
    if (t.errors.length) console.log('[page errors]', t.errors.join('\n'));
  } finally {
    await t.close?.();
  }
  process.exit(0);
}
