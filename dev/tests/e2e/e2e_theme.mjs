// Save keeps the stored theme (plan: dev/plans/plan-design-tokens.md, Phase 7).
//   node dev/e2e_theme.mjs --browser <chrome> --page <themed.html> --artifact <themed-artifact-dir/index.html>
// Both targets come from `layout_engine.py --layout ... --theme <file>` (the second with --target artifact).
// File mode: Save takes its download path; the saved file must still hold the same <script id="diagram-theme"> after the
// data block's end comment. Artifact mode: Save publishes diagram.json through a stubbed window.claude (without
// viewer-injected scripts), and Export > HTML file produces a standalone page keeping the theme script in <head>.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser'), page = argOf('page'), artifact = argOf('artifact');
if (!browser || !page || !artifact) { console.error('usage: --browser <chrome> --page <html> --artifact <dir/index.html>'); process.exit(1); }
const themeOf = (html) => (html.match(/<script id="diagram-theme" type="application\/json">([\s\S]*?)<\/script>/) || [])[1];
const guideValid = (html) => {
  const g = html.match(/on lines (\d+)-(\d+) of this file\. Read lines 1-(\d+) only \(offset 1, limit (\d+)\)/);
  if (!g) return false;
  const lines = html.split('\n');
  const start = lines.findIndex((l) => l.includes('<script id="diagram-data" type="application/json">')) + 1;
  const end = lines.findIndex((l) => l.includes('<!-- end diagram-data -->')) + 1;
  return start > 0 && end > start && +g[1] === start && +g[2] === end && +g[3] === end && +g[4] === end;
};
const t = await launch(browser);
let code = 0;
try {
  const gen = readFileSync(page, 'utf8').replace(/\r\n/g, '\n');
  t.check('generated page carries a stored theme', !!themeOf(gen));

  const dl = mkdtempSync(join(tmpdir(), 'theme_save_'));
  await t.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  await t.open(page);
  await t.ev(t.key('s', { ctrlKey: true }));
  for (let i = 0; i < 30; i++) {
    if (await t.ev(`(() => { const b = document.querySelector('#save-modal[open] button[value="continue"]'); if (!b) return false; b.click(); return true; })()`)) break;
    await sleep(100);
  }
  let saved = '';
  for (let i = 0; i < 60 && !saved; i++) {
    const f = readdirSync(dl).find((n) => n.endsWith('.html'));
    if (f) { await sleep(200); saved = readFileSync(join(dl, f), 'utf8'); } else await sleep(100);
  }
  t.check('file: Save wrote a page', saved.length > 0);
  t.check('file: the saved page keeps the stored theme, unchanged', themeOf(saved) === themeOf(gen), (themeOf(saved) || 'none').slice(0, 120));
  t.check('file: the theme script still follows the end comment', /<!-- end diagram-data -->\n {2}<script id="diagram-theme"/.test(saved));
  t.check('file: the reading guide still ends at the end comment', guideValid(saved));
  rmSync(dl, { recursive: true, force: true });

  const stub = `(() => {
    window.__pub = []; window.__dl = [];
    window.claude = { use: async (name) => {
      if (name === 'artifact') return { publish: async (files) => { window.__pub.push(files); } };
      if (name === 'downloads') return { save: async (a) => { window.__dl.push({ filename: a.filename, text: typeof a.data === 'string' ? a.data : await a.data.text() }); } };
      return null;
    } };
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('script'); s.id = 'claude-runtime-probe'; s.textContent = '/* injected */';
      document.head.appendChild(s.cloneNode(true)); document.body.appendChild(s);
    });
  })()`;
  await t.send('Page.addScriptToEvaluateOnNewDocument', { source: stub });
  await t.open(artifact);
  const genArt = readFileSync(artifact, 'utf8').replace(/\r\n/g, '\n');
  const genJson = readFileSync(join(dirname(artifact), 'diagram.json'), 'utf8').replace(/\r\n/g, '\n');
  t.check('artifact: index.html carries a stored theme', !!themeOf(genArt));
  await t.ev(`document.getElementById('btn-save').click()`);
  await sleep(600);
  const pub = JSON.parse(await t.ev(`JSON.stringify(window.__pub)`));
  const files = pub[0] || {};
  t.check('artifact: Save published files["diagram.json"] matching sibling diagram.json',
    pub.length === 1 && Object.keys(files).length === 1 && files['diagram.json'] === genJson, t.errors.join(' | '));
  t.check('artifact: published files do not include injected scripts',
    !Object.values(files).some((v) => String(v).includes('claude-runtime-probe')));

  await t.ev(`document.getElementById('btn-export').click()`);
  await t.ev(`document.querySelector('[data-export="html"]').click()`);
  let exportedList = [];
  for (let i = 0; i < 20 && !exportedList.length; i++) {
    await sleep(100);
    exportedList = JSON.parse(await t.ev(`JSON.stringify(window.__dl)`));
  }
  const exported = (exportedList[0] || {}).text || '';
  t.check('artifact: Export > HTML file delivers a standalone .html page',
    exportedList.length === 1 && /\.html$/.test(exportedList[0].filename) && exported.startsWith('<!DOCTYPE html>\n<!-- For agents:'),
    exportedList.length ? exportedList[0].filename : 'no download');
  t.check('artifact: exported HTML keeps the stored theme, unchanged',
    themeOf(exported) === themeOf(genArt) && !!themeOf(exported), (themeOf(exported) || 'none').slice(0, 120));
  t.check('artifact: exported theme script follows the end comment in <head>',
    /<!-- end diagram-data -->\s*<script id="diagram-theme"/.test(exported)
    && exported.indexOf('<!-- end diagram-data -->') < exported.indexOf('id="diagram-theme"')
    && exported.indexOf('id="diagram-theme"') < exported.indexOf('</head>'));
  t.check('artifact: exported HTML has valid reading guide line numbers and no injected scripts',
    guideValid(exported) && !exported.includes('claude-runtime-probe'));
  t.check('artifact: no console errors', t.errors.length === 0, t.errors.join(' | '));
} catch (err) {
  console.error('[ERROR]', err.message);
  code = 1;
} finally {
  await t.close();
}
process.exit(code || t.finish());
