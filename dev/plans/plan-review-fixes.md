# Plan: Sequence and ERD fixes from hands-on review

Fixes for problems found while using the hosted sample artifacts (2026-11-15). Each item names the cause found in the code, the fix, and how to test it.

**Status:** Not started.

## Sequence diagram

### S1. A note or a message cannot go at the bottom of a frame

**Cause.** `rowSlots()` (`assets/types/sequence/sequence.js`, ROW GAPS) makes one slot per gap between two messages. When a frame ends at that gap, the slot has a single y and a single index:

- A dropped note is saved as `before: <next message>`, and the engine (`engine.js`, `placeNotes`) places a `before` note outside every frame that the next message is not in. So a note can sit between two messages inside the frame, or after the frame, but never at the end of the frame.
- A new message is inserted at `index`. `frameAtSlot()` counts a frame as containing the slot only when `a < index <= b`, so `index = b + 1` (just after the frame's last message) is always outside the frame. The frame's `to` is never extended.

**Fix.** Split every gap where one or more frames close into one slot per depth: "inside frame F, after its last message" and "outside F". Each slot carries its own y (just above F's bottom edge for the inside slot, just below it for the outside slot) and the frame it belongs to.

- Notes: an inside slot saves `after: <F's last message>` (the engine already places `after` notes inside every frame that message is in). An outside slot saves `before: <next message>` as today.
- Messages: an inside slot inserts at `b + 1` and sets `F.to` to the new message (and the same for each enclosing frame that also ends there, up to the chosen depth).
- The drop line already spans the frame width when `showDropLine` gets a frame, so the two slots read differently on screen.
- The same split applies at a gap where a frame opens (inside, before its first message, versus outside), for symmetry.

**Test.** Add cases to `dev/e2e_sequence.mjs`: drop a note into the inside-end slot of `f1` in `references/examples/example-sequence.json` and check it saves `after: "m6"` and draws inside `f1`; draw a message into the same slot and check `f1.to` is the new message. Update goldens with `dev/check_golden.py` only where the change is intended.

### S2. No + below the last message

**Cause (to confirm).** `onCanvasHover` shows the + only while `pt.y < chartData.layout.height - 30`. The last slot sits 34px below the last message, which is at or past that limit when the lifelines end close to the last message, so the + never appears there.

**Fix.** Compare the pointer with the last slot's y instead of a fixed margin from the layout height, and let the engine leave a little more lifeline below the last row (one `FIRST_GAP`) so there is visible room to start a message. Check the same for a diagram whose last message is inside a frame (S1's outside slot then sits below the frame).

**Test.** In `e2e_sequence.mjs`, hover 34px below the last message on each lifeline and check the + is shown; drag from it and check the message is appended.

### S3. Drawing a message is too sensitive

**Cause.** In `connectDrag`, the target is always `nearestParticipant(pt.x)`, with no distance limit. A small drag that comes back near its own lifeline becomes a self-message once it has gone 30px out, and a drag released anywhere between two lifelines snaps to whichever is closer.

**Fix.**

- A target needs the pointer within a snap distance of its lifeline (about 40px, or a third of the gap between neighbouring lifelines when that is smaller). Outside that, nothing is lit and a release cancels.
- A self-message needs the pointer to go at least 60px out and come back within the snap distance of the starting lifeline. A release while still out to the side cancels.
- Ignore drags shorter than about 8px (treat them as a click).
- Show the lit lifeline only when a release would create something, so the user sees in advance whether the drop counts.

**Test.** `e2e_sequence.mjs`: a 20px drag and release creates nothing; a release midway between two lifelines creates nothing; a release on another lifeline creates a message; out 70px and back creates a self-message.

### S4. Participants: colour-coded lifelines and pills like the flowchart lanes

**Today.** A participant with `color` already paints its box and lifeline from the swatch (`paintSwatch` in the lifeline render). The sample has no participant colours, so everything is grey. The participant row already pins to the top when scrolled (`pinParticipants`), but it pins as boxes over an opaque band, not as pills.

**Fix.**

- Draw each participant as the flowchart's lane pill (`.lane-pill` in `assets/types/flowchart/flowchart.css`): pill radius, swatch pill background and ink, the same halo. Move the pill styles to a shared component (`assets/components/`) so both types use one definition, as the design-token plan requires.
- Lifeline stroke and activation bars take the participant's strong swatch tone.
- Pinned row: pills ride at the top of the viewport with their halo, as lane pills do, and the opaque band is dropped (or kept only as a faint fade). Keep the lifespan behaviour (a pill fades when its lifeline has ended above).
- Participants without a `color` get a palette slot by position when drawn (not saved), so every diagram is colour-coded (D1).
- Give the participants in `references/examples/example-sequence.json` colours, rebuild with `dev/build_examples.py`, and republish the sequence demo artifact.

**Test.** `dev/check_contrast.py` and `dev/check_themes.py` for pill ink on every slot in both themes; `e2e_sequence.mjs` scrolls past the top and checks the pills stay visible and in place horizontally; update goldens.

## ERD

### E1. Remove the canvas frame

**Cause.** `#erd-canvas` in `assets/types/erd/erd.css` is styled as a card (panel background, border, large radius, shadow, 40px margin).

**Fix.** Drop the background, border, radius and shadow so tables sit on the shell's dotted stage, as in capture mode. Keep the margin so Fit leaves room around the tables. Check that exports and screenshots still get a solid background (the export path may rely on the card's fill).

