# Use Case Diagram (`diagramType: "usecase"`)

Use for what a system does for the people and systems around it: who (actors) wants what (use cases, as goals) from which system (the subject, drawn as the boundary). Not for the order of steps (use `flowchart` or `sequence`) and not for data (use `erd`): a use case diagram has no sequence, no data and no internal steps. Positions, box sizes and the lines are computed by the tooling; author only the logical model, and colour the use cases by feature area (see Colour).

**Example to copy (read it next; path is from `<skill-dir>`):** `references/examples/example-usecase.json`.

## Schema

Never add coordinates or sizes (`x`, `y`, `w`, `h`, `points`, `layout`); `--layout` computes them. Array order is display order and only breaks ties: primary actors sit in a column on the left, the subjects stacked in the middle, supporting actors on the right, and the layout orders each against the others to keep lines short. A saved page embeds this JSON with `schemaVersion` 1 and a trailing `layout` map of actor and use case positions (display-only; leave it and `schemaVersion` out when you write). Every field marked optional can be left out.

```json
{
  "diagramType": "usecase",
  "title": "Online shop",
  "colorKey": { "1": "Ordering", "2": "Payments" },
  "subjects": [ { "id": "shop", "name": "Storefront" } ],
  "actors": [
    { "id": "customer", "name": "Customer" },
    { "id": "member", "name": "Registered customer", "parent": "customer" },
    { "id": "psp", "name": "Payment gateway", "kind": "system", "side": "right" }
  ],
  "useCases": [
    { "id": "browse", "name": "Browse catalogue", "subject": "shop", "color": "1", "refs": ["FR-1"] },
    { "id": "checkout", "name": "Check out", "subject": "shop", "color": "1", "refs": ["FR-4"], "extensionPoints": ["Payment"] },
    { "id": "voucher", "name": "Apply voucher", "subject": "shop", "color": "1", "refs": ["FR-6"] },
    { "id": "pay", "name": "Take payment", "subject": "shop", "color": "2", "level": "subfunction" }
  ],
  "links": [
    { "id": "l1", "type": "association", "from": "customer", "to": "browse" },
    { "id": "l2", "type": "association", "from": "member", "to": "checkout" },
    { "id": "l3", "type": "include", "from": "checkout", "to": "pay" },
    { "id": "l4", "type": "extend", "from": "voucher", "to": "checkout", "condition": "customer has a code", "extensionPoint": "Payment" },
    { "id": "l5", "type": "association", "from": "pay", "to": "psp" }
  ],
  "notes": [ { "id": "n1", "text": "Guest checkout allowed up to 200 EUR (BR-3)", "useCases": ["checkout"] } ]
}
```

| Object | Field | Description |
|---|---|---|
| Diagram | `colorKey` | Optional. `{ "1": "Payments" }`: the feature area each slot stands for, shown as a legend. Write it whenever you use `color`. |
| Diagram | `showRefs` | Optional. `true` shows each use case's `refs` as a small chip under its name (traceability view). The page's **Refs** toggle. |
| Diagram | `showNotes` | Optional. `true` draws notes on the canvas instead of as badges. |
| Subject | `id`, `name` | One system boundary. Order is top to bottom. A diagram with one subject may leave out `subjects`; the use cases then sit in one unnamed boundary titled with `title`. With two or more subjects every use case names its `subject`. |
| Subject | `collapsed` | Optional. Draws the boundary as a name bar. Never author it unless asked. |
| Subject | `fw`, `fh` | Set by dragging the frame corner in the page: a minimum width and height. Never author them. |
| Actor | `id`, `name` | A role, 24 characters at most. Never a person's name. |
| Actor | `kind` | Optional. `human` (default), `system` (an external system) or `time` (a scheduled trigger). Every actor is drawn as a round avatar (person, server or clock icon) with its name below; `system` and `time` add `«system»` / `«time»` under the name. |
| Actor | `side` | Optional. `left` or `right`. Default: `left` for an actor that starts any association, `right` for one that is only ever the target (a supporting actor). |
| Actor | `parent` | Optional. Actor id: a generalization (the child can do everything the parent can). Drawn as a hollow-triangle line. |
| Actor | `abstract` | Optional. `true` draws the name in italics and exempts the actor from the "no association" warning. |
| Actor | `color` | Optional. A palette slot, `"1"` to `"8"`. Usually leave it out: the page gives every actor its own colour from the slots `colorKey` does not use (not saved), and its lines take that colour. Set it only when the user asks for a particular colour. |
| Use case | `id`, `name`, `subject` | `name` is verb + object, 40 characters at most, wraps to two lines in its pill. `subject` is a subject id. |
| Use case | `color` | Optional. A palette slot `"1"` to `"8"`: the feature area. Name each in `colorKey`. |
| Use case | `level` | Optional. `summary` (drawn larger, bold outline), `user` (default), `subfunction` (drawn smaller, dashed outline). |
| Use case | `refs` | Optional list of requirement ids (`"FR-4"`), 12 characters each. Searchable in the page, shown with `showRefs`. |
| Use case | `extensionPoints` | Optional list of names. Draws the extension-points compartment; an `extend` link can name one. |
| Use case | `abstract`, `parent` | Optional. Italic name; `parent` is a use case id: a generalization (variants of one goal). |
| Link | `id`, `type`, `from`, `to` | `type` is `association`, `include` or `extend`. Generalizations are `parent` fields, never links. |
| Link | direction | `association`: actor and use case, either order (put the actor that starts it in `from`; a supporting actor goes in `to`). `include`: **from the base to the included use case**. `extend`: **from the extension to the base it extends**. |
| Link | `condition` | Optional, `extend` only, 40 characters at most: drawn as `[condition]` under `«extend»`. |
| Link | `extensionPoint` | Optional, `extend` only: one of the base's `extensionPoints`. |
| Link | `navigable` | Optional, association only. `true` draws an open arrowhead toward `to`. |
| Note | `id`, `text`, `useCases`, `actors` | Attached to one or more ids; drawn as a badge, or on the canvas with `showNotes`. 120 characters at most. |

