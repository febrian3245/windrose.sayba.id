// Pemetaan, validasi, dan templat untuk impor data massal dari CSV/Excel.

import { uraiCsv, bacaXlsx, susunCsv, buatXlsx, type NilaiSel } from "./sheet.ts";

export interface BarisImpor {
  baris: number; // nomor baris di berkas (untuk pesan galat)
  created_at: string; // ISO dengan offset +07:00
  pm2_5: number;
  pm10: number;
  voc_index: number;
  temperature: number;
  humidity: number;
  pressure: number;
  wind_speed: number;
  wind_direction: number;
  battery_volt: number;
}

export interface HasilUrai {
  data: BarisImpor[];
  galat: { baris: number; pesan: string }[];
}

// Kolom wajib. Nama alternatif disediakan agar pengguna tidak perlu mengubah
// judul kolom bila berkas berasal dari ekspor dasbor atau catatan manual.
const KOLOM: {
  kunci: keyof Omit<BarisImpor, "baris" | "created_at">;
  nama: string[];
  min: number;
  max: number;
  label: string;
  satuan: string;
}[] = [
  { kunci: "pm2_5", nama: ["pm2_5", "pm25", "pm2.5"], min: 0, max: 1000, label: "PM2.5", satuan: "µg/m³" },
  { kunci: "pm10", nama: ["pm10"], min: 0, max: 1000, label: "PM10", satuan: "µg/m³" },
  { kunci: "voc_index", nama: ["voc_index", "voc", "indeks_voc"], min: 0, max: 500, label: "Indeks VOC", satuan: "" },
  { kunci: "temperature", nama: ["temperature", "suhu", "temp"], min: -10, max: 60, label: "Suhu", satuan: "°C" },
  { kunci: "humidity", nama: ["humidity", "kelembapan", "rh"], min: 0, max: 100, label: "Kelembapan", satuan: "%" },
  { kunci: "pressure", nama: ["pressure", "tekanan"], min: 800, max: 1100, label: "Tekanan", satuan: "hPa" },
  { kunci: "wind_speed", nama: ["wind_speed", "kecepatan_angin", "kec_angin"], min: 0, max: 75, label: "Kecepatan angin", satuan: "m/s" },
  { kunci: "wind_direction", nama: ["wind_direction", "arah_angin", "arah"], min: 0, max: 360, label: "Arah angin", satuan: "°" },
  { kunci: "battery_volt", nama: ["battery_volt", "baterai", "volt"], min: 0, max: 5, label: "Baterai", satuan: "V" },
];

const NAMA_WAKTU = ["created_at", "waktu", "timestamp", "tanggal", "datetime"];

function normalkan(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "_").replace(/[()]/g, "").replace(/µg\/m³|°c|hpa|m\/s|%|°|v$/g, "").replace(/_+$/, "");
}

