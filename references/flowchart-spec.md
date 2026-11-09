# Multi-Swimlane Flowchart Specification Guide

This guide defines the schema, node types, and styling conventions for generating interactive, self-saving multi-swimlane flowcharts.

---

## 1. Canonical Flowchart Schema

The flowchart data lives inside the standalone HTML file in `<script id="flowchart-data" type="application/json">`:

```json
{
  "title": "Process Title",
  "direction": "LR",
  "lanes": [
    { "id": "lane-1", "name": "Actor / Role Name", "color": "#e0f2fe" }
  ],
  "nodes": [
    {
      "id": "n1",
      "laneId": "lane-1",
      "type": "start",
      "label": "Initiate Action",
      "x": 80,
      "y": 40
    }
  ],
  "edges": [
    {
      "id": "e1",
      "from": "n1",
      "to": "n2",
      "label": "Condition or Action"
    }
  ]
}
```

---

## 2. Lane Definitions

Lanes define actors, systems, or organizational roles responsible for steps:

| Field | Type | Description | Example |
|---|---|---|---|
| `id` | `string` | Unique identifier (e.g. `lane-<slug>`). | `"lane-customer"` |
| `name` | `string` | Human-readable role or department name. | `"Applicant / Customer"` |
| `color` | `string` | Hex accent color for the left indicator bar. | `"#e0f2fe"` |

### Recommended Role Color Presets
- **Customer / User**: `#e0f2fe` (Sky light blue)
- **Frontend / Sales / Ops**: `#fef3c7` (Amber light yellow)
- **Backend / Core Engine**: `#dcfce7` (Emerald light green)
- **Risk / Compliance / Admin**: `#fee2e2` (Rose light red)
- **External Integration / 3rd Party**: `#f3e8ff` (Purple light violet)

---

## 3. Node Types & Behavior (4px Modular Grid)

| Node Type | Visual Shape | Typical Purpose | Default Sizing |
|---|---|---|---|
| `start` | Rounded Pill (`rx=28px`, Green tint) | Trigger, event, or process start point. | $168 \times 56\text{px}$ |
| `task` | Rounded Rectangle Card (`rx=8px`) | Concrete action verb + noun executed by the lane owner. | $168 \times 56\text{px}$ |
| `decision` | **Geometric Diamond** (Amber outline) | Business rule, condition check, or gateway question with 4 tip ports. | $168 \times 64\text{px}$ |
| `end` | Rounded Pill (`rx=28px`, Red tint) | Terminal milestone, outcome, or closed status. Optional `"outcome": "success"` renders solid green with a check; `"failure"` renders red with a cross. | $168 \times 56\text{px}$ |

### Node Writing Rules
1. **Concise Business Verbs**: Use `Verb + Noun` (e.g. `"Validate Order"`, not `"The order needs to be validated"`).
2. **Decision Nodes**: Always end in `?` (e.g. `"Credit Score >= 700?"`, `"Docs Complete?"`). Decision gateways render as sharp vector diamonds with exit ports on the top, right, and bottom vertices.
3. **Explicit Lane Ownership**: Every node must belong to the lane representing the actor executing that action.

---

## 4. Interactive Canvas Gestures & Interactions

The standalone HTML flowchart provides fluid, desktop-grade direct manipulation:

1. **Double-Click Inline Text Editing**:
   - Single clicking any step, swimlane header, or condition label selects or drags it without accidental text cursor interruption.
   - **Double-clicking** (`dblclick`) enables inline text editing on node labels, lane names, edge conditions (`"Yes"`, `"No"`), and the chart title. Pressing `Enter` or clicking away (`blur`) commits the change.
2. **Cross-Lane Node Drag & Drop**:
   - Grab any node by its body or text and drag it into a different swimlane. The canvas tracks global coordinates, highlights the active target lane, and automatically reassigns the node's `laneId` and local coordinates on release.
3. **Swimlane Re-ordering**:
   - Drag a lane header up or down. A blue line between lanes shows where the lane will land; release to drop. There are no up/down buttons.
4. **Smooth Quarter-Arc Elbows (`r=8px`)**:
   - All orthogonal path turns render with smooth quarter-arc corners rather than sharp $90^\circ$ angles.
5. **Bridge / Hop Overpass for Crossing Arrows**:
   - When a horizontal arrow crosses a vertical connector, it renders a semicircular bridge hop (`A 6 6 0 0 1 ...`) to eliminate visual ambiguity.

---

## 5. Edges, Flow Connections & Label Wrapping

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique edge ID (e.g. `e1`, `e2`). |
| `from` | `string` | Source node ID. |
| `to` | `string` | Target node ID. |
| `label` | `string` | Condition label (e.g. `"Yes"`, `"No"`, `"Approved"`, `"Resubmit"`). Leave empty `""` for unconditional forward steps. Double-click to edit on canvas. |
| `feedback` | `boolean` (optional) | `true` forces this edge to be treated as a loop-back during layout (outer corridor, target does not push ranks). Omit it to let the engine detect loops by traversal order. Preserved on save. |

### Edge Quality & Label Wrapping Rules
1. **Multi-Line Adaptive Label Wrapping**:
   - Edge labels automatically drop into multiple lines if single-line text exceeds the available horizontal gap between the two connected nodes (`max-width = gapX - 16px`).
   - Labels are wrapped in an opaque mask shield (`#ffffff` / `rgba(255,255,255,0.96)`) so underlying orthogonal crossing lines never strike through text.
2. **Dedicated Outer Loopback Corridors**:
   - Feedback / loopback flows (target $X <$ source $X$) route through dedicated boundary corridors outside active task rows (`LaneTop - 20px` or `LaneBottom + 20px`), eliminating line strikes through intermediate nodes.
3. **Collinear $0^\circ$ Alignment ("Nudge-to-Align")**:
   - Sequential forward nodes within the same swimlane are snapped to exact center-Y coordinates ($|\Delta y| \le 35\text{px}$), eliminating stepped 3-waypoint dogleg kinks.

---

## 6. Script CLI Commands

The tooling in `scripts/` provides four primary operations:

```shell
# 1. Calculate optimal layout, nudge collinear nodes, and scaffold HTML
python scripts/layout_engine.py --layout input.json -o process.html

# 2. Run deterministic pre-flight audit & Diagram Quality Scoring (0-100)
python scripts/layout_engine.py --verify process.html

# 3. Clean 2x screenshot (controls hidden, cropped to the diagram) + layout report:
#    label overlap = exit 3, text below --min-text-px (default 11) at Fit = exit 4.
#    Page URL modes: ?present (read-only), ?capture&w=1600 (screenshot), ?report (measure)
python scripts/render_screenshot.py --input process.html --output process.png --viewport wide

# 4. Extract updated JSON from user-edited HTML
python scripts/layout_engine.py --extract process.html -o updated.json
```
