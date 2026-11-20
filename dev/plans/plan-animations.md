# Plan: Fluid, Morph-First Motion System Across All Diagram Actions

Status: built and tested (see "Implementation notes" at the end). Open items are listed there.

## 1. Goals & Motion Principles

Add a cohesive, high-performance motion system covering every interactive action in the generated diagram HTML pages (standalone files, claude.ai split artifacts, and the playground).

1. **Morph and continuity over crossfade:** Elements should move, unfold, reshape, or transform from one state into another rather than fading out and fading back in. Use shared-element FLIP morphs, `clip-path` reveals, directional slides, SVG geometry interpolation, and `stroke-dashoffset` draw-ins. Reserve `opacity` strictly for subtle depth/dimming (focus highlighting, search dimming) or brief tail cleanup—never as the primary transition.
2. **Fast for rapid workflows, still noticeable:** Every micro-interaction lands in `100–160ms`, UI panels/morphs in `160–200ms`, and full-canvas layout/camera transitions in `200–260ms`. Rapid repeated actions (holding `Ctrl+Z`, stepping arrows, rapid zoom clicks, switching tabs quickly) interrupt mid-flight, capture the element's current visual position, and compress duration to `0.55×` (`~90–130ms`) so motion never lags behind a fast user.
3. **Calm, serious feel (not flashy):** Diagramming is a precision tool. Layout and structural reflows use critically-damped curves (zero overshoot). Tactile controls (popovers, switches, action bars) use at most a `~3%` physical settle. Direct manipulation (pointer/touch pan, pinch, wheel zoom, live node/table/message drag) stays **1:1 instantaneous (`0ms` transition)**.
4. **60/120fps compositor-first performance:** Animate only `transform` (`translate`, `scale`, `rotate`), `clip-path`, `opacity`, and batched SVG geometry/stroke attributes. Never animate `width`, `height`, `top`, `left`, `max-width`, `padding`, `margin`, or `box-shadow`. Inside `requestAnimationFrame` loops, avoid per-frame object allocation and use indexed `for` loops rather than `.forEach`/`.map` (per Motion vanilla-JS performance guidelines).
5. **Zero external runtime dependencies:** Generated pages must remain 100% offline-capable (`scripts/layout_engine.py` `ALLOWED_EXTERNAL` allows only Google Fonts). Instead of bundling the `motion` npm runtime into every standalone HTML file, we apply Motion's spring physics (`linear()` sampled curves), easing taxonomy, FLIP mechanics, and WAAPI/rAF discipline inside one tiny shared motion kernel (~160 lines in `assets/shell/shell.js`) driven by tokens in `assets/tokens/default.json`.
6. **Zero regressions on exports, screenshots, accessibility, or E2E tests:** All JS and CSS animations auto-disable under `prefers-reduced-motion: reduce`, `body.capture`, `body.exporting`, `?report`, `?tidy`, and `?noanim`. Logical DOM state (such as `[hidden]`, `.confirm` removal, and final layout coordinates) updates immediately so keyboard focus and `dev/e2e_*.mjs` assertions stay rock solid.

---

## 2. Codebase Reality & Pre-Existing Bottlenecks to Fix First

Auditing all four diagram types and the shell revealed three architectural facts that shape the design:

1. **Full wipe-and-rebuild `render()` in all 4 types:** `flowchart.js`, `sequence.js`, `erd.js`, and `usecase.js` clear `innerHTML`/`textContent` and recreate DOM/SVG nodes on almost every edit. Plain CSS transitions cannot bridge across a wiped DOM; **a shared FLIP engine keyed by stable `data-*` attributes is mandatory** for layout, reorder, collapse/expand, Auto-Tidy, and Undo/Redo motion.
2. **Existing non-composited animations & drag bottlenecks:**
   - `assets/components/dock.css:171`: `#btn-delete-selection` animates `max-width`, `padding`, and `margin` (triggers layout every frame). Replace with sibling FLIP + `transform`/`clip-path`.
   - `assets/components/dock.css:87, 156`: `#shape-pop` / `#uc-pop` uses a slow, overly bouncy `0.42s cubic-bezier(0.34, 1.56, 0.64, 1)` plus tile stagger up to `340ms` (~680ms total). Retune to `190ms` with a calm `~3%` tactile spring and `16ms` tile stagger.
   - `assets/types/flowchart/flowchart.css:438, 642`: `@keyframes connector-pulse` and `@keyframes just-inserted` animate `box-shadow` (main-thread repaint per frame). Replace with a `::after` ring animated via `transform: scale()` + `opacity`.
   - `assets/types/flowchart/flowchart.js` (`placeNodeEl`, `onNoteMove`): Node drag and note drag mutate `style.left` / `style.top` every pointermove (unlike `erd.js` and `usecase.js`, which already use `style.translate`). Switch live drag to `style.translate`, committing `left/top` on drop.
   - `assets/types/flowchart/flowchart.css:283, 311, 314, 612`: SVG `filter: drop-shadow(...)` on hovered/selected shapes and `.palette-ghost` triggers expensive per-frame SVG rasterization; keep off during drag/FLIP and prefer crisp stroke/ring emphasis.
   - `assets/shell/shell.js:1310`: Comment states `.toast` "fades out", but `toast.css` currently has no entrance or exit animation at all.
   - `assets/types/sequence/sequence.js:2235`: `searchItems()` queries `.seq-frag-label`, whereas fragments render as `.frame-tag` (fix so search highlight/glide covers fragment headers too).
3. **Token validator limit (`scripts/tokens.py:24`):** `_TIME` currently accepts only `^\d+(\.\d+)?m?s( [a-z-]+)?$`, which rejects `cubic-bezier(...)` and `linear(...)` curves. Extend `scripts/tokens.py` first so all motion tokens live in `assets/tokens/default.json` and stay validated by `dev/check_tokens.py`.

---

## 3. Motion Tokens (`assets/tokens/default.json` & `scripts/tokens.py`)

Expand the `"motion"` block in `assets/tokens/default.json` (compiled to CSS custom properties in `:root` and `TOKENS.motion` in JS):

