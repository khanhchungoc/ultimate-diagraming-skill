"""Audit for Gantt / roadmap timeline diagrams (diagramType "gantt"): model rules on the logical JSON.

Works on the logical data only (see dev/plans/plan-gantt.md), so it needs no browser and no layout.
"""

from __future__ import annotations

import datetime
import re
from typing import Any, Dict, List, Optional, Set, Tuple

ZOOM_PRESETS = ("day", "week", "2week", "month", "quarter", "year")
ITEM_KINDS = ("group", "task", "milestone")
DEP_TYPES = ("fs", "ss")
MAX_LABEL = 60  # characters; longer labels truncate on bars and in the sidebar
ERROR_PENALTY = 12

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _s(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ""


def _parse_date(val: Any) -> Optional[datetime.date]:
    if not isinstance(val, str) or not _DATE_RE.match(val):
        return None
    try:
        return datetime.date.fromisoformat(val)
    except ValueError:
        return None


class GanttAudit:
    title = "Gantt Roadmap"

    def __init__(self, data: Dict[str, Any]):
        self.data = data
        self.items: List[Dict[str, Any]] = data.get("items") or []
        self.dependencies: List[Dict[str, Any]] = data.get("dependencies") or []
        self.markers: List[Dict[str, Any]] = data.get("markers") or []
        self.notes: List[Dict[str, Any]] = data.get("notes") or []
        self.holidays: List[Dict[str, Any]] = data.get("holidays") or []

    def pass_line(self, report: Dict[str, Any]) -> str:
        return "[PASS] Layout clean."

    def verify_collisions(self) -> Dict[str, Any]:
        errors: List[str] = []
        warns: List[str] = []
        info: List[str] = []

        items = self.items
        deps = self.dependencies
        markers = self.markers
        notes = self.notes

        # Zoom preset validation.
        zoom = self.data.get("zoom")
        if zoom is not None and zoom not in ZOOM_PRESETS:
            errors.append(f"Unknown zoom '{zoom}': use day, week, month, quarter, or year.")

        # Non-empty items (must have at least one task or milestone).
        actionable = [it for it in items if (it.get("kind") or "task") in ("task", "milestone")]
        if not items or not actionable:
            errors.append("Empty Gantt chart: add at least one task or milestone.")

        # Unique IDs across items and markers.
        seen_ids: Set[Any] = set()
        item_map: Dict[Any, Dict[str, Any]] = {}
        for idx, it in enumerate(items):
            iid = it.get("id")
            if not _s(iid):
                errors.append(f"Item at index {idx} has missing or blank 'id'.")
                continue
            if iid in seen_ids:
                errors.append(f"Duplicate id '{iid}': ids must be unique across items and markers.")
            else:
                seen_ids.add(iid)
                item_map[iid] = it

        for idx, mk in enumerate(markers):
            mid = mk.get("id")
            if not _s(mid):
                errors.append(f"Marker at index {idx} has missing or blank 'id'.")
                continue
            if mid in seen_ids:
                errors.append(f"Duplicate id '{mid}': ids must be unique across items and markers.")
            else:
                seen_ids.add(mid)

        # Build children map for parent-rollup checks.
        children_map: Dict[Any, List[Any]] = {}
        for it in items:
            iid = it.get("id")
            parent = it.get("parent")
            if parent is not None:
                if parent not in item_map:
                    errors.append(f"Item '{iid}' has unknown parent '{parent}'.")
                elif iid in item_map:
                    children_map.setdefault(parent, []).append(iid)

        # Detect parent cycles.
        parent_cyclic: Set[Any] = set()
        for it in items:
            iid = it.get("id")
            if iid not in item_map:
                continue
            chain: List[Any] = []
            cur = iid
            while cur in item_map and cur not in chain:
                chain.append(cur)
                cur = item_map[cur].get("parent")
            if cur in chain:
                parent_cyclic.update(chain[chain.index(cur):])
        for iid in sorted(parent_cyclic, key=str):
            errors.append(f"Item '{iid}' is in a parent cycle: an item cannot be its own ancestor.")

        # Validate item fields: kind, dates, end >= start, label length.
        own_dates: Dict[Any, Tuple[datetime.date, datetime.date]] = {}
        for it in items:
            iid = it.get("id")
            kind = it.get("kind", "task")
            if kind not in ITEM_KINDS:
                errors.append(f"Item '{iid}' has invalid kind '{kind}': use group, task, or milestone.")

            has_children = bool(children_map.get(iid))
            raw_start = it.get("start")
            raw_end = it.get("end")
            start_dt = _parse_date(raw_start) if raw_start is not None else None
            end_dt = _parse_date(raw_end) if raw_end is not None else None

            if raw_start is not None and start_dt is None:
                errors.append(f"Item '{iid}' has invalid start date '{raw_start}': use YYYY-MM-DD.")
            if raw_end is not None and end_dt is None:
                errors.append(f"Item '{iid}' has invalid end date '{raw_end}': use YYYY-MM-DD.")

            if kind == "milestone":
                if raw_start is None:
                    errors.append(f"Milestone '{iid}' is missing required 'start' date (YYYY-MM-DD).")
                elif start_dt is not None:
                    eff_end = end_dt if end_dt is not None else start_dt
                    if eff_end < start_dt:
                        errors.append(f"Milestone '{iid}' has end date '{raw_end}' before start date '{raw_start}'.")
                    else:
                        own_dates[iid] = (start_dt, eff_end)
            elif kind == "task":
                if not has_children:
                    if raw_start is None:
                        errors.append(f"Task '{iid}' is missing required 'start' date (YYYY-MM-DD).")
                    if raw_end is None:
                        errors.append(f"Task '{iid}' is missing required 'end' date (YYYY-MM-DD).")
                if start_dt is not None and end_dt is not None:
                    if end_dt < start_dt:
                        errors.append(f"Task '{iid}' has end date '{raw_end}' before start date '{raw_start}'.")
                    else:
                        own_dates[iid] = (start_dt, end_dt)
            elif kind == "group":
                if start_dt is not None and end_dt is not None:
                    if end_dt < start_dt:
                        errors.append(f"Group '{iid}' has end date '{raw_end}' before start date '{raw_start}'.")
                    else:
                        own_dates[iid] = (start_dt, end_dt)

            label = _s(it.get("label"))
            if len(label) > MAX_LABEL:
                warns.append(f"Item '{iid}' label is over {MAX_LABEL} characters ({len(label)}): shorten it for readability.")

        # Validate markers.
        for mk in markers:
            mid = mk.get("id")
            raw_date = mk.get("date")
            if _parse_date(raw_date) is None:
                errors.append(f"Marker '{mid}' has invalid date '{raw_date}': use YYYY-MM-DD.")
            mlabel = _s(mk.get("label"))
            if len(mlabel) > MAX_LABEL:
                warns.append(f"Marker '{mid}' label is over {MAX_LABEL} characters ({len(mlabel)}): shorten it for readability.")

        # Validate holidays if present.
        for idx, h in enumerate(self.holidays):
            h_start = _parse_date(h.get("date"))
            if h_start is None:
                errors.append(f"Holiday at index {idx} has invalid date '{h.get('date')}': use YYYY-MM-DD.")
                continue
            raw_hend = h.get("end")
            if raw_hend is not None:
                h_end = _parse_date(raw_hend)
                if h_end is None:
                    errors.append(f"Holiday at index {idx} has invalid end date '{raw_hend}': use YYYY-MM-DD.")
                elif h_end < h_start:
                    errors.append(f"Holiday at index {idx} has end date '{raw_hend}' before start date '{h.get('date')}'.")

        # Compute effective (rolled-up) dates for overlap checking.
        eff_dates: Dict[Any, Tuple[datetime.date, datetime.date]] = {}
        visiting_rollup: Set[Any] = set()

        def resolve_dates(iid: Any) -> Optional[Tuple[datetime.date, datetime.date]]:
            if iid in eff_dates:
                return eff_dates[iid]
            if iid in visiting_rollup or iid in parent_cyclic:
                return own_dates.get(iid)
            visiting_rollup.add(iid)
            kids = children_map.get(iid) or []
            child_spans = [sp for k in kids if (sp := resolve_dates(k)) is not None]
            visiting_rollup.discard(iid)
            if child_spans:
                span = (min(s for s, _ in child_spans), max(e for _, e in child_spans))
                eff_dates[iid] = span
                return span
            if iid in own_dates:
                eff_dates[iid] = own_dates[iid]
                return own_dates[iid]
            return None

        for iid in item_map:
            resolve_dates(iid)

        # Validate dependencies: refs, type, self-loops, cycles, and overlap info.
        adj: Dict[Any, List[Any]] = {}
        valid_deps: List[Tuple[Any, Any, str]] = []
        for dep in deps:
            a = dep.get("from")
            b = dep.get("to")
            dtype = dep.get("type", "fs")
            a_ok = a in item_map
            b_ok = b in item_map
            if not a_ok:
                errors.append(f"Dependency {a} -> {b} references unknown 'from' id '{a}'.")
            if not b_ok:
                errors.append(f"Dependency {a} -> {b} references unknown 'to' id '{b}'.")
            if dtype not in DEP_TYPES:
                errors.append(f"Dependency {a} -> {b} has invalid type '{dtype}': use 'fs' or 'ss'.")
            if a_ok and b_ok:
                if a == b:
                    errors.append(f"Dependency {a} -> {b} is a self-loop: an item cannot depend on itself.")
                else:
                    adj.setdefault(a, []).append(b)
                    if dtype in DEP_TYPES:
                        valid_deps.append((a, b, dtype))

        # Dependency cycle detection (3-color DFS).
        color: Dict[Any, int] = {}  # 0=unvisited, 1=visiting, 2=done
        stack: List[Any] = []
        reported_cycles: Set[Tuple[Any, ...]] = set()

        def dfs(node: Any) -> None:
            color[node] = 1
            stack.append(node)
            for nxt in adj.get(node, ()):
                state = color.get(nxt, 0)
                if state == 1:
                    cyc = stack[stack.index(nxt):]
                    # Canonicalize cycle rotation for deduplication.
                    min_i = min(range(len(cyc)), key=lambda i: str(cyc[i]))
                    canon = tuple(cyc[min_i:] + cyc[:min_i])
                    if canon not in reported_cycles:
                        reported_cycles.add(canon)
                        chain_str = " -> ".join(str(x) for x in list(canon) + [canon[0]])
                        errors.append(f"Dependency cycle detected: {chain_str}.")
                elif state == 0:
                    dfs(nxt)
            stack.pop()
            color[node] = 2

        for iid in item_map:
            if color.get(iid, 0) == 0 and iid in adj:
                dfs(iid)

        # FS / SS overlap violations are informational only (not errors or warnings).
        for a, b, dtype in valid_deps:
            span_a = eff_dates.get(a)
            span_b = eff_dates.get(b)
            if span_a is None or span_b is None:
                continue
            a_start, a_end = span_a
            b_start, _ = span_b
            if dtype == "fs" and b_start < a_end:
                info.append(
                    f"Dependency overlap (FS): '{b}' starts ({b_start.isoformat()}) before '{a}' ends ({a_end.isoformat()})."
                )
            elif dtype == "ss" and b_start < a_start:
                info.append(
                    f"Dependency overlap (SS): '{b}' starts ({b_start.isoformat()}) before '{a}' starts ({a_start.isoformat()})."
                )

        # Validate notes.
        for idx, note in enumerate(notes):
            nid = note.get("id", f"#{idx}")
            target = note.get("target")
            if target is None or target not in item_map:
                errors.append(f"Note '{nid}' targets unknown id '{target}'.")

        score = max(0, 100 - ERROR_PENALTY * len(errors))
        grade = "A+" if score >= 98 else "A" if score >= 90 else "B" if score >= 80 else "C" if score >= 60 else "F"
        return {
            "passed": score >= 90 and not errors,
            "score": score,
            "grade": grade,
            "issues": errors,
            "data_issues": list(errors),
            "item_count": len(items),
            "dependency_count": len(deps),
            "marker_count": len(markers),
            "info": info,
            "budget_warnings": warns,
        }

    def summary_lines(self, report: Dict[str, Any]) -> List[str]:
        lines = [
            f"Structure: {report['item_count']} Items | {report['dependency_count']} Dependencies | {report['marker_count']} Markers",
            f"Diagram Quality Score: {report['score']}/100  [GRADE: {report['grade']}]",
            "-" * 70,
        ]
        lines.extend(f"[INFO] {line}" for line in report.get("info", []))
        return lines
