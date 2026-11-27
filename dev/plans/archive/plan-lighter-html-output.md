# Plan: lighter standalone HTML output

**Status:** Completed (Phases 1–4 implemented on branch `feat/lighter-html-output`)  
**Goal:** Reduce standalone diagram HTML file sizes across all six diagram types while keeping generated diagrams 100% viewable and editable offline, with zero changes to the diagram JSON disk format.

## Current vs projected sizes

| Example | Current | After Phases 1–3 (zero new deps) | Optional Phase 4 (+ full JS/CSS minifier) |
|---|---:|---:|---:|
| `example-c4.html` | 840 KB | ~535 KB (-36%) | ~310–350 KB (-60%) |
| `example-sequence.html` | 781 KB | ~475 KB (-39%) | ~270–310 KB (-62%) |
| `example-gantt.html` | 742 KB | ~635 KB (-14%) | ~380–420 KB (-45%) |
| `example-flowchart.html` | 684 KB | ~645 KB (-6%) | ~380–420 KB (-40%) |
| `example-erd.html` | 601 KB | ~495 KB (-18%) | ~300–335 KB (-47%) |
| `example-usecase.html` | 573 KB | ~470 KB (-18%) | ~280–315 KB (-48%) |

## Why Gantt is still ~635 KB after Phases 1–3

- Gantt does **not** embed the 202 KB `devicon.json` logo pack today, so Phase 2 does not affect it.
- Gantt benefits from Phase 1 (**~67 KB** saved by removing unused `routeEdgesOrthogonal`) and Phase 3 (**~40 KB** saved from CSS/JS stripping).
- Most of Gantt's remaining weight is real feature code: `gantt.js` + `table.js` + `datepicker.js` (221 KB stripped) and `gantt.css` + `table.css` + `datepicker.css` (73 KB stripped), plus the shared shell (178 KB). Bringing Gantt down to **~380–420 KB** requires Phase 4 (full JS/CSS minification).

---

## Phase 1: Split `ortho-router.js` so types only bundle what they call

**Savings:** ~71 KB in `erd`, `sequence`, `usecase`; ~67 KB in `c4`, `gantt`; 0 KB in `flowchart`.  
**Risk:** Low (pure dead-code removal; no behavior change).

1. Extract `buildCurvedPathWithHops` (~4 KB, currently lines 1621–1723 of `assets/shell/ortho-router.js`) into a small shared helper file `assets/shell/curve-path.js`.
2. Keep `routeEdgesOrthogonal` and `pickClearLabelPosition` in `assets/shell/ortho-router.js` (or move to `assets/types/flowchart/`).
3. Update `scripts/layout_engine.py` (`_build_parts`) so `ENGINE_JS` includes:
   - `assets/shell/curve-path.js` only for types that declare or need it (`flowchart`, `c4`, `gantt`).
   - `assets/shell/ortho-router.js` only for `flowchart`.
   - Declare per-type engine helper needs in each type's `meta.json` (e.g. `"shellHelpers": ["curve-path.js"]` / `["curve-path.js", "ortho-router.js"]`) so `layout_engine.py` stays open for extension and closed for per-type `if` checks.
4. Update `scripts/run_engine.mjs` (if it loads `ortho-router.js`) and any unit tests that reference `ortho-router.js`.

---

## Phase 2: Load `devicon` tech logos on demand when online (C4 & Sequence)

**Savings:** ~200 KB in `c4` and `sequence` (when no tech logos are used; ~2 KB per used logo).  
**Risk:** Medium (touches icon picker UX, Save flow, and 3 E2E tests).

1. **Build-time embedding (`scripts/layout_engine.py`, `scripts/tokens.py`):**
   - Remove the unconditional `load_all_logos([BUNDLED_LOGOS_DIR])` merge for `c4` and `sequence` in `scripts/layout_engine.py`.
   - Continue embedding every logo actually referenced by the diagram (via `logo_refs(data)`), searching `BUNDLED_LOGOS_DIR` alongside `ICON_DIRS` so `logo:devicon/<name>` in diagram JSON still resolves offline at build time.
   - Always emit `const LOGOS = {...};` (even when `{}`) for types that support the logo picker (`c4`, `sequence`), so the runtime can mutate/add fetched logos and Save can update that line cleanly.
   - Keep `assets/icons/default.json` (~19 KB) embedded in all types so toolbars, default node icons, and offline icon picking always work.
