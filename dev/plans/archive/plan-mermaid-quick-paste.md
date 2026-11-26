# Plan: Quick Paste Mermaid (Canvas & Playground)

Status: completed (2026-11-26) · Branch: `feat/mermaid-quick-paste` (from `origin/stg`)

## Goal

Let users press **Ctrl+V / Cmd+V** anywhere on the canvas to quickly paste a Mermaid diagram without opening the Import dialog:

1. **Single-diagram canvas:** Detect the pasted Mermaid diagram type.
   - **Matches the current page's diagram type:** Validate it, then show a confirmation popup before overriding the diagram (still undoable with **Ctrl+Z**).
   - **Wrong diagram type, unsupported Mermaid type, or invalid syntax:** Show a clear warning and leave the current diagram untouched.
2. **Playground:** Same confirmation flow, except it **automatically detects** which supported diagram type was pasted and switches to that diagram type's page before applying the pasted Mermaid.

---

## Current state & gaps found in `origin/stg`

- `assets/shell/shell.js` already has a `window.addEventListener('paste', ...)` handler (lines 3110–3135) and `mermaidTypeOf(text)` (lines 2997–3006), **but**:
  1. **No confirmation on canvas paste:** Pasting matching Mermaid immediately overwrites the diagram without asking.
  2. **`gantt` is missing from `MERMAID_TYPE_NAME` and `mermaidTypeOf`:** Even though `assets/types/gantt/mermaid.js` is wired into `gantt.js`, pasting a `gantt` diagram is ignored by `mermaidTypeOf`.
  3. **No auto-detect switching in playground:** Each playground diagram type is a separate sub-page (`flowchart/index.html`, `erd/index.html`, `sequence/index.html`, `usecase/index.html`, `c4/index.html`, `gantt/index.html`) that only loads its own type's parser. Pasting another type in the playground currently fails with a "wrong type" toast instead of switching to that type.
  4. **Markdown code fences & unsupported Mermaid types:** Pasting a fenced block (```` ```mermaid ... ``` ````) from AI chat or docs is not unwrapped, and pasting an unsupported Mermaid type (such as `classDiagram`, `stateDiagram`, `pie`, `mindmap`, `gitGraph`) is silently ignored instead of showing a warning.
  5. **Centered confirm popup positioning:** `ui.confirm(null, ...)` currently places the popup's left edge at `innerWidth / 2` instead of centering it horizontally (`innerWidth / 2 - bw / 2`).

---

## Design

### 1. Unified Mermaid detection (`detectMermaid(text)`)

Replace `mermaidTypeOf(text)` in `assets/shell/shell.js` with a small pure helper `detectMermaid(text)` (and export/share the logic so unit tests can cover it directly):

