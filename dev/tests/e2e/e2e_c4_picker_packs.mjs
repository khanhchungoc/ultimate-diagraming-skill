// Icon picker and local packs on a c4 page: the picker (#c4-icons) lists the pack entries the page embeds under 'Local packs'
// (`logo:<pack>/<name>` tiles on the white disc), search narrows them, the current one is marked, choosing one sets the element's
// icon (and the saved file keeps it), and the missing-pack note stays. Uses the synthetic pack technique of dev/e2e_c4_packs.mjs.
//   node dev/e2e_c4_picker_packs.mjs --browser <chrome>
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
const work = mkdtempSync(join(tmpdir(), 'e2e_c4_pp_'));
const J = JSON.stringify;

const icons = join(work, 'icons');
mkdirSync(icons);
writeFileSync(join(icons, 'acme.json'), J({
  _license: 'made up for tests', _source: 'e2e_c4_picker_packs.mjs',
  icons: {
    box: { vb: '0 0 48 32', body: '<rect x="0" y="0" width="48" height="32" fill="#e11d48"/>' },
    ring: { vb: '0 0 32 32', body: '<circle cx="16" cy="16" r="14" fill="#0ea5e9"/>' },
    unused: { vb: '0 0 8 8', body: '<rect width="8" height="8" fill="#111111"/>' }
  }
}));
const src = join(work, 'p.json'), page = join(work, 'p.html');
writeFileSync(src, J({
  diagramType: 'c4', schemaVersion: 1, title: 'Picker packs', arrange: 'flow',
  elements: [
    { id: 'a', kind: 'container', name: 'Acme Box', icon: 'logo:acme/box' },
    { id: 'b', kind: 'database', name: 'Store', icon: 'logo:acme/ring' },
    { id: 'c', kind: 'container', name: 'Plain' },
    { id: 'd', kind: 'container', name: 'Ghost', icon: 'logo:ghost/x' }
  ],
  relations: [{ from: 'a', to: 'b', label: 'Writes' }, { from: 'c', to: 'b', label: 'Reads' }, { from: 'c', to: 'd', label: 'Calls' }]
}));
const r = spawnSync('python3', [join(root, 'scripts', 'layout_engine.py'), '--layout', src, '-o', page, '--icons', icons], { encoding: 'utf8' });
if (r.status !== 0) { console.error('[ERROR] build failed', r.stdout, r.stderr); process.exit(1); }

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
try {
  const tiles = () => t.ev(`JSON.stringify([...document.querySelectorAll('#c4-icons button[data-icon^="logo:"]')].map((b) => ({ n: b.dataset.icon, pressed: b.getAttribute('aria-pressed'),
    disc: getComputedStyle(b.querySelector('.c4-icon-logo')).backgroundColor, svg: !!b.querySelector('svg') })))`).then(JSON.parse);
  const heads = () => t.ev(`[...document.querySelectorAll('#c4-icons .c4-icon-head')].map((h) => h.textContent).join('|')`);
  const search = (q) => t.ev(`(() => { const i = document.getElementById('c4-icon-search'); i.value = ${J(q)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const openPicker = async (name, waitDevicon = true) => {
    await t.open(page);
    const id = await t.ev(`(() => { const n = [...document.querySelectorAll('.c4-node')].find((e) => e.querySelector('.c4-name').textContent === ${J(name)}); return n.dataset.nodeId; })()`);
    await t.clickOn(`[data-node-id="${id}"]`);
    await sleep(150);
    await t.clickOn('.c4-actionbar [data-act="icon"]');
    if (waitDevicon) await t.waitFor(`!!document.querySelector('#c4-icons button[data-icon="logo:devicon/postgresql"]')`, 4000);
    else await t.waitFor(`/Offline/i.test((document.querySelector('.c4-icons-note') || {}).textContent || '')`, 4000);
  };

  // Offline check: page embeds only used local logos (0 unused devicon logos) and shows offline note when fetch fails
  await t.mockDevicon('offline');
  await openPicker('Plain', false);
  const offlineTiles = await tiles();
  t.check('offline: picker lists only embedded local logos (no unbundled devicon logos) with offline status note',
    J(offlineTiles.map((x) => x.n)) === J(['logo:acme/box', 'logo:acme/ring'])
    && /Offline/i.test(await t.ev(`document.querySelector('.c4-icons-note').textContent`)),
    J(offlineTiles));

  // Online check: devicon.json loads on demand via fetch
  await t.mockDevicon('local');
  await openPicker('Plain', true);
  t.check('the picker has Tech logos and Local packs groups after the generic ones', (await heads()).endsWith('Security|Tech logos|Local packs'), await heads());
  let ts = await tiles();
  const localTs = ts.filter((x) => !x.n.startsWith('logo:devicon/'));
  const deviconTs = ts.filter((x) => x.n.startsWith('logo:devicon/'));
  t.check('it lists the used local entries only and >= 60 online devicon logos', J(localTs.map((x) => x.n)) === J(['logo:acme/box', 'logo:acme/ring']) && deviconTs.length >= 60, J({ local: localTs, deviconCount: deviconTs.length }));
  t.check('each tile is a logo on the white disc', ts.every((x) => x.svg && x.disc === 'rgb(255, 255, 255)'), J(ts.slice(0, 5)));
  t.check('no entry is marked for an element with no icon', ts.every((x) => x.pressed === 'false'), J(ts.slice(0, 5)));
  t.check('the missing-pack note stays', /Missing icon pack: logo:ghost\/x/.test(await t.ev(`(document.querySelector('.c4-icons-missing') || {}).textContent || ''`)), '');
  await search('ring');
  await sleep(100);
  const ringTiles = await tiles();
  t.check('search narrows the pack entries', J(ringTiles.filter((x) => !x.n.startsWith('logo:devicon/')).map((x) => x.n)) === J(['logo:acme/ring']) && ringTiles.some((x) => x.n === 'logo:devicon/spring'), J(ringTiles));
  await search('zzz');
  await sleep(100);
  t.check('no match: no pack tile and a note', (await tiles()).length === 0 && (await heads()) === '' && /No icon matches/.test(await t.ev(`document.querySelector('.c4-icons-note').textContent`)), await heads());
  await search('');
  await sleep(100);
  await t.ev(`document.querySelector('#c4-icons button[data-icon="logo:acme/ring"]').scrollIntoView({ block: 'nearest' })`);
  await sleep(100);
  await t.clickOn('#c4-icons button[data-icon="logo:acme/ring"]');
  await sleep(300);
  await t.settle();
  await t.press('s', { modifiers: 2 });
  await sleep(250);
  const saved = JSON.parse(await t.ev(`document.getElementById('diagram-data').textContent`));
  t.check('choosing a pack entry sets the icon of the element', saved.elements.find((e) => e.name === 'Plain').icon === 'logo:acme/ring', J(saved.elements));
  t.check('the tile now draws the logo', await t.ev(`(() => { const n = [...document.querySelectorAll('.c4-node')].find((e) => e.querySelector('.c4-name').textContent === 'Plain'); return n.querySelector('.c4-disc').classList.contains('is-logo'); })()`), '');

  await openPicker('Acme Box', true);
  ts = await tiles();
  t.check('the current entry is marked', ts.filter((x) => x.pressed === 'true').map((x) => x.n).join() === 'logo:acme/box', J(ts));
  t.check('no errors in the whole run', t.errors.length === 0, t.errors.join(' | '));
} catch (err) {
  console.error('[ERROR]', err.stack || err.message);
  code = 1;
} finally {
  await t.close();
}
try { rmSync(work, { recursive: true, force: true }); } catch { /* temp folder */ }
process.exit(code || t.finish());
