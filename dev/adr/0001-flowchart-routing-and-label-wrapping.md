# ADR 0001: Flowchart Edge Routing, Parallel Port Splitting, and Label Wrapping

- **Status:** Proposed
- **Date:** 2026-11-21
- **Scope:** `assets/types/flowchart/engine.js`, `assets/types/flowchart/flowchart.js`, `assets/types/flowchart/flowchart.css`

## Context

Inspection of a `flowchart TB` diagram (*E-Commerce Order Fulfillment Process*) revealed three layout, routing, and label rendering defects:

1. **Under-routing of terminal branch (`Retries < 3?` → `Order Cancelled`):**
   - `assets/types/flowchart/engine.js` places `order_cancelled` at topological rank 6 (`x = 730`), on the same row as `update_payment` and `confirm_backorder`, directly above `reserve_stock` and `capture_funds` (`x = 883`, rank 7).
   - The upper corridor (`x = 665..730`) is already occupied by `Retries < 3? → Update Payment Method` and `Items in Stock? → Accept Backorder Delay?`.
   - The middle corridor (`x = 802..883`, above `Reserve Inventory Stock` and `Capture Payment Funds`) is 81px wide and already carries `Accept Backorder Delay? → Reserve Inventory Stock` at `x ≈ 842`. In `altRoutes` (`assets/types/flowchart/flowchart.js`), stepping by `STEP = 16` from `bounds.minX - 24` causes every candidate in that corridor to hit `COST.near` (`2500`, within 18px of the sibling run), `COST.overlap` (`20000`), or `COST.nearNode` (`600`, within 14px of adjacent nodes).
   - Routing below `Capture Payment Funds` (`x ≈ 990`) incurs only one crossing (`COST.cross = 1750`) and zero near/overlap penalties, so `routeCost` selects the long under-route.

2. **Unnecessary bends on `Items in Stock?` → `Accept Backorder Delay?`:**
   - Connector `A` is placed directly above `Accept Backorder Delay?`, so `Accept Backorder Delay? → A` exits from its top vertex (`fromPort = 'left'` in transposed TB coordinates).
   - `portClashes` (`assets/types/flowchart/flowchart.js`, `COST.portClash = 2500`) penalizes sharing `left`/`right` sides (screen top/bottom in TB) between an entry and an exit. Port splitting (`2b`, `PORT_SLOT = 10`) and spreading (`5a1`, `SPREAD = 24`) currently only run on `top`/`bottom` sides (screen left/right in TB), and `5a1` explicitly skips `decision` nodes because diamond corners are single points.
   - Right entry (`toPort = 'bottom'`) via a 1-bend route is blocked by `Order Cancelled` and `Update Payment Method` on the same row (`x = 730`).
   - Left entry (`toPort = 'top'`) from `Items in Stock?`'s left side (`fromPort = 'top'`) is discarded in `altRoutes` because `Accept Backorder Delay?` sits at `y = 32`, making `g = Math.min(sy, ey) - d <= 4 < 8` trigger the `if (g < 8) return;` guard. The `deep` fallback (`fp = 'right'`, `tp = 'top'`) uses `bounds.minY - 24 = 8`, producing a 3-bend wrap-around instead of a 1-bend or 2-bend route.

3. **Unwrapped / overflowing edge label (`Items Pass QC?` ↔ `Swap Damaged Item`):**
   - In `assets/types/flowchart/flowchart.js`, `labelContainer.style.maxWidth` checks `if (fRect && tRect && tRect.x > (fRect.x + fRect.w))` using the transposed `rects` (`fromRect`/`toRect`). In `TB` mode, `x` is the vertical flow axis, so same-row nodes across lanes have `tRect.x === fRect.x`. Right-to-left edges in `LR` mode also fail this check. Consequently, `maxWidth` falls back to `LE.LABEL_MAX_W` (`140px`), which exceeds the ~72px horizontal gap between the nodes and causes the label (`"Recheck ádflkj áádfd"`) to overflow onto `Items Pass QC?`.
   - `findLabelPos` already computes `horizClearance` in screen coordinates, but the DOM label sizing ignores it.
   - There is no multi-line ellipsis truncation or hover reveal for labels that exceed the available gap.

## Decision

We will address these issues with the following targeted changes:

1. **Dead-end placement and corridor sampling:**
   - In `assets/types/flowchart/engine.js`, allow dead-end terminal nodes (`type === 'end'` with no outgoing edges) to sink below the main flow row when their lane has space, or
   - In `assets/types/flowchart/flowchart.js` (`altRoutes`), sample exact mid-corridor offsets between node rows (keeping ≥ 20px clearance from sibling horizontal segments) rather than relying solely on a fixed `STEP = 16` grid from `bounds.minX`.

2. **Parallel port splitting on `left`/`right` and removing the `g < 8` edge-drop:**
   - Extend `2b` (`PORT_SLOT`) port splitting to `left`/`right` sides (screen top/bottom in `TB`) so an incoming and outgoing edge can run as parallel stubs (`±10px` from `cx`) instead of forcing a 3-bend detour. For `decision` diamonds, this lands on the slanted edge off the tip, matching the existing tolerance used on `top`/`bottom` vertices.
   - Remove or relax the `g < 8` early return in `altRoutes` (`fp === tp` U-turn candidates) to match `deep` (`bounds.minY - 20`), since `outerExtra` already expands stage bounds for outer routes.
   - Where possible in `engine.js`, prefer placing outgoing connector targets (`A`) below or beside a decision node rather than directly above it when an incoming edge approaches from above.

3. **Screen-space gap clamping and truncation for edge labels:**
   - Compute `horizGap` in screen coordinates (using `y`/`h` of transposed `rects` in `TB` and `x`/`w` in `LR`, symmetrically for both directions) or reuse `horizClearance` from `findLabelPos` when setting `labelContainer.style.maxWidth`.
   - Clamp `.edge-label-text` in `assets/types/flowchart/flowchart.css` (e.g., 2 lines with `overflow: hidden` and `text-overflow: ellipsis`) when text exceeds the available gap, and expose the full `edge.label` on hover (`title` / hover expansion).

## Consequences

- **Positive:** Eliminates unnecessary long under-routes, reduces 3-bend wrap-arounds to 1-bend or 2-bend routes, and prevents long edge labels from colliding with adjacent nodes in `TB` and reverse `LR` edges.
- **Trade-off:** Splitting `left`/`right` ports on a `decision` diamond offsets the stub slightly onto the slanted edge off the vertex tip; this is consistent with existing `top`/`bottom` vertex behavior in `flowchart.js`.
- **Verification:** Changes must be verified with `dev/e2e_arrows.mjs`, `dev/e2e_connectors.mjs`, `dev/check_overflow.mjs`, and `dev/test_audit_flowchart.py` across both `TB` and `LR` directions and light/dark themes.
