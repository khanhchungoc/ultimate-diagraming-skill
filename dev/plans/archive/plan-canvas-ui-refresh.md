# Plan: Full Canvas UI Refresh (Performance-First, WCAG AA)

Status: completed (`feat/canvas-ui-refresh`, merged to `stg`).

## Why

The current UI has a solid token architecture (`assets/tokens/default.json`) and passes all automated WCAG AA contrast checks, but it feels slightly flat—especially in dark mode where light-mode shadow values nearly disappear—and has four mobile/touch ergonomics gaps (small touch targets on bottom docks/action bars/swatches, missing OS safe-area insets, fixed-width phone popovers, and wide wrapped action bars).

We want a modern "Pro Canvas" refresh (Gallery Vignette backdrop with Soft Dots locked in, translucent frosted glass on all floating controls, reduced layered glass shadows, subtle primary button gradient/glow, and full mobile responsiveness) while **keeping 60fps interaction on 4–5 year old laptops** (older integrated GPUs like Intel UHD / Iris Xe and dual/quad-core CPUs) and **preserving strict WCAG AA compliance**.

---

## Core Constraints & Guardrails

### 1. Performance Budget (4–5 Year Old Laptop CPU/GPU)
- **Strict `backdrop-filter` containment:** Apply frosted glass (`blur(var(--glass-blur)) saturate(190%)`, `14px` blur) **only** to small floating chrome surfaces (`.toolbar-left`, `.toolbar-right`, `.toolbar-center`, `.toolbar-zoom`, `#search-bar`, `.menu`, `#help-drawer`, `.dock-pop` Shapes popup, and Selection Action Bars `.actionbar`, `.uc-actionbar`, `.erd-actionbar`, `.seq-actionbar`). Total blurred area stays a small fraction of the viewport.
- **Bounded blur radius:** Cap blur at `14px` (`--glass-blur: 14px`) with `saturate(190%)`, avoiding excessive `24px+` radii that spike GPU sampling cost on integrated graphics.
- **Zero `backdrop-filter` on diagram primitives:** Never apply `backdrop-filter` to diagram nodes, swimlanes, edges, or notes inside `#stage`. Keep node/edge rendering flat and lightweight so diagrams scale smoothly to hundreds or thousands of nodes.
- **Zero `backdrop-filter` on full-screen backdrops:** Mobile dialog scrims use a plain semi-transparent color (`--scrim-bg`), never a full-screen blur.
- **No expensive animated properties:** Never animate `backdrop-filter` or `box-shadow` blur radii; transition only `background-color`, `border-color`, `color`, `opacity`, and `transform`.
- **Clean fallbacks:** Disable `backdrop-filter` and use solid `--bg-panel` under `@media (prefers-reduced-transparency: reduce)`, `body.capture`, and `body.exporting`.

### 2. Accessibility (WCAG AA Non-Negotiable)
- **52–54% frosted glass with high-contrast glass ink:** Use translucent frosted glass (`53%` light `--glass-bg` / `54%` dark `--glass-bg`, vertical gradient from `--glass-top` to `--glass-bottom`) paired with crisp `--text-glass` (`#020617` light, `#ffffff` dark), outer ring (`--glass-outer-ring`), and top rim highlight (`--glass-rim`) so text (≥ 4.5:1) and icons/focus rings (≥ 3:1) remain legible across light and dark themes.
- **Automated contrast coverage:** Add `text-glass`, `primary`, and `focus-ring` over `glass-bg` to `assets/tokens/default.json` and verify contrast in `dev/tests/unit/check_contrast.py --strict`.
- **Keyboard & motion parity:** Preserve `2px` `:focus-visible` rings, `prefers-reduced-motion: reduce`, and **morph, not fade** motion rules (invoke the `motion` skill before any animation edits).
- **Touch targets:** Expand coarse-pointer (`@media (pointer: coarse)`) hit areas to ≥ `40–44px` without bloating desktop visual density.

---

## Phased Implementation

### Phase 1 — Token Architecture (SSOT)
**Files:** `assets/tokens/default.json`, `scripts/tokens.py`, `dev/tests/unit/check_contrast.py`, `dev/tests/unit/check_tokens.py`

