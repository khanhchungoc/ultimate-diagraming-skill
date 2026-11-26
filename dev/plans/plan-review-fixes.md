# Plan: engineering review fixes (performance, tokens, WCAG AA)

Follow-up to the 2026-11-26 codebase review. Seven phases, in priority order. Keyboard access for diagram items (review item 3) is deliberately last.

Every phase is one PR to `stg`, with `npm run test:fast:changed` while iterating, and `npm run test:e2e:changed`, light/dark contrast, and `build_examples.py --check` before merge. Goldens (`check_golden.py`) must stay byte-identical unless a phase says otherwise: layout and routing are deterministic and the file format does not change in any phase.

| # | Phase | Size | Risk | Changes look? |
|---|---|---|---|---|
| 1 | Quick WCAG fixes | S | Low | Slightly (bigger hit areas only) |
| 2 | Arrow router speed | M | Medium | No (same routes) |
| 3 | Render path speed | M | Medium | No |
| 4 | Token gaps | L | Medium | Slightly (spacing snapped to grid) |
| 5 | Shared notes module | M | Medium | No |
| 6 | Smaller pages | S | Low | No |
| 7 | Keyboard access for items | L | Medium | Focus rings only |

## Phase 1: Quick WCAG fixes

1. Gantt splitter (`assets/types/gantt/stage.html:11`, `role="separator"` + `tabindex`): set `aria-valuenow`, `aria-valuemin`, `aria-valuemax` and update `aria-valuenow` on drag and keyboard resize.
2. Gantt tree (`#gantt-tree`, `role="tree"`): move the inline buttons (collapse, add subtask) inside `role="treeitem"` rows, or out of the tree's direct children, so the tree only owns tree items.
3. Target size (WCAG 2.5.8, 24×24 px): give small controls an invisible 24×24 hit area (padding or `::before`), visuals unchanged. Known offenders: flowchart `.note-badge` and `.sub-open` (10×10), C4 `.c4-port` (9×9), `.frame-chev` (12/16), `.c4-note-pin`, ERD `.erd-chevron` (21), Gantt `.gantt-chevron` (20), sequence `.seq-frag-focus` (18). Do it once in the shared component CSS (`badge.css`, `frame.css`) where the control is shared.
4. Toast announcements: one persistent `role="status"` live region in `shell.html`; `showToast` (`shell.js:2514`) writes the text there as well as showing the visual toast.
5. Windows High Contrast: add a `@media (forced-colors: active)` block in `shell.css` so arrows, outlines and focus rings use system colours (`CanvasText`, `Highlight`).

Tests: add the axe run (all six samples, light + dark, WCAG 2.2 AA tags) to e2e, failing on any violation; a target-size probe that fails under 24×24 for visible controls without enough spacing.

## Phase 2: Arrow router speed

Goal: 400 nodes from ~8.8 s to under 0.5 s per routing pass; drag stays smooth to at least 1,000 nodes.

