# Implementation Plan: UI & Interaction Revisions (from `stg`)

Branch: `feat/ui-revisions` (branched from `origin/stg` at `3b619c4`)

---

## Findings & Direct Answers to Open Questions

1. **Why is C4's Tidy button different from other charts?**
   - All diagram types share `#btn-auto-tidy` from `assets/shell/shell.html`. Flowchart, ERD, Use Case, and Sequence treat it as a neutral one-shot action button.
   - C4 (`assets/types/c4/c4.js:2244-2246`) is the only type that sets `aria-pressed="true"` on `#btn-auto-tidy` whenever auto-tidy mode is active (`!chartData._manual`), which triggers `assets/components/toggle.css` and keeps the button permanently highlighted in blue.
   - C4's Add button (`#c4-pop`) lacks drag-and-drop simply because `c4.js:1193-1197` only wired `click` handlers and never wired the `pointerdown` palette-drag pattern used by Flowchart, ERD, and Use Case.

2. **Can ERD's "Identifying" button be automated?**
   - **Yes for column-linked relationships:** When a relationship has FK column(s) (`rel.columns`), it is identifying if and only if every FK column in `rel.columns` is also marked `pk: true` on the child table (the same rule already used in `scripts/audit_erd.py:241` and `assets/types/erd/mermaid.js:90-93`). We can auto-compute/sync `rel.identifying` whenever a relationship is created, reconnected, reversed, or when a column's PK flag is toggled.
   - **Trade-off / edge case:** Conceptual header-to-header relationships (no `rel.columns` linked yet) have no columns to inspect, so they will default to non-identifying (dashed) unless `identifying` is already set in imported JSON/Mermaid. Removing the manual button simplifies the action bar while keeping `identifying` in the disk format for backward compatibility.

3. **Does VS Code's Integrated Browser lack cached state (`localStorage`)?**
   - **Partially true — and saving in HTML is the right call.** VS Code's Integrated Browser does persist `localStorage` in `workspace`/`global` storage modes, **but** storage is cleared/in-memory in `ephemeral` mode and agent-opened tabs, and `file://` URLs have isolated/restricted `localStorage` across browsers. Storing the "Don't show again" flag in **both** `localStorage` and inside the saved HTML file (`<meta name="diagram-save-prompt" content="off">`) guarantees it persists everywhere.

---

## Phased Implementation Plan

### Phase 1 — Global Shell, Tokens & Shared Pickers
1. **Remove tooltips on icon picker and colour picker**
   - `assets/shell/shell.js`: Remove `b.title = ...` in `swatchRow()` (L76) and `trig.title = ...` in `swatchPicker()` (L112). Keep `aria-label` intact for accessibility.
   - `assets/types/c4/c4.js`: Remove `b.title = ...` on icon buttons in `openIcons()` (L1645) and remove hover tooltip on the Icon trigger button (L1778), keeping `aria-label`.
2. **Reduce UI chrome opacity slightly**
   - `assets/tokens/default.json`: Lower glass alpha tokens by ~0.10 in both themes (SSOT for docks, top pills, action bars, menus, popovers, search bar, flow tabs, C4 popovers):
     - Light: `glass-top` `0.62 -> 0.52`, `glass-bottom` `0.44 -> 0.34`, `glass-bg` `0.53 -> 0.43`, `confirm-top` `0.78 -> 0.68`, `confirm-bottom` `0.68 -> 0.58`.
     - Dark: `glass-top` `0.62 -> 0.52`, `glass-bottom` `0.46 -> 0.36`, `glass-bg` `0.54 -> 0.44`, `confirm-top` `0.80 -> 0.70`, `confirm-bottom` `0.70 -> 0.60`.
   - Verify contrast thresholds remain passing in `dev/tests/unit/` and inspect light + dark screenshots.
