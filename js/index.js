/* ==========================================================================
   js/index.js — Halaman PESERTA
   Tiga jalur: (1) scan QR undangan sendiri, (2) QR dipindai petugas,
   (3) form tanpa undangan. Satu daftar hadir.
   ========================================================================== */
import { api } from '../api.js';
import { pad3, fmtTime, toast, normPhone, store, online } from '../util.js';
import { qrPngDataUrl } from '../qr.js';

const S = {
  token: '',
  info: null,          // hasil get_invite
  open: true,
  eventName: 'Acara Natal',
  busy: false,
};

const views = ['loading', 'offline', 'invite', 'already', 'success', 'form', 'notfound', 'error'];
const viewEl = (name) => document.getElementById(`view-${name}`);

function show(name) {
  views.forEach((v) => viewEl(v)?.classList.toggle('hidden', v !== name));
  window.scrollTo(0, 0);
}

function setEventName(name) {
  if (!name) return;
  S.eventName = name;
  document.getElementById('event-name').textContent = name;
  document.getElementById('footer-event').textContent = name;
  document.title = `Konfirmasi Kehadiran — ${name}`;
}

function setNet(ok) {
  const b = document.getElementById('net-badge');
  if (!b) return;
  b.textContent = ok ? 'Online' : 'Offline';
  b.className = `badge ${ok ? 'badge--online' : 'badge--offline'}`;
}

