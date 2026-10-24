// Model data satu baris tabel public.data_wrose01 atau public.data_stasiun02 (Supabase),
// atau baris file dummy lokal (mode demo tanpa Supabase).
// Kedua tabel Supabase kini terpisah secara fisik (bukan lagi 1 tabel + kolom device_id):
// data_wrose01 = alat IoT yang diuji, data_stasiun02 = acuan resmi pembanding.
// Kolom device_id TIDAK ADA lagi pada tabel Supabase; identitas device diketahui dari
// tabel asal baris (disuntikkan via parameter deviceId saat normalizeRow dipanggil).
// File dummy lokal (mode demo) masih menyimpan device_id per baris karena 1 file
// JSON berisi data gabungan kedua device untuk kesederhanaan mode offline.
export interface SensorRow {
  id?: string;
  created_at: string;
  device_id?: string;
  pm2_5: number | string;
  pm10: number | string;
  voc_index: number | string;
  temperature: number | string;
  humidity: number | string;
  pressure: number | string;
  wind_speed: number | string;
  wind_direction: number | string;
  latitude: number | string | null;
  longitude: number | string | null;
  battery_volt: number | string;
}

// Bentuk yang dipakai di UI: semua angka sudah bertipe number,
// waktu sudah dalam epoch milidetik (ts) agar mudah dihitung.
export interface SensorRecord {
  ts: number;
  createdAt: string;
  deviceId: string;
  // id baris Supabase, dipakai admin untuk mengubah/menghapus data lewat RPC.
  // Kosong pada data mode demo (file dummy lokal tidak punya id tabel).
  id: string | null;
  pm25: number;
  pm10: number;
  voc: number;
  temperature: number;
  humidity: number;
  pressure: number;
  windSpeed: number;
  windDirection: number;
  latitude: number;
  longitude: number;
  batteryVolt: number;
}

export type Pollutant = "pm25" | "pm10" | "voc";

// Identitas device, bukan sekadar koordinat fallback: WROSE-01 = alat IoT
// utama (objek penelitian, diuji), STASIUN-02-UNTAN = Lab Geofisika FMIPA UNTAN
// (objek pembanding, data acuan resmi independen). Metode: colocation testing
// (lihat BAB 3.4.2 skripsi) — kedua device disimpan di 2 tabel fisik terpisah
// (data_wrose01, data_stasiun02), bukan 1 tabel dengan kolom pembeda.
export const MAIN_DEVICE_ID = "WROSE-01";
export const COMPARE_DEVICE_ID = "STASIUN-02-UNTAN";

export interface StationInfo {
  id: string;
  name: string;
  shortName: string;
  area: string;
  role: "utama" | "pembanding";
  latitude: number;
  longitude: number;
}

export const STATIONS: Record<string, StationInfo> = {
  [MAIN_DEVICE_ID]: {
    id: MAIN_DEVICE_ID,
    name: "WROSE 4G LTE Pontianak",
    shortName: "WROSE-01",
    area: "Sekitar Lab Geofisika FMIPA UNTAN, Pontianak Timur",
    role: "utama",
    latitude: -0.057662,
    longitude: 109.350271,
  },
  [COMPARE_DEVICE_ID]: {
    id: COMPARE_DEVICE_ID,
    name: "Stasiun 02 Lab Geofisika FMIPA UNTAN",
    shortName: "Stasiun 02",
    area: "Pontianak, Kalimantan Barat",
    role: "pembanding",
    latitude: -0.058312,
    longitude: 109.349821,
  },
};

// Dipertahankan sebagai alias kompatibilitas: device utama = objek penelitian.
export const STATION = STATIONS[MAIN_DEVICE_ID];

// NUMERIC dari PostgREST bisa terkirim sebagai string; dipaksa ke number.
function num(v: number | string | null | undefined, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeRow(row: SensorRow, deviceId: string): SensorRecord {
  // Format "2026-08-26 18:00:00+07:00" diubah ke ISO agar parsing konsisten di semua browser.
  const iso = row.created_at.includes("T") ? row.created_at : row.created_at.replace(" ", "T");
  const fallbackStation = STATIONS[deviceId] ?? STATION;
  return {
    ts: new Date(iso).getTime(),
    createdAt: iso,
    deviceId,
    id: row.id ?? null,
    pm25: num(row.pm2_5),
    pm10: num(row.pm10),
    voc: num(row.voc_index),
    temperature: num(row.temperature),
    humidity: num(row.humidity),
    pressure: num(row.pressure),
    windSpeed: num(row.wind_speed),
    windDirection: ((num(row.wind_direction) % 360) + 360) % 360,
    latitude: num(row.latitude, fallbackStation.latitude),
    longitude: num(row.longitude, fallbackStation.longitude),
    batteryVolt: num(row.battery_volt),
  };
}
