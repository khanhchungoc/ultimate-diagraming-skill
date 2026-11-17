# Plan: claude.ai Artifacts as split files (data apart from code)

Status: implemented on branch `feat/artifact-split-files` (generator, shell, ERD worker loader, tests, docs). Remaining: test an invited editor, a signed-out view in a real browser, and in-page title sync against the live platform.

## Problem

An artifact built with `--target artifact` is one 350 KB HTML page. Almost all of it is editor code (CSS, JS, icons); the diagram is about 130 lines. Two things follow:

1. **The overwrite gate.** The `Artifact` tool refuses to publish over a live artifact until the conversation has published it or read every line of its saved source (about 150k tokens). The gate looks at where the live version came from, not at what changed, so even a one-line data edit is refused when the artifact was made in an earlier conversation or the user pressed Save in the page since. See [references/artifacts.md](../../references/artifacts.md) for the fallback used today (publish a new artifact, new link).
2. **Upgrades.** A newer engine or UI can only reach an old artifact by republishing the whole page, which hits the same gate, and which must not touch what the user edited.

## Goals

Scope: applies **only** when the skill generates claude.ai Artifacts (`--target artifact`) that are editable in the browser, directly savable in place via the `artifact` capability's files form, and updatable by Claude Code on the same artifact URL without creating a new artifact.

