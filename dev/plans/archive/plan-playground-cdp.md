# Plan: Port `e2e_playground.mjs` from Playwright to `cdp.mjs`

Status: completed (2026-11-22).

## Why

`dev/tests/e2e/e2e_playground.mjs` is the only E2E test that depends on Playwright instead of the shared zero-dependency Chrome driver (`dev/tests/e2e/cdp.mjs`):

- **CI slowdown:** Every GitHub Pages deploy in `.github/workflows/playground.yml` runs `npm install --no-save playwright && npx playwright install --with-deps chromium` with no cache, adding ~45–90 seconds to every deploy even though `ubuntu-latest` already has `google-chrome` pre-installed.
- **Skipped locally:** Because Playwright is not installed in `package.json`, `dev/tests/run_e2e.mjs` has to skip `e2e_playground.mjs` on local developer runs.

Porting `e2e_playground.mjs` to `cdp.mjs` removes Playwright completely, speeds up CI deploys, and brings playground coverage into local `npm run test:e2e` runs (including shared-Chrome execution).

## Changes

1. **HTTP URL navigation in `dev/tests/e2e/cdp.mjs`:**
   - Allow `t.open(target, query, opts)` to accept an `http://` / `https://` URL directly (in addition to local file paths), skipping `readFileSync` / `serveDir` when `target` is already a URL and still waiting for `readyState === 'complete'` and `diagramSettled === '1'`.
   - Keep existing `file://` and split-artifact directory behaviour unchanged.

2. **Port `dev/tests/e2e/e2e_playground.mjs` to `cdp.mjs`:**
   - Accept `--browser <chrome>` (and auto-detect Chrome/Chromium if omitted so CI and direct runs both stay simple).
   - Keep the existing loopback HTTP server serving `--dir` (or a temp build from `dev/tools/build_playground.py`).
   - Replace Playwright primitives with `cdp.mjs` equivalents already used across the other 24 E2E tests:
     - Clipboard stub via `Page.addScriptToEvaluateOnNewDocument` (same pattern as `e2e_mermaid.mjs`).
     - Dialog capture via `Page.javascriptDialogOpening` (dismiss and record as an error).
     - Downloads via `Browser.setDownloadBehavior` into a unique temp directory (`mkdtempSync`), polling for the completed `.html` file (same pattern as `e2e_shell.mjs` and `e2e_theme.mjs`).
     - Type-switch navigation checks via `t.waitFor('location.href.includes("/erd/index.html")')` + readiness wait.
     - Standalone offline reload check via `t.open(savedFile)` (reusing the same tab after reading the saved file, or opening `file://` directly).
     - Console error filter keeping the existing ignore pattern for offline font/network warnings (`fonts.g|net::ERR|Failed to load resource`).
   - Keep every existing assertion, exit code (`0` pass, `1` setup error, `2` failure), and `-v` verbose flag identical.

3. **Enable in `dev/tests/run_e2e.mjs`:**
   - Remove `requiresPlaywright: true` from the `playground` entry in `TESTS` (and drop the unused `hasPlaywright()` check).
   - `playground` now runs automatically in parallel inside the shared Chrome instance alongside the other 24 E2E tests.

4. **Update `.github/workflows/playground.yml`:**
   - Bump `node-version: 20` → `node-version: 22` (required for Node's built-in `WebSocket` used by `cdp.mjs`).
   - Remove `npm install --no-save playwright && npx playwright install --with-deps chromium`.
   - Run `node dev/tests/e2e/e2e_playground.mjs --browser google-chrome --dir _site` (verifying `google-chrome` is present on `ubuntu-latest`, or falling back to `which google-chrome || which chromium`).

5. **Update docs (`dev/docs/architecture.md`):**
   - Note that all 25 E2E tests (including `e2e_playground.mjs`) run through `cdp.mjs` with zero browser-driver dependencies.

## Verification

- Run `node dev/tests/e2e/e2e_playground.mjs --browser <chrome> -v` standalone and confirm every check passes with exit code `0`.
- Run `node dev/tests/run_e2e.mjs --only playground` (shared Chrome) and confirm it passes without skipping.
- Run `npm run test:e2e` and confirm the full suite (now 42/42 tasks, 0 skipped) passes.
- Trigger or verify `.github/workflows/playground.yml` on merge to `main` (confirming `ubuntu-latest` Chrome + Node 22 passes the deploy gate with no Playwright install step).

## Not doing

- Changing playground features, starter diagrams, or `dev/tools/build_playground.py`.
- Adding `playwright` back to `package.json`.
