# Published claude.ai Artifacts: create, read, update, delete

Applies only when your tools include `Artifact`. A diagram artifact is the same page as the local HTML file, built with `--target artifact`. Never use WebFetch or curl on an artifact link, and never open the saved page whole with a file-read tool: almost all of it is editor code.

## Create

1. Build with `--target artifact` into scratch: `python "<skill-dir>/scripts/layout_engine.py" --layout <scratch.json> --target artifact -o <scratch>/<title-slug>.html`. Never write it into the workspace.
2. After a clean run, publish with `Artifact`: `file_path` = that HTML, `icon: "chart"`, `capabilities: {artifact: {}, downloads: true}`, and a one-sentence `description`.
3. Keep the scratch HTML until the conversation ends (an update in this conversation republishes from it). Delete the scratch JSON and PNG.
4. Tell the user the link and that it is private until they share it from claude.ai.

## Read

1. `Artifact` with `action: "read"` and the `url`. It saves the page to a local file and names it.
2. `python "<skill-dir>/scripts/layout_engine.py" --extract <that file>` prints the diagram JSON. Answer from that; see [reading.md](reading.md).
3. If the artifact belongs to someone else, the read returns only a summary and no file: say so, answer from the summary, and offer a new artifact.

## Rebuild with a newer engine and UI (data and positions unchanged)

When only the tool changed, not the diagram: `python "<skill-dir>/scripts/layout_engine.py" --layout <saved page.html> --keep-layout --target artifact -o <scratch>/<title-slug>.html`. Every item keeps the position saved in the page, and the data is carried over as it is; only lines, labels and the editor code are new. Without `--keep-layout`, `--layout` lays everything out again and the user's hand placement is lost. Then publish as in *Update*.

## Update

1. `Artifact read` first: it returns the user's latest in-browser Save.
2. `--extract <saved file> -o <scratch.json>`, edit the JSON, then `--layout <scratch.json> --target artifact -o <scratch>/<title-slug>.html`. A re-layout resets positions the user dragged; tell them.
3. Publish with `url` = the artifact's URL and no `capabilities`.

**Known limit: the overwrite gate.** The `Artifact` tool refuses to publish over a live artifact unless this conversation has published or fully read that version. The gate looks at where the version came from, not at what changed, so even a one-line data edit is refused when:

- the artifact was created in an earlier conversation, or
- the user pressed Save in the page since this conversation last published it.

The refusal names the saved file and asks for every line of it to be read (about 150k tokens for a 350 KB page). Do not do that by default: it usually overflows the context. Instead:

1. Say plainly that the update was refused and why.
2. Publish the rebuilt file as a **new** artifact (no `url`), give the new link, and say the old link still shows the old version.
3. Offer to delete the old artifact (see Delete).

An update made in the same conversation that created the artifact, with no Save in the page in between, is not refused.

## Delete

`Artifact` with `action: "delete"` and the `url`, only when the user asks for that artifact to be removed. It cannot be undone and stops the link working for everyone, so confirm first.
