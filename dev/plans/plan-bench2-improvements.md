# Plan: Beat Mermaid-MD and draw.io across all four diagram types (Benchmark 2 follow-up)

Status: proposed. Measured against Benchmark 2 (`bench2`, 2026-11-18) on `main` at `786bbcd`.

## Benchmark 2 verification and findings

Four large briefs (`flowchart`: 10-lane employee onboarding; `sequence`: 17-participant card checkout; `erd`: 49-table clinic SaaS; `usecase`: 3-system public library, `FR-01` to `FR-53`) were run across three arms: `skill` (`ultimate-diagram` standalone HTML), `mermaid-md` (a single Mermaid block in Markdown), and `drawio` (uncompressed `.drawio` XML). Blind judges scored the text sources (`--extract` output for `skill`, raw source for `mermaid-md` and `drawio`) on five 1–10 criteria (`Cov`, `Not`, `Val`, `Ed`, `AI`), with validity corrected by headless Mermaid 11.17.2 parsing and XML validation.

### Verified results per type

| Type | Arm | Calls | Agent time | Authored | Read by judge | Deliverable | Renders | Cov / Not / Val / Ed / AI (Mean) |
|---|---|---:|---:|---:|---:|---:|---|---|
| flowchart | `skill` | 16 | 92.66 s | 6,683 B | 6,994 B | 623,017 B | Yes (232 ms) | 7 / 6 / 8 / 7 / 8 (**7.2**) |
| flowchart | `mermaid-md` | 4 | 53.74 s | 5,621 B | 5,621 B | 5,621 B | Yes (629 ms) | 8 / 8 / 9 / 8 / 9 (**8.4**) |
| flowchart | `drawio` | 14 | 459.63 s | 47,496 B | 47,496 B | 47,496 B | Yes (175 ms) | 7 / 8 / 9 / 3 / 3 (**6.0**) |
| sequence | `skill` | 15 | 97.22 s | 6,038 B | 6,351 B | 436,522 B | Yes (179 ms) | 5 / 6 / 8 / 7 / 8 (**6.8**) |
| sequence | `mermaid-md` | 3 | 37.68 s | 6,476 B | 6,476 B | 6,476 B | No (174 ms) | 8 / 7 / 2 / 8 / 9 (**6.8**) |
| sequence | `drawio` | 15 | 443.34 s | 61,475 B | 61,475 B | 61,475 B | No (179 ms) | 7 / 4 / 2 / 2 / 2 (**3.4**) |
| erd | `skill` | 12 | 104.03 s | 8,697 B | 8,885 B | 501,348 B | Yes (1,218 ms) | 9 / 8 / 9 / 8 / 8 (**8.4**) |
| erd | `mermaid-md` | 3 | 49.91 s | 10,355 B | 10,355 B | 10,355 B | Yes (461 ms) | 7 / 6 / 8 / 8 / 9 (**7.6**) |
| erd | `drawio` | 20 | 480.12 s | 302,328 B | 302,328 B | 302,328 B | Yes (904 ms) | 9 / 7 / 9 / 3 / 3 (**6.2**) |
| usecase | `skill` | 6 | 52.95 s | 6,131 B | 6,258 B | 427,466 B | Yes (274 ms) | 8 / 6 / 9 / 8 / 8 (**7.8**) |
| usecase | `mermaid-md` | 4 | 29.54 s | 5,430 B | 5,430 B | 5,430 B | Yes (307 ms) | 9 / 7 / 9 / 9 / 10 (**8.8**) |
| usecase | `drawio` | 13 | 94.66 s | 34,489 B | 34,489 B | 34,489 B | Yes (180 ms) | 7 / 9 / 9 / 3 / 4 (**6.4**) |
| **mean** | **`skill`** | **12.25** | **86.72 s** | **6.73 KB** | **6.95 KB** | **497.1 KB** | **4/4** | **7.25 / 6.50 / 8.50 / 7.50 / 8.00 (7.55)** |
| **mean** | **`mermaid-md`** | **3.50** | **42.72 s** | **6.81 KB** | **6.81 KB** | **6.81 KB** | **3/4** | **8.00 / 7.00 / 7.00 / 8.25 / 9.25 (7.90)** |
| **mean** | **`drawio`** | **15.50** | **369.44 s** | **108.8 KB** | **108.8 KB** | **108.8 KB** | **3/4** | **7.50 / 7.00 / 7.25 / 2.75 / 3.00 (5.50)** |

The benchmark report's measurements and parse checks match the files on disk:

- `drawio-sequence.drawio` fails XML parsing at line 43 because activation-bar styles embed unescaped quotes inside `newEdgeStyle={"curved":0,"rounded":0}`, and its message edges rely on raw coordinates without `source` or `target` cell references.
- `mermaid-md-sequence.md` fails Mermaid parsing (`Syntax error in text`) because lines 92 and 93 contain raw `;` characters that Mermaid lexes as statement terminators.
- `skill` shipped 4/4 valid, self-contained, editable HTML diagrams, and its authored `.mmd` sources are already smaller on average than `mermaid-md` (6.73 KB vs. 6.81 KB).

