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
├── absen.html               Absensi TAMU: pilih nama sendiri / tanpa undangan (tanpa PIN)
├── styles.css               Tema & tata letak (mobile-first, cetak A4 & kartu 10×15 cm)
├── config.js                ⚠️ SATU-SATUNYA berkas yang perlu Anda isi
├── api.js                   Pembungkus fetch ke Supabase RPC
├── util.js                  Escape XSS, format nomor/tanggal, acak kriptografis, dll.
├── qr.js                    Pembungkus library QR (vendor)
├── sw.js                    Service Worker (pre-cache, network-first, SWR)
├── manifest.webmanifest     Agar aplikasi petugas bisa di-install
├── netlify.toml             Header cache (sw.js & config.js tidak di-cache)
├── start.bat                ▶ KLIK DUA KALI untuk menjalankan di localhost (Windows)
├── start.sh                 Versi Linux/macOS dari start.bat
├── demo.html                Pratinjau desain statis (data contoh, CSS inline, tanpa jaringan)
├── kartu-undangan-10x15.html       Contoh kartu undangan 10×15 cm siap cetak (data contoh)
├── kartu-undangan-10x15-contoh.pdf PDF contoh: A4, 2 kartu 10×15 cm per halaman
├── icons/                   ikon 192 & 512 px, maskable, apple-touch
├── js/
│   ├── index.js             Logika halaman peserta
│   ├── petugas.js           Logika petugas + antrean offline + blok nomor
│   ├── admin.js             Logika panel admin
│   ├── absen-tamu.js        Logika absensi tamu (cari nama / tanpa undangan)
│   ├── undian.js            Logika layar undian (acak kriptografis + konfeti)
│   ├── undian-audio.js      Suara undian (Web Audio, tanpa berkas mp3)
│   ├── card-layout.js       Geometri kartu 10×15 cm
│   ├── cards-pdf.js         Ekspor kartu ke PDF (jsPDF)
│   └── cards-jpg.js         Ekspor kartu ke JPG/ZIP
├── vendor/
│   ├── qrcode.js            qrcode-generator 2.0.4 (MIT)
│   ├── html5-qrcode.min.js  html5-qrcode 2.3.8 (Apache-2.0)
│   ├── xlsx.full.min.js     SheetJS CE 0.20.3 (Apache-2.0)
│   ├── jszip.min.js         JSZip 3.10.2 (MIT / GPLv3)
│   └── LICENSE-*.txt        Lisensi masing-masing library
├── tools/
│   ├── lokal-server.mjs     Server statis untuk uji lokal (dipakai start.bat)
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

## 5. Uji lokal (sebelum upload ke GitHub/Netlify)

### Cara tercepat di Windows — klik dua kali `start.bat`

`start.bat` sudah ada di folder aplikasi. Klik dua kali, tunggu 1–2 detik,
browser terbuka sendiri di `http://localhost:4173/index.html`.
Hentikan dengan **Ctrl+C** di jendela hitamnya.

`start.bat` menjalankan `tools/lokal-server.mjs` dengan **Node.js** (tanpa
`npm install`, tanpa internet). Bila Node.js belum ada, ia otomatis memakai
**Python** (`python -m http.server`) dan tetap membuka browser. Bila keduanya
tidak ada, muncul petunjuk pemasangan yang singkat.

| Alamat | Untuk |
|---|---|
| <http://localhost:4173/index.html> | halaman tamu (isi token: `index.html?t=…`) |
| <http://localhost:4173/absen.html> | absensi TAMU (cari nama / tanpa undangan) |
| <http://localhost:4173/admin.html> | panel admin (PIN bawaan `admin1234`) |
| <http://localhost:4173/undian.html> | layar undian + suara |
| <http://localhost:4173/demo.html> | pratinjau desain tanpa Supabase |
| <http://localhost:4173/kartu-undangan-10x15.html> | contoh kartu |

Ganti port: `start.bat 8080`. Linux/macOS: `./start.sh` atau `./start.sh 8080`.

**Kenapa tidak boleh klik dua kali `index.html`?** Alamat `file://` memblokir
ES module, `fetch`, dan service worker — halaman akan tampak kosong. Aplikasi
ini wajib lewat `http://`.

