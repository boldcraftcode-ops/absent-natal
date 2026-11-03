/* ==========================================================================
   js/absen-tamu.js — halaman ABSENSI UNTUK TAMU (absen.html)

   Siapa yang memegang HP di sini? TAMU itu sendiri (dibuka dari QR umum meja
   registrasi, atau dari tautan "Belum membawa undangan?"). Karena itu:

     • TIDAK ADA PIN, dan halaman ini TIDAK pernah memanggil staff_data().
       (staff_data mengembalikan token undangan semua peserta — tidak boleh
       dibuka bebas di HP tamu.)
     • Daftar nama diambil lewat lookup_invited() yang hanya mengembalikan
       nama + asal + status hadir. Nomor undian hanya ikut bila
       undianTampil=true (dipakai saat panitia mendampingi; lihat §13c README).
     • Kehadiran dicatat lewat attend_invited() memakai "kunci" acak per orang
       sehingga nomor undian tetap 1-500 miliknya, TIDAK membuat nomor baru.

   Dua jalur:
     (A) Tamu undangan yang TIDAK membawa undangan fisik  -> cari nama, pilih,
         konfirmasi "Betul ini Anda?", lalu Ya saya hadir.
     (B) Tamu tanpa undangan -> form biasa, nomor baru >= 501.
   Semua panggilan mengembalikan sisa_belum_hadir, jadi pemeriksaan data dobel
   manual tetap bisa dilakukan panitia (lihat juga panel admin §13c).
   ========================================================================== */
import { api, isConfigured } from '../api.js';
import { pad3, fmtTime, esc, toast, normPhone, online } from '../util.js';

const K = { kios: 'absen_kios', tua: 'absen_terakhir' };
const JEDA_CARI = 320;     // ms, debounce pencarian
const JEDA_KIOS = 25000;   // ms, auto-reset layar kios

const S = {
  open: true,
  eventName: 'Acara Natal',
  hasil: [],            // hasil lookup_invited
  terpilih: null,       // { kunci, nama, org, hadir, hadir_pada }
  sisa: null,           // sisa_belum_hadir dari server (untuk pemantauan manual)
  busy: false,
  kios: false,
  pantau: false,        // mode pemantauan panitia (penghitung sisa undangan)
  undianTampil: false,  // tampilkan nomor undian di daftar (dipilih panitia)
  timerKios: 0,
  timerCari: 0,
  tanya: 0
};

const $ = (id) => document.getElementById(id);
const viewEl = (n) => $('view-' + n);

