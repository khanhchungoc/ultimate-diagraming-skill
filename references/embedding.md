# Embedding a diagram in another HTML page or Artifact

Use when the HTML you are writing (a report, dashboard or claude.ai Artifact) should show a diagram. The embed opens in present mode: read-only, with only the zoom controls and a Present button; pan, zoom, hover and click still work. Set `name="present"` on the `<iframe>`. Without it the embed opens in edit mode.

1. Build the diagram as usual (see SKILL.md), as a file or with `--target artifact`.
2. Put the iframe in your page. Size it with CSS; the diagram fits itself to the frame.

**Inside an Artifact** (host page and diagram published together): build the diagram with `--target artifact -o <scratch>/<slug>`, then publish the host page with the four diagram files under a folder:
- `files`: `{"<slug>/index.html": "<scratch>/<slug>/index.html", "<slug>/diagram.json": ..., "<slug>/app.css": ..., "<slug>/app.js": ...}`
- in the host page: `<iframe name="present" src="<slug>/index.html" style="width:100%;height:520px;border:0"></iframe>`

**Inside a plain HTML file**, either keep the diagram as a sibling file:
`<iframe name="present" src="flow.html" style="width:100%;height:520px;border:0"></iframe>`
or inline it: put the whole diagram `.html` in `srcdoc`, with `&` written `&amp;` and `"` written `&quot;` (do it with a script, never by hand; the page is about 350 KB).

A diagram served from a URL also opens in present mode with `?present` added to it.

Present mode has no Save and no editing. To change the diagram, follow *Update* in SKILL.md and re-embed.

## Save and update

- **User Save:** exit present mode with the Present button, edit, press Save. An embed from a folder of a host Artifact (the `src="<slug>/index.html"` form) publishes `<slug>/diagram.json` to the host Artifact, in place; the host page and its title stay as they are. The other forms (`srcdoc`, a sibling file) have no host to save to: Save offers Export > HTML file.
- **Agent update:** follow *Update in place* in [artifacts.md](artifacts.md) with the host's URL, with the folder in every path: read the host without `path` (satisfies the overwrite gate), read `<slug>/diagram.json`, `--extract` it, edit, `--layout ... --keep-from <diagram.json> --target artifact -o <scratch>/<slug>`, then publish with only `files: {"<slug>/diagram.json": ...}`. No republish of the host page is needed.
