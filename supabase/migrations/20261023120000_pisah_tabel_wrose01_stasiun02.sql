-- Pisahkan data alat IoT (WROSE-01) dan data pembanding resmi (Stasiun 02)
-- menjadi 2 tabel fisik terpisah, sesuai metode colocation testing di skripsi:
-- WROSE-01 adalah alat yang diuji, Stasiun 02 adalah acuan resmi yang dibandingkan.
-- Sebelumnya keduanya bercampur dalam 1 tabel sensor_udara_log + kolom device_id.

-- 1) Buat 2 tabel data baru, tanpa kolom device_id/sumber (sudah tersirat dari nama tabel)
create table public.data_wrose01 (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  pm2_5 numeric not null,
  pm10 numeric not null,
  voc_index integer not null,
  temperature numeric not null,
  humidity numeric not null,
  pressure numeric not null,
  wind_speed numeric not null,
  wind_direction integer not null,
  latitude numeric default -0.057662,
  longitude numeric default 109.350271,
  battery_volt numeric not null,
  diterima_pada timestamptz not null default now(),
  unique (created_at)
);

create table public.data_stasiun02 (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  pm2_5 numeric not null,
  pm10 numeric not null,
  voc_index integer not null,
  temperature numeric not null,
  humidity numeric not null,
  pressure numeric not null,
  wind_speed numeric not null,
  wind_direction integer not null,
  latitude numeric default -0.058312,
  longitude numeric default 109.349821,
  battery_volt numeric not null,
  diterima_pada timestamptz not null default now(),
  unique (created_at)
);

alter table public.data_wrose01 enable row level security;
alter table public.data_stasiun02 enable row level security;

create policy "Baca publik data wrose01" on public.data_wrose01
  for select using (true);
create policy "Baca publik data stasiun02" on public.data_stasiun02
  for select using (true);

create index idx_data_wrose01_created_at on public.data_wrose01 (created_at desc);
create index idx_data_stasiun02_created_at on public.data_stasiun02 (created_at desc);

-- 3) Migrasi data lama ke tabel baru sesuai device_id (sebelum rename di atas commit,
--    tapi karena ini 1 transaksi, device_id lama di sensor_udara_log tetap AQMS-01-SAYBA)
insert into public.data_wrose01
  (created_at, pm2_5, pm10, voc_index, temperature, humidity, pressure,
   wind_speed, wind_direction, latitude, longitude, battery_volt, diterima_pada)
select created_at, pm2_5, pm10, voc_index, temperature, humidity, pressure,
       wind_speed, wind_direction, latitude, longitude, battery_volt, diterima_pada
from public.sensor_udara_log
where device_id = 'AQMS-01-SAYBA';

insert into public.data_stasiun02
  (created_at, pm2_5, pm10, voc_index, temperature, humidity, pressure,
   wind_speed, wind_direction, latitude, longitude, battery_volt, diterima_pada)
select created_at, pm2_5, pm10, voc_index, temperature, humidity, pressure,
       wind_speed, wind_direction, latitude, longitude, battery_volt, diterima_pada
from public.sensor_udara_log
where device_id = 'STASIUN-02-UNTAN';

-- 4) Rename device IoT: AQMS-01-SAYBA -> WROSE-01 (device Stasiun 02 tidak berubah,
--    karena itu instrumen resmi instansi, bukan alat buatan penulis). Dilakukan
--    SETELAH migrasi data karena FK sensor_udara_log.device_id -> perangkat.device_id
--    bersifat ON UPDATE CASCADE (rename di sini akan ikut mengubah device_id lama
--    di tabel arsip, tapi data sudah aman tersalin ke data_wrose01 di atas).
update private.perangkat
set device_id = 'WROSE-01',
    nama = 'WROSE 4G LTE Pontianak (alat IoT skripsi)'
where device_id = 'AQMS-01-SAYBA';

