-- ==========================================================================
-- Skema basis data Pemantau Kualitas Udara, Stasiun 02 Lab Geofisika FMIPA UNTAN
-- Skripsi Teknik Lingkungan UNTAN: Febrian Sayba Jaya Kasuma (D1051231070)
--
-- Model keamanan:
--   * Dasbor (browser, key publik) hanya bisa MEMBACA.
--   * Stasiun ESP32 mengirim data lewat fungsi kirim_data_sensor() dengan
--     kunci perangkat rahasia. Kunci disimpan sebagai hash bcrypt, bukan teks asli.
--   * Tidak ada INSERT/UPDATE/DELETE langsung dari key publik, sehingga data
--     penelitian tidak bisa dipalsukan dari browser.
-- Skrip idempoten: aman dijalankan ulang.
-- ==========================================================================

create extension if not exists pgcrypto with schema extensions;

-- 1. Daftar perangkat stasiun ------------------------------------------------
create table if not exists public.perangkat (
  device_id   varchar(50) primary key check (device_id ~ '^[A-Z0-9-]{3,50}$'),
  nama        text not null,
  latitude    numeric(10, 6) check (latitude between -90 and 90),
  longitude   numeric(10, 6) check (longitude between -180 and 180),
  kunci_hash  text not null,
  aktif       boolean not null default true,
  dibuat_pada timestamptz not null default now()
);

comment on table public.perangkat is 'Stasiun pemantau. kunci_hash = bcrypt dari kunci perangkat; tidak bisa dibaca dari API.';

-- Tanpa policy = tertutup total untuk anon/authenticated (RLS menolak semua).
alter table public.perangkat enable row level security;
revoke all on table public.perangkat from anon, authenticated;

-- 2. Log pengukuran ----------------------------------------------------------
create table if not exists public.sensor_udara_log (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  device_id      varchar(50) not null default 'STASIUN-02-UNTAN'
                 references public.perangkat (device_id) on update cascade,
  pm2_5          numeric(6, 2) not null,
  pm10           numeric(6, 2) not null,
  voc_index      integer not null,
  temperature    numeric(4, 2) not null,
  humidity       numeric(5, 2) not null,
  pressure       numeric(6, 2) not null,
  wind_speed     numeric(4, 2) not null,
  wind_direction integer not null,
  latitude       numeric(10, 6) default -0.058312,
  longitude      numeric(10, 6) default 109.349821,
  battery_volt   numeric(4, 2) not null,
  sumber         text not null default 'stasiun',
  diterima_pada  timestamptz not null default now()
);

-- Batas fisik sensor. Nilai di luar rentang ini pasti galat pembacaan atau
-- kiriman rusak, jadi ditolak di basis data, bukan hanya di firmware.
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('ck_pm2_5',          'pm2_5 between 0 and 1000'),          -- PMS5003: 0–1000 µg/m³
      ('ck_pm10',           'pm10 between 0 and 1000'),
      ('ck_voc_index',      'voc_index between 0 and 500'),       -- indeks IAQ BME688: 0–500
      ('ck_temperature',    'temperature between -10 and 60'),
      ('ck_humidity',       'humidity between 0 and 100'),
      ('ck_pressure',       'pressure between 800 and 1100'),     -- hPa
      ('ck_wind_speed',     'wind_speed between 0 and 60'),       -- m/s
      ('ck_wind_direction', 'wind_direction between 0 and 359'),  -- derajat, 0 = Utara
      ('ck_latitude',       'latitude between -90 and 90'),
      ('ck_longitude',      'longitude between -180 and 180'),
      ('ck_battery_volt',   'battery_volt between 0 and 5'),      -- Li-Ion 1 sel
      ('ck_sumber',         'sumber in (''stasiun'', ''dummy'')')
    ) as t(nama, ekspresi)
  loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.sensor_udara_log'::regclass and conname = c.nama
    ) then
      execute format('alter table public.sensor_udara_log add constraint %I check (%s)', c.nama, c.ekspresi);
    end if;
  end loop;

  -- Satu perangkat tidak boleh punya dua data di detik yang sama.
  -- Ini juga mencegah duplikat ketika ESP32 mengulang kiriman setelah sinyal 4G putus.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sensor_udara_log'::regclass and conname = 'uq_sensor_device_waktu'
  ) then
    alter table public.sensor_udara_log
      add constraint uq_sensor_device_waktu unique (device_id, created_at);
  end if;
end $$;

