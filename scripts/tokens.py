#!/usr/bin/env python3
"""Design tokens: load assets/tokens/default.json (plus an optional theme), validate it, and turn it into the CSS
and JS that assemble_page() writes into the page. Standard library only."""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any, Dict, Optional

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "assets" / "tokens" / "default.json"
ICONS_DIR = DEFAULT_PATH.parent.parent / "icons"
TOKENS_VERSION = 1

_FUNCS = {"rgb", "rgba", "hsl", "hsla", "oklch", "var", "color-mix"}
_COLOR_CHARS = re.compile(r"^[A-Za-z0-9#%.,() \-]+$")
_LENGTH = re.compile(r"^-?\d+(\.\d+)?(px|rem|em|%)?$")
_TRACKING = re.compile(r"^(0|-?\d+(\.\d+)?(em|px))$")
_KEY = re.compile(r"^[\w-]+$")
_RADIUS = re.compile(r"^\d+(\.\d+)?(px|rem|em|%)?( \d+(\.\d+)?(px|rem|em|%)?){0,3}$")
_VAR = re.compile(r"var\(--([\w-]+)\)")
_DUR = r"\d+(?:\.\d+)?m?s"
_NUM = r"-?\d+(?:\.\d+)?"
_CURVE = (
    rf"(?:linear|ease(?:-in(?:-out)?|-out)?|step-(?:start|end)"
    rf"|cubic-bezier\(\s*{_NUM}\s*,\s*{_NUM}\s*,\s*{_NUM}\s*,\s*{_NUM}\s*\)"
    rf"|linear\(\s*{_NUM}(?:\s+\d+(?:\.\d+)?%){{0,2}}(?:\s*,\s*{_NUM}(?:\s+\d+(?:\.\d+)?%){{0,2}})*\s*\))"
)
_TIME = re.compile(rf"^(?:{_DUR}|{_CURVE}|{_DUR}\s+{_CURVE})$")
# palette tone -> role name: soft is the fill, strong the line; the rest are named as their role
_TONES = {"soft": "fill", "strong": "line", "ink": "ink", "solid": "solid", "on-solid": "on-solid"}
_NAME = re.compile(r"^[\w][\w .-]*$")
_FONT_STACK = re.compile(r"""^[\w "',.\-]+$""")
_HREF = re.compile(r"^https://fonts\.googleapis\.com/[\w:/.?=&@,+;%-]*$")


def _is_color(v: str) -> bool:
    if not _COLOR_CHARS.match(v):
        return False
    if v.startswith("#"):
        return re.fullmatch(r"#[0-9a-fA-F]{3,8}", v) is not None
    # every identifier followed by "(" must be an allowed colour function, parentheses must balance
    if any(f not in _FUNCS for f in re.findall(r"([A-Za-z-]+)\(", v)):
        return False
    depth = 0
    for c in v:
        depth += (c == "(") - (c == ")")
        if depth < 0:
            return False
    return depth == 0


def _is_value(v: Any) -> bool:
    """A colour, a length or percentage, or a bare number (the leaf types of color and size tokens)."""
    return isinstance(v, str) and (_is_color(v) or _LENGTH.match(v) is not None or v == "transparent")


def _is_shadow(v: Any) -> bool:
    """One or more comma-separated layers; each token is `inset`, a length or a colour. Nothing else gets through."""
    if not isinstance(v, str) or not _COLOR_CHARS.match(v):
        return False
    layers, depth, cur = [], 0, ""
    for c in v:
        depth += (c == "(") - (c == ")")
        if c == "," and depth == 0:
            layers.append(cur); cur = ""
        else:
            cur += c
    layers.append(cur)
    for layer in layers:
        toks, depth, cur = [], 0, ""
        for c in layer.strip():
            depth += (c == "(") - (c == ")")
            if c == " " and depth == 0:
                toks.append(cur); cur = ""
            else:
                cur += c
        toks.append(cur)
        if not 2 <= len([t for t in toks if t not in ("", "inset")]) <= 5 or not all(
                t in ("", "inset") or _LENGTH.match(t) or _is_color(t) for t in toks):
            return False
    return True


def _err(path: str, v: Any) -> ValueError:
    return ValueError(f"tokens: invalid value at {path}: {v!r}")


_OPACITY = re.compile(r"(0?\.\d+|0|1)")                          # effect.dim, effect.dim-line
_FILTER = re.compile(r"grayscale\((0?\.\d+|0|1)\)")              # effect.dim-filter
_DASH = re.compile(r"\d+(\.\d+)?( \d+(\.\d+)?)*")                  # effect.dash: a stroke-dasharray in px