-- 5) RPC baru: routing ke tabel yang benar berdasarkan device_id terdaftar
create or replace function private.kirim_data_sensor(
  p_device_id text,
  p_kunci text,
  p_pm2_5 numeric,
  p_pm10 numeric,
  p_voc_index integer,
  p_temperature numeric,
  p_humidity numeric,
  p_pressure numeric,
  p_wind_speed numeric,
  p_wind_direction integer,
  p_battery_volt numeric,
  p_created_at timestamptz default null,
  p_latitude numeric default null,
  p_longitude numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perangkat private.perangkat%rowtype;
  v_waktu     timestamptz;
  v_id        uuid;
  v_arah      integer;
begin
  select * into v_perangkat
  from private.perangkat
  where device_id = p_device_id and aktif;

  if not found
     or p_kunci is null
     or v_perangkat.kunci_hash is distinct from extensions.crypt(p_kunci, v_perangkat.kunci_hash) then
    raise exception 'Perangkat tidak terdaftar atau kunci salah' using errcode = '28000';
  end if;

  v_waktu := coalesce(p_created_at, now());
  if v_waktu > now() + interval '10 minutes' then
    raise exception 'Waktu pengukuran % berada di masa depan; periksa jam perangkat', v_waktu
      using errcode = '22007';
  end if;

  v_arah := ((p_wind_direction % 360) + 360) % 360;

  if v_perangkat.device_id = 'WROSE-01' then
    insert into public.data_wrose01 (
      created_at, pm2_5, pm10, voc_index, temperature, humidity, pressure,
      wind_speed, wind_direction, latitude, longitude, battery_volt
    ) values (
      v_waktu, p_pm2_5, p_pm10, p_voc_index, p_temperature, p_humidity, p_pressure,
      p_wind_speed, v_arah,
      coalesce(p_latitude, v_perangkat.latitude, -0.057662),
      coalesce(p_longitude, v_perangkat.longitude, 109.350271),
      p_battery_volt
    )
    on conflict (created_at) do nothing
    returning id into v_id;
  elsif v_perangkat.device_id = 'STASIUN-02-UNTAN' then
    insert into public.data_stasiun02 (
      created_at, pm2_5, pm10, voc_index, temperature, humidity, pressure,
      wind_speed, wind_direction, latitude, longitude, battery_volt
    ) values (
      v_waktu, p_pm2_5, p_pm10, p_voc_index, p_temperature, p_humidity, p_pressure,
      p_wind_speed, v_arah,
      coalesce(p_latitude, v_perangkat.latitude, -0.058312),
      coalesce(p_longitude, v_perangkat.longitude, 109.349821),
      p_battery_volt
    )
    on conflict (created_at) do nothing
    returning id into v_id;
  else
    raise exception 'Perangkat % tidak dipetakan ke tabel manapun', v_perangkat.device_id
      using errcode = '22023';
  end if;

  return v_id;
end;
$$;

create or replace function public.kirim_data_sensor(
  p_device_id text,
  p_kunci text,
  p_pm2_5 numeric,
  p_pm10 numeric,
  p_voc_index integer,
  p_temperature numeric,
  p_humidity numeric,
  p_pressure numeric,
  p_wind_speed numeric,
  p_wind_direction integer,
  p_battery_volt numeric,
  p_created_at timestamptz default null,
  p_latitude numeric default null,
  p_longitude numeric default null
)
returns uuid
language sql
set search_path = ''
as $$
  select private.kirim_data_sensor(
    p_device_id, p_kunci, p_pm2_5, p_pm10, p_voc_index, p_temperature, p_humidity, p_pressure,
    p_wind_speed, p_wind_direction, p_battery_volt, p_created_at, p_latitude, p_longitude
  );
$$;

-- 6) Arsipkan tabel lama (tidak di-drop, untuk jaring pengaman) dan tutup aksesnya
alter table public.sensor_udara_log rename to sensor_udara_log_arsip;
revoke all on public.sensor_udara_log_arsip from anon, authenticated;
