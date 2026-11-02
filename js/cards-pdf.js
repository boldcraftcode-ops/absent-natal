/* ==========================================================================
   js/cards-pdf.js — gambar kartu undangan 10 × 15 cm ke PDF dengan jsPDF.
   Dipisah dari admin.js agar bisa diuji & dipakai ulang tanpa DOM/login.

   Prinsip: PDF harus MIRIP pratinjau di web (styles.css → .card15 ...).
   Susunan blok diambil 1:1 dari grid CSS pratinjau:
     .card15__rule  → baris tiga warna
     .card15__head  → bintang + nama acara + organisasi   (rata tengah)
     .card15__body  → QR (40 mm) + KEPADA/nama/asal        (1fr, melar)
     .card15__meta  → WAKTU + TEMPAT
     .card15__foot  → petunjuk + nomor kartu               (menempel di dasar)
   Karena itu blok kaki selalu di dasar kartu (seperti grid 1fr di CSS),
   dan bila teks terlalu panjang ukuran huruf menyusut otomatis — tidak ada
   teks terpotong "…" maupun yang keluar dari kartu.
   ========================================================================== */

export const PDF_WARNA = {
  cocoa: '#352016', cocoaSoft: '#553D29', cran: '#6E2622', olive: '#3F4D2A',
  honey: '#9C6B34', kraft: '#C2AE93', kraftSoft: '#B9A68C', ink: '#7A6650', abu: '#8A7A63'
};
export const FONT_UI = 'helvetica';
export const FONT_DISPLAY = 'times';

/** Warna latar kartu (kertas kraft muda) sebagai RGB. */
export const WARNA_KARTU = [249, 243, 233];

/** Muat jsPDF dari vendor (offline) atau CDN bila berkas lokal tidak ada. */
export function loadJsPdf() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (window.__jspdfLoading) return window.__jspdfLoading;

  const sumber = ['./vendor/jspdf.umd.min.js',
    'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js'];
  window.__jspdfLoading = new Promise((resolve, reject) => {
    const coba = (i) => {
      if (i >= sumber.length) { reject(new Error('Pustaka PDF tidak bisa dimuat. Periksa koneksi lalu muat ulang halaman.')); return; }
      const s = document.createElement('script');
      s.src = sumber[i];
      s.async = true;
      s.onload = () => (window.jspdf?.jsPDF
        ? resolve(window.jspdf.jsPDF)
        : reject(new Error('Pustaka PDF tidak dikenali.')));
      s.onerror = () => coba(i + 1);
      document.head.appendChild(s);
    };
    coba(0);
  });
  return window.__jspdfLoading;
}

/* ------------------------------------------------------------------ utilitas */

/** '#rrggbb' -> [r, g, b] */
function rgb(hex) {
  const h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Warna pada posisi t (0..1) dari daftar stop [[t, [r,g,b]], ...]. */
function warnaPada(stop, t) {
  for (let i = 1; i < stop.length; i += 1) {
    const [t0, c0] = stop[i - 1];
    const [t1, c1] = stop[i];
    if (t <= t1 || i === stop.length - 1) {
      const k = t1 === t0 ? 0 : Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k));
    }
  }
  return stop[stop.length - 1][1];
}

/** Gradasi latar kartu (CSS: linear-gradient(160deg, #FFFAF1, #F6EBD8 58%, #F0DFC4)). */
function latarGradien(doc, x, y, w, h) {
  const stop = [[0, [255, 250, 241]], [0.58, [246, 235, 216]], [1, [240, 223, 196]]];
  const n = 56;
  const tinggi = h / n;
  for (let i = 0; i < n; i += 1) {
    const c = warnaPada(stop, (i + 0.5) / n);
    doc.setFillColor(c[0], c[1], c[2]);
    doc.rect(x, y + i * tinggi, w, tinggi + 0.25, 'F');
  }
}

/** Bintang lima sudut kecil (pengganti glif ✦ yang tak ada di font standar PDF). */
function bintang(doc, cx, cy, r, warna) {
  const titik = [];
  for (let i = 0; i < 10; i += 1) {
    const sudut = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.42;
    titik.push([cx + Math.cos(sudut) * rr, cy + Math.sin(sudut) * rr]);
  }
  doc.setFillColor(...rgb(warna));
  doc.lines(titik.slice(1).map(([px, py], i) => [px - titik[i][0], py - titik[i][1]]),
    titik[0][0], titik[0][1], [1, 1], 'F', true);
}

