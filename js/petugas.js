/* ==========================================================================
   js/petugas.js — Aplikasi PETUGAS (offline-first)
   * Data peserta diunduh & disimpan lokal.
   * Aksi disimpan di antrean lokal, langsung tampil, lalu disinkronkan.
   * Setiap HP mengambil BLOK nomor (default 40) agar nomor tidak kembar.
   ========================================================================== */
import { api } from '../api.js';
import {
  pad3, fmtTime, esc, toast, vibrate, beep, debounce, store, uuid,
  extractToken, normPhone, normName, sourceLabel, online, $, $$
} from '../util.js';

const K = {
  pin: 'staff_pin',
  data: 'staff_data',
  queue: 'staff_queue',
  block: 'staff_block',
  meta: 'staff_meta',
  log: 'staff_log',
  tab: 'staff_tab'
};

const cfg = () => window.APP_CONFIG || {};
const S = {
  installEvent: null,
  pin: '',
  people: [],        // daftar peserta lokal
  queue: [],         // antrean aksi belum tersinkron
  block: { from: 0, to: 0, used: [] },
  meta: { event_name: '', last_sync: null, attendance_open: true },
  log: [],
  scanning: false,
  scanner: null,
  lastScan: '',
  lastScanAt: 0,
  syncing: false,
  tab: 'scan',
  countdown: null,
  pendingPerson: null   // peserta yang menunggu isian keluarga/konsumsi
};

/* =========================================================== penyimpanan */
function loadLocal() {
  S.pin = store.get(K.pin, '') || '';
  S.people = store.get(K.data, []) || [];
  S.queue = store.get(K.queue, []) || [];
  S.block = store.get(K.block, { from: 0, to: 0, used: [] }) || { from: 0, to: 0, used: [] };
  S.meta = store.get(K.meta, S.meta) || S.meta;
  S.log = store.get(K.log, []) || [];
}

const save = {
  people: () => store.set(K.data, S.people),
  queue: () => store.set(K.queue, S.queue),
  block: () => store.set(K.block, S.block),
  meta: () => store.set(K.meta, S.meta),
  log: () => store.set(K.log, S.log.slice(0, 60))
};
save.all = () => {
  save.people(); save.queue(); save.block(); save.meta(); save.log();
};

const attendedCount = () => S.people.filter((p) => p.attended).length;
const blockLeft = () => (S.block.to >= S.block.from ? S.block.to - S.block.from + 1 - S.block.used.length : 0);

/**
 * Cari peserta dari daftar lokal.
 * `id` dipakai saat petugas memilih nama undangan lewat dropdown (tamu lupa bawa QR).
 */
function findPerson({ id, token, phone, name } = {}) {
  if (id) {
    const hit = S.people.find((x) => String(x.id) === String(id));
    if (hit) return hit;
  }
  if (token) {
    const t = S.people.find((p) => p.token === token);
    if (t) return t;
  }
  if (phone) {
    const p = normPhone(phone);
    const hit = S.people.find((x) => x.phone && x.phone === p);
    if (hit) return hit;
  }
  if (name) {
    const n = normName(name);
    const hit = S.people.find((x) => normName(x.name) === n);
    if (hit) return hit;
  }
  return null;
}

/* ============================================================== antrean */
function enqueue(item) {
  const entry = {
    id: uuid(),
    kind: item.kind,                 // 'attend' | 'new'
    at: new Date().toISOString(),
    ok: false,
    ...item
  };
  S.queue.push(entry);
  save.queue();
  updateChrome();
  return entry;
}

function queueCount() { return S.queue.length; }

/* ============================================================== indikator */
function setNet(ok) {
  const b = document.getElementById('net-badge');
  if (!b) return;
  b.textContent = ok ? 'Online' : 'Offline';
  b.className = `badge ${ok ? 'badge--online' : 'badge--offline'}`;
}

function updateChrome() {
  const q = queueCount();
  const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  set('stat-attended', attendedCount());
  set('stat-total', S.people.length);
  set('stat-queue', q);
  const qb = document.getElementById('queue-badge');
  if (qb) {
    qb.textContent = `Antrean ${q}`;
    qb.className = `badge ${q ? 'badge--queue' : 'badge--plain'}`;
  }
  const bb = document.getElementById('block-badge');
  if (bb) {
    const left = blockLeft();
    bb.textContent = left > 0 ? `Jatah nomor ${left}` : 'Jatah nomor habis';
    bb.className = `badge ${left > 0 ? 'badge--plain' : 'badge--queue'}`;
  }
  const warn = document.getElementById('tambah-warning');
  if (warn) {
    const empty = blockLeft() <= 0;
    warn.classList.toggle('hidden', !empty);
  }
  setNet(online());
}

function note(text, kind = 'dark') {
  const box = document.getElementById('sync-note');
  const txt = document.getElementById('sync-note-text');
  if (!box || !txt) return;
  if (!text) { box.classList.add('hidden'); return; }
  box.className = `notice notice--${kind} small`;
  txt.textContent = text;
  box.classList.remove('hidden');
}

/* ============================================================== login */
async function doLogin(pin) {
  const err = document.getElementById('login-error');
  const errText = document.getElementById('login-error-text');
  err.classList.add('hidden');
  const btn = document.getElementById('btn-login');
  btn.disabled = true;
  btn.textContent = 'Memeriksa…';

  try {
    const res = await api.staffData(pin);
    if (!res?.ok) throw new Error(res?.message || 'PIN salah.');
    store.set(K.pin, pin);
    S.pin = pin;
    applyServerData(res);
    save.all();
    await ensureBlock(true);
    enterApp();
    toast('Selamat bertugas!', 'ok');
  } catch (e) {
    // Sudah login sebelumnya & sedang offline -> boleh masuk dengan data lokal
    if (e?.code === 'offline' && S.pin === pin && S.people.length) {
      store.set(K.pin, pin);
      enterApp();
      note('Offline. Memakai data peserta yang tersimpan di HP ini.', 'dark');
      toast('Masuk mode offline', 'warn');
      return;
    }
    errText.textContent = e?.code === 'offline'
      ? 'Tidak ada koneksi. Login pertama kali membutuhkan internet agar daftar peserta bisa diunduh.'
      : (e?.message || 'Gagal masuk. Periksa PIN Anda.');
    err.classList.remove('hidden');

    // Kesalahan server/skema/kunci API: buka panel diagnosa supaya penyebabnya langsung terlihat.
    if (e?.code !== 'offline' && e?.code !== 'pin_invalid') {
      const pan = document.getElementById('db-diagnose');
      if (pan) { pan.open = true; runDbChecks().catch(() => {}); }
    }
    vibrate([40, 60, 40]);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Masuk';
  }
}

