# Plan: keyboard access for diagram items

**Status:** Deferred (split out from `dev/plans/archive/plan-review-fixes-2026-11-26.md`, Phase 8)  
**Priority:** Low  
**Prerequisites:** Shared item states (`assets/components/item-states.css`) and delegated layer listeners across all six diagram types (completed on `stg` in PR #158).

## Goal

Give keyboard-only users full navigation, editing, nudging, and deletion for diagram items across all six diagram types through one shared shell model.

## Steps

1. **Shared keyboard model in the shell (`assets/shell/keyboard.js` + `assets/components/focus.css`):**
   - Treat the diagram canvas as a single `Tab` stop.
   - Use roving `tabindex` so arrow keys move focus between diagram items.
   - `Enter` edits the focused item, `Delete` / `Backspace` removes it, `Escape` leaves the canvas/selection, and `Shift+Arrow` nudges the selected item (keyboard alternative to dragging).
2. **Per-type item order:**
   - Each diagram type supplies its ordered item list to the shared controller:
     - **Flowchart:** flow order
     - **Sequence:** participants, then messages
     - **ERD:** tables, then columns
     - **Use Case:** actors, then use cases
     - **Gantt:** bars in row order
     - **C4:** align existing card/arrow keyboard reachability to the shared model
3. **Focus rings and screen-reader labels:**
   - Visible focus ring from `--focus-ring` on every focusable item.
   - Reuse each item's existing `aria-label` text.
4. **Docs:**
   - Update known limitations in `ACCESSIBILITY.md`.
5. **Verification:**
   - Add E2E coverage that `Tab`s into each diagram sample, arrows through items, edits one, and deletes one by keyboard.
   - Run `npm run test:fast:changed`, `npm run test:e2e:changed`, light/dark contrast, and `python3 dev/tools/build_examples.py --check` before merging.
