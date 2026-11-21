// Export > SVG and Export > PNG of a c4 page (the shell's menu items, not a private call): the exported picture holds the icon-card
// discs, the glyphs, the local-pack logos, the group frames, the arrows and the label pills as the page draws them, in light and
// dark, with no console error. The export clones the DOM with computed styles inlined, so each live element is compared with its
// twin (same child path) in the exported SVG on the properties that carry the look; the PNG is sampled for the logo colour.
//   node dev/e2e_c4_export.mjs --browser <chrome>
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser');
if (!browser) { console.error('usage: --browser <chrome>'); process.exit(1); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const work = mkdtempSync(join(tmpdir(), 'e2e_c4_export_'));
const J = JSON.stringify;

const icons = join(work, 'icons');
mkdirSync(icons);
writeFileSync(join(icons, 'acme.json'), J({ _license: 'made up for tests', _source: 'e2e_c4_export.mjs',
  icons: { box: { vb: '0 0 48 32', body: '<rect x="0" y="0" width="48" height="32" fill="#e11d48"/><circle cx="24" cy="16" r="8" fill="#0ea5e9"/>' } } }));
const src = join(work, 'x.json'), page = join(work, 'x.html');
writeFileSync(src, J({
  diagramType: 'c4', schemaVersion: 1, title: 'Export', arrange: 'surround', colorKey: { 3: 'Payments' },
  groups: [{ id: 'sys', name: 'Platform', kind: 'system' }, { id: 'own', name: 'Owner', kind: 'boundary', color: '3' }, { id: 'tile', name: 'Closed', kind: 'system', collapsed: true }],
  elements: [
    { id: 'core', kind: 'system', name: 'Core', icon: 'logo:acme/box', core: true },
    { id: 'api', kind: 'container', name: 'API', group: 'sys' },
    { id: 'db', kind: 'database', name: 'Store', group: 'sys' },
    { id: 'ext', kind: 'external', name: 'Partner', group: 'own', color: '3' },
    { id: 'u', kind: 'person', name: 'User', side: 'N' },
    { id: 'in', kind: 'container', name: 'Inner', group: 'tile' }
  ],
  relations: [{ from: 'u', to: 'core', label: 'Uses' }, { from: 'core', to: 'api', label: 'Calls' }, { from: 'api', to: 'db', label: 'Reads' }, { from: 'core', to: 'ext', label: 'Pays' }, { from: 'core', to: 'in', label: 'Syncs' }]
}));
const r = spawnSync('python3', [join(root, 'scripts', 'layout_engine.py'), '--layout', src, '-o', page, '--icons', icons], { encoding: 'utf8' });
if (r.status !== 0) { console.error('[ERROR] build failed', r.stdout, r.stderr); process.exit(1); }

// In the page: take the exported file of the menu item `fmt` (the download is caught at URL.createObjectURL)
const EXPORT = (fmt) => `(async () => {
  window.__blob = null;
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { window.__blob = b; return orig(b); };
  document.querySelector('[data-export="${fmt}"]').click();
  for (let i = 0; i < 100 && !window.__blob; i++) await new Promise((r) => setTimeout(r, 50));
  URL.createObjectURL = orig;
  return !!window.__blob;
})()`;

// Twin comparison: props of the live element and of the exported one at the same child path from the diagram root
const TWINS = `(async () => {
  const text = await window.__blob.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const out = { parseError: !!doc.querySelector('parsererror'), rows: [], logoSvgs: 0 };
  const exRoot = doc.querySelector('foreignObject > div > *'), live = document.getElementById('stage').firstElementChild;
  if (!exRoot) { out.noRoot = true; return JSON.stringify(out); }
  // the export leaves out the shell's skip list and hidden HTML nodes, so those do not count as siblings
  const kept = (n) => !n.matches('#drag-edge, .snap-guide, #lane-drop-line, #seq-drop-line, [data-export-skip]') && (n.namespaceURI === 'http://www.w3.org/2000/svg' || getComputedStyle(n).display !== 'none');
  const pathOf = (el) => { const p = []; for (let n = el; n !== live; n = n.parentElement) p.unshift([...n.parentElement.children].filter(kept).indexOf(n)); return p; };
  const twin = (el) => pathOf(el).reduce((n, i) => n && n.children[i], exRoot);
  const px = (s, prop) => { const m = new RegExp('(?:^|;)' + prop + ':([^;]*)').exec(s || ''); return m ? m[1].trim() : ''; };
  // what an element has when the export leaves the property out (it only writes those that differ from the browser default)
  const DEFAULT = new Set(['background-color:rgba(0, 0, 0, 0)', 'border-top-width:0px', 'border-top-style:none', 'fill:rgb(0, 0, 0)', 'stroke:none', 'stroke-width:1px', 'stroke-dasharray:none', 'color:rgb(0, 0, 0)']);
  const PROPS = ['background-color', 'color', 'border-top-color', 'border-top-width', 'border-top-style', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray'];
  const probe = (kind, sel) => document.querySelectorAll(sel).forEach((el) => {
    const t = twin(el), cs = getComputedStyle(el), row = { kind, id: el.closest('[data-node-id], [data-group-id], [data-edge-id]')?.dataset.nodeId || '', found: !!t, diff: [] };
    if (t) { const st = t.getAttribute('style') || ''; PROPS.forEach((p) => { const a = cs.getPropertyValue(p); if (a && !DEFAULT.has(p + ':' + a) && px(st, p) !== a) row.diff.push(p + ' ' + a + ' vs ' + px(st, p)); }); }
    out.rows.push(row);
  });
  probe('disc', '.c4-node .c4-disc'); probe('glyph', '.c4-node .c4-disc svg'); probe('glyph-shape', '.c4-node .c4-disc svg > *');
  probe('frame', '.c4-group.is-frame'); probe('tile', '.c4-group.is-tile'); probe('edge', '.c4-edge .edge-line'); probe('label', '.c4-label');
  out.logoSvgs = [...exRoot.querySelectorAll('[data-node-id="core"] svg')].filter((s) => /e11d48/i.test(s.innerHTML)).length;
  out.logoDiscBg = [...exRoot.querySelectorAll('[data-node-id="core"] *')].map((e) => px(e.getAttribute('style'), 'background-color')).filter(Boolean).join('|');
  return JSON.stringify(out);
})()`;

const PNG = `(async () => {
  const bmp = await createImageBitmap(window.__blob), c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data; let red = 0, blue = 0, white = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - 225) < 6 && Math.abs(d[i + 1] - 29) < 6 && Math.abs(d[i + 2] - 72) < 6) red++;
    if (Math.abs(d[i] - 14) < 6 && Math.abs(d[i + 1] - 165) < 6 && Math.abs(d[i + 2] - 233) < 6) blue++;
    if (d[i] > 250 && d[i + 1] > 250 && d[i + 2] > 250) white++;
  }
  return JSON.stringify({ w: c.width, h: c.height, red, blue, white, type: window.__blob.type });
})()`;

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
try {
  await t.open(page);
  for (const theme of ['light', 'dark']) {
    await t.ev(`document.documentElement.dataset.theme = ${J(theme)}`);
    await sleep(300);
    t.check(`${theme}: Export > SVG delivers a file`, await t.ev(EXPORT('svg')), '');
    const sv = JSON.parse(await t.ev(TWINS));
    t.check(`${theme}: the SVG parses and holds the diagram`, !sv.parseError && !sv.noRoot, J(sv).slice(0, 200));
    const kinds = ['disc', 'glyph', 'glyph-shape', 'frame', 'tile', 'edge', 'label'];
    for (const k of kinds) {
      const rows = sv.rows.filter((x) => x.kind === k);
      t.check(`${theme}: ${k}: ${rows.length} live, each has its twin with the same look`, rows.length > 0 && rows.every((x) => x.found && !x.diff.length), J(rows.filter((x) => !x.found || x.diff.length).slice(0, 3)));
    }
    t.check(`${theme}: the local-pack logo is in the SVG in its own colours on a white disc`, sv.logoSvgs === 1 && /rgb\(255, 255, 255\)/.test(sv.logoDiscBg), J({ n: sv.logoSvgs, bg: sv.logoDiscBg }));
    t.check(`${theme}: Export > PNG delivers a file`, await t.ev(EXPORT('png')), '');
    const png = JSON.parse(await t.ev(PNG));
    t.check(`${theme}: the PNG is an image with the logo colours and a white disc`, png.type === 'image/png' && png.w > 100 && png.red > 20 && png.blue > 5 && png.white > 50, J(png));
  }
  t.check('no console error in the whole run', t.errors.length === 0, t.errors.join(' | '));
} catch (err) {
  console.error('[ERROR]', err.stack || err.message);
  code = 1;
} finally {
  await t.close();
}
try { rmSync(work, { recursive: true, force: true }); } catch { /* temp folder */ }
process.exit(code || t.finish());
