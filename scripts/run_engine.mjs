// Runs a diagram type's layout engine (the same assets/types/<type>/engine.js the page uses for Auto-Tidy).
//   node run_engine.mjs <engine.js> < diagram.json  >  laid-out diagram.json
// Zero dependencies; needs Node >= 18.
import { readFileSync } from 'node:fs';

const enginePath = process.argv[2];
if (!enginePath) {
  console.error('usage: node run_engine.mjs <engine.js> < diagram.json');
  process.exit(2);
}
const layoutDiagram = new Function(`${readFileSync(enginePath, 'utf8')}\nreturn layoutDiagram;`)();
const data = JSON.parse(readFileSync(0, 'utf8'));
layoutDiagram(data);
process.stdout.write(JSON.stringify(data));
