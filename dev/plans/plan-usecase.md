# Plan: Use case diagram type (`diagramType: "usecase"`)

Add UML use case diagrams as the fourth type, next to `flowchart`, `sequence` and `erd`. Same promise as the others: the agent writes a short logical JSON, the tooling lays it out, audits it and assembles one standalone, editable HTML page (or claude.ai Artifact) with the shared shell: pan/zoom/fit, theme, Save, undo/redo, Export and Copy, `?present`, help drawer, touch, Artifact Save.

**Status:** brainstorm, not approved. See [Open decisions](#open-decisions).

**Acceptance case:** an online shop with about **25 use cases, 7 actors (2 of them external systems) and 2 subjects** (Storefront, Back office), with at least 3 `include`, 2 `extend` (one with a condition), one actor generalization (Registered customer → Customer) and one use case generalization (Pay → Pay by card / Pay by wallet). Authored in one pass from a written requirements list, audit 90 or more with no `[WARN]`, fits a 1080p screen with Fit, and a reader can answer "what can the Warehouse clerk do?" in under 10 seconds (click the actor). A small example (8 use cases, 3 actors, 1 subject) is the reference example.

## Research summary

### What a use case diagram is for

A use case diagram shows **who** (actors) wants **what** (use cases, as goals) from **which system** (the subject, drawn as the boundary). It does not show order, data or internal steps: those belong in a flowchart, sequence diagram or ERD, which this skill already has. Every source agrees on the main failure: a use case diagram that turns into a flowchart (steps linked by `include` in sequence) or a feature list of tiny functions.

### Steps from business or system requirements (the authoring procedure)

Drawn from Cockburn's *Writing Effective Use Cases* (the actor-goal list and goal levels), the UML 2.5 use case chapter, and the Visual Paradigm, Microsoft and Sparx guidelines. This becomes the "Trace the requirements" part of `references/types/usecase.md`.

1. **Fix the subject (scope).** Name the system under design: one boundary per system. A requirement set that covers two systems (a storefront and a back office) gets two subjects. Anything outside every boundary is an actor.
2. **Find the actors.** For each requirement, ask who starts it and who else takes part. Actors are roles, not people or job titles of one person ("Customer", not "Alice"). Three kinds:
   - **Primary:** a role that starts a use case to reach a goal (drawn on the left).
   - **Supporting:** a role or external system the subject calls to do its job, such as a payment gateway or a mail service (drawn on the right).
   - **Time:** a scheduled trigger ("Nightly", "End of month") when a requirement starts on a clock.
   The database, the UI and the subject's own modules are never actors.
3. **List the goals (actor-goal list).** For each primary actor, list every goal the requirements give it, at **user-goal level** ("sea level"): one actor, one sitting, a result the actor would be happy to walk away with ("Place order", "Refund payment"). Name each as **verb + object** in the actor's words. Lower-level steps ("Log in", "Validate card") are not use cases unless they are shared (step 5). Higher-level summaries ("Manage store") are only kept as optional summary use cases.
4. **Connect.** Draw one association per actor and use case it takes part in. A primary actor's line is drawn from the actor; a supporting actor's line goes from the use case to it.
5. **Factor, only where the requirements show it:**
   - **`include`:** a piece of behaviour that two or more use cases **always** need ("Authenticate", "Calculate tax"). Arrow from the base to the included use case. Never use `include` to chain steps in order.
   - **`extend`:** optional or conditional behaviour added to a base at an extension point ("Apply voucher" extends "Checkout" *when the customer has a code*). Arrow from the extension to the base. Write the condition.
   - **Generalization:** a specialised actor that can do everything the general one can (Registered customer → Customer), or variants of one goal (Pay by card → Pay). Use sparingly.
   The test from every guide: *does it always happen?* `include`. *Only sometimes?* `extend`.
6. **Trace.** Every functional requirement maps to at least one use case (its ids go in `refs`). Every business rule, threshold, SLA or non-functional requirement that concerns a use case maps to a `note`. Nothing is dropped; nothing is invented.
7. **Check.** Each actor has at least one association; each use case is reached by an actor (directly, or through `include`, `extend` or generalization); no CRUD explosion (four use cases "Create/Read/Update/Delete X" become "Manage X" unless the requirements give them different actors); no `include` cycles; no actor inside a boundary.

### UML syntax: what we draw (the popular subset)

UML 2.5 defines more than tools commonly draw. v1 keeps what PlantUML, Visual Paradigm, draw.io and textbook diagrams all show.

| Element | Notation | In v1 |
|---|---|---|
| Actor (human) | stick figure, name below | ✅ |
| Actor (system) | box with `«system»` keyword (UML: a classifier with `«actor»`) | ✅ as an icon tile, see [Actors](#actors) |
| Actor (time) | clock icon (common practice, not UML) | ✅ |
| Use case | ellipse, name inside | ✅ |
| Subject / system boundary | rectangle, name at top | ✅, several allowed |
| Association | solid line, no arrowhead (optional open arrow from the initiator) | ✅, arrowhead off by default |
| Include | dashed line, open arrow to the included case, `«include»` | ✅ |
| Extend | dashed line, open arrow to the base, `«extend»`, optional condition `[...]` | ✅ |
| Generalization | solid line, hollow triangle at the parent, actor or use case | ✅ |
| Extension points compartment | ellipse split by a line listing points | ✅ shown only when a use case has `extensionPoints` |
| Abstract use case / actor | name in italics | ✅ (`abstract: true`) |
| Notes | note card with a dashed leader | ✅ shared note component |
| Multiplicity on associations | `1`, `0..*` at line ends | ❌ v2 (rare in practice, clutters) |
| Packages | folder tab around use cases | ❌ colour does that job (see [Colour](#colour)) |
| Use case as rectangle with ellipse icon | alternate classifier notation | ❌ |
| Business use case (slashed ellipse) | RUP extension, not UML | ❌ |

Text syntaxes for reference (Copy as): PlantUML has a full use case syntax (`actor`, `(Use case)`, `rectangle "System" { }`, `.> : include`, `<|--`). Mermaid has no use case diagram type at the time of writing (people fake it with `flowchart`), so Copy as Mermaid would be a lossy flowchart; Copy as PlantUML is the useful one (see [Copy as](#copy-as)).

## Goals

- A use case diagram drawn from a requirements list with nothing dropped: every actor, every goal, every requirement traced to a use case or a note.
- Reads like the other types: same header, dock, action bar, palette swatches, note cards, typography, help drawer, multi-select.
- Correct UML at a glance: the four line styles are unmistakable, and the arrow direction is right for each (the most common hand-drawn error).
- A large diagram stays readable: colour by feature area, click an actor to light its use cases, collapse a subject to its name.
- Edits by hand and by the agent combine (`--extract` → edit → `--layout`).
- One `engine.js` for `--layout`, Tidy and Auto-Tidy.

## Non-goals (v1)

- Use case **specifications** (main success scenario, extensions, pre/post conditions). The diagram can link to them (`refs`), and a scenario is a sequence or flowchart diagram.
- Multiplicity, packages, the classifier notation, business use cases, SysML.
- Importing PlantUML in the page.

## Data

```json
{
  "diagramType": "usecase",
  "title": "Online shop",
  "colorKey": { "1": "Ordering", "2": "Payments", "4": "Fulfilment" },
  "subjects": [
    { "id": "shop", "name": "Storefront" },
    { "id": "office", "name": "Back office" }
  ],
  "actors": [
    { "id": "customer", "name": "Customer" },
    { "id": "member", "name": "Registered customer", "parent": "customer" },
    { "id": "clerk", "name": "Warehouse clerk" },
    { "id": "psp", "name": "Payment gateway", "kind": "system", "side": "right" },
    { "id": "nightly", "name": "Nightly", "kind": "time" }
  ],
  "useCases": [
    { "id": "browse", "name": "Browse catalogue", "subject": "shop", "color": "1", "refs": ["FR-1"] },
    { "id": "checkout", "name": "Check out", "subject": "shop", "color": "1", "refs": ["FR-4", "FR-5"],
      "extensionPoints": ["Payment"] },
    { "id": "voucher", "name": "Apply voucher", "subject": "shop", "color": "1", "refs": ["FR-6"] },
    { "id": "pay", "name": "Take payment", "subject": "shop", "color": "2", "level": "subfunction" },
    { "id": "pick", "name": "Pick order", "subject": "office", "color": "4", "refs": ["FR-9"] },
    { "id": "reconcile", "name": "Reconcile payments", "subject": "office", "color": "2", "refs": ["FR-12"] }
  ],
  "links": [
    { "id": "l1", "type": "association", "from": "customer", "to": "browse" },
    { "id": "l2", "type": "association", "from": "member", "to": "checkout" },
    { "id": "l3", "type": "include", "from": "checkout", "to": "pay" },
    { "id": "l4", "type": "extend", "from": "voucher", "to": "checkout", "condition": "customer has a code", "extensionPoint": "Payment" },
    { "id": "l5", "type": "association", "from": "pay", "to": "psp" },
    { "id": "l6", "type": "association", "from": "clerk", "to": "pick" },
    { "id": "l7", "type": "association", "from": "nightly", "to": "reconcile" }
  ],
  "notes": [
    { "id": "n1", "text": "Guest checkout allowed up to 200 EUR (BR-3)", "useCases": ["checkout"] }
  ]
}
```

| Object | Field | Description |
|---|---|---|
| Diagram | `colorKey` | Optional. `{ "1": "Payments" }`: the feature area each slot stands for, shown as a legend. Written whenever `color` is used. |
| Diagram | `showRefs` | Optional. `true` shows each use case's `refs` as a small chip under its name (traceability view). The page's **Refs** toggle. |
| Diagram | `showNotes` | Optional. `true` draws notes on the canvas instead of as badges (same as ERD). |
| Subject | `id`, `name` | One system boundary. Order is top to bottom. A diagram with one subject may omit `subjects`; use cases then sit in one unnamed boundary titled with `title`. |
| Subject | `collapsed` | Optional. Draws the boundary as a name bar; its lines end on the bar. Never authored unless asked. |
| Actor | `id`, `name` | A role. 24 characters. |
| Actor | `kind` | Optional. `human` (default, stick figure), `system` (box tile with a server icon and `«system»`), `time` (clock tile). |
| Actor | `side` | Optional. `left` or `right`. Default: `left` for an actor that starts any association, `right` for one that is only ever the target (a supporting actor). |
| Actor | `parent` | Optional. Actor id: an actor generalization. Drawn as a hollow-triangle line; the child sits beside or below the parent. |
| Actor | `color` | Optional. A palette slot. Default neutral: actors are coloured only when the user asks (see [Colour](#colour)). |
| Use case | `id`, `name`, `subject` | `name` is verb + object, 40 characters, wraps to two lines inside the ellipse. |
| Use case | `color` | Optional slot `"1"`–`"8"`: the feature area. Tints the ellipse fill. |
| Use case | `level` | Optional. `summary`, `user` (default), `subfunction`. A subfunction is drawn smaller with a dashed outline; a summary is drawn larger with a bold outline. Colour is never the only cue. |
| Use case | `refs` | Optional list of requirement ids (`"FR-4"`), 12 characters each. Searchable in the page, shown with `showRefs`. |
| Use case | `extensionPoints` | Optional list of names. Draws the extension-points compartment. |
| Use case | `abstract`, `parent` | Optional. Italic name; `parent` is a use case generalization (to a use case id). |
| Link | `id`, `type`, `from`, `to` | `type` is `association`, `include` or `extend`. Generalizations are `parent` fields, not links, so they can never point the wrong way. |
| Link | (direction) | `association`: actor ↔ use case, either order (`from` is the initiator when known). `include`: from the base to the included case. `extend`: from the extension to the base it extends. |
| Link | `condition` | Optional, `extend` only, 40 characters: drawn as `[condition]` under `«extend»`. |
| Link | `extensionPoint` | Optional, `extend` only: one of the base's `extensionPoints`. |
| Link | `navigable` | Optional, association only. `true` draws an open arrowhead toward `to`. |
| Note | `id`, `text`, `useCases`, `actors` | Attached to one or more ids. 120 characters. |

Disk format: key order `diagramType, schemaVersion, title, showRefs, showNotes, colorKey, subjects, actors, useCases, links, notes, layout`; `layout` holds actor and use case positions (manual placement survives Save, as for the ERD). Editor ids `a_`, `u_`, `s_`, `l_`, `n_` are renamed to name slugs and `l<N>`, `n<N>` on Save. `meta.json` `dataNote`: "`actors` are roles outside the system; `useCases` are goals inside a `subject` boundary; `links` connect them: association (actor-use case), include (base → always-included), extend (extension → base, optional, with `condition`); `parent` is a generalization; `refs` are requirement ids; `layout` is display-only."

## Actors

- **Human:** stick figure from the icon registry (new icon `actor`, drawn for this skill on the 24 grid and scaled up), name below in `.t-label`.
- **System:** a rounded tile with the `server` icon and `«system»` in `.t-caption` above the name. Easier to read than a second stick figure, and matches what UML allows (a classifier keyworded as an actor).
- **Time:** the same tile with the `clock` icon.
- Generalization between actors: child below its parent in the same column, hollow triangle on the parent.

## Layout (engine.js)

The classic picture every reader expects: primary actors in a column on the left, the subjects stacked in the middle, supporting actors on the right.

1. **Columns.** Left actors, subjects, right actors. Actor columns are one tile wide; actors with a `parent` sit under it.
2. **Inside a subject, rows of use cases.** Each use case gets a rank along the horizontal axis: rank 0 for cases an actor touches directly, then +1 for each `include` hop (included cases sit to the right of their bases) and each `extend` hop (extensions sit to the right of, or below, their base). Use case generalization children sit below their parent.
3. **Vertical order.** Barycentre ordering (as the flowchart engine does across lanes) against the actor positions, then sweeps to reduce crossings; ties broken by colour (same feature area stays together) and then by authored order. Actors are reordered against their use cases in the same sweeps, so each actor ends up level with the middle of its goals.
4. **Subject size** from its content; subjects share one width so the boundary edges line up.
5. **Lines.** Straight lines from actor to ellipse edge (use case diagrams are read as spokes, not routed wiring); `include`/`extend` as short straight or gently curved dashed lines between neighbours; labels `«include»`/`«extend»` as `.edge-label` pills at the midpoint, nudged off other labels. No orthogonal routing: it makes use case diagrams look like flowcharts.
6. **Long spokes.** An actor with lines to more than about 8 cases: the lines bundle into a short trunk before fanning out, reusing the ERD's trunk idea.

Auto-Tidy on: any add, delete or reconnect re-runs the engine (as the flowchart). Off: positions are free and saved in `layout` (as the ERD).

## Colour

Colour is the reader's first grouping cue, so it follows the existing rule: palette slots only, a legend from `colorKey`, colour never the only cue.

- **Use cases by feature area** (the default). The agent groups goals by the requirement document's sections or headings ("Ordering", "Payments"), gives each a slot and writes `colorKey`. A diagram of 8 or fewer use cases may stay neutral. The ellipse takes `--sw-<n>-fill`, its outline `--sw-<n>-line`.
- **Actors neutral** by default, because the left-right placement already says primary or supporting. The user can colour an actor with the swatch row (useful for "internal vs external" roles).
- **Subjects** use the neutral panel background with the lane border token: a boundary is a frame, not a category.
- **Line styles** are not coloured: association `--edge`, include and extend the same colour but dashed, so a theme stays calm. On hover or selection they take the existing in/out/selected edge states.
- The audit warns when a diagram has more than 12 use cases and none has a colour, as the ERD does at 8 tables.

## Interaction and UX

Everything below reuses an existing pattern; the right-hand column names where it comes from.

### Add and connect

| Gesture | Result | Reused from |
|---|---|---|
| Dock tiles **Actor**, **System actor**, **Use case**, **Subject**, **Note**: click adds at the centre of view, drag drops under the cursor with a ghost | New item, label in edit mode | sequence dock drag, ERD add table |
| Drop a use case inside a subject | Joins that subject | flowchart lane drop |
| Drag from an item's connect port to another | Actor → use case: association. Use case → use case: `include` (the most common); the line's action bar switches it | flowchart ports |
| Drop a port drag on blank canvas inside a subject | Creates a new use case there, already connected ("draw out a goal") | flowchart port-to-blank |
| Double-click a label | Edit in place; Enter commits, Esc cancels | all types |

### Select and act (multi-select)

Same gestures as the flowchart and ERD, so nothing new to learn:

| Gesture | Result |
|---|---|
| Click | Selects one item (actor, use case, subject, line or note) |
| Ctrl/Cmd + click | Adds or removes an actor or use case |
| Shift + drag on blank canvas | Selection box (`selectInRect`), touching counts |
| Ctrl/Cmd + A | Selects every actor and use case |
| Drag a selected item | Moves the whole selection; dropping use cases on another subject moves them there |
| Delete / Backspace | Deletes the selection and its lines, one undo step |
| Esc / blank click | Clears |

The **multi-select action bar** (new for this type, built from existing `.btn` and `swatchRow()`) appears above a selection of two or more:
- **Colour** swatch row: recolour every selected use case (or actor) at once, the fastest way to colour by feature area by hand.
- **Subject** menu: move the selected use cases to another subject.
- **Connect to…**: with exactly one actor and N use cases selected, associate the actor with all of them in one step.
- **Delete N**.

### Line action bar

Two rows, as the ERD and sequence bars: (1) type: **Association**, **Include**, **Extend**, and for association **Arrow** on/off; (2) **Reverse**, **Condition** (extend only, inline field), **Extension point** (menu of the base's points), **Delete**. Choosing Extend on an include line reverses its direction automatically (include points base → part, extend points extension → base), with a hint saying so: that is the error people make most.

### Read and explore

- **Click an actor:** its use cases (and everything they include or extend) stay at full strength, the rest dims. Click again or Esc to clear. This answers "what can this role do?" without reading lines. (ERD hover highlight, but on click so it works on touch.)
- **Click a use case:** lights its actors and its include/extend neighbours.
- **Search** (`/` or the header field): match names and `refs`; matches light up and Fit zooms to them. Typing `FR-4` finds the use case that implements it.
- **Refs** toggle: shows requirement chips; **Levels** toggle: hides subfunction cases for a goal-level overview.
- **Collapse a subject:** chevron on its name, as frames collapse in the sequence diagram.
- Help drawer: the four line types with a tiny drawing of each, and the always/sometimes test.

### Accessibility

Lines differ by dash and arrowhead, not colour. Use case level differs by size and outline, not colour. All controls 24 × 24 px or more with the focus ring. Every actor and use case is focusable; arrow keys move focus to the nearest item in that direction; Enter edits.

## Audit (`scripts/audit_usecase.py`)

| Rule | Level |
|---|---|
| Unknown id in `from`, `to`, `subject`, `parent`, a note's `useCases`/`actors` | error |
| Association not between an actor and a use case; include/extend not between two use cases | error |
| `include` or `parent` cycle | error |
| `extensionPoint` not in the base's `extensionPoints` | error |
| Actor with no association (directly or through a `parent`) | warn |
| Use case no actor reaches (through association, include, extend or a parent) | warn |
| `include` with a single base and no other reason (it is just a step: fold it in) | info |
| A chain of 3 or more `include` hops | warn ("this is a flow: use a flowchart") |
| Name budgets: actor 24, use case 40, condition 40, ref 12, note 120 | warn |
| Use case name that does not start with a verb (simple word list check, English only) | info |
| More than 12 use cases and none coloured | warn |
| Overlaps: ellipses, labels, lines through ellipses, actor inside a boundary | error / warn as in the other audits |

## Copy as

- **PlantUML** (new optional plugin hook `toPlantUML()`, shown in Export › Copy like `toMermaid`): lossless for everything in v1. Example output: `left to right direction`, `actor "Customer" as customer`, `rectangle "Storefront" { usecase "Check out" as checkout }`, `checkout .> pay : <<include>>`, `voucher .> checkout : <<extend>>`, `member --|> customer`.
- **Mermaid**: none in v1 (no native type). Revisit if Mermaid adds one.

## Files

New, following the checklist in `dev/architecture.md`:

```
assets/types/usecase/  meta.json usecase.css usecase.js engine.js toolbar.html stage.html chrome.html help.html default.json
references/types/usecase.md        schema, the 7 authoring steps, budgets, visual checklist, failure handling
references/examples/example-usecase.json
scripts/audit_usecase.py           registered in AUDITS
dev/fixtures/usecase/*.json        + golden
dev/test_audit_usecase.py, dev/e2e_usecase.mjs
```

Changed: `SKILL.md` (type table, read-back line for use cases), `scripts/layout_engine.py` (type registry), `scripts/disk_format.py` (codec), `assets/icons/default.json` (`type-usecase`, `actor`), `assets/tokens/default.json` (contrast pairs for the ellipse fill and text, a `usecase` metric key if the ellipse text needs one), `shell.js` (the `toPlantUML` copy item), `dev/architecture.md`, README type table.

## Phases

1. **Model and engine.** Schema, codec, `engine.js` columns + ranks + barycentre, `audit_usecase.py`, fixtures and golden. `--layout` produces a static page.
2. **Render.** Actor figures and tiles, ellipses with levels and extension points, subjects, the four line styles, labels, notes, legend.
3. **Edit.** Dock, ports, line action bar, label editing, Auto-Tidy, Save, undo.
4. **Multi-select.** `selectInRect`, `selectAll`, group move between subjects, multi-select action bar (colour, subject, connect, delete).
5. **Explore.** Click-to-focus, search with refs, Refs and Levels toggles, subject collapse.
6. **Copy as PlantUML**, help drawer, reference doc, example, README, `check_themes.py` and `check_contrast.py --strict` clean.

## Tests

- `dev/test_audit_usecase.py`: one failing and one passing case per audit rule.
- `check_golden.py`: engine output for each fixture, and laying out the saved model again moves nothing.
- `dev/e2e_usecase.mjs`: add each item from the dock; connect actor → case (association) and case → case (include); switch include → extend reverses the arrow; set a condition; multi-select 3 cases by box, recolour them in one step, move them to another subject, one undo restores all; Connect to… creates N associations; Delete N; click an actor dims the rest; search by ref; Save round trip keeps ids and positions; `?present` disables editing.
- `check_themes.py` on all fixtures under every theme; `check_overflow.mjs` on the acceptance page; `build_examples.py --check`.
- The PlantUML copy of the example and the acceptance case renders in PlantUML without errors (checked once, by hand, like the ERD's Mermaid check).

## Open decisions

1. **Type name:** `usecase` (proposed) or `use-case`.
2. **Generalization as a `parent` field** (proposed: it cannot point the wrong way and an agent cannot forget the direction) or as a fourth link `type`.
3. **Default colouring:** use cases by feature area with neutral actors (proposed), or colour by actor (each use case takes its primary actor's colour). By-actor breaks when a goal has two actors, which is common.
4. **System actor shape:** icon tile (proposed, more readable) or a second stick figure with `«system»`, which some textbooks use.
5. **Connect gesture between two use cases:** default to `include` and switch in the action bar (proposed, one drag), or show a small chooser on drop (one more click every time, but explicit).
6. **Copy as PlantUML:** in v1 (proposed: it is the main text format for this diagram type) or later.
7. **Requirement traceability:** `refs` plus search in v1 (proposed), or later. It is what ties the diagram back to the requirements document, which is the point of the authoring procedure.

## Sources

- Cockburn, *Writing Effective Use Cases* (draft): actor-goal list, goal levels. https://courses.cs.duke.edu/compsci308/spring23/readings/cockburn_use_cases.pdf
- Cockburn, use case fundamentals. https://www.cs.uno.edu/~jaime/Courses/4210/useCaseFundamentals.html
- UML use case reference (include, extend, extension points, generalization, multiplicity). https://www.uml-diagrams.org/use-case-reference.html
- Microsoft, UML use case diagram guidelines. https://msdn.microsoft.com/ja-jp/library/dd409432.aspx
- Visual Paradigm, UML 2 use case guide. https://s.visual-paradigm.com/guide/mastering-uml-2-0-use-case-diagrams-a-comprehensive-guide-to-capturing-functional-requirements/
- Sparx, use case diagram. https://www.sparxsystems.eu/resources/reading-sample-project-development-with-uml-and-enterprise-architect/use-case-diagram
- PlantUML use case syntax. https://plantuml.com/use-case-diagram
