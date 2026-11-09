# Swimlane Flowchart (`diagramType: "flowchart"`)

Use for swimlane, cross-functional or BPMN-style process flows. Layout, routing, label placement and styling are computed by the tooling; author only the logical graph. A complete file: [example-flowchart.json](../../dev/samples/example-flowchart.json).

## Schema

Never add pixel coordinates (`x`, `y`); `--layout` computes them.

```json
{
  "diagramType": "flowchart",
  "title": "Process Title",
  "direction": "LR",
  "lanes": [{ "id": "lane-customer", "name": "Customer", "color": "#e0f2fe" }],
  "nodes": [{ "id": "n1", "laneId": "lane-customer", "type": "start", "label": "Submit Request" }],
  "edges": [{ "id": "e1", "from": "n1", "to": "n2", "label": "" }]
}
```

| Object | Field | Description |
|---|---|---|
| Lane | `id`, `name`, `color` | Unique id (`lane-<slug>`), actor or system name, hex color from the table below. |
| Node | `id`, `laneId`, `type`, `label` | `type` is `start`, `task`, `decision` or `end`. |
| Node (`end` only) | `outcome` | Optional `"success"` (dark green, check) or `"failure"` (dark red, cross). Plain `end` is dark slate. All terminators use light text on a dark fill; `start` stays light with dark text, so good and bad endings look different. |
| Edge | `id`, `from`, `to`, `label` | `label` is `"Yes"`, `"No"`, `"Resubmit"`, etc.; `""` for unconditional steps. |
| Edge | `feedback` | Optional `true` marks a loop-back edge so it always routes through the outer corridor. Without it the engine picks the loop edge by traversal order, which may choose the wrong edge of a cycle. |

| Lane role | Color |
|---|---|
| Customer / User | `#e0f2fe` (sky) |
| Frontend / Sales / Ops | `#fef3c7` (amber) |
| Backend / Core Engine | `#dcfce7` (emerald) |
| Risk / Compliance / Admin | `#fee2e2` (rose) |
| External Integration / 3rd Party | `#f3e8ff` (purple) |

## Writing rules

1. **Verb + Noun** for tasks (`"Validate Order"`, not `"The order needs to be validated"`).
2. **Decisions end in `?`** (`"Docs Complete?"`) and every outgoing branch is labeled.
3. **One owner per node**: place each node in the lane of the actor who performs it.
4. Keep labels short; long edge labels wrap, but long node labels shrink the fitted text.
5. One lane per distinct actor or system.

## Diagram scale & viewing mode

The user's requested scope determines the diagram size and granularity. Never truncate, omit, or collapse workflow steps to fit an arbitrary node or column count.
- **Interactive canvas (pan & zoom)**: Diagrams of any size (from small 5-node flows to 50+ node enterprise workflows) are supported. Users view and explore them interactively in the browser with pan, zoom, drag, and Auto-Tidy.
- **Single-screen overview (optional)**: When a user explicitly asks for a summary, high-level overview, or single-slide deck flow, designing within ~7 columns and ~12 nodes allows the diagram to fit on a 1080p display without panning.

## Visual review checklist

The layout report covers label occlusion. Check the rest by eye on the screenshot:

1. **No coincident trunks**: parallel segments in one column gap are staggered so labels never stack.
2. **Distinct decision exits**: branches leave a diamond from different ports (top/right/bottom).
3. **Lane containment**: every node sits inside its lane with at least 40px bottom margin.
4. **Orthogonal lines**: same-lane connections are flat, with no diagonal kinks.
5. **Loop edges** use the outer corridors.

## Failure handling

- **Wrong loop edge or odd column placement in a cycle**: set `"feedback": true` on the edge that should loop back, then re-run `--layout`.
- **Label overlap or crowding**: reorder lanes or simplify the JSON, re-run `--layout`, re-check.

## Verification evidence (flowchart additions to the shared gate)

| Check | How it is verified |
|---|---|
| Same-lane connections are flat | **Automated**: collinear % and dogleg count in `--verify` |
| Loop edges use outer corridors; branches exit distinct ports | **Visual** (checklist 2, 5) |
| Lane containment and flat lines | **Visual** (checklist 3, 4) |

## Final report additions

Node and lane counts; whether the diagram was split and why.
