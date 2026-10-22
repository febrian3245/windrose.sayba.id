"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import EChart from "./EChart";
import { Panel, Segmented, Stat } from "./ui";
import { useSensorData } from "@/hooks/useSensorData";
import { BAKU_MUTU, CATEGORY_STYLES, computeIspu } from "@/lib/ispu";
import {
  diurnalOption,
  POLLUTANT_META,
  pollutionRoseOption,
  ROSE_FILL,
  ROSE_PEAK,
  SPEED_COLORS,
  timeSeriesOption,
  windRoseOption,
} from "@/lib/chartOptions";
import {
  batteryPercent,
  diurnalProfile,
  fmt,
  formatDateTime,
  HOUR_MS,
  summarize,
  toCsv,
  windowRecords,
} from "@/lib/stats";
import { STATION, type Pollutant } from "@/lib/types";
import { buildPollutionRose, buildWindRose, CALM_LIMIT, SECTORS_16, sectorIndex, SPEED_CLASSES } from "@/lib/wind";

type WindowKey = "24" | "48" | "168";

const WINDOW_OPTIONS: { value: WindowKey; label: string }[] = [
  { value: "24", label: "24 jam" },
  { value: "48", label: "48 jam" },
  { value: "168", label: "7 hari" },
];

const POLLUTANT_OPTIONS: { value: Pollutant; label: string }[] = [
  { value: "pm25", label: "PM2.5" },
  { value: "pm10", label: "PM10" },
  { value: "voc", label: "VOC" },
];

// Interval kirim data stasiun (menit), sesuai siklus Deep Sleep firmware.
const SEND_INTERVAL_MIN = 10;

