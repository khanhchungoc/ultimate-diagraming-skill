# Diagrams as claude.ai Artifacts

In Claude Code the diagram can be published as a private claude.ai Artifact instead of an HTML file. Claude asks once which you want (a saved default skips the question).

Inside the artifact you edit as usual and press **Save**: that publishes a new version of the same artifact, so the next change you ask Claude for starts from your saved edits. Share the link from claude.ai; people without edit access see the diagram and can **Download .html** instead of saving.

To make the link public, use the artifact's Share menu. claude.ai reviews the page first, and `python dev/check_artifact_shape.py` catches known causes of a rejection (for example `data:` inside a tooltip) before you publish.

## Set the default

When installing, or any time later:

```shell
npx khanhchungoc/ultimate-diagraming-skill --runtime claude --claude-output artifact   # or: file, ask
```

It is stored in `~/.claude/ultimate-diagram.json` (or `<project>/.claude/ultimate-diagram.json` with `--project`). Other assistants always write the HTML file.

Details: [plan](../dev/plans/archive/plan-artifact-output.md).
