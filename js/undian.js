/* ==========================================================================
   js/undian.js — LAYAR UNDIAN untuk proyektor
   * Pemenang dipilih dengan acak KRIPTOGRAFIS (crypto.getRandomValues +
     rejection sampling). Animasi slot hanya tampilan.
   * Hasil disimpan lokal lebih dulu, lalu dikirim ke server lewat antrean
     ber-UUID (idempoten). Bisa berjalan penuh tanpa internet.
   ========================================================================== */
import { api } from '../api.js';
import {
  pad3, esc, toast, uuid, cryptoRandomInt, store, online, fmtTime, $, $$
} from '../util.js';

const K = {
  pin: 'admin_pin',
  snapshot: 'draw_snapshot',   // { event_name, prizes, candidates, winners, saved_at }
  results: 'draw_results',     // hasil lokal (belum/masih perlu sinkron)
  queue: 'draw_queue',
  prize: 'draw_prize_id'
};

const S = {
  pin: '',
  eventName: 'Perayaan Natal',
  prizes: [],
  candidates: [],   // peserta hadir
  winners: [],      // { id, prize_id, participant_id, status, drawn_at, synced }
  results: [],      // hasil yang dikunci di layar (termasuk yang belum tersinkron)
  queue: [],        // antrean kirim ke server
  current: null,    // hadiah aktif
  picked: null,     // peserta terpilih (belum dikonfirmasi)
  spinning: false,
  syncing: false,
  timer: null
};

/* ============================================================ penyimpanan */
function loadLocal() {
  const snap = store.get(K.snapshot, null);
  if (snap) {
    S.eventName = snap.event_name || S.eventName;
    S.prizes = snap.prizes || [];
    S.candidates = snap.candidates || [];
    S.winners = snap.winners || [];
  }
  S.results = store.get(K.results, []) || [];
  S.queue = store.get(K.queue, []) || [];
  // gabungkan hasil lokal yang belum ada di daftar pemenang server
  for (const r of S.results) {
    if (!S.winners.some((w) => w.id === r.id)) S.winners.push({ ...r, local: true });
  }
}

function saveLocal() {
  store.set(K.snapshot, {
    event_name: S.eventName,
    prizes: S.prizes,
    candidates: S.candidates,
    winners: S.winners.filter((w) => !w.local),
    saved_at: new Date().toISOString()
  });
  store.set(K.results, S.results);
  store.set(K.queue, S.queue);
}

/* ================================================================ utilitas */
const confirmedWinners = () => S.winners.filter((w) => w.status === 'confirmed');
const absentIds = () => new Set(S.winners.filter((w) => w.status === 'absent').map((w) => w.participant_id));
const wonIds = () => new Set(confirmedWinners().map((w) => w.participant_id));

function countFor(prizeId) {
  return confirmedWinners().filter((w) => w.prize_id === prizeId).length;
}

function remaining(prize) {
  return Math.max(0, (prize?.qty || 0) - countFor(prize?.id));
}

/** Kandidat sah: hadir, belum menang, belum ditandai tidak hadir. */
function eligibleCandidates() {
  const won = wonIds();
  const absent = absentIds();
  return S.candidates.filter((p) => !won.has(p.id) && !absent.has(p.id));
}

function picked3(no) { return pad3(no).split(''); }

/* ============================================================== tampilan */
function setNet(ok) {
  const b = document.getElementById('net-badge');
  if (!b) return;
  b.textContent = ok ? 'Online' : 'Offline';
  b.className = `badge ${ok ? 'badge--online' : 'badge--offline'}`;
}

