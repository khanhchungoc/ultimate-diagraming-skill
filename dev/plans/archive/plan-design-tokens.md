# Plan: Design tokens, brand themes and shared components

Every diagram is drawn from one design-token set. The skill ships a default set. A user can point the skill at a website or a brand guide, get a token set in the same shape, and every diagram type (current and future) uses it without code changes. Every visual component is built once, from tokens only, and reused by all types.

**Status:** All phases (1 to 8) done 2026-11-15 (see their "As built" notes). Review done 2026-11-15 (findings below). Open decisions for Phases 1 and 5 settled 2026-11-15. Typography and iconography added 2026-11-15.

## Goals

- One token file is the only source of colour, typography, iconography, size, radius, shadow and motion values. No literal colour, font, type size or icon markup anywhere else in `assets/`.
- Typography is a set of named text styles (title, label, caption, ...) built from tokens, used by every type for both the UI and the diagram text.
- Every swatch has a soft tone (fills) and a strong tone (frames, accents), each defined for light and dark mode.
- Every page meets WCAG 2.2 level AA in both themes, with the default tokens and with any brand theme, and a check proves it.
- Every icon comes from one icon registry, drawn with icon tokens (size, stroke), and is used by name. A brand can swap the icon set.
- A brand theme is a second file in the same shape. `layout_engine.py --theme <file>` (or a project-level theme file) bakes it into the page. The default output is unchanged byte for byte.
- A website URL or a brand guide (PDF, image, CSS) can be turned into a valid theme file, checked for contrast and completed with defaults.
- Shared UI and diagram parts (buttons, popovers, notes, badges, swatches, edge labels, markers, frames) live in one place and are used by every type. A new type only adds what is truly specific to it.

## Non-goals

- A visual theme editor inside the page.
- Embedding licensed font files. A brand font is linked from Google Fonts when it is there; otherwise the page uses the brand's fallback stack.
- Changing layout algorithms. Only the constants they read move.
- Per-diagram ad-hoc styling beyond what the model already allows (`color` on lanes, tables and participants).
- Drawing a custom icon set. A brand theme can only point at an existing open-licensed set with the same grid (24 x 24, stroke-based).

## Review findings (2026-11-15)

### What already works

- **Semantic tokens exist.** `shell.css` defines about 60 custom properties on `:root`, with a full dark set under `:root[data-theme="dark"]`. Names are semantic (`--bg-panel`, `--edge-in`, `--decision-fill`, `--node-border`), and several carry contrast notes.
- **Renderers are mostly token-driven.** The type JS files contain almost no colour literals; they set custom properties (`--swatch-color`, `--lane-color`, `--mk`) and let CSS resolve them.
- **Exports follow tokens for free.** `buildExportSvg` in `shell.js` inlines computed styles, so SVG and PNG exports pick up whatever the tokens are.
- **Shared button atoms exist.** `.btn`, `.btn-icon`, `.btn-primary`, `.btn-success`, `.btn-label`, `.toast` and `.badge` are defined in `shell.css` and used by all three toolbars.
- **One assembly point.** `assemble_page()` in `layout_engine.py` fills `{{SHELL_CSS}}` and `{{TYPE_CSS}}` in one pass, so tokens can be injected in one place for both `--target file` and `--target artifact`.

### Gaps

1. **Tokens are split across four files.** Besides `shell.css`, each type declares its own `:root` block: `erd.css:6-15`, `flowchart.css:565-570` and `788-793`, `sequence.css:28-29` and `164-165`.
2. **Duplicated tokens.** `--note-bg/border/accent/ink/leader` are identical in `erd.css` and `flowchart.css`. The sequence note uses a different, yellow set (`--seq-note-*`). `--erd-key` repeats the hex of `--decision-accent` instead of referencing it.
3. **Literal colours outside tokens.** `#ffffff` appears about 9 times in type CSS (text on danger, toggle knob), `#0b1220` twice in `shell.css` (dark-mode text on primary buttons), the sequence tint palette is literal hex (`sequence.css:28-29`), and `#e2e8f0` is used as a `var()` fallback in `flowchart.css:34-36`.
4. **Non-colour values are not tokens.** About 53 literal `px` font sizes, about 96 literal border radii and about 54 literal box shadows across `shell.css` and the type CSS. A brand cannot change corner radius or type scale today.
5. **Duplicated components.** The confirm-delete button exists three times (`.erd-confirm-delete`, `.lane-confirm-delete`, `.seq-confirm-delete`) with the same rules. The red-on-hover delete is built three times (`.erd-note-del`, `.note-del`, `.lane-tool-delete`). Notes are built twice for ERD and flowchart and a third, different way for sequence.
6. **Swatch palette is code, and its hex is data.** `SWATCHES` in `shell.js:32-34` is a hard-coded list of 8 hex tints. Diagram JSON stores the hex itself (`"color": "#e0f2fe"`), and the sequence renderer treats any hex not in `SWATCHES` as no colour. Changing the palette for a brand would silently drop colours from every saved diagram.
7. **Layout depends on the font, and the font is hard-coded.** The engines estimate text width from per-character constants measured for Nunito Sans at fixed sizes: `SQ.CHAR_W 7.4`, `SQ.DETAIL_CHAR_W 6.4`, `SQ.NOTE_CHAR_W 6.2`, `ER.CHAR_W 7.4`, `ER.TYPE_CHAR_W 6.6`, `ER.LABEL_CHAR_W 7`, plus the flowchart's `LE_PROFILES`. `audit_sequence.py` and `audit_erd.py` copy the same numbers by hand ("keep them in sync"). A wider brand font would make labels overflow and the audits would not notice.
8. **Font is linked in one place only.** `shell.html` links Nunito Sans from Google Fonts and `shell.css:98` sets the stack. Neither is parameterised.
9. **Typography has no scale.** The CSS uses about 24 distinct font sizes in mixed units: 12px (12 times), 13px (11), 0.8125rem (7, which is also 13px), 14px, 10px, 11px, plus one-offs such as 9.5px, 10.5px, 11.5px, 0.78rem, 0.85rem, 0.9rem and 1.1rem. Weights 400, 500, 600 and 700 are used without names, there are 10 different line heights (unitless and px), and 4 different letter spacings (0.02em to 0.06em). There is one family and no monospace role, so ERD column types and code-like labels use the body font. The renderers shrink text to fit in JS (`flowchart.js:554-562`, `erd.js:699-709`, minimum `9 * inv` px), so the base and minimum sizes are also hard-coded in JS.
10. **Icons are inline markup copied around.** There are about 70 inline `<svg>` icons spread over `shell.html`, the three `toolbar.html`, `icon.html` and `stage.html` files, and `shell.js`, `erd.js`, `flowchart.js` and `sequence.js`. The same icon is often pasted several times: the trash icon appears 4 times, and close, plus, chevron, link and note icons 2 or 3 times each. Only the flowchart lane icons have a registry (`assets/types/flowchart/icons.json`, 25 names, injected as `TYPE_ICONS` by `layout_engine.py:1163`), and it belongs to one type. Stroke width varies between `2` (30 times), `1.75` (11) and `2.5` (1) without a rule, and icon sizes are literal `width`/`height` attributes. The drawings look like the Lucide set (ISC licence), but the repo carries no attribution; to be verified.
11. **The authoring references hard-wire colours and icons.** The agent writes diagrams from `references/types/*.md`, so these docs are part of the contract:
    - `flowchart.md:27` lets the agent set any hex as a lane `color` "to match the source's colours". A brand palette cannot control those lanes.
    - `sequence.md:46` lists the 8 swatch hex values by hand, and `colorKey` (`sequence.md:47`, `erd.md:15`) is keyed by the hex itself, so a palette change also breaks the colour legend.
    - Sequence fragments use a third, separate colour scheme by name (`blue`, `green`, `yellow`, `red`, `purple`, `gray`, `sequence.md:56`), drawn from the literal tints in `sequence.css:28-29`.
    - `flowchart.md:131-161` lists the 25 lane icon names by hand. Nothing checks this table against `icons.json`, and rule 8 says `--layout` warns about a name not in the table.
    - Start and end steps "render as rounded pills in their own colours" and classic symbols use "a task's size and colours" (`flowchart.md:28`, rule 10). That wording is right; the plan only has to keep those colours as tokens.
    No reference mentions fonts or type sizes, so typography needs no reference change.