function show(name) {
  ['cari', 'konfirmasi', 'baru', 'hasil', 'error']
    .forEach((v) => viewEl(v)?.classList.toggle('hidden', v !== name));
  window.scrollTo(0, 0);
  jadwalkanKios(name);
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

/* ------------------------------------------------------------ mode kios */
function jadwalkanKios(view) {
  clearTimeout(S.timerKios);
  if (!S.kios) return;
  if (view === 'hasil') { S.timerKios = setTimeout(ulang, JEDA_KIOS); return; }
  S.timerKios = setTimeout(ulang, JEDA_KIOS * 3);
}

function ulang() {
  S.terpilih = null;
  S.hasil = [];
  const cari = $('cari-nama');
  if (cari) cari.value = '';
  const box = $('daftar-nama');
  if (box) box.innerHTML = '';
  $('cari-kosong')?.classList.add('hidden');
  const st = $('status-cari');
  if (st) st.textContent = '—';
  $('walkin-form')?.reset();
  if ($('b-family')) $('b-family').value = '0';
  show('cari');
  cari?.focus();
}

/* --------------------------------------------------------- 1. cari nama */
function renderHasil(rows) {
  const box = $('daftar-nama');
  const kosong = $('cari-kosong');
  if (!box) return;
  S.hasil = rows;

  if (!rows.length) {
    box.innerHTML = '';
    kosong?.classList.remove('hidden');
    return;
  }
  kosong?.classList.add('hidden');

  box.innerHTML = rows.map((p, i) => `
    <button class="pilih-nama__item${p.hadir ? ' is-hadir' : ''}" type="button"
            role="option" data-i="${i}" aria-selected="false">
      <span class="pilih-nama__teks">
        <strong>${esc(p.nama)}</strong>
        <span class="small">${esc(p.org || '—')}</span>
      </span>
      <span class="pilih-nama__kanan">
        ${S.undianTampil && p.no ? `<span class="num">${esc(pad3(p.no))}</span>` : ''}
        ${p.hadir
          ? '<span class="pill pill--hadir">✓ sudah hadir</span>'
          : '<span class="pill pill--belum">pilih</span>'}
      </span>
    </button>`).join('');
}

async function cariNama(q) {
  const status = $('status-cari');
  const box = $('daftar-nama');
  const kata = (q || '').trim();

  if (kata.length < 2) {
    if (box) box.innerHTML = '';
    $('cari-kosong')?.classList.add('hidden');
    if (status) status.textContent = kata ? 'Ketik minimal 2 huruf.' : '—';
    return;
  }

  if (!online()) { setNet(false); if (status) status.textContent = 'Tidak ada koneksi. Coba lagi.'; return; }

  const tanya = ++S.tanya;
  if (status) status.textContent = 'Mencari…';
  try {
    const res = await api.lookupInvited(kata, { limit: 20, tampilNomor: S.undianTampil });
    if (tanya !== S.tanya) return;               // hasil lama, abaikan
    setNet(true);
    if (res?.status === 'closed' || res?.ok === false) {
      S.open = false;
      tampilTutup();
      return;
    }
    S.open = true;
    if (typeof res.sisa_belum_hadir === 'number') S.sisa = res.sisa_belum_hadir;
    if (res.event_name) setEventName(res.event_name);
    if (S.pantau) renderPantau();

    const rows = res.rows || [];
    renderHasil(rows);
    if (status) {
      status.textContent = !rows.length
        ? `Tidak ada nama yang cocok dengan “${kata}”.`
        : `${rows.length} nama cocok` + (rows.length === 20 ? ' (persempit dengan nama depan)' : '');
    }
  } catch (err) {
    if (tanya !== S.tanya) return;
    if (err?.code === 'offline') {
      setNet(false);
      if (status) status.textContent = 'Koneksi terputus.';
    } else {
      if (status) status.textContent = err?.message || 'Gagal mencari nama.';
      toast(err?.message || 'Gagal mencari nama.', 'err', 5000);
    }
  }
}

/* ------------------------------------------------ 2. konfirmasi & simpan */
function bukaKonfirmasi(p) {
  S.terpilih = p;
  const nama = $('konf-nama');
  const org = $('konf-org');
  if (nama) nama.textContent = p.nama || '—';
  if (org) org.textContent = p.org || '—';

  const st = $('konf-status');
  if (st) {
    st.className = p.hadir ? 'notice notice--warn' : 'notice notice--info hidden';
    st.innerHTML = p.hadir
      ? '<span class="notice__icon" aria-hidden="true">⚠️</span><div>'
        + `<strong>Nama ini sudah tercatat hadir</strong> pukul ${esc(fmtTime(p.hadir_pada))}. `
        + 'Bila ini memang Anda, tidak perlu mengisi apa pun lagi — '
        + '<strong>hubungi panitia</strong> bila ada yang perlu diubah.</div>'
      : '';
    st.classList.toggle('hidden', !p.hadir);
  }

  const fam = $('u-family');
  if (fam) fam.value = '0';
  if ($('u-meal')) $('u-meal').checked = false;
  if ($('u-souvenir')) $('u-souvenir').checked = false;

  const simpan = $('btn-u-simpan');
  if (simpan) {
    simpan.disabled = false;
    simpan.textContent = p.hadir ? '✅ Sudah, saya sudah tercatat' : '✅ Ya, saya hadir';
  }
  show('konfirmasi');
}

async function simpanUndangan() {
  const p = S.terpilih;
  if (!p) { toast('Pilih nama dulu.', 'warn'); return; }
  if (S.busy) return;

  // sudah hadir: jangan ubah apa pun, cukup tampilkan nomornya
  if (p.hadir) {
    tampilkanHasil({
      nama: p.nama, org: p.org, no: p.no ?? null, at: p.hadir_pada,
      sudah: true, undangan: true
    });
    return;
  }

  if (!online()) { toast('Butuh koneksi internet untuk mencatat kehadiran.', 'err', 5000); return; }

  const btn = $('btn-u-simpan');
  S.busy = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan…'; }
  try {
    const res = await api.attendInvited(p.kunci, {
      family: Math.min(5, Number($('u-family')?.value || 0)),
      meal: Boolean($('u-meal')?.checked),
      souvenir: Boolean($('u-souvenir')?.checked)
    });
    setNet(true);

    if (res?.status === 'closed') { tampilTutup(); return; }
    if (res?.ok === false) { toast(res.message || 'Gagal mencatat kehadiran.', 'err', 5000); return; }

    if (typeof res.sisa_belum_hadir === 'number') {
      S.sisa = res.sisa_belum_hadir;
      if (S.pantau) renderPantau();
    }
    tampilkanHasil({
      nama: res.name || p.nama,
      org: res.org || p.org,
      no: res.lottery_no,
      at: res.attended_at,
      sudah: res.status === 'already',
      undangan: true,
      kunci: p.kunci,
      family: res.family_count ?? Number($('u-family')?.value || 0),
      meal: Boolean(res.wants_meal),
      souvenir: Boolean(res.wants_souvenir)
    });
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
      btn.textContent = '✅ Ya, saya hadir';
    }
  }
}