### Yang ditiru server lokal dari Netlify

`tools/lokal-server.mjs` menyamakan hal-hal yang bisa membuat "jalan di lokal
tapi gagal setelah deploy":

* `sw.js` dan `config.js` dikirim `no-store` / `no-cache` (service worker lama
  tidak nyangkut, `config.js` yang baru langsung terpakai),
* `Permissions-Policy: camera=(self)` sehingga pemindai QR tidak diblokir,
* `/undangan` → `/index.html` (sama seperti `netlify.toml`),
* `vendor/*` `immutable`, `js/*` & `*.css` `must-revalidate`, ETag + `304`,
* folder `tests/`, `node_modules`, dan `.git` tidak dapat diakses dari browser.

### Data & PIN di lokal

Supabase diakses lewat internet, jadi **lokal maupun Netlify memakai database
yang sama**. Uji dengan hati-hati: jangan menekan "Bersihkan data" di panel
admin saat data asli sudah masuk. Untuk uji coba yang aman, buat project
Supabase kedua (gratis) lalu tukar `SUPABASE_URL`/`SUPABASE_ANON_KEY` di
`config.js`.

Bila `config.js` masih kosong, aplikasi tetap terbuka tetapi menampilkan pesan
"belum dikonfigurasi"; `demo.html` bisa dilihat tanpa database sama sekali.

### Kamera QR di lokal

Pemindai QR bawaan (`petugas.html`) butuh **HTTPS**. Di `http://localhost`
Chrome masih mengizinkan kamera untuk `localhost` (Secure Context), tetapi dari
HP lewat `http://192.168.x.x` **tidak**. Karena itu alur lapangan memakai
kamera bawaan HP → `absen.html` (§11b), yang tetap berjalan di alamat LAN.
Kamera hanya dipakai `petugas.html`/`index.html?mode=petugas`; semua halaman
lain tidak butuh izin kamera.

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

> Sebelum upload ke GitHub/Netlify, jalankan dulu di komputer sendiri dengan
> **`start.bat`** (§5) — semua halaman bisa dicoba tanpa memakai credit Netlify.
> Berkas `start.bat`, `start.sh`, dan `tools/lokal-server.mjs` tidak mengganggu
> situs; keduanya boleh ikut ter-upload (tidak dipanggil dari browser).

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
| 3 | Tanpa undangan | Scan **QR umum** di meja → `absen.html` → **➕ Saya tidak menerima undangan** → isi nama, no. HP, asal, **jumlah anggota keluarga (dropdown 0–5)**, centang **Kupon Makan** / **Souvenir** → nomor undian baru ≥ 501 |
| 4 | **Punya undangan tapi lupa bawa kartu QR** | Petugas buka tab **Tambah** → pilih nama tamu di dropdown **“Tamu sudah punya undangan?”** → isian terisi otomatis → lengkapi keluarga/kupon → **Hadirkan tamu ini** → nomor undian **lama** dipakai ulang (tidak ada nomor baru) |
| Petugas offline | Petugas | Scan & tambah peserta tetap jalan; antrean tersimpan; sinkron otomatis saat sinyal kembali |
| Tamu **tanpa undangan fisik** | Tamu sendiri (HP di meja) | Kamera bawaan HP memindai **QR meja registrasi** → `absen.html` → cari & pilih namanya (§11b) |
| Undian | MC | `undian.html` di proyektor; pilih hadiah → MULAI (spasi) → Konfirmasi / Tidak hadir. Suara Natal + drum gulir otomatis (§13b), tombol 🔊 untuk membisukan |

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

#### Tamu lupa membawa kartu QR (tab Tambah)

Tidak perlu membuat peserta baru (yang akan memberi nomor undian baru dan
membuat data ganda). Di tab **Tambah** ada dropdown di paling atas:

> **Tamu sudah punya undangan? Pilih namanya di sini**

