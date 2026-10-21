import type { Pollutant, SensorRecord } from "./types";

export const HOUR_MS = 3_600_000;

export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

// Ambil data dalam jendela waktu tertentu, dihitung mundur dari data terakhir
// (bukan dari jam komputer) agar data historis/dummy tetap terbaca benar.
export function windowRecords(records: SensorRecord[], hours: number): SensorRecord[] {
  if (!records.length) return [];
  const end = records[records.length - 1].ts;
  const start = end - hours * HOUR_MS;
  return records.filter((r) => r.ts > start);
}

export interface Summary {
  min: number;
  max: number;
  mean: number;
}

export function summarize(records: SensorRecord[], key: Pollutant | "temperature" | "humidity"): Summary {
  if (!records.length) return { min: 0, max: 0, mean: 0 };
  const v = records.map((r) => r[key]);
  return { min: Math.min(...v), max: Math.max(...v), mean: mean(v) };
}

// Profil diurnal: rata-rata per jam (0–23 WIB) untuk melihat pola jam sibuk dan inversi malam.
export function diurnalProfile(records: SensorRecord[], key: Pollutant): (number | null)[] {
  const sum = new Array<number>(24).fill(0);
  const n = new Array<number>(24).fill(0);
  for (const r of records) {
    const h = wibHour(r.ts);
    sum[h] += r[key];
    n[h]++;
  }
  return sum.map((s, i) => (n[i] ? s / n[i] : null));
}

// Jam WIB (UTC+7) tanpa bergantung zona waktu komputer pengguna.
export function wibHour(ts: number): number {
  return new Date(ts + 7 * HOUR_MS).getUTCHours();
}

// Estimasi linier kapasitas baterai Li-Ion 1 sel (3,2 V = 0 %, 4,2 V = 100 %).
export function batteryPercent(volt: number): number {
  return Math.max(0, Math.min(100, ((volt - 3.2) / (4.2 - 3.2)) * 100));
}

const dateTimeFmt = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const timeFmt = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(ts: number): string {
  return `${dateTimeFmt.format(ts)} WIB`;
}

export function formatShort(ts: number): string {
  return timeFmt.format(ts);
}

export function fmt(n: number, digits = 1): string {
  return n.toLocaleString("id-ID", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function toCsv(records: SensorRecord[]): string {
  const header = [
    "created_at",
    "device_id",
    "pm2_5",
    "pm10",
    "voc_index",
    "temperature",
    "humidity",
    "pressure",
    "wind_speed",
    "wind_direction",
    "latitude",
    "longitude",
    "battery_volt",
  ];
  const lines = records.map((r) =>
    [
      r.createdAt,
      r.deviceId,
      r.pm25,
      r.pm10,
      r.voc,
      r.temperature,
      r.humidity,
      r.pressure,
      r.windSpeed,
      r.windDirection,
      r.latitude,
      r.longitude,
      r.batteryVolt,
    ].join(","),
  );
  return [header.join(","), ...lines].join("\n");
}
