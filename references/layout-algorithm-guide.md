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
- This guarantees sequential flow from Left to Right ($x = \text{start\_x} + \text{Rank} \times 280\text{px}$).

### Phase 3: Barycentric Crossing Reduction, Dynamic Lane Height & Nudge-to-Align
- When multiple nodes occupy the same lane and column rank:
  - The engine computes the barycentric index of each node based on the vertical positions of its predecessors:
    $$\text{Barycenter}(u) = \frac{1}{|P(u)|} \sum_{p \in P(u)} \left(\text{LaneIndex}(p) \times 100 + \text{Rank}(p)\right)$$
  - Nodes in the same column are sorted by this value and placed into sub-rows ($y = 48 + \text{sub\_row} \times 96\text{px}$).
  - Each swimlane's height is dynamically computed from its maximum sub-rows and node heights ($\max(160\text{px}, \text{maxNodeBottom} + 48\text{px})$) so nodes never overflow lane boundaries.
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
- **Dedicated Outer Bypass Loopback Routing**:
  - Feedback/loopback flows (target $X <$ source $X$) exit from the source node's `Left` port and step immediately into a dedicated boundary bypass channel:
    - Upper bypass corridor: $Y = \min(\text{source } Y - 20, \text{target } Y - 20)$
    - Lower bypass corridor: $Y = \max(\text{source } Y + H + 20, \text{target } Y + H + 20)$
  - The horizontal return segment traverses along this outer highway completely outside the active task rows, eliminating line strikes across intermediate nodes.
- **Incoming Port Staggering & Convergence**:
  - When multiple forward edges converge onto a target node's `Left` port, their vertical arrival coordinates are staggered ($\pm 8\text{px}$) so arrowheads and horizontal approach segments never overlap.
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
- **Swimlane Permutation**: Re-ordering swimlanes (via `▲` / `▼` buttons or header dragging) permutes `chartData.lanes` and triggers an automatic planar reroute of all cross-lane connections.

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
