# Layout Algorithm & Self-Saving Architecture Guide

This guide details the mathematical principles behind the layout engine, the planar orthogonal router, and the browser-native self-saving architecture.

---

## 1. Swimlane-Constrained Sugiyama Framework

General-purpose DAG layout algorithms (like unconstrained Graphviz) do not respect rigid horizontal swimlane partitions. The layout engine uses a 5-phase constrained pipeline:

```
Input Graph JSON ──> [1. Cycle Breaking] ──> [2. Topological Layering]
                             │                            │
                             ▼                            ▼
                 [4. Planar Port & Channel Routing] <── [3. Barycentric & Height Sizing]
                             │
                             ▼
                 [5. Obstacle-Aware Label Placement]
```

### Phase 1: Cycle Breaking (Back-Edge Detection)
- Business processes frequently loop back (e.g., *Rejection $\rightarrow$ Resubmit*).
- The engine runs a 3-color Depth-First Search (`0=white`, `1=gray`, `2=black`). Any edge encountered while the target node is `gray` is isolated as a **back-edge**.
- Forward edges form a pure Directed Acyclic Graph (DAG) for column sorting.

### Phase 2: Topological Layering (X-Axis Columns)
- Using the forward DAG, each node is assigned an integer rank:
  $$\text{Rank}(v) = \max_{u \in \text{preds}(v)} (\text{Rank}(u)) + 1$$
- This guarantees sequential flow from Left to Right ($x = \text{start\_x} + \text{Rank} \times 200\text{px}$).
- A labelled arrow widens its step to $\max(200, \text{node width} + \text{label width} + 2 \times 16)\text{px}$, so long labels always have room between the two nodes.

### Phase 3: Barycentric Crossing Reduction, Dynamic Lane Height & Nudge-to-Align
- When multiple nodes occupy the same lane and column rank:
  - The engine computes the barycentric index of each node based on the vertical positions of its predecessors:
    $$\text{Barycenter}(u) = \frac{1}{|P(u)|} \sum_{p \in P(u)} \left(\text{LaneIndex}(p) \times 100 + \text{Rank}(p)\right)$$
  - Nodes in the same column are sorted by this value. The first keeps row 0.
  - **One row per lane unless it branches**: a further node is stacked into a sub-row ($y = 36 + \text{sub\_row} \times 104\text{px}$) only when it shares a parent with another node in that column (a fork). Any other node moves right into the first free row-0 slot instead, if one exists within its slack (before the x its successors require, so nothing downstream moves), at most 1.5 columns away (end nodes may go further), and not on top of a straight same-lane arrow or a vertical arrow crossing the lane. Only when no such slot exists does it take a sub-row.
  - Each swimlane's height is computed from its sub-rows and node heights ($\max(176\text{px}, 36 + \text{rows} + 36\text{px})$); single-row lanes centre their nodes, so every lane without stacked branches is the same height (176px; 240px wide when top-to-bottom). A lane with loop-backs between its own nodes keeps $72\text{px} + 16\text{px}$ per extra nesting level clear for the loops and their labels on the side they run on, moves its nodes toward the other side (24px from it), and grows only if that does not fit (`laneLoopRooms` in `engine.js`, shared with the renderer). A loop normally runs on the lane's far side (below the nodes, or right of them top-to-bottom). It runs on the near side (above, or left) when its source or target already sends an arrow into a farther lane and neither sends one into a nearer lane, for example a decision whose "Yes" goes down into the next lane, because that arrow takes the node's far vertex. The rule lives in `loopSides` and is used by the layout, the renderer's lane sizing and its router alike, so the reserved room is always where the loop is drawn. As a safety net, after routing the renderer grows the last lane, which has no neighbour beyond it, on its outer side until every arrow and label is at least 16px inside. Its nodes do not move.
  - Nodes follow a strict 4px modular grid: standard cards are $168 \times 56\text{px}$, and decision diamonds are $168 \times 64\text{px}$.
  - **Node Nudge-to-Align ($\le 35\text{px}$)**:
    - Whenever sequential nodes within the same lane have minor vertical offsets ($|\Delta y| \le 35\text{px}$, such as $56\text{px}$ tasks connecting to $64\text{px}$ diamonds), the engine shifts the node's center Y to achieve exact collinear alignment.
    - This collapses ugly 3-waypoint stepped dogleg kinks into single $0^\circ$ razor-flat horizontal arrows.