// Angka diterima dalam format Inggris (31.5) maupun Indonesia (31,5).
// Pemisah ribuan titik dipakai hanya bila polanya jelas (1.009 -> 1009).
function keAngka(mentah: string): number | null {
  let s = mentah.trim().replace(/\s/g, "");
  if (s === "") return null;
  if (s.includes(",") && s.includes(".")) {
    // Pemisah desimal = tanda yang muncul paling akhir.
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Menerima ISO (dengan atau tanpa offset), "YYYY-MM-DD HH:MM", format Indonesia
// "DD/MM/YYYY HH:MM", serta nomor seri tanggal Excel. Waktu tanpa offset
// dianggap WIB, sesuai konteks pengukuran di Pontianak.
function keWaktuIso(mentah: string): string | null {
  const s = mentah.trim();
  if (s === "") return null;

  // Nomor seri Excel (hari sejak 1899-12-30). Excel menyimpan waktu tanpa zona;
  // angkanya langsung dibaca sebagai jam dinding WIB, jadi komponen tanggal/jam
  // disusun dari nilai UTC (tanpa menambah offset) lalu ditandai +07:00.
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 20000 && serial < 80000) {
      const ms = Math.round((serial - 25569) * 86400000);
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) {
        return `${d.toISOString().slice(0, 19)}+07:00`;
      }
    }
    return null;
  }

  // DD/MM/YYYY atau DD-MM-YYYY.
  const idn = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[ T]*(\d{1,2})?:?(\d{2})?/.exec(s);
  if (idn) {
    const [, d, mo, y, h = "0", mi = "0"] = idn;
    const p = (n: string, l = 2) => n.padStart(l, "0");
    return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:00+07:00`;
  }

  // ISO dengan offset eksplisit: dipakai apa adanya.
  if (/[+-]\d{2}:?\d{2}$|Z$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : s;
  }

  // ISO/SQL tanpa offset: dianggap WIB.
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (iso) {
    const [, y, mo, d, h, mi, se = "00"] = iso;
    return `${y}-${mo}-${d}T${h.padStart(2, "0")}:${mi}:${se}+07:00`;
  }
  return null;
}

export function uraiBaris(tabel: string[][]): HasilUrai {
  const galat: { baris: number; pesan: string }[] = [];

  // Baris petunjuk pada templat dimulai tanda '#'. Dilewati otomatis agar
  // pengguna yang lupa menghapusnya tidak mendapat galat yang membingungkan.
  // Nomor baris asli dipertahankan supaya pesan galat tetap menunjuk baris
  // yang benar di dalam berkas.
  const berindeks = tabel
    .map((baris, i) => ({ baris, no: i + 1 }))
    .filter(({ baris }) => !(baris[0] ?? "").trim().startsWith("#"));

  if (berindeks.length < 2) {
    return { data: [], galat: [{ baris: 0, pesan: "Berkas kosong atau hanya berisi judul kolom." }] };
  }

  const judul = berindeks[0].baris.map(normalkan);
  const cariKolom = (nama: string[]) => judul.findIndex((j) => nama.includes(j));

  const iWaktu = cariKolom(NAMA_WAKTU);
  if (iWaktu < 0) {
    return { data: [], galat: [{ baris: berindeks[0].no, pesan: `Kolom waktu tidak ditemukan. Judul yang dikenali: ${NAMA_WAKTU.join(", ")}.` }] };
  }

  const indeks = new Map<string, number>();
  for (const k of KOLOM) {
    const i = cariKolom(k.nama);
    if (i < 0) {
      return { data: [], galat: [{ baris: berindeks[0].no, pesan: `Kolom "${k.label}" tidak ditemukan. Judul yang dikenali: ${k.nama.join(", ")}.` }] };
    }
    indeks.set(k.kunci, i);
  }

  const data: BarisImpor[] = [];
  const waktuTerpakai = new Set<string>();

  for (let r = 1; r < berindeks.length; r++) {
    const baris = berindeks[r].baris;
    const noBaris = berindeks[r].no;

    const iso = keWaktuIso(baris[iWaktu] ?? "");
    if (!iso) {
      galat.push({ baris: noBaris, pesan: `Waktu tidak dikenali: "${(baris[iWaktu] ?? "").slice(0, 30)}".` });
      continue;
    }
    if (waktuTerpakai.has(iso)) {
      galat.push({ baris: noBaris, pesan: `Waktu ${iso} muncul lebih dari sekali di berkas ini.` });
      continue;
    }

    const nilai: Record<string, number> = {};
    let gagal = false;
    for (const k of KOLOM) {
      const mentah = baris[indeks.get(k.kunci)!] ?? "";
      const n = keAngka(mentah);
      if (n === null) {
        galat.push({ baris: noBaris, pesan: `${k.label} bukan angka: "${mentah.slice(0, 20)}".` });
        gagal = true;
        break;
      }
      if (n < k.min || n > k.max) {
        galat.push({ baris: noBaris, pesan: `${k.label} ${n} di luar rentang ${k.min}–${k.max} ${k.satuan}.` });
        gagal = true;
        break;
      }
      // Arah angin 360° disamakan dengan 0° (Utara), seperti di basis data.
      nilai[k.kunci] = k.kunci === "wind_direction" ? (n === 360 ? 0 : Math.round(n)) : k.kunci === "voc_index" ? Math.round(n) : n;
    }
    if (gagal) continue;

    waktuTerpakai.add(iso);
    data.push({ baris: noBaris, created_at: iso, ...(nilai as Omit<BarisImpor, "baris" | "created_at">) });
  }

  return { data, galat };
}

export async function uraiBerkas(file: File): Promise<HasilUrai> {
  const nama = file.name.toLowerCase();
  if (nama.endsWith(".xlsx")) {
    return uraiBaris(await bacaXlsx(await file.arrayBuffer()));
  }
  if (nama.endsWith(".csv") || nama.endsWith(".txt")) {
    return uraiBaris(uraiCsv(await file.text()));
  }
  if (nama.endsWith(".xls")) {
    return { data: [], galat: [{ baris: 0, pesan: "Format .xls lama tidak didukung. Simpan ulang sebagai .xlsx atau .csv." }] };
  }
  return { data: [], galat: [{ baris: 0, pesan: "Format berkas tidak dikenali. Gunakan .csv atau .xlsx." }] };
}

// ---------------------------------------------------------------- templat

const JUDUL_TEMPLAT = [
  "created_at",
  "pm2_5",
  "pm10",
  "voc_index",
  "temperature",
  "humidity",
  "pressure",
  "wind_speed",
  "wind_direction",
  "battery_volt",
];

// Dua baris contoh memakai angka yang masuk akal untuk Pontianak, agar
// pengguna langsung melihat format waktu dan rentang nilai yang benar.
const CONTOH: NilaiSel[][] = [
  ["2026-08-28 10:00", 17.7, 33.26, 161, 31.97, 70.84, 1011.52, 2.11, 263, 3.67],
  ["2026-08-28 11:00", 21.45, 36.8, 148, 32.4, 68.2, 1010.9, 1.84, 248, 3.71],
];

const PETUNJUK: NilaiSel[][] = [
  ["# Templat impor data pengukuran — dasbor WROSE 4G LTE Pontianak"],
  ["# Hapus seluruh baris yang dimulai tanda # sebelum mengimpor, lalu ganti dua baris contoh dengan data sebenarnya."],
  ["#"],
  ["# created_at    : waktu pengukuran WIB. Format yang diterima: 2026-08-28 10:00, 28/08/2026 10:00, atau ISO lengkap."],
  ["# pm2_5, pm10   : 0-1000 µg/m³        voc_index      : 0-500"],
  ["# temperature   : -10-60 °C           humidity       : 0-100 %"],
  ["# pressure      : 800-1100 hPa        wind_speed     : 0-75 m/s"],
  ["# wind_direction: 0-360 ° (0 = Utara) battery_volt   : 0-5 V"],
  ["#"],
  ["# Desimal boleh memakai titik (31.5) atau koma (31,5). Waktu yang sudah ada di basis data akan dilewati, bukan digandakan."],
  [],
];

export function templatCsv(): Blob {
  const isi = susunCsv([...PETUNJUK, JUDUL_TEMPLAT, ...CONTOH]);
  // BOM agar Excel di Windows membaca UTF-8 dengan benar.
  return new Blob(["\uFEFF" + isi], { type: "text/csv;charset=utf-8" });
}

export function templatXlsx(): Blob {
  return buatXlsx([...PETUNJUK, JUDUL_TEMPLAT, ...CONTOH], "Templat Impor");
}

export { JUDUL_TEMPLAT };