/**
 * Bagi teks menjadi baris yang muat pada lebar maxW.
 * Ukuran `ukuran` dalam mm (sudah dikali skala kartu).
 * Mengembalikan { baris, tinggi, terpotong }.
 */
function ukurTeks(doc, teks, maxW, { font = FONT_UI, gaya = 'normal', ukuran, lh = 1.2, maxBaris = 99 }) {
  doc.setFont(font, gaya);
  doc.setFontSize(ukuran * 2.8346);
  const mentah = String(teks ?? '').split('\n')
    .map((b) => b.replace(/\s+/g, ' ').trim())
    .filter((b, i, arr) => b || arr.length === 1);
  let baris = [];
  mentah.forEach((b) => {
    if (!b) { baris.push(''); return; }
    baris = baris.concat(doc.splitTextToSize(b, maxW) || []);
  });
  let terpotong = false;
  if (baris.length > maxBaris) {
    terpotong = true;
    baris = baris.slice(0, maxBaris);
  }
  return { baris, tinggi: baris.length * ukuran * lh, terpotong };
}

/** Tulis blok teks; mengembalikan tinggi yang dipakai (mm). */
function tulisTeks(doc, baris, x, atas, { font, gaya, warna, ukuran, lh = 1.2, align = 'left' }) {
  if (!baris.length) return 0;
  doc.setFont(font, gaya);
  doc.setFontSize(ukuran * 2.8346);
  doc.setTextColor(...rgb(warna));
  const baseline = atas + ukuran * 0.8;
  baris.forEach((b, i) => doc.text(b, x, baseline + i * ukuran * lh, { align }));
  return baris.length * ukuran * lh;
}

/* --------------------------------------------------------------- tata letak */

/**
 * Ukuran dalam "mm desain" (kartu 100 × 150 mm) — disalin dari styles.css
 * .card15* supaya hasil PDF setara pratinjau web.
 */
/** Petunjuk kaki kartu (dua baris, sama dengan pratinjau). */
const TEKS_TIPS = 'Pindai QR untuk konfirmasi kehadiran.\nNomor undian muncul setelah pindai.';

const DESAIN = {
  rule: 1.2, pad: 6, gap: 4,
  star: 4.6, event: 6.4, org: 2.9,
  qr: 40, label: 2.6, nama: 5.6, sub: 3,
  meta: 3, tips: 2.7, no: 2.6
};

/** Ukuran huruf & QR (mm) untuk faktor susut k. */
function ukuranUntuk(mm, k) {
  return {
    star: mm(DESAIN.star) * k, event: mm(DESAIN.event) * k, org: mm(DESAIN.org) * k,
    qr: mm(DESAIN.qr) * k, label: mm(DESAIN.label) * k, nama: mm(DESAIN.nama) * k,
    sub: mm(DESAIN.sub) * k, meta: mm(DESAIN.meta) * k, tips: mm(DESAIN.tips) * k,
    no: mm(DESAIN.no) * k
  };
}

/**
 * Ukur seluruh blok untuk satu set ukuran huruf.
 * Menghasilkan tinggi tiap blok + penanda `terpotong` bila ada teks yang
 * tidak muat dalam jumlah baris maksimum.
 */