- A data-only change (an agent edit, or the user's Save) never needs the editor code to be read or republished.
- An engine or UI upgrade rebuilds an existing artifact **without changing the user's data or positions**.
- Old single-file artifacts keep working, and can be rebuilt.
- The local HTML file target (`--target file`) and all diagram layout engines (`assets/types/<type>/engine.js`, `<type>.js`) stay completely decoupled and untouched: plugins and engines never know artifacts exist.

## Non-goals

- Keeping hand-dragged positions when an agent adds nodes by editing JSON: a separate engine feature for both targets, not part of artifact splitting.
- Changing diagram types, schemas, or layout engines.

## What the platform gives us (read from the runtime contract 0.2.96 and the Artifact tool)

- A multi-file artifact: the page plus `files` (stylesheets, scripts, data, images), referenced by relative URL. An update sends only the files that changed; the rest are kept.
- The `artifact` capability's **files form**: `artifact.publish({"diagram.json": text})` saves only the named files. The saving view keeps running (no reload); only other open views reload. It is rejected with `capability_disabled` where the form is not enabled. Per-file `ifMatch` (sha256) is documented to let two writers save different files without overwriting each other; verify during implementation whether runtime contract 0.2.96 exposes/accepts `ifMatch` on `artifact.publish` (otherwise pass `{"diagram.json": text}` as verified in Spike check 5).
- The overwrite gate does **not** accept single-file `path` reads or file listings (`scope: "files"`). The conversation must read the live version via `Artifact read` on `url` **without** `path` (which returns the tiny `index.html`), and every `Artifact` publish requires `file_path` (`index.html`) plus `files`.
- `Artifact read` with `path` fetches one published file (and reports its `sha256`); `Artifact list` with `scope: "files"` lists all published files.

## Spike

Test artifact: https://claude.ai/artifact/Lazsj9QMXRi4tcU2zHJpNP (private, throwaway; delete it when the plan is done). Files: `index.html`, `app.js`, `app.css`, `diagram.json`.

Checked from the tool side (done):

| Check | Result |
|---|---|
| Publish a page plus `files` | Works. |
| `Artifact list` scope `files` | Lists all four files with types and sizes. |
| `Artifact read` with `path: "diagram.json"` | Returns just that file (35 bytes) and its sha256. |
| Data-only update | `files` alone is refused: the tool always wants the page's `file_path`. Passing `index.html` with `files: {diagram.json}` works and made version 2. With the split, `index.html` is about 150 lines, so having it in the call is cheap. |
| Overwrite gate | Tested with a fresh subagent (it did not create the artifact). It listed the files and read `diagram.json` and `index.html` **by path**, then published `index.html` plus `files: {diagram.json}`: **refused**, "You hadn't viewed the live version". Reading single files by path does not count as viewing the live version (the read said so: read the url *without* `path`). The refusal returned the live page (the 806-byte `index.html`) and said that version "now counts as viewed". In the split layout the page is tiny, so the gate costs one small read of the url. **Confirmed in a fresh session** (the subagent's retry was blocked by the permission classifier, so a new session was started): it read the url without `path` (the page came back inline, tiny), read `diagram.json` by path, then published `index.html` plus `files: {diagram.json}` and it **succeeded** (version `1794891807-a774`), without reading or touching `app.js` or `app.css`; the read-back showed the new data. The result also warned that the previous version had been saved from the page 2 minutes earlier and that `diagram.json` was replaced: with a data-only edit made on a fresh read this is harmless, but it is the reason to read right before publishing. Procedure for agents: read the url without `path`, read `diagram.json` by path, edit, publish `index.html` plus the changed file. |

Checked in the browser (done, by the owner, signed in, artifact private at the time):

1. `app.js` runs from a relative `<script src>`.
2. `app.css` applies (the probe line is green).
3. `fetch('diagram.json')` returns 200 and the data. After the agent's data-only publish the page should show `"saves": 1`.
4. `claude.use('artifact')` resolves.
5. The Save button's files-form save succeeds, the page keeps running, and the result is not `capability_disabled`.

Results: all five passed. `app.js` ran from a relative `<script src>`; `app.css` applied; `fetch('diagram.json')` returned 200 with the agent's data-only edit (`"saves":1`); the `artifact` capability resolved; the files-form save succeeded twice (about 600 ms each) and the page kept running (the next lines printed, no reload). The server's copy of `diagram.json` afterwards read `"saves":4`, so the saves reached the artifact. The same save was repeated after the link was made public and also succeeded (see Open questions).

Decision rule: if 1 to 4 pass, go ahead. If 5 fails for the owner, fall back to inline data plus the new-artifact workflow (no change to the product beyond the docs already written). If `fetch` fails but the script and stylesheet load, the page can carry the data inline in `index.html` and still get the split for the code.

## Design

Artifact target output (`--target artifact`), instead of one page:

| File | Holds | Changes when |
|---|---|---|
| `index.html` | `ARTIFACT_HEAD`, `<title>`, agent note pointing to `diagram.json`, optional `<script id="diagram-theme">`, font links, `<link rel="stylesheet" href="app.css">`, body mount/chrome markup, `<script src="app.js"></script>`, `ARTIFACT_END_MARKER`, `ARTIFACT_TAIL` | rarely |
| `diagram.json` | the diagram data, in the disk format (`_readme`, `schemaVersion`, `layout` map) | the user saves, or an agent edits the data |
| `app.css`, `app.js` | tokens, components, shell, type plugin, engine, icons | an engine or UI release |
| fonts | Google Fonts stylesheet links in `index.html` (as today) | rarely |

- **Output paths (`-o`) and generator (`scripts/layout_engine.py`, `scripts/run_engine.mjs`):** `layout_engine.py --layout <in.json> --target artifact -o <dir-or-index.html>` writes `index.html`, `diagram.json`, `app.css`, and `app.js` into the target directory (`out_path.parent` when `-o` ends with `.html`, else `out_path` as a directory). Replace `artifact_template` directly with the split `index.html` builder (keep `ARTIFACT_HEAD` and `ARTIFACT_TAIL`). Check `find_external_refs()` across `index.html`, `app.css`, and `app.js`. Fix `--keep-layout` in `run_engine.mjs` and `layout_engine.py` so engines without `routeDiagram` (such as flowchart, which routes in the renderer) keep saved `x`/`y` unchanged instead of running `layoutDiagram` or `choose_flowchart_direction`.
- **Boot (`assets/shell/shell.js`):**
  - Detect `artifactShaped` from `document.querySelector('body > title') !== null` instead of `capturePristineBody()` (which strips `<script src="app.js">` and returns `null`). Still capture the unrendered body markup before `plugin.render()` for `Export > HTML file (editable)`.
  - `loadInitialData()` supports both targets: if `#diagram-data` is in the DOM (`--target file` or an exported `.html` file), parse it synchronously; otherwise `await fetch('diagram.json')`. Everything the shell already does with `_readme` and `plugin.fromDisk()` is unchanged. Set both `chartTitleEl.textContent` and `document.title` from `chartData.title || plugin.defaultTitle`.
  - Expose a shell helper `loadEngineSource()` that slices `//@engine-begin..//@engine-end` from `document.currentScript.textContent` or fetches `document.currentScript.src` when external, so `assets/types/erd/erd.js`'s background layout Web Worker works in both inline and split builds without any artifact-specific code in `erd.js`.
- **Title on Save:** the artifact's own title (listing, tab) is the `<title>` of `index.html`. When the diagram was renamed, the in-page Save also publishes `index.html` with the new title (fetched from the loaded copy, only `<title>` replaced), and falls back to saving `diagram.json` alone if the platform rejects that. Not yet checked against the live platform (the e2e stub covers the payload only).
- **`ifMatch` (decided: not used).** The runtime types do accept a per-file `ifMatch`, but it needs a sha256 the host reported, and the host only reports one (`shas`) on a call that already sent an `ifMatch`; the page cannot get a first value without guessing a hash of the served bytes, and a wrong guess would turn every Save into a `conflict` and a reload. Without it a files publish keeps the whole-version check: a save over someone else's newer version is a `conflict` (nothing published, the view reloads), never a silent overwrite. Revisit if the platform starts reporting shas on plain publishes.
- **Save in the page (`assets/shell/shell.js`):** `artifactApi.publish({"diagram.json": updatedJson})` replaces the whole-document rebuild. Pass `ifMatch` only if runtime contract 0.2.96 exposes/accepts it on `artifact.publish`. Do not set `reloadExpected` on a files-form save (the saving view keeps running; selection and undo history survive in memory).
- **Export > HTML file (editable) (`assets/shell/shell.js`):** fetch `app.css` and `app.js` and inline them together with the captured pristine body markup, `<script id="diagram-data">`, and optional `#diagram-theme` into `shell.html`'s `<head>`/`<body>` layout, then run `stampReadingGuide()` so the downloaded `.html` is a self-contained `--target file` page. The menu item already exists in the Export menu.
- **View-only viewers (decided):** a viewer who cannot save (signed out, or no edit access) sees no Save button, which is expected. Do **not** add a separate "Download .html" button next to it: the normal **Export** button stays, and its menu keeps "HTML file (editable)". This also removes the extra `btn-download-html` button that `applyArtifactUi` adds today, the toasts that say "Use Download .html" (say "Use Export > HTML file"), and the two `e2e_shell.mjs` checks that look for that button. Done: the button, the toasts and the two e2e checks are gone; Export > HTML file is the way out.
- **Agent update (data only, same artifact URL):**
  1. `Artifact read` on `url` **without** `path` (returns the tiny `index.html` and satisfies the overwrite gate).
  2. `Artifact read` on `url` with `path: "diagram.json"` (reads the latest user-saved data).
  3. For label, text, color, or attribute edits: edit `diagram.json` in place (keeping its `layout` map) and publish to the same `url` with `file_path: <scratch-dir>/index.html` and `files: {"diagram.json": ...}`.
  4. For structural edits (added or removed nodes, tables, actors, edges): edit `diagram.json`, run `layout_engine.py --layout <diagram.json> --target artifact -o <scratch-dir> --screenshot <scratch.png>` (computes positions and runs the audit), and publish to the same `url` with `file_path: <scratch-dir>/index.html` and `files: {"diagram.json": ...}` (never reading or re-uploading `app.css` or `app.js`).
- **Agent upgrade (engine or UI, same artifact URL):**
  1. `Artifact read` on `url` **without** `path` (satisfies the gate and carries any `#diagram-theme`) and `Artifact read` with `path: "diagram.json"` (for `diagramType`, `title`, and saved positions).
  2. Run `layout_engine.py --layout <diagram.json> --keep-layout --target artifact -o <scratch-dir>` (keeping saved `x`/`y` for every diagram type, including flowcharts).
  3. Publish to the same `url` with `file_path: <scratch-dir>/index.html` and `files: {"app.js": ..., "app.css": ...}` (omitting `diagram.json` so user data and positions cannot change).
- **Local headless Chrome (`scripts/render_screenshot.py`, `dev/cdp.mjs`):** serve split artifact directories over a local loopback HTTP server when opening in headless Chrome, because Chromium `fetch()` rejects `file://` URLs.
- **Old single-file artifacts:** unchanged behaviour. To move one to the split layout, rebuild with `layout_engine.py --layout <saved page.html> --keep-layout --target artifact -o <scratch-dir>` and publish as a new artifact (data and positions carry over), or overwrite after a full read if a person insists on the same URL.
- **Backward compatibility of the data:** every release must read all earlier `schemaVersion` values and migrate on load in memory; it never rewrites what is stored until the user saves. `disk_format.py` already does this (for example ERD v1 and v2 layouts).

## Work

1. Run the spike's browser checks; record the results in this file (done). Delete the throwaway test artifact when implementation finishes.
2. `scripts/layout_engine.py` and `scripts/run_engine.mjs`: add the split `--target artifact -o <dir-or-index.html>` builder that writes `index.html`, `diagram.json`, `app.css`, and `app.js` (leaving `--target file` untouched); replace `artifact_template` with the split `index.html` builder (keeping `ARTIFACT_HEAD` and `ARTIFACT_TAIL`); run `find_external_refs()` across `index.html`, `app.css`, and `app.js`; fix `--keep-layout` so flowcharts also preserve saved `x`/`y` without calling `choose_flowchart_direction` or `layoutDiagram`.
3. `assets/shell/shell.js` (and `assets/types/erd/erd.js` calling the shell helper): detect `artifactShaped` via `document.querySelector('body > title') !== null` while capturing unrendered body markup for Export; dual-mode `loadInitialData()` (`#diagram-data` if present, else `fetch('diagram.json')`) setting both `chartTitleEl.textContent` and `document.title`; expose `loadEngineSource()` for `erd.js`'s Web Worker; files-form save (`publish({"diagram.json": updatedJson})` with `ifMatch` if supported by runtime contract 0.2.96) without setting `reloadExpected`; `capability_disabled` shows "Saving is not available here. Use Export > HTML file"; `Export > HTML file` inlines `app.css` and `app.js` with current data and `#diagram-theme` into the `--target file` shape using `stampReadingGuide()`; remove `btn-download-html`.
4. `scripts/render_screenshot.py` and `dev/cdp.mjs`: serve split artifact directories over a local loopback HTTP server for headless Chrome.
5. `dev/check_artifact_shape.py`, `dev/check_extract.py`, `dev/e2e_theme.mjs`, and the artifact e2e harnesses (`dev/e2e_shell.mjs`, `dev/e2e_sequence.mjs`, `dev/e2e_erd_copy.mjs`): update the expected split-file shape, theme plumbing checks, and stubbed `window.claude` (files-form publish, plus selection/undo survival across Save); remove `btn-download-html` checks.
6. [SKILL.md](../../SKILL.md), [references/artifacts.md](../../references/artifacts.md), [docs/artifacts.md](../../docs/artifacts.md), and [dev/architecture.md](../architecture.md): document the split artifact workflow (data-only edits vs structural re-layout vs engine/UI upgrades, updating in place on the same artifact URL), keep the legacy fallback paragraph for old single-file artifacts, and update viewer/architecture docs (removing `Download .html` references).
7. Release note: old artifacts keep working; to get the new split editor, rebuild with `--keep-layout`.

## Open questions

- **Invited editor.** The files-form save is untested for an invited editor who is not the owner. Test once the split build exists.

## Resolved

- **Public sharing.** Tested by the owner, signed in, after setting the link to "Anyone with the link": the files-form save succeeded (618 ms, page kept running, version `1794891643-d3c4`). The platform note that the form is disabled on public artifacts did not hold for the owner. A signed-out viewer has no Save by design. So no whole-page fallback is needed for the owner; keep the `capability_disabled` message for any case where it is rejected.
- **One more file in the gate.** The tool wants `index.html` as `file_path` on every publish, and reading files by `path` or listing them does not satisfy the gate. A fresh session succeeded after reading `url` without `path` (the tiny `index.html`) and `diagram.json` by `path`.
- **Positions on agent edits.** Keep `assets/types/<type>/engine.js` and `<type>.js` completely independent of artifact packaging: `diagram.json` already holds the `layout` map, so text, label, color, and attribute edits edit `diagram.json` directly while preserving `layout`. Structural edits (adding/removing nodes or edges) re-run `layout_engine.py --layout` and publish `index.html` plus the updated `diagram.json` without reading or re-uploading `app.css` or `app.js`. Keeping hand-dragged positions when an agent adds nodes (partial layout in `routeDiagram`) stays a separate, engine-level feature outside this plan.
- **Reload on Save.** The spike showed that the files-form save does not reload the saving view (the page kept running). Today's whole-page save does reload it, which is why the shell sets `reloadExpected`. With the files form nothing is rebuilt: a Save only calls `updateStatus` and records the new `savedJson`, so the selection and the undo history survive by construction, and the page keeps rendering from the data it holds. What to check in the build, not now: do not set `reloadExpected` on a files-form save (otherwise the "someone else saved" handling is wrong), pass `ifMatch` if runtime contract 0.2.96 exposes/accepts it on `artifact.publish`, and add an e2e check with the stubbed `window.claude` that selects an item, makes an edit, Saves, then asserts the selection, the undo stack and the unsaved badge. A save that lands over someone else's version does reload the view (the platform's rule), which the existing `conflict` handling covers.
