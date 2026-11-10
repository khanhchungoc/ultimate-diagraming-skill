# Ultimate Diagram Skill

An agent skill that creates diagrams as a single standalone HTML file. Open the file in a browser to drag elements, double-click to edit text, run **Auto-Tidy**, and **Save** the changes back into the same file. Add `?present` to the URL for a read-only view.

Supported diagram types:

| Type | Use for |
|---|---|
| `flowchart` | Swimlane / cross-functional process flows with decisions and loops |
| `sequence` | Messages between participants over time, with `opt` / `alt` / `loop` frames |

ERD and state diagrams are planned, not built yet.

## Try it

Open these in a browser, no setup needed:

- [dev/samples/example-flowchart.html](dev/samples/example-flowchart.html): a loan application process across 4 swimlanes
- [dev/samples/example-sequence.html](dev/samples/example-sequence.html): a checkout flow with `opt` and `alt` frames

In the flowchart, each swimlane header shows an icon beside the lane name (set with the lane's `icon` field). Drag a step to another lane, drag a lane header to reorder lanes, double-click text to edit, and press **Auto-Tidy** after moving things around. In the sequence diagram, drag a participant sideways or a message up and down to reorder, double-click to edit, and use **Participant**, **Message** and **Frame** in the toolbar (under **Add**). Press **Delete** to remove the selected item, **Ctrl+Z** / **Ctrl+Y** (or the arrow buttons in the header) to undo and redo edits, and add `?present` to the address for a read-only view.

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

Install `ultimate-diagram` into your AI coding assistants (Antigravity, Claude Code, GitHub Copilot, OpenAI Codex, Gemini CLI, or Kiro):

### 1. One-line NPX (from GitHub or local repo)
```shell
# From GitHub:
npx khanhchungoc/ultimate-diagraming-skill

# Or from local clone:
npx "C:\Users\KhanhChuNgoc\Documents\NTG Repos\ultimate-diagram"
# Or if installed globally via npm install -g:
ultimate-diagram
```
Options:
- `-g, --global`: Install globally in user home directory (default).
- `-p, --project`: Install into the current project workspace directory.
- `-r, --runtime <name>`: Target specific runtime (`antigravity`, `claude`, `copilot`, `codex`, `gemini`, `kiro`, or `all`).
- `-m, --mode <symlink|copy>`: Symlink/junction (live updates) or standalone copy.

### 2. Python (Cross-platform)
```shell
python scripts/install.py
# Or for a specific runtime:
python scripts/install.py --runtime antigravity --scope user
```

### 3. PowerShell (Windows)
```powershell
.\scripts\install.ps1
# Or for a specific runtime:
.\scripts\install.ps1 -Runtime antigravity -Scope User
```

### 4. Bash (macOS / Linux)
```bash
./scripts/install.sh
# Or for a specific runtime:
./scripts/install.sh --runtime claude --scope user
```

## Quick start

```shell
# create: JSON in, standalone HTML out
python scripts/layout_engine.py --layout dev/samples/example-flowchart.json -o flowchart.html

# audit the result (score must be 90 or more, exit code 0)
python scripts/layout_engine.py --verify flowchart.html

# screenshot plus a legibility report
python scripts/render_screenshot.py --input flowchart.html --output flowchart.png

# read the data back out of a saved page
python scripts/layout_engine.py --extract flowchart.html -o current.json
```

The example JSON files in `assets/` are the inputs these pages were built from. In normal use you don't run these yourself: the agent does, following `SKILL.md`.
