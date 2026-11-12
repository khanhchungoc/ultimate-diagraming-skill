#!/usr/bin/env python3
"""Build the viewable example pages dev/samples/example-<name>.html from references/examples/example-<name>.json.

The JSON lives in references/ because the installed skill links to it; the built pages stay in dev/ (not installed).

The pages are generated output (shell + type plugin + laid-out data), so they go stale whenever the shell, a
plugin or an engine changes. Rebuild them after such a change:

  python dev/build_examples.py           rebuild every example page
  python dev/build_examples.py --check   exit 2 if any page is missing or out of date (does not write)

--check also checks what an agent reading a page relies on: the reading guide on line 2, the data block in
<head> with the end marker straight after it, the real title, and that the guide's sed and python commands
print the model as valid JSON.
"""

from __future__ import annotations

import argparse
import html
import json
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from engine_runner import run_layout  # noqa: E402
from layout_engine import assemble_page, normalize_diagram_type  # noqa: E402


def build(source: Path) -> str:
    data = normalize_diagram_type(json.loads(source.read_text(encoding="utf-8")))
    return assemble_page(data["diagramType"], run_layout(data["diagramType"], data))


def reader_problems(page: str, title: str) -> list:
    """What an agent opening the page relies on (see the reading guide in assets/shell/shell.html)."""
    problems = []
    lines = page.split(chr(10))
    if not lines[1].startswith("<!-- For agents:"):
        problems.append("the reading guide is not on line 2")
    open_tag = '<script id="diagram-data" type="application/json">'
    start, head_end = page.find(open_tag), page.find("</head>")
    if not 0 < start < head_end:
        problems.append("the data block is not in <head>")
    close = page.find("</script>", start)
    if not page[close:].startswith("</script>" + chr(10) + "  <!-- end diagram-data -->"):
        problems.append("the end marker does not follow the data block")
    escaped = html.escape(title, quote=False)
    if f"<title>{escaped}</title>" not in page or f'title="Double-click to rename diagram">{escaped}</h1>' not in page:
        problems.append(f"<title>/<h1> do not show the diagram title {title!r}")
    guide = page[: page.find("-->")]
    commands = [line.strip() for line in guide.split(chr(10)) if line.strip().startswith(("sed ", "python "))]
    with tempfile.TemporaryDirectory() as tmp:
        file = Path(tmp) / "page.html"
        file.write_text(page, encoding="utf-8")
        for command in commands:
            argv = shlex.split(command.replace(" FILE", ""))
            if argv[0] == "python":
                argv[0] = sys.executable
            elif not shutil.which(argv[0]):
                continue  # no sed on this machine
            out = subprocess.run(argv + [str(file)], capture_output=True, text=True, encoding="utf-8").stdout
            body = out.strip()
            if argv[0] == "sed":  # sed prints the tag lines too
                body = chr(10).join(body.split(chr(10))[1:-1])
            try:
                json.loads(body)
            except ValueError:
                problems.append(f"the guide's {argv[0] if argv[0] == 'sed' else 'python'} command does not print valid JSON")
    if len(commands) != 2:
        problems.append(f"expected a sed and a python command in the reading guide, found {len(commands)}")
    return problems


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(description="Build dev/samples/example-*.html from the example JSON files.")
    parser.add_argument("--check", action="store_true", help="Report pages that are missing or stale; write nothing")
    args = parser.parse_args()

    stale = False
    for source in sorted((ROOT / "references" / "examples").glob("example-*.json")):
        target = ROOT / "dev" / "samples" / source.with_suffix(".html").name
        page = build(source)
        # Compare as text so a CRLF checkout does not look stale.
        current = target.read_text(encoding="utf-8") if target.exists() else None
        if args.check:
            ok = current == page
            problems = reader_problems(page, json.loads(source.read_text(encoding="utf-8")).get("title") or "")
            stale |= not ok or bool(problems)
            print(f"[{'PASS' if ok and not problems else 'STALE' if not ok else 'FAIL'}] {target.relative_to(ROOT)}")
            for problem in problems:
                print(f"  - {problem}")
        else:
            target.write_text(page, encoding="utf-8", newline="\n")
            print(f"[OK] {target.relative_to(ROOT)} ({len(page) // 1024} KB)")
    return 2 if stale else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)
