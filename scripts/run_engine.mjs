// Runs a diagram type's layout engine (the same assets/types/<type>/engine.js the page uses for Auto-Tidy).
//   Single-shot: node run_engine.mjs <engine.js> [--keep] < {"tokens": <TOKENS>, "diagram": <diagram.json>}
//   Worker:      node run_engine.mjs --server  (newline-delimited JSON requests/responses on stdin/stdout)
// `tokens` is what the page defines as TOKENS (scripts/tokens.py tokens_data): the engines read their text widths from it.
// Zero dependencies; needs Node >= 18.
import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

// The shared orthogonal router, loaded ahead of every engine (the page joins it ahead of engine.js too: ENGINE_JS)
const routerSrc = readFileSync(fileURLToPath(new URL('../assets/shell/ortho-router.js', import.meta.url)), 'utf8');
const factories = new Map();
const engines = new Map();

function getEngine(enginePath, tokens, tokensKey) {
  let factory = factories.get(enginePath);
  if (!factory) {
    // a type's own gutter routing (route.js beside engine.js) loads before the engine
    const routePath = enginePath.replace(/engine\.js$/, 'route.js');
    const routeSrc = routePath !== enginePath && existsSync(routePath) ? `${readFileSync(routePath, 'utf8')}\n` : '';
    factory = new Function(
      'TOKENS',
      `${routerSrc}\n${routeSrc}${readFileSync(enginePath, 'utf8')}\nreturn { layoutDiagram, routeDiagram: typeof routeDiagram === 'function' ? routeDiagram : null };`
    );
    factories.set(enginePath, factory);
  }
  const key = `${enginePath}\0${tokensKey}`;
  let engine = engines.get(key);
  if (!engine) {
    engine = factory(tokens);
    engines.set(key, engine);
  }
  return engine;
}

function runDiagram(engine, diagram, keep) {
  // --keep: redraw lines and labels from the positions already in the diagram instead of laying it out again
  // (routeDiagram lays out by itself when an item has no position; engines without routeDiagram keep saved x/y)
  const hasSavedPositions = diagram.diagramType !== 'sequence' && (diagram.nodes || []).length > 0
    && (diagram.nodes || []).every(n => typeof n.x === 'number' && typeof n.y === 'number');
  if (keep && engine.routeDiagram) {
    engine.routeDiagram(diagram);
  } else if (!keep || !hasSavedPositions) {
    engine.layoutDiagram(diagram);
  }
  return diagram;
}

async function runServer() {
  let lastTokens = null;
  let lastTokensKey = null;
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const req = JSON.parse(line);
      const enginePath = req.engine;
      const diagram = req.diagram;
      let tokens = req.tokens;
      let tokensKey;
      if (tokens != null) {
        tokensKey = JSON.stringify(tokens);
        lastTokens = tokens;
        lastTokensKey = tokensKey;
      } else {
        tokens = lastTokens;
        tokensKey = lastTokensKey;
      }
      if (!enginePath || !tokens || !diagram) {
        throw new Error('server request must include engine, diagram, and tokens (or reuse prior tokens)');
      }
      const engine = getEngine(enginePath, tokens, tokensKey);
      runDiagram(engine, diagram, Boolean(req.keep));
      process.stdout.write(`${JSON.stringify({ ok: true, diagram })}\n`);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    }
  }
}

function runSingle() {
  const enginePath = process.argv[2];
  if (!enginePath) {
    console.error('usage: node run_engine.mjs <engine.js> < {"tokens": {...}, "diagram": {...}}');
    process.exit(2);
  }
  const { tokens, diagram } = JSON.parse(readFileSync(0, 'utf8'));
  if (!tokens || !diagram) {
    console.error('run_engine.mjs: stdin must be {"tokens": ..., "diagram": ...}');
    process.exit(2);
  }
  const keep = process.argv.includes('--keep');
  const engine = getEngine(enginePath, tokens, '');
  runDiagram(engine, diagram, keep);
  process.stdout.write(JSON.stringify(diagram));
}

if (process.argv.includes('--server')) {
  await runServer();
} else {
  runSingle();
}