The audit's budgets: actor name 24 characters, use case name 40, extend condition 40, ref 12, note 120. Over a budget is a `[WARN]`: the page truncates the text.

## Writing rules

Trace the requirements in this order before writing the JSON.

1. **Fix the subject (scope).** Name the system under design: one boundary per system. A requirement set that covers two systems (a storefront and a back office) gets two `subjects`. Anything outside every boundary is an actor.
2. **Find the actors.** For each requirement ask who starts it and who else takes part. Actors are roles ("Customer", not "Alice"). Primary actors start a use case (drawn left). Supporting actors are roles or external systems the subject calls, such as a payment gateway or a mail service (`kind: "system"`, drawn right). A scheduled trigger ("Nightly", "End of month") is a `kind: "time"` actor. The database, the UI and the subject's own modules are never actors.
3. **List the goals.** For each primary actor list every goal the requirements give it at **user-goal level**: one actor, one sitting, a result worth walking away with ("Place order", "Refund payment"). Name each **verb + object** in the actor's words. Lower-level steps ("Log in", "Validate card") are not use cases unless several use cases share them (rule 5); a higher-level summary ("Manage store") is only kept when asked.
4. **Connect.** One `association` per actor and use case it takes part in. A primary actor's link is `from` the actor; a supporting actor's link goes `from` the use case `to` the actor.
5. **Factor, only where the requirements show it.** Ask: *does it always happen?* `include`. *Only sometimes?* `extend`.
   - `include`: behaviour two or more use cases **always** need ("Authenticate", "Calculate tax"). `from` the base, `to` the included case. Never use `include` to chain steps in order.
   - `extend`: optional or conditional behaviour added to a base ("Apply voucher" extends "Check out" when the customer has a code). `from` the extension, `to` the base. Always write the `condition`; name the base's `extensionPoints` entry when the requirements give one.
   - Generalization (`parent`): a specialised actor (Registered customer → Customer), or variants of one goal (Pay by card → Pay). Use sparingly.
6. **Trace.** Every functional requirement maps to at least one use case: put its id in `refs`. Every business rule, threshold, SLA or non-functional requirement that concerns a use case becomes a `note` on it. Nothing is dropped; nothing is invented.
7. **Check.** Each actor has an association; each use case is reached by an actor (directly, or through `include`, `extend` or `parent`); no CRUD explosion (four use cases "Create/Read/Update/Delete X" become "Manage X" unless different actors do them); no `include` cycles; no actor inside a boundary.

Also:

- **Keep ids short and lower case** (`checkout`, `psp`); `id` values are unique across actors, use cases and subjects, because links name both.
- **Never leave a use case out or mark a subject `collapsed` to save space**; the page pans, zooms, collapses and searches by itself.
- **Do not model a flow.** If the requirements describe an order of steps, that is a `flowchart` or `sequence`; a use case diagram only names the goals.

