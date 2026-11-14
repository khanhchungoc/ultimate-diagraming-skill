# Plan: ERD diagram type (`diagramType: "erd"`)

Add entity-relationship diagrams as the third type, next to `flowchart` and `sequence`. Same promise as the other two: the agent writes a short logical JSON, the tooling lays it out, audits it and assembles one standalone, editable HTML page (or claude.ai Artifact) with the shared shell: pan/zoom/fit, theme, Save, undo/redo, Export and Copy, `?present`, help drawer, touch, Artifact Save. Nothing in the shell changes except where this plan says so.

**Status:** approved 2026-11-14; decisions settled as proposed (see [Decisions](#decisions)). Implementation follows [Implementation details](#implementation-details) and the [work split](#work-split).

**Acceptance case:** a SaaS billing schema of about **30 tables in 4 subject areas** (accounts, catalogue, billing, audit), with composite keys, a self-reference (`employee.manager_id`), two junction tables and one optional one-to-one. It must be authored in one pass from a written description or from SQL DDL pasted by the user, pass the audit at 90 or more with no `[WARN]`, fit a 1080p screen at "Keys only" with Fit, and let a reader find "which tables point at `invoice`" in under 10 seconds (hover `invoice`). A small example (8 tables, 2 areas) is the reference example.

## Goals

- A database schema (tables, columns, keys, relationships) is drawn from a description or DDL with nothing dropped: every table, every column the user lists, every foreign key.
- The diagram reads like the other two: same header, dock, action bar, colours (the lane swatches), note style, typography, help drawer.
- A relationship line ends at the **column row** that holds the key, not just somewhere on the box, so a reader sees which column joins which.
- Cardinality is unambiguous: crow's-foot ends (one, zero or one, one or many, zero or many) on both ends.
- A large schema stays readable: subject areas as coloured bands, a detail level (all columns / keys only / names only), collapsing a table to its header, hover to light a table's relationships.
- Edits by hand and edits by the agent combine, as for the other types (`--extract` → edit → `--layout`).
- Layout is computed by one `engine.js`, used by `--layout` and by Tidy/Auto-Tidy in the page.

## Non-goals (v1)

- **Chen and UML class notation.** Crow's foot only. The data model stays notation-neutral (each end is a min/max pair) so another notation is a renderer change later.
- **Importing SQL DDL in the page.** The agent converts DDL to JSON; the page has no parser.
- **Lettered connectors** for long relationship lines (the flowchart's A → A). Hover-highlight covers it first; revisit after the acceptance case.
- **Indexes, check constraints, triggers, views, enums as objects.** An enum or a rule goes in a column's `note` or a diagram `note`.
- **Database-specific types or validation.** `type` is free text shown as written.
- **Live sync with a database.**

## Data

All fields marked optional can be left out. Array order is meaningful only where stated.

```json
{
  "diagramType": "erd",
  "title": "Shop",
  "direction": "LR",
  "detail": "all",
  "groups": [
    { "id": "sales",   "name": "Sales",   "color": "#e0f2fe" },
    { "id": "catalog", "name": "Catalog", "color": "#dcfce7" }
  ],
  "entities": [
    { "id": "customer", "name": "customer", "group": "sales",
      "columns": [
        { "name": "id",    "type": "uuid", "pk": true },
        { "name": "email", "type": "text", "unique": true },
        { "name": "phone", "type": "text", "nullable": true }
      ] },
    { "id": "order", "name": "order", "group": "sales",
      "columns": [
        { "name": "id",          "type": "uuid", "pk": true },
        { "name": "customer_id", "type": "uuid", "fk": true },
        { "name": "placed_at",   "type": "timestamptz" }
      ] },
    { "id": "order_item", "name": "order_item", "group": "sales",
      "columns": [
        { "name": "order_id",   "type": "uuid", "pk": true, "fk": true },
        { "name": "product_id", "type": "uuid", "pk": true, "fk": true },
        { "name": "qty",        "type": "int", "note": "1 to 99" }
      ] },
    { "id": "product", "name": "product", "group": "catalog",
      "columns": [ { "name": "id", "type": "uuid", "pk": true }, { "name": "name", "type": "text" } ] }
  ],
  "relationships": [
    { "id": "r1", "from": "order", "to": "customer", "columns": ["customer_id"],
      "fromEnd": "zeroOrMany", "toEnd": "one", "label": "places" },
    { "id": "r2", "from": "order_item", "to": "order",   "columns": ["order_id"],   "fromEnd": "oneOrMany", "toEnd": "one", "identifying": true },
    { "id": "r3", "from": "order_item", "to": "product", "columns": ["product_id"], "fromEnd": "zeroOrMany", "toEnd": "one", "identifying": true }
  ],
  "notes": [
    { "id": "n1", "text": "Orders are never deleted; cancelled orders keep their items", "entities": ["order"] }
  ]
}
```

| Object | Field | Meaning |
|---|---|---|
| Diagram | `direction` | Optional. `LR` (default) or `TB`, as the flowchart. Parents (referenced tables) come first along the flow. `--layout` picks one when missing, comparing canvas sizes, as `choose_flowchart_direction` does. |
| Diagram | `detail` | Optional. `all` (default), `keys` (PK and FK columns only, plus a "+ 6 more" row), `names` (header only). The dock's **Columns** button cycles it; saved. |
| Diagram | `showTypes` | Optional. `false` hides the type column. Default shown. |
| Diagram | `showNotes` | Optional, as the flowchart: notes drawn on the canvas instead of as badges. |
| Diagram | `colorKey` | Optional, as the sequence type, only when groups are not used and entities carry `color`. |
| Group | `id`, `name`, `color` | A subject area: a coloured band, like a swimlane. Array order is band order. `color` is a lane swatch hex. With no `groups`, there are no bands (like a flowchart with `swimlanes: false`). |
| Entity | `id`, `name`, `group` | One table. `name` is shown as written (keep the database's casing). `group` is a group id. |
| Entity | `columns` | Array, shown in order. Each: `name`, `type` (optional), `pk`, `fk`, `unique`, `nullable` (booleans, optional), `note` (optional, shown as a tooltip and in "all" detail as a muted suffix). |
| Entity | `collapsed` | Optional. `true` draws the header only, whatever `detail` is. |
| Entity | `color` | Optional, only without groups. |
| Relationship | `id`, `from`, `to` | Entity ids. `from` is the child, the table that holds the foreign key; `to` the parent. `from` equal to `to` is a self-reference. |
| Relationship | `columns` | Optional. The FK column names in `from`. The line leaves `from` at the first of those rows and enters `to` at its first PK row (or `toColumns`, optional, for a non-PK unique target). Without it, the line uses the box edges. |
| Relationship | `fromEnd`, `toEnd` | `one`, `zeroOrOne`, `oneOrMany`, `zeroOrMany`. Defaults: `fromEnd: zeroOrMany`, `toEnd`: `one`, or `zeroOrOne` when every FK column is `nullable`. |
| Relationship | `identifying` | Optional. `true`: solid line (the FK is part of the child's PK). Missing: dashed, non-identifying (open question 2). |
| Relationship | `label` | Optional verb phrase (`places`), drawn at the middle of the line. |
| Note | `id`, `text`, `entities` | As flowchart notes: attached to one or more entities (`entities`), badge or on-canvas. |

On disk, a trailing `layout` map holds each entity's `x`/`y` (flow terms, as flowchart nodes), because with Auto-Tidy off a table can be placed by hand. Band sizes and routes are derived on load. `--extract` drops the map.

## Look (same design as the other two)

- **Entity box**: a header strip in the group's swatch colour (like a lane header pill) with the table name in the shell's heading weight; rows below on the card background. Row: key glyph column (PK key icon, FK link icon, both for a PK+FK), name, then `type` right-aligned and muted (the sequence type's `detail` style). `nullable` shows as a muted `?` after the type; `unique` as a small `U` chip. Width fits the longest row within the budget below.
- **Bands**: the flowchart's swimlane band styling (tinted fill, name pill at the start, floating name pill when panned past, via `onViewChange`).
- **Lines**: orthogonal, rounded corners, the flowchart's stroke colour and hop style where lines cross. Crow's-foot markers as SVG markers in `stage.html` (one per end kind, both themes). `identifying` solid, non-identifying dashed. Label on a pill like a flowchart edge label.
- **Notes**: the flowchart's note card and badge, unchanged.
- **Hover** a table: its lines and the joined column rows light up, everything else dims (like the connector partner highlight). Hover a line: both rows light up.
- **Dock** (left to right): Table, Relationship (tool), Area, Note | Columns (cycle), Types, Notes | Auto-Tidy switch, Tidy (shell). No Vertical/Horizontal button (decision 7).
- **Action bar** over the selection: table: area colour, collapse, delete; column: PK, FK, Unique, Nullable toggles, move up/down; relationship: two crow's-foot pickers (one per end, glyph buttons), Identifying, reverse, label.

## Architecture

New files, following "Adding a type" in [architecture.md](../architecture.md):

```
assets/types/erd/
  meta.json            title "Interactive ER Diagram", dataNote (below)
  icon.html            header icon (table glyph)
  erd.css, erd.js      renderer, editing, registerDiagramPlugin({...}) incl. toDisk/fromDisk, toMermaid, selectInRect, selectAll, onViewChange
  engine.js            layoutDiagram(data): pure, no DOM; ranking, bands, ordering, sizes AND line routes
  toolbar.html, stage.html, chrome.html, help.html, default.json
scripts/audit_erd.py   ErdAudit: title, verify_collisions(), summary_lines(), pass_line()
references/types/erd.md, references/examples/example-erd.json
dev/fixtures/erd/*.json (+ golden/), dev/e2e_erd.mjs, dev/test_audit_erd.py
```

Edits to shared files: `SUPPORTED_TYPES` and `AUDITS` in `layout_engine.py`; `DISK_CODECS` in `disk_format.py`; the type table in `SKILL.md` and the `--extract` reading hint for ERD; README type table and "Coming next"; `check_golden.py`, `build_examples.py`, `e2e_touch.mjs` to include the type.

**Routing lives in `engine.js`, not the renderer.** The flowchart routes in `flowchart.js` from DOM rects; the ERD's anchors are column rows whose positions follow from the engine's own row height, so the engine can route without a DOM and the Python audit can check exactly what is drawn. The router is new code written for this type (anchors at rows, entry only from the left/right side of a table in both directions, a short straight stub out of the row so the crow's foot reads). Per architecture.md, the flowchart router is **not** extracted now; if the two end up with the same channel-staggering code, extract a shared module as a follow-up.

**Layout algorithm (engine.js):**
1. Rank: a table's rank is the longest path to it from the tables it references (parents first). Self-references and cycles are broken like flowchart feedback edges (the edge pointing back is routed around). Unconnected tables go to rank 0, after the connected ones in their band.
2. Bands: a group is a band; within a band, tables of the same rank stack across the band.
3. Order within a rank: barycentre sweeps to reduce crossings, then keep authored order on ties (stable, so goldens are stable).
4. Sizes: box height from rows shown at the current `detail`; rank gaps widen to fit relationship labels.
5. Routes: orthogonal, row-anchored, staggered channels between ranks; crossings counted and returned for the audit.
6. `TB` uses the flowchart's flow-terms approach: compute in flow terms, transpose at the end.

**`dataNote`:** "\"entities\" are tables, each with \"columns\" in order (\"pk\", \"fk\", \"unique\", \"nullable\"); each relationship goes \"from\" the child table that holds the foreign key \"columns\" \"to\" the parent; \"fromEnd\"/\"toEnd\" are crow's-foot ends (one, zeroOrOne, oneOrMany, zeroOrMany); \"identifying\": true means the key is part of the child's primary key; \"groups\" are subject areas; \"layout\" is display-only and can be skipped."

**Disk format:** key order `diagramType, schemaVersion, title, direction, detail, showTypes, showNotes, colorKey, groups, entities, relationships, notes, layout`; one line per column object, per relationship and per layout entry (`format_json`). Editor ids (`t_<timestamp>`, `r_`, `g_`, `n_`) are renamed to `<name slug>`, `r<N>`, `<group name slug>`, `n<N>`, references following; authored ids kept. Python codec and `toDisk`/`fromDisk` must agree byte for byte (checked by `e2e_erd.mjs`).

**Mermaid:** `toMermaid` writes `erDiagram` with attributes (`PK`, `FK`, `UK`) and the four end kinds (`||`, `|o`, `}|`, `}o`), `--` for identifying and `..` otherwise. Groups and notes are not representable and are left out, as the flowchart's Mermaid leaves out positions.

## Audit (`audit_erd.py`) and budgets

Errors: unknown entity in a relationship or group, unknown column in `columns`/`toColumns`, duplicate entity ids, duplicate column names in a table, a self-reference without `columns`, bad end kind, overlap of boxes or labels.
Warnings: an `fk` column that no relationship uses, a relationship whose `columns` are not marked `fk`, a table with no PK (unless `note` says why), more than 25 columns in one table at `all` (suggest `keys`), more than 12 tables in one band rank (suggest another area), label over budget (truncated).
Info: line crossings count; many-to-many drawn directly (suggest a junction table if the schema is physical).
Budgets: table name 28 characters, column name 28, type 16, relationship label 20, note 120. Score as the other audits (100 minus penalties, pass at 90).

## Editing (parity with the other types)

| Action | Behaviour | Like |
|---|---|---|
| Add table | Dock **Table**: click to add after the selection, or drag onto a band | flowchart shape tile |
| Rename | Double-click / Enter / F2 on the header or a row; Tab moves name → type → next row; Enter on the last row adds a column; empty name on Enter removes it | sequence label/detail |
| Column keys | Action bar toggles, or keys `P`, `F`, `U`, `?` on a selected row | |
| Reorder columns | Drag a row, or Alt + ↑/↓ | sequence message drag |
| Draw a relationship | Drag from a row's port (or the header) onto another table or one of its rows. Dropped on a PK row from a non-PK row: the start row becomes `fk`, ends `zeroOrMany` → `one`. Dropped on the header: `columns` left out | flowchart port drag |
| Re-point / reverse | Drag a selected line's end handle to another row or table; reverse in the action bar | sequence retarget |
| Cardinality | Two pickers in the action bar, glyph buttons | sequence kind buttons |
| Areas | Dock **Area** adds a band; rename by double-click; drag a band's name pill to reorder; drag a table into another band; colour swatches and delete in the band's action bar (delete asks, keeps its tables in the first band) | flowchart lanes |
| Notes | Dock **Note**, `N`, badges, link a note to several tables, **Notes** toggle | flowchart notes |
| Multi-select | Ctrl/Cmd+click, Shift+drag box, Ctrl/Cmd+A; drag moves all; Delete deletes all as one undo step | flowchart multi-select |
| Collapse | Chevron in a table's header; **Columns** cycles detail for all | sequence collapse |
| Auto-Tidy | On by default (localStorage, not saved): tables, columns, relationships and areas re-lay out after each structural edit, as one undo step. Off: tables stay where dropped, snap guides | flowchart auto layout |
| Undo, Save, Export, Copy, `?present`, touch | From the shell; `?present` hides ports, handles and the dock; hover highlight and collapse still work | shell |

Each finished edit calls `updateStatus(true)` once.

## Phases

Each phase ends with its tests green and is committed on its own.

0. **Settle the open questions** below and freeze the example and the acceptance-case fixture (`dev/fixtures/erd/saas-billing.json`).
1. **Type skeleton.** Folder, `meta.json`, `default.json`, `SUPPORTED_TYPES`, `AUDITS` with the validation part of `ErdAudit`, `DISK_CODECS` entry, `--extract` round trip. A minimal renderer that draws boxes at engine positions. `references/types/erd.md` draft and `example-erd.json`. Test: `test_audit_erd.py` (one failing case per rule), `--layout` on the example produces a page.
2. **Engine.** Ranking, bands, ordering, sizes, row-anchored orthogonal routes, both directions; direction choice when missing. Fixtures: `two-tables`, `junction`, `self-reference`, `cycle`, `no-groups`, `four-areas-wide`, `composite-keys`, `collapsed-and-keys`, `saas-billing`. Freeze goldens; `check_golden.py` also checks that laying out the disk model again moves nothing, and that `keys`/`names` detail only shrinks boxes (rank and order unchanged).
3. **Renderer and look.** Entity boxes, glyphs, bands with floating pills, crow's-foot markers, labels, hops, notes, hover highlight, `detail`/`showTypes`, `contentOverflow`, render-report selectors (`data-node-id` on tables, `data-edge-id` on lines). Screenshot pipeline prints `[DONE]`; the checklist in `erd.md` is final. Rebuild `dev/samples/example-erd.html` and its README image.
4. **Editing.** Tables, columns, relationships, areas, action bar, keyboard, Auto-Tidy and Tidy, undo. `e2e_erd.mjs` with real mouse and keyboard input, including a save without edits writing the generated block unchanged and generated ids renamed.
5. **Large-schema reading.** Multi-select, collapse, notes, touch (`e2e_touch.mjs --erd`), `?present`. Run the acceptance case; record its score, size and the 1080p fit.
6. **Export and Copy.** SVG/PNG via the shell (markers and bands present in the SVG), `toMermaid` (paste the output into the Mermaid live editor once and record that it parses).
7. **Artifact and docs.** `--target artifact` on the example (`check_artifact_shape.py`, `e2e_erd.mjs --artifact`), SKILL.md type table and read hint, README (type row, picture, remove ERD from "Coming next"), architecture.md (third type, router note). Archive this plan with a Status line.

## Tests (added to the table in architecture.md)

| Command | Proves |
|---|---|
| `python dev/check_golden.py` | ERD fixtures equal goldens, score >= 90, re-layout of the disk model moves nothing, detail levels never change rank or order |
| `python dev/test_audit_erd.py` | Each ERD audit rule has a failing case and accepts the valid forms |
| `node dev/e2e_erd.mjs --browser <chrome> --page <html> --large <html> [--artifact <html>]` | Plugin with real input: add/rename/delete table and column, keys, reorder, draw/re-point/reverse a relationship and its inferred ends, cardinality pickers, areas, notes, multi-select, collapse, detail cycle, Auto-Tidy on/off, undo/redo, hover highlight, `?present`, byte-identical save, id renaming, Mermaid copy |
| `python dev/build_examples.py --check` | `example-erd.html` up to date with reading guide and data block |

## Decisions

Settled 2026-11-14, all as proposed:

1. **Areas are bands**, as swimlanes (same look, editing and layout model as flowchart lanes).
2. **Missing `identifying` is dashed** (non-identifying). The audit warns when every column in a relationship's `columns` is `pk` and `identifying` is missing.
3. **Parents first** along the flow (left in `LR`, top in `TB`).
4. **No inference** of relationships from `fk` columns; the audit warns about an `fk` column no relationship uses.
5. **No Copy as SQL** in v1.
6. **Direct many-to-many allowed**, with an `[INFO]` suggesting a junction table.
7. **No Vertical/Horizontal button in the ERD dock** (settled after wave 3). An ERD has no flow to read in a direction, ERD tools rarely offer the switch, and `TB` adds a sideways stub to every line because rows stay horizontal. The engine keeps `TB`, `--layout` still picks it automatically when `direction` is missing and it fits the screen clearly better, and an agent can still set `"direction": "TB"`.

## Implementation details

These are the contracts the work split depends on. A part may be built before the parts it talks to only because these are fixed; change one only by editing this section first.

### Coordinates and what is saved

- **Entity `x`/`y` are in flow terms**, exactly like flowchart nodes: `x` runs along the flow from the start of the band track, `y` runs across the band from the band's edge (top edge in `LR`, left edge in `TB`). Bands therefore never overlap: band `i` starts where band `i-1` ends, and a band's thickness fits its members. With no `groups`, all entities sit in one implicit band with no header (`band id ""`).
- **Saved** (disk `layout` map keyed by entity id): `{ "x": .., "y": .. }` only. Everything else the engine writes is derived and never saved.
- **On load** (`render()`): if any entity lacks `x`/`y`, call `layoutDiagram(chartData)`; otherwise call `routeDiagram(chartData)`. Both write the derived fields below.

### `assets/types/erd/engine.js` (pure JS, no DOM; loaded into the page scope before `erd.js` and run by `scripts/run_engine.mjs`)

Constants (mirrored in `scripts/audit_erd.py`; keep in sync):

```js
const ER = {
  HEAD_H: 36, ROW_H: 26, MORE_H: 22,          // header strip, one column row, the "+ N more" row (keys detail)
  CHAR_W: 7.4, TYPE_CHAR_W: 6.6,              // name text and the muted type text
  PAD_X: 12, GLYPH_W: 22, TYPE_GAP: 16,       // left padding, key-glyph column, gap between name and type
  MIN_W: 168, MAX_W: 360,                     // entity box width bounds
  RANK_GAP: 112, LABEL_PAD: 32,               // min gap between ranks; widened to fit the widest label crossing it + LABEL_PAD
  STACK_GAP: 40,                              // gap between entities stacked in one rank of one band
  BAND_HEAD: 48, BAND_PAD: 28, BAND_MIN: 140, // band header (name pill column / row), inner padding, min thickness
  MARGIN: 40, STUB: 20, CHANNEL_STEP: 8, OBSTACLE_PAD: 12, GRID: 4
};
```

Functions (all global in the page; `erd.js` uses the helpers):

| Function | Does |
|---|---|
| `layoutDiagram(data)` | Rank, order and place every entity (writes flow-term `x`/`y`), then `routeDiagram(data)`. Idempotent and deterministic: same input, same output. |
| `routeDiagram(data)` | From the current `x`/`y`: sizes, band rects, screen boxes, routes, labels. Never moves an entity, except to push it inside its band if `y` is negative. |
| `erVisibleColumns(entity, data)` | `{ cols: [{col, index}], more: N }` for the current `detail` and `collapsed` (`all`: every column; `keys`: `pk` or `fk` columns, `more` = the rest; `names` or `collapsed`: none). |
| `erEntitySize(entity, data)` | `{ w, h }` on screen. `w` = clamp(PAD_X + GLYPH_W + max(name width) + (showTypes ? TYPE_GAP + max(type width + 2 chars for nullable "?") : 0) + PAD_X, header name width + 2·PAD_X + 24 (chevron), MIN_W, MAX_W), rounded up to GRID. `h` = HEAD_H + rows·ROW_H + (more ? MORE_H : 0). |
| `erRelEnds(rel, data)` | `{ fromEnd, toEnd }` with the defaults from the Data section. |
| `erRowAnchorY(entity, columnName, data)` | Screen y of a column's row centre, or the header centre when the column is hidden. |

Derived fields written on the model (in memory only):

- `entities[].box = { x, y, w, h }`: screen rect, absolute within the canvas.
- `groups[].box = { x, y, w, h }`: the band rect on screen (and `data._band = { x, y, w, h }` for the implicit band when there are no groups).
- `relationships[].points = [[x, y], ...]`: the orthogonal polyline on screen, first point on the `from` box edge at its row anchor, last on the `to` box edge. The first and last segments are horizontal and at least `STUB` long (the crow's foot is drawn there).
- `relationships[].labelBox = { x, y, w, h }` when `label` is set (centred on the midpoint of the longest segment, `w` = label width + 16, `h` = 22).
- `data.canvas = { width, height, crossings }`.

Algorithm:

1. **Rank** along the flow: build child→parent edges (`from`→`to`, self-references ignored). Break cycles by reversing the edge found by a DFS back-edge in authored order. `rank(e)` = longest path from any root parent (a table that references nothing) to `e`; parents get lower ranks. Unconnected entities: rank 0.
2. **Bands**: band of an entity = its `group` (unknown or missing → first band). Band order = `groups` order.
3. **Order within (band, rank)**: start in authored order; 4 barycentre sweeps (down then up the ranks) using the cross-axis position of neighbours in any band (bands contribute their offset), ties keep authored order. Stable sort only.
4. **Place**: rank `r` starts at the sum of previous rank lengths (the widest box along the flow in that rank, across all bands) plus gaps; each gap is `max(RANK_GAP, widest label of a relationship spanning that gap + LABEL_PAD)`. Across the band: stack in order with `STACK_GAP`, starting at `BAND_PAD`. Band thickness = max(BAND_MIN, content + 2·BAND_PAD). In `LR` the band header is a `BAND_HEAD` column on the left of every band (like flowchart lanes); in `TB` a `BAND_HEAD` row at the top. No header when there are no groups.
5. **Route** (in `routeDiagram`): every anchor is on the left or right side of a box (rows are horizontal in both directions). Side choice: if the other box's centre is to the right of this box's right edge, exit right; if left of its left edge, exit left; otherwise (overlapping in x, e.g. same rank in `LR` or vertically stacked in `TB`) both ends use the same side, the one with more free space (right on a tie), making a C-shape. Self-reference: out of the right side at the FK row, back into the right side at the PK row, loop `2·STUB` wide. Path search: orthogonal A* on the sparse grid made of all box edges inflated by `OBSTACLE_PAD`, the anchors' stub ends and the channel lines midway in each gap; cost = length + 40 per bend + 400 per crossing of an earlier route + infinite through any box other than the two ends. Route relationships in order of increasing Manhattan length. Parallel segments in the same channel are staggered by `CHANNEL_STEP`. Count crossings for `canvas.crossings`.
6. **`TB`**: rank axis is screen y. Compute ranks and order the same way, place in flow terms, transform to screen at the end; routing runs on screen boxes, so it needs no transpose.

### `scripts/audit_erd.py` — `class ErdAudit`

Same interface and report shape as `SequenceAudit` (`title = "ER Diagram"`, `verify_collisions()` returning `{passed, score, grade, issues, budget_warnings, ...}`, `summary_lines(report)`, `pass_line(report)`). Read `scripts/audit_sequence.py` for the exact keys and grading. It audits the laid-out model (with the derived fields), never computes layout:

- Errors (issues, score penalty, fail): the error list in [Audit](#audit-audit_erdpy-and-budgets); plus two entity boxes overlapping; a route segment through a box other than its ends; two label boxes overlapping, or a label box over an entity.
- Warnings go to `budget_warnings` (printed as `[WARN]`, never change the score).
- Info lines (crossings, many-to-many) go in `summary_lines`.
- Unknown `swatch` in a group's `color` is an error (same `SWATCHES` list as the sequence audit).

### `scripts/disk_format.py`

```python
ERD_KEYS = ("diagramType", "schemaVersion", "title", "direction", "detail", "showTypes", "showNotes", "colorKey",
            "groups", "entities", "relationships", "notes", "layout")
ERD_ENTITY_LAYOUT = ("x", "y")                       # -> layout map
ERD_DERIVED = (("entities", ("box",)), ("groups", ("box",)), ("relationships", ("points", "labelBox")))
# plus top-level "canvas" and "_band": dropped
```

- `erd_to_disk`: deep copy, drop derived fields, move entity `x`/`y` into `layout` (keyed by id, in entity order), rename editor ids, order keys. Editor ids: `t_<13 digits>[_k]` → `<slug(name)>` (unique: `_2`, `_3`), `r_…` → next free `r<N>`, `g_…` → `<slug(name)>`, `n_…` → next free `n<N>`; references follow (`entities[].group`, `relationships[].from/to`, `notes[].entities`). Authored ids are never touched. Columns have no ids (identified by name).
- `erd_from_disk`: deep copy, pop `layout`, put each `{x, y}` back on its entity.
- `formatJson`/`format_json` already put each column, relationship and layout entry on one line (flat objects); an entity with `columns` is expanded.
- `erd.js` implements `toDisk`/`fromDisk` identically; a save without edits must be byte-identical to the generated block.

### Registration (`scripts/layout_engine.py`)

- `SUPPORTED_TYPES = ("flowchart", "sequence", "erd")`; `AUDITS["erd"] = ErdAudit`.
- `--layout` with no `direction`: `choose_erd_direction(data)` lays out `LR` and `TB` and picks `TB` only if the zoom that fits the canvas into `VIEW_W × VIEW_H` grows by at least `TB_MIN_GAIN`, printing `[INFO] Direction: ...` as for flowcharts.
- `--verify` on an `.html`: run the engine on the extracted data before auditing (as for sequence), because routes are not saved.

### Page (`erd.js`, `erd.css`, `stage.html`, `toolbar.html`, `chrome.html`, `help.html`, `icon.html`)

DOM inside `stage.html`:

```html
<div id="erd-canvas">
  <div id="erd-bands"></div>                       <!-- div.erd-band[data-group-id] > span.erd-band-pill -->
  <svg id="erd-svg" xmlns="http://www.w3.org/2000/svg">
    <defs><!-- markers: erd-end-one, erd-end-zeroOrOne, erd-end-oneOrMany, erd-end-zeroOrMany,
               orient="auto-start-reverse", markerUnits="userSpaceOnUse", drawn pointing at the box --></defs>
    <g id="erd-rels"></g>                           <!-- g.erd-rel[data-edge-id] > path.erd-rel-line (+ .identifying) + wide transparent hit path -->
  </svg>
  <div id="erd-html"></div>                         <!-- entities, labels, notes -->
</div>
```

- Entity: `div.erd-entity[data-node-id]` positioned at `box`; `div.erd-head` (swatch background) > `span.erd-name` + `button.erd-chevron`; then `div.erd-row[data-col="<name>"]` > `span.erd-glyph` (PK key / FK link SVG, `title` says which) + `span.erd-col-name` + `span.erd-col-type` (muted, right-aligned, `?` suffix when nullable, `U` chip when unique); `div.erd-more` for "+ N more".
- Label: `div.erd-rel-label[data-edge-id]` > `span.erd-rel-label-text`, at `labelBox`.
- Notes and badges: reuse the flowchart's classes and behaviour by copying the relevant CSS/JS (note card, badge, peek); do not import from `flowchart.js`.
- Plugin: `registerDiagramPlugin({ id: 'erd', defaultTitle: 'Interactive ER Diagram', contentEl: erdCanvas, report: { node: '.erd-entity', label: '.erd-rel-label', labelText: '.erd-rel-label-text', nodeText: '.erd-name' }, render, toDisk, fromDisk, isBackground, clearSelection, cancelInteraction, hasSelection, deleteSelection, selectInRect, selectAll, onViewChange, contentOverflow, toMermaid })`.
- Colours: a group without `color` uses `SWATCHES[i % 8].hex` at render (not saved). Use the shell's swatch CSS variables (`--swatch-color`) as the flowchart lanes do, so dark mode comes for free.
- Auto-Tidy switch: same element id, class and localStorage key pattern as the flowchart's (`btn-auto-layout`), its own storage key `erd-auto-layout`. With it on, every structural edit calls `layoutDiagram` then `render` then `updateStatus(true)` once. With it off, an entity drag writes flow-term `x`/`y` (and changes `group` to the band under the pointer), then `routeDiagram`, `render`, `updateStatus(true)`.
- Mermaid copy (shell change, small): `shell.html` gets `<button type="button" role="menuitem" data-copy="mermaid">Mermaid</button>` first in the Copy group; `shell.js` hides it unless `plugin.toMermaid` exists and copies `plugin.toMermaid()` as text with the "Copied as Mermaid" badge. Flowchart and sequence are unchanged (no `toMermaid`).

### Fixtures (`dev/fixtures/erd/`)

`two-tables`, `junction` (order/order_item/product), `self-reference` (employee.manager_id), `cycle` (a↔b via nullable FKs), `no-groups`, `composite-keys`, `four-areas-wide`, `collapsed-and-keys` (`detail: keys`, two `collapsed`), `tb-direction`, `saas-billing` (the acceptance case: ~30 tables, 4 areas, 2 junctions, one optional one-to-one, one self-reference, notes). Every fixture sets `direction` except `saas-billing`.

## Work split

Implemented by subagents in waves. Within a wave, agents own disjoint files and do not commit; the coordinator reviews, runs the tests and commits after each wave.

| Wave | Agent | Owns | Done when |
|---|---|---|---|
| 1 | **Python** | `assets/types/erd/meta.json`, `default.json`; `scripts/audit_erd.py`; `scripts/disk_format.py` (ERD codec); `scripts/layout_engine.py` (registration, `--verify` routing, direction choice); `dev/test_audit_erd.py`; `references/types/erd.md`; `references/examples/example-erd.json` | `python dev/test_audit_erd.py` passes; codec round-trips the example; existing tests still pass |
| 1 | **Engine** | `assets/types/erd/engine.js`; `dev/fixtures/erd/*.json` | `node scripts/run_engine.mjs assets/types/erd/engine.js < fixture` works for every fixture: no overlaps, every route orthogonal with stubs, deterministic output, both directions |
| 2 | **Renderer** | `erd.js` (render, hover, detail, collapse, notes display, `toDisk`/`fromDisk`, `toMermaid`), `erd.css`, `stage.html`, `toolbar.html` (buttons present, wired in wave 3 where they edit), `chrome.html`, `help.html`, `icon.html`; `dev/check_golden.py` + `dev/fixtures/erd/golden/`; `dev/build_examples.py` + `dev/samples/example-erd.html` | `--layout ... --screenshot` prints `[DONE]` on the example and `saas-billing`; goldens frozen; `build_examples.py --check` passes; PNGs reviewed |
| 3 | **Editing** | `erd.js` editing, keyboard, action bar, Auto-Tidy; `dev/e2e_erd.mjs` | `e2e_erd.mjs` passes, including the byte-identical save |
| 4 | **Finish** | multi-select, touch (`dev/e2e_touch.mjs --erd`), Mermaid copy in the shell, `--target artifact` (`check_artifact_shape.py`, `e2e_erd.mjs --artifact`), `SKILL.md`, `README.md` (+ `docs/img/example-erd.png`), `dev/architecture.md` | every test in [Tests](#tests-added-to-the-table-in-architecturemd) and every existing test passes; plan archived with a Status line |
