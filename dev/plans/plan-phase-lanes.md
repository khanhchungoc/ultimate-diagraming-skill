# Plan: Actor and phase lanes, automatic lane colours

Changes to the flowchart type:

1. **Lane rules**: in a normal diagram every lane names an actor (who does the work). The one exception is a source grouped into sequential Step/Phase/Stage containers, where each container becomes a lane and the diagonal "staircase" layout is expected.
2. **Automatic lane colours**: `color` becomes optional, and lanes are coloured by order instead of by a role table.
3. **A phases example** for agents to copy.

There's no engine work for the MVP. Phase lanes are ordinary lanes.

The agent-speed doc fixes from the same review (fixed recipe, "stop when clean" rule, probe ban, doc trim, SKILL.md as a router) are already done.

## Background

A test run recreating a diagram grouped into "Step 1 / Step 2 / ..." containers took ~5 minutes, of which ~30 s was real work. The layout scored 100/100 on the first pass. About 2 minutes went on reading the engine and renderer source, partly because the result was a diagonal staircase and nothing in the docs said that was expected:

```
Step 1 │ [A]→[B]
Step 2 │         [C]→[D]
Step 3 │                 [E]→[F]
```

Lanes share one timeline: a node sits after its predecessor whatever lane that is in. So sequential lanes always form a diagonal. It is accurate: order is clear and every arrow points forward. Its only costs are space (an empty triangle beside the diagonal; a large diagram means smaller text at Fit) and a looser match to a source drawn as stacked boxes. That's acceptable for the MVP. The fix is to document the staircase, not to change the layout.

## Goals

- Agents pick the lane structure from one clear rule and don't investigate the staircase.
- Lanes in a normal diagram always represent an actor (role, team, organisation or system).
- Lane colours need no decision from the agent.
- Re-running the original Step-container test takes about 6 tool calls and 1–1.5 min.

## Non-goals

