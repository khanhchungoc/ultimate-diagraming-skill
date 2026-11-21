#!/usr/bin/env python3
"""Every fixture under every theme: layout, audit score, contrast, text overflow.

For the default theme and each dev/fixtures/themes/*.json that is a theme (has "tokensVersion") it
  - lays out every dev/fixtures/<type>/*.json with `layout_engine.py --layout --theme` and reads the audit score,
  - runs `check_contrast.py --strict --theme` on the theme,
  - runs `check_overflow.mjs` on the generated pages (needs Node and Chrome; skipped with --no-overflow).
It prints a score table and fails when a theme makes a fixture score lower than the default theme does, when a
theme fails contrast, or when a theme leaves more overflowing texts on a page than the default does. A fixture that
scores below 90 under the default theme (erd/saas-billing: 88, a curve through a table) is reported like the others.

Usage: python dev/check_themes.py [--browser CHROME] [--no-overflow] [--keep DIR] [-v|--verbose]
Exit codes: 0 all good, 1 setup error, 2 a check failed.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = sorted(p for p in (ROOT / "dev" / "fixtures").glob("*/*.json")
                  if p.parent.name != "themes" and (ROOT / "assets" / "types" / p.parent.name / "engine.js").exists())  # a type with no engine yet has nothing to lay out
# A complete theme has measured font.metrics; brand-guide.json is a partial (the input of extract_tokens.py), so it is skipped.
THEMES = [None] + sorted(p for p in (ROOT / "dev" / "fixtures" / "themes").glob("*.json")
                         if "metrics" in json.loads(p.read_text(encoding="utf-8")).get("font", {}))
# Overflows that are not width estimates (see plan, Phase 6): rail names, the fixed box of a classic shape, a table
# name at the ERD overview floor. They are reported, never failed.
KNOWN = re.compile(r"rails\.html|classic-shapes\.html|saas-billing\.html")


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=300, cwd=ROOT)


def layout(theme, fixture, out):
    cmd = [sys.executable, "scripts/layout_engine.py", "--layout", str(fixture), "-o", str(out)]
    if theme:
        cmd += ["--theme", str(theme)]
    r = run(cmd)
    # The pass line shows the score only below 100 ("audit score N"); a layout failure prints "Quality score N/100"
    m = re.search(r"(?:Quality|audit) score:? (\d+)", r.stdout, re.I)
    if not out.is_file():
        return None
    return int(m.group(1)) if m else (100 if "[PASS] Layout clean." in r.stdout else None)


def overflow(browser, pages):
    r = run(["node", "dev/check_overflow.mjs", "--browser", browser] + [str(p) for p in pages])
    if r.returncode == 1:
        raise RuntimeError(r.stderr.strip() or r.stdout.strip())
    found, page = {}, None
    for line in r.stdout.splitlines():
        m = re.match(r"\[\w+\] (\S+\.html): ", line)
        page = m.group(1) if m else page
        if page and not m and line.startswith("   ") and not KNOWN.search(page):
            found[page] = found.get(page, 0) + 1
        elif m:
            found.setdefault(page, 0)
    return found


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--browser", default=shutil.which("google-chrome") or shutil.which("chromium") or "")
    ap.add_argument("--no-overflow", action="store_true")
    ap.add_argument("--keep", help="keep the generated pages in this folder")
    ap.add_argument("-v", "--verbose", action="store_true", help="print per-fixture score table")
    args = ap.parse_args()
    check_overflow = not args.no_overflow
    if check_overflow and not (args.browser and shutil.which("node")):
        print("[ERROR] the overflow check needs Node.js and Chrome (--browser, or --no-overflow)", file=sys.stderr)
        return 1
    tmp = Path(args.keep or tempfile.mkdtemp(prefix="themes-"))
    tmp.mkdir(parents=True, exist_ok=True)
    names = [t.stem if t else "default" for t in THEMES]
    key = lambda f: f"{f.parent.name}/{f.stem}"
    jobs = [(t, f) for t in THEMES for f in FIXTURES]
    with ThreadPoolExecutor(max_workers=4) as pool:
        out = list(pool.map(lambda j: layout(j[0], j[1], tmp / f"{j[0].stem if j[0] else 'default'}--{j[1].parent.name}-{j[1].stem}.html"), jobs))
    score = {(n, key(f)): s for (t, f), s in zip(jobs, out) for n in [t.stem if t else "default"]}

    failed = []
    if args.verbose:
        print(f"{'fixture':38}" + "".join(f"{n:>12}" for n in names))
    for f in FIXTURES:
        row = [score[(n, key(f))] for n in names]
        if args.verbose:
            print(f"{key(f):38}" + "".join(f"{'ERROR' if s is None else s:>12}" for s in row))
        if row[0] is None:
            failed.append(f"{key(f)}: does not lay out under the default theme")
        for n, s in zip(names[1:], row[1:]):
            if s is None or (row[0] is not None and s < row[0]):
                failed.append(f"{key(f)} under {n}: score {s}, default {row[0]}")
    for t in THEMES[1:]:
        r = run([sys.executable, "dev/check_contrast.py", "--strict", "--theme", str(t)])
        print(f"[{'PASS' if r.returncode == 0 else 'FAIL'}] contrast --strict {t.stem}: {r.stdout.strip().splitlines()[-1]}")
        if r.returncode:
            failed.append(f"contrast {t.stem}")
    if check_overflow:
        base = overflow(args.browser, sorted(tmp.glob("default--*.html")))
        for t in THEMES[1:]:
            found = overflow(args.browser, sorted(tmp.glob(f"{t.stem}--*.html")))
            worse = {p: n for p, n in found.items() if n > base.get(p.replace(t.stem, "default", 1), 0)}
            print(f"[{'FAIL' if worse else 'PASS'}] overflow {t.stem}: {sum(found.values())} overflowing texts in {len(found)} pages "
                  f"(default: {sum(base.values())}; rail names, classic shapes and the ERD overview floor not counted); more than default on {len(worse)}")
            failed += [f"overflow {p}: {n}" for p, n in worse.items()]
    if not args.keep:
        shutil.rmtree(tmp, ignore_errors=True)
    for line in failed:
        print(f"[FAIL] {line}")
    print(f"[PASS] every fixture, every theme ({len(FIXTURES)} fixtures x {len(THEMES)} themes)" if not failed else f"{len(failed)} problem(s)")
    return 2 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
