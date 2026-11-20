# Plan: C4 / system landscape diagram type (`diagramType: "c4"`)

Add a diagram for system landscapes as the fifth type, next to `flowchart`, `sequence`, `erd` and `usecase`. It shows people (actors), the systems they use and the interactions between systems, at the zoom levels of the C4 model. v1 ships Level 1 (system context) and Level 2 (containers). Level 3 (components) is out of v1 but the model, engine, codec and audit are built so it is a data change plus one constant, not a rewrite (see Level 3 readiness). Same promise as the other types: the agent writes a short logical JSON, the tooling lays it out, audits it and assembles one standalone, editable page (or claude.ai Artifact) with the shared shell.

A clickable prototype of the target look exists as a claude.ai Artifact made in the session that produced this plan (Level 1, Level 2, frames, bent arrows). It uses hand-placed nodes and hardcoded colours, so it is a visual reference only.

## Research summary

### Why C4 and not another notation

- C4 has four shapes: person, software system, container, component. Every arrow carries a label and a technology tag ("Charges cards [REST]"). Business and engineering readers both follow it.
- Zoom is built in: Level 1 is the landscape, Level 2 opens one system into its containers, Level 3 opens one container.
- Alternatives and why they are not the default: ArchiMate application cooperation (enterprise-wide, strict semantics, heavy), UML component and deployment (infrastructure focus), data flow diagrams (data focus), use case (already a type; actors and goals, but no system-to-system links), sequence (order over time; already a type).

### Arrows: orthogonal, not diagonal

Bent arrows line up with the box grid, let many arrows share one side of a box, keep labels on a straight run, and stay readable as the diagram grows. Diagonals turn into a tangle past about 10 nodes. The flowchart engine already routes orthogonal arrows with the same label pill, so the type reuses that router.

### Icons and logos: licensing

Findings from the vendors' own pages (checked 2026-11-20):

- **AWS Architecture Icons**: AWS allows customers and partners to use them to create architecture diagrams, and asks that they keep their shipped colour, format and size. AWS's own redistribution terms are in the package they ship; a community answer treats the diagrams as trademark assets.
- **Azure architecture icons**: Microsoft permits use in architectural diagrams, training materials and documentation, forbids cropping, flipping, rotating or distorting, forbids using them to represent your own product, and says copying and distributing is limited to that permitted use unless Microsoft gives explicit permission.
- **Simple Icons** (brand logos): the artwork is CC0, but the licence says it waives no trademark rights. I could not confirm which cloud-provider marks it carries today; verify before bundling.

Consequence: bundling vendor logo SVGs into this repo and shipping them inside every generated page is redistribution, which these terms do not clearly allow. Generic icons are safe (the repo already ships Lucide, ISC). So icons come in three tiers, and only the first two ship in the repo.

## Goals

- One diagram type that covers Level 1 and Level 2 from one model, with system boundaries as collapsible frames, and no code that assumes there are only two levels.
- Styling and behaviour identical to the flowchart wherever the element is the same: node tiles, palette slots, edge lines and label pills, frame tags, dock, action bar, search, undo, Save, theme, `?present`.
- Icons on every element: generic by default, brand logos when the user supplies a pack.
- Scales from a handful of elements to thousands: large landscapes open with groups collapsed and arrows aggregated.
- Deterministic layout; the file format is the public API.

## Non-goals (v1)

- Level 3 (components) UI, authoring guidance and examples in v1. The structure for it is in place, switched off by one limit.
- Deployment and dynamic C4 views.
- Bundling AWS, Azure or Google Cloud logo files in the repo.
- Import from Structurizr or PlantUML C4, and merging several Mermaid C4 levels into one file. Mermaid C4 export and single-level import are phase 6, optional (see Mermaid C4).
- Force-directed or diagonal layout.

## Data

Logical JSON the agent writes. Key order is fixed: `diagramType, schemaVersion, title, showTech, showNotes, colorKey, groups, elements, relations, notes, layout`.

