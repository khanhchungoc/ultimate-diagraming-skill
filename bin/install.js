#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const USER_HOME = os.homedir();
const VERSION = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version;

// High-contrast ANSI colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[96m',
  green: '\x1b[92m',
  yellow: '\x1b[93m',
  red: '\x1b[91m',
  gray: '\x1b[90m',
  white: '\x1b[97m',
  border: '\x1b[38;5;39m'
};

const args = process.argv.slice(2);
let scope = 'user';
let runtime = 'all';
let mode = 'symlink';
let targetPath = process.cwd();
let claudeOutput = null;   // ask | artifact | file; null = not given (prompt when interactive)
let noHooks = false;
let saveHelper = null;
const SAVE_HELPER_FEATURE_ENABLED = ['1', 'true', 'yes'].includes(
  (process.env.ULTIMATE_DIAGRAM_ENABLE_SAVE_HELPER || '').trim().toLowerCase()
);
const CLAUDE_OUTPUTS = ['ask', 'artifact', 'file'];

// Detect if running from a temporary npx cache
const isNpxCache = REPO_ROOT.includes('_npx') || 
                   REPO_ROOT.includes('npm-cache') || 
                   REPO_ROOT.includes('.npm') || 
                   REPO_ROOT.toLowerCase().includes('temp') || 
                   REPO_ROOT.includes('/tmp/');

if (isNpxCache) {
  mode = 'copy';
}

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-g' || arg === '--global') {
    scope = 'user';
  } else if (arg === '-p' || arg === '--project') {
    scope = 'project';
  } else if (arg === '--scope' || arg === '-s') {
    const val = args[++i]?.toLowerCase();
    scope = val === 'project' ? 'project' : 'user';
  } else if (arg === '--runtime' || arg === '-r' || arg === '-a' || arg === '--agent') {
    runtime = args[++i]?.toLowerCase() || 'all';
  } else if (arg === '--mode' || arg === '-m') {
    mode = args[++i]?.toLowerCase() === 'copy' ? 'copy' : 'symlink';
  } else if (arg === '--copy') {
    mode = 'copy';
  } else if (arg === '--symlink') {
    mode = 'symlink';
  } else if (arg === '--target-path' || arg === '-t') {
    targetPath = path.resolve(args[++i] || process.cwd());
  } else if (arg === '--claude-output') {
    const val = (args[++i] || '').toLowerCase();
    if (!CLAUDE_OUTPUTS.includes(val)) {
      console.error(`\n${c.red}✖ Error: --claude-output must be one of: ${CLAUDE_OUTPUTS.join(', ')}${c.reset}\n`);
      process.exit(1);
    }
    claudeOutput = val;
  } else if (arg === '--no-hooks') {
    noHooks = true;
  } else if (arg === '--save-helper') {
    saveHelper = true;
  } else if (arg === '--no-save-helper') {
    saveHelper = false;
  } else if (arg === '--help' || arg === '-h') {
    printHelp();
    process.exit(0);
  }
}

