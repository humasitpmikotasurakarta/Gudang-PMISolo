# Panduan Menghubungkan Google Apps Script (GAS) ke Vercel
## Sistem Informasi Manajemen Stok Gudang — PMI Kota Surakarta

Arsitektur ini memungkinkan Anda meng-hosting tampilan aplikasi (**Frontend HTML/CSS/JS**) di **Vercel** (sehingga memiliki domain bersih seperti `https://gudang-pmi-surakarta.vercel.app`, sangat cepat, dan tanpa *banner* Google Apps Script di bagian atas), sementara **Database & Backend API** tetap menggunakan **Google Apps Script + Google Spreadsheet**.

---

## Tahap 1: Perbarui & Deploy Ulang Google Apps Script (`Code.gs`)

Agar Google Apps Script dapat menerima *request* data dari Vercel, `Code.gs` kini telah dilengkapi fungsi **`doPost(e)`** dan output JSON `ContentService`.

1. Buka editor **Google Apps Script** proyek Anda.
2. Salin isi file **[Code.gs](file:///c:/Users/Humas%20IT/.gemini/antigravity/scratch/pmi-surakarta-warehouse/Code.gs)** terbaru ke dalam `Code.gs` di editor GAS (serta pastikan `Dashboard.gs`, `Database.gs`, `Barang.gs`, `Laporan.gs`, `Index.html`, `CSS.html`, `Components.html`, dan `JavaScript.html` sudah diperbarui).
3. Klik tombol **Deploy** (kanan atas) &rarr; **Manage deployments** (Kelola deployment).
4. Klik ikon **Edit (Pensil)** pada deployment aktif Anda:
   - Pada bagian **Version**, pilih **New version** (Versi baru).
   - Pastikan **Execute as** = **Me** (Saya).
   - Pastikan **Who has access** = **Anyone** (Siapa saja) — *Wajib "Anyone" agar Vercel dapat mengakses endpoint `doPost` tanpa terblokir halaman login Google*.
5. Klik **Deploy** dan salin **Web App URL** Anda (yang berakhiran `/exec`), contoh:
   ```text
   https://script.google.com/macros/s/AKfycbxHdzDpsqR3BftxscXXwA_t2bTDN9QtjKj-vX4bG_JHc2cqYU2KR0pCFyTgbMZexe97/exec
   ```

---

## Tahap 2: Deploy ke Vercel

Proyek ini sudah dilengkapi:
- **[build-vercel.js](file:///c:/Users/Humas%20IT/.gemini/antigravity/scratch/pmi-surakarta-warehouse/build-vercel.js)** — Menggabungkan `Index.html`, `CSS.html`, `Components.html`, dan `JavaScript.html` secara otomatis menjadi `dist/index.html` saat proses *build* di Vercel.
- **[api/gas.js](file:///c:/Users/Humas%20IT/.gemini/antigravity/scratch/pmi-surakarta-warehouse/api/gas.js)** — Vercel Serverless Proxy bebas-CORS.
- **[vercel.json](file:///c:/Users/Humas%20IT/.gemini/antigravity/scratch/pmi-surakarta-warehouse/vercel.json)** & **[package.json](file:///c:/Users/Humas%20IT/.gemini/antigravity/scratch/pmi-surakarta-warehouse/package.json)** — Konfigurasi build otomatis Vercel.

### Cara A: Deploy via GitHub / Vercel Dashboard
1. Push folder proyek ini ke repository **GitHub** Anda.
2. Buka [https://vercel.com/new](https://vercel.com/new) dan **Import** repository tersebut.
3. *(Opsional)* Pada bagian **Environment Variables**, tambahkan:
   - **Name**: `GAS_WEB_APP_URL`
   - **Value**: `https://script.google.com/macros/s/..../exec` *(URL Web App GAS Anda)*
4. Klik **Deploy**. Vercel otomatis menjalankan `npm run build` dan menayangkan aplikasi Anda.

### Cara B: Deploy Langsung via Vercel CLI
Jalankan perintah berikut di terminal pada folder proyek ini:
```bash
npx vercel --prod
```

---

## Tahap 3: Mengubah URL GAS Langsung dari Tampilan Login (Tanpa Redeploy)

Apabila suatu saat URL deployment Google Apps Script Anda berubah, Anda **tidak perlu melakukan redeploy di Vercel**:
1. Buka halaman Login aplikasi Anda di Vercel.
2. Di bagian bawah kartu Login, klik tombol **"Atur URL GAS"**.
3. Tempelkan URL Web App Google Apps Script (`/exec`) yang baru pada popup yang muncul, lalu klik **"Simpan & Hubungkan"**.
