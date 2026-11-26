#!/usr/bin/env node
// Fast parallel unit/checker test runner with change-based selection (no browser required).
// Zero dependencies: needs Node >= 22 and Python 3.
//
// Usage:
//   node dev/tests/run_unit.mjs                        run all fast unit/checker tests in parallel
//   node dev/tests/run_unit.mjs --changed [ref]        run only fast tests affected by git changes (or vs <ref>)
//   node dev/tests/run_unit.mjs --type c4,erd          run tests for specific diagram type(s) or tokens/shell/cli
//   node dev/tests/run_unit.mjs --only audit_c4,tokens filter by test id or filename substring (includes slow checks)
//   node dev/tests/run_unit.mjs --all                  also include heavier non-browser checks (golden, artifact_shape, etc.)
//   node dev/tests/run_unit.mjs --jobs 4               override worker count (default: min(6, cpus))
//   node dev/tests/run_unit.mjs --list                 print selected tests without running
//   node dev/tests/run_unit.mjs -v                     show full output for passing tests too
//
// Exit codes: 0 all passed, 1 setup error, 2 one or more tests failed.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { availableParallelism, cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const unitDir = join(here, 'unit');

// --- CLI args ------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const valueOf = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('-') ? argv[i + 1] : undefined;
};
const listOnly = hasFlag('--list');
const verbose = hasFlag('-v') || hasFlag('--verbose');
const includeSlow = hasFlag('--all');
const changedFlag = argv.includes('--changed');
const changedRef = changedFlag ? valueOf('changed') : undefined;
const typeFilter = valueOf('type')?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) || null;
const onlyFilter = valueOf('only')?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) || null;
const cpuCount = typeof availableParallelism === 'function' ? availableParallelism() : cpus().length;
const jobs = Math.max(1, Number(valueOf('jobs')) || Math.min(6, cpuCount));

if (hasFlag('-h') || hasFlag('--help')) {
  const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split(/\r?\n/).slice(1);
  const end = lines.findIndex((l) => !l.startsWith('//'));
  console.log((end < 0 ? lines : lines.slice(0, end)).map((l) => l.slice(3)).join('\n'));
  process.exit(0);
}

// --- Environment detection -----------------------------------------------------------------------
function findPython() {
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return cmd;
  }
  return null;
}

// --- Unit/checker catalog (no browser required) --------------------------------------------------
// Fast tests run by default (~0.1-2s each). Tests marked `slow: true` spawn many subprocesses or
// enforce strict perf timings; run them with `--all` or explicitly via `--only <id>`.
const TESTS = [
  // Fast checks (< 2s each except subprocess ~6s)
  { id: 'tokens',          file: 'check_tokens.py',          types: ['tokens', 'shell', 'cross'] },
  { id: 'components',      file: 'check_components.py',      types: ['tokens', 'shell', 'cross', 'sequence', 'erd', 'usecase', 'c4', 'gantt'] },
  { id: 'contrast',        file: 'check_contrast.py',        types: ['tokens', 'theme', 'shell', 'cross'] },
  { id: 'audit_flowchart', file: 'test_audit_flowchart.py',  types: ['flowchart'] },
  { id: 'audit_sequence',  file: 'test_audit_sequence.py',   types: ['sequence'] },
  { id: 'audit_erd',       file: 'test_audit_erd.py',        types: ['erd'] },
  { id: 'audit_usecase',   file: 'test_audit_usecase.py',    types: ['usecase'] },
  { id: 'audit_c4',        file: 'test_audit_c4.py',         types: ['c4'] },
  { id: 'audit_gantt',     file: 'test_audit_gantt.py',      types: ['gantt'] },
  { id: 'gantt_engine',    file: 'test_gantt_engine.mjs',    types: ['gantt'] },
  { id: 'gantt_mermaid',   file: 'test_gantt_mermaid.mjs',   types: ['gantt'] },
  { id: 'c4_codec',        file: 'test_c4_codec.py',         types: ['c4'] },
  { id: 'usecase_engine',  file: 'check_usecase_engine.mjs', types: ['usecase'] },
  { id: 'icon_pack',       file: 'test_icon_pack.py',        types: ['c4', 'tokens'] },
  { id: 'subprocess',      file: 'test_subprocess.py',       types: ['flowchart', 'mermaid'] },
  { id: 'install',         file: 'test_install.py',          types: ['cli'] },
  { id: 'save_helper',     file: 'test_save_helper.py',      types: ['cli'] },
  { id: 'version_check',   file: 'test_version_check.py',    types: ['cli'] },
  { id: 'release',         file: 'test_release.py',          types: ['cli'] },
  { id: 'strip_bundle',    file: 'test_strip_bundle.py',     types: ['cross', 'shell'] },

  // Heavier / perf-sensitive non-browser checks (included with --all or explicit --only / direct edit)
  { id: 'golden',          file: 'check_golden.py',          types: ['cross', 'flowchart', 'sequence', 'erd', 'usecase', 'c4', 'gantt'], slow: true },
  { id: 'artifact_shape',  file: 'check_artifact_shape.py',  types: ['shell', 'cross'], slow: true },
  { id: 'router_equiv',    file: 'check_router_equiv.mjs',   types: ['shell', 'flowchart'], slow: true },
  { id: 'router_perf',     file: 'check_router_perf.mjs',    types: ['shell', 'flowchart'], slow: true, serial: true },
  { id: 'direction',       file: 'check_direction.py',       types: ['flowchart'], slow: true },
  { id: 'extract',         file: 'check_extract.py',         types: ['tokens', 'theme'], slow: true },
  { id: 'cli_mermaid',     file: 'test_cli_mermaid.py',      types: ['mermaid', 'cross'], slow: true },
  { id: 'c4_engine',       file: 'check_c4_engine.mjs',      types: ['c4'], slow: true, serial: true },
  { id: 'c4_route',        file: 'check_c4_route.mjs',       types: ['c4'], slow: true, serial: true },
];