function printHelp() {
  const saveHelperHelp = SAVE_HELPER_FEATURE_ENABLED
    ? `\n  --save-helper             Enable the local background direct-save helper (one-click Ctrl+S on file:// diagrams)\n  --no-save-helper          Disable the local background direct-save helper`
    : '';
  console.log(`
${c.cyan}${c.bold}Ultimate Diagram Installer${c.reset}
${c.dim}Interactive, standalone diagrams (flowcharts, sequence, ERD, use case, and C4) for AI assistants.${c.reset}

${c.bold}Usage:${c.reset}
  npx ultimate-diagram@latest [options]
  # or from GitHub:
  npx khanhchungoc/ultimate-diagraming-skill [options]
  # or when cloned locally:
  ultimate-diagram [options]

${c.bold}Options:${c.reset}
  -g, --global              Install globally in user home directory (default)
  -p, --project             Install in current project / workspace directory
  -a, -r, --runtime <name>  Target runtime: antigravity, claude, copilot, codex, gemini, kiro, or all (default: all)
  -m, --mode <symlink|copy> Installation method (auto-detected: copy for npx, symlink for local clones)
  --claude-output <ask|artifact|file>
                            Claude Code only: publish diagrams as claude.ai Artifacts, write HTML files, or ask each
                            time (default: artifact). Saved to .claude/ultimate-diagram.json (never in the skill folder);
                            prompted when run in a terminal without this flag.${saveHelperHelp}
  --no-hooks                Skip registering async SessionStart version-check hooks in runtime settings.json files
  -h, --help                Show this help message

${c.bold}Supported Runtimes:${c.reset}
  • ${c.cyan}antigravity${c.reset}  Antigravity IDE & Agents
  • ${c.cyan}claude${c.reset}       Claude Code CLI
  • ${c.cyan}copilot${c.reset}      GitHub Copilot / VS Code
  • ${c.cyan}codex${c.reset}        OpenAI Codex
  • ${c.cyan}gemini${c.reset}       Gemini CLI
  • ${c.cyan}kiro${c.reset}         Kiro CLI & IDE
`);
}

const destinations = {
  user: {
    antigravity: path.join(USER_HOME, '.gemini', 'config', 'skills', 'ultimate-diagram'),
    claude: path.join(USER_HOME, '.claude', 'skills', 'ultimate-diagram'),
    copilot: path.join(USER_HOME, '.copilot', 'skills', 'ultimate-diagram'),
    codex: path.join(USER_HOME, '.agents', 'skills', 'ultimate-diagram'),
    gemini: path.join(USER_HOME, '.gemini', 'skills', 'ultimate-diagram'),
    kiro: path.join(USER_HOME, '.kiro', 'skills', 'ultimate-diagram')
  },
  project: {
    antigravity: path.join(targetPath, '.agents', 'skills', 'ultimate-diagram'),
    claude: path.join(targetPath, '.claude', 'skills', 'ultimate-diagram'),
    copilot: path.join(targetPath, '.github', 'skills', 'ultimate-diagram'),
    codex: path.join(targetPath, '.agents', 'skills', 'ultimate-diagram'),
    gemini: path.join(targetPath, '.gemini', 'skills', 'ultimate-diagram'),
    kiro: path.join(targetPath, '.kiro', 'skills', 'ultimate-diagram')
  }
};

const runtimeLabels = {
  antigravity: 'Antigravity IDE',
  claude: 'Claude Code',
  copilot: 'GitHub Copilot',
  codex: 'OpenAI Codex',
  gemini: 'Gemini CLI',
  kiro: 'Kiro IDE'
};

let normalizedRuntime = runtime;
if (normalizedRuntime === 'github-copilot' || normalizedRuntime === 'vscode-copilot') {
  normalizedRuntime = 'copilot';
} else if (normalizedRuntime === 'claude-code') {
  normalizedRuntime = 'claude';
}

const allRuntimes = ['antigravity', 'claude', 'copilot', 'codex', 'gemini', 'kiro'];
const runtimesToInstall = normalizedRuntime === 'all' ? allRuntimes : [normalizedRuntime];

for (const rt of runtimesToInstall) {
  if (!allRuntimes.includes(rt)) {
    console.error(`\n${c.red}✖ Error: Unknown runtime "${rt}". Available: ${allRuntimes.join(', ')}${c.reset}\n`);
    process.exit(1);
  }
}

// Banner
console.log('');
console.log(`${c.cyan}${c.bold}  █░█ █░░ ▀█▀ █ █▀▄▀█ ▄▀█ ▀█▀ █▀▀   █▀▄ █ ▄▀█ █▀▀ █▀█ ▄▀█ █▀▄▀█${c.reset}`);
console.log(`${c.cyan}${c.bold}  █▄█ █▄▄ ░█░ █ █░▀░█ █▀█ ░█░ ██▄   █▄▀ █ █▀█ █░█ █▀▄ █▀█ █░▀░█${c.reset}`);
console.log(`${c.dim}     Interactive Diagram Skill for AI Coding Assistants • v${VERSION}${c.reset}\n`);

