# Plan: C4 Layered & Cloud Reference Architecture Upgrade

Status: **Completed**

## Goal

Upgrade the existing `c4` diagram type so it can represent cloud reference architectures and multi-stage processing / data-ingestion pipelines (comparable in information density to Azure / AWS reference architectures) while keeping low-level branching logic out of scope and preserving 100% backward compatibility with existing C4 diagrams.

## Agreed Design Scope

1. **Extend existing `c4`** (no separate diagram type).
2. **Horizontal and vertical layers:** `arrange: "layers"` supports both top-to-bottom bands (existing default) and left-to-right columns (such as `Sources → Ingest → Store → Process → Serve → Consume`), with nested depth-2 sub-zones laying out cleanly inside either orientation.
3. **Layer-to-layer (group-endpoint) and component-to-component arrows:** Relations may connect **groups to groups** (layer-to-layer or sub-zone-to-sub-zone), **elements to elements**, or **mixed** (layer-to-element). Elements inside a connected layer do not require individual component arrows.
4. **Cross-layer arrows allowed cleanly:** Relations that skip one or more layers (for example, a streaming hot path skipping `Store`, or a feedback/alert path) produce **no audit warning** and route cleanly through outer corridors.
5. **Flexible shared (cross-cutting) layers:** Multiple shared layers may sit on any side (`N` top, `S` bottom, `W` left, `E` right) of the main layers, spanning either all main layers or a contiguous range of specific layers. Elements inside a shared layer do not require relations (no unconnected-element warning), while optional internal or cross-layer arrows remain allowed.
6. **Numbered step badges on arrows:** Optional manual step labels (such as `"1"`, `"2a"`, `"2b"`, `"5c"`) on any relation in any C4 layout (`surround`, `flow`, horizontal or vertical `layers`), with a toolbar toggle to show/hide them.
7. **Arrow colors in the shared legend:** Optional `color` on any relation reusing the existing 9-slot palette and single `colorKey` legend (SSOT).
8. **Full browser editing parity:** Connect layers/groups directly as well as elements, edit step badges, arrow colors, shared-layer placement/span, `Steps` visibility toggle, and horizontal/vertical layer switching directly in the page, with Undo/Redo and byte-identical Save round-trip.
9. **Visual style & icons:** Keep C4's existing card, frame, and light/dark theme style, keep Devicon + local cloud icon packs, and add a small set of missing generic pipeline/AI outline icons to `assets/icons/default.json`.

---

## Data Contract (SSOT, Backward-Compatible `schemaVersion: 1`)

All new fields are optional and omitted when unset/default, so existing C4 files and golden fixtures remain unchanged byte-for-byte.

### Top-level keys (`C4_KEYS` in `scripts/disk_format.py` and `DISK_KEYS` in `assets/types/c4/c4.js`)

```text
diagramType, schemaVersion, title, arrange, layerDirection, showTech, showNotes, showSteps, colorKey, groups, elements, relations, notes, layout
```

| Field | Type | Default / Omission | Rules |
|---|---|---|---|
| `layerDirection` | `"horizontal" \| "vertical"` | `"horizontal"` (omitted when horizontal or when `arrange !== "layers"`) | Sets whether `arrange: "layers"` stacks top-to-bottom bands (`horizontal`) or left-to-right columns (`vertical`). |
| `showSteps` | `boolean` | `true` when any relation has `step` (omitted when default) | Controls visibility of step badges in the viewer/export. |

### Groups

| Field | Type | Default / Omission | Rules |
|---|---|---|---|
| `shared` | `boolean` | `false` (omitted) | Marks a top-level group as a cross-cutting shared layer in `arrange: "layers"`. Must be a top-level group (`parent` absent) and `kind: "boundary"`. |
| `side` | `"N" \| "S" \| "E" \| "W"` | Existing field; for `shared: true`, defaults to `"S"` when `layerDirection === "vertical"`, `"E"` when `layerDirection === "horizontal"` | Edge of the main layers where this shared layer sits. Multiple shared layers on the same side stack outward in input order. |
| `span` | `string[]` | Omitted (spans all main layers) | Ordered list of main layer group IDs this shared layer covers (minimum 1). Must reference existing top-level non-shared groups in the same diagram and form a contiguous range in layer order. Renamed automatically by `_rename_c4_ids` / `renameGeneratedIds`. |

