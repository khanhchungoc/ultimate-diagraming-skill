# Plan: everything the AI can set, a person can set in the editor

**Goal.** Starting from a blank flowchart, sequence or ERD, a person can create, read, update and delete everything the AI can write into the diagram JSON, using only the web UI. Fields that only steer the layout (`layout`, `schemaVersion`, box positions) are not part of this.

**Left to the AI on purpose:** flowchart lane icons (`lane.icon`). Picking one from a grid is too cumbersome for what it adds; a lane without one keeps the icon guessed from its name.

**Status:** A, B and C done 2026-11-16 (branch `claude/stoic-volta-cnd4c7`). Two follow-ups left, see the audit table in C: change an existing step's shape (`type`), and stretch an activation bar to a later message (`until`). Not done and not planned here: moving the ERD and sequence bar CSS onto the shared `.actionbar` classes (their builders are shared, their look is not, so goldens were left alone); republishing the demo artifacts.

Order: A, then B, then C. A and B are the known gaps. C is the audit that confirms nothing else is missing.

## A. Flowchart: an action bar for the selected lane (done)

**Today.** Clicking a lane's name pill selects the lane (`selectLane`, `assets/types/flowchart/flowchart.js`). The pill then shows `.lane-tools` underneath: a reorder grip and a delete button. A lane's `icon` and `color` can only be set in the JSON:

- With no `icon`, `laneIconName()` guesses one from the lane name (`LANE_ICON_GUESS`), falling back to `users`.
- With no `color`, the lane takes the palette colour for its position (`SWATCHES[index % SWATCHES.length]`).

There is no way to change either one in the UI.

**Fix.** While a lane is selected, show an action bar like the ERD and sequence ones, in place of `.lane-tools`. Lane icons stay AI-only (see the top of this plan).

| Control | What it does | Data |
|---|---|---|
| Swatch row (`swatchRow` from `shell.js`) | Lane colour; **none** means automatic (colour by position) | Sets `lane.color` to a slot; none deletes it |
| Rename | Starts editing the name, the same as a double-click | `lane.name` |
| Move earlier / later | Moves the lane one place (up/down, or left/right in a top-to-bottom diagram); the grip on the pill still drags it | order of `lanes` |
| Delete (danger) | The existing `confirmDeleteLane`; hidden when this is the only lane | removes the lane |

Details:

- **Shared action bar.** ERD (`abButton` at `erd.js:1307`, `.erd-actionbar` in `erd.css`) and sequence (`abButton` at `sequence.js:1258`, `.seq-actionbar`) each build their own bar. Rather than write a third copy, move the builder into the shell as `ui.actionBar()` / `ui.abButton()` / `ui.abSep()`, and the base styles into `assets/components/actionbar.css`. The flowchart uses the shared one. Move ERD and sequence over in the same change only if their bars render identically afterwards (the goldens confirm it); otherwise leave that for a follow-up.
- **Placement.** Above the pill (below it when the pill sits at the top edge of the viewport). The bar follows the pill when `pinLaneHeaders()` moves it. It also works in a top-to-bottom diagram, where lanes are columns.
- **Never shown:** in `?present`, in exports (`data-export-skip`), or while dragging.
- **Undo.** Each change is one undo step, recorded the same way lane renames are now.
- **Save.** `color` is already a lane field on disk; check that `toDisk` and `scripts/disk_format.py` keep them, and drop a `color` that equals the automatic one only if the reference says to (today it says "omit it", so keep only what the user picked).
- **Docs.** Update `assets/types/flowchart/help.html` (lane entry) and the Lane row of `references/types/flowchart.md` to say the colour can be changed in the editor (the icon still comes from the AI or the name).

**Test (done: `dev/e2e_lanes.mjs`, `dev/e2e_shell.mjs` lane tools updated).** New `dev/e2e_lanes.mjs` (or extend `dev/e2e_shell.mjs`), starting from a blank flowchart:

1. Add a second lane, select it: the bar shows, `.lane-tools` does not.
2. Pick swatch 3 → `lane.color === "3"`; pick none → `color` gone and the position colour is back.
3. Move later / earlier changes the order of `lanes`; delete asks to confirm; the last lane has no delete button.
4. Ctrl+Z undoes each change; Save and reload keep them.
5. No bar in `?present` or in an exported SVG; the bar works on touch (`dev/e2e_touch.mjs` pattern).
6. Run `dev/check_contrast.py` and `dev/check_themes.py` (pill ink on every slot is already covered; confirm the bar passes in both themes).

