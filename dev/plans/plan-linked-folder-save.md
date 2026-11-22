# Plan: Linked Workspace Folder for One-Click Save (`showDirectoryPicker`)

Status: proposed (2026-11-22).

## Goal

Eliminate the repeated first-save file dialog and path-pasting workflow for local diagram `.html` files (`file://`) in Chromium browsers (Chrome, Edge, Brave, Arc) with **zero background processes, zero local network ports, zero IT/EDR footprint, and 100% tool/runtime independence**.

By linking a top-level workspace or repo folder once via the browser's native `showDirectoryPicker` API, every new or existing diagram inside that folder or any nested child folder saves straight back to disk in one click.

## Design

### 1. Storage in IndexedDB (`ultimate-diagram`, version 2)

Extend the existing `ultimate-diagram` IndexedDB database in `assets/shell/shell.js` (already shared across `file://` diagram pages in Chromium):

- Existing object store `handles`: per-file `FileSystemFileHandle` keyed by `location.href` (unchanged).
- New object store `folders`: list of linked `FileSystemDirectoryHandle` entries (keyed by auto-increment or stable key, capped at e.g. 20 linked top folders so users working across multiple roots like `C:\repos` and `D:\work` are covered).
- Upgrade path (`onupgradeneeded`): create `folders` store only if `!db.objectStoreNames.contains('folders')`, preserving existing saved `handles`.

### 2. Resolving a `file://` diagram inside linked folders (`assets/shell/shell.js`)

When Save (`#btn-save` or `Ctrl+S`) runs on a `file://` diagram with no cached `fileHandle` for this `location.href`:

1. Check per-file stored handle (`loadStoredHandle()`), as today.
2. If none, check stored linked folder handles (`loadFromLinkedFolders(loc)`):
   - Parse `loc.file` into path segments (handling Windows drive paths, UNC paths, and POSIX paths; case-insensitive matching on Windows).
   - For each stored directory handle `dir`:
     - Find candidate suffix matches where a path segment matches `dir.name` (checking from outermost to innermost so nested same-named folders work).
     - Check/request `readwrite` permission on `dir` (`queryPermission` first; if `'prompt'`, show a concise toast explaining the one-time-per-browser-session prompt, then `requestPermission`).
     - Walk child directory handles (`getDirectoryHandle`) down to the file (`getFileHandle`).
     - **Identity verification before writing (prevents ever overwriting a wrong file in a same-named folder):**
       - Capture `initialDataBlock` (the raw `<script id="diagram-data">` text) once when the page loads.
       - Read the resolved file handle (`await fh.getFile().text()`) and extract its `<script id="diagram-data">` block.
       - Accept `fh` **only** if its on-disk `<script id="diagram-data">` block matches `initialDataBlock` (exact match after whitespace normalization).
       - If matched: set `fileHandle = fh`, save it into the per-file `handles` store (`storeHandle(fh)`), and write the updated HTML immediately.
3. If no linked folder matched (or permission was denied), show the first-save bubble.

### 3. First-save bubble UX (`askSaveLocation` in `assets/shell/shell.js`)

When `'showDirectoryPicker' in window` is available, upgrade the first-save bubble so users can either link a top folder once or pick a single file as today:

- **Buttons:**
  - `Cancel`
  - `Link folder…` (alt button via existing `ui.confirm` `alt` slot, styled cleanly)
  - `Choose file…` (primary action, or `Link folder…` as primary and `Choose file…` as alt — final button hierarchy verified visually)
