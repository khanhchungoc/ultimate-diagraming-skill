# Interactive Diagram Skill

An agent skill that creates diagrams as a single standalone HTML file. Open the file in a browser to drag elements, double-click to edit text, run **Auto-Tidy**, and **Save** the changes back into the same file. Add `?present` to the URL for a read-only view.

Supported diagram types:

| Type | Use for |
|---|---|
| `flowchart` | Swimlane / cross-functional process flows with decisions and loops |
| `sequence` | Messages between participants over time, with `opt` / `alt` / `loop` frames |

ERD and state diagrams are planned, not built yet.

## Requirements

| Need | For | Notes |
|---|---|---|
| **Python 3.9 or newer** | Every script | Standard library only: no `pip install`. Developed on 3.14; older versions have not been run. |
| **Node.js 18 or newer**, *or* **Chrome / Chromium** | Creating a diagram | Node is used first and is fast. Chrome is a slower fallback. If neither is installed, creating a diagram stops with an error. |
| **Chrome / Chromium** | The screenshot and legibility check | Chrome is tried first, then Edge. Edge's headless launcher has returned no output in earlier runs, so use Chrome where you can, or pass `--browser <path>`. |
| **Any modern browser** | Opening and editing the finished HTML | Save writes straight to the file in Chrome and Edge. Firefox and Safari download a copy instead, which you then move over the original. |

No network access is needed at any point, and the generated HTML loads nothing external.

### What works without Node or Chrome

| Works | Needs Node or Chrome |
|---|---|
| Quality audit (`--verify`) | Creating a diagram (`--layout`) |
| Reading data back out of a saved page (`--extract`) | Screenshot and legibility check |
| Opening a generated page, including the Auto-Tidy button | |

### Command names on your system

The skill's instructions say `python`. On macOS and many Linux systems the command is `python3`, and on Windows it can be `py`. Use whichever runs Python 3 on your machine.

### Tested on

Windows 11 with Chrome, Python 3.14 and Node 24. These have **not** been tested: macOS, Linux, Edge-only machines, containers or CI, older Python or Node versions, and Firefox or Safari.

Known risks on untested systems:
- **Running as root** (Docker, some CI): Chrome refuses to start without `--no-sandbox`, and the scripts do not pass it.
- **Fonts:** the page uses each system's own font. Sequence diagrams space labels with a fixed width estimate, so a wider font on another OS could make a label run into a neighbouring lifeline. The screenshot step catches label-on-label overlaps on the machine where it runs, but the quality audit cannot catch this.

## Install

Copy the skill folder to wherever your agent loads skills from, and name the folder to match the skill name in the `SKILL.md` header (`interactive-diagram`). This repo's folder is currently called `final-diagram-skill`, so rename it when you install it.

The `dev/` folder is for the skill's maintainers and can be left out of an installed copy.

## Quick start

```shell
# create: JSON in, standalone HTML out
python scripts/layout_engine.py --layout assets/example-flowchart.json -o flowchart.html

# audit the result (score must be 90 or more, exit code 0)
python scripts/layout_engine.py --verify flowchart.html

# screenshot plus a legibility report
python scripts/render_screenshot.py --input flowchart.html --output flowchart.png

# read the data back out of a saved page
python scripts/layout_engine.py --extract flowchart.html -o current.json
```

Try `assets/example-sequence.json` for a sequence diagram. In normal use you don't run these yourself: the agent does, following `SKILL.md`.
