"""Audit for C4 / system landscape diagrams (diagramType "c4"): model rules on the logical JSON (groups, elements, relations).

Works on the logical data only (see "Data" in dev/plans/plan-c4.md), so it needs no browser and no layout. The group depth
limit lives in MAX_GROUP_DEPTH and nowhere else: raising it (and nothing more) is what turns Level 3 on.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Set

MAX_GROUP_DEPTH = 2        # the ONLY depth limit. Groups nest to this depth; 3 turns Level 3 on (container groups, components)
GROUP_KINDS = ("boundary", "system", "container")
ARRANGES = ("surround", "flow", "layers")
MAX_GROUP_CHILDREN = 12    # more visible children than this in a group: suggest splitting
MAX_VISIBLE = 80           # more visible elements than this: the page opens with system groups collapsed
MAX_LABEL = 40             # characters; a longer relation label overflows its pill
ERROR_PENALTY = 12


def _s(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ""


def _group(e: Dict[str, Any]) -> Any:
    """The element's group id (the first when a list was written; the audit reports the list)."""
    g = e.get("group")
    return (g[0] if g else None) if isinstance(g, (list, tuple)) else g


class C4Audit:
    title = "C4 Diagram"

    def __init__(self, data: Dict[str, Any], icon_packs: Optional[Iterable[str]] = None):
        self.data = data
        self.groups: List[Dict[str, Any]] = data.get("groups") or []
        self.elements: List[Dict[str, Any]] = data.get("elements") or []
        self.relations: List[Dict[str, Any]] = data.get("relations") or []
        self.icon_packs = set(icon_packs or ())

    def pass_line(self, report: Dict[str, Any]) -> str:
        return "[PASS] Model clean."

    def verify_collisions(self) -> Dict[str, Any]:
        errors: List[str] = []
        warns: List[str] = []
        info: List[str] = []
        gs, es, rs = self.groups, self.elements, self.relations

        # Ids share one space (the layout map keys groups and elements together).
        seen: Set[Any] = set()
        for o in gs + es:
            i = o.get("id")
            if i in seen:
                errors.append(f"Duplicate id '{i}': ids are unique across groups and elements.")
            seen.add(i)
        gmap = {g.get("id"): g for g in gs}
        emap = {e.get("id"): e for e in es}

        # Groups: kind, parent, cycle, depth.
        for g in gs:
            gid = g.get("id")
            kind = g.get("kind")
            if kind == "container" and MAX_GROUP_DEPTH < 3:  # a container group holds depth-3 components
                errors.append(f"Group '{gid}' has kind 'container': container groups arrive with Level 3.")
            elif kind not in GROUP_KINDS:
                errors.append(f"Group '{gid}' has kind '{kind}': use boundary or system.")
            p = g.get("parent")
            if p is not None and p not in gmap:
                errors.append(f"Group '{gid}' has parent '{p}', which is not a group.")
        cyclic: Set[Any] = set()
        depth: Dict[Any, int] = {}
        for g in gs:
            chain, cur = [], g.get("id")
            while cur in gmap and cur not in chain:
                chain.append(cur)
                cur = gmap[cur].get("parent")
            if cur in chain:
                cyclic.update(chain[chain.index(cur):])
            depth[g.get("id")] = len(chain)
        for gid in sorted(cyclic, key=str):
            errors.append(f"Group '{gid}' is in a parent cycle: a group cannot contain itself.")
        for g in gs:
            gid = g.get("id")
            if gid not in cyclic and depth[gid] > MAX_GROUP_DEPTH:
                errors.append(f"Group '{gid}' is nested {depth[gid]} deep: groups nest at most {MAX_GROUP_DEPTH} deep.")

        # Elements: one group, which exists.
        for e in es:
            grp = _group(e)
            if isinstance(e.get("group"), (list, tuple)) and len(e["group"]) > 1:
                errors.append(f"Element '{e.get('id')}' is in {len(e['group'])} groups: an element belongs to one group.")
            if grp is not None and grp not in gmap:
                errors.append(f"Element '{e.get('id')}' is in group '{grp}', which does not exist.")

        # Relations.
        degree: Dict[Any, int] = {}
        pairs: Dict[Any, int] = {}
        for r in rs:
            a, b, label = r.get("from"), r.get("to"), _s(r.get("label"))
            for end in (a, b):
                if end not in emap:
                    errors.append(f"Relation {a} -> {b} points at unknown id '{end}': relations join elements.")
            if not label:
                errors.append(f"Relation {a} -> {b} has no label: every arrow says what it does.")
            if a == b and a in emap:
                errors.append(f"Relation {a} -> {b} joins an element to itself: relate two different elements.")
            elif a in emap and b in emap:
                degree[a] = degree.get(a, 0) + 1
                degree[b] = degree.get(b, 0) + 1
                if emap[a].get("kind") == "container" and emap[b].get("kind") == "container" and not _s(r.get("tech")):
                    warns.append(f"Relation {a} -> {b} joins two containers with no 'tech': add the protocol (REST, gRPC, AMQP).")
                key = (a, b, label)
                pairs[key] = pairs.get(key, 0) + 1
                if pairs[key] == 2:
                    warns.append(f"Relation {a} -> {b} appears twice with the label '{label}': merge or relabel.")
            if len(label) > MAX_LABEL:
                warns.append(f"Relation {a} -> {b} label is over {MAX_LABEL} characters: shorten it.")

        for e in es:
            if not degree.get(e.get("id")):
                what = "Person" if e.get("kind") == "person" else "Element"
                warns.append(f"{what} '{e.get('id')}' has no relation: connect it or remove it.")
            if e.get("kind") == "external" and gmap.get(_group(e), {}).get("kind") == "system":
                warns.append(f"External element '{e.get('id')}' is inside system group '{e.get('group')}': move it out; externals live outside the system.")
            icon = _s(e.get("icon"))
            if icon.startswith("logo:") and "/" in icon:
                pack = icon[5:].split("/", 1)[0]
                if pack not in self.icon_packs:
                    warns.append(f"Element '{e.get('id')}' uses icon pack '{pack}', which is not installed: it falls back to its generic icon.")

        # Visible children per group (collapsed groups show none).
        def hidden(gid: Any) -> bool:
            seen_g: Set[Any] = set()
            while gid in gmap and gid not in seen_g:
                seen_g.add(gid)
                if gmap[gid].get("collapsed"):
                    return True
                gid = gmap[gid].get("parent")
            return False

        kids: Dict[Any, int] = {}
        for e in es:
            if _group(e) in gmap:
                kids[_group(e)] = kids.get(_group(e), 0) + 1
        for g in gs:
            if g.get("parent") in gmap:
                kids[g["parent"]] = kids.get(g["parent"], 0) + 1
        for gid, n in kids.items():
            if n > MAX_GROUP_CHILDREN and not hidden(gid):
                warns.append(f"Group '{gid}' has {n} children: split it into smaller groups.")

        # Arrange: the layout, `core` centres and layer bands.
        arrange = self.data.get("arrange")
        if arrange is not None and arrange not in ARRANGES:
            errors.append(f"Unknown arrange '{arrange}': use surround, flow or layers.")
        cores = [o for o in gs + es if o.get("core")]
        layout = arrange if arrange in ARRANGES else "surround" if cores else "flow"
        if layout == "layers":
            def top(gid: Any) -> Any:  # the top-level group a group sits in (cycles end at the chain)
                seen_g: Set[Any] = set()
                while gid in gmap and gmap[gid].get("parent") in gmap and gid not in seen_g:
                    seen_g.add(gid)
                    gid = gmap[gid]["parent"]
                return gid if gid in gmap else None

            band = {g.get("id"): i for i, g in enumerate(g for g in gs if g.get("parent") not in gmap)}
            where = {e.get("id"): band.get(top(_group(e))) for e in es}
            for e in es:
                if where[e.get("id")] is None:
                    errors.append(f"Element '{e.get('id')}' is not in a top-level group: in 'layers' every element sits in a layer band.")
            for r in rs:
                a, b = where.get(r.get("from")), where.get(r.get("to"))
                if a is not None and b is not None and abs(a - b) > 1:
                    warns.append(f"Relation {r.get('from')} -> {r.get('to')} skips a layer: its arrow runs down the outer lane; route it through the layer between.")
        else:
            under: Dict[Any, Any] = {}  # every group id -> the ids of the groups it sits in, itself first
            for g in gs:
                chain, cur = [], g.get("id")
                while cur in gmap and cur not in chain:
                    chain.append(cur)
                    cur = gmap[cur].get("parent")
                under[g.get("id")] = chain
            for o in cores:
                oid = o.get("id")
                inside = [e.get("id") for e in es if oid == e.get("id") or oid in under.get(_group(e), ())]
                if not any(degree.get(i) for i in inside):
                    warns.append(f"'{oid}' is marked core but has no relation: connect it or drop 'core'.")
        info.append(f"Layout: {layout}" + ("" if arrange else " (default: " + ("an item is marked core)" if cores else "no item is marked core)")) + ".")

        # Info: the level it opens at.
        systems = [g for g in gs if g.get("kind") == "system"]
        visible = sum(1 for e in es if not hidden(_group(e)))
        if systems and all(g.get("collapsed") for g in systems):
            info.append("Opens at Level 1 (system context): every system group is collapsed.")
        elif systems:
            n = sum(1 for g in systems if not g.get("collapsed"))
            info.append(f"Opens at Level 2 (containers): {n} of {len(systems)} system groups expanded.")
            if visible > MAX_VISIBLE:
                info.append(f"{visible} visible elements is over {MAX_VISIBLE}: set 'collapsed' on system groups so it opens at Level 1.")
        else:
            info.append("Opens at Level 1 (system context): no system groups.")

        score = max(0, 100 - ERROR_PENALTY * len(errors))
        grade = "A+" if score >= 98 else "A" if score >= 90 else "B" if score >= 80 else "C" if score >= 60 else "F"
        return {
            "passed": score >= 90 and not errors, "score": score, "grade": grade, "issues": errors, "data_issues": list(errors),  # all c4 audit errors are data errors; geometry is the engine's job
            "group_count": len(gs), "element_count": len(es), "relation_count": len(rs),
            "info": info, "budget_warnings": warns,
        }

    def summary_lines(self, report: Dict[str, Any]) -> List[str]:
        lines = [
            f"Structure: {report['group_count']} Groups | {report['element_count']} Elements | {report['relation_count']} Relations",
            f"Diagram Quality Score: {report['score']}/100  [GRADE: {report['grade']}]",
            "-" * 70,
        ]
        lines.extend(f"[INFO] {line}" for line in report.get("info", []))
        return lines
