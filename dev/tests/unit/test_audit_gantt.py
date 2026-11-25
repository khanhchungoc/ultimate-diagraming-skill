#!/usr/bin/env python3
"""Unit tests for Gantt audit rules (scripts/audit_gantt.py) and holiday fetcher (scripts/holidays.py).

All holiday tests use mocked fetchers, temporary cache directories, and injected country detectors
so zero live network calls are ever made.

Usage: python3 dev/tests/unit/test_audit_gantt.py
Exit codes: 0 all passed, 2 a case failed.
"""

from __future__ import annotations

import copy
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
import holidays  # noqa: E402
from audit_gantt import GanttAudit, MAX_LABEL  # noqa: E402

BASE = {
    "diagramType": "gantt",
    "schemaVersion": 1,
    "title": "Q2-Q3 Product Roadmap",
    "zoom": "month",
    "showNotes": False,
    "showToday": True,
    "colorKey": {"1": "Engineering", "2": "Design"},
    "holidays": [
        {"date": "2026-07-04", "end": "2026-07-04", "name": "Independence Day", "country": "US"},
    ],
    "markers": [
        {"id": "m_launch", "label": "Launch Day", "date": "2026-07-15", "color": "4"},
    ],
    "items": [
        {"id": "discovery", "kind": "group", "label": "Discovery", "collapsed": False},
        {
            "id": "res",
            "kind": "task",
            "label": "User research",
            "parent": "discovery",
            "start": "2026-04-01",
            "end": "2026-04-14",
            "color": "2",
        },
        {"id": "plat", "kind": "task", "label": "Core platform", "color": "1"},
        {
            "id": "api",
            "kind": "task",
            "label": "API layer",
            "parent": "plat",
            "start": "2026-04-15",
            "end": "2026-05-06",
        },
        {
            "id": "auth",
            "kind": "task",
            "label": "Auth & SSO",
            "parent": "plat",
            "start": "2026-04-20",
            "end": "2026-05-04",
        },
        {
            "id": "beta",
            "kind": "milestone",
            "label": "Beta ready",
            "parent": "plat",
            "start": "2026-05-10",
            "end": "2026-05-10",
        },
    ],
    "dependencies": [
        {"from": "res", "to": "api", "type": "fs"},
        {"from": "api", "to": "auth", "type": "ss"},
        {"from": "api", "to": "beta", "type": "fs"},
    ],
    "notes": [
        {"id": "n1", "text": "Interview 12 enterprise buyers.", "target": "res"},
    ],
}

FAILED: list[str] = []


def run(mutate=None):
    d = copy.deepcopy(BASE)
    if mutate:
        mutate(d)
    return GanttAudit(d).verify_collisions()


def has(lst, text):
    return any(text in s for s in lst)


def check(name, ok):
    if not ok:
        FAILED.append(name)
        print(f"FAIL {name}")


def err(name, mutate, text):
    r = run(mutate)
    check(name + " (fails)", has(r["issues"], text) and not r["passed"])


def no_err(name, mutate, text):
    r = run(mutate)
    check(name + " (passes)", not has(r["issues"], text))


def warn(name, mutate, text):
    r = run(mutate)
    check(name + " (warns)", has(r["budget_warnings"], text))


def no_warn(name, mutate, text):
    r = run(mutate)
    check(name + " (no warn)", not has(r["budget_warnings"], text))


