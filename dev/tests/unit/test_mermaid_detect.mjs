// Pure unit tests for Mermaid fence unwrapping and diagram type detection (assets/shell/mermaid-flow.js).
//   node dev/tests/unit/test_mermaid_detect.mjs
import assert from 'node:assert/strict';
import { loadMermaidIO } from '../../../scripts/mermaid_io.mjs';

const { mmdDetectType, mmdStripFence } = loadMermaidIO('flowchart');
assert.equal(typeof mmdStripFence, 'function', 'mmdStripFence must be exported');
assert.equal(typeof mmdDetectType, 'function', 'mmdDetectType must be exported');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
}

// --- Fence unwrapping ---
test('strips ```mermaid fence (LF and CRLF)', () => {
  assert.equal(mmdStripFence('```mermaid\nflowchart LR\n  A --> B\n```'), 'flowchart LR\n  A --> B');
  assert.equal(mmdStripFence('  ```MERMAID  \r\nerDiagram\r\n  A ||--o{ B : has\r\n```  '), 'erDiagram\r\n  A ||--o{ B : has');
});

test('strips plain ``` fence and preserves unfenced text', () => {
  assert.equal(mmdStripFence('```\nsequenceDiagram\n  A->>B: Hi\n```'), 'sequenceDiagram\n  A->>B: Hi');
  assert.equal(mmdStripFence('```mermaid\n```'), '');
  assert.equal(mmdStripFence('  flowchart TD\n  A --> B'), '  flowchart TD\n  A --> B');
});

// --- All 6 supported diagram types ---
test('detects flowchart (flowchart, graph + dir, graph multi-line, flowchart-elk)', () => {
  assert.equal(mmdDetectType('flowchart TD\n  A --> B').kind, 'flowchart');
  assert.equal(mmdDetectType('flowchart-elk LR\n  A --> B').kind, 'flowchart');
  assert.equal(mmdDetectType('graph LR\n  A --> B').kind, 'flowchart');
  assert.equal(mmdDetectType('graph\n  A --> B').kind, 'flowchart');
});

test('detects usecase via %% @type usecase', () => {
  const uc = 'flowchart LR\n  %% @type usecase\n  a[User] --- u([Login])';
  assert.equal(mmdDetectType(uc).kind, 'usecase');
  assert.equal(mmdDetectType('```mermaid\n' + uc + '\n```').kind, 'usecase');
});

test('detects sequence, erd, c4, and gantt', () => {
  assert.equal(mmdDetectType('sequenceDiagram\n  A->>B: ping').kind, 'sequence');
  assert.equal(mmdDetectType('erDiagram\n  USER ||--o{ ORDER : places').kind, 'erd');
  assert.equal(mmdDetectType('C4Context\n  Person(u, "User")').kind, 'c4');
  assert.equal(mmdDetectType('C4Container\n  Container(a, "API", "Node")').kind, 'c4');
  assert.equal(mmdDetectType('C4Component\n  Component(c, "Auth", "TS")').kind, 'c4');
  assert.equal(mmdDetectType('gantt\n  title Roadmap\n  section Q1\n  Kickoff :2026-01-01, 5d').kind, 'gantt');
});

test('skips YAML front-matter and leading %% comments', () => {
  const txt = '---\ntitle: My ERD\n---\n%% comment\nerDiagram\n  A ||--|| B : rel';
  const res = mmdDetectType(txt);
  assert.equal(res.kind, 'erd');
  assert.equal(res.unsupported, '');
});

test('unwraps fenced block in result.text', () => {
  const res = mmdDetectType('```mermaid\ngantt\n  section S\n  Task :2026-01-01, 3d\n```');
  assert.equal(res.kind, 'gantt');
  assert.equal(res.text, 'gantt\n  section S\n  Task :2026-01-01, 3d');
});

// --- Unsupported Mermaid diagram types ---
test('flags strict unsupported Mermaid headers', () => {
  for (const [sample, expected] of [
    ['classDiagram\n  class Animal', 'classDiagram'],
    ['stateDiagram-v2\n  [*] --> Idle', 'stateDiagram-v2'],
    ['C4Dynamic\n  Rel(a, b, "calls")', 'C4Dynamic'],
    ['C4Deployment\n  Deployment_Node(n, "AWS")', 'C4Deployment'],
    ['gitGraph\n  commit', 'gitGraph'],
    ['quadrantChart\n  x-axis Low --> High', 'quadrantChart'],
    ['xychart-beta\n  x-axis [a, b]', 'xychart-beta'],
  ]) {
    const res = mmdDetectType(sample);
    assert.equal(res.kind, '', sample);
    assert.equal(res.unsupported, expected, sample);
  }
});

test('flags English-word unsupported Mermaid types only when multi-line or fenced', () => {
  assert.equal(mmdDetectType('pie title Pets\n  "Dogs" : 50\n  "Cats" : 50').unsupported, 'pie');
  assert.equal(mmdDetectType('mindmap\n  root((Idea))').unsupported, 'mindmap');
  assert.equal(mmdDetectType('timeline\n  title History\n  2020 : Start').unsupported, 'timeline');
  assert.equal(mmdDetectType('journey\n  title Day\n  section Morning').unsupported, 'journey');
  assert.equal(mmdDetectType('```mermaid\nkanban\n```').unsupported, 'kanban');
});

// --- Ordinary non-Mermaid text must be ignored ---
test('ignores ordinary prose, single English words, URLs, JSON, and empty input', () => {
  for (const plain of [
    '',
    '   \n  ',
    'Hello world',
    'Graph theory is fascinating',
    'Pie is my favorite dessert',
    'Timeline of Q4 milestones',
    'gantt',
    'timeline',
    'https://example.com/diagram',
    '{"diagramType":"flowchart","nodes":[]}',
  ]) {
    const res = mmdDetectType(plain);
    assert.equal(res.kind, '', `should ignore kind for: ${JSON.stringify(plain)}`);
    assert.equal(res.unsupported, '', `should ignore unsupported for: ${JSON.stringify(plain)}`);
  }
});

console.log(`[PASS] test_mermaid_detect (${passed} checks)`);
