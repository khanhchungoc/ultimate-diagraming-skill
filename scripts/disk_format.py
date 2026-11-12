"""Disk format of the diagram data block: how the model is written into, and read back from, the page.

The in-memory model (what the engines, renderers and audits use) keeps positions on the objects: node x/y,
lane height/color, sequence participant x, message y. On disk the model is written for a reader instead:
semantic fields first, in a fixed key order, with every position moved into one trailing `layout` map
(flowchart) or dropped altogether (sequence: the page lays it out on load).

The page does the same in JavaScript (plugin.toDisk / plugin.fromDisk in assets/types/<type>/<type>.js).
The two must stay byte-identical: dev/e2e_shell.mjs and dev/e2e_sequence.mjs save a generated page without
edits and compare the saved block with the generated one.

Standard library only.
"""

from __future__ import annotations

import copy
import json
import re
import unicodedata
from typing import Any, Callable, Dict, Tuple

FLOWCHART_KEYS = ("diagramType", "schemaVersion", "title", "direction", "swimlanes", "showNotes",
                  "lanes", "nodes", "edges", "notes", "layout")
SEQUENCE_KEYS = ("diagramType", "schemaVersion", "title", "participants", "messages", "fragments")
NODE_LAYOUT = ("x", "y")
LANE_LAYOUT = ("height", "color")
GENERATED_ID = re.compile(r"^(n|c|e|lane)_\d{12,}(_\d+)?$")  # editor ids: <prefix>_<Date.now()>[_k]
SLUG_MAX = 30


def _ordered(data: Dict[str, Any], keys: Tuple[str, ...]) -> Dict[str, Any]:
    """Known keys in `keys` order, then any other keys in their existing order."""
    out = {k: data[k] for k in keys if k in data}
    out.update((k, v) for k, v in data.items() if k not in out)
    return out


def slug(text: Any, sep: str = "_") -> str:
    """Lowercase ASCII words joined by `sep`, at most SLUG_MAX chars. Mirrors slug() in flowchart.js."""
    s = str(text or "").lower().replace("đ", "d")
    s = re.sub("[̀-ͯ]", "", unicodedata.normalize("NFKD", s))
    s = re.sub(r"[^a-z0-9]+", sep, s).strip(sep)
    if len(s) > SLUG_MAX:
        s = s[:SLUG_MAX].rstrip(sep)
    return s


def _rename_generated_ids(d: Dict[str, Any]) -> None:
    """Give editor-generated ids a readable name (in place); ids an author chose are never touched."""
    lanes, nodes, edges = d.get("lanes") or [], d.get("nodes") or [], d.get("edges") or []
    used = {o.get("id") for o in lanes + nodes + edges}
    rename: Dict[str, str] = {}

    def take(base: str) -> str:
        new, k = base, 2
        while new in used:
            new, k = f"{base}_{k}", k + 1
        used.add(new)
        return new

    for lane in lanes:
        if GENERATED_ID.match(str(lane.get("id", ""))):
            rename[lane["id"]] = take("lane-" + (slug(lane.get("name"), "-") or "lane"))
    for n in nodes:
        if not GENERATED_ID.match(str(n.get("id", ""))):
            continue
        if n.get("type") == "connector":
            role = "in" if any(e.get("to") == n["id"] for e in edges) else "out"
            base = f"c_{slug(n.get('label')) or 'x'}_{role}"
        else:
            base = "n_" + (slug(n.get("label")) or "step")
        rename[n["id"]] = take(base)
    count = 1
    for e in edges:
        if GENERATED_ID.match(str(e.get("id", ""))):
            while f"e{count}" in used:
                count += 1
            rename[e["id"]] = take(f"e{count}")
    if not rename:
        return
    for o in lanes + nodes + edges:
        o["id"] = rename.get(o["id"], o["id"])
    for n in nodes:
        if "laneId" in n:
            n["laneId"] = rename.get(n["laneId"], n["laneId"])
    for e in edges:
        for k in ("from", "to"):
            if k in e:
                e[k] = rename.get(e[k], e[k])
    for note in d.get("notes") or []:
        if isinstance(note.get("nodes"), list):
            note["nodes"] = [rename.get(i, i) for i in note["nodes"]]


