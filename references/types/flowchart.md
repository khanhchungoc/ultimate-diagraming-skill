# Swimlane Flowchart (Mermaid `flowchart`)

Use for swimlane, cross-functional or BPMN-style process flows. Layout, routing, label placement and styling are computed by the tooling; author only the logical graph, as Mermaid.

## Mermaid

This is a complete diagram; no other file to read. Standard Mermaid `flowchart` syntax, plus the conventions below.

```mermaid
---
title: Customer Loan Application Process
---
flowchart
  subgraph lane_customer["Applicant / Customer"]
    submit(["Submit Application"])
    upload_docs[/"Upload Missing Docs"/]
    cooling_off@{ shape: delay, label: "Wait Cooling-Off Period" }
    sign["Sign Loan Agreement"]
    rejected(["Application Rejected"])
  end
  subgraph lane_officer["Loan Officer"]
    docs_ok{"Docs Complete?"}
    verify["Verify Income & Employment"]
    offer@{ shape: doc, label: "Issue Loan Offer" }
    disburse["Disburse Loan Funds"]
    funded(["Loan Funded"])
  end
  subgraph lane_engine["Automated Underwriting Engine"]
    store[("Store Application Record")]
    credit_check[["Run Credit & Fraud Check"]]
    score_ok{"Credit Score >= 700?"}
  end
  subgraph lane_risk["Risk & Compliance Committee"]
    risk_ok{"Risk Acceptable?"}
    decline_letter@{ shape: doc, label: "Issue Decline Letter" }
  end
  submit --> docs_ok
  docs_ok -->|"No"| upload_docs
  upload_docs ==>|"Resubmit"| docs_ok
  docs_ok -->|"Yes"| verify --> store --> credit_check --> score_ok
  score_ok -->|"Yes"| offer
  score_ok -->|"No"| risk_ok
  risk_ok -->|"Yes"| offer
  risk_ok -->|"No"| decline_letter --> rejected
  offer --> cooling_off --> sign --> disburse --> funded
  n1>"Online portal or branch<br>ID, payslips and 3 months of bank statements"] -.- submit
  n2>"Experian bureau pull plus internal fraud rules, about 2 minutes"] -.- credit_check
  n3>"Thresholds set by Lending Policy LP-7, reviewed quarterly"] -.- score_ok & risk_ok
  n4>"Sent within 30 days, stating the reason"] -.- decline_letter
  n5>"14 days, the applicant may withdraw without penalty"] -.- cooling_off
  n6>"Payslips checked against the employer, self-employed applicants need 2 years of accounts"] -.- verify
```

Conventions beyond standard Mermaid:

- **Header**: write a bare `flowchart`; `--layout` picks the direction. Write `flowchart TB` or `flowchart LR` only where "Choosing the structure" says to.
- **Lanes**: one top-level `subgraph lane_<slug>["Actor name"]` per lane, with its steps inside, in any order (`--layout` orders them by the flow, see below). No nested subgraphs, except a child flow's `sub_` block (rule 12). A diagram with one actor has no `subgraph` at all (no lane header column). Optional lane lines: `class lane_x c3` (palette slot `c1` to `c8`: only to give related lanes the same colour on purpose, never copied from the source; the theme supplies colours, and a colour the user set in the editor stays), `%% @icon lane_x user` (see Lane icons), `%% @laneOrder fixed` (keep the written lane order).
- **Steps**: ids are short slugs of the label (`validate_policy`, not `n5`) so every edge reads on its own; never `end`, `class` or `style`. Quote every label (`["Check (fast)"]`). Shapes: rule 10.
- **Start and end**: both are a pill `(["..."])`. A pill with no outgoing edge is an end; any other pill is a start. Open the flow with an explicit start pill (rule 1).
- **Edges**: `a --> b`, `a -->|"Yes"| b`; chains and `a & b --> c` are fine. Rule 2 says when a label is needed.
- **Loop back**: draw the one edge that returns to an earlier step as `==>` (thick). Without it the engine picks the loop edge by traversal order, which may be the wrong edge of a cycle.
- **Notes**: a flag-shaped node joined to its steps by a dotted line: `n1>"Text<br>second fact"] -.- step_a & step_b`. Never a step, never on a solid line. Rule 9 says what goes in one. `<br>` separates distinct facts. `%% @showNotes` shows every note on the page instead of on hover.
- **Text**: write `;` as `#59;` and `#` as `#35;` inside labels and notes.
- Never write positions; `style`, `classDef` and `click` lines are ignored.

