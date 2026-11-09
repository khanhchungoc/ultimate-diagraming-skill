---
name: interactive-diagram-skill
description: "Create, verify, and edit swimlane process flowcharts as one standalone HTML file. Use for swimlane, cross-functional or BPMN-style process flows. Not for sequence diagrams, ERDs, or architecture diagrams."
---

# Interactive Swimlane Flowchart Skill

Produce stakeholder-ready swimlane flowcharts as standalone HTML files. In the browser, users can drag nodes across lanes, reorder lanes (▲/▼ or drag), double-click to edit text, reconnect flows from decision-diamond ports, and **Save** the edited diagram back into the HTML file.

**Paths:** `<skill-dir>` below means the folder containing this `SKILL.md`. Run every script by its full path (`python "<skill-dir>/scripts/layout_engine.py" ...`) from the user's project folder, and write outputs there, never inside `<skill-dir>`.

---

## Inputs & Complexity Budget

Expect from the user or an orchestrating agent:
- **Actors / swimlanes**: roles, departments, or systems.
- **Process steps**: actions, start/end milestones, decisions (`?`), and loops.
- **Target path**: destination HTML file (e.g. `<epic-slug>/diagrams/flowchart-<slug>.html`).

**Budget: at most 5 swimlanes and 12 nodes per diagram.** If the process is larger, split it into a Level-1 overview flowchart and Level-2 detail flowcharts and say so in the report. Do not generate a 13+ node diagram unless the user explicitly insists.

---

## Procedure: New Diagram

1. **Extract actors and lanes.** One lane per distinct actor or system. Pick lane colors from [flowchart-spec.md](references/flowchart-spec.md).

2. **Write the logical graph JSON** with `title`, `direction: "LR"`, `lanes`, `nodes`, `edges`.
   - Never compute pixel coordinates. Nodes need only `id`, `laneId`, `type` (`start`, `task`, `decision`, `end`), `label`.
   - Label decision branches (`"Yes"`, `"No"`).
   - Mark a loop-back edge (e.g. "Resubmit") with `"feedback": true` so it always routes through the outer loop corridor. Without it the engine picks the loop edge automatically by traversal order, which may choose the wrong edge of a cycle.
   - Structural reference: [example-flowchart.json](assets/example-flowchart.json).

3. **Lay out and scaffold the HTML:**
   ```shell
   python "<skill-dir>/scripts/layout_engine.py" --layout <input.json> -o <target.html>
   ```

4. **Run the automated audit:**
   ```shell
   python "<skill-dir>/scripts/layout_engine.py" --verify <target.html>
   ```
   Required: exit code `0`, score ≥ 90/100, 0 overlaps, 0 penetrations, 0 overflows, 0 external references.

