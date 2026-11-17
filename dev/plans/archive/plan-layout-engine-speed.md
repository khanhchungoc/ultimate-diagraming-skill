# Plan: Faster Layout Engine and Verification Pipeline

Status: implemented (Phases 0–4 landed in `3f45821` and `2db9b73`; measured `13.594 s` CLI / `12.556 s` staged on the unsplit 88-node flight disruption flowchart vs `42.68–67 s` baseline, missing the `< 10 s` target by ~`3.6 s` when `order_flowchart_lanes` runs).

## Problem

On large flowcharts, `scripts/layout_engine.py --layout ... --screenshot ...` still takes tens of seconds to over a minute, which dominates end-to-end diagram generation time and frequently exceeds the agent's synchronous command wait window (triggering backgrounding and extra LLM turns).

Measured on the 7-lane, 89-node, 102-edge airline flight disruption flowchart (`flight-disruption-ultimate.html` authoring JSON):

- **Pre-`3f45821` subagent `--layout ... --screenshot ...` run (4 connector rounds, `task-10`)**: **67 s** (`14:32:49Z`–`14:33:56Z`), including `10 s` wait timeout + backgrounding turn overhead.
- **Post-`21ae7bc` local staged profile (`prof_layout.py`, 1 connector round, `node.EXE` on `PATH`)**: **42.68 s**:
  - `order_flowchart_lanes()`: **0.00 s** (short-circuited because lanes were already flow-ordered)
  - `choose_flowchart_direction()`: **19.76 s** (runs `run_layout` for `LR` and `TB`, then calls `FlowchartAudit.verify_collisions()` on both)
  - Initial `make_audit(laid_out_data).verify_collisions()` in `main()`: **9.76 s** (duplicate audit of the chosen direction)
  - Connector-pair loop (`add_connector_pairs()` + `run_layout()` + `verify_collisions()`): **6.43 s in round 1** (`run_layout`: `2.40 s`, `verify_collisions`: `4.03 s`; 4 rounds in a full run scales this significantly)
  - `scaffold_html()`: **0.04 s**
  - `run_render()` (`scripts/render_screenshot.py`, already single-session Chrome as of `3f45821`): **6.68 s**
- **Single `cProfile` run of `FlowchartAudit.verify_collisions()` on the TB layout (89 nodes, 102 edges)**: **25.222 s** across **102,805,367 function calls**, of which **99.6% (`25.121 s`)** is spent inside `_route_all_edges` -> `_reroute_by_cost`:
  - `route_cost()` (`scripts/layout_engine.py:927`): `139,840` calls, `24.913 s`
  - `relate()` (`scripts/layout_engine.py:854`): `1,476,317` calls, `19.798 s` (`34.17M` `abs()`, `25.25M` `max()`, `25.25M` `min()`)
  - `poly_clear()` (`scripts/layout_engine.py:850`) and `segment_clear()` (`scripts/layout_engine.py:578`): `1.311 s` and `1.122 s`
  - `defects()` (`scripts/layout_engine.py:891`): `14,617` calls, `1.263 s`

In short, pure-Python edge rerouting inside `FlowchartAudit.verify_collisions()` accounts for ~70–75% of wall-clock runtime, repeated Node.js subprocess launches account for ~15%, and headless Chromium rendering + report collection accounts for the remaining ~10–15%.

## Root Causes

