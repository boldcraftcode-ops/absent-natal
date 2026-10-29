# 🎄 Absensi Acara Natal + Undian Otomatis

Aplikasi web statis untuk absensi acara Natal (±300 peserta, satu malam) dengan
**nomor undian otomatis** dan **layar undian untuk proyektor**. Seluruh antarmuka
berbahasa Indonesia, tema Natal (hijau tua, merah, emas, aksen salju halus),
mobile-first (nyaman di layar 360 px).

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
├── styles.css               Tema & tata letak (mobile-first, cetak A4)
├── config.js                ⚠️ SATU-SATUNYA berkas yang perlu Anda isi
├── api.js                   Pembungkus fetch ke Supabase RPC
├── util.js                  Escape XSS, format nomor/tanggal, acak kriptografis, dll.
├── qr.js                    Pembungkus library QR (vendor)
├── sw.js                    Service Worker (pre-cache, network-first, SWR)
├── manifest.webmanifest     Agar aplikasi petugas bisa di-install
├── netlify.toml             Header cache (sw.js & config.js tidak di-cache)
├── demo.html                Pratinjau desain statis (data contoh, CSS inline, tanpa jaringan)
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
│   └── make-demo.mjs        Pembuat demo.html (node tools/make-demo.mjs)
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
| 3 | Tanpa undangan | Scan **QR umum** di meja → isi nama, no. HP, asal, jumlah keluarga → nomor undian |
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
| “Fungsi database belum terpasang” | `supabase/schema.sql` belum dijalankan. |
| “PIN salah” padahal benar | PIN sudah diganti; atau project berbeda. Coba PIN dari perangkat lain. |
| Kamera tidak muncul | Halaman harus HTTPS + izin kamera. Gunakan tab **Cari**. |
| QR mengarah ke alamat aneh | Isi **Domain untuk QR** di admin (bukan alamat pratinjau Netlify). |
| Antrean petugas tidak turun | Sinyal lemah/PIN berubah. Cek tombol **Sinkron**, lalu login ulang. |
| Halaman peserta basi setelah update | Service Worker menyimpan versi lama. Muat ulang 2×, atau tunggu ±1 menit. |
| Peserta “tidak ditemukan” | Token undangan salah/cetakan lama. Cari manual di admin/petugas. |

---

## 12. Keamanan (ringkas)

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

## 13. Lisensi & atribusi library

| Library | Versi | Lisensi |
|---|---|---|
| qrcode-generator (Kazuhiko Arase) | 2.0.4 | MIT |
| html5-qrcode (Minecart) | 2.3.8 | Apache-2.0 |
| SheetJS Community Edition | 0.20.3 | Apache-2.0 |
| JSZip | 3.10.2 | MIT / GPLv3 |

Berkas lisensi tersedia di `vendor/`. Selamat merayakan Natal! 🎁✨
