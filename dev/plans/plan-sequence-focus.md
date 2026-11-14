# Plan: Narrower, more focused sequence diagrams (lifespans, rails, simpler message types)

A long sequence diagram is as wide as all of its participants, all the way down, although a reader at any point is looking at a few of them. This plan makes a sequence diagram narrower where it can be, and makes the part the reader is looking at take the space. It also removes a control the editor does not need: the three-way message type picker.

**Status:** proposed 2026-11-14; all open questions settled as proposed the same day. Nothing is implemented. It revisits one non-goal of `archive/plan-sequence-v2.md` ("Create and destroy markers"), on new evidence.

## What the acceptance case says

Measured on `dev/samples/payment-v6-qb.html` (8 participants, 42 messages, at least 200px between lifelines, so about 1,700px wide):

| Participant | Takes part in messages | Rows alive |
|---|---|---|
| Customer, Q&B UI | 1–41 | 41 |
| Policy Svc | 2–40 | 39 |
| Payment Svc | 6–42 | 37 |
| Policy DB | 3–34 | 32 |
| Service Bus | 19–42 | 24 |
| SPM | 7–16 | 10 |
| Background Job | 27–36 | 10 |

- **Lifespans alone save little here.** At most 7 of the 8 are alive at once. Only SPM and Background Job never overlap, so ending and starting lifelines saves one column of eight. A flow that hands over from one set of systems to another (onboarding, then billing, then support) saves more, but this one doesn't.
- **What a reader looks at is much smaller.** Any 6 consecutive messages involve 3 to 6 participants (4.8 on average). Phases involve 3 to 7: "pre-purchase processing" uses 3 and "SPM" uses 4.

So the plan has two parts.

1. **Lifespans** are honest: a lifeline exists only while its participant takes part. As a bonus, participants that never overlap can share a column.
2. **Rails** are the main lever for width. A participant with nothing to show in the visible part of the diagram shrinks to a thin rail. "Visible" means not inside a collapsed frame. Collapse, and a new **Focus** on a phase, decide what is visible, not the scroll position.

## Goals

- Collapsing the other phases makes a diagram narrower. "Focus on SPM" in the acceptance case is about 40% narrower: 4 full columns and 4 rails.
- A lifeline is drawn only while its participant takes part, when the author asks for it.
- Participants whose lifespans never overlap can share one column, when the author asks for it.
- The pinned participant row names only the lifelines alive at the rows on screen, and it never names a lifeline that is not there.
- A message's kind is right without the author picking it: a call is a call, the answer to a call is its reply.
- Pages saved before this change open and look the same.

## Non-goals

