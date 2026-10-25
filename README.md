# FOWS v0.1.0 (Node.js Edition)

**File Operations & Workspace System** — MVP inventaris file, pemantauan perubahan per sesi, diff, pencarian, statistik waktu, dan dashboard lokal.

> Cocok untuk percobaan di Windows, Debian/Linux, dan Termux. Aplikasi masih **read-only terhadap folder target**: tidak memindahkan atau menghapus file yang sedang dipantau. FOWS menulis data miliknya sendiri pada folder `data/` di samping source aplikasi secara default.

## Kebutuhan

- Node.js **20 atau lebih baru** (`node -v`).
- **Tidak perlu Rust, Python, MySQL, npm install, atau koneksi internet.**
- Windows PowerShell/CMD, Linux terminal, atau Termux.

## Windows — paling mudah

1. Ekstrak ZIP, contohnya ke `D:\FOWS-Node-v0.1.0` (lebih baik ke drive portable untuk percobaan guest mode).
2. Klik dua kali **`RUN_WINDOWS.bat`**, masukkan folder target, lalu ikuti pilihan scan dan watch.
3. Atau klik **`DASHBOARD_WINDOWS.bat`** lalu buka `http://127.0.0.1:8765` di browser.
4. Semua sesi dan indeks disimpan ke `data/` di dalam folder aplikasi.

> Folder target yang dibaca boleh `D:\Project Saya`, `C:\Users\Nama\Documents`, dll. Mulai dari folder kecil untuk uji.

### CLI manual di Windows

```powershell
node .\bin\fows.js doctor
node .\bin\fows.js scan --root "D:\Proyek Saya"
node .\bin\fows.js types --root "D:\Proyek Saya"
node .\bin\fows.js search --root "D:\Proyek Saya" --query "pdf"
node .\bin\fows.js watch --root "D:\Proyek Saya" --interval 1000 --seconds 60
node .\bin\fows.js sessions
node .\bin\fows.js diff --session latest
node .\bin\fows.js stats --session latest --interval 1m
node .\bin\fows.js serve --port 8765
```

## Linux/Debian

```bash
cd FOWS-Node-v0.1.0
node bin/fows.js doctor
node bin/fows.js scan --root "$HOME/Documents" --exclude '**/node_modules/**'
node bin/fows.js watch --root "$HOME/Documents" --interval 1000 --seconds 30
node bin/fows.js diff --session latest
node bin/fows.js serve
```

## Termux

Letakkan sumber proyek pada direktori privat Termux, contohnya `~/fows`:

```bash
pkg install nodejs
cd ~/fows
node bin/fows.js doctor
node bin/fows.js scan --root "$HOME"
```

Jika ingin akses penyimpanan bersama Android, jalankan `termux-setup-storage` dan berikan izin sebelum memindai path `~/storage/shared` (sesuai dukungan perangkat). Pemantauan latar belakang di Android tidak dijamin akan bertahan saat sistem membatasi proses Termux.

## Fitur saat ini

| Perintah | Fungsi |
|---|---|
| `scan --root PATH` | Katalog file, direktori, symlink, ekstensi dan total ukuran logis |
| `types --root PATH` | Peringkat ekstensi berdasar total ukuran |
| `search --root PATH --query TEKS` | Cari nama/path dalam inventaris terbaru (bukan isi file) |
| `watch --root PATH` | Sesi pemantauan berbasis polling dengan snapshot awal dan akhir |
| `sessions` | Daftar sesi |
| `diff --session latest` | Perbedaan file sejak baseline suatu sesi |
| `stats --session latest --interval 1s` | Rekap event per detik, menit, atau jam |
| `serve` | Dashboard & REST API lokal, read-only |
| `doctor` | Pemeriksaan Node/OS dan lokasi data |

Gunakan `--json` pada `scan`, `types`, `search`, `sessions`, `diff`, `stats`, atau `doctor` untuk format JSON. Gunakan `--exclude '**/node_modules/**' --exclude '**/.git/**'` pada `scan`/`watch` untuk mengecualikan subtree. Contoh `--interval 1000` berarti 1000 ms, bukan satu menit.

## Penyimpanan