def _mix(a: str, b: str, p: float) -> Optional[str]:
    """CSS color-mix(in srgb, a p, b) of two #rrggbb colours; None if either is not plain hex."""
    if not (re.fullmatch(r"#[0-9a-fA-F]{6}", a or "") and re.fullmatch(r"#[0-9a-fA-F]{6}", b or "")):
        return None
    ch = [round(int(a[i:i + 2], 16) * p + int(b[i:i + 2], 16) * (1 - p)) for i in (1, 3, 5)]
    return "#" + "".join(f"{c:02x}" for c in ch)


def _validate(t: Dict[str, Any]) -> None:
    if t.get("tokensVersion") != TOKENS_VERSION:
        raise ValueError(f"tokens: unsupported tokensVersion {t.get('tokensVersion')!r}; expected {TOKENS_VERSION}")
    if not isinstance(t.get("name"), str) or not _NAME.match(t["name"]):
        raise _err("name", t.get("name"))
    f = t["font"]
    if not _NAME.match(f["family"]): raise _err("font.family", f["family"])
    if not _FONT_STACK.match(f["stack"]): raise _err("font.stack", f["stack"])
    if f["href"] and not _HREF.match(f["href"]): raise _err("font.href", f["href"])
    for k, v in f["metrics"].items():
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not 1 <= v <= 30: raise _err(f"font.metrics.{k}", v)
    for k, v in t["size"].items():
        if not (isinstance(v, str) and _LENGTH.match(v)): raise _err(f"size.{k}", v)
    for k, v in t["space"].items():  # spacing scale: key = px, value a length ("0", "4px", ...)
        if not re.fullmatch(r"\d+", k) or not (isinstance(v, str) and _LENGTH.match(v)): raise _err(f"space.{k}", v)
    # interaction and control sizes: a length, or var(--x) naming a size, space, or shadow token
    refs = set(t["size"]) | {f"space-{k}" for k in t["space"]} | {f"shadow-{k}" for k in t["shadow"]}
    for group in ("interaction", "control"):
        for k, v in t.get(group, {}).items():
            ref = re.fullmatch(r"var\(--([\w-]+)\)", v) if isinstance(v, str) else None
            if not _KEY.match(k) or not (isinstance(v, str) and (_LENGTH.match(v) or (ref and ref[1] in refs))): raise _err(f"{group}.{k}", v)
    for k, v in t["primitive"].items():  # raw colour shades the semantic colours point at; plain hex only
        if not _KEY.match(k) or not (isinstance(v, str) and re.fullmatch(r"#[0-9a-fA-F]{3,8}", v)): raise _err(f"primitive.{k}", v)
    for k, v in t["c4"].items():  # c4 layout sizes in px, read by assets/types/c4/engine.js
        if not _KEY.match(k) or isinstance(v, bool) or not isinstance(v, int) or not 1 <= v <= 2000: raise _err(f"c4.{k}", v)
    _validate_type(t["type"])
    _validate_icon(t["icon"])
    for k, v in t.get("effect", {}).items():
        ok = {"dim": _OPACITY, "dim-line": _OPACITY, "dim-filter": _FILTER, "dash": _DASH}.get(k)
        if not ok or not (isinstance(v, str) and ok.match(v)): raise _err(f"effect.{k}", v)
    for k, v in t["motion"].items():
        if not _KEY.match(k) or not (isinstance(v, str) and _TIME.match(v)): raise _err(f"motion.{k}", v)
    for k, v in t["radius"].items():
        if not _KEY.match(k) or not (isinstance(v, str) and _RADIUS.match(v)): raise _err(f"radius.{k}", v)
    for k, v in t["shadow"].items():
        # var(--x) in a shadow must name a colour token, so a typo cannot silently drop the shadow
        if not re.fullmatch(r"[\w-]+", k) or not _is_shadow(v) or not set(_VAR.findall(v)) <= t["color"]["light"].keys():
            raise _err(f"shadow.{k}", v)
    for s in t["palette"]:
        if not (isinstance(s.get("slot"), str) and _NAME.match(s["slot"]) and _NAME.match(s.get("name", ""))):
            raise _err("palette", s)
        if "hex" in s and not (isinstance(s["hex"], str) and _is_color(s["hex"])): raise _err(f"palette.{s['slot']}.hex", s["hex"])
        for mode in ("light", "dark"):
            for tone, v in s[mode].items():
                if tone not in _TONES or not _is_value(v): raise _err(f"palette.{s['slot']}.{mode}.{tone}", v)
    if not isinstance(t["contrast"], list): raise _err("contrast", t["contrast"])
    # contrastOver: [fg, translucent bg, min, backdrop]; the bg is composited over the backdrop colour (a name; `*` = every palette slot)
    for row in t.get("contrastOver", []):
        if not (isinstance(row, list) and len(row) == 4 and all(isinstance(x, str) and re.fullmatch(r"[\w*-]+", x) for x in (row[0], row[1], row[3]))
                and isinstance(row[2], (int, float)) and not isinstance(row[2], bool)): raise _err("contrastOver", row)
    for mode in ("light", "dark"):
        for k, v in t["color"][mode].items():
            if not re.fullmatch(r"[\w-]+", k) or not _is_value(v): raise _err(f"color.{mode}.{k}", v)