12. **Swatch shades are guessed at run time, and nobody checks them.** `shell.css:602-645` derives every swatch role (stripe, pill fill, pill ink, solid fill, line) from one pastel hex: with relative OKLCH colours where the browser supports them, otherwise with `color-mix` toward slate. The two paths give different colours, the dark-mode shades come from the same pastel, and no contrast is checked for any role. Sequence frames add a second, strong palette (`#3b82f6`, `#22c55e`, ...) drawn at 7% fill opacity. `.swatch-dot` uses a literal `rgba(0,0,0,0.18)` border.
13. **Accessibility is handled case by case.** Three tokens carry contrast notes (`--node-border` 3:1, `--text-soft` 4.5:1, `--decision-text` 7:1), but there is no list of required pairs and no check, so a brand theme could pass any colour. Not yet verified: contrast of the in/out edge highlight against both backgrounds, the focus ring, the swatch roles, edge labels on lane tints, and the `fitMin` 9px shrink-to-fit text. Icon stroke widths also vary (`2`, `1.75`, `2.4`, `2.5`).
14. **No guard.** Nothing fails when someone adds a literal colour or a new token in a type file, so the drift above will come back.

## Design

### Token file

`assets/tokens/default.json` holds the default set. A brand theme has the same shape; any key it omits falls back to the default.

```json
{
  "name": "default",
  "font": {
    "family": "Nunito Sans",
    "stack": "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif",
    "href": "https://fonts.googleapis.com/css2?family=Nunito+Sans:opsz,wght@6..12,400..700&display=swap",
    "metrics": { "label": 7.4, "title": 7.4, "detail": 6.4, "note": 6.2, "type": 6.6, "edgeLabel": 7, "edgeWrap": 6.6 }
  },
  "type": {
    "family": { "ui": "font.family", "diagram": "font.family", "mono": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
    "size":   { "2xs": "10px", "xs": "11px", "sm": "12px", "md": "13px", "lg": "15px", "xl": "18px" },
    "weight": { "regular": 400, "medium": 500, "semibold": 600, "bold": 700 },
    "leading": { "tight": 1.2, "normal": 1.4 },
    "tracking": { "normal": "0", "caps": "0.04em" },
    "fitMin": "9px",
    "styles": {
      "title":      { "family": "ui", "size": "lg", "weight": "bold", "leading": "tight" },
      "label":      { "family": "diagram", "size": "md", "weight": "semibold", "leading": "tight" },
      "detail":     { "family": "diagram", "size": "sm", "weight": "regular", "leading": "normal" },
      "caption":    { "family": "ui", "size": "xs", "weight": "medium", "leading": "normal" },
      "overline":   { "family": "ui", "size": "2xs", "weight": "bold", "tracking": "caps" },
      "code":       { "family": "mono", "size": "sm", "weight": "regular" },
      "control":    { "family": "ui", "size": "md", "weight": "medium" }
    }
  },
  "icon": {
    "set": "default",
    "size": { "sm": 12, "md": 14, "lg": 16, "xl": 20 },
    "stroke": 2,
    "strokeFine": 1.75,
    "cap": "round", "join": "round"
  },
  "radius": { "xs": "3px", "sm": "4px", "md": "6px", "lg": "8px", "xl": "10px", "2xl": "12px", "pill": "999px", "round": "50%" },
  "shadow": { "sm": "...", "chip": "...", "md": "...", "lg": "...", "xl": "...", "ring": "0 0 0 3px var(--primary-ring)", "...": "see Phase 2, as built, radius and shadow" },
  "motion": { "ease": "0.15s ease" },
  "palette": [
    { "slot": "1", "name": "sky",
      "light": { "soft": "#e0f2fe", "strong": "#0369a1" },
      "dark":  { "soft": "#0c2a3d", "strong": "#7dd3fc" } },
    "... slots 2 to 8, then slot 9: a neutral (grey) for uncoloured frames"
  ],
  "contrast": "list of required pairs, see Accessibility",
  "color": {
    "light": { "bg-page": "#f8fafc", "primary": "#2563eb", "on-primary": "#ffffff", "note-bg": "#f8fafc", "...": "..." },
    "dark":  { "bg-page": "#0b1220", "primary": "#60a5fa", "on-primary": "#0b1220", "...": "..." }
  }
}
```

- `color.*` keys are the current custom-property names without `--`, merged from all four CSS files, with duplicates collapsed. New semantic keys replace literals: `on-primary`, `on-danger`, `toggle-knob`, `note-*` (one set for all types).
- `font.metrics` are average character widths in px at the sizes the engines use. They are the only numbers the layout reads from the theme.
- `type.styles` are the text roles. Each one becomes a utility class (`.t-label`, `.t-caption`, ...) and a set of custom properties (`--t-label-size`, `--t-label-weight`, ...), so a component says which role its text plays, never which size. `type.size` replaces the 24 sizes found in the review; the scale steps are a starting proposal and are checked against screenshots in Phase 2. `fitMin` replaces the JS minimum for shrink-to-fit text.
- `icon.*` are drawing rules for every icon. `icon.set` names a registry file in `assets/icons/` (Phase 4).
- `palette` has fixed slots so saved diagrams keep their colours when the theme changes (see Phase 5). Each slot has two tones in each mode:
  - **soft**: the large, quiet fills (lane tints, participant boxes, table headers, swatch pills);
  - **strong**: the accents and lines (lane stripe, lifeline, frame border and tag, solid pill, swatch dot).
  The token build derives every swatch role from these two tones and writes them as fixed values: `--sw-<n>-fill`, `--sw-<n>-ink` (text on the fill), `--sw-<n>-line`, `--sw-<n>-solid` and `--sw-<n>-on-solid`, for both modes. It replaces the run-time OKLCH and `color-mix` derivation, so every browser and every export shows the same colours and each pair can be checked. A theme may set any role explicitly; anything it leaves out is derived.

### Accessibility (WCAG 2.2 AA)

The target is WCAG 2.2 level AA, in light and dark mode, for the default theme and every generated theme. Exported SVG and PNG images inherit the same colours, so they meet it too.

