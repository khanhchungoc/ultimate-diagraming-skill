#!/usr/bin/env python3
"""Build the playground folder: a starter page of every diagram type with a type menu, for one claude.ai artifact.

Usage: python dev/build_playground.py -o <dir>
Writes <dir>/<type>/{index.html,diagram.json,app.css,app.js} for every supported type (assemble_artifact on
dev/playground/<type>.json, plus a <script id="playground"> that turns on the type menu and download-Save in
shell.js) and <dir>/index.html, which opens the flowchart. Design: dev/plans/plan-playground.md. Prints [DONE].
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import layout_engine as le  # noqa: E402

FIRST = "flowchart"
SCRIPT_TAG = '  <script src="app.js"></script>\n'


def build(out: Path) -> None:
    blanks = {k: json.loads((le.ASSETS_DIR / "types" / k / "blank.json").read_text(encoding="utf-8")) for k in le.SUPPORTED_TYPES}
    types = [{"id": k, "name": blanks[k]["title"]} for k in le.SUPPORTED_TYPES]
    for kind in le.SUPPORTED_TYPES:
        # Each page opens on a small starter flow (dev/playground/<type>.json: the must-have items of the type, e.g. a
        # flowchart's Start and End), not on the empty blank, to save the first minutes
        starter = json.loads((ROOT / "dev" / "playground" / f"{kind}.json").read_text(encoding="utf-8"))
        files = le.assemble_artifact(kind, starter)
        flag = json.dumps({"type": kind, "types": types}, ensure_ascii=False).replace("<", "\\u003c")
        index = files["index.html"]
        assert index.count(SCRIPT_TAG) == 1, "index.html no longer ends with the app.js tag"
        files["index.html"] = index.replace(SCRIPT_TAG, f'  <script id="playground" type="application/json">{flag}</script>\n' + SCRIPT_TAG)
        # A cross-document view transition can be aborted ("opt-in disabled", invalid state); its promises then reject with nobody
        # listening. Swallow them from the head, before the first pagereveal fires (app.js runs too late for that).
        guard = ('<script>document.documentElement.classList.add("is-loading"); for (const ev of ["pageswap", "pagereveal"]) addEventListener(ev, (e) => { const t = e.viewTransition; '
                 'if (t) for (const k of ["ready", "finished", "updateCallbackDone"]) t[k].catch(() => {}); }); '
                 'addEventListener("unhandledrejection", (e) => { if (e.reason && /Transition was (skipped|aborted)/.test(e.reason.message || "")) e.preventDefault(); });</script>\n')
        files["index.html"] = files["index.html"].replace("</head>", guard + "</head>", 1)
        files["app.css"] = files["app.css"].rstrip() + "\n@media (prefers-reduced-motion: no-preference) { @view-transition { navigation: auto; } }\n"
        for name, text in files.items():
            path = out / kind / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8", newline="\n")
    # The root is served inside the artifact skeleton like every index.html here: a full document of its own (ARTIFACT_HEAD)
    # that goes straight to the flowchart, with a link for when the script cannot navigate.
    (out / "index.html").write_text(
        le.ARTIFACT_HEAD + "\n<title>Diagram playground</title>\n"
        f'<script>location.replace("{FIRST}/index.html");</script>\n'
        f'<p><a href="{FIRST}/index.html">Open the flowchart</a></p>\n'
        + le.ARTIFACT_END_MARKER + "\n" + le.ARTIFACT_TAIL + "\n", encoding="utf-8", newline="\n")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("-o", "--output", required=True, help="Folder to write (created if missing)")
    out = Path(ap.parse_args().output)
    build(out)
    print(f"[OK] Playground written to {out}: index.html and {', '.join(le.SUPPORTED_TYPES)}")
    print("[DONE] Publish the folder as one artifact: file_path <dir>/index.html, files mapping every other path.")


if __name__ == "__main__":
    main()
