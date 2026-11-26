#!/usr/bin/env python3
"""Make a theme file (tokens in the shape of assets/tokens/default.json) from a website or a brand guide.

  python3 extract_tokens.py --url https://example.com --complete [--out theme.json] [--preview DIR]
  python3 extract_tokens.py --from partial.json --complete       the brand-guide path: partial.json is filled in by the
                                                                 agent from the guide (references/theme.md)
  python3 extract_tokens.py --self-test

--url loads the page in headless Chrome and reads its computed styles (the only place page code runs). Both inputs give a
partial theme; --complete fills it up: missing keys come from the default, hover/ring/glow/wash shades and the dark set are
derived (OKLCH), palette slots 1-8 are built from the brand colours, text sizes are clamped, the font is measured
(scripts/measure_font.py), every contrast pair is checked in both modes and failing values are moved along OKLCH
lightness only. The output (default <skill-dir>/theme.json) lists only the keys that differ from the default; the
loader fills the rest. The report says where each value came from. Standard library plus Chrome.

A website is untrusted data: nothing it contains is copied into the theme except colours (rebuilt as hex), numbers,
font family names matching [\\w .-], and a fonts.googleapis.com href. Every value then passes tokens.py validation.
"""

from __future__ import annotations

import argparse
import base64
import copy
import json
import math
import re
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse
from urllib.request import url2pathname

from contrast import check, expand, over, parse_color, ratio
from tokens import _HREF, _TONES, TOKENS_VERSION, _is_shadow, merge_theme, resolve_colors

MODES = ("light", "dark")
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "theme.json"

# --- colour maths: sRGB, OKLab/OKLCH (Ottosson), colour-blindness simulation (Machado 2009, severity 1) ----------------

def _lin(c: float) -> float:
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _gamma(x: float) -> float:
    x = min(max(x, 0.0), 1.0)
    return 255 * (12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055)


def hex_to_rgb(h: str) -> Tuple[float, float, float]:
    c = parse_color(h)
    if c is None or c[3] < 1:
        raise ValueError(f"not an opaque hex or rgb() colour: {h!r}")
    return c[0], c[1], c[2]


def rgb_to_hex(rgb: Tuple[float, float, float]) -> str:
    return "#" + "".join(f"{round(min(max(v, 0), 255)):02x}" for v in rgb)


def lin_to_oklab(r: float, g: float, b: float) -> Tuple[float, float, float]:
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


def oklab_to_lin(L: float, a: float, b: float) -> Tuple[float, float, float]:
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)


def to_oklab(h: str) -> Tuple[float, float, float]:
    return lin_to_oklab(*(_lin(v) for v in hex_to_rgb(h)))


def from_oklab(L: float, a: float, b: float) -> str:
    return rgb_to_hex(tuple(_gamma(v) for v in oklab_to_lin(L, a, b)))


def to_oklch(h: str) -> Tuple[float, float, float]:
    L, a, b = to_oklab(h)
    return L, math.hypot(a, b), math.degrees(math.atan2(b, a)) % 360


def from_oklch(L: float, C: float, H: float) -> str:
    """A hex colour at lightness L and hue H; chroma is lowered until it fits the sRGB gamut (hue and lightness are kept)."""
    L = min(max(L, 0.0), 1.0)
    for _ in range(40):
        a, b = C * math.cos(math.radians(H)), C * math.sin(math.radians(H))
        if all(-1e-4 <= v <= 1 + 1e-4 for v in oklab_to_lin(L, a, b)):
            return from_oklab(L, a, b)
        C *= 0.93
    return from_oklab(L, 0, 0)


def with_lightness(h: str, L: float) -> str:
    _, C, H = to_oklch(h)
    return from_oklch(L, C, H)


def mix(h1: str, h2: str, t: float) -> str:
    """OKLab mix: t = 0 is h1, t = 1 is h2 (t may be outside 0..1)."""
    return from_oklab(*(x + (y - x) * t for x, y in zip(to_oklab(h1), to_oklab(h2))))


def rgba(h: str, alpha: float) -> str:
    r, g, b = (round(v) for v in hex_to_rgb(h))
    return f"rgba({r}, {g}, {b}, {alpha:g})"


def ok_distance(h1: str, h2: str) -> float:
    return math.dist(to_oklab(h1), to_oklab(h2))


_CVD = {"protanopia": ((0.152286, 1.052583, -0.204868), (0.114503, 0.786281, 0.099216), (-0.003882, -0.048116, 1.051998)),
        "deuteranopia": ((0.367322, 0.860646, -0.227968), (0.280085, 0.672501, 0.047413), (-0.011820, 0.042940, 0.968881))}


def cvd_distance(h1: str, h2: str) -> float:
    """The smaller OKLab distance between two colours as seen with protanopia or deuteranopia."""
    def sim(h: str, m) -> Tuple[float, float, float]:
        lin = [_lin(v) for v in hex_to_rgb(h)]
        return lin_to_oklab(*(min(max(sum(m[i][j] * lin[j] for j in range(3)), 0), 1) for i in range(3)))
    return min(math.dist(sim(h1, m), sim(h2, m)) for m in _CVD.values())


CVD_MIN = 0.15  # the default in/out edge pair measures 0.31 or more; below 0.15 the two blur together


