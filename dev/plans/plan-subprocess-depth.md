# Plan: subprocess nesting up to 4 levels, and a calmer tab bar

Status: proposed, nothing built yet. Builds on `plan-subprocess.md`, which stops at two levels (a main flow plus children) and lists a third level as out of scope "until a real case needs it". This plan is that case.

## Goals

- A flowchart can nest subprocesses up to **4 levels**: level 1 is the main flow, level 4 is the deepest allowed.
- On a level-4 flow the editor does not offer the subprocess shape at all, so a fifth level cannot be created by hand.
- The tab bar stops looking like a dangling underline and follows the look of the rest of the chrome (header buttons, zoom dock).

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

- `dropChildOf` (near line 4973) deletes the whole subtree, not one flow: deleting a step removes its child, that child's children, and so on, and clears `flows` / `actors` / `tabNames` only when none are left. Undo already restores the whole model, so no extra undo work.
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

### Proposed look

- One bar, not nested boxes: a single rounded container with an all-round 1.5px border and the same shadow as the zoom dock, hanging a few pixels below the header.
- The active tab is a filled chip (primary tint background, primary text, bold), not an underline. Inactive tabs are plain text and tint on hover, like the dock buttons.
- No bottom border on tabs at all, so nothing can dangle.

### Showing 4 levels

The bar shows a **path and siblings**, not every flow:

- A breadcrumb of the ancestors on the left, for example `Main flow › Verify Income › Check Employer`, each ancestor clickable (clicking goes up to it and selects the step that led down).
- Then the current flow's sibling chips (the subprocesses of the same parent), the active one filled.
- Deep paths collapse the middle to `…` with a tooltip listing the hidden names; the bar scrolls horizontally if it still overflows, as it does today.
- Keyboard: Left and Right move between sibling chips (unchanged); Alt+Up goes to the parent flow.

Rejected: one row of tabs per level. Four stacked rows cover the canvas, and `fitView` has to reserve all of them through `[data-overlay-top]`.

## 5. Phases

1. Model and rules: `MAX_FLOW_DEPTH`, `parentOf` / `depthOf` / `canNest`, the guards in section 2, subtree delete, Shapes tile disabled at level 4. Unit-style checks in `dev/test_subprocess.py`.
2. Mermaid and disk: nested `sub_` parse and write, `subprocess_flow.py` tree outline and recursive `--flat`, `[WARN]` for depth over 4. Update `references/types/flowchart.md` and `references/reading.md`.
3. Tab bar: the new look and the breadcrumb, then `dev/architecture.md`, `help.html` and the header plan.
4. Examples: rebuild examples, add one 4-level sample.

## 6. Tests

- `dev/test_subprocess.py`: depth helpers; a 4-level file round-trips (disk, memory, disk) unchanged; a level-5 `sub_` becomes a plain label with an `[INFO]`; deleting a mid-level step removes its whole subtree.
- `e2e_subprocess`: create levels 2, 3 and 4 from Shapes; the Subprocess tile is disabled on level 4 and cannot be added by drag or paste; breadcrumb clicks go up and select the right step; export of all tabs includes every level.
- Contrast check for the active chip in light and dark (`dev/check_contrast.py`).
- A screenshot of the tab bar at 1, 2 and 4 levels, light and dark, for the review.

## 7. Playground

Touching `assets/` means the playground artifact is republished at the end of each phase that changes what a page runs or looks like (see `AGENTS.md`).

## Open questions

- Should the level-4 Subprocess tile be disabled (recommended, the layout stays put) or hidden?
- Is the breadcrumb plus sibling chips acceptable, or do you want every level's tabs visible at once despite the height?
