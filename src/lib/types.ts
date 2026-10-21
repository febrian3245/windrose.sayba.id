// Model data satu baris tabel public.sensor_udara_log (Supabase).
// Kolom identik dengan SUPABASE_SCHEMA_DAN_DUMMY_DATA.sql.
export interface SensorRow {
  id?: string;
  created_at: string;
  device_id: string;
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

// Koordinat Stasiun 02 Lab Geofisika FMIPA UNTAN (dipakai bila kolom kosong).
export const STATION = {
  id: "STASIUN-02-UNTAN",
  name: "Stasiun 02 Lab Geofisika FMIPA UNTAN",
  area: "Pontianak, Kalimantan Barat",
  latitude: -0.058312,
  longitude: 109.349821,
};

// NUMERIC dari PostgREST bisa terkirim sebagai string; dipaksa ke number.
function num(v: number | string | null | undefined, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeRow(row: SensorRow): SensorRecord {
  // Format "2026-08-26 18:00:00+07:00" diubah ke ISO agar parsing konsisten di semua browser.
  const iso = row.created_at.includes("T") ? row.created_at : row.created_at.replace(" ", "T");
  return {
    ts: new Date(iso).getTime(),
    createdAt: iso,
    deviceId: row.device_id,
    pm25: num(row.pm2_5),
    pm10: num(row.pm10),
    voc: num(row.voc_index),
    temperature: num(row.temperature),
    humidity: num(row.humidity),
    pressure: num(row.pressure),
    windSpeed: num(row.wind_speed),
    windDirection: ((num(row.wind_direction) % 360) + 360) % 360,
    latitude: num(row.latitude, STATION.latitude),
    longitude: num(row.longitude, STATION.longitude),
    batteryVolt: num(row.battery_volt),
  };
}
