# Plan: Blank playground (start empty, create fast, switch type in the same file)

Status: proposed (2026-11-19). Brainstorm plus a phased plan; nothing built yet.

## Goal

Three things a user wants without asking an AI to write a diagram first:

1. **Blank template**: open a page and start drawing, nothing to delete first.
2. **Quick create**: get from "nothing" to a usable diagram in seconds (starters, typing Mermaid, pasting Mermaid).
3. **Switch type in place**: go from a flowchart to a sequence, ERD or use case diagram in the same page and the same file (or the same artifact URL), with no new file, no re-prompt and no re-install.

## Where we are today

- One page holds **one type**. `assemble_page(kind, ...)` joins the shell with exactly one type's `engine.js`, `mermaid.js`, `<type>.js`, CSS and HTML parts into one IIFE. Pages are 420–620 KB.
- Starting data is `assets/types/<type>/default.json`: a small example, not a blank.
- Paste Mermaid (`importMermaid` in `shell.js`) already lays a diagram out in the browser, but refuses another type: "This is a sequence diagram, and this page is a flowchart."
- The four types **cannot simply be concatenated**: they share 99 top-level names (`SVG_NS`, `beginDrag`, `commitNote`, `abButton`, ...), their HTML parts may reuse element ids, and each attaches `document`/`window` listeners that would all fire at once.
- Save already does the right thing for a multi-type page: it takes the page's source text (the fetched file, or the pristine copy for artifacts) and replaces only the `diagram-data` block, `<title>` and `<h1>`. Whatever else the page carries is saved untouched.

## Ideas considered

