# Shared UI elements

One definition per element, used by every diagram type. A new type gets an element by using its shared class or `ui.*` call, never by restyling or copying it. A type's CSS may **place or size** a shared element (margin, `left`/`top`, `z-index`, flex), nothing else. `dev/tests/unit/check_components.py` fails on a type-specific copy; the gallery `dev/playground/components.html` (built by `dev/tools/build_components.py`, checked by `dev/tests/e2e/e2e_components.mjs`) shows every element in every state, light and dark.

## State names

One name per state in every type (CSS and JS). Set the class on the item; the shared CSS styles it.

| State | Class | Meaning |
|---|---|---|
| rest | none | |
| hover | `:hover`, or `.is-hover` when the type drives hover itself | pointer over the item |
| selected | `.selected` | in the selection |
| editing | `.is-editing` | its text is being typed |
| collapsed | `.is-collapsed` | shrunk to its header or summary |
| dim | `.is-dim` | pushed back while something else is the focus |
| dragging | `.is-dragging` | being moved or resized |
| several selected | `.is-multi` (on the canvas) | more than one item selected |
| touch | `.is-touch` (on the body) | the last press was a finger |

`.editing`, `.collapsed`, `.dragging`, `.dim`, `.dimmed` are not state names. Not yet renamed (follow-up): the note cards' `.dragging` (shared notes module).

## Elements

### Collapse chevron

| | |
|---|---|
| Markup | `ui.chevron({ expanded, label })` returns `<button class="chevron" aria-expanded aria-label title>` with the chevron icon. `.chevron-spacer` keeps a row without children level. |
| CSS | `assets/components/chevron.css` |
| States | rest (text-soft), hover (`--bg-hover`, text-main), `:focus-visible` ring, `aria-expanded="false"` turns the icon to point right (`--dur-base`, `--curve-inout`) |
| Tokens | `--chevron-size` (22px box), `--hit-min` (24px invisible hit area), `--dur-micro`, `--dur-base`, `--curve-inout` |
| Hit area | at least 24x24 px (`::before`) |
| Types | sequence (frame tag), usecase (subject title), erd (table header), c4 (group frame and tile), gantt (task tree, task table). The caller flips `aria-expanded` and the title; a type that re-renders on collapse also animates the icon with `motion.anim` (a new element cannot transition). |

### Connection port