### Relations

| Field | Type | Default / Omission | Rules |
|---|---|---|---|
| `from`, `to` | `string` (element ID or group ID) | Required | May join two elements, two groups (e.g., layer-to-layer or sub-zone-to-sub-zone), or a group and an element. Cannot join an item to itself or a group to its own ancestor/descendant. |
| `step` | `string` | Omitted | Short manual sequence badge (`"1"`, `"2a"`, `"5c"`), trimmed, max 8 characters. Allowed in any `arrange` mode. Omitted on merged arrows when a group is collapsed. |
| `color` | `string` | Omitted | Palette slot `"1"`..`"9"` or custom hex (validated via `color_kind`, normalized via `_slot_colors` / `slotColors`, surfaced in `colorKey`). |

### Validation & Audit Rules

- **Boundary validation (`validate_c4` in `scripts/disk_format.py`):**
  - `layerDirection`: if present, must be `"horizontal"` or `"vertical"`.
  - `showSteps`: if present, must be `bool`.
  - Group `shared`: if present, must be `bool`; if `true`, cannot have `parent` and cannot have `kind: "system"`.
  - Group `span`: if present, must be a non-empty list of valid top-level non-shared group IDs.
  - Relation `from` / `to`: must exist in `eids | gids` (element or group ID); cannot be equal, and neither end may be an ancestor of the other.
  - Relation `step`: if present, must be a non-empty string.
  - Relation `color`: if present, must pass `color_kind(color) != "bad"`.
- **Model audit (`scripts/audit_c4.py`):**
  - **Group-endpoint relations supported:** Validate `from`/`to` against `emap | gmap`; reject self-links and ancestor-descendant links as errors.
  - **Connected-via-layer exemption:** An element is considered connected if either it has a direct relation OR any ancestor group has a relation (no unconnected-element warning for services inside a layer that connects layer-to-layer).
  - **Cross-layer skip warning removed:** Do not warn when `abs(a - b) > 1` in `arrange: "layers"`.
  - **Shared-layer elements exempt from unconnected warning:** Elements whose ancestor group has `shared: true` do not trigger `"has no relation"`.
  - **Contiguous span check:** Warn/error if `span` on a shared group is non-contiguous in the main layer order (or references a non-main group).
  - **Step badge budget:** Warn if `len(step) > 8` characters.
  - **Unused `shared`/`span`/`layerDirection`:** Emit `[INFO]` (not warning) if `shared` or `layerDirection` is set when `arrange !== "layers"`.

---

## Implementation Phases

### Phase 1: Schema, Codec, Validation & Audit

**Files:**
- `scripts/disk_format.py`
- `scripts/audit_c4.py`
- `assets/types/c4/c4.js` (`DISK_KEYS`, `renameGeneratedIds`, `toDisk`, `fromDisk`)
- `dev/tests/unit/test_c4_codec.py`
- `dev/tests/unit/test_audit_c4.py`
- `dev/tests/unit/check_golden.py` + `dev/tests/fixtures/c4/golden/`

**Work:**
1. Update `C4_KEYS`, `C4_LAYER_DIRECTIONS = ("horizontal", "vertical")`, `validate_c4` (allowing element or group IDs on `from`/`to` and rejecting ancestor-descendant relations), `_rename_c4_ids` (including `g["span"]`), `_slot_colors(d, "elements", "groups", "relations")` in `scripts/disk_format.py`.
2. Mirror exact key order, ID renaming (`g.span`), and `slotColors(d, 'elements', 'groups', 'relations')` in `assets/types/c4/c4.js` so Python and JS `toDisk`/`fromDisk` stay byte-identical.
3. Update `scripts/audit_c4.py`:
   - Accept group IDs in relation `from`/`to` and reject ancestor-descendant links.
   - Treat elements inside a group that has a relation as connected (no unconnected-element warning).
   - Remove the skipped-layer warning in `layers` mode.
   - Exempt elements inside `shared: true` groups from the unconnected-element warning.
   - Validate `span` contiguity and `step` length budget (<= 8 chars).