## B. ERD: an optional colour legend you can name (done)

**Today.** `colorKey` is loaded and saved (`ERD_DISK_KEYS`, `erd.js:2448`), and `scripts/audit_erd.py` asks the AI to write it, but `erd.js` never draws it. So a person can tint tables but cannot see or name what each colour means. The sequence diagram already has this (`.seq-key`, around `sequence.js:365`, edited by `editKey`).

**Fix.** The legend is optional: tinting tables never requires naming the colours, and nothing about the legend shows until someone names a colour.

- **One implementation.** Move the sequence key into the shell as `ui.colorKey(container, usedSlots, colorKey, opts)`, with its styles in `assets/components/colorkey.css`. It draws one entry per colour in use (dot + label). An entry without a label is a prompt ("What does Blue mean?") in edit mode, and is left out of `?present` and exports. Sequence switches to it with no visible change (the goldens must not move).
- **ERD: shown only when named.** Unlike the sequence key, the ERD draws no prompts for unnamed colours. The legend appears only when `colorKey` has at least one non-empty label, and it lists only the named colours (a colour no table uses is not listed). With no names, the diagram looks exactly as it does today. The shared `ui.colorKey` takes an option (`prompts: false`) for this.
- **ERD: placement.** The colours in use are the `color` of the entities, in `entities` order. Draw the key above the top-left corner of the tables' bounding box, and include it in the export bounds and in Tidy's spacing so it never covers a table.
- **Adding a name.** A tinted table's action bar gets a **Name colour** button beside the swatches. It opens the legend (if hidden) with that colour's entry in edit mode. No button for an untinted table.
- **Editing and removing.** Double-click an entry, or select it and press Enter or F2, to edit its label with ERD's `beginEdit`; the edit is one undo step, and Esc keeps the old text. Clearing a label removes that entry; clearing the last one hides the legend and removes `colorKey`.
- **Pruning.** When saving, keep only the keys for colours a table still uses, as the sequence diagram does (`toDisk` in `sequence.js`). Do the same in `erd.js` `toDisk` and in the ERD branch of `scripts/disk_format.py`, mirroring `sequence_to_disk`.
- **Overview zoom (below 50%).** The key scales with the canvas like the table names; no special case unless it turns out to be unreadable.
- **Docs.** `assets/types/erd/help.html` (colour swatches entry: naming is optional). The AI guidance in `references/types/erd.md` and the `scripts/audit_erd.py` warning ("Tables use N but 'colorKey' does not say what it means") are left as they are: the AI still names its domains by default, and the field stays optional in the schema.

**Test (done: `dev/e2e_erd.mjs --blank`).** Extend `dev/e2e_erd.mjs`, starting from a blank ERD:

1. Add two tables and tint one with swatch 1: no legend appears, and Save writes no `colorKey`.
2. **Name colour** on that table, type `Billing`, Enter → the legend shows one entry and `colorKey["1"] === "Billing"`; Ctrl+Z removes it and hides the legend.
3. Name it again, then clear the label → legend gone, no `colorKey` on Save.
4. Name it, then clear the colour on every table and Save → `colorKey` is gone from the file.
5. `?present` and an exported SVG show a named legend, and nothing when there are no names.
6. Goldens: update `dev/fixtures/erd/golden/*` with `dev/check_golden.py`, and only for fixtures that use `colorKey`; check the sequence goldens do not change.

## C. Audit: every field the AI can write (done)

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

**Result (2026-11-16).** Read from the code and the existing e2e tests, and confirmed in the running editor where a case below names its test. Fields that only steer the layout (`layout`, `schemaVersion`, `x`, `y`, `height`, `direction` of the ERD) are not listed: "not needed".

