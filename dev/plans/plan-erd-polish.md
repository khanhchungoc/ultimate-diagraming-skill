# Plan: ERD, data only for the agent

Status: Phase 1 done (no character budgets for names, types and labels; `detail` picked by `--layout`; hover text works). Phase 0 benchmark and Phase 2 open.

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

These are already `[INFO]` only, so they do not slow the agent; they matter to the reader.

1. **Line through a table**: `saas-billing` (30 tables) has `r8` through `app_user` (audit score 88). With the automatic `detail: keys` (smaller tables) it gets worse: `r6` also passes through `membership` (score 76). Find why `erUnhit` leaves them; fix there first.
2. **Long crossing lines**: on `saas-billing`, `currency` to `customer` and `organization` to `data_export` cross the canvas. Same rule as flowchart connectors: a long line that crosses 2 or more others is a candidate for a local move of its smaller end table in `erRepair`.
3. **Colour areas**: the Audit tables sit in three places. Raise `SAME_COLOR` or add a cost for a split colour; accept only with crossings within +1 per fixture.
4. **Line ends**: check the crow's feet (28 x 18) at 62% fit zoom; enlarge if they read poorly.

## Acceptance

- Benchmark: 1 run, no edits, no PNG views, total time close to the JSON writing time.
- Fixtures: no `[WARN]` except real data errors; no hits; crossings within +1 per fixture.
- `python3 dev/test_audit_erd.py`, `python3 dev/check_themes.py`, `python3 dev/check_golden.py` (regenerated after inspection), `e2e_erd`, `e2e_erd_copy` pass.
- Before and after PNGs of `saas-billing`, looked at by a person.

## Risks

- Saved diagrams re-tidy differently.
- `saas-billing` layout already takes about 1.8 s; extra repair needs a time budget.