function applyServerData(res) {
  const incoming = (res.participants || []).map((p) => ({
    id: p.id, token: p.token, name: p.name, org: p.org || '', phone: p.phone || '',
    family_count: p.family_count || 0, invited: Boolean(p.invited),
    lottery_no: p.lottery_no, attended: Boolean(p.attended),
    attended_at: p.attended_at || null, source: p.source || 'manual',
    wants_meal: Boolean(p.wants_meal), wants_souvenir: Boolean(p.wants_souvenir),

  }));

  // Pertahankan aksi lokal yang belum tersinkron
  for (const item of S.queue) {
    if (item.kind === 'attend') {
      const p = incoming.find((x) => (item.token && x.token === item.token) || x.id === item.participant_id);
      if (p) {
        p.attended = true;
        p.attended_at = p.attended_at || item.attended_at;
        // isian keluarga/kupon dari HP ini belum terkirim: jangan ditimpa data server
        if (item.family_count !== undefined) p.family_count = item.family_count;
        if (item.wants_meal !== undefined) p.wants_meal = Boolean(item.wants_meal);
        if (item.wants_souvenir !== undefined) p.wants_souvenir = Boolean(item.wants_souvenir);
      }
    } else if (item.kind === 'new') {
      if (!incoming.some((x) => x.lottery_no === item.lottery_no)) {
        incoming.push({
          id: item.local_id, token: item.token, name: item.name, org: item.org || '',
          phone: item.phone || '', family_count: item.family_count || 0, invited: false,
          lottery_no: item.lottery_no, attended: true, attended_at: item.attended_at,
          source: 'petugas', wants_meal: Boolean(item.wants_meal),
          wants_souvenir: Boolean(item.wants_souvenir)
        });
      }
    }
  }

  S.people = incoming.sort((a, b) => a.lottery_no - b.lottery_no);
  renderInvitedOptions();
  S.meta.event_name = res.event_name || S.meta.event_name;
  S.meta.attendance_open = Boolean(res.attendance_open);
  S.meta.last_sync = new Date().toISOString();
  document.getElementById('event-name').textContent = res.event_name || 'Petugas Registrasi';
}

function enterApp() {
  document.getElementById('view-login').classList.add('hidden');
  document.getElementById('view-app').classList.remove('hidden');
  updateChrome();
  renderSearch();
  renderInvitedOptions();
  switchTab(store.get(K.tab, 'scan'), false);
  startCountdown();
}

/* ========================================================= blok nomor */
function blockFromServer(block) {
  if (!block || !block.from) return;
  S.block = { from: block.from, to: block.to, used: S.block.used || [] };
  // buang catatan "used" di luar rentang blok aktif
  S.block.used = S.block.used.filter((n) => n >= S.block.from && n <= S.block.to);
  save.block();
  updateChrome();
}

async function ensureBlock(force = false) {
  const need = blockLeft() < (cfg().STAFF_BLOCK_REFILL_AT ?? 15);
  if (!force && !need) return;
  if (!online()) { updateChrome(); return; }
  try {
    const res = await api.staffClaimNumbers(S.pin, cfg().STAFF_BLOCK_SIZE ?? 40);
    if (res?.ok) {
      blockFromServer(res);
      note(``, 'dark');
    }
  } catch (e) {
    if (e?.code !== 'offline') console.warn('Gagal mengambil jatah nomor', e.message);
  }
}

function takeBlockNumber() {
  if (blockLeft() <= 0) return null;
  const usedSet = new Set(S.block.used);
  for (let n = S.block.from; n <= S.block.to; n++) {
    if (!usedSet.has(n)) {
      S.block.used.push(n);
      save.block();
      updateChrome();
      return n;
    }
  }
  return null;
}

/* ================================================ pemasangan (PWA) */
const INSTALL_DISMISS = 'staff_install_dismiss';

/** Aplikasi berjalan sebagai PWA terpasang? */
function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true;
}

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Tampilkan banner pasang aplikasi bila relevan. */
function setupInstallBanner() {
  const banner = document.getElementById('install-banner');
  const text = document.getElementById('install-banner-text');
  if (!banner) return;

  // ambil ajakan pemasangan yang mungkin sudah terpicu sebelum skrip ini jalan
  if (!S.installEvent && window.__installPrompt) S.installEvent = window.__installPrompt;

  if (isStandalone()) { banner.classList.add('hidden'); return; }
  if (store.get(INSTALL_DISMISS, false)) return;

  // iOS tidak punya event beforeinstallprompt: beri instruksi manual
  if (isIos() && !S.installEvent) {
    text.textContent = 'iPhone: ketuk Bagikan (⬆️) → “Tambah ke Layar Utama”.';
    banner.classList.remove('hidden');
    return;
  }

  // Android/desktop: tunggu event (sudah ditangkap di awal skrip)
  if (S.installEvent) { banner.classList.remove('hidden'); }
}

function bindInstall() {
  document.getElementById('btn-install-close')?.addEventListener('click', () => {
    store.set(INSTALL_DISMISS, true);
    document.getElementById('install-banner')?.classList.add('hidden');
  });

  document.getElementById('btn-install-app')?.addEventListener('click', async () => {
    if (S.installEvent) {
      // dialog pemasangan bawaan browser
      S.installEvent.prompt();
      try { await S.installEvent.userChoice; } catch { /* diabaikan */ }
      S.installEvent = null;
      document.getElementById('install-banner')?.classList.add('hidden');
      return;
    }
    // tanpa event: tampilkan petunjuk manual
    if (isIos()) {
      toast('iPhone: ketuk Bagikan (⬆️) lalu “Tambah ke Layar Utama”.', 'warn', 7000);
    } else {
      toast('Buka menu browser (⋮) → “Pasang aplikasi” / “Tambahkan ke Layar utama”.', 'warn', 7000);
    }
  });
}

/* ====================================== diagnosa izin & uji kamera */
async function refreshCameraChecks() {
  const list = document.getElementById('cam-check-list');
  if (!list) return;

  const rows = [];
  const tambah = (ok, teks, saran) => rows.push({ ok, teks, saran });

  tambah(window.isSecureContext, 'Alamat HTTPS (wajib untuk kamera)',
    'Buka lewat https:// — kamera tidak bisa dipakai pada http://.');

  const standalone = isStandalone();
  tambah(standalone, standalone ? 'Berjalan sebagai aplikasi terpasang' : 'Berjalan di tab browser',
    standalone ? '' : 'Pasang aplikasi lewat banner di atas agar izin kamera tersimpan permanen.');

  tambah(Boolean(navigator.mediaDevices?.getUserMedia), 'API kamera tersedia di perangkat',
    'Peramban ini tidak mendukung kamera. Gunakan Chrome atau Safari terbaru.');

  // status izin (bila peramban mendukung Permissions API)
  let status = 'tidak diketahui';
  try {
    if (navigator.permissions?.query) {
      const p = await navigator.permissions.query({ name: 'camera' });
      status = p.state; // 'granted' | 'denied' | 'prompt'
    }
  } catch { /* Firefox/Safari lama: diabaikan */ }
  const map = { granted: 'DIIZINKAN', denied: 'DITOLAK', prompt: 'BELUM DIMINTA' };
  tambah(status !== 'denied',
    `Izin kamera: ${map[status] || status}`,
    status === 'denied'
      ? 'Buka pengaturan situs di browser → Kamera → Izinkan, lalu muat ulang.'
      : status === 'prompt'
        ? 'Tekan “Uji kamera” untuk memunculkan dialog izin.'
        : '');

  // info peramban untuk laporan
  const ua = navigator.userAgent;
  const browser = /EdgA?\//.test(ua) ? 'Edge'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox/.test(ua) ? 'Firefox'
    : /CriOS|Chrome/.test(ua) ? 'Chrome'
    : /Safari/.test(ua) ? 'Safari' : 'Peramban lain';
  tambah(true, `Peramban: ${browser} · ${isIos() ? 'iOS' : /Android/.test(ua) ? 'Android' : 'desktop'}`, '');

  list.innerHTML = rows.map((r) => `
    <li style="color:${r.ok ? 'var(--olive-700)' : 'var(--cran-800)'}">
      ${r.ok ? '✅' : '⚠️'} ${esc(r.teks)}
      ${r.saran ? `<div class="small" style="color:var(--ink-soft)">${esc(r.saran)}</div>` : ''}
    </li>`).join('');
}