/* ------------------------------------------------ 3. tamu tanpa undangan */
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
      if (res.status === 'closed') { tampilTutup(); return; }
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
      undangan: false,
      family: res.family_count || family,
      meal: Boolean(res.wants_meal ?? meal),
      souvenir: Boolean(res.wants_souvenir ?? souvenir)
    });
    $('walkin-form').reset();
    $('b-family').value = '0';
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
    btn.textContent = 'Daftarkan & Tandai Hadir';
  }
}

/* --------------------------------------------------------------- 4. hasil */
function tampilkanHasil({ nama, org, no, at, sudah, digabung, undangan, kunci, family, meal, souvenir }) {
  const box = $('view-hasil');
  if (!box) return;
  const ringkas = [
    family > 0 ? `👨‍👩‍👧 ${family} anggota keluarga` : '',
    meal ? '🍱 Kupon makan' : '',
    souvenir ? '🎁 Souvenir' : ''
  ].filter(Boolean).join(' · ') || 'Tanpa kupon & tanpa keluarga';

  box.innerHTML = `
    <div class="card card--ribbon stack center" role="status" aria-live="polite">
      <div class="participant-hero" style="padding:0;color:var(--ink)">
        <div class="participant-hero__orn" aria-hidden="true">${sudah ? '✅' : '🎉'}</div>
        <h2 style="color:var(--cocoa-800);margin:0">
          ${sudah ? 'Sudah tercatat hadir' : 'Kehadiran tercatat'}
        </h2>
        <p style="color:var(--ink-soft);margin:4px 0 0">${esc(nama)}${org ? ' · ' + esc(org) : ''}</p>
      </div>
      ${no ? `<div class="number-plate" style="align-self:center">
        <div class="number number--hero">${esc(pad3(no))}</div>
      </div>` : ''}
      <p class="small" style="margin:0;color:var(--ink-soft)">${
        no ? 'Tunjukkan nomor ini ke panitia bila diminta.' : 'Silakan hubungi panitia registrasi.'
      }${at ? ` Tercatat pukul ${esc(fmtTime(at))}.` : ''}</p>
      <p class="small" style="margin:0;color:var(--ink-soft)">${ringkas}</p>
      ${digabung ? '<div class="notice notice--info"><span class="notice__icon" aria-hidden="true">🔗</span>'
        + '<div>Data digabung dengan undangan yang sudah terdaftar.</div></div>' : ''}
      <button class="btn btn--outline btn--block" id="btn-hasil-lagi" type="button">Tamu berikutnya</button>
      ${undangan && kunci && !sudah
        ? '<button class="btn btn--ghost btn--sm" id="btn-batal" type="button" style="margin-top:2px">'
          + 'Salah pilih? Batalkan pencatatan ini</button>' : ''}
    </div>`;

  show('hasil');
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  $('btn-hasil-lagi')?.addEventListener('click', ulang);
  $('btn-batal')?.addEventListener('click', () => batalkan(kunci));
}

async function batalkan(kunci) {
  if (!online()) { toast('Butuh koneksi internet.', 'err'); return; }
  try {
    const res = await api.attendUndo(kunci);
    if (res?.ok) {
      toast('Pencatatan dibatalkan. Silakan pilih nama yang benar.', 'ok', 5000);
      ulang();
    } else {
      toast(res?.message || 'Tidak dapat dibatalkan.', 'err', 5000);
    }
  } catch (err) {
    toast(err?.message || 'Tidak dapat dibatalkan.', 'err', 5000);
  }
}

