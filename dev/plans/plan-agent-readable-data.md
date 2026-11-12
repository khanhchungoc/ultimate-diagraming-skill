# Plan: Agent-readable diagram data

Make the saved HTML easy for an agent to read and understand without an extra outline to maintain. The embedded JSON becomes the readable version: found at the top of the file, written in flow order, with meaning first and positions kept apart.

**Status (2026-11-12):** Not started.

## Background

A saved diagram is ~390 KB, and the model is ~15 KB of it (`motor-insurance-claim-processing.html`: data block at line ~1791 of 8078). An agent that reads the file sees 2000 lines of CSS and toolbar first, with nothing pointing to `<script id="diagram-data">`. `<title>` and `<h1>` say "Interactive Swimlane Flowchart", not the diagram's title. Inside the block:

- nodes are grouped by lane, so the agent has to trace edges to follow the process;
- `x`, `y`, lane `height` and `color` are mixed in with the semantic fields;
- editor-created ids are timestamps (`n_1731400000000`), so edges that use them don't make sense on their own.

A generated plain-text outline was considered and rejected: it is a second copy of the model and has to be rebuilt by every writer. Every fix below changes only how the one model is written.

**No compatibility needed.** No files exist outside this repo, so the loader reads only the new format. There's no v1→v2 migration. `schemaVersion` stays `1`, and the legacy `flowchart-data` block id can go.

## Goals

- An agent that opens the file finds the model in the first ~20 lines, with the real title.
- Reading `nodes` top to bottom follows the process.
- Every edge line makes sense without lookups (readable ids).
- Positions and sizes sit in one `layout` map that an agent can skip.
- What an agent writes (authoring JSON) is exactly the embedded model minus `layout`.
- Nothing new to keep in sync: no outline, and no derived field that can go stale.

## Non-goals

- **Plain-text / markdown outline.** Rejected above.
- **Renaming fields** (`laneId` → `lane`, `feedback` → `kind`). Today's names already read well, and renaming them touches the engine, audit, fixtures, goldens and docs for little gain. The header comment explains `feedback`.
- **Moving notes onto nodes.** A note can link several nodes (`"nodes": [...]`), and the engine places notes. With readable ids, the `notes` array already reads well.
- **`<meta name="description">` with counts.** It would be a derived value to keep updated on every save.
- **Re-slugging author-chosen ids.** Only generated ids are rewritten (Part 4), so ids an agent or a spec refers to never change.

## Target shape (flowchart)

```html
<head>
  <meta charset="UTF-8">
  <meta name="viewport" ...>
  <title>Motor Insurance Claim Processing</title>
  <!-- Diagram model: the source of truth for this page. "nodes" are in flow order;
       "feedback": true marks an arrow that loops back; "layout" is display-only (positions,
       sizes, colours) and can be skipped. Everything after this block is the editor. -->
  <script id="diagram-data" type="application/json">
{
  "diagramType": "flowchart",
  "schemaVersion": 1,
  "title": "Motor Insurance Claim Processing",
  "direction": "LR",
  "lanes": [ { "id": "lane-customer", "name": "Customer", "icon": "user" }, ... ],
  "nodes": [
    { "id": "n_start", "laneId": "lane-customer", "type": "start", "label": "Submit Motor Claim" },
    { "id": "n_p_val", "laneId": "lane-portal", "type": "task", "label": "Validate Mandatory Fields" },
    ...
  ],
  "edges": [ { "id": "e1", "from": "n_start", "to": "n_p_val", "label": "" }, ... ],
  "notes": [ ... ],
  "layout": {
    "lane-customer": { "height": 176, "color": "#e0f2fe" },
    "n_start": { "x": 56, "y": 56 },
    ...
  }
}
  </script>
  <style> ... </style>
</head>
```

Sequence diagrams save **no layout at all**. The sequence plugin always derives positions from its engine (`sequence.js` `render()` re-runs `layoutDiagram` when positions are missing), so `participants[].x`, `messages[].y`, fragment boxes and the top-level `layout` size are dropped on save.

## Part 1: Find it and name it (no schema change)

