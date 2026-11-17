# Plan: text search across all diagram types

## Goal

Add one search bar to every diagram page. It finds text in nodes, labels, notes and titles, dims what does not match, and steps through the matches with Next and Previous. The shell owns the UI, the matching and the navigation. Each type only says which text it has.

## Behaviour (the spec every agent builds against)

- **Open and close.** The search button in the header, `Ctrl`/`Cmd` + `F`, or `/` opens the bar and focuses the input. `Ctrl`/`Cmd` + `F` is caught only while focus is not in a text field (`typingInField()` in `shell.js`); inside a field the browser's find still works. `Esc` closes the bar and clears every highlight.
- **Matching.** Case-insensitive substring after `normalize('NFD')` with the diacritics removed. An empty query shows nothing and dims nothing.
- **Counter.** "3 / 12" next to the input; "No matches" when there are none.
- **Next and Previous.** Buttons with `aria-label` "Next match" and "Previous match", at least 24 x 24 px, disabled at 0 matches. `Enter` goes to the next match and `Shift` + `Enter` to the previous one. Both wrap around at the ends.
- **Order.** The order of the array `searchItems()` returns. Each type returns its items in reading order: top to bottom, then left to right, or along the flow.
- **Highlight.** Non-matching items get the class `search-dim` (the shared `--dim` and `--dim-filter` effect tokens). The current match gets `search-current` (the `--focus-ring` outline). Other matches stay normally lit. Colour is never the only cue: the counter and the ring carry the state too.
- **Navigation.** Each step pans the viewport so the current match is centred, keeping the zoom unless the match would be smaller than readable, then zooming to the same scale `fitView()` would pick for it. With `prefers-reduced-motion`, the move is instant.
- **Live.** The query is applied again after every `plugin.render()`, so editing, undo and theme switches keep the highlight. The current index is kept when the same item still matches.
- **View-only.** Search state never enters `chartData`, the undo stack, the saved HTML, exports (SVG or PNG) or Mermaid output. Export clears the search classes on the cloned DOM.
- **Present mode.** The bar stays available in `?present`, because reading is the main use there.
- **Collapsed ERD tables.** A match in a column of a collapsed table highlights the table header and the counter counts it once. The table is not expanded, because collapsing is stored in the data.

## The plugin contract (written first, serially)

```js
// In registerDiagramPlugin({...}). Optional: a plugin without it shows no search button.
searchItems() -> Array<{
  id: string,        // stable across renders (a node, edge, note or column id)
  text: string,      // the visible text, as the reader sees it
  el: Element        // the element to dim, ring and centre on (for a collapsed column: its table)
}>
```

The shell calls it on every query and after every render, so it must read the live DOM and be cheap.

## Work breakdown for parallel agents

### Phase 0: contract and scaffolding (one agent, before the others)

Owner: lead. Files: `assets/shell/shell.js` (stub only), `dev/plans/search.md`.

1. In `shell.js`, add an empty `SEARCH` section with the contract above as a comment, and a `window.__searchItems = () => plugin.searchItems?.() || []` debug hook for the tests.
2. Commit. All Phase 1 agents branch from this commit.

### Phase 1: run in parallel (six agents, one worktree each, no shared files)

Each agent owns only the files listed for it. Any change outside its list goes in its report as a request to the lead, not into its diff.

| Agent | Owns | Task |
|---|---|---|
| A: shell UI | `assets/shell/shell.html`, `assets/shell/shell.js` (the `SEARCH` section only), `assets/components/search.css` (new), `scripts/layout_engine.py` (add `"search"` to `COMPONENTS`) | Header button with `{{icon:search}}`, the bar (input, counter, Previous and Next with the chevron icons, Close with `{{icon:close}}`), the shortcuts, matching, dimming, the current ring, centring, wrap-around, re-applying after render, and clearing the classes for exports. Tokens only, reusing `.btn` and `.btn-icon`. |
| B: flowchart | `assets/types/flowchart/flowchart.js` | `searchItems()`: node labels, edge labels, notes, lane titles, connector letters. Reading order along the flow. |
| C: sequence | `assets/types/sequence/sequence.js` | `searchItems()`: participant names, message labels, notes, fragment titles. Order: participants left to right, then messages top to bottom. |
| D: erd | `assets/types/erd/erd.js` | `searchItems()`: table names, column names, area titles. A column of a collapsed table returns its table's header as `el`. Order: areas, then tables by position, then columns. |
| E: usecase | `assets/types/usecase/usecase.js` | `searchItems()`: actor names, use-case labels, system boundary titles, relation labels. Order by position. |
| F: tests | `dev/e2e_search.mjs` (new) | One test file, run against one fixture per type. It is written against the spec and the contract only, so it can start before A to E finish. |

Test cases for agent F (each type):

1. `Ctrl` + `F` opens the bar and focuses the input; inside the title field, it does not.
2. A query shows the right count, compared with `window.__searchItems()`.
3. `Enter` and the Next button move to the next match and centre it: its box centre is within 10 % of the viewport centre.
4. The Previous button and `Shift` + `Enter` go back, and both wrap at the ends.
5. Non-matches carry `search-dim` and the current match carries `search-current`.
6. A render (undo after an edit) keeps the highlight and the index.
7. `Esc` closes the bar and leaves no `search-*` class in the DOM.
8. An SVG export and a Save contain no `search-*` class.
9. ERD only: a collapsed table's column match counts once and rings the header.
10. With 0 matches the buttons are disabled and the counter says "No matches".

### Phase 2: merge and integration (lead, serial)

1. Merge A, then B to E (they touch different files, so no conflicts are expected), then F.
2. Run `node dev/e2e_search.mjs` for every type and fix failures in the owning file.
3. Add the help entries to `assets/shell/help.html`: the shortcuts, Next and Previous, `Esc`.
4. Add a line to `README.md` and a `search` row to the component table in `dev/architecture.md`.

### Phase 3: checks (can run in parallel, read-only agents)

- `python dev/check_tokens.py --phase 4`
- `python dev/check_contrast.py --strict` (add any new pair to `contrast` in `assets/tokens/default.json`)
- `python dev/check_themes.py`
- `python scripts/render_screenshot.py --input <page>` with axe-core, light and dark, for each type
- `python dev/check_golden.py` and the existing `dev/e2e_*.mjs` files, to show nothing else changed

## Out of scope for v1

- Fuzzy or regular-expression search.
- Replace.
- `F3` and `Ctrl` + `G` as extra Next shortcuts.
- Searching text that only shows on demand (hidden note cards in `.note-layer`). The type agents report whether their notes are always in the DOM; the lead decides before Phase 2.
