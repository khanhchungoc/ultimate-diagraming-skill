# Plan: shorter flowcharts (compaction along the flow)

Status: completed (Phases 0, 1.1–1.3, 2 shipped; Phase 3 optional/not needed).

## Problem

Large flowcharts are much longer along the flow than their structure needs, and most of the canvas is empty. Measured on the current benchmark samples at commit `58dd7c4` (TB `COL_WIDTH` = 136 px, LR `COL_WIDTH` = 200 px), before vs after Phases 1.1–1.3 + Phase 2 (`python3 dev/bench/measure_compaction.py`):

| Sample | Steps | Lanes | Dir | Chain (DAG / forced) | Before (len / cross / score) | After (len / cross / score) | Layout (s) |
|---|---:|---:|:---:|---:|---|---|---:|
| Laptop purchase (`dev/samples/corporate-laptop-purchase-request.html`) | 55 | 7 | TB | 38 / 22 | 4571 px / 2 / 96 | 4553 px / 1 / 98 | 0.98 |
| Laptop purchase, alternative (`dev/samples/corporate-laptop-purchase-request-alternative.html`) | 46 | 7 | TB | 29 / 12 | 3619 px / 3 / 84 | 3545 px / 3 / 84 | 0.86 |
| Employee onboarding (`dev/tests/fixtures/flowchart/employee-onboarding.json`) | 57 | 10 | TB | 42 / 23 | 5054 px / 2 / 96 | 4832 px / 3 / 94 | 1.71 |
| Incident response (`dev/tests/fixtures/flowchart/incident-response.json`) | 37 | 7 | TB | 28 / 13 | 2566 px / 1 / 98 | 2532 px / 1 / 98 (no connector needed) | 0.43 |
| Order fulfillment (`dev/tests/fixtures/flowchart/order-fulfillment.json`) | 28 | 6 | LR | 21 / 10 | 2927 px / 2 / 96 (1 internal pen) | 3182 px / 2 / 96 (0 internal pen, 13 bends) | 0.32 |
| Motor claim (`dev/samples/motor-insurance-claim-processing.md`, Mermaid) | 50 | 7 | LR | 26 / 16 | 5139 px / 50 / 70 | 5139 px / 50 / 70 | 1.72 |

Phase 0 attribution showed that 64%–68% of total length on the large TB benchmarks is forced same-lane steps (not cross-lane hand-offs), and most remaining cross-lane hand-offs are constrained by loop/fork/join safety guards. Rather than force-shortening card spacing at the cost of crossings or audit quality, Phases 1.1–1.3 and Phase 2 optimize step placement cleanly (fewer crossings/bends, tighter TB cross-lane hand-offs, and short branches pulled closer to their merges).

Subprocess tabs (`children`, see `dev/plans/archive/plan-subprocess.md`) now provide a structural way to split huge processes across tabs, but flat large diagrams (`--flat`, `employee-onboarding.json`, existing pages) and individual child tabs all run through the same layout engine and benefit from cleaner placement.

## How the engine decides length today

`assets/types/flowchart/engine.js`, `runLayoutEngine`:

1. **Back edges** (DFS plus `feedback` flags, plus loop-closing arrows) are removed, leaving a DAG.
2. **Ranks**: longest-path layering (`ranksWithZero`). A step sits after the latest of its predecessors.
3. **Steps per arrow** (`stepOf`): a full column (`COL_WIDTH`), a tight step (`TIGHT_STEP`, edge to edge), or zero (the target sits beside its source in another lane, a straight hand-off across). A labelled arrow widens its step to fit the label (`labelGap`), and a connector that needs room widens the step next to its step (`room`).
4. **Compact-step search** (lines 679–810): every cross-lane forward arrow is a candidate for `zero` or `tight`. Up to 6 candidates the search is exhaustive; above 6 it is a greedy climb from two seeds (all normal, all tight).
5. **Score** (`score`, lines 549–672): `[overlaps + penetrations + overflows, crossings, columns, bends, length]`, compared in that order (`keyLess`). Length (columns) only breaks ties between layouts with the same crossings.
6. **Post-search unstacking guards** (lines 696–742, 811–832): on the winning layout only, `loopBlocked`, `exitBlocked`, and `forkBlocked` unstack `zero` candidates to `tight` (or normal), and `joinBlocked` unstacks/un-tightens `zero`/`tight` join branches to normal so parallel forks and joins keep clean corridors. Each guard is kept only when `res.key[0] <= best.key[0] && res.key[1] <= best.key[1]`.
7. **Placement and post-alignment** (`placeNodes`, lines 836–885): sub-rows inside lanes, non-sibling nodes slid into free row-0 slots within their slack (up to 1.5 columns), column alignment (snapping), lane heights, and a post-alignment end-node shift (lines 862–885) that moves end nodes right of intermediate-lane blockers.

