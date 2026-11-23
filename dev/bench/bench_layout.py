#!/usr/bin/env python3
"""Benchmark layout_engine.py stages and end-to-end --layout --screenshot CLI runs.

Uses Python standard library only. Measures wall-clock time across:
- order_flowchart_lanes
- choose_flowchart_direction (or single run_layout when "direction" is set)
- verify_collisions (initial audit)
- connector-pair loop rounds (add_connector_pairs, run_layout, verify_collisions)
- scaffold_html
- run_render

Usage:
  python dev/bench_layout.py
  python dev/bench_layout.py --cli
  python dev/bench_layout.py --input path/to/diagram.json --cli
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from engine_runner import run_layout  # noqa: E402
from layout_engine import (  # noqa: E402
    LONG_ARROW_MAX_PAIRS,
    LONG_ARROW_MAX_ROUNDS,
    add_connector_pairs,
    authoring_json,
    choose_flowchart_direction,
    make_audit,
    normalize_diagram_type,
    order_flowchart_lanes,
    read_data_block,
    resolve_theme,
    run_render,
    scaffold_html,
)

DEFAULT_TARGETS = (
    ROOT / "dev" / "samples" / "example-corporate-laptop-purchase-request.html",
    ROOT / "dev" / "samples" / "motor-insurance-claim-processing.html",
    ROOT / "dev" / "tests" / "fixtures" / "flowchart" / "five-lanes-wide.json",
    ROOT / "dev" / "tests" / "fixtures" / "flowchart" / "nested-loops.json",
)


def load_authoring_data(path: Path, drop_direction: bool = False) -> Tuple[Dict[str, Any], Optional[str]]:
    """Load authoring JSON from an HTML file or JSON file."""
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".html":
        data = authoring_json("flowchart", read_data_block(text))
        page_text: Optional[str] = text
    else:
        data = json.loads(text)
        page_text = None
    data = normalize_diagram_type(data)
    if drop_direction:
        data = dict(data)
        data.pop("direction", None)
    return data, page_text


def run_staged(
    data: Dict[str, Any],
    page_text: Optional[str],
    timeout: int = 30,
    with_render: bool = True,
) -> Dict[str, Any]:
    """Run and time each stage of the flowchart --layout pipeline in-process."""
    tokens, theme, _ = resolve_theme(None, page_text)
    tokens = tokens if theme is not None else None

    total_t0 = time.perf_counter()
    sink = io.StringIO()

    with contextlib.redirect_stdout(sink):
        t0 = time.perf_counter()
        if data["diagramType"] == "flowchart":
            data, _ = order_flowchart_lanes(data, timeout, None, tokens)
        t_lanes = time.perf_counter() - t0

        t0 = time.perf_counter()
        has_dir = "direction" in data
        if data["diagramType"] == "flowchart" and not has_dir:
            laid_out_data, _ = choose_flowchart_direction(data, timeout, None, tokens)
            dir_stage = "choose_flowchart_direction"
        else:
            laid_out_data = run_layout(data["diagramType"], data, timeout=timeout, browser=None, tokens=tokens)
            dir_stage = "run_layout (fixed)"
        t_dir = time.perf_counter() - t0

        t0 = time.perf_counter()
        audit = make_audit(laid_out_data, tokens)
        report = audit.verify_collisions()
        t_verify = time.perf_counter() - t0

        rounds: List[Dict[str, Any]] = []
        t_conn_start = time.perf_counter()
        if data["diagramType"] == "flowchart" and report["long_arrows"]:
            quality = lambda r: (not r["passed"], len(r["issues"]), r["long_arrows_count"], r["edge_crossings"])
            base, letters = data, 0
            for idx in range(1, LONG_ARROW_MAX_ROUNDS + 1):
                if not report["long_arrows"] or letters >= LONG_ARROW_MAX_PAIRS:
                    break
                r_t0 = time.perf_counter()
                split, info = add_connector_pairs(
                    base, laid_out_data, report["long_arrows"], LONG_ARROW_MAX_PAIRS - letters
                )
                t_add = time.perf_counter() - r_t0

                l_t0 = time.perf_counter()
                laid2 = run_layout("flowchart", split, timeout=timeout, browser=None, tokens=tokens)
                t_r_layout = time.perf_counter() - l_t0

                v_t0 = time.perf_counter()
                audit2 = make_audit(laid2, tokens)
                report2 = audit2.verify_collisions()
                t_r_verify = time.perf_counter() - v_t0

                accepted = quality(report2) < quality(report)
                rounds.append({
                    "round": idx,
                    "add_s": t_add,
                    "layout_s": t_r_layout,
                    "verify_s": t_r_verify,
                    "total_s": time.perf_counter() - r_t0,
                    "accepted": accepted,
                    "added": len(info),
                    "score": report2["score"],
                    "long_arrows": report2["long_arrows_count"],
                })
                if not accepted:
                    break
                base, letters = split, letters + len(info)
                laid_out_data, audit, report = laid2, audit2, report2
        t_conn = time.perf_counter() - t_conn_start

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            out_html = tmp / "out.html"
            out_png = tmp / "out.png"

            t0 = time.perf_counter()
            scaffold_html(laid_out_data, out_html, "file", tokens, theme)
            t_scaffold = time.perf_counter() - t0

            if with_render:
                t0 = time.perf_counter()
                render_code, render_clean = run_render(out_html, out_png, None)
                t_render: Optional[float] = time.perf_counter() - t0
            else:
                render_code, render_clean, t_render = 0, True, None

    t_total = time.perf_counter() - total_t0
    return {
        "nodes": len(laid_out_data.get("nodes") or []),
        "edges": len(laid_out_data.get("edges") or []),
        "direction": laid_out_data.get("direction", "LR"),
        "score": report["score"],
        "passed": report["passed"],
        "order_flowchart_lanes_s": t_lanes,
        "direction_stage": dir_stage,
        "direction_s": t_dir,
        "verify_collisions_s": t_verify,
        "connector_loop_s": t_conn,
        "connector_rounds": rounds,
        "scaffold_html_s": t_scaffold,
        "run_render_s": t_render,
        "render_code": render_code,
        "render_clean": render_clean,
        "total_s": t_total,
    }


def run_cli_bench(
    data: Dict[str, Any],
    save_html: Optional[Path] = None,
    save_stdout: Optional[Path] = None,
) -> Dict[str, Any]:
    """Run and time full subprocess layout_engine.py --layout <tmp_json> -o <tmp_html> --screenshot <tmp_png>."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        tmp_json = tmp / "input.json"
        tmp_html = tmp / "output.html"
        tmp_png = tmp / "output.png"
        tmp_json.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

        cmd = [
            sys.executable,
            str(SCRIPTS / "layout_engine.py"),
            "--layout", str(tmp_json),
            "-o", str(tmp_html),
            "--screenshot", str(tmp_png),
        ]
        t0 = time.perf_counter()
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        elapsed = time.perf_counter() - t0

        out_text = proc.stdout + proc.stderr
        if save_stdout is not None:
            save_stdout.parent.mkdir(parents=True, exist_ok=True)
            save_stdout.write_text(out_text, encoding="utf-8", newline="\n")
        if save_html is not None and tmp_html.is_file():
            save_html.parent.mkdir(parents=True, exist_ok=True)
            save_html.write_text(tmp_html.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")

        return {
            "returncode": proc.returncode,
            "elapsed_s": elapsed,
            "html_bytes": tmp_html.stat().st_size if tmp_html.is_file() else 0,
            "png_bytes": tmp_png.stat().st_size if tmp_png.is_file() else 0,
            "stdout": out_text,
        }


def print_staged_report(label: str, res: Dict[str, Any]) -> None:
    """Print formatted per-stage timing breakdown."""
    print(f"\n=== {label} ===")
    print(f"  result: {res['nodes']} nodes, {res['edges']} edges, dir={res['direction']}, "
          f"score={res['score']}/100 ({'PASS' if res['passed'] else 'FAIL'})")
    print(f"  order_flowchart_lanes:    {res['order_flowchart_lanes_s']:7.3f} s")
    print(f"  {res['direction_stage'] + ':':<26}{res['direction_s']:7.3f} s")
    print(f"  verify_collisions:        {res['verify_collisions_s']:7.3f} s")
    print(f"  connector_loop ({len(res['connector_rounds'])} rounds): {res['connector_loop_s']:7.3f} s")
    for r in res["connector_rounds"]:
        status = f"+{r['added']} pair(s)" if r["accepted"] else "stopped"
        print(f"    round {r['round']} ({status}, score={r['score']}, long={r['long_arrows']}): "
              f"total={r['total_s']:.3f}s (add={r['add_s']:.3f}s, layout={r['layout_s']:.3f}s, verify={r['verify_s']:.3f}s)")
    print(f"  scaffold_html:            {res['scaffold_html_s']:7.3f} s")
    if res["run_render_s"] is not None:
        print(f"  run_render (rc={res['render_code']}, clean={res['render_clean']}): {res['run_render_s']:7.3f} s")
    else:
        print("  run_render:               skipped")
    print(f"  TOTAL (staged):           {res['total_s']:7.3f} s")


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark layout_engine.py stages and end-to-end CLI runs.")
    parser.add_argument("--input", action="append", help="JSON or HTML file to benchmark (repeatable; defaults to repo suite)")
    parser.add_argument("--cli", action="store_true", help="Also time full subprocess layout_engine.py --layout ... --screenshot ...")
    parser.add_argument("--no-render", action="store_true", help="Skip run_render in staged benchmark")
    parser.add_argument("--drop-direction", action="store_true", help="Strip authored direction to exercise choose_flowchart_direction")
    parser.add_argument("--save-html", help="When --cli is used with one input, save CLI output HTML to this path")
    parser.add_argument("--save-stdout", help="When --cli is used with one input, save CLI stdout/stderr to this path")
    args = parser.parse_args()

    targets = [Path(p) for p in args.input] if args.input else list(DEFAULT_TARGETS)
    if (args.save_html or args.save_stdout) and (not args.cli or len(targets) != 1):
        parser.error("--save-html and --save-stdout require --cli with a single --input")

    exit_code = 0
    for target in targets:
        data, page_text = load_authoring_data(target, drop_direction=args.drop_direction)
        staged = run_staged(data, page_text, with_render=not args.no_render)
        print_staged_report(str(target), staged)
        if staged["render_code"] != 0:
            exit_code = 1

        if args.cli:
            cli_res = run_cli_bench(
                data,
                save_html=Path(args.save_html) if args.save_html else None,
                save_stdout=Path(args.save_stdout) if args.save_stdout else None,
            )
            print(f"  CLI subprocess (--layout --screenshot): {cli_res['elapsed_s']:7.3f} s "
                  f"(rc={cli_res['returncode']}, html={cli_res['html_bytes']}B, png={cli_res['png_bytes']}B)")
            if cli_res["returncode"] != 0:
                exit_code = 1
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