function ukurKartu(doc, p, info, rw, U, mm) {
  const ev = ukurTeks(doc, info.name, rw, { font: FONT_DISPLAY, gaya: 'bold', ukuran: U.event, lh: 1.12, maxBaris: 4 });
  const org = info.org
    ? ukurTeks(doc, String(info.org).toUpperCase(), rw, { font: FONT_UI, gaya: 'bold', ukuran: U.org, lh: 1.3, maxBaris: 2 })
    : { baris: [], tinggi: 0, terpotong: false };

  const infoW = rw - U.qr - 5;
  const label = ukurTeks(doc, 'KEPADA', infoW, { font: FONT_UI, gaya: 'bold', ukuran: U.label, lh: 1.2 });
  const nama = ukurTeks(doc, p.name, infoW, { font: FONT_DISPLAY, gaya: 'bold', ukuran: U.nama, lh: 1.15, maxBaris: 5 });
  const sub = p.org
    ? ukurTeks(doc, p.org, infoW, { font: FONT_UI, gaya: 'normal', ukuran: U.sub, lh: 1.35, maxBaris: 3 })
    : { baris: [], tinggi: 0, terpotong: false };

  const headH = U.star * 1.15 + 1 + ev.tinggi + (org.tinggi ? 1.2 + org.tinggi : 0);
  const teksH = label.tinggi + 0.8 + nama.tinggi + (sub.tinggi ? 1.2 + sub.tinggi : 0);
  const bodyH = Math.max(U.qr, teksH);

  const lebarNilai = Math.max(20, rw - mm(17));
  const when = info.when
    ? ukurTeks(doc, info.when, lebarNilai, { font: FONT_UI, gaya: 'normal', ukuran: U.meta, lh: 1.4, maxBaris: 3 })
    : { baris: [], tinggi: 0, terpotong: false };
  const place = info.place
    ? ukurTeks(doc, info.place, lebarNilai, { font: FONT_UI, gaya: 'normal', ukuran: U.meta, lh: 1.4, maxBaris: 3 })
    : { baris: [], tinggi: 0, terpotong: false };
  const metaH = (info.when || info.place)
    ? 0.3 + 3 + when.tinggi + (when.tinggi && place.tinggi ? 1.6 : 0) + place.tinggi
    : 0;

  const tips = ukurTeks(doc, TEKS_TIPS, rw - 16, {
    font: FONT_UI, gaya: 'normal', ukuran: U.tips, lh: 1.3, maxBaris: 3
  });
  const footH = 0.3 + 2.6 + Math.max(tips.tinggi, U.no * 1.3);

  const terpotong = ev.terpotong || org.terpotong || nama.terpotong || sub.terpotong
    || when.terpotong || place.terpotong || tips.terpotong;

  return { headH, bodyH, teksH, metaH, footH, terpotong };
}

