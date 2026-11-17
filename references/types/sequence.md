# Sequence Diagram (`diagramType: "sequence"`)

Use for messages exchanged between participants over time: API calls, system integrations, user-to-system interactions. Not for process flows with decisions and ownership (use `flowchart`). Positions, spacing, activation bars and frame boxes are computed by the tooling; author only the logical model.

**Example to copy (read it next; path is from `<skill-dir>`):** `references/examples/example-sequence.json`.

## Schema

Never add coordinates (`x`, `y`, `w`, `h`, `layout`); `--layout` computes them. Array order is time order, top to bottom. A saved page embeds exactly this JSON: positions are not saved, the page lays them out on load. Every field marked optional can be left out.

```json
{
  "diagramType": "sequence",
  "title": "Checkout",
  "numbered": true,
  "participants": [
    { "id": "p1", "name": "Customer", "kind": "actor" },
    { "id": "p2", "name": "Shop", "kind": "ui" },
    { "id": "p3", "name": "Payment", "kind": "system" }
  ],
  "messages": [
    { "id": "m1", "from": "p1", "to": "p2", "label": "Place order", "kind": "sync" },
    { "id": "m2", "from": "p2", "to": "p3", "label": "Charge card", "detail": "amount, currency, card token", "kind": "sync" },
    { "id": "m3", "from": "p3", "to": "p2", "label": "Declined", "kind": "reply" },
    { "id": "m4", "from": "p3", "to": "p2", "label": "Approved", "kind": "reply" },
    { "id": "m5", "from": "p2", "to": "p1", "label": "Order confirmed", "kind": "reply" }
  ],
  "fragments": [
    { "id": "f1", "kind": "group", "label": "Payment", "color": "1", "from": "m2", "to": "m4" },
    { "id": "f2", "kind": "alt", "label": "card declined", "from": "m3", "to": "m4",
      "branches": [ { "at": "m4", "label": "card approved" } ] }
  ],
  "notes": [
    { "id": "n1", "text": "Card data never reaches the shop", "over": "p3", "after": "m2" }
  ]
}
```