/** Minta izin kamera langsung (dipicu sentuhan pengguna). */
async function testCamera() {
  const out = document.getElementById('cam-test-result');
  if (!out) return;
  out.textContent = 'Meminta izin kamera…';
  if (!navigator.mediaDevices?.getUserMedia) {
    out.textContent = 'Peramban tidak mendukung kamera (API tidak tersedia).';
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    // langsung hentikan: uji saja
    stream.getTracks().forEach((t) => t.stop());
    out.textContent = '✅ Kamera berhasil diakses. Izin sudah tersimpan — pemindaian QR siap dipakai.';
    await refreshCameraChecks();
  } catch (e) {
    const msg = String(e?.name || e?.message || e);
    out.textContent = /NotAllowed|Permission/i.test(msg)
      ? '❌ Izin ditolak. Buka pengaturan situs di browser → Kamera → Izinkan, lalu muat ulang halaman.'
      : /NotFound|DevicesNotFound|no camera/i.test(msg)
        ? '❌ Kamera tidak terdeteksi pada perangkat ini.'
        : `❌ Kamera gagal diminta (${msg.slice(0, 60)}).`;
    await refreshCameraChecks();
  }
}

/* ==================================== diagnosa sambungan & database */
const DB_DIAG_KEY = 'staff_db_diag';

const IKON = { ok: '✅', warn: '⚠️', bad: '❌' };
const WARNA = { ok: 'var(--olive-700)', warn: 'var(--honey-600)', bad: 'var(--cran-800)' };

/** Ringkasan hasil diagnosa untuk disalin ke WA/panitia. */
function dbDiagText(rows) {
  const now = new Date().toLocaleString('id-ID');
  const cfgv = cfg();
  return [
    `Diagnosa aplikasi petugas — ${now}`,
    `Alamat: ${location.origin}${location.pathname}`,
    `Supabase: ${cfgv.SUPABASE_URL || '(kosong)'}`,
    `Kunci API: ${cfgv.SUPABASE_ANON_KEY ? String(cfgv.SUPABASE_ANON_KEY).slice(0, 12) + '…' : '(kosong)'}`,
    ...rows.map((r) => `${IKON[r.status] || '•'} ${r.teks}${r.saran ? ` — ${r.saran}` : ''}`)
  ].join('\n');
}

/** Uji alamat proyek Supabase (tanpa RPC) dengan batas waktu. */
async function cekAlamat(url, key) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
      cache: 'no-store'
    });
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, err: String(e?.name || e?.message || e) };
  } finally { clearTimeout(t); }
}

/**
 * Periksa konfigurasi, jangkauan server, kunci API, dan fungsi database.
 * Menulis hasil ke #db-check-list; mengembalikan daftar barisnya.
 */
async function runDbChecks(opts = {}) {
  const list = document.getElementById('db-check-list');
  if (!list) return [];
  list.innerHTML = '<li>Memeriksa…</li>';

  const rows = [];
  const tambah = (status, teks, saran = '') => rows.push({ status, teks, saran });
  const c = cfg();
  const url = String(c.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(c.SUPABASE_ANON_KEY || '').trim();

  // 1. config.js terisi
  if (!url || !key) {
    tambah('bad', 'config.js belum diisi (SUPABASE_URL / SUPABASE_ANON_KEY kosong)',
      'Isi config.js dengan alamat & anon key proyek, unggah ulang ke Netlify, lalu muat ulang.');
  } else {
    tambah('ok', `Alamat proyek: ${url}`);
  }

  // 2. bentuk alamat benar
  if (url) {
    const rapi = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(url);
    tambah(rapi ? 'ok' : 'warn',
      rapi ? 'Bentuk alamat sudah benar' : `Bentuk alamat perlu diperiksa: ${url}`,
      rapi ? '' : 'Harus seperti https://kode-proyek.supabase.co — tanpa /rest/v1 atau spasi.');
  }
  if (key) {
    tambah('ok', `Kunci API: ${key.slice(0, 12)}… (${key.startsWith('sb_publishable_') ? 'publishable' : key.startsWith('eyJ') ? 'anon JWT lama' : 'tidak dikenal'})`);
    if (!key.startsWith('sb_publishable_') && !key.startsWith('eyJ')) {
      tambah('warn', 'Kunci API bentuknya tidak dikenal',
        'Ambil ulang dari Dashboard Supabase → Project Settings → API Keys.');
    }
  }

  // 3. koneksi & kunci API benar (bukan "schema", tapi paling sering jadi penyebab)
  if (url && key) {
    const r = await cekAlamat(url, key);
    if (!r.ok) {
      tambah('bad', `Server Supabase tidak bisa dihubungi (${r.err || 'gagal'})`,
        'Periksa sinyal internet. Bila internet normal, proyek mungkin dijeda/dihapus: '
        + 'buka Dashboard Supabase → pastikan proyek aktif (tidak “Paused”).');
    } else if (r.status === 401 || r.status === 403) {
      tambah('bad', `Kunci API ditolak server (HTTP ${r.status})`,
        'Salin ulang anon/publishable key dari Dashboard Supabase ke config.js.');
    } else if (r.status === 404) {
      tambah('bad', 'Alamat proyek Supabase tidak ditemukan (HTTP 404)',
        'SUPABASE_URL di config.js harus https://kode-proyek.supabase.co — tanpa /rest/v1, '
        + 'tanpa spasi, dan sama persis dengan alamat proyek Anda.');
    } else if (r.status >= 500) {
      tambah('bad', `Server Supabase bermasalah (HTTP ${r.status})`,
        'Coba lagi beberapa menit. Bila tetap, proyek mungkin dijeda.');
    } else {
      tambah('ok', `Server Supabase terhubung (HTTP ${r.status})`);
    }
  }

  // 4. fungsi database terpasang & dikenali API
  if (url && key) {
    try {
      const info = await api.eventInfo();
      tambah('ok', `Fungsi event_info() jalan — acara: ${info?.event_name || '(tanpa nama)'}`);
    } catch (e) {
      if (e?.code === 'offline' || e?.code === 'timeout') {
        tambah('bad', `Tidak bisa memanggil fungsi database (${e?.code === 'timeout' ? 'waktu habis' : 'offline'})`);
      } else if (/column|relation|table .*does not exist/i.test(e?.message || '')) {
        tambah('bad', e?.message || 'Tabel/kolom database belum lengkap.',
          'Struktur tabel di proyek Supabase Anda masih versi lama. Jalankan supabase/schema.sql '
          + 'versi terbaru di SQL Editor → Run. Berkas versi ini aman diulang (kolom yang belum ada '
          + 'ditambahkan otomatis).');
      } else {
        tambah('bad', e?.message || 'Fungsi event_info() gagal dipanggil.',
          'Ini pesan asli Supabase. Bila menyebut “schema cache”, tekan Reload schema cache di '
          + 'Dashboard Supabase → Project Settings → API, tunggu ±1 menit, lalu tes lagi.');
      }
    }

    // 5. fungsi petugas dengan PIN yang tersimpan (bila ada)
    //    Hanya pada tes mendalam agar membuka halaman tidak mengunduh ulang daftar peserta.
    if (S.pin && opts.deep) {
      try {
        const res = await api.staffData(S.pin);
        const jml = Array.isArray(res?.participants) ? res.participants.length : 0;
        tambah(res?.ok ? 'ok' : 'warn',
          res?.ok ? `Fungsi staff_data() jalan — ${jml} peserta terbaca` : 'staff_data() menolak PIN tersimpan',
          res?.ok ? '' : 'Masukkan PIN lagi. Bila tetap gagal, ganti PIN lewat panel admin.');
      } catch (e) {
        tambah('bad', e?.message || 'Fungsi staff_data() gagal dipanggil.',
          /PIN/i.test(e?.message || '') ? 'PIN salah: masukkan PIN petugas yang berlaku.'
            : 'Bila menyebut fungsi tidak ada, jalankan ulang supabase/schema.sql di proyek Supabase yang SAMA dengan config.js.');
      }
    }
  }

  // 6. kelengkapan struktur (schema_check) — hanya bila server bisa dihubungi
  if (url && key && !rows.some((r) => r.status === 'bad' && /Server Supabase/i.test(r.teks))) {
    try {
      const cek = await api.schemaCheck();
      if (cek?.ok === true) {
        tambah('ok', 'Struktur tabel & fungsi database lengkap');
      } else if (cek && typeof cek === 'object') {
        const kurang = [
          ...(cek.missing_tables || []).map((t) => `tabel ${t}`),
          ...(cek.missing_columns || []).map((c) => `kolom ${c}`),
          ...(cek.missing_functions || []).map((f) => `fungsi ${f}`)
        ];
        tambah('bad', `Bagian database belum ada: ${kurang.slice(0, 8).join(', ')}`
          + (kurang.length > 8 ? `, +${kurang.length - 8} lagi` : ''),
          'Jalankan supabase/schema.sql versi terbaru di SQL Editor → Run, lalu tekan “Tes sekarang”.');
      }
    } catch (e) {
      // schema_check() sendiri belum ada -> berarti skema di server memang versi lama
      if (/schema cache|tidak dikenali/i.test(e?.message || '')) {
        tambah('warn', 'Fungsi pemeriksa schema_check() belum ada (skema versi lama)',
          'Jalankan supabase/schema.sql versi terbaru agar pemeriksaan otomatis bisa berjalan.');
      } else if (e?.code !== 'offline') {
        tambah('warn', e?.message || 'Pemeriksaan struktur database tidak bisa dijalankan.');
      }
    }
  }

  // 7. data lokal
  tambah(S.people.length ? 'ok' : 'warn',
    `${S.people.length} peserta tersimpan di HP ini`,
    S.people.length ? '' : 'Belum ada data lokal: login pertama memang perlu internet.');

  list.innerHTML = rows.map((r) => `
    <li style="color:${WARNA[r.status] || 'inherit'}">
      ${IKON[r.status] || '•'} ${esc(r.teks)}
      ${r.saran ? `<div class="small" style="color:var(--ink-soft)">${esc(r.saran)}</div>` : ''}
    </li>`).join('');

  try { store.set(DB_DIAG_KEY, { at: Date.now(), rows }); } catch { /* diabaikan */ }
  return rows;
}

/** Tombol “Tes sekarang”. */
async function testDb() {
  const out = document.getElementById('db-test-result');
  if (out) out.textContent = 'Memeriksa sambungan & database…';
  const rows = await runDbChecks({ deep: true });
  if (!out) return;
  const bad = rows.filter((r) => r.status === 'bad').length;
  const warn = rows.filter((r) => r.status === 'warn').length;
  out.textContent = bad
    ? `❌ ${bad} masalah ditemukan. Baca saran di daftar di atas, lalu tes lagi.`
    : warn
      ? `⚠️ Sambungan & database OK, ada ${warn} catatan kecil.`
      : '✅ Sambungan, kunci API, dan fungsi database semuanya normal.';
}

/** Salin hasil diagnosa (untuk dikirim ke panitia/pengembang). */
async function copyDbDiag() {
  const out = document.getElementById('db-test-result');
  const rows = (await runDbChecks({ deep: true })) || [];
  const teks = dbDiagText(rows);
  let berhasil = false;
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(teks); berhasil = true; }
  } catch { /* jatuh ke cara lama */ }
  if (!berhasil) {
    try {
      const ta = document.createElement('textarea');
      ta.value = teks;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      berhasil = Boolean(document.execCommand && document.execCommand('copy'));
      document.body.removeChild(ta);
    } catch { /* diabaikan */ }
  }
  if (out) {
    out.textContent = berhasil
      ? '📋 Hasil diagnosa disalin. Tempel ke WhatsApp untuk dikirim ke panitia.'
      : `Salin manual:\n${teks}`;
  }
  if (berhasil) toast('Hasil diagnosa disalin.', 'ok', 3000);
}

