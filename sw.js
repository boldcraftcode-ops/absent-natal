/* ==========================================================================
   sw.js — Service Worker (offline-first untuk aplikasi petugas)
   Strategi:
     * Navigasi  : jaringan dulu -> cadangan cache (network-first)
     * Aset      : stale-while-revalidate
     * Supabase  : TIDAK pernah di-cache (selalu jaringan)
   ========================================================================== */

const VERSION = 'natal-v1';
const CACHE = `absensi-${VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './petugas.html',
  './admin.html',
  './undian.html',
  './styles.css',
  './config.js',
  './api.js',
  './util.js',
  './qr.js',
  './js/index.js',
  './js/petugas.js',
  './js/admin.js',
  './js/undian.js',
  './vendor/qrcode.js',
  './vendor/html5-qrcode.min.js',
  './vendor/xlsx.full.min.js',
  './vendor/jszip.min.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

const isSupabase = (url) =>
  /supabase\.(co|in)$/.test(url.hostname) ||
  url.pathname.includes('/rest/v1/') ||
  url.pathname.includes('/auth/v1/') ||
  url.pathname.includes('/storage/v1/') ||
  url.hostname.endsWith('.supabase.co');

/* -------------------------------------------------------------- install */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll gagal total bila satu berkas hilang -> tambahkan satu per satu
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res.ok) await cache.put(url, res);
      } catch { /* berkas opsional: lanjutkan */ }
    }));
    self.skipWaiting();
  })());
});

/* ------------------------------------------------------------- activate */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('absensi-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* ---------------------------------------------------------------- fetch */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // Jangan pernah cache / ganggu permintaan ke Supabase
  if (isSupabase(url)) return;

  // Hanya tangani origin sendiri
  if (url.origin !== self.location.origin) return;

  // Navigasi: jaringan dulu, cadangan cache
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
        return res;
      } catch {
        const cache = await caches.open(CACHE);
        const exact = await cache.match(req);
        if (exact) return exact;
        const path = url.pathname;
        // petakan ke halaman yang di-pre-cache
        const page = PRECACHE.find((p) => path.endsWith(p.replace('./', '')) && p.endsWith('.html'));
        if (page) {
          const hit = await cache.match(page);
          if (hit) return hit;
        }
        const fallback = await cache.match('./petugas.html');
        return fallback || new Response(
          `<!doctype html><meta charset="utf-8"><title>Offline</title>
           <body style="font-family:system-ui;background:#0a2f22;color:#f4faf6;padding:24px">
           <h1>Sedang offline</h1>
           <p>Halaman ini belum tersimpan di perangkat. Buka aplikasi petugas sekali saat ada internet.</p>
           </body>`,
          { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 200 }
        );
      }
    })());
    return;
  }

  // Aset: stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);

    if (cached) {
      event.waitUntil(network.then(() => undefined).catch(() => undefined));
      return cached;
    }
    const res = await network;
    if (res) return res;
    return new Response('', { status: 504, statusText: 'Offline' });
  })());
});

/* ------------------------------------------------------- pesan dari klien */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('absensi-')).map((k) => caches.delete(k)))));
  }
});
