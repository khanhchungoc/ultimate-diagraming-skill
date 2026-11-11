# Sequence Diagram (`diagramType: "sequence"`)

Use for messages exchanged between participants over time: API calls, system integrations, user-to-system interactions. Not for process flows with decisions and ownership (use `flowchart`). Positions, spacing, activation bars and frame boxes are computed by the tooling; author only the logical model.

**Example to copy (read it next):** [example-sequence.json](../examples/example-sequence.json).

## Schema

Never add coordinates (`x`, `y`, `w`, `h`, `layout`); `--layout` computes them. Array order is time order, top to bottom.

```json
{
  "diagramType": "sequence",
  "title": "Checkout",
  "participants": [
    { "id": "p1", "name": "Customer", "kind": "actor" },
    { "id": "p2", "name": "Shop", "kind": "system" }
  ],
  "messages": [
    { "id": "m1", "from": "p1", "to": "p2", "label": "Place order", "kind": "sync" },
    { "id": "m2", "from": "p2", "to": "p1", "label": "Order confirmed", "kind": "reply" }
  ],
  "fragments": [
    { "id": "f1", "kind": "alt", "label": "payment accepted", "from": "m3", "to": "m5", "elseAt": "m5" }
  ]
}
```

| Object | Field | Description |
|---|---|---|
| Participant | `id`, `name`, `kind` | `kind` is `actor` (a person or external party, drawn as a pill) or `system` (default, a box). Left-to-right order is array order. |
| Message | `id`, `from`, `to`, `label` | Participant ids. `from` equal to `to` draws a self-message. |
| Message | `kind` | `sync` (call: solid line, filled arrowhead, opens an activation bar), `reply` (return: dashed line, open arrowhead, closes the bar of the call it answers), `async` (solid line, open arrowhead). Default `sync`. |
| Fragment | `id`, `kind`, `label`, `from`, `to` | `kind` is `opt`, `alt` or `loop`. `from` and `to` are message ids; the frame covers that range inclusive. |
| Fragment | `elseAt` | Optional, `alt` only: the message id where the `else` branch starts. Must be after `from` and no later than `to`. |

An activation bar appears when a `sync` message is later answered by a `reply` going back the other way (`from`/`to` swapped). Give every call a reply if you want the bar to show.

## Writing rules

1. **Participants are lifelines, not steps**: name them as the party (`Payment Service`), not the action.
2. **Label messages with the call or the data**, short (`Charge card`, `Order confirmed`); the engine widens the spacing to fit, but long labels make the diagram wide.
3. **Pair calls with replies** so activation bars and the flow read correctly; use `async` for fire-and-forget events.
4. **Frames wrap whole messages only** and nest at most two deep. Use `alt` for either/or, `opt` for optional, `loop` for repetition.
5. Order participants so most messages travel to a neighbour; long jumps across the diagram are hard to follow.
6. **Overview requests**: if the user asks for a summary or one-slide view, aim for about 6 participants and 16 messages so it fits a 1080p screen without panning. Otherwise include every message; the page pans and zooms.

## Visual review checklist

The audit covers spacing, label fit and frame bounds; the layout report covers label overlap. Check by eye on the screenshot:

1. **Reading order**: messages go top to bottom in the intended sequence.
2. **Activation bars** open at each call and close at its reply, with no bar left dangling.
3. **Frames** enclose exactly the intended messages and their labels do not hide a message label.
4. **Self-messages** have room beside the lifeline and do not touch the next lifeline.

## Failure handling

- **Fragment errors** (`unknown message`, `starts after it ends`): fix the message ids in `from`, `to` or `elseAt`.
