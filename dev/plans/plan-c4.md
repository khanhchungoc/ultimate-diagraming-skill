# Plan: C4 / system landscape diagram type (`diagramType: "c4"`)

Add a diagram for system landscapes as the fifth type, next to `flowchart`, `sequence`, `erd` and `usecase`. It shows people (actors), the systems they use and the interactions between systems, at the zoom levels of the C4 model: Level 1 system context, Level 2 containers, and optionally Level 3 components. Same promise as the other types: the agent writes a short logical JSON, the tooling lays it out, audits it and assembles one standalone, editable page (or claude.ai Artifact) with the shared shell.

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

- One diagram type that covers Level 1 and Level 2 (and Level 3) from one model, with system boundaries as collapsible frames.
- Styling and behaviour identical to the flowchart wherever the element is the same: node tiles, palette slots, edge lines and label pills, frame tags, dock, action bar, search, undo, Save, theme, `?present`.
- Icons on every element: generic by default, brand logos when the user supplies a pack.
- Scales from a handful of elements to thousands: large landscapes open with groups collapsed and arrows aggregated.
- Deterministic layout; the file format is the public API.

## Non-goals (v1)

- Deployment and dynamic C4 views.
- Bundling AWS, Azure or Google Cloud logo files in the repo.
- Import from Structurizr, PlantUML C4 or Mermaid C4 (Copy as Mermaid C4 is phase 6, optional).
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
- **Groups:** `kind` is `boundary` (an ownership or trust frame, such as "Third-party services") or `system` (a software system whose inside is the next level). Nesting depth is at most 2 in v1. An element belongs to at most one group.
- **Relations:** between elements only. `label` is required (C4 requires it); `tech` is optional but warned about on container-to-container links; `async: true` draws a dashed line.
- **One model, all levels.** The level is the collapse state of the `system` groups. A collapsed group draws as one system box, and relations that cross its border are aggregated onto it (one arrow per neighbour, labelled with the count when it merges several). Level 1 is every system group collapsed; Level 2 is one expanded. `collapsed` is saved, so the page reopens where the user left it.
- **Disk format:** a trailing `layout` map `{id: {x, y}}` (elements, then groups), as the ERD and use case types. `toDisk` drops every `_`-prefixed field, sizes, points and canvas. The codec lives in `scripts/disk_format.py`.

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
| Routing | the flowchart's orthogonal router. `dev/architecture.md` says to extract the router and layered ranking into shared modules when a second type needs them; this is that moment, done in phase 1 |

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

1. **Shared router and model.** Extract the router and layered ranking from the flowchart engine with no behaviour change (golden unchanged). Schema, codec, `engine.js` with groups and collapse, `audit_c4.py`, fixtures and golden. `--layout` produces a static page.
2. **Render.** Tiles with generic icons, person avatar, database shape, groups as frames, orthogonal arrows with label pills, aggregated arrows, notes, colour key.
3. **Levels and motion.** Collapse and expand, the Level control, morph motion, reduced-motion path.
4. **Edit.** Dock, ports, label prompt, icon picker, action bar, Auto-Tidy, Save, undo, multi-select.
5. **Icon packs.** `ui.logo`, `build_icon_pack.py`, the technology pack if allowed, missing-pack fallback and warning, export.
6. **Docs and polish.** Help drawer, reference, example, playground entry, README, `check_themes.py` and `check_contrast.py --strict` clean. Optional: Copy as Mermaid C4.

Each phase ends with its checker passing and the playground e2e still green; no phase leaves the type half-built across layers.

## Tests

- `dev/test_audit_c4.py`: one failing and one passing case per audit rule.
- `check_golden.py`: engine output per fixture, and laying out the saved model again moves nothing. A fixture with 2,000 elements across 40 groups proves the scale budget (opens collapsed, lays out within the bench limit in `dev/bench_layout.py`).
- Flowchart golden stays byte-identical after the router extraction.
- `dev/e2e_c4.mjs`: add each kind from the dock; connect and label a relation; collapse and expand a system group and check aggregated arrows appear and disappear; Level control; set an icon from the picker; a missing pack falls back to the generic icon with one warning; Save round trip keeps ids, collapse state and positions; `?present` disables editing.
- `e2e_motion.mjs` extended with c4: no orphan ghost after expand, collapse, undo bursts; reduced motion creates no animation.
- `check_themes.py` on every fixture under every theme; `check_overflow.mjs`; `build_examples.py --check`; vendor logos checked for unmodified aspect ratio.

## Decisions

Recommended, to confirm before phase 1.

1. **Type name:** `c4`.
2. **Levels:** one model with collapsible `system` groups, not separate diagrams per level. Recommended because it keeps one source of truth and gives the morph between levels for free.
3. **Arrows:** orthogonal, one bend per route, shared with the flowchart router.
4. **Cloud-provider logos:** not bundled; user-built local packs from the vendor download.
5. **Technology logos (open decision 1):** bundle a small Simple Icons subset, or ship generic icons only? Recommended: generic icons in v1, technology pack after a licence and trademark check of the specific marks. Needs the user's call.
6. **Copy as Mermaid C4:** optional, phase 6.
7. **Generic first:** the default icon for each kind is a generic glyph, so a diagram with no packs installed looks finished.

## Sources

- AWS Architecture Icons: https://aws.amazon.com/architecture/icons
- Azure architecture icons and terms: https://learn.microsoft.com/azure/architecture/icons
- Simple Icons (CC0 artwork, trademark rights not waived): https://simpleicons.org
- C4 model: https://c4model.com
- Lucide (existing icon source, ISC): https://lucide.dev
