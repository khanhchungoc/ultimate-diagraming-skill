# Plan: sequence diagrams, data only for the agent

Status: proposed. Not started.

## Why

The flowchart work (PRs #18 to #22) cut an agent's session on the motor sample from 109 s, 2 runs, 1 JSON edit and 2 PNG views to 54 s, 1 run and none of the rest. The agent writing the JSON takes about 35 to 45 s of that; everything else was the agent doing the layout's job and waiting on the tool. The rule that made the difference:

> The agent writes what the process is: who takes part, which messages in which order, what each says, the phases and conditions. The engine decides where everything goes and how it is drawn, and never asks the agent to change the data for a layout reason.

Sequence diagrams break this rule more than any other type: the agent is asked to make layout choices, read dense schema rules (`activate`/`until`, activation-bar mechanics, `elseAt`), and work around `[WARN]` outputs triggered by fixed box widths and example defaults.

## What slows the agent down today

From `references/types/sequence.md`, `references/examples/example-sequence.json`, and the tooling:

| Field, rule, or behaviour | Cost to the agent | Change |
|---|---|---|
| Participant order (rule 8: "order participants so most messages travel to a neighbour") | Reads all messages to solve column order | `scripts/layout_engine.py` orders participants (`"participantOrder": "fixed"` opt-out) |
| `numbered` (rule 9: above about 20 messages) | Counts messages | `scripts/layout_engine.py` sets `numbered: true` at 20+ messages when omitted |
| `lifespans`, `column` | Tracks active ranges and non-overlapping pairs; audit rejects overlaps/chains | Drop from agent schema; keep in engine/page for saved diagrams (auto-packing is optional layout polish) |
| `start` / `end` | Rarely needed lifespan overrides | Keep as data only when the source says so; omit from core rules |
| `place` (note position as a number like `1.5`) | Computes lifeline coordinates | Drop from agent schema; `over` with two participant ids already spans between them |
| `rails`, `collapsed` (rule 9, 11) | Decides folding and rail mode upfront | Drop from agent schema; `Focus` remains interactive in the page |
| `kind` ("Always write `kind`", rule 3 / schema) | Writes `"kind": "sync"` on every call because `sequence.js` only draws solid arrows on explicit `'sync'` | Treat missing `kind` as `sync` in `assets/types/sequence/sequence.js`; omit `kind` on `sync` calls |
| `color` / `colorKey` in `example-sequence.json` | Agents copy colours into simple diagrams and hit `color_warnings()` (`>= 3` ungrouped colours or missing `colorKey`) | Remove `color` and `colorKey` from `references/examples/example-sequence.json`; use only when source groups ownership |
| `activate`, `until`, activation-bar rules, `elseAt` | 17 lines of rare/redundant rules read on every invocation | Collapse `activate`/`until` and activation rules to 2 lines; document `branches` only (keep `elseAt` working in engine/audit) |
| Character limits (label `<= 35`, detail `<= 45`) and fixed box height (`34px` / `RAIL_W` `36px`) | Character counting; rail names and 3-line participant names lack `data-tip`, causing `[WARN]` in `shell.js` / `render_screenshot.py` | Word limits (participant 3–4 words, label 6, detail 8) with no `[WARN]`; add `data-tip` + ellipsis on `.seq-participant-name` (rails and boxes) so truncation is `[INFO]` |
| Two headless Chrome launches per `--layout --screenshot` | `render_screenshot.py` opens separate sessions for `collect_layout_report` and `take_screenshot` | Reuse one `chrome_session` for both |

## Phases

### Phase 0: measure the agent and runtime

- Benchmark like the flowchart one: 2 realistic prompts (a 6-participant checkout, a 40-message payment flow with phases), a fresh agent each, recording total time, JSON writing time, tool/Chrome runtime, `--layout` runs, JSON edits, PNG views, and which fields it authored. Run before and after each phase.
- Per fixture, record layout numbers: participants, messages, page size, Fit zoom, total message span (sum of `|index(from) - index(to)|`).

### Phase 1: the contract and runtime quick wins (biggest speed gain)

1. **Rail and participant box truncation**: in `assets/types/sequence/sequence.js` and `sequence.css`, add ellipsis clipping and `data-tip` on `.seq-participant-name` for both rails (`RAIL_W` 36 px) and standard boxes (`BOX_W` 148 px, `height` 34 px) so `shell.js` / `render_screenshot.py` report truncation as `[INFO]` instead of `[WARN]`. Keep the rail exception aligned with `dev/check_overflow.mjs` and `dev/check_themes.py`.
2. **Word limits and `sync` default**:
   - In `references/types/sequence.md`, replace character limits with soft word limits (participant 3–4 words, `label` at most 6 words, `detail` at most 8 words). Keep `engine.js` widening gaps to fit message labels unless Phase 0 shows wide diagrams need a cap—if a column cap (`LABEL_MAX_W`) is added later, wire it consistently across `engine.js`, `sequence.css`, `sequence.js` (`data-tip`), `scripts/audit_sequence.py` (`label_w` check), and `shell.js` (`publishRenderReport`).
   - In `assets/types/sequence/sequence.js`, treat `!m.kind || m.kind === 'sync'` as `sync` (matching `scripts/audit_sequence.py`), and stop requiring `"kind": "sync"` in `references/types/sequence.md`.
3. **Auto-`numbered` in the CLI**: in `scripts/layout_engine.py`, set `"numbered": true` when `numbered` is omitted and the diagram has 20 or more messages.
4. **Trim `references/types/sequence.md` and `references/examples/example-sequence.json`**:
   - Remove rule 8 (participant order), rule 11's sizing advice, `place`, `lifespans`, `column`, `rails`, `collapsed`, and `elseAt` from the agent schema (keep them working for saved diagrams and the page).
   - Simplify rule 9 to wrapping natural phases in `group` fragments.
   - Collapse `activate`/`until` and the activation-bar explanation to a 2-line note.
   - Remove `color` and `colorKey` from `references/examples/example-sequence.json` (like `example-flowchart.json`).
5. **Single Chrome session in `scripts/render_screenshot.py`**: reuse one `chrome_session` across `collect_layout_report` and `take_screenshot` instead of spawning Chrome twice on every `--layout --screenshot` run.

### Phase 2: engine/CLI layout automation

Run these in `scripts/layout_engine.py` before `run_layout()` (the same pattern as `order_flowchart_lanes`), rather than inside `assets/types/sequence/engine.js`, so editor drag-reordering (`participantDrag` calling `relayout()`) is never overridden and `dev/check_golden.py` (`golden/v1` exact coordinates and `lifespan_problems`) stays intact:

1. **Participant order (`order_sequence_participants`)**: start from authored order, compare a BFS order from the first sender (keeping `actor` and `ui` participants leftmost), then run adjacent swaps while total message span falls; keep the lower-span order. Opt-out via `"participantOrder": "fixed"`. Add `"participantOrder"` to `SEQUENCE_KEYS` in `scripts/disk_format.py`, `DISK_KEYS` in `assets/types/sequence/sequence.js`, and `references/reading.md`.
2. **Lifespans and shared columns (optional layout polish, separate from agent speed)**: when `lifespans` is omitted and packing non-overlapping active ranges (messages and notes) saves at least 2 columns, set `"lifespans": true` and assign `column` (ensuring each host still precedes its sharers in `participants` after Phase 2.1). An authored `lifespans` or `column` always wins.

### Phase 3: a readable first view

- A 42-message diagram currently opens at `0.25` Fit zoom with ~3.5 px text (`lifespans`, `colours`, `payment-phases`).
- When Fit zoom would render text below the 11 px minimum, open tall sequence diagrams at the top of the canvas at a readable zoom floor (raising the `0.25` floor in `assets/shell/shell.js` for initial load on tall diagrams) rather than auto-folding phases. `pinParticipants()` already keeps participant headers visible during vertical scrolling, `?capture` screenshots continue to show the full diagram, and `Focus` stays manual.

### Phase 4: visibility

- Enlarge arrowheads `seq-arrow-solid` and `seq-arrow-open` in `assets/types/sequence/stage.html` / `sequence.css` from 10 px to about 14 px, as for the flowchart.

## Acceptance

- Benchmark: 1 `--layout` run, no JSON edits, no PNG views, total time close to JSON writing time plus a single Chrome launch; the agent authors none of the removed fields and omits `kind` on `sync` calls.
- Fixtures: no `[WARN]` except real data errors; total message span the same or lower on every fixture; page no wider when auto-`lifespans` is enabled.
- `python3 dev/test_audit_sequence.py`, `python3 dev/check_themes.py`, `python3 dev/check_golden.py` (including `golden/v1`, `rail_problems`, `lifespan_problems`), `dev/check_artifact_shape.py`, `e2e_sequence`, `e2e_activations`, and `e2e_notes` pass.
- Before and after PNGs of `rails`, `lifespans`, and `six-participants`, inspected by a person.

## Risks

- Reordering participants can surprise a user who chose the order: `"participantOrder": "fixed"` covers it; mention it in the release notes.
- Saved diagrams without `"participantOrder": "fixed"` re-laid out via `--layout` may reorder participants; interactive Auto-Tidy in the browser preserves the existing participant order.
- Raising the initial zoom floor on tall diagrams means only the top portion is visible until the user scrolls or presses Fit; `pinParticipants()` keeps the participant row visible while scrolling.
