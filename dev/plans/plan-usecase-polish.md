# Plan: use case diagrams, data only for the agent

Status: Phase 1 done (word limits, cut text shows on hover, `side` left to the tool; PR #25 added hover text and tool-set ERD detail). Phase 2 reviewed against main 996404c: every item is obsolete or not worth it, no engine change (see below). Phase 0 benchmark is out of scope for now: it needs fresh agent runs.

## Why

The flowchart work (PRs #18 to #22) cut an agent's session on the motor sample from 109 s, 2 runs, 1 JSON edit and 2 PNG views to 54 s, 1 run and none of the rest; writing the JSON is about 35 to 45 s of it. The rule:

> The agent writes what the requirements say: subjects, actors, use cases, who takes part in what, include and extend, notes and refs. The engine decides where everything goes and how it is drawn, and never asks the agent to change the data for a layout reason.

The use case type already follows most of this: data errors are `[WARN]`, layout findings `[INFO] Layout`, actor sides default from the links, and every fixture passes clean. What is left is below.

## What still costs the agent time

From `references/types/usecase.md`:

| Item | Cost | Change |
|---|---|---|
| Character budgets: actor 24, use case name 40, extend condition 40, ref 12; over budget is a `[WARN]` | The agent counts characters; a miss means an edit and a second run | Word limits (actor 3 words, use case 5, condition 6), "..." with hover past the room, `[INFO]`. Refs stay at 12 characters: they are ids. |
| `side` (left or right) | Optional, defaults from the links | Remove from the agent's schema; keep for the page. |
| `showNotes`, `collapsed` | Already "never author unless asked" | Keep. |
| `[INFO]` hints on naming ("does not start with a verb", "included only by one: fold it in") | They invite a re-word and a re-run after `[DONE]` | Move to the reference's rules as checks before writing; print them only in the final report, not as something to act on. |

## Phases

### Phase 0: measure the agent

- Benchmark like the flowchart one: 2 prompts (a 10-requirement shop, a 30-requirement two-system spec), a fresh agent each; record total time, JSON writing time, `--layout` runs, JSON edits, PNG views and fields authored. Run before and after each phase.
- Layout numbers per fixture: crossings, hits, total line length, longest lines, labels within 8 px of each other, canvas size and aspect.

### Phase 1: the contract (one PR, the speed gain)

1. Word limits with hover and `[INFO]`.
2. `side` out of the agent's schema.
3. Naming hints moved before writing; the tool's `[DONE]` line stays the last word.

### Phase 2: layout quality the agent no longer sees (reviewed, nothing to build)

Numbers from the engine on `dev/fixtures/usecase/*.json` (crossings, hits, line length, labels within 8 px, canvas):
collapsed 0 / 0 / 1012 / 0 / 923x336; levels-and-extension-points 0 / 0 / 2432 / 0 / 1270x604; no-subjects 0 / 0 / 1394 / 0 / 963x494; shop-acceptance 1 / 0 / 10281 / 0 / 1556x1530; small 0 / 0 / 1471 / 0 / 1174x581. `python3 dev/test_audit_usecase.py` passes.

1. **Supporting actors far from their use cases**: obsolete. "Payment gateway" now sits at y 1204 on the right, level with Back office (it serves Take payment at 745, Issue refund at 1299 and Reconcile at 1190; the median of the biggest group wins) and no line crosses a subject. Trying it at the height of each use case it reaches (slide in `ucArrange`, scored by `ucCost`) found no cheaper place: the score is already at its best, so no change. The one crossing left is Take payment to the gateway against Ship order to the carrier.
2. **Fan-in labels pile up**: obsolete. The three `«include»` lines into "Authenticate" (the fourth include goes to "Take payment") have labels 40 px apart (y 718, 760, 800), none within 8 px of another, and the lines already fan out and join only in the last 200 px.
3. **Space beside a narrow subject**: skipped. Office (515 wide) beside Storefront (1044 wide, 812 high) would make a canvas of about 2100x850, worse than 1556x1530 in aspect, and the shared actor columns would lengthen lines. No large gain.
4. **Line ends**: obsolete. `uc-mk-open` is already a filled notched head, 9 px long and 9 px wide in a 14 px box, as big as the flowchart `arrowhead` (12 px box); only the outline is thin, which is fine for a filled shape.

## Acceptance

- Benchmark (Phase 0, not run): 1 run, no edits, no PNG views, total time close to the JSON writing time.
- Fixtures: no `[WARN]` except real data errors; crossings, hits and line length the same or lower.
- `python3 dev/test_audit_usecase.py`, `python3 dev/check_themes.py`, `python3 dev/check_golden.py` (regenerated after inspection), `e2e_usecase` pass.
- Before and after PNGs of `shop-acceptance`, looked at by a person.

## Risks

- Saved diagrams re-tidy differently.
- Merged include lines hide which line comes from where near the target; keep them apart until close to it.
