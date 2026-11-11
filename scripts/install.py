#!/usr/bin/env python3
"""Cross-platform installation script for ultimate-diagram.

Installs ultimate-diagram into target AI agent runtimes at either User (global)
or Project level, using symlinks (or Windows directory junctions) or standalone copies.

Zero external dependencies - standard library only.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

# Supported runtime destinations
DESTINATIONS_USER = {
    "antigravity": Path.home() / ".gemini" / "config" / "skills" / "ultimate-diagram",
    "claude": Path.home() / ".claude" / "skills" / "ultimate-diagram",
    "copilot": Path.home() / ".copilot" / "skills" / "ultimate-diagram",
    "codex": Path.home() / ".agents" / "skills" / "ultimate-diagram",
    "gemini": Path.home() / ".gemini" / "skills" / "ultimate-diagram",
    "kiro": Path.home() / ".kiro" / "skills" / "ultimate-diagram",
}

def get_project_destinations(project_path: Path) -> dict[str, Path]:
    return {
        "antigravity": project_path / ".agents" / "skills" / "ultimate-diagram",
        "claude": project_path / ".claude" / "skills" / "ultimate-diagram",
        "copilot": project_path / ".github" / "skills" / "ultimate-diagram",
        "codex": project_path / ".agents" / "skills" / "ultimate-diagram",
        "gemini": project_path / ".gemini" / "skills" / "ultimate-diagram",
        "kiro": project_path / ".kiro" / "skills" / "ultimate-diagram",
    }

def normalize_runtime(runtime: str) -> str:
    r = runtime.lower()
    if r in ("github-copilot", "vscode-copilot"):
        return "copilot"
    if r == "claude-code":
        return "claude"
    return r

COPY_IGNORED = (".git", "node_modules", ".github", "agent", ".agents", ".claude", "dev", "bin", "docs",
                "skills-lock.json", "__pycache__", ".gitignore")


def is_link(target: Path) -> bool:
    """Symlink or Windows junction. Path.is_junction() needs Python 3.12, so read the reparse flag."""
    if target.is_symlink():
        return True
    if sys.platform == "win32":
        try:
            return bool(os.lstat(target).st_file_attributes & 0x400)  # FILE_ATTRIBUTE_REPARSE_POINT
        except OSError:
            return False
    return False


def remove_existing(target: Path) -> None:
    if is_link(target):
        # Removes only the link or junction, never the source repo it points to.
        os.rmdir(target) if sys.platform == "win32" and not target.is_symlink() else target.unlink()
    elif target.is_dir():
        shutil.rmtree(target)
    elif target.exists():
        target.unlink()

def copy_skill(source: Path, target: Path) -> None:
    shutil.copytree(source, target, ignore=shutil.ignore_patterns(*COPY_IGNORED))

def create_link(source: Path, target: Path) -> None:
    try:
        if sys.platform == "win32":
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                target.symlink_to(source, target_is_directory=True)
            except OSError:
                res = os.system(f'cmd /c mklink /J "{target}" "{source}" >nul 2>&1')
                if res != 0:
                    raise
        else:
            target.symlink_to(source, target_is_directory=True)
    except Exception as e:
        print(f"  [!] Symlink/junction failed ({e}). Falling back to copy...")
        copy_skill(source, target)

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Install ultimate-diagram into AI agent runtimes (User or Project level)."
    )
    parser.add_argument(
        "--scope", "-s",
        choices=["user", "project"],
        default="user",
        help="Installation scope: 'user' (global) or 'project' (current workspace). Default: user.",
    )
    parser.add_argument(
        "--runtime", "-r",
        default="all",
        help="Target runtime harness: all, antigravity, claude, copilot, codex, gemini, kiro. Default: all.",
    )
    parser.add_argument(
        "--mode", "-m",
        choices=["symlink", "copy"],
        default="symlink",
        help="Install mode: symlink (directory link/junction) or copy. Default: symlink.",
    )
    parser.add_argument(
        "--target-path", "-t",
        default=".",
        help="Target workspace root for project-level scope. Default: current working directory.",
    )

    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    target_path = Path(args.target_path).resolve()
    selected_runtime = normalize_runtime(args.runtime)

    print(f"==> Installing ultimate-diagram")
    print(f"    Source:  {repo_root}")
    print(f"    Scope:   {args.scope}")
    print(f"    Mode:    {args.mode}")
    print(f"    Target:  {args.runtime}")
    print()

    destinations = (
        DESTINATIONS_USER if args.scope == "user" else get_project_destinations(target_path)
    )

    if selected_runtime != "all":
        if selected_runtime not in destinations:
            print(f"Error: Unknown runtime '{args.runtime}'. Supported: {', '.join(destinations.keys())}, all", file=sys.stderr)
            return 1
        targets = {selected_runtime: destinations[selected_runtime]}
    else:
        targets = destinations

    canonical_repo = repo_root.resolve()
    installed = 0
    last_dest = repo_root
    for rt, dest in targets.items():
        # A link pointing at the repo is safe to replace (only the link is removed); a real folder
        # that IS the repo is not.
        if not is_link(dest) and dest.resolve() == canonical_repo:
            print(f"    Target ({rt}) -> {dest} is the source repository; skipping to prevent self-deletion.")
            continue

        print(f"==> Processing [{rt}] -> {dest}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() or is_link(dest):
            print(f"    Existing installation found at {dest}. Replacing...")
            remove_existing(dest)

        if args.mode == "symlink":
            create_link(repo_root, dest)
            print(f"    [+] Linked to {dest}")
        else:
            copy_skill(repo_root, dest)
            print(f"    [+] Copied to {dest}")
        installed += 1
        last_dest = dest

    print()
    print(f"[SUCCESS] Installed ultimate-diagram to {installed} target(s).")
    print(flush=True)
    # Check the installed copy itself, so a copy that missed files is caught.
    check = subprocess.run([sys.executable, str(last_dest / "scripts" / "check_env.py")])
    return check.returncode

if __name__ == "__main__":
    sys.exit(main())