```json
{
  "diagramType": "c4",
  "schemaVersion": 1,
  "title": "ShopCo system landscape",
  "groups": [
    { "id": "shopco", "name": "ShopCo", "kind": "boundary" },
    { "id": "platform", "name": "Order Platform", "kind": "system", "parent": "shopco", "collapsed": false },
    { "id": "third", "name": "Third-party services", "kind": "boundary" }
  ],
  "elements": [
    { "id": "cust", "kind": "person", "name": "Customer", "description": "Buys products online" },
    { "id": "api", "kind": "container", "name": "API Gateway", "tech": "Node.js, REST", "group": "platform", "icon": "server" },
    { "id": "orddb", "kind": "database", "name": "Order DB", "tech": "PostgreSQL", "group": "platform", "icon": "logo:postgresql" },
    { "id": "pay", "kind": "external", "name": "Payment Provider", "group": "third", "icon": "logo:stripe" }
  ],
  "relations": [
    { "from": "cust", "to": "api", "label": "Orders", "tech": "HTTPS" },
    { "from": "api", "to": "pay", "label": "Charges cards", "tech": "REST", "async": false }
  ]
}
```

- **Element kinds:** `person`, `system`, `container`, `component`, `database`, `queue`, `external`. The kind sets the default shape and icon; `icon` and `color` (palette slot `c1` to `c8`) override.
- **Groups:** `kind` is `boundary` (an ownership or trust frame, such as "Third-party services") or `system` (a software system whose inside is the next level). Groups form a tree of any depth in the model, engine and codec; v1 allows depth 2 and rejects deeper nesting in the audit only. An element belongs to at most one group.
- **Relations:** between elements only. `label` is required (C4 requires it); `tech` is optional but warned about on container-to-container links; `async: true` draws a dashed line.
- **One model, all levels.** The level is the collapse state of the `system` groups. A collapsed group draws as one system box, and relations that cross its border are aggregated onto it (one arrow per neighbour, labelled with the count when it merges several). Level 1 is every system group collapsed; Level 2 is one expanded. `collapsed` is saved, so the page reopens where the user left it.
- **Disk format:** a trailing `layout` map `{id: {x, y}}` (elements, then groups), as the ERD and use case types. `toDisk` drops every `_`-prefixed field, sizes, points and canvas. The codec lives in `scripts/disk_format.py`.

## Level 3 readiness

Level 3 is the same operation one level down: a `container` expands into its `component` elements. Four rules keep v1 from blocking it.

1. **Groups are a tree, not two tiers.** `groups[].parent` is recursive everywhere: the codec, the engine's compound layout (one function that lays out a group by laying out its children, which may be groups), collapse and aggregation. No code branches on "system" versus "container"; behaviour hangs on `collapsed` and on having children.
2. **One limit, one place.** `MAX_GROUP_DEPTH = 2` lives in `scripts/audit_c4.py` and is the only thing that makes v1 reject a third level. The group `kind` enum already reserves `container`; the audit rejects it in v1 with the message "container groups arrive with Level 3".
3. **Aggregation uses the nearest visible ancestor.** A relation between two hidden elements is drawn between whichever ancestors are visible, at any depth, so Level 3 needs no new routing code.
4. **The Level control is a depth number.** "Show to depth N" sets `collapsed` on every group at depth N or deeper; v1 offers 1 and 2. The saved model stores `collapsed` per group, never a level number, so a future third level is not a migration.

A c4 fixture with a `component` element inside a `container` group runs through the engine and codec tests with the audit limit raised, so the readiness is tested, not assumed. Enabling Level 3 later means raising `MAX_GROUP_DEPTH`, allowing the `container` group kind, adding the third Level step, and adding docs and an example.

## Mermaid C4 (phase 6, optional)