1. **Unfiltered $O(E^2 \cdot S^2)$ polyline comparisons in `_reroute_by_cost()` (`scripts/layout_engine.py:840-1046`)**:
   - When `deep` routing triggers (`base is None or base[1] >= C_CROSS`), `alt_routes()` (`scripts/layout_engine.py:956`) sweeps `x` and `g` across the entire canvas bounds in `16 px` steps, generating hundreds to over a thousand 5-point candidate routes per edge.
   - `route_cost()` (`scripts/layout_engine.py:927`) checks `limit` only once up front against `(len(pts) - 2) * C_BEND + length`, then iterates through every other edge `o` in `others` (~100 edges) and calls `relate(pts, result[o["id"]], ...)` without:
     - an axis-aligned bounding-box (AABB) overlap check (padded by `18 px` for near-parallel detection) to skip non-adjacent edges,
     - an early-exit check inside `for o in others:` once accumulated cost reaches `limit`, or
     - precomputed segment bounds/orientations on `result[o["id"]]`.
   - `port_clashes()` (`scripts/layout_engine.py:904`) and `shared_branch_vertex()` (`scripts/layout_engine.py:915`) depend only on `(e, fp, tp)`, yet are recomputed for every `x`/`g` candidate in `alt_routes()`.
   - `segment_clear()` (`scripts/layout_engine.py:578`) and `defects()` (`scripts/layout_engine.py:891`) linearly scan all node rectangles (`rects.items()`) for every segment instead of filtering against pre-indexed node bounds.

2. **Redundant `verify_collisions()` invocations (`scripts/layout_engine.py:1445-1472, 1791-1800`)**:
   - `choose_flowchart_direction()` (`scripts/layout_engine.py:1465`) already computes `lr_report` and `tb_report` via `FlowchartAudit(...).verify_collisions()`, then discards the chosen report so `main()` immediately calls `make_audit(laid_out_data, tokens).verify_collisions()` again on the exact same data (`scripts/layout_engine.py:1799-1800`).
   - Furthermore, `choose_flowchart_direction()` computes `lr_report` and `tb_report` even when `tb_zoom < lr_zoom + TB_MIN_GAIN` makes `lr` win unconditionally.

3. **Repeated Node.js subprocess startup (`scripts/engine_runner.py:28-40`, `scripts/run_engine.mjs`)**:
   - Each call to `run_layout()` spawns a fresh `node` process (`~1.6–2.4 s` per call on Windows, ~6–7 times per flowchart run across `order_flowchart_lanes`, `choose_flowchart_direction`, and `add_connector_pairs` rounds).

4. **Remaining render wait and subprocess wrapper (`scripts/render_screenshot.py:231-244, 319`, `scripts/layout_engine.py:1871`)**:
   - Commit `3f45821` already consolidated `collect_layout_report` and `take_screenshot` into a single `chrome_session` in `scripts/render_screenshot.py:315-321`.
   - However, `_take_screenshot()` (`scripts/render_screenshot.py:231-243`) still only checks `dataset.diagramReady === '1'` when `wait_ready=is_split`, sleeping a fixed `0.5 s` for standalone HTML pages even though `assets/shell/shell.js:498` now sets `dataset.diagramReady = '1'` for all pages.
   - `run_render()` (`scripts/layout_engine.py:1871`) also spawns `render_screenshot.py` in a separate Python subprocess instead of calling it in-process.

## Goals

- Cut `layout_engine.py --layout ... --screenshot ...` wall-clock time on the 89-node flight disruption flowchart from **~43–67 s** to **under 10 s** (targeting **5–8 s** total, fitting comfortably inside a single synchronous tool call).
- Keep the exact same layout positions, audit scores, `[WARN]`/`[INFO]` diagnostics, connector pairs, and golden fixture outputs (bit-for-bit or score-identical).
- Keep `scripts/layout_engine.py`, `scripts/engine_runner.py`, and `scripts/render_screenshot.py` standard-library-only in Python (zero new third-party dependencies).

## Non-Goals

- Changing the JS layout algorithm in `assets/types/flowchart/engine.js` or altering audit penalty weights/thresholds.
- Changing CLI flags or breaking `FlowchartAudit.verify_collisions()` as a standalone API used by `--verify` and `dev/test_audit_flowchart.py`.
- Dropping visual verification (`--screenshot`) or `axe-core` accessibility checks from `render_screenshot.py`.

## Phases

### Phase 0: Baseline Benchmark Harness (No Behavior Change)

- Add a lightweight timing script (for example `dev/bench_layout.py`) that measures wall-clock duration and per-stage breakdown (`order_flowchart_lanes`, `choose_flowchart_direction`, `verify_collisions`, connector-pair rounds, `run_layout`, `run_render`) on:
  - Large flowcharts in `dev/samples/` and representative fixtures in `dev/fixtures/flowchart/*.json` (such as `loan-application.json`, `five-lanes-wide.json`, `nested-loops.json`, `cross-lane-zigzag.json`).
  - The 89-node flight disruption fixture (or a checked-in stress fixture).
