# Reading the JSON

Used when explaining an existing diagram (output of `--extract`, keyed by `diagramType`; missing means `flowchart`).

## Flowchart

`nodes` are sorted along the flow, so follow `edges` for the path; `"feedback": true` is a loop back; each note's `nodes` lists the steps it is attached to.

## Sequence

`messages` are in time order (a step number is a message's position there); a fragment covers messages `from`..`to` inclusive, an `alt`/`par` fragment's `branches[].at` (or `elseAt`, one unlabelled else) is where each further branch starts, and a note sits `over` a participant `after`/`before` a message.

## ERD

`entities` hold `columns` (`pk`, `fk`, `unique`, `nullable`); each `relationships` entry runs from the child (the table holding the foreign key) to the parent, its two ends (`fromEnd`, `toEnd`: `one`, `zeroOrOne`, `oneOrMany`, `zeroOrMany`) say how many rows sit on each side, and a table's `color` (named in `colorKey`) marks the domain it belongs to.

## Use case

`actors` are roles outside the system and `useCases` are goals inside a `subjects` boundary; each `links` entry is an `association` (actor and use case), an `include` (from the base to the use case it always needs) or an `extend` (from the optional extension to its base, with a `condition`); `parent` is a generalization (child to parent); `refs` are the requirement ids a use case implements, and a `colorKey` names the feature area of each colour.
