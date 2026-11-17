# Brand themes: schema and mapping guide

A theme is one JSON file in the shape of `assets/tokens/default.json`. Every diagram type reads its colours, fonts, sizes, corners and shadows from it, so a theme restyles all diagrams without touching the diagram JSON. A theme lists only the keys that differ from the default; the loader fills in the rest.

Two ways to get one, then the same finishing step:

| Source | You do | Command |
|---|---|---|
| Website | nothing | `python "<skill-dir>/scripts/extract_tokens.py" --url <site> --complete --preview <scratch>/theme-preview` |
| Brand guide (PDF, image, CSS file) | read the guide, write `partial.json` as described below | `python "<skill-dir>/scripts/extract_tokens.py" --from <scratch>/partial.json --complete --preview <scratch>/theme-preview` |

`--complete` always runs: it fills missing keys, derives shades, builds the palette, measures the font, checks contrast in light and dark, and fixes failures. The result goes to `.ultimate-diagram/theme.json` in the current project (change it with `--out`). Show the user the printed report and the preview images, and keep the theme only if they accept it.

## Workflow

When the user gives a website URL or a brand guide (PDF, image, CSS) and wants diagrams in that look:

1. Website: `python "<skill-dir>/scripts/extract_tokens.py" --url <site> --complete --preview <scratch>/theme-preview`. Brand guide: read it yourself, write the partial theme JSON described below, then `... --from <scratch>/partial.json --complete --preview <scratch>/theme-preview`.
2. Show the user the printed report (every `[FIX]` and `[WARN]`) and the three preview PNGs. Keep the theme only if they accept it; it is saved as `.ultimate-diagram/theme.json` in the project.
3. From then on every `--layout` in that project uses it; pages already saved take it on their next re-layout (the run prints a `[NOTE]`: say so in the report). `--theme <file>` overrides it for one run. Exit 1 from the extractor means a contrast check could not be met: do not use that theme.

---

## Writing `partial.json` from a brand guide

Read the guide yourself. Write only what the guide states; leave everything else out and `--complete` derives it. Colours are `#rrggbb` (or `rgb(r g b)`); never `hsl()`, `oklch()`, `var()` or a colour with transparency in the keys listed under "Needed as opaque colours". A guide's CMYK or Pantone value: convert it to the nearest sRGB hex and say so in your report.

```json
{
  "tokensVersion": 1,
  "name": "acme",
  "font": { "family": "Space Grotesk", "stack": "\"Segoe UI\", sans-serif", "href": "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap" },
  "type": { "family": { "mono": "\"JetBrains Mono\", ui-monospace, monospace" } },
  "radius": { "lg": "12px" },
  "color": { "light": { "bg-page": "#faf7f2", "bg-panel": "#ffffff", "text-main": "#1f2a37", "primary": "#0e7c66" } },
  "brand": { "colors": ["#0e7c66", "#d9480f", "#5b3cc4"] }
}
```

### Which brand fact goes where

