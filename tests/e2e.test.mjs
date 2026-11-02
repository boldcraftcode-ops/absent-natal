/**
 * e2e.test.mjs — Uji integrasi antarmuka (jsdom) + database asli (PGlite).
 *
 * Halaman HTML dijalankan sungguhan (skrip & modul ES dieksekusi), sementara
 * setiap fetch ke /rest/v1/rpc/<nama> diteruskan ke PGlite sehingga fungsi
 * Postgres di supabase/schema.sql benar-benar dieksekusi.
 *
 * Jalankan: cd tests && npm install && npm run test:e2e
 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const TMP = join(here, '.tmp');
mkdirSync(TMP, { recursive: true });

const SCHEMA = readFileSync(join(ROOT, 'supabase', 'schema.sql'), 'utf8');
const db = await PGlite.create({ extensions: { pgcrypto } });
await db.exec(SCHEMA);

/* --------------------------------------------------------------- util uji */
let pass = 0;
const fails = [];
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fails.push(name); console.log(`  FAIL ${name} ${String(extra).slice(0, 200)}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeout = 5000, label = 'kondisi' } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try { last = await fn(); if (last) return true; } catch (e) { last = e; }
    await sleep(40);
  }
  throw new Error(`timeout menunggu ${label} (${String(last).slice(0, 120)})`);
}

const CFG = {
  SUPABASE_URL: 'https://proyek.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_uji',
  STAFF_BLOCK_SIZE: 40,
  STAFF_BLOCK_REFILL_AT: 15,
  SYNC_INTERVAL_MS: 60000
};

/** Teruskan POST /rest/v1/rpc/<fn> ke PGlite. */
const jsonRes = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
  text: async () => JSON.stringify(data)
});

async function pgFetch(url, opts = {}) {
  // akar PostgREST (dipakai uji koneksi): Supabase menjawab 200 + spesifikasi
  if (/\/rest\/v1\/?$/.test(String(url))) return jsonRes({ openapi: '3.0.0', info: { title: 'uji' } }, 200);
  const m = String(url).match(/\/rest\/v1\/rpc\/([a-zA-Z0-9_]+)/);
  if (!m) return jsonRes({ message: 'not found' }, 404);
  const fn = m[1];
  const body = opts.body ? JSON.parse(opts.body) : {};
  const keys = Object.keys(body);
  const args = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
  try {
    const rows = (await db.query(`select public.${fn}(${args}) as r`, keys.map((k) => body[k]))).rows;
    return jsonRes(rows[0]?.r ?? null, 200);
  } catch (e) {
    return jsonRes({ message: e.message, code: e.code, hint: e.hint }, 400);
  }
}
const rpc = async (fn, params) => (await pgFetch(`https://proyek.supabase.co/rest/v1/rpc/${fn}`, {
  body: JSON.stringify(params)
})).json();
const sql = async (q, p) => (await db.query(q, p)).rows;

const GLOBALS = [
  'window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage',
  'HTMLElement', 'HTMLAnchorElement', 'HTMLInputElement', 'Node', 'Element', 'Event',
  'CustomEvent', 'File', 'FileReader', 'Blob', 'FormData', 'URL', 'URLSearchParams',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'confirm', 'prompt', 'alert', 'history', 'getComputedStyle', 'screen', 'DOMRect',
  'MutationObserver', 'Image', 'Canvas', 'Text', 'Comment', 'DocumentFragment'
];
let pageCounter = 0;
// fetch aktif (diteruskan ke halaman yang sedang diuji)
let ACTIVE_FETCH = null;
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  writable: true,
  value: (...args) => (ACTIVE_FETCH ? ACTIVE_FETCH(...args)
    : Promise.reject(new TypeError('Failed to fetch')))
});

/**
 * Jalankan sebuah halaman (skrip inline + modul ES) di jsdom.
 * @returns {{window, document, $, close, errors, storage}}
 */
