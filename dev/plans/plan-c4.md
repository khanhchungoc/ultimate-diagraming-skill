# Plan: C4 / system landscape diagram type (`diagramType: "c4"`)

Add a diagram for system landscapes as the fifth type, next to `flowchart`, `sequence`, `erd` and `usecase`. It shows people (actors), the systems they use and the interactions between systems, at the zoom levels of the C4 model. v1 ships Level 1 (system context) and Level 2 (containers). Level 3 (components) is out of v1 but the model, engine, codec and audit are built so it is a data change plus one constant, not a rewrite (see Level 3 readiness). Same promise as the other types: the agent writes a short logical JSON, the tooling lays it out, audits it and assembles one standalone, editable page (or claude.ai Artifact) with the shared shell.

A clickable prototype of the target look exists as a claude.ai Artifact made in the session that produced this plan (Level 1, Level 2, frames, bent arrows). It uses hand-placed nodes and hardcoded colours, so it is a visual reference only.

## Research summary

### Why C4 and not another notation

- C4 has four shapes: person, software system, container, component. Every arrow carries a label and a technology tag ("Charges cards [REST]"). Business and engineering readers both follow it.
- Zoom is built in: Level 1 is the landscape, Level 2 opens one system into its containers, Level 3 opens one container.
- Alternatives and why they are not the default: ArchiMate application cooperation (enterprise-wide, strict semantics, heavy), UML component and deployment (infrastructure focus), data flow diagrams (data focus), use case (already a type; actors and goals, but no system-to-system links), sequence (order over time; already a type).

### Arrows: orthogonal, not diagonal

Bent arrows line up with the box grid, let many arrows share one side of a box, keep labels on a straight run, and stay readable as the diagram grows. Diagonals turn into a tangle past about 10 nodes. The flowchart already routes bent arrows with the same label pill, so c4 keeps that look: one bend per arrow, labels on a straight run. The routing itself is c4's own (see Layout), because the ring structure gives it gutters to run in; it reuses the flowchart's path rounding and label placement from `ortho-router.js`.

### Icons and logos: licensing

Findings from the vendors' own pages (checked 2026-11-20):

- **AWS Architecture Icons**: AWS allows customers and partners to use them to create architecture diagrams, and asks that they keep their shipped colour, format and size. AWS's own redistribution terms are in the package they ship; a community answer treats the diagrams as trademark assets.
- **Azure architecture icons**: Microsoft permits use in architectural diagrams, training materials and documentation, forbids cropping, flipping, rotating or distorting, forbids using them to represent your own product, and says copying and distributing is limited to that permitted use unless Microsoft gives explicit permission.
- **Simple Icons** (brand logos): the artwork is CC0, but the licence says it waives no trademark rights. I could not confirm which cloud-provider marks it carries today; verify before bundling.

Consequence: bundling vendor logo SVGs into this repo and shipping them inside every generated page is redistribution, which these terms do not clearly allow. Generic icons are safe (the repo already ships Lucide, ISC). So icons come in three tiers, and only the first two ship in the repo.

## Goals

- A layout that handles any number of centres, from none (a layered flow, for a service mesh) to many, with groups kept as boxes and bent arrows.
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

Logical JSON the agent writes. Key order is fixed: `diagramType, schemaVersion, title, arrange, showTech, showNotes, colorKey, groups, elements, relations, notes, layout`. (`arrange` is the layout choice; `layout` is the saved positions map. Adding `arrange` changes the codec, so phase 1b updates `C4_KEYS`, the goldens and the codec tests.)

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

