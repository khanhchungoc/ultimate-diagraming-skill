# Plan: ERD layout v2 — a free, two-dimensional layout with group containers

The ERD type (merged in #3, plan in [archive/plan-erd.md](archive/plan-erd.md)) reused the flowchart's layout model: parent tables ranked into columns along a flow, and subject areas as full-width swimlane bands. A schema is not a flow. ERD tools lay tables out in two dimensions, compactly, with the most referenced tables in the middle, and draw subject areas as boxes that fit their tables. This plan replaces the placement part of `engine.js` and the band parts of the page with that model. The router, the renderer of tables and lines, the audit's checks and the editing of tables, columns, relationships and notes stay.

**Status:** implemented 2026-11-14 (waves A and B), D1–D10 as approved. Deviations:
- Group origins (`groups[].x/y`) are saved in the `layout` map next to the group-relative table positions (D5 needed an anchor).
- Spacing widened after review (cell gaps 112 × 64, group gap 88, group padding 32); saas-billing density target lowered to 22% and fit zoom to 40% (met: 27%, 54%).
- Placement adds row alignment between neighbouring columns (fewer bends) and picks among several routed candidates; groups of ≤ 5 are packed by trying every order.
- Dragging a group with Auto-Tidy on moves it and pushes overlaps aside instead of re-packing; the next structural edit re-packs.
- Overview line widths use a CSS scale variable instead of `vector-effect: non-scaling-stroke`; the detail-invariance check in `check_golden.py` compares group membership, not cell assignment.
- `routeDiagram` rounds positions to whole pixels (fractional positions made the router hang).
- Open after review: group boxes may be replaced by per-table colours with a colour key (an ungrouped layout of saas-billing fits at 66% with 1 crossing); the key peeks of related tables can sit under the expanded card in the overview.

## Why: how ERD tools do it, and what ours does

| | ERD tools (dbdiagram.io, ChartDB, DbSchema, DBeaver, yFiles orthogonal layout for database schemas) | Ours (v1) |
|---|---|---|
| Shape | Compact, roughly square or screen-shaped | Rank columns along a flow: wide or tall strips |
| Placement | Hub tables central, the tables that reference them around them on every side | Parents first: the hubs sit at the far left, and every reference travels to that edge |
| Groups | Containers that fit their tables (ChartDB Areas move with their tables; DbSchema "Group and Arrange" keeps a group together), packed side by side | Bands that span the whole canvas, mostly empty tint |
| Direction | None: a relationship has no reading order | `LR` / `TB`, meaningless for a schema |
| Lines | Short, few bends, few crossings (the goals the orthogonal layout literature optimises) | Long trunks between bands |

Baseline measured on the current engine (view 1760 × 856 px, the page's Fit area on a 1080p screen; "density" = table area / canvas area):

| Fixture | Canvas | Aspect | Fit zoom | Crossings | Line length | Bends | Density |
|---|---|---|---|---|---|---|---|
| `example-erd` (8 tables, 2 areas) | 1308 × 625 | 2.09 | 100% | 0 | 2,751 | 20 | 29% |
| `saas-billing` (30 tables, 4 areas) | 2226 × 2880 | 1.29 | 29% | 4 | 27,981 | 190 | 15% |
| `four-areas-wide` (12 tables, 4 areas) | 3376 × 914 | 3.69 | 52% | 0 | 2,158 | 6 | 8% |

## Goals and acceptance

All measured by a new `dev/erd_layout_metrics.py` on the engine output (same definitions as the baseline), and printed by `check_golden.py` for ERD fixtures.

| Fixture | Target |
|---|---|
| `saas-billing` | Fit zoom ≥ 40% (from 29%); density ≥ 22% (from 15%; lowered from 30% after review: the tighter layout read as cramped); line length ≤ 60% of baseline; crossings ≤ 4; bends ≤ 60% of baseline; aspect between 1.0 and 1.9 (wider than tall) |
| `four-areas-wide` | aspect ≤ 2.0 (from 3.69); fit zoom ≥ 70% |
| `example-erd` | aspect ≤ 2.0; crossings 0; line length ≤ baseline |
| every fixture | audit 100, no overlaps, every line orthogonal and row-anchored (the existing checks), deterministic, re-layout of the saved model moves nothing |

And by eye: the most referenced table of each group sits inside the group, near its middle, with its children around it; groups with many relationships between them are neighbours; no group box is mostly empty.

## Non-goals

- Curved or diagonal lines. Lines stay orthogonal and row-anchored.
- Nested groups (ChartDB "Areas 2.0" parent areas).
- A hand-drawn "free canvas" mode with no layout at all: Auto-Tidy off already gives that.
- Force-directed animation in the page. The layout is computed once per Tidy, as now.

## Decisions (proposed)

- **D1. Groups are containers, packed in two dimensions.** A group is a rounded box sized to its tables, with its name in a title tab on the top-left edge, tinted with its swatch. No full-width bands. Tables without a group are laid out as a group of their own with no box (`_loose`).
- **D2. Placement is a grid, not free coordinates.** Inside a group, tables sit in the cells of a grid (column widths and row heights fit the widest and tallest table in each). Grids give the aligned, tidy look of dbdiagram/drawSQL screenshots, make overlaps impossible by construction, and keep the layout deterministic. Force-directed placement was considered: it gives organic shapes but needs overlap removal and alignment afterwards, and is harder to keep stable for goldens.
- **D3. Hubs in the middle.** Inside a group, the table with the most relationships (in and out, counting other groups) takes the centre cell; the others are placed outward by a greedy pass and improved by cell swaps that minimise weighted line length. Parents no longer come first.
- **D4. `direction` is removed for ERDs.** The engine ignores it, `--layout` stops choosing one, `toDisk` and the Python codec drop it, the audit no longer validates it, and the reference stops mentioning it. A saved page that has it opens fine (the key is dropped on the next save). `TB` code paths and the `tb-direction` fixture are deleted.
- **D5. Positions saved relative to the group box.** The disk `layout` map keeps `{x, y}` per table, now the table's top-left inside its group box's content area. Each group's origin (`groups[].x`/`y`, the screen top-left of its box) is saved in the same map, keyed by group id, groups first; without it the group-relative table positions could not be placed. The box's size is derived from its tables, so a group grows when a table moves inside it. Ungrouped tables keep absolute coordinates. On a v1 block (schemaVersion 1 or missing) `from_disk` drops the `layout` map, so the diagram is re-laid out. Pages saved by v1 (flow-term `x`/`y`) are re-laid out on load: the page detects v1 by `schemaVersion` (bump ERD to `2`) and runs `layoutDiagram` instead of `routeDiagram`.
- **D6. Groups move as units on the page.** Dragging a group's title tab moves the group and its tables (ChartDB behaviour). With Auto-Tidy on, a group drop re-packs the groups with the dragged one at the drop position; off, the group stays where dropped and boxes may not overlap (pushed apart as `resizeLayout()` does for tables).
- **D8. Hovering a table highlights its related tables and their keys** (see [Hover](#hover-related-tables-and-their-keys)). Today related tables only stay undimmed with a faint accent ring, the joining rows are tinted, and nothing shows when the rows are hidden by `detail` or `collapsed`, or on touch.
- **D9. Rounded bends.** Lines keep their orthogonal, table-avoiding routes; the page draws each bend as an arc of radius 14px, clamped to half the shorter of the two segments it joins (so short stubs stay straight and the crow's foot stays on a straight piece). Drawing only: `points`, the audit and the router are unchanged. The SVG export carries the same paths.
- **D10. Overview when zoomed out.** Below a zoom threshold the page switches to an overview: tables keep their boxes and positions, but their rows fade out and the table name is drawn centred in the card at a constant on-screen size; relationship lines keep a constant on-screen stroke width and their labels a constant on-screen size. Nothing about the layout or the saved file changes. See [Overview zoom](#overview-zoom).
- **D7. Aspect target is the screen.** Packing aims for the Fit area's aspect (about 2:1 for 1760 × 856, clamped to 1.0–1.9 for a large schema so it is not a strip). A diagram that fits at 100% is left as compact as possible.

## Algorithm (`assets/types/erd/engine.js`)

`layoutDiagram(data)` = steps 1–5, then `routeDiagram(data)`. `routeDiagram` keeps its contract: from table `x`/`y` (now group-relative) and group positions, compute boxes, routes, labels, crossings.

1. **Weights.** For each relationship add weight 1 between its two tables (self-references ignored). Degree of a table = sum of its weights. Group affinity = sum of weights between two groups.
2. **Grid size per group.** For `n` tables, choose columns × rows with `cols = ceil(sqrt(n · A_cell))` adjusted so the group's pixel aspect (using the median table width and height in the group) is closest to the target aspect of D7; rows = `ceil(n / cols)`. One spare cell per row is allowed when it lets a hub sit in the exact centre.
3. **Place inside a group.** Order tables by degree (ties: authored order). The first goes to the centre cell. Each next table goes to the free cell that minimises the sum over already-placed neighbours of `weight × Manhattan cell distance`, with ties broken towards the centre, then by cell index. Then improve: repeated passes over all pairs of cells (occupied or free) swapping when the total weighted length drops, with a pass cap (`SWAP_PASSES`, default 6) — deterministic order. Neighbours in other groups pull towards the side of the grid that faces where that group will go (after step 4 a second pass of swaps runs with the other groups fixed).
4. **Pack groups.** Treat each group as a rectangle (its grid's pixel size plus padding and title tab). Order groups by affinity (largest group first, then repeatedly the group with the most weight to those already placed). Place each at the free position, among candidate positions touching the already-placed rectangles on any side, that minimises `affinity-weighted centre distance + λ · aspect penalty + μ · bounding-box area`, never overlapping (gap `GROUP_GAP`). Deterministic candidate order.
5. **Pixel coordinates.** Cell column widths and row heights come from the widest/tallest table in each; tables are centred in their cells (horizontally) and top-aligned. `CELL_GAP_X` leaves room for line stubs and labels between columns (widened, as v1's rank gap, when a label must fit); `CELL_GAP_Y` between rows. Write table `x`/`y` relative to the group's content origin, and group positions on the model (derived, `groups[].box`).
6. **Routing** (unchanged code, small changes): obstacles are tables only (group boxes are not obstacles, so lines cross group borders); side choice per end stays (exit towards the other table, C-shape when they overlap horizontally); trunks for lines into one parent row stay. Remove the band-header assumptions. Labels as now.

Constants (replacing the `BAND_*`, `RANK_GAP`, `STACK_GAP`, `PULL_ROOTS`, `SWEEPS` entries; keep `HEAD_H`, `ROW_H`, `MORE_H`, text widths, `MIN_W`, `MAX_W`, `STUB`, router costs):

```js
CELL_GAP_X: 96, CELL_GAP_Y: 48,      // between grid cells inside a group (X widened to fit labels + LABEL_PAD)
GROUP_PAD: 24, GROUP_HEAD: 32,       // inner padding of a group box, and its title tab height (above the content)
GROUP_GAP: 72,                       // between group boxes
TARGET_ASPECT: 2.0, MIN_ASPECT: 1.0, MAX_ASPECT_LARGE: 1.9,
SWAP_PASSES: 6
```

Derived fields (in memory, never saved): `entities[].box` (screen, absolute), `groups[].box` (screen rect of the container including its title tab), `data._loose` (rect of ungrouped tables, no drawing), `relationships[].points`, `relationships[].labelBox`, `data.canvas = {width, height, crossings, length, bends}` (`length` and `bends` added so the audit and the metrics script read them).

Removed: `data._band`, flow terms, `direction` handling, `erRowOffset`'s band logic if any.

Performance: `saas-billing` under 300 ms in Node, including routing.

## Page (`erd.js`, `erd.css`, `stage.html`, `help.html`)

- **Group containers** replace bands: `div.erd-group[data-group-id]` at `groups[].box`, rounded (the shell's card radius), swatch-tinted fill at low opacity with a 1px swatch border, and `span.erd-group-tab` (the name, swatch pill style, as the band pill was) at the top-left. Drawn under the lines and tables. No floating pill on pan (the boxes are small); remove `pinBands`.
- **Selecting a group**: click its tab (as the band pill now): action bar with swatches, rename, delete (unchanged behaviour). Drag the tab to move the group (D6). Reordering by dragging pills goes away; group order in `groups` no longer means anything on screen, so the help says nothing about it.
- **Tables**: a drag with Auto-Tidy on drops the table into the group under the pointer (or out of all groups onto blank canvas = ungrouped) and re-lays out; off, it moves within or into a group, which grows to fit, and boxes are pushed apart. Snap guides stay.
- **Dock**: no change (Table, Relationship, Area, Note | Columns, Types, Notes | Auto-Tidy, Tidy). "Area" adds an empty group box next to the selected table's group (Auto-Tidy on: re-pack).
- **Multi-select, touch, notes, hover, Mermaid**: unchanged, except a marquee may start on a group's empty interior (it is background for `isBackground`).
- `toDisk` / `fromDisk`: positions group-relative, `schemaVersion: 2`, `direction` dropped; v1 detection per D5.

## Hover: related tables and their keys

Hovering a table (or selecting exactly one, so touch and keyboard get it too) shows its neighbourhood:

| What | How it looks |
|---|---|
| The hovered table | Selection-style ring in the accent colour; its PK row(s) referenced by others and its FK rows tinted |
| Each **child** (a table that points at the hovered one) | Ring and header tint in the "in" colour (`--edge-in`, amber); its FK rows that join tinted and bold, with a chip at the row's right end: `→ customer.id` |
| Each **parent** (a table the hovered one points at) | Ring and header tint in the "out" colour (`--edge-out`, blue); the referenced PK (or `toColumns`) rows tinted and bold, with a chip `← order.customer_id` (`← 3 columns` when several children join the same row) |
| The lines between them | As now: thicker, in the same direction colour, markers coloured; their labels outlined |
| Everything else | Dimmed, as now |
| A table related both ways (a child that is also a parent, or a self-reference) | Ring in the "in" colour, rows tinted per role |

**Hidden rows.** When a joining row is not drawn (`detail: keys` hides a non-key `toColumns` row; `names` or `collapsed` hide all rows), the related table shows a **key peek**: a small card under its header listing just the joining columns (glyph, name, type, and the chip), drawn as an overlay that does not change the layout or the line anchors (lines still end at the header). The peek appears on hover/selection only and is never exported (`body.exporting` hides it).

**Implementation (wave B, `erd.js` / `erd.css`).** Extend `applyHighlight()`: classes `rel-child` / `rel-parent` on related `.erd-entity` elements (replacing `linked`), `key-hl` on joining rows, chips as `span.erd-key-chip` appended to rows while highlighted, peeks as `div.erd-key-peek` inside the entity element. Selection of exactly one table applies the same neighbourhood (hover wins while the pointer is over another table). Works in `?present`. Tests in `e2e_erd.mjs`: hovering `order` in the example marks `customer` and `address` as parents and `payment`, `order_item` as children with the right rows and chips; with `detail: names` the peeks list the joining columns; selecting `order` by click gives the same classes; an SVG export contains no peek or chip.

## Overview zoom

- **When.** Enter the overview when `scale < 0.5` and leave it when `scale > 0.6` (hysteresis, so a zoom near the edge does not flicker); a page that opens at Fit below 0.5 opens in the overview. Checked in `onViewChange()`; toggles `body.erd-overview`.
- **Tables.** Box size and position unchanged (lines still end at their rows). Rows, glyphs, types, chips and the "+ N more" row are hidden; the header colour fills the whole card (lighter tint below the header strip); the name is centred in the card, font size `max(13px, 14px / scale)` in canvas units so it reads at about 14px on screen, shrunk to fit the card width, never wrapped mid-word.
- **Lines and labels.** `vector-effect: non-scaling-stroke` keeps line width constant on screen (1.5px, 2.5px when highlighted); label pills are scaled by `1/scale` around their centre so their text stays about 12px on screen; crow's-foot markers are scaled the same way so they stay legible. Labels that would then overlap another label or a table are hidden (lowest-priority first: unlabeled-length order), and shown again on hover of their line or either table.
- **Group boxes.** The title tab is scaled by `1/scale` like a label, so area names stay readable.
- **Hover and selection.** Work as at full zoom. Because rows are hidden, hovering a table shows the key peek (D8) on each related table, listing the joining columns.
- **Expanded card.** Hovering a table (after 150 ms, so sweeping the pointer across the diagram does not flash cards) or selecting it shows its full field list as a card: the table drawn at full detail (header, every column at the diagram's `detail`, glyphs, types, chips) at a constant on-screen size (100% zoom equivalent), anchored over the table's own box (top-left aligned, shifted to stay inside the viewport), above everything else. It is an overlay: the layout, the lines and their anchors do not move. Hover cards close 150 ms after the pointer leaves both the table and the card (so the pointer can move onto the card); a selected table's card stays until the selection changes or Esc. The pointer on the card does not dim or re-highlight anything. The card is read-only; double-click on it zooms to the table at 100% for editing (as double-click on the table does). Never exported. `div.erd-expand-card`.
- **Notes.** Badges hidden; notes shown on the canvas (`showNotes`) stay, scaled like labels.
- **Export, copy and screenshot.** `body.exporting` (set by the shell's `buildExportSvg`, used by every Download and Copy as SVG/PNG) turns the overview off for the export, so every export and copy is the full diagram at full detail; Copy as Mermaid is built from the data and always lists every column. Overlays (peeks, chips, expanded cards) are never exported. The render report and `--screenshot` take the page as it looks at Fit: a large schema's screenshot is the overview. The text-size gate then measures the overview's names and labels.
- **Editing.** Rename, add and drag still work; editing a column (or adding one) needs the rows, so double-clicking a table in the overview zooms to it at 100% first.
- **Tests (`e2e_erd.mjs`).** On `saas-billing`: zoom out below 0.5 → `body.erd-overview`, rows not visible, names' on-screen font ≥ 12px, a label's on-screen height constant across two zoom levels, line stroke width constant; zoom to 0.55 stays in overview, to 0.65 leaves it; hover in overview shows peeks; hovering a table shows its expanded card after the delay with every column, the card stays while the pointer moves onto it and closes after leaving, clicking a table keeps its card until Esc, and the card's on-screen font is the same at two zoom levels; from the overview, Download SVG, Copy as SVG and Copy as PNG (stub the clipboard, compare the SVG text / decode the PNG size) and Copy as Mermaid all contain every column of every table, and none contains a card, peek or chip. On the example at Fit: no overview.

## Python

- `scripts/disk_format.py`: ERD codec as above (`direction` dropped, `schemaVersion` 2 for ERD only; key order otherwise unchanged).
- `scripts/audit_erd.py`: drop the band-based "tables stack in one rank" warning and the `direction` check; add an "entity outside its group box" error; read `canvas.length`/`bends` into the summary. Keep everything else.
- `scripts/layout_engine.py`: remove `choose_erd_direction`; ERD `--layout` always calls the engine once.
- `dev/erd_layout_metrics.py` (new): prints the baseline table's columns for every ERD fixture; `--check` fails when an acceptance target above is missed.

## Fixtures and tests

- Delete `dev/fixtures/erd/tb-direction.json` and its golden; drop `direction` from every ERD fixture.
- Add `hub-and-spokes` (one table referenced by 10), `two-clusters` (two groups with one link between them, which must end up side by side), `ungrouped-mixed` (some tables in groups, some not).
- Re-freeze goldens; `check_golden.py` keeps the ERD checks (re-layout moves nothing, detail levels never change cell assignment) and adds: tables inside their group box, group boxes never overlap.
- `dev/e2e_erd.mjs`: replace the band cases (pill reorder, band under pointer) with group cases (drag a group by its tab with Auto-Tidy on and off, drop a table into another group and onto blank canvas, add Area, delete group), keep everything else. `e2e_touch.mjs --erd` and `e2e_erd_copy.mjs` unchanged unless a selector moves.
- `test_audit_erd.py`: remove the band/direction cases, add the outside-group case.
- `build_examples.py`: rebuild `example-erd.html`; README screenshot `docs/img/example-erd.png` re-rendered.

## Docs

`references/types/erd.md`: remove `direction`, describe groups as boxes, update writing rule 8 (groups: no more limit per "column"; still at most 8 groups), the checklist (hub tables in the middle of their group, related groups side by side, no table outside its group box) and the failure list. `dev/architecture.md`: the ERD disk row (group-relative positions, schemaVersion 2) and the layout description. `SKILL.md`: nothing. Archive this plan with a Status line when done.

## Work split

Two agents in parallel, then one; the coordinator reviews, runs every suite and commits after each.

| Wave | Agent | Owns | Done when |
|---|---|---|---|
| A | **Engine** | `assets/types/erd/engine.js`, `dev/fixtures/erd/*.json` (inputs), `dev/erd_layout_metrics.py` | every acceptance target met on the engine output; the engine author's checker invariants (no overlap, tables inside groups, orthogonal row-anchored routes, determinism, idempotent re-layout) pass; PNGs of `saas-billing`, `four-areas-wide` and the example reviewed by eye |
| A | **Python + docs** | `scripts/disk_format.py`, `scripts/audit_erd.py`, `scripts/layout_engine.py`, `dev/test_audit_erd.py`, `references/types/erd.md`, `dev/architecture.md` | audit tests pass; codec round trip with `schemaVersion` 2 and v1 detection |
| B | **Page** (incl. the hover neighbourhood D8, rounded bends D9 and the overview zoom D10) | `erd.js`, `erd.css`, `stage.html`, `help.html`, `dev/e2e_erd.mjs`, `dev/e2e_touch.mjs` (if needed), `dev/check_golden.py`, goldens, `dev/build_examples.py`, samples, `docs/img/example-erd.png` | `[DONE]` on the example and `saas-billing`; every e2e suite and `check_golden.py` pass; screenshots match the other types' look |

## Open risks

- **Greedy grid placement can trap a hub's children on one side** when they also link to another group. The second swap pass (after packing) is there for this; if `saas-billing` still misses the length target, try simulated annealing over cell swaps with a fixed seed and step count (deterministic) before anything fancier.
- **Lines between non-adjacent groups** may still be long. If one link dominates, the packing's affinity term should make the two groups neighbours; check on `two-clusters`.
- **Wide tables** (long type names) make grid columns uneven. Column widths fit the widest table in each column, so a single wide table widens its column only.

## Sources

- yFiles, [Drawing orthogonal diagrams](https://www.yworks.com/pages/drawing-orthogonal-diagrams) and [Orthogonal layout guide](https://docs.yfiles.com/yfiles-html/dguide/orthogonal_layout/): compact drawings, no overlaps, few crossings and bends; database schemas as a use.
- ChartDB, [Organize your database schema diagram](https://chartdb.io/blog/organize-your-database-schema-diagram): Areas as coloured containers that move with their tables.
- DbSchema, [Layout](https://dbschema.com/documentation/layout.html): Group and Arrange.
- dbdiagram.io community, [Improved auto arrange](https://community.dbdiagram.io/t/improved-auto-arrange/2602) and [Improvements to auto-arrange](https://community.dbdiagram.io/t/improvements-to-auto-arrange-feature/2551): users ask for relationship-aware arrangement and room for lines.
