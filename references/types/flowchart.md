# Swimlane Flowchart (`diagramType: "flowchart"`)

Use for swimlane, cross-functional or BPMN-style process flows. Layout, routing, label placement and styling are computed by the tooling; author only the logical graph.

**Example to copy (read one next; paths are from `<skill-dir>`):**
- the source groups steps into Step / Phase / Stage boxes: `references/examples/example-flowchart-phases.json` (phase lanes, rule 7);
- otherwise: `references/examples/example-flowchart.json` (actor lanes).

## Schema

Never add pixel coordinates (`x`, `y`); `--layout` computes them.

```json
{
  "diagramType": "flowchart",
  "title": "Process Title",
  "direction": "LR",
  "lanes": [{ "id": "lane-customer", "name": "Customer", "icon": "user" }],
  "nodes": [{ "id": "n1", "laneId": "lane-customer", "type": "start", "label": "Submit Request" }],
  "edges": [{ "id": "e1", "from": "n1", "to": "n2", "label": "" }],
  "notes": [{ "id": "note-1", "text": "Online form or branch visit", "nodes": ["n1"] }]
}
```

| Object | Field | Description |
|---|---|---|
| Lane | `id`, `name`, `icon` | Unique id (`lane-<slug>`), the actor's name (or the phase's, see rule 7), and an `icon` (see rule 8). |
| Lane | `color` | Optional. Omit it: lanes get palette colours in order. Set a hex tint only to match the source's colours, or to give related lanes the same colour on purpose. |
| Node | `id`, `laneId`, `type`, `label` | `type` is `start`, `task`, `decision`, `end`, or a classic symbol (rule 10). `start` and `end` render as rounded pills in their own colours (a plain circle if the label is empty); `task` is a box, `decision` a diamond. |
| Edge | `id`, `from`, `to`, `label` | `label` is `"Yes"`, `"No"`, `"Resubmit"`, etc.; `""` for unconditional steps. |
| Note | `id`, `text`, `nodes` | Optional list `notes`: plain text that explains one or more steps (what goes in it: rule 9). `nodes` lists the ids of the steps it explains; the first is where it sits. Each linked step shows a small badge the reader hovers to see the note. |
| Diagram | `showNotes` | Optional `true` shows every note on the page (fitted into the gaps near its node) instead of on hover; when to set it: rule 9. The page's Notes button toggles it. |
| Diagram | `swimlanes` | Optional `false` for a process with **one actor**: no lane header column, tint or borders. Keep exactly one lane in `lanes` and put every node in it (the tooling creates `lane-main` if `lanes` is empty). The lane icon rule does not apply. The page's Lane button turns swimlanes back on. |
| Diagram | `direction` | Optional `"TB"` lays the diagram out **top to bottom**: lanes become columns and steps run downwards. Leave it out for left to right (the default). Use it for a long process with few lanes, which fits a page better vertically. The page's Vertical/Horizontal button switches between the two (re-running the layout), and Save keeps the choice. |
| Edge | `feedback` | Optional `true` marks a loop-back edge so it always routes through the outer corridor. Without it the engine picks the loop edge by traversal order, which may choose the wrong edge of a cycle. |

## Writing rules

1. **Labels name the step; notes explain it.** The label is what a reader scans to follow the flow, so it carries only the step. Everything that explains the step goes in a note (rule 9).
   - **Tasks**: an imperative verb + the business object, 2–4 words, Title Case (`"Validate Order"`, `"Approve Loan"`), never a sentence (`"The order needs to be validated"`).
   - **Specific verbs**: a generic verb (`"Process"`, `"Handle"`, `"Manage"`, `"Do"`) hides what happens; name the action (`"Handle Claim"` → `"Assess Claim"`).
   - **Leave out** articles and pronouns, the actor (the lane says who; phase lanes are the exception, rule 7), the element type (`"Decision:"`, `"Task:"`), step numbers, and every system name, threshold, amount, duration, document or reference: those belong in the note. The one exception is the condition a decision tests, which is its question (`"Credit Score >= 700?"`).
   - **Start** names the trigger, as an event (`"Order Received"`) or the first action (`"Submit Application"`); **end** names the resulting state (`"Loan Approved"`, `"Claim Settled"`), one per outcome (rule 6).
   - **Distinct names**: no two steps share a label. If the same work really happens twice, loop back to it with an edge instead of repeating the node.
