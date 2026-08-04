// CSV catalog-import service (04 Import). Parses a catalog + opening-stock CSV,
// validates each row with the SHARED Zod schema (catalog/schema importRowSchema),
// and creates products + opening stock. Per the slice plan the async QStash queue
// lands in S7 — S2 processes SYNCHRONOUSLY (flagged as a deviation) and returns a
// 202 + jobId so the API contract (POST /api/import/catalog → 202 + jobId; GET
// /api/import/jobs/{id} → row errors) is already correct. Job state is kept in an
// in-process store (no Job table in the 13 schema); S7 replaces it with a durable
// queue + job row.
//
// Each row is upserted as a product with one base unit (== sale unit, factor as
// given) + opening stock via the inventory kernel's incrementStock, all in ONE
// transaction per row so a bad row never half-writes. Units/categories/brands are
// auto-created by code/name when missing (importer convenience). Permission-guarded
// (import.catalog) at the job level; each created product is audited.
import { Prisma, runTx } from "../shared/db";
import { requirePermission, requireShop, type Session } from "../shared/rbac";
import { createProduct, getLastUsedGstRate } from "../catalog/service";
import { importRowSchema, createProductSchema, type ImportRow, type CreateProductInput } from "../catalog/schema";
import { parseXlsx, looksLikeXlsx } from "./xlsx";

export interface ImportRowError {
  row: number; // 1-based data-row index (excludes header)
  message: string;
  issues?: { path: string; issue: string }[];
}

export interface ImportJob {
  id: string;
  status: "PROCESSING" | "DONE" | "FAILED";
  totalRows: number;
  createdRows: number;
  errorRows: number;
  errors: ImportRowError[];
  createdAt: string;
}

// In-process job store (S2 synchronous; durable in S7).
const jobs = new Map<string, ImportJob>();

export function getImportJob(id: string): ImportJob | null {
  return jobs.get(id) ?? null;
}

interface ImportCtx {
  session: Session;
  requestId?: string | null;
}

/**
 * Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes (""),
 * and commas/newlines inside quotes. Good enough for hand/exported catalog CSVs;
 * a hardened parser can swap in later without touching callers.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  // flush last field/row if the file does not end with a newline
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

const BOOL_TRUE = new Set(["true", "1", "yes", "y"]);

/**
 * Header synonyms (19 §9). A shopkeeper's sheet says "Item Name" / "Selling Price" /
 * "Purchase Price" — myBillBook's vocabulary — or whatever Tally/Vyapar exported. We
 * match on a NORMALISED header (lowercased, non-alphanumerics stripped) so "HSN/SAC",
 * "hsn_sac" and "Hsn Sac" are all the same key, and column ORDER never matters.
 *
 * First alias wins, so put the most specific first: "wholesaleprice" must be tested
 * before a bare "price" could swallow it (it cannot here — each list is exact-match —
 * but the ordering documents intent).
 */
const HEADER_ALIASES: Record<string, string[]> = {
  name: ["name", "itemname", "productname", "product", "item", "particulars", "description", "itemdescription"],
  sku: ["sku", "itemcode", "code", "productcode", "itemid", "alias"],
  barcode: ["barcode", "ean", "upc", "barcodeno", "scancode"],
  category: ["category", "itemgroup", "group", "categoryname"],
  brand: ["brand", "company", "make", "manufacturer"],
  hsnCode: ["hsn", "hsncode", "hsnsac", "sac", "hsnsaccode"],
  gstRatePct: ["gst", "gstrate", "gstratepct", "gstpercent", "tax", "taxrate", "gsttaxrate", "gstpct"],
  baseUnitCode: ["unit", "baseunit", "baseunitcode", "uom", "unitofmeasure", "unitname"],
  baseUnitKind: ["baseunitkind", "unitkind"],
  saleUnitCode: ["saleunit", "saleunitcode", "sellingunit"],
  saleUnitKind: ["saleunitkind"],
  factorToBase: ["factortobase", "conversion", "conversionfactor", "factor"],
  salePrice: ["salePrice", "saleprice", "sellingprice", "price", "rate", "sellprice", "mrpprice", "unitprice"],
  mrp: ["mrp", "maximumretailprice", "printedprice"],
  costPerBaseUnit: ["purchaseprice", "cost", "costprice", "buyingprice", "buyprice", "costperbaseunit", "purchaserate"],
  wholesalePrice: ["wholesaleprice", "wholesalerate", "bulkprice"],
  wholesaleMinQty: ["wholesaleminqty", "minimumwholesalequantity", "minwholesaleqty", "wholesalequantity", "bulkminqty"],
  priceInclusive: ["priceinclusive", "inclusiveoftax", "taxinclusive"],
  openingStock: ["openingstock", "stock", "quantity", "qty", "openingqty", "stockqty", "currentstock", "closingstock"],
};

/** Lowercase + strip everything that is not a letter or digit. */
function normaliseHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Build header-label → column-index once per file, resolving synonyms. */
export function mapHeader(header: string[]): Record<string, number> {
  const normalised = header.map(normaliseHeader);
  const out: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      const idx = normalised.indexOf(normaliseHeader(alias));
      if (idx !== -1) {
        out[field] = idx;
        break; // first alias that appears wins
      }
    }
  }
  return out;
}

