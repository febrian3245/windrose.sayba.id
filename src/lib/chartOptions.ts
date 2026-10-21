// Konfigurasi Apache ECharts untuk seluruh grafik dasbor.
import type { EChartsCoreOption } from "echarts/core";
import { BAKU_MUTU } from "./ispu";
import { fmt, formatShort, HOUR_MS } from "./stats";
import type { Pollutant, SensorRecord } from "./types";
import { CALM_LIMIT, SECTORS_16, SPEED_CLASSES, sectorRange, type PollutionRoseData, type WindRoseData } from "./wind";

const INK = "#1c2321";
const MUTED = "#4a5552";
const LINE = "#d5dcda";
const BRAND = "#0f5249";
const ALERT = "#9a4a0b";
const FONT = "IBM Plex Sans, system-ui, sans-serif";

// Ramp teal berurutan (gelap = angin lebih kencang). Segmen bersebelahan
// dibedakan lewat kecerahan sehingga tetap terbaca oleh penderita buta warna.
export const SPEED_COLORS = ["#b8d8d2", "#5fa89b", "#1f7365", "#0a3a33"];
export const ROSE_FILL = "#5fa89b";
export const ROSE_PEAK = ALERT;

const baseText = { color: INK, fontFamily: FONT };

const tooltipBase = {
  backgroundColor: "#ffffff",
  borderColor: LINE,
  borderWidth: 1,
  textStyle: { color: INK, fontFamily: FONT, fontSize: 12 },
  extraCssText: "box-shadow:none;border-radius:6px;",
};

export const POLLUTANT_META: Record<Pollutant, { label: string; unit: string; baku?: number }> = {
  pm25: { label: "PM2.5", unit: "µg/m³", baku: BAKU_MUTU.pm25.avg24h },
  pm10: { label: "PM10", unit: "µg/m³", baku: BAKU_MUTU.pm10.avg24h },
  voc: { label: "Indeks VOC", unit: "indeks" },
};

// Geometri identik untuk Wind Rose dan Pollution Rose agar kedua panel simetris.
const POLAR = { radius: ["8%", "80%"], center: ["50%", "52%"] };

const ANGLE_AXIS = {
  type: "category",
  data: SECTORS_16.map((s) => s.code),
  boundaryGap: true,
  startAngle: 90 + 11.25,
  axisLine: { lineStyle: { color: LINE } },
  axisTick: { show: false },
  axisLabel: { color: INK, fontWeight: 600, fontSize: 11, margin: 10 },
  splitLine: { show: true, lineStyle: { color: LINE } },
};

// Label sumbu radial diberi latar putih agar tidak bertumpuk dengan batang.
function radiusAxis(formatter: string, step: number) {
  return {
    min: 0,
    // Batas luar dibulatkan ke atas + ruang 10% agar kelopak terpanjang tidak menyentuh label kompas.
    max: (v: { max: number }) => Math.max(step, Math.ceil((v.max * 1.1) / step) * step),
    axisLabel: {
      color: MUTED,
      fontSize: 10,
      formatter,
      backgroundColor: "#ffffff",
      padding: [1, 3],
      borderRadius: 2,
      showMinLabel: false,
      // Label ring terluar disembunyikan agar tidak menempel pada label kompas UBL.
      showMaxLabel: false,
    },
    axisLine: { show: false },
    axisTick: { show: false },
    splitNumber: 4,
    splitLine: { lineStyle: { color: LINE, type: "dashed" } },
    z: 10,
  };
}

