// QA visual & fungsional: node scripts/qa.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";

const URL = process.env.QA_URL ?? "http://127.0.0.1:3210";
const OUT = "qa-output";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});

const viewports = [
  { name: "mobile-360", width: 360, height: 780 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

let problems = 0;
const report = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) problems++;
};

for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#windrose svg", { timeout: 15000 });
  await page.waitForTimeout(800);

  console.log(`\n== ${vp.name} ==`);
  report(errors.length === 0, `console bersih ${errors.length ? JSON.stringify(errors) : ""}`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  report(overflow <= 0, `tanpa scroll horizontal (selisih ${overflow}px)`);

  // Lima grafik: wind rose WROSE-01, wind rose Stasiun 02, pollution rose, tren, profil harian.
  const charts = await page.$$eval('[role="img"] svg', (els) => els.map((e) => e.getBoundingClientRect().width));
  report(charts.length === 5 && charts.every((w) => w > 200), `5 grafik ter-render, lebar ${charts.map(Math.round).join(", ")}`);

  // Elemen yang keluar dari parent panel (terpotong) — kecuali sengaja dipotong oleh
  // kontainer overflow-hidden (contoh: ubin peta Leaflet, memang lebih besar dari viewport peta).
  const clipped = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("section *, main > div.rounded-lg *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > window.innerWidth + 1 && !el.closest(".overflow-x-auto") && !el.closest(".overflow-hidden")) out.push(el.tagName + "." + el.className.toString().slice(0, 40));
    });
    return out.slice(0, 5);
  });
  report(clipped.length === 0, `tidak ada elemen melewati layar ${clipped.join(" | ")}`);

  // Simetri dua wind rose yang berdampingan (xl+): alat utama vs pembanding harus
  // sama ukuran dan sejajar, supaya perbandingan visual tidak menyesatkan.
  if (vp.width >= 1280) {
    const sym = await page.evaluate(() => {
      const roses = document.querySelectorAll('#windrose [role="img"]');
      if (roses.length < 2) return null;
      const a = roses[0].getBoundingClientRect(), b = roses[1].getBoundingClientRect();
      return { dy: Math.abs(a.top - b.top), dh: Math.abs(a.height - b.height), dw: Math.abs(a.width - b.width) };
    });
    report(
      sym !== null && sym.dy <= 1 && sym.dh <= 1 && sym.dw <= 1,
      sym ? `dua wind rose sejajar (selisih top ${sym.dy}, tinggi ${sym.dh}, lebar ${sym.dw})` : "dua wind rose tidak ditemukan",
    );
  }

  // Grafik rose persegi: tinggi <= lebar (tidak ada ruang kosong vertikal di mobile)
  const roseBox = await page.$eval('#windrose [role="img"]', (e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  report(roseBox.h <= roseBox.w + 1, `wind rose tidak menyisakan ruang kosong (${Math.round(roseBox.w)}x${Math.round(roseBox.h)})`);

  // Label statistik tidak boleh terpotong (ellipsis)
  const truncated = await page.$$eval("dt.truncate", (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
  report(truncated.length === 0, `label statistik utuh ${truncated.join(", ")}`);

  // Teks yang terputus antara angka dan satuan
  // Satuan dianggap yatim bila turun ke baris berbeda dari angka di sebelahnya.
  const orphan = await page.evaluate(() =>
    [...document.querySelectorAll("span.tabular + span")].filter((u) => {
      const a = u.previousElementSibling.getBoundingClientRect();
      const b = u.getBoundingClientRect();
      return b.top >= a.bottom - 2;
    }).length,
  );
  report(orphan === 0, `angka dan satuan tetap satu baris (${orphan} terpisah)`);

  // Target sentuh tombol >= 36px tinggi
  const small = await page.$$eval("button", (bs) => bs.filter((b) => b.getBoundingClientRect().height < 40).map((b) => b.textContent));
  report(small.length === 0, `tinggi tombol >= 40px ${small.join(",")}`);

  // Header sticky tidak menutupi judul saat lompat via nav
  await page.click('nav a[href="#tren"]');
  await page.waitForTimeout(900);
  const covered = await page.evaluate(() => {
    const h = document.querySelector("header").getBoundingClientRect().bottom;
    const t = document.querySelector("#tren-title").getBoundingClientRect().top;
    return { h, t };
  });
  report(covered.t >= covered.h, `judul #tren tidak tertutup header (header ${Math.round(covered.h)} / judul ${Math.round(covered.t)})`);
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.screenshot({ path: `${OUT}/${vp.name}.png`, fullPage: true });
  await page.close();
}

// Interaksi pada desktop
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#windrose svg");
  console.log("\n== interaksi ==");
  // Tombol CSV kini satu per sumber; yang pertama = WROSE-01 (alat yang diuji).
  const countText = async () => (await page.textContent('button:has-text("CSV WROSE-01")')).trim();
  report((await countText()).includes("288"), `48 jam = 288 baris / 288 interval (${await countText()})`);
  await page.click('[role="radiogroup"][aria-label="Rentang waktu analisis"] >> text=24 jam');
  await page.waitForTimeout(300);
  report((await countText()).includes("144"), `24 jam = 144 baris (${await countText()})`);
  // CSV pembanding harus punya jumlah baris sendiri (bukan angka yang sama).
  const countCompare = async () => (await page.textContent('button:has-text("CSV Stasiun 02")')).trim();
  report(/\(2[0-9]\)|\(1[0-9]\)/.test(await countCompare()), `CSV pembanding punya hitungan sendiri (${await countCompare()})`);
  await page.click('[aria-label="Parameter pollution rose"] >> text=PM10');
  await page.waitForTimeout(300);
  const roseText = await page.textContent("#pollutionrose");
  report(roseText.includes("Rata-rata PM10") && roseText.includes("Arah sumber"), "pollution rose berganti ke PM10");
  await page.click('[aria-label="Parameter grafik tren"] >> text=VOC');
  await page.waitForTimeout(300);
  report((await page.textContent("#tren-title")).includes("VOC"), "grafik tren berganti ke VOC");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('button:has-text("CSV WROSE-01")')]);
  const path = `${OUT}/${dl.suggestedFilename()}`;
  await dl.saveAs(path);
  const lines = fs.readFileSync(path, "utf8").trim().split("\n");
  report(lines.length === 145 && lines[0].startsWith("created_at,device_id,pm2_5"), `CSV terunduh ${lines.length - 1} baris + header`);
  // Unduhan pembanding harus berisi data Stasiun 02, bukan salinan data alat utama.
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.click('button:has-text("CSV Stasiun 02")')]);
  const path2 = `${OUT}/${dl2.suggestedFilename()}`;
  await dl2.saveAs(path2);
  const lines2 = fs.readFileSync(path2, "utf8").trim().split("\n");
  const semuaStasiun = lines2.slice(1).every((l) => l.includes("STASIUN-02-UNTAN"));
  report(
    dl2.suggestedFilename().includes("STASIUN-02-UNTAN") && semuaStasiun && lines2.length < lines.length,
    `CSV pembanding terpisah: ${lines2.length - 1} baris, semua STASIUN-02-UNTAN (${semuaStasiun})`,
  );
  // Panel kelola harus menampilkan formulir masuk bagi pengunjung yang belum login.
  const kelola = await page.textContent("#kelola");
  report(kelola.includes("Masuk sebagai admin"), "panel kelola meminta login untuk pengunjung biasa");
  await page.close();
}

await browser.close();
console.log(problems ? `\n${problems} MASALAH` : "\nQA LULUS");
process.exit(problems ? 1 : 0);
