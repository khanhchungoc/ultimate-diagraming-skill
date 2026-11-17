# Plan: use case diagrams, the same treatment as the flowchart

Status: proposed. Not started.

The flowchart work (PRs #18 to #22) settled four ideas: the agent writes data only and the tool owns layout; label limits the agent can count (words), with the full text on hover instead of a `[WARN]`; the tool fixes long tangled lines; and line ends must be easy to see. This plan applies them to use case diagrams.

## Problem

Measured with `--layout --screenshot` on `dev/fixtures/usecase/*.json` (5 fixtures). All pass clean, so the problems are what a reader sees, not what the audit reports. Most come from `shop-acceptance` (2 subjects, 7 actors, 26 use cases, 30 links):

| Finding | Notes |
|---|---|
| Long lines from supporting actors | "Payment gateway" sits at the far right, below both subjects; its lines to "Take payment" (in Storefront) and to "Reconcile payments" and "Refund payment" (in Back office) run across most of the page and cross the Back office use cases. |
| Fan-in labels pile up | Four `«include»` lines into "Authenticate" each carry a label; three labels sit almost on top of each other near the target. The flowchart router merges such fan-ins into one trunk. |
| Uneven use of space | Storefront is wide with a large empty right half; Back office is half as wide; the page is 2334 x 2366 px, taller than wide. |
| Small arrowheads | `uc-mk-open` (include and extend) is 14 x 14 and thin; the dashed line makes it harder to spot. |
| Character budgets | Actor name 24 characters, use case name 40, condition 40, note 120; over budget is a `[WARN]`. |

Layout takes about 0.5 s; the screenshot about 3.5 s.

## How the engine decides today

`assets/types/usecase/engine.js`, `layoutDiagram`: actors split into sides (`ucSides`: primary left, supporting right), use cases ranked by include/extend (`ucRanks`) into columns inside each subject (`ucColumns`), rows ordered by sweeps that pull use cases toward their actors (`ucArrange`, `ucReorder`), subjects stacked (`ucSubjects`), then each line routed straight or as one curve (`ucLines`, offsets in `CURVE_OFFS`, cost `W_CROSS` 100, `W_HIT` 250, `W_LEN` 0.01). Previous plan: `dev/plans/archive/plan-usecase.md`.

## Goals

- Supporting actors placed next to what they serve, so their lines stay short.
- Fan-in `«include»` lines into one target read as one bundle with one label.
- No `[WARN]` for text the page truncates with hover.
- No change to what the agent writes beyond simpler limits.

## Non-goals

- Changing which side an actor is on (primary left, supporting right is the notation).
- A new placement algorithm.

## Phases

### Phase 0: measure (no behaviour change)

- Per fixture: actors, use cases, links, crossings, `hits`, total line length, the longest lines and what they cross, labels whose boxes overlap or sit within 8 px of each other, canvas size and aspect.
- Add one or two larger fixtures (3 subjects, 10 actors, 40 use cases) under `dev/fixtures/usecase/large/`.

### Phase 1: data contract, one PR

- Change the budgets in `references/types/usecase.md` to words: actor name 3 words, use case name 5 words (verb + object), condition 6 words; note stays in characters (it wraps). Over budget, truncate with "..." and set `data-tip` (as `flowchart.js` does), and print `[INFO]`.

### Phase 2: supporting actors

- Place each supporting actor at the height of the use cases it links to (weighted by subject), instead of stacking supporting actors in one column. When it serves two subjects, put it between them on the right side and route both lines around the boundary corners rather than through the other subject.
- Try this inside `ucArrange` (the actor order sweep), and score it with the existing `ucCost`.

### Phase 3: fan-in bundles

- Two or more `«include»` (or `«extend»`) lines into the same use case: route them to one shared point near the target and draw one label there, as the flowchart router does for fan-in arrows (step 5a1 in `flowchart.js`). Keep one label per line when the lines carry different `condition`s.

### Phase 4: space and line ends

- Let a subject's width follow its contents and place a narrow subject beside a wide one when that brings the aspect closer to the screen (as the ERD's aspect target, `ASPECT_T`). Only if Phase 0 shows the gain is worth it.
- Enlarge `uc-mk-open` and thicken its stroke, as for the flowchart arrowheads.

## Acceptance

- Phase 0 numbers: on `shop-acceptance` and the new large fixtures, total line length and crossings lower, no new hits, no overlapping labels.
- `python3 dev/test_audit_usecase.py`, `python3 dev/check_themes.py`, `python3 dev/check_golden.py` (goldens regenerated after inspection) and the use case browser suites pass.
- Before and after PNGs, looked at by a person.

## Risks

- Saved diagrams re-tidy differently (positions not pinned will move).
- Bundled include lines hide which line comes from which use case near the target; keep the lines separate until close to it.
