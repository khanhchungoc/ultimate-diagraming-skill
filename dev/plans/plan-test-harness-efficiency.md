# Plan: Test Harness Speed, Stability, and Remote Tooling

Status: In Progress (created 2026-11-26 from the PR #166 / PR #167 session audit; scope refined 2026-11-26).

## Why

During the #166 UI-polish session (~111 minutes elapsed, ~960+ tool steps, 1 context compaction), **42.4 minutes (`2,543.7s`) of wall time** (`70.3 minutes` worker time across 21 logged runs, plus ~5 minutes of canceled or ad-hoc runs) went to running, waiting on, and retrying E2E tests. In contrast, the scoped follow-up slice (C4 container-to-container ports) completed end-to-end in ~16 minutes.

Observed bottlenecks from `.system_generated/tasks/` and repository sizing (`wc -l`):

| Bottleneck | Session Cost / Scale | Root Cause |
|---|---|---|
| Unselective E2E filtering | ~28 min across 10 C4/ERD runs (`118–266s` each) | `dev/tests/run_e2e.mjs` has no `--section` passthrough, `--only` uses broad substring matching (`e2e_c4` runs 7 tasks), and `--shards 4/4` silently becomes `NaN` (1-worker unsharded fallback). |
| Shared-Chrome & modal races | ~15 min in re-runs (`task-676`, `702`, `728`, `916`) | `cdp.mjs` `saved()` resolves on `#diagram-data` write before `saveToFile()` opens `#save-modal`, blocking `elementFromPoint`; parallel tabs on shared `E2E_BROWSER_WS` contend on focus and trip `swatchPicker`'s `160ms` close timer. |
| Stale baseline E2E failures | ~6 min investigating & retrying (`task-772`, `916`) | Pre-existing failures (`e2e_a11y` missing `node_modules/axe-core`, `c4_drag [scale]` strict VM CPU threshold, `e2e_sequence:980` old `#2f7da8` RGB, `e2e_touch:193` subpixel port width) pollute `--changed` runs. |
| Missing reusable visual capture | Repeated ad-hoc inline scripts | Light/dark screenshot reviews required writing throwaway CDP scripts each session. |
| Missing remote devDependencies / CodeGraph | `node_modules/axe-core` absent; `.codegraph/` absent on fresh VMs | Remote VMs boot from fresh clones without `npm ci` or a prebuilt index (`ultimate-harness` is ~606 lines total, so CodeGraph only matters for `ultimate-diagraming-skill` if installable under VM network policy). |
| Mega-batch multi-diagram prompts | Context compaction at step ~473 | Combining 10+ unrelated changes across 6 diagram types delayed feedback and compounded cold-start re-discovery. |

## Phases

### Phase 1: Fast Targeted E2E Filtering (`dev/tests/run_e2e.mjs`)

1. **Add `--section <names>` and `--exclude-section <names>` passthrough:** Forward to any test supporting `t.section(...)` and force `shards = 1` automatically so targeted iteration runs in ~10–20s instead of 150s+.
2. **Add `--exact` matching:** Allow targeting `c4` or `erd` without sweeping in `c4_drag`, `c4_export`, `c4_packs`, `c4_fit`, or `erd_copy`.
3. **Validate `--shards` strictly:** Reject non-integer values (like `--shards 4/4`) with exit code `1` and clear usage output instead of silent `NaN` fallback.
4. **Handle absent optional `axe-core` cleanly:** When `node_modules/axe-core/axe.min.js` is not installed locally (non-CI), report `[SKIP] a11y (axe-core not installed; run npm ci)` rather than failing `--changed` with an unhandled `ENOENT` stack trace; in CI (`process.env.CI`), still fail loudly so accessibility regressions cannot hide.

### Phase 2: Eliminate E2E Timing Races & Baseline Failures

1. **Fix `cdp.mjs` `saved()` vs `#save-modal` race (`dev/tests/e2e/cdp.mjs`):** Wait for or cleanly close `#save-modal` after `saveToFile()` / `writeFile()` settles (without accidentally triggering `showSaveFilePicker` or a download, and without breaking `e2e_shell.mjs` save-modal tests) so `Ctrl+S` mid-test cannot pop `<dialog id="save-modal">` over the next `elementFromPoint()` call (`e2e_erd.mjs:816`).
2. **Stabilize parallel Chrome execution (`dev/tests/run_e2e.mjs` / `cdp.mjs`):** Investigate `swatchPicker` / parallel-tab flake under `--jobs >= 2` first, and benchmark isolated Chrome per worker vs shared `E2E_BROWSER_WS` while ensuring RAM/CPU stays safe on 2-core VMs.
3. **Fix stale baseline assertions:**
   - `dev/tests/e2e/e2e_sequence.mjs:980`: Read the expected lifeline stroke color from `--sw-1-line` computed style instead of hardcoded `rgb(47, 125, 168)` left over before the vibrant palette update.
   - `dev/tests/e2e/e2e_touch.mjs:193`: Inspect and fix the root cause (subpixel scaling or `--ui-scale` timing) of ERD touch `.port` width checking `< 20px`.
   - `dev/tests/e2e/e2e_c4_drag.mjs` `scale` section: Gate strict script-ms timing (`160ms` / `200ms`) behind `--perf` (or `E2E_PERF=1`), logging timing by default on shared CI/VM hosts while keeping all functional correctness checks active.

### Phase 3: Pure-Logic Unit Checks (`dev/tests/unit/`)

1. **Keep Node unit checks strictly on pure logic (run inside `npm run test:fast`):** Test pure math/geometry/layout/codec helpers (`engine.js`, `route.js`, arrow geometry transforms) without introducing fragile source-scraping or fake-DOM tests for browser scripts. Leave DOM/action-bar/inline-edit verification in fast `--section` E2E tests (~10–20s after Phase 1).

### Phase 4: Reusable Visual Verification Helper & Iteration Guidance

1. **Shared visual review script (`dev/tools/capture_review.mjs`):** Parameterized CLI (`--page`, `--themes light,dark`, `--select <sel>`, `--hover <sel>`, `--out <dir>`, `--viewport WxH`) built on `cdp.mjs` so visual inspections require one tested command instead of ad-hoc inline scripts.
2. **Update iteration guidance (`ultimate-harness/projects/ultimate-diagraming-skill/AGENTS.md`):** Keep as the single canonical owner (`Verify commands`): iterate with `npm run test:fast:changed` + `node dev/tests/run_e2e.mjs --only <id> --exact --section <sec>`, reserve full `--changed` E2E for final sign-off, and split multi-diagram UI requests into 1-diagram slices/PRs.

### Phase 5: Remote VM Boot Setup (`npm ci` + CodeGraph Feasibility)

1. **Persist `npm ci --ignore-scripts` for remote VMs:** Configure via `ultimate-diagraming-skill/.agents/environment.json` (or `/home/antigravity/env-setup.sh`) so `axe-core` and `mermaid` devDependencies are installed out of the box and `e2e_a11y` runs cleanly.
2. **Verify CodeGraph feasibility before automating:** Test whether `codegraph` installs and indexes fast under remote VM network restrictions; only add it to boot setup (scoped strictly to `ultimate-diagraming-skill`, never `ultimate-harness`) if install succeeds reliably and cold-start cost is well below reading time saved.

### Deferred to Separate Backlog: Modularizing Oversized Files

Splitting monolithic files (`shell.js`, `ortho-router.js`, 6 diagram plugins, `layout_engine.py`, and large E2E suites) is a multi-PR architecture refactor rather than a test-harness efficiency fix. Once Phase 1 adds `--section` filtering, splitting giant E2E files is no longer urgent. Track modularity opportunistically when actively modifying a file (one type per PR, never as a bulk sweep or arbitrary line-count gate). Note that `shell.js` and plugin JS files are plain concatenated bodies inside one outer wrapper (`scripts/layout_engine.py` `SHELL_JS` / `TYPE_JS`), so future incremental splits require no bundler rewrite.

## Acceptance

- Targeted UI verification (`run_e2e.mjs --only <id> --exact --section <sec>`) completes in under 20s per edit cycle.
- `e2e_erd`, `e2e_c4`, `e2e_sequence`, and `e2e_touch` pass 100% consistently across 3 consecutive runs under default `--jobs`.
- `npm run test:e2e:changed` returns exit code `0` cleanly on an unmodified branch (or cleanly marks locally skipped `a11y` when `axe-core` is absent, while failing in CI).
- Headless Chrome screenshot captures run cleanly via a single command in both light and dark themes.
- Remote VM boot setup installs `npm ci --ignore-scripts` cleanly (and `.codegraph/` if feasible in the VM network environment).

## Risks

- Running separate Chrome instances per worker increases peak RAM compared to `E2E_BROWSER_WS`; verify worker cap (`--jobs`) stays safe on 2-core / memory-constrained devboxes before switching defaults.
- Keeping `c4_drag [scale]` functional while making timing thresholds opt-in (`--perf`) must ensure performance regressions are still caught when `--perf` runs before releases.
- Pre-building `.codegraph/` at VM boot may fail under restricted outbound network policies or add startup seconds; verify before enabling.

