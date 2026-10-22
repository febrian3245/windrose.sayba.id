# Web Dasbor Kualitas Udara: AQMS 4G LTE Pontianak

Dasbor web untuk skripsi **"Rancang Bangun Sistem Pemantau Kualitas Udara (PM2.5, PM10, VOC) Berbasis IoT 4G LTE dan Analisis Spasial Sebaran Polutan Menggunakan Pemodelan Wind Rose"**.
Peneliti: Febrian Sayba Jaya Kasuma (D1051231070), Teknik Lingkungan, Fakultas Teknik, Universitas Tanjungpura.

Dua perangkat (`device_id`) di skema yang sama:

| Device | Peran | Lokasi |
|---|---|---|
| `AQMS-01-SAYBA` | Alat IoT utama, objek penelitian ("AQMS 4G LTE Pontianak") | Sekitar Lab Geofisika FMIPA UNTAN |
| `STASIUN-02-UNTAN` | Objek pembanding, data referensi independen | Lab Geofisika FMIPA UNTAN |

Dasbor berfokus pada `AQMS-01-SAYBA` untuk ISPU, Wind Rose, Pollution Rose, dan tren; `STASIUN-02-UNTAN` tampil di peta dan panel pembanding.

## Isi dasbor

| Bagian | Isi | Dasar |
|---|---|---|
| ISPU 24 jam | Nilai dan kategori ISPU dari rata-rata 24 jam PM2.5 dan PM10, parameter kritis, indikasi sesaat | Permen LHK No. P.14/MENLHK/SETJEN/KUM.1/7/2020 |
| Pengukuran terakhir | PM2.5, PM10 terhadap baku mutu 24 jam, VOC, suhu, RH, tekanan, kecepatan dan arah angin | PP No. 22 Tahun 2021 Lampiran VII |
| Peta | Lokasi AQMS-01-SAYBA dan STASIUN-02-UNTAN di peta satelit Esri (tanpa API key), dengan ringkasan PM2.5 kedua titik | Analisis spasial |
| Wind Rose | Frekuensi arah datang angin, 16 sektor × 22,5°, 4 kelas kecepatan, angin tenang < 0,5 m/s dipisah | Konvensi meteorologi |
| Pollution Rose | Rata-rata PM2.5/PM10/VOC per arah datang angin; sektor tertinggi = dugaan arah sumber emisi | Analisis spasial sebaran polutan |
| Tren | Data 10 menit + rata-rata bergerak 24 jam + garis baku mutu | PP 22/2021 |
| Profil harian | Rata-rata per jam WIB, jam puncak ditandai | Pola jam sibuk / inversi |
| Kondisi perangkat | Tegangan dan estimasi kapasitas baterai, kelengkapan data, koordinat | Firmware ESP32 + A7670E |
| Pembanding | AQMS-01-SAYBA vs STASIUN-02-UNTAN: selisih rata-rata, RMSE, MAE, korelasi Pearson | Validasi akurasi sensor low-cost |
| Data pengukuran | 20 data terbaru + unduh CSV seluruh rentang | Lampiran skripsi |

Rentang analisis: 24 jam, 48 jam, atau 7 hari, dihitung mundur dari data terakhir device utama.

## Menjalankan

```bash
npm install
npm run dev          # http://localhost:3000
```

Tanpa `.env.local`, dasbor berjalan dalam **mode demo** memakai `src/data/dummy-sensor.json` (578 data simulasi 48 jam: 289 `AQMS-01-SAYBA` + 289 `STASIUN-02-UNTAN`). Label "Mode demo" tampil di header agar angka simulasi tidak tertukar dengan hasil ukur.

## Basis data Supabase

Skema ada di `supabase/migrations/` dan sudah diterapkan ke project Supabase.

| Objek | Akses dari key publik (browser/ESP32) |
|---|---|
| `public.sensor_udara_log` | **SELECT saja.** INSERT/UPDATE/DELETE langsung ditolak (`42501`). |
| `public.kirim_data_sensor()` | Endpoint kirim data stasiun. Wajib `device_id` + kunci perangkat yang benar. |
| `private.perangkat` | Tidak terekspos API. Menyimpan kunci perangkat sebagai hash bcrypt. |