def flowchart_to_disk(data: Dict[str, Any]) -> Dict[str, Any]:
    d = copy.deepcopy(data)
    d.pop("layout", None)
    lanes, nodes = d.get("lanes") or [], d.get("nodes") or []
    lane_index = {lane.get("id"): i for i, lane in enumerate(lanes)}
    # Flow order: x runs along the flow in both directions (the engine has ranked the steps already)
    nodes.sort(key=lambda n: (n.get("x") or 0, lane_index.get(n.get("laneId"), 0), n.get("y") or 0))
    _rename_generated_ids(d)
    layout: Dict[str, Any] = {}
    for items, keys in ((lanes, LANE_LAYOUT), (nodes, NODE_LAYOUT)):
        for o in items:
            pos = {k: o.pop(k) for k in keys if k in o}
            if pos:
                layout[o["id"]] = pos
    if layout:
        d["layout"] = layout
    return _ordered(d, FLOWCHART_KEYS)


def flowchart_from_disk(data: Dict[str, Any]) -> Dict[str, Any]:
    d = copy.deepcopy(data)
    layout = d.pop("layout", None) or {}
    for o in (d.get("lanes") or []) + (d.get("nodes") or []):
        o.update(layout.get(o.get("id")) or {})
    return d


def sequence_to_disk(data: Dict[str, Any]) -> Dict[str, Any]:
    d = copy.deepcopy(data)
    d.pop("layout", None)  # canvas size, derived by the engine
    for items, keys in (("participants", ("x",)), ("messages", ("y",)), ("fragments", ("x", "y", "w", "h", "elseY"))):
        for o in d.get(items) or []:
            for k in keys:
                o.pop(k, None)
    return _ordered(d, SEQUENCE_KEYS)


def sequence_from_disk(data: Dict[str, Any]) -> Dict[str, Any]:
    return copy.deepcopy(data)  # positions are derived on load (sequence.js render(), or engine_runner)


Codec = Tuple[Callable[[Dict[str, Any]], Dict[str, Any]], Callable[[Dict[str, Any]], Dict[str, Any]]]
DISK_CODECS: Dict[str, Codec] = {
    "flowchart": (flowchart_to_disk, flowchart_from_disk),
    "sequence": (sequence_to_disk, sequence_from_disk),
}


def _scalar(v: Any) -> bool:
    return not isinstance(v, (dict, list))


def _flat(v: Any) -> bool:
    """A container written on one line: its values are scalars or lists of scalars."""
    values = v.values() if isinstance(v, dict) else v
    return all(_scalar(x) or (isinstance(x, list) and all(_scalar(y) for y in x)) for x in values)


def format_json(v: Any, indent: str = "") -> str:
    """JSON with one line per flat object (a lane, a node, an edge, a layout entry). Mirrors formatJson() in
    shell.js; the top level is always expanded."""
    if _scalar(v):
        return json.dumps(v, ensure_ascii=False)
    items = list(v.items()) if isinstance(v, dict) else [(None, x) for x in v]
    if not items:
        return "{}" if isinstance(v, dict) else "[]"
    key = lambda k: "" if k is None else json.dumps(k, ensure_ascii=False) + ": "  # noqa: E731
    if indent and _flat(v):
        inline = lambda x: format_json(x) if _scalar(x) else "[" + ", ".join(format_json(y) for y in x) + "]"  # noqa: E731
        body = ", ".join(key(k) + inline(x) for k, x in items)
        return ("{ " + body + " }") if isinstance(v, dict) else ("[" + body + "]")
    inner = indent + "  "
    body = ",\n".join(inner + key(k) + format_json(x, inner) for k, x in items)
    opening, closing = ("{", "}") if isinstance(v, dict) else ("[", "]")
    return opening + "\n" + body + "\n" + indent + closing


def to_disk(kind: str, data: Dict[str, Any]) -> Dict[str, Any]:
    return DISK_CODECS[kind][0](data) if kind in DISK_CODECS else data


def from_disk(kind: str, data: Dict[str, Any]) -> Dict[str, Any]:
    return DISK_CODECS[kind][1](data) if kind in DISK_CODECS else data


def authoring_json(kind: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """The disk model without `layout`: what an agent writes, and what `--extract` prints."""
    d = to_disk(kind, data)
    d.pop("layout", None)
    return d