/** Map a parsed header+row pair into the importRow raw shape (then Zod-validated). */
function rowToRaw(columns: Record<string, number>, cells: string[]): Record<string, unknown> {
  const get = (field: string): string | undefined => {
    const idx = columns[field];
    if (idx === undefined) return undefined;
    const v = cells[idx]?.trim();
    return v === undefined || v === "" ? undefined : v;
  };
  const bool = (field: string): boolean | undefined => {
    const v = get(field);
    return v === undefined ? undefined : BOOL_TRUE.has(v.toLowerCase());
  };
  // Money stays a STRING here — importRowSchema parses rupees (and strips ₹ / commas).
  return {
    sku: get("sku"),
    name: get("name"),
    category: get("category"),
    brand: get("brand"),
    barcode: get("barcode"),
    hsnCode: get("hsnCode"),
    gstRatePct: get("gstRatePct"),
    baseUnitCode: get("baseUnitCode"),
    baseUnitKind: get("baseUnitKind"),
    saleUnitCode: get("saleUnitCode"),
    saleUnitKind: get("saleUnitKind"),
    factorToBase: get("factorToBase"),
    salePrice: get("salePrice"),
    mrp: get("mrp"),
    costPerBaseUnit: get("costPerBaseUnit"),
    wholesalePrice: get("wholesalePrice"),
    wholesaleMinQty: get("wholesaleMinQty"),
    priceInclusive: bool("priceInclusive") ?? false,
    openingStock: get("openingStock"),
  };
}

/** Resolve-or-create a Unit by code (importer convenience). */
async function ensureUnit(
  tx: Prisma.TransactionClient,
  shopId: string,
  code: string,
  kind: "MEASURED" | "PIECE",
): Promise<string> {
  const existing = await tx.unit.findFirst({ where: { shopId, code }, select: { id: true } });
  if (existing) return existing.id;
  const created = await tx.unit.create({ data: { shopId, code, name: code, kind }, select: { id: true } });
  return created.id;
}
async function ensureCategory(tx: Prisma.TransactionClient, shopId: string, name: string): Promise<string> {
  const existing = await tx.category.findFirst({ where: { shopId, name }, select: { id: true } });
  if (existing) return existing.id;
  const created = await tx.category.create({ data: { shopId, name }, select: { id: true } });
  return created.id;
}
async function ensureBrand(tx: Prisma.TransactionClient, shopId: string, name: string): Promise<string> {
  const existing = await tx.brand.findFirst({ where: { shopId, name }, select: { id: true } });
  if (existing) return existing.id;
  const created = await tx.brand.create({ data: { shopId, name }, select: { id: true } });
  return created.id;
}

/**
 * Persist one validated row.
 *
 * Named masters (category / brand / unit) are resolved-or-created first, then the row
 * is handed to the SAME `createProduct` the quick "New Item" form uses. That is the
 * point: auto item-code, default unit/category back-fill, the synthesised sale unit,
 * opening stock as an audited ADJUST_IN, and the wholesale price slab are all one
 * implementation, so an imported item and a hand-typed one are indistinguishable.
 *
 * Atomicity note: master creation commits in its own transaction, so a row that fails
 * validation *afterwards* can leave an unused Category/Brand/Unit behind. That is
 * deliberate — an empty master is harmless and visible, whereas duplicating
 * createProduct's logic here to keep one transaction would be a second source of truth
 * for how a product is built.
 */
async function persistRow(row: ImportRow, ctx: ImportCtx, shopId: string, fallbackGst: string): Promise<void> {
  const baseKind = row.baseUnitKind ?? "MEASURED";
  const saleKind = row.saleUnitKind ?? baseKind;

  const masters = await runTx(async (tx) => {
    const baseUnitId = row.baseUnitCode ? await ensureUnit(tx, shopId, row.baseUnitCode, baseKind) : undefined;
    const categoryId = row.category ? await ensureCategory(tx, shopId, row.category) : undefined;
    const brandId = row.brand ? await ensureBrand(tx, shopId, row.brand) : undefined;
    return { baseUnitId, categoryId, brandId };
  });

  // A sale unit that differs from the base unit still needs the explicit sale-unit
  // shape (factor + price); otherwise the simple path synthesises it from salePrice.
  let saleUnits: CreateProductInput["saleUnits"] = [];
  if (row.saleUnitCode && row.saleUnitCode !== row.baseUnitCode) {
    const saleUnitId = await runTx((tx) => ensureUnit(tx, shopId, row.saleUnitCode!, saleKind));
    saleUnits = [
      {
        unitId: saleUnitId,
        factorToBase: row.factorToBase ?? "1",
        salePrice: row.salePrice,
        mrp: row.mrp ?? null,
        isDefault: true,
      },
    ];
  }

  const input = createProductSchema.parse({
    sku: row.sku,
    name: row.name,
    brandId: masters.brandId ?? null,
    categoryId: masters.categoryId,
    hsnCode: row.hsnCode ?? null,
    barcode: row.barcode ?? null,
    baseUnitId: masters.baseUnitId,
    costPerBaseUnit: row.costPerBaseUnit ?? 0,
    gstRatePct: row.gstRatePct ?? fallbackGst,
    priceInclusive: row.priceInclusive,
    salePrice: row.salePrice,
    openingStock: row.openingStock,
    wholesalePrice: row.wholesalePrice,
    wholesaleMinQty: row.wholesaleMinQty,
    saleUnits,
  });

  await createProduct(input, { session: ctx.session, requestId: ctx.requestId });
}

