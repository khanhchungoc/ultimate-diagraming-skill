# Plan: Publish diagrams as claude.ai Artifacts (with Save back to the artifact)

Today the skill writes one standalone `.html` file, and **Save** writes it back to disk (File System Access API, or a download). This plan adds a second output for Claude Code: the diagram is published as a **claude.ai Artifact**, and **Save** inside the artifact publishes a new version of that same artifact. Claude Code asks the user which output they want.

**Status:** Phases 1, 2, 3, 4 and 5 are implemented and tested against a stubbed `window.claude` (`dev/check_artifact_shape.py`, `dev/e2e_shell.mjs --artifact`, `dev/e2e_sequence.mjs --artifact`). **Phase 0 (the spike on a real published artifact) has not been done**, so these stay open and the code marks them `TODO(verify ... plan Phase 0)`:

- The exact `RESET` CSS. `ARTIFACT_RESET_CSS` in `scripts/layout_engine.py` and `assets/shell/shell.js` is a placeholder (`*,*::before,*::after{box-sizing:border-box}html,body{margin:0}`). Replace both with the text from an `Artifact read` of any published page.
- Whether the Artifact tool accepts a complete document (skeleton first) as `file_path` as is, or wants a fragment it wraps itself. The generator writes the complete document, as the plan's "required document shape" says.
- Whether the order inside `<body>` matters. The page puts `<title>`, the reading guide and the data block first and the styles after them (so a read of lines 1-E ends before the CSS), not `<title>` and `<style>` first.
- What the viewer injects into the document (the pristine-body filter in `capturePristineBody` is deliberately conservative), whether `fetch(location.href)` returns the source (the artifact path never uses it), and what the sandbox allows (`showSaveFilePicker`, `<a download>`, clipboard, IndexedDB, `localStorage`).
- The `downloads.save({filename, data})` data type: the page passes a `Blob`. Check that text and PNG are accepted that way.
- Whether Google Fonts loads from `<body>`, the size of a large page against 16 MB, and the shape of the `publish()` rejection (the page matches `conflict`, `not_granted` and `not_writer` in the error's `code`, `reason` or `message`).

## Goals

- In Claude Code, the user chooses: **Artifact** (a private claude.ai page they can share) or **HTML file** in the project folder.
- In an artifact, the user edits the diagram, presses **Save**, and the artifact itself updates: every open view reloads to the new version, and the AI's next "add a step after review" starts from the saved version.
- One page, two homes: the same generated page saves to the artifact when it runs inside claude.ai and to disk anywhere else. No second editor.
- Every other agent (Antigravity, Copilot, Codex, Gemini, Kiro) behaves exactly as today.

## Non-goals

- Live co-editing (several people editing at once with cursors). Two saves at the same time: the later save loses and reloads (see [Conflicts](#conflicts-and-read-only-viewers)).
- Keeping hand-dragged positions through an AI re-layout. This already applies to files and stays the same ([Update procedure](../../SKILL.md)).
- Artifacts in agents other than Claude Code.

## How it works

### The runtime capability

A page published with `capabilities: {artifact: {}}` can call:

```js
const artifact = await claude.use("artifact");  // null: not in claude.ai, or this viewer cannot save
await artifact.publish(html);                    // html = a complete document; becomes the new version
```

- `use()` resolves later, never during the script's first run, and resolves `null` after about 10 s when nothing answers. The page renders without it and switches the Save button over when it resolves.
- `publish()` rejects with `conflict` (someone else saved first; this view reloads to their version), and with `not_granted` / `not_writer` (a viewer who cannot edit the artifact).
- Save only on a click, never on load. Every publish is a new version.

### The required document shape

A page that republishes itself must send its document in the exact shape the Artifact tool publishes. Otherwise a later publish from Claude nests one page inside another:

```
<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>RESET</style></head><body>
  ...page content: our <title> and <style> first, then everything else...
</body></html>
```

The `<head>` contains nothing else, with no whitespace between those tags. Today's `shell.html` has its own `<head>` with the title, the data block, the font links and the styles, and puts the "For agents" reading guide before `<html>`. All of that moves into `<body>` in the artifact version.

## Phase 0: Spike (half a day, before any code)

Answer these questions by publishing one throwaway page from Claude Code. Each answer changes the design:

1. **The exact `RESET` string.** Publish a minimal page, read it back with `Artifact read`, and copy the skeleton byte for byte into one constant (Python and JS).
2. **What the viewer injects.** Inside a published page, log `document.documentElement.outerHTML` and check for any runtime `<script>`/`<meta>` that claude.ai adds. These must never be republished.
3. **Does `fetch(location.href)` return the page source?** `saveToFile()` relies on it today. Expected: no (sandboxed frame), so the page needs [its own copy of its source](#how-save-rebuilds-the-page).
4. **What works in the sandbox:** `showSaveFilePicker`, `<a download>` (Export SVG/PNG), `navigator.clipboard` (Copy), IndexedDB, `localStorage` (theme). Anything that is blocked moves to the `downloads` capability or is hidden.
5. **Fonts:** does `<link rel=stylesheet href="https://fonts.googleapis.com/...">` inside `<body>` load? (Google Fonts is the one allowed stylesheet host.)
6. **Size:** a large flowchart page compared with the 16 MB limit (expected: far below).

## Phase 1: Generator, `--target artifact`

`scripts/layout_engine.py`

- New flag `--target file|artifact` (default `file`, so today's output stays byte-identical).
- `assemble_page(kind, data, target)` fills the same parts into one of two templates:
  - `assets/shell/shell.html`: unchanged.
  - `assets/shell/shell-artifact.html`: new. The skeleton head from Phase 0, then in `<body>`: `<title>`, the reading-guide comment, the `diagram-data` block, the font link, `<style>`, then the same header/stage/help/scripts placeholders as `shell.html`.
  - To keep the two templates from drifting, build the artifact template from `shell.html` with a small transform (lift the head contents into the body) instead of keeping a second copy by hand. Either way, a test must compare their bodies.
- `stamp_reading_guide()` already finds the block by its markers. Check that its line numbers still come out right when the block sits in `<body>`.
- `--extract` already searches the whole text for `diagram-data`. Check it on an artifact page that was read back with `Artifact read`.
- `find_external_refs()`: unchanged (the font is still the only network reference).
- `--screenshot` renders the artifact-shaped file locally. With no `window.claude`, the page behaves as a file, so the visual check works as today.

## Phase 2: Editor, Save to the artifact

`assets/shell/shell.js`

### Where the page is running

```js
let artifactApi = null;      // set when claude.use("artifact") resolves to a namespace
if (window.claude && window.claude.use) {
  window.claude.use('artifact').then(a => { artifactApi = a; updateSaveUi(); }, () => {});
}
```

- `artifactApi` set: **Save** publishes to the artifact. The badge reads `Saved to artifact` / `Unsaved changes`.
- `window.claude` present but `use()` resolved `null`: the viewer cannot save (read-only share, signed out). Show a `View only` badge and replace Save with **Download .html** (Phase 3). Edits still work locally, and the badge says they are not kept.
- No `window.claude`: a file, today's code path, unchanged.

### How Save rebuilds the page

The capability guidance says: regenerate the document from state, never serialize the live DOM (by save time the DOM holds the rendered SVG, selection state and so on).

1. At the top of the main script, before the first render, keep a pristine copy of the page: the `<body>`'s `innerHTML` as parsed. Remove the nodes Phase 0 found to be injected by the viewer, and the `render-report` block that `saveToFile()` already strips.
2. On Save: the same steps as today (`toDisk`, `formatJson`, data-block replacement, `<title>` and `<h1>` replacement, `stampReadingGuide`) run on `SKELETON_HEAD + pristineBody + '</body></html>'`. Only the source text changes; the code path stays the same.
3. Call `await artifactApi.publish(html)`. On success, `savedJson`/`everSaved` are updated as today. The view then reloads to the new version anyway.
4. Disable Save while a publish is in flight, so a double click cannot cause two publishes.

Refactor `saveToFile()` into `buildSavedHtml(sourceText)` (shared) plus two writers, `writeFile(html)` (today's picker/handle/download code) and `publishArtifact(html)`.

### Conflicts and read-only viewers

| Result | What the user sees |
|---|---|
| success | View reloads to the new version (the platform does this) |
| `conflict` | Toast: "Someone else saved first. Showing their version." The view reloads and this edit is lost. No retry. |
| `not_granted` / `not_writer` | Switch to `View only` + Download .html |
| any other error | Toast with the message. The edit stays on screen and is still marked unsaved. |

`beforeunload` warns about unsaved changes as today, except during the platform's reload after a successful publish.

## Phase 3: Exports inside the artifact

Depends on the Phase 0 answers.

- **Download .html**: a standalone file version of the current diagram, so an artifact can still become a file. It is built with the same `buildSavedHtml`, but on the file shape (head contents back in `<head>`). It needs `capabilities: {downloads: true}`; `downloads.save({filename, data})` asks the viewer to confirm.
- **Export SVG/PNG**: if `<a download>` is blocked in the frame, route `downloadBlob()` through `downloads.save` when that namespace is available.
- **Copy**: if the clipboard is blocked, hide the Copy items when running as an artifact (the existing `canCopyPng` check covers part of this).

Publish capabilities: `{artifact: {}, downloads: true}`.

## Phase 4: SKILL.md, ask the user, then publish or write

The skill folder is shared by every runtime (one symlink in symlink mode), so runtime-specific behaviour goes in `SKILL.md` as a condition on the host's tools, not in the installer.

### The question

Add a step 0 to *Procedure: New Diagram*:

> **Output (Claude Code only).** If your tools include `Artifact` (it publishes claude.ai Artifacts), decide where the diagram goes before writing anything:
> 1. The user already said ("as an artifact", "save to docs/flow.html"), or a saved default exists (see below): follow it.
> 2. Otherwise ask once with your question tool (`AskUserQuestion`): **Artifact**: a private claude.ai page, editable and saved in place, shareable by link; **HTML file**: `<title-slug>.html` in the project folder, works offline. Use that answer for the rest of the conversation.
>
> Without an `Artifact` tool, write the HTML file as today and do not ask.

### The artifact path

The same steps 1–6, with these differences:

- Step 3: `--target artifact`, output to **scratch** (not the workspace): `-o <scratch>/<title-slug>.html`.
- Step 6 (after a clean run): publish with the Artifact tool, using `file_path` = the scratch HTML, `icon: "chart"`, `capabilities: {artifact: {}, downloads: true}`, and a one-sentence `description`. Then delete the scratch JSON and PNG, but **keep the scratch HTML** until the conversation ends: a later edit republishes from the same path to the same URL.
- Final report: the artifact link instead of the path. Say that Save inside the artifact updates it, and that only people with edit access can save.

### Read and Update an artifact

- **Read**: `Artifact read` with the URL saves the page locally and names the file. Run `--extract` on that file. Never read the HTML whole (same rule as today).
- **Update**: `Artifact read` → `--extract -o <scratch.json>` → edit → `--layout ... --target artifact -o <the saved file>` → publish with `url` = the artifact's URL and no `capabilities` (keeps the stored declaration). The user's in-browser saves are the starting point because `read` returns the latest version. The warning about re-layout resetting positions applies unchanged.
- `Artifact read` on a URL the user doesn't own returns a summary, not the page: say so and offer to create a new artifact instead.

## Phase 5: Installer, a saved default (optional)

Asking on every diagram can feel like nagging, so the installer can store a default for Claude Code.

- `bin/install.js` and `scripts/install.py`/`.sh`/`.ps1`: new option `--claude-output ask|artifact|file` (default `ask`), applied only when the `claude` runtime is installed.
  - In an interactive terminal with no flag given, prompt once: "In Claude Code, publish diagrams as claude.ai Artifacts, write HTML files, or ask each time?"
  - It writes `{"output": "artifact"}` to `~/.claude/ultimate-diagram.json` (user scope) or `<project>/.claude/ultimate-diagram.json` (project scope). This is never written inside the skill folder, which may be a symlink to the repo.
- SKILL.md step 0 reads it: "a saved default exists" = the project file, else the user file. One read of a tiny file.
- When the user answers the question with "always" ("always use artifacts"), Claude writes the same file, so the choice persists without the installer.
- The installer's summary box adds one line for Claude Code: the chosen output, and how to change it.

## Tests

| Test | Checks |
|---|---|
| `dev/check_golden.py` | `--target file` output stays byte-identical to the current goldens |
| new `dev/check_artifact_shape.py` | `--target artifact` starts with the exact skeleton, has nothing else in `<head>`, and has `<title>` first in `<body>`; `--extract` round-trips; reading-guide line numbers are right |
| `dev/e2e_shell.mjs` (+ `e2e_sequence.mjs`) | With a stub `window.claude.use('artifact')` that records `publish(html)`: Save publishes once, the published document has the skeleton shape, its data block is byte-identical to the generator's (same rule as the disk test today), and no injected node is included. With `use()` → `null`: View only badge, Save hidden. With `publish` rejecting `conflict` / `not_writer`: the right toast and state. Without `window.claude`: today's file save is unchanged. |
| manual, once per release | Publish a real artifact from Claude Code, edit, Save, reload; ask Claude to "add a step" and confirm it starts from the saved version; open as a viewer without edit access |

## Rollout order

1. Phase 0 spike, and update this plan with the answers.
2. Phases 1 + 2 together (the generator and the editor must agree on the shape), with their tests.
3. Phase 4 (SKILL.md), which makes the feature usable.
4. Phase 3 (exports in the sandbox).
5. Phase 5 (installer default) and the README section "Diagrams as claude.ai Artifacts".

## Open questions

- Should artifact Save also keep a local file in sync (e.g. the project folder)? Not possible from the page, because the artifact cannot write the user's disk. Claude could re-read the artifact and write the file on request.
- Large flowcharts: does the viewer's reload after every Save feel slow? If so, consider batching (Save stays manual, so this is probably fine).
- Artifacts are private by default. Note in the report that sharing is the user's choice and is done from claude.ai.
