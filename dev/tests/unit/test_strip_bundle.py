"""Unit tests for scripts/strip_bundle.py (bundle shrinking). Run: python3 dev/tests/unit/test_strip_bundle.py

Safety net for the stripper: tricky inputs, then every real page script must still parse (node --check) and keep
every template literal, string and regex literal byte-identical (compared through Node's own acorn parser)."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import layout_engine  # noqa: E402
from strip_bundle import minify_css, minify_js, strip_css, strip_js  # noqa: E402

NODE = shutil.which("node")

LITERALS_JS = r"""
const [src, out] = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const acorn = require('internal/deps/acorn/acorn/dist/acorn');
const lits = (code) => {
  const found = [];
  acorn.parse(code, { ecmaVersion: 'latest', onToken: (t) => {
    if (t.type.label === 'template' || t.type.label === 'string' || t.type.label === 'regexp') found.push([t.type.label, code.slice(t.start, t.end)]);
  } });
  return found;
};
const a = lits(src), b = lits(out);
if (JSON.stringify(a) !== JSON.stringify(b)) { console.log('literal mismatch'); process.exit(1); }
console.log(a.length);
"""


def page_scripts(page: str) -> str:
    """The executable inline scripts of a page (not the JSON data block), joined."""
    return "\n".join(m[1] for m in re.finditer(r"<script(?![^>]*type=)[^>]*>([\s\S]*?)</script>", page))


class JsCases(unittest.TestCase):
    def check(self, src: str, want: str):
        self.assertEqual(strip_js(src), want)

    def test_whole_line_comments_and_indent(self):
        self.check("  // c\n  a = 1;\n\n    b = 2;\n", "a = 1;\nb = 2;\n")

    def test_trailing_comment_stripped_unless_license(self):
        self.check("  a = 1; // drop\n  b = 2; // MIT License\n", "a = 1;\nb = 2; // MIT License\n")

    def test_slashes_in_strings(self):
        self.check("  a = '//x';\n  b = \"// y\";\n", "a = '//x';\nb = \"// y\";\n")

    def test_regex_with_slashes(self):
        self.check("  r = /\\/\\//g;\n  // gone\n  s = x / 2 / 3;\n", "r = /\\/\\//g;\ns = x / 2 / 3;\n")

    def test_regex_with_quote_and_class(self):
        self.check("  r = /['\"`\\[/]/;\n  // gone\n  t = 1;\n", "r = /['\"`\\[/]/;\nt = 1;\n")

    def test_template_keeps_lines(self):
        src = "  x = `\n    // not a comment\n    http://a.b/c\n  `;\n  // gone\n  y = 1;\n"
        self.check(src, "x = `\n    // not a comment\n    http://a.b/c\n  `;\ny = 1;\n")

    def test_nested_template(self):
        src = "  x = `a ${ `\n   // in\n  ${ 1 }` } b\n    // keep`;\n  // gone\n  z = 2;\n"
        self.check(src, "x = `a ${ `\n   // in\n  ${ 1 }` } b\n    // keep`;\nz = 2;\n")

    def test_braces_inside_expr(self):
        src = "  x = `${ {a: 1}.a }\n   // keep\n`;\n  // gone\n"
        self.check(src, "x = `${ {a: 1}.a }\n   // keep\n`;\n")

    def test_block_comments(self):
        self.check("  /* a\n  b */\n  x = 1; /* t */ y = 2;\n  /*! keep */\n", "x = 1;   y = 2;\n/*! keep */\n")

    def test_license_kept(self):
        self.check("  // MIT License\n  // plain\n  a;\n", "// MIT License\na;\n")

    def test_unterminated_template_unchanged(self):
        src = "  a = `oops\n  // c\n"
        self.check(src, src)

    def test_deterministic(self):
        src = "  // c\n  a = `x\n  y`;\n"
        self.assertEqual(strip_js(src), strip_js(src))

    def test_minify_escapes_close_script(self):
        out = minify_js("const s = '<' + '/script>';\n")
        self.assertNotIn("</script>", out.lower())


class CssCases(unittest.TestCase):
    def test_comments_and_indent(self):
        self.assertEqual(strip_css("/* a */\n  .x {\n    color: red; /* c */\n  }\n"), ".x {\ncolor: red;\n}\n")

    def test_comment_in_string(self):
        self.assertEqual(strip_css('  .a::after { content: "/* x */"; }\n'), '.a::after { content: "/* x */"; }\n')
        self.assertEqual(strip_css("  .a { content: '/* x */'; }\n"), ".a { content: '/* x */'; }\n")

    def test_license_kept(self):
        self.assertEqual(strip_css("/*! keep */\n/* license x */\n/* drop */\na{}"), "/*! keep */\n/* license x */\na{}")

    def test_minify_css_wraps_long_blocks(self):
        big = ":root {\n" + "".join(f"  --var-{i}: #123456;\n" for i in range(150)) + "}\n"
        out = minify_css(big)
        self.assertTrue(all(len(line) < 2000 for line in out.splitlines()))


@unittest.skipUnless(NODE, "node not installed")
class RealPages(unittest.TestCase):
    def build(self, kind: str, mode: str) -> str:
        if mode == "minify":
            return layout_engine.assemble_page(kind)
        if mode == "strip":
            with mock.patch.object(layout_engine, "minify_js", strip_js), mock.patch.object(layout_engine, "minify_css", strip_css):
                return layout_engine.assemble_page(kind)
        with mock.patch.object(layout_engine, "minify_js", lambda s: s), mock.patch.object(layout_engine, "minify_css", lambda s: s):
            return layout_engine.assemble_page(kind)

    def test_pages_parse_and_keep_literals_in_strip_mode(self):
        kinds = sorted(p.name for p in (REPO_ROOT / "assets" / "types").iterdir() if p.is_dir())
        self.assertTrue(kinds)
        for kind in kinds:
            with self.subTest(kind=kind):
                raw = page_scripts(self.build(kind, "raw"))
                stripped = page_scripts(self.build(kind, "strip"))
                minified = page_scripts(self.build(kind, "minify"))
                self.assertLess(len(stripped), len(raw))
                self.assertLessEqual(len(minified), len(stripped))
                with tempfile.TemporaryDirectory() as tmp:
                    for name, code in (("strip.js", stripped), ("min.js", minified)):
                        f = Path(tmp) / name
                        f.write_text(code, encoding="utf-8")
                        r = subprocess.run([NODE, "--check", str(f)], capture_output=True, text=True)
                        self.assertEqual(r.returncode, 0, f"{kind}/{name}: {r.stderr}")
                r = subprocess.run([NODE, "--expose-internals", "-e", LITERALS_JS], input=json.dumps([raw, stripped]),
                                   capture_output=True, text=True)
                self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_pages_shrink_keep_html_comments(self):
        for kind in ("flowchart", "gantt"):
            before = self.build(kind, "raw")
            after = self.build(kind, "minify")
            self.assertLess(len(after), len(before))
            self.assertIn("<!-- ", after)  # HTML comments (repo link) stay

    def test_each_js_asset_parses_alone(self):
        files = sorted((REPO_ROOT / "assets").rglob("*.js"))
        for f in files:
            src = f.read_text(encoding="utf-8")
            out = strip_js(src)
            r0 = subprocess.run([NODE, "--expose-internals", "-e", LITERALS_JS], input=json.dumps([src, src]), capture_output=True, text=True)
            if r0.returncode != 0:
                continue  # not parseable as a plain script on its own: covered by the page test
            r = subprocess.run([NODE, "--expose-internals", "-e", LITERALS_JS], input=json.dumps([src, out]), capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, f"{f}: {r.stdout}{r.stderr}")


if __name__ == "__main__":
    unittest.main()
