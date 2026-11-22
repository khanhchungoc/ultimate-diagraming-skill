#!/usr/bin/env python3
"""Build assets/icons/default.json (Tabler Icons Outline + custom diagram glyphs) and assets/logos/devicon.json (curated Devicon logos).

Stdlib only. Fetches pinned npm tarballs (cached in --cache or system temp) and writes deterministic JSON + license files.

Usage:
  python dev/tools/build_icons.py [--cache DIR] [--icons-only]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import tarfile
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import build_icon_pack  # noqa: E402
import tokens  # noqa: E402

TABLER_URL = "https://registry.npmjs.org/@tabler/icons/-/icons-3.52.0.tgz"
DEVICON_URL = "https://registry.npmjs.org/devicon/-/devicon-2.18.0.tgz"

CUSTOM_GLYPHS = (
    "type-erd", "type-flowchart", "type-sequence", "type-usecase", "type-c4",
    "table-add", "relationship", "split",
    "shape-terminator", "shape-process", "shape-decision", "shape-connector",
    "shape-subprocess", "shape-data", "shape-document", "shape-database",
    "shape-delay", "shape-c4-group", "note",
    "lane", "participant", "message", "frame", "numbers", "message-return",
    "lifespans", "line-dashed", "line-solid", "message-async",
    "actor", "usecase", "subject",
    "kind-system", "kind-ui", "kind-database", "kind-queue", "kind-external",
    "queue",
)

# Original 24x24 stroked glyphs restored from git 9ca74b8 (kept instead of vendor replacements).
RESTORED_CUSTOM_GLYPHS: Dict[str, str] = {
    "actor": '<circle cx="12" cy="5" r="3"/><path d="M12 8v7"/><path d="M5 11h14"/><path d="m12 15-5 6"/><path d="m12 15 5 6"/>',
    "queue": '<rect x="2" y="7" width="5" height="10" rx="1"/><rect x="9.5" y="7" width="5" height="10" rx="1"/><path d="M17 12h5M19.5 9.5 22 12l-2.5 2.5"/>',
}

TABLER_MAP: Dict[str, str] = {
    # Header & actions
    "moon": "moon",
    "sun": "sun",
    "help": "help-circle",
    "present": "presentation",
    "import": "download",
    "export": "upload",
    "save": "device-floppy",
    "search": "search",
    "close": "x",
    "more": "dots",
    "trash": "trash",
    # Zoom & navigation
    "undo": "arrow-back-up",
    "redo": "arrow-forward-up",
    "minus": "minus",
    "plus": "plus",
    "fit": "maximize",
    "chevron-down": "chevron-down",
    "chevron-up": "chevron-up",
    "direction-tb": "arrow-down",
    "direction-lr": "arrow-right",
    "reply": "corner-up-left",
    "reverse": "arrows-exchange",
    "auto": "refresh",
    "focus": "target",
    "eye": "eye",
    # Docks & editing
    "notes": "notes",
    "note-lines": "align-left",
    "columns": "list-details",
    "types": "braces",
    "tidy": "wand",
    "grip": "grip-vertical",
    "shapes": "triangle-square-circle",
    "rename": "pencil",
    "label": "typography",
    "hash": "hash",
    # People, business, infra & C4
    "user": "user",
    "users": "users",
    "briefcase": "briefcase",
    "building": "building",
    "headset": "headset",
    "monitor": "device-desktop",
    "browser": "browser",
    "mobile": "device-mobile",
    "code": "code",
    "server": "server",
    "database": "database",
    "cloud": "cloud",
    "cpu": "cpu",
    "cog": "settings",
    "shield": "shield",
    "scale": "scale",
    "banknote": "cash",
    "credit-card": "credit-card",
    "mail": "mail",
    "package": "package",
    "truck": "truck",
    "cart": "shopping-cart",
    "clipboard": "clipboard-text",
    "check": "circle-check",
    "layers": "stack-2",
    "globe": "world",
    "flag": "flag",
    "key": "key",
    "lock": "lock",
    "link": "link",
    "clock": "clock",
    "bell": "bell",
    "function": "math-function",
    "storage": "archive",
    "cdn": "topology-star-3",
    "gateway": "arrows-split-2",
    "container": "box",
    "cluster": "sitemap",
    "cache": "bolt",
    "api": "plug-connected",
}

# Curated ~68 top architecture/C4 logos: (alias_in_pack, devicon_folder_name)
DEVICON_LOGOS: List[Tuple[str, str]] = [
    # Cloud & infrastructure
    ("aws", "amazonwebservices"),
    ("azure", "azure"),
    ("gcp", "googlecloud"),
    ("cloudflare", "cloudflare"),
    ("docker", "docker"),
    ("kubernetes", "kubernetes"),
    ("terraform", "terraform"),
    ("nginx", "nginx"),
    ("apache", "apache"),
    ("linux", "linux"),
    ("helm", "helm"),
    ("prometheus", "prometheus"),
    # Databases & storage
    ("postgresql", "postgresql"),
    ("mysql", "mysql"),
    ("mariadb", "mariadb"),
    ("mongodb", "mongodb"),
    ("redis", "redis"),
    ("elasticsearch", "elasticsearch"),
    ("sqlite", "sqlite"),
    ("cassandra", "cassandra"),
    ("dynamodb", "dynamodb"),
    ("neo4j", "neo4j"),
    ("supabase", "supabase"),
    ("firebase", "firebase"),
    # Messaging & APIs
    ("kafka", "apachekafka"),
    ("rabbitmq", "rabbitmq"),
    ("graphql", "graphql"),
    ("grpc", "grpc"),
    # Languages & runtimes
    ("nodejs", "nodejs"),
    ("python", "python"),
    ("typescript", "typescript"),
    ("javascript", "javascript"),
    ("go", "go"),
    ("rust", "rust"),
    ("java", "java"),
    ("csharp", "csharp"),
    ("dotnet", "dotnetcore"),
    ("php", "php"),
    ("ruby", "ruby"),
    ("swift", "swift"),
    # Backend frameworks
    ("fastapi", "fastapi"),
    ("django", "django"),
    ("spring", "spring"),
    ("nestjs", "nestjs"),
    ("express", "express"),
    ("rails", "rails"),
    ("laravel", "laravel"),
    # Frontend & mobile
    ("nextjs", "nextjs"),
    ("react", "react"),
    ("vue", "vuejs"),
    ("angular", "angular"),
    ("svelte", "svelte"),
    ("flutter", "flutter"),
    ("android", "android"),
    ("apple", "apple"),
    # DevOps, observability & data/AI
    ("github", "github"),
    ("gitlab", "gitlab"),
    ("githubactions", "githubactions"),
    ("jenkins", "jenkins"),
    ("grafana", "grafana"),
    ("datadog", "datadog"),
    ("sentry", "sentry"),
    ("opentelemetry", "opentelemetry"),
    ("argocd", "argocd"),
    ("spark", "apachespark"),
    ("airflow", "apacheairflow"),
    ("pytorch", "pytorch"),
    ("vercel", "vercel"),
    ("prisma", "prisma"),
]

_LOCAL = lambda tag: tag.rsplit("}", 1)[-1]


def fetch_tarball(url: str, dest: Path) -> Path:
    if dest.is_file() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "ultimate-diagram-build-icons/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        dest.write_bytes(resp.read())
    return dest


def _read_tar_files(tgz_path: Path) -> Dict[str, bytes]:
    out: Dict[str, bytes] = {}
    with tarfile.open(tgz_path, "r:gz") as tf:
        for m in tf.getmembers():
            if m.isfile():
                f = tf.extractfile(m)
                if f is not None:
                    out[m.name] = f.read()
    return out


def _convert_tabler_svg(svg_text: str, name: str) -> str:
    root = ET.fromstring(svg_text)
    vb = " ".join(re.split(r"[\s,]+", (root.get("viewBox") or "0 0 24 24").strip()))
    if vb != "0 0 24 24":
        raise ValueError(f"Tabler {name}: unexpected viewBox {vb!r}")
    parts: List[str] = []

    def walk(parent: ET.Element) -> None:
        for child in parent:
            tag = _LOCAL(child.tag).lower()
            # Strip the transparent 24x24 spacer path Tabler includes in every outline asset.
            if tag == "path" and child.get("stroke") == "none" and child.get("fill") == "none" and child.get("d") == "M0 0h24v24H0z":
                continue
            if tag == "g" and not child.attrib:
                walk(child)
                continue
            if tag not in ("path", "circle", "rect", "line", "polyline", "polygon", "ellipse"):
                raise ValueError(f"Tabler {name}: unexpected element <{tag}>")
            if list(child):
                raise ValueError(f"Tabler {name}: nested children inside <{tag}>")
            attrs = []
            for k, v in child.attrib.items():
                lk = _LOCAL(k)
                if lk in ("class", "xmlns", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"):
                    continue
                if lk == "fill" and v == "none":
                    continue
                attrs.append(f'{lk}="{v}"')
            parts.append(f'<{tag}' + ("" if not attrs else " " + " ".join(attrs)) + "/>")

    walk(root)
    body = "".join(parts)
    if not tokens._ICON_MARKUP.fullmatch(body):
        raise ValueError(f"Tabler {name}: body rejected by tokens._ICON_MARKUP: {body!r}")
    return body


def build_default_icons(tabler_files: Dict[str, bytes]) -> None:
    icons_path = ROOT / "assets" / "icons" / "default.json"
    existing = json.loads(icons_path.read_text(encoding="utf-8"))["icons"]
    expected_keys = set(existing.keys())

    if set(CUSTOM_GLYPHS) | set(TABLER_MAP.keys()) != expected_keys:
        missing = expected_keys - (set(CUSTOM_GLYPHS) | set(TABLER_MAP.keys()))
        extra = (set(CUSTOM_GLYPHS) | set(TABLER_MAP.keys())) - expected_keys
        raise ValueError(f"Icon key mismatch: missing={missing}, extra={extra}")

    new_icons: Dict[str, Any] = {}
    for key in existing:
        if key in CUSTOM_GLYPHS:
            val = RESTORED_CUSTOM_GLYPHS.get(key) or existing[key]
            if not isinstance(val, str) or not tokens._ICON_MARKUP.fullmatch(val):
                raise ValueError(f"Expected custom glyph {key!r} to be a valid stroked string")
            new_icons[key] = val
        else:
            tb_name = TABLER_MAP[key]
            tar_key = f"package/icons/outline/{tb_name}.svg"
            if tar_key not in tabler_files:
                raise FileNotFoundError(f"Tabler outline icon not found: {tar_key}")
            new_icons[key] = _convert_tabler_svg(tabler_files[tar_key].decode("utf-8"), f"{key} ({tb_name})")

    license_bytes = tabler_files.get("package/LICENSE")
    if not license_bytes:
        raise FileNotFoundError("package/LICENSE missing from @tabler/icons tarball")
    tb_license = license_bytes.decode("utf-8").strip()

    custom_notice = (
        "The icon drawings in default.json come from Tabler Icons (https://tabler.io/icons,\n"
        "Outline style, @tabler/icons 3.52.0) and are used under its MIT license below.\n"
        "The diagram-type icons (type-erd, type-flowchart, type-sequence, type-usecase, type-c4),\n"
        "ERD table/relationship icons (table-add, relationship, split), flowchart shape tiles\n"
        "(shape-*), lane/sequence/usecase notation glyphs (lane, participant, message, frame,\n"
        "numbers, message-return, lifespans, line-dashed, line-solid, message-async, actor,\n"
        "usecase, subject), and participant-kind/C4 queue glyphs (kind-*, queue) were drawn for\n"
        "this skill (24 x 24, rounded stroke) and are released with it.\n\n"
    )
    (ROOT / "assets" / "icons" / "LICENSE").write_text(custom_notice + tb_license + "\n", encoding="utf-8", newline="\n")

    out_obj = {
        "_license": (
            "Most icons are Tabler Icons Outline (https://tabler.io/icons, MIT license, "
            "@tabler/icons 3.52.0); see LICENSE next to this file. Diagram-type, ERD, "
            "flowchart shape, sequence, use-case, actor, queue, and participant-kind notation "
            "glyphs are drawn for this skill (24 x 24, rounded stroke) and are released with it."
        ),
        "icons": new_icons,
    }
    icons_path.write_text(json.dumps(out_obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    tokens._read_registry(icons_path)
    print(f"[OK] Wrote {icons_path.relative_to(ROOT)} ({len(new_icons)} icons: {len(CUSTOM_GLYPHS)} custom + {len(TABLER_MAP)} Tabler Outline)")


def _inline_css_styles(svg_text: str, label: str) -> str:
    """Inline simple CSS class rules from `<style>` blocks onto matching SVG elements and drop `<style>`."""
    svg_text = re.sub(r"<!--.*?-->", "", svg_text, flags=re.S)
    root = ET.fromstring(svg_text)
    rules: Dict[str, Dict[str, str]] = {}
    allowed_props = {"fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "opacity", "fill-opacity", "fill-rule", "clip-rule"}
    for parent in list(root.iter()):
        for child in list(parent):
            if _LOCAL(child.tag).lower() == "style":
                css = "".join(child.itertext())
                for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
                    sels, body = m.group(1), m.group(2)
                    props: Dict[str, str] = {}
                    for decl in body.split(";"):
                        if ":" not in decl:
                            continue
                        k, v = decl.split(":", 1)
                        k, v = k.strip().lower(), v.strip()
                        if k in allowed_props:
                            props[k] = v
                    if props:
                        for sel in sels.split(","):
                            sel = sel.strip()
                            if sel.startswith(".") and " " not in sel and ">" not in sel:
                                rules.setdefault(sel[1:], {}).update(props)
                parent.remove(child)
    if rules:
        for el in root.iter():
            cls = el.attrib.pop("class", None)
            if cls:
                for c in cls.split():
                    for k, v in rules.get(c, {}).items():
                        el.attrib.setdefault(k, v)
    return ET.tostring(root, encoding="unicode", short_empty_elements=True)


def _strip_svg_ws(body: str) -> str:
    return re.sub(r">\s+<", "><", body).strip()


def _aspect_ok(vb: str) -> bool:
    nums = [float(x) for x in vb.split()]
    w, h = nums[2], nums[3]
    if w <= 0 or h <= 0:
        return False
    ratio = max(w / h, h / w)
    return ratio <= 2.5


def build_devicon_pack(devicon_files: Dict[str, bytes]) -> None:
    icons: Dict[str, Dict[str, str]] = {}
    skipped: List[str] = []

    for alias, dev_name in DEVICON_LOGOS:
        prefix = f"package/icons/{dev_name}/{dev_name}-"
        # Prefer square/emblem icons; never select wide wordmarks.
        candidates = [
            f"{prefix}original.svg",
            f"{prefix}plain.svg",
            f"{prefix}line.svg",
        ]
        chosen: Optional[str] = None
        fallback: Optional[Dict[str, str]] = None
        for cand in candidates:
            if cand in devicon_files:
                text = devicon_files[cand].decode("utf-8-sig")
                inlined = _inline_css_styles(text, f"devicon/{alias}")
                cleaned = build_icon_pack.clean_svg(inlined, f"devicon/{alias}")
                cleaned["body"] = _strip_svg_ws(cleaned["body"])
                if fallback is None:
                    fallback = cleaned
                # Skip huge vector-traced illustrations (e.g., linux-original.svg at ~194 KB) when a compact variant exists.
                if len(cleaned["body"]) > 25000 and any(c in devicon_files for c in candidates[candidates.index(cand) + 1:]):
                    continue
                if _aspect_ok(cleaned["vb"]) or cand == candidates[-1]:
                    chosen = cand
                    icons[alias] = cleaned
                    break
        if chosen is None and fallback is not None:
            icons[alias] = fallback
            chosen = candidates[0]
        if chosen is None:
            skipped.append(f"{alias} ({dev_name})")

    if skipped:
        raise ValueError(f"Missing or unusable Devicon logos: {', '.join(skipped)}")

    lic_key = next((k for k in devicon_files if k.lower() in ("package/license", "package/license.md", "package/license.txt")), None)
    if not lic_key:
        raise FileNotFoundError("LICENSE missing from devicon tarball")
    lic_text = devicon_files[lic_key].decode("utf-8").strip() + "\n"

    logos_dir = ROOT / "assets" / "logos"
    logos_dir.mkdir(parents=True, exist_ok=True)
    (logos_dir / "devicon-LICENSE.txt").write_text(lic_text, encoding="utf-8", newline="\n")

    pack = {
        "_license": "devicon-LICENSE.txt (MIT, devicon 2.18.0)",
        "_source": "devicon-2.18.0.tgz",
        "icons": dict(sorted(icons.items())),
    }
    pack_path = logos_dir / "devicon.json"
    pack_path.write_text(json.dumps(pack, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    size_kb = pack_path.stat().st_size / 1024
    print(f"[OK] Wrote {pack_path.relative_to(ROOT)} ({len(icons)} logos, {size_kb:.1f} KB)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--cache", help="Directory to cache downloaded npm tarballs")
    ap.add_argument("--icons-only", action="store_true", help="Only rebuild assets/icons/default.json and LICENSE")
    args = ap.parse_args()

    cache_dir = Path(args.cache) if args.cache else Path(tempfile.gettempdir()) / "ultimate-diagram-icon-cache"
    tb_tgz = fetch_tarball(TABLER_URL, cache_dir / "tabler-icons-3.52.0.tgz")
    build_default_icons(_read_tar_files(tb_tgz))

    if not args.icons_only:
        dv_tgz = fetch_tarball(DEVICON_URL, cache_dir / "devicon-2.18.0.tgz")
        build_devicon_pack(_read_tar_files(dv_tgz))
    return 0


if __name__ == "__main__":
    sys.exit(main())
