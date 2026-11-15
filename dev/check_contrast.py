#!/usr/bin/env python3
"""WCAG 2.x contrast check for the colour token pairs, in light and dark mode.

Pairs come from the token file's `contrast` list ([fg, bg, min]; a name with `*` expands for every palette slot).

Usage:
  python dev/check_contrast.py [--theme FILE] [--strict] [--json]
  python dev/check_contrast.py --self-test
Exit codes: 0 all pass, 1 any FAIL (or, with --strict, any SKIP).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

NUM = r"([\d.]+%?)"
RGB_RE = re.compile(rf"rgba?\(\s*{NUM}[\s,]+{NUM}[\s,]+{NUM}(?:\s*[,/]\s*{NUM})?\s*\)$", re.I)


def parse_color(value):
    """CSS colour -> (r, g, b, a) with r/g/b in 0-255 and a in 0-1; None when unresolvable."""
    v = str(value).strip().lower()
    m = re.fullmatch(r"#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})", v)
    if m:
        h = m.group(1)
        if len(h) <= 4:
            h = "".join(c * 2 for c in h)
        n = [int(h[i:i + 2], 16) for i in range(0, len(h), 2)]
        return (n[0], n[1], n[2], (n[3] / 255 if len(n) == 4 else 1.0))
    m = RGB_RE.match(v)
    if m:
        def ch(s):
            return float(s[:-1]) * 2.55 if s.endswith("%") else float(s)
        a = m.group(4)
        alpha = 1.0 if a is None else (float(a[:-1]) / 100 if a.endswith("%") else float(a))
        return (ch(m.group(1)), ch(m.group(2)), ch(m.group(3)), min(max(alpha, 0), 1))
    return None


def over(fg, bg):
    """Alpha-composite fg over an opaque bg."""
    a = fg[3]
    return tuple(fg[i] * a + bg[i] * (1 - a) for i in range(3)) + (1.0,)


def luminance(c):
    def lin(x):
        x /= 255
        return x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4
    return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])


def ratio(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def load(theme):
    from tokens import load_tokens, resolve_colors
    tokens = load_tokens(theme)
    return "scripts/tokens.py", tokens, lambda mode: resolve_colors(tokens, mode)


def expand(pairs, palette):
    for fg, bg, mn in pairs:
        if "*" not in fg + bg:
            yield fg, bg, float(mn)
            continue
        for slot in palette:
            n = str(slot["slot"])
            yield fg.replace("*", n), bg.replace("*", n), float(mn)


def check(colors, fg, bg, mn):
    """-> (status, detail, ratio)"""
    for name in (fg, bg):
        if name not in colors:
            return "SKIP", f"missing token {name}", None
    f, b = parse_color(colors[fg]), parse_color(colors[bg])
    for name, c in ((fg, f), (bg, b)):
        if c is None:
            return "SKIP", f"unresolvable {name}: {colors[name]}", None
    if b[3] < 1:
        base = next((parse_color(colors[k]) for k in ("bg-panel", "bg-page") if k in colors), None)
        if base is None or base[3] < 1:
            return "SKIP", f"no opaque base for translucent {bg}", None
        b = over(b, base)
    r = ratio(over(f, b), b)
    return ("PASS" if r >= mn else "FAIL"), "", r


def run(theme, strict, as_json):
    source, tokens, colors_for = load(theme)
    pairs = tokens["contrast"]
    results = []
    for mode in ("light", "dark"):
        colors = colors_for(mode)
        for fg, bg, mn in expand(pairs, tokens.get("palette") or []):
            status, why, r = check(colors, fg, bg, mn)
            results.append({"mode": mode, "fg": fg, "bg": bg, "min": mn, "ratio": r and round(r, 2), "status": status, "reason": why})
    if as_json:
        print(json.dumps({"source": source, "results": results}, indent=2))
    else:
        print(f"tokens: {source}")
        for x in results:
            tail = x["reason"] if x["status"] == "SKIP" else f"{x['ratio']:.2f} {'<' if x['status'] == 'FAIL' else '>='} {x['min']:g}"
            print(f"[{x['status']}] {x['mode']} {x['fg']} on {x['bg']}: {tail}")
        c = {s: sum(x["status"] == s for x in results) for s in ("PASS", "FAIL", "SKIP")}
        print(f"{c['PASS']} pass, {c['FAIL']} fail, {c['SKIP']} skip")
    bad = any(x["status"] == "FAIL" or (strict and x["status"] == "SKIP") for x in results)
    return 1 if bad else 0


def self_test():
    close = lambda a, b: abs(a - b) < 0.01
    W, K = parse_color("#fff"), parse_color("#000")
    assert close(ratio(K, W), 21.0)
    assert close(ratio(parse_color("#777"), W), 4.48)
    assert parse_color("#abc") == parse_color("#aabbcc")
    assert parse_color("#0008")[3] == 0x88 / 255 and parse_color("#00000080")[3] == 128 / 255
    assert parse_color("rgb(255 0 0)") == (255.0, 0.0, 0.0, 1.0)
    assert parse_color("rgba(0, 0, 0, 0.5)") == (0.0, 0.0, 0.0, 0.5)
    assert parse_color("rgb(0 0 0 / 50%)")[3] == 0.5
    assert parse_color("color-mix(in srgb, red, blue)") is None
    assert over(parse_color("rgba(0,0,0,0.5)"), W)[:3] == (127.5,) * 3
    colors = {"a": "#000", "b": "#fff", "c": "rgba(255,255,255,0.5)", "bg-panel": "#000"}
    assert check(colors, "a", "b", 4.5)[0] == "PASS"
    assert check(colors, "b", "c", 4.5)[0] == "FAIL"  # white on 50% white over black panel = grey, ~4.0
    assert check(colors, "a", "zz", 4.5)[0] == "SKIP"
    assert list(expand([("sw-*-ink", "sw-*-fill", 4.5)], [{"slot": "1"}, {"slot": "2"}])) == [
        ("sw-1-ink", "sw-1-fill", 4.5), ("sw-2-ink", "sw-2-fill", 4.5)]
    print("self-test ok")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--theme", help="theme file passed to load_tokens")
    ap.add_argument("--strict", action="store_true", help="a missing or unresolvable token fails")
    ap.add_argument("--json", action="store_true", help="machine-readable results")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    if a.self_test:
        return self_test()
    return run(a.theme, a.strict, a.json)


if __name__ == "__main__":
    sys.exit(main())
