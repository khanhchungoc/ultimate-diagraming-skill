# Plan: claude.ai Artifacts as split files (data apart from code)

Status: spike run (tool side done, browser side waiting on a person to open the test artifact). Nothing in the product changed yet.

## Problem

An artifact built with `--target artifact` is one 350 KB HTML page. Almost all of it is editor code (CSS, JS, icons); the diagram is about 130 lines. Two things follow:

1. **The overwrite gate.** The `Artifact` tool refuses to publish over a live artifact until the conversation has published it or read every line of its saved source (about 150k tokens). The gate looks at where the live version came from, not at what changed, so even a one-line data edit is refused when the artifact was made in an earlier conversation or the user pressed Save in the page since. See [references/artifacts.md](../../references/artifacts.md) for the fallback used today (publish a new artifact, new link).
2. **Upgrades.** A newer engine or UI can only reach an old artifact by republishing the whole page, which hits the same gate, and which must not touch what the user edited.

## Goals

- A data-only change (an agent edit, or the user's Save) never needs the editor code to be read or republished.
- An engine or UI upgrade rebuilds an existing artifact **without changing the user's data or positions**.
- Old single-file artifacts keep working, and can be rebuilt.
- The local HTML file target stays exactly as it is: one self-contained file.

## Non-goals

- Keeping hand-dragged positions when an agent adds nodes by editing the JSON: a separate fix (see Open questions).
- Changing diagram types, schemas or the engines.

## What the platform gives us (read from the runtime contract 0.2.96 and the Artifact tool)

- A multi-file artifact: the page plus `files` (stylesheets, scripts, data, images), referenced by relative URL. An update sends only the files that changed; the rest are kept.
- The `artifact` capability's **files form**: `artifact.publish({"diagram.json": text})` saves only the named files. The saving view keeps running (no reload); only other open views reload. It is rejected with `capability_disabled` where the form is not enabled, including on **publicly shared** artifacts. Per-file `ifMatch` (sha256) lets two writers save different files without overwriting each other.
- The overwrite gate accepts a path that the conversation has read by its path, seen in a file listing, or published itself. So a data-only publish needs `diagram.json` read (a few KB), and the editor files only need to appear in a listing.
- `Artifact read` with `path` fetches one published file; `Artifact list` with `scope: "files"` lists them.

## Spike

Test artifact: https://claude.ai/artifact/Lazsj9QMXRi4tcU2zHJpNP (private, throwaway; delete it when the plan is done). Files: `index.html`, `app.js`, `app.css`, `diagram.json`.

Checked from the tool side (done):

| Check | Result |
|---|---|
| Publish a page plus `files` | Works. |
| `Artifact list` scope `files` | Lists all four files with types and sizes. |
| `Artifact read` with `path: "diagram.json"` | Returns just that file (35 bytes) and its sha256. |
| Data-only update | `files` alone is refused: the tool always wants the page's `file_path`. Passing `index.html` with `files: {diagram.json}` works and made version 2. With the split, `index.html` is about 150 lines, so having it in the call is cheap. |
| Overwrite gate | Not testable from the session that created the artifact (it published every file itself). Test it from a fresh conversation: publish a data-only change to this artifact by URL after reading only `diagram.json`. |

Checked in the browser (pending; open the link and report what the page prints):

1. `app.js` runs from a relative `<script src>`.
2. `app.css` applies (the probe line is green).
3. `fetch('diagram.json')` returns 200 and the data. After the agent's data-only publish the page should show `"saves": 1`.
4. `claude.use('artifact')` resolves.
5. The Save button's files-form save succeeds, the page keeps running, and the result is not `capability_disabled`.

Decision rule: if 1 to 4 pass, go ahead. If 5 fails for the owner, fall back to inline data plus the new-artifact workflow (no change to the product beyond the docs already written). If `fetch` fails but the script and stylesheet load, the page can carry the data inline in `index.html` and still get the split for the code.

## Design

Artifact target output, instead of one page:

| File | Holds | Changes when |
|---|---|---|
| `index.html` | skeleton, title, reading guide for agents, mount point | rarely |
| `diagram.json` | the diagram data, in the disk format (`schemaVersion`, `layout` map) | the user saves, or an agent edits the data |
| `app.css`, `app.js` | shell, type plugin, engine, tokens, icons | an engine or UI release |
| fonts | as today | rarely |

- **Boot:** the shell loads `diagram.json` first, then runs exactly as today. Everything the shell already does with the `diagram-data` block (reading, `_readme`, `fromDisk`) is unchanged.
- **Save in the page:** `publish({"diagram.json": text})` replaces the current rebuild of the whole document from `pristineBody`. Pass `ifMatch` with the sha256 the host last reported.
- **Export > HTML file (editable):** rebuild a single self-contained file by fetching `app.css` and `app.js` and inlining them with the current data. The menu item already exists in the Export menu.
- **View-only viewers (decided):** a viewer who cannot save (signed out, or no edit access) sees no Save button, which is expected. Do **not** add a separate "Download .html" button next to it: the normal **Export** button stays, and its menu keeps "HTML file (editable)". This also removes the extra `btn-download-html` button that `applyArtifactUi` adds today, the toasts that say "Use Download .html" (say "Use Export > HTML file"), and the two `e2e_shell.mjs` checks that look for that button. Not done yet: this plan records the decision only.
- **Agent update (data only):** `Artifact read` with `path: "diagram.json"`, edit, publish `index.html` plus `files: {"diagram.json": ...}`. No full read, no rebuild.
- **Agent upgrade (engine or UI):** build the new `app.js` and `app.css`, list the artifact's files (satisfies the gate), publish them. `diagram.json` is not in the call, so user edits and positions cannot change.
- **Old single-file artifacts:** unchanged behaviour. To move one to the split layout, rebuild with `layout_engine.py --layout <saved page.html> --keep-layout --target artifact` and publish as a new artifact (the data and positions carry over), or overwrite after a full read if a person insists on the same URL.
- **Backward compatibility of the data:** every release must read all earlier `schemaVersion` values and migrate on load in memory; it never rewrites what is stored until the user saves. `disk_format.py` already does this (for example ERD v1 and v2 layouts).

## Work

1. Run the spike's browser checks; record the results in this file. Delete the test artifact.
2. `scripts/layout_engine.py`: a split artifact target that writes the files above (the file target is untouched). `artifact_template` and `ARTIFACT_HEAD` stay for the legacy single-file shape until it is removed.
3. `assets/shell/shell.js`: load `diagram.json` at boot; files-form save with `ifMatch`; `capability_disabled` shows "Saving is not available here. Use Export > HTML file"; Export > HTML file inlines the code; remove the separate Download .html button (see Design).
4. `dev/check_artifact_shape.py` and the artifact e2e harnesses (`e2e_shell.mjs`, `e2e_sequence.mjs`, `e2e_erd_copy.mjs`): update the expected shape and the stubbed `window.claude` (files-form publish).
5. [SKILL.md](../../SKILL.md) and [references/artifacts.md](../../references/artifacts.md): data update and upgrade procedures as above; keep the legacy fallback paragraph for old artifacts.
6. Release note: old artifacts keep working; to get the new editor, rebuild with `--keep-layout`.

## Open questions

- **Public sharing.** The platform says the files-form save is disabled once an artifact is shared publicly. Whether that also blocks the owner or an invited editor is not known. Already confirmed by the user: today's whole-page save works on an artifact shared by link (they edited and saved one). So the fallback is viable: when the files form is rejected with `capability_disabled`, save `index.html` with the data inside it and keep the editor code in its own files. Test after the spike: set the spike artifact to "Anyone with the link" and click Save again.
- **Positions on agent edits.** `--extract` drops positions, and a hand-edited JSON with a new node triggers a full re-layout in `routeDiagram`. A `--with-layout` extract and a "place only the new items" mode would make data edits keep the user's arrangement.
- **Reload on Save.** The files form keeps the saving view running, but the page renders from the data it holds; check that undo history and selection survive a Save.
- **One more file in the gate.** The tool wants `index.html` as `file_path` on every publish. Confirm from a fresh conversation that reading only `index.html` and `diagram.json` is enough.
