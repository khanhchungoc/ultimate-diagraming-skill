"""Unit test of scripts/build_icon_pack.py on a synthetic pack (made-up shapes, no vendor art). Run: python3 dev/test_icon_pack.py"""
import json
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from build_icon_pack import build_pack, load_logos, logo_refs  # noqa: E402

BOX = ('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 48 32" onload="x()">'
       '<script>alert(1)</script><image xlink:href="http://example.com/a.png"/>'
       '<rect x="2" y="2" width="44" height="28" fill="#e11d48" onclick="y()"/><circle cx="24" cy="16" r="6" fill="#0ea5e9"/></svg>')


def main():
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        src = d / "src"
        src.mkdir()
        (src / "Big Box.svg").write_text(BOX)
        (src / "TERMS-acme.txt").write_text("made up terms")
        out1, out2 = d / "o1", d / "o2"
        p1 = build_pack(src, "acme", out1)
        p2 = build_pack(src, "acme", out2)
        assert p1.read_bytes() == p2.read_bytes(), "deterministic"
        pack = json.loads(p1.read_text())
        e = pack["icons"]["big-box"]
        assert e["vb"] == "0 0 48 32" and "<rect" in e["body"] and "#e11d48" in e["body"]
        for bad in ("script", "onload", "onclick", "<image", "example.com", "xmlns"):
            assert bad not in e["body"], bad
        assert (out1 / "acme-TERMS-acme.txt").read_text() == "made up terms"
        # zip gives the same pack
        z = d / "s.zip"
        with zipfile.ZipFile(z, "w") as zf:
            zf.write(src / "Big Box.svg", "x/Big Box.svg")
            zf.write(src / "TERMS-acme.txt", "x/TERMS-acme.txt")
        assert json.loads(build_pack(z, "acme", d / "o3").read_text())["icons"] == pack["icons"]
        # load_logos: found, absent entry, absent pack
        reg, absent = load_logos(["acme/big-box", "acme/nope", "ghost/x"], [out1])
        assert list(reg) == ["acme/big-box"] and absent == ["acme/nope"]
        assert logo_refs({"elements": [{"icon": "logo:acme/big-box"}, {"icon": "cloud"}]}) == {"acme/big-box"}
        # bad SVGs are refused
        for name, text in (("a", "<svg><rect/></svg>"), ("b", "not xml"), ("c", '<svg viewBox="0 0 1 1"><style>a{}</style><rect/></svg>'),
                           ("d", '<svg viewBox="0 0 1 1"></svg>')):
            bad = d / f"bad{name}"
            bad.mkdir()
            (bad / "x.svg").write_text(text)
            try:
                build_pack(bad, "acme", d / "ob")
            except ValueError as exc:
                assert "x" in str(exc) or "svg" in str(exc)
            else:
                raise AssertionError(f"accepted {text!r}")
    print("[PASS] icon pack builder")


main()
