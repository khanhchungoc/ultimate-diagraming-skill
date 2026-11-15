# Plan: Design tokens, brand themes and shared components

Every diagram is drawn from one design-token set. The skill ships a default set. A user can point the skill at a website or a brand guide, get a token set in the same shape, and every diagram type (current and future) uses it without code changes. Every visual component is built once, from tokens only, and reused by all types.

**Status:** Phases 1 and 2 done 2026-11-15, Phase 3 done 2026-11-15 (see each phase's "As built"). Phases 4 to 8 not started. Review done 2026-11-15 (findings below). Open decisions for Phases 1 and 5 settled 2026-11-15. Typography and iconography added 2026-11-15.

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
    "metrics": { "label": 7.4, "detail": 6.4, "note": 6.2, "type": 6.6, "edgeLabel": 7 }
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
- Builders in `shell.js`, as `ui`: `ui.confirm(anchor, { message, title?, label, ok? }, onYes)` with `ui.closeConfirm()` and `ui.isConfirmOpen()`, and `ui.noteCard(note, { onDelete, onLink, linkTitle, icons, onCommit, onInput })`. The three confirm popovers (`.lane-confirm`, `.erd-confirm`, `.seq-confirm`) are one `.confirm`; the flowchart and ER note cards are built by `ui.noteCard`, and the sequence card is `ui.noteCard` without tools.
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

### Phase 5: Palette slots in the data model

1. Diagram JSON stores a slot (`"color": "3"`) instead of a hex. The renderer maps the slot to the theme's palette.
2. `colorKey` is keyed by slot (`{ "1": "Our services" }`). Old hex keys are converted the same way as `color`.
3. Sequence fragments use the same slots and draw with the slot's `strong` tone (border, tag) and a light wash of it (fill); lanes, participants and tables draw with the `soft` tone. Old fragment names map to slots: `blue` to the sky slot, `green` to emerald, `yellow` to amber, `red` to rose, `purple` to purple, `gray` to the neutral slot `9`. The separate fragment tint list goes away.
4. Lane `color` in `flowchart.md:27` becomes a slot. A custom hex is still accepted on load, but the reference no longer tells the agent to copy colours from the source: with a brand theme, the palette already carries the brand colours.
5. Loading still accepts the old hex: a hex that matches a default swatch maps to its slot, any other hex is kept as a custom colour and drawn as is (today the sequence renderer drops it, which this fixes).
6. `disk_format.py` writes slots. `references/types/flowchart.md`, `sequence.md` and `erd.md` and the examples use slots; `sequence.md:46` stops listing hex values and says "slot `1`..`8`, the theme's palette".
7. Exit check: every existing fixture and sample loads with the same colours and the same colour legend; a fixture with old hex values round-trips through Save to slots.

Decided (2026-11-15): slot ids are `"1"`..`"8"`, because brand palettes have no fixed hue names. The current names (`sky`, `amber`, ...) stay only as labels of the default palette.

### Phase 6: Font metrics from tokens

1. Engines read `TOKENS.font.metrics` instead of their literal `CHAR_W` values, in all three run contexts (page and worker, Node, headless Chrome; see How a theme reaches the page); the flowchart's label-width estimates do the same. The audits read the same values from the merged token file.
2. Add `scripts/measure_font.py`: it opens headless Chrome (as `render_screenshot.py` does), loads the theme's font, measures the average width of a representative English sample at each engine size, and writes `font.metrics`. Theme creation (Phase 7) runs it automatically.
3. Exit check: with the default theme the measured metrics equal today's constants (within 0.1 px) and goldens are unchanged; with a wide test font (for example a monospace theme) every fixture passes the audits with no label overflow.

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

### Phase 8: Contract for future types

- `dev/architecture.md`: the token layers, the component list, the assembly order (tokens, components, shell, type), and the checklist for a new type: no `:root` block, no literal values, reuse components, read `TOKENS.font.metrics` for text widths.
- Typography: a new type gives every piece of text a text style (`.t-*` or `--t-*`) and never sets size, weight, line height or family itself. Text that shrinks to fit uses `TOKENS.type.fitMin`.
- Iconography: a new type adds any icon it needs to the shared registry (with its licence source) and draws it with `{{icon:name}}` or `ui.icon(name)`; it never pastes `<svg>` icon markup. Its header icon is the registry entry `type-<type>`.
- Accessibility: every new colour pair a type draws is added to the `contrast` list; new controls meet the target size and show the focus ring. `check_contrast.py` and the axe-core report must pass for the new type in both modes.
- `check_tokens.py` runs with the other dev checks.
- One extra theme fixture (`dev/fixtures/themes/test-brand.json`: dark-first, wide font, larger type scale, large radii, `icon.stroke` 1.5) is rendered for every type in the screenshot and audit run, so a type that ignores tokens fails visibly.

## Before implementing

- **Baseline (2026-11-15):** `dev/check_golden.py` passes for every fixture (all `[PASS]`, audits 100/100) and `dev/check_artifact_shape.py` passes. Each phase must keep both green, except for the listed, intended changes.
- **Delivery:** one branch and one pull request per phase, each with its screenshot diffs (both themes) attached.
- **New dependency:** axe-core is the first npm dependency. It goes in `devDependencies` at a pinned version and is not shipped (the `files` list in `package.json` already excludes `dev/`). Without it, `render_screenshot.py --report` skips the axe step and says so.
- **Install:** `scripts/install.py` copies `assets/` whole, so the new `assets/tokens`, `assets/components` and `assets/icons` folders ship without changes; check `bin/install.js` and the npm `files` list the same way.
- **Docs and images:** after Phases 1, 2 and 5, regenerate `docs/img/*` and `dev/samples/*` with `dev/build_examples.py`, and update `SKILL.md`, `README.md` and `dev/architecture.md`.
- **Out of scope:** the Mermaid copy export ignores themes (Mermaid has its own theming), and print styles are unchanged.

## Order and risk

Phases 1, 3 and 4 are refactors with the default output unchanged (except unified icon strokes) and can ship one at a time. Phase 2 snaps type sizes and so moves pixels and goldens slightly. Phase 5 changes the saved format and needs the migration first. Phase 6 must land after Phase 2 and before any non-default font is allowed, because layout correctness depends on it. Phase 7 depends on 1, 2, 4, 5 and 6.

Main risks:

- Fixing default tokens that fail AA in Phase 1 changes some colours slightly.
- Snapping type sizes in Phase 2 changes pixels slightly and can change label wrapping in goldens.
- Theme values come from untrusted sites, so the loader validates them strictly.
- A brand font missing from Google Fonts falls back to the system stack, and its metrics are measured on that fallback, so layout stays correct but the look differs from the brand.
