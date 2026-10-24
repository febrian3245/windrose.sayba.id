// Uji logika baca-tulis spreadsheet dan pemetaan impor.
// Jalankan: npm run test:sheet
//
// Berjalan di Node tanpa peramban, jadi DecompressionStream dipakai dari
// globalThis (tersedia sejak Node 18) sama seperti di browser.

import { uraiCsv, susunCsv, deteksiPemisah, buatXlsx, bacaXlsx } from "../src/lib/sheet.ts";
import { uraiBaris, uraiBerkas, templatCsv, templatXlsx, JUDUL_TEMPLAT } from "../src/lib/import-data.ts";

let gagal = 0;
function cek(kondisi: boolean, nama: string, info = "") {
  console.log(`${kondisi ? "PASS " : "FAIL "} ${nama}${info ? `  (${info})` : ""}`);
  if (!kondisi) gagal++;
}

// ---------------------------------------------------------------- CSV

cek(deteksiPemisah("a,b,c") === ",", "pemisah koma terdeteksi");
cek(deteksiPemisah("a;b;c") === ";", "pemisah titik koma terdeteksi (Excel Indonesia)");
cek(deteksiPemisah('"a;b",c') === ",", "tanda kutip tidak mengacaukan deteksi pemisah");

const csvKutip = 'created_at,catatan\n2026-08-28 10:00,"berisi, koma"\n';
const uraiKutip = uraiCsv(csvKutip);
cek(uraiKutip[1][1] === "berisi, koma", "koma di dalam tanda kutip tetap satu sel", uraiKutip[1][1]);

const csvEscape = 'a,b\n1,"kata ""dikutip"" lagi"\n';
cek(uraiCsv(csvEscape)[1][1] === 'kata "dikutip" lagi', "kutip ganda sebagai escape");

cek(uraiCsv("\uFEFFa,b\n1,2")[0][0] === "a", "BOM dari Excel dibuang");
cek(uraiCsv("a,b\r\n1,2")[1].length === 2, "akhir baris CRLF Windows");
cek(uraiCsv("a,b\n1,2\n\n\n")[1][1] === "2" && uraiCsv("a,b\n1,2\n\n").length === 2, "baris kosong diabaikan");

const bolakBalik = uraiCsv(susunCsv([["x", "te,ks"], [1, 'ku"tip']]));
cek(bolakBalik[0][1] === "te,ks" && bolakBalik[1][1] === 'ku"tip', "susun lalu urai CSV konsisten");

// ---------------------------------------------------------------- XLSX

const blobXlsx = buatXlsx([["judul", "angka"], ["teks & <tag>", 31.5]], "Uji");
cek(blobXlsx.size > 500, "xlsx terbentuk dengan ukuran wajar", `${blobXlsx.size} bait`);

const bacaUlang = await bacaXlsx(await blobXlsx.arrayBuffer());
cek(bacaUlang.length === 2, "xlsx terbaca 2 baris", String(bacaUlang.length));
cek(bacaUlang[0][0] === "judul", "judul kolom terbaca");
cek(bacaUlang[1][0] === "teks & <tag>", "karakter XML khusus aman bolak-balik", bacaUlang[1][0]);
cek(bacaUlang[1][1] === "31.5", "angka terbaca", bacaUlang[1][1]);

// Lembar lebih lebar dari 26 kolom: kode kolom harus lanjut ke AA, AB, ...
const lebar = Array.from({ length: 30 }, (_, i) => `k${i}`);
const bacaLebar = await bacaXlsx(await buatXlsx([lebar, lebar.map((_, i) => i)]).arrayBuffer());
cek(bacaLebar[0].length === 30 && bacaLebar[0][29] === "k29", "kolom ke-30 (AD) benar", String(bacaLebar[0].length));
cek(bacaLebar[1][29] === "29", "nilai kolom ke-30 benar", bacaLebar[1][29]);

// Sel kosong di tengah tidak boleh menggeser kolom setelahnya.
const bacaKosong = await bacaXlsx(await buatXlsx([["a", "b", "c"], [1, null, 3]]).arrayBuffer());
cek(bacaKosong[1][0] === "1" && bacaKosong[1][2] === "3", "sel kosong tidak menggeser kolom", JSON.stringify(bacaKosong[1]));