async function runPage(file, { query = '', fetch: fetchImpl, storage = {}, beforeModules, stubZip = false } = {}) {
  const html = readFileSync(join(ROOT, file), 'utf8');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));
  vc.on('error', (...a) => errors.push(a.join(' ')));

  const dom = new JSDOM(html, {
    url: `https://absensi-natal.test/${file}${query}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.APP_CONFIG = { ...CFG };
      w.fetch = fetchImpl || pgFetch;
      w.scrollTo = () => {};
      w.confirm = () => true;
      w.prompt = () => 'RESET';
      w.alert = () => {};
      w.print = () => {};
      w.HTMLElement.prototype.scrollIntoView = () => {};
      // jsdom belum mengimplementasikan <dialog>.showModal()
      if (w.HTMLDialogElement) {
        w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
        w.HTMLDialogElement.prototype.show = function () { this.setAttribute('open', ''); };
        w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
      }
      w.HTMLAnchorElement.prototype.click = function () { w.__downloaded = this.download; };
      // rekam isi unduhan agar kolom ekspor bisa diperiksa
      const revoke = w.URL.revokeObjectURL;
      w.__blobText = w.__blobText || {};
      w.URL.createObjectURL = (blob) => {
        const url = 'blob:uji-' + (Object.keys(w.__blobText).length + 1);
        try {
          if (blob && typeof blob.text === 'function') blob.text().then((t) => { w.__blobText[url] = t; });
          else if (blob) w.__blobText[url] = String(blob.__text || '');
        } catch { /* abaikan */ }
        return url;
      };
      w.URL.createObjectURL = () => 'blob:uji';
      w.URL.revokeObjectURL = () => {};
      w.navigator.vibrate = () => true;
      // jsdom tidak punya mesin kanvas: tiru getContext -> data URL (cukup untuk uji)
      w.HTMLCanvasElement.prototype.getContext = function () {
        // penghitung dipakai uji salju untuk memastikan ada gambar yang dilukis
        w.__canvasCalls = w.__canvasCalls || { arc: 0, fill: 0, clear: 0, setTransform: 0 };
        const calls = w.__canvasCalls;
        return {
          fillStyle: '', strokeStyle: '', lineWidth: 1,
          fillRect() {}, drawImage() {}, strokeRect() {},
          clearRect() { calls.clear++; },
          setTransform() { calls.setTransform++; },
          getImageData: () => ({ data: new Uint8ClampedArray(4) }),
          putImageData() {}, moveTo() {}, lineTo() {}, stroke() {},
          beginPath() {}, closePath() {},
          arc() { calls.arc++; },
          fill() { calls.fill++; }
        };
      };
      w.HTMLCanvasElement.prototype.toDataURL = function () {
        return `data:image/png;base64,RAW${this.width}x${this.height}`;
      };
      if (!w.requestAnimationFrame) w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 4);
      for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, JSON.stringify(v));
    }
  });
  const { window } = dom;

  // library vendor (jsdom tidak mengunduh <script src>)
  for (const src of ['vendor/qrcode.js', 'vendor/xlsx.full.min.js', 'vendor/jszip.min.js']) {
    window.eval(readFileSync(join(ROOT, src), 'utf8'));
  }
  if (stubZip) {
    // JSZip butuh event loop penuh (tidak jalan di jsdom) -> stub pencatat berkas
    window.JSZip = class FakeZip {
      constructor() { this.files = {}; }
      file(name, data) { this.files[name] = data; }
      async generateAsync() { window.__zipFiles = Object.keys(this.files); return new window.Blob(['x']); }
    };
  }
  window.eval(readFileSync(join(ROOT, 'config.js'), 'utf8'));
  window.APP_CONFIG = { ...CFG };

  // pasang global agar modul ES (yang memakai `document`, `localStorage`, ...) jalan
  for (const name of GLOBALS) {
    if (window[name] === undefined) continue;
    if (['performance', 'crypto', 'fetch'].includes(name)) continue;
    try {
      Object.defineProperty(globalThis, name, {
        value: window[name], configurable: true, writable: true
      });
    } catch { /* properti read-only: pakai versi Node */ }
  }
  for (const lib of ['XLSX', 'JSZip', 'qrcode', 'Html5Qrcode']) {
    if (window[lib] !== undefined) globalThis[lib] = window[lib];
  }
  if (stubZip) globalThis.JSZip = window.JSZip;
  globalThis.window = window;

  ACTIVE_FETCH = fetchImpl || pgFetch;
  if (beforeModules) beforeModules(window);

  // modul halaman dijalankan dari berkas nyata agar import relatif '..' tetap benar
  const src = html.match(/type="module" src="([^"]+)"/)?.[1];
  if (src) {
    const code = readFileSync(join(ROOT, src), 'utf8');
    const tmpName = `page${++pageCounter}-${src.replace(/[\\/]/g, '_')}`;
    const tmpPath = join(TMP, tmpName);
    writeFileSync(tmpPath, code);
    // dari tests/.tmp, '../' -> tests/ ; perlu naik dua tingkat
    writeFileSync(tmpPath, code.replace(/from '\.\.\//g, `from '${pathToFileURL(ROOT).href}/`));
    await import(pathToFileURL(tmpPath).href);
  }

  OPEN_WINDOWS.push(window);
  return {
    window,
    document: window.document,
    errors,
    $(sel) { return window.document.querySelector(sel); },
    $(id) { return window.document.getElementById(id.replace(/^#/, '')); },
    visible(id) {
      const el = window.document.getElementById(id);
      return Boolean(el) && !el.classList.contains('hidden');
    },
    text(sel) { const el = window.document.querySelector(sel); return el ? el.textContent : ''; },
    close() { try { window.close(); } catch { /* diabaikan */ } }
  };
}

/** Pasang ulang fetch untuk semua halaman yang masih terbuka (dipakai uji offline). */
function setFetchForAll(fn) {
  ACTIVE_FETCH = fn;
  for (const w of OPEN_WINDOWS) w.fetch = fn;
}
const OPEN_WINDOWS = [];
/** Modul ES memakai `document` global: arahkan ke halaman yang sedang diuji. */
function usePage(page) {
  for (const name of ['document', 'window', 'localStorage', 'sessionStorage', 'location', 'navigator',
    'prompt', 'confirm', 'alert']) {
    try {
      Object.defineProperty(globalThis, name, {
        value: page.window[name] ?? page.window, configurable: true, writable: true
      });
    } catch { /* properti read-only: pakai versi Node */ }
  }
  return page;
}

const click = (page, sel) => page.window.document.querySelector(sel).click();
const fire = (page, sel, type = 'submit') => page.window.document
  .querySelector(sel).dispatchEvent(new page.window.Event(type, { bubbles: true, cancelable: true }));

/* ============================================================ 1. PERSIAPAN */
console.log('== 1. Persiapan data');
{
  const r = await rpc('admin_import', {
    p_pin: 'admin1234',
    p_rows: JSON.stringify([
      { name: 'Budi Santoso', phone: '081234567890', org: 'Divisi TI' },
      { name: 'Siti Aminah', phone: '081311112222', org: 'Keuangan' },
      { name: 'Yohanes Sinaga', phone: '', org: 'Medan' }
    ])
  });
  check('import 3 undangan', r.inserted === 3, JSON.stringify(r));
  await rpc('admin_prize_save', { p_pin: 'admin1234', p_name: 'Kulkas', p_qty: 2, p_id: null, p_order: 1 });
  const budi = (await sql("select * from participants where name='Budi Santoso'"))[0];
  check('token 16 hex', /^[0-9a-f]{16}$/.test(budi.token), budi.token);
  globalThis.__budi = budi;
}

/* ==================================== 2. HALAMAN PESERTA — jalur 1 */
console.log('== 2. index.html — peserta undangan: scan & konfirmasi');
{
  const budi = globalThis.__budi;
  const page = await runPage('index.html', { query: `?t=${budi.token}` });
  await until(() => page.visible('view-invite'), { label: 'layar undangan' });
  check('nama terisi otomatis', page.text('#invite-name') === 'Budi Santoso', page.text('#invite-name'));
  check('asal terisi otomatis', page.text('#invite-org2') === 'Divisi TI', page.text('#invite-org2'));
  check('tombol Konfirmasi Hadir wajib ditekan', page.$('#btn-confirm').textContent.includes('Konfirmasi'));
  check('belum tercatat hadir sebelum tombol ditekan',
    (await sql('select attended from participants where id=$1', [budi.id]))[0].attended === false);

  click(page, '#btn-confirm');
  await until(() => page.visible('view-success'), { label: 'layar sukses' });
  const no = page.text('#success-no');
  check('nomor undian 3 digit tampil', /^\d{3}$/.test(no), no);
  check('nomor sesuai database', no === String(budi.lottery_no).padStart(3, '0'), no);
  check('sapaan menyebut nama', /Selamat datang, Budi Santoso/.test(page.text('#success-greeting')));
  check('petunjuk screenshot tampil', /Screenshot/i.test(page.document.body.textContent));
  check('tersimpan di server sebagai scan_sendiri',
    (await sql('select source, attended from participants where id=$1', [budi.id]))[0].source === 'scan_sendiri');
  page.close();
}

console.log('== 3. index.html — scan ulang mendapat nomor yang sama');
{
  const budi = globalThis.__budi;
  const page = await runPage('index.html', { query: `?t=${budi.token}` });
  await until(() => page.visible('view-already'), { label: 'layar sudah absen' });
  check('scan ulang: nomor sama',
    page.text('#already-no') === String(budi.lottery_no).padStart(3, '0'), page.text('#already-no'));
  check('scan ulang: tampil pukul HH:MM', /\d{2}[:.]\d{2}/.test(page.text('#already-time')),
    page.text('#already-time'));
  check('scan ulang tidak mengubah waktu hadir di server',
    (await sql('select count(*)::int c from participants where attended=true'))[0].c === 1);
  page.close();
}

console.log('== 4. index.html — token tidak dikenal');
{
  const page = await runPage('index.html', { query: '?t=ffffffffffffffff' });
  await until(() => page.visible('view-notfound'), { label: 'layar tidak ditemukan' });
  check('pesan "Undangan tidak ditemukan"', /Undangan tidak ditemukan/.test(page.document.body.textContent));
  page.close();
}

/* ==================================== 5. HALAMAN PESERTA — jalur 3 */
console.log('== 5. index.html — form tanpa undangan & penggabungan');
{
  const page = await runPage('index.html', {});
  await until(() => page.visible('view-form'), { label: 'form umum' });

  page.$('#f-name').value = 'Rudi Hartono';
  page.$('#f-phone').value = '+62 817-000-111';
  page.$('#f-org').value = 'Umum';
  page.$('#f-family').value = '2';
  fire(page, '#walkin-form');
  await until(() => page.visible('view-success'), { label: 'sukses walk-in' });
  const no = Number(page.text('#success-no'));
  check('nomor walk-in >= 501', no >= 501, String(no));
  const rudi = (await sql("select * from participants where name='Rudi Hartono'"))[0];
  check('HP dinormalkan +62 -> 0', rudi.phone === '0817000111', rudi.phone);
  check('jumlah keluarga tersimpan', rudi.family_count === 2, String(rudi.family_count));
  check('sumber tercatat form_umum', rudi.source === 'form_umum', rudi.source);
  page.close();
}

console.log('== 6. index.html — data sama dengan undangan tidak dobel');
{
  const budi = globalThis.__budi;
  const page = await runPage('index.html', {});
  await until(() => page.visible('view-form'), { label: 'form umum' });
  page.$('#f-name').value = 'Budi S.';
  page.$('#f-phone').value = '+62 812-3456-7890';
  fire(page, '#walkin-form');
  await until(() => page.visible('view-already') || page.visible('view-success'), { label: 'hasil gabung' });
  const sameNo = page.visible('view-already')
    ? page.text('#already-no') : page.text('#success-no');
  check('digabung ke nomor undangan', sameNo === String(budi.lottery_no).padStart(3, '0'), sameNo);
  check('tidak ada peserta baru dengan HP itu',
    (await sql("select count(*)::int c from participants where phone='081234567890'"))[0].c === 1);
  page.close();
}

/* ==================================== 7. PETUGAS */
console.log('== 7. petugas.html — login & pemuatan data');
let staff;
{
  staff = await runPage('petugas.html');
  await until(() => staff.visible('view-login'), { label: 'login petugas' });
  staff.$('#pin-input').value = 'staff1234';
  fire(staff, '#login-form');
    await until(() => staff.visible('view-app'), { label: 'aplikasi petugas' });
  await until(() => Number(staff.text('#stat-total')) >= 4, { label: 'daftar peserta' });
  check('seluruh peserta termuat', Number(staff.text('#stat-total')) >= 4, staff.text('#stat-total'));
  check('jumlah hadir tampil', Number(staff.text('#stat-attended')) >= 2, staff.text('#stat-attended'));
  await until(() => /Jatah nomor [1-9]/.test(staff.text('#block-badge')), { label: 'blok nomor' });
  check('blok nomor diambil dari server', /Jatah nomor 40/.test(staff.text('#block-badge')), staff.text('#block-badge'));
  check('lencana antrean tampil', /Antrean \d/.test(staff.text('#queue-badge')));
}

console.log('== 8. petugas.html — scan QR undangan');
{
  const siti = (await sql("select * from participants where name='Siti Aminah'"))[0];
  globalThis.__siti = siti;
  staff.$('#manual-token').value = `https://absensi-natal.test/?t=${siti.token}`;
  fire(staff, '#manual-scan-form');
  await until(() => staff.$('#scan-result').innerHTML.includes('Hadir tercatat'), { label: 'kartu hijau' });
  const html = staff.$('#scan-result').innerHTML;
  check('kartu hijau: nama peserta', html.includes('Siti Aminah'));
  check('kartu hijau: nomor undian besar', html.includes(String(siti.lottery_no).padStart(3, '0')));
  await until(() => Number(staff.text('#stat-queue')) === 1, { label: 'antrean 1' });
  check('aksi masuk antrean lokal', Number(staff.text('#stat-queue')) === 1);

  staff.$('#manual-token').value = siti.token;
  fire(staff, '#manual-scan-form');
  await until(() => staff.$('#scan-result').innerHTML.includes('Sudah absen'), { label: 'kartu kuning' });
  check('scan ulang: kartu kuning "Sudah absen"', true);
  check('tidak menambah antrean baru', Number(staff.text('#stat-queue')) === 1);

  staff.$('#manual-token').value = 'aaaabbbbccccdddd';
  fire(staff, '#manual-scan-form');
  await until(() => staff.$('#scan-result').innerHTML.includes('QR tidak dikenal'), { label: 'kartu merah' });
  check('QR tidak dikenal: kartu merah', true);
}

console.log('== 9. petugas.html — tambah peserta saat OFFLINE');
{
  setFetchForAll(() => Promise.reject(new TypeError('Failed to fetch')));
  const before = (await sql('select count(*)::int c from participants'))[0].c;

  staff.$('#add-name').value = 'Offline Peserta';
  staff.$('#add-phone').value = '0817 555 444';
  staff.$('#add-org').value = 'Meja 2';
  fire(staff, '#add-form');
  await until(() => /Peserta ditambahkan/.test(staff.$('#add-result').innerHTML), { label: 'kartu tambah' });
  const addedNo = Number(staff.$('#add-result').querySelector('.scan-card__no').textContent);
  check('nomor dari blok jatah (>= 501)', addedNo >= 501, String(addedNo));
  check('peserta langsung tampil di daftar lokal',
    Number(staff.text('#stat-total')) >= 5, staff.text('#stat-total'));
  check('server belum menerima data saat offline',
    (await sql('select count(*)::int c from participants'))[0].c === before);
  await until(() => Number(staff.text('#stat-queue')) >= 2, { label: 'antrean >= 2' });
  check('antrean bertambah walau offline', Number(staff.text('#stat-queue')) >= 2);

  // sinkron manual setelah sinyal kembali
  setFetchForAll(pgFetch);
  staff.window.dispatchEvent(new staff.window.Event('online'));
  click(staff, '#btn-sync');
  await until(() => Number(staff.text('#stat-queue')) === 0, { timeout: 10000, label: 'antrean kosong' });
  check('antrean tersinkron setelah sinyal kembali', true);
  const row = (await sql("select * from participants where name='Offline Peserta'"))[0];
  check('peserta offline tersimpan di server dengan nomor blok', row?.lottery_no === addedNo,
    `${row?.lottery_no} vs ${addedNo}`);
  check('sumber petugas', row?.source === 'petugas', row?.source);
  check('tidak ada nomor kembar', (await sql(
    'select lottery_no from participants group by 1 having count(*) > 1')).length === 0);
  check('scan Siti tersimpan hadir',
    (await sql('select attended from participants where id=$1', [globalThis.__siti.id]))[0].attended === true);
}

console.log('== 10. petugas.html — pencarian & Hadirkan');
{
  staff.$('#tab-cari').click();
  staff.$('#search-input').value = 'Yohanes';
  staff.$('#search-input').dispatchEvent(new staff.window.Event('input', { bubbles: true }));
  await until(() => staff.$('#search-results').innerHTML.includes('Yohanes Sinaga'), { label: 'hasil cari' });
  check('pencarian nama menemukan peserta', true);
  await staff.window.document.querySelector('#search-results [data-action="attend"]').click();
  await until(() => Number(staff.text('#stat-queue')) >= 1, { label: 'antrean hadir' });
  check('tombol Hadirkan mencatat kehadiran', true);
  click(staff, '#btn-sync');
  await until(() => Number(staff.text('#stat-queue')) === 0, { timeout: 10000, label: 'sync' });
  check('Hadirkan tersinkron ke server',
    (await sql("select attended from participants where name='Yohanes Sinaga'"))[0].attended === true);
}

console.log('== 11. Dua petugas mencatat orang yang sama (idempoten)');
{
  const before = (await sql('select count(*)::int c from participants'))[0].c;
  const items = JSON.stringify([
    { id: 'e2e-1', kind: 'attend', token: globalThis.__siti.token, attended_at: '2026-12-24T18:00:00+07:00' },
    { id: 'e2e-2', kind: 'new', name: 'Offline Peserta', phone: '0817555444', org: 'Meja 2', lottery_no: 900, attended_at: '2026-12-24T18:01:00+07:00' }
  ]);
  const r1 = await rpc('staff_sync', { p_pin: 'staff1234', p_items: items });
  const r2 = await rpc('staff_sync', { p_pin: 'staff1234', p_items: items });
  check('sync pertama ok', r1.ok === true, JSON.stringify(r1));
  check('tidak menggandakan peserta', (await sql('select count(*)::int c from participants'))[0].c === before);
  check('sync kedua idempoten', r2.results.every((r) => ['already', 'merged'].includes(r.status)),
    JSON.stringify(r2.results));
  const waktu = (await sql('select attended_at from participants where id=$1', [globalThis.__siti.id]))[0].attended_at;
  check('waktu hadir paling awal dipertahankan',
    new Date(waktu).getTime() <= new Date('2026-12-24T18:00:00+07:00').getTime(), String(waktu));
}

/* ==================================== 12. ADMIN */
console.log('== 12. admin.html — rekap, filter, ekspor');
let admin;
{
  admin = await runPage('admin.html', { stubZip: true });
  await until(() => admin.visible('view-login'), { label: 'login admin' });
  admin.$('#pin-input').value = 'admin1234';
  fire(admin, '#login-form');
  await until(() => admin.visible('view-app'), { label: 'panel admin' });
  await until(() => Number(admin.text('#s-present')) > 0, { label: 'statistik' });

  check('total undangan = 3', admin.text('#s-invited') === '3', admin.text('#s-invited'));
  check('kartu total hadir > 0', Number(admin.text('#s-present')) > 0, admin.text('#s-present'));
  check('kartu tanpa undangan terhitung', Number(admin.text('#s-walkin').replace(/\D/g, '')) >= 2,
    admin.text('#s-walkin'));
  check('rincian per sumber tampil',
    /Scan sendiri/.test(admin.text('#source-breakdown')) && /Petugas/.test(admin.text('#source-breakdown')));
  check('tabel peserta berisi baris', admin.document.querySelectorAll('#rekap-body tr').length >= 5);

  click(admin, '#rekap-filters [data-filter="present"]');
  const rows = [...admin.document.querySelectorAll('#rekap-body tr')];
  check('filter "Hadir" menyaring', rows.length > 0 && rows.every((tr) => tr.textContent.includes('Hadir')));

  click(admin, '#rekap-filters [data-filter="walkin"]');
  const walk = [...admin.document.querySelectorAll('#rekap-body tr')];
  check('filter "Tanpa undangan" menyaring', walk.length >= 2 && walk.every((tr) => tr.textContent.includes('tanpa undangan')));

  click(admin, '#rekap-filters [data-filter="all"]');
  admin.$('#rekap-search').value = 'Siti';
  admin.$('#rekap-search').dispatchEvent(new admin.window.Event('input', { bubbles: true }));
  await sleep(320);
  check('pencarian di rekap bekerja', admin.document.querySelectorAll('#rekap-body tr').length === 1,
    String(admin.document.querySelectorAll('#rekap-body tr').length));
  admin.$('#rekap-search').value = '';
  admin.$('#rekap-search').dispatchEvent(new admin.window.Event('input', { bubbles: true }));
  await sleep(320);

  click(admin, '#btn-xlsx');
  await until(() => String(admin.window.__downloaded || '').endsWith('.xlsx'), { label: 'xlsx' });
  check('Download Excel (.xlsx)', true);
  admin.window.__downloaded = '';
  click(admin, '#btn-csv');
  await until(() => String(admin.window.__downloaded || '').endsWith('.csv'), { label: 'csv' });
  check('Download CSV', true);

  // aksi baris: batal hadir lalu hadirkan lagi
  const target = (await sql("select id, attended from participants where name='Budi Santoso'"))[0];
  const tr = admin.document.querySelector(`#rekap-body tr[data-id="${target.id}"]`);
  tr.querySelector('[data-act="toggle"]').click();
  await until(async () => (await sql('select attended from participants where id=$1', [target.id]))[0].attended === false,
    { label: 'batal hadir' });
  check('aksi Batal hadir bekerja', true);
  const tr2 = admin.document.querySelector(`#rekap-body tr[data-id="${target.id}"]`);
  tr2.querySelector('[data-act="toggle"]').click();
  await until(async () => (await sql('select attended from participants where id=$1', [target.id]))[0].attended === true,
    { label: 'tandai hadir' });
  check('aksi Hadir bekerja', true);
}

console.log('== 13. admin.html — import Excel (header sinonim, tanpa dobel)');
{
  const XLSX = admin.window.XLSX;
  const ws = XLSX.utils.aoa_to_sheet([
    ['Nama Lengkap', 'Nomor HP', 'Asal / Divisi'],
    ['Import Satu', '08170000111', 'Divisi Baru'],
    ['Import Dua', '+62 817-0000-222', 'Divisi Baru'],
    ['Budi Santoso', '081234567890', 'Divisi TI']
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Undangan');
  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
  const file = new admin.window.File([bytes], 'undangan.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const input = admin.$('#file-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new admin.window.Event('change', { bubbles: true }));

    await until(() => /baris siap diimport/.test(admin.text('#import-preview')), { label: 'pratinjau' });
  check('pratinjau import mendeteksi header', /Nama Lengkap/.test(admin.text('#import-preview')),
    admin.text('#import-preview').slice(0, 120));

  click(admin, '#btn-import-go');
  await until(() => /undangan diimport/.test(admin.text('#import-preview')), { label: 'hasil import' });
  check('import: 2 baru, 1 duplikat dilewati', /2 undangan diimport/.test(admin.text('#import-preview')),
    admin.text('#import-preview').slice(0, 160));
  const baru = (await sql("select * from participants where name='Import Satu'"))[0];
  check('peserta import memakai nomor 1-500', baru?.invited === true && baru.lottery_no <= 500,
    JSON.stringify(baru));
  check('token unik 16 hex', /^[0-9a-f]{16}$/.test(baru.token));
}

console.log('== 14. admin.html — QR, kartu undangan, template');
{
  click(admin, '#tab-undangan');
  await until(() => admin.document.querySelectorAll('#inv-sheet .card15').length > 0, { label: 'kartu' });
  const cards = admin.document.querySelectorAll('#inv-sheet .card15');
  check('kartu undangan dibuat', cards.length >= 5, String(cards.length));
  check('kartu memakai ukuran 10x15 cm (card15)', cards[0].classList.contains('card15'));
  check('2 kartu per baris untuk kertas A4',
    admin.window.getComputedStyle(admin.$('#inv-sheet')).gridTemplateColumns.split(' ').length <= 2 ||
    /100mm/.test(admin.window.getComputedStyle(admin.$('#inv-sheet')).gridTemplateColumns),
    admin.window.getComputedStyle(admin.$('#inv-sheet')).gridTemplateColumns);
  check('kartu tidak mencetak nomor undian', !/Nomor undian Andal|\b\d{3}\b.*Nomor undian/.test(admin.$('#inv-sheet').textContent));
  check('keterangan jumlah lembar A4 tampil', /lembar A4/.test(admin.text('#card-count')), admin.text('#card-count'));
  const html = admin.$('#inv-sheet').innerHTML;
  check('kartu memuat nama acara', html.includes('Perayaan Natal'));
  check('kartu memuat nama peserta', html.includes('Budi Santoso'));
  check('kartu memuat QR (data URI)', html.includes('data:image/png'));
  check('kartu mencantumkan petunjuk nomor undian setelah pindai',
    html.includes('Nomor undian muncul setelah pindai'));

  // susunan cetak: bawaan 4 kartu per lembar A4
  check('susunan bawaan 4 kartu/A4', admin.$('#inv-sheet').classList.contains('inv-sheet--a4-4'),
    admin.$('#inv-sheet').className);
  const pagesA4 = [...admin.document.querySelectorAll('#inv-sheet .page')];
  check('kartu dikelompokkan per lembar A4 (4 kartu/lembar)',
    pagesA4.length >= 1 && pagesA4[0].querySelectorAll('.card15').length === 4,
    pagesA4.map((p) => p.querySelectorAll('.card15').length).join(','));
  check('keterangan ukuran kartu 9,5 x 14,25 cm tampil',
    /9,5 × 14,25 cm/.test(admin.text('#card-size-note')), admin.text('#card-size-note'));
  check('keterangan jumlah lembar A4 tampil',
    /lembar A4/.test(admin.text('#card-count')) && /4 kartu\/lembar/.test(admin.text('#card-count')),
    admin.text('#card-count'));

  // ganti ke 2 kartu/A4 (kartu tepat 10x15 cm)
  admin.$('#card-layout').value = 'a4-2';
  admin.$('#card-layout').dispatchEvent(new admin.window.Event('change', { bubbles: true }));
  await sleep(120);
  check('mode 2 kartu/A4: kelas berubah', admin.$('#inv-sheet').classList.contains('inv-sheet--a4-2'));
  {
    const perLembar = [...admin.document.querySelectorAll('#inv-sheet .page')]
      .map((p) => p.querySelectorAll('.card15').length);
    check('mode 2 kartu/A4: maksimal 2 kartu per lembar',
      Math.max(...perLembar) === 2 && perLembar.length === Math.ceil(perLembar.reduce((a, b) => a + b, 0) / 2),
      perLembar.join(','));
  }
  check('mode 2 kartu/A4: ukuran kartu 10 x 15 cm',
    /10 × 15 cm/.test(admin.text('#card-size-note')), admin.text('#card-size-note'));

  // 4 kartu/A3 (ukuran asli, lembar lebih besar)
  admin.$('#card-layout').value = 'a3-4';
  admin.$('#card-layout').dispatchEvent(new admin.window.Event('change', { bubbles: true }));
  await sleep(120);
  check('mode 4 kartu/A3: kelas berubah', admin.$('#inv-sheet').classList.contains('inv-sheet--a3-4'));

  // kembali ke 4 kartu/A4 untuk uji cetak
  admin.$('#card-layout').value = 'a4-4';
  admin.$('#card-layout').dispatchEvent(new admin.window.Event('change', { bubbles: true }));
  await sleep(120);

  // pratinjau siap cetak: popup diblokir -> berkas .html cetak diunduh
  {
    usePage(admin);
    const blobs = [];
    const createAsli = URL.createObjectURL;
    URL.createObjectURL = (blob) => { blobs.push(blob); return createAsli.call(URL, blob); };
    const openAsli = admin.window.open;
    admin.window.open = () => null;
    admin.window.__downloaded = '';
    click(admin, '#btn-preview-cards');
    await until(() => /10x15/.test(String(admin.window.__downloaded || '')), { label: 'berkas cetak' });
    await sleep(200);
    URL.createObjectURL = createAsli;
    admin.window.open = openAsli;

    const berkas = blobs.length ? await new Promise((resolve) => {
      const reader = new admin.window.FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve('');
      reader.readAsText(blobs[0]);
    }) : '';
    check('pratinjau cetak menghasilkan berkas .html',
      /kartu-undangan-10x15/.test(String(admin.window.__downloaded)), String(admin.window.__downloaded));
    // CSS kartu diambil dari styles.css (di jsdom, cssRules bisa kosong)
    check('berkas cetak berisi kartu 10x15 cm', /card15/.test(berkas), berkas.slice(0, 80));
    check('berkas cetak memakai lembar (.page) + CSS', /class="page"/.test(berkas) && /<style>/.test(berkas));
    check('berkas cetak memakai susunan 4 kartu/A4', /inv-sheet--a4-4/.test(berkas));
    check('berkas cetak menyebut ukuran kertas A4', /size: A4/i.test(berkas));
    check('berkas cetak memuat QR asli tiap tamu',
      (berkas.match(/data:image\/png/g) || []).length >= 2);
    check('berkas cetak memuat petunjuk skala 100%', /100%/.test(berkas));
  }

  click(admin, '#btn-general-qr');
  await until(() => admin.$('#qr-preview').innerHTML.includes('QR umum'), { label: 'qr umum' });
  check('QR umum meja registrasi tampil', /data:image\/png/.test(admin.$('#qr-preview').innerHTML));

  admin.window.__downloaded = '';
  click(admin, '#btn-template');
  await until(() => /template/.test(String(admin.window.__downloaded || '')), { label: 'template' });
  check('template Excel dapat diunduh', true);

  admin.window.__downloaded = '';
  click(admin, '#btn-links-xlsx');
  await until(() => /link-undangan/.test(String(admin.window.__downloaded || '')), { label: 'link xlsx' });
  check('Excel link undangan (blast WA) dapat diunduh', true);

  // ZIP QR (JSZip di-stub: jsdom tidak punya stream untuk kompresi)
  admin.window.__downloaded = '';
  admin.$('#btn-qr-zip').click();
    await until(() => /qr-undangan/.test(String(admin.window.__downloaded || '')), { timeout: 15000, label: 'zip qr' });
  const zipFiles = admin.window.__zipFiles || [];
  const peserta = (await sql('select count(*)::int c from participants'))[0].c;
  check('ZIP QR: satu PNG per peserta + daftar CSV',
    zipFiles.filter((f) => f.endsWith('.png')).length === peserta && zipFiles.includes('daftar-qr.csv'),
    `${zipFiles.length} berkas untuk ${peserta} peserta`);
  check('nama berkas QR memakai nama peserta',
    zipFiles.some((f) => f.startsWith('Budi_Santoso')), zipFiles.slice(0, 3).join(', '));
}

console.log('== 15. admin.html — hadiah & pengaturan');
{
  click(admin, '#tab-hadiah');
  await sleep(150);
  check('daftar hadiah tampil', admin.$('#prize-list').textContent.includes('Kulkas'));
  admin.$('#prize-name').value = 'Sepeda';
  admin.$('#prize-qty').value = '1';
  fire(admin, '#prize-form');
  await until(async () => (await sql("select 1 from prizes where name='Sepeda'")).length === 1, { label: 'hadiah baru' });
  check('tambah hadiah bekerja', true);

  click(admin, '#tab-setting');
  await sleep(150);
  check('peringatan PIN bawaan tampil', admin.visible('pin-warning'));
  check('status absensi ditampilkan', /DIBUKA/.test(admin.text('#attendance-state')));

  admin.$('#event-name-input').value = 'Natal Keluarga Besar 2026';
  click(admin, '#btn-save-event');
  await until(async () => (await sql("select value from settings where key='event_name'"))[0].value.includes('Keluarga'),
    { label: 'nama acara' });
  check('nama acara tersimpan', true);

  click(admin, '#btn-toggle-open');
  await until(async () => (await sql("select value from settings where key='attendance_open'"))[0].value === 'false',
    { label: 'absensi ditutup' });
  check('tombol Buka/Tutup absensi bekerja', true);
  click(admin, '#btn-toggle-open');
  await until(async () => (await sql("select value from settings where key='attendance_open'"))[0].value === 'true',
    { label: 'absensi dibuka' });
  check('absensi bisa dibuka lagi', true);
}

console.log('== 16. Undian');
let draw;
{
  draw = await runPage('undian.html');
  await until(() => draw.visible('view-login'), { label: 'login undian' });
  draw.$('#pin-input').value = 'admin1234';
  fire(draw, '#login-form');
    await until(() => draw.visible('view-screen'), { label: 'layar undian' });

  check('nama acara tampil', /Keluarga/.test(draw.text('#event-title')), draw.text('#event-title'));
  check('hadiah terpilih otomatis', /Kulkas/.test(draw.text('#prize-title')), draw.text('#prize-title'));
  check('sisa pemenang ditampilkan', /Sisa 2/i.test(draw.text('#prize-sub')), draw.text('#prize-sub'));
  const kandidat = Number(draw.text('#candidate-badge').replace(/\D/g, ''));
  const hadirDiServer = (await sql('select count(*)::int c from participants where attended'))[0].c;
  check('kandidat = peserta hadir', kandidat === hadirDiServer, `${kandidat} vs ${hadirDiServer}`);

  click(draw, '#btn-start');
  await until(() => !draw.$('#btn-confirm').classList.contains('hidden'), { timeout: 20000, label: 'hasil undian' });
  const digits = ['d0', 'd1', 'd2'].map((id) => draw.$('#' + id).textContent).join('');
  check('tiga digit terisi', /^\d{3}$/.test(digits), digits);
  check('nama pemenang tampil', draw.text('#winner-name').length > 3, draw.text('#winner-name'));
  check('tombol Konfirmasi & Undi Ulang muncul',
    !draw.$('#btn-confirm').classList.contains('hidden') && !draw.$('#btn-redraw').classList.contains('hidden'));

  const winnerName = draw.text('#winner-name').split(' — ')[0];
  const wRow = (await sql('select attended from participants where name=$1', [winnerName]))[0];
  check('pemenang adalah peserta hadir', wRow?.attended === true, winnerName);

  const before = (await sql('select count(*)::int c from winners'))[0].c;
  click(draw, '#btn-confirm');
  await until(async () => (await sql('select count(*)::int c from winners'))[0].c > before,
    { timeout: 8000, label: 'pemenang tersimpan' });
  check('Konfirmasi Pemenang tersimpan di server', true);
  const saved = (await sql("select status from winners order by drawn_at desc limit 1"))[0];
  check('status confirmed', saved.status === 'confirmed');
  await until(() => /Sisa 1/i.test(draw.text('#prize-sub')), { label: 'sisa 1' });
  check('sisa pemenang berkurang', true);
}

console.log('== 17. Undian — Hadir di tempat & satu orang satu hadiah');
{
  click(draw, '#btn-start');
  await until(() => !draw.$('#btn-redraw').classList.contains('hidden'), { timeout: 20000, label: 'undian kedua' });
  click(draw, '#btn-redraw');
  await until(async () => (await sql("select count(*)::int c from winners where status='absent'")).length >= 1,
    { timeout: 8000, label: 'absent' });
  check('undi ulang mencatat status absent', true);

  const menang = (await sql("select participant_id from winners where status='confirmed' limit 1"))[0];
  const prizeId = (await sql('select id from prizes limit 1'))[0].id;
  const dup = await rpc('draw_record', {
    p_pin: 'admin1234', p_id: 'aaaaaaaa-0000-0000-0000-000000000001',
    p_prize_id: prizeId, p_participant: menang.participant_id,
    p_status: 'confirmed', p_drawn_at: new Date().toISOString()
  });
  check('server menolak peserta menang dua kali', dup.ok === false && dup.status === 'already_won',
    JSON.stringify(dup));
}

console.log('== 18. Undian — berjalan penuh tanpa internet');
{
  const storage = {};
  for (let i = 0; i < draw.window.localStorage.length; i++) {
    const k = draw.window.localStorage.key(i);
    storage[k] = JSON.parse(draw.window.localStorage.getItem(k));
  }
  const offline = await runPage('undian.html', {
    storage,
    fetch: () => Promise.reject(new TypeError('Failed to fetch'))
  });
  await until(() => offline.visible('view-screen'), { label: 'layar undian offline' });
  check('layar undian terbuka tanpa internet', true);
  check('kandidat dari penyimpanan lokal', /[1-9]\d* kandidat/.test(offline.text('#candidate-badge')),
    offline.text('#candidate-badge'));

  const before = (await sql('select count(*)::int c from winners'))[0].c;
  click(offline, '#btn-start');
  await until(() => !offline.$('#btn-confirm').classList.contains('hidden'), { timeout: 20000, label: 'undian offline' });
  click(offline, '#btn-confirm');
  await until(() => Number(offline.text('#queue-badge').replace(/\D/g, '')) >= 1, { label: 'antrean' });
  check('hasil disimpan lokal saat offline', true);
  check('server belum menerima hasil', (await sql('select count(*)::int c from winners'))[0].c === before);
  check('pemenang lokal ditandai belum tersinkron',
    /belum tersinkron/.test(offline.$('#winner-list-side').textContent));

  setFetchForAll(pgFetch);
  offline.window.dispatchEvent(new offline.window.Event('online'));
  await until(async () => (await sql('select count(*)::int c from winners'))[0].c > before,
    { timeout: 12000, label: 'sinkron hasil' });
  check('hasil tersinkron otomatis setelah sinyal kembali', true);
  await until(() => Number(offline.text('#queue-badge').replace(/\D/g, '')) === 0,
    { timeout: 8000, label: 'antrean kosong' }).catch(() => {});
  check('antrean undian kosong setelah sinkron',
    Number(offline.text('#queue-badge').replace(/\D/g, '')) === 0);
}

console.log('== 18b. Halaman peserta tanpa internet');
{
  const budi = globalThis.__budi;
  // penyimpanan berisi token agar QR cadangan bisa ditampilkan
  const owner = await runPage('index.html', { query: `?t=${budi.token}`, storage: { staff_pin: 'staff1234' } });
  const storage = {};
  for (let i = 0; i < owner.window.localStorage.length; i++) {
    const k = owner.window.localStorage.key(i);
    storage[k] = JSON.parse(owner.window.localStorage.getItem(k));
  }
  owner.close();

  const page = await runPage('index.html', {
    query: `?t=${budi.token}`,
    storage,
    fetch: () => Promise.reject(new TypeError('Failed to fetch'))
  });
  await until(() => page.visible('view-offline'), { label: 'layar offline peserta' });
  const text = page.document.body.textContent;
  check('pesan "Tidak ada koneksi" tampil', /Tidak ada koneksi/i.test(text));
  check('arahan "Tunjukkan QR ini ke petugas" tampil', /Tunjukkan QR undangan ini ke petugas/i.test(text));
  check('QR cadangan dirender', /data:image\/png/.test(page.$('#offline-qr').innerHTML));
  check('tidak ada nomor undian yang bocor saat offline', !page.visible('view-success'));
  page.close();
}

console.log('== 19. Keamanan & absensi ditutup');
{
  const direct = await (async () => {
    await db.exec('set role anon');
    try { return await db.query('select * from participants'); }
    catch (e) { return e.message; }
    finally { await db.exec('reset role'); }
  })();
  check('anon tidak bisa membaca tabel peserta langsung',
    typeof direct === 'string' || direct.rows.length === 0, JSON.stringify(direct).slice(0, 80));

  await rpc('admin_set_setting', { p_pin: 'admin1234', p_key: 'attendance_open', p_value: 'false' });
  const closed = await rpc('walkin_register', { p_name: 'Saat Tutup', p_phone: '08170009999', p_org: '', p_family: 0 });
  check('form umum ditolak saat absensi ditutup',
    closed.status === 'closed' && /ditutup/i.test(closed.message), JSON.stringify(closed));
  const budi = globalThis.__budi;
  await sql("update participants set attended=false, attended_at=null where id=$1", [budi.id]);
  const closedInvite = await rpc('confirm_attendance', { p_token: budi.token });
  check('scan undangan ditolak saat absensi ditutup', closedInvite.status === 'closed');
  check('tidak tercatat hadir', (await sql('select attended from participants where id=$1', [budi.id]))[0].attended === false);
  await rpc('admin_set_setting', { p_pin: 'admin1234', p_key: 'attendance_open', p_value: 'true' });

  // halaman peserta saat absensi ditutup menampilkan pesan jelas
  await rpc('admin_set_setting', { p_pin: 'admin1234', p_key: 'attendance_open', p_value: 'false' });
  const page = await runPage('index.html', { query: `?t=${budi.token}` });
  await until(() => page.visible('view-invite'), { label: 'undangan (ditutup)' });
  check('halaman peserta menampilkan "Absensi sedang ditutup"', page.visible('invite-closed'));
  check('tombol konfirmasi dinonaktifkan', page.$('#btn-confirm').disabled === true);
  check('pilihan keluarga/kupon disembunyikan saat absensi ditutup',
    page.visible('invite-extras') === false);
  page.close();
  await rpc('admin_set_setting', { p_pin: 'admin1234', p_key: 'attendance_open', p_value: 'true' });
}


console.log('== 20. Form peserta — keluarga (maks 5), kupon makan & souvenir');
{
  const page0 = await runPage('index.html', {});
  await until(() => page0.visible('view-form'), { label: 'form umum' });
  const opts = [...page0.$('#f-family').querySelectorAll('option')].map((o) => o.value);
  check('dropdown keluarga 0-5', opts.join(',') === '0,1,2,3,4,5', opts.join(','));
  check('jumlah keluarga memakai dropdown', page0.$('#f-family').tagName === 'SELECT');
  check('checkbox kupon makan & souvenir ada',
    Boolean(page0.$('#f-meal')) && Boolean(page0.$('#f-souvenir')));
  check('label checkbox sesuai permintaan',
    page0.$('#walkin-form').textContent.includes('Kupon Makan') &&
    page0.$('#walkin-form').textContent.includes('Souvenir'));

  const sel = page0.$('#f-family');
  const pilih = (v) => {
    sel.value = v;
    sel.dispatchEvent(new page0.window.Event('change', { bubbles: true }));
  };
  pilih('3');
  await sleep(60);
  check('kolom nama muncul sesuai jumlah',
    page0.document.querySelectorAll('#family-names [data-family-name]').length === 3);
  pilih('0');
  await sleep(60);
  check('kolom nama disembunyikan saat 0', page0.visible('family-names-wrap') === false);

  page0.$('#f-name').value = 'Ratna Keluarga';
  page0.$('#f-phone').value = '0813 4444 5555';
  page0.$('#f-org').value = 'Wilayah Medan Baru';
  pilih('2');
  await sleep(60);
  const nameInputs = [...page0.document.querySelectorAll('#family-names [data-family-name]')];
  nameInputs[0].value = 'Yosef';
  nameInputs[1].value = 'Maria';
  page0.$('#f-meal').checked = true;
  page0.$('#f-souvenir').checked = false;
  fire(page0, '#walkin-form');
  await until(() => page0.visible('view-success'), { label: 'sukses walk-in' });

  const row = (await sql("select * from participants where phone='081344445555'"))[0];
  check('jumlah keluarga tersimpan', row && row.family_count === 2, String(row && row.family_count));
  check('kupon makan tersimpan', row && row.wants_meal === true);
  check('souvenir tidak dicentang -> false', row && row.wants_souvenir === false);
  const names = row
    ? (await sql('select name from family_members where participant_id=$1 order by position', [row.id])).map((x) => x.name)
    : [];
  check('nama anggota keluarga tersimpan berurutan', names.join(',') === 'Yosef,Maria', names.join(','));

  const extras = page0.$('#success-extras').textContent;
  check('layar sukses menampilkan jumlah keluarga', /2 anggota keluarga/.test(extras), extras);
  check('layar sukses menampilkan kupon makan', /Kupon makan/.test(extras), extras);
  page0.close();

  const paksa = await rpc('walkin_register', {
    p_name: 'Rombongan Besar', p_phone: '081355550000', p_org: null, p_family: 5,
    p_meal: true, p_souvenir: true,
    p_family_names: JSON.stringify(['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7'])
  });
  const fam = await sql('select count(*)::int c from family_members where participant_id=$1', [paksa.id]);
  check('server memotong anggota keluarga jadi 5', fam[0].c === 5, String(fam[0].c));
}

console.log('== 21. Admin & petugas — kupon, souvenir, anggota keluarga');
{
  usePage(admin);
  click(admin, '#tab-rekap');
  await sleep(200);
  click(admin, '#btn-add-person');
  await until(() => admin.visible('dialog-person'), { label: 'dialog tambah' });
  admin.$('#p-name').value = 'Tamu Meja VIP';
  admin.$('#p-phone').value = '081377778888';
  admin.$('#p-org').value = 'Meja VIP';
  admin.$('#p-family').value = '1';
  admin.$('#p-meal').checked = true;
  admin.$('#p-souvenir').checked = true;
  fire(admin, '#person-form');
  await until(async () => (await sql("select 1 from participants where phone='081377778888'")).length === 1,
    { label: 'peserta manual baru' });
  const vip = (await sql("select * from participants where phone='081377778888'"))[0];
  check('admin: tambah manual menyimpan kupon', vip.wants_meal === true && vip.wants_souvenir === true);
  check('admin: tambah manual menyimpan keluarga', vip.family_count === 1);

  await until(() => admin.$('#rekap-body').textContent.includes('Tamu Meja VIP'), { label: 'baris tabel' });
  check('tabel rekap menampilkan kolom konsumsi',
    /Konsumsi/.test(admin.$('#panel-rekap').textContent) && /Makan/.test(admin.$('#rekap-body').textContent));

  admin.document.querySelector(`#rekap-body [data-act="edit"][data-id="${vip.id}"]`)?.click();
  await until(() => admin.visible('dialog-edit'), { label: 'dialog edit' });
  admin.$('#e-family').value = '2';
  admin.$('#e-family-names').value = 'Sari, , sari, Bayu';
  admin.$('#e-meal').checked = false;
  admin.$('#e-souvenir').checked = true;
  fire(admin, '#edit-form');
  await until(async () => (await sql('select family_count from participants where id=$1', [vip.id]))[0].family_count === 2,
    { label: 'edit tersimpan' });
  const names = (await sql('select name from family_members where participant_id=$1 order by position', [vip.id]))
    .map((x) => x.name);
  check('edit: nama keluarga dirapikan & duplikat dibuang', names.join(',') === 'Sari,Bayu', names.join(','));
  const vip2 = (await sql('select * from participants where id=$1', [vip.id]))[0];
  check('edit: kupon bisa dibatalkan', vip2.wants_meal === false && vip2.wants_souvenir === true);

  await sleep(700);
  const totals = (await rpc('admin_get_all', { p_pin: 'admin1234' })).totals;
  check('stat kupon makan = totals.meal_with_family',
    admin.text('#s-meal') === String(totals.meal_with_family),
    `${admin.text('#s-meal')} vs ${totals.meal_with_family}`);
  check('stat souvenir = totals.souvenir_with_family',
    admin.text('#s-souvenir') === String(totals.souvenir_with_family),
    `${admin.text('#s-souvenir')} vs ${totals.souvenir_with_family}`);
  check('stat total jiwa hadir tampil', Number(admin.text('#s-people')) === totals.people_present,
    admin.text('#s-people'));

  // tangkap isi berkas CSV (modul memakai URL.createObjectURL milik Node)
  const blobs = [];
  const createAsli = URL.createObjectURL;
  URL.createObjectURL = (blob) => { blobs.push(blob); return createAsli.call(URL, blob); };
  admin.window.__downloaded = '';
  click(admin, '#btn-csv');
  await until(() => String(admin.window.__downloaded || '').endsWith('.csv'), { label: 'unduh csv' });
  await sleep(200);
  URL.createObjectURL = createAsli;
  const csv = blobs.length ? await new Promise((resolve) => {
    const reader = new admin.window.FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => resolve('');
    reader.readAsText(blobs[0]);
  }) : '';
  check('CSV memuat kolom Kupon Makan', /Kupon Makan/.test(csv));
  check('CSV memuat kolom Souvenir', /Souvenir/.test(csv));
  check('CSV memuat kolom Anggota Keluarga', /Anggota Keluarga/.test(csv));
  check('CSV berisi nama anggota keluarga', /Sari/.test(csv) && /Bayu/.test(csv), csv.slice(0, 160));

  usePage(staff);
  click(staff, '#tab-tambah');
  await sleep(200);
  staff.$('#add-name').value = 'Petugas Kupon';
  staff.$('#add-phone').value = '081399990000';
  staff.$('#add-family').value = '3';
  staff.$('#add-meal').checked = true;
  staff.$('#add-souvenir').checked = true;
  fire(staff, '#add-form');
  await until(() => /Petugas Kupon/.test(staff.$('#add-result').textContent), { label: 'hasil tambah' });
  const hasil = staff.$('#add-result').textContent;
  check('petugas: ringkasan keluarga & kupon tampil',
    /3 keluarga/.test(hasil) && /Kupon makan/.test(hasil) && /Souvenir/.test(hasil), hasil.slice(0, 160));

  await until(async () => (await sql("select 1 from participants where name='Petugas Kupon'")).length === 1,
    { label: 'sinkron peserta petugas', timeout: 8000 });
  const st = (await sql("select * from participants where name='Petugas Kupon'"))[0];
  check('petugas: kupon & souvenir sampai ke server', st.wants_meal === true && st.wants_souvenir === true);
  check('petugas: jumlah keluarga sampai ke server', st.family_count === 3, String(st.family_count));
}


console.log('== 22. Undangan (QR kartu) — dropdown keluarga & checkbox kupon/souvenir');
{
  // tamu undangan baru: 2 keluarga bernama, centang kupon makan & souvenir
  const imp = await rpc('admin_import', {
    p_pin: 'admin1234',
    p_rows: JSON.stringify([{ name: 'Yohana Undangan', phone: '081388887777', org: 'Keluarga Besar' }])
  });
  check('import tamu undangan untuk uji', imp.inserted === 1, JSON.stringify(imp));
  const tamu = (await sql("select * from participants where phone='081388887777'"))[0];

  const page = await runPage('index.html', { query: `?t=${tamu.token}` });
  await until(() => page.visible('view-invite'), { label: 'layar undangan' });

  const opts = [...page.$('#i-family').querySelectorAll('option')].map((o) => o.value);
  check('undangan punya dropdown keluarga 0-5', opts.join(',') === '0,1,2,3,4,5', opts.join(','));
  check('undangan punya checkbox kupon makan & souvenir',
    Boolean(page.$('#i-meal')) && Boolean(page.$('#i-souvenir')));
  const labelUndangan = page.$('#view-invite').textContent;
  check('label undangan menyebut Kupon Makan & Souvenir',
    /Kupon Makan/.test(labelUndangan) && /Souvenir/.test(labelUndangan));

  const sel = page.$('#i-family');
  sel.value = '2';
  sel.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  await sleep(60);
  const boxes = [...page.document.querySelectorAll('#i-family-names [data-family-name]')];
  check('kolom nama keluarga muncul di layar undangan', boxes.length === 2, String(boxes.length));
  boxes[0].value = 'Hana';
  boxes[1].value = 'Yosua';
  page.$('#i-meal').checked = true;
  page.$('#i-souvenir').checked = true;

  click(page, '#btn-confirm');
  await until(() => page.visible('view-success'), { label: 'sukses undangan' });

  const row = (await sql('select * from participants where id=$1', [tamu.id]))[0];
  check('undangan: hadir tercatat', row.attended === true);
  check('undangan: jumlah keluarga tersimpan', row.family_count === 2, String(row.family_count));
  check('undangan: kupon makan & souvenir tersimpan',
    row.wants_meal === true && row.wants_souvenir === true);
  const names = (await sql('select name from family_members where participant_id=$1 order by position', [tamu.id]))
    .map((x) => x.name);
  check('undangan: nama anggota keluarga tersimpan', names.join(',') === 'Hana,Yosua', names.join(','));

  const extras = page.$('#success-extras').textContent;
  check('undangan: layar sukses menampilkan keluarga', /2 anggota keluarga/.test(extras), extras);
  check('undangan: layar sukses menampilkan kupon & souvenir',
    /Kupon makan/.test(extras) && /Souvenir/.test(extras), extras);
  page.close();

  // scan ulang: keluarga & kupon tetap tampil di layar "sudah tercatat hadir"
  const page2 = await runPage('index.html', { query: `?t=${tamu.token}` });
  await until(() => page2.visible('view-already'), { label: 'layar sudah hadir' });
  check('scan ulang undangan: nomor sama',
    page2.text('#already-no') === String(tamu.lottery_no).padStart(3, '0'), page2.text('#already-no'));
  const extras2 = page2.$('#already-extras').textContent;
  check('scan ulang undangan: ringkasan kupon tetap tampil',
    /2 anggota keluarga/.test(extras2) && /Kupon makan/.test(extras2), extras2);
  page2.close();

  // kupon dari halaman undangan masuk hitungan rekap admin
  const all = await rpc('admin_get_all', { p_pin: 'admin1234' });
  check('rekap admin menghitung kupon dari jalur undangan',
    all.totals.meal >= 1 && all.totals.meal_with_family >= 3,
    JSON.stringify({ meal: all.totals.meal, mealFam: all.totals.meal_with_family }));
  const rec = all.participants.find((x) => x.id === tamu.id);
  check('rekap admin memuat nama keluarga tamu undangan',
    Array.isArray(rec.family_names) && rec.family_names.join(',') === 'Hana,Yosua',
    JSON.stringify(rec.family_names));
}


console.log('== 23. Admin — reset data (regresi "DELETE requires a WHERE clause")');
{
  usePage(admin);
  click(admin, '#tab-setting');
  await sleep(200);

  const adaPeserta = (await sql('select count(*)::int c from participants'))[0].c;
  check('ada data sebelum reset', adaPeserta > 0, String(adaPeserta));

  // prompt dua langkah: tombol reset semua mensyaratkan kata "HAPUS SEMUA"
  let promptTerakhir = '';
  const setPrompt = (nilai) => {
    const fn = (msg) => { promptTerakhir = msg; return nilai; };
    admin.window.prompt = fn;
    globalThis.prompt = fn;
  };
  const setConfirm = (nilai) => { admin.window.confirm = () => nilai; globalThis.confirm = () => nilai; };
  setPrompt('HAPUS SEMUA');
  setConfirm(true);

  admin.document.querySelector('[data-reset="all"]').click();
  await until(async () => (await sql('select count(*)::int c from participants'))[0].c === 0,
    { label: 'reset semua dari UI', timeout: 8000 });
  check('reset semua dari panel admin berhasil (tanpa error WHERE)', true);
  check('prompt konfirmasi menyebut HAPUS SEMUA', /HAPUS SEMUA/.test(promptTerakhir), promptTerakhir);
  check('hadiah ikut kosong', (await sql('select count(*)::int c from prizes'))[0].c === 0);
  check('anggota keluarga ikut kosong',
    (await sql('select count(*)::int c from family_members'))[0].c === 0);
  check('pesan sukses tampil di panel', /Reset SEMUA data selesai/i.test(admin.document.body.textContent));

  // setelah reset, impor lagi & reset absensi lewat UI
  await rpc('admin_import', {
    p_pin: 'admin1234',
    p_rows: JSON.stringify([{ name: 'Uji Setelah Reset', phone: '081255557777', org: 'Uji' }])
  });
  const tok = (await sql("select token from participants where phone='081255557777'"))[0].token;
  await rpc('confirm_attendance', { p_token: tok });
  check('hadir tercatat sebelum reset absensi',
    (await sql('select attended from participants'))[0].attended === true);

  setPrompt('RESET');
  admin.document.querySelector('[data-reset="attendance"]').click();
  await until(async () => (await sql('select count(*)::int c from participants where attended'))[0].c === 0,
    { label: 'reset absensi dari UI', timeout: 8000 });
  check('reset absensi dari panel admin berhasil', true);
  check('peserta undangan tetap ada',
    (await sql('select count(*)::int c from participants'))[0].c === 1);
}


console.log('== 24. Petugas — PWA (pasang aplikasi) & izin kamera');
{
  // 1) banner pasang aplikasi muncul di tab browser biasa
  const page = await runPage('petugas.html', {
    storage: { staff_pin: JSON.stringify('staff1234') },
    beforeModules(w) {
      // tiru peramban yang mendukung pemasangan PWA
      w.__installPrompt = null;
      w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
      // jsdom belum punya mediaDevices: tiru API kamera
      if (!w.navigator.mediaDevices) {
        Object.defineProperty(w.navigator, 'mediaDevices', {
          configurable: true,
          value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) }
        });
      }
    }
  });
  await until(() => page.visible('view-app'), { label: 'aplikasi petugas' });
  // peramban memicu ajakan pemasangan (di HP nyata: sebelum/saat halaman dimuat)
  page.window.dispatchEvent(new page.window.Event('beforeinstallprompt'));
  await until(() => page.visible('install-banner'), { label: 'banner pasang aplikasi' });
  check('banner pasang aplikasi tampil di tab browser', page.visible('install-banner'));
  check('banner menjelaskan manfaat kamera/offline',
    /kamera|offline/i.test(page.text('#install-banner-text')), page.text('#install-banner-text'));

  // tutup banner -> diingat
  click(page, '#btn-install-close');
  await sleep(80);
  check('banner bisa ditutup', !page.visible('install-banner'));
  check('pilihan tutup diingat di penyimpanan',
    JSON.parse(page.window.localStorage.getItem('staff_install_dismiss') || 'false') === true,
    String(page.window.localStorage.getItem('staff_install_dismiss')));

  // 2) saat sudah terpasang (standalone) banner tidak muncul
  const standalone = await runPage('petugas.html', {
    storage: { staff_pin: JSON.stringify('staff1234') },
    beforeModules(w) {
      w.matchMedia = (q) => ({ matches: /display-mode:\s*standalone/.test(q), media: q,
        addEventListener() {}, removeEventListener() {} });
    }
  });
  await until(() => standalone.visible('view-app'), { label: 'aplikasi (standalone)' });
  await sleep(200);
  check('mode terpasang: banner tidak ditampilkan', !standalone.visible('install-banner'));
  standalone.close();

  // 3) diagnosa izin kamera
  usePage(page);
  click(page, '#tab-scan');
  await sleep(150);
  page.$('#cam-diagnose').open = true;
  page.$('#cam-diagnose').dispatchEvent(new page.window.Event('toggle'));
  await until(() => /HTTPS|Izin kamera/i.test(page.text('#cam-check-list')), { label: 'daftar periksa' });
  const cek = page.text('#cam-check-list');
  check('diagnosa memeriksa HTTPS', /HTTPS/i.test(cek), cek.slice(0, 120));
  check('diagnosa memeriksa izin kamera', /Izin kamera/i.test(cek), cek.slice(0, 120));
  check('diagnosa menyebut status terpasang/tab browser',
    /tab browser|terpasang/i.test(cek), cek.slice(0, 160));

  // 4) uji kamera: izin ditolak -> pesan jelas
  globalThis.navigator.mediaDevices.getUserMedia = async () => {
    const e = new Error('Permission denied'); e.name = 'NotAllowedError'; throw e;
  };
  click(page, '#btn-cam-test');
  await until(() => /izin|kamera/i.test(page.text('#cam-test-result')), { label: 'hasil uji kamera' });
  check('uji kamera: izin ditolak -> panduan pengaturan',
    /dit(ola|olak)/i.test(page.text('#cam-test-result')), page.text('#cam-test-result'));

  // 5) uji kamera: izin diberikan -> dihentikan lagi (uji saja)
  let dihentikan = false;
  globalThis.navigator.mediaDevices.getUserMedia = async () => ({
    getTracks: () => [{ stop: () => { dihentikan = true; } }]
  });
  click(page, '#btn-cam-test');
  await until(() => /berhasil/i.test(page.text('#cam-test-result')), { label: 'kamera ok' });
  check('uji kamera berhasil -> izin tersimpan', /berhasil/i.test(page.text('#cam-test-result')));
  check('uji kamera mematikan stream setelah diuji', dihentikan === true);

  // 6) petunjuk pasang manual
  click(page, '#btn-cam-reinstall');
  await sleep(80);
  check('petunjuk pasang Android tampil',
    /Pasang aplikasi|Layar utama/i.test(page.document.body.textContent));
  click(page, '#btn-cam-reinstall-ios');
  await sleep(80);
  check('petunjuk pasang iPhone tampil',
    /Tambah ke Layar Utama/i.test(page.document.body.textContent));
  page.close();
}


console.log('== 25. Layar undian — salju bergerak');
{
  const salju = await runPage('undian.html');
  await until(() => salju.$('#snowfall'), { label: 'kanvas salju' });

  check('kanvas salju ada di halaman undian', Boolean(salju.$('#snowfall')));
  check('kanvas tidak menangkap sentuhan (pointer-events none)',
    /pointer-events:\s*none/.test(readFileSync(join(ROOT, 'styles.css'), 'utf8').match(/\.snowfall\s*\{[^}]*\}/)[0]));
  check('lapisan salju CSS lama tetap ada',
    Boolean(salju.document.querySelector('.snow')));

  // butir salju dilukis (arc/fill terpanggil) setelah beberapa frame
  await until(() => (salju.window.__canvasCalls?.fill || 0) > 0, { label: 'salju dilukis' });
  const calls = salju.window.__canvasCalls;
  check('butir salju dilukis di kanvas', calls.arc > 20 && calls.fill > 20,
    `arc=${calls.arc} fill=${calls.fill}`);
  check('kanvas diskalakan mengikuti devicePixelRatio',
    calls.setTransform > 0 && salju.$('#snowfall').width >= salju.window.innerWidth,
    `${salju.$('#snowfall').width}x${salju.$('#snowfall').height}`);

  // salju bergerak turun
  const posisi = () => (salju.window.__snowY = salju.$('#snowfall').dataset.y);
  const frameAwal = calls.fill;
  await sleep(400);
  check('animasi berjalan terus (requestAnimationFrame)',
    calls.fill > frameAwal, `${frameAwal} -> ${calls.fill}`);

  // lapisan salju berada di atas latar tapi di bawah isi layar
  const css = readFileSync(join(ROOT, 'styles.css'), 'utf8');
  check('z-index salju di bawah panel layar',
    /\.snowfall\s*\{[^}]*z-index:\s*2/.test(css) && /body\.screen \.screen-grid[^{]*\{[^}]*z-index:\s*5/.test(css));

  // elemen salju tidak mengganggu pembaca layar
  check('salju disembunyikan dari pembaca layar',
    salju.$('#snowfall').getAttribute('aria-hidden') === 'true');

  salju.close();

  // prefers-reduced-motion: salju tampil tetapi tidak bergerak
  const diam = await runPage('undian.html', {
    beforeModules(w) {
      const asli = w.matchMedia;
      w.matchMedia = (q) => (/prefers-reduced-motion/.test(q)
        ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} }
        : asli.call(w, q));
    }
  });
  await sleep(500);
  const c1 = diam.window.__canvasCalls?.fill || 0;
  await sleep(400);
  const c2 = diam.window.__canvasCalls?.fill || 0;
  check('reduced-motion: salju digambar sekali (tidak beranimasi)', c1 > 0 && c2 === c1, `${c1} -> ${c2}`);
  diam.close();
}

console.log('== 26. Petugas — diagnosa "schema" / sambungan database');
{
  // 0) PIN uji khusus: PIN bawaan sudah diganti oleh bagian 7/12, jadi tes tidak
  //    boleh bersandar pada 'staff1234'. (PIN ini dipakai sampai akhir berkas.)
  check('PIN uji petugas dipasang', (await rpc('admin_change_pin', {
    p_pin: 'admin1234', p_target: 'staff', p_new_pin: 'diag9999' })).ok === true);

  // 1) HAPPY PATH: server sehat -> semua baris ✅ dan fungsi database dikenali
  const page = await runPage('petugas.html');
  await until(() => page.visible('view-app'), { label: 'aplikasi petugas' });
  usePage(page);
  click(page, '#btn-db-test');
  await until(() => /normal|masalah|catatan/i.test(page.text('#db-test-result')), { label: 'hasil diagnosa' });
  const daftar = page.text('#db-check-list');
  check('diagnosa: melaporkan alamat proyek', /Alamat proyek/i.test(daftar), daftar.slice(0, 160));
  check('diagnosa: melaporkan koneksi server', /Server Supabase terhubung/i.test(daftar), daftar.slice(0, 160));
  check('diagnosa: menyebut fungsi event_info() jalan', /event_info\(\) jalan/i.test(daftar), daftar.slice(0, 160));
  check('diagnosa: menyebut jumlah peserta lokal', /peserta tersimpan di HP ini/i.test(daftar), daftar.slice(0, 160));
  check('diagnosa: server normal -> tidak ada ❌', !/❌/.test(daftar) && !/PIN salah/i.test(daftar), daftar);
  check('diagnosa: tombol tes melaporkan hasil', /✅|⚠️|❌/.test(page.text('#db-test-result')),
    page.text('#db-test-result'));
  check('banner pasang aplikasi ada di luar <main> (terlihat juga di layar login)',
    page.$('#install-banner')?.parentElement?.tagName === 'BODY');
  page.close();

  // 2) SKEMA BELUM TERPASANG: PostgREST menjawab 404 PGRST202
  const tanpaSkema = await runPage('petugas.html', {
    fetch: async () => jsonRes({
      code: 'PGRST202',
      message: 'Could not find the function public.event_info in the schema cache',
      hint: 'Perhaps you need to reload the schema cache'
    }, 404)
  });
  await until(() => /HTTP 404/i.test(tanpaSkema.text('#db-check-list')), { label: 'diagnosa skema' });
  const pesan1 = tanpaSkema.text('#db-check-list');
  check('skema hilang: pesan menyebut schema cache + Reload', /schema cache/i.test(pesan1) && /Reload/i.test(pesan1),
    pesan1.slice(0, 300));
  check('skema hilang: tidak menyuruh "jalankan schema.sql" untuk kasus cache',
    !/belum terpasang\.\s*Jalankan/i.test(pesan1), pesan1.slice(0, 300));
  tanpaSkema.close();

  // 3) FUNGSI MEMANG BELUM ADA: -> arahkan menjalankan schema.sql
  const belumAda = await runPage('petugas.html', {
    fetch: async () => jsonRes({
      code: '42883', message: 'function public.event_info() does not exist'
    }, 404)
  });
  await until(() => /belum terpasang|schema\.sql/i.test(belumAda.text('#db-check-list')),
    { label: 'diagnosa fungsi hilang' });
  check('fungsi hilang: menyuruh menjalankan schema.sql versi terbaru',
    /schema\.sql/i.test(belumAda.text('#db-check-list')), belumAda.text('#db-check-list').slice(0, 300));
  belumAda.close();

  // 4) KUNCI API SALAH: 401 -> bukan salahkan skema
  const kunciSalah = await runPage('petugas.html', {
    fetch: async () => jsonRes({ message: 'Invalid API key' }, 401)
  });
  await until(() => /Kunci API ditolak|kunci akses/i.test(kunciSalah.text('#db-check-list')),
    { label: 'diagnosa kunci' });
  const pesan4 = kunciSalah.text('#db-check-list');
  check('kunci salah: menyebut kunci API ditolak', /Kunci API ditolak/i.test(pesan4), pesan4.slice(0, 240));
  check('kunci salah: menyebut config.js', /config\.js/i.test(pesan4), pesan4.slice(0, 240));
  check('kunci salah: tidak menyalahkan schema.sql', !/schema\.sql/i.test(pesan4), pesan4.slice(0, 240));
  kunciSalah.close();
}

console.log('== 27. Diagnosa kolom hilang & schema_check()');
{
  // 1) "column ... does not exist" -> pesan menyebut rinciannya, dan saran menjalankan schema.sql
  const kolom = await runPage('petugas.html', {
    fetch: async (url, opts) => {
      if (/\/rest\/v1\/?$/.test(String(url))) return jsonRes({ info: {} }, 200);
      return jsonRes({
        code: '42703',
        message: 'column p.wants_souvenir does not exist'
      }, 400);
    }
  });
  await until(() => /wants_souvenir/.test(kolom.text('#db-check-list')), { label: 'diagnosa kolom' });
  const t1 = kolom.text('#db-check-list');
  check('kolom hilang: rincian kolom ikut ditampilkan', /column p\.wants_souvenir does not exist/.test(t1),
    t1.slice(0, 240));
  check('kolom hilang: saran menjalankan schema.sql versi terbaru',
    /schema\.sql/.test(t1) && /versi terbaru|aman diulang/i.test(t1), t1.slice(0, 320));
  kolom.close();

  // 2) skema versi lama: schema_check() belum ada -> saran menjalankan schema.sql
  const lama = await runPage('petugas.html', {
    fetch: async (url) => {
      const u = String(url);
      if (/\/rest\/v1\/?$/.test(u)) return jsonRes({ info: {} }, 200);
      if (/schema_check/.test(u)) {
        return jsonRes({ code: 'PGRST202', message: 'Could not find the function public.schema_check in the schema cache' }, 404);
      }
      return pgFetch(url);
    }
  });
  await until(() => /schema_check/.test(lama.text('#db-check-list')), { label: 'schema_check versi lama' });
  check('skema lama: mendeteksi schema_check() belum ada',
    /schema_check\(\) belum ada|schema_check/i.test(lama.text('#db-check-list')), lama.text('#db-check-list').slice(0, 240));
  lama.close();

  // 3) server normal: schema_check() dari database asli -> "Struktur ... lengkap"
  const sehat = await runPage('petugas.html');
  await until(() => /Struktur tabel & fungsi database lengkap/i.test(sehat.text('#db-check-list')),
    { label: 'schema_check normal' });
  check('schema_check: database lengkap dilaporkan ✅',
    /✅ Struktur tabel & fungsi database lengkap/i.test(sehat.text('#db-check-list')),
    sehat.text('#db-check-list').slice(0, 240));
  sehat.close();
}

console.log(`\n${pass} lulus, ${fails.length} gagal`);
if (fails.length) { console.log('Gagal:'); fails.forEach((f) => console.log(' - ' + f)); }
process.exit(fails.length ? 1 : 0);
