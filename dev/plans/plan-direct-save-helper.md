# Plan: Background Direct-Save Helper (One-Click Save on `file://`)

Status: proposed (2026-11-22).

## Goal

Allow users who open a local diagram `.html` file normally (`file://` — double-clicking in File Explorer/Finder or opening from an IDE) to click **Save** (or press `Ctrl+S`) and overwrite the file on disk immediately with **no file browser dialog and no path pasting**, across all browsers (Chrome, Edge, Firefox, Safari) and all 6 AI runtimes. When the background helper is not running (or the file is opened offline on another machine), Save falls back silently to the existing browser Save dialog / download flow so diagrams remain 100% standalone and portable.

## Design

### 1. Security & Determinism Model (Per-File Save ID + Local Registry + JSON-Only Patch)

Because a `file://` page sends `Origin: null` (which sandboxed iframes on malicious websites can also send), the helper enforces four independent layers of protection with negligible speed overhead (~2–5 ms per save):

1. **Per-file random ID (`diagram-save-id`):**
   - When `scripts/layout_engine.py` writes a local diagram via the CLI (`--layout ... -o <target.html>`), it stamps a unique random 128-bit hex ID into `<head>`:
     ```html
     <meta name="diagram-save-id" content="<32-hex-chars>">
     ```
   - On `--keep-from <target.html>`, the existing `diagram-save-id` from `<target.html>` is preserved (no unnecessary git diff churn on updates).
   - `assemble_page()` itself stays 100% deterministic (omits the meta tag by default), so golden tests, `dev/tools/build_examples.py --check`, playground builds, and Claude Artifacts are unaffected.
   - Sharing a diagram `.html` file never leaks a master secret: each file has its own opaque ID, which is not registered on any other person's machine.
2. **Local ID registry (`~/.cache/ultimate-diagram/allowed-ids.json`, mode `0600` on POSIX):**
   - Whenever `layout_engine.py --layout` writes a diagram (or `--extract` reads one that already has a `diagram-save-id`), it records the ID in `allowed-ids.json` (FIFO capped at 500 recent IDs).
   - Moving or renaming the `.html` file in File Explorer/Finder keeps direct-save working because authorization is tied to the file's ID, not its original path.
3. **On-disk verification before write:**
   - On `POST /save`, the helper checks:
     - Request came from `Origin: null` with custom header `X-Ultimate-Diagram-Save: 1` (triggers CORS preflight; blocks simple cross-site requests and normal `https://` web origins).
     - `saveId` is present in `allowed-ids.json`.
     - `path` points to an existing regular `.html` / `.htm` file (resolved via `realpath`, rejecting symlinks/directories outside regular files).
     - The existing file on disk contains **both** `<meta name="diagram-save-id" content="<same-id>">` **and** `<script id="diagram-data" type="application/json">`.
4. **JSON-only patching (never raw HTML/JS):**
   - The browser sends `{ path, saveId, data, title }` (size-capped, e.g. 10 MB max).
   - The helper validates `data` is valid JSON with a known `diagramType` in `SUPPORTED_TYPES`, formats it via `scripts/disk_format.py` (`format_json`), and patches **only** `<script id="diagram-data">`, `<title>`, `<h1 id="chart-title">`, and the line-2 reading guide (`stamp_reading_guide`) in the existing file on disk using an atomic temp-file + rename write.
   - Even in a worst-case scenario, the helper can never inject HTML/JavaScript or overwrite non-diagram files.

### 2. Background Helper Server (`scripts/save_helper.py`, Python 3.9+ stdlib only)

- **Single shared instance across all diagrams and runtimes:**
  - Binds strictly to `127.0.0.1` on a fixed small port range (`19847..19851`, picking the first free port).
  - Writes state to `~/.cache/ultimate-diagram/server.json` (`{ "pid": ..., "port": 19847, "started_at": ... }`).
  - Before starting a new instance, checks `GET http://127.0.0.1:<port>/health` (fast 150 ms timeout); if healthy, reuses the running server.
- **Endpoints:**
  - `GET /health` -> `200 {"ok": true, "app": "ultimate-diagram-save-helper", "version": 1}`
  - `OPTIONS /save` -> CORS preflight (`Access-Control-Allow-Origin: null`, `Access-Control-Allow-Headers: Content-Type, X-Ultimate-Diagram-Save`, `Access-Control-Allow-Methods: POST, OPTIONS`, `Access-Control-Allow-Private-Network: true`).
  - `POST /save` -> validates headers, `saveId`, on-disk match, and diagram JSON; atomically patches the file; returns `200 {"ok": true, "name": "<basename>"}` (or `403`/`400`/`404` on mismatch).