| Idea | Verdict |
|---|---|
| **A. Blank page per type** (`--blank erd`) | Do it first. Cheap and useful alone; the playground reuses it. |
| **B. One page with all four types, switch in place** | Do it. This is the real ask. How to load the types is the hard part (below). |
| **C. Paste or type any Mermaid, page follows the type** | Do it on top of B: drop the "refuse another type" rule and switch instead. Fastest path from text to diagram. |
| **D. Live Mermaid side panel** (type on the left, diagram redraws on the right) | Phase 3. Big win for "play around"; the readers and engines already run in the browser. |
| **E. Starter gallery** on an empty canvas (Blank / Minimal / Sample per type) | Do it with B; it is the empty state. |
| **F. Convert content between types** (flowchart lanes → sequence participants, etc.) | Not now. Only flowchart ↔ use case shares a grammar; the rest is guesswork that loses data. Switching gives a blank (or that type's last draft) instead. |
| **G. Several diagrams in one file (tabs)** | Not now. Breaks the one-diagram data block that `--extract`, `--keep-from` and the audits rely on. A per-viewer draft per type (below) covers "flip back and forth". |

## Recommended design for B: boot one type per page load

Keep the runtime exactly as today (one type live, its code in the shell's closure) and move the choice of type from build time to load time.

### Page layout (`--target file`)

```html
<script id="diagram-data" type="application/json">{ "diagramType": "erd", ... }</script>
...
<div id="type-slot-toolbar"></div> ... <div id="stage"></div>       <!-- empty slots -->

<template id="tpl-flowchart">  toolbar / chrome / stage / help parts  </template>
<template id="tpl-sequence">...</template>  (one per type)

<script type="text/plain" id="src-shell">     TOKENS_JS + SHELL_JS   </script>
<script type="text/plain" id="src-flowchart"> //@engine-begin ENGINE //@engine-end MERMAID TYPE_JS </script>
<script type="text/plain" id="src-sequence">  ... </script>               (one per type, inert)
<style id="css-flowchart" media="not all">...</style>                    (inert until chosen)

<script> /* boot, ~40 lines */ </script>
```

The **boot** script:
1. Picks the type: a pending switch (see Switching) > `diagramType` in the data block > `?type=` > `flowchart`.
2. Copies that type's `<template>` parts into the empty slots and turns its `<style>` on (`media="all"`).
3. Builds one script text exactly as `shell.html` does today, `(function(){ shell + type + loadInitialData(); })()`, adds `//# sourceURL=diagram-<type>.js`, and runs it with a new `<script>` element.

So no plugin changes, no symbol renaming, no listener teardown: only one type ever runs per load. `sliceEngineSource` reads the engine from the chosen source block instead of `document.currentScript`.

**Why not wrap each type in its own scope and hot-swap?** It also works (each type in a nested function keeps closure access to the shell), but every type would need an `unmount()` that removes its `document`/`window` listeners, timers and workers, and every missed one is a bug that only shows after a switch. Reload-per-switch has no such class of bug. Revisit only if the ~200 ms reload feels slow.

### Switching

- A **type picker** in the header (the type icon becomes a menu: Flowchart, Sequence, ER diagram, Use case).
- Switching asks once if there are unsaved edits ("Switch to ER diagram? This flowchart has unsaved edits." Save & switch / Switch / Cancel).
- The current diagram is stored as that type's **draft** in `sessionStorage` (`ud-draft-<type>`, try/catch), then `sessionStorage['ud-pending'] = {type, data}` and `location.reload()`. Boot reads and clears the pending entry. Data = that type's draft if there is one, else its blank.
- If storage throws (private mode, sandbox), fall back to `location.hash = '#type=erd'` and boot a blank of that type; drafts are just not kept.
- Pasting Mermaid of another type (idea C) is the same switch with the parsed data as `data`, laid out on boot through the existing `placeImported()` path.
- Undo history does not survive a switch (one undo stack per load); switching back restores the draft, which is enough.
- Save writes whatever type is live. The saved file is still a valid single diagram (`diagramType` set) **and** still a playground, because Save keeps all the inert blocks. `--extract`, `--keep-from` and the audits read it unchanged.

### Size

Raw type assets are ~1.1 MB (JS+CSS, before minification). Estimates to confirm in phase 2:

| Page | Today | Playground |
|---|---|---|
| `--target file` | 420–620 KB | ~1.3–1.6 MB (all four) |
| `--target artifact` | `app.js` + `app.css` | `app.js` (shell + boot) + `type-<t>.js` / `type-<t>.css` fetched only for the live type |

The artifact target gets the lazy version for free: boot `fetch`es `type-<t>.js` instead of reading an inert block, so a playground artifact loads no more than a single-type one. For files, `--types flowchart,erd` limits the bundle; a page with one type is today's page.

### Blank and empty state (A, E)

- `assets/types/<type>/blank.json`: the minimum the engine accepts. Flowchart: one lane, no steps. Sequence: two participants, no messages. ERD: no tables. Use case: one subject, no actors.
- **Engine and renderer hardening**: every type must lay out, render, Fit, Tidy, export and audit with zero items (empty bounds, `Math.min()` of `[]`, divide-by-zero in Fit). Add `blank` fixtures under `dev/fixtures/<type>/` and a golden for each.
- **Empty-state card** in the canvas when there is nothing to draw: "Drag a shape from the dock", "Paste Mermaid (Ctrl+V)", and starter chips: *Minimal* (today's `default.json`), *Sample* (`dev/examples/example-<type>.json`, trimmed), *Blank*. Uses the `hint` and `button` components, tokens only. Hidden in present mode and on export.

## CLI and skill

- `layout_engine.py --blank <type> -o page.html`: blank single-type page. No Mermaid, no engine run, no audit; prints `[DONE]`.
- `layout_engine.py --blank all -o playground.html` (alias `--playground`): the multi-type page, starts on the type given by `--start <type>` (default flowchart). `--types a,b` limits it. `--target artifact` works for both.
- `SKILL.md`: a 4-line *Procedure: Blank or playground* for "give me a blank ERD", "I want to sketch diagrams myself", "a page where I can try all types". One command, no type reference to read (cheapest path the skill has).
- `README.md`: a "Playground" link next to the four live examples, and `dev/samples/playground.html` for offline use.

## Phases

**Phase 1: blank pages (small, ships alone).**
1. `blank.json` per type; engines and renderers handle zero items. `blank` fixtures + goldens.
2. `--blank <type>` in `layout_engine.py`; `--extract` on a blank page prints the header line only.
3. Empty-state card with the Minimal / Sample starters.
4. Tests: `check_golden.py`, `check_themes.py` on the blank fixtures, an e2e that opens a blank page of each type, adds one item from the dock, saves, and extracts.

**Phase 2: playground, switch in place.**
1. Split `shell.html` assembly into slots + `<template>` per type + inert source blocks + boot (`assemble_playground()`), sharing code with `assemble_page()` so one-type pages stay byte-identical (golden check).
2. Boot script; `sliceEngineSource` from the chosen block; ERD worker still starts.
3. Type picker, dirty-check prompt, drafts, pending switch, hash fallback.
4. Paste/type Mermaid of another type switches instead of refusing (only on playground pages; single-type pages keep the message).
5. Artifact target: `type-<t>.js` / `.css` fetched on demand; `check_artifact_shape.py` covers it; Save in an artifact republishes with the new `diagramType`.
6. Tests: `e2e_playground.mjs` (switch every pair, draft restored on switch back, unsaved prompt, Save → reopen boots the saved type, Ctrl+V of each type's Mermaid), axe in both modes, page-size budget check.

**Phase 3: live Mermaid panel.** A collapsible left panel with the diagram as Mermaid (from `toMermaid`), editable; typing re-reads with `fromMermaid` (debounced ~400 ms) and redraws, keeping hand-placed positions when ids match (same rule as `--keep-from`). Reader warnings show inline under the text. The first line decides the type, so typing `erDiagram` over `flowchart` switches type through the Phase 2 path.

## Risks and checks

- **Dynamic inline script in a claude.ai artifact.** The boot runs a `<script>` element it creates. Confirm the artifact sandbox allows it before Phase 2 step 2; if not, the artifact target uses `<script src="type-<t>.js">` (also created by boot, same origin), which is the lazy-load path anyway.
- **Live-document Save fallback** (when `fetch(location.href)` fails) would save the injected template copies. Make that fallback empty the slots before serialising, or always save from the pristine copy.
- **Ids across templates**: only one template is live at a time, so duplicates across `<template>` contents are harmless; check that the shell does not query by id before boot fills the slots.
- **Theme lookup** stays per page; all types already share one token set.
- **localStorage keys** (`flowchart-theme`, Auto-Tidy) are already page-wide; fine.

## Open questions

1. Should Save on a playground keep all types (current plan) or offer "Save as single-type page" to cut the file to ~500 KB? Suggest: keep all, plus Export › HTML file (this type only).
2. Default first screen for `--playground`: a blank flowchart, or a type chooser? Suggest the empty-state card with a type row on top, so the first click picks the type.
3. Phase 3 panel in present mode and on phones: hide, or show read-only? Suggest hide.
