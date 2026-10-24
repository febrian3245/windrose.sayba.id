// Uji ujung-ke-ujung dengan Supabase asli: node scripts/qa-supabase-live.mjs
// Butuh: server berjalan di QA_URL dan env KUNCI_PERANGKAT (kunci WROSE-01) untuk uji Realtime.
// Baris uji yang dikirim memakai waktu sekarang lalu dihapus oleh skrip pemanggil.
import { chromium } from "playwright-core";

const URL = process.env.QA_URL ?? "http://127.0.0.1:3210";
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const KUNCI = process.env.KUNCI_PERANGKAT;
let fail = 0;
const report = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErr = [];
const cspErr = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErr.push(m.text());
  if (/Content Security Policy/i.test(m.text())) cspErr.push(m.text());
});
page.on("pageerror", (e) => consoleErr.push(String(e)));
// Dua tabel fisik terpisah sekarang (bukan 1 tabel sensor_udara_log + device_id):
// data_wrose01 = alat IoT, data_stasiun02 = acuan resmi pembanding.
const restCalls = [];
page.on("response", (r) => {
  if (r.url().includes("/rest/v1/data_wrose01") || r.url().includes("/rest/v1/data_stasiun02")) {
    restCalls.push(r.status());
  }
});

const resp = await page.goto(URL, { waitUntil: "load" });
const h = resp.headers();
report(Boolean(h["content-security-policy"]), "header CSP terpasang");
report(h["x-frame-options"] === "DENY" && h["x-content-type-options"] === "nosniff", "header X-Frame-Options & nosniff");
report(!h["x-powered-by"], "header X-Powered-By disembunyikan");

await page.waitForSelector("#windrose svg", { timeout: 30000 });
report(restCalls.length >= 2 && restCalls.every((s) => s === 200), `REST Supabase 200 dari kedua tabel (${restCalls.join(",")})`);
await page.waitForFunction(() => /Realtime aktif/.test(document.querySelector("header")?.textContent ?? ""), null, { timeout: 30000 })
  .then(() => report(true, "badge: Supabase · Realtime aktif"))
  .catch(() => report(false, "badge Realtime tidak aktif: " + document.querySelector?.("header")?.textContent));
const csvText = await page.textContent("button:has-text('CSV WROSE-01')");
report(/\d/.test(csvText), `data Supabase terbaca (${csvText})`);

// Realtime: kirim satu data lewat RPC seperti ESP32 ke device UTAMA (WROSE-01).
// RPC akan routing otomatis ke tabel data_wrose01 berdasarkan device_id terdaftar.
if (KUNCI) {
  await page.waitForTimeout(2500);
  const before = await page.textContent("header");
  const res = await fetch(`${SB_URL}/rest/v1/rpc/kirim_data_sensor`, {
    method: "POST",
    headers: { apikey: SB_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_device_id: "WROSE-01", p_kunci: KUNCI,
      p_pm2_5: 77.7, p_pm10: 99.9, p_voc_index: 150, p_temperature: 30.5, p_humidity: 70,
      p_pressure: 1010.5, p_wind_speed: 2.2, p_wind_direction: 90, p_battery_volt: 4.01,
    }),
  });
  report(res.status === 200, `RPC kirim_data_sensor ${res.status}`);
  await page.waitForFunction(() => document.body.innerText.includes("77,7"), null, { timeout: 20000 })
    .then(() => report(true, "data baru (PM2.5 77,7) muncul via Realtime tanpa muat ulang"))
    .catch(() => report(false, "data baru tidak muncul via Realtime"));
  const after = await page.textContent("header");
  report(before !== after, "jam 'Data terakhir' di header ikut berganti");
}

report(cspErr.length === 0, `tidak ada pelanggaran CSP ${cspErr.join(" | ")}`);
report(consoleErr.length === 0, `console bersih ${consoleErr.join(" | ")}`);
await browser.close();
console.log(fail ? `\n${fail} MASALAH` : "\nQA SUPABASE LULUS");
process.exit(fail ? 1 : 0);
