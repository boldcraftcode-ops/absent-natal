/* ==========================================================================
   js/absen-tamu.js — halaman absensi untuk PETUGAS yang ponselnya tidak bisa
   memakai pemindai QR di dalam browser (petugas.html).

   Alur:
     1. Petugas memindai QR dengan aplikasi KAMERA BAWAAN ponsel.
        - QR umum meja registrasi -> membuka absen.html (halaman ini)
        - QR undangan tamu       -> membuka index.html (halaman tamu)
     2. absen.html punya DUA TAB:
          • Tamu undangan       -> cari & pilih nama dari rekap, nomor undian lama dipakai
          • Tamu tanpa undangan -> isi nama + HP, dapat nomor baru
     3. Nomor undian tampil besar untuk disebutkan ke tamu.

   Tidak butuh kamera & tidak butuh pustaka QR. Daftar undangan diambil sekali
   lewat staff_data(PIN) lalu disimpan di HP, sehingga pencarian tetap jalan
   walau sinyal di lokasi lemah.
   ========================================================================== */
import { api, isConfigured } from '../api.js';
import { pad3, fmtTime, esc, toast, normPhone, store, online } from '../util.js';

const K = { pin: 'absen_pin', data: 'absen_people', at: 'absen_at' };

const S = {
  pin: '',
  masuk: false,
  open: true,
  eventName: 'Acara Natal',
  all: [],          // semua peserta dari staff_data
  hasil: [],        // hasil filter
  terpilih: null,
  busy: false
};

const $ = (id) => document.getElementById(id);
const viewEl = (n) => $('view-' + n);

function show(name) {
  ['gate', 'absen', 'error'].forEach((v) => viewEl(v)?.classList.toggle('hidden', v !== name));
  window.scrollTo(0, 0);
}

function setNet(ok) {
  const b = $('net-badge');
  if (!b) return;
  b.textContent = ok ? 'Online' : 'Offline';
  b.className = 'badge ' + (ok ? 'badge--online' : 'badge--offline');
}

function setEventName(name) {
  if (!name) return;
  S.eventName = name;
  $('event-name').textContent = name;
  $('footer-event').textContent = name;
  document.title = `Absensi Tamu — ${name}`;
}

/* -------------------------------------------------------------- gerbang PIN */
async function masukDenganPin(pin, { diam = false } = {}) {
  const err = $('gate-error');
  if (err) err.classList.add('hidden');
  try {
    const res = await api.staffData(pin);
    if (!res?.ok) throw new Error(res?.message || 'PIN ditolak.');
    S.pin = pin;
    S.masuk = true;
    S.open = Boolean(res.attendance_open);
    setEventName(res.event_name);
    S.all = (res.participants || []).slice().sort((a, b) => a.lottery_no - b.lottery_no);
    store.set(K.pin, pin);
    store.set(K.data, S.all);
    store.set(K.at, new Date().toISOString());
    bukaAbsen();
    return true;
  } catch (e) {
    if (!diam) {
      const pesan = e?.code === 'offline'
        ? 'Tidak ada koneksi. Sambungkan internet untuk masuk pertama kali.'
        : (e?.message || 'PIN tidak dapat diperiksa.');
      if (err) { err.textContent = pesan; err.classList.remove('hidden'); }
      toast(pesan, 'err', 5000);
    }
    return false;
  }
}

function bukaAbsen() {
  show('absen');
  const jam = store.get(K.at, '');
  const info = $('daftar-info');
  if (info) {
    info.textContent = `${S.all.length} undangan dimuat`
      + (jam ? ` (${fmtTime(jam)})` : '') + ' · data tersimpan di HP ini.';
  }
  filterDaftar();
  setTab('undangan');
}

/* ---------------------------------------------------------------- dua tab */
function setTab(tab) {
  for (const key of ['undangan', 'baru']) {
    $('panel-' + key)?.classList.toggle('hidden', key !== tab);
    const btn = $('tab-' + key);
    if (btn) btn.setAttribute('aria-selected', key === tab ? 'true' : 'false');
  }
  S.tab = tab;
  if (tab === 'baru') setTimeout(() => $('b-name')?.focus(), 60);
}

