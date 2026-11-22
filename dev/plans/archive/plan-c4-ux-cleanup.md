# Plan: C4 Diagram UX Cleanup

Status: Completed

## Scope

Streamline the C4 diagram editor (`assets/types/c4/`):

1. **Level dropdown picker (ready for Level 3 later) & smart collapse fix**
   - Replace `#btn-level-1` and `#btn-level-2` in `assets/types/c4/toolbar.html` with an ERD-style `dock-pop-wrap` picker (`#btn-level` + `#level-pop`, `role="radiogroup"`, with `data-level` on the `.dock-pop-wrap` so `?present` keeps it visible).
   - Distinct icons for Level 1 (Context, e.g. `server` or single-box glyph) and Level 2 (Containers, e.g. `layers` or `type-c4`), plus `.btn-count` badge showing `L1` / `L2` (hidden when mixed or disabled).
   - Guard `setOpen` in `assets/shell/shell.js` so disabled triggers (`trigger.disabled`) cannot open their popover on hover.
   - Fix `levelsWanted` / `currentLevel` in `assets/types/c4/c4.js`:
     - Collapsible groups for Level 1: groups where `g.kind === 'system'` OR that contain container-tier elements (`container`, `database`, `queue`) directly (not outer ownership frames that only wrap systems/externals or other groups).
     - Level 2 expands every collapsed group (including any group collapsed manually via its chevron).
     - When there are no collapsible groups AND no currently collapsed groups, disable `#btn-level` with a helpful tooltip and do not highlight Level 1 vacuously (`[].every(...)` bug fixed).

2. **Connector label box: hugging width & balanced padding**
   - In `assets/types/c4/c4.css`, `assets/types/c4/c4.js`, `assets/types/c4/route.js`, `assets/types/c4/engine.js`:
   - Anchor `.c4-label` by its center `(lx, ly)` with `transform: translate(-50%, -50%)` and let width/height size naturally to hug content (`width: auto`, `height: auto`, `padding: 4px 10px`, `gap: 1px`, `max-width: 240px`).
   - Update `PILL_H` in `route.js` / `engine.js` so two-line labels (verb + `[tech]`) get accurate vertical clearance (`38px` for two-line or `36px`/`38px` clearance) and update goldens if engine `labelBox` changes.
   - Verify SVG and PNG export match on-screen labels (`e2e_c4_export.mjs`).

3. **Connector anchor circles: match Flowchart**
   - In `assets/types/c4/c4.css`: align `.c4-port` with Flowchart's `.port` circles:
     - 12px content-box + 2px border (16px diameter) centered on card edges (`top: 0 / 100%`, `left: 0 / 100%`, `transform: translate(-50%, -50%) scale(0.55)` -> `scale(1)` on `.c4-node:hover`, `scale(1.35)` on `.c4-port:hover`).
     - `background: var(--node-bg)`, `border: 2px solid var(--primary)`, `box-shadow: var(--shadow-chip)`.
     - Hover-only on desktop; `@media (hover: none)` shows on `.c4-node.selected`; touch devices keep larger hit area.
     - Hidden while dragging a connection (`body.c4-dragging .c4-port`), in multi-select, and in `?present`.
     - Respect `prefers-reduced-motion`.

4. **Direct inline editing on cards & connectors**
   - **Cards:** Double-click `.c4-name`, `.c4-tech`, or `.c4-desc` to edit each field inline.
     - While editing `.c4-tech`, strip `[` and `]` (re-wrap on display; empty deletes `tech`).
     - While editing `.c4-desc`, allow editing description (empty deletes `description`).
     - When a single element is selected (not presenting/exporting) and `tech` or `description` is empty, show subtle clickable/double-clickable `[data-export-skip]` ghost placeholders (`+ tech`, `+ description`) inside `.c4-text` (hidden when unselected).
     - Pressing `Tab` / `Shift+Tab` while inline-editing cycles Name -> Tech -> Description.
     - Update `c4Card` in `assets/types/c4/engine.js` so cards with both `tech` and `description` have enough height without clipping.
   - **Connectors:** Double-click `.c4-label-text` or `.c4-label-tech` directly inside `.c4-label` to edit inline.
     - When a single direct arrow is selected and has no `tech`, show a subtle `[data-export-skip]` `+ tech` placeholder inside `.c4-label`.
     - New connections immediately open inline editing on `.c4-label-text` (required label; `Esc` or empty cancels and removes the new connection as one atomic undo step, preserving duplicate-relation checks).
     - Enter / F2 on a focused/selected arrow edits its label inline.

5. **Action bar cleanup & dead-code removal**
   - **Element (top-level, `!o.group`):** `Icon`, `Centre`, `Delete` + Colours.
   - **Element (inside a group, `o.group`):** `Icon`, `Delete` + Colours.
   - **Group (top-level, `!g.parent`):** `Centre`, `Ungroup`, `Delete` + Colours.
   - **Group (nested, `g.parent`):** `Ungroup`, `Delete` + Colours.
   - **Arrow (direct):** `Async`, `Reverse`, `Delete` (merged: `N relations`, `Delete`).
   - **Multi-select:** `N selected`, `Group` (when elements selected), `Delete N` + Colours.
   - Remove unused UI code: `openDetails`, `openPrompt` (if unused), `GROUP_KINDS`, `SIDES`, `setKind`, click-to-connect (`connecting`, `startConnect`, `endConnect`, `finishConnect`, `hint`), and unused CSS for `.c4-pop` / `.c4-prompt` if no longer referenced. Keep `kind`, `core`, `side` fully intact in the data model, engine, audit, codec, and Mermaid export.
   - Update `assets/types/c4/help.html`.

6. **Verification**
   - Update & pass unit, golden, theme, contrast, and E2E tests (`check_c4_engine.mjs`, `check_c4_route.mjs`, `check_golden.py`, `test_audit_c4.py`, `test_c4_codec.py`, `check_themes.py`, `check_contrast.py --strict`, `e2e_c4.mjs`, `e2e_c4_drag.mjs`, `e2e_c4_export.mjs`, `e2e_motion.mjs`, `e2e_playground.mjs`).
