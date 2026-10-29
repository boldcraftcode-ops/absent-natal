-- ============================================================================
--  ABSENSI ACARA NATAL + UNDIAN  --  SKEMA SUPABASE
--  Jalankan SEKALI di Supabase Dashboard > SQL Editor > New query > Run.
--
--  PIN awal:  admin = admin1234   |   petugas = staff1234
--  >>> SEGERA GANTI PIN DARI PANEL ADMIN (tab Pengaturan) SEBELUM HARI-H. <<<
--
--  Prinsip keamanan:
--   * RLS aktif di semua tabel TANPA policy  -> tabel tidak bisa dibaca langsung.
--   * Semua akses data lewat fungsi SECURITY DEFINER dengan search_path = ''.
--   * anon/authenticated hanya diberi GRANT EXECUTE pada fungsi publik/staff/admin.
--   * PIN disimpan sebagai hash bcrypt (pgcrypto), tidak pernah dikembalikan.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Ekstensi & role
-- ---------------------------------------------------------------------------
create schema if not exists extensions;

-- Supabase: pgcrypto biasanya sudah ada di schema extensions -> perintah ini no-op.
create extension if not exists pgcrypto with schema extensions;

-- Supabase selalu punya role ini. Blok di bawah hanya untuk Postgres polos
-- (mis. saat menjalankan uji otomatis dengan PGlite).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Tabel
-- ---------------------------------------------------------------------------
create table if not exists public.settings (
  key   text primary key,
  value text not null
);

create table if not exists public.participants (
  id            uuid primary key default extensions.gen_random_uuid(),
  token         text not null unique,
  name          text not null,
  name_norm     text not null,
  phone         text,
  org           text,
  family_count  integer not null default 0 check (family_count >= 0),
  wants_meal    boolean not null default false,   -- ambil kupon makan
  wants_souvenir boolean not null default false,  -- ambil souvenir
  invited       boolean not null default false,
  lottery_no    integer not null unique,
  attended      boolean not null default false,
  attended_at   timestamptz,
  source        text not null default 'manual'
                check (source in ('scan_sendiri', 'petugas', 'form_umum', 'manual')),
  created_at    timestamptz not null default now()
);

create index if not exists participants_phone_idx     on public.participants (phone) where phone is not null;
create index if not exists participants_name_norm_idx on public.participants (name_norm);
create index if not exists participants_attended_idx  on public.participants (attended);

-- Anggota keluarga yang ikut (maks 5 per peserta, satu baris per orang)
create table if not exists public.family_members (
  id             uuid primary key default extensions.gen_random_uuid(),
  participant_id uuid not null references public.participants (id) on delete cascade,
  name           text not null,
  position       integer not null default 1 check (position between 1 and 5),
  created_at     timestamptz not null default now(),
  unique (participant_id, position)
);

create index if not exists family_members_participant_idx
  on public.family_members (participant_id);

