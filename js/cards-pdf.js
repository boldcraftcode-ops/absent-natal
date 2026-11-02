/* ==========================================================================
   js/cards-pdf.js — gambar kartu undangan 10 × 15 cm ke PDF dengan jsPDF.
   Dipisah dari admin.js agar bisa diuji & dipakai ulang tanpa DOM/login.
   ========================================================================== */

export const PDF_WARNA = {
  cocoa: '#352016', cocoaSoft: '#553D29', cran: '#6E2622', olive: '#3F4D2A',
  honey: '#9C6B34', kraft: '#C2AE93', kraftSoft: '#B9A68C', ink: '#6B4E36', abu: '#8A7A63'
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

/** Bagi teks menjadi maksimal `max` baris. */
function pdfLines(doc, text, maxW, max) {
  const garis = doc.splitTextToSize(String(text || ''), maxW) || [];
  if (garis.length <= max) return garis;
  return garis.slice(0, max - 1).concat([`${garis[max - 1].slice(0, -1)}…`]);
}

/** Gambar satu kartu undangan pada posisi (x, y) berukuran w × h (mm). */
function drawCardPdf(doc, p, nomor, total, info, x, y, w, h, opts = {}) {
  const S_ = Math.min(w / 100, h / 150);          // skala dari desain 100 × 150 mm
  const mm = (v) => v * S_;                        // ukuran desain (mm) -> mm sebenarnya
  const fs = (v) => v * S_ * 2.8346;               // ukuran huruf desain (mm) -> poin
  const pad = mm(6);

  // dasar kartu
  doc.setFillColor(...WARNA_KARTU);
  doc.setDrawColor(PDF_WARNA.kraftSoft);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, w, h, mm(3), mm(3), 'FD');

  // garis potong tipis di dalam tepi
  doc.setDrawColor(PDF_WARNA.kraft);
  doc.setLineWidth(0.15);
  if (doc.setLineDashPattern) doc.setLineDashPattern([mm(1.6), mm(1.4)], 0);
  doc.roundedRect(x + mm(1.5), y + mm(1.5), w - mm(3), h - mm(3), mm(2.4), mm(2.4), 'D');
  if (doc.setLineDashPattern) doc.setLineDashPattern([], 0);

  // pita warna di atas
  const rx = x + pad;
  const rw = w - pad * 2;
  const pitaY = y + pad;
  const potong = rw / 3;
  doc.setFillColor(0x6E, 0x26, 0x22); doc.rect(rx, pitaY, potong, mm(1.2), 'F');
  doc.setFillColor(0xC0, 0x8A, 0x4E); doc.rect(rx + potong, pitaY, potong, mm(1.2), 'F');
  doc.setFillColor(0x45, 0x50, 0x26); doc.rect(rx + potong * 2, pitaY, potong, mm(1.2), 'F');

  // kepala: bintang + nama acara + organisasi
  let cy = pitaY + mm(1.2) + mm(5.2);
  doc.setTextColor(PDF_WARNA.honey);
  doc.setFont(FONT_DISPLAY, 'normal');
  doc.setFontSize(fs(5.6));
  doc.text('*', x + w / 2, cy, { align: 'center' });

  cy += mm(6.4);
  doc.setTextColor(PDF_WARNA.cocoa);
  doc.setFont(FONT_DISPLAY, 'bold');
  doc.setFontSize(fs(7.2));
  const judul = pdfLines(doc, info.name, rw, 2);
  judul.forEach((baris, i) => doc.text(baris, x + w / 2, cy + i * mm(6.8), { align: 'center' }));
  cy += (judul.length - 1) * mm(6.8);

  if (info.org) {
    cy += mm(4.4);
    doc.setFont(FONT_UI, 'bold');
    doc.setFontSize(fs(2.9));
    doc.setTextColor(PDF_WARNA.cran);
    doc.text(String(info.org).toUpperCase().slice(0, 42), x + w / 2, cy, { align: 'center' });
  }

  // badan: QR (kiri) + nama tamu (kanan)
  const qrSize = mm(44);
  const bodyY = cy + mm(5);
  const qrX = rx;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(PDF_WARNA.cocoa);
  doc.setLineWidth(0.4);
  doc.roundedRect(qrX, bodyY, qrSize, qrSize, mm(2), mm(2), 'FD');
  try {
    const png = opts.qr || '';
    if (png) doc.addImage(png, 'PNG', qrX + mm(1.6), bodyY + mm(1.6), qrSize - mm(3.2), qrSize - mm(3.2));
  } catch { /* QR gagal: kartu tetap dibuat */ }

  const infoX = qrX + qrSize + mm(5);
  const infoW = rx + rw - infoX;
  let ny = bodyY + mm(4.2);
  doc.setFont(FONT_UI, 'bold');
  doc.setFontSize(fs(2.6));
  doc.setTextColor(PDF_WARNA.ink);
  doc.text('KEPADA', infoX, ny);
  ny += mm(5.6);
  doc.setFont(FONT_DISPLAY, 'bold');
  doc.setFontSize(fs(6));
  doc.setTextColor(PDF_WARNA.cocoa);
  pdfLines(doc, p.name, infoW, 2).forEach((baris, i) => doc.text(baris, infoX, ny + i * mm(6)));
  ny += (pdfLines(doc, p.name, infoW, 2).length - 1) * mm(6) + mm(4.6);
  if (p.org) {
    doc.setFont(FONT_UI, 'normal');
    doc.setFontSize(fs(3));
    doc.setTextColor(PDF_WARNA.olive);
    pdfLines(doc, p.org, infoW, 2).forEach((baris, i) => doc.text(baris, infoX, ny + i * mm(3.6)));
  }

  // waktu & tempat (dipatok di 56% tinggi kartu agar tata letak seimbang)
  let my = Math.max(bodyY + qrSize + mm(7), y + h * 0.56);
  if (info.when || info.place) {
    doc.setDrawColor(PDF_WARNA.kraft);
    doc.setLineWidth(0.2);
    doc.line(rx, my - mm(3), rx + rw, my - mm(3));
    doc.setFontSize(fs(3));
    [['WAKTU', info.when], ['TEMPAT', info.place]].forEach(([label, nilai]) => {
      if (!nilai) return;
      doc.setFont(FONT_UI, 'bold');
      doc.setTextColor(PDF_WARNA.cran);
      doc.text(label, rx, my);
      doc.setFont(FONT_UI, 'normal');
      doc.setTextColor(PDF_WARNA.cocoaSoft);
      const baris = pdfLines(doc, nilai, rw - mm(18), 2);
      baris.forEach((b, i) => doc.text(b, rx + mm(17), my + i * mm(3.4)));
      my += baris.length * mm(3.4) + mm(1.6);
    });
  }

  // ornamen pengisi bidang tengah (garis + bintang kecil)
  const ornY = y + h * 0.79;
  doc.setDrawColor(PDF_WARNA.kraft);
  doc.setLineWidth(0.2);
  doc.line(rx + rw * 0.12, ornY, rx + rw * 0.42, ornY);
  doc.line(rx + rw * 0.58, ornY, rx + rw * 0.88, ornY);
  doc.setTextColor(PDF_WARNA.honey);
  doc.setFont(FONT_DISPLAY, 'normal');
  doc.setFontSize(fs(3.6));
  doc.text('*', x + w / 2, ornY + mm(1.2), { align: 'center' });

  // kaki: gunting + petunjuk + nomor urut kartu
  const footY = y + h - pad;
  doc.setDrawColor(PDF_WARNA.kraft);
  doc.setLineWidth(0.2);
  if (doc.setLineDashPattern) doc.setLineDashPattern([mm(1.4), mm(1.2)], 0);
  doc.line(rx, footY - mm(6.4), rx + rw, footY - mm(6.4));
  if (doc.setLineDashPattern) doc.setLineDashPattern([], 0);

  doc.setFont(FONT_UI, 'normal');
  doc.setFontSize(fs(2.7));
  doc.setTextColor(PDF_WARNA.ink);
  doc.text('Pindai QR untuk konfirmasi kehadiran.', rx, footY - mm(2.6));
  doc.text('Nomor undian muncul setelah pindai.', rx, footY - mm(0.2));

  doc.setFontSize(fs(2.6));
  doc.setTextColor(PDF_WARNA.abu);
  doc.text(`${String(nomor).padStart(2, '0')}/${total}`, rx + rw, footY - mm(0.2), { align: 'right' });
}


export { drawCardPdf, pdfLines };