- **Phase restart layout** (see [Later](#later-phase-restart-layout)): nice, but not MVP.
- **Actors and phases in one diagram** (the BPMN lanes x phases grid).
- **Free-form groups/clusters** (Graphviz-style boxes anywhere). They would cut across lanes and overlap, and the engine does no 2D packing.
- **Unordered categories as lanes** ("Manual vs Automated", "Type A / Type B"). They hide ownership. A layout-neutral node `tag` with a legend could come later as its own small feature.
- **Detecting non-actor lane names in `--verify`.** That depends on wording. It's handled by docs and the visual checklist.
- **A `--cleanup` flag on `render_screenshot.py`.** It would save one tool call. Skipped.

## Part 1: Lane rules (docs)

Edit [references/types/flowchart.md](../../references/types/flowchart.md).

### Rule 7, rewritten: one lane per actor, or per phase

Every lane is an **actor**: a role, team, organisation or system that performs steps. This is what a swimlane means in flowchart and BPMN practice.

- **Name lanes as actor nouns**: "Loan Officer", "Customer", "Payment Gateway". Never an activity ("Review"), a status ("Pending") or a category ("Manual tasks").
- **Prefer roles over people**: "Claims Assessor", not a person's name.
- **Systems are actors only when they act**, e.g. "Core Banking" validating something. Don't add a lane for a system that is only mentioned.
- **Infer actors** from who performs each verb when the source doesn't name them. If you can't infer them, use `swimlanes: false`. Never use a generic lane such as "Process", "Steps" or "Other".
- **One actor**: `swimlanes: false` (existing rule).
- **Rule 3 still holds**: one owner per node. If a step has two actors, put it in the lane of the one who does the work and mention the other in the label if it matters.

**Exception: phase lanes.** If the source groups steps into sequential containers, use one lane per container, in order (`lane-step1`, `lane-step2`, ...).

- **Test**: does every step in group 2 happen after every step in group 1? Yes → phase lanes. No → actor lanes.
- **Trigger words**:
  - **Phase lanes**: step, phase, stage, milestone, sprint, gate, quarter.
  - **Actor lanes**: actor, team, system, department.
- **The layout is a diagonal staircase.** Each phase starts where the previous one ended. This is expected and correct; don't try to change it, and don't check the engine.
- Phase lanes drop ownership. Where the actor matters, keep it in the label ("Officer Reviews Docs").
- If the source shows both actors and phases, follow whichever it groups by visually.
- Mostly sequential groups with one step jumping back still count as phases; the jump is a loop-back edge (`feedback: true` if the engine picks the wrong one).

### "Choosing the structure" table, replaced

Decide once, in this order. Do not trial the alternatives.

| Source looks like | Lanes | `direction` |
|---|---|---|
| Sequential boxes titled `Step N` / `Phase N` / `Stage N` | one lane per container, in order (staircase layout is expected) | `TB` if they stack downwards, else omit |
| Several actors or systems handing work over | one lane per actor | omit (`LR`) |
| Few actors but many steps | keep the actor lanes | `TB` |
| One actor, one sequence | `"swimlanes": false` | `TB` if long, else omit |

### Icon rule (rule 8)

It applies to phase lanes too, so `--verify` needs no change. Add a hint to the icon table: `flag`, `clipboard` or `check` suit stages. Phase lanes still need distinct icons within a diagram.

### Visual checklist

Item 4 already says "Every lane header names who does the work". Extend it to "... or one sequential stage, for phase lanes".

## Part 2: Lane colours, automatic by order

The current "Lane role → Color" table (Customer = sky, Frontend/Sales/Ops = amber, ...) is too specific. Most diagrams' actors don't fit its five role types, it means nothing for phase lanes, and it adds a choice per lane for the agent. Today a lane without `color` falls back to grey ([flowchart.js:239](../../assets/types/flowchart/flowchart.js#L239)), which is why the docs push agents to always pick one.

- **Renderer**: when `color` is missing, take it from an ordered palette by lane index, repeating when there are more lanes than colours. The palette is the current five tints (sky, amber, emerald, rose, purple) plus about three more (e.g. teal, indigo, slate), checked in both themes.
- **Save**: don't write the automatic colours back into the JSON, so reordering lanes recolours them consistently. An explicit `color` is kept as is.
- **flowchart.md**: delete the role table only once the renderer change ships. Until then a missing colour is grey. The schema row then says: "`color` is optional. Omit it; lanes get palette colours in order. Set it only to match the source's colours, or to give related lanes the same colour on purpose."
- **Examples**: remove `color` from the example JSON files unless an example shows the override.
- **Goldens**: unaffected, because colour isn't part of the layout.

## Part 3: Phases example

Add `references/examples/example-flowchart-phases.json`:

- **Shape**: a small TB file with phase lanes (about 4 phases, 8–10 nodes, two decisions, one loop back to an earlier phase).
- **Purpose**: it mirrors the Step-container diagram from the test run, so agents copy its shape instead of exploring.
- **Links**: from the top of `flowchart.md`, from the phase-lanes exception in rule 7, and in the flowchart row of SKILL.md's Step 0 table ("read the phases example instead when the source has Step/Phase containers").
- **Check**: build it with `--layout` and the render command; it must score ≥ 90 with no `[WARN]`.

## Order of work

1. Part 1 lane rules (docs only).
2. Part 3 phases example.
3. Part 2 automatic colours (renderer, then the doc cleanup).
4. Re-run the original Step-container test. Target: about 6 tool calls, about 1–1.5 min, no source reading.

## Later: phase restart layout

Not MVP. Recorded so the design isn't lost.

The idea: a diagram-level `"laneMode": "phase"` flag that restarts the timeline in each lane, like lines of text wrapping. It removes the empty triangle and matches stacked-box sources more closely:

```
Step 1 │ [A]→[B]─┐
Step 2 │ [C]→[D]─┐   (← B wraps to C)
Step 3 │ [E]→[F]
```

- **Renderer**: no change; bands look exactly like lanes.
- **Engine**: ranks restart per lane. Branches inside a phase use the existing lane sub-row logic.
- **Wrap edges**: the main cost. The edge from the end of one band to the start of the next runs against the flow, like a loop-back, and should reuse the outer-corridor routing. It needs testing in LR and TB.
- **Not automatic**: an actor handoff chain is also sequential, and there the staircase is the correct swimlane picture. The agent sets the flag from what the source means.
- **Earlier decisions to carry over**:
  - an edge into an earlier phase counts as `feedback` unless an edge in that cycle is already marked;
  - the Lane on/off button is hidden in phase mode;
  - there's no phase ↔ actor toggle on the page.
- **Tests**: new fixtures (`phases-tb`, `phases-lr`, an empty phase), goldens, and e2e checks for Save round-tripping `laneMode`.
