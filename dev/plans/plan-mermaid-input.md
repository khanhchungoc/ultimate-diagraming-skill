# Plan: Mermaid as the authoring format

Status: Phases 0–3 done (2026-11-18): `dev/check_mermaid.mjs` passes 93 checks (round trip, Mermaid validity, leniency corpus); the `--layout` dry run waits for Phase 4. Follows `plan-speed-cost.md` P1: in the benchmark, the agent's JSON was 3.3× the size of the same diagram in Mermaid, and two thirds of the JSON was syntax and ids, not content.

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
6. **Same functionality, the user decides every difference.** Switching the authoring format changes no behaviour of the skill, the page or the engines. Wherever a field cannot survive the round trip exactly, or a mapping needs an interpretation this plan does not fix, the work implements the plan's default (if any) and lists the case for the user to decide; it is never settled silently.

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
   - `--layout x.mmd` (detected by extension, or by no leading `{`); `--extract` → Mermaid; `--keep-from`. JSON input accepted for old files only (decision 2).
   - Rewrite the type references as Mermaid cheat sheets: the mapping rows above that an author needs, plus today's writing rules. Examples become `.mmd`.
   - Trim the reading path (measured before the rewrite: flowchart 30.8 KB, ERD 22.8 KB, use case 23.2 KB, sequence 17.9 KB read before the first write; target about 20, 14, 14 and 11 KB): Schema sections become short Mermaid-extras sections; Failure handling sections go (every `[WARN]` names its fix); examples are inline `.mmd`, not a separate read; `reading.md` goes or shrinks to a line; the artifact update steps use `--keep-from`.
   - Review the writing rules (now the largest part, flowchart 10.5 KB): remove repetition, wording that restates another rule, and rules the engine now enforces or derives; keep every rule that changes what the agent draws. Report each removed rule with its reason, so the user can reject any.
   - `SKILL.md` step 2 writes `<scratch>.mmd`. Then re-run `dev/bench` (target: authored source ≤ 1.5× pure Mermaid, agent time within 10% of the Mermaid arm).
5. **Page** (optional): Paste/Import Mermaid in the editor, from the same parser.

## Risks

