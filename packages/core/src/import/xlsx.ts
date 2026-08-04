// Minimal, dependency-free .xlsx reader (19 §9 — myBillBook parity: shopkeepers export
// Excel from Tally/Vyapar/their own sheet and expect to upload it as-is, not "Save As
// CSV" first).
//
// An .xlsx IS a ZIP of XML parts. We need three things and nothing else:
//   xl/sharedStrings.xml  — the string pool most cell text lives in
//   xl/worksheets/sheet1.xml (via workbook rels) — the grid
//   cell @t="s" → index into the pool; @t="inlineStr"/"str" → literal
//
// We deliberately do NOT pull in SheetJS/ExcelJS: this is a read-only path for small
// catalog sheets, the format subset is tiny, and a new runtime dependency has to be
// carried through the Vercel bundle forever. Inflation uses the platform's
// DecompressionStream("deflate-raw") (Node 18+/all modern runtimes) so there is no
// native module either.
//
// Scope limits, stated plainly: first worksheet only, no formulas (we read the cached
// value), no dates-as-numbers conversion (catalog sheets carry text/numbers), and a
// hard cap on size. Anything we cannot parse throws a plain Error that the import job
// surfaces as a row-0 failure — never a silent empty import.

/** Guard rails: a catalog sheet is small; anything larger is a mistake or an attack. */
const MAX_ZIP_BYTES = 12 * 1024 * 1024; // 12 MB compressed
const MAX_ENTRY_BYTES = 64 * 1024 * 1024; // 64 MB inflated (zip-bomb backstop)

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

/**
 * Read the ZIP central directory. We parse the directory rather than scanning for local
 * headers because only the directory is authoritative about entry names and sizes.
 */
function readCentralDirectory(buf: Uint8Array): ZipEntry[] {
  // End-of-central-directory record: signature 0x06054b50, within the last 64KB.
  const maxBack = Math.min(buf.length, 0xffff + 22);
  let eocd = -1;
  for (let i = buf.length - 22; i >= buf.length - maxBack && i >= 0; i--) {
    if (u32(buf, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a valid .xlsx file (no ZIP end record).");

  const entryCount = u16(buf, eocd + 10);
  let off = u32(buf, eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < entryCount; i++) {
    if (u32(buf, off) !== 0x02014b50) break; // central file header signature
    const compressionMethod = u16(buf, off + 10);
    const compressedSize = u32(buf, off + 20);
    const uncompressedSize = u32(buf, off + 24);
    const nameLen = u16(buf, off + 28);
    const extraLen = u16(buf, off + 30);
    const commentLen = u16(buf, off + 32);
    const localHeaderOffset = u32(buf, off + 42);
    const name = new TextDecoder().decode(buf.subarray(off + 46, off + 46 + nameLen));
    entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Inflate (or copy, for stored entries) one ZIP member to text. */
async function readEntry(buf: Uint8Array, entry: ZipEntry): Promise<string> {
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
    throw new Error("Spreadsheet part is too large to read.");
  }
  const lho = entry.localHeaderOffset;
  if (u32(buf, lho) !== 0x04034b50) throw new Error("Corrupt .xlsx (bad local header).");
  // The local header repeats the name/extra lengths — the data starts after them.
  const nameLen = u16(buf, lho + 26);
  const extraLen = u16(buf, lho + 28);
  const start = lho + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + entry.compressedSize);

  if (entry.compressionMethod === 0) return new TextDecoder().decode(data); // stored
  if (entry.compressionMethod !== 8) {
    throw new Error("Unsupported compression in .xlsx — re-save the file from Excel.");
  }
  // Copy into a freshly-allocated (definitely ArrayBuffer-backed) view: a subarray of the
  // caller's buffer is typed ArrayBufferLike, which BlobPart does not accept.
  const owned = new Uint8Array(data.length);
  owned.set(data);
  const stream = new Blob([owned]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

/** Decode the five XML entities that appear in spreadsheet text. */
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&"); // last: an escaped &amp;lt; must not become <
}

/**
 * Shared-string pool. Each <si> may be split across several <t> runs (Excel does this
 * whenever a cell has mixed formatting), so we concatenate every <t> inside the <si>.
 */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const inner = m[1] ?? "";
    let text = "";
    for (const t of inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += t[1] ?? "";
    out.push(unescapeXml(text));
  }
  return out;
}

/** "BC12" → 54 (0-based column index). */
function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Parse one worksheet into a dense grid of trimmed strings. */
function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowM of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cellM of rowM[1]!.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellM[1] ?? "";
      const body = cellM[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];

      let value = "";
      if (type === "inlineStr") {
        let text = "";
        for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += t[1] ?? "";
        value = unescapeXml(text);
      } else {
        // <v> holds the shared-string index, the number, or a formula's cached result.
        const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
        value = type === "s" ? (shared[Number(raw)] ?? "") : unescapeXml(raw);
      }

      const idx = ref ? columnIndex(ref) : cells.length;
      while (cells.length < idx) cells.push(""); // pad the gaps Excel omits
      cells[idx] = value.trim();
    }
    rows.push(cells);
  }
  // Drop wholly-blank rows — trailing empties are extremely common in hand-made sheets.
  return rows.filter((r) => r.some((c) => c.length > 0));
}

/**
 * Read the FIRST worksheet of an .xlsx into a grid of strings (row 0 = header),
 * matching what {@link parseCsv} returns so both formats feed the same importer.
 */
export async function parseXlsx(bytes: Uint8Array): Promise<string[][]> {
  if (bytes.length > MAX_ZIP_BYTES) throw new Error("File is too large (max 12 MB).");
  const entries = readCentralDirectory(bytes);
  const byName = new Map(entries.map((e) => [e.name, e]));

  // Resolve the first sheet through the workbook rels; fall back to the conventional
  // path, then to any worksheet — Excel is consistent but other exporters are not.
  let sheetName = "xl/worksheets/sheet1.xml";
  const workbook = byName.get("xl/workbook.xml");
  const rels = byName.get("xl/_rels/workbook.xml.rels");
  if (workbook && rels) {
    try {
      const wbXml = await readEntry(bytes, workbook);
      const relId = wbXml.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
      if (relId) {
        const relsXml = await readEntry(bytes, rels);
        const re = new RegExp(`<Relationship\\b[^>]*Id="${relId}"[^>]*Target="([^"]+)"`);
        const target = relsXml.match(re)?.[1];
        if (target) {
          const clean = target.replace(/^\/?xl\//, "").replace(/^\//, "");
          if (byName.has(`xl/${clean}`)) sheetName = `xl/${clean}`;
        }
      }
    } catch {
      // Fall through to the conventional path — a rels quirk must not fail the import.
    }
  }
  let sheet = byName.get(sheetName);
  if (!sheet) sheet = entries.find((e) => /^xl\/worksheets\/.*\.xml$/.test(e.name));
  if (!sheet) throw new Error("No worksheet found in the .xlsx file.");

  const sharedEntry = byName.get("xl/sharedStrings.xml");
  const shared = sharedEntry ? parseSharedStrings(await readEntry(bytes, sharedEntry)) : [];
  return parseSheet(await readEntry(bytes, sheet), shared);
}

/** True when the bytes look like a ZIP container (and so, here, an .xlsx). */
export function looksLikeXlsx(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
}