The Python audit (`scripts/layout_engine.py`, `FlowchartAudit`) does not lay out; it routes and scores what the engine produced. The JS engine is the only layout.

## Where the slack probably comes from (to confirm in Phase 0)

1. **Few hand-offs become `zero` steps.** The greedy search and the score order (crossings before columns) both push away from compact layouts: one extra crossing outweighs any number of saved columns.
2. **Label widening.** In TB every labelled arrow (each decision branch) needs `8 + 17 * lines + 2 * LABEL_STUB` across its step (about 57 px for "Yes"), so its step is `max(136, 96 + 57)` = 153 px instead of 136. Small per arrow, but decisions are about a quarter of the steps.
3. **Merges of unequal branches.** Longest-path layering puts a merge step after its longest incoming branch. A short branch that rejoins late leaves its own steps early and then a long empty arrow; the steps after the merge are pushed by the long branch. This is correct for ranks but can be fine-tuned where a short exception path could start later.
4. **Placement nudges.** Row-0 slot moves, column snapping, and post-alignment end-node shifts (lines 862–885) can add distinct positions that do not belong to any column grid.
5. **Connector room.** Steps next to a connector that did not fit get widened (`room`), and connector pairs are added after layout, so a second layout can come out longer.

## Goals

- Shorter flowcharts along the flow: on the benchmark samples above, at least 20% less length, with no more defects, no connector crowding regressions (especially on `employee-onboarding.json`), and no more than one extra crossing per sample.
- No change in what an agent writes or in the `--layout` contract.
- One layout everywhere: the page's Auto-Tidy runs the same engine, so whatever ships changes both.

## Non-goals

- Hand-placed positions, phase lanes (they must keep their diagonal staircase, rule 7), sequence/ERD/use case/C4 layouts.
- A new layout algorithm (for example full network-simplex layering). Only if Phase 1 and 2 fall short.

## Phases

### Phase 0: measure (no behaviour change)

- Add `dev/bench/measure_compaction.py`: for every flowchart in `dev/tests/fixtures/flowchart/*.json` (which already includes `employee-onboarding.json`), the samples (`dev/samples/corporate-laptop-purchase-request.html`, `dev/samples/corporate-laptop-purchase-request-alternative.html`, and `dev/samples/motor-insurance-claim-processing.md` parsed via Mermaid or checked in under `dev/tests/fixtures/flowchart/large/`), and `dev/examples/example-flowchart*.json`, report: steps, lanes, direction, longest advancing chain, columns used, length in px, fill, crossings, defects, long arrows, and single-run layout time.
- Attribute the length of the longest path in px to its causes: full columns, tight steps, label widening, connector room, post-search unstacking guards, snapping, slot moves, and end-node blocker shifts. This tells which of the causes above matter.
- Record the complete baseline table in this plan.

### Phase 1: cheap wins (one PR each)

Order by what Phase 0 shows; expected candidates:

