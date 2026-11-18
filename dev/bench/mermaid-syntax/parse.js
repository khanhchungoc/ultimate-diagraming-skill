// node parse.js cases.json: run mermaid.parse on each case in Chromium, print ok/error per case
const { chromium } = require('playwright'); const fs = require('fs');
const [casesPath, mm] = process.argv.slice(2);
const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.setContent('<html><body></body></html>'); await p.addScriptTag({ path: mm });
  const res = await p.evaluate(async (cases) => {
    mermaid.initialize({ startOnLoad: false });
    const out = [];
    for (const [id, code] of cases) {
      try { await mermaid.parse(code); out.push([id, 'OK']); }
      catch (e) { out.push([id, 'ERR ' + String(e.message || e).split('\n').slice(0, 3).join(' | ').slice(0, 140)]); }
    }
    return out;
  }, cases);
  for (const [id, r] of res) console.log((r === 'OK' ? 'OK  ' : 'ERR ') + id + (r === 'OK' ? '' : '  ' + r.slice(4)));
  await b.close();
})();
