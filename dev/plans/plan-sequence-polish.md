# Plan: sequence diagrams, the same treatment as the flowchart

Status: proposed. Not started.

The flowchart work (PRs #18 to #22) settled four ideas: the agent writes data only and the tool owns layout; label limits the agent can count (words), with the full text on hover instead of a `[WARN]`; the tool fixes layout problems instead of asking the agent; and line ends must be easy to see. This plan applies them to sequence diagrams.

## Problem

Measured with `--layout --screenshot` on `dev/fixtures/sequence/*.json` (14 fixtures):

| Finding | Where | Notes |
|---|---|---|
| Rail labels cut off, printed as `[WARN]` | `rails` (8 participants, 42 messages): "Policy Svc", "Service Bus", "Background Job", "Policy DB" cut to "Polic...", "Servi..." with "shorten to fit 2 lines" | A rail is 36 px wide (`RAIL_W`); no real name fits. The tool chose the rail, so this is a layout finding, and the `[WARN]` makes the agent rename participants for nothing. |
| Very long diagrams, tiny text at Fit | `lifespans`, `colours`, `payment-phases` (42 messages): page 2400 x 4700 to 5900 px, Fit zoom 25%, text at 3.5 px | Reported as `[INFO]`, correct, but the first view is unreadable. `activations` reaches 61%. |
| Agent picks layout settings | Rule 9: set `numbered` and wrap phases in `group` above about 20 messages; `rails`; rule 8: order participants so messages go to neighbours; rule 11: aim for 6 participants and 16 messages for an overview | `numbered`, `rails` and participant order are layout. `group` is data (the phases of the process) and stays with the agent. |
| Small arrowheads | `stage.html`: `seq-arrow-solid` and `seq-arrow-open` are 10 x 10 | The flowchart heads were enlarged to about 14 px for the same reason. |
| Character budgets | Rule 2: label at most 35 characters, detail at most 45 | Agents cannot count characters reliably. |

Layout takes about 0.15 s; the screenshot about 3.5 s.

## How the engine decides today

`assets/types/sequence/engine.js`, `layoutDiagram`: participants left to right in the authored order, spaced to fit the widest label between neighbours (`MIN_GAP` 200, `LABEL_PAD`); messages top to bottom, one `ROW` (60) each, `SELF_ROW` (96) for self-messages, plus `DETAIL_ROW` for a detail line; fragments add `FRAG_TOP` and `FRAG_STEP_BOTTOM`; collapsed frames take one `SUMMARY_ROW`; with `rails`, a participant with nothing visible is a rail. The audit (`scripts/audit_sequence.py`) mirrors the geometry.

## Goals

- No `[WARN]` for text the tool chose to shorten (rails, truncation with hover).
- A long diagram opens readable: text at least 11 px at the first view, without the agent setting anything.
- Participant order chosen by the tool to keep messages short, with an opt-out (as `"laneOrder": "fixed"` for flowchart lanes).
- Clearer arrowheads.

## Non-goals

- Changing time order: messages stay in the authored order.
- Deciding phases (`group`): that is the process's structure and stays in the data.

## Phases

### Phase 0: measure (no behaviour change)

- Per fixture: participants, messages, page height, Fit zoom, total message length in participant gaps (sum of `|index(from) - index(to)|`), messages that skip over 2 or more lifelines, truncated labels.

### Phase 1: data contract, one PR

1. **Rails.** Draw the rail name rotated with "..." and the full text in `data-tip`; report it as `[INFO]` (as for flowchart labels with hover). No rename advice.
2. **Labels the agent can count.** Rule 2 becomes "label at most 6 words, detail at most 8 words"; over the page width, truncate with hover and report `[INFO]`.
3. **`numbered` by the tool.** When `numbered` is missing, turn it on at 20 messages or more. An authored value wins.

### Phase 2: participant order

- Order participants to minimise total message length (the sum above), keeping the first sender first and actors (`kind` actor or UI) on the left. A small search: the authored order, a BFS order from the first sender (as flowchart lanes), then adjacent swaps while the sum falls. Opt-out: `"participantOrder": "fixed"`.
- Check fragments and notes that span participants still cover what they did (they are defined by message ids and participant ids, so they should).

### Phase 3: readable first view

- When the page would open below the 11 px text minimum and the diagram has `group` phases, open with the later phases folded (the Focus or collapse already in the page), rather than changing the saved data. Without phases, open at the top at a readable zoom instead of Fit. Decide between these with a person looking at the three long fixtures; the agent writes nothing extra either way.
- Tighten row height where nothing needs it: a message with no detail, no number and no fragment edge nearby could use a smaller `ROW`. Measure the gain in Phase 0 first; skip if under 10%.

### Phase 4: arrowheads

- Enlarge `seq-arrow-solid` and `seq-arrow-open` to about 14 px, check self-messages and short hops between neighbours still show their line.

## Acceptance

- No `[WARN]` on any fixture except real data problems; `rails` passes clean with `[INFO]` lines.
- Phase 0 numbers: total message length the same or lower on every fixture with the order search, and no fixture worse.
- `python3 dev/test_audit_sequence.py` (or the existing audit tests), `python3 dev/check_themes.py`, `python3 dev/check_golden.py` (goldens regenerated after inspection) and the sequence browser suites pass.
- Before and after PNGs of `rails`, `lifespans` and `six-participants`, looked at by a person.

## Risks

- Reordering participants changes how a diagram reads (a user may want the authored order): the opt-out covers it; mention it in the release notes.
- Opening a diagram folded can hide content a reviewer expects to see at once; it must be obvious how to unfold.