2. **Decisions end in `?`** (`"Docs Complete?"`) and every outgoing branch is labeled. Only decision branches get `Yes`/`No` labels: an edge leaving a step is `""` (`--layout` warns about a `Yes`/`No` on a step).
3. **One owner per node**: place each node in the lane of the actor who performs it.
4. **Fit the 2-line label clamp** so text never truncates with `...`:
   - **Tasks / Start / End (`144x64px`)**: `<= 28` chars (~14–16 chars/line). A 13-char word like `"Authorisation"` fits beside one or two short words.
   - **Decisions (`92px` inner diamond)**: `<= 24` chars (~12 chars/line, e.g. `"User Still Authorised?"`).
   - **Classic symbols (rule 10)**: `document` `<= 28` chars, like a task; `subprocess`, `io`, `database` and `delay` `<= 24` chars (their outline takes room from the text).
   - **Lane names**: `<= 32` chars so the floating pill never truncates.
   - **Fidelity**: keep the user's wording when it fits the budget and rule 1. Otherwise cut the label to its verb + object; if the cut removed real detail (rule 9's list), put only that detail in a note, never the whole original sentence. List the changed labels in the final report. Never abbreviate words (`"Auth"`) to save space.
5. **Overview requests**: if the user asks for a summary, high-level overview or one-slide flow, aim for about 7 columns and 12 nodes so it fits a 1080p screen without panning. Otherwise include every step the source has; the page pans and zooms. On a text-size `[ERROR]` (exit 4), dropping columns is also a fix.
6. **Exceptions end in their own end state.** A path that finishes unresolved (manual intervention, escalation, an unhandled fallback) ends in a separate `end` node named for that outcome (`"Manual Payment Required"`), never merged into the success end (`"Claim Settled"`). Creating a task for someone else is not completion.
   - **Approvals are decisions.** An approval, sign-off or authorisation is a decision node (`"Budget Approved?"`) with both outcomes, even when the source names only the approval. If the source does not say what happens on rejection, end it in its own state (`"Request Rejected"`) and list it as an assumption in the report; the decision itself is this rule's choice, so leave it out of the report. This applies to approve / sign-off / authorise only: a plain review or check with no stated failure outcome stays a task.
7. **One lane per actor.** A lane is who does the work: a role, team, organisation or system that performs steps.
   - Name lanes as actor nouns (`"Loan Officer"`, `"Customer"`, `"Payment Gateway"`), never an activity (`"Review"`), a status (`"Pending"`) or a category (`"Manual Tasks"`). Prefer roles to people's names.
   - A system is an actor only when it acts (`"Core Banking"` validating something). Don't add a lane for a system that is only mentioned.
   - If the source doesn't name actors, infer them from who performs each verb. If you can't, or the whole process has one actor, set `"swimlanes": false`. Never use a generic lane such as `"Process"`, `"Steps"` or `"Other"`.
   - **Exception, phase lanes**: if the source groups steps into sequential containers (step, phase, stage, milestone, sprint, gate, quarter), use one lane per container, in order (`lane-step1`, `lane-step2`, ...), as in the phases example. Test: does every step in group 2 happen after every step in group 1? Yes → phase lanes; no → actor lanes. Each phase starts where the previous one ended, so the layout is a **diagonal staircase** with empty space beside it. That is correct: never change direction, lanes or labels to fill it. Phase lanes drop ownership, so here, and only here, keep the actor in a label where it matters (`"Officer Reviews Docs"`). A step that jumps back to an earlier phase is a loop-back edge. If the source shows both actors and phases, follow whichever it groups by visually.
8. **Every lane gets an `icon`**, chosen from the table below to match the actor or system. Use a different icon for each lane in one diagram, and never leave one out (`--layout` prints a `[WARN]` for a lane without one, or with a name that is not in the table). For phase lanes pick icons that suit each stage (`clipboard`, `check`, `shield`, `flag`, ...).

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

