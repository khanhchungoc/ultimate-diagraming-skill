# Plan: ERD, data only for the agent

Status: Phase 1 done (PR #25: no character budgets for names, types and labels; `detail` picked by `--layout`; hover text works). Phase 0 (agent benchmark) is not run here: it needs fresh agents and is out of scope for the layout pass. Phase 2: item 1 partly done, items 2 and 3 tried or open, item 4 partly obsolete (see below).

## Why

The flowchart work (PRs #18 to #22) cut an agent's session on the motor sample from 109 s, 2 runs, 1 JSON edit and 2 PNG views to 54 s, 1 run and none of the rest; writing the JSON is about 35 to 45 s of it. The rule:

> The agent writes what the schema is: tables, columns, keys, relationships, notes, domains. The engine decides where everything goes and how it is drawn, and never asks the agent to change the data for a layout reason.

The ERD already follows most of this: the tool output separates data errors (`[WARN]`) from layout findings (`[INFO] Layout`), and the engine places every table. What is left is below.

## What still costs the agent time

From `references/types/erd.md` and the fixtures:

| Item | Cost | Change |
|---|---|---|
| Character budgets: table name 28, column 28, type 16, relationship label 20; over budget is a `[WARN]` | The agent counts characters and, when it misses, edits and runs again (the flowchart's extra run on the laptop sample was exactly this) | Names and types come from the schema and are never reworded: truncate with "..." and hover, `[INFO]`. Relationship `label`: at most 3 words. |
| Rule 9: set `"detail": "keys"` above about 15 tables or 25 columns | The agent counts tables and columns | Engine picks it when `detail` is missing. |
| Rule 11: shorten a type over 16 characters and move the full text into a note | An extra note per long type | Truncate with hover instead; drop the rule. |
| `showTypes`, `showNotes`, `collapsed` | Already "never author unless asked" | Keep. |
| Colour by domain (rule 8, Colour section) | The agent groups tables into domains | Keep: domains are meaning, not layout. |

## Phases

### Phase 0: measure the agent

- Benchmark like the flowchart one: 2 prompts (a 12-table shop schema from prose, a 35-table SQL DDL), a fresh agent each; record total time, JSON writing time, `--layout` runs, JSON edits, PNG views and fields authored. Run before and after each phase.
- Layout numbers per fixture: hits (lines through tables), crossings, total line length, canvas size, fit zoom, and how many separate areas each colour forms.

### Phase 1: the contract (one PR, the speed gain)

1. Truncation with hover and `[INFO]` for every name, column, type and label; the reference keeps soft limits but no `[WARN]`.
2. `detail` chosen by the engine when missing (rule 9's thresholds); rule 9 becomes "leave `detail` out".
3. Drop rule 11's "shorten the type and add a note".

### Phase 2: layout quality the agent no longer sees

These are already `[INFO]` only, so they do not slow the agent; they matter to the reader. Numbers from `dev/erd_layout_metrics.py` on main (996404c): `saas-billing` 2691x1381, fit 62%, 2 crossings, 1 hit, about 1.5 to 2 s; every other fixture 0 hits, 0 crossings.

1. **Line through a table**: still real. `saas-billing` (30 tables, `detail: all`) has `r8` (`api_key` to `organization`) through `app_user` (score 88). Opened at `detail: keys` (what `--layout` picks when `detail` is left out) it had `r6` through `membership` as well (score 76). Cause: `erUnhit` stalls: after its 30 passes the six lite candidates (above `ER.LITE` tables) still have 8 to 14 hits each, because `erSeparate` pushes a moved table back; the lite repair (one refined candidate) then keeps 1 to 2. Done: `erClearHits`, a last pass on the winner (larger steps, a swap, no box cap, at most +1 crossing); `keys` went from 2 hits to 1. Open: the last hit on `saas-billing` needs two tables to move together; single moves and swaps do not clear it. Making `erUnhit` try the next-cheapest shift, a bigger refine count or a longer lite schedule were tried and gave other hits or 2.7 s and more.
2. **Long crossing lines**: the 2 crossings are at the audit's "good enough" line (at most 2 above 16 tables), so there is no hit-type cost to pay. Not done: no local-move rule for the smaller end table was tried; the remaining time budget is small.
3. **Colour areas**: lowering `SAME_COLOR` (0.7, 0.6, 0.5) does not help: the layout reshuffles, areas do not fall steadily (`saas-billing` 8 areas at 0.8, 10 to 11 below), lines get longer and hits or crossings rise (0.7: 3 crossings, 0.5: 4 hits). Not done; a split-colour cost would need the same crossing check per fixture.
4. **Line ends**: partly obsolete. Below 50% zoom the markers grow by 1 / scale (overview, `erd.js`). Between 50% and the 62% fit zoom they stay 28 x 18; not changed (not an engine change).

## Acceptance

- Benchmark: 1 run, no edits, no PNG views, total time close to the JSON writing time.
- Fixtures: no `[WARN]` except real data errors; no hits; crossings within +1 per fixture.
- `python3 dev/test_audit_erd.py`, `python3 dev/check_themes.py`, `python3 dev/check_golden.py` (regenerated after inspection), `e2e_erd`, `e2e_erd_copy` pass.
- Before and after PNGs of `saas-billing`, looked at by a person.

## Risks

- Saved diagrams re-tidy differently.
- `saas-billing` layout takes about 1.5 to 2 s; extra repair needs a time budget.