def _validate_icon(ic: Dict[str, Any]) -> None:
    """icon: set (a registry file name in assets/icons), size (name -> px), stroke widths, cap and join."""
    def num(v: Any, lo: float, hi: float) -> bool:
        return isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi

    if not (isinstance(ic["set"], str) and _KEY.match(ic["set"])): raise _err("icon.set", ic["set"])
    for k, v in ic["size"].items():
        if not _KEY.match(k) or not num(v, 4, 128): raise _err(f"icon.size.{k}", v)
    for k in ("stroke", "strokeFine", "strokeBold"):
        if not num(ic[k], 1.5, 2.5): raise _err(f"icon.{k}", ic[k])
    if ic["cap"] not in ("round", "butt", "square"): raise _err("icon.cap", ic["cap"])
    if ic["join"] not in ("round", "miter", "bevel"): raise _err("icon.join", ic["join"])


def _validate_type(ty: Dict[str, Any]) -> None:
    def num(v: Any) -> bool:
        return isinstance(v, (int, float)) and not isinstance(v, bool)

    for k, v in ty["family"].items():
        if not _KEY.match(k) or not (v == "font.family" or (isinstance(v, str) and _FONT_STACK.match(v))): raise _err(f"type.family.{k}", v)
    for group in ("size", "lineBox"):
        for k, v in ty[group].items():
            if not _KEY.match(k) or not (isinstance(v, str) and _LENGTH.match(v)): raise _err(f"type.{group}.{k}", v)
    for k, v in ty["weight"].items():
        if not _KEY.match(k) or not (num(v) and 100 <= v <= 900): raise _err(f"type.weight.{k}", v)
    for k, v in ty["leading"].items():
        if not _KEY.match(k) or not (num(v) and 0 < v <= 3): raise _err(f"type.leading.{k}", v)
    for k, v in ty["tracking"].items():
        if not _KEY.match(k) or not (isinstance(v, str) and _TRACKING.match(v)): raise _err(f"type.tracking.{k}", v)
    for k in ("fitMin", "fitMinOverview"):
        if not (isinstance(ty[k], str) and re.fullmatch(r"\d+(\.\d+)?px", ty[k])): raise _err(f"type.{k}", ty[k])
    for name, st in ty["styles"].items():
        if not _KEY.match(name) or not {"family", "size", "weight"} <= st.keys(): raise _err(f"type.styles.{name}", st)
        for prop in ("family", "size", "weight", "leading", "tracking"):
            if prop in st and st[prop] not in ty[prop]: raise _err(f"type.styles.{name}.{prop}", st[prop])


# An icon is either a 24 x 24 stroke drawing (str) or a filled/duotone drawing ({"vb": viewBox, "body": inner markup}):
# self-closing shape elements with a short list of attributes, nothing else, so a brand's icon file can never carry a script, a style or a link into the page
_ICON_ATTR = r'(?:d|cx|cy|r|rx|ry|x|y|x1|y1|x2|y2|width|height|points|stroke-dasharray|class)="[\w .,\-]*"|(?:fill|stroke)="(?:none|currentColor)"|opacity="(?:0?\.\d+|0|1)"|fill-rule="(?:evenodd|nonzero)"'
_ICON_MARKUP = re.compile(rf'(?:<(?:path|circle|rect|line|polyline|polygon|ellipse)(?: (?:{_ICON_ATTR}))*/>)+')
_ICON_VB = re.compile(r"^\d+ \d+ \d+ \d+$")


def _read_registry(path: Path) -> Dict[str, Any]:
    """One icon file ({"_license": ..., "icons": {name: str | {"vb": ..., "body": ...}}}), validated; nothing else is read from it."""
    icons = json.loads(path.read_text(encoding="utf-8"))["icons"]
    for name, entry in icons.items():
        if not _KEY.match(name):
            raise ValueError(f"icons: invalid icon {name!r} in {path.name}")
        if isinstance(entry, str):
            if not _ICON_MARKUP.fullmatch(entry):
                raise ValueError(f"icons: invalid icon {name!r} in {path.name}")
        elif isinstance(entry, dict):
            if set(entry.keys()) != {"vb", "body"} or not isinstance(entry["vb"], str) or not _ICON_VB.fullmatch(entry["vb"]) or not isinstance(entry["body"], str) or not _ICON_MARKUP.fullmatch(entry["body"]):
                raise ValueError(f"icons: invalid icon {name!r} in {path.name}")
        else:
            raise ValueError(f"icons: invalid icon {name!r} in {path.name}")
    return icons


