# Plan: engineering review fixes (performance, tokens, WCAG AA)

Follow-up to the 2026-11-26 codebase review. Nine phases, in priority order. Keyboard access for diagram items (review item 3) is deliberately last.

Every phase is one PR to `stg`, with `npm run test:fast:changed` while iterating, and `npm run test:e2e:changed`, light/dark contrast, and `build_examples.py --check` before merge. Goldens (`check_golden.py`) must stay byte-identical unless a phase says otherwise: layout and routing are deterministic and the file format does not change in any phase.

## Progress and where to pick up (paused 2026-11-26)

Work paused for usage limits. Branch `ccr-fb499656-4hes42` is the integration branch; it is based on `stg` and holds everything below that is not yet on `stg`. To resume: start from that branch (not `stg`), read this section, then `git apply dev/plans/wip/wave-c-<type>.patch` for the type being finished.

### Done

| Item | Where | Notes |
|---|---|---|
| Wave A: Phase 1 (WCAG quick fixes), Phase 2 steps 1, 2, 4 (router grid index, bench, perf test), Phase 4 steps 2, 4, 5, 6 + `space` and interaction token definitions, Phase 7 (smaller pages) | `stg` (PR #155) | 400-node routing ~5.3 s to ~0.45 s, pages 20-29% smaller |
| 9 stale goldens refreshed (C4 #113, flowchart 88c41fd) | `stg` (PR #156) | golden 60/60 |
| Wave B1: Phase 2 step 3 + Phase 3 for flowchart (keyed reuse, delegation, incremental drag re-route) and ERD element index | integration branch | 500 steps: render ~225 ms to ~112 ms, drag move ~60 ms to ~12 ms |
| Wave B2: Phase 5 for all six types, flowchart included (shared chevron, port, edge label, item states, state names, `dev/docs/ui-elements.md`, `check_components.py`, gallery `dev/playground/components.html`, `e2e_components.mjs`) | integration branch | port is 12 px outer; a side port's 24 px target runs outward only; shell sets `body.is-touch` |
| Wave B3: Phase 6 shared notes controller for all six types (flowchart, usecase, erd, c4, gantt + anchorEl fold, sequence + optional `beforeEdit`/`selectAll` hooks) | integration branch | `assets/shell/notes.js` |
| Wave C: Phase 3 render reuse & event delegation for c4, usecase, gantt (timeline + table), sequence | integration branch | `dev/plans/wip/` removed; reuse + delegation checks added to each type's e2e |
| Phone check `dev/tests/e2e/e2e_device.mjs` (registered as `device`) | integration branch | all 6 types green (including gantt + sequence note fold morphs) |
| Harness rule for shared UI elements | `ultimate-harness` `main` (PR #17, merged) | points at files that reach `stg` with the integration branch PR |

### Remaining, in order

1. Run full unit + e2e suites, rebuild and verify samples (`build_examples.py`), and open the integration branch PR to `stg` (Waves B and C).
2. Investigate the known Gantt issue below (opens scrolled to 2022 below ~1,280 px wide).
3. Phase 4 step 1 (migrate every CSS file to `--space-*`, add a `spacing-literal` rule) and step 3 (control height, padding and dock inset tokens): not started.
4. Phase 9 (phone toolbar More menu): planned, agree the fold order with the user first.
5. Phase 8 (keyboard access): lowest priority, not started.

| # | Phase | Size | Risk | Changes look? |
|---|---|---|---|---|
| 1 | Quick WCAG fixes | S | Low | Slightly (bigger hit areas only) |
| 2 | Arrow router speed | M | Medium | No (same routes) |
| 3 | Render path speed | M | Medium | No |
| 4 | Token gaps | L | Medium | Slightly (spacing snapped to grid) |
| 5 | Shared UI elements across types | L | Medium | Yes (types converge on one look) |
| 6 | Shared notes module | M | Medium | No |
| 7 | Smaller pages | S | Low | No |
| 9 | Phone toolbar: overflow into More (before Phase 8) | M | Low | Yes (on narrow screens only) |
| 8 | Keyboard access for items | L | Medium | Focus rings only |

## Phase 1: Quick WCAG fixes

1. Gantt splitter (`assets/types/gantt/stage.html:11`, `role="separator"` + `tabindex`): set `aria-valuenow`, `aria-valuemin`, `aria-valuemax` and update `aria-valuenow` on drag and keyboard resize.
2. Gantt tree (`#gantt-tree`, `role="tree"`): move the inline buttons (collapse, add subtask) inside `role="treeitem"` rows, or out of the tree's direct children, so the tree only owns tree items.
3. Target size (WCAG 2.5.8, 24×24 px): give small controls an invisible 24×24 hit area (padding or `::before`), visuals unchanged. Known offenders (the per-type ones are fixed in place here and folded into shared components in Phase 5): flowchart `.note-badge` and `.sub-open` (10×10), C4 `.c4-port` (9×9), `.frame-chev` (12/16), `.c4-note-pin`, ERD `.erd-chevron` (21), Gantt `.gantt-chevron` (20), sequence `.seq-frag-focus` (18). Do it once in the shared component CSS (`badge.css`, `frame.css`) where the control is shared.
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

## Phase 5: Shared UI elements across types

Goal: the same element looks and behaves the same in every diagram type, is defined once in `assets/components` + `assets/shell`, and a new type gets it by using the shared class or `ui.*` call, not by restyling it.

Drift found (2026-11-26):

| Element | Today | Differences |
|---|---|---|
| Collapse chevron | `.frame-chev` (frame.css, 16 px), `.erd-chevron` (22 px), `.gantt-chevron` (20 px) | Size, corner radius, hover (background vs opacity vs colour), animation speed |
| Connection port / handle | flowchart `.port-*`, `.erd-port` + `.erd-handle`, `.c4-port`, `.gantt-port-l/r` | Four builds of one idea; size, hover grow, touch size, hide-while-dragging rules |
| Edge label pill | `edge.css` base, then overridden in `flowchart.css:158` and `erd.css:45` | Text size (label vs detail), wrapping vs single line with ellipsis, padding |
| Selected item | `stroke-width` 2, 2px, 2.5px, 3, `--ring-md`; `--shadow-ring` vs `border-color` | Ring thickness and style vary by type |
| Item hover | usecase border + shadow, c4 inset ring + shadow, erd shadow only, flowchart and sequence none | No common hover |
| Inline text editing | `.is-editing` (47 uses) vs `.editing` (9 uses) | Two state names for one state |

Steps:

1. **Element inventory (the global definition):** add `dev/docs/ui-elements.md` listing each shared element: its class or `ui.*` call, states (`rest`, `hover`, `selected`, `is-editing`, `is-collapsed`, `is-dim`, `disabled`), tokens used, minimum hit area, and which types use it. `SKILL.md` and `CONTRIBUTING.md` link to it from the "new diagram type" checklist.
2. **State naming convention:** one name per state across all types: `.selected`, `.is-editing`, `.is-collapsed`, `.is-dim`, `.is-dragging`. Rename the 9 `.editing` uses.
3. **Component tokens for interaction** (extends Phase 4 step 3): `--select-ring-w`, `--hover-shadow`, `--chevron-size`, `--port-size`, `--port-size-touch`, `--hit-min` (24 px). Types read these; none set their own.
4. **Shared components** (CSS in `assets/components`, markup factory in the `ui` object in `shell.js`):
   - `chevron.css` + `ui.chevron({ expanded, label })`: one collapse toggle with `aria-expanded`, 24 px hit area, one hover, one rotation. Replaces `.frame-chev`, `.erd-chevron`, `.gantt-chevron`.
   - `port.css` + `ui.port(side)`: one connection handle, shared show/hide rules (hover, selected on touch, hidden while dragging, exporting, presenting). Replaces the four builds.
   - `edge.css`: own the full edge label, with two modifiers only: `.edge-label--wrap` (flowchart) and `.edge-label--single` (ERD). Type CSS keeps position only.
   - `item-states.css`: shared hover, selected and dim styling for HTML items (`[data-item]`) and SVG items (`.item-shape`), so every type gets the same rings.
5. **Pick one look per element:** for each element, the most complete existing version is the base (proposed: frame chevron behaviour at ERD size, C4 port behaviour, flowchart label pill). Before/after light + dark screenshots of every type for sign-off before migrating.
6. **Migrate one type per commit**, deleting the type's own copy in the same commit. Type CSS may only position or size shared elements, not restyle them.
7. **Guard against new drift:** extend `check_tokens.py` (or add `check_components.py` to `run_unit.mjs`) to fail when type CSS declares a selector for a shared element concept (`*-chevron`, `*-port`, `*-handle`, `.edge-label` styling beyond position) or uses a state name outside the convention. Exceptions need a `components-ok: <reason>` comment.
8. **Component gallery:** a `dev/playground/components.html` page built from the shared CSS and `ui.*` calls showing every element in every state, light and dark, and an e2e screenshot of it. This is the reference a new type is checked against.
9. **New-type contract:** the type slice checklist in the project rules gains "uses shared elements from `dev/docs/ui-elements.md`; no type-specific copies".

Samples change visually, so `dev/samples/example-*.html` are regenerated and re-signed in this phase.

## Phase 6: Shared notes module

Notes logic is copied in c4, erd, flowchart, usecase and gantt (`commitNote`, `removeNote`, `renderNotes`, `notesList`, `selectNote`, `editNote`, `updateNotesButton`, `buildNoteCard`).

1. Extract `assets/shell/notes.js` with a small contract: the type supplies `anchorEl(note)`, `labelFor(note)`, `onChange()` and its render call; the module owns editing state, text cleanup, empty-note removal, fold animation and selection.
2. Migrate one type per commit (flowchart first, as the most complete), keeping each type's e2e notes tests green; `e2e_notes.mjs` covers all types.
3. Sequence uses a different notes model; leave it unless it fits the contract without special cases.

## Phase 7: Smaller pages

1. In `assemble_page` (`scripts/layout_engine.py`), strip whole-line `//` comments and leading indentation from bundled JS, and `/* */` comments from CSS. No minifier dependency. Skip template literals and strings (use a tokenizer that tracks quotes and backticks, not a regex).
2. Expected: about 0.9 MB to about 0.6 MB per page uncompressed.
3. Regenerate and re-sign samples; e2e suites run against the stripped pages.

## Phase 9 (runs before Phase 8): Phone toolbar overflows into a More menu

Found by `dev/tests/e2e/e2e_device.mjs` checks (2026-11-26): the bottom dock is wider than the screen on phones, so its last buttons are cut off. Measured dock width vs screen: Gantt 521 px on every phone (320, 390, 412 px wide); ERD 387 px at 390 px and below; sequence 344 px at 320 px. Flowchart, usecase and c4 fit. The dock must not scroll sideways (`dock.css`: overflow would clip the popovers that open above it), so buttons that do not fit fold into a More menu.

1. **One shared mechanism in the shell, not per type:** a `More` button at the dock's end (reuse the header's `#btn-more` / `.menu` pattern and `ui` factory style) that appears only when the dock would overflow. Measure with a `ResizeObserver` on the dock (no fixed breakpoints): while the dock is wider than its space, move the lowest-priority buttons into the menu, last first; move them back when there is room.
2. **Priority per button, declared in each type's `toolbar.html`** (for example `data-dock-priority="1..9"`, lower stays longest). Primary actions (Add menu, Notes, Auto-Tidy, Undo/Redo zone) never fold. Proposed fold order: Gantt Legend, Weekends, Holidays, Today, view filter, dependencies; ERD Auto-Tidy label, Types, Columns; sequence Lifespans, Details, Numbers. Final order agreed with the user before implementing.
3. **A folded button keeps working:** the menu item calls the same button (`.click()` on the original, which stays in the DOM, hidden), keeps its label, icon, pressed state (`aria-pressed` / `aria-checked` on the menu item) and disabled state. A toggle's state change updates both.
4. **Accessibility:** menu `role="menu"`, items `menuitem` / `menuitemcheckbox`, arrow-key navigation and Escape like the header menu; 24 px targets; focus returns to More on close.
5. **Motion:** opening morphs from the More button (as the header menu does), never a fade.
6. **Tests:** extend `e2e_device.mjs` to assert no dock child is outside the screen for every type at 320, 390 and 412 px, that every folded action works from More, and that toggles show their state; add the More button to the components gallery and `dev/docs/ui-elements.md`.

Not implemented yet (user decision 2026-11-26: use a More menu, plan only).

## Known issues found during Wave C (not yet planned)

- **Gantt opens at the wrong place below about 1,280 px wide** (desktop and touch, already on `stg`): the example roadmap opens scrolled to 2022 with every bar off-screen. Setting the timeline's `scrollLeft` from a script also snaps back, so the cause is probably in how Gantt anchors its timeline scroll. Investigate after the Wave C Gantt stream lands.
- **Gantt never animated note removal** (already on `stg`): being fixed in the Wave C Gantt stream (pass `anchorEl` to the shared notes controller).
- **Sequence restores an emptied note's old text** instead of removing it like the other types: changes with the Wave C sequence notes migration.

## Phase 8 (lowest priority): Keyboard access for diagram items

1. One shared keyboard model in the shell, built on the Phase 5 item states: the diagram canvas is one Tab stop; arrow keys move between items (roving `tabindex`), Enter edits, Delete removes, Escape leaves, and Shift+arrows nudge the selected item (a keyboard alternative to dragging).
2. Each type supplies its item order (flowchart: flow order; sequence: participants then messages; ERD: tables then columns; usecase: actors then cases; gantt: bars in row order). C4 already reaches cards and arrows; align it to the shared model.
3. Visible focus ring from `--focus-ring` on every item; screen-reader label per item (reuse the existing `aria-label` text).
4. Update `ACCESSIBILITY.md` known limitations.
5. e2e: Tab into each sample, arrow through every item, edit and delete one by keyboard.

## Parallel delivery

The phases above are in priority order. Several can run at the same time because they touch different files. The waves below are the delivery order; each stream is one branch from the latest `origin/stg` and one PR.

**Main agent only (never given to a stream):** `dev/tests/run_unit.mjs`, `dev/tests/run_e2e.mjs`, `SKILL.md`, `README.md`, `ACCESSIBILITY.md`, `CONTRIBUTING.md`, and `dev/samples/example-*.html`. Streams list the tests or docs lines they need; the main agent adds them, then regenerates and re-signs the samples once per wave (`build_examples.py`), so streams never conflict on generated pages.

| Wave | Stream | Scope | Files it owns |
|---|---|---|---|
| A | A1 Accessibility quick fixes | Phase 1 except collapse arrows and connection handles (those move to B2) | `gantt/stage.html`, `gantt/table.js`, toast in `shell.js` + `shell.html`, forced-colors block in `shell.css`, hit areas in `badge.css`, `note.css`, `sequence.css`, `c4.css` (note pin only), new axe + target-size e2e |
| A | A2 Router index | Phase 2 steps 1, 2, 4 | `assets/shell/ortho-router.js`, `dev/bench/bench_router.mjs`, new unit perf test |
| A | A3 Token groundwork | Phase 4 steps 2, 4, 5, 6, plus the definitions (not the migration) of the `space` scale and the Phase 5 step 3 interaction tokens | `assets/tokens/default.json`, `scripts/tokens.py`, `check_tokens.py`, `check_contrast.py`, the 15 findings in `gantt.css`, `table.css`, `c4.css`, `flowchart.js` lines 1-4 |
| A | A4 Smaller pages | Phase 7 | `scripts/layout_engine.py` (`assemble_page`) and its unit test |
| B | B1 Drag and render speed | Phase 2 step 3 + Phase 3 | `flowchart.js` render and drag functions, then the same pattern in the other types' render functions |
| B | B2 Shared UI elements | Phase 5, plus Phase 1 hit areas for collapse arrows and handles | `assets/components/*` (new `chevron.css`, `port.css`, `item-states.css`, `edge.css`), the `ui` object in `shell.js`, type CSS, the chevron/port markup in type JS, `dev/docs/ui-elements.md`, gallery page, drift checker |
| B | B3 Shared notes module | Phase 6 | new `assets/shell/notes.js`, the notes functions in each type's JS |
| C | C1 Spacing migration | Phase 4 step 1 (migrate every CSS file to `--space-*`) | all CSS files |
| C | C2 Keyboard access | Phase 8 | new `assets/shell/keyboard.js`, new `assets/components/focus.css`, key handling in type JS |

Why this order:

- **Wave A (4 streams)** share no files. A2 must keep routes identical, so it is safe next to anything.
- **Wave B waits for A3** (B2 uses the interaction tokens) **and A2** (B1's drag re-route uses the router index).
- **B1 and B2 both touch `flowchart.js` `renderNodes`** (connection handles are built there, `flowchart.js:1318`). B2 migrates the other five types first and flowchart last, after B1 merges.
- **B3 touches only the notes functions** in each type's JS, a different region from B1 and B2. A merge with no line conflicts is expected; the main agent resolves any that appear.
- **Spacing migration (C1) runs after B2**, because B2 deletes many per-type CSS rules; migrating them first would be wasted work.
- **Keyboard access (C2) runs last** (lowest priority). It builds on B2's item states and B1's single click handler per layer. Its CSS goes in a new file, so it can run alongside C1.

Each stream follows the project's subagent rules: leaf workers only (no further subagents), disjoint files, interface pinned in the prompt (class names, token names, `ui.*` signatures from this plan), and the main agent reviews every change and runs the wave's e2e suite before merging.
