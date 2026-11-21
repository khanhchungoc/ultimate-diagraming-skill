# Plan: Speed and cost at scale (skill vs Mermaid benchmark)

Status: proposed. Measured on `main` at `35d75b5` (2026-11-17).

## Benchmark

Four large briefs (`dev/bench/briefs/`): a 10-actor onboarding flowchart (~60 steps), a 17-participant checkout sequence, a ~55-table clinic ERD, a 3-system library use case diagram (~45 use cases). Each brief went to two fresh Sonnet sub-agents: one followed `SKILL.md`, one wrote a Mermaid v11 HTML page "as for a claude.ai artifact". `dev/bench/measure.js` then loaded every output in Chromium (Mermaid served locally). A separate Sonnet judge scored blind full-page screenshots.

### Agent cost and time (per diagram)

| Type | Arm | Agent tokens | Tool calls | Agent time | Engine runs | Authored source | Last line |
|---|---|---|---|---|---|---|---|
| flowchart | skill | 88.4k | 7 | 74 s | 1 | 16.0 KB JSON | `[DONE]`, audit 94 |
| flowchart | mermaid | 67.6k | 4 | 28 s | – | 3.7 KB | not verified |
| sequence | skill | 83.9k | 7 | 79 s | 2 (1 `[WARN]`) | 9.9 KB JSON | `[DONE]` |
| sequence | mermaid | 69.7k | 5 | 48 s | – | 2.9 KB | verified |
| erd | skill | 86.7k | 7 | 78 s | 1 | 21.2 KB JSON | `[DONE]`, score 4/100 (8 lines through tables) |
| erd | mermaid | 70.1k | 3 | 47 s | – | 7.5 KB | verified |
| usecase | skill | 80.6k | 6 | 47 s | 1 | 10.2 KB JSON | `[DONE]`, score 0/100 (6 links through use cases) |
| usecase | mermaid | 67.7k | 4 | 31 s | – | 3.0 KB | not verified |
| **mean** | **skill** | **84.9k** | **6.8** | **70 s** | | **14.3 KB** | |
| **mean** | **mermaid** | **68.8k** | **4.0** | **38 s** | | **4.3 KB** | |

Every page rendered without errors. Skill pages: 380–590 KB (editor included), first render 0.4–1.1 s. Mermaid pages: 4–9 KB plus 3.5 MB of `mermaid.min.js` from a CDN, first render 0.7–1.4 s.

### Where the skill's extra time and cost go

1. **Authored output, 3.3× Mermaid (14.3 vs 4.3 KB).** Output tokens cost ~5× input tokens and set the agent's wall time (~2.5k extra tokens is ~30 s of the 32 s gap). JSON key names alone are 28–41% of the minified JSON (`"laneId":"lane-…"` on every node, `"type":"task"`, `"label":""`, `"id":"e12"`). A line format prototyped on the benchmark files: flowchart 16.0 → 8.0 KB, ERD 21.2 → 6.9 KB.
2. **Reading, ~20–30 KB before the first write.** `SKILL.md` (9.9 KB, about half of it on output choice, read, update, artifacts and brand), the type reference (8–16 KB), plus the flowchart example (4.6 KB). Mermaid agents read only the brief. Testers named "Output choice" as irrelevant reading every time.
3. **Re-runs on derivable data.** The sequence agent lost a run (~15 s and a JSON edit) to an `alt` whose `to` ended before its own branch. The tool could extend `to` itself.
4. **Engine time is small next to agent time** (~5%), but not free at scale: flowchart 4.2 s (Python audit run 4×, 4.4 s of a 6.7 s profile, re-routing edges in `_reroute_by_cost`), ERD 4.6 s (JS engine at 56 tables), use case 1.4 s (Python audit 1.7 s profiled, more than the engine), sequence 0.2 s.

### Quality (blind judge, readability / coverage / notation, out of 10)

