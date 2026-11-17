# Plan: shorter flowcharts (compaction along the flow)

Status: proposed. Not started.

## Problem

Large flowcharts are much longer along the flow than their structure needs, and most of the canvas is empty. Measured on the three benchmark samples, all laid out top to bottom (TB, auto-picked) by `--layout` at commit `6da2671`:

| Sample | Steps | Lanes | Longest chain of steps | Length along the flow | Columns used (length / `COL_WIDTH` 136) | Lane-by-column cells filled |
|---|---|---|---|---|---|---|
| Laptop purchase (`laptop-v3`) | 54 | 7 | 16 | 3820 px | ~28 | 29% |
| Motor claim | 39 | 7 | 11 | 2795 px | ~20 | 28% |
| Laptop purchase, alternative | 46 | 7 | 19 | 3845 px | ~28 | 24% |

"Longest chain" counts steps on the longest path of arrows that advance along the flow. Since every advancing arrow needs at least one column, it is roughly the lower bound on the number of columns. The gap between it and the columns used (12 of 28 on the laptop sample, about 40%) is the slack this plan goes after. The empty space across the lanes (the low fill) mostly follows from the process itself (an actor with nothing to do at that point) and is not a target, except where an unused lane could be narrower (Phase 3).

The numbers above come from a quick script over the written page's data block (`x` positions of non-connector steps). Phase 0 replaces it with a proper measurement.

## How the engine decides length today

`assets/types/flowchart/engine.js`, `runLayoutEngine`:

1. **Back edges** (DFS plus `feedback` flags, plus loop-closing arrows) are removed, leaving a DAG.
2. **Ranks**: longest-path layering (`ranksWithZero`). A step sits after the latest of its predecessors.
3. **Steps per arrow** (`stepOf`): a full column (`COL_WIDTH`), a tight step (`TIGHT_STEP`, edge to edge), or zero (the target sits beside its source in another lane, a straight hand-off across). A labelled arrow widens its step to fit the label (`labelGap`), and a connector that needs room widens the step next to its step (`room`).
4. **Compact-step search** (around line 657): every cross-lane forward arrow is a candidate for `zero` or `tight`. Up to 6 candidates the search is exhaustive; above 6 it is a greedy climb from two seeds (all normal, all tight).
5. **Score** (`score`, line 650): `[overlaps + penetrations + overflows, crossings, columns, bends, length]`, compared in that order (`keyLess`). Length (columns) only breaks ties between layouts with the same crossings.
6. **Placement** (`placeNodes`): sub-rows inside lanes, end nodes moved into free slots within their slack, column alignment (snapping), lane heights.

The Python audit (`scripts/layout_engine.py`, `FlowchartAudit`) does not lay out; it routes and scores what the engine produced. The engine's header comment says it is a port of the Python layout and points at `scripts/check_tidy_parity.py`; that script no longer exists, so the JS engine is the only layout.

## Where the slack probably comes from (to confirm in Phase 0)

1. **Few hand-offs become `zero` steps.** The laptop sample has about 23 cross-lane arrows that advance, but only 8 hand-offs share a row. The greedy search and the score order (crossings before columns) both push away from compact layouts: one extra crossing outweighs any number of saved columns.
2. **Label widening.** In TB every labelled arrow (each decision branch) needs `8 + 17 * lines + 2 * LABEL_STUB` across its step (about 57 px for "Yes"), so its step is `max(136, 96 + 57)` = 153 px instead of 136. Small per arrow, but decisions are about a quarter of the steps.
3. **Merges of unequal branches.** Longest-path layering puts a merge step after its longest incoming branch. A short branch that rejoins late leaves its own steps early and then a long empty arrow; the steps after the merge are pushed by the long branch. This is correct for ranks but can be fine-tuned where a short exception path could start later.
4. **Placement nudges.** End nodes moved into free slots and column snapping can add distinct positions that do not belong to any column grid.
5. **Connector room.** Steps next to a connector that did not fit get widened (`room`), and connector pairs are added after layout, so a second layout can come out longer.