// Configuration Section
console.log(`${c.cyan} ⚙  CONFIGURATION${c.reset}`);
console.log(`    ${c.gray}•${c.reset} Scope:    ${c.white}${scope === 'user' ? 'Global' : 'Project'}${c.reset} ${c.dim}(${scope === 'user' ? 'User Home' : targetPath})${c.reset}`);
console.log(`    ${c.gray}•${c.reset} Mode:     ${c.white}${mode === 'symlink' ? 'Symlink' : 'Copy'}${c.reset} ${c.dim}(${mode === 'symlink' ? 'auto-updating junction' : 'standalone copy'})${c.reset}`);
console.log(`    ${c.gray}•${c.reset} Target:   ${c.white}${normalizedRuntime === 'all' ? 'All Runtimes' : (runtimeLabels[normalizedRuntime] || normalizedRuntime)}${c.reset} ${c.dim}(${runtimesToInstall.length} runtime${runtimesToInstall.length > 1 ? 's' : ''})${c.reset}\n`);

// Claude Code only: where a diagram goes. Stored beside Claude Code's own settings, never inside the skill folder
// (which may be a symlink to this repo). SKILL.md reads it.
const claudeSelected = runtimesToInstall.includes('claude');
const claudeConfigPath = scope === 'user'
  ? path.join(USER_HOME, '.claude', 'ultimate-diagram.json')
  : path.join(targetPath, '.claude', 'ultimate-diagram.json');

async function promptClaudeOutput() {
  console.log(`${c.cyan} ?  CLAUDE CODE OUTPUT${c.reset}`);
  console.log('    In Claude Code, publish diagrams as claude.ai Artifacts, write HTML files, or ask each time?');
  console.log(`      ${c.white}1${c.reset} claude.ai Artifact ${c.dim}(private page, Save updates it in place) (default)${c.reset}`);
  console.log(`      ${c.white}2${c.reset} ask each time`);
  console.log(`      ${c.white}3${c.reset} HTML file ${c.dim}(in the project folder, works offline)${c.reset}`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('    Choose [1-3]: ')).trim().toLowerCase();
    console.log('');
    return { '2': 'ask', ask: 'ask', '3': 'file', file: 'file' }[answer] || 'artifact';
  } finally {
    rl.close();
  }
}

let claudeOutputWritten = false;
// Ask only if Claude Code looks installed (~/.claude exists); otherwise the default ("artifact") applies.
const claudeInstalled = fs.existsSync(path.join(USER_HOME, '.claude'));
if (claudeSelected && claudeInstalled && claudeOutput === null && process.stdin.isTTY && process.stdout.isTTY) {
  claudeOutput = await promptClaudeOutput();
}
if (claudeSelected && claudeOutput !== null) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf8')) || {}; } catch { /* none yet */ }
  cfg.output = claudeOutput;
  fs.mkdirSync(path.dirname(claudeConfigPath), { recursive: true });
  fs.writeFileSync(claudeConfigPath, JSON.stringify(cfg, null, 2) + '\n');
  claudeOutputWritten = true;
}

function getCacheConfigPath() {
  const override = (process.env.ULTIMATE_DIAGRAM_CACHE_DIR || '').trim();
  if (override) return path.join(override, 'config.json');
  const base = process.platform === 'win32'
    ? (process.env.LOCALAPPDATA || path.join(USER_HOME, 'AppData', 'Local'))
    : (process.env.XDG_CACHE_HOME || path.join(USER_HOME, '.cache'));
  return path.join(base, 'ultimate-diagram', 'config.json');
}

