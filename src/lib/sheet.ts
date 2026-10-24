// Baca-tulis berkas spreadsheet tanpa pustaka pihak ketiga.
//
// Alasan menulis sendiri: paket XLSX populer berukuran besar dan punya riwayat
// kerentanan, padahal kebutuhan di sini sempit (satu lembar, tabel datar).
// Penulisan XLSX memakai ZIP "store" (tanpa kompresi) sehingga tidak perlu
// pustaka deflate, sedangkan pembacaan memakai DecompressionStream bawaan
// peramban. Bila peramban tidak mendukungnya, pengguna diarahkan memakai CSV.

export type NilaiSel = string | number | null;

// ---------------------------------------------------------------- CSV

// Pemisah CSV sengaja dideteksi: Excel berbahasa Indonesia menyimpan CSV
// dengan titik koma, sedangkan ekspor aplikasi memakai koma.
export function deteksiPemisah(teks: string): "," | ";" {
  const barisPertama = teks.split(/\r?\n/, 1)[0] ?? "";
  let koma = 0;
  let titikKoma = 0;
  let dalamKutip = false;
  for (const ch of barisPertama) {
    if (ch === '"') dalamKutip = !dalamKutip;
    else if (!dalamKutip && ch === ",") koma++;
    else if (!dalamKutip && ch === ";") titikKoma++;
  }
  return titikKoma > koma ? ";" : ",";
}

// Pengurai CSV sesuai RFC 4180: menghormati tanda kutip, kutip ganda sebagai
// escape, serta baris baru di dalam sel.
export function uraiCsv(teks: string): string[][] {
  const bersih = teks.replace(/^\uFEFF/, ""); // buang BOM dari Excel
  const pemisah = deteksiPemisah(bersih);
  const baris: string[][] = [];
  let sel = "";
  let barisIni: string[] = [];
  let dalamKutip = false;

  for (let i = 0; i < bersih.length; i++) {
    const ch = bersih[i];
    if (dalamKutip) {
      if (ch === '"') {
        if (bersih[i + 1] === '"') {
          sel += '"';
          i++;
        } else dalamKutip = false;
      } else sel += ch;
      continue;
    }
    if (ch === '"') dalamKutip = true;
    else if (ch === pemisah) {
      barisIni.push(sel);
      sel = "";
    } else if (ch === "\n") {
      barisIni.push(sel);
      baris.push(barisIni);
      barisIni = [];
      sel = "";
    } else if (ch !== "\r") sel += ch;
  }
  if (sel !== "" || barisIni.length) {
    barisIni.push(sel);
    baris.push(barisIni);
  }
  return baris.filter((b) => b.some((s) => s.trim() !== ""));
}

