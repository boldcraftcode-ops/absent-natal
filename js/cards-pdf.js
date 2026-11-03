/* ==========================================================================
   js/cards-pdf.js — gambar kartu undangan 10 × 15 cm ke PDF dengan jsPDF.
   Tata letak diambil dari js/card-layout.js (modul yang sama dengan JPG),
   jadi PDF, JPG, dan pratinjau web selalu identik.
   ========================================================================== */

import { susunKartu, WARNA, DESAIN } from './card-layout.js';

export const PDF_WARNA = WARNA;
export const FONT_UI = 'helvetica';
export const FONT_DISPLAY = 'times';
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

/* ------------------------------------------------------------------ warna */
function rgb(hex) {
  const h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function warnaPada(stop, t) {
  const s = stop.map(([p, c]) => [p, rgb(c)]);
  for (let i = 1; i < s.length; i += 1) {
    const [t0, c0] = s[i - 1];
    const [t1, c1] = s[i];
    if (t <= t1 || i === s.length - 1) {
      const k = t1 === t0 ? 0 : Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k));
    }
  }
  return s[s.length - 1][1];
}

/* ------------------------------------------------- pengukur teks untuk PDF */
/**
 * Ukur teks dengan metrik font jsPDF. Mengembalikan baris + tinggi (mm).
 * `ukuran` dalam mm; jsPDF memakai poin -> dikali 2.8346.
 */
function pengukur(doc) {
  return (teks, o = {}) => {
    const { font = 'ui', gaya = 'normal', ukuran, lh = 1.2, maxBaris = 99, maxW } = o;
    const nama = font === 'display' ? FONT_DISPLAY : FONT_UI;
    doc.setFont(nama, gaya);
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
    if (baris.length > maxBaris) { terpotong = true; baris = baris.slice(0, maxBaris); }
    return { baris, tinggi: baris.length * ukuran * lh, terpotong };
  };
}

/* -------------------------------------------------------- gambar perintah */
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

/** Gambar satu kartu undangan pada posisi (x, y) berukuran w × h (mm). */
function drawCardPdf(doc, p, nomor, total, info, x, y, w, h, opts = {}) {
  const rencana = susunKartu(p, info, {
    x, y, w, h, nomor, total, qr: opts.qr || '', ukur: pengukur(doc)
  });

  /* --- klip ke bentuk kartu: isi tidak mungkin keluar bingkai ----------- */
  doc.saveGraphicsState();
  doc.roundedRect(rencana.kotak.x, rencana.kotak.y, rencana.kotak.w, rencana.kotak.h,
    rencana.kotak.r, rencana.kotak.r, null);
  doc.clip();
  doc.discardPath();

  rencana.ops.forEach((op) => {
    switch (op.tipe) {
      case 'gradasi': {
        const n = 56;
        const tinggi = op.h / n;
        for (let i = 0; i < n; i += 1) {
          const c = warnaPada(op.stop, (i + 0.5) / n);
          doc.setFillColor(c[0], c[1], c[2]);
          doc.rect(op.x, op.y + i * tinggi, op.w, tinggi + 0.25, 'F');
        }
        break;
      }
      case 'kotak': {
        const gaya = op.isi && op.garis ? 'FD' : (op.isi ? 'F' : 'D');
        if (op.isi) doc.setFillColor(...rgb(op.isi));
        if (op.garis) { doc.setDrawColor(...rgb(op.garis)); doc.setLineWidth(op.lebar || 0.3); }
        if (op.r > 0) doc.roundedRect(op.x, op.y, op.w, op.h, op.r, op.r, gaya);
        else doc.rect(op.x, op.y, op.w, op.h, gaya);
        break;
      }
      case 'garis': {
        doc.setDrawColor(...rgb(op.warna));
        doc.setLineWidth(op.lebar || 0.2);
        if (doc.setLineDashPattern) doc.setLineDashPattern(op.dash || [], 0);
        doc.line(op.x1, op.y1, op.x2, op.y2);
        if (doc.setLineDashPattern) doc.setLineDashPattern([], 0);
        break;
      }
      case 'teks': {
        doc.setFont(op.font === 'display' ? FONT_DISPLAY : FONT_UI, op.gaya || 'normal');
        doc.setFontSize(op.ukuran * 2.8346);
        doc.setTextColor(...rgb(op.warna));
        doc.text(op.teks, op.x, op.y, { align: op.align || 'left' });
        break;
      }
      case 'gambar': {
        try { doc.addImage(op.src, 'PNG', op.x, op.y, op.w, op.h); } catch { /* QR gagal: kartu tetap dibuat */ }
        break;
      }
      case 'bintang':
        bintang(doc, op.cx, op.cy, op.r, op.warna);
        break;
      default: break;
    }
  });

  // bingkai garis putus-putus di dalam tepi (CSS .card15::before)
  const b = rencana.bingkai;
  doc.setDrawColor(...rgb(b.warna));
  doc.setLineWidth(b.lebar);
  if (doc.setLineDashPattern) doc.setLineDashPattern(b.dash, 0);
  doc.roundedRect(b.x, b.y, b.w, b.h, b.r, b.r, 'D');
  if (doc.setLineDashPattern) doc.setLineDashPattern([], 0);

  doc.restoreGraphicsState();
}

/** Bagi teks menjadi maksimal `max` baris (dipertahankan untuk pengujian). */
function pdfLines(doc, text, maxW, max) {
  const garis = doc.splitTextToSize(String(text || ''), maxW) || [];
  if (garis.length <= max) return garis;
  return garis.slice(0, max - 1).concat([`${garis[max - 1].slice(0, -1)}…`]);
}

export { drawCardPdf, pdfLines, DESAIN };
