# FOWS v0.5.0 — Workspace generator and guarded copy sorter

Node.js 20+, no npm install, no Rust/Python. This update is intended for an already-verified `0.4.0-node` installation. Existing `data/`, `README.md`, and user documents are preserved. No full reinstall.

## Windows quick start

From inside the **existing** FOWS program directory:

```bat
node bin\fows.js version
node bin\fows.js workspace-preview --root "D:\MyWork" --name "School" --template school
node bin\fows.js workspace-create --root "D:\MyWork" --name "School" --template school --yes
node bin\fows.js operations
```

**Sorting is copy-only** in v0.5, not moving/deleting originals:

```bat
node bin\fows.js sort-plan --root "D:\TestFiles" --target Sorted
node bin\fows.js sort-commit --plan OP-PASTE-ID-FROM-PLAN --yes
node bin\fows.js operations
node bin\fows.js undo --id OP-PASTE-ID-FROM-PLAN --yes
```

Test first on a disposable folder with a few files, not a system or borrowed drive.

## Workspace templates

- `developer`: projects for NodeJS/Python/Laravel, documents, exports and temporary files.
- `school`: administration, curriculum, learning, assignments, reports and exports.
- `general`: documents, projects, media, archives and exports.

`workspace-preview` makes **no directories**. `workspace-create` without `--yes` also previews; `--yes` creates fresh directories and records an operation. Target names can only contain letters/digits/underscore/dash, and cannot already exist. Windows-reserved device names are blocked. Use `undo --id <operation-id> --yes` to remove only empty folders the operation created; folders containing someone else's files are preserved.

## Guarded copy sorting

- `sort-plan` does a **fresh scan**, prepares a new output folder name, and calculates SHA-256 digests for all eligible top-level regular files. Symlinks, hardlinked source files, and nested source trees are not copied. A plan is persisted under `data/operations/`.
- Each plan is capped at **1000 files and 2 GiB total**. Source changes invalidate the plan.
- `sort-commit` requires `--yes`, verifies source hashes, then creates a *new* target folder and copies into category subdirectories (Documents, Images, Code, etc.). It rejects a target that already exists. Sources are never moved or deleted.
- `undo` deletes copied outputs **only if SHA-256 still matches the operation**. Modified or replaced files are retained and reported as `undo-partial`; run `undo` again after manually reviewing retained data, or leave it in place. The operation log is kept for audit.
- File writes are not guaranteed safe against a hostile concurrent process swapping directories/symlinks; use on trusted local folders with other applications closed. Interrupted/corrupt partial outputs are retained for review, not silently deleted.

## Operational limits

- Basic disk scanning is not equivalent to OS-level read/write auditing. No access-read telemetry.
- Existing v0.4 dashboard HTTP remains local and read-only; sort/create/undo deliberately have **no HTTP endpoints**.
- For v0.5, no AI, FTP/SFTP, global-drive bulk sorting, or automated guest cleanup yet.
- Parent directory outside the project is not used for updater backups. All persistent source upgrade backups are in `FOWS/.fows/backups/`; operation journals are in `FOWS/data/operations/`.

## Upgrader rules

Extract the **single folder inside the patch ZIP** beside the existing application, then run `UPGRADER.bat`. Verify `[TARGET]` is your existing FOWS project. Press ENTER once. Run `CHECK_VERSION.bat` afterward. If a code conflict occurs, do not overwrite files or delete `.fows`; use `UPGRADER_RECOVER.bat` only if an interrupted upgrade is reported. The patch folder itself may be deleted after verifying the upgrade.