def test_audit_rules():
    base_report = run()
    check("base passes", base_report["passed"] and not base_report["issues"])
    check("base has no warnings", not base_report["budget_warnings"])
    check("base has no overlap info", not base_report["info"])
    check("base grade is A+", base_report["grade"] == "A+" and base_report["score"] == 100)
    check("data_issues mirrors issues", base_report["data_issues"] == base_report["issues"])

    audit = GanttAudit(copy.deepcopy(BASE))
    check("title is Gantt Roadmap", audit.title == "Gantt Roadmap")
    check("pass_line contract", audit.pass_line(base_report) == "[PASS] Layout clean.")
    summary = audit.summary_lines(base_report)
    check("summary_lines includes counts and score", any("6 Items" in s for s in summary) and any("100/100" in s for s in summary))

    # Empty chart
    err("empty items list", lambda d: d.update(items=[]), "Empty Gantt chart")
    err(
        "groups only without tasks or milestones",
        lambda d: d.update(items=[{"id": "g1", "kind": "group", "label": "Phase 1"}], dependencies=[], notes=[]),
        "Empty Gantt chart",
    )

    # Zoom presets
    err("unknown zoom preset", lambda d: d.update(zoom="decade"), "Unknown zoom 'decade'")
    for preset in ("day", "week", "month", "quarter", "year"):
        no_err(f"valid zoom '{preset}'", lambda d, p=preset: d.update(zoom=p), "Unknown zoom")

    # Dates and end >= start
    err("bad start date format", lambda d: d["items"][1].update(start="2026/04/01"), "invalid start date")
    err("impossible calendar date", lambda d: d["items"][1].update(end="2026-02-30"), "invalid end date")
    err("end before start", lambda d: d["items"][1].update(start="2026-04-20", end="2026-04-10"), "before start date")
    err("leaf task missing start", lambda d: d["items"][1].pop("start"), "missing required 'start' date")
    err("leaf task missing end", lambda d: d["items"][1].pop("end"), "missing required 'end' date")
    err("milestone missing start", lambda d: d["items"][5].pop("start"), "missing required 'start' date")
    err("marker invalid date", lambda d: d["markers"][0].update(date="not-a-date"), "Marker 'm_launch' has invalid date")
    no_err("parent task without own dates passes", None, "missing required")

    # Duplicate IDs across items and markers
    err(
        "duplicate id in items",
        lambda d: d["items"].append({"id": "res", "kind": "task", "label": "Dup", "start": "2026-04-01", "end": "2026-04-02"}),
        "Duplicate id 'res'",
    )
    err(
        "duplicate id across item and marker",
        lambda d: d["markers"].append({"id": "res", "label": "Conflict", "date": "2026-06-01"}),
        "Duplicate id 'res'",
    )
    no_err("unique ids", None, "Duplicate id")

    # Unknown parent / dep / note refs
    err("unknown parent ref", lambda d: d["items"][1].update(parent="ghost"), "unknown parent 'ghost'")
    err("unknown dep from ref", lambda d: d["dependencies"].append({"from": "ghost", "to": "api", "type": "fs"}), "unknown 'from' id 'ghost'")
    err("unknown dep to ref", lambda d: d["dependencies"].append({"from": "api", "to": "ghost", "type": "fs"}), "unknown 'to' id 'ghost'")
    err("unknown note target ref", lambda d: d["notes"].append({"id": "n2", "text": "x", "target": "ghost"}), "targets unknown id 'ghost'")

    # Parent cycles
    err(
        "2-node parent cycle",
        lambda d: (d["items"][0].update(parent="res"), d["items"][1].update(parent="discovery")),
        "parent cycle",
    )
    err("self-parent cycle", lambda d: d["items"][0].update(parent="discovery"), "parent cycle")
    no_err("acyclic parent hierarchy", None, "parent cycle")

    # Dependencies: type, self-loop, cycle
    err("invalid dep type ff", lambda d: d["dependencies"].append({"from": "res", "to": "auth", "type": "ff"}), "invalid type 'ff'")
    err("dep self-loop", lambda d: d["dependencies"].append({"from": "api", "to": "api", "type": "fs"}), "self-loop")
    err(
        "2-node dep cycle",
        lambda d: d["dependencies"].append({"from": "api", "to": "res", "type": "fs"}),
        "Dependency cycle detected",
    )
    err(
        "3-node dep cycle",
        lambda d: d["dependencies"].append({"from": "beta", "to": "res", "type": "fs"}),
        "Dependency cycle detected",
    )
    no_err("acyclic dependencies", None, "Dependency cycle")

    # Label length warning
    warn("long item label warns", lambda d: d["items"][1].update(label="x" * (MAX_LABEL + 1)), f"over {MAX_LABEL} characters")
    no_warn("item label at exact limit ok", lambda d: d["items"][1].update(label="x" * MAX_LABEL), f"over {MAX_LABEL} characters")
    warn("long marker label warns", lambda d: d["markers"][0].update(label="m" * (MAX_LABEL + 1)), f"over {MAX_LABEL} characters")

    # FS / SS overlap is [INFO], NOT error and NOT warning
    def fs_overlap(d):
        # res ends 2026-04-14, make api start 2026-04-10 (before res ends)
        d["items"][3]["start"] = "2026-04-10"

    r_fs = run(fs_overlap)
    check("FS overlap still passes", r_fs["passed"] and not r_fs["issues"] and not r_fs["budget_warnings"])
    check("FS overlap reported as info", has(r_fs["info"], "Dependency overlap (FS): 'api'"))

    def ss_overlap(d):
        # api starts 2026-04-15, make auth start 2026-04-12 (before api starts)
        d["items"][4]["start"] = "2026-04-12"

    r_ss = run(ss_overlap)
    check("SS overlap still passes", r_ss["passed"] and not r_ss["issues"] and not r_ss["budget_warnings"])
    check("SS overlap reported as info", has(r_ss["info"], "Dependency overlap (SS): 'auth'"))

    # Rolled-up parent dates participate in overlap check
    def parent_fs_overlap(d):
        # plat rolls up to 2026-04-15..2026-05-10; depend plat -> res (res starts 2026-04-01)
        d["dependencies"] = [{"from": "plat", "to": "res", "type": "fs"}]

    r_parent = run(parent_fs_overlap)
    check("rolled-up parent FS overlap reported as info", r_parent["passed"] and has(r_parent["info"], "Dependency overlap (FS): 'res'"))

    # data_issues mirrors non-empty errors
    r_err = run(lambda d: d.update(zoom="bogus"))
    check("data_issues mirrors non-empty errors", r_err["data_issues"] == r_err["issues"] and len(r_err["issues"]) == 1)