| Keadaan | Yang terjadi |
|---|---|
| Tamu **belum hadir** | nama, HP, asal, jumlah keluarga, dan centang kupon/souvenir terisi otomatis dari data undangan; tombol berubah menjadi **Hadirkan tamu ini**; kehadiran dicatat dengan **nomor undian yang sudah terbit** |
| Tamu **sudah hadir** | muncul peringatan “Sudah tercatat hadir pukul HH:MM”; simpan hanya bila petugas ingin **memperbarui** isian keluarga/kupon (ada konfirmasi dulu) — waktu hadir pertama tidak berubah |
| Tidak memilih nama (opsi pertama) | perilaku lama: peserta **tanpa undangan** baru, nomor dari blok jatah HP petugas (501, 502, …) |

* Daftar dropdown memuat **semua undangan yang tersimpan di HP petugas**
  (`staff_data`), diurutkan nomor undian, ditandai `✓ sudah hadir` bila sudah absen,
  dan bisa diketik untuk mencari. Jumlah undangan & sisa yang belum hadir
  ditampilkan di bawah dropdown.
* Tetap **jalan offline**: pilihan diambil dari data lokal HP petugas, kehadiran
  masuk antrean `staff_sync` dan terkirim saat sinyal kembali — memakai jalur
  `attend` yang sama dengan hasil pindai QR.
* Bila daftar kosong (HP petugas belum pernah memuat data), petugas diminta
  menyambungkan internet lalu menekan tombol muat ulang data.

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

## 11b. Tamu tidak membawa undangan fisik — halaman absensi TAMU

Kasus yang ditangani: tamu **diundang** tetapi kartu/QR-nya tertinggal di rumah.
Dulu solusinya halaman ber-PIN yang dipegang petugas; sekarang halaman itu
**dipakai tamu sendiri**, jadi PIN dihapus dan halaman tidak lagi memuat token
undangan siapa pun.

### Tiga jalur kehadiran

| Kondisi tamu | Yang dilakukan | Nomor undian |
|---|---|---|
| Membawa undangan fisik | pindai QR di kartu → `index.html?t=…` → **Konfirmasi Hadir** | nomor lamanya |
| **Diundang, undangan tidak dibawa** | pindai **QR meja registrasi** → `absen.html` → cari & pilih namanya sendiri → **Ya, saya hadir** | **nomor lamanya (tidak pernah baru)** |
| Tidak diundang sama sekali | `absen.html` → **➕ Saya tidak menerima undangan** → isi form | nomor baru ≥ 501 |
| Kondisi abnormal: tamu tidak bisa memakai HP sendiri | panitia memakai panel admin → tab **Undangan & QR** → **🗒️ Meja registrasi (mode panitia)** | nomor lamanya |

### Cara kerja halaman tamu (`absen.html`)

1. Tamu memindai QR meja registrasi dengan **kamera bawaan HP** (bukan di dalam browser).
2. Halaman langsung terbuka — **tanpa PIN**. Tamu mengetik beberapa huruf namanya
   (atau asal wilayah/instansinya).
3. Muncul daftar nama **lengkap** dengan tanda `✓ sudah hadir`; tamu menekan namanya.
4. Muncul konfirmasi **“Betul ini Anda?”** — nama besar + asal + tombol
   **✅ Ya, saya hadir** dan **← Bukan saya, cari nama lain**.
5. Nomor undian lamanya tampil besar, siap ditunjukkan ke panitia.
6. Bila salah ketuk, tamu bisa menekan **“Salah pilih? Batalkan pencatatan ini”**
   dalam **3 menit** (setelah itu panitia yang membatalkan lewat panel admin).

Nama sengaja ditampilkan **lengkap** (bukan nama depan saja) karena di acara
gereja banyak nama depan kembar (Maria, Yohanes, Ruth) — nama depan saja
malah membuat tamu salah pilih. Yang disembunyikan adalah **nomor undian**:
`lookup_invited()` hanya mengembalikan nama + asal + status hadir, **tidak
pernah** token, nomor HP, atau data keluarga. Fungsi `staff_data()` (yang
memuat token semua peserta) **tidak dipakai** di halaman ini.

### Pemeriksaan data dobel — manual, tapi ada alatnya

Panitia memeriksa manual. Tiga alat bantu:

1. **Penghitung sisa undangan.** Setiap pencarian dan setiap pencatatan
   mengembalikan `sisa_belum_hadir`. Angka ini **harus turun satu** tiap tamu.
   Turun dua = ada data dobel; melompat dua = ada tamu salah memilih nama.
