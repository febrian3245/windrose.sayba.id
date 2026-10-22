-- Tambah perangkat IoT utama (AQMS-01-SAYBA): sistem yang dibangun untuk skripsi ini.
-- STASIUN-02-UNTAN (Lab Geofisika FMIPA UNTAN) sudah ada sejak migrasi awal dan
-- sekarang berperan sebagai objek pembanding (data referensi independen),
-- bukan target utama. Kedua baris memenuhi CHECK perangkat_device_id_check
-- ('^[A-Z0-9-]{3,50}$') dan FK sensor_udara_log.device_id -> private.perangkat.
-- kunci_hash wajib (NOT NULL): kunci perangkat asli dibuat sekali di luar migrasi ini
-- (lihat FOR HERMES/KUNCI_PERANGKAT_ESP32_RAHASIA.txt) dan HANYA hash bcrypt-nya
-- yang pernah masuk ke database, sama seperti STASIUN-02-UNTAN.
insert into private.perangkat (device_id, nama, latitude, longitude, kunci_hash)
values (
  'AQMS-01-SAYBA',
  'AQMS 4G LTE Pontianak (alat IoT skripsi)',
  -0.057662,
  109.350271,
  crypt('__KUNCI_AQMS01__', gen_salt('bf'))
)
on conflict (device_id) do nothing;

comment on column private.perangkat.device_id is
  'Identitas perangkat. AQMS-01-SAYBA = alat IoT utama skripsi (objek penelitian). '
  'STASIUN-02-UNTAN = Lab Geofisika FMIPA UNTAN, objek pembanding (data referensi independen).';
