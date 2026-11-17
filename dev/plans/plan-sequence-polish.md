# Plan: sequence diagrams, data only for the agent

Status: proposed. Not started.

## Why

The flowchart work (PRs #18 to #22) cut an agent's session on the motor sample from 109 s, 2 runs, 1 JSON edit and 2 PNG views to 54 s, 1 run and none of the rest. The agent writing the JSON takes about 35 to 45 s of that; everything else was the agent doing the layout's job. The rule that made the difference:

> The agent writes what the process is: who takes part, which messages in which order, what each says, the phases and conditions. The engine decides where everything goes and how it is drawn, and never asks the agent to change the data for a layout reason.

Sequence diagrams break this rule more than any other type: the agent is asked to make about seven layout choices.

## What the agent decides today that is layout

From `references/types/sequence.md`:

| Field or rule | What the agent must work out | Who should decide |
|---|---|---|
| Participant order (rule 8: "order participants so most messages travel to a neighbour") | The order that keeps messages short, by reading all messages | Engine: order search, with `"participantOrder": "fixed"` as opt-out |
| `numbered` (rule 9: above about 20 messages) | Count messages | Engine: on at 20 or more, unless set |
| `lifespans` ("more than about 6 participants where some take part in one phase only") | Which participants are active in which phase | Engine: on when it makes the diagram narrower by a set amount |
| `column` (reuse an earlier participant's column; the audit refuses overlaps and chains) | Every participant's active range, and which never overlap | Engine: pack non-overlapping lifespans into shared columns |
| `start` / `end` (widen a lifeline) | When a queue "exists" before it is used | Keep as data only when the source says so; never needed for layout |
| `place` (a note between lifelines, as a number like `1.5`) | Lifeline positions | Engine: a note `over` two participants already sits between them; drop `place` from the agent's schema |
| `rails`, `collapsed` (rule 9, 11) | Whether the page should open folded | Engine and page: the first view (see Phase 3); never authored |
| `activate`, `until` | Activation bar edge cases | Keep: rare and about meaning (async work that runs on) |
| Label limits (rule 2: label at most 35 characters, detail at most 45) | Count characters | Words, with "..." and the full text on hover |

And one output that makes the agent edit data for a layout reason:

- A rail is 36 px wide (`RAIL_W`), so `rails` truncates every participant name ("Polic...", "Servi...") and `assets/shell/shell.js:691` prints `[WARN] Node label truncated ... shorten to fit 2 lines`. On `dev/fixtures/sequence/rails.json` that is four `[WARN]` lines, so the agent renames participants and runs again for nothing.

## Phases

### Phase 0: measure the agent, not just the diagram

- Benchmark like the flowchart one: 2 realistic prompts (a 6-participant checkout, a 40-message payment flow with phases), a fresh agent each, recording total time, JSON writing time, `--layout` runs, JSON edits, PNG views and which fields it authored. Run it before and after each phase.
- Per fixture, record the layout numbers too: participants, messages, page size, Fit zoom, total message span (sum of `|index(from) - index(to)|`).

### Phase 1: the contract (one PR, biggest speed gain)

1. **Rail names**: rotated, truncated with "...", full text in `data-tip`, reported as `[INFO]`. The general rule from the flowchart: a label the page cuts and shows on hover is never a `[WARN]`.
2. **Word limits**: label at most 6 words, detail at most 8. Over the room available, truncate with hover, `[INFO]`.
3. **`numbered` by the engine** when missing: on at 20 messages or more.
4. **Remove from the agent's instructions**: rule 8 (participant order), rule 11's sizing advice, `place`, `lifespans`, `column`, `rails`, `collapsed`. Keep the fields working for saved diagrams and the page; the reference lists them under "set by the page, do not author".

### Phase 2: the engine takes over the removed choices

1. **Participant order**: the authored order, a BFS order from the first sender (as flowchart lanes), then adjacent swaps while the total message span falls; actors and UIs stay leftmost. Opt-out `"participantOrder": "fixed"`.
2. **Lifespans and shared columns**: compute each participant's active range from its messages and notes; turn `lifespans` on and pack non-overlapping participants into shared columns when that saves at least 2 columns. An authored `lifespans` or `column` still wins.

### Phase 3: a readable first view

- A 42-message diagram opens at 25% Fit zoom with 3.5 px text (`lifespans`, `colours`, `payment-phases`). When the first view would be below the 11 px minimum and the diagram has `group` phases, the page opens with the later phases folded and rails on (what the Focus button does); without phases, it opens at the top at a readable zoom. No saved data changes.

### Phase 4: visibility

- Arrowheads `seq-arrow-solid` and `seq-arrow-open` from 10 px to about 14 px, as for the flowchart.

## Acceptance

- Benchmark: 1 `--layout` run, no JSON edits, no PNG views, total time close to the JSON writing time; the agent authors none of the removed fields.
- Fixtures: no `[WARN]` except real data errors; total message span the same or lower on every fixture; page no wider with lifespans on.
- `python3 dev/test_audit_sequence.py`, `python3 dev/check_themes.py`, `python3 dev/check_golden.py` (goldens regenerated after inspection), `e2e_sequence`, `e2e_activations`, `e2e_notes` pass.
- Before and after PNGs of `rails`, `lifespans`, `six-participants`, looked at by a person.

## Risks

- Reordering participants can surprise a user who chose the order: the opt-out covers it; mention it in the release notes.
- Saved diagrams re-tidy differently.
- Opening folded hides content at first; unfolding must be obvious.
