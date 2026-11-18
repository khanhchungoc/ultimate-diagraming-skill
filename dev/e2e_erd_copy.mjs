// Copy as Mermaid for the ER diagram, and (with --artifact) Save inside a claude.ai artifact.
//   node dev/e2e_erd_copy.mjs --browser <chrome> --page <example-erd.html> --large <saas-billing.html> [--artifact <dir/index.html>] [--dump <prefix>]
// --page: references/examples/example-erd.json laid out with `layout_engine.py --layout`.
// --large: dev/fixtures/erd/saas-billing.json laid out the same way.
// --artifact: the --page fixture laid out with `--target artifact` (the split directory's index.html).
// --dump: also write each copied Mermaid text to <prefix>-<name>.mmd (used to parse it with the real Mermaid library).
// Exit codes: 0 all passed, 1 setup error, 2 a check failed.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { argOf, launch, sleep } from './cdp.mjs';

const browser = argOf('browser'), page = argOf('page'), large = argOf('large'), artifact = argOf('artifact'), dump = argOf('dump');
if (!browser || !page || !large) { console.error('usage: --browser <chrome> --page <html> --large <html> [--artifact <dir/index.html>] [--dump <prefix>]'); process.exit(1); }

const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
let code = 0;
try {
  const J = JSON.stringify;
  // A synthetic clipboard: headless Chrome from file:// has no clipboard permission, so writeText is replaced by a
  // recorder (the page code under test is the caller of writeText, not the browser's clipboard).
  const stub = `window.__clip = []; window.__fail = false;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (s) => window.__fail ? Promise.reject(new Error('denied')) : (window.__clip.push(s), Promise.resolve()) } });
    window.__alerts = []; window.alert = (m) => window.__alerts.push(String(m));`;
  const { identifier } = await t.send('Page.addScriptToEvaluateOnNewDocument', { source: stub });
  const copyMermaid = async () => {
    await t.ev(`document.getElementById('btn-export').click()`);
    await t.clickOn('[data-copy="mermaid"]');
  };
  const NAME = String.raw`(?:[A-Za-z_][A-Za-z0-9_-]*|"[^"]+")`;
  const relRe = new RegExp(String.raw`^  (${NAME}) (\|\||\|o|\}\||\}o)(--|\.\.)(\|\||o\||\|\{|o\{) (${NAME}) : ("[^"]*"|[A-Za-z0-9_-]+)$`);
  // The writer's attribute line: type (spaces as -, ? for nullable, _ for none) then name, keys, comment
  const attrRe = /^    \S+ \S+( (PK|FK|UK)(, (PK|FK|UK))*)?( "[^"]*")?$/;

  for (const [name, file] of [['example', page], ['saas-billing', large]]) {
    await t.open(file);
    const model = JSON.parse(await t.ev(`document.getElementById('diagram-data').textContent`));
    const visible = await t.ev(`!document.querySelector('[data-copy="mermaid"]').hidden`);
    t.check(`${name}: the Copy group offers Mermaid, first`, visible
      && await t.ev(`document.querySelector('[data-copy-label]').nextElementSibling.dataset.copy`) === 'mermaid'
      && !(await t.ev(`document.querySelector('[data-copy-label]').hidden`)));
    await copyMermaid();
    await sleep(150);
    const clip = JSON.parse(await t.ev(`JSON.stringify(window.__clip)`));
    const status = await t.ev(`document.getElementById('save-status').textContent`);
    const text = clip[0] || '';
    const lines = text.split('\n');
    t.check(`${name}: one write of text with the erDiagram header, and the "Copied as Mermaid" badge`, clip.length === 1 && lines.includes('erDiagram') && status === 'Copied as Mermaid', `${clip.length} ${status}`);
    t.check(`${name}: the menu closed`, await t.ev(`document.getElementById('export-menu').hidden`));
    const rels = lines.filter((l) => /^  \S.* : /.test(l));
    const badRel = rels.find((l) => !relRe.test(l));
    t.check(`${name}: ${model.relationships.length} relationship lines, all in Mermaid syntax`, rels.length === model.relationships.length && !badRel, badRel);
    t.check(`${name}: identifying relationships use --, others ..`,
      rels.filter((l) => l.includes('--')).length === model.relationships.filter((r) => r.identifying === true).length);
    const opens = lines.filter((l) => /^  \S.* \{$/.test(l)).length;
    const cols = lines.filter((l) => /^    \S/.test(l)).length;
    const badAttr = lines.find((l) => /^    \S/.test(l) && !attrRe.test(l));
    t.check(`${name}: ${model.entities.length} entity blocks, ${model.entities.reduce((n, e) => n + e.columns.length, 0)} attribute lines, all well formed`,
      opens === model.entities.length && lines.filter((l) => l === '  }').length === opens
      && cols === model.entities.reduce((n, e) => n + e.columns.length, 0) && !badAttr, badAttr);
    t.check(`${name}: copying changed nothing in the document`, !(await t.ev(`/unsaved/i.test(document.getElementById('save-status').textContent)`)) && t.errors.length === 0, t.errors.join(' | '));
    if (dump) writeFileSync(`${dump}-${name}.mmd`, text);
    if (name === 'example') {
      // The clipboard now refuses: the shell shows the same failure alert as the other copies
      await t.ev(`window.__fail = true`);
      await copyMermaid();
      await sleep(100);
      const alerts = JSON.parse(await t.ev(`JSON.stringify(window.__alerts)`));
      t.check('a failed clipboard write alerts "Copy failed"', alerts.length === 1 && /^Copy failed: denied/.test(alerts[0]), alerts.join('|'));
    }
  }

  // claude.ai Artifact (only with --artifact): Save publishes diagram.json through a stubbed window.claude;
  // edits reach the published JSON; use() -> null leaves a View-only page.
  if (artifact) {
    await t.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    const genData = readFileSync(join(dirname(artifact), 'diagram.json'), 'utf8').replace(/\r\n/g, '\n');
    const ids = await t.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__pub = [];
      window.claude = { use: async (n) => n === 'artifact' ? { publish: async (files) => { window.__pub.push(files); } } : null };` });
    await t.open(artifact);
    await t.ev(`document.getElementById('btn-save').click()`);
    await sleep(400);
    let pub = JSON.parse(await t.ev(`JSON.stringify(window.__pub)`));
    const json1 = (pub[0] && pub[0]['diagram.json']) || '';
    t.check('artifact: Save publishes once with diagram.json byte-identical to generated',
      pub.length === 1 && Object.keys(pub[0]).length === 1 && json1 === genData && t.errors.length === 0, `${pub.length} ${t.errors.join(' | ')}`);
    // An edit: rename the first table with a real double-click, then save again
    const first = await t.ev(`document.querySelector('.erd-entity:not(.erd-ghost)').dataset.nodeId`);
    await t.clickOn(`.erd-entity[data-node-id="${first}"] .erd-name`, { count: 2 });
    await t.press('a', { modifiers: 2 });
    await t.type('renamed_table');
    await t.press('Enter');
    await sleep(150);
    await t.ev(`document.getElementById('btn-save').click()`);
    await sleep(400);
    pub = JSON.parse(await t.ev(`JSON.stringify(window.__pub)`));
    const json2 = (pub[1] && pub[1]['diagram.json']) || '';
    const d2 = json2 ? JSON.parse(json2) : null;
    t.check('artifact: an edit reaches the published diagram.json',
      pub.length === 2 && Object.keys(pub[1]).length === 1 && json2.endsWith('\n')
      && d2 && d2.entities.some((e) => e.name === 'renamed_table') && t.errors.length === 0,
      `${pub.length} ${t.errors.join(' | ')}`);
    await t.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: ids.identifier });
    const view = await t.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.claude = { use: async () => null };` });
    await t.open(artifact);
    t.check('artifact: use() -> null shows "View only", hides Save, and adds no Download button',
      (await t.ev(`document.getElementById('save-status').textContent`)) === 'View only'
      && (await t.ev(`document.getElementById('btn-save').hidden`))
      && (await t.ev(`!document.getElementById('btn-download-html')`)), '');
    await t.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: view.identifier });
  }
} catch (err) {
  console.error('[ERROR]', err.message);
  code = 1;
} finally {
  await t.close();
}
process.exit(code || t.finish());