## Writing rules

1. **Labels name the step; notes explain it.** The label is what a reader scans to follow the flow, so it carries only the step. Everything that explains the step goes in a note (rule 9).
   - **Tasks**: an imperative verb + the business object, 2–4 words, Title Case (`"Validate Order"`, `"Approve Loan"`), never a sentence (`"The order needs to be validated"`).
   - **Specific verbs**: not `"Process"`, `"Handle"`, `"Manage"` or `"Do"`; name the action (`"Handle Claim"` → `"Assess Claim"`).
   - **Leave out** articles and pronouns, the actor (the lane says who; phase lanes are the exception, rule 7), the element type (`"Decision:"`, `"Task:"`), step numbers, and every long explanation rule 9 puts in a note. Keep the condition and any short policy threshold a decision tests directly inside its question (`"Credit Score >= 700?"`, `"Role > Grade 7?"`, `"Offer Within Band?"`), rather than pushing short thresholds into notes.
   - **Start** names the trigger as an explicit start pill `(["..."])`: whenever a process trigger or event precedes the first task, emit that trigger as a start pill before the first task (`(["Hiring Need Identified"]) --> ["Raise Hiring Request"]`, `(["Order Received"]) --> ...`); use the first action as the start pill only when no separate trigger precedes it (`(["Submit Application"])`). **End** names the resulting state (`"Loan Approved"`, `"Claim Settled"`), one per outcome (rule 6).
   - **Distinct names**: no two steps share a label. If the same work really happens twice, loop back to it with an edge instead of repeating the node.
   - **A check is its decision**: a check, review, validation, verification, inspection or assessment whose only result is the answer to the next decision *is* that decision (`"Laptop in Stock?"`, never `"Check Stock"` → `"Laptop in Stock?"`). It sits in the checker's lane, and a loop that returned to the check returns to the decision. Keep a separate step only when it also produces something else (a record, a report, a configured device) or is a subprocess.
2. **Decisions end in `?`** (`"Docs Complete?"`) and every outgoing branch is labeled. A two-way decision is a yes/no question with `Yes`/`No` branches (`"Justification Approved?"`, not Approve/Reject), whatever words the sources use for the outcomes. Use named outcomes only for three or more branches, one edge per outcome (`"Purchase Value Band?"` → `"<= $1,500"`, `"$1,501–$5,000"`, `"> $5,000"`). Never mix the two styles on one decision, and never chain Yes/No diamonds to split one question. Keep sequential guard checks separate only when each failure routes to a different owner or end state; when several criteria combine into one outcome (such as a scoring matrix or tiered policy), evaluate them in one task and put the decision table in its note. Numeric branches keep the sources' exact boundaries and never overlap. Only decision branches get `Yes`/`No` labels: an edge leaving a step has no label.
   - **Parallel work (`AND`) vs decisions (`XOR`)**: a decision takes one outgoing branch. For steps that run concurrently, draw several unlabelled edges out of the preceding task (never a decision or an invented fork/join shape) and merge them into one join task, with a note stating that all parallel branches must complete before continuing.
3. **One owner per node**: place each node in the lane of the actor who performs it.
4. **Keep labels short, counted in words**: at most **5 words** for any step or decision (tasks are usually 2–4, rule 1). A longer label is cut with `...` and shows on hover, but an exported or printed diagram has no hover.
   - **Lane names**: at most 4 words (about 32 characters), so the floating pill never truncates.
   - **Fidelity**: keep the user's wording when it fits 5 words and rule 1. Otherwise cut the label to its verb + object; if the cut removed real detail (rule 9's list), put only that detail in a note, never the whole original sentence. Never abbreviate words (`"Auth"`) to save space.