/* ------------------------------------------------------------------ token */
function readToken() {
  const params = new URLSearchParams(location.search);
  const t = (params.get('t') || params.get('token') || '').trim().toLowerCase();
  if (/^[0-9a-f]{8,64}$/.test(t)) return t;
  // dukung "#t=..." dan "/?t=..." yang terbaca aneh
  const m = location.href.match(/[?&#]t=([0-9a-fA-F]{8,64})/);
  return m ? m[1].toLowerCase() : '';
}

/* ---------------------------------------------------------------- render */
function renderInvite(info) {
  S.info = info;
  document.getElementById('invite-name').textContent = info.name || '—';
  document.getElementById('invite-org').textContent = info.org ? `dari ${info.org}` : 'Panitia mengundang Anda';
  document.getElementById('invite-org2').textContent = info.org || '—';
  const closed = !info.attendance_open;
  document.getElementById('invite-closed').classList.toggle('hidden', !closed);
  const btn = document.getElementById('btn-confirm');
  btn.disabled = closed;
  btn.textContent = closed ? 'Absensi Ditutup' : 'Konfirmasi Hadir';
  show('invite');
}

/** Ringkasan anggota keluarga + kupon makan + souvenir di layar hasil. */
function renderExtras(id, info = {}) {
  const box = document.getElementById(id);
  if (!box) return;
  const family = Number(info.family ?? info.family_count ?? 0) || 0;
  const meal = Boolean(info.meal ?? info.wants_meal);
  const souvenir = Boolean(info.souvenir ?? info.wants_souvenir);

  const items = [];
  if (family > 0) items.push(`👨‍👩‍👧 ${family} anggota keluarga`);
  if (meal) items.push('🍱 Kupon makan');
  if (souvenir) items.push('🎁 Souvenir');

  box.innerHTML = items.length
    ? `<div class="notice notice--info"><span class="notice__icon" aria-hidden="true">🧾</span>
         <div><strong>Tercatat panitia:</strong> ${items.join(' · ')}.${
           meal || souvenir ? ' Silakan ambil di meja registrasi.' : ''}</div></div>`
    : '';
  box.classList.toggle('hidden', items.length === 0);
}

function renderSuccess({ name, org, lottery_no, preamble, family = 0, meal = false, souvenir = false }) {
  document.getElementById('success-greeting').textContent = preamble || `Selamat datang, ${name}! ✅`;
  document.getElementById('success-sub').textContent = org ? `dari ${org}` : 'Kehadiran Anda berhasil dicatat.';
  document.getElementById('success-no').textContent = pad3(lottery_no);

  renderExtras('success-extras', { family, meal, souvenir });

  show('success');
  document.getElementById('btn-submit')?.blur();
}

function renderAlready(info) {
  document.getElementById('already-time').textContent = fmtTime(info.attended_at);
  document.getElementById('already-no').textContent = pad3(info.lottery_no);
  document.getElementById('already-name').textContent = info.name || '';
  renderExtras('already-extras', info);
  show('already');
}

function renderForm(showClosed) {
  document.getElementById('form-closed').classList.toggle('hidden', !showClosed);
  const submit = document.getElementById('btn-submit');
  submit.disabled = Boolean(showClosed);
  show('form');
}

function renderError(message) {
  document.getElementById('error-message').textContent = message;
  show('error');
}

/** Mode offline: tampilkan QR undangan agar bisa dipindai petugas. */
function renderOffline() {
  const box = document.getElementById('offline-qr');
  box.innerHTML = '';
  const token = S.token || store.get('my_token') || '';
  const inviteUrl = token
    ? `${location.origin}${location.pathname}?t=${token}`
    : `${location.origin}${location.pathname}`;
  try {
    const img = document.createElement('img');
    img.src = qrPngDataUrl(inviteUrl, { size: 320, margin: 2 });
    img.width = 220; img.height = 220;
    img.alt = 'QR undangan Anda';
    img.style.cssText = 'background:#fff;padding:10px;border-radius:12px;image-rendering:pixelated';
    box.append(img);
    if (token) {
      const cap = document.createElement('p');
      cap.className = 'small mono';
      cap.style.cssText = 'margin:8px 0 0;color:var(--ink-soft);word-break:break-all';
      cap.textContent = `Kode undangan: ${token}`;
      box.append(cap);
    }
  } catch { /* QR gagal dibuat: abaikan */ }
  show('offline');
}

/* --------------------------------- anggota keluarga & kupon/souvenir */
/** Buat kolom nama sesuai jumlah anggota keluarga yang dipilih (maks 5). */
function renderFamilyInputs(count) {
  const wrap = document.getElementById('family-names-wrap');
  const box = document.getElementById('family-names');
  if (!wrap || !box) return;

  const n = Math.max(0, Math.min(5, Number(count) || 0));
  wrap.classList.toggle('hidden', n === 0);
  if (n === 0) { box.innerHTML = ''; return; }

  // pertahankan isian yang sudah diketik saat jumlah diubah
  const existing = [...box.querySelectorAll('input')].map((i) => i.value);
  box.innerHTML = Array.from({ length: n }, (_, i) => `
    <label class="field" style="margin:0">
      <div class="family-input-wrap">
        <span class="family-num">${i + 1}.</span>
        <input class="input" data-family-name maxlength="60" autocomplete="off"
               placeholder="Nama anggota keluarga ${i + 1}" value="${existing[i] ? existing[i].replace(/"/g, '&quot;') : ''}">
      </div>
    </label>`).join('');
}

function readFamilyNames() {
  return [...document.querySelectorAll('#family-names [data-family-name]')]
    .map((i) => i.value.trim())
    .filter((v) => v.length >= 2);
}

/* ------------------------------------------------------------------ alur */
async function boot() {
  if (!online()) { setNet(false); renderOffline(); return; }
  setNet(true);

  try {
    const info = await api.eventInfo();
    setEventName(info?.event_name);
    S.open = Boolean(info?.attendance_open);
  } catch (err) {
    // masih bisa lanjut: get_invite juga mengembalikan status absensi
    if (err?.code === 'offline') { setNet(false); renderOffline(); return; }
  }

  if (!S.token) {
    renderForm(!S.open);
    return;
  }

  await loadInvite();
}

async function loadInvite() {
  show('loading');
  try {
    const res = await api.getInvite(S.token);
    setNet(true);
    if (res?.event_name) setEventName(res.event_name);
    S.open = Boolean(res?.attendance_open);

    if (!res || res.ok === false) {
      show('notfound');
      return;
    }
    if (res.status === 'already') { renderAlready(res); return; }
    renderInvite(res);
  } catch (err) {
    if (err?.code === 'offline' || !online()) { setNet(false); renderOffline(); return; }
    if (/tidak ditemukan/i.test(err?.message || '')) { show('notfound'); return; }
    renderError(err?.message || 'Gagal memuat undangan.');
  }
}

async function confirmAttendance() {
  if (S.busy) return;
  S.busy = true;
  const btn = document.getElementById('btn-confirm');
  btn.disabled = true;
  btn.textContent = 'Memproses…';
  try {
    const res = await api.confirmAttendance(S.token);
    setNet(true);

    if (res?.status === 'already') {
      renderAlready(res);
      return;
    }
    if (res?.status === 'closed') {
      S.open = false;
      document.getElementById('invite-closed').classList.remove('hidden');
      toast('Absensi sedang ditutup.', 'warn');
      btn.textContent = 'Absensi Ditutup';
      return;
    }
    if (res?.ok === false) {
      if (res.status === 'not_found') { show('notfound'); return; }
      toast(res.message || 'Gagal mencatat kehadiran.', 'err');
      return;
    }

    renderSuccess({
      name: res.name,
      org: res.org,
      lottery_no: res.lottery_no,
      preamble: `Selamat datang, ${res.name}! ✅`
    });
    store.set('last_attendance', { name: res.name, lottery_no: res.lottery_no, at: res.attended_at });
  } catch (err) {
    if (err?.code === 'offline') {
      setNet(false);
      toast('Koneksi terputus. Tunjukkan QR Anda ke petugas.', 'warn', 5000);
      renderOffline();
    } else {
      toast(err?.message || 'Gagal mencatat kehadiran.', 'err', 5000);
    }
  } finally {
    S.busy = false;
    btn.disabled = false;
    btn.textContent = 'Konfirmasi Hadir';
  }
}

async function submitWalkin(ev) {
  ev.preventDefault();
  if (S.busy) return;

  const name = document.getElementById('f-name').value.trim();
  const phoneRaw = document.getElementById('f-phone').value.trim();
  const phone = normPhone(phoneRaw);
  const org = document.getElementById('f-org').value.trim();
  const family = Math.min(5, Number(document.getElementById('f-family').value || 0));
  const familyNames = readFamilyNames();
  const meal = document.getElementById('f-meal').checked;
  const souvenir = document.getElementById('f-souvenir').checked;

  if (name.length < 2) {
    toast('Nama lengkap wajib diisi (minimal 2 huruf).', 'err');
    document.getElementById('f-name').focus();
    return;
  }
  if (!phone) {
    toast('Nomor HP/WA wajib diisi dengan benar, contoh 0812xxxxxxx.', 'err');
    document.getElementById('f-phone').focus();
    return;
  }

  S.busy = true;
  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.textContent = 'Memproses…';

  try {
    const res = await api.walkinRegister(name, phone, org, family, meal, souvenir, familyNames);
    setNet(true);

    if (res?.ok === false) {
      if (res.status === 'closed') {
        document.getElementById('form-closed').classList.remove('hidden');
        btn.textContent = 'Absensi Ditutup';
        toast('Absensi sedang ditutup.', 'warn');
        return;
      }
      toast(res.message || 'Pendaftaran gagal.', 'err', 5000);
      return;
    }

    if (res.merged) {
      // Data cocok dengan undangan -> memakai nomor undangan tersebut
      if (res.status === 'already') {
        renderAlready({ name: res.name, attended_at: res.attended_at, lottery_no: res.lottery_no });
      } else {
        renderSuccess({
          name: res.name, org: res.org, lottery_no: res.lottery_no,
          preamble: `Selamat datang, ${res.name}! ✅`
        });
        toast('Data Anda digabungkan dengan undangan yang sudah terdaftar.', 'ok', 4500);
      }
      return;
    }

    renderSuccess({
      name: res.name, org: res.org, lottery_no: res.lottery_no,
      preamble: `Selamat datang, ${res.name}! ✅`,
      family: res.family_count || 0,
      meal: Boolean(res.wants_meal),
      souvenir: Boolean(res.wants_souvenir)
    });
  } catch (err) {
    if (err?.code === 'offline') {
      setNet(false);
      toast('Tidak ada koneksi. Silakan daftar lewat petugas registrasi.', 'warn', 6000);
    } else {
      toast(err?.message || 'Pendaftaran gagal.', 'err', 5000);
    }
  } finally {
    S.busy = false;
    btn.disabled = false;
    btn.textContent = 'Konfirmasi Hadir';
  }
}

/* ------------------------------------------------------------------ event */
function bind() {
  document.getElementById('btn-confirm')?.addEventListener('click', confirmAttendance);
  document.getElementById('f-family')?.addEventListener('change', (e) => renderFamilyInputs(e.target.value));
  document.getElementById('walkin-form')?.addEventListener('submit', submitWalkin);
  document.getElementById('btn-retry')?.addEventListener('click', () => boot());
  document.getElementById('btn-retry2')?.addEventListener('click', () => boot());
  document.getElementById('btn-reload')?.addEventListener('click', () => {
    if (S.token) location.reload();
    else { location.href = location.pathname; }
  });
  document.getElementById('btn-goto-form')?.addEventListener('click', (e) => {
    e.preventDefault();
    history.replaceState(null, '', location.pathname);
    S.token = '';
    boot();
  });

  window.addEventListener('online', () => { setNet(true); boot(); });
  window.addEventListener('offline', () => setNet(false));
}

/* ------------------------------------------------------------------ start */
S.token = readToken();
bind();

// Simpan token agar mode offline tahu QR mana yang harus ditampilkan
if (S.token) store.set('my_token', S.token);

boot();

// Daftarkan service worker agar undangan tetap bisa dibuka tanpa sinyal
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* diabaikan */ });
  });
}
