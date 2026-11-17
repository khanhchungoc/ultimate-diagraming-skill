# Plan: Faster Layout Engine and Verification Pipeline

Status: proposed. Not started.

## Problem

On large flowcharts, `scripts/layout_engine.py --layout ... --screenshot ...` takes over a minute, which dominates end-to-end diagram generation time and frequently exceeds the agent's synchronous command wait window (triggering backgrounding and extra LLM turns).

Measured on the 7-lane, 89-node, 102-edge airline flight disruption flowchart (`flight-disruption-ultimate.html` authoring JSON):

- **Subagent end-to-end `--layout ... --screenshot ...` run (4 connector rounds, `task-10`)**: **67 s** (`14:32:49Z`–`14:33:56Z`), including `10 s` wait timeout + backgrounding turn overhead.
- **Local staged profile (`prof_layout.py`, 1 connector round, `node.EXE` on `PATH`)**: **29.31 s**:
  - `order_flowchart_lanes()`: **0.00 s** (short-circuited because lanes were already flow-ordered)
  - `choose_flowchart_direction()`: **12.60 s** (runs `run_layout` for `LR` and `TB`, then calls `FlowchartAudit.verify_collisions()` on both)
  - Initial `make_audit(laid_out_data).verify_collisions()` in `main()`: **6.48 s**
  - Connector-pair loop (`add_connector_pairs()` + `run_layout()` + `verify_collisions()`): **4.62 s per round** (`run_layout`: `1.60 s`, `verify_collisions`: `3.02 s`; 4 rounds in the subagent run scales this to ~18–20 s)
  - `scaffold_html()`: **0.06 s**
  - `run_render()` (`scripts/render_screenshot.py`): **5.54 s**
- **Single `cProfile` run of `FlowchartAudit.verify_collisions()` on the TB layout (89 nodes, 102 edges)**: **25.222 s** across **102,805,367 function calls**, of which **99.6% (`25.121 s`)** is spent inside `_route_all_edges` -> `_reroute_by_cost`:
  - `route_cost()` (`scripts/layout_engine.py:927`): `139,840` calls, `24.913 s`
  - `relate()` (`scripts/layout_engine.py:854`): `1,476,317` calls, `19.798 s` (`34.17M` `abs()`, `25.25M` `max()`, `25.25M` `min()`)
  - `poly_clear()` (`scripts/layout_engine.py:850`) and `segment_clear()` (`scripts/layout_engine.py:578`): `1.311 s` and `1.122 s`
  - `defects()` (`scripts/layout_engine.py:891`): `14,617` calls, `1.263 s`

In short, pure-Python edge rerouting inside `FlowchartAudit.verify_collisions()` accounts for ~70–75% of wall-clock runtime, repeated Node.js subprocess launches account for ~15–20%, and launching headless Chromium twice in `render_screenshot.py` accounts for the remaining ~10%.

## Root Causes

1. **Unfiltered $O(E^2 \cdot S^2)$ polyline comparisons in `_reroute_by_cost()` (`scripts/layout_engine.py:840-1046`)**:
   - When `deep` routing triggers (`base is None or base[1] >= C_CROSS`), `alt_routes()` sweeps `x` and `g` across the entire canvas bounds in `16 px` steps, generating hundreds to over a thousand 5-point candidate routes per edge.
   - `route_cost()` (`scripts/layout_engine.py:927`) checks `limit` only once up front against `(len(pts) - 2) * C_BEND + length`, then iterates through every other edge `o` in `others` (~100 edges) and calls `relate(pts, result[o["id"]], ...)` without:
     - an axis-aligned bounding-box (AABB) overlap check (padded by `18 px` for near-parallel detection) to skip non-adjacent edges,
     - an early-exit check inside `for o in others:` once accumulated cost reaches `limit`, or
     - precomputed segment bounds/orientations on `result[o["id"]]`.
   - `port_clashes()` (`scripts/layout_engine.py:904`) and `shared_branch_vertex()` (`scripts/layout_engine.py:915`) depend only on `(e, fp, tp)`, yet are recomputed for every `x`/`g` candidate in `alt_routes()`.
   - `segment_clear()` (`scripts/layout_engine.py:578`) and `defects()` (`scripts/layout_engine.py:891`) linearly scan all node rectangles (`rects.items()`) for every segment instead of filtering against pre-indexed node bounds.

