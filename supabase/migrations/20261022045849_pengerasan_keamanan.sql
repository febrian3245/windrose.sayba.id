-- ==========================================================================
-- Pengerasan keamanan (dari hasil Security Advisor Supabase)
--
-- 1. Tabel perangkat (berisi hash kunci) dipindah ke schema private yang
--    TIDAK diekspos PostgREST. Tabel ini tidak bisa diakses lewat API sama sekali.
-- 2. Logika SECURITY DEFINER dipindah ke private.kirim_data_sensor().
--    Fungsi public.kirim_data_sensor() kini SECURITY INVOKER: pembungkus tipis
--    yang hanya meneruskan argumen. Hak istimewa tidak lagi berada di schema API.
-- 3. Peran authenticated tidak dipakai (dasbor tanpa login), jadi haknya dicabut.
-- Idempoten.
-- ==========================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to anon;   -- hanya agar pembungkus bisa memanggil fungsi di bawah

-- 1. Pindahkan tabel perangkat --------------------------------------------------
do $$
begin
  if to_regclass('public.perangkat') is not null and to_regclass('private.perangkat') is null then
    alter table public.perangkat set schema private;
  end if;
end $$;

revoke all on table private.perangkat from public, anon, authenticated;

-- 2. Fungsi inti di schema private ---------------------------------------------
drop function if exists public.kirim_data_sensor(text, text, numeric, numeric, integer, numeric, numeric, numeric, numeric, integer, numeric, timestamptz, numeric, numeric);

create or replace function private.kirim_data_sensor(
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
  p_created_at     timestamptz,
  p_latitude       numeric,
  p_longitude      numeric
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

  insert into public.sensor_udara_log (
    created_at, device_id, pm2_5, pm10, voc_index, temperature, humidity, pressure,
    wind_speed, wind_direction, latitude, longitude, battery_volt, sumber
  ) values (
    v_waktu, v_perangkat.device_id, p_pm2_5, p_pm10, p_voc_index, p_temperature, p_humidity, p_pressure,
    p_wind_speed,
    ((p_wind_direction % 360) + 360) % 360,
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

revoke all on function private.kirim_data_sensor(text, text, numeric, numeric, integer, numeric, numeric, numeric, numeric, integer, numeric, timestamptz, numeric, numeric) from public, authenticated;
grant execute on function private.kirim_data_sensor(text, text, numeric, numeric, integer, numeric, numeric, numeric, numeric, integer, numeric, timestamptz, numeric, numeric) to anon;

-- 3. Pembungkus publik (endpoint ESP32) -----------------------------------------
-- POST {SUPABASE_URL}/rest/v1/rpc/kirim_data_sensor
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
language sql
security invoker
set search_path = ''
as $$
  select private.kirim_data_sensor(
    p_device_id, p_kunci, p_pm2_5, p_pm10, p_voc_index, p_temperature, p_humidity, p_pressure,
    p_wind_speed, p_wind_direction, p_battery_volt, p_created_at, p_latitude, p_longitude
  );
$$;

comment on function public.kirim_data_sensor is 'Endpoint kirim data stasiun ESP32. Memeriksa kunci perangkat lalu menyisipkan satu baris. Mengembalikan id, atau null bila waktu yang sama sudah tersimpan.';

revoke all on function public.kirim_data_sensor(text, text, numeric, numeric, integer, numeric, numeric, numeric, numeric, integer, numeric, timestamptz, numeric, numeric) from public, authenticated;
grant execute on function public.kirim_data_sensor(text, text, numeric, numeric, integer, numeric, numeric, numeric, numeric, integer, numeric, timestamptz, numeric, numeric) to anon;

-- 4. Log sensor: baca publik untuk peran anon saja -------------------------------
drop policy if exists "Baca publik log sensor" on public.sensor_udara_log;
create policy "Baca publik log sensor"
  on public.sensor_udara_log for select
  to anon
  using (true);

revoke all on table public.sensor_udara_log from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.sensor_udara_log from anon;
grant select on table public.sensor_udara_log to anon;
