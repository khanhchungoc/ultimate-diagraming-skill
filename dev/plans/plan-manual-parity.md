# Plan: everything the AI can set, a person can set in the editor

**Goal.** Starting from a blank flowchart, sequence or ERD, a person can create, read, update and delete everything the AI can write into the diagram JSON, using only the web UI. Fields that only steer the layout (`layout`, `schemaVersion`, box positions) are not part of this.

**Status:** Planned 2026-11-16. Nothing done yet.

Order: A, then B, then C. A and B are the known gaps. C is the audit that confirms nothing else is missing.

## A. Flowchart: an action bar for the selected lane

**Today.** Clicking a lane's name pill selects the lane (`selectLane`, `assets/types/flowchart/flowchart.js`). The pill then shows `.lane-tools` underneath: a reorder grip and a delete button. A lane's `icon` and `color` can only be set in the JSON:

- With no `icon`, `laneIconName()` guesses one from the lane name (`LANE_ICON_GUESS`), falling back to `users`.
- With no `color`, the lane takes the palette colour for its position (`SWATCHES[index % SWATCHES.length]`).

There is no way to change either one in the UI.

**Fix.** While a lane is selected, show an action bar like the ERD and sequence ones, in place of `.lane-tools`:

| Control | What it does | Data |
|---|---|---|
| Icon button (shows the current icon) | Opens a small grid of the lane icons from the "Lane icons" table in `references/types/flowchart.md`, plus **Auto** (guess from the name) | Sets `lane.icon`; **Auto** deletes it |
| Swatch row (`swatchRow` from `shell.js`) | Lane colour; **none** means automatic (colour by position) | Sets `lane.color` to a slot; none deletes it |
| Rename | Starts editing the name, the same as a double-click | `lane.name` |
| Move earlier / later | Moves the lane one place (up/down, or left/right in a top-to-bottom diagram); the grip on the pill still drags it | order of `lanes` |
| Delete (danger) | The existing `confirmDeleteLane`; hidden when this is the only lane | removes the lane |

Details:

- **Shared action bar.** ERD (`abButton` at `erd.js:1307`, `.erd-actionbar` in `erd.css`) and sequence (`abButton` at `sequence.js:1258`, `.seq-actionbar`) each build their own bar. Rather than write a third copy, move the builder into the shell as `ui.actionBar()` / `ui.abButton()` / `ui.abSep()`, and the base styles into `assets/components/actionbar.css`. The flowchart uses the shared one. Move ERD and sequence over in the same change only if their bars render identically afterwards (the goldens confirm it); otherwise leave that for a follow-up.
- **Icon list.** Keep one `LANE_ICONS` array in `flowchart.js`, in the order of the reference table. Add a check to `dev/check_tokens.py` (or a small new `dev/check_lane_icons.py`) that the reference table and the array name the same icons and that every one is in `assets/icons/default.json`.
- **Icon grid.** A popover anchored to the icon button, using the existing popover component (`assets/components/popover.css`). Each cell is a button with the icon name as its `aria-label`; the arrow keys move between cells, Enter picks one, Esc closes. The grid marks the icon now in use, and marks **Auto** when `lane.icon` is unset.
- **Placement.** Above the pill (below it when the pill sits at the top edge of the viewport). The bar follows the pill when `pinLaneHeaders()` moves it. It also works in a top-to-bottom diagram, where lanes are columns.
- **Never shown:** in `?present`, in exports (`data-export-skip`), or while dragging.
- **Undo.** Each change is one undo step, recorded the same way lane renames are now.
- **Save.** `icon` and `color` are already lane fields on disk; check that `toDisk` and `scripts/disk_format.py` keep them, and drop a `color` that equals the automatic one only if the reference says to (today it says "omit it", so keep only what the user picked).
- **Docs.** Update `assets/types/flowchart/help.html` (lane entry) and the Lane row of `references/types/flowchart.md` to say the icon and colour can be changed in the editor.

**Test.** New `dev/e2e_lanes.mjs` (or extend `dev/e2e_shell.mjs`), starting from a blank flowchart:

1. Add a second lane, select it: the bar shows, `.lane-tools` does not.
2. Pick `truck` → `lane.icon === "truck"` and the pill shows it. Pick **Auto** → `icon` gone and the guess is back.
3. Pick swatch 3 → `lane.color === "3"`; pick none → `color` gone and the position colour is back.
4. Move later / earlier changes the order of `lanes`; delete asks to confirm; the last lane has no delete button.
5. Ctrl+Z undoes each change; Save and reload keep them.
6. No bar in `?present` or in an exported SVG; the bar works on touch (`dev/e2e_touch.mjs` pattern).
7. Run `dev/check_contrast.py` and `dev/check_themes.py` (pill ink on every slot is already covered; confirm the icon grid passes in both themes).

