# Sequence Diagram (`diagramType: "sequence"`)

Use for messages exchanged between participants over time: API calls, system integrations, user-to-system interactions. Not for process flows with decisions and ownership (use `flowchart`). Positions, participant order, spacing, activation bars and frame boxes are computed by the tooling; author only the logical model.

**Example to copy (read it next; path is from `<skill-dir>`):** `references/examples/example-sequence.json`.

## Schema

Never add coordinates (`x`, `y`, `w`, `h`, `layout`); `--layout` computes them. Message array order is time order, top to bottom. A saved page embeds this JSON without positions: the page lays them out on load. Every field marked optional can be left out.

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
    { "id": "m1", "from": "p1", "to": "p2", "label": "Place order" },
    { "id": "m2", "from": "p2", "to": "p3", "label": "Charge card", "detail": "amount, currency, card token" },
    { "id": "m3", "from": "p3", "to": "p2", "label": "Approved", "kind": "reply" },
    { "id": "m4", "from": "p2", "to": "p1", "label": "Order confirmed", "kind": "reply" },
    { "id": "m5", "from": "p3", "to": "p2", "label": "Declined", "kind": "reply" },
    { "id": "m6", "from": "p2", "to": "p1", "label": "Order failed", "kind": "reply" }
  ],
  "fragments": [
    { "id": "f1", "kind": "group", "label": "Payment", "color": "1", "from": "m2", "to": "m6" },
    { "id": "f2", "kind": "alt", "label": "card approved", "from": "m3", "to": "m6",
      "branches": [ { "at": "m5", "label": "card declined" } ] }
  ],
  "notes": [
    { "id": "n1", "text": "Card data never reaches the shop", "over": "p3", "after": "m2" }
  ]
}
```

| Object | Field | Description |
|---|---|---|
| Diagram | `numbered` | Optional. `true` shows step numbers (message position in `messages`). Leave out by default: `--layout` enables it automatically at 20+ messages. |
| Diagram | `showDetails` | Optional. `false` hides `detail` lines (shown on hover instead). Leave out to show them. |
| Diagram | `participantOrder` | Optional. `"fixed"` keeps `participants` in written order. Leave out: `--layout` orders participants automatically. |
| Diagram | `colorKey` | Optional; omit unless participant `color` is used. Maps each used slot (`{ "1": "Our services", "5": "Third parties" }`) to its ownership/domain label. |
| Participant | `id`, `name`, `kind` | `kind`: `actor` (person), `system` (default, shown as Service: back-end service or app), `ui` (screen or front end), `database`, `queue` (bus or topic), `external` (third-party system). `actor`, `ui`, `database`, `queue` and `external` show an icon. |
| Participant | `color` | Optional; omit unless the source groups participants by ownership or domain. Palette slot `"1"`–`"8"` (at most 4 colours total, never one per participant); name every slot in `colorKey`. |
| Participant | `start`, `end` | Optional message ids; omit unless the source explicitly states a participant starts earlier or ends later than its own messages. |
| Message | `id`, `from`, `to`, `label` | Participant ids. `from` equal to `to` draws a self-message. |
| Message | `kind` | Optional; `sync` (solid line, filled arrowhead) is the default and can be omitted. Write `reply` (dashed return, open arrowhead) or `async` (solid line, open arrowhead). |
| Message | `detail` | Optional. One line of parameters or payload, muted under the arrow. No line breaks. |
| Fragment | `id`, `kind`, `label`, `from`, `to` | `kind`: `opt`, `alt`, `loop`, `par`, or `group` (named phase: tag shows label only). `from` and `to` are message ids (inclusive). |
| Fragment | `branches` | Optional, `alt` and `par` only: `[{ "at": <message id>, "label": <condition> }]` for each further branch (`label` on the fragment is the first branch). Each `at` is after `from` and `<= to`; no duplicates. |
| Fragment | `color` | Optional. Palette slot `"1"`–`"8"`, or `"9"` for neutral grey. Tints the frame and its tag. |
| Note | `id`, `text`, `over` | `over` is one participant id, or two ids to stretch between lifelines. `text` may hold `\n` line breaks. |
| Note | `after` / `before` | Optional message id. `after` places the note below that message (inside its frames); `before` places it above (outside frames opening there). With neither, it sits above the first message. |

**Activation bars** are computed automatically: a `sync` call opens a bar on its target until its matching `reply` (callers stay active across calls; `actor` starters get no bar).
Override on a message only when needed: `"activate": false` skips the bar; `"until": "<later-message-id>"` holds it open until that message.

## Writing rules

1. **Participants are lifelines, not steps**: name them as the party (`Payment Service`), not the action. Give each the `kind` that matches its role. Keep `database` interactions at domain-operation level (`Reserve stock`, `Record order`), never raw SQL (`SELECT * FROM ...`).
2. **Keep text concise (soft word limits)**: aim for at most **3–4 words** on participant `name`, at most **6 words** on message `label` (`Charge card`, `Order confirmed`), and at most **8 words** on `detail` (one line). Short text keeps columns compact and Fit zoom legible.
3. **Pair calls with replies**: omit `kind` on `sync` calls and pair them with `reply` messages so activation bars and flow read cleanly; use `async` for fire-and-forget events (routing through a `queue` participant where applicable). Use self-messages (`from` equal to `to`) only for nontrivial internal logic (idempotency check, signature verification, state validation); omit trivial internal steps.
4. **Frames wrap whole messages only** and nest at most three deep. `alt` for either/or, `opt` for optional, `loop` for repetition, `par` for parallel, `group` for a named phase. Always write explicit guard conditions in `label` for `opt`, `loop` (including iteration or retry bounds, such as `for each item` or `up to 3 retries until 2xx`), `alt`, and `par`.
5. **Put the happy path first in `alt`** and keep each branch's terminal outcome or error reply inside the `alt` range (never leave a success reply outside an `alt` that also has a failure branch). Multiple outcomes or parallel tracks use one `alt` or `par` with `branches`, never nested `alt`s.
6. **Every note, rule, state or SLA in the source is a `note`**, placed `over` the participant it concerns (or stretched between two) with `after`/`before`.
7. **Colour only to match source grouping**: leave `color` out by default. Colour `group` phases only when the source colours or names them (one colour per `group`); colour participants (with `colorKey`) only when the source groups them by ownership or domain.
8. **Wrap natural phases in `group` fragments**: when a flow has distinct phases, wrap each phase in a `group` covering all its messages (leaving no loose messages outside a phase) so Focus/collapse works interactively in the page.
9. **Write messages in time order**, and give each `note` its `over` participant(s) and `after`/`before` anchor.
10. **Overview requests**: if the user asks for a summary or one-slide view, keep it concise to the key phases and handoffs. Otherwise include every message, branch and note from the source; the page pans, zooms, pins participant headers and collapses phases.

## Failure handling

- **Fragment errors** (`unknown message`, `starts after it ends`, `branch at ... must be after its first message`): fix the message ids in `from`, `to`, or `branches[].at`.
- **`only alt and par have branches`**: change the `kind`, or drop `branches`.
- **Note errors** (`unknown participant`, `after unknown message`): fix `over`, `after`, or `before`.
- **`Frames nest N deep`** (warning): put a rare exit in a `note`, or split the flow.
