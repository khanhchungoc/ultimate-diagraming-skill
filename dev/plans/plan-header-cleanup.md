# Plan: a quieter header

Status: built (feat/header-cleanup).

## Why

The header's right side has 9 controls: Search, Undo, Redo, Theme, Help, Present, Paste Mermaid, Export and Save. Four icon buttons each have their own border, the text buttons all look equally important, and rarely used actions (Theme, Help, Paste Mermaid) take up space all the time. This header is shared by every diagram type (`assets/shell/shell.html`), so the change applies to all four types.

## Target

```
Header right:  🔍  ⋯  │  ▶  ⇩  [■ Save]   (icon-only except Save, larger icons)
Bottom-left:   ↶ ↷ │ − 100% + Fit      (undo/redo join the zoom dock)
⋯ menu:        Paste Mermaid…  ·  Dark mode ✓  ·  Keyboard shortcuts  ?
```

- **Icon-only buttons with larger icons:** every header button loses its text label. Icons go from `md` (14px) to `lg`. Buttons are 36×36 with no border; a background appears on hover and focus.
- **Search stays in the header**, as its own icon button outside the `⋯` menu.
- **Undo/Redo move to the zoom dock** (bottom-left), placed before zoom with a divider. That dock already holds the canvas controls. Ctrl+Z and Ctrl+Y don't change.
- **New `⋯` menu ("More")** holds Paste Mermaid…, Dark mode and Keyboard shortcuts. The `?` key and canvas Ctrl+V still work directly.
- **Present and Export** become icon-only. Export keeps its dropdown.
- **Save keeps its "Save" label**: it is the only button with text. It also keeps its solid primary fill, and its icon goes up to the larger size to match the other buttons. On phones (720px and narrower) the label hides, as it does now.
- **Tooltips carry the names and shortcuts** that the labels used to show (`title` plus `aria-label`, which is already on every button). For example: "Save (Ctrl+S)", "Present (Esc exits)".

## Changes

### 1. `assets/shell/shell.html`
- Move `#btn-undo` and `#btn-redo` into `.toolbar-zoom`, first in the dock, followed by a `.dock-sep`. Rename the group's `aria-label` from "Zoom" to "View".
- Remove `#btn-theme`, `#btn-help` and `#btn-import-mermaid` from the header.
- Add `.menu-wrap` > `#btn-more` (`aria-haspopup="menu"`, icon `more`) > `#more-menu[role=menu]` containing:
  - `#menu-import-mermaid` "Paste Mermaid…"
  - `#menu-theme` (`role="menuitemcheckbox"`, `aria-checked`) "Dark mode"
  - `#menu-help` "Keyboard shortcuts", with a `?` hint aligned to the right
- Remove the `.btn-label` spans from Present and Export, and add the `btn-icon` class. Save keeps its label. Header order: Search, More, divider, Present, Export, Save.

### 2. `assets/components/button.css` and `assets/shell/shell.css`
- `header .btn-icon`: 36×36, `padding: 0`, centred, `border-color: transparent`, with border and background on hover. `header .btn-icon svg`: `var(--icon-lg)`.
- `#btn-save svg`: `var(--icon-lg)`, and the button height is 36px to line up with the icon buttons.
- A thin divider (`.toolbar-sep`, 1px × 20px, `--border-color`) between More and Present.
- `.menu` items: allow a right-aligned `<kbd>` hint and a check mark for `menuitemcheckbox[aria-checked=true]`.
- Presentation mode: hide `#btn-more`, and remove the selectors for the moved buttons. Hide `#btn-undo` and `#btn-redo` in `.toolbar-zoom` while presenting. `#btn-present` stays pinned as it is now.
- Narrow screens (720px): the `.btn-label` rule no longer affects the header. Remove the `#btn-help` hide rule, since Help is now inside the menu.

### 3. `assets/components/dock.css`
- Undo/Redo in `.toolbar-zoom` use the existing borderless, 32px dock button style. Check that the dock stays one row at 375px.

### 3b. A narrower bottom-left dock

Today zoom alone is about 180px wide. Adding Undo/Redo with the current button style would make it about 270px. Target: about 200px.