### Phase 4: Planar Port Assignment, Outer Bypass Corridors & Curved Routing
- **Decision Diamond Ports**:
  - Decision nodes render as vector diamonds with anchor ports located precisely on their 4 tips (`Top`, `Right`, `Bottom`, `Left`).
  - Upward cross-lane branches exit from the `Top` tip.
  - Downward cross-lane branches exit from the `Bottom` tip.
  - Forward same-lane branches exit from the `Right` tip.
- **Arrow ends on shaped outlines** (step 5f in `computeAllEdgeRoutes`): every shaped node (the decision and the classic symbols `subprocess`, `io`, `document`, `database`, `delay`) keeps a task-like box for layout and routing and draws its outline inside it (`SHAPE_OUTLINES` in `flowchart.js`). After the top-to-bottom transpose, each arrow end on such a node slides along its end leg onto the outline by `outlineInset(type, rect, screenSide, along)`. It works on screen sides because shapes keep their screen orientation in a top-to-bottom diagram (the document's wave stays at the bottom). The engine never sees the shapes: a classic symbol lays out exactly like a `task` (the `classic-shapes` fixture checks this).
- **Dedicated Outer Bypass Loopback Routing**:
  - Feedback/loopback flows (target $X <$ source $X$) exit from the source node's `Left` port and step immediately into a dedicated boundary bypass channel:
    - Upper bypass corridor: $Y = \min(\text{source } Y - 20, \text{target } Y - 20)$
    - Lower bypass corridor: $Y = \max(\text{source } Y + H + 20, \text{target } Y + H + 20)$
  - The horizontal return segment traverses along this outer highway completely outside the active task rows, eliminating line strikes across intermediate nodes.
- **Incoming Port Staggering & Convergence**:
  - When multiple forward edges converge onto a target node's `Left` port, their vertical arrival coordinates are staggered ($\pm 8\text{px}$) so arrowheads and horizontal approach segments never overlap.
- **Crossing-Minimising Column Alignment** (node-type independent):
  - Every forward arrow that crosses lanes may get a compact step, whatever the node types: `zero` (target shares the source's column, a straight vertical arrow; at most one per source per side) or `tight` (target sits one node width, 168px, to the right so its left edge lines up with the source's right edge instead of a full 200px column). The engine lays out each configuration (exhaustively up to 6 candidate arrows, then by coordinate descent), scores it with the verifier (overlaps/penetrations, then edge crossings, diagram width, bends, total arrow length) and keeps the best, so compaction is only applied when it does not make the diagram worse.
- **Fan-in Trunk Guard**: the single-bend side exit is refused when its row-run would cut across the vertical trunk of a sibling arrow into the same target (a source in a farther lane whose column lies between this source and the target). The arrow then enters the target's left port and nests inside the sibling's trunk, so join fan-ins form a crossing-free staircase.
- **Single-Bend Side Exit**:
  - When an arrow leaves a node's right port for a target in another lane that lies clearly to the right, it runs along the source row and enters the target's bottom/top (one bend) instead of the default right-vertical-right Z (two bends). Used only when both segments are clear of other nodes and no other arrow already enters that side of the target; otherwise the Z route is kept.
- **Vertical Channel Staggering**:
  - When multiple `Right` $\rightarrow$ `Left` elbow edges traverse the same column gap, their vertical turn channels (`channelX`) are sorted for planar nesting (upward edges sorted by `startY` ascending; downward edges by `startY` descending) and spaced across the gap.
- **Quarter-Arc Elbows & Bridge Overpasses**:
  - Right-angle turns are rendered with smooth SVG quadratic quarter-arcs ($r=8\text{px}$).
  - When a horizontal arrow segment crosses an existing vertical connector from an unrelated edge, a semicircular bridge hop ($r=6\text{px}$) is inserted to prevent intersection ambiguity.

### Phase 5: Multi-Line Adaptive Label Wrapping & Obstacle-Aware Placement
- **Dynamic Multi-Line Label Dropping**:
  - If single-line condition text (`"Submitted by Customer via Online Portal"`) exceeds the horizontal gap between two nodes, the label automatically drops into multiple balanced lines (`max-width = gapX - 16px`) rather than enforcing artificial horizontal node expansion or causing node-border collisions.
  - Labels are enclosed in an opaque mask shield (`#ffffff` / `rgba(255,255,255,0.96)`) so intersecting lines never strike through label text.
- For each edge label, the router evaluates candidate anchor points (`50%`, `22%`, `78%`, `35%`, `65%` along the vertical leg and horizontal midpoints) against node boxes, placed labels, and other edges to guarantee zero occlusion.
- **Direct Cross-Lane Drag Translation**: During direct node dragging across swimlanes, stage-relative coordinates are converted to the target swimlane's coordinate space with automatic 4px grid snapping and DOM reparenting.
- **Swimlane Permutation**: Re-ordering swimlanes (by dragging a lane header) permutes `chartData.lanes` and triggers an automatic planar reroute of all cross-lane connections.

---

## 2. In-Browser Self-Saving Protocol

The interactive HTML document can modify and persist itself directly on disk:

1. **State Preservation**: The web app maintains live in-memory state. Edits to node text, positions, lanes, or connections update `chartData`.
2. **Deterministic String Replacement**: On Save (`Ctrl+S` or toolbar click):
   - The app serializes `chartData` to JSON.
   - The outer HTML source string is read.
   - A regex replaces `<script id="flowchart-data" type="application/json">...</script>` with the updated JSON.
3. **Multi-Tier Persistence Strategy**:
   - **Tier 1 (Chromium File System Access API)**: Uses `window.showSaveFilePicker()` and `handle.createWritable()` to stream the updated HTML file directly to disk.
   - **Tier 2 (Universal Blob Fallback)**: If the browser blocks the File System Access API, it creates a Blob and triggers an automated `<a download="...">` action.

---

## Flowchart layout invariants

Moved from the agent-facing visual checklist: the engine guarantees these, so a failure is an engine bug, not an authoring error. Check them when changing `engine.js` or reviewing goldens.

1. **No coincident trunks**: parallel segments in one column gap are staggered so labels never stack.
2. **Distinct decision exits**: branches leave a diamond from different ports (top/right/bottom).
3. **Lane containment**: every node sits inside its lane with at least 40px bottom margin.
4. **Orthogonal lines**: same-lane connections are flat, with no diagonal kinks (`--verify` reports collinear % and dogleg count).
5. **Loop edges** use the outer corridors.
6. **Fan-in joins nest**: when several lanes feed one join node, the nearest lane's arrow arrives lowest. A row-run cutting across another arrow's vertical climb means a source took the join's top/bottom port while a farther lane's arrow climbs to its left port.
7. **Arrow ends follow the side rule**: whether arrows touching the same side of a node share one end point depends on how much room that side has.
   - **Left/right sides (short, 64px) merge**: all arrows entering a side share one arrowhead; all arrows leaving a side share one exit point and fork after the first bend.
   - **Top/bottom sides (long, 144px) spread**: each arrow gets its own end point, 24px apart. An arrow that runs straight to a node directly above/below keeps the centre; the others move toward the side their other end lies on.
   - **Entries and exits never share a point** on any side: they stay at least 16px apart, so an arrowhead never sits on a departure.
   - **Always separate**: the two arrows of a two-way pair (A↔B), and a decision's labelled branches (each leaves from its own side).

   Merged and spread ends are both correct. A bug is an arrowhead touching a departure point, or two spread ends closer than 24px.

---

## One Engine

The phases above are implemented once, in `assets/types/flowchart/engine.js`. The page runs it for the Auto-Tidy button and `scripts/layout_engine.py --layout` runs the same file through Node.js (headless Chrome as a fallback, see `scripts/engine_runner.py`). Regression tests: `python dev/check_golden.py` (see [architecture.md](architecture.md)). The Python side only audits (`--verify`).