4. Add unit tests for all new fields, group-to-group and mixed relations, ancestor-descendant rejection, ID-renaming of `span`, color-slot normalization on relations, and add a new golden fixture exercising vertical layers + layer-to-layer arrows + shared layers + step badges + colored arrows.

**Exit check:** `python3 -m unittest dev/tests/unit/test_c4_codec.py dev/tests/unit/test_audit_c4.py` and `python3 dev/tests/unit/check_golden.py` pass.

---

### Phase 2: Layout Engine & Orthogonal Routing

**Files:**
- `assets/types/c4/engine.js`
- `assets/types/c4/route.js`
- `dev/tests/unit/check_c4_engine.mjs`
- `dev/tests/unit/check_c4_route.mjs`

**Work:**
1. **Resolve group endpoints in `c4Model` and `c4Links` (`engine.js`):**
   - Update `endNode(id)` to check both `m.eN.get(id)` and `m.gN.get(id)`. An open or collapsed visible group resolves to itself (attaching arrows to its outer frame border); a group hidden inside a collapsed ancestor resolves to that outermost collapsed ancestor tile.
   - Update `c4Links(m)` to resolve both `eN` and `gN` endpoints so sibling sub-zones or sibling layers connected group-to-group get proper link gaps and gutters.
   - Ensure `route.js` receives the frame box `{ x, y, w, h }` in `nodes[groupId]` for any group that is a relation endpoint, while excluding that group from its own obstacle-collision check so the arrow attaches cleanly to its outer border.
2. **Separate main layers vs. shared layers in `c4Rings` / `c4Place` (`engine.js`):**
   - Partition top-level groups in `arrange: "layers"` into `mainLayers` (in input order) and `sharedLayers` (`ref.shared === true`).
   - Horizontal layers (`layerDirection !== 'vertical'`): keep current top-to-bottom stacking and equal-width framing (`bands` share `[x0, x1]`).
   - Vertical layers (`layerDirection === 'vertical'`):
     - Size each main layer column vertically (`c4Size(m, g, true)`), with nested depth-2 sub-zones (`parent`) stacked cleanly inside their column while members inside a sub-zone lay out horizontally or as a compact flow depending on sibling links.
     - Place main layer columns left-to-right (`side = 'E'` progression) with consistent inter-column gutters scaled by cross-column edge count (`gutter(...)`).
     - Equalize column heights (`y0` to `y1`) across all expanded main layer columns in Auto-Tidy (`!m.pins`), mirroring how horizontal bands equalize widths.
3. **Place shared layers (`N`, `S`, `E`, `W`) with full or contiguous `span`:**
   - Compute each shared layer's span bounds along the main-layer axis from its `span` IDs (or all main layers if omitted).
   - Size horizontal shared layers (`N`/`S` on vertical columns, or `N`/`S` outside horizontal bands) as rows (`vert = false`) stretched to match their span width (or expanded if content is wider, centering cleanly).
   - Size vertical shared layers (`W`/`E` on horizontal bands, or `W`/`E` outside vertical columns) as columns (`vert = true`) stretched to match their span height.
   - Stack multiple shared layers on the same side outward with `C4.ringGap` separation (if two shared layers on the same side have non-overlapping `span` ranges, pack them on the same track; if their spans overlap, stack them on separate tracks so they never collide).
   - Keep `c4Order` barycentre ordering working along the column axis (vertical) for vertical layers and along the row axis (horizontal) for horizontal layers.
4. **Cross-layer routing & step badge geometry (`route.js`):**
   - Ensure cross-layer arrows (skipping 1+ columns or bands) route cleanly through outer corridors (above/below vertical columns, left/right of horizontal bands) without slicing through intermediate layer frames or colliding with shared layers.
   - Pass `step` and `color` through edge metadata (`data._edges`).
   - Compute deterministic step badge placement (`badge: { x, y, w, h }`) on the routed polyline (placed near the source/first clear segment or beside the label pill) and include badge boxes in the collision grid so badges never overlap nodes, frame tags, other edges, or label pills.
