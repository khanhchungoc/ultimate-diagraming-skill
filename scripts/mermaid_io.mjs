// Mermaid reader and writer for a diagram type (the same assets/shell/mermaid-flow.js + assets/types/<kind>/mermaid.js the page uses).
//   node mermaid_io.mjs from <kind> < x.mmd    prints {data, infos, warnings}
//   node mermaid_io.mjs to <kind> < x.json     prints Mermaid (palette slots from assets/tokens/default.json, or --palette hex,hex,...)
//   node mermaid_io.mjs ids <kind> < x.json    prints {id: id as the writer spells it} for the items that have ids
// `loadMermaidIO(kind)` is exported for other scripts. Zero dependencies; needs Node >= 18.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// mermaid-flow.js holds the flowchart-family tokenizer and the text helpers (mmdText, mmdQuote, mmdSafeId) every type uses
const SHARED = Object.fromEntries(['flowchart', 'usecase', 'sequence', 'erd', 'c4', 'gantt'].map((k) => [k, 'assets/shell/mermaid-flow.js']));

/** Returns { fromMermaid, toMermaid, mmdParseFlow, mmdSafeId }. Throws a clear Error for a kind without Mermaid support. */
export function loadMermaidIO(kind) {
  if (!SHARED[kind]) throw new Error(`Mermaid is not supported yet for "${kind}" (supported: ${Object.keys(SHARED).join(', ')})`);
  const files = [SHARED[kind], `assets/types/${kind}/mermaid.js`].map((f) => join(ROOT, f));
  const missing = files.find((f) => !existsSync(f));
  if (missing) throw new Error(`missing ${missing}`);
  const src = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  const names = ['fromMermaid', 'toMermaid', 'mmdParseFlow', 'mmdSafeId'];
  return new Function(`${src}\nreturn { ${names.map((n) => `${n}: typeof ${n} === 'function' ? ${n} : null`).join(', ')} };`)();
}

/** The 8 palette slot colours of the default tokens, for the writer's classDef lines. */
export function defaultPalette() {
  const t = JSON.parse(readFileSync(join(ROOT, 'assets/tokens/default.json'), 'utf8'));
  return t.palette.map((s) => s.hex);
}

/** The writer's id for each item id, in the order the writers assign them (shared uniqueness set). */
export function safeIdMap(io, data) {
  const used = new Set(), map = {};
  for (const k of ['lanes', 'nodes', 'subjects', 'actors', 'useCases', 'entities', 'participants', 'groups', 'elements', 'items', 'markers']) {
    for (const it of data[k] || []) if (it && typeof it.id === 'string' && !(it.id in map)) map[it.id] = io.mmdSafeId(it.id, used);
  }
  return map;
}

async function main() {
  process.stdin.setEncoding('utf8');
  if (process.stdout.setDefaultEncoding) process.stdout.setDefaultEncoding('utf8');
  if (process.stderr.setDefaultEncoding) process.stderr.setDefaultEncoding('utf8');
  const [mode, kind, ...rest] = process.argv.slice(2);
  if (!['from', 'to', 'ids'].includes(mode) || !kind) {
    console.error('usage: mermaid_io.mjs from|to|ids <flowchart|usecase|sequence|erd|c4|gantt> [--palette hex,hex,...] < input');
    process.exit(1);
  }
  let io;
  try { io = loadMermaidIO(kind); } catch (e) { console.error(`[ERROR] ${e.message}`); process.exit(1); }
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  try {
    if (mode === 'from') console.log(JSON.stringify(io.fromMermaid(text), null, 2));
    else if (mode === 'ids') console.log(JSON.stringify(safeIdMap(io, JSON.parse(text))));
    else {
      const i = rest.indexOf('--palette');
      console.log(io.toMermaid(JSON.parse(text), { palette: i >= 0 ? rest[i + 1].split(',') : defaultPalette() }));
    }
  } catch (e) { console.error(`[ERROR] ${e.message}`); process.exit(1); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
