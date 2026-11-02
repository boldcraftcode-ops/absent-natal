#!/usr/bin/env node
/**
 * tools/make-cards-sample.mjs
 * Membuat PRATINJAU KARTU UNDANGAN siap cetak (dasar kartu 10 x 15 cm).
 *
 * Susunan (opsi baris perintah):
 *   (bawaan)          4 kartu / lembar A4 — kartu 9,5 x 14,25 cm (95%)
 *   --2-per-a4        2 kartu / lembar A4 — kartu tepat 10 x 15 cm
 *   --4-per-a3        4 kartu / lembar A3 — kartu tepat 10 x 15 cm
 *
 * Catatan: 4 kartu 10 x 15 cm tidak mungkin muat di A4 (2 x 150 mm = 300 mm > 297 mm).
 *
 * Halaman ini tidak memakai JavaScript sama sekali (hanya berkas statis),
 * jadi bisa dicetak dari mana saja, termasuk tanpa internet.
 *
 * Jalankan: node tools/make-cards-sample.mjs
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'kartu-undangan-10x15.html');

/** Data contoh — ganti sesuai kebutuhan saat mencetak dari panel admin. */
const EVENT = {
  name: 'Perayaan Natal 2026',
  org: 'GBI Jalan Kemuliaan · Medan',
  when: 'Kamis, 24 Desember 2026 · 18.00 WIB',
  place: 'Gedung Elim, Jl. Gatot Subroto No. 12'
};

const LAYOUTS = {
  'a4-4': { perPage: 4, cols: 2, rows: 2, scale: 0.95, kertas: 'A4', ukuran: '9,5 × 14,25 cm' },
  'a4-2': { perPage: 2, cols: 2, rows: 1, scale: 1.0, kertas: 'A4', ukuran: '10 × 15 cm' },
  'a3-4': { perPage: 4, cols: 2, rows: 2, scale: 1.0, kertas: 'A3', ukuran: '10 × 15 cm' }
};
const ARGS = process.argv.slice(2);
const MODE = ARGS.includes('--2-per-a4') ? 'a4-2' : ARGS.includes('--4-per-a3') ? 'a3-4' : 'a4-4';
const L = LAYOUTS[MODE];

const GUESTS = [
  { name: 'Budi Santoso', org: 'Divisi TI', token: 'a1b2c3d4e5f60718' },
  { name: 'Siti Aminah', org: 'Divisi Keuangan', token: '1122334455aabbcc' },
  { name: 'Rudi Hartono', org: 'Wilayah Medan Kota', token: '99aabbccddeeff00' },
  { name: 'Maria Sinaga', org: 'Wilayah Medan Baru', token: '0f1e2d3c4b5a6978' }
];

