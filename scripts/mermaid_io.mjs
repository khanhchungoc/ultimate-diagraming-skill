// Mermaid reader and writer for a diagram type (the same assets/shell/mermaid-flow.js + assets/types/<kind>/mermaid.js the page uses).
//   node mermaid_io.mjs from <kind> < x.mmd    prints {data, infos, warnings}
//   node mermaid_io.mjs to <kind> < x.json     prints Mermaid (palette slots from assets/tokens/default.json)
// `loadMermaidIO(kind)` is exported for other scripts. Zero dependencies; needs Node >= 18.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// mermaid-flow.js holds the flowchart-family tokenizer and the text helpers (mmdText, mmdQuote, mmdSafeId) every type uses
const SHARED = Object.fromEntries(['flowchart', 'usecase', 'sequence', 'erd'].map((k) => [k, 'assets/shell/mermaid-flow.js']));

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

async function main() {
  const [mode, kind] = process.argv.slice(2);
  if (!['from', 'to'].includes(mode) || !kind) {
    console.error('usage: mermaid_io.mjs from|to <flowchart|usecase|sequence|erd> < input');
    process.exit(1);
  }
  let io;
  try { io = loadMermaidIO(kind); } catch (e) { console.error(`[ERROR] ${e.message}`); process.exit(1); }
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  try {
    if (mode === 'from') console.log(JSON.stringify(io.fromMermaid(text), null, 2));
    else console.log(io.toMermaid(JSON.parse(text), { palette: defaultPalette() }));
  } catch (e) { console.error(`[ERROR] ${e.message}`); process.exit(1); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
