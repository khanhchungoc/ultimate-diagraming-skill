# Plan: Copy as SVG, PNG and Mermaid

Add three clipboard actions to the Export menu. SVG and PNG reuse the existing export pipeline. Mermaid is a new, type-specific serializer of `chartData`.

## Goals

- **Copy as SVG**: put the same SVG markup that "SVG image" downloads on the clipboard, as text.
- **Copy as PNG**: put the same 2x PNG that "PNG image (2x)" downloads on the clipboard, as an image.
- **Copy as Mermaid**: put Mermaid source for the current diagram on the clipboard. It reflects every unsaved edit, because it reads the in-memory `chartData`.

## Non-goals

- Importing Mermaid back into a diagram.
- Keeping positions, routes or lane icons in Mermaid. Mermaid has no syntax for them and does its own layout. Mermaid output carries structure only.
- Fixing the `<foreignObject>` SVG. Most non-browser tools (Figma, PowerPoint, Inkscape, Visio) render it poorly. Making a native SVG is a separate project.

## UI

The Export menu in [shell.html](../assets/shell/shell.html) gets two labelled groups:

```
Export ▾
  Download
    SVG image
    PNG image (2x)
  Copy
    Mermaid          (hidden when the plugin has no toMermaid)
    SVG
    PNG
```

- The existing download items keep `data-export="svg|png"`. The copy items use `data-copy="mermaid|svg|png"`, so the e2e test selector `[data-export="svg"]` in `dev/e2e_shell.mjs` stays valid.
- Group headings are non-interactive `<div class="export-menu-label">` elements. Style them in `shell.css` next to `.export-menu`.
- Rename the button's `title` from "Export the diagram as an image" to "Export or copy the diagram".
- **Feedback**: if the copy succeeds, the `#save-status` badge shows "Copied as PNG" (or SVG/Mermaid) for about 1.5 s, then `setStatusBadge(hasUnsavedChanges)` restores it. If it fails, show `alert('Copy failed: ' + reason)`, like the existing export errors.

## Shell changes ([shell.js](../assets/shell/shell.js))

### 1. Split rendering from delivery in `exportDiagram`

Today `exportDiagram(format)` builds the SVG, rasterises it and downloads it in one function. Extract:

```js
function exportSvgText()      // -> string: '<?xml ...?>\n' + buildExportSvg().svg
function exportPngBlob()      // -> Promise<Blob>: current Image + canvas code, resolves canvas.toBlob, rejects on error/too large
```

`exportDiagram('svg'|'png')` then becomes `downloadBlob(...)` around these helpers. The download behaviour must not change.

### 2. `copyDiagram(format)`

```js
async function copyDiagram(format) {
  if (!navigator.clipboard) throw new Error('Clipboard is not available in this browser');
  if (format === 'png') {
    // Pass the Promise, not the Blob: the write must start inside the click (Safari, Chromium),
    // and the PNG is rendered asynchronously.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': exportPngBlob() })]);
  } else if (format === 'svg') {
    await navigator.clipboard.writeText(exportSvgText());
  } else if (format === 'mermaid') {
    await navigator.clipboard.writeText(plugin.toMermaid(chartData));
  }
}
```

- Call it synchronously from the menu click handler (no `await` before the call), then `.then(flashCopied).catch(showCopyError)`.
- `ClipboardItem` is missing in older Firefox. If `typeof ClipboardItem === 'undefined'`, hide the Copy PNG item at startup instead of failing on click.
- A `file://` page counts as a secure context in Chromium, so the clipboard works when the HTML is opened from disk. Check this by hand in Firefox and Safari as well (see Testing).

### 3. Menu wiring

Extend the existing `exportMenu` click listener to handle `[data-copy]`. At startup, set `hidden` on `[data-copy="mermaid"]` when `typeof plugin.toMermaid !== 'function'`.

## Mermaid serializers

### Where the code lives

Put each serializer in a new **pure** file, `assets/types/<type>/mermaid.js`, that defines `function toMermaid(data) { ... }` with no DOM access. This follows the `engine.js` pattern: one implementation that both the page and Node can run.

