#!/usr/bin/env python3
"""Checks the `--target artifact` page shape (plan: dev/plans/plan-artifact-output.md).

For every dev/fixtures/<type>/*.json (assembled without running the layout engine, the shape does not depend on it):
  - the page starts with the exact artifact skeleton and ends with `</body></html>`
  - <head> holds nothing but the skeleton's own tags (checked on the text, whitespace included)
  - <title> is the first thing in <body>, and no <head>/<body>/<html> tag or doctype appears twice
  - the body equals shell.html's, plus the head's contents the artifact template lifted into it (no drift)
  - `--extract` on the page returns the same authoring JSON as `--extract` on the file-target page
  - the reading guide's line numbers match the data block's real lines
  - ARTIFACT_RESET_CSS / ARTIFACT_HEAD in shell.js are the same text as in layout_engine.py
  - `--target file` is unchanged by the artifact code (shell.html's own text is used as is)

Usage: python dev/check_artifact_shape.py        Exit codes: 0 all passed, 2 a check failed.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import layout_engine as le  # noqa: E402
import disk_format as df  # noqa: E402

failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    print(f"[{'PASS' if ok else 'FAIL'}] {name}{'' if ok else ' - ' + detail}")
    failures += 0 if ok else 1


def guide_numbers(page: str):
    m = re.search(r"on lines (\d+)-(\d+) of this file\. Read lines 1-(\d+) only \(offset 1, limit (\d+)\)", page)
    return tuple(int(x) for x in m.groups()) if m else None


def real_lines(page: str):
    start = page.count("\n", 0, page.index(df.DATA_OPEN_TAG)) + 1
    end = page.count("\n", 0, page.index(df.DATA_END_MARKER)) + 1
    return start, end


def extract(path: Path) -> str:
    return subprocess.run([sys.executable, str(ROOT / "scripts" / "layout_engine.py"), "--extract", str(path)],
                          capture_output=True, text=True, encoding="utf-8", check=True).stdout


shell_html = (ROOT / "assets" / "shell" / "shell.html").read_text(encoding="utf-8")
expected_head = ('<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,'
                 f'initial-scale=1,viewport-fit=cover"><style>{le.ARTIFACT_RESET_CSS}</style></head><body>')
check("ARTIFACT_HEAD is the documented skeleton", le.ARTIFACT_HEAD == expected_head, le.ARTIFACT_HEAD)

js = (ROOT / "assets" / "shell" / "shell.js").read_text(encoding="utf-8")
m = re.search(r"const ARTIFACT_RESET_CSS = '([^']*)';", js)
check("shell.js ARTIFACT_RESET_CSS equals layout_engine.py's", bool(m) and m[1] == le.ARTIFACT_RESET_CSS)
m = re.search(r"const ARTIFACT_HEAD = '(.*?)' \+ ARTIFACT_RESET_CSS \+ '(.*?)';", js)
check("shell.js ARTIFACT_HEAD equals layout_engine.py's", bool(m) and m[1] + le.ARTIFACT_RESET_CSS + m[2] == le.ARTIFACT_HEAD)
check("shell.js ARTIFACT_TAIL equals layout_engine.py's", f"const ARTIFACT_TAIL = '{le.ARTIFACT_TAIL}';" in js)

template = le.artifact_template(shell_html)
body_of_shell = shell_html[shell_html.index("<body>") + 6: shell_html.index("</body>")]
check("artifact template keeps shell.html's body text unchanged", body_of_shell in template)
lifted = shell_html[shell_html.index("<head>") + 6: shell_html.index("</head>")]
lifted_lines = [ln for ln in lifted.splitlines() if not re.match(r"\s*<meta ", ln)]
check("artifact template carries every other head line (nothing lost, nothing added)",
      all(ln.strip() in template for ln in lifted_lines) and template.count("<style>") == shell_html.count("<style>") + 1)  # + the skeleton's reset

tmp = Path(tempfile.mkdtemp(prefix="artifact_shape_"))
fixtures = sorted((ROOT / "dev" / "fixtures").glob("*/*.json"))
for fx in fixtures:
    kind = fx.parent.name
    if kind not in le.SUPPORTED_TYPES or "golden" in fx.parts:
        continue
    label = f"{kind}/{fx.name}"
    data = le.normalize_diagram_type(json.loads(fx.read_text(encoding="utf-8")))
    art = le.assemble_page(data["diagramType"], data, "artifact")
    file_page = le.assemble_page(data["diagramType"], data)
    check(f"{label}: starts with the exact skeleton", art.startswith(expected_head + "\n"))
    check(f"{label}: ends with </body></html>", art.endswith("</body></html>"))
    head = art[: art.index("<body>") + 6]
    check(f"{label}: <head> holds only the skeleton's tags",
          head == expected_head and (top := art[:art.index(df.DATA_END_MARKER)]).count("<head>") == 1
          and top.count("<html") == 1 and top.lower().count("<!doctype") == 1 and "</head>" not in top.replace(expected_head, ""),
          head[:200])
    body = art[len(expected_head):]
    check(f"{label}: <title> is first in <body>", re.match(r"\n<title>[^<]*</title>\n", body) is not None, body[:80])
    check(f"{label}: reading guide line numbers are right", guide_numbers(art) is not None and
          guide_numbers(art)[:2] == real_lines(art) and guide_numbers(art)[2:] == (real_lines(art)[1],) * 2, str(guide_numbers(art)))
    check(f"{label}: the data block ends before the first <style>", art.index(df.DATA_END_MARKER) < art.index("<style>", len(expected_head)))
    fp, ap = tmp / f"{kind}-{fx.stem}.html", tmp / f"{kind}-{fx.stem}.art.html"
    fp.write_text(file_page, encoding="utf-8")
    ap.write_text(art, encoding="utf-8")
    check(f"{label}: --extract round-trips (same JSON as the file page)", extract(ap) == extract(fp))
    check(f"{label}: file target is the unmodified shell.html fill", file_page.startswith("<!DOCTYPE html>\n<!-- For agents:"))
    check(f"{label}: no external references beyond the font", le.find_external_refs(art) == [])

print(f"{'all passed' if not failures else str(failures) + ' check(s) failed'}")
sys.exit(2 if failures else 0)
