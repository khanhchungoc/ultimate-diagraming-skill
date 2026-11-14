"""Disk format of the diagram data block: how the model is written into, and read back from, the page.

The in-memory model (what the engines, renderers and audits use) keeps positions on the objects: node x/y,
lane height/color, sequence participant x, message y. On disk the model is written for a reader instead:
semantic fields first, in a fixed key order, with every position moved into one trailing `layout` map
(flowchart, erd: table x/y only) or dropped altogether (sequence: the page lays it out on load).

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
SEQUENCE_KEYS = ("diagramType", "schemaVersion", "title", "numbered", "showDetails", "rails",
                 "lifespans", "colorKey", "participants", "messages", "fragments", "notes")
# Engine output on the sequence model, never saved: positions, hidden (inside a collapsed frame), frame dividers
SEQUENCE_LAYOUT = (("participants", ("x", "rail", "top", "bottom")), ("messages", ("y", "hidden")),
                   ("fragments", ("x", "y", "w", "h", "elseY", "dividers")), ("notes", ("x", "y", "w", "h")))
ERD_KEYS = ("diagramType", "schemaVersion", "title", "direction", "detail", "showTypes", "showNotes", "colorKey",
            "groups", "entities", "relationships", "notes", "layout")
ERD_ENTITY_LAYOUT = ("x", "y")  # flow-term position of a table: moved into the trailing `layout` map
# Engine output on the ERD model, never saved (plus the top-level "canvas" and "_band")
ERD_DERIVED = (("entities", ("box",)), ("groups", ("box",)), ("relationships", ("points", "labelBox")))
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


SEQUENCE_GENERATED_ID = re.compile(r"^(p|m|f|n)_\d{12,}(_\d+)?$")  # page ids: <prefix>_<Date.now()>_<k>


def _rename_sequence_ids(d: Dict[str, Any]) -> None:
    """Readable names for page-generated ids (in place): m<N>, p_<name slug>, f<N>, n<N>. Mirrors sequence.js."""
    ps, ms = d.get("participants") or [], d.get("messages") or []
    fs, ns = d.get("fragments") or [], d.get("notes") or []
    used = {o.get("id") for o in ps + ms + fs + ns}
    rename: Dict[str, str] = {}

    def take(base: str) -> str:
        new, k = base, 2
        while new in used:
            new, k = f"{base}_{k}", k + 1
        used.add(new)
        return new

    def generated(o: Dict[str, Any]) -> bool:
        return bool(SEQUENCE_GENERATED_ID.match(str(o.get("id", ""))))

    for p in ps:
        if generated(p):
            rename[p["id"]] = take("p_" + (slug(p.get("name")) or "participant"))
    for items, prefix in ((ms, "m"), (fs, "f"), (ns, "n")):
        count = 1
        for o in items:
            if generated(o):
                while f"{prefix}{count}" in used:
                    count += 1
                rename[o["id"]] = take(f"{prefix}{count}")
    if not rename:
        return
    r = lambda i: rename.get(i, i)  # noqa: E731
    for o in ps + ms + fs + ns:
        o["id"] = r(o["id"])
    for m in ms:
        for k in ("from", "to"):
            if k in m:
                m[k] = r(m[k])
    for q in ps:
        for k in ("column", "start", "end"):
            if k in q:
                q[k] = r(q[k])
    for f in fs:
        for k in ("from", "to", "elseAt"):
            if k in f:
                f[k] = r(f[k])
        for b in f.get("branches") or []:
            if isinstance(b, dict) and "at" in b:
                b["at"] = r(b["at"])
    for n in ns:
        if isinstance(n.get("over"), list):
            n["over"] = [r(i) for i in n["over"]]
        elif "over" in n:
            n["over"] = r(n["over"])
        for k in ("after", "before"):
            if k in n:
                n[k] = r(n[k])


def sequence_to_disk(data: Dict[str, Any]) -> Dict[str, Any]:
    d = copy.deepcopy(data)
    d.pop("layout", None)  # canvas size, derived by the engine
    _rename_sequence_ids(d)
    for items, keys in SEQUENCE_LAYOUT:
        for o in d.get(items) or []:
            for k in keys:
                o.pop(k, None)
    if isinstance(d.get("colorKey"), dict):  # the colour key keeps only the swatches a participant still uses
        used = {p.get("color") for p in d.get("participants") or []}
        d["colorKey"] = {k: v for k, v in d["colorKey"].items() if k in used}
        if not d["colorKey"]:
            del d["colorKey"]
    return _ordered(d, SEQUENCE_KEYS)


def sequence_from_disk(data: Dict[str, Any]) -> Dict[str, Any]:
    return copy.deepcopy(data)  # positions are derived on load (sequence.js render(), or engine_runner)


ERD_GENERATED_ID = re.compile(r"^(t|r|g|n)_\d{12,}(_\d+)?$")  # page ids: <prefix>_<Date.now()>[_k]


def _rename_erd_ids(d: Dict[str, Any]) -> None:
    """Readable names for page-generated ids (in place): table and area ids from their name, r<N>, n<N>.
    Authored ids are never touched. Mirrors erd.js."""
    gs, es = d.get("groups") or [], d.get("entities") or []
    rs, ns = d.get("relationships") or [], d.get("notes") or []
    used = {o.get("id") for o in gs + es + rs + ns}
    rename: Dict[str, str] = {}

    def take(base: str) -> str:
        new, k = base, 2
        while new in used:
            new, k = f"{base}_{k}", k + 1
        used.add(new)
        return new

    def generated(o: Dict[str, Any]) -> bool:
        return bool(ERD_GENERATED_ID.match(str(o.get("id", ""))))

    for items, fallback in ((es, "table"), (gs, "area")):
        for o in items:
            if generated(o):
                rename[o["id"]] = take(slug(o.get("name")) or fallback)
    for items, prefix in ((rs, "r"), (ns, "n")):
        count = 1
        for o in items:
            if generated(o):
                while f"{prefix}{count}" in used:
                    count += 1
                rename[o["id"]] = take(f"{prefix}{count}")
    if not rename:
        return
    r = lambda i: rename.get(i, i)  # noqa: E731
    for o in gs + es + rs + ns:
        o["id"] = r(o["id"])
    for e in es:
        if "group" in e:
            e["group"] = r(e["group"])
    for rel in rs:
        for k in ("from", "to"):
            if k in rel:
                rel[k] = r(rel[k])
    for n in ns:
        if isinstance(n.get("entities"), list):
            n["entities"] = [r(i) for i in n["entities"]]


def erd_to_disk(data: Dict[str, Any]) -> Dict[str, Any]:
    d = copy.deepcopy(data)
    d.pop("layout", None)
    d.pop("canvas", None)
    d.pop("_band", None)
    for items, keys in ERD_DERIVED:
        for o in d.get(items) or []:
            for k in keys:
                o.pop(k, None)
    _rename_erd_ids(d)
    layout: Dict[str, Any] = {}
    for e in d.get("entities") or []:
        pos = {k: e.pop(k) for k in ERD_ENTITY_LAYOUT if k in e}
        if pos:
            layout[e["id"]] = pos
    if layout:
        d["layout"] = layout
    return _ordered(d, ERD_KEYS)


def erd_from_disk(data: Dict[str, Any]) -> Dict[str, Any]:
    d = copy.deepcopy(data)
    layout = d.pop("layout", None) or {}
    for e in d.get("entities") or []:
        e.update(layout.get(e.get("id")) or {})
    return d


Codec = Tuple[Callable[[Dict[str, Any]], Dict[str, Any]], Callable[[Dict[str, Any]], Dict[str, Any]]]
DISK_CODECS: Dict[str, Codec] = {
    "flowchart": (flowchart_to_disk, flowchart_from_disk),
    "sequence": (sequence_to_disk, sequence_from_disk),
    "erd": (erd_to_disk, erd_from_disk),
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
    data = {k: v for k, v in data.items() if k != README_KEY}
    return DISK_CODECS[kind][1](data) if kind in DISK_CODECS else data


def authoring_json(kind: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """The disk model without `layout`: what an agent writes, and what `--extract` prints."""
    d = to_disk(kind, data)
    d.pop("layout", None)
    d.pop(README_KEY, None)
    return d


# The block's first key: a one-line "how to read this model" for an agent that parsed the JSON and never saw the
# header comment. The page carries it through load and Save unchanged (shell.js); readers drop it (from_disk).
README_KEY = "_readme"


def with_readme(disk: Dict[str, Any], readme: str) -> Dict[str, Any]:
    return {README_KEY: readme, **{k: v for k, v in disk.items() if k != README_KEY}}


def readme_text(data_note: str) -> str:
    """meta.json dataNote as the block's "_readme" line (the only place the page states it)."""
    return "How to read this model: " + " ".join(data_note.split())


# The reading guide on line 2 names the data block's line range. stamp_reading_guide() rewrites those numbers
# from the page's actual text; the page's Save does the same (stampReadingGuide in shell.js) so they never go stale.
GUIDE_START = "<!-- For agents:"
DATA_OPEN_TAG = '<script id="diagram-data" type="application/json">'
DATA_END_MARKER = "<!-- end diagram-data -->"


def stamp_reading_guide(page: str) -> str:
    g = page.find(GUIDE_START)
    o, e = page.find(DATA_OPEN_TAG), page.find(DATA_END_MARKER)
    if g < 0 or o < 0 or e < 0:
        return page
    g_end = page.find("\n", g)
    g_end = len(page) if g_end < 0 else g_end
    start, end = page.count("\n", 0, o) + 1, page.count("\n", 0, e) + 1
    line = re.sub(r"on lines \d+-\d+ of this file", f"on lines {start}-{end} of this file", page[g:g_end])
    line = re.sub(r"(Read lines 1-|limit |after line )\d+", lambda m: f"{m.group(1)}{end}", line)
    return page[:g] + line + page[g_end:]

