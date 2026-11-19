# Plan: remove the dead note-picking code, and ask which level "Copy as Mermaid" copies

Status: proposed, nothing built yet. Follows `archive/plan-subprocess-depth.md`, which left both items open.

## Goals

- Delete the note-picking mode in the flowchart, ERD and use case editors. Nothing can turn it on any more, so it is dead code.
- When a flowchart has subprocess levels, "Copy as Mermaid" asks whether to copy the current level or all levels.

## 1. Remove the dead note-picking code

Why it is dead: free notes (plan-subprocess-depth, section 8) made the Note tile and the N key create a free note when nothing is selected, instead of waiting for a click on a step, table or use case. A search of `assets/` finds no `setNotePicking(true)`, no `setNotePicking(!notePicking)` and no `notePicking = true`, so `notePicking` is only ever false and the `note-picking` body class is never set. The two earlier e2e checks that used it were already removed.

Remove, in each of `assets/types/flowchart/flowchart.js`, `erd/erd.js`, `usecase/usecase.js`:

- the `notePicking` variable and the `setNotePicking` function, and every call to it (`setNotePicking(false)` in the cancel, Escape, add-note and drop paths);
- the branches that read it: the click handler that gives a note to the clicked element when `notePicking` is true (flowchart near line 2770, ERD near line 1517, use case near lines 990 and 996), `giveNoteTo` where it exists only for that mode (check each: the drop-to-link path still needs its own target handling, so keep what the drop uses), the Escape handler lines, and `wasPicking = notePicking || connectorPicking` (becomes `connectorPicking`);
- the hint in ERD (near line 2260) that tests `!notePicking`;
- the CSS: the `.note-picking` selectors in `flowchart.css`, `erd.css` and `usecase.css` (the dashed hover outline and the copy cursor), and `.note-picking` inside the `:is(.palette-dragging, ...)` lists that hide `.note-add`.

Keep: everything the free-note drop and the link handle use. Before deleting `giveNoteTo`, check that nothing but the picking click calls it.

Also: `help.html` or references text that still describes "click the Note tool, then click a step" (search for it), and rebuild the generated pages in `dev/samples/` with `dev/build_examples.py` so they stop carrying the old code.

Done when: a search for `notePicking`, `setNotePicking` and `note-picking` finds nothing outside archived plans, and the note e2e suites (`e2e_notes`, `e2e_erd`, `e2e_usecase`) still pass.

## 2. "Copy as Mermaid" asks which level

Today the Export menu's Copy as Mermaid (`copyDiagram('mermaid')` in `assets/shell/shell.js` near line 1383) writes the whole file: the main flow with every `sub_` block nested inside. The Python side already has the one-flow form (`--extract --sub`), so the format needs no change.

### Behaviour

- A diagram with no subprocess flows (every other type, and a flowchart with no children): Copy as Mermaid copies at once, exactly as today. No question.
- A flowchart with subprocess flows: clicking Copy as Mermaid opens a small popover anchored to the menu item with two buttons and a Cancel: **This level** and **All levels**. Escape and a click outside cancel.
- **All levels**: today's output, byte for byte (the main flow with nested `sub_` blocks, stock-Mermaid lane ids).
- **This level**: only the flow that is open on screen, as a standalone flowchart:
  - on the main flow: the main flow without any `sub_` blocks, so its subprocess steps are plain `[["..."]]` labels, the same as a subprocess without a child today;
  - on a subprocess tab: that flow alone, with its own lanes, steps and arrows, written as an ordinary one-flow flowchart. Pasting it back into the editor gives that flow as a diagram of its own. Any subprocess steps inside it are plain labels too.
- The button labels name the flow: for example "This level (Verify Income)" on a subprocess tab and "This level (Main flow)" on the main flow, so the choice is clear without reading the tab bar.
- The clipboard write starts inside the click on the chosen button, so it is still inside a user gesture (the popover button click counts; the Export menu click that opened the question does not carry over).
- The "Copied" confirmation says which: "Copied Mermaid (this level)" or "Copied Mermaid (all levels)".

### How

- The shell stays type-agnostic. A plugin may provide `mermaidChoices()` returning `null` (no question) or a list of `{ key, label }`; the flowchart returns the two choices above only when `chartData.flows` exists. The shell shows the popover for a list, then calls `plugin.toMermaid(data, { ..., scope: key })`.
- `assets/types/flowchart/mermaid.js` `toMermaid` gets `opts.scope`: `'all'` (default, unchanged) or `'current'`. For `'current'` it receives data already reduced to one flow by the editor, so the writer only has to skip the `sub_` handling when `children` is absent, which it already does.
- The reduction lives in `flowchart.js` next to `plugin.toDisk`: for the main flow, `toDisk(chartData)` without `children`; for a subprocess tab, a flow built from that tab's `lanes` (with the colours from the actor list), `nodes`, `edges` and `notes`. It reuses the same helpers the save path uses, so ids and key order are those of a normal save.
- Reuse the popover or confirm component already used for the subprocess delete question; add no new component.
- Free notes are still not expressible in Mermaid; unchanged.

### Edge cases

- The popover is not shown in presentation or capture mode (the Export menu is not either).
- Copy as Mermaid is hidden when the clipboard is unavailable, as today.
- Undo and the current tab are not changed by copying.

## 3. Phases

1. Remove the dead code (section 1) in the three editors and their CSS, update docs, rebuild `dev/samples/`.
2. The `mermaidChoices` hook in the shell and the popover, the flowchart's reduction and `opts.scope`, help text and `references/types/flowchart.md` (a short note on copying one level).

The two phases are independent.

## 4. Tests

- Dead code: the three note suites pass; a search finds no `notePicking`.
- `e2e_mermaid`: a flowchart without children copies straight away with no popover; the other types are unchanged.
- `e2e_subprocess` (or `e2e_mermaid` with the subprocess page): with children the popover appears with the right labels; All levels equals today's text exactly; This level on the main flow has no `sub_` block and its subprocess steps are plain labels; This level on a subprocess tab reads back through Paste Mermaid as that one flow, with the same steps and arrows; Escape and Cancel copy nothing and change nothing.
- `dev/test_cli_mermaid.py` still passes (the format is unchanged).

## 5. Playground

Both phases touch `assets/`, so the playground artifact is rebuilt and republished at the end (see `AGENTS.md`).
