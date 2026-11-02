# 🎄 Absensi Acara Natal + Undian Otomatis

Aplikasi web statis untuk absensi acara Natal (±300 peserta, satu malam) dengan
**nomor undian otomatis** dan **layar undian untuk proyektor**. Seluruh antarmuka
berbahasa Indonesia, mobile-first (nyaman di layar 360 px).

**Tema visual** (mengikuti palet referensi kertas kraft & gingerbread):
kertas kraft `#CBBDA6` / krem `#E0DACD` / `#EBDECB`, cokelat espresso `#553D29`
dan `#352016`, merah bata (cranberry) `#83322D`, hijau olive `#455026`, dengan
aksen karamel `#D9A96B` serta taburan salju halus.

* **Frontend**: HTML + CSS + JavaScript murni (ES modules) → Netlify
* **Database**: Supabase (Postgres), seluruh akses lewat fungsi RPC ber-PIN
* **Tanpa CDN** – library QR, Excel, ZIP, dan pemindai QR disalin ke `vendor/`
* **Petugas tetap bisa bekerja tanpa internet** (PWA offline-first + blok nomor)

---

## 1. Isi proyek

```
natal/
├── index.html               Halaman peserta (scan QR / form tanpa undangan)
├── petugas.html             Aplikasi petugas registrasi (PWA offline-first)
├── admin.html               Panel panitia (rekap, undangan & QR, hadiah, pengaturan)
├── undian.html              Layar undian untuk proyektor
├── styles.css               Tema & tata letak (mobile-first, cetak A4 & kartu 10×15 cm)
├── config.js                ⚠️ SATU-SATUNYA berkas yang perlu Anda isi
├── api.js                   Pembungkus fetch ke Supabase RPC
├── util.js                  Escape XSS, format nomor/tanggal, acak kriptografis, dll.
├── qr.js                    Pembungkus library QR (vendor)
├── sw.js                    Service Worker (pre-cache, network-first, SWR)
├── manifest.webmanifest     Agar aplikasi petugas bisa di-install
├── netlify.toml             Header cache (sw.js & config.js tidak di-cache)
├── demo.html                Pratinjau desain statis (data contoh, CSS inline, tanpa jaringan)
├── kartu-undangan-10x15.html       Contoh kartu undangan 10×15 cm siap cetak (data contoh)
├── kartu-undangan-10x15-contoh.pdf PDF contoh: A4, 2 kartu 10×15 cm per halaman
├── icons/                   ikon 192 & 512 px, maskable, apple-touch
├── js/
│   ├── index.js             Logika halaman peserta
│   ├── petugas.js           Logika petugas + antrean offline + blok nomor
│   ├── admin.js             Logika panel admin
│   └── undian.js            Logika layar undian (acak kriptografis + konfeti)
├── vendor/
│   ├── qrcode.js            qrcode-generator 2.0.4 (MIT)
│   ├── html5-qrcode.min.js  html5-qrcode 2.3.8 (Apache-2.0)
│   ├── xlsx.full.min.js     SheetJS CE 0.20.3 (Apache-2.0)
│   ├── jszip.min.js         JSZip 3.10.2 (MIT / GPLv3)
│   └── LICENSE-*.txt        Lisensi masing-masing library
├── tools/
│   ├── make-demo.mjs        Pembuat demo.html (node tools/make-demo.mjs)
│   ├── make-icons.py        Pembuat ikon aplikasi (python3 tools/make-icons.py)
│   ├── make-cards-sample.mjs  Pembuat kartu-undangan-10x15.html
│   ├── make-cards-pdf.py    Pembuat PDF contoh kartu (butuh reportlab)
│   └── check-contrast.py    Audit kontras WCAG palet (python3 tools/check-contrast.py)
├── supabase/
│   └── schema.sql           Tabel, RLS, fungsi RPC, hak akses (jalankan sekali)
└── tests/
    ├── sql.test.mjs         Uji SQL dengan PGlite (PostgreSQL 18 asli di WASM)
    ├── e2e.test.mjs         Uji antarmuka: halaman nyata + database nyata (jsdom + PGlite)
    └── check.mjs            Pemeriksaan sintaks JS & struktur HTML
```

---

## 2. Membuat project Supabase

1. Buka <https://supabase.com/dashboard> → **New project**. Catat **region** terdekat
   (mis. Singapore) agar latensi rendah.
