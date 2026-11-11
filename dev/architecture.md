# Architecture (maintainers)

Not needed to author diagrams. Describes how the skill is organised so new diagram types can be added without touching the shared parts.

## Layers

```
assets/
  shell/                    shared by every diagram type
    shell.html              page skeleton with {{PLACEHOLDERS}}
    shell.css, shell.js     toolbar, pan/zoom/fit, theme, Save, present mode, render report
    help.html               shared help-drawer entries
  types/<type>/             one folder per diagram type (flowchart, sequence)
    meta.json               {"title": ...}
    icon.html               header icon
    <type>.css, <type>.js   renderer, editing behaviour, plugin registration
    engine.js               layout engine: pure JS, no DOM; the ONE implementation of the type's layout
    toolbar.html, stage.html, chrome.html, help.html, default.json
scripts/
  layout_engine.py          CLI: --layout (assembles the page), --verify (Python audit), --extract; AUDITS registry
  audit_sequence.py         sequence audit
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
| `onViewChange()` (optional) | Called after every pan/zoom. The flowchart uses it to float a lane name pill at the visible top-left of each lane once the header column is panned out of view. While an export reads computed styles the shell sets `body.exporting`, so view-dependent styles can reset there. |

Plugins share the shell's scope: `chartData`, `scale`/`panX`/`panY`, `viewport`, `stage`, `updateStatus()`, `fitView()`.

Undo/redo lives in the shell: each `updateStatus(true)` snapshots `chartData` (as JSON) onto the history, and undo swaps `chartData` for the previous snapshot and calls `render()`. A plugin therefore gets undo for free if it calls `updateStatus(true)` exactly once per finished edit (on pointerup, not on every pointermove) and keeps no references into `chartData` across renders.

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
| `python dev/build_examples.py --check` | `dev/samples/example-*.html` (built from `references/examples/example-*.json`) match what the current shell, plugins and engines would build. Run without `--check` to rebuild them after any change. |
| `python dev/check_golden.py` | Engine output for every `dev/fixtures/*.json` equals `dev/fixtures/golden/`, and the audit scores >= 90. Use `--update` after an intentional engine change and review the diff. |
| `node dev/e2e_shell.mjs --browser <chrome> --laid <html> --scrambled <html>` | Shell wiring through the flowchart plugin: Auto-Tidy button, Delete/Escape, undo/redo, background click, theme, Save path, `?present` |
| `node dev/e2e_sequence.mjs --browser <chrome> --page <html>` | Sequence plugin: select/delete, reorder by drag, add, frames, inline edit, `?present` |
| `python scripts/render_screenshot.py --input <html>` | Render report and legibility gates |
