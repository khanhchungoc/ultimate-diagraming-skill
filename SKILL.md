---
name: ultimate-diagram
description: "Create, verify, and edit diagrams as one standalone, editable HTML file (drag-and-drop, Auto-Tidy, Save). Supports swimlane flowcharts and sequence diagrams. Use for interactive, shareable diagram pages."
---

# Ultimate Diagram Skill

Produce stakeholder-ready diagrams as standalone HTML files. In the browser, users can drag elements, double-click to edit text, run **Auto-Tidy**, and **Save** the edited diagram back into the HTML file. Opening the file with `?present` hides all editing controls for a read-only view.

**Paths & Workspace Hygiene:**
- `<skill-dir>` means the folder containing this `SKILL.md`. Run every script by its full path (`python "<skill-dir>/scripts/layout_engine.py" ...`).
- **Target Output**: Write ONLY the requested final target HTML file to the user's workspace.
- **Self-Contained HTML**: The generated HTML file is fully self-contained with the JSON embedded inside. An external `.json` file is NOT needed once the `.html` is generated and should not be left in the user's workspace unless the user explicitly requested a `.json` file.
- **Scratch & Temp Isolation**: All intermediate authoring files, trial JSON payloads, and verification screenshot PNGs MUST be written to an external scratch or system temp directory (e.g. `tempfile.gettempdir()` or host scratch dir). NEVER litter intermediate trial files in the user's repository root.

---

## Step 0: Pick the diagram type

Every diagram JSON has a top-level `"diagramType"`. A file without it is read as `flowchart`.

| `diagramType` | Use for | Status | Read before authoring |
|---|---|---|---|
| `flowchart` | Swimlane / cross-functional process flows with decisions and loops | Supported | [types/flowchart.md](references/types/flowchart.md) |
| `sequence` | Messages between participants over time (API calls, system interactions) | Supported | [types/sequence.md](references/types/sequence.md) |
| `erd` | Entities, attributes, relationships | Planned | not available yet |
| `state` | States and transitions | Planned | not available yet |

If the request needs a planned type, say it is not supported yet and do not force it into a flowchart. Read the type reference before writing JSON: it owns the schema, the complexity budget, writing rules and the visual checklist.

---

## Inputs

Expect from the user or an orchestrating agent: the diagram content (actors, steps, decisions; or the equivalent for the type) and a **target path** for the HTML file. Use the path given; do not invent a folder convention.

---

## Procedure: New Diagram

1. **Write the logical JSON directly to a temp/scratch file** using your file-writing tool, following the type reference. Never compute pixel coordinates, and never write custom `.py` wrapper scripts to generate JSON or invoke the CLI. For a flowchart, give **every lane an `icon`** from the type reference's icon table; a lane header without one looks unfinished. The user's requested scope determines the diagram size and granularity; never truncate or omit steps to fit an artificial budget.

2. **Lay out, scaffold, and audit the HTML** (needs Node.js, or Chrome/Chromium as a fallback; `--browser <path>` selects it):
   ```shell
   python "<skill-dir>/scripts/layout_engine.py" --layout <temp_input.json> -o <target.html>
   ```
   `--layout` automatically runs the `--verify` audit (`score ≥ 90/100`, `0` issues, `0` external references) and prints any `[WARN]` lines (such as missing lane icons). Only run `--verify <target.html>` standalone when auditing an existing HTML file without re-laying it out.
   `[ERROR] Layout needs Node.js ... or Chrome`: neither is installed; install one or pass `--browser`. Report it rather than hand-placing coordinates. Once `<target.html>` is generated, delete `<temp_input.json>` unless the user asked to keep it.
   Workflow fidelity comes first: never merge, drop or reroute steps, branches or end states to raise the score. If the complete diagram cannot pass, keep it complete and report the score and the issues behind it.

