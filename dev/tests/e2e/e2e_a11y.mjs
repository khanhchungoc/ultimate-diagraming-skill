// Accessibility: axe-core (WCAG 2.0/2.1/2.2 A + AA) on all six diagram types in light and dark, plus a target-size probe
// (WCAG 2.5.8): small controls must keep an invisible hit area of at least 24x24 px.
//   node dev/tests/e2e/e2e_a11y.mjs [--browser <chrome>] [--noanim]
// Builds each page from dev/examples into a temp directory; needs node_modules/axe-core.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { argOf, findBrowser, isNoAnim, launch, sleep } from './cdp.mjs';

const browser = findBrowser(argOf('browser'));
if (!browser) { console.error('[ERROR] Chrome/Chromium not found. Pass --browser <path> or set CHROME.'); process.exit(1); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const axeSrc = readFileSync(join(root, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const HIT = 24;
const TYPES = {
  flowchart: ['dev/examples/example-flowchart.json'],
  sequence: ['dev/examples/example-sequence.json'],
  erd: ['dev/examples/example-erd.json'],
  usecase: ['dev/examples/example-usecase.json'],
  c4: ['dev/examples/example-c4.json'],
  gantt: ['dev/examples/example-gantt.mmd', '--no-holidays'],
};
// Small controls that must keep a 24x24 hit area, probed on the page of the type that has them
const SMALL = { flowchart: ['.note-badge', '.sub-open'], sequence: ['.seq-frag-focus'], c4: ['.c4-note-pin'] };
const noAnim = isNoAnim();

const work = mkdtempSync(join(tmpdir(), 'e2e_a11y_'));
const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
try {
  for (const [type, [src, ...extra]] of Object.entries(TYPES)) {
    const page = join(work, `${type}.html`);
    const r = spawnSync('python3', [join(root, 'scripts', 'layout_engine.py'), '--layout', join(root, src), '-o', page, '--no-save-helper', ...extra], { encoding: 'utf8' });
    if (r.status !== 0) { t.check(`${type}: page builds`, false, (r.stderr || r.stdout).slice(0, 200)); continue; }
    await t.section(`a11y-${type}`, async () => {
      await t.open(page, noAnim ? '?noanim=1' : '');
      await sleep(400);
      for (const theme of ['light', 'dark']) {
        await t.ev(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})`);
        await sleep(300);
        await t.ev(`${axeSrc}\n;0`);
        const res = await t.ev(`axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(TAGS)} } })
          .then((r) => r.violations.map((v) => v.id + ' (' + v.impact + '): ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ') + ' [' + v.nodes.length + ']'))`);
        t.check(`${type} ${theme}: axe finds no WCAG 2.2 AA violation`, res.length === 0, res.join(' ;; '));
      }
      await t.ev(`document.documentElement.setAttribute('data-theme', 'light')`);
      // Target size (CSS px, so scaled by the canvas zoom): the corners of a 24x24 box centred on the control must still hit the control (or its descendants)
      for (const sel of SMALL[type] || []) {
        const probe = await t.ev(`(() => {
          const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.getBoundingClientRect().width > 0);
          if (!els.length) return { n: 0 };
          let bad = 0;
          for (const el of els) {
            el.scrollIntoView({ block: 'center', inline: 'center' });
            const b = el.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2, k = el.getBoundingClientRect().width / ((el.offsetWidth || el.getBoundingClientRect().width) || 1), h = (${HIT} / 2 - 1) * k;   // k: the canvas zoom
            for (const [dx, dy] of [[-h, -h], [h, -h], [-h, h], [h, h]]) {
              const hit = document.elementFromPoint(cx + dx, cy + dy);
              if (!hit || !(hit === el || el.contains(hit))) { bad++; break; }
            }
          }
          return { n: els.length, bad };
        })()`);
        if (!probe.n) { console.log(`[SKIP] ${type} ${sel}: not present in the example page`); continue; }
        t.check(`${type} ${sel}: hit area is at least ${HIT}x${HIT} (${probe.n} probed)`, probe.bad === 0, `${probe.bad} of ${probe.n} fail`);
      }
    });
  }
  code = t.finish();
} finally {
  await t.close();
  rmSync(work, { recursive: true, force: true });
}
process.exit(code);