function renderChrome() {
  document.getElementById('event-title').textContent = S.eventName || 'Perayaan Natal';

  const sel = document.getElementById('prize-select');
  const prev = S.current?.id || store.get(K.prize, '');
  sel.innerHTML = S.prizes.map((z) => {
    const left = remaining(z);
    return `<option value="${esc(z.id)}" ${left === 0 ? 'disabled' : ''}>
      ${esc(z.name)}${left === 0 ? ' (selesai)' : ` — sisa ${left}`}
    </option>`;
  }).join('') || '<option value="">Belum ada hadiah</option>';
  if (prev && S.prizes.some((z) => z.id === prev)) sel.value = prev;

  S.current = S.prizes.find((z) => z.id === sel.value) || S.prizes.find((z) => remaining(z) > 0) || null;
  if (S.current && sel.value !== S.current.id) sel.value = S.current.id;

  renderPrizeHeader();
  renderSidebar();
  renderQueue();
}

function renderPrizeHeader() {
  const title = document.getElementById('prize-title');
  const sub = document.getElementById('prize-sub');
  const cand = document.getElementById('candidate-badge');
  if (S.current) {
    const left = remaining(S.current);
    title.textContent = S.current.name;
    sub.textContent = left > 0
      ? `Sisa ${left} pemenang dari ${S.current.qty} · ${eligibleCandidates().length} kandidat`
      : 'Semua pemenang hadiah ini sudah terundi — pilih hadiah lain';
  } else {
    title.textContent = 'Pilih hadiah untuk mulai';
    sub.textContent = S.prizes.length ? 'Semua hadiah sudah terundi' : 'Belum ada hadiah — tambahkan di panel admin';
  }
  cand.textContent = `${eligibleCandidates().length} kandidat`;
}

function renderSidebar() {
  const list = document.getElementById('winner-list-side');
  const prizeName = new Map(S.prizes.map((z) => [z.id, z.name]));
  const items = S.winners
    .filter((w) => w.status === 'confirmed')
    .slice()
    .sort((a, b) => new Date(a.drawn_at) - new Date(b.drawn_at));

  if (!items.length) {
    list.innerHTML = '<li style="list-style:none;opacity:.7">Belum ada</li>';
    return;
  }
  list.innerHTML = items.map((w) => {
    const p = S.candidates.find((x) => x.id === w.participant_id) || {};
    return `<li>${esc(p.name || 'Peserta')} <span style="opacity:.7">· ${esc(pad3(p.lottery_no))}</span>
      <div style="font-size:.72em;opacity:.65">${esc(prizeName.get(w.prize_id) || '')}${w.local ? ' · belum tersinkron' : ''}</div></li>`;
  }).join('');
}

function renderQueue() {
  const b = document.getElementById('queue-badge');
  const n = S.queue.length;
  b.textContent = `Antrean ${n}`;
  b.className = `badge ${n ? 'badge--queue' : 'badge--plain'}`;
}

function setDigits(values, { locked = false } = {}) {
  values.forEach((v, i) => {
    const el = document.getElementById(`d${i}`);
    el.textContent = v;
    el.classList.toggle('is-locked', locked);
  });
}

function showWinnerInfo(person) {
  const box = document.getElementById('winner-info');
  if (!person) { box.classList.remove('is-on'); return; }
  document.getElementById('winner-name').textContent = `${person.name} — ${pad3(person.lottery_no)}`;
  document.getElementById('winner-org').textContent = person.org || '';
  box.classList.add('is-on');
}

function setControls(state) {
  const start = document.getElementById('btn-start');
  const confirmBtn = document.getElementById('btn-confirm');
  const redraw = document.getElementById('btn-redraw');
  const hint = document.getElementById('screen-hint');

  start.classList.toggle('hidden', state !== 'idle');
  confirmBtn.classList.toggle('hidden', state !== 'picked');
  redraw.classList.toggle('hidden', state !== 'picked');
  document.getElementById('prize-select').disabled = state !== 'idle';

  if (state === 'idle') {
    hint.innerHTML = 'Tekan <span class="kbd">Spasi</span> atau tombol <strong>MULAI</strong>';
  } else if (state === 'spinning') {
    hint.textContent = 'Mengundi…';
  } else {
    hint.innerHTML = 'Konfirmasi bila pemenang hadir di tempat, atau undi ulang bila tidak hadir.';
  }
}