2. **Panel admin → Meja registrasi (mode panitia).** Menampilkan
   *“Undangan yang belum tercatat hadir: N”* + daftar **Aktivitas terakhir**
   (nama, jam, sumber) untuk menelusuri kejanggalan.
3. **`absen.html?pantau=1&kios=1`** — layar besar untuk meja registrasi:
   nomor undian ikut tampil, dan layar otomatis bersih lagi setelah 25 detik
   supaya data tamu sebelumnya tidak tertinggal.

Membatalkan salah catat: panel admin → tab **Rekap hadir** → tombol **Batal**
pada baris peserta (atau `admin_toggle`). Bila duplikat benar-benar terjadi,
hapus baris tamu tanpa undangan yang salah (`admin_delete`) — nomor undangan
1–500 milik tamu undangan tidak boleh dihapus, cukup dibatalkan kehadirannya.

### Kalau tamu diundang tetapi TIDAK ADA di daftar

Berarti namanya belum masuk rekap. Dua pilihan:

* daftarkan sebagai tamu tanpa undangan (nomor ≥ 501) — paling cepat, tetapi
  orang itu punya nomor berbeda dari yang tertulis di undangannya;
* panitia menambahkan lewat panel admin → tab **Rekap hadir** → **Tambah**
  dengan centang **tamu undangan**, sehingga nomornya tetap di rentang 1–500.

### Yang perlu dicetak & disiapkan

| Berkas | Kegunaan |
|---|---|
| **QR meja registrasi** | admin → **Undangan & QR** → **🔳 QR umum meja registrasi** → **🖨️ Cetak** (A5 cukup) |
| Tautan langsung | `https://<situs>/absen.html` — bisa juga ditulis di papan pengumuman |
| PIN petugas & admin | hanya untuk panel admin/`petugas.html`, **tidak** dipakai halaman tamu |

Catatan teknis:

* `absen.html` tidak butuh kamera maupun pustaka QR → sangat ringan, cocok HP jadul.
* Halaman ini **membutuhkan internet** (tidak ada antrean offline) karena
  datanya langsung ditulis ke server. Untuk lokasi tanpa sinyal, gunakan
  `petugas.html` di HP yang kameranya bisa.
* RPC baru: `lookup_invited()`, `attend_invited()`, `attend_undo()`,
  `recent_attendance()`. Semuanya `security definer` dan hanya memberi akses
  baca terbatas / tulis satu baris; tabel tetap tertutup RLS.
* Jalankan ulang `supabase/schema.sql` (aman, tidak menghapus data) agar
  fungsi baru ini ada.

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
tab **Undangan & QR** → bagian *Kartu undangan · 10 × 15 cm → ekspor PDF*.

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

### Ekspor kartu ke PDF (tanpa dialog cetak)

Kartu **tidak lagi dicetak langsung dari browser**. Semua lewat satu tombol:

| Tombol | Hasil |
|---|---|
| **⬇️ Ekspor kartu ke PDF** | PDF berisi maksimal 16 kartu pertama (sesuai dropdown **Tampilkan**) |
| **📚 Ekspor semua peserta (PDF)** | PDF berisi seluruh peserta terdaftar |

Langkahnya:

1. Isi **Waktu acara** dan **Tempat acara** (diingat di perangkat ini).
2. Pilih **Susunan cetak** (4 kartu/A4, 2 kartu/A4, atau 4 kartu/A3).
3. Tekan **⬇️ Ekspor kartu ke PDF** — berkas `.pdf` **langsung terunduh**, tanpa
   dialog print. Nama berkas: `kartu-undangan-a4-4up-16kartu-2026-12-04.pdf`.
4. Kirim berkas itu ke percetakan, atau buka lalu cetak **apa adanya** dengan skala
   **100 %** (bukan *Fit to page*), margin **None**, header–footer **mati**.

Isi setiap lembar PDF sudah pasti: ukuran halaman = kertas sesuai susunan
(A4 210 × 297 mm atau A3 297 × 420 mm), posisi kartu di tengah, garis potong putus-putus,
dan **QR asli per tamu** (480 px ≈ 300 dpi pada kotak 44 mm). Nomor undian tetap
**tidak dicetak**.

### PDF = pratinjau (mengapa dulu berbeda)

