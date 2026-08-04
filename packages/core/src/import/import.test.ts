import { describe, it, expect } from "vitest";
import { mapHeader, buildImportTemplateCsv, IMPORT_TEMPLATE_COLUMNS } from "./service";
import { parseXlsx, looksLikeXlsx } from "./xlsx";
import { importRowSchema } from "../catalog/schema";

// ── Build a minimal, valid .xlsx in-memory so the reader is tested against a real ZIP
// container rather than a mock. Entries are STORED (compression method 0), which keeps
// the fixture readable while still exercising the central-directory + XML parsing.
function buildXlsx(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(content);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header signature
    lv.setUint16(8, 0, true); // method: stored
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, data.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra length
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory signature
    cv.setUint16(10, 0, true); // method: stored
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true); // local header offset
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const l of locals) { out.set(l, p); p += l.length; }
  for (const c of centrals) { out.set(c, p); p += c.length; }
  out.set(eocd, p);
  return out;
}

const SHARED_STRINGS = `<?xml version="1.0"?><sst xmlns="x">
  <si><t>Item Name</t></si>
  <si><t>Selling Price</t></si>
  <si><t>UltraTech Cement 50kg</t></si>
  <si><t>Tata TMT Bar</t></si>
</sst>`;

const SHEET = `<?xml version="1.0"?><worksheet xmlns="x"><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
  <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>420</v></c></row>
  <row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>62.5</v></c></row>
</sheetData></worksheet>`;

