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
  countdown: null
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

function findPerson({ token, phone, name } = {}) {
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
    family_names: Array.isArray(p.family_names) ? p.family_names : []
  }));

  // Pertahankan aksi lokal yang belum tersinkron
  for (const item of S.queue) {
    if (item.kind === 'attend') {
      const p = incoming.find((x) => (item.token && x.token === item.token) || x.id === item.participant_id);
      if (p) { p.attended = true; p.attended_at = p.attended_at || item.attended_at; }
    } else if (item.kind === 'new') {
      if (!incoming.some((x) => x.lottery_no === item.lottery_no)) {
        incoming.push({
          id: item.local_id, token: item.token, name: item.name, org: item.org || '',
          phone: item.phone || '', family_count: item.family_count || 0, invited: false,
          lottery_no: item.lottery_no, attended: true, attended_at: item.attended_at,
          source: 'petugas', wants_meal: Boolean(item.wants_meal),
          wants_souvenir: Boolean(item.wants_souvenir), family_names: []
        });
      }
    }
  }

  S.people = incoming.sort((a, b) => a.lottery_no - b.lottery_no);
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

  attendPerson(person, 'petugas');
}

function attendPerson(person, source) {
  const at = new Date().toISOString();
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
    source
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
  if (fam > 0) {
    const names = Array.isArray(person.family_names) ? person.family_names : [];
    bits.push(`👨‍👩‍👧 ${fam} keluarga${names.length ? ` (${esc(names.join(', '))})` : ''}`);
  }
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
    wants_meal: meal, wants_souvenir: souvenir, family_names: []
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
      wants_souvenir: Boolean(q.wants_souvenir),
      family_names: Array.isArray(q.family_names) ? q.family_names : null
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
    if (person) attendPerson(person, 'petugas');
  });

  document.getElementById('add-form')?.addEventListener('submit', submitAdd);

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

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* diabaikan */ });
  }
}

main();
