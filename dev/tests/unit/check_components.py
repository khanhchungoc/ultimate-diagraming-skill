#!/usr/bin/env python3
"""Shared-element drift check (plan: dev/plans/plan-review-fixes.md, Phase 5 step 7).

Every diagram type uses the shared elements (references/ui-elements.md): the collapse chevron, the connection port, the edge label and the
item states are defined once in assets/components and built with ui.chevron / ui.port. A type's own CSS (assets/types/*/*.css) may place or size
them, never restyle them, and never copy them. Rules:
  chevron-port-copy    a class for a shared concept: a name with a chevron, chev, port or handle part (`.erd-chevron`, `.c4-port`, `.gantt-port-l`,
                       `.frame-chev`, `.erd-handle`) that is not one of the shared classes (chevron, chevron-spacer, port, port-top|right|bottom|left|end)
  edge-label-style     a `.edge-label` rule that sets anything but position: position, left, top, right, bottom, transform, translate, z-index,
                       display, max-width, visibility, opacity (and custom properties). The look is components/edge.css; `.edge-label--wrap` and
                       `.edge-label--single` are the only modifiers
  state-name           a state class outside the convention in type CSS or JS: `.selected`, `.is-editing`, `.is-collapsed`, `.is-dim`, `.is-dragging`
                       are the names; `.editing`, `.collapsed`, `.dragging`, `.dim`, `.dimmed` are not
A justified exception goes on the same line: `/* components-ok: <reason> */` (CSS) or `// components-ok: <reason>` (JS).
ALLOW lists files that still hold the old copies, each with the follow-up that removes it.

Usage: python dev/tests/unit/check_components.py [-v|--verbose]   |   --list-rules   |   --self-test
Exit codes: 0 clean, 1 findings or self-test failure.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TYPES_DIR = ROOT / "assets" / "types"
RULES = {
    "chevron-port-copy": "a type class for the shared chevron, port or handle (use ui.chevron / ui.port)",
    "edge-label-style": "a .edge-label rule that styles the label beyond its position (the look is components/edge.css)",
    "state-name": "a state class outside the convention (.selected .is-editing .is-collapsed .is-dim .is-dragging)",
}
ALLOW: dict = {}   # files still holding pre-Phase-5 copies, each with the follow-up that removes it
SHARED_CLASSES = {"chevron", "chevron-spacer", "port", "port-top", "port-right", "port-bottom", "port-left", "port-end"}
SHARED_PARTS = {"chevron", "chev", "port", "handle"}
LABEL_OK_PROPS = {"position", "left", "top", "right", "bottom", "transform", "transform-origin", "translate", "z-index", "display", "max-width", "visibility", "opacity"}
BAD_STATES = {"editing", "collapsed", "dragging", "dim", "dimmed"}
# TODO(Phase 6, shared notes module): note cards still toggle `.dragging` in each type's note functions (and components/note.css), so the JS check
# skips `dragging`; drop this set once the notes module renames it and the JS check can cover it.
JS_SKIP_STATES = {"dragging"}
OK_RE = re.compile(r"(?:/\*|//)\s*components-ok:\s*(?!\*/)\S")
CLASS_RE = re.compile(r"\.(-?[A-Za-z_][\w-]*)")
JS_STATE_RE = re.compile(r"classList\.(?:add|remove|toggle|contains)\(\s*['\"]([\w-]+)['\"]|className\s*[+=]+\s*['\"][^'\"]*\b(" + "|".join(BAD_STATES) + r")\b")


def blank_comments(css: str) -> str:
    """The text with every /* */ comment replaced by spaces (newlines kept), so offsets and line numbers stay the same."""
    return re.sub(r"/\*.*?\*/", lambda m: re.sub(r"[^\n]", " ", m.group(0)), css, flags=re.S)


def rules_of(css: str):
    """Yield (prelude, prelude_start, body, body_start) for every style rule; at-rule blocks are walked into, their own prelude skipped."""
    text = blank_comments(css)
    out = []
    start = 0
    stack = []   # (prelude, prelude_start, body_start)
    i = 0
    while i < len(text):
        c = text[i]
        if c == "{":
            stack.append((text[start:i], start, i + 1))
            start = i + 1
        elif c == "}":
            if stack:
                prelude, pstart, bstart = stack.pop()
                if not prelude.strip().startswith("@"):
                    out.append((prelude, pstart, text[bstart:i], bstart))
            start = i + 1
        elif c == ";":
            start = i + 1
        i += 1
    return out


def line_of(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def declarations(body: str, body_start: int):
    """(property, offset) for each declaration directly in a rule body (no nested blocks reach here: nested rules were taken out as their own rule)."""
    pos = 0
    for part in body.split(";"):
        m = re.match(r"\s*(-{0,2}[A-Za-z][\w-]*)\s*:", part)
        if m:
            yield m.group(1), body_start + pos + m.start(1)
        pos += len(part) + 1


def scan_css(css: str):
    """[(line, rule, snippet)] for one type stylesheet."""
    out = []
    lines = css.split("\n")
    ok = lambda ln: bool(OK_RE.search(lines[ln - 1]))   # noqa: E731
    text = blank_comments(css)
    for prelude, pstart, body, bstart in rules_of(css):
        sels = [s for s in re.split(r",(?![^(]*\))", prelude) if s.strip()]
        for m in CLASS_RE.finditer(prelude):
            name = m.group(1)
            ln = line_of(text, pstart + m.start())
            if ok(ln):
                continue
            parts = set(name.split("-"))
            if name not in SHARED_CLASSES and parts & SHARED_PARTS and not name.startswith("edge-label"):
                out.append((ln, "chevron-port-copy", f".{name}"))
            if name in BAD_STATES and not (name == "dragging" and re.search(r"\.note\b", prelude)):   # note cards: the notes module renames it
                out.append((ln, "state-name", f".{name}"))
        # a .edge-label rule: position only
        for sel in sels:
            if any(c == "edge-label" for c in (m.group(1) for m in CLASS_RE.finditer(sel))):
                rule_line = line_of(text, bstart)
                for prop, off in declarations(body, bstart):
                    if prop.startswith("--") or prop in LABEL_OK_PROPS or prop == "-webkit-user-select":
                        continue
                    ln = line_of(text, off)
                    if ok(ln) or ok(rule_line):
                        continue
                    out.append((ln, "edge-label-style", f"{sel.strip()} {{ {prop} }}"))
                break
    return out


def scan_js(js: str):
    out = []
    for ln, line in enumerate(js.split("\n"), 1):
        if OK_RE.search(line) or line.lstrip().startswith("//"):
            continue
        for m in JS_STATE_RE.finditer(line):
            name = m.group(1) or m.group(2)
            if name in BAD_STATES and name not in JS_SKIP_STATES:
                out.append((ln, "state-name", name))
    return out


def type_files():
    for f in sorted(TYPES_DIR.glob("*/*")):
        if f.suffix in (".css", ".js"):
            yield f


def self_test():
    css = lambda t: [(r) for _, r, _ in scan_css(t)]   # noqa: E731
    assert css(".erd-chevron { color: red }") == ["chevron-port-copy"]
    assert css(".gantt-port-l, .gantt-port-r { top: 1px }") == ["chevron-port-copy"] * 2
    assert css(".frame-chev svg { x: y }") == ["chevron-port-copy"]
    assert css(".erd-handle { x: y }") == ["chevron-port-copy"]
    assert css(".chevron, .port, .port-end, .chevron-spacer { margin: 0 }") == []
    assert css(".uc-subject .chevron { margin: 0 } .gantt-bar > .port-left { left: -4px }") == []
    assert css(".erd-chevron { x: y } /* components-ok: legacy */") == []
    assert css(".c4-port { x: y } /* components-ok: legacy */\n.c4-port { x: y }") == ["chevron-port-copy"]
    assert css("@media (hover: none) { .c4-port { x: y } }") == ["chevron-port-copy"]
    assert css("/* the .erd-chevron is gone */ .a { color: red }") == []
    assert css(".edge-label { left: 1px; transform: translate(-50%, -50%); z-index: 3; max-width: 9px; display: none }") == []
    assert css(".edge-label { padding: 3px; font-size: 1px }") == ["edge-label-style"] * 2
    assert css(".edge-label:is(.hl-in, .hl-out) { border-color: red }") == ["edge-label-style"]
    assert css(".edge-label {\n padding: 3px; /* components-ok: flowchart clip */\n color: red; }") == ["edge-label-style"]
    assert css(".edge-label { /* components-ok: whole rule */\n padding: 3px;\n color: red; }") == []
    assert css(".edge-label { padding: 3px } /* components-ok: pill */") == []
    assert css(".edge-label-text { color: red } .edge-label--single { color: red } .c4-label { padding: 0 }") == []
    assert css(".edge-label { --edge-in: red; opacity: .3; visibility: hidden }") == []
    assert css("@media (x) { body.exporting .edge-label { padding: 0 } }") == ["edge-label-style"]
    assert css(".erd-entity.editing { x: y }") == ["state-name"]
    assert css(".a.is-editing, .b.is-dim, .c.is-dragging, .d.is-collapsed, .e.selected { x: y }") == []
    assert css(".seq-participant.dragging { x: y }") == ["state-name"]
    assert css(".thing.dim { x: y }") == ["state-name"]
    assert css("#c .note.dragging { x: y }") == []
    assert css("a { color: red }\n@keyframes k { from { x: y } to { x: z } }") == []
    js = lambda t: [r for _, r, _ in scan_js(t)]   # noqa: E731
    assert js("el.classList.add('editing');") == ["state-name"]
    assert js("el.classList.toggle('dimmed', on);") == ["state-name"]
    assert js("el.classList.add('dragging');") == []   # note cards, see JS_SKIP_STATES
    assert js("el.classList.add('is-editing'); el.classList.add('selected')") == []
    assert js("el.classList.add('editing'); // components-ok: flowchart") == []
    assert js("// el.classList.add('editing')") == []
    print("self-test passed")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--list-rules", action="store_true")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("-v", "--verbose", action="store_true", help="print passing rules and allow-listed files")
    args = ap.parse_args()
    if args.list_rules:
        for name, desc in RULES.items():
            print(f"{name}: {desc}")
        return 0
    if args.self_test:
        self_test()
        return 0
    findings = []
    for f in type_files():
        rel = str(f.relative_to(ROOT))
        if rel in ALLOW:
            if args.verbose:
                print(f"[SKIP] {rel}: {ALLOW[rel]}")
            continue
        text = f.read_text(encoding="utf-8")
        for ln, rule, snip in (scan_css(text) if f.suffix == ".css" else scan_js(text)):
            findings.append((rel, ln, rule, snip))
    for rel, ln, rule, snip in findings:
        print(f"{rel}:{ln}: {rule}: {snip}")
    counts = {r: sum(1 for f in findings if f[2] == r) for r in RULES}
    for rule, n in counts.items():
        if n or args.verbose:
            print(f"[{'FAIL' if n else 'PASS'}] {rule}: {n}")
    print(f"{sum(1 for n in counts.values() if not n)}/{len(counts)} component rules passed" + (f" ({len(findings)} finding(s))" if findings else ""))
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