| Type | Field | Create | Change | Remove | Status |
|---|---|---|---|---|---|
| Flowchart | lane `name` | **Lane** button | double-click the name, or **Rename** in the lane bar | lane Delete | editor |
| Flowchart | lane `color` | lane bar swatches | lane bar swatches | the empty swatch | editor (part A, `e2e_lanes.mjs`) |
| Flowchart | lane `icon` | AI | AI | AI | AI-only on purpose (the name guesses one) |
| Flowchart | `swimlanes: false` | lane bar **Hide lanes** on a single lane (was missing) | **Show lanes** (the Lane button) | same | fixed (`e2e_lanes.mjs`) |
| Flowchart | node `label`, `laneId`, order | Shapes dock, drop on an arrow | double-click; drag to another lane; Alt + drag | Delete | editor |
| Flowchart | node `type` | Shapes dock tile | none: an existing step cannot change shape | delete and re-add | **follow-up** (needs a shape picker on the selected step) |
| Flowchart | edge `from`, `to`, `label` | drag from a port | reconnect the ends; double-click the label | Delete | editor |
| Flowchart | edge `feedback` | none | none | none | not needed: a routing hint for loop-backs only; the engine picks the loop edge by traversal order and the arrow means the same either way |
| Flowchart | note `text`, `nodes`; `showNotes` | N, Notes tool | edit; link handle; **Notes** switch | Delete | editor (`e2e_notes.mjs`) |
| Flowchart | `direction` | **Vertical / Horizontal** | same | n/a | editor |
| Sequence | participant `name`, `kind`, `color`, `start`, `end`, `column` | participant button; bar kind and swatches; lifespan handles; drag onto another column / **Own column** | same | Delete | editor (`e2e_sequence.mjs`) |
| Sequence | message `label`, `detail`, `kind`, `from`, `to` | draw lifeline to lifeline; **Reply**; async button | double-click; reverse; end handles | Delete | editor |
| Sequence | message `activate` | none (was missing) | **Bar** button in the message bar | same | fixed (`e2e_activations.mjs`) |
| Sequence | message `until` | none | none | none | **follow-up** (a handle that drags the bar's end to a later message) |
| Sequence | fragment `kind`, `label`, `from`, `to`, `branches`, `color`, `collapsed` | **Frame**; **+ branch** | frame bar, edge handles, chevron | Delete frame | editor |
| Sequence | fragment `elseAt` | none | none | none | not needed: the short form of one unlabelled branch; **+ branch** writes `branches`, which the page reads back the same |
| Sequence | note `text`, `over`, `place`, `after`, `before` | Note tool | double-click; drag between or over lifelines | Delete | editor |
| Sequence | `numbered`, `showDetails`, `lifespans`, `rails`, `colorKey` | view switches; **Focus** sets and clears `rails`; swatches add key entries | same; double-click a key entry | clear the entry | editor |
| ERD | table `name`, `columns` (`name`, `type`, `pk`, `fk`, `unique`, `nullable`), `collapsed`, `color` | Table tool; row bar | double-click; row bar; chevron; swatches | Delete | editor |
| ERD | column `note` | a note dropped on a row (`note.column`) | edit the note | delete the note | editor (inline `note` text becomes a note on load) |
| ERD | table `note` (why there is no `pk`) | a note on the table | edit the note | delete the note | fixed: `audit_erd.py` accepted only `entity.note`, which the page never writes or shows; it now accepts a note on the table too (`test_audit_erd.py`) |
| ERD | relationship `from`, `to`, `columns`, `fromEnd`, `toEnd`, `identifying`, `label` | drag from a row or header | end handles; line bar | Delete | editor |
| ERD | relationship `toColumns` | drop on a non-key column of the parent | same (handle drop) | drop on the key | editor (`e2e_erd.mjs`, "dropping ... on a non-key column") |
| ERD | `detail`, `showTypes`, `showNotes` | **Columns**, **Types**, **Notes** | same | same | editor |
| ERD | `colorKey` | **Name colour** (part B) | double-click an entry | clear the text | editor (part B) |

Two gaps stay open as follow-ups, both small to describe but each a new control that needs its own design: changing an existing step's shape (`type`), and stretching an activation bar to a later message (`until`).

## Done when

- Every field in C reads "editor" or "not needed", with a reason for each "not needed".
- `dev/e2e_*.mjs`, `dev/check_golden.py`, `dev/check_contrast.py`, `dev/check_themes.py` and `dev/check_tokens.py` pass.
- Samples rebuilt with `dev/build_examples.py`. Republishing the demo artifacts is a separate step, confirmed with the owner first.
- README "Features" mentions that everything can be edited by hand.