1. **Add theme-aware glass, backdrop, elevation, and button tokens** to `color.light` and `color.dark` in `assets/tokens/default.json` (keeping `tokensVersion: 1` and full custom-theme compatibility):
   - **Frosted glass surfaces (52–54% opacity):**
     - `glass-top`: `rgba(255, 255, 255, 0.62)` light, `rgba(24, 35, 58, 0.62)` dark.
     - `glass-bottom`: `rgba(255, 255, 255, 0.44)` light, `rgba(13, 20, 38, 0.46)` dark.
     - `glass-bg`: `rgba(255, 255, 255, 0.53)` light, `rgba(18, 28, 48, 0.54)` dark.
     - `glass-border`: `rgba(255, 255, 255, 0.85)` light, `rgba(148, 163, 184, 0.28)` dark.
     - `glass-outer-ring`: `rgba(15, 23, 42, 0.10)` light, `rgba(0, 0, 0, 0.36)` dark.
     - `glass-rim`: `rgba(255, 255, 255, 0.96)` light, `rgba(255, 255, 255, 0.20)` dark.
     - `glass-hover`: `rgba(15, 23, 42, 0.07)` light, `rgba(255, 255, 255, 0.10)` dark.
     - `text-glass`: `#020617` light, `#ffffff` dark.
   - **Gallery Vignette canvas backdrop:**
     - `vignette-center`: `#ffffff` light, `#18233a` dark.
     - `vignette-mid`: `#f1f5f9` light, `#0f172a` dark.
     - `vignette-edge`: `#e2e8f0` light, `#070b14` dark.
   - **Reduced glass shadow tints:**
     - `shadow-tint`: `rgba(15, 23, 42, 0.05)` light, `rgba(0, 0, 0, 0.28)` dark.
     - `shadow-tint-md`: `rgba(15, 23, 42, 0.10)` light, `rgba(0, 0, 0, 0.42)` dark.
     - `shadow-tint-lg`: `rgba(15, 23, 42, 0.13)` light, `rgba(0, 0, 0, 0.50)` dark.
   - **Primary button gradient & glow:**
     - `primary-grad-end`: `#4f46e5` light, `#6366f1` dark.
     - `primary-grad-hover-end`: `#4338ca` light, `#4f46e5` dark.
     - `primary-btn-glow`: `rgba(37, 99, 235, 0.36)` light, `rgba(99, 102, 241, 0.45)` dark.
     - `primary-btn-rim`: `rgba(255, 255, 255, 0.32)` light, `rgba(255, 255, 255, 0.28)` dark.
   - **Modal backdrop scrim:**
     - `scrim-bg`: `rgba(15, 23, 42, 0.36)` light, `rgba(2, 6, 23, 0.56)` dark (no blur).
2. **Add size & radius tokens:**
   - `size.glass-blur`: `"14px"`
   - `radius.3xl`: `"15px"`
3. **Add reduced glass & primary button shadows** under `shadow` in `assets/tokens/default.json`:
   - `glass-md`: `"inset 0 1px 0 var(--glass-rim), 0 1px 3px var(--shadow-tint), 0 6px 18px -4px var(--shadow-tint-md), 0 0 0 1px var(--glass-outer-ring)"`
   - `glass-lg`: `"inset 0 1px 0 var(--glass-rim), 0 2px 6px var(--shadow-tint), 0 12px 28px -6px var(--shadow-tint-lg), 0 0 0 1px var(--glass-outer-ring)"`
   - `primary-btn`: `"0 2px 10px -2px var(--primary-btn-glow), inset 0 1px 0 var(--primary-btn-rim)"`
4. **Extend contrast checks:** Add `["text-glass", "glass-bg", 4.5]`, `["primary", "glass-bg", 3]`, and `["focus-ring", "glass-bg", 3]` to `contrast` in `assets/tokens/default.json`. Verify with `python3 scripts/tokens.py`, `python3 dev/tests/unit/check_contrast.py --strict`, and `python3 dev/tests/unit/check_themes.py`.

---