- **Element kinds:** `person`, `system`, `container`, `component`, `database`, `queue`, `external`. The kind sets the default shape and icon; `icon` and `color` (palette slot `"1"` to `"9"`) override.
- **Groups:** `kind` is `boundary` (an ownership or trust frame, such as "Third-party services") or `system` (a software system whose inside is the next level). Groups form a tree of any depth in the model, engine and codec; v1 allows depth 2 and rejects deeper nesting in the audit only. An element belongs to at most one group.
- **Relations:** between elements only. `label` is required (C4 requires it); `tech` is optional but warned about on container-to-container links; `async: true` draws a dashed line.
- **One model, all levels.** The level is the collapse state of the `system` groups. A collapsed group draws as one system box, and relations that cross its border are aggregated onto it (one arrow per neighbour, labelled with the count when it merges several). Level 1 is every system group collapsed; Level 2 is one expanded. `collapsed` is saved, so the page reopens where the user left it.
- **Arrange (the layout):** `arrange` is one of `surround`, `flow` or `layers`; omitted, it is `surround` when any item is marked `core` and `flow` when none is. `core: true` on an element or a group marks a centre; zero, one or many may be marked, and a group can be the centre. Nothing is picked automatically. In `layers`, each top-level group is a layer band, stacked in the order written (top to bottom, or left to right with `direction`), and every element must sit in a top-level group.
- **Groups can be coloured**, like the frames in a sequence diagram: `color` on a group is a palette slot (`"1"` to `"9"`, as the codec and tokens name them) or a custom hex, as `setSwatch` accepts). The frame line, its tint and the tag take that colour at low opacity in both themes; used colours appear in `colorKey`. No colour means the neutral frame. Elements keep their own `color` (default by kind).
- **Relations may join any two elements**, including two in the same group or the same layer, as well as elements in different groups. A relation from an element to itself is an error.
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
| `arrange`, layer bands | none | lost on export; top-level groups become boundaries |
| `icon`, `color`, `collapsed`, `layout` positions | none | lost on export; icon and colour travel as `%% @icon` and `%% @color` comment lines that Mermaid ignores and our reader restores |

- **Export writes one level.** All `system` groups collapsed gives `C4Context`; one expanded gives `C4Container` for that system. A user who wants both copies twice. Mermaid has no collapse state.
- **Import reads one level** into the model; positions come from our engine. Merging a second level into the same file by element id is left out of v1.
- **Not mapped:** `C4Dynamic` and `C4Deployment` (non-goals), and Mermaid's layout statements (`Lay_*`, `UpdateLayoutConfig`), which our layout replaces.
- **Tests:** `dev/e2e_mermaid.mjs` gains c4: Copy as Mermaid then Import gives the same elements, groups and relations; the lossy fields round trip through the comment lines; text of another type or non-C4 text is refused with a message; a second copy gives identical text.

## Icons

Icons are the main way to tell nodes apart, so each node leads with one: a coloured disc, about 54px, holding a 32px glyph, centred at the top of the card (smaller than a hero icon on purpose, so the name and detail line keep their room). The disc colour is the kind colour; a provider or technology logo replaces the glyph inside a white disc and keeps its own colours. Three tiers, one rendering path.

1. **Generic icons (ship in the repo).** Add the missing infrastructure glyphs to `assets/icons/default.json` in the existing Lucide style (monochrome, `currentColor`, 24x24): `queue`, `function`, `storage`, `cdn`, `gateway`, `container`, `kubernetes`-neutral `cluster`, `cache`, `lock`, `api`, `mobile`, `browser`, `bell`. Reuse the ones already there (`database`, `server`, `cloud`, `cpu`, `mail`, `credit-card`, `truck`, `shield`, `key`, `user`, `users`, `headset`, `monitor`, `kind-*`). Update `assets/icons/LICENSE` for any new source.
2. **Technology logos (ship in the repo only if the licence check passes).** A small pack of widely used technology marks (databases, brokers, frameworks) from Simple Icons, written as `logo:<slug>`. Open decision 1 covers whether to bundle it.
3. **Cloud-provider logos (never bundled).** AWS, Azure, Google Cloud and similar are loaded from a pack the user builds from the vendor's own download. `scripts/build_icon_pack.py <zip-or-dir> --name aws` reads the vendor package, keeps the vendor's terms file next to the result, and writes `icons/aws.json`. A page references `logo:aws/s3`. A diagram that names a missing pack still renders with the element's generic icon and gets one `[WARN]`. The vendor terms forbid recolouring and distortion, so these render in their own colours at a fixed aspect ratio.