/* -------------------------------------------------- tab 1: daftar undangan */
function filterDaftar() {
  const q = ($('cari-nama')?.value || '').trim().toLowerCase();
  const qDigit = normPhone(q);
  const dasar = S.all;
  const hasil = !q ? dasar : dasar.filter((p) =>
    String(p.name || '').toLowerCase().includes(q)
    || String(p.org || '').toLowerCase().includes(q)
    || (qDigit && String(p.phone || '').includes(qDigit))
    || pad3(p.lottery_no) === q
    || String(p.lottery_no) === q);
  S.hasil = hasil.slice(0, 60);

  const sel = $('pilih-nama');
  if (sel) {
    sel.innerHTML = '<option value="">— Pilih nama tamu —</option>'
      + S.hasil.map((p) => `<option value="${esc(p.id)}">${esc(pad3(p.lottery_no))} · ${esc(p.name)}`
        + `${p.org ? ' — ' + esc(p.org) : ''}${p.attended ? ' ✓ sudah hadir' : ''}</option>`).join('');
    sel.value = '';
  }
  const info = $('daftar-info');
  if (info) {
    const semua = S.all.length;
    const belum = S.all.filter((p) => !p.attended).length;
    info.textContent = !semua
      ? 'Daftar undangan belum tersimpan di HP ini. Sambungkan internet lalu muat ulang.'
      : (q ? `${S.hasil.length} hasil untuk “${q}”` : `${semua} undangan · ${belum} belum hadir`)
        + (q && !S.hasil.length ? ' — coba kata kunci lain, atau pakai tab "Tamu tanpa undangan".' : '');
  }
  $('kartu-undangan')?.classList.add('hidden');
  S.terpilih = null;
}