2. Tunggu project selesai dibuat (±2 menit).
3. Buka **Project Settings → API**:
   * **Project URL** → contoh `https://abcdefghijkl.supabase.co`
   * **anon / publishable key** → contoh `sb_publishable_xxx` atau `eyJhbGciOi...`
4. **Jangan pernah** memakai `service_role` key di browser.

---

## 3. Menjalankan SQL (sekali saja)

1. Buka **SQL Editor → New query**.
2. Salin seluruh isi `supabase/schema.sql`, tempel, lalu **Run**.
3. Periksa hasilnya: jalankan

   ```sql
   select public.event_info();
   select public.admin_get_all('admin1234');
   ```

   Fungsi kedua harus mengembalikan objek dengan `"ok": true`.

> **PIN awal: `admin1234` (admin) dan `staff1234` (petugas).**
> Segera ganti dari **admin.html → Pengaturan → Ganti PIN**.
> Panel admin akan menampilkan peringatan merah selama PIN masih bawaan.

Yang dilakukan skrip SQL:

| Bagian | Isi |
|---|---|
| Tabel | `settings`, `participants`, `prizes`, `winners` |
| Keamanan | RLS aktif **tanpa policy** + `revoke all` untuk `anon`/`authenticated` |
| Fungsi internal | `_norm_phone`, `_check_pin`, `_next_walkin_no`, `_claim_block`, `_find_match`, `_register_walkin`, … → **dicabut** dari anon |
| Fungsi publik | `event_info`, `get_invite`, `confirm_attendance`, `walkin_register` |
| Fungsi petugas | `staff_data`, `staff_claim_numbers`, `staff_sync` |
| Fungsi admin | `admin_check`, `admin_get_all`, `admin_import`, `admin_set_setting`, `admin_change_pin`, `admin_toggle`, `admin_update`, `admin_delete`, `admin_add`, `admin_prize_save`, `admin_prize_delete`, `admin_winner_delete`, `draw_record`, `admin_reset` |

Semua fungsi `SECURITY DEFINER` dengan `search_path = ''` (nama objek selalu
memakai skema lengkap), PIN disimpan sebagai hash **bcrypt** (`pgcrypto`) dan
tidak pernah dikembalikan ke klien. PIN salah diperlambat ±0,6 detik.

---

## 4. Mengisi `config.js`

```js
window.APP_CONFIG = {
  SUPABASE_URL: 'https://abcdefghijkl.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_xxxxxxxx',
  DEFAULT_EVENT_NAME: 'Perayaan Natal',
  STAFF_BLOCK_SIZE: 40,
  STAFF_BLOCK_REFILL_AT: 15,
  SYNC_INTERVAL_MS: 15000
};
```

Catatan: bila key berawalan `sb_publishable_`, `api.js` **hanya** mengirim header
`apikey` (tanpa `Authorization: Bearer`), sesuai aturan key baru Supabase.

---

## 5. Uji lokal

```bash
cd natal
npx serve . -l 4173          # atau: python3 -m http.server 4173
# buka http://localhost:4173/index.html
```

Kamera pemindai QR butuh **HTTPS**. Untuk uji kamera di lokal, gunakan
`npx serve . --ssl-cert ... --ssl-key ...` atau langsung uji di alamat Netlify.

### Uji otomatis

```bash
cd tests
npm install
npm run test      # uji SQL/skema (PGlite) + pemeriksaan sintaks HTML/JS
npm run test:e2e  # uji antarmuka: halaman nyata + database nyata (jsdom + PGlite)
npm run test:all  # keduanya
```

* `sql.test.mjs` — 80 pemeriksaan: import tanpa dobel, nomor unik, penggabungan
  tamu tanpa undangan, jatah nomor petugas, sync idempoten, absensi ditutup,
  penolakan akses tabel langsung oleh `anon`.
* `e2e.test.mjs` — 106 pemeriksaan: halaman HTML dijalankan sungguhan di jsdom,
  setiap `fetch` RPC diteruskan ke PGlite, sehingga alur peserta → petugas
  (termasuk mode offline) → admin (import Excel, QR, kartu, ekspor) → layar
  undian (termasuk offline) diuji dari ujung ke ujung.

---

## 6. Melihat tampilan tanpa Supabase