def load_icons(tokens: Dict[str, Any]) -> Dict[str, Any]:
    """The icon registry of tokens["icon"]["set"]. A name that set lacks falls back to the default set, so no icon disappears."""
    icons = _read_registry(ICONS_DIR / "default.json")
    if tokens["icon"]["set"] != "default":
        icons.update(_read_registry(ICONS_DIR / f"{tokens['icon']['set']}.json"))
    return icons


def icon_svg(tokens: Dict[str, Any], icons: Dict[str, Any], name: str, size: str = "md", mods: tuple = ()) -> str:
    """The <svg> for icon `name`: size is a token name (icon.size) or a px number; mods may hold "fine" or "bold" (the stroke widths).
    ui.icon() in shell.js builds the same text at run time."""
    ic = tokens["icon"]
    if name not in icons:
        raise KeyError(f"unknown icon {name!r}")
    px = ic["size"][size] if size in ic["size"] else int(size)
    entry = icons[name]
    if isinstance(entry, dict):
        return f'<svg width="{px}" height="{px}" viewBox="{entry["vb"]}" fill="currentColor" aria-hidden="true">{entry["body"]}</svg>'
    stroke = ic["strokeBold"] if "bold" in mods else ic["strokeFine"] if "fine" in mods else ic["stroke"]
    return (f'<svg width="{px}" height="{px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{stroke}" '
            f'stroke-linecap="{ic["cap"]}" stroke-linejoin="{ic["join"]}" aria-hidden="true">{entry}</svg>')


def logo_svg(tokens: Dict[str, Any], logos: Dict[str, Dict[str, str]], name: str, size: str = "tile") -> str:
    """The <svg> for logo `name` ("<pack>/<icon>", an entry of a local icon pack): filled, in its own colours, at its own aspect
    ratio (the viewBox) inside a size x size box. ui.logo() in shell.js builds the same text at run time."""
    px = tokens["icon"]["size"][size] if size in tokens["icon"]["size"] else int(size)
    if name not in logos:
        raise KeyError(f"unknown logo {name!r}")
    return f'<svg width="{px}" height="{px}" viewBox="{logos[name]["vb"]}" aria-hidden="true">{logos[name]["body"]}</svg>'


_ICON_PLACEHOLDER = re.compile(r"\{\{icon:([\w-]+)(?::(\w+))?(?::(fine|bold))?\}\}")


def expand_icons(text: str, tokens: Dict[str, Any], icons: Dict[str, str]) -> str:
    """Replace {{icon:name}}, {{icon:name:size}} and {{icon:name:size:fine|bold}} in an HTML template by the icon's <svg>."""
    return _ICON_PLACEHOLDER.sub(lambda m: icon_svg(tokens, icons, m[1], m[2] or "md", (m[3],) if m[3] else ()), text)


def _merge(base: Dict[str, Any], over: Dict[str, Any]) -> Dict[str, Any]:
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _merge(base[k], v)
        else:
            base[k] = copy.deepcopy(v)
    return base


def _expand_primitives(tokens: Dict[str, Any]) -> None:
    """Replace a colour that is exactly var(--<primitive>) by the primitive's hex, so everything downstream (resolve_colors, the CSS,
    scripts/extract_tokens.py) sees plain colours and a theme can override a primitive or any semantic colour with its own hex."""
    prim = tokens.get("primitive")
    if not isinstance(prim, dict):
        return
    for mode in ("light", "dark"):
        for k, v in tokens["color"][mode].items():
            m = re.fullmatch(r"var\(--([\w-]+)\)", v) if isinstance(v, str) else None
            if m and m[1] in prim:
                tokens["color"][mode][k] = prim[m[1]]


def merge_theme(theme: Optional[Dict[str, Any]], source: str = "theme") -> Dict[str, Any]:
    """default.json with a parsed theme deep-merged over it (lists, such as palette, are replaced whole), validated."""
    tokens = json.loads(DEFAULT_PATH.read_text(encoding="utf-8"))
    if theme is not None:
        if not isinstance(theme, dict) or theme.get("tokensVersion") != TOKENS_VERSION:
            raise ValueError(f"tokens: unsupported tokensVersion {theme.get('tokensVersion') if isinstance(theme, dict) else theme!r} in {source}")
        _merge(tokens, theme)
    _expand_primitives(tokens)
    _validate(tokens)
    return tokens


def load_tokens(theme_path: Optional[Path] = None) -> Dict[str, Any]:
    """default.json with an optional theme file deep-merged over it."""
    return merge_theme(None if theme_path is None else json.loads(Path(theme_path).read_text(encoding="utf-8")), str(theme_path))