3. **Save button modal + HTML-persisted "Don't show again"**
   - `assets/shell/shell.js` & `assets/components/popover.css` (or modal styles in `assets/components/`):
     - Applies only to regular standalone HTML (`!claudeHost && !playground`) when Save falls back to the OS file browser / download (not when `saveViaLocalHelper()` or an existing `fileHandle` writes directly).
     - Copy the file path (`loc.file` on Windows/Linux, `loc.folder` on macOS, derived from `localFilePath()` when opened via `file://`) to clipboard immediately on Save click.
     - Check preference: skip modal if `localStorage` flag is set **or** `<meta name="diagram-save-prompt" content="off">` exists in `<head>`.
     - When not skipped, open a centered modal (using `--scrim-bg`) showing the copied path (if available), OS-appropriate paste instruction (`Ctrl+V` / `⌘V` into the OS file browser popup, overwrite existing file if prompted), a **"Don't show this again"** checkbox, and **Continue** / **Cancel** buttons.
     - If checked, save to `localStorage` (in `try/catch`) and stamp `<meta name="diagram-save-prompt" content="off">` in the DOM and in `buildSavedHtml()` so the saved HTML preserves the preference even without browser cache (recomputing `stampReadingGuide` after `<head>` updates).
     - On Continue (or when skipped), proceed directly to `pickSaveFile()` (Chromium) or `<a download>` (VS Code integrated browser / Firefox / Safari).

### Phase 2 — Flowchart
1. **Rename "Shapes" -> "Add" and move "Lane" inside with click + drag-to-add**
   - `assets/types/flowchart/toolbar.html`: Rename `#btn-add-shape` label/aria to `Add` (using `{{icon:plus}}` to match other charts). Move `#btn-add-lane` from the top-level dock into `#shape-pop` (under a dedicated section or Annotate/Structure).
   - `assets/types/flowchart/flowchart.js` & `flowchart.css`:
     - Keep click behavior on `#btn-add-lane` (adds a lane at the end, or re-enables swimlanes when hidden).
     - Add `pointerdown` drag-to-add on `#btn-add-lane` using the existing `body.palette-dragging` + `.palette-ghost` flow: show a lane ghost and insertion line/index between existing lanes, and insert the new lane at the dropped index on `pointerup` (with `dataset.dragged = '1'` to suppress trailing click).
2. **Truncated-only tooltips + full-length double-click edit box**
   - `assets/types/flowchart/flowchart.js`: Remove `label.dataset.noTip = ''` (L1282) and `nodeEl.dataset.noTip = ''` (L1273) / connector `noTip` (L923) so the shell's global truncated-text tooltip (`shell.js:1819-1829`) automatically shows a tooltip **only** when text overflows with `...`.
   - `assets/types/flowchart/flowchart.js` & `flowchart.css`:
     - On double-click edit of `.node-label`, add `.is-editing` to the `.flow-node` (and remove on commit/blur/Escape).
     - In CSS, unset `-webkit-line-clamp`, `display: -webkit-box`, and `overflow: hidden` on `.flow-node.is-editing .node-label` (and on `#swimlanes-container.dir-tb .lane-pill .lane-title[contenteditable="true"]` for TB lane titles), expand the editing box horizontally/vertically with `z-index: 40` and a clean edit frame so the full text is visible and editable without `...`.

### Phase 3 — C4
1. **Unify Tidy button with other charts**
   - `assets/types/c4/c4.js`: Remove `btnTidy.setAttribute('aria-pressed', ...)` from `updateModeUi()` (L2244-2246) so `#btn-auto-tidy` renders as a neutral one-shot action button like Flowchart, ERD, Use Case, and Sequence.
2. **Add drag-and-drop to C4's "Add" menu**
   - `assets/types/c4/c4.js` & `c4.css`:
     - Add `pointerdown` drag-to-add on all `#c4-pop` tiles (`person`, `system`, `external`, `group`, `container`, `database`, `queue`, and `note`), guarded by `btn.dataset.dragged` on click.
     - Render a `.c4-ghost` preview, toggle `body.palette-dragging`, hit-test canvas and group frames/tiles (reusing `.c4-drop`), and on drop create the item at the dropped point (or inside the dropped group).
3. **Remove hover grayout/dimming**
   - `assets/types/c4/c4.js`: In `applyState()` (L705-750), stop toggling `.is-dim` on unrelated nodes, tiles, edges, labels, and step badges on hover.
   - Instead, highlight only the hovered node/tile, its directly linked neighbor nodes/tiles (`.is-hover`), and its directly linked connections/labels (`.hl-in` / `.hl-out`).