- **Habits.** Agents write `flowchart TD` (which fixes the direction), `--` in ERDs, and their own `classDef` colours. Mitigations: the reference says to write a bare `flowchart`; `--` derives identifying from keys; foreign `classDef`/`style` lines are ignored with one `[INFO]`.
- **ERD join columns.** These are guessed when not written. A wrong guess only moves which rows highlight on hover; an unmatched one prints `[INFO]` and draws to the box edge, as today.
- **Mermaid drift.** Only v11 syntax is targeted. The harness pins the Mermaid version, and a newer one is checked by bumping it in `dev/`.
- **Three formats in one codebase** (JSON stored, Mermaid authored, the page's model). Mitigation: the parser and writer are the only bridge, and one round-trip test covers them.

## Decisions (2026-11-18)

1. A written direction (`flowchart LR`, `TD`) is honoured. The type reference tells agents to write a bare `flowchart` so `--layout` picks.
2. JSON input stays accepted for old files only; agent-facing docs describe Mermaid alone.

## Decisions after Phases 0 and 1 (2026-11-18)

These override the tables above where they differ.

- **Flowchart step order**: the writer lists steps grouped by lane, so the step order in the JSON changes after a round trip (same steps and edges; the engine drew identical layouts on the 4 fixtures tested). The harness compares flowchart steps by id.
- **No swimlanes is exact**: no subgraph imports as `"swimlanes": false` with `"lanes": []` and no `laneId` (the engine makes its own lane). Hidden but named lanes are written as subgraphs plus `%% @swimlanes false`, so their name, icon and colour survive.
- **Use case arrowheads**: associations are plain whatever arrow is written; `navigable` comes only from `%% @navigable <from> <to>`.
- **Notes** are flag nodes joined by dotted lines only (`-.-`, `-.->`); a flag node on a solid line is a step or a use case.
- **Custom colours** (a hex instead of a slot) survive as `%% @color <id> <value>`, for lanes, actors and use cases.
- **Accepted as built**: an unlabelled line between two use cases or two actors is a `[WARN]` and is skipped; a use case file with no subgraph and no actor gets an `[INFO]`; one subject makes `subject` explicit on every use case; ids are sanitised (`lane-x` → `lane_x`) and `layout` keys must follow; unknown non-text fields are dropped until one exists; import-only leniency (invisible links dropped, unknown shapes read as tasks, `classDef`/`style` ignored) stays.
- **Extra syntax the writer emits for exactness**: `%% @schemaVersion`, `%% @<key> <id> <value>` for unknown text fields (such as a node's `outcome`), and the classes `isStart`/`isEnd` when start or end cannot be derived from the edges.

## Decisions after Phases 2 and 3 (2026-11-18)

These override the Sequence and ERD tables above where they differ.

- **Phase names** (a sequence `group`): Mermaid's `rect` colours a band of messages but cannot name it. The name is the first line inside the rect, a note over every lifeline, `Note over <first participant>,<last participant>: Payment`; on import, a note before the rect's first message is its name. No `%% @label`.
- **Empty frames and branches** (allowed in Mermaid, not in our model): dropped on import with an `[INFO]`; their notes stay in place, anchored to the neighbouring message.
- **A note before the first message** reads as a note with no anchor (both sit above the first message).
- **Participant box colours**: the nearest palette slot to the written colour; no colour (or no palette) takes the next free slot.
- **ERD line style is strict Mermaid**: `--` is identifying, `..` is not; no derivation from keys on import. The writer emits `--` exactly when the relationship is identifying in effect. The ERD reference tells agents to use `..` for an ordinary foreign key.
- **ERD ends are written explicitly**: unset ends come back as their effective values (same drawing). No unset markers.
- **ERD join columns** are derived from names only (no pairing fallback); a missing match stays a `[WARN]` the agent fixes with `[col]` in the label.
- **Accepted as built**: sequence frame and note order follows the text, invalid data is normalised, unknown sequence fields are dropped, activation bars are not written into the Mermaid; ERD `*hex*` escape for names Mermaid rejects, `%% @childRight`, and the edge values (no name → id, explicit false and empty strings → absent, trimmed notes).

## Decisions before Phase 4 (2026-11-18)

- **Box colours**: the sequence writer keeps `%% @color <slot>` before each `box` it writes, so its own files round-trip without a palette; hand-written boxes take the nearest palette slot.
- **Lane icons are automatic**: a lane without `icon` gets one picked by `--layout` from its name (the keyword table in the flowchart reference), different for each lane, reported as one `[INFO]` line; a missing icon is no longer a `[WARN]` (an unknown icon name still is).
- **Copy as Mermaid** in the page uses the lossless writers (the old export-only `toMermaid()` functions go); use case pages get it too.
- **Phase 5 is required**: Paste/Import Mermaid in the page, from the same readers, keeping positions where ids are unchanged.
- **Flowchart pages lay out steps that have no position on load** (as ERD and use case pages already do), so a step added by hand to the JSON no longer sits on top of another step.

## Phase 4 and 5 split (parallel, disjoint files)

| Part | Files | Delivers |
|---|---|---|
| CLI | `scripts/layout_engine.py` (except `_build_parts`/page assembly), `scripts/engine_runner.py`, `scripts/mermaid_io.mjs`, `dev/check_mermaid.mjs` (dry-run step), `dev/check_extract.py` and other CLI tests | `--layout x.mmd`, `--extract` prints Mermaid (`--json` for the old output), `--keep-from`, Mermaid import infos/warnings as `[INFO]`/`[WARN]`, automatic lane icons, Chrome fallback without Node |
| Docs | `SKILL.md`, `references/**` (examples become `.mmd`) | Mermaid authoring, trimmed reading path, writing-rules review with every removed rule listed |
| Page | `assets/**` (plugins, shell), page assembly in `scripts/layout_engine.py` (`_build_parts`), `dev/e2e_*.mjs` | lossless Copy as Mermaid, Paste/Import Mermaid, flowchart lays out unplaced steps on load |

## Phase 0 and 1 interfaces

Fixed up front so the harness, the flowchart mapping and the use case mapping can be built in parallel.

### Files

| File | Owner phase | Defines (plain script, no DOM, no imports, globals only, like `engine.js`) |
|---|---|---|
| `assets/shell/mermaid-flow.js` | 1 | `mmdParseFlow(text)`, `mmdText(s)` (unescape), `mmdQuote(s)` (escape + quote for a label), `mmdSafeId(id, used)` |
| `assets/types/flowchart/mermaid.js` | 1 | `fromMermaid(text) -> { data, infos, warnings }`, `toMermaid(data, opts) -> string` |
| `assets/types/usecase/mermaid.js` | 1 | same two functions, for use case |
| `scripts/mermaid_io.mjs` | 0 | Node loader: `loadMermaidIO(kind)` concatenates `assets/shell/mermaid-flow.js` (flowchart and use case; later the other types' own shared file) and `assets/types/<kind>/mermaid.js` into `new Function(...)` and returns `{ fromMermaid, toMermaid }`. CLI: `node scripts/mermaid_io.mjs from <kind> < x.mmd` prints `{data, infos, warnings}`; `node scripts/mermaid_io.mjs to <kind> < x.json` prints Mermaid. Phase 4 wires it into `layout_engine.py`. |
| `dev/check_mermaid.mjs` | 0 | the harness (below) |
| `dev/fixtures/mermaid/corpus/*.mmd` | 0 | leniency corpus: the benchmark agents' Mermaid (`bench-*.mmd`), the two convention samples, and habit cases |

`toMermaid(data, opts)`: `data` is authoring JSON (as `--extract` prints it). `opts.palette` (optional) is an array of 8 hex colours for slots 1–8; when given, the writer adds `classDef c<n> fill:<hex>` for the slots it uses, and otherwise no `classDef` lines.

`fromMermaid(text)` never throws on valid Mermaid. `infos` are `[INFO]` lines (lenient mappings, ignored statements). `warnings` are `[WARN]` lines (a data problem the author must fix, such as a note linked to nothing). It throws `Error("line N: …")` only for text it cannot tokenize at all.

### `mmdParseFlow(text)` result (the flowchart-family AST)

```js
{
  title: 'Online shop' | null,            // front-matter `title:`
  dir: 'LR' | 'TB' | null,                // header direction; TD -> TB, RL -> LR, BT -> TB (+ info); bare `flowchart`/`graph` -> null
  directives: [{ key: 'icon', args: 'lane_hm user', line: 7 }],   // every `%% @key args` line, in order; plain `%%` comments dropped
  nodes: [{ id, label, shape, classes: ['c1', 'system'], line }],  // first declaration wins for label/shape; classes merge from :::, `class` lines
  edges: [{ from, to, label, stroke: 'normal'|'dotted'|'thick'|'invisible', head: 'arrow'|'none'|'circle'|'cross', both: false, line }],
  subgraphs: [{ id, title, parent: null | id, nodes: [ids in order], classes: [], line }],
  ignored: [{ line, text }]               // style/linkStyle/click/classDef/accTitle/... (one info per kind is enough)
}
```

- `shape` is Mermaid's name for it: `rect` `[ ]`, `round` `( )`, `stadium` `([ ])`, `subroutine` `[[ ]]`, `cylinder` `[( )]`, `circle` `(( ))`, `dbl-circ` `((( )))`, `odd` `> ]`, `diamond` `{ }`, `hex` `{{ }}`, `lean-r` `[/ /]`, `lean-l` `[\ \]`, `trap-b` `[/ \]`, `trap-t` `[\ /]`. For `@{ shape: x }` it is the canonical v11 name (aliases resolved: `doc`/`document`, `delay`, `sm-circ`/`start`, `fr-circ`/`stop`, `f-circ`, `subproc`/`subprocess`, `cyl`, …). A node only ever referenced in edges gets `rect` with label = id.
- Labels: quotes stripped, entities (`#quot;`, `#35;`, `#59;`, numeric `#NNN;`) and `<br>`/`<br/>` turned into `"` `#` `;` and `\n`. Markdown-string backticks are stripped. Unquoted labels with parentheses are accepted (Mermaid rejects them; agents write them).
- Edges: `a --> b`, `a -->|x| b`, `a -- x --> b`, `a -. x .-> b`, `a == x ==> b`, chains `a --> b --> c`, fans `a & b --> c & d` (expanded in order), `~~~` (invisible), extra dashes (`--->`), edge ids `e1@-->` (id ignored), inline declarations (`a["A"] --> b{"B"}`).
- Subgraphs: `subgraph id["Title"]`, `subgraph id[Title]`, `subgraph Title words` (id = title), `direction X` inside is ignored. `nodes` lists the nodes declared or first referenced inside it (Mermaid's own rule); a node in nested subgraphs belongs to the innermost one.
- `;` ends a statement as Mermaid allows; `end` closes a subgraph.

### Harness (`dev/check_mermaid.mjs`, run as `node dev/check_mermaid.mjs --browser <chrome>`)

1. **Round trip**, for each flowchart and use case JSON in `dev/fixtures/<kind>/**/*.json` and `references/examples/`: `extract` (authoring JSON, as `layout_engine.py --extract` prints it) → `toMermaid` → `fromMermaid` → compare with a normaliser: ids passed through `mmdSafeId`; edge, link and note ids ignored (edges, links and notes compared as ordered lists of content); positions, `layout` and derived fields dropped; defaults made explicit (node `type` task, use case `level` user, actor `kind` human). Each difference is printed as a path plus both values.
2. **Validity**: every written `.mmd` passes `mermaid.parse` (Mermaid 11.17.2, a devDependency, loaded from `node_modules` into headless Chrome through `dev/cdp.mjs`).
3. **Leniency**: every `dev/fixtures/mermaid/corpus/*.mmd` of a flowchart-family type imports without throwing. Use case files are the ones with `%% @type usecase`. Then a `--layout` dry run produces no `[ERROR]`; that last step only once Phase 4 exists, so it is skipped with a notice until then.
4. Prints `[PASS]`/`[FAIL]` per case and exits 1 on any failure, like the other `dev/check_*.py`.

## Status and remaining work (2026-11-18)

Done on `ccr-c18dbf2f-2xj17k`: Phases 0–3 (readers, writers, harness), the Phase 4 CLI (`--layout x.mmd`, `--extract` → Mermaid with `--json` for the old output, `--keep-from`, automatic lane icons from `assets/icons/lanes.json`) and the Phase 4 docs (Mermaid `SKILL.md` and references). `node dev/check_mermaid.mjs --browser <chrome>` passes; `dev/test_cli_mermaid.py`, `dev/check_golden.py`, `dev/check_extract.py`, `dev/check_artifact_shape.py`, `dev/check_tokens.py` and the audit tests pass. Phase 5 (page) is merged too: lossless Copy as Mermaid on all four types, Import Mermaid text in the Export menu, flowchart pages lay out unplaced steps on load. All `dev/e2e_*.mjs` suites pass on the merged branch (`e2e_mermaid`, `e2e_connectors` 39/39, `e2e_multiselect` 42/42, `e2e_activations`, `e2e_lanes`, `e2e_shapes` 16/16, `e2e_notes` 15/15, `e2e_search` on all 4 types, `e2e_theme` 13/13, `e2e_erd_copy` 18/18, `e2e_sequence`, `e2e_shell`, `e2e_usecase` 83/83, `e2e_erd` 227/227, `e2e_touch` 35/35). Pages grew 33–51 KB (the readers and writers are now in every page).

### Decisions settled (2026-11-18)

**Docs:**
- D1: Keep `SKILL.md` as-is.
- D2: Keep `--keep-from` as the default for all updates.
- D3: Keep the unified artifact update flow (sibling `index.html` carries any stored theme).
- D4–D5: Legacy single-file artifacts are recreated fresh as split artifacts (`--layout <scratch.mmd> --target artifact`, without `--keep-from`); "Upgrade with a newer engine" keeps JSON input with `--keep-layout`.
- D6: Sequence lifespans documented as `create`/`destroy` only when the source states a participant starts later or ends earlier.
- D7: Keep the new sequence conventions (`rect transparent`, `box <colour> <label>` + `%% @color <slot>`, always quote labels, `;` as `#59;`, `#` as `#35;`).
- D8, D10: Keep rule 7's parenthetical for phase lanes; `README.md` already avoids JSON authoring and `dev/architecture.md` was updated to Mermaid authoring.
- Writing-rules review: accepted the 27 removed/merged rules from commit `39e7e5e`.

**CLI:**
- C1–C2: `_via_browser` in `scripts/engine_runner.py` switched from one-shot `--dump-dom` to `measure_font.chrome_session` (which handles `--no-sandbox` as root).
- C3–C8: Confirmed as built (lane colours merged only in Mermaid `--extract`; sequence `--keep-from` checks participant ids + message count; automatic lane icons on `--keep-from` and skipped on `--keep-layout`; `--keep-layout`+Mermaid / `--keep-from`+JSON error; `--extract` palette lookup order).
- C9: Applied (use case reader silently ignores `classDef c1..c8` and adds `[INFO]`/`[WARN]` prefixes; flowchart writer drops `%% @schemaVersion`).

**Page:**
- P1: Moved Import Mermaid to a dedicated toolbar button (`#btn-import-mermaid`, "Paste Mermaid").
- P2: Added canvas paste (`Ctrl+V` / `paste` outside text fields) for Mermaid text.
- P3–P4: Confirmed as built (immediate apply + "Imported, with notes" list; replaces diagram, keeps title if omitted, one undo step).
- P5: Always re-lay out every diagram type on import (`importMermaid` no longer carries over `old.layout`).
- P6–P9: Confirmed as built (flowchart lays out unplaced steps on load; Copy-then-Import normalization; lossless Copy as Mermaid; lane colours merged from `layout` map).

### Work still to do

1. ~~Rerun the e2e suites not yet run after the merge~~ (done 2026-11-18).
2. ~~Settle the decisions above, then apply them~~ (done 2026-11-18).
3. ~~C9 follow-ups~~ (done 2026-11-18).
4. ~~`scripts/check_env.py` still lists `references/examples/*.json`~~ (moved to `dev/examples/*.json` and removed from `scripts/check_env.py`, 2026-11-18).
5. Re-run the skill-vs-Mermaid benchmark (`dev/bench/`, Sonnet sub-agents per arm, same four briefs) and record the result in `plan-speed-cost.md`; target: authored source ≤ 1.5× plain Mermaid, agent time within 10% of the Mermaid arm.
6. Merge to `main` once the user approves (version bump: this changes the agent-facing format, so MINOR at least, by hand per `dev/versioning.md`).
