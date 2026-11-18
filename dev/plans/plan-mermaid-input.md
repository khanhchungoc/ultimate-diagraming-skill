# Plan: Mermaid as the authoring format

Status: proposed (2026-11-18). Follows `plan-speed-cost.md` P1: in the benchmark, the agent's JSON was 3.3× the size of the same diagram in Mermaid, and two thirds of the JSON was syntax and ids, not content.

## Decision

- **Agents write and read Mermaid**, for all four types. `--layout` takes a `.mmd` file, and `--extract` prints Mermaid.
- **The page keeps storing JSON**: `diagram-data`, the `layout` map, the editor, the engines and the audits do not change. Mermaid is parsed into today's JSON before layout.
- **Use case uses Mermaid flowchart syntax** (Mermaid has no use case type), with the same parser as the flowchart. `%% @type usecase` switches the meaning.

## Principles

1. **Native Mermaid first.** Use Mermaid's own construct wherever one carries the meaning. A `%% @…` comment line is only for what Mermaid cannot say. Every file we read or write must pass `mermaid.parse` (v11), so the source previews anywhere (GitHub, Markdown, mermaid.live).
2. **Lenient in, exact out.** Any valid Mermaid of a supported type imports. Constructs we have no equivalent for map to the nearest one with an `[INFO]` line, never an error. The writer always emits the canonical form.
3. **Round trip.** JSON → Mermaid → JSON keeps every authored field. Positions are not in Mermaid; see "Updates and positions".
4. **One implementation.** Parser and writer live in JS next to each type's plugin. The page uses them (Copy as Mermaid, later Paste/Import Mermaid) and so does the CLI (through `run_engine.mjs`, or Chrome without Node, like the engines). The current `toMermaid()` functions export only and drop information; they are replaced, not kept beside the new code.
5. **The engine derives what it can**, so the agent writes less: start vs end, feedback edges, lane icons, ERD join columns, fk and identifying flags, actor vs use case.

## Shared conventions (all types)

| Need | Form | Verified |
|---|---|---|
| Title | front-matter `---\ntitle: X\n---` | ✓ |
| Type switch | `%% @type usecase` (any `flowchart` without it is a flowchart) | ✓ (comments ignored) |
| Palette colour of an item | class `c1`…`c8`: `id:::c3`, or `class id c3` (also for subgraphs; `:::` is not allowed on subgraphs, and only one `:::` per node) | ✓ |
| Flags (abstract, collapsed, subfunction, system, time…) | more classes: `class id abstract`; several `class` lines may name one id | ✓ |
| Colour legend | `%% @colorKey 3 Billing` | ✓ |
| Diagram settings | `%% @showNotes`, `%% @laneOrder fixed`, `%% @detail keys`, … | ✓ |
| Item extras with text values | `%% @<key> <id>[,<id>…] <value>` (for example `%% @icon lane_hm user`, `%% @refs checkout FR-4, FR-5`) | ✓ |
| Line breaks in text | `<br>` ↔ `\n` | ✓ |
| Characters Mermaid reserves | writer escapes with entities (`#quot;`, `#59;`, `#35;`), parser unescapes | ✓ |
| Ids | `[A-Za-z_][A-Za-z0-9_]*`. Never `end`, `class`, `style` as a node id (parse errors). `lane-x` becomes `lane_x` on import, the same way the current exporter does | ✓ |

Classes need no `classDef`: Mermaid accepts undefined classes. The writer adds `classDef c1..c8` lines with the theme's slot colours, so a plain-Mermaid preview shows the colours.

## Flowchart