| Token | Value | Use |
|---|---|---|
| `--ease` | `120ms cubic-bezier(0.2, 0, 0, 1)` | Backwards-compatible default; crisp micro-transitions (hover, stroke, border, color). |
| `--dur-micro` | `100ms` | Hover highlights, focus dimming (`< 120ms` for `e2e_erd.mjs`), port/handle reveal, button press. |
| `--dur-fast` | `140ms` | Exits, label/badge morphs, edge draw-in, tab indicator glide. |
| `--dur-base` | `180ms` | Popovers, menus, search bar, help drawer, action bar morph, switches, single-element spawns. |
| `--dur-layout` | `230ms` | Multi-element FLIP (Auto-Tidy, Undo/Redo, insert/reorder, collapse/expand, detail/type toggle, direction flip). |
| `--dur-camera` | `240ms` | Programmatic viewport glides (`fitView`, zoom buttons, search centre, jump-to-partner, zoom-to-table, Present fit). |
| `--curve-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | Entrances, unfolds, camera glides, SVG draw-ins. |
| `--curve-in` | `cubic-bezier(0.4, 0, 1, 1)` | Decisive exits and retractions. |
| `--curve-inout` | `cubic-bezier(0.4, 0, 0.2, 1)` | Reversible state morphs (switches, tab indicator, focus dim, chevron rotate, pan/zoom). |
| `--curve-spring-settle` | `linear(0, 0.0734, 0.2223, 0.3833, 0.5286, 0.6489, 0.7435, 0.8153, 0.8686, 0.9074, 0.9352, 0.955, 0.9689, 0.9786, 1)` | Critically-damped spring (`zeta = 1.0`, zero overshoot) for layout FLIP and structural morphs. |
| `--curve-spring-tactile` | `linear(0, 0.1021, 0.3124, 0.5352, 0.7235, 0.8616, 0.9511, 1.0018, 1.0252, 1.0315, 1.0288, 1.0223, 1.0152, 1.0092, 1)` | Subtle tactile spring (`zeta = 0.74`, `3.1%` peak settle) for dock popovers, switch knobs, and new-element spawns. |

### `scripts/tokens.py` Change
- Accept durations (`^\d+(\.\d+)?m?s$`), standard curves (`cubic-bezier(...)`, `linear(...)`, keyword easings), and composite shorthand (`<dur> <curve>`) under `tokens["motion"]`.
- Emit each key as `--<key>` in `:root` and preserve raw numeric ms + curve strings in `TOKENS.motion` so WAAPI calls in `shell.js` share the exact same tokens as CSS.

---

## 4. Shared Motion Kernel (`assets/shell/shell.js` & `assets/shell/shell.css`)

Add a single shared `motion` helper (~160 lines) in `assets/shell/shell.js` exposed to all four plugins, eliminating duplicate animation logic across diagram types.

### 4.1 Core Primitives

1. **`motion.enabled()`**
   Returns `false` if any of:
   - `window.matchMedia('(prefers-reduced-motion: reduce)').matches`
   - `document.body.classList.contains('capture')` or `document.body.classList.contains('exporting')`
   - URL params include `report`, `tidy`, or `noanim`
   - First-load hydration before `document.documentElement.dataset.diagramReady === '1'` (prevents entrance flash on cold page open).

2. **`motion.speedScale()` (Rapid-Action Compression)**
   Tracks timestamp of the last structural animation (`lastPlayAt`). If another action fires within `90ms`, returns `0.55`; within `180ms`, returns `0.75`; otherwise `1.0`. Applied automatically to FLIP, morph, and camera durations so rapid `Ctrl+Z` / keyboard stepping feels crisp and never queues up.

3. **`motion.capture(root, specs)` → `snap` and `motion.play(snap, root, specs, opts)` (Interruptible FLIP)**
   - **Capture (First):** Before `render()`, walks `specs` (`[{ selector, key, mode }]`) on `root`, cancels any active WAAPI animations only *after* reading each element's current on-screen visual rect via `getBoundingClientRect()` (converted into `#stage` local coordinates by dividing by `scale` so pan/zoom doesn't distort deltas!). Stores `{ x, y, w, h, rx, ry }` per key.
   - **Play (Invert + Play):** After `render()`, measures new rects in one batched read pass (zero interleaved writes!). Then in one write pass:
     - **Moved (`|dx| > 0.5 || |dy| > 0.5`)**: WAAPI `el.animate([{ transform: translate(dx, dy) }, { transform: 'none' }], { duration, easing })`.
     - **Resized (`mode: 'size'` or `'clip'`)**:
       - For boxes with fixed-size text (ERD tables, Sequence frames/rails, UseCase subjects, Flowchart lanes): avoid stretching text! Use `clip-path: inset(0 rightPx bottomPx 0 round var(--r))` → `inset(0 0 0 0 round var(--r))` paired with `translate(dx, dy)` (or container background scale + counter-scaled inner text where clip-path isn't appropriate).
       - For pills/shapes whose border stretches (UseCase `.uc-shape`, Flowchart `.flow-node`, badges): invert `scale(oldW/newW, oldH/newH)` with `transform-origin: center` (or `top left` for anchored bars), only when ratio stays in `[0.45, 2.2]`; fall back to `clip-path` beyond that to avoid text distortion.
     - **Entered (key not in `snap`)**:
       - If an `originRect` or `fromKey` map is passed (shared-element morph: dock button, dropped ghost, collapsed subprocess, parent badge), FLIP-morph directly from `originRect` → new element rect.
       - Otherwise, unfold in place (`transform: scale(0.88)` + `clip-path` or slight directional offset → identity, `160ms --curve-spring-tactile`).
     - **Exited (key in `snap`, missing after `render()`)**:
       - If a `toKey` map is passed (e.g., Collapse to Subprocess, Collapse Subject, Collapse Frame), spawn an inert ghost clone (`motion.ghostExit`) that FLIP-flies into the target element's rect!
       - Otherwise, if `opts.ghostExit` is set, spawn a brief `110ms` scale-down ghost clone in `#motion-ghost-layer` (`data-export-skip aria-hidden="true"`).
   - **Performance cap:** If more than `120` elements moved simultaneously (huge 200+ node Auto-Tidy), automatically simplify to pure `translate` on visible-viewport elements only (`rect` intersects viewport) so frame time stays under `8ms`.

4. **`motion.morphRect(fromRect, toEl, opts)` (Shared-Element Morph)**
   Used for chrome and cross-component morphs where one UI element transforms into another (header `#btn-present` ↔ pinned `#btn-present`, ERD mini-table ↔ `.erd-expand-card`, `.actionbar` A ↔ `.actionbar` B, `#save-status` width change, `.flow-tab` active pill indicator, `.note-badge` ↔ `.note`). Measures `fromRect` vs `toEl.getBoundingClientRect()` in viewport space and runs an interruptible WAAPI `transform` / `clip-path` animation.

5. **`motion.ghostExit(el, opts)` (Non-Blocking Exits for E2E Safety)**
   When a menu, confirm popover, toast, or deleted node leaves the DOM, the real element is hidden/removed **synchronously** (so `menu.hidden === true`, `count('.confirm') === 0`, `!querySelector('.tab-menu')`, and focus updates immediately). If `motion.enabled()`, a lightweight visual clone (stripped of IDs, interactive roles, and test-queried classes such as `.confirm`, `.toast`, `.menu`, `.tab-menu`, and `.edge-bar`, marked `data-motion-ghost data-export-skip aria-hidden="true"`) is placed in a `position: fixed; pointer-events: none; z-index: 2200` layer, runs a `110–140ms --curve-in` retract/morph animation, and removes itself on `finish`/`cancel`.

6. **`motion.tweenSvg(tracks, opts)` (Batched SVG Geometry & Stroke Animator)**
   A single shared `requestAnimationFrame` driver synced to the exact same easing function and duration as the HTML FLIP pass:
   - Pre-allocates flat numeric `Float64Array` buffers before the loop; updates SVG `d` / `x1/y1/x2/y2` / `x/y/width/height` via indexed `for` loops with zero object allocations per frame.
   - Supports three track types:
     - **`bezier`**: 8 floats (`x0..y3`) for ERD relationships and UseCase links.
     - **`line` / `rect`**: 4 floats for Sequence lifelines, activation bars, message arrows, and note leader lines.
     - **`polyline`**: normalized vertex list for Flowchart orthogonal edges (subdividing the shorter segment array to match vertex count when `<= 60` edges and vertex delta is small; otherwise clean `stroke-dashoffset` draw-reveal).
   - **`motion.drawPath(pathEl, opts)`**: Measures `pathEl.getTotalLength()`, sets `strokeDasharray` & `strokeDashoffset`, runs WAAPI `strokeDashoffset: [len, 0]` (`140ms --curve-out`), and clears inline dash properties on finish (respecting dashed edges via a clip/mask or dasharray handoff).

7. **`animateViewport(targetPanX, targetPanY, targetScale, opts)` & `cancelViewportAnim()` (Unified Camera)**
   Replaces `.search-glide`, Flowchart's bespoke `jumpToPartner` rAF loop, and all instantaneous camera jumps (`fitView`, zoom buttons, `erdZoomToTable`, `fitToMatches`, `panIntoView`, `followTab`, Present mode fit):
   - Interpolates `(panX, panY, scale)` in one rAF loop (`--dur-camera`, `--curve-out` or `--curve-inout`).
   - Adds `#viewport.gesturing` (`will-change: transform`) for the duration of the glide and removes it immediately on settle so SVGs/text re-raster sharp.
   - Keeps the exact `stage.style.transform = 'translate(Xpx, Ypx) scale(S)'` string format required by `dev/e2e_touch.mjs`.
   - Any direct pointer pan, wheel scroll/zoom, touch pan/pinch, or new `animateViewport()` call invokes `cancelViewportAnim()` immediately (zero lag, seamless retargeting). Clicking `+` or `-` rapidly accumulates onto the in-flight target scale rather than resetting!

### 4.2 Export & Capture Hygiene
- Add `'motion-entering'`, `'motion-active'` to `TRANSIENT_CLASSES` (`shell.js:1204`).
- Mark `#motion-ghost-layer` and any indicator pills with `data-export-skip` so `buildExportSvg()` ignores them automatically.
- `buildExportSvg()` calls `motion.cancelAll()` before cloning styles so no mid-FLIP `transform` ever leaks into SVG/PNG exports.

---

## 5. Action-by-Action Animation Specification

Every single interactive action across the entire codebase is listed below with its exact morph/transition behavior, duration, easing, and implementation hook.

### 5.1 Shared Shell (`assets/shell/shell.js`, `shell.css`, `shell.html`)

| Action | Trigger / Hook | Morph / Animation Behavior | Timing & Easing |
|---|---|---|---|
| **Title hover / focus / inline edit** | `h1#chart-title` (`shell.js:457-481`) | Border, background, and subtle padding/ring ease smoothly; on commit, width settles smoothly without shifting `#save-status` abruptly (FLIP `#save-status`). | `120ms --curve-out` |
| **Save status badge state change** | `setStatusBadge()`, `flashStatus()` (`shell.js:560-599, 1366`) | Badge FLIP-morphs its width smoothly as label length changes (`Ready` ↔ `Unsaved changes` ↔ `Saved to …` ↔ `Copied as …`), smoothly transitions fill/ink color, and rolls incoming text `translateY(4px) → 0` inside `overflow: hidden` pill (no crossfade). | `180ms --curve-inout` |
| **Header & dock button press/hover** | `.btn`, `header .btn-icon` (`button.css`, `shell.css`) | Background/border/color ease smoothly; active press scales `scale(0.96)` (replaces raw `translateY(1px)`) and springs back on release. Disabled state smoothly dims to `0.4`. | `100ms --curve-out` |
| **Search bar open / close** | `setSearchOpen(on)` (`shell.js:1166-1197`) | Unfolds downward from `#btn-search` anchor using `clip-path: inset(0 0 100% 0 round var(--radius-lg))` + `translateY(-6px)` → full rect. Close runs ghost-retract upward into `#btn-search` while `[hidden]` toggles immediately. | Open `160ms --curve-out`, Close `110ms --curve-in` |
| **Search match highlight & step** | `applySearch()`, `stepSearch()`, `centreSearchMatch()` (`shell.js:1119-1164`) | Unmatched elements smoothly ease `.search-dim`; `.search-current` outline ring FLIP-morphs from previous match to next match when both are on screen; viewport glides via unified `animateViewport()` (replaces `.search-glide` + 400ms timer). | Dim `100ms --curve-inout`, Glide `220ms --curve-out` |
| **More / Export / Type menus open & close** | `setMoreOpen()`, `setExportOpen()`, `#btn-type` (`shell.js:1419-1465, 2173-2212`) | Unfolds from trigger button's top-right (or top-left for `#type-menu`) corner: `scale(0.92, 0.86) translateY(-4px)` + `clip-path: inset(0 0 25% 0 round var(--radius-lg))` → identity. Close toggles `[hidden]` immediately and plays a `110ms` ghost-retract back into the button. `#menu-theme` checkmark morphs via `scale` + `stroke-dashoffset`. | Open `160ms --curve-spring-tactile`, Close `110ms --curve-in` |
| **Paste Mermaid dialog & import notes** | `openMermaidImport()`, `showImportNotesBox()`, `closeMermaidImport()` (`shell.js:1506-1572`) | Unfolds from `#btn-more` anchor rect via `scale(0.94) translateY(-6px)` + `clip-path`. Validation `.confirm-error` unfolds vertically via `clip-path` + subtle `3px` horizontal nudge (`140ms`). Close removes `.confirm` synchronously and plays `110ms` ghost-retract. Imported diagram elements unfold via FLIP + `animateViewport` fit. | Open `180ms --curve-out`, Close `110ms --curve-in` |
| **Dark / Light theme switch** | `applyTheme()` (`shell.js:673-689`) | Progressive enhancement: wrap theme flip in `document.startViewTransition()` with a circular `clip-path: circle(0px at cx cy)` → `circle(maxR at cx cy)` expanding from `#btn-more` (zero crossfade!). Fallback when View Transitions unavailable: `160ms --curve-inout` transition on surface/border/text/stroke colors. | `260ms --curve-inout` (fallback `160ms`) |
| **Keyboard shortcuts help drawer** | `setHelpOpen()` (`shell.js:1088-1095`) | Unfolds from bottom-right corner (`transform-origin: bottom right`, `scale(0.92) translateY(10px)` + `clip-path`). Close removes `.open` immediately and plays `110ms` ghost-retract. *(Bonus: wire `?` keydown shortcut shown in `shell.html:52` & `help.html:5`.)* | Open `180ms --curve-spring-tactile`, Close `110ms --curve-in` |
| **Present mode enter / exit** | `setPresent(on)` (`shell.js:530-551`) | Header chrome slides smoothly upward (`translateY(-100%)`), bottom docks slide smoothly downward (`translateY(calc(100% + 24px))`), `#btn-present` FLIP-morphs from its header slot to its fixed top-right corner (`top: 12px; right: 16px`), and `fitView()` glides via `animateViewport()` into the freed canvas space. Exit reverses the exact choreography. | `220ms --curve-inout` |
| **Save flow & confirmation** | `saveToFile()`, `publishToArtifact()`, `writeFile()` (`shell.js:1908-2143`) | `#btn-save` icon subtly pulses/checks on completion; `#save-status` morphs to `Saved to …` (green fill transition); `ui.confirm` save-location prompt unfolds from `#btn-save`. | `180ms --curve-out` |
| **Dock delete & contextual buttons appear/disappear** | `refreshDeleteButton()` (`shell.js:1668-1689`), `#btn-collapse-sub`, `#btn-expand-sub`, `#btn-show-all` | Replace `dock.css` `max-width`/`padding`/`margin` animation with **dock FLIP**: capture sibling button rects in `.toolbar-center`, toggle `.show`/`[hidden]`, FLIP sibling buttons horizontally to their new slots while the appearing button scales/clips in (`scale(0.85) → 1`) and the toolbar pill background morphs width seamlessly. | `180ms --curve-spring-settle` |
| **Dock popovers (`#shape-pop`, `#uc-pop`)** | `[data-dock-pop]` (`shell.js:1609-1664`, `dock.css:58-164`) | Retune existing slow `420ms` overshoot (`1.56`) to crisp `190ms --curve-spring-tactile` unfolding from trigger button (`scale(0.82) translateY(8px)` → identity); tile stagger tightened to `15ms` delay + `150ms --curve-out` (total settle `< 260ms`, keeping `e2e_usecase.mjs` `openAdd()` fast and stable); caret rotates `180ms --curve-inout`. | Open `190ms --curve-spring-tactile`, Close `120ms --curve-in` |
| **View toggles & sliding switches** | `.btn[aria-pressed]`, `.btn-switch` (`toggle.css`) | Pressed toggle smoothly morphs background, border, text, and `.btn-count` pill (`scale(0.9 → 1)`). Switch knob slides `translateX(12px)` with subtle horizontal stretch-settle (`--curve-spring-tactile`, `180ms`) and track color transitions in sync. | `180ms --curve-spring-tactile` |
| **Zoom dock (`Undo`, `Redo`, `-`, `+`, `Fit`)** | `undo()`, `redo()`, zoom buttons (`shell.js:625-643, 1078-1086`) | Undo/Redo icons give a crisp `±12deg` directional rotation nudge on click/shortcut; diagram contents FLIP + SVG-tween to the restored snapshot! Zoom `-`/`+` and `Fit` call interruptible `animateViewport()` (retargeting seamlessly on rapid clicks). | Camera `200ms --curve-out` (`Fit`: `240ms`), Icon nudge `140ms` |
| **Direct pan, space-pan, wheel, touch pinch** | `viewport` pointer/wheel/touch (`shell.js:828-1076`) | **1:1 instant (`0ms` lag)**; calls `cancelViewportAnim()` on gesture start. `space-pan` / `.panning` toggles cursor immediately with zero stage lag. | `0ms` (direct) |
| **Shift+drag marquee box** | `startMarquee` / `moveMarquee` / `endMarquee` (`shell.js:1001-1033`) | Live resize stays 1:1 instant; on release, marquee ghost-retracts inward (`90ms`) as newly selected items pulse their selection rings (`100ms`). | Live `0ms`, Release `90ms --curve-in` |
| **Playground type switcher** | `#btn-type`, `#type-menu` (`shell.js:2173-2212`, `dev/build_playground.py`) | `#type-menu` unfolds from top-left `#btn-type`; check icon scales in on active item; add `@view-transition { navigation: auto; }` in playground CSS so switching between `flowchart`/`sequence`/`erd`/`usecase` uses native same-origin morph/slide without blank white flash. | Menu `160ms`, Navigation `200ms` |

### 5.2 Shared `ui.*` Components (`assets/components/*.css`, `shell.js:28-270`)

| Component | Trigger / Hook | Morph / Animation Behavior | Timing & Easing |
|---|---|---|---|
| **Confirm popover (`ui.confirm`)** | `ui.confirm()`, `ui.closeConfirm()` (`shell.js:107-162`) | Unfolds via `scale(0.92) translateY(4px)` + `clip-path` anchored toward its trigger element. Close removes `.confirm` synchronously and plays `110ms` ghost-retract back toward anchor. | Open `160ms --curve-spring-tactile`, Close `110ms --curve-in` |
| **Action bars (`.actionbar`, `.edge-bar`, `.lane-bar`, `.erd-actionbar`, `.seq-actionbar`, `.uc-actionbar`)** | Selection change (`drawSelectionTools`, `placeLaneBar`, `buildEdgeBar`) | **Shared-element morph:** Track the previous visible action bar rect (`lastBarRect`) across selection switches. Switching selection A → B FLIP-glides and resizes the action bar smoothly from A to B instead of popping out/in! First open unfolds cleanly in place (`clip-path: inset(0 100% 0 0 round var(--radius-lg))` for `.edge-bar` so its left edge never overlaps the arrow label during `dev/e2e_arrows.mjs`'s `80ms` check; `scale(0.94) translateY(4px)` for top-anchored bars); clear plays `100ms` ghost-retract. Button press uses `scale(0.94)`. | Morph `170ms --curve-spring-settle`, First open `140ms --curve-out` |
| **Color swatch row (`swatchRow`)** | `.swatch-btn` (`swatch.css`, `shell.js:55-86`) | Hover scales `.swatch-dot` to `1.15`; clicking moves the active ring (`[aria-pressed="true"]`) smoothly via FLIP indicator (or dot scale-pop `0.85 → 1.08 → 1`), while the target diagram element smoothly transitions its `--sw-*` surface, border, and stripe colors (`160ms`). | `140ms --curve-spring-tactile` |
| **Notes (`ui.noteCard`, anchored & free notes, `.note-badge`, `.note-leader`)** | Peek, toggle all, add, free drop, link, drag, edit, delete (`note.css`) | **Anchored notes (Badge ↔ Card morph):** Hover peek or click unfolds `.note` directly from its anchor `.note-badge` rect (`transform-origin` toward anchor, `scale(0.35) → 1` + `clip-path`, replacing the opacity-based `@keyframes note-in`) while `<line class="note-leader">` draws out from anchor to card via `stroke-dashoffset`! Closing/hiding retracts card back into its badge. **Free notes (flowchart, ERD, use case):** Always shown at rest (no badge/leader, never moved by Auto-Tidy); adding via dock/`N` with nothing selected unfolds at viewport center (`scale(0.88) → 1`), dropping on blank canvas morphs seamlessly from `.note-ghost` at the exact drop point (`dx ≈ 0, dy ≈ 0`), and dragging `.note-link` onto a step/table/use case keeps the card stationary (`<= 2px`) while the new `.note-leader` draws out and `.note-badge` scale-pops onto the target. Note drag uses `style.translate` (zero layout thrash). `.note-del` / `.note-link` chips scale-pop in on hover/select (`100ms`). `.note-linked` / `.note-target` outlines ease cleanly. | Unfold `170ms --curve-spring-tactile`, Leader `150ms --curve-out`, Close `120ms --curve-in` |
| **Frames / Collapsible chevrons** | `.frame-chev svg`, `.frame-summary` (`frame.css`) | Chevron rotates `0deg ↔ -90deg` (`180ms --curve-inout`) synchronized with the type's frame/subject collapse FLIP. | `180ms --curve-inout` |
| **Color key / Legend (`ui.colorKey`)** | `.color-key-item`, inline edit (`colorkey.css`) | New color key entries unfold smoothly (FLIP existing entries); inline `.color-key-label.is-editing` eases border/background smoothly; removing a color collapses its entry while siblings FLIP. | `170ms --curve-spring-settle` |
| **Tool hint pill (`.hint`)** | `erdHint`, `seqHint`, `flashHint`, `ucHint` (`hint.css`) | Slides up cleanly from the bottom dock edge (`translate(-50%, 10px) scale(0.96)` → `translate(-50%, 0) scale(1)`) and retracts downward via ghost-exit when dismissed. For ERD's sticky worker hint (`Laying out the diagram…`), add a subtle animated progress sheen via `transform` on a pseudo-element. | Enter `160ms --curve-out`, Exit `110ms --curve-in` |
| **Toast notification (`.toast`)** | `showToast()` (`shell.js:1311-1318`, `toast.css`) | Fixes the unimplemented fade-out comment: slides up cleanly from bottom dock (`translate(-50%, 12px) scale(0.95)` → identity) and retracts downward via `ghostExit` on timeout/replace. | Enter `170ms --curve-spring-tactile`, Exit `120ms --curve-in` |

---

### 5.3 Flowchart (`assets/types/flowchart/flowchart.js`, `flowchart.css`)

**FLIP keys:** `.swimlane[data-lane-id]`, `.flow-node[data-node-id]`, `.edge-label[data-edge-id]`, `.note[data-note-id]`, `.flow-subtabs`, `.flow-tab[data-tab]`.
**SVG tween:** `#edge-group .edge-line[data-edge-id]` (normalized polyline vertex tween when `<= 60` edges; draw-reveal fallback for massive graphs or `LR ↔ TB` topology inversions), `#note-leader-group .note-leader`.

| Action | Trigger / Hook (`flowchart.js`) | Morph / Animation Behavior | Timing & Easing |
|---|---|---|---|
| **Add shape (click dock tile)** | `addNodeAt()` (`3540`) | New `.flow-node` unfolds at target position (`scale(0.84) → 1`) while Auto-Tidy FLIPs shifted nodes/lanes and tweens edges. At nesting level 4 (`!canNest`), `#btn-add-subprocess` smoothly transitions to its disabled state (`100ms`) without shifting tiles. | `200ms --curve-spring-tactile` |
| **Add shape (drag from `#shape-pop`)** | `startPaletteDrag` / `onPaletteMove` / `onPaletteUp` (`3800-3878`) | `.palette-ghost` follows pointer 1:1 with subtle lift (`scale(1.03)`). Hovering over an insertable arrow keeps crisp `.edge-line.insert-target` march + `#insert-hint` scale-pop. **On drop:** capture `.palette-ghost`'s exact viewport rect and FLIP-morph the real `.flow-node` seamlessly from the ghost rect into its final settled slot (zero teleport jump!). | Drop settle `180ms --curve-spring-settle` |
| **Insert step / Alt-reorder into arrow** | `moveRunIntoEdge()` (`3688-3724`) | Existing edge splits open: upstream/downstream nodes FLIP apart smoothly, inserted node(s) morph from drop ghost rect into the gap, new connecting edges draw in (`stroke-dashoffset`), and a compositor-only `::after` ring pulse replaces the old `box-shadow` `@keyframes just-inserted`. | FLIP `220ms --curve-spring-settle`, Ring `420ms --curve-out` |
| **Connector tool (click or drag split)** | `splitEdge()`, `setConnectorPicking()` (`4577-4666`) | Picking mode reveals subtle canvas hint pill. Splitting an arrow morphs the split point into the outgoing/incoming connector circles (unfolding from split point) while stub edges draw cleanly. | `180ms --curve-spring-settle` |
| **Click connector → Jump to partner** | `jumpToPartner()` (`747-769`) | Migrated to unified `animateViewport()` (interruptible!). Destination partner circle plays the upgraded compositor-only `::after` expanding ring (replacing `box-shadow` `@keyframes connector-pulse`). | Camera `240ms --curve-inout`, Ring `550ms --curve-out` |
| **Drag node(s) (single & multi-select)** | `onDragNodeMove` / `onDragNodeUp` (`2838-3081`) | Switch live drag from `style.left/top` to GPU `style.translate` (zero layout thrash!) + subtle `scale(1.02)` lift on dragged node(s). Snap guides (`#snap-guide-v`, `#snap-guide-h`) scale out along their axis (`scaleY`/`scaleX`, `90ms`). Lane `.drag-hover-lane` wash transitions smoothly (`100ms`). On drop: dragged node settles down to `scale(1)` from exact release point while Auto-Tidy FLIPs any rearranged siblings & tweens edges. | Live `0ms`, Drop settle `200ms --curve-spring-settle` |
| **Keyboard reorder (`Alt+Arrow`)** | `shiftRunAlongFlow`, `shiftSelectionLanes` (`3728-3749`) | FLIPs all swapped nodes and tweens connecting edges smoothly (with rapid-action compression when holding `Alt+Arrow`). | `180ms --curve-spring-settle` |
| **Node hover, anchor points (`.port`), & edge hover highlights** | `applyNodeHover()`, edge hover (`2725-2769`) | `.hl-in` / `.hl-out` / `.hover` strokes, labels, and `.pair-lit` ease smoothly (`100ms`). `.connector-guide` dashed sightlines draw out smoothly (`120ms`). `.port` handles scale-pop from `0.55 → 1` (`110ms --curve-spring-tactile`) **on `.flow-node:hover` only** (keeping `.flow-node.selected .port` strictly inside `@media (hover: none)` to satisfy `dev/e2e_arrows.mjs`). Unlabelled arrows draw nothing at rest or on hover. | `100–120ms --curve-out` |
| **Node select, multi-select, inline rename, delete** | `selectNode`, `dblclick`, `deleteNode(s)`, `askSubDelete` (`1016, 3325, 3454`) | Selection border/ring transitions cleanly (`100ms`). Inline rename smoothly adjusts box geometry via FLIP if label wraps or terminal dot morphs. Deleting a non-empty subprocess opens 3-button `ui.confirm` (`Merge into parent` / `Delete everything` / `Cancel`) unfolding from the step; plain/empty delete plays `110ms` ghost-shrink while remaining nodes/lanes FLIP on Auto-Tidy. | Select `100ms`, Delete FLIP `200ms` |
| **Edge draw, select, arrow toolbar (`.edge-bar`), reconnect, label edit, delete** | `startConnecting`, `startReconnect`, `selectEdge`, `buildEdgeBar`, `deleteEdge` (`824, 3084-3489`) | Rubber-band `#drag-edge` tracks 1:1; `.connect-target` ring eases smoothly (`100ms`). Created/reconnected edge draws in via `stroke-dashoffset` (`140ms`). Selecting an arrow scale-pops `.edge-end-handle` circles (`110ms`) and unfolds the shared `.actionbar.edge-bar` (`split`, `label`, `delete`) via left-to-right `clip-path` beside the midpoint/label (or FLIP-morphs from previous `.edge-bar`/`.lane-bar`; hides immediately on `.editing`, `.reconnecting`, `.presentation`, `.capture`). Double-clicking the arrow or clicking `Label` unfolds `.edge-label.empty-placeholder.editing` at midpoint (`140ms`). Clicking `Connector` when joinable letters exist unfolds `.edge-split-menu` downward from the button. Delete retracts line (`100ms`). | `100–150ms --curve-out` |
| **Lanes: select, color, rename, reorder, add, delete, hide/show** | `selectLane`, `setLaneColor`, `moveLane`, `deleteLane`, `#btn-add-lane` (`228-527, 3283, 3905`) | `.lane-bar` unfolds / FLIP-morphs from previous lane bar. Color change transitions lane wash, stripe, and pill colors (`160ms`). Drag/button reorder (`moveLane`) FLIPs every `.swimlane` and its `.flow-node`s smoothly along the cross-axis (`#lane-drop-line` scales in along X/Y). Adding a lane unfolds it while siblings FLIP; deleting or hiding swimlanes FLIPs remaining lanes/nodes smoothly. Pinned `.lane-rail` / `.lane-pill` stickiness stays 1:1 with pan/zoom. | `210ms --curve-spring-settle` |
| **Direction toggle (`LR ↔ TB`)** | `#btn-direction` (`3934-3945`) | Captures every node & lane rect before flipping direction, re-layouts, FLIP-glides all nodes to their transposed coordinates, reveals re-routed edges cleanly via `stroke-dashoffset`, and glides camera with `animateViewport` fit! | `260ms --curve-spring-settle` |
| **Subprocess nested folder tabs (up to 4 levels), switch, `Alt+Up`, & tab context menu** | `renderTabs`, `switchTab`, `.sub-open`, `openTabMenu`, `deleteSubprocessTab` | Nested `.flow-subtabs` folder boxes unfold horizontally via `clip-path` + FLIP when drilling deeper (levels 1→4) and fold back cleanly when clicking an outer tab or pressing `Alt+Up`! The filled active chip (`[aria-selected="true"]`) FLIP-glides between tabs (`160ms --curve-inout`). Clicking `.sub-open` on a subprocess step captures that step's rect and zooms/unfolds the child flow outward from it, gliding to saved `tabViews` via `animateViewport`. Right-clicking (or `Shift+F10` / Menu key on) any subprocess tab unfolds `.menu.tab-menu` (`Delete`) from the pointer/tab (`140ms --curve-spring-tactile`; closes synchronously with ghost-retract); clicking `Delete` transitions to the parent flow, selects the step, and unfolds the 3-button `ui.confirm` anchored to the tab! | Tab morph `160–210ms`, Context menu `140ms` |
| **Collapse to subprocess & Expand / Merge into parent** | `collapseToSubprocess`, `expandSubprocess`, `confirmDeleteSub` | **Hero morph:** On Collapse, capture all N selected node rects → render → ghost-fly those N nodes inward into the new `.type-subprocess` node's bounding box while surrounding nodes FLIP into the compacted flow and the new child tab unfolds inside `#flow-tabs`! On Expand (or `Merge into parent` from delete confirm), capture the `.type-subprocess` node's rect → render → FLIP-unfold all expanded child nodes outward from that subprocess box into their new parent coordinates while surrounding nodes FLIP apart and any nested grandchild tabs promote cleanly one level up in `#flow-tabs`! | `240ms --curve-spring-settle` |
| **Notes (anchored & free), Auto-Tidy, Undo/Redo, Paste Mermaid** | `applyNoteVisibility`, `addFreeNote`, `relayout`, `undo`/`redo`, `fromMermaid` | Anchored notes use shared badge↔card morph; free notes unfold at viewport center or drop point, stay stationary (`<= 2px`) on Auto-Tidy, and draw a new leader + badge when linked (`§5.2`). Auto-Tidy, Undo/Redo, and Paste Mermaid run full-canvas FLIP + SVG edge tween. | `220ms --curve-spring-settle` |

---

### 5.4 Sequence (`assets/types/sequence/sequence.js`, `sequence.css`)

**FLIP keys:** `.seq-participant[data-node-id]`, `.seq-msg-label[data-edge-id]`, `.seq-msg-detail[data-edge-id]`, `.frame-tag[data-frag-id]`, `.frame-summary[data-frag-id]`, `.seq-frag-branch-label[data-frag-id][data-at]`, `.note[data-note-id]`, `.color-key-item[data-color]`.
**SVG tween:** `.seq-lifeline[data-node-id]` & `.seq-cap[data-node-id]` (`x`, `y1`, `y2`), `.seq-activation[data-node-id][data-mid]` (`x`, `y`, `height`), `.seq-line[data-edge-id]` (`d` endpoints + self-loop), `.seq-frag-box[data-frag-id]` (`x`, `y`, `width`, `height`), `.seq-frag-else` (add `data-frag-id` & `data-at` so dividers tween smoothly along Y!).

| Action | Trigger / Hook (`sequence.js`) | Morph / Animation Behavior | Timing & Easing |
|---|---|---|---|
| **Add participant (dock or `.seq-insert` `+`)** | `insertParticipant()` (`1907, 1442`) | Hovering header row smoothly reveals `.seq-insert` `+` buttons (`scale(0.6 → 1)`, `110ms`). Inserting unfolds the new participant pill from the `+` spot while existing participants, lifelines, messages, and fragments FLIP right synchronously. | `210ms --curve-spring-settle` |
| **Delete participant** | `deleteParticipant()` (`1857-1864`) | `ui.confirm` unfolds if participant has messages. On delete, removed participant/messages play quick `110ms` ghost-retract while remaining columns and rows FLIP closed cleanly. | `210ms --curve-spring-settle` |
| **Drag participant (reorder or share column)** | `participantDrag()`, `shareColumn()` (`854-882, 765-779`) | Live horizontal `translate` stays 1:1 with subtle `scale(1.02)` lift; `#seq-drop-line` scales along Y (`90ms`); target lifeline `.is-target` eases cleanly. On drop, all participants, lifelines, activation bars, and message horizontal spans FLIP/tween smoothly into the reordered or shared column! | Live `0ms`, Drop FLIP `210ms --curve-spring-settle` |
| **Rename, change kind, swatch color** | `beginEdit`, `pkind`, `setParticipantColor` (`781, 1363, 1542`) | Rename FLIPs neighbor columns if pill width grows. Kind switch morphs icon (`scale(0.75 → 1)`) and border style (`solid ↔ dashed` for `external`). Color change smoothly transitions pill, lifeline, cap, activation bars, and unfolds any new `.seq-key` entry. | `160ms --curve-inout` |
| **Lifespans toggle & `pstart`/`pend` handles** | `#btn-lifespans`, `handleDrag` (`1130-1159, 2065`) | Toggling `#btn-lifespans` or dragging `pstart`/`pend` handles smoothly tweens `.seq-lifeline` `y1/y2` and slides `.seq-cap` into place (pistoning cleanly rather than snapping). Unsharing (`own`) splits stacked participants horizontally via FLIP. | `210ms --curve-spring-settle` |
| **Add / draw message (dock, lifeline, `.seq-plus`, activation bar)** | `#btn-add-message`, `onCanvasHover`, `connectDrag` (`952-1015, 1915`) | Hovering lifelines smoothly glides `.seq-plus` dot to the nearest `rowSlot` (`transform`, `90ms --curve-out`) instead of jumping! Drag draws 1:1 `#seq-rubber` + `.is-target` glow. On drop/add: lower messages, notes, activation bars, and frame bottoms FLIP smoothly downward to make room while the new message arrow draws from `from` → `to` via `stroke-dashoffset` (`140ms`) and its label unfolds! | Row FLIP `200ms`, Arrow draw `140ms --curve-out` |
| **Select / range-select / marquee / keyboard walk** | `select`, `selectRange`, `marqueeDrag`, arrows (`609, 1234, 2084`) | `.seq-actionbar` FLIP-morphs between selections; `.seq-handle` endpoint/edge knobs scale-pop in (`100ms`). Selecting a participant smoothly dims non-touching messages (`.is-dim`, `110ms --curve-inout`); selecting a message highlights `.linked` participants (`100ms`). | `100–170ms` |
| **Drag reorder message & `Alt+Up/Down`** | `messageDrag`, `moveMessage` (`915-942, 2096`) | Live vertical `translate` stays 1:1 + `#seq-drop-line` scaleX reveal. On drop or `Alt+Up/Down`, all shifted messages, notes, activation bars, and enclosing frame heights FLIP/tween smoothly along Y! | `190ms --curve-spring-settle` |
| **Retarget message (`from`/`to` handles)** | `handleDrag` (`1078-1094`) | Rubber-band tracks 1:1; on drop, the message arrow smoothly tweens horizontally to its new endpoint and its label FLIPs to the new midpoint while activation bars adjust cleanly. | `180ms --curve-spring-settle` |
| **Message actions (`sync↔async`, `activate`, `resetbar`, `reverse`, `reply`, `delete`)** | Message actionbar (`1330-1513`) | `reverse` swaps arrow direction with a crisp directional sweep (`140ms`) while label stays anchored. `activate`/`resetbar` smoothly grows/shrinks the `.seq-activation` rect height from the message Y! `reply` makes room via FLIP and draws the dashed reply arrow back (`140ms`). `delete` retracts arrow and closes the vertical gap via FLIP. | `160–200ms` |
| **Edit message label & detail (`Tab` to detail)** | `editMessage`, `editDetail` (`1577-1604`) | Opening `.seq-msg-detail.is-editing` unfolds smoothly beneath the label while rows below FLIP down gently if height expands. | `160ms --curve-out` |
| **Activation bar manual drag (`barend`)** | `hoverBarHandle`, `setBar` (`1050-1129`) | `.seq-barend` handle scales in on bar hover (`100ms`); drop smoothly tweens `.seq-activation` height to the snapped message row. | `160ms --curve-spring-settle` |
| **Fragments: wrap, dock-drag, resize, kind/color, branch add/drag/delete** | `dockDrag`, `handleDrag`, `addBranch`, `dividerDrag` (`1095, 1214, 1515, 1979`) | Dropping dock `#btn-frame` morphs `.seq-frame-ghost` directly into `.seq-frag-box`! Resizing `top`/`bottom` handles or dragging a branch divider smoothly tweens the frame box/divider line and FLIPs pushed labels/notes. Changing `kind` morphs `.seq-frag-kind` pill width; changing color smoothly transitions `.swatch-scope` tint/border. | `190ms --curve-spring-settle` |
| **Collapse / Expand frame** | `toggleCollapsed()` (`1728-1733`) | **Hero morph:** Frame chevron rotates `-90deg`, `.seq-frag-box` folds vertically down to `.frame-summary` height while inner messages ghost-fold upward into the frame tag and all rows/frames below FLIP upward! Expanding unfolds `.seq-frag-box` downward and FLIP-reveals inner messages out from the tag. | `220ms --curve-spring-settle` |
| **Focus frame & Show All (Rails morph!)** | `focusFrame()`, `showAll()`, `data-act="show"` (`1758-1782`) | **Signature choreography:** Simultaneously folds other top-level frames, **FLIP-morphs unused participants from full pills into 36px vertical `.is-rail` strips** (and lifelines slide to compact spacing), FLIPs the focused frame cleanly, and glides camera via `animateViewport`! `Show All` reverses every rail back into full participant pills and unfolds all frames. Works smoothly in Presentation mode too! | `250ms --curve-spring-settle` |
| **Notes: add, dock-drag, move, stretch across lifelines, edit, delete** | `noteDrag`, `handleDrag` (`stretch`), `dockDrag` (`1161-1211, 1947`) | Drop morphs `.seq-dock-ghost` into `.note`. Vertical drag FLIPs surrounding messages; dragging `.seq-stretch` smoothly FLIP-morphs `.note` width across the two spanned lifelines! | `180ms --curve-spring-settle` |
| **Toolbar toggles (`#btn-numbers`, `#btn-details`, `#btn-lifespans`), Tidy, Undo/Redo, Search** | `2061-2073`, `shell.js` | `#btn-numbers` unfolds `.seq-msg-num` badges while label text shifts smoothly. `#btn-details` folds/unfolds all `.seq-msg-detail` rows while messages/lifelines/frames FLIP vertically in sync! Fix `searchItems()` to match `.frame-tag` so search highlights & glides to fragments too. | `200ms --curve-spring-settle` |

---

### 5.5 ERD (`assets/types/erd/erd.js`, `erd.css`)

**FLIP keys:** `.erd-entity[data-node-id]`, `.erd-row[data-col]` (scoped by parent table id), `.edge-label[data-edge-id]`, `.note[data-note-id]`, `.color-key-item[data-color]`.
**SVG tween:** `.erd-rel[data-edge-id] .edge-line` (exact 8-float cubic Bezier `[P0..P3]` interpolation — relationships bend like smooth elastic wires attached to moving tables and rows!), `#erd-note-leaders .note-leader`.

| Action | Trigger / Hook (`erd.js`) | Morph / Animation Behavior | Timing & Easing |
|---|---|---|---|
| **Add table (click or dock drag)** | `addTable()`, `onTableToolMove`/`Up` (`2007, 2269-2329`) | Drag `.erd-ghost` follows 1:1 with subtle lift; drop FLIP-morphs directly from `.erd-ghost`'s exact rect into the new `.erd-entity` (zero jump) while any overlap-pushed neighbor tables FLIP clear and their Bezier curves bend smoothly! Click-add unfolds at placed spot and glides into view via `animateViewport`. | `200ms --curve-spring-tactile` |
| **Select, multi-select, marquee, arrow walk** | `selectEntity`, `setEntitySelection`, `selectCol`, arrows (`577-636, 2430`) | Selection outline eases (`100ms`). `.erd-actionbar` FLIP-morphs smoothly between table bar, column bar, and relationship bar! Multi-select hides ports smoothly (`100ms`) and FLIP-reveals `#btn-delete-selection` with updated `Delete N` count. | `100–170ms` |
| **Drag table(s) (single & multi)** | `entityDrag()` (`1651-1684`) | Already uses `style.translate` (keep 1:1 instant!). Add subtle `scale(1.015)` lift while dragging and axis-scaled snap guides (`.erd-guide-v`/`.erd-guide-h`, `90ms`). On drop: dragged table settles smoothly (`dx = 0` unless overlap-pushed, preserving `e2e_erd.mjs` exact-drop checks!), while pushed neighbors FLIP clear and Bezier curves bend cleanly to their final anchors! | Live `0ms`, Settle `190ms --curve-spring-settle` |
| **Rename table & swatch color** | `editEntityName`, `setEntityColor` (`1442, 1773`) | Inline edit eases border/bg (`100ms`); width growth FLIPs neighbor overlaps if `erdSettled` shifts them. Swatch color smoothly transitions header fill, border, accent stripe, and unfolds `.erd-key` if named. | `160ms --curve-inout` |
| **Per-table Collapse / Expand** | `toggleCollapsed()` (`735-743`) | **Morph:** `.erd-chevron` rotates `-90deg`; `.erd-entity` smoothly folds its height via FLIP + `clip-path` down to header-only while all connected Bezier endpoints slide smoothly from hidden column rows up onto the table header! Expanding reverses smoothly. | `200ms --curve-spring-settle` |
| **Delete table(s)** | `deleteEntities()` (`2026-2040`) | `ui.confirm` unfolds if incident relationships exist. Deleted table(s) ghost-shrink (`110ms`) while incident Beziers retract cleanly. | `120ms --curve-in` |
| **Columns: add, select, edit name/type/note, flags (`PK`/`FK`/`U`/`?`), reorder, delete** | `addColumn`, `editColumn`, `toggleFlag`, `rowDrag`, `moveColumnBy`, `deleteColumn` (`1687-1980`) | Adding a column unfolds the new `.erd-row` inside the table while lower rows and lower-anchored Beziers glide down (`170ms`). Toggling `PK`/`FK`/`U`/`?` scale-morphs the glyph/badge (`120ms`) and smoothly updates FK color. Dragging a row uses 1:1 `translate` + `.erd-drop-line` scaleX reveal; dropping or `Alt+Up/Down` **FLIPs rows within the table AND bends any Bezier anchored to the moved column smoothly to its new row Y!** Deleting collapses the row and FLIPs lower rows up. | `160–190ms --curve-spring-settle` |
| **Columns detail cycle (`All → Keys → Names`)** | `#btn-columns`, `resizeLayout` (`832-842`) | **Hero morph:** Every `.erd-entity` smoothly morphs height via FLIP + `clip-path` (preserving visible PK/FK rows in place as non-key rows fold away, or folding into header-only for `Names`), `+ N more` footer unfolds cleanly, `erdSettled` overlap shifts FLIP tables smoothly, all Bezier curves bend to their new row/header anchors, and `fitView()` glides via `animateViewport`! | `230ms --curve-spring-settle` |
| **Types switch (`#btn-types`)** | `#btn-types` (`843-846`) | Table widths smoothly FLIP-morph as `.erd-col-type` collapses/expands, overlap-resolved neighbors glide clear, and Bezier endpoints track table edges smoothly. | `200ms --curve-spring-settle` |
| **Overview zoom threshold (`scale < 0.5 ↔ > 0.6`)** | `erdUpdateOverview()` (`645-720`) | Crossing threshold smoothly morphs `.erd-name` into its centered scaled overview title (FLIP) while body rows fold cleanly via `clip-path` (`160ms`, disabled during active pinch/wheel frames so zooming stays 60/120fps and triggers cleanly on threshold cross!). | `160ms --curve-inout` |
| **Overview expand card & Zoom to table** | `erdSyncCard()`, `erdZoomToTable()` (`697-732`) | **Hero shared-element morph:** Clicking a miniature table in overview FLIP-morphs `.erd-expand-card` directly *out of* that miniature `.erd-entity`'s screen rect to its 100%-scale floating position! Dismissing morphs it back into the miniature table. Double-clicking calls `animateViewport()` to smoothly zoom into 100% centered on the table while the card morphs seamlessly into the live table! | Card morph `190ms --curve-spring-tactile`, Zoom `240ms --curve-out` |
| **Relationships: arm, draw, select, cardinality, identifying, reverse, reconnect, label edit, delete** | `setRelArmed`, `connectDrag`, `handleDrag`, `reverseRelationship`, `editRelLabel` (`1546-1876, 2237`) | Arming `#btn-add-relationship` subtly highlights `.erd-port` dots (`scale(1.15)`). Drawing renders 1:1 `#erd-rubber` + `.erd-target` row highlight; drop draws the routed Bezier via `stroke-dashoffset` (`140ms`). Selecting scale-pops the 2 `.erd-handle` circles along the curve (`110ms`). Reconnecting tweens the Bezier smoothly from old route to new route (`180ms`). `identifying` transitions solid/dashed cleanly; `reverse` plays a brief directional emphasis pulse along the curve while swapping markers; label edit unfolds `.edge-label` at curve midpoint. | `110–180ms` |
| **Hover / Selection neighbourhood focus** | `applyHighlight()` (`488-555`) | Keep snappy **`100ms --curve-inout`** on `.hl-in`, `.hl-out`, `.rel-parent`, `.rel-child`, `.key-hl`, `.is-dim` (explicitly finishes inside `e2e_erd.mjs:997`'s `120ms` sleep window!). | `100ms --curve-inout` |
| **Notes (anchored & free), Color key, Auto-Tidy (sync & Web Worker), Undo/Redo, Paste Mermaid** | `addFreeNote`, `erdStartJob`/`erdFinishJob`, `placeImported`, `undo`/`redo` | **Worker settle hero moment:** When `>= 12`-table async worker finishes, instead of snapping from provisional grid (or previous layout) to final layout, **FLIP every table + bend every Bezier simultaneously** into the solved layout (`260ms --curve-spring-settle`) and glide `fitView()`! Sync Tidy, Undo/Redo, and Paste Mermaid use the same FLIP + Bezier tween. Anchored notes use shared badge↔card morph; free notes (`entities: []`, absolute `pos`) unfold at viewport center or drop point, stay stationary (`<= 2px`) on Tidy, and draw a leader + badge in place when linked (`§5.2`). | `220–260ms --curve-spring-settle` |

---

### 5.6 Use Case (`assets/types/usecase/usecase.js`, `usecase.css`)

**FLIP keys:** `.uc-actor[data-node-id]`, `.uc-case[data-node-id]`, `.uc-subject[data-subject-id]`, `.uc-label[data-edge-id]`, `.note[data-note-id]`.
**SVG tween:** `.uc-link[data-edge-id] .edge-line` & `.uc-parent[data-from][data-to] .edge-line` (cubic Bezier / straight-segment interpolation), `#uc-note-leaders .note-leader`.

| Action | Trigger / Hook (`usecase.js`) | Morph / Animation Behavior | Timing & Easing |
|---|---|---|---|
| **Add Actor / System / Use Case / Subject (dock click or drag)** | `wireTool()`, `addActor`, `addCase`, `addSubject` (`1164-1230, 1677-1743`) | Drag `.uc-ghost` follows 1:1 with subtle lift; hovered subject eases `.drop-target` highlight (`100ms`). On drop: FLIP-morph directly from `.uc-ghost`'s exact rect into the new actor/use case/subject while Auto-Tidy FLIPs shifted siblings and bends connected links smoothly! | `190ms --curve-spring-tactile` |
| **Draw-out new Use Case from port onto blank subject** | `drawOutCase()` (`1149-1156`) | New `.uc-case` unfolds directly from the pointer release point (`scale(0.82) → 1`) while the new association line draws from the source port via `stroke-dashoffset` (`140ms`). | `180ms --curve-spring-tactile` |
| **Select, multi-select, marquee, spatial arrow walk** | `selectItem`, `toggleItem`, `selectInRect`, `walk` (`416-437, 1794, 1902`) | Selection border/ring eases (`100ms`). `.uc-actionbar` FLIP-morphs across items (`itemBar` ↔ `multiBar` ↔ `subjectBar` ↔ `linkBar`). Spatial arrow walking smoothly transitions selection ring & focus reach. | `100–170ms` |
| **Drag actor / use case** | `itemDrag()`, `keepOutside()` (`1034-1083`) | Live drag keeps 1:1 `style.translate` + `liveDrag` rAF link routing + subtle `scale(1.02)` lift + subject `.drop-target` wash. On drop: if `keepOutside` pushes an actor clear of a boundary, or `side` flips, or Auto-Tidy runs, FLIP-glide to final position & bend links smoothly! | Live `0ms`, Settle `200ms --curve-spring-settle` |
| **Rename, edit/add extension points, actor kind, use case level, color, move to subject** | `editName`, `addPoint`, `itemBar`, `setColor`, `moveToSubject` (`1289-1348, 1556-1620`) | Renaming or adding `.uc-ep` FLIP-morphs `.uc-shape` pill dimensions cleanly. Switching actor `kind` (`human`/`system`/`time`) scale-morphs the `.uc-figure` icon and unfolds/folds `.uc-kw` (`«system»`/`«time»`). Switching `level` (`user` ↔ `subfunction`) morphs `.uc-shape` size/border smoothly. `moveToSubject` FLIPs selected use cases across boundaries while both subjects resize smoothly! Color change transitions `.swatch-scope` fills/strokes. | `170–210ms --curve-spring-settle` |
| **System boundaries (`subjects`): select, resize, collapse/expand, rename, delete** | `resizeDrag`, `toggleCollapsed`, `deleteSubject` (`1018, 1251, 1296`) | Live resize stays 1:1 via `liveDrag`; on drop, any actors pushed outward by `keepOutside` FLIP smoothly clear. **Collapse / Expand hero morph:** `.frame-chev` rotates `-90deg`, `.uc-subject` smoothly FLIP-morphs height/bounds while member use cases ghost-converge into the collapsed header (or unfold outward on expand!) and connected lines/actors FLIP into the compacted layout. | `220ms --curve-spring-settle` |
| **Relationships: draw, select, type (`association`/`include`/`extend`), navigable, reverse, condition, extension point, delete** | `connectDrag`, `connectItems`, `setLinkType`, `reverseLink`, `openMenu` (`1086-1147, 1327-1376, 1506-1539`) | Rubber-band tracks 1:1 + `.uc-target` ring (`100ms`). New association / include / generalization draws in via `stroke-dashoffset` (`140ms`). Switching `type` transitions solid↔dashed and unfolds `.uc-label` (`«include»`/`«extend»`); auto-reversing `include ↔ extend` plays a crisp directional stroke pulse along the reversed line. `.uc-menu` extension-point picker unfolds from button anchor. Inline `.uc-cond` unfolds smoothly. | `120–170ms` |
| **Selection focus reach (`applyFocus`)** | `applyFocus()` (`488-516`) | Unreached items/lines smoothly ease `.is-dim` (`110ms --curve-inout`) while reached paths highlight `.hl` (`100ms`). **Preserve `e2e_usecase.mjs:368` invariant:** hovering an actor or use case still dims nothing! | `110ms --curve-inout` |
| **Dock switches (`#btn-refs`, `#btn-levels`, `#btn-notes`, `#btn-auto-layout`) & Free Notes** | `567-574`, `addFreeNote` | `#btn-refs` unfolds `.uc-refs` pill row below use cases while layout FLIPs (`190ms`). `#btn-levels` folds `subfunction` use cases cleanly into their parent/base (or shrinks out) while remaining items/subjects/links FLIP smoothly (`220ms`). `#btn-notes` toggles anchored notes via shared badge↔card morph while free notes remain visible at rest; free notes unfold at center/drop point, stay stationary (`<= 2px`) on Tidy, and draw a leader + badge in place when linked (`§5.2`). Toggling `#btn-auto-layout` on runs full-canvas FLIP + link tween. | `190–220ms --curve-spring-settle` |
| **Plugin search (`#uc-search`) & Shell search, Auto-Tidy, Undo/Redo, Paste Mermaid, Present** | `518-555`, `shell.js` | `#uc-search` count & clear/fit buttons unfold cleanly via FLIP inside `.uc-search`; `fitToMatches()` migrates to unified `animateViewport()`! Auto-Tidy, Undo/Redo, and Paste Mermaid run full-canvas FLIP + Bezier tween. Presentation mode keeps interactive click-focus, arrow walk, and subject collapse animated. | `200–240ms` |

---

## 6. Phased Implementation Plan

Build in five small, independently testable phases so every PR stays reviewable and every E2E suite stays green.

### Phase 1 — Tokens, Shared Motion Kernel & Performance Fixes
- **Files:** `assets/tokens/default.json`, `scripts/tokens.py`, `assets/shell/shell.css`, `assets/shell/shell.js`, `assets/components/dock.css`, `assets/components/toast.css`, `assets/components/hint.css`, `assets/components/popover.css`, `assets/components/toggle.css`, `assets/components/button.css`, `assets/components/badge.css`, `assets/components/search.css`, `assets/components/note.css`, `assets/components/actionbar.css`, `assets/components/swatch.css`, `assets/components/colorkey.css`.
- **Deliverables:**
  1. Widen `_TIME` validator in `scripts/tokens.py` and add the motion tokens (`--dur-*`, `--curve-*`) to `assets/tokens/default.json`.
  2. Implement `motion` kernel (`enabled`, `speedScale`, `capture`/`play` FLIP, `morphRect`, `ghostExit`, `tweenSvg`, `drawPath`) and unified `animateViewport` / `cancelViewportAnim` in `assets/shell/shell.js`.
  3. Wire all Shell & Shared Component animations (`§5.1` and `§5.2`), including retuning `dock.css` popovers, replacing `#btn-delete-selection` `max-width` transition with dock FLIP, implementing `.toast` & `.hint` morphs, Present-mode choreography, View-Transition theme reveal, and shared `.actionbar` morphing.
  4. Wire Playground `@view-transition { navigation: auto; }` and `#type-menu` unfold (`dev/build_playground.py`).

### Phase 2 — Flowchart Motion & Drag Upgrade
- **Files:** `assets/types/flowchart/flowchart.js`, `assets/types/flowchart/flowchart.css`.
- **Deliverables:**
  1. Upgrade live node drag and note drag from `style.left/top` to GPU `style.translate`; replace `box-shadow` `@keyframes connector-pulse` / `just-inserted` with compositor-only `::after` ring animations; remove hover/drag SVG `filter: drop-shadow` thrash.
  2. Wrap `relayout()`, `moveLane()`, `moveRunIntoEdge()`, `collapseToSubprocess()`, `expandSubprocess()`, `deleteNode(s)`, `#btn-direction`, `undo`/`redo`, and `fromMermaid` with `motion.capture`/`play` + `motion.tweenSvg` (leaving free notes stationary).
  3. Add shared-element morphs: `.palette-ghost` → `.flow-node`, Collapse/Expand (`Merge into parent`) subprocess convergence/unfold, 4-level nested `.flow-subtabs` fold/unfold + sliding active chip + `.sub-open` zoom-into-child, `.edge-bar` left-edge clip unfold (preserving `e2e_arrows.mjs` non-overlap & hover-only `.port` media rule), `.tab-menu` & 3-button subprocess delete confirm unfolds, `jumpToPartner` on unified `animateViewport`, and anchored/free note morphs.

### Phase 3 — Sequence Motion & Focus/Rail Choreography
- **Files:** `assets/types/sequence/sequence.js`, `assets/types/sequence/sequence.css`.
- **Deliverables:**
  1. Add `data-frag-id` & `data-at` to `.seq-frag-else` lines (and fix `searchItems()` `.seq-frag-label` → `.frame-tag` mismatch).
  2. Wrap `relayout()`, `toggleCollapsed()`, `focusFrame()`, `showAll()`, `insertParticipant()`, `deleteParticipant()`, `moveMessage()`, `setBar()`, `handleDrag`, `#btn-numbers`, `#btn-details`, `#btn-lifespans`, `undo`/`redo` with `motion.capture`/`play` + `motion.tweenSvg` (lifelines, caps, activation bars, message arrows, fragment boxes, branch dividers).
  3. Add `.seq-plus` smooth slot gliding, new-message `stroke-dashoffset` draw-in, `.seq-frame-ghost` / `.seq-dock-ghost` drop morphs, and the Focus-mode rail + frame simultaneous collapse/expand choreography.

### Phase 4 — ERD Motion, Bezier Elastic Tweening & Overview Card Morph
- **Files:** `assets/types/erd/erd.js`, `assets/types/erd/erd.css`.
- **Deliverables:**
  1. Wrap `commit()`, `resizeLayout()`, `toggleCollapsed()`, `erdFinishJob()` (async Web Worker!), `placeImported()`, `undo`/`redo`, and column add/reorder/delete with `motion.capture`/`play` + 8-float Bezier `motion.tweenSvg`.
  2. Wire `.erd-ghost` drop morph, `All ↔ Keys ↔ Names` & `#btn-types` height/width `clip-path` morphs, overview threshold morph, `.erd-expand-card` shared-element morph out of the miniature table, and `erdZoomToTable` on `animateViewport`.
  3. Keep `applyHighlight()` at `100ms` so `e2e_erd.mjs:997` passes comfortably.

### Phase 5 — Use Case Motion, Verification & Playground Republish
- **Files:** `assets/types/usecase/usecase.js`, `assets/types/usecase/usecase.css`, `dev/e2e_*.mjs` (new motion assertions + any timing adjustments).
- **Deliverables:**
  1. Wrap `commit()`, `toggleCollapsed()`, `moveToSubject()`, `#btn-refs`, `#btn-levels`, `undo`/`redo`, and `fromMermaid` with `motion.capture`/`play` + Bezier `motion.tweenSvg`.
  2. Wire `.uc-ghost` & `drawOutCase` drop morphs, subject collapse/expand convergence morph, link `stroke-dashoffset` draw-in, `fitToMatches` on `animateViewport`, and `.uc-actionbar` morphing.
  3. Run full test, lint, visual, and performance verification (`§7`), then rebuild and republish the Playground artifact (`https://claude.ai/artifact/Ny25B5E4ts4TramawB4BQp`).

---

## 7. Verification & Performance Audit Plan

1. **Automated lint & contract gates:**
   - `python dev/check_tokens.py` (verifies all new motion tokens & zero forbidden literal declarations/shadows).
   - `python dev/check_artifact_shape.py` (verifies claude.ai split artifacts still match platform skeleton and `ALLOWED_EXTERNAL` allows only Google Fonts).
   - Full Python layout/unit tests (`pytest` / `dev/` scripts) and all E2E suites (`dev/e2e_shell.mjs`, `dev/e2e_flowchart.mjs`, `dev/e2e_arrows.mjs`, `dev/e2e_connectors.mjs`, `dev/e2e_notes.mjs`, `dev/e2e_subprocess.mjs`, `dev/e2e_sequence.mjs`, `dev/e2e_erd.mjs`, `dev/e2e_usecase.mjs`, `dev/e2e_search.mjs`, `dev/e2e_theme.mjs`, `dev/e2e_touch.mjs`, `dev/e2e_mermaid.mjs`, `dev/e2e_playground.mjs`), verifying `#32` invariants (`.port` hover-only media rule, `.edge-bar` non-overlap within `80ms`, zero `+` placeholder, `.tab-menu` immediate close, and free-note `<= 2px` stationary Tidy/link checks).
2. **New dedicated E2E motion checks (`dev/e2e_motion.mjs`):**
   - **Zero leak into exports / `?capture`:** Trigger FLIP/morph/toast/popover, run `buildExportSvg()` and `?capture` render, assert zero `data-motion-ghost` nodes, zero mid-flight inline transforms, and `diagramSettled === '1'` without delay.
   - **Reduced-motion obedience:** Emulate `prefers-reduced-motion: reduce`, assert `motion.enabled() === false` and zero WAAPI animations created on Tidy/Undo/Tab/Collapse.
   - **Interruption safety:** Fire 5 rapid `Ctrl+Z` / zoom-in / tab-switch events spaced `30ms` apart; assert final bounding rects match settled layout within `< 1px` and zero orphan ghosts remain after `400ms`.
   - **Direct-manipulation 0ms invariant:** Assert `e2e_touch.mjs` 1:1 pan delta `< 2px` and `stage.style.transform` regex contract remain unbroken.
3. **Runtime frame-rate & main-thread check (Chrome DevTools):**
   - Record Performance traces on medium/large fixtures (e.g., 30-node flowchart Auto-Tidy & Collapse/Expand, 20-message sequence Focus/Rails, 15-table ERD `All ↔ Keys ↔ Names` & Worker Tidy, UseCase subject collapse) at `4×` CPU throttle.
   - Verify zero forced synchronous layout warnings during animation frames, zero per-frame `box-shadow`/`max-width`/`left`/`top` repaints, and crisp text/SVG rasterization once `#viewport.gesturing` drops after camera glide.
4. **Playground republish (mandatory per `AGENTS.md`):**
   - Run `python dev/build_playground.py -o <scratchpad>/playground`, read live artifact `https://claude.ai/artifact/Ny25B5E4ts4TramawB4BQp`, republish to the same URL, and verify every diagram type loads and transitions cleanly in the switcher.

---

## 8. Out of Scope / Deferred

- **Bundling the `motion` npm library inline:** Deliberately skipped to keep standalone HTML files small, zero-dependency, and within claude.ai artifact size budgets; the ~160-line shared WAAPI + FLIP + `linear()` spring kernel covers 100% of required physics and morphs.
- **Physics inertia / momentum throwing after pan or node drag:** Skipped by default (diagram editors favor exact placement over slippery coasting; easy future opt-in on `animateViewport` if desired).
- **Per-frame SVG morphing of complex flowchart polylines above 60 edges:** Capped intentionally (`stroke-dashoffset` fallback above 60 edges) to guarantee locked 60/120fps on very large diagrams.

---

## 9. Implementation notes (what shipped, what was turned off)

All five phases are built. Verification: every suite in section 7 is green except the two sequence checks that already fail on `main` ("Own column" in the action bar undoes the share; and it is one undo step), plus the new `dev/e2e_motion.mjs` and `dev/perf_motion.mjs` (see `dev/architecture.md`).

Nothing is turned off: sequence lifelines and caps, flowchart lane move and delete, the direction switch, undo/redo (arrows included) and the menu open morph all animate.

Determinism without turning motion off: the kernel (`assets/shell/shell.js`) sets `<html data-motion-busy="1">` while any WAAPI animation (anim, play, ghosts), SVG tween or camera glide is in flight, and removes it when all finish (also on `cancelAll`). The test helpers `open()`, `at()` and `settle()` in `dev/cdp.mjs` wait (cap ~800ms) until it is gone, so a click or measurement never lands on a moving target. The export/more/type menus open with the scale/clip morph at 120ms with `curve-out` (no overshoot), so items are in place before a click.

Flowchart tab switches are calm: the old flow dims out in place (160ms), the new one settles in with a 14px slide and 0.98 to 1 scale over `dur-tab` (300ms, `curve-inout`/`curve-out`, no spring), the camera glides over the same time, and the active-tab chip still slides.

Known and not fixed here:
- Frame-time cost of the ERD Columns toggle at 4x CPU slowdown is tracked by `dev/perf_motion.mjs`.