### Root causes where `skill` lost points

Inspecting both the authored `.mmd` files and the skill source code shows that the skill's losses stem from tool behavior and rule constraints rather than agent mistakes:

1. **`--extract` leaks layout mutations into the text judges read.**
   - **Flowchart:** The authored `onboarding.mmd` wrote a clean four-way fan-in (`enrol_mdm & order_card & setup_payroll & issue_briefing --> send_welcome`). During layout, `add_connector_pairs` in `scripts/layout_engine.py` split three of those edges into connector circles (`c_a_in_1..3` / `c_a_out`), and `toMermaid` in `assets/types/flowchart/mermaid.js` emitted those layout connectors instead of collapsing them back into direct edges, causing the judge to misread the four-way join.
   - **Sequence:** `apply_sequence_defaults` adds `lifespans` and `column` onto participants, so `--extract` emits `%% @lifespans` and `%% @column` layout directives that the author never wrote.
   - **ERD:** `toMermaid` in `assets/types/erd/mermaid.js` passes `%% @note` text through `quote()`, escaping `;` as `#59;` inside comment lines (`tenant_id#59;`).

2. **Skill rules and audit limits forced content losses.**
   - **Sequence early-termination and nesting depth:** `assets/types/sequence/mermaid.js` converts `break` frames to `opt` (`if (kw === 'break') { b.kind = 'opt'; }`), stripping early-exit semantics so fraud rejection and payment decline branches appear to fall through into subsequent phases. Meanwhile, `MAX_FRAGMENT_DEPTH = 3` in `scripts/audit_sequence.py` counts phase `rect` blocks (`kind: "group"`) as depth 1, leaving only two control-frame levels inside a phase. That triggered `[WARN] Frames nest 4 deep` on run 1 and forced the agent to flatten the Login retry block and push the account-lockout note outside the frame.
   - **Flowchart rule constraints:** `references/types/flowchart.md` pushed short thresholds (`> grade 7`) and retry bounds (`repeat once`) out of decision labels into detached flag notes, and the authored chart omitted an explicit start event pill before `Raise Hiring Request`.
   - **ERD placeholder types and hidden invariants:** `references/types/erd.md` instructed agents to write `_` / `_?` whenever a prose brief omits SQL types, and table/column invariants (`append-only`, `immutable after signed_at`, `unique per tenant`) were placed in trailing `%% @note` comments rather than inline column notes.
   - **Use case hidden IDs and dropped qualifiers:** `references/types/usecase.md` placed `FR-01`..`FR-53` in trailing `%% @refs` lines instead of use case labels, omitted `«include»`/`«extend»` stereotype markers in extracted edge text, and dropped short actor qualifiers (`(not logged in)`, `(student card)`) due to the three-word actor cap.

3. **Call overhead (12.25 calls vs. 3.50 for `mermaid-md`).**
   - Ten of the 49 tool calls across the four `skill` runs were Windows shell encoding and quoting retries (`PYTHONIOENCODING`, `node -e`), plus separate follow-up calls to verify outputs or remove scratch `.mmd` files.

4. **Visual routing quality on dense diagrams (outside text-only judging).**
   - `layout_engine.py` reported 17 entity pass-throughs on the 49-table ERD and 9 use-case pass-throughs on the 45-use-case library diagram (`Quality score 0/100`).

---

## Improvement plan

### P1. Sequence: first-class `break` fragments and phase-aware nesting depth

Files: `scripts/audit_sequence.py`, `scripts/disk_format.py`, `assets/types/sequence/mermaid.js`, `assets/types/sequence/sequence.js`, `references/types/sequence.md`

1. Add `"break"` to `FRAGMENT_KINDS` in `scripts/audit_sequence.py` and handle it in `scripts/disk_format.py`.
2. Preserve `b.kind = 'break'` in `fromMermaid` and emit `break <label>` in `toMermaid` (`assets/types/sequence/mermaid.js`), and render the `break` frame badge in `assets/types/sequence/sequence.js`.
3. Exclude phase `group` blocks (`rect`) from `SequenceAudit.depth()` in `scripts/audit_sequence.py` so a phase `rect` containing up to three nested control frames (`alt`/`loop`/`opt`/`break`) passes without warnings on the first run.
4. Update `references/types/sequence.md` to require `break` on fatal reject/decline branches whenever downstream phases follow in separate `rect` blocks, and to require `opt` guards (such as 3-D Secure) to cite the upstream condition explicitly (`opt 3-D Secure required (score 300-700)`).

### P2. Clean `--extract`: strip layout-only artifacts so extracted Mermaid is pure logical source

