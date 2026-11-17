---
name: ultimate-diagram
version: 1.0.13
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

`state` is planned, not supported: say so; do not force it into a flowchart. The type reference owns the schema and writing rules, and names the one example to copy.

---

## Procedure: New Diagram

Make exactly these calls. The type reference, the example it names and the command below are the complete interface: no `--help`, no reading scripts or `dev/`, no test runs on the example, no listing directories, no trying alternative structures.

1. **Read** the type reference, then the one example it names (at the path it gives). Decide the structure once from the type reference.
   - **Trace the requirements** before writing, following the type reference's structure (for processes: *clause → actor → step, decision, outcome or detail*, splitting clauses joined by "and" such as `3 quotes AND budget approval` into two steps). Map every business rule, threshold, SLA or approval authority to a note. When sources disagree on an actor, order or figure, follow the more detailed source (step text over a summary table) and record the conflict for the report.
2. **Write the JSON once** to scratch with your file-write tool. Keep every label within the type reference's length limit before the first run. No pixel coordinates, no `python -c`, no helper `.py` scripts. Include every step the user's scope asks for.
3. **Run one command**, writing the HTML straight to the target path (needs Chrome, Chromium or Edge; Node.js makes layout faster; `--browser <path>` selects a browser):
   ```shell
   python "<skill-dir>/scripts/layout_engine.py" --layout <scratch.json> -o <target.html> --screenshot <scratch.png>
   ```
4. **Read the last line of the output.** You fix data only: layout is the engine's job. Do not view the PNG (it only feeds the label checks).

   | Last line | Action |
   |---|---|
   | `[NEXT]` | Fix each `[WARN]` line with a targeted edit to the item it names (the type reference has the rule), re-run step 3. Never rewrite or redesign the JSON. |
   | `[DONE]` | Final, even with `[INFO]` lines: report them, never re-word, re-run or re-render for them. Delete the scratch JSON and PNG (keep the scratch artifact folder when publishing an artifact, see Artifact output), then report. |
   | `[ERROR] Layout needs Node.js ... or Chrome`, or render failed | Retry once with `--browser <chrome path>`. Otherwise stop and report it; never hand-place coordinates. |

## Local HTML file: create, read, update, delete

| Action | How |
|---|---|
| **Create** | *Procedure: New Diagram*. Writes `<title-slug>.html` in the project folder. |
| **Read** | *Procedure: Read an Existing Diagram*. `--extract`, never open the `.html` whole. |
| **Update** | *Procedure: Update an Existing Diagram*. `--extract`, edit the JSON, `--layout ... -o <same file>`. Never change the diagram with `Edit` or `Write` on the HTML: it is generated output, and almost all of it is editor code. |
| **Delete** | Delete the file only when the user asks; confirm first. Also delete any scratch files you made. |

---

## Procedure: Read an Existing Diagram

Use to summarize, explain or answer questions about a diagram page: an `.html` file, or a claude.ai artifact link.

0. **Artifact link**: follow *Read* in [references/artifacts.md](references/artifacts.md) (`Artifact` read with `path: "diagram.json"` for split artifacts, or without `path` for legacy single-file pages), then pass the saved `<diagram.json>` or `<page.html>` below.

1. **Do not open the `.html` with a file-read tool**: almost all of it is editor code. Your first call prints the diagram's meaning (no positions, no editor code; works on `.html` or `diagram.json`):
   ```shell
   python "<skill-dir>/scripts/layout_engine.py" --extract <page.html or diagram.json>
   ```
   If that cannot run on an `.html` file, read only the lines the page's line 2 names (the `"diagram-data"` JSON block).
2. Answer from that JSON alone. Read [references/reading.md](references/reading.md) for how to interpret the fields of its `diagramType`.

## Procedure: Update an Existing Diagram

Use when the user saved edits in the browser, or asks to change a diagram that already exists. For a claude.ai Artifact, follow *Update in place* in [references/artifacts.md](references/artifacts.md) to update the same artifact URL without touching editor code. For a local HTML file:

1. **Extract** the current state to scratch (no manual HTML parsing; `--extract` accepts `<target.html>` or `<diagram.json>`):
   ```shell
   python "<skill-dir>/scripts/layout_engine.py" --extract <target.html> -o <scratch.json>
   ```
   The output is the authoring JSON, without positions. If the task is only to read the diagram, use *Procedure: Read an Existing Diagram* instead; do not re-layout.
2. **Know what a re-layout resets.** `--layout` recomputes every node's position and the container sizes, so positions the user dragged by hand are lost. Structure the user cares about (order, membership, labels, notes, flags) is kept; the type reference says what else survives. Tell the user before overwriting, and write to a new file name if they might want the old arrangement.
3. **Edit the JSON** and run steps 3–4 of *Procedure: New Diagram*, writing to the same `<target.html>` (or the new name).

---

## Artifact output

`--target artifact` builds a folder of split files (`index.html`, `diagram.json`, `app.css`, `app.js`) in scratch so diagram data stays separate from editor code. Updating a split artifact updates **in place** on the same artifact URL without reading or re-uploading `app.css` or `app.js`. Read [references/artifacts.md](references/artifacts.md) before creating, reading, updating, upgrading, or deleting an artifact (including the fallback for legacy single-file artifacts).

---

## Use your brand

Only when the user gives a website URL or brand guide and wants diagrams in that look: read [references/theme.md](references/theme.md) and follow its workflow.

---

## Final Report

About 5 lines: the file, and anything that needs the user's action. Not a log of your checks.

- the output path (for an artifact: its link, and that it is private until the user shares it from claude.ai) and a concise description (type, and main actors, participants or tables);
- assumptions: anything you added or reordered that the source did not state, and each conflict between sources with the version you followed;
- problems only: any `[WARN]` left, labels shortened from the user's wording, a split diagram and why, what a re-layout reset (updates);
- every `[INFO]` line, as given.