Rendering: the existing `ui.icon(name, opts)` handles monochrome icons (stroke, `currentColor`). Add `ui.logo(name, opts)` next to it for filled, multi-colour logos: pack entries are `{ "vb": "0 0 64 64", "body": "<path .../>" }`, drawn at the icon token sizes. Colours stay inside the logo; the surrounding tile follows the theme. `scripts/tokens.py` gets the matching Python function, as it has for `icon_svg()`.

Export: PNG and SVG export inline the logos like any icon. A page that references a pack embeds only the entries it uses, so the single file stays standalone.

## Styling (follow the flowchart)

Nothing is invented; every item below already exists.

| Item | Source |
|---|---|
| Node: icon card | the flowchart node tile classes in `flowchart.css`, drawn as a card with a coloured disc and glyph at the top (about 54px disc, 32px glyph) and the name and `tech` or description below in the normal label and detail sizes, so the text keeps the room. Sizes come from `TOKENS`. Selected, hover and focus states as the flowchart |
| Colour | palette slots "1" to "9" from `assets/tokens/default.json`; defaults by kind: person 1, system 2, container 3, database 4, external neutral. Never a hardcoded colour; contrast pairs added to the tokens and checked by `check_contrast.py` |
| Shapes | every kind is the same icon card; the kind shows in the disc colour and in the glyph, so nodes are told apart at a glance. A database keeps the `shape-database` glyph; a person uses the use case actor colour |
| Arrow, hover in/out highlight, selected state | `assets/components/edge.css` (`.edge-line`, `--edge-in`, `--edge-out`) |
| Relation label pill with tech tag | `.edge-label`, masking the line, same metrics (`edgeLabel`, `edgeWrap`) |
| Groups and system boundaries | `assets/components/frame.css`: `.frame-tag`, the collapse chevron, the dashed `.frame-summary` row. A group's `color` goes through `setSwatch` and `assets/components/swatch.css` exactly as a sequence frame's does (`.frame-tag.swatch-scope`, `--sw-line` at low opacity for the line and tint), plus an entry in the colour key |
| Dock, line action bar, multi-select bar, search, help drawer, colour key, notes | `assets/shell` and `assets/components`, unchanged |
| Routing | one-bend arrows routed through the gutters the ring layout leaves; path rounding, hops and label placement come from `assets/shell/ortho-router.js` (extracted in phase 1). The flowchart's own router stays as it is |

Motion follows the repo principle, morph not fade: expanding a system group morphs its collapsed box into the frame (`morphRect`), the contained elements grow out of it, and relations re-route with the existing edge motion (`ghostMorph` for the aggregated arrows). Reduced motion jumps straight to the end state. This is covered by `e2e_motion.mjs`.

## Layout (engine.js)

Input is the model; output is positions, sizes, routes and the canvas. Reads text widths only from `TOKENS.font.metrics`, like the other engines. The reference is `dev/plans/c4-layout-prototype.html` (open it in a browser: buttons switch between one centre, a group as the centre, two centres, four centres and no centre). The first engine written for this type was layered; it is replaced by this layout in phase 1b.

**Three layouts, one engine.** `surround` (rings round a centre set), `flow` (no centre: layers found from the links) and `layers` (layers declared by the author) share the item model, the ring-by-row placement, the gutter routing and the frames. They differ only in how a ring number is assigned and which side a ring goes on: distance from the centre set with a side per item (`surround`), distance from the items nobody points at with every ring below (`flow`), and the index of the top-level group with every ring below (`layers`, each ring one band as wide as the widest). Adding another layout later means a new ring rule, not a new engine.

**Items.** A top-level item is a framed group or one loose element. Collapsed groups count as one item; relations that cross a collapsed border are aggregated onto the nearest visible ancestor. The layout works on items, so the same code serves groups of any depth.

**Rings.** The centre is the set of items marked `core` (0 to n). Every other item gets a ring number: its distance, in links, to the nearest centre item (breadth first from all centres at once). A link only ever joins the same ring or neighbouring rings, which is what keeps every arrow short.

