# Plan: Async Version Check (Runtime-Agnostic + SessionStart Hook)

Status: Completed (2026-11-22, PR #79).

## Goal

Let the AI agent know when a newer release of `ultimate-diagram` is available on GitHub without wasting an agent tool call or slowing down session startup or diagram generation. Keep the core mechanism completely runtime-agnostic across all 6 supported runtimes (`antigravity`, `claude`, `copilot`, `codex`, `gemini`, `kiro`), while wiring optional async `SessionStart` hooks for runtimes that support user-level session hooks.

## Design

### 1. Core module: `scripts/version_check.py` (Python 3.9+ stdlib only)

Single source of truth for reading the installed version, checking the local cache, triggering a non-blocking background refresh, and formatting update guidance.

- **Installed version:** Read `version` from `SKILL.md` frontmatter (fallback: `package.json`).
- **Install mode detection:** Detect whether `<skill-dir>` is a symlink/junction to a git clone (`.git` present at resolved path) vs a standalone copy install (`npx` / zip).
  - Copy install update command: `npx khanhchungoc/ultimate-diagraming-skill`
  - Local clone/symlink update command: `git pull` (inside the resolved repo directory)
- **Remote source:** GitHub Releases API (`https://api.github.com/repos/khanhchungoc/ultimate-diagraming-skill/releases/latest`, reading `tag_name` stripped of leading `v`). Zero external dependencies (`urllib.request`).
- **Local cache:** `~/.cache/ultimate-diagram/version.json` (on Windows: `%LOCALAPPDATA%\ultimate-diagram\version.json`, or `XDG_CACHE_HOME` on Linux/macOS):
  ```json
  {
    "checked_at": 1763817600,
    "latest": "1.1.52",
    "release_url": "https://github.com/khanhchungoc/ultimate-diagraming-skill/releases/tag/v1.1.52",
    "error": null
  }
  ```
- **Cadence & non-blocking behavior:**
  - Cache TTL: **24 hours** (`86400` s) for successful checks; **4 hours** backoff on network failure so offline or firewalled machines never hang or spam retries.
  - Hard network timeout: **3 seconds** inside the detached background worker.
  - Opt-out: `ULTIMATE_DIAGRAM_NO_UPDATE_CHECK=1` (and skip automatically in `CI=true` / `GITHUB_ACTIONS=true`).
  - Spawning the background worker (`python scripts/version_check.py --refresh`): fully detached (`start_new_session=True` on POSIX; `CREATE_NO_WINDOW | DETACHED_PROCESS` on Windows), `stdin/stdout/stderr=DEVNULL`, never awaited by the caller.
- **Semver comparison:** Pure tuple comparison `(major, minor, patch)` so `1.1.51 > 1.1.50` and dev/prerelease versions do not trigger false alerts.

### 2. Two entry points sharing the same core & cache

1. **Universal path (all 6 runtimes): `scripts/layout_engine.py`**
   - On normal CLI runs (`--layout`, `--extract`), read the local cache (`< 1 ms`).
   - If cache is missing/stale, kick off the detached `--refresh` worker without waiting.
   - If the cached `latest` is newer than the installed version, emit a single `[INFO]` line before `[DONE]`:
     ```text
     [INFO] Update available: ultimate-diagram v1.1.50 -> v1.1.52 (update with: npx khanhchungoc/ultimate-diagraming-skill). Ask the user if they want you to run the update or update it themselves.
     ```
2. **Async `SessionStart` hook mode (`scripts/version_check.py --hook <runtime>`):**
   - Runs at session start for runtimes with user-level JSON hook configs (initially **Claude Code** `~/.claude/settings.json` and **Gemini CLI** `~/.gemini/settings.json`; architecture allows adding other runtimes cleanly once they stabilize a user-level hook schema).
   - If the cache is stale, fetches in the hook itself (when running as an `"async": true` hook in Claude Code) or refreshes via the detached worker, then compares versions.
   - **Silent when up to date** (outputs nothing, exit 0 — zero context pollution).
   - **When outdated:** Emits the runtime's expected hook JSON payload (`additionalContext` for Claude Code / Gemini CLI) telling the agent:
     - A newer version of `ultimate-diagram` is available (`vX -> vY`).
     - Inform the user right away on the first turn of the session and let them choose whether the agent should run the update command for them or they prefer to run it themselves.

### 3. Installer wiring (`bin/install.js` and `scripts/install.py`)

- Register the `SessionStart` hook cleanly into existing user-level settings files for supported runtimes (`claude`, `gemini`), preserving all existing user hooks and updating in-place (idempotent on reinstall; identified by a stable marker in the command path `ultimate-diagram/scripts/version_check.py`).
- Add `--no-hooks` flag to both installers to opt out of hook registration.
- Do not break project-scoped installs or runtimes that do not use `settings.json` hooks (all 6 runtimes still get the `layout_engine.py` cache check automatically).
- Update `SKILL.md` (short note under Final Report or Paths) so agents know how to handle the `[INFO] Update available` line (present both choices: let the agent run the update or self-install with the printed command).

## Phases

### Phase 1: Core `scripts/version_check.py` + `layout_engine.py` integration
- Implement `scripts/version_check.py` (cache read/write, semver comparison, install mode detection, detached `--refresh`, `--hook claude|gemini`, `--check`).
- Wire non-blocking cache check + `[INFO] Update available` output into `scripts/layout_engine.py` CLI entry point (skipped during tests / `ULTIMATE_DIAGRAM_NO_UPDATE_CHECK=1`).
- Document the update-choice instruction briefly in `SKILL.md`.

### Phase 2: Installer hook registration
- Add idempotent `SessionStart` hook registration (with `--no-hooks` opt-out) to `bin/install.js` and `scripts/install.py` for Claude Code (`~/.claude/settings.json`, with `"async": true`) and Gemini CLI (`~/.gemini/settings.json`).
- Ensure `package.json` `files` and copy-install filter include `scripts/version_check.py` (already covered by `scripts/*.py`).

### Phase 3: Verification & tests
- Add unit tests in `dev/tests/unit/test_version_check.py`:
  - Semver comparison (`1.1.50` vs `1.1.51`, `1.2.0`, equal, older remote).
  - Cache hit, stale cache triggers refresh, failure backoff, `ULTIMATE_DIAGRAM_NO_UPDATE_CHECK=1`.
  - Copy vs symlink/git-clone command selection.
  - Hook output format: empty when up to date, valid JSON with `additionalContext` when outdated.
  - Local HTTP mock server test for `--refresh` (no live GitHub dependency in tests).
- Extend `dev/tests/unit/test_install.py` to test hook merge (preserving existing hooks, idempotent re-run, `--no-hooks`).
- Run `python3 dev/tests/unit/test_version_check.py`, `python3 dev/tests/unit/test_install.py`, and smoke-test `layout_engine.py`.

## Not doing

- Auto-updating files silently in the background without user confirmation.
- Checking npm registry (releases are published exclusively on GitHub Releases).
- Adding external HTTP or packaging dependencies.
