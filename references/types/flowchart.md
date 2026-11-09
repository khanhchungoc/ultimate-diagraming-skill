# Swimlane Flowchart (`diagramType: "flowchart"`)

Use for swimlane, cross-functional or BPMN-style process flows. Layout, routing, label placement and styling are computed by the tooling; author only the logical graph. A complete file: [example-flowchart.json](../../assets/example-flowchart.json).

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

## Complexity budget

**At most 5 swimlanes, 12 nodes and 7 columns (the longest chain of sequential steps).** Columns matter most: every extra column shrinks text when the diagram is fitted to 1920px, and 8+ columns fall below the 11px readability minimum. If the process is larger, split it into a Level-1 overview and Level-2 detail flowcharts and say so in the report. `--verify` prints `[WARN]` when a budget is exceeded.

## Visual review checklist

The layout report covers label occlusion and text size. Check the rest by eye on the screenshot:

1. **No coincident trunks**: parallel segments in one column gap are staggered so labels never stack.
2. **Distinct decision exits**: branches leave a diamond from different ports (top/right/bottom).
3. **Lane containment**: every node sits inside its lane with at least 40px bottom margin.
4. **Orthogonal lines**: same-lane connections are flat, with no diagonal kinks.
5. **Loop edges** use the outer corridors.

## Failure handling

- **Wrong loop edge or odd column placement in a cycle**: set `"feedback": true` on the edge that should loop back, then re-run `--layout`.
- **Label overlap or crowding**: reorder lanes or simplify the JSON, re-run `--layout`, re-check.
- **Text below 11px at Fit**: too many columns or too much text; shorten the chain, simplify labels or split the diagram. Never lower the minimum to pass.

## Verification evidence (flowchart additions to the shared gate)

| Check | How it is verified |
|---|---|
| Same-lane connections are flat | **Automated**: collinear % and dogleg count in `--verify` |
| Loop edges use outer corridors; branches exit distinct ports | **Visual** (checklist 2, 5) |
| Lane containment and flat lines | **Visual** (checklist 3, 4) |

## Final report additions

Node and lane counts; whether the diagram was split and why.