**Centre placement.**
- One or more centre items are placed in the middle as a grid of `ceil(sqrt(n))` columns, with room for a label between linked neighbours.
- A centre that is a group is one item: its frame sits in the middle with its members in a row inside.
- **No centre:** ring 0 is the items nobody points at (the first item if every item is pointed at), and every ring goes on the bottom side, so the result is a layered top-to-bottom flow. Same boxes, frames and arrows.

**Sides.** Each ring item sits on one side of everything inside it (N, S, E or W):
- An author hint (`side`) wins.
- People go on top (N) when that side is open.
- Otherwise the emptiest allowed side, in the order S, W, E, N.
- **Exposure rule:** a ring-1 item may only sit on a side that every centre element it links to exposes to open space. In a 2x2 centre grid the top-left element exposes N and W only, so an item linked to it cannot sit below, where its arrow would cross another centre.
- A ring-2 or later item follows the side of the inner neighbour it links to.

**Inside a group.** Members are laid out by the same rules, one level down:
- No relations between members: a row (a column beside the centre).
- Relations that join neighbours in the row: the row, with room for a label between linked members.
- Relations that skip a member (a to c across b), or enough links to make a row unreadable: the group lays its members out as a small flow, ranked by relation direction within the group, with the same boxes and bent arrows. The group's box is sized to fit it, and nothing outside the group changes.
- A group collapsed to one tile hides its internal relations; relations that leave it are aggregated as before.

**Rings are placed around the box built so far.** Ring r puts its N items in a row above, its S items in a row below, then its E and W items in columns beside the result, all centred on the origin. A framed item's members form a row above or below the centre and a column beside it, so an arrow to the far member never crosses a sibling. Order along a side is the average position of the inner neighbours (barycentre), ties by input order. A gutter between rings is left for arrows and labels.

**Arrows bend.**
1. An arrow between rings runs along the side its outer item sits on: down for N and S, across for E and W.
2. It has one bend. The horizontal run sits in the gutter between the facing edges of the two items (frames, not the boxes inside), so a run never cuts through a frame.
3. Several arrows leaving one side get ports spread along it in the order of their targets, and their bends are staggered so they nest instead of crossing.
4. A link inside one ring loops under the row (down, along the gutter, up into the target) unless the two items are single boxes side by side. Loops are staggered so they do not share a line.
5. Near-aligned ends become one straight line.

**Direction and frames.** Frames are drawn behind everything, titles at the top-left (at the bottom for a box below the centre, away from the arrows). Collapsed groups draw as one system tile.

**Scale.** Rings, sides and ordering are linear or n log n per pass with a fixed number of passes. A ring that gets long wraps into extra rows. A landscape that would open with more than 80 visible elements opens with `system` groups collapsed and the audit says so. Expanding one group does not re-lay-out the rest: positions outside it are kept and shifted as one block.

**Known gaps in the prototype that the engine must close.** Arrows that loop under a row can share a gutter with other arrows and need stagger logic; loop-unders for left and right columns are missing; crossings between arrows are only reduced by the order along a side; when the preferred side is not allowed, items pile onto the next open side.

## Engine contract

The one interface between `engine.js`, the page (`c4.js`) and the audit. Coordinates are canvas pixels, top-left origin. Derived fields are recomputed, never saved. Mirrors the use case contract.

`layoutDiagram(data)` mutates `data` in place (full layout); `routeDiagram(data)` keeps every element and group `x`/`y` and recomputes everything else (group boxes, arrows, labels, canvas), and calls `layoutDiagram` when any visible item has no `x`/`y`. Both read text widths only from `TOKENS.font.metrics` and sizes from `TOKENS`, and route arrows with the layout's own gutter routing, reusing path rounding and label placement from `assets/shell/ortho-router.js`. `layoutDiagram` must be a top-level function (loaded by `scripts/run_engine.mjs`). Deterministic: ties break by input order.