## Goals

- Shorter flowcharts along the flow: on the three samples above, at least 20% less length, with no more defects and no more than one extra crossing per sample.
- No change in what an agent writes or in the `--layout` contract.
- One layout everywhere: the page's Auto-Tidy runs the same engine, so whatever ships changes both.

## Non-goals

- Hand-placed positions, phase lanes (they must keep their diagonal staircase, rule 7), sequence/ERD/use case layouts.
- A new layout algorithm (for example full network-simplex layering). Only if Phase 1 and 2 fall short.

## Phases

### Phase 0: measure (no behaviour change)

- Add `dev/measure_compaction.py`: for every flowchart in `dev/fixtures/flowchart/*.json`, the three samples (`laptop-v3`, `motor`, `corporate-laptop-purchase-request-alternative`; check them in under `dev/fixtures/flowchart/large/`), and `references/examples/example-flowchart*.json`, report: steps, lanes, direction, longest advancing chain, columns used, length in px, fill, crossings, defects.
- Attribute the length of the longest path in px to its causes: full columns, tight steps, label widening, connector room, snapping and slot moves. This tells which of the five causes above matter.
- Record the baseline table in this plan.

### Phase 1: cheap wins (one PR each)

Order by what Phase 0 shows; expected candidates:

1. **Score: let columns buy a crossing.** Replace the strict order `crossings, columns` with a weighted term (for example `crossings * W + columns`, `W` around 3–4) so a layout that is several columns shorter can win with one more crossing. Defects stay first and absolute.
2. **Search for large diagrams.** Above 6 candidates, add seeds (all `zero` where `valid`, and "zero for single-arrow hand-offs") and a second pass that tries pairs of changes, within a time budget (the whole `--layout` must stay under ~2 s with Node on the laptop sample; it is about 1 s now).
3. **Label room only where the label sits.** A label sits on one segment of its arrow; if the router places it on a segment across lanes (a hand-off), the step along the flow does not need widening. Check against the router (`flowchart.js`) before changing `labelGap`.

### Phase 2: merges

- After ranks, for each short branch that rejoins a longer one, try moving its steps later (as late as their successors allow) when that shortens the long arrow into the merge without adding crossings. This changes rows, not length; it is here because it makes the shorter layout from Phase 1 read better and must not undo it.

### Phase 3 (optional): lane widths across the flow

- In TB every lane is at least `LANE_MIN` (240 px) wide. A lane whose steps are few could keep `LANE_MIN` but the empty ones are already as narrow as allowed; only revisit if Phase 0 shows lane width matters for the "fits the screen" direction choice.

## Acceptance

- `dev/measure_compaction.py` shows the length goal met on the three samples, no new defects anywhere, crossings within the budget.
- `python3 dev/check_golden.py --update` diffs inspected: only shorter or equal lengths, no new crossings beyond the budget; then regenerated.
- `python3 dev/check_direction.py` still passes (shorter flows may flip the LR/TB choice; update expectations only where the new choice is the better one).
- `python3 dev/test_audit_flowchart.py`, `python3 dev/check_themes.py`, and the browser suites `e2e_lanes`, `e2e_connectors`, `e2e_shapes`, `e2e_shell` pass (`dev/architecture.md` lists how to run them).
- PNGs of the three samples before and after, looked at by a person: shorter, and no harder to follow.

## Risks

- **Every saved diagram re-lays out differently** (Auto-Tidy runs the same engine). Positions a user has not pinned will move on their next tidy. Acceptable for a layout improvement; mention it in the release notes.
- **Compact layouts can be denser and harder to read**: the crossing budget and the "looked at by a person" check are the guard.
- **Runtime**: a wider search costs time; keep a budget and measure on the largest fixture.
- **Connector interplay**: connector pairs are added after the first layout and the result is laid out again (`add_connector_pairs`, up to 4 rounds). A shorter first layout changes which arrows are long; re-check the connector counts on the samples.
