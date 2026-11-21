// Local icon packs on a c4 page (tier 3 of the plan's Icons): a synthetic pack `acme` of made-up shapes is built into a temp
// icons folder; a diagram using `logo:acme/box` is laid out with --icons. Checks: the logo is drawn in the disc, on a white
// disc, in its own colours and aspect ratio, in light and dark; only the entries used are embedded; a missing entry shows the
// kind's generic glyph with one [WARN]; a missing pack gets the audit's [WARN]; the logo survives Save and reload; no overflow.
//   node dev/e2e_c4_packs.mjs --browser <chrome>
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser');
if (!browser) { console.error('usage: --browser <chrome>'); process.exit(1); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const work = mkdtempSync(join(tmpdir(), 'e2e_c4_packs_'));
const J = JSON.stringify;

// The synthetic pack: a 3:2 box with two made-up colours, and a second entry that no diagram uses
const icons = join(work, 'icons');
mkdirSync(icons);
writeFileSync(join(icons, 'acme.json'), J({
  _license: 'made up for tests', _source: 'e2e_c4_packs.mjs',
  icons: {
    box: { vb: '0 0 48 32', body: '<rect x="0" y="0" width="48" height="32" fill="#e11d48"/><circle cx="24" cy="16" r="8" fill="#0ea5e9"/>' },
    unused: { vb: '0 0 8 8', body: '<rect width="8" height="8" fill="#111111"/>' }
  }
}));

const diagram = (icon, extra = {}) => ({
  diagramType: 'c4', schemaVersion: 1, title: 'Packs', arrange: 'flow',
  elements: [
    { id: 'a', kind: 'container', name: 'Acme Box', icon },
    { id: 'b', kind: 'database', name: 'Store' },
    { id: 'ext', kind: 'external', name: 'Pg Cloud', icon: 'logo:devicon/postgresql' }
  ],
  relations: [{ from: 'a', to: 'b', label: 'Writes' }, { from: 'a', to: 'ext', label: 'Queries' }], ...extra
});
function build(name, icon) {
  const src = join(work, `${name}.json`), out = join(work, `${name}.html`);
  writeFileSync(src, J(diagram(icon)));
  const r = spawnSync('python3', [join(root, 'scripts', 'layout_engine.py'), '--layout', src, '-o', out, '--icons', icons], { encoding: 'utf8' });
  return { out, log: r.stdout + r.stderr, status: r.status };
}
const warns = (log) => log.split('\n').filter((l) => l.startsWith('[WARN]'));

const ok = build('ok', 'logo:acme/box');
const noEntry = build('noentry', 'logo:acme/nope');
const noPack = build('nopack', 'logo:ghost/x');
if (ok.status !== 0) { console.error('[ERROR] build failed', ok.log); process.exit(1); }

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
try {
  const html = readFileSync(ok.out, 'utf8');
  t.check('the page embeds the entry it uses', html.includes('"acme/box"') && !html.includes('acme/unused') && !html.includes('#111111'), '');
  t.check('LOGOS sits outside the data block', !/<script id="diagram-data"[^>]*>[\s\S]*?<\/script>/.exec(html)[0].includes('LOGOS'), '');
  t.check('a good build prints no WARN', warns(ok.log).length === 0, ok.log);
  t.check('a missing entry prints one WARN naming pack and entry', warns(noEntry.log).length === 1 && /acme/.test(warns(noEntry.log)[0]) && /nope/.test(warns(noEntry.log)[0]), noEntry.log);
  t.check('a missing pack prints one WARN naming the pack', warns(noPack.log).length === 1 && /ghost/.test(warns(noPack.log)[0]) && /not installed/.test(warns(noPack.log)[0]), noPack.log);

  const probe = () => t.ev(`(() => {
    const d = document.querySelector('[data-node-id="a"] .c4-disc'), s = d.querySelector('svg'), r = s.querySelector('rect');
    const dr = d.getBoundingClientRect(), rr = r ? r.getBoundingClientRect() : null;
    const ext = document.querySelector('[data-node-id="ext"] .c4-disc');
    return JSON.stringify({ logo: d.classList.contains('is-logo'), bg: getComputedStyle(d).backgroundColor, fill: r ? getComputedStyle(r).fill : '',
      extLogo: ext.classList.contains('is-logo'), extBg: getComputedStyle(ext).backgroundColor,
      ratio: rr ? rr.width / rr.height : 0, inside: !!rr && rr.left >= dr.left && rr.right <= dr.right && rr.top >= dr.top && rr.bottom <= dr.bottom,
      stroked: s.getAttribute('stroke') === 'currentColor', theme: document.documentElement.dataset.theme || 'light' });
  })()`).then(JSON.parse);

  await t.open(ok.out);
  for (const theme of ['light', 'dark']) {
    await t.ev(`document.documentElement.dataset.theme = ${J(theme)}`);
    await sleep(200);
    const p = await probe();
    t.check(`${theme}: logo in a white disc, own colour, 3:2, inside the disc (external bundled logo also white disc)`,
      p.logo && p.bg === 'rgb(255, 255, 255)' && p.extLogo && p.extBg === 'rgb(255, 255, 255)' && p.fill === 'rgb(225, 29, 72)' && Math.abs(p.ratio - 1.5) < 0.02 && p.inside && !p.stroked, J(p));
  }
  await t.ev(`document.documentElement.dataset.theme = 'light'`);

  // Save, then reload the saved text: the logo is still drawn
  await t.press('s', { modifiers: 2 });
  await sleep(250);
  const raw = await t.ev(`document.getElementById('diagram-data').textContent`);
  t.check('the saved data keeps the logo reference', JSON.parse(raw).elements.some((e) => e.icon === 'logo:acme/box'), raw.slice(0, 200));
  const copy = join(work, 'saved.html');
  writeFileSync(copy, html.replace(/(<script id="diagram-data" type="application\/json">)[\s\S]*?(<\/script>)/, (m, a, b) => a + raw + b));
  await t.open(copy);
  const again = await probe();
  t.check('after Save and reload the logo is still drawn', again.logo && again.bg === 'rgb(255, 255, 255)' && Math.abs(again.ratio - 1.5) < 0.02, J(again));
  const re = spawnSync('python3', [join(root, 'scripts', 'layout_engine.py'), '--layout', copy, '-o', join(work, 'again.html'), '--icons', icons], { encoding: 'utf8' });
  t.check('re-laying out the saved page embeds the logo again', re.status === 0 && readFileSync(join(work, 'again.html'), 'utf8').includes('"acme/box"'), re.stdout + re.stderr);

  // Fallbacks: the kind's generic glyph, no logo class
  for (const [name, b] of [['missing entry', noEntry], ['missing pack', noPack]]) {
    await t.open(b.out);
    const p = await probe().catch(() => null);
    const g = await t.ev(`(() => { const d = document.querySelector('[data-node-id="a"] .c4-disc'); const s = d.querySelector('svg');
      return JSON.stringify({ logo: d.classList.contains('is-logo'), glyph: !!s && (s.getAttribute('stroke') === 'currentColor' || s.getAttribute('fill') === 'currentColor') }); })()`).then(JSON.parse);
    t.check(`${name}: the generic glyph, not a logo`, !g.logo && g.glyph, J(g));
  }
  t.check('no errors in the whole run', t.errors.length === 0, t.errors.join(' | '));
} catch (err) {
  console.error('[ERROR]', err.stack || err.message);
  code = 1;
} finally {
  await t.close();
}
const ov = spawnSync('node', [join(root, 'dev', 'tests', 'unit', 'check_overflow.mjs'), '--browser', browser, ok.out], { encoding: 'utf8' });
if (ov.status !== 0) { console.error(ov.stdout + ov.stderr); code = code || 2; } else console.log('[PASS] check_overflow clean');
try { rmSync(work, { recursive: true, force: true }); } catch { /* temp folder */ }
process.exit(code || t.finish());
