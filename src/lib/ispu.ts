// Perhitungan ISPU sesuai Permen LHK No. P.14/MENLHK/SETJEN/KUM.1/7/2020
// dan baku mutu udara ambien PP No. 22 Tahun 2021 Lampiran VII.

export type IspuCategory = "Baik" | "Sedang" | "Tidak Sehat" | "Sangat Tidak Sehat" | "Berbahaya";

// Batas ISPU dan batas konsentrasi (µg/m³, rata-rata 24 jam) per Permen LHK P.14/2020.
export const ISPU_BREAKPOINTS = {
  ispu: [0, 50, 100, 200, 300, 500],
  pm25: [0, 15.5, 55.4, 150.4, 250.4, 500],
  pm10: [0, 50, 150, 350, 420, 500],
} as const;

// Baku mutu udara ambien PP 22/2021 Lampiran VII (µg/m³).
export const BAKU_MUTU = {
  pm25: { avg24h: 55, annual: 15 },
  pm10: { avg24h: 75, annual: 40 },
} as const;

export interface CategoryStyle {
  category: IspuCategory;
  // Warna isi sesuai warna resmi ISPU (hijau, biru, kuning, merah, hitam).
  fill: string;
  // Warna teks di atas fill; dipilih agar kontras >= 4.5:1.
  onFill: string;
  advice: string;
}

export const CATEGORY_STYLES: CategoryStyle[] = [
  {
    category: "Baik",
    fill: "#15803d",
    onFill: "#ffffff",
    advice: "Kualitas udara sangat baik, tidak memberikan efek negatif terhadap manusia, hewan, dan tumbuhan.",
  },
  {
    category: "Sedang",
    fill: "#1d4ed8",
    onFill: "#ffffff",
    advice: "Kualitas udara masih dapat diterima pada kesehatan manusia, hewan, dan tumbuhan.",
  },
  {
    category: "Tidak Sehat",
    fill: "#facc15",
    onFill: "#1c2321",
    advice: "Kualitas udara bersifat merugikan pada manusia, hewan, dan tumbuhan.",
  },
  {
    category: "Sangat Tidak Sehat",
    fill: "#b91c1c",
    onFill: "#ffffff",
    advice: "Kualitas udara dapat meningkatkan risiko kesehatan pada sejumlah segmen populasi yang terpapar.",
  },
  {
    category: "Berbahaya",
    fill: "#111827",
    onFill: "#ffffff",
    advice: "Kualitas udara dapat merugikan kesehatan serius pada populasi dan perlu penanganan cepat.",
  },
];

// Rumus Permen LHK P.14/2020: I = ((Ia - Ib) / (Xa - Xb)) * (Xx - Xb) + Ib
export function concentrationToIspu(value: number, param: "pm25" | "pm10"): number {
  const xs = ISPU_BREAKPOINTS[param];
  const is = ISPU_BREAKPOINTS.ispu;
  if (value <= 0) return 0;
  for (let i = 1; i < xs.length; i++) {
    if (value <= xs[i]) {
      const xb = xs[i - 1];
      const xa = xs[i];
      const ib = is[i - 1];
      const ia = is[i];
      return ((ia - ib) / (xa - xb)) * (value - xb) + ib;
    }
  }
  // Di atas batas tabel, ISPU dibatasi 500 (kategori Berbahaya).
  return 500;
}

export function ispuCategory(ispu: number): CategoryStyle {
  if (ispu <= 50) return CATEGORY_STYLES[0];
  if (ispu <= 100) return CATEGORY_STYLES[1];
  if (ispu <= 200) return CATEGORY_STYLES[2];
  if (ispu <= 300) return CATEGORY_STYLES[3];
  return CATEGORY_STYLES[4];
}

export interface IspuResult {
  value: number;
  pm25Ispu: number;
  pm10Ispu: number;
  critical: "PM2.5" | "PM10";
  style: CategoryStyle;
}

// ISPU akhir = nilai tertinggi antar parameter (parameter kritis).
export function computeIspu(pm25: number, pm10: number): IspuResult {
  const a = concentrationToIspu(pm25, "pm25");
  const b = concentrationToIspu(pm10, "pm10");
  const value = Math.round(Math.max(a, b));
  return {
    value,
    pm25Ispu: Math.round(a),
    pm10Ispu: Math.round(b),
    critical: a >= b ? "PM2.5" : "PM10",
    style: ispuCategory(value),
  };
}
