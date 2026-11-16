#!/usr/bin/env node
// Standalone check of the use case layout engine (assets/types/usecase/engine.js) against dev/fixtures/usecase/*.json.
// For every fixture: runs layoutDiagram, compares with dev/fixtures/usecase/golden/<name>.json, and checks the geometry:
//   no two ellipses or actors overlap, no actor inside a subject box, every use case inside its subject, no line through an
//   unrelated ellipse or actor, no two labelBoxes overlap, and routeDiagram on the output moves nothing.
// Usage: node dev/check_usecase_engine.mjs [--update]      (--update rewrites the goldens: review the diff)
// Exit codes: 0 ok, 1 error, 2 mismatch or failed check.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'dev', 'fixtures', 'usecase'), GOLD = join(DIR, 'golden');
const update = process.argv.includes('--update');

const py = spawnSync('python3', ['-I', '-c',
  'import sys, json; sys.path.insert(0, "scripts"); import tokens; print(json.dumps(tokens.tokens_data(tokens.load_tokens())))'],
{ cwd: ROOT, encoding: 'utf8' });
if (py.status !== 0) { console.error('cannot build tokens:', py.stderr); process.exit(1); }
const tokens = JSON.parse(py.stdout);
const engine = new Function('TOKENS', `${readFileSync(join(ROOT, 'assets/types/usecase/engine.js'), 'utf8')}\nreturn { layoutDiagram, routeDiagram };`)(tokens);

const clone = (o) => JSON.parse(JSON.stringify(o));
const boxOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const quad = (p0, c, p1, t) => [0, 1].map((i) => (1 - t) * (1 - t) * p0[i] + 2 * (1 - t) * t * c[i] + t * t * p1[i]);
const sample = (pts) => {
  const out = [];
  const cubic = (t) => [0, 1].map((i) => (1 - t) ** 3 * pts[0][i] + 3 * (1 - t) ** 2 * t * pts[1][i] + 3 * (1 - t) * t * t * pts[2][i] + t ** 3 * pts[3][i]);
  if (pts.length > 4) return pts;   // an orthogonal generalization path
  for (let i = 0; i <= 40; i++) out.push(pts.length === 4 ? cubic(i / 40) : pts.length === 3 ? quad(pts[0], pts[1], pts[2], i / 40) : [pts[0][0] + (pts[1][0] - pts[0][0]) * i / 40, pts[0][1] + (pts[1][1] - pts[0][1]) * i / 40]);
  return out;
};

function geometryProblems(d) {
  const bad = [];
  const subjects = d.subjects || d._subjects;
  const cases = d.useCases.filter((c) => !c._hidden);
  const actors = d.actors;
  for (let i = 0; i < cases.length; i++) for (let j = i + 1; j < cases.length; j++) if (boxOverlap(cases[i], cases[j])) bad.push(`ellipses overlap: ${cases[i].id} ${cases[j].id}`);
  for (let i = 0; i < actors.length; i++) for (let j = i + 1; j < actors.length; j++) if (boxOverlap(actors[i], actors[j])) bad.push(`actors overlap: ${actors[i].id} ${actors[j].id}`);
  actors.forEach((a) => {
    cases.forEach((c) => { if (boxOverlap(a, c)) bad.push(`actor ${a.id} overlaps ellipse ${c.id}`); });
    subjects.forEach((s) => { if (boxOverlap(a, s)) bad.push(`actor ${a.id} inside subject ${s.id}`); });
  });
  const sIndex = (c) => { const i = subjects.findIndex((s) => s.id === c.subject); return i < 0 ? 0 : i; };
  cases.forEach((c) => {
    const s = subjects[sIndex(c)];
    if (c.x < s.x || c.y < s.y + s._titleH || c.x + c.w > s.x + s.w || c.y + c.h > s.y + s.h) bad.push(`use case ${c.id} outside subject ${s.id}`);
  });
  for (let i = 0; i < subjects.length; i++) for (let j = i + 1; j < subjects.length; j++) if (boxOverlap(subjects[i], subjects[j])) bad.push(`subjects overlap: ${subjects[i].id} ${subjects[j].id}`);
  if (new Set(subjects.map((s) => s.x + ':' + s.w)).size > 1) bad.push('subjects do not share one x and width');
  d.links.forEach((l) => {
    if (!l.points || !l.points.length) return;
    const pts = sample(l.points);
    cases.forEach((c) => {
      if (c.id === l.from || c.id === l.to) return;
      const a = c.w / 2, b = c.h / 2, cx = c.x + a, cy = c.y + b;
      if (pts.some((p) => ((p[0] - cx) / a) ** 2 + ((p[1] - cy) / b) ** 2 < 1)) bad.push(`line ${l.id} passes through ellipse ${c.id}`);
    });
    actors.forEach((a) => {
      if (a.id === l.from || a.id === l.to) return;
      if (pts.some((p) => p[0] > a.x && p[0] < a.x + a.w && p[1] > a.y && p[1] < a.y + a.h)) bad.push(`line ${l.id} passes through actor ${a.id}`);
    });
  });
  const labels = d.links.filter((l) => l.labelBox);
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (boxOverlap(labels[i].labelBox, labels[j].labelBox)) bad.push(`labels overlap: ${labels[i].id} ${labels[j].id}`);
  labels.forEach((l) => cases.forEach((c) => {
    const e = { cx: c.x + c.w / 2, cy: c.y + c.h / 2, a: c.w / 2, b: c.h / 2 }, r = l.labelBox;
    const nx = Math.max(r.x, Math.min(e.cx, r.x + r.w)), ny = Math.max(r.y, Math.min(e.cy, r.y + r.h));
    if (((nx - e.cx) / e.a) ** 2 + ((ny - e.cy) / e.b) ** 2 < 1) bad.push(`label of ${l.id} covers ellipse ${c.id}`);
  }));
  return bad;
}

let failed = 0, mismatched = 0;
if (!existsSync(GOLD)) mkdirSync(GOLD, { recursive: true });
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()) {
  const name = file.replace(/\.json$/, '');
  const input = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  input.schemaVersion ??= 1;   // as layout_engine.py --layout sets it, so dev/check_golden.py reads the same goldens
  const out = clone(input);
  engine.layoutDiagram(out);
  const again = clone(input);
  engine.layoutDiagram(again);
  const problems = geometryProblems(out);
  if (!isDeepStrictEqual(out, again)) problems.push('layout is not deterministic');
  const routed = clone(out);
  engine.routeDiagram(routed);
  if (!isDeepStrictEqual(routed, out)) problems.push('routeDiagram on the laid-out diagram moves something');
  const goldPath = join(GOLD, file);
  let status = 'ok';
  if (update) writeFileSync(goldPath, JSON.stringify(out, null, 2) + '\n');
  else if (!existsSync(goldPath)) { status = 'NO GOLDEN'; mismatched++; }
  else if (!isDeepStrictEqual(JSON.parse(readFileSync(goldPath, 'utf8')), out)) { status = 'GOLDEN DIFFERS'; mismatched++; }
  if (problems.length) failed++;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name}: ${out.canvas.width}x${out.canvas.height}, ${out.canvas.crossings} crossings, ${out.canvas.hits} hits${update ? ' (golden written)' : status === 'ok' ? '' : ' [' + status + ']'}`);
  problems.forEach((p) => console.log('     ' + p));
}
process.exit(failed || mismatched ? 2 : 0);