| | |
|---|---|
| Markup | `ui.port(side)` returns `<span class="port port-top|right|bottom|left|end" data-export-skip>`; the caller adds its pointer handler and, if needed, `left`/`top`. `port-end` is the end handle of a selected line: a hollow ring, always shown, grab cursor. |
| CSS | `assets/components/port.css` |
| States | hidden at rest; shown while the pointer or focus is in the parent item, on a selected item on touch, in a `.touch-ports` item on touch; grows and fills `--primary` on hover or focus; hidden while `.is-dragging` is above it, with `.is-multi`, while the parent is `.is-editing`, in `body.exporting`, `body.presentation` (`.present`), `body.capture` |
| Tokens | `--port-size` (12px outer size, ring included), `--port-size-touch` (20px under `.is-touch`, set by the shell on a finger press), `--hit-min`, `--ui-scale` (constant on-screen size when zoomed), `--shadow-chip`, `--node-bg`, `--primary` |
| Hit area | at least 24x24 px (`::before`) |
| Types | erd (rows and header), c4 (node sides), usecase (case and actor sides), gantt (bar ends), erd and sequence message ends (`port-end`), flowchart (step sides, and the selected arrow's ends as `port-end`). A type's own "tool armed" or "connecting" state may show every port (`components-ok` comment). |

### Edge label

| | |
|---|---|
| Markup | `<div class="edge-label">` (wraps onto lines, the flowchart pill), `.edge-label--wrap` (same, explicit) or `.edge-label--single` (one line, the text child ends in an ellipsis; ERD) |
| CSS | `assets/components/edge.css`; type CSS sets only `position`, `left`, `top`, `transform`, `translate`, `z-index`, `display`, `max-width`, `visibility`, `opacity` |
| States | rest, hover / `.linked` / `.selected` (primary border and glow), `.hl-in` (`--edge-in`), `.hl-out` (`--edge-out`), `.is-dim` (`--dim`) |
| Tokens | `--t-label-*`, `--t-detail-*`, `--edge-label-bg`, `--edge-in`, `--edge-out`, `--primary`, `--shadow-sm` |
| Types | flowchart, erd (`--single`); c4 (`.c4-label`) and usecase (`.uc-label`) carry the class and still size their own text (follow-up) |

### Item states (hover, selected, dim)

| | |
|---|---|
| Markup | HTML item: `data-item` on the box that draws the outline. SVG shape: class `item-shape`. |
| CSS | `assets/components/item-states.css` |
| States | hover: the item's own ring plus `--hover-shadow`; selected: ring `--primary` at `--select-ring-w` plus `--shadow-ring`; `.is-dim`: `--dim` opacity and `--dim-filter` (SVG: opacity); never dimmed while exporting |
| Contract | the type sets the rest ring with `--ring` (colour) and `--ring-w` (thickness) on the item; the states only read them |
| Tokens | `--select-ring-w`, `--hover-shadow`, `--ring-thin`, `--shadow-ring`, `--dim`, `--dim-filter`, `--primary` |
| Types | c4 (nodes, tiles), erd (tables), gantt (task bars; summary bars and milestones keep their own), usecase (subjects), sequence (frame boxes, branch lines, lifeline caps, message lines). Not yet: sequence participants (the pill's own ring, `components/pill.css`), usecase actors and cases (the ring is on the inner shape), flowchart connector circles. Flowchart steps carry `data-item`; a decision or classic shape has no box, so its own outline takes the same `--primary` / `--select-ring-w` look. |

### Dock overflow More menu

| | |
|---|---|
| Markup | Injected by `assets/shell/shell.js` at the end of `.toolbar-center`: `.menu-wrap.dock-more-wrap > button#btn-dock-more.btn.btn-icon.dock-more-btn` (`aria-label="More actions"`, `aria-haspopup="menu"`, `aria-expanded`) and `#dock-more-menu.menu.dock-more-menu` (`role="menu"`, `aria-label="More actions"`). Secondary controls in a type's `toolbar.html` opt in with `data-dock-priority="N"` (higher number folds first; controls without it never fold). |
| CSS | `assets/components/dock.css` (and shared `.menu` rules in `assets/components/popover.css`) |
| Behaviour | A `ResizeObserver` on `.dock-area` and `.toolbar-center` folds the highest-priority controls (`data-dock-folded="true"`) until the dock fits, hiding orphaned `.dock-sep` separators (`data-dock-sep-hidden="true"`), and unfolds them when room returns. Folded controls stay in the DOM; menu items invoke `.click()` on the original button, mirror icon/label/disabled state, and sync `aria-checked` (`menuitemcheckbox` for switches/toggles, `menuitemradio` for folded popover radio groups, `menuitem` for plain actions). |
| Keyboard & motion | `ArrowDown`/`ArrowUp`/`Home`/`End` move between enabled items; `Space` toggles `menuitemcheckbox`/`menuitemradio` without closing; `Enter` activates and closes; `Escape` closes and returns focus to `#btn-dock-more`; `Tab` closes without trapping focus. Opens via `motion.morphRect` from `#btn-dock-more` (respecting reduced motion). |
| Tokens | `--ctrl-h`, `--dock-inset`, `--dock-pad`, `--space-*`, `--icon-lg`, `--icon-sm`, `--dur-fast`, `--curve-out`, `--curve-spring-tactile` |
| Hit area | `#btn-dock-more` and every menu item are at least `--ctrl-h` (32 px; 40 px on coarse pointer, above WCAG 2.5.8 24 px minimum). |
| Types | Shared by all six types (flowchart, sequence, erd, usecase, c4, gantt). |

## Other shared elements (already defined once)

Action bar (`ui.actionBar`, `actionbar.css`), note card and badge (`ui.noteCard`, `note.css`, `badge.css`), colour key (`ui.colorKey`), swatch picker (`swatch.css`), swatch pill (`pill.css`), frame tag and summary (`frame.css`), toast (`ui.toast`), icon picker (`ui.buildIconPicker` / `ui.openIconPicker`, `popover.css`), popover, toggle, button, dock, search.

## Minimum hit area

Every small control keeps an invisible `--hit-min` (24 px) target (WCAG 2.5.8): chevron and port get it from their shared CSS; do not shrink it in a type. A side port's target runs outward from the item's edge only, so on a small or zoomed-out item it never covers the item's own text.