## B. ERD: a colour legend you can name

**Today.** `colorKey` is loaded and saved (`ERD_DISK_KEYS`, `erd.js:2448`), and `scripts/audit_erd.py` asks the AI to write it, but `erd.js` never draws it. So a person can tint tables but cannot see or name what each colour means. The sequence diagram already has this (`.seq-key`, around `sequence.js:365`, edited by `editKey`).

**Fix.**

- **One implementation.** Move the sequence key into the shell as `ui.colorKey(container, usedSlots, colorKey, opts)`, with its styles in `assets/components/colorkey.css`. It draws one entry per colour in use (dot + label). An entry without a label is a prompt ("What does Blue mean?") in edit mode, and is left out of `?present` and exports. Sequence switches to it with no visible change (the goldens must not move).
- **ERD.** The colours in use are the `color` of the entities, in `entities` order. Draw the key above the top-left corner of the tables' bounding box, and include it in the export bounds and in Tidy's spacing so it never covers a table.
- **Editing.** Double-click an entry, or select it and press Enter or F2, to edit its label with ERD's `beginEdit`; the edit is one undo step, and Esc keeps the old text. After tinting a table with a colour that has no name yet, the new prompt is visible right away, so the person knows they can name it.
- **Pruning.** When saving, keep only the keys for colours a table still uses, as the sequence diagram does (`toDisk` in `sequence.js`). Do the same in `erd.js` `toDisk` and in the ERD branch of `scripts/disk_format.py`, mirroring `sequence_to_disk`.
- **Overview zoom (below 50%).** The key scales with the canvas like the table names; no special case unless it turns out to be unreadable.
- **Docs.** `assets/types/erd/help.html` (colour swatches entry) and the `colorKey` row of `references/types/erd.md`.

**Test.** Extend `dev/e2e_erd.mjs`, starting from a blank ERD:

1. Add two tables and tint one with swatch 1: a prompt entry for swatch 1 appears.
2. Double-click it, type `Billing`, Enter → `colorKey["1"] === "Billing"`; Ctrl+Z removes it.
3. Clear the colour on every table, Save → `colorKey` is gone from the file.
4. `?present` hides an unnamed entry and shows a named one; an exported SVG contains the named entry.
5. Goldens: update `dev/fixtures/erd/golden/*` with `dev/check_golden.py`, and only for fixtures that use `colorKey`; check the sequence goldens do not change.

## C. Audit: every field the AI can write

List every field from the tables in `references/types/*.md` and record how a person creates, changes and removes it in the editor. Fields that only steer the layout are marked "not needed". Fix each real gap here, or write down why it stays AI-only.

Fields to check first (from a code read, not yet confirmed in the running editor):

| Type | Field | What to check |
|---|---|---|
| Flowchart | node `type` | Can an existing step change shape (Step → Decision, Document...), or only be deleted and replaced? |
| Flowchart | `swimlanes: false` | **Show lanes** turns lanes back on; is there a way to turn them off? |
| Flowchart | edge `feedback` | Layout hint for loop-backs; probably "not needed" if Tidy picks the loop well, otherwise a toggle in the edge's controls |
| Sequence | message `activate`, `until` | Covered by `dev/e2e_activations.mjs`? |
| Sequence | note `place` | Can a note be placed between lifelines by dragging? |
| Sequence | fragment `elseAt` | Covered by **+ branch** (writes `branches`), so "not needed" |
| ERD | relationship `toColumns` | Is it set when a column is dragged onto a non-key column of the parent? |
| ERD | entity `note` (no-PK reason) | Covered by table notes? |

Write the result into this plan as a table (field, how to create, how to change, how to remove, status), and add one e2e case per gap that gets fixed.

## Done when

- Every field in C reads "editor" or "not needed", with a reason for each "not needed".
- `dev/e2e_*.mjs`, `dev/check_golden.py`, `dev/check_contrast.py`, `dev/check_themes.py` and `dev/check_tokens.py` pass.
- Samples rebuilt with `dev/build_examples.py`. Republishing the demo artifacts is a separate step, confirmed with the owner first.
- README "Features" mentions that everything can be edited by hand.
