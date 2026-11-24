# Accessibility Statement

Ultimate Diagram Skill aims to make generated standalone HTML diagrams and the [online playground](https://khanhchungoc.github.io/ultimate-diagraming-skill/) usable across assistive technologies, keyboard workflows, and visual preferences.

## Commitments

- **Themes and contrast:** Diagrams support both light and dark themes, and custom brand palettes are contrast-checked.
- **Keyboard support:** Core editing and navigation actions (such as search with `Ctrl+F`, undo/redo, and toolbar controls) are accessible without requiring a mouse.
- **Semantic markup and labels:** Interactive controls and generated diagram elements include descriptive labels and attributes checked with `axe-core`.

## Supported environments

Generated diagrams are standalone HTML files tested in modern Chromium-based browsers (Chrome, Edge) and designed to work offline in any current desktop or mobile browser.

## Known limitations

- Spatial diagram authoring (such as dragging nodes across swimlanes or repositioning connectors on a canvas) is primarily visual and pointer-driven; keyboard-only equivalents for all freeform canvas manipulations are still evolving.
- Complex, high-density diagrams may require zooming or scrolling to inspect individual nodes comfortably.

## Reporting accessibility barriers

If you encounter an accessibility barrier in a generated diagram or the playground, please [open an issue](https://github.com/khanhchungoc/ultimate-diagraming-skill/issues) with:

- The diagram type (for example: Flowchart, Sequence, ERD, Use case, or C4)
- Your browser, operating system, and assistive technology (if any)
- A description of the barrier and steps to reproduce it