- **Clear, concise guidance telling the user to pick a top parent folder (not just the immediate subfolder):**
  - Copy the opened file's path as today (so `Choose file…` works immediately).
  - Explain clearly in the bubble (and before/inside the folder link step):
    - **Link folder:** Pick a **top repo or workspace folder** (not just this file's direct folder) so future diagrams in any subfolder save directly. Note that Chrome/Edge block linking root drives (`C:\`) or top-level system folders (`Desktop`, `Documents`, `Downloads`) directly—pick a repo or project subfolder instead.
    - **Choose file:** Concise paste + Save + overwrite instruction (from PR #77).
- **After picking a folder via `showDirectoryPicker({ id: 'ultimate-diagram-root', mode: 'readwrite' })`:**
  - Immediately attempt to resolve and verify the current file inside the newly picked folder.
  - **If found & verified:** store the folder handle in `folders`, cache the resolved `fileHandle` in `handles`, write the current diagram immediately, and show status badge `Saved to <filename>` + brief confirmation toast (`Linked <folder> — diagrams inside will save directly.`).
  - **If the picked folder does not contain this file:** do **not** silently fail; show a clear toast (`<folder> does not contain <filename>. Pick a parent folder that contains this file.`) and keep edits marked unsaved.
  - **If Chrome/Edge blocks a system folder (`SecurityError`):** show a plain-English toast (`Browser blocks system folders (like Downloads or C:\). Pick a repo or project subfolder instead.`).

### 4. Status badge & page load awareness

- On page load (`file://` with `'showDirectoryPicker' in window`):
  - If a per-file handle exists in `handles`, keep existing `Saves to <filename>` badge.
  - Else if a stored linked folder already has `'granted'` permission in this browser session and matches the current path segment, optionally pre-resolve silently (read-only check, no prompt) so the badge shows `Saves to <filename>` immediately.
- Once saved via a linked folder, badge reads `Saved to <filename>` with tooltip `Saved straight to <filename>`.

### 5. Portability & constraints

- **Zero changes to `scripts/layout_engine.py` or disk format:** Works immediately on every diagram already generated on disk, keeps `assemble_page()` and `dev/samples/example-*.html` 100% deterministic, and leaves zero tokens or metadata in `.html` files.
- **No external dependencies, no background processes, no listening ports.**
- **Firefox / Safari:** `'showDirectoryPicker' in window` is `false`; existing download fallback is completely unchanged.
- **Playground / Claude Artifacts / `http://`:** Unaffected (`location.protocol !== 'file:'`).

## Phases

### Phase 1: IndexedDB v2 + folder resolution & identity verification (`assets/shell/shell.js`)
- Upgrade `handleDb()` to version 2 with `folders` store (preserving existing `handles`).
- Implement `storeFolderHandle()`, `readStoredFolders()`, `resolveFileInFolder(dir, loc, initialDataText)`, and `loadFromLinkedFolders(loc)` with Windows case-insensitive segment matching and nested-folder disambiguation.
- Capture `initialDataBlock` on initial page load before any user edits.

### Phase 2: First-save bubble UX (`assets/shell/shell.js`, `assets/components/popover.css`)
- Add `Link folder…` action to `askSaveLocation` when `'showDirectoryPicker' in window`.
- Write concise, plain-English copy explaining to pick a **top parent / repo folder** (not just the direct folder) so all child folders save directly in the future, plus clear handling for wrong-folder and Chrome-blocked system-folder errors.
- Check popover layout and contrast in both light and dark themes (invoke the global `motion` skill if any popover transition or layout animation changes).

### Phase 3: Rebuild samples & verification
- Rebuild `dev/samples/example-*.html` via `python3 dev/tools/build_examples.py` and verify with `--check`.
- Add E2E tests in `dev/tests/e2e/e2e_shell.mjs` (using stubbed `window.showDirectoryPicker` + in-memory `FileSystemDirectoryHandle` mock):
  - Linking a top parent folder resolves and saves a diagram in a deeply nested child subfolder (`repo/docs/arch/flow.html`) on the spot.
  - Opening a second, brand-new diagram in a different child subfolder (`repo/services/api/seq.html`) saves directly on first `Ctrl+S` with **no bubble and no file picker**.
  - Same-named folder mismatch (different `<script id="diagram-data">` content on disk) is **rejected** and never overwritten.
  - Picking a folder that does not contain the file shows a clear toast and keeps changes unsaved.
  - Browser `SecurityError` (system folder blocked) shows the plain-English toast without throwing.
  - First-save bubble explains picking a top parent folder for all child folders.
- Run `node dev/tests/run_e2e.mjs --only shell`, `check_tokens.py`, `check_contrast.py`, and light/dark theme checks.

## Not doing

- Local background HTTP servers, open localhost ports, or background daemons.
- Adding random tokens or machine-specific metadata to `.html` diagram files.
- Supporting `showDirectoryPicker` inside sandboxed IDE webviews or Firefox/Safari (they continue using existing fallbacks).
