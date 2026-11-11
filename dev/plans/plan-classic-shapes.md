# Plan: Classic flowchart shapes

Add the classic (ISO 5807-style) flowchart symbols that process diagrams use most, beyond today's `start`, `end`, `task` and `decision`:

| `type` | Symbol | Means | Drawn as |
|---|---|---|---|
| `subprocess` | Predefined process | A step that is a whole process documented elsewhere | Rectangle with a double bar inside each short side |
| `document` | Document | A step that produces or handles a document (invoice, letter, report) | Rectangle with a wavy bottom edge |
| `io` | Data (input/output) | Data entering or leaving the process (form received, file exported) | Parallelogram |
| `database` | Stored data | A step that reads or writes a system of record | Cylinder |
| `delay` | Delay | A wait (cooling-off period, SLA timer, batch window) | D-shape: flat left side, round right side |

On-page connectors are planned separately in [plan-connectors.md](plan-connectors.md): they need engine work and page behaviour these five shapes don't. BPMN-only symbols (events, typed gateways, message flows) stay out: the notation is classic flowchart (decided 2026-11-11).

**Status:** planned, not started.

## What the code does today

Only `decision` is special anywhere. Every other type is laid out, routed and audited as a 144x64 box:

| Where | Type-specific code |
|---|---|
| [engine.js](../../assets/types/flowchart/engine.js) | `nodeH`: decisions are 80px across the flow (`DEC_H`), everything else `NODE_H`. Decisions also drive branching (`multi`, `exitBlocked`). |
| [flowchart.js](../../assets/types/flowchart/flowchart.js) | `nodeScreenH` / `nodeHeightOf` sizes; `isDot` (unlabelled start/end as a circle); `renderNodes` draws the diamond SVG; the router's decision rules (fan-out, merge-in, `5d` snaps arrow ends onto the diamond outline); `canInsert` (task, decision); `NODE_DEFAULTS`; `buildGhost`; the `Yes` default label. |
| [flowchart.css](../../assets/types/flowchart/flowchart.css) | `.type-*` node styles, `.btn-shape[data-node-type]` tile colours, ghost styles. |
| [toolbar.html](../../assets/types/flowchart/toolbar.html) | One `.btn-shape` tile per type in the Shapes popover; the grid wraps on its own. |
| [layout_engine.py](../../scripts/layout_engine.py) | `FlowchartAudit.node_h` (decision height); the Yes/No-on-a-step warning. |
| [flowchart.md](../../references/types/flowchart.md) | Schema row listing the four types; label budgets for tasks and decisions. |

An unknown `type` already renders as a plain box (`.flow-node` with no matching `.type-*` rule), so old pages and the engine tolerate new values.

## Design

### One slot, outline drawn inside it

Every new shape uses the task's 144x64 slot (TB: 144 across, centred in the 80px flow slot, like a task). So:

- **No engine change.** `nodeH`, ranking, lane sizing, golden layouts and `FlowchartAudit.node_h` all stay as they are. This is the main reason to keep the slot: a shape that changes size changes layouts, goldens and the audit's geometry.
- **Rendering** follows the decision's pattern: the node box goes transparent and an SVG outline (`preserveAspectRatio="none"`, `vector-effect: non-scaling-stroke`) is drawn inside it, with the label on top. One `SHAPE_OUTLINES` table (`type -> SVG markup`) replaces the decision's inline `if`, and the diamond moves into it.

### Arrow ends on the outline

The router ends arrows on the slot's box. That is right for rectangles, and wrong where the outline sits inside the box:

| Shape | Where the outline leaves the box | Fix |
|---|---|---|
| `io` | Slanted sides: at mid-height the side is `slant/2` inside the box | Keep the slant small (12px), and inset left/right arrow ends by `slant/2` |
| `delay` | Round right side: only the mid-point touches the box | Inset right-side ends by the arc's depth at that height |
| `database` | Elliptical top: the outline's top is the ellipse, not the box | Inset top ends by the ellipse depth at that x |
| `document` | Wavy bottom | Draw the wave so it crosses the box's bottom at the centre; ends spread along the bottom are inset by the wave height there |
| `subprocess` | Already on the box | None |

Generalise step `5d` (today: diamonds only) into one outline snap, `insetAt(type, rect, side, along)`, that returns how far inside the box the outline is at that point; diamonds become one entry. **Caveat:** `5d` runs in flow terms, before the TB transpose (`5e`), and these shapes are not symmetric the way the diamond is (the document's wave is always on the screen bottom, the delay's arc on the screen right). So `insetAt` takes the screen side, mapped through the same `SIDE` table `5e` uses. Shapes keep their screen orientation in a TB diagram; they do not rotate.

### Colours

The new shapes take the task's colours (white fill, `--border-dark`, `--task-accent` on hover/select). The outline carries the meaning; every strong hue on the canvas is already taken (gold decisions, green start, navy end, blue selection, amber incoming arrows), and notes were made neutral for the same reason.

### Labels

The outline takes room from the text, so each shape gets a budget like tasks (`<= 28` chars) and decisions (`<= 24`):

| Shape | Text box | Budget |
|---|---|---|
| `subprocess` | 144 minus the two bars (~2x12px) | `<= 24` |
| `document` | Full width, less the wave at the bottom | `<= 28` |
| `io` | 144 minus the slant | `<= 24` |
| `database` | Below the top ellipse | `<= 24` |
| `delay` | 144 minus the arc | `<= 24` |

Measure each with the render report before fixing the numbers in the reference: `render_screenshot.py` already warns on truncated text.

### Editing