comment on table public.sensor_udara_log is 'Data pengukuran 10 menitan. sumber = stasiun (hasil ukur) atau dummy (data uji).';
comment on column public.sensor_udara_log.wind_direction is 'Arah DATANG angin, derajat dari Utara searah jarum jam (konvensi meteorologi).';
comment on column public.sensor_udara_log.diterima_pada is 'Waktu server menerima data; selisih dengan created_at = jeda kirim.';

-- Indeks kueri dasbor (ORDER BY created_at DESC LIMIT n).
-- Indeks (device_id, created_at) sudah dibuat otomatis oleh constraint unik.
create index if not exists idx_sensor_udara_created_at on public.sensor_udara_log (created_at desc);
drop index if exists public.idx_sensor_udara_device;

-- 3. Hak akses: publik hanya membaca -----------------------------------------
alter table public.sensor_udara_log enable row level security;

drop policy if exists "Akses publik untuk membaca log sensor" on public.sensor_udara_log;
drop policy if exists "Hanya peran terautentikasi yang dapat menyisipkan data" on public.sensor_udara_log;
drop policy if exists "Baca publik log sensor" on public.sensor_udara_log;

create policy "Baca publik log sensor"
  on public.sensor_udara_log for select
  to anon, authenticated
  using (true);

-- Dua lapis: tanpa policy tulis DAN tanpa hak tabel untuk menulis.
revoke insert, update, delete, truncate, references, trigger
  on table public.sensor_udara_log from anon, authenticated;
grant select on table public.sensor_udara_log to anon, authenticated;

-- 4. Pintu masuk data stasiun ------------------------------------------------
-- ESP32 memanggil: POST {SUPABASE_URL}/rest/v1/rpc/kirim_data_sensor
-- Mengembalikan id baris baru, atau null bila data dengan waktu sama sudah ada.
create or replace function public.kirim_data_sensor(
  p_device_id      text,
  p_kunci          text,
  p_pm2_5          numeric,
  p_pm10           numeric,
  p_voc_index      integer,
  p_temperature    numeric,
  p_humidity       numeric,
  p_pressure       numeric,
  p_wind_speed     numeric,
  p_wind_direction integer,
  p_battery_volt   numeric,
  p_created_at     timestamptz default null,
  p_latitude       numeric default null,
  p_longitude      numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perangkat public.perangkat%rowtype;
  v_waktu     timestamptz;
  v_id        uuid;
begin
  select * into v_perangkat
  from public.perangkat
  where device_id = p_device_id and aktif;

  -- "is distinct from" agar kunci kosong (NULL) juga ditolak.
  if not found
     or p_kunci is null
     or v_perangkat.kunci_hash is distinct from extensions.crypt(p_kunci, v_perangkat.kunci_hash) then
    raise exception 'Perangkat tidak terdaftar atau kunci salah' using errcode = '28000';
  end if;

  -- Tanpa waktu dari GPS/RTC, pakai waktu server.
  v_waktu := coalesce(p_created_at, now());
  if v_waktu > now() + interval '10 minutes' then
    raise exception 'Waktu pengukuran % berada di masa depan; periksa jam perangkat', v_waktu
      using errcode = '22007';
  end if;

  insert into public.sensor_udara_log (
    created_at, device_id, pm2_5, pm10, voc_index, temperature, humidity, pressure,
    wind_speed, wind_direction, latitude, longitude, battery_volt, sumber
  ) values (
    v_waktu, v_perangkat.device_id, p_pm2_5, p_pm10, p_voc_index, p_temperature, p_humidity, p_pressure,
    p_wind_speed,
    ((p_wind_direction % 360) + 360) % 360,   -- 360° dari wind vane disamakan dengan 0° (Utara)
    coalesce(p_latitude, v_perangkat.latitude, -0.058312),
    coalesce(p_longitude, v_perangkat.longitude, 109.349821),
    p_battery_volt,
    'stasiun'
  )
  on conflict (device_id, created_at) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.kirim_data_sensor is 'Satu-satunya jalur tulis data stasiun. Memeriksa kunci perangkat (bcrypt) lalu menyisipkan satu baris.';

revoke all on function public.kirim_data_sensor(text, text, numeric, numeric, integer, numeric, numeric, numeric, numeric, integer, numeric, timestamptz, numeric, numeric) from public;
grant execute on function public.kirim_data_sensor(text, text, numeric, numeric, integer, numeric, numeric, numeric, numeric, integer, numeric, timestamptz, numeric, numeric) to anon, authenticated;

-- 5. Realtime: setiap INSERT baru langsung dikirim ke dasbor ------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sensor_udara_log'
  ) then
    alter publication supabase_realtime add table public.sensor_udara_log;
  end if;
end $$;