Sebelumnya PDF digambar ulang dengan posisi & ukuran huruf tetap, sehingga
tidak sama dengan pratinjau web dan teks panjang terpotong ("…") atau menabrak
blok lain. Sekarang `js/cards-pdf.js` **meniru tata letak CSS pratinjau**:

| Pratinjau (styles.css) | PDF (js/cards-pdf.js) |
|---|---|
| `.card15__rule` — baris tiga warna | baris tiga warna 1,2 mm |
| `.card15__head` — ✦ + nama acara + organisasi | bintang vektor + nama acara (Times bold 6,4 mm) + organisasi |
| `.card15__body` — QR 40 mm + KEPADA/nama/asal | kotak QR 40 mm + teks, keduanya dipusatkan |
| `.card15__meta` — WAKTU / TEMPAT | label kolom 17 mm + nilai |
| `.card15__foot` — petunjuk + nomor kartu | **selalu menempel di dasar kartu** (seperti grid `1fr`) |
| latar gradasi 160° | gradasi 56 pita (≈ 0,2 mm per pita) |
| tanda sudut 5 mm + bingkai putus-putus | digambar & dipotong sesuai sudut kartu (`clip`) |

**Tidak ada lagi teks terpotong**: setiap blok diukur dulu, dan bila isinya
terlalu panjang ukuran huruf + kotak QR menyusut serentak (maksimal 38 %)
sampai semuanya muat tanpa memotong kata. Dijaga oleh `node tests/pdf.test.mjs`:

```bash
cd tests && node pdf.test.mjs      # 45 pemeriksaan tata letak kartu (PDF + JPG)
```

Yang diperiksa: semua isi kartu benar-benar tercetak, tidak ada "…", semua teks
di dalam batas kartu, urutan blok sama dengan pratinjau, dan kartu tetap benar
pada susunan 4/A4 maupun 2/A4.

> Pembuat PDF memakai **jsPDF** yang ikut dikemas di `vendor/jspdf.umd.min.js`
> (tetap jalan offline; bila berkas lokal tidak ditemukan, otomatis mencoba CDN).
> Semua gambar kartu dibuat oleh `js/cards-pdf.js` — modul terpisah yang juga dipakai
> uji otomatis. Bila unduhan diblokir peramban HP, PDF otomatis dibuka di tab baru
> untuk disimpan dari sana.

### Kartu sebagai JPG (pratinjau + unduh)

Butuh kartu dalam bentuk **gambar** (kirim WhatsApp, cetak foto, atau simpan di
galeri HP)? Ada tombol **JPG** di dua tempat:

| Lokasi | Tombol | Hasil |
|---|---|---|
| Tab **Rekap Hadir** → kolom **Aksi** setiap peserta | **JPG** | dialog pratinjau kartu peserta itu + unduh |
| Tab **Rekap Hadir** → baris tombol daftar peserta | **🖼️ JPG** | unduh kartu **semua peserta terfilter** sebagai satu `.zip` |

Cara pakai:

1. Tekan **JPG** pada baris peserta → dialog pratinjau terbuka (gambar asli, bukan tiruan).
2. Pilih **resolusi**: **300 dpi** (1181 × 1772 px, untuk cetak), **150 dpi**
   (591 × 886 px, ringan), atau **96 dpi** (378 × 567 px, untuk WhatsApp).
3. Ganti peserta dengan dropdown atau tombol **‹ Sebelumnya / Berikutnya ›**.
4. Tekan **⬇️ Unduh JPG** — nama berkas `kartu-undangan-budi-santoso-300dpi.jpg`.

Catatan:

* Gambar dibuat **di perangkat** dengan `<canvas>` — tidak ada pustaka tambahan,
  tetap jalan offline, dan **tidak memakai kuota/credit Netlify**.
* Isinya sama persis dengan pratinjau dan PDF karena ketiganya memakai satu
  modul tata letak: `js/card-layout.js` (PDF → `js/cards-pdf.js`,
  JPG → `js/cards-jpg.js`, pratinjau → `styles.css .card15`).
* Teks panjang menyusut otomatis, jadi tidak ada kata terpotong.
* Ekspor banyak peserta memakai ZIP dan berjalan bertahap (bila JSZip tidak ada,
  20 kartu pertama diunduh satu per satu).