9. **Notes hold what the label leaves out.** Add a note only where the source gives a detail from the list below that the label lacks; most steps need none. A longer sentence saying the same thing as the label is not a note: drop it.
   - **In a note**: how or why the step is done (method, criteria), business rules and thresholds, amounts, SLAs, durations and schedules, the system or tool used, documents and forms, policy, regulation or ticket references, and examples. Keep the source's figures, names and IDs exactly.
   - **Never in a note**: flow. A step, branch, loop, hand-off or outcome that changes what happens next is a node or an edge, so a reader who never opens a note still sees the whole process. A note may add detail to a step but is never the only place a step appears. Never repeat the label.
   - **Form**: a fragment or one or two short sentences, facts over prose, `<= 140` chars; `\n` separates distinct facts.
   - **`showNotes`**: leave it out by default (notes open on hover). Set `true` when the reader needs the notes without interacting: the diagram is meant for export, print or a presentation, or the user asks for the detail to be visible.
   - **One note, several steps**: when the same fact explains several steps (one policy behind two decisions, one system doing three steps), write one note and list every step in `nodes`, never copies of it.
   - **Never write `pos`**: the page fits each note into a free gap; a note the user drags keeps its own place.
   - `--layout` prints a `[WARN]` for a note over the budget, one that repeats its step's label, or one linked to no existing step.

   ```json
   "nodes": [{ "id": "n5", "laneId": "lane-engine", "type": "task", "label": "Check Credit" }, ...],
   "notes": [{ "id": "note-2", "nodes": ["n5"],
               "text": "Experian bureau pull plus internal fraud rules\nScore < 620 is declined automatically" }]
   ```
   not `"label": "Run Experian Credit Check (Score >= 620)"` with no note.

10. **Classic symbols only where the source shows that kind of step**; otherwise use `task`. Each is a step in the sequence (arrows in and out), never a side box off the flow, with a task's size and colours. Labels stay verb + object (rule 1). `--layout` warns about an unknown `type`.

| `type` | Drawn as | Use when the step | Example |
|---|---|---|---|
| `subprocess` | box, double side bars | is a process documented elsewhere | `"Run Onboarding Process"` |
| `io` | parallelogram | receives or sends data (form, file) | `"Receive Claim Form"` |
| `document` | wavy-bottom box | produces a document (letter, invoice, report) | `"Issue Decline Letter"` |
| `database` | cylinder | reads or writes a system of record | `"Store Claim Record"` |
| `delay` | D-shape | is a wait (cooling-off, SLA timer, batch window) | `"Wait for Payment Run"` |

## Choosing the structure

Decide from the source, once, top row first. Do not trial the alternatives.

| Source looks like | Lanes | `direction` |
|---|---|---|
| Sequential boxes titled `Step N` / `Phase N` / `Stage N` | one lane per container, in order (diagonal staircase is expected) | `TB` if they stack downwards, else omit |
| Several actors or systems handing work over | one lane per actor | omit (`LR`) |
| Few actors but many steps | keep the actor lanes | `TB` (fits a page better) |
| One actor, one sequence | `"swimlanes": false` | `TB` if long, else omit |

**Lane order follows the flow, not the user's list.** The user's list of actors is a set, not an order. Walk the main (happy) path from the start node and list each actor the first time it does a step: that is the lane order, initiator first. Example: `Employee` submits, `IT` checks the request, `Line Manager` approves, then `Procurement`, `Finance`, `Supplier`. `IT` goes second even if the user listed it after `Line Manager`. Actors reached only on an exception path go after the last main-path actor they hand off to. Phase lanes (rule 7) keep their sequence. If this differs from the user's list, say so in the report.

## Visual review checklist

Routing, ports, arrow ends and lane containment are the engine's job; it does not need checking. Check these by eye on the screenshot, and apply the fix if one fails:

1. **Loop edges**: the edge that loops back is the intended one and runs through the outer corridor. If the wrong edge loops, or a node in a cycle sits in an odd column, set `"feedback": true` on the edge that should loop back and re-run `--layout`.
2. **Lane order keeps handoffs short**: no knot of long arrows bridging an uninvolved lane, and fan-in joins nest without one arrow cutting across another. First check that the order is the flow order (see "Lane order follows the flow"). Only if a knot remains, move the actor in the knot next to the lane it hands off to most often. Keep the initiator first, re-run, and say in the report that you reordered. Phase lanes (rule 7) keep their sequence.
3. **Every node is in the right lane**: the lane of the actor who performs it (rule 3).
4. **Every lane header names who does the work**: an actor, team or system, not an activity or category, or one sequential stage, for phase lanes (rule 7).