Mermaid has a native C4 syntax: `C4Context`, `C4Container`, `C4Component`, `C4Dynamic`, `C4Deployment`. Mermaid marks it experimental, so the writer and reader are small and isolated in `assets/types/c4/mermaid.js` (`toMermaid(data, opts)`, `fromMermaid(text)`, the contract in `dev/architecture.md`) and may need updating when Mermaid changes. Unlike the use case type, which writes a flowchart marked `%% @type`, C4 targets Mermaid's own syntax, so it has its own parser and does not use `mermaid-flow.js`.

| Our model | Mermaid C4 | Round trip |
|---|---|---|
| `person`, `system`, `container`, `component`, `database`, `queue`, `external` | `Person`, `System`, `Container`, `Component`, `ContainerDb`, `ContainerQueue`, and the `_Ext` forms | clean |
| `name`, `tech`, `description` | label, techn, descr | clean |
| `groups` (`boundary`, `system`, nested) | `Enterprise_Boundary`, `System_Boundary`, `Boundary` | clean |
| `relations` with `label`, `tech` | `Rel(from, to, "label", "tech")` | clean |
| `async` | none | lost on export |
| `icon`, `color`, `collapsed`, `layout` positions | none | lost on export; icon and colour travel as `%% @icon` and `%% @color` comment lines that Mermaid ignores and our reader restores |

- **Export writes one level.** All `system` groups collapsed gives `C4Context`; one expanded gives `C4Container` for that system. A user who wants both copies twice. Mermaid has no collapse state.
- **Import reads one level** into the model; positions come from our engine. Merging a second level into the same file by element id is left out of v1.
- **Not mapped:** `C4Dynamic` and `C4Deployment` (non-goals), and Mermaid's layout statements (`Lay_*`, `UpdateLayoutConfig`), which our layout replaces.
- **Tests:** `dev/e2e_mermaid.mjs` gains c4: Copy as Mermaid then Import gives the same elements, groups and relations; the lossy fields round trip through the comment lines; text of another type or non-C4 text is refused with a message; a second copy gives identical text.

## Icons

Three tiers, one rendering path.

1. **Generic icons (ship in the repo).** Add the missing infrastructure glyphs to `assets/icons/default.json` in the existing Lucide style (monochrome, `currentColor`, 24x24): `queue`, `function`, `storage`, `cdn`, `gateway`, `container`, `kubernetes`-neutral `cluster`, `cache`, `lock`, `api`, `mobile`, `browser`, `bell`. Reuse the ones already there (`database`, `server`, `cloud`, `cpu`, `mail`, `credit-card`, `truck`, `shield`, `key`, `user`, `users`, `headset`, `monitor`, `kind-*`). Update `assets/icons/LICENSE` for any new source.
2. **Technology logos (ship in the repo only if the licence check passes).** A small pack of widely used technology marks (databases, brokers, frameworks) from Simple Icons, written as `logo:<slug>`. Open decision 1 covers whether to bundle it.
3. **Cloud-provider logos (never bundled).** AWS, Azure, Google Cloud and similar are loaded from a pack the user builds from the vendor's own download. `scripts/build_icon_pack.py <zip-or-dir> --name aws` reads the vendor package, keeps the vendor's terms file next to the result, and writes `icons/aws.json`. A page references `logo:aws/s3`. A diagram that names a missing pack still renders with the element's generic icon and gets one `[WARN]`. The vendor terms forbid recolouring and distortion, so these render in their own colours at a fixed aspect ratio.

Rendering: the existing `ui.icon(name, opts)` handles monochrome icons (stroke, `currentColor`). Add `ui.logo(name, opts)` next to it for filled, multi-colour logos: pack entries are `{ "vb": "0 0 64 64", "body": "<path .../>" }`, drawn at the icon token sizes. Colours stay inside the logo; the surrounding tile follows the theme. `scripts/tokens.py` gets the matching Python function, as it has for `icon_svg()`.

