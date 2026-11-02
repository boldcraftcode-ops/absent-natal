/* ==========================================================================
   js/admin.js — Panel panitia
   Tab: Rekap hadir · Undangan & QR · Hadiah · Pengaturan
   Semua akses data lewat RPC ber-PIN (api.js).
   ========================================================================== */
import { api } from '../api.js';
import {
  pad3, fmtTime, fmtDateTime, esc, toast, debounce, store,
  normPhone, normName, sourceLabel, online, $, $$
} from '../util.js';
import { qrPngDataUrl, qrPngBase64 } from '../qr.js';
import { drawCardPdf, loadJsPdf } from './cards-pdf.js';

const K = { pin: 'admin_pin', domain: 'admin_domain', tab: 'admin_tab',
  cardWhen: 'card_when', cardPlace: 'card_place', cardLayout: 'card_layout' };

/* Susunan cetak kartu: 4/A4 (kartu 95%), 2/A4 & 4/A3 (kartu 100% = 10x15 cm) */
const CARD_LAYOUTS = {
  'a4-4': { perPage: 4, kelas: 'inv-sheet--a4-4', kertas: 'A4', ukuran: '9,5 × 14,25 cm',
    hint: '1 lembar A4 = 4 kartu (2 × 2). Kartu diskalakan 95% agar muat tanpa tumpang.' },
  'a4-2': { perPage: 2, kelas: 'inv-sheet--a4-2', kertas: 'A4', ukuran: '10 × 15 cm',
    hint: '1 lembar A4 = 2 kartu. Ukuran kartu tepat 10 × 15 cm.' },
  'a3-4': { perPage: 4, kelas: 'inv-sheet--a3-4', kertas: 'A3', ukuran: '10 × 15 cm',
    hint: '1 lembar A3 = 4 kartu. Ukuran kartu tepat 10 × 15 cm.' }
};

function currentLayout() {
  const key = document.getElementById('card-layout')?.value || store.get(K.cardLayout, 'a4-4');
  return CARD_LAYOUTS[key] ? key : 'a4-4';
}

const S = {
  pin: '',
  data: { participants: [], prizes: [], winners: [], event_name: '', attendance_open: true, walkin_next: 501 },
  filter: 'all',
  search: '',
  importRows: [],
  editingPrize: null,
  editingPerson: null,
  timer: null
};

/* ================================================================ util UI */
function setNet(ok) {
  const b = document.getElementById('net-badge');
  if (!b) return;
  b.textContent = ok ? 'Online' : 'Offline';
  b.className = `badge ${ok ? 'badge--online' : 'badge--offline'}`;
}

async function withBusy(btn, label, fn) {
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = label || 'Memproses…'; }
  try { return await fn(); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = original; } }
}

/* ================================================================= login */
async function doLogin(pin) {
  const box = document.getElementById('login-error');
  const txt = document.getElementById('login-error-text');
  box.classList.add('hidden');
  const btn = document.getElementById('btn-login');
  await withBusy(btn, 'Memeriksa…', async () => {
    try {
      const res = await api.adminCheck(pin);
      if (!res?.ok) throw new Error('PIN salah.');
      S.defaultPins = { admin: Boolean(res.default_admin_pin), staff: Boolean(res.default_staff_pin) };
      S.pin = pin;
      store.set(K.pin, pin);
      enterApp();
      toast('Selamat bekerja, panitia!', 'ok');
    } catch (e) {
      txt.textContent = e?.code === 'offline'
        ? 'Tidak ada koneksi. Panel admin membutuhkan internet.'
        : (e?.message || 'Gagal masuk.');
      box.classList.remove('hidden');
    }
  });
}

async function enterApp() {
  document.getElementById('view-login').classList.add('hidden');
  // ambil status PIN bawaan juga saat login otomatis (PIN tersimpan)
  if (!S.defaultPins) {
    try {
      const chk = await api.adminCheck(S.pin);
      if (chk?.ok) {
        S.defaultPins = { admin: Boolean(chk.default_admin_pin), staff: Boolean(chk.default_staff_pin) };
      }
    } catch { /* diabaikan: peringatan saja */ }
  }
  document.getElementById('view-app').classList.remove('hidden');
  setNet(online());
  await reload(true);
  startAutoRefresh();
  switchTab(store.get(K.tab, 'rekap'), false);
  ensureCards();

  const domain = store.get(K.domain, '');
  const input = document.getElementById('domain-input');
  input.value = domain || location.origin;
  document.getElementById('domain-hint').textContent = domain
    ? `QR memakai alamat khusus: ${domain}`
    : `Mengikuti alamat situs saat ini: ${location.origin}`;
}

/* ============================================================ muat data */
async function reload(silent = false) {
  try {
    const res = await api.adminGetAll(S.pin);
    if (!res?.ok) throw new Error('Gagal memuat data.');
    S.data = res;
    setNet(true);
    document.getElementById('event-name').textContent = res.event_name || 'Panel Admin';
    renderAll();
    document.getElementById('sync-time').textContent = `Diperbarui ${fmtTime(new Date().toISOString())}`;
    if (!silent) toast('Data diperbarui.', 'ok', 1600);
  } catch (e) {
    if (e?.code === 'offline') { setNet(false); if (!silent) toast('Tidak ada koneksi.', 'err'); }
    else if (e?.code === 'pin_invalid') { store.del(K.pin); location.reload(); }
    else if (!silent) toast(e?.message || 'Gagal memuat data.', 'err');
  }
}

function startAutoRefresh() {
  clearInterval(S.timer);
  S.timer = setInterval(() => {
    if (document.visibilityState === 'visible' && online()) reload(true);
  }, 10000);
}

function renderAll() {
  renderStats();
  renderRekap();
  renderPrizes();
  renderWinners();
  renderSettings();
}

/** Label ringkas "🍱 Makan · 🎁 Souvenir · 👨‍👩‍👧 2 keluarga". */
function extrasLabel(p) {
  const bits = [];
  if (p.wants_meal) bits.push('🍱 Makan');
  if (p.wants_souvenir) bits.push('🎁 Souvenir');
  if (p.family_count > 0) bits.push(`👨‍👩‍👧 ${p.family_count}`);
  return bits.length ? bits.join(' · ') : '—';
}

/* =============================================================== statistik */
function computeStats() {
  const p = S.data.participants;
  const winners = new Set(S.data.winners.filter((w) => w.status === 'confirmed').map((w) => w.participant_id));
  const invited = p.filter((x) => x.invited);
  const walkins = p.filter((x) => !x.invited);
  const present = p.filter((x) => x.attended);
  const bySource = { scan_sendiri: 0, petugas: 0, form_umum: 0, manual: 0 };
  for (const x of present) bySource[x.source] = (bySource[x.source] || 0) + 1;
  return {
    total: p.length,
    invited: invited.length,
    invitedPresent: invited.filter((x) => x.attended).length,
    absent: invited.filter((x) => !x.attended).length,
    walkin: walkins.length,
    walkinPresent: walkins.filter((x) => x.attended).length,
    present: present.length,
    bySource,
    winners: winners.size
  };
}

