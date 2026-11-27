"""Disk format of the diagram data block: how the model is written into, and read back from, the page.

The in-memory model (what the engines, renderers and audits use) keeps positions on the objects: node x/y,
lane height/color, sequence participant x, message y. On disk the model is written for a reader instead:
semantic fields first, in a fixed key order, with every position moved into one trailing `layout` map
(flowchart; erd: absolute table x/y) or dropped altogether (sequence: the page lays it out on load).

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
from functools import lru_cache
from typing import Any, Callable, Dict, List, Optional, Tuple

import subprocess_flow
from tokens import load_tokens

SUPPORTED_TYPES = ("flowchart", "sequence", "erd", "usecase", "c4", "gantt")  # add a type here when its engine and reference exist

FLOWCHART_KEYS = ("diagramType", "schemaVersion", "title", "direction", "swimlanes", "showNotes",
                  "lanes", "nodes", "edges", "notes", "children", "layout")
CHILD_KEYS = ("name", "laneOrder", "laneHeights", "nodes", "edges", "notes")  # a child flow (subprocess tab) of a flowchart
SEQUENCE_KEYS = ("diagramType", "schemaVersion", "title", "numbered", "showDetails", "rails",
                 "lifespans", "participantOrder", "colorKey", "participants", "messages", "fragments", "notes")
# Engine output on the sequence model, never saved: positions, hidden (inside a collapsed frame), frame dividers
SEQUENCE_LAYOUT = (("participants", ("x", "rail", "top", "bottom")), ("messages", ("y", "hidden", "lab", "det")),
                   ("fragments", ("x", "y", "w", "h", "elseY", "dividers")), ("notes", ("x", "y", "w", "h")))
ERD_KEYS = ("diagramType", "schemaVersion", "title", "detail", "showTypes", "showNotes", "colorKey",
            "entities", "relationships", "notes", "layout")
ERD_SCHEMA_VERSION = 3  # v3: no groups (tables carry `color`), absolute positions; v1 and v2 layouts are dropped on read
ERD_ENTITY_LAYOUT = ("x", "y")  # a table's absolute top-left, in the `layout` map keyed by table id
# Engine output on the ERD model, never saved (plus the top-level "canvas", "_loose" and "_band")
ERD_DERIVED = (("entities", ("box",)), ("relationships", ("curve", "points", "labelBox")))
USECASE_KEYS = ("diagramType", "schemaVersion", "title", "showRefs", "showNotes", "colorKey",
                "subjects", "actors", "useCases", "links", "notes", "layout")
USECASE_SCHEMA_VERSION = 1
C4_KEYS = ("diagramType", "schemaVersion", "title", "arrange", "layerDirection", "showTech", "showNotes", "showSteps", "colorKey",
           "groups", "elements", "relations", "notes", "layout")
C4_SCHEMA_VERSION = 1
C4_ARRANGE = ("surround", "flow", "layers")  # the layout; absent means surround when any item is `core`, else flow
C4_LAYER_DIRECTIONS = ("horizontal", "vertical")
C4_SIDES = ("N", "S", "E", "W")  # author hint for the side of the centre an item sits on
C4_ELEMENT_KINDS = ("person", "system", "container", "component", "database", "queue", "external")
C4_GROUP_KINDS = ("boundary", "system", "container")  # "container" is reserved for Level 3; the audit rejects it in v1
GANTT_KEYS = ("diagramType", "schemaVersion", "title", "zoom", "showNotes", "showToday", "showWeekends", "colorKey",
              "holidays", "markers", "items", "dependencies", "notes")
GANTT_SCHEMA_VERSION = 1
GANTT_ZOOMS = ("day", "week", "2week", "month", "quarter", "year")
NODE_LAYOUT = ("x", "y")
LANE_LAYOUT = ("height", "color")
GENERATED_ID = re.compile(r"^(n|c|e|lane|t|m)_\d{12,}(_\d+)?$")  # editor ids: <prefix>_<Date.now()>[_k]
SLUG_MAX = 30


# --- Colours: a palette slot ("1".."9", assets/tokens/default.json) or a custom hex ---
# Diagrams saved before the slots stored the palette's hex (or, on a sequence fragment, a colour name). Reading and
# writing both turn those into slots; a hex that matches no slot is a custom colour and is written unchanged.
# Mirrors colorSlot() in assets/shell/shell.js.
OLD_FRAGMENT_COLORS = {"blue": "sky", "green": "emerald", "yellow": "amber", "red": "rose", "purple": "purple", "gray": "neutral"}
CUSTOM_HEX = re.compile(r"^#[0-9a-fA-F]{3,8}$")


@lru_cache(maxsize=1)
def _palette() -> Tuple[Tuple[str, ...], Dict[str, str]]:
    """(slot ids, {old name or lowercase hex: slot}) of the default palette."""
    pal = load_tokens()["palette"]
    by_name = {s["name"]: s["slot"] for s in pal}
    old = {s["hex"].lower(): s["slot"] for s in pal if s.get("hex")}
    old.update({n: by_name[t] for n, t in OLD_FRAGMENT_COLORS.items() if t in by_name})
    return tuple(s["slot"] for s in pal), old


def palette_slots() -> Tuple[str, ...]:
    return _palette()[0]


def color_slot(v: Any) -> Any:
    """The slot for a slot id, a palette hex or an old fragment colour name; any other value comes back unchanged."""
    slots, old = _palette()
    if not isinstance(v, str):
        return v
    return v if v in slots else old.get(v.lower(), v)


def color_kind(v: Any) -> str:
    """"slot", "custom" (a hex that is no slot) or "bad" (anything else), after color_slot()."""
    v = color_slot(v)
    return "slot" if v in palette_slots() else "custom" if isinstance(v, str) and CUSTOM_HEX.match(v) else "bad"


def slot_key(key: Any) -> Any:
    """A colorKey with its keys as slots; an old hex key never overwrites a slot key that is already there."""
    if not isinstance(key, dict):
        return key
    out: Dict[str, Any] = {}
    for k, v in key.items():
        out.setdefault(color_slot(k), v)
    # JavaScript lists integer-like keys (the slots) first, ascending: do the same so the page and this module write the same bytes
    slots = sorted((k for k in out if k.isdecimal() and str(int(k)) == k), key=int)
    return {**{k: out[k] for k in slots}, **{k: v for k, v in out.items() if k not in slots}}


def _slot_colors(d: Dict[str, Any], *lists: str) -> None:
    """In place: `color` of every object in the named lists, and colorKey, as slots."""
    for name in lists:
        for o in d.get(name) or []:
            if isinstance(o, dict) and "color" in o:
                o["color"] = color_slot(o["color"])
    if "colorKey" in d:
        d["colorKey"] = slot_key(d["colorKey"])


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
    kids = d.get("children") or {}
    tabs = [d, *kids.values()]
    lanes = d.get("lanes") or []
    nodes = [n for t in tabs for n in t.get("nodes") or []]
    edges = [e for t in tabs for e in t.get("edges") or []]
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
    for t in tabs:
        for note in t.get("notes") or []:
            if isinstance(note.get("nodes"), list):
                note["nodes"] = [rename.get(i, i) for i in note["nodes"]]
    for key, c in list(kids.items()):
        c["laneOrder"] = [rename.get(i, i) for i in c.get("laneOrder") or []]
        if "laneHeights" in c:
            c["laneHeights"] = {rename.get(k, k): v for k, v in c["laneHeights"].items()}
        if key in rename:
            kids[rename[key]] = kids.pop(key)


def flowchart_to_disk(data: Dict[str, Any]) -> Dict[str, Any]:
    d = copy.deepcopy(data)
    d.pop("layout", None)
    _slot_colors(d, "lanes")
    lanes, nodes = d.get("lanes") or [], d.get("nodes") or []
    kids = d.get("children") or {}
    # Flow order: x runs along the flow in both directions (the engine has ranked the steps already)
    for items, order in [(nodes, [lane.get("id") for lane in lanes])] + [(c.get("nodes") or [], c.get("laneOrder") or []) for c in kids.values()]:
        lane_index = {i: k for k, i in enumerate(order)}
        items.sort(key=lambda n: (n.get("x") or 0, lane_index.get(n.get("laneId"), 0), n.get("y") or 0))
    _rename_generated_ids(d)
    kids = d.get("children") or {}
    layout: Dict[str, Any] = {}
    for items, keys in [(lanes, LANE_LAYOUT), (nodes, NODE_LAYOUT)] + [(c.get("nodes") or [], NODE_LAYOUT) for c in kids.values()]:
        for o in items:
            pos = {k: o.pop(k) for k in keys if k in o}
            if pos:
                layout[o["id"]] = pos
    if layout:
        d["layout"] = layout
    if kids:  # in the order the parent flow reaches them (depth first), each with its keys in a fixed order
        d["children"] = {slug: _ordered(kids[slug], CHILD_KEYS) for slug in subprocess_flow.child_order(d)}
    return _ordered(d, FLOWCHART_KEYS)


def flowchart_from_disk(data: Dict[str, Any]) -> Dict[str, Any]:
    d = copy.deepcopy(data)
    layout = d.pop("layout", None) or {}
    kid_nodes = [n for c in (d.get("children") or {}).values() for n in c.get("nodes") or []]
    for o in (d.get("lanes") or []) + (d.get("nodes") or []) + kid_nodes:
        o.update(layout.get(o.get("id")) or {})
    _slot_colors(d, "lanes")
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
    _slot_colors(d, "participants", "fragments")
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
    d = copy.deepcopy(data)  # positions are derived on load (sequence.js render(), or engine_runner)
    _slot_colors(d, "participants", "fragments")
    return d


ERD_GENERATED_ID = re.compile(r"^(t|r|n)_\d{12,}(_\d+)?$")  # page ids: <prefix>_<Date.now()>[_k]


def _rename_erd_ids(d: Dict[str, Any]) -> None:
    """Readable names for page-generated ids (in place): table ids from their name, r<N>, n<N>.
    Authored ids are never touched. Mirrors erd.js."""
    es, rs, ns = d.get("entities") or [], d.get("relationships") or [], d.get("notes") or []
    used = {o.get("id") for o in es + rs + ns}
    rename: Dict[str, str] = {}

    def take(base: str) -> str:
        new, k = base, 2
        while new in used:
            new, k = f"{base}_{k}", k + 1
        used.add(new)
        return new

    def generated(o: Dict[str, Any]) -> bool:
        return bool(ERD_GENERATED_ID.match(str(o.get("id", ""))))

    for o in es:
        if generated(o):
            rename[o["id"]] = take(slug(o.get("name")) or "table")
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
    for o in es + rs + ns:
        o["id"] = r(o["id"])
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
    d.pop("_loose", None)
    d.pop("direction", None)
    d["schemaVersion"] = ERD_SCHEMA_VERSION
    _slot_colors(d, "entities")
    for items, keys in ERD_DERIVED:
        for o in d.get(items) or []:
            for k in keys:
                o.pop(k, None)
    _rename_erd_ids(d)
    if isinstance(d.get("colorKey"), dict):  # the legend keeps only the colours a table still uses
        used = {e.get("color") for e in d.get("entities") or []}
        d["colorKey"] = {k: v for k, v in d["colorKey"].items() if k in used}
        if not d["colorKey"]:
            del d["colorKey"]
    layout: Dict[str, Any] = {}
    for o in d.get("entities") or []:
        pos = {k: o.pop(k) for k in ERD_ENTITY_LAYOUT if k in o}
        if pos:
            layout[o["id"]] = pos
    if layout:
        d["layout"] = layout
    return _ordered(d, ERD_KEYS)


def erd_from_disk(data: Dict[str, Any]) -> Dict[str, Any]:
    d = copy.deepcopy(data)
    layout = d.pop("layout", None) or {}
    d.pop("direction", None)
    if d.get("schemaVersion") == ERD_SCHEMA_VERSION:
        for o in d.get("entities") or []:
            o.update(layout.get(o.get("id")) or {})
        _slot_colors(d, "entities")
        return d
    # v1/v2 (or none): the layout is dropped (the page and --layout lay it out afresh). Groups become table colours:
    # a group's colour is set on its tables, its name goes to colorKey (slot -> name) unless that hex already has an entry.
    groups = {g.get("id"): g for g in d.pop("groups", None) or []}
    key = slot_key(d.get("colorKey")) if isinstance(d.get("colorKey"), dict) else {}
    for e in d.get("entities") or []:
        g = groups.get(e.pop("group", None))
        if g and g.get("color"):
            e["color"] = color_slot(g["color"])
            if g.get("name") and e["color"] not in key:
                key[e["color"]] = g["name"]
    if key:
        d["colorKey"] = key
    _slot_colors(d, "entities")
    return d

# --- Use case diagrams (diagramType "usecase") -------------------------------------------------------------------------
# Codec spec. The page's toDisk/fromDisk (assets/types/usecase/usecase.js) must produce the same bytes:
#  to_disk(model):
#   1. deep copy; set schemaVersion 1; drop the top-level "layout", "canvas" and every top-level key that starts with "_"
#      except "_readme" (the shell adds that one itself, see with_readme()).
#   2. colours: `color` of actors and useCases, and colorKey, become palette slots (_slot_colors).
#   3. drop derived fields: on every object of subjects, actors, useCases, links and notes every key that starts with "_";
#      on subjects "x", "y", "w", "h"; on actors and useCases "w" and "h"; on links "points" and "labelBox".
#      (An anchored note carries no position, only its "_" fields are dropped; a free note keeps its absolute `pos`.)
#   4. rename editor ids (below), following every reference.
#   5. layout: {id: {"x": .., "y": ..}} for actors, then useCases, in array order, for those that have numeric x and y;
#      their "x"/"y" are removed from the objects. The "layout" key is omitted when empty.
#   6. key order USECASE_KEYS, then any unknown keys in their existing order.
#  from_disk(block): deep copy; drop "layout" and "direction"; when schemaVersion is absent or 1, put each layout entry's
#   x/y back on the actor or use case with that id (any other schemaVersion: the layout is dropped, the page lays out
#   afresh); colours as slots. "_readme" is removed by from_disk() before the codec runs.
#  Editor ids: <prefix>_<Date.now()>[_k] with prefix a (actor), u (use case), s (subject), l (link), n (note), 12+ digits.
#   Actors, use cases and subjects share one id namespace (links reference actors and use cases alike) and are renamed to
#   their name slug (slug(), "_" separator; "actor"/"use_case"/"subject" when the name is empty), suffix _2, _3 ... when
#   the id is taken. Links become the next free l<N>, notes the next free n<N>, counting from 1 in array order.
#   Renamed ids are followed in: link from/to, useCases[].subject, actors[].parent, useCases[].parent, notes[].useCases,
#   notes[].actors. Authored ids (anything not matching the pattern) are never touched.
USECASE_GENERATED_ID = re.compile(r"^(a|u|s|l|n)_\d{12,}(_\d+)?$")
USECASE_DERIVED = (("subjects", ("x", "y", "w", "h")), ("actors", ("w", "h")), ("useCases", ("w", "h")),
                   ("links", ("points", "labelBox")))
USECASE_OBJECTS = ("subjects", "actors", "useCases", "links", "notes")


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _rename_usecase_ids(d: Dict[str, Any]) -> Dict[str, str]:
    """Readable names for page-generated ids (in place); returns the old -> new map."""
    ss, acs, ucs = d.get("subjects") or [], d.get("actors") or [], d.get("useCases") or []
    ls, ns = d.get("links") or [], d.get("notes") or []
    used = {o.get("id") for o in ss + acs + ucs + ls + ns}
    rename: Dict[str, str] = {}

    def take(base: str) -> str:
        new, k = base, 2
        while new in used:
            new, k = f"{base}_{k}", k + 1
        used.add(new)
        return new

    def generated(o: Dict[str, Any]) -> bool:
        return bool(USECASE_GENERATED_ID.match(str(o.get("id", ""))))

    for items, fallback in ((acs, "actor"), (ucs, "use_case"), (ss, "subject")):
        for o in items:
            if generated(o):
                rename[o["id"]] = take(slug(o.get("name")) or fallback)
    for items, prefix in ((ls, "l"), (ns, "n")):
        count = 1
        for o in items:
            if generated(o):
                while f"{prefix}{count}" in used:
                    count += 1
                rename[o["id"]] = take(f"{prefix}{count}")
    if not rename:
        return rename
    r = lambda i: rename.get(i, i)  # noqa: E731
    for o in ss + acs + ucs + ls + ns:
        o["id"] = r(o["id"])
    for lk in ls:
        for k in ("from", "to"):
            if k in lk:
                lk[k] = r(lk[k])
    for o in acs + ucs:
        if "parent" in o:
            o["parent"] = r(o["parent"])
    for u in ucs:
        if "subject" in u:
            u["subject"] = r(u["subject"])
    for n in ns:
        for k in ("useCases", "actors"):
            if isinstance(n.get(k), list):
                n[k] = [r(i) for i in n[k]]
    return rename


def usecase_to_disk(data: Dict[str, Any]) -> Dict[str, Any]:
    d = copy.deepcopy(data)
    for k in [k for k in d if k in ("layout", "canvas") or (k.startswith("_") and k != README_KEY)]:
        del d[k]
    d["schemaVersion"] = USECASE_SCHEMA_VERSION
    _slot_colors(d, "actors", "useCases")
    for name in USECASE_OBJECTS:
        for o in d.get(name) or []:
            for k in [k for k in o if k.startswith("_")]:
                del o[k]
    for items, keys in USECASE_DERIVED:
        for o in d.get(items) or []:
            for k in keys:
                o.pop(k, None)
    _rename_usecase_ids(d)
    if isinstance(d.get("colorKey"), dict):  # the legend keeps only the colours a use case or actor still uses
        used = {o.get("color") for items in ("useCases", "actors") for o in (d.get(items) or []) if o.get("color")}
        d["colorKey"] = {k: v for k, v in d["colorKey"].items() if k in used}
        if not d["colorKey"]:
            del d["colorKey"]
    layout: Dict[str, Any] = {}
    for items in ("actors", "useCases"):
        for o in d.get(items) or []:
            if _is_num(o.get("x")) and _is_num(o.get("y")):
                layout[o["id"]] = {"x": o.pop("x"), "y": o.pop("y")}
    if layout:
        d["layout"] = layout
    return _ordered(d, USECASE_KEYS)


def usecase_from_disk(data: Dict[str, Any]) -> Dict[str, Any]:
    d = copy.deepcopy(data)
    layout = d.pop("layout", None) or {}
    d.pop("direction", None)
    if d.get("schemaVersion", USECASE_SCHEMA_VERSION) == USECASE_SCHEMA_VERSION:
        for name in ("actors", "useCases"):
            for o in d.get(name) or []:
                o.update(layout.get(o.get("id")) or {})
    _slot_colors(d, "actors", "useCases")
    return d


# --- C4 diagrams (diagramType "c4") -------------------------------------------------------------------------------------
# Codec spec. The page's toDisk/fromDisk (assets/types/c4/c4.js) must produce the same bytes:
#  to_disk(model): validate_c4(); deep copy; set schemaVersion 1; drop the top-level "layout", "canvas" and every top-level
#   key that starts with "_" except "_readme".
#   colours: `color` of elements and groups, and colorKey, become palette slots (_slot_colors).
#   derived fields dropped: every "_" key on groups, elements, relations and notes; "w", "h" on groups (x, y go to layout), "w", "h"
#   on elements, "points" and "labelBox" on relations.
#   ids: editor ids <prefix>_<Date.now()>[_k] (prefix e element, g group, n note, 12+ digits) are renamed to the name slug
#   (slug(), "_"; "element"/"group" when empty, suffix _2, _3 ... when taken); elements and groups share one id namespace;
#   notes become the next free n<N> counting from 1. Followed in: relations from/to, elements[].group, groups[].parent,
#   notes[].elements, notes[].groups. Authored ids are never touched. Relations have no id.
#   layout: {id: {"x", "y"}} for elements, then groups, in array order, for those with numeric x and y (removed from the
#   object); omitted when empty. Key order C4_KEYS, then unknown keys in their existing order.
#  from_disk(block): validate_c4(); deep copy; when schemaVersion is absent or 1 the layout x/y go back on the element or
#   group with that id (any other version: layout dropped); "layout" removed; colours as slots.
#  Groups are a tree of any depth through `parent`; the depth limit belongs to the audit, not the codec.
#  Layout fields, all optional, validated at the boundary (ValueError): top-level `arrange` (surround | flow | layers),
#   `core` (bool) and `side` (N | S | E | W) on elements and groups, `color` on elements and groups (a palette slot or a custom
#   hex, as the ERD and sequence codecs; written as a slot). They are kept as written; none is derived.
C4_GENERATED_ID = re.compile(r"^(e|g|n)_\d{12,}(_\d+)?$")
C4_DERIVED = (("groups", ("w", "h")), ("elements", ("w", "h")), ("relations", ("points", "labelBox")))
C4_OBJECTS = ("groups", "elements", "relations", "notes")


def validate_c4(d: Dict[str, Any]) -> None:
    """Boundary check of a c4 model: fails loudly (ValueError) on duplicate or unknown ids, unknown kinds and group
    cycles, an unknown `arrange` or `layerDirection`, a non-boolean `showSteps`/`core`/`shared`, a bad `side`, `span`,
    `step` or `color`, or self/ancestor-descendant relations. The group depth limit is not checked here (audit_c4)."""
    if d.get("arrange") is not None and d["arrange"] not in C4_ARRANGE:
        raise ValueError(f"c4: unknown arrange {d['arrange']!r}: use surround, flow or layers")
    if d.get("layerDirection") is not None and d["layerDirection"] not in C4_LAYER_DIRECTIONS:
        raise ValueError(f"c4: unknown layerDirection {d['layerDirection']!r}: use horizontal or vertical")
    if "showSteps" in d and not isinstance(d["showSteps"], bool):
        raise ValueError(f"c4: non-boolean showSteps {d['showSteps']!r}")
    groups, elements = d.get("groups") or [], d.get("elements") or []
    relations, notes = d.get("relations") or [], d.get("notes") or []
    seen: set = set()
    for o in groups + elements + notes:
        i = o.get("id")
        if not isinstance(i, str) or not i:
            raise ValueError(f"c4: object without an id: {o!r}")
        if i in seen:
            raise ValueError(f"c4: duplicate id {i!r}")
        seen.add(i)
    gids, eids = {g["id"] for g in groups}, {e["id"] for e in elements}
    for o in groups + elements:
        if o.get("side") is not None and o["side"] not in C4_SIDES:
            raise ValueError(f"c4: {o['id']!r} has bad side {o['side']!r}: use N, S, E or W")
        if "core" in o and not isinstance(o["core"], bool):
            raise ValueError(f"c4: {o['id']!r} has non-boolean core {o['core']!r}")
        if o.get("color") is not None and color_kind(o["color"]) == "bad":
            raise ValueError(f"c4: {o['id']!r} has bad color {o['color']!r}: use a palette slot or a hex")
    for g in groups:
        if g.get("kind", "boundary") not in C4_GROUP_KINDS:
            raise ValueError(f"c4: group {g['id']!r} has unknown kind {g.get('kind')!r}")
        if g.get("parent") is not None and g["parent"] not in gids:
            raise ValueError(f"c4: group {g['id']!r} has unknown parent {g['parent']!r}")
        if "shared" in g and not isinstance(g["shared"], bool):
            raise ValueError(f"c4: group {g['id']!r} has non-boolean shared {g['shared']!r}")
        if g.get("shared") is True:
            if g.get("parent") is not None:
                raise ValueError(f"c4: shared group {g['id']!r} cannot have a parent")
            if g.get("kind", "boundary") == "system":
                raise ValueError(f"c4: shared group {g['id']!r} cannot have kind 'system'")
    top_main_gids = {g["id"] for g in groups if g.get("parent") is None and not g.get("shared")}
    for g in groups:
        if "span" in g:
            span = g["span"]
            if not isinstance(span, list) or not span or not all(isinstance(i, str) and i in top_main_gids for i in span):
                raise ValueError(f"c4: group {g['id']!r} has invalid span {span!r}: must be a non-empty list of top-level non-shared group ids")
    for e in elements:
        if e.get("kind") not in C4_ELEMENT_KINDS:
            raise ValueError(f"c4: element {e['id']!r} has unknown kind {e.get('kind')!r}")
        if e.get("group") is not None and e["group"] not in gids:
            raise ValueError(f"c4: element {e['id']!r} has unknown group {e['group']!r}")
    parent = {g["id"]: g.get("parent") for g in groups}
    for start in parent:
        cur, hops = start, 0
        while cur is not None:
            cur, hops = parent[cur], hops + 1
            if hops > len(parent):
                raise ValueError(f"c4: group cycle through {start!r}")
    all_ids = eids | gids
    egroup = {e["id"]: e.get("group") for e in elements}

    def ancestors(oid: str) -> set:
        out: set = set()
        cur = egroup[oid] if oid in eids else parent.get(oid)
        while cur is not None:
            out.add(cur)
            cur = parent.get(cur)
        return out

    for r in relations:
        for k in ("from", "to"):
            if r.get(k) not in all_ids:
                raise ValueError(f"c4: relation {k} {r.get(k)!r} is not an element or group id")
        a, b = r["from"], r["to"]
        if a == b:
            raise ValueError(f"c4: relation {a!r} -> {b!r} cannot join an item to itself")
        if a in ancestors(b) or b in ancestors(a):
            raise ValueError(f"c4: relation {a!r} -> {b!r} cannot join an ancestor and its descendant")
        if "step" in r and (not isinstance(r["step"], str) or not r["step"].strip()):
            raise ValueError(f"c4: relation {a!r} -> {b!r} has invalid step {r['step']!r}: must be a non-empty string")
        if r.get("color") is not None and color_kind(r["color"]) == "bad":
            raise ValueError(f"c4: relation {a!r} -> {b!r} has bad color {r['color']!r}: use a palette slot or a hex")
    for n in notes:
        for k, ids in (("elements", eids), ("groups", gids)):
            for i in n.get(k) or []:
                if i not in ids:
                    raise ValueError(f"c4: note {n['id']!r} references unknown {k[:-1]} {i!r}")


def _rename_c4_ids(d: Dict[str, Any]) -> Dict[str, str]:
    """Readable names for page-generated ids (in place); returns the old -> new map."""
    gs, es, ns = d.get("groups") or [], d.get("elements") or [], d.get("notes") or []
    used = {o.get("id") for o in gs + es + ns}
    rename: Dict[str, str] = {}

    def take(base: str) -> str:
        new, k = base, 2
        while new in used:
            new, k = f"{base}_{k}", k + 1
        used.add(new)
        return new

    def generated(o: Dict[str, Any]) -> bool:
        return bool(C4_GENERATED_ID.match(str(o.get("id", ""))))

    for items, fallback in ((es, "element"), (gs, "group")):
        for o in items:
            if generated(o):
                rename[o["id"]] = take(slug(o.get("name")) or fallback)
    count = 1
    for o in ns:
        if generated(o):
            while f"n{count}" in used:
                count += 1
            rename[o["id"]] = take(f"n{count}")
    if not rename:
        return rename
    r = lambda i: rename.get(i, i)  # noqa: E731
    for o in gs + es + ns:
        o["id"] = r(o["id"])
    for rel in d.get("relations") or []:
        for k in ("from", "to"):
            rel[k] = r(rel[k])
    for o in es:
        if "group" in o:
            o["group"] = r(o["group"])
    for g in gs:
        if "parent" in g:
            g["parent"] = r(g["parent"])
        if isinstance(g.get("span"), list):
            g["span"] = [r(i) for i in g["span"]]
    for n in ns:
        for k in ("elements", "groups"):
            if isinstance(n.get(k), list):
                n[k] = [r(i) for i in n[k]]
    return rename


def c4_to_disk(data: Dict[str, Any]) -> Dict[str, Any]:
    validate_c4(data)
    d = copy.deepcopy(data)
    for k in [k for k in d if k in ("layout", "canvas") or (k.startswith("_") and k != README_KEY)]:
        del d[k]
    d["schemaVersion"] = C4_SCHEMA_VERSION
    _slot_colors(d, "elements", "groups", "relations")
    for name in C4_OBJECTS:
        for o in d.get(name) or []:
            for k in [k for k in o if k.startswith("_")]:
                del o[k]
    for items, keys in C4_DERIVED:
        for o in d.get(items) or []:
            for k in keys:
                o.pop(k, None)
    _rename_c4_ids(d)
    layout: Dict[str, Any] = {}
    for items in ("elements", "groups"):
        for o in d.get(items) or []:
            if _is_num(o.get("x")) and _is_num(o.get("y")):
                layout[o["id"]] = {"x": o.pop("x"), "y": o.pop("y")}
    if layout:
        d["layout"] = layout
    return _ordered(d, C4_KEYS)


def c4_from_disk(data: Dict[str, Any]) -> Dict[str, Any]:
    validate_c4(data)
    d = copy.deepcopy(data)
    layout = d.pop("layout", None) or {}
    if d.get("schemaVersion", C4_SCHEMA_VERSION) == C4_SCHEMA_VERSION:
        for name in ("elements", "groups"):
            for o in d.get(name) or []:
                o.update(layout.get(o.get("id")) or {})
    _slot_colors(d, "elements", "groups", "relations")
    return d


def validate_gantt(data: Dict[str, Any]) -> None:
    if not isinstance(data, dict):
        raise ValueError("gantt diagram must be a JSON object")
    for k in ("items", "dependencies", "markers", "holidays", "notes"):
        if k in data and not isinstance(data[k], list):
            raise ValueError(f"gantt '{k}' must be a list")


def _rename_gantt_ids(d: Dict[str, Any]) -> Dict[str, str]:
    items = d.get("items") or []
    markers = d.get("markers") or []
    notes = d.get("notes") or []
    used = {o.get("id") for o in items + markers + notes if isinstance(o, dict) and o.get("id") is not None}
    rename: Dict[str, str] = {}

    def take(base: str) -> str:
        new, k = base, 2
        while new in used:
            new, k = f"{base}_{k}", k + 1
        used.add(new)
        return new

    def generated(o: Dict[str, Any]) -> bool:
        return bool(GENERATED_ID.match(str(o.get("id", ""))))

    for group, fallback in ((items, "task"), (markers, "marker")):
        for o in group:
            if isinstance(o, dict) and generated(o):
                rename[o["id"]] = take(slug(o.get("label")) or fallback)
    count = 1
    for o in notes:
        if isinstance(o, dict) and generated(o):
            while f"n{count}" in used:
                count += 1
            rename[o["id"]] = take(f"n{count}")
    if not rename:
        return rename
    r = lambda i: rename.get(i, i)  # noqa: E731
    for o in items + markers + notes:
        if isinstance(o, dict) and "id" in o:
            o["id"] = r(o["id"])
    for o in items:
        if isinstance(o, dict) and "parent" in o:
            o["parent"] = r(o["parent"])
    for dep in d.get("dependencies") or []:
        if isinstance(dep, dict):
            for k in ("from", "to"):
                if k in dep:
                    dep[k] = r(dep[k])
    for n in notes:
        if isinstance(n, dict) and "target" in n:
            n["target"] = r(n["target"])
    return rename


def gantt_to_disk(data: Dict[str, Any]) -> Dict[str, Any]:
    validate_gantt(data)
    d = copy.deepcopy(data)
    for k in [k for k in d if k in ("layout", "canvas") or (k.startswith("_") and k != README_KEY)]:
        del d[k]
    d["schemaVersion"] = GANTT_SCHEMA_VERSION
    _slot_colors(d, "items", "markers")
    for list_key in ("items", "dependencies", "markers", "holidays", "notes"):
        for o in d.get(list_key) or []:
            if isinstance(o, dict):
                for k in [k for k in o if k.startswith("_")]:
                    del o[k]
    _rename_gantt_ids(d)
    return _ordered(d, GANTT_KEYS)


def gantt_from_disk(data: Dict[str, Any]) -> Dict[str, Any]:
    validate_gantt(data)
    d = copy.deepcopy(data)
    d.pop("layout", None)
    _slot_colors(d, "items", "markers")
    return d


Codec = Tuple[Callable[[Dict[str, Any]], Dict[str, Any]], Callable[[Dict[str, Any]], Dict[str, Any]]]
DISK_CODECS: Dict[str, Codec] = {
    "flowchart": (flowchart_to_disk, flowchart_from_disk),
    "sequence": (sequence_to_disk, sequence_from_disk),
    "erd": (erd_to_disk, erd_from_disk),
    "usecase": (usecase_to_disk, usecase_from_disk),
    "c4": (c4_to_disk, c4_from_disk),
    "gantt": (gantt_to_disk, gantt_from_disk),
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


# --- Free notes (flowchart, ERD, use case) ---
# A note explains steps, tables or use cases through a link list. An empty list makes it free: no new key, its `pos` is
# absolute (the coordinates a step, table or use case has), so a free note without a numeric pos is not a note. The codecs
# above pass notes through untouched (a use case note loses its "_" fields only); `pos` stays where the page put it.
NOTE_LINKS = {"flowchart": ("nodes",), "erd": ("entities",), "usecase": ("useCases", "actors")}


def free_notes(kind: str, data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The notes of `data` (a flowchart's subprocess flows included) that link to nothing."""
    keys = NOTE_LINKS.get(kind, ())
    flows = [data] + list((data.get("children") or {}).values()) if kind == "flowchart" else [data]
    return [n for f in flows for n in f.get("notes") or [] if isinstance(n, dict) and keys and not any(n.get(k) for k in keys)]


