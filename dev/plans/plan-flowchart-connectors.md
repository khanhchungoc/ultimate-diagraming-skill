# Plan: Improve flowchart parallel fork/join routing and connector placement

Status: proposed. Diagnosed on the Benchmark 2 onboarding flowchart (`skill-flowchart.html`, authored from `onboarding.mmd`) on `main` at `aa1236d`.

## Findings from `skill-flowchart.html`

Inspecting the laid-out positions and polylines around `clear_candidate` (`Clear Candidate for Onboarding`) and `send_welcome` (`Send Welcome Email`) shows three root causes behind the clustered `B`, `C`, `D`, and `A` connectors:

1. **Fork `zero`-step desynchronization (`assets/types/flowchart/engine.js`):**
   On the 4-way parallel fork from `clear_candidate` (`lane_hr_ops`) to `create_account` (`lane_it`), `assign_desk` (`lane_facilities`), `setup_payroll` (`lane_payroll`), and `issue_briefing` (`lane_security`), the compact-step search gives `clear_candidate -> create_account` a `zero` step (`x = 2810`, sharing the source column) while the other three tracks sit at `x = 2946`. Because `create_account` is in an intermediate lane (`lane_it`) and sends `create_account -> laptop_in_stock` across `x = 2906..2946`, the three fork arrows to lower lanes are blocked from entering cleanly, wrap backwards at `x = 2784`, and trigger three connector rounds (`B`, `C`, `D`) anchored on `clear_candidate`. That causes `B`, `C`, and `D` to crowd `clear_candidate` while `create_account` keeps a full wire that grazes `D`.

2. **Join `tight`-step channel starvation and unshared fan-in/fan-out trunks (`assets/types/flowchart/engine.js`, `scripts/layout_engine.py`, `assets/types/flowchart/flowchart.js`):**
   On the 4-way join into `send_welcome`, `enrol_mdm -> send_welcome` takes a `tight` step (`96 px`, edge-to-edge), leaving `0 px` of vertical corridor between `enrol_mdm` (`lane_it`) and `send_welcome` (`lane_hr_ops`) for `order_card`, `setup_payroll`, and `issue_briefing` to turn into `send_welcome`. Additionally, `relate_segs` in `scripts/layout_engine.py` and `relate` in `assets/types/flowchart/flowchart.js` only exempt the final port stub (`i == last_i and j == last_j`) under `skip_last`, charging `C_OVERLAP = 20000` when multiple fan-in arrows share their penultimate vertical trunk (`i == last_i - 1 and j == last_j - 1`), even though browser step `5a4` snaps parallel fan-in trunks together.

3. **Backwards connector lettering (`scripts/layout_engine.py`):**
   `add_connector_pairs` assigns letters `A, B, C, ...` in severity order `(-crossings, -cols)` rather than reading order along the flow, placing `B`, `C`, and `D` at `y = 2914` (and `D, C, B` left-to-right across lanes) above `A` at `y = 3531`.

## Improvement plan

### C1. Keep parallel fork/join intermediate tracks unstacked (`assets/types/flowchart/engine.js`)

In the post-search unstacking block of `runLayoutEngine` (alongside `loopBlocked` and `exitBlocked`), add two checks:

1. `forkBlocked(c)`: when `bestCfg.get(c.k) === 'zero'`, `u = nodeMap[c.from]`, `v = nodeMap[c.to]`, `u.type !== 'decision'`, `v` has at least one forward outgoing edge, and `u` has another forward edge `u -> w` whose lane lies beyond `v` on the same side (`c.side === 'down' ? laneIdx[w.laneId] > lv && lv > lu : laneIdx[w.laneId] < lv && lv < lu`), unstack `c` to `'tight'` or `null` when it preserves clean overlaps and crossings.
2. `joinBlocked(c)`: when `bestCfg.get(c.k)` is `'zero'` or `'tight'`, `u = nodeMap[c.from]`, `v = nodeMap[c.to]`, and `v` has another incoming forward edge `w -> v` from a lane beyond `u` on the same side (`c.side === 'down' ? laneIdx[w.laneId] > lu && lu > lv : laneIdx[w.laneId] < lu && lu < lv`), un-tighten `c` to `null` (full column gap) when `res.key[0] <= best.key[0] && res.key[1] <= best.key[1]`.

### C2. Allow shared fan-in and unlabelled fan-out trunks in the router (`scripts/layout_engine.py`, `assets/types/flowchart/flowchart.js`)

Update `relate_segs` / `route_cost` in `scripts/layout_engine.py` and `relate` / `routeCost` in `assets/types/flowchart/flowchart.js`:

1. When `skip_last` (`skipLast`) is true (`o.to == e.to` and same `toPort`), also exempt collinear overlap on the penultimate trunk segment (`last_i >= 2 and last_j >= 2 and i == last_i - 1 and j == last_j - 1`).
2. When `skip_first` (`skipFirst`) is true (`o.from == e.from` and same `fromPort`) and neither edge carries a label, also exempt collinear overlap on the shared fan-out trunk segment (`last_i >= 2 and last_j >= 2 and i == 1 and j == 1`).

### C3. Reading-order connector lettering, tests, and Benchmark 2 fixture (`scripts/layout_engine.py`, `dev/test_audit_flowchart.py`, `dev/fixtures/flowchart/`)

1. In `add_connector_pairs` (`scripts/layout_engine.py`), select up to `max_letters` `(target, eids)` groups by severity first, then sort the selected groups in reading order by `(min(source_x), target_x, target_lane_index)` before assigning letters `A, B, C, ...`.
2. Add unit tests in `dev/test_audit_flowchart.py` covering shared fan-in trunk routing and reading-order connector lettering.
3. Add `dev/fixtures/flowchart/employee-onboarding.json` and `dev/fixtures/flowchart/golden/employee-onboarding.json` from the Benchmark 2 onboarding flowchart, rebuild `dev/samples/example-*.html`, and verify all flowchart fixtures and E2E suites pass.

## Acceptance criteria

1. `dev/test_audit_flowchart.py`, `dev/check_golden.py`, `dev/check_themes.py`, `dev/check_mermaid.mjs`, `dev/check_extract.py`, `dev/build_examples.py --check`, `dev/e2e_connectors.mjs`, and `dev/e2e_mermaid.mjs` all pass.
2. On the Benchmark 2 onboarding flowchart (`employee-onboarding`), the 4-way parallel fork/join no longer spawns clustered connector pairs `B`/`C`/`D` on `Clear Candidate for Onboarding`, `audit` passes with `long_arrows_count == 0` and score `>= 95/100`, and any remaining connectors are lettered in reading order.