- **Lifecycle:**
  - **Lazy start:** Spawned detached (hidden window on Windows via `CREATE_NO_WINDOW | DETACHED_PROCESS`, `start_new_session=True` on POSIX) by `layout_engine.py` on `--layout` (when writing a local `--target file`) and `--extract` (when reading a local `.html` file).
  - **Environment guard:** Automatically skipped when running in CI (`CI`, `GITHUB_ACTIONS`), remote SSH sessions (`SSH_CONNECTION`, `SSH_CLIENT`), headless containers without a desktop, or when `ULTIMATE_DIAGRAM_NO_SAVE_HELPER=1` is set (also skipped via `--no-save-helper`).
  - **Idle auto-shutdown:** Exits cleanly after **60 minutes** without any `/health` or `/save` activity, removing stale `server.json`.
  - Optional manual CLI (`python scripts/save_helper.py start|stop|status`) for troubleshooting or opening an older diagram without running the agent.

### 3. Browser Integration (`assets/shell/shell.js`)

- Runs only when `!playground && !claudeHost && location.protocol === 'file:'` and `<meta name="diagram-save-id">` is present.
- Probes the helper port range (`19847..19851`) with a short timeout (e.g. 300 ms) on first save (caching the working port for the page session).
- Sends `POST http://127.0.0.1:<port>/save` with `{ path: loc.file, saveId, data: diskData, title }`.
- **On success (`200 OK`):**
  - Marks document saved (`savedJson`, `everSaved = true`, updates `<script id="diagram-data">` and `document.title` in DOM, pulses Save icon).
  - Status badge reads `Saved to <filename>` (tooltip: `Saved straight to <filename> via local helper`).
- **On any failure (helper timed out / not running / port unreachable / `403`):**
  - Falls back silently and immediately to the existing `writeFile()` flow (`showSaveFilePicker` + first-save location bubble or download fallback). No error popup, no lost edits.
- Also works in Firefox and Safari whenever the helper is running (even though those browsers lack `showSaveFilePicker`).

## Phases

### Phase 1: Core helper + disk patching (`scripts/save_helper.py`)
- Implement `scripts/save_helper.py`: HTTP server on `127.0.0.1:19847..19851`, `allowed-ids.json` registry, on-disk `diagram-save-id` + `diagram-data` verification, JSON-only atomic file patcher reusing `scripts/disk_format.py`, 60-minute idle timer, single-instance lock/health check, and `start|stop|status` subcommands.
- Keep zero external dependencies (Python stdlib `http.server`, `socket`, `json`, `secrets`, `tempfile`).

### Phase 2: `layout_engine.py` integration
- Add `save_id` stamping in the CLI `--layout` output path (preserving existing ID on `--keep-from`; omitted in `assemble_page()` / tests / examples / artifacts).
- Register the ID in `allowed-ids.json` and lazily ensure the helper is running (respecting CI/SSH/opt-out guards).
- Also register existing `diagram-save-id` and ensure helper is running on `--extract` of a local `.html` file.

### Phase 3: Shell integration (`assets/shell/shell.js`)
- Add `saveViaLocalHelper()` in `assets/shell/shell.js` ahead of `showSaveFilePicker` inside `writeFile()` for `file://` pages that have `<meta name="diagram-save-id">`.
- Update status badge text/tooltip for direct helper saves.
- Rebuild `dev/samples/example-*.html` via `dev/tools/build_examples.py` (verifying examples remain deterministic and contain no `diagram-save-id`).

### Phase 4: Verification & tests
- Add unit tests in `dev/tests/unit/test_save_helper.py`:
  - Valid save patches `<script id="diagram-data">`, `<title>`, `<h1>`, and reading-guide line numbers atomically; preserves editor code byte-for-byte.
  - Survives moving/renaming the `.html` file.
  - Rejects: unregistered ID, mismatched on-disk ID, missing `diagram-data` block, non-`null` Origin (e.g. `https://evil.com`), missing custom header, invalid JSON / unknown `diagramType`, oversized payload, non-HTML target path.
  - Idle shutdown timer and single-instance reuse.
- Add E2E tests in `dev/tests/e2e/e2e_shell.mjs`:
  - `file://` diagram with `diagram-save-id` saves straight through a test helper server on first `Ctrl+S` with zero bubble and zero file picker; reloading the saved file shows the edited data.
  - When helper is stopped/unreachable, falls back cleanly to the existing first-save location bubble and `showSaveFilePicker`.
- Verify `python3 dev/tools/build_examples.py --check`, `check_golden.py`, `check_tokens.py`, `check_contrast.py`, and `node dev/tests/run_e2e.mjs --only shell`.

## Not doing

- Serving diagrams over `http://localhost` links in chat (users continue opening `.html` files directly).
- Permanent OS startup services (Task Scheduler / LaunchAgent / systemd).
- Allowing the helper to write raw HTML/JavaScript from browser requests or touch unregistered files.
