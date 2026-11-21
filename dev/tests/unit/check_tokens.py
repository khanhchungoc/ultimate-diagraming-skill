#!/usr/bin/env python3
"""Design-token check (plan: dev/plans/plan-design-tokens.md, Phase 1 step 6, Phase 2 step 6, Phase 4 step 8).

Scans assets/shell/, assets/components/ and assets/types/ (*.css, *.js, *.html; never assets/tokens/ or generated output) for values
that belong in assets/tokens/default.json. Rules by phase (a later phase includes the earlier ones):
  1  color-literal, font-family-literal, token-declaration
  2  type-scale-literal (font-size, font-weight, line-height, letter-spacing, border-radius, box-shadow)
  4  svg-literal, icon-name, lane-icon
     svg-literal: an inline icon, that is an <svg whose viewBox is the icon grid ("0 0 24 24"). Icons come from the registry
       (assets/icons/default.json), as {{icon:name}} in a template or ui.icon('name') in a script. Any other <svg is drawing, not an
       icon, and is allowed: the diagram's own SVG roots (stage.html), drawn shapes and markers (their viewBox is the shape's), and
       the strings that build an SVG export or a Mermaid-free copy. The rule is the grid, not the word "<svg".
     icon-name: a {{icon:name}} placeholder or a ui.icon('name') / ui.iconEl('name') call whose name is not in the registry
       (a name built at run time, such as `kind-${k}`, is not checked here).
     lane-icon: a name in references/types/flowchart.md "## Lane icons" missing from the registry
A justified exception goes on the same line: `/* tokens-ok: <reason> */` or `// tokens-ok: <reason>`.

Usage: python dev/check_tokens.py [--phase N] [-v|--verbose]   (default phase 1)   |   --list-rules   |   --self-test
Exit codes: 0 clean, 1 findings or self-test failure.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RULES = {
    "color-literal": (1, "hex, rgb(, rgba(, hsl(, hsla( colour in CSS/JS"),
    "font-family-literal": (1, "font-family value that is not var(...) or inherit"),
    "token-declaration": (1, "--name: declared in a :root block of asset CSS"),
    "type-scale-literal": (2, "literal font-size/weight, line-height, letter-spacing, border-radius, box-shadow"),
    "svg-literal": (4, "inline icon: <svg viewBox=\"0 0 24 24\"> outside assets/icons/ (other <svg is drawing, allowed)"),
    "icon-name": (4, "{{icon:name}} or ui.icon('name') with a name that is not in assets/icons/default.json"),
    "lane-icon": (4, "lane icon name missing from assets/icons/default.json"),
}
HEX = r"#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])"
FUNC_RE = re.compile(r"(?<![\w-])(?:rgba?|hsla?)\(")
OK_RE = re.compile(r"(?:/\*|//)\s*tokens-ok:\s*(?!\*/)\S")
SELECTOR_CALL = re.compile(r"(?:querySelector(?:All)?|closest|matches|getElementById)\(\s*['\"]$")
JS_HEX = re.compile(r"(?:(?<=['\"`])|(?<=[:(,=])\s*)(?<![\w&])" + HEX)
CSS_HEX = re.compile(r"(?<![\w&])" + HEX)
SCALE_RE = re.compile(r"(?<![\w-])(font-size|font-weight|line-height|letter-spacing|border-radius|box-shadow|filter)\s*:\s*([^;}]+)")
SCALE_OK = {"0", "none", "inherit", "normal"}
FONT_RE = re.compile(r"(?<![\w-])font-family\s*:\s*([^;}]*)")
CUSTOM_RE = re.compile(r"(?<![\w-])--[\w-]+\s*:")
# a selector that ends in :root (plus attribute or pseudo-class parts); `:root[data-theme="dark"] .x` is a scoped rule, not a token block
ICON_SVG = re.compile(r'<svg\b[^>]*\bviewBox\s*=\s*["\']0 0 24 24["\']')
ICON_USE = re.compile(r"\{\{icon:([\w-]+)|\bicon(?:El)?\(\s*['\"]([\w-]+)['\"]\s*(?=[,)])")
ROOT_SEL = re.compile(r"(^|\s)(html)?:root(\[[^\]]*\]|:[\w-]+(\([^)]*\))?)*$")


def strip_calls(v: str, name: str) -> str:
    """Remove every `name(...)` call, parentheses balanced."""
    while (m := re.search(rf"(?<![\w-]){name}\(", v)):
        depth, i = 0, m.end() - 1
        while i < len(v):
            depth += (v[i] == "(") - (v[i] == ")")
            i += 1
            if not depth:
                break
        v = v[:m.start()] + " " + v[i:]
    return v


def scale_literal(prop: str, v: str) -> bool:
    """Is `v` a literal value for `prop`? A bare 0, var(...) and color-mix(...) (a colour: colour-literal checks its parts) are not
    literals, so `inset 0 0 0 var(--ring-thin) color-mix(...)` and `var(--radius-md) var(--radius-md) 0 0` pass."""
    v = re.sub(r"\s*!important", "", v).strip()
    if prop == "filter":  # only the shadow inside drop-shadow(...) is a scale value; brightness(0.92) and friends are not
        m = re.search(r"drop-shadow\((.*)\)", v)
        if not m:
            return False
        v = m.group(1)
    if v in SCALE_OK:
        return False
    rest = strip_calls(strip_calls(v, "color-mix"), "var")
    has_digit = re.search(r"\d", re.sub(r"(?<![\w.%-])0(?![\w.%-])", "", rest))
    if prop in ("box-shadow", "filter"):
        return bool(has_digit)
    return bool(has_digit) or not v.startswith(("var(", "max(", "min(", "calc(", "clamp(", "0"))


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
            found += [(text.count("\n", 0, m.start()) + 1, "svg-literal") for m in ICON_SVG.finditer(text)]
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
                    # tokens only: a value with a number left once var(...) is removed is a literal (max(var(--a), calc(var(--b) * var(--c))) passes)
                    if scale_literal(m.group(1), m.group(2)):
                        add("type-scale-literal", m.group())
        else:
            for m in JS_HEX.finditer(line):
                before = line[:m.start()]
                if not before.rstrip().endswith("url(") and not SELECTOR_CALL.search(before):
                    add("color-literal", m.group().strip())
        for m in FUNC_RE.finditer(line):
            add("color-literal", line[m.start():m.start() + 30])
        if phase >= 4 and ICON_SVG.search(line):
            add("svg-literal", line)
    if kind == "css":
        for pos in root_declarations(clean):
            ln = clean.count("\n", 0, pos) + 1
            hits.append((ln, "token-declaration", clean[pos:pos + 40].split(";")[0].strip()))
    return sorted((ln, r, s) for ln, r, s in hits if not OK_RE.search(raw_lines[ln - 1]))


def asset_files():
    files = []
    for base in ("assets/shell", "assets/components", "assets/types"):
        for ext in ("css", "js", "html"):
            files += (ROOT / base).rglob(f"*.{ext}")
    return sorted(files)


def registry_names():
    reg = ROOT / "assets/icons/default.json"
    if not reg.is_file():
        return None
    data = json.loads(reg.read_text(encoding="utf-8"))
    return set(data.get("icons", data))


def icon_name_findings(kind, text, known):
    """[(line, 'icon-name', name)] for every icon name used in `text` that the registry lacks."""
    return [(text.count("\n", 0, m.start()) + 1, "icon-name", m[1] or m[2]) for m in ICON_USE.finditer(text) if (m[1] or m[2]) not in known]


def lane_icon_findings():
    """Every lane icon (assets/icons/lanes.json, the picking table, and the names listed in the flowchart reference's
    "## Lane icons" section) must exist in the registry, and the reference must list exactly the table's icons."""
    md, table = ROOT / "references/types/flowchart.md", ROOT / "assets/icons/lanes.json"
    if not (ROOT / "assets/icons/default.json").is_file():
        print("note: assets/icons/default.json does not exist yet, lane-icon check skipped")
        return []
    known = registry_names()
    rows = [r["icon"] for r in json.loads(table.read_text(encoding="utf-8"))["lanes"]]
    out = [(str(table.relative_to(ROOT)), 1, "lane-icon", i) for i in rows if i not in known]
    text = md.read_text(encoding="utf-8")
    section = text.split("\n## Lane icons", 1)[-1].split("\n## ", 1)[0] if "\n## Lane icons" in text else ""
    listed = re.findall(r"`([\w-]+)`", section)
    line = text[: text.find("\n## Lane icons")].count("\n") + 2
    out += [(str(md.relative_to(ROOT)), line, "lane-icon", i) for i in listed if i not in known]
    if listed and listed != rows:
        out.append((str(md.relative_to(ROOT)), line, "lane-icon", "names differ from assets/icons/lanes.json"))
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
    # radius and shadow: tokens, zeros and colour-mix pass; a length literal fails
    for ok in ("border-radius:var(--radius-md) var(--radius-md) 0 0", "border-radius:0 var(--radius-lg) var(--radius-lg) 0",
               "box-shadow:var(--shadow-ring), var(--shadow-md)", "box-shadow:inset 0 0 0 var(--ring-thin) var(--ring)",
               "box-shadow:0 0 0 0 color-mix(in srgb, var(--primary) 65%, transparent)", "box-shadow:0 0 0 0 transparent",
               "box-shadow:inset 0 0 0 calc(var(--ring-thin) * var(--inv)) var(--ring)", "box-shadow:var(--shadow-glow) var(--primary-glow)",
               "filter:drop-shadow(var(--shadow-glow-tight) color-mix(in srgb, var(--a) 45%, transparent))", "filter:brightness(0.92)",
               "filter:drop-shadow(var(--shadow-xl))"):
        assert rules("css", f"a{{{ok}}}", 2) == [], ok
    for bad in ("border-radius:8px 8px 0 0", "border-radius:var(--radius-md) 4px", "border-radius:50%", "box-shadow:0 0 0 3px var(--primary-ring)",
                "box-shadow:var(--shadow-md), 0 1px 2px var(--x)", "box-shadow:0 0 0 18px color-mix(in srgb, var(--a) 0%, transparent)",
                "filter:drop-shadow(0 0 4px color-mix(in srgb, var(--a) 45%, transparent))", "filter:drop-shadow(0 2px 4px var(--x))"):
        assert rules("css", f"a{{{bad}}}", 2) == ["type-scale-literal"], bad
    assert rules("css", "a{box-shadow:0 0 0 10px var(--x) /* tokens-ok: animation extent */}", 2) == []
    assert rules("html", "<p>&#169; <svg></svg></p>") == []
    assert rules("html", "<p><svg></svg></p>", 4) == []          # not an icon: no icon grid
    assert rules("html", '<p><svg width="14" height="14" viewBox="0 0 24 24"><path d="M0 0"/></svg></p>', 4) == ["svg-literal"]
    assert rules("html", '<p><svg width="14"\n viewBox="0 0 24 24"></svg></p>', 4) == ["svg-literal"]       # the tag may span lines
    assert rules("html", '<svg id="erd-svg" xmlns="http://www.w3.org/2000/svg">', 4) == []                   # a diagram's own root
    assert rules("html", "<style>a{color:#fff}</style><script>x='#fff'</script>") == ["color-literal"] * 2
    assert rules("js", "el.innerHTML = '<svg></svg>'", 4) == []
    assert rules("js", "el.innerHTML = '<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\"></svg>'", 4) == ["svg-literal"]
    assert rules("js", "const g = (k) => `<svg width=\"30\" height=\"16\" viewBox=\"-26 -9 30 18\">${k}</svg>`;", 4) == []   # a glyph, not an icon
    assert rules("js", "const svg = '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"' + w + '\" viewBox=\"0 0 ' + w;", 4) == []  # an export
    known = {"plus", "trash"}
    assert icon_name_findings("html", "<b>{{icon:plus}}</b> {{icon:trash:xs:bold}}", known) == []
    assert icon_name_findings("js", "ui.icon('plus'); ui.iconEl(\"trash\", {}); ui.icon(`kind-${k}`)", known) == []
    assert icon_name_findings("js", "ui.iconEl('type-' + cur.id, { size: 'sm' })", known) == []
    assert icon_name_findings("html", "a\n{{icon:nope:xs}}", known) == [(2, "icon-name", "nope")]
    assert icon_name_findings("js", "x = ui.icon('nope')\nlaneIcon('plus')", known) == [(1, "icon-name", "nope")]
    print("self-test passed")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--phase", type=int, default=1)
    ap.add_argument("--list-rules", action="store_true")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("-v", "--verbose", action="store_true", help="print passing rules")
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
        known = registry_names()
        if known is not None:
            for f in asset_files():
                findings += [(str(f.relative_to(ROOT)), ln, rule, snip) for ln, rule, snip in icon_name_findings(f.suffix[1:], f.read_text(encoding="utf-8"), known)]
        findings += lane_icon_findings()
    for rel, ln, rule, snip in findings:
        print(f"{rel}:{ln}: {rule}: {snip}")
    counts = {r: sum(1 for f in findings if f[2] == r) for r, (ph, _) in RULES.items() if ph <= args.phase}
    for rule, n in counts.items():
        if n or args.verbose:
            print(f"[{'FAIL' if n else 'PASS'}] {rule}: {n}")
    ok_rules = sum(1 for n in counts.values() if not n)
    print(f"{ok_rules}/{len(counts)} token rules passed" + (f" ({len(findings)} finding(s))" if findings else ""))
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