// ---------------------------------------------------------------- pemetaan impor

const dasar = ["pm2_5", "pm10", "voc_index", "temperature", "humidity", "pressure", "wind_speed", "wind_direction", "battery_volt"];
const barisSah = ["12.3", "22.4", "111", "31.5", "66.6", "1008.1", "2.2", "135", "3.95"];

const h1 = uraiBaris([["created_at", ...dasar], ["2026-08-28 10:00", ...barisSah]]);
cek(h1.data.length === 1 && h1.galat.length === 0, "baris sah terbaca", JSON.stringify(h1.galat));
cek(h1.data[0].created_at === "2026-08-28T10:00:00+07:00", "waktu tanpa offset dianggap WIB", h1.data[0]?.created_at);

// Judul kolom alternatif (bahasa Indonesia / variasi penulisan).
const h2 = uraiBaris([
  ["waktu", "pm25", "pm10", "voc", "suhu", "kelembapan", "tekanan", "kecepatan_angin", "arah_angin", "baterai"],
  ["28/08/2026 10:00", ...barisSah],
]);
cek(h2.data.length === 1, "judul kolom alternatif dikenali", JSON.stringify(h2.galat));
cek(h2.data[0]?.created_at === "2026-08-28T10:00:00+07:00", "format tanggal DD/MM/YYYY", h2.data[0]?.created_at);

// Desimal gaya Indonesia dan pemisah ribuan.
const h3 = uraiBaris([["created_at", ...dasar], ["2026-08-28 11:00", "12,3", "22,4", "111", "31,5", "66,6", "1.008,1", "2,2", "135", "3,95"]]);
cek(h3.data[0]?.pm2_5 === 12.3, "desimal koma dibaca benar", String(h3.data[0]?.pm2_5));
cek(h3.data[0]?.pressure === 1008.1, "ribuan titik + desimal koma", String(h3.data[0]?.pressure));

// Arah angin 360 dinormalkan ke 0 (sama seperti aturan basis data).
const h4 = uraiBaris([["created_at", ...dasar], ["2026-08-28 12:00", "12.3", "22.4", "111", "31.5", "66.6", "1008.1", "2.2", "360", "3.95"]]);
cek(h4.data[0]?.wind_direction === 0, "arah angin 360 menjadi 0", String(h4.data[0]?.wind_direction));

// Nilai di luar rentang ditolak, bukan dibulatkan diam-diam.
const h5 = uraiBaris([["created_at", ...dasar], ["2026-08-28 13:00", "5000", ...barisSah.slice(1)]]);
cek(h5.data.length === 0 && /PM2\.5/.test(h5.galat[0]?.pesan ?? ""), "nilai di luar rentang ditolak", h5.galat[0]?.pesan);

// Teks bukan angka ditolak.
const h6 = uraiBaris([["created_at", ...dasar], ["2026-08-28 14:00", "tidak ada", ...barisSah.slice(1)]]);
cek(h6.data.length === 0 && /bukan angka/.test(h6.galat[0]?.pesan ?? ""), "teks bukan angka ditolak", h6.galat[0]?.pesan);

// Waktu ganda di dalam satu berkas.
const h7 = uraiBaris([["created_at", ...dasar], ["2026-08-28 10:00", ...barisSah], ["2026-08-28 10:00", ...barisSah]]);
cek(h7.data.length === 1 && /lebih dari sekali/.test(h7.galat[0]?.pesan ?? ""), "waktu ganda dalam berkas ditolak", h7.galat[0]?.pesan);

// Kolom hilang: pesan harus menyebut nama kolom yang kurang.
const h8 = uraiBaris([["created_at", "pm2_5"], ["2026-08-28 10:00", "12.3"]]);
cek(h8.data.length === 0 && /PM10/.test(h8.galat[0]?.pesan ?? ""), "kolom yang hilang disebutkan", h8.galat[0]?.pesan);

// Kolom waktu hilang.
const h9 = uraiBaris([dasar, barisSah]);
cek(/waktu tidak ditemukan/i.test(h9.galat[0]?.pesan ?? ""), "kolom waktu wajib", h9.galat[0]?.pesan);

