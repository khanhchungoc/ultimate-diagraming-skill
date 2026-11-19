# Plan: subprocess nesting up to 4 levels, a calmer tab bar, free notes, and quieter arrow and node editing

Status: proposed, nothing built yet. Builds on `plan-subprocess.md`, which stops at two levels (a main flow plus children) and lists a third level as out of scope "until a real case needs it". This plan is that case.

## Goals

Part A (sections 1 to 4): subprocess depth and the tab bar. Part B (sections 8 to 10): free notes in every diagram but sequence, the arrow label and toolbar, and node anchor points on hover only. The two parts are independent and can ship separately.

- A flowchart can nest subprocesses up to **4 levels**: level 1 is the main flow, level 4 is the deepest allowed.
- On a level-4 flow the editor does not offer the subprocess shape at all, so a fifth level cannot be created by hand.
- The tab bar stops looking like a dangling underline and follows the look of the rest of the chrome (header buttons, zoom dock).
- Part B: a note can be dropped anywhere and linked to nothing; a flowchart arrow gets a double-click label and a small click toolbar instead of a hover "+"; a flowchart step shows its anchor points on hover only.

## Non-goals

- More than 4 levels. The cap is a constant (`MAX_FLOW_DEPTH = 4`), so raising it later is one number plus the tab bar's room.
- Changing the per-tab limits (30 steps, 6 lanes). Each flow at every level obeys them separately.
- Moving a flow to another parent (re-parenting). A flow stays under the step that created it.

## 1. Data model: keep it flat, derive the parent

Today `chartData.children` on disk and `chartData.flows` / `chartData.tabNames` in memory are flat maps keyed by the subprocess step's id (the slug). Keep them flat. The parent of a flow is the flow that holds the `[["..."]]` step whose id equals the slug, so no `parent` field is added and a diagram without nesting is saved and loaded exactly as before. Slugs are already unique across the file, which rules out cycles.

Helpers (one place, mirrored in `scripts/subprocess_flow.py`):

- `parentOf(slug)`: the key of the flow whose nodes contain a step with that id (`''` for the main flow).
- `depthOf(key)`: 1 for the main flow, `1 + depthOf(parentOf(key))` otherwise.
- `canNest(key)`: `depthOf(key) < MAX_FLOW_DEPTH`.

## 2. Editor rules (`assets/types/flowchart/flowchart.js`)

The "one level" assumption is the check `!chartData.tab` in these places; each becomes `canNest(curTab())`:

- Adding a subprocess step from Shapes (`addEmptyChild` call near line 3536), drag onto the canvas or onto an arrow, and paste.
- "Collapse to subprocess" (`updateSubButtons`, near line 5017): hidden when the current flow is level 4.
- `hasChild` (near line 4903): a step opens its child tab on any level, not only from the main flow.

On a level-4 flow:

- The Subprocess tile in the Shapes panel is disabled (not removed, so the layout does not jump), with the title "Subprocess: the deepest level is 4".
- A subprocess step that arrives anyway (Mermaid paste, older file) is a plain subprocess label with no child, the same as a `[["..."]]` step without a `sub_` block today.

Other changes:

- `dropChildOf` (near line 4973) deletes the whole subtree, not one flow, once the user has chosen "Delete everything" in section 4b: deleting a step removes its child, that child's children, and so on, and clears `flows` / `actors` / `tabNames` only when none are left. Undo already restores the whole model, so no extra undo work.
- `tabKeys` and the "Main flow" tab: see section 4.
- `switchTab(PARENT, cur)` ("back") becomes "back to my parent flow, at the step that opened me", using `parentOf`.
- `layoutOtherFlows`, `laneUsedElsewhere`, the id-renaming pass (near line 4707) and the save/load conversion (near lines 4785 to 4835) already loop over every flow, so they need a test, not new code.
- Export "all tabs" walks flows in tree order (a flow, then its children, depth first).

## 3. Mermaid and disk (`mermaid.js`, `scripts/subprocess_flow.py`, `layout_engine.py`)