5. **Layout report + visual review.** Render a PNG; the same command also opens the page in layout-report mode and measures label overlaps and rendered text size:
   ```shell
   python "<skill-dir>/scripts/render_screenshot.py" --input <target.html> --output <target.png> --viewport wide
   ```
   - **`[ERROR]` lines (exit code 3)**: an edge label overlaps another label or a node. This is a hard failure; fix it (see Failure Handling) and re-run.
   - **`[WARN]` lines**: text renders below 9px at "Fit" zoom (hard to read). Do not hide this; reduce nodes or columns, or split the diagram, and mention any remaining warning in the report.
   - **`[WARN] Layout report unavailable`**: the browser returned no DOM (seen with Edge). Chrome is tried first; pass `--browser <path-to-chrome>` or do the checks below by eye and say so in the report.
   - If the render itself fails, read the error: it names the browser used; retry with `--browser <path>` or a larger `--timeout`.

   Then open the PNG with whatever image-viewing tool your host provides (e.g. `Read` on the PNG in Claude Code). The report covers check 1 only; check the rest by eye:
   1. **No label occlusion** (covered by the report): no edge label clipped by a node or overlapping another label.
   2. **No coincident trunks**: parallel segments in one column gap are staggered so labels never stack.
   3. **Distinct decision exits**: branches leave a diamond from different ports (top/right/bottom).
   4. **Lane containment**: every node sits inside its lane with at least 40px bottom margin.
   5. **Orthogonal lines**: same-lane connections are flat, with no diagonal kinks.
   6. **Legible fit** (partly covered by the text-size warning): all lanes and nodes visible and readable at "Fit" zoom.

   If a check fails, change lane order or node/edge structure in the JSON, re-run step 3, and repeat steps 4–5 (at most two repair passes, then report the remaining problem).
   Delete the PNG when done (use Python `Path.unlink()` or your shell's remove command) unless the user asked to keep it.

6. **Report back** (see [Final Report](#final-report)).

---

## Procedure: Update an Existing Diagram

Use when the user saved edits in the browser, or asks you to change a diagram that already exists.

1. Extract the current state (no manual HTML parsing):
   ```shell
   python "<skill-dir>/scripts/layout_engine.py" --extract <target.html> -o <current.json>
   ```
2. Edit the JSON (labels, nodes, edges, lanes) and re-run steps 3–6 above, writing to the same `<target.html>`.
3. **Know what a re-layout resets.** `--layout` recomputes every node's x/y and lane heights, so positions the user dragged by hand are lost. Lane order, lane membership of nodes, labels, and `feedback` flags are kept. Tell the user this before overwriting, and write to a new file name if they might want the old arrangement.
4. If the task is only to read the user's edits (e.g. to update user stories or specs), stop after step 1 and use the extracted JSON; do not re-layout.

---

## Verification Gate

Completion needs every item below, each with its evidence type. Do not claim an item the evidence column says you cannot test.

| # | Check | How it is verified |
|---|---|---|
| 1 | Self-contained: no CDN or external requests | **Automated**: `--verify` (fails on external `src`/`href`/`@import`/`url()`) |
| 2 | Quality score ≥ 90, 0 overlaps/penetrations/overflows, exit 0 | **Automated**: `--verify` |
| 3 | Same-lane connections are flat (collinear) | **Automated**: collinear % and dogleg count in `--verify` |
| 4 | No edge label overlaps another label or a node | **Automated**: layout report from `render_screenshot.py` (Chrome); otherwise visual check 1 |
| 5 | Loop edges use outer corridors; branches exit distinct ports | **Visual**: checks 2–3 |
| 6 | Lane containment, flat lines, legible text | **Visual**: checks 4–6, plus the text-size `[WARN]` from the layout report |
| 7 | Save works (Ctrl+S / Save button) | **Not testable headlessly**: the browser file dialog needs a user click. State this in the report and ask the user to save once to confirm |

---

## Failure Handling

- **Wrong loop edge or odd column placement in a cycle**: set `"feedback": true` on the edge that should loop back, then re-run `--layout`.
- **Label overlap from the layout report, or crowding seen in the screenshot**: reorder lanes or simplify the JSON, re-run `--layout`, and re-check.
- **Screenshot step errors**: see step 5. A missing browser means `--browser <path>`; if none is available, report that the visual review could not be run instead of skipping it silently.
- **Save behavior (tell the user, do not promise silent saving)**: in Chrome/Edge the first **Save** opens a file picker where the user selects the HTML file to overwrite; later saves in that tab write silently. Firefox and Safari have no such API, so Save downloads a new copy that the user must move over the original.

---

## Final Report

Return: the output path(s); node and lane counts; audit result (score, exit code); which visual checks you reviewed and the outcome; whether the diagram was split and why; what a re-layout reset (update runs); and any `[WARN]` lines left from the layout report, and the Save limitation from check 7 (not tested by you).

---

## Resources

| Resource | Path | Purpose |
|---|---|---|
| **Layout & Audit Engine** | [layout_engine.py](scripts/layout_engine.py) | Layout, `--verify` audit, `--extract`. |
| **Screenshot Renderer** | [render_screenshot.py](scripts/render_screenshot.py) | Headless Chrome/Edge PNG plus label-overlap and text-size report. |
| **Interactive Canvas Template** | [flowchart-template.html](assets/flowchart-template.html) | Standalone UI shell: router, drag/drop, save. |
| **Example** | [example-flowchart.json](assets/example-flowchart.json) / [html](assets/example-flowchart.html) | 12-node, 4-lane reference. |
| **Specification Guide** | [flowchart-spec.md](references/flowchart-spec.md) | Schema, node types, lane colors. |
| **Algorithm Guide** | [layout-algorithm-guide.md](references/layout-algorithm-guide.md) | Layering, port assignment, label placement. |
