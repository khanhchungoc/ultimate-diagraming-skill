#!/usr/bin/env python3
"""Write the unsplit twin of every connector fixture: each connector pair joined back into the whole arrow.

dev/fixtures/flowchart/connector-*.json -> dev/fixtures/flowchart/unsplit/connector-*.json. check_golden.py lays out
both and requires every step to land in the same place: splitting an arrow into a connector pair never moves a step.

Usage: python dev/make_unsplit.py            rewrite the twins
       python dev/make_unsplit.py --check    exit 2 if a twin is missing or stale
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "flowchart"


def unsplit(data: dict) -> dict:
    """Join every connector pair: src -> (A) ... (A) -> tgt becomes src -> tgt with the in-arrow's id, label, feedback."""
    nodes, edges = data["nodes"], data["edges"]
    conn = {n["id"]: n for n in nodes if n.get("type") == "connector"}
    letter = lambda n: str(n.get("label", "")).strip().upper()
    out_of = {}
    for e in edges:
        if e["from"] in conn:
            out_of.setdefault(letter(conn[e["from"]]), []).append(e)
    joined = []
    for e in edges:
        if e["from"] in conn:
            continue
        if e["to"] in conn:
            for k, o in enumerate(out_of.get(letter(conn[e["to"]]), [])):
                j = {**e, "id": e["id"] if not k else f"{e['id']}~{o['id']}", "to": o["to"]}
                joined.append(j)
            continue
        joined.append(e)
    twin = dict(data)
    twin["title"] = data.get("title", "") + " (unsplit twin)"
    twin["nodes"] = [n for n in nodes if n["id"] not in conn]
    twin["edges"] = joined
    return twin


def main() -> int:
    check = "--check" in sys.argv
    stale = False
    for path in sorted(FIXTURES.glob("connector-*.json")):
        text = json.dumps(unsplit(json.loads(path.read_text(encoding="utf-8"))), indent=2) + "\n"
        twin = FIXTURES / "unsplit" / path.name
        if check:
            if not twin.is_file() or twin.read_text(encoding="utf-8") != text:
                print(f"[STALE] {twin}")
                stale = True
            continue
        twin.parent.mkdir(exist_ok=True)
        twin.write_text(text, encoding="utf-8")
        print(f"[WROTE] {twin}")
    return 2 if stale else 0


if __name__ == "__main__":
    sys.exit(main())