- **Columns that move while the reader scrolls.** It is tempting to compact the diagram to whatever is on screen, but lifelines that slide sideways mid-scroll break the one thing a sequence diagram promises: a participant is a fixed vertical line. It would also make a screenshot depend on the scroll position. Rejected.
- **Free authoring of create and destroy points** that disagree with the messages (a lifeline that starts long before its first message). A lifespan is derived from the messages, with one override (see [Data](#data)).
- **New arrowhead styles.** Kinds stay `sync`, `reply` and `async`.
- **Participant colours** (still a v2 non-goal).

## Part 1: drop the message type picker

Today a selected message's action bar opens with three buttons: Call, Reply, Async. They change the arrowhead and dash, and with them the activation bars. In practice the kind follows from the message's position in the flow, so the picker is mostly a chance to get it wrong.

- **Drawn or added messages get their kind from the flow.** *(Done 2026-11-14 for drawn messages, with drawing from any lifeline or activation bar.)* A message drawn from B to A while A's call to B is still open (no reply yet, and A has sent B nothing since) becomes that call's **reply**. Any other message is a **call**. The existing **Reply** button keeps adding the answer under a call.
- **Moving or retargeting a message does not change its kind.** If an author drags a reply somewhere else, it stays a reply. The audit already warns about a reply that answers no call.
- **Async becomes one toggle,** shown only on a call or an async message: "No reply expected" (on = `async`). Async is rare, and agents set it in the data, so it doesn't need a slot of its own.
- **Reverse** stays. Reversing a reply that has turned back into an open call's direction leaves it a reply, and the audit decides whether it is valid.
- The action bar loses two buttons and gets narrower. That matters on a phone.
- **Data:** no change. `kind` stays in the file, and agents keep writing it.

## Part 2: lifespans, shared columns and rails

### Data

All additions are optional. A file without them lays out exactly as today.

```json
{
  "diagramType": "sequence",
  "lifespans": true,
  "participants": [
    { "id": "spm", "name": "SPM", "kind": "external" },
    { "id": "job", "name": "Background Job", "kind": "system", "column": "spm" },
    { "id": "bus", "name": "Service Bus", "kind": "queue", "start": "m15" }
  ]
}
```

| Field | Meaning |
|---|---|
| `lifespans` (top level) | When `true`, each lifeline runs from the participant's first message to its last, not from the top of the diagram to the bottom. Default `false`, which is today's look. |
| `column` (participant) | The id of an earlier participant whose column this one reuses. Valid only with `lifespans: true` and when the two lifespans don't overlap, notes included. The audit refuses an overlap. |
| `start` / `end` (participant) | A message id that moves the start earlier or the end later than the derived one. Use it for a participant that exists before it is first called, such as a queue that is created and then idles. It can only widen a lifespan, never cut a message off. |

Collapse is already saved per frame (`collapsed`, from v2). Rails need no new field: a participant is a rail when it has nothing to show in the expanded part of the diagram.

### Layout (`engine.js`, and `layout_engine.py` where it mirrors it)

1. **Lifespan** per participant: the rows of its first and last message, any note attached to it, and `start`/`end`. A collapsed frame counts as its summary row.
2. **Columns:** one per participant, except one with `column`, which takes its host's. The left-to-right order is the array order of the participants that own a column. The gap between columns is sized from the labels in each column pair over the rows where both are alive, so a shared column does not widen the gaps for rows where it is idle.
3. **Rails:** a participant with no message, note or bar outside collapsed frames gets a rail column (`RAIL_W`, about 36px) in place of `BOX_W` and a full gap. A collapsed frame's summary row spans rails like any other column.
   - A column with two participants is a rail only when both qualify.
   - With every frame expanded there are no rails, so the layout is today's.
4. **Header boxes:** with `lifespans: true`, a participant's box is drawn at the top of its lifespan, not in the top row:
   - It sits in a header slot of `BOX_H` inserted above the participant's first row, the way a note takes a row today.
   - Participants that start in the top rows stay in the top row as now.
   - A lifeline that ends gets a short end cap: a 12px horizontal tick, not the UML ×, which reads as an error on a business diagram.
5. Row numbering (`numbered`) is unchanged. A header slot is not a step.

### Page (`sequence.js`, `sequence.css`)

- **Rails** show the participant's kind icon and its name written vertically in the pinned row. Hovering a rail (or long-pressing it on touch) shows the full name.
  - Clicking a rail selects the participant. Its frames stay collapsed, but the action bar offers "Show" (see Focus).
  - The lifeline of a rail is a faint dotted line.
- **Focus** is a new button on a frame's tag and in the frame's action bar:
  - It collapses every other top-level frame and expands this one and its ancestors. The rails then follow.
  - It is one undo step in edit mode and changes the view only in `?present`, like collapse in v2.
  - "Show all" in the dock expands everything again. It appears only when a frame is collapsed.
- **Pinned row with lifespans:** the row shows a box only for lifelines alive at the rows under it. A participant that starts further down gets its box when its header slot reaches the top. Boxes slide in and out with a short fade, and nothing moves sideways.
- **Selecting a participant** with `lifespans` also lights its lifespan (start box, end cap) for a moment, so the reader can find where it begins.
- Exports and `?capture` render what the layout shows: rails for collapsed participants, boxes at the start of each lifespan.

### Editing

- **Lifespans on or off:** a dock toggle "Trim lifelines", one undo step. It's off for pages saved before, and new diagrams default to off as well; see open question 2.
- **Share a column:** drag a participant's box onto another participant's column. It's accepted only when the lifespans don't overlap; otherwise it refuses with the reason ("SPM and Background Job are both active at step 12"). "Own column" in the participant's action bar undoes it.
- **Start or end earlier or later:** with `lifespans` on, a selected participant shows handles on its start box and end cap. They drag to row gaps, and only outward from the derived span (`start`/`end`).
- Adding a message to a rail participant (drawing to its rail) expands the frames that hide it first, so a message is never drawn into a collapsed frame.

### Agent reference (`references/types/sequence.md`, `meta.json` `dataNote`)

- Document `lifespans`, `column`, `start`, `end`, and when to use them:
  - `lifespans: true` for flows of more than about 6 participants where some take part only in one phase.
  - `column` only for participants in phases that never overlap.
- Tell agents to keep writing `kind`. The editor's inference is for people.
- Add audit rules: `column` with an overlap, `column` without `lifespans`, `start`/`end` that would cut off a message, and a host that is itself sharing a column. Chains are not allowed.

## Tests

- `dev/fixtures/sequence/`:
  - `lifespans.json`, where SPM and Background Job share a column and the queue has a `start`.
  - `rails.json`, the payment phases with all frames but one collapsed.
  - Goldens for both. The existing goldens must stay byte-identical, since no field is new to them.
- `check_golden.py`:
  - A rail is `RAIL_W` wide and only appears where its participant has nothing to show.
  - With every frame expanded, the layout equals the layout without rails.
- `test_audit_sequence.py`: one case per new audit rule.
- `e2e_sequence.mjs`:
  - Drawing a message back to an open caller makes a reply, and any other message is a call.
  - "No reply expected" toggles async.
  - Focus collapses the others, in one undo step, and in `?present` changes the view only.
  - A rail click selects.
  - Dropping a box onto a column shares it, or refuses with the reason.
  - Start and end handles drag.
  - The pinned row shows only living lifelines, at two scroll positions.
- `e2e_touch.mjs`: long-press on a rail shows its name, and Focus works by tap.
- Width check on the acceptance sample: Focus on "SPM" makes the canvas at least 35% narrower than with everything expanded.

## Steps

1. **Message kinds:** remove the picker, infer the kind on draw, add the async toggle, and update the help and the e2e. This step stands alone and can ship first.
2. **Rails:** add rails and Focus (engine, page, Show all, e2e). This is the step that gives the width, and it needs no new data.
3. **Lifespans:** add `lifespans`, header slots, end caps, the pinned row that follows lifespans, and the dock toggle.
4. **Shared columns and overrides:** add `column` and `start`/`end`, the drag to share, the handles, and the audit rules.
5. **Reference, fixtures and samples:** rebuild the payment sample with `lifespans` and SPM and Background Job sharing a column, then archive the plan.

## Open questions (settled 2026-11-14: each as proposed)

1. **Rails from collapse only, or also an explicit "hide this participant"?** The plan derives rails from collapse, so a rail can never hide a message. An explicit hide would let a reader drop a busy but uninteresting lifeline, such as a logger, but it would have to hide its messages too.
2. **Should new diagrams default to `lifespans: true`?** Pages saved before keep `false` either way. Turning it on for new diagrams changes what agents produce, so it's better decided after seeing step 3 on the acceptance sample.
3. **End cap style:** a short tick (proposed) or the UML ×? The × is standard, but on a business diagram it reads as "failed".
4. **Can Focus nest?** Focusing a frame inside a phase would collapse that frame's siblings within the phase, as well as the other phases. The plan focuses top-level frames only.
