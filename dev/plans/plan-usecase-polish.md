# Plan: use case diagrams, data only for the agent

Status: proposed. Not started.

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

### Phase 2: layout quality the agent no longer sees

Found on `shop-acceptance` (2 subjects, 7 actors, 26 use cases); none is reported, all are visible.

1. **Supporting actors far from their use cases**: "Payment gateway" sits bottom right and its lines cross the Back office. Place each supporting actor at the height of what it serves, in `ucArrange`, scored by `ucCost`.
2. **Fan-in labels pile up**: four `«include»` lines into "Authenticate" put three labels on top of each other. Merge them near the target with one label, as the flowchart router merges fan-in arrows.
3. **Space**: Storefront is wide with an empty right half. Only if Phase 0 shows a large gain, place a narrow subject beside a wide one.
4. **Line ends**: enlarge `uc-mk-open` (14 px, thin) as for the flowchart arrowheads.

## Acceptance

- Benchmark: 1 run, no edits, no PNG views, total time close to the JSON writing time.
- Fixtures: no `[WARN]` except real data errors; crossings, hits and line length the same or lower.
- `python3 dev/test_audit_usecase.py`, `python3 dev/check_themes.py`, `python3 dev/check_golden.py` (regenerated after inspection), `e2e_usecase` pass.
- Before and after PNGs of `shop-acceptance`, looked at by a person.

## Risks

- Saved diagrams re-tidy differently.
- Merged include lines hide which line comes from where near the target; keep them apart until close to it.