function renderStats() {
  const s = computeStats();
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('s-invited', s.invited);
  set('s-invited-present', s.invitedPresent);
  set('s-absent', s.absent);
  set('s-walkin', s.walkinPresent ? `${s.walkinPresent}/${s.walkin}` : s.walkin);
  set('s-present', s.present);
  set('s-winners', s.winners);

  // konsumsi: pakai angka resmi dari server (sudah termasuk anggota keluarga)
  const t = S.data.totals || {};
  const meal = t.meal_with_family ?? t.meal ?? 0;
  const souvenir = t.souvenir_with_family ?? t.souvenir ?? 0;
  set('s-people', t.people_present ?? s.present);
  set('s-family', t.family_present ?? 0);
  set('s-meal', meal);
  set('s-souvenir', souvenir);
  const mealNote = document.getElementById('s-meal-note');
  if (mealNote) mealNote.textContent = t.meal_with_family != null
    ? `${t.meal || 0} peserta + ${t.family_present || 0} keluarga`
    : 'termasuk keluarga';

  const box = document.getElementById('source-breakdown');
  const entries = Object.entries(s.bySource);
  box.innerHTML = entries.map(([k, v]) =>
    `<span class="badge badge--plain">${esc(sourceLabel(k))}: <strong>${v}</strong></span>`
  ).join('') + `<span class="badge badge--gold">Hadir ${s.present} / ${s.total}</span>`;

  document.getElementById('free-numbers').textContent =
    `Kursi undangan tersisa (nomor 1-500): ${Math.max(0, 500 - S.data.participants.filter((x) => x.lottery_no <= 500).length)}`;
}

/* ================================================================= rekap */
function filterRows() {
  const q = normName(S.search);
  const qDigits = normPhone(S.search);
  const winnerIds = new Set(S.data.winners.filter((w) => w.status === 'confirmed').map((w) => w.participant_id));

  let rows = S.data.participants;
  switch (S.filter) {
    case 'present': rows = rows.filter((p) => p.attended); break;
    case 'absent': rows = rows.filter((p) => !p.attended); break;
    case 'walkin': rows = rows.filter((p) => !p.invited); break;
    case 'winner': rows = rows.filter((p) => winnerIds.has(p.id)); break;
    default: break;
  }
  if (q || qDigits) {
    rows = rows.filter((p) =>
      normName(p.name).includes(q) ||
      normName(p.org || '').includes(q) ||
      (qDigits && (p.phone || '').includes(qDigits)) ||
      pad3(p.lottery_no) === S.search.trim()
    );
  }
  return rows.slice().sort((a, b) => a.lottery_no - b.lottery_no);
}

function renderRekap() {
  const rows = filterRows();
  const body = document.getElementById('rekap-body');
  const winnerIds = new Set(S.data.winners.filter((w) => w.status === 'confirmed').map((w) => w.participant_id));

  document.getElementById('rekap-count').textContent =
    `Menampilkan ${rows.length} dari ${S.data.participants.length} peserta` +
    (rows.length > 400 ? ' (gunakan pencarian untuk mempersempit)' : '');

  body.innerHTML = rows.slice(0, 400).map((p) => {
    const waNumber = (p.phone || '').replace(/^0/, '62');
    const link = inviteUrl(p.token);
    const waText = encodeURIComponent(
      `Shalom! Ini undangan ${S.data.event_name} untuk ${p.name}.\n` +
      `Silakan buka tautan berikut saat tiba di lokasi, lalu tekan "Konfirmasi Hadir" untuk mendapatkan nomor undian:\n${link}`
    );
    return `
      <tr data-id="${esc(p.id)}">
        <td data-label="No"><span class="num">${esc(pad3(p.lottery_no))}</span></td>
        <td data-label="Nama"><strong>${esc(p.name)}</strong>${winnerIds.has(p.id) ? ' <span class="pill pill--hadir">🏆</span>' : ''}</td>
        <td data-label="Asal">${esc(p.org || '—')}</td>
        <td data-label="HP">${p.phone ? esc(p.phone) : '—'}</td>
        <td data-label="Undian"><span class="num">${esc(pad3(p.lottery_no))}</span></td>
        <td data-label="Status">${p.attended
          ? '<span class="pill pill--hadir">Hadir</span>'
          : '<span class="pill pill--belum">Belum</span>'}</td>
        <td data-label="Waktu">${esc(fmtTime(p.attended_at))}</td>
        <td data-label="Sumber">${esc(sourceLabel(p.source))}${p.invited ? '' : ' <span class="pill pill--walkin">tanpa undangan</span>'}</td>
        <td data-label="Konsumsi"><span class="small">${extrasLabel(p)}</span></td>
        <td data-label="Aksi">
          <div class="actions">
            <button class="btn btn--outline btn--sm" data-act="toggle" data-id="${esc(p.id)}">${p.attended ? 'Batal' : 'Hadir'}</button>
            <button class="btn btn--outline btn--sm" data-act="edit" data-id="${esc(p.id)}">Edit</button>
            <button class="btn btn--outline btn--sm" data-act="delete" data-id="${esc(p.id)}">Hapus</button>
            ${p.phone ? `<a class="btn btn--outline btn--sm" target="_blank" rel="noopener"
                 href="https://wa.me/${esc(waNumber)}?text=${waText}">WA</a>` : ''}
          </div>
        </td>
      </tr>`;
  }).join('') || `<tr><td colspan="10" style="text-align:center;padding:22px;color:var(--ink-soft)">Tidak ada data sesuai filter.</td></tr>`;
}

/* ======================================================== import undangan */
const HEADER_SYNONYMS = {
  name: ['nama', 'name', 'nama lengkap', 'nama peserta', 'peserta', 'full name', 'nama tamu'],
  phone: ['no hp', 'no. hp', 'hp', 'telepon', 'telp', 'phone', 'whatsapp', 'wa', 'no wa', 'no. wa',
    'nomor hp', 'no handphone', 'handphone', 'kontak', 'no telp', 'no. telp'],
  org: ['asal', 'divisi', 'instansi', 'wilayah', 'organisasi', 'unit', 'departemen', 'jabatan',
    'asal/divisi', 'asal / divisi', 'asal instansi', 'sektor', 'lingkungan', 'org']
};

function normalizeHeader(h) {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[._]/g, ' ');
}

function detectMapping(headerRow) {
  const mapping = { name: -1, phone: -1, org: -1 };
  const cells = (headerRow || []).map(normalizeHeader);
  cells.forEach((cell, idx) => {
    for (const [key, list] of Object.entries(HEADER_SYNONYMS)) {
      if (mapping[key] === -1 && list.includes(cell)) mapping[key] = idx;
    }
  });
  return mapping;
}

/** Baca berkas jadi ArrayBuffer. FileReader dipakai untuk peramban lama (iOS < 14). */
function readFileBuffer(file) {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Berkas gagal dibaca.'));
    reader.readAsArrayBuffer(file);
  });
}