Buka `demo.html` — pratinjau desain **statis** (data contoh, CSS di-inline, tanpa
jaringan sama sekali). Berguna untuk memutuskan tema/tata letak sebelum
menyambung database. Berkas ini tidak dipakai oleh alur aplikasi; boleh
dihapus saat deploy. Buat ulang kapan saja dengan:

```bash
node tools/make-demo.mjs
```

## 7. Deploy ke Netlify

**Cara A — drag and drop (paling cepat)**
1. Buka <https://app.netlify.com/drop>.
2. Tarik **folder** `natal` (bukan file zip di dalamnya) ke halaman tersebut.
3. Selesai. Alamat akan seperti `https://random-name-123.netlify.app`.

**Cara B — dari Git**
1. Simpan folder ke repositori GitHub.
2. Netlify → **Add new site → Import an existing project**.
3. Build command: *(kosongkan)* · Publish directory: `.`
4. `netlify.toml` sudah mengatur header cache untuk `sw.js`, `config.js`, `vendor/*`.

Setelah punya domain:
* Buka **admin.html → Undangan & QR**, isi **Domain untuk QR** dengan domain Netlify
  Anda (mis. `https://absensi-natal-2026.netlify.app`), lalu simpan.
  Ini penting agar QR tidak menunjuk ke alamat pratinjau (`*.netlify.app/deploy-xxx`).

---

## 8. Mengganti PIN

1. Login admin → tab **Pengaturan**.
2. Isi **PIN admin baru** dan/atau **PIN petugas baru** (minimal 4 karakter) → **Simpan PIN**.
3. Bila PIN admin diganti, sesi panel admin memakai PIN baru secara otomatis.
4. Perangkat petugas: setelah PIN diganti, petugas perlu login ulang sekali
   saat masih ada internet (data lokal tetap aman).

---

## 9. Alur hari-H (ringkas)

| Jalur | Siapa | Langkah |
|---|---|---|
| 1 | Peserta punya undangan | Scan QR undangan → halaman terbuka → tekan **Konfirmasi Hadir** → nomor undian 3 digit besar → screenshot |
| 2 | HP peserta tanpa internet | Tunjukkan QR ke petugas → petugas scan di `petugas.html` → nama + nomor undian besar tampil untuk disebutkan |
| 3 | Tanpa undangan | Scan **QR umum** di meja → isi nama, no. HP, asal, **jumlah anggota keluarga (dropdown 0–5)**, centang **Kupon Makan** / **Souvenir** → nomor undian |
| Petugas offline | Petugas | Scan & tambah peserta tetap jalan; antrean tersimpan; sinkron otomatis saat sinyal kembali |
| Undian | MC | `undian.html` di proyektor; pilih hadiah → MULAI (spasi) → Konfirmasi / Tidak hadir |

Aturan penting yang sudah diterapkan:

* Satu QR undangan hanya dihitung hadir **sekali**; scan ulang menampilkan
  “Sudah absen pukul HH:MM” dengan nomor yang sama.
* Nomor undian **tidak pernah berubah** setelah diterbitkan.
* Satu no. HP = satu peserta. Form umum yang cocok (HP **atau** nama) dengan
  daftar undangan akan **digabung**, bukan membuat peserta baru.
* Absensi hanya bisa saat status **Dibuka**; sinkronisasi petugas tetap diterima
  karena memuat waktu scan asli.
* Nomor undangan diundi acak dari 1–500 saat import (urutan datang tak bisa ditebak);
  peserta walk-in/manual memakai 501, 502, … dari penghitung atomik.
* Setiap HP petugas mengambil **blok 40 nomor** saat online dan mengisi ulang
  saat sisa < 15 → tidak ada nomor kembar walau 2–3 petugas bekerja bersamaan.
* Undian: kandidat = hadir, belum menang, belum ditandai *absent*.
  Pemenang dipilih dengan **acak kriptografis** (`crypto.getRandomValues` +
  rejection sampling); animasi slot hanya tampilan. Satu orang hanya satu hadiah.
* Hasil undian disimpan lokal dulu lalu dikirim lewat antrean ber-UUID
  (idempoten), otomatis terkirim saat sinyal kembali.

### Jumlah anggota keluarga, kupon makan & souvenir

