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
import { audit } from "../shared/audit";
import { requirePermission, type Session } from "../shared/rbac";
import { fromPaise } from "../shared/money";
import { validateQtyToBase } from "../catalog/service";
import { incrementStock } from "../inventory/service";
import { importRowSchema, type ImportRow } from "../catalog/schema";

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

/** Map a parsed header+row pair into the importRow raw shape (then Zod-validated). */
function rowToRaw(header: string[], cells: string[]): Record<string, unknown> {
  const get = (key: string): string | undefined => {
    const idx = header.indexOf(key);
    if (idx === -1) return undefined;
    const v = cells[idx]?.trim();
    return v === undefined || v === "" ? undefined : v;
  };
  const num = (key: string): number | undefined => {
    const v = get(key);
    return v === undefined ? undefined : Number(v);
  };
  const bool = (key: string): boolean | undefined => {
    const v = get(key);
    return v === undefined ? undefined : BOOL_TRUE.has(v.toLowerCase());
  };
  return {
    sku: get("sku"),
    name: get("name"),
    category: get("category"),
    brand: get("brand"),
    hsnCode: get("hsnCode") ?? get("hsn"),
    gstRatePct: get("gstRatePct") ?? get("gst"),
    baseUnitCode: get("baseUnitCode") ?? get("baseUnit"),
    baseUnitKind: get("baseUnitKind"),
    saleUnitCode: get("saleUnitCode") ?? get("saleUnit"),
    saleUnitKind: get("saleUnitKind"),
    factorToBase: get("factorToBase") ?? "1",
    salePrice: num("salePrice"),
    mrp: num("mrp"),
    costPerBaseUnit: num("costPerBaseUnit") ?? 0,
    priceInclusive: bool("priceInclusive") ?? false,
    openingStock: get("openingStock"),
  };
}

/** Resolve-or-create a Unit by code (importer convenience). */
async function ensureUnit(tx: Prisma.TransactionClient, code: string, kind: "MEASURED" | "PIECE"): Promise<string> {
  const existing = await tx.unit.findUnique({ where: { code }, select: { id: true } });
  if (existing) return existing.id;
  const created = await tx.unit.create({ data: { code, name: code, kind }, select: { id: true } });
  return created.id;
}
async function ensureCategory(tx: Prisma.TransactionClient, name: string): Promise<string> {
  const existing = await tx.category.findFirst({ where: { name }, select: { id: true } });
  if (existing) return existing.id;
  const created = await tx.category.create({ data: { name }, select: { id: true } });
  return created.id;
}
async function ensureBrand(tx: Prisma.TransactionClient, name: string): Promise<string> {
  const existing = await tx.brand.findUnique({ where: { name }, select: { id: true } });
  if (existing) return existing.id;
  const created = await tx.brand.create({ data: { name }, select: { id: true } });
  return created.id;
}

/** Persist a single validated row: product + base/sale unit + opening stock. */
async function persistRow(row: ImportRow, ctx: ImportCtx): Promise<void> {
  const baseKind = row.baseUnitKind ?? "MEASURED";
  const saleKind = row.saleUnitKind ?? baseKind;
  await runTx(async (tx) => {
    const baseUnitId = await ensureUnit(tx, row.baseUnitCode, baseKind);
    const saleUnitId =
      row.saleUnitCode === row.baseUnitCode ? baseUnitId : await ensureUnit(tx, row.saleUnitCode, saleKind);
    const categoryId = await ensureCategory(tx, row.category);
    const brandId = row.brand ? await ensureBrand(tx, row.brand) : null;

    const product = await tx.product.create({
      data: {
        sku: row.sku,
        name: row.name,
        brandId,
        categoryId,
        hsnCode: row.hsnCode ?? null,
        baseUnitId,
        costPerBaseUnit: fromPaise(row.costPerBaseUnit),
        gstRate: new Prisma.Decimal(row.gstRatePct),
        priceInclusive: row.priceInclusive,
        saleUnits: {
          create: {
            unitId: saleUnitId,
            factorToBase: new Prisma.Decimal(row.factorToBase),
            mrp: row.mrp === undefined || row.mrp === null ? null : fromPaise(row.mrp),
            salePrice: fromPaise(row.salePrice),
            isDefault: true,
          },
        },
        stock: { create: { onHand: new Prisma.Decimal(0), reserved: new Prisma.Decimal(0) } },
      },
      select: { id: true },
    });

    // Opening stock: validate against the SALE unit kind (rejects fractional PIECE),
    // then increment via the inventory kernel as an ADJUST_IN movement (S3 owns GRN).
    if (row.openingStock !== undefined && Number(row.openingStock) > 0) {
      const baseQty = validateQtyToBase(row.openingStock, {
        code: row.saleUnitCode,
        kind: saleKind,
        factorToBase: row.factorToBase,
      });
      await incrementStock(tx, product.id, baseQty, "ADJUST_IN", {
        refType: "IMPORT",
        reason: "opening stock (CSV import)",
        actorStaffId: ctx.session.userId,
      });
    }

    await audit(tx, {
      actorStaffId: ctx.session.userId,
      roleAtTime: ctx.session.roles?.[0] ?? null,
      permissionUsed: "import.catalog",
      action: "import.product.create",
      targetType: "Product",
      targetId: product.id,
      after: { sku: row.sku },
      requestId: ctx.requestId,
    });
  });
}

/**
 * Start a catalog import. Permission-guarded (import.catalog). Parses the CSV,
 * validates+persists each row, and records row-level errors. Returns the job
 * (already complete in S2's synchronous mode). The route returns 202 + job.id and
 * the client polls GET /api/import/jobs/{id}.
 */
export async function importCatalog(csvText: string, ctx: ImportCtx): Promise<ImportJob> {
  requirePermission(ctx.session, "import.catalog");

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

  const grid = parseCsv(csvText);
  if (grid.length === 0) {
    job.status = "FAILED";
    job.errors.push({ row: 0, message: "Empty file or no header row" });
    return job;
  }
  const header = grid[0]!.map((h) => h.trim());
  const dataRows = grid.slice(1);
  job.totalRows = dataRows.length;

  for (let i = 0; i < dataRows.length; i++) {
    const rowNo = i + 1;
    const raw = rowToRaw(header, dataRows[i]!);
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
      await persistRow(parsed.data, ctx);
      job.createdRows++;
    } catch (e) {
      job.errorRows++;
      job.errors.push({ row: rowNo, message: messageFor(e) });
    }
  }

  job.status = "DONE";
  return job;
}

function messageFor(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return "Duplicate SKU (already exists)";
  }
  if (e instanceof Error) return e.message;
  return "Unknown error";
}
