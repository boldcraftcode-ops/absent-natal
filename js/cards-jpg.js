/* ==========================================================================
   js/cards-jpg.js — kartu undangan sebagai JPG/PNG (canvas).
   Memakai tata letak yang sama dengan PDF (js/card-layout.js) sehingga
   pratinjau web, JPG, dan PDF identik. Tidak perlu pustaka tambahan.
   ========================================================================== */

import { susunKartu, LATAR } from './card-layout.js';

/** Gaya huruf canvas yang menyerupai pratinjau (serif untuk judul/nama). */
const FONT_DISPLAY = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif';
const FONT_UI = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

/** Ukuran kartu dalam piksel untuk DPI tertentu (10 × 15 cm = 100 × 150 mm). */
export function ukuranKartuJpg(dpi = 300) {
  const px = (mm) => Math.round((mm / 25.4) * dpi);
  return { w: px(100), h: px(150), dpi };
}

/** Pengukur teks memakai metrik canvas: pecah per kata seperti splitTextToSize. */
function pengukurCanvas(ctx, pxPerMm) {
  const fontCss = (op) => `${op.gaya === 'bold' ? '700 ' : '400 '}${op.ukuran * pxPerMm}px `
    + (op.font === 'display' ? FONT_DISPLAY : FONT_UI);
  return (teks, o = {}) => {
    const { font = 'ui', gaya = 'normal', ukuran, lh = 1.2, maxBaris = 99, maxW } = o;
    ctx.font = fontCss({ font, gaya, ukuran });
    const kata = String(teks ?? '').split('\n')
      .map((b) => b.replace(/\s+/g, ' ').trim())
      .filter((b, i, arr) => b || arr.length === 1);
    const baris = [];
    kata.forEach((kalimat) => {
      if (!kalimat) { baris.push(''); return; }
      let kini = '';
      kalimat.split(' ').forEach((k) => {
        const coba = kini ? `${kini} ${k}` : k;
        if (ctx.measureText(coba).width <= maxW * pxPerMm || !kini) kini = coba;
        else { baris.push(kini); kini = k; }
      });
      if (kini) baris.push(kini);
    });
    let terpotong = false;
    while (baris.length && baris.length > maxBaris) { baris.pop(); terpotong = true; }
    return { baris, tinggi: baris.length * ukuran * lh, terpotong };
  };
}

/** Bentuk kotak bersudut tumpul (roundRect belum ada di semua peramban). */
function kotakBulat(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') { ctx.roundRect(x, y, w, h, rr); return; }
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y); ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr); ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr); ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/**
 * Muat gambar QR. Tidak pernah menggantung: bila peramban tidak dapat
 * memuat gambar (mode uji tanpa mesin gambar), kartu tetap digambar tanpa QR
 * setelah 1,2 detik.
 */
function muatGambar(src, tungguMs = 1200) {
  return new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    let selesai = false;
    const akhiri = (v) => { if (!selesai) { selesai = true; resolve(v); } };
    const img = new Image();
    img.onload = () => akhiri(img);
    img.onerror = () => akhiri(null);
    img.src = src;
    setTimeout(() => akhiri(img.complete && img.naturalWidth ? img : null), tungguMs);
  });
}

/**
 * Gambar satu kartu ke canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {object} p        peserta { name, org, token }
 * @param {object} info     { name, org, when, place }
 * @param {object} opt      { dpi, nomor, total, qr }
 */