5. **Manual layout compatibility (`c4Relayout`):**
   - Moving a box or shared layer in manual mode preserves pinned positions and re-routes both element-level and group-level edges cleanly via `c4rDetours`.

**Exit check:** `node dev/tests/unit/check_c4_engine.mjs` and `node dev/tests/unit/check_c4_route.mjs` pass, including new tests for vertical columns, layer-to-layer group endpoints, nested sub-zones, multi-side partial-span shared layers, cross-layer routing, and zero badge/label overlaps.

---

### Phase 3: Rendering, Styling, Icons & Motion

**Files:**
- `assets/types/c4/c4.js` (`renderEdges`, `renderColorKey`, group rendering)
- `assets/types/c4/c4.css`
- `assets/icons/default.json`
- `assets/types/c4/meta.json` (if icon picker groups list new icons)

**Work:**
1. **Arrow colors & arrowheads (`c4.js`, `c4.css`):**
   - Apply `edge.color` (resolved through theme palette tokens or custom hex) to the SVG path stroke, arrowhead marker (color-matched via `context-stroke` or per-slot marker), and subtle label border/accent.
   - Update `renderColorKey` to collect palette slots used by `relations` alongside `groups` and `elements` into the single `colorKey` legend.
2. **Step badges (`c4.js`, `c4.css`):**
   - Render each edge's `step` badge (when `showSteps !== false` and `!merged`) as a high-contrast pill/circle using theme tokens (checked for WCAG contrast in both light and dark themes).
   - Hide badges cleanly when `showSteps === false` (leaving labels undisturbed).
3. **Shared-layer framing (`c4.css`):**
   - Give `shared: true` groups a distinct subtle styling cue (e.g., muted neutral fill + clean tag treatment) that works in both light and dark themes without breaking custom group colors.
4. **Generic pipeline/AI icons (`assets/icons/default.json` + picker in `c4.js`):**
   - Add a small curated set of MIT-licensed Tabler outline icons (e.g., `stream`, `brain`, `chart`, `sensor`, `workflow`) to `default.json` and expose them in the C4 icon picker under Infrastructure / Data / Messaging.