async function promptSaveHelper() {
  console.log(`${c.cyan} ?  ONE-CLICK SAVING FOR DIAGRAMS${c.reset}`);
  console.log('    Normally, web browsers block HTML files from saving changes back to themselves.');
  console.log('    A tiny helper on your computer (stops automatically when idle) lets Save just work:');
  console.log(`      ${c.white}Yes (default)${c.reset}  Click Save (or Ctrl+S) in any browser and your diagram file updates`);
  console.log('                     right away. No extra popups or duplicate copies.');
  console.log(`      ${c.white}No${c.reset}             Nothing runs in the background. You will have to pick and overwrite`);
  console.log('                     the file on your first save before it can save without opening the');
  console.log('                     file browser.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('    Turn on one-click saving? [Y/n]: ')).trim().toLowerCase();
    console.log('');
    return !(answer === 'n' || answer === 'no');
  } finally {
    rl.close();
  }
}

if (SAVE_HELPER_FEATURE_ENABLED) {
  if (saveHelper === null && process.stdin.isTTY && process.stdout.isTTY) {
    saveHelper = await promptSaveHelper();
  }
  if (saveHelper !== null) {
    const cacheCfgPath = getCacheConfigPath();
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(cacheCfgPath, 'utf8')) || {}; } catch { /* none yet */ }
    cfg.direct_save_helper = saveHelper;
    fs.mkdirSync(path.dirname(cacheCfgPath), { recursive: true });
    fs.writeFileSync(cacheCfgPath, JSON.stringify(cfg, null, 2) + '\n');
  }
}

console.log(`${c.cyan} ✦  INSTALLING RUNTIMES${c.reset}`);

const canonicalRepo = path.resolve(REPO_ROOT).toLowerCase();

function formatDisplayPath(targetDest) {
  if (targetDest.startsWith(USER_HOME)) {
    return `~${targetDest.slice(USER_HOME.length)}`;
  }
  return targetDest;
}

function copySkillDirectory(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  const ignored = new Set(['.git', 'node_modules', '.github', 'agent', '.agents', '.claude', 'dev', 'bin', 'docs', 'skills-lock.json', '__pycache__', '.gitignore']);

  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copySkillDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function lexists(p) {
  // existsSync follows links, so a link whose source repo moved reads as absent and blocks the new install.
  try { fs.lstatSync(p); return true; } catch { return false; }
}

function safeRemove(dest) {
  const stat = fs.lstatSync(dest);
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(dest); // removes the link or junction only, never the source repo it points to
  } else {
    fs.rmSync(dest, { recursive: true, force: true });
  }
}

const hookBase = scope === 'user' ? USER_HOME : targetPath;
const copilotHome = (process.env.COPILOT_HOME || '').trim() || path.join(USER_HOME, '.copilot');
const hookDirs = {
  claude: path.join(hookBase, '.claude'),
  gemini: path.join(hookBase, '.gemini'),
  copilot: scope === 'user' ? copilotHome : path.join(targetPath, '.github')
};
const preexistingHookDirs = {
  claude: fs.existsSync(hookDirs.claude),
  gemini: fs.existsSync(hookDirs.gemini),
  copilot: fs.existsSync(hookDirs.copilot)
};

function isOurVersionHook(entry) {
  if (!entry || typeof entry !== 'object' || !Array.isArray(entry.hooks)) return false;
  return entry.hooks.some((h) => {
    if (!h || typeof h !== 'object') return false;
    const cmd = String(h.command || '').replace(/\\/g, '/');
    return cmd.includes('ultimate-diagram') && cmd.includes('version_check.py');
  });
}

