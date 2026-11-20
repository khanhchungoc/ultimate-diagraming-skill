// The playground (dev/build_playground.py): one folder, a blank page per diagram type, type tabs, Save = download.
//   node dev/e2e_playground.mjs [--dir <built playground folder>] [-v]
// Without --dir it builds one into a temp folder. Serves the folder over loopback HTTP and drives it with Playwright
// (preinstalled; this test never installs a browser). Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const argOf = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const verbose = process.argv.includes('-v');

let dir = argOf('dir');
if (!dir) {
  dir = join(mkdtempSync(join(tmpdir(), 'playground_')), 'playground');
  execFileSync('python', [join(here, 'build_playground.py'), '-o', dir], { stdio: 'ignore' });
}
dir = resolve(dir);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const server = createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
  let p = resolve(dir, rel);
  if (existsSync(p) && !p.endsWith('.html') && !/\.\w+$/.test(p)) p = join(p, 'index.html');
  if (!p.startsWith(dir + sep) || !existsSync(p)) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

let failed = 0, total = 0;
const check = (name, ok, detail = '') => { total++; if (!ok) failed++; if (!ok || verbose) console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${ok ? '' : ' - ' + detail}`); };

const TYPES = {
  flowchart: { name: 'Flowchart', add: ['#btn-add-shape', '#btn-add-step'], items: '[data-node-id]', header: /^flowchart\b/ },
  sequence: { name: 'Sequence diagram', add: ['@.seq-participant', '#btn-add-message'], items: '[data-edge-id]', header: /^sequenceDiagram$/ },
  erd: { name: 'ER diagram', add: ['#btn-add-table'], items: '[data-node-id]', header: /^erDiagram$/ },
  usecase: { name: 'Use case diagram', add: ['#btn-add', '#btn-add-usecase'], items: '[data-node-id]', header: /^flowchart\b/ },
};
const ids = Object.keys(TYPES);
// The first Mermaid line that is not front matter or a %% comment
const headLine = (text) => text.replace(/^---[\s\S]*?\n---\n/, '').split('\n').find((l) => l.trim() && !l.startsWith('%%')) || '';

const browser = await chromium.launch(process.getuid?.() === 0 ? { args: ['--no-sandbox'] } : {});
try {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => { window.__clip = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (s) => (window.__clip.push(s), Promise.resolve()) } }); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|net::ERR|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const open = async (id) => { await page.goto(`${base}/${id}/index.html`); await page.waitForSelector('#chart-title'); await page.waitForTimeout(400); };
  const unsaved = () => page.locator('#save-status').textContent().then((t) => /unsaved/i.test(t));
  const count = (sel) => page.locator(sel).count();

  await page.goto(`${base}/index.html`);
  await page.waitForURL(/\/flowchart\/index\.html/, { timeout: 5000 }).then(() => check('the root opens the flowchart', true), () => check('the root opens the flowchart', false, page.url()));

  for (const id of ids) {
    const T = TYPES[id];
    await open(id);
    const menuItems = await page.locator('#type-tabs [role=radio]').evaluateAll((els) => els.map((e) => [e.dataset.type, e.getAttribute('aria-checked')]));
    check(`${id}: starter page, tabs list the four types with only this one checked`,
      JSON.stringify(menuItems.map((m) => m[0])) === JSON.stringify(ids) && menuItems.filter((m) => m[1] === 'true').map((m) => m[0]).join() === id, JSON.stringify(menuItems));
    check(`${id}: the title is the type's blank title and the page is not unsaved`, (await page.locator('#chart-title').textContent()) === T.name && !(await unsaved()));
    // Nothing drawn yet: Fit, Tidy and the exports must not fail on zero items
    await page.click('#btn-zoom-reset'); await page.click('#btn-auto-tidy');
    for (const sel of ['[data-export="svg"]', '[data-export="png"]', '[data-copy="svg"]']) {
      await page.click('#btn-export'); await page.click(sel); await page.waitForTimeout(250);
    }
    check(`${id}: Fit, Tidy and every export work on the starter page (no errors, still not unsaved)`, errors.length === 0 && !(await unsaved()), errors.join(' | '));
    const before = await count(T.items);
    check(`${id}: opens on a starter flow, not an empty page`, before >= 2, String(before));
    for (const sel of T.add) await (sel[0] === '@' ? page.locator(sel.slice(1)).first().click() : page.click(sel));
    await page.waitForTimeout(300);
    check(`${id}: adding from the dock draws an item and marks the page unsaved`, (await unsaved()) && ((await count(T.items)) > before), `${before} -> ${await count(T.items)}`);

    // Export > Copy > Mermaid
    await page.click('#btn-export'); await page.click('[data-copy="mermaid"]');
    await page.waitForTimeout(200);
    const clip = await page.evaluate(() => window.__clip.at(-1) || '');
    const first = headLine(clip);
    check(`${id}: Export > Copy > Mermaid starts with this type's header`, T.header.test(first), JSON.stringify(first));

    // Save downloads a standalone file; --extract reads it
    const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
    const file = join(mkdtempSync(join(tmpdir(), 'pg_dl_')), dl.suggestedFilename());
    await dl.saveAs(file);
    const html = readFileSync(file, 'utf8');
    check(`${id}: Ctrl+S downloads a .html with its own data, editor code and no playground flag`,
      file.endsWith('.html') && html.includes('id="diagram-data"') && !html.includes('<script id="playground" type=') && !/^\s*<script src="app\.js">/m.test(html), dl.suggestedFilename());
    check(`${id}: after Save the badge is no longer unsaved`, !(await unsaved()));
    let extracted = '';
    try { extracted = execFileSync('python', [join(root, 'scripts', 'layout_engine.py'), '--extract', file], { encoding: 'utf8' }); } catch (e) { extracted = 'ERR ' + e.message; }
    check(`${id}: layout_engine.py --extract reads the saved file`, T.header.test(headLine(extracted)), extracted.slice(0, 80));
    // The saved file opens by itself, offline of the playground folder, as a plain page without the type menu
    const solo = await ctx.newPage();
    await solo.goto('file://' + file);
    await solo.waitForSelector('#chart-title'); await solo.waitForTimeout(300);
    check(`${id}: the saved file opens as a normal page (no type tabs, Save present)`, (await solo.locator('#type-tabs').count()) === 0 && (await solo.locator('#btn-save').count()) === 1);
    await solo.close();
  }

  // Switching: with edits a confirm appears; Cancel stays; Switch lands on a blank of the other type
  await open('flowchart');
  const open_menu = async () => {};   // the tabs are always visible
  await open_menu(); await page.click('#type-tabs [data-type="erd"]');
  check('flowchart, no edits: switching goes straight to the ER diagram', await page.waitForURL(/\/erd\/index\.html/, { timeout: 5000 }).then(() => true, () => false), page.url());
  await page.waitForSelector('#chart-title');

  await open('flowchart');
  await page.click('#btn-add-shape'); await page.click('#btn-add-step'); await page.waitForTimeout(300);
  await open_menu(); await page.click('#type-tabs [data-type="sequence"]');
  const confirmText = await page.locator('.confirm').textContent().catch(() => '');
  check('with edits, switching asks first (Switch, Save, Cancel)', /Switch to Sequence diagram\?/.test(confirmText) && /lost unless you save/.test(confirmText) && /Cancel/.test(confirmText) && /Save/.test(confirmText), confirmText);
  await page.click('.confirm .confirm-cancel');
  check('Cancel stays on the flowchart with its edit', page.url().endsWith('/flowchart/index.html') && (await count('[data-node-id]')) > 0);
  await open_menu(); await page.click('#type-tabs [data-type="sequence"]');
  await Promise.all([page.waitForURL(/\/sequence\/index\.html/), page.click('.confirm .confirm-ok')]);
  await page.waitForSelector('#chart-title'); await page.waitForTimeout(300);
  check('Switch lands on a blank sequence diagram (not unsaved, no messages)', !(await unsaved()) && (await page.locator('#chart-title').textContent()) === 'Sequence diagram');
  await open_menu(); await page.click('#type-tabs [data-type="flowchart"]');
  await page.waitForURL(/\/flowchart\/index\.html/);
  await page.waitForSelector('#chart-title'); await page.waitForTimeout(300);
  check('switching back shows the flowchart starter again', (await count('.flow-node')) === 3 && !(await unsaved()), String(await count('.flow-node')));

  // The confirm's Save choice downloads, then switches
  await page.click('#btn-add-shape'); await page.click('#btn-add-step'); await page.waitForTimeout(300);
  await open_menu(); await page.click('#type-tabs [data-type="usecase"]');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('.confirm .confirm-alt')]);
  await page.waitForURL(/\/usecase\/index\.html/);
  check('Save in the confirm downloads the file, then switches', dl2.suggestedFilename().endsWith('.html'));

  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  console.log('[ERROR]', e.stack || e); failed++;
} finally {
  await browser.close(); server.close();
}
console.log(failed ? `[FAIL] ${failed} of ${total} checks failed` : `[OK] ${total} checks passed`);
process.exit(failed ? 2 : 0);