export function windRoseOption(data: WindRoseData): EChartsCoreOption {
  return {
    textStyle: baseText,
    tooltip: {
      ...tooltipBase,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: { dataIndex: number; seriesName: string; value: number; color: string }[]) => {
        if (!params.length) return "";
        const i = params[0].dataIndex;
        const rows = params
          .map((p) => `<div style="display:flex;gap:8px;justify-content:space-between"><span><span style="display:inline-block;width:8px;height:8px;background:${p.color};margin-right:6px"></span>${p.seriesName}</span><b>${fmt(p.value)}%</b></div>`)
          .join("");
        return `<div style="min-width:180px"><b>${SECTORS_16[i].name} (${SECTORS_16[i].code})</b><div style="color:${MUTED};margin-bottom:4px">${sectorRange(i)}</div>${rows}<div style="border-top:1px solid ${LINE};margin-top:4px;padding-top:4px;display:flex;justify-content:space-between"><span>Total</span><b>${fmt(data.sectorTotalPercent[i])}%</b></div></div>`;
      },
    },
    polar: POLAR,
    angleAxis: ANGLE_AXIS,
    radiusAxis: radiusAxis("{value}%", 5),
    series: SPEED_CLASSES.map((c, k) => ({
      name: c.label,
      type: "bar",
      coordinateSystem: "polar",
      stack: "angin",
      data: data.percent[k].map((v) => Number(v.toFixed(2))),
      itemStyle: { color: SPEED_COLORS[k], borderColor: "#ffffff", borderWidth: 0.5 },
      emphasis: { focus: "series" },
    })),
    animationDuration: 400,
  };
}

export function pollutionRoseOption(data: PollutionRoseData, key: Pollutant): EChartsCoreOption {
  const meta = POLLUTANT_META[key];
  return {
    textStyle: baseText,
    tooltip: {
      ...tooltipBase,
      trigger: "item",
      formatter: (p: { dataIndex: number; value: number | null }) => {
        const i = p.dataIndex;
        const v = data.mean[i];
        return `<b>${SECTORS_16[i].name} (${SECTORS_16[i].code})</b><br/><span style="color:${MUTED}">${sectorRange(i)}</span><br/>Rata-rata ${meta.label}: <b>${v === null ? "tidak ada data" : `${fmt(v)} ${meta.unit}`}</b><br/>Jumlah data: ${data.count[i]}`;
      },
    },
    polar: POLAR,
    angleAxis: ANGLE_AXIS,
    radiusAxis: radiusAxis("{value}", 10),
    series: [
      {
        name: `Rata-rata ${meta.label}`,
        type: "bar",
        coordinateSystem: "polar",
        data: data.mean.map((v, i) => ({
          value: v === null ? 0 : Number(v.toFixed(2)),
          // Aksen hanya untuk sektor dengan rata-rata tertinggi (arah sumber dugaan).
          itemStyle: { color: i === data.maxSector ? ALERT : ROSE_FILL },
        })),
        barCategoryGap: "8%",
      },
    ],
    animationDuration: 400,
  };
}

// Rata-rata bergerak 24 jam: pembanding yang sah terhadap baku mutu 24 jam PP 22/2021.
export function rolling24h(records: SensorRecord[], key: Pollutant): (number | null)[] {
  const out: (number | null)[] = [];
  let start = 0;
  let sum = 0;
  for (let i = 0; i < records.length; i++) {
    sum += records[i][key];
    while (records[i].ts - records[start].ts >= 24 * HOUR_MS) {
      sum -= records[start][key];
      start++;
    }
    const span = records[i].ts - records[start].ts;
    // Nilai rata-rata 24 jam baru ditampilkan bila cakupan data minimal 18 jam (75%).
    out.push(span >= 18 * HOUR_MS ? sum / (i - start + 1) : null);
  }
  return out;
}