* Yang dicatat **hanya jumlahnya**. Halaman peserta memakai **dropdown** jumlah
  anggota keluarga **0–5** (bukan kolom angka bebas) — tersedia **di dua jalur**:
  layar **undangan** (tamu yang memindai QR kartu undangan) dan layar **form tanpa
  undangan**.
* **Nama anggota keluarga tidak diminta** — tidak ada kolom nama di halaman
  peserta, layar petugas, panel admin, maupun ekspor Excel/CSV. Tabel
  `family_members` tetap ada di skema untuk kompatibilitas, tetapi tidak lagi
  diisi maupun dibaca (tidak perlu dihapus dari database).
* Dua kotak centang tersedia: **Kupon Makan** dan **Souvenir**. Kupon makan
  berlaku untuk peserta **beserta anggota keluarga**; souvenir satu per peserta.
* Angka `family_count` dibatasi 0–5 di server dan **tidak pernah turun** saat data
  digabung (merge) dengan pendaftaran ulang atau isian petugas.
* Jalur undangan mengirim pilihan itu bersama `confirm_attendance`. Bila tamu
  memindai ulang, isian keluarga/kupon **tidak tampil lagi** (layar “sudah
  tercatat hadir” hanya menampilkan ringkasannya) sehingga nomor undian & waktu
  hadir awal tidak berubah. Pilihan keluarga/kupon juga disembunyikan saat
  absensi ditutup.
* Kartu statistik **🍱 Kupon makan** dan **🎁 Souvenir** di panel admin memakai
  angka resmi server (`totals`), yaitu jumlah peserta hadir yang mencentang
  **ditambah** anggota keluarganya.
* Ekspor Excel & CSV memuat kolom **Jumlah Keluarga**, **Kupon Makan** (Ya/Tidak),
  dan **Souvenir** (Ya/Tidak).
* Petugas juga memakai dropdown 0–5 + dua kotak centang pada tab **Tambah**;
  nilainya ikut tersimpan offline di antrean dan terkirim saat sinkron.

#### Isian setelah memindai QR (tab Scan petugas)

Saat QR undangan terbaca (atau kode undangan ditempel di kolom manual), petugas
**tidak** langsung mencatat kehadiran. Muncul panel isian tepat di bawah kamera:

| Bagian | Isi |
|---|---|
| Judul | “Hadirkan *nama peserta*” + nomor undian besar + asal |
| 👤 / 👨‍👩‍👧 | Nama peserta + jumlah keluarga yang sudah tercatat (bila ada) |
| Dropdown | **Jumlah anggota keluarga yang ikut** (0–5) |
| Centang | **🍱 Kupon Makan** dan **🎁 Souvenir** |
| Tombol | **Simpan & Hadirkan** (merah) atau **Batal** |

* Nilai awal diambil dari isian peserta sendiri saat konfirmasi (`family_count`,
  `wants_meal`, `wants_souvenir` dari `staff_data`), jadi petugas tinggal
  menyesuaikan bila tamu membawa orang lain.
* Setelah **Simpan & Hadirkan**, petugas melihat kartu hijau yang mencantumkan
  nomor undian dan ringkasan isian (“👨‍👩‍👧 2 keluarga · 🍱 Kupon makan · 🎁 Souvenir”).
* Isian dikirim bersama antrean `staff_sync`; server menyimpannya **hanya menambah**
  (keluarga 0 tidak menimpa; centang tidak bisa dibatalkan dari layar petugas),
  sehingga data yang sudah diisi tamu tidak hilang.
* Tombol **Hadirkan** pada tab **Cari** memakai panel isian yang sama.
  **Batal** menutup panel tanpa mencatat apa pun dan membolehkan QR dipindai ulang.

---

## 10. Daftar cek sebelum hari H

**Seminggu sebelum**
- [ ] `schema.sql` sudah dijalankan; `select public.event_info();` berjalan.
- [ ] `config.js` berisi URL + anon key project yang benar.
- [ ] PIN admin & petugas **sudah diganti** (peringatan merah hilang).
- [ ] Import daftar undangan (Excel/CSV) — cek pratinjau, nomor 1–500 terpakai.
- [ ] Unduh **template Excel** untuk format kolom yang benar.
- [ ] Coba **Reset semua** (latihan), lalu import ulang data asli.

**Beberapa hari sebelum**
- [ ] Buka `petugas.html` di **2 HP** berbeda → login PIN → pastikan daftar peserta
      termuat dan lencana **Jatah nomor** muncul.
