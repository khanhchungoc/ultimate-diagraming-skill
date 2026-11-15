#!/usr/bin/env python3
"""Design-token check (plan: dev/plans/plan-design-tokens.md, Phase 1 step 6, Phase 2 step 6, Phase 4 step 8).

Scans assets/shell/ and assets/types/ (*.css, *.js, *.html; never assets/tokens/ or generated output) for values
that belong in assets/tokens/default.json. Rules by phase (a later phase includes the earlier ones):
  1  color-literal, font-family-literal, token-declaration
  2  type-scale-literal (font-size, font-weight, line-height, letter-spacing, border-radius, box-shadow)
  4  svg-literal, lane-icon (names in references/types/flowchart.md "## Lane icons" missing from assets/icons/default.json)
A justified exception goes on the same line: `/* tokens-ok: <reason> */` or `// tokens-ok: <reason>`.

Usage: python dev/check_tokens.py [--phase N]   (default 1)   |   --list-rules   |   --self-test
Exit codes: 0 clean, 1 findings or self-test failure.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULES = {
    "color-literal": (1, "hex, rgb(, rgba(, hsl(, hsla( colour in CSS/JS"),
    "font-family-literal": (1, "font-family value that is not var(...) or inherit"),
    "token-declaration": (1, "--name: declared in a :root block of asset CSS"),
    "type-scale-literal": (2, "literal font-size/weight, line-height, letter-spacing, border-radius, box-shadow"),
    "svg-literal": (4, "<svg literal outside assets/icons/"),
    "lane-icon": (4, "lane icon name missing from assets/icons/default.json"),
}
HEX = r"#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])"
FUNC_RE = re.compile(r"(?<![\w-])(?:rgba?|hsla?)\(")
OK_RE = re.compile(r"(?:/\*|//)\s*tokens-ok:\s*(?!\*/)\S")
SELECTOR_CALL = re.compile(r"(?:querySelector(?:All)?|closest|matches|getElementById)\(\s*['\"]$")
JS_HEX = re.compile(r"(?:(?<=['\"`])|(?<=[:(,=])\s*)(?<![\w&])" + HEX)
CSS_HEX = re.compile(r"(?<![\w&])" + HEX)
SCALE_RE = re.compile(r"(?<![\w-])(font-size|font-weight|line-height|letter-spacing|border-radius|box-shadow)\s*:\s*([^;}]+)")
SCALE_OK = {"0", "none", "inherit", "normal"}
FONT_RE = re.compile(r"(?<![\w-])font-family\s*:\s*([^;}]*)")
CUSTOM_RE = re.compile(r"(?<![\w-])--[\w-]+\s*:")
# a selector that ends in :root (plus attribute or pseudo-class parts); `:root[data-theme="dark"] .x` is a scoped rule, not a token block
ROOT_SEL = re.compile(r"(^|\s)(html)?:root(\[[^\]]*\]|:[\w-]+(\([^)]*\))?)*$")


def blank(text: str, pattern: str) -> str:
    """Replace comments by spaces so offsets and line numbers stay the same."""
    return re.sub(pattern, lambda m: re.sub(r"[^\n]", " ", m.group()), text, flags=re.S)


def root_declarations(css: str):
    """Yield offsets of `--name:` declarations whose innermost block selector is :root."""
    stack, buf, last = [], "", 0
    events = sorted([(m.start(), "d") for m in CUSTOM_RE.finditer(css)] +
                    [(m.start(), m.group()) for m in re.finditer(r"[{};]", css)])
    for pos, kind in events:
        buf += css[last:pos]
        last = pos + (kind != "d")
        if kind == "{":
            stack.append(buf.strip())
            buf = ""
        elif kind == "}":
            if stack:
                stack.pop()
            buf = ""
        elif kind == ";":
            buf = ""
        elif stack and any(ROOT_SEL.search(sel.strip()) for sel in stack[-1].split(",")):
            yield pos


def scan_text(kind: str, text: str, phase: int = 1):
    """kind is css, js or html. Returns [(line, rule, snippet)]."""
    raw_lines = text.split("\n")
    if kind == "html":
        # only <style>/<script> bodies carry CSS/JS; other markup is blanked, offsets kept
        parts, out = [], text
        for tag, k in (("style", "css"), ("script", "js")):
            for m in re.finditer(rf"<{tag}\b[^>]*>(.*?)</{tag}>", text, flags=re.S | re.I):
                parts.append((m.start(1), m.group(1), k))
        found = []
        if phase >= 4:
            found += [(text.count("\n", 0, m.start()) + 1, "svg-literal") for m in re.finditer(r"<svg\b", text)]
        for start, body, k in parts:
            base = text.count("\n", 0, start)
            found += [(ln + base, r, s) for ln, r, s in scan_text(k, body, phase) if r != "svg-literal"]
        res = [(ln, r, raw_lines[ln - 1].strip()[:100] if r == "svg-literal" else s) for ln, r, *s in
               [(f[0], f[1], *(f[2:])) for f in found]]
        return [(ln, r, s or raw_lines[ln - 1].strip()[:100]) for ln, r, s in res if not OK_RE.search(raw_lines[ln - 1])]
    clean = blank(text, r"/\*.*?\*/")
    if kind == "js":
        clean = blank(clean, r"(?<![:\w'\"\\])//[^\n]*")
    lines = clean.split("\n")
    hits = []  # (line number, rule, snippet)
    for i, line in enumerate(lines, 1):
        def add(rule, snip):
            hits.append((i, rule, snip.strip()[:100]))
        if kind == "css":
            tail = line.rsplit("{", 1)[-1]
            for m in CSS_HEX.finditer(tail):
                if ":" in tail[:m.start()] and not tail[:m.start()].endswith("url("):
                    add("color-literal", m.group())
            for m in FONT_RE.finditer(line):
                v = m.group(1).strip()
                if not re.match(r"(var\(|inherit\b)", v):
                    add("font-family-literal", m.group())
            if phase >= 2:
                for m in SCALE_RE.finditer(line):
                    v = re.sub(r"\s*!important", "", m.group(2)).strip()
                    # tokens only: a value with a number left once var(...) is removed is a literal (max(var(--a), calc(var(--b) * var(--c))) passes)
                    if (v not in SCALE_OK) and (not v.startswith(("var(", "max(", "min(", "calc(", "clamp(")) or re.search(r"\d", re.sub(r"var\([^)]*\)", "", v))):
                        add("type-scale-literal", m.group())
        else:
            for m in JS_HEX.finditer(line):
                before = line[:m.start()]
                if not before.rstrip().endswith("url(") and not SELECTOR_CALL.search(before):
                    add("color-literal", m.group().strip())
        for m in FUNC_RE.finditer(line):
            add("color-literal", line[m.start():m.start() + 30])
        if phase >= 4 and "<svg" in line:
            add("svg-literal", line)
    if kind == "css":
        for pos in root_declarations(clean):
            ln = clean.count("\n", 0, pos) + 1
            hits.append((ln, "token-declaration", clean[pos:pos + 40].split(";")[0].strip()))
    return sorted((ln, r, s) for ln, r, s in hits if not OK_RE.search(raw_lines[ln - 1]))


def asset_files():
    files = []
    for base in ("assets/shell", "assets/types"):
        for ext in ("css", "js", "html"):
            files += (ROOT / base).rglob(f"*.{ext}")
    return sorted(files)


def lane_icon_findings():
    md = ROOT / "references/types/flowchart.md"
    reg = ROOT / "assets/icons/default.json"
    if not reg.is_file():
        print("note: assets/icons/default.json does not exist yet, lane-icon check skipped")
        return []
    data = json.loads(reg.read_text(encoding="utf-8"))
    known = set(data.get("icons", data))
    out, inside = [], False
    for n, line in enumerate(md.read_text(encoding="utf-8").split("\n"), 1):
        if line.startswith("## "):
            inside = line.strip() == "## Lane icons"
        m = inside and re.match(r"\|\s*`([\w-]+)`\s*\|", line)
        if m and m.group(1) not in known:
            out.append((str(md.relative_to(ROOT)), n, "lane-icon", m.group(1)))
    return out


def self_test():
    def rules(kind, text, phase=1):
        return [r for _, r, _ in scan_text(kind, text, phase)]
    for t in ("a{color:#abc}", "a{color:#aabbcc;}", "a{fill:#aabbccdd}", "a{color: rgb(1,2,3)}", "a{color:hsla(0,0%,0%,.5)}"):
        assert rules("css", t) == ["color-literal"], t
    assert rules("js", "el.style.color = '#fff';") == ["color-literal"]
    assert rules("js", "const c = {a:'#aabbcc'}") == ["color-literal"]
    assert rules("js", "x = 'rgba(0,0,0,.5)'") == ["color-literal"]
    for t in ("#seq-canvas { margin:0 }", "#add,\n#bad {margin:0}", "a{fill:url(#arrowhead)}", "a{fill:url(#add)}",
              "a{content:'&#169;'}", "a{width:10px}"):
        assert rules("css", t) == [], t
    for t in ("q('#export-menu')", "document.querySelector('#fed')", "location.hash = '#drag-edge'",
              "s = '&#123;'", "u = 'url(#add)'", "// color: #fff"):
        assert rules("js", t) == [], t
    assert rules("css", "a{color:#fff /* tokens-ok: brand mark */}") == []
    assert rules("js", "x = '#fff'; // tokens-ok: brand mark") == []
    assert rules("css", "a{color:#fff /* tokens-ok: */}") == ["color-literal"]
    assert rules("css", "a{font-family: Arial, sans-serif}") == ["font-family-literal"]
    assert rules("css", "a{font-family: var(--font); b{}} c{font-family:inherit}") == []
    assert rules("css", ":root{--a:1}") == ["token-declaration"]
    assert rules("css", ":root[data-theme='dark']{\n--a:1}") == ["token-declaration"]
    assert rules("css", "@media (x){:root{--a:1}}") == ["token-declaration"]
    assert rules("css", ".swatch-scope{--sw:red}") == []
    assert rules("css", ":root[data-theme='dark'] .swatch-scope{--sw:red}") == []
    assert rules("css", ".a, :root{--a:1}") == ["token-declaration"]
    assert rules("css", "a{font-size:12px;border-radius:0;box-shadow:none}") == []
    assert sorted(rules("css", "a{font-size:12px;font-weight:600;line-height:1.2;letter-spacing:1px;"
                               "border-radius:4px;box-shadow:0 0 2px #000}", 2)).count("type-scale-literal") == 6
    assert rules("css", "a{font-size:var(--t-body);line-height:normal;box-shadow:var(--s)}", 2) == []
    assert rules("css", "a{font-size:max(var(--a), calc(var(--b) * var(--inv)))}", 2) == []
    assert rules("css", "a{font-size:max(13px, var(--b))}", 2) == ["type-scale-literal"]
    assert rules("html", "<p>&#169; <svg></svg></p>") == []
    assert rules("html", "<p><svg></svg></p>", 4) == ["svg-literal"]
    assert rules("html", "<style>a{color:#fff}</style><script>x='#fff'</script>") == ["color-literal"] * 2
    assert rules("js", "el.innerHTML = '<svg></svg>'", 4) == ["svg-literal"]
    print("self-test passed")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--phase", type=int, default=1)
    ap.add_argument("--list-rules", action="store_true")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.list_rules:
        for name, (ph, desc) in RULES.items():
            print(f"{name} (phase {ph}{', on' if ph <= args.phase else ', off'}): {desc}")
        return 0
    if args.self_test:
        self_test()
        return 0
    findings = []
    for f in asset_files():
        rel = str(f.relative_to(ROOT))
        for ln, rule, snip in scan_text(f.suffix[1:], f.read_text(encoding="utf-8"), args.phase):
            findings.append((rel, ln, rule, snip))
    if args.phase >= 4:
        findings += lane_icon_findings()
    for rel, ln, rule, snip in findings:
        print(f"{rel}:{ln}: {rule}: {snip}")
    counts = {r: sum(1 for f in findings if f[2] == r) for r, (ph, _) in RULES.items() if ph <= args.phase}
    for rule, n in counts.items():
        print(f"[{'FAIL' if n else 'PASS'}] {rule}: {n}")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