1. **Score: let columns buy a crossing.** Replace the strict order `crossings, columns` with a weighted term (for example `crossings * W + columns`, `W` around 3–4) so a layout that is several columns shorter can win with one more crossing. Defects stay first and absolute. **Guard compatibility:** keep raw `crossings` separate from the weighted search key so the post-search unstacking guards (`loopBlocked`, `exitBlocked`, `forkBlocked`, `joinBlocked` at lines 813–832) continue comparing raw defects and raw crossings rather than rejecting unstacking because columns grew.
2. **Search for large diagrams.** Above 6 candidates, add seeds (all `zero` where `valid`, and "zero for single-arrow hand-offs") and a bounded second pass that tries pairs of changes. **Deterministic cap, never a wall-clock timer:** bound the search by a fixed evaluation/pass limit (never elapsed time, which would violate determinism and flake `check_golden.py`). Target under ~1.0–1.5 s per single `run_layout` call on `laptop` and `employee-onboarding` (currently 0.67 s and 0.85 s; full `--layout` runs multiple layouts for lane ordering and direction choice), and keep browser Auto-Tidy responsive.
3. **Label room only where the label sits (conditional on Phase 0).** A label sits on one segment of its arrow; if the router places it on a segment across lanes (a hand-off), the step along the flow does not need widening. Check against `pickClearLabelPosition` in `assets/shell/ortho-router.js` (and `FlowchartAudit` in `scripts/layout_engine.py`) before changing `labelGap`, and only pursue if Phase 0 shows label widening is a meaningful share of length—skipping label room before routing risks label collisions when the across-lane leg is crowded.

### Phase 2: merges

- After ranks, for each short branch that rejoins a longer one, try moving its steps later (as late as their successors allow) when that shortens the long arrow into the merge without adding crossings. Coordinate with `placeNodes` row-0 slot sliding (lines 267–297) and verify `check_golden.py` flow-order neutrality. This changes rows, not length; it is here because it makes the shorter layout from Phase 1 read better and must not undo it.

### Phase 3 (optional): lane widths across the flow

- In TB every lane is at least `LANE_MIN` (240 px) wide. A lane whose steps are few could keep `LANE_MIN` but the empty ones are already as narrow as allowed; only revisit if Phase 0 shows lane width matters for the "fits the screen" direction choice.

## Acceptance

- `dev/bench/measure_compaction.py` shows the length goal met on the benchmark samples, no new defects anywhere, crossings within the budget, and no fork/join connector crowding regressions on `employee-onboarding.json`.
- `python3 dev/tests/unit/check_golden.py --update` diffs inspected: only shorter or equal lengths, no new crossings beyond the budget, flow-order and connector-twin checks green; then regenerated.
- `python3 dev/tests/unit/check_direction.py` still passes (shorter flows may flip the LR/TB choice; update expectations only where the new choice is the better one).
- `python3 dev/tests/unit/test_audit_flowchart.py`, `python3 dev/tests/unit/test_subprocess.py`, `python3 dev/tests/unit/check_themes.py`, and browser E2E (`node dev/tests/run_e2e.mjs --only e2e_lanes,e2e_connectors,e2e_shapes,e2e_shell,e2e_subprocess`) pass (see `dev/docs/architecture.md`).
- `python3 dev/tools/build_examples.py && python3 dev/tools/build_examples.py --check` passes after editing `assets/types/flowchart/engine.js`.
- PNGs of the benchmark samples before and after, looked at by a person: shorter, and no harder to follow.

## Risks

- **Every saved diagram re-lays out differently** (Auto-Tidy runs the same engine). Positions a user has not pinned will move on their next tidy. Acceptable for a layout improvement; mention it in the release notes.
- **Compact layouts can be denser and harder to read**: the crossing budget and the "looked at by a person" check are the guard.
- **Runtime & browser Auto-Tidy**: a wider search costs time in both Node `--layout` and the browser's Auto-Tidy; keep a deterministic evaluation cap and measure on `employee-onboarding.json` and `laptop`.
- **Connector interplay**: connector pairs are added after the first layout and the result is laid out again (`add_connector_pairs`, up to 4 rounds). A shorter first layout changes which arrows are long; re-check the connector counts on the samples and keep the `forkBlocked`/`joinBlocked` guards intact.