| JSON | Mermaid | Kind |
|---|---|---|
| `title` | front-matter `title` | native |
| `direction` | `flowchart LR` / `TB` (`TD` = TB; `RL`/`BT` → LR/TB with `[INFO]`). A bare `flowchart` means "let `--layout` pick" | native |
| `lanes[]` (order, `id`, `name`) | top-level `subgraph lane_hm["Hiring Manager"] … end`, in order | native (a grouping box in Mermaid, swimlanes in our page) |
| no lanes / `swimlanes: false` | no subgraph at all | native |
| nested subgraphs | flattened into the outer lane, `[INFO]` | lenient |
| lane `icon` | `%% @icon lane_hm user`. Left out: `--layout` picks one from the lane name | directive / derived |
| lane `color` | `class lane_hm c3` | native |
| `laneOrder: "fixed"` | `%% @laneOrder fixed` | directive |
| node `task` | `id["Label"]` | native |
| `decision` | `id{"Label?"}` | native |
| `start` / `end` | `id(["Label"])`. **end** = no outgoing edge, otherwise **start** (a start may have a loop back into it) | native + derived |
| unlabelled start / end | `id@{ shape: sm-circ }` / `fr-circ` (also `f-circ`, `dbl-circ` for end) | native |
| `subprocess` | `id[["Label"]]` | native |
| `io` | `id[/"Label"/]` | native |
| `database` | `id[("Label")]` | native |
| `document` | `id@{ shape: doc, label: "Label" }` | native (v11 shape) |
| `delay` | `id@{ shape: delay, label: "Label" }` | native (v11 shape) |
| `connector` (engine-made) | `id(("A"))`: a circle whose label is a connector letter | native |
| other shapes (`{{ }}`, trapezoids, …) | task, `[INFO]` | lenient |
| edge, `label` | `a -->|"Yes"| b`, `a -- Yes --> b`; chains `a --> b --> c`; fans `a & b --> c` | native |
| edge `feedback: true` | `a ==> b` (thick). Left out: the engine picks the loop edge, as today | native + derived |
| `---`, `-.->`, `--o`, `<-->` between steps | an edge, `[INFO]` for the unusual ones | lenient |
| edge `id` | not written; generated `e1…` in order | derived |
| `notes[]` (`text`, several `nodes`) | `note1>"Text<br>more"] -.- step_a & step_b`: a flag-shaped node joined by a dotted line is a note, not a step | native |
| `showNotes` | `%% @showNotes` | directive |
| `layout` map, lane `height` | not in Mermaid (see Updates) | page only |
| `style`, `linkStyle`, `click`, `classDef` with other names, `accTitle` | ignored, `[INFO]` once | lenient |

## Use case (Mermaid flowchart dialect)

| JSON | Mermaid | Kind |
|---|---|---|
| marker | `%% @type usecase` | directive |
| `subjects[]` | `subgraph shop["Storefront"] … end` | native |
| actor vs use case | **inside a subgraph = use case, outside = actor**. With no subgraph (one implicit subject): stadium `([ ])` or ellipse `(( ))` = use case, anything else = actor | derived |
| actor `kind` system / time | `class psp system` / `:::time` (default human) | native |
| actor or use case `abstract` | `class x abstract` | native |
| use case `level` | `:::subfunction` / `:::summary` (default user) | native |
| `color`, `colorKey` | `:::c1`, `%% @colorKey 1 Ordering` | native / directive |
| `refs` | `%% @refs checkout FR-4, FR-5` | directive |
| `extensionPoints` | `%% @points checkout Payment, Shipping` | directive |
| association | `actor --- uc` or `actor --> uc` (either direction; supporting actors on the right) | native |
| `include` | `base -.->|include| used` (also accepts `<<include>>`, `«include»`) | native |
| `extend` (`condition`, `extensionPoint`) | `ext -.->|"extend (Payment): customer has a code"| base` | native |
| `parent` (generalization) | `child -->|is a| parent` (actors or use cases) | native |
| `notes[]` | flag node `-.-` actors / use cases, as for flowcharts | native |
| `showRefs`, `showNotes` | `%% @showRefs`, `%% @showNotes` | directive |
| actor `side` | `%% @side psp right` (normally derived) | directive |
| subject `collapsed`, `fw`/`fh` (editor state) | `class shop collapsed`, `%% @size shop 420 300` | native / directive |
| link `id` | generated `l1…` | derived |

## Sequence