export function timeSeriesOption(records: SensorRecord[], key: Pollutant): EChartsCoreOption {
  const meta = POLLUTANT_META[key];
  const x = records.map((r) => r.ts);
  const raw = records.map((r) => [r.ts, r[key]]);
  const avg = rolling24h(records, key).map((v, i) => [x[i], v === null ? null : Number(v.toFixed(2))]);
  const series: Record<string, unknown>[] = [
    {
      name: `${meta.label} (10 menit)`,
      type: "line",
      data: raw,
      showSymbol: false,
      lineStyle: { width: 1.25, color: "#5fa89b" },
      itemStyle: { color: "#5fa89b" },
    },
  ];
  if (key !== "voc") {
    series.push({
      name: `Rata-rata bergerak 24 jam`,
      type: "line",
      data: avg,
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width: 2.5, color: BRAND },
      itemStyle: { color: BRAND },
      markLine: meta.baku
        ? {
            symbol: "none",
            silent: true,
            lineStyle: { color: ALERT, type: "dashed", width: 1.5 },
            label: {
              formatter: `Baku mutu 24 jam: ${meta.baku} µg/m³`,
              color: ALERT,
              position: "insideStartTop",
              fontFamily: FONT,
              fontWeight: 600,
            },
            data: [{ yAxis: meta.baku }],
          }
        : undefined,
    });
  }
  return {
    textStyle: baseText,
    grid: { left: 52, right: 24, top: 56, bottom: 72 },
    tooltip: {
      ...tooltipBase,
      trigger: "axis",
      valueFormatter: (v: number | null) => (v === null || v === undefined ? "–" : `${fmt(Number(v))} ${meta.unit}`),
    },
    legend: {
      top: 0,
      right: 0,
      itemWidth: 14,
      textStyle: { color: MUTED, fontFamily: FONT, fontSize: 12 },
    },
    xAxis: {
      type: "time",
      axisLine: { lineStyle: { color: LINE } },
      axisLabel: {
        color: MUTED,
        hideOverlap: true,
        formatter: (v: number) => formatShort(v),
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: meta.unit,
      nameTextStyle: { color: MUTED, align: "left" },
      // Batas atas dibulatkan ke kelipatan 10 agar interval sumbu seragam.
      max: (v: { max: number }) => Math.ceil((Math.max(v.max, meta.baku ?? 0) * 1.08) / 10) * 10,
      axisLabel: { color: MUTED },
      splitLine: { lineStyle: { color: LINE, type: "dashed" } },
    },
    dataZoom: [
      { type: "inside" },
      {
        type: "slider",
        height: 22,
        bottom: 8,
        borderColor: LINE,
        fillerColor: "rgba(15,82,73,0.12)",
        handleStyle: { color: BRAND },
        textStyle: { color: MUTED },
        labelFormatter: (v: number) => formatShort(v),
      },
    ],
    series,
    animationDuration: 300,
  };
}

export function diurnalOption(profile: (number | null)[], key: Pollutant): EChartsCoreOption {
  const meta = POLLUTANT_META[key];
  let peak = -1;
  profile.forEach((v, i) => {
    if (v !== null && (peak === -1 || v > (profile[peak] ?? -Infinity))) peak = i;
  });
  return {
    textStyle: baseText,
    grid: { left: 48, right: 12, top: 24, bottom: 36 },
    tooltip: {
      ...tooltipBase,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (p: { dataIndex: number; value: number }[]) =>
        `Pukul ${String(p[0].dataIndex).padStart(2, "0")}.00–${String(p[0].dataIndex).padStart(2, "0")}.59 WIB<br/>Rata-rata ${meta.label}: <b>${fmt(p[0].value)} ${meta.unit}</b>`,
    },
    xAxis: {
      type: "category",
      data: profile.map((_, i) => String(i).padStart(2, "0")),
      name: "Jam (WIB)",
      nameLocation: "middle",
      nameGap: 24,
      nameTextStyle: { color: MUTED },
      axisLine: { lineStyle: { color: LINE } },
      axisTick: { show: false },
      axisLabel: { color: MUTED, interval: 2 },
    },
    yAxis: {
      type: "value",
      name: meta.unit,
      nameTextStyle: { color: MUTED, align: "left" },
      axisLabel: { color: MUTED },
      splitLine: { lineStyle: { color: LINE, type: "dashed" } },
    },
    series: [
      {
        type: "bar",
        data: profile.map((v, i) => ({
          value: v === null ? null : Number(v.toFixed(2)),
          itemStyle: { color: i === peak ? ALERT : "#5fa89b", borderRadius: [2, 2, 0, 0] },
        })),
        barCategoryGap: "20%",
      },
    ],
    animationDuration: 300,
  };
}

export { CALM_LIMIT };