Export: PNG and SVG export inline the logos like any icon. A page that references a pack embeds only the entries it uses, so the single file stays standalone.

## Styling (follow the flowchart)

Nothing is invented; every item below already exists.

| Item | Source |
|---|---|
| Node tile, title, detail line, selected/hover/focus states | the flowchart node tile classes in `flowchart.css`, extended with `tech` as the detail line |
| Colour | palette slots `c1` to `c8` from `assets/tokens/default.json`; defaults by kind: person `c1`, system `c2`, container `c3`, database `c4`, external neutral. Never a hardcoded colour; contrast pairs added to the tokens and checked by `check_contrast.py` |
| Shapes | `shape-database` for databases; rounded tile for the rest; person uses the round avatar of the use case actor |
| Arrow, hover in/out highlight, selected state | `assets/components/edge.css` (`.edge-line`, `--edge-in`, `--edge-out`) |
| Relation label pill with tech tag | `.edge-label`, masking the line, same metrics (`edgeLabel`, `edgeWrap`) |
| Groups and system boundaries | `assets/components/frame.css`: `.frame-tag`, the collapse chevron, the dashed `.frame-summary` row |
| Dock, line action bar, multi-select bar, search, help drawer, colour key, notes | `assets/shell` and `assets/components`, unchanged |
| Routing | the flowchart's orthogonal router, extracted in phase 1 into `assets/shell/ortho-router.js` (`dev/architecture.md` says to extract shared code when a second type needs it; the layered ranking stays in the flowchart engine until c4 shows what it shares) |

Motion follows the repo principle, morph not fade: expanding a system group morphs its collapsed box into the frame (`morphRect`), the contained elements grow out of it, and relations re-route with the existing edge motion (`ghostMorph` for the aggregated arrows). Reduced motion jumps straight to the end state. This is covered by `e2e_motion.mjs`.

## Layout (engine.js)

Input is the model; output is positions, sizes, routes and the canvas. Reads text widths only from `TOKENS.font.metrics`, like the other engines.

1. Collapse state decides the visible items; relations that cross a collapsed group border are aggregated.
2. Rank visible items by relation direction (persons first, externals last when ambiguous), as the flowchart does; ties by input order so the result is deterministic.
3. Place each expanded group as a compound box: lay out its children inside, then treat the box as one item for the outer ranking.
4. Order within a rank by barycentre to cut crossings, as the flowchart and use case engines do.
5. Route every relation with the orthogonal router: ports spread along a side in the order of the other end, bend depth staggered so arrows nest, near-aligned ends become one straight line (the rules the prototype uses).
6. Direction is chosen like the flowchart (`choose_flowchart_direction`) unless `direction` is set.

Scale budget: ranking and ordering are O(n log n) per pass with a fixed pass count; a landscape that would open with more than 80 visible elements opens with `system` groups collapsed, and the audit says so. Expanding one group never re-lays-out the rest of the canvas (positions of everything outside the group are kept and shifted as one block).

## Engine contract

The one interface between `engine.js`, the page (`c4.js`) and the audit. Coordinates are canvas pixels, top-left origin. Derived fields are recomputed, never saved. Mirrors the use case contract.

`layoutDiagram(data)` mutates `data` in place (full layout); `routeDiagram(data)` keeps every element and group `x`/`y` and recomputes everything else (group boxes, arrows, labels, canvas), and calls `layoutDiagram` when any visible item has no `x`/`y`. Both read text widths only from `TOKENS.font.metrics` and sizes from `TOKENS`, and call `routeEdgesOrthogonal` from `assets/shell/ortho-router.js` for arrows. `layoutDiagram` must be a top-level function (loaded by `scripts/run_engine.mjs`). Deterministic: ties break by input order.