- Record baseline timings and golden checksums before making edits so every phase can verify zero output drift.

### Phase 1: Optimize `FlowchartAudit._reroute_by_cost` and Spatial Checks (`scripts/layout_engine.py`)

Target: reduce `verify_collisions()` on the 89-node flowchart from **~10–25 s** to **< 1 s** with identical routing and audit results.

1. **Precompute routed-edge geometry caches in `_reroute_by_cost()`**:
   - Store for each edge in `result` its bounding box `(min_x, max_x, min_y, max_y)` and pre-parsed segment tuples `(ax, ay, bx, by, is_v, is_h, min_x, max_x, min_y, max_y)` once when an edge enters or updates `result`.
   - Precompute candidate `pts` bounding box `(cmin_x, cmax_x, cmin_y, cmax_y)` and segment tuples once per `route_cost()` call (after the cheap `length` + `limit` check passes).
   - In `route_cost()`, skip `relate()` whenever `cmax_x + 18 <= omin_x or cmin_x - 18 >= omax_x or cmax_y + 18 <= omin_y or cmin_y - 18 >= omax_y` (since `relate()` only scores `gap < 18` or crossings strictly inside segment intervals).
2. **Early-exit `route_cost()` inside `for o in others:`**:
   - Compute `base_pen = (len(pts) - 2) * C_BEND + length + defect` before looping over `others`. If `base_pen >= limit`, return `None` immediately (before calling `relate()`).
   - Inside `for o in others:`, accumulate `defect` and return `None` immediately as soon as `base_pen >= limit` (preserving the exact semantics of line 1040, which adds `dev * 0.3 + side_penalty` only after `route_cost` returns).
3. **Hoist `(fp, tp)`-only costs and endpoint sets**:
   - Compute `port_clashes(e, fp, tp) * C_PORT + shared_branch_vertex(e, fp) * C_SHARED_BRANCH` once per `(fp, tp)` pair (or cache in a 16-entry dict per edge `e`) instead of recomputing for every `x`/`g` sweep step in `alt_routes()`.
   - Hoist `e_from, e_to = e["from"], e["to"]` outside `for o in others:` so `incident` is `(o["from"] == e_from or o["from"] == e_to or o["to"] == e_from or o["to"] == e_to)` without allocating two sets per iteration.
4. **Fast node-rect bounds filtering in `segment_clear()` and `defects()`**:
   - Convert `rects` into a list of `(oid, ox, oy, ox2, oy2)` tuples once in `_route_all_edges()`.
   - Sort or bin by `ox` (or scan the precomputed tuple list without dict iteration and repeated `ox + ow` / `oy + oh` additions) and bail out early.
   - Only check `defects()` divider proximity if `dividers` is non-empty and the segment is horizontal (`abs(ay - by) < 1 and abs(ax - bx) > 30`).

Expected savings on the 89-node benchmark: **~25–40 s** in multi-round `--layout` runs (and **~10–24 s** on standalone `--verify`).

### Phase 2: Eliminate Duplicate Direction Audits (`scripts/layout_engine.py`)

Target: save **1–2 full `verify_collisions()` passes** per `--layout` run.

1. **Check zoom condition before running direction audits**:
   - In `choose_flowchart_direction()` (`scripts/layout_engine.py:1453-1472`), compute `tb_zoom` right after running `TB` layout. If `tb_zoom < lr_zoom + TB_MIN_GAIN`, `LR` wins unconditionally—skip both `FlowchartAudit(lr).verify_collisions()` and `FlowchartAudit(tb).verify_collisions()`, and return `(lr, None, "")`.