function registerVersionHook(rt, settingsPath, skillDest) {
  const py = process.platform === 'win32' ? 'python' : 'python3';
  const script = path.join(skillDest, 'scripts', 'version_check.py');
  const command = `${py} "${script}" --hook ${rt}`;
  if (rt === 'copilot') {
    const hookFile = path.join(settingsPath, 'hooks', 'ultimate-diagram.json');
    const payload = {
      version: 1,
      hooks: {
        sessionStart: [
          { type: 'command', command, timeoutSec: 10 }
        ]
      }
    };
    fs.mkdirSync(path.dirname(hookFile), { recursive: true });
    fs.writeFileSync(hookFile, JSON.stringify(payload, null, 2) + '\n');
    return { ok: true, msg: hookFile };
  }
  let data = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, msg: `skipped ${settingsPath} (root JSON is not an object)` };
      }
      data = parsed;
    } catch (err) {
      return { ok: false, msg: `skipped ${settingsPath} (could not parse JSON: ${err.message})` };
    }
  }
  if (data.hooks === undefined) data.hooks = {};
  if (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks)) {
    return { ok: false, msg: `skipped ${settingsPath} ('hooks' is not an object)` };
  }
  if (data.hooks.SessionStart === undefined) data.hooks.SessionStart = [];
  if (!Array.isArray(data.hooks.SessionStart)) {
    return { ok: false, msg: `skipped ${settingsPath} ('hooks.SessionStart' is not an array)` };
  }
  const hook = rt === 'claude'
    ? { type: 'command', command, async: true, timeout: 10 }
    : { type: 'command', command, timeout: 5000 };
  data.hooks.SessionStart = data.hooks.SessionStart.filter((e) => !isOurVersionHook(e));
  data.hooks.SessionStart.push({ hooks: [hook] });
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2) + '\n');
  return { ok: true, msg: settingsPath };
}

function stopRunningSaveHelper() {
  const statePath = path.join(path.dirname(getCacheConfigPath()), 'server.json');
  if (!fs.existsSync(statePath)) return;
  const script = path.join(REPO_ROOT, 'scripts', 'save_helper.py');
  if (!fs.existsSync(script)) return;
  const candidates = process.platform === 'win32'
    ? [['python', []], ['py', ['-3']], ['python3', []]]
    : [['python3', []], ['python', []]];
  for (const [cmd, pre] of candidates) {
    const res = spawnSync(cmd, [...pre, script, 'stop'], { stdio: 'ignore', timeout: 3000 });
    if (!res.error && res.status === 0) return;
  }
}

stopRunningSaveHelper();

let installedDest = null;
const installedDests = {};
for (const rt of runtimesToInstall) {
  const dest = destinations[scope][rt];
  const canonicalDest = path.resolve(dest).toLowerCase();
  const label = (runtimeLabels[rt] || rt).padEnd(16, ' ');
  const displayDest = formatDisplayPath(dest);

  // Self-deletion check
  if (canonicalDest === canonicalRepo) {
    console.log(`    ${c.yellow}ℹ${c.reset}  ${c.white}${label}${c.reset} ${c.yellow}Skipped (source repo)${c.reset}`);
    continue;
  }

  const parentDir = path.dirname(dest);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  if (lexists(dest)) {
    safeRemove(dest);
  }
  installedDest = dest;
  installedDests[rt] = dest;

  if (mode === 'symlink') {
    const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
    try {
      fs.symlinkSync(REPO_ROOT, dest, symlinkType);
      console.log(`    ${c.green}✔${c.reset}  ${c.white}${label}${c.reset} ${c.gray}→${c.reset} ${c.dim}${displayDest}${c.reset}`);
    } catch {
      copySkillDirectory(REPO_ROOT, dest);
      console.log(`    ${c.green}✔${c.reset}  ${c.white}${label}${c.reset} ${c.gray}→${c.reset} ${c.dim}${displayDest}${c.reset} ${c.yellow}(copy fallback)${c.reset}`);
    }
  } else {
    copySkillDirectory(REPO_ROOT, dest);
    console.log(`    ${c.green}✔${c.reset}  ${c.white}${label}${c.reset} ${c.gray}→${c.reset} ${c.dim}${displayDest}${c.reset}`);
  }
}

