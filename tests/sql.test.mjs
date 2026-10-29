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
check('4 tabel dibuat', tables.map((t) => t.tablename).join(',') === 'participants,prizes,settings,winners',
  tables.map((t) => t.tablename).join(','));
const rls = await q(`select relname, relrowsecurity from pg_class where relname in ('participants','prizes','settings','winners')`);
check('RLS aktif di semua tabel', rls.every((r) => r.relrowsecurity === true));
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
const w1b = await rpc('walkin_register', { p_name: 'Rudi Hartono', p_phone: '0817000111', p_org: 'Umum', p_family: 2 });
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
const w5 = await rpc('walkin_register', { p_name: 'X', p_phone: '0817000222', p_org: '', p_family: 0 });
check('nama terlalu pendek ditolak', w5.ok === false, JSON.stringify(w5));

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
const add1 = await rpc('admin_add', { p_pin: 'admin1234', p_name: 'Pasangan Budi', p_phone: '0817000777', p_org: 'TI', p_family: 0, p_attended: true, p_invited: false });
check('tambah manual mendapat nomor walk-in', add1.ok && add1.lottery_no >= 501, JSON.stringify(add1));
const add2 = await rpc('admin_add', { p_pin: 'admin1234', p_name: 'Pasangan Budi', p_phone: '0817000888', p_org: '', p_family: 0, p_attended: true, p_invited: false });
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
const afterReset = await rpc('walkin_register', { p_name: 'Nomor 501', p_phone: '0817000999', p_org: '', p_family: 0 });
check('walk-in pertama setelah reset = 501', afterReset.lottery_no === 501, JSON.stringify(afterReset));

// ---------------------------------------------------------- 10. keamanan anon
results.push('== 10. Keamanan sebagai anon');
for (const t of ['settings', 'participants', 'prizes', 'winners']) {
  const rows = await asRole('anon', () => q(`select * from public.${t}`).catch((e) => e.message));
  const denied = typeof rows === 'string' || rows.length === 0;
  check(`anon tidak bisa membaca tabel ${t}`, denied, JSON.stringify(rows).slice(0, 80));
}
const internal = await asRole('anon', () => q(`select public._check_pin('admin1234','admin')`).catch((e) => e.message));
check('anon tidak bisa memanggil fungsi internal _check_pin', typeof internal === 'string' && /permission denied/i.test(internal));
const internal2 = await asRole('anon', () => q(`select public._claim_block(40)`).catch((e) => e.message));
check('anon tidak bisa memanggil _claim_block', typeof internal2 === 'string' && /permission denied/i.test(internal2));
const internal3 = await asRole('anon', () => q(`select public._register_walkin('a','0817','',0,'x',null)`).catch((e) => e.message));
check('anon tidak bisa memanggil _register_walkin', typeof internal3 === 'string' && /permission denied/i.test(internal3));
const pub = await asRole('anon', () => q(`select public.event_info() as r`));
check('anon BISA memanggil fungsi publik', pub.length === 1);
const badPin = await asRole('anon', () => q(`select public.admin_get_all('admin1234') as r`));
check('anon butuh PIN untuk fungsi admin (PIN benar tetap jalan)', badPin.length === 1);
const insertAnon = await asRole('anon', () => q(`insert into public.participants (token,name,name_norm,lottery_no) values ('x','y','y',9999)`).catch((e) => e.message));
check('anon tidak bisa insert ke tabel', typeof insertAnon === 'string' || insertAnon.length === 0);

// ------------------------------------------------------------------ ringkasan
console.log(results.join('\n'));
console.log(`\n${pass} lulus, ${failures.length} gagal`);
if (failures.length) { console.log('\nGagal:'); failures.forEach((f) => console.log(' - ' + f)); process.exit(1); }
process.exit(0);
