#!/usr/bin/env python3
"""Release helper. Source of truth for the version: package.json.

  release.py version   print the version
  release.py bump      patch+1 in package.json, package-lock.json and SKILL.md
  release.py zip       build ultimate-diagram-v<version>.zip in the repo root

Standard library only. See dev/versioning.md.
"""
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def version() -> str:
    return json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]


def bump() -> str:
    major, minor, patch = version().split(".")
    new = f"{major}.{minor}.{int(patch) + 1}"
    for name, pattern in (("package.json", r'("version": ")[^"]+'),
                          ("package-lock.json", r'("version": ")[^"]+'),
                          ("SKILL.md", r"(?m)^(version: ).+")):
        path = ROOT / name
        text = path.read_text(encoding="utf-8")
        # package.json: first match is the package; lockfile: first two are the root package.
        count = 2 if name == "package-lock.json" else 1
        path.write_text(re.sub(pattern, rf"\g<1>{new}", text, count=count), encoding="utf-8")
    return new


def zip_release() -> Path:
    ver = version()
    top = "ultimate-diagram"  # folder inside the zip: users extract it as-is
    # Same exclusions as the installers' copy mode.
    skip = {".git", ".github", ".claude", ".agents", ".codegraph", ".codex", ".gemini", ".kiro", ".vscode",
            ".mcp.json", "AGENTS.md", "agent", "dev", "bin", "docs",
            "node_modules", "skills-lock.json", "__pycache__", ".gitignore",
            "package-lock.json", "CLAUDE.md"}
    files = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True,
                           check=True).stdout.splitlines()
    out = ROOT / f"ultimate-diagram-v{ver}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            if not set(Path(f).parts) & skip:
                z.write(ROOT / f, f"{top}/{f}")
    return out


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "version":
        print(version())
    elif cmd == "bump":
        print(bump())
    elif cmd == "zip":
        print(zip_release())
    else:
        sys.exit(__doc__)