3. **Layout report + visual review.** One command measures the page (including label overlaps, text size, and ellipsis truncation warnings) and captures a clean screenshot to a temporary path (editing controls hidden, cropped to the diagram, 2x):
   ```shell
   python "<skill-dir>/scripts/render_screenshot.py" --input <target.html> --output <temp_path.png>
   ```
   - **Exit 3, `[ERROR]` overlap**: an edge label overlaps another label or a node. Fix it and re-run.
   - **Exit 4, `[ERROR]` text size**: in a diagram of 12 nodes or fewer, text renders below 11px at Fit. Shorten labels, drop steps or columns, or split it, then re-run.
   - **`[WARN]` truncated text (`...`)**: a node label or lane title overflowed its 2-line box; shorten it per the type reference's character budget and re-run.
   - For large diagrams (> 12 nodes), small text at Fit is only an `[INFO]` line: users view and explore them interactively using pan and zoom on the HTML canvas.
   - **`[WARN] Layout report unavailable`**: the browser returned no DOM (seen with Edge, and rarely on a cold Chrome start). Chrome is tried first; pass `--browser <path-to-chrome>` or do the checks by eye and say so in the report.
   - If the render itself fails, read the error: it names the browser used; retry with `--browser <path>` or a larger `--timeout`. If no browser is available, report that the visual review could not be run instead of skipping it silently.

   Then open the PNG with whatever image-viewing tool your host provides (e.g. `Read` on the PNG in Claude Code) and go through the type's visual checklist. Delete the temporary PNG when review is complete.

4. **Report back** (see [Final Report](#final-report)).

## Procedure: Update an Existing Diagram

Extract, edit and re-layout; know what a re-layout resets; read-only extraction. Follow [editing-and-save.md](references/editing-and-save.md).

---

## Verification Gate

Completion needs every item, each with its evidence type. Do not claim an item the evidence column says you cannot test. The type reference adds type-specific rows.

| # | Check | How it is verified |
|---|---|---|
| 1 | Self-contained: no CDN or external requests | **Automated**: `--verify` (fails on external `src`/`href`/`@import`/`url()`) |
| 2 | Quality score ≥ 90, no audit issues, exit 0 | **Automated**: `--verify` |
| 3 | No edge label overlaps another label or a node | **Automated**: layout report from `render_screenshot.py` (Chrome; exit 3); otherwise by eye |
| 4 | Type-specific layout checks | See the type reference (automated or visual, as stated there) |
| 5 | Save works (Ctrl+S / Save button) | **Not testable headlessly**: needs a user click. State this and ask the user to save once to confirm |

---

## Final Report

Return: output path(s); element counts; audit result (score, exit code); which visual checks you reviewed and the outcome; whether the diagram was split and why; what a re-layout reset (update runs); any `[WARN]` lines left from the audit or layout report; and the Save limitation (not tested by you). The type reference lists any additions.

---

## Resources

| Resource | Path | Purpose |
|---|---|---|
| **Type references** | [references/types/](references/types/) | Schema, budget, writing rules and visual checklist per diagram type |
| **Editing & Save** | [editing-and-save.md](references/editing-and-save.md) | Update procedure, re-layout effects, Save behavior, page modes |
| **Layout & Audit CLI** | [layout_engine.py](scripts/layout_engine.py) | `--layout` (runs the type's JS engine via [engine_runner.py](scripts/engine_runner.py)), `--verify` audit (Python only, no browser; per-type audits in `layout_engine.py` and [audit_sequence.py](scripts/audit_sequence.py)), `--extract`. The page's Auto-Tidy button runs the same engine file. |
| **Screenshot Renderer** | [render_screenshot.py](scripts/render_screenshot.py) | Headless Chrome/Edge: clean 2x PNG plus label-overlap and text-size report |
| **Page shell + type plugins** | [assets/shell/](assets/shell/), [assets/types/](assets/types/) | Shared UI shell (toolbar, pan/zoom, theme, Save, present mode) plus one plugin folder per diagram type. `--layout` assembles them into one standalone HTML file. Theme: toolbar toggle; `?theme=dark` / `?theme=light` forces one. |
| **Examples** | [example-flowchart.json](references/examples/example-flowchart.json), [example-sequence.json](references/examples/example-sequence.json) | Complete input files: a 9-node, 4-lane flowchart with outcomes; a 4-participant sequence with `opt` and `alt` frames. Built pages for people to open live in `dev/samples/` (not installed); the agent only needs the JSON. |

Maintainer material (algorithm notes, the Python/browser parity check) lives in [dev/](dev/) and is not needed to author diagrams.