/**
 * Start a catalog import. Permission-guarded (import.catalog). Parses the CSV,
 * validates+persists each row, and records row-level errors. Returns the job
 * (already complete in S2's synchronous mode). The route returns 202 + job.id and
 * the client polls GET /api/import/jobs/{id}.
 */
export async function importCatalog(file: string | Uint8Array, ctx: ImportCtx): Promise<ImportJob> {
  requirePermission(ctx.session, "import.catalog");
  const shopId = requireShop(ctx.session);

  const id = `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const job: ImportJob = {
    id,
    status: "PROCESSING",
    totalRows: 0,
    createdRows: 0,
    errorRows: 0,
    errors: [],
    createdAt: new Date().toISOString(),
  };
  jobs.set(id, job);

  // Accept a real .xlsx as well as CSV (19 §9) — sniffed from the bytes, not the file
  // name, so a mislabelled upload still works.
  let grid: string[][];
  try {
    grid =
      typeof file === "string"
        ? parseCsv(file)
        : looksLikeXlsx(file)
          ? await parseXlsx(file)
          : parseCsv(new TextDecoder().decode(file));
  } catch (e) {
    job.status = "FAILED";
    job.errors.push({ row: 0, message: e instanceof Error ? e.message : "Could not read the file" });
    return job;
  }

  if (grid.length === 0) {
    job.status = "FAILED";
    job.errors.push({ row: 0, message: "Empty file or no header row" });
    return job;
  }

  const columns = mapHeader(grid[0]!.map((h) => h.trim()));
  // Without a name or a price column nothing below can succeed — say so once, clearly,
  // instead of emitting the same validation error on every single row.
  if (columns.name === undefined || columns.salePrice === undefined) {
    job.status = "FAILED";
    job.errors.push({
      row: 0,
      message:
        "Could not find the required columns. The sheet needs an item-name column (e.g. \"Item Name\") and a price column (e.g. \"Selling Price\"). Download the template to see the expected headings.",
    });
    return job;
  }

  // Rows that omit GST inherit the shop's last-used rate, exactly like the quick form.
  const fallbackGst = (await getLastUsedGstRate(shopId)) ?? "18";

  const dataRows = grid.slice(1);
  job.totalRows = dataRows.length;

  for (let i = 0; i < dataRows.length; i++) {
    const rowNo = i + 1;
    const raw = rowToRaw(columns, dataRows[i]!);
    const parsed = importRowSchema.safeParse(raw);
    if (!parsed.success) {
      job.errorRows++;
      job.errors.push({
        row: rowNo,
        message: "Validation failed",
        issues: parsed.error.issues.map((iss) => ({ path: iss.path.join("."), issue: iss.message })),
      });
      continue;
    }
    try {
      await persistRow(parsed.data, ctx, shopId, fallbackGst);
      job.createdRows++;
    } catch (e) {
      job.errorRows++;
      job.errors.push({ row: rowNo, message: messageFor(e) });
    }
  }

  job.status = "DONE";
  return job;
}

/**
 * The importable columns, in the order the downloadable template presents them. The
 * first two are the only ones a row actually needs; the rest are conveniences.
 */
export const IMPORT_TEMPLATE_COLUMNS = [
  "Item Name",
  "Selling Price",
  "Purchase Price",
  "MRP",
  "Opening Stock",
  "Unit",
  "Category",
  "Brand",
  "Item Code",
  "Barcode",
  "HSN/SAC Code",
  "GST Tax Rate",
  "Wholesale Price",
  "Minimum Wholesale Quantity",
] as const;

/**
 * A ready-to-fill CSV template with two worked example rows (19 §9). Sending the
 * shopkeeper a file that already looks right beats documenting column names.
 */
export function buildImportTemplateCsv(): string {
  const examples = [
    ["UltraTech PPC Cement 50 kg", "420", "385", "450", "120", "BAG", "Cement", "UltraTech", "", "", "2523", "18", "410", "50"],
    ["TMT Bar 12mm", "62.50", "55", "", "800", "PCS", "Steel", "Tata", "", "", "7213", "18", "", ""],
  ];
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [IMPORT_TEMPLATE_COLUMNS.join(","), ...examples.map((r) => r.map(escape).join(","))].join("\n") + "\n";
}

function messageFor(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return "Duplicate SKU (already exists)";
  }
  if (e instanceof Error) return e.message;
  return "Unknown error";
}