### Phase 2 — Canvas Backdrop, Floating Chrome & Elevation
**Files:** `assets/shell/shell.css`, `assets/components/dock.css`, `assets/components/popover.css`, `assets/components/search.css`, `assets/components/button.css`, `assets/components/actionbar.css`, `assets/components/toast.css`

1. **Gallery Vignette backdrop with Soft Dots locked in (`shell.css`):**
   - Layer the Soft Dots grid pattern over a subtle radial Gallery Vignette gradient (`var(--vignette-center)` → `var(--vignette-mid)` → `var(--vignette-edge)`) on the canvas viewport so the workspace feels grounded and framed in both light and dark modes.
2. **52–54% frosted-glass floating chrome (`14px` blur + `190%` saturate)** (progressive enhancement via `@supports (backdrop-filter: blur(1px))` or `-webkit-backdrop-filter`):
   - Apply `background: linear-gradient(180deg, var(--glass-top), var(--glass-bottom))`, `border-color: var(--glass-border)`, `backdrop-filter: blur(var(--glass-blur)) saturate(190%)`, `color: var(--text-glass)`, and reduced glass shadows (`--shadow-glass-md` / `--shadow-glass-lg`) to all floating chrome:
     - Top pills: `.toolbar-left`, `.toolbar-right` (`shell.css`)
     - Bottom docks: `.toolbar-center`, `.toolbar-zoom` (`dock.css`)
     - Shapes popup: `.dock-pop` (`dock.css`)
     - Selection Action Bars: `.actionbar`, `.uc-actionbar`, `.erd-actionbar`, `.seq-actionbar` (`actionbar.css` + prefixed twins)
     - Floating search bar: `#search-bar` (`search.css`)
     - Dropdown menus & help drawer: `.menu` (`popover.css`), `#help-drawer` (`shell.css`)
   - Add `@media (prefers-reduced-transparency: reduce)` override restoring solid `var(--bg-panel)` and `backdrop-filter: none`.
   - Disable `backdrop-filter` in `body.exporting` and `body.capture`.
3. **Primary button gradient & rim (`button.css`):**
   - Style `.btn-primary` with a subtle gradient from `var(--primary)` to `var(--primary-grad-end)` (hover to `var(--primary-grad-hover-end)`) and `box-shadow: var(--shadow-primary-btn)` while preserving WCAG AA contrast with `--on-primary`.
4. **Hierarchy polish:**
   - Resting docks/pills/action bars use `--shadow-glass-md`; transient overlays (`.menu`, `.dock-pop`, `#search-bar`, `#help-drawer`, `.confirm`, `.toast`) use `--shadow-glass-lg` so layering is immediately legible without heavy drop shadows.

---

### Phase 3 — Responsive & Touch Ergonomics
**Files:** `assets/shell/shell.html`, `assets/shell/shell.css`, `assets/components/dock.css`, `assets/components/actionbar.css`, `assets/components/swatch.css`, `assets/components/popover.css`, `assets/types/usecase/usecase.css`, `assets/types/erd/erd.css`, `assets/types/sequence/sequence.css`

1. **OS Safe-Area Insets (`shell.html`, `shell.css`, `dock.css`, `search.css`, `toast.css`):**
   - Add `viewport-fit=cover` to `<meta name="viewport">` in `assets/shell/shell.html`.
   - Offset fixed edge containers using `env(safe-area-inset-top/bottom/left/right, 0px)`:
     - `header`: `top: calc(16px + env(safe-area-inset-top, 0px))` (and `12px` on `≤ 720px`)
     - `.dock-area`: `bottom: calc(20px + env(safe-area-inset-bottom, 0px))` (and `12px` on `≤ 720px`)
     - `#search-dock`, `#help-drawer`, `.toast`: respect top/bottom/side safe areas.
