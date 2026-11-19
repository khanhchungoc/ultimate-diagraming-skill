<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->

## Playground artifact (keep it current)

The playground is one claude.ai artifact holding a blank page of every diagram type with a type switcher (design: `dev/plans/plan-playground.md`). Users open it from the README, so it must always run the current code.

**Whenever a change touches what a page runs or looks like** (anything under `assets/`, `scripts/layout_engine.py`, `scripts/tokens.py`, `scripts/disk_format.py`, or `SUPPORTED_TYPES`), finish the task by republishing it:

1. Rebuild: `python scripts/layout_engine.py --playground -o <scratchpad>/playground` (until that flag exists, skip: nothing is published yet).
2. Read the live artifact first (`Artifact` action `read` on the URL below), then publish the rebuilt folder to the **same URL** (`Artifact` publish with `url`, `root` = the folder, `files` mapping every path). Never publish without `url`: that makes a second artifact and the README link goes stale.
3. Open it and check every type in the switcher loads, then say in your report that it was republished. If you cannot publish (no `Artifact` tool, not the owner), say so in your report instead of skipping silently.

A new diagram type joins the playground in the same change (switcher entry, `blank.json`, folder). Changes only under `dev/`, `docs/`, `references/` or `README.md` need no republish.

Playground URL: _not published yet_. Whoever publishes it first replaces this line with the link and adds it to `README.md`.
