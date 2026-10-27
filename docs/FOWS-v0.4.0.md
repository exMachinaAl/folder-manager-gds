# FOWS v0.4.0 — fitur baru dan batasannya

- Live-monitor dashboard: `node bin/fows.js serve` lalu buka http://127.0.0.1:8765. Polling 3 detik membaca jurnal sesi tersimpan, bukan I/O disk fisik.
- Banding dua sesi: `node bin/fows.js compare --left ID1 --right ID2` (harus root folder sama).
- Preview pengelompokan file: `node bin/fows.js scan --root "PATH"` lalu `node bin/fows.js sort-preview --root "PATH"`.
- Hanya file di root teratas yang dijadikan kandidat sortir. File di subfolder proyek, symlink, dan file lain tidak dipindahkan.
- Endpoint baru: `/api/v1/sessions/{id}/activity`, `/api/v1/compare?left=...&right=...`, `/api/v1/sort/preview?root=...`.
- Semua endpoint tetap read-only dan server hanya bind ke 127.0.0.1. Belum tersedia API publik, AI, atau operasi move otomatis.
- Pembacaan dari data/sessions masih menggunakan snapshot JSON, bukan SQLite. Belum audit akses READ atau physical WRITE byte.
- Upgrade ZIP berisi folder patch; jangan di-merge ke proyek. Jalankan `UPGRADER.bat` pada folder patch yang sejajar folder FOWS asli.
- Semua file data/ dan edit lokal dokumentasi dipertahankan. File kode yang tidak cocok baseline tetap akan membuat upgrade berhenti.
