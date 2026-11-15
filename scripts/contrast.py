#!/usr/bin/env python3
"""WCAG 2.x contrast maths for the colour token pairs. Shared by dev/check_contrast.py and scripts/extract_tokens.py
(dev/ is not shipped, so the core lives here). Standard library only."""

from __future__ import annotations

import re

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
