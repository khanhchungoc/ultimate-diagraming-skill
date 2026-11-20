# Plan: Playground artifact (one claude.ai artifact, all diagram types, blank)

Status: proposed (2026-11-19).

## What the user gets

One claude.ai artifact link. It opens on a blank flowchart. A type menu in the header switches to a blank sequence, ER or use case diagram on the same link. Draw by hand or Paste Mermaid. When done: **Save** downloads the diagram as a standalone HTML file, **Export › Copy** copies it as Mermaid, SVG or PNG (what the type supports today). No conversion between types: switching starts that type blank.

## Design: four existing pages in one artifact

The artifact target already builds each type as split files (`index.html`, `diagram.json`, `app.css`, `app.js`), and an artifact can publish several HTML pages through `files`. So the playground is four ordinary type pages in sub-folders plus a root that opens the first one:

```
index.html                 root: the flowchart page (or a redirect to flowchart/)
flowchart/index.html  diagram.json  app.css  app.js
sequence/index.html   diagram.json  app.css  app.js
erd/index.html        diagram.json  app.css  app.js
usecase/index.html    diagram.json  app.css  app.js
```

- Each folder is exactly what `assemble_artifact(kind, blank)` builds today, so no editor code changes and only the live type's code loads (no 1.5 MB bundle, no name clashes between types).
- Pages fetch `diagram.json`, `app.css`, `app.js` by relative path, so each folder is self-contained.
- Sub-pages are served without the artifact skeleton, so they carry their own `<!doctype html>`, charset and viewport (the file-shape head `artifactToFileHtml` already produces).

## Changes

1. **Blank data.** `assets/types/<type>/blank.json`: flowchart one lane, no steps; sequence two participants, no messages; ERD no tables; use case one subject. Make each engine, renderer, Fit and Tidy cope with zero items (empty bounds). One `blank` fixture per type.
2. **Type menu** (shell, playground pages only): the header type icon becomes a menu of the four types, current one checked. Choosing one navigates to `../<type>/index.html`. With unsaved edits it asks first (`ui.confirm`: "Switch to ER diagram? Your edits to this flowchart are lost unless you save." Save / Switch / Cancel). Enabled by a `"playground": true` flag the builder writes into the page, so normal diagrams are unchanged.
3. **Save = download** on playground pages: Save (and Ctrl+S) runs the existing `buildExportHtmlFile()` (standalone `--target file` HTML from `app.css` + `app.js` + the live data) and downloads `<title-slug>.html`. No republish, so the shared blank template is never overwritten. The downloaded file is a normal single-type diagram: it opens offline, and `--extract` / `--keep-from` work on it.
4. **Copy as**: the existing Export › Copy menu (Mermaid, SVG text, PNG) works as is for the current type. Nothing to build; check it from a sub-folder page.
5. **Builder** (a maintainer tool, not part of the skill): `python dev/build_playground.py -o <scratch-dir>` writes the folder above: four `assemble_artifact` runs on `blank.json`, each with a `<script id="playground">` flag added to its `index.html`, plus a root `index.html` that goes to the flowchart. Publish with the Artifact tool, `files` mapping each path. The shipped code only knows the flag, never the builder.
6. **README.** A "Playground" link to one published copy anyone can open. `SKILL.md` does not mention the playground.

7. **Keep it current.** `AGENTS.md` tells every agent to rebuild and republish the playground to the same URL after any change to page code (`assets/`, the page-building scripts). The first publish records the URL in `AGENTS.md` and `README.md`.

## First check (before building)

Spike with two dummy pages in one artifact: confirm that (a) a link from one page to `../erd/index.html` navigates inside the artifact, (b) relative `fetch('diagram.json')` resolves against the sub-folder, (c) a download (`a[download]` with a Blob) works from the artifact frame. If (a) fails, fall back to a single root page with `?type=erd` that boot reads to pick which folder's `app.js`/`app.css`/HTML template to load.

## Tests

- `e2e_playground.mjs`: open each type, add one item from the dock, switch type (confirm shows), switch back (blank again), Save downloads a file that opens and `--extract`s, Copy Mermaid gives that type's header line.
- `check_golden.py` and `check_themes.py` on the four `blank` fixtures; axe in light and dark.

## Not doing

Converting between types, keeping a draft per type, several diagrams in one file, saving back into the artifact, a live Mermaid side panel. Each can come later without changing this layout.

## Update: starter flows

Each type now opens on a small starter flow instead of an empty page (`dev/playground/<type>.json`, read by `build_playground.py`): flowchart Start → step → End (Start and End are always there), sequence two participants and a request/response, ER two linked tables, use case one actor linked to one use case. `blank.json` stays the empty template for the skill itself.