5. **Motion (`motion` skill compliance):**
   - Before implementing any interactive transition (switching horizontal ↔ vertical layers, toggling `Steps`, toggling a group's `shared` state), load the `motion` skill and follow the repo rule **morph, not fade** (reuse `morphRect` / `ghostMorph` in `assets/shell/shell.js`).

**Exit check:** Visual + contrast check in light and dark themes; zero hardcoded colors or font sizes outside tokens.

---

### Phase 4: Interactive Browser Editing & Toolbar

**Files:**
- `assets/types/c4/toolbar.html`
- `assets/types/c4/c4.js`
- `assets/types/c4/c4.css`
- `assets/types/c4/help.html`

**Work:**
1. **Toolbar (`toolbar.html`, `c4.js`):**
   - Add **Layers orientation** control (Horizontal / Vertical switch or arrange popover entry, visible/active when `arrange === "layers"` or allowing quick switch between `surround`, `flow`, `layers-horizontal`, `layers-vertical`) — triggers Auto-Tidy with geometry morph.
   - Add **Steps** switch (`btn-steps`, mirroring `btn-notes`), showing the count of numbered arrows and hidden when no arrow has a step (or always available in edit mode when steps exist; stays interactive in `?present` mode just like `Level` and `Notes`).
2. **Arrow action bar (`c4.js`):**
   - Add `step` button (inline input/prompt to set or clear `"1"`, `"2a"`, etc.; shows validation feedback if > 8 chars).
   - Add `color` swatch row (identical to elements/groups; picking an unnamed slot opens the `colorKey` name prompt).
   - Keep merged arrows ("N relations") clean (no step editor on merged arrows).
3. **Group action bar & connecting (`c4.js`):**
   - Add `connect` action to the group action bar (and allow group frames as valid connection targets, rejecting self or ancestor-descendant connections) so users can draw layer-to-layer or layer-to-component arrows directly in the browser.
   - When `arrange === "layers"` and the group is top-level `boundary`, add a **Shared** toggle (`data-act="shared"`).
   - When `shared === true`, expose `side` (`N`, `S`, `E`, `W`) and a **Span** multi-select menu (`All layers` or toggle individual main layers, enforcing a contiguous range).
4. **Undo/Redo & Save:**
   - Every new edit pushes a clean undo snapshot and round-trips cleanly through `toDisk` / `fromDisk` with zero diff against Python `disk_format.py`.

**Exit check:** New e2e tests in `dev/tests/e2e/e2e_c4.mjs` covering toolbar switches, layer-to-layer connecting, arrow step/color editing, shared-layer toggling/spanning, undo/redo, present mode, and Save byte-identity.

---

### Phase 5: Documentation, Examples & Full Verification

**Files:**
- `references/types/c4.md`
- `SKILL.md`
- `dev/examples/example-c4-pipeline.json` (new vertical data-ingestion / AI reference architecture example showcasing columns, layer-to-layer and component-to-component arrows, nested hot/cold sub-zones, partial + full shared layers, cross-layer arrows, step badges, and colored paths)
- `dev/samples/example-c4*.html` (rebuilt via `dev/tools/build_examples.py`)

**Work:**
1. Update `references/types/c4.md` with concise rules and a compact example for `layerDirection: "vertical"`, group-endpoint (layer-to-layer) relations, `shared` + `side` + `span`, relation `step` + `color`, and `showSteps`, plus updated action-bar and toolbar docs.
2. Update `SKILL.md` C4 summary line so agents know `c4` handles horizontal/vertical processing layers, layer-to-layer and component-to-component relations, shared platform bands, step badges, and colored paths (and keeps low-level branching out of scope).
3. Add `dev/examples/example-c4-pipeline.json` and rebuild/verify all samples.
4. Run full verification suite:
   - `python3 -m unittest dev/tests/unit/test_c4_codec.py dev/tests/unit/test_audit_c4.py`
   - `python3 dev/tests/unit/check_golden.py`
   - `node dev/tests/unit/check_c4_engine.mjs`
   - `node dev/tests/unit/check_c4_route.mjs`
   - `node dev/tests/e2e/e2e_c4.mjs` (and `e2e_c4_drag.mjs`, `e2e_c4_fit.mjs`, `e2e_c4_export.mjs`, `e2e_playground.mjs`)
   - `python3 dev/tools/build_examples.py && python3 dev/tools/build_examples.py --check`

---

## Key Risks & Edge Cases to Guard Against

- **Byte-identity drift between Python and JS codecs:** Adding `layerDirection`, `showSteps`, `shared`, `span`, `step`, group-endpoint relations, and relation `color` touches both `scripts/disk_format.py` and `assets/types/c4/c4.js`. Mitigate with golden round-trip tests in Phase 1 and Save round-trip e2e in Phase 4.
- **Group-endpoint obstacle self-collision in `route.js`:** When an arrow connects directly to a group's outer border, `route.js` must treat that endpoint group as a target box (not an obstacle blocking the port) while still avoiding every sibling group and interior element.
- **Dense cross-layer routing in vertical columns:** Multiple arrows skipping 2–3 columns (like `Store → Consume` and `Ingest → Process`) can collide with top/bottom shared layers if corridor margins are not reserved between the main columns and shared layers. Mitigate by computing outer corridor clearance before positioning `N`/`S` (or `W`/`E`) shared layers.
- **Non-contiguous `span` after group reorder or deletion:** If a user deletes a main layer in the middle of a shared layer's `span`, prune the deleted ID from `span` (or fall back to `All layers` if `span` becomes empty) inside the delete handler and undo step.
- **Badge-to-label and badge-to-box collisions:** Register step badge rectangles in `route.js`'s spatial hash grid before label placement so pills and badges never overlap.
