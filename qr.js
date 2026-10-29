/* ==========================================================================
   qr.js — pembungkus library QR yang di-vendor (vendor/qrcode.js).
   Tidak memakai CDN supaya tetap jalan saat sinyal buruk / offline.
   ========================================================================== */

function lib() {
  const q = window.qrcode || globalThis.qrcode;
  if (typeof q !== 'function') {
    throw new Error('Library QR belum dimuat. Pastikan vendor/qrcode.js ada di halaman.');
  }
  return q;
}

/**
 * Buat objek QR siap pakai.
 * @param {string} text isi QR (mis. https://domain/?t=abcd...)
 * @param {'L'|'M'|'Q'|'H'} ecLevel tingkat koreksi error
 */
export function makeQr(text, ecLevel = 'M') {
  const q = lib();
  const data = String(text ?? '');
  // pilih versi otomatis: mulai dari 2 lalu naik sampai muat
  for (let type = 2; type <= 40; type++) {
    try {
      const qr = q(type, ecLevel);
      qr.addData(data);
      qr.make();
      return qr;
    } catch (err) {
      if (type === 40) throw new Error('Teks terlalu panjang untuk QR.');
    }
  }
  throw new Error('Gagal membuat QR.');
}

/** SVG string (tajam saat dicetak). */
export function qrSvg(text, { size = 256, margin = 2, ecLevel = 'M' } = {}) {
  const qr = makeQr(text, ecLevel);
  // createSvgTag(cellSize, margin) -> string SVG
  return qr.createSvgTag({ cellSize: 4, margin, scalable: true })
    .replace('<svg', `<svg width="${size}" height="${size}"`)
    .replace(/<svg([^>]*)>/, (m) => (m.includes('viewBox') ? m : m.replace('<svg', '<svg viewBox="0 0 100 100"')));
}

/** Data URL PNG (untuk <img>, ZIP kartu, dsb). */
export function qrPngDataUrl(text, { size = 512, margin = 2, ecLevel = 'M' } = {}) {
  const qr = makeQr(text, ecLevel);
  const count = qr.getModuleCount();
  const cell = Math.max(2, Math.floor(size / (count + margin * 2)));
  const dim = cell * (count + margin * 2);

  const canvas = document.createElement('canvas');
  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, dim, dim);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
      }
    }
  }
  return canvas.toDataURL('image/png');
}

/** <img> siap tempel. */
export function qrImg(text, opts = {}) {
  const img = document.createElement('img');
  img.src = qrPngDataUrl(text, opts);
  img.alt = opts.alt || 'Kode QR';
  img.width = opts.size || 256;
  img.height = opts.size || 256;
  img.style.imageRendering = 'pixelated';
  return img;
}

/** PNG sebagai base64 tanpa prefix (untuk JSZip). */
export function qrPngBase64(text, opts = {}) {
  return qrPngDataUrl(text, opts).split(',')[1];
}
