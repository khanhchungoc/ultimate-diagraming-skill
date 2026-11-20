# Reading the Mermaid

Used when explaining an existing diagram: `--extract` prints standard Mermaid, so read it as Mermaid. Only these conventions go beyond it (a `c4` page is the exception: it is JSON, see the last section) (`%% @...` lines are directives; the first line, or `%% @type usecase`, gives the type).

## Flowchart

Each `subgraph` is a swimlane (the actor); steps are in their lane. A pill `(["..."])` with no outgoing edge is an end, any other pill a start. `==>` is a loop back to an earlier step. A flag node `n1>"..."] -.- a & b` is a note on steps `a` and `b`, not a step. A note that explains nothing in particular (a free note) is printed after the diagram, under a `%% Notes` heading, one `%% <id>: text` line each, in every type but sequence.

A large flow is split into subprocesses. `--extract` prints, in this order: a `%%` outline (totals, then one line per subprocess with its step and lane counts and its end states), the parent flow, then each child as a top-level `subgraph sub_<slug>["Name"]` block, in the order the parent reaches them (depth first; a grandchild is a `sub_` block inside its parent's block, up to 4 levels, and the outline indents one step per level), with its arrows and notes after the block. Read the outline first, then the parent, then the children you need. A `[["..."]]` step is a link to the `sub_` block with the same slug; the child's start pill is its entry and its end pills are the outcomes the parent routes on. A lane id repeated in a `sub_` block is the same actor. Arrows never cross a `sub_` block. `--extract <file> --flat` prints one flow with every subprocess, at every level, expanded in place (for end-to-end questions); `--extract <file> --sub <slug>` prints one child alone.

## Sequence

Messages are in time order (a step number is a message's position). `->>` is a call, `-->>` a reply, `-)` async; `Label<br>detail` splits at the first `<br>`. A `rect` is a named phase: its name is the first note inside it, over the first and last participant. A `box` colours its participants, its label is the colour's meaning. A note sits below the message above it, or above the next message after a frame opening, `else` or `end`.

## ERD

The marker next to a table says how many of its rows relate to one row of the other table; the child (the table holding the foreign key) is the many side, or the right-hand table in a one-to-one. `--` is an identifying relationship, `..` is not. `?` after a type is nullable, `-` in a type is a space. The join columns are named in the label as `[col]` or follow from the column names. `class` and `%% @colorKey` give the domain colours; `%% @note table: text` and `%% @note table.column: text` are notes.

## Use case

Inside a `subgraph` (a system boundary) is a use case, outside is an actor. `:::system` and `:::time` mark an external system and a scheduled trigger; `subfunction` a lower-level use case. `a --- b` is an association, `base -.->|include| used` goes from the base to the included use case, `ext -.->|"extend (point): condition"| base` from the extension to its base, `child -->|is a| parent` is a generalization. `:::c1` to `:::c8` and `%% @colorKey` mark feature areas, `%% @refs` the requirement ids, `%% @points` the extension points.

## C4

`--extract` prints no Mermaid for a c4 page (`Mermaid is not supported yet for "c4"`; it is not available yet). Read the JSON instead: `--extract <page.html or diagram.json> --json` prints the canonical diagram, or read only the lines the page's line 2 names (the `"diagram-data"` block). The keys come in this order: `diagramType, schemaVersion, title, arrange, showTech, showNotes, colorKey, groups, elements, relations, notes`, then a trailing `layout` map `{id: {x, y}}` (elements, then groups; ignore it, and `--json` leaves it out). `arrange` (`surround`, `flow` or `layers`) is the layout; when absent it is `surround` if any item has `core: true`, else `flow`. Groups (`kind` `boundary` or `system`, `parent`, `collapsed`) hold elements through `group`; `collapsed: true` on every system group means the page opens at Level 1. A relation is `from` to `to` with its `label`, `tech` and `async: true` for a dashed arrow. `core` marks a centre, `side` (N, S, E, W) a hint. Sizes and arrow routes are not saved.
