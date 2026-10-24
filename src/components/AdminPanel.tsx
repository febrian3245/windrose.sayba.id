"use client";

import { useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { MAIN_DEVICE_ID, COMPARE_DEVICE_ID, STATIONS, type SensorRecord } from "@/lib/types";
import { formatDateTime } from "@/lib/stats";
import { uraiBerkas, templatCsv, templatXlsx, type BarisImpor } from "@/lib/import-data";
import { unduhBlob, buatXlsx, susunCsv } from "@/lib/sheet";

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

  // Keadaan impor berkas: pratinjau ditampilkan dulu agar admin dapat
  // memeriksa hasil pembacaan sebelum data benar-benar masuk basis data.
  const berkasRef = useRef<HTMLInputElement>(null);
  const [pratinjau, setPratinjau] = useState<{
    namaBerkas: string;
    data: BarisImpor[];
    galat: { baris: number; pesan: string }[];
  } | null>(null);
  const [mengimpor, setMengimpor] = useState(false);

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

  // Berkas dibaca dan divalidasi di peramban; belum menyentuh basis data.
  async function pilihBerkas(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPesan(null);
    setPratinjau(null);
    try {
      const hasil = await uraiBerkas(file);
      setPratinjau({ namaBerkas: file.name, data: hasil.data, galat: hasil.galat });
      if (!hasil.data.length) {
        setPesan({
          tipe: "galat",
          teks: hasil.galat[0]?.pesan ?? "Tidak ada baris yang dapat dibaca dari berkas ini.",
        });
      }
    } catch (err) {
      setPesan({ tipe: "galat", teks: `Gagal membaca berkas: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  // Mengosongkan pratinjau dan input berkas. Pesan TIDAK disentuh di sini
  // supaya laporan hasil impor tetap terbaca setelah pratinjau dibersihkan.
  function bersihkanPratinjau() {
    setPratinjau(null);
    if (berkasRef.current) berkasRef.current.value = "";
  }

  function batalImpor() {
    bersihkanPratinjau();
    setPesan(null);
  }

  // Seluruh baris dikirim dalam satu panggilan RPC: lebih cepat dan jumlah
  // baris yang masuk/dilewati dilaporkan oleh basis data, bukan ditebak.
  async function jalankanImpor() {
    if (!pratinjau?.data.length) return;
    const supabase = getSupabase();
    if (!supabase) return;

    setMengimpor(true);
    setPesan(null);

    // Nomor baris berkas hanya untuk pesan galat di peramban; tidak dikirim.
    const muatan = pratinjau.data.map((b) => ({
      created_at: b.created_at,
      pm2_5: b.pm2_5,
      pm10: b.pm10,
      voc_index: b.voc_index,
      temperature: b.temperature,
      humidity: b.humidity,
      pressure: b.pressure,
      wind_speed: b.wind_speed,
      wind_direction: b.wind_direction,
      battery_volt: b.battery_volt,
    }));
    const { data, error } = await supabase.rpc("kelola_impor_data", { p_sumber: sumber, p_baris: muatan });

    setMengimpor(false);

    if (error) {
      setPesan({ tipe: "galat", teks: `Impor gagal, tidak ada data yang tersimpan: ${error.message}` });
      return;
    }

    const masuk = (data as { masuk?: number } | null)?.masuk ?? 0;
    const dilewati = (data as { dilewati?: number } | null)?.dilewati ?? 0;
    setPesan({
      tipe: "ok",
      teks:
        `Impor selesai: ${masuk} baris masuk ke ${sumberAktif.label}` +
        (dilewati ? `, ${dilewati} baris dilewati karena waktunya sudah ada.` : "."),
    });
    bersihkanPratinjau();
    onBerubah();
  }

  // Ekspor: seluruh data sumber terpilih, satu berkas per sumber agar
  // lampiran skripsi tidak mencampur dua rangkaian pengukuran.
  function ekspor(format: "csv" | "xlsx") {
    const baris = records.filter((r) => r.deviceId === sumberAktif.deviceId);
    if (!baris.length) {
      setPesan({ tipe: "galat", teks: `Belum ada data ${sumberAktif.label} untuk diekspor.` });
      return;
    }
    const judul = [
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
      "battery_volt",
    ];
    const isi = baris.map((r) => [
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
      r.batteryVolt,
    ]);
    const nama = `data_${sumberAktif.deviceId}_${baris.length}baris`;
    if (format === "xlsx") {
      unduhBlob(buatXlsx([judul, ...isi], sumberAktif.label), `${nama}.xlsx`);
    } else {
      unduhBlob(new Blob(["\uFEFF" + susunCsv([judul, ...isi])], { type: "text/csv;charset=utf-8" }), `${nama}.csv`);
    }
    setPesan({ tipe: "ok", teks: `${baris.length} baris ${sumberAktif.label} diekspor sebagai ${format.toUpperCase()}.` });
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

      {/* Impor massal dari CSV/Excel, ekspor, dan templat. Ditempatkan sebelum
          formulir satuan karena untuk data pembanding yang dicatat per jam,
          mengunggah berkas jauh lebih praktis daripada mengisi satu per satu. */}
      <section className="mt-5 rounded-md border border-line bg-surface px-4 py-4">
        <h3 className="font-semibold">Impor dan ekspor berkas</h3>
        <p className="mt-1 text-sm text-muted">
          Unggah banyak data sekaligus dari Excel atau CSV, atau unduh seluruh data {sumberAktif.label} untuk diolah di
          luar dasbor. Baris yang waktunya sudah ada di basis data akan dilewati, tidak digandakan maupun ditimpa.
        </p>

        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div>
            <h4 className="text-sm font-medium">1. Unduh templat</h4>
            <p className="mt-1 text-sm text-muted">
              Templat memuat judul kolom yang benar, batas nilai setiap parameter, dan dua baris contoh.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => unduhBlob(templatXlsx(), "templat-impor-data-pengukuran.xlsx")}
                className="min-h-10 rounded-md border border-brand px-4 text-sm font-semibold text-brand hover:bg-brand-soft"
              >
                Templat Excel (.xlsx)
              </button>
              <button
                type="button"
                onClick={() => unduhBlob(templatCsv(), "templat-impor-data-pengukuran.csv")}
                className="min-h-10 rounded-md border border-brand px-4 text-sm font-semibold text-brand hover:bg-brand-soft"
              >
                Templat CSV
              </button>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium">2. Unggah berkas terisi</h4>
            <p className="mt-1 text-sm text-muted">
              Data masuk ke <strong className="text-ink">{sumberAktif.label}</strong> sesuai sumber yang dipilih di atas.
            </p>
            <label className="mt-2 block text-sm">
              <span className="sr-only">Pilih berkas CSV atau Excel</span>
              <input
                ref={berkasRef}
                type="file"
                accept=".csv,.xlsx,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={pilihBerkas}
                className="block w-full cursor-pointer rounded-md border border-line bg-bg px-3 py-2 text-sm file:mr-3 file:min-h-8 file:cursor-pointer file:rounded file:border-0 file:bg-brand file:px-3 file:text-sm file:font-semibold file:text-white"
              />
            </label>
          </div>
        </div>

        {/* Pratinjau: admin melihat hasil pembacaan sebelum data disimpan. */}
        {pratinjau ? (
          <div className="mt-4 border-t border-line pt-4">
            <h4 className="text-sm font-medium">
              Pratinjau <span className="font-normal text-muted">· {pratinjau.namaBerkas}</span>
            </h4>
            <p className="mt-1 text-sm">
              <strong className="text-ink">{pratinjau.data.length}</strong> baris siap diimpor
              {pratinjau.galat.length ? (
                <>
                  {" · "}
                  <strong className="text-alert">{pratinjau.galat.length}</strong> baris ditolak
                </>
              ) : null}
            </p>

            {pratinjau.data.length ? (
              <div className="-mx-4 mt-2 overflow-x-auto sm:mx-0">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <caption className="sr-only">Lima baris pertama yang akan diimpor</caption>
                  <thead>
                    <tr className="border-b border-line text-muted">
                      <th scope="col" className="px-4 py-2 font-medium sm:pl-0">Waktu (WIB)</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">PM2.5</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">PM10</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">VOC</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Angin</th>
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {pratinjau.data.slice(0, 5).map((b) => (
                      <tr key={b.created_at} className="border-b border-line last:border-0">
                        <td className="whitespace-nowrap px-4 py-2 sm:pl-0">
                          {formatDateTime(new Date(b.created_at).getTime()).replace(" WIB", "")}
                        </td>
                        <td className="px-3 py-2 text-right">{b.pm2_5}</td>
                        <td className="px-3 py-2 text-right">{b.pm10}</td>
                        <td className="px-3 py-2 text-right">{b.voc_index}</td>
                        <td className="px-3 py-2 text-right">
                          {b.wind_speed} m/s · {b.wind_direction}°
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pratinjau.data.length > 5 ? (
                  <p className="mt-2 px-4 text-sm text-muted sm:px-0">
                    dan {pratinjau.data.length - 5} baris lainnya
                  </p>
                ) : null}
              </div>
            ) : null}

            {pratinjau.galat.length ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-alert">
                  Lihat {pratinjau.galat.length} baris yang ditolak
                </summary>
                <ul className="mt-2 grid gap-1 text-sm text-muted">
                  {pratinjau.galat.slice(0, 20).map((g, i) => (
                    <li key={`${g.baris}-${i}`}>
                      {g.baris ? <span className="text-ink">Baris {g.baris}:</span> : null} {g.pesan}
                    </li>
                  ))}
                  {pratinjau.galat.length > 20 ? <li>dan {pratinjau.galat.length - 20} galat lainnya</li> : null}
                </ul>
              </details>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={jalankanImpor}
                disabled={mengimpor || !pratinjau.data.length}
                className="min-h-10 rounded-md bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60"
              >
                {mengimpor ? "Mengimpor…" : `Impor ${pratinjau.data.length} baris ke ${sumberAktif.label}`}
              </button>
              <button type="button" onClick={batalImpor} className="min-h-10 rounded-md border border-line px-4 text-sm font-medium">
                Batal
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-4 border-t border-line pt-4">
          <h4 className="text-sm font-medium">Ekspor data {sumberAktif.label}</h4>
          <p className="mt-1 text-sm text-muted">
            Seluruh data sumber ini, satu berkas per sumber agar tidak tercampur saat dilampirkan di skripsi.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => ekspor("xlsx")}
              className="min-h-10 rounded-md border border-line px-4 text-sm font-medium"
            >
              Ekspor Excel (.xlsx)
            </button>
            <button
              type="button"
              onClick={() => ekspor("csv")}
              className="min-h-10 rounded-md border border-line px-4 text-sm font-medium"
            >
              Ekspor CSV
            </button>
          </div>
        </div>
      </section>

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
