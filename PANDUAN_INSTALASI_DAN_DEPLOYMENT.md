# PANDUAN INSTALASI, MIGRASI DATA & DEPLOYMENT (TAHAP 1 – TAHAP 9)
## SISTEM INFORMASI MANAJEMEN STOK GUDANG — PALANG MERAH INDONESIA KOTA SURAKARTA
**Subjudul:** Pengelolaan Logistik, Persediaan, dan Distribusi Bantuan

---

## DAFTAR FILE SOURCE CODE PROJECT

Seluruh file source code lengkap telah tersedia di direktori:
`C:\Users\Humas IT\.gemini\antigravity\scratch\pmi-surakarta-warehouse\`

| No | Nama File | Tipe di Google Apps Script | Fungsi Utama |
| :-: | :--- | :--- | :--- |
| 1 | `appsscript.json` | Manifest JSON | Konfigurasi zona waktu `Asia/Jakarta`, runtime V8, dan izin Web App |
| 2 | `Config.gs` | Script (`.gs`) | Konfigurasi 10 sheet database, 3 kategori barang (`FOOD ITEMS`, `NON FOOD`, `OBAT`), warna PMI, dan matriks RBAC |
| 3 | `Utils.gs` | Script (`.gs`) | Pembuatan ID unik, hashing SHA-256, kalkulasi status kedaluwarsa aktual, penomoran otomatis (`BM`, `BK`, `SO`, `DST`), upload dokumen Drive, dan `LockService` |
| 4 | `Database.gs` | Script (`.gs`) | Fungsi `setupDatabase()` otomatis 10 sheet, CRUD berbasis ID unik, seeding data Gudang PB, log aktivitas, dan backup ke Google Drive |
| 5 | `Auth.gs` | Script (`.gs`) | Autentikasi login, manajemen sesi token server, validasi akses di sisi server (`ADMIN`, `PETUGAS GUDANG`, `PIMPINAN`), dan manajemen pengguna |
| 6 | `Barang.gs` | Script (`.gs`) | CRUD Master Data Barang, validasi keunikan Kode Barang, manajemen Donor, dan migrasi cerdas dari file `Stock Report Gudang PB.xlsx` |
| 7 | `Transaksi.gs` | Script (`.gs`) | Transaksi Barang Masuk (GRN), Barang Keluar (GDN) dengan penolakan otomatis jika stok kurang, Kartu Stok (*Stock Card*), dan rekalkulasi `STOCK_BALANCE` |
| 8 | `StockOpname.gs` | Script (`.gs`) | Jadwal & lembar kerja Stock Opname (`PENDING`) serta persetujuan Administrator (`APPROVED` / `REJECTED`) |
| 9 | `Dashboard.gs` | Script (`.gs`) | Analitik Dashboard Real-Time (8 KPI utama, 4 grafik Chart.js, aktivitas terbaru, stok kritis, dan peringatan kedaluwarsa) |
| 10 | `Laporan.gs` | Script (`.gs`) | Monitoring Expired Date otomatis (4 status) dan generator 12 jenis Laporan Resmi berkop PMI Kota Surakarta |
| 11 | `Code.gs` | Script (`.gs`) | Entry point Web App (`doGet`), helper `include()`, menu kustom Spreadsheet, dan router API terpusat (`processApiRequest`) |
| 12 | `Index.html` | HTML (`.html`) | Kerangka utama halaman login, sidebar melengkung bergaya modern (*PinHome UI* dengan warna Merah PMI `#D71920`), header, dan container cetak |
| 13 | `CSS.html` | HTML (`.html`) | Desain antarmuka responsif, kartu KPI, tabel modern, badge status, dan aturan cetak dokumen (`@media print`) |
| 14 | `Components.html` | HTML (`.html`) | Seluruh tampilan 10 menu modul dan 6 modal form interaktif |
| 15 | `JavaScript.html` | HTML (`.html`) | Controller frontend, komunikasi `google.script.run`, Chart.js, parser multi-sheet Excel (SheetJS), export `.xlsx`, dan cetak PDF/dokumen resmi |
| 16 | `Preview_Lokal_PMI_Surakarta.html` | Preview Lokal | File bundel mandiri untuk membuka dan menguji langsung antarmuka aplikasi di browser komputer sebelum di-deploy ke Google Apps Script |

