# Plan: Sequence diagrams for long, real flows

The sequence type today draws a short call-and-reply exchange well. It cannot express, or stay readable for, a real integration flow. The acceptance case is **Payment v6 Q&B** (sequencediagram.org source, 8 participants, 42 messages, 7 frames, 4,100px tall as a PNG): the plan is what it takes to build that diagram as a page, and to make the page better than the picture.

**Status:** implemented 2026-11-14 (steps 0–6). Open questions settled as proposed: detail shown under the arrow with a Details toggle (1); `collapsed` is saved (2); the nesting limit is 3, a warning above it (3); the source oddities became an `opt` "CreateSystemTask failed" and the loop label kept as in the source (4); the installed copy is not reinstalled here (5). The original sequencediagram.org source was not in the repo, so `dev/fixtures/sequence/payment-phases.json` (and `dev/samples/payment-v6-qb.html`, built from it) reconstructs the case from this plan's description: 8 participants, 42 messages, 7 frames, 4 notes. Deviations:
- The frame kind is chosen in the action bar (one button per kind), not a dock-pop menu on the tag: the shell's dock-pop is wired once at load and frame tags are rebuilt on every render.
- Branch dividers store `{at, y, label}` (the message id is kept so a divider can be selected and dragged).
- An unlabelled `alt` branch still shows "else" at the right; a labelled one shows `[condition]` at the left. One unlabelled branch of an `alt` is written back as `elseAt`, the short form.
- The `actor` kind keeps its pill and gets no icon, so pages saved before this change look the same.
- Steps 4 and 5 shipped as one commit; step 3's engine and renderer shipped with step 1.

## What the acceptance case needs

| In the source | Sequence type today | Gap |
|---|---|---|
| `alt` with three labelled branches (Cancelled / any error / Success) | one unlabelled `elseAt` | no third branch, no branch conditions |
| `group` frames (Register Payment, pre-purchase processing, SPM, Post-payment processing) | `opt`, `alt`, `loop` only | no plain grouping frame |
| A colour per phase | one tint for every frame | phases cannot be told apart |
| `note left of FE: On Q&B Holding page` | no notes | rules, states and SLAs have nowhere to go |
| Labels of three and four lines carrying the payload | one line; the engine widens the gap to fit | the diagram becomes very wide, or the payload is dropped |
| `boundary`, `control`, `entity` | `actor` or `system` | UI, queue, database and external system look alike |
| One call answered in several places (FE → Policy Svc: failed, then success) | the bar closes at the first reply | later replies dangle |
| 42 rows | the participant row scrolls away | below the first screen, no lifeline has a name |
| One picture for every audience | one picture | no overview: a reader takes all 42 messages or none |

## Goals

- The Payment flow can be authored in full from its source, with no step, branch or note dropped.
- At any scroll position a reader can tell which lifeline is which.
- A reader can see the flow as five or six phases first, and open one phase at a time.
- A message can be referred to in a review ("step 17") and the number does not change when a frame is collapsed.
- A message label stays short; the payload is still on the page.
- Pages saved before this change open and look the same.

## Non-goals

- **Create and destroy markers** (`create ServiceBUS`, `destroyafter`). They say little in a business-level flow. Every participant keeps a full-height lifeline.
- **Explicit `activate` / `deactivate`.** Bars stay derived from calls and replies.
- **Participant colours.** The kind's icon tells participants apart; colour is kept for phases.
- **Message arrows that slope**, lost and found messages, gates, references to other diagrams (`ref`).

## Data

All additions are optional. A file without them is laid out exactly as today.

```json
{
  "diagramType": "sequence",
  "title": "Payment v6 Q&B",
  "numbered": true,
  "participants": [
    { "id": "fe",  "name": "Q&B UI",      "kind": "ui" },
    { "id": "bus", "name": "Service Bus", "kind": "queue" }
  ],
  "messages": [
    { "id": "m5", "from": "fe", "to": "pay", "label": "Register payment",
      "detail": "CPA answers, amount, payment method, holding page URL", "kind": "sync" }
  ],
  "fragments": [
    { "id": "f1", "kind": "group", "label": "Register Payment", "color": "yellow", "from": "m2", "to": "m13" },
    { "id": "f5", "kind": "alt", "label": "payment-status = Cancelled", "from": "m23", "to": "m42",
      "branches": [ { "at": "m25", "label": "payment-status = any error" },
                    { "at": "m27", "label": "payment-status = Success" } ] },
    { "id": "f2", "kind": "group", "label": "pre-purchase processing", "from": "m2", "to": "m11", "collapsed": true }
  ],
  "notes": [
    { "id": "n1", "text": "On Q&B Holding page", "over": "fe", "before": "m23" }
  ]
}
```