- **Fence unwrapping:** If the pasted text is wrapped in a single Markdown code fence (```` ```mermaid ```` or ```` ``` ```` ... ```` ``` ````), strip the outer fence lines.
- **Front-matter & comments:** Skip optional YAML front-matter (`--- ... ---`) and leading `%%` comment lines, then inspect the first content line.
- **Supported types (all 6 in `SUPPORTED_TYPES`):**
  - `flowchart` / `graph` → `'usecase'` if `%% @type usecase` directive is present, otherwise `'flowchart'`
  - `sequenceDiagram` → `'sequence'`
  - `erDiagram` → `'erd'`
  - `C4Context` / `C4Container` / `C4Component` → `'c4'`
  - `gantt` → `'gantt'`
- **Known unsupported Mermaid headers:** `C4Dynamic`, `C4Deployment`, `classDiagram`, `stateDiagram`, `stateDiagram-v2`, `pie`, `mindmap`, `timeline`, `gitGraph`, `journey`, `quadrantChart`, `requirementDiagram`, `sankey-beta`, `xychart-beta`, `block-beta`, `packet-beta`, `kanban`, `architecture-beta` → return `{ kind: '', unsupported: <header>, text }`.
- **Ordinary non-Mermaid text** (URLs, prose, JSON, code) → return `{ kind: '', unsupported: '', text }` so the paste handler ignores it silently without interrupting normal clipboard use.
- Update `MERMAID_TYPE_NAME` to include `gantt: 'Gantt chart'` alongside the existing 5 types.

### 2. Single-diagram canvas quick paste (`!playground`)

Inside `window.addEventListener('paste', ...)` (still skipped in presentation mode and when focus is inside an `<input>`, `<textarea>`, or `contentEditable` element):

1. Run `detectMermaid(clipboardText)`. If neither `kind` nor `unsupported`, return immediately (do not call `e.preventDefault()`).
2. Call `e.preventDefault()`.
3. **Unsupported Mermaid type:** Show a dismissible warning popup (`ui.confirm` with a single `OK` button, Escape/outside-click dismissible), e.g. *"Mermaid classDiagram diagrams are not supported yet."* Do not change the diagram.
4. **Wrong diagram type (`kind !== plugin.id`):** Show a dismissible warning popup naming both types, e.g. *"This is an ER diagram, not a flowchart. Open an ER diagram page to paste it."* Do not change the diagram.
5. **Matching diagram type (`kind === plugin.id`):**
   - **Dry-run parse first:** Call `plugin.fromMermaid(cleanText)` before opening the popup. Because `fromMermaid` is pure and deterministic, syntax errors are caught immediately and shown in a dismissible warning popup rather than failing after the user clicks Replace.
   - **Confirmation popup (`ui.confirm`):** Show a centered confirmation dialog:
     - Title: `Replace diagram with pasted Mermaid?`
     - Message: `This replaces the current <type name> and lays it out fresh. You can undo with Ctrl+Z.` (with `Cmd+Z` on macOS).
     - Buttons: `Cancel` (focused by default for safety) and `Replace` (`btn-primary`).
   - **On confirm:** Apply the pre-parsed result via a shared `applyImportedMermaid(res)` helper (one undo step, re-render, fit view), then flash `"Imported Mermaid"` or open the existing `"Imported, with notes"` dialog if `res.warnings` / `res.infos` are non-empty.
   - **On Cancel / Escape / outside click:** Close the popup and leave the diagram untouched.

### 3. Playground quick paste (`playground` mode)

Because each playground type lives on its own sub-page (`../<type>/index.html`), the playground handles both same-type and cross-type pastes:

1. **Unsupported Mermaid type:** Same dismissible warning popup as single-diagram canvas; no navigation.
2. **Same type (`kind === plugin.id`):** Exact same dry-run parse + confirmation popup + in-place override as single-diagram canvas.
3. **Different supported type (`kind !== plugin.id` and `kind` exists in `playground.types`):**
   - **Confirmation popup (`ui.confirm`):**
     - Title: `Switch to <Target Name> and paste?`
     - Message (clean canvas): `Detected a <target name>. Switch to <Target Name> and replace the diagram with the pasted Mermaid?`
     - Message (unsaved edits): `Detected a <target name>. Your edits to this <current name> will be lost unless you save.` — includes the `Save` secondary button (`opts.alt`), matching the existing playground type-switcher dialog.
     - Primary button: `Switch & Replace` (`btn-primary`).
   - **Cross-page handoff on confirm:**
     - Save `{ type: kind, text: cleanText }` using a tiny `savePendingMermaidPaste` / `takePendingMermaidPaste` helper:
       - Primary store: `sessionStorage` key `'ud-pending-mermaid-paste'` (fast, ~5 MB limit, no URL pollution).
       - Fallback when `sessionStorage` is blocked (e.g. sandboxed artifact iframe): `window.name` prefixed with `'ud-paste:'` (only if `window.name !== 'present'`, and cleared back to `''` immediately after reading).
     - Navigate via the existing `goTo(kind)` (`../<kind>/index.html?theme=<theme>`).
   - **Auto-import on arrival:**
     - During `boot()` in `assets/shell/shell.js`, right after the initial starter `plugin.render()` and `committedJson = savedJson = ...` snapshot (so Undo still works and the unsaved badge reflects the pasted diagram), call `takePendingMermaidPaste(playground.type)`.
     - If a payload matches `playground.type`, run `importMermaid(payload.text)` before `diagramSettled = '1'` is set (so fonts re-measure and fit cleanly with no starter flash).
     - After `diagramSettled = '1'`, show `"Imported Mermaid"` status flash or the `"Imported, with notes"` dialog if there are warnings/infos; if `fromMermaid` throws a syntax error on arrival, show a dismissible warning popup and keep the starter diagram.
4. **Header "Paste Mermaid" dialog (`#btn-import-mermaid`) in playground:**
   - Reuse the same cross-type switch helper when a user pastes a different supported type into the manual Import textarea in playground mode, so both paste entry points behave consistently.

### 4. UI & Motion details

- **Reuse existing components** (`AGENTS.md` SSOT & DRY):
  - Confirmation and warning popups: reuse `ui.confirm` (`assets/shell/shell.js` + `assets/components/popover.css`). Fix horizontal centering when `anchor === null` (`left = clamp(innerWidth / 2 - bw / 2)`), and support single-button alert mode (`noCancel: true`) for dismissible warning popups so Escape, OK, or clicking outside dismisses cleanly.
  - Motion: `ui.confirm` already uses the repo's spring/clip-path transitions (`curve-spring-tactile`, `motion.ghostExit`), matching the **morph, not fade** rule.
- **Keyboard help (`assets/shell/help.html`):** Add a row under Canvas: `Paste Mermaid` → `Ctrl+V`.

---

## Implementation phases

### Phase 1 — Detection, shared helpers, and confirm/warning popup support
- `assets/shell/shell.js`:
  - Add `gantt: 'Gantt chart'` to `MERMAID_TYPE_NAME`.
  - Add `stripMermaidFence(text)` and `detectMermaid(text)` covering all 6 supported types + known unsupported Mermaid headers.
  - Extract `applyImportedMermaid(res)` from `importMermaid(text)` so dry-run parsing (`plugin.fromMermaid`) does not parse twice on confirm.
  - Fix `ui.confirm(null, ...)` horizontal centering and add `noCancel` support for single-button dismissible warning popups (`showMermaidWarning(title, message)`).
- `assets/shell/help.html`:
  - Add `Paste Mermaid` (`Ctrl+V`) shortcut entry.

### Phase 2 — Canvas quick paste confirmation & warnings
- `assets/shell/shell.js`:
  - Update `window.addEventListener('paste', ...)` to:
    - Ignore non-Mermaid text.
    - Show dismissible warning popup on unsupported Mermaid type, wrong type (non-playground), or syntax error.
    - Show `ui.confirm` on valid same-type Mermaid; apply on confirm, do nothing on cancel.

### Phase 3 — Playground auto-detect & cross-type handoff
- `assets/shell/shell.js`:
  - Expose `goTo` (or a small playground helper) to the Mermaid import/paste section.
  - Add `savePendingMermaidPaste` / `takePendingMermaidPaste` (`sessionStorage` with `window.name` fallback, preserving `window.name === 'present'`).
  - Handle cross-type paste in `window.addEventListener('paste', ...)` and `#btn-import-mermaid` when `playground` is active.
  - Consume and apply pending paste during `boot()` on the target playground page, surfacing notes or a dismissible warning popup on parse error after settle.

### Phase 4 — Tests & verification
- **Unit tests:**
  - Add pure unit checks for `detectMermaid`: all 6 supported types (including `usecase` via `%% @type usecase`, `gantt`, `C4Context`/`C4Container`/`C4Component`), fenced blocks, YAML front-matter, unsupported Mermaid headers (`classDiagram`, `stateDiagram-v2`, `C4Dynamic`, `pie`), and ordinary non-Mermaid text.
- **E2E tests:**
  - Update `dev/tests/e2e/e2e_mermaid.mjs`:
    - Canvas paste opens confirmation popup; Cancel keeps diagram unchanged; Replace overrides as one undo step.
    - Wrong-type canvas paste shows dismissible warning popup and leaves diagram unchanged.
    - Invalid syntax canvas paste shows dismissible warning popup without opening a Replace confirm.
    - Unsupported Mermaid type (e.g. `classDiagram`) shows dismissible warning popup.
    - Include `gantt` in paste/type checks.
  - Update `dev/tests/e2e/e2e_playground.mjs`:
    - Same-type paste in playground → confirm popup → Replace overrides in place.
    - Cross-type paste in playground (e.g. flowchart → ERD, ERD → Gantt, Gantt → Sequence) → confirm popup names detected type → Cancel stays on current page → Confirm navigates and renders the pasted diagram.
    - Cross-type paste with unsaved edits → confirm popup offers `Save` button alongside `Switch & Replace` and `Cancel`.
    - Manual `Paste Mermaid` dialog in playground with another type → offers to switch and imports on arrival.
    - Unsupported Mermaid type in playground → dismissible warning popup, stays on page.
- **Build & visual checks (before final sign-off):**
  - `npm run test:fast:changed` during iteration, plus targeted E2E (`e2e_mermaid`, `e2e_playground`).
  - On confirmation before PR/merge: `npm run test:e2e:changed` (or `npm run test:e2e`), `python3 dev/tools/build_examples.py && python3 dev/tools/build_examples.py --check`, and light/dark visual check via `dev/tools/capture_review.mjs`.

---

## Out of scope

- Live side-by-side Mermaid code editor panel.
- Partial paste / merging pasted nodes into an existing diagram (paste always replaces the full diagram, undoable in one step).
- Adding parsers for unsupported Mermaid types (`classDiagram`, `stateDiagram`, `pie`, etc.).

---

## Confirmed decisions

1. **Warning presentation:** Dismissible popup (`ui.confirm` with single `OK` button, Escape / outside-click dismissible).
2. **Manual "Paste Mermaid" button in playground:** Yes — auto-detects and offers to switch diagram types, matching canvas quick paste.
