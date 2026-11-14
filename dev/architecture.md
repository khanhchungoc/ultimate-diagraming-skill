# Architecture (maintainers)

Not needed to author diagrams. Describes how the skill is organised so new diagram types can be added without touching the shared parts.

## Layers

```
assets/
  shell/                    shared by every diagram type
    shell.html              page skeleton with {{PLACEHOLDERS}}
    shell.css, shell.js     toolbar, pan/zoom/fit, theme, Save, present mode, render report
    help.html               shared help-drawer entries
                            (Nunito Sans is linked from Google Fonts in shell.html, the page's only network request;
                            offline the page falls back to the system font stack in shell.css)
  types/<type>/             one folder per diagram type (flowchart, sequence)
    meta.json               {"title": ...}
    icon.html               header icon
    <type>.css, <type>.js   renderer, editing behaviour, plugin registration
    engine.js               layout engine: pure JS, no DOM; the ONE implementation of the type's layout
    toolbar.html, stage.html, chrome.html, help.html, default.json
scripts/
  layout_engine.py          CLI: --layout (assembles the page; --screenshot also renders + prints [DONE]/[NEXT]), --verify, --extract; AUDITS registry
  audit_sequence.py         sequence audit
  disk_format.py            the page's data-block format: DISK_CODECS (to_disk/from_disk per type), format_json
  engine_runner.py          runs engine.js for --layout: Node.js via run_engine.mjs, else headless Chrome
  run_engine.mjs            Node entry: loads engine.js, reads diagram JSON on stdin, writes laid-out JSON
  render_screenshot.py      type-agnostic: screenshot + render report
dev/                        parity check, interaction test, notes (not part of authoring)
references/types/<type>.md  schema, budget, checklist the agent reads before authoring
```

`assemble_page()` in `layout_engine.py` fills the placeholders in one pass and writes a single standalone HTML file. JSON key `diagramType` selects the type folder; a file without it is a `flowchart`. `SUPPORTED_TYPES` lists the types that have assets and a reference.

## Plugin interface

A type's `<type>.js` ends by calling `registerDiagramPlugin({...})`. The shell calls only these members:

| Member | Purpose |
|---|---|
| `id`, `defaultTitle` | Name used for default file name and untitled diagrams |
| `contentEl` | Element whose size is fitted/panned |
| `report` | CSS selectors the render report scans: `node`, `label`, `labelText`, `nodeText`. Elements must carry `data-node-id` / `data-edge-id`. |
| `render()` | Draw `chartData` |
| `tidy()` | Run the type's layout engine on `chartData` (Auto-Tidy); the shell then re-renders and fits |
| `tidyResult()` | Publish positions as `<script id="tidy-result">` (used by `?tidy` and the parity check) |
| `isBackground(el)` | True for blank canvas, so a drag pans instead of selecting |
| `clearSelection()`, `cancelInteraction()`, `deleteSelection()` | Selection and Escape/Delete handling; `cancelInteraction()` returns true if it cancelled something |
| `hasSelection()` (optional) | True when `deleteSelection()` would delete something: shows the dock's Delete button |
| `selectInRect(clientRect, mode, start)` (optional) | Shift + drag on blank canvas draws a selection box (`.marquee`) instead of panning, and the shell calls this on every move so the selection previews live: select what the box (client coordinates) touches. `mode` is `replace`, or `toggle` with Ctrl/Cmd held; `start` is true on a box's first call. Missing means Shift + drag pans. Off in present mode. The flowchart uses it for multi-select. |
| `selectAll()` (optional) | Ctrl/Cmd + A outside a text field. Missing means the browser's own. Off in present mode. |
| `toDisk(data)` (optional) | Returns a new object to write into the page's data block (the [disk format](#disk-format)); must not mutate `chartData`. Missing means the block holds the in-memory model as is. |
| `fromDisk(data)` (optional) | Inverse of `toDisk`: the in-memory model from the data block. Missing means identity (the sequence plugin needs none). |
| `contentOverflow()` (optional) | `{left, top, right, bottom}`: unscaled px that content reaches past `contentEl`'s edges, so Fit and the screenshot crop include it. The flowchart reports notes on show that sit in the margin. |
| `onViewChange()` (optional) | Called after every pan/zoom. The flowchart uses it to float a lane name pill at the visible top-left of each lane once the header column is panned out of view. While an export reads computed styles the shell sets `body.exporting`, so view-dependent styles can reset there. |