2. **Redundant `verify_collisions()` invocations (`scripts/layout_engine.py:1445-1472, 1674-1683`)**:
   - `choose_flowchart_direction()` already computes `lr_report` and `tb_report` via `FlowchartAudit(...).verify_collisions()` (line 1465), then discards the chosen report so `main()` immediately calls `make_audit(laid_out_data, tokens).verify_collisions()` again on the exact same data (lines 1682–1683).
   - Furthermore, `choose_flowchart_direction()` computes `lr_report` and `tb_report` even when `tb_zoom < lr_zoom + TB_MIN_GAIN` makes `lr` win unconditionally (when `lr` is chosen regardless of `tb_quality_ok`, `tb_report` is unused; note `lr_report` is still unneeded unless `tb` beats `lr` by zoom).

3. **Repeated Node.js subprocess startup (`scripts/engine_runner.py:28-40`, `scripts/run_engine.mjs`)**:
   - Each call to `run_layout()` spawns a fresh `node` process (`~1.6 s` per call on Windows, ~6–7 times per flowchart run across `order_flowchart_lanes`, `choose_flowchart_direction`, and `add_connector_pairs` rounds).

4. **Two separate Chromium sessions in `scripts/render_screenshot.py:277-292`**:
   - `main()` calls `collect_layout_report()` (spawns headless Chrome via `chrome_session`) and then `take_screenshot()` (spawns a second headless Chrome via `chrome_session`), plus waits a fixed `0.5 s` before `Page.captureScreenshot`.

## Goals

- Cut `layout_engine.py --layout ... --screenshot ...` wall-clock time on the 89-node flight disruption flowchart from **~67 s** (and `29.3 s` in 1-round profile) to **under 10 s** (targeting **5–8 s** total, fitting comfortably inside a single synchronous tool call).
- Keep the exact same layout positions, audit scores, `[WARN]`/`[INFO]` diagnostics, connector pairs, and golden fixture outputs (bit-for-bit or score-identical).
- Keep `scripts/layout_engine.py`, `scripts/engine_runner.py`, and `scripts/render_screenshot.py` standard-library-only in Python (zero new third-party dependencies).

## Non-Goals

- Changing the JS layout algorithm in `assets/types/flowchart/engine.js` or altering audit penalty weights/thresholds.
- Changing CLI flags or breaking `FlowchartAudit.verify_collisions()` as a standalone API used by `--verify` and `dev/test_audit_flowchart.py`.
- Dropping visual verification (`--screenshot`) from the `SKILL.md` workflow.

## Phases

### Phase 0: Baseline Benchmark Harness (No Behavior Change)

- Add a lightweight timing script (for example `dev/bench_layout.py`) that measures wall-clock duration and per-stage breakdown (`order_flowchart_lanes`, `choose_flowchart_direction`, `verify_collisions`, connector-pair rounds, `run_layout`, `run_render`) on:
  - Large flowcharts in `dev/samples/` and representative fixtures in `dev/fixtures/flowchart/*.json` (such as `loan-application.json`, `five-lanes-wide.json`, `nested-loops.json`, `cross-lane-zigzag.json`).
  - The 89-node flight disruption fixture (or a checked-in stress fixture).
- Record baseline timings and golden checksums before making edits so every phase can verify zero output drift.

### Phase 1: Optimize `FlowchartAudit._reroute_by_cost` and Spatial Checks (`scripts/layout_engine.py`)

