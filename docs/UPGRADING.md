# FOWS Upgrade-in-place — v0.1.0-node to v0.2.0-node

## Windows: one root, one ENTER

1. **Stop** FOWS watcher and dashboard before upgrading. Keep your current FOWS folder: do **not** uninstall, rename, delete or manually copy data.
2. Download `FOWS-v0.2.0-UPGRADE-IN-PLACE.zip` and extract **its contents directly inside your existing FOWS-Node-v0.1.0 folder** (the one containing `package.json`, `bin/`, `lib/`, `data/`). Do **not** extract into a second FOWS-v0.2 folder. Files added by extraction: `UPGRADER.bat` plus a temporary `.fows-upgrade/` folder.
3. Double-click `UPGRADER.bat`. It runs a **precheck before touching existing source**. If any target file was locally modified, upgrade **stops without overwriting it**.
4. If precheck passes, press **ENTER once** to upgrade. A code-only backup is created under `.fows/backups/<upgrade-id>/` inside the **existing** project.
5. After success, the temporary `.fows-upgrade/` payload is removed. `UPGRADER.bat` and `UPGRADER.sh` remain **permanent update commands**; `CHECK_VERSION.bat` and `CHECK_VERSION.sh` are the persistent checkers. No sibling version folder is created.
6. Run `CHECK_VERSION.bat` or `node bin/fows.js version` to verify version, managed hashes, and upgrade history. Existing `data/` inventories and sessions remain unchanged.

## Linux/Termux (same ZIP)

Extract ZIP contents directly into current project root. Run `sh UPGRADER.sh` for the same precheck, one-ENTER confirmation, and automatic temporary-payload cleanup. Alternatively, from that root:

```sh
node .fows-upgrade/apply.mjs --check
node .fows-upgrade/apply.mjs --apply
node scripts/version-check.mjs
rm -r .fows-upgrade        # remove ONLY after confirmed success
```

`--check` only reads project files. `--apply` uses lock, precheck, internal backup, and rollback. Windows BAT handles cleanup automatically on success.

## Conflict, interruption, re-run

- **Version guard**: patch accepts only original `0.1.0-node` or a verified already-installed `0.2.0-node`. Never downgrade or skip versions.
- **Hash guard**: every overwritten file must match official `0.1.0-node` hash. Unexpected target files are blocked. The patch will not silently replace user customizations.
- **Future patches** use `.fows/install-state.json` checksums and version to prevent conflict. The checker flags drift; future upgrade scripts should compare expected hashes of files they replace, rather than blindly copying files.
- **Backup & journal** live only under `.fows/` in project. Code backups do not include your `data/`; no data migration occurs in this patch. Backups should not be deleted until you verify the upgrade.
- **Failed upgrade**: a caught error triggers code rollback. A process kill or power loss cannot guarantee automatic rollback; if `.fows/pending.json` remains, use `node .fows-upgrade/apply.mjs --recover` after ensuring no updater is running. Keep patch files until recovery finishes. Do not delete the backup manually.
- **Re-run same patch**: treated as already installed when the checksum checker is clean. If version is `0.2.0-node` but file hashes drift, it refuses instead of claiming success.
- **Rollback after successful upgrade** is deliberately not one-click in this release. Backups are retained for manual restoration; automatic rollback is for failures during the same transaction.

## Safe-mode notes

Do not run upgrades while FOWS is watching its own source directory; the code files will change by design. Filesystem changes in external watched folders are not made by this upgrade. This project does **not** erase OS activity logs or third-party program traces.

## Current v0.2.0 feature scope

`scan`, `types`, `search`, `watch`, `sessions`, `diff`, `stats`, `serve`, `doctor`, `version`; native notification + polling reconciliation, with fallback. SQLite, multi-root UI, sorter, cleanup, AI and SFTP are not implemented yet.