- Format: a `sub_<slug>` block may now contain another `sub_<slug>` block next to its `lane_` blocks, up to 3 deep below the main flow. The plan-subprocess rule "no `sub_` inside `sub_`" is replaced by "no deeper than level 4".
- Parser: read nested `sub_` blocks into the same flat `children` map. A `sub_` at level 5 is not nested: it keeps the current `[INFO]` for other nested subgraphs, and its step stays a plain label.
- Writer: emit children depth first, each nested inside its parent's `sub_` block. "Copy as Mermaid" stays valid for stock Mermaid.
- `subprocess_flow.py` (`children()`, `--extract`, `--flat`, `--sub`): `--extract` lists the tree as an indented outline; `--flat` expands recursively, deepest first. `--verify` and the layout check add `[WARN]` for a flow deeper than 4, and for a `sub_` block whose parent step is missing at any level.
- Audit: the per-tab limits apply to every flow in the tree.

## 4. Tab bar

### What is wrong now

`.flow-tabs` / `.flow-subtabs` (`flowchart.css`, near line 752) draw a box with a bottom border and rounded bottom corners, and the active tab adds its own 2px blue underline inside 6px of padding. The blue line therefore floats above the box edge and reads as a stray mark, and two nested boxes (main, then subprocess) double the borders. Nothing else in the chrome uses an underline; the header buttons and the zoom dock are filled, rounded, square-edged controls.

### Proposed look (from the sketch)

Nested folder boxes hanging from the header, one box per level on the path, each box inside the one before it:

```
 +-------+--------------------------+
 | Main  |  +-----+---------------+ |
 |       |  | Sub |  +----+----+  | |
 |       |  |     |  |SS1 |SS2 |  | |
```

- The outer box holds the Main flow's tab, then the box of Main's chosen child. That box holds its own tab, then the box of its chosen child, and so on. The innermost box holds the current flow's direct children as chips (SubSub1 and SubSub2 in the sketch).
- Every box has its top edge open, so it reads as hanging from the header, as the current outer and inner boxes already do. Each box wraps the one inside it, so a deeper box is shorter and narrower.
- The active tab is a filled chip (primary tint, primary text, bold). The blue underline goes: it is what dangles today, because it floats inside the box's padding instead of meeting an edge.
- Inactive tabs are plain text and tint on hover, like the zoom dock's buttons. Boxes share one border weight and the dock's shadow, drawn once around the outermost box.
- Clicking a tab in an outer box goes back up to that flow and the boxes inside it collapse to that flow's own children.

### Showing 4 levels

Decided: opening a flow shows only its **direct children**, never grandchildren. Siblings of the current flow are not shown, because only the chosen path is drawn; to reach a sibling, click the parent's tab and pick from its children.

- A flow with no children has no inner box.
- At level 4 the path has four boxes (Main, level 2, level 3, level 4) and level 4 has no inner box, so the bar is at most four boxes deep and about as tall as it is today plus a few pixels per level.
- A long path that is too wide scrolls horizontally, as the bar does today; tab names truncate with an ellipsis at 180px.
- Keyboard: Left and Right move across the tabs in the focused box; Alt+Up goes to the parent flow.

Rejected: a breadcrumb with child chips (loses the folder look you drew), and one row of tabs per level (four stacked rows cover the canvas, and `fitView` would reserve all of them through `[data-overlay-top]`).

## 4b. Deleting a subprocess: ask to merge it into the parent

Today deleting a subprocess step silently deletes its child flow with it (`dropChildOf`, `flowchart.js` near line 4973), and a flow can only be folded back into its parent through the separate Expand button (`expandSubprocess`, near line 5086).

Change:

- **Two ways in, one result.** Deleting a subprocess step that has a child flow (Delete key, the step's delete action, or a lane delete that removes it), and a new **Delete** item in the right-click menu of a subprocess tab, both open the same question.
- **The question** is a small popover (the one `ui.confirm` uses for lane deletes, extended to three buttons) anchored to the step or the tab: "Delete the subprocess "Name"?" with **Merge into parent**, **Delete everything**, and **Cancel**. Escape and a click outside cancel. Nothing is changed until a button is pressed, and each button is one undo step.
- **Merge into parent** runs `expandSubprocess` on the step: the child's steps and arrows take the step's place, its lanes the parent lacks come in, its notes move over, and the step is removed. The child's own children are not touched: they are found by their step id, so they move up one level with their steps (a level-3 flow becomes level 2).
- **Delete everything** removes the step and the whole subtree below it (section 2).
- **When Merge cannot run** (Expand's own checks: the child needs exactly one start pill, and no connector letter may be used in both flows), the Merge button is disabled with that reason as its tooltip, so Delete everything and Cancel remain.
- **When the merged flow would break a limit** (30 steps or 6 lanes in the parent), Merge still works, and the popover says so ("The parent will have 34 steps") so the user chooses with that in view; the audit warns afterwards, as for any oversized flow.
- **No question for an empty child.** A subprocess that was only just added (its child is still the blank start and end pills, no other steps) deletes straight away, as a plain step does.

Right-click menu on a subprocess tab:

- Right-clicking a tab (not the Main flow tab) opens a small menu at the pointer, built from the header's More menu component (`popover.css`), with one item for now: **Delete**. It opens the question above. The Main flow tab has no menu.
- The menu is keyboard reachable: the Menu key or Shift+F10 on a focused tab opens it, Escape closes it, and focus returns to the tab.
- A tab of a flow that is not the current one: the editor first switches to that flow's parent and selects the step, then asks the question, so Merge always runs on the parent flow's own data. If the user cancels, they stay on the parent flow.

## 5. Phases

1. Model and rules: `MAX_FLOW_DEPTH`, `parentOf` / `depthOf` / `canNest`, the guards in section 2, subtree delete, Shapes tile disabled at level 4. Unit-style checks in `dev/test_subprocess.py`.
2. Mermaid and disk: nested `sub_` parse and write, `subprocess_flow.py` tree outline and recursive `--flat`, `[WARN]` for depth over 4. Update `references/types/flowchart.md` and `references/reading.md`.
3. Tab bar: the nested boxes and the filled active chip, the tab right-click menu, and the delete question of section 4b (Merge reuses `expandSubprocess`), then `dev/architecture.md`, `help.html` and the header plan.
4. Examples: rebuild examples, add one 4-level sample.
5. Part B, step 1: anchor points on hover only (CSS plus the touch rule), then the arrow label and toolbar. Both are flowchart-only and need no format change.
6. Part B, step 2: free notes. The disk format (`disk_format.py`, `--extract`, audit) first, then the flowchart, ERD and use case editors one at a time.

## 6. Tests

- `dev/test_subprocess.py`: depth helpers; a 4-level file round-trips (disk, memory, disk) unchanged; a level-5 `sub_` becomes a plain label with an `[INFO]`; deleting a mid-level step removes its whole subtree.
- `e2e_subprocess`: create levels 2, 3 and 4 from Shapes; the Subprocess tile is disabled on level 4 and cannot be added by drag or paste; tab clicks in an outer box go up and select the right step; only direct children show in the innermost box; export of all tabs includes every level.
- Free notes: a free note round-trips (disk, memory, disk) in all three types; Auto Tidy leaves it in place while anchored notes still move; dropping over a step links it, dropping on empty canvas makes it free; dragging a free note onto a step links it; `disk_format.py` rejects a free note with no `pos`. Sequence is not changed (`e2e_sequence` unchanged).
- Arrows: no "+" on hover or at rest; double-click adds and edits a label; click shows the three-button toolbar; Label and Delete work and Delete undoes in one step; the Connector button is absent for connector-adjacent and self-loop arrows.
- Anchor points: hidden on a selected step, shown on hover, shown on a selected step under `hover: none`; still hidden while connecting.
- Deleting a subprocess step with a child asks; Merge gives the same result as Expand (steps, lanes, notes, grandchildren moved up one level); Delete everything removes the subtree; Cancel changes nothing; each is one undo step; an untouched new subprocess deletes without a question; Merge is disabled with a reason when Expand would refuse. Right-click on a subprocess tab shows Delete, the Main flow tab shows no menu, and the menu works from the keyboard.
- Contrast check for the active chip in light and dark (`dev/check_contrast.py`).
- A screenshot of the tab bar at 1, 2 and 4 levels, light and dark, for the review.

## 7. Playground

Touching `assets/` means the playground artifact is republished at the end of each phase that changes what a page runs or looks like (see `AGENTS.md`).

## 8. Free notes (flowchart, ERD, use case; not sequence)

Today a note must explain at least one step, table or use case: it lives in `notes[]` with a link list (`nodes` in a flowchart, `entities` in an ERD, `useCases` in a use case diagram), the first link is its anchor, and a dragged note stores `pos` relative to that anchor. The editors refuse to unlink the last one (flowchart: `flowchart.js` near line 3970; ERD: `erd.js` near line 2151). Sequence diagrams already have "place" notes that stay where they are dropped, so sequence is left alone.

Change:

- A note may be **free**: an empty link list. Its `pos` is then absolute, in the diagram's own coordinates (the same space a step's x/y live in), not relative to an anchor.
- Dropping: the note is dropped where the pointer is released. Released over a step, table or use case it links to it as today; released anywhere else it becomes a free note at that point. Adding with the N key or the dock button still creates an anchored note when something is selected, and a free note at the viewport centre when nothing is.
- A free note keeps its link handle: dragging it onto a step, table or use case links it (it becomes anchored, its `pos` is converted to relative). Unlinking the last link of an anchored note keeps today's rule (blocked), so a free note is only made by dropping.
- No leader line, and no badge on any element, because nothing is linked.
- **Auto Tidy and re-layout do not move free notes.** Anchored notes still follow their anchor and are re-fitted as today, treating free notes as obstacles like nodes and arrows. A free note may end up over a moved step after a tidy; that is accepted and the user drags it.
- Disk: no new key. A note with an empty link list and a `pos` is free. `scripts/disk_format.py` (notes validation and key order for the three types) must accept an empty list, and drop a free note that has no `pos` as invalid. `--extract` prints free notes in a "Notes" section after the flow. The audit and `--verify` must not warn on an empty link list.

## 9. Flowchart arrows: label and toolbar

Today an arrow with no label shows a "+" pill at its midpoint (`edge-label.empty-placeholder`, `flowchart.js` near line 2620); a single click on it starts typing; a selected arrow shows a split chip (Connector) beside it (`buildSplitChip`).

Change:

- **Hover:** no "+" pill. An arrow without a label draws nothing at its midpoint, on hover or otherwise. An arrow with a label looks as today.
- **Double-click** on the arrow (or on its label) opens the label editor at the midpoint, for an empty and a labelled arrow alike. A single click on the midpoint no longer starts typing.
- **Click** on an arrow selects it and shows a small toolbar at the midpoint with three icon buttons: **Connector** (today's split chip, same condition: hidden when either end is already a connector circle or the arrow loops to itself), **Label** (opens the same editor as double-click), **Delete** (removes the arrow, same as the Delete key, one undo step).
- The toolbar replaces `buildSplitChip` and reuses the existing action bar component (`assets/components/actionbar.css`) and the icon set, so it matches the header buttons and the zoom dock. It sits beside the label when there is one, so it never covers the text, and follows the arrow on drag and re-route. It is hidden while an endpoint is being dragged, while the label is edited, and in presentation and capture modes.
- Enter or blur commits the label and Escape cancels, as today. An empty result clears the label and the arrow goes back to drawing nothing.
- Help (`help.html`) and the tooltip text "Double-click to edit condition" are updated to match.

## 10. Flowchart steps: anchor points on hover only

The four anchor points (`.port`, `flowchart.css` near line 391) show on `.flow-node:hover` and on `.flow-node.selected`.

Change: drop `.flow-node.selected .port`, so anchor points show on hover only. The existing rules stay: hidden while an arrow is being dragged or reconnected, with several steps selected, on connector circles, and in presentation mode.

Touch devices have no hover, so without the selected rule they could not start an arrow. Keep the selected-step rule inside `@media (hover: none)` only.

## 11. Doc and reference updates for Part B

`help.html` (flowchart, ERD, use case), `references/types/*.md` (free notes, the arrow label gesture), `references/reading.md` (free notes in the outline), and `dev/architecture.md`.

## Decisions

- The level-4 Subprocess tile is disabled, not hidden, so the layout does not jump.
- The tab bar is nested folder boxes along the path to the current flow, the innermost holding its direct children only, never grandchildren (sketch confirmed).
- Free notes are for flowchart, ERD and use case; sequence keeps its own place notes.
- Auto Tidy never moves a free note.
- The arrow toolbar has three buttons: Connector, Label, Delete.
- Anchor points show on hover only, except on touch devices.
- Deleting a subprocess that has content asks: Merge into parent, Delete everything, or Cancel.
- A subprocess tab has a right-click menu with Delete; the Main flow tab has none.