### Phase 4 — ERD
1. **Tooltips only on truncated text + expanding inline edit box**
   - `assets/types/erd/erd.js`: Remove unconditional `name.title = erName(e)` (L366). Let the shell's global truncated-text handler (`shell.js:1819-1829`) attach tooltips to `.erd-name` and `.erd-col-name` **only** when truncated with `...`. Move/keep row-level key/note tooltips on their specific badges so hovering a normal column name shows no tooltip.
   - `assets/types/erd/erd.css` & `erd.js`: While editing (`.erd-entity:has(.is-editing)`), allow the entity card to expand (`width: max-content; min-width: <box.w>; z-index: 40`) and give `.erd-name.is-editing, .erd-col-name.is-editing` `flex: 0 0 auto` so long text expands cleanly without overlapping column types or the collapse chevron.
2. **Connection action bar: table names instead of "Child" / "Parent"**
   - `assets/types/erd/erd.js` (L1551, L1554) & `erd.css` (L242): Replace `'Child'` and `'Parent'` with `erName(erdEntity(rel.from))` and `erName(erdEntity(rel.to))`; remove `text-transform: uppercase` on `.erd-ab-tag` and cap width with ellipsis so long table names stay tidy.
3. **Automate "Identifying" and remove manual button**
   - `assets/types/erd/erd.js`:
     - Add helper `syncIdentifying(rel)` that sets `rel.identifying = true` iff `rel.columns?.length > 0` and every listed column on `from` has `pk === true` (and deletes `rel.identifying` otherwise when `rel.columns` is present).
     - Call `syncIdentifying` on relationship creation (`connectEntities`), reconnect (`handleDrag`), reverse (`reverseRelationship`), and PK toggle (`toggleFlag`).
     - Remove the `identifying` button from `drawSelectionTools()` (L1557-1558) and its click handler (L1650).
4. **Remove hover grayout/dimming**
   - `assets/types/erd/erd.js`: In `applyHighlight()` (L590-655), remove `.is-dim` toggling on unrelated `.erd-entity`, `.erd-rel`, and `.edge-label` elements. Keep `.rel-child` / `.rel-parent` / `.is-hover` on directly linked tables, `.key-hl` on joining columns, and `.hl-in` / `.hl-out` on directly linked connections.
5. **Toolbar: move Table & Note into "Add" button, remove Relationship button**
   - `assets/types/erd/toolbar.html`: Replace `#btn-add-table`, `#btn-add-relationship`, and `#btn-add-note` with a `[data-dock-pop]` `#btn-add` ("Add") popover containing Table and Note tiles (keeping existing click + drag-to-add handlers).
   - `assets/types/erd/erd.js` & `erd.css`: Remove `erdBtnAddRel`, `relArmed`, `setRelArmed()`, and `body.erd-armed` CSS.
6. **Keep colour key legend visible after changing table colour**
   - `assets/types/erd/erd.js`: In `drawKey()` (L1676-1688), pass all used colours (`erdKeyColors()`) with `{ prompts: true, cls: 'erd-key' }` instead of filtering out unnamed colours when `erdKeyDraft` clears on blur. That way the colour legend entry stays visible in edit mode as `"What does <Colour> mean?"` (and stays hidden in presentation/export via `colorkey.css:11`).

### Phase 5 — Use Case (UC)
1. **Auto-populated, editable colour key legend matching ERD**
   - `assets/types/usecase/usecase.js` & `usecase.css`:
     - Replace custom read-only `renderLegend()` (L598-618) with shared `ui.colorKey(ucKeyColors(), chartData.colorKey || {}, { prompts: true, cls: 'uc-key' })`.
     - `ucKeyColors()` collects distinct explicit `o.color` values (use cases and explicitly coloured actors, excluding auto-assigned `actorSlots()` defaults).
     - Wire click/dblclick/Enter/F2 inline editing on `.color-key-label` via UC's `beginEdit()` and `setKeyLabel(color, value)`.
     - Prune unused `colorKey` slots in `usecase.js:toDisk()` and `scripts/disk_format.py:usecase_to_disk()`.

### Phase 6 — Tests, Examples & Visual Verification
- Update/add unit and E2E tests for touched behaviors (toolbar selectors, ERD action bar, UC legend, save modal, C4 Tidy/Add drag, flowchart Lane drag/edit, contrast checks).
- Run `npm run test:fast:changed` during iteration.
- On user confirmation before PR/merge: run `npm run test:e2e:changed`, light/dark visual screenshot verification in headless Chrome, and `python3 dev/tools/build_examples.py && python3 dev/tools/build_examples.py --check`.
