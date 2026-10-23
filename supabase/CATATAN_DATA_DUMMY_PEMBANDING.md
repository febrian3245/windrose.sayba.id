# Catatan metodologi: data dummy pembanding WROSE-01

Lampiran skripsi: bagaimana 289 data dummy **WROSE-01** (alat IoT utama,
objek penelitian) dibuat dari 49 data dummy **STASIUN-02-UNTAN** (objek
pembanding) yang sudah ada sejak migrasi awal.

WROSE-01 diposisikan ±88 m dari Stasiun 02 (mikroklimat sama), sehingga
data dummy dibuat **berkorelasi** dengan Stasiun 02, ditambah bias dan noise
yang meniru karakteristik sensor low-cost (PMS5003 + BME688 generik)
dibanding instrumen Stasiun 02:

| Parameter | Rumus (nilai Stasiun 02 → WROSE-01) | Interpretasi |
|---|---|---|
| PM2.5 | `×1,09 + N(0, 2,1) + 1,5` | bias overestimate ±9%, khas sensor optik low-cost |
| PM10 | `×1,07 + N(0, 3,4) + 2,0` | idem |
| VOC | `+ N(0, 9)` | noise indeks relatif |
| Suhu | `+ N(0, 0,35) + 0,2` | sedikit lebih panas, posisi dekat dinding |
| Kelembapan | `+ N(0, 2,2) − 1,0` | |
| Tekanan | `+ N(0, 0,15)` | |
| Kecepatan angin | `×0,93 + N(0, 0,25)` | anemometer murah, under-read |
| Arah angin | `+ N(0, 12°)` | turbulensi lokal sekitar bangunan |
| Baterai | turun linier 4,18 V → 3,90 V | siklus baterai independen dari Stasiun 02 |

Semua nilai dibatasi ke rentang `CHECK` constraint masing-masing tabel
(`data_wrose01`, `data_stasiun02`) sebelum disimpan. Seed random: **42**
(deterministik, dapat direproduksi).

Tujuan: dasbor dapat menampilkan **panel pembanding** (selisih rata-rata,
RMSE, korelasi) antara dua sumber data yang tetap terpisah secara fisik
(alat IoT utama dan Stasiun 02 FMIPA UNTAN) sebelum data asli dari lapangan
tersedia.

## Setelah data stasiun asli masuk

Hapus seluruh baris dummy di kedua tabel:

```sql
truncate public.data_wrose01;
truncate public.data_stasiun02;
```

Panel pembanding akan tetap berjalan selama kedua device (`WROSE-01` dan
`STASIUN-02-UNTAN`) terus mengirim data hasil ukur sungguhan ke tabelnya
masing-masing.
