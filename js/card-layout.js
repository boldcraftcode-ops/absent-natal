/* ==========================================================================
   js/card-layout.js — tata letak kartu undangan, sekali tulis untuk 3 tujuan:

      1. js/cards-pdf.js  -> PDF (jsPDF)
      2. js/cards-jpg.js  -> JPG/PNG (canvas)
      3. pratinjau web    -> styles.css .card15

   Modul ini TIDAK menggambar apa pun. Ia hanya menghitung posisi & ukuran,
   lalu mengeluarkan daftar perintah gambar ("op") dalam satuan milimeter:

      { tipe:'gradasi'  , x, y, w, h, stop }
      { tipe:'kotak'    , x, y, w, h, r, isi, garis, lebar, dash }
      { tipe:'garis'    , x1, y1, x2, y2, warna, lebar, dash }
      { tipe:'teks'     , teks, x, y, ukuran, font, gaya, warna, align }
      { tipe:'gambar'   , src, x, y, w, h }
      { tipe:'bintang'  , cx, cy, r, warna }

   Pengukuran teks disuntikkan lewat `ukur` supaya satu sumber tata letak bisa
   dipakai mesin PDF (metrik font PDF) maupun canvas (metrik font sistem).
   ========================================================================== */

/** Warna yang dipakai pratinjau, PDF, dan JPG. */
export const WARNA = {
  cocoa: '#352016', cocoaSoft: '#553D29', cran: '#6E2622', olive: '#3F4D2A',
  honey: '#9C6B34', kraft: '#C2AE93', kraftSoft: '#B9A68C', ink: '#7A6650', abu: '#8A7A63'
};

/** Latar kartu: CSS linear-gradient(160deg, #FFFAF1, #F6EBD8 58%, #F0DFC4). */
export const LATAR = [[0, '#FFFAF1'], [0.58, '#F6EBD8'], [1, '#F0DFC4']];

/** Ukuran dalam "mm desain" (kartu 100 × 150 mm) — disalin dari styles.css .card15*. */
export const DESAIN = {
  rule: 1.2, pad: 6, gap: 4,
  star: 4.6, event: 6.4, org: 2.9,
  qr: 40, label: 2.6, nama: 5.6, sub: 3,
  meta: 3, tips: 2.7, no: 2.6,
  kolomLabel: 17, radius: 3, radiusDalam: 2.4
};

/** Petunjuk kaki kartu (dua baris, sama dengan pratinjau). */
export const TEKS_TIPS = 'Pindai QR untuk konfirmasi kehadiran.\nNomor undian muncul setelah pindai.';

/** Batas penyusutan otomatis (38 %). */
const SUSUT_MIN = 0.62;

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
 * Hitung seluruh blok untuk satu set ukuran huruf.
 * `ukur(teks, opsi)` harus mengembalikan { baris, tinggi, terpotong } dengan
 * `tinggi` dalam mm. `mm` adalah pengali desain -> mm sebenarnya.
 */