Files: `scripts/disk_format.py`, `assets/types/flowchart/mermaid.js`, `assets/types/erd/mermaid.js`

1. Collapse engine-inserted connector pairs (`c_<letter>_in*` / `c_<letter>_out`) back into direct `from --> to` edges during flowchart `--extract` / `toMermaid` (mirroring `collapseConnectors` in `assets/types/flowchart/engine.js`) so multi-branch joins extract cleanly as `a & b & c --> target`.
2. Strip engine-assigned `column` and `lifespans` layout defaults in sequence `authoring_json` / `--extract` unless explicitly set by the author.
3. Stop escaping `;` as `#59;` inside `%% @note` and `%% @entityNote` comment lines in `assets/types/erd/mermaid.js`.

### P3. Keep IDs, rules, thresholds, and types visible in the diagram text

Files: `references/types/flowchart.md`, `references/types/erd.md`, `references/types/usecase.md`, `assets/types/usecase/mermaid.js`

1. **Flowchart (`references/types/flowchart.md`):** Require retry and repeat limits (such as repeating probation review once) to be modeled as explicit decision nodes per Rule 6 rather than notes; keep short policy thresholds (such as `> Grade 7`) inside decision labels; require an explicit start pill when a process trigger precedes the first task.
2. **ERD (`references/types/erd.md`):** When a prose brief omits column types, instruct the author to infer standard SQL types (`uuid`, `text`, `int`, `numeric`, `boolean`, `date`, `timestamptz`) instead of emitting `_` placeholders, and record column/row invariants (`"append-only"`, `"immutable after signed_at"`, `"unique per tenant"`) as inline column `"..."` notes in addition to table `%% @note` directives.
3. **Use Case (`references/types/usecase.md`, `assets/types/usecase/mermaid.js`):** Include requirement IDs directly in use case labels (`"FR-01: Search catalogue"`) or have `toMermaid` include `@refs` in extracted labels, emit guillemet stereotypes (`«include»`, `«extend»`) cleanly, and retain short actor qualifiers (`(not logged in)`, `(student card)`) on actor labels or attached notes.

### P4. Cut tool calls from 12.25 to 3 calls per diagram

Files: `scripts/layout_engine.py`, `scripts/mermaid_io.mjs`, `scripts/engine_runner.py`, `SKILL.md`

1. Enforce UTF-8 on `stdin`/`stdout`/`stderr` in `scripts/mermaid_io.mjs` and subprocess invocations in `scripts/engine_runner.py` so Windows runs never need `PYTHONIOENCODING` or shell-quoting retries.
2. Add `--rm-input` to `scripts/layout_engine.py --layout` to delete the scratch `.mmd` file automatically once layout finishes with `[DONE]`, and print the deliverable byte size on the `[OK]` line (`[OK] Generated interactive <type>: <path> (<bytes> B)`).
3. Update `SKILL.md` Procedure: New Diagram to use `--rm-input` in Step 3 so creating a new diagram takes three tool calls total: Read the type reference, Write `<scratch.mmd>`, and Run `layout_engine.py --layout <scratch.mmd> -o <target.html> --rm-input`.

### P5. Visual layout pass-throughs on large ERD and Use Case diagrams

Files: `assets/types/erd/engine.js`, `assets/types/usecase/engine.js`

1. Check the Benchmark 2 49-table ERD and 3-system library use case diagrams in as large golden fixtures under `dev/fixtures/`.
2. Improve edge clearance and node placement in `assets/types/erd/engine.js` and `assets/types/usecase/engine.js` so large schemas and multi-subject use case diagrams avoid pass-through lines (`Quality score >= 90` instead of `0/100`).

---

## Expected outcome and acceptance criteria

| Metric | Benchmark 2 (`skill`) | Target after P1–P5 | Benchmark 2 (`mermaid-md`) | Benchmark 2 (`drawio`) |
|---|---:|---:|---:|---:|
| Mean tool calls | 12.25 | **3.0–3.5** | 3.50 | 15.50 |
| Mean agent time | 86.72 s | **~40–45 s** | 42.72 s | 369.44 s |
| Valid render rate | **4/4** | **4/4** | 3/4 | 3/4 |
| Authored size | **6.73 KB** | **~6.5–7.5 KB** | 6.81 KB | 108.8 KB |
| Judge mean (5 criteria) | 7.55 | **>= 8.8** | 7.90 | 5.50 |

Acceptance requires:

1. All existing verification scripts (`dev/test_audit_*.py`, `dev/check_mermaid.mjs`, `dev/check_themes.py`, `dev/check_golden.py`, `dev/check_extract.py`, and browser E2E suites) pass after each phase.
2. Re-running Benchmark 2 across all four briefs yields 4/4 clean `[DONE]` builds on run 1 with 3 tool calls per diagram, clean `--extract` round-trips, and `skill` winning all four types on both text quality and visual rendering.