1. **[assets/shell/shell.html](../../assets/shell/shell.html)**: move the `CANONICAL DATA BLOCK` comment and `<script id="diagram-data">` into `<head>`, straight after `<title>` and before `<style>`. Replace the comment with the header comment above, which is static template text. `shell.js` runs at the end of `<body>`, so `getElementById` still finds the block.
   - **Reading guide on line 2.** Put a comment between `<!DOCTYPE html>` and `<html>`, so it's in the first lines any reader sees (`head`, a short `Read`, a web fetch):
     ```html
     <!DOCTYPE html>
     <!-- For agents: this whole diagram is the JSON block with id "diagram-data" a few lines below.
          Read only as far as the "end diagram-data" comment; everything after it is editor code
          (CSS, JS, icons) and says nothing about the workflow. To print just the model:
          sed -n '/<script id="diagram-data" type="application\/json">/,/<\/script>/p' FILE
          python -c "import re,sys;print(re.search(r'<script id=\"diagram-data\" type=\"application\/json\">(.*?)<\/script>',open(sys.argv[1],encoding='utf8').read(),re.S)[1])" FILE -->
     <html lang="en">
     ```
     - **The commands work without the skill installed.**
     - **No line numbers:** they'd be derived values that Save would have to keep correct.
     - **Self-match rule.** The comment never spells the real opening tag, and the commands write the slashes as `\/`. The text of the guide can't match its own patterns, so both commands skip it and print the real block. The same rule keeps `saveToFile()`'s `diagram-data` regex and `extract_data_from_html()` from matching the comment.
     - **No `-->` inside the comment,** or it closes early.
   - **End marker:** `<!-- end diagram-data -->` straight after the block's `</script>`, so a reader paging through knows where to stop.
   - Both comments are static template text. Save already copies everything outside the data block unchanged, so they survive every save without code.
2. **Real title, at generation**: `assemble_page()` fills `<title>` and `<h1 id="chart-title">` with the HTML-escaped `data.title`, falling back to `meta.title`. That needs a new `{{PAGE_TITLE}}` placeholder: keep `{{TYPE_TITLE}}` wherever the type name is still wanted.
3. **Real title, on Save**: `saveToFile()` in [assets/shell/shell.js](../../assets/shell/shell.js) also replaces `<title>…</title>` and the `<h1 id="chart-title" …>…</h1>` contents with the escaped title. Use a replacement function, and spell the closing tags with an escaped slash (`<\/title>`, `<\/h1>`), like the existing patterns, so the regexes can't match their own source. Both elements come before the main script, so the first match is the right one.
4. **Fixed top-level key order** on every write: `diagramType, schemaVersion, title, direction, swimlanes, lanes, nodes, edges, notes, layout` for flowcharts, and `diagramType, schemaVersion, title, participants, messages, fragments` for sequences. Unknown keys go last, in their existing order.
5. **Cleanup**: drop `"flowchart-data"` from `DATA_BLOCK_IDS` in [scripts/layout_engine.py](../../scripts/layout_engine.py).

## Part 2: `layout` map (disk format only)

The in-memory model doesn't change. The renderer, engine, audit and undo history keep reading `n.x`, `lane.height` and so on. The split happens only where JSON is read from or written to the page.

**JS: plugin codec.** Add two optional plugin members (document them in [dev/architecture.md](../../dev/architecture.md)):

| Member | Purpose |
|---|---|
| `toDisk(data)` | Returns a new object to save: semantic fields only, in key order, plus the type's `layout` (flowchart) or nothing (sequence). Doesn't mutate `chartData`. |
| `fromDisk(data)` | Returns the in-memory model: merges `layout[id]` back into lanes and nodes, then deletes `layout`. |

`loadInitialData()` calls `plugin.fromDisk`, and `saveToFile()` calls `plugin.toDisk` before `JSON.stringify`. Missing members mean identity, so a future type opts in.

- **Flowchart layout keys:** node `x`, `y`; lane `height`, `color`. `icon` stays on the lane because it hints at what the actor is. Lane colour is automatic by order, so most lanes will only have `height`.
- **Sequence `toDisk`:** strip `participants[].x`, `messages[].y`, fragment `x, y, w, h, elseY`, and top-level `layout`. `fromDisk` is identity, because `render()` lays out what's missing.
- **Clash to avoid:** the sequence model already uses `data.layout` for canvas size. That's fine, since sequence never writes a `layout` key to disk, but `fromDisk` must not read it as a position map.

**Python: same codec, per type.** Add a `DISK_CODECS = {"flowchart": (to_disk, from_disk), "sequence": (...)}` registry next to `AUDITS` in `layout_engine.py`.

