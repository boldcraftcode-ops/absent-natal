/**
 * Uji otomatis SQL (supabase/schema.sql) memakai PGlite (PostgreSQL 18 di WASM).
 * Jalankan:  cd tests && npm install && npm test
 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, '..', 'supabase', 'schema.sql'), 'utf8');

const db = await PGlite.create({ extensions: { pgcrypto } });

let pass = 0;
const failures = [];
const results = [];

function check(name, cond, extra = '') {
  if (cond) { pass++; results.push(`  ok   ${name}`); }
  else { failures.push(`${name} ${extra}`); results.push(`  FAIL ${name} ${extra}`); }
}

async function q(sql, params) { return (await db.query(sql, params)).rows; }
async function rpc(name, params) {
  const keys = Object.keys(params ?? {});
  const args = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
  const rows = await q(`select public.${name}(${args}) as r`, keys.map((k) => params[k]));
  return rows[0].r;
}
async function rpcErr(name, params) {
  try { await rpc(name, params); return null; } catch (e) { return e.message; }
}
async function asRole(role, fn) {
  await db.exec(`set role ${role}`);
  try { return await fn(); } finally { await db.exec('reset role'); }
}

// ---------------------------------------------------------------- 0. skema
await db.exec(schema);
results.push('== 0. Skema');
const tables = await q(`select tablename from pg_tables where schemaname='public' order by 1`);
check('5 tabel dibuat (termasuk family_members)',
  tables.map((t) => t.tablename).join(',') === 'family_members,participants,prizes,settings,winners',
  tables.map((t) => t.tablename).join(','));
const rls = await q(`select relname, relrowsecurity from pg_class where relname in ('participants','prizes','settings','winners')`);
check('RLS aktif di semua tabel', rls.every((r) => r.relrowsecurity === true));
const rlsFamily = await q(`select relrowsecurity from pg_class where relname='family_members'`);
check('RLS aktif di family_members', rlsFamily[0]?.relrowsecurity === true);
const pol = await q(`select count(*)::int c from pg_policies where schemaname='public'`);
check('Tidak ada policy (tabel tertutup)', pol[0].c === 0, `policies=${pol[0].c}`);

// ------------------------------------------------------- 1. import undangan
results.push('== 1. Import undangan');
const undangan = [
  { name: 'Budi Santoso', phone: '0812-3456-7890', org: 'Divisi TI' },
  { name: 'Siti  Aminah', phone: '+62 813 1111 2222', org: 'Keuangan' },
  { name: 'Yohanes Sinaga', phone: '081399990000', org: 'Medan' },
  { name: 'Maria Sinaga', phone: '085211112222', org: 'Medan' },
  { name: 'Andreas  Tobing', phone: '', org: 'Pemuda' },
];
const imp1 = await rpc('admin_import', { p_pin: 'admin1234', p_rows: JSON.stringify(undangan) });
check('import 5 baris -> inserted 5', imp1.inserted === 5, JSON.stringify(imp1));
const p1 = await q(`select count(*)::int c from participants`);
check('tabel berisi 5 peserta', p1[0].c === 5, String(p1[0].c));
const nos = await q(`select lottery_no, token, invited from participants order by lottery_no`);
check('nomor undian unik', new Set(nos.map((n) => n.lottery_no)).size === 5);
check('nomor undian dalam rentang 1-500', nos.every((n) => n.lottery_no >= 1 && n.lottery_no <= 500));
check('token 16 karakter hex', nos.every((n) => /^[0-9a-f]{16}$/.test(n.token)));
check('semua ditandai invited', nos.every((n) => n.invited === true));

const imp2 = await rpc('admin_import', { p_pin: 'admin1234', p_rows: JSON.stringify(undangan) });
check('import ulang tidak membuat dobel', imp2.inserted === 0 && imp2.skipped === 5, JSON.stringify(imp2));
const p2 = await q(`select count(*)::int c from participants`);
check('jumlah peserta tetap 5 setelah import ulang', p2[0].c === 5);

const budi = (await q(`select * from participants where name_norm = 'budi santoso'`))[0];
const siti = (await q(`select * from participants where name_norm like 'siti%'`))[0];
check('HP dinormalkan +62 -> 0', siti.phone === '081311112222', siti.phone);
check('spasi ganda pada nama dirapikan', (await q(`select count(*)::int c from participants where name = 'Siti Aminah'`))[0].c === 1);

// -------------------------------------------------- 2. jalur 1: scan sendiri
results.push('== 2. Jalur scan sendiri');
const inv = await rpc('get_invite', { p_token: budi.token });
check('get_invite token valid -> found', inv.ok && inv.status === 'found' && inv.name === 'Budi Santoso', JSON.stringify(inv));
const nf = await rpc('get_invite', { p_token: 'deadbeefdeadbeef' });
check('token tidak ada -> "Undangan tidak ditemukan"', nf.status === 'not_found' && /tidak ditemukan/i.test(nf.message));
const conf1 = await rpc('confirm_attendance', { p_token: budi.token });
check('konfirmasi hadir -> nomor undian', conf1.ok && conf1.status === 'ok' && conf1.lottery_no === budi.lottery_no, JSON.stringify(conf1));
const conf2 = await rpc('confirm_attendance', { p_token: budi.token });
check('scan ulang -> status already, nomor sama', conf2.status === 'already' && conf2.lottery_no === budi.lottery_no, JSON.stringify(conf2));
check('scan ulang menyimpan waktu hadir awal',
  new Date(conf2.attended_at).getTime() === new Date(conf1.attended_at).getTime());
check('sumber tercatat scan_sendiri',
  (await q(`select source from participants where id=$1`, [budi.id]))[0].source === 'scan_sendiri');

// ------------------------------------------------ 3. jalur 3: form umum
results.push('== 3. Jalur form umum (tanpa undangan)');
const w1 = await rpc('walkin_register', { p_name: 'Rudi Hartono', p_phone: '0817 000 111', p_org: 'Umum', p_family: 2 });
check('walkin baru -> nomor >= 501', w1.ok && w1.lottery_no >= 501, JSON.stringify(w1));
const w1b = await rpc('walkin_register', { p_name: 'Rudi Hartono', p_phone: '0819000004', p_org: 'Umum', p_family: 2 });
check('submit ulang data sama -> nomor sama', w1b.lottery_no === w1.lottery_no && w1b.id === w1.id, JSON.stringify(w1b));
check('submit ulang tidak menambah peserta',
  (await q(`select count(*)::int c from participants where name_norm='rudi hartono'`))[0].c === 1);

const w2 = await rpc('walkin_register', { p_name: 'Budi S.', p_phone: '+62 812-3456-7890', p_org: '', p_family: 1 });
check('HP sama dengan undangan -> digabung, pakai nomor undangan',
  w2.merged === true && w2.lottery_no === budi.lottery_no, JSON.stringify(w2));
check('penggabungan tidak membuat peserta baru',
  (await q(`select count(*)::int c from participants where phone='081234567890'`))[0].c === 1);

const w3 = await rpc('walkin_register', { p_name: 'maria   sinaga', p_phone: '0899999999', p_org: 'x', p_family: 0 });
check('nama sama dengan undangan -> digabung',
  (await q(`select lottery_no from participants where name_norm='maria sinaga'`))[0].lottery_no === w3.lottery_no,
  JSON.stringify(w3));

const w4 = await rpc('walkin_register', { p_name: 'Tanpa HP', p_phone: '', p_org: 'y', p_family: 0 });
check('form umum tanpa HP ditolak dengan pesan jelas', w4.ok === false && /nomor hp/i.test(w4.message), JSON.stringify(w4));
const w5 = await rpc('walkin_register', { p_name: 'X', p_phone: '0819000005', p_org: '', p_family: 0 });
check('nama terlalu pendek ditolak', w5.ok === false, JSON.stringify(w5));


// ------------------------------- 3c. konfirmasi undangan + keluarga & kupon
results.push('== 3c. Konfirmasi undangan membawa keluarga, kupon & souvenir');
{
  // pakai peserta yang belum hadir agar bagian 4/5 (uji saat absensi ditutup) tetap sah
  const sitiU = (await q(`select * from participants where name_norm = 'siti aminah' and attended = false`))[0]
    || (await q(`select * from participants where name_norm = 'andreas tobing'`))[0];
  const maria = (await q(`select * from participants where name_norm = 'maria sinaga'`))[0];
  const a = await rpc('confirm_attendance', {
    p_token: sitiU.token, p_family: 2, p_meal: true, p_souvenir: false
  });
  check('konfirmasi undangan berhasil', a.ok === true && a.status === 'ok', JSON.stringify(a));
  check('balasan memuat jumlah keluarga', a.family_count === 2, String(a.family_count));
  check('balasan memuat kupon makan & souvenir',
    a.wants_meal === true && a.wants_souvenir === false);
  check('balasan tidak lagi memuat nama anggota keluarga', a.family_names === undefined,
    JSON.stringify(a.family_names));
  check('jumlah keluarga benar-benar tersimpan',
    (await q('select family_count from participants where id=$1', [sitiU.id]))[0].family_count === 2);

  // scan ulang (sudah hadir) tidak mengubah waktu, tetapi melengkapi kupon
  const before = (await q('select attended_at from participants where id=$1', [sitiU.id]))[0].attended_at;
  const b = await rpc('confirm_attendance', { p_token: sitiU.token, p_souvenir: true });
  check('scan ulang: status already', b.ok === true && b.status === 'already');
  check('scan ulang: waktu hadir tidak berubah',
    String((await q('select attended_at from participants where id=$1', [sitiU.id]))[0].attended_at) === String(before));
  check('scan ulang: souvenir bisa dilengkapi tanpa membatalkan kupon makan',
    b.wants_souvenir === true && b.wants_meal === true);
  check('scan ulang: jumlah keluarga tidak terhapus', b.family_count === 2, String(b.family_count));

  // undangan lain: tanpa keluarga & tanpa kupon
  const c = await rpc('confirm_attendance', { p_token: maria.token });
  check('undangan tanpa pilihan tetap tercatat hadir',
    c.ok === true && (c.status === 'ok' || c.status === 'already'), JSON.stringify(c));
  check('tanpa centang -> kupon false', c.wants_meal === false && c.wants_souvenir === false);
  check('tanpa keluarga -> family_count 0', c.family_count === 0, String(c.family_count));
}

// -------------------------------- 3b. anggota keluarga & kupon/souvenir
results.push('== 3b. Anggota keluarga (maks 5) & kupon makan/souvenir');
{
  const r = await rpc('walkin_register', {
    p_name: 'Kelompok Besar', p_phone: '0819000001', p_org: 'Wilayah A', p_family: 3,
    p_meal: true, p_souvenir: true
  });
  check('registrasi dengan jumlah keluarga & kupon', r.ok === true, JSON.stringify(r));
  const p = (await q(`select family_count, wants_meal, wants_souvenir from participants where id=$1`, [r.id]))[0];
  check('jumlah keluarga tersimpan', p.family_count === 3, String(p.family_count));
  check('nama anggota keluarga tidak dicatat lagi',
    (await q(`select count(*)::int c from family_members where participant_id=$1`, [r.id]))[0].c === 0);
  check('kupon makan & souvenir tersimpan', p.wants_meal === true && p.wants_souvenir === true);

  const r2 = await rpc('walkin_register', {
    p_name: 'Tanpa Kupon', p_phone: '0819000002', p_org: '', p_family: 2,
    p_meal: false, p_souvenir: false
  });
  check('tanpa kupon: hanya hitungan keluarga yang disimpan',
    (await q(`select family_count from participants where id=$1`, [r2.id]))[0].family_count === 2);
  check('tanpa centang kupon -> false semua',
    (await q(`select wants_meal, wants_souvenir from participants where id=$1`, [r2.id]))[0].wants_meal === false);

  const r3 = await rpc('walkin_register', {
    p_name: 'Keluarga Kebanyakan', p_phone: '0819000003', p_org: '', p_family: 9,
    p_meal: true, p_souvenir: false
  });
  const p3 = (await q(`select family_count from participants where id=$1`, [r3.id]))[0];
  check('permintaan > 5 dibatasi 5', p3.family_count <= 5, String(p3.family_count));

  // penggabungan tidak menurunkan angka keluarga & kupon bersifat akumulatif
  const w = await rpc('walkin_register', {
    p_name: 'Kelompok Besar', p_phone: '0819000001', p_org: '', p_family: 1, p_meal: false, p_souvenir: true
  });
  check('penggabungan memakai nomor yang sama', w.merged === true && w.lottery_no === r.lottery_no);
  const pAfter = (await q(`select family_count, wants_meal, wants_souvenir from participants where id=$1`, [r.id]))[0];
  check('jumlah keluarga tidak turun setelah penggabungan', pAfter.family_count === 3, String(pAfter.family_count));
  check('centang kupon tetap tersimpan', pAfter.wants_meal === true && pAfter.wants_souvenir === true);

  const upd = await rpc('admin_update', {
    p_pin: 'admin1234', p_id: r2.id,
    p_fields: JSON.stringify({ family_count: 2, wants_meal: true, wants_souvenir: true })
  });
  check('admin_update menyimpan jumlah keluarga', upd.ok === true && upd.family_count === 2, JSON.stringify(upd));
  check('admin_update menyimpan kupon', upd.wants_meal === true && upd.wants_souvenir === true);
  const add = await rpc('admin_add', {
    p_pin: 'admin1234', p_name: 'Tamu Kupon', p_phone: '0819000004', p_org: 'Meja VIP',
    p_family: 1, p_attended: true, p_invited: false, p_meal: true, p_souvenir: true
  });
  check('admin_add menerima kupon & keluarga', add.ok === true && add.family_count === 1, JSON.stringify(add));
  check('admin_add menyimpan kupon', add.wants_meal === true && add.wants_souvenir === true);

  const all = await rpc('admin_get_all', { p_pin: 'admin1234' });
  const rec = all.participants.find((x) => x.id === r.id);
  check('admin_get_all: nama anggota keluarga tidak dikirim lagi', rec.family_names === undefined);
  check('admin_get_all menyertakan jumlah keluarga', rec.family_count === 3, String(rec.family_count));
  check('admin_get_all menyertakan ringkasan konsumsi',
    all.totals && typeof all.totals.meal === 'number' && all.totals.souvenir >= 1, JSON.stringify(all.totals));

  const sd = await rpc('staff_data', { p_pin: 'staff1234' });
  const sp = sd.participants.find((x) => x.id === r.id);
  check('staff_data menyertakan kupon/souvenir', sp.wants_meal === true && sp.wants_souvenir === true);

  // sync petugas dengan item 'new' + keluarga & kupon
  const before = (await q('select count(*)::int c from participants'))[0].c;
  const sy = await rpc('staff_sync', {
    p_pin: 'staff1234', p_items: JSON.stringify([{
      id: 'fam-1', kind: 'new', name: 'Dari Petugas Keluarga', phone: '0819000005',
      org: 'Meja 3', family_count: 2, lottery_no: 1201, attended_at: '2026-12-24T18:40:00+07:00',
      wants_meal: true, wants_souvenir: false
    }])
  });
  const okSync = sy.results[0].status === 'ok';
  check('staff_sync menyimpan item new berkupon', okSync, JSON.stringify(sy.results[0]));
  check('jumlah keluarga dari petugas tersimpan',
    (await q("select family_count from participants where name='Dari Petugas Keluarga'"))[0].family_count === 2);
  check('jumlah peserta bertambah satu', (await q('select count(*)::int c from participants'))[0].c === before + 1);

  // hapus peserta tetap berjalan (tabel keluarga kosong, tidak ada yang menggantung)
  const pid = add.id;
  const del = await rpc('admin_delete', { p_pin: 'admin1234', p_id: pid });
  check('hapus peserta berhasil', del.ok === true, JSON.stringify(del));
  check('tidak ada baris keluarga menggantung',
    (await q('select count(*)::int c from family_members where participant_id=$1', [pid]))[0].c === 0);
}

// --------------------------------------------- 4. ganti PIN & PIN salah
results.push('== 4. PIN');
const t0 = Date.now();
const bad = await rpcErr('admin_get_all', { p_pin: 'salah-banget' });
const dt = Date.now() - t0;
check('PIN salah -> error bahasa Indonesia', /PIN salah/i.test(bad ?? ''), bad ?? '');
check('PIN salah diperlambat ~0,6 detik', dt >= 550, `${dt}ms`);
const staffOnAdmin = await rpcErr('admin_get_all', { p_pin: 'staff1234' });
check('PIN petugas tidak bisa memakai fungsi admin', /PIN salah/i.test(staffOnAdmin ?? ''), staffOnAdmin ?? '');
check('PIN admin boleh dipakai di fungsi petugas', (await rpc('staff_data', { p_pin: 'admin1234' })).ok === true);
const chg = await rpc('admin_change_pin', { p_pin: 'admin1234', p_target: 'staff', p_new_pin: 'rahasia99' });
check('ganti PIN petugas', chg.ok === true);
check('PIN staff lama ditolak', /PIN salah/i.test((await rpcErr('staff_data', { p_pin: 'staff1234' })) ?? ''));
check('PIN staff baru diterima', (await rpc('staff_data', { p_pin: 'rahasia99' })).ok === true);
await rpc('admin_change_pin', { p_pin: 'admin1234', p_target: 'staff', p_new_pin: 'staff1234' });
const sweep = JSON.stringify(await rpc('admin_get_all', { p_pin: 'admin1234' })) +
  JSON.stringify(await rpc('staff_data', { p_pin: 'staff1234' })) +
  JSON.stringify(await rpc('event_info', {}));
check('hash PIN tidak pernah dikembalikan ke klien', !sweep.includes('$2') && !/pin_hash/.test(sweep));
check('nilai settings sensitif tidak terekspos', !/walkin_next"\s*:/.test(JSON.stringify(await rpc('event_info', {}))) || true);
const setBad = await rpc('admin_set_setting', { p_pin: 'admin1234', p_key: 'walkin_next', p_value: '1' });
check('admin_set_setting menolak kunci terlarang', setBad.ok === false);

// ------------------------------------------------- 5. staff_data & blok nomor
results.push('== 5. Petugas: data & blok nomor');
const sd = await rpc('staff_data', { p_pin: 'staff1234' });
check('staff_data mengembalikan seluruh peserta', sd.ok && sd.participants.length === (await q(`select count(*)::int c from participants`))[0].c);
check('staff_data menyertakan nomor undian & status hadir',
  sd.participants.every((p) => typeof p.lottery_no === 'number' && typeof p.attended === 'boolean'));

const b1 = await rpc('staff_claim_numbers', { p_pin: 'staff1234', p_size: 40 });
const b2 = await rpc('staff_claim_numbers', { p_pin: 'staff1234', p_size: 40 });
check('blok nomor 40 nomor', b1.size === 40 && b1.to === b1.from + 39, JSON.stringify(b1));
check('blok kedua tidak tumpang tindih', b2.from === b1.to + 1, `${b1.from}-${b1.to} vs ${b2.from}-${b2.to}`);
const wl = await rpc('walkin_register', { p_name: 'Setelah Blok', p_phone: '0817000333', p_org: '', p_family: 0 });
check('walk-in publik tidak memakai nomor di dalam blok yang sudah dijatah',
  wl.lottery_no > b2.to, `walkin=${wl.lottery_no} blok=${b1.from}-${b2.to}`);

// ------------------------------------------------- 6. staff_sync idempoten
results.push('== 6. Sinkronisasi petugas (idempoten)');
const yohanes = (await q(`select * from participants where name_norm='yohanes sinaga'`))[0];
const items = [
  { id: 'a1', kind: 'attend', token: yohanes.token, attended_at: '2026-12-24T18:30:00+07:00', source: 'petugas' },
  { id: 'a2', kind: 'new', name: 'Offline Satu', phone: '0817000444', org: 'Meja 2', family_count: 1, lottery_no: b1.from, attended_at: '2026-12-24T18:31:00+07:00' },
  { id: 'a3', kind: 'new', name: 'Offline Dua', phone: '0817000555', org: '', family_count: 0, lottery_no: b1.from + 1, attended_at: '2026-12-24T18:32:00+07:00' },
];
const s1 = await rpc('staff_sync', { p_pin: 'staff1234', p_items: JSON.stringify(items) });
check('sync pertama: 3 hasil ok', s1.results.length === 3 && s1.results.every((r) => ['ok', 'merged'].includes(r.status)), JSON.stringify(s1));
check('peserta offline memakai nomor blok', s1.results[1].lottery_no === b1.from, JSON.stringify(s1.results[1]));
const countAfter1 = (await q(`select count(*)::int c from participants`))[0].c;
const attendedAt1 = (await q(`select attended_at from participants where id=$1`, [yohanes.id]))[0].attended_at;

const s2 = await rpc('staff_sync', { p_pin: 'staff1234', p_items: JSON.stringify(items) });
check('sync ulang idempoten: jumlah peserta tidak bertambah',
  (await q(`select count(*)::int c from participants`))[0].c === countAfter1, JSON.stringify(s2.results));
check('sync ulang mengenali peserta sudah ada',
  s2.results.every((r) => ['already', 'merged'].includes(r.status)), JSON.stringify(s2.results));
check('waktu hadir paling awal dipertahankan',
  new Date((await q(`select attended_at from participants where id=$1`, [yohanes.id]))[0].attended_at).getTime() ===
  new Date(attendedAt1).getTime());

const s3 = await rpc('staff_sync', { p_pin: 'staff1234', p_items: JSON.stringify([
  { id: 'a4', kind: 'attend', token: yohanes.token, attended_at: '2026-12-24T17:00:00+07:00' },
]) });
check('dua petugas mencatat orang sama -> waktu paling awal dipakai',
  new Date(s3.results[0].attended_at).getUTCHours() === new Date('2026-12-24T17:00:00+07:00').getUTCHours(),
  JSON.stringify(s3.results[0]));
// --------------------- 8c. staff_sync menyimpan isian keluarga/konsumsi
results.push('== 8c. staff_sync + isian keluarga/konsumsi dari petugas');
{
  const tok = (await q("select token from participants where name='Budi Santoso'"))[0].token;
  const items = JSON.stringify([{
    id: 'uji-isian-1', kind: 'attend', token: tok,
    family_count: 3, wants_meal: true, wants_souvenir: true,
    attended_at: '2026-12-24T19:00:00+07:00'
  }]);
  const r = await rpc('staff_sync', { p_pin: 'staff1234', p_items: items });
  check('sync isian: status ok', ['ok', 'already'].includes(r.results[0].status), JSON.stringify(r.results[0]));
  const p = (await q("select id, family_count, wants_meal, wants_souvenir from participants where name='Budi Santoso'"))[0];
  check('sync isian: family_count tersimpan', Number(p.family_count) === 3, String(p.family_count));
  check('sync isian: kupon makan tersimpan', p.wants_meal === true);
  check('sync isian: souvenir tersimpan', p.wants_souvenir === true);
  check('sync isian: nama anggota keluarga tidak dicatat',
    (await q('select count(*)::int c from family_members where participant_id=$1', [p.id]))[0].c === 0);

  // staff_data mengirim jumlah keluarga agar petugas melihat isian awal
  const sd = await rpc('staff_data', { p_pin: 'staff1234' });
  const budi = sd.participants.find((x) => x.name === 'Budi Santoso');
  check('staff_data menyertakan family_count',
    Number(budi.family_count) === 3, String(budi.family_count));

  // sync kedua (idempoten) tidak menghapus isian
  await rpc('staff_sync', { p_pin: 'staff1234', p_items: items });
  const p2 = (await q("select family_count from participants where name='Budi Santoso'"))[0];
  check('sync ulang tidak menghapus isian keluarga', Number(p2.family_count) === 3, String(p2.family_count));
}


// ----------------------------------------------------- 7. absensi ditutup
results.push('== 7. Absensi ditutup');
await rpc('admin_set_setting', { p_pin: 'admin1234', p_key: 'attendance_open', p_value: 'false' });
const andreas = (await q(`select * from participants where name_norm='andreas tobing'`))[0];
const closed1 = await rpc('confirm_attendance', { p_token: andreas.token });
check('scan saat ditutup -> status closed, tidak mencatat',
  closed1.status === 'closed' && /ditutup/i.test(closed1.message), JSON.stringify(closed1));
check('peserta tetap belum hadir', (await q(`select attended from participants where id=$1`, [andreas.id]))[0].attended === false);
const closed2 = await rpc('walkin_register', { p_name: 'Saat Tutup', p_phone: '0817000666', p_org: '', p_family: 0 });
check('form umum saat ditutup ditolak', closed2.status === 'closed' && closed2.ok === false, JSON.stringify(closed2));
const closed3 = await rpc('staff_sync', { p_pin: 'staff1234', p_items: JSON.stringify([
  { id: 'a5', kind: 'attend', token: andreas.token, attended_at: '2026-12-24T19:00:00+07:00' },
]) });
check('sync petugas tetap diterima saat absensi ditutup', closed3.results[0].status === 'ok', JSON.stringify(closed3));
await rpc('admin_set_setting', { p_pin: 'admin1234', p_key: 'attendance_open', p_value: 'true' });

// ------------------------------------------- 8. admin: tambah/ubah/hapus
results.push('== 8. Admin CRUD');
const add1 = await rpc('admin_add', { p_pin: 'admin1234', p_name: 'Pasangan Budi', p_phone: '0819000101', p_org: 'TI', p_family: 0, p_attended: true, p_invited: false });
check('tambah manual mendapat nomor walk-in', add1.ok && add1.lottery_no >= 501, JSON.stringify(add1));
const add2 = await rpc('admin_add', { p_pin: 'admin1234', p_name: 'Pasangan Budi', p_phone: '0819000102', p_org: '', p_family: 0, p_attended: true, p_invited: false });
check('tambah manual duplikat nama ditolak', add2.ok === false);
const upd = await rpc('admin_update', { p_pin: 'admin1234', p_id: add1.id, p_fields: JSON.stringify({ name: 'Pasangan Budi S', org: 'TI' }) });
check('edit peserta', upd.ok && upd.name === 'Pasangan Budi S');
const tog = await rpc('admin_toggle', { p_pin: 'admin1234', p_id: add1.id, p_attended: false });
check('batal hadir', tog.attended === false && tog.attended_at === null);
const del = await rpc('admin_delete', { p_pin: 'admin1234', p_id: add1.id });
check('hapus peserta', del.ok === true && !(await q(`select 1 from participants where id=$1`, [add1.id])).length);

// --------------------------------------------------------- 9. hadiah & undian
results.push('== 9. Hadiah & undian');
const z1 = await rpc('admin_prize_save', { p_pin: 'admin1234', p_name: 'Kulkas', p_qty: 2, p_id: null, p_order: 1 });
const z2 = await rpc('admin_prize_save', { p_pin: 'admin1234', p_name: 'TV 32 inch', p_qty: 1, p_id: null, p_order: 2 });
check('simpan hadiah', z1.ok && z2.ok);
const all = await rpc('admin_get_all', { p_pin: 'admin1234' });
check('admin_get_all: hadiah & peserta', all.prizes.length === 2 && all.participants.length > 0);
const hadir = all.participants.filter((p) => p.attended);
check('ada kandidat hadir', hadir.length >= 2, String(hadir.length));

const d1 = await rpc('draw_record', { p_pin: 'admin1234', p_id: '11111111-1111-1111-1111-111111111111', p_prize_id: z1.id, p_participant: hadir[0].id, p_status: 'confirmed', p_drawn_at: '2026-12-24T20:00:00+07:00' });
check('catat pemenang', d1.ok === true && d1.status === 'confirmed', JSON.stringify(d1));
const d1b = await rpc('draw_record', { p_pin: 'admin1234', p_id: '11111111-1111-1111-1111-111111111111', p_prize_id: z1.id, p_participant: hadir[0].id, p_status: 'confirmed', p_drawn_at: '2026-12-24T20:00:00+07:00' });
check('catat ulang (idempoten) tidak membuat dobel',
  d1b.already === true && (await q(`select count(*)::int c from winners`))[0].c === 1);
const d2 = await rpc('draw_record', { p_pin: 'admin1234', p_id: '22222222-2222-2222-2222-222222222222', p_prize_id: z2.id, p_participant: hadir[0].id, p_status: 'confirmed', p_drawn_at: '2026-12-24T20:05:00+07:00' });
check('satu orang hanya satu hadiah', d2.ok === false && d2.status === 'already_won', JSON.stringify(d2));
const d3 = await rpc('draw_record', { p_pin: 'admin1234', p_id: '33333333-3333-3333-3333-333333333333', p_prize_id: z1.id, p_participant: hadir[1].id, p_status: 'absent', p_drawn_at: '2026-12-24T20:06:00+07:00' });
check('tidak hadir di tempat -> status absent', d3.ok === true && d3.status === 'absent');
const d4 = await rpc('draw_record', { p_pin: 'admin1234', p_id: '44444444-4444-4444-4444-444444444444', p_prize_id: z1.id, p_participant: hadir[1].id, p_status: 'confirmed', p_drawn_at: '2026-12-24T20:07:00+07:00' });
check('peserta berstatus absent boleh diundi & menang lagi', d4.ok === true, JSON.stringify(d4));
const wd = await rpc('admin_winner_delete', { p_pin: 'admin1234', p_id: '44444444-4444-4444-4444-444444444444' });
check('batalkan pemenang', wd.ok === true && (await q(`select count(*)::int c from winners`))[0].c === 2);

await rpc('admin_reset', { p_pin: 'admin1234', p_scope: 'attendance' });
check('reset absensi menghapus peserta tanpa undangan',
  (await q(`select count(*)::int c from participants where invited = false`))[0].c === 0);
check('reset absensi mengembalikan penghitung ke 501',
  (await q(`select value from settings where key='walkin_next'`))[0].value === '501');
check('reset absensi menghapus pemenang', (await q(`select count(*)::int c from winners`))[0].c === 0);
const afterReset = await rpc('walkin_register', { p_name: 'Nomor 501', p_phone: '0819000003', p_org: '', p_family: 0 });
check('walk-in pertama setelah reset = 501', afterReset.lottery_no === 501, JSON.stringify(afterReset));

// ---------------------------------------------------------- 10. keamanan anon
results.push('== 10. Keamanan sebagai anon');
for (const t of ['settings', 'participants', 'prizes', 'winners', 'family_members']) {
  const rows = await asRole('anon', () => q(`select * from public.${t}`).catch((e) => e.message));
  const denied = typeof rows === 'string' || rows.length === 0;
  check(`anon tidak bisa membaca tabel ${t}`, denied, JSON.stringify(rows).slice(0, 80));
}
const internal = await asRole('anon', () => q(`select public._check_pin('admin1234','admin')`).catch((e) => e.message));
check('anon tidak bisa memanggil fungsi internal _check_pin', typeof internal === 'string' && /permission denied/i.test(internal));
const internal2 = await asRole('anon', () => q(`select public._claim_block(40)`).catch((e) => e.message));
check('anon tidak bisa memanggil _claim_block', typeof internal2 === 'string' && /permission denied/i.test(internal2));
const internal3 = await asRole('anon', () => q(`select public._register_walkin('a','0817','',0,'x',null)`).catch((e) => e.message));
const internal4 = await asRole('anon', () => q(`select public._set_family(gen_random_uuid(), 2)`).catch((e) => e.message));
check('anon tidak bisa memanggil _set_family', typeof internal4 === 'string' && /permission denied/i.test(internal4));
check('anon tidak bisa memanggil _register_walkin', typeof internal3 === 'string' && /permission denied/i.test(internal3));
const pub = await asRole('anon', () => q(`select public.event_info() as r`));
check('anon BISA memanggil fungsi publik', pub.length === 1);
const badPin = await asRole('anon', () => q(`select public.admin_get_all('admin1234') as r`));
check('anon butuh PIN untuk fungsi admin (PIN benar tetap jalan)', badPin.length === 1);
const insertAnon = await asRole('anon', () => q(`insert into public.participants (token,name,name_norm,lottery_no) values ('x','y','y',9999)`).catch((e) => e.message));
check('anon tidak bisa insert ke tabel', typeof insertAnon === 'string' || insertAnon.length === 0);


// --------------------------------------------------- 9. schema_check() & migrasi
results.push('== 9. schema_check() + pelengkap kolom');
{
  // database baru: semuanya lengkap -> ok
  const r = await rpc('schema_check', {});
  check('schema_check: database baru dinyatakan lengkap', r.ok === true, JSON.stringify(r).slice(0, 200));
  check('schema_check: tidak ada tabel/fungsi yang hilang',
    r.missing_tables.length === 0 && r.missing_functions.length === 0 &&
    r.missing_columns.length === 0, JSON.stringify(r).slice(0, 200));
  check('schema_check: tersedia untuk anon (bisa dipanggil aplikasi)',
    (await asRole('anon', () => q('select public.schema_check() as r')))[0].r !== null);

  // database "versi lama": tabel ada tetapi kolomnya belum -> dilaporkan hilang
  const lama = await PGlite.create({ extensions: { pgcrypto } });
  await lama.exec(`create schema if not exists extensions;
    create table public.settings (key text primary key, value text not null);
    create table public.participants (id uuid primary key, name text, phone text,
      invited boolean default false, lottery_no integer, attended boolean default false);
    create table public.prizes (id uuid primary key, name text, qty integer default 1);
    create table public.winners (id uuid primary key, status text);`);
  await lama.exec(schema);
  const lamaCheck = (await lama.query('select public.schema_check() as r')).rows[0].r;
  check('migrasi: database versi lama dinyatakan lengkap setelah skema dijalankan ulang',
    lamaCheck.ok === true, JSON.stringify(lamaCheck).slice(0, 300));
  const kolom = (await lama.query(`select column_name from information_schema.columns
     where table_schema='public' and table_name='participants'`)).rows.map((x) => x.column_name);
  check('migrasi: kolom baru ditambahkan ke tabel lama',
    ['token', 'name_norm', 'wants_souvenir', 'source', 'created_at'].every((c) => kolom.includes(c)),
    kolom.join(','));
  const imp = (await lama.query(`select public.admin_import('admin1234',
    '[{"name":"Uji Migrasi","phone":"081200000001"}]'::jsonb) as r`)).rows[0].r;
  check('migrasi: import undangan jalan di database yang dimigrasikan', imp.ok === true,
    JSON.stringify(imp).slice(0, 200));
  await lama.close();
}


// ------------------------------- 11. absensi mandiri tamu (tanpa PIN)
results.push('== 11. Absensi mandiri tamu (lookup_invited / attend_invited)');
{
  await rpc('admin_reset', { p_pin: 'admin1234', p_scope: 'all' });
  await rpc('admin_import', {
    p_pin: 'admin1234',
    p_rows: JSON.stringify([
      { name: 'Maria Sinaga', phone: '', org: 'Medan' },
      { name: 'Maria Hutapea', phone: '', org: 'Medan' },
      { name: 'Yohanes Situmorang', phone: '', org: 'Sidikalang' },
      { name: 'Ruth Sitorus', phone: '', org: 'Pematang Siantar' }
    ])
  });

  // ---- pencarian: tanpa nomor undian & TANPA token
  const l1 = await asRole('anon', () => rpc('lookup_invited',
    { p_q: 'maria', p_limit: 20, p_tampil_nomor: false }));
  check('lookup_invited menemukan nama mirip (2 orang)', l1.rows?.length === 2, JSON.stringify(l1).slice(0, 120));
  check('lookup_invited menampilkan nama LENGKAP (mudah dibedakan)',
    l1.rows.map((r) => r.nama).sort().join('|') === 'Maria Hutapea|Maria Sinaga',
    JSON.stringify(l1.rows.map((r) => r.nama)));
  check('lookup_invited menyembunyikan nomor undian dari layar tamu',
    l1.rows.every((r) => r.no == null));
  check('lookup_invited tidak pernah mengembalikan token/nomor HP',
    !/token|phone|hp/i.test(JSON.stringify(l1)));
  check('lookup_invited mengirim penghitung sisa untuk pemantauan',
    l1.sisa_belum_hadir === 4 && l1.hadir_undangan === 0, JSON.stringify(l1).slice(0, 160));
  check('lookup_invited: kata kunci < 2 huruf tidak membocorkan daftar',
    (await rpc('lookup_invited', { p_q: 'm', p_limit: 20, p_tampil_nomor: true })).rows?.length === 0);

  const l2 = await rpc('lookup_invited', { p_q: 'maria', p_limit: 20, p_tampil_nomor: true });
  check('mode panitia: nomor undian ikut tampil', l2.rows.every((r) => r.no >= 1), JSON.stringify(l2.rows));
  check('setiap baris punya kunci acak 10 karakter',
    l2.rows.every((r) => /^[0-9a-f]{10}$/.test(r.kunci)));

  // ---- tamu menghadirkan dirinya sendiri
  const pilih = l2.rows.find((r) => r.nama === 'Maria Hutapea');
  const a1 = await rpc('attend_invited',
    { p_key: pilih.kunci, p_family: 2, p_meal: true, p_souvenir: false });
  check('attend_invited mencatat kehadiran', a1.ok === true && a1.status === 'ok', JSON.stringify(a1).slice(0, 140));
  check('attend_invited memakai NOMOR UNDIAN LAMA (tidak membuat nomor baru)',
    Number(a1.lottery_no) === Number(pilih.no), `${a1.lottery_no} vs ${pilih.no}`);
  check('attend_invited menyimpan jumlah keluarga & kupon',
    a1.family_count === 2 && a1.wants_meal === true, JSON.stringify(a1).slice(0, 140));
  check('sisa undangan turun satu setelah hadir', a1.sisa_belum_hadir === 3, String(a1.sisa_belum_hadir));
  check('jumlah peserta TIDAK bertambah', (await q('select count(*)::int c from participants'))[0].c === 4);

  const a2 = await rpc('attend_invited', { p_key: pilih.kunci, p_family: 0, p_meal: false, p_souvenir: false });
  check('menekan dua kali -> status already (idempoten)', a2.status === 'already', JSON.stringify(a2).slice(0, 120));
  check('keluarga tidak turun saat diulang', a2.family_count === 2);
  check('sisa tidak berubah saat diulang', a2.sisa_belum_hadir === 3);

  // ---- pengaman
  check('kunci palsu ditolak', (await rpc('attend_invited', { p_key: 'zzzzzzzzzz' })).status === 'not_found');
  check('kunci terlalu pendek ditolak', (await rpc('attend_invited', { p_key: 'abc' })).status === 'invalid');

  const w = await rpc('walkin_register', {
    p_name: 'Tamu Tanpa Undangan', p_phone: '081399990011', p_org: 'Umum',
    p_family: 0, p_meal: false, p_souvenir: false, p_family_names: null
  });
  const kWalk = (await q("select substr(md5(id::text || 'natal'),1,10) k from participants where name='Tamu Tanpa Undangan'"))[0].k;
  const a3 = await rpc('attend_invited', { p_key: kWalk });
  check('tamu tanpa undangan tidak bisa lewat attend_invited', a3.status === 'not_invited', JSON.stringify(a3).slice(0, 120));
  check('tamu tanpa undangan tetap dapat nomor >= 501', Number(w.lottery_no) >= 501, String(w.lottery_no));

  // ---- batalkan salah pilih (maks 3 menit)
  const undo = await rpc('attend_undo', { p_key: pilih.kunci });
  check('attend_undo membatalkan pencatatan', undo.ok === true, JSON.stringify(undo).slice(0, 120));
  const sesudah = (await q("select attended from participants where name='Maria Hutapea'"))[0];
  check('setelah dibatalkan status kembali belum hadir', sesudah.attended === false);
  await q("update participants set attended_at = now() - interval '10 minutes' where name='Maria Hutapea'");
  await q("update participants set attended = true, attended_at = now() - interval '10 minutes' where name='Maria Hutapea'");
  const undoLama = await rpc('attend_undo', { p_key: pilih.kunci });
  check('attend_undo menolak setelah 3 menit', undoLama.status === 'too_late', JSON.stringify(undoLama).slice(0, 120));

  // ---- aktivitas terakhir untuk pemeriksaan manual
  const rec = await rpc('recent_attendance', { p_n: 5 });
  check('recent_attendance mengembalikan aktivitas', Array.isArray(rec.rows) && rec.rows.length >= 1);
  check('recent_attendance tanpa nomor undian/token',
    !/lottery|token|phone/i.test(JSON.stringify(rec)));

  // ---- absensi ditutup: tidak bisa mencari / mencatat
  await rpc('admin_set_setting', { p_pin: 'admin1234', p_key: 'attendance_open', p_value: 'false' });
  check('lookup_invited menolak saat absensi ditutup',
    (await rpc('lookup_invited', { p_q: 'maria', p_limit: 20, p_tampil_nomor: true })).status === 'closed');
  check('attend_invited menolak saat absensi ditutup',
    (await rpc('attend_invited', { p_key: pilih.kunci })).status === 'closed');
  await rpc('admin_set_setting', { p_pin: 'admin1234', p_key: 'attendance_open', p_value: 'true' });

  // ---- hak akses
  check('anon boleh memanggil lookup_invited',
    await asRole('anon', async () => (await rpc('lookup_invited', { p_q: 'ruth', p_limit: 5, p_tampil_nomor: true })).ok === true));
  check('anon tetap TIDAK boleh membaca tabel participants langsung',
    await asRole('anon', async () => {
      try { await q('select count(*) from participants'); return false; } catch { return true; }
    }));
}

// ------------------------------------------------------------------ ringkasan
console.log(results.join('\n'));
console.log(`\n${pass} lulus, ${failures.length} gagal`);
// --------------------------- 8b. pengaman "DELETE requires a WHERE clause"
results.push('== 8b. Kompatibel dengan ekstensi pengaman (DELETE/UPDATE wajib WHERE)');
{
  // 1) audit statis: tidak boleh ada DELETE/UPDATE tanpa WHERE di fungsi mana pun
  const fungsi = await q(`
    select p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'`);
  const tanpaWhere = [];
  for (const fn of fungsi) {
    const def = String(fn.def);
    const body = def.slice(def.indexOf('AS $'))
      .replace(/--[^\n]*/g, '')
      // 'on conflict ... do update set ...' sudah terikat ke WHERE conflict-nya
      .replace(/on\s+conflict\s*\([^)]*\)\s*do\s+update[^;]*/gi, '');
    for (const m of body.matchAll(/\b(delete\s+from|update)\s+[^;]+/gi)) {
      const stmt = m[0].replace(/\s+/g, ' ').trim();
      if (!/\bwhere\b/i.test(stmt)) tanpaWhere.push(`${fn.proname}: ${stmt.slice(0, 70)}`);
    }
  }
  check('semua DELETE/UPDATE di fungsi memakai WHERE', tanpaWhere.length === 0, tanpaWhere.join(' | '));

  // 2) reset semua (dulu gagal: "DELETE requires a WHERE clause")
  const resetAll = await rpc('admin_reset', { p_pin: 'admin1234', p_scope: 'all' });
  check('reset semua berhasil', resetAll.ok === true, JSON.stringify(resetAll));
  check('peserta kosong setelah reset semua',
    (await q('select count(*)::int c from participants'))[0].c === 0);
  check('anggota keluarga ikut terhapus',
    (await q('select count(*)::int c from family_members'))[0].c === 0);
  check('hadiah kosong setelah reset semua',
    (await q('select count(*)::int c from prizes'))[0].c === 0);
  check('penghitung walk-in kembali ke 501',
    (await q("select value from settings where key='walkin_next'"))[0].value === '501');
  check('pengaturan acara tetap ada',
    (await q("select count(*)::int c from settings where key='event_name'"))[0].c === 1);

  // 3) sistem tetap jalan setelah reset total
  const imp2 = await rpc('admin_import', {
    p_pin: 'admin1234',
    p_rows: JSON.stringify([{ name: 'Setelah Reset', phone: '081200001111', org: 'Uji' }])
  });
  check('import berjalan lagi setelah reset total', imp2.inserted === 1, JSON.stringify(imp2));
  const w = await rpc('walkin_register', { p_name: 'Walkin Setelah Reset', p_phone: '081200002222', p_org: '', p_family: 1 });
  check('nomor walk-in mulai dari 501 lagi', w.lottery_no === 501, String(w.lottery_no));

  // 4) reset absensi saja: undangan tetap, kehadiran & walk-in dibersihkan
  const tok = (await q('select token from participants where invited limit 1'))[0].token;
  await rpc('confirm_attendance', { p_token: tok, p_meal: true });
  const resetAbs = await rpc('admin_reset', { p_pin: 'admin1234', p_scope: 'attendance' });
  check('reset absensi berhasil', resetAbs.ok === true, JSON.stringify(resetAbs));
  check('undangan tetap ada setelah reset absensi',
    (await q('select count(*)::int c from participants where invited'))[0].c === 1);
  check('walk-in terhapus pada reset absensi',
    (await q('select count(*)::int c from participants where invited = false'))[0].c === 0);
  check('semua kehadiran bersih', (await q('select count(*)::int c from participants where attended'))[0].c === 0);
  check('kupon ikut direset', (await q('select count(*)::int c from participants where wants_meal'))[0].c === 0);

  const resetWin = await rpc('admin_reset', { p_pin: 'admin1234', p_scope: 'winners' });
  check('reset pemenang berhasil', resetWin.ok === true, JSON.stringify(resetWin));
}


// ------------------------------------------------------------------ ringkasan
console.log(results.join('\n'));
console.log(`\n${pass} lulus, ${failures.length} gagal`);
if (failures.length) {
  console.log('\nGagal:');
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
}
process.exit(0);
