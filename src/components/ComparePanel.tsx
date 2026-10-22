"use client";

import type { Pollutant, SensorRecord } from "@/lib/types";
import { pairByNearestTime, compareStats } from "@/lib/compare";
import { Stat } from "./ui";
import { fmt } from "@/lib/stats";
import { POLLUTANT_META } from "@/lib/chartOptions";

export default function ComparePanel({
  mainRecords,
  compareRecords,
  mainLabel,
  compareLabel,
  pollutant,
}: {
  mainRecords: SensorRecord[];
  compareRecords: SensorRecord[];
  mainLabel: string;
  compareLabel: string;
  pollutant: Pollutant;
}) {
  const meta = POLLUTANT_META[pollutant];
  const pairs = pairByNearestTime(mainRecords, compareRecords, pollutant);
  const stats = compareStats(pairs);

  if (!stats.n) {
    return (
      <p className="rounded-md border border-line bg-surface px-4 py-3 text-sm text-muted">
        Belum ada pasangan waktu yang cukup berdekatan (±5 menit) antara {mainLabel} dan {compareLabel} untuk
        rentang ini.
      </p>
    );
  }

  const biasOver = stats.meanDiff > 0;
  const rText = stats.r === null ? "tidak dapat dihitung" : fmt(stats.r, 3);
  const rStrength =
    stats.r === null
      ? ""
      : Math.abs(stats.r) >= 0.8
        ? "sangat kuat"
        : Math.abs(stats.r) >= 0.6
          ? "kuat"
          : Math.abs(stats.r) >= 0.4
            ? "sedang"
            : "lemah";

  return (
    <div>
      <p className="text-sm text-muted">
        {stats.n} pasang data berwaktu berdekatan (±5 menit). {mainLabel} dibandingkan terhadap {compareLabel}
        sebagai acuan.
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Selisih rata-rata"
          value={`${biasOver ? "+" : ""}${fmt(stats.meanDiff)}`}
          unit={meta.unit}
          note={<span className="text-muted">{biasOver ? `${mainLabel} lebih tinggi` : `${mainLabel} lebih rendah`}</span>}
        />
        <Stat label="RMSE" value={fmt(stats.rmse)} unit={meta.unit} note={<span className="text-muted">root mean square error</span>} />
        <Stat label="MAE" value={fmt(stats.mae)} unit={meta.unit} note={<span className="text-muted">mean absolute error</span>} />
        <Stat
          label="Korelasi (r)"
          value={rText}
          note={<span className="text-muted">{rStrength ? `hubungan ${rStrength}` : "data tidak cukup bervariasi"}</span>}
        />
      </dl>
      <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-2">
        <Stat label={`Rata-rata ${mainLabel}`} value={fmt(stats.meanMain)} unit={meta.unit} />
        <Stat label={`Rata-rata ${compareLabel}`} value={fmt(stats.meanCompare)} unit={meta.unit} />
      </dl>
    </div>
  );
}
