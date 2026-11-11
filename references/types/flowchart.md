# Swimlane Flowchart (`diagramType: "flowchart"`)

Use for swimlane, cross-functional or BPMN-style process flows. Layout, routing, label placement and styling are computed by the tooling; author only the logical graph. A complete file: [example-flowchart.json](../examples/example-flowchart.json).

## Schema

Never add pixel coordinates (`x`, `y`); `--layout` computes them.

```json
{
  "diagramType": "flowchart",
  "title": "Process Title",
  "direction": "LR",
  "lanes": [{ "id": "lane-customer", "name": "Customer", "color": "#e0f2fe", "icon": "user" }],
  "nodes": [{ "id": "n1", "laneId": "lane-customer", "type": "start", "label": "Submit Request" }],
  "edges": [{ "id": "e1", "from": "n1", "to": "n2", "label": "" }]
}
```

| Object | Field | Description |
|---|---|---|
| Lane | `id`, `name`, `color`, `icon` | Unique id (`lane-<slug>`), actor or system name, hex color from the table below, and an `icon` (see rule 8). |
| Node | `id`, `laneId`, `type`, `label` | `type` is `start`, `task`, `decision` or `end`. `start` and `end` render as rounded pills in their own colours (a plain circle if the label is empty); `task` is a box, `decision` a diamond. |
| Edge | `id`, `from`, `to`, `label` | `label` is `"Yes"`, `"No"`, `"Resubmit"`, etc.; `""` for unconditional steps. |
| Diagram | `swimlanes` | Optional `false` for a process with **one actor**: no lane header column, tint or borders. Keep exactly one lane in `lanes` and put every node in it (the tooling creates `lane-main` if `lanes` is empty). The lane icon rule does not apply. The page's Lane button turns swimlanes back on. |
| Diagram | `direction` | Optional `"TB"` lays the diagram out **top to bottom**: lanes become columns and steps run downwards. Leave it out for left to right (the default). Use it for a long process with few lanes, which fits a page better vertically. The page's Vertical/Horizontal button switches between the two (re-running the layout), and Save keeps the choice. |
| Edge | `feedback` | Optional `true` marks a loop-back edge so it always routes through the outer corridor. Without it the engine picks the loop edge by traversal order, which may choose the wrong edge of a cycle. |

| Lane role | Color |
|---|---|
| Customer / User | `#e0f2fe` (sky) |
| Frontend / Sales / Ops | `#fef3c7` (amber) |
| Backend / Core Engine | `#dcfce7` (emerald) |
| Risk / Compliance / Admin | `#fee2e2` (rose) |
| External Integration / 3rd Party | `#f3e8ff` (purple) |

## Writing rules

1. **Verb + Noun** for tasks (`"Validate Order"`, not `"The order needs to be validated"`).
2. **Decisions end in `?`** (`"Docs Complete?"`) and every outgoing branch is labeled. Only decision branches get `Yes`/`No` labels: an edge leaving a step is `""` (`--verify` warns about a `Yes`/`No` on a step).
3. **One owner per node**: place each node in the lane of the actor who performs it.
4. **Fit the 2-line label clamp** so text never truncates with `...`:
   - **Tasks / Start / End (`144x64px`)**: `<= 28` chars (~14–16 chars/line). A 13-char word like `"Authorisation"` fits beside one or two short words.
   - **Decisions (`92px` inner diamond)**: `<= 24` chars (~12 chars/line, e.g. `"User Still Authorised?"`).
   - **Lane names**: `<= 32` chars so the floating pill never truncates.
   - **Fidelity**: keep the user's wording when it fits the budget. Otherwise shorten it and list the changed labels in the final report. Never abbreviate words (`"Auth"`) to save space.
5. **Overview requests**: if the user asks for a summary, high-level overview or one-slide flow, aim for about 7 columns and 12 nodes so it fits a 1080p screen without panning. Otherwise include every step the source has; the page pans and zooms.
6. **Exceptions end in their own end state.** A path that finishes unresolved (manual intervention, escalation, an unhandled fallback) ends in a separate `end` node named for that outcome (`"Manual Payment Required"`), never merged into the success end (`"Claim Settled"`). Creating a task for someone else is not completion.
7. **One lane per distinct actor, system, or phase container.** When the whole process has a single actor and no phase containers, set `"swimlanes": false` instead of drawing one named lane. When recreating a diagram grouped into sequential **Step / Phase containers** (`"Step 1: ..."`, `"Step 2: ..."`), map each container to a lane (`lane-step1`, `lane-step2`, ...) and set `"direction": "TB"` if the source flow runs top-to-bottom. See [Choosing the structure](#choosing-the-structure).
8. **Every lane gets an `icon`**, chosen from the table below to match the actor or system. Use a different icon for each lane in one diagram, and never leave one out (`--verify` prints a `[WARN]` for a lane without one, or with a name that is not in the table).

| Icon | Use for |
|---|---|
| `user` | a person, customer, applicant, requester |
| `users` | a team, group, generic role |
| `briefcase` | sales, account or relationship manager, officer, broker |
| `building` | organisation, branch, department, agency |
| `headset` | support, help desk, call centre |
| `monitor` | frontend, UI, web or mobile app, portal |
| `code` | developer, engineer, backend, API |
| `server` | server, infrastructure host |
| `database` | data store, data team, reporting |
| `cloud` | cloud platform, SaaS |
| `cpu` | automated system, engine, bot, workflow service |
| `cog` | DevOps, operations, platform, release |
| `shield` | risk, compliance, security, fraud, legal, audit |
| `scale` | legal, governance, regulator |
| `banknote` | finance, billing, treasury |
| `credit-card` | payments, card processor |
| `mail` | notifications, email, messaging |
| `package` | inventory, product, parcel |
| `truck` | warehouse, logistics, shipping, delivery |
| `cart` | shop, checkout, order channel |
| `clipboard` | business analyst, product owner, requirements |
| `check` | QA, tester, verification |
| `layers` | architecture, a layered or composite system |
| `globe` | external party, third party, partner, vendor |
| `flag` | core team, lead, steering group, management |

## Choosing the structure

Decide from the source, once. Do not trial the alternatives.

| Source looks like | Lanes | `direction` |
|---|---|---|
| Several actors or systems handing work over | one lane per actor | omit (`LR`) |
| One actor, one sequence | `"swimlanes": false` | `TB` if long, else omit |
| Sequential boxes titled `Step N` / `Phase N`, flowing downwards | one lane per container (`lane-step1`, ...) | `TB` |
| Few lanes but many steps | keep the lanes | `TB` (fits a page better) |

## Visual review checklist

Routing, ports, arrow ends and lane containment are the engine's job; it does not need checking. Check these by eye on the screenshot, and apply the fix if one fails:

1. **Loop edges**: the edge that loops back is the intended one and runs through the outer corridor. If the wrong edge loops, or a node in a cycle sits in an odd column, set `"feedback": true` on the edge that should loop back and re-run `--layout`.
2. **Fan-in joins do not cross**: when several lanes feed one join node, the arrows nest without one cutting across another. If they cross, reorder lanes so the join's sources sit next to each other and re-run.
3. **Every node is in the right lane**: the lane of the actor who performs it (rule 3).
4. **Every lane header names who does the work**: an actor, team or system, not an activity or category (rule 7).