function showInstallHelp(ios) {
  if (ios) {
    toast('iPhone/iPad: ketuk ikon Bagikan (⬆️) → “Tambah ke Layar Utama” → Tambah.', 'warn', 9000);
  } else {
    toast('Android/Chrome: menu ⋮ (kanan atas) → “Pasang aplikasi” atau “Tambahkan ke Layar utama”.', 'warn', 9000);
  }
}

/* ========================================================= pemindaian */
async function startScanner() {
  if (S.scanning) return;
  const errBox = document.getElementById('camera-error');
  errBox.classList.add('hidden');

  if (!window.Html5Qrcode) {
    errBox.classList.remove('hidden');
    document.getElementById('camera-error-text').textContent =
      'Library pemindai tidak termuat. Muat ulang halaman saat ada internet.';
    return;
  }
  if (!window.isSecureContext) {
    errBox.classList.remove('hidden');
    document.getElementById('camera-error-text').textContent =
      'Kamera hanya bisa dipakai pada alamat HTTPS. Gunakan tab Cari untuk menghadirkan peserta.';
    return;
  }

  try {
    const formats = window.Html5QrcodeSupportedFormats
      ? [window.Html5QrcodeSupportedFormats.QR_CODE] : undefined;
    S.scanner = new window.Html5Qrcode('reader', { formatsToSupport: formats, verbose: false });
    await S.scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: (w, h) => { const m = Math.floor(Math.min(w, h) * 0.72); return { width: m, height: m }; } },
      (text) => onScanText(text),
      () => { /* abaikan error per frame */ }
    );
    S.scanning = true;
    document.getElementById('scan-idle').textContent = 'Kamera aktif — arahkan ke QR undangan.';
  } catch (e) {
    S.scanning = false;
    errBox.classList.remove('hidden');
    const msg = String(e?.message || e || '');
    document.getElementById('camera-error-text').textContent =
      /NotAllowed|Permission/i.test(msg)
        ? 'Izin kamera ditolak. Buka pengaturan browser > Izin situs > Kamera, izinkan, lalu muat ulang.'
        : /NotFound|no camera|Requested device/i.test(msg)
          ? 'Kamera tidak ditemukan pada perangkat ini.'
          : /secure|https/i.test(msg)
            ? 'Kamera butuh alamat HTTPS.'
            : `Kamera gagal dimulai (${msg.slice(0, 80)}). Gunakan tab Cari.`;
  }
}

async function stopScanner() {
  if (!S.scanner) return;
  try { await S.scanner.stop(); } catch { /* diabaikan */ }
  try { S.scanner.clear(); } catch { /* diabaikan */ }
  S.scanner = null;
  S.scanning = false;
}

function onScanText(text) {
  const token = extractToken(text);
  if (!token) return;
  const now = Date.now();
  // abaikan pembacaan ganda dari frame yang sama
  if (token === S.lastScan && now - S.lastScanAt < 3500) return;
  S.lastScan = token;
  S.lastScanAt = now;
  handleToken(token);
}