function pilihTamu(id) {
  const box = $('kartu-undangan');
  if (!box) return;
  if (!id) { box.classList.add('hidden'); box.innerHTML = ''; S.terpilih = null; return; }
  const p = S.hasil.find((x) => String(x.id) === String(id)) || S.all.find((x) => String(x.id) === String(id));
  if (!p) return;
  S.terpilih = p;

  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="notice ${p.attended ? 'notice--warn' : 'notice--info'}" style="margin-bottom:12px">
      <span class="notice__icon" aria-hidden="true">${p.attended ? '⚠️' : '🎫'}</span>
      <div>
        <strong>${esc(p.name)}</strong> — nomor undian <strong>${esc(pad3(p.lottery_no))}</strong>
        <div class="small">${p.org ? esc(p.org) + ' · ' : ''}${p.attended
          ? `sudah tercatat hadir pukul ${esc(fmtTime(p.attended_at))}`
          : 'belum hadir'}</div>
      </div>
    </div>`;

  const fam = $('u-family');
  if (fam) fam.value = String(Math.max(0, Math.min(5, p.family_count || 0)));
  const meal = $('u-meal');
  const souv = $('u-souvenir');
  if (meal) meal.checked = Boolean(p.wants_meal);
  if (souv) souv.checked = Boolean(p.wants_souvenir);

  const btn = $('btn-u-simpan');
  if (btn) {
    btn.disabled = false;
    btn.textContent = p.attended ? 'Perbarui data kehadiran' : 'Tandai Hadir';
  }
}

async function simpanUndangan() {
  const p = S.terpilih;
  if (!p) { toast('Pilih nama tamu dulu.', 'warn'); return; }
  if (S.busy) return;
  if (!online()) { toast('Butuh koneksi internet untuk mencatat kehadiran.', 'err', 5000); return; }

  const btn = $('btn-u-simpan');
  S.busy = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Memproses…'; }
  try {
    const res = await api.confirmAttendance(p.token, {
      family: Math.min(5, Number($('u-family')?.value || 0)),
      meal: Boolean($('u-meal')?.checked),
      souvenir: Boolean($('u-souvenir')?.checked)
    });
    setNet(true);

    if (res?.status === 'closed') { toast('Absensi sedang ditutup.', 'warn'); return; }
    if (res?.ok === false) { toast(res.message || 'Gagal mencatat kehadiran.', 'err', 5000); return; }

    tampilkanHasil({
      nama: res.name || p.name,
      org: res.org || p.org,
      no: res.lottery_no ?? p.lottery_no,
      at: res.attended_at,
      sudah: res.status === 'already',
      family: res.family_count ?? Number($('u-family')?.value || 0),
      meal: Boolean(res.wants_meal ?? $('u-meal')?.checked),
      souvenir: Boolean(res.wants_souvenir ?? $('u-souvenir')?.checked)
    });
    // perbarui cache lokal supaya daftar langsung menandai "sudah hadir"
    const i = S.all.findIndex((x) => String(x.id) === String(p.id));
    if (i >= 0) {
      S.all[i].attended = true;
      S.all[i].attended_at = res.attended_at || new Date().toISOString();
      store.set(K.data, S.all);
    }
  } catch (err) {
    if (err?.code === 'offline') {
      setNet(false);
      toast('Koneksi terputus. Coba lagi setelah sinyal kembali.', 'warn', 5000);
    } else {
      toast(err?.message || 'Gagal mencatat kehadiran.', 'err', 5000);
    }
  } finally {
    S.busy = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = S.terpilih?.attended ? 'Perbarui data kehadiran' : 'Tandai Hadir';
    }
  }
}

/* --------------------------------------------- tab 2: tamu tanpa undangan */
async function simpanBaru(ev) {
  ev.preventDefault();
  if (S.busy) return;

  const name = $('b-name').value.trim();
  const phone = normPhone($('b-phone').value.trim());
  const org = $('b-org').value.trim();
  const family = Math.min(5, Number($('b-family')?.value || 0));
  const meal = Boolean($('b-meal')?.checked);
  const souvenir = Boolean($('b-souvenir')?.checked);

  if (name.length < 2) { toast('Nama lengkap wajib diisi (minimal 2 huruf).', 'err'); $('b-name').focus(); return; }
  if (!phone) { toast('Nomor HP/WA wajib diisi, contoh 0812xxxxxxx.', 'err'); $('b-phone').focus(); return; }
  if (!online()) { toast('Butuh koneksi internet untuk mendaftarkan tamu.', 'err', 5000); return; }

  const btn = $('btn-b-simpan');
  S.busy = true;
  btn.disabled = true;
  btn.textContent = 'Memproses…';
  try {
    const res = await api.walkinRegister(name, phone, org, family, meal, souvenir);
    setNet(true);

    if (res?.ok === false) {
      if (res.status === 'closed') { toast('Absensi sedang ditutup.', 'warn'); return; }
      toast(res.message || 'Pendaftaran gagal.', 'err', 5000);
      return;
    }
    tampilkanHasil({
      nama: res.name || name,
      org: res.org || org,
      no: res.lottery_no,
      at: res.attended_at,
      sudah: res.status === 'already',
      digabung: Boolean(res.merged),
      family: res.family_count || family,
      meal: Boolean(res.wants_meal ?? meal),
      souvenir: Boolean(res.wants_souvenir ?? souvenir)
    });
    $('walkin-form').reset();
    $('b-family').value = '0';
    // tamu baru/gabungan: segarkan daftar supaya nomor undian terlihat di tab 1
    muatUlangDiam().catch(() => {});
  } catch (err) {
    if (err?.code === 'offline') {
      setNet(false);
      toast('Koneksi terputus. Coba lagi setelah sinyal kembali.', 'warn', 5000);
    } else {
      toast(err?.message || 'Pendaftaran gagal.', 'err', 5000);
    }
  } finally {
    S.busy = false;
    btn.disabled = false;
    btn.textContent = 'Daftarkan &amp; Tandai Hadir';
  }
}

/* ------------------------------------------------------------------ hasil */
function tampilkanHasil({ nama, org, no, at, sudah, digabung, family, meal, souvenir }) {
  const box = $('hasil');
  if (!box) return;
  const ringkas = [
    family > 0 ? `👨‍👩‍👧 ${family} anggota keluarga` : '',
    meal ? '🍱 Kupon makan' : '',
    souvenir ? '🎁 Souvenir' : ''
  ].filter(Boolean).join(' · ') || 'Tanpa kupon &amp; tanpa keluarga';

  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="card card--ribbon stack center" style="margin-top:14px" role="status" aria-live="polite">
      <div class="participant-hero" style="padding:0;color:var(--ink)">
        <div class="participant-hero__orn" aria-hidden="true">${sudah ? '✅' : '🎉'}</div>
        <h2 style="color:var(--cocoa-800);margin:0">${sudah ? 'Sudah tercatat hadir' : 'Kehadiran tercatat'}</h2>
        <p style="color:var(--ink-soft);margin:4px 0 0">${esc(nama)}${org ? ' · ' + esc(org) : ''}</p>
      </div>
      <div class="number-plate" style="align-self:center">
        <div class="number number--hero">${esc(pad3(no))}</div>
      </div>
      <p class="small" style="margin:0;color:var(--ink-soft)">Sebutkan / tunjukkan nomor ini ke tamu.${
        at ? ` Tercatat pukul ${esc(fmtTime(at))}.` : ''}</p>
      <p class="small" style="margin:0;color:var(--ink-soft)">${ringkas}</p>
      ${digabung ? '<div class="notice notice--info"><span class="notice__icon" aria-hidden="true">🔗</span>'
        + '<div>Data digabung dengan undangan yang sudah terdaftar.</div></div>' : ''}
      <button class="btn btn--outline btn--block" id="btn-hasil-lagi" type="button">Tamu berikutnya</button>
    </div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  $('btn-hasil-lagi')?.addEventListener('click', () => {
    box.classList.add('hidden');
    box.innerHTML = '';
    $('cari-nama').value = '';
    filterDaftar();
    setTab('undangan');
  });
}

/* ------------------------------------------------------------- muat ulang */
async function muatUlangDiam() {
  if (!S.pin) return false;
  try {
    const res = await api.staffData(S.pin);
    if (!res?.ok) return false;
    S.all = (res.participants || []).slice().sort((a, b) => a.lottery_no - b.lottery_no);
    S.open = Boolean(res.attendance_open);
    setEventName(res.event_name);
    store.set(K.data, S.all);
    store.set(K.at, new Date().toISOString());
    filterDaftar();
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------- boot */
function bind() {
  $('pin-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = $('pin-input').value.trim();
    if (pin.length < 4) { toast('PIN minimal 4 karakter.', 'err'); return; }
    masukDenganPin(pin);
  });
  $('btn-ganti-pin')?.addEventListener('click', () => {
    store.del(K.pin);
    S.masuk = false;
    S.pin = '';
    show('gate');
    $('pin-input').value = '';
    $('pin-input')?.focus();
  });
  $('btn-muat-ulang')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const ok = await muatUlangDiam();
    btn.disabled = false;
    toast(ok ? 'Daftar undangan diperbarui.' : 'Gagal memuat. Periksa koneksi.', ok ? 'ok' : 'err', 3000);
  });
  $('tab-undangan')?.addEventListener('click', () => setTab('undangan'));
  $('tab-baru')?.addEventListener('click', () => setTab('baru'));
  $('cari-nama')?.addEventListener('input', () => filterDaftar());
  $('pilih-nama')?.addEventListener('change', (e) => pilihTamu(e.target.value));
  $('btn-u-simpan')?.addEventListener('click', simpanUndangan);
  $('walkin-form')?.addEventListener('submit', simpanBaru);
  window.addEventListener('online', () => { setNet(true); muatUlangDiam().catch(() => {}); });
  window.addEventListener('offline', () => setNet(false));
}

async function boot() {
  if (!isConfigured()) {
    show('error');
    $('error-message').textContent = 'config.js belum diisi (SUPABASE_URL / SUPABASE_ANON_KEY kosong).';
    return;
  }
  setNet(online());
  setEventName('Acara Natal');

  // sudah pernah masuk di HP ini? pakai cache dulu supaya tetap jalan saat sinyal lemah
  const pin = store.get(K.pin, '');
  const cache = store.get(K.data, []);
  if (Array.isArray(cache) && cache.length && pin) {
    S.pin = pin;
    S.all = cache.slice().sort((a, b) => a.lottery_no - b.lottery_no);
    masukTanpaVerifikasi();
    muatUlangDiam().catch(() => {});
    return;
  }
  if (pin) {
    const ok = await masukDenganPin(pin, { diam: true });
    if (!ok) { show('gate'); return; }
    return;
  }
  show('gate');
  setTimeout(() => $('pin-input')?.focus(), 80);
}

function masukTanpaVerifikasi() {
  S.masuk = true;
  show('absen');
  bukaAbsen();
}

/* ------------------------------------------------------------------ start */
bind();
boot();

// petunjuk: halaman ini bisa dibuka dari QR umum (mode=absen) atau langsung
if (new URLSearchParams(location.search).get('mode')) {
  const n = $('gate-note');
  if (n) n.textContent = 'Halaman petugas meja registrasi. Masukkan PIN petugas sekali saja — '
    + 'PIN diingat di HP ini.';
}