// --- Change-based test selection (--changed [ref]) -----------------------------------------------
function getChangedFiles(ref) {
  const files = new Set();
  const status = spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
  if (status.status === 0) {
    for (const line of status.stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const p = line.slice(3).trim().replace(/^"|"$/g, '').split(' -> ').at(-1);
      if (p) files.add(p.replace(/\\/g, '/'));
    }
  }
  const base = ref || (files.size === 0 ? 'main' : null);
  if (base) {
    const diff = spawnSync('git', ['-C', root, 'diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' });
    if (diff.status === 0) {
      for (const line of diff.stdout.split(/\r?\n/)) {
        if (line.trim()) files.add(line.trim().replace(/\\/g, '/'));
      }
    }
  }
  return [...files];
}

function selectByChangedFiles(paths) {
  const wantedTypes = new Set();
  const wantedIds = new Set();
  const directIds = new Set();
  let runAll = false;

  for (const p of paths) {
    if (/^(docs\/|dev\/plans\/|dev\/docs\/|dev\/bench\/|dev\/tests\/e2e\/|references\/|README\.md$|SKILL\.md$|LICENSE$|CONTRIBUTING\.md$|CODE_OF_CONDUCT\.md$|ACCESSIBILITY\.md$|\.gitignore$)/.test(p)) {
      continue;
    }
    if (p === 'dev/tests/run_unit.mjs') {
      runAll = true;
      break;
    }
    const direct = /^dev\/tests\/unit\/(.+\.(?:py|mjs))$/.exec(p);
    if (direct) {
      for (const t of TESTS) {
        if (t.file === direct[1]) {
          wantedIds.add(t.id);
          directIds.add(t.id);
        }
      }
      continue;
    }
    if (/^scripts\/(layout_engine|disk_format|engine_runner)\.py$/.test(p)) {
      runAll = true;
      break;
    }
    if (/^(assets\/tokens\/|scripts\/(tokens|contrast|extract_tokens)\.py$|dev\/tests\/fixtures\/themes\/)/.test(p)) {
      wantedTypes.add('tokens');
      wantedTypes.add('theme');
      continue;
    }
    if (/^(assets\/shell\/|assets\/components\/)/.test(p)) {
      wantedTypes.add('shell');
      continue;
    }
    const typeMatch = /^assets\/types\/(flowchart|sequence|erd|usecase|c4)\//.exec(p)
      || /^scripts\/audit_(flowchart|sequence|erd|usecase|c4)\.py$/.exec(p)
      || /^dev\/tests\/fixtures\/(flowchart|sequence|erd|usecase|c4)\//.exec(p)
      || /^dev\/examples\/example-(flowchart|sequence|erd|usecase|c4)/.exec(p);
    if (typeMatch) {
      wantedTypes.add(typeMatch[1]);
      continue;
    }
    if (/^scripts\/subprocess_flow\.py$|^dev\/tests\/fixtures\/subprocess\//.test(p)) { wantedIds.add('subprocess'); continue; }
    if (/^scripts\/build_icon_pack\.py$|^assets\/icons\//.test(p)) { wantedIds.add('icon_pack'); wantedIds.add('tokens'); continue; }
    if (/^scripts\/mermaid_io\.mjs$|^dev\/tests\/fixtures\/mermaid\//.test(p)) { wantedTypes.add('mermaid'); continue; }
    if (/^scripts\/install\.py$|^bin\//.test(p)) { wantedIds.add('install'); continue; }
    if (/^scripts\/save_helper\.py$/.test(p)) { wantedIds.add('save_helper'); continue; }
    if (/^scripts\/version_check\.py$/.test(p)) { wantedIds.add('version_check'); continue; }
    if (/^dev\/tools\/release\.py$/.test(p)) { wantedIds.add('release'); continue; }
    if (/^(assets\/|scripts\/)/.test(p)) {
      runAll = true;
      break;
    }
  }

  const matched = runAll
    ? TESTS
    : TESTS.filter((t) => wantedIds.has(t.id) || t.types.some((tp) => wantedTypes.has(tp)));
  return matched.filter((t) => includeSlow || !t.slow || directIds.has(t.id));
}

// --- Filter tests --------------------------------------------------------------------------------
let selected = TESTS;
if (changedFlag) {
  const changed = getChangedFiles(changedRef);
  selected = selectByChangedFiles(changed);
  console.log(`Changed files (${changed.length}): ${changed.slice(0, 6).join(', ')}${changed.length > 6 ? `, +${changed.length - 6} more` : ''}`);
} else if (!includeSlow && !onlyFilter) {
  selected = selected.filter((t) => !t.slow);
}
if (typeFilter) {
  selected = selected.filter((t) => t.types.some((tp) => typeFilter.includes(tp)));
}
if (onlyFilter) {
  selected = selected.filter((t) => onlyFilter.some((q) => t.id.toLowerCase().includes(q) || t.file.toLowerCase().includes(q)));
}

if (listOnly) {
  console.log(`Selected ${selected.length} unit/checker test(s):`);
  for (const t of selected) {
    const tags = [t.slow ? 'slow' : '', t.serial ? 'serial' : ''].filter(Boolean).join(', ');
    console.log(`  - ${t.id.padEnd(18)} (${t.file}${tags ? ` [${tags}]` : ''})`);
  }
  process.exit(0);
}
if (!selected.length) {
  console.log('No unit/checker tests selected.');
  process.exit(0);
}

const needsPython = selected.some((t) => t.file.endsWith('.py'));
const python = needsPython ? findPython() : null;
if (needsPython && !python) {
  console.error('[ERROR] Python 3 not found on PATH.');
  process.exit(1);
}

// --- Parallel worker pool helper -----------------------------------------------------------------
async function runPool(items, concurrency, worker) {
  let next = 0;
  const results = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await worker(items[idx], idx);
    }
  }));
  return results;
}