/** Gambar satu kartu undangan pada posisi (x, y) berukuran w × h (mm). */
function drawCardPdf(doc, p, nomor, total, info, x, y, w, h, opts = {}) {
  const S_ = Math.min(w / 100, h / 150);            // skala dari desain 100 × 150 mm
  const mm = (v) => v * S_;                         // ukuran desain (mm) -> mm sebenarnya
  const pad = mm(DESAIN.pad);
  const gap = mm(DESAIN.gap);
  const rx = x + pad;
  const rw = w - pad * 2;
  const tengah = x + w / 2;

  /* --- dasar kartu: gradasi + tanda sudut + bingkai garis putus-putus ----- */
  doc.saveGraphicsState();
  doc.roundedRect(x, y, w, h, mm(3), mm(3), null);
  doc.clip();
  doc.discardPath();

  latarGradien(doc, x, y, w, h);

  // tanda sudut (CSS .card15::after, 5 mm)
  doc.setDrawColor(...rgb(PDF_WARNA.abu));
  doc.setLineWidth(0.25);
  const t = mm(5);
  [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([cx, cy, sx, sy]) => {
    doc.line(cx, cy, cx + sx * t, cy);
    doc.line(cx, cy, cx, cy + sy * t);
  });

  // bingkai garis putus-putus di dalam tepi (CSS .card15::before)
  doc.setDrawColor(...rgb(PDF_WARNA.kraft));
  doc.setLineWidth(0.2);
  if (doc.setLineDashPattern) doc.setLineDashPattern([mm(1.6), mm(1.4)], 0);
  doc.roundedRect(x + mm(1.5), y + mm(1.5), w - mm(3), h - mm(3), mm(2.4), mm(2.4), 'D');
  if (doc.setLineDashPattern) doc.setLineDashPattern([], 0);

  /* --- penyusutan otomatis sampai semua blok muat tanpa terpotong -------- */
  const tinggiIsi = h - pad * 2;
  const ruangTetap = (U, ukur) => mm(DESAIN.rule) + gap * 3 + ukur.headH + ukur.metaH + ukur.footH;
  let k = 1;
  let U = ukuranUntuk(mm, k);
  let ukur = ukurKartu(doc, p, info, rw, U, mm);
  for (let langkah = 0; langkah < 14; langkah += 1) {
    const perlu = ruangTetap(U, ukur) + ukur.bodyH;
    if (perlu <= tinggiIsi && !ukur.terpotong) break;
    if (k <= 0.62) break;
    const saran = perlu > 0 ? tinggiIsi / perlu : 1;
    k = Math.max(0.62, k * Math.min(0.97, saran === 1 ? 0.94 : Math.max(0.86, saran)));
    U = ukuranUntuk(mm, k);
    ukur = ukurKartu(doc, p, info, rw, U, mm);
  }

  /* --- posisi vertikal: kaki menempel dasar, badan melar (grid 1fr) ------ */
  const atasIsi = y + pad;
  const footAtas = y + h - pad - ukur.footH;          // blok kaki selalu di dasar
  let metaAtas = footAtas - gap * 0.55;
  if (ukur.metaH) metaAtas -= ukur.metaH;
  const bodyAtas = atasIsi + mm(DESAIN.rule) + gap + ukur.headH + gap;
  const bodyBawah = (ukur.metaH ? metaAtas : footAtas) - gap;
  const bodyLuar = Math.max(ukur.bodyH, bodyBawah - bodyAtas);

  /* --- 1. baris tiga warna ---------------------------------------------- */
  const cy0 = atasIsi;
  const potong = rw / 3;
  doc.setFillColor(...rgb(PDF_WARNA.cran)); doc.rect(rx, cy0, potong, mm(DESAIN.rule), 'F');
  doc.setFillColor(0xC0, 0x8A, 0x4E); doc.rect(rx + potong, cy0, potong, mm(DESAIN.rule), 'F');
  doc.setFillColor(0x45, 0x50, 0x26); doc.rect(rx + potong * 2, cy0, potong, mm(DESAIN.rule), 'F');

  /* --- 2. kepala: bintang, nama acara, organisasi (rata tengah) --------- */
  let cy = cy0 + mm(DESAIN.rule) + gap;
  bintang(doc, tengah, cy + U.star * 0.55, U.star * 0.55, PDF_WARNA.honey);
  cy += U.star * 1.15 + 1;
  cy += tulisTeks(doc, ukurTeks(doc, info.name, rw, {
    font: FONT_DISPLAY, gaya: 'bold', ukuran: U.event, lh: 1.12, maxBaris: 4
  }).baris, tengah, cy, {
    font: FONT_DISPLAY, gaya: 'bold', warna: PDF_WARNA.cocoa, ukuran: U.event, lh: 1.12, align: 'center'
  });
  if (info.org) {
    cy += 1.2;
    tulisTeks(doc, ukurTeks(doc, String(info.org).toUpperCase(), rw, {
      font: FONT_UI, gaya: 'bold', ukuran: U.org, lh: 1.3, maxBaris: 2
    }).baris, tengah, cy, {
      font: FONT_UI, gaya: 'bold', warna: PDF_WARNA.cran, ukuran: U.org, lh: 1.3, align: 'center'
    });
  }

  /* --- 3. badan: QR + KEPADA/nama/asal (dipusatkan di ruang melar) ------ */
  const isiBody = Math.max(U.qr, ukur.teksH);
  const bodyY = bodyAtas + Math.max(0, (bodyLuar - isiBody) / 2);
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...rgb(PDF_WARNA.cocoa));
  doc.setLineWidth(0.4);
  doc.roundedRect(rx, bodyY, U.qr, U.qr, mm(2), mm(2), 'FD');
  try {
    const png = opts.qr || '';
    if (png) doc.addImage(png, 'PNG', rx + mm(1.6), bodyY + mm(1.6), U.qr - mm(3.2), U.qr - mm(3.2));
  } catch { /* QR gagal: kartu tetap dibuat */ }

  const infoX = rx + U.qr + 5;
  const infoW = rx + rw - infoX;
  let ty = bodyY + Math.max(0, (U.qr - ukur.teksH) / 2);
  ty += tulisTeks(doc, ukurTeks(doc, 'KEPADA', infoW, {
    font: FONT_UI, gaya: 'bold', ukuran: U.label, lh: 1.2
  }).baris, infoX, ty, {
    font: FONT_UI, gaya: 'bold', warna: PDF_WARNA.ink, ukuran: U.label, lh: 1.2
  });
  ty += 0.8;
  ty += tulisTeks(doc, ukurTeks(doc, p.name, infoW, {
    font: FONT_DISPLAY, gaya: 'bold', ukuran: U.nama, lh: 1.15, maxBaris: 5
  }).baris, infoX, ty, {
    font: FONT_DISPLAY, gaya: 'bold', warna: PDF_WARNA.cocoa, ukuran: U.nama, lh: 1.15
  });
  if (p.org) {
    ty += 1.2;
    tulisTeks(doc, ukurTeks(doc, p.org, infoW, {
      font: FONT_UI, gaya: 'normal', ukuran: U.sub, lh: 1.35, maxBaris: 3
    }).baris, infoX, ty, {
      font: FONT_UI, gaya: 'normal', warna: PDF_WARNA.olive, ukuran: U.sub, lh: 1.35
    });
  }

  /* --- 4. waktu & tempat ------------------------------------------------ */
  if (ukur.metaH) {
    let my = metaAtas;
    doc.setDrawColor(...rgb(PDF_WARNA.kraft));
    doc.setLineWidth(0.3);
    doc.line(rx, my, rx + rw, my);
    my += 3;
    const lebarNilai = Math.max(20, rw - mm(17));
    let pertama = true;
    [['WAKTU', info.when], ['TEMPAT', info.place]].forEach(([label, nilai]) => {
      if (!nilai) return;
      const baris = ukurTeks(doc, nilai, lebarNilai, {
        font: FONT_UI, gaya: 'normal', ukuran: U.meta, lh: 1.4, maxBaris: 3
      });
      if (!pertama) my += 1.6;
      pertama = false;
      tulisTeks(doc, [label], rx, my, {
        font: FONT_UI, gaya: 'bold', warna: PDF_WARNA.cran, ukuran: U.meta, lh: 1.4
      });
      tulisTeks(doc, baris.baris, rx + mm(17), my, {
        font: FONT_UI, gaya: 'normal', warna: PDF_WARNA.cocoaSoft, ukuran: U.meta, lh: 1.4
      });
      my += baris.tinggi;
    });
  }

  /* --- 5. kaki: garis putus-putus, petunjuk, nomor kartu ---------------- */
  let fy = footAtas;
  if (doc.setLineDashPattern) doc.setLineDashPattern([mm(1.4), mm(1.2)], 0);
  doc.setDrawColor(...rgb(PDF_WARNA.kraft));
  doc.setLineWidth(0.3);
  doc.line(rx, fy, rx + rw, fy);
  if (doc.setLineDashPattern) doc.setLineDashPattern([], 0);
  fy += 2.6;
  const tips = ukurTeks(doc, TEKS_TIPS, rw - 16, {
    font: FONT_UI, gaya: 'normal', ukuran: U.tips, lh: 1.3, maxBaris: 3
  });
  tulisTeks(doc, tips.baris, rx, fy, {
    font: FONT_UI, gaya: 'normal', warna: PDF_WARNA.ink, ukuran: U.tips, lh: 1.3
  });
  doc.setFont(FONT_UI, 'normal');
  doc.setFontSize(U.no * 2.8346);
  doc.setTextColor(...rgb(PDF_WARNA.kraft));
  doc.text(`${String(nomor).padStart(2, '0')}/${total}`, rx + rw,
    fy + tips.tinggi / 2 + U.no * 0.4, { align: 'right' });

  doc.restoreGraphicsState();
}

/** Bagi teks menjadi maksimal `max` baris (dipertahankan untuk pengujian). */
function pdfLines(doc, text, maxW, max) {
  const garis = doc.splitTextToSize(String(text || ''), maxW) || [];
  if (garis.length <= max) return garis;
  return garis.slice(0, max - 1).concat([`${garis[max - 1].slice(0, -1)}…`]);
}

export { drawCardPdf, pdfLines };