def resolve_colors(tokens: Dict[str, Any], mode: str) -> Dict[str, str]:
    """Every colour token for `mode` ("light" or "dark"), `var(--x)` replaced by x's value; color-mix() kept as is."""
    if mode not in ("light", "dark"):
        raise ValueError(f"mode must be 'light' or 'dark', not {mode!r}")
    merged = {**tokens["color"]["light"], **(tokens["color"]["dark"] if mode == "dark" else {})}
    merged.update(_sw_vars(tokens, mode))

    def resolve(name: str, seen: tuple) -> str:
        if name in seen:
            raise ValueError(f"tokens: var() cycle through {name}")
        v = merged[name]
        m = re.fullmatch(r"var\(--([\w-]+)\)", v)
        return resolve(m[1], seen + (name,)) if m else v

    return {k: resolve(k, ()) for k in merged}


def _sw_vars(tokens: Dict[str, Any], mode: str, only_mode: bool = False) -> Dict[str, str]:
    """sw-<slot>-<role> for every palette slot. Dark falls back to light for a role it leaves out, unless only_mode."""
    out = {}
    colors = {**tokens["color"]["light"], **(tokens["color"]["dark"] if mode == "dark" else {})}
    bg = colors.get("node-bg", "")
    for _ in range(4):   # node-bg may be var(--x)
        m = re.fullmatch(r"var\(--([\w-]+)\)", bg)
        if not m: break
        bg = colors.get(m[1], "")
    for s in tokens["palette"]:
        tones = {**({} if only_mode else s["light"]), **s[mode]}
        out.update({f"sw-{s['slot']}-{_TONES[t]}": v for t, v in tones.items()})
        # tint: the fill lightened toward node-bg (60 % fill), a quieter surface for a filled shape; derived, so every
        # theme has it and the contrast pairs can name it (sw-*-ink on sw-*-tint)
        fill = {**s["light"], **s[mode]}.get("soft", "")
        tint = _mix(fill, bg, 0.6)
        if tint: out[f"sw-{s['slot']}-tint"] = tint
        # disc: a solid, saturated surface for a glyph (the c4 icon disc). Light: the slot's solid role. Dark: the line colour
        # mixed swatch-disc-mix into swatch-disc-base, the glyph swatch-disc-ink (the solid role is a pastel there, made for a dark glyph)
        full = {**s["light"], **s[mode]}
        if mode == "light":
            disc, on = full.get("solid"), full.get("on-solid")
        else:
            disc = _mix(full.get("strong", ""), colors.get("swatch-disc-base", ""), float(colors.get("swatch-disc-mix", "0%").rstrip("%")) / 100)
            on = colors.get("swatch-disc-ink")
        if disc and on: out[f"sw-{s['slot']}-disc"], out[f"sw-{s['slot']}-on-disc"] = disc, on
    return out


def _block(selector: str, decls: Dict[str, str], scheme: str) -> str:
    lines = [f"      --{k}: {v};" for k, v in decls.items()] + [f"      color-scheme: {scheme};"]
    return f"    {selector} {{\n" + "\n".join(lines) + "\n    }"


def _type_vars(tokens: Dict[str, Any]) -> Dict[str, str]:
    """--font-ui|diagram|mono, the --text/--text-rem/--weight/--leading/--line/--tracking scales and --t-<style>-* for every text style."""
    f, ty = tokens["font"], tokens["type"]
    out = {f"font-{k}": f'"{f["family"]}", {f["stack"]}' if v == "font.family" else v for k, v in ty["family"].items()}
    for var, group in (("text", "size"), ("weight", "weight"), ("leading", "leading"), ("line", "lineBox"), ("tracking", "tracking")):
        out.update({f"{var}-{k}": str(v) for k, v in ty[group].items()})
    for k, v in ty["size"].items():
        if isinstance(v, str) and v.endswith("px"):
            out[f"text-rem-{k}"] = f"{float(v[:-2]) / 16:g}rem"
    for name, st in ty["styles"].items():
        out.update({f"t-{name}-family": f"var(--font-{st['family']})", f"t-{name}-size": f"var(--text-{st['size']})",
                    f"t-{name}-rem-size": f"var(--text-rem-{st['size']})",
                    f"t-{name}-weight": f"var(--weight-{st['weight']})",
                    f"t-{name}-leading": f"var(--leading-{st.get('leading', 'normal')})",
                    f"t-{name}-tracking": f"var(--tracking-{st.get('tracking', 'normal')})"})
    return out


def _type_classes(tokens: Dict[str, Any]) -> str:
    return "\n".join(
        f"    .t-{n} {{ font-family: var(--t-{n}-family); font-size: var(--t-{n}-size); font-weight: var(--t-{n}-weight); "
        f"line-height: var(--t-{n}-leading); letter-spacing: var(--t-{n}-tracking); }}" for n in tokens["type"]["styles"])