1. Bench first: add `dev/bench/bench_router.mjs` (synthetic grids of 25/100/400/1,000 nodes, same as the review's measurement) and record a baseline.
2. Spatial index in `assets/shell/ortho-router.js`: bucket node rects into a uniform grid once per pass; `segmentClear` and similar scans test only rects in the cells the segment crosses. Iteration order must match the old loop wherever ties are broken, so routes stay identical (goldens prove it).
3. Incremental drag re-route (`flowchart.js` `onDragNodeMove`): during a drag, re-route only arrows attached to the moved node(s) plus arrows whose current path crosses the old or new box; full pass on drop. Node boxes during drag come from the data model, not `getBoundingClientRect` on every node.
4. Perf budget test in `dev/tests/unit`: fail if the 400-node bench exceeds a generous ceiling (catches regressions, not CPU noise).

Risk: a missed tie-break order changes routes. Mitigation: goldens plus a test that routes every fixture with old and new code and compares output.

## Phase 3: Render path speed

Flowchart first (largest), then apply the same pattern where the other types have it.

1. Build a `laneId -> lane element` map once per render instead of a page-wide `querySelector` per node (`renderNodes`, `flowchart.js:1258`).
2. Event delegation: one listener on the nodes layer and one on the edges layer, dispatching by `data-node-id` / `data-edge-id`, instead of new listeners per node and arrow on every render.
3. Keyed reuse: update existing node elements by id and only create or remove what changed. This also keeps element identity for the `morphRect` animations.
4. Batch DOM reads before writes in `render()` / `computeAllEdgeRoutes` so a frame forces at most one layout.

Check: `perf_motion.mjs` plus a 500-node fixture timing `render()`; e2e suites unchanged.

## Phase 4: Token gaps

1. **Spacing scale:** add `space` to `assets/tokens/default.json` on a 4 px grid with a 2 px half-step (`0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48`), emitted as `--space-*` by `scripts/tokens.py`. Migrate file by file (components, shell, then each type). Off-grid values (1, 3, 5, 7, 9, 10, 11, 14 px) snap to the nearest step; 1 px borders stay literal. Before/after light + dark screenshots per type.
2. **Base palette layer:** add a `primitive` colour group (the slate/blue/etc. shades in use) and point semantic colours at it (`bg-hover: primitive.slate-100`). Resolution already supports references (`resolve_colors`); contrast checks run on resolved values, so the pass/fail list does not move.
3. **Component tokens, limited:** only control height, control padding and dock inset (button, toggle, pill, dock), so a theme can resize controls. No per-component token for every property.
4. **One home for sizes:** flowchart `NODE_WIDTH/NODE_HEIGHT/DECISION_HEIGHT` (`flowchart.js:1-4`) read from the value the layout engine already exports, not a second copy of `144`.
5. **Glass contrast:** extend `check_contrast.py` to test `text-glass` over glass composited on the darkest palette fill, not only over `bg-panel`.
6. **CI strictness:** fix the 15 phase-2 findings (gantt.css, table.css, c4.css), then run `check_tokens.py --phase 4` in `run_unit.mjs`, and add a `spacing-literal` rule once step 1 is done.

Samples change visually in step 1, so `dev/samples/example-*.html` are regenerated and re-signed in that PR.

## Phase 5: Shared notes module

Notes logic is copied in c4, erd, flowchart, usecase and gantt (`commitNote`, `removeNote`, `renderNotes`, `notesList`, `selectNote`, `editNote`, `updateNotesButton`, `buildNoteCard`).

1. Extract `assets/shell/notes.js` with a small contract: the type supplies `anchorEl(note)`, `labelFor(note)`, `onChange()` and its render call; the module owns editing state, text cleanup, empty-note removal, fold animation and selection.
2. Migrate one type per commit (flowchart first, as the most complete), keeping each type's e2e notes tests green; `e2e_notes.mjs` covers all types.
3. Sequence uses a different notes model; leave it unless it fits the contract without special cases.

## Phase 6: Smaller pages

1. In `assemble_page` (`scripts/layout_engine.py`), strip whole-line `//` comments and leading indentation from bundled JS, and `/* */` comments from CSS. No minifier dependency. Skip template literals and strings (use a tokenizer that tracks quotes and backticks, not a regex).
2. Expected: about 0.9 MB to about 0.6 MB per page uncompressed.
3. Regenerate and re-sign samples; e2e suites run against the stripped pages.

## Phase 7 (lowest priority): Keyboard access for diagram items

1. One shared keyboard model in the shell: the diagram canvas is one Tab stop; arrow keys move between items (roving `tabindex`), Enter edits, Delete removes, Escape leaves, and Shift+arrows nudge the selected item (a keyboard alternative to dragging).
2. Each type supplies its item order (flowchart: flow order; sequence: participants then messages; ERD: tables then columns; usecase: actors then cases; gantt: bars in row order). C4 already reaches cards and arrows; align it to the shared model.
3. Visible focus ring from `--focus-ring` on every item; screen-reader label per item (reuse the existing `aria-label` text).
4. Update `ACCESSIBILITY.md` known limitations.
5. e2e: Tab into each sample, arrow through every item, edit and delete one by keyboard.