create table if not exists public.prizes (
  id         uuid primary key default extensions.gen_random_uuid(),
  name       text not null,
  qty        integer not null default 1 check (qty >= 1),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.winners (
  id             uuid primary key,                 -- UUID dibuat di klien (idempoten)
  prize_id       uuid not null references public.prizes (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  status         text not null check (status in ('confirmed', 'absent')),
  drawn_at       timestamptz not null default now()
);

create index if not exists winners_prize_idx on public.winners (prize_id);

-- Satu orang hanya boleh menang satu kali (hanya untuk status 'confirmed').
create unique index if not exists winners_satu_juara
  on public.winners (participant_id) where status = 'confirmed';

-- ---------------------------------------------------------------------------
-- 2. Nilai awal settings
-- ---------------------------------------------------------------------------
insert into public.settings (key, value) values
  ('event_name',      'Perayaan Natal 2026'),
  ('attendance_open', 'true'),
  ('walkin_next',     '501'),
  ('admin_pin_hash',  extensions.crypt('admin1234', extensions.gen_salt('bf', 10))),
  ('staff_pin_hash',  extensions.crypt('staff1234', extensions.gen_salt('bf', 10)))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Helper INTERNAL (dicabut dari anon/authenticated di bagian 6)
-- ---------------------------------------------------------------------------

-- Normalisasi no. HP: buang spasi/titik/strip, +62 / 62 -> 0. Contoh: "+62 812-3456" -> "08123456"
create or replace function public._norm_phone(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  with s as (select regexp_replace(coalesce(p, ''), '[^0-9+]', '', 'g') as v),
       t as (
         select case
                  when v like '+62%' then '0' || substr(v, 4)
                  when v like '62%'  then '0' || substr(v, 3)
                  when v like '+%'   then regexp_replace(v, '[^0-9]', '', 'g')
                  else v
                end as v
         from s
       )
  select case when length(v) < 6 then null else v end from t;
$$;

-- Normalisasi nama untuk pencocokan: huruf kecil, spasi dirapikan
create or replace function public._norm_name(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(lower(coalesce(p, '')), '\s+', ' ', 'g')), '');
$$;

-- Bersihkan daftar nama anggota keluarga: maksimal 5, buang yang kosong/duplikat.
create or replace function public._norm_family_names(p_names jsonb)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_raw  text;
  v_out  text[] := '{}';
  v_name text;
begin
  if p_names is null or jsonb_typeof(p_names) <> 'array' then
    return v_out;
  end if;

  for v_raw in select value #>> '{}' from jsonb_array_elements(p_names) loop
    v_name := btrim(regexp_replace(coalesce(v_raw, ''), '\s+', ' ', 'g'));
    continue when length(v_name) < 2;
    -- lewati nama berulang (tanpa membedakan huruf besar/kecil)
    continue when exists (select 1 from unnest(v_out) x where lower(x) = lower(v_name));
    v_out := v_out || v_name;
    exit when array_length(v_out, 1) >= 5;
  end loop;

  return v_out;
end $$;

-- Simpan anggota keluarga (ganti seluruh daftar) + samakan family_count.
-- p_extra mempertahankan hitungan lama bila peserta hanya mengisi jumlah tanpa nama.
create or replace function public._set_family(p_id uuid, p_names jsonb, p_extra integer default 0)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_names    text[];
  v_existing integer;
  v_count    integer;
  i          integer;
begin
  -- p_names NULL  -> daftar tidak dikirim, nama yang sudah ada DIPERTAHANKAN
  -- p_names '[]'  -> daftar dikosongkan (hapus semua anggota)
  if p_names is not null then
    v_names := public._norm_family_names(p_names);
    delete from public.family_members where participant_id = p_id;
    if array_length(v_names, 1) is not null then
      for i in 1 .. array_length(v_names, 1) loop
        insert into public.family_members (participant_id, name, position)
        values (p_id, v_names[i], i);
      end loop;
    end if;
  end if;

  select count(*)::integer into v_existing
    from public.family_members where participant_id = p_id;

  -- hitungan = jumlah nama tercatat, tidak turun dari data sebelumnya,
  -- dan minimal sebesar angka yang dikirim (maks 5)
  v_count := greatest(
    coalesce(array_length(v_names, 1), 0),
    coalesce(v_existing, 0),
    least(greatest(coalesce(p_extra, 0), 0), 5)
  );

  update public.participants set family_count = v_count where id = p_id;
  return v_count;
end $$;

-- Daftar anggota keluarga untuk sekumpulan peserta (dipakai admin/petugas)
create or replace function public._family_map(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(f.participant_id, f.names), '{}'::jsonb)
  from (
    select participant_id, jsonb_agg(name order by position) as names
      from public.family_members
     where participant_id = any (p_ids)
     group by participant_id
  ) f;
$$;

create or replace function public._event_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((select value from public.settings where key = 'event_name'), 'Acara Natal'); $$;

create or replace function public._attendance_open()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((select value = 'true' from public.settings where key = 'attendance_open'), false); $$;

create or replace function public._set_setting(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.settings (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value;
end $$;

-- Cek PIN. PIN salah -> tunggu ~0,6 detik lalu error (memperlambat brute force).
create or replace function public._check_pin(p_pin text, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_ok   boolean := false;
begin
  if p_role not in ('admin', 'staff') then
    raise exception 'Peran tidak dikenal.';
  end if;

  select value into v_hash
    from public.settings
   where key = case when p_role = 'admin' then 'admin_pin_hash' else 'staff_pin_hash' end;

  if v_hash is not null and p_pin is not null and length(p_pin) <= 64 then
    v_ok := (extensions.crypt(p_pin, v_hash) = v_hash);
  end if;

  if not v_ok then
    perform pg_sleep(0.6);
    raise exception 'PIN salah. Periksa kembali PIN Anda.'
      using errcode = '28000', hint = 'pin_invalid';
  end if;
end $$;

-- Ambil SATU nomor walk-in berikutnya (atomik, dipakai form umum & admin manual)
create or replace function public._next_walkin_no()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_no integer;
begin
  update public.settings
     set value = ((value)::integer + 1)::text
   where key = 'walkin_next'
  returning (value)::integer - 1 into v_no;

  if v_no is null then
    raise exception 'Penghitung nomor walk-in tidak ditemukan.';
  end if;
  return v_no;
end $$;

-- Ambil BLOK nomor untuk petugas offline (atomik). Satu penghitung yang sama
-- dengan walk-in memakai rentang yang sama sehingga nomor tidak pernah kembar.
create or replace function public._claim_block(p_size integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start integer;
  v_n     integer := greatest(1, least(coalesce(p_size, 40), 200));
begin
  update public.settings
     set value = ((value)::integer + v_n)::text
   where key = 'walkin_next'
  returning (value)::integer - v_n into v_start;

  if v_start is null then
    raise exception 'Penghitung nomor walk-in tidak ditemukan.';
  end if;

  return jsonb_build_object('from', v_start, 'to', v_start + v_n - 1, 'size', v_n);
end $$;

create or replace function public._new_token()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare v text; i integer := 0;
begin
  loop
    v := encode(extensions.gen_random_bytes(8), 'hex');
    exit when not exists (select 1 from public.participants p where p.token = v);
    i := i + 1;
    if i > 20 then raise exception 'Gagal membuat token unik.'; end if;
  end loop;
  return v;
end $$;

-- Cari peserta yang cocok berdasarkan nomor HP dan/atau nama.
-- p_id mengembalikan id peserta yang cocok (null bila tidak ada).
create or replace function public._find_match(p_phone text, p_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_phone text := public._norm_phone(p_phone);
  v_name  text := public._norm_name(p_name);
begin
  if v_phone is not null then
    select id into v_id from public.participants
     where phone = v_phone
     order by invited desc, created_at asc
     limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  if v_name is not null then
    select id into v_id from public.participants
     where name_norm = v_name
     order by invited desc, created_at asc
     limit 1;
  end if;

  return v_id;
end $$;

-- Pendaftar tanpa undangan (dipakai form umum, petugas, dan admin).
-- Menggabungkan data bila HP/nama cocok dengan peserta yang sudah ada.
create or replace function public._register_walkin(
  p_name       text,
  p_phone      text,
  p_org        text,
  p_family     integer,
  p_source     text,
  p_force_no   integer default null,
  p_meal       boolean default false,
  p_souvenir   boolean default false,
  p_family_names jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name  text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_phone text := public._norm_phone(p_phone);
  v_org   text := nullif(btrim(coalesce(p_org, '')), '');
  v_fam   integer := greatest(0, coalesce(p_family, 0));
  v_match uuid;
  v_p     public.participants;
  v_no    integer;
  v_was   boolean := false;
begin
  if v_name is null or length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'status', 'invalid',
                              'message', 'Nama lengkap wajib diisi (minimal 2 huruf).');
  end if;

  v_match := public._find_match(p_phone, p_name);

  if v_match is not null then
    -- Gabungkan ke peserta yang sudah ada (memakai nomor undiannya).
    select attended into v_was from public.participants where id = v_match;

    update public.participants
       set attended      = true,
           attended_at   = coalesce(attended_at, now()),
           phone         = coalesce(phone, v_phone),
           org           = coalesce(org, v_org),
           wants_meal    = wants_meal or coalesce(p_meal, false),
           wants_souvenir = wants_souvenir or coalesce(p_souvenir, false),
           source        = case when attended then source else coalesce(p_source, source) end
     where id = v_match
    returning * into v_p;

    -- anggota keluarga: daftar baru menggantikan, atau pertahankan angka tertinggi
    perform public._set_family(
      v_p.id,
      nullif(p_family_names, 'null'::jsonb),
      greatest(v_p.family_count, v_fam));
    select * into v_p from public.participants where id = v_match;

    return jsonb_build_object(
      'ok', true,
      'status', case when v_was then 'already' else 'merged' end,
      'merged', true,
      'id', v_p.id,
      'name', v_p.name,
      'org', v_p.org,
      'lottery_no', v_p.lottery_no,
      'attended_at', v_p.attended_at,
      'family_count', v_p.family_count,
      'wants_meal', v_p.wants_meal, 'wants_souvenir', v_p.wants_souvenir,
      'invited', v_p.invited,
      'message', 'Data Anda digabungkan dengan undangan yang sudah terdaftar.'
    );
  end if;

  -- Peserta baru
  v_no := p_force_no;
  if v_no is not null and exists (select 1 from public.participants where lottery_no = v_no) then
    v_no := null; -- nomor dari blok petugas bentrok -> ambil nomor baru
  end if;
  if v_no is null then
    v_no := public._next_walkin_no();
  end if;

  insert into public.participants (token, name, name_norm, phone, org, family_count,
                                   wants_meal, wants_souvenir,
                                   invited, lottery_no, attended, attended_at, source)
  values (public._new_token(), v_name, public._norm_name(v_name), v_phone, v_org, v_fam,
          coalesce(p_meal, false), coalesce(p_souvenir, false),
          false, v_no, true, now(), coalesce(p_source, 'form_umum'))
  returning * into v_p;

  v_p.family_count := public._set_family(v_p.id, nullif(p_family_names, 'null'::jsonb), v_fam);

  return jsonb_build_object(
    'ok', true, 'status', 'ok', 'merged', false,
    'id', v_p.id, 'name', v_p.name, 'org', v_p.org,
    'lottery_no', v_p.lottery_no, 'attended_at', v_p.attended_at,
    'family_count', v_p.family_count,
    'wants_meal', v_p.wants_meal, 'wants_souvenir', v_p.wants_souvenir,
    'invited', false, 'message', 'Pendaftaran berhasil.'
  );
exception
  when unique_violation then
    -- Balapan dua petugas dengan data sama: ambil data yang sudah ada.
    v_match := public._find_match(p_phone, p_name);
    if v_match is null then
      raise;
    end if;
    select * into v_p from public.participants where id = v_match;
    return jsonb_build_object('ok', true, 'status', 'merged', 'merged', true,
      'id', v_p.id, 'name', v_p.name, 'org', v_p.org,
      'lottery_no', v_p.lottery_no, 'attended_at', v_p.attended_at,
      'invited', v_p.invited, 'message', 'Data Anda sudah terdaftar.');
end $$;

-- ---------------------------------------------------------------------------
-- 4. FUNGSI PUBLIK (tanpa PIN)
-- ---------------------------------------------------------------------------
create or replace function public.event_info()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'event_name', public._event_name(),
    'attendance_open', public._attendance_open(),
    'total_invited', (select count(*) from public.participants where invited),
    'total_attended', (select count(*) from public.participants where attended)
  );
$$;

create or replace function public.get_invite(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p    public.participants;
  v_open boolean := public._attendance_open();
begin
  if p_token is null or length(btrim(p_token)) < 4 then
    return jsonb_build_object('ok', false, 'status', 'not_found',
                              'message', 'Undangan tidak ditemukan.', 'attendance_open', v_open);
  end if;

  select * into v_p from public.participants where token = lower(btrim(p_token));

  if not found then
    return jsonb_build_object('ok', false, 'status', 'not_found',
                              'message', 'Undangan tidak ditemukan.', 'attendance_open', v_open);
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', case when v_p.attended then 'already' else 'found' end,
    'name', v_p.name,
    'org', v_p.org,
    'family_count', v_p.family_count,
    'invited', v_p.invited,
    'attended', v_p.attended,
    'attended_at', v_p.attended_at,
    'lottery_no', v_p.lottery_no,
    'attendance_open', v_open,
    'event_name', public._event_name()
  );
end $$;

create or replace function public.confirm_attendance(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p     public.participants;
  v_open  boolean := public._attendance_open();
  v_token text := lower(btrim(coalesce(p_token, '')));
begin
  if length(v_token) < 4 then
    return jsonb_build_object('ok', false, 'status', 'not_found',
                              'message', 'Undangan tidak ditemukan.');
  end if;

  select * into v_p from public.participants where token = v_token;

  if not found then
    return jsonb_build_object('ok', false, 'status', 'not_found',
                              'message', 'Undangan tidak ditemukan.');
  end if;

  if v_p.attended then
    return jsonb_build_object('ok', true, 'status', 'already', 'name', v_p.name,
      'org', v_p.org, 'lottery_no', v_p.lottery_no, 'attended_at', v_p.attended_at,
      'message', 'Undangan ini sudah tercatat hadir.');
  end if;

  if not v_open then
    return jsonb_build_object('ok', false, 'status', 'closed', 'name', v_p.name,
      'org', v_p.org, 'lottery_no', v_p.lottery_no,
      'message', 'Absensi sedang ditutup. Silakan hubungi petugas registrasi.');
  end if;

  update public.participants
     set attended = true, attended_at = now(), source = 'scan_sendiri'
   where id = v_p.id and attended = false
  returning * into v_p;

  if not found then
    select * into v_p from public.participants where token = v_token;
    return jsonb_build_object('ok', true, 'status', 'already', 'name', v_p.name,
      'org', v_p.org, 'lottery_no', v_p.lottery_no, 'attended_at', v_p.attended_at,
      'message', 'Undangan ini sudah tercatat hadir.');
  end if;

  return jsonb_build_object('ok', true, 'status', 'ok', 'name', v_p.name, 'org', v_p.org,
    'lottery_no', v_p.lottery_no, 'attended_at', v_p.attended_at,
    'message', 'Kehadiran Anda berhasil dicatat.');
end $$;

create or replace function public.walkin_register(
  p_name         text,
  p_phone        text,
  p_org          text default null,
  p_family       integer default 0,
  p_meal         boolean default false,
  p_souvenir     boolean default false,
  p_family_names jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public._attendance_open() then
    return jsonb_build_object('ok', false, 'status', 'closed',
      'message', 'Absensi sedang ditutup. Silakan hubungi petugas registrasi.');
  end if;

  if public._norm_phone(p_phone) is null then
    return jsonb_build_object('ok', false, 'status', 'invalid',
      'message', 'Nomor HP/WA wajib diisi dengan benar (contoh: 0812xxxxxxx).');
  end if;

  return public._register_walkin(p_name, p_phone, p_org, p_family, 'form_umum', null,
                                 p_meal, p_souvenir, p_family_names);
end $$;

-- ---------------------------------------------------------------------------
-- 5. FUNGSI PETUGAS (PIN petugas ATAU admin)
-- ---------------------------------------------------------------------------
create or replace function public.staff_data(p_pin text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_rows jsonb;
begin
  -- terima PIN petugas atau PIN admin
  begin
    perform public._check_pin(p_pin, 'staff');
  exception when others then
    perform public._check_pin(p_pin, 'admin');
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'token', p.token, 'name', p.name, 'org', p.org, 'phone', p.phone,
           'family_count', p.family_count,
           'wants_meal', p.wants_meal, 'wants_souvenir', p.wants_souvenir,
           'invited', p.invited,
           'lottery_no', p.lottery_no, 'attended', p.attended,
           'attended_at', p.attended_at, 'source', p.source)
         order by p.lottery_no), '[]'::jsonb)
    into v_rows
    from public.participants p;

  return jsonb_build_object(
    'ok', true,
    'event_name', public._event_name(),
    'attendance_open', public._attendance_open(),
    'participants', v_rows,
    'server_time', now()
  );
end $$;

create or replace function public.staff_claim_numbers(p_pin text, p_size integer default 40)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_block jsonb;
begin
  perform public._check_pin(p_pin, 'staff');
  v_block := public._claim_block(p_size);
  return jsonb_build_object('ok', true) || v_block;
end $$;

-- Sinkronisasi antrean petugas. Idempoten: kirim ulang aman.
-- items[] = { id, kind: 'attend'|'new', token, name, phone, org, family_count,
--             lottery_no, attended_at, source }
create or replace function public.staff_sync(p_pin text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item   jsonb;
  v_res    jsonb;
  v_out    jsonb := '[]'::jsonb;
  v_p      public.participants;
  v_at     timestamptz;
  v_kind   text;
begin
  perform public._check_pin(p_pin, 'staff');

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('ok', true, 'results', '[]'::jsonb);
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_kind := coalesce(v_item ->> 'kind', 'attend');
    v_at   := coalesce(nullif(v_item ->> 'attended_at', '')::timestamptz, now());
    v_p    := null;
    v_res  := null;

    if v_kind = 'attend' then
      -- Jalur QR undangan: cari berdasarkan token
      if nullif(v_item ->> 'token', '') is not null then
        select * into v_p from public.participants where token = lower(btrim(v_item ->> 'token'));
      end if;

      -- Token tidak dikenal -> coba cocokkan nama/HP
      if v_p.id is null then
        declare v_match uuid := public._find_match(v_item ->> 'phone', v_item ->> 'name');
        begin
          if v_match is not null then
            select * into v_p from public.participants where id = v_match;
          end if;
        end;
      end if;

      if v_p.id is null then
        v_res := jsonb_build_object('id', v_item ->> 'id', 'status', 'not_found',
          'message', 'Peserta tidak ditemukan di server.');
      else
        if v_p.attended then
          update public.participants
             set attended_at = least(coalesce(attended_at, v_at), v_at)
           where id = v_p.id
          returning * into v_p;
          v_res := jsonb_build_object('id', v_item ->> 'id', 'status', 'already',
            'participant_id', v_p.id, 'name', v_p.name, 'lottery_no', v_p.lottery_no,
            'attended_at', v_p.attended_at,
            'message', 'Sudah tercatat hadir sebelumnya.');
        else
          update public.participants
             set attended = true,
                 attended_at = v_at,
                 source = coalesce(nullif(v_item ->> 'source', ''), 'petugas')
           where id = v_p.id
          returning * into v_p;
          v_res := jsonb_build_object('id', v_item ->> 'id', 'status', 'ok',
            'participant_id', v_p.id, 'name', v_p.name, 'lottery_no', v_p.lottery_no,
            'attended_at', v_p.attended_at, 'message', 'Kehadiran tersimpan.');
        end if;
      end if;

    elsif v_kind = 'new' then
      declare v_reg jsonb;
      begin
        v_reg := public._register_walkin(
                   v_item ->> 'name', v_item ->> 'phone', v_item ->> 'org',
                   coalesce((v_item ->> 'family_count')::integer, 0),
                   'petugas',
                   nullif(v_item ->> 'lottery_no', '')::integer,
                   coalesce((v_item ->> 'wants_meal')::boolean, false),
                   coalesce((v_item ->> 'wants_souvenir')::boolean, false),
                   v_item -> 'family_names');
        v_res := jsonb_build_object('id', v_item ->> 'id',
          'status', case when (v_reg ->> 'merged')::boolean then 'merged' else 'ok' end,
          'participant_id', v_reg ->> 'id', 'name', v_reg ->> 'name',
          'lottery_no', (v_reg ->> 'lottery_no')::integer,
          'attended_at', v_reg ->> 'attended_at',
          'message', coalesce(v_reg ->> 'message', 'Peserta tersimpan.'));
      end;
    else
      v_res := jsonb_build_object('id', v_item ->> 'id', 'status', 'invalid',
                                  'message', 'Jenis item tidak dikenal.');
    end if;

    v_out := v_out || jsonb_build_array(v_res);
  end loop;

  return jsonb_build_object('ok', true, 'results', v_out, 'server_time', now());
end $$;

-- ---------------------------------------------------------------------------
-- 6. FUNGSI ADMIN (PIN admin)
-- ---------------------------------------------------------------------------
create or replace function public.admin_check(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._check_pin(p_pin, 'admin');
  return jsonb_build_object(
    'ok', true,
    'event_name', public._event_name(),
    -- dipakai UI untuk memperingatkan bila PIN masih bawaan
    'default_admin_pin', coalesce((select extensions.crypt('admin1234', value) = value
                                     from public.settings where key = 'admin_pin_hash'), false),
    'default_staff_pin', coalesce((select extensions.crypt('staff1234', value) = value
                                     from public.settings where key = 'staff_pin_hash'), false),
    'server_time', now());
end $$;

create or replace function public.admin_get_all(p_pin text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_people  jsonb;
  v_prizes  jsonb;
  v_winners jsonb;
begin
  perform public._check_pin(p_pin, 'admin');

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'token', p.token, 'name', p.name, 'org', p.org, 'phone', p.phone,
           'family_count', p.family_count,
           'wants_meal', p.wants_meal, 'wants_souvenir', p.wants_souvenir,
           'family_names', coalesce(f.names, '[]'::jsonb),
           'invited', p.invited,
           'lottery_no', p.lottery_no, 'attended', p.attended,
           'attended_at', p.attended_at, 'source', p.source, 'created_at', p.created_at)
         order by p.lottery_no), '[]'::jsonb)
    into v_people
    from public.participants p
    left join lateral (
      select jsonb_agg(m.name order by m.position) as names
        from public.family_members m
       where m.participant_id = p.id
    ) f on true;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', z.id, 'name', z.name, 'qty', z.qty, 'sort_order', z.sort_order)
         order by z.sort_order, z.created_at), '[]'::jsonb)
    into v_prizes from public.prizes z;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', w.id, 'prize_id', w.prize_id, 'participant_id', w.participant_id,
           'status', w.status, 'drawn_at', w.drawn_at)
         order by w.drawn_at), '[]'::jsonb)
    into v_winners from public.winners w;

  return jsonb_build_object(
    'ok', true,
    'event_name', public._event_name(),
    'attendance_open', public._attendance_open(),
    'walkin_next', (select value::integer from public.settings where key = 'walkin_next'),
    -- rekap kebutuhan konsumsi & suvenir
    'totals', jsonb_build_object(
      'people_present', (select count(*) from public.participants where attended),
      'family_present', (select coalesce(sum(family_count), 0) from public.participants where attended),
      'meal', (select count(*) from public.participants where attended and wants_meal),
      'meal_with_family',
        (select coalesce(sum(1 + family_count), 0) from public.participants where attended and wants_meal),
      'souvenir', (select count(*) from public.participants where attended and wants_souvenir),
      'souvenir_with_family',
        (select coalesce(sum(1 + family_count), 0) from public.participants where attended and wants_souvenir)
    ),
    'participants', v_people,
    'prizes', v_prizes,
    'winners', v_winners,
    'server_time', now()
  );
end $$;

-- Import undangan. Baris: [{name, phone, org}]. Duplikat (HP atau nama) dilewati.
create or replace function public.admin_import(p_pin text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row      jsonb;
  v_name     text;
  v_phone    text;
  v_org      text;
  v_inserted integer := 0;
  v_skipped  jsonb := '[]'::jsonb;
  v_pool     integer[];
  v_no       integer;
  v_match    uuid;
  v_warn     text := null;
begin
  perform public._check_pin(p_pin, 'admin');

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('ok', false, 'status', 'invalid',
                              'message', 'Data import tidak valid.');
  end if;

  -- Nomor undian diundi acak dari rentang 1-500 agar urutan datang tak bisa ditebak.
  select coalesce(array_agg(n order by random()), '{}'::integer[])
    into v_pool
    from generate_series(1, 500) n
   where n not in (select lottery_no from public.participants where lottery_no <= 500);

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_name  := btrim(regexp_replace(coalesce(v_row ->> 'name', ''), '\s+', ' ', 'g'));
    v_phone := public._norm_phone(v_row ->> 'phone');
    v_org   := nullif(btrim(coalesce(v_row ->> 'org', '')), '');

    if v_name is null or length(v_name) < 2 then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
                     'name', coalesce(v_row ->> 'name', ''), 'reason', 'Nama kosong'));
      continue;
    end if;

    -- Sudah ada di daftar? (HP atau nama sama) -> jangan dobel
    v_match := public._find_match(v_phone, v_name);
    if v_match is not null then
      update public.participants
         set invited = true,
             phone   = coalesce(phone, v_phone),
             org     = coalesce(org, v_org)
       where id = v_match;
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
                     'name', v_name, 'reason', 'Sudah terdaftar (dilewati)'));
      continue;
    end if;

    if array_length(v_pool, 1) is null or array_length(v_pool, 1) = 0 then
      v_no := public._next_walkin_no();
      v_warn := 'Nomor undian 1-500 sudah habis; sebagian peserta memakai nomor lanjutan.';
    else
      v_no := v_pool[1];
      v_pool := v_pool[2:];
    end if;

    insert into public.participants (token, name, name_norm, phone, org, invited, lottery_no)
    values (public._new_token(), v_name, public._norm_name(v_name), v_phone, v_org, true, v_no);

    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object('ok', true, 'inserted', v_inserted,
    'skipped', jsonb_array_length(v_skipped), 'skipped_detail', v_skipped,
    'warning', v_warn,
    'free_numbers', coalesce(array_length(v_pool, 1), 0));