async function handleFile(file) {
  const preview = document.getElementById('import-preview');
  preview.classList.remove('hidden');
  preview.innerHTML = '<div class="loader"><div class="loader__ring"></div><div>Membaca berkas…</div></div>';

  try {
    const buf = await readFileBuffer(file);
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array', raw: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
    if (!matrix.length) throw new Error('Berkas kosong.');

    // Deteksi header: cari baris pertama yang memuat sinonim kolom nama
    let headerIdx = -1;
    let mapping = { name: 0, phone: 1, org: 2 };
    for (let i = 0; i < Math.min(matrix.length, 8); i++) {
      const m = detectMapping(matrix[i]);
      if (m.name >= 0) { headerIdx = i; mapping = m; break; }
    }
    if (headerIdx === -1 && matrix.length) {
      // tanpa header: urutan kolom Nama, No. HP, Asal
      mapping = { name: 0, phone: 1, org: 2 };
      headerIdx = -1;
      toast('Header tidak terdeteksi — memakai urutan kolom: Nama, No. HP, Asal.', 'warn', 5000);
    }

    const rows = [];
    const seenPhone = new Set();
    const seenName = new Set();
    const invalid = [];
    for (let i = headerIdx + 1; i < matrix.length; i++) {
      const row = matrix[i];
      if (!row || !row.length) continue;
      const name = String(row[mapping.name] ?? '').trim().replace(/\s+/g, ' ');
      if (!name || name.length < 2) continue;
      if (HEADER_SYNONYMS.name.includes(normalizeHeader(name))) continue; // baris header ganda
      const phone = mapping.phone >= 0 ? normPhone(row[mapping.phone]) : '';
      const org = mapping.org >= 0 ? String(row[mapping.org] ?? '').trim() : '';

      const nKey = normName(name);
      const pKey = phone || '';
      if ((pKey && seenPhone.has(pKey)) || seenName.has(nKey)) { invalid.push(name); continue; }
      if (pKey) seenPhone.add(pKey);
      seenName.add(nKey);
      rows.push({ name, phone, org });
    }

    if (!rows.length) throw new Error('Tidak ada baris valid. Pastikan kolom Nama terisi.');
    S.importRows = rows;

    preview.innerHTML = `
      <div class="notice notice--info">
        <span class="notice__icon">📄</span>
        <div>
          <strong>${rows.length} baris siap diimport.</strong><br>
          Kolom terdeteksi — Nama: <em>${esc(matrix[headerIdx]?.[mapping.name] ?? 'kolom 1')}</em>,
          No. HP: <em>${esc(mapping.phone >= 0 ? (matrix[headerIdx]?.[mapping.phone] ?? 'kolom 2') : 'tidak ada')}</em>,
          Asal: <em>${esc(mapping.org >= 0 ? (matrix[headerIdx]?.[mapping.org] ?? 'kolom 3') : 'tidak ada')}</em>
          ${invalid.length ? `<br><span style="color:#8a5a08">${invalid.length} baris duplikat di berkas dilewati.</span>` : ''}
        </div>
      </div>
      <div class="table-wrap" style="max-height:44vh;overflow:auto">
        <table class="data">
          <thead><tr><th>#</th><th>Nama</th><th>No. HP</th><th>Asal</th></tr></thead>
          <tbody>
            ${rows.slice(0, 60).map((r, i) => `<tr>
              <td data-label="#">${i + 1}</td>
              <td data-label="Nama">${esc(r.name)}</td>
              <td data-label="No. HP">${esc(r.phone || '—')}</td>
              <td data-label="Asal">${esc(r.org || '—')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${rows.length > 60 ? `<p class="small" style="color:var(--ink-soft)">Menampilkan 60 baris pertama dari ${rows.length}.</p>` : ''}
      <div class="row row--end">
        <button class="btn btn--outline" id="btn-import-cancel">Batal</button>
        <button class="btn btn--red btn--lg" id="btn-import-go">Import ${rows.length} undangan</button>
      </div>`;

    document.getElementById('btn-import-cancel').addEventListener('click', () => {
      S.importRows = [];
      preview.classList.add('hidden');
      preview.innerHTML = '';
      document.getElementById('file-input').value = '';
    });
    document.getElementById('btn-import-go').addEventListener('click', (e) => doImport(e.currentTarget));
  } catch (e) {
    preview.innerHTML = `<div class="notice notice--danger"><span class="notice__icon">⚠️</span>
      <div>Gagal membaca berkas: ${esc(e.message || 'format tidak dikenal')}</div></div>`;
  }
}

async function doImport(btn) {
  if (!S.importRows.length) return;
  await withBusy(btn, 'Mengimport…', async () => {
    try {
      const res = await api.adminImport(S.pin, S.importRows);
      if (!res?.ok) throw new Error(res?.message || 'Import gagal.');
      const detail = (res.skipped_detail || []).slice(0, 8)
        .map((d) => `${esc(d.name)} — ${esc(d.reason)}`).join('<br>');
      document.getElementById('import-preview').innerHTML = `
        <div class="notice notice--success">
          <span class="notice__icon">✅</span>
          <div>
            <strong>${res.inserted} undangan diimport.</strong>
            ${res.skipped ? `<br>${res.skipped} baris dilewati (sudah terdaftar).` : ''}
            ${detail ? `<div class="small" style="margin-top:6px">${detail}</div>` : ''}
            ${res.warning ? `<div class="small" style="margin-top:6px;color:#8a5a08">${esc(res.warning)}</div>` : ''}
          </div>
        </div>`;
      S.importRows = [];
      document.getElementById('file-input').value = '';
      await reload(true);
    } catch (e) {
      toast(e?.message || 'Import gagal.', 'err', 5000);
    }
  });
}

function downloadTemplate() {
  const rows = [
    ['Nama', 'No. HP', 'Asal/Divisi'],
    ['Budi Santoso', '081234567890', 'Divisi TI'],
    ['Siti Aminah', '081311112222', 'Keuangan'],
    ['Yohanes Sinaga', '081399990000', 'Wilayah Medan Kota']
  ];
  const ws = XLSX.utils.aoa_to_sheet([rows[0], ...rows.slice(1)]);
  ws['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 28 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Undangan');
  XLSX.writeFile(wb, 'template-undangan-natal.xlsx');
}

/* ================================================== domain & link undangan */
function currentDomain() {
  const stored = store.get(K.domain, '');
  const raw = (stored || location.origin || '').replace(/\/+$/, '');
  if (!raw) return location.origin;
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function inviteUrl(token) {
  return `${currentDomain()}/?t=${token}`;
}

/* ============================================ QR: ZIP, cetak, excel, umum */
async function downloadQrZip(btn) {
  const people = S.data.participants;
  if (!people.length) { toast('Belum ada peserta. Import undangan dulu.', 'warn'); return; }
  if (typeof JSZip === 'undefined') {
    toast('Pustaka ZIP tidak termuat. Muat ulang halaman saat ada internet.', 'err', 5000);
    return;
  }
  await withBusy(btn, 'Menyiapkan ZIP…', async () => {
    try {
    const zip = new JSZip();
    const used = new Set();
    const list = [];
    for (const p of people) {
      const base = String(p.name || 'peserta').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').slice(0, 60);
      let filename = `${base}.png`;
      let i = 2;
      while (used.has(filename)) { filename = `${base}_${i++}.png`; }
      used.add(filename);
      zip.file(filename, qrPngBase64(inviteUrl(p.token), { size: 720, margin: 2 }), { base64: true });
      list.push({ Nama: p.name, Asal: p.org || '', 'No. HP': p.phone || '', 'Nomor Undian': p.lottery_no, 'Berkas QR': filename, 'Link Undangan': inviteUrl(p.token) });
    }
    zip.file('daftar-qr.csv', '\uFEFF' + toCsv(list));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    await saveBlob(blob, `qr-undangan-${people.length}-peserta.zip`);
    toast(`${people.length} QR diunduh.`, 'ok');
    } catch (err) {
      toast(`Gagal membuat ZIP: ${err?.message || 'kesalahan tak dikenal'}.`, 'err', 6000);
    }
  });
}

/** Info acara yang dicetak di kartu (diingat di perangkat ini). */
function cardEventInfo() {
  const name = S.data.event_name || 'Perayaan Natal';
  const when = (document.getElementById('card-when')?.value || '').trim();
  const place = (document.getElementById('card-place')?.value || '').trim();
  return { name, when, place, org: S.data.event_org || '' };
}

/**
 * Kartu undangan 10 x 15 cm, pratinjau langsung dari data asli.
 * Susunan cetak: 4/A4 (kartu 95%), 2/A4 atau 4/A3 (kartu tepat 10x15 cm).
 */
function buildCards() {
  const limitSel = document.getElementById('card-limit')?.value || '16';
  const people = limitSel === 'all'
    ? S.data.participants
    : S.data.participants.slice(0, Number(limitSel));
  const sheet = document.getElementById('inv-sheet');
  const info = cardEventInfo();
  const layoutKey = currentLayout();
  const layout = CARD_LAYOUTS[layoutKey];

  // kelas susunan pada wadah (dipakai juga saat dicetak)
  sheet.className = `inv-sheet ${layout.kelas}`;
  const hint = document.getElementById('card-layout-hint');
  if (hint) hint.textContent = layout.hint;
  const sizeNote = document.getElementById('card-size-note');
  if (sizeNote) sizeNote.textContent = `${layout.kertas} = ${layout.perPage} kartu (${layout.ukuran})`;

  if (!people.length) {
    sheet.innerHTML = '<p style="color:var(--ink-soft);padding:12px">Belum ada peserta. Import undangan dulu.</p>';
    return;
  }

  const cardHtml = (p, i) => `
    <div class="card15">
      <div class="card15__inner">
        <div class="card15__rule"></div>
        <div class="card15__head">
          <div class="card15__star" aria-hidden="true">✦</div>
          <div class="card15__event">${esc(info.name)}</div>
          ${info.org ? `<div class="card15__org">${esc(info.org)}</div>` : ''}
        </div>
        <div class="card15__body">
          <div class="card15__qr">
            <img alt="QR undangan ${esc(p.name)}"
                 src="${qrPngDataUrl(inviteUrl(p.token), { size: 480, margin: 1 })}">
          </div>
          <div class="card15__info">
            <div class="card15__label">Kepada</div>
            <div class="card15__name">${esc(p.name)}</div>
            <div class="card15__sub">${esc(p.org || '')}</div>
          </div>
        </div>
        ${info.when || info.place ? `<div class="card15__meta">
          ${info.when ? `<div><span>Waktu</span><strong>${esc(info.when)}</strong></div>` : ''}
          ${info.place ? `<div><span>Tempat</span><strong>${esc(info.place)}</strong></div>` : ''}
        </div>` : ''}
        <div class="card15__foot">
          <div class="cut" aria-hidden="true">✂</div>
          <div class="card15__tips">Pindai QR untuk konfirmasi kehadiran.<br>
            Nomor undian muncul setelah pindai.</div>
          <div class="card15__no">${String(i + 1).padStart(2, '0')}/${people.length}</div>
        </div>
      </div>
    </div>`;

  // pecah menjadi lembaran (4 kartu/A4, 2 kartu/A4, atau 4 kartu/A3)
  const pages = [];
  for (let i = 0; i < people.length; i += layout.perPage) pages.push(people.slice(i, i + layout.perPage));
  sheet.innerHTML = pages.map((group, pi) => `
    <section class="page" aria-label="Lembar ${pi + 1}">
      <span class="page__tag">${layout.kertas} · lembar ${pi + 1}/${pages.length}</span>
      ${group.map((p, k) => cardHtml(p, pi * layout.perPage + k)).join('')}
    </section>`).join('');

  const count = document.getElementById('card-count');
  if (count) {
    count.textContent = `${people.length} kartu · ${pages.length} lembar ${layout.kertas}`
      + ` (${layout.perPage} kartu/lembar, ${layout.ukuran})`;
  }
}

/**
 * Ekspor kartu undangan ke berkas PDF (A4 4 kartu, A4 2 kartu, atau A3 4 kartu).
 * Tidak memakai dialog cetak: berkas langsung diunduh.
 */
async function exportCardsPdf(opts = {}) {
  const all = Boolean(opts.all);
  const btn = all ? document.getElementById('btn-cards-pdf-all') : document.getElementById('btn-cards-pdf');
  if (!S.data.participants.length) { toast('Belum ada peserta. Import undangan dulu.', 'warn'); return; }

  const layoutKey = currentLayout();
  const layout = CARD_LAYOUTS[layoutKey];
  const orang = all ? S.data.participants : S.data.participants.slice(0, 16);

  await withBusy(btn, 'Menyiapkan PDF…', async () => {
    let jsPDF;
    try {
      jsPDF = await loadJsPdf();
    } catch (e) {
      toast(e.message || 'Pustaka PDF tidak bisa dimuat.', 'err', 6000);
      return;
    }

    const doc = new jsPDF({ unit: 'mm', format: layout.kertas.toLowerCase(), orientation: 'portrait',
      compress: true });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    // ukuran kartu sebenarnya (mm) sesuai susunan
    const kartuW = layoutKey === 'a4-4' ? 95 : 100;
    const kartuH = layoutKey === 'a4-4' ? 142.5 : 150;
    const kolom = 2;
    const baris = layout.perPage / 2;
    const sisaX = pageW - kolom * kartuW;
    const sisaY = pageH - baris * kartuH;
    const gapX = Math.max(0, Math.min(6, sisaX));
    const gapY = Math.max(0, Math.min(6, sisaY));
    const kiri = (pageW - (kolom * kartuW + (kolom - 1) * gapX)) / 2;
    const atas = (pageH - (baris * kartuH + (baris - 1) * gapY)) / 2;

    const info = cardEventInfo();
    const total = orang.length;

    orang.forEach((p, i) => {
      const idx = i % layout.perPage;
      if (i && idx === 0) doc.addPage(layout.kertas.toLowerCase(), 'portrait');
      const c = idx % kolom;
      const r = Math.floor(idx / kolom);
      const x = kiri + c * (kartuW + gapX);
      const y = atas + r * (kartuH + gapY);
      drawCardPdf(doc, p, i + 1, total, info, x, y, kartuW, kartuH, {
        qr: qrPngDataUrl(inviteUrl(p.token), { size: 480, margin: 1 })
      });
    });

    // metadata berkas
    doc.setProperties({
      title: `Kartu Undangan ${info.name}`,
      subject: `${total} kartu · ${layout.perPage} per lembar ${layout.kertas}`,
      creator: 'Absensi Natal'
    });

    const nama = `kartu-undangan-${layout.kertas.toLowerCase()}-${layout.perPage}up-${total}kartu-${new Date()
      .toISOString().slice(0, 10)}.pdf`;

    const count = document.getElementById('card-count');
    if (count) {
      count.textContent = `PDF siap: ${total} kartu · ${Math.ceil(total / layout.perPage)} lembar `
        + `${layout.kertas} (${layout.perPage} kartu/lembar, ${layout.ukuran})`;
    }

    try {
      const blob = doc.output('blob');
      await saveBlob(blob, nama);
      toast(`PDF dibuat: ${total} kartu (${nama}).`, 'ok', 6000);
    } catch (e) {
      // cadangan: beberapa peramban HP membatasi unduhan blob -> buka di tab baru
      try {
        const url = doc.output('bloburl');
        const w = window.open(url, '_blank');
        if (!w) throw new Error('popup diblokir');
        toast('PDF dibuka di tab baru — simpan dari sana.', 'warn', 6000);
      } catch {
        toast('Gagal mengunduh PDF. Coba di Chrome/Firefox desktop.', 'err', 6000);
      }
    }
  });
}

function exportLinksXlsx(btn) {
  if (!S.data.participants.length) { toast('Belum ada peserta.', 'warn'); return; }
  const rows = S.data.participants.map((p) => ({
    Nama: p.name,
    'No. HP': p.phone || '',
    'No. WA (62)': (p.phone || '').replace(/^0/, '62'),
    Asal: p.org || '',
    'Nomor Undian': p.lottery_no,
    'Link Undangan': inviteUrl(p.token),
    'Pesan WhatsApp': `Shalom! Ini undangan ${S.data.event_name} untuk ${p.name}. Buka tautan ini saat tiba di lokasi lalu tekan "Konfirmasi Hadir": ${inviteUrl(p.token)}`
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 26 }, { wch: 15 }, { wch: 15 }, { wch: 22 }, { wch: 12 }, { wch: 58 }, { wch: 80 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Link Undangan');
  XLSX.writeFile(wb, 'link-undangan.xlsx');
  toast('Excel link undangan diunduh.', 'ok');
}

function showGeneralQr() {
  const url = `${currentDomain()}/`;
  const box = document.getElementById('qr-preview');
  box.innerHTML = `
    <div class="card card--flat" style="max-width:420px;margin:14px auto 0">
      <h3 class="card__title center">Daftar Tanpa Undangan</h3>
      <p class="card__sub center" style="margin-bottom:10px">Pindai untuk mengisi form kehadiran</p>
      <div class="qr-box" style="margin:0 auto"><img alt="QR umum" src="${qrPngDataUrl(url, { size: 480, margin: 2 })}" style="width:100%;max-width:260px"></div>
      <p class="small center" style="margin:10px 0 0;color:var(--ink-soft);word-break:break-all">${esc(url)}</p>
      <div class="row" style="justify-content:center;margin-top:10px">
        <button class="btn btn--outline btn--sm" onclick="window.print()">🖨️ Cetak</button>
      </div>
    </div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ======================================================== ekspor absensi */
function csvRows() {
  const prizeName = new Map(S.data.prizes.map((z) => [z.id, z.name]));
  const win = new Map();
  for (const w of S.data.winners) {
    if (w.status !== 'confirmed') continue;
    const p = S.data.participants.find((x) => x.id === w.participant_id);
    if (p) win.set(p.id, prizeName.get(w.prize_id) || 'Hadiah');
  }
  return S.data.participants.map((p) => ({
    'Nomor Undian': pad3(p.lottery_no),
    Nama: p.name,
    Asal: p.org || '',
    'No. HP': p.phone || '',
    'Jumlah Keluarga': p.family_count || 0,
    'Kupon Makan': p.wants_meal ? 'Ya' : 'Tidak',
    'Souvenir': p.wants_souvenir ? 'Ya' : 'Tidak',
    'Jenis': p.invited ? 'Undangan' : 'Tanpa undangan',
    Hadir: p.attended ? 'Ya' : 'Tidak',
    'Waktu Hadir': p.attended_at ? fmtDateTime(p.attended_at) : '',
    Sumber: sourceLabel(p.source),
    Pemenang: win.get(p.id) || '',
    Token: p.token
  }));
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc1 = (v) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc1(r[h])).join(','))].join('\r\n');
}