| Field | Meaning |
|---|---|
| `elements[].x, y, w, h` | Top-left and size of the tile. |
| `elements[]._hidden` | True when an ancestor group is collapsed; a hidden element has `w`/`h` 0 and no arrows of its own. |
| `groups[].x, y, w, h` | The frame box, tag band included; a collapsed group has the size of one system tile. |
| `elements[]._ring`, `groups[]._ring` | Ring number: 0 for a centre item, then distance in links; a hidden item has none. |
| `groups[]._side`, `elements[]._side` | `N`, `S`, `E`, `W` or none for a centre item, resolved from the hint or the rules under Layout. |
| `data._arrange` | The layout used (`surround`, `flow` or `layers`) after the default is applied. |
| `groups[]._depth` | 1 for a top-level group, 2 for its child, and so on (any depth). |
| `groups[]._collapsed` | Effective state: true when the group or any ancestor is collapsed. |
| `data._edges` | The arrows actually drawn: `[{id, from, to, label, tech, async, count, members, points, path, labelBox}]`. `from`/`to` are the nearest visible ancestor (or the element itself) of each relation end; relations with the same visible pair and the same label merge, `count` is how many, `members` their indexes in `relations`; a merged edge with different labels shows the label of the first and `count`. |
| `data._edges[].points` | `[[x, y], ...]` orthogonal polyline from the layout's gutter routing. `path` is the SVG path with the rounded corners and hops of `ortho-router.js`. |
| `data._edges[].labelBox` | `{x, y, w, h}` of the label pill (label line plus `[tech]` line). |
| `data.canvas` | `{width, height}`. |

A relation whose two ends resolve to the same visible item (both inside one collapsed group) is not drawn. Direction (`direction` in the JSON, else chosen like the flowchart) sets the flow axis: top to bottom puts people first.

Disk format: unchanged from the codec (`layout` map `{id: {x, y}}`, elements then groups); `toDisk` drops every `_` field, sizes, `points`, `path`, `labelBox`, `_edges` and `canvas`.

## Gutter routing interface

One interface between the layout (`engine.js`) and the routing (`assets/types/c4/route.js`), so the two can be built and tested apart. `route.js` is a plain script loaded before `engine.js` for the c4 type only (the page assembler, `run_engine.mjs` and `engine_runner.py` load `assets/types/<type>/route.js` when the file exists, and nothing changes for other types).

`routeC4Edges(nodes, edges)` returns one result per edge, in the same order:

- `nodes`: `{elementId: {x, y, w, h}}`; `x`, `y` are the box centre. Only visible elements appear; the engine has already merged aggregated edges and dropped edges inside one collapsed group.
- `edges`: `[{from, to, label, tech, hint, itemA, itemB}]`; `from` and `to` are keys of `nodes`. `itemA` and `itemB` are `{id, x, y, w, h}` (centre and size): the two sibling items just below the lowest group that contains both ends, one containing `from` and one containing `to`. For two ends in different top-level items these are the top-level items; for two ends inside one group they are the group's children (a nested group's frame or a loose element); for two elements that are direct siblings they are the element boxes themselves. The bend run is placed in the gap between the facing edges of `itemA` and `itemB`, so it never crosses a frame or a sibling. `hint` is `"v"` (run down or up first), `"h"` (run across first), `"u"` (loop under the row), or absent (choose by the gap).
- result: `{d, points, lx, ly, w}`; `d` is the SVG path, `points` the polyline `[[x, y], ...]`, `lx`, `ly` the centre of the label pill and `w` its width. The pill is 32px high.

Rules it implements: one bend, the run placed between the facing edges of the two items (so never through a frame), ports spread along a side in the order of the targets, bends staggered so arrows nest, loops under a row staggered so they do not share a line, near-aligned ends straight, labels placed on a run long enough for them. Path rounding and label placement reuse `ortho-router.js` where they fit. The router reads label widths from `TOKENS.font.metrics` and holds no layout logic.

## Interaction and UX

- Add from the dock: person, system, container, database, queue, external, group. Connect by dragging between ports; the new relation asks for its label immediately (required).
- Frame tag: click selects, chevron collapses or expands. "Level" shortcut in the toolbar sets every `system` group collapsed (Level 1) or expands the selected one (Level 2).
- Icon picker in the action bar: search across generic icons and installed packs; a missing pack is explained in the picker.
- Hover an element: its relations highlight in and out, the rest dim (the flowchart behaviour). Search finds elements, groups and relation labels.
- Present mode (`?present`) is read-only with Level switching allowed.
- Accessibility: every tile is focusable and named `name, kind, technology`; group tags are buttons with `aria-expanded`; arrows have text labels, so no meaning rests on colour alone.

