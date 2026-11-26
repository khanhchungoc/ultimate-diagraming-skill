# Plan: Opportunistic Modularity and Pure-Logic Unit Tests

Status: Backlog (split out from `dev/plans/archive/plan-test-harness-efficiency.md` on 2026-11-26).

## Why

Phases 1, 2, 4, and 5 of `plan-test-harness-efficiency.md` (PR #170) resolved the immediate iteration bottlenecks via `--exact --section` E2E filtering, `#save-modal` race fixes, `capture_review.mjs`, and `.agents/environment.json` (with CodeGraph indexing).

Two lower-urgency structural tracks remain as an opportunistic backlog to tackle incrementally whenever actively working in an affected area—never as a big-bang sweep:

1. **Pure-logic unit tests (formerly Phase 3):** Expand sub-second Node unit tests (`npm run test:fast`) strictly for pure math, geometry, layout, and codec helpers without introducing fake-DOM or source-scraping tests for browser scripts.
2. **Modularizing oversized files (formerly Phase 6):** Break up multi-concern monoliths along real domain seams when doing major work on that subsystem or diagram type (one type per PR).

## Tracks

### Track A: Pure-Logic Unit Checks (`dev/tests/unit/`)

- Add lightweight Node unit tests inside `npm run test:fast` when modifying pure geometry/layout/codec logic (for example, Flowchart arrow endpoint trimming, decision default label rules, or layout/routing math).
- Keep DOM/action-bar/inline-edit verification in fast `--exact --section` E2E tests (~5–20s) rather than mocking browser DOM in Node.

### Track B: Opportunistic Modularization

Because `scripts/layout_engine.py` already concatenates `SHELL_JS` (`shell.js`, `notes.js`) and `TYPE_JS` (`*extraJs`, `<type>.js`) inside one outer wrapper, splitting preserves the exact single-file HTML and split-artifact output with no bundler rewrite:

1. **Shell & router (`assets/shell/shell.js`, `ortho-router.js`):** Extract cohesive subsystem modules (`ui.js`, `motion.js`, `viewport.js`, `export.js`, `save.js`) matching the existing `notes.js` pattern when making substantial shell changes.
2. **Large diagram plugins (`flowchart.js`, `gantt.js`, `sequence.js`, `erd.js`, `c4.js`, `usecase.js`, `gantt/table.js`, `gantt.css`):** Group along real functional boundaries (`render.js`, `edit.js`, `drag.js`, `actionbar.js`, `codec.js`) listed under `meta.json` `extraJs`—strictly one diagram type per PR, only when actively working in that type.
3. **Python assembly (`scripts/layout_engine.py`):** Separate HTML/artifact assembly from Flowchart layout when touching core assembly logic.
4. **Cohesion-first policy (no hard line-count gate):** Split only along clear domain seams (never artificially to hit a line count). Optionally add a non-blocking `[INFO]` report in `dev/tools/` if visibility is ever needed.

## Verification (per incremental PR)

- Every split PR must pass `test_strip_bundle.py`, `check_golden.py`, `check_components.py`, `build_examples.py --check`, and the full E2E suite for the touched diagram type(s).
