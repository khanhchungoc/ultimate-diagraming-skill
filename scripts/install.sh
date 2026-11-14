#!/usr/bin/env bash
#
# Installs ultimate-diagram into target AI agent runtimes at either User (global) or Project level.
# Works with bash 3.2 (macOS default): no associative arrays.
#
# Usage:
#   ./scripts/install.sh [--scope user|project] [--runtime all|antigravity|claude|copilot|codex|gemini|kiro] [--mode symlink|copy] [--target-path <path>]
#

set -e

SCOPE="user"
RUNTIME="all"
MODE="symlink"
TARGET_PATH="$(pwd)"
CLAUDE_OUTPUT=""   # ask | artifact | file; empty = not given (prompt when interactive)

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --scope|-s) SCOPE="$2"; shift ;;
        --runtime|-r) RUNTIME="$2"; shift ;;
        --mode|-m) MODE="$2"; shift ;;
        --target-path|-t) TARGET_PATH="$2"; shift ;;
        --claude-output)
            case "$2" in
                ask|artifact|file) CLAUDE_OUTPUT="$2" ;;
                *) echo "Error: --claude-output must be one of: ask, artifact, file"; exit 1 ;;
            esac
            shift ;;
        --help|-h)
            echo "Usage: $0 [--scope user|project] [--runtime all|antigravity|claude|copilot|codex|gemini|kiro] [--mode symlink|copy] [--target-path <path>] [--claude-output ask|artifact|file]"
            echo "  --claude-output  Claude Code only: publish diagrams as claude.ai Artifacts, write HTML files, or ask each time (default: ask)."
            echo "                   Saved to .claude/ultimate-diagram.json, never inside the skill folder; prompted in a terminal without this flag."
            exit 0
            ;;
        *) echo "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "==> Installing ultimate-diagram"
echo "    Source:  $REPO_ROOT"
echo "    Scope:   $SCOPE"
echo "    Mode:    $MODE"
echo "    Target:  $RUNTIME"

if [[ "$SCOPE" == "user" ]]; then BASE="$HOME"; else BASE="$TARGET_PATH"; fi

destination() {
    case "$1" in
        antigravity) if [[ "$SCOPE" == "user" ]]; then echo "$BASE/.gemini/config/skills/ultimate-diagram"; else echo "$BASE/.agents/skills/ultimate-diagram"; fi ;;
        claude)      echo "$BASE/.claude/skills/ultimate-diagram" ;;
        copilot)     if [[ "$SCOPE" == "user" ]]; then echo "$BASE/.copilot/skills/ultimate-diagram"; else echo "$BASE/.github/skills/ultimate-diagram"; fi ;;
        codex)       echo "$BASE/.agents/skills/ultimate-diagram" ;;
        gemini)      echo "$BASE/.gemini/skills/ultimate-diagram" ;;
        kiro)        echo "$BASE/.kiro/skills/ultimate-diagram" ;;
        *) return 1 ;;
    esac
}

case "$RUNTIME" in
    claude-code) RUNTIME="claude" ;;
    github-copilot|vscode-copilot) RUNTIME="copilot" ;;
esac

if [[ "$RUNTIME" == "all" ]]; then
    RUNTIMES=("antigravity" "claude" "copilot" "codex" "gemini" "kiro")
else
    destination "$RUNTIME" >/dev/null || { echo "Error: unknown runtime '$RUNTIME'"; exit 1; }
    RUNTIMES=("$RUNTIME")
fi

# Claude Code only: where a diagram goes. Stored beside Claude Code's own settings, never inside the skill folder
# (which may be a symlink to this repo). SKILL.md reads it.
CLAUDE_SELECTED=0
for rt in "${RUNTIMES[@]}"; do [[ "$rt" == "claude" ]] && CLAUDE_SELECTED=1; done
CLAUDE_CONFIG="$BASE/.claude/ultimate-diagram.json"
if [[ "$CLAUDE_SELECTED" == 1 && -z "$CLAUDE_OUTPUT" && -t 0 && -t 1 ]]; then
    echo "In Claude Code, publish diagrams as claude.ai Artifacts, write HTML files, or ask each time?"
    echo "  1) ask each time (default)"
    echo "  2) claude.ai Artifact (private page, Save updates it in place)"
    echo "  3) HTML file (in the project folder, works offline)"
    read -r -p "Choose [1-3]: " answer || answer=""
    case "$answer" in 2|artifact) CLAUDE_OUTPUT="artifact" ;; 3|file) CLAUDE_OUTPUT="file" ;; *) CLAUDE_OUTPUT="ask" ;; esac
    echo ""
