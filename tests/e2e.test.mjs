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
        const self = this;
        return {
          fillStyle: '', fillRect() {}, drawImage() {}, clearRect() {},
          getImageData: () => ({ data: new Uint8ClampedArray(4) }),
          putImageData() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}
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
  for (const name of ['document', 'window', 'localStorage', 'sessionStorage', 'location', 'navigator']) {
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
  await until(() => admin.document.querySelectorAll('#inv-sheet .inv-card').length > 0, { label: 'kartu' });
  const cards = admin.document.querySelectorAll('#inv-sheet .inv-card');
  check('kartu undangan dibuat', cards.length >= 5, String(cards.length));
  const html = admin.$('#inv-sheet').innerHTML;
  check('kartu memuat nama acara', html.includes('Perayaan Natal'));
  check('kartu memuat nama peserta', html.includes('Budi Santoso'));
  check('kartu memuat QR (data URI)', html.includes('data:image/png'));
  check('kartu mencantumkan "Nomor undian muncul setelah scan"',
    html.includes('Nomor undian muncul setelah scan'));

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

console.log(`\n${pass} lulus, ${fails.length} gagal`);
if (fails.length) { console.log('Gagal:'); fails.forEach((f) => console.log(' - ' + f)); }
process.exit(fails.length ? 1 : 0);