**Test.** `dev/check_overflow.mjs` and one screenshot of the sample in each theme.

### E2. Types as a switch

**Cause.** `#btn-types` (`assets/types/erd/toolbar.html`) is a pressed-state button (`aria-pressed`), which reads as a plain button.

**Fix.** Use the Auto-Tidy switch markup (`btn btn-switch`, `role="switch"`, `aria-checked`, switch track and knob from `assets/components/toggle.css`). Update the handler in `erd.js` (around the `aria-pressed` write) to set `aria-checked`. Review the other view toggles (Notes, Numbers, the sequence Details button) and convert those that switch a view on and off the same way, so the dock is consistent.

**Test.** `dev/e2e_erd.mjs`: click Types, check `aria-checked` flips and the type column hides; keyboard Space toggles it.

### E3. Hovering a table in the zoomed-out view is noisy

**Cause.** The neighbourhood highlight (`erdNeighbourhood` and the code after `const focus = erdFocusId()`) uses two line colours (in and out), coloured rings on related tables in two more colours, tinted key rows, a chip on every joining row, and a peek card on every related table whose joining rows are hidden. Zoomed out, the peek cards stack over the tables and the lines (first screenshot).

**Fix.**

- One highlight colour: the primary accent for the hovered table's lines and the rings of related tables. Direction is already shown by the crow's-foot ends. Unrelated tables dim as today.
- Zoomed out (overview), show no chips and no peek cards on hover. Show them only when zoomed in enough to read the rows, and only for the selected table (not on a passing hover).
- Peek cards, when shown, never cover another table: place them with the existing `erdPlacePeeks` logic, or skip a peek that cannot be placed clear.

**Test.** Screenshot the sample zoomed out with `order` hovered, in both themes, and compare with the first review screenshot. `e2e_erd.mjs`: no `.erd-key-peek` exists while in overview.

### E4. Line end handles hide the crow's feet

**Cause.** `addHandle('from'|'to', …)` puts the end handles exactly at the curve's end points (`rel.curve[0]` and `rel.curve[3]`), on top of the marker. The 12px filled circle covers the crow's foot the user is trying to change (second screenshot).

**Fix.** Place each handle on the curve beyond the marker (about 32px from the table edge, where the marker ends), with a smaller hollow ring. The marker itself stays fully visible while the relationship bar changes it. The handle keeps its drag behaviour (`handleDrag`).

**Test.** `e2e_erd.mjs`: select a line, check each handle's distance from its end point is past the marker, and that dragging a handle still re-points the line.

### E5. Do not label the hovered table's own key rows

**Cause.** On the focus table the joining rows get `key-hl` and a tint, and its parent key row shows a chip such as "← 2 columns". The chip on the table you are looking at describes other tables and reads as part of this table.

**Fix.** On the hovered or selected table, mark joining rows by weight and a light tint only, with no chip. Chips stay on related tables, where "→ customer.id" says where the row points. Check the chip text on related tables still makes sense without the focus table's chips.

**Test.** `e2e_erd.mjs`: hover `order`; no `.erd-key-chip` inside the `order` table; chips present on `customer` and `address`.

## Order of work

1. E1, E2, E5 (small, independent).
2. E4, E3.
3. S3, S2.
4. S1 (largest change to sequence editing).
5. S4 (shared pill component; touches the design tokens and goldens).
6. Rebuild samples with `python dev/build_examples.py`, run the checks, and republish the three demo artifacts linked from the README (same URLs).

## Open decisions

- **D1. Decided (2026-11-15): always colour.** Participants without a `color` get a palette slot by position when drawn.
- **D2.** E3: should hover in the zoomed-in view keep the chips, or should chips appear only for the selected table everywhere?