export default function Dashboard() {
  const { records, mode, status, live, error, reload } = useSensorData();
  const [win, setWin] = useState<WindowKey>("48");
  const [roseKey, setRoseKey] = useState<Pollutant>("pm25");
  const [seriesKey, setSeriesKey] = useState<Pollutant>("pm25");

  const hours = Number(win);
  const scoped = useMemo(() => windowRecords(records, hours), [records, hours]);
  const last24 = useMemo(() => windowRecords(records, 24), [records]);
  const latest = records.length ? records[records.length - 1] : null;

  const wind = useMemo(() => buildWindRose(scoped), [scoped]);
  const pRose = useMemo(() => buildPollutionRose(scoped, roseKey), [scoped, roseKey]);
  const windOpt = useMemo(() => windRoseOption(wind), [wind]);
  const pRoseOpt = useMemo(() => pollutionRoseOption(pRose, roseKey), [pRose, roseKey]);
  const seriesOpt = useMemo(() => timeSeriesOption(scoped, seriesKey), [scoped, seriesKey]);
  const diurnal = useMemo(() => diurnalProfile(scoped, seriesKey), [scoped, seriesKey]);
  const diurnalOpt = useMemo(() => diurnalOption(diurnal, seriesKey), [diurnal, seriesKey]);

  const pm25Day = useMemo(() => summarize(last24, "pm25"), [last24]);
  const pm10Day = useMemo(() => summarize(last24, "pm10"), [last24]);
  // ISPU resmi memakai rata-rata 24 jam; nilai sesaat ditampilkan terpisah sebagai indikasi.
  const ispuDay = computeIspu(pm25Day.mean, pm10Day.mean);
  const ispuNow = latest ? computeIspu(latest.pm25, latest.pm10) : null;

  const coverageHours = last24.length > 1 ? (last24[last24.length - 1].ts - last24[0].ts) / HOUR_MS : 0;
  const expected = Math.round((hours * 60) / SEND_INTERVAL_MIN);
  const completeness = expected ? Math.min(100, (scoped.length / expected) * 100) : 0;

  if (status === "loading" && !records.length) {
    return (
      <Shell mode={mode} live={live} latestTs={null}>
        <StatePanel title="Memuat data dari Supabase" body="Mengambil riwayat pengukuran tabel sensor_udara_log." />
      </Shell>
    );
  }

  if (status === "error") {
    return (
      <Shell mode={mode} live={live} latestTs={null}>
        <StatePanel
          title="Gagal mengambil data dari Supabase"
          body={`Pesan server: ${error ?? "tidak diketahui"}. Periksa NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, dan kebijakan RLS SELECT pada tabel sensor_udara_log.`}
          action={
            <button type="button" onClick={reload} className="min-h-10 rounded-md bg-brand px-4 text-sm font-semibold text-white">
              Coba lagi
            </button>
          }
        />
      </Shell>
    );
  }

  if (!latest) {
    return (
      <Shell mode={mode} live={live} latestTs={null}>
        <StatePanel
          title="Belum ada data pengukuran"
          body="Tabel sensor_udara_log masih kosong. Jalankan SUPABASE_SCHEMA_DAN_DUMMY_DATA.sql di SQL Editor Supabase, atau nyalakan stasiun agar data pertama masuk."
        />
      </Shell>
    );
  }

  const dominant = SECTORS_16[wind.dominantSector];
  const source = pRose.maxSector >= 0 ? SECTORS_16[pRose.maxSector] : null;
  const roseMeta = POLLUTANT_META[roseKey];
  const battPct = batteryPercent(latest.batteryVolt);
  const latestSector = SECTORS_16[sectorIndex(latest.windDirection)];

  const downloadCsv = () => {
    const blob = new Blob([toCsv(scoped)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sensor_udara_${STATION.id}_${win}jam.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Shell mode={mode} live={live} latestTs={latest.ts} dummy={latest.isDummy}>
      {/* 1. Status kualitas udara: keputusan utama pembaca halaman ini */}
      <section aria-labelledby="status-title" className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="rounded-lg border border-line bg-panel">
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <h2 id="status-title" className="text-base font-semibold">
              ISPU rata-rata 24 jam terakhir
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              Permen LHK No. P.14/2020 · {last24.length} data · cakupan {fmt(coverageHours, 1)} jam
            </p>
          </div>
          <div className="p-4 sm:p-5">
            <div
              className="flex items-end justify-between gap-4 rounded-md px-4 py-4"
              style={{ background: ispuDay.style.fill, color: ispuDay.style.onFill }}
            >
              <div>
                <div className="text-sm font-medium">Kategori</div>
                <div className="text-2xl font-bold leading-tight sm:text-3xl">{ispuDay.style.category}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium">ISPU</div>
                <div className="tabular text-4xl font-bold leading-none sm:text-5xl">{ispuDay.value}</div>
              </div>
            </div>
            <p className="mt-3 text-sm text-ink">{ispuDay.style.advice}</p>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-sm">
              <div>
                <dt className="text-muted">Parameter kritis</dt>
                <dd className="font-semibold">{ispuDay.critical}</dd>
              </div>
              <div>
                <dt className="text-muted">ISPU PM2.5 / PM10</dt>
                <dd className="tabular font-semibold">
                  {ispuDay.pm25Ispu} / {ispuDay.pm10Ispu}
                </dd>
              </div>
              {ispuNow ? (
                <div className="col-span-2">
                  <dt className="text-muted">Indikasi sesaat (data terakhir, bukan nilai resmi)</dt>
                  <dd className="font-semibold">
                    ISPU {ispuNow.value} · {ispuNow.style.category}
                  </dd>
                </div>
              ) : null}
            </dl>
            {coverageHours < 18 ? (
              <p className="mt-3 rounded-md bg-alert-soft px-3 py-2 text-sm text-alert">
                Cakupan data kurang dari 18 jam (75%), rata-rata 24 jam belum representatif.
              </p>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-line bg-panel">
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-base font-semibold">Pengukuran terakhir</h2>
            <p className="mt-0.5 text-sm text-muted">{formatDateTime(latest.ts)}</p>
          </div>
          <div className="p-4 sm:p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <BakuMutuRow label="PM2.5" now={latest.pm25} avg={pm25Day.mean} baku={BAKU_MUTU.pm25.avg24h} />
              <BakuMutuRow label="PM10" now={latest.pm10} avg={pm10Day.mean} baku={BAKU_MUTU.pm10.avg24h} />
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
              <Stat label="Indeks VOC" value={fmt(latest.voc, 0)} note={<span className="text-muted">BME688, relatif</span>} />
              <Stat label="Suhu udara" value={fmt(latest.temperature)} unit="°C" note={<span className="text-muted">BME688</span>} />
              <Stat label="Kelembapan relatif" value={fmt(latest.humidity)} unit="%" note={<span className="text-muted">BME688</span>} />
              <Stat label="Tekanan udara" value={fmt(latest.pressure)} unit="hPa" note={<span className="text-muted">BME688</span>} />
              <Stat
                label="Kecepatan angin"
                value={fmt(latest.windSpeed)}
                unit="m/s"
                note={<span className="text-muted">{latest.windSpeed < CALM_LIMIT ? "Tenang (calm)" : "Anemometer"}</span>}
              />
              <Stat
                label="Arah angin"
                value={`${fmt(latest.windDirection, 0)}°`}
                note={
                  <span className="inline-flex items-center gap-1.5 text-muted">
                    <WindArrow deg={latest.windDirection} />
                    dari {latestSector.code}
                  </span>
                }
              />
            </dl>
          </div>
        </div>
      </section>

      {/* 2. Analisis spasial: inti judul skripsi */}
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-panel px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h2 className="text-base font-semibold">Rentang analisis</h2>
          <p className="text-sm text-muted">
            Berlaku untuk Wind Rose, Pollution Rose, grafik tren, profil harian, dan tabel. {scoped.length} data ({fmt(completeness, 0)}% kelengkapan dari interval {SEND_INTERVAL_MIN} menit).
          </p>
        </div>
        <Segmented label="Rentang waktu analisis" value={win} options={WINDOW_OPTIONS} onChange={setWin} />
      </div>

      <section id="spasial" aria-label="Analisis spasial sebaran polutan" className="grid gap-4 xl:grid-cols-2">
        {/* Dua panel rose memakai struktur identik: header, baris kontrol/legenda, grafik, 3 statistik. */}
        <Panel
          id="windrose"
          title="Wind Rose: dari mana angin bertiup?"
          question="Frekuensi arah datang angin per 16 sektor kompas dan kelas kecepatan."
        >
          <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted">
            {SPEED_CLASSES.map((c, i) => (
              <span key={c.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="inline-block h-3 w-3 rounded-sm border border-line" style={{ background: SPEED_COLORS[i] }} aria-hidden />
                {c.label}
              </span>
            ))}
          </div>
          <EChart option={windOpt} square height={440} ariaLabel={`Wind rose ${hours} jam. Arah dominan dari ${dominant.name}.`} />
          <dl className="grid grid-cols-3 gap-3 border-t border-line pt-4">
            <Stat label="Dominan" value={dominant.code} note={<span className="text-muted">{dominant.name}, {fmt(wind.sectorTotalPercent[wind.dominantSector])}%</span>} />
            <Stat label="Rata-rata" value={fmt(wind.meanSpeed)} unit="m/s" note={<span className="text-muted">kecepatan angin</span>} />
            <Stat
              label="Tenang"
              value={fmt(wind.calmPercent)}
              unit="%"
              note={<span className="text-muted">{wind.calmCount} data &lt;&nbsp;{fmt(CALM_LIMIT)}&nbsp;m/s</span>}
            />
          </dl>
        </Panel>

        <Panel
          id="pollutionrose"
          title="Pollution Rose: dari arah mana polutan datang?"
          question={`Rata-rata ${roseMeta.label} menurut arah datang angin; sektor tertinggi = dugaan arah sumber.`}
        >
          <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm text-muted">
            <Segmented label="Parameter pollution rose" value={roseKey} options={POLLUTANT_OPTIONS} onChange={setRoseKey} />
            <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: ROSE_FILL }} aria-hidden />
                Rata-rata ({roseMeta.unit})
              </span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: ROSE_PEAK }} aria-hidden />
                Sektor tertinggi
              </span>
            </span>
          </div>
          <EChart option={pRoseOpt} square height={440} ariaLabel={`Pollution rose ${roseMeta.label}.`} />
          <dl className="grid grid-cols-3 gap-3 border-t border-line pt-4">
            <Stat
              label="Arah sumber"
              value={source ? source.code : "–"}
              note={<span className="text-muted">{source ? source.name : "data sektor < 3"}</span>}
            />
            <Stat
              label="Tertinggi"
              value={source ? fmt(pRose.mean[pRose.maxSector] ?? 0) : "–"}
              unit={source ? roseMeta.unit : undefined}
              note={<span className="text-muted">{source ? `${pRose.count[pRose.maxSector]} data` : "belum dapat disimpulkan"}</span>}
            />
            <Stat
              label="Saat tenang"
              value={pRose.calmMean !== null ? fmt(pRose.calmMean) : "–"}
              unit={pRose.calmMean !== null ? roseMeta.unit : undefined}
              note={<span className="text-muted">akumulasi lokal</span>}
            />
          </dl>
        </Panel>
      </section>

      {/* 3. Dinamika waktu */}
      <Panel
        id="tren"
        title={`Tren ${POLLUTANT_META[seriesKey].label} terhadap baku mutu`}
        question={
          seriesKey === "voc"
            ? "Indeks VOC BME688 bersifat relatif sehingga tidak dibandingkan dengan baku mutu PP 22/2021."
            : "Garis tipis: data 10 menit. Garis tebal: rata-rata bergerak 24 jam, pembanding sah terhadap baku mutu 24 jam PP 22/2021."
        }
        actions={<Segmented label="Parameter grafik tren" value={seriesKey} options={POLLUTANT_OPTIONS} onChange={setSeriesKey} />}
      >
        <EChart option={seriesOpt} height={360} ariaLabel={`Grafik tren ${POLLUTANT_META[seriesKey].label}`} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Panel
          id="diurnal"
          title={`Pukul berapa ${POLLUTANT_META[seriesKey].label} paling tinggi?`}
          question="Rata-rata per jam WIB. Batang beraksen menandai jam puncak, umumnya bertepatan dengan jam sibuk lalu lintas atau inversi malam."
        >
          <EChart option={diurnalOpt} height={280} ariaLabel={`Profil harian ${POLLUTANT_META[seriesKey].label}`} />
        </Panel>

        <Panel id="perangkat" title="Kondisi perangkat" question={`${STATION.id} · ESP32 + modem 4G LTE A7670E`}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
            <Stat
              label="Tegangan baterai"
              value={fmt(latest.batteryVolt, 2)}
              unit="V"
              note={<span className={battPct < 20 ? "font-semibold text-alert" : "text-muted"}>± {fmt(battPct, 0)}% (estimasi linier 3,2–4,2 V)</span>}
            />
            <Stat label="Data terakhir" value={formatDateTime(latest.ts).split(",")[1]?.trim() ?? ""} note={<span className="text-muted">{formatDateTime(latest.ts).split(",")[0]}</span>} />
            <Stat label="Kelengkapan data" value={fmt(completeness, 0)} unit="%" note={<span className="text-muted">{scoped.length} / {expected} data</span>} />
            <Stat label="Koordinat" value={`${fmt(latest.latitude, 4)}, ${fmt(latest.longitude, 4)}`} note={<span className="text-muted">{STATION.area}</span>} />
          </dl>
          <div className="mt-5">
            <div className="flex justify-between text-sm text-muted">
              <span>Kapasitas baterai</span>
              <span className="tabular">{fmt(battPct, 0)}%</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(battPct)} aria-label="Kapasitas baterai">
              <div className={`h-full ${battPct < 20 ? "bg-alert" : "bg-brand"}`} style={{ width: `${battPct}%` }} />
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-line pt-4 text-sm">
            <dt className="text-muted">Sensor partikulat</dt>
            <dd>Plantower PMS5003 (UART)</dd>
            <dt className="text-muted">Sensor gas &amp; iklim</dt>
            <dd>Bosch BME688 (I2C)</dd>
            <dt className="text-muted">Sensor angin</dt>
            <dd>Anemometer mangkok &amp; wind vane</dd>
            <dt className="text-muted">Siklus kirim</dt>
            <dd>{SEND_INTERVAL_MIN} menit, Deep Sleep di antara pengiriman</dd>
          </dl>
        </Panel>
      </div>

      {/* 4. Data mentah untuk lampiran skripsi */}
      <Panel
        id="data"
        title="Data pengukuran"
        question="Dua puluh data terbaru. Unduh CSV untuk seluruh rentang analisis (olah lanjut di Excel atau lampiran skripsi)."
        actions={
          <button type="button" onClick={downloadCsv} className="min-h-10 rounded-md border border-brand px-4 text-sm font-semibold text-brand hover:bg-brand-soft">
            Unduh CSV ({scoped.length} baris)
          </button>
        }
      >
        <DataTable rows={scoped.slice(-20).reverse()} />
      </Panel>

      <Method />
    </Shell>
  );
}