| Criterion | What it means here |
|---|---|
| 1.4.3 Contrast (minimum) | Text at least 4.5:1 against what it sits on: node labels on node, decision, start, end and swatch fills; edge labels on their pill and on lane tints; toolbar, menus, notes and badges. Large text (24px, or 18.66px bold) at least 3:1. |
| 1.4.11 Non-text contrast | At least 3:1 for what is needed to understand the diagram or use a control: node outlines, edges and arrowheads, swatch lines and dots, frame borders, icon strokes, input borders, the focus ring, toggles. Each against every background it can appear on (page, panel, lane tints). |
| 1.4.1 Use of colour | Colour is never the only cue. Swatch meaning comes with `colorKey`; the edge in/out highlight must also differ by something other than hue (line width or dash; to be checked against today's rendering); errors and the unsaved state carry text. |
| 2.4.7 and 2.4.11 Focus visible, not obscured | Every focusable control shows a ring from `--focus-ring` (new token); the dock and drawers never cover the focused element. |
| 2.5.8 Target size (minimum) | Pointer targets at least 24 x 24 px, or spaced so a 24 px circle fits. The note delete and small toolbar buttons are checked. |
| 1.4.4, 1.4.10, 1.4.12 Resize, reflow, text spacing | The toolbar works at 200% zoom and with WCAG text-spacing overrides; text styles use unitless line heights. |
| Not WCAG, adopted | `prefers-reduced-motion` turns off transitions (`motion.ease` becomes `0s`); `forced-colors: active` keeps outlines, edges and focus visible using system colours; `prefers-contrast: more` swaps in a high-contrast token set derived from the theme. |

The token file declares the required pairs in `contrast`: a list of `[foreground, background, minimum]`, with palette pairs written once per role (`["sw-*-ink", "sw-*-fill", 4.5]`) and expanded for every slot and both modes. `dev/check_contrast.py` computes each ratio from the merged token file (WCAG relative luminance; a translucent colour is first blended over its background). It fails with the pair, mode, ratio and minimum. It runs in the dev checks for the default theme and every theme fixture, and inside `extract_tokens.py --complete`.

Contrast between token pairs does not cover everything the page draws: overlays, text over hatching, export rendering. So `render_screenshot.py --report` also runs axe-core (pinned dev-only dependency) on the rendered page in both modes and reports any violation. Axe does not judge SVG strokes, which the pair list covers.

`type.fitMin` (9px today) is not a WCAG failure, but text that small hurts readability: shrink-to-fit stops at `fitMin`, and the audit warns about any label that needed it.

### How a theme reaches the page

`assemble_page()` gains a `theme` argument. It merges the theme over `default.json`, then fills two new placeholders in `shell.html`:

- `{{TOKENS_CSS}}`, before `{{SHELL_CSS}}`: the `:root` and `:root[data-theme="dark"]` blocks, generated from `color`, `type`, `icon`, `radius`, `shadow`, `motion` and `font`, plus the `.t-*` text-style classes.
- `{{TOKENS_JS}}`, before the engines: `const TOKENS = {...}` with `palette`, `font.metrics`, `type.fitMin` and `icon`, plus `const ICONS = {...}` (the icon registry, Phase 4). `SWATCHES`, the engines' `CHAR_W` constants and the shrink-to-fit code read from it.

The font `<link>` is filled from `font.href` (omitted when empty). The theme is baked into the saved page, so Save, artifact republish and `--extract` keep it. The data block records `"theme": "<name>"` so the agent knows which theme a page uses when it re-lays it out.

The engine also runs without the page, so `TOKENS` must reach it in all three places it runs, or the layout and the page would measure text differently:

- **In the page**, `{{TOKENS_JS}}` sits before `{{SHELL_JS}}` in `shell.html` (the shell builds `SWATCHES` from it at start-up), outside the `//@engine-begin` / `//@engine-end` markers. The ERD Web Worker, which is built from the source between those markers, gets `const TOKENS = ...;` prepended by `erd.js`.
- **`run_engine.mjs` (Node)** takes the merged token JSON as a second argument and defines `TOKENS` before evaluating `engine.js`. `engine_runner.py` passes it.
- **The headless Chrome fallback** in `engine_runner.py` gets the same `TOKENS` definition before the engine.

The theme itself is stored in the page, as `<script id="diagram-theme" type="application/json">` right after the `diagram-data` block's end comment, so a page re-laid out on another machine keeps its look. `--extract` can write it out (`--extract-theme`). It sits outside the line range the agent reading guide points to, so reading a diagram costs no extra tokens.

Each theme file carries `"tokensVersion": 1`; the loader refuses an unknown version.

Theme lookup, first match wins: `--theme <file>`, then the theme stored in the page being updated, then `.ultimate-diagram/theme.json` in the current project, then `default.json`. A page saved before this work has no stored theme and so takes the project theme on its next re-layout; the agent says so in its report. Decided 2026-11-15: old pages adopt the project theme, rather than keeping the default look until asked.

The Python audits load the same merged token file for `font.metrics`, which removes the hand-copied constants.

## Phases

### Phase 1: One token file

1. Create `assets/tokens/default.json` from every `:root` block in `shell.css`, `erd.css`, `flowchart.css` and `sequence.css`.
2. Add `{{TOKENS_CSS}}` to `shell.html` and generate it in `assemble_page()`. Delete the `:root` blocks from the CSS files.
3. Replace literal colours with tokens: `#ffffff` on danger becomes `var(--on-danger)`, `#0b1220` becomes `var(--on-primary)`, the toggle knob becomes `var(--toggle-knob)`, the `var(--lane-color, #e2e8f0)` fallback becomes `var(--lane-color, var(--bg-soft))`, `--erd-key` becomes `var(--decision-accent)`, and the sequence frame tints become the `strong` tone of the matching palette slots (Phase 5 moves the data model).
4. Replace the run-time swatch derivation in `shell.css:602-645` with the fixed `--sw-<n>-*` roles generated from the palette. For the default theme the generated values start from what the OKLCH path renders today in Chrome, so the page looks the same. A custom hex that matches no slot (allowed on load, Phase 5) keeps today's run-time derivation as its only path, and the audit warns that its contrast is not checked.
5. Add `dev/check_contrast.py` with the AA pair list. Fix any default token that fails, and list each fix in the commit message: this is the one visible change allowed in Phase 1.
6. Add `dev/check_tokens.py`: it fails on any hex, `rgb(`, `rgba(`, `hsl(` or `font-family` literal in `assets/shell/*.css|js` and `assets/types/**/*.css|js`, and on any `--name:` declaration outside generated token CSS (runtime `style.setProperty` for geometry such as `--pill-x` is allowed).
7. Exit check: `check_golden.py` and `check_contrast.py` pass, and the generated pages render the same as before (screenshot diff of every fixture in both themes) apart from the listed contrast fixes.

As built (2026-11-15):

- Each palette entry holds `hex` (the hex saved in diagram data today, slots 1 to 8) and, per mode, `soft` (fill), `strong` (line), `ink`, `solid` and `on-solid`. Default values were measured in Chromium from the old OKLCH derivation. `tokens.py` emits `--sw-<n>-*` per mode and one `[data-sw="n"]` rule per slot mapping the old role names (`--sw-stripe`, `--sw-line`, `--sw-pill-*`, `--sw-on-solid`) to them. `setSwatch(el, hex)` in `shell.js` sets `data-sw` for a known hex; any other hex keeps the run-time derivation (`:not([data-sw])`).
- `--sw-stripe` is the slot's line colour, so light-mode stripes are darker than before (slots 3 and 7 were below 3:1). Decided 2026-11-15: kept for all slots, for consistency.
- Sequence frame tints read the matching slot's line colour, and are now mode-aware.
- Contrast fixes: light `connector` `#94a3b8` to `#8493a8`; `focus-ring` becomes `var(--primary)` in both modes; dark `on-danger` `#1a1a1a`; the flowchart insert-hint pill uses `--on-primary`.
- Shadows became 30 `--shadow-*` tokens (identical values merged, no visual change); Phase 2 folds them into a scale.
- Not yet converted: the flowchart lane icon chip and `.erd-head` still mix `--lane-color` / `--sw-stripe` at run time and are not covered by contrast pairs; `scripts/audit_erd.py` and `audit_sequence.py` keep their own swatch hex lists.
- Known: 3 of 15 `e2e_notes` checks fail identically before Phase 1 (note tile drag highlight, Shift+click link, link-handle drag).

Decided (2026-11-15): the sequence note drops its yellow look. All types use one note style (`--note-*`), so the note is one component.

### Phase 2: Typography and scale tokens

1. Classify every text rule in the CSS by role (title, label, detail, caption, overline, code, control) and replace its literal `font-size`, `font-weight`, `line-height` and `letter-spacing` with the matching text style (`.t-*` class or `--t-*` properties). Convert all sizes to px steps of `type.size`; `0.8125rem` and `13px` become the same step, and one-offs (9.5px, 10.5px, 11.5px, 0.78rem, ...) snap to the nearest step.
2. Give ERD column types and other code-like text the `code` style, so they use the mono family.
3. The shrink-to-fit code in `flowchart.js` and `erd.js` reads its base size from the computed style (as it already does for the flowchart) and its minimum from `TOKENS.type.fitMin`.
4. Replace literal radii and shadows with `var(--radius-*)` and `var(--shadow-*)`, snapping near-duplicates the same way.
5. Record each snap in the commit message.
6. Exit check: `check_tokens.py` also fails on literal `font-size`, `font-weight`, `line-height`, `letter-spacing`, `border-radius` and `box-shadow` values. Screenshot diffs are reviewed by eye; small changes from snapping are expected and listed. Snapping diagram label sizes changes text width, so goldens are re-checked here and Phase 6 metrics must match the final sizes.

As built, typography (2026-11-15):

- Scale `2xs` 10, `xs` 11, `sm` 12, `md` 13, `lg` 14, `xl` 16, `2xl` 18 px (`lg` is 14 because every diagram title is 14px). Seven text styles as `--t-<style>-*`; `.t-*` classes are generated but not yet used in markup. `type.lineBox` holds px line heights that size a box (`--line-<n>`). `--font-family` became `--font-ui` / `--font-diagram` / `--font-mono`.
- Diagram text sizes are unchanged, so goldens did not move. UI chrome snapped (buttons 13.6 to 14px, title 17.6 to 18px, zoom 12.8 to 13px, ERD badges 9.5/10.5/11.5 to 10/10/12px). Flowchart line heights 1.22, 1.15, 1.3 became 1.2, 1.2, 1.25.
- ERD column types use the `code` style: 11px mono, which matches `ER.TYPE_CHAR_W` 6.6 exactly in Chrome's `monospace` (12px would overflow).
- `type.fitMin` 11px is the flowchart shrink-to-fit floor (unchanged); `type.fitMinOverview` 9px is the ERD zoomed-out overview floor (unchanged).

As built, radius and shadow (2026-11-15):

- Radius scale `xs` 3, `sm` 4, `md` 6, `lg` 8 (nodes, cards, canvases), `xl` 10, `2xl` 12, `pill` 999, `round` 50%, as `--radius-*`. Multi-corner values keep their zeros (`var(--radius-lg) var(--radius-lg) 0 0`); the notes' `3px 8px 8px 3px` and the sequence frame tab `4px 12px 4px 4px` are exact. Snaps: 2 to 3 (drop lines), 5 to 6 (chevrons, sequence handles), 9 to 8 (lane icon chip), 14 to 12 (dock popover). 11, 13, 18 and 28 became `pill`: each is half the element's fixed height or width (add-branch chip 22, frame summary 26, rail 36 wide, actor 56 high), so the drawn corner is identical. The sequence note's 10px fold corner stays exact, hence `xl`.
- Shadow scale `sm` (resting cards, nodes, labels), `chip` (small floating controls: ports, handles, note buttons, lane tools), `md` (hover, action bars, hints), `lg` (menus, popovers, drawer, drag), `xl` (dialogs, drag ghosts, expanded card), plus `canvas`, `band` (the sequence pinned header, a one-sided shadow), `knob` (switch knob) and `ring` (selection ring, `0 0 0 3px var(--primary-ring)`). `sm` to `xl` are single layer so `filter: drop-shadow(var(--shadow-md))` works. No shadow differs by mode, so there is no `shadow.dark`; `ring` follows the mode through `--primary-ring`. `tokens.py` requires every `var(--x)` in a shadow to name a colour token.
- Rings whose colour is set by the rule (selection, relationship highlight, glow) keep the colour in the rule and take only geometry from tokens: `size.ring-thin|md|lg` (1.5, 2, 3px) and `ring-fill` (100px, the inset tint), `shadow.glow` (`0 2px 8px`) and `shadow.glow-tight` (`0 0 4px`, for `drop-shadow`), e.g. `box-shadow: var(--shadow-glow) var(--edge-in-glow)`. The ERD overview ring `2.5px * var(--inv)` became `var(--ring-md) * var(--inv)`.
- `check_tokens.py` now reads a bare `0`, `var()` and `color-mix()` as non-literal in radius and shadow values, and checks `filter: drop-shadow(...)`. Two pulse keyframes (10px and 18px extents) carry `tokens-ok`.
- Left: SVG `rx` on drawn shapes (sequence fragment box 6, activation bar 2, classic subprocess 2, icons) stays in the renderers; an SVG attribute cannot take `var()` and the engines and exports read those numbers.

### Phase 3: Shared components

Create `assets/components/` with one CSS file per component, assembled after the token CSS and before the type CSS. Each component uses tokens only and has no type prefix.

| Component | Replaces | Used by |
|---|---|---|
| `button` (`.btn`, `.btn-icon`, `.btn-primary`, `.btn-success`, `.btn-danger`) | the button rules in `shell.css`, the three `*-confirm-delete` and three delete-on-hover rules | all |
| `popover` (confirm and menus) | lane, ERD and sequence confirm popovers, `export-menu` | all |
| `note` (card, leader line, delete button) | `.note-*`, `.erd-note-*`, `.seq-note*` | all |
| `badge`, `toast`, `hint` | the rules in `shell.css` | shell |
| `swatch` (dot, picker, `.swatch-scope` shades) | the swatch rules in `shell.css` and the type files | all |
| `edge` (path, arrowhead markers, label pill, in/out highlight) | the edge rules in `flowchart.css`, `sequence.css` and `erd.css` | all |
| `frame` (titled group box) | swimlane header, sequence fragment, any future group | flowchart, sequence |
| `dock` and `toggle` | the dock and switch rules in `shell.css` and `flowchart.css` | shell |

What stays in a type folder: shapes and parts only that type draws (decision diamond, lifeline, table rows, crow's-foot glyphs). They still use tokens only, enforced by `check_tokens.py`.

Shared markup: components that have markup (confirm popover, note card, swatch picker) get a small builder in `shell.js` (for example `ui.confirm(anchor, text, onYes)`, `ui.note(...)`), and the three type copies call it. No framework or template engine.

Exit check: the e2e suites (`e2e_notes`, `e2e_erd`, `e2e_sequence`, `e2e_shell`, `e2e_connectors`, `e2e_multiselect`, `e2e_touch`, `e2e_shapes`) pass unchanged except for selector renames, and `dev/architecture.md` lists the components and the rule that a new type uses them.

As built, shared components (2026-11-15):

- `assets/components/` holds `dock`, `badge`, `button`, `toggle`, `toast`, `hint`, `popover`, `note`, `swatch`, `edge` and `frame`, joined by `components_css()` in `COMPONENTS` order into `{{COMPONENTS_CSS}}` (after `{{TOKENS_CSS}}`, before `{{SHELL_CSS}}`; `--target artifact` takes it from the same template). The order matters in two places: `dock` before `button` (`.toolbar-center .btn` and `.btn:disabled` weigh the same, and the disabled look wins) and `toggle` after both. `check_tokens.py` scans the folder too. `dev/architecture.md` lists the components and the rule for a new type.
- Builders in `shell.js`, as `ui`: `ui.confirm(anchor, { message, title?, label, ok? }, onYes)` with `ui.closeConfirm()` and `ui.isConfirmOpen()`, and `ui.noteCard(note, { onDelete, onLink, linkTitle, onCommit, onInput })`. The three confirm popovers (`.lane-confirm`, `.erd-confirm`, `.seq-confirm`) are one `.confirm`; the flowchart and ER note cards are built by `ui.noteCard`, and the sequence card is `ui.noteCard` without tools.
- Renames, with the e2e selectors updated and no check weakened: `.flow-note`, `.erd-note`, `.seq-note` to `.note` (and their `-text`, `-leader`, `-del`, `-link`, `-badge`, `-add` parts, `erd-note-linking` and `erd-note-picking` to `note-linking` and `note-picking`); `*-confirm-delete` to `.confirm-ok` (a `.btn-danger`), `*-confirm-cancel`, `-msg`, `-title`, `-actions` to `.confirm-*`; `.connector-path` and `.erd-rel-line` to `.edge-line`, `.connector-hit` and `.erd-rel-hit` to `.edge-hit`, `.edge-label-container` and `.erd-rel-label` to `.edge-label`; `.seq-frag-label`, `-chev`, `-summary` to `.frame-tag`, `.frame-chev`, `.frame-summary`; `.erd-hint`, `.seq-hint` to `.hint` (the flowchart's note and connector prompts to `.hint.hint-note`, keeping `.note-pick-hint` and `.connector-pick-hint` as the tests' handles); `.export-wrap`, `.export-menu`, `.export-menu-label` to `.menu-wrap`, `.menu`, `.menu-label`; `.erd-mode` to `.btn-count`. `.erd-toggle` and `.seq-toggle` are gone: every `.btn[aria-pressed="true"]` is a pressed toggle. The notes layers carry `.note-layer` next to their ids.
- Delete on hover: `.btn-danger-hover` (note and lane delete chips) and `.btn-danger` (the confirm button) replace the three copies of each.
- Visible changes where unifying duplicates required it: the sequence note takes the shared card (3px accent edge on the left, the same corner shape, slate selection ring instead of the blue one); its padding keeps the text area the engine measured. The count badge in a dock button uses 4px side padding in both types (ER had 5px, so its dock is a few px narrower). Hints share one look (the sequence and ER prompts lost nothing; the sequence prompt no longer takes the pointer). Everything else is pixel-identical in the screenshot comparison (light and dark, including an open export menu, a confirm bubble in each type, notes shown and selected).
- Not shared, on purpose: the flowchart lane pill (its colours come from the swatch roles; a frame tag is a neutral tab), the in/out/hover colours of an edge line (the ER line also swaps its markers and the flowchart colours the path itself), the action bars of ER and sequence (`.erd-ab-btn`, `.seq-ab-btn`, different sizes and weights) and the sequence fragment swatches (Phase 5 replaces them with palette slots).

### Phase 4: Iconography

1. Create `assets/icons/default.json`: one registry of every icon, keyed by a stable name (`trash`, `close`, `plus`, `chevron-down`, `link`, `note`, `undo`, `redo`, `save`, `export`, `tidy`, ...). It merges the flowchart lane icons (`assets/types/flowchart/icons.json`, whose names stay the same because `lane.icon` stores them in saved diagrams) with every inline icon found in the review, each drawn once. Each entry holds only the inner SVG elements on a 24 x 24 grid, as `icons.json` does today.
2. One renderer, `ui.icon(name, { size, fine })` in `shell.js`, builds the `<svg>` from the registry and the `icon` tokens: `viewBox="0 0 24 24"`, `width`/`height` from `icon.size`, `stroke-width` from `icon.stroke` (or `icon.strokeFine` for the dense toolbar icons that use 1.75 today), linecap and linejoin from the tokens, `stroke="currentColor"`, `aria-hidden="true"`. Colour always comes from the text colour, so icons follow the colour tokens.
3. HTML templates (`shell.html`, `toolbar.html`, `stage.html`, `chrome.html`) use a placeholder, `{{icon:trash}}` or `{{icon:trash:sm}}`, which `assemble_page()` expands at build time, so the page has no extra startup work. The JS files call `ui.icon(...)` instead of pasting markup.
4. `layout_engine.py` injects the registry as `ICONS` for all types (replacing the flowchart-only `TYPE_ICONS`). The lane-icon validation at `layout_engine.py:406` reads the shared registry. The lane icon table in `references/types/flowchart.md` stays the agent's menu (the "Use for" column is guidance the registry does not hold), and `check_tokens.py` fails if a name in that table is missing from the registry. A brand icon set must cover these 25 names or they fall back to the default drawings.
5. Type header icons (`icon.html`) become registry entries too (`type-flowchart`, `type-sequence`, `type-erd`), so a future type adds one entry instead of a file.
6. A brand theme may set `icon.set` to another registry file with the same names. A name missing from that set falls back to the default set, so nothing disappears.
7. Licence: confirm the source of the drawings and add the attribution (for Lucide, the ISC notice) to the registry file and `README.md`.
8. Exit check: `check_tokens.py` also fails on any `<svg` literal in `assets/shell` and `assets/types` outside the registry, and on any icon name used in a template or `ui.icon` call that is not in the registry. Toolbar screenshots are unchanged except where stroke widths were unified on purpose; the e2e suites pass.

As built, iconography (2026-11-15):

- `assets/icons/default.json` is `{"_license": ..., "icons": {name: inner SVG}}` with 85 entries: the 25 lane icons under their old names (saved diagrams keep working), the toolbar, action-bar, chip and dock icons, the three type icons (`type-flowchart`, `type-sequence`, `type-erd`, so `icon.html` and `assets/types/flowchart/icons.json` are gone), the flowchart shape tiles (`shape-*`) and the sequence participant kinds (`kind-*`). Each drawing exists once: the trash can was drawn three ways and is one, the plus, chevron, close and note-lines chips are shared by the three types.
- Tokens: `icon` in `default.json` holds `set`, `size` (`xs` 10, `sm` 12, `md` 14, `lg` 18, `xl` 22, `tile` 32 px, also `--icon-<name>`), `stroke` 2, `strokeFine` 1.75 (the 32 px tiles), `strokeBold` 2.5 (icons of 12 px or less) and round `cap` and `join`. `scripts/tokens.py` validates them, loads the registry (`load_icons`: a set other than `default` overrides names and falls back to the default for the rest, and only self-closing shape elements with a short attribute list are accepted), and writes `TOKENS.icon` and `const ICONS` into `{{TOKENS_JS}}`; `TYPE_ICONS` is gone.
- Templates write `{{icon:name}}`, `{{icon:name:size}}` or `{{icon:name:size:fine|bold}}`; `assemble_page()` expands them in the shell template and in every type's toolbar, stage, chrome and help file (`expand_icons`), and builds the header icon from `type-<type>`. Scripts call `ui.icon(name, { size, fine, bold, class })` or `ui.iconEl(...)` in `shell.js`. `ui.noteCard` draws its own delete and link chips. The lane-icon warning in `layout_engine.py` accepts any registry name and lists the flowchart reference's "Lane icons" table (read from `references/types/flowchart.md`) as the menu.
- Not icons, left where they are: the diagram's own drawing (shape outlines, the ER crow's-foot glyphs, the stage SVG roots) and the SVG export strings in `shell.js`.
- `check_tokens.py --phase 4` now flags only an inline `<svg` on the icon grid (`viewBox="0 0 24 24"`), plus `icon-name` (a placeholder or a `ui.icon` call naming something the registry lacks) and `lane-icon`; its help text explains the rule and `--self-test` covers it. It reports 0.
- Visible changes where strokes and sizes were unified on purpose: the note chips and the collapse and focus chips (10 to 13 px, stroke 2.4 to 3) are 10 or 12 px at stroke 2.5; the ER key and link glyphs 2.4 to 2.5; the lane delete chip (2.2) and the Split chip (2.25) 2; the ER and sequence action-bar trash gains the two inner bars the toolbar trash has. Every other icon is the same drawing at the same size.
- Licence: confirmed Lucide. 18 drawings are identical, element for element, to `lucide-static`: 16 to 0.263.0 (user, users, code, cloud, shield, banknote, mail, cart, download, save, minus, plus, x, moon, link, chevron-down) and 2 to 1.73.0 (truck, wand); the other lane and toolbar icons are the same designs under older or hand-compacted path text. Some Lucide icons derive from Feather (MIT), so `assets/icons/LICENSE` carries both notices, the registry has a `_license` key, and `README.md` has a Credits section. The type icons, the shape tiles, the participant-kind glyphs and a few toolbar icons were drawn for this skill and are said to be so.
- Left for later phases: a theme's `icon.set` file and the extractor's icon-set detection (Phase 7) use the loader above but no second registry ships yet.

### Phase 5: Palette slots in the data model

1. Diagram JSON stores a slot (`"color": "3"`) instead of a hex. The renderer maps the slot to the theme's palette.
2. `colorKey` is keyed by slot (`{ "1": "Our services" }`). Old hex keys are converted the same way as `color`.
3. Sequence fragments use the same slots and draw with the slot's `strong` tone (border, tag) and a light wash of it (fill); lanes, participants and tables draw with the `soft` tone. Old fragment names map to slots: `blue` to the sky slot, `green` to emerald, `yellow` to amber, `red` to rose, `purple` to purple, `gray` to the neutral slot `9`. The separate fragment tint list goes away.
4. Lane `color` in `flowchart.md:27` becomes a slot. A custom hex is still accepted on load, but the reference no longer tells the agent to copy colours from the source: with a brand theme, the palette already carries the brand colours.
5. Loading still accepts the old hex: a hex that matches a default swatch maps to its slot, any other hex is kept as a custom colour and drawn as is (today the sequence renderer drops it, which this fixes).
6. `disk_format.py` writes slots. `references/types/flowchart.md`, `sequence.md` and `erd.md` and the examples use slots; `sequence.md:46` stops listing hex values and says "slot `1`..`8`, the theme's palette".
7. Exit check: every existing fixture and sample loads with the same colours and the same colour legend; a fixture with old hex values round-trips through Save to slots.

Decided (2026-11-15): slot ids are `"1"`..`"8"`, because brand palettes have no fixed hue names. The current names (`sky`, `amber`, ...) stay only as labels of the default palette.

As built (2026-11-15):

- Data model: lane, participant, ERD table and sequence fragment `color` and every `colorKey` key are a slot (`"1"`..`"9"`; `"9"` is the neutral grey, used by frames) or a custom hex. `schemaVersion` is not bumped: old pages stay readable and are rewritten with slots on the next save, so no reader is stranded by a number.
- Migration, on read and on write (`color_slot()` in `scripts/disk_format.py`, `colorSlot()` in `assets/shell/shell.js`, one codec per type in both): a slot stays; a palette `hex` (case-insensitive) becomes its slot; an old frame name becomes the slot found by name in `default.json` (`blue` sky `1`, `yellow` amber `2`, `green` emerald `3`, `red` rose `4`, `purple` `5`, `gray` neutral `9`); any other hex is kept unchanged and drawn with the run-time derivation. `colorKey` keys convert the same way (a slot key already there wins over an old hex key) and are listed integer-like keys first, as JavaScript does, so the page and Python write the same bytes. Python reads through `from_disk`/`to_disk`; the audits and the flowchart check read raw authoring JSON, so they map with the same helper instead of assuming the codec ran. ERD v1/v2 group colours go through the same step.
- Renderers: `setSwatch(el, slot-or-hex)` sets `data-sw` from the slot and `--swatch-color` to the slot's `hex` (slots 1-8), which the lane chip and ERD head still mix; the picker (`swatchRow`) takes and gives slots. `swatchSlot()`, `paletteOf()` and `slotColors()` are new shell helpers. Sequence frames use `setSwatch` too: `FRAG_COLORS`, the `.seq-tint-*` classes and `--seq-tint` are gone, a frame reads `--sw-line` from its slot, and the frame picker lists all nine slots. A custom hex on a participant or frame is now drawn, not dropped. The flowchart engine's default lane is slot `"1"` (one `engine.js` line, no `tokens-ok` needed).
- Audits: `audit_sequence.py`, `audit_erd.py` and the flowchart audit (`FlowchartAudit._lane_color_warnings`) validate against `default.json` through `tokens.load_tokens`; their own hex lists are gone. A slot is valid, an old palette hex or frame name is accepted, a custom hex warns "its contrast is not checked", anything else is an error (sequence, ERD) or a warning (flowchart lanes, which never had an error for colour).
- References: `flowchart.md` (lane `color`: a slot, never copy source colours), `sequence.md`, `erd.md` and `references/examples/example-erd.json` use slots. Fixtures and goldens stay in the old format on purpose: they prove the migration, and `dev/check_golden.py` now checks that saving any fixture writes only slots and reads back the same (`color_problems`). Only `dev/fixtures/flowchart/golden/no-swimlanes.json` changed (its engine-made lane is `"1"`, was `#e0f2fe`). Round trips with old hex in and slots out are also in `dev/test_audit_sequence.py` and `dev/test_audit_erd.py`, and `e2e_erd.mjs` opens a v2 page with hex group colours.
- Light and dark screenshots of the loan application, five lanes, sequence colours (participants and frames), checkout, `saas-billing` and `two-clusters` are byte-identical to before.

### Phase 6: Font metrics from tokens

1. Engines read `TOKENS.font.metrics` instead of their literal `CHAR_W` values, in all three run contexts (page and worker, Node, headless Chrome; see How a theme reaches the page); the flowchart's label-width estimates do the same. The audits read the same values from the merged token file.
2. Add `scripts/measure_font.py`: it opens headless Chrome (as `render_screenshot.py` does), loads the theme's font, measures the average width of a representative English sample at each engine size, and writes `font.metrics`. Theme creation (Phase 7) runs it automatically.
3. Exit check: with the default theme the measured metrics equal today's constants (within 0.1 px) and goldens are unchanged; with a wide test font (for example a monospace theme) every fixture passes the audits with no label overflow.

As built (2026-11-15):

- `font.metrics` stays a flat map of numbers (average character width in px); the mapping from key to text style lives in `METRICS` in `scripts/measure_font.py`, with the engine constants each key feeds. Keys: `label` (13px, sequence message label `SQ.CHAR_W`, ER column names `ER.CHAR_W`, flowchart longest word), `title` (14px bold, new: ER table name in the header, `ER.TITLE_CHAR_W`), `detail` (12px, `SQ.DETAIL_CHAR_W`), `note` (12px, `SQ.NOTE_CHAR_W`), `type` (11px mono, `ER.TYPE_CHAR_W`), `edgeLabel` (12px, ER relationship label `ER.LABEL_CHAR_W` and the flowchart one-line label box), `edgeWrap` (13px, new: the flowchart `* 6.6` that decides when an edge label wraps; it had the same number as `type` by chance). `SQ.NUM_W` (26, the step-number badge) is geometry, not text width, and stays in the engine and the audit.
- The old constants are not plain averages: today's values sit 10 to 25 percent above the measured mean (Nunito Sans at the real sizes, 111 characters of typical labels: 6.04 at 13px, 6.76 at 14px bold, 5.58 at 12px, 6.62 at 11px mono), and they differ between keys of the same size (detail 6.4, note 6.2, edgeLabel 7). No one sample text reproduces them, so each key carries a headroom factor in `METRICS` (label 1.22, title 1.1, detail 1.15, note 1.11, type 1.0, edgeLabel 1.25, edgeWrap 1.09) and the stored metric is the measured mean times it, rounded to 0.1. With the default theme this gives exactly 7.4, 7.4, 6.4, 6.2, 6.6, 7.0, 6.6, so goldens are unchanged. A wide font scales every estimate with its own width.
- `measure_font.py` fetches `font.href` itself and hands the font files to Chrome inline (Chrome needs no network), then measures with canvas `measureText` over DevTools (a 60-line stdlib websocket client; `--dump-dom` is not used because it hangs in some sandboxes). `--theme f --write` updates `font.metrics` of `f`; `--check` exits 1 when a stored value is off by more than 0.1 px, and `--write` and `--check` exit 2 when the font did not load (a missing family or a failed fetch), so fallback widths are never stored.
- TOKENS reaches each context as the same object (`tokens.tokens_data`): the page defines it before the shell, the ERD worker gets a copy prepended by `erd.js`, `run_engine.mjs` reads `{"tokens": ..., "diagram": ...}` on stdin and passes `TOKENS` to the engine as a function parameter, and the Chrome fallback loads a page built by `scaffold_html(..., tokens=)`, which already defines `TOKENS` before the engine. `run_layout(..., tokens=)` and `assemble_page(..., tokens=)` take the merged set. The engines have no literal fallback: without `TOKENS` they throw.
- Audits: `audit_sequence.py` reads `font.metrics` (`SequenceAudit(data, metrics)`; the default theme when omitted) and `layout_engine.make_audit` passes the theme's. `audit_erd.py` had `CHAR_W` and `TYPE_CHAR_W` that nothing read; they are gone. `--theme <file>` on `layout_engine.py` (`--layout` and `--verify`) merges the theme for the page, the engine run and the audit; lookup beyond `--theme` is Phase 7.
- Result with Nunito Sans: `measure_font.py --check` passes, goldens and sample pages produce the same layouts (the sample pages differ only by the engine source embedded in them).
- Wide test: `dev/fixtures/themes/test-wide.json` is DejaVu Sans (label 8.3, title 9.1, detail 7.2, note 7.0, edgeLabel 7.8, edgeWrap 7.4, about 12 percent wider). Every fixture lays out and passes its audit with it, except `erd/saas-billing`, which scores 88 with the default theme too (a curve through a table, already so before Phase 6). `dev/check_overflow.mjs` finds no overflowing label in them, apart from three cases that are not width estimates: a table name at the ERD overview floor (`fitMinOverview`), the classic-shape node text, which is a fixed-size box that shrinks to `fitMin` and then ends in an ellipsis, and the sequence rail names, which the default theme flags the same way. A monospace theme (DejaVu Sans Mono, 28 percent wider) also lays out, but `erd/saas-billing` then has a curve through a table; that is the router, not the metrics.
- Left: widths that are not font metrics (`PAD_X`, `GLYPH_W`, `NUM_W`, the fixed sizes of flowchart nodes and sequence boxes) do not scale with the font. ER column names are measured at the regular weight, though keys are bold.

### Phase 7: Create a theme from a website or brand guide

`scripts/extract_tokens.py` outputs a theme file and a short report.

- **Website (`--url`).** Headless Chrome loads the page and collects: `:root` custom properties; the computed `font-family` of `body` and `h1`..`h3`; the background, text and border colours of `body`, header and main surfaces, weighted by visible area; the colours of primary buttons and links (the primary candidate); the radius and shadow of buttons and cards. It maps them to semantic keys: background to `bg-page` and `bg-panel`, body text to `text-main`, secondary text to `text-muted`, button background to `primary`, and so on. It also matches the font to Google Fonts by name and sets `font.href`.
  - **Typography.** It reads the computed size, weight, line height and letter spacing of `h1`..`h3`, body text, small print, buttons and `code`. It maps them to the text styles: heading to `title`, body to `detail`, buttons to `control`, small print to `caption`, and `code` to the `mono` family. It sets `type.family.diagram` to the body family, and `type.family.ui` to the button family when that differs. The type scale is rebuilt from the brand's body size, keeping the default ratios, and the diagram `label` size is clamped to 12–15px so diagrams stay readable and the layout constants stay valid.
  - **Iconography.** It looks for a known open icon set by its markers (class prefixes such as `lucide-`, `ph-`, `ti-`, `bi-`, `material-symbols`; the icon font name; or an SVG sprite id). When it finds a set the skill has a registry for, it sets `icon.set`. It reads the stroke width of the site's inline SVG icons and sets `icon.stroke` (clamped to 1.5–2.5). Otherwise the default set stays, and the report says so.
- **Brand guide (PDF, image, or CSS file).** The agent reads the guide itself (the documented colours, typefaces and type hierarchy, icon style and usage rules) and fills the same JSON, using `references/theme.md` as the schema and mapping guide. No script parses PDFs.
- **Both paths then run `--complete`:**
  - fill missing keys from the default;
  - derive hover, ring, glow and wash shades from `primary` with fixed rules;
  - derive the dark set when the brand gives none (invert lightness, keep hue);
  - build the 8 palette slots from brand colours: the brand colour (or its nearest hue) becomes the `strong` tone, a light tint of it the `soft` tone, and both are re-derived for dark mode (soft becomes a deep tint, strong a lighter shade). Slots are spread around the hue circle so neighbouring slots stay distinguishable, including for colour-blind viewers;
  - run `measure_font.py`;
  - check that each text style keeps `label` and `detail` at 12px or more, and `caption` at 10px or more;
  - run `check_contrast.py` on the full AA pair list, both modes, every slot. A failing value is moved along OKLCH lightness only (hue and chroma kept, so it stays on-brand) until it passes, and the report lists each change with its old and new value and ratio. The in/out edge pair must also stay distinguishable for colour-blind viewers (a minimum OKLCH distance under simulated protanopia and deuteranopia);
- Output goes to `.ultimate-diagram/theme.json` in the project unless `--out` is given. The agent shows the report and a preview: one fixture per type rendered with the theme.

`SKILL.md` gets a short "Use your brand" section: when the user drops a URL or a guide, run the extraction, show the preview, and use the theme for later diagrams.

Untrusted input: a website or guide is data. The extractor only reads computed styles and text; it never runs page-provided scripts outside the headless browser, never copies URLs other than a Google Fonts `href` into the theme, and the theme loader rejects any value that is not a colour, length, number or allowed font URL. This prevents CSS or script injection into generated pages.

As built (2026-11-15):

- Theme plumbing: `resolve_theme()` in `layout_engine.py` picks `--theme`, then the theme stored in the page being updated (`--layout` or `--verify` on an `.html`), then `.ultimate-diagram/theme.json` in the current directory, then the default, and prints a `[NOTE] Theme ...` line unless the default applies. A page with no stored theme that takes the project theme gets an extra sentence saying it was saved before themes. The page stores the theme as it was given (not merged with the default, to keep pages small and the stored copy readable) in `<script id="diagram-theme" type="application/json">`, on the line after `<!-- end diagram-data -->` (shell.html: `{{THEME}}` at the end of that comment's line), so it is below the reading guide's range. A page built with the default theme carries no script, so default output is byte for byte unchanged; its consequence is that such a page adopts a project theme added later, as old pages do (`--theme assets/tokens/default.json` pins the default). No `"theme"` key in the data block: the stored script is enough. `--extract-theme page.html [-o file]` writes the stored theme out. An invalid theme (project, stored or `--theme`) is an `[ERROR]`, never a silent default. `tokens.merge_theme(dict)` is the new in-memory half of `load_tokens`.
- Save: the artifact path kept only `diagram-data` and our main script from the pristine body; `shell.js` `capturePristineBody()` now also keeps `diagram-theme` (one condition, plus its comment). The file path needs no change: Save rewrites the page text and only replaces the data block. `dev/e2e_theme.mjs` checks both (file download and stubbed artifact publish).
- `scripts/contrast.py` holds the WCAG maths and pair expansion that were in `dev/check_contrast.py` (dev/ is not shipped); the dev script imports it.
- `scripts/measure_font.py` gained `chrome_session()` (a headless Chrome with a `call(method, params)` function); `_chrome_eval` uses it. It dismisses a page's `alert()`, which would otherwise freeze the page.
- `scripts/extract_tokens.py` (stdlib plus Chrome): `--url`, `--from`, `--complete`, `--out`, `--preview DIR`, `--offline`, `--no-measure`, `--self-test`. `--url` runs one collector script in the page (computed styles only; returns colours as numbers, never page text) and maps: canvas to `bg-page`, the largest other surface to `bg-panel`, the heaviest non-link text colour to `text-main`, small or secondary text to `text-muted`, the commonest border to `border-color`, the most saturated filled button to `primary` and `on-primary` (then a primary or brand custom property, then the link colour), accent custom properties and coloured surfaces to `brand.colors`, body font to `font.family` (the page's own fonts.googleapis.com link becomes `font.href`, else Google Fonts is asked and only a 200 answer sets it), button font to `type.family.ui` when different, code font to `type.family.mono`, body size to the scale (x brand body / 16, clamped 0.9 to 1.15), heading weight to `title`, body line height and heading line height to `leading`, card corner radius to a scaled `radius` set (button radius if no card), a single-layer card shadow to `shadow.sm`, SVG stroke width (normalised to 24 units, clamped 1.5 to 2.5) to `icon.stroke`, icon-set markers to the report. A dark site (canvas lightness under 0.45) becomes the dark set and the light set is derived.
- `--complete`: the other mode is derived from each given colour with hue and chroma kept and lightness taken from the default's own value for that key (inverted when it has none); neutral surfaces and lines are an OKLab mix of `bg-page` and `text-main` at the fractions the default itself uses; `primary-hover` (L -0.06 light, +0.10 dark), `primary-ring/glow/wash`, `edge-out` (an alias of `primary`), `banner-*` and `on-primary` follow `primary`; palette slots 1-8 come from the primary, `brand.colors` (neutrals skipped, near-duplicates merged, hues spread by bisecting the largest gap, numbered so neighbours are far apart on the hue circle) with the default palette's own lightness per role; slot 9 stays the default neutral; type sizes are clamped (label 12 to 15 px, detail at least 12, caption at least 10; the steps stay in order); the font is measured. Contrast: every failing pair is repaired by moving one colour along OKLCH lightness (palette tones first, then derived shades, the brand's own last, page background never), and each move is reported with old and new value and both ratios; an unreachable pair is a `[FAIL]` line and exit 1. The in/out edge pair must keep an OKLab distance of at least 0.15 under simulated protanopia and deuteranopia (the default pair measures 0.31); `edge-in` is moved by lightness, and turned to the opposite hue only when no lightness works. The output lists only the keys that differ from the default (a kept light value keeps its dark twin so completing the file again changes nothing).
- Decision, palette `hex`: a brand palette slot's `hex` is a light tint of the slot's own hue, not the default palette's hex. The flowchart lane tint and the lane chip mix `--swatch-color` = the slot's `hex`, so default hex values would leave lanes in default pastels under a brand theme. Old diagrams with default-palette hex still map to the same slot numbers under any theme, because `disk_format.color_slot()` reads `default.json`, and `--layout` migrates to slots before a theme applies; only a page's own JavaScript (`colorSlot`) reads the active palette, and a page always holds slots by then.
- Icon sets: no registry exists in this tree, so `icon.set` is written only when `assets/icons/<set>.json` exists (never yet), and the report names the detected set. `icon.stroke` is written when the site's inline SVG strokes were read. `tokens.py` validates the `icon` group minimally: `icon.set` matches `[a-z0-9-]+`, `icon.stroke` is 1.5 to 2.5. Phase 4's merge must reconcile this with the full `icon` group.
- Untrusted page: the collector returns only numbers and short strings; Python rebuilds colours as hex, accepts font names matching `[A-Za-z0-9][A-Za-z0-9 .-]*`, copies only a `fonts.googleapis.com` href, then everything goes through `tokens.py` validation. Only `http`, `https` and `file` addresses are opened. A page's own scripts run inside the headless browser only (a hostile fixture with `alert()` and bad font names is in the check).
- Tests: `dev/fixtures/themes/site/index.html` (known brand values), `site/hostile.html`, `brand-guide.json`, and `dev/check_extract.py` (extraction table, `--from`, hostile page, lookup order, stored script, artifact shape). `python3 scripts/extract_tokens.py --self-test` covers the maths, completion and validation.
- Known limits: `--preview` renders through `render_screenshot.py`, which timed out in the sandbox used for this work (fixed in Phase 8: it now drives Chrome over DevTools); a page with a stalled third-party stylesheet makes the page read take up to 60 s and then fail; the type scale only follows the brand body size (heading sizes are not mapped); letter-spacing is read for body text only; shadows are only mapped when the card has one layer.

### Phase 8: Contract for future types

- `dev/architecture.md`: the token layers, the component list, the assembly order (tokens, components, shell, type), and the checklist for a new type: no `:root` block, no literal values, reuse components, read `TOKENS.font.metrics` for text widths.
- Typography: a new type gives every piece of text a text style (`.t-*` or `--t-*`) and never sets size, weight, line height or family itself. Text that shrinks to fit uses `TOKENS.type.fitMin`.
- Iconography: a new type adds any icon it needs to the shared registry (with its licence source) and draws it with `{{icon:name}}` or `ui.icon(name)`; it never pastes `<svg>` icon markup. Its header icon is the registry entry `type-<type>`.
- Accessibility: every new colour pair a type draws is added to the `contrast` list; new controls meet the target size and show the focus ring. `check_contrast.py` and the axe-core report must pass for the new type in both modes.
- `check_tokens.py` runs with the other dev checks.
- One extra theme fixture (`dev/fixtures/themes/test-brand.json`: dark-first, wide font, larger type scale, large radii, `icon.stroke` 1.5) is rendered for every type in the screenshot and audit run, so a type that ignores tokens fails visibly.

As built, contract for future types (2026-11-15):

- `dev/architecture.md` has a "Design system" section (layers and assembly order, palette slots, text styles, icons, themes with their lookup order and the scripts) and a "New diagram type checklist" covering every bullet above; the Tests table lists the new checks and "Adding a type" points to the checklist. Statements made stale by Phases 1 to 7 (the font link, the token file description, the script list) were updated.
- `dev/fixtures/themes/test-brand.json` is a completed theme made with `extract_tokens.py --from <partial> --complete`: dark set given (the light set derived), DejaVu Sans, a larger scale (`2xs` 11, `xs` 12, `sm` 13, `md` 14, `xl` 18, `2xl` 20 px), radii 6 to 24 px, `icon.stroke` 1.5, metrics measured. `lg` stays 14 px: it is the diagram text size the engines' fixed node and table geometry assume (at 16 px, labels in fixed-size nodes clamp and ERD table names clip), so a type can grow UI text with a theme but diagram text only as far as the engines' boxes allow.
- `dev/check_themes.py` lays out every fixture under the default theme and every complete theme in `dev/fixtures/themes/` (a theme without `font.metrics`, like `brand-guide.json`, is a partial input and is skipped), prints the score table, runs `check_contrast.py --strict` on each theme and `check_overflow.mjs` on every page. It fails when a theme scores below the default on a fixture, fails contrast, or leaves more overflowing texts than the default on a page; the three known non-width cases (rail names, the classic-shape box, a table name at the ERD overview floor) are not counted. `erd/saas-billing` scores 88 under the default theme and 100 under the two other themes.
- `render_screenshot.py` no longer uses one-shot `--dump-dom` and `--screenshot`: in the sandbox used for this work Chrome never exits in that mode, even for a `data:` page, while DevTools works. It reuses `measure_font.chrome_session()` (navigate, wait for load, read the `render-report` script, `Page.captureScreenshot` at the device scale). `--preview` works again. There is no `--report` flag: the report is the default (`--no-report` skips it). With `node_modules/axe-core/axe.min.js` present it also runs axe-core (WCAG A and AA rules only, not best practices) in light and dark mode and prints each violation as `[WARN]`; otherwise it prints one `[INFO]` line. axe-core 4.11.4 is a pinned `devDependency` (with `package-lock.json`, `node_modules/` ignored by git, not in `files` or the installers' copies).
- Packaging: `package.json` `files`, `scripts/install.py`, `install.sh`, `install.ps1` and `bin/install.js` already ship `assets/` whole and `scripts/*.py`, so tokens, components, icons (with `LICENSE`), the new scripts and `references/theme.md` need no change; a dry install into a temporary folder lays out `references/examples/example-flowchart.json` from the installed copy. `scripts/check_env.py` now lists the new files.
- Not done: `docs/img/*.png` have no generating script in the repo and the default look is unchanged apart from the listed snaps, so they were not regenerated.

## Before implementing

- **Baseline (2026-11-15):** `dev/check_golden.py` passes for every fixture (all `[PASS]`, audits 100/100) and `dev/check_artifact_shape.py` passes. Each phase must keep both green, except for the listed, intended changes.
- **Delivery (not followed: the phases were merged on one branch):** one branch and one pull request per phase, each with its screenshot diffs (both themes) attached.
- **New dependency (done, Phase 8):** axe-core is the first npm dependency. It goes in `devDependencies` at a pinned version and is not shipped (the `files` list in `package.json` already excludes `dev/`). Without it, `render_screenshot.py --report` skips the axe step and says so.
- **Install (checked, Phase 8):** `scripts/install.py` copies `assets/` whole, so the new `assets/tokens`, `assets/components` and `assets/icons` folders ship without changes; check `bin/install.js` and the npm `files` list the same way.
- **Docs and images (docs done, images not regenerated: no script):** after Phases 1, 2 and 5, regenerate `docs/img/*` and `dev/samples/*` with `dev/build_examples.py`, and update `SKILL.md`, `README.md` and `dev/architecture.md`.
- **Out of scope:** the Mermaid copy export ignores themes (Mermaid has its own theming), and print styles are unchanged.

## Order and risk

Phases 1, 3 and 4 are refactors with the default output unchanged (except unified icon strokes) and can ship one at a time. Phase 2 snaps type sizes and so moves pixels and goldens slightly. Phase 5 changes the saved format and needs the migration first. Phase 6 must land after Phase 2 and before any non-default font is allowed, because layout correctness depends on it. Phase 7 depends on 1, 2, 4, 5 and 6.

Main risks:

- Fixing default tokens that fail AA in Phase 1 changes some colours slightly.
- Snapping type sizes in Phase 2 changes pixels slightly and can change label wrapping in goldens.
- Theme values come from untrusted sites, so the loader validates them strictly.
- A brand font missing from Google Fonts falls back to the system stack, and its metrics are measured on that fallback, so layout stays correct but the look differs from the brand.
