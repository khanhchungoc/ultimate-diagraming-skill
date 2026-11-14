# Plan: Multi-select steps (delete, move to another lane, reorder)

Today the flowchart selects one thing at a time: one step, one arrow, one note or one lane. This plan lets an author select several steps and then delete them, move them to another lane, or move them to another place in the flow, each as **one edit and one undo step**.

**Status:** implemented 2026-11-14 (phases 1–5). Open decisions taken as proposed: Alt for reorder-on-drop, the box selects what it touches, Shift + click selects a range along the flow. Deviations and details:
- Esc clears a selection of several steps; with one step selected it does what it did before (nothing), so single selection is unchanged.
- `selectInRect` gets a third argument, `start` (true on a box's first call), so a toggle box toggles against the selection it started from while it previews live.
- Ctrl/Cmd + click and Shift + click change the selection without starting a drag; a click (no drag) on one of several selected steps selects only that step.
- Alt + drag onto an arrow is offered for any run, including a run of one connected step. While Alt is held, arrows are not re-routed during the drag (as for an unconnected step), so the target stays put. A non-run Alt-drop puts every step back where it was.
- The new arrow `exit → D` takes the label of the run's old outgoing arrow.
- Manual layout: after a group move, connector circles on any moved step (not only selected circles) go back beside their steps.
- The README has no editing section, so only `help.html` and `architecture.md` were updated.
- Tests: `dev/e2e_multiselect.mjs` uses `loan-application.json` for selection, delete, lane moves and refusals, `cross-lane-zigzag.json` for reorder (the loan flow has no straight 2-step run), and `connector-forward.json` for the connector case; the top-to-bottom cases switch direction in the page.

## Gestures

| Gesture | Result |
|---|---|
| Click a step | Selects only that step (unchanged) |
| **Ctrl/Cmd + click** a step | Adds the step to the selection, or removes it if it is already selected |
| **Shift + click** a step | Selects the run of steps along the arrows from the last clicked step (the anchor) to this one. If no arrow path joins them, it adds the step, the same as Ctrl + click |
| **Shift + drag** on blank canvas | Draws a selection box. Every step the box touches replaces the selection |
| **Ctrl/Cmd + Shift + drag** on blank canvas | Same box, but each step it touches is added or removed (toggled) |
| Plain drag on blank canvas | Pans (unchanged) |
| **Ctrl/Cmd + A** (not in a text field) | Selects every step |
| Esc, or a click on blank canvas | Clears the selection (unchanged) |
| Delete / Backspace, or the dock's Delete | Deletes every selected step |
| Drag any selected step | Moves the whole selection (see [Move to another lane](#move-to-another-lane)) |
| Drag a selected run onto an arrow while holding **Alt** | Moves the run to that place in the flow (see [Reorder](#reorder)) |
| **Alt + ↑ / ↓** | Moves the selection one lane up or down |
| **Alt + ← / →** | Moves a selected run one step earlier or later in the flow |

Why plain drag doesn't draw a box: a blank-canvas drag already pans, and touch and trackpad users rely on it. Shift is the only modifier that a step click doesn't already use when nothing else is selected. With a note selected, Shift + click still links the note to the step, so that combination is never a multi-select.

Ctrl/Cmd + click and Shift + drag also work in auto layout and manual layout alike. All of these gestures do nothing in present mode (`?present`).

## Goals

- Select several steps by click, by range along the flow, or by a box.
- Delete N steps with one key press and undo them with one Ctrl + Z.
- Move N steps to another lane without dragging them one by one.
- Move a run of steps to an earlier or later place in the flow without rewiring arrows by hand.
- Selecting a single step, and everything that depends on it today, keeps working exactly as before.

## Non-goals

- Selecting several arrows, notes or lanes together, or mixing them with steps. Arrows between selected steps are implicitly part of the selection for delete and move.
- Copy, cut, paste and duplicate.
- Multi-select in the sequence diagram. The shell hook below is opt-in, so sequence can adopt it later.
- Any change to the saved file. The selection isn't saved.

## Selection model

`flowchart.js` keeps `selectedNodeId` (used in 15 places: notes, the N key, the connector chip, highlights) as the **primary** step: the step clicked last. A new `selectedNodeIds` set holds the whole selection, and it always contains the primary.

- `selectNode(id)` keeps its meaning: it sets both to that one step.
- New `toggleNode(id)`, `selectRun(fromId, toId)`, `selectNodes(ids, mode)` (`mode` is `replace`, `add` or `toggle`) and `isNodeSelected(id)`.
- `render()` marks `.selected` from the set, not by comparing with `selectedNodeId`.
- Selecting an arrow, note or lane clears the set, as it clears `selectedNodeId` today.
- When more than one step is selected:
  - Note visibility, the N key and Shift + click note linking act on the primary only.
  - Connect ports and the arrow-end handles are hidden, so a drag always means "move the selection".
  - The dock shows the count beside Delete ("Delete 3").
- Styling: the existing `.selected` outline on each step and nothing else, keeping to the restrained colour rule. The primary gets no extra mark.

**Run selection (Shift + click).** Find the shortest path along arrows from the anchor to the clicked step, trying forward first and then backward. Skip feedback arrows, so a loop-back can't turn a short range into the whole loop. Connector pairs count as one hop (circle out → circle in). If there is no path, add the step.

## Shell changes

The shell owns blank-canvas pointer handling, so the selection box lives there behind an optional plugin hook.

| Addition to the plugin contract | Meaning |
|---|---|
| `selectInRect(clientRect, mode)` (optional) | Selects the items that the box (in client coordinates) touches. `mode` is `replace` or `toggle`. If it is missing, Shift + drag pans as before |
| `selectAll()` (optional) | Ctrl/Cmd + A. If it is missing, the browser default runs |

`shell.js`:
- In the blank-canvas `pointerdown` handler, when Shift is held and `plugin.selectInRect` exists, start a box instead of panning. Draw a `.marquee` div in viewport coordinates. On every move, call `selectInRect` so the selection previews live. On `pointerup`, remove the box. Don't call `clearSelection` when a box starts.
- Add Ctrl/Cmd + A to the existing keydown handler. Skip it while typing in a field and in present mode.
- `shell.css`: a 1px dashed outline in the selection colour with a light tint fill.

`flowchart.js` hit test: compare `getBoundingClientRect()` of each `.flow-node` (connector circles included) against the box. Any overlap counts.

Update the plugin contract table in `dev/architecture.md`.

## Delete

`deleteSelection` with more than one step selected:

1. Join each selected connector circle whose pair isn't otherwise removed (the same as deleting one circle today).
2. Remove all selected steps, plus every arrow attached to them.
3. Run `pruneConnectors()` and `pruneNotes()` once.
4. Run `relayout()` once. That calls `updateStatus(true)` once, so the whole delete is one undo step.

There is no bridging: like a single delete today, the arrows around the hole go with it. If a later request asks for "delete and reconnect", it can reuse the lift step from [Reorder](#reorder).

`hasSelection()` is true when the set isn't empty.

## Move to another lane

Generalise `handleNodePointerDown` and `onDragNodeMove` / `onDragNodeUp` from one `draggingNode` to a drag group.

- **Starting the drag.** A pointerdown on a step that is already selected (without Ctrl or Shift) keeps the selection and drags all of it. A pointerdown on an unselected step selects only that step, as today. Ctrl + click and Shift + click change the selection and don't start a drag.
- **The lane offset.** The grabbed step decides the target lane, the same as today. Every other step moves by the same lane offset (lane index difference), held within the first and last lane. If all selected steps are in one lane (the common case), they all land in the target lane. If the selection spans lanes, it keeps its shape.
- **While dragging.** Each step's element moves by the pointer delta (`placeNodeEl` per node) and is re-parented into its new lane track. Arrows re-route once per frame, as today. Snap guides (manual layout) use the grabbed step only. The highlighted lane is the grabbed step's target lane.
- **On drop, auto layout on:** set each node's `laneId`, then run one `relayout()`.
- **On drop, auto layout off:** keep each step's dropped x/y, then `render()` and `updateStatus(true)`.
- **Connector circles** in the selection don't move on their own. After the move, `placeCirclesOnly()` puts them back beside their steps.
- **Alt + ↑ / ↓** applies the same lane offset of ±1 without a drag, and stops at the first and last lane.

## Reorder

With auto layout on, a step's place along the flow comes from the arrows, not from x/y (see the auto layout notes in `architecture.md`). Reordering therefore means rewiring. The plan generalises the existing "insert into an arrow", which today accepts only a new or unconnected step, to a connected **run** of steps.

**What counts as a run.** A set of selected steps with exactly one entry step and one exit step:
- Every arrow coming in from outside the set points at the entry step.
- Every arrow going out of the set leaves from the exit step, and there is at most one such arrow.
- Branches that leave and rejoin inside the set are fine.
- The set has no Start or End step, and no feedback arrow crosses its boundary.

A single connected step is a run of one, which is how "move this step elsewhere in the flow" becomes possible for the first time.

**Gesture.** Drag the run and hold **Alt**. The arrow under the pointer highlights with the existing `insert-target` style and hint. Arrows inside the run, and arrows touching it (`P → entry`, `exit → S`), are not offered. Without Alt, arrows are not offered, so a drag across lanes never rewires by accident. That keeps today's rule: "moving an already-connected node never rewires anything". If the selection isn't a run, Alt shows a hint instead of a target: "Only a connected run of steps (one way in, one way out) can move into an arrow."

**On drop onto arrow `C → D`:**
1. **Lift.** Each arrow `P → entry` from outside is re-pointed to `S` (the target of the single `exit → S`), keeping its id, label and feedback flag. Then `exit → S` is removed. With no `S` (the run ends the flow), the incoming arrows are removed. With no `P`, there is nothing to re-point. Skip any duplicate arrow this would create.
2. **Splice.** `C → D` becomes `C → entry` (keeping its id and label, so a decision's "Yes" stays on the decision's side), and a new arrow `exit → D` is added. If `C → D` was a feedback arrow, the flag moves to `exit → D`, as `insertIntoEdge` already does.
3. **Lane.** The lane offset applies as for a plain move, so one gesture can reorder and change lane together.
4. **Finish.** Run one `layoutDiagram` and `render`, then call `updateStatus(true)` once, and re-pan so the entry step stays under the pointer (the same code as `insertIntoEdge`).

**Alt + ← / →** moves a run past its neighbour along a straight part of the flow. For a run `P → [run] → S`: forward needs `S` to have a single arrow in and a single arrow out, and swaps the run with `S`. Backward does the same with `P`. Anywhere else (a decision, a merge, the start or the end), it shows a hint and does nothing.

**Manual layout (auto layout off).** The same rewiring happens, but steps keep their dropped positions, as they do today for an insert. Tidy lays the result out.

Refactor `insertIntoEdge(node, …)` into `moveRunIntoEdge(ids, edgeId, …)`. The single-node insert becomes the run-of-one case with no arrows to lift.

## Edge cases

| Case | Behaviour |
|---|---|
| Undo mid-drag | Already blocked by `pointerHeld` |
| Undo after a group edit | One snapshot back. Restoring calls `clearSelection` (unchanged) |
| A selected step is deleted by an undo/redo | `render()` drops ids that no longer exist from the set |
| Shift + click with a note selected | Links the note (unchanged); no range selection |
| Ctrl + click on an arrow, note or lane | Behaves as a plain click (no multi-select for those) |
| Box selection while a step label is being edited | The edit is committed first, as for any blank-canvas click |
| Present mode | All of these gestures are off |
| Top-to-bottom diagrams | Every step works in flow terms already (`flowPoint`, `isTB`). Alt + arrow keys follow the screen: in TB, ↑/↓ moves along the flow and ←/→ moves across lanes |

## Phases

1. **Selection model.** `selectedNodeIds`, Ctrl + click, Shift + click run, Ctrl + A, the count on the dock's Delete, and multi-step delete. On its own this already delivers "select several and delete".
2. **Selection box.** The shell hook, `.marquee`, and `selectInRect` in the flowchart.
3. **Group move.** Drag the selection across lanes, plus Alt + ↑ / ↓.
4. **Reorder.** Run detection, `moveRunIntoEdge`, Alt-drag onto an arrow, and Alt + ← / →.
5. **Docs.** The keyboard and mouse lines in `assets/types/flowchart/help.html`, the README's editing section, and the contract table in `architecture.md`.

## Tests

New `dev/e2e_multiselect.mjs` (CDP, like the other e2e scripts), run on `dev/fixtures/flowchart/loan-application.json` laid out:

- Ctrl + click two steps → both `.selected`. Ctrl + click one again → removes it.
- Shift + click → selects the run along the flow between the two. Feedback arrows are not followed.
- Shift + drag a box → selects exactly the steps it touches. A plain drag still pans and selects nothing.
- Ctrl + A → selects every step. Esc → selects none.
- Delete with 3 steps selected → 3 fewer steps, attached arrows gone, then one Ctrl + Z restores all of it.
- Drag 2 steps from lane A onto lane B → both in B after the relayout, one undo step. A selection spanning two lanes keeps its lane offset. Alt + ↓ does the same.
- Alt-drag a 2-step run onto an earlier arrow → the arrows match the expected list, there are no duplicate arrows, the audit score is unchanged or better, and one undo step.
- Refusals: Alt-drag a selection that isn't a run, or one that contains Start or End → hint and no change.
- Connector pair: moving a step with a circle → the circle follows, and the pair is intact.
- Top-to-bottom: repeat the move and reorder cases with `"direction": "TB"`.

Also re-run `e2e_shell.mjs`, `e2e_connectors.mjs` and `e2e_notes.mjs` to confirm single selection, note linking and connectors are unchanged. Run `check_golden.py` as well, though nothing in the engine should change.

## Open decisions

- **Modifier for reorder-on-drop:** Alt (proposed) or no modifier. Without one, any drag that crosses an arrow could rewire connected steps by accident, which is why Alt is proposed.
- **Box hit rule:** touching (proposed; matches Figma and draw.io) or fully inside (matches Visio).
- **Shift + click:** range along the flow (proposed) or plain add, as in most canvas tools. Range is more useful for reorder, since it builds a run in two clicks. Plain add is what most people expect.
