#!/usr/bin/env node
// Parallel E2E test runner with lazy fixture building, sharding, and change-based selection.
// Zero dependencies: needs Node >= 22, Python 3, and Chrome/Chromium.
//
// Usage:
//   node dev/tests/run_e2e.mjs                         run the full E2E suite in parallel
//   node dev/tests/run_e2e.mjs --changed [ref]         run only tests affected by git changes (or vs <ref>)
//   node dev/tests/run_e2e.mjs --type c4,erd           run tests for specific diagram type(s) or shell/cross
//   node dev/tests/run_e2e.mjs --only e2e_c4,shell     filter by test id or filename substring
//   node dev/tests/run_e2e.mjs --jobs 4                override worker count (default: min(6, cpus))
//   node dev/tests/run_e2e.mjs --shards 0              override shard count for sharded tests (0 = no sharding)
//   node dev/tests/run_e2e.mjs --motion                keep animations enabled (default passes --noanim where safe)
//   node dev/tests/run_e2e.mjs --browser <chrome>      explicit Chrome/Chromium binary path
//   node dev/tests/run_e2e.mjs --list                  print selected tests/shards without running
//   node dev/tests/run_e2e.mjs -v                      show full output for passing tests too
//
// Exit codes: 0 all passed, 1 setup error, 2 one or more tests failed.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME_FLAGS, findBrowser } from './e2e/cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const e2eDir = join(here, 'e2e');
const layoutScript = join(root, 'scripts', 'layout_engine.py');

// --- CLI args ------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const valueOf = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('-') ? argv[i + 1] : undefined;
};
const listOnly = hasFlag('--list');
const verbose = hasFlag('-v') || hasFlag('--verbose');
const keepMotion = hasFlag('--motion');
const changedFlag = argv.includes('--changed');
const changedRef = changedFlag ? valueOf('changed') : undefined;
const typeFilter = valueOf('type')?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) || null;
const onlyFilter = valueOf('only')?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) || null;
const shardOverride = valueOf('shards') !== undefined ? Number(valueOf('shards')) : null;
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
  for (const cmd of process.platform === 'win32' ? ['python3', 'python'] : ['python3', 'python']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return cmd;
  }
  return null;
}

// --- Fixture definitions (built lazily and in parallel only for selected tests) ------------------
const FIXTURES = {
  fc_loan:          { src: 'dev/tests/fixtures/flowchart/loan-application.json' },
  fc_loan_art:      { src: 'dev/tests/fixtures/flowchart/loan-application.json', target: 'artifact' },
  fc_loan_scrambled:{ derivedFrom: 'fc_loan', build: scrambleFlowchart },
  fc_nolanes:       { src: 'dev/tests/fixtures/flowchart/no-swimlanes.json' },
  fc_default:       { src: 'assets/types/flowchart/default.json' },
  fc_default_tb:    { src: 'assets/types/flowchart/default.json', patchJson: (d) => ({ ...d, direction: 'TB' }) },
  fc_shapes:        { src: 'dev/tests/fixtures/flowchart/classic-shapes.json' },
  fc_zigzag:        { src: 'dev/tests/fixtures/flowchart/cross-lane-zigzag.json' },
  fc_conn_split:    { src: 'dev/tests/fixtures/flowchart/connector-forward.json' },
  fc_conn_forward:  { src: 'dev/tests/fixtures/flowchart/unsplit/connector-forward.json' },
  fc_conn_loop:     { src: 'dev/tests/fixtures/flowchart/unsplit/connector-loop.json' },
  fc_conn_merge:    { src: 'dev/tests/fixtures/flowchart/unsplit/connector-merge.json' },
  fc_example:       { src: 'dev/examples/example-flowchart.json' },
  fc_example_art:   { src: 'dev/examples/example-flowchart.json', target: 'artifact' },
  fc_sub:           { src: 'dev/tests/fixtures/subprocess/laptop-purchase.mmd' },
  fc_themed:        { src: 'dev/tests/fixtures/flowchart/loan-application.json', theme: 'dev/tests/fixtures/themes/test-brand.json' },
  fc_themed_art:    { src: 'dev/tests/fixtures/flowchart/loan-application.json', theme: 'dev/tests/fixtures/themes/test-brand.json', target: 'artifact' },
  seq_checkout:     { src: 'dev/tests/fixtures/sequence/checkout-with-fragments.json' },
  seq_checkout_art: { src: 'dev/tests/fixtures/sequence/checkout-with-fragments.json', target: 'artifact' },
  seq_example_art:  { src: 'dev/examples/example-sequence.json', target: 'artifact' },
  seq_payment:      { src: 'dev/tests/fixtures/sequence/payment-phases.json' },
  seq_activations:  { src: 'dev/tests/fixtures/sequence/activations.json' },
  erd_example:      { src: 'dev/examples/example-erd.json' },
  erd_example_art:  { src: 'dev/examples/example-erd.json', target: 'artifact' },
  erd_large:        { src: 'dev/tests/fixtures/erd/saas-billing.json' },
  erd_blank:        { src: 'assets/types/erd/default.json' },
  uc_example:       { src: 'dev/examples/example-usecase.json' },
  uc_example_art:   { src: 'dev/examples/example-usecase.json', target: 'artifact' },
  c4_example_art:   { src: 'dev/examples/example-c4.json', target: 'artifact' },
};