end $$;

create or replace function public.admin_set_setting(p_pin text, p_key text, p_value text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._check_pin(p_pin, 'admin');

  if p_key not in ('event_name', 'attendance_open') then
    return jsonb_build_object('ok', false, 'message', 'Pengaturan ini tidak boleh diubah dari sini.');
  end if;

  if p_key = 'attendance_open' and p_value not in ('true', 'false') then
    return jsonb_build_object('ok', false, 'message', 'Nilai status absensi tidak valid.');
  end if;

  if p_key = 'event_name' and length(btrim(coalesce(p_value, ''))) = 0 then
    return jsonb_build_object('ok', false, 'message', 'Nama acara tidak boleh kosong.');
  end if;

  perform public._set_setting(p_key, case when p_key = 'event_name' then btrim(p_value) else p_value end);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_change_pin(p_pin text, p_target text, p_new_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._check_pin(p_pin, 'admin');

  if p_target not in ('admin', 'staff') then
    return jsonb_build_object('ok', false, 'message', 'Jenis PIN tidak dikenal.');
  end if;

  if p_new_pin is null or length(btrim(p_new_pin)) < 4 then
    return jsonb_build_object('ok', false, 'message', 'PIN baru minimal 4 karakter.');
  end if;

  perform public._set_setting(
    case when p_target = 'admin' then 'admin_pin_hash' else 'staff_pin_hash' end,
    extensions.crypt(btrim(p_new_pin), extensions.gen_salt('bf', 10)));

  return jsonb_build_object('ok', true, 'message', 'PIN berhasil diganti.');
end $$;

create or replace function public.admin_toggle(p_pin text, p_id uuid, p_attended boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_p public.participants;
begin
  perform public._check_pin(p_pin, 'admin');

  update public.participants
     set attended    = coalesce(p_attended, not attended),
         attended_at = case when coalesce(p_attended, not attended)
                            then coalesce(attended_at, now()) else null end,
         source      = case when coalesce(p_attended, not attended) then 'manual' else source end
   where id = p_id
  returning * into v_p;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Peserta tidak ditemukan.');
  end if;

  return jsonb_build_object('ok', true, 'id', v_p.id, 'attended', v_p.attended,
                            'attended_at', v_p.attended_at, 'source', v_p.source);
end $$;

create or replace function public.admin_update(p_pin text, p_id uuid, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p    public.participants;
  v_name text;
begin
  perform public._check_pin(p_pin, 'admin');

  v_name := btrim(regexp_replace(coalesce(p_fields ->> 'name', ''), '\s+', ' ', 'g'));

  update public.participants
     set name         = case when v_name <> '' then v_name else name end,
         name_norm    = case when v_name <> '' then public._norm_name(v_name) else name_norm end,
         phone        = case when p_fields ? 'phone' then public._norm_phone(p_fields ->> 'phone') else phone end,
         org          = case when p_fields ? 'org' then nullif(btrim(coalesce(p_fields ->> 'org', '')), '') else org end,
         family_count = case when p_fields ? 'family_count'
                             then least(greatest(0, coalesce((p_fields ->> 'family_count')::integer, 0)), 5)
                             else family_count end,
         wants_meal = case when p_fields ? 'wants_meal'
                           then coalesce((p_fields ->> 'wants_meal')::boolean, false)
                           else wants_meal end,
         wants_souvenir = case when p_fields ? 'wants_souvenir'
                               then coalesce((p_fields ->> 'wants_souvenir')::boolean, false)
                               else wants_souvenir end
   where id = p_id
  returning * into v_p;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Peserta tidak ditemukan.');
  end if;

  if p_fields ? 'family_names' then
    v_p.family_count := public._set_family(v_p.id, p_fields -> 'family_names',
                                           coalesce((p_fields ->> 'family_count')::integer, v_p.family_count));
  end if;

  return jsonb_build_object('ok', true, 'id', v_p.id, 'name', v_p.name, 'phone', v_p.phone,
                            'org', v_p.org, 'family_count', v_p.family_count,
                            'wants_meal', v_p.wants_meal, 'wants_souvenir', v_p.wants_souvenir,
                            'family_names', public._family_map(array[v_p.id]) -> v_p.id::text,
                            'lottery_no', v_p.lottery_no);
end $$;

create or replace function public.admin_delete(p_pin text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._check_pin(p_pin, 'admin');
  delete from public.winners where participant_id = p_id;
  delete from public.participants where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_add(
  p_pin          text,
  p_name         text,
  p_phone        text default null,
  p_org          text default null,
  p_family       integer default 0,
  p_attended     boolean default true,
  p_invited      boolean default false,
  p_meal         boolean default false,
  p_souvenir     boolean default false,
  p_family_names jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_p    public.participants;
  v_no   integer;
begin
  perform public._check_pin(p_pin, 'admin');

  if v_name is null or length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'message', 'Nama lengkap wajib diisi.');
  end if;

  if exists (select 1 from public.participants
              where name_norm = public._norm_name(v_name)
                 or (public._norm_phone(p_phone) is not null and phone = public._norm_phone(p_phone))) then
    return jsonb_build_object('ok', false,
      'message', 'Peserta dengan nama atau nomor HP tersebut sudah terdaftar.');
  end if;

  v_no := public._next_walkin_no();

  insert into public.participants (token, name, name_norm, phone, org, family_count,
                                   wants_meal, wants_souvenir,
                                   invited, lottery_no, attended, attended_at, source)
  values (public._new_token(), v_name, public._norm_name(v_name), public._norm_phone(p_phone),
          nullif(btrim(coalesce(p_org, '')), ''), least(greatest(0, coalesce(p_family, 0)), 5),
          coalesce(p_meal, false), coalesce(p_souvenir, false),
          coalesce(p_invited, false), v_no,
          coalesce(p_attended, true), case when coalesce(p_attended, true) then now() end,
          'manual')
  returning * into v_p;

  v_p.family_count := public._set_family(v_p.id, nullif(p_family_names, 'null'::jsonb),
                                         coalesce(p_family, 0));

  return jsonb_build_object('ok', true, 'id', v_p.id, 'name', v_p.name,
                            'lottery_no', v_p.lottery_no, 'attended', v_p.attended,
                            'family_count', v_p.family_count,
                            'wants_meal', v_p.wants_meal, 'wants_souvenir', v_p.wants_souvenir);
end $$;

create or replace function public.admin_prize_save(
  p_pin   text,
  p_name  text,
  p_qty   integer default 1,
  p_id    uuid default null,
  p_order integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_z public.prizes;
begin
  perform public._check_pin(p_pin, 'admin');

  if btrim(coalesce(p_name, '')) = '' then
    return jsonb_build_object('ok', false, 'message', 'Nama hadiah wajib diisi.');
  end if;
  if coalesce(p_qty, 0) < 1 then
    return jsonb_build_object('ok', false, 'message', 'Jumlah pemenang minimal 1.');
  end if;

  if p_id is null then
    insert into public.prizes (name, qty, sort_order)
    values (btrim(p_name), p_qty, coalesce(p_order, 0))
    returning * into v_z;
  else
    update public.prizes
       set name = btrim(p_name), qty = p_qty, sort_order = coalesce(p_order, sort_order)
     where id = p_id
    returning * into v_z;

    if not found then
      return jsonb_build_object('ok', false, 'message', 'Hadiah tidak ditemukan.');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_z.id, 'name', v_z.name, 'qty', v_z.qty);
end $$;

create or replace function public.admin_prize_delete(p_pin text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._check_pin(p_pin, 'admin');
  delete from public.prizes where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_winner_delete(p_pin text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._check_pin(p_pin, 'admin');
  delete from public.winners where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Dipakai layar undian. Idempoten lewat UUID dari klien.
create or replace function public.draw_record(
  p_pin        text,
  p_id         uuid,
  p_prize_id   uuid,
  p_participant uuid,
  p_status     text,
  p_drawn_at   timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_w public.winners;
begin
  perform public._check_pin(p_pin, 'admin');

  if p_status not in ('confirmed', 'absent') then
    return jsonb_build_object('ok', false, 'message', 'Status pemenang tidak valid.');
  end if;

  -- sudah pernah tersimpan? (kirim ulang setelah offline)
  select * into v_w from public.winners where id = p_id;
  if found then
    return jsonb_build_object('ok', true, 'status', v_w.status, 'already', true,
                              'message', 'Hasil undian sudah tersimpan.');
  end if;

  if p_status = 'confirmed' and exists (
       select 1 from public.winners w
        where w.participant_id = p_participant and w.status = 'confirmed') then
    return jsonb_build_object('ok', false, 'status', 'already_won',
      'message', 'Peserta ini sudah menjadi pemenang hadiah lain.');
  end if;

  begin
    insert into public.winners (id, prize_id, participant_id, status, drawn_at)
    values (p_id, p_prize_id, p_participant, p_status, coalesce(p_drawn_at, now()))
    returning * into v_w;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'status', 'already_won',
      'message', 'Peserta ini sudah menjadi pemenang hadiah lain.');
  end;

  return jsonb_build_object('ok', true, 'status', v_w.status, 'id', v_w.id);
end $$;

create or replace function public.admin_reset(p_pin text, p_scope text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._check_pin(p_pin, 'admin');

  if p_scope not in ('winners', 'attendance', 'all') then
    return jsonb_build_object('ok', false, 'message', 'Jenis reset tidak dikenal.');
  end if;

  if p_scope in ('winners', 'attendance', 'all') then
    delete from public.winners;
  end if;

  if p_scope in ('attendance', 'all') then
    delete from public.participants where invited = false;
    update public.participants
       set attended = false, attended_at = null,
           source = case when invited then 'scan_sendiri' else 'manual' end;
    perform public._set_setting('walkin_next', '501');
  end if;

  if p_scope = 'all' then
    delete from public.participants;
    delete from public.prizes;
    perform public._set_setting('walkin_next', '501');
  end if;

  return jsonb_build_object('ok', true, 'scope', p_scope);
end $$;

-- ---------------------------------------------------------------------------
-- 7. RLS + HAK AKSES
-- ---------------------------------------------------------------------------
alter table public.settings       enable row level security;
alter table public.participants   enable row level security;
alter table public.family_members enable row level security;
alter table public.prizes       enable row level security;
alter table public.winners      enable row level security;

-- Tidak ada policy sama sekali -> tidak ada baris yang bisa diakses langsung.
revoke all on public.settings       from anon, authenticated;
revoke all on public.participants   from anon, authenticated;
revoke all on public.family_members from anon, authenticated;
revoke all on public.prizes       from anon, authenticated;
revoke all on public.winners      from anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;

-- Fungsi: default-nya EXECUTE diberikan ke PUBLIC -> cabut semua dulu.
revoke execute on all functions in schema public from public, anon, authenticated;

-- Fungsi INTERNAL: tidak boleh dipanggil dari luar.
revoke execute on function public._norm_phone(text)                 from public, anon, authenticated;
revoke execute on function public._norm_name(text)                  from public, anon, authenticated;
revoke execute on function public._event_name()                     from public, anon, authenticated;
revoke execute on function public._attendance_open()                from public, anon, authenticated;
revoke execute on function public._set_setting(text, text)          from public, anon, authenticated;
revoke execute on function public._check_pin(text, text)            from public, anon, authenticated;
revoke execute on function public._next_walkin_no()                 from public, anon, authenticated;
revoke execute on function public._claim_block(integer)             from public, anon, authenticated;
revoke execute on function public._new_token()                      from public, anon, authenticated;
revoke execute on function public._find_match(text, text)           from public, anon, authenticated;
revoke execute on function public._norm_family_names(jsonb)         from public, anon, authenticated;
revoke execute on function public._set_family(uuid, jsonb, integer) from public, anon, authenticated;
revoke execute on function public._family_map(uuid[])               from public, anon, authenticated;
revoke execute on function public._register_walkin(text, text, text, integer, text, integer, boolean, boolean, jsonb)
  from public, anon, authenticated;

-- Fungsi PUBLIK
grant execute on function public.event_info()                                   to anon, authenticated;
grant execute on function public.get_invite(text)                               to anon, authenticated;
grant execute on function public.confirm_attendance(text)                       to anon, authenticated;
grant execute on function public.walkin_register(text, text, text, integer, boolean, boolean, jsonb)
  to anon, authenticated;

-- Fungsi PETUGAS
grant execute on function public.staff_data(text)                               to anon, authenticated;
grant execute on function public.staff_claim_numbers(text, integer)             to anon, authenticated;
grant execute on function public.staff_sync(text, jsonb)                        to anon, authenticated;

-- Fungsi ADMIN
grant execute on function public.admin_check(text)                                          to anon, authenticated;
grant execute on function public.admin_get_all(text)                                        to anon, authenticated;
grant execute on function public.admin_import(text, jsonb)                                  to anon, authenticated;
grant execute on function public.admin_set_setting(text, text, text)                        to anon, authenticated;
grant execute on function public.admin_change_pin(text, text, text)                         to anon, authenticated;
grant execute on function public.admin_toggle(text, uuid, boolean)                          to anon, authenticated;
grant execute on function public.admin_update(text, uuid, jsonb)                            to anon, authenticated;
grant execute on function public.admin_delete(text, uuid)                                   to anon, authenticated;
grant execute on function public.admin_add(text, text, text, text, integer, boolean, boolean, boolean, boolean, jsonb)
  to anon, authenticated;
grant execute on function public.admin_prize_save(text, text, integer, uuid, integer)        to anon, authenticated;
grant execute on function public.admin_prize_delete(text, uuid)                             to anon, authenticated;
grant execute on function public.admin_winner_delete(text, uuid)                            to anon, authenticated;
grant execute on function public.draw_record(text, uuid, uuid, uuid, text, timestamptz)      to anon, authenticated;
grant execute on function public.admin_reset(text, text)                                    to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Pemeriksaan cepat
-- ---------------------------------------------------------------------------
-- select public.event_info();
-- select public.admin_get_all('admin1234') -> 'ok';
-- >>> PIN bawaan: admin1234 / staff1234. GANTI lewat tab Pengaturan admin.html! <<<