function ukurKartu(ukur, p, info, rw, U, mm) {
  const ev = ukur(info.name, { font: 'display', gaya: 'bold', ukuran: U.event, lh: 1.12, maxBaris: 4, maxW: rw });
  const org = info.org
    ? ukur(String(info.org).toUpperCase(), { font: 'ui', gaya: 'bold', ukuran: U.org, lh: 1.3, maxBaris: 2, maxW: rw })
    : { baris: [], tinggi: 0, terpotong: false };

  const infoW = rw - U.qr - 5;
  const label = ukur('KEPADA', { font: 'ui', gaya: 'bold', ukuran: U.label, lh: 1.2, maxW: infoW });
  const nama = ukur(p.name, { font: 'display', gaya: 'bold', ukuran: U.nama, lh: 1.15, maxBaris: 5, maxW: infoW });
  const sub = p.org
    ? ukur(p.org, { font: 'ui', gaya: 'normal', ukuran: U.sub, lh: 1.35, maxBaris: 3, maxW: infoW })
    : { baris: [], tinggi: 0, terpotong: false };

  const headH = U.star * 1.15 + 1 + ev.tinggi + (org.tinggi ? 1.2 + org.tinggi : 0);
  const teksH = label.tinggi + 0.8 + nama.tinggi + (sub.tinggi ? 1.2 + sub.tinggi : 0);
  const bodyH = Math.max(U.qr, teksH);

  const lebarNilai = Math.max(20, rw - mm(DESAIN.kolomLabel));
  const when = info.when
    ? ukur(info.when, { font: 'ui', gaya: 'normal', ukuran: U.meta, lh: 1.4, maxBaris: 3, maxW: lebarNilai })
    : { baris: [], tinggi: 0, terpotong: false };
  const place = info.place
    ? ukur(info.place, { font: 'ui', gaya: 'normal', ukuran: U.meta, lh: 1.4, maxBaris: 3, maxW: lebarNilai })
    : { baris: [], tinggi: 0, terpotong: false };
  const metaH = (info.when || info.place)
    ? 0.3 + 3 + when.tinggi + (when.tinggi && place.tinggi ? 1.6 : 0) + place.tinggi
    : 0;

  const tips = ukur(TEKS_TIPS, { font: 'ui', gaya: 'normal', ukuran: U.tips, lh: 1.3, maxBaris: 3, maxW: rw - 16 });
  const footH = 0.3 + 2.6 + Math.max(tips.tinggi, U.no * 1.3);

  const terpotong = ev.terpotong || org.terpotong || nama.terpotong || sub.terpotong
    || when.terpotong || place.terpotong || tips.terpotong;

  return { headH, bodyH, teksH, metaH, footH, terpotong };
}

/** Tekan daftar perintah gambar untuk satu kartu. */
function tulisBaris(ops, baris, x, atas, { font, gaya, warna, ukuran, lh = 1.2, align = 'left' }) {
  if (!baris.length) return 0;
  const baseline = atas + ukuran * 0.8;
  baris.forEach((b, i) => {
    if (b) ops.push({ tipe: 'teks', teks: b, x, y: baseline + i * ukuran * lh, ukuran, font, gaya, warna, align });
  });
  return baris.length * ukuran * lh;
}

/**
 * Susun satu kartu.
 * @param {object} p      peserta { name, org }
 * @param {object} info   { name, org, when, place } info acara
 * @param {object} opt    { x, y, w, h, nomor, total, ukur, qr }
 * @returns {{ops: Array, kotak: {x,y,w,h,r}}} semua dalam mm
 */
