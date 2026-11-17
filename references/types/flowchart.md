# Swimlane Flowchart (`diagramType: "flowchart"`)

Use for swimlane, cross-functional or BPMN-style process flows. Layout, routing, label placement and styling are computed by the tooling; author only the logical graph.

**Example to copy (read one next; paths are from `<skill-dir>`):**
- the source groups steps into Step / Phase / Stage boxes: `references/examples/example-flowchart-phases.json` (phase lanes, rule 7);
- otherwise: `references/examples/example-flowchart.json` (actor lanes).

## Schema

Never add pixel coordinates (`x`, `y`); `--layout` computes them. A saved page embeds exactly this JSON, steps sorted by position along the flow, plus a trailing `layout` map of positions that only the page writes.

```json
{
  "diagramType": "flowchart",
  "title": "Process Title",
  "lanes": [{ "id": "lane-customer", "name": "Customer", "icon": "user" }],
  "nodes": [{ "id": "n_submit_request", "laneId": "lane-customer", "type": "start", "label": "Submit Request" }],
  "edges": [{ "id": "e1", "from": "n_submit_request", "to": "n_validate_request", "label": "" }],
  "notes": [{ "id": "note-1", "text": "Online form or branch visit", "nodes": ["n_submit_request"] }]
}
```

| Object | Field | Description |
|---|---|---|
| Lane | `id`, `name`, `icon` | Unique id (`lane-<slug>`), the actor's name (or the phase's, see rule 7), and an `icon` (see rule 8). |
| Lane | `color` | Optional. Omit it: lanes get palette colours in order. Set a palette slot (`"1"` to `"8"`) only to give related lanes the same colour on purpose; never copy colours from the source, the theme's palette supplies them. A person can change a lane's colour in the editor (lane bar), so keep what you find there. |
| Node | `id`, `laneId`, `type`, `label` | `id` is a short slug of the label (`n_validate_policy`, not `n5`), so every edge reads on its own. `type` is `start`, `task`, `decision`, `end` or a classic symbol (rule 10); never `connector` (rule 11). `start` and `end` render as rounded pills in their own colours (a plain circle if the label is empty); `task` is a box, `decision` a diamond. |
| Edge | `id`, `from`, `to`, `label` | `label` is `"Yes"`, `"No"`, `"Resubmit"`, etc.; `""` for unconditional steps. |
| Note | `id`, `text`, `nodes` | Optional list `notes`: plain text that explains one or more steps (what goes in it: rule 9). `nodes` lists the ids of the steps it explains; the first is where it sits. Each linked step shows a small badge the reader hovers to see the note. |
| Diagram | `showNotes` | Optional `true` shows every note on the page (fitted into the gaps near its node) instead of on hover; when to set it: rule 9. |
| Diagram | `swimlanes` | Optional `false` hides the lane header column, tint and borders (when: rule 7 and "Choosing the structure"). Keep exactly one lane in `lanes` and put every node in it (the tooling creates `lane-main` if `lanes` is empty). The lane icon rule does not apply. |
| Diagram | `laneOrder` | Optional `"fixed"` keeps `lanes` in the written order. Leave it out: `--layout` orders lanes by the flow. |
| Diagram | `direction` | Optional `"LR"` or `"TB"` (top to bottom). Leave it out unless "Choosing the structure" says to: `--layout` picks it. |
| Edge | `feedback` | Optional `true` marks a loop-back edge so it always routes through the outer corridor. Without it the engine picks the loop edge by traversal order, which may choose the wrong edge of a cycle. |

## Writing rules

1. **Labels name the step; notes explain it.** The label is what a reader scans to follow the flow, so it carries only the step. Everything that explains the step goes in a note (rule 9).
   - **Tasks**: an imperative verb + the business object, 2–4 words, Title Case (`"Validate Order"`, `"Approve Loan"`), never a sentence (`"The order needs to be validated"`).
   - **Specific verbs**: a generic verb (`"Process"`, `"Handle"`, `"Manage"`, `"Do"`) hides what happens; name the action (`"Handle Claim"` → `"Assess Claim"`).
   - **Leave out** articles and pronouns, the actor (the lane says who; phase lanes are the exception, rule 7), the element type (`"Decision:"`, `"Task:"`), step numbers, and every detail rule 9 puts in a note. The one exception is the condition a decision tests, which is its question (`"Credit Score >= 700?"`).
   - **Start** names the trigger, as an event (`"Order Received"`) or the first action (`"Submit Application"`); **end** names the resulting state (`"Loan Approved"`, `"Claim Settled"`), one per outcome (rule 6).
   - **Distinct names**: no two steps share a label. If the same work really happens twice, loop back to it with an edge instead of repeating the node.
   - **A check is its decision**: a check, review, validation, verification, inspection or assessment whose only result is the answer to the next decision *is* that decision (`"Laptop in Stock?"`, never `"Check Stock"` → `"Laptop in Stock?"`). It sits in the checker's lane, and a loop that returned to the check returns to the decision. Keep a separate step only when it also produces something else (a record, a report, a configured device) or is a `subprocess`.
