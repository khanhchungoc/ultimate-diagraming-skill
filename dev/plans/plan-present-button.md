# Plan: Present button

## Goal

Add a Present button that turns on a read-only presentation view. In that view only the zoom controls and the Present button itself stay visible. The user can pan, zoom, click and hover. Every edit is disabled.

## Today

`?present` and `?capture` add `body.presentation` (`assets/shell/shell.js:405`). CSS and the plugins hide part of the editing chrome. No button sets the class, and the header is not fully hidden.

## 1. Button

- Add `#btn-present` to `assets/shell/shell.html` in `.toolbar-right`, before Export, with a present icon. If no suitable icon exists in `assets/icons`, add an SVG and check `assets/icons/LICENSE` first.
- The button is a toggle and is visible at all times, including inside presentation mode. Set `aria-pressed` to match the state.
- Clicking it toggles `body.presentation` in place, with no reload.
- `Esc` also exits presentation mode. It does nothing in edit mode beyond its current behaviour.
- Entering shows a short hint toast: "Esc or the Present button to exit".
- `?present` in the URL still works and starts in the same state.

## 2. Hide everything except zoom and Present

In `assets/shell/shell.css` (around line 178), extend the `body.presentation` rules:

- Hide the title, save status, Search, Undo, Redo, Theme, Help, Export, Save, the search bar, the help drawer and `.toolbar-center`.
- Keep `.toolbar-zoom` (including Fit) and `#btn-present` visible. Pin `#btn-present` to a corner so it stays reachable once the header is hidden.
- `?capture` keeps its current behaviour (diagram only, no controls).

## 3. Pan, zoom, click and hover only

The shell already blocks Shift-drag marquee, Ctrl/Cmd+A and Delete in presentation mode. Remaining work:

- Flowchart: `flowchart.css:517` sets `pointer-events: none` on nodes and edges, which kills hover. Replace it with a rule that allows hover and click but blocks drag, double-click, context menu and the port handles. `flowchart.js:3658` already blocks pointer-down drag.
- Sequence, ERD and use case: confirm that hover and click (focus, fold chevrons, notes) work. Confirm that double-click rename, drag and handles do nothing. Check the `isPresent`, `erdPresenting` and `presenting` guards on every editing handler.
- Block the global edit paths: Ctrl+Z, Ctrl+Y, Ctrl+S, Delete, paste, file drop and `contenteditable` double-click.

## 4. Tests and docs

- Extend `dev/e2e_shell.mjs` step 10. Check that the button toggles, that `aria-pressed` follows, that Esc exits, that only the zoom dock and the Present button are visible, and that pan and zoom work.
- Add per-type cases: double-click, drag and Delete change nothing, while hover and click still respond. Add a touch case to `dev/e2e_touch.mjs`.
- Run `dev/check_golden.py` and `dev/check_tokens.py`.
- Update `assets/shell/help.html`, `dev/architecture.md` and the SKILL docs.

## Not checked

The exact hover and click behaviour of each diagram type. Step 3 needs a per-plugin pass to confirm.
