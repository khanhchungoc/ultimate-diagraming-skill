// The playground (dev/tools/build_playground.py): one folder, a starter page per diagram type, a type menu, Save = download.
//   node dev/tests/e2e/e2e_playground.mjs [--browser <chrome>] [--dir <built playground folder>] [-v]
// Without --dir it builds one into a temp folder. Serves the folder over loopback HTTP and drives Chrome via cdp.mjs
// (zero dependencies; auto-detects Chrome/Chromium when --browser is omitted). Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argOf, findBrowser, launch, sleep } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');

function findPython() {
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return cmd;
  }
  return null;
}

const python = findPython();
if (!python) { console.error('[ERROR] Python 3 not found on PATH.'); process.exit(1); }

const browser = findBrowser(argOf('browser'));
if (!browser && !process.env.E2E_BROWSER_WS) {
  console.error('[ERROR] Chrome/Chromium not found. Pass --browser <path>.');
  process.exit(1);
}

let dir = argOf('dir');
let tmpSite = null;
if (!dir) {
  tmpSite = mkdtempSync(join(tmpdir(), 'playground_'));
  dir = join(tmpSite, 'playground');
  try {
    execFileSync(python, [join(here, '..', '..', 'tools', 'build_playground.py'), '-o', dir], { stdio: 'ignore' });
  } catch (e) {
    try { rmSync(tmpSite, { recursive: true, force: true }); } catch { /* ignore */ }
    console.error('[ERROR] Failed to build playground:', e.message);
    process.exit(1);
  }
}
dir = resolve(dir);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};
const server = createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
  let p = resolve(dir, rel);
  if (existsSync(p) && !p.endsWith('.html') && !/\.\w+$/.test(p)) p = join(p, 'index.html');
  if (!p.startsWith(dir + sep) || !existsSync(p) || !statSync(p).isFile()) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, {
    'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const TYPES = {
  flowchart: { name: 'Flowchart', add: ['#btn-add-shape', '#btn-add-step'], items: '[data-node-id]', header: /^flowchart\b/ },
  sequence: { name: 'Sequence diagram', add: ['@.seq-participant', '#btn-add-message'], items: '[data-edge-id]', header: /^sequenceDiagram$/ },
  erd: { name: 'ER diagram', add: ['#btn-add-table'], items: '[data-node-id]', header: /^erDiagram$/ },
  usecase: { name: 'Use case diagram', add: ['#btn-add', '#btn-add-usecase'], items: '[data-node-id]', header: /^flowchart\b/ },
};
const ids = Object.keys(TYPES);
const flowchartStarterNodes = JSON.parse(readFileSync(join(root, 'dev', 'playground', 'flowchart.json'), 'utf8')).nodes.length;
// c4 is in the menu but joins the per-type checks above once it has dock editing and Mermaid (plan-c4 phases 4 and 6); until then it is opened and checked below
const menuIds = [...ids, 'c4'];
// The first Mermaid line that is not front matter or a %% comment
const headLine = (text) => text.replace(/^---[\s\S]*?\n---\n/, '').split('\n').find((l) => l.trim() && !l.startsWith('%%')) || '';

const dlDir = mkdtempSync(join(tmpdir(), 'pg_dl_'));
let t;
try {
  t = await launch(browser);
} catch (e) {
  console.error('[ERROR]', e.message);
  try { server.closeAllConnections?.(); server.close(); } catch { /* ignore */ }
  try { rmSync(dlDir, { recursive: true, force: true }); } catch { /* ignore */ }
  if (tmpSite) { try { rmSync(tmpSite, { recursive: true, force: true }); } catch { /* ignore */ } }
  process.exit(1);
}