Target: reduce `verify_collisions()` on the 89-node flowchart from **~25 s** to **< 1 s** with identical routing and audit results.

1. **Precompute routed-edge geometry caches in `_reroute_by_cost()`**:
   - Store for each edge in `result` its bounding box `(min_x, max_x, min_y, max_y)` and pre-parsed segment tuples `(ax, ay, bx, by, is_v, is_h, min_x, max_x, min_y, max_y)` once when an edge enters or updates `result`.
   - Precompute candidate `pts` bounding box `(cmin_x, cmax_x, cmin_y, cmax_y)` and segment tuples once per `route_cost()` call (after the cheap `length` + `limit` check passes).
   - In `route_cost()`, skip `relate()` whenever `cmax_x + 18 <= omin_x or cmin_x - 18 >= omax_x or cmax_y + 18 <= omin_y or cmin_y - 18 >= omax_y` (since `relate()` only scores `gap < 18` or crossings strictly inside segment intervals).
2. **Early-exit `route_cost()` inside `for o in others:`**:
   - Compute `base_pen = (len(pts) - 2) * C_BEND + length + defect` before looping over `others`. If `base_pen >= limit`, return `None` immediately (before calling `relate()`).
   - Inside `for o in others:`, accumulate `defect` and return `None` immediately as soon as `base_pen >= limit` (taking care to preserve exact floating-point / integer behavior with `limit`, noting line 1040 adds `dev * 0.3 + side_penalty` only *after* `route_cost` returns, which matches the existing line 930 early check).
3. **Hoist `(fp, tp)`-only costs and endpoint sets**:
   - Compute `port_clashes(e, fp, tp) * C_PORT + shared_branch_vertex(e, fp) * C_SHARED_BRANCH` once per `(fp, tp)` pair (or cache in a 16-entry dict per edge `e`) instead of recomputing for every `x`/`g` sweep step in `alt_routes()`.
   - Hoist `e_from, e_to = e["from"], e["to"]` outside `for o in others:` so `incident` is `(o["from"] == e_from or o["from"] == e_to or o["to"] == e_from or o["to"] == e_to)` without allocating two sets per iteration.
4. **Fast node-rect bounds filtering in `segment_clear()` and `defects()`**:
   - Convert `rects` into a list of `(oid, ox, oy, ox2, oy2)` tuples once in `_route_all_edges()`.
   - Sort or bin by `ox` (or check a precomputed node tuple list without dict iteration and repeated `ox + ow` / `oy + oh` additions), and bail out early.
   - Only check `defects()` divider proximity if `dividers` is non-empty and the segment is horizontal (`abs(ay - by) < 1 and abs(ax - bx) > 30`).

Expected savings on the 89-node benchmark: **~35–45 s** in multi-round `--layout` runs (and **~20–24 s** on standalone `--verify`).

### Phase 2: Eliminate Duplicate Direction Audits (`scripts/layout_engine.py`)

Target: save **1–2 full `verify_collisions()` passes** per `--layout` run.

1. **Check zoom condition before running direction audits**:
   - In `choose_flowchart_direction()` (`scripts/layout_engine.py:1453-1472`), compute `tb_zoom` right after running `TB` layout. If `tb_zoom < lr_zoom + TB_MIN_GAIN`, `LR` wins unconditionally—skip both `FlowchartAudit(lr).verify_collisions()` and `FlowchartAudit(tb).verify_collisions()`, and return `(lr, None, "")`.
2. **Return and reuse the winning audit object/report**:
   - Update `choose_flowchart_direction()` (or add an internal helper used by `main()`) to return the already-computed `(audit, report)` when available so `main()` (`scripts/layout_engine.py:1682-1683`) reuses it instead of re-instantiating `FlowchartAudit` and re-running `verify_collisions()` on the identical `laid_out_data`.
   - Note: preserve `choose_flowchart_direction()`'s 2-tuple signature if external scripts in `dev/` (such as `dev/check_direction.py`) import and call it directly, or check callers first and keep a backward-compatible wrapper.

