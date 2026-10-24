-- Fitur kelola data manual oleh admin (Supabase Auth + role).
--
-- Latar: data WROSE-01 dikirim otomatis oleh alat IoT lewat RPC kirim_data_sensor
-- (kunci perangkat), sedangkan data Stasiun 02 diambil manual tiap 1 jam. Dasbor
-- perlu jalur input/edit/hapus untuk KEDUA tabel tanpa membuka tulis ke publik.
--
-- Pendekatan: INSERT/UPDATE/DELETE hanya lewat RPC SECURITY DEFINER yang memeriksa
-- role 'admin' pada tabel profil. RLS tabel data tetap SELECT-only untuk anon,
-- sehingga key publik di browser tidak pernah bisa menulis langsung ke tabel.

-- 1) Profil pengguna + role. Dibuat otomatis saat user baru mendaftar di Auth.
create table if not exists public.profil_pengguna (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'viewer' check (role in ('admin', 'viewer')),
  dibuat_pada timestamptz not null default now()
);

comment on table public.profil_pengguna is
  'Profil + role pengguna dasbor. role=admin boleh input/edit/hapus data pengukuran '
  'lewat RPC kelola_*; role=viewer hanya membaca. Baris dibuat otomatis oleh trigger '
  'saat pengguna mendaftar lewat Supabase Auth.';

alter table public.profil_pengguna enable row level security;

-- Pengguna hanya boleh melihat profilnya sendiri (untuk tahu role-nya di UI).
drop policy if exists "Baca profil sendiri" on public.profil_pengguna;
create policy "Baca profil sendiri" on public.profil_pengguna
  for select using (auth.uid() = id);

-- 2) Trigger: setiap user baru di Auth otomatis dapat baris profil (role viewer).
create or replace function public.buat_profil_pengguna()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profil_pengguna (id, email, role)
  values (new.id, new.email, 'viewer')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_buat_profil_pengguna on auth.users;
create trigger trg_buat_profil_pengguna
  after insert on auth.users
  for each row execute function public.buat_profil_pengguna();

-- 3) Penolong: apakah pemanggil saat ini admin?
create or replace function public.apakah_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profil_pengguna
    where id = auth.uid() and role = 'admin'
  );
$$;

comment on function public.apakah_admin is
  'true bila pengguna yang memanggil (auth.uid()) punya role admin di profil_pengguna.';

grant execute on function public.apakah_admin to authenticated;