/** Unduh blob. Mengembalikan Promise agar pemanggil bisa menampilkan status. */
function saveBlob(blob, filename) {
  return new Promise((resolve, reject) => {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      resolve(true);
    } catch (e) { reject(e); }
  });
}

function downloadCsv() {
  const rows = csvRows();
  if (!rows.length) { toast('Belum ada data.', 'warn'); return; }
  const blob = new Blob(['\uFEFF' + toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  saveBlob(blob, `absensi-natal-${new Date().toISOString().slice(0, 10)}.csv`)
    .then(() => toast('CSV diunduh.', 'ok'))
    .catch(() => toast('Peramban memblokir unduhan. Coba lagi.', 'err'));
}

function downloadXlsx(btn) {
  const rows = csvRows();
  if (!rows.length) { toast('Belum ada data.', 'warn'); return; }
  withBusy(btn, 'Menyiapkan…', async () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Absensi (semua kolom)
    const ws1 = XLSX.utils.json_to_sheet(rows);
    ws1['!cols'] = [{ wch: 8 }, { wch: 26 }, { wch: 22 }, { wch: 15 }, { wch: 10 },
      { wch: 15 }, { wch: 8 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Absensi');

    // Sheet 2: Pemenang
    const prizeName = new Map(S.data.prizes.map((z) => [z.id, z.name]));
    const winRows = S.data.winners.map((w, i) => {
      const p = S.data.participants.find((x) => x.id === w.participant_id) || {};
      return {
        No: i + 1,
        Hadiah: prizeName.get(w.prize_id) || '—',
        'Nomor Undian': pad3(p.lottery_no),
        Nama: p.name || '—',
        Asal: p.org || '',
        'No. HP': p.phone || '',
        Status: w.status === 'confirmed' ? 'Pemenang' : 'Tidak hadir',
        'Waktu Undi': fmtDateTime(w.drawn_at)
      };
    });
    const ws2 = XLSX.utils.json_to_sheet(winRows.length ? winRows : [{ Info: 'Belum ada pemenang' }]);
    ws2['!cols'] = [{ wch: 5 }, { wch: 24 }, { wch: 12 }, { wch: 26 }, { wch: 22 }, { wch: 15 }, { wch: 12 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Pemenang');

    XLSX.writeFile(wb, `absensi-natal-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast('Excel diunduh.', 'ok');
  });
}

/* =============================================================== hadiah */
function renderPrizes() {
  const list = document.getElementById('prize-list');
  const prizes = S.data.prizes || [];
  if (!prizes.length) {
    list.innerHTML = '<p class="small" style="color:var(--ink-soft)">Belum ada hadiah. Tambahkan di atas.</p>';
    return;
  }
  const counts = {};
  for (const w of S.data.winners) {
    if (w.status === 'confirmed') counts[w.prize_id] = (counts[w.prize_id] || 0) + 1;
  }
  list.innerHTML = prizes.map((z) => {
    const got = counts[z.id] || 0;
    const left = Math.max(0, z.qty - got);
    return `
      <div class="person" data-id="${esc(z.id)}">
        <div class="person__no">${esc(String(z.qty))}</div>
        <div class="person__body">
          <div class="person__name">${esc(z.name)}</div>
          <div class="person__meta">${z.qty} pemenang · terundi ${got} · <strong>sisa ${left}</strong></div>
        </div>
        <div class="person__side">
          <button class="btn btn--outline btn--sm" data-act="prize-edit" data-id="${esc(z.id)}">Edit</button>
          <button class="btn btn--outline btn--sm" data-act="prize-del" data-id="${esc(z.id)}">Hapus</button>
        </div>
      </div>`;
  }).join('');
}

function renderWinners() {
  const box = document.getElementById('winner-list');
  const winners = S.data.winners || [];
  if (!winners.length) {
    box.innerHTML = '<p class="small" style="color:var(--ink-soft)">Belum ada pemenang.</p>';
    return;
  }
  const prizeName = new Map(S.data.prizes.map((z) => [z.id, z.name]));
  box.innerHTML = winners.map((w) => {
    const p = S.data.participants.find((x) => x.id === w.participant_id) || {};
    return `
      <div class="person" data-id="${esc(w.id)}">
        <div class="person__no">${esc(pad3(p.lottery_no))}</div>
        <div class="person__body">
          <div class="person__name">${esc(p.name || '—')}</div>
          <div class="person__meta">${esc(prizeName.get(w.prize_id) || '—')} · ${esc(fmtTime(w.drawn_at))}
            ${w.status === 'absent' ? '<span class="pill pill--belum">Tidak hadir</span>' : '<span class="pill pill--hadir">Pemenang</span>'}</div>
        </div>
        <div class="person__side">
          <button class="btn btn--outline btn--sm" data-act="winner-del" data-id="${esc(w.id)}">Batalkan</button>
        </div>
      </div>`;
  }).join('');
}

async function savePrize(ev) {
  ev.preventDefault();
  const name = document.getElementById('prize-name').value.trim();
  const qty = Number(document.getElementById('prize-qty').value || 1);
  const id = document.getElementById('prize-id').value || null;
  if (!name) { toast('Nama hadiah wajib diisi.', 'err'); return; }

  const btn = document.getElementById('btn-prize-save');
  await withBusy(btn, 'Menyimpan…', async () => {
    try {
      const res = await api.adminPrizeSave(S.pin, { id, name, qty, sort_order: (S.data.prizes.length + 1) });
      if (!res?.ok) throw new Error(res?.message || 'Gagal menyimpan hadiah.');
      document.getElementById('prize-form').reset();
      document.getElementById('prize-id').value = '';
      document.getElementById('prize-qty').value = '1';
      document.getElementById('btn-prize-cancel').classList.add('hidden');
      await reload(true);
      toast('Hadiah tersimpan.', 'ok');
    } catch (e) { toast(e?.message || 'Gagal menyimpan hadiah.', 'err'); }
  });
}

/* ================================================================ setting */
function renderSettings() {
  document.getElementById('event-name-input').value = S.data.event_name || '';
  const open = Boolean(S.data.attendance_open);
  document.getElementById('attendance-state').textContent = open
    ? 'Absensi DIBUKA — peserta bisa konfirmasi hadir.'
    : 'Absensi DITUTUP — scan peserta & form umum dinonaktifkan.';
  const btn = document.getElementById('btn-toggle-open');
  btn.textContent = open ? 'Tutup absensi' : 'Buka absensi';
  btn.className = `btn ${open ? 'btn--red' : 'btn--gold'}`;
  document.getElementById('status-badge').textContent = open ? 'Absensi dibuka' : 'Absensi ditutup';
  document.getElementById('status-badge').className = `badge ${open ? 'badge--online' : 'badge--offline'}`;

  // peringatan PIN bawaan (status dari server)
  const d = S.defaultPins || {};
  const warn = document.getElementById('pin-warning');
  if (d.admin || d.staff) {
    const parts = [d.admin ? 'PIN admin' : null, d.staff ? 'PIN petugas' : null].filter(Boolean);
    warn.innerHTML = `<span class="notice__icon" aria-hidden="true">🚨</span>
      <div><strong>${parts.join(' dan ')} masih bawaan!</strong> Ganti PIN di bawah sebelum acara dimulai.</div>`;
    warn.classList.remove('hidden');
  } else {
    warn.classList.add('hidden');
  }
}

async function toggleAttendance() {
  const next = !S.data.attendance_open;
  const msg = next ? 'Buka absensi sekarang?' : 'Tutup absensi? Peserta tidak bisa konfirmasi hadir.';
  if (!confirm(msg)) return;
  try {
    const res = await api.adminSetSetting(S.pin, 'attendance_open', next ? 'true' : 'false');
    if (!res?.ok) throw new Error(res?.message || 'Gagal mengubah status.');
    S.data.attendance_open = next;
    renderSettings();
    toast(next ? 'Absensi dibuka.' : 'Absensi ditutup.', 'ok');
  } catch (e) { toast(e?.message || 'Gagal mengubah status.', 'err'); }
}

async function saveEventName() {
  const name = document.getElementById('event-name-input').value.trim();
  if (name.length < 3) { toast('Nama acara terlalu pendek.', 'err'); return; }
  try {
    const res = await api.adminSetSetting(S.pin, 'event_name', name);
    if (!res?.ok) throw new Error(res?.message || 'Gagal menyimpan.');
    document.getElementById('event-name').textContent = name;
    S.data.event_name = name;
    toast('Nama acara disimpan.', 'ok');
  } catch (e) { toast(e?.message || 'Gagal menyimpan.', 'err'); }
}

async function savePins(ev) {
  ev.preventDefault();
  const adminPin = document.getElementById('new-admin-pin').value.trim();
  const staffPin = document.getElementById('new-staff-pin').value.trim();
  if (!adminPin && !staffPin) { toast('Isi minimal satu PIN baru.', 'warn'); return; }
  if (adminPin && adminPin.length < 4) { toast('PIN admin minimal 4 karakter.', 'err'); return; }
  if (staffPin && staffPin.length < 4) { toast('PIN petugas minimal 4 karakter.', 'err'); return; }

  const btn = document.getElementById('btn-save-pins');
  await withBusy(btn, 'Menyimpan…', async () => {
    try {
      if (adminPin) {
        await api.adminChangePin(S.pin, 'admin', adminPin);
        S.pin = adminPin;
        store.set(K.pin, adminPin);
      }
      if (staffPin) await api.adminChangePin(S.pin, 'staff', staffPin);
      document.getElementById('new-admin-pin').value = '';
      document.getElementById('new-staff-pin').value = '';
      document.getElementById('pin-warning').classList.add('hidden');
      toast('PIN berhasil diganti. Catat di tempat aman!', 'ok', 5000);
    } catch (e) { toast(e?.message || 'Gagal mengganti PIN.', 'err', 5000); }
  });
}

async function doReset(scope) {
  const label = { winners: 'pemenang', attendance: 'absensi', all: 'SEMUA data' }[scope];
  if (!confirm(`Reset ${label}? Tindakan ini tidak bisa dibatalkan.`)) return;
  const word = scope === 'all' ? 'HAPUS SEMUA' : 'RESET';
  const typed = prompt(`Ketik ${word} untuk melanjutkan.`);
  if ((typed || '').trim().toUpperCase() !== word) { toast('Reset dibatalkan.', 'warn'); return; }
  try {
    const res = await api.adminReset(S.pin, scope);
    if (!res?.ok) throw new Error(res?.message || 'Reset gagal.');
    await reload(true);
    toast(`Reset ${label} selesai.`, 'ok');
  } catch (e) { toast(e?.message || 'Reset gagal.', 'err'); }
}

/* ======================================================= peserta manual */
function openPersonDialog() {
  S.editingPerson = null;
  document.getElementById('person-dialog-title').textContent = 'Tambah peserta manual';
  document.getElementById('person-form').reset();
  document.getElementById('p-attended').checked = true;
  document.getElementById('p-family').value = '0';
  document.getElementById('p-meal').checked = false;
  document.getElementById('p-souvenir').checked = false;
  document.getElementById('person-error').classList.add('hidden');
  document.getElementById('dialog-person').showModal();
}

async function submitPerson(ev) {
  const submitter = ev.submitter;
  if (submitter?.value === 'cancel') return;
  ev.preventDefault();
  const name = document.getElementById('p-name').value.trim();
  const phone = normPhone(document.getElementById('p-phone').value);
  const org = document.getElementById('p-org').value.trim();
  const family = Math.min(5, Number(document.getElementById('p-family').value || 0));
  const attended = document.getElementById('p-attended').checked;
  const meal = document.getElementById('p-meal').checked;
  const souvenir = document.getElementById('p-souvenir').checked;

  if (name.length < 2) {
    document.getElementById('person-error-text').textContent = 'Nama lengkap wajib diisi.';
    document.getElementById('person-error').classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('btn-person-save');
  await withBusy(btn, 'Menyimpan…', async () => {
    try {
      const res = await api.adminAdd(S.pin, {
        name, phone, org, family_count: family, attended, invited: false, meal, souvenir
      });
      if (!res?.ok) throw new Error(res?.message || 'Gagal menambah peserta.');
      document.getElementById('dialog-person').close();
      await reload(true);
      toast(`${res.name} terdaftar dengan nomor ${pad3(res.lottery_no)}.`, 'ok', 4000);
    } catch (e) {
      document.getElementById('person-error-text').textContent = e?.message || 'Gagal menambah peserta.';
      document.getElementById('person-error').classList.remove('hidden');
    }
  });
}

function openEditDialog(id) {
  const p = S.data.participants.find((x) => x.id === id);
  if (!p) return;
  S.editingPerson = p;
  document.getElementById('e-id').value = p.id;
  document.getElementById('e-name').value = p.name;
  document.getElementById('e-phone').value = p.phone || '';
  document.getElementById('e-org').value = p.org || '';
  document.getElementById('e-family').value = String(Math.min(5, p.family_count || 0));
  document.getElementById('e-meal').checked = Boolean(p.wants_meal);
  document.getElementById('e-souvenir').checked = Boolean(p.wants_souvenir);
  document.getElementById('edit-error').classList.add('hidden');
  document.getElementById('dialog-edit').showModal();
}

async function submitEdit(ev) {
  if (ev.submitter?.value === 'cancel') return;
  ev.preventDefault();
  const id = document.getElementById('e-id').value;
  const fields = {
    name: document.getElementById('e-name').value.trim(),
    phone: document.getElementById('e-phone').value.trim(),
    org: document.getElementById('e-org').value.trim(),
    family_count: Math.min(5, Number(document.getElementById('e-family').value || 0)),
    family_names: null,     // nama anggota keluarga tidak lagi dicatat
    wants_meal: document.getElementById('e-meal').checked,
    wants_souvenir: document.getElementById('e-souvenir').checked
  };
  if (fields.name.length < 2) {
    document.getElementById('edit-error-text').textContent = 'Nama lengkap wajib diisi.';
    document.getElementById('edit-error').classList.remove('hidden');
    return;
  }
  try {
    const res = await api.adminUpdate(S.pin, id, fields);
    if (!res?.ok) throw new Error(res?.message || 'Gagal menyimpan.');
    document.getElementById('dialog-edit').close();
    await reload(true);
    toast('Data peserta diperbarui.', 'ok');
  } catch (e) {
    document.getElementById('edit-error-text').textContent = e?.message || 'Gagal menyimpan.';
    document.getElementById('edit-error').classList.remove('hidden');
  }
}

async function togglePerson(id) {
  const p = S.data.participants.find((x) => x.id === id);
  if (!p) return;
  try {
    const res = await api.adminToggle(S.pin, id, !p.attended);
    if (!res?.ok) throw new Error(res?.message || 'Gagal.');
    p.attended = res.attended;
    p.attended_at = res.attended_at;
    renderStats(); renderRekap();
    toast(`${p.name}: ${res.attended ? 'ditandai hadir' : 'dibatalkan hadirnya'}.`, 'ok', 2400);
  } catch (e) { toast(e?.message || 'Gagal mengubah status.', 'err'); }
}

async function deletePerson(id) {
  const p = S.data.participants.find((x) => x.id === id);
  if (!p) return;
  if (!confirm(`Hapus peserta ${p.name} (${pad3(p.lottery_no)})? Nomor undiannya akan hilang.`)) return;
  try {
    const res = await api.adminDelete(S.pin, id);
    if (!res?.ok) throw new Error(res?.message || 'Gagal menghapus.');
    await reload(true);
    toast('Peserta dihapus.', 'ok');
  } catch (e) { toast(e?.message || 'Gagal menghapus.', 'err'); }
}

/* ================================================================== tabs */
/** Isi pratinjau kartu sekali bila belum ada (dipanggil setelah data termuat). */
function ensureCards() {
  const sheet = document.getElementById('inv-sheet');
  if (!sheet || !S.data.participants.length) return;
  if (!sheet.querySelector('.card15')) buildCards();
}

function switchTab(tab, remember = true) {
  const map = { rekap: 'panel-rekap', undangan: 'panel-undangan', hadiah: 'panel-hadiah', setting: 'panel-setting' };
  for (const [key, id] of Object.entries(map)) {
    document.getElementById(id)?.classList.toggle('hidden', key !== tab);
    document.getElementById(`tab-${key}`)?.setAttribute('aria-selected', key === tab ? 'true' : 'false');
  }
  if (remember) store.set(K.tab, tab);
  if (tab === 'undangan' && !document.getElementById('inv-sheet').children.length) buildCards();
}

/* ================================================================= event */
function bind() {
  document.getElementById('login-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = document.getElementById('pin-input').value.trim();
    if (pin.length < 4) { toast('PIN minimal 4 karakter.', 'err'); return; }
    doLogin(pin);
  });

  ['rekap', 'undangan', 'hadiah', 'setting'].forEach((t) =>
    document.getElementById(`tab-${t}`)?.addEventListener('click', () => switchTab(t)));

  document.getElementById('btn-reload')?.addEventListener('click', () => reload(false));
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    store.del(K.pin);
    location.reload();
  });

  // rekap
  document.getElementById('rekap-search')?.addEventListener('input', debounce((e) => {
    S.search = e.target.value;
    renderRekap();
  }, 200));
  document.getElementById('rekap-filters')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    S.filter = chip.dataset.filter;
    $$('#rekap-filters .chip').forEach((c) => c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'));
    renderRekap();
  });
  document.getElementById('rekap-body')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const { act, id } = btn.dataset;
    if (act === 'toggle') togglePerson(id);
    if (act === 'edit') openEditDialog(id);
    if (act === 'delete') deletePerson(id);
  });
  document.getElementById('btn-add-person')?.addEventListener('click', openPersonDialog);
  document.getElementById('btn-xlsx')?.addEventListener('click', (e) => downloadXlsx(e.currentTarget));
  document.getElementById('btn-csv')?.addEventListener('click', downloadCsv);

  // undangan
  document.getElementById('btn-template')?.addEventListener('click', downloadTemplate);
  document.getElementById('file-input')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  });
  const dz = document.getElementById('dropzone');
  dz?.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('is-drag'); });
  dz?.addEventListener('dragleave', () => dz.classList.remove('is-drag'));
  dz?.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('is-drag');
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });
  document.getElementById('btn-qr-zip')?.addEventListener('click', (e) => downloadQrZip(e.currentTarget));
  document.getElementById('btn-cards-pdf')?.addEventListener('click', () => exportCardsPdf());
  document.getElementById('btn-cards-pdf-all')?.addEventListener('click', () => exportCardsPdf({ all: true }));
  // tombol lama (bila masih ada di halaman lain) tetap berfungsi sebagai ekspor PDF
  document.getElementById('btn-print-cards')?.addEventListener('click', () => exportCardsPdf());
  document.getElementById('btn-preview-cards')?.addEventListener('click', () => exportCardsPdf());
  const layoutEl = document.getElementById('card-layout');
  if (layoutEl) {
    layoutEl.value = store.get(K.cardLayout, 'a4-4');
    layoutEl.addEventListener('change', () => {
      store.set(K.cardLayout, layoutEl.value);
      buildCards();
    });
  }
  for (const [id, key] of [['card-when', K.cardWhen], ['card-place', K.cardPlace]]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.value = store.get(key, '');
    el.addEventListener('change', () => { store.set(key, el.value.trim()); buildCards(); });
  }
  document.getElementById('btn-links-xlsx')?.addEventListener('click', exportLinksXlsx);
  document.getElementById('btn-general-qr')?.addEventListener('click', showGeneralQr);
  document.getElementById('btn-build-cards')?.addEventListener('click', buildCards);
  document.getElementById('domain-input')?.addEventListener('change', (e) => {
    let v = e.target.value.trim().replace(/\/+$/, '');
    if (v && !/^https?:\/\//i.test(v)) v = `https://${v}`;
    store.set(K.domain, v);
    document.getElementById('domain-hint').textContent = `QR memakai alamat khusus: ${v}`;
    toast('Domain QR diperbarui.', 'ok', 2000);
    if (document.getElementById('inv-sheet').children.length) buildCards();
  });

  // hadiah
  document.getElementById('prize-form')?.addEventListener('submit', savePrize);
  document.getElementById('btn-prize-cancel')?.addEventListener('click', () => {
    document.getElementById('prize-form').reset();
    document.getElementById('prize-id').value = '';
    document.getElementById('prize-qty').value = '1';
    document.getElementById('btn-prize-cancel').classList.add('hidden');
  });
  document.getElementById('prize-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const { act, id } = btn.dataset;
    if (act === 'prize-edit') {
      const z = S.data.prizes.find((x) => x.id === id);
      if (!z) return;
      document.getElementById('prize-id').value = z.id;
      document.getElementById('prize-name').value = z.name;
      document.getElementById('prize-qty').value = z.qty;
      document.getElementById('btn-prize-cancel').classList.remove('hidden');
      document.getElementById('prize-name').focus();
    }
    if (act === 'prize-del') {
      if (!confirm('Hapus hadiah ini? Pemenangnya ikut terhapus.')) return;
      try {
        await api.adminPrizeDelete(S.pin, id);
        await reload(true);
        toast('Hadiah dihapus.', 'ok');
      } catch (err) { toast(err?.message || 'Gagal menghapus.', 'err'); }
    }
  });
  document.getElementById('winner-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act="winner-del"]');
    if (!btn) return;
    if (!confirm('Batalkan pemenang ini? Peserta kembali menjadi kandidat undian.')) return;
    try {
      await api.adminWinnerDelete(S.pin, btn.dataset.id);
      await reload(true);
      toast('Pemenang dibatalkan.', 'ok');
    } catch (err) { toast(err?.message || 'Gagal membatalkan.', 'err'); }
  });

  // setting
  document.getElementById('btn-toggle-open')?.addEventListener('click', toggleAttendance);
  document.getElementById('btn-save-event')?.addEventListener('click', saveEventName);
  document.getElementById('pin-form')?.addEventListener('submit', savePins);
  document.getElementById('panel-setting')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-reset]');
    if (btn) doReset(btn.dataset.reset);
  });

  // dialog
  document.getElementById('person-form')?.addEventListener('submit', submitPerson);
  document.getElementById('edit-form')?.addEventListener('submit', submitEdit);

  window.addEventListener('online', () => { setNet(true); reload(true); });
  window.addEventListener('offline', () => setNet(false));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && online()) reload(true);
  });
}

/* ================================================================== mulai */
function main() {
  bind();
  setNet(online());
  const saved = store.get(K.pin, '');
  if (saved) {
    S.pin = saved;
    enterApp();
  } else {
    document.getElementById('pin-input').focus();
  }
}

main();

/* diekspor agar ekspor PDF bisa diuji otomatis (jsdom) */
export { exportCardsPdf };
