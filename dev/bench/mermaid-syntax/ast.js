// node ast.js cases.json mermaid.js: parse each case and dump what Mermaid's own db holds
const { chromium } = require('playwright'); const fs = require('fs');
const [casesPath, mm] = process.argv.slice(2);
const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.setContent('<html><body></body></html>'); await p.addScriptTag({ path: mm });
  const res = await p.evaluate(async (cases) => {
    mermaid.initialize({ startOnLoad: false });
    const out = [];
    const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v instanceof Map ? Object.fromEntries(v) : v instanceof Set ? [...v] : v)));
    for (const [id, code] of cases) {
      try {
        const d = await mermaid.mermaidAPI.getDiagramFromText(code); const db = d.db; let r = {};
        if (db.getVertices) { r.v = [...db.getVertices().values()].map(v => ({ id: v.id, text: v.text, type: v.type, classes: v.classes, icon: v.icon })); r.e = db.getEdges().map(e => ({ s: e.start, t: e.end, type: e.type, stroke: e.stroke, text: e.text, len: e.length, id: e.id })); r.sg = db.getSubGraphs().map(s => ({ id: s.id, title: s.title, nodes: s.nodes, dir: s.dir })); }
        else if (db.getMessages) { r.a = [...db.getActors().values()].map(a => ({ n: a.name, d: a.description, t: a.type, box: a.box && a.box.name })); r.m = db.getMessages().map(m => ({ f: m.from, t: m.to, msg: m.message, type: m.type, act: m.activate, pl: m.placement })); r.box = db.getBoxes().map(x => ({ n: x.name, c: x.fill })); }
        else if (db.getEntities) { r.ent = strip(db.getEntities()); r.rel = strip(db.getRelationships()); }
        out.push([id, JSON.stringify(r).slice(0, 900)]);
      } catch (e) { out.push([id, 'ERR ' + String(e.message || e).slice(0, 120)]); }
    }
    return out;
  }, cases);
  for (const [id, r] of res) console.log('## ' + id + '\n' + r);
  await b.close();
})();
