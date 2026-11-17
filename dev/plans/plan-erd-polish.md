# Plan: ERD, the same treatment as the flowchart

Status: proposed. Not started.

The flowchart work (PRs #18 to #22) settled four ideas: the agent writes data only and the tool owns layout; label limits the agent can count (words), with the full text on hover instead of a `[WARN]`; long tangled lines get fixed by the tool, not by the agent; and line ends must be easy to see. This plan applies the same ideas to the ERD.

## Problem

Measured with `--layout --screenshot` on `dev/fixtures/erd/*.json` (12 fixtures):

| Finding | Where | Notes |
|---|---|---|
| A line runs through a table | `saas-billing` (30 tables, 39 relationships): `r8` passes through `app_user`; audit score 88 | Printed as `[INFO] Layout`, so the agent leaves it, but the reader still sees it. |
| Long lines across the whole canvas | `saas-billing`: `currency` to `customer`, `plan_feature` to `plan`, `organization` to `data_export` | Long dashed curves cross several others. Same shape of problem as the flowchart's long arrows. |
| Colour domains split up | `saas-billing`: the Audit tables (`webhook_delivery`, `audit_event`, `data_export`, `login_attempt`) sit in three places | `SAME_COLOR` (0.8) only pulls same-coloured tables slightly closer. |
| Character budgets | `references/types/erd.md`: table name 28 characters, column 28, type 16, label 20, note 120; over budget is a `[WARN]` | The flowchart showed that agents cannot count characters reliably; a `[WARN]` costs a full extra run. |
| Agent picks a layout setting | Rule 9: set `"detail": "keys"` above about 15 tables or 25 columns | This is a layout choice. The tool can make it from the counts. |

Every other fixture passes clean. Layout takes 0.4 to 1.8 s (saas-billing is the slowest), plus about 3 to 5 s for the screenshot.

## How the engine decides today

`assets/types/erd/engine.js`, `layoutDiagram`: stress majorization from 18 seeded variants, local search on the best few, overlap removal (`erSeparate`), then routing (`erRouteAll`, one cubic curve per relationship). `erUnhit` and `erRepair` try to move tables off lines that run through them; `canvas.hits` counts what is left. The Python audit (`scripts/audit_erd.py`) scores and reports. Previous plans: `dev/plans/archive/plan-erd-layout-v3.md`.

## Goals

- No line through a table on any fixture, and no `[INFO] Layout` on `saas-billing`.
- Fewer long crossing lines on large schemas, without making the diagram larger than its fit-zoom budget (`FIT_MIN` 0.62).
- Tables of one colour form one area where the foreign keys allow it.
- No over-budget `[WARN]` for text the page can truncate and show on hover; `detail` chosen by the tool.
- No change to what an agent writes beyond the rules that get simpler.

## Non-goals

- A new placement algorithm. Sequence, use case and flowchart layouts.

## Phases

### Phase 0: measure (no behaviour change)

- Add an ERD mode to a measuring script (or extend the flowchart one from `plan-flow-compaction.md`): per fixture, report tables, relationships, `hits`, crossings, total line length, the longest lines and what they cross, colour contiguity (number of separate areas per colour), canvas size and fit zoom.
- Add two or three larger real schemas (40 to 60 tables) under `dev/fixtures/erd/large/`; `saas-billing` is the only large one now.

### Phase 1: data contract, one PR

1. **Labels the agent can count.** Change the budgets in `references/types/erd.md` to words where they are prose (relationship `label`: 3 words; note: keep characters, it wraps) and keep names and types verbatim (they come from the schema and must not be reworded). Over budget, the page truncates with "..." and sets `data-tip` with the full text (as `flowchart.js` does), and the audit prints `[INFO]` instead of `[WARN]`.
2. **`detail` chosen by the tool.** When `detail` is missing, pick `"keys"` above 15 tables or when a table has more than 25 columns (rule 9's numbers); an authored `detail` still wins. Rule 9 becomes one line about the override.

### Phase 2: lines through tables and long lines

1. **Lines through tables.** Find why `erUnhit` leaves `r8` through `app_user` on `saas-billing` (too few iterations, or the move costs too much elsewhere). Fix it there first; only if that fails, add a routing fallback that bends the curve around the table.
2. **Long crossing lines.** Same rule as the flowchart connectors, adapted: a relationship that is long (more than about 3 table widths) and crosses 2 or more other lines, or crosses 1 and passes close to tables, is a candidate. Try in this order: move the smaller end table toward the other (a local move in `erRepair`), then, if still long, consider a "reference" marker (the column shows `→ currency` and the line is not drawn). Decide on the marker only after Phase 0 shows how many lines it would affect; it changes how the diagram reads.

### Phase 3: colour areas

- Raise the pull of same-coloured tables (`SAME_COLOR`) or add a cost for a colour split into several areas, and check it against crossings and size on every fixture. Accept only if crossings stay within +1 per fixture.

### Phase 4: line ends

- Check the crow's-foot ends at fit zoom on `saas-billing` (28 x 18 markers). If they read poorly at 62%, scale them up as was done for the flowchart arrowheads, and check the port spacing still fits.

## Acceptance

- The Phase 0 measurement shows: no hits on any fixture, no new crossings beyond +1 per fixture, canvas within the fit-zoom budget, colour areas no more split than before.
- `python3 dev/test_audit_erd.py`, `python3 dev/check_themes.py`, `python3 dev/check_golden.py` (goldens regenerated after the diffs are inspected) and the ERD browser suites pass.
- Before and after PNGs of `saas-billing` and the new large fixtures, looked at by a person.

## Risks

- Saved diagrams re-tidy differently (positions not pinned will move).
- Layout time: `saas-billing` already takes about 1.8 s; extra repair passes need a time budget.
- A "reference" marker instead of a line is a change in notation; keep it optional until a person has looked at it.
