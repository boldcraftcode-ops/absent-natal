#!/usr/bin/env node
/* ==========================================================================
   lokal-server.mjs — server statis TANPA dependensi untuk uji lokal.
   Dipanggil oleh start.bat (Windows) atau start.sh (Linux/macOS).

   Tujuan: meniru perilaku Netlify secukupnya supaya "jalan di localhost"
   sama dengan "jalan setelah di-upload":
     • header cache sama (sw.js & config.js TIDAK di-cache)
     • Permissions-Policy: camera=(self)  -> pemindai QR tetap boleh
     • /undangan  ->  /index.html  (sama seperti redirect di netlify.toml)
     • folder tanpa nama berkas -> index.html

   Pemakaian:
     node tools/lokal-server.mjs                # port 4173, buka browser
     node tools/lokal-server.mjs --port=8080
     node tools/lokal-server.mjs --no-open
   ========================================================================== */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AKAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ argumen */
const arg = process.argv.slice(2);
const ambil = (nama) => {
  const a = arg.find((x) => x === `--${nama}` || x.startsWith(`--${nama}=`));
  if (!a) return null;
  const i = a.indexOf('=');
  return i === -1 ? true : a.slice(i + 1);
};
const PORT_AWAL = Number(ambil('port')) || Number(process.env.PORT) || 4173;
const BUKA_BROWSER = !ambil('no-open') && !process.env.NO_OPEN;

/* --------------------------------------------------------------------- MIME */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.csv': 'text/csv; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg'
};

/* ---------------------------------------------------- header mirip netlify.toml */
function headerCache(urlPath) {
  if (urlPath === '/sw.js') return 'no-cache, no-store, must-revalidate';
  if (urlPath === '/config.js') return 'no-cache, must-revalidate';
  if (urlPath.startsWith('/vendor/')) return 'public, max-age=31536000, immutable';
  if (urlPath.startsWith('/icons/')) return 'public, max-age=604800';
  if (/\.[cm]?js$/.test(urlPath) || /\.css$/.test(urlPath) || /\.html?$/.test(urlPath)) {
    return 'public, max-age=0, must-revalidate';
  }
  return 'public, max-age=3600';
}

const bolehDisajikan = (p) => {
  const rel = path.relative(AKAR, p);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  // jangan pernah menyajikan isi repo/tooling dari jaringan
  const bagian = rel.split(path.sep);
  return !bagian.includes('.git') && !bagian.includes('node_modules') && bagian[0] !== 'tests';
};