def check_notes(kind: str, data: Dict[str, Any]) -> None:
    """Raise ValueError for a free note with no numeric `pos` {x, y}."""
    for n in free_notes(kind, data):
        pos = n.get("pos")
        if not (isinstance(pos, dict) and _is_num(pos.get("x")) and _is_num(pos.get("y"))):
            raise ValueError(f"Note {n.get('id')!r} links to nothing and has no \"pos\" {{x, y}}: "
                             f"list the {'/'.join(NOTE_LINKS[kind])} it explains, or give it a position.")


def to_disk(kind: str, data: Dict[str, Any]) -> Dict[str, Any]:
    check_notes(kind, data)
    return DISK_CODECS[kind][0](data) if kind in DISK_CODECS else data


def from_disk(kind: str, data: Dict[str, Any]) -> Dict[str, Any]:
    data = {k: v for k, v in data.items() if k != README_KEY}
    check_notes(kind, data)
    return DISK_CODECS[kind][1](data) if kind in DISK_CODECS else data


def _auto_sequence_columns(d: Dict[str, Any]) -> Optional[Dict[str, str]]:
    """The column assignment `pack_sequence_columns` produces from messages and notes alone, or None."""
    ps = d.get("participants") or []
    if len(ps) <= 2 or any("id" not in p for p in ps) or len({p["id"] for p in ps}) != len(ps):
        return None
    ms = d.get("messages") or []
    ns = d.get("notes") or []
    midx = {m.get("id"): i for i, m in enumerate(ms)}
    columns: List[List[Tuple[int, int]]] = []
    hosts: List[str] = []
    assigned: Dict[str, str] = {}
    for p in ps:
        pid = p["id"]
        events = [i for i, m in enumerate(ms) if pid in (m.get("from"), m.get("to"))]
        for n in ns:
            over = n.get("over")
            over_list = over if isinstance(over, list) else [] if over is None else [over]
            if pid not in over_list:
                continue
            key = "after" if n.get("after") is not None else "before" if n.get("before") is not None else None
            at = midx.get(n[key]) if key else (0 if ms else None)
            if at is not None:
                events.append(at)
        if not events:
            continue
        lo, hi = min(events), max(events)
        for idx, col in enumerate(columns):
            if all(max(lo, olo) > min(hi, ohi) for olo, ohi in col):
                col.append((lo, hi))
                assigned[pid] = hosts[idx]
                break
        else:
            columns.append([(lo, hi)])
            hosts.append(pid)
    return assigned if len(assigned) >= 2 else None


def _strip_auto_sequence_columns(d: Dict[str, Any]) -> None:
    """Drop `lifespans` and participant `column` when they match `pack_sequence_columns`'s automatic defaults."""
    ps = d.get("participants") or []
    if d.get("lifespans") is not True or any("id" not in p for p in ps) or any(p.get(k) is not None for p in ps for k in ("start", "end")):
        return
    cols = {p["id"]: p.get("column") for p in ps if p.get("column") is not None}
    if len(cols) >= 2 and cols == _auto_sequence_columns(d):
        d.pop("lifespans", None)
        for p in ps:
            p.pop("column", None)


def authoring_json(kind: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """The disk model without `layout`: what an agent writes, and what `--extract` prints."""
    d = to_disk(kind, data)
    d.pop("layout", None)
    d.pop(README_KEY, None)
    for c in (d.get("children") or {}).values():
        c.pop("laneHeights", None)
    if kind == "sequence":
        _strip_auto_sequence_columns(d)
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