## Colour

Colour is the reader's first grouping cue. For more than 8 use cases:

1. Group the use cases by the requirement document's sections or headings (feature areas: Ordering, Payments, Fulfilment), using the source's own words.
2. Give each area one slot from `"1"` to `"8"` and set `color` on every use case of that area. At most 8 areas.
3. Write a `colorKey` naming each area: `{ "1": "Ordering", "2": "Payments" }`.
4. Leave actors and subjects neutral (no `color`): placement already says primary or supporting, and a boundary is a frame, not a category.

A diagram of 8 or fewer use cases may stay neutral. The audit warns when a diagram has more than 12 use cases and none has a colour.

## Visual review checklist

The audit covers references, overlaps, lines through use cases and label overlap; the layout report covers text overflow. Check by eye on the screenshot:

1. **Four line styles are unmistakable**: association solid with no arrowhead, `include` and `extend` dashed with an open arrow and their `«include»` / `«extend»` label, generalization solid with a hollow triangle at the parent.
2. **Arrow directions are right**: `include` points at the included use case, `extend` points at the base, the triangle sits on the parent.
3. **Primary actors on the left, supporting actors on the right**, every actor outside the boundary.
4. **Each actor sits level with its goals**; a hub actor's lines fan out without running through other use cases.
5. **Names** are verb + object, readable and not cut off; `[condition]` labels are not hiding a use case or each other.
6. **Colours** match the feature areas, the legend names each one, actors are neutral.
7. **Subfunction and summary levels** differ by size and outline, not by colour alone.
8. **Notes** sit by the use case they concern.

## Failure handling

- **Unknown references** (`from unknown id`, `to unknown id`, `unknown subject`, `parent unknown actor`, `parent unknown use case`, `is attached to unknown use case`, `is attached to unknown actor`): fix the id in `from`, `to`, `subject`, `parent` or the note.
- **`is an association but not between an actor and a use case`**: an association joins one actor and one use case; use `include` or `extend` between two use cases.
- **`is an include but not between two use cases`** / **`is an extend but not between two use cases`**: `include` and `extend` join two use cases; use an `association` for an actor.
- **`include cycle`**: a use case includes itself, directly or through others; remove one `include`.
- **`parent cycle (actor)`** / **`parent cycle (use case)`**: a generalization loops; remove one `parent`.
- **`extensionPoint ... is not an extension point of`**: add the name to the base's `extensionPoints`, or fix the spelling.
- **`has unknown kind`**, **`unknown side`**, **`unknown level`**, **`unknown type`**, **`unknown color`**: use the values in the schema table; a colour must be a palette slot, `"1"` to `"8"`.
- **`Duplicate actor id` / `Duplicate use case id` / `Duplicate subject id` / `Duplicate link id` / `Duplicate note id`**: ids are unique (actors, use cases and subjects share one set).
- **`has no 'subject'`**: with two or more subjects every use case names its `subject`.
- **`has no name` / `has no text`**: give it one.
- **`Use cases ... overlap`, `Actors ... overlap`, `overlaps use case`, `sits inside subject`, `is not inside its subject`, `passes through use case`, `passes through actor`, `Labels of links ... overlap`, `sits over use case`, `sits over actor`, `extends past the diagram edge`, `Subjects ... overlap`**: layout problems; re-run `--layout` (never edit positions by hand). If it persists, shorten the name or condition.
- **`Diagram is not laid out`**: run `--layout`.
- **`Actor '...' has no association`** (warning): connect it to a use case it takes part in, or drop it.
- **`is not reached by any actor`** (warning): associate an actor, or `include`, `extend` or generalize it from a use case an actor reaches.
- **`include chain ... this is a flow`** (warning): three or more `include` hops in a row are steps in order; fold them into one use case, or draw a `flowchart`.
- **`is over N characters and will be truncated`** (warning): shorten the name, ref, condition or note.
- **`N use cases and none has a 'color'`** (warning): colour them by feature area, see Colour.
- **`does not say what it means`** (warning): add the slot to `colorKey`. **`contrast is not checked`**: use a palette slot, not a hex.
- **`[INFO] ... is included only by ...`**: not a failure. An included use case with one base is just a step: fold it into the base unless another use case will share it.
- **`[INFO] ... does not start with a verb`**: not a failure. Rename goals verb + object ("View order history", not "Order history").