2. **Online catalog fetch in the icon picker (`assets/shell/shell.js`):**
   - Add a configurable catalog URL constant pointing to the repo's `assets/logos/devicon.json` via jsDelivr (`https://cdn.jsdelivr.net/gh/khanhchungoc/ultimate-diagraming-skill@main/assets/logos/devicon.json`, CORS-enabled so `file://` pages can fetch it).
   - Fetch `devicon.json` lazily the first time the user opens the icon picker (cached in memory for the session; never fetched on page load).
   - While loading, show a brief status line (`Loading tech logos...`).
   - Once loaded, validate/sanitize the JSON shape (`icons` map of `{vb, body}` strings matching the local pack contract) and populate the "Tech logos" section of the picker.
   - If offline or fetch fails, fail quietly: show built-in icons + any logos already embedded in `LOGOS`, plus a subtle status note (`Offline — showing built-in icons and logos in this diagram.`).
3. **Offline-safe Save (`assets/shell/shell.js`):**
   - When the user picks an online-fetched logo, add its entry to the in-memory `LOGOS` map so it renders immediately.
   - In `buildSavedHtml()` (and split-artifact export), update the `const LOGOS = ...;` line to contain **only the logos currently referenced by `chartData`** (plus any non-devicon local pack entries if needed). This keeps saved files small, prunes unused logos, guarantees 100% offline rendering after Save, and requires zero changes to `disk_format.py`.
4. **External-ref policy (`scripts/layout_engine.py`):**
   - Document the on-demand `devicon.json` URL alongside Google Fonts as an optional network enhancement (page renders and edits offline without it).
5. **Tests:**
   - Keep `dev/tests/unit/test_icon_pack.py` and `dev/tests/unit/test_audit_c4.py` passing (build-time `logo:devicon/*` resolution still uses local `assets/logos/devicon.json`).
   - Update `dev/tests/e2e/e2e_c4.mjs`, `dev/tests/e2e/e2e_sequence.mjs`, and `dev/tests/e2e/e2e_c4_picker_packs.mjs` to intercept the jsDelivr URL in Playwright and serve the local `assets/logos/devicon.json` for online tests, plus add an offline-fallback check (aborting the request) and a Save-embeds-picked-logo check.

---

## Phase 3: Stronger pure-Python stripping in `scripts/strip_bundle.py`

**Savings:** ~30–45 KB per file across all 6 diagram types (no new dependencies).  
**Risk:** Low (deterministic, pure Python, guarded by full unit + E2E suite).

1. **JS (`strip_js`):**
   - Strip trailing `//` comments on plain code lines (outside strings, template literals, and regexes — the scanner already tracks all three contexts safely; skip comments matching `_KEEP`).
   - Collapse redundant runs of spaces/tabs outside strings/templates/regexes.
2. **CSS (`strip_css`):**
   - Collapse whitespace around `{`, `}`, `:`, `;`, `,` and remove redundant trailing `;` before `}`.
   - Pack multiple rules onto lines while wrapping lines before ~1,500 characters so the generated HTML always respects the `< 2000` char line limit verified by `dev/tools/build_examples.py --check`.
3. **Unit tests:**
   - Extend `dev/tests/unit/` coverage for `strip_bundle.py` (trailing `//` comments after code, URLs like `https://` inside strings/templates, regex literals, CSS `calc(...)` spacing, and max line length).

---

## Optional Phase 4: Full JS/CSS minification (biggest win for Gantt & Flowchart)

**Savings:** Additional **~180–260 KB** per file (brings Gantt from ~635 KB → ~380–420 KB, Flowchart from ~645 KB → ~380–420 KB, C4/Sequence → ~270–350 KB).  
**Trade-off:** Requires a real JS minifier (e.g. `esbuild` as an optional Node tool when available, falling back to `strip_bundle.py` when running Python-only). Because `build_examples.py --check` requires deterministic byte-for-byte output, CI and local dev would need the same pinned minifier version.

- Decide after Phases 1–3 whether the extra ~200 KB reduction justifies adding `esbuild` to `package.json`.

---

## Verification (when implementing)

- During iteration: `npm run test:fast:changed` + targeted E2E (`node dev/tests/run_e2e.mjs --only <id> --exact --section <sec>`).
- Before PR/merge:
  - `python3 dev/tools/build_examples.py && python3 dev/tools/build_examples.py --check`
  - `npm run test:fast`
  - `npm run test:e2e:changed` (including C4, Sequence, Gantt, Flowchart, ERD, Use Case)
  - Visual review of light + dark screenshots for C4/Sequence icon picker (online + offline states).