Plugins share the shell's scope: `chartData`, `scale`/`panX`/`panY`, `viewport`, `stage`, `updateStatus()`, `fitView()`.

Undo/redo lives in the shell: each `updateStatus(true)` snapshots `chartData` (as JSON) onto the history, and undo swaps `chartData` for the previous snapshot and calls `render()`. A plugin therefore gets undo for free if it calls `updateStatus(true)` exactly once per finished edit (on pointerup, not on every pointermove) and keeps no references into `chartData` across renders.

The sequence plugin always derives positions from its engine. The flowchart has an **auto layout** mode (on by default; the dock's Auto-Tidy switch, remembered in `localStorage`, not saved in the file). While it is on, `relayout()` (engine, render, then `updateStatus(true)`, so the edit and its re-layout are one undo step) runs after every *step* edit: adding, moving or deleting a step, and adding, reordering or deleting a lane. The exception is a shape dragged from the dock onto blank canvas: it has no arrows yet, so it stays where it is dropped (a re-layout would only throw it to the start of the flow). *Arrow* edits (connect, reconnect, delete, label) deliberately do not re-lay out: reordering steps means rewiring several arrows, and re-laying out each intermediate graph would make the diagram jump. The engine reads only structure (arrows, lane membership, lane order), not x/y, so with auto layout on a drag only chooses a lane or an arrow to insert into. With it off, the page behaves as a manual editor (drop where you like, snap guides) and only the Tidy button re-lays out.

The flowchart selects several *steps* at once (never arrows, notes or lanes; see `MULTI-SELECT` in `flowchart.js`). `selectedNodeIds` holds the selection and `selectedNodeId` its primary step, the one clicked last, which is all that notes, the N key and note linking look at. Deleting, moving to another lane (a drag or Alt + arrow keys) and moving a run elsewhere in the flow (Alt + drag onto an arrow, or Alt + arrow keys along the flow: `moveRunIntoEdge`, which also inserts a new step dropped onto an arrow) are each one edit with one `updateStatus(true)`, so one undo step. Moving a run rewires: the arrows into it are re-pointed past it and the arrow it is dropped on is split around it. Without Alt, a drag never rewires connected steps. The selection is never saved.

## Disk format

The page's `<script id="diagram-data">` block is written for a reader (an agent opening the file), not for the engine. It sits in `<head>` straight after `<title>`, with a reading guide on line 2 and an `<!-- end diagram-data -->` marker after it, so the model is in the first lines of the file. The in-memory model (engines, renderers, audits, undo history) is unchanged; the conversion happens only where JSON is read from or written to the page:

| | In memory | On disk |
|---|---|---|
| Key order | any | fixed: flowchart `diagramType, schemaVersion, title, direction, swimlanes, showNotes, lanes, nodes, edges, notes, layout`; sequence `diagramType, schemaVersion, title, numbered, showDetails, participants, messages, fragments, notes`; unknown keys last |
| Flowchart positions | node `x`/`y`, lane `height`/`color` on the objects | one trailing `layout` map keyed by id |
| Flowchart node order | any | flow order: `(x, lane index, y)`. `x` runs along the flow in both directions, so no graph walk is needed. `check_golden.py` proves the order never changes a layout |
| Editor-generated ids (`n_<timestamp>`, `c_`, `e_`, `lane_`) | kept for the session | renamed: `n_<label slug>`, `c_<letter>_in/out`, next free `e<N>`, `lane-<name slug>`; references follow. Authored ids are never touched |
| Sequence editor ids (`p_<timestamp>_<k>`, `m_`, `f_`, `n_`) | kept for the session | renamed: `p_<name slug>`, next free `m<N>`, `f<N>`, `n<N>`; every reference (`from`/`to`, `elseAt`, `branches[].at`, note `over`/`after`/`before`) follows |
| Sequence positions | `participants[].x`, `messages[].y` and `hidden`, fragment boxes and `dividers`, note boxes, `layout` size | not saved: `render()` lays out what is missing |
| Formatting | | `format_json` / `formatJson`: one line per flat object (a lane, a node, an edge, a layout entry) |
| `_readme` | not in the model | first key: a one-line "how to read this model" from `meta.json` `dataNote`. It is the only place the page states it (not repeated in the header comment), so it reaches an agent that extracted or parsed the JSON as well as one reading the top of the file. Python writes it (`with_readme`) and drops it on read (`from_disk`); the shell keeps it aside on load and writes it back first on Save |

**Reading guide line numbers.** Line 2 names the block's real line range ("on lines S-E of this file. Read lines 1-E only (offset 1, limit E)"), because an agent's file tools work in line ranges and a whole-file read of a ~500 KB page fails before the agent sees any text. The numbers are stamped from the finished text by `stamp_reading_guide()` (in `assemble_page()`) and `stampReadingGuide()` (on Save); only the guide line is rewritten. A hand edit of the JSON leaves them stale: the guide tells the reader to trust the end marker over them, and `--verify` warns. No huge lines may sit just past the block (the fonts used to be inlined there), so a read that overshoots the end marker lands on ordinary CSS. `build_examples.py --check` checks all of this.

Two implementations exist: `scripts/disk_format.py` (`DISK_CODECS`, used by `assemble_page()`, `extract_data_from_html()` and `--extract`) and the plugins' `toDisk`/`fromDisk` plus the shell's `formatJson`. They must agree byte for byte: `e2e_shell.mjs` and `e2e_sequence.mjs` save a generated page without edits and compare the block. `--extract` prints the authoring JSON: the disk model without `layout`. On Save the shell also writes the diagram title into `<title>` and the header `<h1>`.

## One engine per type

Layout lives only in `assets/types/<type>/engine.js`. The page runs it for the Auto-Tidy button; `--layout` runs the same file through Node.js (or headless Chrome if Node is missing), so there is nothing to keep in sync. The Python `--verify` audit routes edges itself to check the result; it never computes layout. If `FlowchartAudit` and the page's renderer ever disagree on a route, trust the render report and fix the audit.

### Flowchart direction (`"direction": "TB"`)

A top-to-bottom flowchart uses the same engine, router and audit as a left-to-right one. Node `x`/`y` are always in **flow terms**: `x` runs along the flow (from the start of the lane track) and `y` across the lane (from its edge). Only the sizes change:
- `engine.js` `useDirection(data)` switches `LE` to `LE_PROFILES.TB`. Nodes are 80px along the flow and 144px across it.
- `FlowchartAudit` picks the matching sizes.
- The renderer turns flow terms into the screen: n.x becomes the screen y and n.y the screen x (`placeNodeEl`, `flowPoint`, `flowToContainer`).
- `computeAllEdgeRoutes` transposes the node boxes before the route search and the polylines back afterwards (step 5e), so every routing rule is written once, for left to right.

## Adding a type

1. `assets/types/<type>/` with the files above and a reference in `references/types/<type>.md`.
2. Add the type to `SUPPORTED_TYPES` and `SKILL.md`'s type table.
3. Write `engine.js` defining `layoutDiagram(data)` (pure, no DOM) and an audit class with `title`, `verify_collisions()`, `summary_lines()` and `pass_line()`; register it in `AUDITS` in `layout_engine.py`.
4. Add fixtures under `dev/fixtures/<type>/`, freeze goldens with `python dev/check_golden.py --update`, and run the tests below.

The `sequence` type is the reference for a type that shares nothing with the flowchart except the shell: its own renderer, engine, audit and reference. ERD and state diagrams are planned; when one of them needs the flowchart's orthogonal router or layered ranking, extract those into shared modules at that point rather than speculatively.

## Tests

| Command | Proves |
|---|---|
| `python dev/build_examples.py --check` | `dev/samples/example-*.html` (built from `references/examples/example-*.json`) match what the current shell, plugins and engines would build, and each has what an agent reads first: the reading guide on line 2, the data block in `<head>` with its end marker, the real title, and guide commands that print valid JSON. Run without `--check` to rebuild them after any change. |
| `python dev/check_golden.py` | Engine output for every `dev/fixtures/*.json` equals `dev/fixtures/golden/`, and the audit scores >= 90. For flowcharts, laying out the flow-ordered disk model again moves nothing (both directions). For the sequence fixtures frozen in `dev/fixtures/sequence/golden/v1/` (before branches, notes and collapsing), every `x`, `y`, `w`, `h` is unchanged and the old `elseY` is the one divider. Use `--update` after an intentional engine change and review the diff. |
| `python dev/test_audit_sequence.py` | Each sequence audit rule (branches, notes, colours, collapsed overlap, nesting depth) has a failing unit case and accepts the valid forms |
| `node dev/e2e_shell.mjs --browser <chrome> --laid <html> --scrambled <html>` | Shell wiring through the flowchart plugin: Auto-Tidy button, tidy-on-edit, Delete/Escape, undo/redo, background click, theme, Save path, `?present`; the saved file (captured as a download): data block byte-identical to the generated one, title written escaped, generated ids renamed and authored ids kept, steps in flow order |
| `node dev/e2e_connectors.mjs --browser <chrome> --forward <html> --loop <html> --merge <html> --split <html>` | On-page connectors, on the `dev/fixtures/flowchart/unsplit/connector-*.json` twins laid out (`--split`: `connector-forward.json` laid out): Split chip makes a pair with no step moved, hover lights the partner, click pans to it (also in `?present`), rename renames both and refuses a letter in use, Delete joins and restores label and `feedback`, merge via the chip, undo/redo, refusals (hand-drawn arrows, notes), SVG export |
| `python dev/check_direction.py` | The direction `--layout` picks for a flowchart without `"direction"` (`choose_flowchart_direction`): the short loan example stays left to right, the 55-step laptop sample and copies of it with 8 to 12 lanes go top to bottom. The choice compares laid-out canvas sizes only (no render). |
| `python dev/make_unsplit.py [--check]` | Rewrites (or checks) the unsplit twin of each `connector-*.json` fixture. `check_golden.py` lays out both, left to right and top to bottom, and fails if any step or lane height differs: splitting an arrow never moves a step. |
| `node dev/e2e_shapes.mjs --browser <chrome> --page <html>` | Classic flowchart shapes, on `dev/fixtures/flowchart/classic-shapes.json` laid out: each Shapes tile adds its type, drop onto an arrow, arrow ends on the outline (left to right and top to bottom), SVG export carries each outline |
| `node dev/e2e_multiselect.mjs --browser <chrome> --loan <html> --zigzag <html> --connector <html> [--shot <png>]` | Flowchart multi-select, on `loan-application.json`, `cross-lane-zigzag.json` and `connector-forward.json` laid out: Ctrl+click, Shift+click runs (loop-backs not followed), the Shift+drag box and its toggle form (a plain drag still pans), Ctrl+A, Escape, deleting 3 steps with one undo, moving a selection to another lane by drag and Alt + arrows (lane offset kept), Alt + drag of a run onto an arrow (expected arrows, no duplicates, audit score not worse, one undo), Alt + arrows along the flow, refusals with a hint, a connector circle following its step (Auto-Tidy on and off), top to bottom, and `?present` |
| `node dev/e2e_sequence.mjs --browser <chrome> --page <html> --long <html>` | Sequence plugin, with real mouse and keyboard input (`--page`: `checkout-with-fragments.json` laid out; `--long`: `payment-phases.json` laid out): select/delete, rename by double-click, create in edit, draw a message lifeline to lifeline, retarget, reverse, reply, insert and delete participants, the frame-membership rule for moves, ranges and Frame, frame edges, kind, colour, branches, notes, keyboard, saved ids renamed; collapse (also in `?present`), focus, pinned participant row and its SVG export; a save without edits writes the generated block unchanged on both pages (no positions) |
| `node dev/e2e_touch.mjs --browser <chrome> --sequence <html> --flowchart <html>` | Touch on a phone-sized, mobile-emulated page (`--sequence`: `payment-phases.json` laid out; `--flowchart`: `loan-application.json` laid out), with real touch input: one finger pans 1:1, a pinch zooms the diagram and never the page, a drag that starts on an unselected step pans and moves nothing, a tap selects (not the connect port touch adjustment would hit), a selected step drags to another lane, a tap on blank canvas clears; the sequence participant row pins over a band that spans the diagram; a sequence lifeline pans until its participant is tapped, then a drag from it draws a message |
| `python scripts/render_screenshot.py --input <html>` | Render report and legibility gates |
