# Plan: Design tokens, brand themes and shared components

Every diagram is drawn from one design-token set. The skill ships a default set. A user can point the skill at a website or a brand guide, get a token set in the same shape, and every diagram type (current and future) uses it without code changes. Every visual component is built once, from tokens only, and reused by all types.

**Status:** not started. Review done 2026-11-15 (findings below). Open decisions for Phases 1 and 4 settled 2026-11-15.

## Goals

- One token file is the only source of colour, type, size, radius, shadow and motion values. No literal colour or font value anywhere else in `assets/`.
- A brand theme is a second file in the same shape. `layout_engine.py --theme <file>` (or a project-level theme file) bakes it into the page. The default output is unchanged byte for byte.
- A website URL or a brand guide (PDF, image, CSS) can be turned into a valid theme file, checked for contrast and completed with defaults.
- Shared UI and diagram parts (buttons, popovers, notes, badges, swatches, edge labels, markers, frames) live in one place and are used by every type. A new type only adds what is truly specific to it.

## Non-goals

- A visual theme editor inside the page.
- Embedding licensed font files. A brand font is linked from Google Fonts when it is there; otherwise the page uses the brand's fallback stack.
- Changing layout algorithms. Only the constants they read move.
- Per-diagram ad-hoc styling beyond what the model already allows (`color` on lanes, tables and participants).

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
9. **No guard.** Nothing fails when someone adds a literal colour or a new token in a type file, so the drift above will come back.

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
  "size":   { "text-xs": "11px", "text-sm": "12px", "text-md": "13px", "text-lg": "15px" },
  "radius": { "sm": "4px", "md": "8px", "lg": "12px", "pill": "999px" },
  "shadow": { "sm": "...", "md": "...", "lg": "..." },
  "motion": { "ease": "0.15s ease" },
  "palette": [ { "slot": "1", "name": "sky", "light": "#e0f2fe", "dark": "..." }, "... 8 slots" ],
  "color": {
    "light": { "bg-page": "#f8fafc", "primary": "#2563eb", "on-primary": "#ffffff", "note-bg": "#f8fafc", "...": "..." },
    "dark":  { "bg-page": "#0b1220", "primary": "#60a5fa", "on-primary": "#0b1220", "...": "..." }
  }
}
```

- `color.*` keys are the current custom-property names without `--`, merged from all four CSS files, with duplicates collapsed. New semantic keys replace literals: `on-primary`, `on-danger`, `toggle-knob`, `note-*` (one set for all types).
- `font.metrics` are average character widths in px at the sizes the engines use. They are the only numbers the layout reads from the theme.
- `palette` has fixed slots so saved diagrams keep their colours when the theme changes (see Phase 4).

### How a theme reaches the page

`assemble_page()` gains a `theme` argument. It merges the theme over `default.json`, then fills two new placeholders in `shell.html`:

- `{{TOKENS_CSS}}`, before `{{SHELL_CSS}}`: the `:root` and `:root[data-theme="dark"]` blocks, generated from `color`, `size`, `radius`, `shadow`, `motion` and `font`.
- `{{TOKENS_JS}}`, before the engines: `const TOKENS = {...}` with `palette` and `font.metrics`. `SWATCHES` and the engines' `CHAR_W` constants read from it.

The font `<link>` is filled from `font.href` (omitted when empty). The theme is baked into the saved page, so Save, artifact republish and `--extract` keep it. The data block records `"theme": "<name>"` so the agent knows which theme a page uses when it re-lays it out.

Theme lookup, first match wins: `--theme <file>`, then `.ultimate-diagram/theme.json` in the current project, then `default.json`.

The Python audits load the same merged token file for `font.metrics`, which removes the hand-copied constants.

## Phases

### Phase 1: One token file, no visible change

1. Create `assets/tokens/default.json` from every `:root` block in `shell.css`, `erd.css`, `flowchart.css` and `sequence.css`.
2. Add `{{TOKENS_CSS}}` to `shell.html` and generate it in `assemble_page()`. Delete the `:root` blocks from the CSS files.
3. Replace literal colours with tokens: `#ffffff` on danger becomes `var(--on-danger)`, `#0b1220` becomes `var(--on-primary)`, the toggle knob becomes `var(--toggle-knob)`, the `var(--lane-color, #e2e8f0)` fallback becomes `var(--lane-color, var(--bg-soft))`, `--erd-key` becomes `var(--decision-accent)`, and the sequence tints move into `palette`.
4. Add `dev/check_tokens.py`: it fails on any hex, `rgb(`, `rgba(`, `hsl(` or `font-family` literal in `assets/shell/*.css|js` and `assets/types/**/*.css|js`, and on any `--name:` declaration outside generated token CSS (runtime `style.setProperty` for geometry such as `--pill-x` is allowed).
5. Exit check: `check_golden.py` passes and the generated pages render the same as before (screenshot diff of every fixture in both themes).