fi
if [[ "$CLAUDE_SELECTED" == 1 && -n "$CLAUDE_OUTPUT" ]]; then
    mkdir -p "$(dirname "$CLAUDE_CONFIG")"
    # Keep other keys of an existing file when Python is around; else write the one key
    for py in python3 python; do
        if "$py" -c 'import sys; sys.exit(sys.version_info < (3, 9))' >/dev/null 2>&1; then
            "$py" - "$CLAUDE_CONFIG" "$CLAUDE_OUTPUT" <<'PYEOF' && break
import json, sys
path, value = sys.argv[1], sys.argv[2]
try:
    cfg = json.load(open(path, encoding="utf-8"))
    cfg = cfg if isinstance(cfg, dict) else {}
except (OSError, ValueError):
    cfg = {}
cfg["output"] = value
open(path, "w", encoding="utf-8").write(json.dumps(cfg, indent=2) + "\n")
PYEOF
        fi
    done
    if [[ ! -f "$CLAUDE_CONFIG" ]]; then
        printf '{\n  "output": "%s"\n}\n' "$CLAUDE_OUTPUT" > "$CLAUDE_CONFIG"
    elif ! grep -q "\"output\": *\"$CLAUDE_OUTPUT\"" "$CLAUDE_CONFIG" 2>/dev/null; then
        echo "    Warning: Python 3.9+ not found, so $CLAUDE_CONFIG was left as is. Set \"output\": \"$CLAUDE_OUTPUT\" in it by hand." >&2
    fi
fi

installed=0
last_dest="$REPO_ROOT"
for rt in "${RUNTIMES[@]}"; do
    dest="$(destination "$rt")"
    mkdir -p "$(dirname "$dest")"

    # A link (even one pointing at the repo) is safe to replace; a real folder that IS the repo is not.
    if [[ ! -L "$dest" && -d "$dest" && "$(cd "$dest" && pwd -P)" == "$(cd "$REPO_ROOT" && pwd -P)" ]]; then
        echo "    Target ($rt) -> $dest is the source repository; skipping to prevent self-deletion."
        continue
    fi

    if [[ -L "$dest" ]]; then
        rm "$dest"                       # the link only, never what it points to
    elif [[ -e "$dest" ]]; then
        echo "    Removing existing target at $dest"
        rm -rf "$dest"
    fi

    if [[ "$MODE" == "symlink" ]]; then
        echo "    Linking ($rt) -> $dest"
        ln -s "$REPO_ROOT" "$dest"
    else
        echo "    Copying ($rt) -> $dest"
        mkdir -p "$dest"
        for item in "$REPO_ROOT"/*; do
            case "$(basename "$item")" in
                node_modules|dev|bin|docs|skills-lock.json) continue ;;
                *) cp -R "$item" "$dest/" ;;
            esac
        done
        find "$dest" -name __pycache__ -type d -prune -exec rm -rf {} +
    fi
    installed=$((installed + 1))
    last_dest="$dest"
done

echo ""
echo "[SUCCESS] Installed ultimate-diagram to $installed target(s)."
if [[ "$CLAUDE_SELECTED" == 1 ]]; then
    echo "    Claude Code output: ${CLAUDE_OUTPUT:-ask (default)}. Change it with --claude-output or \"output\" in $CLAUDE_CONFIG"
fi
echo ""

# Check the installed copy can run: its files, Python 3.9+, a browser, Node.js.
for py in python3 python; do
    # Probe first: skips stubs (e.g. the Windows Store alias) and interpreters older than 3.9.
    if "$py" -c 'import sys; sys.exit(sys.version_info < (3, 9))' >/dev/null 2>&1; then
        exec "$py" "$last_dest/scripts/check_env.py"
    fi
done
echo "[MISSING] Python 3.9+ is not on PATH; the skill's scripts need it."
exit 1
