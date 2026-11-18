// Harness for the Mermaid reader and writer (flowchart and use case), see dev/plans/plan-mermaid-input.md "Harness".
//   1. Round trip: fixture JSON -> toMermaid -> fromMermaid must give back the same authoring JSON.
//   2. Validity: every written .mmd passes mermaid.parse (the pinned devDependency, run in headless Chrome).
//   3. Leniency: every dev/fixtures/mermaid/corpus/*.mmd imports without throwing or [ERROR] (the type comes from its header).
// A type may add its own normalising in dev/check_mermaid_norm.<kind>.mjs: `export function normalise(data, safeId, base)`,
// where `base` is the generic normaliser below; without that file the generic one is used.
//      The --layout dry run that follows comes with Phase 4 and is skipped until then.
//
//   node dev/check_mermaid.mjs --browser <chrome> [--kind flowchart|usecase|sequence|erd]
// Exit codes: 0 all pass, 1 setup error or a failed check.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { argOf, launch } from './cdp.mjs';
import { defaultPalette, loadMermaidIO } from '../scripts/mermaid_io.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const browser = argOf('browser');
const onlyKind = argOf('kind');
const KINDS = ['flowchart', 'usecase', 'sequence', 'erd'];
if (onlyKind && !KINDS.includes(onlyKind)) { console.error(`--kind must be one of ${KINDS.join(', ')}`); process.exit(1); }
const kinds = onlyKind ? [onlyKind] : KINDS;

let failed = 0;
const pass = (name) => console.log(`[PASS] ${name}`);
const fail = (name, lines = []) => { failed++; console.log(`[FAIL] ${name}`); lines.forEach((l) => console.log(`       ${l}`)); };

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.json') ? [join(dir, e.name)] : []));
}

function fixturesOf(kind) {
  const examples = readdirSync(join(ROOT, 'references/examples')).filter((f) => f.startsWith(`example-${kind}`) && f.endsWith('.json')).map((f) => join(ROOT, 'references/examples', f));
  return [...walk(join(ROOT, 'dev/fixtures', kind)), ...examples].sort();
}

const extract = (file) => JSON.parse(execFileSync('python3', [join(ROOT, 'scripts/layout_engine.py'), '--extract', file], { encoding: 'utf8', maxBuffer: 1 << 26 }));

// ---- normaliser: drops only what the plan says to ignore, makes defaults explicit, compares the rest strictly ----

const POSITION_KEYS = new Set(['x', 'y', 'w', 'h', 'layout', 'height']); // positions, the layout map, lane height
const ID_ARRAYS = ['lanes', 'nodes', 'subjects', 'actors', 'useCases']; // arrays whose items define ids
const REF_KEYS = new Set(['laneId', 'from', 'to', 'subject', 'parent']); // string values that refer to an id
const REF_ARRAY_KEYS = new Set(['nodes', 'useCases', 'actors']); // inside a note: arrays of ids
const LIST_ID_KEYS = ['edges', 'links', 'notes']; // compared as ordered lists of content, their ids are ignored

function normalise(data, safeId) {
  const used = new Set();
  const map = new Map();
  if (safeId) for (const k of ID_ARRAYS) for (const it of data[k] || []) if (it && typeof it.id === 'string' && !map.has(it.id)) map.set(it.id, safeId(it.id, used));
  const m = (v) => (typeof v === 'string' && map.has(v) ? map.get(v) : v);
  const out = {};
  for (const [key, val] of Object.entries(data)) {
    if (POSITION_KEYS.has(key)) continue;
    if (ID_ARRAYS.includes(key) || LIST_ID_KEYS.includes(key)) {
      out[key] = (val || []).map((it) => item(key, it, m));
      // Flowchart steps are written grouped by lane, so their order changes (decided: compare them by id)
      if (key === 'nodes' && data.diagramType !== 'usecase') out[key].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
    } else out[key] = val;
  }
  return out;
}

function item(listKey, it, m) {
  const o = {};
  for (const [k, v] of Object.entries(it)) {
    if (POSITION_KEYS.has(k)) continue;
    if (k === 'id') { if (!LIST_ID_KEYS.includes(listKey)) o.id = m(v); continue; }
    if (REF_KEYS.has(k)) o[k] = m(v);
    else if (listKey === 'notes' && REF_ARRAY_KEYS.has(k) && Array.isArray(v)) o[k] = v.map(m);
    else o[k] = v;
  }
  // defaults made explicit
  if (listKey === 'nodes' && o.type === undefined) o.type = 'task';
  if (listKey === 'edges' && o.label === undefined) o.label = '';
  if (listKey === 'useCases' && o.level === undefined) o.level = 'user';
  if (listKey === 'actors' && o.kind === undefined) o.kind = 'human';
  return o;
}