let code = 0;
try {
  await t.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__clip = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (s) => (window.__clip.push(s), Promise.resolve()) } });`,
  });
  await t.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });

  const IGNORE_ERR = /fonts\.g|net::ERR|Failed to load resource/;
  const allErrors = [];
  const collectErrors = () => {
    while (t.errors.length) {
      const msg = String(t.errors.shift());
      if (!IGNORE_ERR.test(msg)) allErrors.push(msg);
    }
    return allErrors;
  };
  t.on('Page.javascriptDialogOpening', (params) => {
    allErrors.push('dialog: ' + (params.message || ''));
    t.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
  });

  const open = async (id) => { collectErrors(); await t.open(`${base}/${id}/index.html`); };
  const openFile = async (file) => { collectErrors(); await t.open(file); };
  const titleText = () => t.ev(`document.getElementById('chart-title')?.textContent || ''`);
  const unsaved = () => t.ev(`/unsaved/i.test(document.getElementById('save-status')?.textContent || '')`);
  const count = (sel) => t.ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const href = () => t.ev('location.href');

  const waitNav = async (substr, timeout = 5000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const remaining = Math.max(100, deadline - Date.now());
        const ok = await t.waitFor(
          `location.href.includes(${JSON.stringify(substr)}) && document.readyState === 'complete' && document.documentElement.dataset.diagramSettled === '1'`,
          { timeout: Math.min(remaining, 1000) },
        );
        if (ok) { await t.settle(); return true; }
      } catch {
        // Execution context destroyed during cross-document navigation; retry on the new document
      }
      await sleep(30);
    }
    return false;
  };

  const nextDownloadDir = async () => {
    const sub = mkdtempSync(join(dlDir, 'dl_'));
    await t.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: sub });
    return sub;
  };
  const waitDownload = async (targetDir, timeout = 8000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const names = readdirSync(targetDir);
      const inFlight = names.some((n) => n.endsWith('.crdownload') || n.endsWith('.tmp'));
      const fresh = names.find((n) => n.endsWith('.html'));
      if (fresh && !inFlight) {
        const full = join(targetDir, fresh);
        const size = statSync(full).size;
        if (size > 0) {
          await sleep(80);
          if (existsSync(full) && statSync(full).size === size) return full;
        }
      }
      await sleep(50);
    }
    return null;
  };

  await t.send('Page.navigate', { url: `${base}/index.html` });
  const rootOk = await waitNav('/flowchart/index.html', 5000);
  t.check('the root opens the flowchart', rootOk, await href().catch(() => ''));

  for (const id of ids) {
    const T = TYPES[id];
    await open(id);
    const menuItems = await t.ev(`Array.from(document.querySelectorAll('#type-menu [role=menuitemradio]'), (e) => [e.dataset.type, e.getAttribute('aria-checked')])`);
    t.check(`${id}: starter page, menu lists the four types with only this one checked`,
      JSON.stringify(menuItems.map((m) => m[0])) === JSON.stringify(menuIds) && menuItems.filter((m) => m[1] === 'true').map((m) => m[0]).join() === id,
      JSON.stringify(menuItems));
    t.check(`${id}: the title is the type's blank title and the page is not unsaved`, (await titleText()) === T.name && !(await unsaved()));
    // Nothing drawn yet: Fit, Tidy and the exports must not fail on zero items
    await t.clickOn('#btn-zoom-reset');
    await t.clickOn('#btn-auto-tidy');
    await t.settle();
    for (const sel of ['[data-export="svg"]', '[data-export="png"]', '[data-copy="svg"]']) {
      await t.clickOn('#btn-export');
      await t.clickOn(sel);
      await sleep(250);
    }
    t.check(`${id}: Fit, Tidy and every export work on the starter page (no errors, still not unsaved)`,
      collectErrors().length === 0 && !(await unsaved()), allErrors.join(' | '));
    const before = await count(T.items);
    t.check(`${id}: opens on a starter flow, not an empty page`, before >= 2, String(before));
    for (const sel of T.add) {
      await t.clickOn(sel[0] === '@' ? sel.slice(1) : sel);
      await t.settle();
    }
    await sleep(150);
    const after = await count(T.items);
    t.check(`${id}: adding from the dock draws an item and marks the page unsaved`,
      (await unsaved()) && after > before, `${before} -> ${after}`);

    // Export > Copy > Mermaid
    await t.ev('window.__clip = []');
    await t.clickOn('#btn-export');
    await t.clickOn('[data-copy="mermaid"]');
    await t.waitFor('window.__clip.length > 0', { timeout: 2000 });
    const clip = await t.ev('window.__clip.at(-1) || ""');
    const first = headLine(clip);
    t.check(`${id}: Export > Copy > Mermaid starts with this type's header`, T.header.test(first), JSON.stringify(first));

    // Save downloads a standalone file; --extract reads it
    const sub = await nextDownloadDir();
    await t.press('s', { modifiers: 2 });
    const file = await waitDownload(sub);
    const html = file ? readFileSync(file, 'utf8') : '';
    t.check(`${id}: Ctrl+S downloads a .html with its own data, editor code and no playground flag`,
      !!file && file.endsWith('.html') && html.includes('id="diagram-data"') && !html.includes('<script id="playground" type=') && !/^\s*<script src="app\.js">/m.test(html),
      file ? basename(file) : 'no download');
    t.check(`${id}: after Save the badge is no longer unsaved`, !(await unsaved()));
    let extracted = '';
    if (file) {
      try { extracted = execFileSync(python, [join(root, 'scripts', 'layout_engine.py'), '--extract', file], { encoding: 'utf8' }); }
      catch (e) { extracted = 'ERR ' + e.message; }
    }
    t.check(`${id}: layout_engine.py --extract reads the saved file`, T.header.test(headLine(extracted)), extracted.slice(0, 80));
    // The saved file opens by itself, offline of the playground folder, as a plain page without the type menu
    if (file) {
      await openFile(file);
      t.check(`${id}: the saved file opens as a normal page (no type menu, Save present)`,
        (await count('#btn-type')) === 0 && (await count('#btn-save')) === 1);
    } else {
      t.check(`${id}: the saved file opens as a normal page (no type menu, Save present)`, false, 'no saved file');
    }
  }

  // Switching: with edits a confirm appears; Cancel stays; Switch lands on a blank of the other type
  await open('flowchart');
  const openMenu = () => t.clickOn('#btn-type');
  await openMenu();
  const topHit = await t.ev(`(() => {
    const item = document.querySelector('#type-menu [data-type="flowchart"]');
    const tabs = document.getElementById('flow-tabs');
    if (!item || !tabs || tabs.hidden) return 'missing';
    const r = item.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return item.contains(hit) ? 'ok' : (hit?.outerHTML?.slice(0, 80) || 'none');
  })()`);
  t.check('flowchart: open type menu sits above the flow tabs', topHit === 'ok', topHit);
  await t.clickOn('#type-menu [data-type="erd"]');
  const toErd = await waitNav('/erd/index.html', 5000);
  t.check('flowchart, no edits: switching goes straight to the ER diagram', toErd, await href().catch(() => ''));

  await open('flowchart');
  await t.clickOn('#btn-add-shape');
  await t.clickOn('#btn-add-step');
  await t.settle();
  await openMenu();
  await t.clickOn('#type-menu [data-type="sequence"]');
  await t.waitFor('!!document.querySelector(".confirm")', { timeout: 2000 });
  const confirmText = await t.ev(`document.querySelector('.confirm')?.textContent || ''`);
  t.check('with edits, switching asks first (Switch, Save, Cancel)',
    /Switch to Sequence diagram\?/.test(confirmText) && /lost unless you save/.test(confirmText) && /Cancel/.test(confirmText) && /Save/.test(confirmText),
    confirmText);
  await t.clickOn('.confirm .confirm-cancel');
  await t.settle();
  t.check('Cancel stays on the flowchart with its edit', (await href()).endsWith('/flowchart/index.html') && (await count('[data-node-id]')) > 0);

  await openMenu();
  await t.clickOn('#type-menu [data-type="sequence"]');
  await t.waitFor('!!document.querySelector(".confirm .confirm-ok")', { timeout: 2000 });
  await t.clickOn('.confirm .confirm-ok');
  const toSeq = await waitNav('/sequence/index.html', 5000);
  t.check('Switch lands on a blank sequence diagram (not unsaved, no messages)',
    toSeq && !(await unsaved()) && (await titleText()) === 'Sequence diagram', await href().catch(() => ''));

  await openMenu();
  await t.clickOn('#type-menu [data-type="flowchart"]');
  const backFlow = await waitNav('/flowchart/index.html', 5000);
  t.check('switching back shows the flowchart starter again',
    backFlow && (await count('.flow-node')) === flowchartStarterNodes && !(await unsaved()), String(await count('.flow-node')));

  // The confirm's Save choice downloads, then switches
  await t.clickOn('#btn-add-shape');
  await t.clickOn('#btn-add-step');
  await t.settle();
  await openMenu();
  await t.clickOn('#type-menu [data-type="usecase"]');
  await t.waitFor('!!document.querySelector(".confirm .confirm-alt")', { timeout: 2000 });
  const sub2 = await nextDownloadDir();
  await t.clickOn('.confirm .confirm-alt');
  const [file2, toUc] = await Promise.all([waitDownload(sub2), waitNav('/usecase/index.html', 5000)]);
  t.check('Save in the confirm downloads the file, then switches',
    !!file2 && file2.endsWith('.html') && toUc, `${file2 ? basename(file2) : 'no download'} / ${await href().catch(() => '')}`);

  // c4: the starter draws laid-out tiles and arrows; Level 1 / Level 2 only change the view of a diagram with systems, so check the page itself
  await open('c4');
  t.check('c4: opens on a starter landscape (tiles and arrows), not unsaved, title is the blank title',
    (await count('.c4-node')) >= 3 && (await count('.c4-edge')) >= 2 && !(await unsaved()) && (await titleText()) === 'C4 diagram');

  t.check('no page errors', collectErrors().length === 0, allErrors.join(' | '));
} catch (e) {
  console.error('[ERROR]', e.stack || e.message);
  code = 1;
} finally {
  await t.close();
  try { server.closeAllConnections?.(); server.close(); } catch { /* ignore */ }
  try { rmSync(dlDir, { recursive: true, force: true }); } catch { /* ignore */ }
  if (tmpSite) { try { rmSync(tmpSite, { recursive: true, force: true }); } catch { /* ignore */ } }
}
process.exit(code || t.finish());
