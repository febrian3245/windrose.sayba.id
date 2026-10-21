// Uji logika inti: dijalankan dengan `node --experimental-strip-types scripts/verify-logic.ts`.
import data from "../src/data/dummy-sensor.json" with { type: "json" };
import { computeIspu, concentrationToIspu } from "../src/lib/ispu.ts";
import { normalizeRow, type SensorRow } from "../src/lib/types.ts";
import { buildPollutionRose, buildWindRose, sectorIndex } from "../src/lib/wind.ts";
import { windowRecords } from "../src/lib/stats.ts";

let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) fail++;
}

// ISPU titik batas Permen LHK P.14/2020
check("PM2.5 15,5 -> ISPU 50", Math.round(concentrationToIspu(15.5, "pm25")) === 50);
check("PM2.5 55,4 -> ISPU 100", Math.round(concentrationToIspu(55.4, "pm25")) === 100);
check("PM2.5 150,4 -> ISPU 200", Math.round(concentrationToIspu(150.4, "pm25")) === 200);
check("PM10 50 -> ISPU 50", Math.round(concentrationToIspu(50, "pm10")) === 50);
check("PM10 150 -> ISPU 100", Math.round(concentrationToIspu(150, "pm10")) === 100);
check("PM10 350 -> ISPU 200", Math.round(concentrationToIspu(350, "pm10")) === 200);
check("PM2.5 35 -> kategori Sedang", computeIspu(35, 40).style.category === "Sedang");
check("PM2.5 10 -> kategori Baik", computeIspu(10, 20).style.category === "Baik");
check("Parameter kritis PM10", computeIspu(5, 300).critical === "PM10");
check("PM2.5 600 dibatasi 500", concentrationToIspu(600, "pm25") === 500);

// Sektor kompas
check("0° -> U", sectorIndex(0) === 0);
check("11,24° -> U", sectorIndex(11.24) === 0);
check("11,25° -> UTL", sectorIndex(11.25) === 1);
check("348,75° -> U", sectorIndex(348.75) === 0);
check("348,74° -> UBL", sectorIndex(348.74) === 15);
check("225° -> BD", sectorIndex(225) === 10);
check("-90° -> B", sectorIndex(-90) === 12);

// Data dummy
const recs = (data as SensorRow[]).map(normalizeRow).sort((a, b) => a.ts - b.ts);
check("289 baris terbaca", recs.length === 289);
check("Semua timestamp valid", recs.every((r) => Number.isFinite(r.ts)));
check("Urutan naik & interval 10 menit", recs.every((r, i) => i === 0 || r.ts - recs[i - 1].ts === 600_000));

const w24 = windowRecords(recs, 24);
check("Jendela 24 jam = 144 data", w24.length === 144, `(${w24.length})`);

const wr = buildWindRose(recs);
const totalPct = wr.calmPercent + wr.sectorTotalPercent.reduce((a, b) => a + b, 0);
check("Wind rose total 100%", Math.abs(totalPct - 100) < 1e-9, `(${totalPct.toFixed(6)})`);
console.log(`      dominan sektor #${wr.dominantSector}, calm ${wr.calmPercent.toFixed(2)}%, rata-rata ${wr.meanSpeed.toFixed(3)} m/s`);

const pr = buildPollutionRose(recs, "pm25");
const n = pr.count.reduce((a, b) => a + b, 0) + wr.calmCount;
check("Pollution rose memakai semua data", n === recs.length);
console.log(`      sektor PM2.5 tertinggi #${pr.maxSector} = ${pr.mean[pr.maxSector]?.toFixed(3)}`);

const pm25m = w24.reduce((a, r) => a + r.pm25, 0) / w24.length;
const pm10m = w24.reduce((a, r) => a + r.pm10, 0) / w24.length;
const isp = computeIspu(pm25m, pm10m);
console.log(`      24 jam: PM2.5 ${pm25m.toFixed(3)}  PM10 ${pm10m.toFixed(3)}  ISPU ${isp.value} ${isp.style.category} (kritis ${isp.critical})`);

console.log(fail ? `\n${fail} UJI GAGAL` : "\nSEMUA UJI LULUS");
process.exit(fail ? 1 : 0);