function execAsync(cmd, args, opts = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => resolvePromise({ status: 1, stdout: out, stderr: err + String(e) }));
    child.on('close', (code) => resolvePromise({ status: code ?? 1, stdout: out, stderr: err }));
  });
}

const parallelTasks = selected.filter((t) => !t.serial);
const serialTasks = selected.filter((t) => t.serial);
const tSuite0 = Date.now();

const runTask = async (task) => {
  const t0 = Date.now();
  const isNode = task.file.endsWith('.mjs');
  const cmd = isNode ? process.execPath : python;
  const args = [join(unitDir, task.file)];
  const r = await execAsync(cmd, args, { cwd: root });
  const ms = Date.now() - t0;
  const lines = (r.stdout + '\n' + r.stderr).trim().split(/\r?\n/).filter(Boolean);
  const summaryLine = lines.at(-1) || '';
  const ok = r.status === 0;
  const tag = ok ? '[PASS]' : '[FAIL]';
  console.log(`${tag} ${task.id.padEnd(18)} ${(ms / 1000).toFixed(2).padStart(5)}s  ${summaryLine}`);
  if (!ok || verbose) {
    const detail = (r.stdout + '\n' + r.stderr).trim();
    if (detail) console.log(detail.split(/\r?\n/).map((l) => '       ' + l).join('\n'));
  }
  return { task, ok, status: r.status, ms };
};

console.log(`Running ${selected.length} unit/checker test(s) with ${Math.min(jobs, Math.max(1, parallelTasks.length))} worker(s)...`);
const results = await runPool(parallelTasks, jobs, runTask);
for (const task of serialTasks) results.push(await runTask(task));

const wallSec = (Date.now() - tSuite0) / 1000;
const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log('');
console.log(`Done: ${passed}/${results.length} passed in ${wallSec.toFixed(1)}s wall`);
process.exit(failed ? 2 : 0);