/* ------------------------------------------------------------------ server */
const server = http.createServer(async (req, res) => {
  const mulai = Date.now();
  let urlPath = '/';
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Permintaan tidak valid');
  }

  // redirect seperti netlify.toml
  if (urlPath === '/undangan' || urlPath === '/undangan/') {
    res.writeHead(302, { Location: '/index.html' });
    return res.end();
  }

  let berkas = path.join(AKAR, urlPath);
  if (!bolehDisajikan(berkas)) {
    return kirim(res, 403, 'text/plain; charset=utf-8', 'Akses ditolak', urlPath, mulai);
  }

  try {
    let st = await fsp.stat(berkas);
    if (st.isDirectory()) {
      berkas = path.join(berkas, 'index.html');
      st = await fsp.stat(berkas);
    }
    if (!st.isFile()) throw new Error('bukan berkas');

    const ext = path.extname(berkas).toLowerCase();
    const tipe = MIME[ext] || 'application/octet-stream';
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;

    // 304 hemat waktu saat reload berulang
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag });
      return res.end();
    }

    res.writeHead(200, {
      'Content-Type': tipe,
      'Content-Length': st.size,
      ETag: etag,
      'Cache-Control': headerCache(urlPath),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      ...(urlPath === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {})
    });

    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(berkas)
      .on('error', () => res.destroy())
      .pipe(res);

    res.on('finish', () => catat(res.statusCode, urlPath, mulai));
  } catch {
    const adaIndex = await fsp
      .stat(path.join(AKAR, 'index.html'))
      .then(() => true)
      .catch(() => false);

    // alamat token seperti /?t=xxx sudah ditangani index.html; URL asing -> 404
    const halaman404 = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>404 — Berkas tidak ditemukan</title>
<style>body{font-family:system-ui,sans-serif;background:#241610;color:#f7ece4;display:grid;
place-items:center;height:100vh;margin:0;text-align:center;padding:24px}
code{background:#00000040;padding:2px 6px;border-radius:6px}
a{color:#f3c98b}</style></head><body><div>
<h1>404</h1><p>Berkas <code>${escapeHtml(urlPath)}</code> tidak ada di folder
<code>natal/</code>.</p>
<p><a href="/index.html">Buka halaman tamu</a> &middot;
<a href="/admin.html">Panel admin</a> &middot;
<a href="/undian.html">Layar undian</a></p>
${adaIndex ? '' : '<p>Catatan: <code>index.html</code> juga tidak ditemukan — pastikan server dijalankan dari folder <code>natal/</code>.</p>'}
</div></body></html>`;
    return kirim(
      res,
      404,
      'text/html; charset=utf-8',
      halaman404,
      urlPath,
      mulai
    );
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function kirim(res, kode, tipe, isi, urlPath, mulai) {
  const buf = Buffer.from(isi, 'utf8');
  res.writeHead(kode, {
    'Content-Type': tipe,
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(buf);
  catat(kode, urlPath, mulai);
}

/* -------------------------------------------------------- log ringkas & rapi */
const WARNA = process.stdout.isTTY && process.platform !== 'win32';
const w = (kode) => (s) => (WARNA ? `\u001b[${kode}m${s}\u001b[0m` : s);
const hijau = w('32');
const kuning = w('33');
const merah = w('31');
const redup = w('2');

function catat(kode, urlPath, mulai) {
  const ms = Date.now() - mulai;
  const warnai = kode >= 500 ? merah : kode >= 400 ? kuning : hijau;
  console.log(`  ${warnai(String(kode))} ${urlPath} ${redup(`${ms} ms`)}`);
}

/* ------------------------------------------------------------- cari port bebas */
function dengar(port) {
  return new Promise((selesai, gagal) => {
    const onError = (e) => {
      server.removeListener('listening', onOk);
      gagal(e);
    };
    const onOk = () => {
      server.removeListener('error', onError);
      selesai(port);
    };
    server.once('error', onError);
    server.once('listening', onOk);
    server.listen(port, '0.0.0.0');
  });
}

/* ------------------------------------------------------------------ alamat LAN */
function alamatLAN(port) {
  const hasil = [];
  for (const daftar of Object.values(os.networkInterfaces())) {
    for (const n of daftar || []) {
      if (n.family === 'IPv4' && !n.internal) hasil.push(`http://${n.address}:${port}`);
    }
  }
  return hasil;
}

function bukaBrowser(url) {
  const opsi = { detached: true, stdio: 'ignore' };
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], opsi).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], opsi).unref();
    } else {
      spawn('xdg-open', [url], opsi).unref();
    }
  } catch {
    /* tidak penting: URL tetap dicetak */
  }
}

/* ---------------------------------------------------------------------- main */
let port = PORT_AWAL;
for (let coba = 0; coba < 25; coba++) {
  try {
    await dengar(port);
    break;
  } catch (e) {
    if (e && e.code === 'EADDRINUSE') {
      console.log(kuning(`Port ${port} sedang dipakai, mencoba ${port + 1}…`));
      port += 1;
      continue;
    }
    console.error(merah(`Gagal menjalankan server: ${e && e.message}`));
    process.exit(1);
  }
}
if (!server.listening) {
  console.error(merah('Tidak ada port yang tersedia (4173–4197).'));
  process.exit(1);
}

const alamat = `http://localhost:${port}`;
const lan = alamatLAN(port);

const garis = '─'.repeat(62);
console.log('');
console.log(hijau(garis));
console.log(`  ${hijau('Absensi Natal')} — server lokal siap`);
console.log(hijau(garis));
console.log(`  Folder     : ${redup(AKAR)}`);
console.log(`  Halaman tamu: ${alamat}/index.html`);
console.log(`  Panel admin : ${alamat}/admin.html`);
console.log(`  Absensi tamu: ${alamat}/absen.html   ${redup('(pilih nama / tanpa undangan)')}`);
console.log(`  Layar undian: ${alamat}/undian.html`);
console.log(`  Demo offline: ${alamat}/demo.html    ${redup('(tanpa Supabase)')}`);
if (lan.length) {
  console.log('');
  console.log('  Dari HP di Wi-Fi yang sama:');
  for (const a of lan) console.log(`    ${kuning(a)}/absen.html`);
  console.log(
    redup('  Catatan: pemindai QR kamera butuh HTTPS, jadi di alamat LAN http\n' +
         '  gunakan kamera bawaan HP lewat absen.html (memang alur yang dipakai).')
  );
}
console.log('');
console.log(redup('  Tekan Ctrl+C untuk menghentikan server.'));
console.log(hijau(garis));
console.log('');

if (BUKA_BROWSER) bukaBrowser(`${alamat}/index.html`);

const tutup = () => {
  console.log('\n  Server dihentikan. Sampai jumpa 👋\n');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1200).unref();
};
process.on('SIGINT', tutup);
process.on('SIGTERM', tutup);