2. **Coarse-Pointer Touch Targets (`@media (pointer: coarse)`):**
   - Expand hit areas to ≥ `40–44px` on touch devices without changing desktop visuals:
     - `.toolbar-zoom > .btn` (`dock.css`): increase height/width or `::after` hit area from `28px` to `40px`+ (adjusting dock spacing on coarse pointers so adjacent targets don't overlap).
     - `.toolbar-center > .btn` and `.dock-pop-trigger` (`dock.css`): ensure ≥ `40px` tap height on coarse pointers.
     - `.ab-btn` and prefixed twins (`actionbar.css`): increase to `36px` visual / `42px` hit area on coarse pointers.
     - `.swatch-btn` (`swatch.css`): increase from `24×24px` to `34×34px` (with larger gap) on coarse pointers.
3. **Narrow-Screen (`≤ 560px`) Popovers, Dialogs & Action Bars:**
   - **Shape picker (`.dock-pop-grid` in `dock.css`):** Cap grid width to `calc(100vw - 36px)` with fluid tile sizing (`repeat(auto-fit, minmax(52px, 1fr))` or clamped columns) so wide 6-column palettes never clip off-screen on 375px phones.
   - **Confirmation & import bubbles (`.confirm` in `popover.css`):** On `≤ 560px`, center horizontally/vertically (`left: 50%; top: 50%; transform: translate(-50%, -50%)`) with `width: calc(100vw - 24px)` and a subtle non-blurred backdrop scrim (`--scrim-bg`).
   - **Wrapped action bars (`actionbar.css`, `usecase.css`, `erd.css`):** Clamp `max-width: min(340px, calc(100vw - 24px))` so selection bars never bleed past phone viewport edges.

---

### Phase 4 — Performance, Accessibility & Visual Verification

1. **Fast Unit & Token Checks (each phase):**
   - `python3 scripts/tokens.py`
   - `python3 dev/tests/unit/check_contrast.py --strict`
   - `python3 dev/tests/unit/check_tokens.py`
   - `python3 dev/tests/unit/check_themes.py`
   - `npm run test:fast:changed`
2. **4–5 Year Old Laptop Performance Check (Headless Chrome):**
   - Benchmark pan + zoom interaction on a dense diagram (Flowchart + C4 + Gantt) under **4× CPU throttling** via CDP (`Emulation.setCPUThrottlingRate`).
   - Verify frame time stays near 16.6ms (no severe jank spikes from `backdrop-filter`) and memory/layer count stays flat.
   - **Fallback lever if throttling shows jank:** Automatically pause `backdrop-filter` while `#viewport.gesturing` is active (swapping to `var(--bg-panel)`) or reduce blur radius on gesturing surfaces.
3. **Visual Inspection (Headless Chrome screenshots):**
   - Capture and inspect **light + dark** screenshots at:
     - Desktop (`1440×900`): resting canvas with Gallery Vignette + Soft Dots, open Export menu, open Search bar, open Shapes popover, selected node with frosted Selection Action Bar.
     - Tablet (`768×1024`): compacted header + right-aligned bottom dock.
     - Phone (`375×812`): stacked bottom docks, shape picker, centered confirm dialog, safe-area padding.
4. **Full Verification (on user confirmation, before PR/merge):**
   - `npm run test:e2e` (including `axe-core` WCAG checks across all 6 diagram types + playground)
   - `python3 dev/tools/build_examples.py && python3 dev/tools/build_examples.py --check`

---

## Risk & Trade-Off Summary

| Decision | Benefit | Trade-off / Mitigation |
|---|---|---|
| Gallery Vignette + Soft Dots locked in | Adds subtle spatial depth and framing without visual noise | Keeps diagram canvas neutral so node colors remain primary |
| 52–54% frosted glass (`14px` blur + `190%` saturate) on all floating chrome (including Shapes popup & Selection Action Bar) | Unified modern glass aesthetic across every floating control with verified `--text-glass` contrast | Higher GPU cost during pan/zoom on older laptops; mitigated by small surface area and pausing `backdrop-filter` during active gestures if needed |
| Reduced layered glass shadows (`--shadow-glass-md` / `--shadow-glass-lg`) via theme color tokens | Crisp elevation in both light and dark modes with zero breaking changes to `tokensVersion: 1` | Custom themes inherit glass tokens automatically from defaults |
| Safe-area + coarse-pointer hit expansion | Big mobile ergonomics win without bloating desktop UI | Needs visual check at `375px` to verify zoom dock stays one row |