describe("parseXlsx", () => {
  it("reads a real .xlsx container into a grid", async () => {
    const bytes = buildXlsx({
      "xl/sharedStrings.xml": SHARED_STRINGS,
      "xl/worksheets/sheet1.xml": SHEET,
    });
    expect(looksLikeXlsx(bytes)).toBe(true);

    const grid = await parseXlsx(bytes);
    expect(grid[0]).toEqual(["Item Name", "Selling Price"]);
    expect(grid[1]).toEqual(["UltraTech Cement 50kg", "420"]);
    expect(grid[2]).toEqual(["Tata TMT Bar", "62.5"]);
  });

  it("pads the gaps Excel omits for empty cells", async () => {
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>A</t></is></c><c r="C1" t="inlineStr"><is><t>C</t></is></c></row>
    </sheetData></worksheet>`;
    const grid = await parseXlsx(buildXlsx({ "xl/worksheets/sheet1.xml": sheet }));
    // B was skipped in the XML — it must still occupy its column.
    expect(grid[0]).toEqual(["A", "", "C"]);
  });

  it("rejects a non-zip payload rather than importing nothing silently", async () => {
    await expect(parseXlsx(new TextEncoder().encode("Item Name,Selling Price"))).rejects.toThrow();
  });

  it("does not mistake a CSV for a spreadsheet", () => {
    expect(looksLikeXlsx(new TextEncoder().encode("name,price\na,1"))).toBe(false);
  });
});

describe("mapHeader", () => {
  it("understands myBillBook's own column names", () => {
    const cols = mapHeader(["Item Name", "Selling Price", "Purchase Price", "HSN/SAC Code", "GST Tax Rate"]);
    expect(cols.name).toBe(0);
    expect(cols.salePrice).toBe(1);
    expect(cols.costPerBaseUnit).toBe(2);
    expect(cols.hsnCode).toBe(3);
    expect(cols.gstRatePct).toBe(4);
  });

  it("ignores case, spacing and punctuation", () => {
    const cols = mapHeader(["item_name", "SELLING PRICE", "hsn-sac"]);
    expect(cols.name).toBe(0);
    expect(cols.salePrice).toBe(1);
    expect(cols.hsnCode).toBe(2);
  });

  it("does not care about column order", () => {
    const cols = mapHeader(["Rate", "Category", "Particulars"]);
    expect(cols.salePrice).toBe(0);
    expect(cols.category).toBe(1);
    expect(cols.name).toBe(2);
  });

  it("accepts the vocabulary of other billing apps", () => {
    const cols = mapHeader(["Product Name", "MRP", "Opening Stock", "Unit", "Barcode"]);
    expect(cols.name).toBe(0);
    expect(cols.mrp).toBe(1);
    expect(cols.openingStock).toBe(2);
    expect(cols.baseUnitCode).toBe(3);
    expect(cols.barcode).toBe(4);
  });

  it("leaves unknown columns unmapped instead of guessing", () => {
    expect(mapHeader(["Item Name", "Selling Price", "Salesman Notes"]).name).toBe(0);
    expect(Object.values(mapHeader(["Whatever"])).length).toBe(0);
  });
});

describe("importRowSchema — money as typed in a spreadsheet", () => {
  it("reads rupees and stores paise", () => {
    const r = importRowSchema.parse({ name: "Cement", salePrice: "420" });
    expect(r.salePrice).toBe(42000);
  });

  it("keeps the paisa on a decimal price", () => {
    expect(importRowSchema.parse({ name: "Bar", salePrice: "62.50" }).salePrice).toBe(6250);
    expect(importRowSchema.parse({ name: "Bar", salePrice: "0.05" }).salePrice).toBe(5);
  });

  it("tolerates ₹ signs and thousands separators", () => {
    expect(importRowSchema.parse({ name: "Tank", salePrice: "₹1,250.75" }).salePrice).toBe(125075);
  });

  it("accepts a number as well as a string (Excel gives numbers)", () => {
    expect(importRowSchema.parse({ name: "Cement", salePrice: 420 }).salePrice).toBe(42000);
  });

  it("needs only an item name and a selling price", () => {
    const r = importRowSchema.parse({ name: "Mystery item", salePrice: "10" });
    expect(r.sku).toBeUndefined();
    expect(r.category).toBeUndefined();
    expect(r.baseUnitCode).toBeUndefined();
    expect(r.gstRatePct).toBeUndefined();
  });

  it("rejects a negative or nonsense price", () => {
    expect(importRowSchema.safeParse({ name: "X", salePrice: "-5" }).success).toBe(false);
    expect(importRowSchema.safeParse({ name: "X", salePrice: "abc" }).success).toBe(false);
  });

  it("still requires a name", () => {
    expect(importRowSchema.safeParse({ salePrice: "10" }).success).toBe(false);
  });
});

describe("import template", () => {
  it("leads with the two required columns", () => {
    expect(IMPORT_TEMPLATE_COLUMNS[0]).toBe("Item Name");
    expect(IMPORT_TEMPLATE_COLUMNS[1]).toBe("Selling Price");
  });

  it("produces a template whose own headers map cleanly", () => {
    const [header] = buildImportTemplateCsv().split("\n");
    const cols = mapHeader(header!.split(","));
    // Every column we advertise must actually be understood by the importer.
    for (const field of ["name", "salePrice", "costPerBaseUnit", "mrp", "openingStock", "baseUnitCode",
      "category", "brand", "sku", "barcode", "hsnCode", "gstRatePct", "wholesalePrice", "wholesaleMinQty"]) {
      expect(cols[field], `template column for ${field}`).toBeDefined();
    }
  });

  it("ships example rows that survive validation", () => {
    const [header, ...rows] = buildImportTemplateCsv().trim().split("\n");
    const cols = mapHeader(header!.split(","));
    expect(rows.length).toBeGreaterThan(0);
    for (const line of rows) {
      const cells = line.split(",");
      const parsed = importRowSchema.safeParse({
        name: cells[cols.name!],
        salePrice: cells[cols.salePrice!],
        gstRatePct: cells[cols.gstRatePct!] || undefined,
        openingStock: cells[cols.openingStock!] || undefined,
      });
      expect(parsed.success, `example row: ${line}`).toBe(true);
    }
  });
});