## Editing (phase 4)

Auto-Tidy is always on, as in the use case type: every add, connect, delete, group change or collapse re-lays the diagram out (positions are dropped, the engine places everything, the shell's morph motion plays). Dragging boxes to move them, and notes, come later. This is the contract the page (`c4.js`) and the end-to-end test (`dev/e2e_c4.mjs`) share.

**Dock.** `#btn-add` opens the popover `#c4-pop` with tiles `#btn-add-person`, `#btn-add-system`, `#btn-add-container`, `#btn-add-database`, `#btn-add-queue`, `#btn-add-external`, `#btn-add-group`. A click adds the item; an item added while a group is selected joins that group; the new item is selected and its name is in rename mode. New ids are `e_<ms>` for elements and `g_<ms>` for groups; relations have no ids.

**Selection.** Click an element, a group tag or an arrow; Ctrl or Shift click adds; a box dragged on empty canvas selects the elements it covers; Ctrl+A selects all; Esc clears. Selected items carry the class `selected` (`.c4-node`, `.c4-group`, `.edge-line`).

**Action bar** (`ui.actionBar`, class `c4-actionbar`, buttons carry `data-act`):
- Element: `rename`, `kind` (menu), `icon` (picker `#c4-icons` with search over the generic icons; names it cannot find are listed as missing packs), `color` (swatch row, with the colour key entry prompt), `group` (menu: none, each group, new group), `core` (toggle: centre), `side` (menu: auto, N, S, E, W), `details` (popover with `#c4-tech` and `#c4-desc`), `connect`, `delete`.
- Group: `rename`, `color`, `collapse`, `core`, `side`, `ungroup`, `delete` (deletes the group and its members; with members it asks first).
- Arrow: `label` (edit), `tech`, `async` (toggle), `reverse`, `delete`.
- Several selected: `color`, `group`, `delete` with the count.

**Rename.** Double-click a name, or F2 or Enter on the selection: an inline editor; Enter saves, Esc cancels. Empty names are refused.

**Connect.** Drag from a port (`.c4-port`, shown on hover and on the selected element, one per side) onto another element, or choose `connect` and click the target. The new arrow immediately opens `#c4-label-input` (a label is required); Esc cancels the label and the whole connection is undone. A connection to itself is refused with a toast; a duplicate (same pair and label) is refused.

**Delete.** Delete or Backspace removes the selection (an element's arrows go with it). **Undo and redo** cover every action; add plus first rename, and connect plus its label, are one step each.

**Save.** `toDisk` renames editor ids to name slugs (unique, references and `core` and `side` hints kept) exactly as `c4_to_disk` in `scripts/disk_format.py` does, and drops every `_` field.

**Present mode** (`?present`): no editing UI, the Level control, search and hover still work.

## Audit (`scripts/audit_c4.py`)

Registered in `AUDITS`. Each rule has a failing and a passing unit case.

- Error: duplicate id, relation to an unknown id, group cycle, element in two groups, relation without a label, group nesting deeper than 2.
- Warn: container-to-container relation with no `tech`, element with no relation, person with no relation, external element inside a `system` group, a group with more than 12 visible children (suggest splitting), label longer than the pill limit, two relations between the same pair with the same label, missing icon pack.
- Error: unknown `arrange`; `layers` with an element outside a top-level group; a relation from an element to itself.
- Warn: `layers` with a relation that skips a layer (its arrow runs down the outer lane); `surround` or `flow` with a `core` flag on an item that has no relations.
- Info: the level the diagram opens at and why, and the layout in use.
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
1b. **Layout rebuild.** Replace the first layered engine with the ring and layered layout under Layout, the reference being `dev/plans/c4-layout-prototype.html`. Same engine contract, plus the ring and side fields. Regenerate the goldens and fix the page for the icon card node.
1c. **Layers layout and links inside a group.** The `layers` ring rule, equal-width bands, the audit rules, the small inner flow for groups whose members skip each other, fixtures and goldens. Same engine as 1b, so this is a ring rule and a group rule, not new machinery.
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
- Layers fixtures: four bands with links between adjacent bands and one link inside a band; a band wider than the others; an element outside any band is an audit error; the skip-layer warning fires.
- Links inside a group: a neighbour link (room for the label), a link that skips a member (inner flow, no arrow through a sibling), a chain of four members, and a collapsed group hiding its internal link.
- Layout fixtures for every centre count: one centre, a group as the centre, two, four, and none (layered). Each checks: no overlaps, every box inside its frame, arrows orthogonal with at most one bend (loop-unders aside), no arrow crossing a box or a frame it does not enter, the exposure rule (no ring-1 item on a covered side), ring numbers as expected, determinism (two runs byte-equal), and the 2,000-element run under budget.
- Level 3 readiness: a fixture with system > container > component runs through the engine and codec with `MAX_GROUP_DEPTH` raised in the test; with the v1 limit the audit rejects it with the documented message.
- `dev/e2e_c4.mjs`: add each kind from the dock; connect and label a relation; collapse and expand a system group and check aggregated arrows appear and disappear; Level control; set an icon from the picker; a missing pack falls back to the generic icon with one warning; Save round trip keeps ids, collapse state and positions; `?present` disables editing.
- `e2e_motion.mjs` extended with c4: no orphan ghost after expand, collapse, undo bursts; reduced motion creates no animation.
- `check_themes.py` on every fixture under every theme; `check_overflow.mjs`; `build_examples.py --check`; vendor logos checked for unmodified aspect ratio.

## Decisions

Recommended, to confirm before phase 1.

1. **Type name:** `c4`.
2. **Levels:** one model with collapsible groups, not separate diagrams per level. v1 ships two levels; Level 3 is deferred (settled 2026-11-20) and kept cheap by the Level 3 readiness rules. Recommended because it keeps one source of truth and gives the morph between levels for free.
3. **Arrows:** orthogonal with one bend per route, as the flowchart; see decision 10 for how they are routed.
4. **Cloud-provider logos:** not bundled; user-built local packs from the vendor download.
5. **Technology logos (open decision 1):** bundle a small Simple Icons subset, or ship generic icons only? Recommended: generic icons in v1, technology pack after a licence and trademark check of the specific marks. Needs the user's call.
6. **Mermaid C4:** optional, phase 6; one level per copy, single-level import (settled 2026-11-20).
7. **Generic first:** the default icon for each kind is a generic glyph, so a diagram with no packs installed looks finished.
8. **Layout:** concentric rings around the centre set, with a layered flow when no centre is marked (settled 2026-11-21). Replaces the grid-with-gutters idea and the ring-on-a-polygon idea; groups stay boxes.
9. **Centre:** an explicit `core` flag on an element or group, any number including none; nothing is picked automatically.
10. **Arrows:** one bend, run in the gutter between the facing frames, loop under a row for links inside a ring; c4 has its own gutter routing and reuses only path rounding and label placement.
11. **Nodes:** icon cards, disc about 54px with a 32px glyph, text underneath.
12. **Layers are a layout, not a group kind** (settled 2026-11-21): `arrange: "layers"` turns the top-level groups into stacked bands. No new group kind, and Level 3 readiness is unchanged. Layer bands do not map to Mermaid C4.
13. **Links inside a group are allowed** (settled 2026-11-21), including between members that are not neighbours; the group lays out its members as a small flow when a row would put an arrow through a sibling.
14. **Editing is Auto-Tidy only at first** (settled 2026-11-21): every edit re-lays the diagram out; dragging boxes to move them is a later step.

## Sources

- AWS Architecture Icons: https://aws.amazon.com/architecture/icons
- Azure architecture icons and terms: https://learn.microsoft.com/azure/architecture/icons
- Simple Icons (CC0 artwork, trademark rights not waived): https://simpleicons.org
- C4 model: https://c4model.com
- Mermaid C4 syntax (experimental): https://mermaid.js.org/syntax/c4.html
- Lucide (existing icon source, ISC): https://lucide.dev