function handleToken(token) {
  const person = S.people.find((p) => p.token === token);

  if (!person) {
    showScanCard({
      kind: 'err',
      title: 'QR tidak dikenal',
      name: 'Undangan tidak terdaftar',
      meta: `Kode: ${token.slice(0, 12)}… · Daftarkan lewat tab Tambah bila peserta tanpa undangan.`
    });
    beep('err');
    vibrate([80, 50, 80]);
    return;
  }

  if (person.attended) {
    showScanCard({
      kind: 'dup',
      extras: extrasLine(person),
      title: 'Sudah absen',
      name: person.name,
      no: person.lottery_no,
      meta: `Sudah absen pukul ${fmtTime(person.attended_at)} · ${person.org || 'tanpa asal'}`
    });
    beep('dup');
    vibrate([60, 40, 60]);
    return;
  }

  // QR terbaca: petugas mengisi jumlah keluarga, kupon makan, dan souvenir dulu.
  showScanForm(person);
}

/**
 * Panel isian setelah QR/kode undangan terbaca.
 * Nilai awal diambil dari pilihan peserta sendiri (bila sudah pernah mengisi).
 */
function showScanForm(person) {
  S.pendingPerson = person;
  const box = document.getElementById('scan-form');
  if (!box) { attendPerson(person, 'petugas'); return; }   // cadangan bila markup tak ada

  const fam = Math.max(0, Math.min(5, Number(person.family_count) || 0));

  const title = document.getElementById('scan-form-title');
  const sub = document.getElementById('scan-form-sub');
  if (title) title.textContent = `Hadirkan ${person.name}`;
  if (sub) {
    sub.innerHTML = `Nomor undian <strong>${esc(pad3(person.lottery_no))}</strong>`
      + `${person.org ? ' · ' + esc(person.org) : ''} — isi keluarga &amp; konsumsi, lalu simpan.`;
  }

  const people = document.getElementById('scan-form-people');
  if (people) {
    people.innerHTML = `
      <div class="check-row" style="pointer-events:none">
        <span class="check-row__box" aria-hidden="true">👤</span>
        <span class="check-row__text"><strong>${esc(person.name)}</strong>
          <span>${esc(person.org || 'tanpa asal')}${person.phone ? ' · ' + esc(person.phone) : ''}</span></span>
      </div>
      ${fam > 0 ? `<div class="check-row" style="pointer-events:none">
        <span class="check-row__box" aria-hidden="true">👨‍👩‍👧</span>
        <span class="check-row__text"><strong>Keluarga yang ikut</strong>
          <span>${fam} orang</span></span>
      </div>` : ''}`;
  }

  const famInput = document.getElementById('scan-family');
  if (famInput) famInput.value = String(fam);
  const meal = document.getElementById('scan-meal');
  const souv = document.getElementById('scan-souvenir');
  if (meal) meal.checked = Boolean(person.wants_meal);
  if (souv) souv.checked = Boolean(person.wants_souvenir);

  const note = document.getElementById('scan-form-note');
  if (note) {
    note.textContent = (person.wants_meal || person.wants_souvenir || fam > 0)
      ? 'Nilai di atas berasal dari isian peserta saat konfirmasi. Ubah bila berbeda.'
      : 'Isian ini menentukan jumlah kupon makan dan souvenir yang diberikan.';
  }

  box.classList.remove('hidden');
  const res = document.getElementById('scan-result');
  if (res) { res.classList.add('hidden'); res.innerHTML = ''; }
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  clearTimeout(resetTimer);
}

/** Tutup panel isian (tanpa mencatat kehadiran). */
function hideScanForm() {
  const box = document.getElementById('scan-form');
  if (box) box.classList.add('hidden');
  S.pendingPerson = null;
  // QR yang sama boleh dipindai lagi setelah dibatalkan
  S.lastScan = '';
  S.lastScanAt = 0;
}

/** Tombol "Simpan & Hadirkan". */
function saveScanForm() {
  const person = S.pendingPerson;
  if (!person) { hideScanForm(); return; }
  const fam = Math.max(0, Math.min(5, Number(document.getElementById('scan-family')?.value || 0)));
  const meal = Boolean(document.getElementById('scan-meal')?.checked);
  const souv = Boolean(document.getElementById('scan-souvenir')?.checked);
  hideScanForm();
  attendPerson(person, 'petugas', { family_count: fam, wants_meal: meal, wants_souvenir: souv });
}

function attendPerson(person, source, extras = {}) {
  const at = new Date().toISOString();

  // isian dari panel scan (keluarga, kupon makan, souvenir)
  if (extras.family_count !== undefined) {
    person.family_count = Math.max(0, Math.min(5, Number(extras.family_count) || 0));
  }
  if (extras.wants_meal !== undefined) person.wants_meal = Boolean(extras.wants_meal);
  if (extras.wants_souvenir !== undefined) person.wants_souvenir = Boolean(extras.wants_souvenir);

  person.attended = true;
  person.attended_at = at;
  person.source = source;
  person.pending = true;
  save.people();

  enqueue({
    kind: 'attend',
    token: person.token,
    participant_id: person.id,
    name: person.name,
    lottery_no: person.lottery_no,
    attended_at: at,
    source,
    family_count: person.family_count || 0,
    wants_meal: Boolean(person.wants_meal),
    wants_souvenir: Boolean(person.wants_souvenir)
  });

  addLog({ name: person.name, lottery_no: person.lottery_no, at, status: 'ok' });

  showScanCard({
    kind: 'ok',
    extras: extrasLine(person),
    title: 'Hadir tercatat',
    name: person.name,
    no: person.lottery_no,
    meta: `${person.org || 'tanpa asal'}${person.phone ? ' · ' + person.phone : ''}`
  });
  beep('ok');
  vibrate(90);
  if (online()) scheduleSync(1200);
}

function addLog(entry) {
  S.log.unshift(entry);
  S.log = S.log.slice(0, 60);
  save.log();
  renderLog();
}

function renderLog() {
  const box = document.getElementById('scan-log');
  const count = document.getElementById('log-count');
  if (!box) return;
  if (count) count.textContent = String(S.log.length);
  if (!S.log.length) {
    box.innerHTML = '<p class="small" style="color:var(--ink-soft)">Belum ada aktivitas.</p>';
    return;
  }
  box.innerHTML = S.log.slice(0, 15).map((l) => `
    <div class="person" style="padding:8px 10px">
      <div class="person__no">${esc(pad3(l.lottery_no))}</div>
      <div class="person__body">
        <div class="person__name">${esc(l.name)}</div>
        <div class="person__meta">${esc(fmtTime(l.at))} · ${esc(l.status === 'ok' ? 'Hadir dicatat' : l.status)}</div>
      </div>
    </div>`).join('');
}

let resetTimer = null;
/** Baris ringkas keluarga + kupon + souvenir untuk kartu hasil. */
function extrasLine(person) {
  if (!person) return '';
  const bits = [];
  const fam = Number(person.family_count) || 0;
  if (fam > 0) bits.push(`👨‍👩‍👧 ${fam} anggota keluarga`);
  if (person.wants_meal) bits.push('🍱 Kupon makan');
  if (person.wants_souvenir) bits.push('🎁 Souvenir');
  return bits.join(' · ');
}

