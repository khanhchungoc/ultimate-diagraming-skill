# Plan: ERD layout v3: a graph layout, side anchors and colour-coded tables

v2 ([archive/plan-erd-layout-v2.md](archive/plan-erd-layout-v2.md)) placed tables on a grid inside group boxes. On review it reads as a spreadsheet, not a graph. The group boxes look heavy, and lines that anchor on FK rows force long detours around tall tables. v3 makes three changes:

1. It removes groups and colour-codes the tables instead.
2. It anchors lines on the four sides of a table, as the flowchart does.
3. It replaces the grid with a node graph: tables are nodes, spread out by a force-style layout, and joined by smooth curves, like the wires in a node editor.

These stay: tables, columns, relationship ends (crow's foot), notes, the D8 hover highlight, the D10 overview zoom and expand card, Copy as (full ERD), Mermaid, undo and touch. The D9 rounded orthogonal bends are replaced by curves (D3).

**Status:** approved 2026-11-14 (D1–D6, smooth curves; dropping the layout of v2 files confirmed). Not started.

## Decisions

**D1. No groups.**
- Removed from the model: `groups`, `entities[].group`, the group box and tab, group drag and the group action bar.
- Removed from the audit: the group checks.
- Each table has an optional `color` (one of the 8 lane swatches). It is set from the existing swatch row in the table's action bar.
- `colorKey` (`{ hex: label }`, already supported) remains the optional legend that names what each colour means.

**D2. The skill colour-codes tables by relevance.**
- `references/types/erd.md` tells the agent how to colour tables:
  - group tables by domain, judged from names and FKs (billing, accounts, catalogue);
  - give each domain one swatch;
  - write a `colorKey` naming the domains;
  - leave isolated utility tables neutral.
- The audit warns when a schema has more than 8 tables and no table has a colour.
- Skipped: automatic colouring from FK clusters in the engine. The agent judges domains better than graph clustering does, and an automatic fallback would override tables the user left neutral on purpose.

**D3. Lines anchor on the four sides, as in the flowchart (answer to "link to the exact FK position?").** Recommendation: yes.
- Row anchors pin each line to one exact y, so most lines need two bends and a detour around the table. With side anchors, a graph layout can keep lines short and mostly straight.
- What is lost: seeing at a glance which column a line belongs to. Hover already restores that. D8 highlights the FK row in the child and the key row in the parent. The expand card and the peek chips name the columns too.
- **Hover (D8, kept and required):** hovering a table highlights every related table and, in each of them, the FK rows that point at the hovered table (and, in its parents, the key rows it points at), in the in/out colours. The connecting curves are highlighted in the same colours, and everything else is dimmed. When rows are hidden (overview, `detail`, collapsed), the key peeks list the same columns. This now carries the column information that row anchors used to show, so `e2e_erd.mjs` checks it on side-anchored lines: both FK and key rows have `key-hl`, the curves are highlighted, and unrelated tables are dimmed.
- **Choosing the side:** the side faces the other table (compare the centre-to-centre direction with the table's aspect).
- **Several lines on one side:** they spread evenly along it, ordered by where the other end lies, so they do not cross at the table.
- **Line shape: smooth curves (chosen 2026-11-14).**
  - Each line is one cubic Bézier.
  - It leaves each port at right angles to its side, so the crow's foot sits square on the edge.
  - The control points sit `clamp(distance / 2.5, 40, 160)` px out along the side's normal.
  - Lines that share a pair of sides fan apart: their control points are offset by their spread along the side.
  - The orthogonal A* router, the trunks and `erRowAnchorY` are deleted.
  - Curves do not steer around tables. The layout keeps them clear instead (the edge–node term in D4).
- **Labels:** at the curve's midpoint (t = 0.5), nudged along the normal when they overlap a table.
- **Self-references:** a loop that leaves the right side and comes back into the top.
- **Crossings:** counted on a 16-segment polyline sampled from each curve.

**D4. Graph layout.**
1. **Distances:** shortest-path distances on the FK graph, undirected. Edge length scales with the sizes of the two tables. Tables of the same colour count as a little closer (×0.8), so domains cluster without boxes.
2. **Start:** a deterministic seed with no randomness. The highest-degree table goes at the centre, and the others on rings by BFS distance, in id order.
3. **Stress majorization:** about 200 iterations. It gives a graph-like spread: hubs land in the middle and their neighbours around them on every side.
   - Then 50 force iterations add an edge–node repulsion: a table that sits on the straight line between two other tables it does not connect to is pushed off it, so the curves pass beside tables, not through them.
4. **Overlap removal:** rectangle-aware, with gaps of 80 px horizontal and 56 px vertical between tables. The tables are pushed apart along the axis of least overlap and iterated until clean.
5. **Shape:** scale the axes toward the view's aspect (target 1.6–2.0, wider than tall), then compact (slide tables toward the centre while nothing overlaps).
6. **Disconnected tables and components:** each component is laid out on its own, and the components are packed by size around the largest. Isolated tables go in a row beneath.
7. **Choose:** draw the curves for a few candidate variants of steps 3–5 (mirrored and rotated). Keep the one with the fewest curve-over-table hits, then the fewest crossings, then the shortest total length (the v2 candidate selection, reused).

**D5. Editing.**
- **Dragging a table:** it moves freely, and only its lines re-route.
- **Auto-Tidy on:** a structural edit (add or delete a table or relationship) re-runs the layout, warm-started from the current positions so the picture moves little.
- **Tidy button:** a full layout from the seed.

**D6. Disk format: `schemaVersion` 3.**
- **`layout` map:** absolute table positions, with no group origins.
- **Reading v2:**
  - each group's colour becomes the `color` of its tables;
  - the group names become `colorKey`;
  - `group` fields are dropped;
  - the layout is dropped, so the page lays the diagram out again (the same path v1 takes).
- `scripts/disk_format.py` changes the same way, keeping byte-for-byte parity with `toDisk`.

## Acceptance (`dev/erd_layout_metrics.py --check`)

| Fixture | Target |
|---|---|
| `saas-billing` (30 tables) | fit zoom ≥ 60% (v2: 54%); crossings ≤ 2; curves over unrelated tables: 0; aspect 1.2–2.0; the top-3-degree tables within the central third |
| `example-erd` | crossings 0; curves over tables: 0 |
| `hub-and-spokes` | hub table centred; neighbours on at least 3 sides |
| all | deterministic: the same input gives byte-identical output (golden) |

The v2 metrics that only fit a grid or orthogonal lines are dropped: the empty share, the hub distance in cells, and bends.

## Work

| Wave | Agent | Files |
|---|---|---|
| A | Engine | `engine.js`: the D4 layout, the D3 ports and curves, deletion of the group code and the orthogonal router; `scripts/run_engine.mjs` unchanged |
| A | Python | `disk_format.py` v3 codec plus v2 migration, `audit_erd.py` (group checks removed, colour warning), `layout_engine.py`, `dev/test_audit_erd.py` |
| B | Page | `erd.js`, `erd.css`, `stage.html`, `help.html`: groups removed, curves drawn as SVG `path` `C` commands with the crow's-foot glyphs rotated to the side, v2 migration in `fromDisk`, warm-start relayout |
| B | Docs and tests | `references/types/erd.md` (D2 guidance; groups removed), `SKILL.md`, `dev/architecture.md`; fixtures and golden files regenerated; `dev/e2e_erd.mjs`, `e2e_erd_copy.mjs`, `e2e_touch.mjs --erd`, metrics script, examples and README screenshot |

Wave B starts after wave A's engine output is stable. Both waves follow the v2 pattern: Sonnet subagents, with all suites run before the squash.

Also included: the peek cards under the expanded card (move them outside the card's box) and the chip ellipsis (wrap long names onto 2 lines).