Aturan data di tingkat basis data:
- Batas fisik sensor (`CHECK`): PM 0–1000 µg/m³, VOC 0–500, RH 0–100 %, tekanan 800–1100 hPa, arah angin 0–359°, baterai 0–5 V.
- Satu data per perangkat per detik (`UNIQUE (device_id, created_at)`). Kiriman ulang setelah sinyal 4G putus tidak membuat duplikat.
- Arah 360° dari wind vane disimpan sebagai 0° (Utara).
- Waktu pengukuran lebih dari 10 menit di depan jam server ditolak, karena tanda jam perangkat salah.
- Kolom `sumber` membedakan `stasiun` (hasil ukur) dan `dummy` (data uji). Selama hanya ada data dummy, dasbor memberi label "data dummy simulasi". Begitu data stasiun pertama masuk, data dummy otomatis tidak ikut dihitung.

Menghapus data dummy sebelum pengambilan data penelitian (SQL Editor):

```sql
delete from public.sensor_udara_log where sumber = 'dummy';
```

### Kirim data dari ESP32

```
POST https://<project>.supabase.co/rest/v1/rpc/kirim_data_sensor
apikey: <NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY>
Content-Type: application/json

{"p_device_id":"AQMS-01-SAYBA","p_kunci":"<kunci perangkat>",
 "p_pm2_5":21.4,"p_pm10":33.8,"p_voc_index":110,"p_temperature":30.2,
 "p_humidity":72.5,"p_pressure":1010.4,"p_wind_speed":1.6,
 "p_wind_direction":225,"p_battery_volt":4.02,
 "p_created_at":"2026-10-22T10:00:00+07:00"}
```

`p_device_id` adalah `AQMS-01-SAYBA` (alat utama) atau `STASIUN-02-UNTAN` (pembanding) — masing-masing device punya kunci perangkat sendiri (lihat `FOR HERMES/KUNCI_PERANGKAT_ESP32_RAHASIA.txt`, tidak di-commit). `p_created_at` opsional (tanpa itu dipakai waktu server). Contoh kode Arduino ada di `firmware/kirim_supabase_contoh.ino`. Kunci perangkat disimpan di `firmware/secrets.h` (tidak di-commit).

## Deploy ke Vercel

1. Vercel, lalu **Add New > Project**, lalu import repo ini. Framework terdeteksi Next.js.
2. **Settings > Environment Variables** (Production, Preview, Development):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```
   Keduanya publik dan aman di browser. **Jangan** isi secret key atau service_role key.
3. Deploy. Bila variabel diubah belakangan, lakukan **Redeploy**, karena nilai `NEXT_PUBLIC_*` disisipkan saat build.
4. Domain: **Settings > Domains**, tambahkan `windrose.sayba.id`, lalu buat record DNS `CNAME windrose → cname.vercel-dns.com` di pengelola DNS `sayba.id`.

Header keamanan (CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`) diatur di `next.config.ts`. CSP hanya mengizinkan koneksi ke URL Supabase yang ada di env.

## Struktur

```
src/
  app/            layout, halaman, gaya global (palet terukur WCAG AA)
  components/     Dashboard, MapPanel (peta Esri), ComparePanel (pembanding), EChart, ui
  hooks/          useSensorData: ambil data + langganan Realtime, fallback demo
  lib/
    ispu.ts         rumus ISPU dan baku mutu
    wind.ts         sektor kompas, Wind Rose, Pollution Rose
    stats.ts        jendela waktu, profil harian, format, CSV
    chartOptions.ts konfigurasi grafik
    compare.ts      pemasangan waktu + statistik pembanding (RMSE, MAE, korelasi)
    supabase.ts     klien Supabase
    types.ts        model data tabel sensor_udara_log, identitas dua device
  data/dummy-sensor.json  578 baris: 289 AQMS-01-SAYBA + 289 STASIUN-02-UNTAN
scripts/
  verify-logic.ts         uji rumus ISPU, sektor, wind rose, pembanding
  qa.mjs                  uji tampilan 360/768/1440 px dan interaksi
  qa-supabase-error.mjs   uji tampilan saat Supabase gagal
  qa-supabase-live.mjs    uji Supabase asli: REST, Realtime, header keamanan
supabase/
  migrations/             skema, RLS, fungsi kirim data, perangkat AQMS-01-SAYBA
  CATATAN_DATA_DUMMY_PEMBANDING.md  metodologi pembuatan data dummy pembanding
firmware/                 contoh kirim data ESP32 + templat secrets.h
```

## Pengujian

```bash
npm run typecheck
npm run lint
npm run test:logic
npm run build && npm start -- -p 3210   # terminal lain:
npm run test:ui
# Supabase asli (butuh .env.local + KUNCI_PERANGKAT di env):
node scripts/qa-supabase-live.mjs
```

`test:ui` memakai Google Chrome terpasang (`C:/Program Files/Google/Chrome/Application/chrome.exe`).