function tampilTutup() {
  const box = $('view-hasil');
  if (!box) return;
  const terakhir = S.sisa != null
    ? `<p class="small center" style="color:var(--ink-soft);margin:0">
         Undangan yang belum tercatat hadir: <strong>${S.sisa}</strong></p>` : '';
  box.innerHTML = `
    <div class="card stack center">
      <div class="participant-hero" style="padding:0;color:var(--ink)">
        <div class="participant-hero__orn" aria-hidden="true">🔒</div>
        <h2 style="color:var(--cocoa-800);margin:0">Absensi sedang ditutup</h2>
        <p style="color:var(--ink-soft);margin:4px 0 0">Silakan hubungi panitia registrasi.</p>
      </div>
      ${terakhir}
    </div>`;
  show('hasil');
}

/* ----------------------------------------------------------- 5. pemantauan */
/** Panitia bisa membuka ?pantau=1 untuk melihat sisa undangan yang belum hadir. */
function renderPantau() {
  const box = $('info-diundang');
  if (!box || S.sisa == null) return;
  box.innerHTML = `<span class="notice__icon" aria-hidden="true">📋</span>
    <div><strong>Mode pemantauan panitia.</strong>
    <div class="small">Undangan yang belum tercatat hadir: <strong>${S.sisa}</strong>.
    Angka ini harus turun satu tiap tamu. Turun dua = ada data dobel;
    melompat dua = ada tamu salah memilih nama.</div></div>`;
}

/* -------------------------------------------------------------- 6. start */
function bind() {
  $('cari-nama')?.addEventListener('input', (e) => {
    clearTimeout(S.timerCari);
    const v = e.target.value;
    S.timerCari = setTimeout(() => cariNama(v), JEDA_CARI);
  });
  $('cari-nama')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(S.timerCari);
      cariNama(e.target.value);
    }
  });
  $('daftar-nama')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-i]');
    if (!btn) return;
    const p = S.hasil[Number(btn.dataset.i)];
    if (p) bukaKonfirmasi(p);
  });
  $('btn-tanpa-undangan')?.addEventListener('click', () => {
    show('baru');
    setTimeout(() => $('b-name')?.focus(), 60);
  });
  $('btn-b-kembali')?.addEventListener('click', () => { show('cari'); $('cari-nama')?.focus(); });
  $('btn-bukan-saya')?.addEventListener('click', () => { show('cari'); $('cari-nama')?.focus(); });
  $('btn-u-simpan')?.addEventListener('click', simpanUndangan);
  $('walkin-form')?.addEventListener('submit', simpanBaru);
  window.addEventListener('online', () => { setNet(true); if ($('cari-nama')?.value) cariNama($('cari-nama').value); });
  window.addEventListener('offline', () => setNet(false));
  // aktifkan timer kios pada sentuhan pertama
  document.addEventListener('pointerdown', () => jadwalkanKios('cari'), { once: true });
}

async function boot() {
  if (!isConfigured()) {
    show('error');
    $('error-message').textContent = 'config.js belum diisi (SUPABASE_URL / SUPABASE_ANON_KEY kosong).';
    return;
  }

  const q = new URLSearchParams(location.search);
  S.pantau = q.get('pantau') === '1';
  S.kios = S.pantau || q.get('kios') === '1';
  S.undianTampil = S.pantau || q.get('undian') === '1';
  if (S.kios) document.body.classList.add('is-kios');
  if (S.undianTampil) {
    const sub = $('topbar-sub');
    if (sub) sub.textContent = 'Absensi Kehadiran · mode panitia';
  }

  setNet(online());
  setEventName('Acara Natal');

  try {
    const info = await api.eventInfo();
    setEventName(info?.event_name);
    S.open = Boolean(info?.attendance_open);
  } catch { /* tetap lanjut: lookup_invited akan memberi tahu bila ditutup */ }

  show('cari');
  if (!online()) {
    const st = $('status-cari');
    if (st) st.textContent = 'Tidak ada koneksi internet.';
  }
  if (S.kios) setTimeout(() => $('cari-nama')?.focus(), 120);
}

bind();
boot();
