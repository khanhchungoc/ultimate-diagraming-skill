#!/usr/bin/env bash
#
# Installs ultimate-diagram into target AI agent runtimes at either User (global) or Project level.
#
# Usage:
#   ./scripts/install.sh [--scope user|project] [--runtime all|antigravity|claude|copilot|codex|gemini|kiro] [--mode symlink|copy] [--target-path <path>]
#

set -e

SCOPE="user"
RUNTIME="all"
MODE="symlink"
TARGET_PATH="$(pwd)"

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --scope|-s) SCOPE="$2"; shift ;;
        --runtime|-r) RUNTIME="$2"; shift ;;
        --mode|-m) MODE="$2"; shift ;;
        --target-path|-t) TARGET_PATH="$2"; shift ;;
        --help|-h)
            echo "Usage: $0 [--scope user|project] [--runtime all|antigravity|claude|copilot|codex|gemini|kiro] [--mode symlink|copy]"
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

declare -A DESTINATIONS

if [[ "$SCOPE" == "user" ]]; then
    DESTINATIONS["antigravity"]="$HOME/.gemini/config/skills/ultimate-diagram"
    DESTINATIONS["claude"]="$HOME/.claude/skills/ultimate-diagram"
    DESTINATIONS["copilot"]="$HOME/.copilot/skills/ultimate-diagram"
    DESTINATIONS["codex"]="$HOME/.agents/skills/ultimate-diagram"
    DESTINATIONS["gemini"]="$HOME/.gemini/skills/ultimate-diagram"
    DESTINATIONS["kiro"]="$HOME/.kiro/skills/ultimate-diagram"
else
    DESTINATIONS["antigravity"]="$TARGET_PATH/.agents/skills/ultimate-diagram"
    DESTINATIONS["claude"]="$TARGET_PATH/.claude/skills/ultimate-diagram"
    DESTINATIONS["copilot"]="$TARGET_PATH/.github/skills/ultimate-diagram"
    DESTINATIONS["codex"]="$TARGET_PATH/.agents/skills/ultimate-diagram"
    DESTINATIONS["gemini"]="$TARGET_PATH/.gemini/skills/ultimate-diagram"
    DESTINATIONS["kiro"]="$TARGET_PATH/.kiro/skills/ultimate-diagram"
fi

if [[ "$RUNTIME" == "claude-code" ]]; then
    RUNTIME="claude"
elif [[ "$RUNTIME" == "github-copilot" || "$RUNTIME" == "vscode-copilot" ]]; then
    RUNTIME="copilot"
fi

if [[ "$RUNTIME" == "all" ]]; then
    RUNTIMES=("antigravity" "claude" "copilot" "codex" "gemini" "kiro")
else
    RUNTIMES=("$RUNTIME")
fi

canonical_repo="$(cd "$REPO_ROOT" && pwd)"

for rt in "${RUNTIMES[@]}"; do
    dest="${DESTINATIONS[$rt]}"
    parent_dir="$(dirname "$dest")"
    mkdir -p "$parent_dir"

    if [[ -d "$dest" ]]; then
        canonical_dest="$(cd "$dest" && pwd)"
    else
        canonical_dest="$(cd "$parent_dir" && pwd)/$(basename "$dest")"
    fi

    if [[ "$canonical_dest" == "$canonical_repo" ]]; then
        echo "    Target ($rt) -> $dest is the source repository; skipping to prevent self-deletion."
        continue
    fi

    if [[ -e "$dest" || -L "$dest" ]]; then
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
            base="$(basename "$item")"
            case "$base" in
                .git|node_modules|.github|dev|skills-lock.json) continue ;;
                *) cp -R "$item" "$dest/" ;;
            esac
        done
    fi
done

echo ""
echo "[SUCCESS] Successfully installed ultimate-diagram to ${#RUNTIMES[@]} target(s)."
