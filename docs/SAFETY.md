# Safety model (v0.1 Node.js)

- Target directories are read-only **from the FOWS code path**; scanner uses `opendir`/`lstat` and watch is a repeated scanner. No CLI command writes/deletes/moves files in the selected root.
- FOWS stores its own JSON and JSONL metadata in `data/` inside the source tree by default. If `data/` is nested beneath the monitored root, it is excluded to avoid watch loops.
- User may relocate metadata via `--data`/`FOWS_DATA_DIR`; choose a path on portable media when using another person's device.
- Symlinks are cataloged, not traversed.
- Scan errors are reported; watch refuses incomplete baselines and skips incomplete subsequent scans instead of interpreting missing paths as deletes.
- Polling can miss changes between intervals. Diff is based on `size`, `mtimeMs`, `type`, and path, not content hashes.
- No attempt is made to erase host OS logs, audit records, caches, access logs, or browsing history. FOWS should not claim absence of residue.
- Web UI binds strictly to `127.0.0.1` and has no write endpoints. Do not expose it through public tunnels unless separately protected.
- JSON manifests contain file names/paths, potentially sensitive; protect removable media.
- Sessions aren't auto-restored after abnormal termination. A stale `running` flag could remain; baseline/latest snapshots still permit diff. Future versions should recover interrupted state explicitly.