```
Now:     [ − ][ 100% ][ + ][ Fit ]                 buttons 36 wide, "Fit" as text
Target:  [↶][↷]│[−]100%[+][⛶]                      square 28px buttons, Fit as an icon
```

- **Square buttons:** `.toolbar-zoom > .btn` becomes 28×28 with `padding: 0` and centred content, replacing `.btn-icon`'s `6px 10px`. Icons are `md` (14px). The hit area stays above the 24px WCAG minimum.
- **Fit becomes an icon:** add a `fit` icon (four corner brackets) to `assets/icons/default.json`. `#btn-zoom-reset` gets `aria-label="Fit to screen"` and keeps its title.
- **Zoom percentage:** `#zoom-level` goes from 45px to 38px at `--text-sm`, keeping tabular numbers so "100%" never shifts the buttons.
- **Tighter spacing:** dock `gap` goes from 4px to 2px. `.dock-sep` margin inside this dock becomes `4px 3px`.
- **Phones:** the dock already gets its own row, so no extra rule is needed.

**Optional, narrowest (about 130px): `[↶][↷]│[ 100% ▾ ]`.** The percentage becomes a menu button: Zoom in (Ctrl +), Zoom out (Ctrl −), Fit (Shift+1), 50%, 100% and 200%. This is the Figma pattern. The cost is that zooming takes two clicks instead of one; Ctrl+wheel and the shortcuts don't change. **Not chosen for now:** build the ~200px version above.

### 4. `assets/shell/shell.js`
- **Theme (about line 646):** `applyTheme` sets `#menu-theme`'s `aria-checked` and label instead of swapping the moon/sun icon.
- **Help (about line 1065):** `#menu-help` opens the help drawer. `aria-expanded` moves to `#btn-more`, and focus returns to `#btn-more` when the drawer closes.
- **Mermaid (about lines 1378 and 1449):** wire `#menu-import-mermaid`. `syncCopyMenu` hides the menu item when the plugin has no `fromMermaid`. `positionImportBox` anchors to `#btn-more`.
- **More menu:** use the same pattern as Export (`setMoreOpen`; a document click closes it; so does Escape). Opening one menu closes the other. Arrow Up/Down move between items.
- `btnUndo` and `btnRedo` keep their ids, so the undo code doesn't change.

### 5. `assets/icons/default.json`
- Add a `more` icon (three horizontal dots) if there isn't one already, in the same stroke style.

### 6. Tests (`dev/`)
- `e2e_mermaid.mjs`: open `#btn-more`, then click `#menu-import-mermaid`. Check that the menu item is visible (it used to check the toolbar button).
- `e2e_theme.mjs`, `e2e_search.mjs`, `e2e_sequence.mjs`, `e2e_shell.mjs`: replace `#btn-theme` with `#menu-theme` (open the menu first, or call `.click()` directly on the item).
- New checks in `e2e_shell.mjs`:
  - header buttons have no visible text, except Save
  - every header button has an `aria-label` and a `title`
  - Undo and Redo are inside `.toolbar-zoom`
  - the More menu opens and closes with click and with Escape
  - `#menu-theme` `aria-checked` follows the theme
  - presentation mode shows only `#btn-present`
- Visual check: screenshots at 1440 and 375 in both themes, for all four types.

### 7. Docs
- `assets/shell/help.html` and type help text: "Paste Mermaid" is now under the `⋯` menu, and Undo/Redo are bottom left.
- `README.md`: update any header description.

## Accessibility notes

- Icon-only buttons keep `aria-label` and `title`. Targets are 36px, above the 24px WCAG 2.2 minimum.
- The More menu uses `aria-haspopup`, `aria-expanded`, `role=menu`, `menuitem` and `menuitemcheckbox`, with keyboard support.
- Focus rings stay as they are now (`.btn:focus-visible`).

## Out of scope

- Main flow / subprocess folder tabs: done on the same branch by restyling the existing subprocess tab row (`.flow-tabs` in `assets/types/flowchart/flowchart.css`): the main flow is the outer box, its subprocesses an inner box; the Main flow tab replaces "↑ Parent".
- The "Unsaved changes" badge style.