def tokens_css(tokens: Dict[str, Any]) -> str:
    """The :root (light) and :root[data-theme="dark"] blocks. Dark lists only what it overrides; the cascade does the rest."""
    light = {**_type_vars(tokens),
             **{f"icon-{k}": f"{v}px" for k, v in tokens["icon"]["size"].items()},
             "c4-label-max-w": f"{tokens['c4']['labelMaxW']}px",
             **tokens["size"], **{f"space-{k}": v for k, v in tokens["space"].items()}, **tokens["interaction"], **tokens.get("control", {}), **tokens.get("effect", {}), **tokens["motion"], **{f"radius-{k}": v for k, v in tokens["radius"].items()},
             **{f"shadow-{k}": v for k, v in tokens["shadow"].items()},
             **tokens["color"]["light"], **_sw_vars(tokens, "light")}
    dark = {**tokens["color"]["dark"], **_sw_vars(tokens, "dark", True)}
    # A slot's roles feed the roles shell.css and the types read (--sw-pill-bg, ...); an element without data-sw keeps the run-time derivation.
    slots = "\n".join(
        f'    [data-sw="{s["slot"]}"] {{ --sw-stripe: var(--sw-{s["slot"]}-line); --sw-line: var(--sw-{s["slot"]}-line); '
        f'--sw-pill-bg: var(--sw-{s["slot"]}-fill); --sw-pill-ink: var(--sw-{s["slot"]}-ink); '
        f'--sw-pill-solid: var(--sw-{s["slot"]}-solid); --sw-on-solid: var(--sw-{s["slot"]}-on-solid); '
        f'--sw-tint: var(--sw-{s["slot"]}-tint); '
        f'--sw-disc: var(--sw-{s["slot"]}-disc); --sw-on-disc: var(--sw-{s["slot"]}-on-disc); }}'
        for s in tokens["palette"])
    return (_block(":root", light, "light") + "\n\n" + _block(':root[data-theme="dark"]', dark, "dark") + "\n\n" + slots
            + "\n\n" + _type_classes(tokens))


def tokens_data(tokens: Dict[str, Any]) -> Dict[str, Any]:
    """The part of the tokens the JS reads: the page, the ERD worker and scripts/run_engine.mjs all get exactly this as TOKENS."""
    return {"palette": tokens["palette"], "font": {"metrics": tokens["font"]["metrics"]}, "motion": tokens["motion"],
            "type": {k: tokens["type"][k] for k in ("fitMin", "fitMinOverview")}, "icon": tokens["icon"],
            "c4": tokens["c4"]}


def tokens_js(tokens: Dict[str, Any], logos: Optional[Dict[str, Dict[str, str]]] = None) -> str:
    # ICONS: the registry (name -> inner SVG) for ui.icon() and every type. LOGOS: the local-pack entries the diagram
    # uses ("<pack>/<icon>" -> {vb, body}) for ui.logo(); None omits the line, while {} emits an empty map for online picker types.
    text = (f"const TOKENS = {json.dumps(tokens_data(tokens), separators=(',', ':'))};\n"
            f"const ICONS = {json.dumps(load_icons(tokens), separators=(',', ':'))};")
    if logos is not None:
        text += f"\nconst LOGOS = {json.dumps(logos, separators=(',', ':'), sort_keys=True).replace('<', chr(92) + 'u003c')};"
    return text