2. **Decisions end in `?`** (`"Docs Complete?"`) and every outgoing branch is labeled. A two-way decision is a yes/no question with `Yes`/`No` branches (`"Justification Approved?"`, not Approve/Reject), whatever words the sources use for the outcomes. Use named outcomes only for three or more branches, one edge per outcome (`"Purchase Value Band?"` → `"<= $1,500"`, `"$1,501–$5,000"`, `"> $5,000"`). Never mix the two styles on one decision, and never chain Yes/No diamonds to split one question. Keep sequential guard checks separate only when each failure routes to a different owner or `end` state; when several criteria combine into one outcome (such as a scoring matrix or tiered policy), evaluate them in one `task` and put the decision table in its `note`. Numeric branches keep the sources' exact boundaries and never overlap. Only decision branches get `Yes`/`No` labels: an edge leaving a step is `""` (`--layout` warns about a `Yes`/`No` on a step). Mark the one edge that loops back to an earlier step `"feedback": true`, so the engine routes that edge as the loop.
   - **Parallel work (`AND`) vs decisions (`XOR`)**: a `decision` tests a condition and takes one outgoing branch. When two or more steps run concurrently, draw multiple unlabelled (`""`) edges out of the preceding `task` (never a `decision` or an invented `"fork"`/`"join"` type) and merge them into one downstream join `task`, with a `note` stating that all parallel branches must complete before continuing.
3. **One owner per node**: place each node in the lane of the actor who performs it.
4. **Keep labels short, counted in words**: at most **5 words** for any step or decision (tasks are usually 2–4, rule 1). A longer label is cut with `...` and shows on hover, but an exported or printed diagram has no hover.
   - **Lane names**: at most 4 words (about 32 characters), so the floating pill never truncates.
   - **Fidelity**: keep the user's wording when it fits 5 words and rule 1. Otherwise cut the label to its verb + object; if the cut removed real detail (rule 9's list), put only that detail in a note, never the whole original sentence. Never abbreviate words (`"Auth"`) to save space.
5. **Overview requests**: if the user asks for a summary, high-level overview or one-slide flow, aim for about 7 columns and 12 nodes so it fits a 1080p screen without panning. Otherwise include every step the source has; the page pans and zooms.
6. **Exceptions end in their own end state.** A path that finishes unresolved (manual intervention, escalation, an unhandled fallback) ends in a separate `end` node named for that outcome (`"Manual Payment Required"`), never merged into the success end (`"Claim Settled"`). Creating a task for someone else is not completion. If a failure path must undo earlier work (such as releasing reserved stock or reversing a charge), include the compensating step before that failure `end` node.
   - **Approvals are decisions.** An approval, sign-off or authorisation is a decision node (`"Budget Approved?"`) with both outcomes, even when the source names only the approval; a plain review or check with no stated failure outcome stays a task. An unstated rejection ends in its own state (`"Request Rejected"`): report that end state as an assumption, but not the decision itself (this rule chose it).
   - **Timeouts, escalations and retries**: model an SLA timeout or retry limit as an explicit `decision` (`"Approved in 48h?"`, `"Retries < 3?"`) rather than hiding the transition inside a `note`; use `delay` only for an unconditional wait along a path.
7. **One lane per actor.** A lane is who does the work: a role, team, organisation or system that performs steps.
   - Name lanes as actor nouns (`"Loan Officer"`, `"Customer"`, `"Payment Gateway"`), never an activity (`"Review"`), a status (`"Pending"`) or a category (`"Manual Tasks"`). Prefer roles to people's names.
   - **One name per actor**: when sources name one actor differently (`"IT Support"`, `"IT Department"`), use the name the sources use most often (on a tie, the shortest) and report the choice as an assumption.
   - A system is an actor only when it acts (`"Core Banking"` validating something). Don't add a lane for a system that is only mentioned.
   - If the source doesn't name actors, infer them from who performs each verb. If you can't, or the whole process has one actor, set `"swimlanes": false`. Never use a generic lane such as `"Process"`, `"Steps"` or `"Other"`.
   - **Exception, phase lanes**: if the source groups steps into sequential containers (step, phase, stage, milestone, sprint, gate, quarter) and every step in one group happens after every step in the previous one, use one lane per container, in order (`lane-step1`, ...), as in the phases example; otherwise use actor lanes. If the source shows both, follow whichever it groups by visually. Phase lanes drop ownership, so only here keep the actor in a label where it matters (`"Officer Reviews Docs"`). A jump back to an earlier phase is a loop-back edge.