- One tile per shape in the Shapes popover, after Decision: Subprocess, Data, Document, Database, Delay. With Note that makes ten tiles; for how to arrange them, see open question 2.
- `NODE_DEFAULTS`: `Subprocess`, `New Document`, `Input / Output`, `Database`, `Wait`.
- `canInsert` (drop onto an arrow): every new shape.
- `buildGhost` draws the outline, so the drag ghost matches the shape.
- New arrows from these shapes get no default label (only decisions default to `Yes`).
- Note badge and `+` chip sit on each outline's top-right, not the empty corner of the box (like the decision's).

## Out of scope for this plan

- **On-page connectors**: [plan-connectors.md](plan-connectors.md).
- **Data-flow edges.** In classic charts a database or document often hangs off the main flow ("Store Record" with a line to a cylinder). Today every edge is sequence: the engine ranks it, so a side branch to a data store becomes a step in the timeline and distorts the layout. Here the shapes are steps in the sequence ("Store Claim Record" drawn as a cylinder). A later `"kind": "data"` edge, drawn dotted and ignored by ranking, could add side links.
- **Off-page connectors** (pentagon, links across diagrams).
- **Shape-specific rules in the audit**, beyond label budgets and an unknown-type warning.

## Implementation steps

### 1. Rendering and palette (no engine change)

1. `flowchart.js`: add the `SHAPE_OUTLINES` table and draw it in `renderNodes` and `buildGhost`; move the diamond into it. Extend `NODE_DEFAULTS` and `canInsert`.
2. `flowchart.css`: `.type-<shape>` rules (transparent box, outline fill and stroke from the task tokens, hover/selected accent, label insets per shape); tile colours for the new `.btn-shape[data-node-type]` tiles; ghost styles. Dark mode comes from the tokens; check it on screen.
3. `toolbar.html`: the five tiles, with icons drawn in the same 24px style as the existing tiles.
4. Note badge and `+` chip positions per shape.

**Check:** add each shape from the palette, by click and by drag, in LR and TB, light and dark. Export SVG/PNG and compare.

### 2. Arrow ends on the outline

1. Replace `5d` with the `insetAt` outline snap (diamond plus the table above), keyed by screen side.
2. Check every side of every shape with arrows entering and leaving, in both directions, including ends spread along a side (several arrows on one side).

**Check:** a new fixture `dev/fixtures/flowchart/classic-shapes.json`, one of each shape wired in a small flow with a loop. Freeze its golden. The layout must equal the same diagram with every new type replaced by `task` (proof that the engine is untouched). Screenshot it in both directions.

### 3. Skill and audit

1. [flowchart.md](../../references/types/flowchart.md): the schema row lists the new types and how each is drawn. A writing rule says when to use each: only when the source shows or names that kind of step (a document produced, a system of record written, a referenced sub-process, a waiting period), otherwise `task`. Labels stay Verb + Noun (rule 1) whatever the shape, and the label budgets above go in rule 4.
2. `layout_engine.py`: `[WARN]` for an unknown `type`, listing the valid ones.
3. Add one or two shapes to an example only if it reads naturally (e.g. `document` for "Issue Decline Letter" in the loan example). Don't pad the examples with every shape: agents copy them.

**Check:** `python dev/check_golden.py`, `python dev/build_examples.py --check`, skill validator on the changed reference.

### 4. Tests

1. `dev/e2e_shell.mjs` (or a new `dev/e2e_shapes.mjs`): each tile adds its type; drop onto an arrow works for each; arrow ends sit on the outline (sample the end point against the SVG outline's path); export contains each outline.
2. Run the existing suites: notes, shell, sequence, goldens, examples.

## Open questions

### 1. Shape picker: change a step's shape after adding it

Today a step's type is fixed when it is added; turning a box into a document means deleting it and redrawing its arrows. With the shared slot, most swaps are only `node.type = x`: arrows, notes, lane and position stay.

| Swap | Effect |
|---|---|
| Between slot shapes (task, subprocess, document, io, database, delay) | In place, no relayout |
| To or from decision | Height changes (64 / 80): Auto-Tidy re-lays out; with it off the node just grows |
| Decision to anything | Its outgoing `Yes`/`No` labels become wrong: clear them in the same undo step |
| To start / end | Allowed (the audit does not forbid arrows on both sides today) |
| To connector | Excluded: a connector shows one letter, so the label would vanish; connectors come from the palette or from splitting an arrow ([plan-connectors.md](plan-connectors.md)) |

Proposed UI: a small shape chip beside the selected node (next to the `+` note chip) that opens the same tiles as the Shapes menu, current shape ringed; one click swaps, one undo step. Rejected: dropping a palette tile onto a node to replace it (clashes with drag-to-add), and right-click (hidden on touch).

### 2. Tile grouping

Today's tiles are icon-only (names only in hover tooltips; Start and End share an icon, told apart by colour). Ten tiles wrap 6 + 4, mixing basic and classic shapes, with Note (not a shape) last. Options:

| Option | Layout | Trade-off |
|---|---|---|
| A. One grid | Order only | No work; harder to scan; classic icons unnamed on touch |
| **B. Labelled sections** (proposed) | "Flow" (Start, End, Step, Decision), "Classic" (the five), "Annotate" (Note) | Small change to the shared popover (`.dock-pop-section` in shell.js/css); scannable |
| C. "More shapes" expander | Basic row, then a toggle for the classic ones | Tidy, but one extra click and less discoverable |

With B, add a short caption under every tile: it also fixes Start vs End and makes the less familiar classic icons readable without hovering.