def test_holidays_module():
    # 1. Timezone mapping
    for tz_name, expected in [
        ("Asia/Ho_Chi_Minh", "VN"),
        ("Asia/Saigon", "VN"),
        ("America/New_York", "US"),
        ("America/Los_Angeles", "US"),
        ("Europe/London", "GB"),
        ("Asia/Singapore", "SG"),
        ("Asia/Tokyo", "JP"),
        ("Australia/Sydney", "AU"),
        ("America/Toronto", "CA"),
        ("Europe/Berlin", "DE"),
        ("Europe/Paris", "FR"),
        ("Asia/Kolkata", "IN"),
        ("Asia/Seoul", "KR"),
        ("Asia/Shanghai", "CN"),
        ("Asia/Taipei", "TW"),
        ("Asia/Hong_Kong", "HK"),
        ("Asia/Bangkok", "TH"),
        ("Asia/Jakarta", "ID"),
        ("Asia/Kuala_Lumpur", "MY"),
        ("Asia/Manila", "PH"),
        ("Europe/Amsterdam", "NL"),
        ("Europe/Stockholm", "SE"),
        ("Europe/Zurich", "CH"),
        ("Europe/Madrid", "ES"),
        ("Europe/Rome", "IT"),
        ("America/Sao_Paulo", "BR"),
        ("America/Mexico_City", "MX"),
        ("Pacific/Auckland", "NZ"),
        ("Europe/Dublin", "IE"),
        ("Europe/Warsaw", "PL"),
        ("Etc/UTC", None),
        ("UTC", None),
        ("Mars/Olympus_Mons", None),
        ("", None),
        (None, None),
    ]:
        check(f"iana_to_country({tz_name!r}) == {expected!r}", holidays.iana_to_country(tz_name) == expected)

    # detect_local_country with TZ env var
    old_tz = os.environ.get("TZ")
    try:
        os.environ["TZ"] = "Asia/Ho_Chi_Minh"
        check("detect_local_country reads TZ env", holidays.detect_local_country() == "VN")
        os.environ["TZ"] = ":America/New_York"
        check("detect_local_country strips leading colon", holidays.detect_local_country() == "US")
    finally:
        if old_tz is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = old_tz

    # 2. Cache miss -> fetch -> cache hit -> expired cache
    with tempfile.TemporaryDirectory() as tmp:
        cache_dir = Path(tmp)
        calls: list[str] = []

        def mock_fetcher(url: str, timeout: float):
            calls.append(url)
            if url.endswith("/2026/VN"):
                return json.dumps([
                    {"date": "2026-01-01", "name": "New Year's Day", "localName": "Tet Duong Lich"},
                    {"date": "2026-04-30", "name": "Reunification Day"},
                ]).encode("utf-8")
            if url.endswith("/2026/US"):
                return json.dumps([
                    {"date": "2026-01-01", "name": "New Year's Day"},
                    {"date": "2026-07-04", "name": "Independence Day"},
                ]).encode("utf-8")
            raise RuntimeError("unexpected url")

        entries1, err1 = holidays.fetch_country_holidays("VN", 2026, cache_dir=cache_dir, fetcher=mock_fetcher)
        check("cache miss fetches entries", err1 is None and len(entries1) == 2 and len(calls) == 1)
        check("normalized shape", entries1[0] == {"date": "2026-01-01", "end": "2026-01-01", "name": "New Year's Day", "country": "VN"})
        cache_file = cache_dir / "VN-2026.json"
        check("cache file written", cache_file.is_file())

        entries2, err2 = holidays.fetch_country_holidays("VN", 2026, cache_dir=cache_dir, fetcher=mock_fetcher)
        check("cache hit skips fetcher", err2 is None and entries2 == entries1 and len(calls) == 1)

        # Expire cache file mtime beyond 30 days
        old_time = time.time() - (holidays.CACHE_TTL_SECONDS + 100)
        os.utime(cache_file, (old_time, old_time))
        entries3, err3 = holidays.fetch_country_holidays("VN", 2026, cache_dir=cache_dir, fetcher=mock_fetcher)
        check("expired cache triggers refetch", err3 is None and len(entries3) == 2 and len(calls) == 2)

        # 3. Offline error fallback
        def offline_fetcher(url: str, timeout: float):
            raise TimeoutError("timed out")

        off_entries, off_err = holidays.fetch_country_holidays("JP", 2026, cache_dir=cache_dir, fetcher=offline_fetcher)
        check("offline returns empty + message without raising", off_entries == [] and off_err == "offline or unavailable")

        # 4. resolve_holidays: multi-country dedupe + preserve existing manual entry
        data_multi = {
            "_holidayMode": "VN, US",
            "holidays": [{"date": "2026-05-01", "end": "2026-05-01", "name": "Company Offsite"}],
            "items": [{"id": "t1", "kind": "task", "label": "Build", "start": "2026-01-01", "end": "2026-12-01"}],
            "markers": [],
        }
        infos_multi = holidays.resolve_holidays(data_multi, cache_dir=cache_dir, fetcher=mock_fetcher)
        names_multi = [h["name"] for h in data_multi["holidays"]]
        check("multi-country merges and deduplicates New Year's Day", names_multi.count("New Year's Day") == 1)
        check("multi-country preserves manual holiday", "Company Offsite" in names_multi)
        check("multi-country includes both countries' unique holidays", "Reunification Day" in names_multi and "Independence Day" in names_multi)
        check("multi-country sorted by date", [h["date"] for h in data_multi["holidays"]] == sorted(h["date"] for h in data_multi["holidays"]))
        check("multi-country returns INFO lines", len(infos_multi) == 2 and all(s.startswith("[INFO]") for s in infos_multi))

        # 5. resolve_holidays: no_holidays=True skips completely
        calls_before = len(calls)
        data_skip = {
            "_holidayMode": "VN",
            "items": [{"id": "t1", "kind": "task", "label": "Build", "start": "2026-04-01", "end": "2026-04-10"}],
        }
        infos_skip = holidays.resolve_holidays(data_skip, no_holidays=True, cache_dir=cache_dir, fetcher=mock_fetcher)
        check("no_holidays=True skips fetch", infos_skip == [] and len(calls) == calls_before and "holidays" not in data_skip)

        # 6. resolve_holidays: _holidayMode == "none" skips completely
        data_none = {
            "_holidayMode": "none",
            "items": [{"id": "t1", "kind": "task", "label": "Build", "start": "2026-04-01", "end": "2026-04-10"}],
        }
        infos_none = holidays.resolve_holidays(data_none, cache_dir=cache_dir, fetcher=mock_fetcher)
        check("_holidayMode none skips fetch", infos_none == [] and "holidays" not in data_none)

        # 7. resolve_holidays: auto mode with injected country_detector
        data_auto = {
            "items": [{"id": "t1", "kind": "task", "label": "Build", "start": "2026-04-01", "end": "2026-04-10"}],
        }
        infos_auto = holidays.resolve_holidays(
            data_auto,
            cache_dir=cache_dir,
            fetcher=mock_fetcher,
            country_detector=lambda: "VN",
        )
        check("auto mode uses country_detector", len(data_auto.get("holidays", [])) == 2 and any("VN" in s for s in infos_auto))

        # 8. resolve_holidays: auto mode with unmapped timezone
        data_unknown_tz = {
            "items": [{"id": "t1", "kind": "task", "label": "Build", "start": "2026-04-01", "end": "2026-04-10"}],
        }
        infos_unknown = holidays.resolve_holidays(
            data_unknown_tz,
            cache_dir=cache_dir,
            fetcher=mock_fetcher,
            country_detector=lambda: None,
        )
        check("unmapped timezone skips with INFO", len(infos_unknown) == 1 and "skipped" in infos_unknown[0])

        # 9. resolve_holidays: offline fallback returns INFO and sets empty holidays
        data_offline = {
            "_holidayMode": "DE",
            "items": [{"id": "t1", "kind": "task", "label": "Build", "start": "2026-04-01", "end": "2026-04-10"}],
        }
        infos_offline = holidays.resolve_holidays(data_offline, cache_dir=cache_dir, fetcher=offline_fetcher)
        check("resolve_holidays offline fallback", any("offline or unavailable" in s for s in infos_offline) and data_offline.get("holidays") == [])

        # 10. Year span capped at <= 5 years
        fetched_years: list[str] = []

        def year_recorder(url: str, timeout: float):
            fetched_years.append(url)
            return b"[]"

        data_long = {
            "_holidayMode": "SG",
            "items": [{"id": "t1", "kind": "task", "label": "Decade", "start": "2025-01-01", "end": "2035-12-31"}],
        }
        holidays.resolve_holidays(data_long, cache_dir=cache_dir, fetcher=year_recorder)
        check("year span capped at 5 years", len(fetched_years) == holidays.MAX_YEAR_SPAN)


def main() -> int:
    FAILED.clear()
    test_audit_rules()
    test_holidays_module()
    if FAILED:
        print(f"{len(FAILED)} case(s) failed")
        return 2
    print("test_audit_gantt: all cases passed")
    return 0


class TestAuditGantt(unittest.TestCase):
    def test_audit_gantt(self):
        self.assertEqual(main(), 0)


if __name__ == "__main__":
    sys.exit(main())