Decided (2026-11-15): the sequence note drops its yellow look. All types use one note style (`--note-*`), so the note is one component.

### Phase 2: Scale tokens

1. Replace literal font sizes, radii and shadows in all CSS with `var(--text-*)`, `var(--radius-*)` and `var(--shadow-*)`. Snap near-duplicates (for example 7px and 8px radii) to the nearest step, and record each snap in the commit message.
2. Exit check: `check_tokens.py` also fails on literal `font-size`, `border-radius` and `box-shadow` values. Screenshot diffs are reviewed by eye; small changes from snapping are expected and listed.

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

### Phase 4: Palette slots in the data model

1. Diagram JSON stores a slot (`"color": "3"`) instead of a hex. The renderer maps the slot to the theme's palette.
2. Loading still accepts the old hex: a hex that matches a default swatch maps to its slot, any other hex is kept as a custom colour and drawn as is (today the sequence renderer drops it, which this fixes).
3. `disk_format.py` writes slots; `references/types/*.md` and the examples use slots.
4. Exit check: every existing fixture and sample loads with the same colours; a fixture with old hex values round-trips through Save to slots.

Decided (2026-11-15): slot ids are `"1"`..`"8"`, because brand palettes have no fixed hue names. The current names (`sky`, `amber`, ...) stay only as labels of the default palette.

### Phase 5: Font metrics from tokens

1. Engines read `TOKENS.font.metrics` instead of their literal `CHAR_W` values; the flowchart's label-width estimates do the same. The audits read the same values from the merged token file.
2. Add `scripts/measure_font.py`: it opens headless Chrome (as `render_screenshot.py` does), loads the theme's font, measures the average width of a representative English sample at each engine size, and writes `font.metrics`. Theme creation (Phase 6) runs it automatically.
3. Exit check: with the default theme the measured metrics equal today's constants (within 0.1 px) and goldens are unchanged; with a wide test font (for example a monospace theme) every fixture passes the audits with no label overflow.

### Phase 6: Create a theme from a website or brand guide

`scripts/extract_tokens.py` outputs a theme file and a short report.

- **Website (`--url`).** Headless Chrome loads the page and collects: `:root` custom properties; the computed `font-family` of `body` and `h1`..`h3`; the background, text and border colours of `body`, header and main surfaces, weighted by visible area; the colours of primary buttons and links (the primary candidate); the radius and shadow of buttons and cards. It maps them to semantic keys: background to `bg-page` and `bg-panel`, body text to `text-main`, secondary text to `text-muted`, button background to `primary`, and so on. It also matches the font to Google Fonts by name and sets `font.href`.
- **Brand guide (PDF, image, or CSS file).** The agent reads the guide itself (the documented colours, fonts and usage rules) and fills the same JSON, using `references/theme.md` as the schema and mapping guide. No script parses PDFs.
- **Both paths then run `--complete`:**
  - fill missing keys from the default;
  - derive hover, ring, glow and wash shades from `primary` with fixed rules;
  - derive the dark set when the brand gives none (invert lightness, keep hue);
  - build the 8 palette slots from brand colours, as light tints that keep node text readable;
  - run `measure_font.py`;
  - check contrast: text at least 4.5:1, outlines and markers at least 3:1, the in/out edge pair distinguishable for colour-blind viewers. A failing value is darkened or lightened until it passes, and the report lists each change.
- Output goes to `.ultimate-diagram/theme.json` in the project unless `--out` is given. The agent shows the report and a preview: one fixture per type rendered with the theme.

`SKILL.md` gets a short "Use your brand" section: when the user drops a URL or a guide, run the extraction, show the preview, and use the theme for later diagrams.

Untrusted input: a website or guide is data. The extractor only reads computed styles and text; it never runs page-provided scripts outside the headless browser, never copies URLs other than a Google Fonts `href` into the theme, and the theme loader rejects any value that is not a colour, length, number or allowed font URL. This prevents CSS or script injection into generated pages.

### Phase 7: Contract for future types

- `dev/architecture.md`: the token layers, the component list, the assembly order (tokens, components, shell, type), and the checklist for a new type: no `:root` block, no literal values, reuse components, read `TOKENS.font.metrics` for text widths.
- `check_tokens.py` runs with the other dev checks.
- One extra theme fixture (`dev/fixtures/themes/test-brand.json`: dark-first, wide font, large radii) is rendered for every type in the screenshot and audit run, so a type that ignores tokens fails visibly.

## Order and risk

Phases 1 to 3 are pure refactors with the default output unchanged and can ship one at a time. Phase 4 changes the saved format and needs the migration first. Phase 5 must land before any non-default font is allowed, because layout correctness depends on it. Phase 6 depends on 1, 4 and 5.

Main risks:

- Snapping sizes in Phase 2 changes pixels slightly.
- Theme values come from untrusted sites, so the loader validates them strictly.
- A brand font missing from Google Fonts falls back to the system stack, and its metrics are measured on that fallback, so layout stays correct but the look differs from the brand.
