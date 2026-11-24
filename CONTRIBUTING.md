# Contributing to Ultimate Diagram Skill

Thank you for your interest in contributing! This project generates interactive, standalone HTML diagrams from compact inputs across multiple AI agent runtimes.

## Ways to contribute

- **Report a bug:** Open an issue describing the diagram type, your browser or agent runtime, and steps to reproduce.
- **Suggest a diagram type or improvement:** Open an issue explaining the use case and expected behavior.
- **Submit a pull request:** Fix a bug, improve layout/UX, or add a new diagram type slice.

## Development setup

- **Python 3.9+**
- **Node.js 18+**
- **Chrome, Chromium, or Edge** (used by end-to-end browser tests)

Install development dependencies:

```shell
npm install
```

## Project conventions

- **Single source of truth:** Design tokens live in `assets/tokens` and `scripts/tokens.py`, layout in `scripts/layout_engine.py`, and the disk format in `scripts/disk_format.py`. Do not hardcode colors, sizes, or fonts inside individual diagram types.
- **Deterministic output:** The same input must always produce the same layout and HTML output (no randomness or time-based values).
- **Keep it portable:** Avoid adding new runtime dependencies without a clear reason.
- **Light and dark themes:** Verify UI changes and contrast in both light and dark themes.
- **Complete slices:** A new diagram type should include its folder, `blank.json`, playground switcher entry, example, tests, and docs in the same change.

## Running checks

Run fast non-browser checks while iterating (takes a few seconds):

```shell
npm run test:fast:changed
```

Or run all fast unit/checker tests:

```shell
npm run test:fast
```

Run end-to-end browser tests before opening a PR:

```shell
npm run test:e2e:changed
```

Or run the full end-to-end suite:

```shell
npm run test:e2e
```

If you edit `assets/` or page-assembly scripts, rebuild and verify the example HTML files:

```shell
python3 dev/tools/build_examples.py && python3 dev/tools/build_examples.py --check
```

If you change the disk format, run the golden tests:

```shell
python3 dev/tests/unit/check_golden.py
```

## Pull request process

1. Branch from the latest `main`.
2. Make focused changes and run the relevant checks above.
3. Open a pull request and complete the checklist in the PR template.
