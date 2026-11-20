# Embed a diagram in another HTML page or Artifact

Applies when the HTML you are writing (report, dashboard, Artifact) must show a diagram. The embed opens in present mode: read-only, zoom controls and a Present button only; pan, zoom, hover and click work. Embedding needs no user question: skip *Output choice* in SKILL.md.

## 1. Pick the form

| Host | Form | Save from the embed |
|---|---|---|
| claude.ai Artifact (new or existing) | **Folder**: diagram files in `<slug>/` inside the host | Yes: publishes `<slug>/diagram.json` to the host |
| Plain `.html` file, diagram kept apart | **Sibling**: `flow.html` next to it | No: Save downloads a file |
| Plain `.html` file, one file only | **Inline**: whole diagram in `srcdoc` | No: Save downloads a file |

Use Folder whenever you publish an Artifact. Every form needs `name="present"` on the `<iframe>`; without it the embed opens in edit mode. Pick a distinct `<slug>` per diagram.

## 2. Build

Follow *Procedure: New Diagram* in SKILL.md, with one change to the command's target:
- Folder: add `--target artifact` and `-o <scratch>/<slug>` (the folder, not an `.html`).
- Sibling or Inline: as written, `-o <target>.html`.

Do not open `app.css`, `app.js` or the diagram `.html` whole.

## 3. Write the iframe

```html
<iframe name="present" src="<slug>/index.html" style="width:100%;height:520px;border:0"></iframe>
```
- Sibling: `src="flow.html"`.
- Inline: replace `src` with `srcdoc="..."` holding the whole diagram `.html`, `&` as `&amp;` and `"` as `&quot;`. Generate it with a script, never by hand (the page is about 350 KB).
- The diagram fits itself to the frame on load; set the height in CSS.

## 4. Publish (Folder form)

New host: `Artifact` publish with
- `file_path`: your host `.html`
- `files`: `{"<slug>/index.html": "<scratch>/<slug>/index.html", "<slug>/diagram.json": "<scratch>/<slug>/diagram.json", "<slug>/app.css": "<scratch>/<slug>/app.css", "<slug>/app.js": "<scratch>/<slug>/app.js"}`
- `capabilities`: `{artifact: {}, downloads: true}`. Without `artifact` the embed cannot Save to the host.

Existing host (add a diagram): `Artifact` read of its `url` first, then publish to that `url` with your edited host page and the same `files`, `capabilities` only if the host lacks them.

Tell the user: the link; the diagram opens in present mode; to edit, press Present (top right), edit, then Save, which updates the artifact in place.

## 5. Update a diagram already embedded

Edit the diagram only; never republish the host page or `app.*`. This is *Update in place* in [artifacts.md](artifacts.md) with the host's `url` and `<slug>/` in every path:
1. `Artifact` read of the host `url` without `path` (satisfies the overwrite gate).
2. `Artifact` read with `path: "<slug>/diagram.json"`, and with `path: "<slug>/index.html"` (small); save both in `<scratch>/<slug>/`, so the rebuilt page keeps its theme (artifacts.md step 2).
3. `--extract <scratch>/<slug>/diagram.json -o <scratch>/edit.mmd`, edit the Mermaid.
4. `--layout <scratch>/edit.mmd --keep-from <scratch>/<slug>/diagram.json --target artifact -o <scratch>/<slug>`
5. Publish to the host `url` (no `capabilities`) with `file_path`: the host page text from step 1, saved to a file, and `files: {"<slug>/diagram.json": "<scratch>/<slug>/diagram.json"}`.

Sibling and Inline forms: *Update an Existing Diagram* in SKILL.md, then replace the file or the `srcdoc`.

## Report

The host link, and if Save from the embed fails (`Saving is not available here`), tell the user to use Export > HTML file.