### Berkas contoh (data contoh, tanpa aplikasi)

* `kartu-undangan-10x15.html` — `node tools/make-cards-sample.mjs` (bawaan 4 kartu/A4;
  opsi `--2-per-a4`, `--4-per-a3`)
* `contoh-kartu-undangan.pdf` (di folder induk) — contoh hasil **ekspor PDF** dari aplikasi:
  A4, 4 kartu, ukuran kertas & posisi kartu sudah final, siap dicetak/kirim ke percetakan.
* `contoh-kartu-undangan.jpg` (di folder induk) — contoh hasil tombol **JPG**
  (591 × 886 px, 150 dpi): satu kartu lengkap dengan QR, sama dengan pratinjau.
* `kartu-undangan-10x15-contoh.pdf` — `python3 tools/make-cards-pdf.py` (bawaan 4 kartu/A4;
  opsi `--2-per-a4`, `--4-per-a3`, `--satu-per-halaman`)

---

## 13b. Suara undian (Natal & mendebarkan)

Layar `undian.html` sekarang **bersuara** saat mengundi. Semua bunyi dibuat di
perangkat dengan **Web Audio API** — tidak ada berkas `.mp3`, jadi tidak menambah
berat halaman, tetap jalan offline, dan tidak memakai kuota.

| Momen | Bunyi |
|---|---|
| Tombol **▶ MULAI** ditekan | **drum gulir** (snare roll) yang makin cepat & keras + **riser** nada menaik → ketegangan |
| Selama digit berputar | alunan **“Deck the Halls”** (tema Natal, domain publik) dengan timbre **lonceng/glockenspiel** + bas lembut |
| Digit 1 → 2 → 3 terkunci | bunyi **“tok”** yang makin tinggi (umpan balik tiap digit berhenti) |
| Pemenang muncul | **fanfare**: lonceng C5–G5–C6, akor C→G (nuansa paduan suara), ditutup gemerincing “kring” mengikuti konfeti |
| **Tidak Hadir — Undi Ulang** | dua nada turun (penanda “batal”) |

Kontrol:

* Tombol **🔊 / 🔇** di baris kontrol layar undian. Pilihan disimpan di perangkat
  (`draw_bisu`), jadi tetap mati bila halaman dimuat ulang — berguna kalau ruangan
  memakai sound system lain.
* Peramban baru mengizinkan bunyi setelah ada sentuhan/klik pengguna. Halaman ini
  sudah “membuka kunci” audio pada gestur pertama (klik tombol atau tekan Spasi),
  jadi suara langsung jalan saat **MULAI** ditekan.

Berkas: `js/undian-audio.js` (modul mandiri, tanpa dependensi). Contoh bunyi
(rekaman 4 detik dari mesin yang sama, dibuat dengan Python):
`undian-suara-demo.wav` di folder induk.

---

## 13c. Meja registrasi versi panitia (di dalam panel admin)

Dipakai bila tamu **tidak bisa memakai HP-nya sendiri** (HP mati, lupa membawa,
orang tua yang perlu dibantu) dan menyebutkan namanya ke panitia.

Panel admin → tab **Undangan & QR** → tombol **🗒️ Meja registrasi (mode panitia)**.

| Bagian | Fungsi |
|---|---|
| Penghitung **“Undangan yang belum tercatat hadir: N”** | pemantauan manual: harus turun **satu** tiap tamu |
| Cari + dropdown **nama sesuai rekap hadir** | memilih tamu undangan; nomor lamanya dipakai, **tidak membuat nomor baru** |
| Jumlah keluarga + 🍱 kupon + 🎁 souvenir | ikut tersimpan saat **Hadirkan** |
| **➕ Tamu tanpa undangan** | nama, HP (boleh dikosongkan), asal → nomor baru ≥ 501. Nama yang sudah terdaftar **ditolak** (`admin_add`), jadi tidak bisa dobel |
| **🕘 Aktivitas terakhir** | 8 pencatatan terakhir (nama, jam, sumber) untuk menelusuri kejanggalan |

Tombol ini tidak mengubah apa pun bila tidak dibuka — panel admin tetap ringan.

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