// Baris sah dan baris cacat bercampur: yang sah tetap lolos.
const h10 = uraiBaris([
  ["created_at", ...dasar],
  ["2026-08-28 10:00", ...barisSah],
  ["bukan tanggal", ...barisSah],
  ["2026-08-28 11:00", ...barisSah],
]);
cek(h10.data.length === 2 && h10.galat.length === 1, "baris cacat dilewati, baris sah tetap masuk", `${h10.data.length} sah / ${h10.galat.length} galat`);
cek(h10.galat[0]?.baris === 3, "nomor baris galat menunjuk baris berkas yang benar", String(h10.galat[0]?.baris));

// Nomor seri tanggal Excel. 46262.4166666667 = 28 Agu 2026 pukul 10:00,
// jadi jamnya harus 10 — bukan bergeser karena offset ditambahkan dua kali.
const h11 = uraiBaris([["created_at", ...dasar], ["46262.4166666667", ...barisSah]]);
cek(
  h11.data.length === 1 && h11.data[0].created_at === "2026-08-28T10:00:00+07:00",
  "nomor seri tanggal Excel dibaca tanpa pergeseran jam",
  h11.data[0]?.created_at,
);

// ---------------------------------------------------------------- templat

const blobTemplatCsv = templatCsv();
const tCsv = await blobTemplatCsv.text();
// Blob.text() menghapus BOM saat mendekode, jadi keberadaan BOM diperiksa
// langsung pada baitnya: EF BB BF. BOM dibutuhkan agar Excel di Windows
// membaca berkas sebagai UTF-8, bukan ANSI.
const baitCsv = new Uint8Array(await blobTemplatCsv.arrayBuffer());
cek(
  tCsv.includes("created_at") && baitCsv[0] === 0xef && baitCsv[1] === 0xbb && baitCsv[2] === 0xbf,
  "templat CSV memuat judul kolom dan BOM",
  `bait awal ${baitCsv[0]?.toString(16)} ${baitCsv[1]?.toString(16)} ${baitCsv[2]?.toString(16)}`,
);
cek(tCsv.split("\n").some((b) => b.startsWith("#")), "templat CSV memuat petunjuk");

// Templat harus bisa diimpor langsung tanpa menghapus baris petunjuk.
const hasilTemplat = uraiBaris(uraiCsv(tCsv));
cek(hasilTemplat.data.length === 2 && hasilTemplat.galat.length === 0, "templat CSV langsung dapat diimpor (petunjuk dilewati)", `${hasilTemplat.data.length} baris, ${hasilTemplat.galat.length} galat`);

const tXlsxBaris = await bacaXlsx(await templatXlsx().arrayBuffer());
const hasilTemplatX = uraiBaris(tXlsxBaris);
cek(hasilTemplatX.data.length === 2 && hasilTemplatX.galat.length === 0, "templat Excel langsung dapat diimpor", `${hasilTemplatX.data.length} baris, ${hasilTemplatX.galat.length} galat`);
cek(JUDUL_TEMPLAT.length === 10, "templat memuat 10 kolom", String(JUDUL_TEMPLAT.length));

// ---------------------------------------------------------------- uraiBerkas

const fileCsv = new File([tCsv], "templat.csv", { type: "text/csv" });
const dariFile = await uraiBerkas(fileCsv);
cek(dariFile.data.length === 2, "uraiBerkas membaca .csv", String(dariFile.data.length));

const fileXlsx = new File([await templatXlsx().arrayBuffer()], "templat.xlsx");
const dariXlsx = await uraiBerkas(fileXlsx);
cek(dariXlsx.data.length === 2, "uraiBerkas membaca .xlsx", String(dariXlsx.data.length));

const fileAneh = new File(["isi"], "data.pdf");
const dariAneh = await uraiBerkas(fileAneh);
cek(/tidak dikenali/.test(dariAneh.galat[0]?.pesan ?? ""), "format tidak didukung ditolak jelas", dariAneh.galat[0]?.pesan);

const fileXls = new File(["isi"], "lama.xls");
cek(/\.xls lama/.test((await uraiBerkas(fileXls)).galat[0]?.pesan ?? ""), "format .xls lama ditolak dengan saran");

console.log(gagal === 0 ? "\nSEMUA UJI SPREADSHEET LULUS" : `\n${gagal} UJI GAGAL`);
if (gagal) process.exit(1);