---

## TAHAP 1: MEMBUAT GOOGLE SPREADSHEET DATABASE

1. Buka browser dan masuk ke akun Google resmi **PMI Kota Surakarta**.
2. Buka [Google Sheets](https://sheets.new) untuk membuat spreadsheet baru.
3. Beri nama file spreadsheet tersebut:
   **`DATABASE_STOK_GUDANG_PMI_KOTA_SURAKARTA`**
4. Salin **Spreadsheet ID** dari bilah alamat URL browser Anda (bagian di antara `/d/` dan `/edit`, contoh: `1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890`).
   > **Catatan:** Jika Anda membuka Apps Script langsung dari menu **Ekstensi > Apps Script** di dalam Google Spreadsheet tersebut (*Container-Bound Script*), sistem akan mendeteksi Spreadsheet aktif secara otomatis tanpa perlu menyalin ID.

---

## TAHAP 2: MEMBUAT PROJECT GOOGLE APPS SCRIPT

1. Pada Google Spreadsheet yang baru dibuat di Tahap 1, klik menu **Ekstensi (Extensions)** > **Apps Script**.
2. Klik judul project di kiri atas dan ubah namanya menjadi:
   **`SIM_STOK_GUDANG_PMI_KOTA_SURAKARTA`**
3. Klik ikon **Pengaturan Project (⚙️ Project Settings)** di sidebar kiri:
   - Centang kotak **"Tampilkan file manifes 'appsscript.json' di editor"** (*Show "appsscript.json" manifest file in editor*).
4. Kembali ke menu **Editor (`< >`)** di sidebar kiri.

---

## TAHAP 3: MEMASUKKAN SELURUH FILE SOURCE CODE

Masukkan ke-15 file Google Apps Script ke dalam editor dengan urutan berikut:

### A. File Manifest
1. Klik file **`appsscript.json`** di daftar file kiri, hapus isinya, lalu tempel (*paste*) seluruh isi dari file lokal `appsscript.json`.

### B. 10 File Backend Script (`.gs`)
1. File `Code.gs` sudah tersedia secara bawaan. Hapus isinya, lalu tempel seluruh kode dari file lokal **`Code.gs`**.
2. Untuk 9 file `.gs` lainnya, klik tombol **`+` (Tambahkan file / Add a file)** > pilih **Skrip (Script)**.
   > **Penting:** Saat mengetik nama file di Google Apps Script, **jangan** mengetik akhiran `.gs` (cukup ketik `Config`, `Utils`, dst. karena Google Apps Script menambahkan `.gs` secara otomatis).
   - Buat **`Config`** -> tempel seluruh isi `Config.gs` (Jika menggunakan *Standalone Script*, isi `SPREADSHEET_ID` pada baris 18; jika *Container-Bound*, biarkan `''`).
   - Buat **`Utils`** -> tempel seluruh isi `Utils.gs`
   - Buat **`Database`** -> tempel seluruh isi `Database.gs`
   - Buat **`Auth`** -> tempel seluruh isi `Auth.gs`
   - Buat **`Barang`** -> tempel seluruh isi `Barang.gs`
   - Buat **`Transaksi`** -> tempel seluruh isi `Transaksi.gs`
   - Buat **`StockOpname`** -> tempel seluruh isi `StockOpname.gs`
   - Buat **`Dashboard`** -> tempel seluruh isi `Dashboard.gs`
   - Buat **`Laporan`** -> tempel seluruh isi `Laporan.gs`

### C. 4 File Frontend Antarmuka (`.html`)
1. Klik tombol **`+` (Tambahkan file / Add a file)** > pilih **HTML**.
   > **Penting:** Saat mengetik nama file HTML, **jangan** mengetik akhiran `.html` (cukup ketik `Index`, `CSS`, `Components`, `JavaScript`). Perhatikan huruf besar/kecil agar sama persis:
   - Buat **`Index`** -> tempel seluruh isi `Index.html`
   - Buat **`CSS`** -> tempel seluruh isi `CSS.html`
   - Buat **`Components`** -> tempel seluruh isi `Components.html`
   - Buat **`JavaScript`** -> tempel seluruh isi `JavaScript.html`
2. Tekan **`Ctrl + S`** (atau ikon disket **Simpan project**) untuk menyimpan seluruh file.

---

## TAHAP 4: MENJALANKAN FUNGSI SETUP AWAL (`setupDatabase`)

1. Di bagian atas editor Google Apps Script, pilih file **`Database.gs`**.
2. Pada dropdown daftar fungsi di sebelah tombol **Jalankan (Run)**, pilih fungsi **`setupDatabase`**.
3. Klik tombol **Jalankan (Run)**.
4. Saat pertama kali dijalankan, Google akan menampilkan dialog **"Otorisasi diperlukan" (Authorization required)**:
   - Klik **Tinjau izin (Review permissions)**.
   - Pilih akun Google Anda.
   - Jika muncul layar peringatan *"Google belum memverifikasi aplikasi ini"*, klik **Lanjutan (Advanced)** > klik **Buka SIM_STOK_GUDANG_PMI_KOTA_SURAKARTA (tidak aman)**.
   - Klik **Izinkan (Allow)**.
5. Tunggu hingga log eksekusi menampilkan pesan selesai. Buka kembali tab Google Spreadsheet Anda; kini sudah terbentuk **10 Sheet Database** secara otomatis dengan header berwarna Merah PMI (`#D71920`):
   1. `USERS`
   2. `MASTER_BARANG`
   3. `TRANSAKSI_MASUK`
   4. `TRANSAKSI_KELUAR`
   5. `STOCK_BALANCE`
   6. `STOCK_OPNAME`
   7. `DISTRIBUSI`
   8. `DONOR_SUMBER`
   9. `LOG_AKTIVITAS`
   10. `SETTINGS`

---

## TAHAP 5: MENGATUR AKUN ADMINISTRATOR & PEJABAT PENANDATANGAN

Fungsi `setupDatabase()` otomatis membuat 3 akun awal untuk setiap level akses (password disimpan dalam bentuk hash SHA-256):

| Level Akses (Role) | Username Default | Password Default | Nama & Jabatan Default | Hak Akses Utama |
| :--- | :---: | :---: | :--- | :--- |
| **ADMIN** | `admin` | `admin123` | Administrator Logistik PMI | Akses penuh seluruh fitur, kelola pengguna, kelola master barang, edit/hapus transaksi, setujui stock opname, import Excel, backup & audit log |
| **PETUGAS GUDANG** | `petugas` | `petugas123` | Indro Sri Widodo (*KaSie Kesiapsiagaan dan Respon*) | Melihat stok, input barang masuk (GRN), input barang keluar (GDN), kartu stok, melihat 12 laporan, dan menginput pemeriksaan stock opname |
| **PIMPINAN** | `pimpinan` | `pimpinan123` | Wanto, S.KM. (*KaBag PB & Relawan*) | Melihat dashboard real-time, melihat stok, melihat 12 laporan, distribusi bantuan & nilai persediaan (tanpa akses mengubah data transaksi) |

**Cara Mengubah Password Admin & Pejabat Laporan setelah Login:**
1. Masuk ke aplikasi menggunakan akun **`admin`** / **`admin123`**.
2. Buka menu **Pengguna & Sistem** di sidebar kiri.
3. Klik tombol **Edit** pada baris akun `admin` untuk mengganti password administrator dengan password produksi yang aman, atau klik **+ Tambah Pengguna** untuk membuat akun petugas baru.
4. Pada panel **Identitas Instansi & Pejabat Laporan**, sesuaikan nama Kepala Markas / KaBag PB & Relawan serta Koordinator Gudang PB, lalu klik **Simpan Pengaturan Instansi**.

---

## TAHAP 6: MELAKUKAN IMPORT DATA EXCEL (`Stock Report Gudang PB.xlsx`)

1. Login sebagai **ADMIN**, lalu klik menu **Migrasi Data Excel** di sidebar kiri (atau tombol **Import Excel** pada halaman Master Data Barang).
2. Klik **Pilih File (Choose File)** pada kolom `FILE EXCEL (.XLSX / .XLS / .CSV)` dan pilih file **`Stock Report Gudang PB.xlsx`** milik Gudang PB PMI Kota Surakarta.
   - *(Anda juga dapat mengunduh contoh template multi-sheet melalui tombol **"Template Excel PB"** di bagian bawah sidebar kiri).*
3. Sistem secara otomatis mendeteksi seluruh sheet di dalam file Excel (misalnya **Food Items**, **Non Food**, **Obat**) dan memetakan kategorinya. Anda dapat menyesuaikan kategori tiap sheet melalui dropdown yang tersedia.
4. Klik **Tampilkan Preview & Validasi**:
   - Sistem mendukung struktur header 2-baris maupun 1-baris pada `Stock Report Gudang PB.xlsx`.
   - Sistem secara cerdas membedakan baris **Master & Mutasi**, **Baris Transaksi Lanjutan** (seperti pengeluaran *Sabun Mandi* ke *Kel. Nusukan* dan *Kel. Joyosuran*, atau pengeluaran *Family Kit* ke *Kel. Gandekan* dan *Kel. Manahan*), serta **Detail Expired Komponen** (seperti komponen *Hygiene Kit*: Sabun Mandi, Pasta Gigi, Shampo), dan melewati baris `Total :` maupun blok tanda tangan bawah.
5. Setelah memeriksa tabel preview, klik tombol **Jalankan Import ke Database**.
6. Sistem akan menampilkan **Laporan Hasil Migrasi Data Excel** (jumlah baris diproses, master barang baru, master barang terhubung, transaksi masuk dibuat, transaksi keluar dibuat, serta baris dilewati). File Excel sumber Anda **tidak diubah atau dihapus**.

---

## TAHAP 7: MELAKUKAN PENGUJIAN TRANSAKSI & FITUR UTAMA

Lakukan pengujian menyeluruh dengan skenario operasional berikut:

1. **Uji Tambah Master Barang:**
   - Buka menu **Master Data Barang** > klik **+ Tambah Barang**.
   - Pilih kategori (`FOOD ITEMS`, `NON FOOD`, atau `OBAT`), isi Nama Barang, Satuan, Harga, Donor, Stok Minimum, dan Lokasi Rak.
   - Coba masukkan Kode Barang yang sudah ada -> pastikan sistem menolak kode duplikat.
2. **Uji Transaksi Barang Masuk (GRN):**
   - Buka menu **Barang Masuk (GRN)** > klik **+ Input Barang Masuk**.
   - Pilih barang, masukkan jumlah masuk (misal `50`), nomor dokumen GRN, donor, dan tanggal kedaluwarsa, lalu klik **Simpan Barang Masuk**.
   - Pastikan saldo stok barang tersebut langsung bertambah `+50` secara otomatis dan klik ikon **Cetak (🖨️)** untuk mencetak Bukti Penerimaan Barang (GRN).
3. **Uji Transaksi Barang Keluar (GDN) & Validasi Penolakan Stok Kurang:**
   - Buka menu **Barang Keluar (GDN)** > klik **+ Input Barang Keluar**.
   - Pilih barang dan coba masukkan jumlah keluar **melebihi** stok tersedia -> pastikan muncul peringatan merah dan sistem **menolak** penyimpanan transaksi.
   - Masukkan jumlah keluar yang valid (misal `10`), isi Tujuan Distribusi & Nama Penerima, lalu simpan -> pastikan saldo stok berkurang `-10` otomatis dan tercetak Bukti Pengeluaran Barang (GDN).
4. **Uji Kartu Stok (Stock Card):**
   - Buka menu **Kartu Stok (Stock Card)**, pilih barang yang baru ditransaksikan -> pastikan tabel menampilkan riwayat kronologis dengan rumus `Saldo Akhir = Saldo Sebelumnya + Barang Masuk - Barang Keluar`, lalu uji tombol **Cetak Kartu Stok** dan **Export Excel**.
5. **Uji Stock Opname & Persetujuan Admin:**
   - Buka menu **Stock Opname** > klik **Buat Jadwal / Input Stock Opname**.
   - Isi jumlah fisik yang berbeda dari stok sistem pada salah satu barang, isi alasan selisih, lalu simpan.
   - Periksa Master Barang -> pastikan stok sistem **belum berubah** selama status Stock Opname masih `PENDING`.
   - Sebagai **ADMIN**, klik tombol **Setujui (`✓ Setujui`)** pada baris Stock Opname tersebut -> pastikan status berubah menjadi `APPROVED` dan saldo stok sistem kini otomatis menyesuaikan dengan jumlah fisik.
6. **Uji Monitoring Expired Date & 12 Laporan Resmi:**
   - Buka menu **Monitoring Expired** -> pastikan barang terklasifikasi otomatis ke dalam 4 kartu status (**Aman > 90 hari**, **Perhatian 31–90 hari**, **Segera Kedaluwarsa 1–30 hari**, **Kedaluwarsa <= 0 hari**).
   - Buka menu **Pusat Laporan (12)** -> pilih masing-masing dari ke-12 laporan, uji filter tanggal/kategori/donor, lalu klik **Export Excel (.xlsx)** dan **Export PDF / Print Langsung**.

---

## TAHAP 8: DEPLOY SEBAGAI WEB APP

1. Di pojok kanan atas editor Google Apps Script, klik tombol biru **Terapkan (Deploy)** > pilih **Deployment baru (New deployment)**.
2. Klik ikon roda gigi (⚙️) di sebelah *"Pilih jenis" (Select type)* > pilih **Aplikasi web (Web app)**.
3. Isi konfigurasi deployment sebagai berikut:
   - **Deskripsi:** `Rilis Produksi v2.0 - SIM Stok Gudang PMI Kota Surakarta`
   - **Jalankan sebagai (Execute as):** **Saya (Me)** — *(agar aplikasi memiliki akses penuh ke database Google Spreadsheet tanpa mengharuskan setiap petugas membuka file spreadsheet secara langsung)*.
   - **Siapa yang memiliki akses (Who has access):** **Siapa saja (Anyone)** — *(keamanan data tetap terlindungi penuh oleh halaman Login & validasi token RBAC di sisi server aplikasi)*.
4. Klik tombol **Terapkan (Deploy)**.
5. Salin **URL Aplikasi Web (Web app URL)** yang berakhiran `/exec`.

---

## TAHAP 9: MEMBERIKAN URL APLIKASI KEPADA PENGGUNA

1. Bagikan **URL Aplikasi Web (`/exec`)** kepada seluruh pengguna Gudang PMI Kota Surakarta sesuai perannya:
   - **Administrator Logistik & Gudang PB** (Role: `ADMIN`)
   - **Petugas Operasional Gudang PB** (Role: `PETUGAS GUDANG`)
   - **Kepala Markas / Pengurus / KaBag PB & Relawan** (Role: `PIMPINAN`)
2. Pengguna dapat membuka URL tersebut dari **Komputer, Laptop, Tablet, maupun Smartphone** (Android/iOS) dan menambahkan pintasan (*Add to Home Screen*) layaknya aplikasi mobile modern.
3. Untuk keamanan data operasional, **jangan membagikan akses edit langsung ke file Google Spreadsheet database** kepada pengguna non-admin, sehingga seluruh mutasi barang wajib melewati validasi aplikasi dan tercatat di `LOG_AKTIVITAS`.
