#!/usr/bin/env python3
"""Cross-platform installation script for ultimate-diagram.

Installs ultimate-diagram into target AI agent runtimes at either User (global)
or Project level, using symlinks (or Windows directory junctions) or standalone copies.

Zero external dependencies - standard library only.
"""

from __future__ import annotations

import argparse
import json
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
                res = subprocess.run(
                    ["cmd", "/c", "mklink", "/J", str(target), str(source)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                if res.returncode != 0:
                    raise
        else:
            target.symlink_to(source, target_is_directory=True)
    except Exception as e:
        print(f"  [!] Symlink/junction failed ({e}). Falling back to copy...")
        copy_skill(source, target)

def _is_our_version_hook(entry: object) -> bool:
    """Return True if a SessionStart hook entry belongs to ultimate-diagram's version check."""
    if not isinstance(entry, dict):
        return False
    hooks = entry.get("hooks")
    if not isinstance(hooks, list):
        return False
    for h in hooks:
        if not isinstance(h, dict):
            continue
        cmd = str(h.get("command", "")).replace("\\", "/")
        if "ultimate-diagram" in cmd and "version_check.py" in cmd:
            return True
    return False


def build_version_hook_entry(runtime: str, skill_dest: Path, python_cmd: str | None = None) -> dict:
    """Build the SessionStart hook entry for a supported runtime ('claude' or 'gemini')."""
    py = python_cmd or ("python" if sys.platform == "win32" else "python3")
    script = skill_dest / "scripts" / "version_check.py"
    command = f'{py} "{script}" --hook {runtime}'
    if runtime == "claude":
        hook = {"type": "command", "command": command, "async": True, "timeout": 10}
    else:
        hook = {"type": "command", "command": command, "timeout": 5000}
    return {"hooks": [hook]}


def register_version_hook(
    runtime: str,
    settings_path: Path,
    skill_dest: Path,
    python_cmd: str | None = None,
) -> tuple[bool, str]:
    """Idempotently merge ultimate-diagram's SessionStart version check hook into settings.json."""
    if settings_path.exists():
        try:
            data = json.loads(settings_path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                return False, f"skipped {settings_path} (root JSON is not an object)"
        except (OSError, ValueError) as exc:
            return False, f"skipped {settings_path} (could not parse JSON: {exc})"
    else:
        data = {}

    hooks = data.get("hooks")
    if hooks is None:
        hooks = {}
        data["hooks"] = hooks
    elif not isinstance(hooks, dict):
        return False, f"skipped {settings_path} ('hooks' is not an object)"

    session_start = hooks.get("SessionStart")
    if session_start is None:
        session_start = []
        hooks["SessionStart"] = session_start
    elif not isinstance(session_start, list):
        return False, f"skipped {settings_path} ('hooks.SessionStart' is not a list)"

    entry = build_version_hook_entry(runtime, skill_dest, python_cmd=python_cmd)
    updated = [e for e in session_start if not _is_our_version_hook(e)]
    updated.append(entry)
    hooks["SessionStart"] = updated

    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return True, str(settings_path)


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

    parser.add_argument(
        "--claude-output",
        choices=["ask", "artifact", "file"],
        default=None,
        help="Claude Code only: publish diagrams as claude.ai Artifacts, write HTML files, or ask each time "
             "(default: ask). Saved to .claude/ultimate-diagram.json, never inside the skill folder; "
             "prompted when run in a terminal without this flag.",
    )
    parser.add_argument(
        "--no-hooks",
        action="store_true",
        help="Skip registering async SessionStart version-check hooks in runtime settings.json files.",
    )

    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    target_path = Path(args.target_path).resolve()
    selected_runtime = normalize_runtime(args.runtime)

    try:
        version = json.loads((repo_root / "package.json").read_text(encoding="utf-8"))["version"]
    except (OSError, ValueError, KeyError):
        version = "unknown"
    print(f"==> Installing ultimate-diagram v{version}")
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

    # Snapshot which hook-capable runtime directories already existed before we create skill folders.
    hook_base = Path.home() if args.scope == "user" else target_path
    hook_dirs = {"claude": hook_base / ".claude", "gemini": hook_base / ".gemini"}
    preexisting_hook_dirs = {rt: p.exists() for rt, p in hook_dirs.items()}

    # Claude Code only: where a diagram goes. Stored beside Claude Code's own settings, never inside the skill
    # folder (which may be a symlink to this repo). SKILL.md reads it.
    claude_selected = "claude" in targets
    claude_config = hook_dirs["claude"] / "ultimate-diagram.json"
    claude_output = args.claude_output
    if claude_selected and claude_output is None and sys.stdin.isatty() and sys.stdout.isatty():
        print("In Claude Code, publish diagrams as claude.ai Artifacts, write HTML files, or ask each time?")
        print("  1) ask each time (default)\n  2) claude.ai Artifact (private page, Save updates it in place)\n"
              "  3) HTML file (in the project folder, works offline)")
        try:
            answer = input("Choose [1-3]: ").strip().lower()
        except EOFError:
            answer = ""
        claude_output = {"2": "artifact", "artifact": "artifact", "3": "file", "file": "file"}.get(answer, "ask")
        print()
    if claude_selected and claude_output is not None:
        try:
            cfg = json.loads(claude_config.read_text(encoding="utf-8"))
            cfg = cfg if isinstance(cfg, dict) else {}
        except (OSError, ValueError):
            cfg = {}
        cfg["output"] = claude_output
        claude_config.parent.mkdir(parents=True, exist_ok=True)
        claude_config.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")

    canonical_repo = repo_root.resolve()
    installed = 0
    last_dest = repo_root
    installed_dests: dict[str, Path] = {}
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
        installed_dests[rt] = dest

    if not args.no_hooks:
        for rt in ("claude", "gemini"):
            if rt not in installed_dests:
                continue
            # Under --runtime all at user scope, only touch runtimes that are actually present.
            if selected_runtime == "all" and args.scope == "user" and not preexisting_hook_dirs[rt]:
                continue
            ok, msg = register_version_hook(rt, hook_dirs[rt] / "settings.json", installed_dests[rt])
            if ok:
                print(f"    [+] Registered {rt} SessionStart version-check hook -> {msg}")
            else:
                print(f"    [!] Hook warning ({rt}): {msg}")

    print()
    print(f"[SUCCESS] Installed ultimate-diagram to {installed} target(s).")
    if claude_selected:
        shown = claude_output if claude_output is not None else "ask (default)"
        print(f"    Claude Code output: {shown}. Change it with --claude-output or \"output\" in {claude_config}")
    print(flush=True)
    # Check the installed copy itself, so a copy that missed files is caught.
    check = subprocess.run([sys.executable, str(last_dest / "scripts" / "check_env.py")])
    return check.returncode

if __name__ == "__main__":
    sys.exit(main())
