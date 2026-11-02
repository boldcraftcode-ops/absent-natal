/* ==========================================================================
   tests/pdf.test.mjs — uji tata letak kartu PDF (js/cards-pdf.js).
   Fokus: PDF harus mengikuti tata letak pratinjau web dan TIDAK memotong teks.

   Cara uji: menggambar kartu ke PDF sungguhan (jsPDF + jsdom), lalu memakai
   hook `doc.text` untuk mencatat setiap baris teks yang ditulis beserta
   ukuran & posisinya. Dari situ diperiksa:
     * tidak ada teks yang hilang (semua isi kartu tercetak)
     * tidak ada "…" (tanda teks dipotong)
     * semua teks berada di dalam kotak kartu
     * urutan blok = urutan pratinjau (baris warna → judul → QR/nama → waktu → kaki)
   ========================================================================== */
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'tests', 'x.cjs'));

/* ------------------------------------------------------- lingkungan jsPDF */
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://contoh.test/admin.html' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.HTMLAnchorElement = dom.window.HTMLAnchorElement;

const { jsPDF } = require(join(ROOT, 'vendor', 'jspdf.umd.min.js'));
dom.window.jspdf = { jsPDF };
globalThis.jspdf = { jsPDF };

const { drawCardPdf } = await import(pathToFileURL(join(ROOT, 'js', 'cards-pdf.js')).href);

/* --------------------------------------------------------------- utilitas */
let lulus = 0;
let gagal = 0;
function check(nama, syarat, detail = '') {
  if (syarat) { lulus += 1; console.log(`  ok   ${nama}`); }
  else { gagal += 1; console.log(`  GAGAL ${nama}${detail ? ` — ${detail}` : ''}`); }
}

/** Rekam semua panggilan doc.text selama menggambar satu kartu. */
function gambarKartu(p, info, { nomor = 1, total = 1, w = 95, h = 142.5, qr } = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const rekam = [];
  const asli = doc.text.bind(doc);
  doc.text = (teks, x, y, opt) => {
    const daftar = Array.isArray(teks) ? teks : [teks];
    daftar.forEach((t) => rekam.push({
      teks: String(t), x, y,
      ukuran: doc.getFontSize() / 2.8346,          // pt -> mm
      font: doc.getFont().fontName
    }));
    return asli(teks, x, y, opt);
  };
  const asliGambar = doc.addImage.bind(doc);
  let gambar = 0;
  doc.addImage = (...a) => { gambar += 1; return asliGambar(...a); };

  const X = 10;
  const Y = 10;
  drawCardPdf(doc, p, nomor, total, info, X, Y, w, h, { qr });
  return { doc, rekam, gambar, kotak: { X, Y, w, h } };
}

/* ------------------------------------------------------- data uji realistis */
const INFO = {
  name: 'Perayaan Natal Keluarga Besar GSJA Medan',
  org: 'GSJA Jemaat Medan Sunggal',
  when: 'Kamis, 24 Desember 2026 · 18.00 WIB',
  place: 'Gedung Elim, Jl. Gatot Subroto No. 12, Medan'
};
const TAMU = { name: 'Budi Santoso', org: 'Divisi Pemuda', token: 'tok1' };

const INFO_LENGKAP = {
  name: 'Perayaan Natal Gabungan Keluarga Besar GSJA Wilayah Sumatera Utara Tahun 2026',
  org: 'GSJA Jemaat Medan Sunggal dan Sekitarnya Wilayah Pelayanan II',
  when: 'Kamis, 24 Desember 2026 · 18.00 WIB sampai dengan selesai (registrasi 17.00)',
  place: 'Gedung Serbaguna Elim Lantai 3, Jl. Gatot Subroto No. 12 Kel. Sei Sikambing, Medan'
};
const TAMU_LENGKAP = {
  name: 'Bapak Ir. Alexander Simanjuntak Parlindungan Hutagalung, M.M., Ph.D.',
  org: 'Kepala Divisi Pelayanan Pemuda dan Remaja Wilayah II',
  token: 'tok2'
};

const normalisasi = (s) => String(s).replace(/\s+/g, ' ').trim();
const semuaTeks = (rekam) => normalisasi(rekam.map((r) => r.teks).join(' '));

console.log('== 1. Tidak ada teks yang dipotong (normal)');
{
  const { rekam, gambar } = gambarKartu(TAMU, INFO, { qr: 'data:image/png;base64,AAA' });
  const teks = semuaTeks(rekam);
  check('nama acara tercetak utuh', teks.includes(normalisasi(INFO.name)));
  check('nama tamu tercetak utuh', teks.includes('Budi Santoso'));
  check('asal tamu tercetak', teks.includes('Divisi Pemuda'));
  check('waktu tercetak utuh', teks.includes(normalisasi(INFO.when)));
  check('tempat tercetak utuh', teks.includes(normalisasi(INFO.place)));
  check('label KEPADA / WAKTU / TEMPAT ada',
    /KEPADA/.test(teks) && /WAKTU/.test(teks) && /TEMPAT/.test(teks));
  check('petunjuk kaki dua baris ada',
    /Pindai QR untuk konfirmasi kehadiran/.test(teks) && /Nomor undian muncul setelah pindai/.test(teks));
  check('tidak ada tanda teks dipotong (…)', !/…/.test(teks), teks.slice(0, 160));
  check('QR digambar tepat satu kali', gambar === 1, String(gambar));
}

