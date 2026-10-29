/**
 * make-demo.mjs — membuat demo.html: pratinjau desain statis (data palsu).
 * CSS di-inline agar bisa dipratinjau tanpa jaringan/server.
 * Jalankan: node tools/make-demo.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'styles.css'), 'utf8');

const pad = (n) => String(n).padStart(3, '0');

const people = [
  ['Budi Santoso', 'Divisi TI', '081200000007', 7, true, '07:12', 'scan_sendiri'],
  ['Siti Aminah', 'Keuangan', '081200000027', 27, true, '07:19', 'petugas'],
  ['Yohanes Sinaga', 'Wilayah Medan Kota', '081200000113', 113, true, '07:31', 'form_umum'],
  ['Maria Sinaga', 'Wilayah Medan Kota', '081200000204', 204, false, '—', 'manual'],
  ['Andreas Tobing', 'Pemuda', '081200000318', 318, true, '07:44', 'scan_sendiri'],
  ['Rudi Hartono', 'Umum', '081200000501', 501, true, '07:52', 'petugas'],
  ['Grace Simbolon', 'Wilayah Medan Baru', '081200000502', 502, true, '07:58', 'form_umum']
];

const rekapRows = people.map(([name, org, phone, no, hadir, time, src]) => `
  <tr>
    <td data-label="No"><span class="num">${pad(no)}</span></td>
    <td data-label="Nama"><strong>${name}</strong></td>
    <td data-label="Asal">${org}</td>
    <td data-label="HP">${phone}</td>
    <td data-label="Undian"><span class="num">${pad(no)}</span></td>
    <td data-label="Status">${hadir ? '<span class="pill pill--hadir">Hadir</span>' : '<span class="pill pill--belum">Belum</span>'}</td>
    <td data-label="Waktu">${time}</td>
    <td data-label="Sumber">${src === 'scan_sendiri' ? 'Scan sendiri' : src === 'petugas' ? 'Petugas' : src === 'form_umum' ? 'Form umum' : 'Manual'}${
      no >= 501 ? ' <span class="pill pill--walkin">tanpa undangan</span>' : ''}</td>
    <td data-label="Aksi"><div class="actions">
      <button class="btn btn--outline btn--sm">${hadir ? 'Batal' : 'Hadir'}</button>
      <button class="btn btn--outline btn--sm">Edit</button>
      <button class="btn btn--outline btn--sm">WA</button>
    </div></td>
  </tr>`).join('');

const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pratinjau Desain — Absensi Natal</title>
<style>
${css}
/* --- khusus halaman pratinjau --- */
.demo-nav { position: sticky; top: 0; z-index: 50; display: flex; gap: 6px; flex-wrap: wrap;
  padding: 10px 14px; background: rgba(53,32,22,.96); border-bottom: 3px solid #83322D; }
.demo-nav a { color: var(--kraft-300); font: 600 .78rem var(--font-ui); text-decoration: none;
  padding: 7px 12px; border-radius: 999px; border: 1px solid rgba(235,222,203,.32); }
.demo-nav a:hover { background: rgba(217,169,107,.2); color: var(--kraft-100); }
.demo-label { display: inline-block; margin-bottom: 10px; padding: 4px 10px; border-radius: 999px;
  background: rgba(217,169,107,.22); border: 1px solid rgba(217,169,107,.55);
  color: #FFF6E4; font: 700 .7rem var(--font-ui); letter-spacing: .08em; text-transform: uppercase; }
.demo-block { padding: 26px 0 8px; }
.demo-grid2 { display: grid; gap: 14px; grid-template-columns: 1fr; }
@media (min-width: 900px) { .demo-grid2 { grid-template-columns: 1fr 1fr; } }
.demo-phone { max-width: 400px; margin: 0 auto; }
.screen-demo { position: relative; height: auto; min-height: 0; border-radius: 18px; overflow: hidden;
  padding: 18px; border: 2px solid rgba(235,222,203,.4);
  background: radial-gradient(900px 520px at 50% -8%, #4A5127 0%, transparent 62%),
    radial-gradient(760px 460px at 4% 104%, rgba(131,50,45,.55) 0%, transparent 60%),
    radial-gradient(760px 460px at 98% 96%, rgba(85,61,41,.6) 0%, transparent 60%),
    linear-gradient(170deg, #2E3516 0%, #241A12 55%, #1B120C 100%); }
.digit-demo { font-size: clamp(3.4rem, 12vw, 7rem); }
</style>
</head>
<body>
<div class="snow" aria-hidden="true"></div>

<nav class="demo-nav">
  <a href="#peserta">1 · Peserta</a>
  <a href="#petugas">2 · Petugas</a>
  <a href="#admin">3 · Admin</a>
  <a href="#undian">4 · Layar Undian</a>
  <a href="#kartu">5 · Kartu Undangan</a>
</nav>

<main class="wrap wrap--wide stack">

  <section class="demo-block center">
    <span class="demo-label">Pratinjau desain statis · data contoh</span>
    <h1 style="font-family:var(--font-display);color:var(--cocoa-800);margin:0 0 4px">Absensi &amp; Undian Natal</h1>
    <p class="small" style="color:var(--ink-soft);margin:0">
      Halaman ini hanya pratinjau tampilan. Aplikasi sebenarnya: index.html · petugas.html · admin.html · undian.html
    </p>
  </section>

  <!-- ================= 1. PESERTA ================= -->
  <section class="demo-block" id="peserta">
    <div class="demo-label">Halaman peserta — layar sukses</div>
    <div class="demo-grid2">
      <div class="demo-phone">
        <div class="card card--ribbon stack center">
          <div class="participant-hero" style="padding:0;color:var(--ink)">
            <div class="participant-hero__orn" aria-hidden="true">🎁</div>
            <h1 style="color:var(--green-800)">Selamat datang, Budi Santoso! ✅</h1>
            <p style="color:var(--ink-soft)">dari Divisi TI</p>
          </div>
          <div class="number-plate" style="align-self:center">
            <div class="number number--hero">007</div>
          </div>
          <div class="screenshot-hint">📸 Screenshot nomor ini untuk undian</div>
          <div class="notice notice--info">
            <span class="notice__icon" aria-hidden="true">🧾</span>
            <div><strong>Tercatat panitia:</strong> 👨‍👩‍👧 2 anggota keluarga · 🍱 Kupon makan.
              Silakan ambil di meja registrasi.</div>
          </div>
          <div class="notice notice--success">
            <span class="notice__icon" aria-hidden="true">🍀</span>
            <div>Nomor ini adalah nomor undian Anda. Simpan sampai acara selesai.</div>
          </div>
          <button class="btn btn--outline btn--block">Selesai</button>
        </div>
      </div>

      <div class="demo-phone stack">
        <div class="card stack">
          <div class="participant-hero" style="padding:0">
            <div class="participant-hero__orn" aria-hidden="true">✅</div>
            <h1 style="color:var(--green-700)">Anda sudah tercatat hadir</h1>
            <p style="color:var(--ink-soft);margin:0 0 2px">Budi Santoso</p>
            <p style="color:var(--ink-soft)">pukul <strong>07:12</strong></p>
          </div>
          <div class="center">
            <div class="small" style="color:var(--ink-soft)">Nomor undian Anda</div>
            <div class="number number--mid" style="color:var(--green-700)">007</div>
          </div>
          <div class="notice notice--info">
            <span class="notice__icon" aria-hidden="true">📸</span>
            <div>Nomor <strong>tidak berubah</strong> walau Anda scan ulang.</div>
          </div>
        </div>
        <div class="card card--flat">
          <h2 class="card__title">Form tanpa undangan</h2>
          <p class="card__sub">Dipakai peserta yang tidak membawa undangan.</p>
          <label class="field"><span class="label">Nama lengkap *</span>
            <input class="input" value="Rudi Hartono" readonly></label>
          <label class="field"><span class="label">No. HP / WhatsApp *</span>
            <input class="input" value="0817 000 111" readonly>
            <span class="hint">Satu nomor HP = satu peserta.</span></label>
          <label class="field"><span class="label">Jumlah anggota keluarga yang ikut</span>
            <select class="select" disabled>
              <option>Tidak membawa keluarga</option>
              <option>1 orang</option>
              <option selected>2 orang</option>
              <option>3 orang</option>
              <option>4 orang</option>
              <option>5 orang (maksimal)</option>
            </select></label>
          <div class="field">
            <span class="label">Nama anggota keluarga (opsional)</span>
            <input class="input" value="Yosef" readonly>
            <input class="input" value="Maria" readonly style="margin-top:8px">
          </div>
          <fieldset class="check-card">
            <legend class="check-card__legend">Ambil di meja registrasi</legend>
            <label class="check-row">
              <input type="checkbox" checked disabled>
              <span class="check-row__box" aria-hidden="true">🍱</span>
              <span class="check-row__text"><strong>Kupon Makan</strong>
                <span>Termasuk anggota keluarga yang ikut</span></span>
            </label>
            <label class="check-row">
              <input type="checkbox" disabled>
              <span class="check-row__box" aria-hidden="true">🎁</span>
              <span class="check-row__text"><strong>Souvenir</strong>
                <span>Satu souvenir untuk setiap peserta yang hadir</span></span>
            </label>
          </fieldset>
          <button class="btn btn--red btn--block">Konfirmasi Hadir</button>
        </div>
      </div>
    </div>
  </section>

  <!-- ================= 2. PETUGAS ================= -->
  <section class="demo-block" id="petugas">
    <div class="demo-label">Aplikasi petugas — mode offline</div>
    <div class="demo-grid2">
      <div class="stack">
        <div class="stats" style="grid-template-columns:repeat(3,1fr)">
          <div class="stat"><div class="stat__label">Hadir</div><div class="stat__value">214</div></div>
          <div class="stat"><div class="stat__label">Total peserta</div><div class="stat__value">312</div></div>
          <div class="stat stat--accent"><div class="stat__label">Antrean</div><div class="stat__value">3</div></div>
        </div>
        <div class="row"><span class="badge badge--offline">Offline</span>
          <span class="badge badge--queue">Antrean 3</span>
          <span class="badge badge--plain">Jatah nomor 27</span></div>
        <div class="notice notice--dark small">
          <span class="notice__icon" aria-hidden="true">📡</span>
          <div>Offline. Semua catatan disimpan di HP ini dan akan dikirim saat sinyal kembali.</div>
        </div>
      </div>

      <div class="stack">
        <div class="scan-card scan-card--ok">
          <div class="small" style="letter-spacing:.08em;text-transform:uppercase;opacity:.9">Hadir tercatat</div>
          <div class="scan-card__name">Siti Aminah</div>
          <div class="scan-card__no">027</div>
          <div class="scan-card__meta">Sebutkan nomor undian: <strong>027</strong></div>
          <div class="scan-card__meta">👨‍👩‍👧 2 keluarga (Yosef, Maria) · 🍱 Kupon makan</div>
          <div class="scan-card__meta" style="margin-top:6px">Keuangan · 081311112222</div>
        </div>
        <div class="scan-card scan-card--dup">
          <div class="small" style="letter-spacing:.08em;text-transform:uppercase;opacity:.9">Sudah absen</div>
          <div class="scan-card__name">Andreas Tobing</div>
          <div class="scan-card__no">318</div>
          <div class="scan-card__meta">Sudah absen pukul 07:44 · Pemuda</div>
        </div>
        <div class="scan-card scan-card--err">
          <div class="small" style="letter-spacing:.08em;text-transform:uppercase;opacity:.9">QR tidak dikenal</div>
          <div class="scan-card__name">Undangan tidak terdaftar</div>
          <div class="scan-card__meta">Daftarkan lewat tab Tambah bila peserta tanpa undangan.</div>
        </div>
      </div>
    </div>
  </section>

  <!-- ================= 3. ADMIN ================= -->
  <section class="demo-block" id="admin">
    <div class="demo-label">Panel admin — rekap hadir</div>
    <div class="stats">
      <div class="stat"><div class="stat__label">Total undangan</div><div class="stat__value">300</div></div>
      <div class="stat"><div class="stat__label">Hadir undangan</div><div class="stat__value">206</div></div>
      <div class="stat"><div class="stat__label">Belum hadir</div><div class="stat__value">94</div></div>
      <div class="stat stat--accent"><div class="stat__label">Tanpa undangan</div><div class="stat__value">8/12</div></div>
      <div class="stat stat--gold"><div class="stat__label">Total hadir</div><div class="stat__value">214</div></div>
      <div class="stat"><div class="stat__label">Pemenang</div><div class="stat__value">3</div></div>
    </div>

    <div class="stats">
      <div class="stat"><div class="stat__label">Total jiwa hadir</div><div class="stat__value">251</div></div>
      <div class="stat"><div class="stat__label">Anggota keluarga</div><div class="stat__value">37</div></div>
      <div class="stat stat--accent"><div class="stat__label">🍱 Kupon makan</div>
        <div class="stat__value">198</div>
        <div class="small" style="color:var(--ink-soft)">161 peserta + 37 keluarga</div></div>
      <div class="stat stat--gold"><div class="stat__label">🎁 Souvenir</div><div class="stat__value">176</div></div>
    </div>

    <div class="card card--flat stack" style="padding:14px;margin-top:14px">
      <div class="row row--between">
        <strong class="small" style="color:var(--green-800)">Rincian per sumber</strong>
        <span class="small" style="color:var(--ink-soft)">Diperbarui 20:14</span>
      </div>
      <div class="filters">
        <span class="badge badge--plain">Scan sendiri: <strong>148</strong></span>
        <span class="badge badge--plain">Petugas: <strong>42</strong></span>
        <span class="badge badge--plain">Form umum: <strong>16</strong></span>
        <span class="badge badge--plain">Manual: <strong>8</strong></span>
        <span class="badge badge--gold">Hadir 214 / 312</span>
      </div>
      <div class="row row--between" style="margin-top:6px">
        <strong class="small" style="color:var(--green-800)">Daftar peserta</strong>
        <div class="row" style="gap:6px">
          <button class="btn btn--outline btn--sm">➕ Tambah</button>
          <button class="btn btn--gold btn--sm">⬇️ Excel</button>
          <button class="btn btn--outline btn--sm">⬇️ CSV</button>
        </div>
      </div>
      <input class="input" placeholder="Cari nama / HP / asal / nomor undian…" readonly>
      <div class="filters">
        <button class="chip" aria-pressed="true">Semua</button>
        <button class="chip" aria-pressed="false">Hadir</button>
        <button class="chip" aria-pressed="false">Belum hadir</button>
        <button class="chip" aria-pressed="false">Tanpa undangan</button>
        <button class="chip" aria-pressed="false">Pemenang</button>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>No</th><th>Nama</th><th>Asal</th><th>HP</th><th>Undian</th><th>Status</th><th>Waktu</th><th>Sumber</th><th>Aksi</th></tr></thead>
          <tbody>${rekapRows}</tbody>
        </table>
      </div>
    </div>
  </section>

  <!-- ================= 4. UNDIAN ================= -->
  <section class="demo-block" id="undian">
    <div class="demo-label">Layar undian — untuk proyektor</div>
    <div class="screen-demo">
      <div class="center">
        <h2 class="screen-title">Perayaan Natal 2026</h2>
        <div class="screen-prize">Kulkas 2 Pintu</div>
        <div class="small" style="color:var(--kraft-300)">Sisa 2 pemenang dari 2 · 214 kandidat</div>
      </div>
      <div class="center" style="padding:22px 0 8px">
        <div class="digits">
          <div class="digit digit-demo is-locked">0</div>
          <div class="digit digit-demo is-locked">2</div>
          <div class="digit digit-demo is-locked">7</div>
        </div>
        <div class="screen-winner is-on" style="margin-top:12px">
          Siti Aminah — 027
          <span class="org">Keuangan</span>
        </div>
      </div>
      <div class="row" style="justify-content:center;gap:8px;flex-wrap:wrap">
        <select class="select" style="max-width:260px"><option>Kulkas 2 Pintu — sisa 2</option></select>
        <button class="btn btn--gold btn--lg">▶ MULAI</button>
        <button class="btn btn--red btn--lg">✔ Konfirmasi Pemenang</button>
        <button class="btn btn--ghost">↻ Tidak Hadir — Undi Ulang</button>
        <button class="btn btn--ghost btn--sm">⟳ Segarkan data</button>
        <button class="btn btn--ghost btn--sm">⛶</button>
      </div>
      <div class="row" style="justify-content:center;gap:8px;margin-top:10px">
        <span class="badge badge--online">Online</span>
        <span class="badge badge--plain">Antrean 0</span>
        <span class="badge badge--plain">214 kandidat</span>
      </div>
    </div>
  </section>

  <!-- ================= 5. KARTU UNDANGAN ================= -->
  <section class="demo-block" id="kartu">
    <div class="demo-label">Kartu undangan cetak A4 (±12 per halaman)</div>
    <div class="inv-sheet">
      ${people.slice(0, 6).map(([name, org, , no]) => `
      <div class="inv-card">
        <div class="inv-card__head">Perayaan Natal 2026</div>
        <div class="inv-card__body">
          <div class="inv-card__qr">
            <div style="width:26mm;height:26mm;background:
              repeating-conic-gradient(#000 0 25%, #fff 0 50%) 0 0/6mm 6mm;border:1mm solid #fff"></div>
          </div>
          <div class="inv-card__info">
            <div class="inv-card__name">${name}</div>
            <div class="inv-card__org">${org}</div>
          </div>
        </div>
        <div class="inv-card__foot">Pindai QR untuk konfirmasi kehadiran.<br>Nomor undian muncul setelah scan.</div>
      </div>`).join('')}
    </div>
    <p class="small center" style="color:var(--ink-soft);margin-top:10px">
      (Pola kotak pada pratinjau ini hanya pengganti QR asli.)
    </p>
  </section>

  <footer class="center small" style="color:var(--ink-soft);padding:24px 0 40px">
    Pratinjau desain · dibuat otomatis oleh tools/make-demo.mjs
  </footer>
</main>
</body>
</html>
`;

writeFileSync(join(ROOT, 'demo.html'), html);
console.log(`demo.html dibuat (${(html.length / 1024).toFixed(0)} KB)`);