if __name__ == "__main__":
    import tempfile
    t = load_tokens()
    assert t["tokensVersion"] == 1 and len(t["palette"]) == 9
    d, l = resolve_colors(t, "dark"), resolve_colors(t, "light")
    assert d["bg-page"] == "#1d2028" and l["bg-page"] == "#f8fafc"
    assert d["warning"] == l["warning"], "dark falls back to light"
    assert all(not v.startswith("var(") for v in [*d.values(), *l.values()])
    css = tokens_css(t)
    assert "--primary: #2563eb;" in css and tokens_js(t).startswith("const TOKENS = {")
    assert '"fitMin":"11px"' in tokens_js(t) and '"fitMinOverview":"9px"' in tokens_js(t)
    for want in ("--font-ui: \"Nunito Sans\", ", "--font-mono: ui-monospace", "--text-md: 13px;", "--text-rem-sm: 0.75rem;", "--weight-bold: 700;", "--leading-tight: 1.2;",
                 "--tracking-caps: 0.04em;", "--t-label-size: var(--text-md);", "--t-body-rem-size: var(--text-rem-lg);", "--t-overline-tracking: var(--tracking-caps);",
                 "--t-code-family: var(--font-mono);", "--radius-lg: 8px;", "--radius-pill: 999px;", "--radius-round: 50%;",
                 "--shadow-ring: 0 0 0 3px var(--primary-ring);", "--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.12);", ".t-control { font-family: var(--t-control-family);"):
        assert want in css, want

    def theme(obj: Dict[str, Any]) -> Path:
        p = Path(tempfile.mkdtemp()) / "theme.json"
        p.write_text(json.dumps({"tokensVersion": 1, **obj}))
        return p

    m = load_tokens(theme({"name": "x", "color": {"light": {"primary": "#ff0000", "primary-hover": "var(--primary)"}}}))
    assert m["name"] == "x" and m["color"]["light"]["primary"] == "#ff0000"
    assert m["color"]["light"]["bg-page"] == "#f8fafc", "merge keeps untouched keys"
    assert resolve_colors(m, "light")["primary-hover"] == "#ff0000", "var() resolves"
    assert load_tokens(theme({"radius": {"md": "3px 8px 8px 3px"}}))["radius"]["md"] == "3px 8px 8px 3px", "shorthand radius"
    assert load_tokens(theme({"motion": {"dur-x": "120ms", "curve-x": "cubic-bezier(0.2, 0, 0, 1)", "spring-x": "linear(0, 0.5 50%, 1)"}}))["motion"]["dur-x"] == "120ms"
    for bad in ({"motion": {"x": "100ms; } a{b}"}}, {"motion": {"x": "cubic-bezier(1, 2)"}}, {"motion": {"x": "linear()"}},
                {"color": {"light": {"primary": "url(javascript:alert(1))"}}},
                {"color": {"light": {"primary": "red; } body { display:none"}}},
                {"font": {"stack": "a; } </style><script>"}},
                {"font": {"href": "https://evil.example/x.css"}},
                {"type": {"weight": {"bold": 1000}}}, {"type": {"weight": {"bold": "700"}}}, {"type": {"leading": {"tight": "1.2"}}},
                {"type": {"leading": {"tight": 0}}}, {"type": {"tracking": {"caps": "4%"}}}, {"type": {"tracking": {"caps": "1em; x"}}},
                {"radius": {"md": "8px; } body { x"}}, {"radius": {"md": "-4px"}}, {"radius": {"md": "1px 2px 3px 4px 5px"}},
                {"shadow": {"ring": "0 0 0 3px var(--nope)"}}, {"shadow": {"x": "0 0 1px red; } a { b"}}, {"shadow": {"x": "0 0 1px url(x)"}},
                {"type": {"size": {"md": "big"}}}, {"type": {"fitMin": "9"}}, {"type": {"family": {"mono": "a; } x"}}},
                {"type": {"styles": {"label": {"family": "ui", "size": "huge", "weight": "bold"}}}}):
        try:
            load_tokens(theme(bad))
        except ValueError:
            continue
        raise AssertionError(f"accepted {bad}")
    try:
        load_tokens(Path(tempfile.mkdtemp()) / "none.json")
    except FileNotFoundError:
        pass
    assert load_tokens(theme({"icon": {"set": "lucide", "stroke": 1.5}}))["icon"]["stroke"] == 1.5
    # primitives: semantic colours point at them, resolve to plain hex; a theme may retint one or override a semantic colour
    assert t["color"]["light"]["bg-hover"] == "#f1f5f9" and t["primitive"]["slate-100"] == "#f1f5f9", "primitive refs expand to hex"
    assert load_tokens(theme({"primitive": {"slate-100": "#eeeeee"}}))["color"]["light"]["bg-hover"] == "#eeeeee", "retinted primitive flows through"
    assert load_tokens(theme({"color": {"light": {"bg-hover": "#123456"}}}))["color"]["light"]["bg-hover"] == "#123456", "hex over a primitive ref"
    for want in ("--space-0: 0;", "--space-4: 4px;", "--space-48: 48px;", "--hit-min: 24px;", "--select-ring-w: var(--ring-md);", "--hover-shadow: var(--shadow-md);",
                 "--chevron-size: 22px;", "--port-size: 12px;", "--port-size-touch: 20px;"):
        assert want in css, want
    for bad in ({"primitive": {"x": "red"}}, {"primitive": {"x": "#12345g"}}, {"primitive": {"x": "var(--y)"}}, {"primitive": {"a b": "#fff"}},
                {"space": {"4": "4px; } a {"}}, {"space": {"x": "4px"}}, {"space": {"4": "wide"}},
                {"interaction": {"hit-min": "big"}}, {"interaction": {"hover-shadow": "var(--nope)"}}, {"interaction": {"x": "red; } a {"}}):
        try:
            load_tokens(theme(bad))
        except ValueError:
            continue
        raise AssertionError(f"accepted {bad}")
    for bad in ({"icon": {"set": "A b"}}, {"icon": {"set": "x/../y"}}, {"icon": {"stroke": 3}}, {"icon": {"stroke": "2"}}):
        try:
            load_tokens(theme(bad))
        except ValueError:
            continue
        raise AssertionError(f"accepted {bad}")
    p = theme({}); p.write_text('{"tokensVersion": 2}')
    try:
        load_tokens(p)
        raise AssertionError("accepted version 2")
    except ValueError:
        pass
    # icons: the registry, the placeholder syntax and what a brand icon file may hold
    icons = load_icons(t)
    assert len(icons) >= 80 and {"trash", "user", "type-flowchart", "type-sequence", "type-erd"} <= icons.keys()
    tf = icons["type-flowchart"]
    assert isinstance(tf, str)
    assert icon_svg(t, icons, "type-flowchart") == ('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
                                                    f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{tf}</svg>')
    assert 'width="32" height="32"' in icon_svg(t, icons, "type-flowchart", "tile", ("fine",)) and 'stroke-width="1.75"' in icon_svg(t, icons, "type-flowchart", "tile", ("fine",))
    assert 'stroke-width="2.5"' in icon_svg(t, icons, "type-flowchart", "xs", ("bold",)) and 'width="7"' in icon_svg(t, icons, "type-flowchart", "7")
    plus = icons["plus"]
    assert isinstance(plus, str)
    assert icon_svg(t, icons, "plus") == ('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
                                          f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{plus}</svg>')
    assert expand_icons("a {{icon:type-flowchart}} b {{icon:type-flowchart:xl}} {{icon:plus:tile:fine}}", t, icons).count("<svg") == 3
    try:
        expand_icons("{{icon:nope}}", t, icons)
        raise AssertionError("accepted an unknown icon")
    except KeyError:
        pass
    assert tokens_js(t).count("const ICONS = {") == 1 and '"icon":{"set":"default"' in tokens_js(t) and "--icon-tile: 32px;" in tokens_css(t)
    for ok in ('<path d="M3 12h18"/>', '<circle cx="12" cy="12" r="2.5" fill="currentColor"/><path class="tile-line" d="M0.5 12H2" stroke-dasharray="1 2"/>',
               '<path d="M0 0" opacity="0.2"/><path d="M0 0" fill-rule="evenodd"/>'):
        assert _ICON_MARKUP.fullmatch(ok), ok
    for bad in ('<script>alert(1)</script>', '<path d="M0 0" onload="x"/>', '<path d="M0 0"/><style>a{}</style>', '<image href="x"/>',
                '<path d="M0 0" fill="url(#a)"/>', '<path d="M0 0" d2="x"/>', '<use href="#a"/>', '<path d="a&quot;b"/>',
                '<path d="M0 0" opacity="2"/>', '<path d="M0 0" fill="red"/>', ''):
        assert not _ICON_MARKUP.fullmatch(bad), bad
    set_dir = Path(tempfile.mkdtemp())
    (set_dir / "other.json").write_text(json.dumps({"icons": {"trash": '<path d="M1 1h2"/>', "user": {"vb": "0 0 256 256", "body": '<path d="M0 0" opacity="0.2"/>'}}}))
    saved = ICONS_DIR
    ICONS_DIR = set_dir
    try:
        (set_dir / "default.json").write_text((saved / "default.json").read_text())
        other = load_icons(load_tokens(theme({"icon": {"set": "other"}})))
        assert other["trash"] == '<path d="M1 1h2"/>' and other["user"] == {"vb": "0 0 256 256", "body": '<path d="M0 0" opacity="0.2"/>'} and other["type-flowchart"] == icons["type-flowchart"], "a brand set overrides names and falls back for the rest"
        assert icon_svg(t, other, "user") == '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M0 0" opacity="0.2"/></svg>'
        for bad_reg in (
            {"trash": '<path d="M1 1h2" onclick="x"/>'},
            {"trash": {"vb": "0 0 256 256", "body": '<path d="M0 0"/>', "extra": "x"}},
            {"trash": {"vb": "0 0 256", "body": '<path d="M0 0"/>'}},
            {"trash": {"vb": "0 0 256 256", "body": '<path d="M0 0" onclick="x"/>'}},
        ):
            (set_dir / "other.json").write_text(json.dumps({"icons": bad_reg}))
            try:
                load_icons(load_tokens(theme({"icon": {"set": "other"}})))
                raise AssertionError(f"accepted malformed icon registry {bad_reg!r}")
            except ValueError:
                pass
    finally:
        ICONS_DIR = saved
    for bad in ({"icon": {"set": "a/b"}}, {"icon": {"stroke": 9}}, {"icon": {"cap": "x"}}, {"icon": {"size": {"md": "big"}}}):
        try:
            load_tokens(theme(bad))
        except ValueError:
            continue
        raise AssertionError(f"accepted {bad}")
    print("[PASS] tokens self-check")
