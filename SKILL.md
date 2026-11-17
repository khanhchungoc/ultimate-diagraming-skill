---
name: ultimate-diagram
version: 1.0.2
description: "Create, verify, edit and read diagrams as one standalone, editable HTML file or claude.ai Artifact (drag-and-drop, Auto-Tidy, Save). Supports swimlane flowcharts, sequence diagrams, ER diagrams (database tables, columns, keys, relationships) and UML use case diagrams (actors, use cases, system boundaries, include/extend). Use for interactive, shareable diagram pages, and to read, summarize or explain an existing diagram page (an .html with a \"diagram-data\" block): run its --extract command, never open the .html whole."
---

# Ultimate Diagram Skill

Turn a process description into one self-contained, editable HTML diagram. You write only the logical JSON; the tooling does layout, styling and the audit.

**Paths and files:**
- `<skill-dir>` is the folder containing this `SKILL.md`. Run scripts by full path (`python "<skill-dir>/scripts/layout_engine.py" ...`; use `python3` where `python` is not on PATH).
- **Workspace**: write only the final HTML there: the user's path, else `<title-slug>.html` in the workspace root. The HTML embeds its JSON; leave no `.json` in the workspace unless the user asked for one.
- **Scratch**: the authoring JSON and the screenshot PNG go to the host's scratch directory (else the system temp directory). Delete them at the end with the shell's native remove command, in one call; do not check the deletion or probe the workspace afterwards.

---

## Output choice (Claude Code only)

Applies only if your tools include `Artifact` (it publishes claude.ai Artifacts). Without it, write the HTML file as below and do not ask. Otherwise decide once, before writing anything:
1. The user already said ("as an artifact", "save to docs/flow.html"): follow it.
2. Else a saved default: `output` in `<project>/.claude/ultimate-diagram.json`, else in `~/.claude/ultimate-diagram.json`. `artifact` or `file`: follow it. `ask` or no file: go to 3.
3. Else ask once with `AskUserQuestion`: **Artifact** (private claude.ai page, editable, Save updates it in place, shareable by link) or **HTML file** (`<title-slug>.html` in the project folder, works offline). If you cannot ask, stop and put the question in your reply; write nothing until the user answers. Keep the answer for the rest of the conversation. If the user says "always", write `{"output": "artifact"}` (or `file`) to `<project>/.claude/ultimate-diagram.json`.

