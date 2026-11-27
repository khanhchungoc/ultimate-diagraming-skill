#!/usr/bin/env python3
"""Shrink bundled JS and CSS before they go into a page. Standard library only, deterministic.

JS: drop whole-line `//` comments, `/* */` comments and leading indentation, but only where a small scanner knows the
text is plain code. Anything inside a template literal (including `${ }` code), string, or regex is left exactly as it
is, because a template can hold CSS, HTML, Mermaid text or SVG where indentation and `//` are content. If the scanner
ends in a state it does not trust (an unterminated string, template or comment), the whole input is returned unchanged.
Trailing `//` comments on code lines are never touched.

CSS: drop `/* */` comments outside strings, and leading indentation.

License or attribution comments (`/*!`, or text mentioning license or copyright) are kept in both.
"""

from __future__ import annotations

import functools
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import List, Optional

_KEEP = re.compile(r"licen[sc]e|copyright", re.I)
_REGEX_AFTER_WORDS = {"return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "yield", "await", "instanceof"}
_REGEX_AFTER_CHARS = set("(,=:[!&|?{};+-*%<>~^")
_WORD = re.compile(r"[A-Za-z_$][\w$]*")
_CLOSE_SCRIPT = re.compile(r"</script", re.I)
_CTRL_BYTES = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_REPO_ROOT = Path(__file__).resolve().parent.parent


def _find_esbuild() -> Optional[str]:
    """Return path to local or PATH esbuild binary, or None when unavailable (or disabled via env)."""
    if os.environ.get("UD_NO_ESBUILD"):
        return None
    for name in ("esbuild", "esbuild.cmd"):
        local = _REPO_ROOT / "node_modules" / ".bin" / name
        if local.is_file():
            return str(local)
    return shutil.which("esbuild")


def _wrap_css_lines(css: str, max_len: int = 160) -> str:
    """Break minified CSS onto lines after `}` or `;` outside strings/parens so no line exceeds the 2000-char limit."""
    out: List[str] = []
    cur: List[str] = []
    cur_len = 0
    paren = 0
    i, n = 0, len(css)
    while i < n:
        c = css[i]
        if c in "'\"":
            j = i + 1
            while j < n and css[j] != c:
                j += 2 if css[j] == "\\" else 1
            tok = css[i:min(j + 1, n)]
            cur.append(tok)
            cur_len += len(tok)
            i = j + 1
            continue
        if c == "(":
            paren += 1
        elif c == ")" and paren > 0:
            paren -= 1
        cur.append(c)
        cur_len += 1
        if paren == 0 and c in "};" and cur_len >= max_len:
            out.append("".join(cur))
            cur = []
            cur_len = 0
        i += 1
    if cur:
        out.append("".join(cur))
    return "\n".join(out) + ("\n" if out else "")


@functools.lru_cache(maxsize=256)
def _esbuild_minify(src: str, loader: str) -> Optional[str]:
    exe = _find_esbuild()
    if not exe:
        return None
    try:
        res = subprocess.run(
            [exe, f"--loader={loader}", "--minify", "--legal-comments=inline"],
            input=src,
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )
    except OSError:
        return None
    if res.returncode != 0:
        return None
    return res.stdout


def minify_js(src: str) -> str:
    """Minify JS via esbuild when installed, else fall back to pure-Python strip_js()."""
    if not src.strip():
        return ""
    out = _esbuild_minify(src, "js")
    if out is None:
        return strip_js(src)
    # Never let a folded string literal like "</script>" terminate the enclosing HTML <script> tag,
    # and keep ASCII control bytes escaped (Claude.ai artifact publishing rejects raw control bytes).
    out = _CLOSE_SCRIPT.sub(lambda m: "<\\/" + m.group(0)[2:], out)
    out = _CTRL_BYTES.sub(lambda m: f"\\x{ord(m.group(0)):02x}", out)
    return out.rstrip("\n") + "\n"


def minify_css(src: str) -> str:
    """Minify CSS via esbuild when installed, else fall back to pure-Python strip_css()."""
    if not src.strip():
        return ""
    out = _esbuild_minify(src, "css")
    if out is None:
        return strip_css(src)
    return _wrap_css_lines(out.strip())


def strip_js(src: str) -> str:
    """Return `src` without `//` comments, block comments and leading indentation (see module doc)."""
    out = _strip_js(src)
    return src if out is None else out


def _strip_js(src: str):
    lines = src.split("\n")
    # stack of contexts: "code" (top level), ("tmpl",) inside a template literal, ("expr", depth) inside ${ }
    stack: List[list] = [["code", 0]]
    last_char = ""    # last significant character (decides regex vs division)
    last_word = ""
    in_block = False   # inside a /* */ that is being removed
    keep_block = False  # inside a /* */ that is kept (license)
    str_q = ""         # inside a '...' or "..." that continues over a line end with a backslash
    out: List[str] = []
    for line in lines:
        was_block = in_block
        normal = stack == [["code", 0]] and not in_block and not keep_block and not str_q
        i, n = 0, len(line)
        buf: List[str] = []
        if normal:
            i = n - len(line.lstrip(" \t"))
            if line.startswith("//", i) and not _KEEP.search(line):
                continue
        removed_comment = False
        while i < n:
            c = line[i]
            top = stack[-1]
            if in_block:
                j = line.find("*/", i)
                if j < 0:
                    i = n
                else:
                    in_block, i = False, j + 2
                    buf.append(" ")
                continue
            if keep_block:
                j = line.find("*/", i)
                if j < 0:
                    buf.append(line[i:])
                    i = n
                else:
                    keep_block = False
                    buf.append(line[i:j + 2])
                    i = j + 2
                continue
            if str_q:
                j = i
                while j < n and line[j] != str_q:
                    j += 2 if line[j] == "\\" else 1
                if j >= n:  # still open: only a trailing backslash may continue it
                    if not line.endswith("\\"):
                        return None
                    buf.append(line[i:])
                    i = n
                else:
                    buf.append(line[i:j + 1])
                    i, str_q = j + 1, ""
                    last_char, last_word = '"', ""
                continue
            if top[0] == "tmpl":
                j = i
                while j < n:
                    if line[j] == "\\":
                        j += 2
                    elif line[j] == "`":
                        break
                    elif line[j] == "$" and line.startswith("${", j):
                        break
                    else:
                        j += 1
                buf.append(line[i:min(j, n)])
                if j >= n:
                    i = n
                elif line[j] == "`":
                    stack.pop()
                    buf.append("`")
                    i = j + 1
                    last_char, last_word = "`", ""
                else:
                    stack.append(["expr", 0])
                    buf.append("${")
                    i = j + 2
                    last_char, last_word = "{", ""
                continue
            # code context (top level or inside ${ })
            top_level = len(stack) == 1
            if c in " \t":
                buf.append(c)
                i += 1
            elif c == "/" and line.startswith("//", i):
                if not top_level or _KEEP.search(line[i:]):
                    buf.append(line[i:])
                else:
                    removed_comment = True
                i = n
            elif c == "/" and line.startswith("/*", i):
                j = line.find("*/", i + 2)
                text = line[i:j + 2] if j >= 0 else line[i:]
                if not top_level or line.startswith("/*!", i) or _KEEP.search(text):
                    buf.append(text)
                    if j < 0:
                        keep_block = True
                    i = n if j < 0 else j + 2
                else:
                    if j < 0:
                        in_block, i = True, n
                    else:
                        i = j + 2
                        buf.append(" ")
                    removed_comment = True
            elif c in "'\"":
                j = i + 1
                while j < n and line[j] != c:
                    j += 2 if line[j] == "\\" else 1
                if j >= n:
                    if not line.endswith("\\"):
                        return None
                    buf.append(line[i:])
                    str_q, i = c, n
                else:
                    buf.append(line[i:j + 1])
                    i = j + 1
                    last_char, last_word = c, ""
            elif c == "`":
                stack.append(["tmpl"])
                buf.append(c)
                i += 1
            elif c == "/":
                regex = last_char == "" or last_char in _REGEX_AFTER_CHARS or (last_char == "w" and last_word in _REGEX_AFTER_WORDS)
                end = _regex_end(line, i) if regex else -1
                if end > 0:
                    buf.append(line[i:end])
                    i = end
                    last_char, last_word = "r", ""
                else:
                    buf.append(c)
                    i += 1
                    last_char, last_word = "/", ""
            elif c == "{":
                if top[0] == "expr":
                    top[1] += 1
                buf.append(c)
                i += 1
                last_char, last_word = c, ""
            elif c == "}":
                if top[0] == "expr":
                    if top[1] == 0:
                        stack.pop()
                    else:
                        top[1] -= 1
                buf.append(c)
                i += 1
                last_char, last_word = c, ""
            else:
                m = _WORD.match(line, i)
                if m:
                    buf.append(m.group())
                    i = m.end()
                    last_char, last_word = "w", m.group()
                else:
                    buf.append(c)
                    i += 1
                    last_char, last_word = c, ""
        text = "".join(buf)
        if was_block and stack == [["code", 0]] and not in_block and not keep_block and not str_q:
            text = text.strip(" \t")  # the tail of a removed block comment starts a plain line
            if not text:
                continue
        if normal:
            text = text.rstrip(" \t") if removed_comment else text
            if not text.strip():
                if line.strip() and not removed_comment:
                    out.append(text)
                continue  # blank or comment-only line
        out.append(text)
    if stack != [["code", 0]] or in_block or keep_block or str_q:
        return None
    return "\n".join(out) + ("\n" if src.endswith("\n") else "")


def _regex_end(line: str, i: int) -> int:
    """Index just past the regex literal (and flags) starting at line[i], or -1 if it does not close on this line."""
    j, n, in_class = i + 1, len(line), False
    while j < n:
        c = line[j]
        if c == "\\":
            j += 2
            continue
        if c == "[":
            in_class = True
        elif c == "]":
            in_class = False
        elif c == "/" and not in_class:
            j += 1
            while j < n and (line[j].isalnum() or line[j] == "_"):
                j += 1
            return j
        j += 1
    return -1


def strip_css(src: str) -> str:
    """Return `src` without `/* */` comments (outside strings) and compact whitespace."""
    i, n = 0, len(src)
    buf: List[str] = []
    while i < n:
        c = src[i]
        if c == "/" and src.startswith("/*", i):
            j = src.find("*/", i + 2)
            if j < 0:
                return src
            text = src[i:j + 2]
            if src.startswith("/*!", i) or _KEEP.search(text):
                buf.append(text)
            else:
                buf.append(" " if "\n" not in text else "")
            i = j + 2
        elif c in "'\"":
            j = i + 1
            while j < n and src[j] != c and src[j] != "\n":
                j += 2 if src[j] == "\\" else 1
            if j >= n or src[j] == "\n":
                return src  # unterminated string: do not guess
            buf.append(src[i:j + 1])
            i = j + 1
        else:
            buf.append(c)
            i += 1
    out: List[str] = []
    for line in "".join(buf).split("\n"):
        line = line.strip(" \t")
        if line:
            out.append(line)
    return "\n".join(out) + ("\n" if src.endswith("\n") and out else "")
