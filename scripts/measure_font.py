#!/usr/bin/env python3
"""Measure the average character width of a theme's font at the sizes the layout engines use, and keep font.metrics
in the theme file true to it (average x a per-metric headroom, see METRICS). The engines (assets/types/*/engine.js) and the sequence audit estimate text width as
characters x font.metrics.<key>, so a wider brand font needs measured metrics or labels overflow.

  python3 scripts/measure_font.py                       measure the default theme and print the table
  python3 scripts/measure_font.py --theme t.json        the default theme with t.json over it
  python3 scripts/measure_font.py --theme t.json --write    update t.json's font.metrics
  python3 scripts/measure_font.py [--theme t.json] --check  exit 1 when a stored metric is off by more than 0.1 px

The font comes from font.href (fetched here, then given to Chrome inline, so Chrome needs no network); a family with
no href is used as the system provides it. If the font cannot be loaded the script says so, measures the fallback and
refuses to --write or --check (exit 2): metrics of the wrong font are worse than none. Standard library plus Chrome.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from render_screenshot import find_browser
from tokens import DEFAULT_PATH, load_tokens

# metric key -> (text style, headroom). The style (tokens type.styles) gives the size, weight and family the average
# width is measured at; the headroom is the margin the engine adds over that average. The key is the one the engines
# read (TOKENS.font.metrics.<key>). An estimate that is too small makes a label overflow its box; one too large only
# wastes a little room, so each key carries its own margin. The margins reproduce the constants the engines used
# before the metrics moved into the tokens (Nunito Sans: 7.4, 6.4, 6.2, 6.6, 7, 6.6) and apply to every font.
METRICS: Dict[str, Tuple[str, float]] = {
    "label": ("label", 1.22),        # sequence message label (SQ.CHAR_W), ER column names (ER.CHAR_W), flowchart longest word
    "title": ("title", 1.1),         # ER table name in the header, bold and a size up (ER.TITLE_CHAR_W)
    "detail": ("detail", 1.15),      # sequence message detail line (SQ.DETAIL_CHAR_W)
    "note": ("detail", 1.11),        # sequence note text (SQ.NOTE_CHAR_W)
    "type": ("code", 1.0),           # ER column type, set in the mono family (ER.TYPE_CHAR_W); mono is exact
    "edgeLabel": ("detail", 1.25),   # one-line label estimate: ER relationship label (ER.LABEL_CHAR_W), flowchart edge label box
    "edgeWrap": ("label", 1.09),     # flowchart edge label: the width that decides when it wraps (LE.LABEL_MAX_W)
}
# The English text every metric is averaged over: typical diagram labels (words, spaces, a few capitals and digits).
SAMPLE = "Submit application Review documents Approve loan Send email Check credit score Validate user input Create order"
TOLERANCE = 0.1

_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.0.0 Safari/537.36"
_JS = """(async (css, specs, sample) => {
  const st = document.createElement('style'); st.textContent = css; document.head.append(st);
  const c = document.createElement('canvas').getContext('2d');
  await Promise.all(specs.map((s) => document.fonts.load(s, sample)));
  await document.fonts.ready;
  const w = (font) => { c.font = font; return c.measureText(sample).width; };
  return specs.map((s) => w(s) / sample.length);
})"""


# --- Chrome over the DevTools websocket (no dependency: a masked text frame out, unmasked frames in) ---------------

class _WS:
    def __init__(self, url: str):
        u = urlparse(url)
        self.sock = socket.create_connection((u.hostname, u.port), timeout=60)
        self.buf = b""
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\nUpgrade: websocket\r\n"
                           f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        while b"\r\n\r\n" not in self.buf:
            self._more()
        head, self.buf = self.buf.split(b"\r\n\r\n", 1)
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise ConnectionError("DevTools refused the websocket")

    def _more(self) -> None:
        chunk = self.sock.recv(65536)
        if not chunk:
            raise ConnectionError("Chrome closed the DevTools connection")
        self.buf += chunk

    def _take(self, n: int) -> bytes:
        while len(self.buf) < n:
            self._more()
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, obj: Dict[str, Any]) -> None:
        data, mask = json.dumps(obj).encode(), os.urandom(4)
        n = len(data)
        head = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n) if n < 65536
                                else bytes([0x80 | 127]) + struct.pack(">Q", n))
        key = (mask * (n // 4 + 1))[:n]
        self.sock.sendall(head + mask + (int.from_bytes(data, "big") ^ int.from_bytes(key, "big")).to_bytes(n, "big"))

    def recv(self) -> Dict[str, Any]:
        msg = b""
        while True:
            b0, b1 = self._take(2)
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._take(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._take(8))[0]
            data, op = self._take(n), b0 & 0x0F
            if op == 8:
                raise ConnectionError("Chrome closed the DevTools connection")
            if op in (0, 1, 2):
                msg += data
                if b0 & 0x80:
                    return json.loads(msg)


def _chrome_eval(expression: str, browser: Optional[str], timeout: int = 60) -> Any:
    """Evaluate an async JS expression in a fresh headless Chrome and return its value."""
    chrome = Path(browser) if browser else find_browser()
    profile = tempfile.mkdtemp(prefix="measure_font_")
    cmd = [str(chrome), "--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0",
           f"--user-data-dir={profile}", "about:blank"]
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        cmd.insert(1, "--no-sandbox")
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        port_file, deadline = Path(profile) / "DevToolsActivePort", time.monotonic() + timeout
        while not port_file.is_file() and time.monotonic() < deadline:
            time.sleep(0.1)
        if not port_file.is_file():
            raise RuntimeError("Chrome did not start")
        port = int(port_file.read_text().split()[0])
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # DevTools is local: never via a proxy
        pages = json.loads(opener.open(f"http://127.0.0.1:{port}/json/list", timeout=30).read())
        ws = _WS(next(p for p in pages if p["type"] == "page")["webSocketDebuggerUrl"])
        ws.send({"id": 1, "method": "Runtime.evaluate",
                 "params": {"expression": expression, "awaitPromise": True, "returnByValue": True}})
        while True:
            msg = ws.recv()
            if msg.get("id") == 1:
                if "error" in msg or "exceptionDetails" in msg.get("result", {}):
                    raise RuntimeError(f"Chrome could not measure: {msg}")
                return msg["result"]["result"]["value"]
    finally:
        proc.kill()
        proc.wait()
        shutil.rmtree(profile, ignore_errors=True)


# --- fonts and styles -----------------------------------------------------------------------------------------------

def _font_css(href: str) -> Tuple[str, bool]:
    """The stylesheet at `href` with every font file inlined as a data URI. (css, fetched)"""
    if not href:
        return "", True
    try:
        req = urllib.request.Request(href, headers={"User-Agent": _UA})
        css = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")
        for url in dict.fromkeys(re.findall(r"url\((https://[^)]+)\)", css)):
            data = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": _UA}), timeout=30).read()
            mime = "font/woff2" if url.endswith(".woff2") else "font/ttf"
            css = css.replace(url, f"data:{mime};base64,{base64.b64encode(data).decode()}")
        return css, True
    except OSError as exc:
        print(f"[WARN] could not fetch the font from {href}: {exc}", file=sys.stderr)
        return "", False


def _style_font(tokens: Dict[str, Any], style: str) -> str:
    """The CSS font shorthand a text style resolves to: `weight size family`."""
    ty, f = tokens["type"], tokens["font"]
    st = ty["styles"][style]
    fam = ty["family"][st["family"]]
    fam = f'"{f["family"]}", {f["stack"]}' if fam == "font.family" else fam
    return f'{ty["weight"][st["weight"]]} {ty["size"][st["size"]]} {fam}'


def measure(tokens: Dict[str, Any], browser: Optional[str] = None, sample: str = SAMPLE) -> Tuple[Dict[str, float], bool]:
    """({metric key: average character width in px}, font_loaded) for the theme's font."""
    css, fetched = _font_css(tokens["font"]["href"])
    keys = list(METRICS)
    fonts = [_style_font(tokens, METRICS[k][0]) for k in keys]
    # The family counts as loaded when it differs from both generic fallbacks (a missing family draws as the fallback).
    fam = f'"{tokens["font"]["family"]}"'
    probes = [f"400 16px {fam}, serif", f"400 16px {fam}, monospace", "400 16px serif", "400 16px monospace"]
    out = _chrome_eval(f"{_JS}({json.dumps(css)}, {json.dumps(fonts + probes)}, {json.dumps(sample)})", browser)
    a, b, serif, mono = out[len(keys):]
    present = abs(a - b) < 1e-6
    return {k: round(w * METRICS[k][1], 1) for k, w in zip(keys, out)}, fetched and present


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--theme", help="theme file over the default tokens (default: the default theme)")
    ap.add_argument("--write", action="store_true", help="write the measured values to the theme's font.metrics")
    ap.add_argument("--check", action="store_true", help="exit 1 when a stored metric differs by more than %.1f px" % TOLERANCE)
    ap.add_argument("--browser", help="Chrome/Chromium path")
    args = ap.parse_args()
    if args.write and not args.theme:
        ap.error("--write needs --theme (the default theme's metrics are edited by hand and checked with --check)")
    tokens = load_tokens(Path(args.theme) if args.theme else None)
    try:
        got, loaded = measure(tokens, args.browser)
    except (RuntimeError, OSError, StopIteration) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 2
    stored = tokens["font"]["metrics"]
    print(f"font {tokens['font']['family']!r}: sample of {len(SAMPLE)} characters")
    for k, (style, headroom) in METRICS.items():
        diff = abs(got[k] - stored.get(k, 0))
        weight, size = _style_font(tokens, style).split(" ", 2)[:2]
        print(f"  {k:<10} {style} {weight} {size} x {headroom} -> {got[k]:>4}   stored {stored.get(k)}"
              + ("" if diff <= TOLERANCE else f"   differs by {diff:.1f}"))
    if (args.write or args.check) and not loaded:
        print(f"[ERROR] the font {tokens['font']['family']!r} did not load, so these are widths of the fallback; "
              f"nothing written or checked. Check font.href and the network.", file=sys.stderr)
        return 2
    if args.write:
        path = Path(args.theme)
        theme = json.loads(path.read_text(encoding="utf-8"))
        theme.setdefault("font", {}).setdefault("metrics", {}).update(got)
        path.write_text(json.dumps(theme, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"[OK] wrote font.metrics to {path}")
    if args.check:
        bad = [k for k in METRICS if abs(got[k] - stored.get(k, 0)) > TOLERANCE]
        if bad:
            print(f"[FAIL] font.metrics out of date: {', '.join(bad)}. Run with --write.")
            return 1
        print("[PASS] font.metrics match the font")
    return 0


if __name__ == "__main__":
    sys.exit(main())