export function susunCsv(baris: NilaiSel[][]): string {
  const sel = (v: NilaiSel) => {
    const s = v === null ? "" : String(v);
    return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return baris.map((b) => b.map(sel).join(",")).join("\r\n");
}

// ---------------------------------------------------------------- ZIP

function crc32(data: Uint8Array<ArrayBuffer>): number {
  let c: number;
  const tabel = crc32.tabel ?? (crc32.tabel = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = (crc >>> 8) ^ tabel[(crc ^ data[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}
crc32.tabel = undefined as Uint32Array | undefined;

interface BerkasZip {
  nama: string;
  data: Uint8Array<ArrayBuffer>;
}

// ZIP metode "store": isi disimpan apa adanya. Ukuran berkas sedikit lebih
// besar, tetapi tidak memerlukan pustaka kompresi apa pun.
function buatZip(berkas: BerkasZip[]): Blob {
  const enc = new TextEncoder();
  const lokal: Uint8Array<ArrayBuffer>[] = [];
  const pusat: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const f of berkas) {
    const nama = enc.encode(f.nama);
    const crc = crc32(f.data);
    const n = f.data.length;

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true); // versi minimum
    lh.setUint16(6, 0, true); // bendera
    lh.setUint16(8, 0, true); // metode: store
    lh.setUint16(10, 0, true); // waktu
    lh.setUint16(12, 0x21, true); // tanggal (1 Jan 1980)
    lh.setUint32(14, crc, true);
    lh.setUint32(18, n, true);
    lh.setUint32(22, n, true);
    lh.setUint16(26, nama.length, true);
    lh.setUint16(28, 0, true);
    lokal.push(new Uint8Array(lh.buffer), nama, f.data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, 0, true);
    ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, n, true);
    ch.setUint32(24, n, true);
    ch.setUint16(28, nama.length, true);
    ch.setUint16(30, 0, true);
    ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true);
    ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true);
    ch.setUint32(42, offset, true);
    pusat.push(new Uint8Array(ch.buffer), nama);

    offset += 30 + nama.length + n;
  }

  const ukuranPusat = pusat.reduce((a, b) => a + b.length, 0);
  const akhir = new DataView(new ArrayBuffer(22));
  akhir.setUint32(0, 0x06054b50, true);
  akhir.setUint16(8, berkas.length, true);
  akhir.setUint16(10, berkas.length, true);
  akhir.setUint32(12, ukuranPusat, true);
  akhir.setUint32(16, offset, true);

  return new Blob([...lokal, ...pusat, new Uint8Array(akhir.buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// ---------------------------------------------------------------- XLSX tulis

function xmlAman(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

function kodeKolom(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function buatXlsx(baris: NilaiSel[][], namaLembar = "Data"): Blob {
  const barisXml = baris
    .map((b, r) => {
      const sel = b
        .map((v, c) => {
          const ref = `${kodeKolom(c)}${r + 1}`;
          if (v === null || v === "") return "";
          if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
          // Judul kolom memakai gaya tebal (s="1"), isi memakai teks biasa.
          const gaya = r === 0 ? ' s="1"' : "";
          return `<c r="${ref}"${gaya} t="inlineStr"><is><t xml:space="preserve">${xmlAman(String(v))}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${sel}</row>`;
    })
    .join("");

  const lembar =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<sheetData>${barisXml}</sheetData></worksheet>`;

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${xmlAman(namaLembar).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
    "</styleSheet>";

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    "</Types>";

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";

  const relsWb =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    "</Relationships>";

  const enc = new TextEncoder();
  return buatZip([
    { nama: "[Content_Types].xml", data: enc.encode(contentTypes) },
    { nama: "_rels/.rels", data: enc.encode(rels) },
    { nama: "xl/workbook.xml", data: enc.encode(workbook) },
    { nama: "xl/_rels/workbook.xml.rels", data: enc.encode(relsWb) },
    { nama: "xl/styles.xml", data: enc.encode(styles) },
    { nama: "xl/worksheets/sheet1.xml", data: enc.encode(lembar) },
  ]);
}

// ---------------------------------------------------------------- XLSX baca

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Peramban ini tidak dapat membuka berkas .xlsx. Gunakan berkas CSV.");
  }
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Membaca entri ZIP lewat direktori pusat (bukan menyusur header lokal),
// supaya ukuran terkompresi selalu terbaca dengan benar.
async function bacaZip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  const dec = new TextDecoder();
  const hasil = new Map<string, Uint8Array>();

  let eocd = -1;
  for (let i = u8.length - 22; i >= 0 && i > u8.length - 65558; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Berkas .xlsx tidak valid (struktur ZIP tidak ditemukan).");

  const jumlah = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);

  for (let k = 0; k < jumlah; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const metode = dv.getUint16(p + 10, true);
    const ukuranTerkompresi = dv.getUint32(p + 20, true);
    const panjangNama = dv.getUint16(p + 28, true);
    const panjangExtra = dv.getUint16(p + 30, true);
    const panjangKomentar = dv.getUint16(p + 32, true);
    const offsetLokal = dv.getUint32(p + 42, true);
    const nama = dec.decode(u8.subarray(p + 46, p + 46 + panjangNama));

    const namaLokal = dv.getUint16(offsetLokal + 26, true);
    const extraLokal = dv.getUint16(offsetLokal + 28, true);
    const mulai = offsetLokal + 30 + namaLokal + extraLokal;
    const mentah = u8.subarray(mulai, mulai + ukuranTerkompresi);

    hasil.set(nama, metode === 0 ? mentah : await inflateRaw(mentah));
    p += 46 + panjangNama + panjangExtra + panjangKomentar;
  }
  return hasil;
}

function indeksKolom(ref: string): number {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function ambilTeks(xml: string): string {
  // Gabungkan seluruh <t> (teks kaya bisa terpecah menjadi beberapa run).
  const bagian = xml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [];
  return bagian
    .map((b) => b.replace(/<[^>]+>/g, ""))
    .join("")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export async function bacaXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const isi = await bacaZip(buf);
  const dec = new TextDecoder();

  // Nama lembar pertama diambil dari relasi; cukup pakai pola umum bila ada.
  const kunciLembar =
    [...isi.keys()].find((k) => /^xl\/worksheets\/sheet1\.xml$/.test(k)) ??
    [...isi.keys()].find((k) => /^xl\/worksheets\/.*\.xml$/.test(k));
  if (!kunciLembar) throw new Error("Berkas .xlsx tidak memuat lembar kerja.");

  const sharedXml = isi.get("xl/sharedStrings.xml");
  const shared: string[] = [];
  if (sharedXml) {
    const s = dec.decode(sharedXml);
    for (const si of s.match(/<si>[\s\S]*?<\/si>/g) ?? []) shared.push(ambilTeks(si));
  }

  const lembar = dec.decode(isi.get(kunciLembar)!);
  const hasil: string[][] = [];

  for (const rowXml of lembar.match(/<row[\s\S]*?(?:\/>|<\/row>)/g) ?? []) {
    const baris: string[] = [];
    for (const cXml of rowXml.match(/<c[\s\S]*?(?:\/>|<\/c>)/g) ?? []) {
      const ref = /r="([A-Z]+\d+)"/.exec(cXml)?.[1] ?? "";
      const tipe = /t="([^"]+)"/.exec(cXml)?.[1];
      const idx = ref ? indeksKolom(ref) : baris.length;
      let nilai = "";
      if (tipe === "s") {
        const i = Number(/<v>([\s\S]*?)<\/v>/.exec(cXml)?.[1] ?? "-1");
        nilai = shared[i] ?? "";
      } else if (tipe === "inlineStr") {
        nilai = ambilTeks(cXml);
      } else {
        nilai = (/<v>([\s\S]*?)<\/v>/.exec(cXml)?.[1] ?? "").trim();
        nilai = nilai.replace(/&amp;/g, "&");
      }
      while (baris.length < idx) baris.push("");
      baris[idx] = nilai;
    }
    if (baris.some((s) => s.trim() !== "")) hasil.push(baris);
  }
  return hasil;
}

// ---------------------------------------------------------------- unduh

export function unduhBlob(blob: Blob, namaBerkas: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = namaBerkas;
  a.click();
  URL.revokeObjectURL(a.href);
}