- [ ] **Uji mode pesawat** pada HP petugas: scan 1 QR, tambah 1 peserta, lalu
      nyalakan sinyal → antrean jadi 0 dan data muncul di panel admin.
- [ ] Uji scan peserta 1 undangan di 2 HP: orang kedua harus melihat “Sudah absen”.
- [ ] Cetak **QR umum** meja registrasi (admin → Undangan & QR → QR umum).
- [ ] Cetak **kartu undangan** A4 (±12 kartu/halaman; 300 peserta ≈ 25 halaman).
- [ ] Unduh **semua QR (ZIP)** sebagai cadangan cetak ulang.
- [ ] Uji **undian** di proyektor/layar lebar: pilih hadiah, MULAI, konfirmasi.
- [ ] Uji undian **tanpa internet** (matikan Wi-Fi proyektor/laptop) lalu nyalakan
      kembali dan pastikan hasil tersinkron.

**Hari H**
- [ ] Status absensi **Dibuka** (admin → Pengaturan).
- [ ] 2–3 HP petugas terisi penuh baterai & sudah login sebelum pintu dibuka.
- [ ] Layar undian memuat data (“Segarkan data” sekali sebelum acara).
- [ ] Unduh **Excel** rekap setelah acara (sheet *Absensi* + *Pemenang*).

---

## 11. Pemecahan masalah

| Gejala | Penyebab & solusi |
|---|---|
| “Aplikasi belum dikonfigurasi” | `config.js` belum diisi atau gagal dimuat (cek konsol). |
| **“Fungsi … ada di database tetapi belum dikenali API Supabase (schema cache)”** | Skema **sudah** jalan, hanya cache API-nya belum diperbarui. Buka **Dashboard Supabase → Project Settings → API → “Reload schema cache”**, tunggu ±1 menit, muat ulang halaman. |
| “Fungsi … belum terpasang. Jalankan supabase/schema.sql” | Anda memakai **project Supabase yang berbeda** dari `config.js`, atau skema belum pernah dijalankan di project itu. Jalankan `supabase/schema.sql` di project yang alamatnya ada di `config.js`. |
| **“Tabel/kolom database belum lengkap … Rincian: column p.wants_souvenir does not exist”** | Database dibuat dengan **versi skema lebih lama** (tabelnya ada, kolom barunya belum). Jalankan `supabase/schema.sql` versi terbaru — berkas ini **aman diulang** karena bagian **2b/2c** menambahkan kolom & indeks yang belum ada (`add column if not exists`) sebelum fungsi dibuat. |
| Ingin memastikan database lengkap | Jalankan `select public.schema_check();` di SQL Editor. `{"ok": true}` = lengkap. Aplikasi petugas juga memeriksanya otomatis di panel **🩺 Periksa sambungan & database**. |
| “PIN salah” padahal benar | PIN sudah diganti; atau project berbeda. Coba PIN dari perangkat lain. |
| Kamera tidak muncul | Halaman harus HTTPS + izin kamera. Gunakan tab **Cari**. |
| QR mengarah ke alamat aneh | Isi **Domain untuk QR** di admin (bukan alamat pratinjau Netlify). |
| Antrean petugas tidak turun | Sinyal lemah/PIN berubah. Cek tombol **Sinkron**, lalu login ulang. |
| Halaman peserta basi setelah update | Service Worker menyimpan versi lama. Muat ulang 2×, atau tunggu ±1 menit. |
| Peserta “tidak ditemukan” | Token undangan salah/cetakan lama. Cari manual di admin/petugas. |
| **“Gagal memproses permintaan: DELETE requires a WHERE clause”** saat *Reset semua* / *Reset absensi* | Ekstensi pengaman database (mis. `safeupdate`) menolak `DELETE`/`UPDATE` tanpa `WHERE`. Sudah diperbaiki: **semua** `DELETE`/`UPDATE` di fungsi memakai `WHERE` eksplisit (reset menyeluruh memakai bentuk yang selalu benar, mis. `where id is not null or true`). Bila masih muncul, `supabase/schema.sql` di project Anda masih versi lama — jalankan ulang berkas itu (aman diulang). Uji: `cd tests && node sql.test.mjs` bagian **8b**. |