5. **Overview requests**: if the user asks for a summary, high-level overview or one-slide flow, aim for about 7 columns and 12 nodes so it fits a 1080p screen without panning. Otherwise include every step the source has; the page pans and zooms. Each flow (the parent, and every child of rule 12) holds at most **30 steps** (starts, ends and notes do not count) and **6 lanes**; `--layout` prints a `[WARN]` for more. Fix too many lanes in this order: (a) a system that only stores or is read from becomes a database shape `[("...")]` in the acting actor's lane, not a lane of its own; (b) actors with the same role merge into one lane (rule 7); (c) the block that needs the extra lanes becomes a subprocess (rule 12), and its child carries those lanes.
6. **Exceptions end in their own end state.** A path that finishes unresolved (manual intervention, escalation, an unhandled fallback) ends in a separate end node named for that outcome (`"Manual Payment Required"`), never merged into the success end (`"Claim Settled"`). Creating a task for someone else is not completion. If a failure path must undo earlier work (such as releasing reserved stock or reversing a charge), include the compensating step before that failure end node.
   - **Approvals are decisions.** An approval, sign-off or authorisation is a decision node (`"Budget Approved?"`) with both outcomes, even when the source names only the approval; a plain review or check with no stated failure outcome stays a task. An unstated rejection ends in its own state (`"Request Rejected"`): report that end state as an assumption, but not the decision itself (this rule chose it).
   - **Timeouts, escalations, retries and repeat limits**: model any SLA timeout, retry limit or repeat limit (such as repeating a probation review once) as an explicit decision node (`"Approved in 48h?"`, `"Retries < 3?"`, `"First Probation Extension?"`) with both branches (`Yes` looping back, `No` ending or escalating) rather than hiding the limit inside a note or edge label; use a delay shape only for an unconditional wait along a path.
7. **One lane per actor.** A lane is who does the work: a role, team, organisation or system that performs steps.
   - Name lanes as actor nouns (`"Loan Officer"`, `"Customer"`, `"Payment Gateway"`), never an activity (`"Review"`), a status (`"Pending"`) or a category (`"Manual Tasks"`). Prefer roles to people's names.
   - **One name per actor**: when sources name one actor differently (`"IT Support"`, `"IT Department"`), use the name the sources use most often (on a tie, the shortest) and report the choice as an assumption.
   - A system is an actor only when it acts (`"Core Banking"` validating something). Don't add a lane for a system that is only mentioned.
   - If the source doesn't name actors, infer them from who performs each verb. If you can't, or the whole process has one actor, write no `subgraph`. Never use a generic lane such as `"Process"`, `"Steps"` or `"Other"`.
   - **Exception, phase lanes**: if the source groups steps into sequential containers (step, phase, stage, milestone, sprint, gate, quarter) and every step in one group happens after every step in the previous one, use one lane per container, in order (`lane_step1`, ...) (`flowchart TB`, `subgraph lane_step1["Step 1: Request"]`, ...); otherwise use actor lanes. If the source shows both, follow whichever it groups by visually. Phase lanes drop ownership, so only here keep the actor in a label where it matters (`"Officer Reviews Docs"`). A jump back to an earlier phase is a loop-back edge.