| JSON | Mermaid | Kind |
|---|---|---|
| `participants[]` order, `id`, `name` | `participant pay as Payment Service` (declaration order) | native |
| `kind: actor` | `actor c as Customer` | native |
| `kind: database` / `queue` | `participant db@{ "type": "database" } as Orders DB` / `"queue"` | native (v11) |
| `kind: ui` | `"type": "boundary"` (the UML boundary is the UI) | native |
| `kind: system` | plain `participant` (also `control`, `entity` → system with `[INFO]`) | native |
| `kind: external` | `%% @kind psp external` | directive |
| `color` + `colorKey` | `box <colour> <label> … end` around contiguous participants: label → `colorKey`, slot = the palette slot nearest the box colour, else box order. Non-contiguous colours: `%% @color p4 3` | native / directive |
| `start` / `end` | `create participant X` before the message that starts it / `destroy X` | native |
| message `sync` / `reply` / `async` | `->>` / `-->>` / `-)` (also `->`, `-->`, `--)`, `-x`, `<<->>` → nearest, `[INFO]`) | native |
| `detail` | `label<br>detail`: the first `<br>` splits the label from the detail | native |
| message `id` | generated `m1…` by position (frames and notes are positional, so nothing refers to ids) | derived |
| activation bars | automatic as today. Mermaid `+`/`-`/`activate`/`deactivate` are written by the writer (so previews show bars) and ignored on import, with `[INFO]` if the author's bars differ | derived |
| `activate: false`, `until` | `%% @activate false` / `%% @until 12` (step number) on the line before the message | directive |
| `opt` / `alt` / `loop` / `par` + `branches` | native blocks with `else` / `and` | native |
| `group` (named phase) + `color` | `rect rgb(…) Payment … end`: Mermaid keeps the text after the colour (verified), so the label rides there | native |
| `critical`, `break` | `group` / `opt`, `[INFO]` | lenient |
| `color` on a non-group frame, `collapsed` | `%% @color 3`, `%% @collapsed` on the line before the block | directive |
| `notes[]` `over` one or two, `after` / `before` | `Note over A,B: text` at its position: after a message = `after`; before frames that open on the next message = `before` (Mermaid allows at most two participants, as we do) | native |
| `Note left of` / `right of` | `over` that participant, `[INFO]` | lenient |
| `numbered` | `autonumber` | native |
| `showDetails`, `participantOrder`, `rails`, `lifespans`, participant `column` | `%% @showDetails false`, `%% @participantOrder fixed`, `%% @rails`, `%% @lifespans`, `%% @column p5 p2` | directive |

Text in messages: `;` and `#` must be escaped (`a; b` fails to parse); the writer does this already.

## ERD

