# Gantt Table View (Excel-Like Sheet) & Calendar Date Pickers

**Status:** Completed  
**Branch:** `feat/gantt-table-view` (from `origin/stg`)  
**Scope:** 2-way `Timeline | Table` view toggle (Split mode excluded for now as a future addition) + unified Calendar Date Pickers across all Gantt date inputs.

## Goals

1. **Convert Excel users** by providing an editable, keyboard-navigable spreadsheet table view backed by the exact same Gantt `chartData` model (single source of truth). Edits in Table view immediately drive the Timeline view with zero file-format changes.
2. **Calendar-picked dates everywhere** — replace all raw date inputs across both Table view (Start, End, Date Lines) and Timeline view (Set Dates popover, Marker Date popover, Holidays popover) with a consistent, accessible, light/dark-themed interactive Calendar Date Picker (`GanttDatePicker`).
3. **Exclude Split mode** for v1 (planned as a future addition).

## Architecture & File Ownership

- **Core bundling (`scripts/layout_engine.py`, `assets/types/gantt/meta.json`)**
  - Generic optional `extraCss` and `extraJs` arrays in `meta.json` loaded in `_build_parts()` (type-agnostic).
  - `assets/types/gantt/meta.json` registers `datepicker.css`, `table.css` and `datepicker.js`, `table.js`.
- **Calendar Date Picker (`assets/types/gantt/datepicker.js`, `assets/types/gantt/datepicker.css`)**
  - Exposes `window.GanttDatePicker` (`open`, `close`, `isOpen`, `attachInput`).
  - Month grid with prev/next month & year controls, Today highlight & jump button, optional Clear button, min/max clamping, full keyboard navigation, viewport-safe positioning, and token-based light/dark theming.
- **Excel-Like Table View (`assets/types/gantt/table.js`, `assets/types/gantt/table.css`)**
  - Exposes `window.GanttTable.create(hostEl, api)`.
  - Columns: Select checkbox, `#` (row number), indented `Task` (with collapse toggle + `Tab`/`Shift+Tab` indent/outdent), `Type` (`Group`/`Task`/`Milestone`), calendar-picked `Start` & `End` (rolled-up italic read-only for parents), live-synced `Duration` (`14d`, `2w`), `Depends on` (`2FS, 5SS` shorthand + checkbox picker popover), `Category` (`colorKey` dropdown), and inline `Notes`.
  - Bottom quick-add row (`Type a new task and press Enter...`).
  - Collapsible `Date Lines` mini-table for chart-wide markers (`markers`).
  - Multi-row bulk action bar (`Shift dates`, `Category`, `Indent`, `Outdent`, `Copy TSV`, `Delete`).
  - Excel / Google Sheets TSV Copy & Paste (auto-detects headers and common date formats).
  - Roving-tabindex `treegrid` spatial keyboard navigation preserving native boundary scrolling.
- **Gantt Shell Integration (`assets/types/gantt/toolbar.html`, `stage.html`, `chrome.html`, `help.html`, `gantt.js`, `gantt.css`)**
  - Segmented `Timeline | Table` mode switch (`#gantt-mode-switch`) in toolbar.
  - Hides timeline-only controls (`zoom`, `Arrows`, `Today`, `Weekends`, `View filter`) in Table mode.
  - Wires `GanttDatePicker` into `openItemDatesPop`, `openMarkerDatePop`, and `#gantt-hol-date` / `#gantt-hol-end`.
  - Wires `GanttTable` into `render()`, Undo/Redo, Present mode, and search focus.

## Verification Plan

1. Fast tests during iteration: `npm run test:fast:changed`.
2. Targeted Gantt E2E tests covering:
   - Switching `Timeline <-> Table` and verifying edits sync to Timeline bars/arrows.
   - Calendar Date Picker in Table cells, Item Dates popover, Marker Date popover, and Holidays popover.
   - Duration ↔ End sync, Dependency shorthand & picker, Indent/Outdent, Quick-add row, Bulk shift/delete, and Excel TSV paste/copy.
3. Visual verification in headless Chrome: light + dark screenshots of Table view, Calendar Picker open, and Timeline view after Table edits.
4. Final verification before PR/merge (on user confirmation): `npm run test:e2e:changed` + `python3 dev/tools/build_examples.py && python3 dev/tools/build_examples.py --check`.
