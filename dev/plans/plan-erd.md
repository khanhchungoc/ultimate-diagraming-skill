# Plan: ERD diagram type (`diagramType: "erd"`)

Add entity-relationship diagrams as the third type, next to `flowchart` and `sequence`. Same promise as the other two: the agent writes a short logical JSON, the tooling lays it out, audits it and assembles one standalone, editable HTML page (or claude.ai Artifact) with the shared shell: pan/zoom/fit, theme, Save, undo/redo, Export and Copy, `?present`, help drawer, touch, Artifact Save. Nothing in the shell changes except where this plan says so.

**Status:** proposed 2026-11-14. Not started. Open questions are at the end with a proposed answer each.

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

On disk, a trailing `layout` map holds entity `x`/`y` and group band sizes, as the flowchart does, because with Auto-Tidy off a table can be placed by hand. `--extract` drops it.

## Look (same design as the other two)

- **Entity box**: a header strip in the group's swatch colour (like a lane header pill) with the table name in the shell's heading weight; rows below on the card background. Row: key glyph column (PK key icon, FK link icon, both for a PK+FK), name, then `type` right-aligned and muted (the sequence type's `detail` style). `nullable` shows as a muted `?` after the type; `unique` as a small `U` chip. Width fits the longest row within the budget below.
- **Bands**: the flowchart's swimlane band styling (tinted fill, name pill at the start, floating name pill when panned past, via `onViewChange`).
- **Lines**: orthogonal, rounded corners, the flowchart's stroke colour and hop style where lines cross. Crow's-foot markers as SVG markers in `stage.html` (one per end kind, both themes). `identifying` solid, non-identifying dashed. Label on a pill like a flowchart edge label.
- **Notes**: the flowchart's note card and badge, unchanged.
- **Hover** a table: its lines and the joined column rows light up, everything else dims (like the connector partner highlight). Hover a line: both rows light up.
- **Dock** (left to right): Table, Relationship (tool), Area, Note | Columns (cycle), Types, Notes | Vertical/Horizontal, Auto-Tidy switch, Tidy (shell).
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

## Open questions (with proposals)

1. **Groups as bands or as free cluster boxes?** Proposal: bands, as swimlanes. They reuse the flowchart's look and editing, give a predictable layout, and match "same design". Cluster boxes pack tighter but need a second layout algorithm; revisit if the acceptance case is too wide.
2. **Default line style when `identifying` is missing.** Proposal: dashed (non-identifying), the usual crow's-foot convention; the agent sets `identifying: true` when the FK is in the PK, and the audit warns when a relationship's `columns` are all `pk` but `identifying` is missing.
3. **Parents first along the flow, or children first?** Proposal: parents first (left / top), so a reader starts at the core tables (`customer`, `product`) and follows the lines outwards.
4. **Infer relationships from `fk` columns when `relationships` is empty?** Proposal: no. The agent writes them; the audit warns about an `fk` column no relationship uses. Explicit is easier to edit and to read back.
5. **Copy as SQL DDL?** Proposal: not in v1; add after Mermaid if users ask. Types are free text, so the output would only be a sketch.
6. **Many-to-many drawn directly** (both ends many). Proposal: allowed (for conceptual models), with an info line suggesting a junction table.
