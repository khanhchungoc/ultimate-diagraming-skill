# How it compares

We gave AI assistants the same jobs in three formats: this skill, Mermaid, and draw.io.

These are single runs per assistant (November 2026), not averages. Treat the percentages as a rough guide, and expect different numbers with a different diagram or AI.

## Making a diagram

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

## Reading a diagram back

We asked an AI (Claude Haiku) to summarize 4 saved diagrams, from 9 to 41 steps each.

| | **Ultimate Diagram** | **Mermaid** | **draw.io** |
|---|:---:|:---:|:---:|
| Time to answer | **16 s** | 30 s | 40 s |
| Tokens used | **42,800** | 44,300 | 53,300 |
| Correct answers | 4 / 4 | 4 / 4 | 4 / 4 |

**In plain English:** every format gave correct answers. With this skill installed, the AI answered in about half the time it took for Mermaid and in 60% less time than for draw.io. It used about as many tokens as Mermaid (3% fewer) and 20% fewer than draw.io. Without the skill, the AI still answers correctly but takes about 38 s and 54,000 tokens, because it reads part of the built-in editor first.

## Features

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

## Which one to pick

**Pick Mermaid** for small diagrams that live inside Markdown docs.

**Pick draw.io** for free-form drawing with lots of shapes.

**Pick this** for clear, editable process diagrams from your AI, made fast and cheaply.
