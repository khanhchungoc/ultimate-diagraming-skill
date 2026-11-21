#!/usr/bin/env python3
"""Checks scripts/extract_tokens.py and the theme plumbing (plan: dev/plans/plan-design-tokens.md, Phase 7).

  1. dev/tests/fixtures/themes/site/index.html (known brand values) maps to the expected keys, and the completed theme passes
     every contrast pair in both modes (dev/check_contrast.py --strict) and the colour-blind edge check.
  2. dev/tests/fixtures/themes/brand-guide.json goes through --from ... --complete the same way.
  3. A hostile page puts nothing but plain colours, numbers and safe names into the theme.
  4. Theme lookup (--theme, stored in the page, project .ultimate-diagram/theme.json, default), the stored
     <script id="diagram-theme"> (outside the reading guide's lines, in file and artifact pages), --extract-theme, and
     that a default page carries no theme script.

Usage: python dev/check_extract.py [--offline] [-v|--verbose]   (--offline skips font lookup and measuring)
Exit codes: 0 all passed, 2 a check failed.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
import extract_tokens as ex  # noqa: E402
from contrast import parse_color, ratio  # noqa: E402
import layout_engine as le  # noqa: E402
from tokens import merge_theme, resolve_colors  # noqa: E402

_ap = argparse.ArgumentParser(description="Check extract_tokens and theme plumbing.")
_ap.add_argument("--offline", action="store_true", help="Skip font lookup and measuring")
_ap.add_argument("-v", "--verbose", action="store_true", help="Print passing checks")
_args = _ap.parse_args()
OFFLINE = _args.offline
VERBOSE = _args.verbose
total = 0
failures = 0
tmp = Path(tempfile.mkdtemp(prefix="check_extract_"))


def check(name: str, ok: bool, detail: str = "") -> None:
    global total, failures
    total += 1
    if not ok or VERBOSE:
        print(f"[{'PASS' if ok else 'FAIL'}] {name}{'' if ok else ' - ' + str(detail)[:300]}")
    failures += 0 if ok else 1


def run(*args: str, cwd: Path = ROOT):
    return subprocess.run([sys.executable, str(ROOT / "scripts" / args[0]), *args[1:]], capture_output=True, text=True,
                          encoding="utf-8", cwd=cwd)


def passes_contrast(theme: Path) -> bool:
    p = subprocess.run([sys.executable, str(ROOT / "dev" / "tests" / "unit" / "check_contrast.py"), "--theme", str(theme), "--strict"], capture_output=True, text=True)
    return p.returncode == 0 and " 0 fail, 0 skip" in p.stdout


def edges_apart(theme: Path) -> bool:
    t = merge_theme(json.loads(theme.read_text(encoding="utf-8")))
    return all(ex.cvd_distance(*(resolve_colors(t, m)[k] for k in ("edge-in", "edge-out"))) >= ex.CVD_MIN for m in ("light", "dark"))


def extract(args, out: Path):
    return run("extract_tokens.py", *args, "--complete", "--out", str(out), *(["--offline"] if OFFLINE else []))


# 1. the test site ---------------------------------------------------------------------------------------------------
out = tmp / "site.json"
p = extract(["--url", (ROOT / "dev/tests/fixtures/themes/site/index.html").as_uri()], out)
check("site: extraction exits 0", p.returncode == 0, p.stderr + p.stdout[-300:])
if p.returncode == 0:
    th = json.loads(out.read_text(encoding="utf-8"))
    full = merge_theme(th)
    L, D = full["color"]["light"], full["color"]["dark"]
    expect = [("primary (button background)", L["primary"] == "#0e7c66"), ("on-primary", L["on-primary"] == "#ffffff"),
              ("bg-page (body)", L["bg-page"] == "#faf7f2"), ("bg-panel (card surface)", L["bg-panel"] == "#ffffff"),
              ("text-main", L["text-main"] == "#1f2a37"), ("border-color", L["border-color"] == "#e5ded3"),
              ("font.family from body", full["font"]["family"] == "Space Grotesk"),
              ("font.href from the page's own Google Fonts link", full["font"]["href"].startswith("https://fonts.googleapis.com/css2?family=Space+Grotesk")),
              ("type.family.mono from code", "JetBrains Mono" in full["type"]["family"]["mono"]),
              ("radius.lg from card radius 14px", full["radius"]["lg"] == "14px"),
              ("shadow.sm from card shadow", full["shadow"]["sm"].startswith("0px 1px 3px 0px rgba(0, 0, 0, 0.1)")),
              ("title weight bold (h1-h3 700)", full["type"]["styles"]["title"]["weight"] == "bold"),
              ("body line height 1.6 -> leading.normal", full["type"]["leading"]["normal"] == 1.6),
              ("icon.stroke 1.5 from inline SVG", full.get("icon", {}).get("stroke") == 1.5),
              ("lucide marker reported", "lucide (4 hits)" in p.stdout),
              ("palette: slot 1 is the brand colour, 9 slots", full["palette"][0]["light"]["strong"] == "#0e7c66" and len(full["palette"]) == 9),
              ("palette: the site's accent colours are slots", {"#d9480f", "#5b3cc4"} <= {s["light"]["strong"] for s in full["palette"]}),
              ("dark set derived, hue of primary kept", abs(ex.to_oklch(D["primary"])[2] - ex.to_oklch("#0e7c66")[2]) < 3 and ex.to_oklch(D["bg-page"])[0] < 0.3),
              ("type clamp: label 12-15px, detail >= 12px, caption >= 10px", all(
                  lo <= float(full["type"]["size"][full["type"]["styles"][s]["size"]][:-2]) <= hi for s, lo, hi in (("label", 12, 15), ("detail", 12, 99), ("caption", 10, 99)))),
              ("a low-contrast muted text (#9a9a9a) was fixed and reported", "[FIX] light text-muted" in p.stdout and ratio(parse_color(L["text-muted"]), parse_color(L["bg-panel"])) >= 4.5)]
    for name, ok in expect:
        check(f"site: {name}", ok, p.stdout[-400:])
    check("site: font.metrics measured (or a warning says why not)", full["font"]["metrics"] != merge_theme(None)["font"]["metrics"] or "[WARN] font.metrics not measured" in p.stdout
          or "did not load" in p.stdout)
    check("site: completed theme passes every contrast pair, light and dark (check_contrast --strict)", passes_contrast(out))
    check("site: in/out edges stay apart under protanopia and deuteranopia", edges_apart(out))
    check("site: theme file is sparse (only differences from the default)", "contrast" not in th and len(json.dumps(th)) < 12000, len(json.dumps(th)))
    again = tmp / "site2.json"
    q = extract(["--from", str(out)], again)
    check("site: completing a completed theme changes nothing", q.returncode == 0 and json.loads(again.read_text(encoding="utf-8")) == th, q.stderr + q.stdout[-200:])

# 2. the brand-guide path ---------------------------------------------------------------------------------------------
out2 = tmp / "guide.json"
p = extract(["--from", str(ROOT / "dev/tests/fixtures/themes/brand-guide.json")], out2)
check("guide: --from ... --complete exits 0", p.returncode == 0, p.stderr + p.stdout[-300:])
if p.returncode == 0:
    full = merge_theme(json.loads(out2.read_text(encoding="utf-8")))
    check("guide: pale yellow primary was darkened for contrast and the fix is in the report", "[FIX] light" in p.stdout and ex.to_oklch(full["color"]["light"]["primary"])[0] < ex.to_oklch("#ffc20e")[0])
    check("guide: hue of the yellow kept", abs(ex.to_oklch(full["color"]["light"]["primary"])[2] - ex.to_oklch("#ffc20e")[2]) < 3)
    check("guide: palette slot 1 follows the primary, the grey brand colour stays out", full["palette"][0]["name"] in ("amber", "yellow") and "neutral" in p.stdout)
    check("guide: completed theme passes contrast in both modes", passes_contrast(out2))
    check("guide: in/out edges stay apart for colour-blind viewers", edges_apart(out2))

# 3. a hostile page ---------------------------------------------------------------------------------------------------
out3 = tmp / "hostile.json"
p = extract(["--url", (ROOT / "dev/tests/fixtures/themes/site/hostile.html").as_uri(), "--no-measure"], out3)
check("hostile: extraction exits 0", p.returncode == 0, p.stderr + p.stdout[-300:])
if p.returncode == 0:
    text = out3.read_text(encoding="utf-8")
    full = merge_theme(json.loads(text))
    strings = re.findall(r'"((?:[^"\\]|\\.)*)"', text)
    check("hostile: no script, URL, brace, semicolon or page text in the theme", not any(re.search(r"evil|script|alert|javascript|[<>{};]|://", x) for x in strings if not x.startswith("https://fonts.googleapis.com/")), text[:300])
    check("hostile: font.href stays empty (the page's non-Google stylesheet is ignored)", full["font"]["href"] == "")
    check("hostile: a plain brand colour still comes through", full["color"]["light"]["primary"] in ("#b3261e", "#b3261f") or ex.ok_distance(full["color"]["light"]["primary"], "#b3261e") < 0.02)
    check("hostile: the safe family name is kept", full["font"]["family"] == "Fine Sans")
bad = run("extract_tokens.py", "--url", "javascript:alert(1)", "--complete", "--out", str(tmp / "x.json"))
check("hostile: a javascript: address is refused", bad.returncode == 1 and not (tmp / "x.json").exists(), bad.stdout + bad.stderr)

# 4. theme plumbing ---------------------------------------------------------------------------------------------------
fx = ROOT / "dev/tests/fixtures/flowchart/linear-single-lane.json"
data = le.normalize_diagram_type(json.loads(fx.read_text(encoding="utf-8")))
theme = json.loads((ROOT / "dev/tests/fixtures/themes/test-wide.json").read_text(encoding="utf-8"))
default_page = le.assemble_page("flowchart", data)
check("plumbing: a default page carries no theme script (byte for byte as before)", le.THEME_OPEN not in default_page and le.read_stored_theme(default_page) is None)
default_art = le.assemble_artifact("flowchart", data)["index.html"]
check("plumbing: a default artifact index.html carries no theme script", le.THEME_OPEN not in default_art and le.read_stored_theme(default_art) is None)
page = le.assemble_page("flowchart", data, "file", merge_theme(theme), theme)
check("plumbing: file page stores the theme", le.read_stored_theme(page) == theme)
check("plumbing: file page: the theme script sits after the end comment, below the reading guide's range",
      page.index(le.THEME_OPEN) > page.index("<!-- end diagram-data -->") and
      re.search(r"Read lines 1-(\d+)", page) and page.count("\n", 0, page.index(le.THEME_OPEN)) + 1 == int(re.search(r"Read lines 1-(\d+)", page)[1]) + 1)
art_index = le.assemble_artifact("flowchart", data, merge_theme(theme), theme)["index.html"]
check("plumbing: artifact index.html stores the theme", le.read_stored_theme(art_index) == theme)
check("plumbing: artifact index.html: the theme script sits before app.css",
      le.THEME_OPEN in art_index and '<link rel="stylesheet" href="app.css">' in art_index
      and art_index.index(le.THEME_OPEN) < art_index.index('<link rel="stylesheet" href="app.css">'))
check("plumbing: stored theme escapes '<'", "<" not in le.theme_script({"name": "a<b"}).split(">", 1)[1].rsplit("<", 1)[0])
shape = subprocess.run([sys.executable, str(ROOT / "dev/tests/unit/check_artifact_shape.py")], capture_output=True, text=True)
check("plumbing: dev/tests/unit/check_artifact_shape.py still passes", shape.returncode == 0, shape.stdout[-300:])

work = tmp / "project"
(work / ".ultimate-diagram").mkdir(parents=True)
proj = {"tokensVersion": 1, "name": "projtheme", "color": {"light": {"primary": "#7a1fa2"}}}
(work / ".ultimate-diagram" / "theme.json").write_text(json.dumps(proj), encoding="utf-8")
(work / "a.json").write_text(fx.read_text(encoding="utf-8"), encoding="utf-8")
shutil_theme = work / "wide.json"
shutil_theme.write_text(json.dumps(theme), encoding="utf-8")
LAY = ("layout_engine.py", "--layout")
r1 = run(*LAY, "a.json", "-o", "a.html", cwd=work)
check("lookup: no --theme, project theme found", "[NOTE] Theme 'projtheme' (project theme" in r1.stdout and (work / "a.html").is_file(), r1.stdout[-300:] + r1.stderr[-200:])
check("lookup: the page stores the project theme", (le.read_stored_theme((work / "a.html").read_text(encoding="utf-8")) or {}).get("name") == "projtheme")
r2 = run(*LAY, "a.json", "-o", "b.html", "--theme", "wide.json", cwd=work)
check("lookup: --theme beats the project theme", "Theme 'test-wide' (--theme" in r2.stdout and (le.read_stored_theme((work / "b.html").read_text(encoding="utf-8")) or {}).get("name") == "test-wide")
r3 = run(*LAY, "b.html", "-o", "c.html", cwd=work)
check("lookup: the stored theme beats the project theme on a re-layout", "Theme 'test-wide' (stored in the page)" in r3.stdout
      and (le.read_stored_theme((work / "c.html").read_text(encoding="utf-8")) or {}).get("name") == "test-wide", r3.stdout[-300:])
plain = work / "old.html"
plain.write_text(le.assemble_page("flowchart", data), encoding="utf-8")
r4 = run(*LAY, "old.html", "-o", "old2.html", cwd=work)
check("lookup: a page saved before themes takes the project theme and the run says so", "saved before themes" in r4.stdout and "projtheme" in r4.stdout, r4.stdout[-300:])
(work / ".ultimate-diagram" / "theme.json").unlink()
r5 = run(*LAY, "old.html", "-o", "old3.html", cwd=work)
check("lookup: no theme anywhere gives the default and no NOTE", "[NOTE]" not in r5.stdout and le.THEME_OPEN not in (work / "old3.html").read_text(encoding="utf-8"))
ext = run("layout_engine.py", "--extract-theme", "b.html", "-o", "out-theme.json", cwd=work)
check("--extract-theme writes the stored theme", ext.returncode == 0 and json.loads((work / "out-theme.json").read_text(encoding="utf-8")) == theme, ext.stdout + ext.stderr)
ext2 = run("layout_engine.py", "--extract-theme", "old.html", cwd=work)
check("--extract-theme on a page without one says so", "no stored theme" in ext2.stdout + ext2.stderr and ext2.returncode != 0)
(work / ".ultimate-diagram" / "theme.json").write_text('{"tokensVersion": 1, "color": {"light": {"primary": "red; }"}}}', encoding="utf-8")
r6 = run(*LAY, "a.json", "-o", "bad.html", cwd=work)
check("lookup: an invalid project theme is an error, not a silent default", r6.returncode != 0 and "[ERROR] theme" in r6.stderr + r6.stdout)

print(f"{total - failures}/{total} checks passed" + (f" ({failures} failed)" if failures else ""))
sys.exit(2 if failures else 0)
