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

`.editing`, `.collapsed`, `.dragging`, `.dim`, `.dimmed` are not state names. Not yet renamed (follow-up): flowchart (`.editing`, `.dragging`) and the note cards (`.dragging`, shared notes module).

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
| Tokens | `--port-size` (12px), `--port-size-touch` (20px under `.is-touch`), `--hit-min`, `--ui-scale` (constant on-screen size when zoomed), `--shadow-chip`, `--node-bg`, `--primary` |
| Hit area | at least 24x24 px (`::before`) |
| Types | erd (rows and header), c4 (node sides), usecase (case and actor sides), gantt (bar ends), erd and sequence message ends (`port-end`). A type's own "tool armed" or "connecting" state may show every port (`components-ok` comment). Flowchart still has its own (below). |

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
| Types | c4 (nodes, tiles), erd (tables), gantt (task bars; summary bars and milestones keep their own), usecase (subjects), sequence (frame boxes, branch lines, lifeline caps, message lines). Not yet: sequence participants (the pill's own ring, `components/pill.css`), usecase actors and cases (the ring is on the inner shape), flowchart. |

## Other shared elements (already defined once)

Action bar (`ui.actionBar`, `actionbar.css`), note card and badge (`ui.noteCard`, `note.css`, `badge.css`), colour key (`ui.colorKey`), swatch picker (`swatch.css`), swatch pill (`pill.css`), frame tag and summary (`frame.css`), toast (`ui.toast`), popover, toggle, button, dock, search.

## Minimum hit area

Every small control keeps an invisible `--hit-min` (24 px) target (WCAG 2.5.8): chevron and port get it from their shared CSS; do not shrink it in a type.