/* ============================================================== konfeti */
function confetti(count = 90) {
  const layer = document.getElementById('confetti');
  // palet kertas–kayu: karamel, krem, bata, olive, cokelat
  const colors = ['#D9A96B', '#EBDECB', '#83322D', '#455026', '#BB9A7C', '#FFFDF7'];
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${cryptoRandomInt(100)}%`;
    piece.style.background = colors[cryptoRandomInt(colors.length)];
    piece.style.animationDuration = `${1.6 + cryptoRandomInt(160) / 100}s`;
    piece.style.animationDelay = `${cryptoRandomInt(60) / 100}s`;
    piece.style.setProperty('--dx', `${cryptoRandomInt(160) - 80}px`);
    piece.style.setProperty('--rot', `${cryptoRandomInt(900)}deg`);
    if (cryptoRandomInt(3) === 0) { piece.style.width = '7px'; piece.style.height = '7px'; piece.style.borderRadius = '50%'; }
    layer.append(piece);
    setTimeout(() => piece.remove(), 3600);
  }
}

/* ============================================================== undian */
function startDraw() {
  if (S.spinning) return;
  if (!S.current) { toast('Pilih hadiah terlebih dahulu.', 'warn'); return; }
  if (remaining(S.current) <= 0) { toast('Semua pemenang hadiah ini sudah terundi.', 'warn'); return; }

  const pool = eligibleCandidates();
  if (!pool.length) {
    toast('Tidak ada kandidat tersisa. Muat data peserta hadir.', 'err', 4500);
    return;
  }

  // 1) PEMENANG DIPILIH LEBIH DULU — acak kriptografis, bukan Math.random
  const winner = pool[cryptoRandomInt(pool.length)];
  S.picked = winner;
  S.spinning = true;
  setControls('spinning');
  showWinnerInfo(null);
  setDigits(['0', '0', '0']);
  $$('.digit').forEach((d) => { d.classList.remove('is-locked'); d.classList.add('is-spinning'); });

  // 2) Animasi slot ±6-8 detik, berhenti satu per satu dari kiri
  const target = picked3(winner.lottery_no);
  const totalMs = 6000 + cryptoRandomInt(2000);
  const stopAt = [totalMs * 0.62, totalMs * 0.81, totalMs];

  for (let i = 0; i < 3; i++) {
    rollDigit(i, target[i], stopAt[i]);
  }

  setTimeout(() => {
    $$('.digit').forEach((d) => d.classList.remove('is-spinning'));
    setDigits(target, { locked: true });
    showWinnerInfo(winner);
    confetti(110);
    S.spinning = false;
    setControls('picked');
  }, totalMs + 60);
}

/** Putar satu digit sampai waktu berhenti, lalu kunci ke nilai target. */
function rollDigit(index, targetChar, durationMs) {
  const el = document.getElementById(`d${index}`);
  const start = performance.now();
  const step = () => {
    const elapsed = performance.now() - start;
    if (elapsed >= durationMs) {
      el.textContent = targetChar;
      el.classList.add('is-locked');
      return;
    }
    // frekuensi melambat mendekati akhir
    const progress = elapsed / durationMs;
    const speed = 60 + 240 * Math.pow(progress, 2.2);
    if (!el._last || performance.now() - el._last > speed) {
      el.textContent = String(cryptoRandomInt(10));
      el._last = performance.now();
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ======================================================== simpan hasil */
function recordResult(status) {
  if (!S.picked || !S.current) return;
  const person = S.picked;
  const rec = {
    id: uuid(),
    prize_id: S.current.id,
    participant_id: person.id,
    status,
    drawn_at: new Date().toISOString(),
    lottery_no: person.lottery_no,
    name: person.name
  };

  // simpan lokal lebih dulu
  S.results.push(rec);
  S.winners.push({ ...rec, local: true });
  S.queue.push(rec);
  saveLocal();

  if (status === 'confirmed') {
    toast(`${person.name} (${pad3(person.lottery_no)}) — ${S.current.name}!`, 'ok', 4200);
  } else {
    toast(`Nomor ${pad3(person.lottery_no)} ditandai tidak hadir. Silakan undi ulang.`, 'warn', 4200);
  }

  S.picked = null;
  setControls('idle');
  showWinnerInfo(null);
  setDigits(['0', '0', '0']);
  renderPrizeHeader();
  renderSidebar();
  renderQueue();

  if (online()) syncResults();
}

async function syncResults() {
  if (S.syncing || !S.queue.length) return;
  if (!online()) { setNet(false); return; }
  S.syncing = true;
  try {
    const batch = S.queue.slice(0, 30);
    for (const rec of batch) {
      try {
        const res = await api.drawRecord(S.pin, {
          id: rec.id, prize_id: rec.prize_id, participant_id: rec.participant_id,
          status: rec.status, drawn_at: rec.drawn_at
        });
        if (res?.ok || res?.already) {
          S.queue = S.queue.filter((q) => q.id !== rec.id);
          const w = S.winners.find((x) => x.id === rec.id);
          if (w) { w.local = false; w.synced = true; }
        } else if (res?.status === 'already_won') {
          // konflik: peserta sudah menang hadiah lain di server
          S.queue = S.queue.filter((q) => q.id !== rec.id);
          toast(res.message || 'Peserta sudah menjadi pemenang hadiah lain.', 'warn', 5000);
        }
      } catch (e) {
        if (e?.code === 'offline') { setNet(false); break; }
        if (e?.code === 'pin_invalid') { toast('PIN admin berubah. Muat ulang halaman.', 'err', 6000); break; }
        // error lain: pertahankan di antrean, coba lagi nanti
      }
    }
    saveLocal();
    renderQueue();
    renderSidebar();
    setNet(true);
  } finally {
    S.syncing = false;
  }
}

/* ============================================================ muat data */
async function loadFromServer(silent = false) {
  try {
    const res = await api.adminGetAll(S.pin);
    if (!res?.ok) throw new Error('Gagal memuat data.');

    S.eventName = res.event_name || S.eventName;
    S.prizes = (res.prizes || []).map((z) => ({ id: z.id, name: z.name, qty: z.qty, sort_order: z.sort_order }));
    S.candidates = (res.participants || [])
      .filter((p) => p.attended)
      .map((p) => ({ id: p.id, name: p.name, org: p.org || '', lottery_no: p.lottery_no }));

    // pemenang dari server + hasil lokal yang belum tersinkron
    const serverWinners = (res.winners || []).map((w) => ({ ...w, local: false, synced: true }));
    const localOnly = S.results.filter((r) => !serverWinners.some((w) => w.id === r.id));
    S.winners = [...serverWinners, ...localOnly.map((r) => ({ ...r, local: true }))];

    saveLocal();
    renderChrome();
    setNet(true);
    if (!silent) toast(`Data dimuat: ${S.candidates.length} peserta hadir, ${S.prizes.length} hadiah.`, 'ok', 3500);
    return true;
  } catch (e) {
    S.lastError = e;
    setNet(e?.code === 'offline' ? false : true);
    if (!silent) toast(e?.message || 'Gagal memuat data.', 'err', 5000);
    return false;
  }
}

/* =============================================================== login */
async function doLogin(pin) {
  const box = document.getElementById('login-error');
  const txt = document.getElementById('login-error-text');
  box.classList.add('hidden');
  const btn = document.getElementById('btn-login');
  btn.disabled = true;
  btn.textContent = 'Memuat data…';

  try {
    // PIN harus diset lebih dulu: loadFromServer memakai S.pin
    S.pin = pin;
    const ok = await loadFromServer(true);
    if (!ok) {
      // sudah pernah memuat data sebelumnya? boleh lanjut offline
      if (!S.candidates.length) {
        txt.textContent = online()
          ? `Gagal memuat data. ${S.lastError?.message || 'Periksa PIN dan koneksi.'}`
          : 'Belum ada data tersimpan di perangkat. Muat data sekali saat ada internet.';
        box.classList.remove('hidden');
        return;
      }
      toast('Mode offline: memakai data terakhir yang tersimpan.', 'warn', 4500);
    }
    store.set(K.pin, pin);
    enterScreen();
  } catch (e) {
    txt.textContent = e?.message || 'PIN salah atau data gagal dimuat.';
    box.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Masuk & Muat Data';
  }
}

function enterScreen() {
  document.getElementById('view-login').classList.add('hidden');
  document.getElementById('view-screen').classList.remove('hidden');
  document.body.classList.add('screen');
  renderChrome();
  setControls('idle');
  setNet(online());

  // auto-sync hasil + mulai timer
  clearInterval(S.timer);
  S.timer = setInterval(() => {
    setNet(online());
    if (online()) syncResults();
  }, 15000);
  if (online()) syncResults();
}

/* =============================================================== layar penuh */
async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch { toast('Peramban menolak mode layar penuh.', 'warn'); }
}

/* ================================================================= event */
function bind() {
  document.getElementById('login-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = document.getElementById('pin-input').value.trim();
    if (pin.length < 4) { toast('PIN minimal 4 karakter.', 'err'); return; }
    doLogin(pin);
  });

  document.getElementById('btn-start')?.addEventListener('click', startDraw);
  document.getElementById('btn-confirm')?.addEventListener('click', () => recordResult('confirmed'));
  document.getElementById('btn-redraw')?.addEventListener('click', () => recordResult('absent'));
  document.getElementById('prize-select')?.addEventListener('change', (e) => {
    S.current = S.prizes.find((z) => z.id === e.target.value) || null;
    store.set(K.prize, e.target.value);
    setDigits(['0', '0', '0']);
    showWinnerInfo(null);
    renderPrizeHeader();
  });
  document.getElementById('btn-refresh-data')?.addEventListener('click', async () => {
    const ok = await loadFromServer(false);
    if (ok) toast('Data disegarkan — hasil lokal dipertahankan.', 'ok', 3000);
    renderChrome();
  });
  document.getElementById('btn-fullscreen')?.addEventListener('click', toggleFullscreen);
  document.getElementById('btn-quit')?.addEventListener('click', () => {
    if (S.queue.length && !confirm(`Masih ada ${S.queue.length} hasil undian belum tersinkron. Keluar?`)) return;
    location.href = './admin.html';
  });

  document.addEventListener('keydown', (e) => {
    const tag = (e.target?.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea'].includes(tag)) return;
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      if (document.getElementById('btn-confirm').classList.contains('hidden')) startDraw();
      else recordResult('confirmed');
    }
    if (e.key === 'r' || e.key === 'R') {
      if (!document.getElementById('btn-redraw').classList.contains('hidden')) recordResult('absent');
    }
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  });

  window.addEventListener('online', () => { setNet(true); syncResults(); });
  window.addEventListener('offline', () => setNet(false));
  window.addEventListener('beforeunload', (e) => {
    if (S.queue.length) { e.preventDefault(); e.returnValue = ''; }
  });
}

/* ================================================================= mulai */
function main() {
  loadLocal();
  bind();
  setNet(online());

  const pin = store.get(K.pin, '');
  if (pin && S.candidates.length) {
    S.pin = pin;
    enterScreen();
    if (online()) { loadFromServer(true).then(() => syncResults()); }
  } else {
    document.getElementById('pin-input').focus();
  }
}

main();
