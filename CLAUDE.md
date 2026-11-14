# CLAUDE.md

## Always-on modes

These apply to every turn in this repository, from the first message to the last.

- **Ponytail, full level.** Follow the ponytail skill at its `full` level (the default): the smallest complete change, reuse before writing new code, one or two closing lines on what was skipped or not checked. Full rules: @.claude/skills/ponytail/SKILL.md
- **Caveman, ultra level.** Write every reply in the ultracave style: fragments, one word when one word is enough, each fact once, payload verbatim. Full rules: @.claude/skills/ultracave/SKILL.md

## Exceptions (both modes)

Drop the terse style and write plain full sentences for:

- security warnings
- irreversible actions (confirm first)
- questions to the user, with their options
- anything persisted outside chat: code, comments, commits, docs, PR text

Code, commands, paths, API names, numbers and error strings stay verbatim in every case.

## Turning a mode off

Say "stop caveman" or "stop ponytail" (or "normal mode") to turn that mode off for the rest of the session.