console.log('== 2. Isi sangat panjang: menyusut, bukan dipotong');
{
  const { rekam, kotak } = gambarKartu(TAMU_LENGKAP, INFO_LENGKAP);
  const teks = semuaTeks(rekam);
  check('nama tamu panjang tercetak utuh (tanpa …)',
    teks.includes(normalisasi(TAMU_LENGKAP.name)) && !/…/.test(teks), teks.slice(0, 200));
  check('asal panjang tercetak utuh', teks.includes(normalisasi(TAMU_LENGKAP.org)));
  check('nama acara panjang tercetak utuh', teks.includes(normalisasi(INFO_LENGKAP.name)));
  check('tempat panjang tercetak utuh', teks.includes(normalisasi(INFO_LENGKAP.place)));
  check('ukuran huruf menyusut (lebih kecil dari kartu normal)', rekam.every((r) => r.ukuran < 6.4));
  // semua baseline tetap di dalam kotak kartu
  const luar = rekam.filter((r) => r.y < kotak.Y || r.y > kotak.Y + kotak.h);
  check('semua teks di dalam batas atas/bawah kartu', luar.length === 0,
    luar.map((r) => `${r.teks}@${r.y.toFixed(1)}`).join(', '));
}

console.log('== 3. Urutan blok = urutan pratinjau web');
{
  const { rekam, kotak } = gambarKartu(TAMU, INFO);
  const y = (pola) => rekam.find((r) => pola.test(r.teks))?.y ?? NaN;
  const atas = kotak.Y;
  const bawah = kotak.Y + kotak.h;
  const yJudul = y(/Perayaan Natal/);
  const yKepada = y(/KEPADA/);
  const yNama = y(/Budi Santoso/);
  const yWaktu = y(/WAKTU/);
  const yTempat = y(/TEMPAT/);
  const yTips = y(/Pindai QR/);
  const yNo = y(/^01\/1$/);
  check('judul acara di bagian atas', yJudul > atas && yJudul < atas + kotak.h * 0.35, `${yJudul.toFixed(1)}`);
  check('KEPADA di bawah judul', yKepada > yJudul);
  check('nama tamu di bawah KEPADA', yNama > yKepada);
  check('waktu & tempat di bawah nama', yWaktu > yNama && yTempat > yWaktu);
  check('petunjuk kaki di bawah tempat', yTips > yTempat);
  check('nomor kartu di kaki (bukan tengah kartu)', yNo > bawah - kotak.h * 0.2, `${yNo.toFixed(1)}`);
  // label meta & petunjuk kaki rata pada kolom kiri yang sama (seperti CSS)
  const xKiri = (pola) => rekam.find((r) => pola.test(r.teks))?.x ?? NaN;
  check('label WAKTU/TEMPAT rata kiri seperti pratinjau',
    Math.abs(xKiri(/WAKTU/) - xKiri(/Pindai QR/)) < 0.01 && Math.abs(xKiri(/TEMPAT/) - xKiri(/WAKTU/)) < 0.01,
    `${xKiri(/WAKTU/)} vs ${xKiri(/Pindai QR/)}`);
  check('nilai WAKTU menjorok ke kanan label', xKiri(/Kamis|24 Desember/) > xKiri(/WAKTU/));
}

console.log('== 4. Berbagai ukuran & susunan kartu');
{
  for (const [label, w, h] of [['4/A4 (95 × 142,5 mm)', 95, 142.5], ['2/A4 (100 × 150 mm)', 100, 150]]) {
    const { rekam, kotak } = gambarKartu(TAMU, INFO, { w, h });
    const luar = rekam.filter((r) => r.y < kotak.Y || r.y > kotak.Y + kotak.h);
    check(`${label}: teks tetap di dalam kartu`, luar.length === 0);
    check(`${label}: nama tamu tercetak`, semuaTeks(rekam).includes('Budi Santoso'));
    check(`${label}: tanpa tanda potong`, !/…/.test(semuaTeks(rekam)));
  }
}

console.log('== 5. Data kosong / tidak lengkap tidak merusak kartu');
{
  const { rekam } = gambarKartu({ name: 'Anonim', token: 't' }, { name: 'Perayaan Natal' });
  const teks = semuaTeks(rekam);
  check('tanpa waktu/tempat: label tidak dicetak', !/WAKTU/.test(teks) && !/TEMPAT/.test(teks));
  check('tanpa organisasi: tetap mencetak nama tamu', teks.includes('Anonim'));
  check('nomor kartu tetap dicetak', /01\/1/.test(teks));
}

console.log('== 6. Tanpa QR: kartu tetap dibuat');
{
  const { doc, gambar } = gambarKartu(TAMU, INFO);
  check('tanpa QR tidak ada gambar ditambahkan', gambar === 0);
  check('berkas PDF tetap terbentuk', doc.output('arraybuffer').byteLength > 1000);
}

console.log(`\n${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