| Field | Meaning |
|---|---|
| `elements[].x, y, w, h` | Top-left and size of the tile. |
| `elements[]._hidden` | True when an ancestor group is collapsed; a hidden element has `w`/`h` 0 and no arrows of its own. |
| `groups[].x, y, w, h` | The frame box, tag band included; a collapsed group has the size of one system tile. |
| `groups[]._depth` | 1 for a top-level group, 2 for its child, and so on (any depth). |
| `groups[]._collapsed` | Effective state: true when the group or any ancestor is collapsed. |
| `data._edges` | The arrows actually drawn: `[{id, from, to, label, tech, async, count, members, points, path, labelBox}]`. `from`/`to` are the nearest visible ancestor (or the element itself) of each relation end; relations with the same visible pair and the same label merge, `count` is how many, `members` their indexes in `relations`; a merged edge with different labels shows the label of the first and `count`. |
| `data._edges[].points` | `[[x, y], ...]` orthogonal polyline, from `routeEdgesOrthogonal`. `path` is the SVG path with the router's corner rounding and hops. |
| `data._edges[].labelBox` | `{x, y, w, h}` of the label pill (label line plus `[tech]` line). |
| `data.canvas` | `{width, height}`. |

A relation whose two ends resolve to the same visible item (both inside one collapsed group) is not drawn. Direction (`direction` in the JSON, else chosen like the flowchart) sets the flow axis: top to bottom puts people first.

Disk format: unchanged from the codec (`layout` map `{id: {x, y}}`, elements then groups); `toDisk` drops every `_` field, sizes, `points`, `path`, `labelBox`, `_edges` and `canvas`.

## Interaction and UX

- Add from the dock: person, system, container, database, queue, external, group. Connect by dragging between ports; the new relation asks for its label immediately (required).
- Frame tag: click selects, chevron collapses or expands. "Level" shortcut in the toolbar sets every `system` group collapsed (Level 1) or expands the selected one (Level 2).
- Icon picker in the action bar: search across generic icons and installed packs; a missing pack is explained in the picker.
- Hover an element: its relations highlight in and out, the rest dim (the flowchart behaviour). Search finds elements, groups and relation labels.
- Present mode (`?present`) is read-only with Level switching allowed.
- Accessibility: every tile is focusable and named `name, kind, technology`; group tags are buttons with `aria-expanded`; arrows have text labels, so no meaning rests on colour alone.

## Audit (`scripts/audit_c4.py`)

Registered in `AUDITS`. Each rule has a failing and a passing unit case.

- Error: duplicate id, relation to an unknown id, group cycle, element in two groups, relation without a label, group nesting deeper than 2.
- Warn: container-to-container relation with no `tech`, element with no relation, person with no relation, external element inside a `system` group, a group with more than 12 visible children (suggest splitting), label longer than the pill limit, two relations between the same pair with the same label, missing icon pack.
- Info: the level the diagram opens at and why.
- Layout checks reuse the flowchart's crossing and long-arrow audits.

## Files

New, following the checklist in `dev/architecture.md`:

```
assets/types/c4/            meta.json c4.css c4.js engine.js toolbar.html stage.html chrome.html help.html default.json blank.json mermaid.js (phase 6)
assets/icons/logos.json     technology pack, only if open decision 1 allows it
references/types/c4.md      schema, authoring steps (people, systems, then containers), budgets, visual checklist, failure handling
references/examples/example-c4.json
scripts/audit_c4.py         registered in AUDITS
scripts/build_icon_pack.py  vendor zip to a local pack
dev/fixtures/c4/*.json      plus golden
dev/test_audit_c4.py, dev/e2e_c4.mjs
```

Changed: `SKILL.md` (type table, read-back line), `scripts/layout_engine.py` (`SUPPORTED_TYPES`, registry), `scripts/disk_format.py` (codec and key order), `assets/icons/default.json` and `assets/icons/LICENSE` (new glyphs, `type-c4`), `assets/tokens/default.json` (contrast pairs, a `c4` metric key if needed), the shared router module extracted from the flowchart engine, the playground switcher and `blank.json` (the playground deploys from `main` after `dev/e2e_playground.mjs`), `dev/architecture.md`, README type table.

