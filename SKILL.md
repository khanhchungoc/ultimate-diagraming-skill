---
name: ultimate-diagram
description: "Create, verify, and edit diagrams as one standalone, editable HTML file (drag-and-drop, Auto-Tidy, Save). Supports swimlane flowcharts and sequence diagrams. Use for interactive, shareable diagram pages."
---

# Ultimate Diagram Skill

Turn a process description into one self-contained, editable HTML diagram. You write only the logical JSON; the tooling does layout, styling and the audit.

**Paths and files:**
- `<skill-dir>` is the folder containing this `SKILL.md`. Run scripts by full path (`python "<skill-dir>/scripts/layout_engine.py" ...`; use `python3` where `python` is not on PATH).
- **Workspace**: write only the final HTML there: the user's path, else `<title-slug>.html` in the workspace root. The HTML embeds its JSON; leave no `.json` in the workspace unless the user asked for one.
- **Scratch**: the authoring JSON and the screenshot PNG go to the host's scratch directory (else the system temp directory). Delete them in one command at the end; do not check the deletion or probe the workspace afterwards.

---

## Pick the diagram type

Every diagram JSON has a top-level `"diagramType"` (missing means `flowchart`).

| `diagramType` | Use for | Type reference |
|---|---|---|
| `flowchart` | Swimlane / cross-functional process flows with decisions and loops | [references/types/flowchart.md](references/types/flowchart.md) |
| `sequence` | Messages between participants over time (API calls, system interactions) | [references/types/sequence.md](references/types/sequence.md) |

`erd` and `state` are planned, not supported: say so; do not force them into a flowchart. The type reference owns the schema, writing rules and visual checklist, and names the one example to copy.

---

## Procedure: New Diagram

Make exactly these calls. The type reference, the example it names and the command below are the complete interface: no `--help`, no reading scripts or `dev/`, no test runs on the example, no listing directories, no trying alternative structures.

1. **Read** the type reference, then the one example it names (at the path it gives). Decide the structure once from the type reference.
2. **Write the JSON once** to scratch with your file-write tool. Fit every label to the character budget before the first run. No pixel coordinates, no `python -c`, no helper `.py` scripts. Include every step the user's scope asks for.
3. **Run one command**, writing the HTML straight to the target path (needs Chrome, Chromium or Edge; Node.js makes layout faster; `--browser <path>` selects a browser):
   ```shell
   python "<skill-dir>/scripts/layout_engine.py" --layout <scratch.json> -o <target.html> --screenshot <scratch.png>
   ```
4. **Read the output**, last line first:

   | Output | Action |
   |---|---|
   | `[DONE]` | Go to step 5. |
   | `[INFO]` | None. Small text in a diagram over 12 nodes is expected (pan and zoom). |
   | `[WARN]` truncated text (`...`) | Shorten that label to the budget, re-run step 3. |
   | Any other `[WARN]` | Fix what it names (the type reference has the rule), re-run step 3. |
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
