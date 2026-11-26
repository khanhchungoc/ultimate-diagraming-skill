# Plan: Test Harness Speed, Stability, Modularity, and Remote Tooling

Status: Draft (created 2026-11-26 from the PR #166 / PR #167 session audit).

## Why

During the #166 UI-polish session (~111 minutes elapsed, ~960+ tool steps, 1 context compaction), **42.4 minutes (`2,543.7s`) of wall time** (`70.3 minutes` worker time across 21 logged runs, plus ~5 minutes of canceled or ad-hoc runs) went to running, waiting on, and retrying E2E tests. In contrast, the scoped follow-up slice (C4 container-to-container ports) completed end-to-end in ~16 minutes.

Observed bottlenecks from `.system_generated/tasks/` and repository sizing (`wc -l`):

| Bottleneck | Session Cost / Scale | Root Cause |
|---|---|---|
| Unselective E2E filtering | ~28 min across 10 C4/ERD runs (`118–266s` each) | `dev/tests/run_e2e.mjs` has no `--section` passthrough, `--only` uses broad substring matching (`e2e_c4` runs 7 tasks), and `--shards 4/4` silently becomes `NaN` (1-worker unsharded fallback). |
| Shared-Chrome & modal races | ~15 min in re-runs (`task-676`, `702`, `728`, `916`) | `cdp.mjs` `saved()` resolves on `#diagram-data` write before `saveToFile()` opens `#save-modal`, blocking `elementFromPoint`; parallel tabs on shared `E2E_BROWSER_WS` contend on focus and trip `swatchPicker`'s `160ms` close timer. |
| Stale baseline E2E failures | ~6 min investigating & retrying (`task-772`, `916`) | Pre-existing failures (`e2e_a11y` missing `node_modules/axe-core`, `c4_drag [scale]` strict VM CPU threshold, `e2e_sequence:980` old `#2f7da8` RGB, `e2e_touch:193` subpixel port width) pollute `--changed` runs. |
| Monolithic source & test files | `flowchart.js` `4,823`, `gantt.js` `4,723`, `shell.js` `4,595`, `sequence.js` `2,988`, `erd.js` `2,911`, `c4.js` `2,571`, `usecase.js` `2,503`, `layout_engine.py` `2,404`, `e2e_c4.mjs` `1,577`, `e2e_erd.mjs` `1,519` | Files exceed the 800-line / 46 KB single-read limit, causing multi-slice reads, context bloat, compaction, and inability to unit-test UI logic outside Chrome. |
| No remote CodeGraph index | `.codegraph/` absent in `ultimate-diagraming-skill`; `codegraph` not on VM `PATH` | Remote VMs boot from fresh clones where gitignored `.codegraph/` does not exist (and `ultimate-harness` is only ~606 lines total, so CodeGraph is only worthwhile on `ultimate-diagraming-skill`). |
| Mega-batch multi-diagram prompts | Context compaction at step ~473 | Combining 10+ unrelated changes across 6 diagram types delayed feedback and compounded cold-start re-discovery. |

## Phases

### Phase 1: Fast Targeted E2E Filtering (`dev/tests/run_e2e.mjs`)

1. **Add `--section <names>` and `--exclude-section <names>` passthrough:** Forward to any test supporting `t.section(...)` and force `shards = 1` automatically so targeted iteration runs in ~10–20s instead of 150s+.
2. **Add `--exact` matching (or exact-id prefix syntax):** Allow targeting `c4` or `erd` without sweeping in `c4_drag`, `c4_export`, `c4_packs`, `c4_fit`, or `erd_copy`.
3. **Validate `--shards` strictly:** Reject non-integer values (like `--shards 4/4`) with exit code `1` and clear usage output instead of silent `NaN` fallback.
4. **Handle absent optional `axe-core` cleanly:** When `node_modules/axe-core/axe.min.js` is not installed, report `[SKIP] a11y (axe-core not installed)` (or install via Phase 5) rather than failing `--changed` with an unhandled `ENOENT` stack trace.

### Phase 2: Eliminate E2E Timing Races & Baseline Failures

1. **Fix `cdp.mjs` `saved()` vs `#save-modal` race (`dev/tests/e2e/cdp.mjs`):** Wait for/suppress or cleanly close `#save-modal` after `writeFile()` settles so `Ctrl+S` mid-test cannot pop `<dialog id="save-modal">` over the next `elementFromPoint()` call (`e2e_erd.mjs:816`).
2. **Isolate parallel Chrome execution (`dev/tests/run_e2e.mjs` / `cdp.mjs`):** Benchmark separate headless Chrome instances (or isolated window/focus handling) per worker vs `E2E_BROWSER_WS` shared tabs to eliminate multi-worker click/swatch drops (`e2e_erd` under `--jobs >= 2` and `swatchPicker`'s `160ms` `pointerleave` timer).
3. **Fix stale baseline assertions:**
   - `dev/tests/e2e/e2e_sequence.mjs:980`: Read the expected lifeline stroke color from `--sw-1-line` computed style instead of hardcoded `rgb(47, 125, 168)` left over before the vibrant palette update.
   - `dev/tests/e2e/e2e_touch.mjs:193`: Inspect and fix the root cause (subpixel scaling or `--ui-scale` timing) of ERD touch `.port` width checking `< 20px`.
   - `dev/tests/e2e/e2e_c4_drag.mjs` `scale` section: Gate strict script-ms timing (`160ms` / `200ms`) behind `--perf` (or advisory logging by default on shared CI/VM hosts) while keeping functional correctness checks active.

### Phase 3: Sub-second Unit Checks for Plugin UI Contracts (`dev/tests/unit/`)

1. **Add lightweight Node unit checks (run inside `npm run test:fast`):** Test action bar button ordering (`note` before `delete`, expected/omitted actions per type), C4/ERD inline edit state cleanup (`itemState` entries for dynamic labels), and Flowchart arrow geometry transforms (endpoint trimming, decision default label omission) without launching Chrome.

### Phase 4: Reusable Visual Verification Helper & Iteration Guidance

1. **Shared visual review script (`dev/tools/capture_review.mjs`):** Parameterized CLI (`--page`, `--themes light,dark`, `--select <sel>`, `--hover <sel>`, `--out <dir>`) built on `cdp.mjs` so visual inspections require one tested command instead of ad-hoc inline scripts.
2. **Update iteration guidance (`ultimate-harness/projects/ultimate-diagraming-skill/AGENTS.md`):** Keep as the single canonical owner (`Verify commands`): iterate with `npm run test:fast:changed` + `node dev/tests/run_e2e.mjs --only <id> --section <sec>`, reserve full `--changed` E2E for final sign-off, and split multi-diagram UI requests into 1-diagram slices/PRs.

### Phase 5: Remote VM Boot Setup & CodeGraph (Skill Repo Only)

1. **Scope CodeGraph strictly to `ultimate-diagraming-skill`:** Keep `ultimate-harness` unindexed (~606 lines total across configs/scripts; zero gain vs. boot overhead).
2. **Persist remote setup via `ultimate-diagraming-skill/.agents/environment.json` (or project `/home/antigravity/env-setup.sh`):**
   - Idempotently install `codegraph` onto `PATH` (if not already present) and run `codegraph index` inside `ultimate-diagraming-skill` so `.codegraph/` is ready before Turn 1 on every fresh remote VM.
   - Optionally install `npm ci --ignore-scripts` / `axe-core` when needed so `e2e_a11y` runs cleanly out of the box.

### Phase 6: Modularize Oversized Files & Add Size Guardrails

Because `scripts/layout_engine.py` already concatenates `SHELL_JS` (`shell.js`, `notes.js`) and `TYPE_JS` (`*extraJs`, `<type>.js`), splitting preserves the exact single-file HTML / split artifact output with no bundler rewrite:

1. **Split `assets/shell/shell.js` (`4,595` lines) & `ortho-router.js` (`1,950` lines):** Extract cohesive subsystem modules (`ui.js`, `motion.js`, `viewport.js`, `export.js`, `save.js`) matching the existing `notes.js` (`6 KB`) pattern.
2. **Split large diagram plugins (`flowchart.js`, `gantt.js`, `sequence.js`, `erd.js`, `c4.js`, `usecase.js`, `gantt/table.js`, `gantt.css`):** Group along real functional boundaries (`render.js`, `edit.js`, `drag.js`, `actionbar.js`, `codec.js`) listed under `meta.json` `extraJs` (ordered sequentially inside incremental PRs — one type per PR).
3. **Split `scripts/layout_engine.py` (`2,404` lines) & giant E2E suites (`e2e_c4.mjs`, `e2e_erd.mjs`, `e2e_sequence.mjs`, `e2e_gantt.mjs`, `e2e_shell.mjs`):** Separate HTML/artifact assembly from Flowchart layout; split mega E2E suites into feature-focused test files (matching `c4_drag`, `c4_export`, `erd_copy`) for sharper `--only` and `--changed` selection.
4. **Cohesion-first guidance (never a hard line-count gate):**
   - **Harness rule (`ultimate-harness/AGENTS.md` under Coding / Ponytail):** Add one lightweight guidance note encouraging cohesive, single-responsibility modules rather than piling unrelated features onto an already large file—explicitly subordinated to domain cohesion, SSOT, and guarded DRY (never split artificially just to hit an arbitrary line count).
   - **Advisory visibility only (`ultimate-diagraming-skill`):** No hard CI fail gate on file lines; optionally add a non-blocking `[INFO]` report (e.g., inside `dev/tools/` or `check_components.py`) listing oversized multi-concern files (> ~1,500 lines) for planned refactors without blocking cohesive modules.

## Acceptance

- Targeted UI verification (`run_e2e.mjs --only <id> --section <sec>`) completes in under 20s per edit cycle.
- `e2e_erd`, `e2e_c4`, `e2e_sequence`, and `e2e_touch` pass 100% consistently across 3 consecutive runs under default `--jobs`.
- `npm run test:e2e:changed` returns exit code `0` cleanly on an unmodified branch (or cleanly marks environment-skipped `a11y`).
- Headless Chrome screenshot captures run cleanly via a single command in both light and dark themes.
- On a fresh remote VM boot, `.codegraph/` exists inside `ultimate-diagraming-skill` (and not `ultimate-harness`) and `codegraph explore` works on Turn 1.
- Extracted modules split along clear domain seams (no coupled wrappers or arbitrary line-count cuts), and existing monoliths shrink cleanly without new multi-concern bloat.

## Risks

- Running separate Chrome instances per worker increases peak RAM compared to `E2E_BROWSER_WS`; verify worker cap (`--jobs`) stays safe on 2-core / memory-constrained devboxes.
- Keeping `c4_drag [scale]` functional while making timing thresholds opt-in (`--perf`) must ensure performance regressions are still caught when `--perf` runs before releases.
- Refactoring IIFE closures (`shell.js`, `flowchart.js`, etc.) into concatenated multi-file modules requires careful shared-state interfaces (`strip_bundle` + `golden` + full E2E verification per migrated type).
- Pre-building `.codegraph/` at VM boot adds startup seconds; benchmark `codegraph index` runtime in `/home/antigravity/env-setup.sh` so cold-start cost stays well below the reading time it saves.
