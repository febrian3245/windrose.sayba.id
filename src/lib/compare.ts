// Pembanding dua rangkaian data: alat IoT utama (AQMS-01-SAYBA) vs objek
// pembanding (STASIUN-02-UNTAN). Dipasangkan berdasarkan waktu terdekat
// (toleransi ±5 menit, karena dua device tidak selalu kirim di detik yang sama).
import type { Pollutant, SensorRecord } from "./types";

const MATCH_TOLERANCE_MS = 5 * 60_000;

export interface PairedPoint {
  ts: number;
  main: number;
  compare: number;
}

// Mencocokkan setiap titik `main` dengan titik `compare` berwaktu terdekat.
// Daftar `compare` diasumsikan terurut naik (ts ascending).
export function pairByNearestTime(main: SensorRecord[], compare: SensorRecord[], key: Pollutant): PairedPoint[] {
  if (!main.length || !compare.length) return [];
  const pairs: PairedPoint[] = [];
  let j = 0;
  for (const m of main) {
    while (j < compare.length - 1 && Math.abs(compare[j + 1].ts - m.ts) <= Math.abs(compare[j].ts - m.ts)) {
      j++;
    }
    const c = compare[j];
    if (Math.abs(c.ts - m.ts) <= MATCH_TOLERANCE_MS) {
      pairs.push({ ts: m.ts, main: m[key], compare: c[key] });
    }
  }
  return pairs;
}

export interface CompareStats {
  n: number;
  meanMain: number;
  meanCompare: number;
  meanDiff: number;
  mae: number;
  rmse: number;
  // Korelasi Pearson; null bila n < 2 atau salah satu seri konstan (varians nol).
  r: number | null;
}

export function compareStats(pairs: PairedPoint[]): CompareStats {
  const n = pairs.length;
  if (!n) return { n: 0, meanMain: 0, meanCompare: 0, meanDiff: 0, mae: 0, rmse: 0, r: null };
  let sumMain = 0;
  let sumCompare = 0;
  let sumDiff = 0;
  let sumAbsDiff = 0;
  let sumSqDiff = 0;
  for (const p of pairs) {
    const d = p.main - p.compare;
    sumMain += p.main;
    sumCompare += p.compare;
    sumDiff += d;
    sumAbsDiff += Math.abs(d);
    sumSqDiff += d * d;
  }
  const meanMain = sumMain / n;
  const meanCompare = sumCompare / n;
  let r: number | null = null;
  if (n >= 2) {
    let cov = 0;
    let varMain = 0;
    let varCompare = 0;
    for (const p of pairs) {
      const dm = p.main - meanMain;
      const dc = p.compare - meanCompare;
      cov += dm * dc;
      varMain += dm * dm;
      varCompare += dc * dc;
    }
    r = varMain > 0 && varCompare > 0 ? cov / Math.sqrt(varMain * varCompare) : null;
  }
  return {
    n,
    meanMain,
    meanCompare,
    meanDiff: sumDiff / n,
    mae: sumAbsDiff / n,
    rmse: Math.sqrt(sumSqDiff / n),
    r,
  };
}