function BakuMutuRow({ label, now, avg, baku }: { label: string; now: number; avg: number; baku: number }) {
  const over = avg > baku;
  const ratio = Math.min(100, (avg / baku) * 100);
  return (
    <div className={`rounded-md border px-4 py-3 ${over ? "border-alert bg-alert-soft" : "border-line"}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold">{label}</span>
        <span>
          <span className="tabular text-2xl font-semibold">{fmt(now)}</span>
          <span className="ml-1 text-sm text-muted">µg/m³</span>
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden>
        <div className={`h-full ${over ? "bg-alert" : "bg-brand"}`} style={{ width: `${ratio}%` }} />
      </div>
      <p className={`mt-1.5 text-sm ${over ? "font-semibold text-alert" : "text-muted"}`}>
        Rata-rata 24 jam <span className="whitespace-nowrap">{fmt(avg)} µg/m³</span>,{" "}
        <span className="whitespace-nowrap">{fmt((avg / baku) * 100, 0)}% dari baku mutu {baku}</span>
        {over ? ", MELAMPAUI" : ""}
      </p>
    </div>
  );
}

function WindArrow({ deg }: { deg: number }) {
  // Panah menunjuk ke arah TUJUAN angin (arah datang + 180°).
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden className="shrink-0 text-brand" style={{ transform: `rotate(${deg + 180}deg)` }}>
      <path d="M8 1 L12 9 H9 V15 H7 V9 H4 Z" fill="currentColor" />
    </svg>
  );
}

function DataTable({ rows }: { rows: ReturnType<typeof windowRecords> }) {
  return (
    <>
    <p className="mb-2 text-sm text-muted lg:hidden">Geser tabel ke samping untuk melihat semua kolom.</p>
    <div className="-mx-4 overflow-x-auto sm:mx-0" tabIndex={0} role="region" aria-label="Tabel data pengukuran, dapat digeser">
      <table className="w-full min-w-[760px] text-left text-sm">
        <caption className="sr-only">Data pengukuran terbaru</caption>
        <thead>
          <tr className="border-b border-line text-muted">
            <th scope="col" className="sticky left-0 bg-panel px-4 py-2 font-medium sm:pl-0">Waktu (WIB)</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">PM2.5</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">PM10</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">VOC</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Suhu °C</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">RH %</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Angin m/s</th>
            <th scope="col" className="px-3 py-2 font-medium">Arah</th>
            <th scope="col" className="px-4 py-2 text-right font-medium sm:pr-0">Baterai V</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map((r) => {
            const s = SECTORS_16[sectorIndex(r.windDirection)];
            return (
              <tr key={`${r.ts}-${r.deviceId}`} className="border-b border-line last:border-0">
                <td className="sticky left-0 whitespace-nowrap bg-panel px-4 py-2 sm:pl-0">{formatDateTime(r.ts).replace(" WIB", "")}</td>
                <td className={`px-3 py-2 text-right ${r.pm25 > BAKU_MUTU.pm25.avg24h ? "font-semibold text-alert" : ""}`}>{fmt(r.pm25)}</td>
                <td className={`px-3 py-2 text-right ${r.pm10 > BAKU_MUTU.pm10.avg24h ? "font-semibold text-alert" : ""}`}>{fmt(r.pm10)}</td>
                <td className="px-3 py-2 text-right">{fmt(r.voc, 0)}</td>
                <td className="px-3 py-2 text-right">{fmt(r.temperature)}</td>
                <td className="px-3 py-2 text-right">{fmt(r.humidity)}</td>
                <td className="px-3 py-2 text-right">{fmt(r.windSpeed)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {r.windSpeed < CALM_LIMIT ? "Tenang" : `${s.code} (${fmt(r.windDirection, 0)}°)`}
                </td>
                <td className="px-4 py-2 text-right sm:pr-0">{fmt(r.batteryVolt, 2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 px-4 text-sm text-muted sm:px-0">
        Nilai sesaat PM yang melebihi angka baku mutu ditandai warna aksen sebagai penanda saja. Kepatuhan baku mutu dinilai dari rata-rata 24 jam.
      </p>
    </div>
    </>
  );
}

function Method() {
  return (
    <Panel id="metode" title="Metode perhitungan" question="Dasar perhitungan yang dipakai dasbor, sesuai BAB II dan BAB III proposal.">
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div>
          <h3 className="font-semibold">ISPU</h3>
          <p className="mt-1 text-sm text-muted">Permen LHK No. P.14/MENLHK/SETJEN/KUM.1/7/2020, interpolasi linier:</p>
          <p className="mt-2 overflow-x-auto whitespace-nowrap rounded-md bg-surface px-3 py-2 font-mono text-sm">I = (Ia − Ib)/(Xa − Xb) × (Xx − Xb) + Ib</p>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 font-medium">ISPU</th>
                <th className="py-1 font-medium">Kategori</th>
              </tr>
            </thead>
            <tbody>
              {CATEGORY_STYLES.map((c, i) => (
                <tr key={c.category} className="border-t border-line">
                  <td className="tabular py-1.5">{["0–50", "51–100", "101–200", "201–300", "> 300"][i]}</td>
                  <td className="py-1.5">
                    <span className="mr-2 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: c.fill }} aria-hidden />
                    {c.category}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3 className="font-semibold">Baku mutu udara ambien</h3>
          <p className="mt-1 text-sm text-muted">PP No. 22 Tahun 2021 Lampiran VII.</p>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 font-medium">Parameter</th>
                <th className="py-1 text-right font-medium">24 jam</th>
                <th className="py-1 text-right font-medium">1 tahun</th>
              </tr>
            </thead>
            <tbody className="tabular">
              <tr className="border-t border-line">
                <td className="py-1.5">PM2.5</td>
                <td className="py-1.5 text-right">{BAKU_MUTU.pm25.avg24h} µg/m³</td>
                <td className="py-1.5 text-right">{BAKU_MUTU.pm25.annual} µg/m³</td>
              </tr>
              <tr className="border-t border-line">
                <td className="py-1.5">PM10</td>
                <td className="py-1.5 text-right">{BAKU_MUTU.pm10.avg24h} µg/m³</td>
                <td className="py-1.5 text-right">{BAKU_MUTU.pm10.annual} µg/m³</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-sm text-muted">
            Rata-rata 24 jam dianggap representatif bila cakupan data minimal 18 jam (75%).
          </p>
        </div>
        <div>
          <h3 className="font-semibold">Wind Rose dan Pollution Rose</h3>
          <ul className="mt-1 space-y-1.5 text-sm text-muted">
            <li>Arah = arah datang angin (konvensi meteorologi), 0° = Utara.</li>
            <li>16 sektor × 22,5°; sektor U = 348,75°–11,25°.</li>
            <li>Angin &lt; {fmt(CALM_LIMIT)} m/s = tenang, dilaporkan terpisah.</li>
            <li>Pollution rose = rata-rata konsentrasi per sektor; sektor &lt; 3 data diabaikan dalam penentuan arah sumber.</li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {SPEED_CLASSES.map((c, i) => (
              <span key={c.label} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: SPEED_COLORS[i] }} aria-hidden />
                {c.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function Shell({
  children,
  mode,
  live,
  latestTs,
  dummy = false,
}: {
  children: React.ReactNode;
  mode: "supabase" | "demo";
  live: string;
  latestTs: number | null;
  // true bila data Supabase yang tampil masih data uji (kolom sumber = 'dummy').
  dummy?: boolean;
}) {
  const headerRef = useRef<HTMLElement>(null);
  // Tinggi header sticky diukur langsung agar lompatan menu tidak menutupi judul panel
  // di semua lebar layar (tinggi header berubah antara mobile dan desktop).
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const apply = () => document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const sourceLabel =
    mode === "demo"
      ? "Mode demo: data dummy 48 jam"
      : live === "live"
        ? "Supabase · Realtime aktif"
        : live === "connecting"
          ? "Supabase · menghubungkan Realtime"
          : "Supabase · Realtime terputus";
  return (
    <div className="flex min-h-dvh flex-col">
      <header ref={headerRef} className="sticky top-0 z-20 border-b border-line bg-panel">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6 sm:py-3">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-brand">Pemantau Kualitas Udara</p>
            <p className="hidden truncate text-sm text-muted sm:block">{STATION.name}</p>
          </div>
          <div className="flex shrink-0 items-center gap-x-4 text-sm">
            <span
              className={`rounded-md px-2.5 py-1 font-medium ${
                mode === "demo" ? "bg-alert-soft text-alert" : live === "live" ? "bg-brand-soft text-brand" : "bg-surface text-muted"
              }`}
            >
              <span className="sm:hidden">{mode === "demo" ? "Demo" : live === "live" ? "Realtime" : "Offline"}</span>
              <span className="hidden sm:inline">{sourceLabel}</span>
            </span>
            {latestTs ? <span className="tabular hidden text-muted lg:inline">Data terakhir {formatDateTime(latestTs)}</span> : null}
          </div>
        </div>
        <nav aria-label="Bagian dasbor" className="mx-auto max-w-7xl overflow-x-auto px-4 sm:px-6">
          <ul className="flex gap-4 whitespace-nowrap pb-2 text-sm font-medium text-muted sm:gap-6">
            {[
              ["#status-title", "Status"],
              ["#spasial", "Spasial"],
              ["#tren", "Tren"],
              ["#perangkat", "Perangkat"],
              ["#data", "Data"],
              ["#metode", "Metode"],
            ].map(([href, label]) => (
              <li key={href}>
                <a href={href} className="inline-block py-1 hover:text-brand">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-5 sm:px-6 sm:py-6">
        <div className="mb-1">
          <h1 className="text-xl font-semibold leading-snug sm:text-2xl">
            Sebaran PM2.5, PM10, dan VOC di Pontianak berbasis IoT 4G LTE dan pemodelan Wind Rose
          </h1>
          {mode === "demo" ? (
            <p className="mt-1 max-w-3xl text-sm text-muted">
              Angka di halaman ini berasal dari data dummy simulasi, bukan hasil pengukuran. Isi <code className="font-mono text-[0.85em] text-ink">.env.local</code> (lihat README) untuk menampilkan data stasiun dari Supabase.
            </p>
          ) : dummy ? (
            <p className="mt-1 max-w-3xl text-sm text-muted">
              Data di Supabase saat ini masih data dummy simulasi (kolom <code className="font-mono text-[0.85em] text-ink">sumber = &apos;dummy&apos;</code>), bukan hasil pengukuran. Tampilan berganti otomatis ke data stasiun begitu pengiriman pertama masuk.
            </p>
          ) : null}
        </div>
        {children}
      </main>

      <footer className="border-t border-line bg-panel">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-4 text-sm text-muted sm:flex-row sm:justify-between sm:px-6">
          <span>Febrian Sayba Jaya Kasuma · D1051231070 · Teknik Lingkungan, Fakultas Teknik, Universitas Tanjungpura</span>
          <span>Skripsi 2026</span>
        </div>
      </footer>
    </div>
  );
}

function StatePanel({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-6" role="status">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