| JSON | Mermaid | Kind |
|---|---|---|
| entity `id`, `name` | `order_item` / `ord["Order"]` (alias when the name differs from the id) | native |
| column `type name` | `uuid customer_id` (type is required by Mermaid) | native |
| no type | `_ name` | convention |
| type with spaces | spaces ↔ `-`: `double-precision`, `timestamp-with-time-zone`, `character-varying(255)`. Mermaid rejects spaces and quoted types; SQL types never contain `-`, so this is lossless | convention |
| `pk` / `fk` / `unique` | `PK`, `FK`, `UK`, combined `PK, FK` | native |
| `nullable` | type suffix `?`: `text? phone` (parses, and reads naturally) | convention |
| column `note` | trailing `"comment"` | native |
| relationship ends | `}o`, `}|`, `|o`, `||` next to each table (the marker next to a table is that table's multiplicity) | native |
| `from` (child) / `to` (parent) | the "many" side is the child. For 1:1, the side holding the FK columns; otherwise the right-hand table (the writer puts the parent first) | derived |
| `identifying` | `--` = identifying when every FK column is also PK, else drawn dashed (agents write `--` by habit); `..` = non-identifying | native + derived |
| `label` | `: places` / `: ""` (Mermaid requires a label; a missing one is a parse error) | native |
| `columns` (FK columns) | derived: the child's FK columns named `<parent>_id`, `<parent name>_id` or `<role>_<parent>_id`. Otherwise in the label: `: "billing [billing_address_id]"` (parses; the writer emits it only when derivation would differ) | derived / convention |
| `toColumns` | `[customer_email -> email]` in the label | convention |
| `color`, `colorKey` | `:::c2`, `class a,b c2`; `%% @colorKey 2 Billing` | native / directive |
| `notes[]` (table, several tables, a column) and entity `note` | `%% @note order: text`, `%% @note a,b: text`, `%% @note order.status: text` (Mermaid's ER syntax has no notes) | directive |
| `detail`, `showTypes`, `showNotes` | `%% @detail keys`, `%% @showTypes false`, `%% @showNotes` | directive |
| entity `collapsed` | `class x collapsed` | native |
| `direction LR` | ignored (the engine lays out ERDs) | lenient |

## Verified against Mermaid 11.17.2 (`mermaid.parse` and its parsed model, in Chromium)

- Pass: all classic flowchart shapes plus the v11 shapes `doc`, `delay`, `sm-circ`, `fr-circ`, `dbl-circ`, `f-circ`, `subproc`, `flag`, `fork`, `braces`; unknown shape names are rejected (`No such shape`). Also passing: subgraphs with titles, nested subgraphs, every edge kind, labels with `?`, `:`, `$`, `<=`, `<br>`, `&` fans, chains, `class` on subgraphs, undefined classes, several `class` lines on one node, a bare `flowchart`, front-matter with extra keys, and `%%` lines anywhere.
- Sequence passes: participant types `database`, `queue`, `boundary`, `control`, `entity`, `collections` with an alias; `box` with or without a colour; `create`/`destroy`; every arrow kind; `rect` with a colour plus a label; `<br>` in messages; `autonumber`; frames nested 3 deep.
- ER passes: all four end markers in both line styles, word cardinalities, aliases, `PK, FK`, `UK` with a comment, types with `(10,2)`, `[]`, `-`, `?`; labels with `[ … ]`; `:::`, `class`, `style`.
- **Fail**:
  - `end`, `class` or `style` as a node id;
  - `:::` on a subgraph, and two `:::` on one node;
  - unquoted labels with parentheses (`a[Check (fast)]`);
  - ER: a relationship with no label, a column type with a space, a quoted type, a column with no type, and a column type starting with `-`;
  - sequence: `;` in message text, `Note over` three participants, half-arrows.

  The writer must never produce these, and the parser should accept the unquoted-parentheses label anyway, because agents write it.

## Updates and positions

- **Read**: `--extract page.html` prints Mermaid (`--extract --json` keeps the old output).
- **Structural edit**: extract, edit the `.mmd`, then `--layout` (positions reset, as today).
- **Text-only edit** of a page the user arranged by hand: `--layout edited.mmd --keep-from <page.html | diagram.json>`. When the set of ids is unchanged, positions come from the old page and only lines and labels are redrawn (today's `--keep-layout` path). Otherwise there is a full layout and an `[INFO]` saying positions were reset. This replaces the artifact step where the agent edits `diagram.json` by hand.
- Ids are stable because the writer keeps JSON ids (sanitised once, applied to the `layout` map keys too).

## Phases

0. **Harness** (dev only).
   - `dev/check_mermaid.mjs` (start from `dev/bench/mermaid-syntax/`: the 148 syntax cases above, `parse.js` for pass/fail, `ast.js` for what Mermaid parsed):
     - every golden fixture and example goes JSON → Mermaid → JSON and must come back equal (minus positions and derived fields);
     - every written `.mmd` must pass `mermaid.parse`;
     - a leniency corpus must import with no `[ERROR]`: the four Mermaid files the Sonnet agents wrote in the benchmark, plus habit cases (`graph TD`, `style` lines, `click`, `classDef` colours, unquoted labels).
   - Mermaid becomes a dev-only npm dependency.
1. **Flowchart family** (flowchart and use case): `assets/shell/mermaid-flow.js` (tokenizer for front-matter, `%% @`, classes, nodes, shapes, edges, subgraphs) plus `fromMermaid`/`toMermaid` in `flowchart.js` and `usecase.js`. The page's Copy as Mermaid uses the new writer; use case gets one. Derivations: start/end, lane icon, actor vs use case.
2. **Sequence**: parser and writer, a positional model for frames and notes, `box` colours, `<br>` detail.
3. **ERD**: parser and writer, child side, `columns` derivation, `-`/`?`/`_` type conventions.
4. **CLI and skill**:
   - `--layout x.mmd` (detected by extension, or by no leading `{`); `--extract` → Mermaid; `--keep-from`. JSON input still accepted, but undocumented.
   - Rewrite the type references as Mermaid cheat sheets: the mapping rows above that an author needs, plus today's writing rules. Examples become `.mmd`.
   - `SKILL.md` step 2 writes `<scratch>.mmd`. Then re-run `dev/bench` (target: authored source ≤ 1.5× pure Mermaid, agent time within 10% of the Mermaid arm).
5. **Page** (optional): Paste/Import Mermaid in the editor, from the same parser.

## Risks

- **Habits.** Agents write `flowchart TD` (which fixes the direction), `--` in ERDs, and their own `classDef` colours. Mitigations: the reference says to write a bare `flowchart`; `--` derives identifying from keys; foreign `classDef`/`style` lines are ignored with one `[INFO]`.
- **ERD join columns.** These are guessed when not written. A wrong guess only moves which rows highlight on hover; an unmatched one prints `[INFO]` and draws to the box edge, as today.
- **Mermaid drift.** Only v11 syntax is targeted. The harness pins the Mermaid version, and a newer one is checked by bumping it in `dev/`.
- **Three formats in one codebase** (JSON stored, Mermaid authored, the page's model). Mitigation: the parser and writer are the only bridge, and one round-trip test covers them.

## Open questions

1. A written direction (`flowchart LR`) is honoured, and the reference tells agents to omit it. Alternative: always treat it as a hint and still auto-pick. Recommended: honour it.
2. Should JSON input stay supported for agents (documented) or only for back-compatibility? Recommended: back-compatibility only.
