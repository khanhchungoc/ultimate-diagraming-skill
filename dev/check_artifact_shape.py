#!/usr/bin/env python3
"""Checks the split `--target artifact` bundle shape (plan: dev/plans/plan-artifact-split-files.md).

For every dev/fixtures/<type>/*.json, the ER diagram's included (assembled without running the layout engine, the shape does not depend on it):
  - index.html starts with the exact artifact skeleton and ends with ARTIFACT_END_MARKER + `</body></html>`
  - <head> holds nothing but the skeleton's own tags (checked on the text, whitespace included)
  - <title> is the first thing in <body>, and no <head>/<body>/<html> tag or doctype appears twice
  - index.html has an agent comment pointing to diagram.json, links app.css and app.js, and holds no #diagram-data
  - diagram.json is formatted JSON starting with `_readme`, trailing newline, matching `to_disk` + `format_json`
  - app.css and app.js are non-empty, have no external references beyond fonts, and app.js contains engine markers
  - `--extract` on index.html and diagram.json returns the same authoring JSON as `--extract` on `--target file`
  - `--target artifact -o <dir-or-index.html>` writes all four files into the target folder
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


def extract(path: Path) -> str:
    return subprocess.run([sys.executable, str(ROOT / "scripts" / "layout_engine.py"), "--extract", str(path), "--json"],
                          capture_output=True, text=True, encoding="utf-8", check=True).stdout


shell_html = (ROOT / "assets" / "shell" / "shell.html").read_text(encoding="utf-8")
expected_head = ('<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,'
                 f'initial-scale=1,viewport-fit=cover"><style>{le.ARTIFACT_RESET_CSS}</style></head><body>')
check("ARTIFACT_HEAD is the documented skeleton", le.ARTIFACT_HEAD == expected_head, le.ARTIFACT_HEAD)
check("ARTIFACT_TAIL is </body></html>", le.ARTIFACT_TAIL == "</body></html>", le.ARTIFACT_TAIL)

js = (ROOT / "assets" / "shell" / "shell.js").read_text(encoding="utf-8")
m = re.search(r"const ARTIFACT_RESET_CSS = '([^']*)';", js)
check("shell.js ARTIFACT_RESET_CSS equals layout_engine.py's", bool(m) and m[1] == le.ARTIFACT_RESET_CSS)
m = re.search(r"const ARTIFACT_HEAD = '(.*?)' \+ ARTIFACT_RESET_CSS \+ '(.*?)';", js)
check("shell.js ARTIFACT_HEAD equals layout_engine.py's", bool(m) and m[1] + le.ARTIFACT_RESET_CSS + m[2] == le.ARTIFACT_HEAD)
check("shell.js ARTIFACT_TAIL equals layout_engine.py's", f"const ARTIFACT_TAIL = '{le.ARTIFACT_TAIL}';" in js)

template = le.artifact_index_template(shell_html)
shell_ui = shell_html[shell_html.index("<header>"): shell_html.index("</aside>") + len("</aside>")]
check("artifact index template starts with ARTIFACT_HEAD and ends with end marker + ARTIFACT_TAIL",
      template.startswith(expected_head + "\n") and template.endswith(le.ARTIFACT_END_MARKER + "\n" + le.ARTIFACT_TAIL))
check("artifact index template keeps shell.html's body UI unchanged", shell_ui in template)
check("artifact index template links app.css/app.js, carries fonts and theme placeholder, drops inline data/styles",
      '<link rel="stylesheet" href="app.css">' in template and '<script src="app.js"></script>' in template
      and "{{FONT_HREF}}" in template and "{{THEME}}" in template
      and 'id="diagram-data"' not in template and template.count("<style>") == 1)

meta_cache: dict[str, dict] = {}


def check_split_bundle(label: str, kind: str, data: dict, files: dict[str, str], tmp_dir: Path) -> None:
    """Validate all four split artifact files, --extract round-trip, and file-target parity."""
    check(f"{label}: assemble_artifact returns the four split files",
          set(files) == {"index.html", "diagram.json", "app.css", "app.js"}, str(sorted(files)))
    if not {"index.html", "diagram.json", "app.css", "app.js"} <= set(files):
        return
    idx, djson, css, appjs = files["index.html"], files["diagram.json"], files["app.css"], files["app.js"]
    check(f"{label}: index.html starts with the exact skeleton", idx.startswith(expected_head + "\n"))
    check(f"{label}: no raw control bytes (publishing rejects the files)",
          all(re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", text) is None for text in files.values()))
    check(f"{label}: no \"data:\" in a tooltip or label (read as a data URI, blocks public sharing)",
          re.search(r'(?:title|aria-label|placeholder|alt)="[^"]*\bdata:', idx, re.I) is None)
    check(f"{label}: index.html ends with end marker and </body></html>",
          idx.endswith(le.ARTIFACT_END_MARKER + "\n</body></html>"))
    head = idx[: idx.index("<body>") + 6] if "<body>" in idx else ""
    check(f"{label}: <head> holds only the skeleton's tags",
          head == expected_head and idx.count("<head>") == 1 and idx.count("</head>") == 1
          and idx.count("<html") == 1 and idx.lower().count("<!doctype") == 1, head[:200])
    body = idx[len(expected_head):]
    check(f"{label}: <title> is first in <body>", re.match(r"\n<title>[^<]*</title>\n", body) is not None, body[:80])
    check(f"{label}: index.html has agent comment pointing to diagram.json and no #diagram-data",
          re.search(r"<!--[\s\S]*?diagram\.json[\s\S]*?-->", body) is not None and 'id="diagram-data"' not in idx)
    check(f"{label}: index.html links app.css and app.js",
          '<link rel="stylesheet" href="app.css">' in idx and '<script src="app.js"></script>' in idx)

    if kind not in meta_cache:
        meta_cache[kind] = json.loads((ROOT / "assets" / "types" / kind / "meta.json").read_text(encoding="utf-8"))
    expected_djson = df.format_json(df.with_readme(df.to_disk(kind, data), df.readme_text(meta_cache[kind]["dataNote"]))) + "\n"
    try:
        parsed_djson = json.loads(djson)
        djson_ok = djson.endswith("\n") and next(iter(parsed_djson), None) == df.README_KEY and djson == expected_djson
    except ValueError:
        djson_ok = False
    check(f"{label}: diagram.json is formatted disk JSON with _readme first and trailing newline", djson_ok)

    check(f"{label}: app.css and app.js are non-empty and app.js contains engine markers",
          bool(css.strip()) and bool(appjs.strip())
          and "//@engine-begin" in appjs and "//@engine-end" in appjs
          and appjs.index("//@engine-begin") < appjs.index("//@engine-end"))
    check(f"{label}: no external references beyond the font in index.html, app.css, app.js",
          le.find_external_refs(idx) == [] and le.find_external_refs(css) == [] and le.find_external_refs(appjs) == [])

    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", label)
    art_dir = tmp_dir / slug
    art_dir.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        (art_dir / name).write_text(content, encoding="utf-8")
    file_page = le.assemble_page(kind, data)
    fp = tmp_dir / f"{slug}.html"
    fp.write_text(file_page, encoding="utf-8")
    expected_ext = extract(fp)
    check(f"{label}: --extract on index.html and diagram.json matches the file page",
          extract(art_dir / "index.html") == expected_ext and extract(art_dir / "diagram.json") == expected_ext)
    check(f"{label}: file target is the unmodified shell.html fill",
          file_page.startswith("<!DOCTYPE html>\n<!-- For agents:")
          and df.DATA_OPEN_TAG in file_page and df.DATA_END_MARKER in file_page)


tmp = Path(tempfile.mkdtemp(prefix="artifact_shape_"))
fixtures = sorted(p for p in (ROOT / "dev" / "fixtures").glob("*/*.json") if p.parent.name != "themes")
for fx in fixtures:
    kind = fx.parent.name
    if kind not in le.SUPPORTED_TYPES or "golden" in fx.parts:
        continue
    label = f"{kind}/{fx.name}"
    data = le.normalize_diagram_type(json.loads(fx.read_text(encoding="utf-8")))
    check_split_bundle(label, data["diagramType"], data, le.assemble_artifact(data["diagramType"], data), tmp)

# Every type with fixtures is covered above; say so for the ER diagram, whose diagram.json also carries the `layout` map
erd_fixtures = [f for f in fixtures if f.parent.name == "erd" and "golden" not in f.parts]
check("the ERD fixtures are covered by the split checks above", len(erd_fixtures) >= 5 and "erd" in le.SUPPORTED_TYPES)
example = le.normalize_diagram_type(json.loads((ROOT / "dev" / "examples" / "example-erd.json").read_text(encoding="utf-8")))
erd_laid = le.run_layout("erd", example, timeout=30, browser=None)
check_split_bundle("example-erd", "erd", erd_laid, le.assemble_artifact("erd", erd_laid), tmp)

sample_fx = ROOT / "dev" / "fixtures" / "flowchart" / "linear-single-lane.json"
for out_name, out_arg in (("dir", tmp / "cli-dir"), ("index.html", tmp / "cli-idx" / "index.html")):
    out_dir = out_arg if out_name == "dir" else out_arg.parent
    proc = subprocess.run([sys.executable, str(ROOT / "scripts" / "layout_engine.py"),
                           "--layout", str(sample_fx), "--target", "artifact", "-o", str(out_arg)],
                          capture_output=True, text=True, encoding="utf-8")
    check(f"CLI --target artifact -o <{out_name}> writes all four split files",
          proc.returncode == 0 and all((out_dir / n).is_file() for n in ("index.html", "diagram.json", "app.css", "app.js")),
          (proc.stdout + proc.stderr)[-300:])

print(f"{'all passed' if not failures else str(failures) + ' check(s) failed'}")
sys.exit(2 if failures else 0)