def is_hex(v: Any) -> bool:
    return isinstance(v, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", v) is not None


def norm_hex(v: str) -> str:
    """Any hex or rgb() colour as #rrggbb (a colour with transparency is refused: the derivations need opaque ones)."""
    return rgb_to_hex(hex_to_rgb(v))


# --- reading a website -----------------------------------------------------------------------------------------------

# Runs inside the page, in headless Chrome only. Returns plain data: colours as [r,g,b] (rebuilt as hex by Python), numbers
# and short strings. Page text is never returned.
COLLECT_JS = r"""(async () => {
  await Promise.race([document.fonts ? document.fonts.ready : null, new Promise((r) => setTimeout(r, 4000))]);
  await new Promise((r) => setTimeout(r, 700));
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d');
  const rgb = (s) => {
    if (!s) return null;
    cx.fillStyle = '#000000'; cx.fillStyle = s; const a = cx.fillStyle;
    cx.fillStyle = '#ffffff'; cx.fillStyle = s; const b = cx.fillStyle;
    if (a !== b) return null;
    let m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(a);
    if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), 1];
    m = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(a);
    return m ? [+m[1], +m[2], +m[3], +m[4]] : null;
  };
  const W = innerWidth, H = 3000, num = (v) => (v === 'normal' ? null : parseFloat(v));
  const els = [...document.body.querySelectorAll('*')].slice(0, 5000);
  const vis = (el) => {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0 || r.width < 2 || r.height < 2) return null;
    const top = r.top + scrollY, w = Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0)), h = Math.max(0, Math.min(top + r.height, H) - Math.max(top, 0));
    return w * h > 0 ? { cs, area: w * h, w: r.width, h: r.height } : null;
  };
  const out = { url: location.href, width: W, visibleCount: 0, textChars: 0, surfaces: [], text: [], borders: [], buttons: [], links: [], cards: [], type: {}, fonts: {}, googleHrefs: [],
                vars: {}, navLinks: [], icons: { classes: {}, fonts: [], sprites: [], strokes: [] } };
  // surfaces: own background of body, html and every visible element, with the area it covers
  const bodyBg = rgb(getComputedStyle(document.body).backgroundColor), htmlBg = rgb(getComputedStyle(document.documentElement).backgroundColor);
  out.canvas = (bodyBg && bodyBg[3] > 0.9 ? bodyBg : htmlBg && htmlBg[3] > 0.9 ? htmlBg : [255, 255, 255, 1]).slice(0, 3);
  for (const el of els) {
    const v = vis(el); if (!v) continue;
    out.visibleCount += 1;
    const bg = rgb(v.cs.backgroundColor), role = el.closest('header,nav') ? 'header' : el.closest('main') ? 'main' : el.closest('footer') ? 'footer' : 'other';
    if (bg && bg[3] > 0.9 && !el.closest('button,a,[role=button]')) out.surfaces.push({ c: bg.slice(0, 3), a: Math.round(v.area), role });
    const bw = parseFloat(v.cs.borderTopWidth), bc = rgb(v.cs.borderTopColor);
    if (bw > 0 && v.cs.borderTopStyle !== 'none' && bc && bc[3] > 0.2) out.borders.push({ c: bc.slice(0, 3), a: Math.round(v.area) });
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim().length).reduce((x, y) => x + y, 0);
    const tc = rgb(v.cs.color);
    if (own > 0 && tc && tc[3] > 0.5) {
      out.textChars += own;
      const inLink = !!el.closest('a,button,[role=button]');
      out.text.push({ c: tc.slice(0, 3), n: own, link: inLink, small: !!el.closest('small,figcaption,[class*=caption],[class*=muted],[class*=small],[class*=secondary]') });
    }
  }
  // buttons, links, cards
  const btnSel = 'button, a[class*=btn], a[class*=button], [role=button], input[type=submit], input[type=button]';
  for (const el of [...document.querySelectorAll(btnSel)].slice(0, 200)) {
    const v = vis(el); if (!v) continue;
    const bg = rgb(v.cs.backgroundColor), fg = rgb(v.cs.color), bd = rgb(v.cs.borderTopColor);
    out.buttons.push({ bg: bg && bg[3] > 0.9 ? bg.slice(0, 3) : null, fg: fg ? fg.slice(0, 3) : null, border: bd && bd[3] > 0.5 && parseFloat(v.cs.borderTopWidth) > 0 ? bd.slice(0, 3) : null,
      radius: parseFloat(v.cs.borderTopLeftRadius) || 0, shadow: v.cs.boxShadow, area: Math.round(v.area),
      family: v.cs.fontFamily, size: parseFloat(v.cs.fontSize), weight: parseInt(v.cs.fontWeight, 10), h: v.h });
  }
  for (const el of [...document.querySelectorAll('a')].slice(0, 300)) {
    if (el.matches(btnSel)) continue;
    const v = vis(el), c = v && rgb(v.cs.color); if (c) out.links.push({ c: c.slice(0, 3), n: (el.textContent || '').trim().length });
  }
  const seenNav = new Set(), baseHref = location.href.split('#')[0];
  for (const el of [...document.querySelectorAll('a[href]')].slice(0, 500)) {
    let u; try { u = new URL(el.getAttribute('href'), location.href); } catch (e) { continue; }
    const sameOrigin = u.protocol === location.protocol && (u.protocol === 'file:' ? u.pathname !== location.pathname : (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === location.origin);
    if (!sameOrigin) continue;
    const href = u.href.split('#')[0];
    if (href === baseHref || seenNav.has(href)) continue;
    seenNav.add(href);
    const label = (el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    out.navLinks.push({ href, label });
    if (out.navLinks.length >= 80) break;
  }
  for (const el of els) {
    const v = vis(el); if (!v || v.w < 120 || v.h < 60 || v.w > W * 0.9) continue;
    const bw = parseFloat(v.cs.borderTopWidth) > 0, sh = v.cs.boxShadow !== 'none', rad = parseFloat(v.cs.borderTopLeftRadius) || 0;
    if ((sh || bw) && (rad > 0 || sh) && (/card|tile|panel|box/i.test(el.className && el.className.baseVal === undefined ? String(el.className) : '') || el.tagName === 'ARTICLE')) {
      const bg = rgb(v.cs.backgroundColor); out.cards.push({ radius: rad, shadow: v.cs.boxShadow, bg: bg && bg[3] > 0.9 ? bg.slice(0, 3) : null });
    }
  }
  // type
  const pick = (sel) => [...document.querySelectorAll(sel)].map(vis).filter(Boolean)[0];
  const pull = (v) => v && { family: v.cs.fontFamily, size: parseFloat(v.cs.fontSize), weight: parseInt(v.cs.fontWeight, 10), lh: num(v.cs.lineHeight), ls: num(v.cs.letterSpacing) };
  for (const [k, sel] of Object.entries({ h1: 'h1', h2: 'h2', h3: 'h3', p: 'main p, p', small: 'small, figcaption, [class*=caption], [class*=small]', code: 'code, pre, kbd' })) out.type[k] = pull(pick(sel)) || null;
  const bcs = getComputedStyle(document.body);
  out.type.body = { family: bcs.fontFamily, size: parseFloat(bcs.fontSize), weight: parseInt(bcs.fontWeight, 10), lh: num(bcs.lineHeight), ls: num(bcs.letterSpacing) };
  out.fonts = { body: bcs.fontFamily };
  out.googleHrefs = [...document.querySelectorAll('link[rel~=stylesheet]')].map((l) => l.href).filter((h) => h.startsWith('https://fonts.googleapis.com/')).slice(0, 10);
  // custom properties declared on :root / html / body, with their computed value
  const names = new Set(), rcs = getComputedStyle(document.documentElement);
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
    for (const r of rules || []) if (r.style && /^(:root|html|body)\b/.test(r.selectorText || '')) for (const p of r.style) if (p.startsWith('--')) names.add(p);
  }
  for (const n of [...names].slice(0, 400)) { const c = rgb(rcs.getPropertyValue(n).trim()); if (c && c[3] > 0.9) out.vars[n] = c.slice(0, 3); }
  // icons: class markers, icon fonts, sprites, inline SVG stroke width (normalised to a 24 unit grid)
  const known = { lucide: /(^|\s)lucide(-|\s|$)/, phosphor: /(^|\s)ph(-[a-z]+)?\s|(^|\s)ph-/, tabler: /(^|\s)ti(\s|$)|(^|\s)ti-/, bootstrap: /(^|\s)bi(\s|$)|(^|\s)bi-/,
    material: /material-(symbols|icons)/, fontawesome: /(^|\s)fa[srlbd]?(\s|$)|(^|\s)fa-/, feather: /(^|\s)feather(\s|-|$)/, remix: /(^|\s)ri-/, heroicons: /heroicon/ };
  for (const el of document.querySelectorAll('[class]')) {
    const c = el.getAttribute('class') || '';
    for (const [k, re] of Object.entries(known)) if (re.test(c)) out.icons.classes[k] = (out.icons.classes[k] || 0) + 1;
  }
  out.icons.fonts = [...new Set([...document.querySelectorAll('i, span[class*=icon], [class*=icon]')].slice(0, 50).map((e) => getComputedStyle(e).fontFamily))].slice(0, 10);
  out.icons.sprites = [...document.querySelectorAll('symbol[id], use')].slice(0, 60).map((e) => e.id || e.getAttribute('href') || e.getAttribute('xlink:href') || '').slice(0, 60);
  for (const svg of [...document.querySelectorAll('svg')].slice(0, 300)) {
    const v = vis(svg); if (!v || v.w > 48 || v.h > 48) continue;
    const vb = (svg.getAttribute('viewBox') || '').split(/[ ,]+/).map(Number), vbw = vb.length === 4 && vb[2] > 0 ? vb[2] : null;
    const shape = [svg, ...svg.querySelectorAll('path,circle,line,polyline,rect,polygon')].find((s) => { const c = getComputedStyle(s); return c.stroke !== 'none' && parseFloat(c.strokeWidth) > 0; });
    if (shape && vbw) out.icons.strokes.push(parseFloat(getComputedStyle(shape).strokeWidth) * 24 / vbw);
  }
  return out;
})()"""


class ExtractionEmptyError(Exception):
    """Raised when a website or brand file yields no meaningful styling (no theme file should be written)."""

    def __init__(self, reason: str, capture: Optional[Path] = None):
        super().__init__(reason)
        self.reason = reason
        self.capture = capture


def format_suggestions(capture: Optional[Path] = None) -> str:
    """Plain-English next steps when extraction cannot read meaningful styling."""
    steps = (
        "  1. Open the website or brand page in your browser, take a screenshot, and share the image.\n"
        "  2. Share a brand guide (PDF, image, CSS/design-tokens file) or save the webpage from your browser (File -> Save Page As).\n"
        "  3. Share your brand basics directly: main brand hex colour(s), optional secondary colours, font name, and light/dark preference."
    )
    if capture:
        return (
            f"[CAPTURE] {capture}\n"
            "[SUGGEST] Inspect the captured browser screenshot above. If the brand page rendered visually (for example image- or canvas-based styling), "
            "extract its colours and style into a partial theme JSON and run --from <partial.json> --complete. "
            "If the screenshot is blank, blocked, or shows a login/verification page, ask the user to:\n" + steps
        )
    return "[SUGGEST] No usable brand styling was found, so no theme file was written. Suggest the user try one of these:\n" + steps


BROWSER_DEFAULT_FONTS = {
    "times", "times new roman", "dejavu serif", "dejavu sans", "liberation serif", "liberation sans",
    "arial", "helvetica", "helvetica neue", "segoe ui", "tahoma", "verdana", "roboto", "cantarell", "ubuntu",
}


def _is_custom_font(fam: Optional[str]) -> bool:
    return bool(fam and fam.strip().lower() not in BROWSER_DEFAULT_FONTS)


def has_meaningful_site_style(raw: Dict[str, Any], partial: Dict[str, Any]) -> Tuple[bool, str]:
    """True if the site yielded at least one meaningful brand signal (brand colour, custom font, or non-default canvas)."""
    if raw.get("visibleCount", 1) == 0:
        return False, "page rendered no visible elements"
    mode_colors = partial.get("color", {}).get("dark") or partial.get("color", {}).get("light") or {}
    has_primary = bool(mode_colors.get("primary"))
    has_brand_colors = bool((partial.get("brand") or {}).get("colors"))
    has_font = _is_custom_font((partial.get("font") or {}).get("family"))
    canvas = str(mode_colors.get("bg-page", "#ffffff")).lower()
    has_non_default_bg = canvas not in ("#ffffff", "#fff")
    if not any((has_primary, has_brand_colors, has_font, has_non_default_bg)):
        return False, "no brand colour, custom font, or non-default background was found on the page"
    return True, ""


def has_meaningful_partial(partial: Dict[str, Any]) -> bool:
    """True if a --from partial theme JSON contains at least one styling key."""
    if not isinstance(partial, dict):
        return False
    color = partial.get("color") or {}
    if isinstance(color, dict) and any(isinstance(color.get(m), dict) and bool(color.get(m)) for m in MODES):
        return True
    if (partial.get("brand") or {}).get("colors"):
        return True
    font = partial.get("font") or {}
    if isinstance(font, dict) and (font.get("family") or font.get("href")):
        return True
    if partial.get("type") or partial.get("_type"):
        return True
    if partial.get("radius") or partial.get("_radius") is not None:
        return True
    if partial.get("shadow") or partial.get("_shadow"):
        return True
    if partial.get("palette"):
        return True
    icon = partial.get("icon") or {}
    icons_raw = partial.get("_icons") or {}
    if (isinstance(icon, dict) and bool(icon)) or any(v is not None for v in icons_raw.values()):
        return True
    return False


def _raw_looks_weak(raw: Dict[str, Any]) -> bool:
    """Fast pre-check on raw COLLECT_JS data to decide whether to capture a browser screenshot before closing Chrome."""
    if raw.get("visibleCount", 1) == 0:
        return True
    if any(b.get("bg") and chroma(hx(b["bg"])) > 0.06 for b in raw.get("buttons", [])):
        return False
    if any(re.search(r"(primary|brand)(-?colou?r)?(-500|-600)?$", n) for n in raw.get("vars", {})):
        return False
    if any(chroma(hx(l["c"])) > 0.06 for l in raw.get("links", [])):
        return False
    if any(chroma(hx(s["c"])) > 0.09 for s in raw.get("surfaces", [])):
        return False
    return True


_BRAND_NAV_RE = re.compile(
    r"(?<![a-z0-9])(colou?rs?|palettes?|swatches?|typography|fonts?|typefaces?|icons?|iconography|brand(?:ing)?|"
    r"guidelines?|design[-_ ]?systems?|tokens?|foundations?|visual[-_ ]?identity|style[-_ ]?guides?|themes?)(?![a-z0-9])",
    re.I,
)


def brand_subpages(raw: Dict[str, Any], base_url: str) -> List[Tuple[str, str]]:
    """Same-origin brand or design-system subpages from navLinks (validated URL + sanitized ASCII label only)."""
    base = urlparse(base_url)
    if base.scheme not in ("http", "https", "file"):
        return []
    base_clean = f"{base.scheme}://{base.netloc}{base.path}" + (f"?{base.query}" if base.query else "")
    base_dir = Path(url2pathname(base.path)).parent.resolve() if base.scheme == "file" else None
    out: List[Tuple[str, str]] = []
    seen = {base_clean}
    for item in raw.get("navLinks") or []:
        if not isinstance(item, dict):
            continue
        href = str(item.get("href") or "").strip()
        if not href or any(c in href for c in "\r\n\t\x00 <>\"'"):
            continue
        u = urlparse(href)
        if u.scheme != base.scheme:
            continue
        if u.scheme in ("http", "https"):
            if u.netloc != base.netloc:
                continue
            clean_url = f"{u.scheme}://{u.netloc}{u.path}" + (f"?{u.query}" if u.query else "")
        else:
            if not base_dir:
                continue
            try:
                Path(url2pathname(u.path)).resolve().relative_to(base_dir)
            except ValueError:
                continue
            clean_url = f"file://{u.path}"
        if clean_url in seen:
            continue
        label = re.sub(r"[^A-Za-z0-9 &/._-]+", " ", str(item.get("label") or "")).strip()
        label = re.sub(r"\s+", " ", label)[:40]
        if not (_BRAND_NAV_RE.search(u.path) or _BRAND_NAV_RE.search(label)):
            continue
        seen.add(clean_url)
        out.append((clean_url, label))
        if len(out) >= 10:
            break
    return out


def collect_site(
    url: str,
    browser: Optional[str],
    capture_path: Optional[Path] = None,
    capture_on_weak: Optional[Path] = None,
) -> Tuple[Dict[str, Any], Optional[Path]]:
    from measure_font import chrome_session
    u = urlparse(url)
    if u.scheme not in ("http", "https", "file"):
        raise ValueError(f"--url: only http, https and file addresses are read, not {u.scheme or 'a bare path'!r}")
    with chrome_session(browser, 90, ("--window-size=1280,900", "--hide-scrollbars", "--mute-audio")) as call:
        call("Page.enable")
        call("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 900, "deviceScaleFactor": 1, "mobile": False})
        nav = call("Page.navigate", {"url": url})
        if nav.get("errorText"):
            raise ExtractionEmptyError(f"could not load {url}: {nav['errorText']}")
        # A pending third-party stylesheet holds back script execution, so even this poll can stall: after 15 s stop the load and read the page as it is.
        call.settimeout(15)
        try:
            while call("Runtime.evaluate", {"expression": "document.readyState", "returnByValue": True})["result"].get("value") != "complete":
                time.sleep(0.3)
        except TimeoutError:
            call.settimeout(60)
            call("Page.stopLoading")
        call.settimeout(60)
        res = call("Runtime.evaluate", {"expression": COLLECT_JS, "awaitPromise": True, "returnByValue": True})
        if "exceptionDetails" in res:
            raise RuntimeError(f"could not read the page: {res['exceptionDetails'].get('text')}")
        raw = res["result"]["value"]
        page_url = raw.get("url") or ""
        if page_url.startswith("chrome-error://") or (page_url == "about:blank" and not url.startswith("about:")):
            raise ExtractionEmptyError(f"browser landed on an error or blank page ({page_url})")
        saved_capture: Optional[Path] = None
        target = capture_path or (capture_on_weak if _raw_looks_weak(raw) else None)
        if target is not None:
            try:
                shot = call("Page.captureScreenshot", {"format": "png"})
                if shot.get("data"):
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(base64.b64decode(shot["data"]))
                    saved_capture = target
            except (RuntimeError, OSError):
                saved_capture = None
        return raw, saved_capture


GENERIC = {"system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "sans-serif", "serif", "monospace", "cursive", "fantasy",
           "-apple-system", "blinkmacsystemfont", "emoji", "math", "inherit", "initial"}
_NAME_OK = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 .-]{0,39}$")


def families(css: str) -> List[str]:
    """Family names of a computed font-family list, only the safe ones (letters, digits, space, dot, hyphen)."""
    names = [p.strip().strip("\"'") for p in re.split(r",(?=(?:[^\"']*[\"'][^\"']*[\"'])*[^\"']*$)", css or "")]
    return [n for n in names if _NAME_OK.match(n)]


def named(css: str) -> Optional[str]:
    return next((n for n in families(css) if n.lower() not in GENERIC), None)


def google_href(family: str, page_hrefs: List[str], probe: bool, notes: List[str]) -> str:
    """A fonts.googleapis.com stylesheet for `family`: the one the page itself links, else a probed standard one, else ''."""
    for h in page_hrefs:
        fams = [f.split(":")[0].replace("+", " ") for f in parse_qs(urlparse(h).query).get("family", [])]
        if family in fams and _HREF.match(h):
            notes.append(f"font.href = the stylesheet the page links for {family!r}")
            return h
    if not probe:
        notes.append(f"[WARN] font.href not set: {family!r} is not linked by the page and --offline skips the Google Fonts lookup")
        return ""
    h = f"https://fonts.googleapis.com/css2?family={family.replace(' ', '+')}:wght@400;500;600;700&display=swap"
    try:
        urllib.request.urlopen(urllib.request.Request(h, headers={"User-Agent": "Mozilla/5.0"}), timeout=15).close()
        notes.append(f"font.href = Google Fonts has {family!r}")
        return h
    except urllib.error.HTTPError as exc:
        notes.append(f"[WARN] {family!r} is not on Google Fonts (HTTP {exc.code}): font.href left empty, the page uses the fallback stack")
    except OSError as exc:
        notes.append(f"[WARN] could not ask Google Fonts about {family!r} ({exc}): font.href left empty")
    return ""


def hx(c: List[float]) -> str:
    return rgb_to_hex(tuple(c[:3]))


def weighted(items: List[Dict[str, Any]], key: str) -> List[Tuple[str, float]]:
    acc: Dict[str, float] = {}
    for it in items:
        acc[hx(it["c"])] = acc.get(hx(it["c"]), 0) + it[key]
    return sorted(acc.items(), key=lambda kv: -kv[1])


def chroma(h: str) -> float:
    return to_oklch(h)[1]


NEAREST_WEIGHT = {400: "regular", 500: "medium", 600: "semibold", 700: "bold"}


def weight_name(w: float) -> str:
    return NEAREST_WEIGHT[min(NEAREST_WEIGHT, key=lambda k: abs(k - w))]


def site_to_partial(raw: Dict[str, Any], name: str, probe: bool, notes: List[str]) -> Dict[str, Any]:
    """Map what the page reported onto theme keys. Every line added to `notes` says where a value came from."""
    light: Dict[str, str] = {}
    src = lambda k, v, why: notes.append(f"[MAP] {k} = {v}  <- {why}")  # noqa: E731
    canvas = hx(raw["canvas"])
    dark_site = to_oklch(canvas)[0] < 0.45
    mode = "dark" if dark_site else "light"
    colors = {"bg-page": canvas}
    src("bg-page", canvas, "page canvas (body or html background)")
    # panel: the surface that covers most area after the canvas
    panels = [(c, a) for c, a in weighted([s for s in raw["surfaces"] if s["role"] != "header"], "a") if ok_distance(c, canvas) > 0.01]
    if panels:
        colors["bg-panel"] = panels[0][0]
        src("bg-panel", panels[0][0], f"largest surface that differs from the canvas ({int(panels[0][1])} px visible)")
    else:
        notes.append("[DERIVE] bg-panel: the page has one background; the panel is derived from it")
    # text: the heaviest colour outside links and buttons
    body_text = weighted([t for t in raw["text"] if not t["link"]], "n")
    if body_text:
        colors["text-main"] = body_text[0][0]
        src("text-main", body_text[0][0], f"most text ({int(body_text[0][1])} characters)")
        muted = [c for c, _ in weighted([t for t in raw["text"] if not t["link"] and t["small"]], "n") if c != body_text[0][0]] or \
                [c for c, _ in body_text[1:] if chroma(c) < 0.04 and abs(to_oklch(c)[0] - to_oklch(body_text[0][0])[0]) > 0.1]
        if muted:
            colors["text-muted"] = muted[0]
            src("text-muted", muted[0], "secondary text (small print or the next neutral text colour)")
    borders = weighted(raw["borders"], "a")
    if borders:
        colors["border-color"] = borders[0][0]
        src("border-color", borders[0][0], "most common border colour")
    # primary: the filled button that is most saturated (then largest); else a primary custom property; else the link colour
    buttons = [b for b in raw["buttons"] if b["bg"] and chroma(hx(b["bg"])) > 0.06]
    primary, why = None, ""
    if buttons:
        b = max(buttons, key=lambda b: (round(chroma(hx(b["bg"])), 2), b["area"]))
        primary, why = hx(b["bg"]), "background of the most saturated button"
    var_primary = next((hx(v) for n, v in raw["vars"].items() if re.search(r"(primary|brand)(-?colou?r)?(-500|-600)?$", n)), None)
    if primary is None and var_primary:
        primary, why = var_primary, "a custom property named primary or brand"
    links = [(c, w) for c, w in weighted([{"c": l["c"], "n": max(l["n"], 1)} for l in raw["links"]], "n") if chroma(c) > 0.06]
    if primary is None and links:
        primary, why = links[0][0], "the most used link colour"
    brand_colors: List[str] = []
    if primary:
        colors["primary"] = primary
        src("primary", primary, why)
        brand_colors = [primary] + [c for c in ([var_primary] if var_primary else []) + [l[0] for l in links[:3]]
                                    + [hx(v) for n, v in raw["vars"].items() if re.search(r"(accent|secondary|tertiary|brand|success|info|warning|highlight)", n)]
                                    if chroma(c) > 0.06]
        if buttons:
            fg = hx(max(buttons, key=lambda b: (round(chroma(hx(b["bg"])), 2), b["area"]))["fg"] or [255, 255, 255])
            colors["on-primary"] = fg
            src("on-primary", fg, "text colour of that button")
    else:
        notes.append("[WARN] no brand colour found (no coloured button, primary property or coloured link): primary and the palette stay default — "
                     "for a brand guide or design system, inspect [NAV] subpages or [CAPTURE] screenshot and author partial.json")
    accents = [hx(s["c"]) for s in raw["surfaces"] if chroma(hx(s["c"])) > 0.09]
    brand_colors += list(dict.fromkeys(accents))[:4]
    partial: Dict[str, Any] = {"tokensVersion": TOKENS_VERSION, "name": name, "color": {mode: colors}}
    if brand_colors:
        partial["brand"] = {"colors": list(dict.fromkeys(brand_colors))}
    if dark_site:
        notes.append("[NOTE] the site is dark: its colours became the dark set, the light set is derived")

    # --- font
    fam = named(raw["fonts"]["body"])
    if fam:
        partial["font"] = {"family": fam, "href": "", "stack": ", ".join(
            [f'"{n}"' if " " in n else n for n in families(raw["fonts"]["body"]) if n != fam and n.lower() not in ("inherit", "initial")][:6] or ["sans-serif"])}
        if not any(n.lower() in ("sans-serif", "serif", "monospace") for n in families(raw["fonts"]["body"])):
            partial["font"]["stack"] += ", sans-serif"
        src("font.family", fam, "computed font of body")
        partial["font"]["href"] = google_href(fam, raw["googleHrefs"], probe, notes)
    else:
        notes.append("[NOTE] the page uses only system fonts: the default font stays")
    ty: Dict[str, Any] = {"family": {}, "styles": {}}
    btn_fam = named(max(raw["buttons"], key=lambda b: b["area"])["family"]) if raw["buttons"] else None
    if btn_fam and btn_fam != fam:
        ty["family"]["ui"] = f'"{btn_fam}", sans-serif'
        src("type.family.ui", btn_fam, "button font differs from the body font")
    code_fam = named((raw["type"].get("code") or {}).get("family", ""))
    if code_fam:
        ty["family"]["mono"] = f'"{code_fam}", ui-monospace, monospace'
        src("type.family.mono", code_fam, "computed font of code")
    # --- type sizes: the default scale follows the brand's body size, clamped (see clamp_type)
    body = raw["type"]["p"] or raw["type"]["body"]
    heads = [raw["type"][k] for k in ("h1", "h2", "h3") if raw["type"].get(k)]
    if body and body["size"]:
        ty["bodySize"] = body["size"]
        src("type scale", f"body {body['size']:g}px", "computed size of body text")
        if body["weight"]:
            ty["styles"]["detail"] = {"weight": weight_name(body["weight"])}
        if body["lh"] and body["size"]:
            ty.setdefault("leading", {})["normal"] = round(min(max(body["lh"] / body["size"], 1.25), 1.7), 2)
        if body["ls"] is not None and body["size"] and abs(body["ls"] / body["size"]) <= 0.05 and body["ls"] != 0:
            ty.setdefault("tracking", {})["normal"] = f"{body['ls'] / body['size']:.3g}em"
    if heads:
        ty["styles"]["title"] = {"weight": weight_name(statistics.median(h["weight"] for h in heads))}
        lhs = [h["lh"] / h["size"] for h in heads if h["lh"] and h["size"]]
        if lhs:
            ty.setdefault("leading", {})["tight"] = round(min(max(statistics.median(lhs), 1.05), 1.35), 2)
        src("type.styles.title.weight", ty["styles"]["title"]["weight"], "weight of h1 to h3")
    if raw["buttons"]:
        b = max(raw["buttons"], key=lambda b: b["area"])
        if b["weight"]:
            ty["styles"]["control"] = {"weight": weight_name(b["weight"])}
    partial["_type"] = ty
    # --- radius and shadow
    r = [c["radius"] for c in raw["cards"] if c["radius"] > 0] or [b["radius"] for b in raw["buttons"] if b["radius"] > 0]
    if raw["cards"] or raw["buttons"]:
        base = statistics.median(r) if r else 0
        partial["_radius"] = min(base, 24)
        src("radius", f"{min(base, 24):g}px for cards", "median corner radius of cards (else buttons)" if r else "no rounded corners found")
    sh = next((c["shadow"] for c in raw["cards"] if c["shadow"] != "none"), None)
    if sh:
        partial["_shadow"] = sh
    else:
        notes.append("[NOTE] cards and buttons have no shadow: the default shadows stay")
    # --- icons
    ic = raw["icons"]
    marks = sorted(ic["classes"].items(), key=lambda kv: -kv[1])
    fonts = " ".join(ic["fonts"]).lower() + " " + " ".join(ic["sprites"]).lower()
    for k, pat in (("lucide", "lucide"), ("phosphor", "phosphor"), ("tabler", "tabler"), ("bootstrap", "bootstrap-icons"), ("material", "material"),
                   ("fontawesome", "font awesome")):
        if pat in fonts and k not in ic["classes"]:
            marks.append((k, 1))
    partial["_icons"] = {"set": marks[0][0] if marks else None, "stroke": statistics.median(ic["strokes"]) if ic["strokes"] else None}
    notes.append(f"[MAP] icon set marker = {marks[0][0] + ' (' + str(marks[0][1]) + ' hits)' if marks else 'none found'}"
                 + (f"; inline SVG stroke width {partial['_icons']['stroke']:.2g} (24-unit grid, {len(ic['strokes'])} icons)" if ic["strokes"] else ""))
    for sub_url, sub_label in brand_subpages(raw, raw.get("url") or ""):
        notes.append(f"[NAV] {sub_url}" + (f"  ({sub_label})" if sub_label else ""))
    return partial


# --- completing a theme ----------------------------------------------------------------------------------------------

NEUTRAL_KEYS = ["bg-panel", "bg-viewport", "bg-hover", "bg-soft", "bg-input", "border-color", "border-dark", "grid-dot", "text-muted", "text-soft",
                "connector", "edge-label-bg", "edge-label-empty-border", "node-bg", "node-border", "task-accent", "lane-alt-bg", "lane-hover-bg",
                "note-bg", "note-border", "note-accent", "note-ink", "note-leader", "erd-fk", "menu-border"]
# palette lightness per role (the default palette is uniform: every slot uses these) and the chroma ceilings of the soft tones
SLOT_L = {"light": {"soft": 0.90, "strong": 0.56, "ink": 0.365, "solid": 0.45}, "dark": {"soft": 0.36, "strong": 0.74, "ink": 0.92, "solid": 0.84}}
SLOT_C = {"soft": 0.06, "ink": 0.09, "solid": 0.13}
HUE_NAMES = [(15, "rose"), (40, "red"), (70, "orange"), (95, "amber"), (115, "yellow"), (140, "lime"), (160, "green"), (175, "emerald"),
             (195, "teal"), (215, "cyan"), (245, "sky"), (270, "blue"), (290, "indigo"), (315, "purple"), (340, "magenta"), (361, "pink")]


class Completer:
    """Holds the merged tokens being completed and the report. Colour edits go through get()/put() so a dark-only override
    never leaks into light."""

    def __init__(self, partial: Dict[str, Any], notes: List[str]):
        partial = copy.deepcopy(partial)
        self.brand = partial.pop("brand", {}) or {}
        self.ty = partial.pop("_type", {})
        self.radius = partial.pop("_radius", None)
        self.shadow = partial.pop("_shadow", None)
        self.icons = partial.pop("_icons", {})
        self.partial = partial
        self.notes = notes
        self.default = merge_theme(None)
        self.tk = merge_theme(partial, "the theme to complete")
        self.given = {m: set(partial.get("color", {}).get(m, {})) for m in MODES}
        self.fixes: List[str] = []
        for m in MODES:  # derivations need opaque hex or rgb(); anything else (hsl, oklch, var) is the author's job to flatten
            for k in ("bg-page", "text-main", "primary"):
                if k in self.given[m]:
                    try:
                        self.tk["color"][m][k] = norm_hex(self.tk["color"][m][k])
                    except ValueError as exc:
                        raise ValueError(f"color.{m}.{k}: {exc} (give it as #rrggbb)")

    # token access -------------------------------------------------------
    def raw(self, key: str, mode: str) -> str:
        c = self.tk["color"]
        return c[mode][key] if key in c[mode] else c["light"][key]

    def get(self, key: str, mode: str) -> str:
        return resolve_colors(self.tk, mode)[key]

    def put(self, key: str, mode: str, value: str) -> None:
        self.tk["color"][mode][key] = value

    def locate(self, name: str, mode: str):
        """(dict, key) holding the token `name` in `mode`, following var() aliases; palette roles live in the slot."""
        m = re.fullmatch(r"sw-(\w+)-(fill|line|ink|solid|on-solid)", name)
        if m:
            slot = next(s for s in self.tk["palette"] if s["slot"] == m[1])
            tone = next(t for t, role in _TONES.items() if role == m[2])
            return slot[mode], tone
        c = self.tk["color"]
        v = self.raw(name, mode)
        alias = re.fullmatch(r"var\(--([\w-]+)\)", v)
        if alias:
            return self.locate(alias[1], mode)
        if mode == "dark" and name not in c["dark"]:
            c["dark"][name] = c["light"][name]
        return c[mode], name

    # dark and light --------------------------------------------------
    def counterpart(self, key: str, value: str, src: str) -> str:
        """The colour for the mode the brand did not give: hue and chroma kept, lightness taken from the default's own value for
        that key in the target mode (or inverted, 1 - L, when the default has none)."""
        dst = "dark" if src == "light" else "light"
        L, C, H = to_oklch(value)
        d = self.default["color"][dst].get(key)
        target = to_oklch(d)[0] if d and is_hex(d) else 1 - L
        return from_oklch(target, C * (0.92 if dst == "dark" else 1), H)

    def complete(self) -> None:
        tk, notes = self.tk, self.notes
        if self.partial.get("name") is None:
            tk["name"] = "brand"
        both = {k for m in MODES for k in self.given[m]}
        # 1. the other mode, for every colour the brand gave in one mode only
        for m in MODES:
            other = "dark" if m == "light" else "light"
            for k in sorted(self.given[m] - self.given[other]):
                v = tk["color"][m][k]
                if is_hex(v) and (m == "dark" or k in self.default["color"]["dark"]):  # a key with no dark role in the default is the same in both modes
                    tk["color"][other][k] = self.counterpart(k, v, m)
                    notes.append(f"[DERIVE] color.{other}.{k} = {tk['color'][other][k]}  <- {m} value {v}, lightness of the default {other} role, hue kept")
                    self.given[other].add(k)
        # 2. neutral surfaces and text ramp from the brand's page background and text
        if {"bg-page", "text-main"} & both:
            for m in MODES:
                bg, tx = self.get("bg-page", m), self.get("text-main", m)
                dbg, dtx = self.default["color"][m]["bg-page"], self.default["color"][m]["text-main"]
                dl = to_oklab(dbg)[0], to_oklab(dtx)[0]
                for k in NEUTRAL_KEYS:
                    if k in self.given[m]:
                        continue
                    dv = self.default["color"][m].get(k)
                    if not dv or not is_hex(dv):
                        continue
                    t = (to_oklab(dv)[0] - dl[0]) / (dl[1] - dl[0])
                    v = mix(bg, tx, t)
                    self.put(k, m, v)
                notes.append(f"[DERIVE] {m} neutrals ({', '.join(NEUTRAL_KEYS[:4])}, ...) = OKLab mix of bg-page {bg} and text-main {tx}, at the default's own fractions")
        # 3. everything that follows the primary colour
        if "primary" in both:
            self.derive_primary()
        # 4. palette
        self.build_palette()
        # 5. radius, shadow, type, icons
        self.apply_shape()
        self.clamp_type()

    def derive_primary(self, quiet: bool = False) -> None:
        notes = self.notes
        for m in MODES:
            p = self.get("primary", m)
            L, C, H = to_oklch(p)
            hover = with_lightness(p, L - 0.06 if m == "light" else L + 0.10)
            a = {"light": (0.25, 0.22, 0.06, 0.28), "dark": (0.4, 0.35, 0.10, 0.35)}[m]
            derived = {"primary-hover": hover, "primary-ring": rgba(p, a[0]), "primary-glow": rgba(p, a[1]), "primary-wash": rgba(p, a[2]),
                       "edge-out": "var(--primary)", "edge-out-glow": rgba(p, a[3]),
                       "banner-bg": from_oklch(0.97 if m == "light" else 0.26, min(C, 0.03 if m == "light" else 0.05), H),
                       "banner-border": from_oklch(0.88 if m == "light" else 0.35, min(C, 0.06), H),
                       "banner-text": from_oklch(0.40 if m == "light" else 0.87, min(C, 0.12), H)}
            if "on-primary" not in self.given[m]:
                derived["on-primary"] = max(("#ffffff", "#0b1220"), key=lambda c: ratio(parse_color(c), parse_color(p)))
            for k, v in derived.items():
                if k not in self.given[m]:
                    self.put(k, m, v)
        if not quiet:
            notes.append("[DERIVE] primary-hover (lightness -0.06 light, +0.10 dark), primary-ring/glow/wash and edge-out-glow (primary at fixed alpha), "
                     "edge-out (= primary), banner-* (primary hue, fixed lightness), on-primary (white or #0b1220, whichever contrasts more)")

    def build_palette(self) -> None:
        notes, tk = self.notes, self.tk
        if "palette" in self.partial:
            notes.append("[NOTE] palette given by the theme: kept as is")
            return
        seeds: List[str] = []
        for c in ([self.get("primary", "light")] if "primary" in self.given["light"] else []) + list(self.brand.get("colors", [])):
            try:
                h = norm_hex(c)
            except ValueError:
                notes.append(f"[WARN] brand colour {c!r} skipped: not a #rrggbb or rgb() colour")
                continue
            if chroma(h) < 0.04:
                notes.append(f"[NOTE] brand colour {h} is neutral (chroma under 0.04): it stays out of the palette; slot 9 is the neutral")
            elif all(ok_distance(h, s) > 0.08 for s in seeds):
                seeds.append(h)
        if not seeds:
            notes.append("[NOTE] no brand colour: the default palette stays")
            return
        if len(seeds) > 8:
            notes.append(f"[NOTE] {len(seeds)} brand colours: the first 8 became slots, left out: {', '.join(seeds[8:])}")
            seeds = seeds[:8]
        hues = [to_oklch(s)[2] for s in seeds]
        ch = statistics.median(chroma(s) for s in seeds)
        fill_c = min(max(ch, 0.08), 0.14)
        made: List[Tuple[float, str]] = [(h, s) for h, s in zip(hues, seeds)]
        while len(made) < 8:
            hs = sorted(h for h, _ in made)
            gaps = [((hs[(i + 1) % len(hs)] - hs[i]) % 360 or 360, hs[i]) for i in range(len(hs))]
            gap, start = max(gaps)
            h = (start + gap / 2) % 360
            made.append((h, from_oklch(SLOT_L["light"]["strong"], fill_c, h)))
        # slot order: primary first, then hues apart from each other so neighbouring numbers never look alike
        first = made[0]
        ring = [first] + sorted(made[1:], key=lambda x: (x[0] - first[0]) % 360)
        order = [0, 4, 2, 6, 1, 5, 3, 7]
        slots = []
        used: Dict[str, int] = {}
        for n, idx in enumerate(order, 1):
            h, strong = ring[idx]
            L, C, H = to_oklch(strong)
            name = next(nm for bound, nm in HUE_NAMES if H < bound)
            used[name] = used.get(name, 0) + 1
            slot = {"slot": str(n), "name": name if used[name] == 1 else f"{name} {used[name]}", "hex": from_oklch(0.95, min(C, 0.04), H)}
            for m in MODES:
                t = SLOT_L[m]
                tones = {"soft": from_oklch(t["soft"], min(C, SLOT_C["soft"]), H),
                         "strong": strong if m == "light" else from_oklch(t["strong"], C, H),
                         "ink": from_oklch(t["ink"], min(C, SLOT_C["ink"]), H), "solid": from_oklch(t["solid"], min(C, SLOT_C["solid"]), H)}
                tones["on-solid"] = max(("#ffffff", "#0f172a"), key=lambda c: ratio(parse_color(c), parse_color(tones["solid"])))
                slot[m] = tones
            slots.append(slot)
        slots.append(copy.deepcopy(next(s for s in self.default["palette"] if s["slot"] == "9")))
        tk["palette"] = slots
        notes.append("[DERIVE] palette slots 1-8 from the brand colours (slot 1 = primary; "
                     + ", ".join(f"{s['slot']} {s['name']} {s['light']['strong']}" for s in slots[:8])
                     + "); the remaining hues fill the largest gaps on the hue circle; soft = light tint, strong = the brand colour in light, "
                       "re-derived for dark; slot 9 stays the default neutral")
        notes.append("[NOTE] slot hex: each slot's `hex` is a light tint of its own hue (it feeds lane and table tints), not the default palette's hex. "
                     "Old diagrams saved with a default-palette hex still map to the same slot numbers: layout_engine.py migrates them with the default "
                     "palette before any theme is applied.")

    def apply_shape(self) -> None:
        notes, tk = self.notes, self.tk
        if self.radius is not None:
            k = self.radius / 8
            tk["radius"].update({n: f"{round(float(v[:-2]) * k)}px" for n, v in self.default["radius"].items() if re.fullmatch(r"[\d.]+px", v) and n != "pill"})
            notes.append(f"[MAP] radius scale x {k:g} (lg = {tk['radius']['lg']}) <- card corner radius {self.radius:g}px; multi-corner values keep their default")
        if self.shadow:
            sh = re.sub(r"^(rgba?\([^)]*\))\s+(.*)$", r"\2 \1", self.shadow)  # a computed shadow lists its colour first
            if "," in re.sub(r"\([^)]*\)", "", sh) or not _is_shadow(sh):
                notes.append(f"[WARN] card shadow {self.shadow!r} not mapped: more than one layer or an unsupported value; default shadows stay")
            else:
                tk["shadow"]["sm"] = sh
                notes.append(f"[MAP] shadow.sm = {sh}  <- box-shadow of cards")
        ic = self.icons or {}
        if ic.get("stroke"):
            tk.setdefault("icon", {})["stroke"] = round(min(max(ic["stroke"], 1.5), 2.5) * 4) / 4
            notes.append(f"[MAP] icon.stroke = {tk['icon']['stroke']}  <- inline SVG icons of the site (clamped to 1.5-2.5)")
        if ic.get("set"):
            reg = ROOT / "assets" / "icons" / f"{ic['set']}.json"
            if reg.is_file():
                tk.setdefault("icon", {})["set"] = ic["set"]
                notes.append(f"[MAP] icon.set = {ic['set']}  <- icon markers on the page")
            else:
                notes.append(f"[NOTE] the site uses the {ic['set']} icon set, which this skill has no registry for: the default icon set stays")
        elif ic:
            notes.append("[NOTE] no known icon set found: the default icon set stays")

    def clamp_type(self) -> None:
        """Brand body size -> the size scale, then label 12-15px, detail 12px or more, caption 10px or more."""
        tk, ty, notes = self.tk, self.ty, self.notes
        if "family" in ty:
            tk["type"]["family"].update(ty["family"])
        for grp in ("leading", "tracking"):
            tk["type"][grp].update(ty.get(grp, {}))
        for name, st in ty.get("styles", {}).items():
            tk["type"]["styles"][name].update(st)
        sizes = {k: float(v[:-2]) for k, v in tk["type"]["size"].items()}
        f = min(max(ty.get("bodySize", 16) / 16, 0.9), 1.15)
        if f != 1:
            sizes = {k: round(v * f) for k, v in sizes.items()}
            notes.append(f"[DERIVE] type.size scale x {f:.3g} (brand body {ty['bodySize']:g}px against 16px, clamped to 0.9-1.15)")
        styles = tk["type"]["styles"]
        limits = {"label": (12, 15), "detail": (12, 99), "caption": (10, 99)}
        for style, (lo, hi) in limits.items():
            step = styles[style]["size"]
            if not lo <= sizes[step] <= hi:
                notes.append(f"[FIX] type.size.{step} {sizes[step]:g}px -> {min(max(sizes[step], lo), hi):g}px (the {style} style needs {lo}-{hi if hi < 99 else 'any'}px)")
                sizes[step] = min(max(sizes[step], lo), hi)
        keys = list(sizes)
        for a, b in zip(keys, keys[1:]):  # steps stay in order
            sizes[b] = max(sizes[b], sizes[a])
        tk["type"]["size"] = {k: f"{v:g}px" for k, v in sizes.items()}
        # type.fitMin is the shrink-to-fit floor and stays 11px: it is a readability floor, not a brand value

    # measure, contrast, colour-blindness ----------------------------------------------
    def measure(self, browser: Optional[str], enabled: bool) -> None:
        tk, notes = self.tk, self.notes
        if not enabled:
            notes.append("[WARN] font.metrics not measured (--offline or --no-measure): the default metrics stay, so labels set in a wider font may overflow")
            return
        from measure_font import measure
        try:
            got, loaded = measure(tk, browser)
        except (RuntimeError, OSError, StopIteration) as exc:
            notes.append(f"[WARN] font.metrics not measured ({exc}): the default metrics stay")
            return
        if not loaded:
            notes.append(f"[WARN] the font {tk['font']['family']!r} did not load in Chrome (not installed here, or font.href failed), so measuring would give the fallback's "
                         "widths. The default font.metrics stay: labels may overflow if the real font is wider. Run scripts/measure_font.py --theme <file> --write on "
                         "a machine that has the font.")
            return
        tk["font"]["metrics"] = got
        notes.append("[MAP] font.metrics = " + ", ".join(f"{k} {v}" for k, v in got.items()) + "  <- scripts/measure_font.py")

    def _rank(self, name: str) -> int:
        """Which side of a failing pair moves first: palette tones, then derived shades, then the brand's own, then the anchors."""
        return 0 if name.startswith("sw-") else 3 if name in ("bg-page", "bg-panel", "text-main", "node-bg") else 1 if name in (
            "banner-text", "banner-bg", "note-ink", "note-bg", "status-saved-text", "status-saved-bg", "status-unsaved-text", "status-unsaved-bg") else 2

    def fix_contrast(self) -> None:
        tk, stuck = self.tk, set()
        for _ in range(600):
            for mode in MODES:
                colors = resolve_colors(tk, mode)
                todo = None
                for fg, bg, mn in expand(tk["contrast"], tk["palette"]):
                    status, why, r = check(colors, fg, bg, mn)
                    if status == "SKIP":
                        raise ValueError(f"contrast pair {fg} on {bg} cannot be checked: {why}")
                    if status == "FAIL" and (mode, fg, bg) not in stuck:
                        todo = (fg, bg, mn, r)
                        break
                if todo:
                    if not self.move_for(mode, *todo):
                        stuck.add((mode, todo[0], todo[1]))
                        self.fixes.append(f"[FAIL] {mode} {todo[0]} on {todo[1]} stays at {todo[3]:.2f} (needs {todo[2]:g}): no lightness of either colour reaches it")
                    break
            else:
                return

    def move_for(self, mode: str, fg: str, bg: str, mn: float, before: float) -> bool:
        """Move one colour of a failing pair along OKLCH lightness (hue and chroma kept), away from the other colour, until it passes."""
        colors = resolve_colors(self.tk, mode)
        for name, other in sorted(((fg, bg), (bg, fg)), key=lambda p: self._rank(p[0])):
            if name == "bg-page":
                continue
            try:
                holder, key = self.locate(name, mode)
            except (KeyError, StopIteration):
                continue
            cur = holder[key]
            ref = parse_color(colors[other])
            if not is_hex(cur) or ref is None:
                continue
            if ref[3] < 1:
                ref = over(ref, parse_color(colors["bg-panel"]))
            L, C, H = to_oklch(cur)
            step = 0.004 if L >= to_oklch(rgb_to_hex(ref[:3]))[0] else -0.004
            for i in range(1, 250):
                if not 0 <= L + step * i <= 1:
                    break
                cand = from_oklch(L + step * i, C, H)
                status, _, r = check({**colors, name: cand}, fg, bg, mn)
                if status == "PASS":
                    holder[key] = cand
                    self.fixes.append(f"[FIX] {mode} {key}{'' if key == name else f' (as {name})'} {cur} -> {cand}  ({fg} on {bg}: {before:.2f} -> {r:.2f}, "
                                      f"needs {mn:g}; OKLCH lightness {L:.3f} -> {L + step * i:.3f}, hue and chroma kept)")
                    if key == "primary" and holder is self.tk["color"][mode] and "primary" in self.given[mode]:
                        self.derive_primary(quiet=True)  # hover, ring, glow, banner and on-primary follow the moved primary
                    return True
        return False

    def fix_edges(self) -> None:
        """edge-in and edge-out must stay apart for protanopia and deuteranopia (OKLab distance >= CVD_MIN) and keep 3:1 on the panel."""
        for mode in MODES:
            a, b = (resolve_colors(self.tk, mode)[k] for k in ("edge-in", "edge-out"))
            d = cvd_distance(a, b)
            if d >= CVD_MIN:
                continue
            panel = self.get("bg-panel", mode)
            holder, key = self.locate("edge-in", mode)
            L, C, H = to_oklch(a)
            for hue in (H, (to_oklch(b)[2] + 180) % 360):
                cand = next((c for c in (from_oklch(nl / 100, C, hue) for nl in sorted(range(25, 90), key=lambda x: abs(x / 100 - L)))
                             if cvd_distance(c, b) >= CVD_MIN and ratio(parse_color(c), parse_color(panel)) >= 3), None)
                if cand:
                    holder[key] = cand
                    self.put("edge-in-glow", mode, rgba(cand, 0.28 if mode == "light" else 0.35))
                    self.fixes.append(f"[FIX] {mode} edge-in {a} -> {cand}  (distance to edge-out {b} under protanopia/deuteranopia {d:.2f} -> {cvd_distance(cand, b):.2f}, "
                                      f"needs {CVD_MIN}; " + ("lightness only)" if hue == H else "hue turned to the opposite of edge-out, because no lightness was enough)"))
                    break
            else:
                self.fixes.append(f"[FAIL] {mode} edge-in {a} and edge-out {b} stay close for colour-blind viewers ({d:.2f} < {CVD_MIN})")

    def sparse(self) -> Dict[str, Any]:
        """The completed tokens minus everything equal to the default (palette and lists are kept whole when they differ)."""
        def diff(a: Any, b: Any) -> Any:
            if isinstance(a, dict) and isinstance(b, dict):
                out = {k: diff(v, b.get(k)) for k, v in a.items() if k not in b or v != b[k]}
                return {k: v for k, v in out.items() if v != {}}
            return a
        out = diff(self.tk, self.default)
        # a kept light value keeps its dark value too, so completing the file again sees both modes as given
        for k in out.get("color", {}).get("light", {}):
            if k in self.tk["color"]["dark"]:
                out["color"].setdefault("dark", {}).setdefault(k, self.tk["color"]["dark"][k])
        out["tokensVersion"], out["name"] = TOKENS_VERSION, self.tk["name"]
        return {k: out[k] for k in sorted(out, key=lambda k: (k not in ("tokensVersion", "name"), k))}


def complete_theme(partial: Dict[str, Any], notes: List[str], browser: Optional[str] = None, measure: bool = True) -> Dict[str, Any]:
    """Completed, validated theme (sparse: only keys that differ from the default). Appends the report lines to `notes`."""
    c = Completer(partial, notes)
    c.complete()
    c.measure(browser, measure)
    c.fix_contrast()
    c.fix_edges()
    notes.extend(c.fixes)
    if not c.fixes:
        notes.append("[OK] contrast: every pair already passes in light and dark; nothing moved")
    theme = c.sparse()
    final = merge_theme(theme, "the completed theme")
    colors = {m: resolve_colors(final, m) for m in MODES}
    bad = [(m, f, b) for m in MODES for f, b, mn in expand(final["contrast"], final["palette"]) if check(colors[m], f, b, mn)[0] != "PASS"]
    if bad:
        raise ValueError(f"completed theme still fails contrast: {bad[:3]}")
    notes.append(f"[OK] contrast: {sum(1 for m in MODES for _ in expand(final['contrast'], final['palette']))} pairs pass in light and dark")
    return theme


# --- command line ----------------------------------------------------------------------------------------------------

def preview(theme_path: Path, out_dir: Path, browser: Optional[str]) -> None:
    """One example per diagram type, laid out with the theme (scripts/layout_engine.py) and rendered to PNG."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for kind in ("flowchart", "sequence", "erd"):
        src = ROOT / "dev" / "examples" / f"example-{kind}.json"
        if not src.is_file():
            src = ROOT / "assets" / "types" / kind / "default.json"
        cmd = [sys.executable, str(Path(__file__).with_name("layout_engine.py")), "--layout", str(src),
               "--theme", str(theme_path), "-o", str(out_dir / f"{kind}.html"), "--screenshot", str(out_dir / f"{kind}.png")]
        if browser:
            cmd += ["--browser", browser]
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        print(f"[PREVIEW] {kind}: {out_dir / (kind + '.png')}" if p.returncode == 0 else f"[WARN] preview of {kind} failed (exit {p.returncode}): {p.stdout[-300:]}{p.stderr[-300:]}")


def self_test() -> None:
    close = lambda a, b, e=0.002: abs(a - b) < e  # noqa: E731
    assert to_oklab("#ffffff")[0] > 0.9999 and close(to_oklab("#000000")[0], 0)
    L, C, H = to_oklch("#ff0000")
    assert close(L, 0.628, 0.001) and close(C, 0.2577, 0.001) and close(H, 29.2, 0.2), (L, C, H)
    for h in ("#2563eb", "#0e7c66", "#f8fafc", "#fbbf24", "#123456", "#ffffff", "#000000"):
        assert ok_distance(h, from_oklab(*to_oklab(h))) < 1e-3 and from_oklab(*to_oklab(h)) == h, h
    assert close(to_oklch(with_lightness("#2563eb", 0.4))[0], 0.4) and close(to_oklch(with_lightness("#2563eb", 0.4))[2], to_oklch("#2563eb")[2], 1.5)
    assert from_oklch(0.9, 0.4, 150) and all(0 <= v <= 255 for v in hex_to_rgb(from_oklch(0.9, 0.4, 150))), "gamut mapping"
    assert mix("#000000", "#ffffff", 0) == "#000000" and mix("#000000", "#ffffff", 1) == "#ffffff"
    assert cvd_distance("#777777", "#777777") == 0 and cvd_distance("#ff0000", "#00aa00") < 0.2, "red and green blur for deuteranopia"
    assert cvd_distance("#b45309", "#2563eb") > CVD_MIN, "the default edge pair is distinguishable"
    assert norm_hex("rgb(37 99 235)") == "#2563eb"
    for bad in ("rgba(0,0,0,0.5)", "hsl(10 10% 10%)", "var(--x)"):
        try:
            norm_hex(bad)
            raise AssertionError(bad)
        except ValueError:
            pass
    assert families('"Space Grotesk", "Segoe UI", sans-serif') == ["Space Grotesk", "Segoe UI", "sans-serif"]
    assert named('"Evil; } body{x", Inter, sans-serif') == "Inter", "a family name that is not plain is dropped"
    assert named("system-ui, sans-serif") is None
    # completing a minimal brand: valid, passes contrast in both modes, keeps hue, derives dark
    notes: List[str] = []
    theme = complete_theme({"tokensVersion": 1, "name": "t", "color": {"light": {"primary": "#ffd400", "bg-page": "#fffaf0", "text-main": "#222222"}},
                            "brand": {"colors": ["#ffd400", "#7a1fa2"]}}, notes, measure=False)
    full = merge_theme(theme)
    assert full["name"] == "t" and len(full["palette"]) == 9 and full["palette"][0]["slot"] == "1"
    for m in MODES:
        cs = resolve_colors(full, m)
        assert all(check(cs, f, b, mn)[0] == "PASS" for f, b, mn in expand(full["contrast"], full["palette"])), m
        assert cvd_distance(cs["edge-in"], cs["edge-out"]) >= CVD_MIN, m
    assert any(n.startswith("[FIX]") and "primary" in n for n in notes), "a light yellow primary must have been darkened"
    assert abs(to_oklch(full["color"]["light"]["primary"])[2] - to_oklch("#ffd400")[2]) < 2, "hue kept"
    assert to_oklch(full["color"]["dark"]["bg-page"])[0] < 0.3, "dark background derived"
    # an untrusted value never gets through
    for evil in ({"color": {"light": {"primary": "red; } body { display:none"}}}, {"font": {"href": "https://evil.example/x.css"}},
                 {"font": {"family": "x'; } </style><script>"}}):
        try:
            complete_theme({"tokensVersion": 1, "name": "e", **evil}, [], measure=False)
        except ValueError:
            continue
        raise AssertionError(f"accepted {evil}")
    # type clamp: tiny and huge body sizes stay in range
    for body in (11, 22):
        t = merge_theme(complete_theme({"tokensVersion": 1, "name": "b", "_type": {"bodySize": body}}, [], measure=False))
        px = lambda style: float(t["type"]["size"][t["type"]["styles"][style]["size"]][:-2])  # noqa: E731
        assert 12 <= px("label") <= 15 and px("detail") >= 12 and px("caption") >= 10, (body, px("label"))
    # meaningful styling checks: blank/default-only inputs are rejected
    assert not has_meaningful_partial({"tokensVersion": 1, "name": "empty"})
    assert has_meaningful_partial({"tokensVersion": 1, "color": {"light": {"primary": "#0e7c66"}}})
    assert not has_meaningful_site_style({"visibleCount": 0}, {"color": {"light": {"bg-page": "#ffffff"}}})[0]
    assert not has_meaningful_site_style({"visibleCount": 5}, {"color": {"light": {"bg-page": "#ffffff"}}})[0]
    assert has_meaningful_site_style({"visibleCount": 5}, {"color": {"light": {"bg-page": "#111827"}}})[0]
    assert has_meaningful_site_style({"visibleCount": 5}, {"color": {"light": {"bg-page": "#ffffff", "primary": "#0e7c66"}}})[0]
    assert _raw_looks_weak({"visibleCount": 5, "canvas": [255, 255, 255], "fonts": {"body": "Mulish, sans-serif"}, "buttons": [], "vars": {}, "links": [], "surfaces": []})
    assert not _raw_looks_weak({"visibleCount": 5, "canvas": [255, 255, 255], "fonts": {"body": "Mulish, sans-serif"}, "buttons": [{"bg": [214, 0, 28]}], "vars": {}, "links": [], "surfaces": []})
    subs = brand_subpages({"navLinks": [
        {"href": "https://brand.example/guidelines/colour/", "label": "Colour <script>"},
        {"href": "https://brand.example/guidelines/typography/", "label": "Typography"},
        {"href": "https://brand.example/pricing/", "label": "Pricing"},
        {"href": "https://evil.example/colour/", "label": "Colour"},
        {"href": "javascript:alert(1)", "label": "Colour"},
    ]}, "https://brand.example/download/")
    assert subs == [("https://brand.example/guidelines/colour/", "Colour script"), ("https://brand.example/guidelines/typography/", "Typography")], subs
    print("[PASS] extract_tokens self-test")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", help="website to read (http, https or file address)")
    ap.add_argument("--from", dest="src", help="partial theme JSON (the brand-guide path)")
    ap.add_argument("--reset", action="store_true", help="remove saved theme.json and return to the default theme")
    ap.add_argument("--complete", action="store_true", help="fill, derive, measure and contrast-check the theme (always use it)")
    ap.add_argument("--out", help=f"output file (default {DEFAULT_OUT})")
    ap.add_argument("--preview", help="folder for one rendered example per diagram type")
    ap.add_argument("--capture", help="save a browser PNG screenshot of --url here (also saved automatically when no meaningful styling is extracted)")
    ap.add_argument("--browser", help="Chrome/Chromium path")
    ap.add_argument("--offline", action="store_true", help="no Google Fonts lookup and no font download (font.metrics is not measured)")
    ap.add_argument("--no-measure", action="store_true", help="skip scripts/measure_font.py")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    if a.self_test:
        self_test()
        return 0
    if a.reset:
        if a.url or a.src:
            ap.error("--reset cannot be combined with --url or --from")
        targets = [Path(a.out)] if a.out else [DEFAULT_OUT, Path(".ultimate-diagram") / "theme.json"]
        removed: List[str] = []
        for p in targets:
            if p.is_file():
                p.unlink()
                removed.append(str(p))
        if removed:
            print(f"[OK] Reset to default theme (removed: {', '.join(removed)}).")
        else:
            print("[NOTE] Already using the default theme (no theme.json found).")
        return 0
    if bool(a.url) == bool(a.src):
        ap.error("give exactly one of --url and --from (or use --reset)")
    notes: List[str] = []
    captured: Optional[Path] = None
    try:
        if a.url:
            name = re.sub(r"[^a-z0-9-]+", "-", (urlparse(a.url).hostname or Path(urlparse(a.url).path).stem or "site").lower()).strip("-") or "site"
            capture_explicit = Path(a.capture) if a.capture else None
            capture_weak = capture_explicit or (Path(a.preview) / "site-capture.png" if a.preview else Path(tempfile.gettempdir()) / f"ultimate-diagram-capture-{name}.png")
            raw, captured = collect_site(a.url, a.browser, capture_explicit, capture_weak)
            partial = site_to_partial(raw, name, not a.offline, notes)
            ok, why = has_meaningful_site_style(raw, partial)
            if not ok:
                raise ExtractionEmptyError(why, captured)
        else:
            partial = json.loads(Path(a.src).read_text(encoding="utf-8"))
            if not has_meaningful_partial(partial):
                raise ExtractionEmptyError(f"no styling keys found in {a.src}")
            partial.setdefault("tokensVersion", TOKENS_VERSION)
            notes.append(f"[MAP] the theme keys come from {a.src}")
        if a.complete:
            theme = complete_theme(partial, notes, a.browser, not (a.offline or a.no_measure))
        else:
            theme = {k: v for k, v in partial.items() if not k.startswith("_") and k != "brand"}
            merge_theme(theme, "the extracted theme")
            notes.append("[WARN] not completed: run again with --complete (derived shades, dark set, palette, measured font, contrast check)")
    except ExtractionEmptyError as exc:
        if notes:
            print("\n".join(notes))
        print(f"[WARN] No meaningful brand styling extracted: {exc.reason}")
        print(format_suggestions(exc.capture))
        return 2
    except (ValueError, RuntimeError, OSError, json.JSONDecodeError) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1
    out = Path(a.out) if a.out else DEFAULT_OUT
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(theme, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("\n".join(notes))
    if captured:
        print(f"[CAPTURE] {captured}")
    print(f"[OK] theme {theme['name']!r} written to {out}")
    if a.preview:
        preview(out, Path(a.preview), a.browser)
    return 0


if __name__ == "__main__":
    sys.exit(main())