export function susunKartu(p, info, opt) {
  const { x, y, w, h, nomor = 1, total = 1, ukur, qr = '' } = opt;
  const S_ = Math.min(w / 100, h / 150);           // skala dari desain 100 × 150 mm
  const mm = (v) => v * S_;
  const pad = mm(DESAIN.pad);
  const gap = mm(DESAIN.gap);
  const rx = x + pad;
  const rw = w - pad * 2;
  const tengah = x + w / 2;
  const ops = [];

  // latar gradasi (digambar paling bawah, lalu semua isi di atasnya)
  ops.push({ tipe: 'gradasi', x, y, w, h, stop: LATAR });

  /* --- penyusutan otomatis sampai semua blok muat tanpa terpotong -------- */
  const tinggiIsi = h - pad * 2;
  const ruangTetap = (u) => mm(DESAIN.rule) + gap * 3 + u.headH + u.metaH + u.footH;
  let k = 1;
  let U = ukuranUntuk(mm, k);
  let ukurBlok = ukurKartu(ukur, p, info, rw, U, mm);
  for (let langkah = 0; langkah < 14; langkah += 1) {
    const perlu = ruangTetap(ukurBlok) + ukurBlok.bodyH;
    if (perlu <= tinggiIsi && !ukurBlok.terpotong) break;
    if (k <= SUSUT_MIN) break;
    const saran = perlu > 0 ? tinggiIsi / perlu : 1;
    k = Math.max(SUSUT_MIN, k * Math.min(0.97, saran === 1 ? 0.94 : Math.max(0.86, saran)));
    U = ukuranUntuk(mm, k);
    ukurBlok = ukurKartu(ukur, p, info, rw, U, mm);
  }

  /* --- posisi vertikal: kaki menempel dasar, badan melar (grid 1fr) ------ */
  const atasIsi = y + pad;
  const footAtas = y + h - pad - ukurBlok.footH;
  let metaAtas = footAtas - gap * 0.55;
  if (ukurBlok.metaH) metaAtas -= ukurBlok.metaH;
  const bodyAtas = atasIsi + mm(DESAIN.rule) + gap + ukurBlok.headH + gap;
  const bodyBawah = (ukurBlok.metaH ? metaAtas : footAtas) - gap;
  const bodyLuar = Math.max(ukurBlok.bodyH, bodyBawah - bodyAtas);

  /* --- tanda sudut 5 mm (CSS .card15::after) ---------------------------- */
  const t = mm(5);
  [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([cx, cy, sx, sy]) => {
    ops.push({ tipe: 'garis', x1: cx, y1: cy, x2: cx + sx * t, y2: cy, warna: WARNA.abu, lebar: 0.25 });
    ops.push({ tipe: 'garis', x1: cx, y1: cy, x2: cx, y2: cy + sy * t, warna: WARNA.abu, lebar: 0.25 });
  });

  /* --- 1. baris tiga warna (CSS .card15__rule) -------------------------- */
  const potong = rw / 3;
  [{ w: potong, c: WARNA.cran }, { w: potong, c: '#C08A4E' }, { w: potong, c: '#455026' }]
    .reduce((cx, seg) => {
      ops.push({ tipe: 'kotak', x: cx, y: atasIsi, w: seg.w, h: mm(DESAIN.rule), r: 0, isi: seg.c, garis: null });
      return cx + seg.w;
    }, rx);

  /* --- 2. kepala: bintang, nama acara, organisasi (rata tengah) --------- */
  let cy = atasIsi + mm(DESAIN.rule) + gap;
  ops.push({ tipe: 'bintang', cx: tengah, cy: cy + U.star * 0.55, r: U.star * 0.55, warna: WARNA.honey });
  cy += U.star * 1.15 + 1;
  cy += tulisBaris(ops, ukur(info.name, {
    font: 'display', gaya: 'bold', ukuran: U.event, lh: 1.12, maxBaris: 4, maxW: rw
  }).baris, tengah, cy, {
    font: 'display', gaya: 'bold', warna: WARNA.cocoa, ukuran: U.event, lh: 1.12, align: 'center'
  });
  if (info.org) {
    cy += 1.2;
    tulisBaris(ops, ukur(String(info.org).toUpperCase(), {
      font: 'ui', gaya: 'bold', ukuran: U.org, lh: 1.3, maxBaris: 2, maxW: rw
    }).baris, tengah, cy, {
      font: 'ui', gaya: 'bold', warna: WARNA.cran, ukuran: U.org, lh: 1.3, align: 'center'
    });
  }

  /* --- 3. badan: QR + KEPADA/nama/asal (dipusatkan di ruang melar) ------ */
  const isiBody = Math.max(U.qr, ukurBlok.teksH);
  const bodyY = bodyAtas + Math.max(0, (bodyLuar - isiBody) / 2);
  ops.push({
    tipe: 'kotak', x: rx, y: bodyY, w: U.qr, h: U.qr, r: mm(2),
    isi: '#FFFFFF', garis: WARNA.cocoa, lebar: 0.4
  });
  if (qr) {
    ops.push({ tipe: 'gambar', src: qr, x: rx + mm(1.6), y: bodyY + mm(1.6), w: U.qr - mm(3.2), h: U.qr - mm(3.2) });
  }

  const infoX = rx + U.qr + 5;
  const infoW = rx + rw - infoX;
  let ty = bodyY + Math.max(0, (U.qr - ukurBlok.teksH) / 2);
  ty += tulisBaris(ops, ukur('KEPADA', {
    font: 'ui', gaya: 'bold', ukuran: U.label, lh: 1.2, maxW: infoW
  }).baris, infoX, ty, {
    font: 'ui', gaya: 'bold', warna: WARNA.ink, ukuran: U.label, lh: 1.2
  });
  ty += 0.8;
  ty += tulisBaris(ops, ukur(p.name, {
    font: 'display', gaya: 'bold', ukuran: U.nama, lh: 1.15, maxBaris: 5, maxW: infoW
  }).baris, infoX, ty, {
    font: 'display', gaya: 'bold', warna: WARNA.cocoa, ukuran: U.nama, lh: 1.15
  });
  if (p.org) {
    ty += 1.2;
    tulisBaris(ops, ukur(p.org, {
      font: 'ui', gaya: 'normal', ukuran: U.sub, lh: 1.35, maxBaris: 3, maxW: infoW
    }).baris, infoX, ty, {
      font: 'ui', gaya: 'normal', warna: WARNA.olive, ukuran: U.sub, lh: 1.35
    });
  }

  /* --- 4. waktu & tempat (CSS .card15__meta) --------------------------- */
  if (ukurBlok.metaH) {
    let my = metaAtas;
    ops.push({ tipe: 'garis', x1: rx, y1: my, x2: rx + rw, y2: my, warna: WARNA.kraft, lebar: 0.3 });
    my += 3;
    const lebarNilai = Math.max(20, rw - mm(DESAIN.kolomLabel));
    let pertama = true;
    [['WAKTU', info.when], ['TEMPAT', info.place]].forEach(([label, nilai]) => {
      if (!nilai) return;
      const baris = ukur(nilai, { font: 'ui', gaya: 'normal', ukuran: U.meta, lh: 1.4, maxBaris: 3, maxW: lebarNilai });
      if (!pertama) my += 1.6;
      pertama = false;
      tulisBaris(ops, [label], rx, my, {
        font: 'ui', gaya: 'bold', warna: WARNA.cran, ukuran: U.meta, lh: 1.4
      });
      tulisBaris(ops, baris.baris, rx + mm(DESAIN.kolomLabel), my, {
        font: 'ui', gaya: 'normal', warna: WARNA.cocoaSoft, ukuran: U.meta, lh: 1.4
      });
      my += baris.tinggi;
    });
  }

  /* --- 5. kaki: garis putus-putus, petunjuk, nomor kartu ---------------- */
  let fy = footAtas;
  ops.push({ tipe: 'garis', x1: rx, y1: fy, x2: rx + rw, y2: fy, warna: WARNA.kraft, lebar: 0.3, dash: [mm(1.4), mm(1.2)] });
  fy += 2.6;
  const tips = ukur(TEKS_TIPS, { font: 'ui', gaya: 'normal', ukuran: U.tips, lh: 1.3, maxBaris: 3, maxW: rw - 16 });
  tulisBaris(ops, tips.baris, rx, fy, {
    font: 'ui', gaya: 'normal', warna: WARNA.ink, ukuran: U.tips, lh: 1.3
  });
  ops.push({
    tipe: 'teks', teks: `${String(nomor).padStart(2, '0')}/${total}`,
    x: rx + rw, y: fy + tips.tinggi / 2 + U.no * 0.4,
    ukuran: U.no, font: 'ui', gaya: 'normal', warna: WARNA.kraft, align: 'right'
  });

  return {
    ops,
    kotak: { x, y, w, h, r: mm(DESAIN.radius) },
    bingkai: {
      x: x + mm(1.5), y: y + mm(1.5), w: w - mm(3), h: h - mm(3),
      r: mm(DESAIN.radiusDalam), dash: [mm(1.6), mm(1.4)], warna: WARNA.kraft, lebar: 0.2
    },
    susut: k
  };
}