### 11.0 Skema berubah? Jalankan ulang `supabase/schema.sql` (aman, tidak menghapus data)

Berkas `supabase/schema.sql` **selalu boleh dijalankan ulang** di database yang sudah
berisi data. Bagian yang membuatnya aman:

| Bagian | Isi | Kenapa aman |
|---|---|---|
| 1 | `create table if not exists` | tabel yang sudah ada dilewati, data tidak disentuh |
| 2 | `insert … on conflict do nothing` | PIN & nama acara yang sudah diganti tidak ditimpa |
| **2b** | `alter table … add column if not exists` | menambahkan kolom baru (mis. `wants_souvenir`, `family_members`, `source`) ke tabel versi lama |
| **2c** | `create index if not exists` | indeks dibuat setelah kolom lengkap, jadi tidak gagal di database lama |
| 3–6b | `create or replace function` | fungsi lama diganti versi baru |
| 7 | `revoke`/`grant` | hak akses disetel ulang, tetap sama |

Cara memastikan: di **SQL Editor** jalankan

```sql
select public.schema_check();
-- {"ok": true, "missing_tables": [], "missing_columns": [], "missing_functions": [], ...}
```

Bila ada yang hilang, hasilnya menyebut nama tabel/kolom/fungsi yang belum ada, mis.
`{"ok": false, "missing_columns": ["participants.wants_souvenir"]}`. Setelah skema
dijalankan ulang, panggil lagi sampai `ok: true`, lalu muat ulang halaman aplikasi.

> **Aplikasi ikut memeriksa otomatis.** Panel **🩺 Periksa sambungan & database** di
> layar login `petugas.html` memanggil `schema_check()` dan menampilkan daftar bagian yang
> belum ada — tanpa perlu membuka SQL Editor.

### 11.1 Panel “Periksa sambungan & database” (layar login petugas)

Bila muncul pesan error yang menyebut **schema / fungsi database / kunci API**, buka
`petugas.html` lalu bentangkan panel **🩺 Ada error “schema” / gagal masuk?** di bawah
tombol Masuk (panel ini juga otomatis terbuka saat login gagal karena masalah server).
Tekan **Tes sekarang**; hasilnya:

| Baris | Arti bila ❌/⚠️ |
|---|---|
| Alamat proyek + bentuk alamat | `SUPABASE_URL` harus persis `https://kode-proyek.supabase.co` (tanpa `/rest/v1`, tanpa spasi) |
| Kunci API | Kunci salah/terpotong → salin ulang anon/publishable key dari Dashboard → API Keys |
| Server Supabase terhubung | Gagal = sinyal buruk, atau project sedang **Paused** (aktifkan di Dashboard) |
| Fungsi `event_info()` jalan | Bila menyebut *schema cache* → tekan **Reload schema cache**; bila menyebut *does not exist* → jalankan `supabase/schema.sql` di project yang sama |
| Fungsi `staff_data()` jalan | Hanya pada tes mendalam — sekaligus memastikan PIN petugas masih berlaku |
| Jumlah peserta tersimpan | 0 pada login pertama itu normal (butuh internet sekali) |

Tombol **Salin hasil** menyalin ringkasan (alamat, potongan kunci API, semua baris) untuk
dikirim ke panitia/pengembang lewat WhatsApp, sehingga tidak perlu membaca konsol di HP.

> Halaman peserta (`index.html`) juga menampilkan **rincian teknis** singkat di bawah pesan
> error: nama fungsi, kode HTTP, dan waktu kejadian.

---

## 12. Memasang aplikasi petugas (PWA) & izin kamera

`petugas.html` **sudah** berupa PWA: `manifest.webmanifest` (standalone, ikon 192/512 +
maskable), service worker offline-first, dan HTTPS dari Netlify (syarat kamera).

### Cara memasang di HP petugas

1. Buka `https://<situs-anda>/petugas.html` di **Chrome (Android)** atau **Safari (iPhone)**.
2. **Android:** ketuk banner **📲 Pasang sebagai aplikasi → Pasang** di bagian atas halaman,
   atau menu **⋮ → “Pasang aplikasi”**. **iPhone:** ikon **Bagikan ⬆️ → “Tambah ke Layar Utama”**.
3. Buka aplikasi dari ikon di layar utama. Pada mode terpasang, izin kamera tersimpan
   permanen dan tidak perlu diizinkan ulang setiap kali.

