## Motion

- **Motion skill, every task.** For any task that touches animation, transitions, or UI motion (including actions that add or change interactive behaviour), invoke the global `motion` skill first and follow it. Repo principle: **morph, not fade**. An element that changes state, position or shape animates from its old geometry to its new one (see `morphRect`, `morphRing`, `ghostMorph` in `assets/shell/shell.js`); never cross-fade or fade in/out as a substitute.

## Coding principles

- **Maintainable and scalable.** Code must stay easy to maintain and must scale to every diagram type and every diagram size, from a handful of nodes to thousands. A change that works for one type or one small diagram but would break or slow down another is not done.
- **Reuse first.** Before writing anything, search for an existing function, component, token or helper (in `assets/components`, `assets/shell`, `scripts/`) and use it. Extend an existing one instead of writing a near-duplicate. New code is the last resort.
- **Single source of truth (SSOT).** Tokens live in `assets/tokens` and `scripts/tokens.py`, layout in `scripts/layout_engine.py`, the file format in `scripts/disk_format.py`, and the type list in `SUPPORTED_TYPES`. Never copy these into a type, a component or the playground, and never hardcode colors, sizes or fonts.
- **DRY.** Share code across types through `assets/components` and `assets/shell`. Extract on the third copy, and not at all if sharing would couple two types together.
- **Vertical slices.** One diagram type is one slice: its folder, `blank.json`, playground entry, example, checker or e2e test, and docs, all in the same change. Never leave a type half-built across layers.
- **SOLID, kept light.** The shell and layout engine are open for extension and closed for modification: a new type plugs in through a contract, and core code is not edited per type. Keep component APIs small. Prefer small modules and plain functions; use classes only for real state or polymorphism, not as a rule.
- **Contract first.** The disk format is the public API. Changing it needs a migration and a golden test (`dev/check_golden.py`).
- **Deterministic.** The same input must always give the same layout and output: no randomness, no time-based values.
- **Validate at the edge.** Check input once at the boundary and fail loudly, then trust it inside.
- **Verify before done.** Each slice has a checker or e2e test under `dev/`; run it, and check light and dark themes and contrast.
- **No new dependencies** without a stated reason; the skill must stay portable.

## Playground (GitHub Pages)

The playground (every diagram type, blank, with a type switcher) deploys itself from `main` via `.github/workflows/playground.yml`, after `dev/e2e_playground.mjs` passes. Nothing to publish by hand. A new diagram type joins it in the same change (switcher entry, `blank.json`, folder).

Playground URL: https://khanhchungoc.github.io/ultimate-diagraming-skill/