function diff(a, b, path = '$') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(a) && isObj(b)) return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap((k) => diff(a[k], b[k], `${path}.${k}`));
  if (Array.isArray(a) && Array.isArray(b)) {
    const out = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) out.push(...diff(a[i], b[i], `${path}[${i}]`));
    return out;
  }
  return [`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`];
}

// ---- run ----

const written = []; // { name, text } for the validity step
const palette = defaultPalette();

for (const kind of kinds) {
  const impl = `assets/types/${kind}/mermaid.js`;
  if (!existsSync(join(ROOT, impl)) || !existsSync(join(ROOT, 'assets/shell/mermaid-flow.js'))) {
    console.log(`[SKIP] ${kind}: ${impl} not present`);
    continue;
  }
  const io = loadMermaidIO(kind);
  const normFile = join(ROOT, `dev/check_mermaid_norm.${kind}.mjs`);
  const norm = existsSync(normFile) ? (await import(pathToFileURL(normFile).href)).normalise : null;
  const normaliseKind = (data, safeId) => (norm ? norm(data, safeId, normalise) : normalise(data, safeId));
  for (const file of fixturesOf(kind)) {
    const name = `round trip ${relative(ROOT, file)}`;
    try {
      const data = extract(file);
      if (data.diagramType !== kind) continue;
      const text = io.toMermaid(data, { palette });
      written.push({ name: relative(ROOT, file), text });
      const back = io.fromMermaid(text);
      const a = normaliseKind(data, io.mmdSafeId);
      const b = normaliseKind(back.data, null);
      const d = diff(a, b);
      d.length ? fail(name, d) : pass(name);
    } catch (e) { fail(name, [String(e.message || e)]); }
  }
  // leniency
  const corpus = join(ROOT, 'dev/fixtures/mermaid/corpus');
  for (const f of readdirSync(corpus).filter((n) => n.endsWith('.mmd')).sort()) {
    const text = readFileSync(join(corpus, f), 'utf8');
    const body = text.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n').filter((l) => l.trim() && !l.trim().startsWith('%%'))[0] || '';
    const isUse = /^\s*%%\s*@type\s+usecase\b/m.test(text);
    const fileKind = /^\s*sequenceDiagram\b/.test(body) ? 'sequence' : /^\s*erDiagram\b/.test(body) ? 'erd'
      : /^\s*(flowchart|graph)\b/.test(body) ? (isUse ? 'usecase' : 'flowchart') : null;
    if (fileKind !== kind) continue;
    const name = `leniency ${f}`;
    try {
      const r = io.fromMermaid(text);
      const errs = [...(r.infos || []), ...(r.warnings || [])].filter((l) => /^\[ERROR\]/.test(l));
      errs.length ? fail(name, errs) : pass(name);
    } catch (e) { fail(name, [String(e.message || e)]); }
  }
}
console.log('[SKIP] leniency --layout dry run: comes with Phase 4');

// ---- validity: mermaid.parse in headless Chrome ----

if (written.length) {
  const mmJs = join(ROOT, 'node_modules/mermaid/dist/mermaid.min.js');
  if (!browser || !existsSync(mmJs)) {
    fail('validity setup', [!browser ? 'pass --browser <chrome>' : 'run npm install (node_modules/mermaid missing)']);
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'mmd_'));
    const page = join(dir, 'parse.html');
    writeFileSync(page, `<!doctype html><meta charset="utf-8"><script src="${pathToFileURL(mmJs).href}"></script>`);
    const t = await launch(browser).catch((e) => { console.error('[ERROR]', e.message); process.exit(1); });
    try {
      await t.open(page);
      const res = await t.ev(`(async () => {
        mermaid.initialize({ startOnLoad: false });
        const out = [];
        for (const text of ${JSON.stringify(written.map((w) => w.text))}) {
          try { await mermaid.parse(text); out.push(null); } catch (e) { out.push(String(e.message || e).split('\\n').slice(0, 3).join(' | ')); }
        }
        return out;
      })()`);
      written.forEach((w, i) => (res[i] === null ? pass(`valid Mermaid ${w.name}`) : fail(`valid Mermaid ${w.name}`, [res[i]])));
    } finally { await t.close(); rmSync(dir, { recursive: true, force: true }); }
  }
}

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