8. **Every lane gets an `icon`**, chosen from [Lane icons](#lane-icons) to match the actor or system. Use a different icon for each lane in one diagram, and never leave one out (`--layout` prints a `[WARN]` for a lane without one, or with a name that is not in the table). For phase lanes pick icons that suit each stage (`clipboard`, `check`, `shield`, `flag`, ...).

9. **Notes hold what the label leaves out.** Add a note only where the source gives a detail from the list below that the label lacks; most steps need none. A longer sentence saying the same thing as the label is not a note: drop it.
   - **In a note**: how or why the step is done (method, criteria), business rules and thresholds, amounts, SLAs, durations and schedules, the system or tool used, documents and forms, policy, regulation or ticket references, and examples. Keep the source's figures, names and IDs exactly.
   - **Never in a note**: flow. A step, branch, loop, hand-off or outcome that changes what happens next is a node or an edge, so a reader who never opens a note still sees the whole process. A note may add detail to a step but is never the only place a step appears. Never repeat the label. Test: if deleting the note would change what a reader thinks happens next, it is flow.
   - **Form**: a fragment or one or two short sentences, facts over prose, `<= 140` chars; `\n` separates distinct facts.
   - **`showNotes`**: leave it out by default (notes open on hover). Set `true` when the reader needs the notes without interacting: the diagram is meant for export, print or a presentation, or the user asks for the detail to be visible.
   - **One note, several steps**: when the same fact explains several steps (one policy behind two decisions, one system doing three steps), write one note and list every step in `nodes`, never copies of it.
   - `--layout` prints a `[WARN]` for a note over the budget, one that repeats its step's label, or one linked to no existing step.

   ```json
   "nodes": [{ "id": "n_check_credit", "laneId": "lane-engine", "type": "task", "label": "Check Credit" }, ...],
   "notes": [{ "id": "note-2", "nodes": ["n_check_credit"],
               "text": "Experian bureau pull plus internal fraud rules\nScore < 620 is declined automatically" }]
   ```
   not `"label": "Run Experian Credit Check (Score >= 620)"` with no note.

10. **Classic symbols by the step's object**: use the `type` whose row matches the step. Anything else is a `task`, including every step where the actor decides, writes content or does physical work, and every step you are unsure about. Each is a step in the sequence (arrows in and out), never a side box off the flow, with a task's size and colours. Labels stay verb + object (rule 1). `--layout` warns about an unknown `type`.

| `type` | Drawn as | Use when the step | Example |
|---|---|---|---|
| `subprocess` | box, double side bars | is a process documented elsewhere | `"Run Onboarding Process"` |
| `io` | parallelogram | only transfers a form, file or data between parties (upload, submit, send, receive) | `"Upload Missing Docs"` |
| `document` | wavy-bottom box | produces a named document for someone else (letter, purchase order, invoice, contract, report) | `"Issue Decline Letter"` |
| `database` | cylinder | reads or writes a named system of record (ERP, CRM, asset register) | `"Store Claim Record"` |
| `delay` | D-shape | is a wait (cooling-off, SLA timer, batch window) | `"Wait for Payment Run"` |

11. **Plain arrows only; never write a `connector` node.** `--layout` splits a long, tangled arrow into a lettered connector pair itself and prints `[INFO] Added connector pair A: <from> -> <to>`, or `[INFO] Layout: Long arrow ...` for one it leaves. Report those lines; do not edit the JSON for them. If the source draws connectors, write the arrow they stand for.

## Choosing the structure

Decide from the source, once, first match first. Do not trial the alternatives.

- Sequential boxes titled `Step N` / `Phase N` / `Stage N`: one lane per container, in order (rule 7); `"direction": "TB"` if they stack downwards.
- Several actors or systems handing work over: one lane per actor.
- One actor, one sequence: `"swimlanes": false`.
- Set `direction` only for phase lanes as above, or when the user names one ("vertical" is `TB`, "left to right" is `LR`); otherwise `--layout` picks it.
- Write lanes in any order: `--layout` orders them by the flow (not phase lanes) and prints `[INFO] Lane order: ...`; report it.

**Updating an existing flowchart**: a re-layout also resets lane heights and keeps lane order, lane membership and `feedback` flags; a note the user dragged keeps its place beside its step. With Auto layout on (the default) the page already re-lays out after every step edit, so hand-placed positions exist only where the user switched Auto off.

## Lane icons

For rule 8.

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