8. **Lane icons are automatic**: `--layout` picks a different icon for each lane from its name and reports it as one `[INFO] Lane icons: ...` line. To choose one, write `%% @icon lane_x <name>` (names under Lane icons; an unknown name is a `[WARN]`). For phase lanes, icons that suit each stage (`clipboard`, `check`, `shield`, `flag`, ...) read best.
9. **Notes hold what the label leaves out.** Add a note only where the source gives a detail from the list below that the label lacks; most steps need none. A longer sentence saying the same thing as the label is not a note: drop it.
   - **In a note**: how or why the step is done (method, criteria), multi-condition rules or thresholds too detailed for a 5-word decision label, amounts, SLAs, durations and schedules, the system or tool used, documents and forms, policy, regulation or ticket references, and examples. Keep the source's figures, names and IDs exactly, while keeping short policy thresholds (such as `> Grade 7`) inside decision labels.
   - **Never in a note**: flow. A step, branch, loop, retry or repeat limit, hand-off or outcome that changes what happens next is a node or an edge, so a reader who never opens a note still sees the whole process. A note may add detail to a step but is never the only place a step appears. Never repeat the label. Test: if deleting the note would change what a reader thinks happens next, it is flow.
   - **Form**: a fragment or one or two short sentences, facts over prose, at most 140 characters; `<br>` separates distinct facts.
   - **`%% @showNotes`**: leave it out by default (notes open on hover). Write it when the reader needs the notes without interacting: the diagram is meant for export, print or a presentation, or the user asks for the detail to be visible.
   - **One note, several steps**: when the same fact explains several steps (one policy behind two decisions, one system doing three steps), write one note joined to every step (`-.- a & b`), never copies of it.
10. **Classic symbols by the step's object**: use the shape whose row matches the step. Anything else is a plain task `["..."]`, including every step where the actor decides, writes content or does physical work, and every step you are unsure about. Each is a step in the sequence (arrows in and out), never a side box off the flow, with a task's size and colours. Labels stay verb + object (rule 1).

| Write as | Use when the step |
|---|---|
| `id[["..."]]` subprocess | is a process documented elsewhere (`"Run Onboarding Process"`) |
| `id[/"..."/]` io | only transfers a form, file or data between parties: upload, submit, send, receive (`"Upload Missing Docs"`) |
| `id@{ shape: doc, label: "..." }` document | produces a named document for someone else: letter, purchase order, invoice, contract, report (`"Issue Decline Letter"`) |
| `id[("...")]` database | reads or writes a named system of record: ERP, CRM, asset register (`"Store Claim Record"`) |
| `id@{ shape: delay, label: "..." }` delay | is a wait: cooling-off, SLA timer, batch window (`"Wait for Payment Run"`) |

Other Mermaid shapes (hexagon, trapezoid, ...) are read as a task with an `[INFO]`.

11. **Plain arrows only; never write a connector** (`id(("A"))`). `--layout` splits a long, tangled arrow into a lettered connector pair itself and prints `[INFO] Added connector pair A: <from> -> <to>`, or `[INFO] Layout: Long arrow ...` for one it leaves. Report those lines; do not edit the Mermaid for them. If the source draws connectors, write the arrow they stand for.