function showScanCard({ kind, title, name, no, meta, extras = '' }) {
  const box = document.getElementById('scan-result');
  if (!box) return;
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="scan-card scan-card--${kind}">
      <div class="small" style="letter-spacing:.08em;text-transform:uppercase;opacity:.9">${esc(title)}</div>
      <div class="scan-card__name">${esc(name)}</div>
      ${no ? `<div class="scan-card__no">${esc(pad3(no))}</div>
              <div class="scan-card__meta">Sebutkan nomor undian: <strong>${esc(pad3(no))}</strong></div>` : ''}
      ${extras ? `<div class="scan-card__meta">${extras}</div>` : ''}
      <div class="scan-card__meta" style="margin-top:6px">${esc(meta || '')}</div>
    </div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  clearTimeout(resetTimer);
  resetTimer = setTimeout(() => {
    box.classList.add('hidden');
    box.innerHTML = '';
    S.lastScan = '';
  }, 4200);
}

/* =============================================================== cari */
const renderSearch = debounce(() => {
  const list = document.getElementById('search-results');
  if (!list) return;
  const termRaw = document.getElementById('search-input')?.value || '';
  const term = normName(termRaw);
  const digits = normPhone(termRaw);
  const onlyUnattended = Boolean(document.getElementById('search-unattended')?.checked);

  let rows = S.people;
  if (term || digits) {
    rows = rows.filter((p) =>
      normName(p.name).includes(term) ||
      (digits && (p.phone || '').includes(digits)) ||
      normName(p.org || '').includes(term) ||
      String(p.lottery_no) === termRaw.trim()
    );
  } else {
    rows = [];
  }
  if (onlyUnattended) rows = rows.filter((p) => !p.attended);

  rows = rows.slice(0, 40);
  const countEl = document.getElementById('search-count');
  if (countEl) {
    countEl.textContent = (term || digits)
      ? `${rows.length} hasil${rows.length === 40 ? ' (maks 40, perjelas pencarian)' : ''}`
      : 'Ketik nama, nomor HP, asal, atau nomor undian';
  }

  if (!rows.length) {
    list.innerHTML = (term || digits)
      ? `<div class="notice notice--warn"><span class="notice__icon">🔍</span><div>
           Peserta tidak ditemukan. Tambahkan lewat tab <strong>Tambah</strong>.
         </div></div>`
      : '';
    return;
  }

  list.innerHTML = rows.map((p) => `
    <div class="person" data-id="${esc(p.id)}">
      <div class="person__no">${esc(pad3(p.lottery_no))}</div>
      <div class="person__body">
        <div class="person__name">${esc(p.name)}</div>
        <div class="person__meta">${esc(p.org || '—')}${p.phone ? ' · ' + esc(p.phone) : ''}</div>
        <div class="person__meta">
          ${p.attended
            ? `<span class="pill pill--hadir">Hadir ${esc(fmtTime(p.attended_at))}</span>`
            : '<span class="pill pill--belum">Belum hadir</span>'}
          ${p.invited ? '' : '<span class="pill pill--walkin">Tanpa undangan</span>'}
        </div>
      </div>
      <div class="person__side">
        ${p.attended
          ? '<span class="small" style="color:var(--ok);font-weight:700">✓</span>'
          : `<button class="btn btn--red btn--sm" data-action="attend" data-id="${esc(p.id)}">Hadirkan</button>`}
      </div>
    </div>`).join('');
}, 220);

/* ============================================ daftar undangan (dropdown) */

/**
 * Isi dropdown nama undangan pada tab Tambah.
 * Tamu yang lupa membawa kartu QR cukup disebutkan namanya oleh petugas:
 * pilih di sini -> nomor undian yang sudah terbit dipakai ulang (tanpa nomor baru).
 */
function renderInvitedOptions() {
  const sel = document.getElementById('add-invited');
  const hint = document.getElementById('add-invited-hint');
  if (!sel) return;

  const semua = S.people.slice().sort((a, b) => a.lottery_no - b.lottery_no);
  const terpilih = sel.value;
  sel.innerHTML = '<option value="">— Tamu tanpa undangan (baru) —</option>'
    + semua.map((p) => `<option value="${esc(p.id)}">${esc(pad3(p.lottery_no))} · ${esc(p.name)}`
      + `${p.org ? ` — ${esc(p.org)}` : ''}${p.attended ? ' ✓ sudah hadir' : ''}</option>`).join('');
  if (terpilih && semua.some((p) => String(p.id) === terpilih)) sel.value = terpilih;

  if (hint) {
    const belum = semua.filter((p) => !p.attended).length;
    hint.textContent = semua.length
      ? `${semua.length} undangan tersimpan di HP ini · ${belum} belum hadir. `
        + 'Ketik nama untuk mencari; memilih nama akan memakai nomor undian yang sudah terbit.'
      : 'Daftar undangan belum ada di HP ini. Sambungkan internet lalu tekan muat ulang data.';
  }
}

