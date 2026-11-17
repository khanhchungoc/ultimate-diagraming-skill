# Versioning

Format: `MAJOR.MINOR.PATCH`.

- **Source of truth:** `version` in `package.json`.
- **Mirrors** (kept in sync by `dev/release.py bump`): `package-lock.json` and the `version:` line in `SKILL.md` frontmatter.
- **Shown:** by every installer (`bin/install.js`, `scripts/install.py`, `install.sh`, `install.ps1`) from the installed copy's `package.json`, and in `SKILL.md`.

## Rules

- On every push to `main` that touches the shipped skill (`SKILL.md`, `package.json`, `assets/`, `references/`, `scripts/`, `bin/`; the `paths:` filter in the workflow), `.github/workflows/release.yml` releases the committed version if it has no `vX.Y.Z` tag yet (so the first release is `1.0.0`); otherwise it bumps **PATCH** first. Do not bump patch by hand.
- **MINOR / MAJOR** are bumped by hand: set `package.json`, `package-lock.json` and `SKILL.md` to `X.Y.0` in the PR. The next push to `main` publishes `X.Y.0` itself, since that tag doesn't exist yet.
- The workflow commits the bump as `Release vX.Y.Z [skip ci]`, tags `vX.Y.Z`, then publishes a GitHub release with `ultimate-diagram-vX.Y.Z.zip` attached. The `[skip ci]` message and an `if:` guard stop the bump commit from re-triggering the workflow.
- Changes to `main` that are pushed concurrently queue (workflow `concurrency`), so versions never collide.

## Release zip (install without Node.js)

`python dev/release.py zip` builds `ultimate-diagram-vX.Y.Z.zip`: tracked skill files only (no `dev/`, `bin/`, `docs/`, `.github/`, `.claude/`). Users unzip it and run `python scripts/install.py --mode copy` (or `scripts/install.sh`, `scripts/install.ps1`), or just copy the `ultimate-diagram` folder inside the zip into their assistant's skills directory.
