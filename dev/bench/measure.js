// node measure.js <out-dir> <shots-dir> <mermaid.min.js>: load each HTML, time to rendered, errors, screenshot
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const [outDir, shotDir, mm] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch();
  const rows = [];
  for (const f of fs.readdirSync(outDir).filter(f => f.endsWith('.html')).sort()) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
    await page.route(/cdn\.jsdelivr\.net\/npm\/mermaid/, r => r.fulfill({ path: mm, contentType: 'text/javascript' }));
    const t0 = Date.now();
    await page.goto('file://' + path.join(outDir, f));
    let ok = true;
    try {
      if (f.startsWith('mermaid')) await page.waitForFunction(() => document.querySelector('.mermaid svg, svg[id^="mermaid"], pre svg, div svg[aria-roledescription]'), null, { timeout: 30000 });
      else await page.waitForFunction(() => document.documentElement.dataset.diagramReady === '1' || document.body.dataset.diagramReady === '1', null, { timeout: 30000 });
    } catch { ok = false; }
    const ms = Date.now() - t0;
    const syntaxErr = await page.evaluate(() => /Syntax error|Parse error/i.test(document.body.innerText));
    await page.screenshot({ path: path.join(shotDir, f.replace('.html', '.png')), fullPage: false });
    rows.push({ file: f, bytes: fs.statSync(path.join(outDir, f)).size, renderMs: ms, rendered: ok && !syntaxErr, errors: errs.slice(0, 3) });
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(rows, null, 1));
})();
