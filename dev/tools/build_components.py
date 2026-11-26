#!/usr/bin/env python3
"""Build the shared-elements gallery page from dev/playground/components.html and the real bundle styles.

Usage: python dev/tools/build_components.py -o <file.html>
Fills {{TOKENS_CSS}} (assets/tokens, light and dark), {{COMPONENTS_CSS}} (assets/components, in bundle order) and the {{icon:name}} placeholders, so the
gallery always shows what the types get. Design: dev/plans/plan-review-fixes.md, Phase 5 step 8. Prints [DONE].
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import layout_engine as le  # noqa: E402
import tokens as tk  # noqa: E402

TEMPLATE = ROOT / "dev" / "playground" / "components.html"


def build() -> str:
    t = tk.load_tokens()
    text = TEMPLATE.read_text(encoding="utf-8")
    text = text.replace("{{TOKENS_CSS}}", tk.tokens_css(t)).replace("{{COMPONENTS_CSS}}", le.components_css())
    return tk.expand_icons(text, t, tk.load_icons(t))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("-o", "--output", required=True, help="File to write")
    out = Path(ap.parse_args().output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build(), encoding="utf-8", newline="\n")
    print(f"[OK] Component gallery written to {out}")
    print("[DONE] Open the file in a browser (?theme=dark for the dark theme).")


if __name__ == "__main__":
    main()
