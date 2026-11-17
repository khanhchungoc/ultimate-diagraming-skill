// Runs a diagram type's layout engine (the same assets/types/<type>/engine.js the page uses for Auto-Tidy).
//   node run_engine.mjs <engine.js> < {"tokens": <TOKENS>, "diagram": <diagram.json>}  >  laid-out diagram.json
// `tokens` is what the page defines as TOKENS (scripts/tokens.py tokens_data): the engines read their text widths from it.
// Zero dependencies; needs Node >= 18.
import { readFileSync } from 'node:fs';

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
// --keep: redraw lines and labels from the positions already in the diagram instead of laying it out again
// (routeDiagram lays out by itself when an item has no position; engines without routeDiagram keep saved x/y)
const keep = process.argv.includes('--keep');
const engine = new Function('TOKENS', `${readFileSync(enginePath, 'utf8')}\nreturn { layoutDiagram, routeDiagram: typeof routeDiagram === 'function' ? routeDiagram : null };`)(tokens);
const hasSavedPositions = diagram.diagramType !== 'sequence' && (diagram.nodes || []).length > 0
  && (diagram.nodes || []).every(n => typeof n.x === 'number' && typeof n.y === 'number');
if (keep && engine.routeDiagram) {
  engine.routeDiagram(diagram);
} else if (!keep || !hasSavedPositions) {
  engine.layoutDiagram(diagram);
}
process.stdout.write(JSON.stringify(diagram));