- `assemble_page()` embeds `to_disk(data)`.
- `extract_data_from_html()` returns `from_disk(...)`, so `--verify` and the audits still see positions. For a sequence page, `--verify` runs the engine first through `engine_runner` (positions aren't saved).
- **CLI `--extract` writes the semantic model only** (no `layout`). It's the authoring format, and `--layout` recomputes positions anyway. SKILL.md's Update procedure already warns that a re-layout resets dragged positions.

Two implementations of a small transform is the cost. The round-trip test in Part 5 is what keeps them equal.

## Part 3: Nodes in flow order

At write time (`toDisk`, both languages), sort flowchart `nodes` by `(x, lane index, y)`. `x` is already the position along the flow in both directions (see "Flowchart direction" in architecture.md), so the engine has done the ranking. No graph walk is needed, and a hand-arranged diagram is written in the order it reads on screen. Sequence `messages` are already in time order and `participants` in column order, so nothing changes there.

**Risk: the engine may break ties by input order.** If node array order affects layout, a save followed by Auto-Tidy could move steps. Gate: for every fixture, `layout(sort(layout(f)))` must equal `layout(f)` (Part 5). If it fails, make the engine's tie-breaks order-independent (by id) rather than skip the sort. Leave `edges` in their current order: decision exit order may decide branch placement, and edges are readable once ids are.

## Part 4: Readable generated ids

Editor-created ids are `uid(prefix)` = `<prefix>_<Date.now()>` ([flowchart.js:3195](../../assets/types/flowchart/flowchart.js#L3195)), plus `e_${Date.now()}` and `lane_${Date.now()}` built inline.

- **On save, rewrite only generated ids**, i.e. ids matching `/^(n|c|e|lane)_\d{12,}(_\d+)?$/`. In `toDisk`:
  - nodes → `n_<label slug>` (lowercase, ASCII, `_`-joined, max ~30 chars, `_2`, `_3` on clash);
  - lanes → `lane-<name slug>`;
  - connectors → `c_<letter>_in` / `c_<letter>_out`;
  - edges → next free `e<N>`.

  Update every reference (`edges[].from/to`, `notes[].nodes`, `layout` keys) in the same pass.
- **Ids an author chose are never touched**, so an agent's ids, and any spec or user story that cites them, stay stable across saves.
- **The rewrite happens on disk only.** `chartData` keeps its in-memory ids until the next load, so selection, undo and DOM `data-*-id` attributes aren't disturbed mid-session.
- **The id is fixed once written.** Renaming a step later doesn't re-slug it, because by then it's no longer a generated id.
- **Authoring rule** in [references/types/flowchart.md](../../references/types/flowchart.md): "Node ids are a short slug of the label: `n_validate_policy`, not `n5`." Update the examples to follow it.

## Part 5: Tests

| Test | Where |
|---|---|
| **Round-trip parity**: page built by `assemble_page()` → loaded → Save without edits → the saved data block is byte-identical to the generated one. Do it for one flowchart and one sequence. This proves the JS and Python codecs agree. | Extend `dev/e2e_shell.mjs` (Save path already covered); add a sequence case to `dev/e2e_sequence.mjs` |
| **Save rewrites title**: rename the title, Save → `<title>` and `<h1>` in the saved HTML show the new text, escaped (try `A & <B>`). | `dev/e2e_shell.mjs` |
| **Generated ids rewritten, authored ids kept**: add a step in the page, Save → new id is `n_new_step`, edges/notes/layout follow it, existing ids unchanged. | `dev/e2e_shell.mjs` or `dev/e2e_shapes.mjs` |
| **Sort is layout-neutral**: for every fixture, both directions, laying out the flow-ordered output gives identical positions. | `dev/check_golden.py` |
| **Data block in `<head>`**, the reading guide on line 2, the end marker straight after the block, and the title correct in every built sample. Run the guide's `sed` and `python` commands on a sample and check they print valid JSON. | `python dev/build_examples.py --check` (add the assertion) |
| Goldens: `layout` lives only on disk, so the engine output and goldens shouldn't change. Any golden diff means the codec leaked into the engine path. | `python dev/check_golden.py` |

## Part 6: Docs and samples

- [dev/architecture.md](../../dev/architecture.md): disk format vs in-memory model, the two plugin members, `DISK_CODECS`.
- [references/types/flowchart.md](../../references/types/flowchart.md): id rule. Mention that the embedded model is the authoring JSON plus `layout` (one line; agents don't write `layout`).
- [references/types/sequence.md](../../references/types/sequence.md): note that positions aren't saved.
- [SKILL.md](../../SKILL.md) Update procedure: `--extract` output has no positions. One clause, since the reset is already explained.
- Rebuild: `python dev/build_examples.py` for `example-*.html`. Rebuild `motor-insurance-claim-processing.html` and `preparation-iteration-flowchart.html` with `--extract` then `--layout`. `motor-insurance-claim-processing-other.html` isn't this skill's output, so leave it alone.

## Order of work

1. **Part 1**: small, independent, and fixes the biggest problem (the agent can't find the model). Ship it alone.
2. **Part 3's idempotence gate first** (test only), to learn whether the engine depends on node order before committing to the sort.
3. **Parts 2 + 3** together: the codec and the sort live in the same `toDisk`.
4. **Part 4.**
5. **Part 6** at the end of each step that changes behaviour, not in a batch.

## Acceptance

- A fresh agent asked to "explain the workflow in `<file>.html`" reads the file only as far as the end of the data block (title, comment, model) and describes every branch and loop correctly.
- The motor-insurance data block shrinks, with positions moved into a short tail map, and reads top to bottom as the process.
- All tests above pass. No golden changes.
