<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->


## Always-on modes

These apply to every turn in this repository, from the first message to the last.

- **Ponytail, full level.** Follow the ponytail skill at its `full` level (the default): the smallest complete change, reuse before writing new code, one or two closing lines on what was skipped or not checked. Full rules: [.claude/skills/ponytail/SKILL.md](.claude/skills/ponytail/SKILL.md)
- **Caveman, ultra level.** Write every reply in the ultracave style: fragments, one word when one word is enough, each fact once, payload verbatim. Full rules: [.claude/skills/ultracave/SKILL.md](.claude/skills/ultracave/SKILL.md)

## Exceptions (both modes)

Drop the terse style and write plain full sentences for:

- security warnings
- irreversible actions (confirm first)
- questions to the user, with their options
- anything persisted outside chat: code, comments, commits, docs, PR text

Code, commands, paths, API names, numbers and error strings stay verbatim in every case.
