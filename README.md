# Ultimate Diagram Skill

[![npm installs](https://img.shields.io/npm/dt/ultimate-diagram?label=npm%20installs)](https://www.npmjs.com/package/ultimate-diagram)
[![zip downloads](https://img.shields.io/github/downloads/khanhchungoc/ultimate-diagraming-skill/total?label=zip%20downloads)](https://github.com/khanhchungoc/ultimate-diagraming-skill/releases)

**Ask your AI for a diagram. Get one you can actually edit.**

Describe a process, and your AI agent hands back a single HTML file. Open it in any browser, drag things around, fix a label, and save. No account, no app to install, and it works offline.

<a href="https://khanhchungoc.github.io/ultimate-diagraming-skill/examples/flowchart/"><picture><source srcset="docs/img/demo.webp" type="image/webp"><img src="docs/img/demo.poster.jpg" alt="Interactive diagram demo: drag across lanes with Auto-Tidy, subprocess tab, copy and import Mermaid, save, and present mode" width="100%" /></picture></a>

### 👉 **[Try the playground, no install](https://khanhchungoc.github.io/ultimate-diagraming-skill/)** 👈

## Contents

- [What you get](#what-you-get)
- [Diagram types](#diagram-types)
- [Examples](#examples)
- [Get started](#get-started)
- [Use your brand](#use-your-brand)
- [How it compares to Mermaid and draw.io](#how-it-compares-to-mermaid-and-drawio)
- [Build your own skills](#build-your-own-skills)
- [Update check](#update-check)

## What you get

- ✏️ **Fix it yourself, no re-prompting.** Drag, retype, or delete anything. Undo, redo, and **Ctrl+F** search work out of the box.
- 💬 **Your edits and the AI's edits combine.** Edit by hand, then ask the AI to change or extend the diagram — it builds on your saved version (in-place in [claude.ai Artifacts](docs/artifacts.md) or directly in your saved HTML file).
- 🧹 **Always tidy.** The AI checks for overlaps and unreadable labels before showing you. Move or edit anything and Auto-Tidy re-layouts and re-routes arrows in one click.
- ⚡ **Fast and cheap.** The AI writes a short description instead of thousands of lines of drawing code, saving time and tokens.
- 📦 **Just a file.** Share or open it offline anywhere. Optionally [use your brand](#use-your-brand) (colours, font, corners, contrast-checked).

## Diagram types

| Type | Shows | Status |
|---|---|---|
| **Flowchart** | Process steps and decisions in swimlanes | ✅ |
| **Sequence** | Who talks to whom, over time | ✅ |
| **ERD** | Database tables, keys and relationships | ✅ |
| **Use case** | Actors, goals and system boundaries | ✅ |
| **C4** | System landscape: people, systems and containers (levels 1–2) | ✅ |
| **BPMN** | Pools, lanes, events and gateways | 🔜 |
| **State machine** | States and transitions | 🔜 |
| **Mind map** | Ideas branching from a central topic | 🕐  |
| **Gantt chart** | Tasks on a timeline | 🕐 |

*Order may change.*

## Examples

<details>
<summary>See examples for each diagram type</summary>

### Flowchart

*"Draw a swimlane flowchart of our loan approval process."*

<a href="https://khanhchungoc.github.io/ultimate-diagraming-skill/examples/flowchart/"><picture><source srcset="docs/img/demo-flowchart.webp" type="image/webp"><img src="docs/img/demo-flowchart.poster.jpg" alt="Swimlane flowchart demo: drop a step onto an arrow, reorder a swimlane, split a long arrow with a connector, and switch to vertical layout" width="100%" /></picture></a>

▶ [Try the flowchart](https://khanhchungoc.github.io/ultimate-diagraming-skill/examples/flowchart/) · [Offline HTML](dev/samples/example-flowchart.html)

### Sequence diagram

*"Draw a sequence diagram of the login flow between the app, API gateway and auth service."*

<a href="https://khanhchungoc.github.io/ultimate-diagraming-skill/examples/sequence/"><picture><source srcset="docs/img/demo-sequence.webp" type="image/webp"><img src="docs/img/demo-sequence.poster.jpg" alt="Sequence diagram demo: collapse and expand a frame, scroll down for floating participant pills, and add a message and reply" width="100%" /></picture></a>

▶ [Try the sequence diagram](https://khanhchungoc.github.io/ultimate-diagraming-skill/examples/sequence/) · [Offline HTML](dev/samples/example-sequence.html)

### ER diagram

*"Draw an ER diagram for an online shop: customers, orders, products and payments."*

<a href="https://khanhchungoc.github.io/ultimate-diagraming-skill/examples/erd/"><picture><source srcset="docs/img/demo-erd.webp" type="image/webp"><img src="docs/img/demo-erd.poster.jpg" alt="ER diagram demo: zoom out to overview with detail card, drag and drop a new table, zoom in, connect tables, and highlight related tables" width="100%" /></picture></a>

▶ [Try the ER diagram](https://khanhchungoc.github.io/ultimate-diagraming-skill/examples/erd/) · [Offline HTML](dev/samples/example-erd.html)

### Use case diagram

*"Draw a use case diagram for our booking system, with requirement ids."*

<a href="https://khanhchungoc.github.io/ultimate-diagraming-skill/examples/usecase/"><picture><source srcset="docs/img/demo-usecase.webp" type="image/webp"><img src="docs/img/demo-usecase.poster.jpg" alt="Use case diagram demo: drag and drop an actor and use case, search by requirement ID, and collapse and expand the system subject" width="100%" /></picture></a>

Search by requirement id (such as `FR-4`) to find the use case that covers it.

▶ [Try the use case diagram](https://khanhchungoc.github.io/ultimate-diagraming-skill/examples/usecase/) · [Offline HTML](dev/samples/example-usecase.html)

### C4 diagram

*"Draw a C4 system landscape diagram for our e-commerce platform with customers, web app, API, and payment gateway."*

<a href="https://khanhchungoc.github.io/ultimate-diagraming-skill/examples/c4/"><picture><source srcset="docs/img/demo-c4.webp" type="image/webp"><img src="docs/img/demo-c4.poster.jpg" alt="C4 diagram demo: collapse and expand a system boundary, change icon and colour, and add and move a new system" width="100%" /></picture></a>

▶ [Try the C4 diagram](https://khanhchungoc.github.io/ultimate-diagraming-skill/examples/c4/) · [Offline HTML](dev/samples/example-c4.html)

</details>

## Get started

### Before you start

You need Python 3.9+ and Chrome, Chromium or Edge (used to lay out and check every diagram). Node.js 18+ is optional: if it is installed, layout runs a bit faster. A missing one shows up on the first diagram; ask your agent to install it for you.

### Option A: ask your AI agent

*"Install the ultimate-diagram skill by running `npx ultimate-diagram@latest` (or `npx ultimate-diagram@latest -p` for this project only)."*

### Option B: one command

All your projects (global):

```shell
npx ultimate-diagram@latest
```

Current project only:

```shell
npx ultimate-diagram@latest -p
```

Target a single runtime with `-r <name>` (e.g. `npx ultimate-diagram@latest -r antigravity`), or pass `--no-hooks` to skip registering `SessionStart` update-check hooks.

### Option C: download (no terminal needed)

1. Open the [latest release](https://github.com/khanhchungoc/ultimate-diagraming-skill/releases/latest) and download `ultimate-diagram-vX.Y.Z.zip` (under **Assets**).
2. Unzip it. You get one folder named `ultimate-diagram`.
3. Move that folder into your agent's `skills` folder (create it if it is missing):

   | Agent | Skills folder (for all your projects) |
   |---|---|
   | Antigravity | `.gemini/config/skills` in your home folder (`.agents/skills` per project) |
   | Claude Code | `.claude/skills` in your home folder |
   | GitHub Copilot | `.copilot/skills` in your home folder (`.github/skills` per project) |
   | OpenAI Codex | `.agents/skills` in your home folder |
   | Gemini CLI | `.gemini/skills` in your home folder |
   | Kiro | `.kiro/skills` in your home folder |

   Folders starting with a dot are hidden. Mac: in Finder press `Cmd` + `Shift` + `.` to show them. Windows: your home folder is `C:\Users\<your name>`; turn on **View > Show > Hidden items**. For one project only, use the same folder inside that project instead.
4. Restart your agent.

### Then

1. Ask your agent: *"Draw a swimlane flowchart of our loan approval process."*
2. It saves an HTML file in your project folder and tells you the path. Open it in your browser and edit.
3. Press **Save** in the diagram to keep your edits.

## Use your brand

<details>
<summary>Show how</summary>

Give the AI a website address or a brand guide (PDF, image or CSS file) and ask for diagrams in that look. It extracts colours, font, corner style and icon weight, checks contrast in light and dark mode, and shows you the report and three preview images. Nothing is kept until you accept it.

Text stays readable: the colours are checked against WCAG 2.2 AA contrast in light and dark mode, and any that fall short are nudged until they pass.

Example prompts:

- *"Use the brand from https://example.com and draw a swimlane flowchart of our loan approval process."*
- *"Here is our brand guide (brand.pdf). Make diagrams in this style, then draw a sequence diagram of the login flow."*

Once accepted, the theme is saved as `.ultimate-diagram/theme.json` in your project and every later diagram there uses it; diagrams you already saved pick it up the next time they are re-laid out. To switch back, delete that file.

For contributors: [references/theme.md](references/theme.md).

</details>

## How it compares to Mermaid and draw.io

- ⚡ **This**: clear, editable process diagrams from your AI.
- 🧩 **Mermaid**: small diagrams inside Markdown docs.
- 🎨 **draw.io**: free-form drawing, huge shape library.

<details>
<summary>Show the comparison</summary>

### Features

| | **This** | **Mermaid** | **draw.io** |
|---|:---:|:---:|:---:|
| Edit by drag and type | ✅ | ❌ code | ✅ |
| Hand-edit everything the AI wrote | ✅ | ❌ | ✅ |
| Nothing to install | ✅ | ✅ | ⚠️ app or site |
| Real swimlanes | ✅ | ❌ | ✅ |
| Re-layout (wide ↔ tall, 1 click) | ✅ | ⚠️ code | ❌ |
| Auto-layout / re-layout after edits | ✅ | ⚠️ no drag | ⚠️ limited |
| In Markdown docs | ❌ | ✅ | ❌ |
| Export PNG / SVG / PDF | ✅ PNG, SVG | ✅ | ✅ |
| File size | ⚠️ 330-530 KB | ✅ 10-26 KB | ✅ 39-56 KB |
| Shape / icon library | ✅ Devicon + custom packs | ❌ | ✅ |

</details>

## Build your own skills

Liked this skill? Make your own with [**craft-agent-skill**](https://github.com/khanhchungoc/craft-agent-skill) — creates, updates and audits agents and skills for Copilot, Claude Code, Codex, Gemini and Kiro.

## Update check

`scripts/version_check.py` checks GitHub Releases asynchronously in the background (via `SessionStart` hooks on Claude Code and Gemini CLI, and automatically during `layout_engine.py` runs across all 6 runtimes), cached locally for 24 hours. It sends no user data and never updates without your confirmation. Opt out anytime by setting `ULTIMATE_DIAGRAM_NO_UPDATE_CHECK=1` or installing with `--no-hooks`.
