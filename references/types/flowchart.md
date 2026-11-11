# Swimlane Flowchart (`diagramType: "flowchart"`)

Use for swimlane, cross-functional or BPMN-style process flows. Layout, routing, label placement and styling are computed by the tooling; author only the logical graph.

**Example to copy (read one, after deciding the structure):**
- the source groups steps into Step / Phase / Stage containers: [example-flowchart-phases.json](../examples/example-flowchart-phases.json) (phase lanes, see rule 7);
- otherwise: [example-flowchart.json](../examples/example-flowchart.json) (actor lanes).

## Schema

Never add pixel coordinates (`x`, `y`); `--layout` computes them.

```json
{
  "diagramType": "flowchart",
  "title": "Process Title",
  "direction": "LR",
  "lanes": [{ "id": "lane-customer", "name": "Customer", "icon": "user" }],
  "nodes": [{ "id": "n1", "laneId": "lane-customer", "type": "start", "label": "Submit Request" }],
  "edges": [{ "id": "e1", "from": "n1", "to": "n2", "label": "" }]
}
```

| Object | Field | Description |
|---|---|---|
| Lane | `id`, `name`, `icon` | Unique id (`lane-<slug>`), the actor's name (or the phase's, see rule 7), and an `icon` (see rule 8). |
| Lane | `color` | Optional. Omit it: lanes get palette colours in order. Set a hex tint only to match the source's colours, or to give related lanes the same colour on purpose. |
| Node | `id`, `laneId`, `type`, `label` | `type` is `start`, `task`, `decision` or `end`. `start` and `end` render as rounded pills in their own colours (a plain circle if the label is empty); `task` is a box, `decision` a diamond. |
| Edge | `id`, `from`, `to`, `label` | `label` is `"Yes"`, `"No"`, `"Resubmit"`, etc.; `""` for unconditional steps. |
| Diagram | `swimlanes` | Optional `false` for a process with **one actor**: no lane header column, tint or borders. Keep exactly one lane in `lanes` and put every node in it (the tooling creates `lane-main` if `lanes` is empty). The lane icon rule does not apply. The page's Lane button turns swimlanes back on. |
| Diagram | `direction` | Optional `"TB"` lays the diagram out **top to bottom**: lanes become columns and steps run downwards. Leave it out for left to right (the default). Use it for a long process with few lanes, which fits a page better vertically. The page's Vertical/Horizontal button switches between the two (re-running the layout), and Save keeps the choice. |
| Edge | `feedback` | Optional `true` marks a loop-back edge so it always routes through the outer corridor. Without it the engine picks the loop edge by traversal order, which may choose the wrong edge of a cycle. |

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
7. **One lane per actor.** A lane is who does the work: a role, team, organisation or system that performs steps.
   - Name lanes as actor nouns (`"Loan Officer"`, `"Customer"`, `"Payment Gateway"`), never an activity (`"Review"`), a status (`"Pending"`) or a category (`"Manual Tasks"`). Prefer roles to people's names.
   - A system is an actor only when it acts (`"Core Banking"` validating something). Don't add a lane for a system that is only mentioned.
   - If the source doesn't name actors, infer them from who performs each verb. If you can't, or the whole process has one actor, set `"swimlanes": false`. Never use a generic lane such as `"Process"`, `"Steps"` or `"Other"`.
   - **Exception, phase lanes**: if the source groups steps into sequential containers (step, phase, stage, milestone, sprint, gate, quarter), use one lane per container, in order (`lane-step1`, `lane-step2`, ...), as in the phases example. Test: does every step in group 2 happen after every step in group 1? Yes → phase lanes; no → actor lanes. Each phase starts where the previous one ended, so the layout is a **diagonal staircase**. That is expected and correct: don't try to change it or check the engine. Phase lanes drop ownership, so keep the actor in a label where it matters (`"Officer Reviews Docs"`). A step that jumps back to an earlier phase is a loop-back edge. If the source shows both actors and phases, follow whichever it groups by visually.
8. **Every lane gets an `icon`**, chosen from the table below to match the actor or system. Use a different icon for each lane in one diagram, and never leave one out (`--verify` prints a `[WARN]` for a lane without one, or with a name that is not in the table). For phase lanes pick icons that suit each stage (`clipboard`, `check`, `shield`, `flag`, ...).

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

Decide from the source, once, top row first. Do not trial the alternatives.

| Source looks like | Lanes | `direction` |
|---|---|---|
| Sequential boxes titled `Step N` / `Phase N` / `Stage N` | one lane per container, in order (diagonal staircase is expected) | `TB` if they stack downwards, else omit |
| Several actors or systems handing work over | one lane per actor | omit (`LR`) |
| Few actors but many steps | keep the actor lanes | `TB` (fits a page better) |
| One actor, one sequence | `"swimlanes": false` | `TB` if long, else omit |

## Visual review checklist

Routing, ports, arrow ends and lane containment are the engine's job; it does not need checking. Check these by eye on the screenshot, and apply the fix if one fails:

1. **Loop edges**: the edge that loops back is the intended one and runs through the outer corridor. If the wrong edge loops, or a node in a cycle sits in an odd column, set `"feedback": true` on the edge that should loop back and re-run `--layout`.
2. **Fan-in joins do not cross**: when several lanes feed one join node, the arrows nest without one cutting across another. If they cross, reorder lanes so the join's sources sit next to each other and re-run.
3. **Every node is in the right lane**: the lane of the actor who performs it (rule 3).
4. **Every lane header names who does the work**: an actor, team or system, not an activity or category, or one sequential stage, for phase lanes (rule 7).
