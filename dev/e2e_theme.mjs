// Save keeps the stored theme (plan: dev/plans/plan-design-tokens.md, Phase 7).
//   node dev/e2e_theme.mjs --browser <chrome> --page <themed.html> --artifact <themed-artifact.html>
// Both pages come from `layout_engine.py --layout ... --theme <file>` (the second with --target artifact).
// File mode: Save takes its download path; the saved file must still hold the same <script id="diagram-theme"> after the
// data block's end comment. Artifact mode: Save publishes through a stubbed window.claude; the published page keeps the
// theme script and still drops a script the viewer injected.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser'), page = argOf('page'), artifact = argOf('artifact');
if (!browser || !page || !artifact) { console.error('usage: --browser <chrome> --page <html> --artifact <html>'); process.exit(1); }
const themeOf = (html) => (html.match(/<script id="diagram-theme" type="application\/json">([\s\S]*?)<\/script>/) || [])[1];
const t = await launch(browser);
let code = 0;
try {
  const gen = readFileSync(page, 'utf8').replace(/\r\n/g, '\n');
  t.check('generated page carries a stored theme', !!themeOf(gen));

  const dl = mkdtempSync(join(tmpdir(), 'theme_save_'));
  await t.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  await t.open(page);
  await t.ev(t.key('s', { ctrlKey: true }));
  let saved = '';
  for (let i = 0; i < 60 && !saved; i++) {
    const f = readdirSync(dl).find((n) => n.endsWith('.html'));
    if (f) { await sleep(200); saved = readFileSync(join(dl, f), 'utf8'); } else await sleep(100);
  }
  t.check('file: Save wrote a page', saved.length > 0);
  t.check('file: the saved page keeps the stored theme, unchanged', themeOf(saved) === themeOf(gen), (themeOf(saved) || 'none').slice(0, 120));
  t.check('file: the theme script still follows the end comment', /<!-- end diagram-data -->\n {2}<script id="diagram-theme"/.test(saved));
  t.check('file: the reading guide still ends at the end comment', (() => {
    const g = saved.match(/Read lines 1-(\d+) only/); return g && saved.split('\n')[+g[1] - 1].includes('<!-- end diagram-data -->');
  })());
  rmSync(dl, { recursive: true, force: true });

  const stub = `(() => {
    window.__pub = [];
    window.claude = { use: async (name) => name === 'artifact' ? { publish: async (html) => { window.__pub.push(html); } } : null };
    document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('script'); s.id = 'claude-runtime-probe'; s.textContent = '/* injected */'; document.body.appendChild(s); });
  })()`;
  await t.send('Page.addScriptToEvaluateOnNewDocument', { source: stub });
  await t.open(artifact);
  await t.ev(`document.getElementById('btn-save').click()`);
  await sleep(600);
  const doc = JSON.parse(await t.ev(`JSON.stringify(window.__pub)`))[0] || '';
  t.check('artifact: Save published a page', doc.length > 0, t.errors.join(' | '));
  const genArt = readFileSync(artifact, 'utf8').replace(/\r\n/g, '\n');
  t.check('artifact: the published page keeps the stored theme, unchanged', themeOf(doc) === themeOf(genArt) && !!themeOf(doc), (themeOf(doc) || 'none').slice(0, 120));
  t.check('artifact: the theme script follows the end comment, before the styles', doc.indexOf('<!-- end diagram-data -->') < doc.indexOf('id="diagram-theme"') && doc.indexOf('id="diagram-theme"') < doc.indexOf('<style>', doc.indexOf('<body>')));
  t.check('artifact: a script the viewer injected is still not published', !doc.includes('claude-runtime-probe'));
  t.check('artifact: no console errors', t.errors.length === 0, t.errors.join(' | '));
} catch (err) {
  console.error('[ERROR]', err.message);
  code = 1;
} finally {
  await t.close();
}
process.exit(code || t.finish());
