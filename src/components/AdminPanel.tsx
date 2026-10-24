"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { MAIN_DEVICE_ID, COMPARE_DEVICE_ID, STATIONS, type SensorRecord } from "@/lib/types";
import { formatDateTime } from "@/lib/stats";

// Kode sumber yang dipakai RPC kelola_* untuk memilih tabel tujuan.
type SumberKode = "wrose01" | "stasiun02";

const SUMBER: { kode: SumberKode; deviceId: string; label: string; catatan: string }[] = [
  {
    kode: "wrose01",
    deviceId: MAIN_DEVICE_ID,
    label: STATIONS[MAIN_DEVICE_ID].shortName,
    catatan: "alat IoT utama — normalnya terisi otomatis oleh alat tiap 10 menit",
  },
  {
    kode: "stasiun02",
    deviceId: COMPARE_DEVICE_ID,
    label: STATIONS[COMPARE_DEVICE_ID].shortName,
    catatan: "acuan resmi pembanding — dicatat manual tiap 1 jam",
  },
];

interface Formulir {
  waktu: string;
  pm25: string;
  pm10: string;
  voc: string;
  suhu: string;
  rh: string;
  tekanan: string;
  kecAngin: string;
  arahAngin: string;
  baterai: string;
}

const FORM_KOSONG: Formulir = {
  waktu: "",
  pm25: "",
  pm10: "",
  voc: "",
  suhu: "",
  rh: "",
  tekanan: "",
  kecAngin: "",
  arahAngin: "",
  baterai: "",
};

// Batas sama dengan CHECK constraint di basis data, supaya pengguna
// mendapat pesan jelas di browser alih-alih error SQL mentah.
const BATAS: Record<keyof Omit<Formulir, "waktu">, { min: number; max: number; nama: string; satuan: string }> = {
  pm25: { min: 0, max: 1000, nama: "PM2.5", satuan: "µg/m³" },
  pm10: { min: 0, max: 1000, nama: "PM10", satuan: "µg/m³" },
  voc: { min: 0, max: 500, nama: "Indeks VOC", satuan: "" },
  suhu: { min: -10, max: 60, nama: "Suhu", satuan: "°C" },
  rh: { min: 0, max: 100, nama: "Kelembapan", satuan: "%" },
  tekanan: { min: 800, max: 1100, nama: "Tekanan", satuan: "hPa" },
  kecAngin: { min: 0, max: 75, nama: "Kecepatan angin", satuan: "m/s" },
  arahAngin: { min: 0, max: 360, nama: "Arah angin", satuan: "°" },
  baterai: { min: 0, max: 5, nama: "Baterai", satuan: "V" },
};

// Waktu lokal (WIB) dari input datetime-local diubah ke ISO dengan offset +07:00
// agar tidak bergeser saat disimpan sebagai timestamptz.
function waktuLokalKeIso(nilai: string): string {
  return `${nilai}:00+07:00`;
}

function isoKeWaktuLokal(iso: string): string {
  const d = new Date(iso);
  const wib = new Date(d.getTime() + 7 * 3600_000);
  return wib.toISOString().slice(0, 16);
}