export async function gambarKartuCanvas(canvas, p, info, opt = {}) {
  const { dpi = 300, nomor = 1, total = 1, qr = '' } = opt;
  const ukuran = ukuranKartuJpg(dpi);
  canvas.width = ukuran.w;
  canvas.height = ukuran.h;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Peramban tidak mendukung kanvas.');
  const px = ukuran.w / 100;                    // piksel per mm
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const img = await muatGambar(qr);
  const rencana = susunKartu(p, info, {
    x: 0, y: 0, w: 100, h: 150, nomor, total,
    qr: img ? qr : '',
    ukur: pengukurCanvas(ctx, px)
  });

  // semua koordinat dalam mm -> dikali px, dan jarak garis ikut menyesuaikan
  ctx.save();
  kotakBulat(ctx, 0, 0, ukuran.w, ukuran.h, rencana.kotak.r * px);
  ctx.clip();

  const P = (v) => v * px;

  rencana.ops.forEach((op) => {
    switch (op.tipe) {
      case 'gradasi': {
        // CSS linear-gradient(160deg): dari kiri-atas menuju kanan-bawah
        const sudut = (160 * Math.PI) / 180;
        const dx = Math.sin(sudut);
        const dy = -Math.cos(sudut);
        const cx = P(op.x + op.w / 2);
        const cy = P(op.y + op.h / 2);
        const panjang = Math.abs(op.w * px * dx) + Math.abs(op.h * px * dy);
        const g = ctx.createLinearGradient(
          cx - (dx * panjang) / 2, cy - (dy * panjang) / 2,
          cx + (dx * panjang) / 2, cy + (dy * panjang) / 2
        );
        op.stop.forEach(([pos, warna]) => g.addColorStop(pos, warna));
        ctx.fillStyle = g;
        ctx.fillRect(P(op.x), P(op.y), P(op.w), P(op.h));
        break;
      }
      case 'kotak': {
        ctx.beginPath();
        if (op.r > 0) kotakBulat(ctx, P(op.x), P(op.y), P(op.w), P(op.h), P(op.r));
        else ctx.rect(P(op.x), P(op.y), P(op.w), P(op.h));
        if (op.isi) { ctx.fillStyle = op.isi; ctx.fill(); }
        if (op.garis) {
          ctx.strokeStyle = op.garis;
          ctx.lineWidth = Math.max(1, P(op.lebar || 0.3));
          ctx.stroke();
        }
        break;
      }
      case 'garis': {
        ctx.beginPath();
        ctx.setLineDash((op.dash || []).map(P));
        ctx.strokeStyle = op.warna;
        ctx.lineWidth = Math.max(1, P(op.lebar || 0.2));
        ctx.moveTo(P(op.x1), P(op.y1));
        ctx.lineTo(P(op.x2), P(op.y2));
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case 'teks': {
        ctx.font = `${op.gaya === 'bold' ? '700 ' : '400 '}${op.ukuran * px}px `
          + (op.font === 'display' ? FONT_DISPLAY : FONT_UI);
        ctx.fillStyle = op.warna;
        ctx.textAlign = op.align || 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(op.teks, P(op.x), P(op.y));
        break;
      }
      case 'gambar': {
        if (img) ctx.drawImage(img, P(op.x), P(op.y), P(op.w), P(op.h));
        break;
      }
      case 'bintang': {
        ctx.beginPath();
        for (let i = 0; i < 10; i += 1) {
          const sudut = -Math.PI / 2 + (i * Math.PI) / 5;
          const rr = i % 2 === 0 ? op.r : op.r * 0.42;
          const bx = P(op.cx + Math.cos(sudut) * rr);
          const by = P(op.cy + Math.sin(sudut) * rr);
          if (i === 0) ctx.moveTo(bx, by); else ctx.lineTo(bx, by);
        }
        ctx.closePath();
        ctx.fillStyle = op.warna;
        ctx.fill();
        break;
      }
      default: break;
    }
  });

  // bingkai garis putus-putus di dalam tepi
  const b = rencana.bingkai;
  kotakBulat(ctx, P(b.x), P(b.y), P(b.w), P(b.h), P(b.r));
  ctx.setLineDash(b.dash.map(P));
  ctx.strokeStyle = b.warna;
  ctx.lineWidth = Math.max(1, P(b.lebar));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.restore();
  return canvas;
}

/** Canvas -> Blob JPG (atau PNG bila diminta). */
export function canvasKeBlob(canvas, jenis = 'image/jpeg', mutu = 0.92) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') { reject(new Error('Peramban tidak mendukung ekspor gambar.')); return; }
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Gagal membuat berkas gambar.'))), jenis, mutu);
  });
}

/** Canvas -> data URL (untuk pratinjau di layar). */
export function canvasKeDataUrl(canvas, jenis = 'image/jpeg', mutu = 0.92) {
  return canvas.toDataURL(jenis, mutu);
}

/** Warna latar kartu (untuk mengisi bidang JPG yang tidak transparan). */
export const WARNA_LATAR_JPG = LATAR[0][1];