/** Tamu dipilih dari daftar undangan: tampilkan ringkasannya, isi form otomatis. */
function pilihUndangan(id) {
  const box = document.getElementById('add-invited-picked');
  const hint = document.getElementById('add-invited-hint');
  const form = document.getElementById('add-form');
  if (!box || !form) return;

  if (!id) {
    box.classList.add('hidden');
    box.innerHTML = '';
    form.querySelectorAll('input, select').forEach((el) => {
      if (el.id === 'add-invited') return;
      if (el.type === 'checkbox') el.checked = false;
    });
    document.getElementById('add-name').value = '';
    document.getElementById('add-phone').value = '';
    document.getElementById('add-org').value = '';
    document.getElementById('add-family').value = '0';
    if (hint) hint.textContent = 'Ketik nama untuk mencari. Memilih nama akan memakai nomor undian yang sudah terbit.';
    return;
  }

  const p = findPerson({ id });
  if (!p) return;

  document.getElementById('add-name').value = p.name || '';
  document.getElementById('add-phone').value = p.phone || '';
  document.getElementById('add-org').value = p.org || '';
  document.getElementById('add-family').value = String(Math.max(0, Math.min(5, p.family_count || 0)));
  document.getElementById('add-meal').checked = Boolean(p.wants_meal);
  document.getElementById('add-souvenir').checked = Boolean(p.wants_souvenir);

  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="notice ${p.attended ? 'notice--warn' : 'notice--success'}" style="margin-bottom:12px">
      <span class="notice__icon" aria-hidden="true">${p.attended ? '⚠️' : '🎫'}</span>
      <div>
        <strong>${esc(p.name)}</strong> — nomor undian <strong>${esc(pad3(p.lottery_no))}</strong>
        <div class="small">${p.attended
          ? `Sudah tercatat hadir pukul ${esc(fmtTime(p.attended_at))}. Tekan simpan hanya bila ingin memperbarui isian keluarga/kupon.`
          : 'Belum hadir. Tekan tombol di bawah untuk menghadirkan tanpa membuat nomor baru.'}</div>
      </div>
    </div>`;

  const label = document.getElementById('btn-add');
  if (label) label.textContent = p.attended ? 'Perbarui data kehadiran' : 'Hadirkan tamu ini';
}

/* ============================================================= tambah */
async function submitAdd(ev) {
  ev.preventDefault();
  const name = document.getElementById('add-name').value.trim();
  const phoneRaw = document.getElementById('add-phone').value.trim();
  const phone = normPhone(phoneRaw);
  const org = document.getElementById('add-org').value.trim();
  const family = Math.min(5, Number(document.getElementById('add-family').value || 0));
  const meal = document.getElementById('add-meal').checked;
  const souvenir = document.getElementById('add-souvenir').checked;

  if (name.length < 2) { toast('Nama lengkap wajib diisi.', 'err'); return; }

  // Tamu punya undangan (lupa bawa kartu QR)? Pakai nomor undian yang sudah terbit.
  const dipilih = document.getElementById('add-invited')?.value || '';
  if (dipilih) {
    const p = findPerson({ id: dipilih });
    if (!p) { toast('Peserta tidak ditemukan di daftar HP ini.', 'err'); return; }
    if (p.attended) {
      const ubah = typeof confirm === 'function'
        ? confirm(`${p.name} sudah tercatat hadir pukul ${fmtTime(p.attended_at)}.\n\n`
          + 'Perbarui isian keluarga / kupon makan / souvenir dengan nilai di form?')
        : false;
      if (!ubah) {
        toast(`${p.name} sudah hadir — data tidak diubah.`, 'warn', 4000);
        return;
      }
    }
    hideScanForm();
    attendPerson(p, 'petugas', { family_count: family, wants_meal: meal, wants_souvenir: souvenir });
    document.getElementById('add-invited').value = '';
    pilihUndangan('');
    renderInvitedOptions();
    updateChrome();
    renderSearch();
    return;
  }

  // Cegah dobel: cocokkan dulu dengan daftar lokal
  const match = findPerson({ phone, name });
  if (match) {
    if (match.attended) {
      toast(`Sudah terdaftar & hadir: ${match.name} (${pad3(match.lottery_no)})`, 'warn', 5000);
      showScanCard({ kind: 'dup', title: 'Sudah absen', name: match.name, no: match.lottery_no,
        meta: `Data cocok dengan peserta terdaftar · pukul ${fmtTime(match.attended_at)}` });
    } else {
      attendPerson(match, 'petugas');
      toast(`Data cocok dengan ${match.name} — dihadirkan dengan nomor ${pad3(match.lottery_no)}.`, 'ok', 5000);
    }
    document.getElementById('add-result').innerHTML = '';
    return;
  }

  let no = takeBlockNumber();
  if (no === null) {
    // coba ambil jatah baru bila ada internet
    await ensureBlock(true);
    no = takeBlockNumber();
  }
  if (no === null) {
    toast('Jatah nomor habis. Sambungkan internet untuk mengambil jatah baru.', 'err', 6000);
    document.getElementById('tambah-warning').classList.remove('hidden');
    return;
  }

  const at = new Date().toISOString();
  const localId = uuid();
  const token = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0')).join('');

  S.people.push({
    id: localId, token, name, org, phone, family_count: family, invited: false,
    lottery_no: no, attended: true, attended_at: at, source: 'petugas', pending: true,
    wants_meal: meal, wants_souvenir: souvenir
  });
  S.people.sort((a, b) => a.lottery_no - b.lottery_no);
  save.people();

  enqueue({
    kind: 'new', local_id: localId, token, name, phone, org,
    family_count: family, lottery_no: no, attended_at: at, source: 'petugas',
    wants_meal: meal, wants_souvenir: souvenir
  });

  addLog({ name, lottery_no: no, at, status: 'ok' });

  document.getElementById('add-result').classList.remove('hidden');
  document.getElementById('add-result').innerHTML = `
    <div class="scan-card scan-card--ok">
      <div class="small" style="letter-spacing:.08em;text-transform:uppercase;opacity:.9">Peserta ditambahkan</div>
      <div class="scan-card__name">${esc(name)}</div>
      <div class="scan-card__no">${esc(pad3(no))}</div>
      <div class="scan-card__meta">Sebutkan nomor undian: <strong>${esc(pad3(no))}</strong></div>
      <div class="scan-card__meta">${[
        family > 0 ? `👨‍👩‍👧 ${family} keluarga` : '',
        meal ? '🍱 Kupon makan' : '',
        souvenir ? '🎁 Souvenir' : ''
      ].filter(Boolean).join(' · ') || 'Tanpa kupon &amp; tanpa keluarga'}</div>
    </div>`;
  beep('ok'); vibrate(90);

  document.getElementById('add-form').reset();
  document.getElementById('add-family').value = '0';
  document.getElementById('add-meal').checked = false;
  document.getElementById('add-souvenir').checked = false;
  pilihUndangan('');
  renderInvitedOptions();
  document.getElementById('add-name').focus();
  updateChrome();
  renderSearch();
  if (online()) scheduleSync(1200);
}

/* ============================================================== sinkron */
function markSynced(itemId, result) {
  S.queue = S.queue.filter((q) => q.id !== itemId);
  save.queue();
  return result;
}

async function syncNow(silent = false) {
  if (S.syncing) return;
  if (!online()) { updateChrome(); if (!silent) toast('Masih offline. Antrean tersimpan aman di HP ini.', 'warn'); return; }
  if (!S.queue.length) { if (!silent) toast('Semua data sudah tersinkron.', 'ok', 1800); await refreshData(true); return; }

  S.syncing = true;
  const btn = document.getElementById('btn-sync');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  try {
    const batch = S.queue.slice(0, 60).map((q) => ({
      id: q.id,
      kind: q.kind,
      token: q.token || null,
      name: q.name || null,
      phone: q.phone || null,
      org: q.org || null,
      family_count: q.family_count || 0,
      lottery_no: q.lottery_no || null,
      attended_at: q.attended_at || null,
      source: q.source || 'petugas',
      wants_meal: Boolean(q.wants_meal),
      wants_souvenir: Boolean(q.wants_souvenir)
    }));

    const res = await api.staffSync(S.pin, batch);
    const results = res?.results || [];
    let okCount = 0;

    for (const r of results) {
      const item = S.queue.find((q) => q.id === r.id);
      if (!item) continue;
      if (['ok', 'already', 'merged'].includes(r.status)) {
        okCount++;
        // perbaiki data lokal dengan nilai dari server
        if (item.kind === 'attend' && r.participant_id) {
          const p = S.people.find((x) => x.id === r.participant_id || x.token === item.token);
          if (p) { p.id = r.participant_id; p.lottery_no = r.lottery_no ?? p.lottery_no; p.pending = false; }
        }
        if (item.kind === 'new') {
          const p = S.people.find((x) => x.id === item.local_id);
          if (p) {
            p.id = r.participant_id || p.id;
            if (r.lottery_no) p.lottery_no = r.lottery_no;
            p.pending = false;
          }
        }
        markSynced(r.id, r);
      } else if (r.status === 'not_found') {
        // token tak dikenal server: pertahankan, coba lagi nanti (jangan buang data)
        console.warn('Item tidak ditemukan di server', r);
      }
    }

    save.people();
    if (okCount) {
      addLog({ name: `${okCount} data tersinkron`, lottery_no: '—', at: new Date().toISOString(), status: 'sync' });
      // hapus entri log sinkron dari daftar utama nanti
    }
    updateChrome();
    note(S.queue.length ? `Tersinkron ${okCount}. Sisa antrean ${S.queue.length}.` : 'Semua data tersinkron.',
      S.queue.length ? 'warn' : 'success');
    await refreshData(true);
    if (!silent) toast(`Sinkron selesai. ${okCount} data terkirim.`, 'ok', 2500);
  } catch (e) {
    if (e?.code === 'offline') {
      note('Tidak ada sinyal. Antrean disimpan dan akan dikirim otomatis.', 'warn');
      setNet(false);
    } else {
      note(e?.message || 'Sinkronisasi gagal. Akan dicoba lagi.', 'warn');
      if (!silent) toast(e?.message || 'Sinkronisasi gagal.', 'err', 4000);
    }
  } finally {
    S.syncing = false;
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Sinkron'; }
    updateChrome();
    maybeRefill();
  }
}

function maybeRefill() {
  if (blockLeft() < (cfg().STAFF_BLOCK_REFILL_AT ?? 15) && online()) ensureBlock(true).catch(() => {});
}

let syncTimer = null;
function scheduleSync(delay = 0) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { if (queueCount()) syncNow(true); }, delay || 400);
}

async function refreshData(silent = false) {
  if (!online()) { updateChrome(); return false; }
  try {
    const res = await api.staffData(S.pin);
    if (!res?.ok) return false;
    applyServerData(res);
    save.people(); save.meta();
    updateChrome();
    renderSearch();
    if (!silent) toast('Daftar peserta diperbarui.', 'ok', 2000);
    return true;
  } catch (e) {
    if (e?.code === 'offline') setNet(false);
    else if (!silent) toast(e?.message || 'Gagal memperbarui data.', 'err');
    return false;
  }
}

/* timer: auto-sync ±15 detik + cek blok nomor */
function startCountdown() {
  clearInterval(S.countdown);
  S.countdown = setInterval(() => {
    setNet(online());
    if (online() && queueCount() && !S.syncing) syncNow(true);
    maybeRefill();
  }, cfg().SYNC_INTERVAL_MS ?? 15000);
}

/* ================================================================ tab */
function switchTab(tab, startCam = true) {
  if (tab !== 'scan' && S.pendingPerson) hideScanForm();
  S.tab = tab;
  store.set(K.tab, tab);
  const map = { scan: 'panel-scan', cari: 'panel-cari', tambah: 'panel-tambah' };
  for (const [key, id] of Object.entries(map)) {
    const panel = document.getElementById(id);
    const btn = document.getElementById(`tab-${key}`);
    if (panel) panel.classList.toggle('hidden', key !== tab);
    if (btn) btn.setAttribute('aria-selected', key === tab ? 'true' : 'false');
  }
  if (tab === 'scan') { if (startCam) startScanner(); }
  else stopScanner();
  if (tab === 'cari') { document.getElementById('search-input')?.focus(); renderSearch(); }
  if (tab === 'tambah') {
    document.getElementById('add-result')?.classList.add('hidden');
    renderInvitedOptions();
    document.getElementById('add-name')?.focus();
  }
}

/* ============================================================= event */
function bind() {
  document.getElementById('login-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = document.getElementById('pin-input').value.trim();
    if (pin.length < 4) { toast('PIN minimal 4 karakter.', 'err'); return; }
    doLogin(pin);
  });

  ['scan', 'cari', 'tambah'].forEach((t) => {
    document.getElementById(`tab-${t}`)?.addEventListener('click', () => switchTab(t));
  });

  document.getElementById('btn-sync')?.addEventListener('click', () => syncNow(false));
  document.getElementById('btn-refresh')?.addEventListener('click', async () => {
    const ok = await refreshData(false);
    if (ok) { await ensureBlock(true); toast('Data & jatah nomor diperbarui.', 'ok', 2000); }
  });
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    if (queueCount() && !confirm(`Masih ada ${queueCount()} data belum tersinkron. Keluar sekarang?`)) return;
    await stopScanner();
    store.del(K.pin);
    location.reload();
  });

  document.getElementById('btn-ask-camera')?.addEventListener('click', () => startScanner());
  bindInstall();
  document.getElementById('btn-cam-test')?.addEventListener('click', testCamera);
  document.getElementById('btn-cam-reinstall')?.addEventListener('click', () => showInstallHelp(false));
  document.getElementById('btn-cam-reinstall-ios')?.addEventListener('click', () => showInstallHelp(true));
  document.getElementById('cam-diagnose')?.addEventListener('toggle', (e) => {
    if (e.target.open) refreshCameraChecks().catch(() => {});
  });
  document.getElementById('btn-db-test')?.addEventListener('click', testDb);
  document.getElementById('btn-db-copy')?.addEventListener('click', copyDbDiag);
  document.getElementById('db-diagnose')?.addEventListener('toggle', (e) => {
    if (e.target.open) runDbChecks().catch(() => {});
  });
  // kamera baru boleh dipakai setelah pengguna menyentuh layar (aturan peramban)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    S.installEvent = e;
    setupInstallBanner();
  });
  window.addEventListener('appinstalled', () => {
    S.installEvent = null;
    document.getElementById('install-banner')?.classList.add('hidden');
    toast('Aplikasi terpasang. Buka dari layar utama agar izin kamera tersimpan.', 'ok', 6000);
  });
  document.getElementById('manual-scan-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('manual-token');
    const token = extractToken(input.value) || input.value.trim().toLowerCase();
    if (!/^[0-9a-f]{8,64}$/.test(token)) { toast('Kode undangan tidak valid.', 'err'); return; }
    input.value = '';
    handleToken(token);
  });

  document.getElementById('search-input')?.addEventListener('input', renderSearch);
  document.getElementById('search-unattended')?.addEventListener('change', renderSearch);
  document.getElementById('search-results')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="attend"]');
    if (!btn) return;
    const person = S.people.find((p) => p.id === btn.dataset.id);
    if (person) { switchTab('scan'); showScanForm(person); }
  });

  document.getElementById('btn-scan-save')?.addEventListener('click', saveScanForm);
  document.getElementById('btn-scan-cancel')?.addEventListener('click', hideScanForm);

  document.getElementById('add-form')?.addEventListener('submit', submitAdd);
  document.getElementById('add-invited')?.addEventListener('change', (e) => pilihUndangan(e.target.value));

  window.addEventListener('online', () => {
    setNet(true);
    toast('Kembali online — mengirim antrean…', 'ok', 2000);
    if (S.pin) { syncNow(true); ensureBlock(true).catch(() => {}); }
  });
  window.addEventListener('offline', () => {
    setNet(false);
    note('Offline. Semua catatan disimpan di HP ini dan akan dikirim saat sinyal kembali.', 'warn');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && online() && queueCount()) syncNow(true);
    if (document.visibilityState === 'hidden') stopScanner();
  });
  window.addEventListener('hashchange', () => {
    const t = location.hash.replace('#', '');
    if (['scan', 'cari', 'tambah'].includes(t)) switchTab(t);
  });
}

/* ============================================================== mulai */
// diekspor agar bisa diuji otomatis (jsdom) tanpa menekan tombol
export { runDbChecks, testDb, copyDbDiag, dbDiagText, showScanForm, saveScanForm, hideScanForm };

async function main() {
  loadLocal();
  bind();
  setNet(online());

  const hashTab = location.hash.replace('#', '');
  if (['scan', 'cari', 'tambah'].includes(hashTab)) S.tab = hashTab;

  if (S.pin) {
    // Sudah pernah login di HP ini: langsung masuk (wajib untuk mode offline)
    if (S.people.length) {
      enterApp();
      if (online()) { refreshData(true).then(() => ensureBlock(true)); }
    } else {
      document.getElementById('view-login').classList.remove('hidden');
      document.getElementById('pin-input').focus();
    }
  } else {
    document.getElementById('pin-input').focus();
  }

  const app = document.getElementById('view-app');
  app.classList.remove('hidden');
  setupInstallBanner();
  refreshCameraChecks().catch(() => {});
  runDbChecks().catch(() => {});

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(() => refreshCameraChecks().catch(() => {}))
      .catch(() => { /* diabaikan */ });
  }
}

main();