if (!noHooks) {
  for (const rt of ['claude', 'gemini', 'copilot']) {
    if (!installedDests[rt]) continue;
    if (normalizedRuntime === 'all' && scope === 'user' && !preexistingHookDirs[rt]) continue;
    const hookTarget = rt === 'copilot' ? hookDirs.copilot : path.join(hookDirs[rt], 'settings.json');
    const res = registerVersionHook(rt, hookTarget, installedDests[rt]);
    if (res.ok) {
      console.log(`    ${c.green}✔${c.reset}  ${c.white}${(rt + ' hook').padEnd(16, ' ')}${c.reset} ${c.gray}→${c.reset} ${c.dim}${formatDisplayPath(res.msg)}${c.reset}`);
    } else {
      console.log(`    ${c.yellow}⚠${c.reset}  ${c.white}${(rt + ' hook').padEnd(16, ' ')}${c.reset} ${c.yellow}${res.msg}${c.reset}`);
    }
  }
}

function visualLength(str) {
  const stripped = str.replace(/\x1b\[[0-9;]*m/g, '');
  let width = 0;
  for (const ch of stripped) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0x1F300 && cp <= 0x1FAFF) || (cp >= 0x2600 && cp <= 0x27BF)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

const boxWidth = 72;
function boxLine(content) {
  const vLen = visualLength(content);
  const pad = Math.max(0, boxWidth - 4 - vLen);
  return `│  ${content}${' '.repeat(pad)}│`;
}

const topBorder    = `╭${'─'.repeat(boxWidth - 2)}╮`;
const bottomBorder = `╰${'─'.repeat(boxWidth - 2)}╯`;
const emptyLine    = `│${' '.repeat(boxWidth - 2)}│`;

// Verify the installed copy can run: its files, Python 3.9+, a browser, Node.js.
function runCheck(skillDir) {
  const script = path.join(skillDir, 'scripts', 'check_env.py');
  const candidates = process.platform === 'win32'
    ? [['python', []], ['py', ['-3']], ['python3', []]]
    : [['python3', []], ['python', []]];
  for (const [cmd, pre] of candidates) {
    const res = spawnSync(cmd, [...pre, script], { encoding: 'utf8' });
    if (res.error || res.status === 9009) continue; // not on PATH (9009: Windows store alias stub)
    const out = (res.stdout || '') + (res.stderr || '');
    if (/Python was not found/i.test(out)) continue;
    console.log(out.trimEnd().split('\n').map((l) => `    ${l}`).join('\n'));
    return res.status === 0;
  }
  console.log(`    ${c.red}[MISSING] Python 3.9+ is not on PATH; the skill's scripts need it.${c.reset}`);
  return false;
}

console.log(`\n${c.cyan} ✓  CHECKING ENVIRONMENT${c.reset}`);
const ready = runCheck(installedDest || REPO_ROOT);

console.log('');
console.log(`${c.border}${topBorder}${c.reset}`);
console.log(`${c.border}${boxLine(ready ? `${c.green}✨ Installation Successful!${c.reset}`
  : `${c.yellow}⚠ Installed, but install what is marked [MISSING] above${c.reset}`)}${c.reset}`);
console.log(`${c.border}${emptyLine}${c.reset}`);
console.log(`${c.border}${boxLine(`${c.bold}${c.white}How to use:${c.reset}`)}${c.reset}`);
console.log(`${c.border}${boxLine(`  Ask your AI agent:${c.reset}`)}${c.reset}`);
console.log(`${c.border}${boxLine(`  ${c.cyan}/ultimate-diagram${c.reset} create a flowchart for ...${c.reset}`)}${c.reset}`);
if (claudeSelected) {
  const shown = claudeOutputWritten ? claudeOutput : 'artifact';
  console.log(`${c.border}${boxLine(`  Claude Code output: ${c.cyan}${shown}${c.reset}${claudeOutputWritten ? '' : c.dim + ' (default)' + c.reset}`)}${c.reset}`);
  console.log(`${c.border}${boxLine(`${c.dim}  change: --claude-output, or .claude/ultimate-diagram.json${c.reset}`)}${c.reset}`);
}
console.log(`${c.border}${emptyLine}${c.reset}`);
console.log(`${c.border}${boxLine(`${c.dim}Repository: https://github.com/khanhchungoc/ultimate-diagraming-skill${c.reset}`)}${c.reset}`);
console.log(`${c.border}${bottomBorder}${c.reset}\n`);