```text
FOWS-Node-v0.1.0/
  bin/             Perintah utama
  lib/             Engine scanner, watcher, diff, storage, server
  test/            Unit/integration tests
  data/            Dibuat otomatis; indeks/sesi (tidak masuk paket ZIP)
    inventories/   Snapshot hasil scan per-root
    sessions/      Meta, baseline.json, latest.json, events.jsonl
```

Secara default, `data/` selalu berada di samping source FOWS, terlepas dari working directory terminal. Untuk mengganti, tambahkan `--data "/path/ke/data"` pada **setiap** perintah atau set environment variable `FOWS_DATA_DIR`.

Jangan menaruh database aktif di cloud-drive yang berisiko konflik sinkronisasi. Jangan menyebarkan data sesi karena dapat mengungkapkan nama file/path sensitif.

## Contoh endpoint dashboard (hanya localhost)

- `GET /api/v1/health`
- `GET /api/v1/inventories`
- `GET /api/v1/sessions`
- `GET /api/v1/sessions/{id}/diff`
- `GET /api/v1/sessions/{id}/events`

Dashboard memakai `http://127.0.0.1:8765`. Versi ini **tidak** mengizinkan bind ke internet atau jaringan LAN, upload/download jarak jauh, serta perintah mutasi via HTTP. Keamanan akses publik akan ditambahkan terpisah di fase mendatang.

## Batasan penting

1. Polling bukan kernel filesystem event watcher; file yang dibuat dan dihapus di antara dua interval mungkin tidak terdeteksi. Scan pada folder besar dapat lebih lambat dari interval konfigurasi.
2. Perubahan isi file dengan ukuran dan mtime yang sama bisa luput. Hash penuh belum tersedia.
3. Rename/move sementara dilaporkan sebagai DELETE+CREATE, bukan pengenalan rename yang pasti.
4. Statistik menunjukkan pertambahan/perubahan **ukuran logis** dan event teramati, **bukan jumlah byte fisik read/write disk**. Operasi READ file belum diaudit.
5. Snapshot menyimpan seluruh daftar file di JSON: belum dioptimasi untuk jutaan file dan memori sangat terbatas.
6. Tidak ada cleanup/rollback otomatis, sorter aktif, AI, maupun FTP/WebDAV/SFTP pada versi ini.
7. Jika root memiliki permission error, inventaris dapat tidak lengkap dan watcher akan menolak baseline yang tidak utuh. Scan yang gagal saat watch **tidak** dihitung sebagai DELETE.
8. Mode portable mengendalikan output **FOWS**, bukan cache/log OS atau aplikasi pihak ketiga. Tidak ada jaminan laptop host tidak mencatat penggunaan.

## Pengujian

```bash
npm test
# atau tanpa npm:
node --test
```

Pengujian otomatis mencakup glob exclusion, scanner, diff, journal watch, dan keamanan HTTP read-only. Perlu pengujian nyata terpisah di Windows dan Termux.

## Roadmap

- v0.2: watcher native + reconciliation, hash on-demand, streaming/batched index, multi-root, metrics lebih lengkap.
- v0.3: template workspace generator, preview-only sorting, kebijakan rollback aman dan quarantine.
- v0.4: auth & izin akses HTTP, file sharing terbatas, audit akses.
- v0.5+: AI metadata-first, content-on-demand, WebDAV/SFTP.

**Lisensi:** MIT. Lihat [docs/SAFETY.md](docs/SAFETY.md).

## Upgrade-in-place v0.2.0

- Run `node bin/fows.js version` or double-click `CHECK_VERSION.bat` to check the installed version, hashes of FOWS-managed code, and last upgrade.
- The v0.2 watcher defaults to **hybrid**: `fs.watch` notifications plus periodic full rescan. On unsupported filesystems it falls back to polling; override via `--strategy poll`.
- `--interval` controls reconciliation cadence and `--debounce 200` controls notification burst batching. Native notifications can be missed; snapshot reconciliation is essential.
- Updating an existing v0.1.0 installation requires the **separate FOWS-v0.2.0-UPGRADE-IN-PLACE.zip**, extracted **into the existing root** (not a new sibling folder). Double-click `UPGRADER.bat` (Windows) or run `sh UPGRADER.sh` (Linux/Termux), then press ENTER once after a successful precheck.
- History, backup and update state are kept inside `.fows/` in the existing project; `data/` is preserved. See [docs/UPGRADING.md](docs/UPGRADING.md).
# folder-manager-gds
