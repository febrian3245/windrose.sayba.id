// Uji mode Supabase tanpa server nyata: halaman harus menampilkan panel galat, bukan crash.
import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
await p.goto("http://127.0.0.1:3210", { waitUntil: "load" });
await p.waitForSelector("text=Gagal mengambil data dari Supabase", { timeout: 30000 });
const badge = await p.textContent("header");
const retry = await p.isVisible("button:has-text('Coba lagi')");
console.log(errs.length === 0 ? "PASS  tanpa uncaught error" : "FAIL  " + errs.join(" | "));
console.log(retry ? "PASS  panel galat + tombol Coba lagi tampil" : "FAIL  tombol Coba lagi tidak ada");
console.log(/Demo/.test(badge) ? "FAIL  masih mode demo" : "PASS  label sumber = Supabase");
await p.click("button:has-text('Coba lagi')");
await p.waitForSelector("text=Gagal mengambil data dari Supabase", { timeout: 30000 });
console.log("PASS  Coba lagi memicu ulang request dan kembali ke panel galat");
await b.close();