function scrambleFlowchart(srcHtmlPath, outPath) {
  const html = readFileSync(srcHtmlPath, 'utf8');
  const m = html.match(/(<script id="diagram-data" type="application\/json">)([\s\S]*?)(<\/script>)/);
  if (!m) throw new Error(`diagram-data block not found in ${srcHtmlPath}`);
  const data = JSON.parse(m[2]);
  if (data.layout && typeof data.layout === 'object') {
    let i = 0;
    for (const k of Object.keys(data.layout)) {
      if (typeof data.layout[k]?.x === 'number') {
        data.layout[k].x += 45 + (i % 3) * 25;
        data.layout[k].y += 20 + (i % 2) * 15;
        i++;
      }
    }
  }
  for (const n of data.nodes || []) {
    if (typeof n.x === 'number') n.x += 50;
    if (typeof n.y === 'number') n.y += 25;
  }
  writeFileSync(outPath, html.replace(m[0], () => `${m[1]}\n${JSON.stringify(data, null, 2)}\n  ${m[3]}`));
}

// --- Test suite catalog (ordered heaviest-first for optimal parallel packing) --------------------
const TESTS = [
  { id: 'erd',             file: 'e2e_erd.mjs',             types: ['erd'],                     weight: 100, shards: 4, fixtures: ['erd_example', 'erd_large', 'erd_blank'],
    args: (f) => ['--page', f.erd_example, '--large', f.erd_large, '--blank', f.erd_blank] },
  { id: 'c4',              file: 'e2e_c4.mjs',              types: ['c4'],                      weight: 95,  shards: 3, fixtures: [], args: () => [] },
  { id: 'gantt',           file: 'e2e_gantt.mjs',           types: ['gantt'],                   weight: 30,  fixtures: [], args: () => [] },
  { id: 'a11y',            file: 'e2e_a11y.mjs',            types: ['cross', 'shell'],          weight: 40,  fixtures: [], args: () => [] },
  { id: 'sequence',        file: 'e2e_sequence.mjs',        types: ['sequence'],                weight: 90,  shards: 3, fixtures: ['seq_checkout', 'seq_payment', 'seq_checkout_art'],
    args: (f) => ['--page', f.seq_checkout, '--long', f.seq_payment, '--artifact', f.seq_checkout_art] },
  { id: 'motion',          file: 'e2e_motion.mjs',          types: ['cross', 'shell'],          weight: 90,  shards: 4, motion: true, fixtures: ['fc_loan', 'seq_checkout', 'erd_example', 'uc_example', 'fc_sub'],
    args: (f) => ['--flowchart', f.fc_loan, '--sequence', f.seq_checkout, '--erd', f.erd_example, '--usecase', f.uc_example, '--tabs', f.fc_sub] },
  { id: 'usecase',         file: 'e2e_usecase.mjs',         types: ['usecase'],                 weight: 85,  shards: 2, fixtures: [], args: () => [] },
  { id: 'c4_drag',         file: 'e2e_c4_drag.mjs',         types: ['c4'],                      weight: 80,  shards: 2, serialSections: ['scale'], fixtures: [], args: () => [] },
  { id: 'shell',           file: 'e2e_shell.mjs',           types: ['shell', 'flowchart'],      weight: 70,  shards: 2, fixtures: ['fc_loan', 'fc_loan_scrambled', 'fc_loan_art', 'fc_nolanes'],
    args: (f) => ['--laid', f.fc_loan, '--scrambled', f.fc_loan_scrambled, '--artifact', f.fc_loan_art, '--nolanes', f.fc_nolanes] },
  { id: 'subprocess',      file: 'e2e_subprocess.mjs',      types: ['flowchart'],               weight: 60,  fixtures: ['fc_sub', 'fc_loan'],
    args: (f) => ['--page', f.fc_sub, '--plain', f.fc_loan] },
  { id: 'multiselect',     file: 'e2e_multiselect.mjs',     types: ['flowchart'],               weight: 45,  fixtures: ['fc_loan', 'fc_zigzag', 'fc_conn_split'],
    args: (f) => ['--loan', f.fc_loan, '--zigzag', f.fc_zigzag, '--connector', f.fc_conn_split] },
  { id: 'connectors',      file: 'e2e_connectors.mjs',      types: ['flowchart'],               weight: 40,  fixtures: ['fc_conn_forward', 'fc_conn_loop', 'fc_conn_merge', 'fc_conn_split'],
    args: (f) => ['--forward', f.fc_conn_forward, '--loop', f.fc_conn_loop, '--merge', f.fc_conn_merge, '--split', f.fc_conn_split] },
  { id: 'mermaid',         file: 'e2e_mermaid.mjs',         types: ['cross', 'flowchart', 'sequence', 'erd', 'usecase', 'c4'], weight: 40,
    fixtures: ['fc_example_art', 'uc_example_art', 'seq_example_art', 'erd_example_art', 'c4_example_art'],
    args: (f) => ['--flowchart', f.fc_example_art, '--usecase', f.uc_example_art, '--sequence', f.seq_example_art, '--erd', f.erd_example_art, '--c4', f.c4_example_art] },
  { id: 'notes',           file: 'e2e_notes.mjs',           types: ['flowchart'],               weight: 35,  fixtures: ['fc_example'], args: (f) => ['--page', f.fc_example] },
  { id: 'touch',           file: 'e2e_touch.mjs',           types: ['cross', 'shell'],          weight: 35,  fixtures: ['seq_payment', 'fc_loan', 'erd_example'],
    args: (f) => ['--sequence', f.seq_payment, '--flowchart', f.fc_loan, '--erd', f.erd_example] },
  { id: 'arrows',          file: 'e2e_arrows.mjs',          types: ['flowchart'],               weight: 30,  fixtures: ['fc_loan', 'fc_conn_split'],
    args: (f) => ['--page', f.fc_loan, '--split', f.fc_conn_split] },
  { id: 'activations',     file: 'e2e_activations.mjs',     types: ['sequence'],                weight: 25,  fixtures: ['seq_activations'], args: (f) => ['--page', f.seq_activations] },
  { id: 'lanes',           file: 'e2e_lanes.mjs',           types: ['flowchart'],               weight: 25,  fixtures: ['fc_default', 'fc_default_tb'],
    args: (f) => ['--page', f.fc_default, '--tb', f.fc_default_tb] },
  { id: 'erd_copy',        file: 'e2e_erd_copy.mjs',        types: ['erd'],                     weight: 20,  fixtures: ['erd_example', 'erd_large', 'erd_example_art'],
    args: (f) => ['--page', f.erd_example, '--large', f.erd_large, '--artifact', f.erd_example_art] },
  { id: 'shapes',          file: 'e2e_shapes.mjs',          types: ['flowchart'],               weight: 20,  fixtures: ['fc_shapes'], args: (f) => ['--page', f.fc_shapes] },
  { id: 'c4_export',       file: 'e2e_c4_export.mjs',       types: ['c4'],                      weight: 20,  fixtures: [], args: () => [] },
  { id: 'c4_packs',        file: 'e2e_c4_packs.mjs',        types: ['c4'],                      weight: 20,  fixtures: [], args: () => [] },
  { id: 'c4_picker_packs', file: 'e2e_c4_picker_packs.mjs', types: ['c4'],                      weight: 20,  fixtures: [], args: () => [] },
  { id: 'c4_fit',          file: 'e2e_c4_fit.mjs',          types: ['c4'],                      weight: 20,  fixtures: [], args: () => [] },
  { id: 'theme',           file: 'e2e_theme.mjs',           types: ['cross', 'shell'],          weight: 20,  fixtures: ['fc_themed', 'fc_themed_art'],
    args: (f) => ['--page', f.fc_themed, '--artifact', f.fc_themed_art] },
  { id: 'search:flowchart',file: 'e2e_search.mjs',          types: ['flowchart', 'shell'],      weight: 15,  fixtures: ['fc_loan'], args: (f) => ['--page', f.fc_loan, '--type', 'flowchart'] },
  { id: 'search:sequence', file: 'e2e_search.mjs',          types: ['sequence', 'shell'],       weight: 15,  fixtures: ['seq_checkout'], args: (f) => ['--page', f.seq_checkout, '--type', 'sequence'] },
  { id: 'search:erd',      file: 'e2e_search.mjs',          types: ['erd', 'shell'],            weight: 15,  fixtures: ['erd_example'], args: (f) => ['--page', f.erd_example, '--type', 'erd'] },
  { id: 'search:usecase',  file: 'e2e_search.mjs',          types: ['usecase', 'shell'],        weight: 15,  fixtures: ['uc_example'], args: (f) => ['--page', f.uc_example, '--type', 'usecase'] },
  { id: 'playground',      file: 'e2e_playground.mjs',      types: ['cross', 'shell'],          weight: 30,  fixtures: [], args: () => [] },
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
  let runAll = false;
  for (const p of paths) {
    // Non-E2E paths: docs, plans, unit tests, metadata
    if (/^(docs\/|dev\/plans\/|dev\/docs\/|dev\/tests\/unit\/|dev\/bench\/|references\/|bin\/|README\.md$|SKILL\.md$|LICENSE$|\.gitignore$)/.test(p)) continue;
    // Direct edit to a specific E2E test file
    const direct = /^dev\/tests\/e2e\/(e2e_.+\.mjs)$/.exec(p);
    if (direct) {
      for (const t of TESTS) if (t.file === direct[1]) wantedIds.add(t.id);
      continue;
    }
    // Shared core files affect all E2E tests
    if (/^(assets\/shell\/|assets\/components\/|assets\/tokens\/|scripts\/(layout_engine|disk_format|tokens|engine_runner)\.py$|dev\/tests\/e2e\/cdp\.mjs$|dev\/tests\/run_e2e\.mjs$)/.test(p)) {
      runAll = true;
      break;
    }
    // Diagram type slices
    const typeMatch = /^assets\/types\/(flowchart|sequence|erd|usecase|c4)\//.exec(p)
      || /^scripts\/audit_(flowchart|sequence|erd|usecase|c4)\.py$/.exec(p)
      || /^dev\/tests\/fixtures\/(flowchart|sequence|erd|usecase|c4)\//.exec(p)
      || /^dev\/examples\/example-(flowchart|sequence|erd|usecase|c4)/.exec(p);
    if (typeMatch) { wantedTypes.add(typeMatch[1]); continue; }
    // Feature-specific files
    if (/^scripts\/subprocess_flow\.py$|^dev\/tests\/fixtures\/subprocess\//.test(p)) { wantedIds.add('subprocess'); wantedIds.add('motion'); continue; }
    if (/^scripts\/build_icon_pack\.py$|^assets\/icons\//.test(p)) { wantedTypes.add('c4'); continue; }
    if (/^scripts\/mermaid_io\.mjs$|^dev\/tests\/fixtures\/mermaid\//.test(p)) { wantedIds.add('mermaid'); wantedIds.add('erd_copy'); continue; }
    if (/^dev\/tests\/fixtures\/themes\/|^scripts\/(extract_tokens|contrast)\.py$/.test(p)) { wantedIds.add('theme'); continue; }
    if (/^dev\/playground\/|^dev\/tools\/build_playground\.py$/.test(p)) { wantedIds.add('playground'); continue; }
    // Unknown code change: stay safe and run everything
    if (/^(assets\/|scripts\/)/.test(p)) { runAll = true; break; }
  }
  if (runAll) return TESTS;
  return TESTS.filter((t) => wantedIds.has(t.id) || t.types.some((tp) => wantedTypes.has(tp)));
}

// --- Filter tests --------------------------------------------------------------------------------
let selected = TESTS;
if (changedFlag) {
  const changed = getChangedFiles(changedRef);
  selected = selectByChangedFiles(changed);
  console.log(`Changed files (${changed.length}): ${changed.slice(0, 6).join(', ')}${changed.length > 6 ? `, +${changed.length - 6} more` : ''}`);
}
if (typeFilter) {
  selected = selected.filter((t) => t.types.some((tp) => typeFilter.includes(tp)));
}
if (onlyFilter) {
  selected = selected.filter((t) => onlyFilter.some((q) => t.id.toLowerCase().includes(q) || t.file.toLowerCase().includes(q)));
}

// Expand sharded tests into concrete runnable tasks (plus quiet serial tasks for timing-sensitive sections)
function expandTasks(tests) {
  const parallel = [];
  const serial = [];
  for (const t of tests) {
    // Only shard tests whose file actually calls t.section(...)
    const srcText = readFileSync(join(e2eDir, t.file), 'utf8');
    const supportsShards = /\bt\.section\s*\(/.test(srcText);
    const serialSecs = supportsShards && t.serialSections?.length && jobs > 1 ? t.serialSections : [];
    const excludeArgs = serialSecs.length ? ['--exclude-section', serialSecs.join(',')] : [];
    const n = supportsShards
      ? (shardOverride !== null ? shardOverride : (t.shards || 1))
      : 1;
    if (n > 1 && jobs > 1) {
      for (let k = 1; k <= n; k++) {
        parallel.push({ ...t, label: `${t.id} [${k}/${n}]`, shard: `${k}/${n}`, extraArgs: excludeArgs, weight: t.weight / n + 10 });
      }
    } else {
      parallel.push({ ...t, label: t.id, shard: null, extraArgs: excludeArgs });
    }
    if (serialSecs.length) {
      serial.push({ ...t, label: `${t.id} [${serialSecs.join(',')}]`, shard: null, extraArgs: ['--section', serialSecs.join(',')], serial: true });
    }
  }
  parallel.sort((a, b) => b.weight - a.weight);
  return { parallel, serial, all: [...parallel, ...serial] };
}

const { parallel: parallelTasks, serial: serialTasks, all: tasks } = expandTasks(selected);
if (listOnly) {
  console.log(`Selected ${tasks.length} task(s) across ${selected.length} test(s):`);
  for (const t of tasks) {
    const flags = [t.shard ? `--shard ${t.shard}` : '', ...(t.extraArgs || []), t.serial ? '(serial)' : ''].filter(Boolean).join(' ');
    console.log(`  - ${t.label.padEnd(22)} (${t.file}${flags ? ' ' + flags : ''})`);
  }
  process.exit(0);
}
if (!tasks.length) {
  console.log('No E2E tests selected.');
  process.exit(0);
}

const python = findPython();
if (!python) { console.error('[ERROR] Python 3 not found on PATH.'); process.exit(1); }
const browser = findBrowser(valueOf('browser'));
if (!browser) { console.error('[ERROR] Chrome/Chromium not found. Pass --browser <path>.'); process.exit(1); }

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

async function startSharedChrome(browserPath, workDir) {
  const profile = join(workDir, 'chrome-shared');
  const chrome = spawn(browserPath, [
    ...CHROME_FLAGS, '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    ...(process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : []),
    'about:blank',
  ], { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      try {
        const lines = readFileSync(portFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (lines.length >= 2 && /^\d+$/.test(lines[0])) {
          return { chrome, wsUrl: `ws://127.0.0.1:${lines[0]}${lines[1]}` };
        }
      } catch { /* still writing */ }
    }
    await new Promise((r) => setTimeout(r, 30));
  }
  chrome.kill();
  throw new Error('Shared Chrome DevTools endpoint did not come up');
}

// Batch-build fixtures inside a single Python process using engine_runner.layout_session()
// (one Python startup + one persistent Node engine worker instead of N separate startups).
async function buildFixturesBatch(pyCmd, jobsList, workDir) {
  mkdirSync(workDir, { recursive: true });
  const manifestPath = join(workDir, 'fixtures-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(jobsList));
  const pyCode = `
import contextlib, io, json, sys
sys.path.insert(0, ${JSON.stringify(join(root, 'scripts'))})
import engine_runner, layout_engine
jobs = json.loads(open(${JSON.stringify(manifestPath)}, encoding="utf-8").read())
with engine_runner.layout_session():
    for job in jobs:
        sys.argv = ["layout_engine.py", "--layout", job["input"], "-o", job["output"]]
        if job.get("target"):
            sys.argv += ["--target", job["target"]]
        if job.get("theme"):
            sys.argv += ["--theme", job["theme"]]
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                layout_engine.main()
        except SystemExit as exc:
            if exc.code not in (None, 0):
                sys.stderr.write(f"Fixture {job['key']} failed (exit {exc.code}):\\n{buf.getvalue()}\\n")
                sys.exit(1)
`;
  const r = await execAsync(pyCmd, ['-c', pyCode]);
  if (r.status !== 0) throw new Error(`Batch fixture build failed:\n${r.stdout}\n${r.stderr}`);
}

// --- Build only the fixtures required by selected tests (batched in one layout_session) ----------
const work = mkdtempSync(join(tmpdir(), 'e2e_run_'));
const tSuite0 = Date.now();
let sharedChrome = null;
try {
  const chromePromise = startSharedChrome(browser, work);

  const needed = new Set();
  for (const t of selected) {
    for (const k of t.fixtures) {
      needed.add(k);
      if (FIXTURES[k]?.derivedFrom) needed.add(FIXTURES[k].derivedFrom);
    }
  }
  const baseKeys = [...needed].filter((k) => !FIXTURES[k].derivedFrom);
  const derivedKeys = [...needed].filter((k) => FIXTURES[k].derivedFrom);
  const built = {};

  if (baseKeys.length) {
    const tFx0 = Date.now();
    const batch = baseKeys.map((key) => {
      const spec = FIXTURES[key];
      let inputPath = join(root, spec.src);
      if (spec.patchJson) {
        const patched = spec.patchJson(JSON.parse(readFileSync(inputPath, 'utf8')));
        inputPath = join(work, `${key}.input.json`);
        writeFileSync(inputPath, JSON.stringify(patched));
      }
      const isArt = spec.target === 'artifact';
      const outTarget = isArt ? join(work, key) : join(work, `${key}.html`);
      built[key] = isArt ? join(outTarget, 'index.html') : outTarget;
      return { key, input: inputPath, output: outTarget, target: spec.target || null, theme: spec.theme ? join(root, spec.theme) : null };
    });
    // Split batch across at most 2 persistent layout_session workers for large fixture sets
    const workerCount = batch.length >= 10 && jobs >= 2 ? 2 : 1;
    const chunks = Array.from({ length: workerCount }, () => []);
    batch.forEach((j, i) => chunks[i % workerCount].push(j));
    await Promise.all(chunks.map((chunk, i) => buildFixturesBatch(python, chunk, join(work, `batch_${i}`))));
    for (const key of derivedKeys) {
      const spec = FIXTURES[key];
      const outPath = join(work, `${key}.html`);
      spec.build(built[spec.derivedFrom], outPath);
      built[key] = outPath;
    }
    console.log(`Built ${needed.size} fixture(s) in ${((Date.now() - tFx0) / 1000).toFixed(1)}s`);
  }

  sharedChrome = await chromePromise;
  const workerEnv = { ...process.env, E2E_BROWSER_WS: sharedChrome.wsUrl };

  const runTask = async (task) => {
    const t0 = Date.now();
    const args = [join(e2eDir, task.file), '--browser', browser, ...task.args(built)];
    if (task.shard) args.push('--shard', task.shard);
    if (task.extraArgs?.length) args.push(...task.extraArgs);
    if (!keepMotion && !task.motion) args.push('--noanim');
    if (verbose) args.push('-v');
    const r = await execAsync(process.execPath, args, { env: workerEnv });
    const ms = Date.now() - t0;
    const summaryLine = (r.stdout + '\n' + r.stderr).trim().split(/\r?\n/).filter((l) => /\d+\/\d+ checks passed|\[FAIL\]|\[ERROR\]/.test(l)).at(-1) || '';
    const ok = r.status === 0;
    const tag = ok ? '[PASS]' : '[FAIL]';
    console.log(`${tag} ${task.label.padEnd(22)} ${(ms / 1000).toFixed(1).padStart(5)}s  ${summaryLine}`);
    if (!ok || verbose) {
      const detail = (r.stdout + '\n' + r.stderr).trim();
      if (detail) console.log(detail.split(/\r?\n/).map((l) => '       ' + l).join('\n'));
    }
    return { task, ok, status: r.status, ms };
  };

  console.log(`Running ${tasks.length} task(s) with ${Math.min(jobs, Math.max(1, parallelTasks.length))} worker(s)${keepMotion ? ' (motion on)' : ' (--noanim)'}...`);
  const results = await runPool(parallelTasks, jobs, runTask);
  for (const task of serialTasks) results.push(await runTask(task));

  const wallSec = (Date.now() - tSuite0) / 1000;
  const cpuSec = results.reduce((s, r) => s + r.ms, 0) / 1000;
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log('');
  console.log(`Done: ${passed}/${results.length} passed in ${wallSec.toFixed(1)}s wall (${cpuSec.toFixed(1)}s total worker time, ${(cpuSec / Math.max(wallSec, 0.1)).toFixed(1)}x parallelism)`);
  const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 5);
  console.log(`Slowest: ${slowest.map((r) => `${r.task.label} ${(r.ms / 1000).toFixed(1)}s`).join(' | ')}`);
  process.exit(failed ? 2 : 0);
} catch (err) {
  console.error('[ERROR]', err.stack || err.message);
  process.exit(1);
} finally {
  if (sharedChrome?.chrome) {
    const c = sharedChrome.chrome;
    const exited = c.exitCode !== null ? Promise.resolve() : new Promise((r) => { c.once('exit', r); setTimeout(r, 400); });
    c.kill();
    await exited;
  }
  try { rmSync(work, { recursive: true, force: true }); } catch { /* temp dir */ }
}