## Phases

1. **Shared router and model.** Extract the orthogonal router (`computeAllEdgeRoutes` and its path and label helpers, which live in `flowchart.js`) into `assets/shell/ortho-router.js` with no behaviour change (golden unchanged). The layered ranking in `engine.js` is flowchart-specific and stays; extract it only when c4 shows what it truly shares. Schema, codec, `engine.js` with groups and collapse, `audit_c4.py`, fixtures and golden. `--layout` produces a static page.
2. **Render.** Tiles with generic icons, person avatar, database shape, groups as frames, orthogonal arrows with label pills, aggregated arrows, notes, colour key.
3. **Levels and motion.** Collapse and expand, the Level control, morph motion, reduced-motion path.
4. **Edit.** Dock, ports, label prompt, icon picker, action bar, Auto-Tidy, Save, undo, multi-select.
5. **Icon packs.** `ui.logo`, `build_icon_pack.py`, the technology pack if allowed, missing-pack fallback and warning, export.
6. **Docs and polish.** Help drawer, reference, example, playground entry, README, `check_themes.py` and `check_contrast.py --strict` clean. Optional: Mermaid C4 export and import.

Each phase ends with its checker passing and the playground e2e still green; no phase leaves the type half-built across layers.

## Tests

- `dev/test_audit_c4.py`: one failing and one passing case per audit rule.
- `check_golden.py`: engine output per fixture, and laying out the saved model again moves nothing. A fixture with 2,000 elements across 40 groups proves the scale budget (opens collapsed, lays out within the bench limit in `dev/bench_layout.py`).
- Flowchart golden stays byte-identical after the router extraction.
- Level 3 readiness: a fixture with system > container > component runs through the engine and codec with `MAX_GROUP_DEPTH` raised in the test; with the v1 limit the audit rejects it with the documented message.
- `dev/e2e_c4.mjs`: add each kind from the dock; connect and label a relation; collapse and expand a system group and check aggregated arrows appear and disappear; Level control; set an icon from the picker; a missing pack falls back to the generic icon with one warning; Save round trip keeps ids, collapse state and positions; `?present` disables editing.
- `e2e_motion.mjs` extended with c4: no orphan ghost after expand, collapse, undo bursts; reduced motion creates no animation.
- `check_themes.py` on every fixture under every theme; `check_overflow.mjs`; `build_examples.py --check`; vendor logos checked for unmodified aspect ratio.

## Decisions

Recommended, to confirm before phase 1.

1. **Type name:** `c4`.
2. **Levels:** one model with collapsible groups, not separate diagrams per level. v1 ships two levels; Level 3 is deferred (settled 2026-11-20) and kept cheap by the Level 3 readiness rules. Recommended because it keeps one source of truth and gives the morph between levels for free.
3. **Arrows:** orthogonal, one bend per route, shared with the flowchart router.
4. **Cloud-provider logos:** not bundled; user-built local packs from the vendor download.
5. **Technology logos (open decision 1):** bundle a small Simple Icons subset, or ship generic icons only? Recommended: generic icons in v1, technology pack after a licence and trademark check of the specific marks. Needs the user's call.
6. **Mermaid C4:** optional, phase 6; one level per copy, single-level import (settled 2026-11-20).
7. **Generic first:** the default icon for each kind is a generic glyph, so a diagram with no packs installed looks finished.

## Sources

- AWS Architecture Icons: https://aws.amazon.com/architecture/icons
- Azure architecture icons and terms: https://learn.microsoft.com/azure/architecture/icons
- Simple Icons (CC0 artwork, trademark rights not waived): https://simpleicons.org
- C4 model: https://c4model.com
- Mermaid C4 syntax (experimental): https://mermaid.js.org/syntax/c4.html
- Lucide (existing icon source, ISC): https://lucide.dev