| Object | Field | Meaning |
|---|---|---|
| Diagram | `numbered` | `true` shows a step number before every message label. The number is the message's position in `messages`, so it is the same whether frames are open or collapsed. |
| Diagram | `showDetails` | `false` hides every `detail` line (the detail becomes the label's tooltip). Missing means shown. |
| Participant | `kind` | adds `ui`, `database`, `queue`, `external` to `actor` and `system`. Each has a small icon in the box; `system` has none. |
| Message | `detail` | one line of parameters or payload, drawn smaller and muted under the arrow. The engine widens the gap for whichever of label and detail is longer. |
| Fragment | `kind` | adds `group` (a named phase; the tag shows the label only) and `par`. |
| Fragment | `branches` | `alt` and `par` only: `[{at, label}]`, each a message id where a further branch starts and its condition. `elseAt` stays valid as the short form of one unlabelled branch. A fragment has one or the other. |
| Fragment | `color` | `blue`, `green`, `yellow`, `red`, `purple`, `gray`. Tints the box and the tag; the same hue at low opacity in both themes. Missing means the current neutral tint. |
| Fragment | `collapsed` | `true` draws the frame as one summary row and hides its messages, notes and inner frames. Saved, so an author can ship a page that opens as an overview. |
| Note | `text`, `over`, `after` / `before` | `over` is a participant id, or two ids to span from one lifeline to the other. `after: m` puts the note under message `m`, inside every frame `m` is in. `before: m` puts it above `m` and above any frame that opens at `m`. With neither, it sits above the first message. |

Rules the audit enforces:

| Rule | Why |
|---|---|
| A branch's `at` is after the frame's first message and no later than its last; no two branches share an `at` | a branch needs at least one message, and the first branch is the frame's own label |
| `branches` only on `alt` and `par` | a `loop` or `group` with a divider has no meaning |
| A note's `over` and `after`/`before` name existing ids | otherwise the note is silently not drawn |
| A collapsed frame does not partly overlap another frame | half a frame cannot be hidden |
| Nesting depth warns above 3 (today the reference says 2, the audit checks nothing) | the Payment case needs `alt` > `group` > `opt` once |

Engine output (never saved): `messages[].hidden`, `fragments[].dividers [{y, label}]` (replaces `elseY`), `notes[].{x, y, w, h}`.

## Layout (`engine.js`)

1. **Gaps.** As today, with a message's width being the longer of its label (plus 26px when `numbered`) and its detail.
2. **Rows.** A message with a detail gets 12px more. A note takes a row of its own: 184px wide (or the span of its two lifelines plus 64px each side), text wrapped by character count, height from the line count.
3. **Branches.** Each branch start inserts the 32px divider row that `elseAt` inserts today, once per branch; the frame is at least as wide as its longest branch label.
4. **Collapsed frames.** The outermost collapsed frame around a message owns it. The frame takes its tag row plus one 44px summary row; every message inside gets that row's `y` and `hidden: true`, so code that sorts or compares messages by `y` keeps working. Frames and notes inside it get no box. Frames around it are laid out as usual.
5. **Frame width.** Also takes in the notes inside the frame.

Activation bars stay in the renderer. One change: a call's bar closes at the **last** matching reply that comes before the caller next sends that callee anything, not the first. A call answered in two `alt` branches then has one bar, and a bar whose reply is inside a collapsed frame ends at the summary row.

## Page behaviour (`sequence.js`, `sequence.css`)

What the page does that the PNG cannot:

1. **Pinned participant row.** Once the top of the diagram is panned off screen, the participant boxes ride at the top of the viewport over an opaque band (`onViewChange`, as the flowchart pins its lane pills). Reset under `body.exporting` and in capture mode, so exports and screenshots are unchanged.
2. **Collapse and expand.** A chevron in every frame tag; a collapsed frame reads `12 messages hidden (steps 2–13)` and expands on click. Works in `?present`, where it is the way to walk an audience through the flow phase by phase.
3. **Step numbers** (toolbar toggle).
4. **Details toggle** (toolbar): overview without payloads, payload on hover.
5. **Focus.** Selecting a participant dims every message that does not touch it. Selecting a message lights its two participant boxes, which matters once the row is pinned.

## Editing

### Review of the editor today

Tested 2026-11-13 on `dev/fixtures/sequence/checkout-with-fragments.json`, driven with real mouse and keyboard input through the DevTools protocol (`Input.dispatchMouseEvent`), not with synthetic DOM events. `dev/e2e_sequence.mjs` passes on the same page because it calls `button.click()` and dispatches `dblclick` straight at the text element; that is why none of this was caught.

| Object | Create | Read / select | Update | Delete |
|---|---|---|---|---|
| **Participant** | Button appends `Participant N` at the far right. No way to insert between two. Not put into edit. | Click selects. Nothing else reacts. | **Rename is broken**: a real double-click never opens the editor. Reorder by drag works. Kind (`actor`/`system`) cannot be changed. | Delete key or dock button. Its messages go with it, with no warning. |
| **Message** | Button only. Nothing selected: `p1 → p2`. Participant selected: to its right neighbour. Both append at the very bottom. Message selected: inserts a **reply in the opposite direction** below it. The user never chooses the two ends or the row. Label is `Message`, not put into edit. | Click on the label or the line selects. | **Rename is broken** (same double-click bug). **Ends cannot be changed at all.** Type cycles call → reply → async with no indication of the current value. Reorder by vertical drag works. | Works. |
| **Frame** | Button wraps **only the one selected message** in `opt`. | Only the tag selects it; the border and the inside do not. | Rename works (the only double-click that does). Kind: select the tag, press Frame again to cycle; not discoverable. **Range cannot be changed** except by deleting messages. **`else` cannot be added, moved or removed.** | Works; messages stay. |
| **Note, detail, branch** | Do not exist. | | | |

Defects, by cause:

1. **Double-click to rename does nothing on messages and participants.** `onSeqPointerUp` calls `render()` after a click with no movement, which rebuilds every element. The second click of the double-click lands on a new element, so the browser's `dblclick` no longer targets the text span and the handler's `closest(...)` finds nothing. Frame tags escape this only because `onSeqPointerDown` returns before arming the drag. Since new messages and participants arrive with placeholder names and are not put into edit, **nothing created in the page can be named with a mouse**. This is the main reason the buttons read as not working.
2. **Buttons never disable and never explain.** Type and Frame with nothing selected do nothing, silently. All four look equally available at all times.
3. **A message cannot be drawn between two chosen participants.** The button decides the ends; there is no retargeting afterwards.
4. **New items can land off screen.** A message is appended at the bottom, a participant at the right; the view does not follow.
5. **A frame can never cover more than one message** unless an agent authored it.
6. **Dragging a message across a frame edge** is undefined: the frame's `from`/`to` are message ids, so dragging a frame's first or last message drags the frame's edge with it, and `elseAt` can end up outside its frame (the engine then drops the divider without a word).
7. **Undo clears the selection**, so undo, look, redo, continue means selecting again each time.
8. **Escape does not clear the selection**; there is no keyboard path to select, edit or move anything.
9. **Ids made in the page** (`m_mwev6vg50`) are saved as they are. The flowchart renames its generated ids on save so the file stays readable to an agent.
10. `.seq-msg-label` has no `touch-action: none`, so on a touch screen a message drag scrolls the page instead.

### Principles

- **Draw it where it goes.** A message is created by dragging from one lifeline to another at the height it belongs. A frame is created around what is selected. No button guesses ends or position.
- **Create means name.** Every created object opens in edit with its placeholder selected. Enter commits, Escape keeps the placeholder.
- **Handles on the selection.** What can be changed about the selected object is shown on it (ends, edges, a small action bar), not hidden behind a dock button that cycles.
- **Nothing silent.** A dock button that cannot act is disabled and its tooltip says what to select.
- **One edit, one undo step**, as the shell requires.

### Step 0: repair (before any new feature)

- A click without movement calls `applySelection()` only, never `render()`. Double-click then works for every text.
- New participant, message and frame open in edit at once.
- Dock buttons disable when they cannot act (`hasSelection`-style check after each input event, as the shell does for Delete), with tooltips that say why.
- The view pans to a created object that is off screen.
- Escape clears the selection. Undo and redo keep it when the object still exists.
- `touch-action: none` on message labels and hit lines.
- `e2e_sequence.mjs` gains a real-input helper in `dev/cdp.mjs` (`Input.dispatchMouseEvent`) and uses it for every click, double-click and drag. A synthetic event may only be used where the comment says why.

### Messages

| Action | Gesture |
|---|---|
| **Create (connect two participants)** | Hovering a lifeline shows a `+` dot that snaps to the gap between two rows. Drag from it to another lifeline: a rubber-band arrow follows, the target lifeline lights up, and the drop line shows the row. Release: a call from the first to the second at that row, label in edit. Release on the same lifeline: a self-message. |
| **Add the reply** | Action bar on a selected call: `↩ Reply`, inserting the reverse dashed message under it (or under the last message of its bar), label in edit. This is the one thing the Message button does today, made explicit. |
| **Retarget** | A selected message shows a round handle at each end. Drag a handle to another lifeline to move that end. Dropping one end on the other's lifeline makes a self-message. |
| **Reverse** | Action bar: `⇄`. |
| **Type** | Action bar: three buttons showing the three line styles (call, reply, async), the current one pressed. Replaces the cycling Type button. |
| **Rename, detail** | Double-click, or Enter on the selection. Tab moves from label to detail. Empty detail removes it. |
| **Reorder** | Vertical drag, as today. Alt+↑ / Alt+↓ on the keyboard. |
| **Delete** | Delete key or the dock button; works on a range. |

The dock's Message button stays as the keyboard and touch path: it is enabled only with a participant or message selected, inserts after the selected message (or at the first row), and opens in edit.

**Moving across frames.** A message belongs to a frame when it sits between the frame's first and last message. The rule after a move:

- Dropped between two messages of a frame: it joins. Dropped outside: it leaves.
- If the moved message was a frame's first or last, the frame's edge stays behind on the neighbour that did not move; a frame whose only message leaves is removed.
- A branch whose `at` message leaves moves to the next message of the frame, or is removed if that would leave a branch empty.
- The drop line is drawn inset to the depth of the frame it would land in, so the user sees which frame they are dropping into at a frame's edge.

### Participants

| Action | Gesture |
|---|---|
| **Create** | Hovering the gap between two participant boxes (or the right end) shows a `+`; click inserts there, name in edit. The dock's Participant button inserts to the right of the selected participant, or at the end. |
| **Rename** | Double-click, or Enter. |
| **Kind** | Action bar on the selected participant: one icon per kind, the current one pressed. |
| **Reorder** | Horizontal drag, as today. |
| **Delete** | With messages: a confirm bubble at the button, `Delete Shop and its 5 messages?`, as the flowchart confirms a lane. Without: at once. |

### Frames

| Action | Gesture |
|---|---|
| **Create** | Select a range (Shift+click a second message, or drag a marquee starting on blank canvas with Shift held), then Frame. One selected message still works. Label in edit. |
| **Select** | The tag, or the frame's border (an 8px hit stroke; the inside stays click-through so panning and messages are unaffected). |
| **Kind** | A menu on the tag (`opt`, `alt`, `loop`, `par`, `group`), using the shell's dock-pop component. Changing away from `alt`/`par` removes the branches, as one undo step. |
| **Range** | A selected frame shows a handle on its top and bottom edge; drag snaps to row gaps. It cannot cross a frame it would only partly overlap. |
| **Branches** | A selected `alt`/`par` shows `+ branch` at its bottom edge: adds a divider above the last message, condition in edit. A divider is selectable, draggable between rows, and Delete removes it (the messages merge into the branch above). Double-click renames. |
| **Colour** | Swatches in the action bar. |
| **Collapse** | The chevron (see Page behaviour). |
| **Delete** | Removes the frame, keeps the messages. Action bar also offers `Delete with messages`. |

### Notes

- Create: Note button with a message selected puts it after that message over the sender; with a participant selected, over it above the first message. Text in edit.
- Move: drag vertically to another row gap, sideways to another lifeline. A handle on its right edge stretches it over a second lifeline.
- Edit: double-click; Shift+Enter for a line break. Delete as usual.

### Selection, keyboard, dock

- **Action bar**: one small floating bar above the selected object, holding only that object's actions (listed in the tables above). It is the single place type, kind, colour, reverse and reply live. Hidden in `?present` and while dragging.
- **Dock**: Participant, Message, Frame, Note (create), then Numbers and Details (view toggles, shown pressed when on), then Delete and Tidy from the shell. Type is removed.
- **Keyboard**: Enter or F2 edits; Tab label → detail; Escape cancels the edit, then clears the selection; ↑ ↓ move the selection through messages, ← → through participants; Alt+↑ ↓ move a message; Delete deletes; Shift+↑ ↓ grows the range.
- **Saving**: generated ids are renamed on save as the flowchart does (`m<next free number>`, `p_<name slug>`, `f<N>`, `n<N>`), with references following; authored ids are never touched. `notes` is never added to a model that has none, so an old page saved without edits is still byte-identical.

### Editing order

Step 0 first, alone: it is small and it is what makes the current buttons usable. Then: drag-to-connect and retarget (the largest gap); frame range, kind menu and branches; action bar and keyboard; notes; id renaming.

## Agent reference (`references/types/sequence.md`, `meta.json` `dataNote`)

- Schema table and example extended with the fields above.
- New writing rules: label is the call, `detail` is the data (one line, no line breaks); a phase of the process is a `group`, coloured only when the source colours or names phases; every source note, rule or state is a `note`; three or more outcomes are one `alt` with `branches`, never nested `alt`s.
- For a diagram over about 20 messages: set `numbered`, and wrap each phase in a `group` so the reader can collapse it. Never author `collapsed: true` unless the user asks for an overview.
- Visual checklist gains: branch labels readable and not under a message label; notes over the right lifeline; no bar left dangling at a branch.
- `example-sequence.json` gains one `detail`, one `branches` and one note, so the one example an agent copies shows them.

## Tests

| Change | Proof |
|---|---|
| Engine | New fixtures `dev/fixtures/sequence/`: `alt-three-branches`, `notes`, `details-numbered`, `collapsed-phase`, `payment-phases` (the acceptance case). Existing four goldens regenerated: only `elseY` → `dividers` may differ, positions must not. |
| Back-compat | A golden check that the four existing fixtures keep every `x`, `y`, `w`, `h`. |
| Audit | Each rule in the table above has a failing fixture or a unit case. |
| Disk format | `disk_format.py` and `toDisk` strip `hidden`, `dividers` and note boxes, and order keys `diagramType, schemaVersion, title, numbered, showDetails, participants, messages, fragments, notes`; `e2e_sequence.mjs` byte-identity check runs on a page that uses every new field. |
| Page (reading) | `e2e_sequence.mjs`: collapse hides messages and keeps numbers, expand restores; pan down pins the row and an SVG export has it unpinned; collapse works in `?present`. |
| Page (repair) | Real input only: double-click renames a message, a participant and a frame; a created object is in edit and on screen; Type/Frame/Message/Note are disabled with nothing to act on; Escape clears; undo keeps the selection. |
| Page (editing) | Real input only: drag lifeline to lifeline creates a call at the dropped row, onto itself a self-message; drag an end handle retargets; Reply and Reverse; insert a participant between two; delete a participant asks first; Shift+click range then Frame; drag a frame edge; add, drag, rename and delete a branch; kind menu; move a message into, out of and off the edge of a frame (frame edge stays, branch follows the rule); notes add, move, stretch; keyboard path for each; saved ids renamed and references intact. |
| Samples | `build_examples.py` rebuild; `dev/samples/payment-v6-qb.html` added. |

## Steps

Each step leaves the tests green and can ship alone.

0. **Repair the editor** (Editing, step 0): double-click, edit on create, disabled states, pan to new, Escape, selection across undo, real-input tests. No model change.
1. **Model and engine**: `branches`, `group`/`par`, `color`, `detail`, `notes`, participant kinds, the activation rule; audit, disk format, renderer for each; fixtures and goldens. After this step the Payment page can be built complete.
2. **Reading a long diagram**: pinned participant row, step numbers, focus, Details toggle.
3. **Collapsible frames**: engine, renderer, `?present`.
4. **Editing messages and participants**: drag to connect, retarget handles, action bar (type, reverse, reply, kind), insert between, delete confirm, the frame-membership rule for moves.
5. **Editing frames and notes**: range selection, edge handles, kind menu, branches, colour, notes, keyboard, id renaming on save, help drawer.
6. **Reference and example** for agents; build the Payment sample through the skill, as an agent would, and fix what the reference failed to say.

Step 0 is independent of everything else and fixes what is broken today. Steps 1 to 3 are where the acceptance case improves. Steps 4 and 5 are the most code; step 4 can follow step 0 directly if editing matters more than the Payment page.

## Open questions

1. **Detail under the arrow, or on demand only?** Under the arrow keeps everything visible and costs 12px a row. The plan does both (shown by default, a toggle to hide). Dropping the toggle saves a button and a top-level flag.
2. **Is `collapsed` saved?** Saved makes "open as an overview" possible and makes a screenshot show the collapsed state. The alternative is view state in `localStorage`, as the flowchart keeps Auto-Tidy.
3. **Nesting depth.** Raise the reference's limit from 2 to 3, or keep 2 and tell the agent to put a failure exit in a note instead of an `opt`?
4. **Source oddities in the acceptance case**, to settle when building the sample: "return processing result (failed)" is unconditional in the source (proposed: an `opt` "CreateSystemTask failed"); the loop is labelled "push data every second" but Policy Svc fetches; `destroyafter BgJob` names a commented-out participant.
5. **Installed copy.** `~/.claude/skills/ultimate-diagram` already differs from this repo. Reinstall after step 1, or only at the end?