- `assemble_page()` in [layout_engine.py](../scripts/layout_engine.py) adds the file to the page if it exists. Append it to `ENGINE_JS` (or add a `{{MERMAID_JS}}` placeholder that is empty when the file is missing).
- Each plugin adds `toMermaid` to its `registerDiagramPlugin({...})` call ([flowchart.js](../assets/types/flowchart/flowchart.js), [sequence.js](../assets/types/sequence/sequence.js)).
- Add a `toMermaid` row to the plugin interface table in [architecture.md](architecture.md), marked optional.

### Shared: label escaping

Wrap every label in double quotes and escape it with one helper, used by both types:

| Input | Output |
|---|---|
| `"` | `#quot;` |
| `#` | `#35;` |
| newline / `\n` | `<br>` |
| `<`, `>` | `#lt;`, `#gt;` |
| leading/trailing whitespace | trimmed |

Ids pass through a `safeId` that replaces any character outside `[A-Za-z0-9_-]` with `_` and adds a prefix when the id starts with a digit. Mermaid reserves some words (`end`, `graph`, `subgraph`, `style`, …); give every id a prefix (`n_`, `l_`, `p_`) so they never collide. Keep a map from original id to safe id, so references between nodes stay consistent.

### Flowchart

```
---
title: Customer Loan Application Process
---
flowchart LR
  subgraph l_lane_customer["Applicant / Customer"]
    direction LR
    n_n1(["Submit Application"])
  end
  ...
  n_n3 -->|"No"| n_n4
  n_n4 -.->|"Resubmit"| n_n2
  style l_lane_customer fill:#e0f2fe
```

| Diagram data | Mermaid |
|---|---|
| `direction` (`LR` default, `TB`) | `flowchart LR` / `flowchart TB` |
| `title` | YAML front matter `title:` |
| lane | `subgraph <safeId>["<name>"] ... end` + `style <safeId> fill:<color>` |
| `swimlanes: false` | No subgraphs. Nodes are written at the top level. |
| `start`, `end` | `(["label"])` stadium |
| `task` | `["label"]` |
| `decision` | `{"label"}` |
| edge | `a --> b`, or `a -->|"label"| b` when the label is not empty |
| edge with `feedback: true` | `-.->` (dashed) |

- **Order**: write the lanes in array order. Inside each lane, sort the nodes by flow position `x` (then `y`). Then write the edges in array order. Mermaid's layout partly follows the order it reads things in, so this keeps the result closer to the on-screen layout.
- If a node's `laneId` doesn't exist, write it at the top level instead of dropping it.

### Sequence

```
---
title: Checkout
---
sequenceDiagram
  actor p_p1 as Customer
  participant p_p2 as Shop
  p_p1->>p_p2: Place order
  opt stock available
    p_p2->>p_p4: Reserve stock
    p_p4-->>p_p2: Stock reserved
  end
  alt payment accepted
    p_p2->>p_p3: Charge card
    p_p3-->>p_p2: Payment result
  else
    p_p2->>p_p4: Release stock
  end
```

| Diagram data | Mermaid |
|---|---|
| participant `kind: actor` | `actor <id> as <name>` |
| participant `kind: system` / missing | `participant <id> as <name>` |
| message `sync` / missing | `->>` |
| message `reply` | `-->>` |
| message `async` | `-)` |
| fragment `opt` / `loop` / `alt` | `opt <label>` / `loop <label>` / `alt <label>`, closed by `end` |
| `alt` with `elseAt` | `else` before the `elseAt` message |

- Sequence message text sits after `:` and is not quoted, so escaping here means replacing `;` and `#` with entities and newlines with `<br>`.
- Activation bars are left out on purpose. Mermaid draws its own lifelines, and `+`/`-` markers make it fail when a call has no matching reply.

**Fragment nesting** (the one non-trivial algorithm):

1. Convert each fragment's `from`/`to` message ids into message indexes. Drop a fragment if either id is missing, or if `from` comes after `to`.
2. Sort the fragments by start index ascending, then end index descending, so outer fragments come before the inner ones they contain.
3. Go through the sorted list with a stack. A fragment that *partly overlaps* the one on top of the stack (starts inside it, ends outside) can't be nested. Skip it, and add a `%% skipped fragment <id>: overlaps <other id>` comment at the top of the output.
4. While writing the messages: before message *i*, open every fragment that starts at *i* (outer first) and write `else` for an `alt` whose `elseAt` is *i*. After message *i*, close every fragment that ends at *i* (inner first).
5. Indent two spaces per nesting level.

