# Diagrams as claude.ai Artifacts

In Claude Code the diagram can be published as a private claude.ai Artifact instead of an HTML file. Claude asks once which you want (a saved default skips the question).

Inside the artifact you edit as usual and press **Save**: that saves your diagram data in place on the same artifact without reloading the page, so your undo history and selection stay intact and the next change you ask Claude for updates the same link from your saved edits. Share the link from claude.ai; people without edit access see the diagram and can use **Export > HTML file (editable)** instead of saving.

To make the link public, use the artifact's Share menu. claude.ai reviews the page first, and `python dev/check_artifact_shape.py` catches known causes of a rejection (for example `data:` inside a tooltip) before you publish.

## Set the default

When installing, or any time later:

```shell
npx khanhchungoc/ultimate-diagraming-skill --runtime claude --claude-output artifact   # or: file, ask
```

It is stored in `~/.claude/ultimate-diagram.json` (or `<project>/.claude/ultimate-diagram.json` with `--project`). Other assistants always write the HTML file.

Details: [artifact output plan](../dev/plans/archive/plan-artifact-output.md) and [split-files plan](../dev/plans/plan-artifact-split-files.md).