12. **Split a large flow into subprocesses by business meaning.** Over 30 steps or 6 lanes in one flow, move a block into a child flow: the parent keeps a `[["..."]]` step (rule 10) with the child's id, the child is a top-level `subgraph sub_<slug>["Name"]` block (below). The step count says *when* to split, never *where*. Cut where the block is a unit of business meaning; signals, strongest first:
    1. **One business outcome**: the block ends in a named result (`"Credit Decided"`, `"Funds Disbursed"`).
    2. **Named in the source**: a section heading, an SOP or procedure name, a `Phase N` box, a standard process name.
    3. **State change of the business object** at its boundary (Application, Approved, Funded).
    4. **One owning team**, even when it touches other lanes. A lane alone is not a subprocess: a lane says who, a subprocess says what.
    5. **Reused**: the same work is invoked from more than one place.
    6. **A cohesive exception path** (`"Handle Fraud Alert"`).
    7. **A compliance or SLA unit**: audited, measured or timed as a whole.

    Test: can the block be named as verb + business object (rule 1), and does it end in a business outcome? If not, do not cut there. Anti-patterns: cutting at step 30 because it is step 30; a subprocess of one or two steps; one that hides a decision the parent needs to route on; one subprocess per lane. A `[["..."]]` step without a `sub_` block stays a label for a process documented elsewhere. One level only: a child has no children.

    Hard constraints: one way in and one way out (every arrow into the block reaches its start, its outcomes leave through the parent step), and no loop-back arrow crosses the boundary (an arrow never crosses a `sub_` boundary: the link is the slug only).
    - **Convention**: `sub_<slug>` belongs to the parent step with the id `<slug>`. The child holds its own `lane_` subgraphs, written after the parent's arrows; its arrows and notes follow its block. Step and note ids are unique in the whole file.
    - **One actor, one lane id**: the same actor in several flows reuses the same `lane_<slug>` in each `sub_` block. The first `subgraph lane_x["Name"]` (and its `class` / `%% @icon` line) sets name, icon and colour; a repeat may write the same name or none. A repeat with another name is a `[WARN]` and the first name wins. A child shows only the lanes its steps use.
    - **Parent-child contract**: the child opens with one start pill named like the parent step (or the trigger it receives). Its end pills are its outcomes. When the parent step is followed by a decision, the ends map to its branches by name: two ends to `Yes`/`No` of a yes/no question (`"Income Verified"` / `"Income Not Verified"` to `Income Verified?`), three or more one-to-one to named branches; one end means the parent just continues. `--layout` warns for a `sub_` without its `[["..."]]` step, a child without exactly one start, and an end count that differs from the branch count.
    - **Candidates**: when a flow has more than 30 steps, `--layout` also prints the single-entry, single-exit blocks of it, largest first (`[INFO] Subprocess candidate: verify_docs..income_ok (8 steps, 3 lanes)`). They are only valid cuts: name and choose by the signals above.

```mermaid
flowchart
  subgraph lane_officer["Loan Officer"]
    submit(["Application Received"])
    verify_income[["Verify Income"]]
    income_ok{"Income Verified?"}
    funded(["Loan Funded"])
    declined(["Application Declined"])
  end
  submit --> verify_income --> income_ok
  income_ok -->|"Yes"| funded
  income_ok -->|"No"| declined

  subgraph sub_verify_income["Verify Income"]
    subgraph lane_officer["Loan Officer"]
      vi_start(["Verify Income"])
      check_payslips["Check Payslips"]
      vi_ok(["Income Verified"])
      vi_fail(["Income Not Verified"])
    end
    subgraph lane_employer["Employer"]
      confirm_salary["Confirm Salary"]
      salary_matches{"Salary Matches?"}
    end
  end
  vi_start --> check_payslips --> confirm_salary --> salary_matches
  salary_matches -->|"Yes"| vi_ok
  salary_matches -->|"No"| vi_fail
```

## Choosing the structure

Decide from the source, once, first match first (rule 7 has the details). Do not trial the alternatives.

- Sequential boxes titled `Step N` / `Phase N` / `Stage N`: one lane per container, in order; `flowchart TB` if they stack downwards.
- Several actors or systems handing work over: one lane per actor. One actor, one sequence: no `subgraph`.
- Write a direction only for phase lanes as above, or when the user names one ("vertical" is `TB`, "left to right" is `LR`); otherwise a bare `flowchart`.
- A flow over 30 steps or 6 lanes: split it into subprocesses by business meaning (rule 12); the parent stays within the limits too.
- Write lanes in any order: `--layout` orders them by the flow (not phase lanes) and prints `[INFO] Lane order: ...`; report it.

**Updating an existing flowchart**: a re-layout resets lane heights and keeps lane order, lane membership and loop-back edges; a note the user dragged keeps its place beside its step. With Auto layout on (the default) the page already re-lays out after every step edit, so hand-placed positions exist only where the user switched Auto off.

## Lane icons

Optional (rule 8). Names: `user`, `users`, `briefcase`, `building`, `headset`, `monitor`, `code`, `server`, `database`, `cloud`, `cpu`, `cog`, `shield`, `scale`, `banknote`, `credit-card`, `mail`, `package`, `truck`, `cart`, `clipboard`, `check`, `layers`, `globe`, `flag`.
