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
TOKENS_VERSION = 1

_FUNCS = {"rgb", "rgba", "hsl", "hsla", "oklch", "var", "color-mix"}
_COLOR_CHARS = re.compile(r"^[A-Za-z0-9#%.,() \-]+$")
_LENGTH = re.compile(r"^-?\d+(\.\d+)?(px|rem|em|%)?$")
_TRACKING = re.compile(r"^(0|-?\d+(\.\d+)?(em|px))$")
_KEY = re.compile(r"^[\w-]+$")
_RADIUS = re.compile(r"^\d+(\.\d+)?(px|rem|em|%)?( \d+(\.\d+)?(px|rem|em|%)?){0,3}$")
_VAR = re.compile(r"var\(--([\w-]+)\)")
_TIME = re.compile(r"^\d+(\.\d+)?m?s( [a-z-]+)?$")
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
    _validate_type(t["type"])
    for k, v in t["motion"].items():
        if not (isinstance(v, str) and _TIME.match(v)): raise _err(f"motion.{k}", v)
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
    if "icon" in t:  # shortcut: only what a theme may set today; the full icon group (size, cap, registry) comes with the icon registry
        ic = t["icon"]
        if not isinstance(ic.get("set", "default"), str) or not re.fullmatch(r"[a-z0-9-]+", ic.get("set", "default")): raise _err("icon.set", ic.get("set"))
        sw = ic.get("stroke", 2)
        if isinstance(sw, bool) or not isinstance(sw, (int, float)) or not 1.5 <= sw <= 2.5: raise _err("icon.stroke", sw)
    if not isinstance(t["contrast"], list): raise _err("contrast", t["contrast"])
    for mode in ("light", "dark"):
        for k, v in t["color"][mode].items():
            if not re.fullmatch(r"[\w-]+", k) or not _is_value(v): raise _err(f"color.{mode}.{k}", v)


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


def _merge(base: Dict[str, Any], over: Dict[str, Any]) -> Dict[str, Any]:
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _merge(base[k], v)
        else:
            base[k] = copy.deepcopy(v)
    return base


def merge_theme(theme: Optional[Dict[str, Any]], source: str = "theme") -> Dict[str, Any]:
    """default.json with a parsed theme deep-merged over it (lists, such as palette, are replaced whole), validated."""
    tokens = json.loads(DEFAULT_PATH.read_text(encoding="utf-8"))
    if theme is not None:
        if not isinstance(theme, dict) or theme.get("tokensVersion") != TOKENS_VERSION:
            raise ValueError(f"tokens: unsupported tokensVersion {theme.get('tokensVersion') if isinstance(theme, dict) else theme!r} in {source}")
        _merge(tokens, theme)
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
    for s in tokens["palette"]:
        tones = {**({} if only_mode else s["light"]), **s[mode]}
        out.update({f"sw-{s['slot']}-{_TONES[t]}": v for t, v in tones.items()})
    return out


def _block(selector: str, decls: Dict[str, str], scheme: str) -> str:
    lines = [f"      --{k}: {v};" for k, v in decls.items()] + [f"      color-scheme: {scheme};"]
    return f"    {selector} {{\n" + "\n".join(lines) + "\n    }"


def _type_vars(tokens: Dict[str, Any]) -> Dict[str, str]:
    """--font-ui|diagram|mono, the --text/--weight/--leading/--line/--tracking scales and --t-<style>-* for every text style."""
    f, ty = tokens["font"], tokens["type"]
    out = {f"font-{k}": f'"{f["family"]}", {f["stack"]}' if v == "font.family" else v for k, v in ty["family"].items()}
    for var, group in (("text", "size"), ("weight", "weight"), ("leading", "leading"), ("line", "lineBox"), ("tracking", "tracking")):
        out.update({f"{var}-{k}": str(v) for k, v in ty[group].items()})
    for name, st in ty["styles"].items():
        out.update({f"t-{name}-family": f"var(--font-{st['family']})", f"t-{name}-size": f"var(--text-{st['size']})",
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
             **tokens["size"], **tokens["motion"], **{f"radius-{k}": v for k, v in tokens["radius"].items()},
             **{f"shadow-{k}": v for k, v in tokens["shadow"].items()},
             **tokens["color"]["light"], **_sw_vars(tokens, "light")}
    dark = {**tokens["color"]["dark"], **_sw_vars(tokens, "dark", True)}
    # A slot's roles feed the roles shell.css and the types read (--sw-pill-bg, ...); an element without data-sw keeps the run-time derivation.
    slots = "\n".join(
        f'    [data-sw="{s["slot"]}"] {{ --sw-stripe: var(--sw-{s["slot"]}-line); --sw-line: var(--sw-{s["slot"]}-line); '
        f'--sw-pill-bg: var(--sw-{s["slot"]}-fill); --sw-pill-ink: var(--sw-{s["slot"]}-ink); '
        f'--sw-pill-solid: var(--sw-{s["slot"]}-solid); --sw-on-solid: var(--sw-{s["slot"]}-on-solid); }}'
        for s in tokens["palette"])
    return (_block(":root", light, "light") + "\n\n" + _block(':root[data-theme="dark"]', dark, "dark") + "\n\n" + slots
            + "\n\n" + _type_classes(tokens))


def tokens_data(tokens: Dict[str, Any]) -> Dict[str, Any]:
    """The part of the tokens the JS reads: the page, the ERD worker and scripts/run_engine.mjs all get exactly this as TOKENS."""
    return {"palette": tokens["palette"], "font": {"metrics": tokens["font"]["metrics"]}, "motion": tokens["motion"],
            "type": {k: tokens["type"][k] for k in ("fitMin", "fitMinOverview")}}


def tokens_js(tokens: Dict[str, Any]) -> str:
    return f"const TOKENS = {json.dumps(tokens_data(tokens), separators=(',', ':'))};"


if __name__ == "__main__":
    import tempfile
    t = load_tokens()
    assert t["tokensVersion"] == 1 and len(t["palette"]) == 9
    d, l = resolve_colors(t, "dark"), resolve_colors(t, "light")
    assert d["bg-page"] == "#0b1220" and l["bg-page"] == "#f8fafc"
    assert d["warning"] == l["warning"], "dark falls back to light"
    assert all(not v.startswith("var(") for v in [*d.values(), *l.values()])
    css = tokens_css(t)
    assert "--primary: #2563eb;" in css and tokens_js(t).startswith("const TOKENS = {")
    assert '"fitMin":"11px"' in tokens_js(t) and '"fitMinOverview":"9px"' in tokens_js(t)
    for want in ("--font-ui: \"Nunito Sans\", ", "--font-mono: ui-monospace", "--text-md: 13px;", "--weight-bold: 700;", "--leading-tight: 1.2;",
                 "--tracking-caps: 0.04em;", "--t-label-size: var(--text-md);", "--t-overline-tracking: var(--tracking-caps);",
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
    for bad in ({"color": {"light": {"primary": "url(javascript:alert(1))"}}},
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
    print("[PASS] tokens self-check")