## Testing

### Golden Mermaid output (new)

- `dev/run_mermaid.mjs <mermaid.js> < diagram.json > out.mmd`: a copy of `scripts/run_engine.mjs`'s `new Function` loader that returns `toMermaid` instead.
- Extend `dev/check_golden.py` so that for every fixture it feeds the **laid-out golden JSON** (it has `x`, which the node ordering needs) to `toMermaid` and compares the result with `dev/fixtures/<type>/golden/<name>.mmd`. `--update` rewrites those files.
- Add fixtures for the edge cases: a label containing `"`, `#`, `;`, `>=` and a line break; a node id named `end`; nested `alt` inside `loop`; two fragments that partly overlap; `swimlanes: false`; `direction: TB`.
- Optional (dev only, not shipped): `npx -y @mermaid-js/mermaid-cli -i out.mmd -o out.svg` on every golden `.mmd` to prove it parses. Run it only when `--mermaid-parse` is passed, so normal runs stay dependency-free.

### e2e

`dev/e2e_shell.mjs` and `dev/e2e_sequence.mjs`: grant `clipboard-read`/`clipboard-write` through CDP (`Browser.grantPermissions`), then:

- Click Copy Mermaid, read `navigator.clipboard.readText()`, and check that it starts with `flowchart` / `sequenceDiagram`.
- Add a node through the UI without saving, copy again, and check that the new label is in the output (the copy follows unsaved edits).
- Click Copy SVG and check that the text starts with `<?xml` and contains `<foreignObject`.
- Click Copy PNG, read the clipboard with `navigator.clipboard.read()`, and check that there is an `image/png` item with more than 0 bytes.
- Check that the badge shows "Copied as …" and then goes back to its previous text.

### Manual

Open a saved HTML file over `file://` in Chrome, Edge, Firefox and Safari. Paste the PNG into Slack or Word, the SVG text into an editor, and the Mermaid into mermaid.live and a GitHub Markdown preview.

### Regression

`python dev/build_examples.py` (rebuild the sample pages), then `--check`, `python dev/check_golden.py`, and both e2e scripts.

## Docs

- [references/editing-and-save.md](../references/editing-and-save.md): add one paragraph on the Copy items, and say that Mermaid keeps structure but not layout.
- [README.md](../README.md): add Copy as Mermaid/SVG/PNG to the feature list.
- [architecture.md](architecture.md): the plugin table row and `mermaid.js` in the layer tree.

## Order of work

| Step | Scope | Estimate |
|---|---|---|
| 1 | Refactor `exportDiagram` into `exportSvgText` / `exportPngBlob`. Downloads behave the same. | 1 h |
| 2 | Menu groups, `copyDiagram`, badge feedback, Copy SVG and Copy PNG. Add e2e checks. | 2–3 h |
| 3 | `mermaid.js` for flowchart, escaping helper, `assemble_page` hook, plugin member | 3 h |
| 4 | `mermaid.js` for sequence, including fragment nesting | 3 h |
| 5 | `run_mermaid.mjs`, golden `.mmd` files in `check_golden.py`, edge-case fixtures, Mermaid e2e checks | 2–3 h |
| 6 | Docs, rebuild the sample pages, manual browser pass | 1 h |

Total: about 1.5–2 days. Steps 1–2 can ship on their own before the Mermaid work.

## Risks

- **Clipboard permission or gesture errors** in some browsers, especially Copy PNG in Safari. Passing the Promise to `ClipboardItem` handles this. If it still fails, the error alert should suggest using Download instead.
- **Mermaid syntax changes** between versions. Use only long-standing syntax: `flowchart`, `subgraph`, `style`, stadium/diamond shapes, and `sequenceDiagram` with `opt`/`alt`/`loop`. YAML front matter titles need Mermaid ≥ 9.3. If older renderers matter, switch to `%% title` comments.
- **Large PNGs**: copying uses the same size cap as the download (`k` in the current code). A diagram that is too large rejects with the existing "image too large" message.
