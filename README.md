# Ultimate Diagram Skill

**Ask your AI for a diagram. Get one you can actually edit.**

Describe a process, and your AI agent hands back a single HTML file. Open it in any browser, drag things around, fix a label, and save. No account, no app to install, and it works offline.

[![Swimlane flowchart, horizontal](docs/img/example-flowchart.png)](https://claude.ai/artifact/4GXf3ufVkqEMR9BNy7UuWE)

**Try it live, no install:** [flowchart](https://claude.ai/artifact/4GXf3ufVkqEMR9BNy7UuWE) · [sequence](https://claude.ai/artifact/5GAHnbS8tb9bxKxAi4JDYz) · [ER diagram](https://claude.ai/artifact/39Vy8dhSEdN4MjqVe1qQEv) · [use case](https://claude.ai/artifact/XHQv3cFEPjBJitmvAq8QwE)

## Contents

- [What you get](#what-you-get)
- [Diagram types](#diagram-types)
- [Offline samples](#offline-samples)
- [Get started](#get-started)
- [More](#more)
- [Build your own skills](#build-your-own-skills)
- [Credits and licence](#credits-and-licence)

## What you get

- ✏️ **Fix it yourself, no re-prompting.** Wrong label? Step in the wrong lane? Drag it, retype it, delete it. Undo and redo work. **Ctrl+F** searches the diagram's text.
- 💬 **Your edits and the AI's edits combine.** Tweak the diagram by hand, then tell the AI "add an approval step after review". It picks up from your edited version instead of starting over. This works best as a [claude.ai Artifact](docs/artifacts.md), where **Save** stores your edits straight into the artifact. With a plain HTML file, **Save** works like Save As (see [Save vs Download](#save-vs-download-html)), so you point the AI at the saved file.
- 🧹 **Always tidy.** The AI checks its own result for overlapping boxes and unreadable labels before showing you. After that, add, move or delete a step and the diagram re-arranges itself and re-routes the arrows. Flip between wide and tall with one button. Long arrows become lettered circles (A → A): hover to see where the flow continues, click to jump there.
- ⚡ **Fast and cheap.** The AI writes a short description instead of thousands of lines of drawing code, so you wait less and spend fewer tokens ([numbers](#how-it-compares)).
- 📦 **Just a file.** Email it, put it in a repo, attach it to a ticket, or open it offline. Optionally [use your brand](docs/brand.md): colours, font and corners, contrast-checked.

## Diagram types

| Type | Shows | Status |
|---|---|---|
| **Flowchart** | Process steps and decisions in swimlanes | ✅ Available |
| **Sequence** | Who talks to whom, over time | ✅ Available |
| **ERD** | Database tables, keys and relationships | ✅ Available |
| **Use case** | Actors, goals and system boundaries | ✅ Available |
| **BPMN** | Pools, lanes, events and gateways | 🔜 Next |
| **State machine** | States and transitions | 🔜 Next |
| **C4** | System context, containers and components | 💡 Later |
| **Mind map** | Ideas branching from a central topic | 💡 Later |
| **Gantt chart** | Tasks on a timeline | 💡 Later |

✅ available, 🔜 next, 💡 later. Order may change. Also on the list: class, component and org chart diagrams; export to SVG, PNG, PDF; import from Mermaid; export to draw.io and BPMN. Flowchart, sequence and ER diagrams can also be copied as Mermaid.

### Flowchart

*"Draw a swimlane flowchart of our loan approval process."*

[![Swimlane flowchart, horizontal](docs/img/example-flowchart.png)](https://claude.ai/artifact/4GXf3ufVkqEMR9BNy7UuWE)

▶ [Try the flowchart](https://claude.ai/artifact/4GXf3ufVkqEMR9BNy7UuWE)

### Sequence diagram

*"Draw a sequence diagram of the login flow between the app, API gateway and auth service."*

[![Sequence diagram](docs/img/example-sequence-2026-11.png)](https://claude.ai/artifact/5GAHnbS8tb9bxKxAi4JDYz)

▶ [Try the sequence diagram](https://claude.ai/artifact/5GAHnbS8tb9bxKxAi4JDYz)

### ER diagram

*"Draw an ER diagram for an online shop: customers, orders, products and payments."*

[![ER diagram](docs/img/example-erd.png)](https://claude.ai/artifact/39Vy8dhSEdN4MjqVe1qQEv)

▶ [Try the ER diagram](https://claude.ai/artifact/39Vy8dhSEdN4MjqVe1qQEv)

### Use case diagram

*"Draw a use case diagram for our booking system, with requirement ids."*

[![Use case diagram](docs/img/example-usecase.png)](https://claude.ai/artifact/XHQv3cFEPjBJitmvAq8QwE)

Search by requirement id (such as `FR-4`) to find the use case that covers it.

▶ [Try the use case diagram](https://claude.ai/artifact/XHQv3cFEPjBJitmvAq8QwE)

## Offline samples

The same demos as HTML files you can open in your browser without a connection: [flowchart](dev/samples/example-flowchart.html), [sequence](dev/samples/example-sequence.html), [ERD](dev/samples/example-erd.html), [use case](dev/samples/example-usecase.html).

## Get started

### Before you start

You need Python 3.9+ and Chrome, Chromium or Edge (used to lay out and check every diagram). Node.js 18+ is optional: if it is installed, layout runs a bit faster. The installer checks all of these and tells you what is missing. If something is, ask your agent to install it for you.

### Option A: one command

If you have Node.js, run one of these in a terminal. It shows the version it installs.

For all your projects:

```shell
npx khanhchungoc/ultimate-diagraming-skill
```

For the current project only, run it inside the project folder:

```shell
npx khanhchungoc/ultimate-diagraming-skill --project
```

Both install into every supported agent. Add `--runtime claude` to pick one.

Or ask your AI agent to install it for you: *"Install the ultimate-diagram skill with `npx khanhchungoc/ultimate-diagraming-skill`."*

### Option B: download (no terminal needed)

1. Open the [latest release](https://github.com/khanhchungoc/ultimate-diagraming-skill/releases/latest) and download `ultimate-diagram-vX.Y.Z.zip` (under **Assets**).
2. Unzip it. You get one folder named `ultimate-diagram`.
3. Move that folder into your agent's `skills` folder (create it if it is missing):

   | Agent | Skills folder (for all your projects) |
   |---|---|
   | Claude Code | `.claude/skills` in your home folder |
   | GitHub Copilot | `.copilot/skills` in your home folder |
   | OpenAI Codex | `.agents/skills` in your home folder |
   | Gemini CLI | `.gemini/skills` in your home folder |
   | Kiro | `.kiro/skills` in your home folder |

   Folders starting with a dot are hidden. Mac: in Finder press `Cmd` + `Shift` + `.` to show them. Windows: your home folder is `C:\Users\<your name>`; turn on **View > Show > Hidden items**. For one project only, use the same folder inside that project instead.
4. Restart your agent.

### Then

1. Ask your agent: *"Draw a swimlane flowchart of our loan approval process."*
2. It saves an HTML file in your project folder and tells you the path. Open it in your browser and edit.
3. Press **Save** in the diagram to keep your edits.

### Save vs Download .html

- **Opened as a claude.ai Artifact** (Claude Code with Artifact output): **Save** stores your edits directly in the artifact as a new version, so your agent's next change starts from them. If you only have view access (for example the live demos), use **Download .html** to get your own editable copy as a file. See [Artifacts](docs/artifacts.md).
- **Opened as a regular HTML file:** the browser cannot write into the file you opened, so the first **Save** works like Save As: you choose where the edited copy goes. To have your agent continue from your edits, tell it which saved file to use.

## More

- [Use your brand](docs/brand.md): diagrams in your colours, font and corner style, contrast-checked.
- [Diagrams as claude.ai Artifacts](docs/artifacts.md): publish privately, share a link, keep editing.
- [Ask your AI about a diagram](docs/reading-diagrams.md): summarize or query a saved diagram without reading the editor code.

<a id="how-it-compares"></a>
<details>
<summary><b>How it compares</b> to Mermaid and draw.io</summary>

We gave AI assistants the same jobs in three formats: this skill, Mermaid, and draw.io.

These are single runs per assistant (November 2026), not averages. Treat the percentages as a rough guide, and expect different numbers with a different diagram or AI.

### Making a diagram

Same prompt for a large process (7 lanes, about 50 to 60 steps, 5 possible outcomes), run in two AI assistants: Antigravity and GitHub Copilot.

| | **Ultimate Diagram** | **Mermaid** | **draw.io** |
|---|:---:|:---:|:---:|
| Time to finish | **3.4 to 4 min** | 4.9 to 5.5 min | 6.9 to 7.6 min |
| Actions the AI took | **8 to 11** | 12 to 32 | 26 to 30 |
| Tokens used (Copilot) | **0.69 million** | 2.32 million | 2.54 million |
| Cost (Copilot, estimated) | **$0.09** | $0.29 | $0.34 |
| Every step and outcome included | ✅ | ✅ | ✅ |
| Layout checked for overlaps | ✅ every time, with a screenshot | ⚠️ only if the AI decides to | ⚠️ boxes only, arrows unchecked |

**In plain English:** this skill finished 19% to 38% sooner than Mermaid and in about half the time of draw.io. In Copilot it used 70% fewer tokens than Mermaid and 73% fewer than draw.io, so it cost about a third as much as Mermaid and a quarter as much as draw.io. The reason: the AI only writes the steps and arrows, and a script draws the picture. With draw.io the AI has to work out the position of every box and arrow itself.

### Reading a diagram back

We asked an AI (Claude Haiku) to summarize 4 saved diagrams, from 9 to 41 steps each.

| | **Ultimate Diagram** | **Mermaid** | **draw.io** |
|---|:---:|:---:|:---:|
| Time to answer | **16 s** | 30 s | 40 s |
| Tokens used | **42,800** | 44,300 | 53,300 |
| Correct answers | 4 / 4 | 4 / 4 | 4 / 4 |

**In plain English:** every format gave correct answers. With this skill installed, the AI answered in about half the time it took for Mermaid and in 60% less time than for draw.io. It used about as many tokens as Mermaid (3% fewer) and 20% fewer than draw.io. Without the skill, the AI still answers correctly but takes about 38 s and 54,000 tokens, because it reads part of the built-in editor first.

### Features

| | **Ultimate Diagram** | **Mermaid** | **draw.io** |
|---|:---:|:---:|:---:|
| Edit by dragging and typing | ✅ | ❌ edit the code or ask the AI | ✅ |
| Everything the AI wrote can be changed by hand | ✅ lane colours, legends, activation bars and more (a step's shape is still set by the AI) | ❌ edit the code | ✅ |
| Opens with nothing to install | ✅ any browser | ✅ shown by GitHub, GitLab, VS Code | ⚠️ needs the draw.io app or website |
| Real swimlanes | ✅ | ❌ coloured groups only | ✅ |
| Switch wide / tall in one click | ✅ | ⚠️ edit the code | ❌ |
| Re-tidies itself after edits | ✅ | ✅ always automatic, but no dragging | ⚠️ limited |
| Shows inside Markdown docs | ❌ | ✅ | ❌ |
| File size | ⚠️ about 330 to 530 KB (editor built in) | ✅ 10 to 26 KB | ✅ 39 to 56 KB |
| Huge shape and icon library | ❌ | ❌ | ✅ |

### Which one to pick

**Pick Mermaid** for small diagrams that live inside Markdown docs.

**Pick draw.io** for free-form drawing with lots of shapes.

**Pick this** for clear, editable process diagrams from your AI, made fast and cheaply.

</details>

## Credits and licence

Released under the [MIT licence](LICENSE).

The icons in the editor and on the swimlane headers are [Lucide](https://lucide.dev) icons (ISC licence, Copyright (c) Lucide Icons and Contributors), or are redrawn from Lucide designs; some Lucide icons derive from [Feather](https://feathericons.com) (MIT licence, Copyright (c) Cole Bemis). The diagram-type icons, the flowchart shape tiles and a few others were drawn for this skill. The icon registry is `assets/icons/default.json` and the full licence notices are in `assets/icons/LICENSE`.

## Build your own skills

> ### 🛠️ [craft-agent-skill](https://github.com/khanhchungoc/craft-agent-skill)
>
> Liked this skill? Make your own. **craft-agent-skill** creates, updates and audits agents and skills for Copilot, Claude Code, Codex, Gemini and Kiro.
>
> **[Get craft-agent-skill →](https://github.com/khanhchungoc/craft-agent-skill)**
