#!/usr/bin/env python3
"""Build a local icon pack (icons/<pack>.json) from a folder or zip of SVG files. Stdlib only; never fetches anything.

    python3 scripts/build_icon_pack.py <zip-or-dir> --name acme [--out icons]

Each SVG keeps its viewBox and inner markup; scripts, event attributes, <image> and external references are stripped.
The format is in references/icon-packs.md. layout_engine.py reads packs back through load_logos(): the same cleaning runs
there, so a hand-written pack cannot put a script into a page.
"""
import argparse
import json
import re
import sys
import zipfile
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence, Set, Tuple
import xml.etree.ElementTree as ET

SVG_NS = "http://www.w3.org/2000/svg"
DROP_TAGS = {"script", "image", "foreignobject", "metadata", "title", "desc"}
TERMS_RE = re.compile(r"LICENSE|TERMS|NOTICE", re.I)
EXTERNAL_URL = re.compile(r"url\(\s*['\"]?(?!#)|^\s*(?:https?:)?//", re.I)


def _local(name: str) -> str:
    return name.rsplit("}", 1)[-1]


def _clean(el: ET.Element, label: str) -> None:
    """Strip `el`'s subtree in place: no scripts, images, event attributes or references outside the file."""
    for child in list(el):
        tag = _local(child.tag).lower()
        if tag in DROP_TAGS:
            el.remove(child)
        elif tag == "style":
            raise ValueError(f"{label}: has a <style> element, which would restyle the page; inline the colours as fill attributes")
        else:
            _clean(child, label)
    for key, val in list(el.attrib.items()):
        del el.attrib[key]
        name = _local(key).lower()
        if name.startswith("on") or EXTERNAL_URL.search(val) or "@import" in val.lower() or (name == "href" and not val.startswith("#")):
            continue   # event handler, or a reference outside the file
        el.attrib[_local(key)] = val
    el.tail = None


def clean_svg(text: str, label: str = "svg") -> Dict[str, str]:
    """{"vb": viewBox, "body": inner markup} of an SVG text; ValueError when it cannot be reduced to inner markup."""
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise ValueError(f"{label}: not valid SVG ({exc})") from None
    if _local(root.tag).lower() != "svg":
        raise ValueError(f"{label}: the root element is <{_local(root.tag)}>, not <svg>")
    vb = root.get("viewBox") or root.get("viewbox")
    if not vb or len(re.split(r"[\s,]+", vb.strip())) != 4:
        raise ValueError(f"{label}: no usable viewBox (the logo's aspect ratio comes from it)")
    _clean(root, label)
    for el in root.iter():
        el.tag = _local(el.tag)
    body = (root.text or "").strip() + "".join(ET.tostring(c, encoding="unicode", short_empty_elements=True).strip() for c in root)
    if "<" not in body:
        raise ValueError(f"{label}: nothing to draw inside the <svg>")
    return {"vb": " ".join(re.split(r"[\s,]+", vb.strip())), "body": body}


def entry_name(file_name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", Path(file_name).stem.lower()).strip("-")


def read_source(src: Path) -> Tuple[Dict[str, str], Dict[str, bytes]]:
    """(name -> svg text, terms file name -> bytes) of a folder or zip."""
    svgs: Dict[str, str] = {}
    terms: Dict[str, bytes] = {}
    if src.is_dir():
        files = [(p.name, p.read_bytes) for p in sorted(src.rglob("*")) if p.is_file()]
    elif zipfile.is_zipfile(src):
        zf = zipfile.ZipFile(src)
        files = [(Path(n).name, (lambda n=n: zf.read(n))) for n in sorted(zf.namelist())
                 if not n.endswith("/") and "__MACOSX" not in n]
    else:
        raise ValueError(f"{src}: not a folder or a zip file")
    for fname, read in files:
        if fname.lower().endswith(".svg"):
            name = entry_name(fname)
            if not name:
                raise ValueError(f"{fname}: no letters or digits to name the entry from")
            if name in svgs:
                raise ValueError(f"{fname}: two files give the entry name {name!r}")
            svgs[name] = read().decode("utf-8-sig")
        elif TERMS_RE.search(fname):
            terms.setdefault(fname, read())
    return svgs, terms


def build_pack(src: Path, name: str, out: Path) -> Path:
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", name):
        raise ValueError(f"--name {name!r}: use lowercase letters, digits and hyphens")
    svgs, terms = read_source(src)
    if not svgs:
        raise ValueError(f"{src}: no .svg files")
    icons = {n: clean_svg(t, n) for n, t in sorted(svgs.items())}
    out.mkdir(parents=True, exist_ok=True)
    for fname, data in sorted(terms.items()):
        (out / f"{name}-{fname}").write_bytes(data)
    pack = {"_license": ", ".join(f"{name}-{f}" for f in sorted(terms)) or "see the vendor's terms; none was in the source",
            "_source": src.name, "icons": icons}
    path = out / f"{name}.json"
    path.write_text(json.dumps(pack, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    return path


# --- reading packs back (layout_engine.py, audit) ---

def installed_packs(dirs: Sequence[Path]) -> Set[str]:
    return {p.stem for d in dirs if d.is_dir() for p in d.glob("*.json")}


def logo_refs(data: Any) -> Set[str]:
    """Every "<pack>/<name>" an `icon` value of the diagram names as `logo:<pack>/<name>`."""
    found: Set[str] = set()

    def walk(v: Any) -> None:
        if isinstance(v, dict):
            for k, x in v.items():
                if k == "icon" and isinstance(x, str) and x.startswith("logo:") and "/" in x[5:]:
                    found.add(x[5:])
                else:
                    walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
    walk(data)
    return found


def load_logos(refs: Iterable[str], dirs: Sequence[Path]) -> Tuple[Dict[str, Dict[str, str]], List[str]]:
    """(registry of the entries found, refs of installed packs with no such entry), for refs "<pack>/<name>".
    A ref of a pack that is not installed is in neither; the audit reports it."""
    registry: Dict[str, Dict[str, str]] = {}
    absent: List[str] = []
    cache: Dict[str, Any] = {}
    for ref in sorted(set(refs)):
        pack, name = ref.split("/", 1)
        if pack not in cache:
            path = next((d / f"{pack}.json" for d in dirs if (d / f"{pack}.json").is_file()), None)
            cache[pack] = json.loads(path.read_text(encoding="utf-8")).get("icons", {}) if path else None
        if cache[pack] is None:
            continue
        entry = cache[pack].get(name)
        if not isinstance(entry, dict) or "vb" not in entry or "body" not in entry:
            absent.append(ref)
            continue
        registry[ref] = clean_svg(f'<svg xmlns="{SVG_NS}" viewBox="{entry["vb"]}">{entry["body"]}</svg>', ref)
    return registry, absent


def main() -> int:
    ap = argparse.ArgumentParser(description="Build icons/<pack>.json from a folder or zip of SVG files.")
    ap.add_argument("source", help="folder or zip of .svg files (and the vendor's LICENSE/TERMS/NOTICE files)")
    ap.add_argument("--name", required=True, help="pack name, as in logo:<name>/<icon>")
    ap.add_argument("--out", default="icons", help="folder to write into (default: icons)")
    args = ap.parse_args()
    try:
        path = build_pack(Path(args.source), args.name, Path(args.out))
    except (ValueError, OSError) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1
    print(f"[OK] Wrote {path} ({len(json.loads(path.read_text(encoding='utf-8'))['icons'])} icons)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
