// Shared UI elements gallery (dev/playground/components.html, built by dev/tools/build_components.py from the real bundle CSS): every shared
// element in every state, light and dark. Checks the hit areas (>= 24x24 px, WCAG 2.5.8), that aria-expanded drives the chevron rotation, the
// port show/hide rules, the edge label modifiers and the item states; optionally saves a full-page screenshot per theme.
//   node dev/tests/e2e/e2e_components.mjs [--browser <chrome>] [--shots <dir>] [--noanim]
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { argOf, findBrowser, isNoAnim, launch, sleep } from './cdp.mjs';

const browser = findBrowser(argOf('browser'));
if (!browser) { console.error('[ERROR] Chrome/Chromium not found. Pass --browser <path> or set CHROME.'); process.exit(1); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const shots = argOf('shots');
const HIT = 24;
const work = mkdtempSync(join(tmpdir(), 'e2e_components_'));
const page = join(work, 'components.html');
const built = spawnSync('python3', [join(root, 'dev', 'tools', 'build_components.py'), '-o', page], { encoding: 'utf8' });
if (built.status !== 0) { console.error('[ERROR] gallery build failed:', (built.stderr || built.stdout).slice(0, 300)); process.exit(1); }

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
// The corners of a HIT x HIT box centred on the element must still hit the element (or a descendant): the invisible hit area.
// outward: a side port's box starts at its centre (the item's edge) and runs away from the item (components/port.css)
const hitProbe = (sel, outward = false) => `(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(sel)})];
  let bad = 0;
  for (const el of els) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const b = el.getBoundingClientRect(), h = ${HIT} / 2 - 1, side = ${outward} && ['top', 'right', 'bottom', 'left'].find((k) => el.classList.contains('port-' + k));
    const out = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }[side] || [0, 0];
    const cx = b.left + b.width / 2 + out[0] * (h + 0.5), cy = b.top + b.height / 2 + out[1] * (h + 0.5);
    for (const [dx, dy] of [[-h, -h], [h, -h], [-h, h], [h, h]]) {
      const hit = document.elementFromPoint(cx + dx, cy + dy);
      if (!hit || !(hit === el || el.contains(hit))) { bad++; break; }
    }
  }
  return { n: els.length, bad };
})()`;
const cs = (sel, props) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); const c = getComputedStyle(el); return ${JSON.stringify(props)}.map((p) => c[p]); })()`;
try {
  for (const theme of ['light', 'dark']) {
    await t.section(`components-${theme}`, async () => {
      await t.open(page, `?theme=${theme}`, { motion: !isNoAnim() });
      await sleep(200);
      t.check(`${theme}: the gallery sets the theme`, (await t.ev(`document.documentElement.dataset.theme`)) === theme);

      // Chevron: size and hit area, rotation follows aria-expanded
      const chev = await t.ev(hitProbe('.chevron'));
      t.check(`${theme}: every chevron has a hit area of at least ${HIT}x${HIT} (${chev.n} probed)`, chev.n >= 3 && chev.bad === 0, JSON.stringify(chev));
      const size = await t.ev(`(() => { const r = document.getElementById('chev-open').getBoundingClientRect(), t = getComputedStyle(document.documentElement).getPropertyValue('--chevron-size').trim(); return [r.width, r.height, t]; })()`);
      t.check(`${theme}: the chevron is --chevron-size wide`, size[2] === '22px' && size[0] === 22 && size[1] === 22, JSON.stringify(size));
      const turn = (id) => t.ev(`getComputedStyle(document.querySelector('#${id} svg')).transform`);
      t.check(`${theme}: an expanded chevron is upright, a collapsed one is turned`, (await turn('chev-open')) === 'none' && (await turn('chev-closed')) !== 'none');
      await t.clickOn('#chev-live');
      await sleep(isNoAnim() ? 50 : 350);
      t.check(`${theme}: a click flips aria-expanded and the chevron turns with it`, (await t.ev(`document.getElementById('chev-live').getAttribute('aria-expanded')`)) === 'false' && (await turn('chev-live')) !== 'none');
      await t.clickOn('#chev-live');
      await sleep(isNoAnim() ? 50 : 350);
      t.check(`${theme}: a second click turns it back`, (await t.ev(`document.getElementById('chev-live').getAttribute('aria-expanded')`)) === 'true' && (await turn('chev-live')) === 'none');
      await t.mouse('mouseMoved', 5, 5);
      await sleep(isNoAnim() ? 50 : 250);
      const hov0 = (await t.ev(cs('#chev-live', ['backgroundColor'])))[0];
      const p = await t.at('#chev-live');
      await t.mouse('mouseMoved', p.x, p.y);
      await sleep(isNoAnim() ? 50 : 250);
      t.check(`${theme}: hovering a chevron changes its background`, (await t.ev(cs('#chev-live', ['backgroundColor'])))[0] !== hov0);
      await t.mouse('mouseMoved', 5, 5);

      // Port: hit area, show and hide rules, touch size
      const ports = await t.ev(hitProbe('.port.is-shown', true));
      t.check(`${theme}: a shown port has a hit area of at least ${HIT}x${HIT}, outward from the item edge (${ports.n} probed)`, ports.n >= 4 && ports.bad === 0, JSON.stringify(ports));
      const end = await t.ev(hitProbe('#port-end'));
      t.check(`${theme}: the end handle has a hit area of at least ${HIT}x${HIT}`, end.n === 1 && end.bad === 0, JSON.stringify(end));
      const portState = (id) => t.ev(`(() => { const c = getComputedStyle(document.querySelector('#${id} .port')); return [c.opacity, c.pointerEvents]; })()`);
      let r = await portState('port-hover');
      t.check(`${theme}: a port is hidden at rest`, r[0] === '0' && r[1] === 'none', JSON.stringify(r));
      const box = await t.at('#port-hover');
      await t.mouse('mouseMoved', box.x, box.y);
      await sleep(isNoAnim() ? 50 : 250);
      r = await portState('port-hover');
      t.check(`${theme}: hovering the item shows its ports`, r[0] === '1' && r[1] === 'auto', JSON.stringify(r));
      await t.mouse('mouseMoved', 5, 5);
      r = await portState('port-drag');
      t.check(`${theme}: no port while the item or page is dragging (.is-dragging)`, r[0] === '0' && r[1] === 'none', JSON.stringify(r));
      r = await portState('port-multi');
      t.check(`${theme}: no port with several items selected (.is-multi)`, r[0] === '0' && r[1] === 'none', JSON.stringify(r));
      await t.ev(`document.body.classList.add('exporting')`);
      t.check(`${theme}: no port while exporting`, (await t.ev(`getComputedStyle(document.querySelector('#port-shown .port')).display`)) === 'none');
      await t.ev(`document.body.classList.remove('exporting'); document.body.classList.add('presentation')`);
      t.check(`${theme}: no port while presenting`, (await t.ev(`getComputedStyle(document.querySelector('#port-shown .port')).display`)) === 'none');
      await t.ev(`document.body.classList.remove('presentation')`);
      const tw = await t.ev(`(() => { const c = getComputedStyle(document.querySelector('#port-touch .port')), n = getComputedStyle(document.querySelector('#port-shown .port')); return [c.width, n.width]; })()`);
      t.check(`${theme}: a port is --port-size, --port-size-touch on touch`, tw[1] === '12px' && tw[0] === '20px', JSON.stringify(tw));

      // Edge label modifiers
      const lab = await t.ev(`(() => { const w = getComputedStyle(document.querySelector('#labels .edge-label')), s = document.querySelector('.edge-label--single'), sc = getComputedStyle(s), k = getComputedStyle(s.firstElementChild); return [w.whiteSpace, sc.whiteSpace, k.textOverflow, k.overflow]; })()`);
      t.check(`${theme}: the label wraps by default and --single is one line with an ellipsis`, lab[0] === 'normal' && lab[1] === 'nowrap' && lab[2] === 'ellipsis' && lab[3] === 'hidden', JSON.stringify(lab));

      // Item states
      const sh = async (id) => (await t.ev(cs(`#${id}`, ['boxShadow']))) [0];
      const [rest, selected, ishover, editing] = [await sh('item-rest'), await sh('item-selected'), await sh('item-ishover'), await sh('item-editing')];
      t.check(`${theme}: a selected item has its own ring and glow`, selected !== rest && /inset/.test(selected), selected);
      t.check(`${theme}: .is-hover lifts an item with the hover shadow`, ishover !== rest, ishover);
      t.check(`${theme}: an item being edited keeps its rest look`, editing === rest, editing);
      const hbox = await t.at('#item-hover');
      await t.mouse('mouseMoved', hbox.x, hbox.y);
      await sleep(isNoAnim() ? 50 : 250);
      t.check(`${theme}: :hover gives the same look as .is-hover`, (await sh('item-hover')) === ishover, await sh('item-hover'));
      await t.mouse('mouseMoved', 5, 5);
      const dim = await t.ev(`(() => [getComputedStyle(document.getElementById('item-dim')).opacity, getComputedStyle(document.getElementById('shape-dim')).opacity, getComputedStyle(document.documentElement).getPropertyValue('--dim').trim()])()`);
      t.check(`${theme}: dimmed items use the --dim token`, dim[0] === dim[2] && dim[1] === dim[2], JSON.stringify(dim));
      const shape = await t.ev(`(() => ['shape-rest', 'shape-selected'].map((id) => { const c = getComputedStyle(document.getElementById(id)); return [c.stroke, c.strokeWidth]; }))()`);
      t.check(`${theme}: a selected SVG shape is drawn in --primary at --select-ring-w`, shape[1][0] !== shape[0][0] && shape[1][1] === '2px', JSON.stringify(shape));

      // Dock overflow More menu
      const dockMore = await t.ev(`(() => {
        const btn = document.getElementById('gal-dock-more');
        const menu = document.getElementById('gal-dock-more-menu');
        const items = [...menu.querySelectorAll('[role^="menuitem"]')];
        const minH = items.reduce((m, el) => Math.min(m, el.getBoundingClientRect().height), Infinity);
        const br = btn.getBoundingClientRect();
        return { btnH: br.height, btnW: br.width, count: items.length, minH };
      })()`);
      t.check(`${theme}: dock More button and menu items meet >= ${HIT}px target height`, dockMore.btnH >= HIT && dockMore.btnW >= HIT && dockMore.count >= 3 && dockMore.minH >= HIT, JSON.stringify(dockMore));
      t.check(`${theme}: the gallery logs no errors`, t.errors.length === 0, t.errors.join(' | ').slice(0, 200));

      if (shots) {
        mkdirSync(shots, { recursive: true });
        const h = await t.ev(`document.documentElement.scrollHeight`);
        await t.send('Emulation.setDeviceMetricsOverride', { width: 1300, height: Math.ceil(h), deviceScaleFactor: 1, mobile: false });
        await sleep(100);
        const png = await t.send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(join(shots, `components_${theme}.png`), Buffer.from(png.data, 'base64'));
        await t.send('Emulation.clearDeviceMetricsOverride');
      }
    });
  }
  code = t.finish();
} finally {
  await t.close();
  rmSync(work, { recursive: true, force: true });
}
process.exit(code);