*Artifact output* changes the procedures below only as stated in [Artifact output](#artifact-output).

---

## Pick the diagram type

Every diagram JSON has a top-level `"diagramType"` (missing means `flowchart`).

| `diagramType` | Use for | Type reference |
|---|---|---|
| `flowchart` | Swimlane / cross-functional process flows with decisions and loops | [references/types/flowchart.md](references/types/flowchart.md) |
| `sequence` | Messages between participants over time (API calls, system interactions) | [references/types/sequence.md](references/types/sequence.md) |
| `erd` | Database schema: tables, columns, keys and relationships (crow's-foot), tables colour-coded by domain | [references/types/erd.md](references/types/erd.md) |
| `usecase` | UML use case diagram: who (actors) wants what (use cases) from which system (subject boundary), with include, extend and generalization; use cases coloured by feature area | [references/types/usecase.md](references/types/usecase.md) |

`state` is planned, not supported: say so; do not force it into a flowchart. The type reference owns the schema, writing rules and visual checklist, and names the one example to copy.

---

## Procedure: New Diagram

Make exactly these calls. The type reference, the example it names and the command below are the complete interface: no `--help`, no reading scripts or `dev/`, no test runs on the example, no listing directories, no trying alternative structures.

1. **Read** the type reference, then the one example it names (at the path it gives). Decide the structure once from the type reference.
   - **Trace the requirements** before writing: list each clause from every source as *clause → actor → step, decision, outcome or detail*. A clause joined by "and" (`3 quotes AND budget approval`) is two steps. Every step, decision and outcome maps to a node, edge or message owned by its actor; every business rule, threshold, SLA or approval authority maps to a note, where the type has notes. When sources disagree on an actor, order or figure, follow the more detailed source (step text over a summary table) and record the conflict for the report.
2. **Write the JSON once** to scratch with your file-write tool. Fit every label to the character budget before the first run. No pixel coordinates, no `python -c`, no helper `.py` scripts. Include every step the user's scope asks for.
3. **Run one command**, writing the HTML straight to the target path (needs Chrome, Chromium or Edge; Node.js makes layout faster; `--browser <path>` selects a browser):
   ```shell
   python "<skill-dir>/scripts/layout_engine.py" --layout <scratch.json> -o <target.html> --screenshot <scratch.png>
   ```
4. **Read the output**, last line first. Fix each line it names with a targeted edit to that node, edge or label; never rewrite or redesign the JSON.

   | Output | Action |
   |---|---|
   | `[DONE]` | Go to step 5. |
   | `[INFO]` | None. Small text in a diagram over 12 nodes or participants is expected (pan and zoom). |
   | `[WARN]` truncated text (`...`) | Shorten that label to the budget, re-run step 3. |
   | Any other `[WARN]` | Fix what it names (the type reference has the rule), re-run step 3. |
   | `[FAIL]` score below 90 | Fix the listed issues. Never merge, drop or reroute steps, branches or end states to raise the score: if the complete diagram cannot pass, keep it complete and report the score. |
   | `[ERROR]` overlap (exit 3) | Fix the overlapping edge or message label, re-run step 3. |
   | `[ERROR]` text size (exit 4, 12 nodes or participants or fewer) | Shorten labels or split the diagram (the type reference may name other fixes), re-run step 3. |
   | `[ERROR] Layout needs Node.js ... or Chrome` | Stop. Report it; never hand-place coordinates. |
   | `[WARN] Layout report unavailable` | Do the overlap check by eye and say so in the report. |
   | Render failed | Retry once with `--browser <chrome path>`. If no browser works, report that the visual review could not run. |

5. **View the PNG once** and go through the type's visual checklist. Re-run step 3 only for a failed checklist item.
6. **Stop.** A clean run is final: do not re-word labels, re-run or re-render. Delete the scratch JSON and PNG (keep the scratch HTML when publishing an artifact, see Artifact output), then report.

## Procedure: Read an Existing Diagram

Use to summarize, explain or answer questions about a diagram page: an `.html` file, or a claude.ai artifact link.

0. **Artifact link**: never use WebFetch or curl. Call `Artifact` with `action: "read"` and the `url`; it saves the page to a local file and names it. Use that file as `<page.html>` below. If the artifact belongs to someone else the read returns only a summary and no file: say so, answer from the summary, and offer a new artifact.

1. **Do not open the `.html` with a file-read tool**: almost all of it is editor code. Your first call prints the diagram's meaning (no positions, no editor code):
   ```shell
   python "<skill-dir>/scripts/layout_engine.py" --extract <page.html>
   ```
   If that cannot run, read only the lines the page's line 2 names (the `"diagram-data"` JSON block).
2. Answer from that JSON alone. Read the "Reading the JSON" section of the type reference named by `diagramType` (missing means `flowchart`).

## Procedure: Update an Existing Diagram

Use when the user saved edits in the browser, or asks to change a diagram that already exists.

1. **Extract** the current state to scratch (no manual HTML parsing):
   ```shell
   python "<skill-dir>/scripts/layout_engine.py" --extract <target.html> -o <scratch.json>
   ```
   The output is the authoring JSON, without positions. If the task is only to read the diagram, use *Procedure: Read an Existing Diagram* instead; do not re-layout.
2. **Know what a re-layout resets.** `--layout` recomputes every node's position and the container sizes, so positions the user dragged by hand are lost. Structure the user cares about (order, membership, labels, notes, flags) is kept; the type reference says what else survives. Tell the user before overwriting, and write to a new file name if they might want the old arrangement.
3. **Edit the JSON** and run steps 3–6 of *Procedure: New Diagram*, writing to the same `<target.html>` (or the new name).

---

## Artifact output

- **New**: step 3 uses `--target artifact` and writes to scratch (`-o <scratch>/<title-slug>.html`), never the workspace. After a clean run (step 6), publish with the `Artifact` tool: `file_path` = that HTML, `icon: "chart"`, `capabilities: {artifact: {}, downloads: true}`, and a one-sentence `description`. Delete the scratch JSON and PNG, but keep the scratch HTML until the conversation ends: an update republishes from it.
- **Read**: see *Procedure: Read an Existing Diagram*, step 0.
- **Update**: `Artifact read` (returns the user's latest in-browser saves) → `--extract <saved file> -o <scratch.json>` → edit → `--layout <scratch.json> --target artifact -o <saved file>` → publish again with `url` = the artifact's URL and no `capabilities`. The re-layout warning applies.

---

## Use your brand

Only when the user gives a website URL or brand guide and wants diagrams in that look: read [references/theme.md](references/theme.md) and follow its workflow.

---

## Final Report

About 5 lines: the file, and anything that needs the user's action. Not a log of your checks.

- the output path (for an artifact: its link, and that it is private until the user shares it from claude.ai) and a concise description (type, and participant list);
- assumptions: anything you added or reordered that the source did not state, and each conflict between sources with the version you followed;
- problems only: score if below 100, any `[WARN]` left, labels shortened from the user's wording, a split diagram and why, what a re-layout reset (updates), an overlap check done by eye.