/** QR contoh: matriks deterministik (bukan QR asli) hanya untuk pratinjau tata letak. */
function fakeQr(token, size = 25) {
  const cells = [];
  let h = 2166136261;
  for (const ch of token) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const inFinder = (x, y) =>
    (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inFinder(x, y)) continue;
      h = Math.imul(h ^ (x * 31 + y * 17), 16777619) >>> 0;
      cells.push({ x, y, on: (h >>> 13) % 100 < 47 });
    }
  }
  const rects = cells
    .filter((c) => c.on)
    .map((c) => `<rect x="${c.x}" y="${c.y}" width="1" height="1"/>`)
    .join('');
  // tiga pola pencari (finder) khas QR
  const finder = (fx, fy) => `
    <rect x="${fx}" y="${fy}" width="7" height="7"/>
    <rect x="${fx + 1}" y="${fy + 1}" width="5" height="5" fill="#fff"/>
    <rect x="${fx + 2}" y="${fy + 2}" width="3" height="3"/>`;
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" role="img" aria-label="Kode QR undangan"
    shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/>
    <g fill="#352016">${rects}</g>
    <g fill="#352016">${finder(0, 0)}${finder(size - 7, 0)}${finder(0, size - 7)}</g></svg>`;
}

const card = (g, i) => `
  <article class="card15" aria-label="Kartu ${g.name}">
    <div class="card15__inner">
      <div class="card15__rule"></div>
      <div class="card15__head">
        <div class="card15__star" aria-hidden="true">✦</div>
        <div class="card15__event">${EVENT.name}</div>
        <div class="card15__org">${EVENT.org}</div>
      </div>

      <div class="card15__body">
        <div class="card15__qr">${fakeQr(g.token)}</div>
        <div class="card15__info">
          <div class="card15__label">Kepada</div>
          <div class="card15__name">${g.name}</div>
          <div class="card15__sub">${g.org}</div>
        </div>
      </div>

      <div class="card15__meta">
        <div><span>Waktu</span><strong>${EVENT.when}</strong></div>
        <div><span>Tempat</span><strong>${EVENT.place}</strong></div>
      </div>

      <div class="card15__foot">
        <div class="cut">✂</div>
        <div class="card15__tips">
          Pindai QR untuk konfirmasi kehadiran · Nomor undian muncul setelah pindai
        </div>
        <div class="card15__no">${String(i + 1).padStart(2, '0')} / ${GUESTS.length}</div>
      </div>
    </div>
  </article>`;

const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kartu Undangan 10 × 15 cm — siap cetak</title>
<style>
  /* ===== palet sama dengan aplikasi ===== */
  :root {
    --kraft-50:#F7F0E4; --kraft-100:#EBDECB; --kraft-200:#E0DACD; --kraft-300:#CBBDA6;
    --cocoa-900:#2A1A12; --cocoa-800:#352016; --cocoa-700:#553D29;
    --cran-800:#6E2622; --cran-700:#83322D; --cran-600:#9E3B33;
    --olive-700:#3F4D2A; --olive-600:#455026; --honey-500:#C08A4E; --honey-400:#D9A96B;
    --ink-soft:#7A6650;
    --font-ui: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    --font-display: "Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #E7DECD; color: var(--cocoa-800);
    font-family: var(--font-ui); line-height: 1.35;
  }

  /* ===== bilah alat (tidak ikut tercetak) ===== */
  .bar {
    position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 10px;
    align-items: center; padding: 12px 16px; color: var(--kraft-50);
    background: linear-gradient(180deg, #3E2A1D, #2A1A12);
    border-bottom: 3px solid var(--honey-500);
  }
  .bar h1 { font-family: var(--font-display); font-size: 1rem; margin: 0 8px 0 0; }
  .bar span { font-size: .8rem; opacity: .85; }
  .bar button {
    font: 600 .82rem var(--font-ui); padding: 9px 14px; border-radius: 8px; cursor: pointer;
    border: 1px solid rgba(235,222,203,.5); background: transparent; color: var(--kraft-50);
  }
  .bar button.utama { background: var(--cran-700); border-color: var(--cran-700); }
  .bar button.utama:hover { background: var(--cran-600); }
  .bar .spacer { flex: 1 1 auto; }

  .hintbar {
    max-width: 1200px; margin: 14px auto 0; padding: 10px 14px; border-radius: 10px;
    background: #FFFCF6; border: 1px solid var(--kraft-300); font-size: .82rem; color: var(--ink-soft);
  }
  .hintbar strong { color: var(--cocoa-800); }

  /* ===== lembar cetak: kartu 10x15 cm ===== */
  .sheet { padding: 10mm 0 18mm; }
  .page {
    width: 210mm; height: 297mm; margin: 0 auto 8mm; padding: 4mm 5mm;
    background: #fff; box-shadow: 0 10px 30px rgba(42,26,18,.18);
    display: grid; align-content: start; justify-content: center;
    grid-template-columns: repeat(2, 100mm); grid-auto-rows: 150mm; gap: 3mm 8mm;
  }
  /* 4 kartu per A4: kartu diskalakan 95% */
  .inv-sheet--a4-4 .page { grid-template-columns: repeat(2, 95mm); grid-auto-rows: 142.5mm; gap: 2mm 8mm; }
  .inv-sheet--a4-4 .card15 { zoom: .95; }
  /* 4 kartu per A3: kartu 10 x 15 cm penuh */
  .inv-sheet--a3-4 .page { width: 297mm; height: 420mm; grid-template-columns: repeat(2, 100mm);
    grid-auto-rows: 150mm; gap: 4mm 12mm; }
  .page__tag { position: absolute; top: 1.6mm; right: 3mm; font-size: 2.6mm;
    letter-spacing: .1em; text-transform: uppercase; color: var(--kraft-300, #CBBDA6); }
  .page { position: relative; }

  /* ===== kartu 10 x 15 cm (dipotong pas di garis) ===== */
  .card15 {
    width: 100mm; height: 150mm; position: relative;
    background: linear-gradient(160deg, #FFFAF1 0%, #F6EBD8 58%, #F0DFC4 100%);
    border: 1px solid #B9A68C; border-radius: 3mm; overflow: hidden;
    break-inside: avoid; page-break-inside: avoid;
  }
  /* garis potong di dalam tepi kartu */
  .card15::before {
    content: ""; position: absolute; inset: 1.5mm; pointer-events: none;
    border: .2mm dashed #C2AE93; border-radius: 2.4mm;
  }
  .card15__inner {
    position: absolute; inset: 6mm; display: grid;
    grid-template-rows: auto auto 1fr auto auto; gap: 4mm;
  }
  .card15__rule { height: 1.2mm; border-radius: 1mm;
    background: linear-gradient(90deg, var(--cran-700), var(--honey-500) 45%, var(--olive-600)); }
  .card15__head { text-align: center; }
  .card15__star { color: var(--honey-500); font-size: 4.6mm; line-height: 1; }
  .card15__event {
    font-family: var(--font-display); font-size: 6.4mm; font-weight: 700;
    letter-spacing: .01em; color: var(--cocoa-800); margin-top: .6mm;
  }
  .card15__org { font-size: 2.9mm; letter-spacing: .16em; text-transform: uppercase; color: var(--cran-800); margin-top: 1mm; }

  .card15__body { display: flex; gap: 5mm; align-items: center; }
  .card15__qr {
    flex: 0 0 40mm; width: 40mm; height: 40mm; padding: 1.6mm; background: #fff;
    border: .4mm solid var(--cocoa-800); border-radius: 2mm;
  }
  .card15__qr .qr { width: 100%; height: 100%; display: block; }
  .card15__info { min-width: 0; }
  .card15__label { font-size: 2.6mm; letter-spacing: .18em; text-transform: uppercase; color: var(--ink-soft); }
  .card15__name {
    font-family: var(--font-display); font-size: 5.6mm; font-weight: 700; line-height: 1.1;
    margin-top: .8mm; overflow-wrap: anywhere; color: var(--cocoa-800);
  }
  .card15__sub { font-size: 3mm; color: var(--olive-700); margin-top: 1.2mm; overflow-wrap: anywhere; }

  .card15__meta { display: grid; gap: 1.6mm; border-top: .3mm solid var(--kraft-300); padding-top: 3mm; }
  .card15__meta > div { display: grid; grid-template-columns: 17mm 1fr; gap: 2mm; font-size: 3mm; }
  .card15__meta span { color: var(--cran-800); font-weight: 700; letter-spacing: .04em; }
  .card15__meta strong { font-weight: 600; color: var(--cocoa-800); }

  .card15__foot {
    display: flex; align-items: center; gap: 3mm; border-top: .3mm dashed var(--kraft-500, #A98D6E);
    padding-top: 2.6mm;
  }
  .card15__foot .cut { color: var(--honey-500); font-size: 3.4mm; }
  .card15__tips { flex: 1 1 auto; font-size: 2.7mm; color: var(--ink-soft); line-height: 1.25; }
  .card15__no { font-size: 2.6mm; color: var(--kraft-500, #A98D6E); font-variant-numeric: tabular-nums; }

  /* ===== saat dicetak ===== */
  @page { size: PAGESIZE; margin: 0; }
  @media print {
    body { background: #fff; }
    .bar, .hintbar { display: none !important; }
    .sheet { padding: 0; }
    .page {
      width: PAGEW; height: PAGEH; margin: 0; padding: 4mm 5mm; box-shadow: none;
      break-after: page; page-break-after: always;
    }
    .page:last-child { break-after: auto; page-break-after: auto; }
    .page__tag { display: none; }
    .card15 { box-shadow: none; }
  }
  /* pratinjau di layar kecil: perkecil tampilan saja */
  @media screen and (max-width: 240mm) { .sheet { zoom: .7; } }
  @media screen and (max-width: 170mm) { .sheet { zoom: .52; } }
</style>
</head>
<body>

<div class="bar">
  <h1>Kartu undangan · 10 × 15 cm</h1>
  <span>${GUESTS.length} contoh · ${L.kertas} = ${L.perPage} kartu/lembar · ${L.ukuran}</span>
  <div class="spacer"></div>
  <button class="utama" onclick="window.print()">🖨️ Cetak / Simpan PDF</button>
</div>

<div class="hintbar">
  <strong>Susunan:</strong> <strong>${L.perPage} kartu per lembar ${L.kertas}</strong> ·
  ukuran kartu <strong>${L.ukuran}</strong> (dasar 10 × 15 cm).<br>
  <strong>Cara mencetak:</strong> tekan <strong>Cetak / Simpan PDF</strong>, pilih kertas
  <strong>${L.kertas}</strong>, skala <strong>100 %</strong> (jangan “Fit to page”),
  margin <strong>None</strong>, matikan <em>header–footer</em>.
  ${MODE === 'a4-4'
    ? 'Empat kartu 10 × 15 cm tidak mungkin muat di A4 (2 × 150 mm = 300 mm &gt; 297 mm), '
      + 'karena itu kartu diperkecil 5% menjadi 9,5 × 14,25 cm. Untuk ukuran tepat '
      + '10 × 15 cm pakai <code>--2-per-a4</code> atau <code>--4-per-a3</code>.'
    : 'Setiap kartu tepat 10 × 15 cm dan diberi garis potong tipis.'}
</div>

<div class="sheet inv-sheet--${MODE}">
  ${chunk(GUESTS, L.perPage).map((group, pi) => `<section class="page">
    <span class="page__tag">${L.kertas} · lembar ${pi + 1}/${Math.ceil(GUESTS.length / L.perPage)}</span>
    ${group.map((g) => card(g, GUESTS.indexOf(g))).join('')}
  </section>`).join('\n  ')}
</div>

</body>
</html>
`;

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ukuran kertas untuk @page mengikuti susunan
const pageW = L.kertas === 'A3' ? '297mm' : '210mm';
const pageH = L.kertas === 'A3' ? '420mm' : '297mm';
const final = html
  .replaceAll('PAGESIZE', L.kertas)
  .replaceAll('PAGEW', pageW)
  .replaceAll('PAGEH', pageH);

writeFileSync(OUT, final);
console.log(`kartu-undangan-10x15.html dibuat (${(final.length / 1024).toFixed(0)} KB, `
  + `${GUESTS.length} kartu ${L.ukuran}, ${L.perPage} kartu/lembar ${L.kertas})`);