### Phase 3: Persistent / Batch Node.js Layout Worker (`scripts/engine_runner.py`, `scripts/run_engine.mjs`)

Target: cut Node.js process overhead from **~1.6 s x 6–7 calls (~10 s)** to **~1.6 s once + ~0.05–0.15 s per subsequent layout (~2 s total)**.

1. **Add a line-delimited JSON worker mode (`--server` or `--batch`) to `scripts/run_engine.mjs`**:
   - Read newline-delimited JSON requests (`{"kind": ..., "tokens": ..., "diagram": ..., "keep": ...}\n`) from `stdin`, cache compiled `new Function(...)` engines per `enginePath` in a `Map`, execute `layoutDiagram` / `routeDiagram`, and write one JSON line + `\n` to `stdout` (flushed per request).
   - Keep existing single-shot stdin mode untouched when `--server` is not passed so external callers remain 100% compatible.
2. **Manage a scoped worker session in `scripts/engine_runner.py`**:
   - Provide a context manager (for example `layout_session()`) or module-level managed worker with clean shutdown (`atexit` + `stdin.close()` + `wait(timeout=...)`) used by `layout_engine.py` during `--layout`.
   - Automatically fall back to one-shot `_via_node()` or `_via_browser()` if the worker exits unexpectedly or times out.
   - Avoid re-serializing the unchanged `tokens` payload on every call by optionally passing `tokens` once per session or only when `tokens` changes.

### Phase 4: Single-Session Chromium Capture (`scripts/render_screenshot.py`, `scripts/layout_engine.py`)

Target: cut `run_render()` from **~5.5 s** to **~2.5–3.5 s**.

1. **Reuse one `chrome_session` for report + screenshot in `scripts/render_screenshot.py`**:
   - Open one headless Chrome session in `main()` (`scripts/render_screenshot.py:274-292`): navigate to `?report&present&minpx=...` to collect the layout report and `axe-core` results, then resize/emulate metrics (`Emulation.setDeviceMetricsOverride`) and navigate the *same* browser target to `?capture&w=...` (or `?present`) for `Page.captureScreenshot`.
   - Eliminate the second Chrome process cold-start and profile directory setup/teardown.
2. **Replace fixed `time.sleep(0.5)` with `diagramReady` polling for all pages**:
   - Ensure standalone HTML pages set `dataset.diagramReady = '1'` when initial render settles (just as split artifacts already do), so `take_screenshot()` captures as soon as the DOM is ready rather than sleeping `0.5 s` unconditionally.
3. **Call `render_screenshot` in-process from `layout_engine.py` (optional)**:
   - Call a helper in `render_screenshot.py` directly from `run_render()` instead of spawning a nested `python` subprocess (~0.2 s saved).

## Acceptance Criteria

1. **Speed**: On the 89-node flight disruption flowchart, `python scripts/layout_engine.py --layout ... -o ... --screenshot ...` completes in **< 10 s** total (down from **67 s**), fitting within a single `10 s` synchronous `run_command` call without backgrounding.
2. **Parity / Zero Quality Regression**:
   - `python dev/check_golden.py` passes with zero unexpected diffs across all `flowchart`, `sequence`, `erd`, and `usecase` golden fixtures.
   - `python dev/test_audit_flowchart.py`, `python dev/check_direction.py`, `python dev/check_themes.py`, and `python dev/check_extract.py` all pass.
   - On the 89-node flight disruption flowchart, the output HTML embeds the exact same node coordinates, connector pairs (`A`–`D`), audit score (`70`), and `[INFO]` / `[PASS]` diagnostics as the pre-optimization baseline.
3. **Browser E2E Suites**: Existing Playwright/CDP suites listed in `dev/architecture.md` (`e2e_lanes.mjs`, `e2e_connectors.mjs`, `e2e_shapes.mjs`, `e2e_shell.mjs`) pass without regression.
