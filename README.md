# Web Dasbor Kualitas Udara: Stasiun 02 FMIPA UNTAN

Dasbor web untuk skripsi **"Rancang Bangun Sistem Pemantau Kualitas Udara (PM2.5, PM10, VOC) Berbasis IoT 4G LTE dan Analisis Spasial Sebaran Polutan Menggunakan Pemodelan Wind Rose"**.
Peneliti: Febrian Sayba Jaya Kasuma (D1051231070), Teknik Lingkungan, Fakultas Teknik, Universitas Tanjungpura.

## Isi dasbor

| Bagian | Isi | Dasar |
|---|---|---|
| ISPU 24 jam | Nilai dan kategori ISPU dari rata-rata 24 jam PM2.5 dan PM10, parameter kritis, indikasi sesaat | Permen LHK No. P.14/MENLHK/SETJEN/KUM.1/7/2020 |
| Pengukuran terakhir | PM2.5, PM10 terhadap baku mutu 24 jam, VOC, suhu, RH, tekanan, kecepatan dan arah angin | PP No. 22 Tahun 2021 Lampiran VII |
| Wind Rose | Frekuensi arah datang angin, 16 sektor × 22,5°, 4 kelas kecepatan, angin tenang < 0,5 m/s dipisah | Konvensi meteorologi |
| Pollution Rose | Rata-rata PM2.5/PM10/VOC per arah datang angin; sektor tertinggi = dugaan arah sumber emisi | Analisis spasial sebaran polutan |
| Tren | Data 10 menit + rata-rata bergerak 24 jam + garis baku mutu | PP 22/2021 |
| Profil harian | Rata-rata per jam WIB, jam puncak ditandai | Pola jam sibuk / inversi |
| Kondisi perangkat | Tegangan dan estimasi kapasitas baterai, kelengkapan data, koordinat | Firmware ESP32 + A7670E |
| Data pengukuran | 20 data terbaru + unduh CSV seluruh rentang | Lampiran skripsi |

Rentang analisis: 24 jam, 48 jam, atau 7 hari, dihitung mundur dari data terakhir.

## Menjalankan

```bash
npm install
npm run dev          # http://localhost:3000
```

Tanpa `.env.local`, dasbor berjalan dalam **mode demo** memakai `src/data/dummy-sensor.json` (289 data simulasi 48 jam). Label "Mode demo" tampil di header agar angka simulasi tidak tertukar dengan hasil ukur.

## Menghubungkan ke Supabase

1. Buat project di Supabase.
2. Buka **SQL Editor**, jalankan `../SUPABASE_SCHEMA_DAN_DUMMY_DATA.sql`. Skrip ini membuat tabel `sensor_udara_log`, indeks waktu, kebijakan RLS, mengaktifkan Realtime, dan mengisi data dummy.
3. Salin `.env.example` menjadi `.env.local`, isi dari **Project Settings > API**:
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   ```
4. Jalankan ulang `npm run dev`. Header berubah menjadi "Supabase · Realtime aktif". Setiap `INSERT` baru dari stasiun langsung muncul tanpa muat ulang halaman.

Jangan commit `.env.local` (sudah ada di `.gitignore`).

## Deploy ke Vercel

Import folder ini ke Vercel, isi dua variabel lingkungan di atas pada **Settings > Environment Variables**, lalu deploy.

## Struktur

```
src/
  app/            layout, halaman, gaya global (palet terukur WCAG AA)
  components/     Dashboard, EChart (pembungkus Apache ECharts), ui
  hooks/          useSensorData: ambil data + langganan Realtime, fallback demo
  lib/
    ispu.ts         rumus ISPU dan baku mutu
    wind.ts         sektor kompas, Wind Rose, Pollution Rose
    stats.ts        jendela waktu, profil harian, format, CSV
    chartOptions.ts konfigurasi grafik
    supabase.ts     klien Supabase
    types.ts        model data tabel sensor_udara_log
  data/dummy-sensor.json
scripts/
  verify-logic.ts         uji rumus ISPU, sektor, wind rose
  qa.mjs                  uji tampilan 360/768/1440 px dan interaksi
  qa-supabase-error.mjs   uji tampilan saat Supabase gagal
```

## Pengujian

```bash
npm run typecheck
npm run lint
npm run test:logic
npm run build && npm start -- -p 3210   # terminal lain:
npm run test:ui
```

`test:ui` memakai Google Chrome terpasang (`C:/Program Files/Google/Chrome/Application/chrome.exe`).