> Banner otomatis disembunyikan bila aplikasi sudah terpasang, atau bila petugas
> menekan ✕ (pilihan diingat di perangkat).

### Bila kamera tetap tidak mau terbuka

Buka tab **Scan** → **🔍 Periksa izin kamera**:

| Baris | Arti |
|---|---|
| ✅ Alamat HTTPS | Kamera hanya boleh di `https://` (bukan `http://` atau IP lokal) |
| ✅ Berjalan sebagai aplikasi terpasang | Bila ⚠️ *tab browser*, pasang dulu aplikasinya |
| ✅ API kamera tersedia | Peramban terlalu tua → pakai Chrome/Safari terbaru |
| ✅ Izin kamera: DIIZINKAN / BELUM DIMINTA / DITOLAK | Bila DITOLAK: pengaturan situs → Kamera → Izinkan → muat ulang |
| Peramban terdeteksi | Membantu saat melapor (Chrome/Samsung/Firefox/Safari) |

Tombol **Uji kamera** meminta izin sekali lalu langsung mematikan kamera (tidak
merekam apa pun) — cara tercepat memunculkan dialog izin sebelum hari-H. Tersedia juga
tombol petunjuk pemasangan untuk **Android** dan **iPhone**.

Selalu ada jalur cadangan: tab **Cari** (hadirkan manual) dan kolom **kode undangan manual**
di tab Scan, sehingga absensi tidak pernah macet gara-gara kamera.

---

### Salju di layar undian

`undian.html` menampilkan **salju yang benar-benar bergerak turun** di belakang angka
undian (canvas `#snowfall`, digambar oleh `js/undian.js`):

* jumlah butir menyesuaikan luas layar (40–220 butir), ukuran 1,1–4 px, turun pelan
  dengan gerak mengayun kiri-kanan;
* butir yang keluar layar muncul lagi di atas, jadi salju tidak pernah habis;
* lapisan berada **di atas latar tema tetapi di bawah digit/pemenang** supaya angka
  undian tetap terbaca dari jarak jauh;
* berhenti otomatis saat tab tidak terlihat (hemat baterai proyektor) dan ikut
  aturan **prefers-reduced-motion** (salju tampil diam, tanpa animasi);
* tanpa `pointer-events`, jadi tidak menghalangi tombol/kontrol.

---

## 13. Cetak kartu undangan (10 × 15 cm)

Kartu undangan berukuran dasar **10 × 15 cm** (100 × 150 mm). Panel admin →
tab **Undangan & QR** → bagian *Pratinjau kartu undangan · 10 × 15 cm*.

### Pilih susunan cetak (dropdown **Susunan cetak**)

| Susunan | Kartu per lembar | Ukuran kartu | Keterangan |
|---|---|---|---|
| **4 kartu / A4** (bawaan) | 4 (2 × 2) | **9,5 × 14,25 cm** (95 %) | hemat kertas — pilihan paling umum |
| 2 kartu / A4 | 2 (2 × 1) | **tepat 10 × 15 cm** | ukuran asli, kertas 2× lebih banyak |
| 4 kartu / A3 | 4 (2 × 2) | **tepat 10 × 15 cm** | ukuran asli, perlu printer A3 |

> **Kenapa 4 kartu di A4 tidak 10 × 15 cm?** Dua baris kartu 15 cm = **300 mm**,
> sedangkan tinggi A4 hanya **297 mm** — tidak mungkin muat. Karena itu mode
> 4-kartu-per-A4 mengecilkan kartu 5 % (9,5 × 14,25 cm) agar keempatnya masuk
> rapi dan tetap bisa dipotong. Bila ukuran harus tepat 10 × 15 cm, pakai
> 2 kartu/A4 atau 4 kartu/A3.

### Langkah mencetak

1. Isi **Waktu acara** dan **Tempat acara** (diingat di perangkat ini).
2. Pilih **Susunan cetak** dan jumlah kartu → **Tampilkan** (pratinjau 1:1 per lembar).
3. Tekan **👁️ Pratinjau siap cetak 10×15** (atau **🖨️ Cetak kartu 10×15 cm**) —
   terbuka tab cetak berisi panduan, lalu dialog print muncul otomatis. Bila popup
   diblokir, berkas `.html` cetak diunduh dan bisa dibuka lalu Ctrl/Cmd + P.
