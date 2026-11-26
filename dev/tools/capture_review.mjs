#!/usr/bin/env node
/**
 * Capture light/dark PNG review screenshots of a diagram HTML page via CDP.
 *
 * Usage:
 *   node dev/tools/capture_review.mjs --page <path.html> [options]
 *
 * Options:
 *   --page <path>             Required. Path to an HTML diagram file.
 *   --themes <list>           Comma-separated themes: light,dark (default: light,dark)
 *   --select <css-selector>   Click the first matching element before capture
 *   --hover <css-selector>    Move the pointer to the center of the first matching element before capture
 *   --out <dir>               Output directory (default: .)
 *   --prefix <name>           Output filename prefix (default: basename of --page without .html)
 *   --viewport <WxH>          Viewport size in CSS pixels (default: 1440x900)
 *   --wait <ms>               Settle wait in ms after theme/action (default: 200)
 *   --browser <path>          Explicit Chrome/Chromium executable path
 *   -h, --help                Show this help text
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { findBrowser, launch, sleep } from '../tests/e2e/cdp.mjs';

const VALID_THEMES = new Set(['light', 'dark']);

const USAGE = `Usage: node dev/tools/capture_review.mjs --page <path.html> [options]

Options:
  --page <path>             Required. Path to an HTML diagram file
  --themes <list>           Comma-separated themes: light,dark (default: light,dark)
  --select <css-selector>   Click element matching selector before capture
  --hover <css-selector>    Hover center of element matching selector before capture
  --out <dir>               Output directory (default: .)
  --prefix <name>           Output filename prefix (default: basename of --page without .html)
  --viewport <WxH>          Viewport size, e.g. 1440x900 (default: 1440x900)
  --wait <ms>               Settle wait in ms after theme/action (default: 200)
  --browser <path>          Explicit Chrome/Chromium path
  -h, --help                Show this help message`;

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseCliArgs(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        page: { type: 'string' },
        themes: { type: 'string', default: 'light,dark' },
        select: { type: 'string' },
        hover: { type: 'string' },
        out: { type: 'string', default: '.' },
        prefix: { type: 'string' },
        viewport: { type: 'string', default: '1440x900' },
        wait: { type: 'string', default: '200' },
        browser: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    console.error(`Error: ${err.message}\n\n${USAGE}`);
    process.exit(1);
  }

  const v = parsed.values;
  if (v.help) {
    console.log(USAGE);
    process.exit(0);
  }

  if (!v.page) {
    console.error(`Error: --page is required.\n\n${USAGE}`);
    process.exit(1);
  }

  const pagePath = resolve(v.page);
  if (!existsSync(pagePath) || !statSync(pagePath).isFile()) {
    fail(`--page file not found: ${v.page}`);
  }

  const rawThemes = v.themes.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!rawThemes.length) {
    fail('--themes must include at least one theme (light, dark).');
  }
  const themes = [];
  for (const theme of rawThemes) {
    if (!VALID_THEMES.has(theme)) {
      fail(`invalid theme "${theme}" in --themes (expected light and/or dark).`);
    }
    if (!themes.includes(theme)) themes.push(theme);
  }

  const vpMatch = /^(\d+)x(\d+)$/i.exec(v.viewport.trim());
  if (!vpMatch) {
    fail(`invalid --viewport "${v.viewport}" (expected WxH, e.g. 1440x900).`);
  }
  const width = Number(vpMatch[1]);
  const height = Number(vpMatch[2]);
  if (width <= 0 || height <= 0) {
    fail(`invalid --viewport "${v.viewport}" (width and height must be positive integers).`);
  }

  const waitMs = Number(v.wait);
  if (!Number.isFinite(waitMs) || waitMs < 0) {
    fail(`invalid --wait "${v.wait}" (expected a non-negative number of milliseconds).`);
  }

  const outDir = resolve(v.out);
  const prefix = v.prefix || basename(pagePath).replace(/\.html?$/i, '');
  if (!prefix) {
    fail('--prefix could not be derived from --page; pass --prefix explicitly.');
  }

  return {
    pagePath,
    themes,
    select: v.select || null,
    hover: v.hover || null,
    outDir,
    prefix,
    width,
    height,
    waitMs,
    browserArg: v.browser || undefined,
  };
}

async function ensureTheme(t, theme) {
  const current = await t.ev(`document.documentElement.getAttribute('data-theme')`);
  if (current === theme) return;

  // Match the diagram shell's theme toggle (#btn-theme runs applyTheme + plugin.render() synchronously
  // for programmatic clicks); fall back to setting data-theme directly on non-shell pages.
  await t.ev(`(() => {
    const target = ${JSON.stringify(theme)};
    const btn = document.getElementById('btn-theme');
    if (btn && document.documentElement.getAttribute('data-theme') !== target) {
      btn.click();
    }
    if (document.documentElement.getAttribute('data-theme') !== target) {
      document.documentElement.setAttribute('data-theme', target);
    }
  })()`);
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));

  const browser = findBrowser(opts.browserArg);
  if (!browser) {
    fail('Chrome/Chromium not found. Pass --browser <path> or set CHROME.');
  }

  mkdirSync(opts.outDir, { recursive: true });

  const t = await launch(browser);
  try {
    await t.send('Emulation.setDeviceMetricsOverride', {
      width: opts.width,
      height: opts.height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    for (const theme of opts.themes) {
      await t.open(opts.pagePath, `?theme=${theme}`);
      await ensureTheme(t, theme);
      await t.settle();

      if (opts.select) {
        const pos = await t.at(opts.select);
        if (!pos) throw new Error(`No element matches --select selector: ${opts.select}`);
        await t.click(pos.x, pos.y);
        await t.settle();
      }

      if (opts.hover) {
        const pos = await t.at(opts.hover);
        if (!pos) throw new Error(`No element matches --hover selector: ${opts.hover}`);
        await t.mouse('mouseMoved', pos.x, pos.y);
        await t.settle();
      }

      await t.ev(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
      if (opts.waitMs > 0) await sleep(opts.waitMs);

      const { data } = await t.send('Page.captureScreenshot', { format: 'png' });
      const outPath = join(opts.outDir, `${opts.prefix}-${theme}.png`);
      writeFileSync(outPath, Buffer.from(data, 'base64'));
      console.log(outPath);
    }
  } finally {
    await t.close();
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