export default function AdminPanel({ records, onBerubah }: { records: SensorRecord[]; onBerubah: () => void }) {
  const auth = useAdminAuth();
  const [mail, setMail] = useState("");
  const [sandi, setSandi] = useState("");
  const [sibuk, setSibuk] = useState(false);

  const [sumber, setSumber] = useState<SumberKode>("stasiun02");
  const [form, setForm] = useState<Formulir>(FORM_KOSONG);
  const [pesan, setPesan] = useState<{ tipe: "ok" | "galat"; teks: string } | null>(null);
  const [idUbah, setIdUbah] = useState<string | null>(null);

  const sumberAktif = SUMBER.find((s) => s.kode === sumber)!;
  const barisSumber = records
    .filter((r) => r.deviceId === sumberAktif.deviceId && r.id)
    .slice(-10)
    .reverse();

  async function kirimLogin(e: React.FormEvent) {
    e.preventDefault();
    setSibuk(true);
    await auth.masuk(mail, sandi);
    setSandi("");
    setSibuk(false);
  }

  function ubahField(k: keyof Formulir, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Validasi di browser: cek kelengkapan dan rentang sebelum memanggil RPC.
  function validasi(): string | null {
    if (!form.waktu) return "Waktu pengukuran wajib diisi.";
    for (const [k, b] of Object.entries(BATAS) as [keyof typeof BATAS, (typeof BATAS)[keyof typeof BATAS]][]) {
      const mentah = form[k];
      if (mentah === "") return `${b.nama} wajib diisi.`;
      const n = Number(mentah);
      if (!Number.isFinite(n)) return `${b.nama} harus berupa angka.`;
      if (n < b.min || n > b.max) return `${b.nama} harus antara ${b.min}–${b.max} ${b.satuan}.`;
    }
    return null;
  }

  async function simpan(e: React.FormEvent) {
    e.preventDefault();
    const galat = validasi();
    if (galat) {
      setPesan({ tipe: "galat", teks: galat });
      return;
    }
    const supabase = getSupabase();
    if (!supabase) return;

    setSibuk(true);
    setPesan(null);

    const nilai = {
      p_pm2_5: Number(form.pm25),
      p_pm10: Number(form.pm10),
      p_voc_index: Math.round(Number(form.voc)),
      p_temperature: Number(form.suhu),
      p_humidity: Number(form.rh),
      p_pressure: Number(form.tekanan),
      p_wind_speed: Number(form.kecAngin),
      p_wind_direction: Math.round(Number(form.arahAngin)),
      p_battery_volt: Number(form.baterai),
    };

    const { data, error } = idUbah
      ? await supabase.rpc("kelola_ubah_data", { p_sumber: sumber, p_id: idUbah, ...nilai })
      : await supabase.rpc("kelola_tambah_data", { p_sumber: sumber, p_created_at: waktuLokalKeIso(form.waktu), ...nilai });

    setSibuk(false);

    if (error) {
      setPesan({ tipe: "galat", teks: `Gagal menyimpan: ${error.message}` });
      return;
    }
    // kelola_tambah_data mengembalikan null bila baris pada waktu itu sudah ada.
    if (!idUbah && data === null) {
      setPesan({ tipe: "galat", teks: "Data pada waktu tersebut sudah ada. Ubah baris yang ada, atau pilih waktu lain." });
      return;
    }

    setPesan({ tipe: "ok", teks: idUbah ? "Data berhasil diperbarui." : "Data berhasil ditambahkan." });
    setForm(FORM_KOSONG);
    setIdUbah(null);
    onBerubah();
  }

  function mulaiUbah(r: SensorRecord) {
    setIdUbah(r.id);
    setPesan(null);
    setForm({
      waktu: isoKeWaktuLokal(r.createdAt),
      pm25: String(r.pm25),
      pm10: String(r.pm10),
      voc: String(r.voc),
      suhu: String(r.temperature),
      rh: String(r.humidity),
      tekanan: String(r.pressure),
      kecAngin: String(r.windSpeed),
      arahAngin: String(r.windDirection),
      baterai: String(r.batteryVolt),
    });
  }

  async function hapus(r: SensorRecord) {
    if (!r.id) return;
    const yakin = window.confirm(
      `Hapus data ${sumberAktif.label} pada ${formatDateTime(r.ts)}?\n\nTindakan ini tidak dapat dibatalkan.`,
    );
    if (!yakin) return;

    const supabase = getSupabase();
    if (!supabase) return;

    setSibuk(true);
    const { error } = await supabase.rpc("kelola_hapus_data", { p_sumber: sumber, p_id: r.id });
    setSibuk(false);

    if (error) {
      setPesan({ tipe: "galat", teks: `Gagal menghapus: ${error.message}` });
      return;
    }
    setPesan({ tipe: "ok", teks: "Data berhasil dihapus." });
    if (idUbah === r.id) {
      setIdUbah(null);
      setForm(FORM_KOSONG);
    }
    onBerubah();
  }

  if (auth.status === "memuat") {
    return <p className="text-sm text-muted">Memeriksa sesi…</p>;
  }

  // Belum login: tampilkan formulir masuk.
  if (auth.status === "keluar") {
    return (
      <form onSubmit={kirimLogin} className="max-w-sm">
        <p className="text-sm text-muted">
          Masuk sebagai admin untuk menambah, mengubah, atau menghapus data pengukuran. Pengunjung biasa tetap dapat
          membaca seluruh dasbor tanpa masuk.
        </p>
        <div className="mt-4 grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Email</span>
            <input
              type="email"
              required
              autoComplete="username"
              value={mail}
              onChange={(e) => setMail(e.target.value)}
              className="min-h-10 rounded-md border border-line bg-surface px-3 text-ink"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Sandi</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={sandi}
              onChange={(e) => setSandi(e.target.value)}
              className="min-h-10 rounded-md border border-line bg-surface px-3 text-ink"
            />
          </label>
          {auth.error ? <p className="text-sm font-medium text-alert">{auth.error}</p> : null}
          <button
            type="submit"
            disabled={sibuk}
            className="min-h-10 rounded-md bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {sibuk ? "Memproses…" : "Masuk"}
          </button>
        </div>
      </form>
    );
  }

  // Login tapi bukan admin.
  if (!auth.isAdmin) {
    return (
      <div className="rounded-md border border-line bg-surface px-4 py-3">
        <p className="text-sm">
          Masuk sebagai <strong className="text-ink">{auth.email}</strong>, tetapi akun ini belum memiliki role admin,
          sehingga tidak dapat mengubah data.
        </p>
        <button type="button" onClick={auth.keluar} className="mt-3 min-h-10 rounded-md border border-line px-4 text-sm font-medium">
          Keluar
        </button>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 py-3">
        <p className="text-sm">
          Masuk sebagai <strong className="text-ink">{auth.email}</strong> · role admin
        </p>
        <button type="button" onClick={auth.keluar} className="min-h-10 shrink-0 rounded-md border border-line px-4 text-sm font-medium">
          Keluar
        </button>
      </div>

      {/* Pemilih sumber: menentukan tabel tujuan, sehingga kedua rangkaian data
          tetap terpisah dan tidak mungkin tercampur lewat satu formulir. */}
      <fieldset className="mt-5">
        <legend className="text-sm font-medium">Sumber data yang dikelola</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {SUMBER.map((s) => (
            <button
              key={s.kode}
              type="button"
              onClick={() => {
                setSumber(s.kode);
                setIdUbah(null);
                setForm(FORM_KOSONG);
                setPesan(null);
              }}
              aria-pressed={sumber === s.kode}
              className={`min-h-10 rounded-md border px-4 text-sm font-medium ${
                sumber === s.kode ? "border-brand bg-brand-soft text-brand" : "border-line text-ink"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted">{sumberAktif.catatan}</p>
      </fieldset>

      {/* noValidate: validasi dijalankan oleh fungsi validasi() agar pesannya
          berbahasa Indonesia dan konsisten. Batas min/max tetap ditulis sebagai
          petunjuk spinner, dan server tetap memvalidasi lewat CHECK constraint. */}
      <form onSubmit={simpan} noValidate className="mt-5">
        <h3 className="font-semibold">
          {idUbah ? `Ubah data ${sumberAktif.label}` : `Tambah data ${sumberAktif.label}`}
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Waktu pengukuran (WIB)</span>
            <input
              type="datetime-local"
              required
              disabled={Boolean(idUbah)}
              value={form.waktu}
              onChange={(e) => ubahField("waktu", e.target.value)}
              className="min-h-10 rounded-md border border-line bg-surface px-3 text-ink disabled:opacity-60"
            />
            {idUbah ? <span className="text-muted">Waktu tidak dapat diubah; hapus lalu tambah bila perlu.</span> : null}
          </label>
          {(Object.keys(BATAS) as (keyof typeof BATAS)[]).map((k) => {
            const b = BATAS[k];
            return (
              <label key={k} className="grid gap-1 text-sm">
                <span className="font-medium">
                  {b.nama} {b.satuan ? `(${b.satuan})` : ""}
                </span>
                <input
                  type="number"
                  step="any"
                  required
                  min={b.min}
                  max={b.max}
                  value={form[k]}
                  onChange={(e) => ubahField(k, e.target.value)}
                  className="min-h-10 rounded-md border border-line bg-surface px-3 text-ink"
                />
                <span className="text-muted">
                  {b.min}–{b.max}
                </span>
              </label>
            );
          })}
        </div>

        {pesan ? (
          <p className={`mt-4 text-sm font-medium ${pesan.tipe === "ok" ? "text-brand" : "text-alert"}`} role="status">
            {pesan.teks}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={sibuk}
            className="min-h-10 rounded-md bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {sibuk ? "Menyimpan…" : idUbah ? "Simpan perubahan" : "Tambah data"}
          </button>
          {idUbah ? (
            <button
              type="button"
              onClick={() => {
                setIdUbah(null);
                setForm(FORM_KOSONG);
                setPesan(null);
              }}
              className="min-h-10 rounded-md border border-line px-4 text-sm font-medium"
            >
              Batal
            </button>
          ) : null}
        </div>
      </form>

      <div className="mt-6">
        <h3 className="font-semibold">Sepuluh data {sumberAktif.label} terbaru</h3>
        {barisSumber.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Belum ada data untuk sumber ini.</p>
        ) : (
          <div className="-mx-4 mt-2 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th scope="col" className="px-4 py-2 font-medium sm:pl-0">Waktu (WIB)</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">PM2.5</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">PM10</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">VOC</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium sm:pr-0">Tindakan</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {barisSumber.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap px-4 py-2 sm:pl-0">{formatDateTime(r.ts).replace(" WIB", "")}</td>
                    <td className="px-3 py-2 text-right">{r.pm25}</td>
                    <td className="px-3 py-2 text-right">{r.pm10}</td>
                    <td className="px-3 py-2 text-right">{r.voc}</td>
                    <td className="px-4 py-2 text-right sm:pr-0">
                      <span className="inline-flex gap-2">
                        <button
                          type="button"
                          onClick={() => mulaiUbah(r)}
                          className="min-h-10 rounded-md border border-line px-3 text-sm font-medium"
                        >
                          Ubah
                        </button>
                        <button
                          type="button"
                          onClick={() => hapus(r)}
                          disabled={sibuk}
                          className="min-h-10 rounded-md border border-alert px-3 text-sm font-medium text-alert disabled:opacity-60"
                        >
                          Hapus
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