4. Di dialog printer: kertas sesuai susunan (A4/A3), skala **100 %** (bukan
   *Fit to page*), margin **None**, header–footer **mati**.

QR asli per tamu dibuat 480 px (≈300 dpi pada kotak 40 mm). Nomor undian tetap
**tidak dicetak**.

### Berkas contoh (data contoh, tanpa aplikasi)

* `kartu-undangan-10x15.html` — `node tools/make-cards-sample.mjs` (bawaan 4 kartu/A4;
  opsi `--2-per-a4`, `--4-per-a3`)
* `kartu-undangan-10x15-contoh.pdf` — `python3 tools/make-cards-pdf.py` (bawaan 4 kartu/A4;
  opsi `--2-per-a4`, `--4-per-a3`, `--satu-per-halaman`)

---

## 14. Tema & palet warna

Seluruh warna berada di blok `:root` pada `styles.css`. Palet diambil langsung
dari gambar referensi dan diukur dengan mengambil sampel piksel:

| Peran | Nilai | Contoh pemakaian |
|---|---|---|
| Kertas kraft | `--kraft-200 #E0DACD`, `--kraft-300 #CBBDA6` | latar halaman (meja kraft) |
| Krem terang | `--kraft-50 #F7F0E4`, `--kraft-100 #EBDECB` | kartu, teks di atas gelap |
| Cokelat espresso | `--cocoa-700 #553D29`, `--cocoa-800 #352016` | topbar, angka, teks utama |
| Merah bata | `--cran-700 #83322D`, `--cran-600 #9E3B33` | tombol utama, pita permen |
| Hijau olive | `--olive-600 #455026`, `--olive-700 #3F4D2A` | tombol sukses, status hadir |
| Karamel | `--honey-400 #D9A96B`, `--honey-600 #9C6B34` | nomor undian, aksen, bintang |

Sentuhan tematik: latar berupa kertas kraft berbutir (garis serat halus + vinjet
hangat) dengan taburan salju, garis **pita permen** merah-krem di bawah topbar dan
di puncak kartu, kartu bergaya kertas (garis ganda tipis di dalam), serta tiga
**kotak digit** pada layar undian yang memakai blok warna referensi
(cokelat → merah bata → olive).

Nama variabel lama (`--green-*`, `--red-*`, `--gold-*`, `--snow-*`) tetap tersedia
sebagai alias agar atribut `style="..."` di HTML/JS tidak perlu diubah.

**Kontras** — semua pasangan teks/latar diuji WCAG AA (≥ 4,5:1):

```bash
python3 tools/check-contrast.py   # 27 pasangan, semua lulus
```

Mengganti tema lagi cukup dengan menyunting nilai di `:root`, lalu jalankan
`node tools/make-demo.mjs` dan `python3 tools/make-icons.py`.

## 15. Keamanan (ringkas)

* Tabel **tidak bisa dibaca langsung** oleh `anon` maupun `authenticated`
  (RLS tanpa policy + `revoke all`).
* Semua operasi lewat fungsi `SECURITY DEFINER` dengan `search_path = ''`.
* Fungsi internal (`_check_pin`, `_claim_block`, `_register_walkin`, …) dicabut
  dari `anon`/`authenticated`; fungsi publik diberi `GRANT EXECUTE` eksplisit.
* PIN dikirim pada setiap panggilan, diverifikasi terhadap hash bcrypt;
  PIN salah ditunda ±0,6 detik. Hash PIN tidak pernah dikirim ke klien.
* `admin_set_setting` hanya menerima `event_name` dan `attendance_open`.
* Semua teks pengguna di-escape (`esc()` di `util.js`) sebelum masuk DOM.
* Vektor undian memakai `crypto.getRandomValues` dengan rejection sampling,
  bukan `Math.random`.

---

## 16. Lisensi & atribusi library

| Library | Versi | Lisensi |
|---|---|---|
| qrcode-generator (Kazuhiko Arase) | 2.0.4 | MIT |
| html5-qrcode (Minecart) | 2.3.8 | Apache-2.0 |
| SheetJS Community Edition | 0.20.3 | Apache-2.0 |
| JSZip | 3.10.2 | MIT / GPLv3 |

Berkas lisensi tersedia di `vendor/`. Selamat merayakan Natal! 🎁✨