2. **Return and reuse the winning audit object/report**:
   - Add an internal helper (or optional parameter) used by `main()` (`scripts/layout_engine.py:1792`) so the already-computed `(audit, report)` is reused at `scripts/layout_engine.py:1799-1800` instead of re-instantiating `FlowchartAudit` and re-running `verify_collisions()` on the identical `laid_out_data`.
   - Keep `choose_flowchart_direction()`'s 2-tuple return signature intact so external callers such as `dev/check_direction.py` are unaffected.

### Phase 3: Persistent / Batch Node.js Layout Worker (`scripts/engine_runner.py`, `scripts/run_engine.mjs`)

Target: cut Node.js process overhead from **~1.6–2.4 s x 6–7 calls (~10–14 s)** to **~1.6 s once + ~0.05–0.15 s per subsequent layout (~2 s total)**.

1. **Add a line-delimited JSON worker mode (`--server`) to `scripts/run_engine.mjs`**:
   - Read newline-delimited JSON requests (`{"engine": ..., "tokens": ..., "diagram": ..., "keep": ...}\n`) from `stdin`, cache compiled `new Function(...)` engines per `enginePath` in a `Map`, execute `layoutDiagram` / `routeDiagram`, and write one JSON line + `\n` to `stdout`.
   - Keep existing single-shot stdin mode untouched when `--server` is not passed so external callers remain 100% compatible.
2. **Manage a scoped worker session in `scripts/engine_runner.py`**:
   - Provide a context manager (for example `layout_session()`) used by `layout_engine.py` during `--layout`, with clean shutdown (`stdin.close()` + `wait(timeout=...)`) and automatic fallback to one-shot `_via_node()` or `_via_browser()` if the worker exits unexpectedly or times out.
   - Cache `tokens` in the worker per session (passing it once or only when changed) to avoid re-serializing the token table on every request.

### Phase 4: Remaining Render and Capture Polish (`scripts/render_screenshot.py`, `scripts/layout_engine.py`, `assets/shell/shell.js`)

Status: single-session Chromium (`_collect_layout_report` + `_take_screenshot` in one `chrome_session`) is **already implemented** in commit `3f45821` (`scripts/render_screenshot.py:315-321`). Remaining smaller wins (~0.5–1.0 s):

1. **Wait on render readiness instead of fixed `0.5 s` sleep (`scripts/render_screenshot.py:231-243, 319`, `assets/shell/shell.js:498-510`)**:
   - `assets/shell/shell.js:498` sets `dataset.diagramReady = '1'` before the `requestAnimationFrame` + `document.fonts.ready` re-render pass (`L500-510`).
   - Add a `dataset.diagramSettled = '1'` marker (or reuse `diagramReady` only after `fontsIn` completes) in `shell.js` and poll it in `_take_screenshot()` for all pages instead of unconditionally sleeping `0.5 s`.
2. **Call `render_screenshot` in-process from `run_render()` (`scripts/layout_engine.py:1871`)**:
   - Invoke a helper in `render_screenshot.py` directly instead of spawning a nested `python` subprocess (~0.2 s saved).

## Acceptance Criteria

1. **Speed**: On the 89-node flight disruption flowchart, `python scripts/layout_engine.py --layout ... -o ... --screenshot ...` completes in **< 10 s** total (down from **43–67 s**), fitting within a single `10 s` synchronous command call without backgrounding.
2. **Parity / Zero Quality Regression**:
   - `python dev/check_golden.py` passes with zero unexpected diffs across all `flowchart`, `sequence`, `erd`, and `usecase` golden fixtures.
   - `python dev/test_audit_flowchart.py`, `python dev/test_audit_sequence.py`, `python dev/check_direction.py`, `python dev/check_themes.py`, and `python dev/check_extract.py` all pass.
   - On the 89-node flight disruption flowchart, the output HTML embeds the exact same node coordinates, connector pairs (`A`–`D`), audit score (`70`), and `[INFO]` / `[PASS]` diagnostics as the pre-optimization baseline.
3. **Browser E2E Suites**: Existing Playwright/CDP suites listed in `dev/architecture.md` (`e2e_lanes.mjs`, `e2e_connectors.mjs`, `e2e_shapes.mjs`, `e2e_shell.mjs`, `e2e_sequence.mjs`) pass without regression.
