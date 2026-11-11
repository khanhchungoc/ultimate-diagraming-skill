---
name: ultimate-diagram
description: "Create, verify, and edit diagrams as one standalone, editable HTML file (drag-and-drop, Auto-Tidy, Save). Supports swimlane flowcharts and sequence diagrams. Use for interactive, shareable diagram pages."
---

# Ultimate Diagram Skill

Produce stakeholder-ready diagrams as standalone HTML files. In the browser, users can drag elements, double-click to edit text, press **Tidy** (flowcharts also re-arrange themselves while **Auto-Tidy** is on), and **Save** the edited diagram back into the HTML file. Opening the file with `?present` hides all editing controls for a read-only view; `?theme=dark` / `?theme=light` forces a theme (otherwise the toolbar toggle or the OS setting applies).

**Paths and files:**
- `<skill-dir>` is the folder containing this `SKILL.md`. Run scripts by full path (`python "<skill-dir>/scripts/layout_engine.py" ...`).
- **Workspace**: write only the final HTML there: the user's path, else `<title-slug>.html` in the workspace root. The HTML embeds its JSON; leave no `.json` in the workspace unless the user asked for one.
- **Scratch**: the authoring JSON and the screenshot PNG go to the host's scratch directory (else the system temp directory). Delete them in one command at the end; do not check the deletion or probe the workspace afterwards.

---

## Pick the diagram type

Every diagram JSON has a top-level `"diagramType"` (missing means `flowchart`).

| `diagramType` | Use for | Read (both files, in one parallel batch) |
|---|---|---|
| `flowchart` | Swimlane / cross-functional process flows with decisions and loops | `references/types/flowchart.md` + `references/examples/example-flowchart-phases.json` if the source groups steps into Step / Phase / Stage boxes, else `references/examples/example-flowchart.json` |
| `sequence` | Messages between participants over time (API calls, system interactions) | `references/types/sequence.md` + `references/examples/example-sequence.json` |

`erd` and `state` are planned, not supported: say so; do not force them into a flowchart. Paths are relative to `<skill-dir>`.

---

## Procedure: New Diagram

Make exactly these calls. The two files above and the command below are the complete interface: no `--help`, no reading scripts or `dev/`, no test runs on the example, no listing directories, no trial directions or lane modes.

1. **Read** the type reference and its example in one parallel batch (table above). Decide the structure once from the type reference's *Choosing the structure* table.
2. **Write the JSON once** to scratch with your file-write tool. Fit every label to the character budget before the first run. No pixel coordinates, no `python -c`, no helper `.py` scripts. Include every step the user's scope asks for.
3. **Run one command**, writing the HTML straight to the target path (needs Node.js, else Chrome/Chromium; `--browser <path>` selects one):
   ```shell
   python "<skill-dir>/scripts/layout_engine.py" --layout <scratch.json> -o <target.html> --screenshot <scratch.png>
   ```
4. **Read the output**, last line first:

   | Output | Action |
   |---|---|
   | `[DONE]` | Go to step 5. |
   | `[INFO]` | None. Small text in a diagram over 12 nodes is expected (pan and zoom). |
   | `[WARN]` truncated text (`...`) | Shorten that label to the budget, re-run step 3. |
   | `[WARN]` note / icon / `Yes`-`No` on a step | Fix that item, re-run step 3. |
   | `[FAIL]` score below 90 | Fix the listed issues. Never merge, drop or reroute steps, branches or end states to raise the score: if the complete diagram cannot pass, keep it complete and report the score. |
   | `[ERROR]` overlap (exit 3) | Fix the overlapping edge label, re-run step 3. |
   | `[ERROR]` text size (exit 4, 12 nodes or fewer) | Shorten labels, drop columns or split the diagram, re-run step 3. |
   | `[ERROR] Layout needs Node.js ... or Chrome` | Stop. Report it; never hand-place coordinates. |
   | `[WARN] Layout report unavailable` | Do the overlap check by eye and say so in the report. |
   | Render failed | Retry once with `--browser <chrome path>`. If no browser works, report that the visual review could not run. |

5. **View the PNG once** and go through the type's visual checklist. Re-run step 3 only for a failed checklist item.
6. **Stop.** A clean run is final: do not re-word labels, re-run or re-render. Delete the scratch JSON and PNG in one command, then report.

## Procedure: Update an Existing Diagram

Follow [editing-and-save.md](references/editing-and-save.md).

---

## Final Report

About 5 lines: the file, and anything that needs the user's action. Not a log of your checks.

- the output path and a one-line description (type, and node/lane or participant/message counts);
- problems only: score if below 100, any `[WARN]` left, labels shortened from the user's wording, a split diagram and why, what a re-layout reset (updates), an overlap check done by eye;
- always: Save (Ctrl+S / Save button) cannot be tested headlessly; ask the user to save once to confirm.