-- 4) RPC tambah data manual. p_sumber memilih tabel tujuan, jadi satu endpoint
--    melayani kedua perangkat tanpa pernah mencampur barisnya.
create or replace function public.kelola_tambah_data(
  p_sumber text,
  p_created_at timestamptz,
  p_pm2_5 numeric,
  p_pm10 numeric,
  p_voc_index integer,
  p_temperature numeric,
  p_humidity numeric,
  p_pressure numeric,
  p_wind_speed numeric,
  p_wind_direction integer,
  p_battery_volt numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_arah integer;
begin
  if not public.apakah_admin() then
    raise exception 'Akses ditolak: butuh role admin' using errcode = '42501';
  end if;

  if p_sumber not in ('wrose01', 'stasiun02') then
    raise exception 'p_sumber harus wrose01 atau stasiun02' using errcode = '22023';
  end if;

  -- Wind vane melaporkan 360° untuk Utara; disimpan sebagai 0 agar konsisten
  -- dengan CHECK (0..359) dan perhitungan sektor di aplikasi.
  v_arah := case when p_wind_direction = 360 then 0 else p_wind_direction end;

  if p_created_at > now() + interval '10 minutes' then
    raise exception 'Waktu pengukuran terlalu jauh di depan jam server' using errcode = '22007';
  end if;

  if p_sumber = 'wrose01' then
    insert into public.data_wrose01
      (created_at, pm2_5, pm10, voc_index, temperature, humidity, pressure, wind_speed, wind_direction, battery_volt)
    values
      (p_created_at, p_pm2_5, p_pm10, p_voc_index, p_temperature, p_humidity, p_pressure, p_wind_speed, v_arah, p_battery_volt)
    on conflict (created_at) do nothing
    returning id into v_id;
  else
    insert into public.data_stasiun02
      (created_at, pm2_5, pm10, voc_index, temperature, humidity, pressure, wind_speed, wind_direction, battery_volt)
    values
      (p_created_at, p_pm2_5, p_pm10, p_voc_index, p_temperature, p_humidity, p_pressure, p_wind_speed, v_arah, p_battery_volt)
    on conflict (created_at) do nothing
    returning id into v_id;
  end if;

  return v_id;  -- null bila waktu itu sudah ada (aman diulang)
end;
$$;

comment on function public.kelola_tambah_data is
  'Admin menambah satu baris pengukuran manual ke data_wrose01 atau data_stasiun02 '
  '(p_sumber). Mengembalikan id baru, atau null bila baris pada waktu itu sudah ada.';

revoke all on function public.kelola_tambah_data(text, timestamptz, numeric, numeric, integer, numeric, numeric, numeric, numeric, integer, numeric) from public, anon;
grant execute on function public.kelola_tambah_data(text, timestamptz, numeric, numeric, integer, numeric, numeric, numeric, numeric, integer, numeric) to authenticated;

-- 5) RPC ubah data. Kolom yang dikirim null dibiarkan apa adanya (partial update).
create or replace function public.kelola_ubah_data(
  p_sumber text,
  p_id uuid,
  p_pm2_5 numeric default null,
  p_pm10 numeric default null,
  p_voc_index integer default null,
  p_temperature numeric default null,
  p_humidity numeric default null,
  p_pressure numeric default null,
  p_wind_speed numeric default null,
  p_wind_direction integer default null,
  p_battery_volt numeric default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jumlah integer;
  v_arah integer;
begin
  if not public.apakah_admin() then
    raise exception 'Akses ditolak: butuh role admin' using errcode = '42501';
  end if;

  if p_sumber not in ('wrose01', 'stasiun02') then
    raise exception 'p_sumber harus wrose01 atau stasiun02' using errcode = '22023';
  end if;

  v_arah := case when p_wind_direction = 360 then 0 else p_wind_direction end;

  if p_sumber = 'wrose01' then
    update public.data_wrose01 set
      pm2_5          = coalesce(p_pm2_5, pm2_5),
      pm10           = coalesce(p_pm10, pm10),
      voc_index      = coalesce(p_voc_index, voc_index),
      temperature    = coalesce(p_temperature, temperature),
      humidity       = coalesce(p_humidity, humidity),
      pressure       = coalesce(p_pressure, pressure),
      wind_speed     = coalesce(p_wind_speed, wind_speed),
      wind_direction = coalesce(v_arah, wind_direction),
      battery_volt   = coalesce(p_battery_volt, battery_volt)
    where id = p_id;
  else
    update public.data_stasiun02 set
      pm2_5          = coalesce(p_pm2_5, pm2_5),
      pm10           = coalesce(p_pm10, pm10),
      voc_index      = coalesce(p_voc_index, voc_index),
      temperature    = coalesce(p_temperature, temperature),
      humidity       = coalesce(p_humidity, humidity),
      pressure       = coalesce(p_pressure, pressure),
      wind_speed     = coalesce(p_wind_speed, wind_speed),
      wind_direction = coalesce(v_arah, wind_direction),
      battery_volt   = coalesce(p_battery_volt, battery_volt)
    where id = p_id;
  end if;

  get diagnostics v_jumlah = row_count;
  return v_jumlah > 0;
end;
$$;

comment on function public.kelola_ubah_data is
  'Admin mengubah satu baris pengukuran (parameter null = kolom tidak diubah). '
  'Mengembalikan true bila baris ditemukan dan diperbarui.';

revoke all on function public.kelola_ubah_data(text, uuid, numeric, numeric, integer, numeric, numeric, numeric, numeric, integer, numeric) from public, anon;
grant execute on function public.kelola_ubah_data(text, uuid, numeric, numeric, integer, numeric, numeric, numeric, numeric, integer, numeric) to authenticated;

-- 6) RPC hapus data.
create or replace function public.kelola_hapus_data(p_sumber text, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jumlah integer;
begin
  if not public.apakah_admin() then
    raise exception 'Akses ditolak: butuh role admin' using errcode = '42501';
  end if;

  if p_sumber not in ('wrose01', 'stasiun02') then
    raise exception 'p_sumber harus wrose01 atau stasiun02' using errcode = '22023';
  end if;

  if p_sumber = 'wrose01' then
    delete from public.data_wrose01 where id = p_id;
  else
    delete from public.data_stasiun02 where id = p_id;
  end if;

  get diagnostics v_jumlah = row_count;
  return v_jumlah > 0;
end;
$$;

comment on function public.kelola_hapus_data is
  'Admin menghapus satu baris pengukuran. Mengembalikan true bila baris ada dan terhapus.';

revoke all on function public.kelola_hapus_data(text, uuid) from public, anon;
grant execute on function public.kelola_hapus_data(text, uuid) to authenticated;
