# Plan: Background Direct-Save Helper (One-Click Save on `file://` & VS Code Integrated Browser)

Status: Completed (2026-11-22).

## Goal

Allow users who open a local diagram `.html` file normally via `file://` (double-clicking in File Explorer/Finder, or previewing in VS Code's integrated browser) to click **Save** (or press `Ctrl+S`) and overwrite the file on disk immediately with **no file picker dialog and no path pasting**, across VS Code's integrated browser, Chrome, Edge, Firefox, and Safari, and across all 6 AI runtimes.

- **Opt-in with clear explanation (default: Yes):** Users choose whether to enable the local direct-save helper during install (`npx` / `install.py`) or on first diagram run (when installed by copying the skill folder / zip, or via non-interactive install). The prompt explains how it works with concrete examples and defaults to **Yes**.
- **Complements linked-folder save (PR #80):** Does not remove `showDirectoryPicker` linked-folder save (`dev/plans/archive/plan-linked-folder-save.md`). Users who opt out—or open a diagram offline on another machine—still have linked-folder save in Chrome/Edge and the existing Save dialog / download fallback everywhere else.
- **README cleanup:** Remove the `### Save vs Export` section from `README.md` (and update the broken `#save-vs-export` anchor on line 28), since saving behavior is now explained interactively with examples at install or first run.

### Why diagrams stay `file://` while the listener uses `127.0.0.1`

- **Opening diagrams:** Users continue opening `.html` files directly via `file://` (diagrams are **never** served over `http://127.0.0.1`).
- **Saving diagrams:** Browsers strictly block JavaScript on a `file://` page from writing to `file://` paths directly (`fetch('file://...')` is forbidden). The page therefore sends only the updated diagram JSON to a local-only loopback listener (`http://127.0.0.1:<port>/save`), which writes the change back to the `.html` file on disk.

## Design

### 1. Opt-In Preference & Onboarding (Install + First Run)

1. **Per-user config file (`<cache-dir>/config.json`):**
   - Uses the same platform cache directory convention as `scripts/version_check.py` (`%LOCALAPPDATA%\ultimate-diagram` on Windows; `$XDG_CACHE_HOME/ultimate-diagram` or `~/.cache/ultimate-diagram` on POSIX).
   - Stores `{ "direct_save_helper": true | false }` (never stored inside the skill folder or project repo).
   - Helper runs **only** when `direct_save_helper === true` (and not overridden by `ULTIMATE_DIAGRAM_NO_SAVE_HELPER=1`, `--no-save-helper`, or CI/SSH guards).
   - CLI subcommand `python scripts/save_helper.py config --enable | --disable | --status` lets users or agents set or change the choice anytime.
2. **At install time (`bin/install.js` and `scripts/install.py`):**
   - Add CLI flags `--save-helper` / `--no-save-helper` for non-interactive/scripted installs.
   - When run interactively in a TTY without an explicit flag, prompt the user with plain-English explanation and concrete examples (**default: Yes** `[Y/n]`):
     - **What it does:** Runs a small local-only Python listener on your machine (`127.0.0.1`) on demand while you edit diagrams, and auto-exits after 60 minutes idle. It only updates diagram `.html` files registered on your machine.
     - **Example if Yes (default):** Open `docs/flow.html` in VS Code's integrated browser, Chrome, Edge, Firefox, or Safari → edit a box → press **Save** (`Ctrl+S`) → `docs/flow.html` updates directly in place with no file picker.
     - **Example if No:** No background listener runs. In Chrome/Edge you can link a folder once or pick the file on first save; in VS Code's integrated browser, Firefox, or Safari, Save opens a Save As dialog or downloads a copy (`flow (1).html`).
   - Save the answer to `<cache-dir>/config.json`.
   - When run non-interactively (no TTY, e.g. agent running `npx ultimate-diagram@latest`) without `--save-helper` / `--no-save-helper`, leave `direct_save_helper` unset so the first-run flow below asks the user directly.
3. **At first run (copied skill folder / zip install / non-interactive install):**
   - When `scripts/layout_engine.py` writes a local `--target file` diagram and `direct_save_helper` is **unset** in `<cache-dir>/config.json` (and not in CI/SSH/`ULTIMATE_DIAGRAM_NO_SAVE_HELPER=1`):
     - Do **not** start the listener before the user opts in (still stamp `<meta name="diagram-save-id">` and register the ID so enabling it works immediately on the already-generated file).
     - Print a single `[INFO]` line before `[DONE]` (matching `version_check.py`'s pattern):
       ```text
       [INFO] Direct-save helper not configured yet. Ask the user whether to enable one-click direct saving for local HTML diagrams (default: Yes) with examples, then run: python scripts/save_helper.py config --enable (or --disable).
       ```
   - Add a brief instruction in `SKILL.md` so the agent asks the user once with the same plain-English explanation and concrete examples (defaulting to **Yes**), then runs `python scripts/save_helper.py config --enable` (which saves `true` and starts the helper right away) or `--disable` (which saves `false` so the prompt never repeats).

### 2. Security & Determinism Model (Per-File Save ID + Local Registry + JSON-Only Patch)

Because a `file://` page sends `Origin: null` (which sandboxed iframes on websites can also send), the helper enforces four independent layers of protection with negligible overhead (~2–5 ms per save):

1. **Per-file random ID (`diagram-save-id`):**
   - When `scripts/layout_engine.py` writes a local diagram via the CLI (`--layout ... -o <target.html>`), it stamps a unique random 128-bit hex ID into `<head>`:
     ```html
     <meta name="diagram-save-id" content="<32-hex-chars>">
     ```
   - On `--keep-from <target.html>`, the existing `diagram-save-id` from `<target.html>` is preserved (no unnecessary git diff churn on updates).
   - `assemble_page()` itself stays 100% deterministic (omits the meta tag by default), so golden tests, `dev/tools/build_examples.py --check`, playground builds, and Claude Artifacts are unaffected.
   - Sharing a diagram `.html` file never leaks a master secret: each file has its own opaque ID, which is not registered on any other person's machine.
2. **Local ID registry (`<cache-dir>/allowed-ids.json`, mode `0600` on POSIX):**
   - Whenever `layout_engine.py --layout` writes a diagram (or `--extract` reads one that already has a `diagram-save-id`), it records `{ "<id>": { "path": "<resolved-abs-path>", "updated_at": <epoch> } }` in `allowed-ids.json` (FIFO capped at 500 recent IDs).
   - On `file://`, the browser sends the current file path (`loc.file`), so moving or renaming the `.html` file in File Explorer/Finder keeps direct-save working because authorization is tied to the file's ID, not its original path.
   - If a preview host opens the file over a local preview URL (e.g. VS Code Live Preview on `http://127.0.0.1:<port>` where `loc.file` is unavailable), the helper can fall back to the registered `path` for that `saveId` after verifying the on-disk file still carries the same `diagram-save-id`.
3. **On-disk verification before write:**
   - On `POST /save`, the helper checks:
     - `Origin` is `null` (`file://`), or a loopback preview origin (`http://127.0.0.1:<port>` / `http://localhost:<port>`), **and** custom header `X-Ultimate-Diagram-Save: 1` is present (triggers CORS preflight; blocks simple cross-site requests and all remote `https://` web origins).
     - `saveId` is present in `allowed-ids.json`.
     - Target `path` (from request on `file://`, or registered path fallback on loopback preview) resolves via `realpath` to an existing regular `.html` / `.htm` file (rejecting symlinks/directories).
     - The existing file on disk contains **both** `<meta name="diagram-save-id" content="<same-id>">` **and** `<script id="diagram-data" type="application/json">`.
4. **JSON-only patching (never raw HTML/JS):**
   - The browser sends `{ path, saveId, data, title }` (size-capped at 10 MB).
   - The helper validates `data` is valid JSON with a known `diagramType` in `SUPPORTED_TYPES`, formats it via `scripts/disk_format.py` (`format_json`), and patches **only** `<script id="diagram-data">`, `<title>`, `<h1 id="chart-title">`, and the line-2 reading guide (`stamp_reading_guide`) in the existing file on disk using an atomic temp-file + rename write.
   - Even in a worst-case scenario, the helper can never inject HTML/JavaScript or overwrite non-diagram files.

### 3. Background Helper Server (`scripts/save_helper.py`, Python 3.9+ stdlib only)

- **Single shared instance across all diagrams and runtimes:**
  - Binds strictly to `127.0.0.1` on a small fixed port range (`19847..19851`, picking the first free port).
  - Writes state to `<cache-dir>/server.json` (`{ "pid": ..., "port": 19847, "started_at": ... }`).
  - Before starting a new instance, checks `GET http://127.0.0.1:<port>/health` (fast 150 ms timeout); if healthy, reuses the running server.
- **Endpoints:**
  - `GET /health` -> `200 {"ok": true, "app": "ultimate-diagram-save-helper", "version": 1}`
  - `OPTIONS /save` -> CORS preflight echoing allowed `Origin` (`null` or loopback) with `Access-Control-Allow-Headers: Content-Type, X-Ultimate-Diagram-Save`, `Access-Control-Allow-Methods: POST, OPTIONS`, `Access-Control-Allow-Private-Network: true`.
  - `POST /save` -> validates origin/headers, `saveId`, on-disk match, and diagram JSON; atomically patches the file; returns `200 {"ok": true, "name": "<basename>"}` (or `403`/`400`/`404` on mismatch).
- **Lifecycle:**
  - **SessionStart + lazy start (only when opted in):** Started detached on `SessionStart` via the existing `scripts/version_check.py --hook <runtime>` hook (Claude Code / Gemini CLI) and lazily by `layout_engine.py` on `--layout` (when writing a local `--target file`) and `--extract` (when reading a local `.html` file) across all 6 runtimes, **only if** `config.json` has `direct_save_helper: true`. Same detached spawn pattern as `scripts/version_check.py` (`CREATE_NO_WINDOW | DETACHED_PROCESS` on Windows, `start_new_session=True` on POSIX).
  - **Environment guard:** Automatically skipped when running in CI (`CI`, `GITHUB_ACTIONS`), remote SSH sessions (`SSH_CONNECTION`, `SSH_CLIENT`), headless containers without a desktop, or when `ULTIMATE_DIAGRAM_NO_SAVE_HELPER=1` is set (also skipped via `--no-save-helper`).
  - **Idle auto-shutdown:** Exits cleanly after **60 minutes** without any `/health` or `/save` activity, removing stale `server.json`.
  - Manual CLI (`python scripts/save_helper.py start|stop|status|config --enable|--disable|--status`).

### 4. Browser Integration (`assets/shell/shell.js`)

- Runs when `!playground && !claudeHost` and `<meta name="diagram-save-id">` is present on `file://` (or loopback preview `http://127.0.0.1` / `http://localhost`).
- Inside `writeFile()`, tries `saveViaLocalHelper()` **first**, before `loadStoredHandle()` / `loadFromLinkedFolders()` / `showSaveFilePicker`:
  - Probes the helper port range (`19847..19851`) with a short timeout (~300 ms) on first save (caching the working port for the page session).
  - Sends `POST http://127.0.0.1:<port>/save` with `{ path: loc ? loc.file : null, saveId, data: diskData, title }`.
- **On success (`200 OK`):**
  - Marks document saved (`savedJson`, `everSaved = true`, updates `<script id="diagram-data">` and `document.title` in DOM, pulses Save icon).
  - Status badge reads `Saved to <filename>` (tooltip: `Saved straight to <filename> via local helper`).
- **On any failure (helper timed out / not running / opted out / port unreachable / `403`):**
  - Falls back silently and immediately to the existing `writeFile()` flow (stored file handle -> linked workspace folder -> first-save bubble / `showSaveFilePicker` -> download fallback). No error popup, no lost edits.

## Phases

### Phase 1: Core helper, config & disk patching (`scripts/save_helper.py`)
- Implement `scripts/save_helper.py`: `<cache-dir>/config.json` opt-in state (`config --enable|--disable|--status`), HTTP server on `127.0.0.1:19847..19851`, `allowed-ids.json` registry (storing ID + path + timestamp), on-disk `diagram-save-id` + `diagram-data` verification, JSON-only atomic file patcher reusing `scripts/disk_format.py`, 60-minute idle timer, single-instance health check, and `start|stop|status` subcommands.
- Keep zero external dependencies (Python stdlib `http.server`, `socket`, `json`, `secrets`, `tempfile`).

### Phase 2: `layout_engine.py`, installers, `SKILL.md` & `README.md`
- **`scripts/layout_engine.py`:**
  - Stamp `diagram-save-id` in the CLI `--layout` output path (preserving existing ID on `--keep-from`; omitted in `assemble_page()` / tests / examples / artifacts) and register the ID + path in `allowed-ids.json`.
  - Check `config.json`: if `direct_save_helper: true`, lazily ensure the helper is running; if `false`, do nothing; if unset (and not in CI/SSH/`ULTIMATE_DIAGRAM_NO_SAVE_HELPER=1`), emit the single `[INFO] Direct-save helper not configured yet...` line without starting the helper.
  - On `--extract` of a local `.html` file with an existing `diagram-save-id`, register it and ensure the helper is running when `direct_save_helper: true`.
- **Installers (`bin/install.js`, `scripts/install.py`):**
  - Add `--save-helper` / `--no-save-helper` flags and interactive TTY prompt with plain-English explanation + concrete examples (defaulting to **Yes**) that writes `<cache-dir>/config.json`.
  - Leave `config.json` unset when run non-interactively without a flag so the first-run prompt handles it.
  - Verify `scripts/save_helper.py` is included in copy installs (`bin/install.js`, `scripts/install.py`, `package.json`).
- **Docs (`SKILL.md`, `README.md`):**
  - Document the first-run `[INFO] Direct-save helper not configured yet` handling in `SKILL.md` (explain with examples, default Yes, run `config --enable` or `--disable`).
  - Remove the `### Save vs Export` section from `README.md` and update line 28 so it has no broken `#save-vs-export` anchor.

### Phase 3: Shell integration (`assets/shell/shell.js`)
- Add `saveViaLocalHelper()` in `assets/shell/shell.js` ahead of `showSaveFilePicker` / linked-folder lookup inside `writeFile()` when `<meta name="diagram-save-id">` is present on `file://` (or loopback preview).
- Update status badge text/tooltip for direct helper saves.
- Rebuild `dev/samples/example-*.html` via `python3 dev/tools/build_examples.py` and verify with `--check` (confirming examples remain deterministic and contain no `diagram-save-id`).

### Phase 4: Verification & tests
- Add unit tests in `dev/tests/unit/test_save_helper.py`:
  - Opt-in config behavior: unset does not start helper and emits first-run `[INFO]`; `--enable` persists `true` and starts helper; `--disable` persists `false` and suppresses prompt/start; `ULTIMATE_DIAGRAM_NO_SAVE_HELPER=1` overrides `true`.
  - Valid save patches `<script id="diagram-data">`, `<title>`, `<h1>`, and reading-guide line numbers atomically; preserves editor code byte-for-byte.
  - Survives moving/renaming the `.html` file on `file://`.
  - Supports loopback preview save when `path` is omitted by resolving the registered path for `saveId` and verifying on-disk `diagram-save-id`.
  - Rejects: unregistered ID, mismatched on-disk ID, missing `diagram-data` block, remote Origin (e.g. `https://evil.com`), missing `X-Ultimate-Diagram-Save` header, invalid JSON / unknown `diagramType`, oversized payload, non-HTML target path.
  - Idle shutdown timer and single-instance reuse.
- Extend `dev/tests/unit/test_install.py` to test `--save-helper`, `--no-save-helper`, and non-interactive default (leaves `config.json` unset).
- Add E2E tests in `dev/tests/e2e/e2e_shell.mjs`:
  - `file://` diagram with `diagram-save-id` saves straight through a test helper server on first `Ctrl+S` with zero bubble and zero file picker; reloading the saved file shows the edited data.
  - When helper is stopped/unreachable, falls back cleanly to the existing linked-folder / first-save bubble / `showSaveFilePicker` flow.
- Verify `python3 dev/tools/build_examples.py --check`, `python3 dev/tests/unit/check_golden.py`, `python3 dev/tests/unit/check_tokens.py`, `python3 dev/tests/unit/check_contrast.py`, `python3 dev/tests/unit/test_install.py`, and `node dev/tests/run_e2e.mjs --only shell`.

## Not doing

- Starting the background listener before the user opts in.
- Serving diagrams over `http://localhost` links in chat (users continue opening `.html` files directly via `file://`).
- Removing the browser-native linked-folder save (`showDirectoryPicker`) for standalone Chrome/Edge.
- Permanent OS startup services (Task Scheduler / LaunchAgent / systemd).
- Allowing the helper to write raw HTML/JavaScript from browser requests or touch unregistered files.