| Brand fact | Key | Notes |
|---|---|---|
| Main brand colour (buttons, links) | `color.light.primary` | One colour. Also the first palette slot. |
| Page background | `color.light.bg-page` | A dark brand gives `color.dark` instead; the light set is then derived. |
| Card or panel surface | `color.light.bg-panel` | Omit when the guide has one background. |
| Body text colour | `color.light.text-main` | |
| Secondary text | `color.light.text-muted` | Omit if not stated; it is derived and then contrast-fixed. |
| Border or divider colour | `color.light.border-color` | |
| Text on the brand colour | `color.light.on-primary` | Omit unless the guide fixes it (white or black); otherwise the better contrast is picked. |
| Secondary and accent colours | `brand.colors` (a list, not a token) | Up to 8 become palette slots 1-8, with the primary first. Neutral colours (black, white, greys) are skipped: slot 9 is the neutral. |
| Dark-mode colours | `color.dark.<same keys>` | Only when the guide documents a dark theme. Otherwise derived. |
| Typeface | `font.family`, `font.href` | `href` only for a family on Google Fonts, written as `https://fonts.googleapis.com/css2?...`. Any other URL is refused. A licensed font that is not on Google Fonts: name it in `font.family`, leave `href` empty, and say in your report that the page will use the fallback stack unless the font is installed. |
| Fallback fonts | `font.stack` | Plain family names and generic keywords, comma separated. |
| Heading or UI typeface when it differs from the body | `type.family.ui` | A quoted stack, for example `"\"Poppins\", sans-serif"`. |
| Monospace typeface | `type.family.mono` | |
| Corner radius | `radius.*` | Give the steps the guide implies (`radius.lg` is cards and nodes, default `8px`); the others keep their default. |
| Type scale, weights | `type.size`, `type.styles.<style>.weight` | Rarely needed. Sizes you give are clamped (see below); weights use the names `regular`, `medium`, `semibold`, `bold`. |
| Icon style | `icon.stroke` (1.5 to 2.5), `icon.set` | Only a set that has a registry in `assets/icons/`. Otherwise leave the default set and say so. |

### Needed as opaque colours

`bg-page`, `text-main` and `primary`, in either mode, and every entry of `brand.colors`, must be a plain `#rrggbb` or `rgb()` colour. Everything else may use any value the loader accepts.

### What `--complete` derives (do not write these)

`primary-hover`, `primary-ring`, `primary-glow`, `primary-wash`, `edge-out`, `edge-out-glow`, `banner-*`, `on-primary`; the neutral surfaces and lines (`bg-viewport`, `bg-hover`, `bg-soft`, `border-dark`, `grid-dot`, `text-soft`, `node-*`, `note-*`, ...) as a mix of page background and text colour; the whole dark set when none is given; palette slots 1-8 (soft tint, strong brand colour, ink, solid, and the dark versions); `font.metrics`; text-size clamps (diagram `label` 12 to 15 px, `detail` 12 px or more, `caption` 10 px or more). The status and shape colours (start, end, decision, connector, success, warning, danger) are meaning, not brand, and stay default.

### What to leave out

- Logos, images, gradients, animations, spacing, grid and layout rules.
- URLs other than a Google Fonts `href`. Never paste a CSS `@import` or a font file URL.
- Any colour you guessed. A missing key is derived; a wrong one is shipped.
- Colour names (`red`) or CSS functions other than `rgb()`. Hex is exact.

## What the report shows

Each line starts with a tag: `[MAP]` a value taken from the site or file (with its source), `[DERIVE]` a value computed from another, `[FIX]` a value moved to pass a contrast or colour-blindness check (old and new value with both ratios; only OKLCH lightness moves, so hue stays on brand), `[NOTE]` a decision, `[WARN]` something the user should look at (for example the font did not load, so the default `font.metrics` stay), `[FAIL]` a check that could not be met (the command then exits 1: do not use that theme).

Report to the user: the brand colour that changed most through a `[FIX]` (a pale yellow brand colour becomes olive in diagram lines, for example), the fonts that fall back, and whether the icon set was matched.

## How a theme is used

- `layout_engine.py --layout x.json -o x.html` picks the theme in this order: `--theme <file>`, the theme stored in the page being updated, `.ultimate-diagram/theme.json` in the current directory, the default. The page keeps a copy (`<script id="diagram-theme">` after the data block), so Save, republish and moving the file keep the look.
- A page saved before themes has no stored theme, so it takes the project theme on its next `--layout`. The run prints a `[NOTE]` saying so; mention it in the report.
- `layout_engine.py --extract-theme <page.html> -o theme.json` writes out the theme a page carries.
- Old diagrams that store default-palette hex colours still map to the same slot numbers under any theme: `--layout` migrates them with the default palette before the theme applies.
- `python "<skill-dir>/scripts/measure_font.py" --theme <file> --check` verifies `font.metrics` against the font; add `--write` to refresh them. Exit 2 means the font did not load: the stored metrics are then the defaults, and labels in a wider font may overflow.
