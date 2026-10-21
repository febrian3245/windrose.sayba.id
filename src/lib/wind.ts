// Pengolahan data angin untuk Wind Rose dan Pollution Rose.
// Konvensi meteorologi: arah angin = arah DATANGNYA angin (0° = dari Utara).
import type { Pollutant, SensorRecord } from "./types";

export const SECTORS_16 = [
  { code: "U", name: "Utara" },
  { code: "UTL", name: "Utara Timur Laut" },
  { code: "TL", name: "Timur Laut" },
  { code: "TTL", name: "Timur Timur Laut" },
  { code: "T", name: "Timur" },
  { code: "TTg", name: "Timur Tenggara" },
  { code: "Tg", name: "Tenggara" },
  { code: "STg", name: "Selatan Tenggara" },
  { code: "S", name: "Selatan" },
  { code: "SBD", name: "Selatan Barat Daya" },
  { code: "BD", name: "Barat Daya" },
  { code: "BBD", name: "Barat Barat Daya" },
  { code: "B", name: "Barat" },
  { code: "BBL", name: "Barat Barat Laut" },
  { code: "BL", name: "Barat Laut" },
  { code: "UBL", name: "Utara Barat Laut" },
] as const;

// Angin < 0,5 m/s dianggap tenang (calm): arahnya tidak representatif,
// sehingga dilaporkan terpisah dan tidak dimasukkan ke sektor.
export const CALM_LIMIT = 0.5;

export const SPEED_CLASSES = [
  { label: "0,5–1,5 m/s", min: 0.5, max: 1.5 },
  { label: "1,5–2,5 m/s", min: 1.5, max: 2.5 },
  { label: "2,5–3,5 m/s", min: 2.5, max: 3.5 },
  { label: "≥ 3,5 m/s", min: 3.5, max: Infinity },
] as const;

// Setiap sektor selebar 22,5°, sektor U berpusat di 0° (348,75°–11,25°).
export function sectorIndex(deg: number): number {
  const d = ((deg % 360) + 360) % 360;
  return Math.floor(((d + 11.25) % 360) / 22.5);
}

export function sectorRange(i: number): string {
  const start = (i * 22.5 - 11.25 + 360) % 360;
  const end = (i * 22.5 + 11.25) % 360;
  return `${start.toLocaleString("id-ID")}°–${end.toLocaleString("id-ID")}°`;
}

export interface WindRoseData {
  total: number;
  calmCount: number;
  calmPercent: number;
  // percent[classIndex][sectorIndex] = % dari seluruh pengamatan
  percent: number[][];
  sectorTotalPercent: number[];
  dominantSector: number;
  meanSpeed: number;
}

export function buildWindRose(records: SensorRecord[]): WindRoseData {
  const counts = SPEED_CLASSES.map(() => new Array<number>(16).fill(0));
  let calm = 0;
  let speedSum = 0;
  for (const r of records) {
    speedSum += r.windSpeed;
    if (r.windSpeed < CALM_LIMIT) {
      calm++;
      continue;
    }
    const s = sectorIndex(r.windDirection);
    const c = SPEED_CLASSES.findIndex((k) => r.windSpeed >= k.min && r.windSpeed < k.max);
    counts[c === -1 ? SPEED_CLASSES.length - 1 : c][s]++;
  }
  const total = records.length;
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  const percent = counts.map((row) => row.map(pct));
  const sectorTotalPercent = Array.from({ length: 16 }, (_, s) =>
    percent.reduce((acc, row) => acc + row[s], 0),
  );
  let dominantSector = 0;
  sectorTotalPercent.forEach((v, i) => {
    if (v > sectorTotalPercent[dominantSector]) dominantSector = i;
  });
  return {
    total,
    calmCount: calm,
    calmPercent: pct(calm),
    percent,
    sectorTotalPercent,
    dominantSector,
    meanSpeed: total ? speedSum / total : 0,
  };
}

export interface PollutionRoseData {
  mean: (number | null)[];
  count: number[];
  maxSector: number;
  calmMean: number | null;
}

// Pollution rose: rata-rata konsentrasi polutan menurut sektor arah datang angin.
// Sektor dengan rata-rata tertinggi menunjukkan arah sumber emisi yang paling mungkin.
export function buildPollutionRose(records: SensorRecord[], key: Pollutant): PollutionRoseData {
  const sum = new Array<number>(16).fill(0);
  const count = new Array<number>(16).fill(0);
  let calmSum = 0;
  let calmN = 0;
  for (const r of records) {
    if (r.windSpeed < CALM_LIMIT) {
      calmSum += r[key];
      calmN++;
      continue;
    }
    const s = sectorIndex(r.windDirection);
    sum[s] += r[key];
    count[s]++;
  }
  const mean = sum.map((v, i) => (count[i] ? v / count[i] : null));
  let maxSector = -1;
  mean.forEach((v, i) => {
    // Sektor dengan < 3 pengamatan diabaikan agar tidak menyesatkan.
    if (v !== null && count[i] >= 3 && (maxSector === -1 || v > (mean[maxSector] ?? -Infinity))) {
      maxSector = i;
    }
  });
  return { mean, count, maxSector, calmMean: calmN ? calmSum / calmN : null };
}
