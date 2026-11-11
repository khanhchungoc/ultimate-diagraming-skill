---
name: ultimate-diagram
description: "Create, verify, and edit diagrams as one standalone, editable HTML file (drag-and-drop, Auto-Tidy, Save). Supports swimlane flowcharts and sequence diagrams. Use for interactive, shareable diagram pages."
---

# Ultimate Diagram Skill

Produce stakeholder-ready diagrams as standalone HTML files. In the browser, users can drag elements, double-click to edit text, run **Auto-Tidy**, and **Save** the edited diagram back into the HTML file. Opening the file with `?present` hides all editing controls for a read-only view; `?theme=dark` / `?theme=light` forces a theme (otherwise the toolbar toggle or the OS setting applies).

**Paths & Workspace Hygiene:**
- `<skill-dir>` means the folder containing this `SKILL.md`. Run every script by its full path (`python "<skill-dir>/scripts/layout_engine.py" ...`).
- **Target Output**: Write ONLY the final target HTML file to the user's workspace (use the user-specified path, or default to `<title-slug>.html` in the workspace root).
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

If the request needs a planned type, say it is not supported yet and do not force it into a flowchart. The type reference owns the schema, the complexity budget, writing rules and the visual checklist, and names the example file to copy the shape from. Nothing else is needed: the scripts are used only through the commands below, and `dev/` is maintainer material.

---

## Procedure: New Diagram

Target output path: use the path specified by the user, or default to `<title-slug>.html` in the workspace root if omitted.

> **Recipe (about 7 tool calls):** read the type reference → read the one example it points you to → one JSON write → one `layout ; render` command → one image view → one cleanup command → report.
> Do not read `assets/` or `scripts/` source, run `--help`, list the skill directory, or read `icons.json`. Everything you need is in the type reference and its example. Decide the structure once from the type reference; do not trial other directions or lane modes.

0. **Read the type reference** from Step 0, then **the one example it points you to** for your source. Read no other files.

1. **Write the logical JSON once** to the host scratch directory (never `%TEMP%` or the workspace) using `write_file`, following the type reference. Fit every label to the type reference's character budget **before** the first layout. Never compute pixel coordinates, never use inline `python -c`, and never write `.py` wrapper scripts to generate JSON or invoke the CLI (multi-line `-c` breaks on Windows PowerShell quoting). The user's requested scope determines the diagram size and granularity; never truncate or omit steps to fit an artificial budget.

2. **Lay out, scaffold, and audit the HTML** (needs Node.js, or Chrome/Chromium as a fallback; `--browser <path>` selects it):
   ```shell
   python "<skill-dir>/scripts/layout_engine.py" --layout <temp_input.json> -o <target.html>
   ```
   `--layout` automatically runs the `--verify` audit (`score ≥ 90/100`, `0` issues, `0` external references) and prints any `[WARN]` lines (such as missing lane icons). Never run `--verify` after `--layout`; use it standalone only to audit an existing HTML file. Chain steps 2 and 3 in one command (`layout ; render`).
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

   Then open the PNG once with your image-viewing tool and go through the type's visual checklist.

   **Stop when clean.** If `--layout` scores ≥ 90 with no `[WARN]` or `[ERROR]` and the screenshot passes the checklist, you are done. Do not re-word labels, re-run the layout or re-render. Re-run only on a `[WARN]`/`[ERROR]`, a failed checklist item, or a user request.

   Delete the PNG and scratch JSON in one command. Do not verify the deletion or probe the workspace afterwards (`Test-Path`, `dir`, `git status`).

4. **Report back** (see [Final Report](#final-report)).

## Procedure: Update an Existing Diagram

Extract, edit and re-layout; know what a re-layout resets; read-only extraction. Follow [editing-and-save.md](references/editing-and-save.md).

---

## Verification Gate

- `--layout` and the render command enforce self-containment (no external requests), the score ≥ 90, label overlaps and text size. Fix what they report; if the render's layout report was unavailable, say the overlap check was done by eye.
- The type reference's visual checklist is checked on the screenshot.
- Save (Ctrl+S / Save button) cannot be tested headlessly. Say so and ask the user to save once to confirm.

---

## Final Report

Keep it short, about 5 lines. The user wants the file and anything that needs their action, not a log of your checks. Return:

- the output path(s) and a one-line description (type, and node/lane or participant/message counts);
- problems only: audit score if below 100, any `[WARN]` left, labels you shortened from the user's wording, a split diagram and why, what a re-layout reset (update runs). Say nothing about checks that passed.