| Type | Skill | Mermaid | Winner |
|---|---|---|---|
| flowchart | 3 / 6 / 8 | 2 / 5 / 5 | skill (real swimlanes, BPMN shapes) |
| sequence | 8 / 6 / 8 | 3 / 8 / 8 | skill on first view |
| erd | 6 / 8 / 8 | 2 / 9 / 5 | skill (colour domains, crow's foot) |
| usecase | 1 / 8 / 8 | 4 / 6 / 6 | mermaid (skill at 25% Fit is unreadable) |

The skill wins on notation, but large diagrams open at Fit (~25%) where nothing is readable, and the ERD and use case layouts degrade at this size (lines through boxes). The agent cannot fix either: both are the engine's job.

## Improvements, by impact on speed and cost

### P1. Compact authoring format (largest win: about half the output tokens)

- Accept a line format per type next to JSON (`--layout x.flow` / `.seq` / `.erd` / `.uc`, or detected by the absence of `{`). Python parses it into today's JSON, so engines, audits, `--extract` and saved pages are unchanged.
- Flowchart sketch: `lane hm flag Hiring Manager`; `hm decision headcount_ok: Headcount Approved?` (type omitted means task); `a -> b : Yes`, `a -> b -> c` chains, `!` marks feedback; `note a,b: text`. ERD: `table order #1`, indented `name type pk fk ? uk`, relationships as `order.customer_id >o-|| customer` (crow's-foot ASCII like Mermaid). Sequence and use case follow Mermaid's own syntax where it exists, so the model's prior helps.
- Defaults do the rest: ids from labels, edge ids, `fk`/`identifying` (done), lane colours, icons from lane names.
- Target: authored source ≤ 1.5× Mermaid (from 3.3×). `--extract` prints the same format, so reads and updates shrink too.

### P2. Lean reading path (input tokens, ~10–15 KB less per diagram)

- `SKILL.md`: keep only pick-type + create (+ one-line pointers). Move output choice, read, update, artifact and brand procedures to `references/` files loaded only when that task is asked. Target ≤ 4 KB.
- Type references: keep schema + writing rules. Drop the "Failure handling" sections: every `[WARN]` already names its fix, so put the fix in the message where it is not. Fold the flowchart example into the reference (as the other three types now do). Target ≤ 8 KB each.

### P3. No re-runs for derivable data (each saves ~15 s plus a write)

- Sequence: extend a fragment's `to` to cover its last `branches[].at`; open a bar's matching reply automatically (already).
- Flowchart: a lane without `icon` gets one from its name (keyword table already in `flowchart.md`); `[INFO]`, not `[WARN]`.
- Collapse many `[INFO] Layout:` lines into one summary line, and stop printing a 0–4/100 score next to `[DONE]` (both testers read it as failure). Fewer lines to read and copy into the final report.

### P4. Large diagrams must read at first view (quality, engine-side)

- Open at a readable zoom (for example ≥ 60%, at the start of the flow / most connected table) instead of Fit when Fit falls below the legibility floor; keep Fit one key away.
- ERD (56 tables: 8 lines through tables) and use case (45 use cases: 6 links through use cases): add the benchmark diagrams as golden fixtures (`dev/fixtures/*/bench-*.json`), then fix in the engines (`plan-erd-polish.md`, `plan-usecase-polish.md` own the algorithms).
- Sequence: lifespan packing shared columns between unrelated participants (`Inventory DB with Auth Service`); require a relation or a clear gain before packing.

### P5. Engine speed (secondary: ~5% of agent time)

- Flowchart: lane ordering and direction choice each run a full Python audit (`_reroute_by_cost`) per candidate. Score candidates with the JS engine's own crossing/length counts and run the Python audit once on the winner. Target < 1.5 s for 60 nodes (from 4.2 s).
- Use case: AABB prefilter in `_seg_seg` / `_pt_seg` (1.7 s → < 0.3 s).
- ERD: cap search effort above ~40 tables (`ER.LITE*`) by wall clock. Target < 2 s at 56 tables.

## Expected outcome

| Metric | Now (skill) | After P1–P3 | Mermaid |
|---|---|---|---|
| Authored source | 14.3 KB | ~6 KB | 4.3 KB |
| Read before writing | 20–30 KB | ≤ 12 KB | ~2 KB (brief) |
| Agent time, large diagram | ~70 s | ~40 s | ~38 s |
| Agent tokens | ~85k | ~73k | ~69k |
| Re-runs | 0–1 | 0 | – |

## Re-running the benchmark

Give each brief to a fresh sub-agent per arm (same prompt shape as above, outputs to one folder as `skill-<type>.html` / `mermaid-<type>.html`), then `NODE_PATH=<playwright node_modules> node dev/bench/measure.js <out-dir> <shots-dir> <mermaid.min.js>`. Record the sub-agent token counts, tool calls and duration from the task notifications.

## Re-run after Mermaid authoring (2026-11-18, `ccr-c18dbf2f-2xj17k`)

Run with fresh `inherit`-model subagents (this environment) and rendered at 1600×1000 in headless Chrome via `dev/cdp.mjs` (same checks and local `mermaid.min.js` route as `dev/bench/measure.js`; `playwright` is not installed).

| Type | Arm | Agent tokens (in / out) | Tool calls | Agent time | Engine runs | Authored source | Last line / Render |
|---|---|---|---|---|---|---|---|
| flowchart | skill | 40.7k (32.1k / 8.6k) | 7 | 57 s | 1 | 6,246 B `.mmd` | `[DONE]`, rendered (1,368 ms) |
| flowchart | mermaid | 26.2k (20.9k / 5.3k) | 4 | 43 s | – | 5,135 B | rendered (1,120 ms) |
| sequence | skill | 37.0k (29.4k / 7.7k) | 7 | 71 s | 1 | 5,421 B `.mmd` | `[DONE]`, rendered (859 ms) |
| sequence | mermaid | 27.2k (22.6k / 4.6k) | 5 | 35 s | – | 5,729 B | parse error (`rendered: false`) |
| erd | skill | 41.4k (32.9k / 8.5k) | 8 | 58 s | 2 | 8,019 B `.mmd` | `[DONE]`, score 0/100, rendered (1,321 ms) |
| erd | mermaid | 32.3k (24.2k / 8.2k) | 4 | 41 s | – | 9,465 B | rendered (1,659 ms) |
| usecase | skill | 35.2k (27.8k / 7.4k) | 7 | 51 s | 1 | 5,799 B `.mmd` | `[DONE]`, score 4/100, rendered (1,332 ms) |
| usecase | mermaid | 26.9k (21.3k / 5.6k) | 4 | 36 s | – | 4,984 B | rendered (1,222 ms) |
| **mean** | **skill** | **38.6k** | **7.3** | **59 s** | | **6.4 KB (6,371 B)** | |
| **mean** | **mermaid** | **28.2k** | **4.3** | **39 s** | | **6.3 KB (6,328 B)** | |

- **Authored source**: **1.01×** plain Mermaid (6,371 B vs 6,328 B, down from 3.3× / 14.3 KB JSON; meets the ≤ 1.5× target).
- **Agent time**: 59 s vs 39 s (down from 70 s; includes reading `SKILL.md` + type reference and running `layout_engine.py`, so it remains above the 10% gap target against the unverified Mermaid arm).

### Quality (blind judge, readability / coverage / notation, out of 10)

| Type | Skill | Mermaid | Winner |
|---|---|---|---|
| flowchart | 8 / 9 / 9 | 3 / 4 / 6 | skill (full 10-lane swimlane layout vs clipped 3-node fragment) |
| sequence | 8 / 7 / 9 | 0 / 0 / 0 | skill (clean UML sequence vs Mermaid syntax error) |
| erd | 8 / 9 / 9 | 4 / 3 / 8 | skill (full 49-table domain-colored overview vs 2-table clipped viewport) |
| usecase | 7 / 9 / 9 | 1 / 1 / 3 | skill (all 3 systems, actors and include/extend vs nearly blank clipped canvas) |
