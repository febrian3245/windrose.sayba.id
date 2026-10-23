// Pembanding dua rangkaian data: alat IoT utama (WROSE-01, kirim tiap 10 menit)
// vs objek pembanding (STASIUN-02-UNTAN, dibaca tiap 1 jam — sesuai siklus sampling
// asli alat itu). Dipasangkan per jam: untuk setiap data Stasiun 02, dicari data
// WROSE-01 pada waktu terdekat (toleransi ±35 menit, cukup untuk setengah interval
// 1 jam ditambah ruang toleransi keterlambatan kirim).
import type { Pollutant, SensorRecord } from "./types";

const MATCH_TOLERANCE_MS = 35 * 60_000;

export interface PairedPoint {
  ts: number;
  main: number;
  compare: number;
}

// Iterasi berbasis daftar yang LEBIH JARANG (biasanya `compare`/Stasiun 02, 1 jam),
// mencari titik `main` (biasanya WROSE-01, 10 menit) berwaktu terdekat untuk tiap titik.
// Kedua daftar diasumsikan terurut naik (ts ascending).
export function pairByNearestTime(main: SensorRecord[], compare: SensorRecord[], key: Pollutant): PairedPoint[] {
  if (!main.length || !compare.length) return [];
  const [sparse, dense, sparseIsMain] =
    compare.length <= main.length ? [compare, main, false] : [main, compare, true];
  const pairs: PairedPoint[] = [];
  let j = 0;
  for (const s of sparse) {
    while (j < dense.length - 1 && Math.abs(dense[j + 1].ts - s.ts) <= Math.abs(dense[j].ts - s.ts)) {
      j++;
    }
    const d = dense[j];
    if (Math.abs(d.ts - s.ts) <= MATCH_TOLERANCE_MS) {
      const mainVal = sparseIsMain ? s[key] : d[key];
      const compareVal = sparseIsMain ? d[key] : s[key];
      pairs.push({ ts: s.ts, main: mainVal, compare: compareVal });
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
