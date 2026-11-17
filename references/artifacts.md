# Published claude.ai Artifacts: create, read, update, delete

Applies only when your tools include `Artifact`. `--target artifact` builds a folder of split files (`index.html`, `diagram.json`, `app.css`, `app.js`) in scratch so diagram data stays separate from editor code. Never use WebFetch or curl on an artifact link, and never open `app.css`, `app.js`, or a legacy single-file `.html` page whole with a file-read tool.

## Create

1. Build with `--target artifact` into a scratch directory:
   ```shell
   python "<skill-dir>/scripts/layout_engine.py" --layout <scratch.json> --target artifact -o <scratch>/<title-slug> --screenshot <scratch.png>
   ```
   Never write this directory into the workspace.
2. After a clean run, publish with `Artifact`:
   - `file_path`: `<scratch>/<title-slug>/index.html`
   - `files`: `{"diagram.json": "<scratch>/<title-slug>/diagram.json", "app.css": "<scratch>/<title-slug>/app.css", "app.js": "<scratch>/<title-slug>/app.js"}`
   - `icon`: `"chart"`
   - `capabilities`: `{artifact: {}, downloads: true}`
   - `description`: one sentence describing the diagram
3. Keep `<scratch>/<title-slug>/` until the conversation ends (updates in this conversation reuse its `index.html`). Delete the scratch authoring JSON and PNG.
4. Tell the user the link and that it is private until they share it from claude.ai.

## Read

1. For split artifacts, call `Artifact` with `action: "read"`, `url`, and `path: "diagram.json"` (just a few KB; never read `app.css` or `app.js`). Answer from that JSON directly, or run `python "<skill-dir>/scripts/layout_engine.py" --extract <diagram.json>` for canonical authoring JSON; see [reading.md](reading.md).
2. Or call `Artifact` with `action: "read"` and `url` **without** `path`, then run `python "<skill-dir>/scripts/layout_engine.py" --extract <that file>` (required for legacy single-file artifacts; never open a single-file `.html` whole).
3. If the artifact belongs to someone else, the read returns only a summary and no file: say so, answer from the summary, and offer a new artifact.

## Update in place (same artifact URL)

1. Call `Artifact` with `action: "read"` on `url` **without** `path`. This reads the tiny `index.html` and satisfies the overwrite gate. Reading single files by `path` or listing files (`Artifact` with `action: "list"` and `scope: "files"`) does **not** satisfy the overwrite gate.
2. Call `Artifact` with `action: "read"` on `url` with `path: "diagram.json"` right before editing so you have the user's latest saved JSON and `layout` map.
   The read of step 1 returns the page inline and saves no file. Write that page text to `<scratch>/<title-slug>/index.html` and keep your edited `diagram.json` in the same folder: `--layout` reads a stored theme (`<script id="diagram-theme">`) from the `index.html` next to `diagram.json`, and without it the rebuilt page silently loses the theme.
3. **Text, label, color, or attribute edits (no positions changed):** edit `diagram.json` directly while keeping its `layout` map intact (do not run `--layout`). Publish to the same `url` (no `capabilities`) with `file_path: <scratch>/<title-slug>/index.html` (or the `index.html` saved in step 1) and `files: {"diagram.json": "<edited diagram.json>"}` — never reading or uploading `app.css` or `app.js`.
4. **Structural edits (adding or removing nodes, tables, actors, or edges):** edit `diagram.json`, run:
   ```shell
   python "<skill-dir>/scripts/layout_engine.py" --layout <diagram.json> --target artifact -o <scratch>/<title-slug> --screenshot <scratch.png>
   ```
   Then publish to the same `url` (no `capabilities`) with `file_path: <scratch>/<title-slug>/index.html` and `files: {"diagram.json": "<scratch>/<title-slug>/diagram.json"}` (never reading or uploading `app.css` or `app.js`). A re-layout resets positions the user dragged by hand; tell them.

## Upgrade with a newer engine or UI (data and positions unchanged)

When only the tool changed and you want to update the same artifact `url`:

1. Call `Artifact` with `action: "read"` on `url` **without** `path` (satisfies the overwrite gate) and `Artifact` with `action: "read"` on `url` with `path: "diagram.json"`. Write the page text from the first read to `index.html` in the same folder as `diagram.json`: that is where `--layout` finds a stored theme (`<script id="diagram-theme">`); without it the rebuilt page loses the theme.
2. Run:
   ```shell
   python "<skill-dir>/scripts/layout_engine.py" --layout <diagram.json> --keep-layout --target artifact -o <scratch>/<title-slug>
   ```
   Every item keeps its saved positions for every diagram type (including flowcharts), and only the lines, labels, and editor code are rebuilt.
3. Publish to the same `url` (no `capabilities`) with `file_path: <scratch>/<title-slug>/index.html` and `files: {"app.js": "<scratch>/<title-slug>/app.js", "app.css": "<scratch>/<title-slug>/app.css"}`, omitting `diagram.json` so user edits and positions cannot change.

## Legacy single-file artifacts

Old single-file artifacts keep all CSS, JS, and `<script id="diagram-data">` in one ~350 KB HTML page with no separate `diagram.json`. The `Artifact` overwrite gate requires reading every line of that saved file (~150k tokens, which usually overflows context) unless this conversation created it with no in-browser Save since.

Do not read a whole single-file page by default. Instead:

- **Upgrade to split files:** run `python "<skill-dir>/scripts/layout_engine.py" --layout <saved page.html> --keep-layout --target artifact -o <scratch>/<title-slug>` and publish as a **new** artifact (no `url`, following *Create*). Data and saved positions carry over.
- **Edit content:** run `--extract <saved page.html> -o <scratch.json>`, edit the JSON, build with `--target artifact -o <scratch>/<title-slug>`, and publish as a **new** artifact (no `url`). Explain why the old link could not be updated in place, share the new link, note that the old link still shows the old version, and offer to delete the old artifact.

## Delete

`Artifact` with `action: "delete"` and the `url`, only when the user asks for that artifact to be removed. It cannot be undone and stops the link working for everyone, so confirm first.