| Object | Field | Description |
|---|---|---|
| Diagram | `numbered` | Optional. `true` shows a step number before every label: the message's position in `messages`, so it never changes when a frame is collapsed. |
| Diagram | `showDetails` | Optional. `false` hides every `detail` line (each becomes its label's tooltip). Leave it out to show them. |
| Diagram | `rails` | Optional. `true` draws a participant that takes part only in collapsed frames as a thin rail (its kind icon and its name written downwards) instead of a full column, so a page that opens with most phases collapsed is much narrower. The page's **Focus** button sets it. Leave it out for the plain look. |
| Diagram | `lifespans` | Optional. `true` draws each lifeline only from its participant's first message (or note) to its last, with the box at the top of its lifeline and a short cap at the bottom. Default `false`: every lifeline runs the full height. Use it for flows of more than about 6 participants where some take part in one phase only, and add `column` only for participants in phases that never overlap. |
| Participant | `id`, `name`, `kind` | `kind`: `actor` (a person, a person icon), `system` (default, shown as Service: a back-end service or app that is none of the other kinds), `ui` (a screen or front end), `database`, `queue` (a bus or topic), `external` (a third-party system). `ui`, `database`, `queue` and `external` have a small icon. Left-to-right order is array order. |
| Participant | `color` | Optional: a palette slot, `"1"` to `"8"`, the theme's palette (a slot names no fixed colour). Colours the box, lifeline, activation bars and rail. Use it for ownership or domain (our services, a partner's, a third party's, the customer's side): at most 4 colours, never one per participant. |
| Diagram | `colorKey` | Optional, give it whenever `color` is used: `{ "1": "Our services", "5": "Third parties" }`, keyed by slot: what each colour in use means. The page shows it above the diagram. |
| Participant | `start`, `end` | Optional, with `lifespans`: a message id that makes the lifeline begin earlier, or end later, than the participant's own messages (a queue that exists before it is first called). It can only widen the lifespan, never cut a message off. |
| Participant | `column` | Optional, with `lifespans`: the id of an **earlier** participant whose column this one reuses. Only for participants whose lifespans (their messages and notes, widened by `start`/`end`) never overlap, such as two systems that each work in a different phase. The audit refuses an overlap, a `column` without `lifespans`, and a host that itself has a `column` (no chains). |
| Message | `id`, `from`, `to`, `label` | Participant ids. `from` equal to `to` draws a self-message. |
| Message | `kind` | `sync` (call: solid line, filled arrowhead, opens an activation bar), `reply` (return: dashed line, open arrowhead, closes the bar of the call it answers), `async` (solid line, open arrowhead). Default `sync`. Always write `kind`: the page picks it for messages people add (a reply when it answers a call that is still open, otherwise a call), and its "No reply expected" toggle sets `async`. |
| Message | `activate`, `until` | Optional, rarely needed (the activation bars are worked out from the messages, see below). `"activate": false` draws no bar for this call. `"until": <later message id>` ends the bar this message opens at that message (async work that runs on, or a call whose reply is not drawn). To draw one continuous bar where the rules give separate ones, put `until` on the first call and `"activate": false` on the later calls to the same participant. In the editor, drag the handle at the bottom end of a bar to a later message row: it sets `until` and the `"activate": false` flags for you (**Reset bar** in the message's action bar, or dropping back at the natural end, removes them). |
| Message | `detail` | Optional. One line of parameters or payload, drawn smaller and muted under the arrow. No line breaks. |
| Fragment | `id`, `kind`, `label`, `from`, `to` | `kind`: `opt`, `alt`, `loop`, `par`, or `group` (a named phase: the tag shows the label only). `from` and `to` are message ids; the frame covers that range inclusive. |
| Fragment | `branches` | Optional, `alt` and `par` only: `[{ "at": <message id>, "label": <condition> }]`, one per further branch, each starting at that message. The fragment's own `label` is the first branch's condition. Each `at` is after `from` and no later than `to`; no two share an `at`. |
| Fragment | `elseAt` | Optional, `alt` only: the short form of one unlabelled `else` branch starting at that message. Use `branches` or `elseAt`, not both. |
| Fragment | `color` | Optional: a palette slot, `"1"` to `"8"`, or `"9"` for the neutral grey. Tints the frame and its tag. |
| Fragment | `collapsed` | Optional. `true` draws the frame as one summary row ("9 messages hidden (steps 2–10)") that the reader can expand. |
| Note | `id`, `text`, `over` | `over` is a participant id, or two ids to stretch the note from one lifeline to the other. `text` may hold `\n` line breaks. |
| Note | `place` | Optional, instead of `over`: a note that sits between lifelines, at a position along them (`0` is the first lifeline, `1.5` halfway between the second and the third). It still takes its own row, so it never covers an arrow. |
| Note | `after` / `before` | Optional message id. `after: m` puts the note under message `m`, inside every frame `m` is in; `before: m` puts it above `m` and above any frame that opens at `m`. With neither, it sits above the first message. |

Activation bars are computed, never written. A bar shows a participant busy handling something:

- A `sync` call opens a bar on its target, and the `reply` going back (`from`/`to` swapped) closes it. A call answered in several places (one reply per `alt` branch) has one bar, to its last reply.
- A participant called again after it replied gets a separate bar. A participant called while its bar is open (a callback) gets a bar on its bar, and so does a self-call.
- A caller keeps one continuous bar while it makes several calls as part of the same job.
- A call with no reply gets a short bar that ends when the caller moves on. An `async` message gives its target a bar only if the target then sends something.
- A system that starts the flow (a job, a webhook) is busy from its first call until it is next called. A person (`actor`) who starts the flow gets no bar.

## Writing rules

1. **Participants are lifelines, not steps**: name them as the party (`Payment Service`), not the action. Give each the `kind` that says what it is: a UI, a database, a queue, an external system.
2. **The label is the call, the `detail` is the data**: keep labels short (`Charge card`, `Order confirmed`); put parameters or payload in `detail`, one line. The engine widens the spacing to fit whichever is longer.
3. **Pair calls with replies** so activation bars and the flow read correctly; use `async` for fire-and-forget events.
4. **Frames wrap whole messages only** and nest at most three deep. `alt` for either/or, `opt` for optional, `loop` for repetition, `par` for parallel, `group` for a named phase of the process.
5. **Three or more outcomes are one `alt` with `branches`**, never `alt`s nested inside each other.
6. **Every note, rule, state or SLA in the source is a `note`**, over the lifeline it concerns (or stretched over the two it is between).
7. **Colour phases only when the source colours or names them**; one colour per `group`.
8. Order participants so most messages travel to a neighbour; long jumps across the diagram are hard to follow.
9. **Long diagrams** (about 20 messages or more): set `"numbered": true` so a reviewer can say "step 17", and wrap each phase in a `group` so the reader can collapse it, or focus on one phase (the **Focus** button: the other phases fold and the participants they leave become rails). Cover every message with a phase, or the participants of the loose ones stay full columns. Never author `"collapsed": true` unless the user asks for an overview; if you do, add `"rails": true`.
10. **Overview requests**: if the user asks for a summary or one-slide view, aim for about 6 participants and 16 messages so it fits a 1080p screen without panning. Otherwise include every message, step, branch and note; the page pans, zooms, pins the participant row and collapses phases.

## Reading the JSON

Used when explaining an existing diagram (output of `--extract`).

`messages` are in time order (a step number is a message's position there); a fragment covers messages `from`..`to` inclusive, an `alt`/`par` fragment's `branches[].at` (or `elseAt`, one unlabelled else) is where each further branch starts, and a note sits `over` a participant `after`/`before` a message.

## Visual review checklist

The audit covers spacing, label fit, frame and note bounds; the layout report covers label overlap. Check by eye on the screenshot:

1. **Reading order**: messages go top to bottom in the intended sequence.
2. **Activation bars** open at each call and close at its last reply, with no bar left dangling at a branch.
3. **Frames** enclose exactly the intended messages and their labels do not hide a message label.
4. **Branch labels** are readable and not under a message label.
5. **Notes** sit over the right lifeline, at the right step.
6. **Self-messages** have room beside the lifeline and do not touch the next lifeline.

## Failure handling

- **Fragment errors** (`unknown message`, `starts after it ends`, `branch at ... must be after its first message`): fix the message ids in `from`, `to`, `elseAt` or `branches[].at`.
- **`only alt and par have branches`**: change the `kind`, or drop `branches` / `elseAt`.
- **Note errors** (`unknown participant`, `after unknown message`): fix `over`, `after` or `before`.
- **`Collapsed fragment ... partly overlaps`**: a collapsed frame must contain whole frames only; move its `from`/`to`.
- **`Frames nest N deep`** (warning): put a rare exit in a `note`, or split the flow.
