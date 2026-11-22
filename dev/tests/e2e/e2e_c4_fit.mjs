// Opening zoom of c4 pages (Fit) on a desktop (1500x950) and a phone (390x844, touch): desktop numbers are pinned, so a change
// for narrow viewports cannot move them; the phone numbers are floors (the type's fitPad keeps 32px round the picture below 600px
// instead of the shell's 80). Only the layout's own width limits a phone beyond that: layoutDiagram cannot know the viewport.
//   node dev/e2e_c4_fit.mjs --browser <chrome>
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser');
if (!browser) { console.error('usage: --browser <chrome>'); process.exit(1); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const work = mkdtempSync(join(tmpdir(), 'e2e_c4_fit_'));
// fixture -> [desktop zoom %, phone zoom % at least]
const EXPECT = { landscape: [95, 32], 'one-centre': [82, 27], 'two-centres': [82, 28], 'group-centre': [77, 30], 'no-centre': [65, 47] };

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
try {
  const zoomOf = async (file, vw, vh) => {
    await t.send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: vw < 600 ? 2 : 1, mobile: vw < 600 });
    await t.open(file);
    await sleep(300);
    return Math.round(100 * await t.ev(`+/scale\\(([^)]*)\\)/.exec(document.getElementById('stage').style.transform)[1]`));
  };
  for (const [name, [desk, phone]] of Object.entries(EXPECT)) {
    const out = join(work, name + '.html');
    const r = spawnSync('python3', [join(root, 'scripts', 'layout_engine.py'), '--layout', join(root, 'dev', 'tests', 'fixtures', 'c4', name + '.json'), '-o', out], { encoding: 'utf8' });
    if (r.status !== 0) { console.error('[ERROR] build failed', r.stdout, r.stderr); process.exit(1); }
    const d = await zoomOf(out, 1500, 950), p = await zoomOf(out, 390, 844);
    t.check(`${name}: opens at ${desk}% on a desktop (unchanged)`, d === desk, `${d}%`);
    t.check(`${name}: opens at ${phone}% or more on a phone`, p >= phone, `${p}%`);
  }
  t.check('no console error', t.errors.length === 0, t.errors.join(' | '));
} catch (err) {
  console.error('[ERROR]', err.stack || err.message);
  code = 1;
} finally {
  await t.close();
}
try { rmSync(work, { recursive: true, force: true }); } catch { /* temp folder */ }
process.exit(code || t.finish());
